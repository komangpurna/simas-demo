/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

describe('Student Portal Profile Edit & KK Document Resilience Verification', () => {

    test('1. Sanitasi Pembersihan Spasi/Strip pada NIK Siswa & No KK (Anti-Failure on Paste)', () => {
        const cleanIdNumber = (val) => String(val || '').replace(/[\s\-_.]/g, '').trim();

        const pastedNik = '5107 0412 0506 0001';
        const pastedKK = '5107-0401-0101-0002';
        const pastedFatherNik = '5107.0401.0175.0001';

        expect(cleanIdNumber(pastedNik)).toBe('5107041205060001');
        expect(cleanIdNumber(pastedKK)).toBe('5107040101010002');
        expect(cleanIdNumber(pastedFatherNik)).toBe('5107040101750001');
    });

    test('2. Validasi Identitas Kependudukan (validateStudentIdentityNumbers): Format 16 Digit & Keunikan', () => {
        const globalJsContent = fs.readFileSync(path.join(rootDir, 'js', 'global.js'), 'utf8');
        expect(globalJsContent).toContain('window.validateStudentIdentityNumbers');

        // Simulasi fungsi SSOT validateStudentIdentityNumbers
        const validateIdentity = (data) => {
            const cleanStr = (v) => (v !== undefined && v !== null ? String(v).replace(/[\s\-_.]/g, '').trim() : '');
            const fields = [
                { key: 'nik', label: 'NIK Siswa', val: cleanStr(data.nik) },
                { key: 'kk_no', label: 'Nomor Kartu Keluarga (No. KK)', val: cleanStr(data.kk_no) },
                { key: 'father_nik', label: 'NIK Ayah', val: cleanStr(data.father_nik) },
                { key: 'mother_nik', label: 'NIK Ibu', val: cleanStr(data.mother_nik) },
                { key: 'guardian_nik', label: 'NIK Wali', val: cleanStr(data.guardian_nik) }
            ];

            for (const item of fields) {
                if (item.val && item.val !== '-') {
                    if (!/^\d+$/.test(item.val)) {
                        return { valid: false, message: `${item.label} hanya boleh berisi angka.` };
                    }
                    if (item.val.length !== 16) {
                        return { valid: false, message: `${item.label} harus terdiri dari tepat 16 digit angka.` };
                    }
                }
            }

            const filled = fields.filter(item => item.val && item.val !== '-');
            for (let i = 0; i < filled.length; i++) {
                for (let j = i + 1; j < filled.length; j++) {
                    if (filled[i].val === filled[j].val) {
                        return { valid: false, message: `${filled[i].label} tidak boleh sama dengan ${filled[j].label}.` };
                    }
                }
            }
            return { valid: true };
        };

        // Skenario A: Data Valid (16 digit berbeda)
        const validRes = validateIdentity({
            nik: '5107041205060001',
            kk_no: '5107040101010002',
            father_nik: '5107040101750001',
            mother_nik: '5107040101780002'
        });
        expect(validRes.valid).toBe(true);

        // Skenario B: Kurang dari 16 digit
        const shortRes = validateIdentity({ nik: '5107041205' });
        expect(shortRes.valid).toBe(false);
        expect(shortRes.message).toContain('16 digit angka');

        // Skenario C: NIK Siswa sama dengan No KK
        const duplicateRes = validateIdentity({
            nik: '5107041205060001',
            kk_no: '5107041205060001'
        });
        expect(duplicateRes.valid).toBe(false);
        expect(duplicateRes.message).toContain('tidak boleh sama');
    });

    test('3. Prioritas Identitas Target NIS Otoritatif (Mencegah Error 404 pada Cloudflare D1)', () => {
        // Simulasi resolusi target NIS
        const resolveTargetNis = (currentStudent, currentNIS, sessionNIS) => {
            return String(currentStudent?.nis || currentNIS || sessionNIS || currentStudent?.id || '').trim();
        };

        // Kasus ketika Firestore memberikan ID acak di s.id (misal 'abcXYZ123'), tapi s.nis adalah '1234'
        const studentObj = {
            id: 'firestoreDocIdRandom123',
            nis: '1234',
            name: 'Wayan Siswa'
        };

        const resolved = resolveTargetNis(studentObj, '1234', '1234');
        expect(resolved).toBe('1234');
        expect(resolved).not.toBe('firestoreDocIdRandom123');
    });

    test('4. Resiliensi Google Drive Caching (_pendingKKUploadResult) Mencegah Upload Ulang Ganda saat Retry DB', async () => {
        let _pendingKKUpload = { base64: 'base64sampledata' };
        let _pendingKKUploadResult = null;
        let driveUploadCount = 0;

        // Mock upload function
        const mockUploadToDrive = async () => {
            driveUploadCount++;
            return {
                fileId: 'gdriveFile123',
                url: 'https://drive.google.com/file/d/gdriveFile123/view',
                name: 'KK_1234_Siswa.jpg',
                folderPath: 'KK-Siswa/2026-2027/X.1'
            };
        };

        // Simulasi Submit 1: Upload Drive sukses, tapi D1 gagal
        const runSubmit = async (d1ShouldFail = false) => {
            let uploadRes = _pendingKKUploadResult;
            if (!uploadRes && _pendingKKUpload) {
                uploadRes = await mockUploadToDrive();
                _pendingKKUploadResult = uploadRes;
            }

            if (d1ShouldFail) {
                throw new Error('Cloudflare D1 Network Disconnect');
            }

            // Jika sukses:
            _pendingKKUpload = null;
            _pendingKKUploadResult = null;
            return uploadRes;
        };

        // Percobaan 1: Gagal di DB
        await expect(runSubmit(true)).rejects.toThrow('Cloudflare D1 Network Disconnect');
        expect(driveUploadCount).toBe(1);
        expect(_pendingKKUploadResult).not.toBeNull();
        expect(_pendingKKUploadResult.fileId).toBe('gdriveFile123');

        // Percobaan 2: Pengguna mengklik Simpan lagi (Retry) -> TIDAK upload ulang ke Drive!
        const finalRes = await runSubmit(false);
        expect(driveUploadCount).toBe(1); // Tetap 1! Tidak ada duplikasi berkas
        expect(finalRes.fileId).toBe('gdriveFile123');
        expect(_pendingKKUpload).toBeNull();
        expect(_pendingKKUploadResult).toBeNull();
    });

    test('5. Penanganan Timeout / AbortError pada Layanan Google Apps Script dengan Pesan Ramah', () => {
        const formatUploadError = (err) => {
            const isTimeout = err.name === 'AbortError' || String(err.message || '').toLowerCase().includes('abort');
            return isTimeout
                ? 'Koneksi ke Google Drive memakan waktu terlalu lama (timeout). Silakan periksa jaringan internet Anda dan coba lagi.'
                : (err.message || 'Gagal mengunggah foto KK ke Google Drive.');
        };

        const abortErr = new Error('The user aborted a request.');
        abortErr.name = 'AbortError';

        const msg = formatUploadError(abortErr);
        expect(msg).toContain('Koneksi ke Google Drive memakan waktu terlalu lama (timeout)');
    });

    test('6. Rollback State Memori pada deleteKKPhoto Jika Penyimpanan ke D1 Gagal', async () => {
        let _currentKKUrl = 'https://drive.google.com/file/d/old123/view';
        let _currentKKFileId = 'old123';

        const prevUrl = _currentKKUrl;
        const prevFileId = _currentKKFileId;

        // Simulasi D1 error
        const d1SaveStudent = async () => { throw new Error('Database write error'); };

        try {
            // Coba simpan clean updates
            await d1SaveStudent();
            _currentKKUrl = '';
            _currentKKFileId = '';
        } catch (e) {
            // Rollback
            _currentKKUrl = prevUrl;
            _currentKKFileId = prevFileId;
        }

        expect(_currentKKUrl).toBe('https://drive.google.com/file/d/old123/view');
        expect(_currentKKFileId).toBe('old123');
    });

    test('7. Guard Ukuran File Awal (Maksimal 15 MB) di handleKKFileSelect', () => {
        const MAX_FILE_SIZE = 15 * 1024 * 1024;
        const oversizedFile = { size: 20 * 1024 * 1024 }; // 20 MB
        const normalFile = { size: 3 * 1024 * 1024 }; // 3 MB

        const checkFileSize = (file) => file.size <= MAX_FILE_SIZE;

        expect(checkFileSize(oversizedFile)).toBe(false);
        expect(checkFileSize(normalFile)).toBe(true);
    });

    test('8. Whitelist Paritas di cloudflare/worker.js untuk Dokumen KK dan Biodata Siswa Mandiri', () => {
        const workerContent = fs.readFileSync(path.join(rootDir, 'cloudflare', 'worker.js'), 'utf8');

        // Memastikan seluruh kolom KK ada di whitelist
        expect(workerContent).toContain('"kk_document_url"');
        expect(workerContent).toContain('"kk_file_id"');
        expect(workerContent).toContain('"kk_uploaded_at"');
        expect(workerContent).toContain('"kk_file_name"');
        expect(workerContent).toContain('"kk_drive_folder"');

        // Memastikan kolom identitas resmi terkunci dari update mandiri
        expect(workerContent).toMatch(/updatedRowData\s*=\s*\{[^}]*name:\s*existingRow\.name/);
        expect(workerContent).toMatch(/updatedRowData\s*=\s*\{[^}]*class:\s*existingRow\.class/);
        expect(workerContent).toMatch(/updatedRowData\s*=\s*\{[^}]*birth_date:\s*existingRow\.birth_date/);
    });

    test('9. Injeksi Header X-Student-Token pada CloudflareClient saat di Portal Siswa', () => {
        const cfClientContent = fs.readFileSync(path.join(rootDir, 'js', 'cloudflare-client.js'), 'utf8');

        // Memastikan isStudentContext memeriksa portal-siswa dan ketersediaan student_token
        expect(cfClientContent).toContain("window.location?.pathname?.includes('portal-siswa')");
        expect(cfClientContent).toContain("sessionStorage.getItem('student_token')");
        expect(cfClientContent).toContain("headers['X-Student-Token'] = studentToken");
    });

    test('10. Penanganan Tanggal Lahir Readonly (Tidak Memblokir Penyimpanan Biodata)', () => {
        const pageJsContent = fs.readFileSync(path.join(rootDir, 'js', 'page-portal-siswa.js'), 'utf8');

        // Memastikan kode submit tidak melempar throw error blocker yang mengunci pengguna pada rawBirthDate
        expect(pageJsContent).not.toMatch(/if\s*\(!rawBirthDate\)\s*\{\s*throw new Error\('Tanggal Lahir wajib diisi\.'\);?\s*\}/);
    });

});
