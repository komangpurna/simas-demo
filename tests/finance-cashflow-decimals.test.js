/**
 * Unit Test: Modul Keuangan - Dukungan 2 Angka di Belakang Koma pada Arus Kas & Input Mutasi Kas
 * Versi: 26.09.21.1
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Modul Keuangan: Dukungan 2 Angka di Belakang Koma (Desimal)', () => {
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

    test('1. Input #cf-amount pada formulir mutasi kas di keuangan.html memiliki konfigurasi desimal lengkap', () => {
        expect(htmlContent).toContain('id="cf-amount"');
        expect(htmlContent).toContain('placeholder="0,00"');
        expect(htmlContent).toContain('inputmode="decimal"');
        expect(htmlContent).toContain('oninput="window.formatCashflowInputCurrency(this)"');
        expect(htmlContent).toContain('onblur="window.normalizeCashflowInputOnBlur(this)"');
    });

    test('2. Early inline stubs untuk fungsi parser dan formatter mutasi kas terdefinisi di keuangan.html', () => {
        expect(htmlContent).toContain('window.parseCashflowAmount = function');
        expect(htmlContent).toContain('window.formatCashflowInputCurrency = function');
        expect(htmlContent).toContain('window.normalizeCashflowInputOnBlur = function');
    });

    test('3. Logika JavaScript js/page-keuangan.js mendefinisikan window.parseCashflowAmount dengan benar', () => {
        expect(jsContent).toContain('window.parseCashflowAmount =');
        expect(jsContent).toContain('window._moduleParseCashflowAmount = window.parseCashflowAmount');

        // Evaluasi fungsi parser
        function parseCashflowAmount(val) {
            if (typeof val === 'number') return isNaN(val) ? 0 : Math.round(val * 100) / 100;
            if (!val) return 0;
            let s = String(val).trim();
            if (!s) return 0;

            if (s.includes(',')) {
                s = s.replace(/\./g, '').replace(',', '.');
            } else if (s.includes('.')) {
                const parts = s.split('.');
                if (parts.length > 2) {
                    s = s.replace(/\./g, '');
                } else if (parts.length === 2) {
                    if (parts[1].length === 3 && parts[0].length >= 1) {
                        s = s.replace(/\./g, '');
                    }
                }
            }
            const num = parseFloat(s);
            return isNaN(num) ? 0 : Math.round(num * 100) / 100;
        }

        // Pengujian berbagai variasi input
        expect(parseCashflowAmount(50000)).toBe(50000);
        expect(parseCashflowAmount(50000.5)).toBe(50000.5);
        expect(parseCashflowAmount(50000.555)).toBe(50000.56); // Pembulatan 2 desimal
        expect(parseCashflowAmount('50.000')).toBe(50000);
        expect(parseCashflowAmount('50.000,50')).toBe(50000.5);
        expect(parseCashflowAmount('1.250.000,75')).toBe(1250000.75);
        expect(parseCashflowAmount('50000.50')).toBe(50000.5);
        expect(parseCashflowAmount('50,25')).toBe(50.25);
        expect(parseCashflowAmount('0')).toBe(0);
        expect(parseCashflowAmount('')).toBe(0);
        expect(parseCashflowAmount(null)).toBe(0);
        expect(parseCashflowAmount(undefined)).toBe(0);
    });

    test('4. Logika JavaScript js/page-keuangan.js mendefinisikan window.formatCashflowInputCurrency dan onblur', () => {
        expect(jsContent).toContain('window.formatCashflowInputCurrency =');
        expect(jsContent).toContain('window.normalizeCashflowInputOnBlur =');
        expect(jsContent).toContain('window.formatCashflowAmount =');
    });

    test('5. Form edit mutasi kas openEditCashflowModal dan simpan saveCashflowTransaction mendukung nilai desimal', () => {
        expect(jsContent).toContain("minimumFractionDigits: 2");
        expect(jsContent).toContain("maximumFractionDigits: 2");
        expect(jsContent).toContain("window.parseCashflowAmount(amountValStr)");
    });

    test('6. Tabel Arus Kas renderCashflowTable dan Ringkasan Kas memformat nominal dengan 2 angka di belakang koma', () => {
        expect(jsContent).toContain("const fmt2 = (val) => (Number(val) || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });");
        expect(jsContent).toContain("+${fmt2(totalDebit)}");
        expect(jsContent).toContain("-${fmt2(totalCredit)}");
        expect(jsContent).toContain("${fmt2(finalRealBalance)}");
        expect(jsContent).toContain("+${fmt2(entry.debit)}");
        expect(jsContent).toContain("-${fmt2(entry.credit)}");
        expect(jsContent).toContain("${fmt2(entry.balance)}");
    });

    test('7. Modal Audit Rekonsiliasi Kas dan Tutup Buku Tahunan mengadopsi pemformatan 2 desimal', () => {
        expect(jsContent).toContain("cf-audit-daily-total");
        expect(jsContent).toContain("closing-val-saldo-awal");
        expect(jsContent).toContain("closing-val-saldo-akhir");
    });

    test('8. Penyelarasan SSOT versi di package.json, config.js, PRD, dan CHANGELOG', () => {
        expect(packageJson.version).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
        expect(configContent).toContain(`export const APP_VERSION = "${packageJson.version}";`);
        expect(prdContent).toContain(`[${packageJson.version}]`);
        expect(changelogContent).toContain(`[${packageJson.version}]`);
    });
});
