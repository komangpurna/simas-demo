/**
 * =========================================================================
 * SIMAS - Jurnal Mengajar Cloudflare D1 & Worker Client API
 * Module: Edge Database RW Integration for Jurnal Mengajar
 * =========================================================================
 */
import { auth, CLOUDFLARE_CONFIG } from "./config.js";

const DEFAULT_WORKER_URL = "https://simas-demo-api.komangpurna1.workers.dev";

// Batas tunggu respons awal (header) untuk request baca. Tanpa ini, koneksi seluler yang
// menggantung membuat form jurnal macet di "Memuat Lokasi..." tanpa pernah masuk fallback.
const READ_RESPONSE_TIMEOUT_MS = 15000;
// Setelah master bundle gagal, pemanggil berikutnya langsung memakai fallback (tidak menunggu timeout berulang)
const MASTER_BUNDLE_RETRY_COOLDOWN_MS = 30000;

async function fetchWithResponseTimeout(url, options = {}, timeoutMs = READ_RESPONSE_TIMEOUT_MS) {
    if (typeof AbortController === 'undefined') return fetch(url, options);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
        if (err && err.name === 'AbortError') {
            throw new Error(`Timeout ${timeoutMs / 1000} detik menunggu respons server`);
        }
        throw err;
    } finally {
        // Timer hanya menjaga fase menunggu header; unduhan body yang sudah berjalan tidak diputus
        clearTimeout(timer);
    }
}

export const CloudflareAPI = {
    get baseUrl() {
        const raw = (CLOUDFLARE_CONFIG && CLOUDFLARE_CONFIG.workerUrl) ? CLOUDFLARE_CONFIG.workerUrl : DEFAULT_WORKER_URL;
        return raw.replace(/\/+$/, '');
    },

    get isEnabled() {
        return Boolean(CLOUDFLARE_CONFIG && CLOUDFLARE_CONFIG.enabled !== false);
    },

    async getHeaders() {
        const headers = {
            "Content-Type": "application/json",
            "X-Simas-Client": "web-v1"
        };
        if (CLOUDFLARE_CONFIG && CLOUDFLARE_CONFIG.syncKey) {
            headers["X-Api-Key"] = CLOUDFLARE_CONFIG.syncKey;
            headers["X-Sync-Key"] = CLOUDFLARE_CONFIG.syncKey;
        }
        try {
            if (auth && auth.currentUser) {
                const token = await auth.currentUser.getIdToken();
                if (token) {
                    headers["Authorization"] = `Bearer ${token}`;
                }
            }
        } catch (e) {
            console.warn("[CloudflareAPI] Gagal mengambil Firebase Auth Token:", e);
        }
        return headers;
    },

    _masterBundleCache: null,
    _masterBundleCacheTime: 0,
    _CACHE_TTL_MS: 15 * 60 * 1000, // 15 Menit client-side cache
    _STORAGE_KEY: "simas_jurnal_bundle_v1",
    _STORAGE_TS_KEY: "simas_jurnal_bundle_ts_v1",
    _masterBundleInflight: null,
    _masterBundleFailedAt: 0,

    /**
     * Bundle terakhir yang pernah berhasil (abaikan TTL), dipakai hanya bila server tidak bisa dihubungi.
     */
    _getStaleMasterBundle() {
        if (this._masterBundleCache) return this._masterBundleCache;
        if (typeof sessionStorage !== 'undefined') {
            try {
                const storedData = sessionStorage.getItem(this._STORAGE_KEY);
                if (storedData) return JSON.parse(storedData);
            } catch (e) {}
        }
        return null;
    },

    /**
     * Mengambil Master Bundle SSOT (Daftar Kelas, Guru, Mapel, Lokasi, Config, Motivasi)
     * Dilengkapi Client-Side Memory & Session Storage Caching untuk menghemat bandwidth & kuota D1.
     * Request paralel digabung menjadi satu, dan kegagalan jaringan memakai bundle lama bila ada.
     */
    async getMasterBundle(forceRefresh = false) {
        if (!this.isEnabled) throw new Error("Cloudflare D1 disabled in config");
        if (forceRefresh) return this._fetchMasterBundle(true);

        const now = Date.now();
        if (this._masterBundleCache && (now - this._masterBundleCacheTime < this._CACHE_TTL_MS)) {
            return this._masterBundleCache;
        }
        if (this._masterBundleInflight) return this._masterBundleInflight;

        if (this._masterBundleFailedAt && (now - this._masterBundleFailedAt < MASTER_BUNDLE_RETRY_COOLDOWN_MS)) {
            const stale = this._getStaleMasterBundle();
            if (stale) return stale;
            throw new Error("Master bundle baru saja gagal dimuat, memakai data lokal");
        }

        const request = this._fetchMasterBundle(false);
        this._masterBundleInflight = request;
        try {
            return await request;
        } catch (err) {
            const stale = this._getStaleMasterBundle();
            if (stale) {
                console.warn("[CloudflareAPI] Master bundle gagal dimuat, memakai bundle lama:", err);
                return stale;
            }
            throw err;
        } finally {
            if (this._masterBundleInflight === request) this._masterBundleInflight = null;
        }
    },

    async _fetchMasterBundle(forceRefresh = false) {
        if (!this.isEnabled) throw new Error("Cloudflare D1 disabled in config");
        const now = Date.now();

        // 1. Memory cache check
        if (!forceRefresh && this._masterBundleCache && (now - this._masterBundleCacheTime < this._CACHE_TTL_MS)) {
            return this._masterBundleCache;
        }

        // 2. SessionStorage cache check (menghindari fetch saat navigasi / refresh tab)
        if (!forceRefresh && typeof sessionStorage !== 'undefined') {
            try {
                const storedTs = sessionStorage.getItem(this._STORAGE_TS_KEY);
                const storedData = sessionStorage.getItem(this._STORAGE_KEY);
                if (storedTs && storedData && (now - Number(storedTs) < this._CACHE_TTL_MS)) {
                    const parsed = JSON.parse(storedData);
                    this._masterBundleCache = parsed;
                    this._masterBundleCacheTime = Number(storedTs);
                    return parsed;
                }
            } catch (e) {}
        }

        let json;
        try {
            const headers = await this.getHeaders();
            const url = `${this.baseUrl}/api/jurnal/master${forceRefresh ? '?refresh=1' : ''}`;
            const resp = await fetchWithResponseTimeout(url, {
                method: "GET",
                headers
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching master bundle`);
            json = await resp.json();
        } catch (err) {
            this._masterBundleFailedAt = Date.now();
            throw err;
        }
        this._masterBundleFailedAt = 0;
        const data = json.data || {};
        this._masterBundleCache = data;
        this._masterBundleCacheTime = now;

        if (typeof sessionStorage !== 'undefined') {
            try {
                sessionStorage.setItem(this._STORAGE_KEY, JSON.stringify(data));
                sessionStorage.setItem(this._STORAGE_TS_KEY, String(now));
            } catch (e) {}
        }

        return data;
    },

    /**
     * Membersihkan cache master bundle di browser jika diperlukan (misal pasca sync)
     */
    clearMasterBundleCache() {
        this._masterBundleCache = null;
        this._masterBundleCacheTime = 0;
        if (typeof sessionStorage !== 'undefined') {
            try {
                sessionStorage.removeItem(this._STORAGE_KEY);
                sessionStorage.removeItem(this._STORAGE_TS_KEY);
            } catch (e) {}
        }
    },

    /**
     * Mengambil Data Siswa per Kelas dari Cloudflare D1
     */
    async getStudents(className) {
        if (!this.isEnabled) throw new Error("Cloudflare D1 disabled in config");
        const qs = className ? `class=${encodeURIComponent(className)}&status=active` : 'status=active';
        const headers = await this.getHeaders();
        const resp = await fetchWithResponseTimeout(`${this.baseUrl}/api/sync/jurnal-students?${qs}`, {
            method: "GET",
            headers
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching students from D1`);
        const json = await resp.json();
        return (json && Array.isArray(json.data)) ? json.data : [];
    },

    /**
     * Mengambil Daftar Rekap Jurnal KBM (Filter tanggal, rentang tanggal, kelas, guru, mapel)
     */
    async getRecap(params = {}) {
        if (!this.isEnabled) throw new Error("Cloudflare D1 disabled in config");
        const cleanParams = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== "") cleanParams.append(k, v);
        });
        const headers = await this.getHeaders();
        const resp = await fetch(`${this.baseUrl}/api/jurnal?${cleanParams.toString()}`, {
            method: "GET",
            headers
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching recap from D1`);
        const json = await resp.json();
        return (json && Array.isArray(json.data)) ? json.data : [];
    },

    /**
     * Mengambil Riwayat Pembelajaran (Placeholder topik terakhir / Presensi pertemuan sebelumnya / 5 topik terbaru)
     */
    async getHistory(params = {}) {
        if (!this.isEnabled) throw new Error("Cloudflare D1 disabled in config");
        const cleanParams = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== "") cleanParams.append(k, v);
        });
        const headers = await this.getHeaders();
        const resp = await fetch(`${this.baseUrl}/api/jurnal/history?${cleanParams.toString()}`, {
            method: "GET",
            headers
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching history from D1`);
        const json = await resp.json();
        return json.data !== undefined ? json.data : null;
    },

    /**
     * Menyimpan Entri Jurnal Mengajar Baru ke Cloudflare D1
     */
    async saveJurnal(payload) {
        if (!this.isEnabled) throw new Error("Cloudflare D1 disabled in config");
        const headers = await this.getHeaders();
        const resp = await fetch(`${this.baseUrl}/api/jurnal`, {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
        });
        const result = await resp.json();
        if (!resp.ok) {
            const err = new Error(result.error || `HTTP ${resp.status} saving journal to D1`);
            err.response = result;
            err.isDuplicate = result.duplicate === true;
            throw err;
        }
        return result;
    },

    /**
     * Memperbarui Entri Jurnal Mengajar yang Diedit ke Cloudflare D1
     */
    async updateJurnal(id, payload) {
        if (!this.isEnabled) throw new Error("Cloudflare D1 disabled in config");
        const headers = await this.getHeaders();
        const resp = await fetch(`${this.baseUrl}/api/jurnal/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers,
            body: JSON.stringify(payload)
        });
        const result = await resp.json();
        if (!resp.ok) {
            const err = new Error(result.error || `HTTP ${resp.status} updating journal in D1`);
            err.response = result;
            throw err;
        }
        return result;
    },

    /**
     * Menghapus Satu atau Beberapa Entri Jurnal di Cloudflare D1
     */
    async deleteJurnal(idOrIds) {
        if (!this.isEnabled) throw new Error("Cloudflare D1 disabled in config");
        const isArray = Array.isArray(idOrIds);
        const url = isArray ? `${this.baseUrl}/api/jurnal` : `${this.baseUrl}/api/jurnal/${encodeURIComponent(idOrIds)}`;
        const headers = await this.getHeaders();
        const options = {
            method: "DELETE",
            headers
        };
        if (isArray) {
            options.body = JSON.stringify({ ids: idOrIds });
        }
        const resp = await fetch(url, options);
        const result = await resp.json();
        if (!resp.ok) {
            throw new Error(result.error || `HTTP ${resp.status} deleting journal from D1`);
        }
        return result;
    },

    /**
     * Sinkronisasi Master Mapel, Lokasi, Guru, atau Konfigurasi ke Cloudflare D1
     */
    async syncMaster(payload) {
        if (!this.isEnabled) throw new Error("Cloudflare D1 disabled in config");
        const headers = await this.getHeaders();
        const resp = await fetch(`${this.baseUrl}/api/jurnal/master/sync`, {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
        });
        const result = await resp.json();
        if (!resp.ok) {
            throw new Error(result.error || `HTTP ${resp.status} syncing master data to D1`);
        }
        this.clearMasterBundleCache();
        return result;
    },

    /**
     * Migrasi Batch Data Jurnal Historis dari Firestore ke Cloudflare D1
     */
    async migrateJournals(journals) {
        if (!this.isEnabled) throw new Error("Cloudflare D1 disabled in config");
        const headers = await this.getHeaders();
        const resp = await fetch(`${this.baseUrl}/api/migrate/jurnal`, {
            method: "POST",
            headers,
            body: JSON.stringify({ journals })
        });
        const result = await resp.json();
        if (!resp.ok) {
            throw new Error(result.error || `HTTP ${resp.status} migrating journals to D1`);
        }
        return result;
    }
};
