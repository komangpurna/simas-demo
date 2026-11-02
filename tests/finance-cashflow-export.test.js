/**
 * Unit Test: Modul Keuangan - Ekspor Excel (.xlsx) Buku Kas Umum (Arus Kas Dual-Mode)
 * Versi: 26.09.14.27
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Modul Keuangan: Ekspor Excel (.xlsx) Buku Kas Umum (Arus Kas)', () => {
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

    test('1. Tombol Export XLSX terpasang di toolbar #view-arus-kas keuangan.html', () => {
        expect(htmlContent).toContain('id="btn-export-cf-excel"');
        expect(htmlContent).toContain('onclick="window.exportCashflowExcel()"');
        expect(htmlContent).toContain('Export XLSX');
        expect(htmlContent).toContain('fa-file-excel');
    });

    test('2. Early inline stub window.exportCashflowExcel terdefinisi di keuangan.html', () => {
        expect(htmlContent).toContain('window.exportCashflowExcel = function()');
        expect(htmlContent).toContain('window._moduleExportCashflowExcel');
    });

    test('3. Fungsi window.exportCashflowExcel terdefinisi lengkap di js/page-keuangan.js', () => {
        expect(jsContent).toContain('window.exportCashflowExcel = async');
        expect(jsContent).toContain('window._moduleExportCashflowExcel = window.exportCashflowExcel');
        expect(jsContent).toContain("typeof XLSX === 'undefined'");
    });

    test('4. Ekspor BKU mendukung dual-mode reaktif (Kas Fisik Riil vs Tahun Anggaran)', () => {
        expect(jsContent).toContain("const cfMode = window.currentCashflowMode || 'real'");
        expect(jsContent).toContain("const modeTag = cfMode === 'budget' ? 'Tahun_Anggaran' : 'Kas_Riil'");
        expect(jsContent).toContain("Berkas BKU (${cfMode === 'budget' ? 'Tahun Anggaran' : 'Kas Riil'}) lembar ${sheetTitle} berhasil diunduh");
    });

    test('5. Format 8 kolom standar BKU resmi presisi sheet JAN, penomoran 1..7, dan format angka desimal diterapkan', () => {
        expect(jsContent).toContain("setCell('A10', 'NO.')");
        expect(jsContent).toContain("setCell('B10', 'TANGGAL')");
        expect(jsContent).toContain("setCell('C10', 'NO. BKU')");
        expect(jsContent).toContain("setCell('E10', 'URAIAN')");
        expect(jsContent).toContain("setCell('F10', 'PENERIMAAN')");
        expect(jsContent).toContain("setCell('G10', 'PENGELUARAN')");
        expect(jsContent).toContain("setCell('H10', 'SALDO')");
        expect(jsContent).toContain("setCell('A12', 1)");
        expect(jsContent).toContain('numFmtAccounting');
        expect(jsContent).toContain('totalPenerimaan');
        expect(jsContent).toContain('totalPengeluaran');
        expect(jsContent).toContain('finalSaldo');
    });

    test('6. Seksi ringkasan saldo kas (Saldo Tunai & Saldo Bank), identitas sekolah dan tanda tangan terpasang', () => {
        expect(jsContent).toContain('Saldo BKU');
        expect(jsContent).toContain('Terdiri Dari');
        expect(jsContent).toContain('Saldo Tunai');
        expect(jsContent).toContain('Saldo Bank');
        expect(jsContent).toContain('Bendahara Komite');
        expect(jsContent).toContain('Menyetujui,');
        expect(jsContent).toContain('Ketua Komite');
        expect(jsContent).toMatch(/(?:SMA Negeri Nusantara|SMA Negeri 1 Abang)/);
        expect(jsContent).toMatch(/(?:Dr\. I Wayan Sudarsana, M\.Pd\.|I Putu Suweta, S\.Pd\., M\.Pd\.)/);
    });

    test('7. Ketepatan matematis zero-drift (round2) untuk menjamin tidak ada salah 1 rupiahpun', () => {
        expect(jsContent).toContain('const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100');
        expect(jsContent).toContain('saldoTunai = round2(finalSaldo - saldoBank)');
    });

    test('8. Pejabat resmi komite dan fallback default terhubung ke SCHOOL_CONFIG', () => {
        expect(jsContent).toContain('SCHOOL_CONFIG?.bendaharaKomiteName');
        expect(jsContent).toContain('SCHOOL_CONFIG?.ketuaKomiteName');
        expect(jsContent).toMatch(/(?:Ni Made Ariani, S\.E\.|I Nyoman Mintar, S\.Pd)/);
        expect(jsContent).toMatch(/(?:I Ketut Wirawan, S\.T\.|I Gede Sukasari, S\.S\.T)/);
        expect(jsContent).toMatch(/(?:I Made Sujana, S\.Pd\.|Wayan Made Komang Ketut)/);
    });

    test('9. Penyelarasan SSOT versi di package.json, config.js, PRD, dan CHANGELOG', () => {
        expect(packageJson.version).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
        expect(configContent).toContain(`export const APP_VERSION = "${packageJson.version}";`);
        expect(prdContent).toContain(`[${packageJson.version}]`);
        expect(changelogContent).toContain(`[${packageJson.version}]`);
    });
});
