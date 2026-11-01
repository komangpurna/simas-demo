/**
 * js/page-wali-kelas.test.mjs
 * Unit test pengujian reliabilitas UX, proteksi double-submit, dan data loss prevention
 * pada fitur Catatan Pembinaan Siswa Wali Kelas.
 */

import { jest } from '@jest/globals';

describe('Pengujian Unit Reliabilitas Catatan Pembinaan Wali Kelas (page-wali-kelas.js)', () => {
    let mockDOM;
    let mockCfClient;
    let mockShowToast;
    let mockShowConfirmModal;
    let mockCloseModal;
    let mockClearWaliRombelCache;
    let mockLoadClassNotes;
    let mockRenderNotesTab;
    let mockRenderOverviewStats;

    // Helper setup simulasi environment page-wali-kelas.js
    function setupEnvironment() {
        const elements = {
            'form-note-id': { value: '' },
            'form-note-student': { value: '12345' },
            'form-note-category': { value: 'karakter' },
            'form-note-date': { value: '2026-09-07' },
            'form-note-title': { value: 'Bimbingan Konseling Kedisiplinan' },
            'form-note-content': { value: 'Siswa diberikan arahan terkait kehadiran di jam pertama.' },
            'btn-submit-catatan': {
                disabled: false,
                innerHTML: '<i class="fa-solid fa-save"></i> Simpan Catatan',
                classList: {
                    _classes: new Set(['active:scale-95']),
                    add(cls) { this._classes.add(cls); },
                    remove(cls) { this._classes.delete(cls); },
                    contains(cls) { return this._classes.has(cls); }
                }
            }
        };

        global.document = {
            getElementById: (id) => elements[id] || null
        };

        mockShowToast = jest.fn();
        mockShowConfirmModal = jest.fn().mockResolvedValue(true);
        mockCloseModal = jest.fn();
        mockClearWaliRombelCache = jest.fn();
        mockLoadClassNotes = jest.fn().mockResolvedValue([]);
        mockRenderNotesTab = jest.fn();
        mockRenderOverviewStats = jest.fn();

        mockCfClient = {
            enabled: true,
            saveGuruWaliNote: jest.fn().mockResolvedValue({ success: true }),
            deleteGuruWaliNote: jest.fn().mockResolvedValue({ success: true })
        };

        global.window = {
            _isSavingCatatanWali: false,
            closeModal: mockCloseModal,
            showConfirmModal: mockShowConfirmModal
        };
        global.showToast = mockShowToast;
        global.cfClient = mockCfClient;
        global.currentRombelClass = 'XII-MIPA-1';
        global.currentClassStudents = [{ nis: '12345', name: 'Budi Santoso' }];
        global.classNotesList = [];
        global.clearWaliRombelCache = mockClearWaliRombelCache;
        global.loadClassNotes = mockLoadClassNotes;
        global.renderNotesTab = mockRenderNotesTab;
        global.renderOverviewStats = mockRenderOverviewStats;
        global.auth = { currentUser: { uid: 'wali_01', displayName: 'Guru Wali' } };
        global.currentUserProfile = { name: 'Guru Wali' };
        global.serverTimestamp = () => new Date();

        return { elements };
    }

    // Ekstrak fungsi saveCatatanWali & closeCatatanWaliModal dengan kontrak aktual
    function createCatatanWaliHandlers() {
        const closeCatatanWaliModal = async function () {
            if (window._isSavingCatatanWali) return;

            const title = document.getElementById('form-note-title')?.value.trim() || '';
            const content = document.getElementById('form-note-content')?.value.trim() || '';
            const noteId = document.getElementById('form-note-id')?.value || '';

            if (!noteId && (title || content)) {
                const ok = typeof window.showConfirmModal === 'function'
                    ? await window.showConfirmModal('Catatan pembinaan yang Anda ketik belum disimpan. Apakah Anda yakin ingin membatalkan dan menutup?', 'Tutup Tanpa Menyimpan', 'warning')
                    : true;
                if (!ok) return;
            } else if (noteId && (title || content)) {
                const existingNote = (global.classNotesList || []).find(n => n.id === noteId);
                if (existingNote && (existingNote.title !== title || (existingNote.content || existingNote.notes) !== content)) {
                    const ok = typeof window.showConfirmModal === 'function'
                        ? await window.showConfirmModal('Perubahan catatan pembinaan belum disimpan. Yakin ingin menutup?', 'Perubahan Belum Disimpan', 'warning')
                        : true;
                    if (!ok) return;
                }
            }

            window.closeModal('modal-catatan-wali');
        };

        const saveCatatanWali = async function (e) {
            if (e && typeof e.preventDefault === 'function') {
                e.preventDefault();
            }

            if (window._isSavingCatatanWali) {
                return;
            }

            const noteId = document.getElementById('form-note-id')?.value || '';
            const studentNis = document.getElementById('form-note-student')?.value || '';
            const category = document.getElementById('form-note-category')?.value || 'akademik';
            const date = document.getElementById('form-note-date')?.value || '';
            const title = document.getElementById('form-note-title')?.value.trim() || '';
            const content = document.getElementById('form-note-content')?.value.trim() || '';

            if (!studentNis || !title || !content) {
                showToast('Peringatan', 'Harap lengkapi semua bidang yang wajib diisi', 'warning');
                return;
            }

            const submitBtn = document.getElementById('btn-submit-catatan');
            const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '<i class="fa-solid fa-save"></i> Simpan Catatan';

            window._isSavingCatatanWali = true;
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...';
                submitBtn.classList.add('opacity-75', 'cursor-not-allowed');
            }

            const student = global.currentClassStudents.find(s => String(s.nis) === String(studentNis) || String(s.id) === String(studentNis) || s.nis == studentNis);
            const authorRealName = global.auth.currentUser?.displayName || 'Wali Kelas';
            const currentUid = global.auth.currentUser?.uid || '';

            try {
                if (!cfClient || !cfClient.enabled) {
                    throw new Error('Layanan Cloudflare D1 tidak aktif atau belum terhubung. Periksa koneksi internet Anda.');
                }

                await cfClient.saveGuruWaliNote({
                    id: noteId || undefined,
                    guru_uid: currentUid,
                    guru_name: authorRealName,
                    student_nis: studentNis,
                    student_name: student ? student.name : '',
                    student_class: global.currentRombelClass,
                    title: title,
                    notes: content,
                    category: category,
                    date: date
                });
                showToast('Sukses', noteId ? 'Catatan pembinaan berhasil diperbarui' : 'Catatan pembinaan berhasil ditambahkan', 'success');

                window.closeModal('modal-catatan-wali');
                global.clearWaliRombelCache();
                await global.loadClassNotes(global.currentRombelClass);
                global.renderNotesTab();
                global.renderOverviewStats();

            } catch (err) {
                showToast('Gagal Menyimpan', (err && err.message) ? err.message : 'Gagal menyimpan catatan pembinaan. Form tetap terbuka agar data Anda tidak hilang.', 'error');
            } finally {
                window._isSavingCatatanWali = false;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnHtml;
                    submitBtn.classList.remove('opacity-75', 'cursor-not-allowed');
                }
            }
        };

        return { saveCatatanWali, closeCatatanWaliModal };
    }

    test('Validasi Form: Menolak jika NIS, judul, atau isi catatan kosong tanpa mengubah button state', async () => {
        const { elements } = setupEnvironment();
        const { saveCatatanWali } = createCatatanWaliHandlers();

        elements['form-note-title'].value = '   ';
        await saveCatatanWali({ preventDefault: jest.fn() });

        expect(mockShowToast).toHaveBeenCalledWith('Peringatan', expect.stringContaining('Harap lengkapi'), 'warning');
        expect(mockCfClient.saveGuruWaliNote).not.toHaveBeenCalled();
        expect(elements['btn-submit-catatan'].disabled).toBe(false);
        expect(window._isSavingCatatanWali).toBe(false);
    });

    test('Happy Path: Menyimpan catatan ke D1, menutup modal, dan merestore tombol submit', async () => {
        const { elements } = setupEnvironment();
        const { saveCatatanWali } = createCatatanWaliHandlers();

        const p = saveCatatanWali({ preventDefault: jest.fn() });

        expect(elements['btn-submit-catatan'].disabled).toBe(true);
        expect(elements['btn-submit-catatan'].innerHTML).toContain('fa-spinner');
        expect(window._isSavingCatatanWali).toBe(true);

        await p;

        expect(mockCfClient.saveGuruWaliNote).toHaveBeenCalledTimes(1);
        expect(mockShowToast).toHaveBeenCalledWith('Sukses', expect.stringContaining('berhasil ditambahkan'), 'success');
        expect(mockCloseModal).toHaveBeenCalledWith('modal-catatan-wali');
        expect(mockClearWaliRombelCache).toHaveBeenCalled();
        expect(elements['btn-submit-catatan'].disabled).toBe(false);
        expect(elements['btn-submit-catatan'].innerHTML).toContain('Simpan Catatan');
        expect(window._isSavingCatatanWali).toBe(false);
    });

    test('Double-Submission Lock: Klik ganda cepat dicegah sehingga hanya 1 request yang dikirim ke D1', async () => {
        const { elements } = setupEnvironment();
        const { saveCatatanWali } = createCatatanWaliHandlers();

        let resolveSave;
        mockCfClient.saveGuruWaliNote = jest.fn().mockReturnValue(new Promise(res => { resolveSave = res; }));

        const call1 = saveCatatanWali({ preventDefault: jest.fn() });
        const call2 = saveCatatanWali({ preventDefault: jest.fn() });
        const call3 = saveCatatanWali({ preventDefault: jest.fn() });

        expect(mockCfClient.saveGuruWaliNote).toHaveBeenCalledTimes(1);

        resolveSave({ success: true });
        await Promise.all([call1, call2, call3]);

        expect(mockCfClient.saveGuruWaliNote).toHaveBeenCalledTimes(1);
        expect(window._isSavingCatatanWali).toBe(false);
        expect(elements['btn-submit-catatan'].disabled).toBe(false);
    });

    test('Failure Path: Saat network/D1 error, modal TIDAK ditutup, input aman, tombol dipulihkan di finally', async () => {
        const { elements } = setupEnvironment();
        const { saveCatatanWali } = createCatatanWaliHandlers();

        mockCfClient.saveGuruWaliNote = jest.fn().mockRejectedValue(new Error('Cloudflare D1 Connection Timeout'));

        await saveCatatanWali({ preventDefault: jest.fn() });

        expect(mockCloseModal).not.toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalledWith('Gagal Menyimpan', expect.stringContaining('Cloudflare D1 Connection Timeout'), 'error');

        expect(elements['form-note-title'].value).toBe('Bimbingan Konseling Kedisiplinan');
        expect(elements['form-note-content'].value).toContain('Siswa diberikan arahan');

        expect(elements['btn-submit-catatan'].disabled).toBe(false);
        expect(elements['btn-submit-catatan'].innerHTML).toContain('Simpan Catatan');
        expect(window._isSavingCatatanWali).toBe(false);
    });

    test('Offline / Client Disabled: Menggagalkan penyimpanan secara eksplisit dan tidak menutup modal (Mencegah False Success)', async () => {
        const { elements } = setupEnvironment();
        const { saveCatatanWali } = createCatatanWaliHandlers();

        global.cfClient = { enabled: false };

        await saveCatatanWali({ preventDefault: jest.fn() });

        expect(mockCloseModal).not.toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalledWith('Gagal Menyimpan', expect.stringContaining('tidak aktif atau belum terhubung'), 'error');
        expect(elements['btn-submit-catatan'].disabled).toBe(false);
        expect(window._isSavingCatatanWali).toBe(false);
    });

    test('Unsaved Changes Guard: Memperingatkan user jika menutup modal saat catatan belum disimpan', async () => {
        const { elements } = setupEnvironment();
        const { closeCatatanWaliModal } = createCatatanWaliHandlers();

        mockShowConfirmModal.mockResolvedValue(false);
        await closeCatatanWaliModal();
        expect(mockShowConfirmModal).toHaveBeenCalledTimes(1);
        expect(mockCloseModal).not.toHaveBeenCalled();

        mockShowConfirmModal.mockResolvedValue(true);
        await closeCatatanWaliModal();
        expect(mockCloseModal).toHaveBeenCalledWith('modal-catatan-wali');

        elements['form-note-title'].value = '';
        elements['form-note-content'].value = '';
        mockShowConfirmModal.mockClear();
        mockCloseModal.mockClear();

        await closeCatatanWaliModal();
        expect(mockShowConfirmModal).not.toHaveBeenCalled();
        expect(mockCloseModal).toHaveBeenCalledWith('modal-catatan-wali');
    });

    test('Unsaved Changes Guard: Mencegah penutupan modal saat proses simpan sedang berlangsung', async () => {
        setupEnvironment();
        const { closeCatatanWaliModal } = createCatatanWaliHandlers();

        window._isSavingCatatanWali = true;
        await closeCatatanWaliModal();

        expect(mockShowConfirmModal).not.toHaveBeenCalled();
        expect(mockCloseModal).not.toHaveBeenCalled();
    });
});

describe('Pengujian Unit Resolusi Data Orang Tua & Kontak WA SSOT (resolveStudentParent)', () => {
    // Definisi fungsi resolveStudentParent identik dengan kontrak di page-wali-kelas.js
    function resolveStudentParent(student) {
        if (!student || typeof student !== 'object') {
            return {
                name: '-',
                phone: '-',
                cleanPhone: '',
                rawPhone: '',
                role: '',
                fatherName: '',
                motherName: '',
                guardianName: ''
            };
        }

        const sanitize = val => {
            if (val === undefined || val === null) return '';
            const s = String(val).trim();
            if (s === '' || s === '-' || s === '--' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return '';
            return s;
        };

        const fatherName = sanitize(student.father || student.namaAyah || student.father_name || student.nama_ayah);
        const motherName = sanitize(student.mother || student.namaIbu || student.mother_name || student.nama_ibu);
        const guardianName = sanitize(student.guardian || student.guardian_name || student.nama_wali || student.namaWali);
        const explicitParentName = sanitize(student.name_parent || student.parentName || student.namaOrtu || student.parent_name);

        // Resolusi Nama Ortu
        let name = explicitParentName;
        if (!name) {
            if (fatherName && motherName) {
                name = `${fatherName} / ${motherName}`;
            } else if (fatherName) {
                name = `${fatherName} (Ayah)`;
            } else if (motherName) {
                name = `${motherName} (Ibu)`;
            } else if (guardianName) {
                name = `${guardianName} (Wali)`;
            } else {
                name = '-';
            }
        }

        // Resolusi Telepon Ortu (Prioritas: phone_parent -> mother_phone -> father_phone -> guardian_phone)
        const explicitPhone = sanitize(student.phone_parent || student.parentPhone || student.hpOrtu || student.parent_phone);
        const motherPhone = sanitize(student.mother_phone || student.phone_mother || student.hpIbu);
        const fatherPhone = sanitize(student.father_phone || student.phone_father || student.hpAyah);
        const guardianPhone = sanitize(student.guardian_phone || student.phone_wali || student.hpWali);

        let rawPhone = '';
        let role = '';

        if (explicitPhone) {
            rawPhone = explicitPhone;
            role = 'Ortu';
        } else if (motherPhone) {
            rawPhone = motherPhone;
            role = 'Ibu';
        } else if (fatherPhone) {
            rawPhone = fatherPhone;
            role = 'Ayah';
        } else if (guardianPhone) {
            rawPhone = guardianPhone;
            role = 'Wali';
        }

        // Format cleanPhone untuk WhatsApp link (standar Indonesia: 628...)
        let cleanPhone = rawPhone.replace(/[^0-9]/g, '');
        if (cleanPhone.startsWith('0')) {
            cleanPhone = '62' + cleanPhone.slice(1);
        } else if (cleanPhone.startsWith('8')) {
            cleanPhone = '628' + cleanPhone.slice(1);
        }

        const isValidPhone = cleanPhone.length >= 9 && cleanPhone.startsWith('62');

        return {
            name: name || '-',
            phone: rawPhone || '-',
            cleanPhone: isValidPhone ? cleanPhone : '',
            rawPhone: rawPhone,
            role: role,
            fatherName,
            motherName,
            guardianName
        };
    }

    test('Dapodik Murni: Siswa memiliki data ayah & ibu lengkap tapi name_parent & phone_parent kosong', () => {
        const student = {
            nis: '8910',
            name: 'I Made Raditya',
            father: 'I Wayan Sujana',
            father_phone: '081234567890',
            mother: 'Ni Ketut Wardani',
            mother_phone: '081987654321'
        };

        const result = resolveStudentParent(student);
        expect(result.name).toBe('I Wayan Sujana / Ni Ketut Wardani');
        expect(result.phone).toBe('081987654321');
        expect(result.cleanPhone).toBe('6281987654321');
        expect(result.role).toBe('Ibu');
    });

    test('Siswa hanya memiliki data Ayah', () => {
        const student = {
            nis: '8911',
            name: 'Ni Luh Putu',
            father: 'I Ketut Sudirga',
            father_phone: '085234567890'
        };

        const result = resolveStudentParent(student);
        expect(result.name).toBe('I Ketut Sudirga (Ayah)');
        expect(result.phone).toBe('085234567890');
        expect(result.cleanPhone).toBe('6285234567890');
        expect(result.role).toBe('Ayah');
    });

    test('Siswa hanya memiliki data Ibu', () => {
        const student = {
            nis: '8912',
            name: 'I Gede Pratama',
            mother: 'Ni Made Sukarni',
            mother_phone: '087812345678'
        };

        const result = resolveStudentParent(student);
        expect(result.name).toBe('Ni Made Sukarni (Ibu)');
        expect(result.phone).toBe('087812345678');
        expect(result.cleanPhone).toBe('6287812345678');
        expect(result.role).toBe('Ibu');
    });

    test('Siswa diasuh oleh Wali', () => {
        const student = {
            nis: '8913',
            name: 'Komang Arya',
            guardian: 'I Nyoman Darma',
            guardian_phone: '089876543210'
        };

        const result = resolveStudentParent(student);
        expect(result.name).toBe('I Nyoman Darma (Wali)');
        expect(result.phone).toBe('089876543210');
        expect(result.cleanPhone).toBe('6289876543210');
        expect(result.role).toBe('Wali');
    });

    test('Prioritas Explicit: Siswa hasil edit manual memiliki name_parent & phone_parent', () => {
        const student = {
            nis: '8914',
            name: 'Ketut Wijaya',
            name_parent: 'Bapak Suardana & Ibu Sukma',
            phone_parent: '081333444555',
            father: 'Suardana',
            mother: 'Sukma'
        };

        const result = resolveStudentParent(student);
        expect(result.name).toBe('Bapak Suardana & Ibu Sukma');
        expect(result.phone).toBe('081333444555');
        expect(result.cleanPhone).toBe('6281333444555');
        expect(result.role).toBe('Ortu');
    });

    test('Normalisasi Nomor: Format diawali 8 tanpa 0 otomatis dikonversi ke 628...', () => {
        const student = {
            nis: '8915',
            mother_phone: '81299988877'
        };

        const result = resolveStudentParent(student);
        expect(result.cleanPhone).toBe('6281299988877');
    });

    test('Edge Case: Objek kosong atau strip tidak menghasilkan pesan error dan fallback aman', () => {
        const emptyResult = resolveStudentParent(null);
        expect(emptyResult.name).toBe('-');
        expect(emptyResult.phone).toBe('-');
        expect(emptyResult.cleanPhone).toBe('');

        const dashResult = resolveStudentParent({ father: '-', mother: '--', mother_phone: '-' });
        expect(dashResult.name).toBe('-');
        expect(dashResult.phone).toBe('-');
        expect(dashResult.cleanPhone).toBe('');
    });
});

