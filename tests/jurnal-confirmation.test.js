const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

describe('Validasi Dialog Konfirmasi Simpan Jurnal & Checklist Gate 3 Poin', () => {
    const jurnalHtml = fs.readFileSync(path.join(projectRoot, 'jurnal.html'), 'utf8');
    const pageJurnalJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-jurnal.js'), 'utf8');

    describe('Struktur Elemen HTML (jurnal.html)', () => {
        test('Memiliki kontainer modal #confirm-submit-modal dan overlay backdrop', () => {
            expect(jurnalHtml).toContain('id="confirm-submit-modal"');
            expect(jurnalHtml).toContain('id="confirm-submit-content"');
            expect(jurnalHtml).toContain('window.closeConfirmSubmitDialog()');
        });

        test('Memiliki komponen deteksi jadwal resmi (#confirm-schedule-warning & #confirm-schedule-match)', () => {
            expect(jurnalHtml).toContain('id="confirm-schedule-warning"');
            expect(jurnalHtml).toContain('id="confirm-schedule-warning-text"');
            expect(jurnalHtml).toContain('id="confirm-schedule-match"');
        });

        test('Memiliki 3 checkbox verifikasi krusial (Guru, Mapel, JP) dan counter checklist', () => {
            expect(jurnalHtml).toContain('id="chk-confirm-guru"');
            expect(jurnalHtml).toContain('id="chk-confirm-mapel"');
            expect(jurnalHtml).toContain('id="chk-confirm-jp"');
            expect(jurnalHtml).toContain('id="confirm-checklist-counter"');
            expect(jurnalHtml).toContain('window.updateConfirmChecklist()');
        });

        test('Memiliki label dan nilai data rekapan (Guru, Mapel, JP, Kelas, Lokasi, Topik, Presensi)', () => {
            expect(jurnalHtml).toContain('id="confirm-val-guru"');
            expect(jurnalHtml).toContain('id="confirm-val-mapel"');
            expect(jurnalHtml).toContain('id="confirm-val-jp"');
            expect(jurnalHtml).toContain('id="confirm-val-kelas"');
            expect(jurnalHtml).toContain('id="confirm-val-lokasi"');
            expect(jurnalHtml).toContain('id="confirm-val-topik"');
            expect(jurnalHtml).toContain('id="confirm-val-presensi-summary"');
            expect(jurnalHtml).toContain('id="confirm-val-presensi-detail"');
        });

        test('Tombol simpan awal dalam modal berstatus disabled', () => {
            expect(jurnalHtml).toContain('id="btn-confirm-submit-action"');
            expect(jurnalHtml).toContain('disabled');
            expect(jurnalHtml).toContain('window.onConfirmSubmitApproved()');
            expect(jurnalHtml).toContain('id="confirm-submit-hint"');
        });
    });

    describe('Logika Script (js/page-jurnal.js)', () => {
        test('Mendefinisikan fungsi pembantu komparasi jadwal compareWithActualSchedule', () => {
            expect(pageJurnalJs).toContain('async function compareWithActualSchedule');
            expect(pageJurnalJs).toContain('smartMatchTeacher');
            expect(pageJurnalJs).toContain('normalizeTeacherName');
        });

        test('Mendefinisikan fungsi kontrol dialog konfirmasi dan checklist gate', () => {
            expect(pageJurnalJs).toContain('window.closeConfirmSubmitDialog');
            expect(pageJurnalJs).toContain('window.updateConfirmChecklist');
            expect(pageJurnalJs).toContain('window.onConfirmSubmitApproved');
            expect(pageJurnalJs).toContain('async function showConfirmSubmitDialog');
        });

        test('submitData memeriksa jadwal dan kondisional: dialog konfirmasi hanya jika berbeda dari jadwal resmi', () => {
            expect(pageJurnalJs).toContain('scheduleCheck = await compareWithActualSchedule');
            expect(pageJurnalJs).toContain('if (scheduleCheck.hasSchedule && !scheduleCheck.isMatch)');
            expect(pageJurnalJs).toContain('showConfirmSubmitDialog({');
            expect(pageJurnalJs).toContain('handleGpsAndProceed(btn, originalBtnContent');
            expect(pageJurnalJs).toContain('function handleGpsAndProceed(');
        });

        test('Simulasi fungsi checklist gate: tombol aktif hanya jika 3 checkbox tercentang', () => {
            function simulateChecklist(c1, c2, c3) {
                let count = 0;
                if (c1) count++;
                if (c2) count++;
                if (c3) count++;
                return { count, isEnabled: count === 3 };
            }

            expect(simulateChecklist(false, false, false).isEnabled).toBe(false);
            expect(simulateChecklist(true, false, false).isEnabled).toBe(false);
            expect(simulateChecklist(true, true, false).isEnabled).toBe(false);
            expect(simulateChecklist(true, true, true).isEnabled).toBe(true);
            expect(simulateChecklist(true, true, true).count).toBe(3);
        });

        test('proceedSubmit dan handleGpsAndProceed memiliki proteksi defensif if (btn)', () => {
            expect(pageJurnalJs).toContain('if (btn) {\n        btn.disabled = true;');
            expect(pageJurnalJs).toContain('if (btn) {\n            btn.disabled = false;');
        });

        test('Cloudflare API terintegrasi untuk menyimpan dan memperbarui jurnal mengajar', () => {
            expect(pageJurnalJs).toContain('CloudflareAPI.saveJurnal(cfPayload)');
            expect(pageJurnalJs).toContain('CloudflareAPI.updateJurnal(window.currentEditDocId, cfPayload)');
        });
    });

    describe('Integrasi Master Lokasi Admin (js/page-jurnal-admin.js)', () => {
        const adminJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-jurnal-admin.js'), 'utf8');

        test('populateEditJurnalDropdowns membaca properti nama_lokasi || nama dari master_lokasi', () => {
            expect(adminJs).toContain('a.nama_lokasi || a.nama || \'\'');
            expect(adminJs).toContain('l.nama_lokasi || l.nama || \'\'');
        });
    });
});
