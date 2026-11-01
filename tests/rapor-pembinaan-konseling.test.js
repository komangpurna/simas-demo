/**
 * Unit Test: Integrasi Riwayat Pembinaan & Konseling Siswa (BK, Guru Wali, Wali Kelas)
 * pada Cetak Rapor Afektif Siswa (js/global.js, js/page-students.js, js/page-wali-kelas.js)
 */

const fs = require('fs');
const path = require('path');

describe('Integrasi Riwayat Pembinaan & Konseling pada Cetak Rapor Afektif', () => {
    let globalJsContent;
    let studentsJsContent;
    let waliJsContent;

    beforeAll(() => {
        globalJsContent = fs.readFileSync(path.join(__dirname, '../js/global.js'), 'utf8');
        studentsJsContent = fs.readFileSync(path.join(__dirname, '../js/page-students.js'), 'utf8');
        waliJsContent = fs.readFileSync(path.join(__dirname, '../js/page-wali-kelas.js'), 'utf8');
    });

    describe('1. SSOT Helper window.fetchStudentPembinaanHistory (js/global.js)', () => {
        test('Fungsi window.fetchStudentPembinaanHistory terdefinisi di js/global.js', () => {
            expect(globalJsContent).toContain('window.fetchStudentPembinaanHistory = async function');
        });

        test('Mendukung toleransi multi-format NIS (leading zero dan tanpa leading zero)', () => {
            expect(globalJsContent).toContain("rawNis.replace(/^0+/, '')");
            expect(globalJsContent).toContain("rawNis.padStart(4, '0')");
        });

        test('Mengambil data dari guru_wali_notes dan bk_actions secara paralel', () => {
            expect(globalJsContent).toContain('client.getGuruWaliNotes({ student_nis: nisToQuery })');
            expect(globalJsContent).toContain('client.getBkActions({ student_nis: nisToQuery })');
            expect(globalJsContent).toContain('Promise.allSettled(queryPromises)');
        });

        test('Mendukung properti camelCase dan snake_case pada data kasus BK', () => {
            expect(globalJsContent).toContain('b.counselorName || b.counselor_name');
            expect(globalJsContent).toContain('b.serviceType || b.service_type');
            expect(globalJsContent).toContain('b.bimbinganType || b.bimbingan_type');
        });

        test('Membedakan peran Wali Kelas vs Guru Wali berdasarkan kecocokan UID/Nama', () => {
            expect(globalJsContent).toContain("isHomeroomAuthor ? 'Wali Kelas' : 'Guru Wali'");
        });

        test('Melakukan simulasi eksekusi logika fetchStudentPembinaanHistory secara fungsional', async () => {
            const mockNotes = [
                { id: 'n1', student_nis: '1234', guru_name: 'Drs. I Made Guru', guru_uid: 'uid_wali_01', date: '2026-08-10', category: 'Kedisiplinan', notes: 'Bimbingan kerapian pakaian' }
            ];
            const mockBk = [
                { id: 'b1', student_nis: '1234', counselorName: 'Ni Luh Ayu, S.Pd', serviceType: 'Konseling Individu', bimbinganType: 'Pribadi', problem: 'Sering mengantuk', notes: 'Konseling pola tidur', date: '2026-08-15', status: 'Selesai' }
            ];

            const mockCfClient = {
                enabled: true,
                getGuruWaliNotes: jest.fn().mockResolvedValue(mockNotes),
                getBkActions: jest.fn().mockResolvedValue(mockBk)
            };

            const targetNis = '1234';
            const options = {
                startDateIso: '2026-07-01',
                endDateIso: '2026-12-31',
                currentUid: 'uid_wali_01',
                currentUserName: 'Drs. I Made Guru'
            };

            const funcStart = globalJsContent.indexOf('window.fetchStudentPembinaanHistory = async function');
            const funcEnd = globalJsContent.indexOf('// =====================================\n// GLOBAL TEACHERS CACHE');
            const funcCode = globalJsContent.slice(funcStart, funcEnd);

            const sandboxFn = new Function('cfClient', 'targetNis', 'options', `
                const window = {};
                ${funcCode}
                return window.fetchStudentPembinaanHistory(targetNis, options);
            `);

            const result = await sandboxFn(mockCfClient, targetNis, options);
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(2);

            const waliItem = result.find(r => r.source === 'guru_wali');
            expect(waliItem).toBeDefined();
            expect(waliItem.role).toBe('Wali Kelas');
            expect(waliItem.counselor).toBe('Drs. I Made Guru');
            expect(waliItem.notes).toBe('Bimbingan kerapian pakaian');

            const bkItem = result.find(r => r.source === 'bk');
            expect(bkItem).toBeDefined();
            expect(bkItem.role).toBe('Bimbingan Konseling (BK)');
            expect(bkItem.counselor).toBe('Ni Luh Ayu, S.Pd');
            expect(bkItem.category).toContain('Konseling Individu');
            expect(bkItem.notes).toContain('Sering mengantuk');
        });
    });

    describe('2. Integrasi Cetak Rapor Afektif di Portal Siswa (js/page-students.js)', () => {
        test('openPrintModal memanggil fetchStudentPembinaanHistory di background', () => {
            expect(studentsJsContent).toContain('window.fetchStudentPembinaanHistory(studentNis');
            expect(studentsJsContent).toContain('window.currentStudentRaw.pembinaanList = pList');
        });

        test('generateAutoNotes mengirimkan data pembinaan ke buildRaporNotePrompt', () => {
            const genIndex = studentsJsContent.indexOf('window.generateAutoNotes = async function');
            const genBlock = studentsJsContent.slice(genIndex, genIndex + 8000);
            expect(genBlock).toContain('pembinaan: window.currentStudentRaw?.pembinaanList || []');
        });

        test('printReportCard memiliki fallback pemanggilan fetchStudentPembinaanHistory sebelum cetak', () => {
            const printIndex = studentsJsContent.indexOf('window.printReportCard = async function');
            const printBlock = studentsJsContent.slice(printIndex, printIndex + 12000);
            expect(printBlock).toContain('window.fetchStudentPembinaanHistory(studentNIS');
            expect(printBlock).toContain('window.currentStudentRaw.pembinaanList = pembinaanList');
        });

        test('printReportCard memuat Seksi D Riwayat Pembinaan & Konseling pada HTML dokumen dinas A4', () => {
            expect(studentsJsContent).toContain('D. RIWAYAT PEMBINAAN &amp; KONSELING (GURU WALI, WALI KELAS, &amp; BK)');
            expect(studentsJsContent).toContain('Pembina / Layanan');
            expect(studentsJsContent).toContain('Uraian Pembinaan &amp; Tindak Lanjut');
            expect(studentsJsContent).toContain('- Nihil Catatan Pembinaan Khusus (Perilaku &amp; Karakter Baik) -');
        });

        test('printReportCard meletakkan Seksi D Pembinaan sebelum seksi SPP pada dokumen cetak', () => {
            const printIndex = studentsJsContent.indexOf('window.printReportCard = async function');
            const printBlock = studentsJsContent.slice(printIndex);
            const templateStart = printBlock.indexOf('printWindow.document.write');
            const templateHtml = printBlock.slice(templateStart);

            const indexD = templateHtml.indexOf('D. RIWAYAT PEMBINAAN &amp; KONSELING (GURU WALI, WALI KELAS, &amp; BK)');
            const indexSppPlaceholder = templateHtml.indexOf('${sppSectionHtml}');

            expect(indexD).toBeGreaterThan(-1);
            expect(indexSppPlaceholder).toBeGreaterThan(-1);
            expect(indexD).toBeLessThan(indexSppPlaceholder);
        });
    });

    describe('3. Integrasi Cetak Rapor Afektif di Portal Wali Kelas (js/page-wali-kelas.js)', () => {
        test('openPrintRaporWali menggunakan window.fetchStudentPembinaanHistory (SSOT)', () => {
            expect(waliJsContent).toContain('window.fetchStudentPembinaanHistory(targetNisStr');
            expect(waliJsContent).toContain('activePrintStudent.pembinaanList = livePembinaan');
        });

        test('printReportCardWali memiliki fallback guard jika pembinaanList belum terisi', () => {
            const printWaliIndex = waliJsContent.indexOf('window.printReportCardWali = async function');
            const printWaliBlock = waliJsContent.slice(printWaliIndex, printWaliIndex + 10000);
            expect(printWaliBlock).toContain('window.fetchStudentPembinaanHistory(targetNisStr');
            expect(printWaliBlock).toContain('activePrintStudent.pembinaanList = pembinaanList');
        });

        test('printReportCardWali memuat Seksi D Riwayat Pembinaan & Konseling dan Seksi E SPP', () => {
            expect(waliJsContent).toContain('D. RIWAYAT PEMBINAAN &amp; KONSELING (GURU WALI, WALI KELAS, &amp; BK)');
            expect(waliJsContent).toContain('E. INFORMASI TUNGGAKAN IURAN KOMITE (SPP)');
        });
    });
});
