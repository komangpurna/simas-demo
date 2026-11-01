const { harness, sampleQuiz } = require('./helpers/lms-quiz-harness.cjs');
describe('LMS WFH: actual courses, discussion, progress and teacher analytics in SQLite', () => {
    let h;
    beforeEach(() => { h = harness(sampleQuiz({ questions: sampleQuiz().questions.slice(0, 1) }), { realLearningPath: true }); });
    afterEach(() => h.sqlite.close());
    async function request(route, body = null, actor = { nis: '100' }, method = body ? 'POST' : 'GET') {
        h.context.actor = actor;
        const response = await h.context.worker.fetch(new Request(`https://worker.test/api/lms/${route}`, {
            method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
        }), h.env, {});
        return { ...await response.json(), httpStatus: response.status };
    }
    function readingModule() {
        h.sqlite.exec("UPDATE lms_materials SET order_index=2; INSERT INTO lms_materials (id,topic_id,teacher_id,teacher_name,subject_name,class_name,title,resource_type,content_description,allow_discussion,discussion_prompt,order_index) VALUES ('read','topic','guru','Guru','IPA','X-1','Bacaan WFH','text','Teks pembelajaran',1,'Jelaskan hasil pengamatan',1)");
        h.sqlite.exec("UPDATE lms_materials SET minimum_read_seconds=0 WHERE id='read'");
    }
    test('published reading → required discussion → quiz → teacher progress all agree', async () => {
        readingModule();
        let courses = await request('student/courses?class=X-1&nis=100');
        expect(courses.httpStatus).toBe(200);
        expect(courses.materials.find(m => m.id === 'mat')).toMatchObject({ is_locked: true, quiz_payload: '' });
        expect(courses.materials.find(m => m.id === 'read')).toMatchObject({ is_locked: false, discussion_prompt: '' });
        expect((await request('discussions', { material_id: 'read', content: 'Belum membaca' })).httpStatus).toBe(409);
        expect((await request('student/quiz/start', { material_id: 'mat' })).httpStatus).toBe(409);
        expect((await request('student/track', { material_id: 'read', action: 'open', session_id: 'read-session' })).httpStatus).toBe(200);
        courses = await request('student/courses');
        expect(courses.materials.find(m => m.id === 'read').discussion_prompt).toBe('Jelaskan hasil pengamatan');
        expect((await request('student/track', { material_id: 'read', action: 'complete' })).httpStatus).toBe(409);
        expect((await request('discussions', { material_id: 'read', content: 'Pengamatan saya', user_id: '300', user_name: 'Palsu' })).httpStatus).toBe(200);
        const posted = h.sqlite.prepare('SELECT user_id,user_name FROM lms_discussions').get();
        expect(posted).toMatchObject({ user_id: '100', user_name: 'Siswa Satu' });
        courses = await request('student/courses');
        expect(courses.materials.find(m => m.id === 'read').requirement_met).toBe(true);
        expect(courses.materials.find(m => m.id === 'mat').is_locked).toBe(false);
        expect(courses.materials.find(m => m.id === 'mat').quiz_payload).not.toMatch(/correct_option|Kunci rahasia/);
        const started = await request('student/quiz/start', { material_id: 'mat' });
        const submitted = await h.submit(started.attempt, { a: 0 });
        expect(submitted.attempt.result.passed).toBe(true);
        courses = await request('student/courses');
        expect(courses.materials.every(m => m.requirement_met)).toBe(true);
        const analytics = await request('analytics/class?class=X-1&subject=IPA', null, { uid: 'guru' });
        expect(analytics).toMatchObject({ httpStatus: 200 });
        expect(analytics.data.find(s => s.nis === '100')).toMatchObject({ completion_rate: 100 });
        expect(analytics.data.find(s => s.nis === '200')).toMatchObject({ completion_rate: 0 });
    });
    test('drafts stay hidden and future schedules stay locked; WITA schedules obey UTC in SQLite', async () => {
        h.sqlite.prepare('UPDATE lms_materials SET is_published=2, publish_at=?').run(new Date(Date.now() + 3600000).toISOString());
        expect((await request('student/courses')).materials[0]).toMatchObject({ schedule_state: 'scheduled', is_locked: true, quiz_payload: '' });
        h.sqlite.prepare('UPDATE lms_materials SET publish_at=?').run(new Date(Date.now() - 3600000).toISOString().replace('Z', '+00:00'));
        expect((await request('student/courses')).materials).toHaveLength(1);
        h.sqlite.exec('UPDATE lms_materials SET is_published=0');
        expect((await request('student/courses')).materials).toHaveLength(0);
        expect((await request('student/quiz/start', { material_id: 'mat' })).httpStatus).toBe(403);
    });
    test('student class/NIS spoofing, inactive status and access without login are denied', async () => {
        expect((await request('student/courses?class=X-2')).httpStatus).toBe(403);
        expect((await request('student/courses?nis=200')).httpStatus).toBe(403);
        expect((await request('student/courses', null, null)).httpStatus).toBe(401);
        expect((await request('student/track', { material_id: 'mat', action: 'open', student_nis: '200' })).httpStatus).toBe(403);
        h.sqlite.exec("UPDATE students SET status='alumni' WHERE nis='100'");
        expect((await request('student/courses')).httpStatus).toBe(403);
    });
    test('duration checkpoints are cumulative and duplicate retries do not count time twice', async () => {
        readingModule();
        await request('student/track', { material_id: 'read', action: 'open', session_id: 's1' });
        const duration = seconds => request('student/track', { material_id: 'read', action: 'sync_duration', session_id: 's1', session_seconds: seconds });
        for (const seconds of [30, 30, 20, 60]) expect((await duration(seconds)).httpStatus).toBe(200);
        expect(h.sqlite.prepare("SELECT active_seconds_total FROM lms_progress WHERE material_id='read'").get().active_seconds_total).toBe(60);
    });
    test('another teacher cannot inspect or reset; quiz requires grading and owner can reset reading', async () => {
        const { attempt } = await h.call('start'); await h.submit(attempt, { a: 0 });
        expect((await request('materials/mat/progress', null, { uid: 'other' })).httpStatus).toBe(403);
        expect((await request('progress/override', { material_id: 'mat', student_nis: '100', action: 'reset' }, { uid: 'other' })).httpStatus).toBe(403);
        expect((await request('progress/override', { material_id: 'mat', student_nis: '100', action: 'reset' }, { uid: 'guru' })).httpStatus).toBe(409);
        readingModule();
        expect((await request('progress/override', { material_id: 'read', student_nis: '100', action: 'reset' }, { uid: 'guru' })).httpStatus).toBe(200);
    });
});
