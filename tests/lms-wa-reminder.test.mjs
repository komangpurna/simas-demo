/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import fs from 'node:fs';
import * as acorn from 'acorn';
import { getLmsMaterialInstructions } from '../js/lms-html.mjs';

const source = fs.readFileSync('js/page-guru-mapel.js', 'utf8');
const names = ['buildLmsWaAccessInstructions', 'buildLmsWaMaterialInstructions', 'generateLmsClassWaMessage', 'copyLmsProgressReminderToWa'];
const handlers = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.filter(n =>
    n.type === 'FunctionDeclaration' ? names.includes(n.id.name) : n.type === 'ExpressionStatement' && names.includes(n.expression.left?.property?.name))
    .map(n => source.slice(n.start, n.end)).join('\n');
const code = '<!doctype html><script>HTML_SOURCE_MUST_STAY_OUT_OF_WA()</script>';
const html = () => ({ id: 'html', title: 'Materi interaktif', resource_type: 'html', content_description: code, html_instructions: 'Baca tujuan.\nKerjakan latihan sampai tuntas.' });
function setup(material = html()) {
    document.body.innerHTML = '<select id="select-mapel"><option>IPA</option></select><select id="select-kelas"><option>X-1</option></select><select id="select-lms-wa-target-material"><option value="html">HTML</option><option value="text">Teks</option><option value="all">Semua</option></select><textarea id="textarea-lms-wa-preview"></textarea>';
    const clipboard = jest.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
    const materials = [material, { id: 'text', title: 'Materi bacaan', resource_type: 'text', content_description: 'Baca halaman 10 dan jawab pertanyaan.' }];
    new Function('getLmsMaterialInstructions', 'currentLmsMaterials', 'currentLmsProgressMaterial', 'currentLmsProgressData',
        'showToast', 'showModernAlert', 'formatLmsScheduleTime', handlers)(getLmsMaterialInstructions, materials, material,
        [{ name: 'Siswa Uji', nis: '100', status: 'opened' }], jest.fn(), jest.fn(), value => value);
    return { clipboard, preview: () => document.getElementById('textarea-lms-wa-preview').value };
}
test.each(['html', 'all'])('WA target %s uses HTML instructions and the monitoring notice without raw source', target => {
    const h = setup(); document.getElementById('select-lms-wa-target-material').value = target;
    window.generateLmsClassWaMessage(); const text = h.preview();
    expect(text).toContain('Baca tujuan. Kerjakan latihan sampai tuntas.');
    expect(text).not.toContain('HTML_SOURCE_MUST_STAY_OUT_OF_WA'); expect(text).not.toContain('<script>');
    expect(text).toContain('Guru dapat memantau aktivitas, progres, dan durasi belajar aktif');
    expect(text).toContain('membuka lalu menutup LMS belum berarti pembelajaran selesai');
});
test.each([undefined, '', '  '])('empty HTML instructions use a readable LMS direction, never the code', html_instructions => {
    const h = setup({ ...html(), html_instructions }); window.generateLmsClassWaMessage();
    expect(h.preview()).toContain('Buka materi HTML interaktif di LMS');
    expect(h.preview()).not.toContain('HTML_SOURCE_MUST_STAY_OUT_OF_WA');
});
test('non-HTML reminders still use their material description', () => {
    const h = setup(); document.getElementById('select-lms-wa-target-material').value = 'text'; window.generateLmsClassWaMessage();
    expect(h.preview()).toContain('Baca halaman 10 dan jawab pertanyaan.');
    expect(h.preview()).not.toContain('Baca tujuan.');
});
test('progress reminder copy also includes HTML instructions and monitoring information', async () => {
    const h = setup(); window.copyLmsProgressReminderToWa(); await Promise.resolve();
    const text = h.clipboard.mock.calls[0][0];
    expect(text).toContain('Baca tujuan. Kerjakan latihan sampai tuntas.');
    expect(text).not.toContain('HTML_SOURCE_MUST_STAY_OUT_OF_WA');
    expect(text).toContain('durasi belajar aktif'); expect(text).toContain('Siswa Uji');
});
test('student LMS and material viewer both explain monitored learning', () => {
    const doc = new DOMParser().parseFromString(fs.readFileSync('portal-siswa.html', 'utf8'), 'text/html');
    for (const id of ['student-lms-engagement-info', 'student-resource-engagement-info']) {
        expect(doc.getElementById(id).textContent).toContain('Guru dapat memantau aktivitas, progres, dan durasi belajar aktif');
    }
});
