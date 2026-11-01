/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

describe('Milestone 1 - Verifikasi Empiris Logika & Kontrak E-Kinerja Tendik', () => {
    let tendikHtml;
    let tendikJs;
    let workerCode;

    beforeAll(() => {
        tendikHtml = fs.readFileSync(path.join(__dirname, '../e-kinerja-tendik.html'), 'utf8');
        tendikJs = fs.readFileSync(path.join(__dirname, '../js/page-e-kinerja-tendik.js'), 'utf8');
        workerCode = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');
    });

    beforeEach(() => {
        document.documentElement.innerHTML = tendikHtml;
    });

    // =========================================================================
    // 1. VERIFIKASI LOGIKA: VALIDASI WAJIB FOTO BUKTI KEGIATAN (MINIMAL 1 FOTO)
    // =========================================================================
    describe('1. Validasi Foto Bukti Kegiatan (Minimal 1 Foto, Maksimal 2 Foto)', () => {
        test('1.1. HTML e-kinerja-tendik.html memuat badge wajib min. 1 foto dan grid foto', () => {
            expect(tendikHtml).toContain('Foto Bukti Kegiatan <span class="text-rose-500">*</span>');
            expect(tendikHtml).toContain('(Wajib min. 1 foto)');
            expect(document.getElementById('form-activity-photos-grid')).not.toBeNull();
            expect(document.getElementById('form-activity-photos-count')).not.toBeNull();
            expect(document.getElementById('form-activity-photo-input')).not.toBeNull();
            expect(document.getElementById('form-activity-photo-camera')).not.toBeNull();
        });

        test('1.2. saveEmployeeActivity menolak penyimpanan jika foto kosong (readyPhotos.length === 0)', () => {
            expect(tendikJs).toContain('const readyPhotos = _currentActivityPhotos');
            expect(tendikJs).toContain('if (readyPhotos.length === 0)');
            expect(tendikJs).toContain("window.showToast('Foto Bukti Kegiatan Wajib', 'Wajib mengunggah minimal 1 foto bukti kegiatan (maksimal 2 foto).', 'warning')");
        });

        test('1.3. saveEmployeeActivity menolak penyimpanan jika masih ada foto dalam proses uploading', () => {
            expect(tendikJs).toContain("const hasUploading = _currentActivityPhotos.some(p => p.state === 'uploading');");
            expect(tendikJs).toContain("if (hasUploading)");
            expect(tendikJs).toContain('Foto bukti sedang dalam proses pengunggahan');
        });

        test('1.4. saveEmployeeActivity menolak penyimpanan jika ada foto yang gagal diunggah', () => {
            expect(tendikJs).toContain("const hasFailed = _currentActivityPhotos.some(p => p.state === 'failed');");
            expect(tendikJs).toContain("if (hasFailed)");
            expect(tendikJs).toContain('Terdapat foto bukti yang gagal diunggah');
        });

        test('1.5. Batasan maksimal 2 foto diterapkan pada handleActivityPhotoFilesSelected', () => {
            expect(tendikJs).toContain('const MAX_EMPLOYEE_PHOTOS = 2;');
            expect(tendikJs).toContain('const availableSlots = MAX_EMPLOYEE_PHOTOS - _currentActivityPhotos.length;');
            expect(tendikJs).toContain('if (availableSlots <= 0)');
        });

        test('1.6. Backend Cloudflare Worker memvalidasi keberadaan foto bukti (400 Bad Request)', () => {
            expect(workerCode).toContain('const rawBukti = body.bukti_url !== undefined ? body.bukti_url : body.evidence_url;');
            expect(workerCode).toContain('let isValidPhoto = false;');
            expect(workerCode).toContain('Foto bukti kegiatan wajib diunggah minimal 1 foto');
        });
    });

    // =========================================================================
    // 2. VERIFIKASI LOGIKA: DETEKSI WAKTU KEGIATAN SELESAI VS WAKTU WITA
    // =========================================================================
    describe('2. Deteksi Waktu Kegiatan Selesai vs Waktu WITA (isActivityTimeCompleted)', () => {
        // Ekstraksi fungsi isActivityTimeCompleted murni dari page-e-kinerja-tendik.js
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

        test('2.1. Tanggal di masa depan selalu mengembalikan false (status: draft)', () => {
            expect(isActivityTimeCompleted('2099-12-31', '08:00')).toBe(false);
            expect(isActivityTimeCompleted('2099-01-01', '23:59')).toBe(false);
        });

        test('2.2. Tanggal di masa lalu selalu mengembalikan true (status: submitted / realisasi)', () => {
            expect(isActivityTimeCompleted('2020-01-01', '17:00')).toBe(true);
            expect(isActivityTimeCompleted('2025-06-15', '12:00')).toBe(true);
        });

        test('2.3. Input tidak valid (null/undefined/kosong) mengembalikan false secara aman', () => {
            expect(isActivityTimeCompleted('', '10:00')).toBe(false);
            expect(isActivityTimeCompleted('2026-10-09', '')).toBe(false);
            expect(isActivityTimeCompleted(null, null)).toBe(false);
        });

        test('2.4. Hari ini: jam selesai di masa depan mengembalikan false, jam selesai lewat mengembalikan true', () => {
            // Hitung jam WITA saat ini
            const now = new Date();
            const witaOffset = 8 * 60;
            const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
            const nowWita = new Date(utc + (witaOffset * 60000));
            const yyyy = nowWita.getFullYear();
            const mm = String(nowWita.getMonth() + 1).padStart(2, '0');
            const dd = String(nowWita.getDate()).padStart(2, '0');
            const todayWita = `${yyyy}-${mm}-${dd}`;

            // 00:01 pasti sudah lewat hari ini (kecuali tepat tengah malam)
            expect(isActivityTimeCompleted(todayWita, '00:00')).toBe(true);
            // 23:59 hampir pasti di masa depan
            expect(isActivityTimeCompleted(todayWita, '23:59')).toBe(false);
        });

        test('2.5. updateModalSaveButtonState mengontrol status visual Simpan Draf vs Simpan Realisasi', () => {
            expect(tendikJs).toContain('function updateModalSaveButtonState()');
            expect(tendikJs).toContain("btnLabel.textContent = 'Simpan Draf';");
            expect(tendikJs).toContain("btnLabel.textContent = 'Simpan Realisasi';");
            expect(tendikJs).toContain("btnDraftAlt.classList.add('hidden');");
            expect(tendikJs).toContain("btnDraftAlt.classList.remove('hidden');");
        });
    });

    // =========================================================================
    // 3. VERIFIKASI FUNGSI FINALIZE (window.finalizeEmployeeActivity)
    // =========================================================================
    describe('3. Fungsi Finalize (window.finalizeEmployeeActivity)', () => {
        test('3.1. finalizeEmployeeActivity didefinisikan pada window scope', () => {
            expect(tendikJs).toContain('window.finalizeEmployeeActivity = async function(id)');
        });

        test('3.2. finalizeEmployeeActivity mengirim mutasi update_status submitted ke cfClient', () => {
            expect(tendikJs).toContain("action: 'update_status'");
            expect(tendikJs).toContain("status: 'submitted'");
            expect(tendikJs).toContain("await cfClient.updateEmployeeActivity(id, payload)");
        });

        test('3.3. finalizeEmployeeActivity menyertakan konfirmasi modal dan feedback toast', () => {
            expect(tendikJs).toContain("showConfirmModal(");
            expect(tendikJs).toContain("Realisasikan aktivitas");
            expect(tendikJs).toContain("window.showToast('Berhasil Direalisasikan'");
            expect(tendikJs).toContain("await loadEmployeeDayData();");
        });

        test('3.4. Tombol Realisasikan pada daftar kegiatan hanya tampil jika status draf dan waktu telah selesai', () => {
            expect(tendikJs).toContain("const isDraft = (act.status === 'draft');");
            expect(tendikJs).toContain("const canFinalize = isDraft && isActivityTimeCompleted(act.tanggal || act.activity_date || selectedDate, act.end_time);");
            expect(tendikJs).toContain("const finalizeBtn = canFinalize");
            expect(tendikJs).toContain("window.finalizeEmployeeActivity('${act.id}')");
        });
    });

    // =========================================================================
    // 4. VERIFIKASI INTEGRITAS PEMANGGILAN API /api/employee-agenda/*
    // =========================================================================
    describe('4. Integritas Pemanggilan API /api/employee-agenda/*', () => {
        test('4.1. Preservasi pemanggilan API kegiatan pegawai pada cfClient', () => {
            expect(tendikJs).toContain('cfClient.getEmployeeActivities(');
            expect(tendikJs).toContain('cfClient.createEmployeeActivity(');
            expect(tendikJs).toContain('cfClient.updateEmployeeActivity(');
            expect(tendikJs).toContain('cfClient.deleteEmployeeActivity(');
            expect(tendikJs).toContain('cfClient.getEmployeeAgendaSummary(');
            expect(tendikJs).toContain('cfClient.getEmployeeMonthlyRecap(');
            expect(tendikJs).toContain('cfClient.manageEmployeeAgenda(');
        });

        test('4.2. cfClient memetakan rute persis ke /api/employee-agenda/*', () => {
            const cfClientCode = fs.readFileSync(path.join(__dirname, '../js/cloudflare-client.js'), 'utf8');
            expect(cfClientCode).toContain("path = '/api/employee-agenda/activities'");
            expect(cfClientCode).toContain("this.request('/api/employee-agenda/activities', {");
            expect(cfClientCode).toContain("this.request(`/api/employee-agenda/activities/${encodeURIComponent(id)}`, {");
            expect(cfClientCode).toContain("path = '/api/employee-agenda/summary'");
            expect(cfClientCode).toContain("path = '/api/employee-agenda/monthly-recap'");
            expect(cfClientCode).toContain("this.request('/api/employee-agenda/manage', {");
        });

        test('4.3. Cloudflare Worker mendefinisikan seluruh handler rute /api/employee-agenda/*', () => {
            expect(workerCode).toContain('path === "/api/employee-agenda/activities" && method === "GET"');
            expect(workerCode).toContain('path === "/api/employee-agenda/activities" && method === "POST"');
            expect(workerCode).toContain('path.startsWith("/api/employee-agenda/activities/") && method === "PUT"');
            expect(workerCode).toContain('path.startsWith("/api/employee-agenda/activities/") && method === "DELETE"');
            expect(workerCode).toContain('path === "/api/employee-agenda/summary" && method === "GET"');
            expect(workerCode).toContain('path === "/api/employee-agenda/monthly-recap" && method === "GET"');
            expect(workerCode).toContain('path === "/api/employee-agenda/manage"');
            expect(workerCode).toContain('method === "POST"');
        });
    });

    // =========================================================================
    // 5. STRESS-TEST & FAILURE MODES (ADVERSARIAL CHALLENGE)
    // =========================================================================
    describe('5. Stress-Test & Adversarial Failure Modes', () => {
        function parseEvidencePhotos(raw) {
            if (!raw) return [];
            if (Array.isArray(raw)) {
                return raw.map((item, idx) => {
                    if (typeof item === 'string') {
                        return { url: item, fileId: '', name: `Foto Bukti ${idx + 1}` };
                    }
                    if (item && item.url) {
                        return {
                            url: item.url,
                            fileId: item.fileId || '',
                            name: item.name || `Foto Bukti ${idx + 1}`
                        };
                    }
                    return null;
                }).filter(Boolean);
            }
            if (typeof raw === 'object' && raw.url) {
                return [{ url: raw.url, fileId: raw.fileId || '', name: raw.name || 'Foto Bukti' }];
            }
            if (typeof raw === 'string') {
                const trimmed = raw.trim();
                if (!trimmed) return [];
                if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                    try {
                        const parsed = JSON.parse(trimmed);
                        return parseEvidencePhotos(parsed);
                    } catch (_) {
                        return [];
                    }
                }
                if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                    return [{ url: trimmed, fileId: '', name: 'Foto Bukti' }];
                }
            }
            return [];
        }

        test('5.1. Adversarial input pada parseEvidencePhotos tidak menyebabkan unhandled exception', () => {
            expect(parseEvidencePhotos(null)).toEqual([]);
            expect(parseEvidencePhotos(undefined)).toEqual([]);
            expect(parseEvidencePhotos('')).toEqual([]);
            expect(parseEvidencePhotos('    ')).toEqual([]);
            expect(parseEvidencePhotos('invalid JSON string [')).toEqual([]);
            expect(parseEvidencePhotos('{not a json}')).toEqual([]);
            expect(parseEvidencePhotos(12345)).toEqual([]);
            expect(parseEvidencePhotos(true)).toEqual([]);
            expect(parseEvidencePhotos({})).toEqual([]);
            expect(parseEvidencePhotos([])).toEqual([]);
            expect(parseEvidencePhotos([null, undefined, 123, 'https://example.com/photo.jpg'])).toHaveLength(1);
        });

        test('5.2. Format JSON array valid diparse menjadi objek foto terstruktur', () => {
            const rawJson = JSON.stringify([
                { url: 'https://lh3.googleusercontent.com/d/abc123', fileId: 'abc123', name: 'Foto 1' },
                { url: 'https://lh3.googleusercontent.com/d/def456', fileId: 'def456', name: 'Foto 2' }
            ]);
            const res = parseEvidencePhotos(rawJson);
            expect(res).toHaveLength(2);
            expect(res[0].url).toBe('https://lh3.googleusercontent.com/d/abc123');
            expect(res[0].fileId).toBe('abc123');
            expect(res[1].url).toBe('https://lh3.googleusercontent.com/d/def456');
            expect(res[1].fileId).toBe('def456');
        });

        test('5.3. Backward-compatibility: URL tunggal langsung diparse sebagai 1 foto', () => {
            const singleUrl = 'https://drive.google.com/uc?id=xyz789';
            const res = parseEvidencePhotos(singleUrl);
            expect(res).toHaveLength(1);
            expect(res[0].url).toBe(singleUrl);
        });
    });

    // =========================================================================
    // 6. ISOLASI PENUGASAN KEPALA SEKOLAH VS TENDIK & UI/UX MODAL REALISASI
    // =========================================================================
    describe('6. Isolasi Penugasan Kepala Sekolah vs Tendik & UI/UX Modal Realisasi', () => {
        const dummyGroups = [
            { id: 'ks-1', group_name: 'Visi dan Budaya Belajar', is_principal: 1, urutan: 1 },
            { id: 'ks-2', group_name: 'Iklim Lingkungan Belajar', is_principal: 1, urutan: 2 },
            { id: 'ks-3', group_name: 'Kurikulum dan Pembelajaran', is_principal: 1, urutan: 3 },
            { id: 'ks-4', group_name: 'Tata Kelola dan Sumber Daya', is_principal: 1, urutan: 4 },
            { id: 'ks-5', group_name: 'Kemitraan Eksternal', is_principal: 1, urutan: 5 },
            { id: 'ks-6', group_name: 'Kepemimpinan Transformasional', is_principal: 1, urutan: 6 },
            { id: 'staf-1', group_name: 'Layanan Administrasi Kepegawaian', is_principal: 0, urutan: 1 },
            { id: 'staf-2', group_name: 'Layanan Administrasi Keuangan', is_principal: 0, urutan: 2 },
            { id: 'staf-3', group_name: 'Layanan Pengelolaan Sarana Prasarana', is_principal: 0, urutan: 3 }
        ];

        function isPrincipalGroupTest(g) {
            if (!g) return false;
            return Boolean(g.is_principal || g.is_kepsek || String(g.id || '').startsWith('ks-'));
        }

        function filterGroupsForTarget(groups, isTargetKs) {
            if (isTargetKs) {
                return groups.filter(g => isPrincipalGroupTest(g));
            }
            return groups.filter(g => !isPrincipalGroupTest(g));
        }

        test('6.1. Saat target adalah Kepala Sekolah, HANYA butir penugasan KS yang muncul (0 butir tendik)', () => {
            const ksOptions = filterGroupsForTarget(dummyGroups, true);
            expect(ksOptions).toHaveLength(6);
            expect(ksOptions.every(g => isPrincipalGroupTest(g))).toBe(true);
            expect(ksOptions.some(g => !isPrincipalGroupTest(g))).toBe(false);
        });

        test('6.2. Saat target adalah Tendik/Pegawai biasa, HANYA butir tendik yang muncul (0 butir KS)', () => {
            const staffOptions = filterGroupsForTarget(dummyGroups, false);
            expect(staffOptions).toHaveLength(3);
            expect(staffOptions.every(g => !isPrincipalGroupTest(g))).toBe(true);
            expect(staffOptions.some(g => isPrincipalGroupTest(g))).toBe(false);
        });

        test('6.3. populateActivityGroupOptions tidak menambahkan suffix "(Kepsek)" pada opsi dropdown', () => {
            expect(tendikJs).not.toContain("const suffix = isKs ? ' (Kepsek)'");
            expect(tendikJs).toContain("const suffix = isKs ? '' : (isAssigned ? ' (Tugas SK)' : '');");
        });

        test('6.4. Tombol kelola butir tugas pokok di dalam modal disembunyikan permanen', () => {
            const btnQuickManage = document.getElementById('btn-quick-manage-principal-tasks');
            expect(btnQuickManage).not.toBeNull();
            expect(btnQuickManage.classList.contains('hidden')).toBe(true);
            expect(btnQuickManage.getAttribute('style')).toContain('display: none !important');
            expect(tendikJs).toContain("quickManageBtn.classList.add('hidden');");
        });

        test('6.5. Kotak uraian butir tugas pokok Kepala Sekolah memiliki tipografi yang diperbesar', () => {
            const containerDesc = document.getElementById('container-principal-task-description');
            const textDesc = document.getElementById('text-principal-task-description');
            expect(containerDesc).not.toBeNull();
            expect(textDesc).not.toBeNull();

            // Font heading dan teks uraian harus memuat kelas ukuran yang diperbesar
            expect(containerDesc.innerHTML).toContain('text-xs sm:text-[13px]');
            expect(textDesc.className).toContain('text-xs sm:text-sm font-medium');
        });

        test('6.6. Lokasi pelaksanaan dikosongkan untuk Kepala Sekolah dan default Ruang Tata Usaha untuk staf', () => {
            expect(tendikJs).toContain("const isTargetKs = isCurrentTargetPrincipal();");
            expect(tendikJs).toContain("document.getElementById('form-activity-location').value = isTargetKs ? '' : 'Ruang Tata Usaha';");
            expect(tendikJs).toContain("if (locInput && !locInput.value.trim() && !isPrincipal) {");
            expect(tendikJs).toContain("locInput.value = 'Ruang Tata Usaha';");
        });
    });
});

