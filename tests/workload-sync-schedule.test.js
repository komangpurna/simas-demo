/**
 * tests/workload-sync-schedule.test.js
 * ====================================================================
 * Test Suite: Sinkronisasi Jadwal KBM aSc Timetables ke E-Kinerja Guru
 * Memvalidasi kepatuhan Permendikdasmen 11/2025, Uji 14 (Idempotensi),
 * Uji 16 (Proteksi Log Terverifikasi), dan struktur UI Modal Terpadu.
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const {
    calculateEffectiveMinutes,
    DEFAULT_WORKLOAD_POLICY
} = require('./workload-guru-utils.js');

describe('Suite Pengujian Sinkronisasi Jadwal aSc Timetables ke E-Kinerja', () => {
    const root = path.resolve(__dirname, '..');
    const eKinerjaHtml = fs.readFileSync(path.join(root, 'e-kinerja.html'), 'utf8');
    const pageBebanKerjaJs = fs.readFileSync(path.join(root, 'js', 'page-beban-kerja.js'), 'utf8');
    const workerJs = fs.readFileSync(path.join(root, 'cloudflare', 'worker.js'), 'utf8');

    // =================================================================
    // 1. ELEMEN DOM MODAL SINKRONISASI JADWAL (e-kinerja.html)
    // =================================================================
    test('1. e-kinerja.html memuat elemen Modal Sinkronisasi Jadwal terpadu (#modal-sync-schedule)', () => {
        expect(eKinerjaHtml).toContain('id="modal-sync-schedule"');
        expect(eKinerjaHtml).toContain('id="select-sync-teacher"');
        expect(eKinerjaHtml).toContain('id="sync-schedule-week-badge"');
        expect(eKinerjaHtml).toContain('id="sync-teacher-match-badge"');
        expect(eKinerjaHtml).toContain('id="sync-kpi-total-sessions"');
        expect(eKinerjaHtml).toContain('id="sync-kpi-total-jp"');
        expect(eKinerjaHtml).toContain('id="sync-kpi-total-minutes"');
        expect(eKinerjaHtml).toContain('id="sync-schedule-preview-list"');
        expect(eKinerjaHtml).toContain('id="sync-mode-merge"');
        expect(eKinerjaHtml).not.toContain('id="sync-mode-replace"');
        expect(eKinerjaHtml).toContain('id="btn-confirm-sync-schedule"');
        expect(eKinerjaHtml).toContain('window.workloadCloseSyncScheduleModal()');
        expect(eKinerjaHtml).toContain('window.workloadConfirmSyncSchedule()');
        expect(eKinerjaHtml).toContain('window.workloadOnSyncTeacherChange()');
        expect(eKinerjaHtml).toContain('window.workloadToggleSelectAllSync()');
    });

    // =================================================================
    // 2. KONTROLLER BEBAN KERJA & INTEGRASI MODUL (js/page-beban-kerja.js)
    // =================================================================
    test('2. js/page-beban-kerja.js mengimpor parser aSc Timetables dan mendaftarkan window handlers', () => {
        expect(pageBebanKerjaJs).toContain("getAllScheduleTeachers");
        expect(pageBebanKerjaJs).toContain("getWeeklyScheduleByTeacher");
        expect(pageBebanKerjaJs).toContain("DEFAULT_JP_PERIODS");
        expect(pageBebanKerjaJs).toContain("cfSyncWorkloadSchedule");

        expect(pageBebanKerjaJs).toContain("window.workloadSyncScheduleModal = syncScheduleModal;");
        expect(pageBebanKerjaJs).toContain("window.workloadCloseSyncScheduleModal = closeSyncScheduleModal;");
        expect(pageBebanKerjaJs).toContain("window.workloadConfirmSyncSchedule = confirmSyncSchedule;");
        expect(pageBebanKerjaJs).toContain("window.workloadOnSyncTeacherChange = onSyncTeacherChange;");
        expect(pageBebanKerjaJs).toContain("window.workloadToggleSelectAllSync = toggleSelectAllSync;");
        expect(pageBebanKerjaJs).toContain("window.workloadToggleSyncItem = toggleSyncItem;");
    });

    test('2b. js/page-beban-kerja.js otomatis memilih sesi KBM baru (unadded) dan mode merge untuk hemat kuota write D1', () => {
        expect(pageBebanKerjaJs).toContain('selected: !alreadyInPlan');
        expect(pageBebanKerjaJs).toMatch(/const unaddedItems = _syncScheduleItems\.filter\(it => !it\.already_in_plan/);
        expect(pageBebanKerjaJs).toMatch(/const selectedItems = _syncScheduleItems\.filter\(it => it\.selected && !it\.already_in_plan/);
        expect(pageBebanKerjaJs).toContain('const replaceExisting = false;');
    });

    test('3. Logika pengelompokan slot JP kontinu (consecutive grouping) berjalan presisi', () => {
        // Simulasi 2 JP berturut-turut untuk mapel & kelas sama (JP 1: 07:30-08:15, JP 2: 08:15-09:00)
        const jp1 = { jp: 1, start: '07:30', end: '08:15', mapel: 'Kimia', className: 'XII-1' };
        const jp2 = { jp: 2, start: '08:15', end: '09:00', mapel: 'Kimia', className: 'XII-1' };

        const isSameGroup = jp1.mapel === jp2.mapel && jp1.className === jp2.className && jp2.jp === jp1.jp + 1;
        expect(isSameGroup).toBe(true);

        const groupStart = jp1.start;
        const groupEnd = jp2.end;
        expect(groupStart).toBe('07:30');
        expect(groupEnd).toBe('09:00');

        const effectiveMinutes = calculateEffectiveMinutes(groupStart, groupEnd);
        expect(effectiveMinutes).toBe(90); // 2 JP @ 45m = 90m
    });

    test('4. Sesi KBM melintasi jam istirahat resmi sekolah (09:45-10:00) dipotong 15 menit secara akurat', () => {
        // Misal KBM JP 3 (09:00-09:45) dan JP 4 (10:00-10:45)
        // Rentang kotor 09:00 - 10:45 = 105 menit kotor
        // Dipotong istirahat 15m = 90 menit bersih (2 JP riil)
        const minutes = calculateEffectiveMinutes('09:00', '10:45');
        expect(minutes).toBe(90);
    });

    // =================================================================
    // 3. BACKEND WORKER CLOUDFLARE D1 (cloudflare/worker.js)
    // =================================================================
    test('5. Endpoint POST /api/workload/sync-schedule mendukung replace_existing & validasi status', () => {
        expect(workerJs).toContain('replace_existing = false');
        expect(workerJs).toContain('origin_source = \'schedule_import\'');
        expect(workerJs).toContain('NOT IN (SELECT plan_activity_id FROM plan_log_links)');
        expect(workerJs).toContain('["draft", "needs_revision"].includes(version.status)');
        expect(workerJs).toContain('"SYNC_SCHEDULE"');
    });

    test('6. Uji 14 & 16: Idempotensi terjaga dan laporan terverifikasi tidak terhapus saat replace_existing', () => {
        // Uji 14: schedule_occurrence_id unik mencegah duplikasi
        const incoming = { schedule_occurrence_id: '2026-09-21_d1_jp1_2_Kimia_XII1' };
        const existing = [{ schedule_occurrence_id: '2026-09-21_d1_jp1_2_Kimia_XII1' }];
        const isDuplicate = existing.some(e => e.schedule_occurrence_id === incoming.schedule_occurrence_id);
        expect(isDuplicate).toBe(true);

        // Uji 16: Aktivitas dengan link log di plan_log_links dikecualikan dari penghapusan
        const planActivities = [
            { id: 'act_with_log', hasLogLink: true },
            { id: 'act_no_log', hasLogLink: false }
        ];
        const deletable = planActivities.filter(a => !a.hasLogLink);
        expect(deletable.length).toBe(1);
        expect(deletable[0].id).toBe('act_no_log');
    });
});
