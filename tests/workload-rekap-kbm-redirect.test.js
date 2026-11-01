/**
 * @jest-environment jsdom
 */

/**
 * tests/workload-rekap-kbm-redirect.test.js
 * ====================================================================
 * Test Suite: Verifikasi Ketersediaan Fitur Cetak Laporan KBM Langsung
 * di Tab Rekap Realisasi & Preservasi Tautan Menuju Jurnal Mengajar
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Cetak Laporan KBM Langsung & Tautan Jurnal Mengajar', () => {
    const root = path.resolve(__dirname, '..');
    const jsPath = path.join(root, 'js', 'page-beban-kerja.js');
    const htmlPath = path.join(root, 'e-kinerja.html');
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    describe('1. Verifikasi Integritas Cetak Laporan KBM Tanpa Pengalihan Paksa', () => {
        test('workloadOpenCategoryReport dan workloadOpenSubActivityReport membuka modal cetak tanpa redirect halaman', () => {
            // Memastikan tidak ada pengalihan paksa window.location.href di dalam workloadOpenCategoryReport
            const catReportRegex = /export function workloadOpenCategoryReport\(catCode\)\s*\{[\s\S]*?openReportModal/;
            expect(jsContent).toMatch(catReportRegex);
            expect(jsContent).not.toMatch(/export function workloadOpenCategoryReport\(catCode\)\s*\{[\s\S]*?window\.location\.href\s*=\s*'guru-mapel\.html\?tab=jurnal';/);

            // Memastikan tidak ada pengalihan paksa di dalam workloadOpenSubActivityReport
            const subReportRegex = /export function workloadOpenSubActivityReport\(catCode,\s*subCatalogId\)\s*\{[\s\S]*?openReportModal/;
            expect(jsContent).toMatch(subReportRegex);
            expect(jsContent).not.toMatch(/export function workloadOpenSubActivityReport\(catCode,\s*subCatalogId\)[\s\S]*?window\.location\.href\s*=\s*'guru-mapel\.html\?tab=jurnal';/);
        });

        test('Fungsi openReportModal mengaktifkan visibilitas tombol tautan Jurnal Mapel jika kategori KBM', () => {
            expect(jsContent).toContain("el('rekap-print-kbm-jurnal-link')");
            expect(jsContent).toContain("_rekapActiveCategoryCode === 'PELAKSANAAN_KBM'");
            expect(jsContent).toContain("kbmLinkBtn.classList.remove('hidden')");
        });
    });

    describe('2. Verifikasi Preservasi Tautan Menuju Jurnal Mengajar Guru Mapel', () => {
        test('Modal cetak estetik di e-kinerja.html menyediakan tombol link #rekap-print-kbm-jurnal-link menuju guru-mapel.html?tab=jurnal', () => {
            expect(htmlContent).toContain('id="rekap-print-kbm-jurnal-link"');
            expect(htmlContent).toContain('href="guru-mapel.html?tab=jurnal"');
            expect(htmlContent).toContain('target="_blank"');
        });

        test('Kartu sub-kegiatan KBM pada renderRekapUI menyediakan tombol langsung Jurnal Mengajar', () => {
            expect(jsContent).toContain('isKbmSub');
            expect(jsContent).toContain('href="guru-mapel.html?tab=jurnal"');
            expect(jsContent).toContain('Jurnal Mengajar');
        });

        test('Header kartu kategori bersih tanpa tombol cetak yang tidak diminta', () => {
            // Header kartu kategori hanya memuat judul, badge statistik, dan toggle chevron
            expect(jsContent).not.toMatch(/onclick="event\.stopPropagation\(\);\s*window\.workloadOpenCategoryReport/);
        });
    });
});
