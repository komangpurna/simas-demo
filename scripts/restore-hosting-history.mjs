/** Deploy-only recovery of public immutable files; ordinary builds stay offline. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('acorn'), walk = require('acorn-walk');
const SITES = { smagesa: 'https://smagesa.web.app', sman1abang: 'https://sman1abang.web.app' };
const HASHED = /\.[a-f0-9]{16}\.(?:js|mjs|css)$/;
const SHA = /^[a-f0-9]{64}$/;
const RETENTION_MS = 30 * 86400000;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const privatePath = value => value.split('/').some((part, i) => part.startsWith('.') && !(i === 0 && part === '.well-known'));

function publicUrl(value, origin, source = false) {
    if (typeof value !== 'string' || !value.startsWith('./') || value.includes('\\') || value.includes('#')) throw new Error('Unsafe public manifest URL');
    const [raw, query] = value.slice(2).split('?');
    if (value.split('?').length > 2 || !/^[A-Za-z0-9_./-]*$/.test(raw) || (raw && raw.split('/').some(p => !p || p === '.' || p === '..')) || privatePath(raw)) throw new Error('Unsafe public manifest path');
    if (source && query !== undefined) throw new Error('Source URLs must not contain queries');
    if (query !== undefined) {
        for (const [key, val] of new URLSearchParams(query)) {
            if (!['v', 'mode', 'theme', 'print'].includes(key) || !/^[A-Za-z0-9_.-]{0,64}$/.test(val)) throw new Error('Unsafe public manifest query');
        }
    }
    const url = new URL(value, origin + '/');
    if (url.origin !== origin || url.username || url.password) throw new Error('Cross-origin public manifest URL');
    return { path: raw || 'index.html', query: query !== undefined, url: url.href };
}

function validateManifest(value, origin) {
    if (!value || !/^\d{2}\.\d{2}\.\d{2}\.\d+$/.test(value.version) || !SHA.test(value.revision) || !Array.isArray(value.assets) || value.assets.length > 20000) throw new Error('Invalid public release manifest');
    if (sha(JSON.stringify({ version: value.version, assets: value.assets })) !== value.revision) throw new Error('Public manifest digest mismatch');
    const files = new Map(), candidates = [], currentFiles = new Set();
    for (const entry of value.assets) {
        if (!entry || !SHA.test(entry.revision) || (entry.precache !== undefined && typeof entry.precache !== 'boolean')) throw new Error('Invalid public asset revision');
        const target = publicUrl(entry.url, origin);
        const source = entry.sourceUrl === undefined ? null : publicUrl(entry.sourceUrl, origin, true);
        if (HASHED.test(target.path) && !target.query) {
            if (files.has(target.path) && files.get(target.path) !== entry.revision) throw new Error('Conflicting immutable revisions');
            files.set(target.path, entry.revision);
        }
        if (HASHED.test(target.path)) candidates.push([target.path, entry.revision]);
        if (source && HASHED.test(source.path)) {
            candidates.push([source.path, entry.revision]);
            if (!HASHED.test(target.path) && !target.query) currentFiles.add(source.path);
        }
    }
    for (const [file, revision] of candidates) if (files.get(file) !== revision) throw new Error('Missing exact immutable manifest entry');
    if (!files.size) throw new Error('Public release manifest has no immutable graph');
    return { manifest: value, files, currentFiles };
}

function parseManifest(text, origin) {
    const match = text.match(/^\s*self\.SIMAS_SW_MANIFEST\s*=\s*([\s\S]*);\s*$/);
    if (!match) throw new Error('Invalid public manifest assignment');
    return validateManifest(JSON.parse(match[1]), origin);
}

function validateRecord(entry) {
    if (!entry || typeof entry.path !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(entry.path) || entry.path.split('/').some(p => !p || p === '.' || p === '..') || privatePath(entry.path) || !HASHED.test(entry.path) || !SHA.test(entry.revision) || typeof entry.lastSeenAt !== 'string' || !Number.isFinite(Date.parse(entry.lastSeenAt)) || (entry.requiredUntil !== undefined && (typeof entry.requiredUntil !== 'string' || !Number.isFinite(Date.parse(entry.requiredUntil))))) throw new Error('Unsafe history inventory entry');
}

function validateHistory(value, active) {
    if (!value || value.schemaVersion !== 1 || !SHA.test(value.revision) || !Array.isArray(value.files) || value.files.length > 100000) throw new Error('Invalid public history inventory');
    const payload = { schemaVersion: value.schemaVersion, version: value.version, manifestRevision: value.manifestRevision, files: value.files };
    if (sha(JSON.stringify(payload)) !== value.revision) throw new Error('Public history digest mismatch');
    if (value.version !== active.manifest.version || value.manifestRevision !== active.manifest.revision) throw new Error('Public history does not match the deployed manifest');
    const records = new Map();
    for (const entry of value.files) {
        validateRecord(entry);
        if (records.has(entry.path)) throw new Error('Duplicate public history path');
        records.set(entry.path, entry);
    }
    for (const [file, revision] of active.files) {
        if (!active.currentFiles.has(file)) throw new Error('Public browser manifest contains a historical graph');
        if (records.get(file)?.revision !== revision) throw new Error('Current immutable graph missing from public history');
    }
    return { document: value, records };
}

function proveLegacy(text) {
    if (/SIMAS_SW_MANIFEST|sw-manifest|\.[a-f0-9]{16}\.(?:js|mjs|css)/.test(text)) throw new Error('Missing manifest on a hashed release');
    const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'script' });
    let entries;
    walk.simple(ast, { VariableDeclarator(node) {
        if (node.id.name === 'ASSETS_TO_CACHE' && node.init?.type === 'ArrayExpression') entries = node.init.elements.map(item => item?.type === 'Literal' ? item.value : null);
    } });
    if (!entries?.length || entries.some(value => typeof value !== 'string')) throw new Error('Cannot prove a legacy unhashed deployment');
    for (const entry of entries) publicUrl(entry, SITES.smagesa);
}

/** All paths are owned metadata below root/.hosting-history; never follow links. */
async function historyStore(root) {
    const base = path.join(root, '.hosting-history');
    async function directory(relative = '') {
        let current = root;
        for (const part of ['.hosting-history', ...relative.split('/').filter(Boolean)]) {
            if (part === '.' || part === '..' || part.includes('\\')) throw new Error('Unsafe history directory');
            current = path.join(current, part);
            let stat = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
            if (!stat) { await fs.mkdir(current); stat = await fs.lstat(current); }
            if (stat.isSymbolicLink() || !stat.isDirectory() || await fs.realpath(current) !== current) throw new Error('Unsafe history directory symlink');
        }
        return current;
    }
    async function target(relative, create = false) {
        if (!/^[A-Za-z0-9_./-]+$/.test(relative) || relative.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe history filename');
        const parent = path.posix.dirname(relative);
        if (create) await directory(parent === '.' ? '' : parent);
        else {
            let current = base;
            for (const part of (parent === '.' ? [] : parent.split('/'))) {
                current = path.join(current, part);
                const stat = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
                if (!stat) return null;
                if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe history read symlink');
            }
        }
        const file = path.join(base, ...relative.split('/'));
        const stat = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (stat && (stat.isSymbolicLink() || !stat.isFile())) throw new Error('Unsafe history file symlink');
        if (stat && await fs.realpath(file) !== file) throw new Error('Unsafe resolved history file');
        return { file, exists: !!stat };
    }
    await directory();
    return {
        async read(relative) { const found = await target(relative); return found?.exists ? fs.readFile(found.file) : null; },
        async write(relative, bytes) {
            const found = await target(relative, true), temp = path.join(path.dirname(found.file), `.restore-${crypto.randomUUID()}.tmp`);
            try { await fs.writeFile(temp, bytes, { flag: 'wx' }); await fs.rename(temp, found.file); }
            finally { await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
        }
    };
}

export async function restoreHostingHistory({ root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), site, fetchImpl = globalThis.fetch, now = new Date(), maxDownloadBytes = Number(process.env.SIMAS_MAX_DOWNLOAD_BYTES) || 256 * 1024 * 1024, firstDeployment = false } = {}) {
    if (typeof fetchImpl !== 'function' || !Number.isFinite(now.getTime())) throw new Error('Invalid restore dependencies');
    root = await fs.realpath(path.resolve(root));
    let sites = SITES;
    try { sites = JSON.parse(await fs.readFile(path.join(root, 'scripts/hosting-sites.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!Object.hasOwn(sites, site) || !/^[a-z0-9][a-z0-9-]+$/.test(site) || sites[site] !== `https://${site}.web.app`) throw new Error('Site must be explicitly configured in scripts/hosting-sites.json');
    const origin = sites[site], store = await historyStore(root);
    const cachedBytes = await store.read(`remotes/${site}.json`);
    const cached = cachedBytes ? JSON.parse(cachedBytes.toString('utf8')) : null;
    if (cached) {
        if (cached.schemaVersion !== 1 || [cached.etag, cached.historyEtag].some(etag => etag != null && (typeof etag !== 'string' || etag.length > 256 || /[\r\n]/.test(etag)))) throw new Error('Invalid cached public manifest');
        const prior = validateManifest(cached.manifest, origin);
        if (cached.history) validateHistory(cached.history, prior);
        else if (cached.historyEtag) throw new Error('Cached history ETag has no verified inventory');
    }
    const indexBytes = await store.read('index.json');
    const index = indexBytes ? JSON.parse(indexBytes.toString('utf8')) : { schemaVersion: 1, files: [] };
    if (index.schemaVersion !== 1 || !Array.isArray(index.files)) throw new Error('Invalid local history index');
    const records = new Map();
    for (const entry of index.files) {
        validateRecord(entry);
        if (records.has(entry.path)) throw new Error('Duplicate local history path');
        records.set(entry.path, entry);
    }
    let requests = 0, downloadedBytes = 0;
    async function get(relative, etag, limit) {
        const metadata = ['/sw-manifest.js', '/sw.js', '/hosting-history.json'].includes(relative);
        if (!metadata && (!/^\/[A-Za-z0-9_./-]+$/.test(relative) || !HASHED.test(relative))) throw new Error('Restore can only fetch public metadata or immutable scripts/styles');
        requests++;
        const response = await fetchImpl(origin + relative, { method: 'GET', credentials: 'omit', redirect: 'error', headers: { Accept: relative.endsWith('.json') ? 'application/json' : 'application/javascript', 'Cache-Control': 'no-cache', ...(etag ? { 'If-None-Match': etag } : {}) }, signal: AbortSignal.timeout(20000) });
        if (response.redirected || (response.url && new URL(response.url).origin !== origin)) throw new Error('Public restore redirects are forbidden');
        let body = Buffer.alloc(0);
        if (response.status === 200) {
            const chunks = []; let length = 0;
            for await (const chunk of response.body) {
                length += chunk.length; downloadedBytes += chunk.length;
                if (length > limit || downloadedBytes > maxDownloadBytes) throw new Error('Public restore download limit exceeded');
                chunks.push(chunk);
            }
            body = Buffer.concat(chunks);
        }
        const etagValue = response.headers.get('etag');
        if (etagValue && (etagValue.length > 256 || /[\r\n]/.test(etagValue))) throw new Error('Invalid public manifest ETag');
        return { status: response.status, etag: etagValue, body };
    }
    const first = await get('/sw-manifest.js', cached?.etag, 2 * 1024 * 1024);
    if (first.status === 404) {
        if (cached) throw new Error('Previously hashed site lost its public manifest');
        const legacy = await get('/sw.js', null, 256 * 1024);
        if (legacy.status === 404 && firstDeployment && !records.size) {
            if ((await get('/sw-manifest.js', null, 2 * 1024 * 1024)).status !== 404) throw new Error('Deployment changed during first deployment verification');
            return { site, mode: 'first-deployment', requestCount: requests, downloadedBytes, downloadedFileCount: 0, reusedFileCount: 0 };
        }
        if (legacy.status !== 200) throw new Error('Cannot verify legacy deployment');
        proveLegacy(legacy.body.toString('utf8'));
        if ((await get('/sw-manifest.js', null, 2 * 1024 * 1024)).status !== 404) throw new Error('Deployment changed during legacy verification');
        return { site, mode: 'legacy-bootstrap', requestCount: requests, downloadedBytes, downloadedFileCount: 0, reusedFileCount: 0 };
    }
    const isBandwidthExceeded = first.status === 509;
    let active;
    if (first.status === 304 && cached) {
        if (!cached.etag) throw new Error('Unverified initial conditional manifest response');
        if (first.etag && first.etag !== cached.etag) throw new Error('Conditional public manifest ETag changed');
        active = validateManifest(cached.manifest, origin);
    }
    else if (first.status === 200) active = parseManifest(first.body.toString('utf8'), origin);
    else if (isBandwidthExceeded && cached) {
        console.warn(`[restore-hosting-history] Warning: ${site} returns 509 (Bandwidth Limit Exceeded). Using cached manifest.`);
        active = validateManifest(cached.manifest, origin);
    }
    else throw new Error(`Cannot read deployed public manifest (${first.status})`);
    const activeEtag = (first.status === 304 || isBandwidthExceeded) ? cached.etag : first.etag;
    const firstHistory = isBandwidthExceeded ? { status: 509 } : await get('/hosting-history.json', cached?.historyEtag, 8 * 1024 * 1024);
    let activeHistory;
    if (firstHistory.status === 304 && cached?.history && cached.historyEtag) {
        if (firstHistory.etag && firstHistory.etag !== cached.historyEtag) throw new Error('Conditional public history ETag changed');
        activeHistory = validateHistory(cached.history, active);
    }
    else if (firstHistory.status === 200) activeHistory = validateHistory(JSON.parse(firstHistory.body.toString('utf8')), active);
    else if (isBandwidthExceeded && cached?.history) {
        console.warn(`[restore-hosting-history] Warning: ${site} returns 509. Using cached history.`);
        activeHistory = validateHistory(cached.history, active);
    }
    else throw new Error(`Cannot verify deployed public history (${firstHistory.status})`);
    const historyEtag = (firstHistory.status === 304 || isBandwidthExceeded) ? cached.historyEtag : firstHistory.etag;
    const required = new Map();
    for (const [file, entry] of activeHistory.records) {
        if (records.has(file) && records.get(file).revision !== entry.revision) throw new Error('Immutable history revision conflict');
        if (active.currentFiles.has(file) || now.getTime() - Date.parse(entry.lastSeenAt) <= RETENTION_MS || Date.parse(entry.requiredUntil) > now.getTime()) required.set(file, entry);
    }
    const missing = [], verified = new Map(); let reused = 0;
    for (const [file, { revision }] of required) {
        const body = await store.read(`files/${file}`);
        if (body && sha(body) === revision) reused++;
        else missing.push({ file, revision });
    }
    let position = 0, failed;
    if (!isBandwidthExceeded) {
        await Promise.allSettled(Array.from({ length: Math.min(3, missing.length) }, async () => {
            try {
                while (!failed && position < missing.length) {
                    const entry = missing[position++], response = await get('/' + entry.file, null, 4 * 1024 * 1024);
                    if (response.status !== 200 || sha(response.body) !== entry.revision) throw new Error(`Cannot verify deployed immutable body: ${entry.file}`);
                    verified.set(entry.file, response.body);
                }
            } catch (error) { failed ||= error; }
        }));
        if (failed) throw failed;
        const final = await get('/sw-manifest.js', activeEtag, 2 * 1024 * 1024);
        if (final.status !== 304 && (final.status !== 200 || parseManifest(final.body.toString('utf8'), origin).manifest.revision !== active.manifest.revision)) throw new Error('Deployment changed during history restoration');
        if (final.status === 304 && !activeEtag) throw new Error('Unverified conditional manifest response');
        if (final.status === 304 && final.etag && final.etag !== activeEtag) throw new Error('Deployment ETag changed during history restoration');
        const finalHistory = await get('/hosting-history.json', historyEtag, 8 * 1024 * 1024);
        if (finalHistory.status !== 304 && (finalHistory.status !== 200 || validateHistory(JSON.parse(finalHistory.body.toString('utf8')), active).document.revision !== activeHistory.document.revision)) throw new Error('Deployment history changed during restoration');
        if (finalHistory.status === 304 && !historyEtag) throw new Error('Unverified conditional history response');
        if (finalHistory.status === 304 && finalHistory.etag && finalHistory.etag !== historyEtag) throw new Error('Deployment history ETag changed during restoration');
    }
    for (const [file, bytes] of verified) await store.write(`files/${file}`, bytes);
    for (const [file, entry] of required) {
        if (!records.has(file)) records.set(file, { ...entry });
        else if (Date.parse(entry.requiredUntil) > (Date.parse(records.get(file).requiredUntil) || 0)) records.get(file).requiredUntil = entry.requiredUntil;
    }
    const requiredUntil = new Date(now.getTime() + RETENTION_MS).toISOString();
    for (const file of active.currentFiles) {
        const record = records.get(file);
        if (!record.requiredUntil || Date.parse(record.requiredUntil) < Date.parse(requiredUntil)) record.requiredUntil = requiredUntil;
    }
    await store.write(`remotes/${site}.json`, JSON.stringify({ schemaVersion: 1, etag: activeEtag || null, manifest: active.manifest, historyEtag: historyEtag || null, history: activeHistory.document }, null, 2) + '\n');
    await store.write('index.json', JSON.stringify({ schemaVersion: 1, files: [...records.values()].sort((a, b) => compare(a.path, b.path)) }, null, 2) + '\n');
    return { site, mode: 'hydrated', version: active.manifest.version, manifestRevision: active.manifest.revision, historyRevision: activeHistory.document.revision, hashCount: required.size, skippedExpiredFileCount: activeHistory.records.size - required.size, pinnedCurrentFileCount: active.currentFiles.size, downloadedFileCount: verified.size, reusedFileCount: reused, requestCount: requests, downloadedBytes };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    if (process.argv.length !== 4 || process.argv[2] !== '--site') throw new Error('Usage: node scripts/restore-hosting-history.mjs --site <configured-site>');
    console.log(JSON.stringify(await restoreHostingHistory({ site: process.argv[3], firstDeployment: process.env.SIMAS_FIRST_DEPLOY === '1' }), null, 2));
}
