/**
 * Unit Test: Fitur Export Excel Inventaris E-Lab Siap Cetak A4
 * Memverifikasi:
 * 1. Pustaka ExcelJS termuat di e-lab.html dan tombol export terpasang di toolbar.
 * 2. Fungsi buildInventoryExportWorkbook, fetchKopImageBuffer, dan resolveInventorySigner terdefinisi.
 * 3. Seluruh elemen lembar kerja menggunakan font Times New Roman (TNR) standar kedinasan.
 * 4. Page setup A4 Landscape (paperSize: 9, fitToWidth: 1, printTitlesRow: '11:12').
 * 5. Penyematan gambar kop resmi dari assets/kop.png via wb.addImage & ws.addImage.
 * 6. Penandatangan kontekstual: Koordinator Lab (jika 1 lab) vs Kepala Lab (jika semua lab) beserta resolusi NIP resmi.
 * 7. Simulasi mock eksekusi pembangunan workbook (skenario kop gambar, 1 lab, semua lab, tanpa NIP, dan data kosong).
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Verifikasi Fitur Export Excel Inventaris E-Lab Siap Cetak A4 (Kop Aset & TNR Standar)', () => {
    const root = path.resolve(__dirname, '..');
    const htmlPath = path.join(root, 'e-lab.html');
    const jsPath = path.join(root, 'js', 'page-e-lab.js');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    test('1. e-lab.html memuat pustaka ExcelJS dan tombol toolbar export', () => {
        expect(htmlContent).toContain('js/vendor/exceljs.min.js');
        expect(htmlContent).toContain('id="btn-inv-export-excel"');
        expect(htmlContent).toContain('onclick="window.exportInventoryExcel()"');
        expect(htmlContent).toContain('Export Excel');
    });

    test('2. js/page-e-lab.js mendefinisikan buildInventoryExportWorkbook, fetchKopImageBuffer, dan resolveInventorySigner', () => {
        expect(jsContent).toContain('export function buildInventoryExportWorkbook(');
        expect(jsContent).toContain('export async function fetchKopImageBuffer(');
        expect(jsContent).toContain('export async function resolveInventorySigner(');
        expect(jsContent).toContain('window.exportInventoryExcel = async function');
    });

    test('3. buildInventoryExportWorkbook mengonfigurasi font Times New Roman (TNR) di seluruh elemen', () => {
        expect(jsContent).toContain("const FONT_FAMILY = 'Times New Roman';");
        expect(jsContent).toContain('name: FONT_FAMILY');
    });

    test('4. buildInventoryExportWorkbook mengonfigurasi Page Setup A4 Landscape siap cetak', () => {
        expect(jsContent).toContain('paperSize: 9'); // ISO A4
        expect(jsContent).toContain("orientation: 'landscape'");
        expect(jsContent).toContain('fitToWidth: 1');
        expect(jsContent).toContain('fitToHeight: 0');
        expect(jsContent).toContain("printTitlesRow: '11:12'"); // Header berulang di halaman lanjutan
    });

    test('5. buildInventoryExportWorkbook mendukung penyematan gambar kop resmi dari assets/kop.png', () => {
        expect(jsContent).toContain("wb.addImage({");
        expect(jsContent).toContain("ws.addImage(imageId, {");
        expect(jsContent).toContain("ext: { width: 740, height: 122 }");
    });

    test('6. Penandatangan menyesuaikan konteks: Koordinator Lab jika 1 lab, Kepala Lab jika semua lab, dengan NIP', () => {
        expect(jsContent).toContain("roleTitle = `Koordinator ${labName},`;");
        expect(jsContent).toContain("roleTitle = 'Kepala Laboratorium,';");
        expect(jsContent).toContain("labPicNip ? `NIP. ${labPicNip}` : 'NIP. -'");
    });

    test('7. Eksekusi simulasi buildInventoryExportWorkbook dengan mock ExcelJS berjalan mulus', () => {
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
                this.values = [];
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

        const sampleItems = [
            {
                inventory_code: 'LAB-KIM-001',
                name: 'Mikroskop Binokuler',
                specification: 'Olympus CX23 Magnification 1000x',
                category_name: 'Alat Optik',
                lab_nama: 'Laboratorium Kimia',
                location_name: 'Lemari A1',
                qty_good: 5,
                qty_minor_damage: 1,
                qty_major_damage: 0,
                qty_total: 6,
                unit: 'Unit',
                acquisition_year: 2024,
                funding_source: 'BOS Reguler'
            }
        ];

        // Ekstraksi fungsi buildInventoryExportWorkbook dan helper sanitize
        const sanitizeCode = jsContent.substring(
            jsContent.indexOf('function sanitizeExcelCellValue('),
            jsContent.indexOf('export async function fetchKopImageBuffer(')
        );

        const fnCode = jsContent.substring(
            jsContent.indexOf('export function buildInventoryExportWorkbook('),
            jsContent.indexOf('// Helper Pengambilan Seluruh Data Inventaris')
        ).replace('export function buildInventoryExportWorkbook(', 'function buildInventoryExportWorkbook(');

        const buildFn = new Function('SCHOOL_CONFIG', `${sanitizeCode}\n${fnCode}; return buildInventoryExportWorkbook;`)(
            {
                schoolProvince: 'Bali',
                schoolNameUpper: 'SMA NEGERI 1 ABANG',
                schoolAddressFull: 'Jl. Ida Ketut Jelantik, Desa Tista, Karangasem',
                schoolWebsite: 'https://smanegeri1abang.sch.id',
                schoolCity: 'Abang',
                schoolName: 'SMA Negeri 1 Abang',
                headmasterTitle: 'Kepala SMA Negeri 1 Abang',
                headmasterName: 'I Putu Suweta, S.Pd., M.Pd.',
                headmasterNIP: '197005211997021001'
            }
        );

        // Uji Skenario 1: Ekspor 1 Lab dengan Gambar Kop Aset & NIP Koordinator
        const dummyKopBuffer = Buffer.from('mock-png-kop');
        const wb1 = buildFn(sampleItems, {
            labName: 'Laboratorium Kimia',
            categoryName: 'Semua Kategori',
            locationName: 'Semua Lokasi',
            conditionLabel: 'Semua Kondisi',
            printDate: '27 Oktober 2026',
            signerRoleTitle: 'Koordinator Laboratorium Kimia,',
            labPicName: 'I Made Pembina, S.Pd.',
            labPicNip: '198501012010011002',
            kopImageBuffer: dummyKopBuffer
        }, MockExcelJS);

        expect(wb1.worksheets.length).toBe(1);
        const ws1 = wb1.worksheets[0];
        expect(ws1.pageSetup.paperSize).toBe(9);
        expect(ws1.pageSetup.orientation).toBe('landscape');
        expect(ws1.pageSetup.fitToWidth).toBe(1);
        // Verifikasi kop gambar tersemat
        expect(ws1.images.length).toBe(1);
        expect(ws1.images[0].pos.ext.width).toBe(740);
        // Verifikasi penandatangan koordinator lab + NIP
        expect(ws1.getCell('A6').value).toContain('DAFTAR INVENTARIS');
        expect(ws1.getCell(16, 10).value).toBe('Abang, 27 Oktober 2026');
        expect(ws1.getCell(17, 10).value).toBe('Koordinator Laboratorium Kimia,');
        expect(ws1.getCell(21, 10).value).toBe('I Made Pembina, S.Pd.');
        expect(ws1.getCell(22, 10).value).toBe('NIP. 198501012010011002');
        expect(ws1.getCell(21, 10).font.name).toBe('Times New Roman');

        // Uji Skenario 2: Ekspor Semua Lab (Kepala Lab) & Pejabat Tanpa NIP
        const wb2 = buildFn(sampleItems, {
            labName: 'Semua Laboratorium',
            signerRoleTitle: 'Kepala Laboratorium,',
            labPicName: 'Ni Wayan Sukerti, S.Pd.',
            labPicNip: '', // Tanpa NIP
            kopImageBuffer: dummyKopBuffer
        }, MockExcelJS);

        const ws2 = wb2.worksheets[0];
        expect(ws2.getCell(17, 10).value).toBe('Kepala Laboratorium,');
        expect(ws2.getCell(21, 10).value).toBe('Ni Wayan Sukerti, S.Pd.');
        expect(ws2.getCell(22, 10).value).toBe('NIP. -'); // Tanpa NIP menghasilkan "NIP. -"

        // Uji Skenario 3: Data Kosong (Graceful, 0 Crash)
        const wbEmpty = buildFn([], {
            labName: 'Laboratorium Biologi',
            kopImageBuffer: dummyKopBuffer
        }, MockExcelJS);

        const wsEmpty = wbEmpty.worksheets[0];
        expect(wsEmpty.getCell('A13').value).toContain('Tidak ada barang inventaris');
        expect(wsEmpty.getCell('A13').font.name).toBe('Times New Roman');
    });
});
