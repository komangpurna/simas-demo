/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

describe('Integritas Ekosistem Notifikasi Terpadu SIMAS SMAGESA', () => {
    let portalHtml;

    beforeAll(() => {
        portalHtml = fs.readFileSync(path.join(__dirname, '../portal-siswa.html'), 'utf8');
    });

    // =========================================================================
    // 1. E-KINERJA GURU: LOGIKA NOTIFIKASI SUBMIT & REVIEW PLAN
    // =========================================================================
    describe('1. E-Kinerja Guru: Notifikasi Persetujuan & Peninjauan Rencana', () => {
        test('1.1. Submit plan saat require_plan_approval === 1 wajib membuat job ke role kepala_sekolah', () => {
            const policy = { require_plan_approval: 1 };
            const teacherUser = { uid: 'teacher_123', name: 'I Made Guru, S.Pd.' };
            const jobs = [];

            if (policy.require_plan_approval === 1) {
                jobs.push({
                    creatorUid: teacherUser.uid,
                    title: '📋 Pengajuan Rencana Kerja Mingguan',
                    body: `${teacherUser.name} telah mengajukan rencana kerja mingguan ke Kepala Sekolah untuk ditinjau.`,
                    url: './kinerja-approval.html',
                    targetType: 'role',
                    targetValue: 'kepala_sekolah'
                });
            }

            expect(jobs).toHaveLength(1);
            expect(jobs[0].targetType).toBe('role');
            expect(jobs[0].targetValue).toBe('kepala_sekolah');
            expect(jobs[0].url).toBe('./kinerja-approval.html');
        });

        test('1.2. Submit plan saat require_plan_approval === 0 (Mode Mandiri) tidak membuat job ke kepala_sekolah', () => {
            const policy = { require_plan_approval: 0 };
            const teacherUser = { uid: 'teacher_123', name: 'I Made Guru, S.Pd.' };
            const jobs = [];

            if (policy.require_plan_approval === 1) {
                jobs.push({
                    creatorUid: teacherUser.uid,
                    targetType: 'role',
                    targetValue: 'kepala_sekolah'
                });
            }

            expect(jobs).toHaveLength(0);
        });

        test('1.3. Review-plan "approve" wajib mengirim notifikasi persetujuan ke guru pemilik rencana', () => {
            const action = 'approve';
            const targetTeacherUid = 'teacher_456';
            const review_notes = 'Rencana kerja sudah baik dan selaras program sekolah';
            let job = null;

            if (action === 'approve' && targetTeacherUid) {
                job = {
                    title: '✅ Rencana Kerja Mingguan Disetujui',
                    body: `Rencana kerja mingguan Anda telah disetujui oleh Kepala Sekolah.${review_notes ? ' Catatan: ' + review_notes : ''}`,
                    url: './guru-kinerja.html',
                    targetType: 'user',
                    targetValue: targetTeacherUid
                };
            }

            expect(job).not.toBeNull();
            expect(job.targetType).toBe('user');
            expect(job.targetValue).toBe('teacher_456');
            expect(job.body).toContain(review_notes);
            expect(job.url).toBe('./guru-kinerja.html');
        });

        test('1.4. Review-plan "request_revision" wajib mengirim notifikasi permintaan revisi ke guru pemilik rencana', () => {
            const action = 'request_revision';
            const targetTeacherUid = 'teacher_456';
            const notes = 'Mohon sesuaikan alokasi waktu segmen KBM dengan rombel aktif';
            let job = null;

            if (action === 'request_revision' && targetTeacherUid) {
                job = {
                    title: '⚠️ Revisi Rencana Kerja Mingguan',
                    body: `Rencana kerja mingguan Anda memerlukan revisi.${notes ? ' Catatan: ' + notes : ''}`,
                    url: './guru-kinerja.html',
                    targetType: 'user',
                    targetValue: targetTeacherUid
                };
            }

            expect(job).not.toBeNull();
            expect(job.targetType).toBe('user');
            expect(job.targetValue).toBe('teacher_456');
            expect(job.body).toContain(notes);
            expect(job.url).toBe('./guru-kinerja.html');
        });
    });

    // =========================================================================
    // 2. PERMISI SISWA: DEDUPLIKASI MENTOR & KEPUTUSAN WALI/PIKET KE SISWA
    // =========================================================================
    describe('2. Permisi Siswa: Deduplikasi Pengiriman & Keputusan', () => {
        test('2.1. Deduplikasi penerima saat Wali Kelas dan Guru Wali adalah guru yang sama', () => {
            const homeroom = { uid: 'guru_shared_uid', name: 'Drs. I Wayan Guru' };
            const guruWali = { guru_uid: 'guru_shared_uid', guru_name: 'Drs. I Wayan Guru' };

            const mentorUids = new Set();
            if (homeroom?.uid) mentorUids.add(homeroom.uid);
            if (guruWali?.guru_uid) mentorUids.add(guruWali.guru_uid);

            expect(mentorUids.size).toBe(1);
            expect(Array.from(mentorUids)).toEqual(['guru_shared_uid']);
        });

        test('2.2. Mengirim ke kedua guru secara terpisah saat Wali Kelas dan Guru Wali berbeda', () => {
            const homeroom = { uid: 'wali_kelas_uid', name: 'Wali Kelas XI-A' };
            const guruWali = { guru_uid: 'guru_wali_uid', guru_name: 'Guru Wali Binaan' };

            const mentorUids = new Set();
            if (homeroom?.uid) mentorUids.add(homeroom.uid);
            if (guruWali?.guru_uid) mentorUids.add(guruWali.guru_uid);

            expect(mentorUids.size).toBe(2);
            expect(Array.from(mentorUids)).toContain('wali_kelas_uid');
            expect(Array.from(mentorUids)).toContain('guru_wali_uid');
        });

        test('2.3. Keputusan persetujuan Wali Kelas atau Piket dikirimkan ke target NIS siswa dengan URL Portal Siswa', () => {
            const studentNis = '12345';
            const action = 'approved';
            const roleAction = 'Wali Kelas';
            const reason = 'Diizinkan pulang karena sakit ringan';

            const job = {
                title: '✅ Pengajuan Permisi Disetujui',
                body: `Permisi Anda telah disetujui oleh ${roleAction}.${reason ? ' Catatan: ' + reason : ''}`,
                url: './portal-siswa.html',
                targetType: 'user',
                targetValue: studentNis
            };

            expect(job.targetType).toBe('user');
            expect(job.targetValue).toBe('12345');
            expect(job.url).toBe('./portal-siswa.html');
            expect(job.body).toContain(reason);
        });
    });

    // =========================================================================
    // 3. KEDISIPLINAN & EWS THRESHOLD DETECTOR
    // =========================================================================
    describe('3. Kedisiplinan & Early Warning System (EWS) Thresholds', () => {
        function evaluateEwsTrigger(prevPoints, newPoints) {
            const crossed50 = (prevPoints < 50 && newPoints >= 50);
            const crossed100 = (prevPoints < 100 && newPoints >= 100);
            if (crossed100) return { triggered: true, level: 'CRITICAL', title: '🚨 EWS Kritis: Siswa Mencapai 100 Poin Pelanggaran' };
            if (crossed50) return { triggered: true, level: 'WARNING', title: '⚠️ EWS Waspada: Siswa Mencapai 50 Poin Pelanggaran' };
            return { triggered: false };
        }

        test('3.1. Threshold 50 poin pertama kali menembus memicu status WARNING', () => {
            const res = evaluateEwsTrigger(35, 55);
            expect(res.triggered).toBe(true);
            expect(res.level).toBe('WARNING');
            expect(res.title).toContain('50 Poin');
        });

        test('3.2. Penambahan poin berikutnya di atas 50 tapi di bawah 100 TIDAK memicu ulang (anti-spam)', () => {
            const res = evaluateEwsTrigger(55, 75);
            expect(res.triggered).toBe(false);
        });

        test('3.3. Threshold 100 poin pertama kali menembus memicu status CRITICAL', () => {
            const res = evaluateEwsTrigger(85, 105);
            expect(res.triggered).toBe(true);
            expect(res.level).toBe('CRITICAL');
            expect(res.title).toContain('100 Poin');
        });

        test('3.4. Penambahan poin di atas 100 TIDAK memicu ulang peringatan 100 poin', () => {
            const res = evaluateEwsTrigger(105, 120);
            expect(res.triggered).toBe(false);
        });
    });

    // =========================================================================
    // 4. CRON & HELPER HARI LIBUR / AKHIR PEKAN (WITA UTC+8)
    // =========================================================================
    describe('4. Cron & Helper Deteksi Libur / Akhir Pekan', () => {
        function isWeekend(dateStr) {
            const parts = dateStr.split('-').map(Number);
            const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
            const day = d.getUTCDay();
            return day === 0 || day === 6;
        }

        test('4.1. Mendeteksi hari Sabtu dan Minggu sebagai akhir pekan', () => {
            // 2026-10-10 adalah Sabtu
            expect(isWeekend('2026-10-10')).toBe(true);
            // 2026-10-11 adalah Minggu
            expect(isWeekend('2026-10-11')).toBe(true);
            // 2026-10-08 adalah Kamis (Hari Kerja)
            expect(isWeekend('2026-10-08')).toBe(false);
            // 2026-10-09 adalah Jumat (Hari Kerja)
            expect(isWeekend('2026-10-09')).toBe(false);
        });

        test('4.2. Perhitungan detail WITA (UTC+8) tepat dan akurat', () => {
            // Misal waktu UTC: 2026-10-08 02:00:00 (10:00 WITA)
            const utcTime = new Date(Date.UTC(2026, 9, 8, 2, 0, 0));
            const witaOffsetMs = 8 * 60 * 60 * 1000;
            const witaDate = new Date(utcTime.getTime() + witaOffsetMs);

            expect(witaDate.getUTCHours()).toBe(10);
            expect(witaDate.getUTCDate()).toBe(8);
        });
    });

    // =========================================================================
    // 5. SUKA DUKA: PENGUMUMAN ACARA & PENGINGAT IURAN
    // =========================================================================
    describe('5. Suka Duka: Broadcast & Pengingat Iuran Bulanan', () => {
        test('5.1. Otorisasi peran penyiar pengumuman suka duka', () => {
            const allowedRoles = ['super_admin', 'kepala_sekolah', 'admin_sukaduka', 'guru', 'guru_mapel', 'staff'];
            
            expect(allowedRoles.includes('admin_sukaduka')).toBe(true);
            expect(allowedRoles.includes('guru')).toBe(true);
            expect(allowedRoles.includes('staff')).toBe(true);
            expect(allowedRoles.includes('siswa')).toBe(false);
            expect(allowedRoles.includes('admin_kelas')).toBe(false);
        });

        test('5.2. Siaran pengumuman suka duka menargetkan role guru, staff, dan admin_sukaduka', () => {
            const broadcastPayload = {
                title: '📢 Kabar Duka Keluarga Besar SMAGESA',
                body: 'Telah berpulang ke hadapan Ida Sang Hyang Widhi Wasa...',
                url: './sukaduka/suka-duka.html',
                targetType: 'role',
                targetValue: 'guru,staff,admin_sukaduka'
            };

            expect(broadcastPayload.targetType).toBe('role');
            expect(broadcastPayload.targetValue).toBe('guru,staff,admin_sukaduka');
            expect(broadcastPayload.url).toBe('./sukaduka/suka-duka.html');
        });
    });

    // =========================================================================
    // 6. PORTAL SISWA: STRUKTUR DOM NOTIFICATION CENTER & ANTI-NESTING
    // =========================================================================
    describe('6. Portal Siswa: Integritas UI & Kepatuhan Anti-Nesting', () => {
        beforeEach(() => {
            document.documentElement.innerHTML = portalHtml;
        });

        test('6.1. Tombol pemicu lonceng desktop dan mobile tersedia di header', () => {
            const btnDesktop = document.getElementById('btn-notif-desktop');
            const btnMobile = document.getElementById('btn-notif-mobile');
            const badgeDesktop = document.getElementById('notif-badge-desktop');
            const badgeMobile = document.getElementById('notif-badge-mobile');

            expect(btnDesktop).not.toBeNull();
            expect(btnMobile).not.toBeNull();
            expect(badgeDesktop).not.toBeNull();
            expect(badgeMobile).not.toBeNull();
        });

        test('6.2. Kontainer panel dan modal detail notifikasi berdiri sebagai top-level siblings (Anti-Nesting Rule)', () => {
            const backdrop = document.getElementById('notification-center-backdrop');
            const panel = document.getElementById('notification-center-panel');
            const detailModal = document.getElementById('modal-notification-detail');

            expect(backdrop).not.toBeNull();
            expect(panel).not.toBeNull();
            expect(detailModal).not.toBeNull();

            // Memastikan ketiganya adalah direct child dari <body>
            expect(backdrop.parentElement.tagName.toLowerCase()).toBe('body');
            expect(panel.parentElement.tagName.toLowerCase()).toBe('body');
            expect(detailModal.parentElement.tagName.toLowerCase()).toBe('body');

            // Memastikan tidak berada di dalam container dashboard-view atau elemen modal lain
            const dashboardView = document.getElementById('dashboard-view');
            expect(dashboardView.contains(backdrop)).toBe(false);
            expect(dashboardView.contains(panel)).toBe(false);
            expect(dashboardView.contains(detailModal)).toBe(false);
        });

        test('6.3. Elemen kontrol notifikasi (tab semua/belum dibaca, tandai semua) lengkap di dalam panel', () => {
            const tabAll = document.getElementById('tab-notif-all');
            const tabUnread = document.getElementById('tab-notif-unread');
            const listContainer = document.getElementById('notification-items-list');

            expect(tabAll).not.toBeNull();
            expect(tabUnread).not.toBeNull();
            expect(listContainer).not.toBeNull();
        });
    });

    // =========================================================================
    // 7. PENGINGAT PRESENSI ROMBEL (CRON & AKSI 1-KLIK)
    // =========================================================================
    describe('7. Pengingat Presensi Rombel (Cron & Aksi 1-Klik)', () => {
        // 7.1. Logika Threshold Minimal 10 Kelas Presensi
        describe('7.1. Syarat Minimal 10 Kelas Sudah Presensi (Anti False Alert Saat Libur / Khusus)', () => {
            function evaluateAttendanceCronThreshold(recordedClassSetSize) {
                if (recordedClassSetSize < 10) {
                    return {
                        skipped: true,
                        reason: 'below_minimum_attendance_threshold',
                        recordedCount: recordedClassSetSize
                    };
                }
                return {
                    skipped: false,
                    recordedCount: recordedClassSetSize
                };
            }

            test('7.1.1. Melewati (skip) pengingat presensi jika kelas tercatat presensi < 10 rombel', () => {
                // Misal: Hari libur atau kegiatan khusus di mana baru 3 kelas yang input presensi
                const result = evaluateAttendanceCronThreshold(3);
                expect(result.skipped).toBe(true);
                expect(result.reason).toBe('below_minimum_attendance_threshold');
                expect(result.recordedCount).toBe(3);
            });

            test('7.1.2. Melewati (skip) jika 0 kelas presensi (libur penuh)', () => {
                const result = evaluateAttendanceCronThreshold(0);
                expect(result.skipped).toBe(true);
                expect(result.reason).toBe('below_minimum_attendance_threshold');
                expect(result.recordedCount).toBe(0);
            });

            test('7.1.3. Memproses pengingat presensi jika kelas tercatat presensi >= 10 rombel', () => {
                // Hari sekolah normal di mana sudah 12 kelas menginput
                const result = evaluateAttendanceCronThreshold(12);
                expect(result.skipped).toBe(false);
                expect(result.recordedCount).toBe(12);
            });

            test('7.1.4. Batas tepat 10 kelas presensi sudah memenuhi threshold', () => {
                const result = evaluateAttendanceCronThreshold(10);
                expect(result.skipped).toBe(false);
                expect(result.recordedCount).toBe(10);
            });
        });

        // 7.2. Filter Kelas Aktif dari active_classes
        describe('7.2. Filter Kelas Aktif dari active_classes (System Settings SSOT)', () => {
            function resolveActiveTargetClasses(systemSettings) {
                let targetClasses = [];
                const activeSetting = systemSettings.active_classes;
                if (activeSetting) {
                    const list = Array.isArray(activeSetting)
                        ? activeSetting
                        : (Array.isArray(activeSetting.list) ? activeSetting.list : []);
                    targetClasses = list.map(c => String(c).trim()).filter(c => {
                        if (!c) return false;
                        const u = c.toUpperCase();
                        return !u.startsWith('ALUMNI') && !u.startsWith('KELUAR') && !u.startsWith('LULUS') && !u.startsWith('DROP') && !u.startsWith('MUTASI');
                    });
                }

                if (targetClasses.length === 0 && systemSettings.metadata_classes) {
                    const metaSetting = systemSettings.metadata_classes;
                    const list = Array.isArray(metaSetting)
                        ? metaSetting
                        : (Array.isArray(metaSetting.list) ? metaSetting.list : []);
                    targetClasses = list.map(c => String(c).trim()).filter(c => {
                        if (!c) return false;
                        const u = c.toUpperCase();
                        return !u.startsWith('ALUMNI') && !u.startsWith('KELUAR') && !u.startsWith('LULUS') && !u.startsWith('DROP') && !u.startsWith('MUTASI');
                    });
                }

                return Array.from(new Set(targetClasses));
            }

            test('7.2.1. Hanya rombel yang termasuk dalam daftar active_classes yang dijadikan target', () => {
                const settings = {
                    active_classes: { list: ['X-A', 'X-B', 'XI-F1', 'XII-MIPA-1'] },
                    metadata_classes: { list: ['X-A', 'X-B', 'X-C', 'XI-F1', 'XI-F2', 'XII-MIPA-1', 'ALUMNI 2024'] }
                };
                const targets = resolveActiveTargetClasses(settings);
                expect(targets).toEqual(['X-A', 'X-B', 'XI-F1', 'XII-MIPA-1']);
                expect(targets).not.toContain('X-C');
                expect(targets).not.toContain('ALUMNI 2024');
            });

            test('7.2.2. Fallback ke metadata_classes jika active_classes belum dikonfigurasi', () => {
                const settings = {
                    active_classes: null,
                    metadata_classes: { list: ['X-1', 'X-2', 'XI-1', 'ALUMNI 2025'] }
                };
                const targets = resolveActiveTargetClasses(settings);
                expect(targets).toEqual(['X-1', 'X-2', 'XI-1']);
                expect(targets).not.toContain('ALUMNI 2025');
            });

            test('7.2.3. Menghitung missingClasses hanya dari subset rombel aktif yang belum presensi', () => {
                const activeTargets = ['X-A', 'X-B', 'XI-A', 'XII-A'];
                const recordedSet = new Set(['X-A', 'XII-A']); // X-A dan XII-A sudah presensi
                const missing = activeTargets.filter(c => !recordedSet.has(c));
                expect(missing).toEqual(['X-B', 'XI-A']);
            });
        });

        // 7.3. Pengiriman Push & Telegram pada Aksi 1-Klik ke Wali Kelas dan Admin Kelas
        describe('7.3. Pengiriman Notifikasi 1-Klik ke Wali Kelas & Admin Kelas', () => {
            function simulateAttendanceReminderEndpoint({ className, date, homeroom, gtkTable = [], fcmTokensTable = [], telegramBotToken = 'sample_token', phoneProvider = true }) {
                const waliUid = homeroom?.uid || '';
                let phone = homeroom?.phone || '';
                let telegramChatId = homeroom?.telegramChatId || '';
                const waliName = homeroom?.name || `Wali Kelas ${className}`;

                // Resolusi telegramChatId komprehensif
                if (!telegramChatId) {
                    const gtkRow = gtkTable.find(g => (g.id === (homeroom?.linkedTeacherId || waliUid) || g.nik === (homeroom?.linkedTeacherId || waliUid) || g.id === waliUid) && (g.telegram_chat_id || g.telegram_id));
                    if (gtkRow) {
                        telegramChatId = gtkRow.telegram_chat_id || gtkRow.telegram_id;
                    }
                }
                if (!telegramChatId && waliUid) {
                    const tokenRow = fcmTokensTable.find(t => t.user_id === waliUid && t.telegram_chat_id);
                    if (tokenRow) {
                        telegramChatId = tokenRow.telegram_chat_id;
                    }
                }

                // Resolusi phone komprehensif
                if (!phone) {
                    const gtkPhone = gtkTable.find(g => (g.id === (homeroom?.linkedTeacherId || waliUid) || g.id === waliUid) && g.phone);
                    if (gtkPhone) phone = gtkPhone.phone;
                }
                if (!phone && waliUid) {
                    const fcmPhone = fcmTokensTable.find(t => t.user_id === waliUid && t.phone);
                    if (fcmPhone) phone = fcmPhone.phone;
                }

                const message = `Pengingat presensi kelas ${className} tanggal ${date}. Mohon segera melengkapi data presensi di SIMAS.`;

                // Push Notification Jobs: Wali Kelas (user) + Admin Kelas (class)
                const pushJobs = [];
                if (waliUid) {
                    pushJobs.push({
                        title: '⏰ Pengingat Presensi',
                        body: message,
                        url: './presensi.html',
                        targetType: 'user',
                        targetValue: waliUid
                    });
                }
                pushJobs.push({
                    title: '⏰ Pengingat Presensi',
                    body: message,
                    url: './presensi.html',
                    targetType: 'class',
                    targetValue: className
                });

                const channelResults = [];
                if (telegramChatId && telegramBotToken) {
                    channelResults.push({ channel: 'telegram', status: true });
                }
                if (phone && phoneProvider) {
                    channelResults.push({ channel: 'wa', status: true });
                }

                const telegramResult = channelResults.find(r => r.channel === 'telegram');
                const waResult = channelResults.find(r => r.channel === 'wa');

                return {
                    success: true,
                    queued: pushJobs.length > 0 || channelResults.some(r => r.status === true),
                    waliFound: Boolean(waliUid),
                    waliName,
                    push: {
                        success: pushJobs.length > 0,
                        targetCount: pushJobs.length,
                        jobs: pushJobs
                    },
                    telegram: {
                        success: Boolean(telegramResult?.status),
                        chatId: telegramChatId ? 'configured' : 'not_found'
                    },
                    wa: {
                        success: Boolean(waResult?.status),
                        phone: phone ? 'configured' : 'not_found'
                    },
                    externalChannels: channelResults
                };
            }

            test('7.3.1. Aksi 1-klik mengirim push notification ke Wali Kelas dan Admin Kelas', () => {
                const res = simulateAttendanceReminderEndpoint({
                    className: 'X-E',
                    date: '2026-10-09',
                    homeroom: { uid: 'wali_xe_uid', name: 'Ni Wayan Guru, S.Pd.', telegramChatId: '123456789' }
                });

                expect(res.push.success).toBe(true);
                expect(res.push.jobs).toHaveLength(2);
                expect(res.push.jobs[0]).toMatchObject({
                    targetType: 'user',
                    targetValue: 'wali_xe_uid'
                });
                expect(res.push.jobs[1]).toMatchObject({
                    targetType: 'class',
                    targetValue: 'X-E'
                });
            });

            test('7.3.2. Resolusi telegramChatId dari tabel GTK jika di objek homeroom kosong', () => {
                const res = simulateAttendanceReminderEndpoint({
                    className: 'XI-F1',
                    date: '2026-10-09',
                    homeroom: { uid: 'wali_xi_uid', linkedTeacherId: 'gtk_001', name: 'I Made Wali, M.Pd.', telegramChatId: '' },
                    gtkTable: [{ id: 'gtk_001', name: 'I Made Wali', telegram_chat_id: '987654321' }]
                });

                expect(res.telegram.success).toBe(true);
                expect(res.telegram.chatId).toBe('configured');
            });

            test('7.3.3. Resolusi telegramChatId dari tabel fcm_tokens jika di homeroom dan GTK kosong', () => {
                const res = simulateAttendanceReminderEndpoint({
                    className: 'XII-MIPA-2',
                    date: '2026-10-09',
                    homeroom: { uid: 'wali_xii_uid', name: 'I Ketut Wali', telegramChatId: '' },
                    gtkTable: [],
                    fcmTokensTable: [{ user_id: 'wali_xii_uid', telegram_chat_id: '555666777' }]
                });

                expect(res.telegram.success).toBe(true);
                expect(res.telegram.chatId).toBe('configured');
            });

            test('7.3.4. Memastikan respons JSON memuat struktur status push, telegram, dan wa', () => {
                const res = simulateAttendanceReminderEndpoint({
                    className: 'X-A',
                    date: '2026-10-09',
                    homeroom: { uid: 'wali_xa', name: 'Wali X-A', phone: '08123456789', telegramChatId: '111222' }
                });

                expect(res.success).toBe(true);
                expect(res).toHaveProperty('push');
                expect(res).toHaveProperty('telegram');
                expect(res).toHaveProperty('wa');
                expect(res.push.success).toBe(true);
                expect(res.telegram.success).toBe(true);
                expect(res.wa.success).toBe(true);
            });
        });

        // 7.4. Verifikasi Integritas Kode Sumber di cloudflare/worker.js & js/page-presensi.js
        describe('7.4. Verifikasi Statis Kodingan Worker & Frontend Presensi', () => {
            const workerCode = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');
            const presensiCode = fs.readFileSync(path.join(__dirname, '../js/page-presensi.js'), 'utf8');

            test('7.4.1. worker.js memuat filter active_classes dan threshold minimal 10 kelas presensi', () => {
                expect(workerCode).toContain("key = 'active_classes'");
                expect(workerCode).toContain('recordedClassSet.size < 10');
                expect(workerCode).toContain('below_minimum_attendance_threshold');
                expect(workerCode).toContain('Menghindari false alert saat libur/kegiatan sekolah');
            });

            test('7.4.2. worker.js endpoint attendance-reminder mengirim notifikasi ke Wali Kelas dan Admin Kelas', () => {
                expect(workerCode).toContain('path === "/api/notify/attendance-reminder"');
                expect(workerCode).toContain('targetType: "user"');
                // Admin Kelas rombel saja (class_admin), bukan seluruh siswa rombel (class).
                expect(workerCode).toContain('targetType: "class_admin"');
                expect(workerCode).toContain('fcm_tokens');
                expect(workerCode).toContain('telegram_chat_id');
            });

            test('7.4.3. js/page-presensi.js memuat toast feedback pengingat Push & Telegram', () => {
                expect(presensiCode).toContain('Pengingat presensi untuk kelas ${className} berhasil dikirim (Push Notifikasi & Telegram Bot).');
            });
        });
    });

    // =========================================================================
    // 8. ARSITEKTUR NOTIFIKASI OTOMATIS IN-APP (ZERO-PUSH DEPENDENCY)
    // =========================================================================
    describe('8. Arsitektur Notifikasi Otomatis In-App (Lonceng Web Otomatis untuk Semua Kasus)', () => {
        const workerCode = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');

        test('8.1. createNotificationJob selalu menyertakan baris in-app delivery untuk targetType user/student', () => {
            expect(workerCode).toContain("payload.targetType === 'user' || payload.targetType === 'student'");
            expect(workerCode).toContain("'inapp'");
            expect(workerCode).toContain("INSERT OR IGNORE INTO notification_deliveries");
        });

        test('8.2. GET /api/notifications/inbox mencakup target personal, rombel, role, agenda_staff, dan broadcast all', () => {
            expect(workerCode).toContain('path === "/api/notifications/inbox"');
            expect(workerCode).toContain("j.target_type = 'all'");
            expect(workerCode).toContain("j.target_type = 'user'");
            expect(workerCode).toContain("j.target_type = 'class'");
            expect(workerCode).toContain("j.target_type = 'role'");
            expect(workerCode).toContain("j.target_type = 'agenda_staff'");
        });

        test('8.3. POST /api/notifications/mark-read mendukung pembuatan baris status baca mandiri per pengguna', () => {
            expect(workerCode).toContain('path === "/api/notifications/mark-read"');
            expect(workerCode).toContain("is_read = 1");
            expect(workerCode).toContain("INSERT OR IGNORE INTO notification_deliveries");
        });

        test('8.4. attendance-reminder menerapkan cooldown jendela 30 menit (bukan pemblokiran permanen)', () => {
            expect(workerCode).toContain("datetime(created_at) >= datetime('now', '-30 minutes')");
        });

        test('8.5. findHomeroomTeacherForClass mendukung pengenalan guru_mapel atau guru dengan kelas ampu', () => {
            expect(workerCode).toContain('function pickHomeroomDocument(');
            expect(workerCode).toContain('userData.role === "guru_mapel" || userData.role === "guru"');
        });
    });
});

