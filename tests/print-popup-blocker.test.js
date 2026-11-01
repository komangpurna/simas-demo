/**
 * tests/print-popup-blocker.test.js
 * Unit test untuk memastikan proteksi pop-up blocker pada fitur cetak rapor afektif siswa
 * di js/page-students.js dan js/page-wali-kelas.js.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const studentsJs = fs.readFileSync(path.join(root, 'js/page-students.js'), 'utf8');
const waliJs = fs.readFileSync(path.join(root, 'js/page-wali-kelas.js'), 'utf8');
const monitoringKbmJs = fs.readFileSync(path.join(root, 'js/page-monitoring-kbm.js'), 'utf8');
const configJs = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
const prdSimas = fs.readFileSync(path.join(root, 'PRD_SIMAS.md'), 'utf8');
const changelogMd = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

describe('Proteksi Browser Pop-up Blocker pada Fitur Cetak Rapor & Surat Keterangan', () => {

    test('1. js/page-students.js memiliki guard clause if (!printWindow) pada window.printReportCard', () => {
        const printReportCardIndex = studentsJs.indexOf('window.printReportCard = async function');
        expect(printReportCardIndex).toBeGreaterThan(-1);

        const printReportCardBlock = studentsJs.slice(printReportCardIndex, printReportCardIndex + 12000);
        expect(printReportCardBlock).toContain("const printWindow = window.open('', '_blank');");
        expect(printReportCardBlock).toContain('if (!printWindow) {');
        expect(printReportCardBlock).toContain('Pop-up Terblokir');
        expect(printReportCardBlock).toContain('return;');
    });

    test('2. js/page-students.js memiliki guard clause if (!printWindow) pada window.printSuratKeterangan', () => {
        const printSuratIndex = studentsJs.indexOf('window.printSuratKeterangan = function');
        expect(printSuratIndex).toBeGreaterThan(-1);

        const printSuratBlock = studentsJs.slice(printSuratIndex, printSuratIndex + 2000);
        expect(printSuratBlock).toContain("const printWindow = window.open('', '_blank');");
        expect(printSuratBlock).toContain('if (!printWindow) {');
        expect(printSuratBlock).toContain('Pop-up Terblokir');
    });

    test('3. js/page-wali-kelas.js memiliki guard clause if (!printWin) pada window.printReportCardWali', () => {
        const printWaliIndex = waliJs.indexOf('window.printReportCardWali = async function');
        expect(printWaliIndex).toBeGreaterThan(-1);

        const printWaliBlock = waliJs.slice(printWaliIndex, printWaliIndex + 12000);
        expect(printWaliBlock).toContain("const printWin = window.open('', '_blank');");
        expect(printWaliBlock).toContain('if (!printWin) {');
        expect(printWaliBlock).toContain('Pop-up Terblokir');
        expect(printWaliBlock).toContain('return;');
    });

    test('4. js/page-monitoring-kbm.js memiliki guard clause if (!printWindow) pada window.printDetailGuru', () => {
        const printDetailIndex = monitoringKbmJs.indexOf('window.printDetailGuru = function');
        expect(printDetailIndex).toBeGreaterThan(-1);

        const printDetailBlock = monitoringKbmJs.slice(printDetailIndex, printDetailIndex + 2000);
        expect(printDetailBlock).toContain('const printWindow = window.open("", "_blank");');
        expect(printDetailBlock).toContain('if (!printWindow) {');
        expect(printDetailBlock).toContain('Pop-up Terblokir');
        expect(printDetailBlock).toContain('return;');
    });

    test('5. Simulasi penanganan ketika window.open mengembalikan null (pop-up terblokir)', () => {
        let swalTitle = '';
        let toastTitle = '';
        const mockSwal = {
            fire: (opts) => { swalTitle = opts.title; }
        };
        const mockShowToast = (title, msg, type) => {
            toastTitle = title;
        };

        const simulatePrintWithBlockedPopup = (windowInstance) => {
            const printWin = windowInstance;
            if (!printWin) {
                if (typeof mockSwal !== 'undefined') {
                    mockSwal.fire({
                        icon: 'warning',
                        title: 'Pop-up Terblokir',
                        text: 'Peramban memblokir jendela pratinjau cetak.'
                    });
                } else if (typeof mockShowToast === 'function') {
                    mockShowToast("Pop-up Terblokir", "Harap izinkan pop-up peramban.", "warning");
                }
                return false;
            }
            printWin.document.write('<html></html>');
            return true;
        };

        expect(simulatePrintWithBlockedPopup(null)).toBe(false);
        expect(swalTitle).toBe('Pop-up Terblokir');

        // Simulasi jika berhasil dibuka
        const mockDoc = { write: () => {}, close: () => {} };
        const mockWindow = { document: mockDoc };
        expect(simulatePrintWithBlockedPopup(mockWindow)).toBe(true);
    });

    test('6. Sinkronisasi versi di package.json, config.js, PRD_SIMAS.md, dan CHANGELOG.md', () => {
        expect(pkg.version).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
        expect(configJs).toContain(`export const APP_VERSION = "${pkg.version}";`);
        expect(prdSimas).toContain(`[${pkg.version}]`);
        expect(changelogMd).toContain(`[${pkg.version}]`);
    });
});
