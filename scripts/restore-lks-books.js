/**
 * scripts/restore-lks-books.js
 * Membaca assets/Jadwal.xml, mengekstrak master buku & pemetaan guru,
 * lalu mengunggahnya ke Cloudflare D1 SQL system_settings (book_sales_lks_data)
 * dengan mempertahankan vendor yang ada (["Abidin"]).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const xmlPath = path.resolve(__dirname, '../assets/Jadwal.xml');
const codePath = path.resolve(__dirname, '../js/page-penjualan-buku.js');

if (!fs.existsSync(xmlPath)) {
    console.error('File Jadwal.xml tidak ditemukan di:', xmlPath);
    process.exit(1);
}

const xmlContent = fs.readFileSync(xmlPath, 'utf8');
const rawCode = fs.readFileSync(codePath, 'utf8');

// Siapkan sandbox VM
const sandbox = {
    window: {
        escapeHTML: (str) => str || '',
        formatRupiah: (amt) => 'Rp ' + Number(amt || 0).toLocaleString('id-ID'),
        showToast: () => {},
        confirm: () => true
    },
    confirm: () => true,
    escapeHTML: (str) => str || '',
    formatRupiah: (amt) => 'Rp ' + Number(amt || 0).toLocaleString('id-ID'),
    showToast: () => {},
    cfClient: { enabled: false },
    auth: {},
    onAuthStateChanged: () => () => {},
    initLayout: () => Promise.resolve(),
    localStorage: {
        _store: {},
        getItem(k) { return this._store[k] || null; },
        setItem(k, v) { this._store[k] = String(v); },
        removeItem(k) { delete this._store[k]; },
        clear() { this._store = {}; }
    },
    document: {
        addEventListener: () => {},
        getElementById: () => null,
        querySelector: () => null
    },
    setTimeout,
    clearTimeout,
    console
};

const cleanCode = rawCode
    .replace(/^import\s+[^;]+;?/gm, '')
    .replace(/export\s+(const|let|var|function\*?|class|async\s+function\*?)\s+/gm, '$1 ');

vm.createContext(sandbox);
vm.runInContext(cleanCode, sandbox);

// Parsing Jadwal.xml
const subjectsMap = new Map();
const subRegex = /<subject id="([^"]+)" name="([^"]+)"/g;
let m;
while ((m = subRegex.exec(xmlContent)) !== null) {
    subjectsMap.set(m[1], { id: m[1], name: m[2] });
}

const teachersMap = new Map();
const teachRegex = /<teacher id="([^"]+)"[^>]*name="([^"]+)"/g;
while ((m = teachRegex.exec(xmlContent)) !== null) {
    teachersMap.set(m[1], { id: m[1], name: m[2], simasName: m[2] });
}

const classesMap = new Map();
const classRegex = /<class id="([^"]+)" name="([^"]+)"/g;
while ((m = classRegex.exec(xmlContent)) !== null) {
    classesMap.set(m[1], { id: m[1], name: m[2] });
}

const lessonsMap = new Map();
const lessonRegex = /<lesson\s+([^>]+)>/g;
while ((m = lessonRegex.exec(xmlContent)) !== null) {
    const attrs = m[1];
    const idM = attrs.match(/id="([^"]+)"/);
    const subM = attrs.match(/subjectid="([^"]+)"/);
    const teachM = attrs.match(/teacherids="([^"]*)"/);
    const classM = attrs.match(/classids="([^"]*)"/);

    if (idM && subM) {
        lessonsMap.set(idM[1], {
            id: idM[1],
            subjectId: subM[1],
            teacherIds: teachM ? teachM[1].split(',').filter(Boolean) : [],
            classIds: classM ? classM[1].split(',').filter(Boolean) : []
        });
    }
}

const parsedSchedule = {
    subjectsMap,
    teachersMap,
    classesMap,
    lessonsMap
};

const schedMap = sandbox.buildScheduleGradeMap(parsedSchedule);
const books = [];
const excluded = new Set(['upacara', 'ekstrakurikuler', 'bimbingan dan konseling']);

[10, 11, 12].forEach(grade => {
    const gradeSubs = schedMap[grade] || {};
    for (const subName of Object.keys(gradeSubs)) {
        if (excluded.has(subName.toLowerCase())) continue;

        const teachers = sandbox.findTeachersForBookSales(grade, subName, schedMap, 0, 0);
        const teacherNamesStr = teachers.length > 0
            ? teachers.map(t => `${t.teacher} (${t.classCount}/${t.totalClasses} kls - ${t.percentageStr}: ${t.propTerjual} eks / ${sandbox.formatRupiah(t.propNominal)})`).join('; ')
            : 'Belum terpetakan di Jadwal XML';

        books.push({
            grade,
            subject: subName,
            terima: 0,
            diam: 0,
            sisa: 0,
            terjual: 0,
            harga: 17000,
            total: 0,
            teachers,
            teacherNamesStr
        });
    }
});

books.sort((a, b) => a.grade - b.grade || a.subject.localeCompare(b.subject));
console.log(`Berhasil mengekstrak ${books.length} buku dari Jadwal XML.`);

// Siapkan payload dengan vendor "Abidin"
const payload = {
    books,
    transactions: [],
    circulations: [],
    vendors: ['Abidin'],
    cashFlows: [],
    updatedAt: new Date().toISOString()
};

// Tulis JSON sementara untuk dieksekusi wrangler
const tempJsonPath = path.resolve(__dirname, '../temp_restore_books.json');
fs.writeFileSync(tempJsonPath, JSON.stringify(payload), 'utf8');

console.log('Menyiapkan query D1 update...');
const escapedJson = JSON.stringify(payload).replace(/'/g, "''");
const sql = `INSERT INTO system_settings (key, value, updated_at) VALUES ('book_sales_lks_data', '${escapedJson}', CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;`;

const tempSqlPath = path.resolve(__dirname, '../temp_restore_books.sql');
fs.writeFileSync(tempSqlPath, sql, 'utf8');

console.log('Menjalankan migrasi remote D1 via wrangler...');
try {
    const output = execSync('npx wrangler d1 execute simas-smagesa-db --remote --file temp_restore_books.sql', { encoding: 'utf8' });
    console.log(output);
    console.log('SUKSES: Master buku berhasil dipulihkan ke Cloudflare D1!');
} catch (e) {
    console.error('Gagal menjalankan wrangler d1:', e.message);
    if (e.stdout) console.log(e.stdout.toString());
    if (e.stderr) console.error(e.stderr.toString());
    process.exit(1);
} finally {
    if (fs.existsSync(tempJsonPath)) fs.unlinkSync(tempJsonPath);
    if (fs.existsSync(tempSqlPath)) fs.unlinkSync(tempSqlPath);
}
