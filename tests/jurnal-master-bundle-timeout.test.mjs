import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Modul asli berupa ESM browser yang mengimpor config.js (Firebase CDN); muat sumbernya dengan stub config.
function loadCloudflareApi() {
    const apiSource = fs.readFileSync(path.join(projectRoot, 'js', 'jurnal-cloudflare-api.js'), 'utf8');
    const importLine = 'import { auth, CLOUDFLARE_CONFIG } from "./config.js";';
    expect(apiSource).toContain(importLine);
    const body = apiSource
        .replace(importLine, '')
        .replace(/^export /gm, '') + '\nreturn { CloudflareAPI, fetchWithResponseTimeout };';
    return new Function('auth', 'CLOUDFLARE_CONFIG', body)(
        { currentUser: null },
        { enabled: true, workerUrl: 'https://worker.test', syncKey: '' }
    );
}

const { CloudflareAPI, fetchWithResponseTimeout } = loadCloudflareApi();

function createSessionStorage() {
    const store = {};
    return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
    };
}

function hangingFetch() {
    return jest.fn((url, opts) => new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
        });
    }));
}

const okResponse = (data) => Promise.resolve({ ok: true, status: 200, json: async () => ({ data }) });

describe('Ketahanan Master Bundle Jurnal saat koneksi ke worker menggantung', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        globalThis.sessionStorage = createSessionStorage();
        CloudflareAPI._masterBundleCache = null;
        CloudflareAPI._masterBundleCacheTime = 0;
        CloudflareAPI._masterBundleInflight = null;
        CloudflareAPI._masterBundleFailedAt = 0;
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        delete globalThis.fetch;
    });

    test('request menggantung dibatalkan dengan error Timeout, request paralel digabung', async () => {
        globalThis.fetch = hangingFetch();
        const pending = Promise.allSettled([
            CloudflareAPI.getMasterBundle(),
            CloudflareAPI.getMasterBundle(),
            CloudflareAPI.getMasterBundle()
        ]);
        await jest.advanceTimersByTimeAsync(15000);
        const results = await pending;

        expect(results.every(r => r.status === 'rejected' && /Timeout/.test(r.reason.message))).toBe(true);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    test('setelah gagal, pemanggil berikutnya langsung gagal cepat tanpa fetch ulang', async () => {
        globalThis.fetch = hangingFetch();
        const first = CloudflareAPI.getMasterBundle().catch(e => e);
        await jest.advanceTimersByTimeAsync(15000);
        await first;

        await expect(CloudflareAPI.getMasterBundle()).rejects.toThrow(/gagal dimuat/);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    test('bundle lama dipakai saat cache kedaluwarsa dan server gagal', async () => {
        globalThis.fetch = jest.fn(() => okResponse({ lokasis: [{ nama_lokasi: 'Ruang Kelas' }] }));
        await CloudflareAPI.getMasterBundle();

        CloudflareAPI._masterBundleCacheTime = 0;
        globalThis.sessionStorage.setItem(CloudflareAPI._STORAGE_TS_KEY, '0');
        globalThis.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) }));

        const bundle = await CloudflareAPI.getMasterBundle();
        expect(bundle.lokasis).toEqual([{ nama_lokasi: 'Ruang Kelas' }]);
    });

    test('pemulihan guru melewati cache memori, sesi, dan cooldown dengan refresh=1', async () => {
        const stale = { teachers: [{ id: 'lama', nama: 'Guru Lama' }] };
        const fresh = { teachers: [{ id: 'resmi', nama: 'Guru Resmi' }] };
        CloudflareAPI._masterBundleCache = stale;
        CloudflareAPI._masterBundleCacheTime = Date.now();
        CloudflareAPI._masterBundleFailedAt = Date.now();
        globalThis.sessionStorage.setItem(CloudflareAPI._STORAGE_KEY, JSON.stringify(stale));
        globalThis.sessionStorage.setItem(CloudflareAPI._STORAGE_TS_KEY, String(Date.now()));
        globalThis.fetch = jest.fn(() => okResponse(fresh));

        const bundle = await CloudflareAPI.getMasterBundle(true);
        expect(bundle).toEqual(fresh);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch.mock.calls[0][0]).toBe('https://worker.test/api/jurnal/master?refresh=1');
        expect(JSON.parse(globalThis.sessionStorage.getItem(CloudflareAPI._STORAGE_KEY))).toEqual(fresh);
    });

    test('pemulihan paksa yang gagal tidak mengembalikan bundle lama sebagai hasil verifikasi segar', async () => {
        CloudflareAPI._masterBundleCache = { teachers: [{ nama: 'Guru Lama' }] };
        globalThis.fetch = jest.fn().mockRejectedValue(new Error('offline'));
        await expect(CloudflareAPI.getMasterBundle(true)).rejects.toThrow('offline');
    });

    test('getStudents menggantung dibatalkan dengan error Timeout', async () => {
        globalThis.fetch = hangingFetch();
        const pending = CloudflareAPI.getStudents('XII-1').catch(e => e);
        await jest.advanceTimersByTimeAsync(15000);
        expect((await pending).message).toMatch(/Timeout/);
    });

    test('fetchWithResponseTimeout memakai batas waktu kustom', async () => {
        globalThis.fetch = hangingFetch();
        const pending = fetchWithResponseTimeout('https://supabase.test/rest/v1/siswa_presensi', {}, 8000).catch(e => e);
        await jest.advanceTimersByTimeAsync(8000);
        expect((await pending).message).toMatch(/Timeout 8 detik/);
    });

    test('ensureMasterData memulihkan cache guru/mapel/lokasi lama saat bundle gagal', () => {
        const pageJurnalJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-jurnal.js'), 'utf8');
        expect(pageJurnalJs).toContain("data_lokasi: CacheHelper.get('data_lokasi', Infinity)");
        expect(pageJurnalJs).toMatch(/if \(!fetchedBundle\) \{\s*let restoredStale = false;/);
    });

    test('autoPreFillDailyAttendance tidak memakai fetch tanpa batas waktu', () => {
        const pageJurnalJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-jurnal.js'), 'utf8');
        const start = pageJurnalJs.indexOf('async function autoPreFillDailyAttendance(');
        const end = pageJurnalJs.indexOf('\n}\n', start);
        const fnSource = pageJurnalJs.slice(start, end);

        expect(fnSource.match(/await fetchWithTimeout\(/g)).toHaveLength(2);
        expect(fnSource).not.toMatch(/await fetch\(/);
        expect(pageJurnalJs).toMatch(/async function fetchWithTimeout\(url, options = \{\}, timeoutMs\)/);
    });

    test('page-jurnal.js hanya mengimpor CloudflareAPI (file API tak berversi bisa tersaji lama dari cache SW)', () => {
        const pageJurnalJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-jurnal.js'), 'utf8');
        expect(pageJurnalJs).toContain('import { CloudflareAPI } from "./jurnal-cloudflare-api.js";');
    });
});
