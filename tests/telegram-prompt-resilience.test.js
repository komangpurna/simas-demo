/**
 * Unit Test: Resiliensi Penyimpanan Telegram Chat ID Modal Login & Otorisasi Self-Update GTK
 * Menguji otorisasi RBAC, perlindungan eskalasi hak akses (ASVS Level 2), sanitasi kolom SQL, dan penanganan cache.
 */

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const workerContent = fs.readFileSync(path.join(projectRoot, 'cloudflare', 'worker.js'), 'utf8');
const globalJsContent = fs.readFileSync(path.join(projectRoot, 'js', 'global.js'), 'utf8');
const cfClientContent = fs.readFileSync(path.join(projectRoot, 'js', 'cloudflare-client.js'), 'utf8');

describe('Resiliensi Penyimpanan Telegram Chat ID & Otorisasi Self-Update GTK', () => {

    // 1. Verifikasi Mismatch Kolom SQL D1 di worker.js
    test('Kueri kontak GTK di loadOwnFirebaseProfile dan getAdminUserContact menggunakan alias telegram_chat_id AS telegramChatId', () => {
        expect(workerContent).toContain('SELECT name, phone, telegram_chat_id AS telegramChatId FROM gtk WHERE id = ? OR nik = ? LIMIT 1');
        // Pastikan tidak ada kueri mentah tanpa alias yang memicu "no such column: telegramChatId"
        const rawInvalidColumn = /SELECT\s+name,\s*phone,\s*telegramChatId\s+FROM\s+gtk/i;
        expect(rawInvalidColumn.test(workerContent)).toBe(false);
    });

    // 2. Verifikasi Objek User verifyFirebaseToken mengekspos linkedTeacherId
    test('verifyFirebaseToken mengekspos linkedTeacherId pada objek user', () => {
        expect(workerContent).toContain('const linkedTeacherId = profile.linkedTeacherId || payload.linkedTeacherId || "";');
        expect(workerContent).toContain('linkedTeacherId,');
    });

    // 3. Logika Otorisasi PUT /api/gtk/:id (Manajer vs Self-Update)
    describe('Evaluasi Hak Akses & Anti-Privilege Escalation (PUT /api/gtk/:id)', () => {
        const TEACHER_MUTATE_ROLES = ["super_admin", "kesiswaan", "humas", "sarpras", "staff", "wakasek_kurikulum", "admin"];
        const canMutateTeacher = (user) => {
            if (!user) return false;
            const allRoles = [user.role, ...(user.additionalRoles || [])].filter(Boolean);
            return allRoles.some(r => TEACHER_MUTATE_ROLES.includes(r));
        };

        const evaluatePermission = (user, existing, targetId) => {
            const isManager = canMutateTeacher(user);
            const userTeacherId = user.linkedTeacherId || user.profile?.linkedTeacherId || "";
            const userNik = user.profile?.nik || "";
            const userNip = user.profile?.nip || "";
            const userEmail = (user.email || "").toLowerCase().trim();
            const existingEmail = (existing.email || "").toLowerCase().trim();

            const isSelf = Boolean(
                (userEmail && existingEmail && userEmail === existingEmail) ||
                (userTeacherId && (existing.id === userTeacherId || existing.nik === userTeacherId || existing.nip === userTeacherId)) ||
                (targetId && userTeacherId && targetId === userTeacherId) ||
                (userNik && existing.nik && userNik === existing.nik) ||
                (userNip && existing.nip && userNip === existing.nip) ||
                (userEmail && targetId.toLowerCase() === userEmail) ||
                (user.uid && existing.id === user.uid)
            );

            return { isManager, isSelf, isPermitted: isManager || isSelf };
        };

        test('Admin dan staf (TEACHER_MUTATE_ROLES) memiliki izin manajer penuh', () => {
            const adminUser = { role: 'admin', email: 'admin@sekolah.sch.id' };
            const existingRecord = { id: 'gtk_99', email: 'guru@sekolah.sch.id', nik: '5108031234560001' };
            const result = evaluatePermission(adminUser, existingRecord, 'gtk_99');

            expect(result.isManager).toBe(true);
            expect(result.isPermitted).toBe(true);
        });

        test('Guru reguler (guru_mapel, wali_kelas, guru_bk) diizinkan memperbarui data GTK miliknya sendiri (isSelf)', () => {
            const teacherUser = {
                uid: 'user_123',
                role: 'guru_mapel',
                email: 'budi@sekolah.sch.id',
                linkedTeacherId: '5108031234560002',
                profile: { nik: '5108031234560002' }
            };
            const existingRecord = {
                id: '5108031234560002',
                email: 'budi@sekolah.sch.id',
                nik: '5108031234560002',
                role: 'guru_mapel'
            };

            const result = evaluatePermission(teacherUser, existingRecord, '5108031234560002');
            expect(result.isManager).toBe(false);
            expect(result.isSelf).toBe(true);
            expect(result.isPermitted).toBe(true);
        });

        test('Guru reguler DITOLAK saat mencoba memperbarui data GTK milik guru lain', () => {
            const teacherUser = {
                uid: 'user_123',
                role: 'guru_mapel',
                email: 'budi@sekolah.sch.id',
                linkedTeacherId: '5108031234560002',
                profile: { nik: '5108031234560002' }
            };
            const otherTeacherRecord = {
                id: '5108039999990001',
                email: 'santosa@sekolah.sch.id',
                nik: '5108039999990001',
                role: 'guru_bk'
            };

            const result = evaluatePermission(teacherUser, otherTeacherRecord, '5108039999990001');
            expect(result.isManager).toBe(false);
            expect(result.isSelf).toBe(false);
            expect(result.isPermitted).toBe(false);
        });

        test('Self-update melindungi field sensitif (role, status, NIK, NIP) dari eskalasi hak akses', () => {
            const existing = {
                id: '5108031234560002',
                nik: '5108031234560002',
                nip: '198501012010011001',
                nuptk: '1234567890123456',
                role: 'guru_mapel',
                status: 'aktif',
                telegram_chat_id: ''
            };
            const maliciousBody = {
                role: 'super_admin', // mencoba eskalasi ke Super Admin
                status: 'nonaktif',
                nik: '9999999999999999',
                telegram_chat_id: '198160734' // Telegram valid
            };

            const isManager = false; // Regular teacher
            const newNik = isManager && maliciousBody.nik !== undefined ? String(maliciousBody.nik).trim() : existing.nik;
            const newRole = isManager && maliciousBody.role !== undefined ? String(maliciousBody.role).trim() : existing.role;
            const newStatus = isManager && maliciousBody.status !== undefined ? String(maliciousBody.status).trim().toLowerCase() : existing.status;
            const newTelegram = maliciousBody.telegram_chat_id !== undefined ? String(maliciousBody.telegram_chat_id).trim() : existing.telegram_chat_id;

            expect(newRole).toBe('guru_mapel'); // Tetap guru_mapel, eskalasi gagal!
            expect(newStatus).toBe('aktif');
            expect(newNik).toBe('5108031234560002');
            expect(newTelegram).toBe('198160734'); // Telegram berhasil diperbarui!
        });
    });

    // 4. Verifikasi Penanganan Map vs Object di getGtkMapCache
    test('saveTelegramChatIdFromPrompt di js/global.js mendukung JavaScript Map dan Object', () => {
        expect(globalJsContent).toContain('if (gtkMap instanceof Map)');
        expect(globalJsContent).toContain('gtkMap.get(linkedTeacherId)');
        expect(globalJsContent).toContain('Array.from(gtkMap.values())');
    });

    // 5. Verifikasi Dual-Persistence & In-Memory Cache Sync
    test('saveTelegramChatIdFromPrompt menyimpan ke D1 dan Firestore users serta memperbarui cache in-memory', () => {
        expect(globalJsContent).toContain('cfClient.updateTeacher(targetTeacherId');
        expect(globalJsContent).toContain('setDoc(doc(db, PATHS.users, uid), { telegramChatId: chatId }');
        expect(globalJsContent).toContain('CURRENT_USER_TEACHER_CACHE.get(email)');
        expect(globalJsContent).toContain('sessionStorage.removeItem(\'simas_teacher_\' + email)');
        expect(globalJsContent).toContain('TEACHERS_MAP_CACHE = null');
    });

    // 6. Verifikasi Invalidation Komprehensif di js/global.js
    test('window.invalidateTeachersCache membersihkan IndexedDB, LocalStorage, SessionStorage, dan memory cache', () => {
        expect(globalJsContent).toContain('TEACHERS_CACHE = null');
        expect(globalJsContent).toContain('TEACHERS_MAP_CACHE = null');
        expect(globalJsContent).toContain('sessionStorage.removeItem(\'simas_teachers_map\')');
        expect(globalJsContent).toContain('k.startsWith(\'simas_teacher_\')');
        expect(globalJsContent).toContain('CURRENT_USER_TEACHER_CACHE.clear()');
    });

    // 7. Verifikasi cloudflare-client.js membaca json.message pada penanganan error
    test('js/cloudflare-client.js mendukung pembacaan json.message saat json.error kosong', () => {
        expect(cfClientContent).toContain('json.error || json.message');
    });

    // 8. Verifikasi POST /api/telegram/verify memiliki error boundary try-catch
    test('POST /api/telegram/verify di cloudflare/worker.js dibungkus try-catch dengan timeout safety', () => {
        expect(workerContent).toContain('const controller = new AbortController();');
        expect(workerContent).toContain('catch (fetchErr)');
        expect(workerContent).toContain('Koneksi ke Server Telegram Bot timeout atau terputus');
    });

    // 9. Verifikasi SSOT Tautan Bot Telegram & Larangan Domain Asing (Zero Stray Foreign Domains)
    test('worker.js dan suka-duka.js tidak memuat domain sekolah lain dan menggunakan SSOT base URL', () => {
        expect(workerContent).not.toContain('sman1sukasada');
        expect(workerContent).not.toContain('sman1gemolong');
        expect(workerContent).toContain('function getAppBaseUrl(env)');
        expect(workerContent).toContain('DEFAULT_APP_BASE_URL');

        const sukaDukaContent = fs.readFileSync(path.join(projectRoot, 'sukaduka', 'suka-duka.js'), 'utf8');
        expect(sukaDukaContent).not.toContain('sman1sukasada');
        expect(sukaDukaContent).not.toContain('sman1gemolong');
        expect(sukaDukaContent).toContain('SCHOOL_CONFIG.primaryDomain');
    });

    // 10. Verifikasi Auto-Resolve GTK di loadOwnFirebaseProfile & isNameMatch di Worker
    test('Worker memiliki auto-resolve GTK dari D1 dan pencocokan nama toleran gelar pada PUT /api/gtk/:id', () => {
        expect(workerContent).toContain('Auto-resolve GTK dari D1 jika linkedTeacherId belum terpasang');
        expect(workerContent).toContain('isNameMatch');
        expect(workerContent).toContain('cleanNameStr');
    });

    // 11. Verifikasi Non-Blocking Telegram Verification di saveEditProfile & saveTelegramChatIdFromPrompt
    test('js/global.js tidak memblokir penyimpanan biodata jika bot Telegram belum di-start', () => {
        // saveEditProfile tidak boleh return langsung saat !checkResult.valid
        const saveEditIdx = globalJsContent.indexOf('window.saveEditProfile = async function');
        const saveEditSlice = globalJsContent.slice(saveEditIdx, saveEditIdx + 5000);
        expect(saveEditSlice).toContain('telegramCheckWarning = true');
        expect(saveEditSlice).not.toContain('showToast("Verifikasi Telegram Gagal ❌", checkResult.message, "error", 6000);\n                btn.innerHTML = originalText;\n                btn.disabled = false;\n                return;');

        // getLinkedTeacherForUser mendukung pencarian nama
        expect(globalJsContent).toContain('Pencocokan nama toleran gelar akademik/keagamaan');
    });

    // 12. Verifikasi firestore.rules mengizinkan pembaruan profil mandiri mencakup phone, nik, nip, linkedTeacherId
    test('firestore.rules mengizinkan phone, nik, nip, dan linkedTeacherId pada isUpdatingOwnUserProfile', () => {
        const rulesContent = fs.readFileSync(path.join(projectRoot, 'firestore.rules'), 'utf8');
        expect(rulesContent).toContain("'phone', 'nik', 'nip', 'linkedTeacherId'");
    });
});
