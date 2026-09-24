// A unique primary key plus revision checks also work across FN instances.
export function sqlitePartnerStore(db) {
  db.exec('CREATE TABLE IF NOT EXISTS partner_state (key TEXT PRIMARY KEY, revision INTEGER NOT NULL, value TEXT NOT NULL)');
  return {
    async get(key) { const row = db.prepare('SELECT value, revision FROM partner_state WHERE key = ?').get(key); return row ? { ...JSON.parse(row.value), revision: row.revision } : null; },
    async create(value) { return db.prepare('INSERT OR IGNORE INTO partner_state VALUES (?, 0, ?)').run(value.key, JSON.stringify(value)).changes === 1; },
    async save(value) { const revision = Number(value.revision || 0); const changed = db.prepare('UPDATE partner_state SET value = ?, revision = revision + 1 WHERE key = ? AND revision = ?').run(JSON.stringify(value), value.key, revision).changes === 1; if (changed) value.revision = revision + 1; return changed; },
  };
}
export function mongoPartnerStore(collection) {
  return {
    async get(key) { const row = await collection.findOne({ _id: key }); if (!row) return null; const { _id, ...value } = row; return value; },
    async create(value) { try { await collection.insertOne({ ...value, _id: value.key, revision: 0 }); return true; } catch (error) { if (error.code === 11000 || /duplicate key/i.test(error.message)) return false; throw error; } },
    async save(value) { const revision = Number(value.revision || 0); const result = await collection.updateOne({ _id: value.key, revision }, { $set: { ...value, revision: revision + 1 } }); const changed = result.modifiedCount === 1; if (changed) value.revision = revision + 1; return changed; },
  };
}
