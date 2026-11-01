/**
 * tests/workload-catalog-clean-naming.test.js
 *
 * Verifikasi Penyesuaian Nama Master Katalog Beban Kerja:
 * 1. Penghapusan prefix 'Tugas Tambahan: ' agar langsung ke inti nama kegiatan.
 * 2. Perubahan Upacara Bendera menjadi 'Upacara Bendera / Apel Pagi (selain Senin)'.
 * 3. Sanitasi otomatis pada getCachedWorkloadCatalog & setCachedWorkloadCatalog.
 * 4. Logika sinkronisasi dan migrasi otomatis di cloudflare/worker.js.
 */

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

describe('Workload Activity Catalog - Clean Naming & Monday Upacara Separation', () => {
    const catalogDataPath = path.join(rootDir, 'js', 'workload-catalog-data.js');
    const workerJsPath = path.join(rootDir, 'cloudflare', 'worker.js');
    const migrationSqlPath = path.join(rootDir, 'cloudflare', 'migrations', '202610110001_remove_tugas_tambahan_prefix_and_update_upacara.sql');

    const catalogDataContent = fs.readFileSync(catalogDataPath, 'utf8');
    const workerJsContent = fs.readFileSync(workerJsPath, 'utf8');
    const migrationSqlContent = fs.readFileSync(migrationSqlPath, 'utf8');

    test('1. workload-catalog-data.js tidak memuat prefix "Tugas Tambahan: " di STANDARD_WORKLOAD_CATALOG', () => {
        expect(catalogDataContent).not.toMatch(/name:\s*["']Tugas Tambahan:/);
        expect(catalogDataContent).toContain('name: "Wakil Kepala Sekolah (Waka)"');
        expect(catalogDataContent).toContain('name: "Wali Kelas SMA"');
        expect(catalogDataContent).toContain('name: "Guru Piket Sekolah"');
        expect(catalogDataContent).toContain('name: "Pembina OSIS / MPK"');
        expect(catalogDataContent).toContain('name: "Koordinator MGMP Kabupaten / Gugus"');
    });

    test('2. Kegiatan Upacara Bendera di katalog dinamai "Upacara Bendera / Apel Pagi (selain Senin)"', () => {
        expect(catalogDataContent).toContain('name: "Upacara Bendera / Apel Pagi (selain Senin)"');
        expect(catalogDataContent).toContain('di luar hari Senin');
        expect(workerJsContent).toContain('name: "Upacara Bendera / Apel Pagi (selain Senin)"');
    });

    test('3. cloudflare/worker.js STANDARD_WORKLOAD_CATALOG bebas dari prefix "Tugas Tambahan: "', () => {
        expect(workerJsContent).not.toMatch(/name:\s*["']Tugas Tambahan:/);
        expect(workerJsContent).toContain('name: "Wakil Kepala Sekolah (Waka)"');
        expect(workerJsContent).toContain('name: "Wali Kelas SMA"');
        expect(workerJsContent).toContain('name: "Guru Piket Sekolah"');
    });

    test('4. ensureWorkloadActivityCatalog di cloudflare/worker.js memiliki logic pembersihan nama lama di D1', () => {
        expect(workerJsContent).toContain("name LIKE 'Tugas Tambahan:%'");
        expect(workerJsContent).toContain("UPDATE activity_catalog SET name = SUBSTR(name, 17) WHERE name LIKE 'Tugas Tambahan: %'");
        expect(workerJsContent).toContain("UPDATE activity_catalog SET name = 'Upacara Bendera / Apel Pagi (selain Senin)'");
    });

    test('5. File migrasi SQL 202610110001_remove_tugas_tambahan_prefix_and_update_upacara.sql tersedia dan valid', () => {
        expect(migrationSqlContent).toContain("UPDATE activity_catalog \nSET name = SUBSTR(name, 17)");
        expect(migrationSqlContent).toContain("UPDATE activity_catalog \nSET name = 'Upacara Bendera / Apel Pagi (selain Senin)'");
    });

    test('6. getCachedWorkloadCatalog & setCachedWorkloadCatalog di js/workload-catalog-data.js memiliki pembersihan regex', () => {
        expect(catalogDataContent).toContain("name.replace(/^Tugas Tambahan:\\s*/i, '')");
        expect(catalogDataContent).toContain("name === 'Upacara Bendera / Apel Pagi (Hari Senin)'");
    });
});
