import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

describe('Anti-Stale Empty Cache & Force Refresh Presensi Siswa (portal-siswa.html)', () => {
    const portalHtmlPath = path.join(projectRoot, 'portal-siswa.html');
    const portalJsPath = path.join(projectRoot, 'js', 'page-portal-siswa.js');

    const portalHtml = fs.readFileSync(portalHtmlPath, 'utf8');
    const portalJs = fs.readFileSync(portalJsPath, 'utf8');

    test('1. portal-siswa.html memiliki tombol refresh presensi mandiri', () => {
        expect(portalHtml).toContain('id="btn-refresh-presensi"');
        expect(portalHtml).toContain('onclick="loadPresensi(true)"');
        expect(portalHtml).toContain('fa-arrows-rotate');
    });

    test('2. page-portal-siswa.js mendukung parameter forceRefresh pada loadPresensi', () => {
        expect(portalJs).toMatch(/window\.loadPresensi\s*=\s*async\s*function\s*\(\s*forceRefresh\s*=\s*false\s*\)/);
        expect(portalJs).toContain('if (forceRefresh)');
        expect(portalJs).toContain('sessionStorage.removeItem(presensiCacheKey)');
    });

    test('3. page-portal-siswa.js memiliki proteksi anti-stale empty cache (isCachedEmpty)', () => {
        expect(portalJs).toContain('isCachedEmpty');
        expect(portalJs).toContain('Number(cachedPresensi.stats?.H || 0) === 0');
        expect(portalJs).toContain('Number(cachedPresensi.stats?.S || 0) === 0');
        expect(portalJs).toContain('if (cachedPresensi && !isCachedEmpty)');
    });

    test('4. page-portal-siswa.js hanya meng-cache saat rows.length > 0 (tidak mengunci status kosong)', () => {
        expect(portalJs).toContain('if (rows.length > 0)');
        expect(portalJs).toContain('setSessionCache(presensiCacheKey, { stats, html: renderedHtml });');
        expect(portalJs).toContain('try { sessionStorage.removeItem(presensiCacheKey); } catch (_) {}');
    });

    test('5. clearPortalCache membersihkan seluruh session cache simas_portal_presensi_', () => {
        expect(portalJs).toContain('k.startsWith(\'simas_portal_presensi_\')');
        expect(portalJs).toContain('sessionStorage.removeItem(k)');
    });

    test('6. UI memutar ikon fa-spin saat tombol refresh diklik dan berhenti di finally', () => {
        expect(portalJs).toContain("refreshIcon.classList.add('fa-spin')");
        expect(portalJs).toContain("refreshIcon.classList.remove('fa-spin')");
    });
});
