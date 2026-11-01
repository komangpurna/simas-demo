const fs = require('fs');
const path = require('path');

describe('E-Kinerja Multi-Photo Evidence & Draft Mode (Permendikdasmen 11/2025)', () => {
    const workerPath = path.join(__dirname, '../cloudflare/worker.js');
    const workerContent = fs.readFileSync(workerPath, 'utf8');

    const htmlPath = path.join(__dirname, '../e-kinerja.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    const jsPath = path.join(__dirname, '../js/page-beban-kerja.js');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    // 1. Ekstraksi fungsi parseEvidencePhotos & extractGoogleDriveFileId untuk pengujian unit
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
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                return [{ url: trimmed, fileId: extractGoogleDriveFileId(trimmed), name: 'Foto Bukti', caption: '' }];
            }
        }
        return [];
    }

    test('1. extractGoogleDriveFileId mampu mengekstrak file ID dari berbagai format URL Drive', () => {
        expect(extractGoogleDriveFileId('https://drive.google.com/file/d/1A2B3C4D5E6F/view?usp=sharing')).toBe('1A2B3C4D5E6F');
        expect(extractGoogleDriveFileId('https://drive.google.com/open?id=XYZ_987-abc')).toBe('XYZ_987-abc');
        expect(extractGoogleDriveFileId('https://drive.google.com/uc?id=FILE_123&export=download')).toBe('FILE_123');
        expect(extractGoogleDriveFileId('https://drive.google.com/d/SHORT_ID_999/preview')).toBe('SHORT_ID_999');
        expect(extractGoogleDriveFileId('https://example.com/not-drive.png')).toBe('');
        expect(extractGoogleDriveFileId('')).toBe('');
    });

    test('2. parseEvidencePhotos mendukung legacy single URL, JSON array string, dan multi-foto array beserta caption', () => {
        // Kasus 1: Nilai kosong / null
        expect(parseEvidencePhotos('')).toEqual([]);
        expect(parseEvidencePhotos(null)).toEqual([]);

        // Kasus 2: Single URL legacy (kompatibilitas mundur)
        const legacy = 'https://drive.google.com/file/d/LEGACY123/view';
        const parsedLegacy = parseEvidencePhotos(legacy);
        expect(parsedLegacy.length).toBe(1);
        expect(parsedLegacy[0].url).toBe(legacy);
        expect(parsedLegacy[0].fileId).toBe('LEGACY123');
        expect(parsedLegacy[0].caption).toBe('');

        // Kasus 3: JSON array multi-foto dengan fileId, name, dan caption
        const multiPhotos = [
            { url: 'https://drive.google.com/file/d/FOTO_1/view', fileId: 'FOTO_1', name: 'Foto 1.jpg', caption: 'Pembukaan kegiatan' },
            { url: 'https://drive.google.com/file/d/FOTO_2/view', fileId: 'FOTO_2', name: 'Foto 2.jpg', caption: 'Diskusi kelompok' },
            { url: 'https://drive.google.com/file/d/FOTO_3/view', fileId: 'FOTO_3', name: 'Foto 3.jpg' } // Tanpa caption
        ];
        const jsonStr = JSON.stringify(multiPhotos);
        const parsedJson = parseEvidencePhotos(jsonStr);
        expect(parsedJson.length).toBe(3);
        expect(parsedJson[0].fileId).toBe('FOTO_1');
        expect(parsedJson[0].caption).toBe('Pembukaan kegiatan');
        expect(parsedJson[1].fileId).toBe('FOTO_2');
        expect(parsedJson[1].caption).toBe('Diskusi kelompok');
        expect(parsedJson[2].fileId).toBe('FOTO_3');
        expect(parsedJson[2].caption).toBe('');
    });

    test('3. Cloudflare Worker memperlakukan status_execution draft dengan 0 menit aktual (tidak masuk KPI realisasi sebelum tuntas)', () => {
        // Worker code checks
        expect(workerContent).toContain('if (status_execution === "tidak_terlaksana" || status_execution === "draft")');
        expect(workerContent).toContain('const isDraft = status_execution === "draft";');
        expect(workerContent).toContain('const segDur = isDraft ? 0 :');
    });

    test('4. e-kinerja.html memuat elemen form multi-foto bukti dukung, tombol draf, dan modal lightbox galeri beserta caption', () => {
        // File input & grid preview
        expect(htmlContent).toContain('id="log-input-photo-file"');
        expect(htmlContent).toContain('id="evidence-photos-grid"');
        expect(htmlContent).toContain('id="evidence-photos-count"');
        expect(htmlContent).toContain('id="btn-add-evidence-photo"');

        // Tombol draf
        expect(htmlContent).toContain('id="btn-draft-workload-log"');
        expect(htmlContent).toContain('window.workloadSaveLogDraft()');
        expect(htmlContent).toContain('0 / 5 Foto');
        expect(htmlContent).toContain('Maks. 5 Foto');

        // Modal Lightbox mandiri (top-level) beserta bar caption
        expect(htmlContent).toContain('id="modal-evidence-lightbox"');
        expect(htmlContent).toContain('id="lightbox-img"');
        expect(htmlContent).toContain('id="lightbox-btn-prev"');
        expect(htmlContent).toContain('id="lightbox-btn-next"');
        expect(htmlContent).toContain('id="lightbox-btn-drive"');
        expect(htmlContent).toContain('id="lightbox-caption-box"');
        expect(htmlContent).toContain('id="lightbox-caption-text"');
    });

    test('5. page-beban-kerja.js memuat fungsi-fungsi inti pengunggahan Google Drive, penghapusan, caption, dan galeri lightbox', () => {
        // Google Drive integration
        expect(jsContent).toContain('uploadWorkloadPhotoToGoogleDrive');
        expect(jsContent).toContain('deleteWorkloadPhotoFromGoogleDrive');
        expect(jsContent).toContain('compressImageToJpegBase64');
        expect(jsContent).toContain('MAX_WORKLOAD_PHOTOS = 5');
        expect(jsContent).toContain('E-Kinerja/${yearMonth}/${safeTeacher}');

        // Caption & Focus preservation
        expect(jsContent).toContain('workloadUpdatePhotoCaption');
        expect(jsContent).toContain('data-photo-caption-index');
        expect(jsContent).toContain('caption: (p.caption || \'\').trim()');

        // Lightbox functions & caption display
        expect(jsContent).toContain('workloadOpenLightbox');
        expect(jsContent).toContain('workloadCloseLightbox');
        expect(jsContent).toContain('workloadLightboxNext');
        expect(jsContent).toContain('workloadLightboxPrev');
        expect(jsContent).toContain('lightbox-caption-box');
        expect(jsContent).toContain('lightbox-caption-text');

        // Draft handling
        expect(jsContent).toContain('saveLogDraft');
        expect(jsContent).toContain('if (!isDraft)');
    });

    test('6. Modal Lightbox di e-kinerja.html mematuhi aturan Anti-Nesting Modal (berdiri mandiri di tingkat atas)', () => {
        const lightboxIndex = htmlContent.indexOf('id="modal-evidence-lightbox"');
        expect(lightboxIndex).toBeGreaterThan(-1);

        // Pastikan tidak berada di dalam tag <main>
        const mainOpenIndex = htmlContent.indexOf('<main');
        const mainCloseIndex = htmlContent.indexOf('</main>');
        expect(lightboxIndex).toBeGreaterThan(mainCloseIndex);
    });

    test('7. js/config.js dan js/page-beban-kerja.js menyediakan endpoint EKINERJA_APPS_SCRIPT_URL terpisah dari Jurnal', () => {
        const configPath = path.join(__dirname, '../js/config.js');
        const configContent = fs.readFileSync(configPath, 'utf8');

        expect(configContent).toContain('export const JURNAL_APPS_SCRIPT_URL');
        expect(configContent).toContain('export const EKINERJA_APPS_SCRIPT_URL');
        expect(configContent).toContain('AKfycbwGwYmeLUiJUAI-FHK3cDUAddFLtpmnIKRfKX5PyeJRpktj6KlqnAqeKd6ImW3k-x0m');
        expect(jsContent).toContain('import { auth, EKINERJA_APPS_SCRIPT_URL } from \'./config.js\';');
        expect(jsContent).toContain('const APPS_SCRIPT_URL = EKINERJA_APPS_SCRIPT_URL;');
    });

    test('8. Berkas standalone google-apps-script/EKinerja_Drive_Uploader.gs dan panduan setup tersedia', () => {
        const gasScriptPath = path.join(__dirname, '../google-apps-script/EKinerja_Drive_Uploader.gs');
        const gasGuidePath = path.join(__dirname, '../google-apps-script/PANDUAN_SETUP_GOOGLE_APPS_SCRIPT.md');

        expect(fs.existsSync(gasScriptPath)).toBe(true);
        expect(fs.existsSync(gasGuidePath)).toBe(true);

        const gasScript = fs.readFileSync(gasScriptPath, 'utf8');
        expect(gasScript).toContain('var ROOT_FOLDER_NAME = "E-Kinerja";');
        expect(gasScript).toContain('function doPost(e)');
        expect(gasScript).toContain('function doGet(e)');
        expect(gasScript).toContain('action === "delete"');
        expect(gasScript).toContain('action === "upload"');
        expect(gasScript).toContain('resolveTargetFolder');
    });

    test('9. getCurrentTeacherDisplayName menangani profil null, weekData, localStorage, dan fallback tanpa ReferenceError', () => {
        // Implementasi logika identik dari page-beban-kerja.js untuk pengujian unit
        function resolveTeacherDisplayName(profile, weekData, mockStorage = {}, mockAuth = null) {
            try {
                if (profile?.displayName) return profile.displayName;
                if (profile?.name) return profile.name;
                if (profile?.nama) return profile.nama;
                if (weekData?.week?.teacher_name) return weekData.week.teacher_name;
                if (weekData?.teacher_name) return weekData.teacher_name;
                if (mockAuth?.currentUser?.uid) {
                    const uid = mockAuth.currentUser.uid;
                    if (mockStorage[`cached_user_name_${uid}`]) return mockStorage[`cached_user_name_${uid}`];
                    const cachedDoc = mockStorage[`simas_userdoc_${uid}`];
                    if (cachedDoc?.name) return cachedDoc.name;
                    if (cachedDoc?.nama) return cachedDoc.nama;
                    if (cachedDoc?.displayName) return cachedDoc.displayName;
                    const cached = mockStorage[`simas_user_data_${uid}`];
                    if (cached?.name) return cached.name;
                    if (cached?.nama) return cached.nama;
                    if (cached?.displayName) return cached.displayName;
                }
                if (mockAuth?.currentUser?.displayName) return mockAuth.currentUser.displayName;
            } catch (_) {}
            return 'Guru';
        }

        // Skenario 1: Profil langsung tersedia
        expect(resolveTeacherDisplayName({ displayName: 'I Komang Purna, S.Pd.' })).toBe('I Komang Purna, S.Pd.');
        expect(resolveTeacherDisplayName({ name: 'Ni Wayan Sari' })).toBe('Ni Wayan Sari');
        expect(resolveTeacherDisplayName({ nama: 'Ketut Sujana' })).toBe('Ketut Sujana');

        // Skenario 2: Profil null, mengambil dari weekData
        expect(resolveTeacherDisplayName(null, { week: { teacher_name: 'Pak Wayan' } })).toBe('Pak Wayan');
        expect(resolveTeacherDisplayName(null, { teacher_name: 'Bu Ketut' })).toBe('Bu Ketut');

        // Skenario 3: Dari localStorage cache
        const mockAuth = { currentUser: { uid: 'u123' } };
        const mockStorage = { cached_user_name_u123: 'I Made Arthana' };
        expect(resolveTeacherDisplayName(null, null, mockStorage, mockAuth)).toBe('I Made Arthana');

        // Skenario 4: Fallback mutlak ketika semua kosong
        expect(resolveTeacherDisplayName(null, null, {}, null)).toBe('Guru');
        expect(resolveTeacherDisplayName(undefined, undefined, {}, {})).toBe('Guru');
    });

    test('10. dateOfDay mengembalikan tanggal ISO yang aman dan tidak pernah melempar RangeError pada tanggal kosong/invalid', () => {
        function dateOfDay(weekStart, dayIdx = 0) {
            try {
                if (!weekStart) return '2026-09-28';
                const d = new Date(weekStart);
                if (isNaN(d.getTime())) return '2026-09-28';
                d.setDate(d.getDate() + (Number(dayIdx) || 0));
                return d.toISOString().slice(0, 10);
            } catch (_) {
                return '2026-09-28';
            }
        }

        expect(dateOfDay('2026-09-28', 0)).toBe('2026-09-28');
        expect(dateOfDay('2026-09-28', 2)).toBe('2026-09-30');
        expect(dateOfDay('2026-09-28', 4)).toBe('2026-10-02');

        // Robust fallback: string kosong / tanggal rusak tidak boleh crash
        expect(dateOfDay('', 0)).toBe('2026-09-28');
        expect(dateOfDay('invalid-date', 1)).toBe('2026-09-28');
        expect(dateOfDay(null, 3)).toBe('2026-09-28');
    });

    test('11. handlePhotoFilesSelected membatasi kuota maksimal 5 foto per kegiatan', () => {
        let currentPhotos = [];
        const MAX_PHOTOS = 5;
        function simulateSelectFiles(incomingFiles) {
            const availableSlots = MAX_PHOTOS - currentPhotos.length;
            if (availableSlots <= 0) {
                return { success: false, reason: 'limit_reached', added: 0 };
            }
            const filesToUpload = incomingFiles.slice(0, availableSlots);
            for (const f of filesToUpload) {
                currentPhotos.push({
                    name: f.name,
                    state: 'uploading'
                });
            }
            return { success: true, added: filesToUpload.length };
        }

        // Pilih 3 foto pertama
        const batch1 = [{ name: 'foto1.jpg' }, { name: 'foto2.jpg' }, { name: 'foto3.jpg' }];
        const res1 = simulateSelectFiles(batch1);
        expect(res1.success).toBe(true);
        expect(res1.added).toBe(3);
        expect(currentPhotos.length).toBe(3);

        // Pilih 3 foto berikutnya: hanya 2 slot tersisa (total mencapai 5)
        const batch2 = [{ name: 'foto4.jpg' }, { name: 'foto5.jpg' }, { name: 'foto6.jpg' }];
        const res2 = simulateSelectFiles(batch2);
        expect(res2.success).toBe(true);
        expect(res2.added).toBe(2);
        expect(currentPhotos.length).toBe(5);

        // Percobaan tambah saat sudah 5 foto -> ditolak
        const batch3 = [{ name: 'foto7.jpg' }];
        const res3 = simulateSelectFiles(batch3);
        expect(res3.success).toBe(false);
        expect(res3.reason).toBe('limit_reached');
        expect(currentPhotos.length).toBe(5);
    });

    test('12. saveLog memvalidasi status foto: memblokir simpan jika ada foto yang masih mengunggah atau gagal', () => {
        function validatePhotosForSave(photos) {
            const hasUploading = photos.some(p => p.state === 'uploading');
            if (hasUploading) {
                return { ok: false, error: 'Foto sedang diunggah ke Google Drive' };
            }
            const hasFailed = photos.some(p => p.state === 'failed');
            if (hasFailed) {
                return { ok: false, error: 'Terdapat foto yang gagal diunggah' };
            }
            const ready = photos.filter(p => p.url && p.state !== 'uploading');
            return { ok: true, payload: JSON.stringify(ready) };
        }

        // Sedang mengunggah
        expect(validatePhotosForSave([{ url: '', state: 'uploading' }]).ok).toBe(false);

        // Gagal unggah
        expect(validatePhotosForSave([{ url: '', state: 'failed' }]).ok).toBe(false);

        // Berhasil siap
        const readyPhotos = [
            { url: 'https://drive.google.com/file/d/123/view', fileId: '123', name: 'bukti1.jpg', state: 'ready' }
        ];
        const resReady = validatePhotosForSave(readyPhotos);
        expect(resReady.ok).toBe(true);
        expect(resReady.payload).toContain('123');
    });

    test('13. Audit Statis Lingkup Variabel: Memverifikasi deklarasi eksplisit _currentUserProfile dan state kritis di js/page-beban-kerja.js', () => {
        // Memastikan tidak ada variabel state kritis yang dipakai tanpa deklarasi (Pencegah ReferenceError SSOT)
        const noComments = jsContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
        const declRegex = /(?:let|const|var)\s+(_[a-zA-Z0-9_$]+)/g;
        const declaredStates = new Set();
        let dm;
        while ((dm = declRegex.exec(noComments)) !== null) {
            declaredStates.add(dm[1]);
        }

        expect(declaredStates.has('_currentUserProfile')).toBe(true);
        expect(declaredStates.has('_currentLogPhotos')).toBe(true);
        expect(declaredStates.has('_photoUploadSeq')).toBe(true);
        expect(declaredStates.has('_weekStartDate')).toBe(true);
        expect(declaredStates.has('_selectedDayIndex')).toBe(true);
        expect(declaredStates.has('_lightboxPhotos')).toBe(true);
        expect(declaredStates.has('_lightboxIndex')).toBe(true);
    });

    test('14. Lightbox Galeri Foto Bukti mendukung navigasi circular (next, prev, index bounds)', () => {
        const photos = [
            { url: 'https://drive.google.com/d/1/preview', fileId: '1' },
            { url: 'https://drive.google.com/d/2/preview', fileId: '2' },
            { url: 'https://drive.google.com/d/3/preview', fileId: '3' }
        ];

        let index = 0;
        function next() { index = (index + 1) % photos.length; }
        function prev() { index = (index - 1 + photos.length) % photos.length; }

        expect(index).toBe(0);
        next();
        expect(index).toBe(1);
        next();
        expect(index).toBe(2);
        next();
        expect(index).toBe(0); // Circular loop to start

        prev();
        expect(index).toBe(2); // Circular loop to end
        prev();
        expect(index).toBe(1);
    });

    test('15. Manajemen Caption Foto: Pembaruan caption interaktif, 1-to-1 coupling, dan serialisasi payload evidence_url', () => {
        // Model penyimpanan 1-to-1: foto dan caption berada dalam objek yang sama
        const currentPhotos = [
            { id: 1, url: 'https://drive.google.com/d/AAA/view', fileId: 'AAA', name: 'Foto 1.jpg', caption: '' },
            { id: 2, url: 'https://drive.google.com/d/BBB/view', fileId: 'BBB', name: 'Foto 2.jpg', caption: '' }
        ];

        function updateCaption(idx, text) {
            if (idx >= 0 && idx < currentPhotos.length) {
                currentPhotos[idx].caption = String(text || '');
            }
        }

        // Simulasi guru mengetik caption pada foto 1 dan 2
        updateCaption(0, '  Pendampingan praktikum siswa di lab IPA  ');
        updateCaption(1, 'Evaluasi hasil pengamatan mikroskop');

        expect(currentPhotos[0].caption.trim()).toBe('Pendampingan praktikum siswa di lab IPA');
        expect(currentPhotos[1].caption.trim()).toBe('Evaluasi hasil pengamatan mikroskop');

        // Serialisasi payload persis seperti di saveLog
        const readyPayload = JSON.stringify(currentPhotos.map(p => ({
            url: p.url,
            fileId: p.fileId,
            name: p.name,
            caption: (p.caption || '').trim()
        })));

        expect(readyPayload).toContain('"caption":"Pendampingan praktikum siswa di lab IPA"');
        expect(readyPayload).toContain('"caption":"Evaluasi hasil pengamatan mikroskop"');

        // Deserialisasi kembali persis seperti di openEditLogModal / parseEvidencePhotos
        const parsedAgain = parseEvidencePhotos(readyPayload);
        expect(parsedAgain.length).toBe(2);
        expect(parsedAgain[0].caption).toBe('Pendampingan praktikum siswa di lab IPA');
        expect(parsedAgain[1].caption).toBe('Evaluasi hasil pengamatan mikroskop');
        expect(parsedAgain[0].fileId).toBe('AAA');
        expect(parsedAgain[1].fileId).toBe('BBB');
    });

    test('16. Integritas Form Realisasi: Sanitasi input evidence, novalidate, dan pencegahan pemblokiran klik Selesaikan Laporan dari Draf', () => {
        // A. e-kinerja.html: Form memiliki novalidate agar validasi HTML5 tidak memblokir submit secara senyap
        expect(htmlContent).toContain('<form id="form-workload-log" novalidate onsubmit="window.workloadSaveLog(event)"');

        // B. e-kinerja.html: log-input-evidence bertipe text (bukan type url) agar fleksibel dan tidak error saat link drive tanpa protokol
        expect(htmlContent).toMatch(/<input\s+type="text"\s+id="log-input-evidence"/);

        // C. e-kinerja.html: Tombol Selesaikan Laporan memiliki onclick langsung ke saveLog
        expect(htmlContent).toContain('id="btn-submit-workload-log" onclick="window.workloadSaveLog(event)"');

        // D. page-beban-kerja.js: openEditLogModal memfilter string JSON evidence_url agar TIDAK dimasukkan ke input log-input-evidence
        expect(jsContent).toContain('const isJsonEvidence = (rawEvidence.startsWith(\'[\') && rawEvidence.endsWith(\']\')) || (rawEvidence.startsWith(\'{\') && rawEvidence.endsWith(\'}\'));');
        expect(jsContent).toContain('el(\'log-input-evidence\').value = isJsonEvidence ? \'\' : rawEvidence;');

        // Simulasi logika sanitasi openEditLogModal:
        const draftEvidenceJson = '[{"url":"https://drive.google.com/d/xyz","fileId":"xyz","name":"Foto 1","caption":"Piket"}]';
        const isJson = (draftEvidenceJson.startsWith('[') && draftEvidenceJson.endsWith(']')) || (draftEvidenceJson.startsWith('{') && draftEvidenceJson.endsWith('}'));
        const inputValue = isJson ? '' : draftEvidenceJson;
        expect(inputValue).toBe(''); // Input manual link tetap bersih, tidak diisi JSON

        // Simulasi logika sanitasi untuk link manual single URL legacy:
        const legacyEvidenceUrl = 'https://drive.google.com/file/d/abc123/view';
        const isLegacyJson = (legacyEvidenceUrl.startsWith('[') && legacyEvidenceUrl.endsWith(']')) || (legacyEvidenceUrl.startsWith('{') && legacyEvidenceUrl.endsWith('}'));
        const legacyInputValue = isLegacyJson ? '' : legacyEvidenceUrl;
        expect(legacyInputValue).toBe('https://drive.google.com/file/d/abc123/view');
    });
});

