/* js/indexeddb-cache.js - High Performance IndexedDB Cache Manager for SIMAS SMAGESA */

const DB_NAME = 'SIMAS_CACHE_DB';
const DB_VERSION = 2;
const STORES = ['students', 'teachers', 'classes', 'student_aggregates', 'metadata', 'sync_queue'];

let dbPromise = null;

function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve) => {
        if (!('indexedDB' in window)) {
            console.warn('[SimasDB] IndexedDB tidak didukung pada browser ini.');
            return resolve(null);
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            STORES.forEach(store => {
                if (!db.objectStoreNames.contains(store)) {
                    db.createObjectStore(store);
                }
            });
        };

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };

        request.onerror = (event) => {
            console.warn('[SimasDB] Gagal membuka IndexedDB:', event.target.error);
            dbPromise = null; // Reset agar bisa mencoba kembali nanti jika dipanggil ulang
            resolve(null);
        };
    });

    return dbPromise;
}

export const SimasDB = {
    async get(storeName, key) {
        try {
            const db = await openDB();
            if (!db) return null;
            return new Promise((resolve) => {
                const tx = db.transaction(storeName, 'readonly');
                const store = tx.objectStore(storeName);
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
                req.onerror = () => resolve(null);
            });
        } catch (e) {
            console.warn(`[SimasDB] Error get(${storeName}, ${key}):`, e);
            return null;
        }
    },

    async getAll(storeName) {
        try {
            const db = await openDB();
            if (!db) return null;
            return new Promise((resolve) => {
                const tx = db.transaction(storeName, 'readonly');
                const store = tx.objectStore(storeName);
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
        } catch (e) {
            console.warn(`[SimasDB] Error getAll(${storeName}):`, e);
            return null;
        }
    },

    async saveAll(storeName, items, serverTs) {
        try {
            const db = await openDB();
            if (!db) return false;
            return new Promise((resolve) => {
                const tx = db.transaction([storeName, 'metadata'], 'readwrite');
                const store = tx.objectStore(storeName);
                const metaStore = tx.objectStore('metadata');

                store.clear();
                const list = Array.isArray(items) ? items : [];
                list.forEach((item, idx) => {
                    const key = item.id || item.nis || item.id_guru || idx;
                    store.put(item, key);
                });

                if (serverTs) {
                    metaStore.put({ ts: serverTs, updated_at: Date.now() }, `${storeName}_ts`);
                }

                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => {
                    console.warn(`[SimasDB] Transaction error saveAll(${storeName}):`, e);
                    resolve(false);
                };
            });
        } catch (e) {
            console.warn(`[SimasDB] Error saveAll(${storeName}):`, e);
            return false;
        }
    },

    async getMeta(key) {
        return this.get('metadata', key);
    },

    async setMeta(key, value) {
        try {
            const db = await openDB();
            if (!db) return false;
            return new Promise((resolve) => {
                const tx = db.transaction('metadata', 'readwrite');
                const store = tx.objectStore('metadata');
                store.put(value, key);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch (e) {
            console.warn(`[SimasDB] Error setMeta(${key}):`, e);
            return false;
        }
    },

    async clear(storeName) {
        try {
            const db = await openDB();
            if (!db) return false;
            return new Promise((resolve) => {
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                store.clear();
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch (e) {
            console.warn(`[SimasDB] Error clear(${storeName}):`, e);
            return false;
        }
    },

    async addSyncQueue(item) {
        try {
            const db = await openDB();
            if (!db) return false;
            return new Promise((resolve) => {
                const tx = db.transaction('sync_queue', 'readwrite');
                const store = tx.objectStore('sync_queue');
                const syncId = item.id || ('sync_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
                const payload = {
                    ...item,
                    id: syncId,
                    createdAt: item.createdAt || Date.now(),
                    retryCount: item.retryCount || 0
                };
                store.put(payload, syncId);
                tx.oncomplete = () => resolve(syncId);
                tx.onerror = (e) => {
                    console.warn('[SimasDB] Error addSyncQueue:', e);
                    resolve(false);
                };
            });
        } catch (e) {
            console.warn('[SimasDB] Error addSyncQueue:', e);
            return false;
        }
    },

    async getSyncQueue() {
        const all = await this.getAll('sync_queue');
        return Array.isArray(all) ? all : [];
    },

    async removeSyncQueue(id) {
        try {
            const db = await openDB();
            if (!db) return false;
            return new Promise((resolve) => {
                const tx = db.transaction('sync_queue', 'readwrite');
                const store = tx.objectStore('sync_queue');
                store.delete(id);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch (e) {
            console.warn(`[SimasDB] Error removeSyncQueue(${id}):`, e);
            return false;
        }
    },

    async getPendingSyncCount() {
        const queue = await this.getSyncQueue();
        return queue.length;
    }
};

window.SimasDB = SimasDB;
