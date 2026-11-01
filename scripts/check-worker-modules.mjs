/**
 * Pemeriksaan statis modul Cloudflare Worker (dijalankan sebelum tes unit dan sebelum deploy).
 *
 * Saat kode dipindah dari cloudflare/worker.js ke cloudflare/lib/*.js, kesalahan yang paling
 * mungkin terjadi baru muncul saat runtime (ReferenceError di produksi), misalnya:
 *   1. worker.js memakai fungsi yang sudah dipindah tetapi lupa di-import;
 *   2. modul baru memakai helper yang masih tinggal di worker.js;
 *   3. nama hasil import ditimpa (binding import bersifat read-only).
 * Skrip ini menangkap ketiganya, lalu membundel Worker dengan esbuild (mesin yang sama dengan
 * `wrangler deploy`) agar file/ekspor yang hilang langsung gagal di sini, bukan di Cloudflare.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import * as esbuild from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CF_DIR = path.join(ROOT, 'cloudflare');
const ENTRY = path.join(CF_DIR, 'worker.js');
const MODULE_DIRS = ['lib'].map(dir => path.join(CF_DIR, dir));

// Global runtime Cloudflare Workers yang tidak ada di Node.
const WORKER_ONLY_GLOBALS = ['caches', 'HTMLRewriter', 'WebSocketPair', 'scheduler', 'navigator'];
const KNOWN_GLOBALS = new Set([...Object.getOwnPropertyNames(globalThis), ...WORKER_ONLY_GLOBALS, 'undefined', 'arguments']);

function listModuleFiles() {
    const files = [];
    for (const dir of MODULE_DIRS) {
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir).sort()) {
            if (name.endsWith('.js')) files.push(path.join(dir, name));
        }
    }
    return files;
}

function addPatternNames(pattern, names) {
    if (!pattern) return;
    switch (pattern.type) {
        case 'Identifier': names.add(pattern.name); break;
        case 'ObjectPattern': pattern.properties.forEach(p => addPatternNames(p.type === 'RestElement' ? p.argument : p.value, names)); break;
        case 'ArrayPattern': pattern.elements.forEach(e => addPatternNames(e, names)); break;
        case 'RestElement': addPatternNames(pattern.argument, names); break;
        case 'AssignmentPattern': addPatternNames(pattern.left, names); break;
    }
}

/**
 * Analisis sengaja longgar: nama yang dideklarasikan di scope mana pun dalam file dianggap terdefinisi.
 * Cukup untuk menangkap helper yang hilang tanpa memerlukan analisis scope penuh.
 */
function analyze(file) {
    const source = fs.readFileSync(file, 'utf8');
    const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
    const declared = new Set();
    const imported = new Map(); // nama lokal -> sumber
    const references = new Map(); // nama -> baris pertama
    const reassignedImports = [];

    for (const node of ast.body) {
        if (node.type === 'ImportDeclaration') {
            node.specifiers.forEach(s => { declared.add(s.local.name); imported.set(s.local.name, node.source.value); });
        }
    }

    walk.full(ast, node => {
        switch (node.type) {
            case 'FunctionDeclaration':
            case 'FunctionExpression':
            case 'ArrowFunctionExpression':
                if (node.id) declared.add(node.id.name);
                node.params.forEach(p => addPatternNames(p, declared));
                break;
            case 'ClassDeclaration':
            case 'ClassExpression':
                if (node.id) declared.add(node.id.name);
                break;
            case 'VariableDeclarator': addPatternNames(node.id, declared); break;
            case 'CatchClause': addPatternNames(node.param, declared); break;
            case 'AssignmentExpression':
            case 'UpdateExpression': {
                const target = node.type === 'AssignmentExpression' ? node.left : node.argument;
                if (target.type === 'Identifier' && imported.has(target.name)) {
                    reassignedImports.push(`${target.name} (baris ${target.loc.start.line})`);
                }
                break;
            }
        }
    });

    walk.fullAncestor(ast, (node, _state, ancestors) => {
        if (node.type !== 'Identifier') return;
        const parent = ancestors[ancestors.length - 2];
        if (!parent) return;
        if ((parent.type === 'MemberExpression' && parent.property === node && !parent.computed)
            || ((parent.type === 'Property' || parent.type === 'PropertyDefinition' || parent.type === 'MethodDefinition')
                && parent.key === node && !parent.computed && !(parent.shorthand && parent.value === node))
            || ((parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') && parent.label === node)
            || parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier' || parent.type === 'ImportNamespaceSpecifier'
            || parent.type === 'ExportSpecifier' || parent.type === 'MetaProperty') {
            return;
        }
        if (!references.has(node.name)) references.set(node.name, node.loc.start.line);
    });

    const undefinedRefs = [...references]
        .filter(([name]) => !declared.has(name) && !KNOWN_GLOBALS.has(name))
        .map(([name, line]) => `${name} (baris ${line})`);
    return { undefinedRefs, reassignedImports };
}

const problems = [];
for (const file of [ENTRY, ...listModuleFiles()]) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    try {
        const { undefinedRefs, reassignedImports } = analyze(file);
        if (undefinedRefs.length) problems.push(`${rel}: identifier tidak terdefinisi/ tidak di-import -> ${undefinedRefs.join(', ')}`);
        if (reassignedImports.length) problems.push(`${rel}: binding import ditimpa (read-only di ES module) -> ${reassignedImports.join(', ')}`);
        if (file !== ENTRY && /^export\s+default\b/m.test(fs.readFileSync(file, 'utf8'))) {
            problems.push(`${rel}: modul pustaka tidak boleh memakai export default (pakai named export)`);
        }
    } catch (error) {
        problems.push(`${rel}: gagal di-parse -> ${error.message}`);
    }
}

try {
    await esbuild.build({ entryPoints: [ENTRY], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false, logLevel: 'silent' });
} catch (error) {
    const messages = (error.errors || []).map(e => `${e.location ? `${e.location.file}:${e.location.line} ` : ''}${e.text}`);
    problems.push(`Bundel esbuild gagal -> ${messages.join(' | ') || error.message}`);
}

if (problems.length) {
    console.error('❌ Pemeriksaan modul Worker gagal:');
    problems.forEach(p => console.error('   - ' + p));
    process.exit(1);
}
console.log(`✅ Modul Worker valid (${1 + listModuleFiles().length} file, bundel esbuild OK).`);
