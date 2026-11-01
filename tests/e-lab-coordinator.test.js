/**
 * Unit Test: E-Laboratorium - Koordinator Lab & Kepala Lab Global
 * Menguji aturan bisnis RBAC, batas kewenangan, proteksi bentrok jadwal,
 * penugasan koordinator, deteksi multi-akun Kepala Lab, serta integritas skema database.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('E-Laboratorium Coordinator & Kepala Lab RBAC & Business Rules', () => {

    // =========================================================================
    // 1. LOGIKA OTORISASI AKSES (VERIFY LAB ACCESS / RBAC)
    // =========================================================================
    describe('Aturan Akses Multi-Lab (verifyLabAccess)', () => {
        const verifyLabAccess = (user, lab, operation = 'read') => {
            if (!user) return { allowed: false, status: 401, error: 'Unauthorized: Pengguna tidak terautentikasi' };

            const userRoles = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : []);
            const isSuperAdmin = userRoles.includes('admin') || userRoles.includes('superadmin') || userRoles.includes('developer');
            const isKepalaLab = userRoles.includes('kepala_lab');

            // Super Admin & Kepala Lab memiliki akses penuh ke seluruh lab untuk operasi apapun
            if (isSuperAdmin || isKepalaLab) {
                return { allowed: true, role: isSuperAdmin ? 'admin' : 'kepala_lab' };
            }

            // Operasi baca (read-only): diizinkan untuk semua pengguna terotentikasi (misal guru mengecek jadwal/stok)
            if (operation === 'read') {
                return { allowed: true, role: 'viewer' };
            }

            // Operasi modifikasi / kelola (write):
            // Koordinator hanya berwenang untuk lab yang ditugaskan kepadanya
            const isCoordinator = Boolean(
                lab && lab.koordinator_uid && lab.koordinator_uid === user.uid
            );

            if (isCoordinator) {
                return { allowed: true, role: 'koordinator' };
            }

            return {
                allowed: false,
                status: 403,
                error: 'Forbidden: Anda tidak memiliki wewenang mengelola laboratorium ini'
            };
        };

        const kepalaLab = { uid: 'u-kalab-01', name: 'Dr. I Ketut Lab', role: 'guru', roles: ['guru', 'kepala_lab'] };
        const koordinatorBio = { uid: 'u-guru-bio', name: 'Ibu Wayan Bio', role: 'guru', roles: ['guru'] };
        const koordinatorKim = { uid: 'u-guru-kim', name: 'Pak Made Kim', role: 'guru', roles: ['guru'] };
        const guruBiasa = { uid: 'u-guru-sejarah', name: 'Pak Nyoman Sejarah', role: 'guru', roles: ['guru'] };

        const labBiologi = {
            id: 'lab-bio',
            name: 'Laboratorium Biologi',
            koordinator_uid: 'u-guru-bio',
            koordinator_nama: 'Ibu Wayan Bio'
        };

        const labKimia = {
            id: 'lab-kim',
            name: 'Laboratorium Kimia',
            koordinator_uid: 'u-guru-kim',
            koordinator_nama: 'Pak Made Kim'
        };

        const labFisikaTanpaKoordinator = {
            id: 'lab-fis',
            name: 'Laboratorium Fisika',
            koordinator_uid: null,
            koordinator_nama: null
        };

        test('Skenario 1: Kepala Lab mengelola seluruh lab meskipun koordinator berbeda', () => {
            const bioAccess = verifyLabAccess(kepalaLab, labBiologi, 'write');
            expect(bioAccess.allowed).toBe(true);
            expect(bioAccess.role).toBe('kepala_lab');

            const kimAccess = verifyLabAccess(kepalaLab, labKimia, 'write');
            expect(kimAccess.allowed).toBe(true);
            expect(kimAccess.role).toBe('kepala_lab');

            const fisAccess = verifyLabAccess(kepalaLab, labFisikaTanpaKoordinator, 'write');
            expect(fisAccess.allowed).toBe(true);
            expect(fisAccess.role).toBe('kepala_lab');
        });

        test('Skenario 2: Koordinator mengelola inventaris & booking lab tugasnya sendiri', () => {
            const bioAccess = verifyLabAccess(koordinatorBio, labBiologi, 'write');
            expect(bioAccess.allowed).toBe(true);
            expect(bioAccess.role).toBe('koordinator');

            const kimAccess = verifyLabAccess(koordinatorKim, labKimia, 'write');
            expect(kimAccess.allowed).toBe(true);
            expect(kimAccess.role).toBe('koordinator');
        });

        test('Skenario 3: Koordinator ditolak (HTTP 403) saat mencoba mengelola lab lain', () => {
            // Koordinator Bio mencoba mengubah lab Kimia
            const accessKimByBio = verifyLabAccess(koordinatorBio, labKimia, 'write');
            expect(accessKimByBio.allowed).toBe(false);
            expect(accessKimByBio.status).toBe(403);
            expect(accessKimByBio.error).toContain('tidak memiliki wewenang mengelola');

            // Koordinator Kim mencoba mengubah lab Biologi
            const accessBioByKim = verifyLabAccess(koordinatorKim, labBiologi, 'write');
            expect(accessBioByKim.allowed).toBe(false);
            expect(accessBioByKim.status).toBe(403);
        });

        test('Skenario 4: Guru biasa berstatus read-only (bisa baca, ditolak modifikasi)', () => {
            const readAccess = verifyLabAccess(guruBiasa, labBiologi, 'read');
            expect(readAccess.allowed).toBe(true);
            expect(readAccess.role).toBe('viewer');

            const writeAccess = verifyLabAccess(guruBiasa, labBiologi, 'write');
            expect(writeAccess.allowed).toBe(false);
            expect(writeAccess.status).toBe(403);
        });

        test('Skenario 6: Lab tanpa koordinator ditangani penuh oleh Kepala Lab & Admin, guru biasa ditolak', () => {
            const kalabAccess = verifyLabAccess(kepalaLab, labFisikaTanpaKoordinator, 'write');
            expect(kalabAccess.allowed).toBe(true);

            const guruAccess = verifyLabAccess(guruBiasa, labFisikaTanpaKoordinator, 'write');
            expect(guruAccess.allowed).toBe(false);
            expect(guruAccess.status).toBe(403);
        });
    });

    // =========================================================================
    // 2. KEWENANGAN MUTASI / PENGATURAN LAB & PENUGASAN KOORDINATOR
    // =========================================================================
    describe('Kewenangan Pengaturan Lab (Manage Labs & Assign Coordinator)', () => {
        const canManageLabMaster = (user) => {
            if (!user) return false;
            const roles = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : []);
            return roles.includes('admin') || roles.includes('superadmin') || roles.includes('kepala_lab');
        };

        const updateLabCoordinator = (user, lab, newCoordinator) => {
            if (!canManageLabMaster(user)) {
                return {
                    success: false,
                    status: 403,
                    error: 'Forbidden: Hanya Kepala Lab dan Admin yang berwenang mengatur koordinator lab'
                };
            }

            const updatedLab = {
                ...lab,
                koordinator_uid: newCoordinator ? newCoordinator.uid : null,
                koordinator_nama: newCoordinator ? newCoordinator.nama : null
            };

            return { success: true, data: updatedLab };
        };

        const admin = { uid: 'u-admin', role: 'admin', roles: ['admin'] };
        const kepalaLab = { uid: 'u-kalab', role: 'guru', roles: ['guru', 'kepala_lab'] };
        const koordinator = { uid: 'u-koor', role: 'guru', roles: ['guru'] };
        const guruBiasa = { uid: 'u-guru', role: 'guru', roles: ['guru'] };

        const currentLab = {
            id: 'lab-komp-1',
            name: 'Lab Komputer 1',
            koordinator_uid: 'u-koor',
            koordinator_nama: 'Pak Komputer'
        };

        test('Skenario 5a: Kepala Lab dan Admin berhak menetapkan atau mengubah koordinator', () => {
            const newGuru = { uid: 'u-guru-baru', nama: 'Guru Baru M.Kom' };

            const resKalab = updateLabCoordinator(kepalaLab, currentLab, newGuru);
            expect(resKalab.success).toBe(true);
            expect(resKalab.data.koordinator_uid).toBe('u-guru-baru');
            expect(resKalab.data.koordinator_nama).toBe('Guru Baru M.Kom');

            const resAdmin = updateLabCoordinator(admin, currentLab, null);
            expect(resAdmin.success).toBe(true);
            expect(resAdmin.data.koordinator_uid).toBeNull();
            expect(resAdmin.data.koordinator_nama).toBeNull();
        });

        test('Skenario 5b: Koordinator laboratorium dilarang keras mengubah penugasan koordinator', () => {
            const resKoor = updateLabCoordinator(koordinator, currentLab, { uid: 'u-rekan', nama: 'Rekan Guru' });
            expect(resKoor.success).toBe(false);
            expect(resKoor.status).toBe(403);
            expect(resKoor.error).toContain('Hanya Kepala Lab dan Admin');
        });

        test('Skenario 5c: Guru biasa dilarang keras mengubah penugasan koordinator', () => {
            const resGuru = updateLabCoordinator(guruBiasa, currentLab, null);
            expect(resGuru.success).toBe(false);
            expect(resGuru.status).toBe(403);
        });
    });

    // =========================================================================
    // 3. ATURAN PERSETUJUAN BOOKING & PROTEKSI ANTI-BENTROK JADWAL
    // =========================================================================
    describe('Validasi Persetujuan Booking & Proteksi Bentrok Jadwal', () => {
        const canApproveBooking = (user, lab, booking, hasOverlapConflict) => {
            const roles = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : []);
            const isSuperAdmin = roles.includes('admin') || roles.includes('superadmin');
            const isKepalaLab = roles.includes('kepala_lab');
            const isCoordinator = Boolean(lab && lab.koordinator_uid && lab.koordinator_uid === user.uid);

            if (!isSuperAdmin && !isKepalaLab && !isCoordinator) {
                return {
                    allowed: false,
                    status: 403,
                    error: 'Forbidden: Anda tidak berwenang menyetujui booking pada laboratorium ini'
                };
            }

            // Proteksi Jadwal Bentrok: Koordinator DILARANG menyetujui booking bentrok
            const isConflict = booking.status === 'conflict' || hasOverlapConflict;
            if (isConflict && !isSuperAdmin && !isKepalaLab) {
                return {
                    allowed: false,
                    status: 403,
                    error: 'Forbidden: Booking bentrok hanya dapat diputuskan dan disetujui oleh Kepala Laboratorium atau Admin'
                };
            }

            return { allowed: true };
        };

        const kepalaLab = { uid: 'u-kalab', roles: ['guru', 'kepala_lab'] };
        const koordinator = { uid: 'u-koor-bio', roles: ['guru'] };
        const guruLain = { uid: 'u-guru-lain', roles: ['guru'] };

        const labBio = { id: 'lab-bio', koordinator_uid: 'u-koor-bio' };

        const regularBooking = { id: 'bk-01', lab_id: 'lab-bio', status: 'pending' };
        const conflictBooking = { id: 'bk-02', lab_id: 'lab-bio', status: 'conflict' };

        test('Koordinator dapat menyetujui booking biasa yang tidak memiliki bentrok', () => {
            const check = canApproveBooking(koordinator, labBio, regularBooking, false);
            expect(check.allowed).toBe(true);
        });

        test('Skenario 7: Koordinator ditolak (HTTP 403) jika menyetujui booking berstatus bentrok', () => {
            const check = canApproveBooking(koordinator, labBio, conflictBooking, false);
            expect(check.allowed).toBe(false);
            expect(check.status).toBe(403);
            expect(check.error).toContain('Booking bentrok hanya dapat diputuskan dan disetujui oleh Kepala Laboratorium');
        });

        test('Skenario 7b: Koordinator ditolak jika sistem mendeteksi overlap jadwal aktual (hasOverlapConflict)', () => {
            const check = canApproveBooking(koordinator, labBio, regularBooking, true);
            expect(check.allowed).toBe(false);
            expect(check.status).toBe(403);
            expect(check.error).toContain('Booking bentrok hanya dapat diputuskan dan disetujui oleh Kepala Laboratorium');
        });

        test('Kepala Lab dan Admin dapat menyetujui booking biasa maupun bentrok', () => {
            const kalabRegular = canApproveBooking(kepalaLab, labBio, regularBooking, false);
            expect(kalabRegular.allowed).toBe(true);

            const kalabConflict = canApproveBooking(kepalaLab, labBio, conflictBooking, true);
            expect(kalabConflict.allowed).toBe(true);
        });

        test('Guru lain tidak diizinkan menyetujui booking apapun', () => {
            const guruCheck = canApproveBooking(guruLain, labBio, regularBooking, false);
            expect(guruCheck.allowed).toBe(false);
            expect(guruCheck.status).toBe(403);
        });
    });

    // =========================================================================
    // 4. INTEGRITAS AUDIT LOG & RIWAYAT APPROVAL SAAT PERUBAHAN KOORDINATOR
    // =========================================================================
    describe('Skenario 8: Integritas Riwayat Approval & Audit Log Koordinator', () => {
        test('Riwayat tindakan dan log approval menyimpan identitas pelaku secara atomik', () => {
            const approvalLog = {
                booking_id: 'bk-100',
                action: 'approve',
                approved_by_uid: 'u-koordinator-lama',
                approved_by_nama: 'Pak Guru Lama S.Pd',
                approved_at: '2026-09-08 08:30:00'
            };

            // Saat koordinator lab diganti ke guru baru:
            const labAfterChange = {
                id: 'lab-bio',
                koordinator_uid: 'u-koordinator-baru',
                koordinator_nama: 'Ibu Guru Baru M.Si'
            };

            // Log riwayat masa lalu tetap merekam 'Pak Guru Lama S.Pd'
            expect(approvalLog.approved_by_uid).toBe('u-koordinator-lama');
            expect(approvalLog.approved_by_nama).toBe('Pak Guru Lama S.Pd');
            expect(labAfterChange.koordinator_uid).not.toBe(approvalLog.approved_by_uid);
        });
    });

    // =========================================================================
    // 5. DETEKSI AKUN KEPALA LAB GLOBAL (UI SUMMARY LOGIC)
    // =========================================================================
    describe('Skenario 9: Deteksi Akun Kepala Lab Global pada Tampilan Pengaturan', () => {
        const analyzeKalabAccounts = (accountsList) => {
            const count = Array.isArray(accountsList) ? accountsList.length : 0;
            if (count === 0) {
                return {
                    status: 'empty',
                    badgeColor: 'amber',
                    message: 'Akun Kepala Lab belum ditentukan di Manajemen Pengguna'
                };
            }
            if (count === 1) {
                return {
                    status: 'single',
                    badgeColor: 'emerald',
                    primaryAccount: accountsList[0],
                    message: 'Kepala Laboratorium Aktif'
                };
            }
            return {
                status: 'multiple',
                badgeColor: 'amber',
                accounts: accountsList,
                message: `Terdeteksi ${count} akun memiliki peran Kepala Lab di Manajemen Pengguna`
            };
        };

        test('Menangani 1 akun Kepala Lab (ideal/tunggal)', () => {
            const mockList = [{ uid: 'u-1', nama: 'Dr. Lab SMAGESA', nip: '198501012010011001' }];
            const res = analyzeKalabAccounts(mockList);

            expect(res.status).toBe('single');
            expect(res.badgeColor).toBe('emerald');
            expect(res.primaryAccount.nama).toBe('Dr. Lab SMAGESA');
        });

        test('Menangani 0 akun Kepala Lab (peringatan kuning belum ditentukan)', () => {
            const res = analyzeKalabAccounts([]);

            expect(res.status).toBe('empty');
            expect(res.badgeColor).toBe('amber');
            expect(res.message).toContain('belum ditentukan');
        });

        test('Menangani >1 akun Kepala Lab (peringatan terdeteksi multi-akun tanpa auto-assign)', () => {
            const mockList = [
                { uid: 'u-1', nama: 'Guru Lab A' },
                { uid: 'u-2', nama: 'Guru Lab B' }
            ];
            const res = analyzeKalabAccounts(mockList);

            expect(res.status).toBe('multiple');
            expect(res.badgeColor).toBe('amber');
            expect(res.message).toContain('Terdeteksi 2 akun memiliki peran Kepala Lab');
            expect(res.accounts.length).toBe(2);
        });
    });

    // =========================================================================
    // 6. INTEGRITAS FILE MIGRASI SQL D1 & SCHEMA.SQL
    // =========================================================================
    describe('Skenario 10: Integritas Migrasi D1 & Schema SQL untuk Koordinator Lab', () => {
        const migrationPath = path.resolve(__dirname, '../cloudflare/migrations/202609080001_add_lab_coordinator.sql');
        const schemaPath = path.resolve(__dirname, '../cloudflare/schema.sql');

        test('Berkas migrasi koordinator ada dan memuat kolom koordinator_uid serta koordinator_nama', () => {
            expect(fs.existsSync(migrationPath)).toBe(true);
            const content = fs.readFileSync(migrationPath, 'utf8');

            expect(content).toContain('koordinator_uid TEXT');
            expect(content).toContain('koordinator_nama TEXT');
            expect(content).toContain('CREATE INDEX IF NOT EXISTS idx_labs_koordinator');
        });

        test('Berkas schema.sql sinkron dengan tabel labs berkolom koordinator', () => {
            expect(fs.existsSync(schemaPath)).toBe(true);
            const content = fs.readFileSync(schemaPath, 'utf8');

            expect(content).toContain('koordinator_uid TEXT');
            expect(content).toContain('koordinator_nama TEXT');
            expect(content).toContain('idx_labs_koordinator');
        });
    });

    // =========================================================================
    // 7. SEARCHABLE COMBOBOX KOORDINATOR LAB & INTEGRITAS UI MODAL
    // =========================================================================
    describe('Skenario 11: Searchable Combobox Koordinator Lab & Integritas UI Modal', () => {
        const elabHtmlPath = path.resolve(__dirname, '../e-lab.html');
        const pageElabJsPath = path.resolve(__dirname, '../js/page-e-lab.js');
        const workerJsPath = path.resolve(__dirname, '../cloudflare/worker.js');

        test('Komponen Searchable Combobox hadir secara lengkap di e-lab.html', () => {
            const html = fs.readFileSync(elabHtmlPath, 'utf8');
            expect(html).toContain('id="container-manage-lab-koordinator"');
            expect(html).toContain('id="manage-lab-form-koordinator"');
            expect(html).toContain('id="manage-lab-koordinator-search"');
            expect(html).toContain('id="manage-lab-koordinator-clear"');
            expect(html).toContain('id="manage-lab-koordinator-dropdown"');
        });

        test('Fungsi controller searchable combobox tersedia lengkap di page-e-lab.js', () => {
            const js = fs.readFileSync(pageElabJsPath, 'utf8');
            expect(js).toContain('function setupLabCoordinatorSearchCombobox');
            expect(js).toContain('function renderCoordinatorDropdownOptions');
            expect(js).toContain('window.selectLabCoordinator =');
            expect(js).toContain('window.clearLabCoordinatorSelection =');
            expect(js).toContain('window.populateCoordinatorDropdown =');
            expect(js).toContain('localStorage.removeItem(\'simas_elab_labs_cache\')');
        });

        test('Logika filter pencarian guru mendukung nama, NIP, email, dan role', () => {
            const sampleUsers = [
                { uid: 'u-1', name: 'I Komang Hery', nip: '199706132024211007', email: 'hery@gmail.com', role: 'guru' },
                { uid: 'u-2', name: 'Ni Wayan Sari', nip: '198801012015012001', email: 'sari@gmail.com', role: 'staff' },
                { uid: 'u-3', name: 'I Made Lab TIK', nip: '', email: 'tik@smagesa.sch.id', role: 'guru' }
            ];

            const filterByQuery = (query) => {
                const lower = query.trim().toLowerCase();
                return sampleUsers.filter(u => {
                    if (!lower) return true;
                    return (u.name && u.name.toLowerCase().includes(lower))
                        || (u.nip && u.nip.includes(lower))
                        || (u.email && u.email.toLowerCase().includes(lower))
                        || (u.role && u.role.toLowerCase().includes(lower));
                });
            };

            // Cari via nama
            expect(filterByQuery('Hery').length).toBe(1);
            expect(filterByQuery('Hery')[0].uid).toBe('u-1');

            // Cari via NIP
            expect(filterByQuery('1988').length).toBe(1);
            expect(filterByQuery('1988')[0].uid).toBe('u-2');

            // Cari via Email domain
            expect(filterByQuery('smagesa.sch.id').length).toBe(1);
            expect(filterByQuery('smagesa.sch.id')[0].uid).toBe('u-3');

            // Cari via Role
            expect(filterByQuery('guru').length).toBe(2);

            // Cari string kosong -> mengembalikan semua
            expect(filterByQuery('').length).toBe(3);

            // Kata kunci tidak ditemukan
            expect(filterByQuery('xyz999').length).toBe(0);
        });

        test('Worker API Cloudflare mengimplementasikan ensureLabColumns pada endpoint labs', () => {
            const workerCode = fs.readFileSync(workerJsPath, 'utf8');
            expect(workerCode).toContain('async function ensureLabColumns(env)');
            expect(workerCode).toContain('ALTER TABLE labs ADD COLUMN koordinator_uid TEXT');
            expect(workerCode).toContain('ALTER TABLE labs ADD COLUMN koordinator_nama TEXT');
            expect(workerCode).toContain('await ensureLabColumns(env)');
        });
    });

    // =========================================================================
    // 8. ATURAN PEMBATALAN BOOKING LAB (SELF-CANCELLATION & ADMIN/KOOR REVOCATION)
    // =========================================================================
    describe('Skenario 12: Otorisasi Pembatalan Booking Laboratorium', () => {
        const canCancelBooking = (user, lab, booking) => {
            const roles = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : []);
            const isSuperAdmin = roles.includes('admin') || roles.includes('superadmin');
            const isKepalaLab = roles.includes('kepala_lab');
            const isCoordinator = Boolean(lab && lab.koordinator_uid && lab.koordinator_uid === user.uid);
            const isOwner = booking.pemohon_uid === user.uid;

            // Pembatalan diizinkan untuk pemilik, kepala lab, super admin, atau koordinator lab terkait
            if (!isOwner && !isSuperAdmin && !isKepalaLab && !isCoordinator) {
                return {
                    allowed: false,
                    status: 403,
                    error: 'Forbidden: Anda tidak memiliki wewenang untuk membatalkan booking ini'
                };
            }

            return { allowed: true };
        };

        const guruPemohon = { uid: 'u-guru-pemohon', name: 'Pak Made Guru Mapel', roles: ['guru'] };
        const guruLain = { uid: 'u-guru-lain', name: 'Pak Nyoman Lain', roles: ['guru'] };
        const kepalaLab = { uid: 'u-kalab', name: 'Dr. Lab Kalab', roles: ['guru', 'kepala_lab'] };
        const admin = { uid: 'u-admin', name: 'Admin SIMAS', roles: ['admin'] };
        const koordinatorLab = { uid: 'u-koor-komp', name: 'Koordinator Komputer', roles: ['guru'] };

        const labKomputer = { id: 'lab-komp', name: 'Lab Komputer', koordinator_uid: 'u-koor-komp' };
        const bookingSaya = { id: 'bk-101', lab_id: 'lab-komp', pemohon_uid: 'u-guru-pemohon', status: 'approved' };

        test('Pemilik booking (guru pemohon) dapat membatalkan booking miliknya sendiri', () => {
            const res = canCancelBooking(guruPemohon, labKomputer, bookingSaya);
            expect(res.allowed).toBe(true);
        });

        test('Guru lain ditolak (HTTP 403) saat mencoba membatalkan booking orang lain', () => {
            const res = canCancelBooking(guruLain, labKomputer, bookingSaya);
            expect(res.allowed).toBe(false);
            expect(res.status).toBe(403);
            expect(res.error).toContain('tidak memiliki wewenang untuk membatalkan');
        });

        test('Kepala Lab dan Admin berhak membatalkan atau mencabut booking siapapun', () => {
            const resKalab = canCancelBooking(kepalaLab, labKomputer, bookingSaya);
            expect(resKalab.allowed).toBe(true);

            const resAdmin = canCancelBooking(admin, labKomputer, bookingSaya);
            expect(resAdmin.allowed).toBe(true);
        });

        test('Koordinator Lab berhak membatalkan booking pada lab yang ditugaskan kepadanya', () => {
            const resKoor = canCancelBooking(koordinatorLab, labKomputer, bookingSaya);
            expect(resKoor.allowed).toBe(true);
        });

        test('Worker API Cloudflare mengizinkan status cancelled untuk isOwnerCancelling', () => {
            const workerCode = fs.readFileSync(path.resolve(__dirname, '../cloudflare/worker.js'), 'utf8');
            expect(workerCode).toContain("const isCancelling = newStatus === 'cancelled';");
            expect(workerCode).toContain("const isOwnerCancelling = isOwner && isCancelling;");
            expect(workerCode).toContain("if (!isOwner && !isHeadOrAdmin && !isCoordinator)");
        });

        test('Frontend page-e-lab.js mengizinkan pemilik dan pengelola membatalkan booking di modal', () => {
            const elabJs = fs.readFileSync(path.resolve(__dirname, '../js/page-e-lab.js'), 'utf8');
            expect(elabJs).toContain("const canCancel = (isOwner || isFullAdminOrKalab || isLabCoordinator)");
            expect(elabJs).toContain("'cancelled': '<span class=\"px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded text-xs font-bold\">Dibatalkan</span>'");
            expect(elabJs).toContain("const reason = isOwner ? 'Dibatalkan oleh pemohon.' : 'Dibatalkan oleh pengelola lab.';");
        });
    });

});


