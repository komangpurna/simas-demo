import { ensurePdfPromiseSupport } from './lms-pdf-compat.mjs';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const QUIZ_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 2 * 1024 * 1024;
const children = (node, name) => [...(node?.children || [])].filter(child => child.namespaceURI === WORD_NS && child.localName === name);
const child = (node, name) => children(node, name)[0];
const attr = (node, name = 'val') => node?.getAttributeNS(WORD_NS, name) || '';
const descendants = (node, name) => [...(node?.getElementsByTagNameNS(WORD_NS, name) || [])];
function xml(source) {
    if (source.length > MAX_TEXT * 4) throw new Error('Isi dokumen Word terlalu besar.');
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    if (doc.querySelector('parsererror') || doc.doctype) throw new Error('Struktur dokumen Word tidak valid.');
    return doc;
}

export function wordXmlToText(documentXml, numberingXml = '', stylesXml = '') {
    const doc = xml(documentXml);
    const numbering = numberingXml ? xml(numberingXml) : null;
    const styles = stylesXml ? xml(stylesXml) : null;
    const definitions = new Map(descendants(numbering, 'abstractNum').map(node => [attr(node, 'abstractNumId'), node]));
    const numbers = new Map(descendants(numbering, 'num').map(node => [attr(node, 'numId'), node]));
    const styleMap = new Map(descendants(styles, 'style').map(node => [attr(node, 'styleId'), node]));
    const inheritedNumbering = (styleId, seen = new Set()) => {
        if (!styleId || seen.has(styleId)) return null;
        seen.add(styleId);
        const style = styleMap.get(styleId);
        return child(child(style, 'pPr'), 'numPr') || inheritedNumbering(attr(child(style, 'basedOn')), seen);
    };
    const counters = new Map();
    const paragraphs = descendants(child(doc.documentElement, 'body'), 'p');
    const warnings = [];
    let imageCount = 0;
    const lines = paragraphs.map(paragraph => {
        const props = child(paragraph, 'pPr');
        const styleNum = inheritedNumbering(attr(child(props, 'pStyle')));
        const num = child(props, 'numPr');
        const numId = attr(child(num, 'numId')) || attr(child(styleNum, 'numId'));
        const level = attr(child(num, 'ilvl')) || attr(child(styleNum, 'ilvl')) || '0';
        let prefix = '';
        if (numId && numId !== '0') {
            const number = numbers.get(numId);
            const definition = definitions.get(attr(child(number, 'abstractNumId')));
            const override = children(number, 'lvlOverride').find(node => attr(node, 'ilvl') === level);
            const config = child(override, 'lvl') || children(definition, 'lvl').find(node => attr(node, 'ilvl') === level);
            const format = attr(child(config, 'numFmt'));
            if (['decimal', 'decimalZero', 'upperLetter', 'lowerLetter'].includes(format)) {
                const key = `${numId}:${level}`;
                const start = Number(attr(child(override, 'startOverride')) || attr(child(config, 'start')) || 1);
                const count = (counters.get(key) ?? start - 1) + 1;
                counters.set(key, count);
                for (const stored of counters.keys()) if (stored.startsWith(`${numId}:`) && Number(stored.split(':')[1]) > Number(level)) counters.delete(stored);
                prefix = (format.includes('Letter') ? String.fromCharCode((format === 'upperLetter' ? 65 : 97) + (count - 1) % 26) : String(count)) + '. ';
            } else if (format && format !== 'bullet') warnings.push('Sebagian penomoran Word tidak dikenali. Periksa nomor soal pada naskah hasil baca.');
        }
        const textContent = node => {
            if (node.namespaceURI === WORD_NS && ['del', 'moveFrom', 'instrText'].includes(node.localName)) return '';
            if (node.namespaceURI === WORD_NS && node.localName === 't') return node.textContent;
            if (node.namespaceURI === WORD_NS && node.localName === 'tab') return '  ';
            if (node.namespaceURI === WORD_NS && ['br', 'cr'].includes(node.localName)) return '\n';
            if (node.namespaceURI === WORD_NS && ['drawing', 'pict', 'object'].includes(node.localName)) {
                imageCount++;
                return ' [Gambar/objek dokumen: tambahkan kembali di editor] ';
            }
            if (node.localName === 't' && node.namespaceURI?.includes('math')) return node.textContent;
            return [...node.childNodes].map(textContent).join('');
        };
        const value = textContent(paragraph).trim();
        return value ? prefix + value : '';
    });
    const text = lines.filter(Boolean).join('\n');
    if (!text.trim()) throw new Error('Dokumen Word tidak berisi teks soal yang dapat dibaca.');
    if (text.length > MAX_TEXT) throw new Error('Teks dokumen terlalu panjang. Pisahkan berkas menjadi beberapa kuis.');
    if (imageCount) warnings.push(`${imageCount} gambar/objek Word diberi penanda pada teks. Tambahkan gambar atau periksa rumusnya kembali di editor.`);
    return { text, warnings: [...new Set(warnings)] };
}

let zipLoading;
async function loadZip() {
    if (globalThis.JSZip) return globalThis.JSZip;
    zipLoading ||= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL('./vendor/jszip.min.js', import.meta.url).href;
        script.onload = () => globalThis.JSZip ? resolve(globalThis.JSZip) : reject(new Error('Pembaca Word belum siap. Muat ulang halaman.'));
        script.onerror = () => { script.remove(); reject(new Error('Pembaca Word gagal dimuat. Periksa koneksi dan coba lagi.')); };
        document.head.appendChild(script);
    }).catch(error => { zipLoading = null; throw error; });
    return zipLoading;
}

export async function extractWordFile(file, zipLibrary) {
    const Zip = zipLibrary || await loadZip();
    let archive;
    try { archive = await Zip.loadAsync(await file.arrayBuffer()); }
    catch (_) { throw new Error('Berkas Word tidak dapat dibaca. Gunakan .docx yang dapat dibuka tanpa sandi.'); }
    const read = async path => {
        const entry = archive.file(path);
        if (!entry) return '';
        const source = await entry.async('string');
        if (source.length > MAX_TEXT * 4) throw new Error('Isi dokumen Word terlalu besar.');
        return source;
    };
    const documentXml = await read('word/document.xml');
    if (!documentXml) throw new Error('Berkas ini bukan dokumen Word .docx yang valid.');
    const numberingXml = await read('word/numbering.xml');
    const stylesXml = await read('word/styles.xml');
    return wordXmlToText(documentXml, numberingXml, stylesXml);
}

export async function buildQuizWordTemplate(text, zipLibrary) {
    const Zip = zipLibrary || await loadZip();
    const zip = new Zip();
    const escape = value => value.replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character]));
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${WORD_NS}"><w:body>${text.split('\n').map(line => `<w:p><w:r><w:t xml:space="preserve">${escape(line)}</w:t></w:r></w:p>`).join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`);
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

let pdfLoading;
async function loadPdf() {
    ensurePdfPromiseSupport();
    pdfLoading ||= import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.min.mjs').then(library => {
        library.GlobalWorkerOptions.workerSrc = new URL('./lms-quiz-pdf-worker.mjs', import.meta.url).href;
        return library;
    }).catch(() => { pdfLoading = null; throw new Error('Pembaca PDF gagal dimuat. Periksa koneksi dan coba lagi.'); });
    return pdfLoading;
}

export function pdfItemsToText(items) {
    let text = '', previous = null;
    for (const item of items) {
        if (typeof item.str !== 'string') continue;
        if (previous && !text.endsWith('\n') && Math.abs((item.transform?.[5] || 0) - (previous.transform?.[5] || 0)) > 3) text += '\n';
        else if (text && !/\s$/.test(text) && item.str && !/^\s/.test(item.str)) text += ' ';
        text += item.str;
        if (item.hasEOL) text += '\n';
        if (item.str) previous = item;
    }
    return text.trim();
}

export async function extractPdfFile(file, pdfLibrary) {
    const pdf = pdfLibrary || await loadPdf();
    let task;
    try {
        task = pdf.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
        const document = await task.promise;
        if (document.numPages > 50) throw new Error('Maksimal 50 halaman PDF. Pisahkan berkas menjadi beberapa bagian.');
        const pages = [];
        let length = 0;
        for (let index = 1; index <= document.numPages; index++) {
            const page = await document.getPage(index);
            try {
                // Read the stream directly: older browsers support getReader() but not
                // ReadableStream's async iterator used by recent PDF.js getTextContent().
                let content;
                if (page.streamTextContent) {
                    const reader = page.streamTextContent().getReader();
                    content = { items: [] };
                    let extractedLength = 0;
                    try {
                        while (true) {
                            const { value, done } = await reader.read();
                            if (done) break;
                            for (const item of value.items) {
                                extractedLength += item.str?.length || 0;
                                if (extractedLength > MAX_TEXT) throw new Error('Teks PDF terlalu panjang. Pisahkan berkas menjadi beberapa kuis.');
                                content.items.push(item);
                            }
                        }
                    } finally { reader.releaseLock(); }
                } else content = await page.getTextContent();
                const text = pdfItemsToText(content.items);
                if (!text) throw new Error(`Halaman ${index} PDF tidak memiliki teks yang dapat dibaca. Untuk PDF hasil scan/foto, jalankan OCR terlebih dahulu atau gunakan Word asli.`);
                length += text.length;
                if (length > MAX_TEXT) throw new Error('Teks PDF terlalu panjang. Pisahkan berkas menjadi beberapa kuis.');
                pages.push(text);
            } finally { page.cleanup?.(); }
        }
        return { text: pages.join('\n'), warnings: ['Periksa kembali pemisahan soal, tabel, rumus, dan pilihan dari PDF. Gambar PDF perlu ditambahkan kembali di editor.'] };
    } catch (error) {
        if (error.name === 'PasswordException') throw new Error('PDF dilindungi sandi. Gunakan salinan PDF tanpa sandi.');
        if (error.name === 'InvalidPDFException') throw new Error('Berkas PDF rusak atau tidak valid. Coba ekspor ulang dari Word.');
        throw error;
    } finally { await task?.destroy?.(); }
}
