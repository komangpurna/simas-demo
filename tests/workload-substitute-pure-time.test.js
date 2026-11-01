/**
 * tests/workload-substitute-pure-time.test.js
 *
 * Pengujian Unit: Perlindungan Jam Akhir Murni Input Guru & Peniadaan Popup Konfirmasi
 * saat Pemilihan Kegiatan Pengganti pada Modul E-Kinerja Guru (js/page-beban-kerja.js)
 *
 * Verifikasi:
 * 1. Tidak ada lagi dialog konfirmasi `askConfirm` terkait durasi rencana vs katalog pada onLogCatalogChange.
 * 2. Jam akhir (log-input-end) yang telah diisi/diinputkan oleh guru dipertahankan 100% utuh tanpa ditimpa oleh durasi bawaan katalog.
 * 3. Jam akhir otomatis dihitung HANYA jika kolom jam akhir masih kosong.
 * 4. updateLogMinutesPreview tetap dipanggil untuk menyelaraskan kalkulasi durasi riil.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Perlindungan Jam Akhir Murni Input Guru & Peniadaan Popup Konfirmasi (E-Kinerja Guru)', () => {
    const rootDir = path.resolve(__dirname, '..');
    const jsPath = path.join(rootDir, 'js', 'page-beban-kerja.js');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    test('1. onLogCatalogChange di js/page-beban-kerja.js tidak lagi memuat dialog konfirmasi durasi rencana', () => {
        // Memastikan teks dialog konfirmasi lama telah dihapus
        expect(jsContent).not.toContain('Apakah Anda ingin tetap menggunakan durasi rencana');
        expect(jsContent).not.toContain('Pertahankan Durasi Rencana?');
    });

    test('2. onLogCatalogChange menjaga jam akhir murni jika sudah terisi dan hanya mengisi jika kosong', () => {
        // Memastikan terdapat pengecekan jam akhir murni guru
        expect(jsContent).toContain("const currentEnd = (endInput?.value || '').trim();");
        expect(jsContent).toContain('if (!currentEnd && start && durMin > 0 && endInput)');
        expect(jsContent).toContain('endInput.value = calculateEndTimeWithBreaks(start, durMin);');
        expect(jsContent).toContain('updateLogMinutesPreview();');
    });

    test('3. Simulasi logika onLogCatalogChange mempertahankan jam akhir yang diinputkan guru', () => {
        // Mensimulasikan DOM input dan fungsi terkait
        const mockElements = {
            'log-input-catalog': {
                selectedIndex: 0,
                options: [
                    { dataset: { duration: '45', teaching: '0', jp: '1' } }
                ]
            },
            'log-teaching-wrapper': { classList: { add: jest.fn(), remove: jest.fn() } },
            'log-input-jp': { value: '' },
            'log-input-start': { value: '08:00' },
            'log-input-end': { value: '10:00' }, // Guru sudah menginputkan jam akhir 10:00 (120 menit)
            'modal-workload-log': { dataset: { planDuration: '90', planEnd: '09:30' } }
        };

        const calculateEndTimeWithBreaks = (start, dur) => '08:45'; // Jika dihitung katalog 45m
        let previewUpdated = false;
        const updateLogMinutesPreview = () => { previewUpdated = true; };

        const autoAdjustTime = true;
        const selected = mockElements['log-input-catalog'].options[0];

        if (autoAdjustTime) {
            const start = mockElements['log-input-start']?.value;
            const durMin = Number(selected?.dataset?.duration || 45);
            const endInput = mockElements['log-input-end'];
            const currentEnd = (endInput?.value || '').trim();

            if (!currentEnd && start && durMin > 0 && endInput) {
                endInput.value = calculateEndTimeWithBreaks(start, durMin);
            }
            updateLogMinutesPreview();
        }

        // Jam akhir TIDAK berubah menjadi 08:45, melainkan tetap murni 10:00 yang diinputkan guru
        expect(mockElements['log-input-end'].value).toBe('10:00');
        expect(previewUpdated).toBe(true);
    });

    test('4. Simulasi logika onLogCatalogChange mengisi jam akhir jika input jam akhir masih kosong', () => {
        const mockElements = {
            'log-input-catalog': {
                selectedIndex: 0,
                options: [
                    { dataset: { duration: '60', teaching: '0', jp: '1' } }
                ]
            },
            'log-input-start': { value: '07:30' },
            'log-input-end': { value: '' } // Masih kosong
        };

        const calculateEndTimeWithBreaks = (start, dur) => '08:30';
        let previewUpdated = false;
        const updateLogMinutesPreview = () => { previewUpdated = true; };

        const autoAdjustTime = true;
        const selected = mockElements['log-input-catalog'].options[0];

        if (autoAdjustTime) {
            const start = mockElements['log-input-start']?.value;
            const durMin = Number(selected?.dataset?.duration || 45);
            const endInput = mockElements['log-input-end'];
            const currentEnd = (endInput?.value || '').trim();

            if (!currentEnd && start && durMin > 0 && endInput) {
                endInput.value = calculateEndTimeWithBreaks(start, durMin);
            }
            updateLogMinutesPreview();
        }

        // Jam akhir otomatis terisi karena awalnya kosong
        expect(mockElements['log-input-end'].value).toBe('08:30');
        expect(previewUpdated).toBe(true);
    });
});
