const { harness, read } = require('./helpers/lms-quiz-harness.cjs');
const html = ' \n<!doctype html><html><body><button onclick="this.textContent=\'OK\'">Coba</button><script>let x=1;</script></body></html>\n ';
describe('LMS HTML: real Worker, SQLite, authorization, learning locks and duration mapping', () => {
    let h;
    beforeEach(() => { h = harness(undefined, { realLearningPath: true }); });
    afterEach(() => h.sqlite.close());
    const payload = () => ({ id: 'mat', topic_id: 'topic', subject_name: 'IPA', class_name: 'X-1', title: 'HTML Interaktif', resource_type: 'html', content_description: html, html_instructions: 'Baca tujuan belajar lalu coba aktivitas.' });
    async function get(route, actor = { nis: '100' }) {
        h.context.actor = actor;
        const response = await h.context.worker.fetch(new Request(`https://worker.test/api/lms/${route}`), h.env, {});
        return { ...await response.json(), httpStatus: response.status };
    }
    test('owner saves raw HTML without a URL; reload/edit/copy preserve code and student sees published HTML', async () => {
        expect((await h.call('material', payload(), { uid: 'guru' })).status).toBe(200);
        expect(h.sqlite.prepare("SELECT resource_type,content_description,resource_url FROM lms_materials WHERE id='mat'").get()).toMatchObject({ resource_type: 'html', content_description: html, resource_url: '' });
        const course = await get('student/courses');
        expect(course.materials[0]).toMatchObject({ resource_type: 'html', content_description: html, is_locked: false });
        expect(course.materials[0].html_instructions).toBe(payload().html_instructions);
        const updated = html.replace('Coba', 'Coba lagi');
        expect((await h.call('material', { ...payload(), content_description: updated }, { uid: 'guru' })).status).toBe(200);
        expect((await h.call('copy', { source_class: 'X-1', target_class: 'X-2', subject_name: 'IPA' }, { uid: 'guru' })).status).toBe(200);
        expect(h.sqlite.prepare("SELECT content_description FROM lms_materials WHERE class_name='X-2'").get().content_description).toBe(updated);
        expect(h.sqlite.prepare("SELECT html_instructions FROM lms_materials WHERE class_name='X-2'").get().html_instructions).toBe(payload().html_instructions);
    });
    test('the additive migration preserves HTML already saved by the earlier editor', () => {
        h.sqlite.exec('ALTER TABLE lms_materials DROP COLUMN html_instructions');
        h.sqlite.prepare("UPDATE lms_materials SET resource_type='html',content_description=? WHERE id='mat'").run(html);
        h.sqlite.exec(read('cloudflare/migrations/202610150001_lms_html_instructions.sql'));
        expect(h.sqlite.prepare("SELECT content_description,html_instructions FROM lms_materials WHERE id='mat'").get()).toMatchObject({ content_description: html, html_instructions: '' });
    });
    test.each(['', '   ', {}, 'x'.repeat(524289), '字'.repeat(180000)])('rejects empty, invalid or oversized HTML', async code => {
        expect((await h.call('material', { ...payload(), content_description: code }, { uid: 'guru' })).status).toBe(400);
    });
    test('other teachers and students cannot edit; unpublished and locked code stays unavailable', async () => {
        expect((await h.call('material', payload(), { uid: 'other' })).status).toBe(403);
        expect((await h.call('material', payload(), { nis: '100' })).status).toBe(403);
        await h.call('material', payload(), { uid: 'guru' });
        h.sqlite.exec("UPDATE lms_materials SET is_published=0 WHERE id='mat'");
        expect((await get('student/courses')).materials).toHaveLength(0);
        await h.call('material', { ...payload(), order_index: 2 }, { uid: 'guru' });
        h.sqlite.exec("INSERT INTO lms_materials(id,topic_id,teacher_id,teacher_name,subject_name,class_name,title,resource_type,order_index) VALUES ('previous','topic','guru','Guru','IPA','X-1','Sebelumnya','text',1)");
        const material = (await get('student/courses')).materials.find(m => m.id === 'mat');
        expect(material).toMatchObject({ is_locked: true, content_description: '', html_instructions: '' });
    });
    test('legacy HTML clients preserve instructions when their request omits the new field', async () => {
        await h.call('material', payload(), { uid: 'guru' });
        const { html_instructions, ...legacy } = payload();
        expect((await h.call('material', { ...legacy, title: 'Judul baru' }, { uid: 'guru' })).status).toBe(200);
        expect(h.sqlite.prepare("SELECT html_instructions FROM lms_materials WHERE id='mat'").get().html_instructions).toBe(html_instructions);
        expect((await h.call('material', { ...legacy, html_instructions: '' }, { uid: 'guru' })).status).toBe(200);
        expect(h.sqlite.prepare("SELECT html_instructions FROM lms_materials WHERE id='mat'").get().html_instructions).toBe('');
    });
    test.each([{}, 'x'.repeat(16001)])('rejects invalid or oversized instructions', async html_instructions => {
        expect((await h.call('material', { ...payload(), html_instructions }, { uid: 'guru' })).status).toBe(400);
    });
    test('HTML uses the same duration tracker; teacher sees each student duration and session count', async () => {
        await h.call('material', payload(), { uid: 'guru' });
        expect((await h.call('track', { action: 'open', session_id: 'html-1' })).success).toBe(true);
        expect((await h.call('track', { action: 'sync_duration', session_id: 'html-1', session_seconds: 45 })).success).toBe(true);
        await h.call('track', { action: 'sync_duration', session_id: 'html-1', session_seconds: 45 });
        // Refresh reuses the same cumulative session; retry/old packets add no extra time.
        await h.call('track', { action: 'open', session_id: 'html-1' });
        await h.call('track', { action: 'sync_duration', session_id: 'html-1', session_seconds: 45 });
        await h.call('track', { action: 'sync_duration', session_id: 'html-1', session_seconds: 20 });
        await h.call('track', { action: 'open', session_id: 'html-2' });
        await h.call('track', { action: 'sync_duration', session_id: 'html-2', session_seconds: 30 });
        const progress = await get('materials/mat/progress', { uid: 'guru' });
        expect(progress.httpStatus).toBe(200);
        expect(progress.data.find(s => s.nis === '100')).toMatchObject({ active_seconds_total: 75, session_count: 2 });
        expect(progress.data.find(s => s.nis === '200')).toMatchObject({ active_seconds_total: 0 });
        expect((await get('materials/mat/progress', { uid: 'other' })).httpStatus).toBe(403);
    });
});
