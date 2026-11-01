import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { buildHosting } from '../scripts/build-hosting.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
// These integration tests create and verify several complete releases on disk.
jest.setTimeout(60000);
let root;
async function write(file, contents) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), contents);
}
async function fixture(version = '26.10.15.1') {
    await write('package.json', JSON.stringify({ version }));
    await write('firebase.json', JSON.stringify({ hosting: [{ target: 'smagesa', public: 'dist-hosting', ignore: ['firebase.json', 'package.json', '**/.*', 'tests/**', 'scripts/**', '*.md'] }] }));
    await write('index.html', `<html lang="id"><head><link rel="stylesheet" href="css/style.css?v=${version}"></head><body><img src="assets/logo.png"><img src="assets/runtime.png"><script type="module" src="js/main.js?v=${version}"></script><script type="module">import './js/late.mjs?v=${version}&mode=quiz';</script></body></html>`);
    await write('js/config.js', `export const APP_VERSION = "${version}"; export const tenant = 'smagesa';`);
    await write('js/main.js', `import { APP_VERSION } from './config.js?v=${version}'; import './cycle-a.js'; export const late = () => import('./late.mjs'); export const root = new URL('../', import.meta.url).href; export const version = APP_VERSION;`);
    await write('js/cycle-a.js', `import { b } from './cycle-b.js'; export function a() { return b; }`);
    await write('js/cycle-b.js', `import { a } from './cycle-a.js'; import { value } from './late.mjs'; export const b = () => [a, value];`);
    await write('js/late.mjs', 'export const value = 1;');
    await write('js/unrelated.js', 'export const untouched = 7;');
    await write('js/vendor/classic.js', 'globalThis.classicVendor = true;');
    await write('css/style.css', `@import './theme.css?v=${version}'; body { background: url('../assets/runtime.png'); }`);
    await write('css/theme.css', 'body { color: rgb(10, 20, 30); }');
    await write('assets/logo.png', 'test-image-logo');
    await write('assets/runtime.png', 'test-image-runtime');
    await write('sw.js', `const ASSETS_TO_CACHE = ['./', './index.html', './js/main.js', './css/style.css', './assets/logo.png'];`);
    await write('.env', 'NEVER_PUBLIC=true');
    await write('.claude/settings.local.json', '{"dummyPrivateSettings":true}');
    await write('.firebase/foo.cache', 'dummy-cache');
    await write('.codex/auth.json', '{"dummyOnly":true}');
    await write('.well-known/assetlinks.json', '[{"fixture":"public-android-links"}]');
    await write('.well-known/.private/token.json', '{"dummyOnly":true}');
    await write('tests/private.txt', 'excluded test fixture');
    await write('notes.md', 'excluded documentation');
}
async function manifest() {
    const context = { self: {} };
    vm.runInNewContext(await fs.readFile(path.join(root, 'dist-hosting/sw-manifest.js'), 'utf8'), context);
    return JSON.parse(JSON.stringify(context.self.SIMAS_SW_MANIFEST));
}

describe('Firebase Hosting content-addressed packaging', () => {
    beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'simas-hosting-build-')); });
    afterEach(async () => { await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });

    test('keeps immutable graph stable for a version-only release and preserves APP_VERSION in every document', async () => {
        await fixture();
        const originalConfig = await fs.readFile(path.join(root, 'js/config.js'), 'utf8');
        const first = await buildHosting({ root });
        expect(await fs.readFile(path.join(root, 'js/config.js'), 'utf8')).toBe(originalConfig);
        await fixture('26.10.16.1');
        const second = await buildHosting({ root });
        expect(second.mapping).toEqual(first.mapping);
        const html = await fs.readFile(path.join(root, 'dist-hosting/index.html'), 'utf8');
        expect(html).toContain('data-simas-version="26.10.16.1"');
        const config = await fs.readFile(path.join(root, 'dist-hosting', second.mapping['js/config.js']), 'utf8');
        expect(config).toContain('document?.documentElement?.dataset?.simasVersion');
        expect(config).not.toContain('26.10.16.1');
        const element = (attribute, value) => ({ getAttribute: name => name === attribute ? value : null });
        const legacyElements = [element('href', '/css/style.css?v=compact'), element('src', 'https://cdn.example.test/lib.js?v=26.01.01.1'), element('src', './js/main.js?v=26.10.15.1')];
        async function configVersion(document) {
            const module = new vm.SourceTextModule(config, { context: vm.createContext({ URL, ...(document ? { document } : {}) }), initializeImportMeta(meta) { meta.url = 'https://example.test/js/config.hash.js'; } });
            await module.link(() => {}); await module.evaluate(); return module.namespace.APP_VERSION;
        }
        const legacyDocument = { baseURI: 'https://example.test/index.html', documentElement: { dataset: {} }, querySelectorAll: () => legacyElements };
        expect(await configVersion(legacyDocument)).toBe('26.10.15.1');
        expect(await configVersion({ ...legacyDocument, documentElement: { dataset: { simasVersion: '26.10.16.1' } } })).toBe('26.10.16.1');
        expect(await configVersion({ ...legacyDocument, querySelectorAll: () => legacyElements.slice(0, 2) })).toBe('dev');
        expect(await configVersion()).toBe('dev');
        expect(second.manifestRevision).not.toBe(first.manifestRevision);
    });

    test('updates SCC and dependent filenames when a leaf changes, while retaining old late imports for 30 days', async () => {
        await fixture();
        const first = await buildHosting({ root, now: new Date('2026-10-01T00:00:00Z') });
        const firstManifestCount = (await manifest()).assets.length;
        await write('js/late.mjs', 'export const value = 2;');
        const second = await buildHosting({ root, now: new Date('2026-10-02T00:00:00Z') });
        for (const file of ['js/late.mjs', 'js/cycle-a.js', 'js/cycle-b.js', 'js/main.js']) expect(second.mapping[file]).not.toBe(first.mapping[file]);
        expect(second.mapping['js/unrelated.js']).toBe(first.mapping['js/unrelated.js']);
        expect(await fs.readFile(path.join(root, 'dist-hosting', first.mapping['js/late.mjs']), 'utf8')).toContain('value = 1');
        expect(second.history.retainedFileCount).toBeGreaterThan(0);
        const currentManifest = await manifest();
        expect(currentManifest.assets).toHaveLength(firstManifestCount);
        expect(currentManifest.assets.find(entry => entry.url === `./${first.mapping['js/late.mjs']}`)).toBeUndefined();
        const publicHistory = JSON.parse(await fs.readFile(path.join(root, 'dist-hosting/hosting-history.json'), 'utf8'));
        const { revision, ...payload } = publicHistory;
        expect(revision).toBe(hash(JSON.stringify(payload)));
        expect(publicHistory.manifestRevision).toBe(currentManifest.revision);
        expect(publicHistory.files.find(entry => entry.path === first.mapping['js/late.mjs']).lastSeenAt).toBe('2026-10-01T00:00:00.000Z');
        expect(publicHistory.files).toHaveLength(second.hashedFileCount + second.history.retainedFileCount);
        await buildHosting({ root, now: new Date('2026-11-03T00:00:00Z') });
        await expect(fs.stat(path.join(root, 'dist-hosting', first.mapping['js/late.mjs']))).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await fs.readFile(path.join(root, 'dist-hosting', second.mapping['js/late.mjs']), 'utf8')).toContain('value = 2');
    });

    test('emits exact manifest revisions/aliases, preserves depth and meaningful queries, and does not prefetch new images', async () => {
        await fixture();
        const report = await buildHosting({ root });
        const built = path.join(root, 'dist-hosting');
        const data = await manifest();
        expect(data.revision).toMatch(/^[a-f0-9]{64}$/);
        expect(data.assets.some(entry => entry.url === './sw-manifest.js')).toBe(false);
        expect(data.assets.some(entry => entry.url === './hosting-history.json')).toBe(false);
        expect(data.assets.find(entry => entry.url === './assets/logo.png').precache).toBeUndefined();
        expect(data.assets.find(entry => entry.url === './assets/runtime.png').precache).toBe(false);
        expect(data.assets.find(entry => entry.url === './js/unrelated.js').precache).toBe(false);
        expect(data.assets.find(entry => entry.url === `./${report.mapping['js/unrelated.js']}`).precache).toBe(false);
        expect(data.assets.find(entry => entry.url === `./${report.mapping['js/cycle-b.js']}`).precache).toBeUndefined();
        for (const entry of data.assets) {
            const pathname = new URL(entry.url, 'https://example.test/').pathname.slice(1) || 'index.html';
            expect(entry.revision).toBe(hash(await fs.readFile(path.join(built, pathname))));
            if (entry.sourceUrl) {
                const source = new URL(entry.sourceUrl, 'https://example.test/').pathname.slice(1);
                expect(hash(await fs.readFile(path.join(built, source)))).toBe(entry.revision);
            }
        }
        for (const [logical, hashed] of Object.entries(report.mapping)) {
            expect(path.posix.dirname(hashed)).toBe(path.posix.dirname(logical));
            expect(hashed).toMatch(/\.[a-f0-9]{16}\.(?:js|mjs|css)$/);
            expect(await fs.readFile(path.join(built, hashed))).toEqual(await fs.readFile(path.join(built, logical)));
        }
        expect(new URL('../', `https://example.test/${report.mapping['js/main.js']}`).href).toBe('https://example.test/');
        const html = await fs.readFile(path.join(built, 'index.html'), 'utf8');
        expect(html).not.toContain('?v=26.');
        expect(html).toContain(`${report.mapping['js/late.mjs']}?mode=quiz`);
        expect(data.assets.some(entry => entry.url === `./${report.mapping['js/late.mjs']}?mode=quiz`)).toBe(true);
        // Execute the emitted graph, including its cycle, against a browser-like
        // document. This checks actual version binding and import.meta behavior.
        const context = vm.createContext({ URL, document: { documentElement: { dataset: { simasVersion: '26.10.15.1' } } } });
        const modules = new Map();
        async function emittedModule(url) {
            if (modules.has(url)) return modules.get(url);
            const module = new vm.SourceTextModule(await fs.readFile(new URL(url), 'utf8'), { context, identifier: url, initializeImportMeta(meta) { meta.url = url; } });
            modules.set(url, module);
            return module;
        }
        const entry = await emittedModule(pathToFileURL(path.join(built, report.mapping['js/main.js'])).href);
        await entry.link((specifier, from) => emittedModule(new URL(specifier, from.identifier).href));
        await entry.evaluate();
        expect(entry.namespace.version).toBe('26.10.15.1');
        expect(entry.namespace.root).toBe(pathToFileURL(built + path.sep).href);
        await expect(fs.stat(path.join(built, '.env'))).rejects.toMatchObject({ code: 'ENOENT' });
        for (const hidden of ['.claude/settings.local.json', '.firebase/foo.cache', '.codex/auth.json', '.well-known/.private/token.json']) {
            await expect(fs.stat(path.join(built, hidden))).rejects.toMatchObject({ code: 'ENOENT' });
            expect(data.assets.some(entry => entry.url.includes(hidden))).toBe(false);
        }
        expect(await fs.readFile(path.join(built, '.well-known/assetlinks.json'), 'utf8')).toContain('public-android-links');
        await expect(fs.stat(path.join(built, 'tests/private.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.stat(path.join(built, 'notes.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    test('rejects unknown dynamic module paths and refuses to delete directories it does not own', async () => {
        await fixture();
        await write('dist-hosting/preserve.txt', 'user-owned output');
        await expect(buildHosting({ root })).rejects.toThrow('without a build marker');
        expect(await fs.readFile(path.join(root, 'dist-hosting/preserve.txt'), 'utf8')).toBe('user-owned output');
        await fs.rm(path.join(root, 'dist-hosting'), { recursive: true });
        await buildHosting({ root });
        await write('js/main.js', 'export const load = name => import(name);');
        await expect(buildHosting({ root })).rejects.toThrow('Computed import');
        expect(await fs.readFile(path.join(root, 'dist-hosting/index.html'), 'utf8')).toContain('data-simas-version');
        await write('js/main.js', "import './missing.js';");
        await expect(buildHosting({ root })).rejects.toThrow('Missing deployment dependency');
        await expect(buildHosting({ root, outputDir: 'js' })).rejects.toThrow('Unsafe output/history path');
        await expect(buildHosting({ root, retentionDays: 1 })).rejects.toThrow('at least 30 days');
    });

    test('rejects public aliases into private source directories and history links outside its owned files', async () => {
        await fixture();
        const linkType = process.platform === 'win32' ? 'junction' : 'dir';
        await fs.symlink(path.join(root, '.claude'), path.join(root, 'public-link'), linkType);
        await expect(buildHosting({ root })).rejects.toThrow('private source path');
        await fs.unlink(path.join(root, 'public-link'));
        await buildHosting({ root });
        const historyJs = path.join(root, '.hosting-history/files/js');
        const escaped = path.join(root, '.history-outside-owned-files');
        await fs.cp(historyJs, escaped, { recursive: true });
        await fs.rm(historyJs, { recursive: true });
        await fs.symlink(escaped, historyJs, linkType);
        await expect(buildHosting({ root })).rejects.toThrow('Unsafe hosting history symlink');
    });

    test('keeps a required remote current graph beyond the old build timestamp, then expires its finite pin', async () => {
        await fixture();
        const old = await buildHosting({ root, now: new Date('2026-09-01T00:00:00Z') });
        const indexPath = path.join(root, '.hosting-history/index.json');
        const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
        index.files.find(record => record.path === old.mapping['js/late.mjs']).requiredUntil = '2026-11-14T00:00:00Z';
        await fs.writeFile(indexPath, JSON.stringify(index));
        await write('js/late.mjs', 'export const value = 2;');
        await buildHosting({ root, now: new Date('2026-10-15T00:00:00Z') });
        expect(await fs.readFile(path.join(root, 'dist-hosting', old.mapping['js/late.mjs']), 'utf8')).toContain('value = 1');
        await buildHosting({ root, now: new Date('2026-11-15T00:00:00Z') });
        await expect(fs.stat(path.join(root, 'dist-hosting', old.mapping['js/late.mjs']))).rejects.toMatchObject({ code: 'ENOENT' });
        const current = JSON.parse(await fs.readFile(indexPath, 'utf8'));
        current.files[0].requiredUntil = 'invalid date';
        await fs.writeFile(indexPath, JSON.stringify(current));
        await expect(buildHosting({ root })).rejects.toThrow('Unsafe hosting history entry');
    });
});
