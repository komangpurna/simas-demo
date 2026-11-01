/**
 * tests/ekinerja-multipage-print-builder.test.js
 * ====================================================================
 * Test Suite: Multi-Page Manual Print Builder Rekap Realisasi E-Kinerja
 * untuk Guru dan Tenaga Kependidikan (Tendik).
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

describe('Suite Pengujian Multi-Page Print Builder Rekap Realisasi E-Kinerja (Guru & Tendik)', () => {
    const sharedJsPath = path.resolve('js/rekap-infographic.js');
    const teacherJsPath = path.resolve('js/page-beban-kerja.js');
    const employeeJsPath = path.resolve('js/page-e-kinerja-tendik.js');
    const teacherHtmlPath = path.resolve('e-kinerja.html');
    const employeeHtmlPath = path.resolve('e-kinerja-tendik.html');

    const sharedJs = fs.readFileSync(sharedJsPath, 'utf8');
    const teacherJs = fs.readFileSync(teacherJsPath, 'utf8');
    const employeeJs = fs.readFileSync(employeeJsPath, 'utf8');
    const teacherHtml = fs.readFileSync(teacherHtmlPath, 'utf8');
    const employeeHtml = fs.readFileSync(employeeHtmlPath, 'utf8');

    function getRekapInfographicSandbox() {
        let code = sharedJs;
        code = code.replace(/export\s+const\s+/g, 'const ');
        code = code.replace(/export\s+function\s+/g, 'function ');
        code = code.replace(/export\s+default\s+/g, '');
        code += `;\nmodule.exports = { buildRekapInfographicHtml, fitRekapPreviewFrame, isGenericCaption };`;
        const sandbox = {
            module: {},
            exports: {},
            console,
            Date,
            String,
            Number,
            Array,
            Math,
            parseInt,
            window: {}
        };
        vm.runInNewContext(code, sandbox);
        return sandbox.module.exports;
    }

    describe('1. Mesin Template Cetak Bersama (js/rekap-infographic.js)', () => {
        const mod = getRekapInfographicSandbox();

        test('Mendukung mode satu halaman untuk backward compatibility', () => {
            const html = mod.buildRekapInfographicHtml({
                orientation: 'portrait',
                schoolName: 'SMA Negeri 1 Abang',
                title: 'Pelaksanaan Pembelajaran',
                activities: [
                    { date: '2026-10-05', title: 'Kegiatan A' },
                    { date: '2026-10-06', title: 'Kegiatan B' }
                ]
            });

            const pageDivCount = (html.match(/<div class="page\b/g) || []).length;
            expect(pageDivCount).toBe(1);
            expect(html).toContain('Kegiatan A');
            expect(html).toContain('Kegiatan B');
        });

        test('Mendukung mode multi-halaman dengan frame kop, identitas PTK, 4 kotak statistik, dan titimangsa identik', () => {
            const samplePages = [
                [
                    { date: '2026-10-01', title: 'Kegiatan Hal 1 - A' },
                    { date: '2026-10-02', title: 'Kegiatan Hal 1 - B' }
                ],
                [
                    { date: '2026-10-08', title: 'Kegiatan Hal 2 - C' },
                    { date: '2026-10-09', title: 'Kegiatan Hal 2 - D' }
                ]
            ];

            const html = mod.buildRekapInfographicHtml({
                orientation: 'portrait',
                schoolName: 'SMA Negeri 1 Abang',
                title: 'Pelaksanaan Pembelajaran',
                kicker: 'Laporan Realisasi Kinerja Guru',
                person: { name: 'I Komang Purna', nip: '198501012010011001', role: 'Guru Ahli Pertama' },
                stats: [
                    { ico: '⏱', val: '48j 30m', lbl: 'Total waktu' },
                    { ico: '✦', val: '4 Kegiatan', lbl: 'Ditampilkan' },
                    { ico: '🗓', val: '4 Hari', lbl: 'Hari aktif' },
                    { ico: '📍', val: '1x', lbl: 'Dinas luar' }
                ],
                titimangsa: 'Abang, 31 Oktober 2026',
                pages: samplePages
            });

            // Memastikan kedua lembar halaman di-render
            const pageDivMatches = html.match(/<div class="page\b/g) || [];
            expect(pageDivMatches.length).toBe(2);

            // Konten aktivitas terdistribusi sesuai halamannya
            const hal1Idx = html.indexOf('<div class="page');
            const hal2Idx = html.lastIndexOf('<div class="page');
            const actAIdx = html.indexOf('Kegiatan Hal 1 - A');
            const actCIdx = html.indexOf('Kegiatan Hal 2 - C');

            expect(actAIdx).toBeGreaterThan(hal1Idx);
            expect(actAIdx).toBeLessThan(hal2Idx);
            expect(actCIdx).toBeGreaterThan(hal2Idx);

            // Verifikasi bahwa elemen frame (kop sekolah, nama PTK, dan titimangsa) muncul pada setiap halaman
            const occurrencesOfSchool = (html.match(/SMA Negeri 1 Abang/g) || []).length;
            const occurrencesOfPerson = (html.match(/I Komang Purna/g) || []).length;
            const occurrencesOfTitimangsa = (html.match(/Abang, 31 Oktober 2026/g) || []).length;

            expect(occurrencesOfSchool).toBe(2);
            // Muncul 5x: 1x di doc <title>, 2x per halaman (.who dan .sign) x 2 halaman
            expect(occurrencesOfPerson).toBe(5);
            expect(occurrencesOfTitimangsa).toBe(2);
        });

        test('Aturan CSS Print memutus halaman cetak dan mencegah halaman kosong di akhir', () => {
            expect(sharedJs).toContain('@media print');
            expect(sharedJs).toContain('.page {');
            expect(sharedJs).toContain('page-break-after: always;');
            expect(sharedJs).toContain('break-after: page;');
            expect(sharedJs).toContain('.page:last-child {');
            expect(sharedJs).toContain('page-break-after: auto;');
            expect(sharedJs).toContain('break-after: auto;');
        });

        test('fitRekapPreviewFrame memperhitungkan tinggi preview iframe secara proporsional sesuai jumlah halaman', () => {
            const mockFrame = {
                clientWidth: 800,
                style: { height: '' }
            };

            mod.fitRekapPreviewFrame(mockFrame, 'portrait', 2);
            const height2Pages = parseInt(mockFrame.style.height, 10);

            mod.fitRekapPreviewFrame(mockFrame, 'portrait', 1);
            const height1Page = parseInt(mockFrame.style.height, 10);

            expect(height2Pages).toBeGreaterThan(height1Page);
        });
    });

    describe('2. E-Kinerja Guru (js/page-beban-kerja.js)', () => {
        test('Mendefinisikan konstanta batasan multi-halaman', () => {
            expect(teacherJs).toContain('const REKAP_MAX_REPORT_PAGES = 5;');
            expect(teacherJs).toContain('const REKAP_MAX_REPORT_ACTIVITIES = 4;');
        });

        test('Mendaftarkan seluruh window bindings penyusunan multi-halaman', () => {
            expect(teacherJs).toContain('window.workloadAddReportPage = workloadAddReportPage;');
            expect(teacherJs).toContain('window.workloadRemoveReportPage = workloadRemoveReportPage;');
            expect(teacherJs).toContain('window.workloadToggleReportActivityForPage = workloadToggleReportActivityForPage;');
            expect(teacherJs).toContain('window.workloadToggleReportSelectAll = workloadToggleReportSelectAll;');
        });

        test('Drawer memiliki tombol Tambah Halaman dan penanda duplikasi antar-halaman', () => {
            expect(teacherJs).toContain('window.workloadAddReportPage()');
            expect(teacherJs).toContain('Penyusunan Multi-Halaman:');
            expect(teacherJs).toContain('Dipilih di Hal');
            expect(teacherJs).toContain('Sudah dipilih di Halaman');
            expect(teacherJs).toContain('window.workloadRemoveReportPage(');
        });

        test('buildAestheticCategoryReportHtml meneruskan parameter pages ke buildRekapInfographicHtml', () => {
            expect(teacherJs).toContain('buildAestheticCategoryReportHtml(catCode, rekap,');
            expect(teacherJs).toContain('pages: pagesData');
            expect(teacherJs).toContain('return buildRekapInfographicHtml(');
        });
    });

    describe('3. E-Kinerja Tendik (js/page-e-kinerja-tendik.js)', () => {
        test('Mendefinisikan konstanta batasan multi-halaman', () => {
            expect(employeeJs).toContain('export const EMP_REPORT_MAX_PAGES = 5;');
            expect(employeeJs).toContain('export const EMP_REPORT_MAX_ACTIVITIES = 6;');
        });

        test('Mendaftarkan seluruh window bindings penyusunan multi-halaman', () => {
            expect(employeeJs).toContain('window.addEmployeeButirPrintPage = addEmployeeButirPrintPage;');
            expect(employeeJs).toContain('window.removeEmployeeButirPrintPage = removeEmployeeButirPrintPage;');
            expect(employeeJs).toContain('window.toggleEmployeeButirActivityForPage = toggleEmployeeButirActivityForPage;');
            expect(employeeJs).toContain('window.toggleEmployeeButirPrintSelectAll = toggleEmployeeButirPrintSelectAll;');
        });

        test('Drawer memiliki tombol Tambah Halaman dan penanda duplikasi antar-halaman', () => {
            expect(employeeJs).toContain('window.addEmployeeButirPrintPage()');
            expect(employeeJs).toContain('Penyusunan Multi-Halaman:');
            expect(employeeJs).toContain('Dipilih di Hal');
            expect(employeeJs).toContain('Sudah dipilih di Halaman');
            expect(employeeJs).toContain('window.removeEmployeeButirPrintPage(');
        });

        test('buildEmployeeButirInfographicHtml meneruskan parameter pages ke buildRekapInfographicHtml', () => {
            expect(employeeJs).toContain('export function buildEmployeeButirInfographicHtml(data, itemId, options = {})');
            expect(employeeJs).toContain('pages: pagesData');
            expect(employeeJs).toContain('return buildRekapInfographicHtml({');
        });
    });

    describe('4. Integritas DOM Template HTML (Anti-Nesting & Clean Labels)', () => {
        test('e-kinerja.html tidak memuat counter statis /4 yang membatasi multi-page', () => {
            expect(teacherHtml).toContain('id="rekap-selected-act-count"');
            expect(teacherHtml).not.toContain('<span id="rekap-selected-act-count">0</span>/4');
            // Modal cetak di luar main
            const mainCloseIdx = teacherHtml.indexOf('</main>');
            const modalPrintIdx = teacherHtml.indexOf('id="modal-rekap-aesthetic-print"');
            expect(modalPrintIdx).toBeGreaterThan(mainCloseIdx);
        });

        test('e-kinerja-tendik.html tidak memuat counter statis /6 yang membatasi multi-page', () => {
            expect(employeeHtml).toContain('id="emp-print-selected-count"');
            expect(employeeHtml).not.toContain('<span id="emp-print-selected-count">0</span>/6');
            // Modal cetak di luar main
            const mainCloseIdx = employeeHtml.indexOf('</main>');
            const modalPrintIdx = employeeHtml.indexOf('id="modal-employee-butir-print"');
            expect(modalPrintIdx).toBeGreaterThan(mainCloseIdx);
        });
    });
});
