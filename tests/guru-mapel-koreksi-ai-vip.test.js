const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

describe('Portal Guru Mapel - Shortened Tabs & SIMAS VIP Koreksi AI Protection', () => {
    let dom;
    let document;
    let window;

    beforeEach(() => {
        const html = fs.readFileSync(path.join(__dirname, '../guru-mapel.html'), 'utf8');
        dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost' });
        document = dom.window.document;
        window = dom.window;
    });

    afterEach(() => {
        window.close();
    });

    test('1. Verifikasi nama-nama tab navigation telah diperpendek secara ringkas & presisi', () => {
        const tabPenilaian = document.getElementById('tab-guru-penilaian');
        const tabKehadiran = document.getElementById('tab-guru-kehadiran');
        const tabJurnal = document.getElementById('tab-guru-jurnal');
        const tabLms = document.getElementById('tab-guru-lms');
        const tabKoreksiAi = document.getElementById('tab-guru-koreksi-ai');

        expect(tabPenilaian).not.toBeNull();
        expect(tabPenilaian.textContent.trim()).toBe('Penilaian');

        expect(tabKehadiran).not.toBeNull();
        expect(tabKehadiran.textContent.trim()).toBe('Kehadiran');

        expect(tabJurnal).not.toBeNull();
        expect(tabJurnal.textContent.trim()).toBe('Jurnal');

        expect(tabLms).not.toBeNull();
        expect(tabLms.textContent.trim()).toBe('LMS');

        expect(tabKoreksiAi).not.toBeNull();
        expect(tabKoreksiAi.textContent).toContain('Koreksi AI');
        expect(tabKoreksiAi.textContent).toContain('VIP');
    });

    test('2. Verifikasi modal pemberitahuan eksklusif SIMAS VIP Koreksi AI tersedia (Anti-Nesting: Top-Level Sibling)', () => {
        const modal = document.getElementById('modal-koreksi-ai-vip-notice');
        expect(modal).not.toBeNull();
        expect(modal.classList.contains('hidden')).toBe(true);

        // Verifikasi berada di luar <main> (top-level sibling)
        const main = document.querySelector('main');
        expect(main.contains(modal)).toBe(false);

        // Verifikasi konten modal notice
        expect(modal.textContent).toContain('SIMAS VIP');
        expect(modal.textContent).toContain('Koreksi Asesmen Siswa Berbasis AI');
        expect(modal.textContent).toContain('Akses terbatas dan dalam tahap pengembangan.');

        const closeBtn = modal.querySelector('button[onclick*="closeKoreksiAiVipModal"]');
        expect(closeBtn).not.toBeNull();
        expect(closeBtn.textContent).toContain('Mengerti');
    });

    test('3. Logika canAccessKoreksiAi membatasi akses hanya untuk Super Admin & Kepala Sekolah', () => {
        const jsSource = fs.readFileSync(path.join(__dirname, '../js/page-guru-mapel.js'), 'utf8');

        // Evaluasi helper canAccessKoreksiAi di window JSDOM
        const canAccessMatch = jsSource.match(/export function canAccessKoreksiAi\(\) \{[\s\S]*?\n\}/);
        expect(canAccessMatch).not.toBeNull();
        window.eval(`
            let currentUserDocData = null;
            ${canAccessMatch[0].replace('export function', 'function')}
            window.canAccessKoreksiAi = canAccessKoreksiAi;
            window.setCurrentTestDocData = (data) => { currentUserDocData = data; };
        `);

        // Skenario 1: Guru umum tanpa role khusus -> Ditolak (false)
        window.hasRole = (role) => false;
        window.localStorage.removeItem('user_role');
        window.setCurrentTestDocData({ role: 'guru' });
        expect(window.canAccessKoreksiAi()).toBe(false);

        // Skenario 2: Guru dengan role super_admin -> Diterima (true)
        window.hasRole = (role) => role === 'super_admin';
        expect(window.canAccessKoreksiAi()).toBe(true);

        // Skenario 3: Guru dengan role kepala_sekolah -> Diterima (true)
        window.hasRole = (role) => role === 'kepala_sekolah';
        expect(window.canAccessKoreksiAi()).toBe(true);

        // Skenario 4: Role lain (wakasek_kurikulum / wali_kelas) -> Ditolak (false)
        window.hasRole = (role) => role === 'wakasek_kurikulum';
        expect(window.canAccessKoreksiAi()).toBe(false);
    });

    test('4. switchGuruMapelTab menghentikan pergantian tab & memunculkan modal VIP saat diakses guru umum', () => {
        const jsSource = fs.readFileSync(path.join(__dirname, '../js/page-guru-mapel.js'), 'utf8');

        // Setup mock helper fungsi
        window.eval(`
            let currentUserDocData = { role: 'guru' };
            ${jsSource.match(/export function canAccessKoreksiAi\(\) \{[\s\S]*?\n\}/)[0].replace('export function', 'function')}
            ${jsSource.match(/export function openKoreksiAiVipModal\(\) \{[\s\S]*?\n\}/)[0].replace('export function', 'function')}
            ${jsSource.match(/export function closeKoreksiAiVipModal\(\) \{[\s\S]*?\n\}/)[0].replace('export function', 'function')}
            ${jsSource.match(/window\.switchGuruMapelTab = function \(tabName\) \{[\s\S]*?\n\};/)[0]}
        `);

        window.hasRole = () => false;
        window.localStorage.removeItem('user_role');

        const modal = document.getElementById('modal-koreksi-ai-vip-notice');
        const panelKoreksiAi = document.getElementById('panel-koreksi-ai');

        // Awalnya di tab penilaian
        expect(modal.classList.contains('hidden')).toBe(true);

        // Guru umum mencoba beralih ke tab koreksi-ai
        window.switchGuruMapelTab('koreksi-ai');

        // Modal VIP notice wajib terbuka
        expect(modal.classList.contains('hidden')).toBe(false);

        // Panel Koreksi AI tetap tersembunyi
        expect(panelKoreksiAi.classList.contains('hidden')).toBe(true);

        // Tombol Tutup / Mengerti menyembunyikan kembali modal
        window.closeKoreksiAiVipModal();
        expect(modal.classList.contains('hidden')).toBe(true);
    });

    test('5. canAccessKoreksiAi mengizinkan akses jika konfigurasi VIP dinamis aktif', () => {
        const jsSource = fs.readFileSync(path.join(__dirname, '../js/page-guru-mapel.js'), 'utf8');

        window.eval(`
            let currentUserDocData = { role: 'guru', linkedTeacherId: '101' };
            let _koreksiAiVipConfig = null;
            let currentTeacherId = '101';
            let auth = { currentUser: { uid: 'uid_test_123' } };
            ${jsSource.match(/export function canAccessKoreksiAi\(\) \{[\s\S]*?\n\}/)[0].replace('export function', 'function')}
            window.canAccessKoreksiAi = canAccessKoreksiAi;
            window.setVipConfigForTest = (cfg) => {
                _koreksiAiVipConfig = cfg;
                window._koreksiAiVipConfig = cfg;
            };
        `);

        window.hasRole = () => false;
        window.localStorage.removeItem('user_role');

        // Skenario A: Default (null config) -> Ditolak (false)
        window.setVipConfigForTest(null);
        expect(window.canAccessKoreksiAi()).toBe(false);

        // Skenario B: all_teachers: true -> Diterima (true)
        window.setVipConfigForTest({ all_teachers: true });
        expect(window.canAccessKoreksiAi()).toBe(true);

        // Skenario C: teacher_id terdaftar di allowed_teacher_ids -> Diterima (true)
        window.setVipConfigForTest({ all_teachers: false, allowed_teacher_ids: ['101', '102'] });
        expect(window.canAccessKoreksiAi()).toBe(true);

        // Skenario D: teacher_id tidak terdaftar di allowed_teacher_ids -> Ditolak (false)
        window.setVipConfigForTest({ all_teachers: false, allowed_teacher_ids: ['999'] });
        expect(window.canAccessKoreksiAi()).toBe(false);

        // Skenario E: uid terdaftar di allowed_uids -> Diterima (true)
        window.setVipConfigForTest({ all_teachers: false, allowed_teacher_ids: [], allowed_uids: ['uid_test_123'] });
        expect(window.canAccessKoreksiAi()).toBe(true);
    });
});
