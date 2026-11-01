const fs = require('node:fs');
const path = require('node:path');
const minimatchModule = require('minimatch');
const minimatch = typeof minimatchModule === 'function' ? minimatchModule : minimatchModule.minimatch;
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
const applications = config.hosting.filter(target => ['smagesa', 'sman1abang'].includes(target.target));

function effectiveCacheControl(target, pathname) {
    let value;
    for (const rule of target.headers) {
        const matches = rule.regex ? new RegExp(rule.regex).test(pathname)
            : minimatch(pathname, rule.source) || minimatch(pathname.replace(/^\//, ''), rule.source);
        if (matches) for (const header of rule.headers) if (header.key.toLowerCase() === 'cache-control') value = header.value;
    }
    return value;
}

describe('Hosting deployment and cache boundaries', () => {
    test('both application sites publish only the prepared artifact', () => {
        expect(applications).toHaveLength(2);
        for (const target of applications) {
            expect(target.public).toBe('dist-hosting');
            expect(target.predeploy).toEqual([`node scripts/restore-hosting-history.mjs --site ${target.target}`, 'node scripts/build-hosting.mjs', 'node scripts/check-hosting-build.mjs']);
            for (const ignored of ['tests/**', 'templates/**', 'google-apps-script/**', 'dist-hosting/**', '.hosting-history/**', '.claude/**', '**/*.md', 'firebase-*.json', '**/*.pdf', '**/*.LICENSE', 'school*.json', '**/*.docx', '**/*.doc']) {
                expect(target.ignore).toContain(ignored);
            }
        }
        expect(config.hosting.find(target => target.target === 'simas-shakti').public).toBe('redirect-stub');
    });

    test.each(['/index.html', '/portal-siswa.html', '/js/config.js', '/js/global.js', '/css/tailwind.css'])('%s always validates its mutable URL', pathname => {
        for (const target of applications) expect(effectiveCacheControl(target, pathname)).toBe('public, max-age=0, must-revalidate');
    });

    test.each(['/js/global.0123456789abcdef.js', '/library/opac.abcdef0123456789.js', '/css/style.0123456789abcdef.css'])('%s is immutable only through its hash-shaped filename', pathname => {
        for (const target of applications) expect(effectiveCacheControl(target, pathname)).toBe('public, max-age=31536000, immutable');
    });

    test.each(['/assets/logo-sekolah.png', '/assets/cap-sekolah.png', '/assets/badge-sekolah.png', '/video/splash.mp4', '/assets/preview.webp', '/assets/icon.svg', '/fonts/Inter.woff2'])('%s is cached with immutable binary cache for 30 days', pathname => {
        for (const target of applications) expect(effectiveCacheControl(target, pathname)).toBe('public, max-age=2592000, immutable');
    });

    test.each(['/sw.js', '/sw-manifest.js', '/push-worker.js', '/firebase-messaging-sw.js'])('%s remains outside long-lived browser cache', pathname => {
        for (const target of applications) expect(effectiveCacheControl(target, pathname)).toMatch(/no-store/);
    });

    test('version synchronization cannot rewrite prepared or historical HTML', () => {
        const source = fs.readFileSync(path.join(root, 'scripts/sync-version.js'), 'utf8');
        const declaration = source.match(/const IGNORED_DIRS = new Set\(\[([^\]]+)\]\)/);
        expect(declaration).not.toBeNull();
        for (const directory of ['dist-hosting', '.hosting-history', 'tests']) expect(declaration[1]).toContain(`'${directory}'`);
        const syntax = fs.readFileSync(path.join(root, 'scripts/check-syntax.js'), 'utf8');
        expect(syntax).toContain("file !== 'dist-hosting'");
    });
});
