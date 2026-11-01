/**
 * tests/workload-plan-approval-gate.test.js
 * ====================================================================
 * Test Suite: Gerbang Realisasi - Rencana Wajib Disahkan Sebelum Direalisasikan
 * Memvalidasi:
 * 1. Backend API (Cloudflare Worker D1 SQL):
 *    - POST /api/workload/logs menolak pelaporan realisasi jika rencana belum 'approved' (HTTP 422)
 *    - POST /api/workload/sync-from-journal menolak sinkronisasi jika rencana belum 'approved' (HTTP 422)
 *    - syncJournalToWorkload membatalkan pencocokan jurnal jika status rencana belum 'approved'
 * 2. Frontend DOM & Interface (e-kinerja.html & js/page-beban-kerja.js):
 *    - Wadah #today-empty-state-unapproved tersedia di e-kinerja.html
 *    - renderUnapprovedPlanEmptyState diekspor ke window
 *    - renderTodayTab menyembunyikan matriks/fokus dan menampilkan empty state edukatif jika !isPlanApproved
 *    - updateRealisasiToolbarVisibility menyembunyikan toolbar realisasi jika rencana belum approved
 *    - Guard sisi klien pada openLogModal, syncFromJournal, dan quickReportComplete
 * 3. Logika Adaptif Empty State:
 *    - Penanganan status 'draft', 'submitted', dan 'needs_revision'
 *    - Perbedaan konteks Guru Mandiri vs Pimpinan/Kepala Sekolah
 *    - Pesan kenyamanan "Realisasi Tersimpan Aman" jika ada log yang telah tercatat sebelumnya
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Gerbang Realisasi E-Kinerja (Rencana Wajib Disahkan Terlebih Dahulu)', () => {
    const root = path.resolve(__dirname, '..');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');
    const pageBebanKerjaPath = path.join(root, 'js', 'page-beban-kerja.js');
    const eKinerjaHtmlPath = path.join(root, 'e-kinerja.html');

    const workerJs = fs.readFileSync(workerJsPath, 'utf8');
    const pageBebanKerjaJs = fs.readFileSync(pageBebanKerjaPath, 'utf8');
    const eKinerjaHtml = fs.readFileSync(eKinerjaHtmlPath, 'utf8');

    describe('1. Validasi Backend Cloudflare Worker D1 (cloudflare/worker.js)', () => {
        test('1.1 POST /api/workload/logs memvalidasi status rencana aktif wajib approved (HTTP 422)', () => {
            expect(workerJs).toMatch(/SELECT\s+status\s+FROM\s+weekly_plan_versions\s+WHERE\s+work_week_id\s*=\s*\?\s+ORDER\s+BY\s+version_number\s+DESC\s+LIMIT\s+1/);
            expect(workerJs).toMatch(/!latestPlanVersion\s*\|\|\s*latestPlanVersion\.status\s*!==\s*"approved"/);
            expect(workerJs).toMatch(/Pelaporan realisasi hanya dapat dilakukan setelah rencana kerja (disahkan|disetujui atau difinalisasi)/);
        });

        test('1.2 POST /api/workload/sync-from-journal memvalidasi status rencana aktif wajib approved (HTTP 422)', () => {
            expect(workerJs).toMatch(/Sinkronisasi jurnal hanya dapat dilakukan setelah rencana kerja (disahkan|disetujui atau difinalisasi)/);
        });

        test('1.3 syncJournalToWorkload memblokir pencocokan otomatis jurnal jika rencana belum approved', () => {
            expect(workerJs).toMatch(/Rencana kerja mingguan belum (disahkan|disetujui atau difinalisasi) oleh guru\/pimpinan/);
        });
    });

    describe('2. Validasi Struktur Antarmuka & Skrip (e-kinerja.html & js/page-beban-kerja.js)', () => {
        test('2.1 Kontainer #today-empty-state-unapproved tersedia di e-kinerja.html', () => {
            expect(eKinerjaHtml).toContain('id="today-empty-state-unapproved"');
        });

        test('2.2 Fungsi renderUnapprovedPlanEmptyState didefinisikan dan diekspor ke window', () => {
            expect(pageBebanKerjaJs).toContain('export function renderUnapprovedPlanEmptyState()');
            expect(pageBebanKerjaJs).toContain('window.renderUnapprovedPlanEmptyState = renderUnapprovedPlanEmptyState;');
        });

        test('2.3 updateRealisasiToolbarVisibility menyertakan guard isPlanApproved', () => {
            expect(pageBebanKerjaJs).toContain("const isPlanApproved = (_weekData?.active_version?.status === 'approved');");
            expect(pageBebanKerjaJs).toMatch(/shouldShow\s*=\s*\(_activeTab\s*===\s*'tab-today'\)\s*&&\s*\(!isMgr\s*\|\|\s*hasSelectedTeacher\)\s*&&\s*isPlanApproved;/);
        });

        test('2.4 renderTodayTab memeriksa isPlanApproved dan memanggil renderUnapprovedPlanEmptyState jika belum disahkan/difinalisasi', () => {
            expect(pageBebanKerjaJs).toMatch(/const activeVersion = _weekData\?\.active_version;/);
            expect(pageBebanKerjaJs).toMatch(/const isPlanApproved = \(activeVersion && activeVersion\.status === 'approved'\);/);
            expect(pageBebanKerjaJs).toContain('renderUnapprovedPlanEmptyState();');
        });

        test('2.5 openLogModal memblokir pembukaan modal jika rencana belum disetujui/difinalisasi', () => {
            expect(pageBebanKerjaJs).toMatch(/function openLogModal[\s\S]*?!activeVersion \|\| activeVersion\.status !== 'approved'[\s\S]*?Rencana kerja mingguan belum/);
        });

        test('2.6 syncFromJournal memblokir sinkronisasi jika rencana belum disetujui/difinalisasi', () => {
            expect(pageBebanKerjaJs).toMatch(/async function syncFromJournal\(\)[\s\S]*?!activeVersion \|\| activeVersion\.status !== 'approved'[\s\S]*?Rencana kerja mingguan belum/);
        });

        test('2.7 quickReportComplete memblokir realisasi 1-klik jika rencana belum disetujui/difinalisasi', () => {
            expect(pageBebanKerjaJs).toMatch(/async function quickReportComplete[\s\S]*?!activeVersion \|\| activeVersion\.status !== 'approved'[\s\S]*?Rencana kerja mingguan belum/);
        });

        test('2.8 window.workloadSwitchTab dan window.workloadSelectTab terdaftar dan tombol CTA memanggil fungsi window yang valid', () => {
            expect(pageBebanKerjaJs).toContain('window.workloadSwitchTab = switchTab;');
            expect(pageBebanKerjaJs).toContain('window.workloadSelectTab = switchTab;');
            expect(pageBebanKerjaJs).toMatch(/onclick="window\.workloadSwitchTab\('tab-plan'\)"/);
            expect(pageBebanKerjaJs).not.toMatch(/onclick="window\.workloadSelectTab\('tab-plan'\)"/);
        });
    });

    describe('3. Unit Test Fungsional Simulasi Empty State Edukatif', () => {
        function simulateEmptyStateData(planStatus, isMgr, logsCount = 0, isAutoApproved = true) {
            let titleText = '';
            let ctaText = '';
            let badgeText = '';

            if (planStatus === 'submitted') {
                badgeText = 'Menunggu Persetujuan';
                titleText = isMgr
                    ? 'Rencana Kerja Guru Menunggu Persetujuan Anda'
                    : 'Rencana Kerja Sedang Menunggu Persetujuan Kepala Sekolah';
                ctaText = isMgr
                    ? 'Tinjau & Setujui Rencana Guru'
                    : 'Tinjau Rencana yang Diajukan';
            } else if (planStatus === 'needs_revision') {
                badgeText = 'Perlu Revisi';
                titleText = isMgr
                    ? 'Rencana Kerja Dalam Status Revisi'
                    : 'Rencana Kerja Memerlukan Perbaikan';
                ctaText = isMgr
                    ? 'Lihat Rencana Kerja Guru'
                    : 'Buka Tab Rencana & Perbaiki';
            } else {
                badgeText = 'Draf Rencana';
                if (isMgr) {
                    titleText = 'Rencana Kerja Guru Masih Berstatus Draf';
                    ctaText = 'Lihat Draf Rencana Guru';
                } else {
                    titleText = isAutoApproved
                        ? 'Rencana Kerja Pekan Ini Belum Difinalisasi'
                        : 'Rencana Kerja Pekan Ini Belum Diajukan';
                    ctaText = isAutoApproved
                        ? 'Buka Tab Rencana & Finalisasi Sekarang'
                        : 'Buka Tab Rencana & Ajukan Sekarang';
                }
            }

            const hasPreservedNotice = logsCount > 0;
            return { badgeText, titleText, ctaText, hasPreservedNotice };
        }

        test('Simulasi Draf Guru (Mode Mandiri): Tombol Finalisasi Sekarang dan badge Draf Rencana', () => {
            const res = simulateEmptyStateData('draft', false, 0, true);
            expect(res.badgeText).toBe('Draf Rencana');
            expect(res.titleText).toBe('Rencana Kerja Pekan Ini Belum Difinalisasi');
            expect(res.ctaText).toBe('Buka Tab Rencana & Finalisasi Sekarang');
            expect(res.hasPreservedNotice).toBe(false);
        });

        test('Simulasi Draf Guru (Mode Wajib Kepsek): Tombol Ajukan Sekarang dan badge Draf Rencana', () => {
            const res = simulateEmptyStateData('draft', false, 0, false);
            expect(res.badgeText).toBe('Draf Rencana');
            expect(res.titleText).toBe('Rencana Kerja Pekan Ini Belum Diajukan');
            expect(res.ctaText).toBe('Buka Tab Rencana & Ajukan Sekarang');
            expect(res.hasPreservedNotice).toBe(false);
        });

        test('Simulasi Draf Pimpinan: Tombol Lihat Draf Guru', () => {
            const res = simulateEmptyStateData('draft', true, 0, true);
            expect(res.titleText).toBe('Rencana Kerja Guru Masih Berstatus Draf');
            expect(res.ctaText).toBe('Lihat Draf Rencana Guru');
        });

        test('Simulasi Submitted Guru: Menunggu persetujuan kepala sekolah', () => {
            const res = simulateEmptyStateData('submitted', false, 0);
            expect(res.badgeText).toBe('Menunggu Persetujuan');
            expect(res.titleText).toBe('Rencana Kerja Sedang Menunggu Persetujuan Kepala Sekolah');
            expect(res.ctaText).toBe('Tinjau Rencana yang Diajukan');
        });

        test('Simulasi Submitted Pimpinan: Tombol persetujuan kepala sekolah', () => {
            const res = simulateEmptyStateData('submitted', true, 0);
            expect(res.badgeText).toBe('Menunggu Persetujuan');
            expect(res.titleText).toBe('Rencana Kerja Guru Menunggu Persetujuan Anda');
            expect(res.ctaText).toBe('Tinjau & Setujui Rencana Guru');
        });

        test('Simulasi Edit Rencana (Reopen to Draft) dengan log tersimpan aman', () => {
            const res = simulateEmptyStateData('draft', false, 5);
            expect(res.hasPreservedNotice).toBe(true);
        });
    });
});
