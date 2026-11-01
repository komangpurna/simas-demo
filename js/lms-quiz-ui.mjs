export function generateQuizPrompt({
    subject = '',
    gradeLevel = '',
    chapter = '',
    topic = '',
    difficulty = 'Sedang',
    mixDifficulty = false,
    pgCount = 5,
    shortCount = 0,
    essayCount = 0
} = {}) {
    const lines = [
        'Buatkan naskah soal evaluasi/kuis dengan rincian berikut:'
    ];
    if (subject.trim()) lines.push(`- Mata Pelajaran : ${subject.trim()}`);
    if (gradeLevel.trim()) lines.push(`- Jenjang / Kelas: ${gradeLevel.trim()}`);
    if (chapter.trim()) lines.push(`- Bab / Topik    : ${chapter.trim()}`);
    if (topic.trim()) lines.push(`- Materi Spesifik: ${topic.trim()}`);

    if (mixDifficulty) {
        lines.push('- Tingkat Kesulitan: Kombinasi campuran proporsional (Mudah ~30%, Sedang ~50%, Sulit/HOTS ~20%)');
    } else {
        lines.push(`- Tingkat Kesulitan: ${difficulty}`);
    }

    lines.push(
        '',
        'Ketentuan struktur soal yang WAJIB dipatuhi:',
        ...(pgCount > 0 ? [`- Sebanyak ${pgCount} soal Pilihan Ganda (PG). Setiap soal PG WAJIB memiliki tepat 5 pilihan jawaban (A, B, C, D, E) dan sertakan kunci jawaban huruf (misal: Kunci: B).`] : []),
        ...(shortCount > 0 ? [`- Sebanyak ${shortCount} soal Isian Singkat. Cantumkan kunci jawaban singkat dan alternatif variasinya jika ada (misal: Kunci: Oksigen, Alternatif: O2 | oksigen).`] : []),
        ...(essayCount > 0 ? [`- Sebanyak ${essayCount} soal Uraian / Esai. Cantumkan rubrik pedoman penilaian penskoran.`] : []),
        '- Jika ada simbol matematika, persamaan sains/fisika/kimia, akar, atau pecahan, WAJIB menggunakan format notasi LaTeX baku yang diapit tanda $...$ untuk inline (contoh: $E = mc^2$, $\\frac{a}{b}$, $\\sqrt{x}$) atau $...$ untuk baris terpisah.',
        '',
        'Format teks keluaran yang WAJIB diikuti untuk setiap butir soal:',
        '1. [PG] Teks pertanyaan soal pilihan ganda...',
        'A. Pilihan jawaban A',
        'B. Pilihan jawaban B',
        'C. Pilihan jawaban C',
        'D. Pilihan jawaban D',
        'E. Pilihan jawaban E',
        'Kunci: A',
        'Bobot: 2',
        'Pembahasan: Penjelasan singkat jawaban.',
        '',
        '2. [Isian Singkat] Teks pertanyaan isian singkat...',
        'Kunci: JawabanBenar',
        'Alternatif: JawabanBenar | variasi 2',
        'Bobot: 2',
        '',
        '3. [Uraian] Teks pertanyaan uraian/esai...',
        'Bobot: 5',
        'Rubrik: Konsep tepat 2 poin, penjabaran 2 poin, kesimpulan 1 poin.',
        '',
        'Harap langsung tampilkan naskah soal sesuai nomor dan format di atas tanpa kata pengantar atau penutup agar siap disalin langsung ke aplikasi.'
    );
    return lines.join('\n');
}

import { renderSafeMarkdown } from './utils.mjs';
import { openLmsMathPaletteModal } from './lms-math-palette.mjs';
import { parseQuizImport, readQuizImportFile, QUIZ_TEXT_TEMPLATE, QUIZ_TABLE_TEMPLATE } from './lms-quiz-import.mjs';
import { buildQuizWordTemplate } from './lms-quiz-documents.mjs';

export const quizEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fieldClass = 'w-full p-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm';
const buttonClass = 'px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800';
const primaryClass = 'px-4 py-2 rounded-lg bg-purple-600 text-white text-xs font-bold disabled:opacity-50';
const typeLabel = type => ({ mc: 'Pilihan ganda', short: 'Isian singkat', essay: 'Uraian' }[type] || type);
let quizIdCounter = 0;
const quizId = () => globalThis.crypto?.randomUUID?.() || `q_${Date.now().toString(36)}_${++quizIdCounter}`;
export function quizQuestionMarkup(q) {
    let image = '';
    try {
        if (q.image_url && new URL(q.image_url).protocol === 'https:') image = `<img src="${quizEscape(q.image_url)}" alt="Gambar pendukung soal" referrerpolicy="no-referrer" class="max-h-64 max-w-full object-contain rounded-lg my-3" loading="lazy">`;
    } catch (_) { /* Ignore invalid historic image URLs. */ }
    return `<div class="leading-relaxed break-words whitespace-pre-wrap">${renderSafeMarkdown(q.question || '')}</div>${image}`;
}
export function quizAnswerLabel(q, value) {
    if (value === '' || value === undefined || value === null) return 'Tidak dijawab';
    if (q.type === 'mc') return Number.isInteger(value) && q.options?.[value] !== undefined ? `${String.fromCharCode(65 + value)}. ${q.options[value]}` : 'Pilihan tidak valid';
    return String(value);
}
function quizDialog(id, title) {
    let modal = document.getElementById(id);
    if (!modal) {
        modal = document.createElement('div');
        modal.id = id;
        modal.className = 'fixed inset-0 z-[120] bg-slate-950/70 flex items-center justify-center p-3';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', title);
        modal.innerHTML = `<div class="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl"><div class="p-4 border-b dark:border-slate-700 flex justify-between items-center"><h3 class="font-bold">${quizEscape(title)}</h3><button type="button" data-close class="${buttonClass}" aria-label="Tutup">Tutup</button></div><div data-body class="p-4 overflow-y-auto space-y-4"></div></div>`;
        document.body.appendChild(modal);
        modal.querySelector('[data-close]').onclick = () => modal.remove();
    }
    return modal;
}


function formatViolationsList(log) {
    if (!log) return '';
    let items = [];
    if (typeof log === 'string') {
        try { items = JSON.parse(log); } catch (_) { items = []; }
    } else if (Array.isArray(log)) {
        items = log;
    }
    if (!items.length) return '';
    return `<details class="text-xs bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-lg border border-rose-200 dark:border-rose-800">
        <summary class="cursor-pointer font-semibold text-rose-800 dark:text-rose-300">Lihat Rekap Riwayat Pelanggaran (${items.length})</summary>
        <ul class="mt-2 space-y-1 list-disc pl-4 font-mono text-[11px] text-slate-700 dark:text-slate-300">
            ${items.map(l => `<li>${new Date(l.timestamp).toLocaleTimeString('id-ID')} — ${quizEscape(l.reason || 'Meninggalkan layar pengerjaan')} ${l.duration_seconds ? `(${l.duration_seconds} detik)` : ''}</li>`).join('')}
        </ul>
    </details>`;
}

export function installQuizBuilder({ notify, aiImport = null }) {
    const list = card => card?.querySelector('.lms-quiz-questions-list');
    window.openLmsQuizImport = card => {
        if (!list(card)) return;
        document.getElementById('lms-quiz-import')?.querySelector('[data-close]')?.click();

        // 1. Deteksi Mata Pelajaran dari filter
        const selectMapel = document.getElementById('select-mapel');
        let detectedMapel = selectMapel?.options?.[selectMapel.selectedIndex]?.text?.replace(/^--.*--$/, '')?.trim() || selectMapel?.value?.trim() || '';
        if (!detectedMapel || detectedMapel === '-- Mapel --') {
            const headerSub = card?.closest('#lms-module-editor')?.querySelector('.lm-header .lm-muted')?.textContent || '';
            if (headerSub.includes('·')) detectedMapel = headerSub.split('·')[1]?.trim() || '';
        }

        // 2. Deteksi Jenjang Kelas dari filter
        const selectKelas = document.getElementById('select-kelas');
        let rawKelas = selectKelas?.options?.[selectKelas.selectedIndex]?.text?.replace(/^--.*--$/, '')?.trim() || selectKelas?.value?.trim() || '';
        if (!rawKelas || rawKelas === '-- Kelas --') {
            const headerSub = card?.closest('#lms-module-editor')?.querySelector('.lm-header .lm-muted')?.textContent || '';
            if (headerSub.includes('·')) rawKelas = headerSub.split('·')[0]?.trim() || '';
        }
        let detectedGrade = '';
        if (/^X[- .]/i.test(rawKelas) || /\b(10|X)\b/i.test(rawKelas)) detectedGrade = `SMA Kelas 10${rawKelas ? ` (${rawKelas})` : ''}`;
        else if (/^XI[- .]/i.test(rawKelas) || /\b(11|XI)\b/i.test(rawKelas)) detectedGrade = `SMA Kelas 11${rawKelas ? ` (${rawKelas})` : ''}`;
        else if (/^XII[- .]/i.test(rawKelas) || /\b(12|XII)\b/i.test(rawKelas)) detectedGrade = `SMA Kelas 12${rawKelas ? ` (${rawKelas})` : ''}`;
        else if (rawKelas) detectedGrade = `Kelas ${rawKelas}`;

        // 3. Deteksi Judul Bab awal dari Topik Modul
        const editorModal = card?.closest('#lms-module-editor');
        const topicSelect = editorModal?.querySelector('[data-module="topic_id"]');
        const detectedChapter = topicSelect?.options?.[topicSelect.selectedIndex]?.text?.trim() || '';

        // 4. Deteksi Judul Materi awal dari Bahan Ajar
        const detectedMaterial = card?.querySelector('[data-field="title"]')?.value?.trim() || '';

        const modal = quizDialog('lms-quiz-import', 'Impor soal sekaligus');
        const body = modal.querySelector('[data-body]');
        body.innerHTML = `<div class="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Format &amp; tipe soal dikenali otomatis oleh sistem atau AI (maksimal 50 soal).</span>
            </div>
            <div class="border border-purple-200 dark:border-purple-800/60 bg-purple-50/40 dark:bg-purple-950/20 rounded-xl p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label class="flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 cursor-pointer select-none">
                    <input data-import-ai type="checkbox" disabled class="rounded text-purple-600 focus:ring-purple-500">
                    <span>Gunakan AI untuk merapikan soal &amp; simbol LaTeX</span>
                </label>
                <span data-import-ai-status role="status" class="text-[11px] font-medium text-purple-700 dark:text-purple-300 bg-purple-100/70 dark:bg-purple-900/50 px-2 py-0.5 rounded self-start sm:self-auto">Memeriksa API key...</span>
            </div>
            <div class="border border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-slate-50/50 dark:bg-slate-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div class="text-xs">
                    <span class="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5"><i class="fa-solid fa-file-arrow-up text-indigo-500"></i> Unggah Berkas Soal:</span>
                    <span class="text-[11px] text-slate-500 dark:text-slate-400 block sm:inline sm:ml-1">Word (.docx), PDF, Excel (.xlsx), CSV, TXT (maks. 10 MB)</span>
                </div>
                <input data-import-file type="file" accept=".docx,.pdf,.xlsx,.csv,.tsv,.txt,.json" class="text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 dark:file:bg-indigo-950 dark:file:text-indigo-300 hover:file:bg-indigo-100 cursor-pointer">
            </div>
            <p data-import-source class="text-[11px] text-slate-500" role="status">Word: .docx. AI membaca PDF scan. Excel: lembar pertama.</p>
            <details data-prompt-accordion class="border border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/40 dark:bg-indigo-950/20 rounded-xl p-2.5 text-xs">
                <summary class="cursor-pointer font-semibold text-indigo-700 dark:text-indigo-300 flex items-center justify-between select-none">
                    <span class="flex items-center gap-1.5"><i class="fa-solid fa-wand-magic-sparkles text-indigo-600 dark:text-indigo-400"></i> Template Prompt Pembuat Soal AI (Tinggal Salin &amp; Minta ke AI)</span>
                    <span class="text-[11px] text-indigo-500 font-normal">Buka / Tutup</span>
                </summary>
                <div class="mt-2.5 space-y-2.5 pt-2 border-t border-indigo-100 dark:border-indigo-900/60">
                    <p class="text-[11px] text-slate-600 dark:text-slate-400">Mapel &amp; Jenjang otomatis terisi dari filter. Atur Bab, Materi, dan kesulitan lalu salin prompt.</p>
                    <div class="grid sm:grid-cols-2 gap-2">
                        <label class="block text-[11px] font-semibold">Mata Pelajaran (Filter)
                            <input data-prompt-subject type="text" class="${fieldClass} mt-0.5 text-xs bg-slate-100/80 dark:bg-slate-800/80" value="${quizEscape(detectedMapel)}" placeholder="Nama Mata Pelajaran">
                        </label>
                        <label class="block text-[11px] font-semibold">Jenjang Kelas (Filter)
                            <input data-prompt-grade type="text" class="${fieldClass} mt-0.5 text-xs bg-slate-100/80 dark:bg-slate-800/80" value="${quizEscape(detectedGrade)}" placeholder="Jenjang / Kelas">
                        </label>
                    </div>
                    <div class="grid sm:grid-cols-2 gap-2">
                        <label class="block text-[11px] font-semibold">Judul Bab
                            <input data-prompt-chapter type="text" class="${fieldClass} mt-0.5 text-xs" value="${quizEscape(detectedChapter)}" placeholder="Misal: Bab 2 - Dinamika Gerak Lurus">
                        </label>
                        <label class="block text-[11px] font-semibold">Materi Pembelajaran
                            <input data-prompt-topic type="text" class="${fieldClass} mt-0.5 text-xs" value="${quizEscape(detectedMaterial)}" placeholder="Misal: Hukum II Newton &amp; Gaya Gesek">
                        </label>
                    </div>
                    <div class="bg-white dark:bg-slate-900/90 p-2 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1.5">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <label class="block text-[11px] font-semibold flex-1 min-w-[130px]">Tingkat Kesulitan
                                <select data-prompt-difficulty class="${fieldClass} mt-0.5 text-xs">
                                    <option value="Sedang" selected>Sedang</option>
                                    <option value="Mudah">Mudah</option>
                                    <option value="Sulit / HOTS">Sulit / HOTS</option>
                                </select>
                            </label>
                            <label class="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 cursor-pointer select-none pt-3 sm:pt-0">
                                <input data-prompt-mix-diff type="checkbox" class="rounded text-indigo-600 focus:ring-indigo-500">
                                <span>Campur kesulitan (Mudah 30%, Sedang 50%, Sulit 20%)</span>
                            </label>
                        </div>
                    </div>
                    <div class="grid grid-cols-3 gap-2">
                        <label class="block text-[11px] font-semibold">Jml PG (A–E)
                            <input data-prompt-pg type="number" min="0" max="50" value="5" class="${fieldClass} mt-0.5 text-xs">
                        </label>
                        <label class="block text-[11px] font-semibold">Jml Isian
                            <input data-prompt-short type="number" min="0" max="50" value="0" class="${fieldClass} mt-0.5 text-xs">
                        </label>
                        <label class="block text-[11px] font-semibold">Jml Uraian
                            <input data-prompt-essay type="number" min="0" max="50" value="0" class="${fieldClass} mt-0.5 text-xs">
                        </label>
                    </div>
                    <div>
                        <textarea data-prompt-output readonly rows="4" class="${fieldClass} text-[11px] font-mono bg-slate-50 dark:bg-slate-950/70 select-all"></textarea>
                        <div class="mt-1.5 flex items-center gap-2">
                            <button type="button" data-prompt-copy class="${buttonClass} bg-indigo-600 hover:bg-indigo-700 text-white border-transparent text-xs py-1 px-3">
                                Salin Prompt AI
                            </button>
                            <span data-prompt-copy-status class="text-xs text-emerald-600 dark:text-emerald-400 font-medium"></span>
                        </div>
                    </div>
                </div>
            </details>
            <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span>Tempel Naskah Soal (Internet / Dokumen / Hasil AI)</span>
                <textarea data-import-text rows="5" class="${fieldClass} mt-1 text-xs" placeholder="${quizEscape(QUIZ_TEXT_TEMPLATE)}"></textarea>
            </label>
            <p class="text-[11px] text-slate-500 -mt-1">Tempel naskah atau unggah berkas, lalu periksa draf soal sebelum ditambahkan.</p>
            <p data-import-error class="text-sm text-rose-600 dark:text-rose-400" role="alert"></p>
            <div data-import-preview-list class="space-y-3" aria-live="polite"></div>
            <div class="sticky bottom-0 flex flex-wrap gap-2 bg-white dark:bg-slate-900 py-3 border-t dark:border-slate-700"><button type="button" data-import-preview class="${buttonClass} disabled:opacity-50 disabled:cursor-not-allowed" disabled>Baca dan pratinjau</button><button type="button" data-import-cancel class="${buttonClass}" hidden>Batal proses</button><button type="button" data-import-apply class="${primaryClass}" disabled>Tambahkan ke kuis</button></div>`;
        const text = body.querySelector('[data-import-text]');
        const format = body.querySelector('[data-import-format]');
        const defaultType = body.querySelector('[data-import-default]');
        const fileInput = body.querySelector('[data-import-file]');
        const error = body.querySelector('[data-import-error]');
        const preview = body.querySelector('[data-import-preview-list]');
        const apply = body.querySelector('[data-import-apply]');
        const source = body.querySelector('[data-import-source]');
        const readButton = body.querySelector('[data-import-preview]');
        const cancelButton = body.querySelector('[data-import-cancel]');
        const aiToggle = body.querySelector('[data-import-ai]');
        const aiStatus = body.querySelector('[data-import-ai-status]');
        const aiCheck = body.querySelector('[data-import-ai-check]');
        const updatePromptOutput = () => {
            const subject = body.querySelector('[data-prompt-subject]')?.value || '';
            const gradeLevel = body.querySelector('[data-prompt-grade]')?.value || '';
            const chapter = body.querySelector('[data-prompt-chapter]')?.value || '';
            const topic = body.querySelector('[data-prompt-topic]')?.value || '';
            const diffSelect = body.querySelector('[data-prompt-difficulty]');
            const mixDiffCheckbox = body.querySelector('[data-prompt-mix-diff]');
            const mixDifficulty = Boolean(mixDiffCheckbox?.checked);
            if (diffSelect) {
                diffSelect.disabled = mixDifficulty;
                diffSelect.classList.toggle('opacity-50', mixDifficulty);
            }
            const difficulty = diffSelect?.value || 'Sedang';
            const pgCount = parseInt(body.querySelector('[data-prompt-pg]')?.value || '5', 10) || 0;
            const shortCount = parseInt(body.querySelector('[data-prompt-short]')?.value || '0', 10) || 0;
            const essayCount = parseInt(body.querySelector('[data-prompt-essay]')?.value || '0', 10) || 0;
            const output = body.querySelector('[data-prompt-output]');
            if (output) {
                output.value = generateQuizPrompt({
                    subject,
                    gradeLevel,
                    chapter,
                    topic,
                    difficulty,
                    mixDifficulty,
                    pgCount,
                    shortCount,
                    essayCount
                });
            }
        };
        body.querySelectorAll('[data-prompt-subject], [data-prompt-grade], [data-prompt-chapter], [data-prompt-topic], [data-prompt-difficulty], [data-prompt-pg], [data-prompt-short], [data-prompt-essay]').forEach(el => {
            el.addEventListener('input', updatePromptOutput);
        });
        body.querySelector('[data-prompt-mix-diff]')?.addEventListener('change', updatePromptOutput);
        updatePromptOutput();

        const promptCopyBtn = body.querySelector('[data-prompt-copy]');
        if (promptCopyBtn) {
            promptCopyBtn.onclick = async () => {
                const output = body.querySelector('[data-prompt-output]');
                if (!output?.value) return;
                try {
                    await navigator.clipboard.writeText(output.value);
                    const status = body.querySelector('[data-prompt-copy-status]');
                    if (status) {
                        status.textContent = 'Prompt tersalin! Tinggal tempel ke AI.';
                        setTimeout(() => { if (status) status.textContent = ''; }, 3500);
                    }
                    notify('Prompt Tersalin', 'Template prompt pembuatan soal AI berhasil disalin ke clipboard.', 'info');
                } catch (_) {
                    output.select();
                    document.execCommand?.('copy');
                    notify('Prompt Tersalin', 'Template prompt pembuatan soal AI berhasil disalin ke clipboard.', 'info');
                }
            };
        }
        let parsed = null, spreadsheetResult = null, loading = false, revision = 0, sourceWarnings = [];
        let aiAvailable = false, aiChecking = false, aiTouched = false, availabilityRevision = 0, activeController = null, selectedFile = null;
        const hasContent = () => Boolean(text.value?.trim() || selectedFile || spreadsheetResult);
        const updateActionState = () => {
            readButton.disabled = loading || !hasContent();
        };
        const invalidate = () => {
            activeController?.abort(); activeController = null;
            revision++;
            parsed = null; apply.disabled = true; preview.innerHTML = ''; error.textContent = '';
            apply.textContent = 'Tambahkan ke kuis';
            updateActionState();
        };
        const setBusy = busy => {
            loading = busy;
            text.disabled = fileInput.disabled = busy;
            readButton.disabled = busy || !hasContent();
            if (format) format.disabled = busy;
            if (defaultType) defaultType.disabled = busy;
            aiToggle.disabled = busy || !aiAvailable;
            if (format?.closest('label')) format.closest('label').hidden = aiToggle.checked;
            if (aiCheck) aiCheck.disabled = busy || aiChecking || !aiImport;
            cancelButton.hidden = !busy;
            readButton.textContent = busy ? 'Sedang membaca soal...' : aiToggle.checked ? 'Rapikan dengan AI' : 'Baca dan pratinjau';
        };
        const refreshAvailability = async () => {
            const version = ++availabilityRevision;
            aiChecking = true; if (aiCheck) aiCheck.disabled = true;
            try {
                const status = aiImport ? await aiImport.getAvailability() : { available: false, message: 'Impor biasa siap digunakan. Impor AI memakai API key tersimpan saat dibuka dari portal guru.' };
                if (!modal.isConnected || version !== availabilityRevision) return;
                const wasChecked = aiToggle.checked;
                aiAvailable = Boolean(status.available);
                aiToggle.checked = aiAvailable && (!aiTouched || wasChecked);
                aiStatus.textContent = status.message;
                if (parsed && !loading && wasChecked !== aiToggle.checked) invalidate();
            } catch (_) {
                if (modal.isConnected && version === availabilityRevision) { aiAvailable = false; aiToggle.checked = false; aiStatus.textContent = 'API key belum dapat diperiksa. Impor biasa tetap tersedia.'; }
            } finally {
                if (version === availabilityRevision) { aiChecking = false; setBusy(loading); }
            }
        };
        let availability = refreshAvailability();
        if (aiCheck) aiCheck.onclick = () => { if (!loading) availability = refreshAvailability(); };
        aiToggle.onchange = () => { aiTouched = true; invalidate(); setBusy(false); };
        const cancel = () => { invalidate(); setBusy(false); source.textContent = 'Proses dibatalkan. Naskah tetap tersedia di editor impor.'; };
        cancelButton.onclick = cancel;
        modal.querySelector('[data-close]').onclick = () => { invalidate(); availabilityRevision++; modal.remove(); };
        text.oninput = () => { invalidate(); selectedFile = null; spreadsheetResult = null; sourceWarnings = []; source.textContent = 'Sumber: naskah di editor impor.'; updateActionState(); };
        if (format) format.onchange = () => { invalidate(); }; if (defaultType) defaultType.onchange = () => { invalidate(); };
        updateActionState();
        const renderPreview = result => {
            result = { ...result, warnings: [...new Set([...sourceWarnings, ...result.warnings])] };
            parsed = result;
            const counts = result.questions.reduce((totals, q) => { totals[q.type] = (totals[q.type] || 0) + 1; return totals; }, {});
            preview.innerHTML = `<p class="font-bold">${result.questions.length} soal ditemukan · ${Object.entries(counts).map(([type, count]) => `${count} ${typeLabel(type)}`).join(' · ')}</p>${result.warnings.length ? `<ul class="list-disc pl-5 text-sm text-amber-800 dark:text-amber-300">${result.warnings.map(warning => `<li>${quizEscape(warning)}</li>`).join('')}</ul>` : ''}${result.questions.map((q, i) => `<article class="border dark:border-slate-700 rounded-xl p-3 space-y-2 break-words"><b>Soal ${i + 1} · ${typeLabel(q.type)} · ${q.points} poin</b>${quizQuestionMarkup(q)}${q.type === 'mc' ? q.options.map((option, index) => `<div class="text-sm">${String.fromCharCode(65 + index)}. ${renderSafeMarkdown(option)}${q.correct_option === index ? ' ✓' : ''}</div>`).join('') : ''}<p class="text-xs text-slate-500">${q.type === 'mc' ? `Kunci: ${q.correct_option < 0 ? 'lengkapi di editor' : String.fromCharCode(65 + q.correct_option)}` : q.type === 'short' ? `Kunci: ${quizEscape(q.correct_answer || q.accepted_answers.join(' / ') || 'kosong · diperiksa guru')}` : `Rubrik: ${quizEscape(q.grading_guidance || 'kosong · diperiksa guru')}`}</p></article>`).join('')}`;
            apply.textContent = `Tambahkan ${result.questions.length} soal ke kuis`;
            apply.disabled = false;
            if (aiToggle.checked) preview.scrollIntoView?.({ block: 'start' });
        };
        const emptyPlaceholder = () => {
            const items = [...list(card).children];
            if (items.length !== 1) return null;
            const item = items[0];
            const filled = [...item.querySelectorAll('input:not([type="number"]):not([type="radio"]), textarea')].some(input => input.value.trim());
            return !filled && !item.querySelector(':checked') && Number(item.querySelector('.lms-quiz-points')?.value) === 1 ? item : null;
        };
        const checkCapacity = result => {
            if (!card.isConnected) throw new Error('Editor kuis sudah ditutup. Buka kembali impor dari modul yang dituju.');
            const count = list(card).children.length - (emptyPlaceholder() ? 1 : 0);
            if (count + result.questions.length > 50) throw new Error(`Kuis sudah berisi ${count} soal. Impor ini akan melebihi batas 50 soal.`);
        };
        const previewWithAi = async () => {
            invalidate();
            const version = revision;
            const controller = new AbortController(); activeController = controller;
            setBusy(true);
            source.textContent = 'Merapikan naskah soal...';
            try {
                await availability;
                if (!modal.isConnected || version !== revision) return;
                const result = aiAvailable && aiToggle.checked
                    ? await aiImport.parse({ text: selectedFile ? '' : text.value, file: selectedFile, defaultType: defaultType?.value || 'essay', signal: controller.signal })
                    : spreadsheetResult || parseQuizImport(text.value, { format: format?.value || 'auto', defaultType: defaultType?.value || 'essay' });
                if (!modal.isConnected || version !== revision) return;
                checkCapacity(result); renderPreview(result);
                source.textContent = aiToggle.checked ? 'Draf hasil AI siap ditinjau. Periksa isi dan kunci sebelum menambahkan ke kuis.' : 'Naskah siap ditinjau.';
            } catch (err) {
                if (modal.isConnected && version === revision && err.name !== 'AbortError') { error.textContent = err.message; source.textContent = 'Naskah belum dapat dirapikan. Soal lama tetap tersedia.'; }
            } finally { if (version === revision) { activeController = null; setBusy(false); } }
        };
        readButton.onclick = () => {
            if (loading || !hasContent()) return;
            if (aiImport && (aiChecking || aiToggle.checked)) return previewWithAi();
            if (selectedFile) return readSelectedFile(selectedFile);
            invalidate();
            try {
                const result = spreadsheetResult || parseQuizImport(text.value, { format: format?.value || 'auto', defaultType: defaultType?.value || 'essay' });
                checkCapacity(result);
                renderPreview(result);
            } catch (err) { error.textContent = err.message; }
        };
        const readSelectedFile = async file => {
            if (!file) return;
            invalidate(); spreadsheetResult = null; sourceWarnings = [];
            selectedFile = file;
            const version = revision;
            const controller = new AbortController(); activeController = controller;
            setBusy(true);
            source.textContent = `Membaca ${file.name}...`;
            try {
                if (aiImport) await availability;
                if (!modal.isConnected || version !== revision) return;
                const useAi = aiAvailable && aiToggle.checked;
                let loaded;
                if (useAi) {
                    const result = await aiImport.parse({ file, defaultType: defaultType?.value || 'essay', signal: controller.signal });
                    loaded = { result, text: result.sourceText, format: result.sourceFormat, name: file.name, ai: true };
                } else loaded = await readQuizImportFile(file);
                if (!modal.isConnected || version !== revision) return;
                sourceWarnings = loaded.warnings || [];
                if (loaded.ai) { text.value = loaded.text || ''; if (format) format.value = loaded.format || 'text'; text.placeholder = 'Dokumen sudah dibaca oleh AI. Periksa pratinjau, atau tempel naskah pengganti di sini.'; }
                else if (loaded.result) { spreadsheetResult = loaded.result; text.value = ''; }
                else { text.value = loaded.text; if (format) format.value = loaded.format; }
                source.textContent = `Sumber: ${loaded.name}${loaded.ai ? ' · dibaca dengan AI, periksa draf sebelum ditambahkan' : loaded.result ? ' · lembar pertama Excel' : ''}.`;
                const result = loaded.result || parseQuizImport(text.value, { format: format?.value || 'auto', defaultType: defaultType?.value || 'essay' });
                checkCapacity(result);
                renderPreview(result);
            } catch (err) {
                if (modal.isConnected && version === revision && err.name !== 'AbortError') {
                    error.textContent = err.message;
                    source.textContent = 'Berkas belum dapat diimpor.';
                }
            } finally {
                if (version === revision) { activeController = null; setBusy(false); }
                fileInput.value = '';
            }
        };
        fileInput.onchange = () => readSelectedFile(fileInput.files?.[0]);
        apply.onclick = () => {
            if (!parsed || loading || apply.disabled) return;
            try {
                checkCapacity(parsed);
                const existing = [...list(card).children];
                const placeholder = emptyPlaceholder();
                // Build separately first so a failed import cannot remove or partly append existing work.
                const staging = document.createElement('div');
                staging.innerHTML = '<div class="lms-quiz-questions-list"></div>';
                parsed.questions.forEach(q => window.addLmsQuizQuestion(staging, q.type, q));
                if (staging.firstElementChild.children.length !== parsed.questions.length) throw new Error('Sebagian soal belum dapat dibaca. Periksa kembali naskah.');
                list(card).replaceChildren(...existing.filter(item => item !== placeholder), ...staging.firstElementChild.children);
                window.refreshLmsQuizQuestionNumbers(card);
                modal.remove();
                notify('Soal diimpor', `${parsed.questions.length} soal ditambahkan. Tinjau dan simpan modul untuk menyimpan soal.`, 'success');
            } catch (err) { error.textContent = err.message; }
        };
        body.querySelectorAll('[data-template]').forEach(button => { button.onclick = async () => {
            error.textContent = '';
            button.disabled = true;
            try {
                const kind = button.dataset.template;
                if (kind === 'xlsx') {
                    const spreadsheet = globalThis.XLSX;
                    if (!spreadsheet?.utils) throw new Error('Pustaka Excel belum siap. Gunakan template CSV atau TXT.');
                    const book = spreadsheet.utils.book_new();
                    spreadsheet.utils.book_append_sheet(book, spreadsheet.utils.aoa_to_sheet(QUIZ_TABLE_TEMPLATE), 'Soal');
                    spreadsheet.writeFile(book, 'Template-Impor-Soal-SIMAS.xlsx');
                    return;
                }
                const csv = QUIZ_TABLE_TEMPLATE.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
                const blob = kind === 'word' ? new Blob([await buildQuizWordTemplate(QUIZ_TEXT_TEMPLATE)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
                    : new Blob([kind === 'csv' ? '\uFEFF' + csv : QUIZ_TEXT_TEMPLATE], { type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url; link.download = `Template-Impor-Soal-SIMAS.${kind === 'word' ? 'docx' : kind === 'csv' ? 'csv' : 'txt'}`;
                link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (err) { error.textContent = err.message; }
            finally { button.disabled = false; }
        }; });
    };
    window.refreshLmsQuizQuestionNumbers = card => list(card)?.querySelectorAll('.lms-quiz-question-item').forEach((item, index) => { item.querySelector('.lms-quiz-q-num').textContent = `Soal ${index + 1}`; });
    window.removeLmsQuizQuestion = btn => {
        const card = btn.closest('.lms-material-card');
        if (list(card).children.length === 1) return notify('Minimal satu soal', 'Kuis harus memiliki setidaknya satu soal.', 'warning');
        btn.closest('.lms-quiz-question-item').remove();
        window.refreshLmsQuizQuestionNumbers(card);
    };
    window.moveLmsQuizQuestion = (btn, direction) => {
        const item = btn.closest('.lms-quiz-question-item');
        const target = direction < 0 ? item.previousElementSibling : item.nextElementSibling;
        if (target) direction < 0 ? target.before(item) : target.after(item);
        window.refreshLmsQuizQuestionNumbers(btn.closest('.lms-material-card'));
    };
    function renderOptions(item, options, correct) {
        const group = item.dataset.radioGroup ||= `key_${quizId()}`;
        const container = item.querySelector('.lms-quiz-options-container');
        container.innerHTML = options.map((option, index) => `<div class="flex gap-2 items-center"><label class="flex gap-1 items-center min-w-[32px] font-bold"><input type="radio" class="lms-quiz-mc-radio" name="${quizEscape(group)}" value="${index}" ${correct === index ? 'checked' : ''} aria-label="Kunci ${String.fromCharCode(65 + index)}">${String.fromCharCode(65 + index)}</label><input class="lms-quiz-mc-option ${fieldClass} flex-1" value="${quizEscape(option)}" maxlength="2000" placeholder="Pilihan ${String.fromCharCode(65 + index)}" aria-label="Pilihan ${String.fromCharCode(65 + index)}"><button type="button" data-math-option="${index}" class="px-2.5 py-1.5 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 text-xs font-bold inline-flex items-center gap-1" title="Sisipkan simbol matematika pada pilihan ${String.fromCharCode(65 + index)}"><i class="fa-solid fa-square-root-variable"></i></button><button type="button" data-remove-option="${index}" class="${buttonClass}" aria-label="Hapus pilihan ${String.fromCharCode(65 + index)}">×</button></div>`).join('');
        container.querySelectorAll('[data-remove-option]').forEach(btn => { btn.onclick = () => {
            const values = [...container.querySelectorAll('.lms-quiz-mc-option')].map(input => input.value);
            if (values.length <= 2) return notify('Minimal dua pilihan', 'PG memerlukan setidaknya dua pilihan.', 'warning');
            const removed = Number(btn.dataset.removeOption);
            const key = container.querySelector(':checked');
            let selected = key ? Number(key.value) : -1;
            values.splice(removed, 1);
            selected = selected === removed ? -1 : selected > removed ? selected - 1 : selected;
            renderOptions(item, values, selected);
        }; });
        container.querySelectorAll('[data-math-option]').forEach(btn => {
            btn.onclick = () => {
                const optInput = btn.closest('div')?.querySelector('.lms-quiz-mc-option');
                if (optInput) window.openLmsMathPaletteModal?.(optInput, null, btn);
            };
        });
    }
    function setQuestionType(item, type) {
        if (!['mc', 'short', 'essay'].includes(type)) return;
        item.dataset.questionType = type;
        item.querySelectorAll('[data-quiz-answer-type]').forEach(panel => {
            panel.classList.toggle('hidden', panel.dataset.quizAnswerType !== type);
        });
        item.querySelectorAll('[data-quiz-type]').forEach(button => {
            const selected = button.dataset.quizType === type;
            button.setAttribute('aria-pressed', String(selected));
            button.className = `lms-quiz-type-button px-2.5 py-1 rounded-md border text-xs font-semibold ${selected
                ? 'bg-purple-600 border-purple-600 text-white hover:bg-purple-700'
                : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`;
        });
    }
    window.openLmsMathPaletteModal = (targetInput, onUpdate = null, triggerElement = null) => {
        return openLmsMathPaletteModal(targetInput, onUpdate, triggerElement);
    };

    window.addLmsQuizQuestion = (card, type = 'mc', data = {}) => {
        card ||= document.querySelector('.lms-material-card[data-card-index="0"]');
        data ||= {};
        if (!list(card)) return;
        if (list(card).children.length >= 50) return notify('Batas soal', 'Maksimal 50 soal per kuis.', 'warning');
        const item = document.createElement('div');
        type = data.type || type;
        if (!['mc', 'short', 'essay'].includes(type)) type = 'mc';
        item.className = 'lms-quiz-question-item border border-purple-200 dark:border-purple-800 rounded-xl p-3 bg-white dark:bg-slate-900 space-y-3';
        item.dataset.questionId = data.id || `q_${quizId().replaceAll('-', '')}`;
        item.dataset.questionType = type;
        item.innerHTML = `<div class="lms-quiz-q-header flex flex-wrap items-center justify-between gap-2"><div class="lms-quiz-q-meta flex items-center flex-wrap gap-2"><b class="lms-quiz-q-num"></b><div class="flex items-center gap-1" role="group" aria-label="Tipe soal">${[['mc', 'PG', 'Pilihan Ganda'], ['short', 'Isian Singkat', 'Isian Singkat'], ['essay', 'Uraian', 'Uraian']].map(([value, label, title]) => `<button type="button" data-quiz-type="${value}" aria-pressed="false" title="${title}">${label}</button>`).join('')}</div><label class="lms-quiz-weight">Bobot <input type="number" min="1" max="100" step="1" value="${quizEscape(data.points ?? 1)}" class="lms-quiz-points ${fieldClass}"></label></div><div class="lms-quiz-q-actions flex items-center gap-1"><button type="button" onclick="window.moveLmsQuizQuestion(this,-1)" class="${buttonClass}" aria-label="Naikkan soal">↑</button><button type="button" onclick="window.moveLmsQuizQuestion(this,1)" class="${buttonClass}" aria-label="Turunkan soal">↓</button><button type="button" onclick="window.removeLmsQuizQuestion(this)" class="${buttonClass}">Hapus</button></div></div>
            <div class="space-y-1.5">
                <div class="flex justify-between items-center">
                    <label class="block text-xs font-bold text-slate-700 dark:text-slate-300">Pertanyaan *</label>
                    <div class="flex items-center gap-1.5">
                        <button type="button" data-action="math-palette-q" class="px-2.5 py-1 rounded-lg border border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 text-xs font-bold hover:bg-purple-100 dark:hover:bg-purple-900/40 transition inline-flex items-center gap-1.5" title="Buka Palet Simbol Matematika">
                            <i class="fa-solid fa-square-root-variable"></i> <span>Simbol Matematika</span>
                        </button>
                        <button type="button" data-toggle-math-preview class="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs hover:bg-slate-100 dark:hover:bg-slate-700 transition inline-flex items-center gap-1.5" title="Lihat Pratinjau Tampilan Rumus">
                            <i class="fa-regular fa-eye"></i> <span>Pratinjau</span>
                        </button>
                    </div>
                </div>
                <textarea rows="3" maxlength="10000" class="lms-quiz-q-text ${fieldClass}" placeholder="Tuliskan soal; boleh menggunakan format teks biasa, Markdown, atau LaTeX $rumus$.">${quizEscape(data.question || '')}</textarea>
                <div class="lms-quiz-q-preview hidden p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-sm break-words whitespace-pre-wrap"></div>
            </div>
            <div data-quiz-answer-type="mc" class="space-y-2"><p>Pilih lingkaran pada jawaban yang benar (minimal 5 pilihan A–E).</p><div class="lms-quiz-options-container space-y-2"></div><button type="button" data-add-option class="${buttonClass}">Tambah pilihan</button></div>
            <div data-quiz-answer-type="short" class="space-y-2"><label class="block">Kunci jawaban (opsional)<input class="lms-quiz-short-correct ${fieldClass}" maxlength="2000" value="${quizEscape(data.correct_answer || '')}" placeholder="Boleh dikosongkan untuk diperiksa guru."></label><label class="block">Alternatif jawaban (opsional), satu per baris<textarea rows="2" class="lms-quiz-short-variations ${fieldClass}">${quizEscape((Array.isArray(data.accepted_answers) ? data.accepted_answers : []).filter(v => v !== data.correct_answer).join('\n'))}</textarea></label><p class="text-slate-500">Jika kunci dan alternatif kosong, jawaban diperiksa guru. Jika diisi, jawaban dinilai otomatis dengan mengabaikan huruf besar/kecil dan spasi berlebih.</p></div>
            <div data-quiz-answer-type="essay"><label class="block">Kunci jawaban / rubrik penilaian (opsional, tidak ditampilkan ke siswa)<textarea rows="3" maxlength="10000" class="lms-quiz-guidance ${fieldClass}" placeholder="Boleh dikosongkan. Contoh: konsep tepat 2 poin, alasan 2 poin, contoh 1 poin.">${quizEscape(data.grading_guidance || '')}</textarea></label></div>
            <details class="lms-quiz-optional"><summary>Gambar &amp; pembahasan (opsional)</summary><div class="space-y-2 mt-2"><label class="block">URL gambar (HTTPS)<input type="url" maxlength="2000" value="${quizEscape(data.image_url || '')}" class="lms-quiz-image ${fieldClass}" placeholder="https://..."></label><div class="space-y-1"><div class="flex justify-between items-center"><label class="block text-xs font-bold text-slate-700 dark:text-slate-300">Pembahasan setelah hasil diterbitkan (opsional)</label><button type="button" data-action="math-palette-exp" class="px-2 py-0.5 rounded border border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 text-xs font-bold hover:bg-purple-100 dark:hover:bg-purple-900/40 transition inline-flex items-center gap-1" title="Buka Palet Simbol Matematika untuk Pembahasan"><i class="fa-solid fa-square-root-variable"></i> <span>Simbol Matematika</span></button></div><textarea rows="2" maxlength="10000" class="lms-quiz-q-explanation ${fieldClass}" placeholder="Tuliskan pembahasan atau langkah penyelesaian soal...">${quizEscape(data.explanation || '')}</textarea></div></div></details>`;
        list(card).appendChild(item);
        const qText = item.querySelector('.lms-quiz-q-text');
        const qPrev = item.querySelector('.lms-quiz-q-preview');
        const updateQPrev = () => {
            if (qPrev && !qPrev.classList.contains('hidden')) {
                qPrev.innerHTML = renderSafeMarkdown(qText.value.trim() || '<i>(Pertanyaan masih kosong)</i>');
            }
        };
        const qMathBtn = item.querySelector('[data-action=math-palette-q]');
        if (qMathBtn) qMathBtn.onclick = () => window.openLmsMathPaletteModal?.(qText, updateQPrev, qMathBtn);
        const expMathBtn = item.querySelector('[data-action=math-palette-exp]');
        if (expMathBtn) {
            expMathBtn.onclick = () => {
                const expInput = item.querySelector('.lms-quiz-q-explanation');
                if (expInput) window.openLmsMathPaletteModal?.(expInput, null, expMathBtn);
            };
        }
        const prevBtn = item.querySelector('[data-toggle-math-preview]');
        if (prevBtn) {
            prevBtn.onclick = () => {
                const isHidden = qPrev.classList.toggle('hidden');
                prevBtn.innerHTML = isHidden
                    ? '<i class="fa-regular fa-eye"></i> <span>Pratinjau</span>'
                    : '<i class="fa-regular fa-eye-slash"></i> <span>Tutup Pratinjau</span>';
                if (!isHidden) updateQPrev();
            };
        }
        qText.addEventListener('input', updateQPrev);
        const rawOpts = Array.isArray(data.options) ? [...data.options] : ['', '', '', '', ''];
        renderOptions(item, rawOpts, data.correct_option ?? -1);
        item.querySelector('[data-add-option]').onclick = () => {
            const values = [...item.querySelectorAll('.lms-quiz-mc-option')].map(i => i.value);
            if (values.length >= 5) return notify('Batas pilihan', 'Soal pilihan ganda di LMS maksimal 5 pilihan (A–E).', 'info');
            const checked = item.querySelector('.lms-quiz-mc-radio:checked');
            renderOptions(item, [...values, ''], checked ? Number(checked.value) : -1);
        };
        item.querySelectorAll('[data-quiz-type]').forEach(button => {
            button.onclick = () => setQuestionType(item, button.dataset.quizType);
        });
        setQuestionType(item, type);
        window.refreshLmsQuizQuestionNumbers(card);
    };
    window.serializeLmsQuizPayload = card => {
        const number = (selector, min, max, label) => {
            const raw = card.querySelector(selector)?.value;
            const value = Number(raw);
            if (raw === '' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} harus antara ${min}–${max}.`);
            return value;
        };
        const questions = [...list(card).children].map((item, index) => {
            const val = selector => (item.querySelector(selector)?.value || '').trim();
            const q = { id: item.dataset.questionId, type: item.dataset.questionType, question: val('.lms-quiz-q-text'), points: Number(val('.lms-quiz-points')), image_url: val('.lms-quiz-image'), explanation: val('.lms-quiz-q-explanation') };
            if (!q.question) throw new Error(`Pertanyaan soal ${index + 1} belum diisi.`);
            if (!Number.isFinite(q.points) || q.points < 1 || q.points > 100) throw new Error(`Bobot soal ${index + 1} harus 1–100.`);
            if (q.image_url) { try { if (new URL(q.image_url).protocol !== 'https:') throw new Error(); } catch (_) { throw new Error(`URL gambar soal ${index + 1} harus HTTPS.`); } }
            if (q.type === 'mc') {
                q.options = [...item.querySelectorAll('.lms-quiz-mc-option')].map(i => i.value.trim());
                if (q.options.some(v => !v)) throw new Error(`Isi atau hapus pilihan kosong pada soal ${index + 1}.`);
                const key = item.querySelector('.lms-quiz-mc-radio:checked');
                if (!key) throw new Error(`Pilih kunci jawaban soal ${index + 1}.`);
                q.correct_option = Number(key.value);
            } else if (q.type === 'short') {
                q.correct_answer = val('.lms-quiz-short-correct');
                q.accepted_answers = [...new Set([q.correct_answer, ...val('.lms-quiz-short-variations').split('\n').map(v => v.trim())].filter(Boolean))];
            } else q.grading_guidance = val('.lms-quiz-guidance');
            return q;
        });
        if (!questions.length) throw new Error('Tambahkan setidaknya satu soal.');
        const mode = card.querySelector('.lms-quiz-mode')?.value === 'strict' ? 'strict' : 'relaxed';
        const rawViolations = parseInt(card.querySelector('.lms-quiz-max-violations')?.value || '3', 10);
        const max_violations = Number.isInteger(rawViolations) && rawViolations >= 1 && rawViolations <= 10 ? rawViolations : 3;
        const shuffle_questions = card.querySelector('.lms-quiz-shuffle-q')?.value === '1' ? 1 : 0;
        const shuffle_options = card.querySelector('.lms-quiz-shuffle-opt')?.value === '1' ? 1 : 0;
        const timeLimit = number('.lms-quiz-time', 0, 180, 'Waktu pengerjaan');
        if (mode === 'strict' && timeLimit < 5) {
            throw new Error('Pada Mode CBT, durasi pengerjaan ujian wajib diisi minimal 5 menit.');
        }
        return JSON.stringify({
            mode,
            max_violations,
            shuffle_questions,
            shuffle_options,
            passing_grade: number('.lms-quiz-kkm', 0, 100, 'Batas ketuntasan'),
            time_limit_minutes: timeLimit,
            allow_retake: mode === 'strict' ? 0 : (card.querySelector('.lms-quiz-retake')?.checked ? 1 : 0),
            questions
        });
    };
    window.previewLmsQuiz = card => {
        try {
            const quiz = JSON.parse(window.serializeLmsQuizPayload(card));
            const modal = quizDialog('lms-quiz-preview', 'Pratinjau soal siswa');
            modal.querySelector('[data-body]').innerHTML = quiz.questions.map((q, i) => `<article class="border dark:border-slate-700 rounded-xl p-4 space-y-3"><b>Soal ${i + 1} · ${typeLabel(q.type)} · ${q.points} poin</b>${quizQuestionMarkup(q)}${q.type === 'mc' ? q.options.map((v, n) => `<div class="p-2 border dark:border-slate-700 rounded-lg">${String.fromCharCode(65 + n)}. ${renderSafeMarkdown(v)}</div>`).join('') : `<textarea disabled rows="${q.type === 'essay' ? 4 : 1}" class="${fieldClass}" placeholder="Jawaban siswa"></textarea>`}</article>`).join('');
        } catch (error) { notify('Periksa soal', error.message, 'warning'); }
    };

    window.openLmsQuizSettingsModal = card => {
        if (!card) return;
        document.getElementById('lms-quiz-settings-modal')?.remove();
        const modal = quizDialog('lms-quiz-settings-modal', 'Pengaturan Kuis / CBT');
        const body = modal.querySelector('[data-body]');
        
        const currentMode = card.querySelector('.lms-quiz-mode')?.value || 'relaxed';
        const currentViolations = parseInt(card.querySelector('.lms-quiz-max-violations')?.value || '3', 10) || 3;
        const currentShuffleQ = card.querySelector('.lms-quiz-shuffle-q')?.value === '1';
        const currentShuffleOpt = card.querySelector('.lms-quiz-shuffle-opt')?.value === '1';
        const currentKkm = parseInt(card.querySelector('.lms-quiz-kkm')?.value ?? '75', 10) || 75;
        const currentTime = parseInt(card.querySelector('.lms-quiz-time')?.value ?? '0', 10) || 0;
        const currentRetake = card.querySelector('.lms-quiz-retake') ? card.querySelector('.lms-quiz-retake').checked : true;
        
        body.innerHTML = `
            <div class="space-y-4 text-slate-800 dark:text-slate-200">
                <!-- Bagian 1: Pilihan Mode Pengerjaan -->
                <div class="p-3.5 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20 space-y-3">
                    <p class="font-bold text-sm text-purple-950 dark:text-purple-200">1. Pilihan Mode Pengerjaan</p>
                    <div class="grid sm:grid-cols-2 gap-3">
                        <label data-mode-label="relaxed" class="flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition ${currentMode !== 'strict' ? 'border-purple-600 bg-purple-100/60 dark:bg-purple-900/40 text-purple-950 dark:text-purple-100 ring-2 ring-purple-500/20' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'}">
                            <input type="radio" name="cbt_modal_mode" value="relaxed" ${currentMode !== 'strict' ? 'checked' : ''} class="mt-1 accent-purple-600">
                            <div>
                                <b class="text-sm block">☕ Kuis (Santai)</b>
                                <span class="text-xs text-slate-500 dark:text-slate-400 leading-normal block mt-1">Latihan mandiri atau tugas formatif santai. Waktu pengerjaan bebas atau terbatas, tanpa sanksi keluar layar, dan siswa dapat mengulang kuis.</span>
                            </div>
                        </label>
                        <label data-mode-label="strict" class="flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition ${currentMode === 'strict' ? 'border-purple-600 bg-purple-100/60 dark:bg-purple-900/40 text-purple-950 dark:text-purple-100 ring-2 ring-purple-500/20' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'}">
                            <input type="radio" name="cbt_modal_mode" value="strict" ${currentMode === 'strict' ? 'checked' : ''} class="mt-1 accent-purple-600">
                            <div>
                                <b class="text-sm block">🛡️ CBT (Ketat Anti-Kecurangan)</b>
                                <span class="text-xs text-slate-500 dark:text-slate-400 leading-normal block mt-1">Ujian resmi berbatas waktu. Wajib layar penuh (fullscreen), deteksi pindah tab (&gt; 3 detik), tanpa pengulangan (1x ujian), dan auto-submit saat modul ditutup.</span>
                            </div>
                        </label>
                    </div>
                </div>

                <!-- Bagian 2: Parameter Utama Pengerjaan -->
                <div class="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 space-y-3">
                    <p class="font-bold text-sm text-slate-800 dark:text-slate-200">2. Parameter Utama Pengerjaan</p>
                    <div class="grid sm:grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">🎯 Batas Ketuntasan (KKM) <span class="text-rose-500">*</span></label>
                            <input type="number" data-cbt-kkm min="0" max="100" step="1" value="${currentKkm}" class="${fieldClass} w-full font-bold">
                            <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Skor minimal (0–100) untuk memenuhi ketuntasan Bahan Ajar ini.</p>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">⏱️ Waktu Pengerjaan (Menit) <span class="text-rose-500">*</span></label>
                            <input type="number" data-cbt-duration min="${currentMode === 'strict' ? '5' : '0'}" max="180" step="1" value="${currentMode === 'strict' ? (currentTime >= 5 ? currentTime : 30) : currentTime}" class="${fieldClass} w-full font-bold">
                            <p data-cbt-duration-hint class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">${currentMode === 'strict' ? 'Wajib diisi minimal 5 menit (maks. 180 menit). Waktu buka-tutup ujian menginduk pada jadwal modul.' : 'Isi 0 untuk waktu bebas tanpa batasan (atau tentukan 1–180 menit).'}</p>
                        </div>
                    </div>
                    <div class="pt-2 border-t border-slate-200 dark:border-slate-700">
                        <label class="flex items-start gap-2.5 cursor-pointer">
                            <input type="checkbox" data-cbt-retake ${currentMode === 'strict' ? 'disabled' : (currentRetake ? 'checked' : '')} class="mt-0.5 accent-purple-600 rounded">
                            <div>
                                <b class="text-xs block text-slate-800 dark:text-slate-200">🔄 Izinkan Siswa Mengulang</b>
                                <span data-cbt-retake-hint class="text-[11px] text-slate-500 dark:text-slate-400 leading-normal block mt-0.5">${currentMode === 'strict' ? 'Terkunci nonaktif pada mode CBT (hanya 1x kesempatan ujian).' : 'Siswa dapat mengulang pengerjaan untuk memperbaiki nilai/pemahaman materi.'}</span>
                            </div>
                        </label>
                    </div>
                </div>

                <!-- Bagian 3: Pengamanan CBT -->
                <div data-cbt-options-section class="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 space-y-3 ${currentMode !== 'strict' ? 'opacity-50 pointer-events-none' : ''}">
                    <div class="flex items-center gap-2">
                        <span class="w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-xs">
                            <i class="fa-solid fa-shield-halved"></i>
                        </span>
                        <b class="text-sm text-slate-800 dark:text-slate-200">3. Konfigurasi Pengamanan CBT</b>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">🚨 Batas Toleransi Pelanggaran (1–10 kali)</label>
                        <input type="number" data-cbt-violations min="1" max="10" step="1" value="${currentViolations}" class="${fieldClass} w-full font-bold">
                        <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Siswa mendapat notifikasi peringatan jika berpindah tab &gt; 3 detik. Kuis terkunci otomatis jika batas tercapai.</p>
                    </div>
                    <div class="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                        <label class="flex items-center gap-2 text-sm font-medium cursor-pointer">
                            <input type="checkbox" data-cbt-shuffle-q ${currentShuffleQ ? 'checked' : ''} class="rounded accent-purple-600">
                            <span>Acak urutan soal untuk setiap siswa</span>
                        </label>
                        <label class="flex items-center gap-2 text-sm font-medium cursor-pointer">
                            <input type="checkbox" data-cbt-shuffle-opt ${currentShuffleOpt ? 'checked' : ''} class="rounded accent-purple-600">
                            <span>Acak urutan pilihan ganda (A–E) untuk setiap siswa</span>
                        </label>
                    </div>
                </div>

                <div class="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
                    <button type="button" data-cbt-cancel class="${buttonClass}">Batal</button>
                    <button type="button" data-cbt-save class="${primaryClass}">Terapkan Pengaturan</button>
                </div>
            </div>
        `;
        
        const radios = body.querySelectorAll('input[name="cbt_modal_mode"]');
        const optionsSection = body.querySelector('[data-cbt-options-section]');
        const durationInput = body.querySelector('[data-cbt-duration]');
        const durationHint = body.querySelector('[data-cbt-duration-hint]');
        const retakeCheckbox = body.querySelector('[data-cbt-retake]');
        const retakeHint = body.querySelector('[data-cbt-retake-hint]');

        let userKuisRetakeState = currentRetake;

        const updateModeUi = () => {
            const selected = body.querySelector('input[name="cbt_modal_mode"]:checked')?.value || 'relaxed';
            body.querySelectorAll('[data-mode-label]').forEach(label => {
                const isSel = label.dataset.modeLabel === selected;
                label.className = `flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition ${isSel ? 'border-purple-600 bg-purple-100/60 dark:bg-purple-900/40 text-purple-950 dark:text-purple-100 ring-2 ring-purple-500/20' : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'}`;
            });
            if (selected === 'strict') {
                optionsSection.classList.remove('opacity-50', 'pointer-events-none');
                durationInput.min = '5';
                const curVal = parseInt(durationInput.value, 10);
                if (isNaN(curVal) || curVal < 5) durationInput.value = '30';
                durationHint.textContent = 'Wajib diisi minimal 5 menit (maks. 180 menit). Waktu buka-tutup ujian menginduk pada jadwal modul.';
                userKuisRetakeState = retakeCheckbox.checked;
                retakeCheckbox.checked = false;
                retakeCheckbox.disabled = true;
                retakeHint.textContent = 'Terkunci nonaktif pada mode CBT (hanya 1x kesempatan ujian).';
            } else {
                optionsSection.classList.add('opacity-50', 'pointer-events-none');
                durationInput.min = '0';
                durationHint.textContent = 'Isi 0 untuk waktu bebas tanpa batasan (atau tentukan 1–180 menit).';
                retakeCheckbox.disabled = false;
                retakeCheckbox.checked = userKuisRetakeState;
                retakeHint.textContent = 'Siswa dapat mengulang pengerjaan untuk memperbaiki nilai/pemahaman materi.';
            }
        };
        radios.forEach(r => r.onchange = updateModeUi);
        
        body.querySelector('[data-cbt-cancel]').onclick = () => modal.remove();
        body.querySelector('[data-cbt-save]').onclick = () => {
            const selectedMode = body.querySelector('input[name="cbt_modal_mode"]:checked')?.value || 'relaxed';
            const kkmInput = body.querySelector('[data-cbt-kkm]');
            const kkm = parseInt(kkmInput?.value ?? '', 10);
            if (isNaN(kkm) || kkm < 0 || kkm > 100) {
                notify('Batas ketuntasan tidak valid', 'Batas ketuntasan (KKM) harus berupa angka antara 0 sampai 100.', 'warning');
                kkmInput?.focus();
                return;
            }

            const durationInputEl = body.querySelector('[data-cbt-duration]');
            const duration = parseInt(durationInputEl?.value || '0', 10);
            if (selectedMode === 'strict') {
                if (isNaN(duration) || duration < 5 || duration > 180) {
                    notify('Durasi tidak valid', 'Pada Mode CBT, durasi pengerjaan ujian wajib diisi minimal 5 menit (maks. 180 menit).', 'warning');
                    durationInputEl?.focus();
                    return;
                }
            } else {
                if (isNaN(duration) || duration < 0 || duration > 180) {
                    notify('Durasi tidak valid', 'Waktu pengerjaan kuis harus antara 0 (bebas) sampai 180 menit.', 'warning');
                    durationInputEl?.focus();
                    return;
                }
            }

            const violationsInput = body.querySelector('[data-cbt-violations]');
            const violations = parseInt(violationsInput.value, 10);
            if (isNaN(violations) || violations < 1 || violations > 10) {
                notify('Batas tidak valid', 'Batas toleransi pelanggaran harus antara 1 sampai 10 kali.', 'warning');
                violationsInput.focus();
                return;
            }

            const shuffleQ = body.querySelector('[data-cbt-shuffle-q]').checked;
            const shuffleOpt = body.querySelector('[data-cbt-shuffle-opt]').checked;
            const retake = selectedMode === 'strict' ? false : body.querySelector('[data-cbt-retake]').checked;

            const modeEl = card.querySelector('.lms-quiz-mode');
            if (modeEl) modeEl.value = selectedMode;
            const kkmEl = card.querySelector('.lms-quiz-kkm');
            if (kkmEl) kkmEl.value = String(kkm);
            const timeEl = card.querySelector('.lms-quiz-time');
            if (timeEl) timeEl.value = String(duration);
            const retakeEl = card.querySelector('.lms-quiz-retake');
            if (retakeEl) {
                retakeEl.checked = retake;
                retakeEl.disabled = selectedMode === 'strict';
            }
            const violEl = card.querySelector('.lms-quiz-max-violations');
            if (violEl) violEl.value = String(violations);
            const sqEl = card.querySelector('.lms-quiz-shuffle-q');
            if (sqEl) sqEl.value = shuffleQ ? '1' : '0';
            const soEl = card.querySelector('.lms-quiz-shuffle-opt');
            if (soEl) soEl.value = shuffleOpt ? '1' : '0';
            
            const badgeEl = card.querySelector('.lms-cbt-badge');
            if (badgeEl) {
                if (selectedMode === 'strict') {
                    badgeEl.className = 'lms-cbt-badge lm-badge-cbt-strict';
                    badgeEl.textContent = `🛡️ CBT (${duration} mnt · KKM ${kkm} · 1x · Maks. ${violations}x)`;
                } else {
                    badgeEl.className = 'lms-cbt-badge lm-badge-cbt-relaxed';
                    badgeEl.textContent = `☕ Kuis (${duration > 0 ? `${duration} mnt` : 'Bebas'} · KKM ${kkm} · ${retake ? 'Boleh Ulang' : '1x'})`;
                }
            }
            card.dispatchEvent(new Event('input', { bubbles: true }));
            card.dispatchEvent(new Event('change', { bubbles: true }));
            modal.remove();
            notify('Pengaturan Kuis / CBT Disimpan', `Pengaturan mode ${selectedMode === 'strict' ? 'CBT' : 'Kuis'} berhasil diterapkan ke bahan ajar ini.`, 'success');
        };
    };

}

export function installTeacherQuiz({ api, getMaterial, refresh, notify }) {
    let requestId = 0;
    window.openLmsQuizReview = async (materialId, nis) => {
        const token = ++requestId;
        const material = getMaterial(materialId);
        const modal = quizDialog('lms-quiz-review', 'Pemeriksaan jawaban siswa');
        const body = modal.querySelector('[data-body]');
        body.innerHTML = '<p role="status">Memuat jawaban...</p>';
        try {
            const res = await api.list(materialId, nis);
            if (token !== requestId || !modal.isConnected) return;
            if (!res.data?.length) { body.innerHTML = '<p>Belum ada jawaban rinci. Hasil kuis sebelum pembaruan hanya memiliki skor ringkasan.</p>'; return; }
            const render = index => {
                const attempt = res.data[index];
                const pending = attempt.status === 'in_progress';
                const isLocked = Boolean(attempt.is_locked);
                const result = attempt.result || {};
                const attemptLabel = a => {
                    const time = new Date(a.started_at).toLocaleString('id-ID');
                    if (a.is_locked) return `${time} — 🔒 TERKUNCI (${a.violation_count || 0}x Pelanggaran)`;
                    if (a.status === 'graded') return `${time} — Nilai ${a.result?.score ?? '-'}`;
                    if (a.status === 'pending_review') return `${time} — Menunggu diperiksa`;
                    return `${time} — Sedang dikerjakan`;
                };

                const lockedBanner = isLocked ? `
                    <div class="p-4 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200 space-y-3" role="alert">
                        <div class="flex items-center justify-between flex-wrap gap-2">
                            <div class="flex items-center gap-2 font-bold text-sm">
                                <span class="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse"></span>
                                <span>Pengerjaan Siswa Terkunci (${attempt.violation_count || 0} Pelanggaran)</span>
                            </div>
                            <span class="text-xs px-2.5 py-1 rounded-full bg-rose-200 dark:bg-rose-900 text-rose-800 dark:text-rose-200 font-bold">Mode CBT Ketat</span>
                        </div>
                        <p class="text-xs text-rose-800 dark:text-rose-300">Penyebab Kunci: <b>${quizEscape(attempt.lock_reason || 'Terdeteksi berpindah tab atau keluar layar pengerjaan')}</b></p>
                        ${formatViolationsList(attempt.violations_log)}
                        <div class="flex flex-wrap gap-2 pt-2 border-t border-rose-200 dark:border-rose-800">
                            <button type="button" data-action-unlock class="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow inline-flex items-center gap-1.5 transition">
                                🔓 Buka Kunci (Lanjutkan)
                            </button>
                            <button type="button" data-action-reset class="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow inline-flex items-center gap-1.5 transition">
                                🔄 Reset Pengerjaan (Ulangi)
                            </button>
                        </div>
                    </div>` : '';

                body.innerHTML = `<p class="font-bold">${quizEscape(attempt.student_name)} · ${quizEscape(material?.title || '')}</p><label class="block">Riwayat pengerjaan (30 terbaru)<select data-attempt class="${fieldClass}">${res.data.map((a, i) => `<option value="${i}" ${i === index ? 'selected' : ''}>${attemptLabel(a)}</option>`).join('')}</select></label>
                    ${lockedBanner}
                    <p class="text-sm text-slate-500">${isLocked ? 'Pengerjaan ini sedang terkunci. Siswa tidak dapat mengirim jawaban sebelum kunci dibuka atau di-reset.' : pending ? 'Siswa belum mengumpulkan jawaban. Nilai belum dapat diterbitkan.' : 'Periksa jawaban dan isi poin setiap soal. Nilai serta umpan balik akan tersedia bagi siswa setelah diterbitkan.'}</p>
                    ${result.submitted_late ? '<p class="p-3 rounded-lg bg-amber-100 text-amber-900" role="status">Jawaban diterima setelah batas waktu. Periksa jawaban dan tentukan nilai sebelum menerbitkan hasil.</p>' : ''}
                    <form data-review-form class="space-y-4">${attempt.quiz.questions.map((q, i) => {
                        const row = result.review?.find(r => r.id === q.id);
                        const key = q.type === 'mc' ? quizAnswerLabel(q, q.correct_option) : q.type === 'short' ? q.correct_answer : q.grading_guidance;
                        return `<article data-question-id="${quizEscape(q.id)}" class="border dark:border-slate-700 rounded-xl p-4 space-y-3"><b>Soal ${i + 1} · ${typeLabel(q.type)} · ${q.points} poin</b>${quizQuestionMarkup(q)}<div class="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg whitespace-pre-wrap"><b>Jawaban siswa:</b><br>${renderSafeMarkdown(quizAnswerLabel(q, attempt.answers[q.id]))}</div><p class="text-sm whitespace-pre-wrap"><b>${q.type === 'essay' ? 'Pedoman' : 'Kunci'}:</b> ${renderSafeMarkdown(key || 'Belum ditulis')}</p><div class="grid sm:grid-cols-3 gap-3"><label>Poin (0–${q.points})<input data-points type="number" min="0" max="${q.points}" step="0.01" required value="${row?.earned_points ?? ''}" class="${fieldClass}" ${pending || isLocked ? 'disabled' : ''}></label><label class="sm:col-span-2">Umpan balik<textarea data-feedback maxlength="2000" class="${fieldClass}" ${pending || isLocked ? 'disabled' : ''}>${quizEscape(row?.feedback || '')}</textarea></label></div></article>`;
                    }).join('')}<p data-error class="text-rose-600 text-sm" role="alert"></p><button type="submit" class="${primaryClass}" ${pending || isLocked ? 'disabled' : ''}>Simpan dan terbitkan hasil</button></form>`;
                let dirty = false;
                let saving = false;
                const form = body.querySelector('form');
                const choose = body.querySelector('[data-attempt]');
                const unlockBtn = body.querySelector('[data-action-unlock]');
                const resetBtn = body.querySelector('[data-action-reset]');

                if (unlockBtn) {
                    unlockBtn.onclick = async () => {
                        if (!window.confirm('Buka kunci pengerjaan kuis siswa ini agar siswa dapat kembali melanjutkan pengerjaan?')) return;
                        unlockBtn.disabled = true;
                        try {
                            await api.unlock({ material_id: materialId, attempt_id: attempt.id });
                            attempt.is_locked = 0;
                            attempt.lock_reason = null;
                            notify('Kunci Dibuka', 'Kuis siswa berhasil dibuka. Siswa dapat melanjutkan pengerjaan.', 'success');
                            render(index);
                            Promise.resolve(refresh(materialId)).catch(() => {});
                        } catch (err) {
                            notify('Gagal Membuka Kunci', err.message, 'error');
                            unlockBtn.disabled = false;
                        }
                    };
                }

                if (resetBtn) {
                    resetBtn.onclick = async () => {
                        if (!window.confirm('PERINGATAN: Menyetujui reset akan MENGHAPUS pengerjaan terkunci ini. Seluruh progres dan jawaban siswa akan dihapus dan siswa harus mengulang dari awal. Lanjutkan?')) return;
                        resetBtn.disabled = true;
                        try {
                            await api.reset({ material_id: materialId, attempt_id: attempt.id });
                            notify('Pengerjaan Di-reset', 'Pengerjaan siswa telah di-reset. Siswa dapat mengulang kuis dari awal.', 'success');
                            res.data.splice(index, 1);
                            if (res.data.length > 0) {
                                render(Math.min(index, res.data.length - 1));
                            } else {
                                body.innerHTML = '<p class="p-4 text-center text-slate-500">Pengerjaan kuis telah di-reset. Belum ada riwayat pengerjaan lainnya.</p>';
                            }
                            Promise.resolve(refresh(materialId)).catch(() => {});
                        } catch (err) {
                            notify('Gagal Me-reset Pengerjaan', err.message, 'error');
                            resetBtn.disabled = false;
                        }
                    };
                }

                form.oninput = () => { dirty = true; };
                choose.onchange = () => { if (dirty && !window.confirm('Perubahan nilai belum disimpan. Pindah pengerjaan?')) { choose.value = index; return; } render(Number(choose.value)); };
                modal.querySelector('[data-close]').onclick = () => { if (!saving && (!dirty || window.confirm('Perubahan nilai belum disimpan. Tutup pemeriksaan?'))) modal.remove(); };
                form.onsubmit = async event => {
                    event.preventDefault();
                    if (saving || pending || token !== requestId || !form.isConnected || !form.reportValidity()) return;
                    saving = true;
                    const marks = {};
                    form.querySelectorAll('[data-question-id]').forEach(item => { marks[item.dataset.questionId] = { points: Number(item.querySelector('[data-points]').value), feedback: item.querySelector('[data-feedback]').value }; });
                    const button = form.querySelector('[type="submit"]');
                    button.disabled = true;
                    choose.disabled = true;
                    form.querySelectorAll('input, textarea').forEach(input => { input.disabled = true; });
                    try {
                        const saved = await api.review({ material_id: materialId, attempt_id: attempt.id, revision: attempt.revision, marks });
                        if (token !== requestId || !modal.isConnected) return;
                        dirty = false;
                        res.data[index] = saved.attempt;
                        render(index);
                        notify('Hasil diterbitkan', 'Nilai dan umpan balik sudah dapat dibuka siswa.', 'success');
                        Promise.resolve(refresh(materialId)).catch(() => {});
                    } catch (error) {
                        saving = false;
                        form.querySelector('[data-error]').textContent = error.message;
                        button.disabled = false; choose.disabled = false;
                        form.querySelectorAll('input, textarea').forEach(input => { input.disabled = false; });
                    }
                };
            };
            render(0);
        } catch (error) { body.textContent = error.message; }
    };
}
