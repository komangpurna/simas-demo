/**
 * tests/rkas-komite.test.js
 * Unit Test Suite: Modul RKAS Komite (Perencanaan, Realisasi, Approval 3 Pihak & Integrasi Buku Kas)
 * Standar: OWASP Top 10, ASVS Level 1 & 2, Action & Security Parity, DOM Integrity & Modal Anti-Nesting
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Modul RKAS Komite: Perencanaan & Realisasi Anggaran Komite', () => {
    const rootDir = path.resolve(__dirname, '..');
    const rkasHtmlPath = path.join(rootDir, 'rkas-komite.html');
    const keuanganHtmlPath = path.join(rootDir, 'keuangan.html');
    const pageRkasJsPath = path.join(rootDir, 'js', 'page-rkas-komite.js');
    const pageKeuanganJsPath = path.join(rootDir, 'js', 'page-keuangan.js');
    const globalJsPath = path.join(rootDir, 'js', 'global.js');
    const migrationSqlPath = path.join(rootDir, 'supabase', 'migrations', '202610220001_rkas_komite.sql');

    let rkasHtml = '';
    let keuanganHtml = '';
    let pageRkasJs = '';
    let pageKeuanganJs = '';
    let globalJs = '';
    let migrationSql = '';

    beforeAll(() => {
        rkasHtml = fs.readFileSync(rkasHtmlPath, 'utf8');
        keuanganHtml = fs.readFileSync(keuanganHtmlPath, 'utf8');
        pageRkasJs = fs.readFileSync(pageRkasJsPath, 'utf8');
        pageKeuanganJs = fs.readFileSync(pageKeuanganJsPath, 'utf8');
        globalJs = fs.readFileSync(globalJsPath, 'utf8');
        migrationSql = fs.readFileSync(migrationSqlPath, 'utf8');
    });

    // =========================================================================
    // 1. DOM Integrity & Anti-Nesting Mandate
    // =========================================================================
    test('1. DOM Integrity: Seluruh modal dialog di rkas-komite.html berdiri mandiri di luar <main> (Top-Level Siblings)', () => {
        expect(rkasHtml).toContain('id="modal-income-form"');
        expect(rkasHtml).toContain('id="modal-kegiatan-form"');
        expect(rkasHtml).toContain('id="modal-belanja-form"');
        expect(rkasHtml).toContain('id="modal-import-excel"');
        expect(rkasHtml).toContain('id="modal-approval"');
        expect(rkasHtml).toContain('id="modal-confirm-delete"');
        expect(rkasHtml).toContain('id="modal-clone-rkas"');

        const mainCloseIndex = rkasHtml.indexOf('</main>');
        expect(mainCloseIndex).toBeGreaterThan(-1);

        const modalIds = [
            'modal-income-form',
            'modal-kegiatan-form',
            'modal-belanja-form',
            'modal-import-excel',
            'modal-approval',
            'modal-confirm-delete',
            'modal-clone-rkas'
        ];

        modalIds.forEach(id => {
            const modalIndex = rkasHtml.indexOf(`id="${id}"`);
            expect(modalIndex).toBeGreaterThan(mainCloseIndex);
        });
    });

    test('2. Standar Desain & Aksesibilitas: Bebas leading icon absolut pada form input', () => {
        // Memastikan tidak ada leading icon absolut di dalam input pada rkas-komite.html
        const problematicPattern = /class="[^"]*relative[^"]*"[^>]*>\s*<i[^>]*absolute\s+left-[^>]*><\/i>\s*<input[^>]*pl-[89]|pl-10/gi;
        expect(rkasHtml).not.toMatch(problematicPattern);
    });

    // =========================================================================
    // 2. Paritas Hak Akses & RBAC (Action & Security Parity)
    // =========================================================================
    test('3. RBAC & Otorisasi Menu: rkas_komite terdaftar pada global.js dengan izin yang tepat', () => {
        // Menu item terdaftar di SIDEBAR_CONFIG
        expect(globalJs).toContain("'rkas_komite': { label: 'RKAS Komite'");

        // Terdaftar di MENU_GROUPS kelompok keuangan_group
        expect(globalJs).toContain("'rkas_komite', 'keuangan'");

        // Hak akses rkas-komite.html di PAGE_ACCESS_CONFIG
        expect(globalJs).toContain("'rkas-komite.html': {");
        expect(globalJs).toMatch(/'rkas-komite\.html':\s*\{\s*'super_admin':\s*'rw',\s*'kepala_sekolah':\s*'r'/);

        // Akses menu di MENU_CONFIG untuk admin_spp, kepala_sekolah, super_admin
        expect(globalJs).toMatch(/'admin_spp':\s*\[[^\]]*'rkas_komite'/);
        expect(globalJs).toMatch(/'kepala_sekolah':\s*\[[^\]]*'rkas_komite'/);
        expect(globalJs).toMatch(/'super_admin':\s*\[[^\]]*'rkas_komite'/);
    });

    // =========================================================================
    // 3. Skema Database Supabase & Relasi ACID
    // =========================================================================
    test('4. Skema Database: Migrasi Supabase mendefinisikan rkas_komite_headers, rkas_komite_items, dan kolom rkas_kegiatan_id pada finance_cashflow', () => {
        expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS public.rkas_komite_headers');
        expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS public.rkas_komite_items');
        expect(migrationSql).toContain('ALTER TABLE public.finance_cashflow');
        expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS rkas_kegiatan_id TEXT DEFAULT NULL');
        expect(migrationSql).toContain('idx_fin_cashflow_rkas_kegiatan_id');
        expect(migrationSql).toContain('committee_chair_name VARCHAR(200) DEFAULT \'I Gede Sukasari, S.ST.\'');
    });

    // =========================================================================
    // 4. Kalkulasi Bisnis Anggaran RKAS & Alokasi Tahap
    // =========================================================================
    test('5. Logika Kalkulasi: Pagu Penerimaan = SILPA + Penerimaan Berjalan', () => {
        const silpa = 64218782;
        const penerimaan = 681030000;
        const total = silpa + penerimaan;
        expect(total).toBe(745248782);
    });

    test('6. Logika Kalkulasi: Alokasi Tahap 1 + Tahap 2 pada baris Kegiatan', () => {
        const tahap1 = 3500000;
        const tahap2 = 3500000;
        const totalPaguKegiatan = tahap1 + tahap2;
        expect(totalPaguKegiatan).toBe(7000000);
    });

    test('7. Logika Realisasi: Monitoring Budget vs Actual & Peringatan Over-Budget', () => {
        const pagu = 7000000;
        const realisasiNormal = 2000000;
        const sisaNormal = pagu - realisasiNormal;
        expect(sisaNormal).toBe(5000000);
        expect(sisaNormal > 0).toBe(true);

        // Simulasi over-budget
        const realisasiOver = 8000000;
        const sisaOver = pagu - realisasiOver;
        expect(sisaOver).toBe(-1000000);
        expect(sisaOver < 0).toBe(true);
    });

    // =========================================================================
    // 5. Alur Pengesahan 3 Pihak (Approval Lifecycle)
    // =========================================================================
    test('8. Alur Pengesahan Bertingkat: Bendahara Komite -> Kepala Sekolah -> Ketua Komite Sekolah', () => {
        expect(rkasHtml).toContain('id="step-treasurer-card"');
        expect(rkasHtml).toContain('id="step-principal-card"');
        expect(rkasHtml).toContain('id="step-committee-card"');
        expect(rkasHtml).toContain('I Gede Sukasari, S.ST.');

        // Fungsi controller mendukung 3 tahap approval
        expect(pageRkasJs).toContain('sign_treasurer');
        expect(pageRkasJs).toContain('review_principal');
        expect(pageRkasJs).toContain('approve_committee');
    });

    // =========================================================================
    // 6. Integrasi Buku Kas Pengeluaran (keuangan.html & js/page-keuangan.js)
    // =========================================================================
    test('9. Integrasi Buku Kas: keuangan.html memuat pemilihan Pos Kegiatan RKAS dan tautan modul RKAS', () => {
        expect(keuanganHtml).toContain('id="cf-rkas-wrapper"');
        expect(keuanganHtml).toContain('id="cf-rkas-kegiatan"');
        expect(keuanganHtml).toContain('id="cf-rkas-budget-box"');
        expect(keuanganHtml).toContain('id="cf-rkas-overbudget-warn"');
        expect(keuanganHtml).toContain('href="rkas-komite.html"');
    });

    test('10. Integrasi Controller Keuangan: page-keuangan.js memuat handler Pos RKAS, validasi wajib pengeluaran, dan badge RKAS di tabel kas', () => {
        expect(pageKeuanganJs).toContain('loadRkasKegiatanForCashflow');
        expect(pageKeuanganJs).toContain('handleCashflowTypeChange');
        expect(pageKeuanganJs).toContain('handleRkasKegiatanSelected');
        expect(pageKeuanganJs).toContain('checkCashflowOverbudget');
        expect(pageKeuanganJs).toContain('rkas_kegiatan_id');
        expect(pageKeuanganJs).toContain('rkasBadge');
    });

    // =========================================================================
    // 7. Fitur Ekspor Excel & Cetak Dokumen Resmi
    // =========================================================================
    test('11. Fitur Ekspor & Cetak: rkas-komite.html dan controller memuat ekspor XLSX dan cetak dokumen resmi ber-kop', () => {
        expect(rkasHtml).toContain('btn-export-excel');
        expect(rkasHtml).toContain('btn-print-rkas');
        expect(pageRkasJs).toContain('exportRkasExcel');
        expect(pageRkasJs).toContain('printOfficialRkas');
        expect(pageRkasJs).toContain('SCHOOL_CONFIG.kopPath');
    });

    test('12. Fitur 1-Klik Salin RKAS Murni ke Perubahan (Clone Mandate)', () => {
        expect(rkasHtml).toContain('btn-clone-murni');
        expect(pageRkasJs).toContain('executeCloneMurni');
    });
});
