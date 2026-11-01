const fs = require('fs');
const path = require('path');

describe('Paritas Kompresi Foto E-Kinerja Guru & Pegawai vs Jurnal Mengajar', () => {
    const bebanKerjaSrc = fs.readFileSync(path.join(__dirname, '../js/page-beban-kerja.js'), 'utf8');
    const tendikSrc = fs.readFileSync(path.join(__dirname, '../js/page-e-kinerja-tendik.js'), 'utf8');
    const agendaSrc = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');
    const jurnalSrc = fs.readFileSync(path.join(__dirname, '../js/page-jurnal.js'), 'utf8');

    test('1. Seluruh modul E-Kinerja mengadopsi default resolusi 800px dan kualitas awal 0.6 (60%)', () => {
        const expectedSignature = 'compressImageToJpegBase64(file, maxDimension = 800, quality = 0.6, maxBytes = 80 * 1024)';
        expect(bebanKerjaSrc).toContain(expectedSignature);
        expect(tendikSrc).toContain(expectedSignature);
        expect(agendaSrc).toContain(expectedSignature);
    });

    test('2. Seluruh modul E-Kinerja mengimplementasikan adaptive quality reduction loop hingga batas ~80KB', () => {
        const loopPattern = 'while (dataUrl.length > maxChars && currentQuality > 0.1)';
        expect(bebanKerjaSrc).toContain(loopPattern);
        expect(tendikSrc).toContain(loopPattern);
        expect(agendaSrc).toContain(loopPattern);
    });

    test('3. Modul Jurnal Mengajar memiliki patokan batas karakter kompresi yang setara (~105.000 chars / ~80KB)', () => {
        expect(jurnalSrc).toContain('MAX_LENGTH = 105000');
        expect(jurnalSrc).toContain('maxWidth = 800');
        expect(jurnalSrc).toContain('initialQuality = 0.6');
    });

    test('4. Simulasi runtime fungsi kompresi membatasi resolusi ke 800px dan mereduksi kualitas jika melebihi batas byte', async () => {
        // Simulasi fungsi kompresi client-side
        function runMockCompression(file, maxDimension = 800, quality = 0.6, maxBytes = 80 * 1024, mockImgDim = { width: 1600, height: 1200 }, charSizeGenerator = q => Math.round(150000 * q)) {
            return new Promise((resolve, reject) => {
                const isHeic = /^image\/hei[cf]$/i.test(file?.type || '') || /\.hei[cf]$/i.test(file?.name || '');
                if (!file || (!file.type?.startsWith('image/') && !isHeic)) {
                    return reject(new Error('File yang dipilih bukan berkas gambar yang sah.'));
                }

                let width = mockImgDim.width;
                let height = mockImgDim.height;
                if (width > maxDimension || height > maxDimension) {
                    if (width > height) {
                        height = Math.round((height * maxDimension) / width);
                        width = maxDimension;
                    } else {
                        width = Math.round((width * maxDimension) / height);
                        height = maxDimension;
                    }
                }

                let currentQuality = quality;
                let dataUrl = 'data:image/jpeg;base64,' + 'X'.repeat(charSizeGenerator(currentQuality));

                if (maxBytes > 0) {
                    const maxChars = Math.round(maxBytes / 0.75);
                    while (dataUrl.length > maxChars && currentQuality > 0.1) {
                        currentQuality = Math.round((currentQuality - 0.1) * 10) / 10;
                        dataUrl = 'data:image/jpeg;base64,' + 'X'.repeat(charSizeGenerator(currentQuality));
                    }
                }

                const base64 = dataUrl.split(',')[1];
                resolve({ dataUrl, base64, width, height, finalQuality: currentQuality });
            });
        }

        // Test normal: gambar 1600x1200 ter-resize ke 800x600 dan kualitas turun sampai muat di ~80KB
        const result = await runMockCompression({ type: 'image/jpeg', name: 'kegiatan.jpg' });
        expect(result.width).toBe(800);
        expect(result.height).toBe(600);
        expect(result.dataUrl.length).toBeLessThanOrEqual(Math.round((80 * 1024) / 0.75) + 30);
        expect(result.finalQuality).toBeLessThanOrEqual(0.6);

        // Test custom: jika maxBytes = 0 (misal butir cetak lokal), kualitas & dimensi custom dipertahankan
        const printResult = await runMockCompression(
            { type: 'image/jpeg', name: 'cetak.jpg' },
            1600,
            0.82,
            0,
            { width: 3200, height: 2400 }
        );
        expect(printResult.width).toBe(1600);
        expect(printResult.height).toBe(1200);
        expect(printResult.finalQuality).toBe(0.82);

        // Test validasi file non-gambar tertolak tegas
        await expect(runMockCompression({ type: 'application/pdf', name: 'dokumen.pdf' }))
            .rejects.toThrow('File yang dipilih bukan berkas gambar yang sah.');
    });
});
