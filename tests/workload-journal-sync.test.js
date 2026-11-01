/**
 * tests/workload-journal-sync.test.js
 * ====================================================================
 * Test Suite: Otomatisasi Pengisian Realisasi KBM dari Jurnal Mengajar Guru
 * Memvalidasi:
 * 1. Logika pencocokan jurnal ke rencana KBM (matchPlanSegmentWithJournal)
 * 2. Pengabaian cerdas jika tidak ada rencana KBM yang cocok (zero false positives)
 * 3. Idempotensi ID terikat `wl_jurnal_${id}` & upsert handling
 * 4. Kaskade penghapusan saat entri jurnal dihapus (removeJournalFromWorkload)
 * 5. Integritas rute API POST /api/workload/sync-from-journal & trigger hook di worker.js
 * 6. Integritas integrasi frontend di js/cloudflare-client.js dan js/page-beban-kerja.js
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const { matchPlanSegmentWithJournal, canTriggerSilentJournalSync } = require('./workload-guru-utils.js');

describe('Suite Pengujian Sinkronisasi Realisasi KBM dari Jurnal Mengajar', () => {
    const root = path.resolve(__dirname, '..');
    const workerJs = fs.readFileSync(path.join(root, 'cloudflare', 'worker.js'), 'utf8');
    const clientJs = fs.readFileSync(path.join(root, 'js', 'cloudflare-client.js'), 'utf8');
    const pageBebanKerjaJs = fs.readFileSync(path.join(root, 'js', 'page-beban-kerja.js'), 'utf8');
    const eKinerjaHtml = fs.readFileSync(path.join(root, 'e-kinerja.html'), 'utf8');

    // 1. UJI LOGIKA PENCOCOKAN JURNAL KE RENCANA KBM
    describe('1. Logika Pencocokan Jurnal ke Rencana KBM (matchPlanSegmentWithJournal)', () => {
        const sampleSegments = [
            {
                activity_id: 'act_mat_x1',
                activity_title: 'KBM Matematika (X.1)',
                description: 'Tatap Muka KBM Matematika Kelas X.1 (JP 1–2)',
                date: '2026-09-28',
                start_time: '07:30',
                end_time: '09:00',
                planned_minutes: 90,
                is_teaching: 1,
                jp_count: 2,
                category_code: 'PELAKSANAAN_KBM'
            },
            {
                activity_id: 'act_mat_x2',
                activity_title: 'KBM Matematika (X.2)',
                description: 'Tatap Muka KBM Matematika Kelas X.2 (JP 4–5)',
                date: '2026-09-28',
                start_time: '10:00',
                end_time: '11:30',
                planned_minutes: 90,
                is_teaching: 1,
                jp_count: 2,
                category_code: 'PELAKSANAAN_KBM'
            },
            {
                activity_id: 'act_fis_xi1',
                activity_title: 'KBM Fisika (XI.1)',
                description: 'Tatap Muka KBM Fisika Kelas XI.1 (JP 7–8)',
                date: '2026-09-28',
                start_time: '13:00',
                end_time: '14:30',
                planned_minutes: 90,
                is_teaching: 1,
                jp_count: 2,
                category_code: 'PELAKSANAAN_KBM'
            }
        ];

        test('1.1. Jurnal kelas X.1 Mapel Matematika cocok presisi dengan rencana KBM Matematika (X.1)', () => {
            const journal = {
                id: 'jurnal_001',
                tanggal: '2026-09-28',
                kelas: 'X.1',
                mapel: 'Matematika',
                topik: 'Eksponen dan Logaritma',
                jp: [1, 2]
            };

            const matched = matchPlanSegmentWithJournal(sampleSegments, journal);
            expect(matched).not.toBeNull();
            expect(matched.segment.activity_id).toBe('act_mat_x1');
            expect(matched.score).toBeGreaterThanOrEqual(80);
        });

        test('1.2. Jurnal dengan format kelas variasi (X-1 atau X 1) tetap cocok secara toleran', () => {
            const journalWithDash = {
                id: 'jurnal_002',
                tanggal: '2026-09-28',
                kelas: 'X-1',
                mapel: 'Matematika',
                topik: 'Latihan Soal',
                jp: '1-2'
            };

            const matched = matchPlanSegmentWithJournal(sampleSegments, journalWithDash);
            expect(matched).not.toBeNull();
            expect(matched.segment.activity_id).toBe('act_mat_x1');
        });

        test('1.3. Jurnal kelas X.2 membedakan target dan memilih KBM Matematika (X.2)', () => {
            const journalX2 = {
                id: 'jurnal_003',
                tanggal: '2026-09-28',
                kelas: 'X.2',
                mapel: 'Matematika',
                topik: 'Barisan dan Deret',
                jp: [4, 5]
            };

            const matched = matchPlanSegmentWithJournal(sampleSegments, journalX2);
            expect(matched).not.toBeNull();
            expect(matched.segment.activity_id).toBe('act_mat_x2');
        });
    });

    // 2. UJI PENGABAIAN JIKA TIDAK ADA RENCANA KBM YANG COCOK
    describe('2. Pengabaian Cerdas Jika Tidak Ada Rencana KBM Cocok (Zero False Positives)', () => {
        const segments = [
            {
                activity_id: 'act_fis_xi1',
                activity_title: 'KBM Fisika (XI.1)',
                description: 'Tatap Muka KBM Fisika Kelas XI.1 (JP 1–2)',
                date: '2026-09-28',
                start_time: '07:30',
                end_time: '09:00',
                planned_minutes: 90,
                is_teaching: 1,
                jp_count: 2,
                category_code: 'PELAKSANAAN_KBM'
            },
            {
                activity_id: 'act_rapat',
                activity_title: 'Rapat Koordinasi Guru',
                description: 'Rapat Dinas Kurikulum',
                date: '2026-09-28',
                start_time: '13:00',
                end_time: '14:30',
                planned_minutes: 90,
                is_teaching: 0,
                jp_count: 0,
                category_code: 'TUGAS_TAMBAHAN'
            }
        ];

        test('2.1. Jurnal mata pelajaran berbeda (misal Matematika vs Fisika) diabaikan', () => {
            const journalUnmatchedMapel = {
                id: 'jurnal_unmatched',
                tanggal: '2026-09-28',
                kelas: 'XI.1',
                mapel: 'Matematika',
                topik: 'Integral',
                jp: [1, 2]
            };

            const matched = matchPlanSegmentWithJournal(segments, journalUnmatchedMapel);
            expect(matched).toBeNull();
        });

        test('2.2. Jurnal dengan daftar segmen kosong diabaikan tanpa melempar error', () => {
            const journal = {
                id: 'jurnal_empty',
                tanggal: '2026-09-28',
                kelas: 'X.1',
                mapel: 'Kimia'
            };

            const matched = matchPlanSegmentWithJournal([], journal);
            expect(matched).toBeNull();
        });
    });

    // 3. UJI IDEMPOTENSI ID wl_jurnal_${id}
    describe('3. Idempotensi ID Terikat wl_jurnal_${id}', () => {
        test('3.1. Format ID log realisasi selalu berawalan wl_jurnal_ diikuti ID jurnal unik', () => {
            const journalId = '2026_09-1727334455';
            const logId = `wl_jurnal_${journalId}`;
            expect(logId).toBe('wl_jurnal_2026_09-1727334455');
            expect(logId.startsWith('wl_jurnal_')).toBe(true);
        });

        test('3.2. Worker menerapkan ON CONFLICT(id) DO UPDATE untuk menjamin idempotensi', () => {
            expect(workerJs).toContain('const logId = `wl_jurnal_${journalRow.id}`;');
            expect(workerJs).toContain('ON CONFLICT(id) DO UPDATE SET');
            expect(workerJs).toContain('ON CONFLICT(plan_activity_id, work_log_id) DO UPDATE SET');
        });
    });

    // 4. UJI KASKADE PENGHAPUSAN
    describe('4. Kaskade Penghapusan (removeJournalFromWorkload)', () => {
        test('4.1. Helper removeJournalFromWorkload menghapus plan_log_links, work_log_segments, dan work_logs', () => {
            expect(workerJs).toContain('async function removeJournalFromWorkload(');
            expect(workerJs).toContain('DELETE FROM plan_log_links WHERE work_log_id = ?');
            expect(workerJs).toContain('DELETE FROM work_log_segments WHERE work_log_id = ?');
            expect(workerJs).toContain('DELETE FROM work_logs WHERE id = ?');
        });

        test('4.2. Endpoint DELETE /api/jurnal memanggil removeJournalFromWorkload saat entri jurnal dihapus', () => {
            expect(workerJs).toContain('await removeJournalFromWorkload(env.DB, idsToDelete);');
        });
    });

    // 5. UJI INTEGRITAS ENDPOINT & HOOK BACKEND
    describe('5. Integritas Endpoint dan Hook Backend di worker.js', () => {
        test('5.1. POST /api/jurnal memanggil syncJournalToWorkload pasca simpan sukses', () => {
            expect(workerJs).toContain('await syncJournalToWorkload(env.DB, savedJournal, authCheck.user);');
        });

        test('5.2. PUT /api/jurnal memanggil syncJournalToWorkload pasca update sukses', () => {
            expect(workerJs).toContain('await syncJournalToWorkload(env.DB, updatedJournal, authCheck.user);');
        });

        test('5.3. Rute POST /api/workload/sync-from-journal terdaftar dan mendukung filter date & work_week_id', () => {
            expect(workerJs).toContain('path === "/api/workload/sync-from-journal" && method === "POST"');
            expect(workerJs).toContain('SELECT * FROM jurnal_guru WHERE 1=1');
            expect(workerJs).toContain('await syncJournalToWorkload(env.DB, jRow, authResult.user);');
            expect(workerJs).toContain('syncedCount');
            expect(workerJs).toContain('ignoredCount');
        });

        test('5.4. Validasi otorisasi OWASP ASVS: Guru dilarang menyinkronkan beban guru lain (403) & isolasi data terjaga', () => {
            expect(workerJs).toContain('if (!isMgr && teacher_id && teacher_id !== userTeacherId)');
            expect(workerJs).toContain('Akses ditolak: Anda hanya dapat menyinkronkan beban kerja Anda sendiri');
            expect(workerJs).toContain('if (!isMgr && weekRow.teacher_id !== userTeacherId)');
            expect(workerJs).toContain('Akses ditolak: Anda tidak memiliki akses ke minggu kerja ini');
        });

        test('5.5. Proteksi integritas audit: Log kegiatan yang terkunci tidak dapat ditimpa oleh sinkronisasi', () => {
            expect(workerJs).toContain('existingLog.is_locked === 1');
            expect(workerJs).toContain('Laporan realisasi telah dikunci oleh pimpinan');
        });

        test('5.6. SSOT teacher_id: Mengutamakan guru pengajar dari jurnal dan mencegah kebocoran identitas pimpinan', () => {
            expect(workerJs).toContain('Tentukan teacher_id dari data jurnal (SSOT: guru pengajar KBM)');
            expect(workerJs).toContain('!isMgr || finalTeacherId === userTeacherId');
        });

        test('5.7. Helper syncWorkWeekJournals menerapkan Bulk Pre-fetching dan D1 Atomic Batching anti-timeout', () => {
            expect(workerJs).toContain('async function syncWorkWeekJournals(db, workWeekId, actorUser = null)');
            expect(workerJs).toContain('SELECT * FROM work_weeks WHERE id = ?');
            expect(workerJs).toContain('SELECT * FROM jurnal_guru WHERE tanggal >= ? AND tanggal <= ?');
            expect(workerJs).toContain('await db.batch(batchStatements);');
            expect(workerJs).toContain('SYNC_WEEK_JOURNALS_BULK');
        });

        test('5.8. Hook persetujuan Kepala Sekolah (APPROVE_PLAN) otomatis memicu syncWorkWeekJournals', () => {
            expect(workerJs).toContain('APPROVE_PLAN');
            expect(workerJs).toContain('await syncWorkWeekJournals(env.DB, work_week_id, authResult.user);');
        });

        test('5.9. Hook finalisasi otomatis Mode Mandiri (AUTO_APPROVE_PLAN) otomatis memicu syncWorkWeekJournals', () => {
            expect(workerJs).toContain('AUTO_APPROVE_PLAN');
            expect(workerJs).toContain('// Otomatis sinkronkan jurnal mengajar yang sudah terisi di minggu ini (Mode Mandiri)');
            expect(workerJs).toContain('await syncWorkWeekJournals(env.DB, work_week_id, authResult.user);');
        });

        test('5.10. Proteksi No-Op & Anti Thundering-Herd: syncJournalToWorkload mendeteksi entri mutakhir dan lewati write D1', () => {
            expect(workerJs).toContain('already_synced: true');
            expect(workerJs).toContain('0 D1 write');
            expect(workerJs).toContain('existingLog.output_summary === outputSummary');
            expect(workerJs).toContain('SELECT 1 FROM plan_log_links WHERE work_log_id = ? AND plan_activity_id = ? LIMIT 1');
        });
    });

    // 6. UJI INTEGRASI FRONTEND (cloudflare-client.js & page-beban-kerja.js)
    describe('6. Integritas Integrasi Frontend', () => {
        test('6.1. js/cloudflare-client.js mengekspor cfSyncWorkloadFromJournal dan mendaftarkan ke window', () => {
            expect(clientJs).toContain('export async function cfSyncWorkloadFromJournal(payload = {})');
            expect(clientJs).toContain("cfFetch('/api/workload/sync-from-journal'");
            expect(clientJs).toContain('window.cfSyncWorkloadFromJournal = cfSyncWorkloadFromJournal;');
        });

        test('6.2. js/page-beban-kerja.js mengimpor cfSyncWorkloadFromJournal', () => {
            expect(pageBebanKerjaJs).toContain('cfSyncWorkloadFromJournal');
        });

        test('6.3. Focus View menampilkan status realisasi KBM terhubung otomatis (0 input manual) tanpa tombol manual', () => {
            expect(pageBebanKerjaJs).toContain('Realisasi KBM terhubung otomatis dengan Jurnal Mengajar di kelas (0 input manual)');
            expect(pageBebanKerjaJs).not.toContain('<button type="button" onclick="window.workloadSyncFromJournal()"');
            expect(pageBebanKerjaJs).toContain('📘 Dari Jurnal KBM');
            expect(pageBebanKerjaJs).toContain("startsWith('wl_jurnal_')");
        });

        test('6.4. initWorkloadPage() mendaftarkan window.workloadSyncFromJournal untuk backward compatibility', () => {
            expect(pageBebanKerjaJs).toContain('window.workloadSyncFromJournal = syncFromJournal;');
        });

        test('6.5. e-kinerja.html telah bersih dari tombol manual Sinkron dari Jurnal', () => {
            expect(eKinerjaHtml).not.toContain('window.workloadSyncFromJournal()');
            expect(eKinerjaHtml).not.toContain('title="Sinkron dari Jurnal Mengajar"');
        });

        test('6.6. js/page-beban-kerja.js telah bersih dari tombol manual sinkron jurnal di seluruh kartu KBM', () => {
            expect(pageBebanKerjaJs).not.toContain('onclick="event.stopPropagation(); window.workloadSyncFromJournal()"');
            expect(pageBebanKerjaJs).not.toContain('<span>Sinkron Jurnal</span>');
        });

        test('6.7. Jalur C (Auto-Sync Senyap) mematuhi batas waktu minimal pukul 15:00 WITA dan kuota harian 1x via localStorage', () => {
            expect(pageBebanKerjaJs).toContain('export function canTriggerSilentJournalSync(');
            expect(pageBebanKerjaJs).toContain('currentMins < 15 * 60');
            expect(pageBebanKerjaJs).toContain('simas_wl_journal_autosync_');
            expect(pageBebanKerjaJs).toContain('window.workloadCanTriggerSilentJournalSync = canTriggerSilentJournalSync;');

            const storageMap = new Map();
            const mockStorage = {
                getItem: (k) => storageMap.get(k) || null,
                setItem: (k, v) => storageMap.set(k, String(v))
            };

            // 1. Sebelum pukul 15:00 WITA (misal 09:30 WITA = 570 menit) -> Ditolak
            const resMorning = canTriggerSilentJournalSync('2026-10-10', 570, '2026-10-10', 'teacher_01', mockStorage);
            expect(resMorning.allowed).toBe(false);
            expect(resMorning.reason).toContain('15:00 WITA');

            // 2. Tepat sebelum pukul 15:00 WITA (14:59 WITA = 899 menit) -> Ditolak
            const resBefore = canTriggerSilentJournalSync('2026-10-10', 899, '2026-10-10', 'teacher_01', mockStorage);
            expect(resBefore.allowed).toBe(false);

            // 3. Pukul 15:00 WITA (900 menit) pertama kali -> Diizinkan
            const resAfternoon = canTriggerSilentJournalSync('2026-10-10', 900, '2026-10-10', 'teacher_01', mockStorage);
            expect(resAfternoon.allowed).toBe(true);
            expect(resAfternoon.storageKey).toBe('simas_wl_journal_autosync_teacher_01_2026-10-10');

            // Simulasikan penandaan localStorage berhasil
            mockStorage.setItem(resAfternoon.storageKey, '1');

            // 4. Panggilan kedua di hari yang sama (misal 15:30 WITA = 930 menit) -> Ditolak karena sudah disinkronkan hari ini
            const resSecond = canTriggerSilentJournalSync('2026-10-10', 930, '2026-10-10', 'teacher_01', mockStorage);
            expect(resSecond.allowed).toBe(false);
            expect(resSecond.reason).toContain('Sudah disinkronkan hari ini');

            // 5. Berganti ke hari baru (2026-10-11 pukul 15:15 WITA) -> Diizinkan kembali
            const resNextDay = canTriggerSilentJournalSync('2026-10-11', 915, '2026-10-11', 'teacher_01', mockStorage);
            expect(resNextDay.allowed).toBe(true);
        });

        test('6.8. Smart Staggering Jitter: Auto-sync senyap menyebarkan jeda acak 1.5s s.d 8.5s untuk meratakan lonjakan jam 15:00', () => {
            expect(pageBebanKerjaJs).toContain('const jitterMs = 1500 + Math.floor(Math.random() * 7000);');
            expect(pageBebanKerjaJs).toContain('setTimeout(() => triggerSilentJournalSync(dayDate), jitterMs);');
        });
    });
});
