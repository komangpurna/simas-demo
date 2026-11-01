/**
 * tests/workload-study-day-se-5684-2025.test.js
 * ====================================================================
 * Test Suite: Implementasi Regulasi Hari Belajar Guru
 * Dasar Hukum: Surat Edaran Mendikdasmen No. 5684/MDM.B1/HK.04.00/2025
 * Modul: E-Kinerja SIMAS SMAGESA (SMA Negeri 1 Abang)
 * SSOT: Cloudflare D1 (0 Firestore Read)
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const {
    detectTeacherStudyDay,
    checkHasPkActivity,
    isStudyDayCompliantActivity,
    WORKLOAD_DAY_NAMES
} = require('./helpers/ui-runtime-source.cjs').loadWorkloadCalculations();

function officialSchedule(segments) {
    return { complete: true, days: Object.fromEntries([1, 2, 3, 4, 5].map(day => [day,
        segments.filter(seg => seg.day_of_week === day).map(seg => ({ ...seg, minutes: 45 }))])) };
}

describe('Suite Pengujian Hari Belajar Guru (SE Mendikdasmen No. 5684/2025)', () => {
    const root = path.resolve(__dirname, '..');
    const pageBebanKerjaJs = fs.readFileSync(path.join(root, 'js', 'page-beban-kerja.js'), 'utf8');
    const workloadCalcJs = fs.readFileSync(path.join(root, 'js', 'workload-calc.js'), 'utf8');
    const eKinerjaHtml = fs.readFileSync(path.join(root, 'e-kinerja.html'), 'utf8');

    // =================================================================
    // 1. DETEKSI OTOMATIS HARI BEBAS KBM (ZERO TEACHING DAY)
    // =================================================================
    test('1. Menetapkan secara otomatis hari Rabu sebagai Hari Belajar jika Rabu tidak memiliki jadwal KBM', () => {
        // Senin, Selasa, Kamis, Jumat ada KBM. Rabu (day_of_week: 3, index 2) tidak ada KBM.
        const mockSegments = [
            { day_of_week: 1, is_teaching: 1, activity_title: 'KBM Fisika XI-A' },
            { day_of_week: 2, is_teaching: 1, activity_title: 'KBM Fisika XI-B' },
            { day_of_week: 4, is_teaching: 1, activity_title: 'KBM Fisika XII-C' },
            { day_of_week: 5, is_teaching: 1, activity_title: 'KBM Fisika XII-D' }
        ];

        const result = detectTeacherStudyDay(mockSegments, { teacherSchedule: officialSchedule(mockSegments) });
        expect(result.studyDayIndex).toBe(2); // Rabu (indeks 2)
        expect(result.studyDayName).toBe('Rabu');
        expect(result.isAutoDetected).toBe(true);
    });

    test('2. Menetapkan hari Kamis jika Kamis adalah satu-satunya hari tanpa KBM', () => {
        const mockSegments = [
            { day_of_week: 1, is_teaching: 1, activity_title: 'KBM Kimia X-A' },
            { day_of_week: 2, is_teaching: 1, activity_title: 'KBM Kimia X-B' },
            { day_of_week: 3, is_teaching: 1, activity_title: 'KBM Kimia XI-A' },
            { day_of_week: 5, is_teaching: 1, activity_title: 'KBM Kimia XI-B' }
        ];

        const result = detectTeacherStudyDay(mockSegments, { teacherSchedule: officialSchedule(mockSegments) });
        expect(result.studyDayIndex).toBe(3); // Kamis (indeks 3)
        expect(result.studyDayName).toBe('Kamis');
        expect(result.isAutoDetected).toBe(true);
    });

    // =================================================================
    // 2. FALLBACK KETIKA GURU MENGAJAR SETIAP HARI & MANUAL OVERRIDE
    // =================================================================
    test('3. Memberi saran tanpa menetapkan hari jika guru mengajar setiap hari', () => {
        // Senin: 3 sesi, Selasa: 2 sesi, Rabu: 2 sesi, Kamis: 2 sesi, Jumat: 1 sesi
        const mockSegments = [
            { day_of_week: 1, is_teaching: 1 },
            { day_of_week: 1, is_teaching: 1 },
            { day_of_week: 1, is_teaching: 1 },
            { day_of_week: 2, is_teaching: 1 },
            { day_of_week: 2, is_teaching: 1 },
            { day_of_week: 3, is_teaching: 1 },
            { day_of_week: 3, is_teaching: 1 },
            { day_of_week: 4, is_teaching: 1 },
            { day_of_week: 4, is_teaching: 1 },
            { day_of_week: 5, is_teaching: 1 } // Jumat paling sedikit
        ];

        const result = detectTeacherStudyDay(mockSegments, { teacherSchedule: officialSchedule(mockSegments) });
        expect(result.studyDayIndex).toBeNull();
        expect(result.suggestedDayIndex).toBe(4);
        expect(result.status).toBe('needs_selection');
        expect(result.isAutoDetected).toBe(false);
    });

    test('4. Manual override guru dihormati meskipun algoritma mendeteksi hari lain', () => {
        const mockSegments = [
            { day_of_week: 1, is_teaching: 1 },
            { day_of_week: 2, is_teaching: 1 },
            // Hari Rabu (index 2) kosong
            { day_of_week: 4, is_teaching: 1 },
            { day_of_week: 5, is_teaching: 1 }
        ];

        // Guru secara eksplisit memilih hari Selasa (indeks 1) karena agenda MGMP kab/kota jatuh di hari Selasa
        const result = detectTeacherStudyDay(mockSegments, { manualStudyDayIndex: 1 });
        expect(result.studyDayIndex).toBe(1);
        expect(result.studyDayName).toBe('Selasa');
        expect(result.isAutoDetected).toBe(false);
    });

    // =================================================================
    // 3. VALIDASI KEBERADAAN KEGIATAN PKB / MGMP (checkHasPkActivity)
    // =================================================================
    test('5. checkHasPkActivity mendeteksi kegiatan PKB via catalog_id resmi', () => {
        const segmentsWithMgmp = [
            { day_of_week: 3, catalog_id: 'cat_mgmp', title: 'Pertemuan Rutin MGMP Fisika' }
        ];
        expect(checkHasPkActivity(segmentsWithMgmp)).toBe(true);
        expect(checkHasPkActivity(segmentsWithMgmp, 2)).toBe(true); // Hari Rabu
        expect(checkHasPkActivity(segmentsWithMgmp, 0)).toBe(false); // Hari Senin
    });

    test('6. checkHasPkActivity mendeteksi kegiatan PKB via judul komunitas belajar atau pelatihan', () => {
        const segmentsWithTitle = [
            { day_of_week: 2, catalog_id: 'cat_perencanaan_rutin', title: 'Diskusi Komunitas Belajar Sekolah' }
        ];
        expect(checkHasPkActivity(segmentsWithTitle)).toBe(true);
        expect(checkHasPkActivity(segmentsWithTitle, 1)).toBe(true); // Hari Selasa
    });

    test('7. checkHasPkActivity mengembalikan false jika hanya ada KBM dan administrasi biasa', () => {
        const segmentsWithoutPk = [
            { day_of_week: 1, catalog_id: 'cat_kbm', title: 'KBM Tatap Muka' },
            { day_of_week: 2, catalog_id: 'cat_koreksi', title: 'Koreksi Nilai Ulangan' }
        ];
        expect(checkHasPkActivity(segmentsWithoutPk)).toBe(false);
    });

    // =================================================================
    // 4. PARITAS ANTARMUKA HTML & SCRIPT LOGIKA INTEGRASI
    // =================================================================
    test('8. e-kinerja.html memuat kontrol pemilihan Hari Belajar Guru di tab rencana', () => {
        expect(eKinerjaHtml).toContain('id="select-workload-study-day"');
        expect(eKinerjaHtml).toContain('id="study-day-auto-badge"');
        expect(eKinerjaHtml).toContain('window.workloadSetStudyDay(this.value)');
    });

    test('9. e-kinerja.html memuat kartu ringkasan kepatuhan SE Mendikdasmen No. 5684/2025 di tab regulasi', () => {
        expect(eKinerjaHtml).toContain('Hari Belajar Guru (SE Mendikdasmen No. 5684/MDM.B1/HK.04.00/2025)');
        expect(eKinerjaHtml).toContain('Pengembangan Keprofesian Berkelanjutan (PKB)');
    });

    test('10. page-beban-kerja.js mendaftarkan handler window untuk Hari Belajar Guru & MGMP', () => {
        expect(pageBebanKerjaJs).toContain('window.workloadSetStudyDay = setTeacherStudyDay;');
        expect(pageBebanKerjaJs).toContain('window.workloadQuickAddMgmp = quickAddMgmp;');
    });

    test('11. quickAddMgmp mengonfigurasi kegiatan Tugas Pokok PERENCANAAN dan catalog cat_mgmp', () => {
        expect(pageBebanKerjaJs).toContain("dutySelect.value = 'PERENCANAAN';");
        expect(pageBebanKerjaJs).toContain("catSelect.value = 'cat_mgmp';");
        expect(pageBebanKerjaJs).toContain('Kegiatan MGMP / Komunitas Belajar Guru');
    });

    test('12. submitPlan menyertakan verifikasi kepatuhan SE Mendikdasmen No. 5684/2025', () => {
        expect(pageBebanKerjaJs).toContain('checkHasPkActivity(_weekData.segments || [])');
        expect(pageBebanKerjaJs).toContain('SE Mendikdasmen No. 5684/2025');
    });

    test('13. renderDaySelector dan renderTodayTab memuat visualisasi badge & banner toga Hari Belajar Guru', () => {
        expect(pageBebanKerjaJs).toContain('fa-graduation-cap');
        expect(pageBebanKerjaJs).toContain('Belajar');
        expect(pageBebanKerjaJs).toContain('Hari Belajar Guru (SE No. 5684/2025)');
        expect(pageBebanKerjaJs).toContain('+ Tambah MGMP / Belajar Bersama');
    });

    // =================================================================
    // 5. REGULASI OPSI 1: PEMETAAN TUGAS POKOK & VALIDASI KEGIATAN HBG
    // =================================================================
    test('14. isStudyDayCompliantActivity mengenali Tugas Pokok PERENCANAAN (Pasal 4) sebagai ranah sah HBG', () => {
        const segPerencanaan = {
            category_code: 'PERENCANAAN',
            catalog_id: 'cat_rencana_modul',
            title: 'Penyusunan Modul Ajar Fisika Bab 4'
        };
        expect(isStudyDayCompliantActivity(segPerencanaan)).toBe(true);

        const segKurikulum = {
            category_code: 'PERENCANAAN',
            catalog_id: 'cat_rencana_kurikulum',
            title: 'Pengkajian Capaian Pembelajaran Fase F'
        };
        expect(isStudyDayCompliantActivity(segKurikulum)).toBe(true);
    });

    test('15. isStudyDayCompliantActivity mengenali Tugas Tambahan PKB/MGMP/Pelatihan (Pasal 11 & 22) sebagai ranah sah HBG', () => {
        const segPelatihan = {
            category_code: 'TUGAS_TAMBAHAN',
            catalog_id: 'cat_tt_peserta_pelatihan',
            title: 'Pelatihan Pemanfaatan AI untuk Pembelajaran'
        };
        expect(isStudyDayCompliantActivity(segPelatihan)).toBe(true);

        const segKoorPkb = {
            category_code: 'TUGAS_TAMBAHAN',
            catalog_id: 'cat_tt_koor_pkb',
            title: 'Koordinasi Program PKB Guru'
        };
        expect(isStudyDayCompliantActivity(segKoorPkb)).toBe(true);

        const segNarasumber = {
            category_code: 'TUGAS_TAMBAHAN',
            catalog_id: 'cat_tt_narasumber',
            title: 'Berbagi Praktik Baik di Komunitas Belajar'
        };
        expect(isStudyDayCompliantActivity(segNarasumber)).toBe(true);
    });

    test('16. isStudyDayCompliantActivity menolak KBM tatap muka murid dan piket harian sebagai kegiatan ranah HBG', () => {
        const segKbm = {
            category_code: 'PELAKSANAAN_KBM',
            catalog_id: 'cat_kbm',
            is_teaching: 1,
            title: 'KBM Matematika XI.A'
        };
        expect(isStudyDayCompliantActivity(segKbm)).toBe(false);

        const segPiket = {
            category_code: 'TUGAS_TAMBAHAN',
            catalog_id: 'cat_piket',
            title: 'Piket Gerbang dan Ketertiban Sekolah'
        };
        expect(isStudyDayCompliantActivity(segPiket)).toBe(false);

        const segEkskul = {
            category_code: 'PEMBIMBINGAN',
            catalog_id: 'cat_ekstra',
            title: 'Pembimbingan Ekstrakurikuler Pramuka'
        };
        expect(isStudyDayCompliantActivity(segEkskul)).toBe(false);
    });

    test('17. e-kinerja.html memuat banner penanda Hari Belajar Guru di dalam modal form', () => {
        expect(eKinerjaHtml).toContain('id="plan-modal-study-day-banner"');
        expect(eKinerjaHtml).toContain('Hari Belajar Guru (SE No. 5684/2025)');
        expect(eKinerjaHtml).toContain('Fokus PKB & Perencanaan');
    });

    test('18. page-beban-kerja.js memuat penanda Ranah HBG di dropdown Tugas Pokok dan default PERENCANAAN', () => {
        expect(pageBebanKerjaJs).toContain('✨ [Ranah HBG]');
        expect(pageBebanKerjaJs).toContain("isStudyDay ? 'PERENCANAAN' : 'PELAKSANAAN_KBM'");
        expect(pageBebanKerjaJs).toContain('isCatalogItemHbg');
    });

    test('19. submitPlan memvalidasi bahwa rencana pada Hari Belajar Guru wajib memuat minimal 1 kegiatan ranah HBG', () => {
        expect(pageBebanKerjaJs).toContain('validateTeacherStudyDayPlan(_weekData.study_day');
        expect(pageBebanKerjaJs).toContain('if (!studyValidation.isValid)');
    });

    // =================================================================
    // 6. PENANDA TOGA HBG PADA KEGIATAN GANTT & TAB AKTIVITAS
    // =================================================================
    test('20. page-beban-kerja.js mengimplementasikan isActivityHbg dan renderHbgBadge dengan penanda toga fa-graduation-cap', () => {
        expect(pageBebanKerjaJs).toContain('export function isActivityHbg(seg)');
        expect(pageBebanKerjaJs).toContain('export function renderHbgBadge(seg, size = \'sm\')');
        expect(pageBebanKerjaJs).toContain('fa-graduation-cap');
        expect(pageBebanKerjaJs).toContain('HBG');
        expect(pageBebanKerjaJs).toContain('bg-purple-100');
        expect(pageBebanKerjaJs).toContain('window.workloadIsActivityHbg = isActivityHbg;');
        expect(pageBebanKerjaJs).toContain('window.workloadRenderHbgBadge = renderHbgBadge;');
    });

    test('21. renderWeeklyMatrixView (Gantt view) menyematkan penanda toga HBG pada balok kegiatan ranah HBG', () => {
        expect(pageBebanKerjaJs).toContain('const isHbgAct = isActivityHbg(seg);');
        expect(pageBebanKerjaJs).toContain("const hbgBadgeXs = renderHbgBadge(seg, 'xs');");
        expect(pageBebanKerjaJs).toContain('${hbgBadgeXs}');
        expect(pageBebanKerjaJs).toContain('[Ranah HBG]');
    });

    test('22. renderTodayTab dan renderPlanTab menyematkan penanda toga HBG secara konsisten pada daftar kartu aktivitas', () => {
        expect(pageBebanKerjaJs).toContain("const hbgBadgeToday = renderHbgBadge(seg, 'sm');");
        expect(pageBebanKerjaJs).toContain('${hbgBadgeToday}');
        expect(pageBebanKerjaJs).toContain("renderHbgBadge(seg, 'sm')");
    });
});

