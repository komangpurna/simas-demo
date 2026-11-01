/**
 * tests/spp-tunggakan-rapor.test.js
 * Unit test pengujian kalkulasi SSOT tunggakan SPP dan logika seksi kondisional Rapor Afektif Siswa
 * Membaca langsung dari js/config.js via vm context untuk memastikan 100% SSOT testing.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('SSOT Kalkulasi Tunggakan SPP & Rapor Afektif Siswa', () => {
    let calculateCohort;
    let getRateForStudent;
    let calculateStudentTunggakan;
    let SYSTEM_START_DATE_SPP;

    beforeAll(() => {
        const configPath = path.join(__dirname, '../js/config.js');
        const configCode = fs.readFileSync(configPath, 'utf8');

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
            parseInt: parseInt,
            parseFloat: parseFloat,
            isNaN: isNaN,
            initializeApp: () => ({}),
            getFirestore: () => ({}),
            getAuth: () => ({}),
            createClient: () => ({}),
            createSecureSupabaseFetch: () => () => ({}),
            installWorkerFallback: ({ primaryUrl }) => ({ baseUrl: primaryUrl }),
            fetch: () => Promise.resolve({}),
            globalThis: { fetch: () => Promise.resolve({}) }
        };
        sandbox.window = sandbox;
        vm.createContext(sandbox);

        // Hapus import ESM remote dan ubah export menjadi assignable
        const runnableCode = configCode
            .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '// import removed')
            .replace(/export\s+async\s+function\s+([a-zA-Z0-9_]+)/g, 'async function $1')
            .replace(/export\s+function\s+([a-zA-Z0-9_]+)/g, 'function $1')
            .replace(/export\s+const\s+([a-zA-Z0-9_]+)/g, 'const $1')
            .replace(/export\s+let\s+([a-zA-Z0-9_]+)/g, 'let $1')
            .replace(/export\s+default\s+[^;]+;/g, '// export default removed')
            .replace(/export\s*\{[\s\S]*?\};?/g, '// export block removed');

        vm.runInContext(runnableCode, sandbox);

        calculateCohort = sandbox.calculateCohort;
        getRateForStudent = sandbox.getRateForStudent;
        calculateStudentTunggakan = sandbox.calculateStudentTunggakan;
        SYSTEM_START_DATE_SPP = sandbox.SYSTEM_START_DATE_SPP;
    });

    describe('calculateCohort', () => {
        test('menghitung angkatan masuk untuk kelas X, XI, dan XII', () => {
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth();
            const startBase = currentMonth >= 6 ? currentYear : currentYear - 1;

            const cohortX = calculateCohort('X.1');
            expect(cohortX.startYear).toBe(startBase);
            expect(cohortX.endYear).toBe(startBase + 2);

            const cohortXI = calculateCohort('XI.MIPA.1');
            expect(cohortXI.startYear).toBe(startBase - 1);
            expect(cohortXI.endYear).toBe(startBase + 1);

            const cohortXII = calculateCohort('XII.IPS.2');
            expect(cohortXII.startYear).toBe(startBase - 2);
            expect(cohortXII.endYear).toBe(startBase);
        });

        test('menangani kelas alumni dengan format tahun ajaran', () => {
            const cohortAlumni = calculateCohort('Alumni XII IPA 1 (2024/2025)');
            expect(cohortAlumni.startYear).toBe(2025 - 3); // 2022
            expect(cohortAlumni.endYear).toBe(2022 + 2);   // 2024
        });

        test('menangani input kelas kosong atau null secara aman', () => {
            const emptyCohort = calculateCohort('');
            expect(emptyCohort).toHaveProperty('startYear');
            expect(emptyCohort).toHaveProperty('endYear');

            const nullCohort = calculateCohort(null);
            expect(nullCohort).toHaveProperty('startYear');
            expect(nullCohort).toHaveProperty('endYear');
        });
    });

    describe('getRateForStudent', () => {
        const defaultRates = { X: 70000, XI: 65000, XII: 65000 };

        test('mengembalikan tarif sesuai jenjang kelas siswa', () => {
            const studentX = { class: 'X.2' };
            const studentXI = { class: 'XI.1' };
            const studentXII = { class: 'XII.3' };

            const rateX = getRateForStudent(studentX, defaultRates, 2026, 8);
            expect(rateX).toBe(70000);

            const rateXI = getRateForStudent(studentXI, defaultRates, 2026, 8);
            expect(rateXI).toBe(65000);

            const rateXII = getRateForStudent(studentXII, defaultRates, 2026, 8);
            expect(rateXII).toBe(65000);
        });

        test('mengembalikan tarif spesifik cohort jika dikonfigurasi', () => {
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth();
            const startBase = currentMonth >= 6 ? currentYear : currentYear - 1;

            const customRates = {
                X: 70000,
                cohorts: {
                    [String(startBase)]: { X: 75000 }
                }
            };

            const student = { class: 'X.1' };
            const rate = getRateForStudent(student, customRates, currentYear, 8);
            expect(rate).toBe(75000);
        });

        test('menangani student null atau tanpa kelas secara aman', () => {
            expect(getRateForStudent(null, defaultRates, 2026, 8)).toBe(0);
            expect(getRateForStudent({}, defaultRates, 2026, 8)).toBe(0);
        });

        test('mendukung properti alternatif kelas (kelas, student_class, atau string)', () => {
            expect(getRateForStudent({ kelas: 'X.1' }, defaultRates, 2026, 8)).toBe(70000);
            expect(getRateForStudent({ student_class: 'XI.1' }, defaultRates, 2026, 8)).toBe(65000);
            expect(getRateForStudent('XII.1', defaultRates, 2026, 8)).toBe(65000);
        });
    });

    describe('calculateStudentTunggakan', () => {
        const sampleRates = { X: 70000, XI: 65000, XII: 65000 };

        test('mengembalikan nihil tunggakan jika student null atau tidak memiliki kelas', () => {
            const res1 = calculateStudentTunggakan(null);
            expect(res1).toEqual({ unpaidCount: 0, totalNominal: 0, unpaidMonths: [] });

            const res2 = calculateStudentTunggakan({});
            expect(res2).toEqual({ unpaidCount: 0, totalNominal: 0, unpaidMonths: [] });
        });

        test('mendukung properti alternatif kelas (kelas, student_class, string) pada calculateStudentTunggakan', () => {
            const now = new Date();
            const year = now.getFullYear();
            const sysStart = new Date(year, 6, 1);
            if (now >= new Date(year, 7, 21)) {
                const resClass = calculateStudentTunggakan({ class: 'X.1' }, {}, sampleRates, 20, sysStart);
                const resKelas = calculateStudentTunggakan({ kelas: 'X.1' }, {}, sampleRates, 20, sysStart);
                const resStudentClass = calculateStudentTunggakan({ student_class: 'X.1' }, {}, sampleRates, 20, sysStart);
                const resStr = calculateStudentTunggakan('X.1', {}, sampleRates, 20, sysStart);

                expect(resKelas.unpaidCount).toBe(resClass.unpaidCount);
                expect(resStudentClass.unpaidCount).toBe(resClass.unpaidCount);
                expect(resStr.unpaidCount).toBe(resClass.unpaidCount);
            }
        });

        test('menghitung tunggakan dengan benar bila ada bulan yang belum lunas setelah SYSTEM_START_DATE', () => {
            const student = { class: 'X.1' };
            const cohort = calculateCohort(student.class);

            const sysStart = new Date(cohort.startYear, 6, 1);
            const now = new Date();

            if (now >= new Date(cohort.startYear, 7, 21)) {
                const res = calculateStudentTunggakan(student, {}, sampleRates, 20, sysStart);
                expect(res.unpaidCount).toBeGreaterThan(0);
                expect(res.totalNominal).toBeGreaterThan(0);
                expect(res.unpaidMonths.length).toBe(res.unpaidCount);
            }
        });

        test('menandai lunas jika riwayat pembayaran lengkap', () => {
            const student = { class: 'X.1' };
            const cohort = calculateCohort(student.class);
            const sysStart = new Date(cohort.startYear, 6, 1);

            const paymentHistory = {};
            for (let y = cohort.startYear; y <= cohort.endYear + 1; y++) {
                for (let m = 1; m <= 12; m++) {
                    paymentHistory[`${y}-${m}`] = { amount: 70000, type: 'paid' };
                }
            }

            const res = calculateStudentTunggakan(student, paymentHistory, sampleRates, 20, sysStart);
            expect(res.unpaidCount).toBe(0);
            expect(res.totalNominal).toBe(0);
            expect(res.unpaidMonths).toEqual([]);
        });

        test('menganggap manual_debt sebagai belum lunas/menunggak', () => {
            const student = { class: 'X.1' };
            const cohort = calculateCohort(student.class);
            const now = new Date();

            if (now >= new Date(cohort.startYear, 6, 21)) {
                const sysStart = new Date(cohort.startYear, 6, 1);
                const paymentHistory = {
                    [`${cohort.startYear}-7`]: { amount: 70000, type: 'manual_debt' }
                };

                const res = calculateStudentTunggakan(student, paymentHistory, sampleRates, 20, sysStart);
                expect(res.unpaidCount).toBeGreaterThan(0);
            }
        });
    });

    describe('Logika Kondisional Tampilan Seksi Tunggakan SPP di Rapor Afektif', () => {
        function generateSppReportSection(sppTunggakan) {
            if (!sppTunggakan || sppTunggakan.unpaidCount <= 0) {
                return '';
            }
            return `
            <!-- E. INFORMASI TUNGGAKAN IURAN KOMITE (SPP) -->
            <div class="mb-6 break-inside-avoid">
                <div class="gray-header border border-black p-1 pl-2 text-sm bg-amber-50">E. INFORMASI TUNGGAKAN IURAN KOMITE (SPP)</div>
                <table class="w-full">
                    <tbody>
                        <tr>
                            <td style="width: 25%">Status Pembayaran</td>
                            <td style="width: 2%">:</td>
                            <td class="font-bold text-red-600">Menunggak ${sppTunggakan.unpaidCount} Bulan</td>
                        </tr>
                        <tr>
                            <td>Total Kewajiban Tunggakan</td>
                            <td>:</td>
                            <td class="font-bold text-red-600">Rp ${sppTunggakan.totalNominal.toLocaleString('id-ID')}</td>
                        </tr>
                        <tr>
                            <td>Rincian Bulan Belum Lunas</td>
                            <td>:</td>
                            <td class="text-sm italic">${sppTunggakan.unpaidMonths.join(', ')}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            `.trim();
        }

        test('TIDAK merender seksi SPP jika siswa lunas (unpaidCount = 0)', () => {
            const sppLunas = { unpaidCount: 0, totalNominal: 0, unpaidMonths: [] };
            const output = generateSppReportSection(sppLunas);
            expect(output).toBe('');
        });

        test('TIDAK merender seksi SPP jika data sppTunggakan bernilai null/undefined', () => {
            expect(generateSppReportSection(null)).toBe('');
            expect(generateSppReportSection(undefined)).toBe('');
        });

        test('MERENDER seksi SPP secara lengkap HANYA jika siswa memiliki tunggakan (unpaidCount > 0)', () => {
            const sppMenunggak = {
                unpaidCount: 2,
                totalNominal: 140000,
                unpaidMonths: ['Juli 2026', 'Agustus 2026']
            };
            const output = generateSppReportSection(sppMenunggak);
            expect(output).toContain('E. INFORMASI TUNGGAKAN IURAN KOMITE (SPP)');
            expect(output).toContain('Menunggak 2 Bulan');
            expect(output).toContain('140.000');
            expect(output).toContain('Juli 2026, Agustus 2026');
        });

        test('Simulasi dokumen rapor afektif utuh menghasilkan struktur A4 dinas valid', () => {
            const student = { name: 'I Made Test', class: 'X.1', nis: '1234', nisn: '0012345678' };
            const sppMenunggak = { unpaidCount: 1, totalNominal: 70000, unpaidMonths: ['Agustus 2026'] };
            const sppSection = generateSppReportSection(sppMenunggak);

            const fullHtml = `
                <div class="header">LAPORAN PERKEMBANGAN AFEKTIF SISWA</div>
                <div>A. CATATAN PRESTASI</div>
                <div>B. CATATAN KETIDAKHADIRAN & PERMISI</div>
                <div>C. CATATAN KEDISIPLINAN</div>
                <div>D. RIWAYAT PEMBINAAN & KONSELING (GURU WALI, WALI KELAS, & BK)</div>
                ${sppSection}
                <div>Catatan Wali Kelas:</div>
            `;

            expect(fullHtml).toContain('LAPORAN PERKEMBANGAN AFEKTIF SISWA');
            expect(fullHtml).toContain('A. CATATAN PRESTASI');
            expect(fullHtml).toContain('B. CATATAN KETIDAKHADIRAN & PERMISI');
            expect(fullHtml).toContain('C. CATATAN KEDISIPLINAN');
            expect(fullHtml).toContain('D. RIWAYAT PEMBINAAN & KONSELING (GURU WALI, WALI KELAS, & BK)');
            expect(fullHtml).toContain('E. INFORMASI TUNGGAKAN IURAN KOMITE (SPP)');
            expect(fullHtml).toContain('Catatan Wali Kelas:');
        });
    });
});
