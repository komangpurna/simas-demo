/**
 * tests/student-photo-unguessable-keys.test.js
 *
 * Endpoint streaming foto (/api/photos/student/*, /api/photos/yearbook/*) bersifat publik agar <img>,
 * ekspor kanvas & cetak tetap berjalan. Karena itu nama berkas R2 wajib acak (tidak dapat ditebak dari NIS).
 * Test ini menjalankan worker.js sungguhan di atas SQLite + R2 palsu.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const WEBP_B64 = Buffer.from('synthetic-webp-bytes').toString('base64');
const RANDOM_ACTIVE = /^active\/12345_[0-9a-f]{32}\.webp$/;

function fakeBucket() {
    const store = new Map();
    return {
        store,
        async put(key, value) { store.set(key, value); },
        async get(key) {
            if (!store.has(key)) return null;
            return { body: store.get(key), httpEtag: '"etag"', writeHttpMetadata() {} };
        },
        async delete(keys) { for (const k of [].concat(keys)) store.delete(k); },
        async list({ prefix = '' } = {}) {
            return { objects: [...store.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })), truncated: false };
        }
    };
}

function harness() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(read('cloudflare/schema.sql'));
    const prepare = (sql, args = []) => ({
        bind: (...values) => prepare(sql, values),
        async run() { return { meta: sqlite.prepare(sql).run(...args) }; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async first() { return sqlite.prepare(sql).get(...args) || null; }
    });
    const DB = { prepare, async batch(stmts) { return Promise.all(stmts.map(s => s.run())); } };
    const bucket = fakeBucket();
    const context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, crypto, atob, btoa, TextEncoder, TextDecoder,
        console: { log() {}, warn() {}, error() {} },
        fetch: async () => new Response('[]', { status: 200 }) });
    vm.runInContext(read('cloudflare/worker.js').replace('export default {', 'globalThis.worker = {'), context);
    const state = { sqlite, bucket, auth: { valid: true, user: { uid: 'admin', role: 'super_admin' } } };
    context.getAuth = () => state.auth;
    vm.runInContext('verifyFirebaseToken = async () => getAuth(); getVerifiedStudentSession = async () => null;', context);
    state.call = async (route, body = null, method = body ? 'POST' : 'GET') => {
        const pending = [];
        const ctx = { waitUntil: p => pending.push(p) };
        const request = new Request('https://worker.test' + route, body
            ? { method, headers: { Authorization: 'Bearer synthetic' }, body: JSON.stringify(body) }
            : { method, headers: { Authorization: 'Bearer synthetic' } });
        const res = await context.worker.fetch(request, { DB, STUDENT_PHOTOS_BUCKET: bucket }, ctx);
        await Promise.all(pending);
        const text = await res.text();
        let json = {};
        try { json = JSON.parse(text); } catch (_) {}
        return { ...json, photoStatus: json.status, status: res.status };
    };
    state.upload = (autoVerify = true) => state.call('/api/students/photo/upload', { nis: '12345', image: WEBP_B64, autoVerify });
    state.photoRow = () => sqlite.prepare('SELECT * FROM student_photos WHERE nis = ?').get('12345');
    sqlite.prepare('INSERT INTO students(nis,name,class,status) VALUES (?,?,?,?)').run('12345', 'Synthetic', 'XII.1', 'active');
    return state;
}

describe('Foto siswa: nama berkas R2 tidak dapat ditebak dari NIS', () => {
    let h;
    beforeEach(() => { h = harness(); });
    afterEach(() => h.sqlite.close());

    test('upload staf (autoVerify) memakai nama acak dan tetap dapat di-stream lewat URL dari DB', async () => {
        const res = await h.upload(true);
        expect(res.status).toBe(200);
        const key = [...h.bucket.store.keys()].find(k => k.startsWith('active/'));
        expect(key).toMatch(RANDOM_ACTIVE);
        expect(h.photoRow().active_photo_url).toContain(`/api/photos/student/${key}?v=`);

        const streamed = await h.call(h.photoRow().active_photo_url.split('?')[0]);
        expect(streamed.status).toBe(200);
        const guessed = await h.call('/api/photos/student/active/12345.webp');
        expect(guessed.status).toBe(404);
    });

    test('penggantian foto mempertahankan satu versi sebelumnya (cache klien) dan memangkas yang lebih lama', async () => {
        await h.upload(true); const first = h.photoRow().active_photo_url;
        await h.upload(true); const second = h.photoRow().active_photo_url;
        await h.upload(true); const third = h.photoRow().active_photo_url;
        const keyOf = url => url.split('/api/photos/student/')[1].split('?')[0];
        const activeKeys = [...h.bucket.store.keys()].filter(k => k.startsWith('active/'));
        expect(activeKeys.sort()).toEqual([keyOf(second), keyOf(third)].sort());
        expect(h.bucket.store.has(keyOf(first))).toBe(false);
    });

    test('pengajuan siswa (pending) lalu disetujui: berkas aktif acak, pending dihapus', async () => {
        h.auth = { valid: true, user: { uid: 'stu', role: 'siswa', claims: { studentNis: '12345' } } };
        const up = await h.upload(false);
        expect(up.status).toBe(200);
        expect(up.pending_photo_url).toMatch(/^\/api\/photos\/student\/pending\/12345_\d+_[0-9a-f]{32}\.webp$/);

        h.auth = { valid: true, user: { uid: 'admin', role: 'super_admin' } };
        const ok = await h.call('/api/students/photo/verify', { nis: '12345', action: 'approve' });
        expect(ok.status).toBe(200);
        const keys = [...h.bucket.store.keys()];
        expect(keys.filter(k => k.startsWith('pending/'))).toEqual([]);
        expect(keys.filter(k => k.startsWith('active/'))).toEqual([expect.stringMatching(RANDOM_ACTIVE)]);
    });

    test('migrasi berkas warisan <nis>.webp: tahap 1 tidak memutus URL lama, tahap 2 (purge) menghapusnya', async () => {
        h.bucket.store.set('active/12345.webp', 'legacy');
        h.bucket.store.set('pending/99999_1700000000000.webp', 'orphan');
        h.sqlite.prepare("INSERT INTO student_photos(nis, active_photo_url, status) VALUES (?, ?, 'verified')")
            .run('12345', '/api/photos/student/active/12345.webp?v=1');

        const mig = await h.call('/api/students/photo/migrate-legacy-keys', {});
        expect(mig).toMatchObject({ status: 200, migrated: 1, remaining: 0 });
        expect(h.photoRow().active_photo_url).toMatch(/\/active\/12345_[0-9a-f]{32}\.webp\?v=/);
        expect(h.bucket.store.has('active/12345.webp')).toBe(true); // klien dengan cache lama tetap tampil

        const meta = JSON.parse(h.sqlite.prepare("SELECT value FROM system_settings WHERE key = 'metadata'").get().value);
        expect(meta.lastUpdateStudents).toBeGreaterThan(0);

        const purge = await h.call('/api/students/photo/migrate-legacy-keys', { purge: true });
        expect(purge.status).toBe(200);
        expect(h.bucket.store.has('active/12345.webp')).toBe(false);
        expect(h.bucket.store.has('pending/99999_1700000000000.webp')).toBe(false);
        expect([...h.bucket.store.keys()]).toEqual([expect.stringMatching(RANDOM_ACTIVE)]);
    });

    test('migrasi hanya untuk Super Admin', async () => {
        h.auth = { valid: true, user: { uid: 'guru', role: 'guru_mapel' } };
        const res = await h.call('/api/students/photo/migrate-legacy-keys', {});
        expect(res.status).toBe(403);
    });

    test('hapus siswa ikut menghapus seluruh versi foto di R2 (termasuk versi sebelumnya & warisan)', async () => {
        await h.upload(true); await h.upload(true);
        h.bucket.store.set('active/12345.webp', 'legacy');
        h.bucket.store.set('active/123456_' + 'a'.repeat(32) + '.webp', 'nis lain berawalan sama');
        expect([...h.bucket.store.keys()].filter(k => k.startsWith('active/12345_')).length).toBe(2);

        const res = await h.call('/api/students/12345', null, 'DELETE');
        expect(res.status).toBe(200);
        expect([...h.bucket.store.keys()]).toEqual(['active/123456_' + 'a'.repeat(32) + '.webp']);
    });
});
