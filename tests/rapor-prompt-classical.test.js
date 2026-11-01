/**
 * tests/rapor-prompt-classical.test.js
 * Unit test pengujian komputasi metrik klasikal dan pembentukan prompt AI Catatan Wali Kelas
 * Membaca langsung dari js/config.js via vm context untuk memastikan 100% SSOT testing.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Pengujian Komputasi Klasikal & Prompt AI Catatan Wali Kelas (Rapor)', () => {
    let computeClassicalMetrics;
    let extractFriendlyStudentName;
    let buildRaporNotePrompt;

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

        computeClassicalMetrics = sandbox.computeClassicalMetrics || sandbox.window.computeClassicalMetrics;
        extractFriendlyStudentName = sandbox.extractFriendlyStudentName || sandbox.window.extractFriendlyStudentName;
        buildRaporNotePrompt = sandbox.buildRaporNotePrompt || sandbox.window.buildRaporNotePrompt;

        expect(typeof computeClassicalMetrics).toBe('function');
        expect(typeof extractFriendlyStudentName).toBe('function');
        expect(typeof buildRaporNotePrompt).toBe('function');
    });

    describe('1. computeClassicalMetrics()', () => {
        const dummyStudents = [
            { nis: '1001', name: 'Ahmad Dahlan', class: 'XII-A' },
            { nis: '1002', name: 'Budi Santoso', class: 'XII-A' },
            { nis: '1003', name: 'Citra Dewi', class: 'XII-A' },
            { nis: '1004', name: 'Doni Pratama', class: 'XII-A' }
        ];

        const dummyAggregates = {
            '1001': { totalPoints: 0, totalPrestasi: 2, hadir: 100, sakit: 0, izin: 0, alpa: 0 },
            '1002': { totalPoints: 10, totalPrestasi: 0, hadir: 90, sakit: 5, izin: 5, alpa: 0 },
            '1003': { totalPoints: 0, totalPrestasi: 1, hadir: 95, sakit: 2, izin: 3, alpa: 0 },
            '1004': { totalPoints: 25, totalPrestasi: 0, hadir: 80, sakit: 5, izin: 5, alpa: 10 }
        };

        const dummyAttendanceRekap = [
            { nis: '1001', H: 100, S: 0, I: 0, A: 0 },
            { nis: '1002', H: 90, S: 5, I: 5, A: 0 },
            { nis: '1003', H: 95, S: 2, I: 3, A: 0 },
            { nis: '1004', H: 80, S: 5, I: 5, A: 10 }
        ];

        test('Harus menghitung metrik kelas dengan akurat untuk siswa teladan (Ahmad Dahlan)', () => {
            const metrics = computeClassicalMetrics({
                students: dummyStudents,
                aggregates: dummyAggregates,
                attendanceRekap: dummyAttendanceRekap,
                targetNis: '1001'
            });

            expect(metrics).not.toBeNull();
            expect(metrics.totalStudents).toBe(4);
            expect(metrics.studentAttendancePct).toBe(100);
            expect(metrics.attendanceComparison).toContain('Sangat prima');
            expect(metrics.disciplineComparison).toContain('teladan yang bersih');
            expect(metrics.studentPrestasiCount).toBe(2);
            expect(metrics.achievementComparison).toContain('Aktif berprestasi');
            expect(Number(metrics.classAvgPoints)).toBeCloseTo(8.8, 1);
            expect(metrics.classZeroViolationPct).toBe(50); // 2 dari 4 siswa 0 poin
        });

        test('Harus mendeteksi siswa yang memerlukan dorongan kedisiplinan dan kehadiran (Doni Pratama)', () => {
            const metrics = computeClassicalMetrics({
                students: dummyStudents,
                aggregates: dummyAggregates,
                attendanceRekap: dummyAttendanceRekap,
                targetNis: '1004'
            });

            expect(metrics).not.toBeNull();
            expect(metrics.studentAttendancePct).toBe(80); // 80 / 100 = 80%
            expect(metrics.attendanceComparison).toContain('di bawah rata-rata rombel');
            expect(metrics.disciplineComparison).toContain('perhatian dan pembinaan intensif');
        });

        test('Harus fallback dengan aman jika attendanceRekap kosong menggunakan data aggregates', () => {
            const metrics = computeClassicalMetrics({
                students: dummyStudents,
                aggregates: dummyAggregates,
                attendanceRekap: [],
                targetNis: '1003'
            });

            expect(metrics).not.toBeNull();
            expect(metrics.totalStudents).toBe(4);
            expect(metrics.studentAttendancePct).toBe(95);
            expect(metrics.disciplineComparison).toContain('teladan yang bersih');
        });

        test('Harus mendeteksi siswa yang memiliki alpa dan TIDAK memberikan label "Sangat prima"', () => {
            const metrics = computeClassicalMetrics({
                students: dummyStudents,
                aggregates: dummyAggregates,
                attendanceRekap: dummyAttendanceRekap,
                targetNis: '1004',
                targetAlpha: 10
            });

            expect(metrics).not.toBeNull();
            expect(metrics.studentAlphaCount).toBe(10);
            expect(metrics.attendanceComparison).not.toContain('Sangat prima');
            expect(metrics.attendanceComparison).toContain('alpha');
            expect(metrics.attendanceComparison).toContain('di bawah rata-rata rombel');
        });

        test('Harus mengembalikan null secara aman jika daftar siswa kosong', () => {
            const metrics = computeClassicalMetrics({
                students: [],
                aggregates: {},
                attendanceRekap: [],
                targetNis: '9999'
            });

            expect(metrics).toBeNull();
        });
    });

    describe('2. extractFriendlyStudentName()', () => {
        test('Harus memenggal nama Bali dengan awalan gender dan urutan lahir (misal: I Gede Wahyu Arta -> Wahyu)', () => {
            expect(extractFriendlyStudentName('I Gede Wahyu Arta')).toBe('Wahyu');
            expect(extractFriendlyStudentName('I Putu Gede Raditya')).toBe('Raditya');
            expect(extractFriendlyStudentName('I Wayan Agus Pratama')).toBe('Agus');
        });

        test('Harus memenggal nama Bali perempuan dengan awalan kasta/urutan lahir (misal: Ni Putu Ayu Saraswati -> Saraswati)', () => {
            expect(extractFriendlyStudentName('Ni Putu Ayu Saraswati')).toBe('Saraswati');
            expect(extractFriendlyStudentName('Ni Luh Kadek Dwi')).toBe('Dwi');
            expect(extractFriendlyStudentName('Ni Made Suarni')).toBe('Suarni');
        });

        test('Harus menangani nama Bali 2 kata dengan benar tanpa pernah memenggal hanya "I" atau "Ni"', () => {
            expect(extractFriendlyStudentName('I Putu')).toBe('Putu');
            expect(extractFriendlyStudentName('Ni Luh')).toBe('Luh');
            expect(extractFriendlyStudentName('I Wayan')).toBe('Wayan');
            expect(extractFriendlyStudentName('Ni Made')).toBe('Made');
        });

        test('Harus menangani nama umum non-Bali dengan mengambil kata pertama', () => {
            expect(extractFriendlyStudentName('Budi Santoso')).toBe('Budi');
            expect(extractFriendlyStudentName('Ahmad Dahlan')).toBe('Ahmad');
            expect(extractFriendlyStudentName('Siti Aminah')).toBe('Siti');
        });

        test('Harus menangani nama 1 kata atau nilai invalid secara aman', () => {
            expect(extractFriendlyStudentName('Wahyu')).toBe('Wahyu');
            expect(extractFriendlyStudentName('')).toBe('Siswa');
            expect(extractFriendlyStudentName(null)).toBe('Siswa');
            expect(extractFriendlyStudentName(undefined)).toBe('Siswa');
        });
    });

    describe('3. buildRaporNotePrompt()', () => {
        test('Harus menyertakan data personal, records, dan konteks klasikal dalam prompt', () => {
            const classContext = {
                totalStudents: 36,
                studentAttendancePct: 99,
                classAvgAttendancePct: 93,
                attendanceComparison: 'Sangat prima dan melampaui rata-rata kehadiran rombel',
                classAvgPoints: '4.2',
                classZeroViolationPct: 82,
                disciplineComparison: 'Termasuk kelompok siswa teladan yang bersih dari catatan pelanggaran',
                achievementComparison: 'Aktif berprestasi dan membanggakan kelas dengan 2 pencapaian tercatat'
            };

            const prompt = buildRaporNotePrompt({
                studentName: 'I Putu Arya Wiguna',
                studentNickName: 'Arya',
                studentClass: 'XII-MIPA-1',
                gender: 'L',
                yearVal: '2026/2027',
                semVal: '2',
                poin: 0,
                alpha: 0,
                sakit: 1,
                izin: 0,
                dispen: 0,
                prestasi: 2,
                permisi: 0,
                totalHadir: 110,
                classContext: classContext,
                records: [
                    { type: 'achievement', title: 'Juara 1 Debat Bahasa Inggris Provinsi', notes: 'Tingkat Provinsi' },
                    { type: 'achievement', title: 'Medali Perak OSN Matematika', notes: 'Tingkat Nasional' }
                ],
                attendance: [
                    { status: 'S', note: 'Demam 1 hari' }
                ]
            });

            // Verifikasi Konten Personal & Klasikal
            expect(prompt).toContain('I Putu Arya Wiguna');
            expect(prompt).toContain('(Laki-laki)');
            expect(prompt).toContain('Arya');
            expect(prompt).toContain('KONTEKS KOMPARATIF KELAS (KLASIKAL)');
            expect(prompt).toContain('36 siswa');
            expect(prompt).toContain('Sangat prima dan melampaui rata-rata');
            expect(prompt).toContain('Juara 1 Debat Bahasa Inggris Provinsi');
            expect(prompt).toContain('Medali Perak OSN Matematika');
            expect(prompt).toContain('Demam 1 hari');
            expect(prompt).toContain('Total Hadir: 110 hari');

            // Verifikasi Larangan dan Ketentuan Struktural
            expect(prompt).toContain('DILARANG KERAS MEMAKAI FRASA PEMBUKA FORMAL/KAKU');
            expect(prompt).toContain('LANGSUNG MULAI KALIMAT PERTAMA DENGAN NAMA SISWA ATAU APRESIASI LANGSUNG');
            expect(prompt).toContain('HINDARI MENYEBUT ANGKA EKSPLISIT');
            expect(prompt).toContain('2-3 kalimat');
            expect(prompt).toContain('MAKSIMAL 50 KATA');
        });

        test('Harus memuat larangan keras memuji kehadiran jika siswa memiliki alpa > 0 dan melarang sapaan I/Ni', () => {
            const prompt = buildRaporNotePrompt({
                studentName: 'I Gede Wahyu Arta',
                studentClass: 'XII-A',
                gender: 'L',
                yearVal: '2026/2027',
                semVal: '1',
                poin: 0,
                alpha: 1, // memiliki 1 hari alpha
                sakit: 0,
                izin: 0,
                records: [],
                attendance: []
            });

            expect(prompt).toContain('DILARANG KERAS MEMUJI KEHADIRAN');
            expect(prompt).toContain("DILARANG KERAS memenggal nama atau menyapa siswa hanya dengan awalan gender 'I' atau 'Ni'");
            expect(prompt).toContain('Panggilan Akrab/Nama Diri: Wahyu');
        });

        test('Harus tetap berfungsi normal (graceful fallback) jika data klasikal bernilai null', () => {
            const prompt = buildRaporNotePrompt({
                studentName: 'Ni Wayan Sari',
                studentClass: 'X-E1',
                yearVal: '2026/2027',
                semVal: '1',
                poin: 0,
                alpha: 0,
                classContext: null,
                records: [],
                attendance: []
            });

            expect(prompt).toContain('Ni Wayan Sari');
            expect(prompt).toContain('X-E1');
            expect(prompt).not.toContain('KONTEKS KOMPARATIF KELAS (KLASIKAL)');
            expect(prompt).toContain('Tidak ada catatan pelanggaran');
            expect(prompt).toContain('2-3 kalimat');
        });

        test('Harus menyertakan riwayat pembinaan (BK, Guru Wali, Wali Kelas) dan panduan pedagogis dalam prompt', () => {
            const prompt = buildRaporNotePrompt({
                studentName: 'I Kadek Agus',
                studentClass: 'XI-F2',
                yearVal: '2026/2027',
                semVal: '1',
                poin: 10,
                alpha: 0,
                records: [],
                attendance: [],
                pembinaan: [
                    { role: 'Guru BK', category: 'Konseling Individu', notes: 'Bimbingan motivasi dan fokus belajar', followUp: 'Siswa menunjukkan peningkatan fokus' },
                    { role: 'Guru Wali', category: 'Karakter', notes: 'Penguatan komitmen ketepatan pengumpulan tugas', followUp: '' }
                ]
            });

            expect(prompt).toContain('I Kadek Agus');
            expect(prompt).toContain('Riwayat Pembinaan & Konseling (BK, Wali Kelas, Guru Wali)');
            expect(prompt).toContain('[Guru BK] Konseling Individu: Bimbingan motivasi dan fokus belajar (Tindak lanjut: Siswa menunjukkan peningkatan fokus)');
            expect(prompt).toContain('[Guru Wali] Karakter: Penguatan komitmen ketepatan pengumpulan tugas');
            expect(prompt).toContain('Jika ada RIWAYAT PEMBINAAN, jadikan konteks untuk mengapresiasi perubahan/perkembangan sikap positif');
        });
    });
});
