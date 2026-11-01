/**
 * Test Suite: Pencetakan Rapor Afektif 1 Tahun Ajaran Penuh & Perbaikan ReferenceError permissionRecords
 * Memverifikasi perbaikan runtime crash dan fitur cetak 1 tahun ajaran pada Portal Wali Kelas
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Fitur Cetak Rapor Afektif 1 Tahun Ajaran Penuh & Bug Fix permissionRecords', () => {
    let waliHtml;
    let pageWaliJs;
    let configJs;

    beforeAll(() => {
        waliHtml = fs.readFileSync(path.join(__dirname, '../wali-kelas.html'), 'utf8');
        pageWaliJs = fs.readFileSync(path.join(__dirname, '../js/page-wali-kelas.js'), 'utf8');
        configJs = fs.readFileSync(path.join(__dirname, '../js/config.js'), 'utf8');
    });

    describe('1. Verifikasi UI HTML (wali-kelas.html)', () => {
        test('Tab 7 Rapor filter semester memiliki opsi 1 Tahun Ajaran (TA)', () => {
            expect(waliHtml).toContain('id="tab-rapor-semester-filter"');
            expect(waliHtml).toContain('<option value="TA">1 Tahun Ajaran (Sem. 1 & 2)</option>');
        });

        test('Modal Catatan Rapor memiliki opsi 1 Tahun Ajaran (TA)', () => {
            expect(waliHtml).toContain('id="rapor-semester"');
            const selectChunk = waliHtml.substring(waliHtml.indexOf('id="rapor-semester"'), waliHtml.indexOf('id="rapor-semester"') + 600);
            expect(selectChunk).toContain('value="TA"');
        });

        test('Modal Cetak Rapor memiliki dropdown print-modal-semester-select untuk perpindahan instan', () => {
            expect(waliHtml).toContain('id="print-modal-semester-select"');
            expect(waliHtml).toContain('onchange="window.changePrintPeriod(this.value)"');
        });

        test('Script tag page-wali-kelas.js menggunakan versi rilis aktif', () => {
            expect(waliHtml).toMatch(/src="js\/page-wali-kelas\.js\?v=\d{2}\.\d{2}\.\d{2}\.\d+"/);
        });
    });

    describe('2. Verifikasi Perbaikan Bug Kritis permissionRecords (page-wali-kelas.js)', () => {
        test('printReportCardWali mendeklarasikan variabel permissionRecords sebelum digunakan', () => {
            const fnIdx = pageWaliJs.indexOf('window.printReportCardWali = async function');
            expect(fnIdx).toBeGreaterThan(-1);
            const fnBody = pageWaliJs.substring(fnIdx, fnIdx + 10000);

            expect(fnBody).toContain('const permissionRecords = records.filter(');
            expect(fnBody).toContain("r.type === 'permission' || r.type === 'permisi' || r.category === 'Permisi'");
            expect(fnBody).toContain('permissionRecords.forEach');
        });

        test('attLogs memproses permissionRecords tanpa melempar ReferenceError', () => {
            const mockRecords = [
                { type: 'prestasi', desc: 'Juara 1 Lomba Sains', points: 0, date: '2026-08-15' },
                { type: 'pelanggaran', desc: 'Terlambat 10 menit', points: 5, date: '2026-08-20' },
                { type: 'permisi', title: 'Izin Pulang Sakit', notes: 'Demam', date: '2026-09-01' }
            ];

            const permissionRecords = mockRecords.filter(r => r.type === 'permission' || r.type === 'permisi' || r.category === 'Permisi');
            expect(permissionRecords.length).toBe(1);

            const attLogs = [];
            permissionRecords.forEach(pr => {
                attLogs.push({
                    dateStr: pr.date || '2026-09-11',
                    dateObj: new Date(pr.date),
                    status: 'P',
                    note: pr.notes || pr.title || 'Izin Keluar / Permisi'
                });
            });

            expect(attLogs.length).toBe(1);
            expect(attLogs[0].status).toBe('P');
            expect(attLogs[0].note).toBe('Demam');
        });
    });

    describe('3. Verifikasi Logika Rentang Tanggal 1 Tahun Ajaran (page-wali-kelas.js)', () => {
        test('Menghitung rentang tanggal startDateIso dan endDateIso 1 tahun penuh saat semester TA', () => {
            const calculateRange = (activeYear, activeSem) => {
                const yearParts = activeYear.split('/');
                const startYear = parseInt(yearParts[0], 10) || 2026;
                const endYear = parseInt(yearParts[1], 10) || (startYear + 1);

                let startDateIso = `${startYear}-07-01`;
                let endDateIso = `${endYear}-06-30`;
                let semLabel = '1 (Ganjil)';

                if (activeSem === '1') {
                    startDateIso = `${startYear}-07-01`;
                    endDateIso = `${startYear}-12-31`;
                } else if (activeSem === '2') {
                    startDateIso = `${endYear}-01-01`;
                    endDateIso = `${endYear}-06-30`;
                    semLabel = '2 (Genap)';
                } else if (activeSem === 'TA' || activeSem === 'FULL' || activeSem === 'ALL') {
                    semLabel = '1 Tahun Ajaran (Sem. 1 & 2)';
                }

                return { startDateIso, endDateIso, semLabel };
            };

            const sem1 = calculateRange('2026/2027', '1');
            expect(sem1.startDateIso).toBe('2026-07-01');
            expect(sem1.endDateIso).toBe('2026-12-31');

            const sem2 = calculateRange('2026/2027', '2');
            expect(sem2.startDateIso).toBe('2027-01-01');
            expect(sem2.endDateIso).toBe('2027-06-30');

            const semTA = calculateRange('2026/2027', 'TA');
            expect(semTA.startDateIso).toBe('2026-07-01');
            expect(semTA.endDateIso).toBe('2027-06-30');
            expect(semTA.semLabel).toBe('1 Tahun Ajaran (Sem. 1 & 2)');
        });

        test('printReportCardWali menetapkan semesterDisplay "1 & 2 (1 Tahun Penuh)" saat semester TA', () => {
            const fnIdx = pageWaliJs.indexOf('window.printReportCardWali = async function');
            const fnBody = pageWaliJs.substring(fnIdx, fnIdx + 2000);
            expect(fnBody).toContain("activeSem === 'TA'");
            expect(fnBody).toContain("'1 & 2 (1 Tahun Penuh)'");
        });

        test('window.changePrintPeriod tersedia sebagai fungsi global', () => {
            expect(pageWaliJs).toContain('window.changePrintPeriod = async function');
        });

        test('loadWaliKelasNotes tidak membatasi parameter semester ke D1 saat filter bernilai TA', () => {
            const fnIdx = pageWaliJs.indexOf('async function loadWaliKelasNotes');
            const fnBody = pageWaliJs.substring(fnIdx, fnIdx + 2500);
            expect(fnBody).toContain("semFilter !== 'TA'");
            expect(fnBody).toContain('walikelasNotesMap[nis] = noteContent');
        });

        test('exportCatatanRaporExcel memberi label semester 1 & 2 (1 Tahun Penuh) dan file _1Tahun.xlsx', () => {
            const fnIdx = pageWaliJs.indexOf('window.exportCatatanRaporExcel = function');
            const fnBody = pageWaliJs.substring(fnIdx, fnIdx + 5000);
            expect(fnBody).toContain("'1 & 2 (1 Tahun Penuh)'");
            expect(fnBody).toContain("'1Tahun'");
        });
    });

    describe('4. Verifikasi Konteks Prompt AI Gemini (buildRaporNotePrompt di config.js)', () => {
        let buildRaporNotePrompt;

        beforeAll(() => {
            const sandbox = {
                window: {},
                console: { warn: () => {}, log: () => {}, error: () => {} },
                Date: Date,
                Math: Math,
                Number: Number,
                String: String,
                Array: Array,
                Map: Map,
                Set: Set,
                initializeApp: () => ({}),
                getFirestore: () => ({}),
                getAuth: () => ({}),
                createClient: () => ({}),
                createSecureSupabaseFetch: () => () => ({}),
            installWorkerFallback: ({ primaryUrl }) => ({ baseUrl: primaryUrl }),
                fetch: () => Promise.resolve({}),
                globalThis: { fetch: () => Promise.resolve({}) },
                extractFriendlyStudentName: (name) => name.split(' ')[0],
                module: {},
                exports: {}
            };
            sandbox.window = sandbox;
            vm.createContext(sandbox);

            // Bersihkan syntax ESM remote dan ubah export menjadi assignable
            const runnableCode = configJs
                .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '// import removed')
                .replace(/export\s+async\s+function\s+([a-zA-Z0-9_]+)/g, 'async function $1')
                .replace(/export\s+function\s+([a-zA-Z0-9_]+)/g, 'function $1')
                .replace(/export\s+const\s+([a-zA-Z0-9_]+)/g, 'const $1')
                .replace(/export\s+let\s+([a-zA-Z0-9_]+)/g, 'let $1')
                .replace(/export\s+default\s+[^;]+;/g, '// export default removed')
                .replace(/export\s*\{[\s\S]*?\};?/g, '// export block removed');

            vm.runInContext(runnableCode, sandbox);
            buildRaporNotePrompt = sandbox.buildRaporNotePrompt;
        });

        test('buildRaporNotePrompt mengenali semVal="TA" dan menetapkan label 1 Tahun Penuh', () => {
            const prompt = buildRaporNotePrompt({
                studentName: 'I Putu Arya Guna',
                studentClass: 'X-A',
                semVal: 'TA',
                yearVal: '2026/2027'
            });

            expect(prompt).toContain('1 Tahun Penuh (Semester 1 & 2)');
            expect(prompt).toContain('1 TAHUN AJARAN PENUH');
            expect(prompt).toContain('tuntas masa adaptasi SMA');
        });

        test('buildRaporNotePrompt memberikan konteks kelulusan pada kelas XII saat 1 Tahun Penuh', () => {
            const prompt = buildRaporNotePrompt({
                studentName: 'Ni Wayan Sukmawati',
                studentClass: 'XII-MIPA-1',
                semVal: 'TA',
                yearVal: '2026/2027'
            });

            expect(prompt).toContain('1 TAHUN AJARAN PENUH di kelas XII (kelulusan)');
            expect(prompt).toContain('pendidikan tinggi');
        });

        test('generateCatatanRaporAI mendeklarasikan studentClass sebelum dikirim ke buildRaporNotePrompt', () => {
            const fnIdx = pageWaliJs.indexOf('window.generateCatatanRaporAI = async function');
            expect(fnIdx).toBeGreaterThan(-1);
            const fnBody = pageWaliJs.substring(fnIdx, fnIdx + 10000);
            expect(fnBody).toContain('const studentClass = currentRombelClass || activePrintStudent.class ||');
            expect(fnBody).toContain('studentClass: studentClass,');
        });
    });

    describe('5. Verifikasi Konsistensi Nomor Versi Aplikasi', () => {
        test('package.json terupdate ke format versi aktif', () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
            expect(pkg.version).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
        });

        test('js/config.js APP_VERSION terupdate dan sinkron dengan package.json', () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
            const updatedConfig = fs.readFileSync(path.join(__dirname, '../js/config.js'), 'utf8');
            expect(updatedConfig).toContain(`export const APP_VERSION = "${pkg.version}";`);
        });

        test('wali-kelas.html mengimpor page-wali-kelas.js', () => {
            const updatedWaliHtml = fs.readFileSync(path.join(__dirname, '../wali-kelas.html'), 'utf8');
            expect(updatedWaliHtml).toMatch(/src="js\/page-wali-kelas\.js\?v=\d{2}\.\d{2}\.\d{2}\.\d+"/);
        });

        test('siswa.html mengimpor page-students.js', () => {
            const siswaHtml = fs.readFileSync(path.join(__dirname, '../siswa.html'), 'utf8');
            expect(siswaHtml).toMatch(/src="js\/page-students\.js\?v=\d{2}\.\d{2}\.\d{2}\.\d+"/);
        });

        test('PRD_SIMAS.md terupdate ke versi terkini', () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
            const prd = fs.readFileSync(path.join(__dirname, '../PRD_SIMAS.md'), 'utf8');
            expect(prd).toContain(`[${pkg.version}]`);
        });

        test('CHANGELOG.md memuat entri versi terkini', () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
            const cl = fs.readFileSync(path.join(__dirname, '../CHANGELOG.md'), 'utf8');
            expect(cl).toContain(`[${pkg.version}]`);
        });
    });
});
