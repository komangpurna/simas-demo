const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

describe('Notifikasi Pengesahan & Pembatalan Jurnal Mingguan ke Wali Kelas (Push & Telegram)', () => {
    const workerContent = fs.readFileSync(path.join(rootDir, 'cloudflare/worker.js'), 'utf8');
    const cfClientContent = fs.readFileSync(path.join(rootDir, 'js/cloudflare-client.js'), 'utf8');
    const waliJurnalContent = fs.readFileSync(path.join(rootDir, 'js/wali-kelas-jurnal.js'), 'utf8');
    const pageWaliContent = fs.readFileSync(path.join(rootDir, 'js/page-wali-kelas.js'), 'utf8');

    test('1. Endpoint POST /api/notify/jurnal-verification terdaftar pada router Cloudflare Worker', () => {
        expect(workerContent).toContain('path === "/api/notify/jurnal-verification" && method === "POST"');
        expect(workerContent).toContain('findHomeroomTeacherForClass(env, className)');
        expect(workerContent).toContain('createNotificationJob(env, authResult.user.uid,');
        expect(workerContent).toContain('executeTelegramFetch(');
    });

    test('2. Method notifyJurnalVerification terdefinisi pada js/cloudflare-client.js', () => {
        expect(cfClientContent).toContain('async notifyJurnalVerification({ className, startDateIso, endDateIso, weekLabel, status = \'verified\', verifiedByName = \'\', catatan = \'\' })');
        expect(cfClientContent).toContain("this.request('/api/notify/jurnal-verification'");
    });

    test('3. submitKepsekVerification di js/wali-kelas-jurnal.js memicu notifikasi pengesahan (status: verified)', () => {
        expect(waliJurnalContent).toContain('cfClient.notifyJurnalVerification({');
        expect(waliJurnalContent).toContain("status: 'verified'");
        expect(waliJurnalContent).toContain('verifiedByName: payload.verifiedByName');
        expect(waliJurnalContent).toContain('Notifikasi (Push & Telegram) telah dikirimkan ke Wali Kelas.');
    });

    test('4. cancelKepsekVerificationConfirm di js/wali-kelas-jurnal.js memicu notifikasi pembatalan (status: cancelled)', () => {
        expect(waliJurnalContent).toContain("status: 'cancelled'");
        expect(waliJurnalContent).toContain('Notifikasi pembatalan telah dikirimkan ke Wali Kelas.');
    });

    test('5. Worker menyusun URL Push Notification terarah ke tab jurnal rombel terkait', () => {
        expect(workerContent).toContain('safeUrl = `./wali-kelas.html?tab=jurnal&class=${encodeURIComponent(className)}`');
    });

    test('6. Worker mengimplementasikan pesan Telegram ringkas resmi dengan emoji dan catatan arahan', () => {
        expect(workerContent).toContain('✅ <b>[JURNAL MINGGUAN DISAHKAN]</b>');
        expect(workerContent).toContain('⚠️ <b>[PENGESAHAN JURNAL DIBATALKAN]</b>');
        expect(workerContent).toContain('Halo Bapak/Ibu Wali Kelas <b>${escapeTelegramHtml(className)}</b>');
        expect(workerContent).toContain('Catatan Arahan:');
    });

    test('7. Worker menerapkan deduplikasi anti-spam pada tabel notification_channel_log', () => {
        expect(workerContent).toContain("const dedupeKey = `jurnal_verif:${action}:${className}:${startDateIso}`;");
        expect(workerContent).toContain("channel = 'jurnal_verification' AND dedupe_key = ?");
    });

    test('8. Worker mengimplementasikan graceful fallback jika Telegram ID wali kelas belum tersedia', () => {
        // Cek bahwa jika telegramChatId tidak ditemukan, respon tetap success: true dan detail not_found
        expect(workerContent).toContain('chatId: telegramChatId ? "configured" : "not_found"');
    });

    test('9. checkUrlTab di js/page-wali-kelas.js mengenali query parameter class dan mengaktifkan kelas yang bersangkutan', () => {
        expect(pageWaliContent).toContain("const queryClass = urlParams.get('class');");
        expect(pageWaliContent).toContain("selectEl.dispatchEvent(new Event('change'));");
    });
});
