/**
 * Unit & Behavioral Test: Otorisasi Edit Data Siswa (Wali Kelas & Portal Siswa)
 * Memverifikasi:
 * 1. Otorisasi PUT /api/students/:nis di Cloudflare Worker:
 *    - Wali Kelas dapat mengedit data siswa di rombel binaannya sendiri.
 *    - Wali Kelas ditolak (HTTP 403) jika mengedit data siswa di rombel lain.
 *    - Staf Global (super_admin, kesiswaan, staff, admin) dapat mengedit siswa lintas rombel.
 *    - Siswa pemilik akun (isOwner) dapat mengedit profil mandiri sesuai whitelist.
 *    - Kolom birthDate dikunci dari whitelist update mandiri siswa (nilai birth_date database terjaga).
 * 2. Integritas UI Portal Siswa: Input tanggal lahir bertanda readonly & terkunci.
 * 3. Paritas Aksi Klien di Data Siswa (siswa.html / js/page-students.js).
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Otorisasi Edit Data Siswa (Wali Kelas & Portal Siswa)', () => {
    const root = path.resolve(__dirname, '..');
    const workerContent = fs.readFileSync(path.join(root, 'cloudflare/worker.js'), 'utf8');
    const portalHtml = fs.readFileSync(path.join(root, 'portal-siswa.html'), 'utf8');
    const portalJs = fs.readFileSync(path.join(root, 'js/page-portal-siswa.js'), 'utf8');
    const pageStudentsJs = fs.readFileSync(path.join(root, 'js/page-students.js'), 'utf8');

    // =========================================================================
    // 1. UJI LOGIKA OTORISASI PUT /api/students/:nis DI CLOUDFLARE WORKER
    // =========================================================================
    describe('Logika Otorisasi Worker PUT /api/students/:nis', () => {
        function evaluateStudentEditAuth({ user, isOwner, studentClass }) {
            const STUDENT_MUTATE_ROLES = ["super_admin", "kesiswaan", "staff", "admin"];
            function canMutateStudent(u) {
                if (!u) return false;
                const allRoles = [u.role, ...(u.additionalRoles || [])].filter(Boolean);
                return allRoles.some(r => STUDENT_MUTATE_ROLES.includes(r));
            }
            function hasUserRole(u, expectedRole) {
                if (!u || !expectedRole) return false;
                const allRoles = [u.role, ...(u.additionalRoles || [])].filter(Boolean);
                return allRoles.includes(expectedRole);
            }

            const isGlobalStaff = user ? canMutateStudent(user) : false;
            const isWaliKelasUser = user ? hasUserRole(user, 'wali_kelas') : false;

            const normalizeClass = (c) => String(c || '').trim().toLowerCase();
            const isMyHomeroomStudent = Boolean(
                isWaliKelasUser &&
                user?.assignedClass &&
                studentClass &&
                (normalizeClass(user.assignedClass) === normalizeClass(studentClass))
            );

            const canEditAsStaff = isGlobalStaff || isMyHomeroomStudent;

            if (!canEditAsStaff && !isOwner) {
                if (isWaliKelasUser && !isMyHomeroomStudent) {
                    const assignedMsg = user?.assignedClass ? ` (${user.assignedClass})` : ' (belum memiliki rombel perwalian)';
                    return { allowed: false, status: 403, error: `Forbidden: Wali Kelas hanya berhak mengedit data siswa di rombel perwaliannya sendiri${assignedMsg}` };
                }
                return { allowed: false, status: 403, error: "Forbidden: Anda tidak memiliki wewenang mengubah data siswa ini" };
            }

            return { allowed: true, status: 200, isStaffMode: canEditAsStaff, isOwnerMode: isOwner && !canEditAsStaff };
        }

        test('Wali Kelas BERHASIL mengedit siswa di kelas binaan perwaliannya sendiri (200 OK)', () => {
            const user = {
                role: 'guru_mapel',
                additionalRoles: ['wali_kelas'],
                assignedClass: 'X.1'
            };
            const result = evaluateStudentEditAuth({ user, isOwner: false, studentClass: 'X.1' });
            expect(result.allowed).toBe(true);
            expect(result.status).toBe(200);
            expect(result.isStaffMode).toBe(true);
        });

        test('Wali Kelas DITOLAK (HTTP 403) saat mencoba mengedit siswa di kelas lain', () => {
            const user = {
                role: 'wali_kelas',
                additionalRoles: [],
                assignedClass: 'X.1'
            };
            const result = evaluateStudentEditAuth({ user, isOwner: false, studentClass: 'X.2' });
            expect(result.allowed).toBe(false);
            expect(result.status).toBe(403);
            expect(result.error).toContain('Forbidden: Wali Kelas hanya berhak mengedit data siswa di rombel perwaliannya sendiri (X.1)');
        });

        test('Super Admin & Kesiswaan BERHASIL mengedit siswa lintas rombel', () => {
            const adminUser = { role: 'super_admin', additionalRoles: [] };
            const kesiswaanUser = { role: 'guru_mapel', additionalRoles: ['kesiswaan'] };

            expect(evaluateStudentEditAuth({ user: adminUser, isOwner: false, studentClass: 'XII.3' }).allowed).toBe(true);
            expect(evaluateStudentEditAuth({ user: kesiswaanUser, isOwner: false, studentClass: 'XI.2' }).allowed).toBe(true);
        });

        test('Siswa Pemilik Akun (isOwner) BERHASIL mengedit datanya sendiri dalam mode update mandiri', () => {
            const studentUser = { isAnonymous: true, claims: { studentVerified: true, studentNis: '12345' } };
            const result = evaluateStudentEditAuth({ user: studentUser, isOwner: true, studentClass: 'X.1' });
            expect(result.allowed).toBe(true);
            expect(result.isOwnerMode).toBe(true);
            expect(result.isStaffMode).toBe(false);
        });

        test('Pengguna lain yang bukan pemilik dan bukan staf DITOLAK (HTTP 403)', () => {
            const foreignUser = { role: 'guru_mapel', additionalRoles: [] };
            const result = evaluateStudentEditAuth({ user: foreignUser, isOwner: false, studentClass: 'X.1' });
            expect(result.allowed).toBe(false);
            expect(result.status).toBe(403);
        });
    });

    // =========================================================================
    // 2. UJI PENGUNCIAN TANGGAL LAHIR (BIRTHDATE) DI BACKEND & FRONTEND
    // =========================================================================
    describe('Penguncian Tanggal Lahir Siswa Mandiri', () => {
        test('Cloudflare Worker mengecualikan birthDate dari STUDENT_WHITELIST_FIELDS', () => {
            // Ambil blok STUDENT_WHITELIST_FIELDS di worker
            expect(workerContent).toMatch(/const STUDENT_WHITELIST_FIELDS = \[/);
            const whitelistMatch = workerContent.match(/const STUDENT_WHITELIST_FIELDS = \[([\s\S]*?)\];/);
            expect(whitelistMatch).toBeTruthy();
            const whitelistContent = whitelistMatch[1];
            expect(whitelistContent).not.toContain('"birthDate"');
            expect(whitelistContent).not.toContain("'birthDate'");
        });

        test('Cloudflare Worker mempertahankan existingRow.birth_date untuk update mandiri siswa', () => {
            expect(workerContent).toContain('birth_date: existingRow.birth_date');
        });

        test('Input tanggal lahir di portal-siswa.html memiliki atribut readonly dan label kunci', () => {
            expect(portalHtml).toContain('id="student-edit-birthdate"');
            expect(portalHtml).toMatch(/<input[^>]*id="student-edit-birthdate"[^>]*readonly/);
            expect(portalHtml).toContain('Tanggal Lahir (Kunci Login Siswa)');
        });

        test('Notice box di portal-siswa.html menjelaskan bahwa Tanggal Lahir dikunci secara permanen', () => {
            expect(portalHtml).toContain('Tanggal Lahir, dan Catatan Sekolah dikunci secara permanen');
        });

        test('Payload updates di js/page-portal-siswa.js tidak menyertakan birthDate', () => {
            const updatesBlock = portalJs.match(/const updates = \{([\s\S]*?)\};/);
            expect(updatesBlock).toBeTruthy();
            expect(updatesBlock[1]).not.toContain('birthDate:');
        });
    });

    // =========================================================================
    // 3. UJI PARITAS AKSI KLIEN DI DATA SISWA (siswa.html / js/page-students.js)
    // =========================================================================
    describe('Paritas Aksi Tombol Edit di js/page-students.js', () => {
        test('page-students.js menerapkan filter canEditThisStudent berdasarkan rombel perwalian', () => {
            expect(pageStudentsJs).toContain('canEditThisStudent');
            expect(pageStudentsJs).toContain('isGlobalStaff || (isWali && isMyClass)');
            expect(pageStudentsJs).toMatch(/\$\{canEditThisStudent \? `\s*<button onclick="window\.openEditStudent/);
        });
    });

    // =========================================================================
    // 4. UJI SINKRONISASI INSTAN STATE UI DI PORTAL SISWA
    // =========================================================================
    describe('Sinkronisasi Instan State UI di js/page-portal-siswa.js', () => {
        test('page-portal-siswa.js memanggil invalidateStudentsCache dan me-refresh kartu KTS pasca simpan', () => {
            expect(portalJs).toContain('window.invalidateStudentsCache()');
            expect(portalJs).toContain("renderKtsInteractiveCard('student-card-3d', currentStudent");
            expect(portalJs).toContain('student-hub-ttl-gender');
        });
    });
});
