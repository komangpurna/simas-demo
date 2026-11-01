/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import fs from 'node:fs';
import * as acorn from 'acorn';
import { TextEncoder } from 'node:util';
import { configureLmsHtmlEditor, createLmsHtmlSrcdoc, importLmsHtmlFile, mountLmsHtml, setLmsHtmlFrame, validateLmsHtml, getLmsMaterialInstructions } from '../js/lms-html.mjs';
import { renderSafeMarkdown } from '../js/utils.mjs';
import { attachLmsHtmlState, lmsHtmlRevision, readLmsHtmlSession, writeLmsHtmlSession, clearLmsHtmlSession } from '../js/lms-html-state.mjs';
globalThis.TextEncoder = TextEncoder;
const teacher = fs.readFileSync('js/page-guru-mapel.js', 'utf8');
const student = fs.readFileSync('js/page-portal-siswa.js', 'utf8');
const parsed = acorn.parse(teacher, { ecmaVersion: 'latest', sourceType: 'module' });
const functions = names => parsed.body.filter(n => n.type === 'ExpressionStatement' && names.includes(n.expression.left?.property?.name))
    .map(n => teacher.slice(n.start, n.end)).join('\n');
const markup = new DOMParser().parseFromString(fs.readFileSync('guru-mapel.html', 'utf8'), 'text/html');
const cardMarkup = markup.querySelector('.lms-material-card').outerHTML;
const modalMarkup = markup.getElementById('modal-lms-text-preview').outerHTML;
const html = '<!doctype html><html><head><style>button{color:green}</style></head><body><button onclick="this.textContent=\'Jawaban benar\'">Coba</button><script>window.test=1;</script></body></html>';
let notify;
beforeEach(() => {
    document.body.innerHTML = `<div id="container-lms-materials-list">${cardMarkup}</div>${modalMarkup}`;
    notify = jest.fn();
    new Function('configureLmsHtmlEditor', 'importLmsHtmlFile', 'mountLmsHtml', 'showToast', 'renderSafeMarkdown',
        functions(['updateResourcePlaceholder', 'previewLmsHtml', 'switchMaterialContentTab', 'closeLmsTextPreviewModal', 'importLmsHtmlFile']))(
        configureLmsHtmlEditor, importLmsHtmlFile, mountLmsHtml, notify, value => value);
});

test('HTML selection exposes file import and Preview, hides the URL, and preserves code on type changes', () => {
    const card = document.querySelector('.lms-material-card');
    const type = card.querySelector('.lms-field-resource-type');
    const input = card.querySelector('.lms-field-content');
    input.value = 'Petunjuk belajar'; card.querySelector('.lms-field-html').value = html;
    type.value = 'html'; window.updateResourcePlaceholder(card);
    expect(card.querySelector('.lms-html-tools').classList.contains('hidden')).toBe(false);
    expect(card.querySelector('.lms-html-actions').classList.contains('hidden')).toBe(false);
    expect(type.closest('.lms-media-type-row').querySelector('.lms-html-file-input')).not.toBeNull();
    expect(type.closest('.lms-media-type-row').textContent).toContain('Preview');
    expect(card.querySelector('.lms-container-resource-url').classList.contains('hidden')).toBe(true);
    expect(input.rows).toBe(3);
    expect(card.querySelector('.lms-field-html').rows).toBe(12);
    expect(card.textContent).toContain('Preview');
    type.value = 'text'; window.updateResourcePlaceholder(card);
    expect(input.value).toBe('Petunjuk belajar');
    expect(card.querySelector('.lms-field-html').value).toBe(html);
    expect(card.querySelector('.lms-html-tools').classList.contains('hidden')).toBe(true);
    expect(card.querySelector('.lms-html-actions').classList.contains('hidden')).toBe(true);
});
test('Preview renders in a sandboxed frame and closing destroys the running content', () => {
    const card = document.querySelector('.lms-material-card');
    card.querySelector('.lms-field-resource-type').value = 'html';
    card.querySelector('.lms-field-html').value = html;
    card.querySelector('.lms-field-content').value = 'Ikuti **langkah ini**. <img src=x onerror=alert(1)>';
    window.previewLmsHtml(card);
    const frame = document.querySelector('#lms-preview-body iframe');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.srcdoc).toContain(html);
    expect(document.querySelector('#lms-preview-body script')).toBeNull();
    expect(document.querySelector('#lms-preview-body .lms-html-instructions strong').textContent).toBe('langkah ini');
    expect(document.querySelector('#lms-preview-body img')).toBeNull();
    expect(document.getElementById('modal-lms-text-preview').classList.contains('hidden')).toBe(false);
    window.closeLmsTextPreviewModal();
    expect(document.querySelector('#lms-preview-body iframe')).toBeNull();
});

test('legacy HTML preview routes to the shared student-style viewer when the Module workspace is installed',()=>{
    const card=document.querySelector('.lms-material-card');card.querySelector('.lms-field-html').value=html;card.querySelector('.lms-field-content').value='Petunjuk';card.querySelector('.lms-field-title').value='Judul';
    const previewHtml=jest.fn();window.lmsModuleWorkspace={previewHtml};
    try{window.previewLmsHtml(card);expect(previewHtml).toHaveBeenCalledWith({code:html,title:'Judul',instructions:'Petunjuk'});expect(document.getElementById('modal-lms-text-preview').classList.contains('hidden')).toBe(true);}
    finally{delete window.lmsModuleWorkspace;}
});
test('imports a UTF-8 HTML file into the editor without interpreting its scripts', async () => {
    const fileInput = document.querySelector('.lms-html-file-input');
    document.querySelector('.lms-field-content').value = 'Tujuan dan arahan siswa';
    Object.defineProperty(fileInput, 'files', { value: [new File([html], 'materi.html', { type: 'text/html' })], configurable: true });
    await importLmsHtmlFile(fileInput, notify);
    expect(document.querySelector('.lms-field-html').value).toBe(html);
    expect(document.querySelector('.lms-field-content').value).toBe('Tujuan dan arahan siswa');
    expect(document.querySelector('.lms-html-file-name').textContent).toBe('materi.html');
    expect(document.querySelector('.lms-field-resource-type').value).toBe('html');
    expect(notify).toHaveBeenLastCalledWith('File HTML Dimuat', expect.any(String), 'success');
});
test.each([['materi.txt', html], ['kosong.html', ''], ['besar.html', 'x'.repeat(524289)]])('rejects %s while preserving the editor', async (name, code) => {
    const fileInput = document.querySelector('.lms-html-file-input');
    document.querySelector('.lms-field-html').value = 'Kode sebelumnya';
    Object.defineProperty(fileInput, 'files', { value: [new File([code], name)], configurable: true });
    await importLmsHtmlFile(fileInput, notify);
    expect(document.querySelector('.lms-field-html').value).toBe('Kode sebelumnya');
    expect(notify).toHaveBeenLastCalledWith('Impor HTML Gagal', expect.any(String), 'error');
    expect(fileInput.disabled).toBe(false);
});
test('size checks count UTF-8 bytes; policy precedes author scripts and forbids API connections', () => {
    expect(() => validateLmsHtml('字'.repeat(180000))).toThrow('512 KB');
    const source = createLmsHtmlSrcdoc('<script>test()</script><head></head>');
    expect(source.indexOf('Content-Security-Policy')).toBeLessThan(source.indexOf('<script>test()'));
    expect(source).toContain("connect-src 'none'");
    expect(source).toContain("form-action 'none'");
});
test('actual student handler opens HTML with tracking and clears it when closed', async () => {
    const sourceAst = acorn.parse(student, { ecmaVersion: 'latest', sourceType: 'module' });
    const source = sourceAst.body.filter(n => n.type === 'ExpressionStatement' && ['openStudentMaterial', 'closeStudentResourceModal'].includes(n.expression.left?.property?.name))
        .map(n => student.slice(n.start, n.end)).join('\n');
    document.body.innerHTML = new DOMParser().parseFromString(fs.readFileSync('portal-siswa.html', 'utf8'), 'text/html').getElementById('modal-student-resource').outerHTML;
    const track = jest.fn(async () => true), start = jest.fn(), stop = jest.fn();
    const material = { id: 'mat', title: 'HTML Interaktif', resource_type: 'html', content_description: html, html_instructions: 'Baca **petunjuk** sebelum mencoba. <script>alert(1)</script>' };
    new Function('studentLmsRawData', 'generateLmsSessionId', 'startLmsActiveSession', 'trackStudentItemOpened', 'stopLmsActiveSession',
        'setLmsHtmlFrame', 'validateLmsHtml', 'renderSafeMarkdown', 'attachLmsHtmlState', 'lmsHtmlRevision', 'readLmsHtmlSession',
        'writeLmsHtmlSession', 'clearLmsHtmlSession', 'currentNIS', 'currentStudent', 'getLmsMaterialInstructions',
        `let currentStudentResourceMaterial, studentHtmlStateController, studentHtmlResumeAttempted, lmsActiveSession; ${source}`)(
        { materials: [material] }, () => 'session', start, track, stop, setLmsHtmlFrame, validateLmsHtml, renderSafeMarkdown,
        attachLmsHtmlState, lmsHtmlRevision, readLmsHtmlSession, writeLmsHtmlSession, clearLmsHtmlSession, '100', { nis: '100' }, getLmsMaterialInstructions);
    await window.openStudentMaterial('mat');
    expect(start).toHaveBeenCalledWith(material, 'session', null);
    expect(track).toHaveBeenCalledWith(material, 'session');
    expect(document.getElementById('student-resource-frame').srcdoc).toContain(html);
    expect(document.getElementById('student-resource-fallback-link').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('student-resource-note').textContent).toContain('Durasi belajar aktif tetap dicatat');
    expect(document.querySelector('#student-resource-instructions-body strong').textContent).toBe('petunjuk');
    expect(document.querySelector('#student-resource-instructions-body script')).toBeNull();
    expect(document.getElementById('btn-student-resource-fullscreen').classList.contains('hidden')).toBe(false);
    window.closeStudentResourceModal();
    expect(stop).toHaveBeenCalledWith(true);
    expect(document.getElementById('student-resource-frame').srcdoc).toBe('');
});
