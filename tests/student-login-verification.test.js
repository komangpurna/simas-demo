const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

describe('Student Login Verification & PWA Meta Tag Suite', () => {
    const indexPath = path.join(projectRoot, 'index.html');
    const indexContent = fs.readFileSync(indexPath, 'utf-8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
    const configJs = fs.readFileSync(path.join(projectRoot, 'js', 'config.js'), 'utf-8');
    const prdSimas = fs.readFileSync(path.join(projectRoot, 'PRD_SIMAS.md'), 'utf-8');
    const changelogMd = fs.readFileSync(path.join(projectRoot, 'CHANGELOG.md'), 'utf-8');

    test('Memastikan variabel verification dideklarasikan di luar blok try agar dapat diakses oleh token setter', () => {
        // Harus ada deklarasi 'let verification;' sebelum blok try
        expect(indexContent).toMatch(/let\s+verification\s*;/);
        // Dan di dalam try adalah penugasan ke 'verification = await cfClient.verifyStudentCredentials'
        expect(indexContent).toMatch(/verification\s*=\s*await\s+cfClient\.verifyStudentCredentials/);
        // Serta pengecekan token setelah try block
        expect(indexContent).toMatch(/if\s*\(\s*verification\?\.\s*token\s*\)/);
    });

    test('Memastikan meta tag mobile-web-app-capable terpasang untuk mengatasi deprecation apple-mobile-web-app-capable', () => {
        expect(indexContent).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
        expect(indexContent).toContain('<meta name="mobile-web-app-capable" content="yes">');
    });

    test('Memastikan versi aplikasi tersinkronisasi di seluruh file SSOT (package.json, PRD, config, CHANGELOG)', () => {
        const version = packageJson.version;
        expect(version).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
        expect(configJs).toContain(`export const APP_VERSION = "${version}";`);
        expect(prdSimas).toContain(`[${version}]`);
        expect(changelogMd).toContain(`[${version}]`);
    });

    test('Memastikan Tab Catatan Guru (Perwalian) di portal-siswa.html memiliki label Catatan Guru dan elemen informasi ganda Wali Kelas dan Guru Wali', () => {
        const portalPath = path.join(projectRoot, 'portal-siswa.html');
        const portalHtml = fs.readFileSync(portalPath, 'utf-8');

        // Memastikan Tombol Navigasi Tab berlabel Catatan Guru
        expect(portalHtml).toContain('id="tab-wali"');
        expect(portalHtml).toContain('Catatan Guru');

        // Memastikan Card Profil Wali Kelas & Guru Wali
        expect(portalHtml).toContain('id="info-wali-kelas-name"');
        expect(portalHtml).toContain('id="info-wali-kelas-sub"');
        expect(portalHtml).toContain('id="info-wali-kelas-action"');

        expect(portalHtml).toContain('id="info-guru-wali-name"');
        expect(portalHtml).toContain('id="info-guru-wali-sub"');
        expect(portalHtml).toContain('id="info-guru-wali-action"');

        // Memastikan Footer Ringkasan Dua Wali
        expect(portalHtml).toContain('id="nama-wali-kelas"');
        expect(portalHtml).toContain('id="nama-guru-wali"');
    });

    test('Memastikan alur sesi siswa higienis dan verifikasi token dipakai bersama', () => {
        const portalJsPath = path.join(projectRoot, 'js', 'page-portal-siswa.js');
        const portalJs = fs.readFileSync(portalJsPath, 'utf-8');
        const cfClientJs = fs.readFileSync(path.join(projectRoot, 'js', 'cloudflare-client.js'), 'utf-8');
        const workerJs = fs.readFileSync(path.join(projectRoot, 'cloudflare', 'worker.js'), 'utf-8');

        // 1. Portal memakai helper verifikasi; login meminta klaim terbaru setelah gateway.
        expect(portalJs).toContain('verifyStudentSession(user, savedNIS');
        expect(indexContent).toContain('verifyStudentSession(studentLoginUser, targetNIS');
        expect(indexContent).toContain('forceRefresh: true');

        // 2. Injeksi X-Student-Token pada request cfClient
        expect(cfClientJs).toContain("headers['X-Student-Token']");

        // 3. Dukungan getVerifiedStudentSession pada endpoint worker students/:nis
        expect(workerJs).toContain("getVerifiedStudentSession(request, env, authResult)");

        // 4. index.html tidak melakukan localStorage.clear() destruktif pasca-login
        expect(indexContent).not.toMatch(/signInAnonymously[\s\S]{1,500}localStorage\.clear\(\)/);
    });
});
