/**
 * Unit Test: Proteksi Anti-Benturan Waktu (Anti-Overlap Mandate)
 * Memverifikasi larangan irisan jam kerja pada Rencana Kerja dan Laporan Realisasi E-Kinerja Guru.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
    findTimeOverlap,
    validateNoOverlap,
    validateWeeklyPlanCompleteness
} = require('./workload-guru-utils.js');

describe('Proteksi Anti-Benturan Waktu (Anti-Overlap Mandate) E-Kinerja Guru', () => {
    const root = path.resolve(__dirname, '..');
    const pageBebanKerjaJsPath = path.join(root, 'js', 'page-beban-kerja.js');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');
    const eKinerjaHtmlPath = path.join(root, 'e-kinerja.html');

    const pageBebanKerjaContent = fs.readFileSync(pageBebanKerjaJsPath, 'utf8');
    const workerContent = fs.readFileSync(workerJsPath, 'utf8');
    const eKinerjaHtmlContent = fs.readFileSync(eKinerjaHtmlPath, 'utf8');

    test('1. findTimeOverlap mendeteksi kasus beririsan persis seperti keluhan user (07:30-08:15 vs 08:00-09:30)', () => {
        const existing = [
            { id: 'act_1', start_time: '07:30', end_time: '08:15', title: 'Upacara Bendera' }
        ];
        const newTarget = {
            start_time: '08:00',
            end_time: '09:30',
            title: 'Membuat perangkat ajar untuk 1 minggu kedepan'
        };

        const res = findTimeOverlap(newTarget, existing);
        expect(res.hasOverlap).toBe(true);
        expect(res.conflictingSegment.id).toBe('act_1');
        expect(res.message).toContain('Benturan jam kerja terdeteksi');
        expect(res.message).toContain('Upacara Bendera');
    });

    test('2. findTimeOverlap mengizinkan jam yang bersentuhan/bersebelahan (07:30-08:15 dan 08:15-09:00)', () => {
        const existing = [
            { id: 'act_1', start_time: '07:30', end_time: '08:15', title: 'Upacara Bendera' }
        ];
        const newTarget = {
            start_time: '08:15',
            end_time: '09:00',
            title: 'KBM Kimia'
        };

        const res = findTimeOverlap(newTarget, existing);
        expect(res.hasOverlap).toBe(false);
    });

    test('3. findTimeOverlap mengecualikan excludeId saat mengedit diri sendiri', () => {
        const existing = [
            { id: 'act_1', start_time: '07:30', end_time: '08:15', title: 'Upacara Bendera' }
        ];
        const editingSelf = {
            id: 'act_1',
            start_time: '07:30',
            end_time: '08:30',
            title: 'Upacara Bendera Diperpanjang'
        };

        const res = findTimeOverlap(editingSelf, existing, 'act_1');
        expect(res.hasOverlap).toBe(false);
    });

    test('4. validateNoOverlap mendeteksi irisan antar segmen secara pairwise', () => {
        const segments = [
            { start_time: '07:30', end_time: '08:15', title: 'Upacara Bendera' },
            { start_time: '08:00', end_time: '09:30', title: 'Membuat perangkat ajar' }
        ];
        const check = validateNoOverlap(segments);
        expect(check.isValid).toBe(false);
        expect(check.conflictMessage).toContain('Benturan waktu antara "Upacara Bendera"');
    });

    test('5. validateWeeklyPlanCompleteness menolak pengesahan rencana jika ada jam beririsan pada hari kerja aktif', () => {
        const segments = [
            // Senin beririsan:
            { date: '2026-09-21', start_time: '07:30', end_time: '08:15', title: 'Upacara Bendera', category_code: 'PERENCANAAN' },
            { date: '2026-09-21', start_time: '08:00', end_time: '09:30', title: 'Membuat modul ajar', category_code: 'PERENCANAAN' },
            { date: '2026-09-21', start_time: '09:45', end_time: '12:15', title: 'Perangkat', category_code: 'PERENCANAAN' },
            { date: '2026-09-21', start_time: '12:30', end_time: '15:30', title: 'Kombel', category_code: 'PERENCANAAN' }
        ];

        const completeness = validateWeeklyPlanCompleteness('2026-09-21', segments, { studyDayIndex: 0 });
        expect(completeness.isValid).toBe(false);
        expect(completeness.message).toContain('benturan jam kerja');
    });

    test('6. js/page-beban-kerja.js menerapkan validasi anti-overlap pada savePlanItem', () => {
        expect(pageBebanKerjaContent).toContain('findTimeOverlap(item, daySegments, existingId || existingActivityId)');
        expect(pageBebanKerjaContent).toContain('el(\'plan-input-start\')?.focus()');
    });

    test('7. js/page-beban-kerja.js menerapkan validasi anti-overlap pada saveLog', () => {
        expect(pageBebanKerjaContent).toContain('findTimeOverlap({ start_time: start, end_time: end }, existingLogSegs)');
        expect(pageBebanKerjaContent).toContain('el(\'log-input-start\')?.focus()');
    });

    test('8. cloudflare/worker.js memuat segmen existing DB sebelum validasi no-overlap pada POST plan-items', () => {
        expect(workerContent).toContain('SELECT pts.id, pts.activity_id, pts.date, pts.day_of_week, pts.start_time, pts.end_time, pa.title');
        expect(workerContent).toContain('FROM plan_time_segments pts');
        expect(workerContent).toContain('WHERE pts.plan_version_id = ?');
        expect(workerContent).toContain('validateSegmentsNoOverlapWl(itemsByDate[dateKey])');
    });

    test('9. cloudflare/worker.js memvalidasi irisan jam kerja realisasi pada POST workload/logs', () => {
        expect(workerContent).toContain('SELECT wl.id, wl.title, wls.start_time, wls.end_time');
        expect(workerContent).toContain('FROM work_logs wl');
        expect(workerContent).toContain('JOIN work_log_segments wls ON wl.id = wls.work_log_id');
        expect(workerContent).toContain('Benturan jam kerja terdeteksi: waktu');
    });

    test('10. e-kinerja.html memiliki kontainer alert benturan waktu real-time pada modal rencana dan log', () => {
        expect(eKinerjaHtmlContent).toContain('id="plan-time-overlap-alert"');
        expect(eKinerjaHtmlContent).toContain('id="plan-time-overlap-message"');
        expect(eKinerjaHtmlContent).toContain('id="btn-submit-workload-plan"');
        expect(eKinerjaHtmlContent).toContain('id="log-time-overlap-alert"');
        expect(eKinerjaHtmlContent).toContain('id="log-time-overlap-message"');
        expect(eKinerjaHtmlContent).toContain('id="btn-submit-workload-log"');
    });

    test('11. e-kinerja.html memasang listener oninput dan onchange real-time pada field jam', () => {
        expect(eKinerjaHtmlContent).toContain('id="plan-input-start" required oninput="window.workloadUpdatePlannedMinutesPreview()" onchange="window.workloadUpdatePlannedMinutesPreview()"');
        expect(eKinerjaHtmlContent).toContain('id="plan-input-end" required oninput="window.workloadUpdatePlannedMinutesPreview()" onchange="window.workloadUpdatePlannedMinutesPreview()"');
        expect(eKinerjaHtmlContent).toContain('id="log-input-start" oninput="window.workloadUpdateLogMinutesPreview()" onchange="window.workloadUpdateLogMinutesPreview()"');
        expect(eKinerjaHtmlContent).toContain('id="log-input-end" oninput="window.workloadUpdateLogMinutesPreview()" onchange="window.workloadUpdateLogMinutesPreview()"');
        expect(eKinerjaHtmlContent).toContain('id="log-input-date" required onchange="window.workloadUpdateLogMinutesPreview()"');
    });

    test('12. js/page-beban-kerja.js updatePlannedMinutesPreview mendeteksi benturan waktu dan menonaktifkan submit', () => {
        expect(pageBebanKerjaContent).toContain('function updatePlannedMinutesPreview() {');
        expect(pageBebanKerjaContent).toContain('const alertBox = el(\'plan-time-overlap-alert\');');
        expect(pageBebanKerjaContent).toContain('const submitBtn = el(\'btn-submit-workload-plan\');');
        expect(pageBebanKerjaContent).toContain('overlapCheck.hasOverlap');
        expect(pageBebanKerjaContent).toContain('submitBtn.disabled = true');
    });

    test('13. js/page-beban-kerja.js updateLogMinutesPreview mendeteksi benturan waktu realisasi dan menonaktifkan submit', () => {
        expect(pageBebanKerjaContent).toContain('function updateLogMinutesPreview() {');
        expect(pageBebanKerjaContent).toContain('const alertBox = el(\'log-time-overlap-alert\');');
        expect(pageBebanKerjaContent).toContain('const submitBtn = el(\'btn-submit-workload-log\');');
        expect(pageBebanKerjaContent).toContain('submitBtn.disabled = true');
    });

    test('14. validateNoOverlap mendeteksi dan memberi pesan spesifik "Kegiatan kembar/duplikat" pada item dengan jam dan judul identik', () => {
        const dupSegments = [
            { id: 'item_1', start_time: '07:30', end_time: '08:15', title: 'Upacara Bendera' },
            { id: 'item_2', start_time: '07:30', end_time: '08:15', title: 'Upacara Bendera' }
        ];
        const res = validateNoOverlap(dupSegments);
        expect(res.isValid).toBe(false);
        expect(res.conflictMessage).toContain('Kegiatan kembar/duplikat "Upacara Bendera" (07:30 - 08:15)');
    });

    test('15. calculateDayTimelineSlots memasukkan seluruh kegiatan yang beririsan tanpa menyembunyikan duplikat dan menandai hasConflict: true', () => {
        const { calculateDayTimelineSlots } = require('./workload-guru-utils.js');
        const dupSegments = [
            { id: 'item_1', start_time: '07:30', end_time: '08:15', title: 'Upacara Bendera' },
            { id: 'item_2', start_time: '07:30', end_time: '08:15', title: 'Upacara Bendera' },
            { id: 'item_3', start_time: '08:15', end_time: '09:00', title: 'Kedisiplinan Siswa' }
        ];
        const timeline = calculateDayTimelineSlots('2026-10-05', dupSegments);
        expect(timeline.hasConflict).toBe(true);
        expect(timeline.conflictingCount).toBe(2);
        // Memastikan kedua kegiatan Upacara Bendera tetap ada di dalam slots
        const upacaraSlots = timeline.slots.filter(s => s.title === 'Upacara Bendera');
        expect(upacaraSlots.length).toBe(2);
        expect(upacaraSlots[0].hasConflict).toBe(true);
        expect(upacaraSlots[1].hasConflict).toBe(true);
    });

    test('16. cloudflare/worker.js mendukung replace_existing & skip-conflicts pada apply-template serta endpoint deduplicate-plan', () => {
        expect(workerContent).toContain('path === "/api/workload/apply-template"');
        expect(workerContent).toContain('replace_existing = true');
        expect(workerContent).toContain('path === "/api/workload/deduplicate-plan"');
        expect(pageBebanKerjaContent).toContain('window.workloadAutoDeduplicate');
        expect(eKinerjaHtmlContent).toContain('name="apply-template-mode"');
    });

    test('17. cloudflare/worker.js memanggil performDeduplicatePlanWl otomatis pada sync-schedule, apply-template, dan submit-plan', () => {
        expect(workerContent).toContain('async function performDeduplicatePlanWl(db, plan_version_id, work_week_id');
        expect(workerContent).toContain('await performDeduplicatePlanWl(env.DB, plan_version_id, work_week_id');
    });

    test('18. performDeduplicatePlanWl melindungi item yang telah direalisasikan dan memprioritaskan jadwal KBM resmi di atas template', () => {
        // Cek query perlindungan log dan sorting prioritas sumber
        expect(workerContent).toContain('SELECT COUNT(*) FROM plan_log_links pll WHERE pll.plan_activity_id = pa.id');
        expect(workerContent).toContain('schedule_import');
        expect(workerContent).toContain('DELETE FROM plan_time_segments WHERE id = ?');
        expect(workerContent).toContain('UPDATE weekly_plan_versions');
    });

    test('19. js/page-beban-kerja.js menerapkan silent auto-healing pada loadWeek dan submitPlan', () => {
        expect(pageBebanKerjaContent).toContain('_autoCleanedVersionId');
        expect(pageBebanKerjaContent).toContain('await autoDeduplicatePlan({ silent: true })');
        expect(pageBebanKerjaContent).toContain('cfDeduplicateWorkloadPlan');
    });

    test('20. js/page-beban-kerja.js quickReportComplete menangani bentrokan dengan resolusi mandiri tanpa error kasar', () => {
        expect(pageBebanKerjaContent).toContain('Apakah kegiatan ini merupakan jadwal kembar/duplikat yang ingin otomatis ditandai sebagai \'Tidak Terlaksana (Duplikat Rencana)\'?');
        expect(pageBebanKerjaContent).toContain('Tandai Tidak Terlaksana (Duplikat)');
        expect(pageBebanKerjaContent).toContain('status_execution: \'tidak_terlaksana\'');
    });
});

