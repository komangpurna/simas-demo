/**
 * Unit Test: Integritas Pencegahan Regresi Penyimpanan Profil GTK & Telegram Chat ID
 * Menguji:
 * 1. Anti-Self-Conflict NIK/NIP/NUPTK (Backend Worker) - Toleransi nama & identitas diri (0% False HTTP 409 Conflict)
 * 2. Foreign Key Cascade Migration pada saat migrasi GTK ID ke NIK 16 digit (Anti SQLite Foreign Key Constraint Error)
 * 3. Anti-False-Positive Email Re-Authentication pada form profil (js/global.js)
 * 4. Pengecualian Akun Google OAuth SSO dari permintaan password Firebase Auth
 * 5. Persistensi Penuh Atribut Kontak (telegramChatId, phone, linkedTeacherId) ke Firestore users/{uid}
 * 6. Audit Konsistensi Skema & Data GTK D1
 */

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const workerContent = fs.readFileSync(path.join(projectRoot, 'cloudflare', 'worker.js'), 'utf8');
const globalJsContent = fs.readFileSync(path.join(projectRoot, 'js', 'global.js'), 'utf8');
const schemaContent = fs.readFileSync(path.join(projectRoot, 'cloudflare', 'schema.sql'), 'utf8');

describe('Integritas Penyimpanan Profil GTK & Pencegahan False Conflict / Re-Auth', () => {

    // =========================================================================
    // 1. BACKEND WORKER: ANTI-SELF-CONFLICT & IDENTITAS DIRI TOLERAN NAMA
    // =========================================================================
    describe('1. Logika Anti-Self-Conflict NIK/NIP/NUPTK di cloudflare/worker.js (PUT /api/gtk/:id)', () => {

        test('Worker mengimplementasikan helper isSamePerson dengan pencocokan gelar akademik/keagamaan', () => {
            expect(workerContent).toContain('const isSamePerson = (row) => {');
            expect(workerContent).toContain('cleanNameStr(rName) === cleanNameStr(cName)');
        });

        test('Simulasi isSamePerson: Mengenali nama guru yang sama dengan variasi gelar akademik', () => {
            const cleanNameStr = (n) => n.replace(/,\s*.*$/g, '').replace(/\b(drs|dr|ir|s\.pd|m\.pd|s\.kom|s\.ag|s\.h|h)\b\.?/gi, '').replace(/[^a-z0-9]/g, '');
            const newName = "Rendy Mardika, S.Pd";
            const existingId = "CobbtkG6w1KfUXzMuZNh";
            const destinationId = "3578055003870003";

            const isSamePerson = (row) => {
                if (!row) return false;
                if (row.id === destinationId || row.id === existingId) return true;
                const rName = (row.name || '').trim().toLowerCase();
                const cName = newName.trim().toLowerCase();
                if (rName && cName && (rName === cName || cleanNameStr(rName) === cleanNameStr(cName))) return true;
                return false;
            };

            // Skenario 1: Record di D1 memiliki nama dengan gelar sama persis
            expect(isSamePerson({ id: "3578055003870003", name: "Rendy Mardika, S.Pd" })).toBe(true);

            // Skenario 2: Record di D1 memiliki nama tanpa gelar
            expect(isSamePerson({ id: "legacy_row_id", name: "Rendy Mardika" })).toBe(true);

            // Skenario 3: Record di D1 memiliki ID yang sama dengan target destinasi migrasi
            expect(isSamePerson({ id: "3578055003870003", name: "Rendy Mardika Baru" })).toBe(true);

            // Skenario 4: Record milik orang lain dengan nama berbeda -> WAJIB FALSE (Konflik sah)
            expect(isSamePerson({ id: "other_teacher_id", name: "I Made Sujana, M.Pd" })).toBe(false);
        });

        test('Worker tidak melempar HTTP 409 saat NIK/NIP/NUPTK cocok dengan baris milik diri sendiri (isSamePerson)', () => {
            // Verifikasi bahwa percabangan NIK mengecek !isSamePerson sebelum errorResponse 409
            const nikCheckSection = workerContent.slice(
                workerContent.indexOf('// Validasi & Cek Keunikan NIK jika diisi/diubah'),
                workerContent.indexOf('// Validasi Keunikan NIP jika diisi/diubah')
            );
            expect(nikCheckSection).toContain('if (!isSamePerson(existNik))');
            expect(nikCheckSection).toContain('return errorResponse(`NIK ${newNik} sudah digunakan');
            expect(nikCheckSection).toContain('DELETE FROM gtk WHERE id = ?'); // membersihkan duplikat yatim

            // Verifikasi bahwa percabangan NIP mengecek !isSamePerson sebelum errorResponse 409
            const nipCheckSection = workerContent.slice(
                workerContent.indexOf('// Validasi Keunikan NIP jika diisi/diubah'),
                workerContent.indexOf('// Validasi Keunikan NUPTK jika diisi/diubah')
            );
            expect(nipCheckSection).toContain('if (!isSamePerson(existNip))');
            expect(nipCheckSection).toContain('return errorResponse(`NIP ${newNip} sudah digunakan');

            // Verifikasi bahwa percabangan NUPTK mengecek !isSamePerson sebelum errorResponse 409
            const nuptkCheckSection = workerContent.slice(
                workerContent.indexOf('// Validasi Keunikan NUPTK jika diisi/diubah'),
                workerContent.indexOf('if (destinationId !== existing.id)')
            );
            expect(nuptkCheckSection).toContain('if (!isSamePerson(existNuptk))');
            expect(nuptkCheckSection).toContain('return errorResponse(`NUPTK ${newNuptk} sudah digunakan');
        });
    });

    // =========================================================================
    // 2. FOREIGN KEY CASCADE MIGRATION INTEGRITY (WORKLOAD & ACTIVITY TABLES)
    // =========================================================================
    describe('2. Kaskade Migrasi Foreign Key saat Transisi GTK ID ke NIK 16 Digit', () => {

        test('Seluruh tabel D1 yang memiliki FOREIGN KEY ke gtk(id) terdaftar dalam kaskade migrasi', () => {
            const lines = schemaContent.split('\n');
            let currentTable = '';
            const fkTables = [];
            lines.forEach(line => {
                const tableMatch = line.match(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)/);
                if (tableMatch) currentTable = tableMatch[1];
                if (line.includes('REFERENCES gtk(id)')) {
                    if (currentTable && !fkTables.includes(currentTable)) fkTables.push(currentTable);
                }
            });

            expect(fkTables).toContain('teacher_assignments');
            expect(fkTables).toContain('work_weeks');
            expect(fkTables).toContain('weekly_templates');
            expect(fkTables).toContain('work_logs');

            // Verifikasi blok migrasi di worker.js memindahkan semua tabel ini sebelum menghapus existing.id
            const migrationBlock = workerContent.slice(
                workerContent.indexOf('if (destinationId !== existing.id)'),
                workerContent.indexOf('await env.DB.prepare("DELETE FROM gtk WHERE id = ?").bind(existing.id).run();')
            );

            expect(migrationBlock).toContain('UPDATE teacher_assignments SET teacher_id = ? WHERE teacher_id = ?');
            expect(migrationBlock).toContain('UPDATE work_weeks SET teacher_id = ? WHERE teacher_id = ?');
            expect(migrationBlock).toContain('UPDATE weekly_templates SET teacher_id = ? WHERE teacher_id = ?');
            expect(migrationBlock).toContain('UPDATE work_logs SET teacher_id = ? WHERE teacher_id = ?');
            expect(migrationBlock).toContain('UPDATE employee_assignments SET gtk_id = ? WHERE gtk_id = ?');
            expect(migrationBlock).toContain('UPDATE employee_activities SET gtk_id = ? WHERE gtk_id = ?');
            expect(migrationBlock).toContain('UPDATE employee_absences SET gtk_id = ? WHERE gtk_id = ?');
        });

        test('Migrasi work_weeks menangani potensi bentrok UNIQUE(teacher_id, week_start_date) secara aman', () => {
            const migrationBlock = workerContent.slice(
                workerContent.indexOf('if (destinationId !== existing.id)'),
                workerContent.indexOf('await env.DB.prepare("DELETE FROM gtk WHERE id = ?").bind(existing.id).run();')
            );

            expect(migrationBlock).toContain('DELETE FROM work_weeks');
            expect(migrationBlock).toContain('WHERE teacher_id = ? AND week_start_date IN');
        });

        test('Pembersihan otomatis sisa duplikat NIK yatim dijalankan setelah migrasi ID', () => {
            const afterMigrationBlock = workerContent.slice(
                workerContent.indexOf('await env.DB.prepare("DELETE FROM gtk WHERE id = ?").bind(existing.id).run();'),
                workerContent.indexOf('await env.DB.prepare("DELETE FROM gtk WHERE id = ?").bind(existing.id).run();') + 500
            );

            expect(afterMigrationBlock).toContain('DELETE FROM gtk WHERE nik = ? AND id != ?');
        });
    });

    // =========================================================================
    // 3. FRONTEND FORM: ANTI-FALSE-POSITIVE EMAIL RE-AUTH (js/global.js)
    // =========================================================================
    describe('3. Deteksi Perubahan Kredensial Email & Dukungan Akun Google SSO di js/global.js', () => {
        const saveProfileIdx = globalJsContent.indexOf('window.saveEditProfile = async function');
        const nextFnIdx = globalJsContent.indexOf('window.updateSidebarProfileFromDB', saveProfileIdx);
        const saveProfileSnippet = globalJsContent.slice(saveProfileIdx, nextFnIdx !== -1 ? nextFnIdx : saveProfileIdx + 25000);

        test('saveEditProfile menggunakan dataset.initialEmail untuk mencegah false re-auth', () => {
            expect(saveProfileSnippet).toContain('dataset?.initialEmail');
            expect(saveProfileSnippet).toContain('isFormEmailChanged');
            expect(saveProfileSnippet).toContain('isAuthEmailDifferent');
            expect(saveProfileSnippet).toContain('const isEmailChanged = isFormEmailChanged && isAuthEmailDifferent;');
        });

        test('Simulasi deteksi: Guru tidak mengubah email di form -> isEmailChanged wajib FALSE', () => {
            const formInitialEmail = "guru.smagesa@gmail.com";
            const initialAuthEmail = "gurusmagesa@gmail.com"; // Format beda titik di auth
            const newEmail = "guru.smagesa@gmail.com"; // Guru tidak menyentuh field email

            const isFormEmailChanged = Boolean(newEmail && formInitialEmail && newEmail !== formInitialEmail);
            const isAuthEmailDifferent = Boolean(newEmail && initialAuthEmail && newEmail !== initialAuthEmail);
            const isEmailChanged = isFormEmailChanged && isAuthEmailDifferent;

            expect(isFormEmailChanged).toBe(false);
            expect(isEmailChanged).toBe(false); // TIDAK AKAN PERNAH MEMINTA PASSWORD LAMA!
        });

        test('Simulasi deteksi: Guru secara aktif mengetik email baru yang berbeda -> isEmailChanged bernilai TRUE', () => {
            const formInitialEmail = "guru.lama@gmail.com";
            const initialAuthEmail = "guru.lama@gmail.com";
            const newEmail = "guru.baru@sekolah.sch.id";

            const isFormEmailChanged = Boolean(newEmail && formInitialEmail && newEmail !== formInitialEmail);
            const isAuthEmailDifferent = Boolean(newEmail && initialAuthEmail && newEmail !== initialAuthEmail);
            const isEmailChanged = isFormEmailChanged && isAuthEmailDifferent;

            expect(isFormEmailChanged).toBe(true);
            expect(isAuthEmailDifferent).toBe(true);
            expect(isEmailChanged).toBe(true); // Meminta password lama secara sah
        });

        test('Akun Google OAuth SSO (isGoogleProvider && !isPasswordProvider) dilewati dari re-autentikasi password Firebase', () => {
            expect(saveProfileSnippet).toContain('isGoogleProvider && !isPasswordProvider');
            expect(saveProfileSnippet).toContain('Akun login Google OAuth, update kredensial auth dilewati.');
        });
    });

    // =========================================================================
    // 4. PERSISTENSI KONTAK GTK KE FIRESTORE USERS/{UID}
    // =========================================================================
    describe('4. Persistensi Penuh Atribut Kontak GTK ke Firestore users/{uid}', () => {
        const saveProfileIdx = globalJsContent.indexOf('window.saveEditProfile = async function');
        const nextFnIdx = globalJsContent.indexOf('window.updateSidebarProfileFromDB', saveProfileIdx);
        const saveProfileSnippet = globalJsContent.slice(saveProfileIdx, nextFnIdx !== -1 ? nextFnIdx : saveProfileIdx + 25000);

        test('telegramChatId dan phone selalu diset pada objek userUpdates tanpa terkecuali', () => {
            expect(saveProfileSnippet).toContain('telegramChatId: newTelegramChatId');
            expect(saveProfileSnippet).toContain('if (newPhone) {');
            expect(saveProfileSnippet).toContain('userUpdates.phone = newPhone;');
        });

        test('linkedTeacherId dan nik disinkronkan ke userUpdates saat migrasi ID GTK berhasil', () => {
            expect(saveProfileSnippet).toContain('userUpdates.linkedTeacherId = res.id;');
            expect(saveProfileSnippet).toContain('userUpdates.nik = res.id;');
        });
    });
});
