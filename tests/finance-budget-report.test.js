/**
 * Unit Test: Modul Keuangan - Sub-Tab Laporan Tahun Anggaran (Realisasi Anggaran & Pembayaran di Muka)
 * Versi: 26.09.14.11 - Agregasi 1 Siswa 1 Baris
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Modul Keuangan: Sub-Tab Laporan Tahun Anggaran', () => {
    const rootDir = path.resolve(__dirname, '..');
    const htmlFile = path.join(rootDir, 'keuangan.html');
    const jsFile = path.join(rootDir, 'js', 'page-keuangan.js');
    const prdFile = path.join(rootDir, 'PRD_SIMAS.md');
    const changelogFile = path.join(rootDir, 'CHANGELOG.md');
    const packageFile = path.join(rootDir, 'package.json');
    const configFile = path.join(rootDir, 'js', 'config.js');

    const htmlContent = fs.readFileSync(htmlFile, 'utf8');
    const jsContent = fs.readFileSync(jsFile, 'utf8');
    const prdContent = fs.readFileSync(prdFile, 'utf8');
    const changelogContent = fs.readFileSync(changelogFile, 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    const configContent = fs.readFileSync(configFile, 'utf8');

    test('1. Markup HTML keuangan.html memiliki tombol sub-tab dan filter Tahun Anggaran lengkap', () => {
        // Tombol switch mode 'budget'
        expect(htmlContent).toContain("id=\"btn-rep-budget\"");
        expect(htmlContent).toContain("window.switchReportMode('budget')");
        expect(htmlContent).toContain("Tahun Anggaran");

        // Filter container
        expect(htmlContent).toContain("id=\"filter-budget\"");
        expect(htmlContent).toContain("id=\"budget-year-select\"");
        expect(htmlContent).toContain("id=\"budget-month-select\"");
        expect(htmlContent).toContain("id=\"budget-class-select\"");
        expect(htmlContent).toContain("id=\"budget-status-select\"");

        // Tombol trigger kueri & ekspor excel
        expect(htmlContent).toContain("window.loadBudgetReport()");
        expect(htmlContent).toContain("window.exportBudgetToExcel()");
    });

    test('2. Logika JavaScript js/page-keuangan.js mengintegrasikan mode budget pada switchReportMode', () => {
        // Array tombol laporan memuat 'budget'
        expect(jsContent).toMatch(/btns\s*=\s*\[.*'budget'.*\]/);

        // Handler mode === 'budget' terdaftar
        expect(jsContent).toContain("mode === 'budget'");
        expect(jsContent).toContain("Total Realisasi Penerimaan");
        expect(jsContent).toContain("populateBudgetClassDropdown()");
        expect(jsContent).toContain("populateBudgetYearDropdown()");
    });

    test('3. Logika perhitungan loadBudgetReport membedakan status waktu bayar (Reguler, Di Muka, Susulan)', () => {
        // Fungsi terdaftar di window
        expect(jsContent).toContain("window.loadBudgetReport = async");

        // Query memfilter berdasarkan TAHUN TAGIHAN (year)
        expect(jsContent).toMatch(/q\.eq\(['"]year['"],\s*selectedYear\)/);

        // Klasifikasi cerdas pembayaran di muka (payYear < selectedYear)
        expect(jsContent).toContain("status = 'advance'");
        expect(jsContent).toContain("Dibayar di Muka");

        // Klasifikasi cerdas pelunasan susulan (payYear > selectedYear)
        expect(jsContent).toContain("status = 'late'");
        expect(jsContent).toContain("Pelunasan Susulan");

        // Klasifikasi reguler (payYear === selectedYear)
        expect(jsContent).toContain("status = 'regular'");
        expect(jsContent).toContain("Reguler");

        // Ekspor Excel resmi terdefinisi
        expect(jsContent).toContain("window.exportBudgetToExcel =");
        expect(jsContent).toContain("LAPORAN REALISASI PENERIMAAN SPP TAHUN ANGGARAN");
    });

    test('4. Agregasi 1 siswa 1 baris: grouping per NIS dan helper formatBudgetMonths', () => {
        // Helper formatBudgetMonths terdaftar di window
        expect(jsContent).toContain("window.formatBudgetMonths =");

        // Grouping transaksi per siswa via Map
        expect(jsContent).toContain("const studentGroups = new Map()");

        // Kunci grouping menggunakan NIS siswa
        expect(jsContent).toContain("const groupKey = trx.isMigration");
        expect(jsContent).toContain("trx.nis && trx.nis !== '-' ? String(trx.nis).trim()");

        // Agregasi bulan, total amount, tanggal bayar
        expect(jsContent).toContain("group.months.push(trx.month)");
        expect(jsContent).toContain("group.totalAmount += trx.amount");
        expect(jsContent).toContain("group.payDates.add(trx.payDateStr)");

        // Status Kombinasi untuk multi-tipe pembayaran
        expect(jsContent).toContain("status = 'mixed'");
        expect(jsContent).toContain("Kombinasi");

        // Tampilan bulan gabungan (title, badge, subDetail)
        expect(jsContent).toContain("monthFormattedTitle");
        expect(jsContent).toContain("monthBadge");
        expect(jsContent).toContain("monthSubDetail");

        // Ekspor Excel 1 baris per siswa
        expect(jsContent).toContain("Bulan Tagihan Terbayar");
        expect(jsContent).toContain("Jumlah Bulan");
        expect(jsContent).toContain("r.monthShortStr");
        expect(jsContent).toContain("r.monthsCount");
        expect(jsContent).toContain("r.totalAmount");
    });

    test('5. Sinkronisasi versi aplikasi terjaga di seluruh dokumen SSOT', () => {
        expect(packageJson.version).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
        expect(configContent).toContain(`export const APP_VERSION = "${packageJson.version}";`);
        expect(prdContent).toContain(`[${packageJson.version}]`);
        expect(prdContent).toContain('1 baris per siswa');
        expect(prdContent).toContain('formatBudgetMonths');
        expect(changelogContent).toContain('[26.09.14.17]');
        expect(changelogContent).toContain('Pemisahan Tunggakan Tahun Sebelumnya');
    });
});
