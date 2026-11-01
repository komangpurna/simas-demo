const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { webcrypto } = require('node:crypto');

const workerSource = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');

function createWorkerHarness() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec("CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT)");
    sqlite.exec(fs.readFileSync(path.join(__dirname, '../cloudflare/migrations/202608290002_notifications.sql'), 'utf8'));

    const execute = (sql, args, mode) => {
        const statement = sqlite.prepare(sql);
        if (mode === 'all') return { results: statement.all(...args) };
        if (mode === 'first') return statement.get(...args) || null;
        const result = statement.run(...args);
        return { meta: { changes: Number(result.changes) } };
    };

    const prepare = (sql, args = []) => ({
        sql, args,
        bind: (...values) => prepare(sql, values),
        all: async () => execute(sql, args, 'all'),
        first: async () => execute(sql, args, 'first'),
        run: async () => execute(sql, args, 'run')
    });

    const DB = {
        prepare,
        batch: async statements => {
            sqlite.exec('BEGIN');
            try {
                const results = statements.map(statement => execute(statement.sql, statement.args, 'run'));
                sqlite.exec('COMMIT');
                return results;
            } catch (error) {
                sqlite.exec('ROLLBACK');
                throw error;
            }
        }
    };

    const firestoreUsers = new Map();

    const fetchMock = jest.fn(async (input, init = {}) => {
        const url = typeof input === 'string' ? input : (input?.url || '');
        if (url.includes(':runQuery')) {
            const body = JSON.parse(init.body || '{}');
            const fieldPath = body?.structuredQuery?.where?.fieldFilter?.field?.fieldPath;
            const expectedVal = body?.structuredQuery?.where?.fieldFilter?.value?.stringValue;
            const matchedDocs = [];
            for (const [uid, user] of firestoreUsers.entries()) {
                if (fieldPath === 'assignedClass' && user.assignedClass === expectedVal) {
                    matchedDocs.push({
                        document: {
                            name: `projects/smagesa/databases/(default)/documents/users/${uid}`,
                            fields: {
                                role: { stringValue: user.role || '' },
                                additionalRoles: { arrayValue: { values: (user.additionalRoles || []).map(r => ({ stringValue: r })) } },
                                assignedClass: { stringValue: user.assignedClass || '' },
                                name: { stringValue: user.name || '' }
                            }
                        }
                    });
                } else if (fieldPath === 'role' && user.role === expectedVal) {
                    matchedDocs.push({
                        document: {
                            name: `projects/smagesa/databases/(default)/documents/users/${uid}`,
                            fields: {
                                role: { stringValue: user.role || '' },
                                additionalRoles: { arrayValue: { values: (user.additionalRoles || []).map(r => ({ stringValue: r })) } },
                                assignedClass: { stringValue: user.assignedClass || '' },
                                name: { stringValue: user.name || '' }
                            }
                        }
                    });
                }
            }
            return new Response(JSON.stringify(matchedDocs));
        }
        if (url.includes('/documents/users/')) {
            const uid = decodeURIComponent(url.split('/documents/users/')[1].split('?')[0]);
            const user = firestoreUsers.get(uid);
            if (!user) return new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 });
            return new Response(JSON.stringify({
                name: `projects/smagesa/databases/(default)/documents/users/${uid}`,
                fields: {
                    role: { stringValue: user.role || '' },
                    additionalRoles: { arrayValue: { values: (user.additionalRoles || []).map(r => ({ stringValue: r })) } },
                    assignedClass: { stringValue: user.assignedClass || '' },
                    name: { stringValue: user.name || '' },
                    phone: { stringValue: user.phone || '' },
                    telegramChatId: { stringValue: user.telegramChatId || '' }
                }
            }));
        }
        return new Response(JSON.stringify({ name: 'fcm/accepted' }));
    });

    const context = vm.createContext({
        console, URL, URLSearchParams, Request, Response, Headers,
        TextEncoder, TextDecoder, AbortSignal, crypto: webcrypto, fetch: fetchMock, atob, btoa, setTimeout, clearTimeout
    });

    vm.runInContext(workerSource.replace('export default {', 'const workerHandler = {') + `
        globalThis.testApi = {
            createNotificationJob,
            notificationTargetFilter,
            findHomeroomTeacherForClass,
            ensureNotificationTables,
            workerHandler,
            setUser: user => { verifyFirebaseToken = async () => ({ valid: true, user }); }
        };
        googleAccessTokenCache.set('https://www.googleapis.com/auth/cloud-platform', { token: 'test-token', expiresAt: Infinity });
        googleAccessTokenCache.set('https://www.googleapis.com/auth/firebase.messaging', { token: 'test-token', expiresAt: Infinity });
    `, context);

    const env = { DB };
    const api = context.testApi;

    return {
        sqlite,
        env,
        api,
        setFirestoreUser: (uid, user) => firestoreUsers.set(uid, user),
        clearFirestoreUsers: () => firestoreUsers.clear(),
        addToken: (id, uid, role, additional = '[]', className = '', displayName = 'Guru Test') =>
            sqlite.prepare('INSERT INTO fcm_tokens (id, user_id, token, role, additional_roles, assigned_class, display_name) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(id, uid, `token-${id}`.padEnd(90, 'x'), role, additional, className, displayName)
    };
}

describe('Targeting Notifikasi Guru & Resolusi Wali Kelas (SSOT)', () => {
    let harness;

    beforeEach(async () => {
        harness = createWorkerHarness();
        await harness.api.ensureNotificationTables(harness.env);
    });

    afterEach(() => {
        harness.sqlite.close();
    });

    describe('1. Ekspansi Alias Peran Guru (guru <-> guru_mapel)', () => {
        test('Target role guru_mapel otomatis menjaring akun dengan role "guru" dan "guru_mapel"', async () => {
            // Token 1: guru_mapel biasa
            harness.addToken('t1', 'uid-1', 'guru_mapel');
            // Token 2: akun lama / sinkronisasi Dapodik dengan role 'guru'
            harness.addToken('t2', 'uid-2', 'guru');
            // Token 3: akun siswa (tidak boleh terjaring)
            harness.addToken('t3', 'uid-3', 'siswa');

            const jobResult = await harness.api.createNotificationJob(harness.env, 'admin', {
                title: 'Info KBM Guru',
                body: 'Rapat guru jam 14.00',
                url: './guru-mapel.html',
                targetType: 'role',
                targetValue: 'guru_mapel'
            });

            // Harus menjaring kedua guru (uid-1 dan uid-2)
            expect(jobResult.targetCount).toBe(2);

            const deliveries = harness.sqlite.prepare('SELECT recipient_uid FROM notification_deliveries WHERE job_id = ? ORDER BY recipient_uid').all(jobResult.jobId);
            expect(deliveries.map(d => d.recipient_uid)).toEqual(['uid-1', 'uid-2']);
        });

        test('Target role guru otomatis menjaring akun dengan role "guru_mapel"', async () => {
            harness.addToken('t1', 'uid-1', 'guru_mapel');
            harness.addToken('t2', 'uid-2', 'guru');
            harness.addToken('t3', 'uid-3', 'staff');

            const jobResult = await harness.api.createNotificationJob(harness.env, 'admin', {
                title: 'Info Guru',
                body: 'Pemberitahuan khusus guru',
                url: './dashboard.html',
                targetType: 'role',
                targetValue: 'guru'
            });

            expect(jobResult.targetCount).toBe(2);
        });
    });

    describe('2. Normalisasi Format Nama Kelas pada Target Kelas & Resolusi Wali Kelas SSOT', () => {
        test('Target class "X.1" cocok dengan data token yang tercatat "X-1" dan "Kelas X-1"', async () => {
            harness.addToken('t1', 'uid-1', 'siswa', '[]', 'X-1');
            harness.addToken('t2', 'uid-2', 'siswa', '[]', 'Kelas X.1');
            harness.addToken('t3', 'uid-3', 'siswa', '[]', 'XI-1');

            const jobResult = await harness.api.createNotificationJob(harness.env, 'admin', {
                title: 'Pengumuman Kelas',
                body: 'Tugas kelas X.1',
                url: './dashboard.html',
                targetType: 'class',
                targetValue: 'X.1'
            });

            expect(jobResult.targetCount).toBe(2);
        });

        test('findHomeroomTeacherForClass berhasil menemukan wali kelas langsung dari Manajemen Users (Firestore)', async () => {
            harness.setFirestoreUser('uid-wali-1', {
                role: 'wali_kelas',
                additionalRoles: ['guru_mapel'],
                assignedClass: 'X-1',
                name: 'Pak Made Wali',
                phone: '08123456789'
            });

            // Pencarian dipanggil dengan format dot "X.1"
            const result = await harness.api.findHomeroomTeacherForClass(harness.env, 'X.1');

            expect(result).not.toBeNull();
            expect(result.uid).toBe('uid-wali-1');
            expect(result.name).toBe('Pak Made Wali');
            expect(result.phone).toBe('08123456789');
        });

        test('findHomeroomTeacherForClass mengembalikan null jika kelas tidak terdaftar di Manajemen Users dan TIDAK fallback ke fcm_tokens', async () => {
            // Ada token liar di fcm_tokens, tetapi tidak terdaftar sebagai wali kelas di Manajemen Users
            harness.addToken('t-stray', 'uid-stray', 'wali_kelas', '[]', 'XII-IPA-9', 'Guru Palsu');

            const result = await harness.api.findHomeroomTeacherForClass(harness.env, 'XII-IPA-9');
            expect(result).toBeNull();
        });
    });

    describe('3. Integrasi Pemanggilan Antrean Notifikasi Agenda di js/page-agenda.js', () => {
        test('page-agenda.js mengimpor cfClient dan memanggil queueAgendaNotification pada saveCalendarEvent dan deleteCalendarEvent', () => {
            const agendaJs = fs.readFileSync(path.join(__dirname, '../js/page-agenda.js'), 'utf8');

            expect(agendaJs).toContain('queueAgendaNotification');
            expect(agendaJs).toMatch(/cfClient\.queueAgendaNotification\(\s*\{[^}]*changeType:\s*['"]updated['"]/);
            expect(agendaJs).toMatch(/cfClient\.queueAgendaNotification\(\s*\{[^}]*changeType:\s*['"]created['"]/);
            expect(agendaJs).toMatch(/cfClient\.queueAgendaNotification\(\s*\{[^}]*changeType:\s*['"]deleted['"]/);
        });
    });

    describe('4. Keamanan & Sinkronisasi Profil FCM Token dengan Manajemen Users saat Registrasi', () => {
        test('POST /api/push/register mengikat role dan profil dari Manajemen Users (Firestore) dan menolak manipulasi peran dari body (Anti-Privilege Escalation)', async () => {
            // Data resmi di Manajemen Users (Firestore)
            harness.setFirestoreUser('guru-uid-10', {
                role: 'guru_mapel',
                additionalRoles: ['wali_kelas'],
                assignedClass: 'X-1',
                name: 'Ibu Guru Matematika'
            });

            // Klien mencoba menyuntikkan role: 'super_admin' di body request
            const req = new Request('https://worker.simas/api/push/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer valid-token' },
                body: JSON.stringify({
                    token: 'fcm-device-token-'.padEnd(100, 'z'),
                    deviceType: 'mobile',
                    userAgent: 'Mozilla/5.0 Test',
                    role: 'super_admin', // Serangan manipulasi role klien
                    additionalRoles: ['super_admin'],
                    assignedClass: 'XII-IPA-1',
                    displayName: 'Hacker Pretending Super Admin'
                })
            });

            // Sesi pengguna terverifikasi, tetapi klaim token belum memuat role sehingga worker mengecek Firestore users
            harness.api.setUser({
                uid: 'guru-uid-10',
                role: '',
                additionalRoles: [],
                assignedClass: '',
                displayName: ''
            });

            const res = await harness.api.workerHandler.fetch(req, harness.env, { waitUntil: () => {} });
            expect(res.status).toBe(200);

            const tokenRow = harness.sqlite.prepare('SELECT user_id, role, additional_roles, assigned_class, display_name FROM fcm_tokens WHERE user_id = ?').get('guru-uid-10');
            expect(tokenRow).not.toBeNull();
            // Wajib mengambil role resmi dari Firestore (guru_mapel), BUKAN super_admin dari body
            expect(tokenRow.role).toBe('guru_mapel');
            expect(JSON.parse(tokenRow.additional_roles)).toEqual(['wali_kelas']);
            expect(tokenRow.assigned_class).toBe('X-1');
            expect(tokenRow.display_name).toBe('Ibu Guru Matematika');
        });
    });

    describe('5. Keselarasan Seluruh Peran di integrasi.html dengan ALL_ROLES Manajemen Users', () => {
        test('integrasi.html memuat seluruh peran yang ada di ALL_ROLES Manajemen Users', () => {
            const integrasiHtml = fs.readFileSync(path.join(__dirname, '../integrasi.html'), 'utf8');
            const expectedRoles = [
                'super_admin', 'admin_perpus', 'kepala_sekolah', 'wakasek_kurikulum',
                'kepala_lab', 'kesiswaan', 'admin_spp', 'admin_sukaduka',
                'staff', 'wali_kelas', 'guru_mapel', 'guru_bk',
                'admin_pks', 'admin_kelas', 'siswa'
            ];

            for (const role of expectedRoles) {
                expect(integrasiHtml).toContain(`value="${role}"`);
            }
        });
    });
});
