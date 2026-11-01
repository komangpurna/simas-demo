import { pathToFileURL } from 'node:url';

export async function checkWorkerGateway({
    url = "https://wwvtthoeknizglicrhor.supabase.co/functions/v1/worker-gateway/api/health",
    origin = "https://simas-demo-5ead3.web.app", nativeFetch = globalThis.fetch.bind(globalThis), timeoutMs = 8000
} = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await nativeFetch(url, { headers: { Origin: origin }, cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`Gateway health returned HTTP ${response.status}.`);
        if (response.headers.get('X-Simas-Gateway') !== 'worker-gateway-v1'
            || response.headers.get('X-Simas-Upstream-Reached') !== '1') throw new Error('Gateway deployment or upstream marker is missing.');
        if (response.headers.get('Access-Control-Allow-Origin') !== origin) throw new Error('Gateway CORS does not allow the application origin.');
        if ((await response.json()).status !== 'ok') throw new Error('Worker health is not ready through the gateway.');
    } finally { clearTimeout(timer); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    let ready = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await checkWorkerGateway();
            ready = true;
            console.info('Worker gateway is ready for the frontend deployment.');
            break;
        } catch (error) {
            console.error(`Gateway readiness check ${attempt}/3: ${error.message}`);
            if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    if (!ready) {
        console.error('Deploy Supabase worker-gateway first, then rerun the frontend deployment.');
        process.exitCode = 1;
    }
}
