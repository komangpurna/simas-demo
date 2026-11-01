/**
 * tests/surat-keterangan-photo.test.js
 * Unit test untuk memverifikasi fitur pasfoto 3x4 pada Surat Keterangan Siswa
 * (Cetak Langsung A4/PDF & Berkas Word DOCX) di js/page-students.js dan siswa.html.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pageStudentsJs = fs.readFileSync(path.join(root, 'js/page-students.js'), 'utf8');
const siswaHtml = fs.readFileSync(path.join(root, 'siswa.html'), 'utf8');

describe('Fitur Pasfoto 3x4 Surat Keterangan Siswa', () => {

    test('1. siswa.html menyediakan wadah status pratinjau pasfoto di modal surat keterangan', () => {
        expect(siswaHtml).toContain('id="surat-ket-preview-photo-status"');
        expect(siswaHtml).toContain('Pasfoto 3x4:');
    });

    test('2. js/page-students.js mendefinisikan getStudentSuratPhoto dan mengekspornya secara publik', () => {
        expect(pageStudentsJs).toContain('function getStudentSuratPhoto(student)');
        expect(pageStudentsJs).toContain('window.getStudentSuratPhoto = getStudentSuratPhoto;');
    });

    test('3. Logika getStudentSuratPhoto memfilter avatar default dan mengembalikan URL valid', () => {
        // Evaluasi fungsi getStudentSuratPhoto di scope uji
        const fnMatch = pageStudentsJs.match(/function getStudentSuratPhoto\(student\)\s*\{[\s\S]*?\n\}/);
        expect(fnMatch).not.toBeNull();

        const getStudentSuratPhoto = new Function('student', 'window', `
            const resolvePhotoUrl = window?.resolvePhotoUrl || (u => u);
            ${fnMatch[0]}
            return getStudentSuratPhoto(student);
        `);

        const mockWindow = {
            resolvePhotoUrl: (url) => url.startsWith('http') ? url : `https://example.com${url}`
        };

        // Kasus 1: Siswa punya activePhotoUrl
        const s1 = { activePhotoUrl: 'https://images.example.com/photo1.webp' };
        expect(getStudentSuratPhoto(s1, mockWindow)).toBe('https://images.example.com/photo1.webp');

        // Kasus 2: Siswa punya active_photo_url relatif
        const s2 = { active_photo_url: '/api/photos/student/active/1234.webp' };
        expect(getStudentSuratPhoto(s2, mockWindow)).toBe('https://example.com/api/photos/student/active/1234.webp');

        // Kasus 3: Siswa belum ada foto (null/empty)
        const s3 = { activePhotoUrl: null, photo_url: '' };
        expect(getStudentSuratPhoto(s3, mockWindow)).toBeNull();

        // Kasus 4: Siswa dengan default avatar (harus diabaikan / null)
        const s4 = { photoUrl: 'assets/default-avatar.svg' };
        expect(getStudentSuratPhoto(s4, mockWindow)).toBeNull();
    });

    test('4. printSuratKeterangan menyertakan styling ukuran 3x4 (30mm x 40mm) dan proteksi tanpa bingkai', () => {
        const printFnIndex = pageStudentsJs.indexOf('window.printSuratKeterangan = function');
        expect(printFnIndex).toBeGreaterThan(-1);

        const printBlock = pageStudentsJs.slice(printFnIndex, printFnIndex + 8000);
        expect(printBlock).toContain('const studentPhotoUrl = getStudentSuratPhoto(student);');
        expect(printBlock).toContain('.photo-container {');
        expect(printBlock).toContain('width: 30mm;');
        expect(printBlock).toContain('height: 40mm;');
        expect(printBlock).toContain('border: none;');
        expect(printBlock).toContain('.photo-3x4 {');
        expect(printBlock).toContain('object-fit: cover;');
        expect(printBlock).toContain('onerror="this.style.display=\'none\';"');
    });

    test('5. downloadSuratKeteranganDocx menyertakan pemuatan pasfoto siswa dan ImageRun berukuran 3x4 cm', () => {
        const docxFnIndex = pageStudentsJs.indexOf('window.downloadSuratKeteranganDocx = async function');
        expect(docxFnIndex).toBeGreaterThan(-1);

        const docxBlock = pageStudentsJs.slice(docxFnIndex, docxFnIndex + 20000);
        expect(docxBlock).toContain('const studentPhotoUrl = getStudentSuratPhoto(student);');
        expect(docxBlock).toContain('let studentPhotoBuffer = null;');
        expect(docxBlock).toContain('studentPhotoBuffer = await res.arrayBuffer();');
        expect(docxBlock).toContain('width: 113.4'); // 3 cm
        expect(docxBlock).toContain('height: 151.2'); // 4 cm
        expect(docxBlock).toContain('children: studentPhotoBuffer ? [');
    });

    test('6. Area foto dikosongkan sepenuhnya tanpa frame bila foto tidak tersedia', () => {
        const printFnIndex = pageStudentsJs.indexOf('window.printSuratKeterangan = function');
        const nextFnIndex = pageStudentsJs.indexOf('window.downloadSuratKeteranganDocx = async function');
        const printBlock = pageStudentsJs.slice(printFnIndex, nextFnIndex);

        // Memastikan tidak ada teks placeholder seperti "Pas Foto" atau frame garis pada kondisi tanpa foto
        expect(printBlock).toContain('${studentPhotoUrl ? `');
        expect(printBlock).toContain('.photo-container {');
        expect(printBlock).toContain('border: none;');
        expect(printBlock).not.toContain('border: 1px dashed');
        expect(printBlock).not.toContain('border: 1px solid');
    });
});
