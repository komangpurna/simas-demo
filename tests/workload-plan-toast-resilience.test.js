/**
 * Unit Test: Ketahanan & Kejelasan Pesan Toast Rencana Kerja E-Kinerja Guru
 * Memverifikasi durasi toast yang cukup panjang (>= 10-12 detik) dan pesan yang ramah,
 * jelas, solutif, serta transparan terhadap respons galat backend sesuai mandat SSOT.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Ketahanan Toast & Pesan Galat Rencana Kerja E-Kinerja Guru', () => {
    const root = path.resolve(__dirname, '..');
    const pageBebanKerjaPath = path.join(root, 'js', 'page-beban-kerja.js');
    const globalJsPath = path.join(root, 'js', 'global.js');

    const pageBebanKerjaContent = fs.readFileSync(pageBebanKerjaPath, 'utf8');
    const globalJsContent = fs.readFileSync(globalJsPath, 'utf8');

    test('1. global.js window.showToast mendukung durasi adaptif lebih panjang untuk error (10 detik) dan warning (7 detik)', () => {
        expect(globalJsContent).toContain("error: 10000");
        expect(globalJsContent).toContain("warning: 7000");
        expect(globalJsContent).toContain("break-words");
    });

    test('2. page-beban-kerja.js showToast mendukung durasi minimal 12 detik untuk error dan 8 detik untuk warning', () => {
        expect(pageBebanKerjaContent).toContain("if (type === 'error') defaultDuration = 12000;");
        expect(pageBebanKerjaContent).toContain("else if (type === 'warning') defaultDuration = 8000;");
    });

    test('3. page-beban-kerja.js memiliki fungsi helper formatSavePlanErrorMessage dan formatPlanOverlapMessage', () => {
        expect(pageBebanKerjaContent).toContain('export function formatSavePlanErrorMessage(err)');
        expect(pageBebanKerjaContent).toContain('export function formatPlanOverlapMessage(overlapCheck, item)');
    });

    test('4. formatSavePlanErrorMessage menangani kasus error 409, benturan waktu, jaringan, dan status lock dengan bahasa ramah', () => {
        // Ekstrak logika formatSavePlanErrorMessage dan evaluasi
        const match = pageBebanKerjaContent.match(/export function formatSavePlanErrorMessage\(err\) \{([\s\S]*?)\n\}/);
        expect(match).not.toBeNull();
        const fnBody = match[1];
        const formatFn = new Function('err', fnBody);

        // Kasus 409 / Concurrency
        const msg409 = formatFn(new Error('Data rencana telah diperbarui oleh sesi lain. Silakan muat ulang halaman sebelum menyimpan perubahan.'));
        expect(msg409).toContain('Data rencana kerja telah diperbarui di sesi atau perangkat lain');

        // Kasus Benturan waktu
        const msgOverlap = formatFn(new Error('Benturan jam kerja terdeteksi: 07:30-09:00 bertumpuk dengan 08:00-09:30'));
        expect(msgOverlap).toContain('Jadwal kegiatan bertabrakan!');
        expect(msgOverlap).toContain('07:30-09:00 bertumpuk dengan 08:00-09:30');

        // Kasus Jaringan putus
        const msgNetwork = formatFn(new Error('Failed to fetch'));
        expect(msgNetwork).toContain('Koneksi internet Anda terputus');

        // Kasus Kunci
        const msgLocked = formatFn(new Error('Minggu kerja telah dikunci oleh pimpinan'));
        expect(msgLocked).toContain('Minggu kerja telah dikunci oleh pimpinan sekolah');

        // Kasus Akses ditolak
        const msgForbidden = formatFn(new Error('Akses ditolak: Anda hanya dapat menyunting rencana kerja Anda sendiri'));
        expect(msgForbidden).toContain('Akses ditolak');
    });

    test('5. formatPlanOverlapMessage menghasilkan pesan informatif memuat nama kegiatan dan jam bertumpuk', () => {
        const match = pageBebanKerjaContent.match(/export function formatPlanOverlapMessage\(overlapCheck, item\) \{([\s\S]*?)\n\}/);
        expect(match).not.toBeNull();
        const fnBody = match[1];
        const formatOverlapFn = new Function('overlapCheck', 'item', fnBody);

        const check = {
            conflictingSegment: {
                activity_title: 'KBM Matematika',
                start_time: '08:00',
                end_time: '09:30'
            }
        };
        const item = { start_time: '07:30', end_time: '08:30' };

        const res = formatOverlapFn(check, item);
        expect(res).toContain('Jadwal Bertabrakan!');
        expect(res).toContain('07:30 - 08:30');
        expect(res).toContain('KBM Matematika');
        expect(res).toContain('08:00 - 09:30');
    });

    test('6. savePlanItem menggunakan formatSavePlanErrorMessage dan durasi 12 detik pada catch block', () => {
        expect(pageBebanKerjaContent).toContain("showToast(friendlyMsg, 'error', 12000, 'Gagal Menyimpan Rencana');");
    });
});
