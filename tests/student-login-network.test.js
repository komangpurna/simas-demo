const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const walk = require('acorn-walk');

const root = path.resolve(__dirname, '..');
const clientSource = fs.readFileSync(path.join(root, 'js/cloudflare-client.js'), 'utf8');
const clientAst = acorn.parse(clientSource, { ecmaVersion: 'latest', sourceType: 'module' });
const clientClass = clientAst.body.find(node => node.type === 'ClassDeclaration' && node.id.name === 'CloudflareClient');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const loginScript = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(source => source.includes("form.addEventListener('submit'"));
let submitCallback;
walk.simple(acorn.parse(loginScript, { ecmaVersion: 'latest', sourceType: 'module' }), {
    CallExpression(node) {
        if (node.callee.object?.name === 'form' && node.callee.property?.name === 'addEventListener'
            && node.arguments[0]?.value === 'submit') submitCallback = node.arguments[1];
    }
});

const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body)
});
const verified = { success: true, verified: true, token: 'signed-session', student: { nis: '1000' } };
const sessionSource = fs.readFileSync(path.join(root, 'js/student-session.mjs'), 'utf8');
const isRecoverableStudentSessionError = vm.runInNewContext(
    `${sessionSource.replace(/export /g, '')}\nisRecoverableStudentSessionError`
);

describe('Student login uses the production request and submit handlers', () => {
    let client;
    let fetchMock;
    let auth;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.spyOn(Math, 'random').mockReturnValue(0);
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'info').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        auth = { currentUser: { isAnonymous: true, getIdToken: jest.fn().mockResolvedValue('firebase-id-token') } };
        fetchMock = jest.fn();
        client = vm.runInNewContext(`${clientSource.slice(clientClass.start, clientClass.end)}\nnew CloudflareClient()`, {
            auth, CLOUDFLARE_CONFIG: { enabled: true, workerUrl: 'https://api.example.test' },
            fetch: fetchMock, AbortController, console, Math, setTimeout, clearTimeout
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    // Attach a rejection handler immediately, including when advancing fake timers.
    const outcome = pending => pending.then(value => ({ value }), error => ({ error }));
    const login = () => client.verifyStudentCredentials('1000', '2010-01-01', '');

    test.each(['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed'])
    ('recovers from browser network failure: %s', async message => {
        fetchMock.mockRejectedValueOnce(new TypeError(message)).mockResolvedValue(jsonResponse(200, verified));
        const result = outcome(login());
        await jest.runAllTimersAsync();
        expect((await result).value).toEqual(verified);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [url, options] = fetchMock.mock.calls[1];
        expect(url).toBe('https://api.example.test/api/students/verify-credentials');
        expect(options.headers.Authorization).toBe('Bearer firebase-id-token');
        expect(JSON.parse(options.body)).toEqual({ nis: '1000', birthDate: '2010-01-01', nisn: '' });
        expect(options.cache).toBe('no-store');
        expect(options).not.toHaveProperty('timeoutMs');
        expect(fetchMock.mock.calls[0][1].signal).not.toBe(options.signal);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('stops after three attempts and identifies an unreachable API', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
        const result = outcome(login());
        await jest.runAllTimersAsync();
        expect((await result).error.code).toBe('api/network-request-failed');
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('retries token retrieval without sending an unauthenticated verification request', async () => {
        auth.currentUser.getIdToken.mockRejectedValueOnce(Object.assign(new Error('Firebase: A network error has occurred.'), {
            code: 'auth/network-request-failed'
        }));
        fetchMock.mockResolvedValue(jsonResponse(200, verified));
        const result = outcome(login());
        await jest.runAllTimersAsync();
        expect((await result).value).toEqual(verified);
        expect(auth.currentUser.getIdToken).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer firebase-id-token');
    });

    test('preserves Firebase network error if a token cannot be retrieved', async () => {
        auth.currentUser.getIdToken.mockRejectedValue(Object.assign(new Error('Firebase: A network error has occurred.'), {
            code: 'auth/network-request-failed'
        }));
        const result = outcome(login());
        await jest.runAllTimersAsync();
        expect((await result).error.code).toBe('auth/network-request-failed');
        expect(auth.currentUser.getIdToken).toHaveBeenCalledTimes(3);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test.each([
        [500, 'D1_ERROR: storage operation exceeded timeout'],
        [502, '<html>Bad Gateway</html>'],
        [503, 'Service unavailable'],
        [504, 'Gateway timeout']
    ])('recovers from temporary backend failure %i', async (status, message) => {
        fetchMock.mockResolvedValueOnce(jsonResponse(status, { success: false, error: message }))
            .mockResolvedValue(jsonResponse(200, verified));
        const result = outcome(login());
        await jest.runAllTimersAsync();
        expect((await result).value).toEqual(verified);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test.each([
        [400, 'Kredensial wajib diisi'],
        [401, 'Tanggal lahir salah untuk NIS ini.'],
        [403, 'Akun siswa sudah tidak aktif'],
        [404, 'NIS tidak ditemukan'],
        [429, 'Terlalu banyak percobaan login. Silakan coba lagi dalam 15 menit.'],
        [500, 'Database constraint violation']
    ])('does not repeat credential failures, throttling, or permanent errors (%i)', async (status, message) => {
        fetchMock.mockResolvedValue(jsonResponse(status, { success: false, error: message }));
        const result = outcome(login());
        await jest.runAllTimersAsync();
        expect((await result).error).toMatchObject({ message, status });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('times out stalled requests, retries with fresh signals, and releases timers', async () => {
        fetchMock.mockImplementation((url, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }));
        const result = outcome(login());
        await jest.runAllTimersAsync();
        expect((await result).error.code).toBe('api/timeout');
        expect(fetchMock).toHaveBeenCalledTimes(3);
        const signals = fetchMock.mock.calls.map(([, options]) => options.signal);
        expect(new Set(signals).size).toBe(3);
        expect(signals.every(signal => signal.aborted)).toBe(true);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('also bounds response body download, then recovers', async () => {
        fetchMock.mockImplementationOnce(async (url, { signal }) => ({
            ok: true, status: 200,
            text: () => new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
            })
        })).mockResolvedValue(jsonResponse(200, verified));
        const result = outcome(login());
        await jest.runAllTimersAsync();
        expect((await result).value).toEqual(verified);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('caller cancellation is preserved without retrying', async () => {
        const controller = new AbortController();
        fetchMock.mockImplementation((url, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }));
        const result = outcome(client.request('/api/test', { timeoutMs: 15000, signal: controller.signal }));
        await jest.advanceTimersByTimeAsync(0);
        controller.abort();
        await jest.runAllTimersAsync();
        expect((await result).error.name).toBe('AbortError');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('other POST operations retain their no-retry default', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(client.request('/api/records', { method: 'POST', body: '{}' })).rejects.toThrow('Failed to fetch');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('ordinary GET still retries a temporary HTTP failure', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: 'Unavailable' }))
            .mockResolvedValue(jsonResponse(200, { success: true }));
        const result = outcome(client.request('/api/test'));
        await jest.runAllTimersAsync();
        expect((await result).value.success).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    function submitHarness() {
        const context = {
            window: { isLoggingIn: false }, btn: { disabled: false, innerHTML: 'Masuk' },
            errorDiv: { innerText: '', classList: { add: jest.fn(), remove: jest.fn() } },
            identityInput: { value: '1000' }, currentMode: 'siswa', getBirthdate: () => '2010-01-01',
            normalizeNIS: value => String(value).trim(), nisnInput: { value: '' },
            sessionStorage: { clear: jest.fn() }, localStorage: { length: 0 },
            auth, cfClient: client, console,
            signOut: jest.fn().mockResolvedValue(),
            signInAnonymously: jest.fn().mockResolvedValue({ user: auth.currentUser }),
            validateSiswaForm: jest.fn(), isRecoverableStudentSessionError
        };
        const submit = vm.runInNewContext(`(${loginScript.slice(submitCallback.start, submitCallback.end)})`, context);
        return { context, submit };
    }

    test.each([
        ['api/network-request-failed', 'Failed to fetch', 'LOGIN_NETWORK'],
        ['api/timeout', 'Koneksi ke server melewati batas waktu.', 'LOGIN_TIMEOUT'],
        ['api/connection-timeout', 'Timeout koneksi ke layanan SIMAS.', 'LOGIN_TIMEOUT'],
        ['api/fallback-unavailable', 'Jalur cadangan belum tersedia.', 'LOGIN_FALLBACK'],
        ['auth/network-request-failed', 'Firebase network error', 'LOGIN_NETWORK']
    ])('submit keeps error code %s and restores the form', async (code, message, diagnostic) => {
        client.verifyStudentCredentials = jest.fn().mockRejectedValue(Object.assign(new Error(message), { code }));
        const { context, submit } = submitHarness();
        await submit({ preventDefault: jest.fn() });
        expect(context.errorDiv.innerText).toContain(diagnostic);
        expect(context.errorDiv.innerText).toContain(diagnostic === 'LOGIN_FALLBACK' ? 'Wi-Fi/jaringan lain' : 'Wi-Fi/data seluler');
        expect(context.window.isLoggingIn).toBe(false);
        expect(context.btn.innerHTML).toBe('Masuk');
        expect(context.validateSiswaForm).toHaveBeenCalledTimes(1);
        // Failed API connectivity must not revoke an otherwise valid Firebase session.
        expect(context.signOut).toHaveBeenCalledTimes(1); // only the pre-login cleanup
    });

    test('submit describes backend failure without exposing internal errors', async () => {
        client.verifyStudentCredentials = jest.fn().mockRejectedValue(Object.assign(new Error('D1_ERROR: internal'), { status: 503 }));
        const { context, submit } = submitHarness();
        await submit({ preventDefault: jest.fn() });
        expect(context.errorDiv.innerText).toContain('LOGIN_SERVER');
        expect(context.errorDiv.innerText).not.toContain('D1_ERROR');
    });

    test('another submit cannot start a second anonymous login while one is pending', async () => {
        const { context, submit } = submitHarness();
        context.window.isLoggingIn = true;
        await submit({ preventDefault: jest.fn() });
        expect(context.signInAnonymously).not.toHaveBeenCalled();
        expect(context.btn.innerHTML).toBe('Masuk');
    });
});
