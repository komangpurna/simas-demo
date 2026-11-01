/** Read-only deployment gate. Parses generated metadata as JSON, never executable code. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('acorn');
const walk = require('acorn-walk');
const parse5 = require('parse5');
const ORIGIN = 'https://hosting-check.invalid/';
const SHA = /^[a-f0-9]{64}$/;
const HASHED = /\.[a-f0-9]{16}\.(?:js|mjs|css)$/;
const PRIVATE_PATH = /(?:^|\/)(?:api|auth|sessions?|gateway|proxy|__|private|credentials?|secrets?)(?:\/|$)/i;
const PRIVATE_QUERY = /^(?:access_token|id_token|token|student_token|session|session_id|authorization|credential|password|birthdate)$/i;
const PRIVATE_DIRECTORY = /(?:^|\/)(?:tests?|__tests__|cypress|scripts|docs?|sql|backup|cloudflare|functions|supabase|google-apps-script|node_modules)(?:\/|$)/i;
const PRIVATE_FILE = /(?:^|\/)(?:package(?:-lock)?\.json|firebase\.json|firestore\.(?:rules|indexes\.json)|service[-_]?account[^/]*\.json|credentials?[^/]*\.json|secrets?[^/]*\.json)$|\.(?:md|docx?|xlsx?|csv|sql|log|key|pem|keystore|jks|env|php)$/i;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const slash = value => value.split(path.sep).join('/');

function inside(root, target) {
    const relative = path.relative(root, target);
    return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function publicFile(file) {
    if (file === '.hosting-build.json') return;
    if (PRIVATE_DIRECTORY.test(file) || PRIVATE_FILE.test(file) || PRIVATE_PATH.test(file) ||
        file.split('/').some(part => part.startsWith('.') && part !== '.well-known')) {
        throw new Error('Private or development file in hosting output: ' + file);
    }
}

function localUrl(value, from = 'index.html', manifest = false) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid empty asset URL');
    value = value.trim();
    if (!manifest && /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return null;
    if (value.includes('\\') || (manifest && (!/^(?:\.\/|\/)/.test(value) || value.startsWith('//') ||
        value.split(/[?#]/, 1)[0].split('/').some(part => decodeURIComponent(part) === '..')))) throw new Error('Unsafe asset path: ' + value);
    const url = new URL(value, new URL(from, ORIGIN));
    if (url.origin !== new URL(ORIGIN).origin || (manifest && url.hash)) throw new Error('Asset URL leaves the hosting output: ' + value);
    if (/%2f|%5c/i.test(url.pathname)) throw new Error('Encoded path separator in asset URL: ' + value);
    let decoded;
    try { decoded = decodeURIComponent(url.pathname); } catch (_) { throw new Error('Invalid URL encoding: ' + value); }
    if (decoded.includes('\\') || decoded.split('/').includes('..')) throw new Error('Unsafe decoded asset path: ' + value);
    const file = decoded.replace(/^\//, '') || 'index.html';
    publicFile(file);
    if (Array.from(url.searchParams.keys()).some(key => PRIVATE_QUERY.test(key))) throw new Error('Credential or session query in asset URL: ' + file);
    url.hash = '';
    return { file, url: url.href, value };
}

function parseJs(source, file) {
    try { return acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true }); }
    catch (error) {
        try { return acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }); }
        catch (_) { throw new Error('Invalid JavaScript in ' + file + ': ' + error.message); }
    }
}

function javascriptReferences(source, file) {
    const references = [];
    const add = (node, required = true, kind) => {
        const value = node?.type === 'Literal' ? node.value : node?.type === 'TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : null;
        if (typeof value !== 'string') {
            if (required) throw new Error('Non-literal module dependency in ' + file);
            return;
        }
        // Bare package imports (for example the existing Node/Jest docx fallback)
        // are not paths inside the deployed browser artifact.
        if (required && !/^(?:\.{1,2}\/|\/|[a-z][a-z\d+.-]*:)/i.test(value)) return;
        if (!required && !/\.[a-z\d]+(?:[?#]|$)/i.test(value)) return;
        const reference = localUrl(value, file);
        if (reference) references.push({ ...reference, kind: kind || (required ? 'module' : 'asset') });
    };
    walk.simple(parseJs(source, file), {
        ImportDeclaration(node) { add(node.source); },
        ExportNamedDeclaration(node) { if (node.source) add(node.source); },
        ExportAllDeclaration(node) { add(node.source); },
        ImportExpression(node) { add(node.source); },
        CallExpression(node) {
            if (node.callee.type === 'Identifier' && node.callee.name === 'importScripts') for (const argument of node.arguments) add(argument, true, 'worker-bootstrap');
        },
        NewExpression(node) {
            if (node.callee.name === 'URL' && node.arguments[1]?.type === 'MemberExpression' && node.arguments[1].object?.type === 'MetaProperty') add(node.arguments[0], false);
        }
    });
    return references;
}

function cssReferences(source, file) {
    const references = [];
    for (const match of source.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)|@import\s+(['"])([^'"]+)\3/g)) {
        const reference = localUrl(match[2] || match[4], file);
        if (reference) references.push({ ...reference, kind: 'asset' });
    }
    return references;
}

function htmlReferences(source, file) {
    const references = [];
    function visit(node) {
        const attrs = new Map((node.attrs || []).map(attr => [attr.name, attr.value]));
        for (const name of ['src', 'href', 'poster']) {
            const value = attrs.get(name);
            if (!value || value.startsWith('#')) continue;
            // School identity fills these outbound anchor links at runtime;
            // module/image sources are still required to resolve to real files.
            if (node.nodeName === 'a' && name === 'href' && /^\{\{[a-z_]\w*\}\}$/i.test(value)) continue;
            const reference = localUrl(value, file);
            if (reference) references.push({ ...reference, kind: node.nodeName === 'a' && name === 'href' ? 'navigation' : 'asset' });
        }
        if (node.nodeName === 'script' && !attrs.has('src') &&
            (!attrs.has('type') || /^(?:module|text\/javascript|application\/javascript)$/.test(attrs.get('type')))) {
            references.push(...javascriptReferences((node.childNodes || []).map(child => child.value || '').join(''), file));
        }
        if (node.nodeName === 'style') references.push(...cssReferences((node.childNodes || []).map(child => child.value || '').join(''), file));
        for (const child of node.childNodes || []) visit(child);
        if (node.content) visit(node.content);
    }
    visit(parse5.parse(source));
    return references;
}

function legacyAssets(source) {
    let assets;
    walk.simple(parseJs(source, 'sw.js'), { VariableDeclarator(node) {
        if (node.id.name !== 'ASSETS_TO_CACHE') return;
        if (node.init?.type !== 'ArrayExpression') throw new Error('ASSETS_TO_CACHE must be a literal array');
        assets = node.init.elements.map(element => {
            if (element?.type !== 'Literal' || typeof element.value !== 'string') throw new Error('ASSETS_TO_CACHE must contain literal URLs');
            return element.value;
        });
    } });
    if (!assets?.length) throw new Error('Missing source ASSETS_TO_CACHE offline coverage');
    return assets;
}

export async function checkHostingBuild({ root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), output = 'dist-hosting' } = {}) {
    root = path.resolve(root);
    const directory = path.resolve(root, output);
    if (!inside(root, directory) || directory === root) throw new Error('Hosting output must be a child directory of the project');
    const realDirectory = await fs.realpath(directory);
    const realRoot = await fs.realpath(root);
    if (!inside(realRoot, realDirectory)) throw new Error('Hosting output symlink leaves the project');
    let report;
    try { report = JSON.parse(await fs.readFile(path.join(directory, '.hosting-build.json'), 'utf8')); }
    catch (_) { throw new Error('Missing or invalid .hosting-build.json build marker'); }
    if (report.schemaVersion !== 1 || !report.mapping || typeof report.mapping !== 'object' || Array.isArray(report.mapping)) throw new Error('Invalid hosting build marker schema');
    const expectedVersion = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
    if (report.version !== expectedVersion) throw new Error('Hosting build version differs from package.json');

    const files = new Map();
    async function inventory(relative = '') {
        for (const item of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
            const file = slash(path.join(relative, item.name));
            const disk = path.resolve(directory, file);
            publicFile(file);
            const real = await fs.realpath(disk);
            if (!inside(realDirectory, real)) throw new Error('Hosting file symlink leaves the output: ' + file);
            if (item.isSymbolicLink()) throw new Error('Symlink entries are not supported in hosting output: ' + file);
            if (item.isDirectory()) await inventory(file);
            else if (item.isFile()) files.set(file, await fs.readFile(disk));
            else throw new Error('Non-file entry in hosting output: ' + file);
        }
    }
    await inventory();
    const manifestSource = files.get('sw-manifest.js')?.toString('utf8');
    const match = manifestSource?.match(/^\s*self\.SIMAS_SW_MANIFEST\s*=\s*(\{[\s\S]*\})\s*;\s*$/);
    if (!match) throw new Error('sw-manifest.js must contain exactly one JSON assignment');
    let manifest;
    try { manifest = JSON.parse(match[1]); } catch (_) { throw new Error('sw-manifest.js contains invalid JSON'); }
    if (manifest.version !== report.version || !SHA.test(manifest.revision || '') || !Array.isArray(manifest.assets) || !manifest.assets.length) throw new Error('Invalid offline manifest schema/version');
    if (manifest.revision !== hash(JSON.stringify({ version: manifest.version, assets: manifest.assets }))) throw new Error('Offline manifest revision does not match its contents');
    if (report.manifestRevision !== manifest.revision || report.manifestEntryCount !== manifest.assets.length) throw new Error('Build marker does not match offline manifest');
    if (report.emittedFileCount !== files.size) throw new Error('Build marker emitted file count differs from output inventory');

    const entries = new Map();
    const precachedFiles = new Set();
    const fileDigest = new Map();
    const digest = file => {
        if (!files.has(file)) throw new Error('Missing manifest file: ' + file);
        if (!fileDigest.has(file)) fileDigest.set(file, hash(files.get(file)));
        return fileDigest.get(file);
    };
    for (const entry of manifest.assets) {
        if (!SHA.test(entry.revision || '') || (entry.precache !== undefined && typeof entry.precache !== 'boolean')) throw new Error('Invalid asset revision or precache flag');
        const target = localUrl(entry.url, 'index.html', true);
        if (entries.has(target.url)) throw new Error('Duplicate offline manifest URL: ' + entry.url);
        if (digest(target.file) !== entry.revision) throw new Error('Asset body revision mismatch: ' + target.file);
        if (entry.sourceUrl !== undefined) {
            const source = localUrl(entry.sourceUrl, 'index.html', true);
            if (digest(source.file) !== entry.revision || !files.get(source.file).equals(files.get(target.file))) throw new Error('sourceUrl body differs from its alias: ' + target.file);
        }
        entries.set(target.url, { ...entry, file: target.file });
        if (entry.precache !== false) precachedFiles.add(target.file);
    }
    const sourceWorker = await fs.readFile(path.join(root, 'sw.js'));
    if (!files.get('sw.js')?.equals(sourceWorker)) throw new Error('Built sw.js differs from the current source; rebuild before deployment');
    const legacy = legacyAssets(sourceWorker.toString('utf8'));
    for (const value of legacy) {
        const entry = entries.get(localUrl(value, 'index.html', true).url);
        if (!entry || entry.precache === false) throw new Error('Original offline asset is missing from precache: ' + value);
    }
    for (const [logical, hashed] of Object.entries(report.mapping)) {
        const a = localUrl('./' + logical, 'index.html', true);
        const b = localUrl('./' + hashed, 'index.html', true);
        if (!HASHED.test(hashed) || path.posix.dirname(logical) !== path.posix.dirname(hashed) ||
            logical.replace(/\.(?:js|mjs|css)$/, '') !== hashed.replace(/\.[a-f0-9]{16}\.(?:js|mjs|css)$/, '') ||
            path.posix.extname(logical) !== path.posix.extname(hashed)) throw new Error('Hashed mapping changes module path depth or identity: ' + logical);
        if (!files.get(a.file)?.equals(files.get(b.file) || Buffer.alloc(0))) throw new Error('Compatibility alias differs from hashed file: ' + logical);
        if (entries.get(a.url)?.sourceUrl !== './' + hashed || !entries.has(b.url)) throw new Error('Hashed mapping is not represented by exact manifest aliases: ' + logical);
    }
    if (report.hashedFileCount !== Object.keys(report.mapping).length) throw new Error('Hashed file count differs from mapping');

    // This inventory is deploy-only: keeping old graphs out of sw-manifest.js
    // prevents every worker update check from downloading a growing history.
    let history;
    try { history = JSON.parse(files.get('hosting-history.json')?.toString('utf8')); }
    catch (_) { throw new Error('Missing or invalid hosting-history.json inventory'); }
    if (history.schemaVersion !== 1 || history.version !== manifest.version || history.manifestRevision !== manifest.revision ||
        !Array.isArray(history.files) || !SHA.test(history.revision || '')) throw new Error('Invalid hosting history schema or release binding');
    const historyPayload = { schemaVersion: history.schemaVersion, version: history.version, manifestRevision: history.manifestRevision, files: history.files };
    if (hash(JSON.stringify(historyPayload)) !== history.revision) throw new Error('Hosting history revision does not match its contents');
    if (report.history?.revision !== history.revision || report.history?.inventoryFileCount !== history.files.length) throw new Error('Build marker does not match hosting history');
    const currentHashes = new Set(Object.values(report.mapping));
    const historyFiles = new Map();
    for (const record of history.files) {
        if (!record || typeof record.path !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(record.path) ||
            record.path.split('/').some(part => !part || part === '.' || part === '..') || !HASHED.test(record.path) ||
            !SHA.test(record.revision || '') || typeof record.lastSeenAt !== 'string' || !Number.isFinite(Date.parse(record.lastSeenAt)) ||
            (record.requiredUntil !== undefined && (typeof record.requiredUntil !== 'string' || !Number.isFinite(Date.parse(record.requiredUntil))))) {
            throw new Error('Unsafe hosting history path, revision or timestamp');
        }
        const target = localUrl('./' + record.path, 'index.html', true);
        if (target.file !== record.path || historyFiles.has(record.path)) throw new Error('Duplicate or noncanonical hosting history path: ' + record.path);
        if (digest(target.file) !== record.revision) throw new Error('Hosting history body revision mismatch: ' + record.path);
        historyFiles.set(record.path, record);
    }
    for (const file of files.keys()) {
        if (HASHED.test(file) && !historyFiles.has(file)) throw new Error('Emitted immutable file is missing from hosting history: ' + file);
    }
    for (const entry of entries.values()) {
        const source = entry.sourceUrl === undefined ? null : localUrl(entry.sourceUrl, 'index.html', true);
        if (entry.file === 'hosting-history.json' || source?.file === 'hosting-history.json') throw new Error('Deploy-only history must not enter the offline manifest');
        if ((HASHED.test(entry.file) && !currentHashes.has(entry.file)) ||
            (source && HASHED.test(source.file) && !currentHashes.has(source.file))) throw new Error('Historical immutable file must not enter the current offline manifest: ' + entry.file);
    }

    let checkedReferences = 0;
    const warnings = new Map();
    const parsed = new Map();
    for (const [file, bytes] of files) {
        if (!/\.(?:html|js|mjs|css)$/.test(file) || file === 'sw-manifest.js') continue;
        const parseKey = path.posix.dirname(file) + ':' + hash(bytes) + ':' + path.posix.extname(file);
        if (!parsed.has(parseKey)) {
            const text = bytes.toString('utf8');
            parsed.set(parseKey, file.endsWith('.html') ? htmlReferences(text, file) : file.endsWith('.css') ? cssReferences(text, file) : javascriptReferences(text, file));
        }
        for (const reference of parsed.get(parseKey)) {
            checkedReferences++;
            if (!files.has(reference.file)) {
                if (reference.kind === 'navigation') {
                    const existsInSource = await fs.stat(path.join(root, reference.file)).then(stat => stat.isFile()).catch(error => {
                        if (error.code === 'ENOENT') return false; throw error;
                    });
                    if (!existsInSource) {
                        const warning = { type: 'preexisting-missing-navigation', file, target: reference.file };
                        warnings.set(file + ':' + reference.url, warning);
                        continue;
                    }
                }
                throw new Error('Missing deployment dependency in ' + file + ': ' + reference.value);
            }
            const workerBootstrap = file === 'firebase-messaging-sw.js' && reference.file === 'sw.js' && reference.kind === 'worker-bootstrap';
            if (precachedFiles.has(file) && /\.(?:js|mjs|css)$/.test(reference.file) && reference.file !== 'sw-manifest.js' && !workerBootstrap) {
                const entry = entries.get(reference.url);
                if (!entry || entry.precache === false) throw new Error('Offline dependency/query is not precached in ' + file + ': ' + reference.value);
            }
        }
    }
    return { ok: true, version: manifest.version, manifestRevision: manifest.revision,
        files: files.size, assets: entries.size, precacheAssets: manifest.assets.filter(entry => entry.precache !== false).length,
        hashedFiles: Object.keys(report.mapping).length, historyFiles: historyFiles.size, historicalFiles: [...historyFiles.keys()].filter(file => !currentHashes.has(file)).length,
        historyRevision: history.revision, checkedReferences, legacyPrecacheCovered: legacy.length,
        warnings: Array.from(warnings.values()) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const args = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
        if (!['--root', '--output'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node scripts/check-hosting-build.mjs [--root path] [--output relative-directory]');
        options[args[i].slice(2)] = args[i + 1];
    }
    checkHostingBuild(options).then(result => console.log(JSON.stringify(result))).catch(error => {
        console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1;
    });
}
