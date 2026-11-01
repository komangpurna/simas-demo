const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { webcrypto } = require('node:crypto');
const { buildFlatWorkerSource } = require('./worker-source.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
const sampleQuiz = (overrides = {}) => ({ passing_grade: 70, time_limit_minutes: 10, allow_retake: 1,
    questions: [
        { id: 'a', type: 'mc', question: 'Pilih dua', options: ['Dua', 'Tiga'], correct_option: 0, points: 2, explanation: 'Kunci rahasia dua' },
        { id: 'b', type: 'short', question: 'Proses tumbuhan?', correct_answer: 'Fotosintesis', accepted_answers: ['proses fotosintesis'], points: 3 },
        { id: 'c', type: 'essay', question: 'Jelaskan alasanmu', points: 5, grading_guidance: 'Pedoman khusus guru' }
    ], ...overrides });

function harness(quiz = sampleQuiz(), { realLearningPath = false, minimumReadingSeconds = 0 } = {}) {
    const sqlite = new DatabaseSync(':memory:');
    for (const file of ['202609070002_add_lms_module.sql', '202609200001_add_lms_quiz.sql', '202609200002_lms_quiz_attempts.sql', '202610150001_lms_html_instructions.sql', '202610150002_lms_late_learning.sql', '202610150003_lms_minimum_reading.sql', '202610150005_lms_modules_packets.sql', '202610260001_lms_quiz_cbt_anti_cheat.sql']) sqlite.exec(read('cloudflare/migrations/' + file));
    sqlite.exec(`CREATE TABLE students(nis TEXT PRIMARY KEY, name TEXT, class TEXT, status TEXT, gender TEXT);
        CREATE TABLE student_photos(nis TEXT PRIMARY KEY, active_photo_url TEXT);
        INSERT INTO students(nis,name,class,status) VALUES ('100','Siswa Satu','X-1','active'),('200','Siswa Dua','X-1','active'),('300','Siswa Lain','X-2','active');
        INSERT INTO lms_topics(id,teacher_id,teacher_name,subject_name,class_name,title) VALUES ('topic','guru','Guru','IPA','X-1','Bab 1');`);
    const opensIso = new Date(Date.now() - 3600000).toISOString();
    const closesIso = new Date(Date.now() + 86400000).toISOString();
    sqlite.prepare(`INSERT INTO lms_materials(id,topic_id,teacher_id,teacher_name,subject_name,class_name,title,resource_type,quiz_payload,publish_at,due_date)
        VALUES ('mat','topic','guru','Guru','IPA','X-1','Latihan','quiz',?,?,?)`).run(JSON.stringify(quiz), opensIso, closesIso);
    sqlite.prepare('UPDATE lms_materials SET minimum_read_seconds=?').run(minimumReadingSeconds);
    const queries = [];
    const prepare = (sql, args = []) => ({ sql, args, bind: (...values) => prepare(sql, values),
        first: async () => sqlite.prepare(sql).get(...args) || null,
        all: async () => { queries.push({ sql, args }); return { results: sqlite.prepare(sql).all(...args) }; },
        run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }) });
    const DB = { prepare, batch: async statements => {
        sqlite.exec('BEGIN');
        try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    } };
    const context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, TextEncoder, TextDecoder,
        crypto: webcrypto, console: { log() {}, warn() {}, error() {} }, actor: { nis: '100' }, locked: false });
    vm.runInContext(buildFlatWorkerSource().replace('export default {', 'globalThis.worker = {'), context);
    // Auth/session helpers have separate tests. Use the real handlers and SQLite after that boundary.
    vm.runInContext(`verifyFirebaseToken = async () => actor?.uid ? { valid: true, user: { role: 'guru_mapel', ...actor } } : { valid: false };
        getVerifiedStudentSession = async () => actor?.nis ? { nis: actor.nis } : null;
        getVerifiedStudentIdentity = () => null;
        authorizeLmsEditor = async () => ({ allowed: !!actor?.uid, status: actor?.uid ? 200 : 403, user: actor || {} });`, context);
    if (!realLearningPath) vm.runInContext(`getStudentLmsLearningPath = async () => ({ materials: [{ id: 'mat', is_locked: locked }] });`, context);
    async function call(action, body = {}, actor = { nis: '100' }) {
        context.actor = actor;
        const route = action === 'list' ? '/api/lms/quiz/attempts' : action === 'review' ? '/api/lms/quiz/review' : action === 'unlock' ? '/api/lms/quiz/unlock' : action === 'reset' ? '/api/lms/quiz/reset' : action === 'copy' ? '/api/lms/copy-from-class' : ['material', 'materials'].includes(action) ? '/api/lms/materials' : action === 'track' ? '/api/lms/student/track' : action === 'courses' ? '/api/lms/student/courses' : `/api/lms/student/quiz/${action}`;
        const schedule = ['material', 'copy'].includes(action) ? { publish_at: new Date(Date.now() - 3600000).toISOString(), due_date: new Date(Date.now() + 86400000).toISOString() } : {};
        const params = { material_id: 'mat', ...schedule, ...body };
        const isGet = ['list', 'materials', 'courses'].includes(action);
        const url = `https://worker.test${route}` + (isGet ? '?' + new URLSearchParams(params) : '');
        const response = await context.worker.fetch(new Request(url, isGet ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) }), { DB, LMS_MINIMUM_READING_SECONDS: minimumReadingSeconds }, {});
        return { status: response.status, ...await response.json() };
    }
    return { sqlite, context, call, queries, env: { DB, LMS_MINIMUM_READING_SECONDS: minimumReadingSeconds },
        submit: (a, answers = {}) => call('submit', { attempt_id: a.id, revision: a.revision, answers }),
        review: (a, marks) => call('review', { attempt_id: a.id, revision: a.revision, marks }, { uid: 'guru' }),
        unlock: (a) => call('unlock', { attempt_id: a.id }, { uid: 'guru' }),
        reset: (a) => call('reset', { attempt_id: a.id }, { uid: 'guru' }),
        violation: (a, type = 'tab_switch', duration = 5) => call('violation', { attempt_id: a.id, violation_type: type, duration_seconds: duration }),
        progress: () => sqlite.prepare("SELECT * FROM lms_progress WHERE material_id = 'mat' AND student_nis = '100'").get() };
}

module.exports = { harness, sampleQuiz, read };
