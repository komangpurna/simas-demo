const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { generateKeyPairSync, sign, webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const workerSource = read('cloudflare/worker.js');
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'local-test', alg: 'RS256', use: 'sig' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const firestoreFields = obj => Object.fromEntries(Object.entries(obj).map(([key, value]) => [key,
    Array.isArray(value) ? { arrayValue: { values: value.map(item => ({ stringValue: item })) } } : { stringValue: value }
]));

function createWorkerHarness() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(read('cloudflare/migrations/202608290005_add_records_aggregates_and_bk_actions.sql'));
    sqlite.exec(read('cloudflare/migrations/202610190001_expand_records_achievement_fields.sql'));
    const profiles = new Map([
        ['guru_mapel_user', { name: 'Guru Mapel User', role: 'guru_mapel' }],
        ['wali_kelas_user', { name: 'Wali Kelas User', role: 'wali_kelas' }],
        ['staff_user', { name: 'Staff User', role: 'staff' }],
        ['guru_bk_user', { name: 'Guru BK User', role: 'guru_bk' }],
        ['kesiswaan_user', { name: 'Kesiswaan User', role: 'kesiswaan' }],
        ['super_admin_user', { name: 'Super Admin User', role: 'super_admin' }],
        ['admin_pks_user', { name: 'Admin PKS User', role: 'admin_pks' }],
        ['multi_mapel_bk', { name: 'Guru Mapel & BK', role: 'guru_mapel', additionalRoles: ['guru_bk'] }]
    ]);

    const execute = (sql, args, mode) => {
        const statement = sqlite.prepare(sql);
        if (mode === 'all') return { results: statement.all(...args) };
        if (mode === 'first') return statement.get(...args) || null;
        return { meta: { changes: Number(statement.run(...args).changes) } };
    };
    const prepare = (sql, args = []) => ({
        sql, args,
        bind: (...values) => prepare(sql, values),
        first: async () => execute(sql, args, 'first'),
        all: async () => execute(sql, args, 'all'),
        run: async () => execute(sql, args, 'run')
    });
    const DB = {
        prepare,
        batch: async statements => {
            sqlite.exec('BEGIN');
            try {
                const results = statements.map(stmt => execute(stmt.sql, stmt.args, 'run'));
                sqlite.exec('COMMIT');
                return results;
            } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
        }
    };
    const network = jest.fn(async url => {
        if (url.includes('/service_accounts/v1/jwk/')) return new Response(JSON.stringify({ keys: [jwk] }));
        const match = url.match(/\/documents\/users\/([^/?]+)$/);
        if (match) {
            const profile = profiles.get(decodeURIComponent(match[1]));
            return new Response(JSON.stringify(profile ? { fields: firestoreFields(profile) } : {}), { status: profile ? 200 : 404 });
        }
        throw new Error('Unexpected external request: ' + url);
    });
    const context = vm.createContext({
        URL, URLSearchParams, Request, Response, Headers,
        TextEncoder, TextDecoder, crypto: webcrypto, atob, btoa, fetch: network,
        console: { log() {}, warn() {}, error() {} }
    });
    vm.runInContext(workerSource.replace('export default {', 'globalThis.worker = {'), context);

    const token = (uid) => {
        const now = Math.floor(Date.now() / 1000);
        const data = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode({
            iss: 'https://securetoken.google.com/smagesa', aud: 'smagesa', sub: uid, user_id: uid,
            iat: now - 3600, auth_time: now - 3600, exp: now + 3600,
            email: `${uid}@example.test`, firebase: { sign_in_provider: 'password' }
        })}`;
        return `${data}.${sign('RSA-SHA256', Buffer.from(data), keys.privateKey).toString('base64url')}`;
    };

    const send = async (route, { method = 'GET', body, bearer } = {}) => {
        const response = await context.worker.fetch(new Request(`https://worker.test${route}`, {
            method,
            headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {})
        }), { DB }, {});
        return { status: response.status, body: await response.json() };
    };

    return { sqlite, send, token };
}

describe('Input Violation Role Restriction: Paritas Otorisasi Klien & Server', () => {
    describe('1. Frontend UI: Tombol Simpan & Notice di input.html', () => {
        function setupInputDom(roles = ['guru_mapel']) {
            const dom = new JSDOM(read('input.html'), {
                url: 'https://worker.test/input.html',
                runScripts: 'outside-only'
            });
            const win = dom.window;
            win.localStorage.setItem('user_role', roles[0]);
            win.localStorage.setItem('user_additional_roles', JSON.stringify(roles.slice(1)));
            win.hasRole = role => roles.includes(role);
            win.getAllUserRoles = () => roles;
            win.showToast = jest.fn();
            win.auth = { currentUser: { uid: 'test_uid' } };
            win.onAuthStateChanged = () => {};
            win.cfClient = { getRecordById: async () => null, saveRecord: jest.fn() };

            // Jalankan script inline dari input.html
            const scripts = win.document.querySelectorAll('script:not([type="module"])');
            scripts.forEach(s => {
                try { win.eval(s.textContent); } catch (e) {}
            });

            // Jalankan page-input.js dengan mock modul
            const pageInputCode = read('js/page-input.js')
                .replace(/^import .*;\r?$/gm, '')
                .replace(/^export\s+/gm, '');
            win.eval(pageInputCode);

            return { win, dom };
        }

        test('guru_mapel: tombol simpan disabled dan notice muncul saat tab Pelanggaran aktif', () => {
            const { win } = setupInputDom(['guru_mapel']);
            win.switchInputType('violation');

            const btnSave = win.document.getElementById('btn-save-activity');
            const notice = win.document.getElementById('violation-restricted-notice');

            expect(btnSave.disabled).toBe(true);
            expect(btnSave.classList.contains('cursor-not-allowed')).toBe(true);
            expect(notice.classList.contains('hidden')).toBe(false);

            // Beralih ke Permisi: tombol kembali aktif, notice tersembunyi
            win.switchInputType('permission');
            expect(btnSave.disabled).toBe(false);
            expect(btnSave.classList.contains('cursor-not-allowed')).toBe(false);
            expect(notice.classList.contains('hidden')).toBe(true);

            // Beralih ke Prestasi: tombol aktif
            win.switchInputType('achievement');
            expect(btnSave.disabled).toBe(false);
            expect(notice.classList.contains('hidden')).toBe(true);
        });

        test('wali_kelas dan staff: tombol simpan disabled pada tab Pelanggaran', () => {
            for (const testRole of ['wali_kelas', 'staff']) {
                const { win } = setupInputDom([testRole]);
                win.switchInputType('violation');

                const btnSave = win.document.getElementById('btn-save-activity');
                const notice = win.document.getElementById('violation-restricted-notice');

                expect(btnSave.disabled).toBe(true);
                expect(notice.classList.contains('hidden')).toBe(false);

                // Permisi diizinkan
                win.switchInputType('permission');
                expect(btnSave.disabled).toBe(false);
            }
        });

        test('guru_bk, kesiswaan, super_admin, admin_pks: tombol simpan tetap aktif pada tab Pelanggaran', () => {
            for (const testRole of ['guru_bk', 'kesiswaan', 'super_admin', 'admin_pks']) {
                const { win } = setupInputDom([testRole]);
                win.switchInputType('violation');

                const btnSave = win.document.getElementById('btn-save-activity');
                const notice = win.document.getElementById('violation-restricted-notice');

                expect(btnSave.disabled).toBe(false);
                expect(notice.classList.contains('hidden')).toBe(true);
            }
        });

        test('Multi-Role: guru_mapel dengan peran tambahan guru_bk dapat menginput pelanggaran', () => {
            const { win } = setupInputDom(['guru_mapel', 'guru_bk']);
            win.switchInputType('violation');

            const btnSave = win.document.getElementById('btn-save-activity');
            expect(btnSave.disabled).toBe(false);
        });

        test('confirmSaveActivity dan executeSaveActivity menolak aksi input pelanggaran untuk guru_mapel', async () => {
            const { win } = setupInputDom(['guru_mapel']);
            win.switchInputType('violation');

            win.confirmSaveActivity();
            expect(win.showToast).toHaveBeenCalledWith('Akses Ditolak', expect.stringContaining('tidak memiliki akses'), 'error');
            expect(win.document.getElementById('modal-confirm-activity').classList.contains('hidden')).toBe(true);

            win.showToast.mockClear();
            await win.executeSaveActivity();
            expect(win.showToast).toHaveBeenCalledWith('Akses Ditolak', expect.stringContaining('tidak memiliki akses'), 'error');
        });
    });

    describe('2. Backend Worker: Otorisasi Endpoint /api/records', () => {
        let harness;
        beforeEach(() => { harness = createWorkerHarness(); });
        afterEach(() => harness.sqlite.close());

        test('guru_mapel, wali_kelas, dan staff ditolak (HTTP 403) saat POST pelanggaran', async () => {
            for (const uid of ['guru_mapel_user', 'wali_kelas_user', 'staff_user']) {
                const payload = {
                    id: `vio_${uid}`,
                    student_nis: '001',
                    category: 'Pelanggaran',
                    points: 15,
                    desc: 'Pelanggaran atribut'
                };
                const res = await harness.send('/api/records', {
                    method: 'POST',
                    body: payload,
                    bearer: harness.token(uid)
                });
                expect(res.status).toBe(403);
                expect(res.body.error).toContain('tidak memiliki wewenang');
            }
        });

        test('guru_mapel berhasil menyimpan (HTTP 201) catatan kategori Prestasi dan Permisi', async () => {
            const prestPayload = {
                id: 'prest_01',
                student_nis: '001',
                category: 'Prestasi',
                points: 20,
                desc: 'Juara Lomba Coding'
            };
            const resPrest = await harness.send('/api/records', {
                method: 'POST',
                body: prestPayload,
                bearer: harness.token('guru_mapel_user')
            });
            expect(resPrest.status).toBe(201);
            expect(resPrest.body.success).toBe(true);

            const permPayload = {
                id: 'perm_01',
                student_nis: '001',
                category: 'Permisi',
                points: 0,
                desc: 'Izin tugas OSIS'
            };
            const resPerm = await harness.send('/api/records', {
                method: 'POST',
                body: permPayload,
                bearer: harness.token('guru_mapel_user')
            });
            expect(resPerm.status).toBe(201);
            expect(resPerm.body.success).toBe(true);
        });

        test('guru_bk, kesiswaan, admin_pks, dan super_admin berhasil (HTTP 201) menyimpan catatan Pelanggaran', async () => {
            for (const [idx, uid] of ['guru_bk_user', 'kesiswaan_user', 'admin_pks_user', 'super_admin_user'].entries()) {
                const payload = {
                    id: `vio_auth_${idx}`,
                    student_nis: '001',
                    category: 'Pelanggaran',
                    points: 10,
                    desc: 'Terlambat masuk sekolah'
                };
                const res = await harness.send('/api/records', {
                    method: 'POST',
                    body: payload,
                    bearer: harness.token(uid)
                });
                expect(res.status).toBe(201);
                expect(res.body.success).toBe(true);
            }
        });

        test('Multi-Role: guru_mapel dengan tambahan role guru_bk diizinkan (HTTP 201) POST pelanggaran', async () => {
            const payload = {
                id: 'vio_multi_01',
                student_nis: '001',
                category: 'Pelanggaran',
                points: 10,
                desc: 'Pelanggaran seragam'
            };
            const res = await harness.send('/api/records', {
                method: 'POST',
                body: payload,
                bearer: harness.token('multi_mapel_bk')
            });
            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
        });

        test('guru_mapel ditolak (HTTP 403) saat mencoba mengubah record kategori Pelanggaran via PUT', async () => {
            // Setup record milik guru_mapel_user (kategori awal Prestasi)
            await harness.send('/api/records', {
                method: 'POST',
                body: { id: 'prest_target', student_nis: '001', category: 'Prestasi', points: 10 },
                bearer: harness.token('guru_mapel_user')
            });

            // Guru mapel mencoba ubah kategori record miliknya menjadi Pelanggaran
            const resPut = await harness.send('/api/records/prest_target', {
                method: 'PUT',
                body: { category: 'Pelanggaran' },
                bearer: harness.token('guru_mapel_user')
            });
            expect(resPut.status).toBe(403);
            expect(resPut.body.error).toContain('tidak memiliki wewenang');
        });
    });
});
