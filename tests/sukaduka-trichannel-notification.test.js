const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Modul Kas Suka-Duka: Integrasi Notifikasi Tri-Channel (WhatsApp, Web Push FCM, & Telegram Bot)', () => {
    const rootDir = path.resolve(__dirname, '..');
    const sukaDukaJsPath = path.join(rootDir, 'sukaduka/suka-duka.js');
    const workerJsPath = path.join(rootDir, 'cloudflare/worker.js');

    let sukaDukaSource;
    let workerSource;

    beforeAll(() => {
        sukaDukaSource = fs.readFileSync(sukaDukaJsPath, 'utf8');
        workerSource = fs.readFileSync(workerJsPath, 'utf8');
    });

    describe('1. Verifikasi Kode Sumber sukaduka/suka-duka.js', () => {
        test('sendWaTunggakanSukaDuka memicu pengiriman Web Push FCM via cfClient.sendPushNotification', () => {
            expect(sukaDukaSource).toContain('cfClient.sendPushNotification');
            expect(sukaDukaSource).toContain("title: \"💰 Informasi Kas Suka-Duka\"");
            expect(sukaDukaSource).toContain("url: \"./sukaduka/suka-duka.html\"");
            expect(sukaDukaSource).toContain("targetType: \"user\"");
        });

        test('sendWaTunggakanSukaDuka memicu pengiriman Telegram Bot resmi via cfClient.sendTelegramNotification', () => {
            expect(sukaDukaSource).toContain('cfClient.sendTelegramNotification');
            expect(sukaDukaSource).toContain("💰 <b>[REKAPITULASI IURAN KAS SUKA-DUKA]</b>");
            expect(sukaDukaSource).toContain("parseMode: \"HTML\"");
        });

        test('sendWaTunggakanSukaDuka tetap memicu Push & Telegram saat nomor WA guru kosong (fallback manual)', () => {
            const funcSnippet = sukaDukaSource.substring(sukaDukaSource.indexOf('window.sendWaTunggakanSukaDuka ='));
            const phoneCheckIndex = funcSnippet.indexOf('if (!phone) {');
            expect(phoneCheckIndex).toBeGreaterThan(-1);
            const missingPhoneBlock = funcSnippet.substring(phoneCheckIndex, funcSnippet.indexOf('return;', phoneCheckIndex));
            expect(missingPhoneBlock).toContain('triggerTriChannelBackground()');
        });

        test('sendWaTunggakanSukaDuka membungkus pemanggilan Tri-Channel dalam isolasi asinkronus setTimeout try-catch', () => {
            expect(sukaDukaSource).toContain('const triggerTriChannelBackground = () => {');
            expect(sukaDukaSource).toContain('[Suka-Duka Tri-Channel Warning]');
        });
    });

    describe('2. Simulasi Eksekusi Runtime VM sendWaTunggakanSukaDuka', () => {
        test('Menjalankan Tri-Channel secara lengkap saat guru memiliki nomor HP & Telegram Chat ID', async () => {
            const pushMock = jest.fn().mockResolvedValue({ success: true });
            const telegramMock = jest.fn().mockResolvedValue({ success: true });
            const waMock = jest.fn().mockResolvedValue({ success: true, skipped: false });
            const toastMock = jest.fn();

            const dummyTeacher = {
                id: '198801012015011001',
                name: 'I Komang Purna, S.Pd.',
                nip: '198801012015011001',
                phone: '081234567890',
                telegramChatId: '198160734'
            };

            let backgroundPromise = null;

            const sandbox = {
                allTeachers: [dummyTeacher],
                cfClient: {
                    sendWaNotification: waMock,
                    sendPushNotification: pushMock,
                    sendTelegramNotification: telegramMock
                },
                SCHOOL_CONFIG: { appBrand: 'SIMAS SMAGESA' },
                showSukaDukaToast: toastMock,
                escapeHTML: (str) => String(str || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
                setTimeout: (fn) => {
                    backgroundPromise = fn();
                },
                console: { warn: jest.fn(), error: jest.fn() },
                window: {}
            };

            // Ekstrak fungsi sendWaTunggakanSukaDuka dari file
            const funcMatch = sukaDukaSource.match(/window\.sendWaTunggakanSukaDuka\s*=\s*async\s*function[\s\S]*?\n\};\n/);
            expect(funcMatch).toBeTruthy();

            vm.createContext(sandbox);
            vm.runInContext(funcMatch[0], sandbox);

            const dummyBtn = {
                innerHTML: '',
                disabled: false,
                style: {},
                classList: { add: jest.fn(), remove: jest.fn() }
            };

            await sandbox.window.sendWaTunggakanSukaDuka('198801012015011001', 3, 'Januari, Februari, Maret', '150.000', dummyBtn);

            // Tunggu background task Tri-Channel selesai
            if (backgroundPromise) {
                await backgroundPromise;
            }

            // 1. WhatsApp API terpanggil dengan nomor ternormalisasi (prefix 62)
            expect(waMock).toHaveBeenCalledWith(expect.objectContaining({
                phone: '6281234567890',
                category: 'suka_duka',
                targetName: 'I Komang Purna, S.Pd.'
            }));

            // 2. Web Push FCM terpanggil
            expect(pushMock).toHaveBeenCalledWith(expect.objectContaining({
                title: '💰 Informasi Kas Suka-Duka',
                url: './sukaduka/suka-duka.html',
                targetType: 'user'
            }));

            // 3. Telegram Bot terpanggil
            expect(telegramMock).toHaveBeenCalledWith(expect.objectContaining({
                chatId: '198160734',
                parseMode: 'HTML'
            }));

            // 4. Toast menginformasikan multi-channel
            expect(toastMock).toHaveBeenCalledWith(
                'Berhasil',
                expect.stringContaining('WA + Telegram + Web Push'),
                'success'
            );
        });

        test('Menjalankan Web Push & Telegram bahkan saat nomor WA guru tidak ada', async () => {
            const pushMock = jest.fn().mockResolvedValue({ success: true });
            const telegramMock = jest.fn().mockResolvedValue({ success: true });
            const toastMock = jest.fn();
            const openMock = jest.fn();

            const dummyTeacherNoPhone = {
                id: '198801012015011002',
                name: 'Guru Tanpa Nomor, S.Pd.',
                nip: '198801012015011002',
                phone: '',
                telegramChatId: '987654321'
            };

            let backgroundPromise = null;

            const sandbox = {
                allTeachers: [dummyTeacherNoPhone],
                cfClient: {
                    sendPushNotification: pushMock,
                    sendTelegramNotification: telegramMock
                },
                SCHOOL_CONFIG: { appBrand: 'SIMAS SMAGESA' },
                showSukaDukaToast: toastMock,
                escapeHTML: (str) => String(str || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
                setTimeout: (fn) => {
                    backgroundPromise = fn();
                },
                console: { warn: jest.fn(), error: jest.fn() },
                window: {
                    open: openMock
                }
            };

            const funcMatch = sukaDukaSource.match(/window\.sendWaTunggakanSukaDuka\s*=\s*async\s*function[\s\S]*?\n\};\n/);
            expect(funcMatch).toBeTruthy();

            vm.createContext(sandbox);
            vm.runInContext(funcMatch[0], sandbox);

            const dummyBtn = {
                innerHTML: '',
                disabled: false,
                style: {},
                classList: { add: jest.fn(), remove: jest.fn() }
            };

            await sandbox.window.sendWaTunggakanSukaDuka('198801012015011002', 1, 'Januari', '50.000', dummyBtn);

            if (backgroundPromise) {
                await backgroundPromise;
            }

            // Web Push & Telegram tetap dieksekusi
            expect(pushMock).toHaveBeenCalledWith(expect.objectContaining({
                title: '💰 Informasi Kas Suka-Duka',
                targetType: 'user'
            }));
            expect(telegramMock).toHaveBeenCalledWith(expect.objectContaining({
                chatId: '987654321'
            }));
            expect(openMock).toHaveBeenCalled();
        });
    });

    describe('3. Verifikasi Cloudflare Worker Fallback & Phone Targeting', () => {
        test('notificationTargetFilter di cloudflare/worker.js mendukung pencarian nomor HP untuk targetType user', () => {
            expect(workerSource).toContain("const cleanPhone = cleanPhoneNumber(cleanVal);");
            expect(workerSource).toContain("(t.phone IS NOT NULL AND t.phone <> '' AND (t.phone = ? OR REPLACE(t.phone, '+', '') = ?))");
        });

        test('getAdminUserContact di cloudflare/worker.js memiliki fallback D1 GTK saat dokumen users tidak ditemukan', () => {
            expect(workerSource).toContain("SELECT name, phone, nip, foto, telegram_chat_id AS telegramChatId FROM gtk WHERE id = ? OR nik = ? OR nip = ? OR (phone IS NOT NULL AND phone != '' AND phone = ?) LIMIT 1");
        });
    });

    describe('4. Verifikasi Cron Pengingat Iuran Suka Duka Bulanan: Hanya Mengingatkan Anggota yang Belum Bayar s.d. Jatuh Tempo', () => {
        test('4.1. processMonthlySukadukaFeeReminder membaca data iuran dari Supabase sukaduka_iuran dan memfilter anggota', () => {
            expect(workerSource).toMatch(/async\s+function\s+processMonthlySukadukaFeeReminder\s*\(\s*env,\s*dateStr/);
            // Dibaca dengan service role (tabel dikunci RLS; anon key hanya menerima [] tanpa error).
            expect(workerSource).toContain("fetchSupabaseRowsAsService(env, 'sukaduka_iuran',");
            expect(workerSource).toMatch(/SELECT\s+id,\s*nik,\s*nip,\s*name,\s*email,\s*phone,\s*role\s+FROM\s+gtk/);
        });

        test('4.2. Anggota yang sudah lunas dikumpulkan ke paidIdentifiers dan diproteksi agar tidak diingatkan', () => {
            expect(workerSource).toContain("const paidIdentifiers = new Set();");
            expect(workerSource).toContain("targetId !== gPhone && !paidIdentifiers.has(targetId)");
            expect(workerSource).toContain("unpaidRecipients.push({ gtkId: gtkId || uidTargets[0], uidTargets });");
        });

        test('4.3. Notifikasi pengingat dikirim presisi dengan targetType user (bukan broadcast role tanpa filter)', () => {
            const funcSnippet = workerSource.substring(workerSource.indexOf('async function processMonthlySukadukaFeeReminder('));
            const endSnippet = funcSnippet.substring(0, funcSnippet.indexOf('// Helper ekstraksi key R2'));
            expect(endSnippet).toContain('targetType: "user"');
            expect(endSnippet).not.toContain('targetValue: "guru,staff,admin_sukaduka"');
        });

        test('4.4. Simulasi Logika: Anggota yang sudah membayar s.d. bulan berjalan tidak masuk ke daftar penerima pengingat', () => {
            const currentYear = 2026;
            const currentMonth = 10; // Oktober
            const currentYearMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

            // Simulasi 2 GTK: Guru A sudah bayar Oktober, Guru B belum bayar Oktober
            const mockGtks = [
                { id: 'gtk-001', name: 'Guru Lunas', nip: '19800101', phone: '081111111111' },
                { id: 'gtk-002', name: 'Guru Nunggak', nip: '19800202', phone: '082222222222' }
            ];

            const mockIuran = [
                // Guru 001: lunas Juni s.d. Oktober 2026
                { guru_id: 'gtk-001', bulan_tahun: '2026-06', jumlah: 50000 },
                { guru_id: 'gtk-001', bulan_tahun: '2026-07', jumlah: 50000 },
                { guru_id: 'gtk-001', bulan_tahun: '2026-08', jumlah: 50000 },
                { guru_id: 'gtk-001', bulan_tahun: '2026-09', jumlah: 50000 },
                { guru_id: 'gtk-001', bulan_tahun: '2026-10', jumlah: 50000 },
                // Guru 002: hanya bayar s.d. September 2026 (Oktober belum bayar)
                { guru_id: 'gtk-002', bulan_tahun: '2026-06', jumlah: 50000 },
                { guru_id: 'gtk-002', bulan_tahun: '2026-07', jumlah: 50000 },
                { guru_id: 'gtk-002', bulan_tahun: '2026-08', jumlah: 50000 },
                { guru_id: 'gtk-002', bulan_tahun: '2026-09', jumlah: 50000 }
            ];

            const paymentsByGuru = new Map();
            mockIuran.forEach(r => {
                if (!paymentsByGuru.has(r.guru_id)) paymentsByGuru.set(r.guru_id, new Map());
                paymentsByGuru.get(r.guru_id).set(r.bulan_tahun, r.jumlah);
            });

            const evaluateStatus = (gtk) => {
                const p = paymentsByGuru.get(gtk.id) || new Map();
                for (let m = 1; m <= currentMonth; m++) {
                    const ym = `${currentYear}-${String(m).padStart(2, '0')}`;
                    const isVirtual = (currentYear === 2026 && m <= 5);
                    const amt = p.get(ym);
                    const isPaid = amt !== undefined ? (amt > 0) : isVirtual;
                    if (!isPaid) return false; // belum lunas
                }
                return true; // lunas
            };

            expect(evaluateStatus(mockGtks[0])).toBe(true);  // Guru Lunas -> TRUE
            expect(evaluateStatus(mockGtks[1])).toBe(false); // Guru Nunggak -> FALSE
        });

        test('4.5. Helper getSukadukaFeeReminderSchedule dan isSukadukaFeeReminderDay tersedia di cloudflare/worker.js', () => {
            expect(workerSource).toContain("function getSukadukaFeeReminderSchedule(year, month)");
            expect(workerSource).toContain("function isSukadukaFeeReminderDay(dateStr)");
            expect(workerSource).toContain("if (isSukadukaFeeReminderDay(dateStr))");
        });

        test('4.6. Logika Penundaan: Jika tanggal 10 adalah Sabtu/Minggu, notifikasi dialihkan ke hari Senin berikutnya', () => {
            function getSchedule(year, month) {
                const monthStr = String(month).padStart(2, '0');
                const dueDate = `${year}-${monthStr}-10`;
                const d10 = new Date(Date.UTC(year, month - 1, 10, 0, 0, 0));
                const dayOfWeek = d10.getUTCDay();
                if (dayOfWeek === 6) {
                    return { dueDate, reminderDate: `${year}-${monthStr}-12`, isPostponed: true };
                } else if (dayOfWeek === 0) {
                    return { dueDate, reminderDate: `${year}-${monthStr}-11`, isPostponed: true };
                }
                return { dueDate, reminderDate: dueDate, isPostponed: false };
            }

            // Kasus 1: Oktober 2026 -> 10 Oktober 2026 adalah SABTU
            const schOct2026 = getSchedule(2026, 10);
            expect(schOct2026.isPostponed).toBe(true);
            expect(schOct2026.dueDate).toBe('2026-10-10');
            expect(schOct2026.reminderDate).toBe('2026-10-12'); // Hari Senin tgl 12

            // Kasus 2: Mei 2026 -> 10 Mei 2026 adalah MINGGU
            const schMay2026 = getSchedule(2026, 5);
            expect(schMay2026.isPostponed).toBe(true);
            expect(schMay2026.dueDate).toBe('2026-05-10');
            expect(schMay2026.reminderDate).toBe('2026-05-11'); // Hari Senin tgl 11

            // Kasus 3: November 2026 -> 10 November 2026 adalah SELASA (hari kerja)
            const schNov2026 = getSchedule(2026, 11);
            expect(schNov2026.isPostponed).toBe(false);
            expect(schNov2026.dueDate).toBe('2026-11-10');
            expect(schNov2026.reminderDate).toBe('2026-11-10'); // Tetap tgl 10
        });

        test('4.7. Pada hari Sabtu (2026-10-10), cron pengingat otomatis diskip dan tidak dikirim sampai hari Senin (2026-10-12)', () => {
            const funcSnippet = workerSource.substring(workerSource.indexOf('async function processMonthlySukadukaFeeReminder('));
            const endSnippet = funcSnippet.substring(0, funcSnippet.indexOf('// Helper ekstraksi key R2'));
            expect(endSnippet).toContain("if (!options?.forceRun && targetDate !== schedule.reminderDate)");
            expect(endSnippet).toContain('reason: "not_reminder_date"');
            expect(endSnippet).toContain("schedule.isPostponed");
        });
    });
});
