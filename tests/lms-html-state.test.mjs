import { jest } from '@jest/globals';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import vm from 'node:vm';
import { attachLmsHtmlState, createLmsHtmlStateScript, lmsHtmlRevision, readLmsHtmlSession,
    writeLmsHtmlSession, clearLmsHtmlSession, LMS_HTML_DRAFT_LIMIT } from '../js/lms-html-state.mjs';

const empty = () => ({ forms: {}, local: {}, session: {}, custom: null });
function memory() {
    const map = new Map();
    return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key), map };
}
function bridge(storage = memory(), overrides = {}) {
    const listeners = new Set(), frame = { contentWindow: {} }, status = jest.fn();
    const controller = attachLmsHtmlState(frame, { nis: '100', materialId: 'mat', code: '<input>', storage, onStatus: status,
        eventTarget: { addEventListener: (_type, fn) => listeners.add(fn), removeEventListener: (_type, fn) => listeners.delete(fn) }, ...overrides });
    return { controller, frame, status, storage, send(state = empty(), changes = {}) {
        for (const fn of listeners) fn({ source: frame.contentWindow, origin: 'null',
            data: { type: 'simas-lms-html-state', channel: controller.bootstrap.channel, state }, ...changes });
    } };
}
test('drafts are scoped to student, material and exact code revision; corrupt cache is ignored', () => {
    const h = bridge(); h.send({ ...empty(), local: { answer: 'B' } });
    expect(bridge(h.storage).controller.bootstrap.state.local.answer).toBe('B');
    for (const overrides of [{ nis: '200' }, { materialId: 'other' }, { code: '<input id="new">' }]) {
        expect(bridge(h.storage, overrides).controller.bootstrap.state.local).toEqual({});
    }
    const key = [...h.storage.map.keys()][0]; h.storage.map.set(key, 'broken json');
    expect(bridge(h.storage).controller.bootstrap.state).toEqual(empty());
});
test('rejects messages from other windows, origins, channels, identities and oversized or malformed payloads', () => {
    let nis = '100'; const h = bridge(undefined, { getStudentId: () => nis });
    h.send(empty(), { source: {} }); h.send(empty(), { origin: 'https://attacker.test' });
    h.send(empty(), { data: { type: 'simas-lms-html-state', channel: 'wrong', state: empty() } });
    nis = '200'; h.send(); nis = '100';
    expect(h.storage.map.size).toBe(0);
    h.send({ ...empty(), local: { huge: 'x'.repeat(LMS_HTML_DRAFT_LIMIT) } });
    h.send({ forms: [], local: {}, session: {} });
    h.send({ ...empty(), local: { wrong: 5 } });
    expect(h.storage.map.size).toBe(0); expect(h.status).toHaveBeenLastCalledWith('failed');
    h.send(); expect(h.storage.map.size).toBe(1);
    h.controller.dispose(); h.send({ ...empty(), custom: 'ignored' });
    expect(bridge(h.storage).controller.bootstrap.state.custom).toBeNull();
});
test('storage quota or disabled storage does not throw or mark answers saved', () => {
    const h = bridge({ getItem() { throw new Error('disabled'); }, setItem() { throw new Error('quota'); } });
    expect(() => h.send()).not.toThrow(); expect(h.status).toHaveBeenLastCalledWith('failed');
});
test('same snapshots do not repeatedly write storage', () => {
    const storage = memory(); storage.setItem = jest.fn(storage.setItem);
    const h = bridge(storage); h.send(); h.send(); h.send();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
});

const markup = '<fieldset><legend>Soal satu</legend><label>Jawaban<input id="text"></label><textarea id="essay"></textarea><input id="check" type="checkbox"><input name="pg" type="radio" value="A"><input name="pg" type="radio" value="B"><select id="select" multiple><option value="A">A</option><option value="B">B</option></select><div contenteditable="true" id="edit"></div><input id="secret" type="password"><input id="file" type="file"></fieldset>';
const opened = [];
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function boot(state = empty(), html = markup) {
    const dom = new JSDOM(html, { runScripts: 'outside-only' }); opened.push(dom);
    dom.window.TextEncoder = TextEncoder;
    const messages = [];
    dom.window.postMessage = message => messages.push(JSON.parse(JSON.stringify(message)));
    const script = createLmsHtmlStateScript({ channel: 'test', state, limit: LMS_HTML_DRAFT_LIMIT });
    dom.window.eval(script.slice(8, -9)); await pause();
    return { win: dom.window, doc: dom.window.document, messages, input(id, value) {
        const el = dom.window.document.getElementById(id); el.value = value;
        el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    } };
}
afterEach(() => { while (opened.length) opened.pop().window.close(); });
test('text, radio, checkbox, multi-select, contenteditable and model events recover; passwords/files do not', async () => {
    const a = await boot(); a.input('text', 'jawaban'); a.input('essay', 'uraian'); a.input('secret', 'private');
    a.doc.getElementById('check').checked = true;
    a.doc.querySelector('input[value="B"]').checked = true;
    for (const o of a.doc.getElementById('select').options) o.selected = true;
    a.doc.getElementById('edit').textContent = 'catatan';
    a.win.localStorage.setItem('quiz', '2'); a.win.sessionStorage.step = '3'; a.win.SimasLmsState.save({ score: 80 });
    await pause(); const snapshot = a.messages.at(-1).state;
    expect(JSON.stringify(snapshot)).not.toContain('private');
    const b = await boot(snapshot);
    expect(b.doc.getElementById('text').value).toBe('jawaban');
    expect(b.doc.getElementById('essay').value).toBe('uraian');
    expect(b.doc.getElementById('check').checked).toBe(true);
    expect(b.doc.querySelector('input[value="B"]').checked).toBe(true);
    expect(b.doc.getElementById('select').selectedOptions.length).toBe(2);
    expect(b.doc.getElementById('edit').textContent).toBe('catatan');
    expect(b.doc.getElementById('secret').value).toBe('');
    expect(b.win.localStorage.getItem('quiz')).toBe('2'); expect(b.win.sessionStorage.step).toBe('3');
    expect(b.win.SimasLmsState.load()).toEqual({ score: 80 });
    expect(b.win.sessionStorage.getItem('student_token')).toBeNull();
});
test('restores delayed fields and skips fields when question labels change', async () => {
    const a = await boot(); a.input('text', 'B'); await pause(); const seed = a.messages.at(-1).state;
    const b = await boot(seed, '<main></main>');
    b.doc.querySelector('main').innerHTML = markup; await pause();
    expect(b.doc.getElementById('text').value).toBe('B');
    const c = await boot(seed, markup.replace('Soal satu', 'Soal dua'));
    expect(c.doc.getElementById('text').value).toBe('');
});
test('storage is seeded synchronously before author scripts and malicious saved strings cannot escape bootstrap', async () => {
    const seed = { ...empty(), local: { answer: '</script><script>window.escaped=true</script>\u2028' } };
    const script = createLmsHtmlStateScript({ channel: 'test', state: seed, limit: LMS_HTML_DRAFT_LIMIT });
    expect(script.match(/<\/script>/g)).toHaveLength(1);
    const b = await boot(seed); expect(b.win.localStorage.answer).toBe(seed.local.answer); expect(b.win.escaped).toBeUndefined();
    expect(b.win.SimasLmsState.save(undefined)).toBe(false); expect(b.win.SimasLmsState.save('x'.repeat(LMS_HTML_DRAFT_LIMIT + 1))).toBe(false);
});
test('storage implements property/method writes, key/length, remove and clear without touching app storage', async () => {
    const b = await boot(); b.win.localStorage.a = '1'; b.win.localStorage.setItem('b', 2);
    expect(Object.keys(b.win.localStorage)).toEqual(['a','b']); expect(b.win.localStorage.length).toBe(2);
    expect(b.win.localStorage.key(1)).toBe('b'); delete b.win.localStorage.a;
    expect(b.win.localStorage.getItem('a')).toBeNull(); b.win.localStorage.clear(); expect(b.win.localStorage.length).toBe(0);
});

test('duration session resumes cumulative seconds, rejects corrupt/expired state and handles disabled storage', () => {
    const storage = memory(), session = { studentNis: '100', materialId: 'mat', htmlRevision: lmsHtmlRevision('html'), sessionId: 'sess_test', activeSeconds: 30 };
    writeLmsHtmlSession(session, storage); expect(readLmsHtmlSession('100', storage).activeSeconds).toBe(30);
    expect(readLmsHtmlSession('200', storage)).toBeNull(); clearLmsHtmlSession('100', storage); expect(readLmsHtmlSession('100', storage)).toBeNull();
    writeLmsHtmlSession(session, storage); const key = [...storage.map.keys()][0];
    const saved = JSON.parse(storage.getItem(key)); saved.updatedAt = Date.now() - 13 * 3600000;
    storage.setItem(key, JSON.stringify(saved)); expect(readLmsHtmlSession('100', storage)).toBeNull();
    expect(() => writeLmsHtmlSession(session, { setItem() { throw new Error('quota'); } })).not.toThrow();
});
test('actual tracker resumes same ID without counting the reload gap and only keeps markers on pagehide', async () => {
    const source = fs.readFileSync('js/page-portal-siswa.js', 'utf8');
    const code = source.slice(source.indexOf('let lmsActiveSession = null;'), source.indexOf('async function trackStudentItemOpened'));
    const storage = memory(), listeners = {}, api = jest.fn(async () => ({}));
    let now = Date.now(); class ClockDate extends Date { static now() { return now; } }
    const context = vm.createContext({ Date: ClockDate, Math, console, currentNIS: '100', currentStudent: { nis: '100' },
        lmsHtmlRevision, writeLmsHtmlSession: s => writeLmsHtmlSession(s, storage), clearLmsHtmlSession: nis => clearLmsHtmlSession(nis, storage),
        cfTrackLmsStudentProgress: api, setInterval: () => 1, clearInterval() {},
        document: { visibilityState: 'visible', addEventListener: (type, fn) => { listeners[type] = fn; } },
        window: { addEventListener: (type, fn) => { listeners[type] = fn; } } });
    vm.runInContext(code, context);
    const material = { id: 'mat', resource_type: 'html', content_description: 'html' };
    context.startLmsActiveSession(material, 'sess_test'); now += 30000;
    listeners.pagehide(); await Promise.resolve(); const saved = readLmsHtmlSession('100', storage);
    expect(saved.activeSeconds).toBe(30); now += 600000;
    context.startLmsActiveSession(material, saved.sessionId, saved); now += 20000;
    context.stopLmsActiveSession(true); await Promise.resolve();
    expect(api).toHaveBeenLastCalledWith(expect.objectContaining({ session_id: 'sess_test', session_seconds: 50 }), {});
    expect(readLmsHtmlSession('100', storage)).toBeNull();
});
