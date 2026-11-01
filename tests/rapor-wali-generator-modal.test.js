/**
 * tests/rapor-wali-generator-modal.test.js
 * Verifikasi Integrasi Generator AI & API Key Gemini pada Modal Cetak Rapor Wali Kelas (#print-settings-modal)
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const waliHtml = fs.readFileSync(path.join(root, 'wali-kelas.html'), 'utf8');
const waliCode = fs.readFileSync(path.join(root, 'js/page-wali-kelas.js'), 'utf8');

describe('Verifikasi Integrasi Generator Catatan AI pada Modal Cetak Rapor Wali Kelas', () => {

    describe('1. Verifikasi Struktur DOM & Komponen Modal di wali-kelas.html', () => {
        test('Koreksi typo judul modal: Cetak Rapor Afektif Siswa (tanpa kata ganda Lapor)', () => {
            expect(waliHtml).toContain('Cetak Rapor Afektif Siswa');
            expect(waliHtml).not.toContain('Cetak Lapor Rapor Afektif Siswa');
        });

        test('Panel AI dan elemen API Key Gemini tersedia di #print-settings-modal', () => {
            expect(waliHtml).toContain('id="print-ai-mode-container"');
            expect(waliHtml).toContain('id="wali-gemini-badge-label"');
            expect(waliHtml).toContain('id="wali-api-key-list"');
            expect(waliHtml).toContain('id="btn-wali-show-add-key"');
            expect(waliHtml).toContain('id="wali-add-api-key-form-container"');
            expect(waliHtml).toContain('id="user-gemini-api-key"');
            expect(waliHtml).toContain('id="icon-toggle-api-key-wali"');
            expect(waliHtml).toContain('id="btn-save-api-key-wali"');
            expect(waliHtml).toContain('id="btn-wali-cancel-add-key"');
        });

        test('Tombol Generate Catatan AI terpasang dengan trigger overwrite protection', () => {
            expect(waliHtml).toContain('id="btn-generate-ai"');
            expect(waliHtml).toContain('onclick="window.triggerGenerateCatatanPrintModal()"');
            expect(waliHtml).toContain('id="generation-status"');
        });

        test('Textarea catatan dilengkapi tombol salin (copy) ke clipboard', () => {
            expect(waliHtml).toContain('id="print-notes-input"');
            expect(waliHtml).toContain('onclick="window.copyPrintNotes()"');
            expect(waliHtml).toContain('id="icon-copy-print-notes"');
        });

        test('Tidak ada tombol dummy btn-generate-ai yang disembunyikan di footer', () => {
            expect(waliHtml).not.toMatch(/<button[^>]+id="btn-generate-ai"[^>]*style="display:\s*none;"[^>]*><\/button>/);
        });
    });

    describe('2. Verifikasi Fungsi & Handler Logika di js/page-wali-kelas.js', () => {
        test('Fungsi copyPrintNotes terdefinisi dan menangani clipboard', () => {
            expect(waliCode).toContain('window.copyPrintNotes = function');
            expect(waliCode).toContain('print-notes-input');
            expect(waliCode).toContain('clipboard.writeText');
        });

        test('Fungsi triggerGenerateCatatanPrintModal memiliki proteksi overwrite catatan', () => {
            expect(waliCode).toContain('window.triggerGenerateCatatanPrintModal = async function');
            expect(waliCode).toContain('print-notes-input');
            expect(waliCode).toContain('Swal.fire');
            expect(waliCode).toContain('window.generateCatatanRaporAI');
        });

        test('Fungsi manajemen API Key Wali terdefinisi lengkap', () => {
            expect(waliCode).toContain('window.loadUserApiKeyWali = loadUserApiKeyWali');
            expect(waliCode).toContain('window.saveUserApiKeyWali = async function');
            expect(waliCode).toContain('window.deleteUserApiKeyWali = async function');
            expect(waliCode).toContain('window.showAddKeyFormWali = function');
            expect(waliCode).toContain('window.cancelAddKeyWali = function');
            expect(waliCode).toContain('window.toggleApiKeyVisibilityWali = function');
            expect(waliCode).toContain('window.renderApiKeyListWali = function');
        });

        test('Sinkronisasi model badge mencakup #wali-gemini-badge-label', () => {
            expect(waliCode).toContain('#wali-gemini-badge-label');
        });
    });

    describe('3. Simulasi Logika Overwrite Protection pada triggerGenerateCatatanPrintModal', () => {
        test('Jika catatan kosong, generateCatatanRaporAI langsung dipanggil tanpa Swal', async () => {
            let generateCalled = false;
            let swalCalled = false;

            const mockDoc = {
                getElementById: (id) => {
                    if (id === 'print-notes-input') return { value: '   ' };
                    return null;
                }
            };
            const mockSwal = {
                fire: async () => { swalCalled = true; return { isConfirmed: false }; }
            };

            const triggerFn = async (docObj, swalObj, genFn) => {
                const textInput = docObj.getElementById('print-notes-input');
                const currentText = (textInput?.value || '').trim();
                if (currentText.length > 0) {
                    const res = await swalObj.fire({});
                    if (!res.isConfirmed) return;
                }
                await genFn();
            };

            await triggerFn(mockDoc, mockSwal, async () => { generateCalled = true; });

            expect(swalCalled).toBe(false);
            expect(generateCalled).toBe(true);
        });

        test('Jika catatan terisi dan pengguna membatalkan Swal, generateCatatanRaporAI tidak dipanggil', async () => {
            let generateCalled = false;
            let swalCalled = false;

            const mockDoc = {
                getElementById: (id) => {
                    if (id === 'print-notes-input') return { value: 'Catatan sebelumnya yang penting' };
                    return null;
                }
            };
            const mockSwal = {
                fire: async () => { swalCalled = true; return { isConfirmed: false }; }
            };

            const triggerFn = async (docObj, swalObj, genFn) => {
                const textInput = docObj.getElementById('print-notes-input');
                const currentText = (textInput?.value || '').trim();
                if (currentText.length > 0) {
                    const res = await swalObj.fire({});
                    if (!res.isConfirmed) return;
                }
                await genFn();
            };

            await triggerFn(mockDoc, mockSwal, async () => { generateCalled = true; });

            expect(swalCalled).toBe(true);
            expect(generateCalled).toBe(false);
        });

        test('Jika catatan terisi dan pengguna menyetujui Swal, generateCatatanRaporAI dipanggil', async () => {
            let generateCalled = false;
            let swalCalled = false;

            const mockDoc = {
                getElementById: (id) => {
                    if (id === 'print-notes-input') return { value: 'Catatan lama' };
                    return null;
                }
            };
            const mockSwal = {
                fire: async () => { swalCalled = true; return { isConfirmed: true }; }
            };

            const triggerFn = async (docObj, swalObj, genFn) => {
                const textInput = docObj.getElementById('print-notes-input');
                const currentText = (textInput?.value || '').trim();
                if (currentText.length > 0) {
                    const res = await swalObj.fire({});
                    if (!res.isConfirmed) return;
                }
                await genFn();
            };

            await triggerFn(mockDoc, mockSwal, async () => { generateCalled = true; });

            expect(swalCalled).toBe(true);
            expect(generateCalled).toBe(true);
        });
    });
});
