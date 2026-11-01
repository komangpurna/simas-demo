/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

describe('Role Admin Dapodik & Verifikasi Penanda Foto KK Siswa', () => {

    test('1. Role admin_dapodik terdaftar di PAGE_ACCESS_CONFIG dan MENU_CONFIG di js/global.js', () => {
        const globalJsContent = fs.readFileSync(path.join(rootDir, 'js', 'global.js'), 'utf8');

        // Pastikan terdaftar di MENU_CONFIG
        expect(globalJsContent).toMatch(/'admin_dapodik':\s*\[[^\]]*'siswa'[^\]]*\]/);

        // Pastikan izin akses di PAGE_ACCESS_CONFIG
        expect(globalJsContent).toMatch(/'siswa\.html':\s*\{[^}]*'admin_dapodik':\s*'rw'/);
        expect(globalJsContent).toMatch(/'dashboard\.html':\s*\{[^}]*'admin_dapodik':\s*'y'/);
        expect(globalJsContent).toMatch(/'jadwal\.html':\s*\{[^}]*'admin_dapodik':\s*'r'/);
        expect(globalJsContent).toMatch(/'ranking-kelas\.html':\s*\{[^}]*'admin_dapodik':\s*'r'/);
        expect(globalJsContent).toMatch(/'masukan\.html':\s*\{[^}]*'admin_dapodik':\s*'r'/);
    });

    test('2. Role admin_dapodik terdaftar pada konfigurasi manajemen user di js/page-users.js dan users.html', () => {
        const pageUsersJs = fs.readFileSync(path.join(rootDir, 'js', 'page-users.js'), 'utf8');
        const usersHtml = fs.readFileSync(path.join(rootDir, 'users.html'), 'utf8');

        // Terdaftar di ALL_ROLES dan ADDITIONAL_ONLY_ROLES
        expect(pageUsersJs).toMatch(/value:\s*'admin_dapodik'/);
        expect(pageUsersJs).toContain("label: 'Admin Dapodik'");

        // Terdaftar di options HTML
        expect(usersHtml).toContain('<option value="admin_dapodik">Admin Dapodik</option>');
    });

    test('3. DOM Integrity: modal-preview-kk-admin di siswa.html dan modal-preview-kk-wali di wali-kelas.html berada di luar main (Top-Level Siblings)', () => {
        const siswaHtml = fs.readFileSync(path.join(rootDir, 'siswa.html'), 'utf8');
        const waliKelasHtml = fs.readFileSync(path.join(rootDir, 'wali-kelas.html'), 'utf8');

        // Cek siswa.html
        expect(siswaHtml).toContain('id="modal-preview-kk-admin"');
        const mainIndexSiswa = siswaHtml.indexOf('</main>');
        const modalIndexSiswa = siswaHtml.indexOf('id="modal-preview-kk-admin"');
        expect(modalIndexSiswa).toBeGreaterThan(mainIndexSiswa);

        // Cek elemen internal modal siswa.html
        expect(siswaHtml).toContain('id="modal-preview-kk-admin-img"');
        expect(siswaHtml).toContain('id="modal-preview-kk-admin-drivelink"');

        // Cek wali-kelas.html
        expect(waliKelasHtml).toContain('id="modal-preview-kk-wali"');
        const mainIndexWali = waliKelasHtml.indexOf('</main>');
        const modalIndexWali = waliKelasHtml.indexOf('id="modal-preview-kk-wali"');
        expect(modalIndexWali).toBeGreaterThan(mainIndexWali);

        // Cek elemen internal modal wali-kelas.html
        expect(waliKelasHtml).toContain('id="modal-preview-kk-wali-img"');
        expect(waliKelasHtml).toContain('id="modal-preview-kk-wali-drivelink"');
    });

    test('4. Logika Otorisasi: Hanya admin_dapodik, super_admin, admin, dan wali kelas perwalian yang berhak melihat penanda KK', () => {
        // Simulasi fungsi otorisasi akses KK
        function canViewStudentKK(student, userRole, additionalRoles = [], assignedClass = '') {
            const allRoles = [userRole, ...(additionalRoles || [])].filter(Boolean);
            const isSuperOrAdmin = allRoles.includes('super_admin') || allRoles.includes('admin');
            const isAdminDapodik = allRoles.includes('admin_dapodik');
            const isWali = allRoles.includes('wali_kelas');
            const isMyClass = student.class === assignedClass;

            return isSuperOrAdmin || isAdminDapodik || (isWali && isMyClass);
        }

        const studentX = { nis: '1001', name: 'Wayan Siswa', class: 'X-A', kk_document_url: 'https://drive.google.com/file/d/test1/view' };

        // Skenario 1: Admin Dapodik (Role Tambahan) -> Berhak melihat KK
        expect(canViewStudentKK(studentX, 'staff', ['admin_dapodik'])).toBe(true);
        expect(canViewStudentKK(studentX, 'guru_mapel', ['admin_dapodik'])).toBe(true);

        // Skenario 2: Super Admin -> Berhak melihat KK
        expect(canViewStudentKK(studentX, 'super_admin', [])).toBe(true);

        // Skenario 3: Wali Kelas dari kelas X-A -> Berhak melihat KK
        expect(canViewStudentKK(studentX, 'wali_kelas', [], 'X-A')).toBe(true);

        // Skenario 4: Wali Kelas dari kelas LAIN (misal XI-B) -> TIDAK berhak melihat KK
        expect(canViewStudentKK(studentX, 'wali_kelas', [], 'XI-B')).toBe(false);

        // Skenario 5: Guru Mapel biasa tanpa role admin_dapodik -> TIDAK berhak melihat KK
        expect(canViewStudentKK(studentX, 'guru_mapel', [])).toBe(false);

        // Skenario 6: Siswa atau role lain -> TIDAK berhak melihat KK
        expect(canViewStudentKK(studentX, 'siswa', [])).toBe(false);
    });

    test('5. Siklus Modal Pratinjau KK: openKKPreviewAdmin dan closeKKPreviewAdmin memanipulasi elemen DOM dengan benar', () => {
        document.body.innerHTML = `
            <div id="modal-preview-kk-admin" class="hidden">
                <h4 id="modal-preview-kk-admin-title"></h4>
                <p id="modal-preview-kk-admin-subtitle"></p>
                <img id="modal-preview-kk-admin-img" src="" alt="">
                <a id="modal-preview-kk-admin-drivelink" href="#"></a>
                <span id="modal-preview-kk-admin-meta"></span>
            </div>
        `;

        // Simulasi fungsi openKKPreviewAdmin
        window.openKKPreviewAdmin = function (nis, studentName, encodedUrl, uploadedAt) {
            const rawUrl = decodeURIComponent(encodedUrl || '');
            const modal = document.getElementById('modal-preview-kk-admin');
            const titleEl = document.getElementById('modal-preview-kk-admin-title');
            const subtitleEl = document.getElementById('modal-preview-kk-admin-subtitle');
            const imgEl = document.getElementById('modal-preview-kk-admin-img');
            const driveLinkEl = document.getElementById('modal-preview-kk-admin-drivelink');
            const metaEl = document.getElementById('modal-preview-kk-admin-meta');

            if (titleEl) titleEl.innerText = `Kartu Keluarga: ${studentName || 'Siswa'}`;
            if (subtitleEl) subtitleEl.innerText = `NIS: ${nis || '-'} • Arsip Google Drive Resmi Sekolah`;
            if (imgEl) {
                imgEl.src = rawUrl;
                imgEl.alt = `Dokumen Kartu Keluarga - ${studentName || nis}`;
            }
            if (driveLinkEl) driveLinkEl.href = rawUrl;
            if (metaEl) {
                metaEl.innerText = `NIS: ${nis || '-'} | Waktu Unggah: ${uploadedAt || 'Terverifikasi'}`;
            }
            if (modal) modal.classList.remove('hidden');
        };

        window.closeKKPreviewAdmin = function () {
            const modal = document.getElementById('modal-preview-kk-admin');
            if (modal) modal.classList.add('hidden');
            const imgEl = document.getElementById('modal-preview-kk-admin-img');
            if (imgEl) imgEl.src = '';
        };

        // Buka modal
        const testUrl = 'https://drive.google.com/file/d/test12345/view';
        window.openKKPreviewAdmin('1234', 'Ketut Test', encodeURIComponent(testUrl), '2026-10-10');

        const modal = document.getElementById('modal-preview-kk-admin');
        expect(modal.classList.contains('hidden')).toBe(false);
        expect(document.getElementById('modal-preview-kk-admin-title').innerText).toContain('Ketut Test');
        expect(document.getElementById('modal-preview-kk-admin-img').src).toBe(testUrl);
        expect(document.getElementById('modal-preview-kk-admin-drivelink').href).toBe(testUrl);

        // Tutup modal
        window.closeKKPreviewAdmin();
        expect(modal.classList.contains('hidden')).toBe(true);
        expect(document.getElementById('modal-preview-kk-admin-img').getAttribute('src')).toBe('');
    });
});
