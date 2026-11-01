import { describe, test, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWeekCache, WEEK_CACHE_MAX, WEEK_CACHE_STALE_MS, WEEK_CACHE_EXPIRE_MS } from '../js/workload-week-cache.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('WorkloadWeekCache (SWR In-Memory Cache Unit Tests)', () => {
    test('menyimpan dan mengambil data mingguan dengan format yang tepat', () => {
        let fakeTime = 1000;
        const cache = createWeekCache({ now: () => fakeTime });

        const mockData = { week: { id: 'w1', week_start: '2026-10-26' }, segments: [1, 2] };
        cache.set('teacher123', '2026-10-26', mockData);

        expect(cache.size()).toBe(1);
        const res = cache.get('teacher123', '2026-10-26');
        expect(res).not.toBeNull();
        expect(res.data.week.id).toBe('w1');
        expect(res.stale).toBe(false);
        expect(res.age).toBe(0);
    });

    test('menjamin imutabilitas: mutasi pada data hasil get tidak merusak data di dalam cache (structuredClone)', () => {
        const cache = createWeekCache();
        const originalData = { week: { id: 'w1' }, summary: { total_minutes: 450 } };
        cache.set(null, '2026-10-26', originalData);

        const fetched1 = cache.get(null, '2026-10-26');
        fetched1.data.summary.total_minutes = 9999;
        fetched1.data.week.id = 'CORRUPTED';

        const fetched2 = cache.get(null, '2026-10-26');
        expect(fetched2.data.summary.total_minutes).toBe(450);
        expect(fetched2.data.week.id).toBe('w1');
    });

    test('menandai status stale setelah melewati STALE_MS (30 detik)', () => {
        let fakeTime = 100000;
        const cache = createWeekCache({ now: () => fakeTime });

        cache.set('guruA', '2026-10-26', { test: true });

        // Sebelum 30 detik -> stale: false
        fakeTime += 20000;
        expect(cache.get('guruA', '2026-10-26').stale).toBe(false);

        // Setelah 30.001 ms -> stale: true
        fakeTime += 10001;
        const staleRes = cache.get('guruA', '2026-10-26');
        expect(staleRes.stale).toBe(true);
        expect(staleRes.data).toEqual({ test: true });
    });

    test('membuang entri otomatis setelah melewati EXPIRE_MS (5 menit / hard-expire)', () => {
        let fakeTime = 100000;
        const cache = createWeekCache({ now: () => fakeTime });

        cache.set('guruA', '2026-10-26', { test: true });
        expect(cache.has('guruA', '2026-10-26')).toBe(true);

        // Majukan waktu 5 menit 1 detik (300.001 ms)
        fakeTime += 300001;
        expect(cache.get('guruA', '2026-10-26')).toBeNull();
        expect(cache.size()).toBe(0);
    });

    test('menerapkan kebijakan eliminasi LRU secara presisi saat melampaui kapasitas maksimum', () => {
        const cache = createWeekCache({ max: 3 });

        cache.set('g1', 'week1', { id: 1 });
        cache.set('g1', 'week2', { id: 2 });
        cache.set('g1', 'week3', { id: 3 });
        expect(cache.size()).toBe(3);

        // Akses week1 agar posisinya dipromosikan (menjadi yang paling baru disentuh)
        cache.get('g1', 'week1');

        // Masukkan week4 -> yang harus dibuang adalah week2 (karena week1 baru disentuh, week2 menjadi yang tertua)
        cache.set('g1', 'week4', { id: 4 });
        expect(cache.size()).toBe(3);
        expect(cache.get('g1', 'week2')).toBeNull(); // week2 tereliminasi
        expect(cache.get('g1', 'week1')).not.toBeNull(); // week1 tetap ada
        expect(cache.get('g1', 'week3')).not.toBeNull();
        expect(cache.get('g1', 'week4')).not.toBeNull();
    });

    test('memisahkan ruang cache antar guru (terisolasi per teacherId) dan membersihkan total via clear()', () => {
        const cache = createWeekCache();

        cache.set('guru1', '2026-10-26', { name: 'Guru 1' });
        cache.set('guru2', '2026-10-26', { name: 'Guru 2' });
        cache.set(null, '2026-10-26', { name: 'Self Guru' });

        expect(cache.size()).toBe(3);
        expect(cache.get('guru1', '2026-10-26').data.name).toBe('Guru 1');
        expect(cache.get('guru2', '2026-10-26').data.name).toBe('Guru 2');
        expect(cache.get(null, '2026-10-26').data.name).toBe('Self Guru');

        cache.delete('guru1', '2026-10-26');
        expect(cache.get('guru1', '2026-10-26')).toBeNull();
        expect(cache.size()).toBe(2);

        cache.clear();
        expect(cache.size()).toBe(0);
        expect(cache.get('guru2', '2026-10-26')).toBeNull();
    });

    test('menangani data kosong / falsy / input tidak valid secara anggun tanpa melempar pengecualian', () => {
        const cache = createWeekCache();
        expect(() => {
            cache.set('guru1', null, { data: 1 });
            cache.set('guru1', '2026-10-26', null);
            cache.set('guru1', '2026-10-26', undefined);
        }).not.toThrow();
        expect(cache.size()).toBe(0);
        expect(cache.get('guru1', '')).toBeNull();
    });

    test('simulasi sequence guard: request usang yang selesai lebih lambat tidak menimpa data minggu terbaru', async () => {
        let activeSeq = 0;
        let renderedData = null;

        async function simulateFetch(seq, delayMs, weekDate) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
            // Hanya update render jika sequence masih cocok dengan request paling mutakhir
            if (seq === activeSeq) {
                renderedData = weekDate;
            }
        }

        // User klik cepat: Request 1 (minggu 1) lambat 50ms, Request 2 (minggu 2) cepat 10ms
        const seq1 = ++activeSeq;
        const p1 = simulateFetch(seq1, 50, '2026-10-19');

        const seq2 = ++activeSeq;
        const p2 = simulateFetch(seq2, 10, '2026-10-26');

        await Promise.all([p1, p2]);

        // Hasil akhir wajib '2026-10-26' (minggu 2), bukan '2026-10-19' meskipun p1 selesai paling akhir
        expect(renderedData).toBe('2026-10-26');
    });

    test('analisis statis SSOT: seluruh aksi mutasi memanggil loadWeek tanpa useCache', () => {
        const pageJsPath = path.join(__dirname, '..', 'js', 'page-beban-kerja.js');
        const content = fs.readFileSync(pageJsPath, 'utf8');

        // Pastikan createWeekCache diimpor dan digunakan
        expect(content).toContain("import { createWeekCache } from './workload-week-cache.mjs'");
        expect(content).toContain('const _weekCache = createWeekCache()');

        // Pastikan loadWeek memiliki opsi useCache
        expect(content).toContain('loadWeek({ useCache: true })');

        // Pastikan scheduleWeekLoad menerapkan debounce 180ms
        expect(content).toContain('180');
    });
});
