/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { installQuizBuilder, installTeacherQuiz, quizQuestionMarkup } from '../js/lms-quiz-ui.mjs';
import { installStudentQuiz } from '../js/lms-quiz-student.mjs';

const html = fs.readFileSync(path.resolve('portal-siswa.html'), 'utf8');
const start = html.indexOf('<div id="modal-student-quiz"');
const markup = html.slice(start, html.indexOf('<!-- ===================== MODAL: UNGGAH', start));
const questions = [{ id: 'pg', type: 'mc', question: 'Pilih jawaban', options: ['Aman', '<img src=x onerror=alert(1)>'], points: 2 },
    { id: 'essay', type: 'essay', question: 'Jelaskan alasan', points: 3 }];
const makeAttempt = () => ({ id: 'attempt1', material_id: 'mat', revision: 0, student_name: 'Siswa Uji', status: 'in_progress', answers: {}, result: {},
    quiz: { passing_grade: 70, allow_retake: 1, questions }, started_at: new Date().toISOString(), server_now: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString() });
const material = { id: 'mat', title: 'Latihan IPA', subject_name: 'IPA' };
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('LMS quiz UI uses real builder and student/teacher controllers', () => {
    beforeEach(() => { jest.useFakeTimers(); document.body.innerHTML = markup; localStorage.clear(); jest.spyOn(window, 'confirm').mockReturnValue(true); });
    afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });
    test('builder rejects empty options and preserves the key when an earlier option is removed', () => {
        document.body.innerHTML = '<div class="lms-material-card"><input class="lms-quiz-kkm" value="0"><input class="lms-quiz-time" value="0"><input class="lms-quiz-retake" type="checkbox" checked><div class="lms-quiz-questions-list"></div></div>';
        const card = document.querySelector('.lms-material-card');
        installQuizBuilder({ notify: jest.fn() });
        window.addLmsQuizQuestion(card, 'mc', { id: 'one', type: 'mc', question: 'Soal', options: ['', 'B', 'C', 'D'], correct_option: 2, points: 5 });
        expect(() => window.serializeLmsQuizPayload(card)).toThrow('pilihan kosong');
        card.querySelector('[data-remove-option="0"]').click();
        const quiz = JSON.parse(window.serializeLmsQuizPayload(card));
        expect(quiz.passing_grade).toBe(0);
        expect(quiz.questions[0]).toMatchObject({ options: ['B', 'C', 'D'], correct_option: 1, points: 5 });
        card.querySelector('[data-remove-option="1"]').click();
        expect(() => window.serializeLmsQuizPayload(card)).toThrow('Pilih kunci');
    });
    test('question rendering escapes executable HTML and ignores non-HTTPS images', () => {
        document.body.innerHTML = quizQuestionMarkup({ question: '<img src=x onerror=alert(1)>', image_url: 'javascript:alert(2)' });
        expect(document.querySelector('img')).toBeNull();
        expect(document.body.textContent).toContain('<img');
    });
    test('compact optional fields keep image and explanation in the serialized quiz while collapsed',()=>{
        document.body.innerHTML='<div class="lms-material-card"><input class="lms-quiz-kkm" value="70"><input class="lms-quiz-time" value="10"><div class="lms-quiz-questions-list"></div></div>';
        const card=document.querySelector('.lms-material-card');installQuizBuilder({notify:jest.fn()});
        window.addLmsQuizQuestion(card,'short',{id:'q',question:'Apa jawabannya?',points:3,correct_answer:'A',image_url:'https://example.test/gambar.png',explanation:'Pembahasan tersimpan'});
        const item=card.querySelector('.lms-quiz-question-item'),optional=item.querySelector('.lms-quiz-optional');
        expect(item.querySelector('.lms-quiz-q-header .lms-quiz-points').value).toBe('3');expect(optional.open).toBe(false);
        expect(JSON.parse(window.serializeLmsQuizPayload(card)).questions[0]).toMatchObject({points:3,image_url:'https://example.test/gambar.png',explanation:'Pembahasan tersimpan',correct_answer:'A'});
        window.addLmsQuizQuestion(card,'essay',{question:'Soal baru'});expect(card.querySelectorAll('.lms-quiz-optional')[1].open).toBe(false);
    });
    test('each question switches type without losing fields or changing other question cards', () => {
        document.body.innerHTML = '<div class="lms-material-card"><input class="lms-quiz-kkm" value="70"><input class="lms-quiz-time" value="10"><div class="lms-quiz-questions-list"></div></div>';
        const card = document.querySelector('.lms-material-card');
        installQuizBuilder({ notify: jest.fn() });
        window.addLmsQuizQuestion(card, 'mc', { id: 'pg', question: 'Pertanyaan awal', options: ['A', 'B'], correct_option: 1,
            points: 5, image_url: 'https://example.test/image.png', explanation: 'Pembahasan' });
        window.addLmsQuizQuestion(card, 'short', { id: 'short', question: 'Soal lain', correct_answer: 'Oksigen' });
        const [item, other] = card.querySelectorAll('.lms-quiz-question-item');
        item.querySelector('.lms-quiz-q-text').value = 'Pertanyaan diubah';
        item.querySelector('.lms-quiz-mc-option').value = 'Pilihan diubah';
        item.querySelector('[data-quiz-type="short"]').click();
        expect(item.querySelector('[data-quiz-type="short"]').getAttribute('aria-pressed')).toBe('true');
        expect(item.querySelector('[data-quiz-type="mc"]').getAttribute('aria-pressed')).toBe('false');
        expect(item.querySelector('[data-quiz-answer-type="mc"]').classList.contains('hidden')).toBe(true);
        expect(item.querySelector('[data-quiz-answer-type="short"]').classList.contains('hidden')).toBe(false);
        expect(other.dataset.questionType).toBe('short');
        expect(other.querySelector('.lms-quiz-short-correct').value).toBe('Oksigen');
        item.querySelector('.lms-quiz-short-correct').value = 'Air';
        item.querySelector('.lms-quiz-short-variations').value = 'H2O\nair';
        let quiz = JSON.parse(window.serializeLmsQuizPayload(card));
        expect(quiz.questions[0]).toMatchObject({ id: 'pg', type: 'short', question: 'Pertanyaan diubah', points: 5,
            image_url: 'https://example.test/image.png', explanation: 'Pembahasan', correct_answer: 'Air', accepted_answers: ['Air', 'H2O', 'air'] });
        expect(quiz.questions[0]).not.toHaveProperty('options');
        expect(quiz.questions[0]).not.toHaveProperty('correct_option');
        item.querySelector('[data-quiz-type="mc"]').click();
        quiz = JSON.parse(window.serializeLmsQuizPayload(card));
        expect(quiz.questions[0]).toMatchObject({ id: 'pg', type: 'mc', options: ['Pilihan diubah', 'B'], correct_option: 1 });
        expect(quiz.questions[0]).not.toHaveProperty('correct_answer');
        item.querySelector('[data-quiz-type="short"]').click();
        expect(item.querySelector('.lms-quiz-short-correct').value).toBe('Air');
        expect(item.querySelector('.lms-quiz-short-variations').value).toBe('H2O\nair');
        expect(item.querySelector('.lms-quiz-q-num').textContent).toBe('Soal 1');
        expect(other.querySelector('.lms-quiz-q-num').textContent).toBe('Soal 2');
        window.moveLmsQuizQuestion(item.querySelector('button'), 1);
        expect(JSON.parse(window.serializeLmsQuizPayload(card)).questions.map(q => q.id)).toEqual(['short', 'pg']);
        expect(item.dataset.questionType).toBe('short');
        expect(item.querySelector('.lms-quiz-q-num').textContent).toBe('Soal 2');
    });
    test.each(['mc', 'short', 'essay'])('editing a stored %s question selects its toggle and keeps that type in preview/save', type => {
        document.body.innerHTML = '<div class="lms-material-card"><input class="lms-quiz-kkm" value="70"><input class="lms-quiz-time" value="10"><div class="lms-quiz-questions-list"></div></div>';
        const card = document.querySelector('.lms-material-card');
        installQuizBuilder({ notify: jest.fn() });
        window.addLmsQuizQuestion(card, 'mc', { id: 'stored', type, question: 'Soal tersimpan', options: ['A', 'B'],
            correct_option: 0, correct_answer: 'Kunci', accepted_answers: ['Kunci', 'Alternatif'], grading_guidance: 'Pedoman', points: 3 });
        const item = card.querySelector('.lms-quiz-question-item');
        expect(item.querySelector(`[data-quiz-type="${type}"]`).getAttribute('aria-pressed')).toBe('true');
        expect(item.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
        expect(JSON.parse(window.serializeLmsQuizPayload(card)).questions[0].type).toBe(type);
        window.previewLmsQuiz(card);
        expect(document.querySelector('#lms-quiz-preview').textContent).toContain({ mc: 'Pilihan ganda', short: 'Isian singkat', essay: 'Uraian' }[type]);
    });
    test.each(['short', 'essay'])('%s can be saved, previewed and reopened without an answer key or rubric', type => {
        document.body.innerHTML = '<div class="lms-material-card"><input class="lms-quiz-kkm" value="70"><input class="lms-quiz-time" value="0"><div class="lms-quiz-questions-list"></div></div>';
        const card = document.querySelector('.lms-material-card');
        const notify = jest.fn();
        installQuizBuilder({ notify });
        window.addLmsQuizQuestion(card, type, { id: 'optional', question: 'Tuliskan pendapatmu', points: 5 });
        const input = card.querySelector(type === 'short' ? '.lms-quiz-short-correct' : '.lms-quiz-guidance');
        expect(input.closest('label').textContent).toContain('opsional');
        expect(input.required).toBe(false);
        input.value = '  \n ';
        const question = JSON.parse(window.serializeLmsQuizPayload(card)).questions[0];
        expect(question).toMatchObject(type === 'short' ? { correct_answer: '', accepted_answers: [] } : { grading_guidance: '' });
        window.previewLmsQuiz(card);
        expect(document.querySelector('#lms-quiz-preview').textContent).toContain('Tuliskan pendapatmu');
        expect(notify).not.toHaveBeenCalled();
        card.querySelector('.lms-quiz-questions-list').innerHTML = '';
        window.addLmsQuizQuestion(card, 'mc', question);
        expect(JSON.parse(window.serializeLmsQuizPayload(card)).questions[0]).toEqual(question);
    });
    test('only the selected type is validated; switching keeps essay guidance and the question ID', () => {
        document.body.innerHTML = '<div class="lms-material-card"><input class="lms-quiz-kkm" value="70"><input class="lms-quiz-time" value="10"><div class="lms-quiz-questions-list"></div></div>';
        const card = document.querySelector('.lms-material-card');
        installQuizBuilder({ notify: jest.fn() }); window.addLmsQuizQuestion(card, 'mc', { id: 'one', question: 'Soal' });
        const item = card.querySelector('.lms-quiz-question-item');
        item.querySelector('[data-quiz-type="short"]').click();
        expect(JSON.parse(window.serializeLmsQuizPayload(card)).questions[0]).toMatchObject({ correct_answer: '', accepted_answers: [] });
        item.querySelector('.lms-quiz-short-variations').value = 'Jawaban\n  Alternatif  \n\nJawaban';
        expect(JSON.parse(window.serializeLmsQuizPayload(card)).questions[0]).toMatchObject({ correct_answer: '', accepted_answers: ['Jawaban', 'Alternatif'] });
        item.querySelector('[data-quiz-type="essay"]').click(); item.querySelector('.lms-quiz-guidance').value = 'Rubrik 5 poin';
        item.querySelector('[data-quiz-type="mc"]').click();
        expect(() => window.serializeLmsQuizPayload(card)).toThrow('pilihan kosong');
        item.querySelector('[data-quiz-type="essay"]').click();
        expect(JSON.parse(window.serializeLmsQuizPayload(card)).questions[0]).toMatchObject({ id: 'one', type: 'essay', grading_guidance: 'Rubrik 5 poin' });
    });
    test('student input survives failed saves and reopening; radio options are accessible and escaped', async () => {
        const attempt = makeAttempt();
        const api = { start: jest.fn(async () => ({ attempt: JSON.parse(JSON.stringify(attempt)) })), save: jest.fn(async () => { throw new Error('Jaringan putus'); }), submit: jest.fn() };
        const controller = installStudentQuiz({ api, getMaterial: () => material, getStudentId: () => '100', onResult: jest.fn(), notify: jest.fn() });
        await window.openStudentQuiz('mat');
        expect(document.querySelectorAll('#student-quiz-answer-container input[type="radio"]')).toHaveLength(2);
        expect(document.querySelector('#student-quiz-answer-container img')).toBeNull();
        window.jumpToStudentQuizQuestion(1);
        const input = document.getElementById('student-quiz-answer');
        input.value = 'Alasan saya\nContoh lengkap'; input.dispatchEvent(new Event('input'));
        window.closeStudentQuizModal(); await settle();
        await window.openStudentQuiz('mat'); window.jumpToStudentQuizQuestion(1);
        expect(document.getElementById('student-quiz-answer').value).toBe('Alasan saya\nContoh lengkap');
        expect(controller.getState().attempt.expires_at).toBe(attempt.expires_at);
    });
    test('submit blocks double requests and displays pending without a zero grade', async () => {
        const attempt = makeAttempt(); let complete;
        const api = { start: jest.fn(async () => ({ attempt: JSON.parse(JSON.stringify(attempt)) })), save: jest.fn(async () => ({ revision: 1 })), submit: jest.fn(() => new Promise(resolve => { complete = resolve; })) };
        const onResult = jest.fn();
        installStudentQuiz({ api, getMaterial: () => material, getStudentId: () => '100', onResult, notify: jest.fn() });
        await window.openStudentQuiz('mat'); window.jumpToStudentQuizQuestion(1);
        const input = document.getElementById('student-quiz-answer'); input.value = 'Jawaban uraian'; input.dispatchEvent(new Event('input'));
        const first = window.submitStudentQuiz(); await settle();
        await window.submitStudentQuiz(); expect(api.submit).toHaveBeenCalledTimes(1);
        const pending = { ...attempt, status: 'pending_review', revision: 1, answers: { essay: 'Jawaban uraian' }, result: { status: 'pending_review', score: null, review: [{ ...questions[1], student_answer: 'Jawaban uraian', earned_points: null }] } };
        complete({ attempt: pending }); await first;
        expect(document.getElementById('student-quiz-result-title').textContent).toBe('Menunggu pemeriksaan guru');
        expect(document.getElementById('student-quiz-result-score').textContent).toBe('—');
        expect(document.getElementById('btn-quiz-retake').classList.contains('hidden')).toBe(true);
        expect(onResult).toHaveBeenCalledWith(material, pending);
    });
    test('passing the module target preserves an open quiz, its own countdown and local answer backup', async () => {
        const attempt = makeAttempt();
        const scheduled = { ...material, is_published: 2, publish_at: new Date(Date.now() - 1000).toISOString(), due_date: new Date(Date.now() + 10000).toISOString() };
        const api = { start: jest.fn(async () => ({ attempt })), save: jest.fn(async () => ({ revision: 1 })), submit: jest.fn() };
        const controller = installStudentQuiz({ api, getMaterial: () => scheduled, getStudentId: () => '100', onResult: jest.fn(), notify: jest.fn() });
        await window.openStudentQuiz('mat');
        expect(document.getElementById('student-quiz-timer-text').textContent).toBe('01:00');
        window.jumpToStudentQuizQuestion(1);
        const input = document.getElementById('student-quiz-answer');
        input.value = 'Jawaban sebelum jadwal tutup'; input.dispatchEvent(new Event('input'));
        await jest.advanceTimersByTimeAsync(10000);
        expect(document.getElementById('modal-student-quiz').classList.contains('hidden')).toBe(false);
        expect(controller.getState().attempt.id).toBe(attempt.id);
        expect(document.getElementById('student-quiz-timer-text').textContent).toBe('00:50');
        expect(document.getElementById('student-quiz-answer').value).toBe('Jawaban sebelum jadwal tutup');
        expect(api.submit).not.toHaveBeenCalled();
        expect(JSON.parse(localStorage.getItem('simas.quiz.100.attempt1')).answers.essay).toBe('Jawaban sebelum jadwal tutup');
    });
    test('a failed submit keeps the complete answer and succeeds on retry', async () => {
        const attempt = makeAttempt();
        const api = { start: jest.fn(async () => ({ attempt })), save: jest.fn(async () => ({ revision: 1 })),
            submit: jest.fn().mockRejectedValueOnce(new Error('Koneksi terputus')).mockImplementationOnce(async body => ({ attempt: { ...attempt, answers: body.answers, status: 'pending_review', result: { score: null, review: [] } } })) };
        installStudentQuiz({ api, getMaterial: () => material, getStudentId: () => '100', onResult: jest.fn(), notify: jest.fn() });
        await window.openStudentQuiz('mat'); window.jumpToStudentQuizQuestion(1);
        const input = document.getElementById('student-quiz-answer'); input.value = 'Jawaban saat jaringan putus'; input.dispatchEvent(new Event('input'));
        await window.submitStudentQuiz();
        expect(document.getElementById('student-quiz-save-status').textContent).toContain('belum terkirim');
        expect(document.getElementById('student-quiz-answer').value).toBe('Jawaban saat jaringan putus');
        expect(document.getElementById('btn-quiz-submit').disabled).toBe(false);
        await window.submitStudentQuiz();
        expect(api.submit.mock.calls[1][0].answers.essay).toBe('Jawaban saat jaringan putus');
        expect(localStorage.getItem('simas.quiz.100.attempt1')).toBeNull();
    });
    test('a lost save response does not discard newer local edits on reopening', async () => {
        const attempt = makeAttempt(); let rejectSave;
        const api = { start: jest.fn(async () => ({ attempt: JSON.parse(JSON.stringify(attempt)) })),
            save: jest.fn(body => { attempt.answers = body.answers; attempt.revision++; return new Promise((resolve, reject) => { rejectSave = reject; }); }), submit: jest.fn() };
        installStudentQuiz({ api, getMaterial: () => material, getStudentId: () => '100', onResult: jest.fn(), notify: jest.fn() });
        await window.openStudentQuiz('mat'); window.jumpToStudentQuizQuestion(1);
        let input = document.getElementById('student-quiz-answer'); input.value = 'Draf tersimpan'; input.dispatchEvent(new Event('input'));
        await jest.advanceTimersByTimeAsync(4000);
        input.value = 'Draf tersimpan dan tambahan terbaru'; input.dispatchEvent(new Event('input'));
        rejectSave(new Error('Respons jaringan hilang')); await settle();
        api.save.mockRejectedValue(new Error('Data telah berubah. Buka kembali kuis.'));
        window.closeStudentQuizModal(); await settle();
        await window.openStudentQuiz('mat'); window.jumpToStudentQuizQuestion(1);
        expect(document.getElementById('student-quiz-answer').value).toBe('Draf tersimpan dan tambahan terbaru');
    });
    test('deadline submits once, prevents further editing and keeps the retry button after network failure', async () => {
        const attempt = makeAttempt(); attempt.expires_at = new Date(Date.now() + 1500).toISOString();
        const api = { start: jest.fn(async () => ({ attempt })), save: jest.fn(), submit: jest.fn(async () => { throw new Error('Jaringan putus'); }) };
        installStudentQuiz({ api, getMaterial: () => material, getStudentId: () => '100', onResult: jest.fn(), notify: jest.fn() });
        await window.openStudentQuiz('mat');
        document.querySelector('input[name="student-quiz-option"]').click();
        await jest.advanceTimersByTimeAsync(3000);
        expect(api.submit).toHaveBeenCalledTimes(1);
        expect(api.submit.mock.calls[0][0].answers.pg).toBe(0);
        expect(document.querySelector('#student-quiz-answer-container fieldset').disabled).toBe(true);
        expect(document.getElementById('btn-quiz-submit').textContent).toBe('Coba kirim lagi');
        await jest.advanceTimersByTimeAsync(3000);
        expect(api.submit).toHaveBeenCalledTimes(1);
    });
    test('teacher can publish marks and feedback without losing the original response', async () => {
        const attempt = { ...makeAttempt(), status: 'pending_review', answers: { pg: 0, essay: 'Jawaban panjang siswa' },
            result: { review: [{ ...questions[0], earned_points: 2, feedback: '' }, { ...questions[1], earned_points: null, feedback: '' }] } };
        const api = { list: jest.fn(async () => ({ data: [attempt] })), review: jest.fn(async body => ({ attempt: { ...attempt, revision: 1, status: 'graded', result: { score: 80, review: attempt.result.review.map(q => ({ ...q, earned_points: body.marks[q.id].points, feedback: body.marks[q.id].feedback })) } } })) };
        installTeacherQuiz({ api, getMaterial: () => material, refresh: jest.fn(), notify: jest.fn() });
        await window.openLmsQuizReview('mat', '100');
        const item = document.querySelector('[data-question-id="essay"]');
        item.querySelector('[data-points]').value = '2'; item.querySelector('[data-feedback]').value = 'Tambahkan contoh';
        document.querySelector('[data-review-form]').dispatchEvent(new Event('submit', { cancelable: true })); await settle();
        expect(api.review).toHaveBeenCalledWith(expect.objectContaining({ attempt_id: 'attempt1', revision: 0, marks: { pg: { points: 2, feedback: '' }, essay: { points: 2, feedback: 'Tambahkan contoh' } } }));
        expect(document.getElementById('lms-quiz-review').textContent).toContain('Jawaban panjang siswa');
        expect(document.querySelector('[data-question-id="essay"] [data-feedback]').value).toBe('Tambahkan contoh');
    });
    test('reopening a published result refreshes the student course progress', async () => {
        const attempt = { ...makeAttempt(), status: 'graded', result: { score: 80, passed: true, earned_points: 4, total_points: 5, passing_grade: 70, review: [] } };
        const onResult = jest.fn();
        installStudentQuiz({ api: { start: async () => ({ attempt }) }, getMaterial: () => material, getStudentId: () => '100', onResult, notify: jest.fn() });
        await window.openStudentQuiz('mat'); await settle();
        expect(onResult).toHaveBeenCalledWith(material, attempt);
        expect(document.getElementById('student-quiz-result-score').textContent).toBe('80');
    });
    test('teacher marking survives save failures and rejects duplicate submission while busy', async () => {
        const attempt = { ...makeAttempt(), status: 'pending_review', result: { review: questions.map(q => ({ ...q, earned_points: 1 })) } };
        let reject;
        const api = { list: jest.fn(async () => ({ data: [attempt] })), review: jest.fn(() => new Promise((resolve, failed) => { reject = failed; })) };
        installTeacherQuiz({ api, getMaterial: () => material, refresh: jest.fn(), notify: jest.fn() });
        await window.openLmsQuizReview('mat', '100');
        document.querySelector('[data-question-id="essay"] [data-feedback]').value = 'Komentar tidak boleh hilang';
        const form = document.querySelector('[data-review-form]');
        form.dispatchEvent(new Event('submit', { cancelable: true }));
        form.dispatchEvent(new Event('submit', { cancelable: true }));
        expect(api.review).toHaveBeenCalledTimes(1);
        document.querySelector('#lms-quiz-review [data-close]').click();
        expect(form.isConnected).toBe(true);
        reject(new Error('Gagal menyimpan')); await settle();
        expect(form.querySelector('[data-error]').textContent).toBe('Gagal menyimpan');
        expect(form.querySelector('[type="submit"]').disabled).toBe(false);
        expect(form.querySelector('[data-question-id="essay"] [data-feedback]').value).toBe('Komentar tidak boleh hilang');
    });
});
