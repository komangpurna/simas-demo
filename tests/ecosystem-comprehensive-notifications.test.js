/**
 * tests/ecosystem-comprehensive-notifications.test.js
 * ====================================================================
 * Test Suite: Ekosistem Notifikasi Menyeluruh SIMAS SMAGESA
 * Memvalidasi 8 Modul Notifikasi:
 * 1. Pengingat Jurnal Mengajar KBM Guru Mapel Pukul 15:00 WITA (Web Push + Telegram Bot)
 * 2. Rekap Mingguan Jurnal KBM Jumat Sore Pukul 16:00 WITA ke Kepsek (Khusus Web Push, 0 Telegram)
 * 3. Alert Realtime Siswa Alpha >= 2 Hari Berturut-turut ke Wali Kelas & Guru BK
 * 4. Notifikasi Persetujuan & Alur Peminjaman Sarpras (sarpras_loans) ke Pemohon
 * 5. Notifikasi Penyelesaian Tiket Aduan Kerusakan Fasilitas (sarpras_reports) ke Pelapor
 * 6. Pengingat Sirkulasi Perpustakaan Pukul 07:00 WITA (lib_sirkulasi: H-1 & Keterlambatan)
 * 7. Notifikasi Aman & Privasi ke Akun Siswa (Catatan Wali Kelas, Guru Wali, dan BK)
 * 8. Pengingat SPP Komite Siswa Tanggal 10 & 20 Pukul 08:00 WITA (Cek Bayar di Muka + Total Tunggakan)
 * 9. Paritas Pemanggilan Klien ke Worker (/api/notify/consecutive-alpha-alert)
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Ekosistem Notifikasi Menyeluruh SIMAS SMAGESA', () => {
    const root = path.resolve(__dirname, '..');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');
    const clientJsPath = path.join(root, 'js', 'cloudflare-client.js');
    const presensiJsPath = path.join(root, 'js', 'page-presensi.js');

    const workerJs = fs.readFileSync(workerJsPath, 'utf8');
    const clientJs = fs.readFileSync(clientJsPath, 'utf8');
    const presensiJs = fs.readFileSync(presensiJsPath, 'utf8');

    // 1. PENGINGAT JURNAL MENGAJAR KBM (WEB PUSH + TELEGRAM)
    describe('1. Pengingat Jurnal Mengajar KBM (15:00 WITA)', () => {
        test('processMissingTeachingJournalReminderCron memiliki pemanggilan Web Push dan Telegram Bot', () => {
            expect(workerJs).toContain('async function processMissingTeachingJournalReminderCron');
            expect(workerJs).toContain('📖 Pengingat Jurnal Mengajar KBM');
            // Verifikasi resolusi telegram_chat_id dan executeTelegramFetch
            expect(workerJs).toMatch(/executeTelegramFetch\(env\.TELEGRAM_BOT_TOKEN,\s*tgChatId/);
            expect(workerJs).toContain('Anda memiliki jadwal mengajar KBM pada hari ini');
        });
    });

    // 2. REKAPITULASI MINGGUAN KBM JUMAT SORE KE KEPALA SEKOLAH
    describe('2. Rekap Mingguan Jurnal KBM Jumat Sore (16:00 WITA)', () => {
        test('processWeeklyJournalPrincipalRecapCron menghitung agregat KBM dan mengirim khusus Web Push ke Kepsek', () => {
            expect(workerJs).toContain('async function processWeeklyJournalPrincipalRecapCron');
            expect(workerJs).toContain('📊 Rekap Mingguan Jurnal KBM (Jumat Sore)');
            expect(workerJs).toContain('targetValue: "kepala_sekolah"');
            
            // Verifikasi larangan keras mengirim Telegram pada rekap Kepsek
            const recapFnMatch = workerJs.match(/async function processWeeklyJournalPrincipalRecapCron[\s\S]*?^}/m);
            expect(recapFnMatch).not.toBeNull();
            const recapFnCode = recapFnMatch[0];
            expect(recapFnCode).not.toContain('executeTelegramFetch');
        });

        test('Dispatcher scheduled menjalankan rekap kepsek hanya pada hari Jumat (dayOfWeek === 5)', () => {
            expect(workerJs).toMatch(/hours\s*>=\s*16\s*&&\s*dayOfWeek\s*===\s*5/);
            expect(workerJs).toContain('weekly_principal_kbm_recap');
        });
    });

    // 3. ALERT REALTIME SISWA ALPHA >= 2 HARI BERTURUT-TURUT
    describe('3. Alert Realtime Siswa Alpha >= 2 Hari Beruntun ke Wali Kelas & BK', () => {
        test('Endpoint POST /api/notify/consecutive-alpha-alert terdefinisi pada worker', () => {
            expect(workerJs).toContain('/api/notify/consecutive-alpha-alert');
            expect(workerJs).toContain('prevActiveDate');
            expect(workerJs).toContain('consecutiveAlphaStudents');
            expect(workerJs).toContain('⚠️ Peringatan Siswa Alpha Beruntun');
            expect(workerJs).toContain('targetValue: "guru_bk"');
        });

        test('Client js/page-presensi.js memicu notifyConsecutiveAlpha secara aman tanpa TypeError', () => {
            expect(presensiJs).toContain('window.cfClient.notifyConsecutiveAlpha');
            expect(presensiJs).toContain("r.status === 'A'");
            expect(presensiJs).not.toMatch(/\(records\s*\|\|\s*\[\]\)\.filter/);
            expect(presensiJs).toMatch(/Object\.values\(records/);
        });

        test('CloudflareClient memiliki method notifyConsecutiveAlpha', () => {
            expect(clientJs).toContain('notifyConsecutiveAlpha({ className, dateStr, alphaStudents');
            expect(clientJs).toContain('/api/notify/consecutive-alpha-alert');
        });
    });

    // 4. NOTIFIKASI PEMINJAMAN SARPRAS KE PEMOHON
    describe('4. Notifikasi Peminjaman Sarpras (sarpras_loans)', () => {
        test('POST /api/sarpras/loans/:id/status mengirimkan Web Push & Telegram ke borrower_uid', () => {
            const sarprasLoanMatch = workerJs.match(/path\.startsWith\("\/api\/sarpras\/loans\/"\)\s*&&\s*path\.endsWith\("\/status"\)[\s\S]*?return jsonResponse/);
            expect(sarprasLoanMatch).not.toBeNull();
            const loanCode = sarprasLoanMatch[0];

            expect(loanCode).toContain('existing.borrower_uid');
            expect(loanCode).toContain('📦 Status Peminjaman Sarpras');
            expect(loanCode).toContain('targetValue: existing.borrower_uid');
            expect(loanCode).toContain('executeTelegramFetch');
        });
    });

    // 5. NOTIFIKASI PENYELESAIAN ADUAN KERUSAKAN FASILITAS KE PELAPOR
    describe('5. Notifikasi Penyelesaian Tiket Aduan Sarpras (sarpras_reports)', () => {
        test('Disposisi aduan resolved mengirimkan Web Push ke reporter_uid', () => {
            const dispositionMatch = workerJs.match(/path\.startsWith\("\/api\/sarpras\/reports\/"\)\s*&&\s*path\.endsWith\("\/disposition"\)[\s\S]*?return jsonResponse/);
            expect(dispositionMatch).not.toBeNull();
            const dispCode = dispositionMatch[0];

            expect(dispCode).toContain('newStatus === "resolved"');
            expect(dispCode).toContain('existing.reporter_uid');
            expect(dispCode).toContain('🛠️ Laporan Kerusakan Sarpras Selesai');
        });

        test('Penyelesaian tiket pemeliharaan completed mengirimkan notifikasi ke pelapor aduan asal', () => {
            const maintMatch = workerJs.match(/path\.startsWith\("\/api\/sarpras\/maintenance\/logs\/"\)\s*&&\s*method\s*===\s*"PUT"[\s\S]*?return jsonResponse/);
            expect(maintMatch).not.toBeNull();
            const maintCode = maintMatch[0];

            expect(maintCode).toContain('status === "completed" && existing.source_report_id');
            expect(maintCode).toContain('sourceRep?.reporter_uid');
            expect(maintCode).toContain('🛠️ Laporan Kerusakan Sarpras Selesai');
        });
    });

    // 6. PENGINGAT SIRKULASI PERPUSTAKAAN (lib_sirkulasi)
    describe('6. Pengingat Sirkulasi Perpustakaan Pukul 07:00 WITA', () => {
        test('processLibraryDueReminderCron memeriksa peminjaman H-1 dan keterlambatan', () => {
            expect(workerJs).toContain('async function processLibraryDueReminderCron');
            expect(workerJs).toContain('lib_sirkulasi');
            expect(workerJs).toContain('status=eq.dipinjam');
            expect(workerJs).toContain('📚 Pengingat Pengembalian Buku Perpustakaan');
            expect(workerJs).toContain('⚠️ Keterlambatan Buku Perpustakaan');
            expect(workerJs).toContain('targetType: isStudent ? "student" : "user"');
        });

        test('Dispatcher scheduled memicu library reminder pada hours >= 7', () => {
            expect(workerJs).toMatch(/hours\s*>=\s*7\s*&&\s*env\?\.DB/);
            expect(workerJs).toContain('library_due_reminder');
            expect(workerJs).toContain('processLibraryDueReminderCron');
        });
    });

    // 7. NOTIFIKASI CATATAN SISWA DENGAN FORMAT PRIVASI AMAN
    describe('7. Notifikasi Catatan Siswa (Wali Kelas, Guru Wali, dan BK)', () => {
        test('POST /api/walikelas/notes mengirim notifikasi format aman ke studentNis', () => {
            const wkNotesMatch = workerJs.match(/path === "\/api\/walikelas\/notes" && method === "POST"[\s\S]*?return jsonResponse/);
            expect(wkNotesMatch).not.toBeNull();
            const wkCode = wkNotesMatch[0];

            expect(wkCode).toContain('📝 Catatan Baru dari Wali Kelas');
            expect(wkCode).toContain('targetType: "student"');
            expect(wkCode).toContain('targetValue: studentNis');
            expect(wkCode).not.toContain('${notes}'); // Tidak membocorkan teks rahasia di notifikasi
        });

        test('POST /api/perwalian/notes mengirim notifikasi format aman ke studentNis', () => {
            const gwNotesMatch = workerJs.match(/path === "\/api\/perwalian\/notes" && method === "POST"[\s\S]*?return jsonResponse/);
            expect(gwNotesMatch).not.toBeNull();
            const gwCode = gwNotesMatch[0];

            expect(gwCode).toContain('💬 Catatan Perwalian Baru');
            expect(gwCode).toContain('targetType: "student"');
            expect(gwCode).toContain('targetValue: studentNis');
            expect(gwCode).not.toContain('${notes}');
        });

        test('POST /api/bk-actions mengirim notifikasi format aman ke studentNis', () => {
            const bkActionsMatch = workerJs.match(/path === "\/api\/bk-actions" && method === "POST"[\s\S]*?return jsonResponse/);
            expect(bkActionsMatch).not.toBeNull();
            const bkCode = bkActionsMatch[0];

            expect(bkCode).toContain('🤝 Pemberitahuan Bimbingan Konseling (BK)');
            expect(bkCode).toContain('targetType: "student"');
            expect(bkCode).toContain('targetValue: studentNis');
            expect(bkCode).not.toContain('${problem}'); // Tidak membocorkan diagnosa BK di notifikasi
        });
    });

    // 8. PENGINGAT SPP KOMITE SISWA (TGL 10 & 20)
    describe('8. Pengingat SPP Komite Siswa Tanggal 10 & 20 Pukul 08:00 WITA', () => {
        test('processSppMonthlyReminderCron mengecek kelunasan bulan berjalan dan menghitung total tunggakan', () => {
            expect(workerJs).toContain('async function processSppMonthlyReminderCron');
            expect(workerJs).toContain('finance_rates');
            expect(workerJs).toContain('finance_transactions');
            expect(workerJs).toContain('paidSet.has');
            expect(workerJs).toContain('isCurrentMonthPaid');
            expect(workerJs).toContain('unpaidMonths.length * monthlyRate');
            expect(workerJs).toContain('💳 Pengingat Pembayaran SPP');
            expect(workerJs).toContain('⚠️ Peringatan Jatuh Tempo SPP');
            expect(workerJs).toContain('targetType: "student"');
        });

        test('Dispatcher scheduled memicu SPP reminder pada tanggal 10 dan 20 pukul 08:00 WITA', () => {
            expect(workerJs).toMatch(/dayOfMonth\s*===\s*10\s*\|\|\s*dayOfMonth\s*===\s*20/);
            expect(workerJs).toContain('spp_monthly_reminder_');
            expect(workerJs).toContain('processSppMonthlyReminderCron');
        });
    });
});
