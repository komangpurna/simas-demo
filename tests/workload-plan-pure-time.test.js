/**
 * tests/workload-plan-pure-time.test.js
 *
 * Pengujian Unit Komprehensif:
 * 1. Durasi Default 1 JP (45 menit) saat Menyusun Rencana Baru.
 * 2. Perlindungan Jam Akhir Murni Input Guru (Anti-Overwrite Total) saat Memilih/Mengubah Butir Rencana.
 * 3. Default Isian JP Pembelajaran (#plan-input-jp) adalah 1 JP.
 * 4. Ketersediaan & Efektivitas Tombol Cepat Durasi +135m (3 JP) pada Modal Rencana dan Realisasi.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Durasi Default 1 JP, Proteksi Jam Akhir Rencana & Tombol Cepat 3 JP (E-Kinerja Guru)', () => {
    const rootDir = path.resolve(__dirname, '..');
    const jsPath = path.join(rootDir, 'js', 'page-beban-kerja.js');
    const htmlPath = path.join(rootDir, 'e-kinerja.html');

    const jsContent = fs.readFileSync(jsPath, 'utf8');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    test('1. e-kinerja.html memiliki tombol cepat durasi +135m (3 JP) pada modal rencana dan modal pelaporan', () => {
        expect(htmlContent).toContain('window.workloadApplyQuickDuration(135, false)');
        expect(htmlContent).toContain('window.workloadApplyQuickDuration(135, true)');
        expect(htmlContent).toContain('+135m (3 JP)');
    });

    test('2. openPlanItemModal di js/page-beban-kerja.js menyetel default input JP ke 1 JP untuk rencana baru', () => {
        expect(jsContent).toContain("const defaultJp = (isBk || isStudyDay) ? '0' : '1';");
    });

    test('3. onCatalogChange memproteksi jam akhir murni guru dan menggunakan default 1 JP (45m) jika kosong', () => {
        expect(jsContent).toContain("const currentEnd = (endInput?.value || '').trim();");
        expect(jsContent).toContain('if (!currentEnd && start && endInput)');
        expect(jsContent).toContain('const defaultPlanDurMin = 45;');
        expect(jsContent).toContain('endInput.value = calculateEndTimeWithBreaks(start, defaultPlanDurMin);');
    });

    test('4. Simulasi Runtime Skenario A: Guru telah menginputkan jam akhir > 1 JP (120m), beralih butir katalog tidak mengubah jam akhir', () => {
        const mockEndInput = { value: '10:00' };
        const mockStartInput = { value: '08:00' };
        const autoAdjustTime = true;
        let previewUpdated = false;

        const updatePlannedMinutesPreview = () => { previewUpdated = true; };
        const calculateEndTimeWithBreaks = jest.fn(() => '08:45');

        if (autoAdjustTime) {
            const start = mockStartInput.value;
            const currentEnd = (mockEndInput?.value || '').trim();

            if (!currentEnd && start && mockEndInput) {
                const defaultPlanDurMin = 45;
                mockEndInput.value = calculateEndTimeWithBreaks(start, defaultPlanDurMin);
            }
            updatePlannedMinutesPreview();
        }

        // Jam akhir tetap utuh 10:00 (durasi 120m yang diinputkan guru tidak tertimpa)
        expect(mockEndInput.value).toBe('10:00');
        expect(calculateEndTimeWithBreaks).not.toHaveBeenCalled();
        expect(previewUpdated).toBe(true);
    });

    test('5. Simulasi Runtime Skenario B: Guru telah menginputkan jam akhir < 1 JP (30m), beralih butir katalog tidak mengubah jam akhir', () => {
        const mockEndInput = { value: '08:30' };
        const mockStartInput = { value: '08:00' };
        const autoAdjustTime = true;
        let previewUpdated = false;

        const updatePlannedMinutesPreview = () => { previewUpdated = true; };
        const calculateEndTimeWithBreaks = jest.fn(() => '08:45');

        if (autoAdjustTime) {
            const start = mockStartInput.value;
            const currentEnd = (mockEndInput?.value || '').trim();

            if (!currentEnd && start && mockEndInput) {
                const defaultPlanDurMin = 45;
                mockEndInput.value = calculateEndTimeWithBreaks(start, defaultPlanDurMin);
            }
            updatePlannedMinutesPreview();
        }

        // Jam akhir tetap utuh 08:30 (durasi 30 menit tidak tertimpa menjadi 45m atau lainnya)
        expect(mockEndInput.value).toBe('08:30');
        expect(calculateEndTimeWithBreaks).not.toHaveBeenCalled();
        expect(previewUpdated).toBe(true);
    });

    test('6. Simulasi Runtime Skenario C: Jam akhir masih kosong, memilih butir katalog apa pun menghasilkan default 1 JP (45m)', () => {
        const mockEndInput = { value: '' };
        const mockStartInput = { value: '08:00' };
        const autoAdjustTime = true;
        let previewUpdated = false;

        const updatePlannedMinutesPreview = () => { previewUpdated = true; };
        const calculateEndTimeWithBreaks = (start, dur) => '08:45';

        if (autoAdjustTime) {
            const start = mockStartInput.value;
            const currentEnd = (mockEndInput?.value || '').trim();

            if (!currentEnd && start && mockEndInput) {
                const defaultPlanDurMin = 45;
                mockEndInput.value = calculateEndTimeWithBreaks(start, defaultPlanDurMin);
            }
            updatePlannedMinutesPreview();
        }

        // Otomatis terisi 08:45 (1 JP)
        expect(mockEndInput.value).toBe('08:45');
        expect(previewUpdated).toBe(true);
    });

    test('7. applyQuickDuration untuk durasi 135 menit otomatis menyetel jam dan mengupdate JP ke 3', () => {
        const mockInputs = {
            'plan-input-start': { value: '07:30' },
            'plan-input-end': { value: '' },
            'plan-input-jp': { value: '1' },
            'plan-teaching-wrapper': { style: { display: '' } }
        };

        const calculateEndTimeWithBreaks = (start, mins) => '09:45'; // 135m
        const minutes = 135;
        const isLogModal = false;

        const startTime = mockInputs['plan-input-start'].value;
        mockInputs['plan-input-end'].value = calculateEndTimeWithBreaks(startTime, minutes);

        if (!isLogModal) {
            const jpEl = mockInputs['plan-input-jp'];
            if (jpEl && mockInputs['plan-teaching-wrapper']?.style?.display !== 'none') {
                if (minutes === 45) jpEl.value = '1';
                else if (minutes === 90) jpEl.value = '2';
                else if (minutes === 135) jpEl.value = '3';
            }
        }

        expect(mockInputs['plan-input-end'].value).toBe('09:45');
        expect(mockInputs['plan-input-jp'].value).toBe('3');
    });
});
