/** @jest-environment node */
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { decorateLmsTeachingState, getLmsScheduleState } from '../js/lms-schedule.mjs';
const require = createRequire(import.meta.url);
const { harness, sampleQuiz, read } = require('./helpers/lms-quiz-harness.cjs');
const { DatabaseSync } = require('node:sqlite');
const base = Date.now() - 3600000;
const iso = offset => new Date(base + offset).toISOString();
const teacher = { uid: 'guru' };
const material = { id: 'mat', topic_id: 'topic', class_name: 'X-1', subject_name: 'IPA', title: 'Materi susulan',
    resource_type: 'text', content_description: 'Baca dan pelajari', allow_discussion: 1, discussion_prompt: 'Apa hasil belajarmu?',
    publish_at: iso(-3600000), due_date: iso(10000) };

describe('late learning through the real Worker and SQLite', () => {
    let h;
    beforeEach(() => { h = harness(undefined, { realLearningPath: true }); clock(0); });
    afterEach(() => h.sqlite.close());
    function clock(offset) { vm.runInContext(`Date.now = () => ${base + offset}`, h.context); }
    async function request(route, body, actor = { nis: '100' }) {
        h.context.actor = actor;
        const response = await h.context.worker.fetch(new Request(`https://worker.test/api/lms/${route}`, body ? {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        } : {}), h.env, {});
        return { ...await response.json(), status: response.status };
    }
    const open = actor => request('student/track', { material_id: 'mat', action: 'open' }, actor);
    const reply = actor => request('discussions', { material_id: 'mat', content: 'Saya sudah memahami materinya.' }, actor);

    test('expired lessons remain accessible, unfinished catch-up is marked in progress and both matrix scopes', async () => {
        expect((await request('materials', material, teacher)).status).toBe(200);
        clock(10000);
        const courses = await request('student/courses');
        expect(courses.materials[0]).toMatchObject({ is_locked: false, is_teaching_completed: 1, schedule_state: 'review', teaching_completed_at: iso(10000) });
        expect(courses.topics[0].is_teaching_completed).toBe(true);
        expect((await open()).status).toBe(200);
        expect((await reply()).status).toBe(200);
        expect(h.progress()).toMatchObject({ status: 'completed', late_started_at: iso(10000), late_cutoff_at: iso(10000) });
        const progress = await request('materials/mat/progress', null, teacher);
        expect(progress).toMatchObject({ status: 200, summary: { late_count: 1, completed_count: 1 } });
        expect(progress.data.find(s => s.nis === '100')).toMatchObject({ status: 'completed', is_late: true });
        for (const suffix of ['', '&material_id=mat']) {
            const matrix = await request('analytics/class?class=X-1&subject=IPA' + suffix, null, teacher);
            expect(matrix.status).toBe(200);
            expect(matrix.data.find(s => s.nis === '100')).toMatchObject({ is_late: true, late_count: 1 });
        }
        const saved = h.progress().late_started_at;
        clock(20000); await open();
        expect(h.progress().late_started_at).toBe(saved);
    });

    test('manual early completion uses server time, permits catch-up, and does not penalize finished students revisiting', async () => {
        await request('materials', material, teacher);
        await open(); await reply();
        await open({ nis: '200' }); // Opened but no required discussion yet.
        clock(1000);
        expect((await request('materials', { ...material, is_teaching_completed: 1, teaching_completed_at: iso(-99999) }, teacher)).status).toBe(200);
        expect(h.sqlite.prepare("SELECT teaching_completed_at FROM lms_materials WHERE id='mat'").get().teaching_completed_at).toBe(iso(1000));
        clock(2000);
        await request('materials', { ...material, is_teaching_completed: 1, title: 'Sunting biasa' }, teacher);
        expect(h.sqlite.prepare("SELECT teaching_completed_at FROM lms_materials WHERE id='mat'").get().teaching_completed_at).toBe(iso(1000));
        await open(); await reply();
        expect(h.progress().late_started_at).toBe('');
        expect((await reply({ nis: '200' })).status).toBe(200);
        expect(h.sqlite.prepare("SELECT late_cutoff_at FROM lms_progress WHERE student_nis='200'").get().late_cutoff_at).toBe(iso(1000));
    });

    test('reactivation requires a future target, clears the manual boundary, and keeps answers and late history', async () => {
        await request('materials', { ...material, is_teaching_completed: 1 }, teacher);
        clock(1000); await open(); await reply();
        const before = h.progress();
        clock(20000);
        const denied = await request('materials', { ...material, is_teaching_completed: 0 }, teacher);
        expect(denied.status).toBe(400); expect(denied.error).toMatch(/target selesai baru/);
        const reopened = { ...material, is_teaching_completed: 0, due_date: iso(60000) };
        expect((await request('materials', reopened, teacher)).status).toBe(200);
        expect(h.sqlite.prepare("SELECT is_teaching_completed,teaching_completed_at FROM lms_materials WHERE id='mat'").get()).toEqual({ is_teaching_completed: 0, teaching_completed_at: '' });
        expect((await request('student/courses')).materials[0]).toMatchObject({ schedule_state: 'open', is_teaching_completed: 0 });
        expect(h.progress().late_started_at).toBe(before.late_started_at);
        expect(h.progress().status).toBe('completed');
        expect(h.sqlite.prepare('SELECT COUNT(*) n FROM lms_discussions').get().n).toBe(1);
        await open({ nis: '200' });
        expect(h.sqlite.prepare("SELECT late_started_at FROM lms_progress WHERE student_nis='200'").get().late_started_at).toBe('');
        clock(60000);
        expect((await request('student/courses')).materials[0]).toMatchObject({ schedule_state: 'review', is_teaching_completed: 1 });
    });

    test('late quiz completion uses normal grading and retains the attempt timer and revision guard', async () => {
        const quiz = sampleQuiz({ questions: sampleQuiz().questions.slice(0, 2) });
        await request('materials', { ...material, resource_type: 'quiz', allow_discussion: 0, quiz_payload: JSON.stringify(quiz) }, teacher);
        clock(10000);
        const start = await h.call('start');
        expect(start.status).toBe(200);
        expect(Date.parse(start.attempt.expires_at) - (base + 10000)).toBe(600000);
        const saved = await h.call('save', { attempt_id: start.attempt.id, revision: start.attempt.revision, answers: { a: 0, b: 'Fotosintesis' } });
        expect(saved.status).toBe(200);
        expect((await h.submit(start.attempt, { a: 0 })).status).toBe(409);
        const result = await h.submit({ ...start.attempt, revision: saved.revision }, { a: 0, b: 'Fotosintesis' });
        expect(result.status).toBe(200);
        expect(result.attempt.result).toMatchObject({ score: 100, passed: true });
        expect(JSON.parse(h.progress().quiz_answers).submitted_late).not.toBe(true);
        expect(h.progress()).toMatchObject({ status: 'completed', quiz_score: 100, late_cutoff_at: iso(10000) });
    });

    test('on-time quiz awaiting teacher review is protected even when graded and revisited after the target', async () => {
        await request('materials', { ...material, resource_type: 'quiz', allow_discussion: 0, quiz_payload: JSON.stringify(sampleQuiz()) }, teacher);
        const { attempt } = await h.call('start');
        const submitted = await h.submit(attempt, { a: 0, b: 'Fotosintesis', c: 'Penjelasan' });
        expect(submitted.attempt.status).toBe('pending_review');
        clock(20000); await open();
        expect(h.progress().late_started_at).toBe('');
        const reviewed = await h.review(submitted.attempt, { a: { points: 2 }, b: { points: 3 }, c: { points: 5 } });
        expect(reviewed.status).toBe(200);
        await open();
        expect(h.progress()).toMatchObject({ status: 'completed', quiz_score: 100, late_started_at: '' });
    });

    test('access controls and sequential prerequisites still apply; the client cannot forge timeliness', async () => {
        await request('materials', material, teacher); clock(20000);
        expect((await open({ nis: '300' })).status).toBe(403);
        expect((await request('materials', { ...material, title: 'Palsu' }, { nis: '100' })).status).toBe(403);
        const forged = await request('student/track', { material_id: 'mat', action: 'open', student_nis: '200', late_started_at: '', late_cutoff_at: iso(99999) });
        expect(forged.status).toBe(403);
        expect(h.progress()).toBeUndefined();
        expect((await request('student/track', { material_id: 'mat', action: 'open', late_started_at: '', late_cutoff_at: iso(99999) })).status).toBe(200);
        expect(h.progress().late_cutoff_at).toBe(iso(10000));
        const second = await request('materials', { ...material, id: undefined, order_index: 2, due_date: iso(15000) }, teacher);
        expect(second.status).toBe(200);
        expect((await request('student/track', { material_id: second.id, action: 'open' })).status).toBe(409);
        h.sqlite.exec("UPDATE lms_materials SET is_published=0 WHERE id='mat'");
        expect((await open()).status).toBe(404);
    });

    test('copies start their own teaching cycle instead of inheriting manual completion', async () => {
        await request('materials', { ...material, is_teaching_completed: 1 }, teacher);
        const copied = await request('copy-from-class', { source_class: 'X-1', target_class: 'X-2', subject_name: 'IPA', publish_at: iso(30000), due_date: iso(60000) }, teacher);
        expect(copied.status).toBe(200);
        expect(h.sqlite.prepare("SELECT is_teaching_completed,teaching_completed_at FROM lms_materials WHERE class_name='X-2'").get()).toEqual({ is_teaching_completed: 0, teaching_completed_at: '' });
    });

    test('a malformed legacy schedule with a future opening does not finish its topic prematurely', async () => {
        h.sqlite.prepare("UPDATE lms_materials SET is_published=2,publish_at=?,due_date=? WHERE id='mat'").run(iso(60000), iso(10000));
        clock(20000);
        const courses = await request('student/courses');
        expect(courses.materials[0]).toMatchObject({ is_locked: true, schedule_state: 'scheduled', is_teaching_completed: 0 });
        expect(courses.topics[0].is_teaching_completed).toBe(false);
    });
});

test('effective completion survives DTO decoration and respects WITA legacy dates', () => {
    const auto = { ...material, is_published: 2 };
    const decorated = decorateLmsTeachingState(auto, base + 10000);
    expect(getLmsScheduleState(decorated, base + 10000)).toMatchObject({ teachingCompleted: true, teachingSource: 'deadline', cutoffAt: iso(10000) });
    expect(getLmsScheduleState({ ...auto, due_date: '2026-10-15' }, Date.parse('2026-10-15T16:00:00Z')).cutoffAt).toBe('2026-10-15T15:59:59.999Z');
});

test('deployment migration immediately updates old overdue lessons without resetting quiz answers or own timers', () => {
    const db = new DatabaseSync(':memory:');
    try {
        for (const file of ['202609070002_add_lms_module.sql', '202609200001_add_lms_quiz.sql', '202609200002_lms_quiz_attempts.sql', '202610150001_lms_html_instructions.sql']) db.exec(read('cloudflare/migrations/' + file));
        db.exec("INSERT INTO lms_topics(id,teacher_id,teacher_name,subject_name,class_name,title) VALUES ('topic','guru','Guru','IPA','X-1','Bab 1')");
        const now = Date.now(), past = new Date(now - 60000).toISOString(), future = new Date(now + 60000).toISOString();
        for (const [id, state, due] of [['expired', 2, past], ['future', 2, future], ['manual', 2, future], ['draft', 0, past]]) {
            db.prepare(`INSERT INTO lms_materials(id,topic_id,teacher_id,teacher_name,subject_name,class_name,title,is_published,publish_at,due_date) VALUES (?,'topic','guru','Guru','IPA','X-1',?,?,?,?)`).run(id, id, state, new Date(now - 3600000).toISOString(), due);
        }
        const start = new Date(now - 120000).toISOString();
        db.prepare(`INSERT INTO lms_quiz_attempts(id,material_id,student_nis,student_name,student_class,quiz_snapshot,answers,started_at,expires_at) VALUES ('attempt','expired','100','Siswa','X-1',?,'{"a":0}',?,?)`).run(JSON.stringify(sampleQuiz()), start, past);
        db.prepare(`INSERT INTO lms_quiz_attempts(id,material_id,student_nis,student_name,student_class,quiz_snapshot,started_at,expires_at) VALUES ('unlimited','expired','200','Siswa','X-1',?,?,?)`).run(JSON.stringify(sampleQuiz({ time_limit_minutes: 0 })), start, past);
        db.prepare(`INSERT INTO lms_quiz_attempts(id,material_id,student_nis,student_name,student_class,quiz_snapshot,started_at,expires_at) VALUES ('old-invalid','expired','300','Siswa','X-1','{',?,?)`).run(start, past);
        db.exec(`INSERT INTO lms_progress(id,material_id,topic_id,student_nis,student_name,student_class,status,quiz_score,quiz_answers) VALUES ('progress','expired','topic','100','Siswa','X-1','completed',100,'{"saved":true}')`);
        db.exec("UPDATE lms_materials SET is_teaching_completed=1 WHERE id='manual'");
        db.exec(read('cloudflare/migrations/202610150002_lms_late_learning.sql'));
        expect(db.prepare("SELECT is_teaching_completed,teaching_completed_at FROM lms_materials WHERE id='expired'").get()).toEqual({ is_teaching_completed: 1, teaching_completed_at: past });
        expect(db.prepare("SELECT is_teaching_completed FROM lms_materials WHERE id='draft'").get().is_teaching_completed).toBe(0);
        expect(db.prepare("SELECT is_teaching_completed FROM lms_materials WHERE id='future'").get().is_teaching_completed).toBe(0);
        expect(db.prepare("SELECT teaching_completed_at FROM lms_materials WHERE id='manual'").get().teaching_completed_at).toBeTruthy();
        const attempt = db.prepare("SELECT * FROM lms_quiz_attempts WHERE id='attempt'").get();
        expect(attempt.answers).toBe('{"a":0}'); expect(attempt.started_at).toBe(start);
        expect(Date.parse(attempt.expires_at) - Date.parse(start)).toBe(600000);
        expect(db.prepare("SELECT expires_at FROM lms_quiz_attempts WHERE id='unlimited'").get().expires_at).toBeNull();
        expect(db.prepare("SELECT expires_at FROM lms_quiz_attempts WHERE id='old-invalid'").get().expires_at).toBe(past);
        expect(db.prepare('SELECT status,quiz_score,quiz_answers,late_started_at FROM lms_progress').get()).toEqual({ status: 'completed', quiz_score: 100, quiz_answers: '{"saved":true}', late_started_at: '' });
    } finally { db.close(); }
});
