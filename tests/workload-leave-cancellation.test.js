const fs = require('fs');
const path = require('path');
const {
    calculateDayTimelineSlots,
    validateWeeklyPlanCompleteness,
    calculateAdjustedWeeklyTarget,
    DEFAULT_WORKLOAD_POLICY
} = require('./workload-guru-utils.js');

describe('Suite Pengujian Cuti/Izin Guru & Pengecualian HBG (SE No. 5684/2025)', () => {
    const weekStartDate = '2026-10-12'; // Senin
    let pageBebanKerjaJs;
    let workerJs;
    let eKinerjaHtml;

    beforeAll(() => {
        pageBebanKerjaJs = fs.readFileSync(path.join(__dirname, '../js/page-beban-kerja.js'), 'utf8');
        workerJs = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');
        eKinerjaHtml = fs.readFileSync(path.join(__dirname, '../e-kinerja.html'), 'utf8');
    });

    test('1. calculateDayTimelineSlots mendeteksi Cuti/Izin: durasi 0m, isLeave: true, isHoliday: false, dan isComplete: true', () => {
        const leaveDate = '2026-10-12';
        const segments = [
            {
                id: 'seg_leave_1',
                date: leaveDate,
                title: 'Cuti Tahunan',
                start_time: '07:30',
                end_time: '15:30',
                planned_minutes: 0,
                is_leave: 1,
                catalog_id: 'cat_cuti_izin',
                category_code: 'CUTI_IZIN'
            }
        ];

        const timeline = calculateDayTimelineSlots(leaveDate, segments);

        expect(timeline.isLeave).toBe(true);
        expect(timeline.isHoliday).toBe(false);
        expect(timeline.totalPlannedMinutes).toBe(0); // Jam kerja terencana 0m
        expect(timeline.emptyMinutes).toBe(0);
        expect(timeline.emptySlotsCount).toBe(0);
        expect(timeline.isComplete).toBe(true);
        expect(timeline.leaveTitle).toBe('Cuti Tahunan');
    });

    test('2. Target mingguan tetap 2.250 menit saat ada Cuti/Izin (tidak dikurangi seperti libur kalender)', () => {
        const segments = [
            {
                id: 'seg_leave_1',
                date: '2026-10-12', // Senin: Cuti
                title: 'Izin',
                start_time: '07:30',
                end_time: '15:30',
                planned_minutes: 0,
                is_leave: 1
            }
        ];

        const target = calculateAdjustedWeeklyTarget(weekStartDate, segments);

        // Target mingguan tetap utuh 2.250 menit karena bukan libur sekolah kalender
        expect(target.targetMinutes).toBe(2250);
        expect(target.holidayCount).toBe(0);
    });

    test('3. validateWeeklyPlanCompleteness meloloskan rencana dengan Cuti/Izin tanpa menganggapnya slot jam kosong', () => {
        // Senin Cuti, Selasa s.d Jumat terisi penuh (450m x 4 = 1.800m)
        const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
        const segments = [
            {
                id: 'seg_leave_mon',
                date: days[0],
                title: 'Cuti Tahunan',
                start_time: '07:30',
                end_time: '15:30',
                planned_minutes: 0,
                is_leave: 1
            }
        ];

        // Isi 4 hari sisanya secara penuh
        for (let i = 1; i < 5; i++) {
            const d = days[i];
            segments.push(
                { id: `s_${i}_1`, date: d, start_time: '07:30', end_time: '09:45', planned_minutes: 135, title: 'KBM Pagi' },
                { id: `s_${i}_2`, date: d, start_time: '10:00', end_time: '12:15', planned_minutes: 135, title: 'KBM Siang 1' },
                { id: `s_${i}_3`, date: d, start_time: '12:30', end_time: '15:30', planned_minutes: 180, title: 'KBM Siang 2' }
            );
        }

        const completeness = validateWeeklyPlanCompleteness(weekStartDate, segments);

        expect(completeness.isValid).toBe(true);
        expect(completeness.incompleteDays).toHaveLength(0);
        expect(completeness.totalEmptyMinutes).toBe(0);
        expect(completeness.totalEmptySlotsCount).toBe(0);
    });

    test('4. Ketika Cuti/Izin jatuh pada Hari Belajar Guru (HBG), rencana tetap sah dan bisa disimpan/diajukan (Exempt HBG)', () => {
        // Kamis (indeks 3) adalah Hari Belajar Guru (HBG), tetapi guru mengambil Cuti/Izin pada hari Kamis
        const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
        const segments = [];

        for (let i = 0; i < 5; i++) {
            const d = days[i];
            if (i === 3) {
                // Hari Kamis = Cuti/Izin (tanpa kegiatan HBG/MGMP)
                segments.push({
                    id: `leave_thu`,
                    date: d,
                    title: 'Cuti Tahunan',
                    start_time: '07:30',
                    end_time: '15:30',
                    planned_minutes: 0,
                    is_leave: 1
                });
            } else {
                // Hari biasa terisi penuh
                segments.push(
                    { id: `s_${i}_1`, date: d, start_time: '07:30', end_time: '09:45', planned_minutes: 135, title: 'KBM' },
                    { id: `s_${i}_2`, date: d, start_time: '10:00', end_time: '12:15', planned_minutes: 135, title: 'KBM' },
                    { id: `s_${i}_3`, date: d, start_time: '12:30', end_time: '15:30', planned_minutes: 180, title: 'KBM' }
                );
            }
        }

        const completeness = validateWeeklyPlanCompleteness(weekStartDate, segments, {
            studyDayIndex: 3,
            enforceStudyDay: true
        });

        // Karena Kamis adalah Cuti/Izin, kewajiban HBG otomatis dilewati
        expect(completeness.studyDayValid).toBe(true);
        expect(completeness.isValid).toBe(true);
    });

    test('5. js/page-beban-kerja.js dan e-kinerja.html mengintegrasikan modal Cuti/Izin dan alur nonaktifkan cuti', () => {
        // Tombol Cuti/Izin di kartu hari dengan affordance tombol jelas (+ Cuti/Izin)
        expect(pageBebanKerjaJs).toContain('window.workloadMarkDayLeave');
        expect(pageBebanKerjaJs).toContain('+ Cuti/Izin');
        expect(pageBebanKerjaJs).toContain('fa-calendar-plus');
        expect(pageBebanKerjaJs).toContain('Nonaktifkan Cuti');
        expect(pageBebanKerjaJs).toContain('deactivateDayLeave');

        // Modal di HTML
        expect(eKinerjaHtml).toContain('id="modal-mark-leave"');
        expect(eKinerjaHtml).toContain('id="leave-input-type"');
        expect(eKinerjaHtml).toContain('Cuti Tahunan');
        expect(eKinerjaHtml).toContain('Izin');
    });

    test('6. cloudflare/worker.js menyimpan Cuti/Izin dengan planned_minutes: 0', () => {
        expect(workerJs).toContain("isLeaveItem ? 0 : calculateEffectiveMinutesWl");
        expect(workerJs).toContain("isLeaveItem ? \"CUTI_IZIN\" : \"PELAKSANAAN_KBM\"");
    });

    test('7. Kegiatan kerja normal dengan kata kunci "izin" atau "cuti" TIDAK otomatis dianggap Cuti/Izin (Anti-False-Positive Leave)', () => {
        const testDate = '2026-10-12';
        const segments = [
            {
                id: 'seg_normal_izin',
                date: testDate,
                title: 'Sosialisasi Izin Operasional Laboratorium Komputer',
                start_time: '07:30',
                end_time: '09:45',
                planned_minutes: 135,
                catalog_id: 'cat_tugas_tambahan',
                category_code: 'TUGAS_TAMBAHAN'
            }
        ];

        const timeline = calculateDayTimelineSlots(testDate, segments);

        // Harus tetap dihitung sebagai kegiatan aktif biasa, BUKAN cuti
        expect(timeline.isLeave).toBe(false);
        expect(timeline.totalPlannedMinutes).toBe(135);
        expect(timeline.slots.some(s => s.type === 'activity' && s.title.includes('Izin Operasional'))).toBe(true);

        // cloudflare/worker.js dan tests/workload-guru-utils.js tidak boleh lagi mendeteksi kata kunci title cuti/izin secara otomatis
        expect(workerJs).not.toMatch(/it\.title\.toLowerCase\(\)\.includes\(['"]cuti['"]\)/);
        expect(workerJs).not.toMatch(/it\.title\.toLowerCase\(\)\.includes\(['"]izin['"]\)/);
    });

    test('8. Integritas Skema SQLite Asli (PRAGMA foreign_keys = ON): cat_cuti_izin terdaftar resmi di activity_catalog dan lolos Foreign Key constraint tanpa galat D1_ERROR', () => {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(':memory:');
        db.exec('PRAGMA foreign_keys = ON;');

        // Inisialisasi skema inti D1
        const schemaSql = fs.readFileSync(path.join(__dirname, '../cloudflare/schema.sql'), 'utf8');
        const workloadMigrationSql = fs.readFileSync(path.join(__dirname, '../cloudflare/migrations/202609230001_add_workload_module.sql'), 'utf8');
        const cutiCatalogMigrationSql = fs.readFileSync(path.join(__dirname, '../cloudflare/migrations/202610120001_add_cuti_izin_to_activity_catalog.sql'), 'utf8');

        db.exec(schemaSql);
        db.exec(workloadMigrationSql);
        db.exec(cutiCatalogMigrationSql);

        // Verifikasi cat_cuti_izin ada di activity_catalog
        const catRow = db.prepare("SELECT * FROM activity_catalog WHERE id = 'cat_cuti_izin'").get();
        expect(catRow).toBeTruthy();
        expect(catRow.id).toBe('cat_cuti_izin');
        expect(catRow.category_code).toBe('CUTI_IZIN');

        // Pastikan STANDARD_WORKLOAD_CATALOG di worker.js memuat cat_cuti_izin
        expect(workerJs).toContain('id: "cat_cuti_izin"');
        expect(workerJs).toContain('category_code: "CUTI_IZIN"');

        // Siapkan data relasional master: gtk, school_work_policies, work_weeks, weekly_plan_versions
        db.prepare("INSERT INTO gtk (id, name, nip, jenis_ptk, status) VALUES ('gtk_guru_1', 'I Komang Purna', '19870101', 'Guru Mapel', 'active')").run();
        db.prepare("INSERT INTO school_work_policies (id, school_id, policy_name, effective_from) VALUES ('pol_1', 'smagesa', 'Kebijakan Standar', '2026-07-01')").run();
        db.prepare("INSERT INTO work_weeks (id, teacher_id, week_start_date, week_end_date, academic_year, semester, policy_id) VALUES ('ww_1', 'gtk_guru_1', '2026-10-12', '2026-10-16', '2026/2027', '1', 'pol_1')").run();
        db.prepare("INSERT INTO weekly_plan_versions (id, work_week_id, version_number, status) VALUES ('ver_1', 'ww_1', 1, 'draft')").run();

        // 1. Uji Positif: Insert plan_activities dengan catalog_id 'cat_cuti_izin' WAJIB berhasil tanpa pelanggaran Foreign Key
        const actId = 'act_leave_test';
        expect(() => {
            db.prepare(`
                INSERT INTO plan_activities (
                    id, work_week_id, catalog_id, title, category_code, origin_source, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            `).run(actId, 'ww_1', 'cat_cuti_izin', 'Cuti Tahunan', 'CUTI_IZIN', 'manual');
        }).not.toThrow();

        // Insert plan_time_segments terhubung
        expect(() => {
            db.prepare(`
                INSERT INTO plan_time_segments (
                    id, plan_version_id, activity_id, date, day_of_week, start_time, end_time, planned_minutes, is_teaching
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run('seg_leave_test', 'ver_1', actId, '2026-10-13', 2, '07:30', '15:30', 0, 0);
        }).not.toThrow();

        const insertedSeg = db.prepare("SELECT * FROM plan_time_segments WHERE id = 'seg_leave_test'").get();
        expect(insertedSeg.planned_minutes).toBe(0);

        // 2. Uji Negatif (Security & FK Guard): Insert dengan catalog_id fiktif WAJIB DITOLAK oleh SQLite Foreign Key
        expect(() => {
            db.prepare(`
                INSERT INTO plan_activities (
                    id, work_week_id, catalog_id, title, category_code, origin_source
                ) VALUES (?, ?, ?, ?, ?, ?)
            `).run('act_invalid_test', 'ww_1', 'cat_fiktif_tidak_ada', 'Aktivitas Fiktif', 'PELAKSANAAN_KBM', 'manual');
        }).toThrow(/FOREIGN KEY/i);

        db.close();
    });

    test('9. Paritas Aksi Atomik & Anti-Orphan: submitMarkLeave menggunakan clear_date atomik di server (0 network delete loop & bebas galat 404)', () => {
        // page-beban-kerja.js wajib mengirimkan clear_date ke cfSaveWorkloadPlanItems
        expect(pageBebanKerjaJs).toContain('clear_date: dayDate');

        // worker.js wajib menangani parameter clear_date dalam POST /api/workload/plan-items
        expect(workerJs).toContain('clear_date');
        expect(workerJs).toContain('if (clear_date && seg.date === clear_date) return;');
        expect(workerJs).toContain('DELETE FROM plan_time_segments WHERE id = ?');
        expect(workerJs).toContain('DELETE FROM plan_activities WHERE id = ?');
    });
});
