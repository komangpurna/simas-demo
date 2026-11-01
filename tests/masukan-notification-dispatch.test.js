const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

describe('Modul Masukan & Laporan - Pengiriman Notifikasi Multi-Channel & Role Humas/Sarpras', () => {
    const workerContent = fs.readFileSync(path.join(rootDir, 'cloudflare/worker.js'), 'utf8');
    const globalContent = fs.readFileSync(path.join(rootDir, 'js/global.js'), 'utf8');
    const usersJsContent = fs.readFileSync(path.join(rootDir, 'js/page-users.js'), 'utf8');
    const masukanJsContent = fs.readFileSync(path.join(rootDir, 'js/page-masukan.js'), 'utf8');
    const cfClientContent = fs.readFileSync(path.join(rootDir, 'js/cloudflare-client.js'), 'utf8');
    const masukanHtmlContent = fs.readFileSync(path.join(rootDir, 'masukan.html'), 'utf8');
    const indexHtmlContent = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    const secureProxyContent = fs.readFileSync(path.join(rootDir, 'supabase/functions/secure-proxy/index.ts'), 'utf8');

    test('1. Pemetaan Multi-Target Tujuan Laporan Tepat Sasaran & Super Admin Selalu Menerima', () => {
        // Ekstrak fungsi resolveFeedbackTargetRoles langsung dari cloudflare/worker.js
        const funcMatch = workerContent.match(/function resolveFeedbackTargetRoles\(targetRecipient\) {([\s\S]*?)\n}/);
        expect(funcMatch).not.toBeNull();
        const resolveFeedbackTargetRoles = new Function('targetRecipient', funcMatch[1]);

        // Skenario 1: Super Admin / Tim IT (default)
        const resAdmin = resolveFeedbackTargetRoles('super_admin');
        expect(resAdmin).toContain('super_admin');
        expect(resAdmin).not.toContain('kepala_sekolah'); // kepala sekolah hanya jika dipilih

        // Skenario 2: Kepala Sekolah
        const resKepsek = resolveFeedbackTargetRoles('kepala_sekolah');
        expect(resKepsek).toContain('kepala_sekolah');
        expect(resKepsek).toContain('super_admin');

        // Skenario 3: Guru (Hanya guru, TU tidak dapat notif)
        const resGuru = resolveFeedbackTargetRoles('guru');
        expect(resGuru).toContain('guru');
        expect(resGuru).toContain('guru_mapel');
        expect(resGuru).toContain('super_admin');
        expect(resGuru).not.toContain('staff');

        // Skenario 4: TU / Tenaga Kependidikan (Hanya TU, Guru tidak dapat notif)
        const resStaff = resolveFeedbackTargetRoles('staff');
        expect(resStaff).toContain('staff');
        expect(resStaff).toContain('admin_spp');
        expect(resStaff).toContain('super_admin');
        expect(resStaff).not.toContain('guru');

        // Skenario 5: Multi-target (Guru dan TU dipilih bersamaan)
        const resMulti = resolveFeedbackTargetRoles(['guru', 'staff']);
        expect(resMulti).toContain('guru');
        expect(resMulti).toContain('staff');
        expect(resMulti).toContain('super_admin');

        // Skenario 6: Multi-target string koma ("guru,staff")
        const resComma = resolveFeedbackTargetRoles('guru,staff');
        expect(resComma).toContain('guru');
        expect(resComma).toContain('staff');
        expect(resComma).toContain('super_admin');

        // Skenario 7: Fallback jika input kosong / tidak dikenal
        const resFallback = resolveFeedbackTargetRoles('unknown_target');
        expect(resFallback).toEqual(['super_admin']);
    });

    test('2. Default Tujuan Laporan pada Form masukan.html dan index.html (Checkbox Popover) adalah super_admin', () => {
        // Pada masukan.html: Multi-select Popover dengan checkbox super_admin dicentang default
        expect(masukanHtmlContent).toMatch(/<input[^>]*type="checkbox"[^>]*name="feedback-target-cb"[^>]*value="super_admin"[^>]*checked/);
        expect(masukanHtmlContent).toContain('id="feedback-target"');

        // Pada index.html: Multi-select Popover dengan checkbox super_admin dicentang default
        expect(indexHtmlContent).toMatch(/<input[^>]*type="checkbox"[^>]*name="pub-target-cb"[^>]*value="super_admin"[^>]*checked/);
        expect(indexHtmlContent).toContain('id="pub-target"');
        // Pastikan opsi 'all' (Semua Pimpinan / Umum) telah dihapus dari sasaran
        expect(indexHtmlContent).not.toMatch(/name="pub-target-cb"[^>]*value="all"/);
        // Pastikan kategori 'Lainnya' terpilih sebagai default
        expect(indexHtmlContent).toMatch(/<option value="Lainnya" selected>Lainnya<\/option>/);
    });

    test('3. Role humas dan sarpras terdaftar di Manajemen User (ADDITIONAL_ONLY_ROLES)', () => {
        expect(usersJsContent).toContain("value: 'humas', label: 'Wakasek Humas'");
        expect(usersJsContent).toContain("value: 'sarpras', label: 'Wakasek Sarpras'");
    });

    test('4. Role humas dan sarpras terdaftar di MENU_CONFIG & PAGE_ACCESS_CONFIG global.js', () => {
        expect(globalContent).toContain("'humas': ['dashboard'");
        expect(globalContent).toContain("'sarpras': ['dashboard'");
        expect(globalContent).toContain("'humas': 'rw', 'sarpras': 'rw'");
    });

    test('5. Role humas dan sarpras terdaftar di MANAGER_ROLES & STAFF_AND_TEACHER_ROLES worker.js', () => {
        expect(workerContent).toMatch(/const MANAGER_ROLES = \[[^\]]*"humas"[^\]]*"sarpras"[^\]]*\];/);
        expect(workerContent).toMatch(/const STAFF_AND_TEACHER_ROLES = \[[^\]]*"humas"[^\]]*"sarpras"[^\]]*\];/);
    });

    test('6. Role humas dan sarpras diakui sebagai leadership di secure-proxy Supabase Edge Proxy', () => {
        expect(secureProxyContent).toContain('"super_admin", "kepala_sekolah", "kesiswaan", "wakasek_kurikulum", "kepala_lab", "humas", "sarpras"');
    });

    test('7. Endpoint POST /api/feedback/notify terdaftar di Cloudflare Worker', () => {
        expect(workerContent).toContain('path === "/api/feedback/notify" && method === "POST"');
        expect(workerContent).toContain('resolveFeedbackTargetRoles(targetRecipient)');
        expect(workerContent).toContain('createNotificationJob(env, authResult.user.uid');
        expect(workerContent).toContain('executeTelegramFetch(');
    });

    test('8. Method notifyNewFeedback tersedia di CloudflareClient js/cloudflare-client.js', () => {
        expect(cfClientContent).toContain('async notifyNewFeedback({');
        expect(cfClientContent).toContain("return await this.request('/api/feedback/notify'");
    });

    test('9. Pemicu notifyNewFeedback terpasang di saveFeedback (masukan.html) dan form publik (index.html)', () => {
        expect(masukanJsContent).toContain('cfClient.notifyNewFeedback({');
        expect(indexHtmlContent).toContain('cfClient.notifyNewFeedback({');
    });

    test('10. Eliminasi duplikasi fungsi submitInlineReply di page-masukan.js', () => {
        const matches = masukanJsContent.match(/window\.submitInlineReply\s*=/g);
        expect(matches).not.toBeNull();
        expect(matches.length).toBe(1);
    });
});
