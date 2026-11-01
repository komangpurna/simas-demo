/**
 * Smoke/contract test Cloudflare Worker di runtime workerd lokal (sama dengan produksi).
 *
 * Menjalankan cloudflare/worker.js lewat Wrangler (bundel esbuild + workerd, D1/R2 lokal kosong),
 * mengirim serangkaian request yang tidak bergantung pada data/akun, lalu membandingkan status,
 * header penting, dan body dengan patokan di tests/fixtures/worker-smoke.golden.json.
 *
 *   npm run test:worker:smoke            -> bandingkan dengan patokan
 *   npm run test:worker:smoke -- --update -> rekam ulang patokan (hanya bila perubahan perilaku disengaja)
 *
 * Patokan direkam dari kode SEBELUM refaktor; setiap tahap pemindahan modul harus menghasilkan
 * respons yang identik.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_startWorker } from 'wrangler';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN = path.join(ROOT, 'tests', 'fixtures', 'worker-smoke.golden.json');
const UPDATE = process.argv.includes('--update');

const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const hsToken = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'x' })}.c2ln`;

const CASES = [
    { name: 'preflight origin diizinkan', method: 'OPTIONS', path: '/api/agenda', origin: 'http://localhost:8080' },
    { name: 'preflight origin produksi', method: 'OPTIONS', path: '/api/agenda', origin: 'https://smagesa.web.app' },
    { name: 'preflight origin asing', method: 'OPTIONS', path: '/api/agenda', origin: 'https://evil.example' },
    { name: 'endpoint tidak ada', method: 'GET', path: '/api/does-not-exist', origin: 'https://smagesa.web.app' },
    { name: 'endpoint tidak ada tanpa origin', method: 'GET', path: '/api/does-not-exist' },
    { name: 'health check', method: 'GET', path: '/api/health', origin: 'https://simas-shakti.web.app' },
    { name: 'records GET tanpa login', method: 'GET', path: '/api/records', origin: 'https://smagesa.web.app' },
    { name: 'records POST tanpa login', method: 'POST', path: '/api/records', origin: 'https://smagesa.web.app', body: {} },
    { name: 'student-aggregates tanpa login', method: 'GET', path: '/api/student-aggregates', origin: 'https://smagesa.web.app' },
    { name: 'rapor scores tanpa login', method: 'GET', path: '/api/rapor/scores', origin: 'https://smagesa.web.app' },
    { name: 'migrasi super admin tanpa login', method: 'POST', path: '/api/migrate/bk-actions', origin: 'https://smagesa.web.app', body: {} },
    { name: 'annual reset tanpa login', method: 'GET', path: '/api/students/annual-reset', origin: 'https://smagesa.web.app' },
    { name: 'JWT struktur rusak', method: 'GET', path: '/api/records', origin: 'https://smagesa.web.app', token: 'abc.def' },
    { name: 'JWT algoritma HS256 ditolak', method: 'GET', path: '/api/records', origin: 'https://smagesa.web.app', token: hsToken },
    { name: 'kartu token terlalu pendek', method: 'GET', path: '/api/students/public-card/abc', origin: 'https://smagesa.web.app' },
    { name: 'system cleanup tanpa login', method: 'POST', path: '/api/system/cleanup', origin: 'https://smagesa.web.app', body: {} }
];

const TRACKED_HEADERS = ['content-type', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers',
    'access-control-max-age', 'vary', 'x-content-type-options', 'x-frame-options', 'referrer-policy'];

function normalizeBody(text) {
    if (!text) return text;
    try {
        const json = JSON.parse(text);
        if (json && typeof json === 'object' && 'timestamp' in json) json.timestamp = '<timestamp>';
        return json;
    } catch (_) {
        return text;
    }
}

async function run() {
    const startedAt = Date.now();
    const worker = await unstable_startWorker({
        config: path.join(ROOT, 'cloudflare', 'wrangler.toml'),
        dev: { server: { port: 0 }, inspector: false, persist: false, logLevel: 'error', watch: false }
    });
    const results = {};
    try {
        await worker.ready;
        for (const c of CASES) {
            const headers = {};
            if (c.origin) headers.Origin = c.origin;
            if (c.token) headers.Authorization = `Bearer ${c.token}`;
            if (c.body) headers['Content-Type'] = 'application/json';
            const res = await worker.fetch(`http://smoke.test${c.path}`, { method: c.method, headers, body: c.body ? JSON.stringify(c.body) : undefined });
            const picked = {};
            for (const h of TRACKED_HEADERS) if (res.headers.has(h)) picked[h] = res.headers.get(h);
            results[c.name] = { request: `${c.method} ${c.path}`, status: res.status, headers: picked, body: normalizeBody(await res.text()) };
        }
    } finally {
        await worker.dispose();
    }
    console.log(`Worker lokal selesai diuji (${CASES.length} request, ${Math.round((Date.now() - startedAt) / 1000)} dtk).`);
    return results;
}

const actual = await run();

if (UPDATE || !fs.existsSync(GOLDEN)) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + '\n');
    console.log(`📝 Patokan disimpan: ${path.relative(ROOT, GOLDEN)}`);
    process.exit(0);
}

const expected = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
const mismatches = [];
for (const name of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    const a = JSON.stringify(actual[name]);
    const e = JSON.stringify(expected[name]);
    if (a !== e) mismatches.push({ name, expected: expected[name], actual: actual[name] });
}

if (mismatches.length) {
    console.error(`❌ ${mismatches.length} respons Worker berbeda dari patokan:`);
    for (const m of mismatches) {
        console.error(`\n• ${m.name}\n  patokan: ${JSON.stringify(m.expected)}\n  aktual : ${JSON.stringify(m.actual)}`);
    }
    process.exit(1);
}
console.log(`✅ ${Object.keys(expected).length} respons Worker identik dengan patokan.`);
