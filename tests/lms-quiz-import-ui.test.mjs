/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { installQuizBuilder } from '../js/lms-quiz-ui.mjs';
import { QUIZ_TEXT_TEMPLATE } from '../js/lms-quiz-import.mjs';
const cardMarkup = '<section class="lms-material-card"><input class="lms-quiz-kkm" value="70"><input class="lms-quiz-time" value="10"><div class="lms-quiz-questions-list"></div></section>';
let card, notify;
const open = () => { window.openLmsQuizImport(card); return document.getElementById('lms-quiz-import'); };
const preview = (modal, text) => {
    const input = modal.querySelector('[data-import-text]'); input.value = text; input.dispatchEvent(new Event('input'));
    modal.querySelector('[data-import-preview]').click();
};
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const aiDraft = () => ({ questions: [{ type: 'short', question: 'Gas hasil fotosintesis?', correct_answer: '', accepted_answers: [], points: 1 }], warnings: ['Periksa teks hasil AI.'], sourceText: '' });
const aiService = (available = true) => ({ getAvailability: jest.fn(async () => ({ available, message: available ? 'API key tersimpan.' : 'API key belum tersimpan.' })), parse: jest.fn(async () => aiDraft()) });
const openAi = async service => { installQuizBuilder({ notify, aiImport: service }); const modal = open(); await settle(); return modal; };
beforeEach(() => { document.body.innerHTML = cardMarkup + cardMarkup; card = document.querySelector('.lms-material-card'); notify = jest.fn(); installQuizBuilder({ notify }); });
afterEach(() => jest.restoreAllMocks());
test('reviewing is read-only, applying replaces only an empty placeholder and preserves optional fields', () => {
    window.addLmsQuizQuestion(card);
    const other = document.querySelectorAll('.lms-material-card')[1];
    window.addLmsQuizQuestion(other, 'essay', { question: 'Soal kuis lain' });
    const modal = open(); preview(modal, QUIZ_TEXT_TEMPLATE);
    expect(card.querySelectorAll('.lms-quiz-question-item')).toHaveLength(1);
    expect(modal.querySelector('[data-import-preview-list]').textContent).toContain('3 soal ditemukan');
    modal.querySelector('[data-import-apply]').click();
    const quiz = JSON.parse(window.serializeLmsQuizPayload(card));
    expect(quiz.questions.map(q => q.type)).toEqual(['mc', 'short', 'essay']);
    expect(quiz.questions[0].correct_option).toBe(1);
    expect(quiz.questions[2].grading_guidance).toBe('');
    expect(other.querySelectorAll('.lms-quiz-question-item')).toHaveLength(1);
    expect(document.getElementById('lms-quiz-import')).toBeNull();
    expect(notify).toHaveBeenCalledWith('Soal diimpor', expect.stringContaining('3 soal'), 'success');
});
test('append preserves existing question IDs/edits and generates unique IDs for repeated imports', () => {
    window.addLmsQuizQuestion(card, 'essay', { id: 'original', question: 'Soal lama', grading_guidance: 'Pedoman lama' });
    for (let n = 0; n < 2; n++) { const modal = open(); preview(modal, '1. [Isian Singkat] Soal baru'); modal.querySelector('[data-import-apply]').click(); }
    const quiz = JSON.parse(window.serializeLmsQuizPayload(card));
    expect(quiz.questions).toHaveLength(3);
    expect(quiz.questions[0]).toMatchObject({ id: 'original', question: 'Soal lama', grading_guidance: 'Pedoman lama' });
    expect(new Set(quiz.questions.map(q => q.id)).size).toBe(3);
    expect(quiz.questions[1]).toMatchObject({ correct_answer: '', accepted_answers: [] });
});
test('editing after preview invalidates import, cancel is read-only and bad input never partially appends', () => {
    window.addLmsQuizQuestion(card, 'essay', { question: 'Pertahankan' });
    let modal = open(); preview(modal, QUIZ_TEXT_TEMPLATE);
    const input = modal.querySelector('[data-import-text]'); input.value += '\n4. [PG] Rusak'; input.dispatchEvent(new Event('input'));
    expect(modal.querySelector('[data-import-apply]').disabled).toBe(true);
    modal.querySelector('[data-import-preview]').click();
    expect(modal.querySelector('[data-import-error]').textContent).toContain('2–5 pilihan');
    expect(card.querySelectorAll('.lms-quiz-question-item')).toHaveLength(1);
    modal.querySelector('[data-close]').click();
    expect(JSON.parse(window.serializeLmsQuizPayload(card)).questions[0].question).toBe('Pertahankan');
});
test('capacity is checked before preview and again before apply', () => {
    for (let i = 0; i < 49; i++) window.addLmsQuizQuestion(card, 'essay', { question: `Soal ${i}` });
    const modal = open(); preview(modal, QUIZ_TEXT_TEMPLATE);
    expect(modal.querySelector('[data-import-error]').textContent).toContain('50 soal');
    preview(modal, '1. Soal baru');
    window.addLmsQuizQuestion(card, 'essay', { question: 'Soal tambahan' });
    modal.querySelector('[data-import-apply]').click();
    expect(card.querySelectorAll('.lms-quiz-question-item')).toHaveLength(50);
    expect(modal.querySelector('[data-import-error]').textContent).toContain('50 soal');
});
test('imported markup is escaped, missing PG key is explained and remains editable', () => {
    const modal = open(); preview(modal, '1. <img src=x onerror=alert(1)>\nA. <script>alert(1)</script>\nB. Aman');
    expect(modal.querySelector('[data-import-preview-list] img')).toBeNull();
    expect(modal.querySelector('[data-import-preview-list] script')).toBeNull();
    expect(modal.querySelector('[data-import-preview-list]').textContent).toContain('pilih kunci PG');
    modal.querySelector('[data-import-apply]').click();
    expect(() => window.serializeLmsQuizPayload(card)).toThrow('Pilih kunci');
    card.querySelector('.lms-quiz-mc-radio').checked = true;
    expect(JSON.parse(window.serializeLmsQuizPayload(card)).questions[0].correct_option).toBe(0);
});
test('failed file reads preserve existing work and stale file completions cannot overwrite a newer import', async () => {
    window.addLmsQuizQuestion(card, 'essay', { question: 'Soal lama' });
    const modal = open(), input = modal.querySelector('[data-import-file]');
    const select = value => Object.defineProperty(input, 'files', { configurable: true, value: [value] });
    select({ name: 'rusak.docx', size: 11 * 1024 * 1024 }); await input.onchange();
    expect(modal.querySelector('[data-import-error]').textContent).toContain('10 MB');
    expect(card.querySelectorAll('.lms-quiz-question-item')).toHaveLength(1);
    let complete;
    select({ name: 'pertama.txt', size: 20, text: () => new Promise(resolve => { complete = resolve; }) });
    const pending = input.onchange();
    select({ name: 'kedua.txt', size: 20, text: async () => '1. Sumber terbaru' }); await input.onchange();
    complete('1. Sumber lama'); await pending;
    expect(modal.querySelector('[data-import-text]').value).toBe('1. Sumber terbaru');
    expect(modal.querySelector('[data-import-preview-list]').textContent).toContain('Sumber terbaru');
    expect(modal.querySelector('[data-import-apply]').disabled).toBe(false);
});
test('saved teacher key enables AI for pasted text without numbering, previews first and preserves optional keys', async () => {
    window.addLmsQuizQuestion(card);
    const service = aiService(), modal = await openAi(service);
    expect(modal.querySelector('[data-import-ai]').checked).toBe(true);
    expect(modal.querySelector('[data-import-preview]').textContent).toBe('Rapikan dengan AI');
    const text = modal.querySelector('[data-import-text]');
    text.value = 'Soal dari internet / hasil AI lain:\nSebutkan gas hasil fotosintesis!'; text.dispatchEvent(new Event('input'));
    await modal.querySelector('[data-import-preview]').onclick();
    expect(service.parse).toHaveBeenCalledWith(expect.objectContaining({ text: text.value, file: null }));
    expect(modal.querySelector('[data-import-preview-list]').textContent).toContain('1 soal ditemukan');
    expect(card.querySelectorAll('.lms-quiz-question-item')).toHaveLength(1);
    modal.querySelector('[data-import-apply]').click();
    expect(JSON.parse(window.serializeLmsQuizPayload(card)).questions[0]).toMatchObject({ type: 'short', correct_answer: '', accepted_answers: [] });
});
test('missing keys keep ordinary import usable; reopening modal detects a newly saved key and teachers can disable AI', async () => {
    const service = aiService(false), modal = await openAi(service);
    const toggle = modal.querySelector('[data-import-ai]');
    expect(toggle.checked).toBe(false); expect(toggle.disabled).toBe(true);
    preview(modal, '1. [Uraian] Soal tanpa API key');
    expect(modal.querySelector('[data-import-apply]').disabled).toBe(false);
    expect(service.parse).not.toHaveBeenCalled();
    service.getAvailability.mockResolvedValue({ available: true, message: 'Key baru tersimpan.' });
    // Guru menyimpan API key lalu membuka ulang modal kuis
    const reloadedModal = await openAi(service);
    const reloadedToggle = reloadedModal.querySelector('[data-import-ai]');
    expect(reloadedToggle.checked).toBe(true); expect(reloadedToggle.disabled).toBe(false);
    expect(reloadedModal.querySelector('[data-import-apply]').disabled).toBe(true);
    reloadedToggle.checked = false; reloadedToggle.dispatchEvent(new Event('change'));
    preview(reloadedModal, '1. [Uraian] Tetap gunakan impor biasa');
    expect(service.parse).not.toHaveBeenCalled();
    expect(reloadedModal.querySelector('[data-import-apply]').disabled).toBe(false);
});
test('PDF uploads use AI directly when enabled, including scan files without local text', async () => {
    const service = aiService(), modal = await openAi(service), input = modal.querySelector('[data-import-file]');
    const file = { name: 'Scan-soal.pdf', size: 100 };
    Object.defineProperty(input, 'files', { value: [file] });
    await input.onchange();
    expect(service.parse).toHaveBeenCalledWith(expect.objectContaining({ file }));
    expect(modal.querySelector('[data-import-source]').textContent).toContain('dibaca dengan AI');
    expect(modal.querySelector('[data-import-preview-list]').textContent).toContain('Gas hasil fotosintesis?');
});
test('cancelling ignores late AI responses and retains pasted source and existing questions', async () => {
    window.addLmsQuizQuestion(card, 'essay', { id: 'old', question: 'Soal lama' });
    const service = aiService(); let finish;
    service.parse.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const modal = await openAi(service), text = modal.querySelector('[data-import-text]');
    text.value = 'Naskah bebas'; text.dispatchEvent(new Event('input'));
    const pending = modal.querySelector('[data-import-preview]').onclick(); await settle();
    expect(modal.querySelector('[data-import-cancel]').hidden).toBe(false);
    const signal = service.parse.mock.calls[0][0].signal;
    modal.querySelector('[data-import-cancel]').click();
    expect(signal.aborted).toBe(true);
    finish(aiDraft()); await pending;
    expect(text.value).toBe('Naskah bebas'); expect(text.disabled).toBe(false);
    expect(modal.querySelector('[data-import-apply]').disabled).toBe(true);
    expect(JSON.parse(window.serializeLmsQuizPayload(card)).questions[0]).toMatchObject({ id: 'old', question: 'Soal lama' });
});
test('closing an importer cancels AI and an old response cannot populate a newly opened importer', async () => {
    const service = aiService(); let finish;
    service.parse.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = await openAi(service);
    first.querySelector('[data-import-text]').value = 'Naskah pertama';
    const pending = first.querySelector('[data-import-preview]').onclick(); await settle();
    const signal = service.parse.mock.calls[0][0].signal;
    const second = open(); await settle();
    expect(signal.aborted).toBe(true);
    finish(aiDraft()); await pending;
    expect(second.querySelector('[data-import-preview-list]').textContent).toBe('');
    expect(second.querySelector('[data-import-apply]').disabled).toBe(true);
});
test('AI errors never replace existing work or silently run another request', async () => {
    window.addLmsQuizQuestion(card, 'essay', { question: 'Soal lama' });
    const service = aiService(); service.parse.mockRejectedValue(new Error('Kuota API key guru habis.'));
    const modal = await openAi(service), text = modal.querySelector('[data-import-text]');
    text.value = 'Naskah yang belum dirapikan'; text.dispatchEvent(new Event('input'));
    await modal.querySelector('[data-import-preview]').onclick();
    expect(modal.querySelector('[data-import-error]').textContent).toContain('Kuota API key');
    expect(text.value).toBe('Naskah yang belum dirapikan'); expect(text.disabled).toBe(false);
    expect(service.parse).toHaveBeenCalledTimes(1);
    expect(modal.querySelector('[data-import-apply]').disabled).toBe(true);
    expect(JSON.parse(window.serializeLmsQuizPayload(card)).questions[0].question).toBe('Soal lama');
});
test('a failed AI file import can switch to ordinary import without selecting the file again', async () => {
    const service = aiService(); service.parse.mockRejectedValue(new Error('Kuota API key guru habis.'));
    const modal = await openAi(service), input = modal.querySelector('[data-import-file]');
    Object.defineProperty(input, 'files', { value: [{ name: 'Soal.txt', size: 40, text: async () => '1. [Uraian] Soal dari berkas asli' }] });
    await input.onchange();
    expect(modal.querySelector('[data-import-error]').textContent).toContain('Kuota API key');
    const toggle = modal.querySelector('[data-import-ai]'); toggle.checked = false; toggle.dispatchEvent(new Event('change'));
    await modal.querySelector('[data-import-preview]').onclick();
    expect(modal.querySelector('[data-import-preview-list]').textContent).toContain('Soal dari berkas asli');
    expect(modal.querySelector('[data-import-apply]').disabled).toBe(false);
    expect(service.parse).toHaveBeenCalledTimes(1);
});

test('AI prompt generator auto-fills subject and grade from filter, supports chapter, topic, and mixed difficulty checkbox', async () => {
    // Setup simulated page filters
    const selMapel = document.createElement('select');
    selMapel.id = 'select-mapel';
    selMapel.innerHTML = '<option value="Fisika" selected>Fisika</option>';
    document.body.appendChild(selMapel);

    const selKelas = document.createElement('select');
    selKelas.id = 'select-kelas';
    selKelas.innerHTML = '<option value="XI-F-1" selected>XI-F-1</option>';
    document.body.appendChild(selKelas);

    const modal = open();
    const subjectInput = modal.querySelector('[data-prompt-subject]');
    const gradeInput = modal.querySelector('[data-prompt-grade]');
    const chapterInput = modal.querySelector('[data-prompt-chapter]');
    const topicInput = modal.querySelector('[data-prompt-topic]');
    const diffSelect = modal.querySelector('[data-prompt-difficulty]');
    const mixDiffCheckbox = modal.querySelector('[data-prompt-mix-diff]');
    const pgInput = modal.querySelector('[data-prompt-pg]');
    const output = modal.querySelector('[data-prompt-output]');
    const copyBtn = modal.querySelector('[data-prompt-copy]');

    // 1. Verifikasi auto-fill dari filter
    expect(subjectInput.value).toBe('Fisika');
    expect(gradeInput.value).toContain('SMA Kelas 11 (XI-F-1)');
    expect(output.value).toContain('- Mata Pelajaran : Fisika');
    expect(output.value).toContain('- Jenjang / Kelas: SMA Kelas 11 (XI-F-1)');
    expect(output.value).toContain('Sebanyak 5 soal Pilihan Ganda (PG). Setiap soal PG WAJIB memiliki tepat 5 pilihan jawaban (A, B, C, D, E)');
    expect(output.value).toContain('LaTeX baku yang diapit tanda $...$');

    // 2. Guru menginput Judul Bab & Materi
    chapterInput.value = 'Bab 3 - Termodinamika';
    chapterInput.dispatchEvent(new Event('input'));
    topicInput.value = 'Hukum I Termodinamika & Kalor';
    topicInput.dispatchEvent(new Event('input'));
    pgInput.value = '10';
    pgInput.dispatchEvent(new Event('input'));

    expect(output.value).toContain('- Bab / Topik    : Bab 3 - Termodinamika');
    expect(output.value).toContain('- Materi Spesifik: Hukum I Termodinamika & Kalor');
    expect(output.value).toContain('Sebanyak 10 soal Pilihan Ganda (PG)');

    // 3. Uji ceklist tingkat kesulitan campur
    expect(mixDiffCheckbox.checked).toBe(false);
    expect(diffSelect.disabled).toBe(false);
    expect(output.value).toContain('- Tingkat Kesulitan: Sedang');

    mixDiffCheckbox.checked = true;
    mixDiffCheckbox.dispatchEvent(new Event('change'));

    expect(diffSelect.disabled).toBe(true);
    expect(output.value).toContain('- Tingkat Kesulitan: Kombinasi campuran proporsional (Mudah ~30%, Sedang ~50%, Sulit/HOTS ~20%)');

    // 4. Test salin ke clipboard
    let copiedText = '';
    globalThis.navigator.clipboard = {
        writeText: jest.fn(async text => { copiedText = text; })
    };
    await copyBtn.onclick();
    expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledWith(output.value);
    expect(copiedText).toContain('Bab 3 - Termodinamika');
    expect(copiedText).toContain('Hukum I Termodinamika & Kalor');
    expect(copiedText).toContain('Kombinasi campuran proporsional');

    // Cleanup simulated elements
    selMapel.remove();
    selKelas.remove();
});

test('manual question editor includes math toolbar that inserts symbols and live preview renders KaTeX/markdown', async () => {
    window.addLmsQuizQuestion(card);
    const item = card.querySelector('.lms-quiz-question-item');
    const qText = item.querySelector('.lms-quiz-q-text');
    item.querySelector('[data-action="math-palette-q"]').click();
    const mathModal = document.getElementById('lms-math-palette-popover') || document.getElementById('lms-math-palette-modal');
    const mathBtn = mathModal.querySelector('[data-insert-math="x²"]');
    const fracBtn = mathModal.querySelector('[title="Pecahan a/b"]');
    const previewBtn = item.querySelector('[data-toggle-math-preview]');
    const previewContainer = item.querySelector('.lms-quiz-q-preview');

    expect(mathBtn).not.toBeNull();
    expect(fracBtn).not.toBeNull();
    expect(previewContainer.classList.contains('hidden')).toBe(true);

    qText.value = 'Hitung nilai f(x) = ';
    qText.selectionStart = qText.value.length;
    qText.selectionEnd = qText.value.length;

    mathBtn.onclick();
    expect(qText.value).toBe('Hitung nilai f(x) = x²');

    // Toggle live math preview
    previewBtn.onclick();
    expect(previewContainer.classList.contains('hidden')).toBe(false);
    expect(previewContainer.innerHTML).toContain('x²');

    // Insert LaTeX fraction
    fracBtn.onclick();
    expect(qText.value).toContain('\\frac{a}{b}');
    expect(previewContainer.innerHTML).toContain('border-b');
    expect(previewContainer.textContent).toContain('a');
    expect(previewContainer.textContent).toContain('b');
});

test('preview button is disabled by default and only enabled when content is present', () => {
    const modal = open();
    const readBtn = modal.querySelector('[data-import-preview]');
    const textArea = modal.querySelector('[data-import-text]');

    // 1. Awal modal dibuka: tombol harus disabled
    expect(readBtn.disabled).toBe(true);

    // 2. Klik tombol saat disabled tidak memicu proses apa pun
    readBtn.click();
    expect(modal.querySelector('[data-import-error]').textContent).toBe('');
    expect(modal.querySelector('[data-import-preview-list]').textContent).toBe('');

    // 3. Mengetik / menempel naskah soal mengaktifkan tombol
    textArea.value = '1. [PG] Apa ibukota Indonesia?\nA. Jakarta\nB. IKN';
    textArea.dispatchEvent(new Event('input'));
    expect(readBtn.disabled).toBe(false);

    // 4. Mengosongkan kembali naskah menonaktifkan tombol lagi
    textArea.value = '   ';
    textArea.dispatchEvent(new Event('input'));
    expect(readBtn.disabled).toBe(true);
});
