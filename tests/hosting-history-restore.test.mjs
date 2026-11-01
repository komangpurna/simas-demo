import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { restoreHostingHistory } from '../scripts/restore-hosting-history.mjs';

jest.setTimeout(60000);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const NOW = new Date('2026-10-15T00:00:00Z');
let root;
const currentFiles = {
    'js/main.1111111111111111.js': 'export const main = 1;',
    'js/late.2222222222222222.mjs': 'export const late = 2;',
    'css/style.3333333333333333.css': 'body { color: black; }',
    'js/vendor/classic.4444444444444444.js': 'globalThis.vendor = true;'
};
const historicalPath = 'js/old.aaaaaaaaaaaaaaaa.js';
const bodies = { ...currentFiles, [historicalPath]: 'export const old = true;' };
function release(version = '26.10.15.10', assets) {
    assets ||= Object.entries(currentFiles).flatMap(([file, body]) => {
        const revision = hash(body);
        return [
            { url: './' + file.replace(/\.[a-f0-9]{16}(?=\.)/, ''), revision, sourceUrl: './' + file },
            { url: './' + file, revision }
        ];
    });
    return { version, revision: hash(JSON.stringify({ version, assets })), assets };
}
function history(manifest = release(), files) {
    files ||= Object.entries(bodies).map(([file, body]) => ({ path: file, revision: hash(body), lastSeenAt: file === historicalPath ? '2026-10-02T00:00:00.000Z' : '2026-09-01T00:00:00.000Z' }));
    const payload = { schemaVersion: 1, version: manifest.version, manifestRevision: manifest.revision, files };
    return { ...payload, revision: hash(JSON.stringify(payload)) };
}
function mockNetwork({ manifest = release(), finalManifest, historyDocument, finalHistory, bodyOverrides = {}, legacy, rawManifest } = {}) {
    if (historyDocument === undefined) historyDocument = manifest ? history(manifest) : null;
    const manifestEtag = `"${manifest?.revision}"`, historyEtag = `"${historyDocument?.revision}"`;
    const calls = []; let manifests = 0, histories = 0, active = 0, maxActive = 0;
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        const pathname = new URL(url).pathname;
        if (pathname === '/sw-manifest.js') {
            manifests++;
            if (!manifest) return new Response(null, { status: 404 });
            if (finalManifest && manifests > 1) return new Response(`self.SIMAS_SW_MANIFEST = ${JSON.stringify(finalManifest)};`, { headers: { etag: '"other"' } });
            if (options.headers['If-None-Match'] === manifestEtag) return new Response(null, { status: 304, headers: { etag: manifestEtag } });
            return new Response(rawManifest || `self.SIMAS_SW_MANIFEST = ${JSON.stringify(manifest)};`, { headers: { etag: manifestEtag } });
        }
        if (pathname === '/hosting-history.json') {
            histories++;
            if (!historyDocument) return new Response(null, { status: 404 });
            if (finalHistory && histories > 1) return new Response(JSON.stringify(finalHistory), { headers: { etag: '"history-other"' } });
            if (options.headers['If-None-Match'] === historyEtag) return new Response(null, { status: 304, headers: { etag: historyEtag } });
            return new Response(JSON.stringify(historyDocument), { headers: { etag: historyEtag } });
        }
        if (pathname === '/sw.js') return new Response(legacy || '', { status: legacy ? 200 : 404 });
        const file = pathname.slice(1);
        if (!Object.hasOwn(bodies, file)) throw new Error('Unexpected public request: ' + url);
        active++; maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
        return new Response(bodyOverrides[file] ?? bodies[file]);
    };
    return { fetchImpl, calls, get maxActive() { return maxActive; } };
}
const readIndex = async () => JSON.parse(await fs.readFile(path.join(root, '.hosting-history/index.json'), 'utf8'));
const absentIndex = async () => expect(fs.stat(path.join(root, '.hosting-history/index.json'))).rejects.toMatchObject({ code: 'ENOENT' });

describe('Deploy-only restoration of public Hosting hash history', () => {
    beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'simas-history-restore-')); });
    afterEach(async () => { await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });

    test('permits a configured new school site while preserving the public hash graph', async () => {
        await fs.mkdir(path.join(root, 'scripts'));
        await fs.writeFile(path.join(root, 'scripts/hosting-sites.json'), JSON.stringify({ 'contoh-simas': 'https://contoh-simas.web.app' }));
        const network = mockNetwork();
        const result = await restoreHostingHistory({ root, site: 'contoh-simas', fetchImpl: network.fetchImpl, now: NOW });
        expect(result.mode).toBe('hydrated');
        expect(network.calls.every(call => new URL(call.url).origin === 'https://contoh-simas.web.app')).toBe(true);
        await expect(restoreHostingHistory({ root, site: 'smagesa', fetchImpl: network.fetchImpl })).rejects.toThrow('explicitly configured');
    });

    test('empty-site bootstrap requires explicit first deployment and repeated missing manifests', async () => {
        const fetchImpl = async () => new Response(null, { status: 404 });
        await expect(restoreHostingHistory({ root, site: 'smagesa', fetchImpl })).rejects.toThrow('Cannot verify legacy');
        const result = await restoreHostingHistory({ root, site: 'smagesa', fetchImpl, firstDeployment: true });
        expect(result.mode).toBe('first-deployment');
        expect(result.requestCount).toBe(3);
        await absentIndex();
    });

    test('permits only a proved legacy first migration, with a second manifest check', async () => {
        const network = mockNetwork({ manifest: null, legacy: "const ASSETS_TO_CACHE = ['./', './index.html', './js/global.js'];" });
        const result = await restoreHostingHistory({ root, site: 'smagesa', fetchImpl: network.fetchImpl, now: NOW });
        expect(result.mode).toBe('legacy-bootstrap');
        expect(result.requestCount).toBe(3);
        await absentIndex();
    });

    test.each([
        "const OTHER = [];",
        "importScripts('./sw-manifest.js'); const ASSETS_TO_CACHE = ['./index.html'];",
        "const ASSETS_TO_CACHE = ['./js/main.1111111111111111.js'];"
    ])('does not treat an arbitrary missing manifest as legacy: %s', async legacy => {
        const network = mockNetwork({ manifest: null, legacy });
        await expect(restoreHostingHistory({ root, site: 'smagesa', fetchImpl: network.fetchImpl })).rejects.toThrow();
        await absentIndex();
    });

    test('recovers both current and historical graph after a cache miss using only public fixed-site GETs', async () => {
        const network = mockNetwork();
        const result = await restoreHostingHistory({ root, site: 'sman1abang', fetchImpl: network.fetchImpl, now: NOW });
        expect(result.downloadedFileCount).toBe(5);
        expect(result.pinnedCurrentFileCount).toBe(4);
        expect(network.maxActive).toBeLessThanOrEqual(3);
        expect(network.maxActive).toBeGreaterThan(1);
        for (const call of network.calls) {
            expect(new URL(call.url).origin).toBe('https://sman1abang.web.app');
            expect(call.options).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error' });
            expect(Object.keys(call.options.headers).some(key => /authorization|cookie/i.test(key))).toBe(false);
        }
        const index = await readIndex();
        for (const entry of index.files) {
            expect(hash(await fs.readFile(path.join(root, '.hosting-history/files', entry.path)))).toBe(entry.revision);
            expect(entry.lastSeenAt).toBe(entry.path === historicalPath ? '2026-10-02T00:00:00.000Z' : '2026-09-01T00:00:00.000Z');
            if (entry.path === historicalPath) expect(entry.requiredUntil).toBeUndefined();
            else expect(entry.requiredUntil).toBe('2026-11-14T00:00:00.000Z');
        }
    });

    test('reuses verified local bodies without downloads and preserves ages while pinning a 40-day-old current graph', async () => {
        await restoreHostingHistory({ root, site: 'smagesa', fetchImpl: mockNetwork().fetchImpl, now: NOW });
        const index = await readIndex();
        for (const entry of index.files) { entry.lastSeenAt = '2026-08-01T00:00:00.000Z'; delete entry.requiredUntil; }
        await fs.writeFile(path.join(root, '.hosting-history/index.json'), JSON.stringify(index));
        const network = mockNetwork();
        const result = await restoreHostingHistory({ root, site: 'smagesa', fetchImpl: network.fetchImpl, now: NOW });
        expect(result.downloadedFileCount).toBe(0);
        expect(result.downloadedBytes).toBe(0);
        expect(result.reusedFileCount).toBe(5);
        expect(network.calls).toHaveLength(4);
        for (const entry of (await readIndex()).files) {
            expect(entry.lastSeenAt).toBe('2026-08-01T00:00:00.000Z');
            if (entry.path === historicalPath) expect(entry.requiredUntil).toBeUndefined();
            else expect(entry.requiredUntil).toBe('2026-11-14T00:00:00.000Z');
        }
        const cachedPath = path.join(root, '.hosting-history/remotes/smagesa.json');
        const cached = JSON.parse(await fs.readFile(cachedPath, 'utf8'));
        cached.etag = null;
        await fs.writeFile(cachedPath, JSON.stringify(cached));
        await expect(restoreHostingHistory({ root, site: 'smagesa', fetchImpl: async () => new Response(null, { status: 304 }) })).rejects.toThrow('Unverified initial conditional');
    });

    test('restores only unexpired historical files and carries their published ages and finite pins without refreshing them', async () => {
        const expiredFiles = history().files.map(entry => ({ ...entry, lastSeenAt: '2026-09-01T00:00:00.000Z' }));
        const expired = mockNetwork({ historyDocument: history(release(), expiredFiles) });
        const result = await restoreHostingHistory({ root, site: 'smagesa', fetchImpl: expired.fetchImpl, now: NOW });
        expect(result.downloadedFileCount).toBe(4);
        expect(result.skippedExpiredFileCount).toBe(1);
        expect((await readIndex()).files.some(entry => entry.path === historicalPath)).toBe(false);
        expect(expired.calls.some(call => call.url.endsWith('/' + historicalPath))).toBe(false);
        const pinnedFiles = expiredFiles.map(entry => entry.path === historicalPath ? { ...entry, requiredUntil: '2026-11-01T00:00:00.000Z' } : entry);
        const pinned = mockNetwork({ historyDocument: history(release(), pinnedFiles) });
        await restoreHostingHistory({ root, site: 'smagesa', fetchImpl: pinned.fetchImpl, now: NOW });
        expect((await readIndex()).files.find(entry => entry.path === historicalPath)).toMatchObject({ lastSeenAt: '2026-09-01T00:00:00.000Z', requiredUntil: '2026-11-01T00:00:00.000Z' });
    });

    test('fails closed on missing, tampered, unbound or drifting deploy-only history before writing any recovered body', async () => {
        const badDigest = history(); badDigest.files[0].lastSeenAt = '2026-10-15T00:00:00.000Z';
        const wrongBinding = history(release('26.10.15.11'));
        const changed = history(release(), history().files.map(entry => ({ ...entry, lastSeenAt: '2026-10-14T00:00:00.000Z' })));
        for (const options of [{ historyDocument: null }, { historyDocument: badDigest }, { historyDocument: wrongBinding }, { finalHistory: changed }]) {
            const network = mockNetwork(options);
            await expect(restoreHostingHistory({ root, site: 'smagesa', fetchImpl: network.fetchImpl, now: NOW })).rejects.toThrow(/history/i);
            await absentIndex();
            await expect(fs.stat(path.join(root, '.hosting-history/files'))).rejects.toMatchObject({ code: 'ENOENT' });
        }
        for (const files of [
            [...history().files, { path: '.claude/private.aaaaaaaaaaaaaaaa.js', revision: hash('dummy'), lastSeenAt: NOW.toISOString() }],
            [...history().files, { ...history().files[0] }],
            history().files.map(entry => ({ ...entry, requiredUntil: 'invalid date' })),
            history().files.filter(entry => entry.path !== Object.keys(currentFiles)[0])
        ]) {
            const network = mockNetwork({ historyDocument: history(release(), files) });
            await expect(restoreHostingHistory({ root, site: 'smagesa', fetchImpl: network.fetchImpl, now: NOW })).rejects.toThrow(/history|graph/i);
            expect(network.calls).toHaveLength(2);
            await absentIndex();
        }
    });

    test('rejects corrupt bodies, manifest tampering, network failure and release drift before publishing the index', async () => {
        const corrupt = mockNetwork({ bodyOverrides: { [historicalPath]: 'tampered bytes' } });
        await expect(restoreHostingHistory({ root, site: 'smagesa', fetchImpl: corrupt.fetchImpl, now: NOW })).rejects.toThrow('Cannot verify');
        await absentIndex();
        const bad = release(); bad.revision = '0'.repeat(64);
        await expect(restoreHostingHistory({ root, site: 'smagesa', fetchImpl: mockNetwork({ manifest: bad }).fetchImpl, now: NOW })).rejects.toThrow('digest mismatch');
        await absentIndex();
        await expect(restoreHostingHistory({ root, site: 'smagesa', fetchImpl: async () => { throw new Error('offline'); }, now: NOW })).rejects.toThrow('offline');
        await absentIndex();
        const drift = mockNetwork({ finalManifest: release('26.10.15.11') });
        await expect(restoreHostingHistory({ root, site: 'smagesa', fetchImpl: drift.fetchImpl, now: NOW })).rejects.toThrow('Deployment changed');
        await absentIndex();
        await expect(fs.stat(path.join(root, '.hosting-history/files'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    test.each(['./.claude/main.1111111111111111.js', './../private.1111111111111111.js', './%2e%2e/private.1111111111111111.js', 'https://other.test/main.1111111111111111.js', './js/main.1111111111111111.js?token=private'])('refuses unsafe remote path or query before fetching any body: %s', async url => {
        const manifest = release('26.10.15.10', [{ url, revision: hash('public') }]);
        const network = mockNetwork({ manifest });
        await expect(restoreHostingHistory({ root, site: 'smagesa', fetchImpl: network.fetchImpl, now: NOW })).rejects.toThrow();
        expect(network.calls).toHaveLength(1);
        await absentIndex();
    });

    test('fails closed on history symlinks, a vanished known manifest, unknown site and download limit', async () => {
        await restoreHostingHistory({ root, site: 'smagesa', fetchImpl: mockNetwork().fetchImpl, now: NOW });
        const originalIndex = await fs.readFile(path.join(root, '.hosting-history/index.json'));
        await expect(restoreHostingHistory({ root, site: 'smagesa', fetchImpl: mockNetwork({ manifest: null, legacy: "const ASSETS_TO_CACHE = ['./index.html'];" }).fetchImpl, now: NOW })).rejects.toThrow('Previously hashed');
        await expect(restoreHostingHistory({ root, site: 'smagesa', firstDeployment: true, fetchImpl: mockNetwork({ manifest: null }).fetchImpl, now: NOW })).rejects.toThrow('Previously hashed');
        expect(await fs.readFile(path.join(root, '.hosting-history/index.json'))).toEqual(originalIndex);
        await expect(restoreHostingHistory({ root, site: 'smagesa', fetchImpl: async () => new Response('x'.repeat(1000)), maxDownloadBytes: 1, now: NOW })).rejects.toThrow('download limit');
        const js = path.join(root, '.hosting-history/files/js'), outside = path.join(root, '.never-read');
        await fs.mkdir(outside);
        await fs.rm(js, { recursive: true });
        await fs.symlink(outside, js, process.platform === 'win32' ? 'junction' : 'dir');
        await expect(restoreHostingHistory({ root, site: 'smagesa', fetchImpl: mockNetwork().fetchImpl, now: NOW })).rejects.toThrow('symlink');
        await fs.unlink(js);
        await expect(restoreHostingHistory({ root, site: 'unexpected', fetchImpl: mockNetwork().fetchImpl, now: NOW })).rejects.toThrow('explicitly');
    });
});
