const WORKER_ORIGIN = "https://simas-demo-api.komangpurna1.workers.dev";
const ALLOWED_ORIGINS = new Set(["https://simas-demo-5ead3.web.app","https://simas-demo-5ead3.firebaseapp.com"]);
const METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';
const FORWARD_HEADERS = ['accept', 'content-type', 'authorization', 'x-student-token', 'x-simas-client',
    'x-requested-with', 'x-migration-key', 'x-sync-key', 'x-api-key', 'range', 'if-none-match', 'user-agent'];
const RESPONSE_HEADERS = ['content-type', 'content-disposition', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'retry-after',
    'content-security-policy', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'cross-origin-resource-policy'];

async function readBounded(stream, maxBytes, signal) {
    if (!stream) return null;
    const reader = stream.getReader();
    const chunks = [];
    let length = 0;
    const cancel = () => { reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
        while (true) {
            if (signal.aborted) throw signal.reason;
            const { done, value } = await reader.read();
            if (signal.aborted) throw signal.reason;
            if (done) break;
            length += value.byteLength;
            if (length > maxBytes) {
                await reader.cancel();
                throw Object.assign(new Error('Payload too large'), { status: 413 });
            }
            chunks.push(value);
        }
    } finally {
        signal.removeEventListener('abort', cancel);
        reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
}

// This gateway has no database credentials and grants no permissions. The fixed Worker
// still verifies Firebase/Student tokens and enforces its own route authorization.
export function createWorkerGateway({ nativeFetch = globalThis.fetch.bind(globalThis), timeoutMs = 60000, maxBytes = 32 * 1024 * 1024 } = {}) {
    return async function workerGateway(request) {
        const origin = request.headers.get('Origin') || '';
        const allowed = !origin || ALLOWED_ORIGINS.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
        const headers = new Headers({
            'Vary': 'Origin', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            'X-Simas-Gateway': 'worker-gateway-v1',
            'Access-Control-Allow-Methods': METHODS,
            'Access-Control-Allow-Headers': FORWARD_HEADERS.filter(name => name !== 'user-agent').join(', '),
            'Access-Control-Expose-Headers': [...RESPONSE_HEADERS, 'X-Simas-Gateway', 'X-Simas-Upstream-Reached'].join(', '),
            'Access-Control-Max-Age': '600'
        });
        if (allowed) headers.set('Access-Control-Allow-Origin', origin || '*');
        const fail = (error, status, code = undefined) => {
            const failureHeaders = new Headers(headers);
            failureHeaders.set('Content-Type', 'application/json; charset=utf-8');
            return new Response(JSON.stringify({ success: false, error, code }), { status, headers: failureHeaders });
        };
        if (!allowed) return fail('Origin tidak diizinkan.', 403);
        const url = new URL(request.url);
        const match = url.pathname.match(/^\/(?:functions\/v1\/)?worker-gateway(\/api\/.*)$/);
        if (!match) return fail('Endpoint cadangan tidak ditemukan.', 404);
        if (!METHODS.split(', ').includes(request.method)) return fail('Metode tidak diizinkan.', 405);
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
        if (Number(request.headers.get('Content-Length') || 0) > maxBytes) return fail('Ukuran permintaan terlalu besar untuk jalur cadangan.', 413);

        const controller = new AbortController();
        const abortFromCaller = () => controller.abort(new DOMException('Request aborted', 'AbortError'));
        if (request.signal.aborted) abortFromCaller();
        else request.signal.addEventListener('abort', abortFromCaller, { once: true });
        let timedOut = false;
        let upstreamStarted = false;
        const safe = ['GET', 'HEAD', 'OPTIONS'].includes(request.method)
            || (request.method === 'POST' && match[1] === '/api/students/verify-credentials');
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort(new DOMException('Gateway timeout', 'TimeoutError'));
        }, timeoutMs);
        try {
            const upstreamHeaders = new Headers();
            for (const name of FORWARD_HEADERS) {
                const value = request.headers.get(name);
                if (value) upstreamHeaders.set(name, value);
            }
            if (origin) upstreamHeaders.set('Origin', origin);
            const body = ['GET', 'HEAD'].includes(request.method) ? null : await readBounded(request.body, maxBytes, controller.signal);
            const target = new URL(WORKER_ORIGIN);
            target.pathname = match[1];
            target.search = url.search;
            // Do not follow redirects carrying credentials, and never accept an arbitrary upstream URL.
            upstreamStarted = true;
            const upstream = await nativeFetch(target.toString(), {
                method: request.method, headers: upstreamHeaders, body, redirect: 'manual', signal: controller.signal
            });
            if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) {
                await upstream.body?.cancel();
                return fail('Pengalihan layanan tidak diizinkan pada jalur cadangan.', 502, safe ? undefined : 'api/write-outcome-unknown');
            }
            const bytes = await readBounded(upstream.body, maxBytes, controller.signal);
            for (const name of RESPONSE_HEADERS) {
                const value = upstream.headers.get(name);
                if (value) headers.set(name, value);
            }
            headers.set('X-Simas-Upstream-Reached', '1');
            return new Response(request.method === 'HEAD' || [204, 205, 304].includes(upstream.status) ? null : bytes, {
                status: upstream.status, headers
            });
        } catch (error) {
            if (upstreamStarted && !safe) {
                return fail('Koneksi terputus saat menyimpan. Periksa data terbaru sebelum mencoba lagi.', timedOut ? 504 : 502, 'api/write-outcome-unknown');
            }
            if (error?.status === 413) return fail('Ukuran data terlalu besar untuk jalur cadangan.', 413);
            return fail(timedOut ? 'Jalur cadangan melewati batas waktu tunggu.' : 'Jalur cadangan belum dapat menjangkau layanan SIMAS.', timedOut ? 504 : 502);
        } finally {
            clearTimeout(timer);
            request.signal.removeEventListener('abort', abortFromCaller);
        }
    };
}
