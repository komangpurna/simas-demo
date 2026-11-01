import { jest, test, expect, afterEach } from '@jest/globals';
import { checkWorkerGateway } from '../scripts/check-worker-gateway.mjs';

const validHeaders = { 'X-Simas-Gateway': 'worker-gateway-v1', 'X-Simas-Upstream-Reached': '1', 'Access-Control-Allow-Origin': 'https://smagesa.web.app' };
afterEach(() => jest.useRealTimers());

test('a reachable gateway with working CORS and Worker health permits a frontend release', async () => {
    const nativeFetch = jest.fn().mockResolvedValue(new Response('{"status":"ok"}', { headers: validHeaders }));
    await expect(checkWorkerGateway({ nativeFetch })).resolves.toBeUndefined();
    expect(nativeFetch.mock.calls[0][1].headers.Origin).toBe('https://smagesa.web.app');
});
test.each([401, 404, 502, 503])('an unavailable gateway (%i) blocks a frontend release', async status => {
    await expect(checkWorkerGateway({ nativeFetch: async () => new Response('{}', { status }) })).rejects.toThrow(`HTTP ${status}`);
});
test.each(['X-Simas-Gateway', 'X-Simas-Upstream-Reached', 'Access-Control-Allow-Origin'])('missing %s blocks a frontend release', async field => {
    const headers = { ...validHeaders }; delete headers[field];
    await expect(checkWorkerGateway({ nativeFetch: async () => new Response('{"status":"ok"}', { headers }) })).rejects.toThrow();
});
test('a successful HTTP response from the wrong app cannot satisfy readiness', async () => {
    await expect(checkWorkerGateway({ nativeFetch: async () => new Response('{"status":"not-ready"}', { headers: validHeaders }) })).rejects.toThrow('not ready');
});
test('a health check with a stalled body times out and cannot publish an unverified frontend', async () => {
    jest.useFakeTimers();
    const pending = checkWorkerGateway({ timeoutMs: 25, nativeFetch: async (url, { signal }) => new Response(new ReadableStream({ start(stream) {
        signal.addEventListener('abort', () => stream.error(new DOMException('Aborted', 'AbortError')), { once: true });
    } }), { headers: validHeaders }) }).catch(error => error);
    await jest.runAllTimersAsync();
    expect((await pending).name).toBe('AbortError');
    expect(jest.getTimerCount()).toBe(0);
});
