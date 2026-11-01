const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { webcrypto } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const { buildFlatWorkerSource } = require('./worker-source.cjs');

function testSignature() {
    const width = 600, height = 220, stride = width * 4 + 1, pixels = Buffer.alloc(stride * height);
    for (let x=20;x<220;x++) { const y=30+Math.round(Math.abs(100-x)/2); pixels[y*stride+1+x*4+3]=255; }
    function chunk(type, data) {
        const payload = Buffer.concat([Buffer.from(type), data]); let crc=0xffffffff;
        for (const byte of payload) { crc^=byte; for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
        const result=Buffer.alloc(data.length+12); result.writeUInt32BE(data.length); payload.copy(result,4); result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4); return result;
    }
    const header=Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8]=8; header[9]=6;
    return 'data:image/png;base64,'+Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}

function journalHarness({ origin = 'https://worker.test' } = {}) {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(fs.readFileSync(path.join(__dirname, '../../cloudflare/schema.sql'), 'utf8'));
    sqlite.exec(`INSERT INTO gtk(id,name) VALUES ('gtk-guru','Guru Resmi');
        INSERT INTO students(nis,name,class,status) VALUES ('100','Siswa Satu','X-1','active'),('200','Siswa Dua','X-1','active'),('300','Kelas Lain','X-2','active'),('400','Nonaktif','X-1','inactive');
        INSERT INTO lms_topics(id,teacher_id,teacher_name,subject_name,class_name,title) VALUES ('topic','guru','Guru Resmi','IPA','X-1','Bab 1');
        INSERT INTO lms_materials(id,topic_id,teacher_id,teacher_name,subject_name,class_name,title,resource_type)
            VALUES ('read','topic','guru','Guru Resmi','IPA','X-1','Materi Pertama','text'),('read2','topic','guru','Guru Resmi','IPA','X-1','Materi Kedua','text');
        INSERT INTO lms_progress(id,material_id,topic_id,student_nis,student_name,student_class,first_opened_at,last_accessed_at,active_seconds_total,session_count)
            VALUES ('prog','read','topic','100','Siswa Satu','X-1','2026-01-15 02:00:00','2026-01-15 02:00:00',915,2);
        INSERT INTO school_work_policies(id,policy_name,effective_from) VALUES ('policy','Uji','2026-01-01');
        INSERT INTO work_weeks(id,teacher_id,week_start_date,week_end_date,academic_year,semester,policy_id,active_plan_version_id)
            VALUES ('week','gtk-guru','2026-01-12','2026-01-18','2026/2027','Ganjil','policy','version');
        INSERT INTO weekly_plan_versions(id,work_week_id,version_number,status) VALUES ('version','week',1,'approved');
        INSERT INTO activity_catalog(id,code,category_code,category_name,name) VALUES ('cat_kbm','TEST_KBM','PELAKSANAAN_KBM','KBM','KBM');
        INSERT INTO plan_activities(id,work_week_id,catalog_id,title,category_code) VALUES ('activity','week','cat_kbm','KBM IPA (X-1)','PELAKSANAAN_KBM');
        INSERT INTO plan_time_segments(id,plan_version_id,activity_id,date,day_of_week,start_time,end_time,planned_minutes,is_teaching,jp_count,description)
            VALUES ('segment','version','activity','2026-01-15',4,'08:15','10:30',120,1,3,'KBM IPA Kelas X-1 (JP 2–4)');`);
    const prepare = (sql, args = []) => ({ sql, args, bind: (...values) => prepare(sql, values),
        first: async () => sqlite.prepare(sql).get(...args) || null,
        all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
        run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }) });
    const DB = { prepare, batch: async statements => {
        sqlite.exec('BEGIN');
        try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    } };
    const actor = { uid: 'guru', role: 'guru_mapel', linkedTeacherId: 'gtk-guru', displayName: 'Guru Resmi' };
    const context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, TextEncoder, TextDecoder, atob, btoa,
        crypto: webcrypto, actor, console: { log() {}, warn() {}, error() {} } });
    vm.runInContext(buildFlatWorkerSource().replace('export default {', 'globalThis.worker = {'), context);
    vm.runInContext(`verifyFirebaseToken = async () => actor?.uid ? { valid: true, user: actor } : { valid: false, error: 'No session' };
        getVerifiedStudentSession = async () => actor?.nis ? { nis: actor.nis } : null;
        getVerifiedStudentIdentity = () => null;`, context);
    const env = { DB, SESSION_SECRET: 'local-test-journal-receipt-secret-only' };
    async function request(route, body = null, identity = actor, method = body ? 'POST' : 'GET') {
        context.actor = identity;
        const response = await context.worker.fetch(new Request(origin + route, { method,
            ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }), env, {});
        const data = response.headers.get('Content-Type')?.includes('image/svg') ? { svg: await response.text() } : await response.json();
        return { ...data, httpStatus: response.status };
    }
    const base = { material_ids: ['read'], tanggal: '2026-01-15', jp: [2,3,4], plan_segment_id: 'segment', period_start: '2026-01-15', period_end: '2026-01-15' };
    async function signingBody(overrides = {}) {
        const previewOverrides = overrides.overrides || {};
        const tempBody = { ...base, ...overrides, overrides: previewOverrides };
        const tempResult = await request('/api/lms/journal/preview', tempBody);
        if (tempResult.httpStatus !== 200) throw new Error(JSON.stringify(tempResult));
        const completeOverrides = { ...previewOverrides };
        for (const s of (tempResult.snapshot?.students || [])) {
            if (!s.status && !completeOverrides[s.nis]) completeOverrides[s.nis] = { status: 'A', source: 'belum_progres' };
        }
        const body = { ...base, ...overrides, overrides: completeOverrides };
        const result = await request('/api/lms/journal/preview', body);
        if (result.httpStatus !== 200) throw new Error(JSON.stringify(result));
        return { ...body, snapshot_at: result.snapshot.snapshot_at, snapshot_hash: result.snapshot_hash, learning_receipt: result.learning_receipt, expected_revision: result.revision,
            confirm_update: result.revision > 0, confirm_attendance: true, request_id: webcrypto.randomUUID(), ttd: testSignature() };
    }
    return { sqlite, context, env, actor, request, base, signingBody };
}
module.exports = { journalHarness };
