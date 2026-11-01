/**
 * tests/teaching-journal-effectiveness.test.js
 * ====================================================================
 * Test Suite: Penguatan Logika Pengingat Jurnal Guru Jam 15:00 WITA
 * & Rekapitulasi Mingguan KBM Kepala Sekolah
 * 
 * Memvalidasi:
 * 1. Akurasi ekstraksi nama rombel/kelas dari teks sesi KBM (extractClassFromText)
 * 2. Akurasi penentuan angkatan X, XI, XII (getAngkatanFromClass SSOT)
 * 3. Analisis empiris efektivitas KBM (analyzeDailyKbmEffectiveness):
 *    - Tingkat Sekolah (<= 5 rombel aktif = Dispensasi Massal)
 *    - Tingkat Angkatan (<= 2 rombel aktif = Angkatan Tidak Belajar Efektif)
 * 4. Pengecualian guru yang hanya mengajar di angkatan non-efektif
 * 5. Evaluasi selektif untuk guru lintas angkatan & presisi pesan notifikasi
 * 6. Penyesuaian sesi terencana pada rekapitulasi mingguan Kepala Sekolah
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Logika Pengingat Jurnal Guru & Rekap Mingguan Kepala Sekolah', () => {
    const root = path.resolve(__dirname, '..');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');
    const workerContent = fs.readFileSync(workerJsPath, 'utf8');

    // 1. Ekstraksi fungsi dari worker.js untuk diuji secara unit
    let extractClassFromText;
    let getAngkatanFromClass;
    let analyzeDailyKbmEffectiveness;

    beforeAll(() => {
        // Evaluasi fungsi helper dari kode worker
        const script = `
            ${workerContent.match(/function extractClassFromText[\s\S]*?^}/m)[0]}
            ${workerContent.match(/function getAngkatanFromClass[\s\S]*?^}/m)[0]}
            ${workerContent.match(/async function analyzeDailyKbmEffectiveness[\s\S]*?^}/m)[0]}
            return { extractClassFromText, getAngkatanFromClass, analyzeDailyKbmEffectiveness };
        `;
        const fns = new Function(script)();
        extractClassFromText = fns.extractClassFromText;
        getAngkatanFromClass = fns.getAngkatanFromClass;
        analyzeDailyKbmEffectiveness = fns.analyzeDailyKbmEffectiveness;
    });

    // =========================================================================
    // 1. UJI EKSTRAKSI KELAS (extractClassFromText)
    // =========================================================================
    describe('1. Ekstraksi Nama Rombel dari Teks Sesi KBM (extractClassFromText)', () => {
        test('Mengekstrak format "Kelas X-1" dan "Kelas XII-MIPA-2"', () => {
            expect(extractClassFromText('Tatap Muka KBM Matematika Kelas X-1 (JP 1–2)')).toBe('X-1');
            expect(extractClassFromText('Tatap Muka KBM Biologi Kelas XII-MIPA-2 (JP 3–4)')).toBe('XII-MIPA-2');
            expect(extractClassFromText('KBM Fisika Kelas XI MIPA 1')).toBe('XI MIPA 1');
        });

        test('Mengekstrak format dalam tanda kurung "(X-3)" atau "(XII-1)"', () => {
            expect(extractClassFromText('KBM Bahasa Indonesia (X-3)')).toBe('X-3');
            expect(extractClassFromText('KBM Kimia (XII-1)')).toBe('XII-1');
            expect(extractClassFromText('KBM Bahasa Bali (XI-F)')).toBe('XI-F');
        });

        test('Mengekstrak format dengan tanda hubung strip "XII-2" atau "12-IPA-1"', () => {
            expect(extractClassFromText('KBM Sosiologi - XII-2')).toBe('XII-2');
            expect(extractClassFromText('KBM Ekonomi 12-IPA-1')).toBe('12-IPA-1');
        });

        test('Mengembalikan string kosong jika tidak ada pola kelas', () => {
            expect(extractClassFromText('')).toBe('');
            expect(extractClassFromText('Upacara Bendera Mingguan')).toBe('');
            expect(extractClassFromText('Rapat Dewan Guru')).toBe('');
        });
    });

    // =========================================================================
    // 2. UJI EKSTRAKSI ANGKATAN (getAngkatanFromClass SSOT)
    // =========================================================================
    describe('2. Penentuan Tingkat Angkatan (getAngkatanFromClass)', () => {
        test('Angkatan XII harus didahulukan sebelum X agar tidak tertukar', () => {
            expect(getAngkatanFromClass('XII-1')).toBe('XII');
            expect(getAngkatanFromClass('XII-MIPA-2')).toBe('XII');
            expect(getAngkatanFromClass('12-A')).toBe('XII');
            expect(getAngkatanFromClass('Kelas XII-4')).toBe('XII');
        });

        test('Angkatan XI dikenali dengan benar', () => {
            expect(getAngkatanFromClass('XI-F')).toBe('XI');
            expect(getAngkatanFromClass('XI-1')).toBe('XI');
            expect(getAngkatanFromClass('11-IPA-2')).toBe('XI');
            expect(getAngkatanFromClass('Kelas XI-3')).toBe('XI');
        });

        test('Angkatan X dikenali dengan benar', () => {
            expect(getAngkatanFromClass('X-1')).toBe('X');
            expect(getAngkatanFromClass('X-12')).toBe('X');
            expect(getAngkatanFromClass('10-B')).toBe('X');
            expect(getAngkatanFromClass('Kelas X-4')).toBe('X');
        });

        test('Mengembalikan OTHER untuk nilai kosong atau format tidak dikenal', () => {
            expect(getAngkatanFromClass('')).toBe('OTHER');
            expect(getAngkatanFromClass(null)).toBe('OTHER');
            expect(getAngkatanFromClass('Aula Utama')).toBe('OTHER');
        });
    });

    // =========================================================================
    // 3. UJI ANALISIS EMPIRIS STATUS KBM (analyzeDailyKbmEffectiveness)
    // =========================================================================
    describe('3. Analisis Empiris Status KBM Sekolah & Angkatan (analyzeDailyKbmEffectiveness)', () => {
        test('Jika total rombel aktif di sekolah <= 5, otomatis terdeteksi Tidak Belajar Efektif Massal', async () => {
            const mockJournalRows = [
                { kelas: 'X-1', uid_guru: 'u1' },
                { kelas: 'X-2', uid_guru: 'u2' },
                { kelas: 'XI-1', uid_guru: 'u3' }
            ]; // Hanya 3 rombel aktif
            const result = await analyzeDailyKbmEffectiveness(null, '2026-10-24', mockJournalRows);

            expect(result.activeClassCount).toBe(3);
            expect(result.isSchoolNonEffective).toBe(true);
        });

        test('Jika total rombel aktif > 5, sekolah berstatus efektif, namun angkatan dengan <= 2 rombel ditandai non-efektif', async () => {
            const mockJournalRows = [
                // Angkatan X: 4 rombel aktif (> 2)
                { kelas: 'X-1', uid_guru: 'u1' },
                { kelas: 'X-2', uid_guru: 'u2' },
                { kelas: 'X-3', uid_guru: 'u3' },
                { kelas: 'X-4', uid_guru: 'u4' },
                // Angkatan XI: 3 rombel aktif (> 2)
                { kelas: 'XI-1', uid_guru: 'u5' },
                { kelas: 'XI-2', uid_guru: 'u6' },
                { kelas: 'XI-3', uid_guru: 'u7' },
                // Angkatan XII: hanya 1 rombel aktif (<= 2) -> Ujian / Libur Ujian
                { kelas: 'XII-1', uid_guru: 'u8' }
            ]; // Total 8 rombel aktif (> 5)

            const result = await analyzeDailyKbmEffectiveness(null, '2026-10-24', mockJournalRows);

            expect(result.activeClassCount).toBe(8);
            expect(result.isSchoolNonEffective).toBe(false);
            expect(result.nonEffectiveAngkatan.has('XII')).toBe(true);
            expect(result.nonEffectiveAngkatan.has('X')).toBe(false);
            expect(result.nonEffectiveAngkatan.has('XI')).toBe(false);
        });

        test('Kondisi normal: Seluruh angkatan memiliki > 2 rombel aktif', async () => {
            const mockJournalRows = [
                { kelas: 'X-1' }, { kelas: 'X-2' }, { kelas: 'X-3' },
                { kelas: 'XI-1' }, { kelas: 'XI-2' }, { kelas: 'XI-3' },
                { kelas: 'XII-1' }, { kelas: 'XII-2' }, { kelas: 'XII-3' }
            ]; // 9 rombel aktif, 3 per angkatan
            const result = await analyzeDailyKbmEffectiveness(null, '2026-10-24', mockJournalRows);

            expect(result.isSchoolNonEffective).toBe(false);
            expect(result.nonEffectiveAngkatan.size).toBe(0);
        });
    });

    // =========================================================================
    // 4. UJI INTEGRITAS LOGIKA CRON WORKER DI CLOUDFLARE/WORKER.JS
    // =========================================================================
    describe('4. Integritas Kode Sumber di cloudflare/worker.js', () => {
        test('Fungsi processMissingTeachingJournalReminderCron menggunakan analyzeDailyKbmEffectiveness', () => {
            expect(workerContent).toContain('await analyzeDailyKbmEffectiveness(env.DB, dateStr)');
            expect(workerContent).toContain('effectiveness.isSchoolNonEffective');
        });

        test('Fungsi processMissingTeachingJournalReminderCron menyaring angkatan non-efektif', () => {
            expect(workerContent).toContain('!nonEffectiveAngkatan.has(angk)');
            expect(workerContent).toContain('rawClasses.length > 0 && activeClasses.length === 0');
        });

        test('Notifikasi memuat rincian daftar kelas yang belum diisi', () => {
            expect(workerContent).toContain('missingClasses.join(", ")');
            expect(workerContent).toContain('belum mengisi jurnal KBM untuk kelas: ${classListStr}');
        });

        test('Fungsi processWeeklyJournalPrincipalRecapCron mengecualikan sesi KBM non-efektif dari total_planned', () => {
            expect(workerContent).toContain('eff.isHoliday || eff.isSchoolNonEffective');
            expect(workerContent).toContain('eff.nonEffectiveAngkatan.has(angk)');
        });

        test('Proteksi anti-false exemption: heuristik hanya aktif bila populasi jadwal memadai', () => {
            expect(workerContent).toContain('scheduledTeacherUids.length > 5 || scheduledClassesByTeacher.size > 5');
            expect(workerContent).toContain('scheduledClassesCountByAngkatan[angk] > 2');
            expect(workerContent).toContain('verifiedNonEffectiveAngkatan');
        });
    });
});
