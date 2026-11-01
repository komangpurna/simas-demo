import http from 'node:http';
import fs from 'node:fs/promises';
import { createWorkerGateway } from '../supabase/functions/worker-gateway/handler.mjs';

let upstreamCalls = [];
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const gateway = createWorkerGateway({ nativeFetch: async (url, init) => {
    const call = { path: new URL(url).pathname, method: init.method, authorization: init.headers.get('Authorization'), body: init.body ? new TextDecoder().decode(init.body) : '' };
    upstreamCalls.push(call);
    if (call.path === '/api/health') return json({ status: 'ok' });
    if (call.path === '/api/students/verify-credentials' && call.authorization !== 'Bearer browser-test') return json({ error: 'Unauthorized' }, 401);
    return json({ success: true, verified: true, data: ['synthetic-data'] });
} });

const app = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1:8765').pathname;
    const files = {
        '/worker-fallback.html': ['../cypress/fixtures/worker-fallback.html', 'text/html'],
        '/js/worker-fallback.mjs': ['../js/worker-fallback.mjs', 'application/javascript']
    };
    if (pathname === '/unrelated-api') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"unrelated":true}'); }
    if (!files[pathname]) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': files[pathname][1], 'Cache-Control': 'no-store' });
    res.end(await fs.readFile(new URL(files[pathname][0], import.meta.url)));
});
const relay = http.createServer(async (req, res) => {
    try {
        if (req.url === '/test/reset') { upstreamCalls = []; res.writeHead(200); return res.end('{}'); }
        if (req.url === '/test/state') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(upstreamCalls)); }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const result = await gateway(new Request(`http://127.0.0.1:8766${req.url}`, {
            method: req.method, headers: req.headers,
            body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)
        }));
        res.writeHead(result.status, Object.fromEntries(result.headers));
        res.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
});
app.listen(8765, '127.0.0.1', () => process.stdout.write('Fallback browser fixture: http://127.0.0.1:8765/worker-fallback.html\n'));
relay.listen(8766, '127.0.0.1', () => process.stdout.write('Gateway test server: http://127.0.0.1:8766\n'));
function stop() { app.close(); relay.close(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
