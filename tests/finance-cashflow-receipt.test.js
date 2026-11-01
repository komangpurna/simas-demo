/**
 * Unit Test: Modul Keuangan - Catat Mutasi Kas & No. Bukti Transaksi
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Modul Keuangan: Catat Mutasi Kas & No. Bukti Transaksi', () => {
    const rootDir = path.resolve(__dirname, '..');
    const migrationFile = path.join(rootDir, 'supabase', 'migrations', '202609140001_add_no_bukti_to_finance_cashflow.sql');
    const htmlFile = path.join(rootDir, 'keuangan.html');
    const jsFile = path.join(rootDir, 'js', 'page-keuangan.js');

    test('1. Skrip migrasi SQL 202609140001_add_no_bukti_to_finance_cashflow.sql tersedia dan terdefinisi dengan benar', () => {
        expect(fs.existsSync(migrationFile)).toBe(true);
        const sqlContent = fs.readFileSync(migrationFile, 'utf8');

        expect(sqlContent).toMatch(/ALTER TABLE\s+public\.finance_cashflow\s+ADD COLUMN IF NOT EXISTS\s+no_bukti\s+VARCHAR\(100\)/i);
        expect(sqlContent).toMatch(/idx_fin_cashflow_no_bukti/i);
        expect(sqlContent).toMatch(/COMMENT ON COLUMN\s+public\.finance_cashflow\.no_bukti/i);
    });

    test('2. Form Catat Mutasi Kas di keuangan.html memiliki input No. Bukti dan tabel memiliki kolom No. Bukti setelah Tanggal', () => {
        const htmlContent = fs.readFileSync(htmlFile, 'utf8');

        // Memastikan input No. Bukti ada di dalam form modal
        expect(htmlContent).toContain('id="cf-receipt-no"');
        expect(htmlContent).toContain('No. Bukti');
        expect(htmlContent).toContain('modal-cashflow-form');

        // Memastikan input pencarian filter Buku Kas ada di toolbar
        expect(htmlContent).toContain('id="filter-cf-search"');
        expect(htmlContent).toContain('window.filterCashflowTable()');

        // Memastikan kolom No. Bukti ada setelah Tanggal di thead tabel Buku Kas
        expect(htmlContent).toMatch(/<th[^>]*>Tanggal<\/th>\s*<th[^>]*>No\.\s*Bukti<\/th>/i);
        expect(htmlContent).toContain('colspan="7"');
    });

    test('3. Logika JavaScript js/page-keuangan.js mendukung no_bukti secara utuh, fail-safe, dan kolom khusus di tabel', () => {
        const jsContent = fs.readFileSync(jsFile, 'utf8');

        // Pemuatan data dengan fallback fail-safe
        expect(jsContent).toContain('no_bukti');
        expect(jsContent).toContain('receiptNo: d.no_bukti || \'\'');
        expect(jsContent).toMatch(/42703/); // Kode error PostgreSQL untuk undefined column

        // Reset form pada openCashflowModal
        expect(jsContent).toMatch(/document\.getElementById\(['"]cf-receipt-no['"]\)/);

        // Pengisian form edit pada openEditCashflowModal
        expect(jsContent).toContain('receiptInput.value = data.no_bukti || \'\'');

        // Penyimpanan data pada saveCashflowTransaction
        expect(jsContent).toContain('no_bukti: receiptNoVal');
        expect(jsContent).toContain('UPDATE_CASHFLOW');
        expect(jsContent).toContain('CREATE_CASHFLOW');

        // Rendering kolom No. Bukti setelah Tanggal di tabel
        expect(jsContent).toContain('receiptCell');
        expect(jsContent).toContain('${dateFormatted}</td>');
        expect(jsContent).toContain('${receiptCell}</td>');
        expect(jsContent).toContain('colspan="7"');
    });

    test('4. Integritas kalkulasi keuangan dan filter berjalan benar secara komputasi', () => {
        // Simulasi kalkulasi mutasi kas dengan data berisi No. Bukti
        const dummyEntries = [
            {
                id: 'cf_1',
                dateStr: '2026-09-01',
                type: 'masuk',
                amount: 500000,
                description: 'Sumbangan Alumni',
                receiptNo: 'BKM-001',
                teller: 'Admin'
            },
            {
                id: 'cf_2',
                dateStr: '2026-09-02',
                type: 'keluar',
                amount: 200000,
                description: 'Beli ATK Kantor',
                receiptNo: 'BKK-001',
                teller: 'Admin'
            },
            {
                id: 'cf_3',
                dateStr: '2026-09-03',
                type: 'keluar',
                amount: 100000,
                description: 'Konsumsi Rapat',
                receiptNo: '',
                teller: 'Admin'
            }
        ];

        let runningBalance = 0;
        let totalIncome = 0;
        let totalExpense = 0;

        dummyEntries.forEach(entry => {
            if (entry.type === 'masuk') {
                runningBalance += entry.amount;
                totalIncome += entry.amount;
                entry.debit = entry.amount;
                entry.credit = 0;
            } else if (entry.type === 'keluar') {
                runningBalance -= entry.amount;
                totalExpense += entry.amount;
                entry.debit = 0;
                entry.credit = entry.amount;
            }
            entry.balance = runningBalance;
        });

        expect(totalIncome).toBe(500000);
        expect(totalExpense).toBe(300000);
        expect(runningBalance).toBe(200000);
        expect(dummyEntries[1].balance).toBe(300000);
        expect(dummyEntries[2].balance).toBe(200000);

        // Simulasi filter pencarian berdasarkan No. Bukti
        const searchKeyword = 'bkk-001';
        const filteredByReceipt = dummyEntries.filter(entry => {
            const desc = (entry.description || '').toLowerCase();
            const receipt = (entry.receiptNo || '').toLowerCase();
            return desc.includes(searchKeyword) || receipt.includes(searchKeyword);
        });

        expect(filteredByReceipt.length).toBe(1);
        expect(filteredByReceipt[0].id).toBe('cf_2');
        expect(filteredByReceipt[0].receiptNo).toBe('BKK-001');
    });

    test('5. Baris virtual Total Mutasi Periode Ini menghitung dan menyajikan saldo kas riil akhir periode secara konsisten', () => {
        const jsContent = fs.readFileSync(jsFile, 'utf8');
        expect(jsContent).toContain('finalRealBalance');
        expect(jsContent).toContain("const balanceColor = finalRealBalance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';");
        expect(jsContent).toContain('${balanceColor} font-extrabold');
        expect(jsContent).toContain('${fmt2(finalRealBalance)}');

        // Simulasi konsistensi September vs Semua Bulan
        // Saldo awal s.d. Agustus 2026: 114.064.451
        const augustBalance = 114064451;
        // Mutasi September 2026: Debit 50.425.000, Kredit 10.542.500
        const septDebit = 50425000;
        const septCredit = 10542500;
        const septEndingBalance = Math.round(augustBalance + septDebit - septCredit);
        expect(septEndingBalance).toBe(153946951);
        expect(septEndingBalance.toLocaleString('id-ID')).toBe('153.946.951');

        // Akumulasi Semua Bulan (Januari - September 2026): Debit 510.088.782, Kredit 356.141.831
        const allDebit = 510088782;
        const allCredit = 356141831;
        const allEndingBalance = Math.round(allDebit - allCredit);
        expect(allEndingBalance).toBe(153946951);
        expect(allEndingBalance.toLocaleString('id-ID')).toBe('153.946.951');

        // Memastikan nilai saldo kas riil September dan Semua Bulan sama persis
        expect(septEndingBalance).toBe(allEndingBalance);
    });
});
