/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const root = path.resolve(__dirname, '..');
const guru = fs.readFileSync(path.join(root, 'js/page-guru-mapel.js'), 'utf8');
const student = fs.readFileSync(path.join(root, 'js/page-portal-siswa.js'), 'utf8');
const ast = acorn.parse(guru, { ecmaVersion: 'latest', sourceType: 'module' });
function teacherFunction(name) {
    const node = ast.body.find(n => n.type === 'FunctionDeclaration' ? n.id.name === name :
        n.type === 'ExpressionStatement' && n.expression.type === 'AssignmentExpression' && n.expression.left.property?.name === name);
    if (!node) throw new Error(`Missing function ${name}`);
    return guru.slice(node.start, node.end);
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe('LMS WFH: schedule, document policy and real student tracker', () => {
    test('the wizard sends 08:00 WITA as midnight UTC and preserves the editor round-trip', async () => {
        document.body.innerHTML = `<select id="select-mapel"><option>IPA</option></select><select id="select-kelas"><option>X-1</option></select>
            <select id="select-semester"><option>1</option></select><input id="input-lms-topic-mode" value="existing">
            <select id="select-lms-material-topic"><option>topic</option></select><select id="select-lms-material-published"><option>2</option></select>
            <input id="input-lms-material-publish-at" value="2026-10-15T08:00"><input id="input-lms-material-due" value="2026-10-15T10:00">
            <input id="input-lms-material-id" value="mat"><input id="input-lms-material-title" value="Materi WFH">
            <select id="select-lms-resource-type"><option>text</option></select><textarea id="input-lms-material-content">Isi materi</textarea>
            <button id="btn-submit-lms-material"></button><button id="btn-submit-lms-add-another"></button>`;
        const { validateLmsSchedule } = await import('../js/lms-schedule.mjs');
        const saveMaterial = jest.fn(async () => ({ id: 'mat' }));
        const notify = jest.fn();
        window.loadLmsData = jest.fn(async () => {});
        window.closeUnifiedLmsCreator = jest.fn();
        window.normalizeLmsResourceUrl = x => x;
        const helpers = ast.body.filter(n => n.type === 'FunctionDeclaration' && ['normalizeLmsPublishAt', 'formatToDatetimeLocal'].includes(n.id.name))
            .map(n => guru.slice(n.start, n.end)).join('\n');
        new Function('auth', 'raporConfig', 'currentLmsTopics', 'currentLmsMaterials',
            'cfSaveLmsMaterial', 'showToast', 'validateLmsSchedule', `${helpers}\n${teacherFunction('saveLmsMaterialFromWizard')}`)(
            { currentUser: { uid: 'guru', displayName: 'Guru' } }, { tahun_ajaran_aktif: '2026/2027' },
            [{ id: 'topic', title: 'WFH' }], [], saveMaterial, notify, validateLmsSchedule);
        await window.saveLmsMaterialFromWizard();
        expect(saveMaterial).toHaveBeenCalledTimes(1);
        const scheduled = saveMaterial.mock.calls[0][0].publish_at;
        expect(scheduled).toBe('2026-10-15T00:00:00.000Z');
        const format = new Function(`${teacherFunction('formatToDatetimeLocal')}\nreturn formatToDatetimeLocal;`)();
        expect(format(scheduled)).toBe('2026-10-15T08:00');
        expect(document.getElementById('btn-submit-lms-material').disabled).toBe(false);
    });

    test('every hosting target permits the actual Google Drive and Docs preview hosts', () => {
        const config = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
        for (const hosting of config.hosting.filter(target => target.public === '.')) {
            const policy = hosting.headers.flatMap(rule => rule.headers).find(h => h.key === 'Content-Security-Policy').value;
            const frames = policy.match(/frame-src ([^;]+)/)[1].split(/\s+/);
            expect(frames).toEqual(expect.arrayContaining(['https://drive.google.com', 'https://docs.google.com', 'https://www.youtube.com']));
            expect(frames).not.toContain('https:');
            expect(frames).not.toContain('*');
        }
    });

    function tracker(api = jest.fn(async () => ({}))) {
        const listeners = {};
        const context = vm.createContext({ Date, Math, console: { warn() {} },
            currentNIS: '100', currentStudent: { nis: '100' }, cfTrackLmsStudentProgress: api,
            writeLmsHtmlSession() {}, clearLmsHtmlSession() {},
            setInterval: jest.fn(() => 1), clearInterval: jest.fn(),
            document: { visibilityState: 'visible', addEventListener: (event, fn) => { listeners[event] = fn; } },
            window: { addEventListener: (event, fn) => { listeners[event] = fn; } }, sessionStorage: { getItem: () => null } });
        const code = student.slice(student.indexOf('let lmsActiveSession = null;'), student.indexOf('async function trackStudentItemOpened'));
        vm.runInContext(code, context);
        context.startLmsActiveSession({ id: 'mat' }, 'session');
        return { context, listeners, api, state: () => vm.runInContext('lmsActiveSession', context) };
    }
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-15T00:00:00Z')); });
    afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

    test('pagehide sends the final 42 seconds with keepalive before releasing the session', async () => {
        const h = tracker();
        jest.setSystemTime(Date.now() + 42000);
        h.listeners.pagehide(); await settle();
        expect(h.api).toHaveBeenCalledWith(expect.objectContaining({ action: 'sync_duration', session_id: 'session', session_seconds: 42 }), { keepalive: true });
        expect(h.state()).toBeNull();
    });
    test('failed duration saves remain pending and retry the same cumulative checkpoint', async () => {
        const api = jest.fn().mockRejectedValueOnce(new Error('Jaringan putus')).mockResolvedValue({});
        const h = tracker(api);
        jest.setSystemTime(Date.now() + 15000);
        await h.context.syncLmsActiveSessionDuration(false);
        expect(h.state().lastSyncedSeconds).toBe(0);
        await h.context.syncLmsActiveSessionDuration(false);
        expect(api).toHaveBeenCalledTimes(2);
        expect(api.mock.calls[1][0].session_seconds).toBe(15);
        expect(h.state().lastSyncedSeconds).toBe(15);
    });
    test('an old response cannot regress a newer acknowledged checkpoint', async () => {
        let resolveOld;
        const api = jest.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue({});
        const h = tracker(api);
        jest.setSystemTime(Date.now() + 10000);
        const old = h.context.syncLmsActiveSessionDuration(false);
        jest.setSystemTime(Date.now() + 12000);
        await h.context.syncLmsActiveSessionDuration(false);
        resolveOld({}); await old;
        expect(h.state().lastSyncedSeconds).toBe(22);
    });
    test('visibilitychange flushes elapsed time and pauses the hidden page', async () => {
        const h = tracker();
        jest.setSystemTime(Date.now() + 12000);
        h.context.document.visibilityState = 'hidden';
        h.listeners.visibilitychange(); await settle();
        expect(h.api).toHaveBeenCalledWith(expect.objectContaining({ session_seconds: 12 }), { keepalive: true });
        expect(h.state().isRunning).toBe(false);
    });
});
