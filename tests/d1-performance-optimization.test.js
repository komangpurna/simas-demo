/**
 * tests/d1-performance-optimization.test.js
 * ====================================================================
 * Test Suite: Verifikasi Optimasi Performa Cloudflare D1 & Non-Regresi UI/UX
 * Memverifikasi:
 * 1. Optimasi runtime activity_catalog (Module guard, count check, batching)
 * 2. Parameter selektif exclude_ttd pada GET /api/jurnal (hemat payload tanpa menghapus ttd default)
 * 3. Paritas pemanggilan client di cloudflare-client.js & page-monitoring-kbm.js
 * 4. Keberadaan indeks komposit plan_time_segments pada migrasi dan schema.sql
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Optimasi Performa D1 & Perlindungan UI/UX', () => {
    const root = path.resolve(__dirname, '..');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');
    const clientJsPath = path.join(root, 'js', 'cloudflare-client.js');
    const monitoringJsPath = path.join(root, 'js', 'page-monitoring-kbm.js');
    const migrationPath = path.join(root, 'cloudflare', 'migrations', '202610070001_optimize_d1_performance_indexes.sql');
    const schemaPath = path.join(root, 'cloudflare', 'schema.sql');

    const workerJs = fs.readFileSync(workerJsPath, 'utf8');
    const clientJs = fs.readFileSync(clientJsPath, 'utf8');
    const monitoringJs = fs.readFileSync(monitoringJsPath, 'utf8');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    describe('1. Optimasi Redundan Write activity_catalog (Eliminasi 47.21% Runtime)', () => {
        test('Guard _workloadCatalogSeeded dideklarasikan di module scope di luar fetch handler', () => {
            const fetchPos = workerJs.indexOf('async fetch(request, env, ctx)');
            const guardPos = workerJs.indexOf('let _workloadCatalogSeeded = false;');
            expect(guardPos).toBeGreaterThan(-1);
            expect(guardPos).toBeLessThan(fetchPos);
        });

        test('ensureWorkloadActivityCatalog mengecek count activity_catalog sebelum melakukan write', () => {
            expect(workerJs).toContain('SELECT count(*) as cnt FROM activity_catalog LIMIT 1');
            expect(workerJs).toContain('existingCnt >= 30');
            expect(workerJs).toContain('db.batch(stmts)');
        });
    });

    describe('2. Optimasi Kueri Jurnal Tanpa Mengurangi UI/UX Paraf', () => {
        test('GET /api/jurnal membaca parameter exclude_ttd', () => {
            expect(workerJs).toContain('const excludeTtd = url.searchParams.get("exclude_ttd") === "1" || url.searchParams.get("exclude_ttd") === "true";');
        });

        test('GET /api/jurnal memproyeksikan kolom tanpa ttd jika exclude_ttd aktif, namun tetap memakai * sebagai default', () => {
            expect(workerJs).toContain('const selectCols = excludeTtd');
            expect(workerJs).toContain('id, tanggal, kelas, guru, uid_guru, mapel, topik, catatan, jp, lokasi_mengajar, foto_url, koordinat, presensi_detail, created_at, updated_at');
            expect(workerJs).toContain('let sql = `SELECT ${selectCols} FROM jurnal_guru WHERE 1=1`;');
        });

        test('parsedData tetap menyertakan properti ttd dengan fallback null untuk konsistensi object shape', () => {
            expect(workerJs).toContain('ttd: row.ttd || null,');
        });
    });

    describe('3. Integrasi Frontend Client & Modul Monitoring KBM', () => {
        test('cloudflare-client.js mendukung parameter excludeTtd dan meneruskannya ke query param', () => {
            expect(clientJs).toContain('if (filters.excludeTtd || filters.exclude_ttd) params.append(\'exclude_ttd\', \'1\');');
        });

        test('page-monitoring-kbm.js menyertakan excludeTtd: true pada query jurnal massal', () => {
            expect(monitoringJs).toContain('excludeTtd: true');
        });
    });

    describe('4. Indeks Performa Beban Kerja Guru (plan_time_segments)', () => {
        test('File migrasi 202610070001 memuat indeks idx_plan_seg_ver_date_start', () => {
            expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_plan_seg_ver_date_start ON plan_time_segments(plan_version_id, date ASC, start_time ASC);');
        });

        test('Schema master D1 memuat indeks idx_plan_seg_ver_date_start', () => {
            expect(schemaSql).toContain('CREATE INDEX IF NOT EXISTS idx_plan_seg_ver_date_start ON plan_time_segments(plan_version_id, date ASC, start_time ASC);');
        });
    });
});
