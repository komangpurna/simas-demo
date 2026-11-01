import { jest } from '@jest/globals';
import fs from 'node:fs';
import vm from 'node:vm';
import { verifyStudentSession, isRecoverableStudentSessionError, isExpiredStudentSessionError } from '../js/student-session.mjs';

const validToken = nis => ({ claims: { studentVerified: true, studentNis: nis } });
const networkError = () => Object.assign(new Error('Network unavailable'), { code: 'auth/network-request-failed' });
const makeUser = (nis = '00123') => ({ uid: 'student-uid', isAnonymous: true, getIdTokenResult: jest.fn().mockResolvedValue(validToken(nis)) });
function storage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key),
        clear: jest.fn(() => values.clear()),
        key: index => [...values.keys()][index] ?? null,
        get length() { return values.size; }
    };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

describe('Verified student tokens', () => {
    test('reuses a valid token without forcing a network refresh', async () => {
        const user = makeUser();
        await expect(verifyStudentSession(user, '00123')).resolves.toEqual(validToken('00123'));
        expect(user.getIdTokenResult).toHaveBeenCalledTimes(1);
        expect(user.getIdTokenResult).toHaveBeenCalledWith(false);
    });

    test('recovers a single network failure and delayed claims', async () => {
        const user = makeUser();
        user.getIdTokenResult.mockRejectedValueOnce(networkError()).mockResolvedValueOnce({ claims: {} });
        const pending = verifyStudentSession(user, '00123');
        await jest.advanceTimersByTimeAsync(1800);
        await expect(pending).resolves.toEqual(validToken('00123'));
        expect(user.getIdTokenResult).toHaveBeenLastCalledWith(true);
    });

    test('never accepts missing claims after all retries', async () => {
        const user = makeUser();
        user.getIdTokenResult.mockResolvedValue({ claims: {} });
        const pending = expect(verifyStudentSession(user, '00123')).rejects.toMatchObject({ code: 'session/claims-pending' });
        await jest.advanceTimersByTimeAsync(4200);
        await pending;
    });

    test('rejects another NIS even if browser storage claims it belongs to this student', async () => {
        const pending = expect(verifyStudentSession(makeUser('00999'), '00123')).rejects.toMatchObject({ code: 'session/identity-mismatch' });
        await jest.advanceTimersByTimeAsync(4200);
        await pending;
    });

    test('revoked credentials fail immediately without a retry', async () => {
        const user = makeUser();
        user.getIdTokenResult.mockRejectedValue({ code: 'auth/user-token-expired' });
        await expect(verifyStudentSession(user, '00123')).rejects.toMatchObject({ code: 'auth/user-token-expired' });
        expect(user.getIdTokenResult).toHaveBeenCalledTimes(1);
        expect(isExpiredStudentSessionError({ code: 'auth/user-token-expired' })).toBe(true);
        expect(isRecoverableStudentSessionError({ code: 'auth/user-token-expired' })).toBe(false);
    });

    test('gateway timeouts and temporary server failures are recoverable', () => {
        expect(isRecoverableStudentSessionError({ code: 'api/timeout' })).toBe(true);
        expect(isRecoverableStudentSessionError({ code: 'api/network-request-failed' })).toBe(true);
        expect(isRecoverableStudentSessionError({ code: 'api/error', status: 503 })).toBe(true);
        expect(isRecoverableStudentSessionError({ code: 'api/error', status: 403 })).toBe(false);
    });

    test('an account switch cancels a pending verification', async () => {
        let resolveToken;
        let current = true;
        const user = makeUser();
        user.getIdTokenResult.mockImplementation(() => new Promise(resolve => { resolveToken = resolve; }));
        const pending = expect(verifyStudentSession(user, '00123', { isCurrent: () => current })).rejects.toMatchObject({ code: 'session/superseded' });
        current = false;
        resolveToken(validToken('00123'));
        await pending;
    });
});

function portalHarness(user = makeUser(), initialStorage = { student_nis: '00123' }) {
    const source = fs.readFileSync(new URL('../js/page-portal-siswa.js', import.meta.url), 'utf8');
    const windowObject = new EventTarget();
    Object.assign(windowObject, {
        location: { hostname: 'example.test', search: '', replace: jest.fn() },
        getSystemConfig: jest.fn().mockResolvedValue({}), showToast: jest.fn()
    });
    const documentObject = new EventTarget();
    Object.assign(documentObject, { visibilityState: 'visible', getElementById: () => null });
    const auth = { currentUser: user, authStateReady: async () => {} };
    const sessionStorage = storage(initialStorage);
    const loadStudentData = jest.fn();
    const signOut = jest.fn(async () => { auth.currentUser = null; });
    let callback;
    const context = vm.createContext({
        window: windowObject, document: documentObject, auth, sessionStorage, signOut,
        verifyStudentSession, isRecoverableStudentSessionError, isExpiredStudentSessionError,
        APP_VERSION: 'test', SCHOOL_CONFIG: {}, currentNIS: null, loadStudentData,
        setTimeout, clearTimeout, console: { log() {}, warn() {} },
        onAuthStateChanged: (_auth, cb) => { callback = cb; }
    });
    vm.runInContext(source.slice(source.indexOf('let portalSessionCheck'), source.indexOf('// Utility to prevent XSS')), context);
    return { user, auth, sessionStorage, loadStudentData, signOut, window: windowObject, run: value => callback(value) };
}

describe('Portal recovery using the actual page initialization', () => {
    test('an existing valid session opens the same portal immediately', async () => {
        const h = portalHarness();
        await h.run(h.user);
        expect(h.loadStudentData).toHaveBeenCalledWith('00123');
        expect(h.window.showToast).not.toHaveBeenCalled();
        expect(h.signOut).not.toHaveBeenCalled();
    });

    test('offline verification preserves the session and resumes when online', async () => {
        const h = portalHarness();
        h.user.getIdTokenResult.mockRejectedValue(networkError());
        const pending = h.run(h.user);
        await jest.advanceTimersByTimeAsync(4200);
        await pending;
        expect(h.sessionStorage.getItem('student_nis')).toBe('00123');
        expect(h.signOut).not.toHaveBeenCalled();
        expect(h.loadStudentData).not.toHaveBeenCalled();
        expect(h.window.location.replace).not.toHaveBeenCalled();
        h.user.getIdTokenResult.mockResolvedValue(validToken('00123'));
        h.window.dispatchEvent(new Event('online'));
        await jest.advanceTimersByTimeAsync(0);
        expect(h.loadStudentData).toHaveBeenCalledTimes(1);
    });

    test('pending claims keep data blocked until automatic retry succeeds', async () => {
        const h = portalHarness();
        h.user.getIdTokenResult.mockResolvedValue({ claims: {} });
        const pending = h.run(h.user);
        await jest.advanceTimersByTimeAsync(4200);
        await pending;
        expect(h.loadStudentData).not.toHaveBeenCalled();
        expect(h.sessionStorage.clear).not.toHaveBeenCalled();
        h.user.getIdTokenResult.mockResolvedValue(validToken('00123'));
        await jest.advanceTimersByTimeAsync(15000);
        expect(h.loadStudentData).toHaveBeenCalledWith('00123');
    });

    test('a new tab restores its NIS only from verified Firebase claims', async () => {
        const h = portalHarness(makeUser(), {});
        await h.run(h.user);
        expect(h.sessionStorage.getItem('student_nis')).toBe('00123');
        expect(h.loadStudentData).toHaveBeenCalledWith('00123');
        expect(h.signOut).not.toHaveBeenCalled();
    });

    test('a mismatched tab cannot load data or sign out the other account', async () => {
        const h = portalHarness(makeUser('00999'));
        const pending = h.run(h.user);
        await jest.advanceTimersByTimeAsync(4200);
        await pending;
        expect(h.loadStudentData).not.toHaveBeenCalled();
        expect(h.signOut).not.toHaveBeenCalled();
        expect(h.window.location.replace).toHaveBeenCalledWith('index.html?status=session_invalid');
    });

    test('a revoked token still ends the student session', async () => {
        const h = portalHarness();
        h.user.getIdTokenResult.mockRejectedValue({ code: 'auth/user-disabled' });
        await h.run(h.user);
        expect(h.signOut).toHaveBeenCalledTimes(1);
        expect(h.sessionStorage.clear).toHaveBeenCalledTimes(1);
        expect(h.loadStudentData).not.toHaveBeenCalled();
    });

    test('logout cancels a late token response without reopening the portal', async () => {
        const h = portalHarness();
        let resolveToken;
        h.user.getIdTokenResult.mockImplementation(() => new Promise(resolve => { resolveToken = resolve; }));
        const pending = h.run(h.user);
        await jest.advanceTimersByTimeAsync(0);
        h.auth.currentUser = null;
        await h.run(null);
        resolveToken(validToken('00123'));
        await pending;
        expect(h.loadStudentData).not.toHaveBeenCalled();
        expect(h.window.location.replace).toHaveBeenCalledTimes(1);
        expect(h.window.location.replace).toHaveBeenCalledWith('index.html?status=session_unavailable');
    });

    test('idle logout retains ownership of its original message and redirect', async () => {
        const h = portalHarness();
        h.window._simasIdleLogoutInProgress = true;
        h.auth.currentUser = null;
        await h.run(null);
        expect(h.window.location.replace).not.toHaveBeenCalled();
    });
});

function loginHarness(user = makeUser()) {
    const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const start = source.indexOf("form.addEventListener('submit', async");
    const classList = { add: jest.fn(), remove: jest.fn(), contains: () => true };
    const auth = { currentUser: null };
    const sessionStorage = storage();
    const location = { href: '' };
    const errorDiv = { classList };
    let submit;
    const context = vm.createContext({
        form: { addEventListener: (_event, callback) => { submit = callback; } },
        btn: { innerHTML: 'Masuk Aplikasi' }, errorDiv, window: { location },
        identityInput: { value: '00123' }, nisnInput: { value: '' }, currentMode: 'siswa',
        normalizeNIS: value => value, getBirthdate: () => '2008-01-01', auth, sessionStorage, localStorage: storage(),
        signInAnonymously: async () => { auth.currentUser = user; return { user }; }, signOut: jest.fn(),
        cfClient: { verifyStudentCredentials: async () => ({ verified: true, student: { nis: '00123' }, token: 'verified-worker-token' }) },
        verifyStudentSession, isRecoverableStudentSessionError, validateSiswaForm: jest.fn(),
        nisnContainer: { classList }, setTimeout, clearTimeout, doc: () => ({}), db: {}, PATHS: {},
        getDoc: async () => ({ exists: () => false }), console: { error() {}, warn() {} }
    });
    vm.runInContext(source.slice(start, source.indexOf('// === GOOGLE AUTH LOGIN', start)), context);
    return { user, sessionStorage, location, errorDiv, run: () => submit({ preventDefault() {} }) };
}

describe('Existing login form', () => {
    test('waits for verified claims before saving session and redirecting', async () => {
        const h = loginHarness();
        h.user.getIdTokenResult.mockResolvedValueOnce({ claims: {} });
        const pending = h.run();
        await jest.advanceTimersByTimeAsync(0);
        expect(h.location.href).toBe('');
        expect(h.sessionStorage.getItem('student_nis')).toBeNull();
        await jest.advanceTimersByTimeAsync(600);
        await pending;
        expect(h.location.href).toBe('portal-siswa.html');
        expect(h.sessionStorage.getItem('student_token')).toBe('verified-worker-token');
    });

    test('exhausted claim retries leave the form usable and never open an unverified portal', async () => {
        const h = loginHarness();
        h.user.getIdTokenResult.mockResolvedValue({ claims: {} });
        const pending = h.run();
        await jest.advanceTimersByTimeAsync(4200);
        await pending;
        expect(h.location.href).toBe('');
        expect(h.sessionStorage.getItem('student_nis')).toBeNull();
        expect(h.errorDiv.innerText).toContain('belum selesai');
    });
});

test('opening login in a new tab does not revoke the Firebase session of another tab', async () => {
    const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const start = source.indexOf('// --- AUTO REDIRECT UNTUK SESI AKTIF ---');
    let callback;
    const signOut = jest.fn();
    const context = vm.createContext({
        auth: { currentUser: makeUser() }, sessionStorage: storage(), localStorage: storage(),
        window: { location: { search: '', href: 'https://example.test/index.html', replace: jest.fn() } },
        URLSearchParams, getSafeRedirectUrl: () => null, signOut,
        onAuthStateChanged: (_auth, cb) => { callback = cb; }
    });
    vm.runInContext(source.slice(start, source.indexOf('// Tampilkan petunjuk', start)), context);
    await callback(makeUser());
    expect(signOut).not.toHaveBeenCalled();
});

function peminatanHarness() {
    const source = fs.readFileSync(new URL('../js/page-peminatan.js', import.meta.url), 'utf8');
    const user = makeUser();
    const auth = { currentUser: user };
    const sessionStorage = storage({ student_nis: '00123' });
    const windowObject = new EventTarget();
    Object.assign(windowObject, { location: { replace: jest.fn() }, showToast: jest.fn() });
    const documentObject = new EventTarget();
    Object.assign(documentObject, { visibilityState: 'visible', getElementById: () => ({}), body: { style: {} } });
    let callback;
    const cfClient = { enabled: true, getStudentByNis: jest.fn().mockResolvedValue({ nis: '00123', name: 'Student', class: 'X.1' }) };
    const signOut = jest.fn();
    const loadQuestions = jest.fn();
    const context = vm.createContext({
        auth, sessionStorage, window: windowObject, document: documentObject, cfClient, signOut, loadQuestions,
        verifyStudentSession, isRecoverableStudentSessionError, isExpiredStudentSessionError,
        setTimeout, clearTimeout, console: { error() {}, warn() {} },
        onAuthStateChanged: (_auth, cb) => { callback = cb; },
        currentStudent: null, currentTA: '', doc: () => ({}), db: {}, serverTimestamp: () => ({}),
        setDoc: async () => {}, initLayout() {}, setupHonestyModal() {}, currentLayout: 'classic'
    });
    vm.runInContext(source.slice(source.indexOf('let peminatanSessionCheck'), source.indexOf('function setupHonestyModal')), context);
    return { user, auth, sessionStorage, window: windowObject, cfClient, signOut, loadQuestions, run: () => callback(user) };
}

describe('Peminatan session and profile recovery', () => {
    test('a temporary profile fetch failure keeps the session and resumes automatically', async () => {
        const h = peminatanHarness();
        h.cfClient.getStudentByNis.mockRejectedValueOnce(Object.assign(new Error('Gateway temporarily unavailable'), { status: 503 }));
        await h.run();
        expect(h.signOut).not.toHaveBeenCalled();
        expect(h.sessionStorage.clear).not.toHaveBeenCalled();
        expect(h.loadQuestions).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(15000);
        expect(h.loadQuestions).toHaveBeenCalledTimes(1);
    });

    test('missing student profile data never revokes another tab session', async () => {
        const h = peminatanHarness();
        h.cfClient.getStudentByNis.mockResolvedValue(null);
        await h.run();
        expect(h.signOut).not.toHaveBeenCalled();
        expect(h.loadQuestions).not.toHaveBeenCalled();
        expect(h.window.showToast).toHaveBeenCalled();
    });
});
