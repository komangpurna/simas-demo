/**
 * Unit Test: Pengembalian Rencana Kerja ke Draf (Reopen Plan to Draft & Editing Lifecycle)
 * Memverifikasi kemampuan guru dan pengelola untuk mengembalikan rencana kerja
 * yang telah disahkan (Mandiri/Kepala Sekolah) atau diajukan kembali ke status draf untuk disunting dan disahkan lagi.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Siklus Hidup Pengembalian Rencana Kerja ke Draf (Reopen Plan Lifecycle)', () => {
    const root = path.resolve(__dirname, '..');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');
    const clientJsPath = path.join(root, 'js', 'cloudflare-client.js');
    const pageBebanKerjaJsPath = path.join(root, 'js', 'page-beban-kerja.js');
    const eKinerjaHtmlPath = path.join(root, 'e-kinerja.html');

    const workerContent = fs.readFileSync(workerJsPath, 'utf8');
    const clientContent = fs.readFileSync(clientJsPath, 'utf8');
    const pageBebanKerjaContent = fs.readFileSync(pageBebanKerjaJsPath, 'utf8');
    const eKinerjaHtmlContent = fs.readFileSync(eKinerjaHtmlPath, 'utf8');

    test('1. Endpoint POST /api/workload/reopen-plan terdaftar di cloudflare/worker.js', () => {
        expect(workerContent).toContain('path === "/api/workload/reopen-plan" && method === "POST"');
        expect(workerContent).toContain('REOPEN_PLAN_TO_DRAFT');
        expect(workerContent).toContain("UPDATE weekly_plan_versions");
        expect(workerContent).toContain("SET status = 'draft'");
    });

    test('2. Endpoint reopen-plan memverifikasi token Firebase Auth (ASVS Level 2)', () => {
        const reopenSection = workerContent.slice(workerContent.indexOf('path === "/api/workload/reopen-plan"'));
        expect(reopenSection).toContain('verifyFirebaseToken');
        expect(reopenSection).toContain('Unauthorized');
    });

    test('3. Endpoint reopen-plan menolak akses pihak yang bukan pemilik dan bukan pengelola (OWASP A01: Broken Access Control)', () => {
        const reopenSection = workerContent.slice(workerContent.indexOf('path === "/api/workload/reopen-plan"'));
        expect(reopenSection).toMatch(/!isMgr\s*&&\s*!isWorkloadOwner/);
        expect(reopenSection).toContain('Akses ditolak: Anda hanya dapat mengubah rencana kerja milik Anda sendiri');
    });

    test('4. Endpoint reopen-plan menolak perubahan jika minggu kerja telah dikunci oleh pimpinan (is_locked === 1)', () => {
        const reopenSection = workerContent.slice(workerContent.indexOf('path === "/api/workload/reopen-plan"'));
        expect(reopenSection).toContain('version.is_locked === 1');
        expect(reopenSection).toContain('Minggu kerja telah dikunci oleh pimpinan');
    });

    test('5. Endpoint reopen-plan menerima perubahan dari status approved dan submitted ke draft', () => {
        const reopenSection = workerContent.slice(workerContent.indexOf('path === "/api/workload/reopen-plan"'));
        expect(reopenSection).toContain('["approved", "submitted", "needs_revision"].includes(version.status)');
        expect(reopenSection).toContain('Rencana kerja berhasil dikembalikan ke status draf');
    });

    test('6. Fungsi klien cfReopenWorkloadPlan diekspor pada js/cloudflare-client.js dan terdaftar di window', () => {
        expect(clientContent).toContain('export async function cfReopenWorkloadPlan(payload)');
        expect(clientContent).toContain("cfFetch('/api/workload/reopen-plan'");
        expect(clientContent).toContain('window.cfReopenWorkloadPlan = cfReopenWorkloadPlan;');
    });

    test('7. e-kinerja.html memiliki banner status #plan-status-banner dan tombol aksi #btn-reopen-plan', () => {
        expect(eKinerjaHtmlContent).toContain('id="plan-status-banner"');
        expect(eKinerjaHtmlContent).toContain('id="btn-reopen-plan"');
        expect(eKinerjaHtmlContent).toContain('window.workloadReopenPlan()');
        expect(eKinerjaHtmlContent).toContain('Ubah ke Draf (Edit Rencana)');
    });

    test('8. js/page-beban-kerja.js mengimplementasikan reopenPlan dengan dialog konfirmasi dan loading state', () => {
        expect(pageBebanKerjaContent).toContain('async function reopenPlan()');
        expect(pageBebanKerjaContent).toContain('cfReopenWorkloadPlan');
        expect(pageBebanKerjaContent).toContain('window.workloadReopenPlan = reopenPlan;');
        expect(pageBebanKerjaContent).toContain('_isReopeningPlan');
    });

    test('9. updateSubmitButton mengelola #plan-status-banner dan #btn-reopen-plan saat rencana berstatus approved atau submitted', () => {
        expect(pageBebanKerjaContent).toContain("['approved', 'submitted'].includes(ver.status)");
        expect(pageBebanKerjaContent).toContain("btnReopen.classList.remove('hidden')");
        expect(pageBebanKerjaContent).toContain("btnSubmit.classList.add('hidden')");
    });

    test('10. updateSubmitButton dan renderPlanTab menyajikan banner informatif status rencana difinalisasi/disetujui dan tombol tunggal ubah ke draf', () => {
        expect(pageBebanKerjaContent).toMatch(/Rencana Kerja Telah (Difinalisasi|Disetujui)/);
        expect(pageBebanKerjaContent).toContain('Ubah ke Draf (Edit Rencana)');
        expect(pageBebanKerjaContent).toContain('Ingin menambah, mengubah jam, atau menyesuaikan kegiatan? Anda dapat mengembalikan rencana ke draf kapan saja.');
        expect(pageBebanKerjaContent).toContain('updateSubmitButton();');
    });
});
