const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

describe('Resiliensi Mode Edit Jurnal KBM & Penanganan Lokasi Tanpa GPS', () => {
    const pageJurnalJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-jurnal.js'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    const prdSimas = fs.readFileSync(path.join(projectRoot, 'PRD_SIMAS.md'), 'utf8');
    const configJs = fs.readFileSync(path.join(projectRoot, 'js', 'config.js'), 'utf8');
    const changelogMd = fs.readFileSync(path.join(projectRoot, 'CHANGELOG.md'), 'utf8');

    describe('1. Validasi Mode Edit pada submitData (Relaksasi Foto & Error Feedback)', () => {
        test('Validasi foto wajib hanya berlaku untuk entri baru (!window.currentEditDocId)', () => {
            expect(pageJurnalJs).toContain('if (!window.currentEditDocId && !isImageVisible && !activePhotoUpload)');
            expect(pageJurnalJs).not.toContain('!(window.currentEditDocId && window.uploadedFotoUrl)');
        });

        test('showFieldError memiliki umpan balik visual peringatan (showToast)', () => {
            expect(pageJurnalJs).toContain("const showFieldError = (elementId, message = '') =>");
            expect(pageJurnalJs).toContain("if (message && typeof showToast === 'function')");
            expect(pageJurnalJs).toContain('showToast("Periksa Input", message, "warning")');
        });

        test('Validasi field di submitData menyediakan pesan peringatan jelas', () => {
            expect(pageJurnalJs).toContain("showFieldError('input-mapel', 'Silakan pilih mata pelajaran.');");
            expect(pageJurnalJs).toContain("showFieldError('jp-container', 'Pilih minimal 1 jam pelajaran (JP).');");
            expect(pageJurnalJs).toContain("showFieldError('input-topik', 'Topik/materi pembelajaran wajib diisi.');");
            expect(pageJurnalJs).toContain("showFieldError('photo-buttons', 'Foto kegiatan KBM wajib diunggah.');");
            expect(pageJurnalJs).toContain("showFieldError('signature-container', 'Tanda tangan digital wajib diisi.');");
        });
    });

    describe('2. Penanganan GPS dan Koordinat Lokasi pada Mode Edit', () => {
        test('handleGpsAndProceed mengizinkan simpan tanpa blokir GPS saat mode edit', () => {
            expect(pageJurnalJs).toContain('if (window.currentEditDocId) {');
            expect(pageJurnalJs).toContain('geoCoordinates = { lat, lng };');
            expect(pageJurnalJs).toContain('proceedSubmit(btn, originalBtnContent, guru, mapel, lokasi, topik, catatan, jpList, signatureCanvas, isSignatureEmpty);');
        });

        test('selectClass menangani koordinat lama yang belum didapat tanpa memunculkan error banner', () => {
            expect(pageJurnalJs).toContain('// GPS: Penanganan Mode Edit vs Input Baru');
            expect(pageJurnalJs).toContain('geoCoordinates = oldKoord || { lat: 0, lng: 0 };');
            expect(pageJurnalJs).toContain("statusEl.innerHTML = '<i data-lucide=\"map-pin-off\" class=\"w-3.5 h-3.5\"></i>';");
            expect(pageJurnalJs).toContain("banner.classList.add('hidden');");
        });

        test('selectClass menyematkan opsi lokasi kustom jika belum ada di master dropdown', () => {
            expect(pageJurnalJs).toContain("const lokVal = docData.lokasi_mengajar || 'Ruang Kelas';");
            expect(pageJurnalJs).toContain('let hasLokasi = Array.from(inputLokasi.options).some(opt => opt.value === lokVal);');
            expect(pageJurnalJs).toContain('inputLokasi.appendChild(newOpt);');
        });
    });

    describe('3. Dialog Konfirmasi Instan & Preservasi Metadata Jurnal', () => {
        test('showConfirmSubmitDialog menampilkan modal segera (0ms delay) sebelum komparasi jadwal', () => {
            const modalShowIdx = pageJurnalJs.indexOf("modal.classList.remove('pointer-events-none', 'opacity-0');");
            const scheduleCheckIdx = pageJurnalJs.indexOf("const scheduleCheck = data.scheduleCheck || await compareWithActualSchedule(");
            expect(modalShowIdx).toBeGreaterThan(-1);
            expect(scheduleCheckIdx).toBeGreaterThan(-1);
            expect(modalShowIdx).toBeLessThan(scheduleCheckIdx);
        });

        test('proceedSubmit mempertahankan tanggal asli entri dan foto lama di payload Cloudflare D1', () => {
            expect(pageJurnalJs).toContain('const entryTanggal = (window.currentEditDocId && window.currentEditData?.tanggal)');
            expect(pageJurnalJs).toContain('tanggal: entryTanggal');
            expect(pageJurnalJs).toContain('foto_url: fotoUrl || window.uploadedFotoUrl || window.currentEditData?.foto_url || ""');
            expect(pageJurnalJs).toContain('koordinat: geoCoordinates || window.currentEditData?.koordinat || { lat: 0, lng: 0 }');
        });
    });

    describe('4. Integritas Jadwal Lampau & Isolasi State Reset', () => {
        test('compareWithActualSchedule mendukung entryDateStr untuk mencocokkan hari KBM yang diedit', () => {
            expect(pageJurnalJs).toContain('async function compareWithActualSchedule(className, guruName, mapelName, jpList, entryDateStr = null)');
            expect(pageJurnalJs).toContain("const targetDate = (entryDateStr && /^\\d{4}-\\d{2}-\\d{2}$/.test(entryDateStr))");
            expect(pageJurnalJs).toContain('const scheduleCheck = data.scheduleCheck || await compareWithActualSchedule(data.className, data.guru, data.mapel, data.jpList, data.tanggal);');
        });

        test('resetApp mereset geoCoordinates menjadi null agar tidak bocor ke entri baru berikutnya', () => {
            expect(pageJurnalJs).toContain('window.resetApp = function () {');
            const resetAppSlice = pageJurnalJs.substring(pageJurnalJs.indexOf('window.resetApp = function ()'), pageJurnalJs.indexOf('// QR Deep Link handler'));
            expect(resetAppSlice).toContain('geoCoordinates = null;');
        });
    });

    describe('5. Sinkronisasi Versi di Seluruh Berkas SSOT', () => {
        test('Versi package.json, config.js, PRD_SIMAS.md, dan CHANGELOG.md selaras', () => {
            expect(packageJson.version).toMatch(/^26\.\d{2}\.\d{2}\.\d+$/);
            const TARGET_VERSION = packageJson.version;
            expect(configJs).toContain(`export const APP_VERSION = "${TARGET_VERSION}";`);
            expect(prdSimas).toContain(`[${TARGET_VERSION}]`);
            expect(changelogMd).toContain(`[${TARGET_VERSION}]`);
        });
    });
});
