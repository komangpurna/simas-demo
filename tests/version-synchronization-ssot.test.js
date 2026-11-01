/**
 * tests/version-synchronization-ssot.test.js
 *
 * Verifikasi Sistemik: Single Source of Truth (SSOT) Sinkronisasi Versi Aplikasi
 * Memastikan skrip scripts/sync-version.js berjalan dengan presisi dan seluruh berkas
 * repositori (package.json, package-lock.json, js/config.js, PRD, CHANGELOG, serta berkas HTML)
 * 100% konsisten pada versi rilis yang sama tanpa anomali.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');

describe('Verifikasi SSOT Sinkronisasi Versi Aplikasi & Cache-Buster HTML', () => {
    const pkgPath = path.join(rootDir, 'package.json');
    const lockPath = path.join(rootDir, 'package-lock.json');
    const configPath = path.join(rootDir, 'js', 'config.js');
    const prdPath = path.join(rootDir, 'PRD_SIMAS.md');
    const changelogPath = path.join(rootDir, 'CHANGELOG.md');

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const version = pkg.version;

    test('1. Format versi package.json mematuhi standar harian YY.MM.DD.REV', () => {
        expect(version).toBeDefined();
        expect(version).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
    });

    test('2. package-lock.json tersinkronisasi 100% dengan package.json', () => {
        expect(fs.existsSync(lockPath)).toBe(true);
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        expect(lock.version).toBe(version);
        expect(lock.packages[''].version).toBe(version);
    });

    test('3. js/config.js memuat APP_VERSION yang identik dengan package.json', () => {
        const configContent = fs.readFileSync(configPath, 'utf8');
        expect(configContent).toContain(`export const APP_VERSION = "${version}";`);
    });

    test('4. PRD_SIMAS.md dan CHANGELOG.md memuat versi rilis terkini', () => {
        const prdContent = fs.readFileSync(prdPath, 'utf8');
        const changelogContent = fs.readFileSync(changelogPath, 'utf8');

        expect(prdContent).toContain(`[${version}]`);
        expect(changelogContent).toContain(`[${version}]`);
    });

    test('5. scripts/sync-version.js --check lolos dengan 0 diskrepansi', () => {
        const scriptPath = path.join(rootDir, 'scripts', 'sync-version.js');
        expect(fs.existsSync(scriptPath)).toBe(true);

        const stdout = execSync(`node "${scriptPath}" --check`, {
            cwd: rootDir,
            encoding: 'utf8'
        });

        expect(stdout).toContain('[SYNC CHECK PASSED]');
        expect(stdout).toContain(version);
    });

    test.each([
        ['guru-mapel.html', 'js/page-guru-mapel.js'],
        ['guru-wali.html', 'js/page-guru-wali.js'],
        ['wali-kelas.html', 'js/page-wali-kelas.js'],
        ['siswa.html', 'js/page-students.js'],
        ['keuangan.html', 'js/page-keuangan.js'],
        ['e-lab.html', 'js/page-e-lab.js'],
        ['monitoring-kbm.html', 'js/page-monitoring-kbm.js'],
        ['jurnal.html', 'js/page-jurnal.js'],
        ['portal-siswa.html', 'js/page-portal-siswa.js'],
        ['ranking-kelas.html', 'js/page-ranking-kelas.js'],
        ['library/index.html', 'index.js'],
        ['library/presensi-perpus.html', 'presensi-perpus.js'],
        ['sukaduka/suka-duka.html', 'suka-duka.js']
    ])('6. Halaman utama %s memuat cache-buster rilis aktif untuk %s', (htmlFile, scriptName) => {
        const fullHtmlPath = path.join(rootDir, htmlFile);
        expect(fs.existsSync(fullHtmlPath)).toBe(true);
        const htmlContent = fs.readFileSync(fullHtmlPath, 'utf8');
        expect(htmlContent).toContain(`${scriptName}?v=${version}`);
    });
});
