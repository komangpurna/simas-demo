/**
 * tests/workload-plan-lock-realized.test.js
 * ====================================================================
 * Test Suite: Proteksi Penguncian Rencana Kerja yang Telah Direalisasikan
 * Memvalidasi:
 * 1. Backend API (Cloudflare Worker D1):
 *    - Query segmen mingguan menyertakan subquery `has_realized_log`
 *    - Handler POST /api/workload/plan-items memblokir pembaruan item yang tertaut di plan_log_links (HTTP 422)
 *    - Handler DELETE /api/workload/plan-items/:id memblokir penghapusan item yang tertaut di plan_log_links (HTTP 422)
 * 2. Frontend Antarmuka (js/page-beban-kerja.js):
 *    - Fungsi helper `isPlanSegmentRealized` mendeteksi realisasi secara akurat (SSOT)
 *    - Ekspor global window.isPlanSegmentRealized tersedia
 *    - Proteksi pada openPlanItemModal, markDayHoliday, savePlanItem, dan deletePlanItem
 *    - Render UI menampilkan badge "Terealisasi" dan status gembok "Terkunci" pada item terealisasi
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Proteksi Penguncian Rencana Kerja yang Telah Direalisasikan', () => {
    const root = path.resolve(__dirname, '..');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');
    const pageBebanKerjaPath = path.join(root, 'js', 'page-beban-kerja.js');

    const workerJs = fs.readFileSync(workerJsPath, 'utf8');
    const pageBebanKerjaJs = fs.readFileSync(pageBebanKerjaPath, 'utf8');

    describe('1. Validasi Backend Cloudflare Worker (cloudflare/worker.js)', () => {
        test('1.1 Query GET /api/workload/weeks/:id wajib menyertakan subquery has_realized_log', () => {
            expect(workerJs).toMatch(/SELECT\s+pts\.\*.*pa\.title.*\(SELECT\s+COUNT\(\*\)\s+FROM\s+plan_log_links\s+pll\s+WHERE\s+pll\.plan_activity_id\s*=\s*pa\.id\)\s+AS\s+has_realized_log/s);
        });

        test('1.2 Handler POST /api/workload/plan-items wajib memvalidasi dan memblokir edit jika ada relasi plan_log_links', () => {
            expect(workerJs).toMatch(/SELECT\s+COUNT\(\*\)\s+AS\s+c\s+FROM\s+plan_log_links\s+WHERE\s+plan_activity_id\s*=\s*\?/);
            expect(workerJs).toMatch(/Kegiatan rencana yang telah direalisasikan tidak dapat disunting atau diubah jadwalnya/);
        });

        test('1.3 Handler DELETE /api/workload/plan-items/:id wajib memvalidasi dan memblokir hapus jika ada relasi plan_log_links', () => {
            expect(workerJs).toMatch(/SELECT\s+COUNT\(\*\)\s+AS\s+c\s+FROM\s+plan_log_links\s+WHERE\s+plan_activity_id\s*=\s*\?/);
            expect(workerJs).toMatch(/Kegiatan rencana yang telah direalisasikan tidak dapat dihapus/);
        });
    });

    describe('2. Validasi Frontend Antarmuka (js/page-beban-kerja.js)', () => {
        test('2.1 Fungsi isPlanSegmentRealized wajib didefinisikan dan diekspor', () => {
            expect(pageBebanKerjaJs).toContain('export function isPlanSegmentRealized(seg)');
            expect(pageBebanKerjaJs).toContain('window.isPlanSegmentRealized = isPlanSegmentRealized;');
        });

        test('2.2 Logika isPlanSegmentRealized memeriksa has_realized_log, plan_links, dan logs', () => {
            expect(pageBebanKerjaJs).toContain('Number(seg.has_realized_log) > 0');
            expect(pageBebanKerjaJs).toContain('links.some(l => l.plan_activity_id === actId)');
            expect(pageBebanKerjaJs).toContain('logs.some(l => l.plan_activity_id === actId)');
        });

        test('2.3 renderPlanTab menampilkan badge Terealisasi dan status Terkunci (tanpa tombol edit/hapus)', () => {
            expect(pageBebanKerjaJs).toContain('const isRealized = isPlanSegmentRealized(seg);');
            expect(pageBebanKerjaJs).toContain('Terealisasi');
            expect(pageBebanKerjaJs).toContain('Terkunci');
            expect(pageBebanKerjaJs).toMatch(/canEdit\s*\?\s*\(isRealized\s*\?\s*`.*Terkunci.*`\s*:\s*`.*workloadOpenPlanItemModal.*workloadDeletePlanItem.*`\)/s);
        });

        test('2.4 openPlanItemModal memblokir pembukaan modal jika segmen rencana telah direalisasikan', () => {
            expect(pageBebanKerjaJs).toMatch(/if\s*\(isPlanSegmentRealized\(existingSeg\)\)\s*\{\s*showToast\('Kegiatan rencana ini telah direalisasikan dan tidak dapat disunting lagi\.', 'warning'\);\s*return;\s*\}/);
        });

        test('2.5 markDayHoliday memblokir penandaan libur jika terdapat segmen hari yang telah direalisasikan', () => {
            expect(pageBebanKerjaJs).toMatch(/if\s*\(daySegments\.some\(s\s*=>\s*isPlanSegmentRealized\(s\)\)\)\s*\{\s*showToast\('Hari ini memuat kegiatan rencana yang telah direalisasikan dan tidak dapat ditandai (?:libur|Cuti\/Izin|libur \/ Cuti\/Izin)\.', 'warning'\);\s*return;\s*\}/);
        });

        test('2.6 savePlanItem memblokir penyimpanan modifikasi jika segmen rencana telah direalisasikan', () => {
            expect(pageBebanKerjaJs).toMatch(/if\s*\(isPlanSegmentRealized\(seg\)\)\s*\{\s*showToast\('Kegiatan rencana ini telah direalisasikan dan tidak dapat disunting atau diubah\.', 'warning'\);\s*return;\s*\}/);
        });

        test('2.7 deletePlanItem memblokir penghapusan jika segmen rencana telah direalisasikan', () => {
            expect(pageBebanKerjaJs).toMatch(/if\s*\(targetSeg\s*&&\s*isPlanSegmentRealized\(targetSeg\)\)\s*\{\s*showToast\('Kegiatan rencana ini telah direalisasikan dan tidak dapat dihapus\.', 'warning'\);\s*return;\s*\}/);
        });
    });

    describe('3. Unit Test Fungsional Logika isPlanSegmentRealized', () => {
        // Ekstraksi logika simulasi untuk pengetesan unit fungsional langsung
        function mockIsPlanSegmentRealized(seg, weekData = {}) {
            if (!seg) return false;
            if (seg.has_realized_log !== undefined && Number(seg.has_realized_log) > 0) {
                return true;
            }
            const actId = seg.activity_id;
            if (actId) {
                const links = weekData.plan_links || weekData.plan_log_links || [];
                if (links.some(l => l.plan_activity_id === actId)) {
                    return true;
                }
                const logs = weekData.logs || [];
                if (logs.some(l => l.plan_activity_id === actId)) {
                    return true;
                }
            }
            if (seg.id) {
                const logs = weekData.logs || [];
                if (logs.some(l => l.plan_segment_id === seg.id)) {
                    return true;
                }
            }
            return false;
        }

        test('Mengembalikan true jika segmen memiliki has_realized_log > 0', () => {
            expect(mockIsPlanSegmentRealized({ id: 'seg-1', has_realized_log: 1 })).toBe(true);
            expect(mockIsPlanSegmentRealized({ id: 'seg-2', has_realized_log: '2' })).toBe(true);
        });

        test('Mengembalikan false jika has_realized_log bernilai 0 dan tidak ada link', () => {
            expect(mockIsPlanSegmentRealized({ id: 'seg-3', has_realized_log: 0 })).toBe(false);
            expect(mockIsPlanSegmentRealized({ id: 'seg-4', has_realized_log: '0' })).toBe(false);
        });

        test('Mengembalikan true jika terdapat relasi di plan_links', () => {
            const weekData = {
                plan_links: [{ plan_activity_id: 'act-101', work_log_id: 'log-501' }]
            };
            expect(mockIsPlanSegmentRealized({ id: 'seg-5', activity_id: 'act-101', has_realized_log: 0 }, weekData)).toBe(true);
            expect(mockIsPlanSegmentRealized({ id: 'seg-6', activity_id: 'act-102', has_realized_log: 0 }, weekData)).toBe(false);
        });

        test('Mengembalikan true jika terdapat relasi di logs', () => {
            const weekData = {
                logs: [{ id: 'log-701', plan_activity_id: 'act-202' }]
            };
            expect(mockIsPlanSegmentRealized({ id: 'seg-7', activity_id: 'act-202' }, weekData)).toBe(true);
            expect(mockIsPlanSegmentRealized({ id: 'seg-8', activity_id: 'act-999' }, weekData)).toBe(false);
        });

        test('Mengembalikan false jika parameter null atau kosong', () => {
            expect(mockIsPlanSegmentRealized(null)).toBe(false);
            expect(mockIsPlanSegmentRealized(undefined)).toBe(false);
        });
    });
});
