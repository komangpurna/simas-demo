const fs = require('fs');
const path = require('path');

describe('Kasir SPP - Integrasi Pasfoto Siswa & OWASP Security', () => {
    const rootDir = path.resolve(__dirname, '..');
    const keuanganHtmlPath = path.join(rootDir, 'keuangan.html');
    const pageKeuanganPath = path.join(rootDir, 'js/page-keuangan.js');

    let keuanganHtml;
    let pageKeuanganCode;

    beforeAll(() => {
        keuanganHtml = fs.readFileSync(keuanganHtmlPath, 'utf8');
        pageKeuanganCode = fs.readFileSync(pageKeuanganPath, 'utf8');
    });

    describe('1. Struktur Elemen DOM pada keuangan.html', () => {
        test('memiliki wadah kartu info siswa dengan elemen avatar foto lengkap', () => {
            expect(keuanganHtml).toContain('id="student-info-card"');
            expect(keuanganHtml).toContain('id="info-student-avatar-container"');
            expect(keuanganHtml).toContain('id="info-student-avatar-img"');
            expect(keuanganHtml).toContain('id="info-student-avatar-fallback"');
            expect(keuanganHtml).toContain('id="info-student-avatar-zoom-icon"');
            expect(keuanganHtml).toContain('id="info-name"');
            expect(keuanganHtml).toContain('id="info-class"');
            expect(keuanganHtml).toContain('id="info-nis"');
            expect(keuanganHtml).toContain('id="info-rate-badge"');
        });

        test('memiliki modal lightbox pratinjau pasfoto siswa', () => {
            expect(keuanganHtml).toContain('id="modal-preview-student-photo"');
            expect(keuanganHtml).toContain('id="preview-student-img"');
            expect(keuanganHtml).toContain('id="preview-student-fallback"');
            expect(keuanganHtml).toContain('id="preview-student-name"');
            expect(keuanganHtml).toContain('id="preview-student-class"');
            expect(keuanganHtml).toContain('id="preview-student-nis"');
            expect(keuanganHtml).toContain('window.closeStudentPhotoPreview()');
        });

        test('memuat berkas js/page-keuangan.js dengan tag versi rilis yang tersinkronisasi', () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
            expect(keuanganHtml).toContain(`src="js/page-keuangan.js?v=${pkg.version}"`);
        });
    });

    describe('2. Logika Pemrosesan Foto pada js/page-keuangan.js', () => {
        test('mengimpor resolvePhotoUrl dari config.js', () => {
            expect(pageKeuanganCode).toContain('resolvePhotoUrl');
            expect(pageKeuanganCode).toContain("from './config.js'");
        });

        test('memetakan activePhotoUrl pada studentsCache di loadStudentList()', () => {
            expect(pageKeuanganCode).toContain('activePhotoUrl: s.activePhotoUrl || s.active_photo_url || s.photoUrl || s.photo_url || s.foto || null');
        });

        test('merender thumbnail avatar pada hasil pencarian dropdown', () => {
            expect(pageKeuanganCode).toContain('const avatarThumb = safePhoto');
            expect(pageKeuanganCode).toContain('${avatarThumb}');
        });

        test('memperbarui avatar siswa dan menangani fallback pada selectStudent()', () => {
            expect(pageKeuanganCode).toContain('updateAvatarUI = (photoUrl) =>');
            expect(pageKeuanganCode).toContain('window.openStudentPhotoPreview(student.nis, student.name, student.class, photoUrl)');
            expect(pageKeuanganCode).toContain('cfClient.getStudentPhotoInfo(student.nis)');
        });

        test('mereset foto avatar pada clearStudentSearch()', () => {
            expect(pageKeuanganCode).toContain("avatarImg.src = '';");
            expect(pageKeuanganCode).toContain("avatarImg.classList.add('hidden');");
            expect(pageKeuanganCode).toContain("avatarFallback.classList.remove('hidden');");
        });

        test('menyediakan fungsi global modal lightbox pratinjau pasfoto', () => {
            expect(pageKeuanganCode).toContain('window.openStudentPhotoPreview =');
            expect(pageKeuanganCode).toContain('window.closeStudentPhotoPreview =');
        });
    });

    describe('3. Keamanan OWASP ASVK Level 2 (Anti-XSS & URL Sanitization)', () => {
        test('memvalidasi protokol URL foto resmi agar aman dari injeksi javascript:', () => {
            const urlValidatorRegex = /^(https?:|\/|data:image\/)/i;
            expect(urlValidatorRegex.test('/api/photos/student/active/1234.webp')).toBe(true);
            expect(urlValidatorRegex.test('https://simas-smagesa-api.workers.dev/api/photos/student/active/1234.webp')).toBe(true);
            expect(urlValidatorRegex.test("javascript:alert('xss')")).toBe(false);
            expect(urlValidatorRegex.test('data:text/html,<script>alert(1)</script>')).toBe(false);
            expect(urlValidatorRegex.test('vbscript:msgbox(1)')).toBe(false);
        });
    });
});