const { harness, sampleQuiz } = require('./helpers/lms-quiz-harness.cjs');

describe('LMS Quiz Submission Auto-Unlock Flow (Tanpa Menunggu Pemeriksaan Guru)', () => {
    let h;
    // sampleQuiz default includes questions: mc, short, and essay ('c').
    // Submitting it without grading will result in status: 'pending_review' and score: null.
    beforeEach(() => {
        h = harness(sampleQuiz(), { realLearningPath: true });
    });
    afterEach(() => h.sqlite.close());

    async function request(route, body = null, actor = { nis: '100' }, method = body ? 'POST' : 'GET') {
        h.context.actor = actor;
        const response = await h.context.worker.fetch(new Request(`https://worker.test/api/lms/${route}`, {
            method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
        }), h.env, {});
        return { ...await response.json(), httpStatus: response.status };
    }

    test('1. Kuis dengan soal uraian (pending_review) langsung membuka Forum Diskusi tanpa menunggu periksa guru', async () => {
        // Setup materi: mat (kuis dengan uraian + diskusi diaktifkan), mat2 (materi berikutnya)
        h.sqlite.exec(`
            UPDATE lms_materials SET allow_discussion=1, discussion_prompt='Diskusikan jawaban kuis uraianmu', order_index=1 WHERE id='mat';
            INSERT INTO lms_materials (id, topic_id, teacher_id, teacher_name, subject_name, class_name, title, resource_type, content_description, order_index)
            VALUES ('mat2', 'topic', 'guru', 'Guru', 'IPA', 'X-1', 'Bahan Ajar 2', 'text', 'Isi modul berikutnya', 2);
        `);

        // Siswa mengambil daftar materi
        let courses = await request('student/courses?class=X-1&nis=100');
        expect(courses.httpStatus).toBe(200);

        const mat = courses.materials.find(m => m.id === 'mat');
        const mat2 = courses.materials.find(m => m.id === 'mat2');
        expect(mat.is_locked).toBe(false);
        expect(mat2.is_locked).toBe(true);

        // Sebelum materi/kuis dibuka sama sekali, forum diskusi menolak dengan pesan buka materi
        const discBefore = await request('discussions/mat');
        expect(discBefore.httpStatus).toBe(409);
        expect(discBefore.error).toMatch(/Buka dan pelajari materi/i);

        // Siswa mulai mengerjakan kuis (kuis dibuka dan in_progress)
        const started = await request('student/quiz/start', { material_id: 'mat' });
        expect(started.httpStatus).toBe(200);

        // Setelah kuis dibuka tetapi belum dikumpulkan, forum diskusi menolak dengan pesan kerjakan kuis
        const discDuring = await request('discussions/mat');
        expect(discDuring.httpStatus).toBe(409);
        expect(discDuring.error).toMatch(/Kerjakan dan kumpulkan kuis/i);

        const submitted = await h.submit(started.attempt, {
            a: 0,
            b: 'Fotosintesis',
            c: 'Ini adalah jawaban uraian panjang siswa.'
        });
        expect(submitted.attempt.status).toBe('pending_review');
        expect(submitted.attempt.result.score).toBeNull();
        expect(submitted.attempt.result.passed).toBe(false);

        // Forum Diskusi SEKARANG HARUS LANGSUNG DAPAT DIBUKA (HTTP 200)!
        const discAfter = await request('discussions/mat');
        expect(discAfter.httpStatus).toBe(200);
        expect(discAfter.material.discussion_prompt).toBe('Diskusikan jawaban kuis uraianmu');

        // Siswa mengirim komentar ke forum diskusi
        const postDisc = await request('discussions', {
            material_id: 'mat',
            content: 'Tanggapan saya terhadap pertanyaan kuis uraian ini.'
        });
        expect(postDisc.httpStatus).toBe(200);

        // Setelah diskusi ditanggapi, Bahan Ajar 1 tuntas dan Bahan Ajar 2 otomatis TERBUKA!
        courses = await request('student/courses');
        const matUpdated = courses.materials.find(m => m.id === 'mat');
        const mat2Updated = courses.materials.find(m => m.id === 'mat2');
        expect(matUpdated.requirement_met).toBe(true);
        expect(mat2Updated.is_locked).toBe(false);
    });

    test('2. Kuis dengan uraian tanpa forum diskusi langsung menuntaskan bahan ajar dan membuka materi selanjutnya', async () => {
        // Setup: mat (kuis saja tanpa forum diskusi), mat2 (materi berikutnya)
        h.sqlite.exec(`
            UPDATE lms_materials SET allow_discussion=0, order_index=1 WHERE id='mat';
            INSERT INTO lms_materials (id, topic_id, teacher_id, teacher_name, subject_name, class_name, title, resource_type, content_description, order_index)
            VALUES ('mat2', 'topic', 'guru', 'Guru', 'IPA', 'X-1', 'Bahan Ajar 2', 'text', 'Isi modul berikutnya', 2);
        `);

        let courses = await request('student/courses');
        expect(courses.materials.find(m => m.id === 'mat2').is_locked).toBe(true);

        // Siswa mengumpulkan kuis
        const started = await request('student/quiz/start', { material_id: 'mat' });
        const submitted = await h.submit(started.attempt, {
            a: 0,
            b: 'Fotosintesis',
            c: 'Jawaban uraian siswa'
        });
        expect(submitted.attempt.status).toBe('pending_review');

        // Bahan Ajar 1 langsung tuntas dan Bahan Ajar 2 langsung terbuka tanpa menunggu guru memeriksa!
        courses = await request('student/courses');
        const mat = courses.materials.find(m => m.id === 'mat');
        const mat2 = courses.materials.find(m => m.id === 'mat2');
        expect(mat.quiz_submitted).toBe(true);
        expect(mat.requirement_met).toBe(true);
        expect(mat2.is_locked).toBe(false);
    });
});
