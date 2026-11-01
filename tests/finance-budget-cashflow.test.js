/**
 * Unit Test: Modul Keuangan - Arus Kas Tahun Anggaran (Dual-Mode: Kas Fisik Riil vs Tahun Anggaran)
 * Versi: 26.09.14.12
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Modul Keuangan: Arus Kas Tahun Anggaran (Dual-Mode)', () => {
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

    test('1. Markup HTML keuangan.html memiliki sub-tab toggle mode arus kas lengkap', () => {
        expect(htmlContent).toContain("id=\"btn-cf-mode-real\"");
        expect(htmlContent).toContain("window.switchCashflowMode('real')");
        expect(htmlContent).toContain("Kas Fisik (Riil)");

        expect(htmlContent).toContain("id=\"btn-cf-mode-budget\"");
        expect(htmlContent).toContain("window.switchCashflowMode('budget')");
        expect(htmlContent).toContain("Tahun Anggaran");

        expect(htmlContent).toContain("id=\"cf-view-title\"");
        expect(htmlContent).toContain("id=\"cf-mode-badge\"");
    });

    test('2. State dan fungsi switchCashflowMode terdefinisi di window', () => {
        expect(jsContent).toContain("window.currentCashflowMode = window.currentCashflowMode || 'real'");
        expect(jsContent).toContain("window.switchCashflowMode = async");
        expect(jsContent).toContain("window.currentCashflowMode = mode || 'real'");
        expect(jsContent).toContain("document.getElementById('btn-cf-mode-real')");
        expect(jsContent).toContain("document.getElementById('btn-cf-mode-budget')");
        expect(jsContent).toContain("window.loadCashflow()");
    });

    test('3. Mode Kas Riil mempertahankan pemanggilan finance_daily_summary (zero regression)', () => {
        expect(jsContent).toContain("cfMode === 'real'");
        expect(jsContent).toContain("'finance_daily_summary'");
        expect(jsContent).toContain("Pemasukan SPP Harian");
    });

    test('4. Mode Tahun Anggaran menerapkan pemisahan tagihan masa depan, pemisahan tunggakan masa lalu, dan pengakuan uang muka (Opsi A)', () => {
        // Query finance_transactions tahun berjalan
        expect(jsContent).toContain("from('finance_transactions')");

        // Transaksi tagihan tahun berjalan murni (trxYear === selectedYear) MASUK
        expect(jsContent).toContain("trxYear === selectedYear");
        expect(jsContent).toContain("dayData.amount += amt");

        // Transaksi pelunasan tunggakan tahun lampau (trxYear < selectedYear) DIPISAHKAN
        expect(jsContent).toContain("trxYear < selectedYear");
        expect(jsContent).toContain("pastArrearsSummary");
        expect(jsContent).toContain("tunggakan th lalu dipisahkan");

        // Transaksi tagihan tahun depan (trxYear > selectedYear) DIKECUALIKAN
        expect(jsContent).toContain("dayData.excludedCount++");
        expect(jsContent).toContain("dikecualikan");

        // Opsi A: Pengakuan penerimaan di muka dari tahun sebelumnya
        expect(jsContent).toContain(".eq('year', selectedYear).lt('date_str', startDateStr)");
        expect(jsContent).toContain("advance_recognized");
        expect(jsContent).toContain("Diakui dari setoran tahun lalu");
    });

    test('5. Sinkronisasi dokumen SSOT versi aktif', () => {
        expect(packageJson.version).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
        expect(configContent).toContain(`export const APP_VERSION = "${packageJson.version}";`);
        expect(prdContent).toContain(`[${packageJson.version}]`);
        expect(prdContent).toContain('Pemisahan Penerimaan Tunggakan SPP Tahun Sebelumnya');
        expect(changelogContent).toContain('[26.09.14.17]');
        expect(changelogContent).toContain('Pemisahan Tunggakan Tahun Sebelumnya');
    });

    test('6. Filter tahun Arus Kas (filter-cf-year) dinamis multi-tahun mencakup masa lalu, tahun berjalan, dan masa depan', () => {
        expect(jsContent).toContain("function initCashflowFilters");
        expect(jsContent).toContain("window.initCashflowFilters = initCashflowFilters");
        expect(jsContent).toContain("currentYear - 2");
        expect(jsContent).toContain("currentYear + 4");
        expect(jsContent).toContain("filter-cf-year");
        expect(jsContent).toContain("handleYearFilterChange");
    });

    test('7. Inline early stubs switchCashflowMode terdefinisi di keuangan.html agar aktif seketika sebelum modul selesai defer', () => {
        expect(htmlContent).toContain("window.switchCashflowMode = function(mode)");
        expect(htmlContent).toContain("window.openCashflowAuditModal = function(year)");
        expect(htmlContent).toContain("window.currentCashflowMode = 'real'");
        expect(jsContent).toContain("window._moduleSwitchCashflowMode = async");
        expect(jsContent).toContain("window._moduleOpenCashflowAuditModal = window.openCashflowAuditModal");
    });

    test('8. Banner rekonsiliasi kas dan tool audit diagnostik window.diagnoseCashflowDiff terdefinisi', () => {
        expect(htmlContent).toContain("id=\"cf-budget-reconcile-banner\"");
        expect(htmlContent).toContain("id=\"cf-budget-reconcile-text\"");
        expect(jsContent).toContain("window.diagnoseCashflowDiff = async");
        expect(jsContent).toContain("futureBudgetSummary");
        expect(jsContent).toContain("pastArrearsSummary");
        expect(jsContent).toContain("Rekonsiliasi Anggaran");
    });

    test('9. Modal audit & rekonsiliasi kas terdefinisi lengkap di keuangan.html', () => {
        expect(htmlContent).toContain("id=\"modal-cashflow-audit\"");
        expect(htmlContent).toContain("id=\"cf-audit-daily-total\"");
        expect(htmlContent).toContain("id=\"cf-audit-trx-total\"");
        expect(htmlContent).toContain("id=\"cf-audit-diff-card\"");
        expect(htmlContent).toContain("id=\"cf-audit-alert-box\"");
        expect(htmlContent).toContain("id=\"cf-audit-past-excluded\"");
        expect(htmlContent).toContain("id=\"cf-audit-past-breakdown\"");
        expect(htmlContent).toContain("id=\"btn-reconcile-sync\"");
        expect(htmlContent).toContain("window.reconcileDailySummaryWithTransactions()");
        expect(htmlContent).toContain("window.openCashflowAuditModal()");
    });

    test('10. Fungsi audit modal dan rekonsiliasi otomatis terdefinisi di js/page-keuangan.js', () => {
        expect(jsContent).toContain("window.openCashflowAuditModal = async");
        expect(jsContent).toContain("window.reconcileDailySummaryWithTransactions = async");
        expect(jsContent).toContain("RECONCILE_CASHFLOW");
        expect(jsContent).toContain("finance_daily_summary");
    });

    test('11. Izin secure-proxy backend mengizinkan staf dan kesiswaan menulis finance_daily_summary', () => {
        const proxyFile = path.join(rootDir, 'supabase', 'functions', 'secure-proxy', 'rest-access-utils.mjs');
        const proxyContent = fs.readFileSync(proxyFile, 'utf8');
        expect(proxyContent).toMatch(/finance_daily_summary:\s*\[[^\]]*'staff'[^\]]*\]/);
        expect(proxyContent).toMatch(/finance_daily_summary:\s*\[[^\]]*'kesiswaan'[^\]]*\]/);
    });

    test('12. Pencatatan audit trail (Immutable Audit Logs) terdefinisi mutlak pada transaksi keuangan', () => {
        expect(prdContent).toContain('Jejak Audit Forensik Keuangan (Immutable Audit Trail via Cloudflare D1 `audit_logs`)');
        expect(jsContent).toMatch(/window\.logAudit\(\s*['"]DELETE_PAYMENT['"]/);
        expect(jsContent).toMatch(/window\.logAudit\(\s*['"]CREATE_PAYMENT['"]/);
        expect(jsContent).toMatch(/window\.logAudit\(\s*['"]RECONCILE_CASHFLOW['"]/);
    });

    test('13. Filter bulan Arus Kas (#filter-cf-month) secara default memilih bulan berjalan saat membuka Arus Kas dengan proteksi userChanged', () => {
        expect(htmlContent).toContain('id="filter-cf-month"');
        expect(htmlContent).toContain("this.dataset.userChanged='true'");
        expect(htmlContent).toContain("String(new Date().getMonth() + 1).padStart(2, '0')");
        expect(jsContent).toContain("if (force || !monthSelect.dataset.userChanged)");
        expect(jsContent).toContain("const currentMonthStr = String(new Date().getMonth() + 1).padStart(2, '0')");
        expect(jsContent).toContain("monthSelect.value = currentMonthStr;");
        expect(htmlContent).toContain("if (typeof window.initCashflowFilters === 'function')");
    });

    test('14. Transaksi atomik dan kompensasi rollback otomatis (All-or-Nothing Guarantee) terdefinisi pada mutasi kas', () => {
        expect(prdContent).toContain('Prinsip Transaksi Atomik & Kompensasi Rollback (All-or-Nothing Mutation Guarantee)');
        // Rollback pada executeDeletePayment
        expect(jsContent).toContain('Rollback Berhasil');
        expect(jsContent).toContain('total_amount: originalSummaryAmount');
        expect(jsContent).toContain('transaction_count: originalSummaryCount');
        // Rollback cascade pada executePayment
        expect(jsContent).toContain(".from('finance_transactions').delete().in('id', insertedIds)");
    });

    test('15. Zero-Drift Mathematical Precision (Ketelitian Matematika 2 Desimal Tanpa Floating Drift) diterapkan pada kalkulasi kasir dan arus kas', () => {
        // Memastikan running balance arus kas dibersihkan dari floating fraction dengan presisi 2 desimal
        expect(jsContent).toContain('Hitung running balance & statistik (Zero-Drift Mathematical Precision)');
        expect(jsContent).toContain('const entryAmt = round2(Number(entry.amount) || 0);');
        // Memastikan saldo akhir tutup buku dan filter cashflow menggunakan round2 sanitization
        expect(jsContent).toContain('const runningBalance = round2((totalSppIncome + totalManualIncome) - totalExpense);');
        expect(jsContent).toContain('saldoAkhir: round2((saldoAwal + sppIncome + manualIncome) - expense)');
    });
});

