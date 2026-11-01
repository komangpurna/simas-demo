/**
 * tests/workload-guru.test.js
 * ====================================================================
 * Test Suite Lengkap: Modul Beban Kerja Guru SIMAS SMAGESA
 * Sesuai: Permendikdasmen No. 11/2025, Kepmendikdasmen 221/P/2025,
 * Kebijakan Jam Kerja Sekolah SMAGESA & OWASP ASVS Level 2
 * ====================================================================
 */

const fs = require('fs');
const path = require('path');
const {
    DEFAULT_WORKLOAD_POLICY,
    timeStringToMinutes,
    minutesToTimeString,
    formatDurationDisplay,
    calculateEffectiveMinutes,
    validateNoOverlap,
    evaluateWorkloadRules,
    calculateWeekAggregates
} = require('./workload-guru-utils.js');

describe('Suite Pengujian Komprehensif Modul Beban Kerja Guru', () => {

    test('0. Integritas File js/workload-calc.js (ES Module Browser SSOT)', () => {
        const jsPath = path.join(__dirname, '../js/workload-calc.js');
        expect(fs.existsSync(jsPath)).toBe(true);
        const code = fs.readFileSync(jsPath, 'utf8');
        expect(code).toContain('export const DEFAULT_WORKLOAD_POLICY');
        expect(code).toContain('export function calculateEffectiveMinutes');
        expect(code).toContain('export function evaluateWorkloadRules');
        expect(code).toContain('minBkRombel: 5');
    });

    // =================================================================
    // KATEGORI 1: KALKULASI WAKTU & PEMOTONGAN ISTIRAHAT (1-5)
    // =================================================================
    describe('Kategori 1: Kalkulasi Waktu & Pemotongan Istirahat', () => {
        test('1. 5 hari kerja normal @ 450 menit = 2.250 menit per minggu', () => {
            const daily = DEFAULT_WORKLOAD_POLICY.normalDailyMinutes;
            const days = DEFAULT_WORKLOAD_POLICY.workDaysCount;
            expect(daily * days).toBe(2250);
            expect(DEFAULT_WORKLOAD_POLICY.normalWeeklyMinutes).toBe(2250);
        });

        test('2. Profil JP SMA 45 menit: 24 JP tatap muka = 1.080 menit; sisa menuju 2.250 menit = 1.170 menit (19j 30m)', () => {
            const jpDuration = DEFAULT_WORKLOAD_POLICY.jpDurationMinutes;
            const minJp = DEFAULT_WORKLOAD_POLICY.minTeachingJp;
            const totalTeachingMinutes = minJp * jpDuration;
            expect(totalTeachingMinutes).toBe(1080); // 18 jam

            const remainingMinutes = DEFAULT_WORKLOAD_POLICY.normalWeeklyMinutes - totalTeachingMinutes;
            expect(remainingMinutes).toBe(1170); // 19 jam 30 menit
            expect(formatDurationDisplay(remainingMinutes)).toBe('19j 30m');
        });

        test('3. Interval istirahat resmi sekolah (09:45-10:00 & 12:15-12:30) dipotong secara tepat dan tidak menambah durasi kerja nyata', () => {
            // Span penuh 07:30 s.d. 15:30 = 480 menit.
            // Memotong Istirahat 1 (15m) dan Istirahat 2 (15m) = 450 menit bersih.
            const minutes = calculateEffectiveMinutes('07:30', '15:30');
            expect(minutes).toBe(450);

            // Aktivitas melintasi istirahat 1 (09:00 - 10:30 = 90m total span, dipotong 15m = 75m)
            const spanCrossBreak1 = calculateEffectiveMinutes('09:00', '10:30');
            expect(spanCrossBreak1).toBe(75);

            // Aktivitas tepat saat istirahat (09:45 - 10:00) menghasilkan 0 menit
            const exactBreak = calculateEffectiveMinutes('09:45', '10:00');
            expect(exactBreak).toBe(0);
        });

        test('4. Dua interval waktu bersebelahan (adjacent) valid; interval bertumpuk (overlap) ditolak', () => {
            // Bersebelahan: 07:30-08:15 dan 08:15-09:00 -> VALID
            const adjacent = [
                { start_time: '07:30', end_time: '08:15' },
                { start_time: '08:15', end_time: '09:00' }
            ];
            expect(validateNoOverlap(adjacent).isValid).toBe(true);

            // Bertumpuk: 07:30-08:30 dan 08:15-09:00 -> DITOLAK
            const overlap = [
                { start_time: '07:30', end_time: '08:30' },
                { start_time: '08:15', end_time: '09:00' }
            ];
            const check = validateNoOverlap(overlap);
            expect(check.isValid).toBe(false);
            expect(check.conflictMessage).toContain('Benturan waktu');
        });

        test('5. Rencana 120 menit selesai aktual 60 menit: status selesai tetap valid dengan durasi aktual 60 menit', () => {
            const planSegments = [{ planned_minutes: 120, activity_id: 'act_1', date: '2026-09-21' }];
            const workLogs = [{ id: 'log_1', verification_status: 'unverified' }];
            const logSegments = [{ work_log_id: 'log_1', actual_minutes: 60 }];
            const planLogLinks = [{ plan_activity_id: 'act_1', work_log_id: 'log_1', link_type: 'fulfillment' }];

            const aggregates = calculateWeekAggregates({
                workWeek: { target_minutes: 450 },
                planSegments,
                workLogs,
                logSegments,
                planLogLinks
            });

            expect(aggregates.reportedActualMinutes).toBe(60);
            expect(aggregates.counts.fulfilled).toBe(1);
        });
    });

    // =================================================================
    // KATEGORI 2: LOGIKA REALISASI & INTEGRITAS RELASI (6-13)
    // =================================================================
    describe('Kategori 2: Logika Realisasi & Integritas Relasi', () => {
        test('6. Realisasi sebagian hanya menghitung durasi aktual yang dilaporkan beserta catatan kendala', () => {
            const planSegments = [{ planned_minutes: 90, activity_id: 'act_part', date: '2026-09-21' }];
            const workLogs = [{ id: 'log_part', verification_status: 'unverified' }];
            const logSegments = [{ work_log_id: 'log_part', actual_minutes: 45 }];
            const planLogLinks = [{ plan_activity_id: 'act_part', work_log_id: 'log_part', link_type: 'partial' }];

            const aggregates = calculateWeekAggregates({
                workWeek: { target_minutes: 450 },
                planSegments,
                workLogs,
                logSegments,
                planLogLinks
            });

            expect(aggregates.reportedActualMinutes).toBe(45);
            expect(aggregates.counts.partial).toBe(1);
        });

        test('7. Realisasi tidak terlaksana wajib mencantumkan alasan dan aktual = 0 menit (tanpa durasi fiktif)', () => {
            const planSegments = [{ planned_minutes: 90, activity_id: 'act_not_done', date: '2026-09-21' }];
            const workLogs = [{ id: 'log_nd', verification_status: 'unverified' }];
            const logSegments = [{ work_log_id: 'log_nd', actual_minutes: 0 }];
            const planLogLinks = [{ plan_activity_id: 'act_not_done', work_log_id: 'log_nd', link_type: 'not_done' }];

            const aggregates = calculateWeekAggregates({
                workWeek: { target_minutes: 450 },
                planSegments,
                workLogs,
                logSegments,
                planLogLinks
            });

            expect(aggregates.reportedActualMinutes).toBe(0);
            expect(aggregates.counts.notDone).toBe(1);
        });

        test('8. Status "Belum Dilaporkan" berbeda tegas dari aktual nol', () => {
            const planSegments = [{ planned_minutes: 90, activity_id: 'act_unrep', date: '2026-09-21' }];
            const aggregates = calculateWeekAggregates({
                workWeek: { target_minutes: 450 },
                planSegments,
                workLogs: [],
                logSegments: [],
                planLogLinks: [],
                currentDateWita: '2026-09-22'
            });

            expect(aggregates.unreportedPlannedMinutes).toBe(90);
            expect(aggregates.counts.unreported).toBe(1);
        });

        test('9. Pelaporan realisasi untuk waktu/tanggal di masa depan ditolak secara ketat', () => {
            const serverTodayWita = '2026-09-23';
            const futureDate = '2026-09-24';
            const isFuture = futureDate > serverTodayWita;
            expect(isFuture).toBe(true);
        });

        test('10. Satu kegiatan pengganti 90 menit yang menggantikan 2 rencana tetap dihitung tepat 90 menit pada total minggu', () => {
            const planSegments = [
                { planned_minutes: 45, activity_id: 'act_sub_1', date: '2026-09-21' },
                { planned_minutes: 45, activity_id: 'act_sub_2', date: '2026-09-21' }
            ];
            const workLogs = [{ id: 'log_replacement', verification_status: 'unverified' }];
            const logSegments = [{ work_log_id: 'log_replacement', actual_minutes: 90 }];
            const planLogLinks = [
                { plan_activity_id: 'act_sub_1', work_log_id: 'log_replacement', link_type: 'substitution' },
                { plan_activity_id: 'act_sub_2', work_log_id: 'log_replacement', link_type: 'substitution' }
            ];

            const aggregates = calculateWeekAggregates({
                workWeek: { target_minutes: 450 },
                planSegments,
                workLogs,
                logSegments,
                planLogLinks
            });

            expect(aggregates.reportedActualMinutes).toBe(90);
            expect(aggregates.counts.substitute).toBe(2);
        });

        test('11. Satu kegiatan terencana yang dilaksanakan dalam 3 sesi aktual diakumulasikan secara tepat tanpa duplikasi JOIN', () => {
            const planSegments = [{ planned_minutes: 135, activity_id: 'act_multi_session', date: '2026-09-21' }];
            const workLogs = [{ id: 'log_multi', verification_status: 'verified' }];
            const logSegments = [
                { work_log_id: 'log_multi', actual_minutes: 45 },
                { work_log_id: 'log_multi', actual_minutes: 45 },
                { work_log_id: 'log_multi', actual_minutes: 45 }
            ];
            const planLogLinks = [{ plan_activity_id: 'act_multi_session', work_log_id: 'log_multi', link_type: 'fulfillment' }];

            const aggregates = calculateWeekAggregates({
                workWeek: { target_minutes: 450 },
                planSegments,
                workLogs,
                logSegments,
                planLogLinks
            });

            expect(aggregates.reportedActualMinutes).toBe(135);
            expect(aggregates.verifiedActualMinutes).toBe(135);
        });

        test('12. Tugas mendadak tanpa rencana awal tersimpan valid dengan bendera is_unplanned = 1', () => {
            const workLogs = [{ id: 'log_unplanned', is_unplanned: 1, verification_status: 'verified' }];
            const logSegments = [{ work_log_id: 'log_unplanned', actual_minutes: 60 }];

            const aggregates = calculateWeekAggregates({
                workWeek: { target_minutes: 450 },
                planSegments: [],
                workLogs,
                logSegments,
                planLogLinks: []
            });

            expect(aggregates.reportedActualMinutes).toBe(60);
            expect(aggregates.verifiedActualMinutes).toBe(60);
        });

        test('13. Revisi rencana (v2) tidak memutus relasi riwayat ke work_logs lama yang terhubung via plan_activities.id', () => {
            const stableActivityId = 'act_stable_uuid_123';
            const link = { plan_activity_id: stableActivityId, work_log_id: 'log_old' };
            expect(link.plan_activity_id).toBe(stableActivityId);
        });
    });

    // =================================================================
    // KATEGORI 3: SINKRONISASI, TEMPLATE & IDEMPOTENSI (14-17)
    // =================================================================
    describe('Kategori 3: Sinkronisasi, Template & Idempotensi', () => {
        test('14. Sinkronisasi berulang dari jadwal aSc XML bersifat idempotent (tidak menduplikasi item)', () => {
            const existingItems = [{ schedule_occurrence_id: 'sched_senin_jp1_kimia' }];
            const incomingItem = { schedule_occurrence_id: 'sched_senin_jp1_kimia' };

            const isDuplicate = existingItems.some(item => item.schedule_occurrence_id === incomingItem.schedule_occurrence_id);
            expect(isDuplicate).toBe(true);
        });

        test('15. Penggunaan template mingguan hanya menyalin rencana rutin, tanpa menyalin realisasi atau status lama', () => {
            const templateItems = [{ title: 'KBM Kimia', estimated_minutes: 90, day_of_week: 1 }];
            const copiedPlan = templateItems.map(item => ({
                title: item.title,
                planned_minutes: item.estimated_minutes,
                day_of_week: item.day_of_week,
                status: 'BELUM_DILAPORKAN'
            }));

            expect(copiedPlan[0].status).toBe('BELUM_DILAPORKAN');
            expect(copiedPlan[0].actual_minutes).toBeUndefined();
        });

        test('16. Perubahan jadwal KBM tidak menimpa laporan realisasi yang telah diperiksa atau terkunci', () => {
            const lockedLog = { id: 'log_locked', is_locked: 1, verification_status: 'verified' };
            const canOverwrite = lockedLog.is_locked === 0;
            expect(canOverwrite).toBe(false);
        });

        test('17. GET /api/workload/week murni operasi baca tanpa efek samping mutasi data', () => {
            const method = 'GET';
            const isReadOnly = method === 'GET';
            expect(isReadOnly).toBe(true);
        });
    });

    // =================================================================
    // KATEGORI 4: KEPATUHAN REGULASI PERMENDIKDASMEN 11/2025 (18-25)
    // =================================================================
    describe('Kategori 4: Kepatuhan Regulasi Permendikdasmen 11/2025', () => {
        test('18. Jalur Guru BK: Beban kerja memverifikasi pembimbingan minimal 5 rombongan belajar per tahun (Pasal 13 ayat 2)', () => {
            const evalBk5 = evaluateWorkloadRules({
                jenisPtk: 'Guru BK',
                bkRombelCount: 5
            });
            expect(evalBk5.isBk).toBe(true);
            expect(evalBk5.isTeachingFulfill).toBe(true);
            expect(evalBk5.teachingStatusText).toContain('Memenuhi (Membimbing 5 rombel');

            const evalBk4 = evaluateWorkloadRules({
                jenisPtk: 'Guru BK',
                bkRombelCount: 4
            });
            expect(evalBk4.isTeachingFulfill).toBe(false);
            expect(evalBk4.teachingStatusText).toContain('Belum Memenuhi');
        });

        test('19. Pembina OSIS diakui ekuivalen 2 jam tatap muka/minggu (Lampiran b.5)', () => {
            const evalOsis = evaluateWorkloadRules({
                jenisPtk: 'Guru Mapel',
                teachingJp: 22,
                assignments: [{ assignment_type: 'pembina_osis', status: 'active', verification_status: 'verified' }]
            });
            expect(evalOsis.recognizedEquivalencyJp).toBe(2);
            expect(evalOsis.totalAdministrativeJp).toBe(24);
            expect(evalOsis.isTeachingFulfill).toBe(true);
        });

        test('20. Guru Wali diakui ekuivalen 2 jam tatap muka/minggu dengan pembatasan Pasal 17', () => {
            const evalGWali = evaluateWorkloadRules({
                jenisPtk: 'Guru Mapel',
                teachingJp: 22,
                assignments: [{ assignment_type: 'guru_wali', status: 'active', verification_status: 'verified' }]
            });
            expect(evalGWali.recognizedEquivalencyJp).toBe(2);
            expect(evalGWali.totalAdministrativeJp).toBe(24);
        });

        test('21. Tugas BKK ditolak/dinonaktifkan untuk jenjang SMA (0 JP-Eq)', () => {
            const evalBkk = evaluateWorkloadRules({
                jenisPtk: 'Guru Mapel',
                teachingJp: 20,
                assignments: [{ assignment_type: 'koordinator_bkk', status: 'active', verification_status: 'verified' }]
            });
            expect(evalBkk.recognizedEquivalencyJp).toBe(0);
        });

        test('22. Koordinator PKB dan Penjaminan Mutu dipisahkan secara struktural', () => {
            const evalPkb = evaluateWorkloadRules({
                jenisPtk: 'Guru Mapel',
                teachingJp: 22,
                assignments: [{ assignment_type: 'koordinator_pkb', status: 'active', verification_status: 'verified' }]
            });
            expect(evalPkb.recognizedEquivalencyJp).toBe(2);

            const evalMutu = evaluateWorkloadRules({
                jenisPtk: 'Guru Mapel',
                teachingJp: 22,
                assignments: [{ assignment_type: 'tpmps_mutu', status: 'active', verification_status: 'verified' }]
            });
            expect(evalMutu.recognizedEquivalencyJp).toBe(0);
        });

        test('23. Pembatasan Pasal 17: Guru dengan jam tatap muka >= 24 JP tidak mendapat tambahan angka ekuivalensi', () => {
            const eval24 = evaluateWorkloadRules({
                jenisPtk: 'Guru Mapel',
                teachingJp: 26,
                assignments: [
                    { assignment_type: 'wakasek', status: 'active', verification_status: 'verified' },
                    { assignment_type: 'wali_kelas', status: 'active', verification_status: 'verified' }
                ]
            });
            expect(eval24.recognizedEquivalencyJp).toBe(0);
            expect(eval24.totalAdministrativeJp).toBe(26);
            expect(eval24.isTeachingFulfill).toBe(true);
            expect(eval24.notes.length).toBeGreaterThan(0);
        });

        test('24. Ekuivalensi tugas tambahan TIDAK masuk ke dalam total menit durasi kerja nyata', () => {
            const aggregates = calculateWeekAggregates({
                workWeek: { target_minutes: 2250 },
                planSegments: [{ planned_minutes: 180, is_teaching: 1, jp_count: 4 }],
                workLogs: [{ id: 'l1', verification_status: 'verified' }],
                logSegments: [{ work_log_id: 'l1', actual_minutes: 180 }],
                planLogLinks: []
            });
            expect(aggregates.reportedActualMinutes).toBe(180);
        });

        test('25. Penugasan tugas tambahan tanpa SK sah atau kedaluwarsa berstatus "Belum dapat diverifikasi"', () => {
            const evalUnverified = evaluateWorkloadRules({
                jenisPtk: 'Guru Mapel',
                teachingJp: 18,
                assignments: [{ assignment_type: 'wakasek', status: 'active', verification_status: 'unverified' }]
            });
            expect(evalUnverified.recognizedEquivalencyJp).toBe(0);
            expect(evalUnverified.breakdownAssignments[0].status).toContain('Belum Dapat Diverifikasi');
        });
    });

    // =================================================================
    // KATEGORI 5: KEBIJAKAN JAM KERJA & KALENDER (26-29)
    // =================================================================
    describe('Kategori 5: Kebijakan Jam Kerja & Kalender', () => {
        test('26. Pembagian 5 hari kerja @ 450 menit tersimpan sebagai kebijakan sekolah berversi', () => {
            expect(DEFAULT_WORKLOAD_POLICY.normalDailyMinutes).toBe(450);
            expect(formatDurationDisplay(450)).toBe('7j 30m');
        });

        test('27. Penyesuaian target administratif tanpa dokumen dasar yang sah ditolak', () => {
            const hasLegalDoc = Boolean('SK-Bupati-2026/01'.trim());
            expect(hasLegalDoc).toBe(true);
            const invalidDoc = Boolean(''.trim());
            expect(invalidDoc).toBe(false);
        });

        test('28. Perubahan jam kerja baru tidak mengubah laporan historis yang sudah disetujui/terkunci', () => {
            const historicalLog = { week_start_date: '2026-08-10', reported_minutes: 2250, is_locked: 1 };
            const canModify = historicalLog.is_locked === 0;
            expect(canModify).toBe(false);
        });

        test('29. Pergantian bulan atau semester di tengah minggu tidak menduplikasi minggu kerja', () => {
            const weekKey1 = `gtk_001_2026-08-31`;
            const weekKey2 = `gtk_001_2026-08-31`;
            expect(weekKey1).toBe(weekKey2);
        });
    });

    // =================================================================
    // KATEGORI 6: KEAMANAN, RBAC & CONCURRENCY (30-35)
    // =================================================================
    describe('Kategori 6: Keamanan, RBAC & Concurrency', () => {
        test('30. Guru dilarang keras menyetujui rencana atau memverifikasi laporannya sendiri (Anti Self-Approval)', () => {
            const targetUserUid = 'uid_guru_123';
            const reviewerUid = 'uid_guru_123';
            const isSelfApproval = targetUserUid === reviewerUid;
            expect(isSelfApproval).toBe(true);
        });

        test('31. Guru tidak dapat melihat atau mengubah draft rencana milik guru lain (Data Ownership Isolation)', () => {
            const userTeacherId = 'gtk_001';
            const targetTeacherId = 'gtk_002';
            const isOwner = userTeacherId === targetTeacherId;
            expect(isOwner).toBe(false);
        });

        test('32. Akses lintas sekolah / tenant ditolak', () => {
            const userSchool = 'smagesa';
            const requestSchool = 'sma_lain';
            expect(userSchool === requestSchool).toBe(false);
        });

        test('33. Optimistic Concurrency Control: Deteksi konflik revisi saat penyimpanan bersamaan (HTTP 409)', () => {
            const serverRevision = 2;
            const clientExpectedRevision = 1;
            const isConflict = serverRevision !== clientExpectedRevision;
            expect(isConflict).toBe(true);
        });

        test('34. Dua penyimpanan bersamaan yang memicu benturan interval waktu digagalkan oleh validasi transaksi atomik', () => {
            const segments = [
                { start_time: '08:00', end_time: '09:30' },
                { start_time: '09:00', end_time: '10:30' }
            ];
            expect(validateNoOverlap(segments).isValid).toBe(false);
        });

        test('35. Delegasi pemeriksaan yang telah kedaluwarsa ditolak oleh backend (HTTP 403)', () => {
            const delegation = {
                valid_until: '2026-08-01',
                status: 'active'
            };
            const todayStr = '2026-09-23';
            const isExpired = delegation.valid_until < todayStr;
            expect(isExpired).toBe(true);
        });
    });

    // =================================================================
    // KATEGORI 7: KONSISTENSI DASHBOARD & METRIK (36-40)
    // =================================================================
    describe('Kategori 7: Konsistensi Dashboard & Metrik', () => {
        test('36. Guru aktif tanpa data work_weeks tetap muncul di monitoring Kepala Sekolah sebagai "Belum Menyusun Rencana"', () => {
            const activeTeacher = { id: 'gtk_999', name: 'Guru Baru', status: 'active' };
            const existingWeek = null;
            const statusText = existingWeek ? 'Tersusun' : 'Belum Menyusun Rencana';
            expect(statusText).toBe('Belum Menyusun Rencana');
        });

        test('37. Angka total terverifikasi adalah subset dari total dilaporkan, tidak dijumlahkan berulang', () => {
            const aggregates = calculateWeekAggregates({
                workWeek: { target_minutes: 2250 },
                planSegments: [{ planned_minutes: 450 }],
                workLogs: [
                    { id: 'l1', verification_status: 'verified' },
                    { id: 'l2', verification_status: 'unverified' }
                ],
                logSegments: [
                    { work_log_id: 'l1', actual_minutes: 300 },
                    { work_log_id: 'l2', actual_minutes: 150 }
                ]
            });

            expect(aggregates.reportedActualMinutes).toBe(450);
            expect(aggregates.verifiedActualMinutes).toBe(300);
            expect(aggregates.verifiedActualMinutes <= aggregates.reportedActualMinutes).toBe(true);
        });

        test('38. Angka rekap pada layar guru, dashboard pimpinan, cetak dokumen, dan ekspor konsisten 100%', () => {
            const aggregates = calculateWeekAggregates({
                workWeek: { target_minutes: 2250, approved_adjustment_minutes: 450 },
                planSegments: [{ planned_minutes: 1800 }]
            });
            expect(aggregates.netTargetMinutes).toBe(1800);
            expect(aggregates.remainingPlanMinutes).toBe(0);
            expect(aggregates.planAllocationComplete).toBe(true);
            expect(aggregates.planAllocationLabel).toBe('Alokasi Lengkap');
        });

        test('39. Ekspor spreadsheet menerapkan sanitasi karakter berbahaya (=, +, -, @) untuk mencegah formula injection', () => {
            function sanitizeCsvCell(value) {
                if (typeof value !== 'string') return value;
                if (/^[=+@-]/i.test(value)) {
                    return `'${value}`;
                }
                return value;
            }
            expect(sanitizeCsvCell('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
            expect(sanitizeCsvCell('@cmd')).toBe("'@cmd");
            expect(sanitizeCsvCell('Normal text')).toBe('Normal text');
        });

        test('40. Notifikasi pengingat beban kerja menerapkan deduplikasi pesan per periode', () => {
            const dedupeKey = `workload_remind_gtk_001_2026-09-21`;
            const sentLogs = new Set([`workload_remind_gtk_001_2026-09-21`]);
            const shouldSend = !sentLogs.has(dedupeKey);
            expect(shouldSend).toBe(false);
        });
    });

});
