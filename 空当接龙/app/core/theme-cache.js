const KEY = 'theme-freecell-theme-cache-v2';
const DB = 'theme-freecell-assets-v2';
const ASSET_CACHE = 'theme-freecell-static-assets-v1';
const MAX_THEMES = 10;
const memory = new Map();
const cacheKey = theme => `${theme.themeId}@${theme.revision || 1}`;

const openDb = () => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') return resolve(null);
  const request = indexedDB.open(DB, 1); request.onupgradeneeded = () => request.result.createObjectStore('themes', { keyPath: 'cacheKey' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
const load = () => { if (typeof localStorage === 'undefined') return; try { Object.entries(JSON.parse(localStorage.getItem(KEY) || '{}')).forEach(([id, item]) => memory.set(id, item)); } catch { localStorage.removeItem(KEY); } };
const save = () => { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(memory))); };
const cacheAssets = async theme => {
  if (typeof caches === 'undefined') return;
  const store = await caches.open(ASSET_CACHE);
  await Promise.all((theme.assets?.items || []).filter(item => item.url && (item.kind === 'background' || item.kind === 'cardBack')).map(async item => { const response = await fetch(item.url); if (!response.ok) throw new Error(`资源 ${item.id} 预载失败：HTTP ${response.status}`); await store.put(item.url, response); }));
};
const prune = async () => {
  const removable = [...memory.values()].filter(item => item.theme.themeId !== 'classic').sort((a, b) => String(a.lastAccessed).localeCompare(String(b.lastAccessed)));
  while (memory.size > MAX_THEMES && removable.length) { const record = removable.shift(); memory.delete(record.cacheKey); try { const db = await openDb(); db?.transaction('themes', 'readwrite').objectStore('themes').delete(record.cacheKey); } catch { /* metadata fallback remains */ } }
};
load();

export const themeCache = {
  async put(theme) {
    await cacheAssets(theme);
    const record = { cacheKey: cacheKey(theme), themeId: theme.themeId, revision: theme.revision || 1, theme: structuredClone(theme), cachedAt: new Date().toISOString(), lastAccessed: new Date().toISOString() };
    memory.set(record.cacheKey, record); await prune(); save();
    try { const db = await openDb(); if (db) db.transaction('themes', 'readwrite').objectStore('themes').put(record); } catch { /* localStorage fallback remains available */ }
    return record;
  },
  async get(themeId, revision) {
    const candidates = [...memory.values()].filter(item => item.themeId === themeId && (!revision || item.revision === revision)).sort((a, b) => b.revision - a.revision);
    if (candidates.length) { candidates[0].lastAccessed = new Date().toISOString(); save(); return candidates[0].theme; }
    try {
      const db = await openDb(); if (!db) return null;
      const records = await new Promise((resolve, reject) => { const request = db.transaction('themes').objectStore('themes').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      for (const record of records) memory.set(record.cacheKey, record);
      return this.get(themeId, revision);
    } catch { return null; }
  },
  async list() { return [...memory.values()].sort((a, b) => String(b.cachedAt).localeCompare(String(a.cachedAt))).map(item => item.theme); },
  async remove(themeId) { for (const [key, item] of memory) if (item.themeId === themeId) memory.delete(key); save(); try { const db = await openDb(); if (db) { const store = db.transaction('themes', 'readwrite').objectStore('themes'); for (const key of await new Promise((resolve, reject) => { const request = store.getAllKeys(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); })) if (String(key).startsWith(`${themeId}@`)) store.delete(key); } } catch { /* fallback remains */ } },
  async clear() { memory.clear(); save(); try { const db = await openDb(); db?.transaction('themes', 'readwrite').objectStore('themes').clear(); await caches?.delete(ASSET_CACHE); } catch { /* fallback remains */ } },
};
