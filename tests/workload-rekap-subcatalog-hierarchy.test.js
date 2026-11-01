/**
 * @jest-environment jsdom
 */

/**
 * tests/workload-rekap-subcatalog-hierarchy.test.js
 * ====================================================================
 * Test Suite: Verifikasi Hierarki Accordion Bertingkat Per Sub Kegiatan &
 * Pemindahan Tombol Cetak Laporan di Tab Rekap E-Kinerja Guru
 * (Permendikdasmen No. 11/2025 & Kepmendikdasmen No. 221/P/2025)
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Hierarki Accordion Sub Kegiatan & Cetak Per Sub Kegiatan', () => {
    const root = path.resolve(__dirname, '..');
    const jsPath = path.join(root, 'js', 'page-beban-kerja.js');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    describe('1. Verifikasi Penghapusan Tombol Cetak di Header Kategori Level 1', () => {
        test('Header kategori tugas pokok level 1 tidak lagi memuat tombol Cetak Laporan', () => {
            // Memeriksa blok kartu kategori utama pada cardsHtml
            const buttonCategoryRegex = /onclick="window\.workloadToggleRekapCategory\([^"]+\)"[\s\S]*?<\/button>/;
            const match = jsContent.match(buttonCategoryRegex);
            expect(match).not.toBeNull();
            if (match) {
                // Header kategori hanya boleh memuat tombol accordion toggle dan metrik, bukan tombol cetak
                expect(match[0]).not.toContain('window.workloadOpenCategoryReport');
                expect(match[0]).not.toContain('Cetak Laporan');
            }
        });
    });

    describe('2. Verifikasi Pengelompokan & Accordion Mandiri Sub Kegiatan Level 2', () => {
        test('Kegiatan dikelompokkan ke Map sub-katalog berdasarkan catalog_id', () => {
            expect(jsContent).toContain('subCatalogMap.set(scId');
            expect(jsContent).toContain('const subGroupsList = Array.from(subCatalogMap.values())');
        });

        test('State accordion sub kegiatan dikelola oleh Set _rekapExpandedSubCatalogs dengan default collapsed', () => {
            expect(jsContent).toMatch(/let\s+_rekapExpandedSubCatalogs\s*=\s*new\s+Set\(\)/);
            // Default adalah Set kosong sehingga seluruh sub-katalog berstatus tertutup (collapsed)
            expect(jsContent).toContain("const isSubExpanded = _rekapExpandedSubCatalogs.has(subCompositeKey);");
            expect(jsContent).toContain("${isSubExpanded ? 'block' : 'hidden'}");
        });

        test('Fungsi workloadToggleRekapSubCatalog diekspor dan mengelola composite key ${cat.code}__${sc.catalog_id}', () => {
            expect(jsContent).toContain('export function workloadToggleRekapSubCatalog(compositeKey)');
            expect(jsContent).toContain('_rekapExpandedSubCatalogs.has(compositeKey)');
            expect(jsContent).toContain('_rekapExpandedSubCatalogs.delete(compositeKey)');
            expect(jsContent).toContain('_rekapExpandedSubCatalogs.add(compositeKey)');
        });
    });

    describe('3. Verifikasi Tombol Cetak Laporan Per Sub Kegiatan Level 2', () => {
        test('Header sub kegiatan memuat tombol Cetak Laporan khusus untuk sub kegiatan tersebut', () => {
            expect(jsContent).toContain("window.workloadOpenSubActivityReport('${escapeHTML(cat.code)}', '${escapeHTML(sc.catalog_id)}')");
            expect(jsContent).toContain("title=\"Cetak Laporan ${escapeHTML(sc.catalog_name)}\"");
        });

        test('Fungsi workloadOpenSubActivityReport dan alias workloadOpenSubCatalogReport diekspor', () => {
            expect(jsContent).toContain('export function workloadOpenSubActivityReport(catCode, subCatalogId)');
            expect(jsContent).toContain('export function workloadOpenSubCatalogReport(catCode, subCatalogId)');
        });

        test('workloadOpenSubActivityReport menyaring _rekapSelectedActivityIds hanya untuk sub kegiatan target', () => {
            expect(jsContent).toContain('_rekapActiveSubCatalogId = subCatalogId || null;');
            expect(jsContent).toContain("allCatActivities.filter(a => (a.catalog_id || 'lainnya') === subCatalogId)");
        });

        test('renderReportActivityDrawer dan workloadToggleReportSelectAll memfilter berdasarkan _rekapActiveSubCatalogId', () => {
            expect(jsContent).toMatch(/\.filter\(a\s*=>\s*!_rekapActiveSubCatalogId\s*\|\|\s*\(a\.catalog_id\s*\|\|\s*'lainnya'\)\s*===\s*_rekapActiveSubCatalogId\)/);
            expect(jsContent).toContain('const activities = getReportScopeActivities();');
        });
    });

    describe('4. Verifikasi Penomoran Tabel Mulai Dari 1 Per Sub Kegiatan', () => {
        test('Nomor urut kegiatan di tabel sub kegiatan dimulai dari 1 (${actIdx + 1})', () => {
            expect(jsContent).toMatch(/sc\.activities\.map\(\(act,\s*actIdx\)\s*=>/);
            expect(jsContent).toContain('${actIdx + 1}');
        });
    });

    describe('5. Verifikasi Template Cetak Infografis A4 Sub Kegiatan', () => {
        test('buildAestheticCategoryReportHtml mendukung parameter subCatalogId', () => {
            expect(jsContent).toContain('subCatalogId = null');
            expect(jsContent).toContain('catDisplayName = subCatalogItem ? subCatalogItem.catalog_name : catCleanName');
            expect(jsContent).toContain('catSubDesc = subCatalogItem ? `Sub Kegiatan dari ${catCleanName}`');
        });

        test('workloadRefreshAestheticPreview meneruskan _rekapActiveSubCatalogId', () => {
            expect(jsContent).toContain('_rekapActiveSubCatalogId');
        });
    });

    describe('6. Verifikasi Global Window Bindings', () => {
        test('Fungsi-fungsi sub kegiatan diikat ke window', () => {
            expect(jsContent).toContain('window.workloadToggleRekapSubCatalog = workloadToggleRekapSubCatalog;');
            expect(jsContent).toContain('window.workloadOpenSubActivityReport = workloadOpenSubActivityReport;');
            expect(jsContent).toContain('window.workloadOpenSubCatalogReport = workloadOpenSubCatalogReport;');
        });
    });
});
