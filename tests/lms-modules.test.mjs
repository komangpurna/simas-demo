/** @jest-environment node */
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { harness, sampleQuiz } = require('./helpers/lms-quiz-harness.cjs');
const { DatabaseSync } = require('node:sqlite');
const { read } = require('./helpers/lms-quiz-harness.cjs');
let h, now;
beforeEach(() => { h = harness(undefined, { realLearningPath: true, minimumReadingSeconds: 300 }); h.sqlite.exec("DELETE FROM lms_materials"); now = Date.now(); });
afterEach(() => h.sqlite.close());
async function api(route, body, actor = { uid: 'guru' }, method = body ? 'POST' : 'GET') {
    h.context.actor = actor;
    const r = await h.context.worker.fetch(new Request('https://worker.test/api/lms/' + route, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }), h.env, {});
    return { ...await r.json(), httpStatus: r.status };
}
const student = (route, body) => api(route, body, { nis: '100' });
const packet = (id, extra = {}) => ({ id, title: id, material_enabled: 1, quiz_enabled: 0, allow_discussion: 0, resource_type: 'text', content_description: 'Belajar', ...extra });
const payload = (id, packets, extra = {}) => ({ id, topic_id: 'topic', title: id, is_visible: 1, publish_at: new Date(now - 60000).toISOString(), due_date: new Date(now + 3600000).toISOString(), order_index: id === 'm2' ? 2 : 1, packets, ...extra });
test('atomic module save supports independent components and rejects empty packets, scope theft and stale edits', async () => {
    const saved = await api('modules', payload('m1', [packet('a'), packet('b', { material_enabled: 0, allow_discussion: 1, discussion_prompt: 'Mengapa?' })]));
    expect(saved).toMatchObject({ httpStatus: 200, data: { revision: 1, packets: [{ id: 'a' }, { id: 'b' }] } });
    expect((await api('modules', payload('m1', [packet('a', { material_enabled: 0 })], { revision: 1 }))).httpStatus).toBe(400);
    expect((await api('modules', payload('m2', [packet('a')]))).httpStatus).toBe(403);
    expect((await api('modules', payload('m1', [packet('a')], { revision: 0 }))).httpStatus).toBe(409);
    expect((await api('modules/m1', undefined, { uid: 'other' })).httpStatus).toBe(403);
    expect((await api('modules/m1', undefined, { uid: 'manager', role: 'kurikulum' })).httpStatus).toBe(200);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM lms_materials WHERE is_archived=0').get().n).toBe(2);
});
test('packet and module order is enforced by server; hidden modules do not block visible work', async () => {
    await api('modules', payload('m1', [packet('a', { material_enabled: 0, allow_discussion: 1, discussion_prompt: 'Pendapat?' }), packet('b')]));
    await api('modules', payload('m2', [packet('c')]));
    let courses = await student('student/courses');
    expect(courses.modules).toHaveLength(2);
    expect(courses.materials.map(p => [p.id, p.is_locked])).toEqual([['a', false], ['b', true], ['c', true]]);
    expect((await student('student/track', { material_id: 'b', action: 'open' })).httpStatus).toBe(409);
    await student('student/track', { material_id: 'a', action: 'open' });
    expect((await student('discussions', { material_id: 'a', content: 'Tanggapan saya' })).httpStatus).toBe(200);
    courses = await student('student/courses');
    expect(courses.materials.find(p => p.id === 'b').is_locked).toBe(false);
    expect((await api('modules/m1/settings', { revision: 1, is_visible: 0 })).httpStatus).toBe(200);
    courses = await student('student/courses');
    expect(courses.materials.map(p => p.id)).toEqual(['c']);
    expect(courses.materials[0].is_locked).toBe(false);
});
test('compound packet requires reading, graded quiz and forum; quiz-only skips reading minimum', async () => {
    const quiz = JSON.stringify(sampleQuiz({ questions: sampleQuiz().questions.slice(0, 1) }));
    await api('modules', payload('m1', [packet('a', { quiz_enabled: 1, quiz_payload: quiz, allow_discussion: 1, discussion_prompt: 'Kesimpulan?' }), packet('b', { material_enabled: 0, quiz_enabled: 1, quiz_payload: quiz })]));
    expect((await student('student/quiz/start', { material_id: 'a' })).httpStatus).toBe(409);
    await student('student/track', { material_id: 'a', action: 'open', session_id: 'read' });
    vm.runInContext(`Date.now=()=>${now + 301000}`, h.context);
    await student('student/track', { material_id: 'a', action: 'sync_duration', session_id: 'read', session_seconds: 301, reading_complete: true });
    const { attempt } = await student('student/quiz/start', { material_id: 'a' });
    expect(attempt).toBeTruthy();
    expect((await student('discussions', { material_id: 'a', content: 'Belum tuntas' })).httpStatus).toBe(409);
    await student('student/quiz/submit', { material_id: 'a', attempt_id: attempt.id, revision: attempt.revision, answers: { a: 0 } });
    await student('discussions', { material_id: 'a', content: 'Sudah paham' });
    const courses = await student('student/courses');
    expect(courses.materials[0].requirement_met).toBe(true);
    expect(courses.materials[1]).toMatchObject({ is_locked: false, reading_required_seconds: 0 });
    expect((await student('student/quiz/start', { material_id: 'b' })).httpStatus).toBe(200);
    const progress = await api('modules/m1/progress');
    expect(progress.data.find(s => s.nis === '100').completed_packets).toBe(1);
});
test('archive preserves answers; hidden parent blocks quiz save and manual early finish starts lateness immediately', async () => {
    const quiz = JSON.stringify(sampleQuiz({ questions: sampleQuiz().questions.slice(0, 1) }));
    const p = packet('a', { material_enabled: 0, quiz_enabled: 1, quiz_payload: quiz });
    await api('modules', payload('m1', [p, packet('b')]));
    const { attempt } = await student('student/quiz/start', { material_id: 'a' });
    await api('modules/m1/settings', { revision: 1, is_visible: 0 });
    expect((await student('student/quiz/save', { material_id: 'a', attempt_id: attempt.id, revision: attempt.revision, answers: { a: 0 } })).httpStatus).toBe(403);
    const edited = await api('modules', payload('m1', [packet('b')], { revision: 2, is_teaching_completed: 1 }));
    expect(edited.httpStatus).toBe(200);
    expect(Date.parse(edited.data.teaching_completed_at)).toBeLessThanOrEqual(now + 1000);
    expect(h.sqlite.prepare("SELECT is_archived FROM lms_materials WHERE id='a'").get().is_archived).toBe(1);
    expect(h.sqlite.prepare('SELECT id FROM lms_quiz_attempts').get().id).toBe(attempt.id);
});
test('migration keeps packet IDs, quiz answers, progress and expired dates; topic cascades remain valid',()=>{
    const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
    for(const file of ['202609070002_add_lms_module.sql','202609200001_add_lms_quiz.sql','202609200002_lms_quiz_attempts.sql','202610150001_lms_html_instructions.sql','202610150002_lms_late_learning.sql','202610150003_lms_minimum_reading.sql'])db.exec(read('cloudflare/migrations/'+file));
    db.exec(`INSERT INTO lms_topics(id,teacher_id,teacher_name,subject_name,class_name,title) VALUES('t','guru','Guru','IPA','X-1','Bab');
        INSERT INTO lms_materials(id,topic_id,teacher_id,teacher_name,subject_name,class_name,title,resource_type,due_date) VALUES('old','t','guru','Guru','IPA','X-1','Modul Lama','quiz','2026-10-01T04:00:00Z');
        INSERT INTO lms_progress(id,material_id,topic_id,student_nis,student_name,student_class,status,quiz_score,quiz_answers) VALUES('p','old','t','100','Siswa','X-1','completed',90,'{"a":0}');`);
    db.exec(read('cloudflare/migrations/202610150005_lms_modules_packets.sql'));
    expect(db.prepare("SELECT module_id,material_enabled,quiz_enabled FROM lms_materials WHERE id='old'").get()).toMatchObject({module_id:'legacy_old',material_enabled:0,quiz_enabled:1});
    expect(db.prepare('SELECT quiz_score,quiz_answers FROM lms_progress').get()).toMatchObject({quiz_score:90,quiz_answers:'{"a":0}'});
    expect(db.prepare('SELECT due_date FROM lms_modules').get().due_date).toBe('2026-10-01T04:00:00Z');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
    db.exec("DELETE FROM lms_topics WHERE id='t'");expect(db.prepare('SELECT COUNT(*) n FROM lms_modules').get().n).toBe(0);db.close();
});
test.each([{uid:'guru'},{uid:'manager',role:'kurikulum'}])('only the owner or a manager can delete modules and chapters: %j',async actor=>{
    await api('modules',payload('m1',[packet('a')]));
    for(const route of ['modules/m1','topics/topic']){
        expect((await api(route,undefined,{uid:'other'},'DELETE')).httpStatus).toBe(403);
        expect(h.sqlite.prepare("SELECT is_deleted FROM lms_modules WHERE id='m1'").get().is_deleted).toBe(0);
    }
    expect((await api('modules/m1',undefined,actor,'DELETE')).httpStatus).toBe(200);
    expect(h.sqlite.prepare("SELECT is_archived FROM lms_materials WHERE id='a'").get().is_archived).toBe(1);
    expect((await api('topics/topic',undefined,actor,'DELETE')).httpStatus).toBe(200);
    expect(h.sqlite.prepare("SELECT COUNT(*) n FROM lms_topics WHERE id='topic'").get().n).toBe(0);
});

test('module save is idempotent, removal retains history, and copy keeps full hierarchy and component flags',async()=>{
    const original=payload('m1',[packet('a'),packet('b',{material_enabled:0,allow_discussion:1,discussion_prompt:'Mengapa?'})],{request_id:'same-operation'});
    const saved=await api('modules',original);expect(saved.httpStatus).toBe(200);
    const repeated=await api('modules',original);expect(repeated.data.revision).toBe(1);
    const copied=await api('copy-from-class',{source_class:'X-1',target_class:'X-2',subject_name:'IPA',topic_ids:['topic'],publish_at:original.publish_at,due_date:original.due_date});
    expect(copied.httpStatus).toBe(200);
    const copiedModules=(await api('modules?class=X-2')).data;expect(copiedModules).toHaveLength(1);expect(copiedModules[0].packets.map(p=>[p.material_enabled,p.quiz_enabled,p.allow_discussion])).toEqual([[1,0,0],[0,0,1]]);
    expect((await api('modules/m1',undefined,{uid:'guru'},'DELETE')).httpStatus).toBe(200);
    expect(h.sqlite.prepare("SELECT is_archived FROM lms_materials WHERE id='a'").get().is_archived).toBe(1);
    expect((await student('student/courses')).materials).toHaveLength(0);
});
