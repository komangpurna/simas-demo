/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import fs from 'node:fs';
import * as acorn from 'acorn';
import { formatLmsScheduleTime, getLmsScheduleState, normalizeLmsScheduleTime } from '../js/lms-schedule.mjs';
import { calculateDueDateUrgency } from '../js/utils.mjs';
import { getLmsMaterialInstructions } from '../js/lms-html.mjs';
import { quizEscape } from '../js/lms-quiz-ui.mjs';
const source = fs.readFileSync('js/page-guru-mapel.js', 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const declaration = name => { const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name); return source.slice(node.start, node.end); };
const handler = name => { const node = ast.body.find(n => n.type === 'ExpressionStatement' && n.expression.left?.property?.name === name); return source.slice(node.start, node.end); };
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('teacher list automatically changes to Selesai Dibahas and offers reactivation when its target passes', async () => {
    jest.useFakeTimers();
    document.body.innerHTML = '<div id="lms-topics-container"></div>';
    const material = { id: 'mat', topic_id: 'topic', title: 'Materi', class_name: 'X-1', resource_type: 'html', html_instructions: 'Pelajari',
        is_published: 2, is_teaching_completed: 0, publish_at: new Date(Date.now() - 1000).toISOString(), due_date: new Date(Date.now() + 1000).toISOString() };
    const deps = { currentLmsMaterials: [material], currentLmsTopics: [{ id: 'topic', title: 'Bab 1' }], loadedStudents: [], currentLmsAnalytics: null,
        getLmsContextExpandedState: () => ({ topics: new Set(['topic']), materials: new Set(['mat']) }), getLmsScheduleState, normalizeLmsScheduleTime,
        formatLmsScheduleTime, calculateDueDateUrgency, getLmsMaterialInstructions, escapeHTML: quizEscape, formatLmsPublishDate: formatLmsScheduleTime };
    const render = new Function(...Object.keys(deps), `${declaration('renderLmsMaterialsList')};return renderLmsMaterialsList;`)(...Object.values(deps));
    render();
    expect(document.getElementById('lms-topics-container').textContent).toContain('Sedang Dibahas');
    expect(document.querySelector('[onclick*="reactivateLmsMaterial"]')).toBeNull();
    await jest.advanceTimersByTimeAsync(1050);
    expect(document.getElementById('lms-topics-container').textContent).toContain('Selesai Dibahas');
    expect(document.querySelector('[onclick*="reactivateLmsMaterial"]').textContent).toBe('Aktifkan Kembali');
    expect(document.getElementById('lms-topics-container').textContent).not.toContain('Ditutup');
    expect(material.is_teaching_completed).toBe(0); // The UI evaluates the deadline without editing cached records.
});

test('reactivation opens the existing editor, selects Sedang Dibahas and requires the teacher to enter a new target', () => {
    document.body.innerHTML = '<select id="select-lms-material-teaching-status"><option value="0">Sedang</option><option value="1" selected>Selesai</option></select><input id="input-lms-material-due" type="datetime-local" required value="2026-10-15T10:00">';
    const material = { id: 'mat', topic_id: 'topic', is_teaching_completed: 1 };
    window.openLmsMaterialModal = jest.fn(); const notify = jest.fn();
    new Function('currentLmsMaterials', 'showToast', handler('reactivateLmsMaterial'))([material], notify);
    window.reactivateLmsMaterial('mat');
    expect(window.openLmsMaterialModal).toHaveBeenCalledWith('mat', 'topic');
    expect(document.getElementById('select-lms-material-teaching-status').value).toBe('0');
    const target = document.getElementById('input-lms-material-due');
    expect(target.value).toBe(''); expect(target.required).toBe(true); expect(document.activeElement).toBe(target);
    expect(material.is_teaching_completed).toBe(1); // Nothing is published until Save succeeds.
    expect(notify.mock.calls[0][1]).toMatch(/riwayat siswa tetap/);
});
