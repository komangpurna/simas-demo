/**
 * tests/school-config.test.js
 * Unit test integritas modul js/school-config.js dan generator manifest createSchoolManifest().
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Verifikasi Integritas js/school-config.js & PWA Manifest Generator', () => {
    let SCHOOL_CONFIG;
    let createSchoolManifest;
    let schoolAssetUrl;
    let replaceSchoolIdentityText;

    beforeEach(() => {
        const configPath = path.join(__dirname, '../js/school-config.js');
        const configCode = fs.readFileSync(configPath, 'utf8');

        const sandbox = {
            window: {},
            console: { warn: () => {}, log: () => {}, error: () => {} },
            Date: Date,
            Math: Math,
            Number: Number,
            String: String,
            Array: Array,
            Object: Object,
            URL: class MockURL extends URL {
                static createObjectURL() { return 'blob:https://smagesa.web.app/mock-manifest'; }
            },
            Blob: class Blob {},
            Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
            NodeFilter: { SHOW_TEXT: 4 },
            Element: class Element {},
            MutationObserver: class MutationObserver {
                constructor() {}
                observe() {}
                disconnect() {}
            },
            document: {
                title: 'SIMAS Test',
                documentElement: { style: { setProperty: () => {} } },
                querySelector: () => null,
                createElement: () => ({ rel: '', href: '', content: '', name: '', dataset: {} }),
                head: { appendChild: () => {} },
                body: { appendChild: () => {} },
                createTreeWalker: () => ({ nextNode: () => null })
            }
        };
        sandbox.window = sandbox;
        vm.createContext(sandbox);

        let runnableCode = configCode
            .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '// import removed')
            .replace(/export\s+async\s+function\s+([a-zA-Z0-9_]+)/g, 'async function $1')
            .replace(/export\s+function\s+([a-zA-Z0-9_]+)/g, 'function $1')
            .replace(/export\s+const\s+([a-zA-Z0-9_]+)\s*=/g, 'var $1 = window.$1 =')
            .replace(/export\s+let\s+([a-zA-Z0-9_]+)/g, 'let $1')
            .replace(/import\.meta\.url/g, '"https://smagesa.web.app/js/school-config.js"');

        runnableCode += '\nwindow.SCHOOL_CONFIG = typeof SCHOOL_CONFIG !== "undefined" ? SCHOOL_CONFIG : window.SCHOOL_CONFIG; window.createSchoolManifest = typeof createSchoolManifest !== "undefined" ? createSchoolManifest : window.createSchoolManifest; window.schoolAssetUrl = typeof schoolAssetUrl !== "undefined" ? schoolAssetUrl : window.schoolAssetUrl; window.replaceSchoolIdentityText = typeof replaceSchoolIdentityText !== "undefined" ? replaceSchoolIdentityText : window.replaceSchoolIdentityText; window.isClonedSchool = typeof isClonedSchool !== "undefined" ? isClonedSchool : window.isClonedSchool; window.getSchoolIdentity = typeof getSchoolIdentity !== "undefined" ? getSchoolIdentity : window.getSchoolIdentity;';

        vm.runInContext(runnableCode, sandbox);

        SCHOOL_CONFIG = sandbox.SCHOOL_CONFIG || sandbox.window.SCHOOL_CONFIG;
        createSchoolManifest = sandbox.createSchoolManifest || sandbox.window.createSchoolManifest;
        schoolAssetUrl = sandbox.schoolAssetUrl || sandbox.window.schoolAssetUrl;
        replaceSchoolIdentityText = sandbox.replaceSchoolIdentityText || sandbox.window.replaceSchoolIdentityText;
        isClonedSchool = sandbox.isClonedSchool || sandbox.window.isClonedSchool;
        getSchoolIdentity = sandbox.getSchoolIdentity || sandbox.window.getSchoolIdentity;
    });

    test('1. SCHOOL_CONFIG memiliki konfigurasi aset dan identitas yang valid', () => {
        expect(SCHOOL_CONFIG.appName).toBe('SIMAS');
        expect(SCHOOL_CONFIG.logoPath).toBe('assets/logo-sekolah.png');
        expect(SCHOOL_CONFIG.logoPaddedPath).toBe('assets/logo-sekolah-padded.png');
        expect(SCHOOL_CONFIG.logoPadded192Path).toBe('assets/logo-sekolah-padded-192.png');
        expect(SCHOOL_CONFIG.headmasterSignaturePath).toBe('assets/ttd-kepsek.png');
        expect(SCHOOL_CONFIG.schoolStampPath).toBe('assets/cap-sekolah.png');
        expect(SCHOOL_CONFIG.appThemeColor).toBe('#0f172a');
        expect(SCHOOL_CONFIG.appBrand).toBe('SIMAS - CERDAS');
    });

    test('2. createSchoolManifest() menghasilkan manifest valid tanpa melempar ReferenceError', () => {
        let manifest;
        expect(() => {
            manifest = createSchoolManifest();
        }).not.toThrow();

        expect(manifest).toBeDefined();
        expect(manifest.name).toBe('SIMAS - CERDAS');
        expect(manifest.short_name).toBe('SIMAS - CERDAS');
        expect(manifest.display).toBe('standalone');
        expect(manifest.theme_color).toBe('#0f172a');
        expect(manifest.background_color).toBe('#0f172a');

        // Verifikasi array icons
        expect(Array.isArray(manifest.icons)).toBe(true);
        expect(manifest.icons.length).toBe(2);

        const icon192 = manifest.icons.find(i => i.sizes === '192x192');
        expect(icon192).toBeDefined();
        expect(icon192.src).toContain('assets/logo-sekolah-padded-192.png');
        expect(icon192.purpose).toBe('any');

        const icon512 = manifest.icons.find(i => i.sizes === '512x512');
        expect(icon512).toBeDefined();
        expect(icon512.src).toContain('assets/logo-sekolah-padded.png');
        expect(icon512.purpose).toBe('any');

        // Verifikasi shortcuts (memastikan tidak ada ReferenceError pada properti icons shortcut)
        expect(Array.isArray(manifest.shortcuts)).toBe(true);
        expect(manifest.shortcuts.length).toBe(5);
        expect(manifest.shortcuts.some(s => s.name === 'E-Kinerja' && s.url.endsWith('e-kinerja.html'))).toBe(true);
        expect(manifest.shortcuts.some(s => s.name === 'E-Kinerja Tendik' && s.url.endsWith('e-kinerja-tendik.html'))).toBe(true);
        expect(manifest.shortcuts.some(s => s.name === 'Monitoring KBM' && s.url.endsWith('monitoring-kbm.html'))).toBe(true);
        expect(manifest.shortcuts.some(s => s.name === 'Lihat Agenda' && s.url.endsWith('agenda.html'))).toBe(true);
        expect(manifest.shortcuts.some(s => s.name === 'Lapor!mas' && s.url.includes('index.html?action=lapor'))).toBe(true);
        for (const shortcut of manifest.shortcuts) {
            expect(shortcut.name).toBeDefined();
            expect(shortcut.url).toBeDefined();
            expect(Array.isArray(shortcut.icons)).toBe(true);
            expect(shortcut.icons.length).toBeGreaterThan(0);
            for (const scIcon of shortcut.icons) {
                expect(scIcon.src).toBeDefined();
                expect(scIcon.sizes).toBeDefined();
            }
        }
    });

    test('3. schoolAssetUrl menghasilkan URL absolut valid', () => {
        const url = schoolAssetUrl('assets/logo-sekolah.png');
        expect(url).toBe('https://smagesa.web.app/assets/logo-sekolah.png');
    });

    test('4. Pejabat penandatangan komite dan pejabat lainnya terdaftar di SCHOOL_CONFIG', () => {
        expect(SCHOOL_CONFIG.headmasterName).toBe('Dr. I Wayan Sudarsana, M.Pd.');
        expect(SCHOOL_CONFIG.headmasterNIP).toBe('197501012000031001');
        expect(SCHOOL_CONFIG.bendaharaKomiteName).toBe('Ni Made Ariani, S.E.');
        expect(SCHOOL_CONFIG.ketuaKomiteName).toBe('I Ketut Wirawan, S.T.');
        expect(SCHOOL_CONFIG.wakabidSarprasName).toBe('I Made Sujana, S.Pd.');
        expect(SCHOOL_CONFIG.audit1Name).toBe('Drs. I Gusti Ngurah Oka');
        expect(SCHOOL_CONFIG.audit2Name).toBe('Dra. Ni Luh Putu Wardani');
        expect(SCHOOL_CONFIG.bendaharaSekolahName).toBe('I Komang Sukadana, S.Pd.');
    });

    test('5. SCHOOL_CONFIG memiliki konfigurasi alamat sekolah lengkap dan pendek yang valid', () => {
        expect(SCHOOL_CONFIG.schoolAddress).toBe('Jl. Nusantara No. 1, Denpasar');
        expect(SCHOOL_CONFIG.schoolAddressFull).toBe('Jl. Nusantara No. 1, Denpasar');
        expect(SCHOOL_CONFIG.schoolAddressShort).toBe('Jl. Nusantara No. 1, Denpasar');
        expect(SCHOOL_CONFIG.schoolStreetAddress).toBe('Jl. Nusantara No. 1, Denpasar');

        // Verifikasi replaceSchoolIdentityText dengan token alamat
        expect(replaceSchoolIdentityText('Alamat: {{schoolAddress}}')).toBe('Alamat: Jl. Nusantara No. 1, Denpasar');
        expect(replaceSchoolIdentityText('Alamat Pendek: {{schoolAddressShort}}')).toBe('Alamat Pendek: Jl. Nusantara No. 1, Denpasar');
    });

    test('6. isClonedSchool() dan getSchoolIdentity() berfungsi tepat pada konfigurasi sekolah', () => {
        expect(typeof isClonedSchool).toBe('function');
        expect(isClonedSchool()).toBe(true); // SMA Negeri Nusantara (bukan SMA Negeri 1 Abang)

        expect(typeof getSchoolIdentity).toBe('function');
        expect(getSchoolIdentity('schoolShortName')).toBe('SMANTARA');
        expect(getSchoolIdentity('schoolName')).toBe('SMA Negeri Nusantara');
        expect(getSchoolIdentity('nonExistentKey', 'Fallback')).toBe('Fallback');
    });

    test('7. Smart Auto-Replacer mentransformasikan identitas otomatis saat dikloning untuk sekolah lain', () => {
        const configPath = path.join(__dirname, '../js/school-config.js');
        const configCode = fs.readFileSync(configPath, 'utf8');

        // Simulasikan konfigurasi sekolah baru (cloned school)
        const clonedConfigCode = configCode
            .replace(/schoolName:\s*["'][^"']+["']/, "schoolName: 'SMA Negeri 2 Denpasar'")
            .replace(/schoolShortName:\s*["'][^"']+["']/, "schoolShortName: 'SMADEN'")
            .replace(/schoolVisiAcronym:\s*["'][^"']+["']/, "schoolVisiAcronym: 'WIDYA'")
            .replace(/telegramBotUser:\s*["'][^"']+["']/, "telegramBotUser: 'smaden_bot'")
            .replace(/primaryDomain:\s*["'][^"']+["']/, "primaryDomain: 'smaden.web.app'");

        const sandbox = {
            window: {},
            console: { warn: () => {}, log: () => {}, error: () => {} },
            Date: Date,
            Math: Math,
            Number: Number,
            String: String,
            Array: Array,
            Object: Object,
            URL: class MockURL extends URL {
                static createObjectURL() { return 'blob:https://smaden.web.app/mock-manifest'; }
            },
            Blob: class Blob {},
            Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
            NodeFilter: { SHOW_TEXT: 4 },
            Element: class Element {},
            MutationObserver: class MutationObserver {
                constructor() {}
                observe() {}
                disconnect() {}
            },
            document: {
                title: 'Jadwal Pelajaran - SIMAS SMAGESA',
                documentElement: { style: { setProperty: () => {} } },
                querySelector: () => null,
                createElement: () => ({ rel: '', href: '', content: '', name: '', dataset: {} }),
                head: { appendChild: () => {} },
                body: { appendChild: () => {} },
                createTreeWalker: () => ({ nextNode: () => null })
            }
        };
        sandbox.window = sandbox;
        vm.createContext(sandbox);

        let runnableCode = clonedConfigCode
            .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '// import removed')
            .replace(/export\s+async\s+function\s+([a-zA-Z0-9_]+)/g, 'async function $1')
            .replace(/export\s+function\s+([a-zA-Z0-9_]+)/g, 'function $1')
            .replace(/export\s+const\s+([a-zA-Z0-9_]+)\s*=/g, 'var $1 = window.$1 =')
            .replace(/export\s+let\s+([a-zA-Z0-9_]+)/g, 'let $1')
            .replace(/import\.meta\.url/g, '"https://smaden.web.app/js/school-config.js"');

        runnableCode += '\nwindow.SCHOOL_CONFIG = typeof SCHOOL_CONFIG !== "undefined" ? SCHOOL_CONFIG : window.SCHOOL_CONFIG; window.replaceSchoolIdentityText = typeof replaceSchoolIdentityText !== "undefined" ? replaceSchoolIdentityText : window.replaceSchoolIdentityText; window.isClonedSchool = typeof isClonedSchool !== "undefined" ? isClonedSchool : window.isClonedSchool;';

        vm.runInContext(runnableCode, sandbox);

        const clonedIsClonedSchool = sandbox.isClonedSchool || sandbox.window.isClonedSchool;
        const clonedReplacer = sandbox.replaceSchoolIdentityText || sandbox.window.replaceSchoolIdentityText;

        expect(clonedIsClonedSchool()).toBe(true);

        // 1. Transformasi token Handlebars
        expect(clonedReplacer('Selamat Datang di {{schoolName}}')).toBe('Selamat Datang di SMA Negeri 2 Denpasar');
        expect(clonedReplacer('Sistem {{schoolShortName}}')).toBe('Sistem SMADEN');

        // 2. Transformasi otomatis string bawaan non-token (Smart Auto-Replacer)
        expect(clonedReplacer('Kartu Pelajar SMA Negeri 1 Abang')).toBe('Kartu Pelajar SMA Negeri 2 Denpasar');
        expect(clonedReplacer('RESMI • SMAGESA SHAKTI')).toBe('RESMI • SMADEN WIDYA');
        expect(clonedReplacer('Kunjungi https://smagesa.web.app via bot @smagesa_bot')).toBe('Kunjungi https://smaden.web.app via bot @smaden_bot');
    });
});
