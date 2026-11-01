import { renderSafeMarkdown } from './utils.mjs';
import { createLmsHtmlStateScript } from './lms-html-state.mjs';

export const LMS_HTML_MAX_BYTES = 512 * 1024;
export const LMS_HTML_SANDBOX = 'allow-scripts';
export function getLmsMaterialInstructions(material) {
    const value = material?.instructions || (material?.resource_type === 'html' ? material.html_instructions : material?.content_description);
    return typeof value === 'string' ? value.trim() : '';
}
const policy = "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com https://cdn.tailwindcss.com; style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; img-src https: data: blob:; font-src https: data:; media-src https: data: blob:; connect-src 'none'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'none'; form-action 'none'";

export function validateLmsHtml(code) {
    if (typeof code !== 'string' || !code.trim()) throw new Error('Kode HTML wajib diisi atau diimpor dari file .html.');
    if (new TextEncoder().encode(code).byteLength > LMS_HTML_MAX_BYTES) throw new Error('Ukuran kode HTML maksimal 512 KB.');
    return code;
}

export function createLmsHtmlSrcdoc(code, stateConfig) {
    validateLmsHtml(code);
    // Policy precedes all author content, including scripts before an author's <head>.
    // The browser also applies the parent page's CSP to srcdoc.
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html{color-scheme:light}body{margin:0;overflow-wrap:break-word}img,video,canvas{max-width:100%}</style>${createLmsHtmlStateScript(stateConfig)}</head><body>${code}</body></html>`;
}

export function setLmsHtmlFrame(frame, code, title = 'Materi HTML interaktif', stateConfig) {
    const source = createLmsHtmlSrcdoc(code, stateConfig);
    frame.setAttribute('sandbox', LMS_HTML_SANDBOX);
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'");
    frame.title = title;
    frame.removeAttribute('src');
    frame.srcdoc = source;
    return frame;
}

export function mountLmsHtml(container, code, title, instructions = '', {collapsibleInstructions=false} = {}) {
    const frame = document.createElement('iframe');
    frame.className = 'w-full h-[65vh] min-h-[320px] border-0 rounded-lg bg-white';
    setLmsHtmlFrame(frame, code, title);
    container.replaceChildren();
    if (instructions.trim()) {
        const guide = document.createElement(collapsibleInstructions?'details':'section');
        if(collapsibleInstructions)guide.open=true;
        guide.className = 'lms-html-instructions p-3 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200';
        const label = document.createElement(collapsibleInstructions?'summary':'h4');
        label.className = 'font-bold mb-2';
        label.textContent = 'Petunjuk Belajar';
        const body = document.createElement('div');
        body.innerHTML = renderSafeMarkdown(instructions);
        guide.append(label, body);
        container.append(guide);
    }
    container.append(frame);
    return frame;
}

export function configureLmsHtmlEditor(card) {
    if (!card) return;
    const isHtml = card.querySelector('.lms-field-resource-type')?.value === 'html';
    card.querySelector('.lms-html-tools')?.classList.toggle('hidden', !isHtml);
    card.querySelector('.lms-html-actions')?.classList.toggle('hidden', !isHtml);
    card.querySelector('.lms-media-type-row')?.classList.toggle('is-html', isHtml);
    card.querySelector('.lms-container-resource-url')?.classList.toggle('hidden', isHtml);
    const label = card.querySelector('.lms-container-content-editor label');
    const input = card.querySelector('.lms-field-content');
    if (label) label.textContent = isHtml ? 'Petunjuk Belajar (Markdown, opsional)' : 'Petunjuk / Modul Teks (Markdown)';
    if (input) {
        input.rows = 3;
        input.spellcheck = true;
        if (isHtml) input.maxLength = 16000;
        else input.removeAttribute('maxlength');
        input.placeholder = isHtml ? 'Tuliskan tujuan belajar, langkah penggunaan materi interaktif, atau tugas yang perlu dikerjakan siswa...' : 'Tuliskan petunjuk belajar atau uraian materi... (Markdown: **tebal**, *miring*, # Judul, - list)';
    }
    // Stop a previous HTML preview when changing type; preserve all editor text.
    card.querySelector('.lms-content-preview')?.replaceChildren();
    card.querySelector('.lms-content-preview')?.classList.add('hidden');
    input?.classList.remove('hidden');
}

export async function importLmsHtmlFile(input, notify) {
    const file = input.files?.[0];
    if (!file) return;
    const card = input.closest('.lms-material-card');
    const editor = card?.querySelector('.lms-field-html');
    const previous = editor?.value;
    input.disabled = true;
    try {
        if (!/\.html?$/i.test(file.name)) throw new Error('Pilih file berformat .html atau .htm.');
        if (file.size > LMS_HTML_MAX_BYTES) throw new Error('Ukuran file HTML maksimal 512 KB.');
        const code = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('File HTML tidak dapat dibaca. Coba pilih kembali.'));
            reader.readAsText(file, 'UTF-8');
        });
        validateLmsHtml(code);
        if (!card?.isConnected || !editor) return;
        if (editor.value !== previous) throw new Error('Kode berubah saat file dibaca. Pilih kembali file jika ingin mengganti isian.');
        editor.value = code;
        const type = card.querySelector('.lms-field-resource-type');
        if (type) type.value = 'html';
        configureLmsHtmlEditor(card);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        const name = card.querySelector('.lms-html-file-name');
        if (name) name.textContent = file.name;
        notify('File HTML Dimuat', 'Kode sudah masuk ke editor. Klik Preview untuk mencobanya, lalu Simpan.', 'success');
    } catch (error) { notify('Impor HTML Gagal', error.message, 'error'); }
    finally { input.value = ''; input.disabled = false; }
}
