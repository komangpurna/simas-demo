/**
 * js/workload-week-cache.mjs
 * In-Memory LRU Cache dengan pola SWR (Stale-While-Revalidate) untuk Data Mingguan E-Kinerja Guru.
 * Modul murni (Pure Module) tanpa dependensi DOM, mendukung structuredClone untuk imutabilitas penuh.
 * SSOT: Cloudflare D1 SQL via cfGetWorkloadWeek.
 */

export const WEEK_CACHE_MAX = 12;
export const WEEK_CACHE_STALE_MS = 30_000;   // 30 detik: lewat batas ini, revalidasi senyap di latar belakang
export const WEEK_CACHE_EXPIRE_MS = 300_000; // 5 menit: lewat batas ini, data dibuang dari cache

/**
 * Membuat instance in-memory cache berprinsip LRU & SWR.
 * @param {Object} [options]
 * @param {Function} [options.now] Provider timestamp milidetik (memudahkan pengujian unit Jest)
 * @param {number} [options.max] Kapasitas maksimum entri LRU
 * @param {number} [options.staleMs] Ambang batas waktu stale data (ms)
 * @param {number} [options.expireMs] Ambang batas waktu hard-expire data (ms)
 * @returns {Object} Interface cache { get, set, delete, clear, size, has }
 */
export function createWeekCache({
    now = () => Date.now(),
    max = WEEK_CACHE_MAX,
    staleMs = WEEK_CACHE_STALE_MS,
    expireMs = WEEK_CACHE_EXPIRE_MS
} = {}) {
    const store = new Map();

    const makeKey = (teacherId, week) => {
        const cleanTeacher = (teacherId && typeof teacherId === 'string') ? teacherId.trim() : (teacherId ? String(teacherId) : 'self');
        const cleanWeek = (week && typeof week === 'string') ? week.trim() : String(week || '');
        return `${cleanTeacher}|${cleanWeek}`;
    };

    const cloneData = (data) => {
        if (!data) return data;
        try {
            if (typeof structuredClone === 'function') {
                return structuredClone(data);
            }
        } catch (_) {}
        try {
            return JSON.parse(JSON.stringify(data));
        } catch (_) {
            return data;
        }
    };

    return {
        /**
         * Mengambil data dari cache.
         * Jika ditemukan dan belum expire, entri dipromosikan ke posisi paling akhir (LRU touch).
         * @param {string|null} teacherId
         * @param {string} week
         * @returns {{ data: any, stale: boolean, age: number } | null}
         */
        get(teacherId, week) {
            const k = makeKey(teacherId, week);
            const entry = store.get(k);
            if (!entry) return null;

            const age = now() - entry.ts;
            if (age > expireMs) {
                store.delete(k);
                return null;
            }

            // Touch LRU: hapus lalu set kembali agar berada di paling akhir map
            store.delete(k);
            store.set(k, entry);

            return {
                data: cloneData(entry.data),
                stale: age > staleMs,
                age
            };
        },

        /**
         * Menyimpan data ke dalam cache dengan kloning imutabel.
         * Menyingkirkan entri tertua jika kapasitas melampaui `max`.
         * @param {string|null} teacherId
         * @param {string} week
         * @param {any} data
         */
        set(teacherId, week, data) {
            if (!data || !week) return;
            const k = makeKey(teacherId, week);

            if (store.has(k)) {
                store.delete(k);
            }

            store.set(k, {
                data: cloneData(data),
                ts: now()
            });

            while (store.size > max) {
                const oldestKey = store.keys().next().value;
                if (oldestKey !== undefined) {
                    store.delete(oldestKey);
                } else {
                    break;
                }
            }
        },

        /**
         * Menghapus spesifik satu entri minggu.
         * @param {string|null} teacherId
         * @param {string} week
         */
        delete(teacherId, week) {
            store.delete(makeKey(teacherId, week));
        },

        /**
         * Mengosongkan seluruh isi cache (misal saat logout atau ganti guru).
         */
        clear() {
            store.clear();
        },

        /**
         * Mengembalikan jumlah entri aktif dalam cache.
         * @returns {number}
         */
        size() {
            return store.size;
        },

        /**
         * Memeriksa apakah data minggu masih ada dan belum expire.
         * @param {string|null} teacherId
         * @param {string} week
         * @returns {boolean}
         */
        has(teacherId, week) {
            return this.get(teacherId, week) !== null;
        }
    };
}
