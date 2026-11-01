const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

const source = fs.readFileSync(path.join(__dirname, '../js/global.js'), 'utf8');
const registrationNode = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.find(node =>
    node.type === 'IfStatement' && node.test.type === 'BinaryExpression' &&
    node.test.operator === 'in' && node.test.left.value === 'serviceWorker');

function registrationHarness({ rejectRegistration = false } = {}) {
    const documentEvents = new Map();
    const workerEvents = new Map();
    const update = jest.fn().mockResolvedValue(undefined);
    const register = rejectRegistration
        ? jest.fn().mockRejectedValue(new Error('Browser storage unavailable'))
        : jest.fn().mockResolvedValue({ scope: 'https://school.test/', update });
    const reload = jest.fn();
    const state = { answer: 'Jawaban kuis yang belum dikirim', upload: 'in-flight' };
    const window = {
        addEventListener: (type, handler) => documentEvents.set(type, handler),
        location: { reload },
        updatePWAInstallUI: jest.fn(),
        localStorage: { clear: jest.fn() },
        sessionStorage: { clear: jest.fn() }
    };
    const context = {
        window,
        navigator: { serviceWorker: { register, addEventListener: (type, handler) => workerEvents.set(type, handler) } },
        ROOT_URL: 'https://school.test/',
        isLocalServer: false,
        console: { log: jest.fn(), warn: jest.fn() }
    };
    vm.runInNewContext(source.slice(registrationNode.start, registrationNode.end), context);
    return { documentEvents, workerEvents, register, reload, update, window, state };
}

describe('PWA update lifecycle preserves the active document', () => {
    test('worker controller changes do not reload a draft or an upload', () => {
        const h = registrationHarness();
        for (let i = 0; i < 3; i++) h.workerEvents.get('controllerchange')?.();
        expect(h.reload).not.toHaveBeenCalled();
        expect(h.state).toEqual({ answer: 'Jawaban kuis yang belum dikirim', upload: 'in-flight' });
        expect(h.window.localStorage.clear).not.toHaveBeenCalled();
        expect(h.window.sessionStorage.clear).not.toHaveBeenCalled();
    });

    test('normal load still registers the root worker and checks for fresh code', async () => {
        const h = registrationHarness();
        h.documentEvents.get('load')();
        await new Promise(resolve => setImmediate(resolve));
        expect(h.register).toHaveBeenCalledWith('https://school.test/sw.js', { updateViaCache: 'none' });
        expect(h.update).toHaveBeenCalledTimes(1);
        expect(h.window.updatePWAInstallUI).toHaveBeenCalledTimes(1);
        expect(h.reload).not.toHaveBeenCalled();
    });

    test('registration failure does not interrupt the document or PWA controls', async () => {
        const h = registrationHarness({ rejectRegistration: true });
        h.documentEvents.get('load')();
        await new Promise(resolve => setImmediate(resolve));
        expect(h.window.updatePWAInstallUI).toHaveBeenCalledTimes(1);
        expect(h.reload).not.toHaveBeenCalled();
    });
});
