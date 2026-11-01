import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createWorkerGateway } from '../supabase/functions/worker-gateway/handler.mjs';

const endpoint = 'https://project.supabase.co/functions/v1/worker-gateway';
const primary = 'https://simas-smagesa-api.komangpurna1.workers.dev';
const origin = 'https://smagesa.web.app';
const request = (path = '/api/health', init = {}) => new Request(`${endpoint}${path}`, { ...init, headers: { Origin: origin, ...init.headers } });

describe('Supabase Worker gateway', () => {
    let fetchMock;
    let handler;
    beforeEach(() => {
        fetchMock = jest.fn().mockResolvedValue(new Response('{"status":"ok"}', { headers: { 'Content-Type': 'application/json' } }));
        handler = createWorkerGateway({ nativeFetch: fetchMock, maxBytes: 1024 });
    });
    afterEach(() => { jest.useRealTimers(); });

    test('preflight permits the actual client token headers without invoking the Worker', async () => {
        const result = await handler(request('/api/students/verify-credentials', { method: 'OPTIONS' }));
        expect(result.status).toBe(204);
        expect(result.headers.get('Access-Control-Allow-Headers')).toContain('x-student-token');
        expect(result.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
        expect(result.headers.get('Access-Control-Allow-Origin')).toBe(origin);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('caller-provided credentials stay unchanged; cookies, infrastructure IPs, and server credentials are not injected', async () => {
        await handler(request('/api/records?class=X', { method: 'POST', body: '{"data":"one"}', headers: {
            Authorization: 'Bearer firebase-token', 'X-Student-Token': 'student-token', 'Content-Type': 'application/json',
            Cookie: 'private=1', 'CF-Connecting-IP': '1.2.3.4', 'X-Forwarded-For': '5.6.7.8', 'X-Sync-Key': 'untrusted'
        } }));
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${primary}/api/records?class=X`);
        expect(init.method).toBe('POST');
        expect(new TextDecoder().decode(init.body)).toBe('{"data":"one"}');
        expect(init.headers.get('Authorization')).toBe('Bearer firebase-token');
        expect(init.headers.get('X-Student-Token')).toBe('student-token');
        expect(init.headers.get('X-Sync-Key')).toBe('untrusted'); // Worker still has to verify this value.
        for (const name of ['cookie', 'cf-connecting-ip', 'x-forwarded-for', 'apikey']) expect(init.headers.has(name)).toBe(false);
        expect(init.redirect).toBe('manual');
    });

    test.each([401, 403, 404, 429, 503])('returns upstream status %i and body without changing permissions', async status => {
        fetchMock.mockResolvedValue(new Response('{"error":"denied"}', { status }));
        const result = await handler(request('/api/students'));
        expect(result.status).toBe(status);
        expect(await result.text()).toBe('{"error":"denied"}');
        expect(result.headers.get('X-Simas-Upstream-Reached')).toBe('1');
        expect(result.headers.get('Cache-Control')).toBe('no-store');
    });

    test('an external Origin is rejected', async () => {
        const result = await handler(request('/api/students', { headers: { Origin: 'https://evil.test' } }));
        expect(result.status).toBe(403);
        expect(result.headers.has('Access-Control-Allow-Origin')).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test.each(['/other', '/https://evil.test/api/health', '/api/../outside'])('rejects paths outside the API: %s', async path => {
        expect((await handler(request(path))).status).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('URL-looking parameters cannot change the fixed upstream', async () => {
        await handler(request('/api/health?url=https://evil.test&target=http://127.0.0.1'));
        expect(fetchMock.mock.calls[0][0]).toBe(`${primary}/api/health?url=https://evil.test&target=http://127.0.0.1`);
    });

    test('never follows upstream redirects with a user token', async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://evil.test' } }));
        const result = await handler(request('/api/students', { headers: { Authorization: 'Bearer token' } }));
        expect(result.status).toBe(502);
        expect(result.headers.has('Location')).toBe(false);
        expect(result.headers.has('X-Simas-Upstream-Reached')).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('limits streamed request bodies even without Content-Length', async () => {
        const result = await handler(request('/api/records', { method: 'POST', body: 'a'.repeat(1025) }));
        expect(result.status).toBe(413);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('limits upstream response bodies and does not expose a partial result', async () => {
        fetchMock.mockResolvedValue(new Response('a'.repeat(1025)));
        const result = await handler(request('/api/students'));
        expect(result.status).toBe(413);
        expect(result.headers.has('X-Simas-Upstream-Reached')).toBe(false);
    });

    test('binary responses retain their bytes and MIME type', async () => {
        fetchMock.mockResolvedValue(new Response(new Uint8Array([0, 128, 255]), { headers: { 'Content-Type': 'image/webp' } }));
        const result = await handler(request('/api/photos/test'));
        expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([0, 128, 255]);
        expect(result.headers.get('Content-Type')).toBe('image/webp');
    });

    test('does not relax security headers provided by the Worker', async () => {
        fetchMock.mockResolvedValue(new Response('{}', { headers: {
            'Content-Security-Policy': "default-src 'none'", 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer'
        } }));
        const result = await handler(request());
        expect(result.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
        expect(result.headers.get('X-Frame-Options')).toBe('DENY');
        expect(result.headers.get('Referrer-Policy')).toBe('no-referrer');
    });

    test('accepts the function-relative path used by the Supabase runtime', async () => {
        const result = await handler(new Request('http://edge-runtime/worker-gateway/api/health'));
        expect(result.status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe(`${primary}/api/health`);
    });

    test('timeout cancels the upstream request and returns 504', async () => {
        jest.useFakeTimers();
        handler = createWorkerGateway({ nativeFetch: fetchMock, timeoutMs: 50 });
        fetchMock.mockImplementation((url, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }));
        const pending = handler(request());
        await jest.runAllTimersAsync();
        const result = await pending;
        expect(result.status).toBe(504);
        expect(result.headers.has('X-Simas-Upstream-Reached')).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('a write with an interrupted upstream response is marked uncertain, not replayable', async () => {
        fetchMock.mockRejectedValue(new TypeError('fetch failed'));
        const result = await handler(request('/api/records', { method: 'POST', body: '{}' }));
        expect(result.status).toBe(502);
        expect(await result.json()).toMatchObject({ code: 'api/write-outcome-unknown' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
