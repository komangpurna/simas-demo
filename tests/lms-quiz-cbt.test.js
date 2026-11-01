const { harness, sampleQuiz } = require('./helpers/lms-quiz-harness.cjs');

describe('LMS Quiz CBT & Anti-Cheat System', () => {
    let h;
    afterEach(() => h?.sqlite.close());

    const cbtStrictQuiz = (overrides = {}) => sampleQuiz({
        mode: 'strict',
        time_limit_minutes: 10,
        max_violations: 2,
        shuffle_questions: 1,
        shuffle_options: 1,
        questions: [
            {
                id: 'q1',
                type: 'mc',
                points: 2,
                question: 'Ibu kota negara Indonesia saat ini adalah?',
                options: ['Jakarta', 'Nusantara', 'Surabaya', 'Bandung', 'Medan'],
                correct_option: 0
            },
            {
                id: 'q2',
                type: 'mc',
                points: 3,
                question: 'Gas yang paling melimpah di atmosfer bumi adalah?',
                options: ['Oksigen', 'Karbon Dioksida', 'Nitrogen', 'Argon', 'Helium'],
                correct_option: 2
            }
        ],
        ...overrides
    });

    test('1. Strict mode exposes CBT configuration to students without leaking keys', async () => {
        h = harness(cbtStrictQuiz());
        const res = await h.call('start');
        expect(res.status).toBe(200);
        expect(res.attempt.quiz.mode).toBe('strict');
        expect(res.attempt.quiz.max_violations).toBe(2);
        expect(res.attempt.quiz.shuffle_questions).toBe(1);
        expect(res.attempt.quiz.shuffle_options).toBe(1);
        expect(res.attempt.is_locked).toBe(0);
        expect(res.attempt.violation_count).toBe(0);

        // Verify keys and sensitive rubric are not leaked
        const json = JSON.stringify(res);
        expect(json).not.toMatch(/correct_option|accepted_answers|grading_guidance/);
    });

    test('2. Violation reporting increments violation count and auto-locks at max threshold', async () => {
        h = harness(cbtStrictQuiz({ max_violations: 2 }));
        const { attempt } = await h.call('start');

        // First violation (threshold not exceeded yet)
        const v1 = await h.violation(attempt, 'tab_switch', 5);
        expect(v1.status).toBe(200);
        expect(v1.violation_count).toBe(1);
        expect(v1.is_locked).toBe(0);

        // Save should still succeed before locking (note revision increment from violation)
        const saveRes = await h.call('save', { attempt_id: attempt.id, revision: v1.revision, answers: { q1: 0 } });
        expect(saveRes.status).toBe(200);

        // Second violation: reaches max_violations (2) -> Auto Lock!
        const v2 = await h.violation(attempt, 'tab_switch', 8);
        expect(v2.status).toBe(200);
        expect(v2.violation_count).toBe(2);
        expect(v2.is_locked).toBe(1);
        expect(v2.lock_reason).toMatch(/batas toleransi/i);
    });

    test('3. Locked quiz strictly blocks save and submit attempts (HTTP 409)', async () => {
        h = harness(cbtStrictQuiz({ max_violations: 1 }));
        const { attempt } = await h.call('start');

        // Trigger lock
        const v = await h.violation(attempt, 'tab_switch', 6);
        expect(v.is_locked).toBe(1);

        // Attempting to save draft must fail with 409
        const saveAttempt = await h.call('save', { attempt_id: attempt.id, revision: v.revision, answers: { q1: 0 } });
        expect(saveAttempt.status).toBe(409);
        expect(saveAttempt.error || saveAttempt.message).toMatch(/terkunci/i);

        // Attempting to submit must fail with 409
        const submitAttempt = await h.call('submit', { attempt_id: attempt.id, revision: v.revision, answers: { q1: 0 } });
        expect(submitAttempt.status).toBe(409);
        expect(submitAttempt.error || submitAttempt.message).toMatch(/terkunci/i);
    });

    test('4. Teacher can unlock a locked quiz and student can resume successfully', async () => {
        h = harness(cbtStrictQuiz({ max_violations: 1 }));
        const { attempt } = await h.call('start');

        // Lock quiz
        const v = await h.violation(attempt, 'tab_switch', 10);
        expect(v.is_locked).toBe(1);

        // Verify locked in teacher attempt list
        const teacherList = await h.call('list', { student_nis: '100' }, { uid: 'guru' });
        expect(teacherList.data[0].is_locked).toBe(1);
        expect(teacherList.data[0].violation_count).toBe(1);

        // Teacher unlocks the quiz
        const unlockRes = await h.unlock(attempt);
        expect(unlockRes.status).toBe(200);
        expect(unlockRes.attempt.is_locked).toBe(0);

        // Student can now save draft and submit successfully
        const saveRes = await h.call('save', { attempt_id: attempt.id, revision: unlockRes.attempt.revision, answers: { q1: 0 } });
        expect(saveRes.status).toBe(200);

        const submitRes = await h.call('submit', { attempt_id: attempt.id, revision: saveRes.revision, answers: { q1: 0, q2: 2 } });
        expect(submitRes.status).toBe(200);
        expect(submitRes.attempt.status).toBe('graded');
    });

    test('5. Teacher can reset a locked quiz so student can start fresh from question 1', async () => {
        h = harness(cbtStrictQuiz({ max_violations: 1 }));
        const { attempt } = await h.call('start');

        // Lock quiz
        await h.violation(attempt, 'tab_switch', 10);

        // Teacher resets the attempt
        const resetRes = await h.reset(attempt);
        expect(resetRes.status).toBe(200);
        expect(resetRes.success).toBe(true);

        // Verify attempt is deleted from SQLite
        const dbAttempts = h.sqlite.prepare('SELECT COUNT(*) n FROM lms_quiz_attempts WHERE student_nis = ?').get('100');
        expect(dbAttempts.n).toBe(0);

        // Student starts again -> gets brand new attempt
        const newStart = await h.call('start');
        expect(newStart.status).toBe(200);
        expect(newStart.attempt.id).not.toBe(attempt.id);
        expect(newStart.attempt.is_locked).toBe(0);
        expect(newStart.attempt.violation_count).toBe(0);
    });

    test('6. RBAC Security: Students and unauthorized users are forbidden from unlock and reset (HTTP 403)', async () => {
        h = harness(cbtStrictQuiz({ max_violations: 1 }));
        const { attempt } = await h.call('start');
        await h.violation(attempt, 'tab_switch', 10);

        // Student tries to unlock their own quiz -> 403 Forbidden
        const studentUnlock = await h.call('unlock', { attempt_id: attempt.id }, { role: 'siswa', uid: '100' });
        expect(studentUnlock.status).toBe(403);

        // Student tries to reset their own quiz -> 403 Forbidden
        const studentReset = await h.call('reset', { attempt_id: attempt.id }, { role: 'siswa', uid: '100' });
        expect(studentReset.status).toBe(403);

        // Another unauthorized teacher tries to unlock -> 403 Forbidden
        const hackerUnlock = await h.call('unlock', { attempt_id: attempt.id }, { role: 'guru', uid: 'guru_lain' });
        expect(hackerUnlock.status).toBe(403);

        // Another unauthorized teacher tries to reset -> 403 Forbidden
        const hackerReset = await h.call('reset', { attempt_id: attempt.id }, { role: 'guru', uid: 'guru_lain' });
        expect(hackerReset.status).toBe(403);
    });

    test('7. Strict mode validation requires duration >= 5 minutes and enforces allow_retake = 0', async () => {
        // Attempting to start strict quiz with duration < 5 minutes must fail with 400
        h = harness(cbtStrictQuiz({ time_limit_minutes: 3 }));
        const res = await h.call('start');
        expect(res.status).toBe(400);
        expect(res.error || res.message).toMatch(/minimal 5 menit/i);

        // Valid duration (10 min) forces allow_retake = 0
        h.sqlite.close();
        h = harness(cbtStrictQuiz({ time_limit_minutes: 10, allow_retake: 1 }));
        const startRes = await h.call('start');
        expect(startRes.status).toBe(200);
        expect(startRes.attempt.quiz.allow_retake).toBe(0);
    });

    test('8. Capped timer: expires_at is capped at module due_date if due_date is sooner than duration', async () => {
        // Module closes in 15 minutes, but quiz duration is 60 minutes
        const fifteenMinFromNow = new Date(Date.now() + 15 * 60000).toISOString();
        h = harness(cbtStrictQuiz({ time_limit_minutes: 60 }));
        h.sqlite.prepare('UPDATE lms_materials SET due_date = ? WHERE id = ?').run(fifteenMinFromNow, 'mat');

        const res = await h.call('start');
        expect(res.status).toBe(200);
        const expiresAt = new Date(res.attempt.expires_at).getTime();
        const expectedCap = new Date(fifteenMinFromNow).getTime();
        // Expiry should be capped at due_date (allow 5 sec difference for clock)
        expect(Math.abs(expiresAt - expectedCap)).toBeLessThan(5000);
    });

    test('9. Auto-submit on closed module finalizes in_progress attempts and gives 0 to missing students', async () => {
        // Quiz is strict mode, duration 10 min
        h = harness(cbtStrictQuiz({ time_limit_minutes: 10 }));

        // Student 100 starts and answers q1
        const start100 = await h.call('start', {}, { nis: '100' });
        expect(start100.status).toBe(200);
        const save100 = await h.call('save', { attempt_id: start100.attempt.id, revision: start100.attempt.revision, answers: { q1: 0 } }, { nis: '100' });
        expect(save100.status).toBe(200);

        // Student 200 (in class X-1) never started!
        // Now close the module (set due_date in the past)
        const pastDate = new Date(Date.now() - 3600000).toISOString();
        h.sqlite.prepare('UPDATE lms_materials SET due_date = ?, is_teaching_completed = 1 WHERE id = ?').run(pastDate, 'mat');

        // Teacher lists attempts
        const teacherList = await h.call('list', { student_nis: '100' }, { uid: 'guru' });
        expect(teacherList.status).toBe(200);

        // Student 100's attempt was auto-submitted and graded
        const attempt100 = h.sqlite.prepare("SELECT * FROM lms_quiz_attempts WHERE student_nis = '100'").get();
        expect(attempt100.status).toBe('graded');
        const res100 = JSON.parse(attempt100.result);
        expect(res100.auto_submitted).toBe(true);

        // Student 200 was absent and got auto-submitted with score 0
        const attempt200 = h.sqlite.prepare("SELECT * FROM lms_quiz_attempts WHERE student_nis = '200'").get();
        expect(attempt200).toBeDefined();
        expect(attempt200.status).toBe('graded');
        expect(attempt200.score).toBe(0);
        const res200 = JSON.parse(attempt200.result);
        expect(res200.auto_submitted).toBe(true);
        expect(res200.auto_absent).toBe(true);
    });

    test('10. Learning path: closed strict CBT quiz does not block progression to the next module', async () => {
        h = harness(cbtStrictQuiz({ time_limit_minutes: 10 }), { realLearningPath: true });

        // Add topic 2 with material 2
        h.sqlite.exec(`
            INSERT INTO lms_topics(id,teacher_id,teacher_name,subject_name,class_name,title,order_index)
            VALUES ('topic2','guru','Guru','IPA','X-1','Bab 2', 2);
            INSERT INTO lms_materials(id,topic_id,teacher_id,teacher_name,subject_name,class_name,title,resource_type,publish_at,due_date,order_index)
            VALUES ('mat2','topic2','guru','Guru','IPA','X-1','Bahan Bab 2','text',datetime('now', '-1 hour'),datetime('now', '+1 day'), 1);
        `);

        // Close the first module (due_date in the past and teaching completed)
        const past = new Date(Date.now() - 3600000).toISOString();
        h.sqlite.prepare('UPDATE lms_materials SET due_date = ?, is_teaching_completed = 1 WHERE id = ?').run(past, 'mat');

        // Fetch learning path for student 200 (who never took the quiz) via courses endpoint
        const pathRes = await h.call('courses', {}, { nis: '200' });
        expect(pathRes.status).toBe(200);
        const mat1 = pathRes.materials?.find(m => m.id === 'mat');
        expect(mat1).toBeDefined();
        expect(mat1.quiz_submitted).toBe(true);
    });
});
