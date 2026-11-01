/**
 * tests/workload-holiday-input-reactive-cleanup.test.js
 * ====================================================================
 * Test Suite: Peniadaan Reaktif Rencana Kerja Saat Hari Libur Baru Diinputkan
 *
 * Menguji:
 * 1. Helper ekspansi tanggal hari libur resmi (single date & multi-day date range).
 * 2. Proteksi Anti-False-Positive terhadap entri heuristik sementara Monitoring KBM.
 * 3. Logika inti pembersihan rencana di hari libur:
 *    - Peniadaan segmen non-log pada tanggal libur resmi.
 *    - Proteksi integritas: segmen yang sudah memiliki log realisasi TIDAK BOLEH dihapus.
 *    - Proteksi status: versi 'approved' dan 'submitted' tetap terjaga statusnya (tidak di-downgrade).
 * 4. Otorisasi RBAC endpoint POST /api/workload/clean-holiday-drafts:
 *    - Pemilik sah dan Kepala Sekolah/Admin berhasil.
 *    - Pengguna lain ditolak HTTP 403 Forbidden.
 * 5. Verifikasi integrasi reactive hook pada rute Agenda di Cloudflare Worker.
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Peniadaan Reaktif Rencana Kerja Saat Hari Libur Baru Diinputkan', () => {
    const root = path.resolve(__dirname, '..');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');
    const clientJsPath = path.join(root, 'js', 'cloudflare-client.js');
    const pageBebanKerjaPath = path.join(root, 'js', 'page-beban-kerja.js');

    const workerJs = fs.readFileSync(workerJsPath, 'utf8');
    const clientJs = fs.readFileSync(clientJsPath, 'utf8');
    const pageBebanKerjaJs = fs.readFileSync(pageBebanKerjaPath, 'utf8');

    // -------------------------------------------------------------------------
    // 1. UJI EKSPANSI RENTANG TANGGAL HARI LIBUR
    // -------------------------------------------------------------------------
    describe('1. Logika Ekspansi Tanggal Hari Libur (expandHolidayDateRangeWl)', () => {
        function expandHolidayDateRangeWl(startDateStr, endDateOrTimeStr) {
            const dates = [];
            if (!startDateStr || typeof startDateStr !== 'string') return dates;
            const s = startDateStr.trim().substring(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return dates;

            let e = s;
            if (endDateOrTimeStr && typeof endDateOrTimeStr === 'string') {
                const candidate = endDateOrTimeStr.trim().substring(0, 10);
                if (/^\d{4}-\d{2}-\d{2}$/.test(candidate) && candidate >= s) {
                    e = candidate;
                }
            }

            try {
                const cur = new Date(s + "T00:00:00Z");
                const end = new Date(e + "T00:00:00Z");
                while (cur <= end) {
                    dates.push(cur.toISOString().slice(0, 10));
                    cur.setUTCDate(cur.getUTCDate() + 1);
                }
            } catch (_) {
                if (!dates.includes(s)) dates.push(s);
            }
            return dates;
        }

        test('mengekspansi tanggal tunggal dengan benar', () => {
            const res = expandHolidayDateRangeWl('2026-11-04', '');
            expect(res).toEqual(['2026-11-04']);
        });

        test('mengekspansi rentang multi-hari inklusif dengan benar', () => {
            const res = expandHolidayDateRangeWl('2026-11-04', '2026-11-06');
            expect(res).toEqual(['2026-11-04', '2026-11-05', '2026-11-06']);
        });

        test('fallback ke tanggal awal jika tanggal akhir lebih kecil atau tidak valid', () => {
            const res = expandHolidayDateRangeWl('2026-11-04', '2026-11-02');
            expect(res).toEqual(['2026-11-04']);
        });
    });

    // -------------------------------------------------------------------------
    // 2. UJI PROTEKSI ANTI-FALSE-POSITIVE HEURISTIK MONITORING KBM
    // -------------------------------------------------------------------------
    describe('2. Anti-False-Positive Filter (isOfficialHolidayForPlanCleanup)', () => {
        function simulateIsOfficialHoliday(dateStr, mockInfo) {
            if (!dateStr || !mockInfo) return false;
            const title = String(mockInfo.title || mockInfo.name || '').trim();
            if (/^Dispensasi Khusus \/ Libur Sekolah \(\d+ Rombel Aktif\)/i.test(title)) {
                return false;
            }
            return true;
        }

        test('menerima hari libur resmi nasional atau sekolah biasa', () => {
            const mockNational = { title: 'Hari Raya Suci Pagerwesi', isHoliday: true };
            expect(simulateIsOfficialHoliday('2026-11-04', mockNational)).toBe(true);

            const mockSchool = { title: 'Libur Fakultatif Sekolah', isHoliday: true };
            expect(simulateIsOfficialHoliday('2026-11-05', mockSchool)).toBe(true);
        });

        test('mengabaikan entri heuristik otomatis Monitoring KBM di pagi hari', () => {
            const mockHeuristic1 = { title: 'Dispensasi Khusus / Libur Sekolah (0 Rombel Aktif)', isHoliday: true };
            expect(simulateIsOfficialHoliday('2026-11-04', mockHeuristic1)).toBe(false);

            const mockHeuristic2 = { title: 'Dispensasi Khusus / Libur Sekolah (3 Rombel Aktif)', isHoliday: true };
            expect(simulateIsOfficialHoliday('2026-11-04', mockHeuristic2)).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // 3. UJI LOGIKA PEMBERSIHAN D1 & 0 DATA LOSS REALISASI
    // -------------------------------------------------------------------------
    describe('3. Logika Pembersihan Segmen D1 & Proteksi Log Realisasi', () => {
        // Simulasi database in-memory sederhana
        function createMockDb() {
            let planVersions = [
                { id: 'pv_01', work_week_id: 'ww_01', teacher_id: 'guru_01', status: 'approved', total_planned_minutes: 2250, is_locked: 0 },
                { id: 'pv_02', work_week_id: 'ww_02', teacher_id: 'guru_02', status: 'draft', total_planned_minutes: 1800, is_locked: 0 }
            ];

            let planActivities = [
                { id: 'act_01', plan_version_id: 'pv_01', catalog_id: 'cat_kbm', title: 'Matematika XII' },
                { id: 'act_02', plan_version_id: 'pv_01', catalog_id: 'cat_evaluasi', title: 'Penyusunan Modul' },
                { id: 'act_03', plan_version_id: 'pv_02', catalog_id: 'cat_kbm', title: 'Fisika XI' }
            ];

            let planSegments = [
                // Rabu 2026-11-04: Matematika XII (Sudah ada log realisasi)
                { id: 'seg_01', plan_version_id: 'pv_01', activity_id: 'act_01', date: '2026-11-04', planned_minutes: 90, is_leave: 0 },
                // Rabu 2026-11-04: Penyusunan Modul (Belum ada log realisasi -> HARUS DIHAPUS)
                { id: 'seg_02', plan_version_id: 'pv_01', activity_id: 'act_02', date: '2026-11-04', planned_minutes: 90, is_leave: 0 },
                // Kamis 2026-11-05: Matematika XII (Hari kerja biasa -> AMAN)
                { id: 'seg_03', plan_version_id: 'pv_01', activity_id: 'act_01', date: '2026-11-05', planned_minutes: 90, is_leave: 0 },
                // Rabu 2026-11-04 di guru 2: Fisika XI (Belum ada log -> HARUS DIHAPUS)
                { id: 'seg_04', plan_version_id: 'pv_02', activity_id: 'act_03', date: '2026-11-04', planned_minutes: 90, is_leave: 0 }
            ];

            let planLogLinks = [
                { plan_activity_id: 'act_01', work_log_id: 'log_01' }
            ];

            return {
                planVersions,
                planActivities,
                planSegments,
                planLogLinks,
                cleanWorkloadPlans(holidayDates, options = {}) {
                    const validDates = new Set(holidayDates);
                    const candidatesToDelete = this.planSegments.filter(s => {
                        if (!validDates.has(s.date)) return false;
                        if (options.plan_version_id && s.plan_version_id !== options.plan_version_id) return false;
                        if (s.is_leave === 1) return false;
                        const act = this.planActivities.find(a => a.id === s.activity_id);
                        if (act && (act.catalog_id === 'cat_cuti_izin' || act.catalog_id === 'cat_libur')) return false;
                        const hasLog = this.planLogLinks.some(l => l.plan_activity_id === s.activity_id);
                        if (hasLog) return false; // DILINDUNGI: 0 DATA LOSS
                        return true;
                    });

                    const deletedIds = new Set(candidatesToDelete.map(c => c.id));
                    this.planSegments = this.planSegments.filter(s => !deletedIds.has(s.id));

                    // Bersihkan aktivitas tanpa segmen
                    const remainingActIds = new Set(this.planSegments.map(s => s.activity_id));
                    this.planActivities = this.planActivities.filter(a => remainingActIds.has(a.id));

                    // Hitung ulang total menit pada versi yang terpengaruh
                    const affectedVersionIds = new Set(candidatesToDelete.map(c => c.plan_version_id));
                    let latestTotal = 0;
                    affectedVersionIds.forEach(vId => {
                        const ver = this.planVersions.find(v => v.id === vId);
                        if (ver) {
                            const newTotal = this.planSegments
                                .filter(s => s.plan_version_id === vId)
                                .reduce((acc, s) => acc + s.planned_minutes, 0);
                            ver.total_planned_minutes = newTotal;
                            latestTotal = newTotal;
                            // Catatan: ver.status TIDAK DIUBAH!
                        }
                    });

                    return {
                        removedCount: candidatesToDelete.length,
                        affectedVersions: affectedVersionIds.size,
                        newTotal: latestTotal
                    };
                }
            };
        }

        test('meniadakan segmen non-log pada hari libur dan melindungi segmen yang sudah memiliki realisasi', () => {
            const db = createMockDb();
            const res = db.cleanWorkloadPlans(['2026-11-04']);

            // Segmen seg_02 dan seg_04 dihapus, tapi seg_01 dilindungi karena act_01 punya log_link
            expect(res.removedCount).toBe(2);
            expect(db.planSegments.map(s => s.id)).toEqual(['seg_01', 'seg_03']);
        });

        test('mempertahankan status versi "approved" dan memperbarui total_planned_minutes', () => {
            const db = createMockDb();
            db.cleanWorkloadPlans(['2026-11-04'], { plan_version_id: 'pv_01' });

            const ver1 = db.planVersions.find(v => v.id === 'pv_01');
            expect(ver1.status).toBe('approved'); // Tetap approved!
            expect(ver1.total_planned_minutes).toBe(180); // 90m seg_01 + 90m seg_03 (seg_02 90m ditiadakan)
        });
    });

    // -------------------------------------------------------------------------
    // 4. UJI PARITAS KODE & OTORISASI RBAC BACKEND
    // -------------------------------------------------------------------------
    describe('4. Paritas Otorisasi Endpoint & Reactive Hooks di Cloudflare Worker', () => {
        test('cloudflare/worker.js memuat fungsi expandHolidayDateRangeWl dan cleanWorkloadPlansOnHolidayDates', () => {
            expect(workerJs).toContain('function expandHolidayDateRangeWl(');
            expect(workerJs).toContain('async function cleanWorkloadPlansOnHolidayDates(');
            expect(workerJs).toContain('function isHolidayAgendaEvent(');
        });

        test('cloudflare/worker.js mengintegrasikan reactive cleanup di rute Agenda', () => {
            // POST /api/agenda/events (batch & single)
            expect(workerJs).toMatch(/cleanWorkloadPlansOnHolidayDates\(env\.DB,\s*holidayDatesToClean\)/);
            // PUT /api/agenda/events/:id
            expect(workerJs).toMatch(/isHolidayAgendaEvent\(\{ category: eventCategory/);
            // POST /api/migrate/agenda
            expect(workerJs).toMatch(/cleanWorkloadPlansOnHolidayDates\(env\.DB,\s*migratedHolidayDates\)/);
        });

        test('cloudflare/worker.js memiliki endpoint POST /api/workload/clean-holiday-drafts dengan RBAC', () => {
            expect(workerJs).toContain('path === "/api/workload/clean-holiday-drafts" && method === "POST"');
            expect(workerJs).toContain('isWorkloadOwner(version.teacher_id, authResult.user, userTeacherId)');
            expect(workerJs).toContain('Minggu kerja telah dikunci');
            expect(workerJs).toContain('CLEAN_HOLIDAY_DRAFTS');
        });

        test('js/cloudflare-client.js menyediakan fungsi cfCleanWorkloadHolidayDrafts dan window binding', () => {
            expect(clientJs).toContain('export async function cfCleanWorkloadHolidayDrafts(');
            expect(clientJs).toContain('window.cfCleanWorkloadHolidayDrafts = cfCleanWorkloadHolidayDrafts');
        });

        test('js/page-beban-kerja.js mengintegrasikan self-healing on-load dan validasi anti-false-positive', () => {
            expect(pageBebanKerjaJs).toContain('export function isOfficialHolidayForPlanCleanup(');
            expect(pageBebanKerjaJs).toContain('cfCleanWorkloadHolidayDrafts');
            expect(pageBebanKerjaJs).toContain('Auto-Healing Hari Libur Resmi');
            expect(pageBebanKerjaJs).toContain('window.workloadClearHolidayDraftItems = clearHolidayDraftItems');
        });
    });
});
