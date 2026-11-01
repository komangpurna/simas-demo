/**
 * tests/photo-caption-fullview.test.js
 * ====================================================================
 * Test Suite: Integritas Input Caption Foto Multi-Line (Full-View Textarea)
 * pada Modal Input Aktivitas/Realisasi & Drawer Cetak Rekap (Guru & Tendik)
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Input Caption Foto Multi-Line & Anti-Overlapping', () => {
    const root = path.resolve(__dirname, '..');
    const teacherJsPath = path.join(root, 'js', 'page-beban-kerja.js');
    const tendikJsPath = path.join(root, 'js', 'page-e-kinerja-tendik.js');
    const agendaJsPath = path.join(root, 'js', 'page-agenda-pegawai.js');

    const teacherJs = fs.readFileSync(teacherJsPath, 'utf8');
    const tendikJs = fs.readFileSync(tendikJsPath, 'utf8');
    const agendaJs = fs.readFileSync(agendaJsPath, 'utf8');

    describe('1. Verifikasi Modal Realisasi Guru (js/page-beban-kerja.js)', () => {
        test('renderEvidencePhotosGrid menggunakan <textarea rows="2"> multi-line auto-wrap', () => {
            expect(teacherJs).toContain('<textarea');
            expect(teacherJs).toMatch(/<textarea[\s\S]*?rows="2"[\s\S]*?data-photo-caption-index="\$\{idx\}"/);
            expect(teacherJs).toContain('oninput="window.workloadUpdatePhotoCaption(${idx}, this.value)"');
            expect(teacherJs).toContain('resize-none');
            expect(teacherJs).toContain('overflow-y-auto');
        });

        test('workloadUpdatePhotoCaption terdefinisi dan terekspos ke window', () => {
            expect(teacherJs).toContain('export function workloadUpdatePhotoCaption(index, captionText)');
            expect(teacherJs).toContain('window.workloadUpdatePhotoCaption = workloadUpdatePhotoCaption;');
        });

        test('Drawer Cetak Rekap Guru menggunakan <textarea rows="2"> untuk edit caption cetak', () => {
            expect(teacherJs).toMatch(/<textarea[\s\S]*?rows="2"[\s\S]*?workloadUpdateRekapPrintPhotoCaption/);
            expect(teacherJs).toContain('oninput="window.workloadUpdateRekapPrintPhotoCaption(');
            expect(teacherJs).toContain('export function workloadUpdateRekapPrintPhotoCaption(');
        });

        test('UI Compliance: Icon ditempatkan pada <label> di luar textarea (Anti-Overlapping) & font compact', () => {
            expect(teacherJs).toContain('<label class="text-[9px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">');
            expect(teacherJs).toContain('<i class="fa-regular fa-comment-dots text-purple-500 text-[9px]"></i>');
            expect(teacherJs).toContain('text-[10px]');
            expect(teacherJs).toContain('leading-snug');
        });
    });

    describe('2. Verifikasi Modal Aktivitas Tendik (js/page-e-kinerja-tendik.js)', () => {
        test('renderActivityPhotosGrid menggunakan <textarea rows="2"> multi-line auto-wrap', () => {
            expect(tendikJs).toContain('<textarea');
            expect(tendikJs).toMatch(/<textarea[\s\S]*?rows="2"[\s\S]*?data-photo-caption-index="\$\{idx\}"/);
            expect(tendikJs).toContain('oninput="window.updateActivityPhotoCaption(${idx}, this.value)"');
            expect(tendikJs).toContain('resize-none');
            expect(tendikJs).toContain('overflow-y-auto');
        });

        test('updateActivityPhotoCaption terdefinisi dan terekspos ke window', () => {
            expect(tendikJs).toContain('export function updateActivityPhotoCaption(index, captionText)');
            expect(tendikJs).toContain('window.updateActivityPhotoCaption = updateActivityPhotoCaption;');
        });

        test('Fungsi saveActivity menyimpan properti caption ke dalam bukti_url', () => {
            expect(tendikJs).toContain('caption: (p.caption || \'\').trim()');
        });

        test('Drawer Cetak Rekap Tendik menggunakan <textarea rows="2"> untuk edit caption cetak', () => {
            expect(tendikJs).toMatch(/<textarea[\s\S]*?rows="2"[\s\S]*?updateEmployeeButirPhotoCaption/);
            expect(tendikJs).toContain('oninput="window.updateEmployeeButirPhotoCaption(');
            expect(tendikJs).toContain('export function updateEmployeeButirPhotoCaption(');
            expect(tendikJs).toContain('window.updateEmployeeButirPhotoCaption = updateEmployeeButirPhotoCaption;');
        });
    });

    describe('3. Verifikasi Modal Agenda Pegawai Tendik (js/page-agenda-pegawai.js)', () => {
        test('renderActivityPhotosGrid menggunakan <textarea rows="2"> multi-line auto-wrap', () => {
            expect(agendaJs).toContain('<textarea');
            expect(agendaJs).toMatch(/<textarea[\s\S]*?rows="2"[\s\S]*?data-photo-caption-index="\$\{idx\}"/);
            expect(agendaJs).toContain('oninput="window.updateActivityPhotoCaption(${idx}, this.value)"');
            expect(agendaJs).toContain('resize-none');
            expect(agendaJs).toContain('overflow-y-auto');
        });

        test('updateActivityPhotoCaption terdefinisi dan terekspos ke window', () => {
            expect(agendaJs).toContain('export function updateActivityPhotoCaption(index, captionText)');
            expect(agendaJs).toContain('window.updateActivityPhotoCaption = updateActivityPhotoCaption;');
        });

        test('Fungsi saveActivity di agenda-pegawai menyimpan properti caption ke dalam bukti_url', () => {
            expect(agendaJs).toContain('caption: (p.caption || \'\').trim()');
        });
    });
});
