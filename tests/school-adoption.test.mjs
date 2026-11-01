import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { prepareSchool } from '../scripts/prepare-school.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let root, plan;
const profile = {
    school: {
        schoolName: 'SMA Contoh Nusantara', schoolShortName: 'NUSANTARA', schoolNPSN: '12345678',
        schoolAddress: 'Jalan Sekolah Baru 10', schoolCity: 'Kota Contoh', schoolProvince: 'Bali',
        schoolPostalCode: '80000', schoolWebsite: 'https://sekolah-contoh.sch.id', emailDomain: 'sekolah-contoh.sch.id',
        primaryDomain: 'contoh-simas.web.app', schoolVisiAcronym: 'CERDAS', schoolVisiDesc: 'Cerdas dan berkarakter',
        headmasterName: 'Kepala Sekolah Contoh', headmasterNIP: '123456789012345678', telegramBotUser: 'contoh_bot'
    },
    firebase: { apiKey: 'public-firebase-key', authDomain: 'contoh-simas.web.app', projectId: 'contoh-simas',
        storageBucket: 'contoh-simas.firebasestorage.app', messagingSenderId: '123456789', appId: '1:123456789:web:example' },
    supabase: { url: 'https://contoh-project.supabase.co', anonKey: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"role":"anon","ref":"contoh-project"}').toString('base64url')}.example-public-signature` },
    cloudflare: { workerUrl: 'https://contoh-api.contoh.workers.dev', workerName: 'contoh-api', databaseName: 'contoh-db',
        databaseId: '11111111-2222-4333-8444-555555555555', studentPhotosBucket: 'contoh-students', gtkPhotosBucket: 'contoh-gtk' },
    appsScript: { jurnal: 'https://script.google.com/macros/s/contoh-jurnal/exec',
        ekinerja: 'https://script.google.com/macros/s/contoh-ekinerja/exec', studentDocs: 'https://script.google.com/macros/s/contoh-docs/exec' },
    hosting: { site: 'contoh-simas', stagingSite: 'contoh-testing', aliasSites: ['contoh-alias'] },
    financeStartDate: '2027-07-01', analyticsId: ''
};
const read = file => fs.readFile(path.join(root, file), 'utf8');
const executeSchool = (source, window) => {
    const context = window ? window : vm.createContext({ URL });
    source = source.replace(/export\s+(?=(?:const|function)\b)/g, '')
        .replace(/import\.meta\.url/g, JSON.stringify('https://contoh-simas.web.app/js/school-config.js'));
    vm.runInContext(source + '\nglobalThis.school = SCHOOL_CONFIG;', context);
    return context;
};

describe('Persiapan adopsi sekolah tanpa perubahan struktur UI', () => {
    beforeAll(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'simas-school-adoption-'));
        for (const dir of ['js', 'library', 'duta', 'pid', 'pub', 'sukaduka', 'css', 'cloudflare/lib']) {
            await fs.cp(path.join(sourceRoot, dir), path.join(root, dir), { recursive: true });
        }
        for (const file of ['cloudflare/worker.js', 'cloudflare/wrangler.toml', '.firebaserc', 'firebase.json', 'manifest.json',
            'supabase/functions/worker-gateway/handler.mjs', 'supabase/functions/secure-proxy/index.ts',
            'scripts/check-worker-gateway.mjs', 'scripts/hosting-sites.json', '.github/workflows/deploy.yml',
            'redirect-stub/index.html', '.well-known/assetlinks.json', 'push-worker.js', 'index.html']) {
            await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
            await fs.copyFile(path.join(sourceRoot, file), path.join(root, file));
        }
        plan = await prepareSchool({ root, profile });
    }, 60000);
    afterAll(async () => {
        const expectedParent = path.resolve(os.tmpdir()) + path.sep;
        if (root?.startsWith(expectedParent) && path.basename(root).startsWith('simas-school-adoption-')) {
            await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
    });

    test('pratinjau tidak menyentuh konfigurasi, layanan, atau kode yang sedang dikerjakan', async () => {
        expect(plan.applied).toBe(false);
        expect(plan.changes).toContain('cloudflare/worker.js');
        expect(await read('js/config.js')).toBe(await fs.readFile(path.join(sourceRoot, 'js/config.js'), 'utf8'));
        expect(await read('cloudflare/worker.js')).toBe(await fs.readFile(path.join(sourceRoot, 'cloudflare/worker.js'), 'utf8'));
    });

    test('profil tidak lengkap/secret Supabase ditolak sebelum ada penulisan', async () => {
        const before = await read('js/school-config.js');
        const invalid = structuredClone(profile);
        delete invalid.school.schoolNPSN;
        await expect(prepareSchool({ root, profile: invalid, apply: true })).rejects.toThrow('school.schoolNPSN');
        invalid.school.schoolNPSN = '12345678';
        invalid.supabase.anonKey = 'sb_secret_private-key';
        await expect(prepareSchool({ root, profile: invalid, apply: true })).rejects.toThrow('service_role');
        expect(await read('js/school-config.js')).toBe(before);
    });

    test('penerapan memperbarui identitas, semua layanan utama, dan fallback tanpa menyentuh HTML/CSS', async () => {
        const beforeHtml = await read('index.html');
        const beforeCss = await read('css/style.css');
        const result = await prepareSchool({ root, profile, apply: true });
        expect(result.applied).toBe(true);
        const context = executeSchool(await read('js/school-config.js'));
        expect(context.school.schoolName).toBe(profile.school.schoolName);
        expect(context.school.headmasterName).toBe(profile.school.headmasterName);
        expect(context.school.bendaharaKomiteName).toBe('-');
        expect(context.school.defaultSuratKeteranganNo).toBe('-');
        expect(context.school.studentDocsAppsScriptUrl).toBe(profile.appsScript.studentDocs);
        expect(context.school.canonicalAliasDomains).toContain('contoh-alias.web.app');
        for (const file of ['js/config.js', 'js/page-portal-siswa.js', 'js/page-yearbook.js', 'cloudflare/worker.js',
            'supabase/functions/secure-proxy/index.ts', 'supabase/functions/worker-gateway/handler.mjs', 'push-worker.js']) {
            const source = await read(file);
            expect(source).not.toContain('https://simas-smagesa-api.komangpurna1.workers.dev');
            expect(source).not.toContain('https://elrmzlicuuglnoeedusr.supabase.co');
        }
        const config = await read('js/config.js');
        expect(config).toContain(profile.appsScript.jurnal);
        expect(config).toContain('new Date(2027, 6, 1)');
        expect(config).toContain('const GA_ID = ""');
        expect(await read('cloudflare/worker.js')).toContain('const FIREBASE_PROJECT_ID = "contoh-simas"');
        expect(await read('cloudflare/worker.js')).toContain('policy_smagesa_default');
        expect(await read('cloudflare/lib/school-identity.js')).toContain('npsn: "12345678"');
        expect(await read('js/page-guru-mapel.js')).not.toContain('Jl. Ida Ketut Jelantik');
        expect(await read('index.html')).toBe(beforeHtml);
        expect(await read('css/style.css')).toBe(beforeCss);
        expect(result.changes.some(file => file.endsWith('.css'))).toBe(false);
        expect(result.changes.filter(file => file.endsWith('.html'))).toEqual(['redirect-stub/index.html']);
    }, 60000);

    test('domain baru diizinkan Worker/gateway dan tidak diarahkan kembali ke sekolah asal', async () => {
        const http = await read('cloudflare/lib/http.js');
        const context = vm.createContext({ Response, Request, Headers });
        vm.runInContext(http.replace(/^export\s+/gm, '') + '\nglobalThis.cors = getCorsHeaders;', context);
        expect(context.cors(new Request('https://worker.invalid', { headers: { Origin: 'https://contoh-simas.web.app' } }))['Access-Control-Allow-Origin']).toBe('https://contoh-simas.web.app');
        const gateway = vm.createContext({ Response, Request, Headers, URL, URLSearchParams, TextEncoder, AbortController, setTimeout, clearTimeout });
        vm.runInContext((await read('supabase/functions/worker-gateway/handler.mjs')).replace(/^export\s+/gm, '') + '\nglobalThis.create = createWorkerGateway;', gateway);
        const response = await gateway.create({ nativeFetch: () => { throw new Error('Tidak boleh memanggil upstream saat preflight'); } })(new Request('https://supabase.invalid/functions/v1/worker-gateway/api/health', { method: 'OPTIONS', headers: { Origin: 'https://contoh-simas.web.app' } }));
        expect(response.status).toBe(204);
        const firebase = JSON.parse(await read('firebase.json'));
        expect(firebase.hosting.map(item => item.target)).toEqual(['contoh-simas', 'contoh-testing', 'contoh-alias']);
        expect(firebase.hosting[0].predeploy[0]).toContain('--site contoh-simas');
        expect(firebase.hosting[2].redirects[0].destination).toBe('https://contoh-simas.web.app/');
        expect(JSON.parse(await read('.firebaserc')).projects.default).toBe('contoh-simas');
        expect(await read('.github/workflows/deploy.yml')).toContain('hosting:contoh-simas,hosting:contoh-alias');
        expect(await read('cloudflare/wrangler.toml')).toContain('database_id = "11111111-2222-4333-8444-555555555555"');
        expect(JSON.parse(await read('.well-known/assetlinks.json'))).toEqual([]);
    });

    test('template sekolah baru mempertahankan elemen, kelas CSS, dan kontrol halaman login', async () => {
        const dom = new JSDOM(await read('index.html'), { url: 'https://contoh-simas.web.app', runScripts: 'outside-only' });
        const structure = () => [...dom.window.document.body.querySelectorAll('*')].map(el => [el.tagName, el.id, el.getAttribute('class'), el.getAttribute('onclick')]);
        const before = structure();
        dom.window.URL.createObjectURL = () => 'blob:https://contoh-simas.web.app/manifest';
        executeSchool(await read('js/school-config.js'), dom.getInternalVMContext());
        dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
        expect(structure()).toEqual(before);
        expect(dom.window.document.body.textContent).not.toContain('{{school');
        expect(dom.window.document.body.textContent).not.toContain('SMAGESA');
        expect(dom.window.document.body.textContent).toContain('NUSANTARA');
        expect(dom.window.document.querySelector('link[rel="manifest"]').href).toMatch(/^blob:/);
        dom.window.close();
    });

    test('menjalankan profil yang sama lagi tidak terus mengubah berkas', async () => {
        const result = await prepareSchool({ root, profile });
        expect(result.changes).toEqual([]);
    }, 60000);

    test('nama berisi apostrof, backtick, dan sintaks template tetap menjadi teks, bukan kode', async () => {
        const special = structuredClone(profile);
        special.school.schoolName = "SMA O'Connor `Baru` ${globalThis.injected = true}";
        special.school.schoolShortName = 'NUSANTARA BARU';
        special.school.appName = 'SIMAS Baru';
        await prepareSchool({ root, profile: special, apply: true });
        const context = executeSchool(await read('js/school-config.js'));
        expect(context.school.schoolName).toBe(special.school.schoolName);
        expect(context.injected).toBeUndefined();
        const once = context.replaceSchoolIdentityText('SIMAS SMAGESA');
        expect(context.replaceSchoolIdentityText(once)).toBe(once);
    }, 60000);

    test('sekolah yang hanya memakai site produksi tidak harus menyiapkan staging', async () => {
        const minimal = structuredClone(profile);
        minimal.hosting.stagingSite = '';
        minimal.hosting.aliasSites = [];
        await prepareSchool({ root, profile: minimal, apply: true });
        expect(JSON.parse(await read('firebase.json')).hosting.map(site => site.target)).toEqual(['contoh-simas']);
        const workflow = await read('.github/workflows/deploy.yml');
        expect(workflow).not.toContain('      - testing');
        expect(workflow).not.toContain('hosting:contoh-testing');
        expect(workflow).toContain('hosting:contoh-simas,firestore');
    }, 60000);
});
