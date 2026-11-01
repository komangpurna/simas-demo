/** @jest-environment node */
import { jest } from '@jest/globals';
import vm from 'node:vm';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
const require = createRequire(import.meta.url);
const { harness, sampleQuiz, read } = require('./helpers/lms-quiz-harness.cjs');
const { DatabaseSync } = require('node:sqlite');
let h, start;
beforeEach(() => { h = harness(undefined, { realLearningPath: true, minimumReadingSeconds: 300 }); start = Date.now(); clock(0); });
afterEach(() => { h.sqlite.close(); jest.clearAllTimers(); jest.useRealTimers(); });
function clock(seconds) { vm.runInContext(`Date.now=()=>${start + seconds * 1000}`, h.context); }
async function api(route, body, teacher = false) {
    h.context.actor = teacher ? { uid: 'guru' } : { nis: '100' };
    const res = await h.context.worker.fetch(new Request('https://worker.test/api/lms/' + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), h.env, {});
    return { ...await res.json(), httpStatus: res.status };
}
async function material(overrides = {}) {
    return api('materials', { id: 'mat', topic_id: 'topic', class_name: 'X-1', subject_name: 'IPA', title: 'Lima menit', resource_type: 'html', content_description: '<h1>Belajar</h1>',
        allow_discussion: 1, discussion_prompt: 'Apa hasilnya?', publish_at: new Date(start - 3600000).toISOString(), due_date: new Date(start + 3600000).toISOString(), ...overrides }, true);
}
const track = body => api('student/track', { material_id: 'mat', ...body });
const open = session => track({ action: 'open', session_id: session || 's1' });
const sync = (seconds, session = 's1') => track({ action: 'sync_duration', session_id: session, session_seconds: seconds, reading_complete: true });
const reply = () => api('discussions', { material_id: 'mat', content: 'Saya memahami materi.' });
async function current() { return (await api('student/courses')).materials.find(m => m.id === 'mat'); }

test('server requires 300 active seconds, rejects immediate duration inflation, and opens discussion and the next module only after all prerequisites', async () => {
    expect((await material()).httpStatus).toBe(200);
    const next = await material({ id: undefined, title: 'Berikutnya', order_index: 2, minimum_read_seconds: 0 });
    await open();
    expect(await current()).toMatchObject({ is_opened: true, reading_complete: false, reading_required_seconds: 300, requirement_met: false });
    expect((await sync(99999)).active_seconds_total).toBe(0);
    expect((await reply()).httpStatus).toBe(409);
    expect((await track({ action: 'complete', reading_complete: true })).httpStatus).toBe(409);
    clock(299); expect((await sync(299)).reading_complete).toBe(false);
    clock(300); expect((await sync(300)).reading_complete).toBe(true);
    expect((await reply()).httpStatus).toBe(200);
    expect(await current()).toMatchObject({ reading_complete: true, requirement_met: true });
    const courses = await api('student/courses');
    expect(courses.materials.find(m => m.id === next.id).is_locked).toBe(false);
    expect(courses.materials.find(m => m.id === next.id).reading_required_seconds).toBe(300);
    const progress = await api('materials/mat/progress', null, true);
    expect(progress.data.find(s => s.nis === '100')).toMatchObject({ status: 'completed', reading_complete: true });
});

test('wall-clock waiting does not finish internal reading, and several visits retain active time without restarting the requirement', async () => {
    await material(); await open();
    clock(600); expect((await current()).reading_complete).toBe(false);
    expect((await sync(120)).reading_complete).toBe(false);
    await open('s2');
    clock(780); expect((await sync(180, 's2')).reading_complete).toBe(true);
    expect(h.progress().active_seconds_total).toBe(300);
    await open('s3'); expect((await current()).reading_complete).toBe(true);
});

test('external links use the first access timestamp and cannot finish before five server minutes', async () => {
    await material({ resource_type: 'link', content_description: 'Buka situs', resource_url: 'https://kuispengimbasan.my.canva.site/latihan' });
    await open(); clock(299);
    expect(await current()).toMatchObject({ reading_mode: 'external', reading_complete: false, reading_remaining_seconds: 1 });
    expect((await reply()).httpStatus).toBe(409);
    await open('return'); clock(300);
    expect(await current()).toMatchObject({ reading_complete: true, reading_active_seconds: 0 });
    expect((await reply()).httpStatus).toBe(200);
});

test('quizzes use grading instead of waiting five minutes', async () => {
    await material({ resource_type: 'quiz', allow_discussion: 0, quiz_payload: JSON.stringify(sampleQuiz({ questions: sampleQuiz().questions.slice(0, 1) })) });
    const { attempt } = await h.call('start');
    expect((await current()).reading_required_seconds).toBe(0);
    const submitted = await h.submit(attempt, { a: 0 });
    expect(submitted.attempt.result.passed).toBe(true);
    expect((await current()).requirement_met).toBe(true);
});

test('finishing the reading minimum after the teaching cutoff is late even if the first opening was on time', async () => {
    await material({ allow_discussion: 0, due_date: new Date(start + 150000).toISOString() });
    await open(); clock(300); await sync(300);
    expect(h.progress().late_started_at).toBeTruthy();
    expect(h.progress().reading_completed_at).toBe(new Date(start + 300000).toISOString());
});

test('required quiz discussion is unlocked by passing the quiz rather than merely starting it', async () => {
    await material({ resource_type: 'quiz', quiz_payload: JSON.stringify(sampleQuiz({ questions: sampleQuiz().questions.slice(0, 1) })) });
    const { attempt } = await h.call('start');
    expect((await reply()).httpStatus).toBe(409);
    expect((await api('discussions/mat')).httpStatus).toBe(409);
    await h.submit(attempt, { a: 0 });
    expect((await reply()).httpStatus).toBe(200);
    expect((await current()).requirement_met).toBe(true);
});

test('completed work remains valid when a minimum is introduced', async () => {
    await material(); await open();
    h.sqlite.exec("UPDATE lms_progress SET status='completed',completed_at=first_opened_at");
    expect((await current()).reading_complete).toBe(true);
});

test('the deployment migration keeps completed answers and durations and adds a stable reading verification timestamp', () => {
    const db = new DatabaseSync(':memory:');
    try {
        for (const migration of ['202609070002_add_lms_module.sql', '202609200001_add_lms_quiz.sql', '202609200002_lms_quiz_attempts.sql', '202610150001_lms_html_instructions.sql', '202610150002_lms_late_learning.sql']) db.exec(read('cloudflare/migrations/' + migration));
        db.exec(`INSERT INTO lms_topics(id,teacher_id,teacher_name,subject_name,class_name,title) VALUES ('t','guru','Guru','IPA','X-1','Bab');
            INSERT INTO lms_materials(id,topic_id,teacher_id,teacher_name,subject_name,class_name,title) VALUES ('m','t','guru','Guru','IPA','X-1','Materi');
            INSERT INTO lms_progress(id,material_id,topic_id,student_nis,student_name,student_class,status,first_opened_at,completed_at,active_seconds_total,quiz_answers)
            VALUES ('p','m','t','100','Siswa','X-1','completed','2026-10-15T00:00:00Z','2026-10-15T00:06:00Z',360,'{"saved":true}')`);
        db.exec(read('cloudflare/migrations/202610150003_lms_minimum_reading.sql'));
        expect(db.prepare('SELECT minimum_read_seconds FROM lms_materials').get().minimum_read_seconds).toBe(300);
        expect(db.prepare('SELECT reading_completed_at,active_seconds_total,quiz_answers,status FROM lms_progress').get()).toEqual({ reading_completed_at: '2026-10-15T00:06:00Z', active_seconds_total: 360, quiz_answers: '{"saved":true}', status: 'completed' });
    } finally { db.close(); }
});

test('the real tracker pauses when hidden and verifies at 300 active seconds without closing the exercise', async () => {
    jest.useFakeTimers();
    const dom = new JSDOM('<div><span id="student-resource-note"></span></div>', { pretendToBeVisual: true });
    let visibility = 'visible';
    Object.defineProperty(dom.window.document, 'visibilityState', { get: () => visibility });
    const source = fs.readFileSync('js/page-portal-siswa.js', 'utf8');
    const tracker = source.slice(source.indexOf('let lmsActiveSession = null;'), source.indexOf('async function trackStudentItemOpened'));
    const trackApi = jest.fn(async body => ({ reading_complete: body.session_seconds >= 300 }));
    const refresh = jest.fn(async () => true);
    const deps = { window: dom.window, document: dom.window.document, currentNIS: '100', currentStudent: { nis: '100' },
        writeLmsHtmlSession: () => {}, lmsHtmlRevision: () => 'rev', clearLmsHtmlSession: () => {}, cfTrackLmsStudentProgress: trackApi, loadStudentLmsData: refresh };
    const startSession = new Function(...Object.keys(deps), tracker + ';return startLmsActiveSession;')(...Object.values(deps));
    startSession({ id: 'mat', resource_type: 'html', reading_required_seconds: 300, reading_complete: false }, 's1');
    await jest.advanceTimersByTimeAsync(120000);
    visibility = 'hidden'; dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    await jest.advanceTimersByTimeAsync(600000);
    expect(trackApi.mock.calls.every(([body]) => body.session_seconds <= 120)).toBe(true);
    visibility = 'visible'; dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    await jest.advanceTimersByTimeAsync(180000);
    expect(trackApi.mock.calls.some(([body]) => body.session_seconds === 300)).toBe(true);
    expect(refresh).toHaveBeenCalled();
    expect(dom.window.document.querySelector('[data-lms-reading-progress]').textContent).toContain('terpenuhi');
    dom.window.close();
});
