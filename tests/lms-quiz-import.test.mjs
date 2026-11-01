/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { createRequire } from 'node:module';
import { parseQuizImport, detectQuizFormat, parseQuizTable, parseQuizCsv, parseQuizText, readQuizImportFile, QUIZ_TEXT_TEMPLATE, QUIZ_TABLE_TEMPLATE } from '../js/lms-quiz-import.mjs';
import { wordXmlToText, extractWordFile, extractPdfFile, pdfItemsToText, buildQuizWordTemplate } from '../js/lms-quiz-documents.mjs';
import { ensurePdfPromiseSupport } from '../js/lms-pdf-compat.mjs';
const require = createRequire(import.meta.url);
let Zip;
try {
    Zip = require('jszip');
} catch {
    Zip = require('../js/vendor/jszip.min.js');
}
const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml = paragraphs => `<w:document xmlns:w="${ns}"><w:body>${paragraphs}</w:body></w:document>`;
const p = (value, props = '') => `<w:p>${props}<w:r><w:t>${value}</w:t></w:r></w:p>`;
const file = (name, text) => ({ name, size: text.length, text: async () => text });

test('templates import mixed types, keys, alternatives, optional rubric and weights', () => {
    const text = parseQuizText(QUIZ_TEXT_TEMPLATE);
    const table = parseQuizTable(QUIZ_TABLE_TEMPLATE);
    for (const result of [text, table]) {
        expect(result.questions.map(q => q.type)).toEqual(['mc', 'short', 'essay']);
        expect(result.questions[0]).toMatchObject({ correct_option: 1, points: 2 });
        expect(result.questions[1]).toMatchObject({ correct_answer: 'Oksigen', points: 3 });
        expect(result.questions[1].accepted_answers).toContain('O2');
        expect(result.questions[2]).toMatchObject({ grading_guidance: '', points: 5 });
    }
});
test('numbered text retains multiline questions/options and supports a separate answer key', () => {
    const result = parseQuizText('Ulangan IPA\nPilihan Ganda\n1. Baca teks berikut.\nBaris kedua.\nBobot: 4\nA. Pilihan A\nlanjutan A\nB. Pilihan B\n\n2) Soal kedua\nA) Benar\nB) Salah\nKunci Jawaban\n1. B\n2. A');
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0]).toMatchObject({ question: 'Baca teks berikut.\nBaris kedua.', points: 4, options: ['Pilihan A\nlanjutan A', 'Pilihan B'], correct_option: 1 });
    expect(result.questions[1]).toMatchObject({ correct_option: 0 });
    expect(result.warnings).toHaveLength(1);
});
test('blank keys stay optional, unmarked text uses the chosen type, missing MC key is a draft warning', () => {
    expect(parseQuizText('1. Sebutkan pendapatmu\nKunci:\nBobot: 2', 'short').questions[0]).toMatchObject({ type: 'short', correct_answer: '', accepted_answers: [], points: 2 });
    expect(parseQuizText('1. [Uraian] Jelaskan\nRubrik: Konsep tepat\nContoh sesuai').questions[0].grading_guidance).toBe('Konsep tepat\nContoh sesuai');
    const mc = parseQuizText('1. Pilih\nA. Satu\nB. Dua');
    expect(mc.questions[0].correct_option).toBe(-1);
    expect(mc.warnings[0]).toContain('kunci PG');
});
test.each([',', ';', '\t'])('CSV supports %p separators, BOM, multiline quoted values and escaped quotes', delimiter => {
    const row = ['Isian Singkat', 'Apa "nama"\nproses ini?', '', '', '', '', '', 'Fotosintesis', 'proses fotosintesis|fotosintesis', 3, '', '', ''];
    const csv = '\uFEFF' + [QUIZ_TABLE_TEMPLATE[0], row].map(values => values.map(v => `"${String(v).replaceAll('"', '""')}"`).join(delimiter)).join('\r\n');
    expect(parseQuizCsv(csv).questions[0]).toMatchObject({ question: 'Apa "nama"\nproses ini?', correct_answer: 'Fotosintesis', points: 3, accepted_answers: ['Fotosintesis', 'proses fotosintesis', 'fotosintesis'] });
});
test.each([
    ['1. [PG] Soal\nA. A\nC. C', 'urutkan pilihan'],
    ['1. Soal\nA. A\nB. B\nKunci: E', 'kunci PG'],
    ['1. Soal\nBobot: 0', 'bobot'],
    ['1. Soal\nTipe: aneh', 'tipe'],
    ['1. Soal\nGambar: javascript:alert(1)', 'HTTPS'],
    ['Tanpa nomor soal', 'Nomor soal'],
    ['1. Soal\nA. A\nB. B\nKunci Jawaban\n3. A', 'nomor 3']
])('invalid text fails completely: %s', (source, message) => expect(() => parseQuizText(source)).toThrow(message));
test('invalid JSON, incomplete CSV and more than 50 questions are rejected', () => {
    expect(() => parseQuizImport('{', { format: 'json' })).toThrow('JSON');
    expect(() => parseQuizCsv('Pertanyaan\n"belum selesai')).toThrow('kutip');
    expect(() => parseQuizTable([['Judul'], ['Soal']])).toThrow('Pertanyaan');
    expect(() => parseQuizText(Array.from({ length: 51 }, (_, i) => `${i + 1}. Soal`).join('\n'))).toThrow('50 soal');
    expect(() => parseQuizImport(JSON.stringify([{ id: 'same', type: 'essay', question: 'Soal' }]), { format: 'json' }).questions[0]).not.toThrow();
    expect(parseQuizImport(JSON.stringify([{ id: 'same', type: 'essay', question: 'Soal' }]), { format: 'json' }).questions[0]).not.toHaveProperty('id');
});
test('file reading validates extension and size, and uses the first Excel worksheet', async () => {
    expect(await readQuizImportFile(file('soal.txt', QUIZ_TEXT_TEMPLATE))).toMatchObject({ format: 'text', text: QUIZ_TEXT_TEMPLATE });
    await expect(readQuizImportFile(file('soal.doc', 'old'))).rejects.toThrow('.docx');
    await expect(readQuizImportFile({ name: 'soal.txt', size: 3 * 1024 * 1024 })).rejects.toThrow('2 MB');
    await expect(readQuizImportFile({ name: 'soal.pdf', size: 11 * 1024 * 1024 })).rejects.toThrow('10 MB');
    await expect(readQuizImportFile(file('soal.exe', '123'))).rejects.toThrow('Gunakan berkas');
    const spreadsheet = { read: jest.fn(() => ({ SheetNames: ['Soal', 'Lainnya'], Sheets: { Soal: { ref: 'first' } } })), utils: { sheet_to_json: jest.fn(() => QUIZ_TABLE_TEMPLATE) } };
    const result = await readQuizImportFile({ name: 'soal.xlsx', size: 10, arrayBuffer: async () => new ArrayBuffer(10) }, { spreadsheet });
    expect(result.result.questions).toHaveLength(3);
    expect(spreadsheet.utils.sheet_to_json.mock.calls[0][0]).toEqual({ ref: 'first' });
    spreadsheet.read.mockReturnValue({ SheetNames: ['Soal'], Sheets: { Soal: { '!fullref': 'A1:M200' } } });
    spreadsheet.utils.decode_range = () => ({ e: { r: 199 } });
    await expect(readQuizImportFile({ name: 'soal.xlsx', size: 10, arrayBuffer: async () => new ArrayBuffer(10) }, { spreadsheet })).rejects.toThrow('50 soal');
});
test('Word XML preserves automatic question and option numbering including inherited styles', async () => {
    const numbering = `<w:numbering xmlns:w="${ns}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
    const styles = `<w:styles xmlns:w="${ns}"><w:style w:styleId="Base"><w:pPr><w:numPr><w:numId w:val="7"/></w:numPr></w:pPr></w:style><w:style w:styleId="Question"><w:basedOn w:val="Base"/></w:style></w:styles>`;
    const question = '<w:pPr><w:pStyle w:val="Question"/></w:pPr>';
    const option = '<w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="7"/></w:numPr></w:pPr>';
    const source = xml(p('Pilih jawaban', question) + p('Satu', option) + p('Dua', option) + p('Kunci: B') + p('[Uraian] Jelaskan alasanmu', question));
    const archive = new Zip();
    archive.file('word/document.xml', source); archive.file('word/numbering.xml', numbering); archive.file('word/styles.xml', styles);
    const buffer = await archive.generateAsync({ type: 'uint8array' });
    const extracted = await extractWordFile({ arrayBuffer: async () => buffer.buffer }, Zip);
    expect(extracted.text).toContain('1. Pilih jawaban\nA. Satu\nB. Dua');
    expect(extracted.text).toContain('2. [Uraian]');
    expect(parseQuizText(extracted.text).questions[0]).toMatchObject({ type: 'mc', correct_option: 1, options: ['Satu', 'Dua'] });
});
test('Word images are marked, deleted text is ignored, document HTML is never rendered', () => {
    const result = wordXmlToText(xml('<w:p><w:r><w:t>1. &lt;img src=x onerror=alert(1)&gt;</w:t><w:drawing/></w:r><w:del><w:r><w:t>Dihapus</w:t></w:r></w:del></w:p>'));
    expect(result.text).toContain('<img src=x');
    expect(result.text).not.toContain('Dihapus');
    expect(result.text).toContain('[Gambar/objek');
    expect(result.warnings).toHaveLength(1);
    expect(document.querySelector('img')).toBeNull();
});
test('the downloadable Word template is a valid DOCX archive that round-trips through the importer', async () => {
    const bytes = await buildQuizWordTemplate(QUIZ_TEXT_TEMPLATE, Zip);
    const archive = await Zip.loadAsync(bytes);
    expect(archive.file('[Content_Types].xml')).not.toBeNull();
    expect(archive.file('_rels/.rels')).not.toBeNull();
    const extracted = await extractWordFile({ arrayBuffer: async () => bytes.buffer }, Zip);
    expect(parseQuizText(extracted.text).questions).toEqual(parseQuizText(QUIZ_TEXT_TEMPLATE).questions);
});
test('PDF text combines text fragments in a line and preserves line breaks', () => {
    expect(pdfItemsToText([{ str: '1.', transform: [1, 0, 0, 1, 10, 100] }, { str: 'Soal', transform: [1, 0, 0, 1, 30, 100], hasEOL: true }, { str: '2. Soal lain', transform: [1, 0, 0, 1, 10, 80] }])).toBe('1. Soal\n2. Soal lain');
});
test('PDF reading returns numbered text, cleans up and rejects scan pages or password protection', async () => {
    const cleanup = jest.fn(), destroy = jest.fn();
    const page = { getTextContent: jest.fn(async () => ({ items: [{ str: '1. Jelaskan alasanmu', hasEOL: true }] })), cleanup };
    const pdf = { getDocument: jest.fn(() => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => page }), destroy })) };
    const input = { arrayBuffer: async () => new ArrayBuffer(10) };
    expect((await extractPdfFile(input, pdf)).text).toBe('1. Jelaskan alasanmu');
    expect(pdf.getDocument.mock.calls[0][0].isEvalSupported).toBe(false);
    expect(cleanup).toHaveBeenCalled(); expect(destroy).toHaveBeenCalled();
    page.getTextContent.mockResolvedValue({ items: [] });
    await expect(extractPdfFile(input, pdf)).rejects.toThrow('OCR');
    pdf.getDocument.mockReturnValue({ promise: Promise.reject(Object.assign(new Error('password'), { name: 'PasswordException' })), destroy });
    await expect(extractPdfFile(input, pdf)).rejects.toThrow('sandi');
});
test('older browsers receive working PDF promise capabilities and existing browser implementations remain intact', async () => {
    const original = Object.getOwnPropertyDescriptor(Promise, 'withResolvers');
    try {
        delete Promise.withResolvers;
        ensurePdfPromiseSupport();
        const resolve = Promise.withResolvers(); resolve.resolve('PDF siap');
        await expect(resolve.promise).resolves.toBe('PDF siap');
        const reject = Promise.withResolvers(); reject.reject(new Error('PDF rusak'));
        await expect(reject.promise).rejects.toThrow('PDF rusak');
        const implementation = Promise.withResolvers;
        ensurePdfPromiseSupport();
        expect(Promise.withResolvers).toBe(implementation);
    } finally {
        if (original) Object.defineProperty(Promise, 'withResolvers', original);
        else delete Promise.withResolvers;
    }
});
test('PDF streams work without ReadableStream async iterators on older browsers', async () => {
    const reader = { read: jest.fn().mockResolvedValueOnce({ value: { items: [{ str: '1. Soal pertama' }] }, done: false }).mockResolvedValueOnce({ done: true }), releaseLock: jest.fn() };
    const page = { streamTextContent: () => ({ getReader: () => reader }), cleanup: jest.fn() };
    const pdf = { getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => page }), destroy: jest.fn() }) };
    expect((await extractPdfFile({ arrayBuffer: async () => new ArrayBuffer(10) }, pdf)).text).toBe('1. Soal pertama');
    expect(reader.releaseLock).toHaveBeenCalled();
});

test('auto-detect format correctly identifies JSON, CSV, and text', () => {
    expect(detectQuizFormat('{"questions": []}')).toBe('json');
    expect(detectQuizFormat('[{"type": "mc", "question": "Q"}]')).toBe('json');
    expect(detectQuizFormat('Tipe,Pertanyaan,Pilihan A,Pilihan B\nPG,Soal,A,B')).toBe('csv');
    expect(detectQuizFormat('1. Soal biasa\nA. Pilihan 1\nB. Pilihan 2')).toBe('text');
});

test('auto-detect question type without explicit tags identifies MC, short answer, and essay', () => {
    const rawText = `1. Soal dengan pilihan
A. Pilihan A
B. Pilihan B
C. Pilihan C
D. Pilihan D
E. Pilihan E
Kunci: B

2. Sebutkan ibukota Indonesia!
Kunci: Jakarta
Alternatif: DKI Jakarta | Ibu Kota Nusantara

3. Jelaskan proses terjadinya hujan siklonal!
Bobot: 5
Rubrik: Penjelasan tahapan proses penguapan dan pendinginan udara.
`;

    const result = parseQuizImport(rawText);
    expect(result.questions).toHaveLength(3);
    expect(result.questions[0].type).toBe('mc');
    expect(result.questions[0].options).toHaveLength(5);
    expect(result.questions[0].correct_option).toBe(1);

    expect(result.questions[1].type).toBe('short');
    expect(result.questions[1].correct_answer).toBe('Jakarta');
    expect(result.questions[1].accepted_answers).toContain('DKI Jakarta');

    expect(result.questions[2].type).toBe('essay');
    expect(result.questions[2].grading_guidance).toContain('Penjelasan tahapan');
});
