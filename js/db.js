// Tiny IndexedDB key-value wrapper. Two stores: 'kv' (workouts, daily) and 'routes' (one entry per route).
const DB_NAME = 'stride', VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('routes')) db.createObjectStore('routes');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
export const dbGet = (store, key) => tx(store, 'readonly', s => s.get(key));
export const dbSet = (store, key, val) => tx(store, 'readwrite', s => s.put(val, key));
export const dbDel = (store, key) => tx(store, 'readwrite', s => s.delete(key));
export const dbClear = (store) => tx(store, 'readwrite', s => s.clear());
export const dbKeys = (store) => tx(store, 'readonly', s => s.getAllKeys());
export async function dbSetMany(store, entries) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const [k, v] of entries) s.put(v, k);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
export async function dbGetAll(store) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readonly');
    const s = t.objectStore(store);
    const out = {};
    const req = s.openCursor();
    req.onsuccess = () => { const c = req.result; if (c) { out[c.key] = c.value; c.continue(); } else resolve(out); };
    req.onerror = () => reject(req.error);
  });
}
