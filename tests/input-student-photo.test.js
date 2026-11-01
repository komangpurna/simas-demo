const fs = require('fs');
const path = require('path');

describe('Input Catatan Siswa - Integrasi Foto Siswa pada Dropdown & OWASP Security', () => {
    const rootDir = path.resolve(__dirname, '..');
    const inputHtmlPath = path.join(rootDir, 'input.html');
    const pageInputPath = path.join(rootDir, 'js/page-input.js');

    let inputHtml;
    let pageInputCode;

    beforeAll(() => {
        inputHtml = fs.readFileSync(inputHtmlPath, 'utf8');
        pageInputCode = fs.readFileSync(pageInputPath, 'utf8');
    });

    describe('1. Struktur Elemen DOM pada input.html', () => {
        test('memiliki elemen input pencarian dan container dropdown siswa', () => {
            expect(inputHtml).toContain('id="student-search"');
            expect(inputHtml).toContain('id="student-dropdown"');
        });

        test('memuat berkas js/page-input.js dengan tag versi rilis yang tersinkronisasi', () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
            expect(inputHtml).toContain(`src="js/page-input.js?v=${pkg.version}"`);
        });
    });

    describe('2. Logika Pemrosesan Foto pada js/page-input.js', () => {
        test('mengimpor resolvePhotoUrl dari config.js', () => {
            expect(pageInputCode).toContain('resolvePhotoUrl');
            expect(pageInputCode).toMatch(/import\s*\{[^}]*resolvePhotoUrl[^}]*\}\s*from\s*['"]\.\/config\.js['"]/);
        });

        test('memetakan activePhotoUrl pada studentsCache di loadStudentList()', () => {
            expect(pageInputCode).toContain('activePhotoUrl: d.activePhotoUrl || d.active_photo_url || d.photoUrl || d.photo_url || d.foto || d.foto_url || \'\'');
        });

        test('merender avatar foto thumbnail dengan fallback inisial nama pada dropdown', () => {
            expect(pageInputCode).toContain('const avatarThumb = safePhoto');
            expect(pageInputCode).toContain('${avatarThumb}');
            expect(pageInputCode).toContain('onerror="this.onerror=null; this.classList.add(\'hidden\'); if(this.nextElementSibling) this.nextElementSibling.classList.remove(\'hidden\');"');
        });
    });

    describe('3. Keamanan OWASP ASVS Level 2 (Anti-XSS & URL Sanitization)', () => {
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
