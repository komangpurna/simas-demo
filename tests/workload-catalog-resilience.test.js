/**
 * tests/workload-catalog-resilience.test.js
 *
 * Pengujian Ketahanan Master Katalog & Resolusi Sub-Kegiatan Beban Kerja Guru
 * Mencegah Galat "Tidak ada sub-kegiatan yang cocok" dan Banjir Galat CSP
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Ketahanan Master Katalog & Pencegahan Galat Sub-Kegiatan E-Kinerja', () => {
    const rootDir = path.resolve(__dirname, '..');
    const catalogDataPath = path.join(rootDir, 'js', 'workload-catalog-data.js');
    const pageBebanKerjaPath = path.join(rootDir, 'js', 'page-beban-kerja.js');
    const dataHolidaysPath = path.join(rootDir, 'js', 'data-holidays.js');
    const firebaseJsonPath = path.join(rootDir, 'firebase.json');

    const catalogDataContent = fs.readFileSync(catalogDataPath, 'utf8');
    const pageBebanKerjaContent = fs.readFileSync(pageBebanKerjaPath, 'utf8');
    const dataHolidaysContent = fs.readFileSync(dataHolidaysPath, 'utf8');
    const firebaseJsonContent = fs.readFileSync(firebaseJsonPath, 'utf8');

    test('1. js/workload-catalog-data.js menyediakan STANDARD_WORKLOAD_CATALOG lengkap dengan 5 tugas pokok Permendikdasmen 11/2025', () => {
        expect(catalogDataContent).toContain('export const STANDARD_WORKLOAD_CATALOG');
        expect(catalogDataContent).toContain('getCachedWorkloadCatalog');
        expect(catalogDataContent).toContain('setCachedWorkloadCatalog');

        // Pastikan seluruh 5 unsur Permen 11/2025 tercakup
        expect(catalogDataContent).toContain('PERENCANAAN');
        expect(catalogDataContent).toContain('PELAKSANAAN_KBM');
        expect(catalogDataContent).toContain('PENILAIAN');
        expect(catalogDataContent).toContain('PEMBIMBINGAN');
        expect(catalogDataContent).toContain('TUGAS_TAMBAHAN');

        // Pastikan sub-kegiatan Membimbing dan Melatih Murid (PEMBIMBINGAN) lengkap
        expect(catalogDataContent).toContain('cat_bimbing_guru_wali');
        expect(catalogDataContent).toContain('cat_bimbing_p5');
        expect(catalogDataContent).toContain('cat_ekstra');
        expect(catalogDataContent).toContain('cat_bimbing_lomba');
    });

    test('2. js/page-beban-kerja.js menginisialisasi _catalog dengan getCachedWorkloadCatalog() sehingga 0ms siap tanpa menunggu fetch', () => {
        expect(pageBebanKerjaContent).toContain('import {');
        expect(pageBebanKerjaContent).toContain('getCachedWorkloadCatalog');
        expect(pageBebanKerjaContent).toContain('let _catalog = getCachedWorkloadCatalog();');
    });

    test('3. getFilteredCatalogByDuty di page-beban-kerja.js memiliki fallback aman ke STANDARD_WORKLOAD_CATALOG jika _catalog kosong', () => {
        expect(pageBebanKerjaContent).toContain('const baseCatalog = (_catalog && _catalog.length > 0) ? _catalog : STANDARD_WORKLOAD_CATALOG;');
    });

    test('4. renderPlanCatalogCustomOptions dan renderLogCatalogCustomOptions menampilkan tombol reset pencarian saat hasil kosong', () => {
        expect(pageBebanKerjaContent).toContain('window.workloadResetPlanCatalogSearch()');
        expect(pageBebanKerjaContent).toContain('window.workloadResetLogCatalogSearch()');
        expect(pageBebanKerjaContent).toContain('Tampilkan Semua Sub-Kegiatan');
    });

    test('5. onFilterPlanCatalog dan onFilterLogCatalog mengabaikan teks placeholder agar tidak memfilter kosong', () => {
        expect(pageBebanKerjaContent).toContain('const placeholder = (searchInput?.getAttribute(\'placeholder\') || \'\').trim().toLowerCase();');
        expect(pageBebanKerjaContent).toContain('const q = (placeholder && rawVal.toLowerCase() === placeholder) ? \'\' : rawVal;');
    });

    test('6. firebase.json mengizinkan https://api-hari-libur.vercel.app pada connect-src CSP untuk mencegah penolakan koneksi', () => {
        const parsed = JSON.parse(firebaseJsonContent);
        const hostings = Array.isArray(parsed.hosting) ? parsed.hosting : [parsed.hosting];

        hostings.forEach(h => {
            if (h.headers) {
                const cspHeader = h.headers.flatMap(hdr => hdr.headers || []).find(x => x.key === 'Content-Security-Policy');
                if (cspHeader) {
                    expect(cspHeader.value).toContain('https://api-hari-libur.vercel.app');
                }
            }
        });
    });

    test('7. js/data-holidays.js memiliki proteksi _syncInFlight dan penyimpanan lastFetch sebelum fetch untuk mencegah badai pemanggilan (fetch storm)', () => {
        expect(dataHolidaysContent).toContain('const _syncInFlight = {};');
        expect(dataHolidaysContent).toContain('if (_syncInFlight[yearStr]) return;');
        expect(dataHolidaysContent).toContain('localStorage.setItem(lastFetchKey, String(Date.now()));');
    });

    test('8. loadAll di page-beban-kerja.js menyegarkan modal aktif saat data katalog server berhasil dimuat', () => {
        expect(pageBebanKerjaContent).toContain('refreshOpenModalCatalogIfActive()');
    });
});
