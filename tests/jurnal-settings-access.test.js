const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { buildFlatWorkerSource } = require('./helpers/worker-source.cjs');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const manager = role => ({ valid: true, user: { uid: 'uji', role, additionalRoles: [], isAnonymous: false, claims: {} } });

function harness() {
    const db = new DatabaseSync(':memory:');
    db.exec(read('cloudflare/schema.sql'));
    for (const file of fs.readdirSync(path.join(root, 'cloudflare/migrations')).sort()) {
        try { db.exec(read('cloudflare/migrations/' + file)); } catch (_) {}
    }
    const setting = (key, value) => db.prepare('INSERT OR REPLACE INTO system_settings(key,value) VALUES (?,?)').run(key, JSON.stringify(value));
    setting('metadata_classes', ['X-1']); setting('mode_daring', false); setting('motivasi_list', []); setting('jam_tutup', '23:59');
    const prepare = (sql, args = []) => ({
        bind: (...values) => prepare(sql, values),
        async run() { return { meta: db.prepare(sql).run(...args) }; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async first() { return db.prepare(sql).get(...args) || null; }
    });
    const context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, crypto, atob, btoa,
        TextEncoder, TextDecoder, FormData, Blob, setTimeout, clearTimeout,
        console: { log() {}, warn() {}, error() {}, info() {} },
        fetch: async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }) });
    vm.runInContext(buildFlatWorkerSource().replace('export default {', 'globalThis.worker = {'), context);
    const state = { db, auth: manager('super_admin'), setting };
    context.testAuth = () => state.auth;
    vm.runInContext('verifyFirebaseToken = async () => testAuth();', context);
    const env = { DB: { prepare, batch: async items => Promise.all(items.map(item => item.run())) }, MIGRATION_SECRET: 'trusted-test', JURNAL_API_KEY: 'public-test' };
    state.call = async (method, route, body, headers = {}) => {
        const options = { method, headers: { 'Content-Type': 'application/json', ...headers } };
        if (body !== undefined) options.body = JSON.stringify(body);
        const res = await context.worker.fetch(new Request('https://worker.test' + route, options), env, { waitUntil() {} });
        return { status: res.status, headers: res.headers, json: await res.json() };
    };
    return state;
}

let h;
beforeEach(() => { h = harness(); });
afterEach(() => h.db.close());

test.each(['super_admin', 'wakasek_kurikulum', 'kurikulum', 'kepala_lab'])('pengelola %s dapat menyalakan dan mematikan daring', async role => {
    h.auth = manager(role);
    for (const mode of [true, false]) {
        for (const [method, route, body] of [
            ['PUT', '/api/jurnal/settings', { mode_daring: mode }],
            ['POST', '/api/jurnal/master/sync', { settings: { mode_daring: mode } }],
            ['PUT', '/api/settings/mode_daring', { value: mode }]
        ]) {
            expect((await h.call(method, route, body, { 'X-Sync-Key': 'public-test' })).status).toBe(200);
            expect(JSON.parse(h.db.prepare("SELECT value FROM system_settings WHERE key='mode_daring'").get().value)).toBe(mode);
        }
    }
});

test('peran tambahan pengelola tetap diakui', async () => {
    h.auth = manager('guru_mapel'); h.auth.user.additionalRoles = ['kurikulum'];
    expect((await h.call('PUT', '/api/jurnal/settings', { mode_daring: true })).status).toBe(200);
});

test.each(['guru_mapel', 'guru_bk', 'guru', 'wali_kelas', 'admin_kelas', 'staff'])('peran %s ditolak melalui semua jalur penulisan mode', async role => {
    h.auth = manager(role);
    for (const [method, route, body] of [
        ['PUT', '/api/jurnal/settings', { mode_daring: true }],
        ['POST', '/api/jurnal/master/sync', { settings: { mode_daring: true } }],
        ['PUT', '/api/settings/mode_daring', { value: true }],
        ['POST', '/api/settings', { key: 'mode_daring', value: true }]
    ]) {
        expect((await h.call(method, route, body, { 'X-Sync-Key': 'public-test' })).status).toBe(403);
    }
    expect(h.db.prepare("SELECT value FROM system_settings WHERE key='mode_daring'").get().value).toBe('false');
});

test('anonim dan kunci jurnal publik tidak mendapat hak pengelola', async () => {
    h.auth = { valid: false };
    expect((await h.call('PUT', '/api/jurnal/settings', { mode_daring: true }, { 'X-Api-Key': 'public-test' })).status).toBe(401);
    expect((await h.call('POST', '/api/jurnal/master/sync', { settings: { mode_daring: true } }, { 'X-Api-Key': 'public-test' })).status).toBe(401);
    h.auth = manager('super_admin'); h.auth.user.isAnonymous = true;
    expect((await h.call('PUT', '/api/jurnal/settings', { mode_daring: true })).status).toBe(401);
});

test('integrasi server dengan MIGRATION_SECRET tetap bisa menyimpan pengaturan', async () => {
    h.auth = { valid: false };
    expect((await h.call('PUT', '/api/jurnal/settings', { mode_daring: true }, { 'X-Sync-Key': 'trusted-test' })).status).toBe(200);
    expect((await h.call('POST', '/api/jurnal/master/sync', { settings: { mode_daring: false } }, { 'X-Sync-Key': 'trusted-test' })).status).toBe(200);
});

test('hak guru mengisi jurnal dan sinkron lokasi tetap berfungsi', async () => {
    h.auth = manager('guru_mapel');
    const saved = await h.call('POST', '/api/jurnal', { id: 'uji', tanggal: '2026-10-14', kelas: 'X-1', guru: 'Guru Uji', mapel: 'Matematika' });
    expect(saved.status).toBe(201);
    expect((await h.call('POST', '/api/jurnal/master/sync', { lokasis: [{ id: 'uji', nama_lokasi: 'Lab', urutan: 1 }] })).status).toBe(200);
});

test('refresh pengaturan dan master melewati cache dari perubahan pada instance lain', async () => {
    await h.call('GET', '/api/jurnal/settings');
    await h.call('GET', '/api/jurnal/master');
    h.setting('mode_daring', true);
    const settings = await h.call('GET', '/api/jurnal/settings?refresh=1');
    expect(settings.json.data.mode_daring).toBe(true);
    expect(settings.headers.get('Cache-Control')).toBe('no-store');
    const master = await h.call('GET', '/api/jurnal/master?refresh=1');
    expect(master.json.data.mode_daring).toBe(true);
    h.setting('mode_daring', false);
    expect((await h.call('GET', '/api/jurnal/settings?refresh=1')).json.data.mode_daring).toBe(false);
    expect((await h.call('GET', '/api/jurnal/master?refresh=1')).json.data.mode_daring).toBe(false);
});

test('pembacaan pengaturan tetap tersedia untuk halaman jurnal publik', async () => {
    h.auth = { valid: false };
    expect((await h.call('GET', '/api/jurnal/settings?refresh=1')).status).toBe(200);
});
