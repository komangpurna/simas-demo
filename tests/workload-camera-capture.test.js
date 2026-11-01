/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

describe('E-Kinerja Guru - Kamera Langsung & Pilihan Galeri untuk Bukti Foto', () => {
    let htmlContent;
    let pageJsContent;

    beforeAll(() => {
        htmlContent = fs.readFileSync(path.join(__dirname, '../e-kinerja.html'), 'utf8');
        pageJsContent = fs.readFileSync(path.join(__dirname, '../js/page-beban-kerja.js'), 'utf8');
    });

    beforeEach(() => {
        document.documentElement.innerHTML = htmlContent;
    });

    describe('1. Verifikasi Elemen DOM HTML e-kinerja.html', () => {
        test('Modal log memiliki elemen input kamera terpisah dengan capture="environment"', () => {
            const camInput = document.getElementById('log-input-photo-camera');
            expect(camInput).not.toBeNull();
            expect(camInput.getAttribute('type')).toBe('file');
            expect(camInput.getAttribute('accept')).toBe('image/*');
            expect(camInput.getAttribute('capture')).toBe('environment');
            expect(camInput.classList.contains('hidden')).toBe(true);
        });

        test('Modal log memiliki elemen input galeri file dengan multiple', () => {
            const fileInput = document.getElementById('log-input-photo-file');
            expect(fileInput).not.toBeNull();
            expect(fileInput.getAttribute('type')).toBe('file');
            expect(fileInput.hasAttribute('multiple')).toBe(true);
            expect(fileInput.classList.contains('hidden')).toBe(true);
        });

        test('Tersedia tombol aksi terpisah untuk Ambil Foto (kamera) dan Pilih Galeri', () => {
            const btnCamera = document.getElementById('btn-camera-evidence-photo');
            const btnGallery = document.getElementById('btn-add-evidence-photo');

            expect(btnCamera).not.toBeNull();
            expect(btnCamera.textContent).toContain('Ambil Foto');
            expect(btnCamera.getAttribute('onclick')).toContain("log-input-photo-camera");

            expect(btnGallery).not.toBeNull();
            expect(btnGallery.textContent).toContain('Pilih Galeri');
            expect(btnGallery.getAttribute('onclick')).toContain("log-input-photo-file");
        });
    });

    describe('2. Verifikasi Logika Skrip js/page-beban-kerja.js', () => {
        test('renderEvidencePhotosGrid menonaktifkan kedua tombol (kamera & galeri) saat foto penuh (5 foto)', () => {
            expect(pageJsContent).toContain("const btnCamera = el('btn-camera-evidence-photo');");
            expect(pageJsContent).toContain("btnCamera.disabled = count >= MAX_WORKLOAD_PHOTOS;");
            expect(pageJsContent).toContain("btnAdd.disabled = count >= MAX_WORKLOAD_PHOTOS;");
        });

        test('handlePhotoFilesSelected mereset input file kamera dan berkas galeri', () => {
            expect(pageJsContent).toContain("const camInput = el('log-input-photo-camera');");
            expect(pageJsContent).toContain("if (camInput) camInput.value = '';");
            expect(pageJsContent).toContain("const fileInput = el('log-input-photo-file');");
            expect(pageJsContent).toContain("if (fileInput) fileInput.value = '';");
        });
    });
});
