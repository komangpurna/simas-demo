/**
 * Jest setupFiles: fs.readFileSync('cloudflare/worker.js') mengembalikan sumber Worker datar
 * (worker.js + modul cloudflare/lib yang di-import), lihat tests/helpers/worker-source.cjs.
 * Tes baru sebaiknya memanggil buildFlatWorkerSource() secara langsung.
 */
const fs = require('node:fs');
const { buildFlatWorkerSource, isWorkerEntryPath, realReadFileSync } = require('./worker-source.cjs');

const PATCHED = Symbol.for('simas.flatWorkerReadFileSync');

if (!fs.readFileSync[PATCHED]) {
    const patched = function readFileSync(file, options) {
        if (!isWorkerEntryPath(file)) return realReadFileSync.apply(this, arguments);
        const source = buildFlatWorkerSource();
        const encoding = typeof options === 'string' ? options : options && options.encoding;
        return encoding ? source : Buffer.from(source, 'utf8');
    };
    patched[PATCHED] = true;
    fs.readFileSync = patched;
}
