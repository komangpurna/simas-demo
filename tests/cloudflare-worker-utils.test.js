/**
 * Unit Test: Cloudflare D1 & Worker Gateway Utils
 * Menguji validasi payload, verifikasi JWT, sanitasi parameter, dan routing logic
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Cloudflare D1 & Worker Security & Validation Utils', () => {
    // 1. Uji Sanitasi Input Event Agenda
    test('Memvalidasi format tanggal YYYY-MM-DD dengan benar', () => {
        const isValidDate = (str) => /^\d{4}-\d{2}-\d{2}$/.test(str);
        
        expect(isValidDate('2026-08-23')).toBe(true);
        expect(isValidDate('2026-12-31')).toBe(true);
        expect(isValidDate('23-08-2026')).toBe(false);
        expect(isValidDate('2026/08/23')).toBe(false);
        expect(isValidDate('invalid-date')).toBe(false);
    });

    // 2. Uji Deteksi Kategori & Warna Event
    test('Menentukan warna event berdasarkan kategori', () => {
        const getColorByType = (type) => {
            if (type === 'libur') return 'rose';
            if (type === 'penting') return 'amber';
            return 'blue';
        };

        expect(getColorByType('libur')).toBe('rose');
        expect(getColorByType('penting')).toBe('amber');
        expect(getColorByType('kegiatan')).toBe('blue');
        expect(getColorByType('umum')).toBe('blue');
    });

    // 3. Uji Verifikasi Issuer & Audience Firebase Token
    test('Memverifikasi Issuer dan Audience Firebase Project ID', () => {
        const verifyClaims = (payload, projectId) => {
            const expectedIss = `https://securetoken.google.com/${projectId}`;
            if (payload.iss !== expectedIss) return false;
            if (payload.aud !== projectId) return false;
            if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return false;
            return true;
        };

        const validPayload = {
            iss: 'https://securetoken.google.com/smagesa',
            aud: 'smagesa',
            exp: Math.floor(Date.now() / 1000) + 3600,
            user_id: 'user123'
        };

        const wrongIssPayload = {
            iss: 'https://securetoken.google.com/other-project',
            aud: 'smagesa',
            exp: Math.floor(Date.now() / 1000) + 3600
        };

        const expiredPayload = {
            iss: 'https://securetoken.google.com/smagesa',
            aud: 'smagesa',
            exp: Math.floor(Date.now() / 1000) - 3600
        };

        expect(verifyClaims(validPayload, 'smagesa')).toBe(true);
        expect(verifyClaims(wrongIssPayload, 'smagesa')).toBe(false);
        expect(verifyClaims(expiredPayload, 'smagesa')).toBe(false);
    });

    // 4. Uji RBAC Manager Roles & Multi-Role Support
    test('Memverifikasi hak akses manajer agenda (RBAC & Multi-Role)', () => {
        const managerRoles = ['super_admin', 'kepala_sekolah', 'wakasek_kurikulum', 'kesiswaan', 'kepala_lab', 'admin'];
        const isManager = (user) => {
            if (!user) return false;
            if (user.role === 'super_admin') return true;
            const allRoles = [user.role, ...(user.additionalRoles || [])].filter(Boolean);
            return allRoles.some(r => managerRoles.includes(r));
        };

        expect(isManager({ role: 'super_admin' })).toBe(true);
        expect(isManager({ role: 'kepala_sekolah' })).toBe(true);
        expect(isManager({ role: 'guru_mapel', additionalRoles: ['wakasek_kurikulum'] })).toBe(true);
        expect(isManager({ role: 'guru_mapel', additionalRoles: ['wali_kelas'] })).toBe(false);
        expect(isManager({ role: 'siswa' })).toBe(false);
        expect(isManager({ uid: 'official-account-without-role', role: '' })).toBe(false);
        expect(isManager(null)).toBe(false);
    });

    // 5. Uji Sanitasi Pesan HTML Telegram
    test('Meng-escape karakter khusus HTML pada pesan Telegram dengan benar', () => {
        const escapeTelegramHtml = (str) => {
            if (str === null || str === undefined) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        };

        expect(escapeTelegramHtml('John & Doe')).toBe('John &amp; Doe');
        expect(escapeTelegramHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(escapeTelegramHtml('<b>Hello</b>')).toBe('&lt;b&gt;Hello&lt;/b&gt;');
        expect(escapeTelegramHtml(null)).toBe('');
    });

    // 6. Uji Helper Base64Url & JWT Part Parsing
    test('Mem-parsing Base64URL JSON payload dengan benar', () => {
        const parseJwtPart = (base64Url) => {
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const padLen = (4 - (base64.length % 4)) % 4;
            const padded = base64 + '='.repeat(padLen);
            const jsonStr = Buffer.from(padded, 'base64').toString('utf8');
            return JSON.parse(jsonStr);
        };

        const sampleObj = { sub: 'uid_123', iss: 'https://securetoken.google.com/smagesa', aud: 'smagesa', exp: 1999999999 };
        const b64 = Buffer.from(JSON.stringify(sampleObj)).toString('base64url');

        const parsed = parseJwtPart(b64);
        expect(parsed.sub).toBe('uid_123');
        expect(parsed.aud).toBe('smagesa');
    });

    // 7. Uji Deteksi Bentrok Jadwal Lab (Overlap Algorithm)
    test('Mendeteksi bentrok rentang jam pelajaran laboratorium dengan akurat', () => {
        const isTimeSlotOverlapping = (startA, endA, startB, endB) => {
            return !(endA < startB || startA > endB);
        };

        // Kasus 1: Bentrok penuh (sama persis)
        expect(isTimeSlotOverlapping(1, 4, 1, 4)).toBe(true);

        // Kasus 2: Bentrok sebagian (overlap di tengah)
        expect(isTimeSlotOverlapping(1, 3, 3, 5)).toBe(true);
        expect(isTimeSlotOverlapping(2, 4, 1, 3)).toBe(true);

        // Kasus 3: Tidak bentrok (sebelum / sesudah)
        expect(isTimeSlotOverlapping(1, 2, 3, 4)).toBe(false);
        expect(isTimeSlotOverlapping(5, 7, 1, 4)).toBe(false);
    });

    // 8. Uji RBAC Pengelolaan Master Jenis Pelanggaran & Lab
    test('Memvalidasi RBAC jenis pelanggaran dan master lab', () => {
        const canEditViolationTypes = (user) => {
            if (!user) return false;
            if (user.role === 'super_admin') return true;
            const allRoles = [user.role, ...(user.additionalRoles || [])].filter(Boolean);
            return allRoles.some(r => ['super_admin', 'kesiswaan', 'staff', 'guru_bk', 'admin'].includes(r));
        };

        const canManageLabs = (user) => {
            if (!user) return false;
            if (user.role === 'super_admin') return true;
            const allRoles = [user.role, ...(user.additionalRoles || [])].filter(Boolean);
            return allRoles.some(r => ['super_admin', 'kepala_lab', 'admin'].includes(r));
        };

        expect(canEditViolationTypes({ role: 'guru_bk' })).toBe(true);
        expect(canEditViolationTypes({ role: 'guru_mapel' })).toBe(false);
        expect(canEditViolationTypes({ role: 'guru_mapel', additionalRoles: ['guru_bk'] })).toBe(true);

        expect(canManageLabs({ role: 'kepala_lab' })).toBe(true);
        expect(canManageLabs({ role: 'guru_mapel' })).toBe(false);
        expect(canManageLabs({ role: 'guru_mapel', additionalRoles: ['kepala_lab'] })).toBe(true);
    });

    test('Worker tidak mempercayai role dari header browser dan menolak webhook tanpa secret', () => {
        const workerSource = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8');
        const clientSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloudflare-client.js'), 'utf8');

        expect(workerSource).not.toContain('request.headers.get("X-User-Role")');
        expect(clientSource).not.toContain("'X-User-Role'");
        expect(workerSource).toContain('Telegram webhook secret belum dikonfigurasi');
        expect(workerSource).toContain('ON CONFLICT(token) DO UPDATE SET');
        expect(workerSource).toContain('user_id = excluded.user_id');
    });

    test('Klien push memakai Cloudflare dan sengaja mempertahankan token saat logout', () => {
        const pushSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'push-notification.js'), 'utf8');

        expect(pushSource).toContain('cfClient.registerPushToken');
        expect(pushSource).not.toContain('firebase-functions.js');
        expect(pushSource).toContain('retained: true');
    });

    test('Callable publik telah berpindah ke Worker dan login siswa mengikat custom claims', () => {
        const workerSource = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8');
        const capsuleSource = fs.readFileSync(path.join(__dirname, '..', 'pub', 'timecapsule.js'), 'utf8');

        expect(capsuleSource).not.toContain('firebase-functions.js');
        expect(capsuleSource).toContain('/api/timecapsule/submit');
        expect(workerSource).toContain('setFirebaseCustomClaims(env, authResult.user.uid');
        expect(workerSource).toContain('studentVerified: true');
        expect(workerSource).toContain('Terlalu banyak percobaan login');
    });

    // 9. Uji Fungsi Helper recordAuditLog & Bebas Referensi authResult.payload
    test('Worker mendefinisikan recordAuditLog dan tidak memiliki referensi authResult.payload yang usang', async () => {
        const workerSource = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8');

        expect(workerSource).toContain('async function recordAuditLog(env,');
        expect(workerSource).not.toContain('authResult.payload.user_id');
        expect(workerSource).not.toContain('authResult.payload.name');
        expect(workerSource).not.toContain('authResult.payload.email');

        // Uji eksekusi mock recordAuditLog
        const bindMock = jest.fn().mockReturnValue({ run: jest.fn().mockResolvedValue({ success: true }) });
        const prepareMock = jest.fn().mockReturnValue({ bind: bindMock });
        const fakeEnv = { DB: { prepare: prepareMock } };

        // Simulasi fungsi recordAuditLog
        const recordAuditLogMock = async (env, {
            id = null,
            action,
            target_id = null,
            actor_uid = null,
            actor_name = null,
            old_data = null,
            new_data = null,
            details = null,
            timestamp = null
        } = {}) => {
            if (!env || !env.DB || !action) return;
            const logId = id || "audit_" + Date.now();
            const timeStr = timestamp || new Date().toISOString();
            const oldDataStr = typeof old_data === "object" && old_data !== null ? JSON.stringify(old_data) : (old_data ? String(old_data) : null);
            const newDataStr = typeof new_data === "object" && new_data !== null ? JSON.stringify(new_data) : (new_data ? String(new_data) : null);

            const stmt = env.DB.prepare(`
                INSERT INTO audit_logs (id, action, target_id, actor_uid, actor_name, old_data, new_data, details, timestamp, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            `);

            await stmt.bind(
                logId,
                String(action).trim(),
                target_id ? String(target_id).trim() : null,
                actor_uid ? String(actor_uid).trim() : "system",
                actor_name ? String(actor_name).trim() : "System",
                oldDataStr,
                newDataStr,
                details ? String(details).trim() : null,
                timeStr
            ).run();
        };

        await recordAuditLogMock(fakeEnv, {
            action: 'UPDATE_RAPOR_CONFIG',
            target_id: 'rapor_config',
            actor_uid: 'uid_test_123',
            actor_name: 'Wakasek Kurikulum',
            new_data: { tahun_ajaran: '2026/2027' },
            details: 'Memperbarui konfigurasi master E-Rapor'
        });

        expect(prepareMock).toHaveBeenCalledTimes(1);
        expect(bindMock).toHaveBeenCalledWith(
            expect.stringMatching(/^audit_/),
            'UPDATE_RAPOR_CONFIG',
            'rapor_config',
            'uid_test_123',
            'Wakasek Kurikulum',
            null,
            JSON.stringify({ tahun_ajaran: '2026/2027' }),
            'Memperbarui konfigurasi master E-Rapor',
            expect.any(String)
        );
    });

    // 10. Uji Fungsi Helper verifyAuthToken
    test('Worker mendefinisikan helper verifyAuthToken untuk otentikasi perwalian & permisi', async () => {
        const workerSource = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8');

        expect(workerSource).toContain('async function verifyAuthToken(request,');
        
        // Simulasi fungsi verifyAuthToken
        const mockVerifyFirebaseToken = jest.fn()
            .mockResolvedValueOnce({
                valid: true,
                user: { uid: 'user_wali_123', email: 'wali@smagesa.sch.id', role: 'wali_kelas', displayName: 'Wali Kelas XII' }
            })
            .mockResolvedValueOnce({
                valid: false,
                error: 'Token expired'
            });

        const verifyAuthTokenMock = async (req) => {
            const authResult = await mockVerifyFirebaseToken(req);
            if (!authResult || !authResult.valid || !authResult.user) return null;
            return {
                ...authResult.user,
                name: authResult.user.displayName || authResult.user.email || "Pengguna"
            };
        };

        const validUser = await verifyAuthTokenMock({});
        expect(validUser).not.toBeNull();
        expect(validUser.uid).toBe('user_wali_123');
        expect(validUser.name).toBe('Wali Kelas XII');

        const invalidUser = await verifyAuthTokenMock({});
        expect(invalidUser).toBeNull();
    });

    // 11. Uji Integritas Kolom Tabel records pada Cloudflare D1
    test('Worker menggunakan nama kolom desc yang valid dan tidak memiliki kolom description pada tabel records', () => {
        const workerSource = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8');

        // Pastikan tidak ada INSERT INTO records yang memuat kolom description
        const recordsInsertRegex = /INSERT\s+INTO\s+records\s*\(([\s\S]*?)\)/gi;
        let match;
        while ((match = recordsInsertRegex.exec(workerSource)) !== null) {
            const columns = match[1].split(',').map(c => c.trim().toLowerCase());
            expect(columns).not.toContain('description');
            expect(columns).toContain('desc');
        }
    });

    // 12. Uji Integrasi Supabase Keep-Alive pada Worker Auto-Cleanup
    test('Worker mendefinisikan dan mengeksekusi pingSupabaseKeepAlive pada performAutoCleanup', async () => {
        const workerSource = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8');

        expect(workerSource).toContain('async function pingSupabaseKeepAlive(env)');
        expect(workerSource).toContain('await pingSupabaseKeepAlive(env)');

        // Simulasi fungsi pingSupabaseKeepAlive
        const mockFetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200
        });

        const simulatePing = async (env, fetchFn = mockFetch) => {
            const url = (env?.SUPABASE_URL || 'https://elrmzlicuuglnoeedusr.supabase.co').replace(/\/$/, '');
            const key = (env?.SUPABASE_ANON_KEY || 'test_key').trim();
            const res = await fetchFn(`${url}/rest/v1/sukaduka_config?select=value&key=eq.nominal_iuran`, {
                method: 'GET',
                headers: {
                    'apikey': key,
                    'Authorization': `Bearer ${key}`
                }
            });
            return { success: res.ok, status: res.status };
        };

        const result = await simulatePing({
            SUPABASE_URL: 'https://elrmzlicuuglnoeedusr.supabase.co',
            SUPABASE_ANON_KEY: 'test_key'
        });

        expect(result.success).toBe(true);
        expect(result.status).toBe(200);
        expect(mockFetch).toHaveBeenCalledWith(
            'https://elrmzlicuuglnoeedusr.supabase.co/rest/v1/sukaduka_config?select=value&key=eq.nominal_iuran',
            expect.objectContaining({
                method: 'GET',
                headers: expect.objectContaining({
                    'apikey': 'test_key',
                    'Authorization': 'Bearer test_key'
                })
            })
        );
    });

    // 13. Uji regresi: refresh bundle jurnal tidak boleh membangun ulang metadata kelas
    test('Refresh master jurnal memakai metadata kelas tersimpan tanpa full scan students', () => {
        const workerSource = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8');
        const masterRouteStart = workerSource.indexOf('if (path === "/api/jurnal/master" && method === "GET")');
        const historyRouteStart = workerSource.indexOf('// 2. GET /api/jurnal/history', masterRouteStart);
        const masterRouteSource = workerSource.slice(masterRouteStart, historyRouteStart);

        expect(masterRouteStart).toBeGreaterThan(-1);
        expect(historyRouteStart).toBeGreaterThan(masterRouteStart);
        expect(masterRouteSource).toContain('if (masterClasses.length === 0)');
        expect(masterRouteSource).not.toContain('classes.length === 0 || forceRefresh');
        expect(masterRouteSource).toContain('Cache-Control", forceRefresh ? "no-cache, no-store, must-revalidate"');
    });

    test('Konfigurasi kelas aktif memakai D1 sebagai SSOT tanpa dual-write Firestore', () => {
        const workerSource = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8');
        const globalSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'global.js'), 'utf8');
        const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-settings.js'), 'utf8');
        const saveFunctionMatches = settingsSource.match(/window\.saveActiveClassesConfig\s*=\s*async/g) || [];

        expect(workerSource).toContain('const activeSetting = settings.active_classes;');
        expect(globalSource).toContain("getSystemSetting('active_classes')");
        expect(globalSource).not.toContain('data.activeClasses || data.activeAttendanceClasses');
        expect(settingsSource).toContain("saveSystemSetting('active_classes', { list: activeClasses })");
        expect(settingsSource).not.toContain('activeAttendanceClasses: activeClasses');
        expect(settingsSource).toContain('Konfigurasi lama berhasil dimigrasikan satu kali ke D1.');
        expect(settingsSource).not.toContain('updateActiveClassesCountBadge');
        expect(settingsSource).toContain('container.onchange = updateActiveClassesCount;');
        expect(saveFunctionMatches).toHaveLength(1);
    });

    test('Konfigurasi EWS memakai endpoint D1 khusus dengan RBAC dan validasi server-side', () => {
        const workerSource = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8');
        const clientSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloudflare-client.js'), 'utf8');
        const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-settings.js'), 'utf8');
        const calculatorSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'ews-calculator.js'), 'utf8');

        expect(workerSource).toContain('path === "/api/settings/ews-config" && method === "GET"');
        expect(workerSource).toContain('path === "/api/settings/ews-config" && method === "PUT"');
        expect(workerSource).toContain('hasUserRole(authResult.user, "super_admin")');
        expect(workerSource).toContain('const config = normalizeEwsConfig(body);');
        expect(workerSource).toContain('action: "UPDATE_EWS_CONFIG"');
        expect(clientSource).toContain("this.request('/api/settings/ews-config'");
        expect(settingsSource).not.toContain("doc(db, PATHS.settings, 'ews_config')");
        expect(settingsSource).toContain('window.cfClient.saveEwsConfig(payload)');
        expect(calculatorSource).toContain('window.cfClient.getEwsConfig()');
    });

    test('Edge Function secure-proxy menyelesaikan data guru ke Cloudflare D1 API dan tidak memanggil koleksi Firestore teachers', () => {
        const proxySource = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'secure-proxy', 'index.ts'), 'utf8');

        expect(proxySource).not.toContain('/databases/(default)/documents/teachers/');
        expect(proxySource).not.toContain('fetchFirestoreCollection("teachers"');
        expect(proxySource).toContain('/api/teachers/${encodeURIComponent(access.linkedTeacherId)}');
        expect(proxySource).toContain('/api/teachers?status=active');
    });

    // 14. Uji pencegahan route shadowing pada endpoint /api/jurnal (D1 SSOT)
    test('Router Worker /api/jurnal mengevaluasi sub-rute spesifik (settings, lokasi, mapel, teachers) sebelum rute generik entri jurnal', () => {
        const workerSource = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8');

        const idxPutSettings = workerSource.indexOf('path === "/api/jurnal/settings" && method === "PUT"');
        const idxDelMapel = workerSource.indexOf('path.startsWith("/api/jurnal/mapel/") && method === "DELETE"');
        const idxDelLokasi = workerSource.indexOf('path.startsWith("/api/jurnal/lokasi/") && method === "DELETE"');
        const idxDelTeachers = workerSource.indexOf('path.startsWith("/api/jurnal/gtk/") || path.startsWith("/api/jurnal/teachers/")');
        const idxPutGeneric = workerSource.indexOf('const isSpecificJurnalPut = path === "/api/jurnal/settings";');
        const idxDelGeneric = workerSource.indexOf('const isSpecificJurnalDelete = path.startsWith("/api/jurnal/mapel/")');

        // Pastikan seluruh handler rute ditemukan di file
        expect(idxPutSettings).toBeGreaterThan(-1);
        expect(idxDelMapel).toBeGreaterThan(-1);
        expect(idxDelLokasi).toBeGreaterThan(-1);
        expect(idxDelTeachers).toBeGreaterThan(-1);
        expect(idxPutGeneric).toBeGreaterThan(-1);
        expect(idxDelGeneric).toBeGreaterThan(-1);

        // Pastikan handler spesifik berada SEBELUM handler generik (tidak tercekik/shadowed)
        expect(idxPutSettings).toBeLessThan(idxPutGeneric);
        expect(idxDelMapel).toBeLessThan(idxDelGeneric);
        expect(idxDelLokasi).toBeLessThan(idxDelGeneric);
        expect(idxDelTeachers).toBeLessThan(idxDelGeneric);

        // Pastikan rute generik memiliki guard eksklusi eksplisit
        expect(workerSource).toContain('!isSpecificJurnalPut');
        expect(workerSource).toContain('!isSpecificJurnalDelete');
    });

    // 15. Uji filter kelas pada Riwayat BK (Ruang BK D1 SSOT)
    test('Riwayat BK mendukung filter kelas dan opsi angkatan di Worker, Client, dan UI', () => {
        const workerSource = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8');
        const clientSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloudflare-client.js'), 'utf8');
        const bkPageSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'page-bk.js'), 'utf8');
        const bkHtmlSource = fs.readFileSync(path.join(__dirname, '..', 'bk.html'), 'utf8');

        // Worker D1 mendukung query parameter student_class / class & prefix angkatan ALL-
        expect(workerSource).toContain('url.searchParams.get("student_class") || url.searchParams.get("class")');
        expect(workerSource).toContain('studentClass.startsWith("ALL-")');
        expect(workerSource).toContain('AND (student_class LIKE ? OR student_class = ?)');
        expect(workerSource).toContain('AND student_class = ?');

        // Cloudflare Client mem-passing student_class
        expect(clientSource).toContain("if (filters.student_class || filters.class || filters.studentClass) params.append('student_class'");

        // Halaman BK memiliki filter kelas dan fungsi pemuat opsi kelas
        expect(bkHtmlSource).toContain('id="filter-hist-class"');
        expect(bkHtmlSource).toContain('id="filter-hist-status"');
        expect(bkHtmlSource).toContain('id="filter-hist-start"');
        expect(bkHtmlSource).toContain('id="filter-hist-end"');
        expect(bkHtmlSource).toContain('window.loadBkHistoryFiltered()');
        expect(bkPageSource).toContain('async function loadClassOptions()');
        expect(bkPageSource).toContain("document.getElementById('filter-hist-class')");
        expect(bkPageSource).toContain('student_class: (classVal && !classVal.startsWith(\'ALL-\')) ? classVal : undefined');
    });

    // 16. Uji Logika Pembersihan Data Usang Firestore (class_transfers & student_sessions)
    test('Worker memiliki helper cleanupFirestoreStaleData, endpoint /api/system/cleanup, dan evaluasi TTL akurat', () => {
        const workerSource = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8');

        // Memastikan fungsi dan endpoint terdaftar di worker
        expect(workerSource).toContain('async function cleanupFirestoreStaleData(env)');
        expect(workerSource).toContain('path === "/api/system/cleanup" && method === "POST"');
        expect(workerSource).toContain('await cleanupFirestoreStaleData(env)');

        // Logika Evaluasi Kedaluwarsa class_transfers
        const now = Date.now();
        const evaluateClassTransferExpiry = (doc, referenceTime) => {
            const fields = doc.fields || {};
            if (fields.ttldelete?.timestampValue) {
                const ttlTime = new Date(fields.ttldelete.timestampValue).getTime();
                return !isNaN(ttlTime) && ttlTime <= referenceTime;
            }
            if (fields.movedAt?.timestampValue) {
                const movedTime = new Date(fields.movedAt.timestampValue).getTime();
                return !isNaN(movedTime) && movedTime <= referenceTime - (100 * 24 * 60 * 60 * 1000);
            }
            return false;
        };

        // Kasus 1: Dokumen class_transfers baru dibuat (TTL 100 hari ke depan) -> TIDAK expired
        const validTransferDoc = {
            name: 'projects/smagesa/databases/(default)/documents/class_transfers/doc1',
            fields: {
                ttldelete: { timestampValue: new Date(now + (99 * 24 * 60 * 60 * 1000)).toISOString() },
                movedAt: { timestampValue: new Date(now).toISOString() }
            }
        };
        expect(evaluateClassTransferExpiry(validTransferDoc, now)).toBe(false);

        // Kasus 2: Dokumen class_transfers sudah lewat 100 hari -> EXPIRED
        const expiredTransferDoc = {
            name: 'projects/smagesa/databases/(default)/documents/class_transfers/doc2',
            fields: {
                ttldelete: { timestampValue: new Date(now - 1000).toISOString() },
                movedAt: { timestampValue: new Date(now - (101 * 24 * 60 * 60 * 1000)).toISOString() }
            }
        };
        expect(evaluateClassTransferExpiry(expiredTransferDoc, now)).toBe(true);

        // Logika Evaluasi Kedaluwarsa student_sessions (> 7 hari)
        const SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
        const evaluateStudentSessionExpiry = (doc, referenceTime) => {
            const fields = doc.fields || {};
            if (fields.updatedAt?.timestampValue) {
                const updatedTime = new Date(fields.updatedAt.timestampValue).getTime();
                return !isNaN(updatedTime) && updatedTime <= referenceTime - SESSION_RETENTION_MS;
            }
            return false;
        };

        // Kasus 3: Sesi aktif siswa hari ini (baru login) -> TIDAK expired
        const activeSessionDoc = {
            name: 'projects/smagesa/databases/(default)/documents/student_sessions/user1',
            fields: {
                updatedAt: { timestampValue: new Date(now - (2 * 24 * 60 * 60 * 1000)).toISOString() } // 2 hari lalu
            }
        };
        expect(evaluateStudentSessionExpiry(activeSessionDoc, now)).toBe(false);

        // Kasus 4: Sesi usang siswa 10 hari lalu -> EXPIRED
        const staleSessionDoc = {
            name: 'projects/smagesa/databases/(default)/documents/student_sessions/user2',
            fields: {
                updatedAt: { timestampValue: new Date(now - (10 * 24 * 60 * 60 * 1000)).toISOString() } // 10 hari lalu
            }
        };
        expect(evaluateStudentSessionExpiry(staleSessionDoc, now)).toBe(true);
    });

    // 19. Uji Integritas Rolling Retention Cloudflare D1 (performAutoCleanup)
    test('Memverifikasi kueri retensi data Cloudflare D1 terdaftar lengkap di worker', () => {
        const workerPath = path.join(__dirname, '../cloudflare/worker.js');
        const workerSource = fs.readFileSync(workerPath, 'utf8');

        // Memastikan kueri pembersihan tabel operasional D1 & Supabase terdaftar
        expect(workerSource).toContain("/rest/v1/login_history?login_at=lt.");
        expect(workerSource).toContain("/rest/v1/audit_logs?timestamp=lt.");
        expect(workerSource).toContain("DELETE FROM calendar_events");
        expect(workerSource).toContain("DELETE FROM jurnal_guru \n            WHERE tanggal < date('now', '-3 years')");
        expect(workerSource).toContain("DELETE FROM lab_bookings \n            WHERE tanggal < date('now', '-3 years')");
        expect(workerSource).toContain("DELETE FROM notification_deliveries");
        expect(workerSource).toContain("DELETE FROM notification_jobs \n            WHERE datetime(created_at) < datetime('now', '-90 days')");
        expect(workerSource).toContain("DELETE FROM notification_channel_log \n            WHERE datetime(created_at) < datetime('now', '-90 days')");
        expect(workerSource).toContain("DELETE FROM webauthn_challenges \n            WHERE created_at < ?");
        expect(workerSource).toContain("DELETE FROM employee_activities \n            WHERE tanggal < date('now', '-3 years')");
        expect(workerSource).toContain("employee_activity_history kini telah diintegrasikan ke Supabase audit_logs");

        // Evaluasi logika kedaluwarsa tanggal D1 (3 tahun)
        const THREE_YEARS_MS = 3 * 365 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const isDateOlderThan3Years = (dateStr) => {
            const time = new Date(dateStr).getTime();
            return !isNaN(time) && time < (now - THREE_YEARS_MS);
        };

        expect(isDateOlderThan3Years('2020-01-01')).toBe(true);
        expect(isDateOlderThan3Years('2022-01-01')).toBe(true);
        expect(isDateOlderThan3Years(new Date().toISOString().slice(0, 10))).toBe(false);
    });
});



