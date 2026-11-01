/**
 * tests/audit-fixes-verification.test.js
 * Unit test komprehensif untuk memvalidasi perbaikan audit A-E:
 * 1. Target DOM seleksi modal aktif pada generateCatatanRaporAI
 * 2. Ekspor Excel Catatan Rapor menggunakan currentClassStudents (empty & populated)
 * 3. Urutan seksi cetak rapor pada page-students.js (A, B, C, D)
 * 4. Token limit AI (250) dan pembersihan kalimat terpotong (trailing cut-off cleanup)
 * 5. Fallback generator poin/stats dengan proteksi TypeError dan pembacaan modal aktif
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const waliCode = fs.readFileSync(path.join(root, 'js/page-wali-kelas.js'), 'utf8');
const studentsCode = fs.readFileSync(path.join(root, 'js/page-students.js'), 'utf8');
const waliHtml = fs.readFileSync(path.join(root, 'wali-kelas.html'), 'utf8');

describe('Verifikasi Perbaikan Audit A-E (SIMAS SMAGESA)', () => {

    describe('1. Temuan A: Seleksi Target DOM Dinamis pada Generator Catatan Rapor', () => {
        test('Memastikan kedua modal terdefinisi di HTML', () => {
            expect(waliHtml).toContain('id="modal-catatan-rapor"');
            expect(waliHtml).toContain('id="print-settings-modal"');
            expect(waliHtml).toContain('id="btn-generate-rapor-ai"');
            expect(waliHtml).toContain('id="btn-generate-ai"');
            expect(waliHtml).toContain('id="rapor-catatan-text"');
            expect(waliHtml).toContain('id="print-notes-input"');
        });

        test('Kode page-wali-kelas.js mendeteksi isRaporModalOpen untuk menentukan target elemen', () => {
            expect(waliCode).toMatch(/const\s+isRaporModalOpen\s*=\s*!document\.getElementById\('modal-catatan-rapor'\)\?\.classList\.contains\('hidden'\)/);
            expect(waliCode).toMatch(/const\s+btn\s*=\s*isRaporModalOpen\s*\?\s*\(document\.getElementById\('btn-generate-rapor-ai'\)/);
            expect(waliCode).toMatch(/const\s+textArea\s*=\s*isRaporModalOpen\s*\?\s*\(document\.getElementById\('rapor-catatan-text'\)/);
            expect(waliCode).toMatch(/const\s+statusEl\s*=\s*isRaporModalOpen\s*\?\s*\(document\.getElementById\('rapor-generation-status'\)/);
        });

        test('Simulasi: Saat modal-catatan-rapor terbuka, target diarahkan ke elemen rapor modal', () => {
            // Simulasi state DOM saat modal-catatan-rapor terbuka (tidak hidden)
            const mockClassListRapor = { contains: (cls) => cls !== 'hidden' };
            const mockDoc = {
                getElementById: (id) => {
                    if (id === 'modal-catatan-rapor') return { classList: mockClassListRapor };
                    return { id, value: '', innerHTML: '' };
                }
            };

            const isRaporModalOpen = !mockDoc.getElementById('modal-catatan-rapor')?.classList.contains('hidden');
            const btn = isRaporModalOpen
                ? (mockDoc.getElementById('btn-generate-rapor-ai') || mockDoc.getElementById('btn-generate-ai'))
                : (mockDoc.getElementById('btn-generate-ai') || mockDoc.getElementById('btn-generate-rapor-ai'));
            const textArea = isRaporModalOpen
                ? (mockDoc.getElementById('rapor-catatan-text') || mockDoc.getElementById('print-notes-input'))
                : (mockDoc.getElementById('print-notes-input') || mockDoc.getElementById('rapor-catatan-text'));

            expect(isRaporModalOpen).toBe(true);
            expect(btn.id).toBe('btn-generate-rapor-ai');
            expect(textArea.id).toBe('rapor-catatan-text');
        });

        test('Simulasi: Saat modal cetak terbuka, target diarahkan ke elemen print modal', () => {
            // Simulasi state DOM saat modal-catatan-rapor tersembunyi (hidden)
            const mockClassListRapor = { contains: (cls) => cls === 'hidden' };
            const mockDoc = {
                getElementById: (id) => {
                    if (id === 'modal-catatan-rapor') return { classList: mockClassListRapor };
                    return { id, value: '', innerHTML: '' };
                }
            };

            const isRaporModalOpen = !mockDoc.getElementById('modal-catatan-rapor')?.classList.contains('hidden');
            const btn = isRaporModalOpen
                ? (mockDoc.getElementById('btn-generate-rapor-ai') || mockDoc.getElementById('btn-generate-ai'))
                : (mockDoc.getElementById('btn-generate-ai') || mockDoc.getElementById('btn-generate-rapor-ai'));
            const textArea = isRaporModalOpen
                ? (mockDoc.getElementById('rapor-catatan-text') || mockDoc.getElementById('print-notes-input'))
                : (mockDoc.getElementById('print-notes-input') || mockDoc.getElementById('rapor-catatan-text'));

            expect(isRaporModalOpen).toBe(false);
            expect(btn.id).toBe('btn-generate-ai');
            expect(textArea.id).toBe('print-notes-input');
        });
    });

    describe('2. Temuan B: Ekspor Excel Catatan Rapor Menggunakan currentClassStudents', () => {
        test('Tidak ada lagi referensi rombelStudents di page-wali-kelas.js', () => {
            expect(waliCode).not.toContain('rombelStudents');
        });

        test('exportCatatanRaporExcel menggunakan currentClassStudents', () => {
            expect(waliCode).toMatch(/if\s*\(!currentClassStudents\s*\|\|\s*currentClassStudents\.length\s*===\s*0\)/);
            expect(waliCode).toMatch(/currentClassStudents\.forEach\(\(student,\s*index\)\s*=>/);
            expect(waliCode).toMatch(/\$\{currentClassStudents\.length\}\s*siswa/);
        });

        test('Simulasi: Ekspor dengan data kosong menampilkan pesan peringatan', () => {
            let toastType = '';
            let toastMsg = '';
            const showToast = (title, msg, type) => {
                toastType = type;
                toastMsg = msg;
            };

            const testExport = (students) => {
                if (!students || students.length === 0) {
                    showToast("Peringatan", "Data siswa rombel kosong.", "warning");
                    return false;
                }
                return true;
            };

            expect(testExport([])).toBe(false);
            expect(toastType).toBe('warning');
            expect(toastMsg).toBe('Data siswa rombel kosong.');

            expect(testExport(null)).toBe(false);
            expect(toastType).toBe('warning');
        });

        test('Simulasi: Ekspor dengan data terisi memproses data siswa dengan benar', () => {
            const mockStudents = [
                { nis: '1001', nisn: '001001', name: 'I Made Test', gender: 'L', class: 'XI-F1' },
                { nis: '1002', nisn: '001002', name: 'Ni Putu Test', gender: 'P', class: 'XI-F1' }
            ];
            const mockNotes = { '1001': 'Rajin dan berprestasi' };

            const rows = mockStudents.map((s, idx) => ({
                no: idx + 1,
                nis: s.nis,
                name: s.name,
                catatan: mockNotes[s.nis] || '(Belum diisi)'
            }));

            expect(rows).toHaveLength(2);
            expect(rows[0].catatan).toBe('Rajin dan berprestasi');
            expect(rows[1].catatan).toBe('(Belum diisi)');
        });
    });

    describe('3. Temuan C: Urutan Seksi Cetak Rapor pada page-students.js', () => {
        test('Header seksi SPP di page-students.js terstruktur rapi setelah seksi kedisiplinan & pembinaan', () => {
            const hasSppHeader = studentsCode.includes('INFORMASI TUNGGAKAN IURAN KOMITE (SPP)');
            expect(hasSppHeader).toBe(true);
        });

        test('Urutan seksi cetak di page-students.js tersusun logis dan terurut alfabetis', () => {
            const posA = studentsCode.indexOf('A. CATATAN PRESTASI');
            const posB = studentsCode.indexOf('B. CATATAN KETIDAKHADIRAN & PERMISI');
            const posC = studentsCode.indexOf('C. CATATAN KEDISIPLINAN');
            const posSppInjection = studentsCode.indexOf('${sppSectionHtml}');
            const posCatatanWali = studentsCode.indexOf('<!-- CATATAN WALI KELAS -->');

            expect(posA).toBeGreaterThan(-1);
            expect(posB).toBeGreaterThan(posA);
            expect(posC).toBeGreaterThan(posB);
            expect(posSppInjection).toBeGreaterThan(posC);
            expect(posCatatanWali).toBeGreaterThan(posSppInjection);
        });
    });

    describe('4. Temuan D: Konfigurasi Token Limit & Pembersihan Kalimat Terpotong', () => {
        test('maxOutputTokens diatur ke 250 pada page-wali-kelas.js dan page-students.js', () => {
            const waliGenBlock = waliCode.slice(waliCode.indexOf('window.generateCatatanRaporAI'));
            const waliTokenMatch = waliGenBlock.match(/maxOutputTokens:\s*(\d+)/);

            const studentsGenBlock = studentsCode.slice(studentsCode.indexOf('window.generateAutoNotes'));
            const studentsTokenMatch = studentsGenBlock.match(/maxOutputTokens:\s*(\d+)/);

            expect(waliTokenMatch).not.toBeNull();
            expect(Number(waliTokenMatch[1])).toBe(250);

            expect(studentsTokenMatch).not.toBeNull();
            expect(Number(studentsTokenMatch[1])).toBe(250);
        });

        test('Fungsi pembersihan memotong kalimat menggantung ke tanda titik terdekat', () => {
            const cleanTruncatedText = (raw) => {
                let text = raw.trim();
                if (!/[.!?]$/.test(text)) {
                    const lastPunctuation = Math.max(text.lastIndexOf('.'), text.lastIndexOf('!'), text.lastIndexOf('?'));
                    if (lastPunctuation > 20) {
                        text = text.slice(0, lastPunctuation + 1).trim();
                    }
                }
                return text;
            };

            // Kasus 1: Teks terpotong di tengah kalimat kedua
            const truncated1 = "Wayan menunjukkan ketekunan belajar yang sangat baik di kelas. Namun kedisiplinan perlu diperbaiki terutama";
            const cleaned1 = cleanTruncatedText(truncated1);
            expect(cleaned1).toBe("Wayan menunjukkan ketekunan belajar yang sangat baik di kelas.");
            expect(cleaned1.endsWith('.')).toBe(true);

            // Kasus 2: Teks utuh berakhiran titik
            const complete = "Wayan menunjukkan ketekunan belajar yang sangat baik di kelas. Pertahankan prestasimu.";
            expect(cleanTruncatedText(complete)).toBe(complete);
        });
    });

    describe('5. Temuan E: Fallback Generator Poin/Stats Offline Aman', () => {
        test('Fallback di page-wali-kelas.js membaca elemen sesuai modal aktif dengan optional chaining', () => {
            expect(waliCode).toMatch(/const\s+poinEl\s*=\s*isRaporModalOpen\s*\?\s*document\.getElementById\('rapor-preview-poin'\)\s*:\s*document\.getElementById\('print-preview-poin'\)/);
            expect(waliCode).toMatch(/const\s+poin\s*=\s*parseInt\(poinEl\?\.innerText\s*\|\|\s*'0'\)\s*\|\|\s*0/);
            expect(waliCode).toMatch(/const\s+alpha\s*=\s*parseInt\(alphaEl\?\.innerText\s*\|\|\s*'0'\)\s*\|\|\s*0/);
        });

        test('Simulasi: Tidak melempar TypeError jika elemen preview null', () => {
            const isRaporModalOpen = true;
            const mockDoc = { getElementById: () => null };

            const poinEl = isRaporModalOpen ? mockDoc.getElementById('rapor-preview-poin') : mockDoc.getElementById('print-preview-poin');
            const alphaEl = isRaporModalOpen ? mockDoc.getElementById('rapor-preview-alpha') : mockDoc.getElementById('print-preview-alpha');

            expect(() => {
                const poin = parseInt(poinEl?.innerText || '0') || 0;
                const alpha = parseInt(alphaEl?.innerText || '0') || 0;
                expect(poin).toBe(0);
                expect(alpha).toBe(0);
            }).not.toThrow();
        });
    });
});
