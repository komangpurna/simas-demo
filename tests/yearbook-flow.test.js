/**
 * tests/yearbook-flow.test.js
 *
 * Uji perilaku alur Buku Kenangan (Yearbook) pada worker.js sungguhan di atas SQLite in-memory:
 * publikasi profil oleh admin, ringkasan angkatan, pesan satu-per-kawan (upsert), daftar pesan terkirim,
 * sanitasi media sosial, dan penolakan tautan arsip non-http(s).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const ANON = { valid: false, error: 'Missing or invalid Authorization header' };
const staff = role => ({ valid: true, user: { uid: 'u-' + role, role, additionalRoles: [], isAnonymous: false, claims: {} } });
const student = (nis, studentClass = 'XII.1') => ({ valid: true, user: { uid: 'anon-' + nis, role: '', additionalRoles: [], isAnonymous: true,
    claims: { studentVerified: true, studentNis: nis, studentClass } } });

const LEGACY_PROFILE_TABLE = `
    DROP TABLE IF EXISTS yearbook_profiles;
    CREATE TABLE yearbook_profiles (
        nis TEXT PRIMARY KEY,
        academic_year TEXT NOT NULL,
        casual_photo_url TEXT,
        quote TEXT,
        ambition TEXT,
        dream_campus TEXT,
        social_media TEXT,
        status TEXT DEFAULT 'draft',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );
`;

function harness({ legacySchema = false } = {}) {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(read('cloudflare/schema.sql'));
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'cloudflare/migrations')).sort()) {
        try { sqlite.exec(read('cloudflare/migrations/' + f)); } catch (_) {}
    }
    if (legacySchema) sqlite.exec(LEGACY_PROFILE_TABLE);

    const insertStudent = (nis, name, cls) => sqlite.prepare("INSERT INTO students(nis,name,class,status) VALUES (?,?,?,?)").run(nis, name, cls, 'active');
    insertStudent('1001', 'Siswa A', 'XII.1');
    insertStudent('1002', 'Siswa B', 'XII.1');
    insertStudent('1003', 'Siswa C', 'XII.2');
    insertStudent('2001', 'Adik Kelas', 'XI.1');

    const prepare = (sql, args = []) => ({
        bind: (...v) => prepare(sql, v),
        async run() { return { meta: sqlite.prepare(sql).run(...args) }; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async first() { return sqlite.prepare(sql).get(...args) || null; }
    });
    const DB = { prepare, async batch(s) { return Promise.all(s.map(x => x.run())); }, async exec(sql) { sqlite.exec(sql); } };
    const objects = new Map();
    const bucket = {
        async get(key) {
            const o = objects.get(key);
            if (!o) return null;
            return { body: o.bytes, httpEtag: '"etag"', httpMetadata: o.meta, writeHttpMetadata(h) { if (o.meta?.contentType) h.set('Content-Type', o.meta.contentType); } };
        },
        async put(key, bytes, opts = {}) { objects.set(key, { bytes, meta: opts.httpMetadata || {} }); },
        async delete(key) { objects.delete(key); },
        async list({ prefix = '' } = {}) { return { objects: [...objects.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })), truncated: false }; }
    };
    const context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, crypto, atob, btoa, TextEncoder, TextDecoder, FormData, Blob,
        setTimeout, clearTimeout, console: { log() {}, warn() {}, error() {}, info() {} },
        fetch: async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }) });
    vm.runInContext(read('cloudflare/worker.js').replace('export default {', 'globalThis.worker = {'), context);
    const state = { sqlite, auth: ANON, objects };
    context.getAuth = () => state.auth;
    vm.runInContext('verifyFirebaseToken = async () => getAuth();', context);
    const env = { DB, STUDENT_PHOTOS_BUCKET: bucket, GTK_PHOTOS_BUCKET: bucket };
    state.call = async (method, route, body) => {
        const init = { method, headers: { 'Content-Type': 'application/json' } };
        if (body !== undefined) init.body = JSON.stringify(body);
        const res = await context.worker.fetch(new Request('https://worker.test' + route, init), env, { waitUntil() {} });
        let json = {};
        try { json = JSON.parse(await res.text()); } catch (_) {}
        return { status: res.status, json, headers: res.headers };
    };
    state.raw = async (route) => context.worker.fetch(new Request('https://worker.test' + route), env, { waitUntil() {} });
    return state;
}

describe('Alur Buku Kenangan (Yearbook) — perilaku worker', () => {
    let h;
    afterEach(() => {
        if (h) h.sqlite.close();
        h = null;
    });

    test('admin menyembunyikan profil: galeri publik menyaring, staf tetap melihat dengan is_published = 0', async () => {
        h = harness();
        h.auth = staff('kesiswaan');
        const toggle = await h.call('PUT', '/api/yearbook/admin/toggle-publish/1001');
        expect(toggle.status).toBe(200);
        expect(toggle.json.is_published).toBe(0);

        h.auth = ANON;
        const pub = await h.call('GET', '/api/yearbook/class/' + encodeURIComponent('XII.1'));
        expect(pub.status).toBe(200);
        expect(pub.json.data.map(s => s.nis)).toEqual(['1002']);

        h.auth = staff('kesiswaan');
        const adminView = await h.call('GET', '/api/yearbook/class/' + encodeURIComponent('XII.1'));
        const hidden = adminView.json.data.find(s => s.nis === '1001');
        expect(hidden.is_published).toBe(0);
        expect(adminView.json.data.find(s => s.nis === '1002').is_published).toBe(1);

        const again = await h.call('PUT', '/api/yearbook/admin/toggle-publish/1001');
        expect(again.json.is_published).toBe(1);
    });

    test('skema lama tanpa kolom is_published dimigrasikan otomatis (idempotent)', async () => {
        h = harness({ legacySchema: true });
        h.auth = staff('super_admin');
        const toggle = await h.call('PUT', '/api/yearbook/admin/toggle-publish/1002');
        expect(toggle.status).toBe(200);
        const cols = h.sqlite.prepare('PRAGMA table_info(yearbook_profiles)').all().map(c => c.name);
        expect(cols).toContain('is_published');
    });

    test('GET /api/yearbook/summary merangkum siswa, rombel, profil terisi, dan pesan tampil', async () => {
        h = harness();
        h.auth = student('1001');
        await h.call('POST', '/api/yearbook/my-profile', { quote: 'Sampai jumpa di puncak', social_media: { instagram: '@siswa.a' } });
        h.auth = ANON;
        const res = await h.call('GET', '/api/yearbook/summary');
        expect(res.status).toBe(200);
        expect(res.json.total_students).toBe(3);
        expect(res.json.total_classes).toBe(2);
        expect(res.json.profiles_filled).toBe(1);
        expect(res.json.classes.find(c => c.class === 'XII.1')).toMatchObject({ total: 2, filled: 1 });
        expect(res.headers.get('Cache-Control')).toContain('max-age=300');
    });

    test('kirim ulang pesan ke kawan yang sama memperbarui pesan lama dan mereset persetujuan', async () => {
        h = harness();
        h.auth = student('1002');
        const first = await h.call('POST', '/api/yearbook/messages', { target_nis: '1001', message: 'Pesan pertama' });
        expect(first.json.updated).toBe(false);

        h.auth = student('1001');
        await h.call('PUT', `/api/yearbook/messages/${first.json.message_id}/toggle-approval`, { is_approved: 1 });

        h.auth = student('1002');
        const second = await h.call('POST', '/api/yearbook/messages', { target_nis: '1001', message: 'Pesan <b>revisi</b>' });
        expect(second.status).toBe(200);
        expect(second.json.updated).toBe(true);
        expect(second.json.message_id).toBe(first.json.message_id);

        const rows = h.sqlite.prepare('SELECT * FROM yearbook_messages WHERE target_nis = ?').all('1001');
        expect(rows).toHaveLength(1);
        expect(rows[0].is_approved).toBe(0);
        expect(rows[0].message).toBe('Pesan &lt;b&gt;revisi&lt;/b&gt;');

        const mine = await h.call('GET', '/api/yearbook/my-profile');
        expect(mine.json.sent_messages).toHaveLength(1);
        expect(mine.json.sent_messages[0]).toMatchObject({ target_nis: '1001', target_name: 'Siswa A', is_approved: 0 });
    });

    test('pesan kenangan hanya untuk penerima Kelas XII', async () => {
        h = harness();
        h.auth = student('1001');
        const res = await h.call('POST', '/api/yearbook/messages', { target_nis: '2001', message: 'Halo adik kelas' });
        expect(res.status).toBe(400);
    });

    test('media sosial disanitasi: hanya instagram/tiktok/spotify dengan karakter yang aman', async () => {
        h = harness();
        h.auth = student('1001');
        await h.call('POST', '/api/yearbook/my-profile', {
            quote: 'Q',
            social_media: { instagram: '@@user name"><script>', spotify: 'Lagu Kita', evil: 'javascript:alert(1)' }
        });
        const row = h.sqlite.prepare('SELECT social_media FROM yearbook_profiles WHERE nis = ?').get('1001');
        expect(JSON.parse(row.social_media)).toEqual({ instagram: 'usernamescript', tiktok: '', spotify: 'Lagu Kita' });
    });

    test('arsip menolak tautan PDF / sampul selain http(s)', async () => {
        h = harness();
        h.auth = staff('kesiswaan');
        const bad = await h.call('POST', '/api/yearbook/archives', { academic_year: '2025/2026', title: 'X', pdf_url: 'javascript:alert(1)' });
        expect(bad.status).toBe(400);
        const badCover = await h.call('POST', '/api/yearbook/archives', { academic_year: '2025/2026', title: 'X', pdf_url: 'https://r2.example/a.pdf', cover_url: 'data:text/html,x' });
        expect(badCover.status).toBe(400);
        const ok = await h.call('POST', '/api/yearbook/archives', { academic_year: '2025/2026', title: 'X', pdf_url: 'https://r2.example/a.pdf', total_students: -5 });
        expect(ok.status).toBe(200);
        expect(h.sqlite.prepare('SELECT total_students FROM yearbook_archives').get().total_students).toBe(0);
    });

    const b64 = bytes => Buffer.from(bytes).toString('base64');
    const WEBP = b64([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38]);
    const JPEG = b64([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46]);

    test('unggah foto santai: tersimpan di R2 yearbook/<TA>/<nis>_<acak>.webp, tercatat di D1, dan dapat di-stream', async () => {
        h = harness();
        h.auth = student('1001');
        const up = await h.call('POST', '/api/yearbook/photo/upload', { nis: '1001', photoBase64: 'data:image/webp;base64,' + WEBP });
        expect(up.status).toBe(200);
        expect(up.json.casual_photo_url).toMatch(/^\/api\/photos\/yearbook\/\d{4}-\d{4}\/1001_[a-z0-9]+\.webp\?v=\d+$/i);

        const keys = [...h.objects.keys()];
        expect(keys).toHaveLength(1);
        expect(keys[0]).toMatch(/^yearbook\/\d{4}-\d{4}\/1001_[a-z0-9]+\.webp$/i);
        const row = h.sqlite.prepare('SELECT casual_photo_url FROM yearbook_profiles WHERE nis = ?').get('1001');
        expect(row.casual_photo_url).toBe(up.json.casual_photo_url);

        const res = await h.raw(up.json.casual_photo_url);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('image/webp');
    });

    test('fallback JPEG (Safari tanpa encoder WebP) disimpan & disajikan sebagai image/jpeg; berkas non-gambar ditolak', async () => {
        h = harness();
        h.auth = student('1002');
        const up = await h.call('POST', '/api/yearbook/photo/upload', { nis: '1002', photoBase64: 'data:image/jpeg;base64,' + JPEG });
        expect(up.status).toBe(200);
        const res = await h.raw(up.json.casual_photo_url);
        expect(res.headers.get('Content-Type')).toBe('image/jpeg');

        const bad = await h.call('POST', '/api/yearbook/photo/upload', { nis: '1002', photoBase64: b64([...Buffer.from('<script>alert(1)</script>')]) });
        expect(bad.status).toBe(400);
    });

    test('unggah foto ditolak untuk siswa non-XII dan untuk NIS milik orang lain', async () => {
        h = harness();
        h.auth = student('2001', 'XI.1');
        expect((await h.call('POST', '/api/yearbook/photo/upload', { nis: '2001', photoBase64: WEBP })).status).toBe(403);
        h.auth = student('1001');
        expect((await h.call('POST', '/api/yearbook/photo/upload', { nis: '1002', photoBase64: WEBP })).status).toBe(403);
        expect(h.objects.size).toBe(0);
    });

    test('portal siswa: kelayakan Buku Kenangan memakai satu fungsi SSOT khusus Kelas XII', () => {
        const portalJs = read('js/page-portal-siswa.js');
        const portalHtml = read('portal-siswa.html');
        const src = portalJs.match(/function isYearbookEligibleClass\(className\) \{[\s\S]*?\n\}/)[0];
        const isEligible = new Function(src + '; return isYearbookEligibleClass;')();
        ['XII', 'XII-1', 'XII.2', 'XII MIPA 3', 'xii ips 1', '12 IPA 1', '12-3'].forEach(c => expect(isEligible(c)).toBe(true));
        ['X', 'X-1', 'XI', 'XI.1', 'XI MIPA', '10', '11 IPS', '120', '', null].forEach(c => expect(isEligible(c)).toBe(false));
        expect(portalJs).not.toMatch(/isKelasXII = studentClass\.startsWith/);
        expect(portalJs).toContain('window.isYearbookEligibleStudent = isYearbookEligibleStudent');
        expect(portalHtml).toContain('function isYearbookEligible()');
        expect(portalHtml).not.toContain("sClass.startsWith('XII')");
    });
});
