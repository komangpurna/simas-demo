// Run independently with: node --test tests/service-worker-runtime.test.cjs
// Native Request/Response and WebCrypto exercise the real worker source; no network is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { createHash, webcrypto } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const origin = 'https://app.invalid';
const absolute = value => new URL(typeof value === 'string' ? value : value.url, origin + '/').href;
const sha = value => createHash('sha256').update(value).digest('hex');

function release(version, options = {}) {
    const bodies = new Map();
    const assets = [];
    function module(name, body) {
        const revision = sha(body);
        const hashed = name.replace(/\.(js|css)$/, '.' + revision.slice(0, 16) + '.$1');
        bodies.set(absolute(name), body); bodies.set(absolute(hashed), body);
        assets.push({ url: name, revision, sourceUrl: hashed }, { url: hashed, revision });
        return hashed;
    }
    const shared = module('./js/shared.js', 'export const shared = 1;');
    const app = module('./js/app.js', `import '${shared.replace('./js/', './')}'; export const version = '${options.app || version}';`);
    const css = module('./css/style.css', '.ready { color: green; }');
    const html = `<html data-simas-version="${version}"><link href='${css}' rel='stylesheet'><script type='module' src='${app}'></script></html>`;
    bodies.set(absolute('./'), html); bodies.set(absolute('./index.html'), html);
    assets.push({ url: './', revision: sha(html), sourceUrl: './index.html' }, { url: './index.html', revision: sha(html) });
    bodies.set(absolute('./assets/optional.png'), 'optional image');
    assets.push({ url: './assets/optional.png', revision: sha('optional image'), precache: false });
    if (options.queryAlias) assets.push({ url: './js/app.js?v=' + version, sourceUrl: app, revision: sha(bodies.get(absolute(app))) });
    const manifest = { version, assets };
    manifest.revision = sha(JSON.stringify(manifest));
    return { manifest, bodies, app, shared, css, html };
}

function referenceRelease(version, options = {}) {
    const bodies = new Map(), assets = [];
    const module = (name, body) => {
        const revision = sha(body), hashed = name.replace(/\.(js|mjs|css)$/, '.' + revision.slice(0, 16) + '.$1');
        bodies.set(absolute(name), body); bodies.set(absolute(hashed), body);
        // Production manifests sort hashed paths before their stable aliases.
        assets.push({ url: hashed, revision }, { url: name, sourceUrl: hashed, revision });
        return hashed;
    };
    const leaf = module('./js/leaf.mjs', `export const value = '${options.leaf || version}';`);
    const app = module('./js/app.js', `import '${leaf.replace('./js/', './')}'; export const draft = 'unchanged';${options.appSuffix || ''}`);
    const theme = module('./css/theme.css', `.ready { color: ${options.color || version}; }`);
    const css = module('./css/style.css', `@import '${theme.replace('./css/', './')}'; .box { display: block; }`);
    const html = `<html data-simas-version="${version}"><link href="${css}" rel="stylesheet"><script type="module" src="${app}"></script></html>`;
    bodies.set(absolute('./index.html'), html); bodies.set(absolute('./'), html);
    assets.push({ url: './', sourceUrl: './index.html', revision: sha(html) }, { url: './index.html', revision: sha(html) });
    const manifest = { version, assets }; manifest.revision = sha(JSON.stringify(manifest));
    return { manifest, bodies, app, leaf, theme, css, html };
}

async function assertCompleteBytes(env, build) {
    const cache = await env.caches.open(env.name);
    for (const asset of build.manifest.assets.filter(item => item.precache !== false)) {
        const response = await cache.match(asset.url);
        assert.ok(response, asset.url);
        assert.equal(sha(Buffer.from(await response.arrayBuffer())), asset.revision, asset.url);
    }
}

function environment(build, sharedCaches = new Map(), options = {}) {
    const handlers = new Map();
    const state = {
        requests: [], deleted: [], offline: false, failUrl: null,
        delay: null, windows: [], skipWaiting: 0, claim: 0,
        now: options.now || 1000, quotaUrl: null,
        bodies: new Map(build.bodies)
    };
    class MemoryCache {
        constructor(entries) { this.entries = entries; }
        async match(input) { return this.entries.get(absolute(input))?.clone(); }
        async put(input, response) {
            if (state.quotaUrl === absolute(input)) throw new Error('Synthetic quota failure');
            this.entries.set(absolute(input), response.clone());
        }
        async keys() { return [...this.entries.keys()].map(url => new Request(url)); }
    }
    const caches = {
        async open(name) {
            if (!sharedCaches.has(name)) sharedCaches.set(name, new Map());
            return new MemoryCache(sharedCaches.get(name));
        },
        async keys() { return [...sharedCaches.keys()]; },
        async delete(name) { state.deleted.push(name); return sharedCaches.delete(name); }
    };
    const fetch = async input => {
        const url = absolute(input);
        state.requests.push(url);
        if (state.delay) await state.delay;
        if (state.offline) throw new TypeError('Synthetic offline');
        return new Response(state.bodies.get(url) || 'fixture', { status: state.failUrl === url ? 404 : 200 });
    };
    const self = {
        location: new URL(origin + '/sw.js'),
        addEventListener(type, handler) { handlers.set(type, handler); },
        skipWaiting() { state.skipWaiting++; },
        clients: {
            claim() { state.claim++; },
            async matchAll(options = {}) { return options.includeUncontrolled ? state.windows : state.windows.filter(window => window.controlled !== false); }
        }
    };
    const context = vm.createContext({
        self, caches, fetch, crypto: webcrypto, Request, Response, URL, Uint8Array, TextDecoder,
        console: { log() {}, warn() {}, debug() {} },
        Date: class extends Date { static now() { return state.now; } },
        importScripts(url) {
            if (url === './sw-manifest.js') {
                if (options.noManifest) throw new Error('Missing manifest fixture');
                self.SIMAS_SW_MANIFEST = build.manifest;
            }
        }
    });
    vm.runInContext(source, context, { filename: 'sw.js' });
    const name = vm.runInContext('RELEASE_CACHE_NAME', context);
    async function lifecycle(type) {
        const pending = [];
        handlers.get(type)({ waitUntil(promise) { pending.push(promise); } });
        await Promise.all(pending);
    }
    async function request(url, options = {}) {
        const pending = [];
        let response;
        handlers.get('fetch')({
            request: new Request(absolute(url), options),
            respondWith(promise) { response = Promise.resolve(promise); },
            waitUntil(promise) { pending.push(promise); }
        });
        return { intercepted: !!response, response: response && await response,
            settled: Promise.all(pending), waitUntilCalls: pending.length };
    }
    return { state, caches, sharedCaches, name, lifecycle, request, context };
}

test('complete offline graph is installed once per unique body; optional assets stay on demand', async () => {
    const build = release('one');
    const env = environment(build);
    await env.lifecycle('install');
    assert.equal(env.state.requests.length, 4); // HTML, app, shared, CSS; aliases share bodies.
    assert.equal(new Set(env.state.requests).size, 4);
    assert.equal(env.state.requests.includes(absolute('./assets/optional.png')), false);
    const cache = await env.caches.open(env.name);
    for (const asset of build.manifest.assets.filter(item => item.precache !== false)) {
        assert.ok(await cache.match(asset.url), asset.url);
    }
    const image = await env.request('./assets/optional.png'); await image.settled;
    assert.ok(await cache.match('./assets/optional.png'));
});

test('unchanged files are reused across releases and changed files are fetched once despite aliases', async () => {
    const shared = new Map();
    const first = environment(release('one'), shared);
    await first.lifecycle('install');
    const second = environment(release('two'), shared, { now: 2000 });
    await second.lifecycle('install');
    assert.deepEqual(second.state.requests, [absolute(release('two').app)]); // HTML references are reconstructed.
    assert.equal(second.state.requests.some(url => /shared\./.test(url)), false);
    const sameContent = environment(release('three', { app: 'two' }), shared, { now: 3000 });
    await sameContent.lifecycle('install');
    assert.equal(sameContent.state.requests.length, 0);
});

test('a metadata-only HTML release reuses exact verified target bytes with zero fetches and corrected response headers', async () => {
    const shared = new Map(); const oldBuild = release('one', { app: 'stable' }); const nextBuild = release('two', { app: 'stable' });
    const old = environment(oldBuild, shared); await old.lifecycle('install');
    const cache = await old.caches.open(old.name);
    for (const url of ['./', './index.html']) await cache.put(url, new Response(oldBuild.html, { headers: {
        'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'",
        'Content-Length': String(oldBuild.html.length), 'Content-Encoding': 'br', ETag: 'old-body', 'Last-Modified': 'yesterday'
    } }));
    const next = environment(nextBuild, shared); await next.lifecycle('install');
    assert.equal(next.state.requests.length, 0);
    const html = await (await next.caches.open(next.name)).match('./index.html');
    assert.equal(await html.clone().text(), nextBuild.html); assert.equal(sha(await html.clone().text()), sha(nextBuild.html));
    assert.equal(html.headers.get('Content-Type'), 'text/html; charset=utf-8');
    assert.equal(html.headers.get('Content-Security-Policy'), "default-src 'self'");
    for (const name of ['Content-Length', 'Content-Encoding', 'ETag', 'Last-Modified']) assert.equal(html.headers.get(name), null);
});

test('hashed-first JS/CSS/HTML aliases reconstruct exact new bytes and only changed leaves are fetched', async () => {
    const shared = new Map(), before = referenceRelease('one'), after = referenceRelease('two');
    const old = environment(before, shared); await old.lifecycle('install');
    const oldCache = await old.caches.open(old.name);
    for (const url of [before.app, './js/app.js']) await oldCache.put(url, new Response(before.bodies.get(absolute(before.app)), { headers: {
        'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': '999', 'Content-Encoding': 'br',
        ETag: 'stale', 'Last-Modified': 'yesterday', 'Content-MD5': 'stale', Digest: 'stale',
        'Content-Digest': 'stale', 'Repr-Digest': 'stale', 'X-Fixture': 'retained'
    } }));
    const next = environment(after, shared, { now: 2000 }); await next.lifecycle('install');
    assert.deepEqual(next.state.requests.sort(), [absolute(after.leaf), absolute(after.theme)].sort());
    await assertCompleteBytes(next, after);
    assert.equal(await (await oldCache.match(before.app)).text(), before.bodies.get(absolute(before.app)));
    const app = await (await next.caches.open(next.name)).match(after.app);
    assert.equal(app.headers.get('Content-Type'), 'text/javascript; charset=utf-8');
    assert.equal(app.headers.get('X-Fixture'), 'retained');
    for (const name of ['Content-Length', 'Content-Encoding', 'ETag', 'Last-Modified', 'Content-MD5', 'Digest', 'Content-Digest', 'Repr-Digest']) assert.equal(app.headers.get(name), null);
    const rollback = environment(before, shared, { now: 3000 }); await rollback.lifecycle('install');
    assert.equal(rollback.state.requests.length, 0); await assertCompleteBytes(rollback, before);
});

test('actual parent code changes fall back to fetch while its HTML importer can still be reconstructed', async () => {
    const shared = new Map(), before = referenceRelease('one'), after = referenceRelease('two', { appSuffix: ' export const newFeature = true;' });
    const old = environment(before, shared); await old.lifecycle('install');
    const next = environment(after, shared); await next.lifecycle('install');
    assert.deepEqual(next.state.requests.sort(), [after.leaf, after.app, after.theme].map(absolute).sort());
    await assertCompleteBytes(next, after);
});

test('corrupt preimages, missing source bodies, or an absent/corrupt complete marker fall back to fetch', async () => {
    for (const mode of ['corrupt-body', 'missing-body', 'missing-marker', 'bad-marker-revision', 'private-marker', 'external-marker', 'query-source', 'wrong-sibling']) {
        const shared = new Map(), before = referenceRelease('one'), after = referenceRelease('two');
        const old = environment(before, shared); await old.lifecycle('install');
        const entries = shared.get(old.name), markerUrl = absolute('./__simas_offline_manifest__');
        if (mode === 'corrupt-body') {
            for (const key of [before.app, './js/app.js']) entries.set(absolute(key), new Response(before.bodies.get(absolute(before.app)) + '/*corrupt*/'));
        } else if (mode === 'missing-body') {
            for (const key of [before.app, './js/app.js']) entries.delete(absolute(key));
        } else if (mode === 'missing-marker') entries.delete(markerUrl);
        else {
            const marker = await entries.get(markerUrl).json();
            if (mode === 'bad-marker-revision') marker.revision = sha('different release');
            if (mode === 'private-marker') marker.assets.push({ url: '/api/private.js', revision: sha('private') });
            if (mode === 'external-marker') marker.assets.push({ url: 'https://external.invalid/public.js', revision: sha('outside') });
            if (mode === 'query-source') marker.assets.find(asset => asset.url === absolute('./js/app.js')).sourceUrl += '?v=old';
            if (mode === 'wrong-sibling') marker.assets.find(asset => asset.url === absolute('./js/app.js')).sourceUrl = absolute(before.leaf);
            entries.set(markerUrl, new Response(JSON.stringify(marker)));
        }
        const next = environment(after, shared); await next.lifecycle('install');
        assert.ok(next.state.requests.includes(absolute(after.app)), mode);
        await assertCompleteBytes(next, after);
    }
});

test('legacy caches without a complete graph never supply hash-reference transformations', async () => {
    const shared = new Map(), before = referenceRelease('one'), after = referenceRelease('two');
    const next = environment(after, shared); const legacy = await next.caches.open('simas-pwa-v209');
    for (const [url, body] of before.bodies) await legacy.put(url, new Response(body));
    await next.lifecycle('install');
    assert.deepEqual(next.state.requests.sort(), [after.leaf, after.app, after.theme, after.css, './index.html'].map(absolute).sort());
    await assertCompleteBytes(next, after);
});

test('a bad recent preimage does not prevent reconstructing from an older completed release', async () => {
    const shared = new Map(), first = referenceRelease('one'), second = referenceRelease('two'), third = referenceRelease('three');
    const a = environment(first, shared); await a.lifecycle('install');
    const b = environment(second, shared, { now: 2000 }); await b.lifecycle('install');
    for (const key of [second.app, './js/app.js']) shared.get(b.name).set(absolute(key), new Response('corrupt newest copy'));
    const c = environment(third, shared, { now: 3000 }); await c.lifecycle('install');
    assert.deepEqual(c.state.requests.sort(), [third.leaf, third.theme].map(absolute).sort());
    await assertCompleteBytes(c, third);
});

test('ambiguous same-basename mappings and text over the reconstruction limit use normal downloads', async () => {
    for (const mode of ['ambiguous', 'oversized']) {
        const shared = new Map(), before = referenceRelease('one'), after = referenceRelease('two');
        if (mode === 'ambiguous') {
            for (const build of [before, after]) {
                const sameName = before.leaf.replace('./js/', './other/');
                const body = before.bodies.get(absolute(before.leaf));
                build.manifest.assets.push({ url: sameName, revision: sha(body) }, { url: './other/leaf.mjs', sourceUrl: sameName, revision: sha(body) });
                build.bodies.set(absolute(sameName), body); build.bodies.set(absolute('./other/leaf.mjs'), body);
            }
        } else {
            for (const build of [before, after]) {
                const body = build.bodies.get(absolute(build.app)) + '\n/*' + 'x'.repeat(2 * 1024 * 1024) + '*/';
                for (const key of [build.app, './js/app.js']) build.bodies.set(absolute(key), body);
                for (const entry of build.manifest.assets) if (entry.url === build.app || entry.url === './js/app.js') entry.revision = sha(body);
            }
        }
        for (const build of [before, after]) build.manifest.revision = sha(JSON.stringify({ version: build.manifest.version, assets: build.manifest.assets }));
        const old = environment(before, shared); await old.lifecycle('install');
        const next = environment(after, shared); await next.lifecycle('install');
        assert.ok(next.state.requests.includes(absolute(after.app)), mode);
        await assertCompleteBytes(next, after);
    }
});

test('a failed fallback download after rejected reconstruction preserves the active release', async () => {
    const shared = new Map(), before = referenceRelease('one'), after = referenceRelease('two', { appSuffix: ' export const changed = true;' });
    const old = environment(before, shared); await old.lifecycle('install');
    const next = environment(after, shared); next.state.bodies.set(absolute(after.app), 'mismatched successful network response');
    await assert.rejects(next.lifecycle('install'), /revision check/);
    assert.equal(shared.has(next.name), false); await assertCompleteBytes(old, before);
    old.state.offline = true; const result = await old.request(before.app); await result.settled;
    assert.equal(await result.response.text(), before.bodies.get(absolute(before.app)));
    assert.equal(next.state.skipWaiting + next.state.claim, 0);
});

test('actual Hosting builds reuse cyclic imports, lazy modules, CSS imports and inline HTML references across two releases and rollback', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'simas-sw-graph-'));
    const write = (file, body) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), body); };
    try {
        const { buildHosting } = await import(pathToFileURL(path.join(__dirname, '../scripts/build-hosting.mjs')).href);
        write('firebase.json', JSON.stringify({ hosting: [{ target: 'smagesa', public: 'dist-hosting', ignore: ['firebase.json', 'package.json', '**/.*'] }] }));
        write('package.json', JSON.stringify({ version: '26.10.16.1' }));
        write('index.html', '<html><head><link rel="stylesheet" href="css/style.css"></head><body><script type="module" src="js/main.js"></script><script type="module">import "./js/leaf.mjs?mode=quiz";</script></body></html>');
        write('js/config.js', 'export const APP_VERSION = "26.10.16.1";');
        write('js/main.js', 'import { APP_VERSION } from "./config.js"; import "./a.js"; export const load = () => import("./leaf.mjs"); export const version = APP_VERSION;');
        write('js/a.js', 'import { b } from "./b.js"; export function a() { return b; }');
        write('js/b.js', 'import { a } from "./a.js"; import { value } from "./leaf.mjs"; export const b = () => [a, value];');
        write('js/leaf.mjs', 'export const value = 1;');
        write('css/style.css', '@import "./theme.css"; .box { display: block; }');
        write('css/theme.css', '.ready { color: green; }');
        write('sw.js', 'const ASSETS_TO_CACHE = ["./", "./index.html", "./js/main.js", "./css/style.css"];');
        const snapshot = () => {
            const context = { self: {} }; vm.runInNewContext(fs.readFileSync(path.join(root, 'dist-hosting/sw-manifest.js'), 'utf8'), context);
            const manifest = JSON.parse(JSON.stringify(context.self.SIMAS_SW_MANIFEST));
            const bodies = new Map();
            for (const asset of manifest.assets) bodies.set(absolute(asset.url), fs.readFileSync(path.join(root, 'dist-hosting', new URL(asset.url, origin + '/').pathname.slice(1) || 'index.html')));
            return { manifest, bodies };
        };
        const firstBuild = await buildHosting({ root }); const before = snapshot();
        const shared = new Map(), old = environment(before, shared); await old.lifecycle('install');
        write('package.json', JSON.stringify({ version: '26.10.16.2' }));
        write('js/leaf.mjs', 'export const value = 2;'); write('css/theme.css', '.ready { color: blue; }');
        const secondBuild = await buildHosting({ root }); const after = snapshot();
        assert.notEqual(firstBuild.mapping['js/a.js'], secondBuild.mapping['js/a.js']);
        assert.notEqual(firstBuild.mapping['js/b.js'], secondBuild.mapping['js/b.js']);
        const next = environment(after, shared, { now: 2000 }); await next.lifecycle('install');
        assert.deepEqual(next.state.requests.sort(), [secondBuild.mapping['js/leaf.mjs'], secondBuild.mapping['css/theme.css']].map(file => absolute('./' + file)).sort());
        await assertCompleteBytes(next, after);
        next.state.offline = true; next.state.requests.length = 0;
        const lazy = await next.request('./' + secondBuild.mapping['js/leaf.mjs']); await lazy.settled;
        assert.equal(lazy.response.status, 200); assert.equal(next.state.requests.length, 0);
        const rollback = environment(before, shared, { now: 3000 }); await rollback.lifecycle('install');
        assert.equal(rollback.state.requests.length, 0); await assertCompleteBytes(rollback, before);
    } finally {
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
        assert.ok(path.basename(root).startsWith('simas-sw-graph-'));
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('real HTML markup changes still fetch the new response instead of editing an older body', async () => {
    const shared = new Map(); const oldBuild = release('one', { app: 'stable' }); const nextBuild = release('two', { app: 'stable' });
    nextBuild.html = nextBuild.html.replace('</html>', '<p>New visible content</p></html>');
    nextBuild.bodies.set(absolute('./'), nextBuild.html); nextBuild.bodies.set(absolute('./index.html'), nextBuild.html);
    for (const asset of nextBuild.manifest.assets) if (asset.url === './' || asset.url === './index.html') asset.revision = sha(nextBuild.html);
    nextBuild.manifest.revision = sha(JSON.stringify({ version: nextBuild.manifest.version, assets: nextBuild.manifest.assets }));
    const old = environment(oldBuild, shared); await old.lifecycle('install');
    const next = environment(nextBuild, shared); await next.lifecycle('install');
    assert.deepEqual(next.state.requests, [absolute('./index.html')]);
    assert.equal(await (await (await next.caches.open(next.name)).match('./index.html')).text(), nextBuild.html);
});

test('HTML reuse never rewrites a lookalike attribute, quoted attribute text, or another literal version', async () => {
    for (const mode of ['wrong-name', 'quoted-text', 'other-literal']) {
        const shared = new Map(); const oldBuild = release('one', { app: 'stable' }); const nextBuild = release('two', { app: 'stable' });
        for (const [build, version] of [[oldBuild, 'one'], [nextBuild, 'two']]) {
            build.html = mode === 'wrong-name' ? `<html data-other-version="${version}">unchanged</html>` :
                mode === 'quoted-text' ? `<html title="data-simas-version='${version}'">unchanged</html>` :
                    `<html data-simas-version="${version}"><p>Literal ${version}</p></html>`;
            build.bodies.set(absolute('./'), build.html); build.bodies.set(absolute('./index.html'), build.html);
            for (const asset of build.manifest.assets) if (asset.url === './' || asset.url === './index.html') asset.revision = sha(build.html);
            build.manifest.revision = sha(JSON.stringify({ version: build.manifest.version, assets: build.manifest.assets }));
        }
        const old = environment(oldBuild, shared); await old.lifecycle('install');
        const next = environment(nextBuild, shared); await next.lifecycle('install');
        assert.deepEqual(next.state.requests, [absolute('./index.html')], mode);
    }
});

test('legacy reuse verifies actual response bytes instead of trusting a plain URL', async () => {
    const build = release('one');
    const env = environment(build);
    const legacy = await env.caches.open('simas-pwa-v209');
    await legacy.put('./js/shared.js', new Response('outdated body'));
    await env.lifecycle('install');
    assert.equal(env.state.requests.filter(url => url === absolute(build.shared)).length, 1);
    const copied = await (await env.caches.open(env.name)).match('./js/shared.js');
    assert.equal(await copied.text(), build.bodies.get(absolute(build.shared)));
});

test('warm immutable JS/CSS reads make no network request, while mutable aliases revalidate', async () => {
    const build = release('one'); const env = environment(build);
    await env.lifecycle('install'); env.state.requests.length = 0;
    for (const url of [build.app, build.app, build.css]) {
        const result = await env.request(url); await result.settled;
        assert.equal(result.response.status, 200);
    }
    assert.equal(env.state.requests.length, 0);
    const alias = await env.request('./js/app.js'); await alias.settled;
    assert.equal(env.state.requests.length, 1);
});

test('manifest-pinned fixed logos and fonts make zero network requests when warm', async () => {
    const build = release('one');
    delete build.manifest.assets.find(asset => asset.url === './assets/optional.png').precache;
    build.bodies.set(absolute('./assets/ui-font.woff2'), 'font bytes');
    build.manifest.assets.push({ url: './assets/ui-font.woff2', revision: sha('font bytes') });
    build.manifest.revision = sha(JSON.stringify({ version: build.manifest.version, assets: build.manifest.assets }));
    const env = environment(build); await env.lifecycle('install');
    env.state.requests.length = 0;
    for (let index = 0; index < 2; index++) {
        for (const [url, body] of [['./assets/optional.png', 'optional image'], ['./assets/ui-font.woff2', 'font bytes']]) {
            const result = await env.request(url); await result.settled;
            assert.equal(await result.response.text(), body);
        }
    }
    assert.equal(env.state.requests.length, 0);
});

test('an old active release still displays a fresh fixed-name logo after local eviction without caching a mismatched revision', async () => {
    const build = release('one'); const env = environment(build); await env.lifecycle('install');
    env.state.bodies.set(absolute('./assets/optional.png'), 'new deployment logo');
    const logo = await env.request('./assets/optional.png'); await logo.settled;
    assert.equal(logo.response.status, 200); assert.equal(await logo.response.text(), 'new deployment logo');
    assert.equal(await (await env.caches.open(env.name)).match('./assets/optional.png'), undefined);
});

test('an immutable hash URL still rejects a mismatched successful response', async () => {
    const build = release('one'); const env = environment(build); await env.lifecycle('install');
    env.sharedCaches.get(env.name).delete(absolute(build.app));
    env.state.bodies.set(absolute(build.app), 'unexpected module body');
    const result = await env.request(build.app); await result.settled;
    assert.equal(result.response.status, 503);
    assert.equal(await (await env.caches.open(env.name)).match(build.app), undefined);
});

test('a changed logo revision fetches the new body instead of reusing an older release hit', async () => {
    const shared = new Map(); const firstBuild = release('one');
    const first = environment(firstBuild, shared); await first.lifecycle('install');
    const initial = await first.request('./assets/optional.png'); await initial.settled;
    const nextBuild = release('two');
    nextBuild.bodies.set(absolute('./assets/optional.png'), 'new logo bytes');
    nextBuild.manifest.assets.find(asset => asset.url === './assets/optional.png').revision = sha('new logo bytes');
    nextBuild.manifest.revision = sha(JSON.stringify({ version: nextBuild.manifest.version, assets: nextBuild.manifest.assets }));
    const next = environment(nextBuild, shared); await next.lifecycle('install'); next.state.requests.length = 0;
    const updated = await next.request('./assets/optional.png'); await updated.settled;
    assert.equal(await updated.response.text(), 'new logo bytes');
    assert.deepEqual(next.state.requests, [absolute('./assets/optional.png')]);
    next.state.requests.length = 0;
    const warm = await next.request('./assets/optional.png'); await warm.settled;
    assert.equal(await warm.response.text(), 'new logo bytes'); assert.equal(next.state.requests.length, 0);
});

test('undeclared image query variants keep revalidating and unknown dynamic images bypass the worker', async () => {
    const env = environment(release('one')); await env.lifecycle('install'); env.state.requests.length = 0;
    for (let index = 0; index < 2; index++) {
        const variant = await env.request('./assets/optional.png?size=small'); await variant.settled;
        assert.equal(variant.response.status, 200);
    }
    assert.equal(env.state.requests.length, 2);
    assert.equal((await env.request('./assets/dynamic-photo.png')).intercepted, false);
});

test('warm HTML returns promptly and keeps background revalidation alive with waitUntil', async () => {
    const build = release('one'); const env = environment(build);
    await env.lifecycle('install');
    let releaseNetwork;
    env.state.delay = new Promise(resolve => { releaseNetwork = resolve; });
    const result = await env.request('./index.html');
    assert.equal(await result.response.text(), build.html);
    assert.equal(result.waitUntilCalls, 1);
    releaseNetwork(); await result.settled;
});

test('only exact declared version query aliases work offline; unknown versions are never collapsed', async () => {
    const build = release('one', { queryAlias: true }); const env = environment(build);
    await env.lifecycle('install'); env.state.offline = true;
    const exact = await env.request('./js/app.js?v=one'); await exact.settled;
    assert.equal(exact.response.status, 200);
    const unseen = await env.request('./js/app.js?v=unseen'); await unseen.settled;
    assert.equal(unseen.response.status, 503);
    const shell = await env.request('./index.html?view=module'); await shell.settled;
    assert.equal(await shell.response.text(), build.html);
});

test('same-origin API/session/gateway, credentials, Range, POST and cross-origin requests bypass caching', async () => {
    const build = release('one'); const env = environment(build);
    for (const [url, options] of [
        ['./api/private.json', {}], ['./session/status.json', {}], ['./gateway/data.json', {}],
        ['./js/app.js?student_token=private', {}], ['./js/app.js', { headers: { Authorization: 'Bearer fixture' } }],
        ['./js/app.js', { headers: { 'X-Student-Token': 'fixture' } }],
        ['./assets/optional.png', { headers: { Range: 'bytes=0-9' } }],
        ['./js/app.js', { method: 'POST', body: 'fixture' }],
        ['https://app.invalid.evil/js/app.js', {}]
    ]) {
        assert.equal((await env.request(url, options)).intercepted, false, url);
    }
    assert.equal(env.state.requests.length, 0);
    assert.equal((await env.caches.keys()).length, 0);
});

test('an unknown hash-looking endpoint is fetched without entering the cache', async () => {
    const env = environment(release('one'));
    const url = './js/unknown.1234567890abcdef.js';
    const result = await env.request(url); await result.settled;
    assert.equal(result.response.status, 200);
    assert.equal((await env.caches.keys()).length, 0);
});

test('a lean current manifest still serves a cached old hash from the previous completed release offline', async () => {
    const shared = new Map(); const previousBuild = release('one');
    const lazyBody = 'export const oldLazy = true;';
    const lazyPath = './js/old-lazy.' + sha(lazyBody).slice(0, 16) + '.js';
    previousBuild.manifest.assets.push({ url: lazyPath, revision: sha(lazyBody), precache: false });
    previousBuild.manifest.revision = sha(JSON.stringify({ version: previousBuild.manifest.version, assets: previousBuild.manifest.assets }));
    const previous = environment(previousBuild, shared); await previous.lifecycle('install');
    const currentBuild = release('two'); const current = environment(currentBuild, shared, { now: 2000 });
    assert.equal(currentBuild.manifest.assets.some(asset => asset.url === previousBuild.app || asset.url === lazyPath), false);
    await current.lifecycle('install'); await current.lifecycle('activate');
    current.state.offline = true; current.state.requests.length = 0;
    const cached = await current.request(previousBuild.app); await cached.settled;
    assert.equal(await cached.response.text(), previousBuild.bodies.get(absolute(previousBuild.app)));
    assert.equal(current.state.requests.length, 0);
    const unvisited = await current.request(lazyPath); await unvisited.settled;
    assert.equal(unvisited.response.status, 503);
    current.state.offline = false; current.state.bodies.set(absolute(lazyPath), lazyBody);
    const online = await current.request(lazyPath); await online.settled;
    assert.equal(await online.response.text(), lazyBody);
});

test('historical hash entries from the legacy worker are verified before cache-first reuse', async () => {
    const build = release('one');
    const historicalBody = 'historical module';
    const historicalPath = './js/old.' + sha(historicalBody).slice(0, 16) + '.js';
    build.manifest.assets.push({ url: historicalPath, revision: sha(historicalBody), precache: false });
    build.manifest.revision = sha(JSON.stringify(build.manifest.assets));
    const env = environment(build); await env.lifecycle('install');
    const legacy = await env.caches.open('simas-pwa-v209');
    await legacy.put(historicalPath, new Response('wrong historical body'));
    env.state.offline = true;
    const corrupt = await env.request(historicalPath); await corrupt.settled;
    assert.equal(corrupt.response.status, 503);
    await legacy.put(historicalPath, new Response(historicalBody));
    env.state.requests.length = 0;
    const valid = await env.request(historicalPath); await valid.settled;
    assert.equal(await valid.response.text(), historicalBody);
    assert.equal(env.state.requests.length, 0);
});

test('failed update leaves the previous offline release usable and never exposes a partial release', async () => {
    const shared = new Map(); const oldBuild = release('one');
    const old = environment(oldBuild, shared); await old.lifecycle('install');
    const nextBuild = release('two'); const next = environment(nextBuild, shared);
    next.state.failUrl = absolute(nextBuild.app);
    await assert.rejects(next.lifecycle('install'), /revision check/);
    assert.equal(shared.has(next.name), false);
    old.state.offline = true;
    const result = await old.request(oldBuild.app); await result.settled;
    assert.equal(result.response.status, 200);
    assert.equal(old.state.skipWaiting + next.state.skipWaiting, 0);
    assert.equal(old.state.claim + next.state.claim, 0);
});

test('natural activation preserves all releases while a window exists and never deletes unrelated or legacy caches', async () => {
    const shared = new Map(); let current;
    for (const [index, version] of ['one', 'two', 'three'].entries()) {
        current = environment(release(version), shared, { now: 1000 + index });
        await current.lifecycle('install');
    }
    await current.caches.open('another-app-cache'); await current.caches.open('simas-pwa-v209');
    current.state.windows = [{ id: 'still-open-form-or-quiz' }];
    await current.lifecycle('activate');
    assert.equal(shared.size, 5);
    current.state.windows = []; await current.lifecycle('activate');
    assert.equal((await current.caches.keys()).filter(name => name.startsWith('simas-pwa-release-')).length, 2);
    assert.ok(shared.has('another-app-cache')); assert.ok(shared.has('simas-pwa-v209'));
    assert.equal(current.state.skipWaiting, 0); assert.equal(current.state.claim, 0);
});

test('an uncontrolled first/new page does not prevent bounded release cleanup at natural activation', async () => {
    const shared = new Map(); let current;
    for (const [index, version] of ['one', 'two', 'three', 'four'].entries()) {
        current = environment(release(version), shared, { now: 1000 + index });
        await current.lifecycle('install');
    }
    await current.caches.open('unrelated-cache'); await current.caches.open('simas-pwa-v209');
    current.state.windows = [{ id: 'first-install-or-new-uncontrolled-page', controlled: false }];
    await current.lifecycle('activate');
    const releases = (await current.caches.keys()).filter(name => name.startsWith('simas-pwa-release-'));
    assert.equal(releases.length, 2); assert.ok(releases.includes(current.name));
    assert.ok(shared.has('unrelated-cache')); assert.ok(shared.has('simas-pwa-v209'));
    assert.equal(current.state.claim, 0); assert.equal(current.state.skipWaiting, 0);
});

test('new HTML cannot replace the offline shell until its complete hashed graph has been staged', async () => {
    const shared = new Map(); const oldBuild = release('one'); const nextBuild = release('two');
    const old = environment(oldBuild, shared); await old.lifecycle('install');
    for (const [url, body] of nextBuild.bodies) old.state.bodies.set(url, body);
    const oldCache = await old.caches.open(old.name);
    const beforeReady = await old.request('./index.html'); await beforeReady.settled;
    assert.equal(await (await oldCache.match('./index.html')).text(), oldBuild.html);
    const next = environment(nextBuild, shared, { now: 2000 }); await next.lifecycle('install');
    const afterReady = await old.request('./index.html'); await afterReady.settled;
    assert.equal(await (await oldCache.match('./index.html')).text(), nextBuild.html);
    old.state.offline = true; old.state.requests.length = 0;
    const entrypoint = await old.request(nextBuild.app); await entrypoint.settled;
    assert.equal(entrypoint.response.status, 200);
    assert.equal(old.state.requests.length, 0);
});

test('inline-module-only HTML is paired with a completed release, never an incomplete staging cache', async () => {
    function inlineRelease(version) {
        const build = release(version, { app: 'shared' });
        build.html = `<script type="module">import '${build.shared}'; window.release='${version}';</script>`;
        build.bodies.set(absolute('./'), build.html); build.bodies.set(absolute('./index.html'), build.html);
        for (const asset of build.manifest.assets) {
            if (asset.url === './' || asset.url === './index.html') asset.revision = sha(build.html);
        }
        build.manifest.revision = sha(JSON.stringify(build.manifest.assets));
        return build;
    }
    const shared = new Map(); const first = inlineRelease('one'); const second = inlineRelease('two');
    const old = environment(first, shared); await old.lifecycle('install');
    const next = environment(second, shared, { now: 2000 });
    // Simulate a new worker partway through installation, before its complete marker.
    const partial = await next.caches.open(next.name);
    await partial.put('./index.html', new Response(second.html));
    for (const [url, body] of second.bodies) old.state.bodies.set(url, body);
    const before = await old.request('./index.html'); await before.settled;
    const oldCache = await old.caches.open(old.name);
    assert.equal(await (await oldCache.match('./index.html')).text(), first.html);
    await next.lifecycle('install');
    const after = await old.request('./index.html'); await after.settled;
    assert.equal(await (await oldCache.match('./index.html')).text(), second.html);
});

test('storage failures do not discard successful online responses; missing production manifest rejects the new worker', async () => {
    const env = environment(release('one')); await env.lifecycle('install');
    env.state.quotaUrl = absolute('./assets/optional.png');
    const result = await env.request('./assets/optional.png'); await result.settled;
    assert.equal(result.response.status, 200);
    assert.throws(() => environment(release('one'), new Map(), { noManifest: true }), /Missing manifest/);
});
