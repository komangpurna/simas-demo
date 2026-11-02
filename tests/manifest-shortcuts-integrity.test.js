const fs = require('fs');
const path = require('path');

describe('Verifikasi Integritas App Shortcuts PWA & Android TWA', () => {
    const rootDir = path.resolve(__dirname, '..');
    const manifestPath = path.join(rootDir, 'manifest.json');
    const twaManifestPath = path.join(rootDir, 'android-twa', 'twa-manifest.json');

    test('1. manifest.json valid dan memuat shortcuts E-Kinerja & E-Kinerja Tendik', () => {
        expect(fs.existsSync(manifestPath)).toBe(true);
        const raw = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(raw);

        expect(Array.isArray(manifest.shortcuts)).toBe(true);
        expect(manifest.shortcuts.length).toBe(5);

        // Shortcut 1: E-Kinerja Guru
        const ekinerja = manifest.shortcuts.find(s => s.name === 'E-Kinerja Guru');
        expect(ekinerja).toBeDefined();
        expect(ekinerja.short_name).toBe('E-Kinerja Guru');
        expect(ekinerja.url).toBe('e-kinerja.html');
        expect(Array.isArray(ekinerja.icons)).toBe(true);
        expect(ekinerja.icons.length).toBeGreaterThanOrEqual(1);

        // Shortcut 2: E-Kinerja Tendik
        const tendikShortcut = manifest.shortcuts.find(s => s.name === 'E-Kinerja Tendik');
        expect(tendikShortcut).toBeDefined();
        expect(tendikShortcut.short_name).toBe('E-Kinerja Tendik');
        expect(tendikShortcut.url).toBe('e-kinerja-tendik.html');
        expect(Array.isArray(tendikShortcut.icons)).toBe(true);
        expect(tendikShortcut.icons.length).toBeGreaterThanOrEqual(1);

        // Pastikan shortcut eksisting tetap ada & Lapor!mas berada di posisi ke-3
        expect(manifest.shortcuts[2].name).toBe('Lapor!mas');
        expect(manifest.shortcuts.some(s => s.name === 'Monitoring KBM')).toBe(true);
        expect(manifest.shortcuts.some(s => s.name === 'Lihat Agenda')).toBe(true);
        expect(manifest.shortcuts.some(s => s.name === 'Lapor!mas')).toBe(true);
    });

    test('2. android-twa/twa-manifest.json valid dan memuat shortcuts E-Kinerja & E-Kinerja Tendik', () => {
        expect(fs.existsSync(twaManifestPath)).toBe(true);
        const raw = fs.readFileSync(twaManifestPath, 'utf8');
        const twaManifest = JSON.parse(raw);

        expect(Array.isArray(twaManifest.shortcuts)).toBe(true);
        expect(twaManifest.shortcuts.length).toBe(5);

        // Shortcut 1: E-Kinerja Guru
        const ekinerja = twaManifest.shortcuts.find(s => s.name === 'E-Kinerja Guru');
        expect(ekinerja).toBeDefined();
        expect(ekinerja.shortName).toBe('E-Kinerja Guru');
        expect(ekinerja.url).toMatch(/https:\/\/[^/]+\/e-kinerja\.html/);
        expect(ekinerja.url).toContain(twaManifest.host);
        expect(ekinerja.icon).toBeDefined();

        // Shortcut 2: E-Kinerja Tendik
        const tendikShortcut = twaManifest.shortcuts.find(s => s.name === 'E-Kinerja Tendik');
        expect(tendikShortcut).toBeDefined();
        expect(tendikShortcut.shortName).toBe('E-Kinerja Tendik');
        expect(tendikShortcut.url).toMatch(/https:\/\/[^/]+\/e-kinerja-tendik\.html/);
        expect(tendikShortcut.url).toContain(twaManifest.host);
        expect(tendikShortcut.icon).toBeDefined();

        // Pastikan shortcut eksisting tetap ada & Lapor!mas berada di posisi ke-3
        expect(twaManifest.shortcuts[2].name).toBe('Lapor!mas');
        expect(twaManifest.shortcuts.some(s => s.name === 'Monitoring KBM')).toBe(true);
        expect(twaManifest.shortcuts.some(s => s.name === 'Lihat Agenda')).toBe(true);
        expect(twaManifest.shortcuts.some(s => s.name === 'Lapor!mas')).toBe(true);
    });
});
