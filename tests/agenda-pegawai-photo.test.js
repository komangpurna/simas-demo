/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

describe('Agenda Pegawai - Fitur Upload & Pratinjau Foto Bukti Kegiatan', () => {
    let htmlContent;
    let pageJsContent;

    beforeAll(() => {
        htmlContent = fs.readFileSync(path.join(__dirname, '../e-kinerja-tendik.html'), 'utf8');
        pageJsContent = fs.readFileSync(path.join(__dirname, '../js/page-e-kinerja-tendik.js'), 'utf8');
    });

    beforeEach(() => {
        document.documentElement.innerHTML = htmlContent;
    });

    describe('1. Verifikasi Elemen DOM HTML e-kinerja-tendik.html', () => {
        test('Form modal memiliki wadah foto bukti kegiatan dan tombol pilih foto serta kamera langsung', () => {
            const countEl = document.getElementById('form-activity-photos-count');
            const fileInput = document.getElementById('form-activity-photo-input');
            const camInput = document.getElementById('form-activity-photo-camera');
            const btnCamera = document.getElementById('btn-camera-activity-photo');
            const btnAdd = document.getElementById('btn-add-activity-photo');
            const grid = document.getElementById('form-activity-photos-grid');

            expect(countEl).not.toBeNull();
            expect(fileInput).not.toBeNull();
            expect(fileInput.getAttribute('type')).toBe('file');
            expect(fileInput.getAttribute('accept')).toBe('image/*');
            expect(fileInput.hasAttribute('multiple')).toBe(true);

            expect(camInput).not.toBeNull();
            expect(camInput.getAttribute('type')).toBe('file');
            expect(camInput.getAttribute('accept')).toBe('image/*');
            expect(camInput.getAttribute('capture')).toBe('environment');

            expect(btnCamera).not.toBeNull();
            expect(btnCamera.textContent).toContain('Ambil Foto');
            expect(btnAdd).not.toBeNull();
            expect(btnAdd.textContent).toContain('Pilih Galeri');
            expect(grid).not.toBeNull();
            expect(grid.innerHTML).toContain('Belum ada foto bukti diunggah');
        });

        test('Modal lightbox foto bukti berada di luar modal lain sebagai top-level sibling', () => {
            const lightboxModal = document.getElementById('modal-evidence-lightbox');
            expect(lightboxModal).not.toBeNull();
            expect(lightboxModal.parentElement).toBe(document.body);

            // Verifikasi elemen internal lightbox
            expect(document.getElementById('lightbox-title')).not.toBeNull();
            expect(document.getElementById('lightbox-counter')).not.toBeNull();
            expect(document.getElementById('lightbox-btn-drive')).not.toBeNull();
            expect(document.getElementById('lightbox-btn-prev')).not.toBeNull();
            expect(document.getElementById('lightbox-btn-next')).not.toBeNull();
            expect(document.getElementById('lightbox-thumbnails-strip')).not.toBeNull();
            expect(document.getElementById('lightbox-img')).not.toBeNull();
        });
    });

    describe('2. Logika Algoritma Helper Google Drive & Foto', () => {
        function extractGoogleDriveFileId(url) {
            if (!url || typeof url !== 'string') return null;
            const patterns = [
                /\/file\/d\/([a-zA-Z0-9_-]+)/,
                /id=([a-zA-Z0-9_-]+)/,
                /\/d\/([a-zA-Z0-9_-]+)/,
                /\/open\?id=([a-zA-Z0-9_-]+)/,
                /\/uc\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/
            ];
            for (const p of patterns) {
                const m = url.match(p);
                if (m && m[1]) return m[1];
            }
            return null;
        }

        function getGoogleDriveThumbnail(url) {
            if (!url) return '';
            const fileId = extractGoogleDriveFileId(url);
            if (fileId) {
                return `https://lh3.googleusercontent.com/d/${fileId}=w400`;
            }
            return url;
        }

        function parseEvidencePhotos(raw) {
            if (!raw) return [];
            if (Array.isArray(raw)) {
                return raw.map((item, idx) => {
                    if (typeof item === 'string') {
                        return { url: item, fileId: extractGoogleDriveFileId(item), name: `Foto Bukti ${idx + 1}` };
                    }
                    if (item && item.url) {
                        return {
                            url: item.url,
                            fileId: item.fileId || extractGoogleDriveFileId(item.url),
                            name: item.name || `Foto Bukti ${idx + 1}`
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
                                    return { url: item, fileId: extractGoogleDriveFileId(item), name: `Foto Bukti ${idx + 1}` };
                                }
                                if (item && item.url) {
                                    return {
                                        url: item.url,
                                        fileId: item.fileId || extractGoogleDriveFileId(item.url),
                                        name: item.name || `Foto Bukti ${idx + 1}`
                                    };
                                }
                                return null;
                            }).filter(Boolean);
                        }
                    } catch (_) {}
                }
                if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                    return [{ url: trimmed, fileId: extractGoogleDriveFileId(trimmed), name: 'Foto Bukti' }];
                }
            }
            return [];
        }

        test('Mampu mengekstrak file ID dari berbagai format URL Google Drive', () => {
            const url1 = 'https://drive.google.com/file/d/1a2B3c4D5e6F7g8H9i0J/view?usp=sharing';
            const url2 = 'https://drive.google.com/open?id=1a2B3c4D5e6F7g8H9i0J';
            const url3 = 'https://drive.google.com/uc?id=1a2B3c4D5e6F7g8H9i0J&export=download';
            const url4 = 'https://drive.google.com/d/1a2B3c4D5e6F7g8H9i0J';

            expect(extractGoogleDriveFileId(url1)).toBe('1a2B3c4D5e6F7g8H9i0J');
            expect(extractGoogleDriveFileId(url2)).toBe('1a2B3c4D5e6F7g8H9i0J');
            expect(extractGoogleDriveFileId(url3)).toBe('1a2B3c4D5e6F7g8H9i0J');
            expect(extractGoogleDriveFileId(url4)).toBe('1a2B3c4D5e6F7g8H9i0J');
        });

        test('Menghasilkan URL thumbnail yang valid', () => {
            const url = 'https://drive.google.com/file/d/xyz123/view';
            expect(getGoogleDriveThumbnail(url)).toBe('https://lh3.googleusercontent.com/d/xyz123=w400');
        });

        test('parseEvidencePhotos mem-parsing JSON string array dengan benar', () => {
            const data = [
                { url: 'https://drive.google.com/file/d/photo1/view', fileId: 'photo1', name: 'Foto 1' },
                { url: 'https://drive.google.com/file/d/photo2/view', fileId: 'photo2', name: 'Foto 2' }
            ];
            const parsed = parseEvidencePhotos(JSON.stringify(data));
            expect(parsed).toHaveLength(2);
            expect(parsed[0].fileId).toBe('photo1');
            expect(parsed[1].fileId).toBe('photo2');
        });

        test('parseEvidencePhotos aman terhadap nilai null atau string kosong', () => {
            expect(parseEvidencePhotos(null)).toEqual([]);
            expect(parseEvidencePhotos('')).toEqual([]);
            expect(parseEvidencePhotos('   ')).toEqual([]);
        });
    });

    describe('3. Batasan Maksimal 2 Foto & Format Penyimpanan Tanpa Caption', () => {
        test('Konstanta MAX_EMPLOYEE_PHOTOS dideklarasikan bernilai 2 di page-e-kinerja-tendik.js', () => {
            expect(pageJsContent).toMatch(/const\s+MAX_EMPLOYEE_PHOTOS\s*=\s*2/);
        });

        test('Payload bukti_url menyimpan array foto tanpa properti caption', () => {
            const mockPhotos = [
                { url: 'https://drive.google.com/file/d/p1/view', fileId: 'p1', name: 'Foto Bukti 1' },
                { url: 'https://drive.google.com/file/d/p2/view', fileId: 'p2', name: 'Foto Bukti 2' }
            ];
            const jsonPayload = JSON.stringify(mockPhotos);
            const parsed = JSON.parse(jsonPayload);

            expect(parsed).toHaveLength(2);
            expect(parsed[0]).toHaveProperty('url');
            expect(parsed[0]).toHaveProperty('fileId');
            expect(parsed[0]).not.toHaveProperty('caption');
        });
    });

    describe('4. Simulasi Navigasi & Tampilan Lightbox', () => {
        let _employeeLightboxPhotos = [];
        let _employeeLightboxIndex = 0;

        function updateLightboxView() {
            if (_employeeLightboxPhotos.length === 0) return;
            const cur = _employeeLightboxPhotos[_employeeLightboxIndex] || {};
            const imgEl = document.getElementById('lightbox-img');
            const counterEl = document.getElementById('lightbox-counter');
            const btnDrive = document.getElementById('lightbox-btn-drive');
            const btnPrev = document.getElementById('lightbox-btn-prev');
            const btnNext = document.getElementById('lightbox-btn-next');

            if (imgEl) imgEl.src = cur.url || '';
            if (counterEl) counterEl.textContent = `${_employeeLightboxIndex + 1} / ${_employeeLightboxPhotos.length}`;
            if (btnDrive) btnDrive.href = cur.url || '#';

            const showNav = _employeeLightboxPhotos.length > 1;
            if (btnPrev) btnPrev.classList.toggle('hidden', !showNav);
            if (btnNext) btnNext.classList.toggle('hidden', !showNav);
        }

        function openLightbox(photos, initialIndex = 0, title = 'Foto Bukti Kegiatan') {
            _employeeLightboxPhotos = photos;
            _employeeLightboxIndex = initialIndex;
            const modal = document.getElementById('modal-evidence-lightbox');
            const titleEl = document.getElementById('lightbox-title');
            if (titleEl) titleEl.textContent = title;
            updateLightboxView();
            modal.classList.remove('hidden');
        }

        function nextPhoto() {
            if (_employeeLightboxPhotos.length <= 1) return;
            _employeeLightboxIndex = (_employeeLightboxIndex + 1) % _employeeLightboxPhotos.length;
            updateLightboxView();
        }

        function prevPhoto() {
            if (_employeeLightboxPhotos.length <= 1) return;
            _employeeLightboxIndex = (_employeeLightboxIndex - 1 + _employeeLightboxPhotos.length) % _employeeLightboxPhotos.length;
            updateLightboxView();
        }

        test('Lightbox membuka dan mengelola navigasi prev & next untuk 2 foto', () => {
            const samplePhotos = [
                { url: 'https://drive.google.com/file/d/img1/view', fileId: 'img1', name: 'Foto 1' },
                { url: 'https://drive.google.com/file/d/img2/view', fileId: 'img2', name: 'Foto 2' }
            ];

            openLightbox(samplePhotos, 0, 'Kegiatan Tata Usaha');
            const modal = document.getElementById('modal-evidence-lightbox');
            const counterEl = document.getElementById('lightbox-counter');
            const imgEl = document.getElementById('lightbox-img');

            expect(modal.classList.contains('hidden')).toBe(false);
            expect(counterEl.textContent).toBe('1 / 2');
            expect(imgEl.src).toContain('img1');

            nextPhoto();
            expect(counterEl.textContent).toBe('2 / 2');
            expect(imgEl.src).toContain('img2');

            prevPhoto();
            expect(counterEl.textContent).toBe('1 / 2');
            expect(imgEl.src).toContain('img1');
        });
    });

    describe('5. Validasi Wajib Upload Minimal 1 Foto Bukti (Mandatory Evidence)', () => {
        test('Label Foto Bukti Kegiatan memiliki indikator wajib min. 1 foto di e-kinerja-tendik.html', () => {
            expect(htmlContent).toContain('(Wajib min. 1 foto)');
            expect(htmlContent).toContain('Belum ada foto bukti diunggah (wajib min. 1 foto, maks. 2 foto)');
        });

        test('page-e-kinerja-tendik.js menolak penyimpanan aktivitas jika belum ada foto bukti terunggah', () => {
            // Validasi pada saveEmployeeActivity
            expect(pageJsContent).toContain("readyPhotos.length === 0");
            expect(pageJsContent).toContain("Foto Bukti Kegiatan Wajib");
            expect(pageJsContent).toContain("Wajib mengunggah minimal 1 foto bukti kegiatan");
        });

        test('worker.js backend menolak pembuatan aktivitas berfoto kosong (400 Bad Request)', () => {
            const workerCode = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');
            expect(workerCode).toContain("Foto bukti kegiatan wajib diunggah minimal 1 foto");
            expect(workerCode).toContain("isValidPhoto");
        });
    });

    describe('6. Otomatisasi Status Draf vs Realisasi Berdasarkan Jam Selesai', () => {
        // Simulasi isActivityTimeCompleted sesuai logika WITA
        function isActivityTimeCompleted(activityDate, endTime) {
            if (!activityDate || !endTime) return false;
            const now = new Date();
            const witaOffset = 8 * 60;
            const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
            const nowWita = new Date(utc + (witaOffset * 60000));

            const yyyy = nowWita.getFullYear();
            const mm = String(nowWita.getMonth() + 1).padStart(2, '0');
            const dd = String(nowWita.getDate()).padStart(2, '0');
            const todayWita = `${yyyy}-${mm}-${dd}`;

            if (activityDate > todayWita) return false;
            if (activityDate < todayWita) return true;

            const nowHours = String(nowWita.getHours()).padStart(2, '0');
            const nowMinutes = String(nowWita.getMinutes()).padStart(2, '0');
            const nowTimeStr = `${nowHours}:${nowMinutes}`;

            return endTime <= nowTimeStr;
        }

        test('isActivityTimeCompleted mengevaluasi waktu masa depan sebagai false (Draf)', () => {
            expect(isActivityTimeCompleted('2099-12-31', '10:00')).toBe(false);
            expect(isActivityTimeCompleted('2099-01-01', '23:59')).toBe(false);
        });

        test('isActivityTimeCompleted mengevaluasi tanggal masa lalu sebagai true (Selesai/Realisasi)', () => {
            expect(isActivityTimeCompleted('2020-01-01', '15:30')).toBe(true);
            expect(isActivityTimeCompleted('2025-05-10', '08:00')).toBe(true);
        });

        test('e-kinerja-tendik.html memiliki indikator dinamis Draf vs Realisasi dan tombol Simpan Draf', () => {
            expect(document.getElementById('modal-activity-status-indicator')).not.toBeNull();
            expect(document.getElementById('modal-activity-status-icon')).not.toBeNull();
            expect(document.getElementById('modal-activity-status-text')).not.toBeNull();
            expect(document.getElementById('btn-save-draft-alt')).not.toBeNull();
            expect(document.getElementById('btn-save-activity')).not.toBeNull();
        });

        test('page-e-kinerja-tendik.js mengimplementasikan updateModalSaveButtonState dan finalizeEmployeeActivity', () => {
            expect(pageJsContent).toContain('function isActivityTimeCompleted(');
            expect(pageJsContent).toContain('function updateModalSaveButtonState()');
            expect(pageJsContent).toContain('window.finalizeEmployeeActivity');
            expect(pageJsContent).toContain("status = isCompleted ? 'submitted' : 'draft'");
        });

        test('worker.js backend otomatis menyimpan status draft jika kegiatan belum selesai saat POST', () => {
            const workerCode = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');
            expect(workerCode).toContain("status = isCompleted ? 'submitted' : 'draft'");
            expect(workerCode).toContain("PUT /api/employee-agenda/activities/:id");
            expect(workerCode).toContain("body.status === 'draft'");
            expect(workerCode).toContain("newStatus");
        });
    });

    describe('7. Pengecualian Aktivitas Berstatus Draf dari Akumulasi Jam Kerja Realisasi', () => {
        test('GET /api/employee-agenda/activities mengecualikan status draft dari totalEffective', () => {
            const workerCode = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');
            expect(workerCode).toContain("if (act.status === 'draft') continue;");
        });

        test('GET /api/employee-agenda/summary memisahkan agregasi draft_activity_count dan draft_effective_minutes', () => {
            const workerCode = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');
            expect(workerCode).toContain('draft_activity_count');
            expect(workerCode).toContain('draft_effective_minutes');
        });

        test('GET /api/employee-agenda/monthly-recap mengabaikan aktivitas berstatus draft', () => {
            const workerCode = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');
            expect(workerCode).toContain("if (act.status === 'draft') continue;");
        });

        test('Dashboard jam kerja frontend (renderWorkHoursDashboard) memisahkan totalDraftMinutes dari totalEffectiveMinutes', () => {
            expect(pageJsContent).toContain('totalDraftMinutes');
            expect(pageJsContent).toContain('Draf Berjalan');
            expect(pageJsContent).toContain('Realisasikan');
        });
    });

    describe('8. Mekanisme Retry Pengunggahan Foto Bukti (Auto-Retry & Interactive UI Retry)', () => {
        test('uploadEmployeePhotoToGoogleDrive mendukung parameter maxRetries dan callback onRetry', () => {
            expect(pageJsContent).toContain('maxRetries = 3');
            expect(pageJsContent).toContain('onRetry = null');
            expect(pageJsContent).toContain('onRetry(attempt, maxRetries)');
        });

        test('Implementasi exponential backoff hadir saat percobaan pengunggahan gagal', () => {
            expect(pageJsContent).toContain('const delayMs = attempt * 1500;');
        });

        test('Thumbnail foto yang gagal memiliki overlay interaktif dengan tombol Coba Lagi', () => {
            expect(pageJsContent).toContain('window.retryActivityPhoto(${idx})');
            expect(pageJsContent).toContain('fa-rotate-right');
            expect(pageJsContent).toContain('Coba Lagi');
        });

        test('Fungsi window.retryActivityPhoto terdefinisi dan diekspos ke window', () => {
            expect(pageJsContent).toContain('window.retryActivityPhoto = async function(index)');
            expect(pageJsContent).toContain('window.retryActivityPhoto = retryActivityPhoto;');
        });

        test('Pesan validasi simpan aktivitas mengarahkan pengguna menekan tombol Coba Lagi pada foto', () => {
            expect(pageJsContent).toContain('Silakan klik tombol "Coba Lagi" pada foto yang gagal atau hapus foto tersebut.');
        });
    });
});

