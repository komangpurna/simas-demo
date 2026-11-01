/**
 * tests/users-role-staff-restriction.test.js
 * Unit test untuk memastikan pembatasan otorisasi penambahan user bagi role Staff:
 * 1. UI Dropdown (#role-select) untuk user role Staff hanya memiliki opsi: Staff, Admin Kelas, dan Admin PKS.
 * 2. Tidak ada opsi Wali Kelas atau Guru Mapel untuk role Staff pada form tambah user.
 * 3. Logika Security Force pada form submission memvalidasi dan memblokir role selain staff, admin_kelas, dan admin_pks.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pageUsersCode = fs.readFileSync(path.join(root, 'js/page-users.js'), 'utf8');

describe('Validasi Hak Akses Role Staff pada Form Tambah User (users.html)', () => {

    describe('1. Verifikasi Kode Statis pada js/page-users.js', () => {
        test('Memastikan blok penanganan UI khusus role staff ada di setupForm', () => {
            expect(pageUsersCode).toContain("window.currentUserRole === 'staff'");
        });

        test('Memastikan dropdown role-select untuk Staff hanya berisi staff, admin_kelas, dan admin_pks', () => {
            // Ekstrak blok konfigurasi staff
            const staffBlockMatch = pageUsersCode.match(/if\s*\(window\.currentUserRole\s*===\s*'staff'\)\s*\{([\s\S]*?)\}/);
            expect(staffBlockMatch).not.toBeNull();
            const staffBlock = staffBlockMatch[1];

            expect(staffBlock).toContain('value="staff"');
            expect(staffBlock).toContain('value="admin_kelas"');
            expect(staffBlock).toContain('value="admin_pks"');

            // Memastikan opsi wali_kelas dan guru_mapel TIDAK ADA di blok staff
            expect(staffBlock).not.toContain('value="wali_kelas"');
            expect(staffBlock).not.toContain('value="guru_mapel"');
            expect(staffBlock).not.toContain('value="super_admin"');
            expect(staffBlock).not.toContain('value="kepala_sekolah"');
        });

        test('Memastikan Security Force submit handler memvalidasi role staff', () => {
            const securityCheckMatch = pageUsersCode.match(/else\s+if\s*\(window\.currentUserRole\s*===\s*'staff'\)\s*\{([\s\S]*?)\}/);
            expect(securityCheckMatch).not.toBeNull();
            const securityBlock = securityCheckMatch[1];

            expect(securityBlock).toContain("['staff', 'admin_kelas', 'admin_pks']");
            expect(securityBlock).toContain('Role tidak diizinkan. Staff hanya bisa menambah Staff, Admin Kelas, atau Admin PKS.');
        });
    });

    describe('2. Simulasi Logika Otorisasi Penambahan User untuk Role Staff', () => {
        function validateAddUserRole(currentUserRole, targetRole) {
            if (currentUserRole === 'staff') {
                const allowedRoles = ['staff', 'admin_kelas', 'admin_pks'];
                if (!allowedRoles.includes(targetRole)) {
                    return { allowed: false, message: 'Role tidak diizinkan. Staff hanya bisa menambah Staff, Admin Kelas, atau Admin PKS.' };
                }
                return { allowed: true };
            }
            return { allowed: true };
        }

        test('Staff diizinkan menambah user dengan role staff', () => {
            const res = validateAddUserRole('staff', 'staff');
            expect(res.allowed).toBe(true);
        });

        test('Staff diizinkan menambah user dengan role admin_kelas', () => {
            const res = validateAddUserRole('staff', 'admin_kelas');
            expect(res.allowed).toBe(true);
        });

        test('Staff diizinkan menambah user dengan role admin_pks', () => {
            const res = validateAddUserRole('staff', 'admin_pks');
            expect(res.allowed).toBe(true);
        });

        test('Staff DITOLAK saat mencoba menambah user wali_kelas', () => {
            const res = validateAddUserRole('staff', 'wali_kelas');
            expect(res.allowed).toBe(false);
            expect(res.message).toContain('Role tidak diizinkan');
        });

        test('Staff DITOLAK saat mencoba menambah user guru_mapel', () => {
            const res = validateAddUserRole('staff', 'guru_mapel');
            expect(res.allowed).toBe(false);
            expect(res.message).toContain('Role tidak diizinkan');
        });

        test('Staff DITOLAK saat mencoba menambah user super_admin', () => {
            const res = validateAddUserRole('staff', 'super_admin');
            expect(res.allowed).toBe(false);
        });

        test('Staff DITOLAK saat mencoba menambah user kepala_sekolah atau admin_perpus', () => {
            expect(validateAddUserRole('staff', 'kepala_sekolah').allowed).toBe(false);
            expect(validateAddUserRole('staff', 'admin_perpus').allowed).toBe(false);
        });
    });

    describe('3. Verifikasi Akses Edit Pemetaan Wali Kelas untuk Role Staff', () => {
        const firestoreRulesCode = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

        test('Memastikan role staff termasuk dalam allowedMappingRoles di js/page-users.js', () => {
            expect(pageUsersCode).toContain("const allowedMappingRoles = ['super_admin', 'staff', 'wakasek_kurikulum'];");
        });

        test('Memastikan fungsi window.focusWaliKelasInput terdefinisi di js/page-users.js', () => {
            expect(pageUsersCode).toContain("window.focusWaliKelasInput = function (kelas)");
            expect(pageUsersCode).toContain("targetRow.querySelector('.teacher-search-input')");
        });

        test('Memastikan tabel pemetaan merender tombol Edit dan Copot jika kelas sudah memiliki wali', () => {
            expect(pageUsersCode).toContain("window.focusWaliKelasInput('${escapeHTML(kelas)}')");
            expect(pageUsersCode).toContain("window.removeWaliKelas('${escapeHTML(kelas)}', '${escapeHTML(currentWali.id)}')");
            expect(pageUsersCode).toContain('<i class="fa-solid fa-pen-to-square"></i> Edit');
            expect(pageUsersCode).toContain('<i class="fa-solid fa-user-minus"></i> Copot');
        });

        test('Memastikan tabel pemetaan merender tombol Tugaskan jika kelas belum memiliki wali', () => {
            expect(pageUsersCode).toContain('<i class="fa-solid fa-user-plus"></i> Tugaskan');
        });

        test('Memastikan kepala_sekolah berstatus read-only (input disabled dan aksi Hanya Lihat)', () => {
            expect(pageUsersCode).toContain("const isReadOnly = window.currentUserRole === 'kepala_sekolah';");
            expect(pageUsersCode).toContain("const inputDisabledAttr = isReadOnly ? 'disabled' : '';");
            expect(pageUsersCode).toContain("actionBtn = `<span class=\"text-xs text-slate-400 italic\">Hanya Lihat</span>`;");
        });

        test('Memastikan firestore.rules mengizinkan staff memperbarui wali kelas tanpa terblokir additionalRoles non-pimpinan', () => {
            // Memastikan klausa staff di firestore.rules membedakan create vs update
            expect(firestoreRulesCode).toContain("hasAnyRole('staff')");
            expect(firestoreRulesCode).toContain("!request.resource.data.additionalRoles.hasAny(['super_admin', 'kepala_sekolah'])");
        });
    });
});

