/** @jest-environment node */
import { jest } from '@jest/globals';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as acorn from 'acorn';
import { JSDOM } from 'jsdom';
import { formatLmsScheduleTime, getLmsScheduleState, normalizeLmsScheduleTime, validateLmsSchedule } from '../js/lms-schedule.mjs';
import { calculateDueDateUrgency } from '../js/utils.mjs';
const require = createRequire(import.meta.url);
const { harness } = require('./helpers/lms-quiz-harness.cjs');

const opens = '2026-10-15T08:00';
const closes = '2026-10-15T10:30';
const schedule = validateLmsSchedule(opens, closes);
const payload = { id: 'mat', topic_id: 'topic', subject_name: 'IPA', class_name: 'X-1', title: 'Belajar Terjadwal', resource_type: 'text', content_description: 'Materi rahasia sebelum jadwal buka', allow_discussion: 1, discussion_prompt: 'Jelaskan hasil belajar', ...schedule };

test('WITA is independent of device timezone; both times are mandatory and closing must be later', () => {
    expect(schedule).toEqual({ publish_at: '2026-10-15T00:00:00.000Z', due_date: '2026-10-15T02:30:00.000Z' });
    expect(normalizeLmsScheduleTime('2026-02-30T08:00')).toBe('');
    for (const pair of [['', closes], [opens, ''], [opens, '2026-10-15'], [opens, opens], [closes, opens]]) {
        expect(() => validateLmsSchedule(...pair)).toThrow();
    }
    expect(formatLmsScheduleTime(schedule.due_date)).toMatch(/10[.:]30.*WITA/);
    const material = { is_published: 2, ...schedule };
    expect(getLmsScheduleState(material, Date.parse(schedule.publish_at) - 1).state).toBe('scheduled');
    expect(getLmsScheduleState(material, Date.parse(schedule.publish_at)).state).toBe('open');
    expect(getLmsScheduleState(material, Date.parse(schedule.due_date))).toMatchObject({ state: 'review', isAccessible: true, teachingCompleted: true });
    expect(calculateDueDateUrgency(schedule.due_date, false, schedule.due_date)).toMatchObject({ level: 'overdue', daysRemaining: 0 });
});

describe('real Worker and SQLite enforce the teacher-controlled access window', () => {
    let h;
    beforeEach(() => { h = harness(undefined, { realLearningPath: true }); });
    afterEach(() => h?.sqlite.close());
    const clock = millis => vm.runInContext(`Date.now = () => ${millis};`, h.context);
    async function request(route, body, actor = { nis: '100' }) {
        h.context.actor = actor;
        const response = await h.context.worker.fetch(new Request(`https://worker.test/api/lms/${route}`, body ? {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        } : {}), h.env, {});
        return { httpStatus: response.status, ...await response.json() };
    }
    test('save and copy reject incomplete/reversed schedules; status is always scheduled', async () => {
        for (const invalid of [{ publish_at: '' }, { due_date: '' }, { due_date: '2026-10-15' }, { due_date: schedule.publish_at }]) {
            expect((await request('materials', { ...payload, ...invalid }, { uid: 'guru' })).httpStatus).toBe(400);
        }
        expect((await request('materials', { ...payload, is_published: 1 }, { uid: 'guru' })).httpStatus).toBe(200);
        expect(h.sqlite.prepare("SELECT is_published, publish_at, due_date FROM lms_materials WHERE id='mat'").get()).toMatchObject({ is_published: 2, ...schedule });
        const copy = { source_class: 'X-1', target_class: 'X-2', subject_name: 'IPA' };
        expect((await request('copy-from-class', copy, { uid: 'guru' })).httpStatus).toBe(400);
        expect((await request('copy-from-class', { ...copy, ...schedule, copy_mode: 'draft' }, { uid: 'guru' })).httpStatus).toBe(200);
        expect(h.sqlite.prepare("SELECT is_published,publish_at,due_date FROM lms_materials WHERE class_name='X-2'").get()).toMatchObject({ is_published: 2, ...schedule });
    });
    test('students see no protected content before opening, then retain learning access after the target', async () => {
        await request('materials', payload, { uid: 'guru' });
        clock(Date.parse(schedule.publish_at) - 1);
        let courses = await request('student/courses');
        expect(courses.materials[0]).toMatchObject({ is_locked: true, schedule_state: 'scheduled', content_description: '', resource_url: '', discussion_prompt: '', ...schedule });
        expect((await request('student/track', { material_id: 'mat', action: 'open' })).httpStatus).toBe(404);
        clock(Date.parse(schedule.publish_at));
        courses = await request('student/courses');
        expect(courses.materials[0]).toMatchObject({ is_locked: false, schedule_state: 'open', content_description: payload.content_description });
        expect((await request('student/track', { material_id: 'mat', action: 'open', session_id: 'scheduled-session' })).httpStatus).toBe(200);
        expect((await request('discussions', { material_id: 'mat', content: 'Tanggapan tepat waktu' })).httpStatus).toBe(200);
        clock(Date.parse(schedule.due_date));
        courses = await request('student/courses');
        expect(courses.materials[0]).toMatchObject({ is_locked: false, schedule_state: 'review', requirement_met: true, content_description: payload.content_description });
        for (const action of ['open', 'complete', 'sync_duration']) expect((await request('student/track', { material_id: 'mat', action })).httpStatus).toBe(200);
        expect((await request('discussions', { material_id: 'mat', content: 'Tanggapan tambahan' })).httpStatus).toBe(200);
        expect((await request('discussions/mat')).httpStatus).toBe(200);
        expect((await request('materials/mat/progress', null, { uid: 'guru' })).httpStatus).toBe(200);
        // Teacher can reopen by extending the window; students regain access on refresh.
        await request('materials', { ...payload, due_date: '2026-10-15T11:30+08:00' }, { uid: 'guru' });
        expect((await request('student/courses')).materials[0].is_locked).toBe(false);
    });
    test('quiz retains its own time allowance after the module target; it cannot start before opening', async () => {
        h.sqlite.prepare("UPDATE lms_materials SET is_published=2,publish_at=?,due_date=? WHERE id='mat'").run(schedule.publish_at, schedule.due_date);
        clock(Date.parse(schedule.publish_at) - 1);
        expect((await h.call('start')).status).toBe(403);
        clock(Date.parse(schedule.due_date) - 60000);
        const { attempt } = await h.call('start');
        expect(attempt.id).toBeTruthy();
        clock(Date.parse(schedule.due_date));
        expect((await h.call('start')).status).toBe(200);
        const saved = await h.call('save', { attempt_id: attempt.id, revision: attempt.revision, answers: { a: 0 } });
        expect(saved.status).toBe(200);
        const submitted = await h.submit({ ...attempt, revision: saved.revision }, { a: 0 });
        expect(submitted.status).toBe(200);
        expect(submitted.attempt.status).toBe('pending_review');
        expect(h.progress()).toMatchObject({ status: 'opened', quiz_score: null });
        expect(h.progress().late_started_at).toBeTruthy();
    });
});

test('teacher edit retains hours, closing input is datetime-local, and the student card shows both times', () => {
    const window = new JSDOM('').window;
    const markup = new window.DOMParser().parseFromString(fs.readFileSync('guru-mapel.html', 'utf8'), 'text/html');
    expect(markup.getElementById('select-lms-material-published').type).toBe('hidden');
    for (const id of ['input-lms-material-publish-at', 'input-lms-material-due', 'input-lms-copy-publish-at', 'input-lms-copy-due']) {
        expect(markup.getElementById(id).type).toBe('datetime-local');
        expect(markup.getElementById(id).required).toBe(true);
    }
    const teacher = fs.readFileSync('js/page-guru-mapel.js', 'utf8');
    expect(teacher).toContain('formatToDatetimeLocal(normalizeLmsScheduleTime(mat.due_date, true))');
    const source = fs.readFileSync('js/page-portal-siswa.js', 'utf8');
    const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const node = ast.body.find(n => n.type === 'FunctionDeclaration' && source.slice(n.start, n.end).includes('const openMaterialHandler'));
    window.escapeHTML = value => String(value);
    const render = new Function('window', 'getLmsScheduleState', 'formatLmsScheduleTime', 'calculateDueDateUrgency', `const studentLmsClockOffset=0;${source.slice(node.start, node.end)};return ${node.id.name};`)(window, getLmsScheduleState, formatLmsScheduleTime, calculateDueDateUrgency);
    jest.useFakeTimers();
    try {
        jest.setSystemTime(Date.parse(schedule.publish_at) - 1);
        let card = render({ ...payload, is_published: 2 });
        expect(card).toContain('Belum Dibuka');
        expect(card).toContain('Buka:');
        expect(card).toContain('Target selesai:');
        expect(card).not.toContain('onclick="window.openStudent');
        jest.setSystemTime(Date.parse(schedule.due_date));
        card = render({ ...payload, is_published: 2 });
        expect(card).toContain('Selesai Dibahas');
        expect(card).toContain('onclick="window.openStudent');
        expect(card).toContain('tanpa potongan nilai otomatis');
    } finally { jest.useRealTimers(); window.close(); }
});

test('an open reading session and its answers remain open at the target while LMS refreshes', async () => {
    const source = fs.readFileSync('js/page-portal-siswa.js', 'utf8');
    const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'applyStudentLmsSchedule');
    const activeMaterial = { ...payload, is_published: 2, is_locked: false };
    const window = { closeStudentResourceModal: jest.fn(), expireStudentLmsQuiz: jest.fn(() => false), showPopup: jest.fn() };
    const refresh = jest.fn(async () => true);
    const render = jest.fn();
    jest.useFakeTimers();
    try {
        jest.setSystemTime(Date.parse(schedule.due_date) - 1000);
        const apply = new Function('getLmsScheduleState', 'window', 'processAndRenderStudentLms', 'loadStudentLmsData', 'currentStudentResourceMaterial',
            `let studentLmsClockOffset=0, studentLmsScheduleTimer=null;const currentReadingStudentMaterial=null,activeStudentDiscussionMaterialId=null;${source.slice(node.start, node.end)};return applyStudentLmsSchedule;`)(getLmsScheduleState, window, render, refresh, activeMaterial);
        apply({ materials: [activeMaterial] });
        expect(window.closeStudentResourceModal).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1050);
        expect(window.closeStudentResourceModal).not.toHaveBeenCalled();
        expect(refresh).toHaveBeenCalledWith(true);
        expect(render).toHaveBeenCalled();
    } finally { jest.clearAllTimers(); jest.useRealTimers(); }
});
