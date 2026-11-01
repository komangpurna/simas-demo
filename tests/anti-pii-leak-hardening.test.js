/**
 * tests/anti-pii-leak-hardening.test.js
 *
 * Pengujian Unit Keamanan Anti-PII Leak (OWASP Top 10 & ASVS Level 1-2):
 * 1. GET /api/sync/jurnal-students: Pengisian cepat tanpa login hanya mengembalikan NIS, Nama, Kelas, Status (Zero NISN, Zero Dapodik/Absen).
 * 2. Pencabutan Bypass JURNAL_API_KEY: Akses bypass key lama ditolak (0 backdoor).
 * 3. GET /api/students/public-card/:token: Sensor kredensial login (NISN & Tanggal Lahir disamarkan).
 * 4. GET /api/students: Minimisasi field Dapodik untuk akun asisten siswa (admin_kelas, admin_pks) vs data lengkap untuk Guru/Wali Kelas/BK/TU.
 * 5. GET /api/gtk & /api/jurnal/master: Proteksi privasi data guru dari akses anonim dan scraping data pribadi.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { loadWorkerLibModule } = require('./helpers/worker-source.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const SECRET = 'synthetic-card-token-secret-for-tests';
const MIGRATION_SECRET = 'synthetic-migration-secret-12345';
const { encryptSecureCardToken } = loadWorkerLibModule('lib/secure-card-token.js');

function createHarness() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(read('cloudflare/schema.sql'));
    const prepare = (sql, args = []) => ({
        bind: (...values) => prepare(sql, values),
        async run() { return { meta: sqlite.prepare(sql).run(...args) }; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async first() { return sqlite.prepare(sql).get(...args) || null; }
    });
    const DB = { prepare, async batch(stmts) { return Promise.all(stmts.map(s => s.run())); } };
    const context = vm.createContext({
        URL, URLSearchParams, Request, Response, Headers, crypto, atob, btoa, TextEncoder, TextDecoder,
        console: { log() {}, warn() {}, error() {} },
        fetch: async () => new Response('[]', { status: 200 })
    });
    vm.runInContext(read('cloudflare/worker.js').replace('export default {', 'globalThis.worker = {'), context);
    const state = { sqlite, auth: { valid: false, error: 'no firebase' } };
    context.getAuth = () => state.auth;
    vm.runInContext('verifyFirebaseToken = async () => getAuth();', context);
    state.call = async (route, env = {}, headers = {}) => {
        const reqHeaders = { ...headers };
        if (state.auth.valid && !reqHeaders.Authorization && !reqHeaders.authorization) {
            reqHeaders.Authorization = 'Bearer synthetic-token';
        }
        const res = await context.worker.fetch(
            new Request('https://worker.test' + route, { headers: reqHeaders }),
            { DB, CARD_TOKEN_SECRET: SECRET, MIGRATION_SECRET, ...env },
            { waitUntil() {} }
        );
        const json = await res.json().catch(() => ({}));
        return { ...json, status: res.status };
    };

    // Seed Data Siswa
    sqlite.prepare(`
        INSERT INTO students(nis, nisn, name, gender, class, birth_place, birth_date, nik, status, violation_points, dapodik_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        '5555',
        '0091234412',
        'I Wayan Sukadana',
        'L',
        'XII.1',
        'Abang',
        '2009-05-14',
        '5107011405090001',
        'active',
        0,
        JSON.stringify({
            nik: '5107011405090001',
            kk_no: '5107010101010001',
            father: 'I Made Ortu',
            mother: 'Ni Ketut Ibu',
            phone_parent: '081234567890',
            absen: '12'
        })
    );

    // Seed Foto Kartu Siswa
    sqlite.prepare("INSERT INTO student_photos(nis, public_token, status) VALUES (?, ?, 'verified')")
        .run('5555', 'tok_shakti_card_5555');

    // Seed Data GTK / Guru
    sqlite.prepare(`
        INSERT INTO gtk(id, nik, nip, nuptk, name, gender, birth_place, birth_date, phone, email, address, jenis_ptk, mapel, role, telegram_chat_id, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        'gtk_1001',
        '5107010101750001',
        '197501012000031001',
        '1234567890123456',
        'Drs. I Nyoman Guru, M.Pd.',
        'L',
        'Karangasem',
        '1975-01-01',
        '081999888777',
        'guru@smagesa.sch.id',
        'Jl. Raya Abang No. 10',
        'Guru Madya',
        'Matematika',
        'guru_mapel',
        '123456789',
        'Catatan internal kepegawaian',
        'active'
    );

    return state;
}

describe('Anti-PII Leak Security Hardening', () => {
    let h;
    beforeEach(() => { h = createHarness(); });
    afterEach(() => h.sqlite.close());

    // =========================================================================
    // 1. GET /api/sync/jurnal-students
    // =========================================================================
    test('1a. Tanpa login: Query jurnal per-kelas hanya mengembalikan NIS, Nama, Kelas, Status (Zero NISN & Zero Absen/Dapodik)', async () => {
        h.auth = { valid: false };
        const res = await h.call('/api/sync/jurnal-students?class=XII.1');
        expect(res.status).toBe(200);
        expect(res.data).toHaveLength(1);
        const s = res.data[0];
        expect(s.nis).toBe('5555');
        expect(s.nama).toBe('I Wayan Sukadana');
        expect(s.kelas).toBe('XII.1');
        expect(s.status).toBe('active');
        // Pastikan tidak ada NISN, absen, NIK, atau data ortu yang bocor ke publik
        expect(s.nisn).toBeUndefined();
        expect(s.absen).toBeUndefined();
        expect(s.dapodik_data).toBeUndefined();
    });

    test('1b. Tanpa login: Query massal class=all ditolak (401)', async () => {
        h.auth = { valid: false };
        const res = await h.call('/api/sync/jurnal-students?class=all');
        expect(res.status).toBe(401);
    });

    test('1c. Staf/Guru: Query jurnal per-kelas menyertakan NISN namun tetap bersih dari data Dapodik sensitif', async () => {
        h.auth = { valid: true, user: { uid: 'u_guru', role: 'guru_mapel', additionalRoles: [] } };
        const res = await h.call('/api/sync/jurnal-students?class=XII.1');
        expect(res.status).toBe(200);
        expect(res.data[0].nis).toBe('5555');
        expect(res.data[0].nisn).toBe('0091234412');
        expect(res.data[0].absen).toBeUndefined();
    });

    // =========================================================================
    // 2. Pencabutan Bypass JURNAL_API_KEY
    // =========================================================================
    test('2a. Header X-Sync-Key dengan JURNAL_API_KEY lama ditolak (no bypass backdoor)', async () => {
        h.auth = { valid: false };
        const res = await h.call('/api/students', { JURNAL_API_KEY: 'leaked_key' }, { 'X-Sync-Key': 'leaked_key' });
        expect(res.status).toBe(401);
    });

    test('2b. Header X-Sync-Key dengan MIGRATION_SECRET tetap diterima untuk CLI server-to-server', async () => {
        h.auth = { valid: false };
        const res = await h.call('/api/students', {}, { 'X-Sync-Key': MIGRATION_SECRET });
        expect(res.status).toBe(200);
    });

    // =========================================================================
    // 3. GET /api/students/public-card/:token (Masking NISN & Tanggal Lahir)
    // =========================================================================
    test('3a. Verifikasi kartu publik menyamarkan NISN dan Tanggal Lahir untuk melindungi kredensial login', async () => {
        h.auth = { valid: false };
        const res = await h.call('/api/students/public-card/tok_shakti_card_5555');
        expect(res.status).toBe(200);
        expect(res.card).toBeDefined();
        expect(res.card.nis).toBe('5555');
        expect(res.card.nama).toBe('I Wayan Sukadana');
        // NISN 0091234412 disamarkan menjadi 009****412
        expect(res.card.nisn).toBe('009****412');
        // Tanggal Lahir 2009-05-14 disamarkan hari dan bulannya
        expect(res.card.tempat_tanggal_lahir).toBe('Abang, **-**-2009');
        // Zero NIK / Data Ortu
        expect(res.card.nik).toBeUndefined();
        expect(res.card.kk_no).toBeUndefined();
    });

    // =========================================================================
    // 4. GET /api/students (Minimisasi Field Berbasis Role)
    // =========================================================================
    test('4a. Akun asisten siswa (admin_kelas, admin_pks) hanya menerima data operasional tanpa NIK/KK/TTL/Ortu', async () => {
        h.auth = { valid: true, user: { uid: 'u_pks', role: 'admin_pks', additionalRoles: [] } };
        const res = await h.call('/api/students?class=XII.1');
        expect(res.status).toBe(200);
        expect(res.data).toHaveLength(1);
        const student = res.data[0];
        expect(student.nis).toBe('5555');
        expect(student.name).toBe('I Wayan Sukadana');
        expect(student.class).toBe('XII.1');
        // Field sensitif wajib kosong
        expect(student.nik).toBe('');
        expect(student.nisn).toBe('');
        expect(student.birthDate).toBe('');
        expect(student.birthPlace).toBe('');
        expect(student.father).toBeUndefined();
        expect(student.mother).toBeUndefined();
        expect(student.phone_parent).toBeUndefined();
    });

    test('4b. Guru, Wali Kelas, Guru BK & Pimpinan menerima data Dapodik lengkap', async () => {
        h.auth = { valid: true, user: { uid: 'u_bk', role: 'guru_bk', additionalRoles: [] } };
        const res = await h.call('/api/students?class=XII.1');
        expect(res.status).toBe(200);
        expect(res.data).toHaveLength(1);
        const student = res.data[0];
        expect(student.nis).toBe('5555');
        expect(student.nisn).toBe('0091234412');
        expect(student.nik).toBe('5107011405090001');
        expect(student.birthDate).toBe('2009-05-14');
        expect(student.father).toBe('I Made Ortu');
        expect(student.phone_parent).toBe('081234567890');
    });

    test('4b2. Admin Dapodik (admin_dapodik) menerima data Dapodik lengkap dan berhak mencari berdasarkan NIK/NISN', async () => {
        h.auth = { valid: true, user: { uid: 'u_dapodik', role: 'admin_dapodik', additionalRoles: [] } };
        const res = await h.call('/api/students?class=XII.1');
        expect(res.status).toBe(200);
        expect(res.data).toHaveLength(1);
        const student = res.data[0];
        expect(student.nis).toBe('5555');
        expect(student.nisn).toBe('0091234412');
        expect(student.nik).toBe('5107011405090001');
        expect(student.birthDate).toBe('2009-05-14');
        expect(student.father).toBe('I Made Ortu');
        expect(student.mother).toBe('Ni Ketut Ibu');
        expect(student.phone_parent).toBe('081234567890');

        // Admin Dapodik berhak mencari siswa via NIK / NISN
        const searchByNik = await h.call('/api/students?search=5107011405090001');
        expect(searchByNik.status).toBe(200);
        expect(searchByNik.data).toHaveLength(1);
        expect(searchByNik.data[0].nis).toBe('5555');
    });

    test('4c. Akun asisten siswa (admin_pks) tidak dapat melakukan blind search berdasarkan NIK atau NISN', async () => {
        h.auth = { valid: true, user: { uid: 'u_pks', role: 'admin_pks', additionalRoles: [] } };
        const byNik = await h.call('/api/students?search=5107011405090001');
        expect(byNik.status).toBe(200);
        expect(byNik.data).toHaveLength(0);

        const byNisn = await h.call('/api/students?search=0091234412');
        expect(byNisn.status).toBe(200);
        expect(byNisn.data).toHaveLength(0);

        // Namun pencarian berdasarkan NIS atau Nama tetap berfungsi normal
        const byName = await h.call('/api/students?search=Sukadana');
        expect(byName.status).toBe(200);
        expect(byName.data).toHaveLength(1);
    });

    test('4d. Endpoint GET /api/bk-actions/student-context/:nis tidak membocorkan dapodik_data, NIK, atau NISN mentah', async () => {
        h.auth = { valid: true, user: { uid: 'u_pks', role: 'admin_pks', additionalRoles: [] } };
        const res = await h.call('/api/bk-actions/student-context/5555');
        expect(res.status).toBe(200);
        expect(res.data.student).toBeDefined();
        expect(res.data.student.nis).toBe('5555');
        expect(res.data.student.name).toBe('I Wayan Sukadana');
        expect(res.data.student.nik).toBeUndefined();
        expect(res.data.student.nisn).toBeUndefined();
        expect(res.data.student.birth_date).toBeUndefined();
        expect(res.data.student.dapodik_data).toBeUndefined();
    });

    test('4e. Tanpa login: Parameter ganda ?class=X.1&classes=XII.1,X.1 mengabaikan classesParam (anti-multi-class bypass) & mendukung format X-1 vs X.1', async () => {
        h.auth = { valid: false };
        const bypassAttempt = await h.call('/api/sync/jurnal-students?class=X.1&classes=XII.1,X.1');
        expect(bypassAttempt.status).toBe(200);
        expect(bypassAttempt.data).toHaveLength(0); // Kelas X.1 kosong, tidak boleh bocor siswa XII.1

        const dashFormat = await h.call('/api/sync/jurnal-students?class=XII-1');
        expect(dashFormat.status).toBe(200);
        expect(dashFormat.data).toHaveLength(1);
        expect(dashFormat.data[0].nis).toBe('5555');
    });

    // =========================================================================
    // 5. GET /api/gtk & /api/jurnal/master (Proteksi Data Guru)
    // =========================================================================
    test('5a. Akun anonim mentah ditolak akses ke GET /api/gtk (403 Forbidden)', async () => {
        h.auth = { valid: true, user: { uid: 'anon_raw', role: '', additionalRoles: [], isAnonymous: true } };
        const res = await h.call('/api/gtk');
        expect(res.status).toBe(403);
    });

    test('5b. Siswa terverifikasi hanya menerima profil direktori kontak guru tanpa NIK/NUPTK/TTL/Alamat/Telegram', async () => {
        h.auth = { valid: true, user: { uid: 'u_siswa', role: 'siswa', claims: { studentVerified: true, studentNis: '5555', studentClass: 'XII.1' } } };
        const res = await h.call('/api/gtk');
        expect(res.status).toBe(200);
        expect(res.data).toHaveLength(1);
        const gtk = res.data[0];
        expect(gtk.nama).toBe('Drs. I Nyoman Guru, M.Pd.');
        expect(gtk.nip).toBe('197501012000031001');
        expect(gtk.mapel).toBe('Matematika');
        // Field pribadi sensitif guru wajib disaring
        expect(gtk.nik).toBeUndefined();
        expect(gtk.nuptk).toBeUndefined();
        expect(gtk.birth_date).toBeUndefined();
        expect(gtk.tanggal_lahir).toBeUndefined();
        expect(gtk.alamat).toBeUndefined();
        expect(gtk.telegram_chat_id).toBeUndefined();
        expect(gtk.telegramChatId).toBeUndefined();
        expect(gtk.notes).toBeUndefined();
    });

    test('5c. Staf/Guru sekolah menerima data GTK lengkap untuk operasional administrasi', async () => {
        h.auth = { valid: true, user: { uid: 'u_tu', role: 'staff', additionalRoles: [] } };
        const res = await h.call('/api/gtk');
        expect(res.status).toBe(200);
        expect(res.data[0].nik).toBe('5107010101750001');
        expect(res.data[0].alamat).toBe('Jl. Raya Abang No. 10');
        expect(res.data[0].telegramChatId).toBe('123456789');
    });

    test('5d. Bundle publik GET /api/jurnal/master tidak mengekspos nomor telepon & Telegram ID guru', async () => {
        const res = await h.call('/api/jurnal/master');
        expect(res.status).toBe(200);
        expect(res.data.teachers).toBeDefined();
        const teacher = res.data.teachers.find(t => t.id === 'gtk_1001');
        expect(teacher).toBeDefined();
        expect(teacher.nama).toBe('Drs. I Nyoman Guru, M.Pd.');
        expect(teacher.nip).toBe('197501012000031001');
        expect(teacher.phone).toBeUndefined();
        expect(teacher.telegram_chat_id).toBeUndefined();
    });
});
