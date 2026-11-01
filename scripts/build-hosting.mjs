/**
 * Prepare Firebase's public files without changing application source.
 * Hashed modules stay in the same directory so import.meta.url keeps its depth.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('acorn');
const walk = require('acorn-walk');
const parse5 = require('parse5');
// Use exactly the inventory implementation used by the installed Firebase CLI.
const { listFiles } = require('firebase-tools/lib/listFiles');
const ORIGIN = 'https://hosting-build.invalid/';
const HASHED = /\.[a-f0-9]{16}\.(?:js|mjs|css)$/;
const WORKERS = new Set(['sw.js', 'push-worker.js', 'firebase-messaging-sw.js', 'sw-manifest.js']);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const slash = value => value.split(path.sep).join('/');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// A glob such as **/.* can omit the directory but still include its children.
// Never read private dot-directories, even if a CLI glob version admits them.
const privatePath = file => file.replaceAll('\\', '/').split('/').some((part, i) => part.startsWith('.') && !(i === 0 && part === '.well-known'));

function withoutAppVersion(value) {
    const hashAt = value.indexOf('#'), hash = hashAt < 0 ? '' : value.slice(hashAt);
    const head = hashAt < 0 ? value : value.slice(0, hashAt), queryAt = head.indexOf('?');
    if (queryAt < 0) return value;
    const query = new URLSearchParams(head.slice(queryAt + 1));
    if (!/^\d{2}\.\d{2}\.\d{2}\.\d+$/.test(query.get('v') || '')) return value;
    query.delete('v');
    return head.slice(0, queryAt) + (query.size ? `?${query}` : '') + hash;
}

function inside(root, target) {
    const relative = path.relative(root, target);
    return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function parseJs(source, name) {
    try {
        return acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true });
    } catch (error) {
        try { return acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }); }
        catch { throw new Error(`Cannot safely package ${name}: ${error.message}`); }
    }
}

function localReference(value, from, available) {
    if (typeof value !== 'string' || !value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value) || value.includes('\\')) return null;
    const url = new URL(value, new URL(from, ORIGIN));
    const file = decodeURIComponent(url.pathname.slice(1)) || 'index.html';
    return available.has(file) ? { file, value, url } : null;
}

function rewrittenUrl(reference, from, mapping) {
    const target = mapping.get(reference.file);
    if (!target) return reference.value;
    const url = new URL(reference.url);
    if (/^\d{2}\.\d{2}\.\d{2}\.\d+$/.test(url.searchParams.get('v') || '')) url.searchParams.delete('v');
    let relative = reference.value.startsWith('/') ? `/${target}` : path.posix.relative(path.posix.dirname(from), target);
    if (!relative.startsWith('.') && !relative.startsWith('/') && (reference.value.startsWith('./') || !relative.includes('/'))) relative = `./${relative}`;
    return relative + url.search + url.hash;
}

function applyEdits(source, edits) {
    const sorted = edits.filter(Boolean).sort((a, b) => b.start - a.start || b.end - a.end);
    let previous = source.length;
    for (const edit of sorted) {
        if (edit.end > previous) throw new Error('Overlapping build edits');
        source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
        previous = edit.start;
    }
    return source;
}

function jsReferences(source, file, available) {
    const ast = parseJs(source, file);
    const refs = [];
    const seen = new Set();
    const add = (node, required = false) => {
        const value = node?.type === 'Literal' ? node.value : node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0].value.cooked : null;
        const reference = localReference(value, file, available);
        if (required && !reference && typeof value === 'string' && /^(?:\.\.?\/|\/)/.test(value) && !value.startsWith('//')) throw new Error(`Missing deployment dependency in ${file}: ${value}`);
        if (reference && !seen.has(node.start)) { refs.push({ ...reference, start: node.start, end: node.end }); seen.add(node.start); }
    };
    walk.simple(ast, {
        ImportDeclaration(node) { add(node.source, true); },
        ExportNamedDeclaration(node) { if (node.source) add(node.source, true); },
        ExportAllDeclaration(node) { add(node.source, true); },
        ImportExpression(node) {
            if (node.source.type !== 'Literal' && !(node.source.type === 'TemplateLiteral' && node.source.expressions.length === 0)) {
                throw new Error(`Computed import cannot be packaged safely: ${file}:${node.start}`);
            }
            add(node.source, true);
        },
        NewExpression(node) {
            if (node.callee.name === 'URL' && node.arguments[1]?.type === 'MemberExpression' && node.arguments[1].object?.type === 'MetaProperty') add(node.arguments[0]);
        }
    });
    return { ast, refs };
}

function cssReferences(source, file, available) {
    const refs = [];
    const pattern = /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)|@import\s+(['"])([^'"]+)\3/g;
    for (const match of source.matchAll(pattern)) {
        const value = match[2] || match[4];
        const reference = localReference(value, file, available);
        if (!reference) continue;
        const start = match.index + match[0].indexOf(value);
        refs.push({ ...reference, start, end: start + value.length });
    }
    return refs;
}

function htmlParts(source, file, available) {
    const document = parse5.parse(source, { sourceCodeLocationInfo: true });
    const attrs = [], inlineScripts = [];
    function visit(node) {
        for (const attr of node.attrs || []) {
            if (!['src', 'href', 'poster'].includes(attr.name)) continue;
            const reference = localReference(attr.value, file, available);
            const location = node.sourceCodeLocation?.attrs?.[attr.name];
            if (reference && location) attrs.push({ ...reference, name: attr.name, start: location.startOffset, end: location.endOffset });
        }
        if (node.nodeName === 'script' && !(node.attrs || []).some(a => a.name === 'src')) {
            const type = (node.attrs || []).find(a => a.name === 'type')?.value;
            const location = node.sourceCodeLocation;
            if ((!type || /^(?:module|text\/javascript|application\/javascript)$/.test(type)) && location?.startTag && location?.endTag) {
                const start = location.startTag.endOffset, end = location.endTag.startOffset;
                inlineScripts.push({ start, end, source: source.slice(start, end) });
            }
        }
        for (const child of node.childNodes || []) visit(child);
        if (node.content) visit(node.content);
    }
    visit(document);
    return { attrs, inlineScripts };
}

function components(nodes) {
    let index = 0;
    const stack = [], active = new Set(), indices = new Map(), low = new Map(), result = [];
    function visit(file) {
        indices.set(file, index); low.set(file, index++); stack.push(file); active.add(file);
        for (const dependency of [...nodes.get(file).dependencies].sort()) {
            if (!indices.has(dependency)) { visit(dependency); low.set(file, Math.min(low.get(file), low.get(dependency))); }
            else if (active.has(dependency)) low.set(file, Math.min(low.get(file), indices.get(dependency)));
        }
        if (low.get(file) === indices.get(file)) {
            const group = []; let member;
            do { member = stack.pop(); active.delete(member); group.push(member); } while (member !== file);
            result.push(group.sort());
        }
    }
    for (const file of [...nodes.keys()].sort()) if (!indices.has(file)) visit(file);
    return result;
}

function versionConfig(source) {
    const ast = parseJs(source, 'js/config.js');
    let edit;
    walk.simple(ast, { VariableDeclarator(node) {
        if (node.id.name === 'APP_VERSION') {
            if (typeof node.init?.value !== 'string') throw new Error('Expected a literal APP_VERSION in source config');
            // A worker from the previous deployment can still serve old HTML.
            // Recover that document's existing app query version without I/O.
            edit = { start: node.init.start, end: node.init.end, text: String.raw`(() => {
    const document = globalThis.document;
    const declared = document?.documentElement?.dataset?.simasVersion;
    if (declared) return declared;
    for (const element of document?.querySelectorAll?.('script[src],link[href]') || []) {
        try {
            const base = document.baseURI || globalThis.location?.href || import.meta.url;
            const value = element.getAttribute?.('src') || element.getAttribute?.('href');
            const url = new URL(value, base);
            const version = url.searchParams.get('v');
            if (url.origin === new URL(base).origin && /^\d{2}\.\d{2}\.\d{2}\.\d+$/.test(version || '')) return version;
        } catch {}
    }
    return 'dev';
})()` };
        }
    } });
    if (!edit) throw new Error('Missing APP_VERSION in js/config.js');
    return applyEdits(source, [edit]);
}

function legacyPrecache(source) {
    const ast = parseJs(source, 'sw.js');
    let entries;
    walk.simple(ast, { VariableDeclarator(node) {
        if (node.id.name === 'ASSETS_TO_CACHE' && node.init?.type === 'ArrayExpression') {
            entries = node.init.elements.map(element => {
                if (element?.type !== 'Literal' || typeof element.value !== 'string') throw new Error('Precache entries must be static strings');
                return element.value;
            });
        }
    } });
    if (!entries) throw new Error('Missing legacy ASSETS_TO_CACHE coverage in sw.js');
    return entries;
}

export async function buildHosting({ root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), outputDir = 'dist-hosting', historyDir = '.hosting-history', now = new Date(), retentionDays = 30 } = {}) {
    root = await fs.realpath(path.resolve(root));
    const output = path.resolve(root, outputDir), history = path.resolve(root, historyDir);
    if (path.dirname(output) !== root || !path.basename(output).startsWith('dist-hosting') || path.dirname(history) !== root || path.basename(history) !== '.hosting-history') throw new Error('Unsafe output/history path');
    const historyRealpath = await fs.realpath(history).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (historyRealpath && historyRealpath !== history) throw new Error('History must not be a symlink');
    if (retentionDays < 30) throw new Error('Hash history must be retained for at least 30 days');
    const config = JSON.parse(await fs.readFile(path.join(root, 'firebase.json'), 'utf8'));
    const hosting = (Array.isArray(config.hosting) ? config.hosting : [config.hosting]).find(item => item.target === 'smagesa') || (Array.isArray(config.hosting) ? config.hosting[0] : config.hosting);
    if (!hosting) throw new Error('Missing Hosting configuration');
    const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
    if (!/^\d{2}\.\d{2}\.\d{2}\.\d+$/.test(version)) throw new Error('Expected YY.MM.DD.REV application version');
    const ignore = [...(hosting.ignore || []), `${slash(path.relative(root, output))}/**`, `${slash(path.relative(root, history))}/**`, '.dist-hosting-build-*/**'];
    const files = listFiles(root, ignore).filter(file => !privatePath(file)).sort();
    const contents = new Map();
    for (const file of files) {
        const resolved = await fs.realpath(path.join(root, file));
        if (!inside(root, resolved)) throw new Error(`Public symlink escapes source root: ${file}`);
        if (privatePath(slash(path.relative(root, resolved)))) throw new Error(`Public symlink exposes a private source path: ${file}`);
        contents.set(file, await fs.readFile(resolved));
    }
    const available = new Set(contents.keys());
    const baseline = legacyPrecache(contents.get('sw.js')?.toString('utf8') || '');
    const nodes = new Map(), runtimeFiles = new Set();
    for (const [file, bytes] of contents) {
        if (!/\.(?:js|mjs|css)$/.test(file) || WORKERS.has(file)) continue;
        let source = bytes.toString('utf8');
        if (file === 'js/config.js') source = versionConfig(source);
        let refs = file.endsWith('.css') ? cssReferences(source, file, available) : jsReferences(source, file, available).refs;
        const versionEdits = refs.filter(ref => withoutAppVersion(ref.value) !== ref.value).map(ref => ({ start: ref.start, end: ref.end, text: file.endsWith('.css') ? withoutAppVersion(ref.value) : JSON.stringify(withoutAppVersion(ref.value)) }));
        if (versionEdits.length) {
            source = applyEdits(source, versionEdits);
            refs = file.endsWith('.css') ? cssReferences(source, file, available) : jsReferences(source, file, available).refs;
        }
        nodes.set(file, { source, refs, dependencies: new Set() });
        for (const ref of refs) if (!/\.(?:js|mjs|css)$/.test(ref.file)) runtimeFiles.add(ref.file);
    }
    for (const node of nodes.values()) for (const ref of node.refs) if (nodes.has(ref.file)) node.dependencies.add(ref.file);
    const groups = components(nodes), componentByFile = new Map();
    groups.forEach((group, i) => group.forEach(file => componentByFile.set(file, i)));
    const digests = new Map();
    function digestComponent(i) {
        if (digests.has(i)) return digests.get(i);
        const dependencies = new Set();
        for (const file of groups[i]) for (const dependency of nodes.get(file).dependencies) if (componentByFile.get(dependency) !== i) dependencies.add(componentByFile.get(dependency));
        const payload = { format: 1, files: groups[i].map(file => [file, nodes.get(file).source]), dependencies: [...dependencies].map(j => [groups[j], digestComponent(j)]).sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))) };
        const digest = sha256(JSON.stringify(payload)); digests.set(i, digest); return digest;
    }
    const mapping = new Map();
    for (const file of nodes.keys()) {
        const hash = sha256(`${digestComponent(componentByFile.get(file))}\0${file}`).slice(0, 16);
        mapping.set(file, file.replace(/\.(js|mjs|css)$/, `.${hash}.$1`));
    }
    const emitted = new Map(contents), aliases = new Map(), exactReferences = new Set();
    function trackReference(ref, from) {
        const rewritten = rewrittenUrl(ref, from, mapping);
        const url = new URL(rewritten, new URL(from, ORIGIN));
        if (url.search) exactReferences.add(url.pathname.slice(1) + url.search);
        return rewritten;
    }
    for (const [file, node] of nodes) {
        const bytes = Buffer.from(applyEdits(node.source, node.refs.filter(ref => mapping.has(ref.file)).map(ref => ({ start: ref.start, end: ref.end, text: file.endsWith('.css') ? trackReference(ref, file) : JSON.stringify(trackReference(ref, file)) }))));
        emitted.set(file, bytes); emitted.set(mapping.get(file), bytes); aliases.set(file, mapping.get(file));
    }
    for (const [file, bytes] of contents) {
        if (!file.endsWith('.html')) continue;
        const source = bytes.toString('utf8'), parts = htmlParts(source, file, available), edits = [];
        for (const ref of parts.attrs) {
            runtimeFiles.add(ref.file);
            if (mapping.has(ref.file)) edits.push({ start: ref.start, end: ref.end, text: `${ref.name}="${trackReference(ref, file).replaceAll('&', '&amp;')}"` });
        }
        for (const inline of parts.inlineScripts) {
            const refs = jsReferences(inline.source, file, available).refs;
            for (const ref of refs) if (mapping.has(ref.file)) edits.push({ start: inline.start + ref.start, end: inline.start + ref.end, text: JSON.stringify(trackReference(ref, file)) });
        }
        let html = applyEdits(source, edits);
        if (!/<html\b/i.test(html)) throw new Error(`Public HTML has no explicit html element: ${file}`);
        html = html.replace(/<html\b([^>]*)>/i, (_, attrs) => `<html${attrs.replace(/\sdata-simas-version(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '')} data-simas-version="${version}">`);
        emitted.set(file, Buffer.from(html));
    }

    // Retain immutable graphs for pages left open across deployments.
    await fs.mkdir(history, { recursive: true });
    const historyIndexPath = path.join(history, 'index.json');
    const historyIndex = await fs.readFile(historyIndexPath, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return { schemaVersion: 1, files: [] }; throw error; });
    if (historyIndex.schemaVersion !== 1 || !Array.isArray(historyIndex.files)) throw new Error('Invalid hosting history index');
    const currentHashes = new Set(mapping.values()), retained = [], expired = [];
    for (const record of historyIndex.files) {
        const disk = path.resolve(history, 'files', record.path);
        if (!HASHED.test(record.path) || privatePath(record.path) || !inside(path.join(history, 'files'), disk) || !/^[a-f0-9]{64}$/.test(record.revision) || !Number.isFinite(Date.parse(record.lastSeenAt)) || (record.requiredUntil !== undefined && (typeof record.requiredUntil !== 'string' || !Number.isFinite(Date.parse(record.requiredUntil))))) throw new Error('Unsafe hosting history entry');
        const resolved = await fs.realpath(disk);
        if (!inside(path.join(history, 'files'), resolved) || privatePath(slash(path.relative(path.join(history, 'files'), resolved)))) throw new Error('Unsafe hosting history symlink');
        if (!currentHashes.has(record.path) && now.getTime() - Date.parse(record.lastSeenAt) > retentionDays * 86400000 && !(Date.parse(record.requiredUntil) > now.getTime())) { expired.push({ record, disk }); continue; }
        const bytes = await fs.readFile(disk);
        if (sha256(bytes) !== record.revision) throw new Error(`Corrupt immutable history: ${record.path}`);
        if (!emitted.has(record.path)) emitted.set(record.path, bytes);
        retained.push(record);
    }
    const historyByPath = new Map(retained.map(record => [record.path, record]));
    for (const file of currentHashes) {
        const bytes = emitted.get(file), revision = sha256(bytes);
        const previous = historyByPath.get(file);
        if (previous && previous.revision !== revision) throw new Error(`Immutable filename collision: ${file}`);
        const disk = path.join(history, 'files', file);
        await fs.mkdir(path.dirname(disk), { recursive: true });
        if (!inside(history, await fs.realpath(path.dirname(disk)))) throw new Error('Unsafe hosting history write directory');
        await fs.writeFile(disk, bytes);
        historyByPath.set(file, { path: file, revision, lastSeenAt: now.toISOString() });
    }

    const installFiles = new Set();
    for (const value of baseline) {
        const reference = localReference(value, 'sw.js', available);
        if (!reference) throw new Error(`Missing legacy offline asset: ${value}`);
        installFiles.add(reference.file);
        if (reference.file.endsWith('.html')) {
            const html = contents.get(reference.file).toString('utf8');
            const parts = htmlParts(html, reference.file, available);
            for (const ref of parts.attrs) if (nodes.has(ref.file)) installFiles.add(ref.file);
            for (const inline of parts.inlineScripts) for (const ref of jsReferences(inline.source, reference.file, available).refs) if (nodes.has(ref.file)) installFiles.add(ref.file);
        }
    }
    const installQueue = [...installFiles];
    while (installQueue.length) {
        const file = installQueue.pop();
        for (const dependency of nodes.get(file)?.dependencies || []) {
            if (!installFiles.has(dependency)) { installFiles.add(dependency); installQueue.push(dependency); }
        }
    }
    const logicalByHash = new Map([...mapping].map(([logical, hashed]) => [hashed, logical]));
    const manifestEntries = new Map();
    function addManifest(file, precache, explicitUrl) {
        if (['sw.js', 'sw-manifest.js', 'hosting-history.json', '.hosting-build.json'].includes(file)) return;
        const bytes = emitted.get(file);
        if (!bytes) throw new Error(`Offline asset is not emitted: ${file}`);
        const url = explicitUrl || `./${file}`, previous = manifestEntries.get(url);
        const entry = { url, revision: sha256(bytes) };
        if (!precache && (!previous || previous.precache === false)) entry.precache = false;
        if (aliases.has(file)) entry.sourceUrl = `./${aliases.get(file)}`;
        else if (explicitUrl?.includes('?')) entry.sourceUrl = `./${file}`;
        if (url === './') entry.sourceUrl = './index.html';
        manifestEntries.set(url, entry);
    }
    for (const value of baseline) {
        const reference = localReference(value, 'sw.js', available);
        if (!reference) throw new Error(`Missing legacy offline asset: ${value}`);
        addManifest(reference.file, true, value);
    }
    for (const file of contents.keys()) {
        if (file.endsWith('.html')) addManifest(file, installFiles.has(file));
    }
    for (const [logical, hashed] of mapping) { addManifest(logical, installFiles.has(logical)); addManifest(hashed, installFiles.has(logical)); }
    for (const file of runtimeFiles) if (emitted.has(file)) addManifest(file, false);
    for (const value of exactReferences) {
        const file = value.split('?')[0];
        addManifest(file, installFiles.has(logicalByHash.get(file) || file), `./${value}`);
    }
    const assets = [...manifestEntries.values()].sort((a, b) => compare(a.url, b.url));
    const manifest = { version, revision: sha256(JSON.stringify({ version, assets })), assets };
    emitted.set('sw-manifest.js', Buffer.from(`self.SIMAS_SW_MANIFEST = ${JSON.stringify(manifest)};\n`));
    // Deployment recovery has its own inventory: browsing never downloads the
    // growing collection of retained graphs during a service-worker update.
    const historyFiles = [...historyByPath.values()].sort((a, b) => compare(a.path, b.path));
    const historyPayload = { schemaVersion: 1, version, manifestRevision: manifest.revision, files: historyFiles };
    const publicHistory = { ...historyPayload, revision: sha256(JSON.stringify(historyPayload)) };
    emitted.set('hosting-history.json', Buffer.from(JSON.stringify(publicHistory) + '\n'));
    const report = { schemaVersion: 1, generatedAt: now.toISOString(), version, sourceFileCount: contents.size, emittedFileCount: emitted.size + 1, hashedFileCount: mapping.size, mapping: Object.fromEntries([...mapping].sort()), manifestRevision: manifest.revision, manifestEntryCount: assets.length, history: { revision: publicHistory.revision, inventoryFileCount: historyFiles.length, retentionDays, retainedFileCount: retained.filter(r => !currentHashes.has(r.path)).length, retainedBytes: retained.filter(r => !currentHashes.has(r.path)).reduce((sum, r) => sum + emitted.get(r.path).length, 0), expiredFileCount: expired.length }, compatibilityAliases: 'Original JS/CSS paths contain the same rewritten bytes as their immutable sibling. Literal dynamic imports and import.meta URL references target the hashed graph; runtime classic vendor loaders may use fresh original aliases.' };
    emitted.set('.hosting-build.json', Buffer.from(JSON.stringify(report, null, 2) + '\n'));
    // Finish all parsing and verification before replacing an earlier owned build.
    const exists = await fs.stat(output).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (exists) {
        if (!exists.isDirectory() || !(await fs.stat(path.join(output, '.hosting-build.json')).catch(() => null))) throw new Error('Refusing to replace an output directory without a build marker');
        if (await fs.realpath(output) !== output) throw new Error('Output must not be a symlink');
    }
    const stage = await fs.mkdtemp(path.join(root, '.dist-hosting-build-'));
    try {
        for (const [file, bytes] of emitted) {
            const disk = path.resolve(stage, file);
            if (!inside(stage, disk)) throw new Error(`Unsafe emitted path: ${file}`);
            await fs.mkdir(path.dirname(disk), { recursive: true }); await fs.writeFile(disk, bytes);
        }
        if (exists) await fs.rm(output, { recursive: true, force: true });
        await fs.rename(stage, output);
        await fs.writeFile(historyIndexPath, JSON.stringify({ schemaVersion: 1, files: historyFiles }, null, 2) + '\n');
        for (const { disk } of expired) await fs.unlink(disk);
    } catch (error) { await fs.rm(stage, { recursive: true, force: true }); throw error; }
    return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
        const key = { '--root': 'root', '--output': 'outputDir', '--history': 'historyDir' }[process.argv[i]];
        if (!key || !process.argv[i + 1]) throw new Error('Usage: node scripts/build-hosting.mjs [--root path] [--output dist-hosting] [--history .hosting-history]');
        options[key] = process.argv[i + 1];
    }
    const { mapping, compatibilityAliases, ...summary } = await buildHosting(options);
    console.log(JSON.stringify(summary, null, 2));
}
