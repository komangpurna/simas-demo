/** @jest-environment node */
import { jest } from '@jest/globals';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import * as acorn from 'acorn';
import { JSDOM } from 'jsdom';
import { validateLmsSchedule, getLmsScheduleState, normalizeLmsScheduleTime, formatLmsScheduleTime } from '../js/lms-schedule.mjs';
import { calculateDueDateUrgency } from '../js/utils.mjs';
import { validateLmsHtml } from '../js/lms-html.mjs';
const require = createRequire(import.meta.url);
const { harness } = require('./helpers/lms-quiz-harness.cjs');
const teacher = fs.readFileSync('js/page-guru-mapel.js', 'utf8');
const student = fs.readFileSync('js/page-portal-siswa.js', 'utf8');
function extract(source, names) {
    return acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.filter(n =>
        n.type === 'FunctionDeclaration' ? names.includes(n.id.name) : n.type === 'ExpressionStatement' && names.includes(n.expression.left?.property?.name))
        .map(n => source.slice(n.start, n.end)).join('\n');
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const schedule = { publish_at: new Date(Date.now() - 3600000).toISOString(), due_date: new Date(Date.now() + 3600000).toISOString() };
let h, dom;
beforeEach(() => { h = harness(undefined, { realLearningPath: true }); });
afterEach(() => { h.sqlite.close(); dom?.window.close(); });
async function api(route, body, role = 'student') {
    h.context.actor = role === 'teacher' ? { uid: 'guru' } : { nis: '100' };
    const response = await h.context.worker.fetch(new Request('https://worker.test/api/lms/' + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), h.env, {});
    const value = await response.json(); if (!response.ok) throw new Error(value.error); return value;
}
async function seed(overrides = {}) {
    return api('materials', { id: 'mat', topic_id: 'topic', title: 'Materi asli', class_name: 'X-1', subject_name: 'IPA', resource_type: 'text', content_description: 'Bahan belajar', order_index: 3, ...schedule, ...overrides }, 'teacher');
}
async function editor() {
    await seed();
    h.sqlite.exec("INSERT INTO lms_materials(id,topic_id,teacher_id,teacher_name,subject_name,class_name,title,resource_type,order_index) VALUES ('later','topic','guru','Guru','IPA','X-1','Modul lain','text',9)");
    dom = new JSDOM(fs.readFileSync('guru-mapel.html', 'utf8'));
    const { window } = dom, document = window.document;
    window.HTMLElement.prototype.scrollIntoView = function () {};
    for (const [id, value] of [['select-mapel', 'IPA'], ['select-kelas', 'X-1']]) document.getElementById(id).innerHTML = `<option>${value}</option>`;
    const materials = h.sqlite.prepare('SELECT * FROM lms_materials').all();
    const toast = jest.fn(), save = jest.fn(body => api('materials', body, 'teacher'));
    window.resetLmsMultiCards = () => {};
    window.selectLmsTopicMode = mode => { document.getElementById('input-lms-topic-mode').value = mode; };
    for (const name of ['toggleLmsPublishSchedule', 'toggleLmsDiscussionPrompt', 'updateResourcePlaceholder', 'switchMaterialContentTab', 'switchLmsCreatorTab', 'goToLmsWizardStep', 'closeUnifiedLmsCreator']) window[name] = jest.fn();
    window.loadLmsData = jest.fn(async () => { materials.splice(0, materials.length, ...h.sqlite.prepare('SELECT * FROM lms_materials').all()); });
    window.normalizeLmsResourceUrl = value => value;
    const deps = { window, document, crypto: webcrypto, auth: { currentUser: { uid: 'guru', displayName: 'Guru' } }, raporConfig: { tahun_ajaran_aktif: '2026/2027' },
        currentLmsTopics: [{ id: 'topic', title: 'Bab 1' }], currentLmsMaterials: materials, showToast: toast,
        escapeHTML: escape, getLmsScheduleState,
        normalizeLmsScheduleTime, validateLmsSchedule, validateLmsHtml, cfSaveLmsMaterial: save, clearLmsCardInvalid: () => {}, markLmsCardInvalid: () => {} };
    new Function(...Object.keys(deps), extract(teacher, ['openUnifiedLmsCreator', 'formatToDatetimeLocal', 'addLmsMaterialFormCard', 'refreshLmsMaterialCardsState', 'updateLmsSaveButtonLabel', 'saveLmsMaterialFromWizard']))(...Object.values(deps));
    document.getElementById('btn-submit-lms-add-another').classList.add('hidden');
    window.openUnifiedLmsCreator('create', 2, 'topic', 'mat');
    const add = title => {
        window.addLmsMaterialFormCard();
        const card = [...document.querySelectorAll('#container-lms-materials-list .lms-material-card')].at(-1);
        card.querySelector('.lms-field-title').value = title;
        card.querySelector('.lms-field-resource-type').value = 'text';
        card.querySelector('.lms-field-content').value = 'Materi tambahan';
        return card;
    };
    return { window, document, toast, save, add };
}

test('Hapus Bab is available only when editing an existing chapter and calls the confirmed deletion flow',async()=>{
    const e=await editor();e.window.deleteLmsTopic=jest.fn(async()=>{});
    e.window.openUnifiedLmsCreator('create',1,'topic');
    const button=e.document.getElementById('btn-delete-lms-topic');expect(button.classList.contains('hidden')).toBe(false);
    await button.onclick();expect(e.window.deleteLmsTopic).toHaveBeenCalledWith('topic');expect(button.disabled).toBe(false);
    e.window.openUnifiedLmsCreator('create',1);expect(button.classList.contains('hidden')).toBe(true);await button.onclick();expect(e.window.deleteLmsTopic).toHaveBeenCalledTimes(1);
});

test('edit exposes Add, updates the original and appends several new modules after the existing last order', async () => {
    const e = await editor();
    expect(e.document.getElementById('btn-submit-lms-add-another').classList.contains('hidden')).toBe(false);
    e.document.getElementById('input-lms-material-title').value = 'Materi diperbarui';
    e.add('Tambahan satu'); e.add('Tambahan dua');
    await e.window.saveLmsMaterialFromWizard();
    expect(e.save).toHaveBeenCalledTimes(3);
    expect(h.sqlite.prepare("SELECT title,order_index FROM lms_materials WHERE id='mat'").get()).toEqual({ title: 'Materi diperbarui', order_index: 3 });
    expect(h.sqlite.prepare("SELECT title,order_index FROM lms_materials WHERE title LIKE 'Tambahan%' ORDER BY order_index").all()).toEqual([{ title: 'Tambahan satu', order_index: 10 }, { title: 'Tambahan dua', order_index: 11 }]);
    expect(h.sqlite.prepare("SELECT title FROM lms_materials WHERE id='later'").get().title).toBe('Modul lain');
});

test('invalid additional cards prevent all writes, and retry after partial failure does not duplicate modules', async () => {
    const e = await editor(); const card = e.add('Tambahan satu');
    card.querySelector('.lms-field-content').value = '';
    await e.window.saveLmsMaterialFromWizard(); expect(e.save).not.toHaveBeenCalled();
    card.querySelector('.lms-field-content').value = 'Materi tambahan'; e.add('Tambahan dua');
    e.save.mockImplementationOnce(body => api('materials', body, 'teacher')).mockImplementationOnce(body => api('materials', body, 'teacher')).mockRejectedValueOnce(new Error('Koneksi putus'));
    await e.window.saveLmsMaterialFromWizard();
    expect(h.sqlite.prepare('SELECT COUNT(*) n FROM lms_materials').get().n).toBe(3);
    expect(e.window.closeUnifiedLmsCreator).not.toHaveBeenCalled();
    await e.window.saveLmsMaterialFromWizard();
    expect(h.sqlite.prepare('SELECT COUNT(*) n FROM lms_materials').get().n).toBe(4);
    expect(h.sqlite.prepare("SELECT COUNT(*) n FROM lms_materials WHERE title='Tambahan satu'").get().n).toBe(1);
});

test('several modules in one topic progress from open → discussion → complete → next module with server-backed checkmarks', async () => {
    await seed({ order_index: 1, allow_discussion: 1, discussion_prompt: 'Apa yang dipelajari?' });
    const second = await api('materials', { topic_id: 'topic', title: 'Materi kedua', class_name: 'X-1', subject_name: 'IPA', resource_type: 'text', content_description: 'Bacaan berikut', order_index: 2, ...schedule }, 'teacher');
    dom = new JSDOM('<div id="student-lms-list-container"></div>'); const { window } = dom;
    window.escapeHTML = escape;
    const subjects = [];
    const deps = { window, document: window.document, studentLmsClockOffset: 0, studentLmsActiveSubject: 'IPA', studentLmsSubjects: subjects,
        studentLmsStatusFilter: '', studentLmsOpenTopics: new Map(), studentLmsCompletedSections: new Set(), updateStudentLmsFilterCounters: () => {},
        getLmsScheduleState, formatLmsScheduleTime, calculateDueDateUrgency };
    const render = new Function(...Object.keys(deps), extract(student, ['renderSingleMaterialCardHtml', 'renderStudentLmsStream']) + ';return renderStudentLmsStream;')(...Object.values(deps));
    async function refresh() {
        const course = await api('student/courses');
        subjects.splice(0, subjects.length, { subject_name: 'IPA', topics: course.topics.map(t => ({ ...t, materials: course.materials.filter(m => m.topic_id === t.id) })) });
        render(); return course;
    }
    const step = (id, key) => window.document.querySelector(`#lms-mat-${id} [data-lms-step="${key}"]`);
    const module = id => window.document.querySelector(`[data-topic-material="${id}"]`);
    await refresh();
    expect(module(second.id).dataset.moduleState).toBe('locked');
    expect(step('mat', 'discussion').dataset.stepState).toBe('locked');
    await api('student/track', { material_id: 'mat', action: 'open' }); await refresh();
    expect(step('mat', 'material').dataset.stepState).toBe('completed');
    expect(step('mat', 'discussion').dataset.stepState).toBe('available');
    expect(module(second.id).dataset.moduleState).toBe('locked');
    expect(window.document.body.textContent).not.toContain('Buka Lagi');
    await api('discussions', { material_id: 'mat', content: 'Saya memahami materi.' }); await refresh();
    expect(step('mat', 'discussion').dataset.stepState).toBe('completed');
    expect(module('mat').dataset.moduleState).toBe('completed');
    expect(module(second.id).dataset.moduleState).toBe('available');
    await api('student/track', { material_id: second.id, action: 'open' });
    const course = await refresh();
    expect(course.topics[0].is_completed).toBe(true);
    expect(window.document.querySelectorAll('[data-module-state="completed"]').length).toBe(2);
    expect(window.document.body.textContent).toContain('2/2 modul tuntas');
});
