const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { webcrypto } = require('node:crypto');

// Menjalankan handler Worker dan SQL sebenarnya untuk Notification Center (lonceng).
const source = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');

function harness() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec("CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT)");
    const execute = (sql, args, mode) => {
        const statement = sqlite.prepare(sql);
        if (mode === 'all') return { results: statement.all(...args) };
        if (mode === 'first') return statement.get(...args) || null;
        const result = statement.run(...args);
        return { meta: { changes: Number(result.changes) } };
    };
    const queries = [];
    const prepare = (sql, args = []) => ({
        sql, args,
        bind: (...values) => prepare(sql, values),
        all: async () => { queries.push({ sql, args }); return execute(sql, args, 'all'); },
        first: async () => execute(sql, args, 'first'),
        run: async () => execute(sql, args, 'run')
    });
    const DB = {
        prepare,
        batch: async statements => statements.map(statement => /^\s*(SELECT|WITH)/i.test(statement.sql)
            ? execute(statement.sql, statement.args, 'all')
            : execute(statement.sql, statement.args, 'run'))
    };
    const fetchMock = jest.fn(async () => new Response('[]'));
    const context = vm.createContext({ console, URL, URLSearchParams, Request, Response, Headers,
        TextEncoder, TextDecoder, AbortSignal, crypto: webcrypto, fetch: fetchMock, atob, btoa, setTimeout, clearTimeout });
    vm.runInContext(source.replace('export default {', 'const workerHandler = {') + `
        globalThis.testApi = { createNotificationJob, ensureNotificationTables, pickHomeroomDocument, workerHandler,
            resolveNotificationRecipientUids, processMissingTeachingJournalReminderCron,
            processMonthlySukadukaFeeReminder, processMissingAttendanceReminderCron,
            notificationInboxAudience, notificationJobAudienceSql, notificationRecipientSql,
            allowFirestore: () => googleAccessTokenCache.set('https://www.googleapis.com/auth/cloud-platform', { token: 'test', expiresAt: Infinity }),
            setUser: user => { verifyFirebaseToken = async () => ({ valid: true, user }); } };
    `, context);
    const env = { DB };
    const api = context.testApi;
    const call = async (user, pathName, body) => {
        api.setUser(user);
        const init = body ? { method: 'POST', body: JSON.stringify(body) } : { method: 'GET' };
        const response = await api.workerHandler.fetch(new Request(`https://worker.test${pathName}`, init), env, { waitUntil: () => {} });
        return response.json();
    };
    return {
        sqlite, env, api, fetchMock, queries,
        job: (targetType, targetValue = '', title = `Job ${targetType}`) =>
            api.createNotificationJob(env, 'admin', { title, body: 'Isi', url: './dashboard.html', targetType, targetValue }),
        inbox: user => call(user, '/api/notifications/inbox'),
        markRead: (user, body) => call(user, '/api/notifications/mark-read', body)
    };
}

const guru = { uid: 'guru-1', role: 'guru_mapel', additionalRoles: [], assignedClass: '', isAnonymous: false, claims: {} };
const siswa = { uid: 'anon-1', role: '', additionalRoles: [], isAnonymous: true,
    claims: { studentVerified: true, studentNis: '12345', studentClass: 'X-1' } };

describe('Notification Center: visibilitas lonceng tanpa ketergantungan Web Push', () => {
    let h;
    beforeEach(async () => { h = harness(); await h.api.ensureNotificationTables(h.env); });
    afterEach(() => h.sqlite.close());

    test('guru tanpa token push tetap melihat notifikasi personal, role, agenda staf, dan broadcast', async () => {
        await h.job('user', 'guru-1', 'Personal');
        await h.job('role', 'guru, staff', 'Role guru');
        await h.job('agenda_staff', '', 'Agenda');
        await h.job('all', '', 'Broadcast');
        await h.job('role', 'kepala_lab', 'Bukan untuk guru');
        await h.job('user', 'guru-lain', 'Milik orang lain');

        const res = await h.inbox(guru);
        expect(res.notifications.map(n => n.title).sort()).toEqual(['Agenda', 'Broadcast', 'Personal', 'Role guru']);
        expect(res.unreadCount).toBe(4);
    });

    test('variasi penulisan kelas dan kapitalisasi role menjangkau push serta lonceng yang sama', async () => {
        h.sqlite.prepare('INSERT INTO fcm_tokens (id, user_id, token, role, assigned_class) VALUES (?, ?, ?, ?, ?)')
            .run('tok-guru', guru.uid, 'token-guru'.padEnd(90, 'x'), 'guru_mapel', 'Kelas X_1');
        const classJob = await h.job('class', 'Kelas X_1', 'Kelas');
        // Token kelas memakai underscore; pembaca memakai dash.
        const roleJob = await h.job('role', ' GURU ', 'Guru');
        expect(classJob.targetCount).toBe(1);
        expect(roleJob.targetCount).toBe(1);
        expect((await h.inbox({ ...guru, assignedClass: 'X-1' })).notifications.map(n => n.title).sort()).toEqual(['Guru', 'Kelas']);
    });

    test('siswa (anonymous) tidak melihat agenda staf maupun notifikasi role guru', async () => {
        await h.job('agenda_staff', '', 'Agenda staf');
        await h.job('role', 'guru', 'Role guru');
        await h.job('user', '12345', 'Personal NIS');
        await h.job('class', 'X.1', 'Pengumuman kelas');
        await h.job('class', 'XI.1', 'Kelas lain');
        await h.job('all', '', 'Broadcast');

        const res = await h.inbox(siswa);
        expect(res.notifications.map(n => n.title).sort()).toEqual(['Broadcast', 'Pengumuman kelas', 'Personal NIS']);
    });

    test('tandai semua dibaca bertahan setelah reload, termasuk job broadcast tanpa baris delivery', async () => {
        await h.job('user', 'guru-1');
        await h.job('role', 'guru');
        await h.job('all');

        const marked = await h.markRead(guru, { markAll: true });
        expect(marked.markedCount).toBe(3);
        expect((await h.inbox(guru)).unreadCount).toBe(0);
        // Idempotent: tidak menggandakan baris tanda baca.
        expect((await h.markRead(guru, { markAll: true })).markedCount).toBe(0);

        await h.job('role', 'guru', 'Baru');
        const after = await h.inbox(guru);
        expect(after.unreadCount).toBe(1);
        expect(after.notifications.find(n => n.title === 'Baru').isRead).toBe(false);
    });

    test('tandai satu notifikasi broadcast; id yang tidak ada tidak membuat baris liar', async () => {
        const job = await h.job('role', 'guru');
        expect((await h.markRead(guru, { id: job.jobId })).markedCount).toBe(1);
        expect((await h.inbox(guru)).unreadCount).toBe(0);
        expect((await h.markRead(guru, { id: 'push_123' })).error).toBeDefined();
        expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM notification_deliveries WHERE job_id = 'push_123'").get().n).toBe(0);
    });

    test('ID notifikasi milik akun lain tidak dapat disisipkan ke inbox lewat mark-read', async () => {
        const job = await h.job('user', 'guru-lain', 'Pribadi orang lain');
        expect((await h.markRead(guru, { id: job.jobId })).error).toBeDefined();
        expect((await h.inbox(guru)).notifications).toHaveLength(0);
        expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM notification_deliveries WHERE recipient_uid = 'guru-1'").get().n).toBe(0);
    });

    test('mark-read tetap menerima ID delivery milik pembaca seperti kontrak API sebelumnya', async () => {
        const job = await h.job('user', guru.uid, 'Pribadi');
        const delivery = h.sqlite.prepare('SELECT id FROM notification_deliveries WHERE job_id = ? AND recipient_uid = ?')
            .get(job.jobId, guru.uid);
        expect(await h.markRead(guru, { id: delivery.id })).toMatchObject({ success: true, markedCount: 1 });
        expect((await h.inbox(guru)).unreadCount).toBe(0);
    });

    test('delivery milik pembaca di luar jendela inbox tetap dapat dibaca lewat ID job maupun delivery', async () => {
        const job = await h.job('user', guru.uid, 'Lama');
        h.sqlite.prepare("UPDATE notification_jobs SET created_at = datetime('now', '-61 days') WHERE id = ?").run(job.jobId);
        h.sqlite.prepare("UPDATE notification_deliveries SET created_at = datetime('now', '-61 days') WHERE job_id = ?").run(job.jobId);
        const delivery = h.sqlite.prepare('SELECT id FROM notification_deliveries WHERE job_id = ?').get(job.jobId);
        expect((await h.inbox(guru)).notifications).toHaveLength(0);
        expect(await h.markRead(guru, { id: job.jobId })).toMatchObject({ success: true });
        expect(await h.markRead(guru, { id: delivery.id })).toMatchObject({ success: true });
    });

    test('ID delivery akun lain tetap ditolak walaupun job siarannya dapat dilihat pembaca', async () => {
        const job = await h.job('all', '', 'Siaran');
        const other = { ...guru, uid: 'guru-lain' };
        await h.markRead(other, { id: job.jobId });
        const delivery = h.sqlite.prepare('SELECT id FROM notification_deliveries WHERE job_id = ? AND recipient_uid = ?')
            .get(job.jobId, other.uid);
        expect((await h.markRead(guru, { id: delivery.id })).error).toBeDefined();
        expect((await h.inbox(guru)).unreadCount).toBe(1);
    });

    test('mark all milik siswa tidak menandai notifikasi siswa lain', async () => {
        await h.job('user', '12345', 'Milik saya');
        await h.job('user', '99999', 'Milik siswa lain');
        await h.markRead(siswa, { markAll: true });
        const other = { ...siswa, uid: 'anon-2', claims: { studentVerified: true, studentNis: '99999', studentClass: 'X-2' } };
        expect((await h.inbox(other)).unreadCount).toBe(1);
    });

    test('pengingat presensi (class_admin) hanya untuk Admin Kelas rombel, bukan siswa individu', async () => {
        const addToken = (id, uid, role, className, additional = '[]') =>
            h.sqlite.prepare('INSERT INTO fcm_tokens (id, user_id, token, role, additional_roles, assigned_class) VALUES (?, ?, ?, ?, ?, ?)')
                .run(id, uid, `token-${id}`.padEnd(90, 'x'), role, additional, className);
        addToken('s1', 'anon-1', 'siswa', 'X-1');
        addToken('a1', 'admin-x1', 'admin_kelas', 'Kelas X.1');
        addToken('a2', 'admin-x2', 'admin_kelas', 'X-2');
        addToken('w1', 'wali-x1', 'wali_kelas', 'X-1');
        addToken('g1', 'guru-x1', 'guru_mapel', 'X-1', '["admin_kelas"]');

        const job = await h.job('class_admin', 'X.1', 'Pengingat Presensi');
        const recipients = h.sqlite.prepare('SELECT recipient_uid FROM notification_deliveries WHERE job_id = ? ORDER BY recipient_uid').all(job.jobId)
            .map(row => row.recipient_uid);
        expect(recipients).toEqual(['admin-x1', 'guru-x1']);

        const adminX1 = { uid: 'admin-x1', role: 'admin_kelas', additionalRoles: [], assignedClass: 'X-1', isAnonymous: false, claims: {} };
        const adminX2 = { ...adminX1, uid: 'admin-x2', assignedClass: 'X-2' };
        const waliX1 = { uid: 'wali-x1', role: 'wali_kelas', additionalRoles: [], assignedClass: 'X-1', isAnonymous: false, claims: {} };
        expect((await h.inbox(siswa)).notifications).toHaveLength(0);
        expect((await h.inbox(waliX1)).notifications).toHaveLength(0);
        expect((await h.inbox(adminX2)).notifications).toHaveLength(0);
        expect((await h.inbox(adminX1)).notifications.map(n => n.title)).toEqual(['Pengingat Presensi']);
    });

    test('job di luar jendela 60 hari tidak dimuat ke lonceng', async () => {
        const job = await h.job('all', '', 'Lama');
        h.sqlite.prepare("UPDATE notification_jobs SET created_at = datetime('now', '-61 days') WHERE id = ?").run(job.jobId);
        await h.job('all', '', 'Baru');
        const res = await h.inbox(guru);
        expect(res.notifications.map(n => n.title)).toEqual(['Baru']);
    });
    test('kedua jalur pengingat presensi memakai target class_admin, bukan class', () => {
        expect(source).not.toMatch(/targetType: "class",\s*\n\s*targetValue: (missingClass|className)/);
        expect(source.match(/targetType: "class_admin"/g)).toHaveLength(2);
    });
});

describe('pickHomeroomDocument: wali kelas resmi didahulukan', () => {
    const doc = (name, role, additionalRoles = []) => ({
        name: `projects/p/databases/(default)/documents/users/${name}`,
        fields: {
            role: { stringValue: role },
            additionalRoles: { arrayValue: { values: additionalRoles.map(r => ({ stringValue: r })) } }
        }
    });

    test('guru_mapel yang muncul lebih dulu tidak menggeser wali_kelas', () => {
        const { api, sqlite } = harness();
        try {
            expect(api.pickHomeroomDocument([doc('guru', 'guru_mapel'), doc('wali', 'guru_mapel', ['wali_kelas'])]).name).toMatch(/wali$/);
            expect(api.pickHomeroomDocument([doc('guru', 'guru')]).name).toMatch(/guru$/);
            expect(api.pickHomeroomDocument([doc('staf', 'staff')])).toBeNull();
        } finally { sqlite.close(); }
    });
});

describe('Resolusi target GTK → UID login (beban kerja, suka duka, keuangan)', () => {
    let h;
    const guruLogin = { uid: 'uid-guru-1', role: 'guru_mapel', additionalRoles: [], assignedClass: '', isAnonymous: false, claims: {} };
    beforeEach(async () => {
        h = harness();
        await h.api.ensureNotificationTables(h.env);
        h.sqlite.exec(`
            CREATE TABLE gtk (id TEXT PRIMARY KEY, nik TEXT, nip TEXT, email TEXT, name TEXT, phone TEXT);
            CREATE TABLE students (nis TEXT PRIMARY KEY, name TEXT, class TEXT);
            CREATE TABLE work_weeks (id TEXT PRIMARY KEY, teacher_id TEXT);
            CREATE TABLE weekly_plan_versions (id TEXT PRIMARY KEY, work_week_id TEXT, submitted_by_uid TEXT);
            CREATE TABLE plan_activities (id TEXT PRIMARY KEY, work_week_id TEXT, category_code TEXT, catalog_id TEXT, title TEXT DEFAULT '');
            CREATE TABLE plan_time_segments (id TEXT PRIMARY KEY, activity_id TEXT, date TEXT, is_teaching INTEGER, description TEXT DEFAULT '');
            CREATE TABLE jurnal_guru (id TEXT PRIMARY KEY, tanggal TEXT, uid_guru TEXT, guru TEXT, kelas TEXT DEFAULT '');
            INSERT INTO gtk VALUES ('gtk-1', '3314000000000001', '', 'guru1@sekolah.id', 'I Made Guru', '');
            INSERT INTO students VALUES ('12345', 'Siswa', 'X-1');
        `);
    });
    afterEach(() => h.sqlite.close());

    test('ID GTK diterjemahkan via users.linkedTeacherId: push dan lonceng sampai ke akun pemilik', async () => {
        h.api.allowFirestore();
        h.fetchMock.mockImplementation(async () => new Response(JSON.stringify([
            { document: { name: 'projects/smagesa/databases/(default)/documents/users/uid-guru-1', fields: {} } }
        ])));
        h.sqlite.prepare('INSERT INTO fcm_tokens (id, user_id, token, role) VALUES (?, ?, ?, ?)')
            .run('tok-1', 'uid-guru-1', 'token-1'.padEnd(90, 'x'), 'guru_mapel');

        const job = await h.job('user', 'gtk-1', 'Pengingat Jurnal');
        expect(job.targetCount).toBe(1);
        const query = JSON.parse(h.fetchMock.mock.calls[0][1].body).structuredQuery;
        expect(query.where.fieldFilter.field.fieldPath).toBe('linkedTeacherId');
        expect((await h.inbox(guruLogin)).notifications.map(n => n.title)).toEqual(['Pengingat Jurnal']);
        expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM notification_deliveries WHERE recipient_uid = 'gtk-1'").get().n).toBe(0);
    });

    test('tanpa kredensial Firestore: cadangan relasi D1 rencana kerja (work_weeks → submitted_by_uid)', async () => {
        h.sqlite.exec(`INSERT INTO work_weeks VALUES ('ww-1', 'gtk-1');
            INSERT INTO weekly_plan_versions VALUES ('v-1', 'ww-1', 'uid-guru-1');`);
        expect(await h.api.resolveNotificationRecipientUids(h.env, 'gtk-1')).toEqual(['uid-guru-1']);
        await h.job('user', 'gtk-1', 'Lewat D1');
        expect((await h.inbox(guruLogin)).notifications.map(n => n.title)).toEqual(['Lewat D1']);
    });

    test('UID login dan NIS siswa tidak diterjemahkan ulang', async () => {
        expect(await h.api.resolveNotificationRecipientUids(h.env, '12345')).toEqual([]);
        expect(await h.api.resolveNotificationRecipientUids(h.env, 'uid-tanpa-gtk')).toEqual([]);
        expect(h.fetchMock).not.toHaveBeenCalled();
    });

    test('cron jurnal: guru yang sudah mengisi (cocok nama/UID) tidak diingatkan; yang belum diingatkan ke UID login', async () => {
        h.sqlite.exec(`
            INSERT INTO gtk VALUES ('gtk-2', '', '', '', 'Ni Luh Guru', '');
            INSERT INTO work_weeks VALUES ('ww-1', 'gtk-1'), ('ww-2', 'gtk-2');
            INSERT INTO weekly_plan_versions VALUES ('v-1', 'ww-1', 'uid-guru-1'), ('v-2', 'ww-2', 'uid-guru-2');
            INSERT INTO plan_activities VALUES ('pa-1', 'ww-1', 'PELAKSANAAN_KBM', '', ''), ('pa-2', 'ww-2', 'PELAKSANAAN_KBM', '', '');
            INSERT INTO plan_time_segments VALUES ('s-1', 'pa-1', '2026-10-12', 1, ''), ('s-2', 'pa-2', '2026-10-12', 1, '');
            INSERT INTO jurnal_guru VALUES ('j-1', '2026-10-12', '', 'Ni Luh Guru', '');
        `);
        await h.api.processMissingTeachingJournalReminderCron(h.env, '2026-10-12');
        const jobs = h.sqlite.prepare('SELECT target_value FROM notification_jobs').all().map(row => row.target_value);
        expect(jobs).toEqual(['gtk-1']);
        expect((await h.inbox(guruLogin)).notifications).toHaveLength(1);
        expect((await h.inbox({ ...guruLogin, uid: 'uid-guru-2' })).notifications).toHaveLength(0);
    });

    test('cron jurnal: jurnal yang tercatat dengan UID login dianggap sudah mengisi', async () => {
        h.sqlite.exec(`
            INSERT INTO work_weeks VALUES ('ww-1', 'gtk-1');
            INSERT INTO weekly_plan_versions VALUES ('v-1', 'ww-1', 'uid-guru-1');
            INSERT INTO plan_activities VALUES ('pa-1', 'ww-1', 'PELAKSANAAN_KBM', '', '');
            INSERT INTO plan_time_segments VALUES ('s-1', 'pa-1', '2026-10-12', 1, '');
            INSERT INTO jurnal_guru VALUES ('j-1', '2026-10-12', 'uid-guru-1', 'Nama Berbeda', '');
        `);
        const result = await h.api.processMissingTeachingJournalReminderCron(h.env, '2026-10-12');
        expect(result.missingCount).toBe(0);
        expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM notification_jobs').get().n).toBe(0);
    });

    test('cron jurnal: sesi dengan nama rombel spesifik (X-1) dievaluasi akurat pada jadwal terbatas tanpa salah dibebaskan', async () => {
        h.sqlite.exec(`
            INSERT INTO work_weeks VALUES ('ww-spec', 'gtk-1');
            INSERT INTO weekly_plan_versions VALUES ('v-spec', 'ww-spec', 'uid-guru-1');
            INSERT INTO plan_activities VALUES ('pa-spec', 'ww-spec', 'PELAKSANAAN_KBM', '', 'Tatap Muka Fisika Kelas X-1');
            INSERT INTO plan_time_segments VALUES ('s-spec', 'pa-spec', '2026-10-12', 1, 'Kelas X-1 (JP 1–2)');
        `);
        const result = await h.api.processMissingTeachingJournalReminderCron(h.env, '2026-10-12');
        expect(result.missingCount).toBe(1);
        const job = h.sqlite.prepare("SELECT * FROM notification_jobs WHERE target_value = 'gtk-1'").get();
        expect(job).toBeDefined();
        expect(job.body).toContain('X-1');
    });
});

describe('Sumber pengiriman per fitur', () => {
    test('pengingat iuran suka duka: satu job per anggota GTK, bukan per identifier', () => {
        expect(source).toContain('for (const { gtkId: targetVal, uidTargets } of unpaidRecipients)');
        expect(source).toContain('recipientUids: uidTargets');
        expect(source).not.toContain('for (const targetVal of finalUnpaidTargets)');
    });

    test('EWS menerima env lengkap agar wali kelas (Firestore) dan FCM dapat diproses', () => {
        expect(source).toContain('async function recalculateSingleStudentAggregate(db, nis, env = null)');
        expect(source).not.toMatch(/recalculateSingleStudentAggregate\(env\.DB, [^)]+[^v]\)/);
        expect(source).not.toContain('findHomeroomTeacherForClass({ DB: db }');
    });

    test('balasan masukan ke "Semua Pimpinan" tidak lagi dibuang', () => {
        const masukan = fs.readFileSync(path.join(__dirname, '../js/page-masukan.js'), 'utf8');
        expect(masukan).not.toContain("targetFeedback.targetRecipient !== 'all'");
        expect(masukan).toContain("'super_admin,kepala_sekolah,wakasek_kurikulum,kesiswaan,humas,sarpras,kepala_lab'");
    });
});

describe('Pengingat iuran suka duka: anggota lunas tidak boleh diingatkan', () => {
    let h;
    // Supabase tiruan: mendukung paginasi limit/offset seperti PostgREST.
    const mockSupabase = (rows, { requireServiceKey = 'service-key' } = {}) => {
        h.fetchMock.mockImplementation(async (url, init) => {
            const u = new URL(url);
            if (!u.pathname.includes('/rest/v1/sukaduka_iuran')) return new Response('[]');
            // Meniru RLS lockdown: selain service role, PostgREST mengembalikan [] tanpa error.
            if (init.headers.apikey !== requireServiceKey) return new Response('[]');
            const limit = Number(u.searchParams.get('limit'));
            const offset = Number(u.searchParams.get('offset'));
            return new Response(JSON.stringify(rows.slice(offset, offset + limit)));
        });
    };
    const months = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `2026-${String(from + i).padStart(2, '0')}`);
    const paymentRows = (guruId, monthList) => monthList.map((m, i) => ({ id: `${guruId}-${i}`, guru_id: guruId, anggota_nip: null, bulan_tahun: m, jumlah: 20000 }));
    const reminderTargets = () => h.sqlite.prepare('SELECT target_value FROM notification_jobs ORDER BY target_value').all().map(r => r.target_value);

    beforeEach(async () => {
        h = harness();
        await h.api.ensureNotificationTables(h.env);
        h.sqlite.exec(`
            CREATE TABLE gtk (id TEXT PRIMARY KEY, nik TEXT, nip TEXT, name TEXT, email TEXT, phone TEXT, role TEXT, status TEXT);
            INSERT INTO gtk VALUES ('gtk-lunas', '', '', 'Lunas Setahun', '', '', 'guru', 'active'),
                                   ('gtk-nunggak', '', '', 'Belum Oktober', '', '', 'guru', 'active'),
                                   ('gtk-nip', '', '198001012005011001', 'Bayar Via NIP', '', '', 'guru', 'active');
        `);
    });
    afterEach(() => h.sqlite.close());

    test('anggota lunas s.d. Desember tidak diingatkan; yang belum bayar bulan ini diingatkan', async () => {
        h.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
        mockSupabase([
            ...paymentRows('gtk-lunas', months(6, 10)),
            ...paymentRows('gtk-nunggak', months(6, 9)),
            // Pembayaran tercatat dengan guru_id lain namun anggota_nip cocok dengan GTK.
            ...paymentRows('id-lama', months(6, 10)).map(row => ({ ...row, anggota_nip: '198001012005011001' }))
        ]);
        await h.api.processMonthlySukadukaFeeReminder(h.env, '2026-10-12', { forceRun: true });
        expect(reminderTargets()).toEqual(['gtk-nunggak']);
    });

    test('tanpa service role key (data terbaca kosong karena RLS): tidak ada satu pun pengingat terkirim', async () => {
        mockSupabase(paymentRows('gtk-lunas', months(6, 10)));
        const result = await h.api.processMonthlySukadukaFeeReminder(h.env, '2026-10-12', { forceRun: true });
        expect(result.reason).toBe('payment_data_unavailable');
        expect(reminderTargets()).toEqual([]);
    });

    test('data iuran setahun kosong dianggap anomali sumber data: pengingat dibatalkan', async () => {
        h.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
        mockSupabase([]);
        const result = await h.api.processMonthlySukadukaFeeReminder(h.env, '2026-10-12', { forceRun: true });
        expect(result.reason).toBe('payment_data_empty');
        expect(reminderTargets()).toEqual([]);
    });

    test('lebih dari 1000 baris pembayaran dibaca utuh (paginasi), tidak terpotong', async () => {
        h.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
        const filler = Array.from({ length: 1200 }, (_, i) => ({ id: `f-${String(i).padStart(4, '0')}`, guru_id: `lain-${i}`, anggota_nip: null, bulan_tahun: '2026-06', jumlah: 20000 }));
        mockSupabase([...filler, ...paymentRows('gtk-lunas', months(6, 10)), ...paymentRows('gtk-nip', months(6, 10)), ...paymentRows('gtk-nunggak', months(6, 10))]);
        await h.api.processMonthlySukadukaFeeReminder(h.env, '2026-10-12', { forceRun: true });
        expect(reminderTargets()).toEqual([]);
    });
});

describe('Pengingat presensi: data presensi tidak terbaca → tidak mengirim', () => {
    test('tanpa service role key, cron presensi berhenti tanpa membuat notifikasi', async () => {
        const h = harness();
        try {
            await h.api.ensureNotificationTables(h.env);
            h.sqlite.exec(`
                CREATE TABLE students (nis TEXT PRIMARY KEY, name TEXT, class TEXT, status TEXT);
                INSERT INTO students VALUES ('1', 'A', 'X-1', 'aktif'), ('2', 'B', 'X-2', 'aktif');
            `);
            const result = await h.api.processMissingAttendanceReminderCron(h.env, '2026-10-12');
            expect(result.reason).toBe('attendance_data_unavailable');
            expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM notification_jobs').get().n).toBe(0);
        } finally { h.sqlite.close(); }
    });
});

describe('Efisiensi query lonceng (kuota rows read D1)', () => {
    const coveringMigration = fs.readFileSync(path.join(__dirname, '../cloudflare/migrations/202610160002_notification_inbox_covering_indexes.sql'), 'utf8');

    test.each([
        ['siswa', siswa],
        ['admin kelas', { ...guru, role: 'admin_kelas', assignedClass: 'X-1' }]
    ])('%s: 2500 notifikasi kelas lain tidak ikut diperiksa, hasil sama dengan query lama', async (_, user) => {
        const h = harness();
        try {
            await h.api.ensureNotificationTables(h.env);
            const insert = h.sqlite.prepare(`INSERT INTO notification_jobs
                (id,title,body,target_type,target_value,created_by,created_at)
                VALUES (?,'t','b',?,?,'x',datetime('now',?))`);
            for (let i=0; i<2500; i++) insert.run(`other-${i}`,i%2 ? 'class' : 'class_admin',`Kelas X_${i+2}`,`-${i+100} seconds`);
            insert.run('class-exact','class','X-1','-1 seconds');
            insert.run('class-legacy','class','Kelas x_1','-2 seconds');
            insert.run('admin-legacy','class_admin','Kelas X.1','-3 seconds');
            insert.run('everyone','all','','-4 seconds');
            insert.run('role','role','SISWA, admin_kelas','-5 seconds');
            insert.run('personal','user',user.uid,'-6 seconds');
            insert.run('delivered','class','X-99','-7 seconds');
            h.sqlite.prepare(`INSERT INTO notification_deliveries(id,job_id,token_id,token,recipient_uid,status,is_read)
                VALUES ('delivered:inapp','delivered','inapp','',?,'inapp',1)`).run(user.uid);
            h.queries.length = 0;
            const result = await h.inbox(user);
            expect(result.notifications.some(item => item.id === 'delivered' && item.isRead)).toBe(true);
            const query = h.queries.find(item => item.sql.includes('candidate_jobs'));
            const audience = h.api.notificationInboxAudience(user);
            const recipientsJson = JSON.stringify([audience.uid,audience.studentNis].filter(Boolean));
            const types = ['all','role',...(audience.agendaStaff ? ['agenda_staff'] : []),
                ...(audience.assignedClass ? ['class'] : []),...(audience.classAdmin && audience.assignedClass ? ['class_admin'] : [])];
            const jobAudience = h.api.notificationJobAudienceSql(audience);
            const legacy = `WITH candidate_jobs AS (
                SELECT d.job_id AS id FROM notification_deliveries d
                WHERE d.recipient_uid IN (SELECT value FROM json_each(?)) AND d.created_at >= datetime('now',?)
                UNION
                SELECT j.id FROM notification_jobs j WHERE j.target_type IN ('user','student')
                AND j.target_value IN (SELECT value FROM json_each(?)) AND j.created_at >= datetime('now',?)
                UNION
                SELECT j.id FROM notification_jobs j WHERE j.target_type IN (SELECT value FROM json_each(?))
                AND j.created_at >= datetime('now',?) AND ${jobAudience.sql}
            ) ${query.sql.slice(query.sql.indexOf('SELECT j.id AS id, j.title'))}`;
            const legacyArgs = [recipientsJson,'-60 days',recipientsJson,'-60 days',JSON.stringify(types),'-60 days',
                ...jobAudience.args,recipientsJson,'-60 days'];
            expect(h.sqlite.prepare(query.sql).all(...query.args)).toEqual(h.sqlite.prepare(legacy).all(...legacyArgs));

            let optimizedVisits = 0, legacyVisits = 0;
            h.sqlite.function('visit_optimized', () => { optimizedVisits++; return 1; });
            h.sqlite.function('visit_legacy', () => { legacyVisits++; return 1; });
            const countVisits = (sql, fn) => sql.replace(/FROM notification_jobs j\s+WHERE/g, `FROM notification_jobs j WHERE ${fn}() AND`);
            h.sqlite.prepare(countVisits(query.sql,'visit_optimized')).all(...query.args);
            h.sqlite.prepare(countVisits(legacy,'visit_legacy')).all(...legacyArgs);
            expect(legacyVisits).toBeGreaterThanOrEqual(audience.classAdmin ? 2500 : 1250);
            expect(optimizedVisits).toBeLessThan(50);
            const plan = h.sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.args).map(row => row.detail).join('\n');
            expect(plan).toContain('idx_notification_jobs_class_inbox');
            expect(plan).toContain('COVERING INDEX idx_notification_deliveries_recipient_created');
            expect(plan).toContain('COVERING INDEX idx_notification_jobs_type_created');
            expect(plan).toContain('COVERING INDEX idx_notification_jobs_personal_target');
        } finally { h.sqlite.close(); }
    });

    test('migrasi indeks dapat diulang; database lama tetap dapat dibaca dan status baca terjaga', async () => {
        const h = harness();
        try {
            await h.api.ensureNotificationTables(h.env);
            await h.job('all','','Siaran');
            await h.job('class','Kelas X_1','Kelas');
            await h.markRead(siswa,{ markAll:true });
            h.sqlite.exec(`DROP INDEX idx_notification_jobs_class_inbox;
                DROP INDEX idx_notification_deliveries_recipient_created;
                DROP INDEX idx_notification_jobs_type_created;
                DROP INDEX idx_notification_jobs_personal_target;`);
            h.sqlite.exec(fs.readFileSync(path.join(__dirname, '../cloudflare/migrations/202610130001_notification_inbox_candidate_indexes.sql'), 'utf8'));
            const before = await h.inbox(siswa);
            const snapshot = () => ['notification_jobs','notification_deliveries'].map(table => h.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
            const rows = snapshot();
            h.sqlite.exec(coveringMigration);
            h.sqlite.exec(coveringMigration);
            expect(snapshot()).toEqual(rows);
            expect(await h.inbox(siswa)).toEqual(before);
            expect(before.unreadCount).toBe(0);
            const fresh = new DatabaseSync(':memory:');
            try {
                fresh.exec(fs.readFileSync(path.join(__dirname, '../cloudflare/schema.sql'), 'utf8'));
                for (const name of ['idx_notification_deliveries_recipient_created','idx_notification_jobs_type_created',
                    'idx_notification_jobs_personal_target','idx_notification_jobs_class_inbox']) {
                    const definition = db => db.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name=?").get(name)
                        .sql.replace(/\s+/g,'').toLowerCase();
                    expect(definition(fresh)).toBe(definition(h.sqlite));
                }
            } finally { fresh.close(); }
        } finally { h.sqlite.close(); }
    });

    test('notifikasi pribadi milik pengguna lain tidak ikut dipindai; semua akses lewat indeks', async () => {
        const h = harness();
        try {
            await h.api.ensureNotificationTables(h.env);
            const insJob = h.sqlite.prepare("INSERT INTO notification_jobs (id, title, body, target_type, target_value, created_by) VALUES (?, 't', 'b', ?, ?, 'x')");
            const insDel = h.sqlite.prepare("INSERT INTO notification_deliveries (id, job_id, token_id, token, recipient_uid, status) VALUES (?, ?, 'inapp', '', ?, 'inapp')");
            for (let i = 0; i < 2000; i++) { insJob.run(`lain-${i}`, 'user', `uid-lain-${i}`); insDel.run(`lain-${i}:inapp`, `lain-${i}`, `uid-lain-${i}`); }
            for (let i = 0; i < 3; i++) { insJob.run(`milik-${i}`, 'user', 'guru-1'); insDel.run(`milik-${i}:inapp`, `milik-${i}`, 'guru-1'); }
            insJob.run('siaran-1', 'role', 'guru');

            h.queries.length = 0;
            const res = await h.inbox(guru);
            expect(res.notifications.map(n => n.id).sort()).toEqual(['milik-0', 'milik-1', 'milik-2', 'siaran-1']);

            // Hitung baris notification_jobs yang dikunjungi kandidat siaran: tidak boleh menyentuh 2000 job pribadi.
            const inboxQuery = h.queries.find(q => q.sql.includes('candidate_jobs'));
            expect(inboxQuery).toBeDefined();
            let visited = 0;
            h.sqlite.function('visit_row', () => { visited++; return 1; });
            const counted = inboxQuery.sql.replace(/FROM notification_jobs j\s+WHERE j\.target_type/g, 'FROM notification_jobs j WHERE visit_row() AND j.target_type');
            h.sqlite.prepare(counted).all(...inboxQuery.args);
            expect(visited).toBeLessThan(10);

            const plan = h.sqlite.prepare(`EXPLAIN QUERY PLAN ${inboxQuery.sql}`).all(...inboxQuery.args).map(row => row.detail).join('\n');
            expect(plan).toContain('idx_notification_jobs_type_created');
            expect(plan).toContain('idx_notification_deliveries_recipient_created');
            expect(plan).not.toMatch(/SCAN (j|notification_jobs|d|notification_deliveries)\b/);
        } finally { h.sqlite.close(); }
    });
});

describe('Paritas UX lonceng: isi & status baca identik dengan query versi sebelumnya', () => {
    // Query referensi = versi sebelum optimasi kandidat (memindai seluruh job dalam window).
    const referenceInbox = (h, user) => {
        const audience = h.api.notificationInboxAudience(user);
        const recipient = h.api.notificationRecipientSql('d', audience);
        const jobAudience = h.api.notificationJobAudienceSql(audience);
        return h.sqlite.prepare(`
            SELECT j.id AS id, COALESCE((SELECT MAX(d.is_read) FROM notification_deliveries d WHERE d.job_id = j.id AND ${recipient.sql}), 0) AS is_read
            FROM notification_jobs j
            WHERE j.created_at >= datetime('now', '-60 days')
              AND (${jobAudience.sql} OR EXISTS (SELECT 1 FROM notification_deliveries d WHERE d.job_id = j.id AND ${recipient.sql}))
            ORDER BY j.created_at DESC, j.id LIMIT 40
        `).all(...recipient.args, ...jobAudience.args, ...recipient.args).map(r => `${r.id}:${r.is_read}`);
    };

    test('6 profil akun pada data acak (termasuk notifikasi pribadi lama tanpa baris lonceng)', async () => {
        const h = harness();
        try {
            await h.api.ensureNotificationTables(h.env);
            const users = {
                guru: { uid: 'g1', role: 'guru_mapel', additionalRoles: [], assignedClass: '', isAnonymous: false, claims: {} },
                siswa: { uid: 'anon-1', role: '', additionalRoles: [], isAnonymous: true, claims: { studentVerified: true, studentNis: '111', studentClass: 'X-1' } },
                adminKelas: { uid: 'ak1', role: 'admin_kelas', additionalRoles: [], assignedClass: 'X-1', isAnonymous: false, claims: {} },
                staf: { uid: 's1', role: 'staff', additionalRoles: [], assignedClass: '', isAnonymous: false, claims: {} },
                kepsek: { uid: 'k1', role: 'kepala_sekolah', additionalRoles: ['guru_mapel'], assignedClass: '', isAnonymous: false, claims: {} },
                wali: { uid: 'w1', role: 'wali_kelas', additionalRoles: ['guru_mapel'], assignedClass: 'X-1', isAnonymous: false, claims: {} }
            };
            const ids = ['g1', '111', 'anon-1', 'ak1', 's1', 'k1', 'w1', 'lain-1', 'lain-2'];
            const targets = [['all', ''], ['role', 'guru'], ['role', 'kepala_sekolah,staff'], ['role', 'siswa'], ['agenda_staff', ''],
                ['class', 'X.1'], ['class', 'XI-2'], ['class_admin', 'Kelas X-1'], ['class_admin', 'X-2']];
            const insJob = h.sqlite.prepare("INSERT INTO notification_jobs (id, title, body, target_type, target_value, created_by, created_at) VALUES (?, 't', 'b', ?, ?, 'x', datetime('now', ?))");
            const insDel = h.sqlite.prepare("INSERT INTO notification_deliveries (id, job_id, token_id, token, recipient_uid, status, is_read, created_at) VALUES (?, ?, ?, '', ?, 'sent', ?, datetime('now', ?))");
            let seed = 7; const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
            for (let i = 0; i < 400; i++) {
                const age = `-${rand(70)} days -${rand(1440)} minutes`;
                const id = `job-${String(i).padStart(3, '0')}`;
                if (rand(2) === 0) {
                    const who = ids[rand(ids.length)];
                    insJob.run(id, rand(4) === 0 ? 'student' : 'user', who, age);
                    // Sebagian notifikasi pribadi lama tidak punya baris delivery (sebelum ada baris lonceng in-app).
                    if (rand(3) !== 0) insDel.run(`${id}:d`, id, 'inapp', who, rand(2), age);
                } else {
                    const [type, value] = targets[rand(targets.length)];
                    insJob.run(id, type, value, age);
                    // Sebagian siaran punya baris delivery push / tanda baca milik pengguna tertentu.
                    if (rand(2) === 0) insDel.run(`${id}:d`, id, `tok-${i}`, ids[rand(ids.length)], rand(2), age);
                }
            }
            for (const [name, user] of Object.entries(users)) {
                const actual = (await h.inbox(user)).notifications.map(n => `${n.id}:${n.isRead ? 1 : 0}`);
                expect({ name, list: actual }).toEqual({ name, list: referenceInbox(h, user) });
            }
        } finally { h.sqlite.close(); }
    });

    test('tandai semua dibaca juga mencakup notifikasi pribadi lama tanpa baris lonceng', async () => {
        const h = harness();
        try {
            await h.api.ensureNotificationTables(h.env);
            h.sqlite.exec("INSERT INTO notification_jobs (id, title, body, target_type, target_value, created_by) VALUES ('lama-1', 'Lama', 'b', 'user', 'guru-1', 'x')");
            expect((await h.inbox(guru)).notifications.map(n => n.id)).toEqual(['lama-1']);
            await h.markRead(guru, { markAll: true });
            const after = await h.inbox(guru);
            expect(after.unreadCount).toBe(0);
            expect(after.notifications[0].isRead).toBe(true);
        } finally { h.sqlite.close(); }
    });
});
