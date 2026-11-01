/**
 * Sumber Worker "datar" untuk pengujian.
 *
 * cloudflare/worker.js sedang dipecah bertahap ke modul ES (cloudflare/lib/*.js). Produksi tetap
 * satu Worker karena `wrangler deploy` / scripts/deploy-worker-api.js membundel semua modul.
 * Banyak tes lama membaca worker.js sebagai teks atau menjalankannya utuh lewat vm.runInContext
 * (lalu menimpa fungsi seperti verifyFirebaseToken). buildFlatWorkerSource() menggabungkan modul
 * yang di-import worker.js (urutan dependensi, tanpa baris import/export) di depan isi worker.js,
 * sehingga tes-tes itu tetap melihat seluruh kode backend dalam satu skrip.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const WORKER_ENTRY = path.join(ROOT, 'cloudflare', 'worker.js');
// Hanya import relatif di awal baris (konvensi modul Worker). Contoh: import { a, b } from './lib/http.js';
const RELATIVE_IMPORT_RE = /^import\s+(?:[\s\S]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"];?[ \t]*(?:\r?\n)?/gm;

const realReadFileSync = fs.readFileSync;

function stripModuleExports(source, file) {
    if (/^export\s+default\b/m.test(source)) {
        throw new Error(`${path.relative(ROOT, file)}: modul pustaka Worker tidak boleh memakai export default`);
    }
    return source
        .replace(/^export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/gm, '')
        .replace(/^export\s*\{[^}]*\};?[ \t]*(?:\r?\n)?/gm, '');
}

function collectModule(file, seen, chunks) {
    const key = path.resolve(file).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const source = realReadFileSync(file, 'utf8');
    for (const match of source.matchAll(RELATIVE_IMPORT_RE)) {
        collectModule(path.resolve(path.dirname(file), match[1]), seen, chunks);
    }
    const body = source.replace(RELATIVE_IMPORT_RE, '');
    if (path.resolve(file) === path.resolve(WORKER_ENTRY)) {
        chunks.push(body);
    } else {
        const rel = path.relative(ROOT, file).replace(/\\/g, '/');
        chunks.push(`// ---- ${rel} ----\n${stripModuleExports(body, file)}\n// ---- akhir ${rel} ----\n`);
    }
}

function buildFlatWorkerSource() {
    const chunks = [];
    collectModule(WORKER_ENTRY, new Set(), chunks);
    return chunks.join('\n');
}

/**
 * Muat satu modul cloudflare/lib (beserta import relatifnya) di vm terisolasi dan kembalikan ekspornya.
 * Contoh: loadWorkerLibModule('lib/http.js').jsonResponse
 */
function loadWorkerLibModule(relPath, globals = {}) {
    const vm = require('node:vm');
    const file = path.join(ROOT, 'cloudflare', relPath);
    const exportNames = [...realReadFileSync(file, 'utf8').matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
    const chunks = [];
    collectModule(file, new Set([path.resolve(WORKER_ENTRY).toLowerCase()]), chunks);
    const context = vm.createContext({ Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, crypto: globalThis.crypto, console, ...globals });
    vm.runInContext(`${chunks.join('\n')}\n;globalThis.__exports = { ${exportNames.join(', ')} };`, context, { filename: file });
    return context.__exports;
}

function isWorkerEntryPath(file) {
    if (typeof file !== 'string' && !(file instanceof URL)) return false;
    const resolved = path.resolve(file instanceof URL ? file.pathname.replace(/^\/([A-Za-z]:)/, '$1') : file);
    const entry = path.resolve(WORKER_ENTRY);
    return process.platform === 'win32' ? resolved.toLowerCase() === entry.toLowerCase() : resolved === entry;
}

module.exports = { ROOT, WORKER_ENTRY, buildFlatWorkerSource, loadWorkerLibModule, isWorkerEntryPath, realReadFileSync };
