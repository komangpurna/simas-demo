const fs = require('fs');
const path = require('path');

describe('Dashboard Perwalian - Integrasi Pasfoto Anak Asuh (Guru Wali & Wali Kelas)', () => {
    const rootDir = path.resolve(__dirname, '..');
    const guruWaliHtmlPath = path.join(rootDir, 'guru-wali.html');
    const waliKelasHtmlPath = path.join(rootDir, 'wali-kelas.html');
    const pageGuruWaliPath = path.join(rootDir, 'js/page-guru-wali.js');
    const pageWaliKelasPath = path.join(rootDir, 'js/page-wali-kelas.js');

    let guruWaliHtml;
    let waliKelasHtml;
    let pageGuruWaliCode;
    let pageWaliKelasCode;

    beforeAll(() => {
        guruWaliHtml = fs.readFileSync(guruWaliHtmlPath, 'utf8');
        waliKelasHtml = fs.readFileSync(waliKelasHtmlPath, 'utf8');
        pageGuruWaliCode = fs.readFileSync(pageGuruWaliPath, 'utf8');
        pageWaliKelasCode = fs.readFileSync(pageWaliKelasPath, 'utf8');
    });

    describe('1. Portal Guru Wali (js/page-guru-wali.js)', () => {
        test('menyinkronkan activePhotoUrl anak asuh dari SSOT students di updateMyStudentsWithSSOT()', () => {
            expect(pageGuruWaliCode).toContain('const photo = actualStudent.activePhotoUrl || actualStudent.active_photo_url || actualStudent.photoUrl || actualStudent.photo_url || actualStudent.foto || null;');
            expect(pageGuruWaliCode).toContain('s.activePhotoUrl = photo;');
        });

        test('merender avatar pasfoto anak asuh pada kartu siswa di renderStudentCards()', () => {
            expect(pageGuruWaliCode).toContain('cardAvatarHtml');
            expect(pageGuruWaliCode).toContain('s.activePhotoUrl');
            expect(pageGuruWaliCode).toContain('resolvePhotoUrl');
            expect(pageGuruWaliCode).toContain('${cardAvatarHtml}');
        });

        test('merender thumbnail pasfoto anak asuh pada mode tabel di renderStudentTable()', () => {
            expect(pageGuruWaliCode).toContain('tableAvatarHtml');
            expect(pageGuruWaliCode).toContain('${tableAvatarHtml}');
        });

        test('merender foto profil anak asuh pada header modal detail siswa', () => {
            expect(pageGuruWaliCode).toContain("document.getElementById('detail-avatar')");
            expect(pageGuruWaliCode).toContain('detail-avatar');
        });
    });

    describe('2. Portal Wali Kelas (js/page-wali-kelas.js)', () => {
        test('merender avatar pasfoto siswa pada Tab 1 (EWS Kedisiplinan & Ringkasan Perwalian)', () => {
            expect(pageWaliKelasCode).toContain('studentAvatarHtml');
            expect(pageWaliKelasCode).toContain('${studentAvatarHtml}');
        });

        test('merender avatar pasfoto siswa pada Tab 2 (Kartu Presensi Hari Ini)', () => {
            expect(pageWaliKelasCode).toContain('todayAvatarHtml');
            expect(pageWaliKelasCode).toContain('${todayAvatarHtml}');
        });

        test('merender avatar pasfoto siswa pada Tab 2 (Tabel Rekapitulasi Presensi)', () => {
            expect(pageWaliKelasCode).toContain('rekapAvatarHtml');
            expect(pageWaliKelasCode).toContain('${rekapAvatarHtml}');
        });

        test('merender avatar pasfoto siswa pada Tab 3 (Catatan Poin Pelanggaran, Prestasi & Permisi)', () => {
            expect(pageWaliKelasCode).toContain('pointsAvatarHtml');
            expect(pageWaliKelasCode).toContain('${pointsAvatarHtml}');
        });

        test('merender avatar pasfoto siswa pada Tab 6 (Master Data Siswa & Kontak Ortu)', () => {
            expect(pageWaliKelasCode).toContain('studentAvatarHtml');
            expect(pageWaliKelasCode).toContain('safeStudentPhoto');
        });

        test('merender avatar pasfoto siswa pada Tab 5 (Status Iuran SPP Rombel)', () => {
            expect(pageWaliKelasCode).toContain('sppAvatarHtml');
            expect(pageWaliKelasCode).toContain('${sppAvatarHtml}');
        });

        test('merender avatar pasfoto siswa pada Tab 7 (Akademik & Catatan Rapor Afektif)', () => {
            expect(pageWaliKelasCode).toContain('raporAvatarHtml');
            expect(pageWaliKelasCode).toContain('${raporAvatarHtml}');
        });

        test('merender foto profil siswa pada header modal detail siswa (modal-detail-avatar)', () => {
            expect(pageWaliKelasCode).toContain("document.getElementById('modal-detail-avatar')");
            expect(pageWaliKelasCode).toContain('modal-detail-avatar');
            expect(waliKelasHtml).toContain('id="modal-detail-avatar"');
        });

        test('merender avatar pasfoto siswa pada header modal catatan rapor (rapor-student-avatar-container)', () => {
            expect(pageWaliKelasCode).toContain("document.getElementById('rapor-student-avatar-container')");
            expect(pageWaliKelasCode).toContain('rapor-student-avatar-container');
            expect(waliKelasHtml).toContain('id="rapor-student-avatar-container"');
        });

        test('menyelaraskan tombol aksi Master Siswa: tombol edit diakses terpusat via Modal Detail Siswa (btn-detail-edit-profile)', () => {
            expect(pageWaliKelasCode).toContain("btn-detail-edit-profile");
            expect(pageWaliKelasCode).toContain("window.openModalEditDataSiswa(student.nis)");
            expect(waliKelasHtml).toContain('id="btn-detail-edit-profile"');
            expect(pageWaliKelasCode).toContain("window.openModalDetailSiswa('${escapeHTML(student.nis)}')");
            expect(pageWaliKelasCode).toContain("window.openKtsPreviewModal('${escapeHTML(student.nis)}')");
        });
    });

    describe('3. Keamanan OWASP ASVS Level 2 (Anti-XSS & Sanitasi URL Foto)', () => {
        test('memvalidasi protokol URL foto resmi agar kebal terhadap skema berbahaya', () => {
            const urlValidatorRegex = /^(https?:|\/|data:image\/)/i;
            expect(urlValidatorRegex.test('/api/photos/student/active/1001.webp')).toBe(true);
            expect(urlValidatorRegex.test('https://simas-smagesa-api.workers.dev/api/photos/student/active/1001.webp')).toBe(true);
            expect(urlValidatorRegex.test('data:image/webp;base64,UklGR')).toBe(true);
            expect(urlValidatorRegex.test("javascript:alert('xss')")).toBe(false);
            expect(urlValidatorRegex.test('javascript:window.location="https://attacker.com"')).toBe(false);
            expect(urlValidatorRegex.test('data:text/html,<script>alert(1)</script>')).toBe(false);
            expect(urlValidatorRegex.test('vbscript:msgbox(1)')).toBe(false);
        });

        test('memastikan penanganan fallback onerror menyajikan monogram inisial yang aman', () => {
            expect(pageGuruWaliCode).toContain('onerror=');
            expect(pageWaliKelasCode).toContain('onerror=');
        });
    });

    describe('4. Loading State & UX Feedback pada Verifikasi Pasfoto Siswa (Portal Wali Kelas)', () => {
        test('memastikan submitPhotoVerification memanggil Swal.showLoading untuk umpan balik seketika', () => {
            expect(pageWaliKelasCode).toContain('Swal.showLoading()');
            expect(pageWaliKelasCode).toContain("title: isApprove ? 'Menyimpan Verifikasi...' : 'Menyimpan Penolakan...'");
        });

        test('memastikan tombol verifikasi dan penolakan menampilkan animasi spinner fa-circle-notch fa-spin', () => {
            expect(pageWaliKelasCode).toContain('<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...');
            expect(pageWaliKelasCode).toContain('<i class="fa-solid fa-circle-notch fa-spin"></i> Memproses...');
        });

        test('mengunci tombol batal/tutup modal selama proses simpan berlangsung (anti-race condition)', () => {
            expect(pageWaliKelasCode).toContain('pointer-events-none');
            expect(pageWaliKelasCode).toContain('cancelBtns.forEach');
        });

        test('memulihkan status tombol di blok finally bila proses selesai atau gagal', () => {
            expect(pageWaliKelasCode).toContain('originalApproveHtml');
            expect(pageWaliKelasCode).toContain('originalRejectHtml');
            expect(pageWaliKelasCode).toContain('btnApprove.disabled = false');
            expect(pageWaliKelasCode).toContain('btnReject.disabled = false');
        });
    });
});

