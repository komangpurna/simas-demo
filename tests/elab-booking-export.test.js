/**
 * Unit Test: Fitur Export Excel Penggunaan Lab Berdasarkan Booking ACC Siap Cetak A4
 * Memverifikasi:
 * 1. e-lab.html memuat tombol `#btn-booking-export-excel` dan modal `#modal-export-booking`.
 * 2. Modal dialog berdiri mandiri sebagai top-level sibling di luar <main> (anti-nesting) & bebas leading-icon absolute.
 * 3. js/page-e-lab.js mendefinisikan buildLabUsageExportWorkbook, window.openBookingExportModal, dan window.submitExportLabUsage.
 * 4. Tipografi standar Times New Roman (TNR) dan page setup A4 Landscape siap cetak (paperSize: 9, fitToWidth: 1, printTitlesRow: '11:11').
 * 5. Kop surat resmi kedinasan, judul dokumen, metadata laporan, dan 11 kolom data.
 * 6. Susunan 3 tanda tangan pengesahan bertingkat (Baris atas: Kepala Lab & Koordinator Lab, Baris bawah: Kepala Sekolah).
 * 7. Simulasi eksekusi buildLabUsageExportWorkbook dengan mock ExcelJS berjalan lancar (termasuk kasus data kosong).
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Verifikasi Fitur Export Excel Penggunaan Laboratorium (Siap Cetak A4 Landscape & 3 TTD Bertingkat)', () => {
    const root = path.resolve(__dirname, '..');
    const htmlPath = path.join(root, 'e-lab.html');
    const jsPath = path.join(root, 'js', 'page-e-lab.js');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    test('1. e-lab.html memuat tombol toolbar export booking dan modal dialog export', () => {
        expect(htmlContent).toContain('id="btn-booking-export-excel"');
        expect(htmlContent).toContain('onclick="window.openBookingExportModal()"');
        expect(htmlContent).toContain('id="modal-export-booking"');
        expect(htmlContent).toContain('id="form-export-booking"');
        expect(htmlContent).toContain('id="export-booking-start"');
        expect(htmlContent).toContain('id="export-booking-end"');
        expect(htmlContent).toContain('id="export-booking-lab"');
        expect(htmlContent).toContain('id="btn-submit-export-booking"');
    });

    test('2. Modal export berdiri sebagai top-level sibling di luar <main> (anti-nesting)', () => {
        const mainCloseIdx = htmlContent.indexOf('</main>');
        const modalIdx = htmlContent.indexOf('id="modal-export-booking"');
        expect(mainCloseIdx).toBeGreaterThan(0);
        expect(modalIdx).toBeGreaterThan(mainCloseIdx);
    });

    test('3. js/page-e-lab.js mendefinisikan buildLabUsageExportWorkbook dan handlers', () => {
        expect(jsContent).toContain('export function buildLabUsageExportWorkbook(');
        expect(jsContent).toContain('window.openBookingExportModal = function');
        expect(jsContent).toContain('window.submitExportLabUsage = async function');
        expect(jsContent).toContain("'btn-booking-export-excel': canApprove");
    });

    test('4. buildLabUsageExportWorkbook mengonfigurasi font Times New Roman (TNR) dan Page Setup A4 Landscape', () => {
        expect(jsContent).toContain("const FONT_FAMILY = 'Times New Roman';");
        expect(jsContent).toContain('paperSize: 9'); // ISO A4
        expect(jsContent).toContain("orientation: 'landscape'");
        expect(jsContent).toContain('fitToWidth: 1');
        expect(jsContent).toContain('fitToHeight: 0');
        expect(jsContent).toContain("printTitlesRow: '11:11'"); // Header berulang otomatis
    });

    test('5. buildLabUsageExportWorkbook menyertakan Kop Surat Resmi dan 11 Header Kolom', () => {
        expect(jsContent).toContain('PEMERINTAH PROVINSI');
        expect(jsContent).toContain('DINAS PENDIDIKAN, KEPEMUDAAN DAN OLAHRAGA');
        expect(jsContent).toContain('REKAPITULASI PENGGUNAAN LABORATORIUM');
        expect(jsContent).toContain("'MATA PELAJARAN / TOPIK PRAKTIKUM'");
        expect(jsContent).toContain("'DIVERIFIKASI OLEH'");
        expect(jsContent).toContain('TOTAL PENGGUNAAN LABORATORIUM');
    });

    test('6. buildLabUsageExportWorkbook menyertakan blok tanda tangan bertingkat 3 pihak', () => {
        expect(jsContent).toContain("'Mengetahui / Memeriksa,'");
        expect(jsContent).toContain("'Kepala Laboratorium,'");
        expect(jsContent).toContain('kepalaLabName');
        expect(jsContent).toContain('koordinatorName');
        expect(jsContent).toContain('headmasterTitle');
        expect(jsContent).toContain('headmasterName');
    });

    test('7. Eksekusi simulasi buildLabUsageExportWorkbook dengan mock ExcelJS berjalan mulus', () => {
        class MockCell {
            constructor() {
                this.value = null;
                this.font = null;
                this.alignment = null;
                this.border = null;
                this.fill = null;
            }
        }

        class MockRow {
            constructor() {
                this.cells = {};
                this.height = 15;
            }
            getCell(col) {
                if (!this.cells[col]) this.cells[col] = new MockCell();
                return this.cells[col];
            }
        }

        class MockWorksheet {
            constructor(name, options) {
                this.name = name;
                this.options = options;
                this.pageSetup = options.pageSetup || {};
                this.rows = {};
                this.columns = {};
                this.merges = [];
                this.images = [];
            }
            mergeCells(range) {
                this.merges.push(range);
            }
            addImage(imageId, pos) {
                this.images.push({ imageId, pos });
            }
            getRow(rowNum) {
                if (!this.rows[rowNum]) this.rows[rowNum] = new MockRow();
                return this.rows[rowNum];
            }
            getCell(r, c) {
                if (typeof r === 'string') {
                    const match = r.match(/^([A-Z]+)(\d+)$/);
                    if (match) {
                        const rowNum = parseInt(match[2], 10);
                        return this.getRow(rowNum).getCell(match[1]);
                    }
                    return new MockCell();
                }
                return this.getRow(r).getCell(c);
            }
            getColumn(colIdx) {
                if (!this.columns[colIdx]) this.columns[colIdx] = { width: 10 };
                return this.columns[colIdx];
            }
        }

        class MockWorkbook {
            constructor() {
                this.worksheets = [];
                this.images = [];
            }
            addImage(opt) {
                const id = this.images.length + 1;
                this.images.push({ id, ...opt });
                return id;
            }
            addWorksheet(name, options) {
                const ws = new MockWorksheet(name, options);
                this.worksheets.push(ws);
                return ws;
            }
        }

        const MockExcelJS = {
            Workbook: MockWorkbook
        };

        const sampleBookings = [
            {
                id: 'booking-1',
                tanggal: '2026-10-27',
                hari: 'Selasa',
                jam_mulai: 1,
                jam_selesai: 3,
                waktu_mulai: '07:30',
                waktu_selesai: '09:45',
                lab_nama: 'Laboratorium Komputer 1',
                pemohon_nama: 'I Komang Purna, S.Pd.',
                pemohon_nip: '198501012010011001',
                kelas: 'X-E1',
                kegiatan: 'Praktikum Pemrograman Web',
                catatan: 'Pengenalan HTML5 & CSS3',
                diproses_oleh: 'Admin Lab',
                status: 'approved'
            },
            {
                id: 'booking-2',
                tanggal: '2026-10-28',
                hari: 'Rabu',
                jam_mulai: 4,
                jam_selesai: 6,
                waktu_mulai: '10:00',
                waktu_selesai: '12:15',
                lab_nama: 'Laboratorium Kimia',
                pemohon_nama: 'Ni Wayan S., S.Pd.',
                pemohon_nip: '198902022015022002',
                kelas: 'XI-MIPA 2',
                kegiatan: 'Praktikum Titrasi Asam Basa',
                catatan: 'Menggunakan buret dan labu erlenmeyer',
                diproses_oleh: 'Koordinator Lab Kimia',
                status: 'approved'
            }
        ];

        // Simulasi ekstraksi fungsi buildLabUsageExportWorkbook dari js/page-e-lab.js
        const funcMatch = jsContent.match(/export function buildLabUsageExportWorkbook\([\s\S]*?\n\}/);
        expect(funcMatch).not.toBeNull();

        const functionCode = funcMatch[0].replace('export function', 'function');
        const schoolConfigMock = {
            schoolName: 'SMA Negeri 1 Abang',
            schoolNameUpper: 'SMA NEGERI 1 ABANG',
            schoolProvince: 'Bali',
            schoolCity: 'Abang',
            headmasterName: 'I Ketut Kertayasa, S.Pd., M.Pd.',
            headmasterNIP: '196812311995121004',
            headmasterTitle: 'Kepala SMA Negeri 1 Abang'
        };

        const JAM_PELAJARAN_MOCK = [
            { jp: 1, mulai: '07:30', selesai: '08:15' },
            { jp: 2, mulai: '08:15', selesai: '09:00' },
            { jp: 3, mulai: '09:00', selesai: '09:45' },
            { jp: 4, mulai: '10:00', selesai: '10:45' },
            { jp: 5, mulai: '10:45', selesai: '11:30' },
            { jp: 6, mulai: '11:30', selesai: '12:15' }
        ];

        const runner = new Function(
            'bookings',
            'meta',
            'ExcelJSLib',
            'SCHOOL_CONFIG',
            'JAM_PELAJARAN',
            `${functionCode}\nreturn buildLabUsageExportWorkbook(bookings, meta, ExcelJSLib);`
        );

        // Uji Skenario 1: Eksekusi dengan Data Booking
        const wbWithData = runner(
            sampleBookings,
            {
                schoolConfig: schoolConfigMock,
                labName: 'Semua Laboratorium',
                startDate: '2026-10-01',
                endDate: '2026-10-31',
                printDate: '27 Oktober 2026',
                kepalaLabName: 'Drs. I Wayan Sudarsana',
                kepalaLabNip: '197001011995031002',
                koordinatorName: 'I Made Ariawan, S.Kom.',
                koordinatorNip: '198203152008011007'
            },
            MockExcelJS,
            schoolConfigMock,
            JAM_PELAJARAN_MOCK
        );

        expect(wbWithData.worksheets.length).toBe(1);
        const ws = wbWithData.worksheets[0];
        expect(ws.pageSetup.orientation).toBe('landscape');
        expect(ws.pageSetup.paperSize).toBe(9);
        expect(ws.rows[11].getCell(1).value).toBe('NO');
        expect(ws.rows[11].getCell(11).value).toBe('DIVERIFIKASI OLEH');
        expect(ws.rows[12].getCell(1).value).toBe(1);
        expect(ws.rows[12].getCell(5).value).toBe('Laboratorium Komputer 1');
        expect(ws.rows[13].getCell(1).value).toBe(2);
        expect(ws.rows[13].getCell(5).value).toBe('Laboratorium Kimia');

        // Uji Skenario 2: Eksekusi dengan Data Kosong (Anti TypeError)
        const wbEmpty = runner(
            [],
            {
                schoolConfig: schoolConfigMock,
                labName: 'Laboratorium Biologi',
                startDate: '2026-10-01',
                endDate: '2026-10-31'
            },
            MockExcelJS,
            schoolConfigMock,
            JAM_PELAJARAN_MOCK
        );

        expect(wbEmpty.worksheets.length).toBe(1);
        const wsEmpty = wbEmpty.worksheets[0];
        expect(wsEmpty.rows[12].getCell('A').value).toContain('Tidak ada data penggunaan');
    });
});
