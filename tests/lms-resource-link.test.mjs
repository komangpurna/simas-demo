/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import fs from 'node:fs';
import * as acorn from 'acorn';
import { resolveLmsResourceLink } from '../js/lms-resource-link.mjs';
import { getLmsMaterialInstructions } from '../js/lms-html.mjs';
import { renderSafeMarkdown } from '../js/utils.mjs';

const student = fs.readFileSync('js/page-portal-siswa.js', 'utf8');
const ast = acorn.parse(student, { ecmaVersion: 'latest', sourceType: 'module' });
function source(names) {
    return ast.body.filter(n => n.type === 'FunctionDeclaration' ? names.includes(n.id.name) :
        n.type === 'ExpressionStatement' && names.includes(n.expression.left?.property?.name))
        .map(n => student.slice(n.start, n.end)).join('\n');
}
const modal = new DOMParser().parseFromString(fs.readFileSync('portal-siswa.html', 'utf8'), 'text/html').getElementById('modal-student-resource').outerHTML;
const material = (extra = {}) => ({ id: 'mat', title: 'Simple Past Tense', resource_type: 'link',
    resource_url: 'kuispengimbasan.my.canva.site/simple-past?kelas=X#latihan', content_description: 'Pelajari **materi** lalu jawab latihan.', ...extra });

test('Canva and ordinary web links retain query/fragment and open as external material', () => {
    const link = resolveLmsResourceLink(material().resource_url, 'link', 'https://smagesa.web.app');
    expect(link.url).toBe('https://kuispengimbasan.my.canva.site/simple-past?kelas=X#latihan');
    expect(link.embedUrl).toBe('');
    expect(link.isCanva).toBe(true);
    expect(resolveLmsResourceLink('https://school.example/lesson', 'link').embedUrl).toBe('');
    expect(resolveLmsResourceLink('https://canva.site.evil.example/lesson', 'link').isCanva).toBe(false);
});
test.each([
    ['https://youtu.be/dQw4w9WgXc?t=12', 'https://www.youtube.com/embed/dQw4w9WgXc'],
    ['https://www.youtube.com/shorts/dQw4w9WgXc', 'https://www.youtube.com/embed/dQw4w9WgXc'],
    ['https://drive.google.com/file/d/file_123/view?usp=sharing', 'https://drive.google.com/file/d/file_123/preview'],
    ['https://drive.google.com/open?id=file_123', 'https://drive.google.com/file/d/file_123/preview'],
    ['https://docs.google.com/presentation/d/slide_123/edit', 'https://docs.google.com/presentation/d/slide_123/preview'],
    ['https://docs.google.com/presentation/d/e/published_id/pub?start=false', 'https://docs.google.com/presentation/d/e/published_id/pub?start=false']
])('known provider link remains viewable in the internal player: %s', (url, expected) => {
    expect(resolveLmsResourceLink(url, 'link').embedUrl).toBe(expected);
});
test.each(['javascript:alert(1)', 'data:text/html,test', 'file:///C:/private', 'https://user:password@example.com', '', 'https://'])('rejects unsafe or invalid link %s', url => {
    expect(resolveLmsResourceLink(url, 'link')).toBeNull();
});
test('a provider name in an untrusted host is not treated as an allowed iframe', () => {
    expect(resolveLmsResourceLink('https://www.youtube.com.evil.example/watch?v=dQw4w9WgXc', 'youtube').embedUrl).toBe('');
    expect(resolveLmsResourceLink('http://docs.google.com/document/d/doc/view', 'gdrive').embedUrl).toBe('');
});

function installOpen(item, track = jest.fn(async () => true)) {
    document.body.innerHTML = modal;
    const start = jest.fn(), stop = jest.fn();
    window.showPopup = jest.fn();
    new Function('studentLmsRawData', 'currentNIS', 'currentStudent', 'trackStudentItemOpened',
        'generateLmsSessionId', 'startLmsActiveSession', 'stopLmsActiveSession', 'resolveLmsResourceLink',
        'getLmsMaterialInstructions', 'renderSafeMarkdown',
        `let currentStudentResourceMaterial, studentHtmlStateController, studentHtmlResumeAttempted, lmsActiveSession;
        ${source(['openStudentMaterial', 'closeStudentResourceModal'])}`)(
        { materials: [item] }, '100', { nis: '100', class: 'X-1' }, track, () => 'one-session', start, stop,
        resolveLmsResourceLink, getLmsMaterialInstructions, renderSafeMarkdown);
    return { track, start, stop };
}
test('actual Link handler shows actionable Canva card, sanitized instructions and honest monitoring notice', async () => {
    const { track, stop } = installOpen(material({ content_description: 'Ikuti **petunjuk**. <script>alert(1)</script>' }));
    await window.openStudentMaterial('mat');
    expect(track).toHaveBeenCalledTimes(1);
    expect(document.getElementById('modal-student-resource').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('student-resource-external').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('student-resource-frame').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('student-resource-frame').getAttribute('src')).toBe('about:blank');
    expect(document.getElementById('student-resource-open-link').href).toContain('/simple-past?kelas=X#latihan');
    expect(document.getElementById('student-resource-open-link').target).toBe('_blank');
    expect(document.getElementById('student-resource-open-link').rel).toContain('noopener');
    expect(document.querySelector('#student-resource-instructions-body strong').textContent).toBe('petunjuk');
    expect(document.querySelector('#student-resource-instructions-body script')).toBeNull();
    expect(document.getElementById('student-resource-engagement-info').textContent).toBe('Pembukaan materi dicatat di LMS.');
    expect(stop).toHaveBeenCalledWith(false);
});
test('actual supported-link handler keeps embedded player and external fallback', async () => {
    const { stop } = installOpen(material({ resource_url: 'https://youtu.be/dQw4w9WgXc' }));
    await window.openStudentMaterial('mat');
    expect(document.getElementById('student-resource-frame').src).toBe('https://www.youtube.com/embed/dQw4w9WgXc');
    expect(document.getElementById('student-resource-frame').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('student-resource-external').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('student-resource-fallback-link').classList.contains('hidden')).toBe(false);
    expect(stop).not.toHaveBeenCalled();
});
test.each([
    [Object.assign(new Error('Forbidden: Materi untuk kelas lain.'), { status: 403 }), 'Materi Tidak Dapat Dibuka', 'Forbidden: Materi untuk kelas lain.'],
    [new TypeError('Failed to fetch'), 'Koneksi LMS Terganggu', 'Pencatatan pembukaan materi belum dapat dikonfirmasi']
])('failed server tracking does not grant access: %s', async (error, title, message) => {
    const { start } = installOpen(material(), jest.fn(async () => { throw error; }));
    await window.openStudentMaterial('mat');
    expect(start).not.toHaveBeenCalled();
    expect(document.getElementById('modal-student-resource').classList.contains('hidden')).toBe(true);
    expect(window.showPopup).toHaveBeenCalledWith(title, expect.stringContaining(message), 'error');
});
test('locked material is not tracked or opened', async () => {
    const { track, start } = installOpen(material({ is_locked: true }));
    await window.openStudentMaterial('mat');
    expect(track).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
});
test('a failed secondary refresh does not discard an opening already authorized and recorded by server', async () => {
    const item = material(), raw = { materials: [item] };
    const post = jest.fn(async () => ({ success: true }));
    const load = jest.fn(async () => false), render = jest.fn();
    const track = new Function('currentNIS', 'currentStudent', 'cfTrackLmsStudentProgress', 'loadStudentLmsData',
        'processAndRenderStudentLms', 'studentLmsRawData', `${source(['trackStudentItemOpened'])}; return trackStudentItemOpened;`)(
        '100', { nis: '100', class: 'X-1', name: 'Siswa Satu' }, post, load, render, raw);
    await expect(track(item, 'session-stable')).resolves.toBe(true);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ action: 'open', student_nis: '100', session_id: 'session-stable' }));
    expect(item.is_opened).toBe(true); expect(render).toHaveBeenCalledWith(raw);
    post.mockRejectedValueOnce(Object.assign(new Error('Modul masih terkunci'), { status: 409 }));
    await expect(track(item, 'next')).rejects.toThrow('Modul masih terkunci');
    expect(load).toHaveBeenCalledTimes(1);
});
test('a student change while refreshing cancels the old material open', async () => {
    const render = jest.fn();
    let state;
    const load = async () => { state.setNis('200'); return false; };
    state = new Function('currentNIS', 'currentStudent', 'cfTrackLmsStudentProgress', 'loadStudentLmsData',
        'processAndRenderStudentLms', 'studentLmsRawData', `${source(['trackStudentItemOpened'])};
        return { track: trackStudentItemOpened, setNis: value => { currentNIS = value; } };`)(
        '100', { nis: '100', class: 'X-1' }, async () => ({ success: true }), load, render, { materials: [] });
    await expect(state.track(material(), 'old-student-session')).resolves.toBe(false);
    expect(render).not.toHaveBeenCalled();
});
