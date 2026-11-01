const CACHE_NAME = 'simas-pwa-v210'; // Development fallback; production cache identity is the manifest digest.
importScripts("./push-worker.js");
const ASSETS_TO_CACHE = [
    "./push-worker.js",
    './assets/badge-sekolah.png',
    './assets/logo-sekolah.png',
    './assets/logo-sekolah-padded.png',
    './assets/logo-sekolah-padded-192.png',
    './assets/kop.png',
    './',
    './index.html',
    './manifest.json',
    './dashboard.html',
    './agenda.html',
    './agenda-pegawai.html',
    './e-kinerja-tendik.html',
    './dokumen.html',
    './ranking-kelas.html',
    './yearbook.html',
    './yearbook-admin.html',
    './pid/portalpid.html',
    './pid/admin.html',
    './css/style.css',
    './css/tailwind.css',
    './css/card-print.css',
    './css/yearbook.css',
    './css/jurnal-infographic.css',
    './css/jurnal-infographic-editor.css',
    './css/jurnal-infographic-report.css',
    './js/config.js',
    './js/school-config.js',
    './js/global.js',
    './js/cloudflare-client.js',
    './js/worker-fallback.mjs',
    './js/utils.mjs',
    './js/student-session.mjs',
    './js/session-activity.mjs',
    './js/data-holidays.js',
    './js/agenda-common.js',
    './js/page-agenda.js',
    './js/page-agenda-pegawai.js',
    './js/page-e-kinerja-tendik.js',
    './js/page-dokumen.js',
    './js/page-dashboard.js',
    './js/page-ranking-kelas.js',
    './js/page-yearbook.js',
    './js/page-yearbook-admin.js',
    './js/page-settings-annual.js',
    './js/annual-reset-backup.js',
    './js/jurnal-infographic.mjs',
    './js/gemini-grading.js',
    './js/wali-kelas-jurnal.js',
    './js/biometric-auth.js',
    './js/indexeddb-cache.js',
    './js/easy.qrcode.min.js',
    './pid/admin.js',
    './pid/games.js',
    './library/index.js',
    './firebase-messaging-sw.js'
];

const SW_ROOT = new URL('./', self.location.href);
const RELEASE_PREFIX = 'simas-pwa-release-';
const MANIFEST_KEY = new URL('__simas_offline_manifest__', SW_ROOT).href;
const IS_LOCAL_SW = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(self.location.hostname) || self.location.hostname.startsWith('192.168.');
const HASHED_FILE = /\.[a-f0-9]{12,64}\.(?:js|mjs|css|png|svg|webp|jpe?g|woff2?|ttf|ico)$/i;
const PINNED_BINARY = /\.(?:png|svg|webp|jpe?g|gif|ico|woff2?|ttf|otf)$/i;
const PRIVATE_PATH = /\/(?:api|auth|sessions?|gateway|proxy|__)(?:\/|$)/i;
const PRIVATE_QUERY = /^(?:access_token|id_token|token|student_token|session|session_id|authorization|credential|password|birthdate)$/i;
const hasPrivateQuery = url => Array.from(url.searchParams.keys()).some(key => PRIVATE_QUERY.test(key));

try {
    importScripts('./sw-manifest.js');
} catch (error) {
    // A broken production build must leave the existing worker active.
    if (!IS_LOCAL_SW) throw error;
}

const rawManifest = self.SIMAS_SW_MANIFEST;
if (!IS_LOCAL_SW && (!rawManifest || !/^[a-f0-9]{64}$/i.test(rawManifest.revision || ''))) {
    throw new Error('A complete offline asset manifest is required.');
}
const MANIFEST = rawManifest || {
    version: CACHE_NAME,
    revision: 'development',
    assets: ASSETS_TO_CACHE.map(url => ({ url, revision: null }))
};
if (!Array.isArray(MANIFEST.assets) || !MANIFEST.assets.length) throw new Error('Offline manifest has no assets.');

function publicAssetUrl(value) {
    const url = new URL(value, SW_ROOT);
    if (url.origin !== SW_ROOT.origin || !url.pathname.startsWith(SW_ROOT.pathname) ||
        PRIVATE_PATH.test(url.pathname) || hasPrivateQuery(url) || url.hash ||
        !(url.pathname === SW_ROOT.pathname || /\.(?:html|js|mjs|css|json|png|svg|webp|jpe?g|gif|woff2?|ttf|otf|ico|mp4|webm|mp3|wav|ogg|pdf)$/i.test(url.pathname))) {
        throw new Error('Only public local files may enter the offline cache.');
    }
    return url.href;
}

const OFFLINE_ASSETS = MANIFEST.assets.map(asset => {
    if (!IS_LOCAL_SW && !/^[a-f0-9]{64}$/i.test(asset.revision || '')) throw new Error('Invalid offline asset revision.');
    return {
        url: publicAssetUrl(asset.url),
        sourceUrl: publicAssetUrl(asset.sourceUrl || asset.url),
        revision: asset.revision,
        precache: asset.precache !== false
    };
});
const ASSET_BY_URL = new Map(OFFLINE_ASSETS.map(asset => [asset.url, asset]));
const PRECACHE_ASSETS = OFFLINE_ASSETS.filter(asset => asset.precache);
if (ASSET_BY_URL.size !== OFFLINE_ASSETS.length) throw new Error('Duplicate offline asset URLs.');
const PUBLIC_PATHS = new Set(OFFLINE_ASSETS.map(asset => new URL(asset.url).pathname));
const RELEASE_CACHE_NAME = rawManifest ? RELEASE_PREFIX + MANIFEST.revision : CACHE_NAME;
const isOwnedCache = name => name.startsWith(RELEASE_PREFIX) || /^simas-pwa-v\d+$/.test(name);

async function digestResponse(response) {
    const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function verifiedResponse(response, revision) {
    return !!response && response.status === 200 && (!revision || await digestResponse(response) === revision);
}

async function completedReleases() {
    const releases = [];
    for (const name of await caches.keys()) {
        if (!name.startsWith(RELEASE_PREFIX)) continue;
        const marker = await (await caches.open(name)).match(MANIFEST_KEY);
        if (!marker) continue;
        try {
            const manifest = await marker.json();
            if (Array.isArray(manifest.assets)) releases.push({ ...manifest, name });
        } catch (_) { /* An incomplete/corrupt staging cache cannot supply a release. */ }
    }
    return releases.sort((a, b) => Number(b.installedAt || 0) - Number(a.installedAt || 0));
}

async function cachedExact(request, legacyRevision, verifyEveryCache = false) {
    const current = await (await caches.open(RELEASE_CACHE_NAME)).match(request);
    if (current && (!verifyEveryCache || await verifiedResponse(current, legacyRevision))) return current;
    for (const release of await completedReleases()) {
        if (release.name === RELEASE_CACHE_NAME) continue;
        const response = await (await caches.open(release.name)).match(request);
        if (response && (!verifyEveryCache || await verifiedResponse(response, legacyRevision))) return response;
    }
    // Preserve already-downloaded exact version queries through the first migration.
    for (const name of await caches.keys()) {
        if (!/^simas-pwa-v\d+$/.test(name) || name === RELEASE_CACHE_NAME) continue;
        const response = await (await caches.open(name)).match(request);
        if (response && (!legacyRevision || await verifiedResponse(response, legacyRevision))) return response;
    }
    return undefined;
}

async function previousAsset(url) {
    for (const release of await completedReleases()) {
        const asset = release.assets.find(item => item.url === url);
        if (asset) return asset;
    }
    return undefined;
}

const RECONSTRUCTION_LIMIT = 2 * 1024 * 1024;
const HASHED_TEXT_TOKEN = /[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*\.[a-f0-9]{16}\.(?:js|mjs|css)\b/g;

function htmlWithCurrentVersion(text) {
    const opening = text.match(/<html\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/i);
    if (!opening) return text;
    for (const attribute of opening[0].matchAll(/\s+([a-z_:][a-z\d_:.-]*)\s*=\s*("[^"]*"|'[^']*')/gi)) {
        if (attribute[1].toLowerCase() !== 'data-simas-version') continue;
        const valueAt = attribute[0].lastIndexOf(attribute[2]);
        const quote = attribute[2][0];
        const replacement = attribute[0].slice(0, valueAt) + quote + String(MANIFEST.version) + quote;
        const tag = opening[0].slice(0, attribute.index) + replacement + opening[0].slice(attribute.index + attribute[0].length);
        return text.slice(0, opening.index) + tag + text.slice(opening.index + opening[0].length);
    }
    return text;
}

function textAssetKind(asset) {
    const url = new URL(asset.url);
    if (url.search) return undefined;
    if (url.pathname === SW_ROOT.pathname || url.pathname.endsWith('.html')) return 'html';
    return /\.(?:js|mjs|css)$/.test(url.pathname) ? 'module' : undefined;
}

function moduleAliasSource(asset, assets) {
    if (!asset || textAssetKind(asset) !== 'module') return undefined;
    const logical = new URL(asset.url), source = new URL(asset.sourceUrl);
    if (HASHED_FILE.test(logical.pathname) || source.search || logical.pathname === source.pathname) return undefined;
    const token = source.pathname.slice(source.pathname.lastIndexOf('/') + 1);
    const sourceEntry = assets.get(source.href);
    // Only a declared hash sibling of this exact logical path proves a rename.
    if (!/\.[a-f0-9]{16}\.(?:js|mjs|css)$/.test(token) ||
        source.pathname.replace(/\.[a-f0-9]{16}(\.(?:js|mjs|css))$/, '$1') !== logical.pathname ||
        !sourceEntry || sourceEntry.revision !== asset.revision) return undefined;
    return token;
}

function referenceReuseContext(release) {
    if (!/^[a-f0-9]{64}$/i.test(release.revision || '') || release.name !== RELEASE_PREFIX + release.revision) return undefined;
    try {
        const assets = new Map();
        for (const entry of release.assets) {
            const asset = { url: publicAssetUrl(entry.url), sourceUrl: publicAssetUrl(entry.sourceUrl || entry.url), revision: entry.revision };
            if (!/^[a-f0-9]{64}$/i.test(asset.revision || '') || assets.has(asset.url)) return undefined;
            assets.set(asset.url, asset);
        }
        const replacements = new Map();
        for (const old of assets.values()) {
            const before = moduleAliasSource(old, assets);
            if (!before) continue;
            const after = moduleAliasSource(ASSET_BY_URL.get(old.url), ASSET_BY_URL) || null;
            // Identical basenames in different directories must agree, including unchanged/removed aliases.
            if (!replacements.has(before)) replacements.set(before, after);
            else if (replacements.get(before) !== after) replacements.set(before, null);
        }
        return { assets, replacements };
    } catch (_) { return undefined; }
}

async function boundedTextBytes(response) {
    if (!response.body) return undefined;
    const reader = response.clone().body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > RECONSTRUCTION_LIMIT) {
            // Do not await cancellation of a tee while the other response branch is unconsumed.
            reader.cancel().catch(() => undefined);
            return undefined;
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
}

async function reconstructedAsset(response, asset, previousRevision, replacements) {
    const kind = textAssetKind(asset);
    if (!kind || !response || response.status !== 200 || !asset.revision || !previousRevision) return undefined;
    try {
        const bytes = await boundedTextBytes(response);
        if (!bytes) return undefined;
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const revision = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (revision !== previousRevision) return undefined;
        const original = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        // One pass prevents a rename from accidentally becoming another rename's input.
        let text = replacements ? original.replace(HASHED_TEXT_TOKEN, token => replacements.get(token) || token) : original;
        if (kind === 'html') text = htmlWithCurrentVersion(text);
        if (text === original) return undefined;
        const candidate = new Response(text, { status: 200, statusText: response.statusText, headers: response.headers });
        for (const name of ['Content-Length', 'Content-Encoding', 'ETag', 'Last-Modified', 'Content-MD5', 'Digest', 'Content-Digest', 'Repr-Digest']) candidate.headers.delete(name);
        // The target build digest is the final authority; every unsupported edit falls back to fetch.
        return await verifiedResponse(candidate, asset.revision) ? candidate : undefined;
    } catch (_) { return undefined; }
}

async function reusableAsset(asset, aliases, names, contexts) {
    for (const name of names) {
        const cache = await caches.open(name);
        const keys = new Set(aliases.flatMap(alias => [alias.sourceUrl, alias.url]));
        for (const key of keys) {
            const response = await cache.match(key);
            // Legacy URL identity alone never proves that its body belongs to this release.
            if (await verifiedResponse(response, asset.revision)) return response;
        }
        const context = contexts.get(name);
        if (!context) continue;
        const attempted = new Set();
        for (const alias of aliases) {
            if (!textAssetKind(alias)) continue;
            const old = context.assets.get(alias.url);
            if (!old || textAssetKind(old) !== textAssetKind(alias) || new URL(old.sourceUrl).search ||
                (textAssetKind(alias) === 'module' && (!moduleAliasSource(old, context.assets) || !moduleAliasSource(alias, ASSET_BY_URL)))) continue;
            for (const key of new Set([old.sourceUrl, old.url])) {
                if (attempted.has(key)) continue;
                attempted.add(key);
                const response = await cache.match(key);
                const updated = response && await reconstructedAsset(response, asset, old.revision, context.replacements);
                if (updated) return updated;
            }
        }
    }
    return undefined;
}

async function installOfflineRelease() {
    const cache = await caches.open(RELEASE_CACHE_NAME);
    const oldNames = (await caches.keys()).filter(isOwnedCache);
    const contexts = new Map((await completedReleases()).map(release => [release.name, referenceReuseContext(release)]));
    const aliasesByBody = new Map();
    for (const asset of OFFLINE_ASSETS) {
        const key = asset.revision || asset.sourceUrl;
        if (!aliasesByBody.has(key)) aliasesByBody.set(key, []);
        aliasesByBody.get(key).push(asset);
    }
    const bodies = new Map();
    let next = 0;
    let failure;
    const prepare = async asset => {
        const key = asset.revision || asset.sourceUrl;
        if (!bodies.has(key)) bodies.set(key, (async () => {
            const reused = asset.revision && await reusableAsset(asset, aliasesByBody.get(key), oldNames, contexts);
            const response = reused || await fetch(new Request(asset.sourceUrl, { credentials: 'same-origin' }));
            if (!await verifiedResponse(response, asset.revision)) throw new Error('Offline asset failed its revision check: ' + new URL(asset.url).pathname);
            return response;
        })());
        await cache.put(asset.url, (await bodies.get(key)).clone());
    };
    await Promise.all(Array.from({ length: Math.min(4, PRECACHE_ASSETS.length) }, async () => {
        while (!failure && next < PRECACHE_ASSETS.length) {
            const asset = PRECACHE_ASSETS[next++];
            try { await prepare(asset); } catch (error) { failure = error; }
        }
    }));
    if (failure) {
        // Never expose partial staging as a complete offline release.
        if (RELEASE_CACHE_NAME.startsWith(RELEASE_PREFIX) && !await cache.match(MANIFEST_KEY)) await caches.delete(RELEASE_CACHE_NAME);
        throw failure;
    }
    await cache.put(MANIFEST_KEY, new Response(JSON.stringify({
        version: MANIFEST.version, revision: MANIFEST.revision, installedAt: Date.now(), assets: OFFLINE_ASSETS
    }), { headers: { 'Content-Type': 'application/json' } }));
}

self.addEventListener('install', event => {
    // Natural waiting protects forms, uploads and quizzes in every existing tab.
    event.waitUntil(installOfflineRelease());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        // Natural activation waits for the previous controller's tabs to close.
        // Uncontrolled pages use the network and must not pin every old offline release.
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: false });
        if (windows.length) return;
        const releases = await completedReleases();
        const keep = new Set([RELEASE_CACHE_NAME, ...releases.filter(item => item.name !== RELEASE_CACHE_NAME).slice(0, 1).map(item => item.name)]);
        for (const name of await caches.keys()) {
            if (name.startsWith(RELEASE_PREFIX) && !keep.has(name)) await caches.delete(name);
        }
        // The one pre-migration cache is retained for exact older ?v requests.
    })());
    // Deliberately no clients.claim(): first installation does not reload a live page.
});

async function htmlDependenciesReady(response, requestUrl) {
    if (!rawManifest) return true; // Local source serving retains its development revalidation.
    const revision = await digestResponse(response);
    const url = new URL(requestUrl);
    const bare = new URL(url); bare.search = '';
    for (const release of await completedReleases()) {
        const asset = release.assets.find(item => item.url === url.href || item.url === bare.href);
        // The marker is committed only after the entire recursive JS/CSS closure,
        // including inline module imports, has been downloaded and verified.
        if (asset && asset.revision === revision) return true;
    }
    return false;
}

async function respondToPublicAsset(request, rememberBackground) {
    const url = new URL(request.url);
    const immutable = !url.search && HASHED_FILE.test(url.pathname);
    const asset = ASSET_BY_URL.get(url.href) || (immutable && await previousAsset(url.href));
    // Fixed public logos/fonts are also immutable within their pinned release.
    // Their actual body is checked before accepting a hit from any older cache.
    const binaryPinned = !!asset && PINNED_BINARY.test(url.pathname) && /^[a-f0-9]{64}$/i.test(asset.revision || '');
    const pinned = immutable || binaryPinned;
    // A hash-looking URL alone is not permission to cache an arbitrary endpoint.
    if (immutable && !asset) return fetch(request);
    const cached = await cachedExact(request, pinned && asset.revision, binaryPinned);
    if (pinned && cached) return cached;
    const isHtml = url.pathname === SW_ROOT.pathname || url.pathname.endsWith('.html');
    const refresh = (async () => {
        const response = await fetch(request);
        if (response && response.status === 200 && !response.redirected &&
            !/\bprivate\b/i.test(response.headers.get('Cache-Control') || '')) {
            const safe = pinned ? await verifiedResponse(response, asset.revision) : !isHtml || await htmlDependenciesReady(response, url);
            // An old active worker can see a freshly deployed fixed-name logo.
            // Display that successful online response without assigning it to the old revision.
            if (immutable && !safe) throw new Error('Immutable asset revision mismatch.');
            if (safe) {
                // Cache quota/storage failure must not discard a successful online response.
                try { await (await caches.open(RELEASE_CACHE_NAME)).put(request, response.clone()); } catch (_) { /* Online response is still usable. */ }
            }
        }
        return response;
    })();
    rememberBackground(refresh.catch(() => undefined));
    if (cached) return cached;
    try { return await refresh; } catch (_) {
        // Only a manifest-listed static HTML shell can be a navigation fallback.
        if (isHtml) {
            const bare = new URL(url); bare.search = '';
            if (PUBLIC_PATHS.has(bare.pathname)) {
                const shell = await cachedExact(bare.href);
                if (shell) return shell;
            }
        }
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }
}

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== SW_ROOT.origin || PRIVATE_PATH.test(url.pathname) || hasPrivateQuery(url) ||
        request.headers.has('Authorization') || request.headers.has('X-Student-Token') || request.headers.has('Range') ||
        url.href.includes('[object%20Object]')) return;
    if (!PUBLIC_PATHS.has(url.pathname) && !HASHED_FILE.test(url.pathname)) return;
    let background = Promise.resolve();
    const response = respondToPublicAsset(request, promise => { background = promise; });
    event.respondWith(response);
    // Keep revalidation and cache writes alive after a warm response has returned.
    event.waitUntil(response.then(() => background).catch(() => undefined));
});
