import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createWorkerFallback, installWorkerFallback } from '../js/worker-fallback.mjs';
import { createWorkerGateway } from '../supabase/functions/worker-gateway/handler.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import runtimeSource from './helpers/ui-runtime-source.cjs';

const primary = 'https://simas-smagesa-api.komangpurna1.workers.dev';
const gateway = 'https://project.supabase.co/functions/v1/worker-gateway';
const response = (status = 200, extra = {}) => new Response(JSON.stringify({ success: status === 200 }), {
    status, headers: { 'Content-Type': 'application/json', ...extra }
});
const gatewayResponse = status => response(status, { 'X-Simas-Gateway': 'worker-gateway-v1', 'X-Simas-Upstream-Reached': '1' });
const settled = promise => promise.then(value => ({ value }), error => ({ error }));
const urlOf = input => typeof input === 'string' ? input : input.url;
const memoryStorage = () => {
    const map = new Map();
    return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key), clear: () => map.clear() };
};

describe('Worker-first connection fallback', () => {
    let nativeFetch;
    let transport;
    let storage;
    const make = (options = {}) => createWorkerFallback({
        primaryUrl: primary, gatewayUrl: gateway, nativeFetch, storage,
        connectTimeoutMs: 100, probeTimeoutMs: 100, gatewayTimeoutMs: 500, ...options
    });
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-10-15T04:00:00Z'));
        storage = memoryStorage();
        nativeFetch = jest.fn(async input => urlOf(input).startsWith(gateway) ? gatewayResponse(200) : response());
        transport = make();
    });
    afterEach(() => { jest.useRealTimers(); });

    test('healthy reads use only Workers; unrelated services are passed through', async () => {
        const originalHeaders = { Authorization: 'Bearer firebase-token' };
        await transport.fetch(`${primary}/api/students?limit=10`, { headers: originalHeaders });
        await transport.fetch('https://project.supabase.co/rest/v1/students', { method: 'POST', body: '{}' });
        expect(nativeFetch).toHaveBeenCalledTimes(2);
        expect(nativeFetch.mock.calls[0][1].headers).toBe(originalHeaders);
        expect(nativeFetch.mock.calls[1]).toEqual(['https://project.supabase.co/rest/v1/students', { method: 'POST', body: '{}' }]);
        expect(transport.baseUrl).toBe(primary);
    });

    test.each([400, 401, 403, 404, 408, 429, 500, 502, 503, 504])('HTTP %i does not trigger Supabase', async status => {
        nativeFetch.mockResolvedValue(response(status));
        expect((await transport.fetch(`${primary}/api/students`)).status).toBe(status);
        expect(nativeFetch).toHaveBeenCalledTimes(1);
        expect(transport.baseUrl).toBe(primary);
    });

    test.each(['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed'])
    ('network failure (%s) replays a read through the gateway', async message => {
        nativeFetch.mockRejectedValueOnce(new TypeError(message));
        const headers = { Authorization: 'Bearer teacher-token', 'X-Student-Token': 'student-session' };
        await transport.fetch(`${primary}/api/records?date=2026-10-15`, { headers });
        expect(nativeFetch.mock.calls[1][0]).toBe(`${gateway}/api/records?date=2026-10-15`);
        expect(nativeFetch.mock.calls[1][1].headers).toBe(headers);
        expect(transport.baseUrl).toBe(gateway);
    });

    test('a stalled connection is aborted before falling back', async () => {
        nativeFetch.mockImplementationOnce((input, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }));
        const result = settled(transport.fetch(`${primary}/api/students`));
        await jest.runAllTimersAsync();
        expect((await result).value.status).toBe(200);
        expect(nativeFetch).toHaveBeenCalledTimes(2);
        expect(nativeFetch.mock.calls[0][1].signal.aborted).toBe(true);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('wrong credentials after a network failure stay a 401 and retain request body and token', async () => {
        nativeFetch.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(gatewayResponse(401));
        const init = { method: 'POST', body: JSON.stringify({ nis: 'test-nis', birthDate: '2010-01-01' }), headers: { Authorization: 'Bearer anonymous-token' } };
        expect((await transport.fetch(`${primary}/api/students/verify-credentials`, init)).status).toBe(401);
        expect(nativeFetch).toHaveBeenCalledTimes(2);
        expect(nativeFetch.mock.calls[1][1]).toMatchObject(init);
    });

    test('the affected browser remembers the fallback and retries Workers after five minutes', async () => {
        nativeFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await transport.fetch(`${primary}/api/students`);
        await make().fetch(`${primary}/api/records`);
        expect(nativeFetch.mock.calls[2][0]).toBe(`${gateway}/api/records`);
        await jest.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
        await make().fetch(`${primary}/api/teachers`);
        expect(nativeFetch.mock.calls[3][0]).toBe(`${primary}/api/teachers`);
        expect(transport.baseUrl).toBe(primary);
    });

    test('reset after a network change makes the next read go directly to Workers', async () => {
        nativeFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await transport.fetch(`${primary}/api/students`);
        transport.reset();
        await transport.fetch(`${primary}/api/students`);
        expect(nativeFetch.mock.calls[2][0]).toBe(`${primary}/api/students`);
    });

    test('an old failed request cannot re-enable sticky fallback after the network changes', async () => {
        let rejectOld;
        nativeFetch.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectOld = reject; }));
        const pending = transport.fetch(`${primary}/api/students`);
        transport.reset();
        rejectOld(new TypeError('Failed to fetch'));
        await pending;
        expect(transport.baseUrl).toBe(primary);
        await transport.fetch(`${primary}/api/students`);
        expect(nativeFetch.mock.calls[2][0]).toBe(`${primary}/api/students`);
    });

    test('a write rechecks the current network when an older connectivity probe finishes late', async () => {
        let rejectOld;
        nativeFetch.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectOld = reject; }));
        const pending = transport.fetch(`${primary}/api/records`, { method: 'POST', body: '{}' });
        transport.reset();
        rejectOld(new TypeError('Failed to fetch'));
        await pending;
        expect(nativeFetch.mock.calls.map(([url]) => urlOf(url))).toEqual([
            `${primary}/api/health`, `${primary}/api/health`, `${primary}/api/records`
        ]);
        expect(transport.baseUrl).toBe(primary);
    });

    test('storage being unavailable cannot prevent fallback', async () => {
        transport = make({ storage: { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } } });
        nativeFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        expect((await transport.fetch(`${primary}/api/students`)).status).toBe(200);
    });

    test('login storage cleanup does not lose the selected route on the next page', async () => {
        nativeFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await transport.fetch(`${primary}/api/students`);
        storage.clear();
        await transport.fetch(`${primary}/api/students`);
        expect(make().baseUrl).toBe(gateway);
    });

    test('a missing gateway is reported clearly and is never cached as usable', async () => {
        nativeFetch.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(response(404));
        await expect(transport.fetch(`${primary}/api/students`)).rejects.toMatchObject({ code: 'api/fallback-unavailable' });
        expect(transport.baseUrl).toBe(primary);
    });

    test('caller cancellation never triggers the gateway', async () => {
        const controller = new AbortController();
        nativeFetch.mockImplementation((input, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }));
        const result = settled(transport.fetch(`${primary}/api/students`, { signal: controller.signal }));
        controller.abort();
        await jest.runAllTimersAsync();
        expect((await result).error.name).toBe('AbortError');
        expect(nativeFetch).toHaveBeenCalledTimes(1);
    });

    test('caller abort still reaches the body download after response headers arrive', async () => {
        const controller = new AbortController();
        let activeSignal;
        nativeFetch.mockImplementationOnce(async (input, { signal }) => {
            activeSignal = signal;
            return new Response(new ReadableStream({ start(stream) {
                signal.addEventListener('abort', () => stream.error(signal.reason), { once: true });
            } }));
        });
        const result = await transport.fetch(`${primary}/api/students`, { signal: controller.signal });
        const body = settled(result.text());
        controller.abort();
        expect((await body).error.name).toBe('AbortError');
        expect(activeSignal.aborted).toBe(true);
        expect(nativeFetch).toHaveBeenCalledTimes(1);
    });

    test('body cancellation also works on browsers without AbortSignal.any', async () => {
        const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
        Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
        try {
            const controller = new AbortController();
            nativeFetch.mockImplementationOnce(async (input, { signal }) => new Response(new ReadableStream({ start(stream) {
                signal.addEventListener('abort', () => stream.error(signal.reason), { once: true });
            } })));
            const result = await transport.fetch(`${primary}/api/students`, { signal: controller.signal });
            const body = settled(result.text());
            controller.abort();
            expect((await body).error.name).toBe('AbortError');
            expect(nativeFetch).toHaveBeenCalledTimes(1);
        } finally {
            if (descriptor) Object.defineProperty(AbortSignal, 'any', descriptor);
            else delete AbortSignal.any;
        }
    });

    test('the installed global adapter is idempotent and does not intercept Firebase or other Supabase functions', async () => {
        const key = Symbol.for('simas.workerFallback');
        const originalFetch = globalThis.fetch;
        const previous = globalThis[key];
        delete globalThis[key];
        try {
            const installed = installWorkerFallback({ primaryUrl: primary, gatewayUrl: gateway, nativeFetch });
            expect(installWorkerFallback({ primaryUrl: primary, gatewayUrl: gateway, nativeFetch })).toBe(installed);
            expect(globalThis.fetch).toBe(installed.fetch);
            const firebase = new Request('https://identitytoolkit.googleapis.com/v1/accounts:signUp', { method: 'POST', body: '{}' });
            const restInit = { method: 'POST', body: '{}', headers: { Authorization: 'Bearer supabase-key' } };
            await globalThis.fetch(firebase);
            await globalThis.fetch('https://project.supabase.co/functions/v1/secure-proxy', restInit);
            await globalThis.fetch(`${primary}/api/health`, null);
            expect(nativeFetch.mock.calls[0]).toEqual([firebase, {}]);
            expect(nativeFetch.mock.calls[1]).toEqual(['https://project.supabase.co/functions/v1/secure-proxy', restInit]);
            expect(nativeFetch.mock.calls[2][0]).toBe(`${primary}/api/health`);
            expect(nativeFetch).toHaveBeenCalledTimes(3);
        } finally {
            globalThis.fetch = originalFetch;
            if (previous) globalThis[key] = previous;
            else delete globalThis[key];
        }
    });

    test('a fresh write probes connectivity before sending, then sends only once on Supabase', async () => {
        nativeFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const init = { method: 'POST', body: '{"note":"one"}' };
        await transport.fetch(`${primary}/api/records`, init);
        expect(nativeFetch.mock.calls.map(([url, options]) => [urlOf(url), options.method || 'GET'])).toEqual([
            [`${primary}/api/health`, 'GET'], [`${gateway}/api/health`, 'GET'], [`${gateway}/api/records`, 'POST']
        ]);
        expect(nativeFetch.mock.calls[2][1].body).toBe(init.body);
    });

    test('keepalive telemetry is dispatched immediately without awaiting a health probe', async () => {
        const result = transport.fetch(`${primary}/api/lms/progress`, { method: 'POST', body: '{}', keepalive: true });
        expect(nativeFetch).toHaveBeenCalledTimes(1);
        expect(nativeFetch.mock.calls[0][0]).toBe(`${primary}/api/lms/progress`);
        expect(nativeFetch.mock.calls[0][1].keepalive).toBe(true);
        await result;
    });

    test('parallel writes share the connectivity check without resending either write', async () => {
        nativeFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await Promise.all([
            transport.fetch(`${primary}/api/records`, { method: 'POST', body: '{"id":"a"}' }),
            transport.fetch(`${primary}/api/records`, { method: 'POST', body: '{"id":"b"}' })
        ]);
        expect(nativeFetch.mock.calls.filter(([url]) => urlOf(url).endsWith('/api/health'))).toHaveLength(2);
        expect(nativeFetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(2);
    });

    test('cancelling a write during the probe rejects immediately and never submits its body', async () => {
        nativeFetch.mockImplementationOnce((input, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }));
        const controller = new AbortController();
        const pending = settled(transport.fetch(`${primary}/api/records`, { method: 'POST', body: '{}', signal: controller.signal }));
        controller.abort();
        expect((await pending).error.name).toBe('AbortError');
        expect(nativeFetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(0);
        await jest.runAllTimersAsync();
        expect(nativeFetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(0);
    });

    test('a write already sent on a healthy route is never replayed after an ambiguous failure', async () => {
        await transport.fetch(`${primary}/api/health`);
        nativeFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await expect(transport.fetch(`${primary}/api/records`, { method: 'POST', body: '{}' }))
            .rejects.toMatchObject({ code: 'api/write-outcome-unknown' });
        expect(nativeFetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
        expect(nativeFetch.mock.calls.some(([url]) => urlOf(url).startsWith(gateway))).toBe(false);
    });

    function productionClient() {
        const source = fs.readFileSync(new URL('../js/cloudflare-client.js', import.meta.url), 'utf8');
        return vm.runInNewContext(`${source.slice(source.indexOf('class CloudflareClient'), source.indexOf('export const cfClient'))}\nnew CloudflareClient()`, {
            auth: { currentUser: { getIdToken: async () => 'id-token' } },
            CLOUDFLARE_CONFIG: { enabled: true, workerUrl: primary }, fetch: transport.fetch,
            AbortController, setTimeout, clearTimeout, console: { warn() {}, info() {} }
        });
    }

    test('the production client never retries a write when its response body is interrupted', async () => {
        nativeFetch.mockImplementation(async (input, init) => {
            if (urlOf(input).endsWith('/health')) return response();
            return new Response(new ReadableStream({ start(stream) {
                init.signal.addEventListener('abort', () => stream.error(init.signal.reason), { once: true });
            } }));
        });
        const result = settled(productionClient().request('/api/records/test', { method: 'PUT', body: '{}', timeoutMs: 20 }));
        await jest.runAllTimersAsync();
        expect((await result).error.code).toBe('api/write-outcome-unknown');
        expect(nativeFetch.mock.calls.filter(([, init]) => init.method === 'PUT')).toHaveLength(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('the production client never retries an uncertain upstream write reported by the gateway', async () => {
        nativeFetch.mockImplementation(async (input, init) => {
            const url = urlOf(input);
            if (url.startsWith(primary)) throw new TypeError('Failed to fetch');
            if (url.endsWith('/health')) return gatewayResponse(200);
            return new Response(JSON.stringify({ success: false, error: 'Check data before retrying', code: 'api/write-outcome-unknown' }), {
                status: 504, headers: { 'X-Simas-Gateway': 'worker-gateway-v1' }
            });
        });
        const result = settled(productionClient().request('/api/records/test', { method: 'PUT', body: '{}' }));
        await jest.runAllTimersAsync();
        expect((await result).error.code).toBe('api/write-outcome-unknown');
        expect(nativeFetch.mock.calls.filter(([, init]) => init.method === 'PUT')).toHaveLength(1);
    });

    test('the standalone cfFetch helper preserves an uncertain write code for its caller', async () => {
        const helperSource = runtimeSource.extractFunctions('js/cloudflare-client.js', ['getApiUrl', 'cfFetch']);
        const helper = vm.runInNewContext(`${helperSource}\ncfFetch`, {
            auth: { currentUser: { getIdToken: async () => 'id-token' } }, CLOUDFLARE_CONFIG: { workerUrl: primary },
            fetch: async () => new Response(JSON.stringify({ error: 'Check data before retrying', code: 'api/write-outcome-unknown' }), { status: 504 }),
            AbortController, setTimeout, clearTimeout, console: { warn() {} }
        });
        await expect(helper('/api/records', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: 504, code: 'api/write-outcome-unknown' });
    });

    test('Request objects can replay login bodies without losing headers', async () => {
        nativeFetch.mockImplementationOnce(async input => { await input.text(); throw new TypeError('Failed to fetch'); })
            .mockImplementationOnce(async input => {
                expect(input.url).toBe(`${gateway}/api/students/verify-credentials`);
                expect(await input.text()).toBe('{"nis":"test"}');
                expect(input.headers.get('Authorization')).toBe('Bearer firebase-token');
                return gatewayResponse(200);
            });
        await transport.fetch(new Request(`${primary}/api/students/verify-credentials`, {
            method: 'POST', body: '{"nis":"test"}', headers: { Authorization: 'Bearer firebase-token' }
        }));
        expect(nativeFetch).toHaveBeenCalledTimes(2);
    });

    test('only the configured origin and API prefix are eligible', async () => {
        for (const url of [`${primary}.evil.test/api/students`, `${primary}/other`, 'https://other.workers.dev/api/students']) {
            nativeFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
            await expect(transport.fetch(url)).rejects.toThrow('Failed to fetch');
        }
        expect(nativeFetch).toHaveBeenCalledTimes(3);
    });

    test('transport and real gateway preserve authorization and status end to end', async () => {
        const worker = jest.fn(async (url, init) => {
            expect(url).toBe(`${primary}/api/students/verify-credentials`);
            expect(init.headers.get('Authorization')).toBe('Bearer firebase-id-token');
            expect(new TextDecoder().decode(init.body)).toBe('{"nis":"test"}');
            return response(401);
        });
        const handler = createWorkerGateway({ nativeFetch: worker });
        nativeFetch.mockImplementation(async (url, init) => {
            if (url.startsWith(primary)) throw new TypeError('Failed to fetch');
            return handler(new Request(url, { ...init, headers: { ...init.headers, Origin: 'https://smagesa.web.app' } }));
        });
        const result = await transport.fetch(`${primary}/api/students/verify-credentials`, {
            method: 'POST', body: '{"nis":"test"}', headers: { Authorization: 'Bearer firebase-id-token' }
        });
        expect(result.status).toBe(401);
        expect(result.headers.get('Access-Control-Allow-Origin')).toBe('https://smagesa.web.app');
        expect(worker).toHaveBeenCalledTimes(1);
    });
});
