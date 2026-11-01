const { harness, sampleQuiz, read } = require('./helpers/lms-quiz-harness.cjs');

describe('LMS quiz: real Worker and SQLite', () => {
    let h;
    afterEach(() => h?.sqlite.close());
    test('migration is repeatable and preserves materials', () => {
        h = harness(); h.sqlite.exec(read('cloudflare/migrations/202609200002_lms_quiz_attempts.sql'));
        expect(h.sqlite.prepare('SELECT COUNT(*) n FROM lms_materials').get().n).toBe(1);
    });
    test('hides keys, explanations and guidance; resumes the same deadline', async () => {
        h = harness(); const first = await h.call('start');
        expect(first.status).toBe(200);
        expect(JSON.stringify(first)).not.toMatch(/correct_option|accepted_answers|grading_guidance|Kunci rahasia|Pedoman khusus/);
        const reopened = await h.call('start');
        expect(reopened.attempt.id).toBe(first.attempt.id);
        expect(reopened.attempt.expires_at).toBe(first.attempt.expires_at);
        expect(h.progress().status).toBe('opened');
        expect((await h.call('track', { action: 'complete' })).status).toBe(409);
    });
    test('start, resume and retake read the learning path once per request and recheck changed prerequisites', async () => {
        h = harness(sampleQuiz({ questions: sampleQuiz().questions.slice(0, 1) }), { realLearningPath: true });
        const start = async body => {
            h.queries.length = 0;
            const result = await h.call('start', body);
            expect(h.queries.filter(query => query.sql.includes('FROM lms_topics t'))).toHaveLength(1);
            expect(h.queries.filter(query => query.sql.includes('FROM lms_materials m'))).toHaveLength(1);
            return result;
        };
        const first = await start();
        expect(first.status).toBe(200);
        expect((await start()).attempt.id).toBe(first.attempt.id);
        expect((await h.submit(first.attempt, { a: 0 })).status).toBe(200);
        const retake = await start({ retake: true, previous_attempt_id: first.attempt.id });
        expect(retake.status).toBe(200);
        expect(retake.attempt.id).not.toBe(first.attempt.id);
        h.sqlite.exec(`INSERT INTO lms_materials(id,topic_id,teacher_id,teacher_name,subject_name,class_name,title,resource_type,order_index)
            VALUES ('prerequisite','topic','guru','Guru','IPA','X-1','Prasyarat baru','quiz',-1)`);
        expect((await start()).status).toBe(409);
    });
    test('blank PG never becomes A; weighted scoring accepts whitespace and KKM zero', async () => {
        h = harness(sampleQuiz({ passing_grade: 0, questions: sampleQuiz().questions.slice(0, 2) }));
        const { attempt } = await h.call('start');
        const result = await h.submit(attempt, { b: '  PROSES   FOTOSINTESIS  ' });
        expect(result.attempt.result.score).toBe(60);
        expect(result.attempt.result.passed).toBe(true);
        expect(result.attempt.result.review[0]).toMatchObject({ student_answer: '', earned_points: 0, is_correct: false });
    });
    test('essay waits for all marks, then manual corrections and feedback survive reopening', async () => {
        h = harness(); const { attempt } = await h.call('start');
        const submitted = await h.submit(attempt, { a: 0, b: 'Fotosintesis', c: 'Alasan siswa' });
        expect(submitted.attempt.status).toBe('pending_review');
        expect(submitted.attempt.result.score).toBeNull();
        expect(h.progress()).toMatchObject({ quiz_score: null, status: 'opened' });
        expect(JSON.stringify(submitted)).not.toMatch(/Kunci rahasia|Pedoman khusus|correct_option/);
        const teacher = await h.call('list', { student_nis: '100' }, { uid: 'guru' });
        expect(teacher.data[0].answers.c).toBe('Alasan siswa');
        expect(teacher.data[0].result.review[0].correct_option).toBe(0);
        expect((await h.review(submitted.attempt, { a: { points: 2 } })).status).toBe(400);
        const graded = await h.review(submitted.attempt, { a: { points: 1, feedback: 'Koreksi guru' }, b: { points: 3 }, c: { points: 3, feedback: 'Tambahkan contoh' } });
        expect(graded.status).toBe(200);
        expect(graded.attempt.result.score).toBe(70);
        expect(h.progress()).toMatchObject({ quiz_score: 70, status: 'completed' });
        const reopened = await h.call('start');
        expect(reopened.attempt.result.review[2].feedback).toBe('Tambahkan contoh');
        expect(reopened.attempt.answers.c).toBe('Alasan siswa');
        expect(JSON.stringify(reopened)).not.toContain('Pedoman khusus');
    });
    test.each([
        { type: 'short' },
        { type: 'short', correct_answer: '  \n ', accepted_answers: ['', '  '] },
        { type: 'essay' },
        { type: 'essay', grading_guidance: '  \n ' }
    ])('saves %p without a key/rubric and waits for teacher grading', async optional => {
        h = harness();
        const quiz = sampleQuiz({ questions: [{ id: 'optional', question: 'Tuliskan pendapatmu', points: 5, ...optional }] });
        const saved = await h.call('material', { id: 'mat', topic_id: 'topic', subject_name: 'IPA', class_name: 'X-1',
            title: 'Soal tanpa kunci', resource_type: 'quiz', quiz_payload: quiz }, { uid: 'guru' });
        expect(saved.status).toBe(200);
        const stored = JSON.parse(h.sqlite.prepare("SELECT quiz_payload FROM lms_materials WHERE id = 'mat'").get().quiz_payload);
        expect(stored.questions[0]).toMatchObject(optional.type === 'short' ? { correct_answer: '', accepted_answers: [] } : { grading_guidance: '' });
        const { attempt } = await h.call('start');
        const submitted = await h.submit(attempt, { optional: 'Pendapat siswa' });
        expect(submitted.attempt).toMatchObject({ status: 'pending_review', answers: { optional: 'Pendapat siswa' },
            result: { score: null, passed: false, review: [{ earned_points: null, is_correct: null }] } });
        expect(h.progress()).toMatchObject({ quiz_score: null, status: 'opened' });
        const teacher = await h.call('list', { student_nis: '100' }, { uid: 'guru' });
        expect(teacher.data[0].result.review[0].earned_points).toBeNull();
        expect((await h.review(submitted.attempt, {})).status).toBe(400);
        const graded = await h.review(submitted.attempt, { optional: { points: 4, feedback: 'Pendapat cukup jelas' } });
        expect(graded.attempt).toMatchObject({ status: 'graded', result: { score: 80, passed: true } });
        expect(h.progress()).toMatchObject({ quiz_score: 80, status: 'completed' });
        const reopened = await h.call('start');
        expect(reopened.attempt.result.review[0]).toMatchObject({ earned_points: 4, student_answer: 'Pendapat siswa', feedback: 'Pendapat cukup jelas' });
    });
    test.each([{ correct_answer: 'Oksigen' }, { accepted_answers: ['Oksigen'] }])('short answers still grade automatically with %p', async key => {
        h = harness(sampleQuiz({ questions: [{ id: 'short', type: 'short', question: 'Gas hasil fotosintesis?', points: 3, ...key }] }));
        const { attempt } = await h.call('start');
        const submitted = await h.submit(attempt, { short: '  OKSIGEN  ' });
        expect(submitted.attempt).toMatchObject({ status: 'graded', result: { score: 100, review: [{ earned_points: 3, is_correct: true }] } });
    });
    test('snapshots protect answers from later question edits', async () => {
        h = harness(sampleQuiz({ questions: sampleQuiz().questions.slice(0, 1) }));
        const { attempt } = await h.call('start');
        h.sqlite.prepare('UPDATE lms_materials SET quiz_payload = ?').run(JSON.stringify(sampleQuiz({ questions: [{ ...sampleQuiz().questions[0], correct_option: 1, question: 'Soal baru' }] })));
        const res = await h.submit(attempt, { a: 0 });
        expect(res.attempt.result.score).toBe(100);
        expect(res.attempt.result.review[0].question).toBe('Pilih dua');
    });
    test('draft saves enforce ownership/concurrency and repeated submits are idempotent', async () => {
        h = harness(); const { attempt } = await h.call('start');
        expect((await h.call('save', { attempt_id: attempt.id, revision: 0, answers: { a: 1 } }, { nis: '200' })).status).toBe(404);
        expect((await h.call('save', { attempt_id: attempt.id, revision: 0, answers: { a: 1 } })).revision).toBe(1);
        expect((await h.call('save', { attempt_id: attempt.id, revision: 0, answers: { a: 0 } })).status).toBe(409);
        const submitted = await h.submit({ ...attempt, revision: 1 }, { a: 1, c: 'Asli' });
        const retry = await h.submit(attempt, { a: 0, c: 'Diubah' });
        expect(retry.attempt.id).toBe(submitted.attempt.id);
        expect(retry.attempt.answers.c).toBe('Asli');
        expect(h.sqlite.prepare('SELECT COUNT(*) n FROM lms_quiz_attempts').get().n).toBe(1);
    });
    test('late submission preserves final answers and requires teacher review without resetting deadline', async () => {
        h = harness(sampleQuiz({ questions: sampleQuiz().questions.slice(0, 1) }));
        const { attempt } = await h.call('start');
        await h.call('save', { attempt_id: attempt.id, revision: 0, answers: { a: 1 } });
        h.sqlite.prepare('UPDATE lms_quiz_attempts SET expires_at = ?').run(new Date(Date.now() - 30000).toISOString());
        const reopened = await h.call('start');
        expect(Date.parse(reopened.attempt.expires_at)).toBeLessThan(Date.now());
        expect((await h.call('save', { attempt_id: attempt.id, revision: 1, answers: { a: 0 } })).status).toBe(409);
        const submitted = await h.submit(reopened.attempt, { a: 0 });
        expect(submitted.attempt.answers.a).toBe(0);
        expect(submitted.attempt.result).toMatchObject({ score: null, status: 'pending_review', passed: false, submitted_late: true });
        expect(h.progress()).toMatchObject({ status: 'opened', quiz_score: null });
        expect(JSON.stringify(submitted)).not.toContain('correct_option');
        const graded = await h.review(submitted.attempt, { a: { points: 1, feedback: 'Diterima dengan pengurangan poin' } });
        expect(graded.attempt.result).toMatchObject({ score: 50, status: 'graded', submitted_late: true });
    });
    test('retakes preserve history and old corrections cannot replace latest progress', async () => {
        h = harness(sampleQuiz({ questions: sampleQuiz().questions.slice(0, 1) }));
        const first = (await h.call('start')).attempt;
        const graded = (await h.submit(first, { a: 0 })).attempt;
        const second = (await h.call('start', { retake: true, previous_attempt_id: first.id })).attempt;
        await h.submit(second, { a: 1 });
        const corrected = await h.review(graded, { a: { points: 1 } });
        expect(corrected.status).toBe(200);
        expect(corrected.attempt.result.score).toBe(50);
        expect(h.progress().quiz_score).toBe(0);
        expect((await h.review(graded, { a: { points: 2 } })).status).toBe(409);
        expect((await h.call('list', { student_nis: '100' }, { uid: 'guru' })).data).toHaveLength(2);
    });
    test('retake is blocked while pending and when teacher disables it', async () => {
        h = harness(sampleQuiz({ allow_retake: 0 }));
        const { attempt } = await h.call('start'); await h.submit(attempt, { c: 'Jawaban' });
        expect((await h.call('start', { retake: true, previous_attempt_id: attempt.id })).status).toBe(409);
        const pending = (await h.call('start')).attempt;
        await h.review(pending, { a: { points: 0 }, b: { points: 0 }, c: { points: 1 } });
        expect((await h.call('start', { retake: true, previous_attempt_id: attempt.id })).status).toBe(409);
    });
    test('rejects other teachers, missing auth, other classes and locked starts', async () => {
        h = harness();
        expect((await h.call('start', {}, null)).status).toBe(401);
        expect((await h.call('start', {}, { nis: '300' })).status).toBe(403);
        expect((await h.call('list', { student_nis: '100' }, { uid: 'another-teacher' })).status).toBe(403);
        h.context.locked = true; expect((await h.call('start')).status).toBe(409);
    });
    test('legacy questions still score with default weights and old clients receive reload guidance', async () => {
        h = harness({ questions: [{ id: 'old', type: 'mc', question: 'Soal lama', options: ['A', 'B'], correct_option: 0 }] });
        const { attempt } = await h.call('start');
        expect(attempt.quiz.questions[0].points).toBe(1);
        expect((await h.submit(attempt, { old: 0 })).attempt.result.score).toBe(100);
        const oldClient = await h.call('submit', { answers: { old: 0 } });
        expect(oldClient.status).toBe(409);
        expect(oldClient.error).toMatch(/Muat ulang/);
    });
    test('start and submit roll back entirely when progress storage fails', async () => {
        h = harness();
        h.sqlite.exec("CREATE TRIGGER fail_progress BEFORE INSERT ON lms_progress BEGIN SELECT RAISE(ABORT, 'Simulated storage failure'); END");
        expect((await h.call('start')).status).toBe(500);
        expect(h.sqlite.prepare('SELECT COUNT(*) n FROM lms_quiz_attempts').get().n).toBe(0);
        h.sqlite.exec('DROP TRIGGER fail_progress');
        const { attempt } = await h.call('start');
        h.sqlite.exec("CREATE TRIGGER fail_progress BEFORE UPDATE ON lms_progress BEGIN SELECT RAISE(ABORT, 'Simulated storage failure'); END");
        expect((await h.submit(attempt, { c: 'Jawaban aman' })).status).toBe(500);
        expect((await h.call('start')).attempt).toMatchObject({ status: 'in_progress', revision: 0 });
        h.sqlite.exec('DROP TRIGGER fail_progress');
        expect((await h.submit(attempt, { c: 'Jawaban aman' })).attempt.answers.c).toBe('Jawaban aman');
    });
    test('copying materials to another class preserves quiz content without copying attempts', async () => {
        h = harness();
        const { attempt } = await h.call('start'); await h.submit(attempt, { a: 0, c: 'Jawaban asli' });
        const copied = await h.call('copy', { source_class: 'X-1', target_class: 'X-2', subject_name: 'IPA' }, { uid: 'guru' });
        expect(copied.status).toBe(200);
        const material = h.sqlite.prepare("SELECT * FROM lms_materials WHERE class_name = 'X-2'").get();
        expect(JSON.parse(material.quiz_payload)).toEqual(sampleQuiz());
        expect(material.id).not.toBe('mat');
        expect(h.sqlite.prepare('SELECT COUNT(*) n FROM lms_quiz_attempts').get().n).toBe(1);
    });
    test('teacher save validates questions and completion counts wait for a passing grade', async () => {
        h = harness();
        const body = { id: 'mat', topic_id: 'topic', subject_name: 'IPA', class_name: 'X-1', title: 'Soal baru', resource_type: 'quiz', quiz_payload: sampleQuiz() };
        expect((await h.call('material', body, { uid: 'guru' })).status).toBe(200);
        expect((await h.call('material', { ...body, quiz_payload: { questions: [] } }, { uid: 'guru' })).status).toBe(400);
        const { attempt } = await h.call('start');
        const pending = (await h.submit(attempt, { a: 0, c: 'Jawaban siswa' })).attempt;
        const count = async () => (await h.call('materials', {}, { uid: 'guru' })).data[0].completed_count;
        expect(await count()).toBe(0);
        await h.review(pending, { a: { points: 2 }, b: { points: 3 }, c: { points: 4 } });
        expect(await count()).toBe(1);
    });
    test.each([null, false, '0', 9, {}, []])('does not coerce invalid choice %p into A', async value => {
        h = harness(sampleQuiz({ questions: sampleQuiz().questions.slice(0, 1) }));
        const { attempt } = await h.call('start'); const result = await h.submit(attempt, { a: value });
        if (value === null) expect(result.attempt.result.score).toBe(0); else expect(result.status).toBe(400);
    });
    test.each([{ points: -1 }, { correct_option: null }, { options: ['A', ''] }, { type: 'unknown' }, { image_url: 'javascript:alert(1)' }])('rejects malformed quiz %p', async invalid => {
        h = harness(sampleQuiz({ questions: [{ ...sampleQuiz().questions[0], ...invalid }] }));
        expect((await h.call('start')).status).toBe(400);
    });
});
