/** Persiapan salinan sekolah, sepenuhnya lokal. Tidak membuat akun, mengirim data, atau deploy. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'acorn';
import { full } from 'acorn-walk';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = value => JSON.stringify(value, null, 2) + '\n';
const escapeRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const parseJs = source => parse(source, { ecmaVersion: 'latest', sourceType: 'module' });

function variable(source, name) {
    let found;
    full(parseJs(source), node => {
        if (node.type === 'VariableDeclarator' && node.id.name === name) found = node.init;
    });
    if (!found) throw new Error(`Konfigurasi ${name} tidak ditemukan; berkas belum diubah.`);
    return found;
}

function objectNode(source, name) {
    const node = variable(source, name);
    const object = node.type === 'CallExpression' ? node.arguments[0] : node;
    if (object?.type !== 'ObjectExpression') throw new Error(`${name} harus berupa objek konfigurasi.`);
    return object;
}

function literalObject(source, name) {
    const literal = node => {
        if (node.type === 'Literal') return node.value;
        if (node.type === 'ArrayExpression') return node.elements.map(literal);
        throw new Error(`${name} hanya boleh berisi nilai literal.`);
    };
    return Object.fromEntries(objectNode(source, name).properties.filter(p => p.kind === 'init').map(p => {
        // Konfigurasi yang dibaca di sini hanya literal, tanpa menjalankan kode aplikasi.
        return [p.key.name || p.key.value, literal(p.value)];
    }));
}

function edits(source, patches) {
    for (const edit of patches.sort((a, b) => b.start - a.start)) {
        source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    }
    return source;
}

function patchObject(source, name, values) {
    const patches = [], seen = new Set();
    const node = objectNode(source, name);
    for (const property of node.properties) {
        const key = property.key.name || property.key.value;
        if (!Object.hasOwn(values, key)) continue;
        seen.add(key);
        patches.push(property.kind === 'get'
            ? { start: property.start, end: property.end, text: `${key}: ${JSON.stringify(values[key])}` }
            : { start: property.value.start, end: property.value.end, text: JSON.stringify(values[key]) });
    }
    const unknown = Object.keys(values).filter(key => !seen.has(key));
    if (unknown.length) throw new Error(`Properti ${name} tidak dikenal: ${unknown.join(', ')}`);
    return edits(source, patches);
}

function patchVariable(source, name, value) {
    const node = variable(source, name);
    return edits(source, [{ start: node.start, end: node.end, text: JSON.stringify(value) }]);
}

function replaceStrings(source, pairs) {
    if (!pairs.length) return source;
    const values = new Map(pairs.filter(([before, after]) => before && before !== after));
    if (!values.size) return source;
    const re = new RegExp([...values.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|'), 'g');
    if (!re.test(source)) return source;
    const replace = (text, template = false) => text.replace(re, key => {
        const value = String(values.get(key));
        return template ? value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') : value;
    });
    const patches = [];
    full(parseJs(source), node => {
        if (node.type === 'Literal' && typeof node.value === 'string') {
            const next = replace(node.value);
            if (next !== node.value) patches.push({ start: node.start, end: node.end, text: JSON.stringify(next) });
        } else if (node.type === 'TemplateElement') {
            const raw = source.slice(node.start, node.end), next = replace(raw, true);
            if (raw !== next) patches.push({ start: node.start, end: node.end, text: next });
        }
    });
    return edits(source, patches);
}

function required(value, label) {
    if (typeof value !== 'string' || !value.trim() || /ISI_|GANTI_|CHANGE_ME|YOUR_/i.test(value)) {
        throw new Error(`Isi ${label} dengan nilai sekolah baru.`);
    }
    return value.trim();
}

function httpsUrl(value, label, originOnly = false) {
    const url = new URL(required(value, label));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || (originOnly && url.pathname !== '/')) throw new Error(`${label} harus berupa URL HTTPS yang valid.`);
    return originOnly ? url.origin : url.href;
}

function identifier(value, label) {
    const text = required(value, label);
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(text)) throw new Error(`${label} hanya boleh berisi huruf kecil, angka, dan tanda minus.`);
    return text;
}

function validate(input) {
    const p = structuredClone(input);
    for (const key of ['school', 'firebase', 'supabase', 'cloudflare', 'appsScript', 'hosting']) {
        if (!p[key] || typeof p[key] !== 'object' || Array.isArray(p[key])) throw new Error(`Bagian ${key} wajib diisi.`);
    }
    for (const key of ['schoolName', 'schoolShortName', 'schoolNPSN', 'schoolAddress', 'schoolCity', 'schoolProvince',
        'schoolPostalCode', 'schoolWebsite', 'emailDomain', 'headmasterName', 'headmasterNIP', 'schoolVisiAcronym', 'schoolVisiDesc', 'telegramBotUser']) {
        p.school[key] = required(p.school[key], `school.${key}`);
    }
    if (!/^\d{8}$/.test(p.school.schoolNPSN)) throw new Error('school.schoolNPSN harus berisi 8 digit.');
    p.school.schoolWebsite = httpsUrl(p.school.schoolWebsite, 'school.schoolWebsite').replace(/\/$/, '');
    const domain = required(p.school.primaryDomain, 'school.primaryDomain');
    if (!/^[a-z0-9.-]+$/i.test(domain) || !domain.includes('.') || domain.includes('..')) throw new Error('primaryDomain hanya berisi nama domain, tanpa https:// atau path.');
    p.school.primaryDomain = domain.toLowerCase();
    for (const key of ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId']) p.firebase[key] = required(p.firebase[key], `firebase.${key}`);
    if (!/^[a-z0-9.-]+$/i.test(p.firebase.authDomain) || !p.firebase.authDomain.includes('.')) throw new Error('firebase.authDomain hanya berisi hostname.');
    identifier(p.firebase.projectId, 'firebase.projectId');
    p.supabase.url = httpsUrl(p.supabase.url, 'supabase.url', true);
    required(p.supabase.anonKey, 'supabase.anonKey');
    let claims;
    try { claims = JSON.parse(Buffer.from(p.supabase.anonKey.split('.')[1], 'base64url').toString()); } catch { /* invalid public key */ }
    if (claims?.role !== 'anon') throw new Error('Gunakan anon JWT key Supabase sesuai integrasi saat ini; service_role dan secret key tidak boleh masuk frontend.');
    p.cloudflare.workerUrl = httpsUrl(p.cloudflare.workerUrl, 'cloudflare.workerUrl', true);
    for (const key of ['workerName', 'databaseName', 'studentPhotosBucket', 'gtkPhotosBucket']) identifier(p.cloudflare[key], `cloudflare.${key}`);
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p.cloudflare.databaseId || '')) throw new Error('cloudflare.databaseId harus berupa UUID D1 baru.');
    for (const key of ['jurnal', 'ekinerja', 'studentDocs']) {
        p.appsScript[key] = httpsUrl(p.appsScript[key], `appsScript.${key}`);
        if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(p.appsScript[key])) throw new Error(`appsScript.${key} harus berupa URL Web App /exec.`);
    }
    identifier(p.hosting.site, 'hosting.site');
    if (p.hosting.stagingSite) identifier(p.hosting.stagingSite, 'hosting.stagingSite');
    if (p.hosting.site === p.hosting.stagingSite) throw new Error('hosting.stagingSite harus berbeda dari site produksi.');
    p.hosting.aliasSites ||= [];
    if (!Array.isArray(p.hosting.aliasSites)) throw new Error('hosting.aliasSites harus berupa array.');
    p.hosting.aliasSites.forEach(value => identifier(value, 'hosting.aliasSites'));
    const sites = [p.hosting.site, p.hosting.stagingSite, ...p.hosting.aliasSites].filter(Boolean);
    if (new Set(sites).size !== sites.length) throw new Error('Site produksi, staging, dan alias harus berbeda.');
    if (p.analyticsId && !/^G-[A-Z0-9]+$/.test(p.analyticsId)) throw new Error('analyticsId harus berupa ID GA4 atau string kosong.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.financeStartDate || '') || Number.isNaN(Date.parse(p.financeStartDate))
        || new Date(p.financeStartDate).toISOString().slice(0, 10) !== p.financeStartDate) throw new Error('financeStartDate harus berupa YYYY-MM-DD yang valid.');
    return p;
}

async function runtimeFiles(root, dir) {
    const files = [];
    for (const entry of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
        const relative = path.posix.join(dir, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Symlink tidak didukung: ${relative}`);
        if (entry.isDirectory()) files.push(...await runtimeFiles(root, relative));
        else if (/\.(?:js|mjs)$/.test(entry.name) && !/\.(?:test|spec|min)\./.test(entry.name)) files.push(relative);
    }
    return files;
}

export async function prepareSchool({ root = ROOT, profile, apply = false } = {}) {
    const p = validate(profile);
    root = await fs.realpath(root);
    const pending = new Map();
    const read = async file => {
        const absolute = path.join(root, file), real = await fs.realpath(absolute);
        if (!real.startsWith(root + path.sep)) throw new Error(`Berkas di luar salinan proyek: ${file}`);
        return pending.get(file) ?? await fs.readFile(real, 'utf8');
    };
    const put = async (file, source) => { if (source !== await read(file)) pending.set(file, source); };
    const schoolSource = await read('js/school-config.js');
    const old = literalObject(schoolSource, 'SCHOOL_CONFIG');
    const configSource = await read('js/config.js');
    const oldFirebase = literalObject(configSource, 'firebaseConfig');
    const oldSupabase = literalObject(configSource, 'SUPABASE_CONFIG');
    const oldWorker = variable(configSource, 'workerPrimaryUrl').value;
    const oldAppsScript = ['JURNAL_APPS_SCRIPT_URL', 'EKINERJA_APPS_SCRIPT_URL', 'STUDENT_DOCS_APPS_SCRIPT_URL'].map(name => {
        const node = variable(configSource, name);
        return node.type === 'LogicalExpression' ? node.right.value : node.value;
    });
    const aliases = p.hosting.aliasSites.flatMap(site => [`${site}.web.app`, `${site}.firebaseapp.com`]);
    const school = { ...p.school, canonicalAliasDomains: aliases, studentDocsAppsScriptUrl: p.appsScript.studentDocs, ekinerjaAppsScriptUrl: p.appsScript.ekinerja };
    for (const key of ['schoolAddressFull', 'schoolAddressShort', 'schoolStreetAddress']) school[key] ||= school.schoolAddress;
    // Penandatangan opsional harus diisi ulang, bukan mewarisi pejabat sekolah asal.
    for (const key of Object.keys(old).filter(key => /(?:Name|NIP)$/.test(key) && !['appName', 'schoolName', 'schoolShortName'].includes(key))) {
        school[key] ||= '-';
    }
    school.headmasterRank ||= '-';
    school.defaultSuratKeteranganNo ||= '-';
    school.schoolPhone ||= '-';
    school.schoolAccreditation ||= '-';
    await put('js/school-config.js', patchObject(schoolSource, 'SCHOOL_CONFIG', school));
    const pairs = [
        [oldWorker, p.cloudflare.workerUrl], [oldSupabase.url, p.supabase.url],
        [oldSupabase.anonKey, p.supabase.anonKey],
        ...oldAppsScript.map((value, i) => [value, [p.appsScript.jurnal, p.appsScript.ekinerja, p.appsScript.studentDocs][i]]),
        // projectId pendek juga dipakai sebagai ID internal lama. Ubah hanya konstanta
        // autentikasi, bukan cache, nama policy, atau nilai school_id pada tabel.
        ...Object.entries(oldFirebase).filter(([key]) => key !== 'projectId').map(([key, value]) => [value, p.firebase[key]]),
        ['SMAN 1 GEROKGAK', school.schoolName.toLocaleUpperCase('id-ID')],
        ['SMA NEGERI 1 ABANG', school.schoolName.toLocaleUpperCase('id-ID')],
        ['SMAN 1 ABANG', school.schoolName.toLocaleUpperCase('id-ID')],
        ['SMAN 1 Abang', school.schoolName],
        ['Abang,', `${school.schoolCity},`],
        ['Jl. Ida Ketut Jelantik, Desa Tista, Kec. Abang, Kab. Karangasem, Bali 80852', `${school.schoolAddress} ${school.schoolPostalCode}`],
        ['SHAKTI', school.schoolVisiAcronym], ['SMAGESA', school.schoolShortName],
        ['BALI', school.schoolProvince.toLocaleUpperCase('id-ID')],
        ...(school.appName ? [['SIMAS', school.appName]] : []),
        ['50103640', school.schoolNPSN], ['50103632', school.schoolNPSN],
        ...Object.entries(old).filter(([key, value]) => typeof value === 'string' && value.length > 3
            && /^(?:school(?:Name|ShortName|NPSN|Address.*|Website|VisiAcronym|VisiDesc)|headmaster(?:Name|NIP)|emailDomain|telegramBotUser|primaryDomain)$/.test(key))
            .map(([key, value]) => [value, school[key]]),
        ['https://smagesa.firebaseapp.com', `https://${p.hosting.site}.firebaseapp.com`]
    ].filter(([, value]) => typeof value === 'string');
    const uiDirs = ['js', 'library', 'duta', 'pid', 'pub', 'sukaduka'];
    const files = (await Promise.all(uiDirs.map(dir => runtimeFiles(root, dir)))).flat();
    files.push('cloudflare/worker.js', ...await runtimeFiles(root, 'cloudflare/lib'),
        'supabase/functions/worker-gateway/handler.mjs', 'scripts/check-worker-gateway.mjs', 'push-worker.js');
    for (const file of files) {
        if (file === 'js/school-config.js') continue; // Pertahankan deteksi asal dan kompatibilitas template lama.
        await put(file, replaceStrings(await read(file), pairs));
    }
    await put('cloudflare/worker.js', patchVariable(await read('cloudflare/worker.js'), 'FIREBASE_PROJECT_ID', p.firebase.projectId));
    let config = await read('js/config.js');
    config = patchObject(config, 'firebaseConfig', p.firebase);
    config = patchObject(config, 'SUPABASE_CONFIG', p.supabase);
    for (const [name, value] of [['JURNAL_APPS_SCRIPT_URL', p.appsScript.jurnal], ['EKINERJA_APPS_SCRIPT_URL', p.appsScript.ekinerja], ['STUDENT_DOCS_APPS_SCRIPT_URL', p.appsScript.studentDocs], ['GA_ID', p.analyticsId || '']]) {
        config = patchVariable(config, name, value);
    }
    const date = variable(config, 'SYSTEM_START_DATE_SPP');
    const [y, m, d] = p.financeStartDate.split('-').map(Number);
    config = edits(config, [{ start: date.start, end: date.end, text: `new Date(${y}, ${m - 1}, ${d})` }]);
    await put('js/config.js', config);
    await put('cloudflare/lib/school-identity.js', patchObject(await read('cloudflare/lib/school-identity.js'), 'PUBLIC_SCHOOL_IDENTITY', {
        nama: school.schoolName, npsn: school.schoolNPSN, akreditasi: school.schoolAccreditation,
        alamat: `${school.schoolAddressFull} ${school.schoolPostalCode}`, website: school.schoolWebsite
    }));
    const origins = [...new Set([`https://${school.primaryDomain}`, `https://${p.firebase.authDomain}`,
        ...[p.hosting.site, p.hosting.stagingSite, ...p.hosting.aliasSites].filter(Boolean).flatMap(site => [`https://${site}.web.app`, `https://${site}.firebaseapp.com`])])];
    const corsSource = await read('cloudflare/lib/http.js');
    await put('cloudflare/lib/http.js', patchVariable(corsSource, 'ALLOWED_ORIGINS', [...origins, 'http://localhost:8080', 'http://127.0.0.1:8080', 'http://localhost:5000', 'http://127.0.0.1:5000', 'http://localhost:3000']));
    let gateway = await read('supabase/functions/worker-gateway/handler.mjs');
    const allowed = variable(gateway, 'ALLOWED_ORIGINS');
    gateway = edits(gateway, [{ start: allowed.start, end: allowed.end, text: `new Set(${JSON.stringify(origins)})` }]);
    await put('supabase/functions/worker-gateway/handler.mjs', gateway);
    let proxy = await read('supabase/functions/secure-proxy/index.ts');
    // Deno TypeScript: hanya nilai proyek dan URL layanan; tidak menyentuh aturan akses.
    proxy = proxy.replace(/const PROJECT_ID = "[^"]+";/, `const PROJECT_ID = ${JSON.stringify(p.firebase.projectId)};`)
        .split(oldWorker).join(p.cloudflare.workerUrl).split(oldSupabase.url).join(p.supabase.url);
    await put('supabase/functions/secure-proxy/index.ts', proxy);
    let wrangler = await read('cloudflare/wrangler.toml');
    const oldDatabaseName = wrangler.match(/^database_name\s*=\s*"([^"]+)"/m)?.[1];
    if (!oldDatabaseName) throw new Error('database_name tidak ditemukan di wrangler.toml.');
    for (const [key, value] of Object.entries({ name: p.cloudflare.workerName, database_name: p.cloudflare.databaseName,
        database_id: p.cloudflare.databaseId, FIREBASE_PROJECT_ID: p.firebase.projectId, PUBLIC_WORKER_URL: p.cloudflare.workerUrl,
        SUPABASE_URL: p.supabase.url, SUPABASE_ANON_KEY: p.supabase.anonKey })) {
        const re = new RegExp(`^${key}\\s*=\\s*"[^"]*"`, 'm');
        if (!re.test(wrangler)) throw new Error(`${key} tidak ditemukan di wrangler.toml.`);
        wrangler = wrangler.replace(re, () => `${key} = ${JSON.stringify(value)}`);
    }
    wrangler = wrangler.replace(/(binding\s*=\s*"STUDENT_PHOTOS_BUCKET"\s*\r?\nbucket_name\s*=\s*)"[^"]+"/, (_m, prefix) => prefix + JSON.stringify(p.cloudflare.studentPhotosBucket))
        .replace(/(binding\s*=\s*"GTK_PHOTOS_BUCKET"\s*\r?\nbucket_name\s*=\s*)"[^"]+"/, (_m, prefix) => prefix + JSON.stringify(p.cloudflare.gtkPhotosBucket));
    if (/^APP_BASE_URL\s*=\s*"[^"]*"/m.test(wrangler)) {
        wrangler = wrangler.replace(/^APP_BASE_URL\s*=\s*"[^"]*"/m, `APP_BASE_URL = ${JSON.stringify(`https://${school.primaryDomain}`)}`);
    }
    await put('cloudflare/wrangler.toml', wrangler);
    const firebase = JSON.parse(await read('firebase.json'));
    const template = firebase.hosting.find(item => item.public === 'dist-hosting');
    const hosting = [p.hosting.site, p.hosting.stagingSite].filter(Boolean).map(site => {
        const item = structuredClone(template);
        item.target = site;
        item.predeploy = [`node scripts/restore-hosting-history.mjs --site ${site}`, 'node scripts/build-hosting.mjs', 'node scripts/check-hosting-build.mjs'];
        for (const entry of item.headers) for (const header of entry.headers) {
            if (header.key === 'Content-Security-Policy') {
                header.value = header.value.split(oldWorker).join(p.cloudflare.workerUrl).split(oldSupabase.url).join(p.supabase.url)
                    .replace(/https:\/\/(?:smagesa|sman1abang)\.web\.app/g, `https://${school.primaryDomain}`);
                header.value = header.value.split(';').map(directive => {
                    const parts = directive.trim().split(/\s+/);
                    return ['frame-src', 'connect-src'].includes(parts[0]) ? [...new Set([...parts, ...origins])].join(' ') : directive;
                }).join(';');
            }
        }
        return item;
    });
    for (const site of p.hosting.aliasSites) hosting.push({ target: site, public: 'redirect-stub', ignore: ['firebase.json', '**/.*'], redirects: [
        { source: '/', destination: `https://${school.primaryDomain}/`, type: 301 },
        { source: '/:path*', destination: `https://${school.primaryDomain}/:path*`, type: 301 }
    ] });
    firebase.hosting = hosting;
    await put('firebase.json', json(firebase));
    await put('.firebaserc', json({ projects: { default: p.firebase.projectId }, targets: { [p.firebase.projectId]: { hosting: Object.fromEntries(hosting.map(item => [item.target, [item.target]])) } }, etags: {} }));
    await put('scripts/hosting-sites.json', json(Object.fromEntries([p.hosting.site, p.hosting.stagingSite].filter(Boolean).map(site => [site, `https://${site}.web.app`]))));
    const manifest = JSON.parse(await read('manifest.json'));
    const appName = school.appName || old.appName;
    Object.assign(manifest, { name: `${appName} - ${school.schoolVisiAcronym}`, short_name: `${appName} - ${school.schoolVisiAcronym}`,
        description: `Sistem Informasi Manajemen ${school.schoolShortName} ${school.schoolVisiAcronym} - ${school.schoolName}`,
        theme_color: school.appThemeColor || old.appThemeColor, background_color: school.appThemeColor || old.appThemeColor });
    await put('manifest.json', json(manifest));
    await put('redirect-stub/index.html', (await read('redirect-stub/index.html')).split('https://smagesa.web.app').join(`https://${school.primaryDomain}`));
    let workflow = await read('.github/workflows/deploy.yml');
    const deployTargets = [[p.hosting.site, ...p.hosting.aliasSites].map(site => `hosting:${site}`).join(','), `hosting:${p.hosting.stagingSite || p.hosting.site}`];
    let deployIndex = 0;
    workflow = workflow.split(oldDatabaseName).join(p.cloudflare.databaseName)
        .replace(/--only hosting:[^\s]+,firestore/g, () => `--only ${deployTargets[Math.min(deployIndex++, 1)]},firestore`)
        .replace(/secrets\.FIREBASE_SERVICE_ACCOUNT_SMAGESA/g, 'secrets.FIREBASE_SERVICE_ACCOUNT');
    if (!p.hosting.stagingSite) {
        workflow = workflow.replace(/^      - testing\r?\n/m, '')
            .replace(/^          else\r?\n            echo "🚀 Memulai deployment ke Firebase TESTING[\s\S]*?(?=^          fi\r?$)/m, '');
    }
    await put('.github/workflows/deploy.yml', workflow);
    // Salinan sekolah baru tidak boleh mewarisi kepercayaan paket Android sekolah asal.
    await put('.well-known/assetlinks.json', '[]\n');
    // Validasi seluruh perubahan sebelum satu pun berkas ditulis.
    for (const [file, source] of pending) if (/\.(?:js|mjs)$/.test(file)) parseJs(source);
    const changes = [...pending.keys()].sort();
    if (apply) for (const [file, source] of pending) await fs.writeFile(path.join(root, file), source);
    return { applied: apply, changes, notes: [
        'Ganti logo, kop, cap, tanda tangan, video logo, dan badge di assets/ dengan nama berkas yang sama.',
        'Layanan cloud, database, secrets, akun admin, dan data awal harus disiapkan tersendiri; perintah ini tidak deploy.',
        'Aturan WITA, jam kerja, jenjang SMA, dan kalender lokal tetap dipertahankan. Tinjau jika kondisi sekolah berbeda.',
        'Android opsional: siapkan package ID, signing key, dan assetlinks baru sebelum mengaktifkan workflow build-android.'
    ] };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    try {
        const args = process.argv.slice(2), configIndex = args.indexOf('--config');
        if (configIndex < 0 || !args[configIndex + 1] || args.some((arg, i) => !['--config', '--apply'].includes(arg) && i !== configIndex + 1)) {
            throw new Error('Pemakaian: npm run school:prepare -- --config school.local.json [--apply]. Tanpa --apply hanya menampilkan rencana.');
        }
        const profile = JSON.parse(await fs.readFile(path.resolve(args[configIndex + 1]), 'utf8'));
        console.log(json(await prepareSchool({ profile, apply: args.includes('--apply') })));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
