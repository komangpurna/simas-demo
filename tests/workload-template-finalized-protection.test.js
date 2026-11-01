/**
 * tests/workload-template-finalized-protection.test.js
 * ====================================================================
 * Test Suite: Proteksi Penerapan Template Rencana Kerja Terfinalisasi
 * Memvalidasi kepatuhan aturan bisnis:
 * 1. Tombol 'Terapkan Template' (#btn-apply-template) otomatis disembunyikan
 *    jika rencana kerja minggu itu sudah pernah difinalisasi/diajukan.
 * 2. Ketika rencana diubah kembali menjadi draf (reopen-plan), tombol
 *    tetap disembunyikan dan template tetap dilarang untuk diterapkan.
 * 3. Tombol 'Simpan Jadi Template' (#btn-save-as-template) tetap tersedia.
 * 4. Proteksi dua lapis: Backend Cloudflare D1 menolak tegas (HTTP 403).
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Proteksi Template Rencana Terfinalisasi', () => {
    const root = path.resolve(__dirname, '..');
    const eKinerjaHtml = fs.readFileSync(path.join(root, 'e-kinerja.html'), 'utf8');
    const pageBebanKerjaJs = fs.readFileSync(path.join(root, 'js', 'page-beban-kerja.js'), 'utf8');
    const workerJs = fs.readFileSync(path.join(root, 'cloudflare', 'worker.js'), 'utf8');

    // =================================================================
    // 1. ELEMEN DOM TOOLBAR RENCANA (e-kinerja.html)
    // =================================================================
    test('1. e-kinerja.html memuat elemen tombol toolbar rencana ber-ID (#btn-apply-template & #btn-save-as-template)', () => {
        expect(eKinerjaHtml).toContain('id="btn-apply-template"');
        expect(eKinerjaHtml).toContain('id="btn-save-as-template"');
        expect(eKinerjaHtml).toContain('window.workloadApplyTemplateModal()');
        expect(eKinerjaHtml).toContain('window.workloadSaveAsTemplateModal()');
    });

    // =================================================================
    // 2. KONTROL VISIBILITAS & GUARD FRONTEND (js/page-beban-kerja.js)
    // =================================================================
    test('2. updatePlanToolbarVisibility menyembunyikan #btn-apply-template jika rencana sudah pernah difinalisasi', () => {
        expect(pageBebanKerjaJs).toContain('btnApplyTemplate = el(\'btn-apply-template\')');
        expect(pageBebanKerjaJs).toContain('ver.submitted_at || [\'approved\', \'submitted\', \'needs_revision\'].includes(ver.status)');
        expect(pageBebanKerjaJs).toContain('btnApplyTemplate.classList.add(\'hidden\', \'!hidden\')');
        expect(pageBebanKerjaJs).toContain('btnApplyTemplate.style.display = \'none\'');
    });

    test('3. openApplyTemplateModal & confirmApplyTemplate memiliki guard pencegah pembukaan/eksekusi', () => {
        expect(pageBebanKerjaJs).toContain('Template tidak dapat diterapkan karena rencana kerja minggu ini sudah pernah difinalisasi.');
        expect(pageBebanKerjaJs).toContain('Penerapan template ditolak: Rencana kerja minggu ini sudah pernah difinalisasi.');
    });

    // =================================================================
    // 3. PROTEKSI SISI SERVER BACKEND D1 (cloudflare/worker.js)
    // =================================================================
    test('4. worker.js menolak eksekusi apply-template jika version.submitted_at sudah ada (HTTP 403)', () => {
        expect(workerJs).toContain('if (version.submitted_at)');
        expect(workerJs).toContain('Penerapan template ditolak: Rencana kerja minggu ini sudah pernah difinalisasi sebelumnya');
    });

    test('5. worker.js pada rute reopen-plan mempertahankan submitted_at (COALESCE) saat status kembali ke draf', () => {
        expect(workerJs).toContain('path === "/api/workload/reopen-plan"');
        expect(workerJs).toContain('submitted_at = COALESCE(submitted_at, datetime(\'now\'))');
    });

    // =================================================================
    // 4. SIMULASI LOGIKA HIDE/SHOW TOMBOL PADA BERBAGAI SIKLUS STATUS
    // =================================================================
    function shouldShowApplyTemplateButton(version) {
        if (!version) return true; // draf awal / belum ada versi
        const hasBeenFinalized = !!(version.submitted_at || ['approved', 'submitted', 'needs_revision'].includes(version.status));
        return !hasBeenFinalized;
    }

    test('6. Logika visibilitas tombol Terapkan Template: Benar pada seluruh siklus hidup rencana kerja', () => {
        // Kasus 1: Draf baru (belum pernah difinalisasi / submitted_at null) -> Tombol tampil
        expect(shouldShowApplyTemplateButton({ status: 'draft', submitted_at: null })).toBe(true);

        // Kasus 2: Rencana diajukan (submitted) -> Tombol sembunyi
        expect(shouldShowApplyTemplateButton({ status: 'submitted', submitted_at: '2026-10-10 08:00:00' })).toBe(false);

        // Kasus 3: Rencana disetujui mandiri / pimpinan (approved) -> Tombol sembunyi
        expect(shouldShowApplyTemplateButton({ status: 'approved', submitted_at: '2026-10-10 08:00:00' })).toBe(false);

        // Kasus 4: Rencana dikembalikan ke draf (reopen-plan) -> Tetap sembunyi karena submitted_at ada
        expect(shouldShowApplyTemplateButton({ status: 'draft', submitted_at: '2026-10-10 08:00:00' })).toBe(false);

        // Kasus 5: Rencana diminta revisi oleh Kepala Sekolah (needs_revision) -> Tombol sembunyi
        expect(shouldShowApplyTemplateButton({ status: 'needs_revision', submitted_at: '2026-10-10 08:00:00' })).toBe(false);
    });
});
