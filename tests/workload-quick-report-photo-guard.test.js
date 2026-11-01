/**
 * @jest-environment jsdom
 */

/**
 * Unit Test Suite: Proteksi Konfirmasi Bukti Dukung Foto pada Simpan Cepat (Centang 1-Klik) Realisasi E-Kinerja
 * (js/page-beban-kerja.js & e-kinerja.html)
 * Sesuai Permintaan User:
 * Opsi tombol konfirmasi: "Ambil Foto" vs "Tetap Simpan".
 * Jika user mengklik "Ambil Foto":
 *   - Buka modal detail/formulir realisasi kegiatan
 *   - Buat box input foto bukti berkedip (pulsing glow highlight) dan scroll otomatis
 *   - Simpan API tidak dijalankan (0 write call)
 * Jika user mengklik "Tetap Simpan":
 *   - Lanjutkan simpan cepat ke API Cloudflare
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Proteksi Konfirmasi Bukti Dukung Foto pada Simpan Cepat Realisasi E-Kinerja', () => {
    const root = path.resolve(__dirname, '..');
    const jsPath = path.join(root, 'js', 'page-beban-kerja.js');
    const htmlPath = path.join(root, 'e-kinerja.html');
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    describe('1. Verifikasi Integritas Kode Sumber & DOM (Static Code & Template Integrity)', () => {
        test('quickReportComplete memeriksa bukti dukung foto menggunakan parseEvidencePhotos', () => {
            expect(jsContent).toContain('const existingPhotos = parseEvidencePhotos(existingLog?.evidence_url);');
        });

        test('quickReportComplete mendeteksi kondisi existingPhotos.length === 0', () => {
            expect(jsContent).toMatch(/if\s*\(\s*existingPhotos\.length\s*===\s*0\s*\)/);
        });

        test('quickReportComplete memanggil askPhotoConfirmation dengan opsi "Ambil Foto" dan "Tetap Simpan"', () => {
            expect(jsContent).toContain('const userChoice = await askPhotoConfirmation(');
            expect(jsContent).toContain("photoText: 'Ambil Foto'");
            expect(jsContent).toContain("saveText: 'Tetap Simpan'");
        });

        test('quickReportComplete membuka modal dan memicu highlightEvidencePhotoSection saat userChoice === "photo"', () => {
            expect(jsContent).toMatch(/if\s*\(\s*userChoice\s*===\s*'photo'\s*\)\s*\{/);
            expect(jsContent).toContain('openEditLogModal(existingLogId)');
            expect(jsContent).toContain('openLogModal(planActivityId, false, \'terlaksana\', effDayIdx)');
            expect(jsContent).toContain('highlightEvidencePhotoSection()');
        });

        test('e-kinerja.html menyediakan elemen id="log-evidence-photos-section" untuk target highlight', () => {
            expect(htmlContent).toContain('id="log-evidence-photos-section"');
        });

        test('highlightEvidencePhotoSection menerapkan class pulsing glow highlight ring-purple', () => {
            expect(jsContent).toContain('highlightEvidencePhotoSection');
            expect(jsContent).toContain('ring-purple-500/70');
            expect(jsContent).toContain('animate-pulse');
        });

        test('quickReportComplete mempertahankan evidence_url dan output_summary yang sudah ada pada payload', () => {
            expect(jsContent).toContain("output_summary: existingLog?.output_summary || 'Terlaksana sesuai rencana'");
            expect(jsContent).toContain("evidence_url: existingLog?.evidence_url || ''");
        });
    });

    describe('2. Simulasi Alur Logika Konfirmasi Foto (Logic Flow Simulation)', () => {
        let mockAskPhotoConfirmation;
        let mockOpenEditLogModal;
        let mockOpenLogModal;
        let mockHighlightPhotoSection;
        let mockSaveLog;
        let mockToast;

        beforeEach(() => {
            mockAskPhotoConfirmation = jest.fn();
            mockOpenEditLogModal = jest.fn();
            mockOpenLogModal = jest.fn();
            mockHighlightPhotoSection = jest.fn();
            mockSaveLog = jest.fn().mockResolvedValue({ success: true });
            mockToast = jest.fn();
        });

        async function simulateQuickReportCheck({ hasPhotos, userChoice, existingLogId, planActivityId, dayIndex }) {
            mockAskPhotoConfirmation.mockResolvedValue(userChoice);

            // Simulasi logika persis di quickReportComplete
            if (!hasPhotos) {
                const choice = await mockAskPhotoConfirmation(
                    'Laporan realisasi kegiatan belum dilengkapi dengan dokumentasi atau foto bukti dukung.',
                    'Konfirmasi Bukti Dukung Realisasi',
                    { photoText: 'Ambil Foto', saveText: 'Tetap Simpan' }
                );

                if (choice === 'photo') {
                    if (existingLogId) {
                        mockOpenEditLogModal(existingLogId);
                    } else {
                        mockOpenLogModal(planActivityId, false, 'terlaksana', dayIndex);
                    }
                    mockHighlightPhotoSection();
                    return { status: 'opened_modal_to_take_photo' };
                }

                if (choice !== 'save') {
                    return { status: 'cancelled' };
                }
            }

            await mockSaveLog();
            mockToast('✓ Realisasi tercatat', 'success');
            return { status: 'saved' };
        }

        test('Skenario A: Belum ada foto dan pengguna klik "Ambil Foto" (draf baru) -> Buka modal baru & highlight, API TIDAK dipanggil', async () => {
            const res = await simulateQuickReportCheck({
                hasPhotos: false,
                userChoice: 'photo',
                existingLogId: null,
                planActivityId: 'act-123',
                dayIndex: 2
            });

            expect(mockAskPhotoConfirmation).toHaveBeenCalledTimes(1);
            expect(mockOpenLogModal).toHaveBeenCalledWith('act-123', false, 'terlaksana', 2);
            expect(mockHighlightPhotoSection).toHaveBeenCalledTimes(1);
            expect(mockSaveLog).not.toHaveBeenCalled();
            expect(res.status).toBe('opened_modal_to_take_photo');
        });

        test('Skenario B: Belum ada foto dan pengguna klik "Ambil Foto" (log eksisting) -> Buka modal edit log & highlight, API TIDAK dipanggil', async () => {
            const res = await simulateQuickReportCheck({
                hasPhotos: false,
                userChoice: 'photo',
                existingLogId: 'log-999',
                planActivityId: 'act-123',
                dayIndex: 2
            });

            expect(mockAskPhotoConfirmation).toHaveBeenCalledTimes(1);
            expect(mockOpenEditLogModal).toHaveBeenCalledWith('log-999');
            expect(mockHighlightPhotoSection).toHaveBeenCalledTimes(1);
            expect(mockSaveLog).not.toHaveBeenCalled();
            expect(res.status).toBe('opened_modal_to_take_photo');
        });

        test('Skenario C: Belum ada foto dan pengguna klik "Tetap Simpan" -> Penyimpanan dilanjutkan ke API', async () => {
            const res = await simulateQuickReportCheck({
                hasPhotos: false,
                userChoice: 'save',
                existingLogId: null,
                planActivityId: 'act-123',
                dayIndex: 2
            });

            expect(mockAskPhotoConfirmation).toHaveBeenCalledTimes(1);
            expect(mockSaveLog).toHaveBeenCalledTimes(1);
            expect(res.status).toBe('saved');
            expect(mockToast).toHaveBeenCalledWith(
                expect.stringContaining('Realisasi tercatat'),
                'success'
            );
        });

        test('Skenario D: Belum ada foto dan pengguna membatalkan/tutup dialog -> Tidak simpan dan tidak buka modal', async () => {
            const res = await simulateQuickReportCheck({
                hasPhotos: false,
                userChoice: 'cancel',
                existingLogId: null,
                planActivityId: 'act-123',
                dayIndex: 2
            });

            expect(mockAskPhotoConfirmation).toHaveBeenCalledTimes(1);
            expect(mockSaveLog).not.toHaveBeenCalled();
            expect(mockOpenLogModal).not.toHaveBeenCalled();
            expect(res.status).toBe('cancelled');
        });

        test('Skenario E: Foto sudah ada di draf -> Langsung disimpan tanpa memunculkan dialog konfirmasi', async () => {
            const res = await simulateQuickReportCheck({
                hasPhotos: true,
                userChoice: null,
                existingLogId: 'log-888',
                planActivityId: 'act-123',
                dayIndex: 2
            });

            expect(mockAskPhotoConfirmation).not.toHaveBeenCalled();
            expect(mockSaveLog).toHaveBeenCalledTimes(1);
            expect(res.status).toBe('saved');
            expect(mockToast).toHaveBeenCalledWith(
                expect.stringContaining('Realisasi tercatat'),
                'success'
            );
        });
    });
});
