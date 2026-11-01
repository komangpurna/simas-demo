/**
 * Unit & Behavioral Test: Service Worker PWA Cache Integrity
 * Memvalidasi integritas sintaks sw.js, format CACHE_NAME,
 * serta memastikan seluruh aset dalam ASSETS_TO_CACHE benar-benar ada di disk.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

describe('Verifikasi Integritas Service Worker PWA (sw.js)', () => {
    const root = path.resolve(__dirname, '..');
    const swPath = path.join(root, 'sw.js');
    const swContent = fs.readFileSync(swPath, 'utf8');

    test('1. sw.js eksis dan memiliki deklarasi CACHE_NAME yang valid', () => {
        expect(fs.existsSync(swPath)).toBe(true);
        const match = swContent.match(/const\s+CACHE_NAME\s*=\s*'([^']+)'/);
        expect(match).not.toBeNull();
        expect(match[1]).toMatch(/^simas-pwa-v\d+$/);
    });

    test('2. sw.js mendeklarasikan ASSETS_TO_CACHE sebagai array', () => {
        const arrayMatch = swContent.match(/const\s+ASSETS_TO_CACHE\s*=\s*\[([\s\S]*?)\];/);
        expect(arrayMatch).not.toBeNull();
    });

    test('3. Seluruh aset fisik dalam ASSETS_TO_CACHE wajib ada di disk (0 error 404)', () => {
        const arrayMatch = swContent.match(/const\s+ASSETS_TO_CACHE\s*=\s*\[([\s\S]*?)\];/);
        expect(arrayMatch).not.toBeNull();

        // Ekstraksi string aset
        const assetEntries = arrayMatch[1]
            .split('\n')
            .map(line => line.trim().replace(/^['"]|['"],?$/g, ''))
            .filter(item => item && !item.startsWith('//'));

        expect(assetEntries.length).toBeGreaterThan(50);

        const missing = [];
        for (const asset of assetEntries) {
            const cleanPath = asset.replace(/^\.\//, '');
            // Abaikan root './' atau skrip worker impor yang ada di root
            if (!cleanPath) continue;

            const fullPath = path.join(root, cleanPath);
            if (!fs.existsSync(fullPath)) {
                missing.push(asset);
            }
        }

        expect(missing).toEqual([]);
    });

    test('4. Memastikan modul-modul penting terdaftar di ASSETS_TO_CACHE', () => {
        const expectedModules = [
            './css/jurnal-infographic.css',
            './css/jurnal-infographic-editor.css',
            './css/jurnal-infographic-report.css',
            './js/jurnal-infographic.mjs',
            './js/worker-fallback.mjs',
            './js/page-settings-annual.js',
            './js/annual-reset-backup.js',
            './library/index.js',
            './pid/portalpid.html',
            './pid/admin.html',
            './pid/admin.js',
            './pid/games.js',
            './ranking-kelas.html',
            './yearbook.html',
            './yearbook-admin.html',
            './js/page-ranking-kelas.js',
            './js/page-yearbook.js',
            './js/page-yearbook-admin.js',
            './js/gemini-grading.js',
            './js/wali-kelas-jurnal.js'
        ];

        for (const mod of expectedModules) {
            expect(swContent).toContain(`'${mod}'`);
        }
    });

    test('5. cache menangani aset publik GET, melewati API/token/mutasi, dan melindungi halaman aktif', async () => {
        const handlers = {};
        const cache = { match: jest.fn(async () => undefined), put: jest.fn(async () => {}) };
        const nativeFetch = jest.fn(async () => new Response('public asset'));
        const worker = {
            location: new URL('http://127.0.0.1/sw.js'),
            addEventListener: (name, handler) => { handlers[name] = handler; },
            skipWaiting: jest.fn(),
            clients: { claim: jest.fn(), matchAll: jest.fn(async () => [{}]) }
        };
        vm.runInNewContext(swContent, {
            self: worker, importScripts: jest.fn(), URL, Request, Response,
            fetch: nativeFetch, console,
            caches: { open: async () => cache, keys: async () => [], delete: jest.fn() },
            crypto: require('node:crypto').webcrypto
        });
        const deliver = request => {
            const pending = [];
            const event = {
                request, respondWith: jest.fn(promise => pending.push(promise)),
                waitUntil: promise => pending.push(promise)
            };
            handlers.fetch(event);
            return { event, pending };
        };
        for (const request of [
            new Request('http://127.0.0.1/css/style.css', { method: 'POST' }),
            new Request('http://127.0.0.1/api/students'),
            new Request('https://simas-smagesa-api.komangpurna1.workers.dev/api/students'),
            new Request('https://elrmzlicuuglnoeedusr.supabase.co/functions/v1/worker-gateway/api/students'),
            new Request('http://127.0.0.1/css/style.css', { headers: { Authorization: 'Bearer synthetic' } }),
            new Request('http://127.0.0.1/css/style.css', { headers: { 'X-Student-Token': 'synthetic' } }),
            new Request('http://127.0.0.1/css/style.css', { headers: { Range: 'bytes=0-1' } }),
            new Request('http://127.0.0.1/css/style.css?student_token=synthetic')
        ]) expect(deliver(request).event.respondWith).not.toHaveBeenCalled();
        expect(nativeFetch).not.toHaveBeenCalled();

        const publicAsset = deliver(new Request('http://127.0.0.1/css/style.css'));
        await Promise.all(publicAsset.pending);
        expect(publicAsset.event.respondWith).toHaveBeenCalledTimes(1);
        expect(nativeFetch).toHaveBeenCalledTimes(1);
        expect(cache.put).toHaveBeenCalledTimes(1);

        const lifecycle = [];
        handlers.install({ waitUntil: promise => lifecycle.push(promise) });
        await Promise.all(lifecycle);
        handlers.activate({ waitUntil: promise => lifecycle.push(promise) });
        await Promise.all(lifecycle);
        expect(worker.skipWaiting).not.toHaveBeenCalled();
        expect(worker.clients.claim).not.toHaveBeenCalled();
    });

    test('6. scripts/check-syntax.js memuat guardrail otomatis validasi ASSETS_TO_CACHE (anti-404)', () => {
        const checkSyntaxPath = path.join(root, 'scripts', 'check-syntax.js');
        expect(fs.existsSync(checkSyntaxPath)).toBe(true);
        const checkSyntaxContent = fs.readFileSync(checkSyntaxPath, 'utf8');
        expect(checkSyntaxContent).toContain('ASSETS_TO_CACHE');
        expect(checkSyntaxContent).toContain('CACHE_NAME');
        expect(checkSyntaxContent).toContain('Error Service Worker Cache');
    });
});
