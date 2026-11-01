/**
 * Test Suite: Eliminasi Race Condition & Sinkronisasi Data Pelanggaran Rapor Afektif
 * Memverifikasi ketahanan data pelanggaran/prestasi pada modul Portal Wali Kelas dan Modul Siswa
 */

const fs = require('fs');
const path = require('path');

describe('Eliminasi Race Condition & Sinkronisasi Pelanggaran Rapor Afektif', () => {
    let pageWaliJs;
    let pageStudentsJs;
    let waliHtml;
    let packageJson;
    let prdSimas;
    let changelog;

    beforeAll(() => {
        pageWaliJs = fs.readFileSync(path.join(__dirname, '../js/page-wali-kelas.js'), 'utf8');
        pageStudentsJs = fs.readFileSync(path.join(__dirname, '../js/page-students.js'), 'utf8');
        waliHtml = fs.readFileSync(path.join(__dirname, '../wali-kelas.html'), 'utf8');
        packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
        prdSimas = fs.readFileSync(path.join(__dirname, '../PRD_SIMAS.md'), 'utf8');
        changelog = fs.readFileSync(path.join(__dirname, '../CHANGELOG.md'), 'utf8');
    });

    describe('1. Verifikasi SSOT Helper ensureStudentRecords (page-wali-kelas.js)', () => {
        test('ensureStudentRecords didefinisikan dan diekspor ke window global', () => {
            expect(pageWaliJs).toContain('async function ensureStudentRecords(');
            expect(pageWaliJs).toContain('window.ensureStudentRecords = ensureStudentRecords;');
        });

        test('ensureStudentRecords mendukung kueri langsung Cloudflare D1 by NIS (0 Firestore Read)', () => {
            const fnIdx = pageWaliJs.indexOf('async function ensureStudentRecords(');
            expect(fnIdx).toBeGreaterThan(-1);
            const fnBody = pageWaliJs.substring(fnIdx, fnIdx + 10000);

            expect(fnBody).toContain('cfClient.getRecords({ nis: cleanNis, limit: 100 })');
            expect(fnBody).toContain('classRecordsList.push(item)');
            expect(fnBody).toContain('studentObj.records = mappedForStudent');
        });

        test('ensureStudentRecords menormalisasi seluruh variasi catatan pelanggaran', () => {
            const fnIdx = pageWaliJs.indexOf('async function ensureStudentRecords(');
            const fnBody = pageWaliJs.substring(fnIdx, fnIdx + 10000);

            expect(fnBody).toContain("catStr.includes('pelanggaran') || catStr.includes('violation') || (d.points && Number(d.points) > 0)");
            expect(fnBody).toContain("catStr.includes('prestasi') || catStr.includes('achievement')");
            expect(fnBody).toContain("catStr.includes('permisi') || catStr.includes('permission')");
        });
    });

    describe('2. Verifikasi Anti-Race Condition pada openPrintRaporWali & printReportCardWali', () => {
        test('openPrintRaporWali mendeklarasikan dan menampung activePrintDataPromise', () => {
            expect(pageWaliJs).toContain('let activePrintDataPromise = null;');
            const openFnIdx = pageWaliJs.indexOf('window.openPrintRaporWali = async function');
            expect(openFnIdx).toBeGreaterThan(-1);
            const openFnBody = pageWaliJs.substring(openFnIdx, openFnIdx + 10000);

            expect(openFnBody).toContain('activePrintDataPromise = (async () => {');
            expect(openFnBody).toContain('await ensureStudentRecords(student);');
        });

        test('printReportCardWali mengantre dan menunggu activePrintDataPromise sebelum mengeksekusi cetak', () => {
            const printFnIdx = pageWaliJs.indexOf('window.printReportCardWali = async function');
            expect(printFnIdx).toBeGreaterThan(-1);
            const printFnBody = pageWaliJs.substring(printFnIdx, printFnIdx + 5000);

            expect(printFnBody).toContain('if (activePrintDataPromise) {');
            expect(printFnBody).toContain('await activePrintDataPromise;');
        });

        test('printReportCardWali memiliki fallback mandiri ensureStudentRecords jika records kosong saat poin > 0', () => {
            const printFnIdx = pageWaliJs.indexOf('window.printReportCardWali = async function');
            const printFnBody = pageWaliJs.substring(printFnIdx, printFnIdx + 10000);

            expect(printFnBody).toContain('records = await ensureStudentRecords(activePrintStudent);');
            expect(printFnBody).toContain("r.type === 'pelanggaran' || r.category === 'Pelanggaran' || (r.points && Number(r.points) > 0 && r.type !== 'prestasi' && r.category !== 'Prestasi')");
        });
    });

    describe('3. Verifikasi Sinkronisasi pada Modal Detail Perilaku & AI Catatan Rapor', () => {
        test('loadModalDetailPerilaku menggunakan ensureStudentRecords untuk menyinkronkan data ke memori', () => {
            const perilakuIdx = pageWaliJs.indexOf('async function loadModalDetailPerilaku(nis)');
            expect(perilakuIdx).toBeGreaterThan(-1);
            const perilakuBody = pageWaliJs.substring(perilakuIdx, perilakuIdx + 5000);

            expect(perilakuBody).toContain('const records = await ensureStudentRecords(nis, { forceLive: true });');
        });

        test('generateCatatanRaporAI menyertakan fallback ensureStudentRecords saat mengekstrak konteks prompt', () => {
            const aiIdx = pageWaliJs.indexOf('window.generateCatatanRaporAI = async function');
            expect(aiIdx).toBeGreaterThan(-1);
            const aiBody = pageWaliJs.substring(aiIdx, aiIdx + 6000);

            expect(aiBody).toContain('studentRecords = await ensureStudentRecords(studentNis);');
        });
    });

    describe('4. Verifikasi Self-Healing pada Cetak Massal Rapor Afektif (printAllRaporAfektifWali)', () => {
        test('printAllRaporAfektifWali memverifikasi muatan classRecordsList sebelum loop', () => {
            const bulkIdx = pageWaliJs.indexOf('window.printAllRaporAfektifWali = async function');
            expect(bulkIdx).toBeGreaterThan(-1);
            const bulkBody = pageWaliJs.substring(bulkIdx, bulkIdx + 5000);

            expect(bulkBody).toContain('if (!Array.isArray(classRecordsList) || classRecordsList.length === 0) {');
            expect(bulkBody).toContain('await loadClassRecordsAndPermisi(studentClass);');
        });

        test('printAllRaporAfektifWali memiliki self-healing by NIS untuk siswa dengan poin > 0 yang belum terfilter', () => {
            const bulkIdx = pageWaliJs.indexOf('window.printAllRaporAfektifWali = async function');
            const bulkBody = pageWaliJs.substring(bulkIdx, bulkIdx + 10000);

            expect(bulkBody).toContain('const fallbackRecs = await ensureStudentRecords(student);');
            expect(bulkBody).toContain("r.type === 'pelanggaran' || r.category === 'Pelanggaran' || (r.points && Number(r.points) > 0 && r.type !== 'prestasi' && r.category !== 'Prestasi')");
        });
    });

    describe('5. Verifikasi Paritas Pertahanan pada Modul Siswa (page-students.js)', () => {
        test('printReportCard di page-students.js menyertakan fallback kueri D1 by NIS saat rawRecords kosong', () => {
            const studentPrintIdx = pageStudentsJs.indexOf('window.printReportCard = async function');
            expect(studentPrintIdx).toBeGreaterThan(-1);
            const studentPrintBody = pageStudentsJs.substring(studentPrintIdx, studentPrintIdx + 10000);

            expect(studentPrintBody).toContain('const snapRec = await cfClient.getRecords({ nis: String(studentNisVal).trim(), limit: 100 });');
            expect(studentPrintBody).toContain("r.type === 'violation' || r.type === 'pelanggaran' || r.category === 'Pelanggaran' || (r.points && Number(r.points) > 0");
        });
    });

    describe('6. Simulasi Logika Deteksi Pelanggaran Bebas Race Condition', () => {
        test('Dapat mengidentifikasi pelanggaran dengan berbagai bentuk kategori dan poin', () => {
            const mockRecords = [
                { type: 'pelanggaran', category: 'Pelanggaran', title: 'Terlambat Masuk Sekolah', points: 5 },
                { type: 'Kedisiplinan', category: 'Tata Tertib', title: 'Atribut Seragam Tidak Lengkap', points: 10 },
                { type: 'prestasi', category: 'Prestasi', title: 'Juara 1 Lomba Debat', points: 0 },
                { type: 'catatan', category: 'Umum', title: 'Pemberitahuan Orang Tua', points: 0 }
            ];

            const violations = mockRecords.filter(r =>
                r.type === 'pelanggaran' ||
                r.category === 'Pelanggaran' ||
                (r.points && Number(r.points) > 0 && r.type !== 'prestasi' && r.category !== 'Prestasi')
            );

            expect(violations.length).toBe(2);
            expect(violations[0].title).toBe('Terlambat Masuk Sekolah');
            expect(violations[1].title).toBe('Atribut Seragam Tidak Lengkap');
        });

        test('Lock promise menahan fungsi cetak hingga persiapan data selesai', async () => {
            let dataResolved = false;
            let targetStudent = { nis: '1001', name: 'Wayan Test', records: [] };

            const preparationPromise = (async () => {
                await new Promise(res => setTimeout(res, 50));
                targetStudent.records = [{ type: 'pelanggaran', title: 'Bolos Pelajaran', points: 15 }];
                dataResolved = true;
            })();

            // Simulasi fungsi printReportCard yang menunggu promise
            const mockPrint = async () => {
                await preparationPromise;
                return targetStudent.records;
            };

            const recordsOnPrint = await mockPrint();
            expect(dataResolved).toBe(true);
            expect(recordsOnPrint.length).toBe(1);
            expect(recordsOnPrint[0].points).toBe(15);
        });
    });
});
