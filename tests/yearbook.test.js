/**
 * tests/yearbook.test.js
 * Unit Test Suite untuk Modul Buku Kenangan (Yearbook) Siswa Kelas XII & Arsip Master PDF Abadi
 */

const fs = require('fs');
const path = require('path');

describe('Pengujian Modul Buku Kenangan (Yearbook) Kelas XII & Arsip PDF Abadi', () => {
    const projectRoot = path.resolve(__dirname, '..');
    const migrationPath = path.join(projectRoot, 'cloudflare', 'migrations', '202609180001_add_yearbook_module.sql');
    const schemaPath = path.join(projectRoot, 'cloudflare', 'schema.sql');
    const workerPath = path.join(projectRoot, 'cloudflare', 'worker.js');
    const cfClientPath = path.join(projectRoot, 'js', 'cloudflare-client.js');
    const portalHtmlPath = path.join(projectRoot, 'portal-siswa.html');
    const portalJsPath = path.join(projectRoot, 'js', 'page-portal-siswa.js');
    const yearbookHtmlPath = path.join(projectRoot, 'yearbook.html');
    const yearbookJsPath = path.join(projectRoot, 'js', 'page-yearbook.js');
    const yearbookAdminHtmlPath = path.join(projectRoot, 'yearbook-admin.html');
    const yearbookAdminJsPath = path.join(projectRoot, 'js', 'page-yearbook-admin.js');
    const globalJsPath = path.join(projectRoot, 'js', 'global.js');

    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    const workerJs = fs.readFileSync(workerPath, 'utf8');
    const cfClientJs = fs.readFileSync(cfClientPath, 'utf8');
    const portalHtml = fs.readFileSync(portalHtmlPath, 'utf8');
    const portalJs = fs.readFileSync(portalJsPath, 'utf8');
    const yearbookHtml = fs.readFileSync(yearbookHtmlPath, 'utf8');
    const yearbookJs = fs.readFileSync(yearbookJsPath, 'utf8');
    const yearbookAdminHtml = fs.readFileSync(yearbookAdminHtmlPath, 'utf8');
    const yearbookAdminJs = fs.readFileSync(yearbookAdminJsPath, 'utf8');
    const globalJs = fs.readFileSync(globalJsPath, 'utf8');

    describe('1. Skema Database D1 & File Migrasi SQL', () => {
        test('File migrasi 202609180001_add_yearbook_module.sql mendefinisikan 3 tabel utama', () => {
            expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS yearbook_profiles');
            expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS yearbook_messages');
            expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS yearbook_archives');
        });

        test('Tabel yearbook_profiles memiliki kolom nis, casual_photo_url, quote, ambition, dan dream_campus', () => {
            expect(migrationSql).toContain('nis TEXT PRIMARY KEY');
            expect(migrationSql).toContain('casual_photo_url TEXT');
            expect(migrationSql).toContain('quote TEXT');
            expect(migrationSql).toContain('ambition TEXT');
            expect(migrationSql).toContain('dream_campus TEXT');
        });

        test('Tabel yearbook_messages memiliki target_nis, sender_nis, message, dan is_approved', () => {
            expect(migrationSql).toContain('target_nis TEXT NOT NULL');
            expect(migrationSql).toContain('sender_nis TEXT NOT NULL');
            expect(migrationSql).toContain('message TEXT NOT NULL');
            expect(migrationSql).toContain('is_approved INTEGER DEFAULT 0');
        });

        test('Tabel yearbook_archives memiliki academic_year, pdf_url, cover_url, dan is_public', () => {
            expect(migrationSql).toContain('academic_year TEXT PRIMARY KEY');
            expect(migrationSql).toContain('pdf_url TEXT NOT NULL');
            expect(migrationSql).toContain('is_public INTEGER DEFAULT 1');
        });

        test('Master schema.sql menyinkronkan tabel 36 modul yearbook', () => {
            expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS yearbook_profiles');
            expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS yearbook_messages');
            expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS yearbook_archives');
        });
    });

    describe('2. Backend API Cloudflare Worker Gateway (cloudflare/worker.js)', () => {
        test('Memiliki endpoint streaming foto kasual /api/photos/yearbook/*', () => {
            expect(workerJs).toContain('/api/photos/yearbook/');
            expect(workerJs).toContain('STUDENT_PHOTOS_BUCKET');
        });

        test('Memiliki endpoint /api/yearbook/classes untuk daftar rombel XII aktif', () => {
            expect(workerJs).toContain('/api/yearbook/classes');
        });

        test('Memiliki endpoint /api/yearbook/my-profile untuk GET dan POST', () => {
            expect(workerJs).toContain('/api/yearbook/my-profile');
            expect(workerJs).toContain('INSERT INTO yearbook_profiles');
        });

        test('Memiliki endpoint upload foto kasual /api/yearbook/photo/upload', () => {
            expect(workerJs).toContain('/api/yearbook/photo/upload');
        });

        test('Memiliki endpoint per rombel /api/yearbook/class/:className', () => {
            expect(workerJs).toContain('/api/yearbook/class/');
        });

        test('Memiliki endpoint pesan kenangan /api/yearbook/messages dengan validasi karakter & anti-XSS', () => {
            expect(workerJs).toContain('/api/yearbook/messages');
            expect(workerJs).toContain('target_nis');
            expect(workerJs).toContain('replace(/</g, "&lt;")');
        });

        test('Memiliki endpoint toggle approval /api/yearbook/messages/:id/toggle-approval', () => {
            expect(workerJs).toContain('/toggle-approval');
        });

        test('Memiliki endpoint arsip publik /api/yearbook/archives', () => {
            expect(workerJs).toContain('/api/yearbook/archives');
        });

        test('Memiliki endpoint admin kesiswaan /api/yearbook/admin/messages dan toggle-publish', () => {
            expect(workerJs).toContain('/api/yearbook/admin/messages');
            expect(workerJs).toContain('/api/yearbook/admin/toggle-publish/');
        });

        test('Endpoint admin yearbook memisahkan validasi autentikasi 401 dan izin RBAC 403', () => {
            expect(workerJs).toContain('return errorResponse("Unauthorized: " + (authResult.error || "Sesi login tidak valid"), 401, request);');
            expect(workerJs).toContain('return errorResponse("Forbidden: Hanya staf atau guru yang berhak mengakses moderasi pesan buku tahunan", 403, request);');
            expect(workerJs).toContain('return errorResponse("Forbidden: Hanya staf atau guru yang berhak mengatur status publikasi profil siswa", 403, request);');
        });
    });

    describe('3. Cloudflare Client SDK (js/cloudflare-client.js)', () => {
        test('Class CloudflareClient memiliki instance methods yearbook lengkap', () => {
            expect(cfClientJs).toContain('getYearbookClasses()');
            expect(cfClientJs).toContain('getYearbookProfile(');
            expect(cfClientJs).toContain('saveYearbookProfile(');
            expect(cfClientJs).toContain('uploadYearbookCasualPhoto(');
            expect(cfClientJs).toContain('getYearbookClass(');
            expect(cfClientJs).toContain('sendYearbookMessage(');
            expect(cfClientJs).toContain('toggleApproveYearbookMessage(');
            expect(cfClientJs).toContain('deleteYearbookMessage(');
            expect(cfClientJs).toContain('getYearbookArchives()');
            expect(cfClientJs).toContain('saveYearbookArchive(');
            expect(cfClientJs).toContain('deleteYearbookArchive(');
            expect(cfClientJs).toContain('getYearbookAdminMessages()');
            expect(cfClientJs).toContain('toggleYearbookPublish(');
        });

        test('Mengekspos standalone functions dan window bindings', () => {
            expect(cfClientJs).toContain('export async function cfGetYearbookClasses');
            expect(cfClientJs).toContain('export async function cfGetYearbookProfile');
            expect(cfClientJs).toContain('export async function cfGetYearbookAdminMessages');
            expect(cfClientJs).toContain('export async function cfToggleYearbookPublish');
            expect(cfClientJs).toContain('window.cfGetYearbookClasses = cfGetYearbookClasses');
            expect(cfClientJs).toContain('window.cfGetYearbookArchives = cfGetYearbookArchives');
            expect(cfClientJs).toContain('window.cfGetYearbookAdminMessages = cfGetYearbookAdminMessages');
            expect(cfClientJs).toContain('window.cfToggleYearbookPublish = cfToggleYearbookPublish');
        });

        test('cfFetch mendukung resolusi authStateReady sebelum mengirim request', () => {
            expect(cfClientJs).toContain('auth.authStateReady');
        });
    });

    describe('4. Integrasi Portal Siswa (portal-siswa.html & js/page-portal-siswa.js)', () => {
        test('portal-siswa.html memuat tombol tab-yearbook dan kontainer view-yearbook', () => {
            expect(portalHtml).toContain('id="tab-yearbook"');
            expect(portalHtml).toContain('id="view-yearbook"');
        });

        test('Daftar tabs di switchTab portal-siswa.html menyertakan yearbook', () => {
            expect(portalHtml).toContain("'yearbook'");
            expect(portalHtml).toContain('loadStudentYearbookData');
        });

        test('Form yearbook di portal-siswa.html memiliki input quote, ambition, campus, dan photo upload', () => {
            expect(portalHtml).toContain('id="yearbook-input-quote"');
            expect(portalHtml).toContain('id="yearbook-input-ambition"');
            expect(portalHtml).toContain('id="yearbook-input-campus"');
            expect(portalHtml).toContain('id="yearbook-photo-input"');
            expect(portalHtml).toContain('id="yearbook-messages-list"');
        });

        test('page-portal-siswa.js mengekspos checkYearbookTab, loadStudentYearbookData, dan helper kompresi WebP', () => {
            expect(portalJs).toContain('function checkYearbookTab()');
            expect(portalJs).toContain('function compressImageFileToWebp(');
            expect(portalJs).toContain('window.loadStudentYearbookData = loadStudentYearbookData');
            expect(portalJs).toContain('window.saveYearbookProfileData = saveYearbookProfileData');
            expect(portalJs).toContain('window.handleYearbookPhotoUpload = handleYearbookPhotoUpload');
            expect(portalJs).toContain('window.toggleApproveMessage = toggleApproveMessage');
        });

        test('portal-siswa.html switchTab memproteksi tab-yearbook dari unhide atau aktivasi oleh siswa non-XII', () => {
            expect(portalHtml).toContain("tab === 'yearbook'");
            expect(portalHtml).toContain("t === 'yearbook'");
            expect(portalHtml).toContain('isXII');
            expect(portalHtml).toContain("btn.classList.add('hidden')");
        });

        test('worker.js memvalidasi bahwa hanya siswa kelas XII yang dapat mengakses profil atau mengunggah foto yearbook', () => {
            expect(workerJs).toContain('Modul Buku Kenangan (Yearbook) hanya dapat diakses oleh siswa Kelas XII');
            expect(workerJs).toContain('Modul Buku Kenangan (Yearbook) hanya diperuntukkan bagi siswa Kelas XII');
            expect(workerJs).toContain('Unggah foto Buku Kenangan hanya diperuntukkan bagi siswa Kelas XII');
        });
    });

    describe('5. Halaman Publik Yearbook (yearbook.html & js/page-yearbook.js)', () => {
        test('yearbook.html hanya memiliki 2 tab publik (Galeri Angkatan dan Arsip Alumni)', () => {
            expect(yearbookHtml).toContain('id="section-gallery"');
            expect(yearbookHtml).toContain('id="section-archives"');
            // Pastikan fitur cetak dan modal arsip admin tidak ada di halaman publik
            expect(yearbookHtml).not.toContain('id="section-print"');
            expect(yearbookHtml).not.toContain('id="nav-print"');
            expect(yearbookHtml).not.toContain('id="modal-publish-archive"');
        });

        test('yearbook.html memiliki modal kirim pesan kenangan publik', () => {
            expect(yearbookHtml).toContain('id="modal-send-message"');
        });

        test('page-yearbook.js mengimplementasikan kartu galeri dan arsip loader tanpa fungsi cetak', () => {
            expect(yearbookJs).toContain('function renderGalleryCards');
            expect(yearbookJs).toContain('async function loadYearbookArchives');
            expect(yearbookJs).not.toContain('triggerPrintYearbook');
        });

        test('yearbook.html memakai sistem desain css/yearbook.css, hero statistik, dan spread profil', () => {
            expect(yearbookHtml).toContain('css/yearbook.css');
            expect(yearbookHtml).toContain('id="yb-profile-modal"');
            expect(yearbookHtml).toContain('id="yb-class-chips"');
            expect(yearbookHtml).toContain('id="modal-login-required"');
            expect(yearbookJs).toContain('getYearbookSummary');
            expect(yearbookJs).toContain('function decodeStoredText');
            expect(yearbookJs).toContain('isSafeHttpUrl');
        });
    });

    describe('6. Halaman Admin Lengkap & Integrasi Kesiswaan (yearbook-admin.html, js/page-yearbook-admin.js, js/global.js)', () => {
        test('Navigasi global.js mendaftarkan yearbook_admin ke kesiswaan_group dan RBAC SIMAS', () => {
            expect(globalJs).toContain("'yearbook_admin': { label: 'Year Book'");
            expect(globalJs).toContain("'yearbook_admin'");
            expect(globalJs).toContain("kesiswaan_group");
            expect(globalJs).toContain("'yearbook-admin.html'");
        });

        test('yearbook-admin.html memiliki 4 tab lengkap dan tombol preview publik', () => {
            expect(yearbookAdminHtml).toContain('id="section-monitoring"');
            expect(yearbookAdminHtml).toContain('id="section-print"');
            expect(yearbookAdminHtml).toContain('id="section-messages"');
            expect(yearbookAdminHtml).toContain('id="section-archives"');
            expect(yearbookAdminHtml).toContain('id="modal-admin-archive"');
            expect(yearbookAdminHtml).toContain('id="btn-preview-public-yearbook"');
            expect(yearbookAdminHtml).toContain('href="yearbook.html"');
            expect(yearbookAdminHtml).toContain('Preview Publik');
        });

        test('yearbook-admin.html mendukung stylesheet cetak A4 portrait @page', () => {
            expect(yearbookAdminHtml).toContain('@page {');
            expect(yearbookAdminHtml).toContain('size: A4 portrait;');
            expect(yearbookAdminHtml).toContain('id="print-yearbook-container"');
            expect(yearbookAdminHtml).toContain('id="print-layout-select"');
            expect(yearbookAdminHtml).toContain('css/yearbook.css');
            expect(yearbookAdminJs).toContain('function waitForPrintAssets');
            expect(yearbookAdminJs).toContain('ybp-cover');
        });

        test('page-yearbook-admin.js mengekspos fungsi administrasi lengkap', () => {
            expect(yearbookAdminJs).toContain('function renderAdminStudentsTable');
            expect(yearbookAdminJs).toContain('function buildAdminPrintPages');
            expect(yearbookAdminJs).toContain('function renderAdminMessagesTable');
            expect(yearbookAdminJs).toContain('async function loadAdminArchives');
            expect(yearbookAdminJs).toContain('window.toggleStudentPublishStatus = async function');
            expect(yearbookAdminJs).toContain('window.triggerAdminPrint = async function');
            expect(yearbookAdminJs).toContain('window.toggleApproveMessageAdmin = async function');
            expect(yearbookAdminJs).toContain('window.deleteMessageAdmin = async function');
            expect(yearbookAdminJs).toContain('window.deleteAdminArchive = async function');
        });

        test('page-yearbook-admin.js terikat pada onAuthStateChanged, RBAC hasPageAccess, dan initLayout', () => {
            expect(yearbookAdminJs).toContain('onAuthStateChanged(auth, async (user) => {');
            expect(yearbookAdminJs).toContain('initLayout(effectiveRole)');
            expect(yearbookAdminJs).toContain("hasPageAccess('yearbook-admin.html')");
            expect(yearbookAdminJs).toContain("mainEl.classList.remove('hidden')");
        });
    });
});
