import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { checkHostingBuild } from '../scripts/check-hosting-build.mjs';

const version = '26.10.15.1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
let root, output, manifest, report, history;
const names = {
    main: 'js/main.1111111111111111.js', dep: 'js/dep.2222222222222222.mjs',
    style: 'css/style.3333333333333333.css', theme: 'css/theme.4444444444444444.css'
};

async function write(file, body) {
    const disk = path.join(output, file);
    await fs.mkdir(path.dirname(disk), { recursive: true }); await fs.writeFile(disk, body);
}
async function countFiles(directory) {
    let count = 0;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        count += entry.isDirectory() ? await countFiles(path.join(directory, entry.name)) : 1;
    }
    return count;
}
async function sealHistory() {
    const payload = { schemaVersion: history.schemaVersion, version: history.version, manifestRevision: history.manifestRevision, files: history.files };
    history.revision = hash(JSON.stringify(payload));
    await write('hosting-history.json', JSON.stringify(history));
    report.history = { revision: history.revision, inventoryFileCount: history.files.length };
    if (report.emittedFileCount !== undefined) await write('.hosting-build.json', JSON.stringify(report));
}
async function seal() {
    manifest.revision = hash(JSON.stringify({ version, assets: manifest.assets }));
    report.manifestRevision = manifest.revision; report.manifestEntryCount = manifest.assets.length;
    await write('sw-manifest.js', `self.SIMAS_SW_MANIFEST = ${JSON.stringify(manifest)};\n`);
    const records = [];
    async function findHashes(relative = '') {
        for (const entry of await fs.readdir(path.join(output, relative), { withFileTypes: true })) {
            const file = path.posix.join(relative, entry.name);
            if (entry.isDirectory()) await findHashes(file);
            else if (entry.isFile() && /\.[a-f0-9]{16}\.(?:js|mjs|css)$/.test(file)) {
                records.push({ path: file, revision: hash(await fs.readFile(path.join(output, file))), lastSeenAt: '2026-10-15T00:00:00.000Z' });
            }
        }
    }
    await findHashes();
    history = { schemaVersion: 1, version, manifestRevision: manifest.revision, files: records.sort((a, b) => a.path.localeCompare(b.path)) };
    await sealHistory();
    await write('.hosting-build.json', '{}');
    report.emittedFileCount = await countFiles(output);
    await write('.hosting-build.json', JSON.stringify(report));
}
async function replaceBody(files, body) {
    for (const file of files) await write(file, body);
    for (const entry of manifest.assets) {
        const pathname = new URL(entry.url, 'https://fixture.invalid/').pathname.slice(1) || 'index.html';
        if (files.includes(pathname)) entry.revision = hash(body);
    }
}
async function fixture() {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version }));
    const sw = "const ASSETS_TO_CACHE = ['./', './index.html', './js/main.js', './css/style.css'];";
    await fs.writeFile(path.join(root, 'sw.js'), sw); await write('sw.js', sw);
    const contents = {
        'index.html': `<html data-simas-version="${version}"><head><link href="${names.style}" rel="stylesheet"></head><body><img src="assets/logo.png"><script type="module" src="${names.main}"></script><script type="module">import './${names.dep}?mode=quiz';</script></body></html>`,
        'js/main.js': `import './dep.2222222222222222.mjs?mode=quiz'; export const late = () => import('./dep.2222222222222222.mjs');`,
        'js/dep.mjs': 'export const value = 1;',
        'css/style.css': "@import './theme.4444444444444444.css?skin=dark'; body { background: url('../assets/logo.png'); }",
        'css/theme.css': 'body { color: green; }', 'assets/logo.png': 'public image fixture'
    };
    report = { schemaVersion: 1, version, mapping: {
        'js/main.js': names.main, 'js/dep.mjs': names.dep,
        'css/style.css': names.style, 'css/theme.css': names.theme
    }, hashedFileCount: 4 };
    manifest = { version, assets: [] };
    for (const [file, body] of Object.entries(contents)) {
        await write(file, body);
        const entry = { url: './' + file, revision: hash(body) };
        if (file === 'assets/logo.png') entry.precache = false;
        if (report.mapping[file]) {
            entry.sourceUrl = './' + report.mapping[file];
            await write(report.mapping[file], body);
            manifest.assets.push({ url: entry.sourceUrl, revision: entry.revision });
        }
        manifest.assets.push(entry);
    }
    manifest.assets.push({ url: './', revision: hash(contents['index.html']), sourceUrl: './index.html' });
    manifest.assets.push({ url: './' + names.dep + '?mode=quiz', revision: hash(contents['js/dep.mjs']), sourceUrl: './' + names.dep });
    manifest.assets.push({ url: './' + names.theme + '?skin=dark', revision: hash(contents['css/theme.css']), sourceUrl: './' + names.theme });
    await seal();
}

describe('Independent generated Hosting deployment integrity gate', () => {
    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'simas-hosting-integrity-'));
        output = path.join(root, 'dist-hosting'); await fs.mkdir(output);
        await fixture();
    });
    afterEach(async () => { await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });

    test('verifies byte-identical aliases, exact queries, inline modules, CSS imports and legacy offline coverage', async () => {
        const result = await checkHostingBuild({ root });
        expect(result).toMatchObject({ ok: true, version, legacyPrecacheCovered: 4, hashedFiles: 4 });
        expect(result).toMatchObject({ historyFiles: 4, historicalFiles: 0, historyRevision: history.revision });
        expect(result.checkedReferences).toBeGreaterThan(8);
        expect(result.manifestRevision).toBe(manifest.revision);
        expect(result).not.toHaveProperty('mapping');
    });

    test('rejects output without its generated build marker', async () => {
        await fs.unlink(path.join(output, '.hosting-build.json'));
        await expect(checkHostingBuild({ root })).rejects.toThrow(/build marker/);
    });

    test('parses manifest as JSON only and never evaluates appended JavaScript', async () => {
        await fs.appendFile(path.join(output, 'sw-manifest.js'), 'globalThis.__HOSTING_VALIDATOR_EXECUTED__ = true;');
        await expect(checkHostingBuild({ root })).rejects.toThrow(/JSON assignment/);
        expect(globalThis.__HOSTING_VALIDATOR_EXECUTED__).toBeUndefined();
    });

    test('rejects a manifest whose top digest no longer describes its entries', async () => {
        manifest.assets[0].precache = false;
        await write('sw-manifest.js', `self.SIMAS_SW_MANIFEST = ${JSON.stringify(manifest)};`);
        await expect(checkHostingBuild({ root })).rejects.toThrow(/manifest revision/);
    });

    test('checks retained immutable files through deploy-only inventory without growing the browser manifest', async () => {
        const previous = 'js/previous.5555555555555555.js';
        const entryCount = manifest.assets.length;
        await write(previous, 'export const previous = true;'); await seal();
        const result = await checkHostingBuild({ root });
        expect(result).toMatchObject({ historyFiles: 5, historicalFiles: 1, assets: entryCount });
    });

    test('rejects missing deploy-only history metadata', async () => {
        await fs.unlink(path.join(output, 'hosting-history.json'));
        report.emittedFileCount--; await write('.hosting-build.json', JSON.stringify(report));
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Missing or invalid hosting-history/);
    });

    test('rejects a history inventory whose digest has been tampered with', async () => {
        history.files[0].lastSeenAt = '2026-10-14T00:00:00.000Z';
        await write('hosting-history.json', JSON.stringify(history));
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Hosting history revision/);
    });

    test('rejects history metadata bound to a different release manifest', async () => {
        history.manifestRevision = '0'.repeat(64); await sealHistory();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/release binding/);
    });

    test('rejects a build marker that no longer describes its deploy-only history', async () => {
        report.history.inventoryFileCount++; await write('.hosting-build.json', JSON.stringify(report));
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Build marker does not match hosting history/);
    });

    test('rejects missing or changed historical bytes even if current offline graph remains intact', async () => {
        const old = 'js/previous.5555555555555555.js';
        await write(old, 'export const previous = true;'); await seal();
        await write(old, 'export const changed = true;');
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Hosting history body revision mismatch/);
        await fs.unlink(path.join(output, old));
        report.emittedFileCount--; await write('.hosting-build.json', JSON.stringify(report));
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Missing manifest file.*previous/);
    });

    test('rejects immutable output omitted from the deploy-only inventory', async () => {
        history.files.pop(); await sealHistory();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/missing from hosting history/);
    });

    test('rejects duplicate inventory paths', async () => {
        history.files.push({ ...history.files[0] }); await sealHistory();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Duplicate or noncanonical hosting history path/);
    });

    test.each([
        { path: '../js/previous.5555555555555555.js' }, { path: 'api/previous.5555555555555555.js' },
        { path: 'js/previous.5555555555555555.js?token=fixture' }, { lastSeenAt: 'invalid' }, { requiredUntil: Infinity }
    ])('rejects unsafe history paths or invalid timestamps: %j', async change => {
        Object.assign(history.files[0], change); await sealHistory();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Unsafe hosting history|Private or development file/);
    });

    test('rejects a historical hash appended to the hot-path browser manifest', async () => {
        const old = 'js/previous.5555555555555555.js', body = 'export const previous = true;';
        await write(old, body);
        manifest.assets.push({ url: './' + old, revision: hash(body), precache: false }); await seal();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Historical immutable file must not enter/);
    });

    test('detects an actual emitted body changed after manifest generation', async () => {
        await fs.appendFile(path.join(output, names.dep), '\nexport const unexpected = true;');
        await expect(checkHostingBuild({ root })).rejects.toThrow(/body revision mismatch/);
    });

    test('rejects a stale or changed worker even though sw.js is excluded from its own asset manifest', async () => {
        await fs.appendFile(path.join(output, 'sw.js'), '\n// stale build worker');
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Built sw\.js differs/);
    });

    test('rejects sourceUrl pointing to a different valid file even when the alias digest is correct', async () => {
        manifest.assets.find(entry => entry.url === './js/main.js').sourceUrl = './' + names.dep;
        await seal();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/sourceUrl body differs/);
    });

    test('finds a missing literal module dependency after all body/manifest digests have been updated', async () => {
        await replaceBody(['js/main.js', names.main], "import './missing.mjs';"); await seal();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Missing deployment dependency.*missing\.mjs/);
    });

    test('does not mistake a Node-only bare package fallback for a local deployment file', async () => {
        await replaceBody(['js/main.js', names.main], `import './dep.2222222222222222.mjs'; export async function nodeFallback() { if (typeof window === 'undefined') return import('docx'); }`);
        await seal();
        await expect(checkHostingBuild({ root })).resolves.toMatchObject({ ok: true });
    });

    test('finds missing inline module imports independently of external script tags', async () => {
        await replaceBody(['index.html'], '<html><script type="module">import "./missing-inline.mjs";</script></html>'); await seal();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Missing deployment dependency.*missing-inline/);
    });

    test('allows runtime school-identity outbound anchors without waiving placeholder script sources', async () => {
        await replaceBody(['index.html'], '<html><a href="{{schoolWebsite}}">School</a></html>'); await seal();
        await expect(checkHostingBuild({ root })).resolves.toMatchObject({ ok: true });
        await replaceBody(['index.html'], '<html><script src="{{scriptFile}}"></script></html>'); await seal();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Missing deployment dependency/);
    });

    test('reports preexisting missing navigation as a warning without removing or changing UI', async () => {
        await replaceBody(['index.html'], '<html><a href="missing-before-build.html">Existing link</a></html>'); await seal();
        const result = await checkHostingBuild({ root });
        expect(result.ok).toBe(true);
        expect(result.warnings).toEqual([{ type: 'preexisting-missing-navigation', file: 'index.html', target: 'missing-before-build.html' }]);
    });

    test('fails navigation that exists in source but was lost from the generated artifact', async () => {
        await fs.writeFile(path.join(root, 'lost-page.html'), '<html>Existing feature</html>');
        await replaceBody(['index.html'], '<html><a href="lost-page.html">Existing feature</a></html>'); await seal();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Missing deployment dependency.*lost-page/);
    });

    test('allows only the Firebase worker bootstrap importScripts of source-verified sw.js outside its self-manifest', async () => {
        const body = 'importScripts("./sw.js");';
        await write('firebase-messaging-sw.js', body);
        manifest.assets.push({ url: './firebase-messaging-sw.js', revision: hash(body) }); await seal();
        await expect(checkHostingBuild({ root })).resolves.toMatchObject({ ok: true });
        await replaceBody(['firebase-messaging-sw.js'], 'import "./sw.js";'); await seal();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Offline dependency\/query/);
    });

    test('does not waive an unrelated application module that imports the root worker', async () => {
        await replaceBody(['js/main.js', names.main], 'importScripts("../sw.js");'); await seal();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Offline dependency\/query/);
    });

    test('requires the exact meaningful query key needed by the offline module graph', async () => {
        manifest.assets = manifest.assets.filter(entry => !entry.url.endsWith('?mode=quiz')); await seal();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Offline dependency\/query.*mode=quiz/);
    });

    test('rejects moving a required transitive dependency into runtime-only caching', async () => {
        for (const entry of manifest.assets) if (entry.url.includes('/dep.')) entry.precache = false;
        await seal();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Offline dependency\/query/);
    });

    test('rejects removing an original logical offline URL even if its hash is still cached', async () => {
        manifest.assets.find(entry => entry.url === './js/main.js').precache = false; await seal();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Original offline asset/);
    });

    test('protects import.meta.url depth by rejecting a mapping into a different directory', async () => {
        report.mapping['js/main.js'] = 'nested/main.1111111111111111.js'; await seal();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/path depth or identity/);
    });

    test.each(['tests/fixture.js', '.env', '.claude/settings.local.json', 'PRD_SIMAS.docx', 'api/private.json'])(
        'rejects private/development files in the public inventory: %s', async file => {
            await write(file, 'never public');
            await expect(checkHostingBuild({ root })).rejects.toThrow(/Private or development file/);
        }
    );

    test('rejects credential query keys even on an otherwise public existing file', async () => {
        manifest.assets.push({ url: './index.html?student_token=fixture', revision: manifest.assets.find(entry => entry.url === './index.html').revision });
        await seal();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Credential or session query/);
    });

    test('rejects ambiguous parent traversal in a manifest URL', async () => {
        manifest.assets.push({ url: './../index.html', revision: manifest.assets.find(entry => entry.url === './index.html').revision });
        await seal();
        await expect(checkHostingBuild({ root })).rejects.toThrow(/Unsafe asset path/);
    });

    test('rejects symlink/junction escape outside the generated output', async () => {
        const outside = path.join(root, 'outside-output'); await fs.mkdir(outside);
        await fs.writeFile(path.join(outside, 'safe.txt'), 'outside the public boundary');
        try { await fs.symlink(outside, path.join(output, 'linked'), 'junction'); }
        catch (error) { if (['EPERM', 'ENOTSUP', 'EACCES'].includes(error.code)) return; throw error; }
        await expect(checkHostingBuild({ root })).rejects.toThrow(/symlink leaves the output/);
    });
});
