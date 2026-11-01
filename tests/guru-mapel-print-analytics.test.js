/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('Verifikasi Fitur Cetak Terpadu Leger Nilai & Laporan Analisis Penilaian (guru-mapel)', () => {
    const root = path.resolve(__dirname, '..');
    const jsPath = path.join(root, 'js', 'page-guru-mapel.js');
    const htmlPath = path.join(root, 'guru-mapel.html');
    const configPath = path.join(root, 'js', 'config.js');
    const prdPath = path.join(root, 'PRD_SIMAS.md');
    const changelogPath = path.join(root, 'CHANGELOG.md');
    const packagePath = path.join(root, 'package.json');

    const jsContent = fs.readFileSync(jsPath, 'utf8');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const configContent = fs.readFileSync(configPath, 'utf8');
    const prdContent = fs.readFileSync(prdPath, 'utf8');
    const changelogContent = fs.readFileSync(changelogPath, 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

    describe('1. Verifikasi Markup Statis & Tombol Cetak di HTML', () => {
        beforeEach(() => {
            document.body.innerHTML = htmlContent;
        });

        test('Tombol cetak #btn-print-gradebook tersedia di toolbar wrapper penilaian', () => {
            const btn = document.getElementById('btn-print-gradebook');
            expect(btn).not.toBeNull();
            expect(btn.getAttribute('onclick')).toBe('window.printGradebookAnalytics()');
            expect(btn.textContent).toContain('Cetak Dokumen');
        });

        test('Tombol cetak #btn-print-analytics-card tersedia di header kartu analisis nilai', () => {
            const btn = document.getElementById('btn-print-analytics-card');
            expect(btn).not.toBeNull();
            expect(btn.getAttribute('onclick')).toBe('window.printGradebookAnalytics()');
            expect(btn.textContent).toContain('Cetak Nilai & Analisis (A4)');
        });

        test('Tombol cetak tidak ditaruh di samping export excel pada header banner, melainkan khusus pada tab penilaian', () => {
            const bannerContainer = document.querySelector('.micro-filter-btn[onclick="window.exportToExcel()"]')?.parentElement;
            expect(bannerContainer).not.toBeNull();
            const printInBanner = bannerContainer.querySelector('button[onclick="window.printGradebookAnalytics()"]');
            expect(printInBanner).toBeNull();

            // Memastikan tombol cetak hanya berada di toolbar penilaian dan kartu analisis nilai
            const printBtns = document.querySelectorAll('button[onclick="window.printGradebookAnalytics()"]');
            expect(printBtns.length).toBe(2);
            expect(document.getElementById('btn-print-gradebook')).not.toBeNull();
            expect(document.getElementById('btn-print-analytics-card')).not.toBeNull();
        });

        test('Stubs array di guru-mapel.html menyertakan printGradebookAnalytics dan printLegerAndAnalytics', () => {
            expect(htmlContent).toContain("'printGradebookAnalytics'");
            expect(htmlContent).toContain("'printLegerAndAnalytics'");
        });
    });

    describe('2. Verifikasi Definisi Fungsi & Logika Pencetakan di JS', () => {
        test('Fungsi printGradebookAnalytics dan alias printLegerAndAnalytics terdaftar di window', () => {
            expect(jsContent).toContain('window.printGradebookAnalytics = async function ()');
            expect(jsContent).toContain('window.printLegerAndAnalytics = window.printGradebookAnalytics;');
        });

        test('Menyertakan struktur Halaman 1: Leger Nilai & Rekapitulasi Statistik', () => {
            expect(jsContent).toContain('DAFTAR NILAI HASIL BELAJAR PESERTA DIDIK');
            expect(jsContent).toContain('LEGER NILAI AKADEMIK KELAS');
            expect(jsContent).toContain('RATA-RATA KELAS');
            expect(jsContent).toContain('NILAI TERTINGGI (MAX)');
            expect(jsContent).toContain('NILAI TERENDAH (MIN)');
            expect(jsContent).toContain('JUMLAH TUNTAS');
            expect(jsContent).toContain('JUMLAH REMIDIAL');
        });

        test('Menyertakan struktur Halaman 2: Pemisah Halaman & Laporan Analisis Lengkap', () => {
            expect(jsContent).toContain('class="page-break"');
            expect(jsContent).toContain('LAPORAN ANALISIS &amp; EVALUASI PENILAIAN AKADEMIK KELAS');
            expect(jsContent).toContain('I. Rangkuman Statistik Penilaian Kelas');
            expect(jsContent).toContain('II. Analisis Detail Per Komponen Penilaian');
            expect(jsContent).toContain('III. Catatan &amp; Rekomendasi Pedagogis Guru');
            expect(jsContent).toContain('IV. Daftar Peserta Didik Memerlukan Remediasi');
            expect(jsContent).toContain('V. LEMBAR PENGESAHAN DOKUMEN RESMI');
            expect(jsContent).toContain('Kepala SMA Negeri 1 Abang');
            expect(jsContent).toContain('Guru Mata Pelajaran');
        });

        test('Menyertakan sanitasi XSS dan guard clause pemblokiran pop-up', () => {
            expect(jsContent).toContain('function esc(str)');
            expect(jsContent).toContain('Pop-up Terblokir');
        });

        test('Poin 1, 3, dan 4: Optimasi layout presisi 1 lembar leger diterapkan di CSS dan HTML', () => {
            // Poin 1: Margin cetak diperkecil
            expect(jsContent).toContain('margin: 4mm 7mm 4mm 7mm;');
            // Poin 3: Identitas KBM 2 baris
            expect(jsContent).toContain('.meta-table {');
            expect(jsContent).toContain('font-size: 7.5pt;');
            expect(jsContent).toContain('<td class="meta-lbl">Batas KKM</td>');
            // Poin 4: Kepadatan baris tabel leger
            expect(jsContent).toContain('font-size: 7.2pt;');
            expect(jsContent).toContain('line-height: 1.15;');
            expect(jsContent).toContain('padding: 1.5px 2.5px;');
            // Sisanya dipertahankan: Kop sekolah tetap 95px
            expect(jsContent).toContain('max-height: 95px;');
        });
    });

    describe(`3. Verifikasi Sinkronisasi Versi Aplikasi (${packageJson.version})`, () => {

        test('package.json memiliki versi yang tepat', () => {
            expect(packageJson.version).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
            const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
            expect(lock.version).toBe(packageJson.version);
            expect(lock.packages[''].version).toBe(packageJson.version);
        });

        test('js/config.js memuat APP_VERSION yang tersinkronisasi', () => {
            expect(configContent).toContain(`export const APP_VERSION = "${packageJson.version}";`);
        });

        test('PRD_SIMAS.md memuat versi dan entri status yang mutakhir', () => {
            const latest = changelogContent.match(/^## \[([\d.]+)\] \/ \[([\d.]+)\] - (\d{4}-\d{2}-\d{2})/m);
            expect(latest).not.toBeNull();
            expect(prdContent).toContain(`\`v${latest[1]}\` / \`[${packageJson.version}]\``);
            expect(prdContent).toContain(`| **Status Dokumen** | **v${latest[1]}**`);
            expect(prdContent).toContain('window.printGradebookAnalytics');
        });

        test('guru-mapel.html memuat script tag versi mutakhir', () => {
            expect(htmlContent).toContain(`js/page-guru-mapel.js?v=${packageJson.version}`);
        });

        test.each([
            ['e-lab.html', 'page-e-lab.js'],
            ['portal-siswa.html', 'page-portal-siswa.js'],
            ['wali-kelas.html', 'page-wali-kelas.js'],
            ['siswa.html', 'page-students.js']
        ])('cache-buster rilis %s tersinkronisasi', (file, script) => {
            expect(fs.readFileSync(path.join(root, file), 'utf8')).toContain(`js/${script}?v=${packageJson.version}`);
        });

        test('CHANGELOG.md memuat catatan rilis versi mutakhir', () => {
            const latestEntry = changelogContent.split(/^## /m)[1];
            const [year, month, day] = packageJson.version.split('.');
            expect(latestEntry.split('\n')[0].trim()).toMatch(
                new RegExp(`^\\[[\\d.]+\\] / \\[${packageJson.version.replace(/\./g, '\\.')}\\] - 20${year}-${month}-${day}$`)
            );
            expect(changelogContent).toContain('Finalisasi Cetak Leger Nilai & Analisis Penilaian Guru Mapel A4');
            const cacheName = fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/const CACHE_NAME = '([^']+)'/)[1];
            expect(changelogContent).toContain(cacheName);
        });
    });
});
