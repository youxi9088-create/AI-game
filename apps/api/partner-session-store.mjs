import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/* 平台创作会话存储：一次 ticket 兑换对应一条会话（user_ref + draft_id），
   与回传的 external_work_id 一起持久化，保证网络重试/服务重启不产生第二件作品。 */
export class PartnerSessionStore {
  constructor(path) {
    if (!path) throw new Error('PartnerSessionStore requires a persistence path.');
    this.path = path;
    this.sessions = [];
    this.restore();
  }

  restore() {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
      this.sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.persist();
    }
  }

  persist() {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, sessions: this.sessions }, null, 2), 'utf8');
    renameSync(temp, this.path);
  }

  create(record) {
    const session = { sessionId: randomUUID(), status: 'active', createdAt: new Date().toISOString(), ...record };
    this.sessions = [...this.sessions.filter((entry) => entry.sessionId !== session.sessionId), session];
    this.persist();
    return session;
  }

  get(sessionId) {
    return this.sessions.find((entry) => entry.sessionId === sessionId) || null;
  }

  update(sessionId, patch) {
    const session = this.get(sessionId);
    if (!session) throw new Error('平台会话不存在或已过期，请从平台重新发起创作。');
    Object.assign(session, patch, { updatedAt: new Date().toISOString() });
    this.persist();
    return session;
  }
}
