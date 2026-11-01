/**
 * tests/student-photo-staff-upload.test.js
 *
 * Pengujian Unit Fitur Unggah & Ganti Pasfoto Siswa (E-KTS) oleh Staf Tata Usaha:
 * 1. Verifikasi elemen DOM tombol unggah foto pada modal edit data siswa di siswa.html.
 * 2. Verifikasi dialog modal pemotong foto interaktif (#modal-student-crop-photo) sebagai top-level sibling.
 * 3. Verifikasi proteksi otorisasi RBAC (staff, super_admin, kesiswaan) di js/page-students.js.
 * 4. Verifikasi paritas klien-server: pemanggilan cfClient.uploadStudentPhoto dengan autoVerify: true.
 * 5. Verifikasi integrasi anti-nesting dan non-regresi terhadap modal KTS.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Fitur Unggah & Ganti Pasfoto Siswa oleh Staf (E-KTS)', () => {
    const siswaHtmlPath = path.join(__dirname, '..', 'siswa.html');
    const pageStudentsJsPath = path.join(__dirname, '..', 'js', 'page-students.js');
    const workerJsPath = path.join(__dirname, '..', 'cloudflare', 'worker.js');

    const siswaHtml = fs.readFileSync(siswaHtmlPath, 'utf8');
    const pageStudentsJs = fs.readFileSync(pageStudentsJsPath, 'utf8');
    const workerJs = fs.readFileSync(workerJsPath, 'utf8');

    test('1. siswa.html menyediakan tombol unggah foto pada cardlet pasfoto modal edit siswa', () => {
        // Tombol unggah dan teks dinamis
        expect(siswaHtml).toContain('id="btn-upload-student-photo-admin"');
        expect(siswaHtml).toContain('id="btn-upload-student-photo-admin-text"');
        expect(siswaHtml).toContain('window.openStudentPhotoCropModal()');

        // Tombol hapus tetap berdampingan
        expect(siswaHtml).toContain('id="btn-delete-student-photo-admin"');
        expect(siswaHtml).toContain('window.deleteStudentPhotoAdmin()');
    });

    test('2. siswa.html memiliki dialog modal canvas crop (#modal-student-crop-photo) yang valid dan mandiri', () => {
        expect(siswaHtml).toContain('id="modal-student-crop-photo"');
        expect(siswaHtml).toContain('id="student-crop-canvas"');
        expect(siswaHtml).toContain('id="input-student-crop-file"');
        expect(siswaHtml).toContain('id="student-crop-preview-area"');
        expect(siswaHtml).toContain('id="student-crop-upload-status"');
        expect(siswaHtml).toContain('id="btn-submit-student-crop-photo"');

        // Kontrol zoom dan reset
        expect(siswaHtml).toContain('window.zoomStudentCropPhoto(-0.1)');
        expect(siswaHtml).toContain('window.zoomStudentCropPhoto(0.1)');
        expect(siswaHtml).toContain('window.resetStudentCropPhoto()');
        expect(siswaHtml).toContain('window.closeStudentCropPhotoModal()');
        expect(siswaHtml).toContain('window.submitStudentCroppedPhoto()');

        // Modal berdiri mandiri di luar <main>
        const mainIndex = siswaHtml.indexOf('<main');
        const mainEndIndex = siswaHtml.indexOf('</main>');
        const modalCropIndex = siswaHtml.indexOf('id="modal-student-crop-photo"');

        expect(modalCropIndex).toBeGreaterThan(mainEndIndex);
    });

    test('3. js/page-students.js membatasi hak akses unggah pasfoto untuk role staff, super_admin, dan kesiswaan', () => {
        // Guard canUploadPhoto memeriksa peran staff
        expect(pageStudentsJs).toContain("window.hasRole('staff')");
        expect(pageStudentsJs).toContain("['super_admin', 'staff', 'kesiswaan', 'admin']");

        // Helper setupEditStudentPhotoSection mengatur visibilitas tombol
        expect(pageStudentsJs).toContain("const canUploadPhoto = window.hasRole ?");
        expect(pageStudentsJs).toContain("btnUpload.classList.remove('hidden')");
        expect(pageStudentsJs).toContain("btnUploadText.textContent = photoUrl ? 'Ganti Foto' : 'Unggah Foto'");
    });

    test('4. js/page-students.js mendeklarasikan seluruh fungsi modal crop pada scope window', () => {
        expect(pageStudentsJs).toContain('window.openStudentPhotoCropModal = function');
        expect(pageStudentsJs).toContain('window.closeStudentCropPhotoModal = function');
        expect(pageStudentsJs).toContain('window.handleStudentCropFileSelect = function');
        expect(pageStudentsJs).toContain('window.zoomStudentCropPhoto = function');
        expect(pageStudentsJs).toContain('window.resetStudentCropPhoto = function');
        expect(pageStudentsJs).toContain('window.submitStudentCroppedPhoto = async function');
    });

    test('5. submitStudentCroppedPhoto memanggil cfClient.uploadStudentPhoto dengan autoVerify: true', () => {
        expect(pageStudentsJs).toContain('cfClient.uploadStudentPhoto({');
        expect(pageStudentsJs).toContain('photoBase64: base64Data');
        expect(pageStudentsJs).toContain("format: 'webp'");
        expect(pageStudentsJs).toContain('autoVerify: true');
    });

    test('6. Paritas backend Cloudflare Worker mengizinkan role staff untuk auto-verify foto siswa', () => {
        // Backend mengecek isStaffOrTeacher
        expect(workerJs).toContain('const isStaff = isStaffOrTeacher(user);');
        expect(workerJs).toContain('const autoVerify = Boolean(isStaff && body.autoVerify === true);');

        // STAFF_AND_TEACHER_ROLES memuat role 'staff'
        expect(workerJs).toContain('"staff"');
    });

    test('7. submitStudentCroppedPhoto memvalidasi keberadaan gambar dan me-refresh cache latar belakang', () => {
        expect(pageStudentsJs).toContain('if (!canvas || !studentCropImage || !targetCropStudent || !targetCropStudent.nis) return;');
        expect(pageStudentsJs).toContain('window.addEventListener(\'touchcancel\', () => { isDraggingStudentCrop = false; });');
        expect(pageStudentsJs).toContain('window.getStudentsCache(true).catch(() => {});');
    });
});
