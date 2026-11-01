import { extractWordFile, extractPdfFile, QUIZ_DOCUMENT_MAX_BYTES } from './lms-quiz-documents.mjs';

export const QUIZ_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_QUESTIONS = 50;
const clean = value => String(value ?? '').trim();
const header = value => clean(value).toLowerCase().replace(/[\s_-]+/g, ' ');
const aliases = {
    type: ['tipe', 'jenis', 'tipe soal', 'jenis soal', 'type'],
    question: ['pertanyaan', 'soal', 'question'],
    points: ['bobot', 'poin', 'skor', 'points'],
    key: ['kunci', 'kunci jawaban', 'jawaban', 'correct answer'],
    accepted_answers: ['alternatif', 'alternatif jawaban', 'variasi', 'accepted answers'],
    grading_guidance: ['rubrik', 'pedoman', 'pedoman penilaian', 'grading guidance'],
    explanation: ['pembahasan', 'explanation'],
    image_url: ['gambar', 'url gambar', 'image url']
};
const types = new Map([
    ['pg', 'mc'], ['mc', 'mc'], ['pilihan ganda', 'mc'],
    ['isian', 'short'], ['isian singkat', 'short'], ['short', 'short'], ['short answer', 'short'],
    ['uraian', 'essay'], ['esai', 'essay'], ['essay', 'essay']
]);
const typeName = value => types.get(header(value));

function validateQuestions(rows) {
    if (!rows.length) throw new Error('Tidak ada soal yang ditemukan. Gunakan format pada template.');
    if (rows.length > MAX_QUESTIONS) throw new Error('Maksimal 50 soal per kuis. Pisahkan berkas menjadi beberapa kuis.');
    const warnings = [];
    const questions = rows.map((row, index) => {
        const fail = message => { throw new Error(`Soal ${index + 1}: ${message}`); };
        const text = (value, max, label) => {
            if (value !== undefined && value !== null && typeof value !== 'string' && typeof value !== 'number') fail(`${label} harus berupa teks.`);
            const result = clean(value);
            if (result.length > max) fail(`${label} maksimal ${max} karakter.`);
            return result;
        };
        if (!row || typeof row !== 'object' || Array.isArray(row)) fail('format soal tidak valid.');
        const type = typeName(row.type);
        if (!type) fail('tipe harus PG, Isian Singkat, atau Uraian.');
        const question = text(row.question, 10000, 'pertanyaan');
        if (!question) fail('pertanyaan belum diisi.');
        const points = clean(row.points) === '' ? 1 : Number(row.points);
        if (!Number.isFinite(points) || points < 1 || points > 100) fail('bobot harus 1–100.');
        const item = { type, question, points, explanation: text(row.explanation, 10000, 'pembahasan'), image_url: text(row.image_url, 2000, 'URL gambar') };
        if (item.image_url) {
            try { if (new URL(item.image_url).protocol !== 'https:') fail('URL gambar harus HTTPS.'); }
            catch (_) { fail('URL gambar harus HTTPS.'); }
        }
        if (type === 'mc') {
            if (!Array.isArray(row.options) || row.options.length < 2 || row.options.length > 5) fail('PG memerlukan 2–5 pilihan.');
            item.options = row.options.map(value => text(value, 2000, 'pilihan jawaban'));
            if (item.options.some(value => !value)) fail('pilihan jawaban tidak boleh kosong.');
            if (Number.isInteger(row.correct_option)) item.correct_option = row.correct_option;
            else if (clean(row.key)) {
                const key = clean(row.key).replace(/[.)]$/, '').toUpperCase();
                if (!/^[A-E]$/.test(key)) fail('kunci PG harus huruf A–E sesuai pilihan yang tersedia.');
                item.correct_option = key.charCodeAt(0) - 65;
            } else {
                item.correct_option = -1;
            }
            if (item.correct_option < -1 || item.correct_option >= item.options.length) fail('kunci PG tidak sesuai pilihan yang tersedia.');
            if (item.correct_option === -1) warnings.push(`Soal ${index + 1}: pilih kunci PG di editor sebelum menyimpan kuis.`);
        } else if (type === 'short') {
            item.correct_answer = text(row.correct_answer ?? row.key, 2000, 'kunci jawaban');
            const alternatives = Array.isArray(row.accepted_answers) ? row.accepted_answers : clean(row.accepted_answers).split(/\r?\n|\|/);
            item.accepted_answers = [...new Set([item.correct_answer, ...alternatives.map(value => text(value, 2000, 'alternatif jawaban'))].filter(Boolean))];
            if (item.accepted_answers.length > 30) fail('maksimal 30 alternatif jawaban.');
        } else {
            item.grading_guidance = text(row.grading_guidance || row.key, 10000, 'kunci/rubrik');
        }
        return item;
    });
    if (JSON.stringify({ questions }).length > 249000) throw new Error('Isi soal terlalu besar. Pisahkan menjadi beberapa kuis.');
    return { questions, warnings };
}

export function detectQuizFormat(source) {
    if (!source || typeof source !== 'string') return 'text';
    const trimmed = source.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed) || Array.isArray(parsed?.questions)) return 'json';
        } catch (_) {}
    }
    const firstLine = trimmed.split(/\r?\n/, 1)[0] || '';
    const delimiters = [',', ';', '\t'];
    for (const d of delimiters) {
        if (firstLine.includes(d)) {
            const cells = firstLine.split(d).map(header);
            const known = Object.values(aliases).flat().concat(['a', 'b', 'c', 'd', 'e', 'pilihan a', 'opsi a']);
            if (cells.some(c => known.includes(c))) return 'csv';
        }
    }
    return 'text';
}

export function parseQuizTable(table) {
    if (!Array.isArray(table) || !Array.isArray(table[0])) throw new Error('Tabel soal tidak valid.');
    const headings = table[0].map(header);
    const columns = Object.fromEntries(Object.entries(aliases).map(([field, names]) => [field, headings.findIndex(name => names.includes(name))]));
    if (columns.question < 0) throw new Error('Kolom Pertanyaan tidak ditemukan. Gunakan template impor soal.');
    const optionColumns = ['a', 'b', 'c', 'd', 'e'].map(letter => headings.findIndex(name => [letter, `pilihan ${letter}`, `opsi ${letter}`, `option ${letter}`].includes(name)));
    const rows = table.slice(1).filter(row => Array.isArray(row) && row.some(value => clean(value))).map(row => {
        const item = Object.fromEntries(Object.entries(columns).filter(([, index]) => index >= 0).map(([field, index]) => [field, row[index]]));
        item.options = optionColumns.map(index => index < 0 ? '' : clean(row[index]));
        while (item.options.length && !item.options.at(-1)) item.options.pop();
        item.type ||= item.options.length ? 'mc' : 'essay';
        return item;
    });
    return validateQuestions(rows);
}

export function parseQuizCsv(source) {
    source = String(source).replace(/^\uFEFF/, '');
    if (source.length > QUIZ_IMPORT_MAX_BYTES) throw new Error('Berkas maksimal 2 MB.');
    const firstLine = source.split(/\r?\n/, 1)[0];
    const delimiters = [',', ';', '\t'];
    const counts = delimiters.map(delimiter => {
        let quoted = false, count = 0;
        for (let i = 0; i < firstLine.length; i++) {
            if (firstLine[i] === '"') quoted = !quoted;
            else if (!quoted && firstLine[i] === delimiter) count++;
        }
        return count;
    });
    const delimiter = delimiters[counts.indexOf(Math.max(...counts))];
    const rows = [], row = [];
    let field = '', quoted = false, endedQuote = false;
    const pushField = () => { row.push(field); field = ''; endedQuote = false; };
    for (let i = 0; i < source.length; i++) {
        const char = source[i];
        if (quoted) {
            if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
            else if (char === '"') { quoted = false; endedQuote = true; }
            else field += char;
        } else if (char === delimiter) pushField();
        else if (char === '\n' || char === '\r') {
            if (char === '\r' && source[i + 1] === '\n') i++;
            pushField(); rows.push([...row]); row.length = 0;
        } else if (char === '"' && !field && !endedQuote) quoted = true;
        else if (char === '"' || (endedQuote && char.trim())) throw new Error('Format CSV tidak valid. Periksa tanda kutip pada berkas.');
        else if (!endedQuote) field += char;
    }
    if (quoted) throw new Error('Tanda kutip CSV belum ditutup.');
    if (field || row.length || endedQuote) { pushField(); rows.push([...row]); }
    return parseQuizTable(rows);
}

export function parseQuizText(source, defaultType = 'essay') {
    source = String(source).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (source.length > QUIZ_IMPORT_MAX_BYTES) throw new Error('Teks maksimal 2 MB.');
    const rows = [], ignored = [], keyEntries = [];
    let current = null, destination = 'question', option = -1;
    let keySection = false, sectionType = defaultType;
    const metadata = new Map(Object.entries(aliases).flatMap(([field, names]) => names.map(name => [name, field])));
    const lines = source.split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        if (/^\s*kunci(?:\s+jawaban)?\s*:?\s*$/i.test(line) && rows.length &&
            /^\s*\d{1,3}\s*[.):=-]?\s+[A-Ea-e]\s*$/.test(lines.slice(lineIndex + 1).find(value => value.trim()) || '')) { keySection = true; continue; }
        if (keySection) {
            if (!line.trim()) continue;
            const key = line.match(/^\s*(\d{1,3})\s*[.):=-]?\s+(.+)$/);
            if (!key) throw new Error('Daftar kunci terpisah harus memakai format 1. A, 2. B, dan seterusnya.');
            keyEntries.push({ number: key[1], key: key[2] });
            continue;
        }
        const heading = line.match(/^\s*(?:[A-C][.)]\s*)?(Pilihan Ganda|Isian Singkat|Uraian|Esai)\s*:?\s*$/i);
        if (heading) { sectionType = typeName(heading[1]); current = null; continue; }
        const numbered = line.match(/^\s*(?:soal\s+)?(\d{1,3})[.)]\s+(.+)$/i);
        if (numbered) {
            current = { number: numbered[1], question: numbered[2], options: [], defaultType: sectionType };
            const tagged = current.question.match(/^\[([^\]]+)\]\s*(.*)$/);
            if (tagged && typeName(tagged[1])) { current.type = typeName(tagged[1]); current.question = tagged[2]; }
            rows.push(current); destination = 'question'; option = -1;
            continue;
        }
        if (!current) { if (line.trim()) ignored.push(line); continue; }
        const property = line.match(/^\s*([^:]{1,30}):\s*(.*)$/);
        const field = property && metadata.get(header(property[1]));
        if (field && field !== 'question') {
            current[field] = property[2]; destination = field; option = -1; continue;
        }
        const choice = line.match(/^\s*([a-e])[.)]\s+(.+)$/i);
        if (choice && ['question', 'options', 'type', 'points', 'image_url'].includes(destination)) {
            const index = choice[1].toUpperCase().charCodeAt(0) - 65;
            if (index !== current.options.length) throw new Error(`Soal ${rows.length}: urutkan pilihan mulai A tanpa huruf yang terlewat atau berulang.`);
            current.options.push(choice[2]); destination = 'options'; option = index; continue;
        }
        if (destination === 'options') current.options[option] += '\n' + line;
        else current[destination] = (current[destination] || '') + '\n' + line;
    }
    if (!rows.length) throw new Error('Nomor soal belum dikenali. Awali setiap soal dengan 1. Pertanyaan, 2. Pertanyaan, dan seterusnya.');
    for (const entry of keyEntries) {
        const matching = rows.filter(row => row.number === entry.number);
        if (matching.length !== 1) throw new Error(`Kunci nomor ${entry.number} tidak memiliki satu nomor soal yang cocok.`);
        if (clean(matching[0].key) && clean(matching[0].key) !== clean(entry.key)) throw new Error(`Kunci nomor ${entry.number} ditulis lebih dari sekali dengan isi berbeda.`);
        matching[0].key = entry.key;
    }
    const result = validateQuestions(rows.map(row => {
        let detected = clean(row.type);
        if (!detected) {
            if (row.options.length) detected = 'mc';
            else if (clean(row.accepted_answers) || (clean(row.key) && clean(row.key).length <= 100 && !clean(row.grading_guidance))) detected = 'short';
            else detected = row.defaultType || defaultType || 'essay';
        }
        return { ...row, type: detected };
    }));
    if (ignored.length) result.warnings.unshift('Teks sebelum nomor soal pertama dianggap judul dan tidak diimpor.');
    return result;
}

export function parseQuizImport(source, { format = 'auto', defaultType = 'essay' } = {}) {
    if (!format || format === 'auto') {
        format = detectQuizFormat(source);
    }
    if (format === 'csv') return parseQuizCsv(source);
    if (format === 'json') {
        if (String(source).length > QUIZ_IMPORT_MAX_BYTES) throw new Error('Berkas maksimal 2 MB.');
        let parsed;
        try { parsed = JSON.parse(source); } catch (_) { throw new Error('Berkas JSON tidak valid.'); }
        const rows = Array.isArray(parsed) ? parsed : parsed?.questions;
        if (!Array.isArray(rows)) throw new Error('JSON harus berisi daftar soal atau objek questions.');
        return validateQuestions(rows);
    }
    return parseQuizText(source, defaultType);
}

export async function readQuizImportFile(file, { spreadsheet = globalThis.XLSX, zipLibrary, pdfLibrary } = {}) {
    if (!file || !file.size) throw new Error('Berkas soal kosong.');
    const extension = file.name.split('.').at(-1).toLowerCase();
    const document = ['docx', 'pdf'].includes(extension);
    const maxBytes = document ? QUIZ_DOCUMENT_MAX_BYTES : QUIZ_IMPORT_MAX_BYTES;
    if (file.size > maxBytes) throw new Error(`Berkas maksimal ${document ? 10 : 2} MB.`);
    if (document) {
        const extracted = extension === 'docx' ? await extractWordFile(file, zipLibrary) : await extractPdfFile(file, pdfLibrary);
        return { ...extracted, format: 'text', name: file.name };
    }
    if (extension === 'doc') throw new Error('Word format .doc lama belum didukung. Simpan sebagai .docx melalui Word, lalu impor kembali.');
    if (extension === 'xlsx') {
        if (!spreadsheet?.read) throw new Error('Pustaka Excel belum siap. Muat ulang halaman atau gunakan CSV/TXT.');
        const book = spreadsheet.read(await file.arrayBuffer(), { type: 'array', sheetRows: 53 });
        const sheet = book.Sheets[book.SheetNames[0]];
        if (!sheet) throw new Error('Lembar Excel pertama kosong.');
        if (sheet['!fullref'] && spreadsheet.utils.decode_range(sheet['!fullref']).e.r >= 53) throw new Error('Lembar Excel melebihi batas 50 soal. Pisahkan berkas menjadi beberapa kuis.');
        const table = spreadsheet.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
        return { result: parseQuizTable(table), name: file.name };
    }
    if (!['txt', 'csv', 'tsv', 'json'].includes(extension)) throw new Error('Gunakan berkas Word (.docx), PDF, Excel (.xlsx), CSV, TXT, atau JSON.');
    const text = await file.text();
    return { text, format: ['csv', 'tsv'].includes(extension) ? 'csv' : extension === 'json' ? 'json' : 'text', name: file.name };
}

export const QUIZ_TEXT_TEMPLATE = `1. [PG] Bagian tumbuhan yang menyerap air adalah ...
A. Daun
B. Akar
C. Bunga
D. Buah
Kunci: B
Bobot: 2
Pembahasan: Akar menyerap air dari tanah.

2. [Isian Singkat] Tuliskan nama gas hasil fotosintesis.
Kunci: Oksigen
Alternatif: O2 | oksigen
Bobot: 3

3. [Uraian] Mengapa tumbuhan membutuhkan cahaya matahari?
Bobot: 5
Rubrik:
`;

export const QUIZ_TABLE_TEMPLATE = [
    ['Tipe', 'Pertanyaan', 'Pilihan A', 'Pilihan B', 'Pilihan C', 'Pilihan D', 'Pilihan E', 'Kunci', 'Alternatif', 'Bobot', 'Rubrik', 'Pembahasan', 'URL Gambar'],
    ['PG', 'Bagian tumbuhan yang menyerap air adalah ...', 'Daun', 'Akar', 'Bunga', 'Buah', '', 'B', '', 2, '', 'Akar menyerap air dari tanah.', ''],
    ['Isian Singkat', 'Tuliskan nama gas hasil fotosintesis.', '', '', '', '', '', 'Oksigen', 'O2', 3, '', '', ''],
    ['Uraian', 'Mengapa tumbuhan membutuhkan cahaya matahari?', '', '', '', '', '', '', '', 5, '', '', '']
];

