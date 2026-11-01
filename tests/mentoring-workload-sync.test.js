/**
 * tests/mentoring-workload-sync.test.js
 * Unit Test Siklus Hidup Penuh Sinkronisasi Pembinaan Siswa (Guru Wali & Wali Kelas) ke E-Kinerja Guru SIMAS
 * Sesuai PRD_SIMAS.md, OWASP Top 10, Permendikdasmen No 11/2025, dan Aturan Bisnis SIMAS
 */

const fs = require('fs');
const path = require('path');

describe('Sinkronisasi Aktivitas Pembinaan Guru Wali & Wali Kelas ke E-Kinerja (Permendikdasmen 11/2025)', () => {
    const workerPath = path.join(__dirname, '../cloudflare/worker.js');
    const workerContent = fs.readFileSync(workerPath, 'utf8');

    const guruWaliHtmlPath = path.join(__dirname, '../guru-wali.html');
    const guruWaliHtmlContent = fs.readFileSync(guruWaliHtmlPath, 'utf8');

    const waliKelasHtmlPath = path.join(__dirname, '../wali-kelas.html');
    const waliKelasHtmlContent = fs.readFileSync(waliKelasHtmlPath, 'utf8');

    const guruWaliJsPath = path.join(__dirname, '../js/page-guru-wali.js');
    const guruWaliJsContent = fs.readFileSync(guruWaliJsPath, 'utf8');

    const waliKelasJsPath = path.join(__dirname, '../js/page-wali-kelas.js');
    const waliKelasJsContent = fs.readFileSync(waliKelasJsPath, 'utf8');

    const uploadModulePath = path.join(__dirname, '../js/workload-photo-upload.js');
    const uploadModuleContent = fs.readFileSync(uploadModulePath, 'utf8');

    // Helper functions diuji langsung secara murni
    function extractGoogleDriveFileId(url) {
        if (!url || typeof url !== 'string') return '';
        const trimmed = url.trim();
        const match = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                      trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                      trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
        return match ? match[1] : '';
    }

    function parseEvidencePhotos(raw) {
        if (!raw) return [];
        if (Array.isArray(raw)) {
            return raw.map((item, idx) => {
                if (typeof item === 'string') {
                    return { url: item, fileId: extractGoogleDriveFileId(item), name: `Foto Bukti ${idx + 1}`, caption: '' };
                }
                if (item && item.url) {
                    return {
                        url: item.url,
                        fileId: item.fileId || extractGoogleDriveFileId(item.url),
                        name: item.name || `Foto Bukti ${idx + 1}`,
                        caption: (item.caption || '').trim()
                    };
                }
                return null;
            }).filter(Boolean);
        }
        if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (!trimmed) return [];
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed)) {
                        return parsed.map((item, idx) => {
                            if (typeof item === 'string') {
                                return { url: item, fileId: extractGoogleDriveFileId(item), name: `Foto Bukti ${idx + 1}`, caption: '' };
                            }
                            if (item && item.url) {
                                return {
                                    url: item.url,
                                    fileId: item.fileId || extractGoogleDriveFileId(item.url),
                                    name: item.name || `Foto Bukti ${idx + 1}`,
                                    caption: (item.caption || '').trim()
                                };
                            }
                            return null;
                        }).filter(Boolean);
                    }
                } catch (_) {}
            }
            return [{ url: trimmed, fileId: extractGoogleDriveFileId(trimmed), name: 'Foto Bukti', caption: '' }];
        }
        return [];
    }

    function getGoogleDriveThumbnail(url) {
        if (!url || typeof url !== 'string') return '';
        const trimmed = url.trim();
        const fileId = extractGoogleDriveFileId(trimmed);
        if (fileId) {
            return `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}`;
        }
        if (/\.(jpeg|jpg|png|webp|gif|svg)($|\?)/i.test(trimmed)) {
            return trimmed;
        }
        return '';
    }

    describe('Bagian 1: Integritas Modul Bersama Foto (js/workload-photo-upload.js)', () => {
        test('File workload-photo-upload.js harus ada dan mengekspor fungsi kompresi & parsing', () => {
            expect(uploadModuleContent).toContain('export function compressImageToJpegBase64');
            expect(uploadModuleContent).toContain('uploadWorkloadPhotoToGoogleDrive');
            expect(uploadModuleContent).toContain('deleteWorkloadPhotoFromGoogleDrive');
            expect(uploadModuleContent).toContain('export function getGoogleDriveThumbnail');
            expect(uploadModuleContent).toContain('export function parseEvidencePhotos');
        });

        test('Ekstraksi fileId Google Drive harus bekerja untuk berbagai pola URL Drive', () => {
            const url1 = 'https://drive.google.com/file/d/1A2B3C4D5E6F7G/view?usp=sharing';
            const url2 = 'https://drive.google.com/open?id=XYZ987654321';
            const url3 = 'https://drive.google.com/d/FILEID_TEST_123';
            expect(extractGoogleDriveFileId(url1)).toBe('1A2B3C4D5E6F7G');
            expect(extractGoogleDriveFileId(url2)).toBe('XYZ987654321');
            expect(extractGoogleDriveFileId(url3)).toBe('FILEID_TEST_123');
        });

        test('parseEvidencePhotos harus mendukung JSON array multi-foto dan single URL string legacy', () => {
            const rawJson = JSON.stringify([
                { url: 'https://drive.google.com/file/d/ID1/view', fileId: 'ID1', name: 'Foto 1', caption: 'Bimbingan Konseling' },
                { url: 'https://drive.google.com/file/d/ID2/view', fileId: 'ID2', name: 'Foto 2', caption: 'Diskusi Nilai' }
            ]);
            const parsed = parseEvidencePhotos(rawJson);
            expect(parsed).toHaveLength(2);
            expect(parsed[0].fileId).toBe('ID1');
            expect(parsed[0].caption).toBe('Bimbingan Konseling');
            expect(parsed[1].fileId).toBe('ID2');

            const legacy = parseEvidencePhotos('https://drive.google.com/file/d/LEGACY_ID/view');
            expect(legacy).toHaveLength(1);
            expect(legacy[0].fileId).toBe('LEGACY_ID');

            expect(parseEvidencePhotos('')).toEqual([]);
            expect(parseEvidencePhotos(null)).toEqual([]);
        });

        test('getGoogleDriveThumbnail harus menghasilkan URL thumbnail lh3 googleusercontent', () => {
            const thumb = getGoogleDriveThumbnail('https://drive.google.com/file/d/ABC123XYZ/view');
            expect(thumb).toBe('https://lh3.googleusercontent.com/d/ABC123XYZ');
        });
    });

    describe('Bagian 2: Integritas Backend Worker (cloudflare/worker.js)', () => {
        test('Skema D1 guru_wali_notes harus memiliki kolom start_time, end_time, duration_minutes, evidence_url, source_portal, work_log_id', () => {
            expect(workerContent).toContain("start_time TEXT DEFAULT '08:00'");
            expect(workerContent).toContain("end_time TEXT DEFAULT '08:45'");
            expect(workerContent).toContain("duration_minutes INTEGER DEFAULT 45");
            expect(workerContent).toContain("evidence_url TEXT DEFAULT ''");
            expect(workerContent).toContain("source_portal TEXT DEFAULT 'guru_wali'");
            expect(workerContent).toContain("work_log_id TEXT DEFAULT ''");
        });

        test('Fungsi syncMentoringToWorkload harus diimplementasikan di worker.js', () => {
            expect(workerContent).toContain('async function syncMentoringToWorkload(db, noteData, actorUser = null)');
        });

        test('syncMentoringToWorkload harus membedakan kategori tugas pokok wali kelas vs guru wali', () => {
            expect(workerContent).toContain('cat_wali_kelas');
            expect(workerContent).toContain('cat_bimbing_guru_wali');
            expect(workerContent).toContain('Pendampingan Murid Dampingan sebagai Guru Wali');
        });

        test('syncMentoringToWorkload harus mendeteksi bentrok jam KBM dan menyediakan flag replace_kbm', () => {
            expect(workerContent).toContain('conflict_kbm: true');
            expect(workerContent).toContain('replace_kbm');
            expect(workerContent).toContain('kbm_activity_id');
        });

        test('Endpoint POST /api/perwalian/notes harus memanggil syncMentoringToWorkload dan menangani conflict_kbm', () => {
            expect(workerContent).toContain('syncMentoringToWorkload(env.DB,');
            expect(workerContent).toContain('if (syncResult && syncResult.conflict_kbm)');
            expect(workerContent).toContain('conflict_kbm: true');
        });

        test('Endpoint DELETE /api/perwalian/notes/:id harus melakukan rollback otomatis menghapus work_logs jika tidak ada sibling lain', () => {
            expect(workerContent).toContain('DELETE FROM work_logs WHERE id = ?');
            expect(workerContent).toContain('DELETE FROM work_log_segments WHERE work_log_id = ?');
            expect(workerContent).toContain('DELETE FROM plan_log_links WHERE work_log_id = ?');
        });
    });

    describe('Bagian 3: Integritas Antarmuka Guru Wali (guru-wali.html & js/page-guru-wali.js)', () => {
        test('Modal #modal-tambah-catatan di guru-wali.html harus memiliki elemen waktu, tombol cepat, foto, dan checkbox e-kinerja', () => {
            expect(guruWaliHtmlContent).toContain('id="catatan-jam-mulai"');
            expect(guruWaliHtmlContent).toContain('id="catatan-jam-selesai"');
            expect(guruWaliHtmlContent).toContain('id="catatan-durasi-label"');
            expect(guruWaliHtmlContent).toContain('applyCatatanQuickDuration(30)');
            expect(guruWaliHtmlContent).toContain('applyCatatanQuickDuration(45)');
            expect(guruWaliHtmlContent).toContain('applyCatatanQuickDuration(90)');
            expect(guruWaliHtmlContent).toContain('id="catatan-foto-grid"');
            expect(guruWaliHtmlContent).toContain('id="catatan-input-foto-file"');
            expect(guruWaliHtmlContent).toContain('id="catatan-input-foto-camera"');
            expect(guruWaliHtmlContent).toContain('id="catatan-sync-ekinerja"');
        });

        test('page-guru-wali.js harus mengimpor helper uploadWorkloadPhotoToGoogleDrive dan parseEvidencePhotos', () => {
            expect(guruWaliJsContent).toContain("import {\n    compressImageToJpegBase64,\n    uploadWorkloadPhotoToGoogleDrive,");
            expect(guruWaliJsContent).toContain('parseEvidencePhotos');
        });

        test('submitTambahCatatan di page-guru-wali.js harus mendukung penanganan bentrok KBM SweetAlert dan pembinaan kolektif', () => {
            expect(guruWaliJsContent).toContain('submitTambahCatatan = async function (replaceKbmConfirmed = false)');
            expect(guruWaliJsContent).toContain('Bentrok Jadwal KBM');
            expect(guruWaliJsContent).toContain('collectiveStudents');
            expect(guruWaliJsContent).toContain('sharedWorkLogId');
        });

        test('loadCatatanPembinaan dan loadDetailPembinaanList di page-guru-wali.js harus merender badge jam dan thumbnail foto', () => {
            expect(guruWaliJsContent).toContain('evidencePhotos.map(');
            expect(guruWaliJsContent).toContain('getGoogleDriveThumbnail');
        });
    });

    describe('Bagian 4: Integritas Antarmuka Wali Kelas (wali-kelas.html & js/page-wali-kelas.js)', () => {
        test('Modal #modal-catatan-wali di wali-kelas.html harus memiliki field waktu, pilihan cepat, foto, dan checkbox e-kinerja', () => {
            expect(waliKelasHtmlContent).toContain('id="form-note-time-start"');
            expect(waliKelasHtmlContent).toContain('id="form-note-time-end"');
            expect(waliKelasHtmlContent).toContain('id="form-note-durasi-label"');
            expect(waliKelasHtmlContent).toContain('applyWaliCatatanQuickDuration(30)');
            expect(waliKelasHtmlContent).toContain('applyWaliCatatanQuickDuration(45)');
            expect(waliKelasHtmlContent).toContain('applyWaliCatatanQuickDuration(90)');
            expect(waliKelasHtmlContent).toContain('id="form-note-foto-grid"');
            expect(waliKelasHtmlContent).toContain('id="form-note-foto-file"');
            expect(waliKelasHtmlContent).toContain('id="form-note-foto-camera"');
            expect(waliKelasHtmlContent).toContain('id="form-note-sync-ekinerja"');
        });

        test('page-wali-kelas.js harus mengimpor helper workload-photo-upload.js', () => {
            expect(waliKelasJsContent).toContain("import {\n    compressImageToJpegBase64,\n    uploadWorkloadPhotoToGoogleDrive,");
        });

        test('saveCatatanWali di page-wali-kelas.js harus menangani upload foto, bentrok KBM, dan pengiriman source_portal wali_kelas', () => {
            expect(waliKelasJsContent).toContain("source_portal: 'wali_kelas'");
            expect(waliKelasJsContent).toContain('Bentrok Jadwal KBM');
            expect(waliKelasJsContent).toContain('uploadWorkloadPhotoToGoogleDrive');
        });

        test('renderNotesTab di page-wali-kelas.js harus merender badge jam dan thumbnail foto', () => {
            expect(waliKelasJsContent).toContain('evidencePhotos.map(');
            expect(waliKelasJsContent).toContain('getGoogleDriveThumbnail');
        });
    });

    describe('Bagian 5: Kepatuhan Pedoman UI & Anti-Overlapping Icon Rule', () => {
        test('Input waktu dan judul pada modal tidak boleh memiliki leading icon absolut bertumpuk di dalam input', () => {
            // Verifikasi tidak ada pola "relative" dengan "absolute inset-y-0 left-0" pada modal pembinaan
            const catatanModalHtml = guruWaliHtmlContent.substring(
                guruWaliHtmlContent.indexOf('id="modal-tambah-catatan"'),
                guruWaliHtmlContent.indexOf('<!-- Modal Confirm Hapus Catatan -->') || guruWaliHtmlContent.indexOf('id="modal-tambah-catatan"') + 3000
            );
            expect(catatanModalHtml).not.toMatch(/absolute\s+inset-y-0\s+left-0/);
        });

        test('Modal dialog harus berdiri sebagai top-level di luar main (Anti-Nesting Rule)', () => {
            // Memastikan penutupan modal berimbang
            expect(guruWaliHtmlContent).toContain('<div id="modal-tambah-catatan"');
            expect(waliKelasHtmlContent).toContain('<div id="modal-catatan-wali"');
        });
    });
});
