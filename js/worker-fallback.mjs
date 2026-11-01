const STORAGE_KEY = 'simas_worker_fallback_v1';
const GATEWAY_MARKER = 'worker-gateway-v1';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SAFE_POST_PATHS = new Set(['/api/students/verify-credentials']);

function networkFailure(error) {
    return error?.code === 'api/connection-timeout'
        || /failed to fetch|fetch failed|network\s?error|load failed|network connection was lost/i.test(error?.message || '');
}

function abortError(signal) {
    return signal?.reason || new DOMException('Request aborted', 'AbortError');
}

function waitForRoute(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(abortError(signal));
    return new Promise((resolve, reject) => {
        const cleanup = () => signal.removeEventListener('abort', onAbort);
        const onAbort = () => { cleanup(); reject(abortError(signal)); };
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
}

export function createWorkerFallback({
    primaryUrl, gatewayUrl, nativeFetch = globalThis.fetch.bind(globalThis),
    storage = null, now = Date.now, connectTimeoutMs = 5000,
    probeTimeoutMs = 3000, gatewayTimeoutMs = 60000, fallbackTtlMs = 5 * 60 * 1000,
    primaryFreshMs = 60 * 1000
}) {
    const primary = primaryUrl.replace(/\/+$/, '');
    const gateway = (gatewayUrl || '').replace(/\/+$/, '');
    let fallbackUntil = 0;
    let primaryReachedAt = null;
    let writeRouteCheck = null;
    let generation = 0;
    try {
        const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
        if (saved?.primary === primary && saved?.gateway === gateway
            && saved.until > now() && saved.until <= now() + fallbackTtlMs) fallbackUntil = saved.until;
    } catch (_) {}

    const fallbackActive = () => Boolean(gateway && fallbackUntil > now());
    function saveFallback() {
        try { storage?.setItem(STORAGE_KEY, JSON.stringify({ primary, gateway, until: fallbackUntil })); } catch (_) {}
    }
    function useFallback() {
        fallbackUntil = now() + fallbackTtlMs;
        saveFallback();
    }
    function reset() {
        generation++;
        fallbackUntil = 0;
        primaryReachedAt = null;
        writeRouteCheck = null;
        try { storage?.removeItem(STORAGE_KEY); } catch (_) {}
    }
    function apiPath(input) {
        let url;
        try { url = new URL(typeof input?.url === 'string' ? input.url : String(input), globalThis.location?.href); }
        catch (_) { return null; }
        for (const base of [primary, gateway].filter(Boolean)) {
            const baseUrl = new URL(base);
            const prefix = baseUrl.pathname.replace(/\/+$/, '');
            if (url.origin !== baseUrl.origin || !url.pathname.startsWith(`${prefix}/api/`)) continue;
            return url.pathname.slice(prefix.length) + url.search;
        }
        return null;
    }
    function gatewayReached(response) {
        return response.headers.get('X-Simas-Gateway') === GATEWAY_MARKER
            && response.headers.get('X-Simas-Upstream-Reached') === '1';
    }
    async function timedFetch(url, input, init, timeoutMs) {
        const callerSignal = init.signal || input?.signal;
        if (callerSignal?.aborted) throw abortError(callerSignal);
        const controller = new AbortController();
        let timedOut = false;
        const combined = callerSignal && typeof AbortSignal.any === 'function';
        const onAbort = () => controller.abort(callerSignal.reason);
        if (!combined) callerSignal?.addEventListener('abort', onAbort, { once: true });
        const signal = combined ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
        let receivedHeaders = false;
        const timer = timeoutMs > 0 ? setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs) : null;
        try {
            const requestInput = typeof Request !== 'undefined' && input instanceof Request ? new Request(url, input) : url;
            const response = await nativeFetch(requestInput, { ...init, signal });
            receivedHeaders = true;
            return response;
        } catch (error) {
            if (callerSignal?.aborted) throw abortError(callerSignal);
            if (timedOut) throw Object.assign(new Error('Timeout koneksi ke layanan SIMAS.'), { code: 'api/connection-timeout' });
            throw error;
        } finally {
            if (timer !== null) clearTimeout(timer);
            // On older browsers the once-listener must also relay cancellation during body download.
            if (combined || !receivedHeaders) callerSignal?.removeEventListener('abort', onAbort);
        }
    }
    async function gatewayFetch(path, input, init, requestGeneration) {
        const response = await timedFetch(`${gateway}${path}`, input, init, gatewayTimeoutMs);
        if (gatewayReached(response) && requestGeneration === generation) {
            if (!fallbackActive()) useFallback();
            else saveFallback(); // Login may have cleared sessionStorage in this page.
        } else if (response.headers.get('X-Simas-Gateway') !== GATEWAY_MARKER) {
            throw Object.assign(new Error('Jalur koneksi cadangan belum tersedia. Silakan hubungi admin.'), { code: 'api/fallback-unavailable' });
        }
        return response;
    }
    // A fresh write is routed BEFORE its body is sent. The read-only probe cannot duplicate a write.
    async function checkWriteRoute() {
        if (fallbackActive() || (primaryReachedAt !== null && now() - primaryReachedAt < primaryFreshMs)) return;
        if (!writeRouteCheck) {
            const checkGeneration = generation;
            writeRouteCheck = (async () => {
                try {
                    const response = await timedFetch(`${primary}/api/health`, null, { method: 'GET', cache: 'no-store' }, probeTimeoutMs);
                    if (checkGeneration === generation) primaryReachedAt = now();
                    await response.body?.cancel();
                } catch (error) {
                    if (!networkFailure(error)) throw error;
                    if (checkGeneration !== generation) return;
                    const response = await timedFetch(`${gateway}/api/health`, null, { method: 'GET', cache: 'no-store' }, probeTimeoutMs);
                    const reached = gatewayReached(response);
                    await response.body?.cancel();
                    if (!reached) throw Object.assign(new Error('Jalur koneksi cadangan belum tersedia. Silakan hubungi admin.'), { code: 'api/fallback-unavailable' });
                    if (checkGeneration === generation) useFallback();
                }
            })().finally(() => { if (checkGeneration === generation) writeRouteCheck = null; });
        }
        return writeRouteCheck;
    }
    async function fetchWithFallback(input, init = {}) {
        const path = apiPath(input);
        if (!path || !gateway) return nativeFetch(input, init);
        if (init === null) init = {};
        const method = String(init.method || input?.method || 'GET').toUpperCase();
        const safe = SAFE_METHODS.has(method) || (method === 'POST' && SAFE_POST_PATHS.has(path.split('?')[0])
            && typeof init.body?.getReader !== 'function');
        const callerSignal = init.signal || input?.signal;
        if (callerSignal?.aborted) throw abortError(callerSignal);
        // Unload telemetry must dispatch synchronously; waiting for a probe can lose the event.
        if (!safe && !(init.keepalive ?? input?.keepalive)) {
            let checkedGeneration;
            do {
                checkedGeneration = generation;
                await waitForRoute(checkWriteRoute(), callerSignal);
            } while (checkedGeneration !== generation && !callerSignal?.aborted);
        }
        if (callerSignal?.aborted) throw abortError(callerSignal);
        const requestGeneration = generation;
        const uncertainWrite = error => Object.assign(new Error('Koneksi terputus saat menyimpan. Periksa data terbaru sebelum mencoba lagi.'), {
            code: 'api/write-outcome-unknown', cause: error
        });
        const protectWriteBody = response => {
            if (safe || !response.body) return response;
            const reader = response.body.getReader();
            const body = new ReadableStream({
                async pull(stream) {
                    try {
                        const { done, value } = await reader.read();
                        if (done) { reader.releaseLock(); stream.close(); }
                        else stream.enqueue(value);
                    } catch (error) {
                        reader.releaseLock();
                        stream.error(uncertainWrite(error));
                    }
                },
                cancel(reason) { return reader.cancel(reason).finally(() => reader.releaseLock()); }
            });
            const wrapped = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
            for (const key of ['url', 'type', 'redirected']) Object.defineProperty(wrapped, key, { value: response[key] });
            return wrapped;
        };
        if (fallbackActive()) {
            try { return protectWriteBody(await gatewayFetch(path, input, init, requestGeneration)); }
            catch (error) {
                if (!safe && (networkFailure(error) || callerSignal?.aborted)) throw uncertainWrite(error);
                throw error;
            }
        }

        // Clone before the first send so a replayable Request body remains available after failure.
        const replayInput = safe && typeof Request !== 'undefined' && input instanceof Request ? input.clone() : input;
        try {
            const response = await timedFetch(`${primary}${path}`, input, init, safe ? connectTimeoutMs : 0);
            if (requestGeneration === generation) primaryReachedAt = now();
            return protectWriteBody(response); // HTTP 4xx/5xx never trigger a fallback.
        } catch (error) {
            if (!networkFailure(error) && !callerSignal?.aborted) throw error;
            if (requestGeneration === generation) primaryReachedAt = null;
            if (!safe) {
                // The server may already have committed the write. Only future requests may change route.
                throw uncertainWrite(error);
            }
            if (callerSignal?.aborted) throw error;
            return gatewayFetch(path, replayInput, init, requestGeneration);
        }
    }
    return {
        fetch: fetchWithFallback, reset,
        get baseUrl() { return fallbackActive() ? gateway : primary; }
    };
}

const INSTALL_KEY = Symbol.for('simas.workerFallback');
export function installWorkerFallback(options) {
    if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];
    let storage = null;
    try { storage = globalThis.sessionStorage || null; } catch (_) {}
    const transport = createWorkerFallback({ ...options, storage });
    globalThis[INSTALL_KEY] = transport;
    globalThis.fetch = transport.fetch;
    globalThis.addEventListener?.('online', transport.reset);
    globalThis.navigator?.connection?.addEventListener?.('change', transport.reset);
    return transport;
}
