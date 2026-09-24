import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class ConfirmedPalStore {
  constructor(path) {
    if (!path) throw new Error('ConfirmedPalStore requires a persistence path.');
    this.path = path;
    this.assets = [];
    this.restore();
  }

  restore() {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
      if (parsed?.version !== 1 || !Array.isArray(parsed.pals)) throw new Error('牌友名册存档格式无效；为避免覆盖名册，服务未启动。');
      this.assets = parsed.pals.filter((asset) => asset?.readiness === 'READY' && asset?.palId);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.persist();
    }
  }

  persist() {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, pals: this.assets }, null, 2), 'utf8');
    renameSync(temp, this.path);
  }

  list() { return [...this.assets]; }

  confirm(asset) {
    if (!asset?.palId || asset.readiness !== 'READY') throw new Error('只有资源完整且已审核的牌友可以加入名册。');
    this.assets = [...this.assets.filter((entry) => entry.palId !== asset.palId), asset];
    this.persist();
    return asset;
  }

  remove(palId) {
    const next = this.assets.filter((entry) => entry.palId !== palId);
    if (next.length !== this.assets.length) {
      this.assets = next;
      this.persist();
    }
    return this.list();
  }
}
