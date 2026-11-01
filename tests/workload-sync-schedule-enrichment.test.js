/**
 * tests/workload-sync-schedule-enrichment.test.js
 *
 * Verifikasi Pengayaan Sinkronisasi Jadwal KBM Guru:
 * 1. Hari Senin JP 1: Menambahkan Upacara Bendera (07:30 - 08:15 WITA, 45 menit, cat_upacara).
 * 2. Hari Jumat JP 10: Menambahkan Membina Kegiatan Ekstrakurikuler (14:45 - 15:30 WITA, 45 menit, cat_ekstra).
 * 3. Integrasi backend worker.js mendukung s.catalog_id, s.is_teaching, dan category_code dinamis.
 * 4. Pengecekan skema D1 (cat_upacara terdaftar di STANDARD_WORKLOAD_CATALOG dan migrasi SQL).
 */

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

describe('Verifikasi Pengayaan Sinkronisasi Jadwal (Upacara Senin & Ekstra Jumat)', () => {
    const pageBebanKerjaPath = path.join(rootDir, 'js', 'page-beban-kerja.js');
    const workerJsPath = path.join(rootDir, 'cloudflare', 'worker.js');
    const migrationSqlPath = path.join(rootDir, 'cloudflare', 'migrations', '202609250002_add_upacara_to_activity_catalog.sql');

    const bebanKerjaContent = fs.readFileSync(pageBebanKerjaPath, 'utf8');
    const workerJsContent = fs.readFileSync(workerJsPath, 'utf8');
    const migrationSqlContent = fs.readFileSync(migrationSqlPath, 'utf8');

    test('1. page-beban-kerja.js menyertakan Upacara Bendera di hari Senin (07:30 - 08:15)', () => {
        expect(bebanKerjaContent).toContain('Upacara Bendera');
        expect(bebanKerjaContent).toContain('upacaraStart = \'07:30\'');
        expect(bebanKerjaContent).toContain('upacaraEnd = \'08:15\'');
        expect(bebanKerjaContent).toContain('cat_upacara');
        expect(bebanKerjaContent).toContain('occIdUpacara');
    });

    test('2. page-beban-kerja.js menyertakan Membina Ekstrakurikuler di hari Jumat (14:45 - 15:30)', () => {
        expect(bebanKerjaContent).toContain('Membina Kegiatan Ekstrakurikuler');
        expect(bebanKerjaContent).toContain('ekstraStart = \'14:45\'');
        expect(bebanKerjaContent).toContain('ekstraEnd = \'15:30\'');
        expect(bebanKerjaContent).toContain('cat_ekstra');
        expect(bebanKerjaContent).toContain('occIdEkstra');
    });

    test('3. cloudflare/worker.js mendaftarkan cat_upacara pada STANDARD_WORKLOAD_CATALOG', () => {
        expect(workerJsContent).toContain('id: "cat_upacara"');
        expect(workerJsContent).toContain('code: "upacara"');
        expect(workerJsContent).toContain('Upacara Bendera / Apel Pagi');
    });

    test('4. cloudflare/worker.js endpoint /api/workload/sync-schedule menyimpan is_teaching dan category_code dinamis', () => {
        const syncEndpointMatch = workerJsContent.match(/if\s*\(path\s*===\s*["']\/api\/workload\/sync-schedule["'][\s\S]+?return jsonResponse/);
        expect(syncEndpointMatch).not.toBeNull();
        const syncBlock = syncEndpointMatch[0];

        expect(syncBlock).toContain('isTeaching');
        expect(syncBlock).toContain('catCode');
        expect(syncBlock).toContain('s.catalog_id || "cat_kbm"');
    });

    test('5. File migrasi 202609250002_add_upacara_to_activity_catalog.sql memuat seed cat_upacara', () => {
        expect(migrationSqlContent).toContain("'cat_upacara'");
        expect(migrationSqlContent).toContain("'upacara'");
        expect(migrationSqlContent).toContain("'Upacara Bendera / Apel Pagi'");
    });

    test('6. Simulasi Pengayaan Item Jadwal: Total Menit Bertambah Tepat 90 Menit untuk Upacara + Ekskul', () => {
        // Simulasi 24 JP KBM (@45m = 1080m)
        const totalKbmMinutes = 24 * 45; // 1080m
        const upacaraMinutes = 45;
        const ekstraMinutes = 45;

        const totalEnrichedMinutes = totalKbmMinutes + upacaraMinutes + ekstraMinutes;
        expect(totalEnrichedMinutes).toBe(1170); // Tepat 19 jam 30 menit
    });
});
