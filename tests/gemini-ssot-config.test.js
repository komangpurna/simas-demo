/**
 * tests/gemini-ssot-config.test.js
 * Unit test pengujian Single Source of Truth (SSOT) konfigurasi AI Gemini di js/config.js.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Pengujian SSOT AI Config & Auto-Migration Model Gemini (js/config.js)', () => {
    let getAiConfig;
    let getAiConfigAsync;
    let AI_CONFIG;
    let mockStorage = {};

    beforeEach(() => {
        mockStorage = {};

        const configPath = path.join(__dirname, '../js/config.js');
        const configCode = fs.readFileSync(configPath, 'utf8');

        const sandbox = {
            window: {},
            console: { warn: () => {}, log: () => {}, error: () => {} },
            Date: Date,
            Math: Math,
            Number: Number,
            String: String,
            Array: Array,
            Map: Map,
            Set: Set,
            localStorage: {
                getItem: (k) => mockStorage[k] || null,
                setItem: (k, v) => { mockStorage[k] = String(v); },
                removeItem: (k) => { delete mockStorage[k]; },
                clear: () => { mockStorage = {}; }
            },
            db: {},
            initializeApp: () => ({}),
            getFirestore: () => ({}),
            getAuth: () => ({}),
            createClient: () => ({}),
            createSecureSupabaseFetch: () => () => ({}),
            installWorkerFallback: ({ primaryUrl }) => ({ baseUrl: primaryUrl }),
            fetch: () => Promise.resolve({}),
            globalThis: { fetch: () => Promise.resolve({}) }
        };
        sandbox.window = sandbox;
        vm.createContext(sandbox);

        const runnableCode = configCode
            .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '// import removed')
            .replace(/export\s+async\s+function\s+([a-zA-Z0-9_]+)/g, 'async function $1')
            .replace(/export\s+function\s+([a-zA-Z0-9_]+)/g, 'function $1')
            .replace(/export\s+const\s+([a-zA-Z0-9_]+)\s*=/g, 'var $1 = window.$1 =')
            .replace(/export\s+let\s+([a-zA-Z0-9_]+)/g, 'let $1')
            .replace(/export\s+default\s+[^;]+;/g, '// export default removed')
            .replace(/export\s*\{[\s\S]*?\};?/g, '// export block removed');

        vm.runInContext(runnableCode, sandbox);

        getAiConfig = sandbox.getAiConfig || sandbox.window.getAiConfig;
        getAiConfigAsync = sandbox.getAiConfigAsync || sandbox.window.getAiConfigAsync;
        AI_CONFIG = sandbox.AI_CONFIG || sandbox.window.AI_CONFIG;
    });

    test('1. Baseline AI_CONFIG.model dan getAiConfig().model bersifat dinamis dan default kosong tanpa hardcode', () => {
        expect(AI_CONFIG.model).toBe('');
        expect(AI_CONFIG.displayName).toBe('Gemini AI');
        const cfg = getAiConfig();
        expect(cfg.model).toBe('');
        expect(cfg.displayName).toBe('Gemini AI');
    });

    test('2. AI_CONFIG setter dan getter menyinkronkan data dua arah dengan localStorage', () => {
        AI_CONFIG.model = 'gemini-2.5-flash';
        AI_CONFIG.displayName = 'Gemini 2.5 Flash';
        expect(mockStorage['simas_gemini_model']).toBe('gemini-2.5-flash');
        expect(mockStorage['simas_gemini_display_name']).toBe('Gemini 2.5 Flash');
        expect(AI_CONFIG.model).toBe('gemini-2.5-flash');
        expect(AI_CONFIG.displayName).toBe('Gemini 2.5 Flash');
        expect(getAiConfig().model).toBe('gemini-2.5-flash');
    });

    test('3. getAiConfig() HARUS menghormati model apa pun yang disimpan dari Pengaturan (SSOT)', () => {
        mockStorage['simas_gemini_model'] = 'gemini-3.5-flash-lite';
        mockStorage['simas_gemini_display_name'] = 'Gemini 3.5 Flash Lite';

        let cfg = getAiConfig();
        expect(cfg.model).toBe('gemini-3.5-flash-lite');
        expect(cfg.displayName).toBe('Gemini 3.5 Flash Lite');

        // Uji jika Super Admin memilih gemini-2.5-flash
        mockStorage['simas_gemini_model'] = 'gemini-2.5-flash';
        mockStorage['simas_gemini_display_name'] = 'Gemini 2.5 Flash';
        cfg = getAiConfig();
        expect(cfg.model).toBe('gemini-2.5-flash');
        expect(cfg.displayName).toBe('Gemini 2.5 Flash');

        // Uji jika Super Admin memilih gemini-3.8-flash
        mockStorage['simas_gemini_model'] = 'gemini-3.8-flash';
        mockStorage['simas_gemini_display_name'] = 'Gemini 3.8 Flash';
        cfg = getAiConfig();
        expect(cfg.model).toBe('gemini-3.8-flash');
        expect(cfg.displayName).toBe('Gemini 3.8 Flash');
    });

    test('4. getAiConfig() HARUS secara otomatis membersihkan cache lama yang sudah retired (gemini-1.5-flash)', () => {
        mockStorage['simas_gemini_model'] = 'gemini-1.5-flash';
        mockStorage['simas_gemini_display_name'] = 'Gemini 1.5 Flash';

        const cfg = getAiConfig();
        // Harus dibersihkan dari cache dan tidak menggunakan model retired
        expect(mockStorage['simas_gemini_model']).toBeUndefined();
        expect(cfg.model).toBe('');
    });

    test('5. getAiConfigAsync() mengembalikan konfigurasi terkini dan membersihkan model retired', async () => {
        mockStorage['simas_gemini_model'] = 'gemini-1.5-flash';
        const cfg = await getAiConfigAsync();
        expect(mockStorage['simas_gemini_model']).toBeUndefined();
        expect(cfg.model).toBe('');
    });
});
