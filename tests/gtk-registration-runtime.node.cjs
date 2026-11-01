const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync('cloudflare/worker.js', 'utf8');
const start = source.indexOf('            // POST /api/gtk/submissions (Publik');
const end = source.indexOf('            // 0a. POST /api/gtk/photo/upload', start);
const routes = source.slice(start, end);

function harness() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`CREATE TABLE gtk (id TEXT PRIMARY KEY, nik TEXT, nip TEXT, nuptk TEXT, name TEXT, gender TEXT, birth_place TEXT, birth_date TEXT, phone TEXT, email TEXT, address TEXT, jenis_ptk TEXT, status_kepegawaian TEXT, pendidikan_terakhir TEXT, mapel TEXT, role TEXT, telegram_chat_id TEXT, notes TEXT, status TEXT, updated_at TEXT);
      CREATE TABLE gtk_submissions (id TEXT PRIMARY KEY, name TEXT, gender TEXT, nik TEXT, nuptk TEXT, nip TEXT, agama TEXT, birth_place TEXT, birth_date TEXT, status_kepegawaian TEXT, jenis_ptk TEXT, tugas_tambahan TEXT, alamat TEXT, rt TEXT, rw TEXT, dusun TEXT, kelurahan TEXT, kecamatan TEXT, kode_pos TEXT, phone TEXT, email TEXT, telegram_chat_id TEXT, status TEXT, ip_address TEXT, created_at TEXT, approved_by TEXT, approved_at TEXT, rejection_reason TEXT);`);
    const prepare = (sql, params = []) => ({
        bind: (...values) => prepare(sql, values),
        first: async () => sqlite.prepare(sql).get(...params),
        all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
        run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } })
    });
    const DB = { prepare, batch: async stmts => {
        sqlite.exec('BEGIN');
        try { const result = []; for (const stmt of stmts) result.push(await stmt.run()); sqlite.exec('COMMIT'); return result; }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    } };
    const notifications = [];
    const context = vm.createContext({ crypto: globalThis.crypto, console,
        ensureGtkSubmissionsSchema: async () => {}, ensureGtkPhotoColumn: async () => {},
        consumeD1RateLimit: async () => true, sha256Id: async x => x,
        verifyFirebaseToken: async () => ({ valid: true, user: { role: 'super_admin', uid: 'admin' } }),
        canApproveGtkSubmission: user => user.role === 'super_admin',
        notifyGtkRegistration: async (_, id) => notifications.push(id),
        invalidateMasterBundleCache: () => {}, updateServerMetadata: async () => {},
        jsonResponse: (body, status) => ({ body, status }), errorResponse: (error, status) => ({ body: { error }, status }) });
    const handler = vm.runInContext(`(async (request, env, ctx, path, method, url) => { ${routes} })`, context);
    const tasks = [];
    const call = async (method, path, data = {}) => {
        const response = await handler({ headers: new Headers(), json: async () => data }, { DB }, { waitUntil: p => tasks.push(p) }, path, method, new URL('https://test' + path));
        await Promise.all(tasks.splice(0));
        return response;
    };
    return { sqlite, call, notifications };
}
const sample = { name: 'Made Suarta', gender: 'L', nip: '-', phone: '08123456789', email: 'made@example.com' };

test('pengajuan tersimpan sekali dan duplikat tanpa NIK ditolak', async () => {
    const h = harness();
    const result = await h.call('POST', '/api/gtk/submissions', sample);
    assert.equal(result.status, 201);
    assert.deepEqual(h.notifications, [result.body.id]);
    assert.equal((await h.call('POST', '/api/gtk/submissions', { ...sample, email: 'MADE@example.com' })).status, 409);
    assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM gtk_submissions').get().n, 1);
    assert.equal((await h.call('POST', '/api/gtk/submissions', { ...sample, email: 'other@example.com', nip: '123' })).status, 400);
    assert.equal((await h.call('POST', '/api/gtk/submissions', { ...sample, email: 'other@example.com', phone: 'abcdefgh' })).status, 400);
});

test('persetujuan atomik tidak menimpa master dan penolakan tidak dapat memproses ulang', async () => {
    const h = harness();
    const first = await h.call('POST', '/api/gtk/submissions', sample);
    const id = first.body.id;
    assert.equal((await h.call('POST', `/api/gtk/submissions/${id}/approve`)).status, 200);
    assert.equal(h.sqlite.prepare('SELECT status FROM gtk_submissions WHERE id=?').get(id).status, 'approved');
    assert.equal((await h.call('POST', `/api/gtk/submissions/${id}/reject`)).status, 400);
    const second = await h.call('POST', '/api/gtk/submissions', { ...sample, email: 'other@example.com', nik: '1234567890123456' });
    h.sqlite.prepare('INSERT INTO gtk (id, name, email) VALUES (?, ?, ?)').run('1234567890123456', 'Existing', 'existing@example.com');
    assert.equal((await h.call('POST', `/api/gtk/submissions/${second.body.id}/approve`)).status, 409);
    assert.equal(h.sqlite.prepare('SELECT name FROM gtk WHERE id=?').get('1234567890123456').name, 'Existing');
    assert.equal(h.sqlite.prepare('SELECT status FROM gtk_submissions WHERE id=?').get(second.body.id).status, 'pending');
});

test('notifikasi hanya ditujukan ke super admin dan menghindari data pribadi', async () => {
    const a = source.indexOf('async function notifyGtkRegistration(');
    const b = source.indexOf('\nasync function updateNotificationJobStatus', a);
    const pushes = [], messages = [], queries = [];
    const context = vm.createContext({ console, createNotificationJob: async (_, __, data) => { pushes.push(data); return { targetCount: 1, jobId: 'job' }; },
        processPendingNotifications: async () => {},
        runFirestoreAdminQuery: async (_, q) => { queries.push(q); return [{ name: 'users/admin' }]; },
        decodeFirestoreFields: () => ({}),
        getAdminUserContact: async () => ({ telegramChatId: '12345' }), isValidTelegramChatId: id => /^\d+$/.test(id),
        escapeTelegramHtml: s => s, getAppBaseUrl: () => 'https://example.test',
        executeTelegramFetch: async (_, id, text) => { messages.push({ id, text }); return { status: true }; } });
    const notify = vm.runInContext(`(${source.slice(a, b).trim()})`, context);
    await notify({ TELEGRAM_BOT_TOKEN: 'token' }, 'submission');
    assert.equal(pushes[0].targetType, 'role');
    assert.equal(pushes[0].targetValue, 'super_admin');
    assert.equal(pushes[0].url, './gtk.html');
    assert.equal(queries.length, 2);
    assert.equal(messages.length, 1);
    assert.match(messages[0].text, /gtk.html/);
    assert.doesNotMatch(messages[0].text, /nik|email/i);
});

test('form membuka WhatsApp setelah konfirmasi server dan mencegah pengiriman ganda', async () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/' });
    const { window } = dom;
    let resolveRequest;
    const requests = [];
    window.cfClient = { submitGtkRegistration: data => { requests.push(data); return new Promise(resolve => { resolveRequest = resolve; }); } };
    const opened = [];
    window.open = (...args) => opened.push(args);
    const a = html.indexOf('            window.showRegisterModal =');
    const b = html.indexOf("            const form = document.getElementById('login-form');", a);
    window.eval(`const cfClient = window.cfClient; ${html.slice(a, b)}`);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    const form = window.document.getElementById('form-register');
    for (const [id, value] of Object.entries({ 'reg-nama': sample.name, 'reg-gender': 'L', 'reg-nip': '-', 'reg-hp': sample.phone, 'reg-email': sample.email })) window.document.getElementById(id).value = value;
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    assert.equal(requests.length, 1);
    assert.equal(window.document.getElementById('btn-submit-register').disabled, true);
    assert.equal(opened.length, 0);
    resolveRequest({ success: true, id: 'sub_test' });
    await new Promise(resolve => setImmediate(resolve));
    assert.match(window.document.getElementById('reg-result').textContent, /berhasil disimpan/);
    assert.equal(opened.length, 1);
    assert.ok(opened[0][0].startsWith('https://wa.me/6281237729654?text='));
    assert.equal(window.document.getElementById('btn-submit-register').disabled, false);
    dom.window.close();
});

test('form tidak membuka WhatsApp jika server tidak mengonfirmasi penyimpanan', async () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/' });
    const { window } = dom;
    let opened = false;
    window.cfClient = { submitGtkRegistration: async () => ({}) };
    window.open = () => { opened = true; };
    const a = html.indexOf('            window.showRegisterModal =');
    const b = html.indexOf("            const form = document.getElementById('login-form');", a);
    window.eval(`const cfClient = window.cfClient; ${html.slice(a, b)}`);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    for (const [id, value] of Object.entries({ 'reg-nama': sample.name, 'reg-gender': 'L', 'reg-nip': '-', 'reg-hp': sample.phone, 'reg-email': sample.email })) window.document.getElementById(id).value = value;
    window.document.getElementById('form-register').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(opened, false);
    assert.match(window.document.getElementById('reg-result').textContent, /belum pasti/);
    assert.equal(window.document.getElementById('reg-nama').value, sample.name);
    dom.window.close();
});

test('auto-cleaner input dan validasi ketat client-side mencegah kiriman invalid', async () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/' });
    const { window } = dom;
    const requests = [];
    window.cfClient = { submitGtkRegistration: data => { requests.push(data); return Promise.resolve({ success: true, id: 'sub_test' }); } };
    window.open = () => {};
    const a = html.indexOf('            window.showRegisterModal =');
    const b = html.indexOf("            const form = document.getElementById('login-form');", a);
    window.eval(`const cfClient = window.cfClient; ${html.slice(a, b)}`);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const form = window.document.getElementById('form-register');
    const nipEl = window.document.getElementById('reg-nip');
    const nikEl = window.document.getElementById('reg-nik');
    const genderEl = window.document.getElementById('reg-gender');
    const resEl = window.document.getElementById('reg-result');

    // 1. Uji auto-cleaner NIP saat copy-paste format spasi/titik: "19850101 201001 1 001" -> "198501012010011001"
    nipEl.value = '19850101 201001 1 001';
    nipEl.dispatchEvent(new window.Event('input'));
    assert.equal(nipEl.value, '198501012010011001');

    // 2. Uji auto-cleaner NIK
    nikEl.value = '5107 0101 0185 0001';
    nikEl.dispatchEvent(new window.Event('input'));
    assert.equal(nikEl.value, '5107010101850001');

    // 3. Validasi gender kosong: harus diblokir sebelum request terkirim
    window.document.getElementById('reg-nama').value = 'Budi Test';
    genderEl.value = '';
    window.document.getElementById('reg-hp').value = '08123456789';
    window.document.getElementById('reg-email').value = 'budi@test.com';
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    assert.equal(requests.length, 0);
    assert.match(resEl.textContent, /Jenis kelamin wajib dipilih/);

    // 4. Uji validasi tanggal lahir masa depan
    window.document.getElementById('reg-birth-date').value = '2099-01-01';
    genderEl.value = 'L';
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    assert.equal(requests.length, 0);
    assert.match(resEl.textContent, /Tanggal lahir tidak valid atau melebihi hari ini/);

    // 5. Perbaiki tanggal lahir, masukkan email huruf besar dan NIP em-dash, submit sukses
    window.document.getElementById('reg-birth-date').value = '1985-05-20';
    window.document.getElementById('reg-email').value = 'BUDI.SUARTA@GMAIL.COM';
    nipEl.value = '—'; // iOS em-dash
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].nip, '-');
    assert.equal(requests[0].email, 'budi.suarta@gmail.com');

    // 6. Pastikan teks template literal telegramBotUser dan appName tidak muncul mentah di DOM HTML
    assert.doesNotMatch(html, /\{\{telegramBotUser\}\}/);
    assert.doesNotMatch(html, /Bot Telegram \{\{appName\}\}/);

    dom.window.close();
});

test('tampilan antrean dan detail mengamankan teks pengajuan sebelum dimasukkan ke HTML', () => {
    const script = fs.readFileSync('js/page-gtk.js', 'utf8');
    const a = script.indexOf('function escapeSubmissionHtml(');
    const b = script.indexOf('async function handleApproveSubmission()', a);
    const dom = new JSDOM('<div id="submissions-empty"></div><table id="table-submissions"><tbody id="submissions-table-body"></tbody></table><div id="sub-detail-body"></div><div id="sub-current-status"></div><div id="modal-detail-submission"></div>', { runScripts: 'outside-only' });
    dom.window.eval(`let allSubmissions = [{ id: 'sub_test', name: '<img src=x onerror=alert(1)>', status: 'pending', birth_place: '<img src=x>' }]; let currentSubStatusFilter = 'pending'; let activeSubmission; ${script.slice(a, b)}; renderSubmissionsTable(); openSubmissionDetail('sub_test');`);
    assert.equal(dom.window.document.querySelectorAll('img').length, 0);
    assert.match(dom.window.document.getElementById('sub-detail-body').textContent, /<img src=x/);
    dom.window.close();
});
