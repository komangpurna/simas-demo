const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { harness, read } = require('./helpers/lms-quiz-harness.cjs');

const migration = read('cloudflare/migrations/202610160001_lms_read_query_indexes.sql');
const indexNames = [...migration.matchAll(/CREATE INDEX IF NOT EXISTS (\w+)/g)].map(match => match[1]);
const plan = (h, query) => h.sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
    .all(...query.args).map(row => row.detail).join('\n');

function seed(h) {
    vm.runInContext("Date.now = () => Date.parse('2026-10-16T04:00:00Z')", h.context);
    h.sqlite.exec(`
        UPDATE lms_topics SET created_at='2026-10-01 00:00:00';
        UPDATE lms_materials SET created_at='2026-10-01 00:00:00';
        INSERT INTO student_photos VALUES ('100','https://example.test/student.jpg');
        INSERT INTO lms_topics(id,teacher_id,teacher_name,subject_name,class_name,title,order_index,created_at)
        VALUES ('spaced','guru','Guru',' ipa ',' x-1 ','Variasi penulisan',1,'2026-10-02'),
               ('math','guru','Guru','Matematika','X-1','Matematika',2,'2026-10-03');
    `);
    const material = h.sqlite.prepare(`INSERT INTO lms_materials
        (id,topic_id,teacher_id,teacher_name,subject_name,class_name,title,order_index,created_at,is_published,is_archived)
        VALUES (?,?,'guru','Guru',?,?,?,? ,?,?,?)`);
    material.run('spaced','spaced',' ipa ',' x-1 ','Materi variasi',1,'2026-10-02',1,0);
    material.run('math','math','Matematika','X-1','Materi matematika',2,'2026-10-03',1,0);
    material.run('draft','topic','IPA','X-1','Draft',3,'2026-10-04',0,0);
    material.run('archived','topic','IPA','X-1','Arsip',4,'2026-10-05',1,1);
    material.run('scheduled','topic','IPA','X-1','Terjadwal',5,'2026-10-06',2,0);
    h.sqlite.exec("UPDATE lms_materials SET publish_at='2026-10-20T00:00:00Z' WHERE id='scheduled'");
    h.sqlite.exec(`INSERT INTO lms_modules(id,topic_id,teacher_id,teacher_name,subject_name,class_name,title,is_visible,is_deleted)
        VALUES ('invisible','topic','guru','Guru','IPA','X-1','Belum ditampilkan',0,0),
               ('deleted','topic','guru','Guru','IPA','X-1','Dihapus',1,1)`);
    material.run('invisible','topic','IPA','X-1','Modul tersembunyi',6,'2026-10-07',1,0);
    material.run('deleted','topic','IPA','X-1','Modul dihapus',7,'2026-10-08',1,0);
    h.sqlite.exec("UPDATE lms_materials SET module_id=id WHERE id IN ('invisible','deleted')");
    for (let i=0; i<400; i++) {
        material.run(`other-${i}`,'topic','IPA',`X-${i%10+2}`,`Kelas lain ${i}`,i,`2026-09-${String(i%28+1).padStart(2,'0')}`,1,0);
    }
    const discussion = h.sqlite.prepare(`INSERT INTO lms_discussions
        (id,material_id,parent_id,user_id,user_name,user_role,content,is_hidden,is_pinned,created_at)
        VALUES (?,'mat',?,?,'Nama',?,'Tanggapan',?,?,?)`);
    for (let i=0; i<48; i++) {
        discussion.run(`d${i}`,i===4 ? 'd0' : null,i%4===1 ? '200' : '100',i%4===2 ? 'guru' : 'siswa',
            i%4===3 ? 1 : 0,i%5===0 ? 1 : 0,new Date(Date.UTC(2026,9,1,0,i)).toISOString());
    }
}

describe('LMS read indexes: real Worker SQL and SQLite', () => {
    let h;
    beforeEach(() => { h = harness(undefined, { realLearningPath: true }); seed(h); });
    afterEach(() => h.sqlite.close());
    const learningPath = (subject = '') => h.context.getStudentLmsLearningPath(h.env, '100', ' X-1 ', subject);

    test.each(['', ' IPA ', ' MATEMATIKA ', 'Tidak ada'])('preserves the complete learning path for subject %j and removes temporary sorting', async subject => {
        const before = await learningPath(subject);
        h.sqlite.exec(migration);
        h.queries.length = 0;
        const after = await learningPath(subject);
        expect(after).toEqual(before);
        expect(h.queries).toHaveLength(2);
        const [topics, materials] = h.queries.map(query => plan(h, query));
        expect(topics).toContain(`USING INDEX idx_lms_top_class_${subject ? 'subject_norm' : 'norm'}_order`);
        expect(materials).toContain(`USING INDEX idx_lms_mat_class_${subject ? 'subject_norm' : 'norm'}_order`);
        expect(topics + materials).not.toContain('TEMP B-TREE');
        expect(topics).not.toMatch(/SCAN t\b/);
        expect(materials).toContain('USING COVERING INDEX idx_lms_disc_mat_visible_user (material_id=? AND is_hidden=? AND user_id=? AND user_role=?)');
        if (!subject || subject.trim() === 'IPA') {
            expect(after.materials.find(item => item.id === 'mat')).toMatchObject({ my_discussion_count: 12, discussion_count: 36 });
            expect(after.materials.map(item => item.id)).toEqual(expect.arrayContaining(['mat','spaced','scheduled']));
            expect(after.materials.map(item => item.id)).not.toContain('draft');
            for (const id of ['archived','invisible','deleted']) expect(after.materials.some(item => item.id === id)).toBe(false);
        }
    });

    test('keeps discussion threads, photos and pinned ordering identical without a temporary sort', async () => {
        h.context.actor = { uid: 'guru' };
        const discussions = async () => {
            const response = await h.context.worker.fetch(new Request('https://worker.test/api/lms/discussions/mat'), h.env, {});
            expect(response.status).toBe(200);
            return response.json();
        };
        const before = await discussions();
        h.sqlite.exec(migration);
        h.queries.length = 0;
        const after = await discussions();
        expect(after).toEqual(before);
        expect(after.total_comments).toBe(36);
        expect(after.data.some(item => item.user_photo_url === 'https://example.test/student.jpg')).toBe(true);
        const query = h.queries.find(item => item.sql.includes('FROM lms_discussions d'));
        expect(query).toBeDefined();
        expect(plan(h, query)).toContain('USING INDEX idx_lms_disc_mat_visible_order');
        expect(plan(h, query)).not.toContain('TEMP B-TREE');
    });

    test('the migration is repeatable and preserves every material, progress row and discussion', () => {
        const tables = ['lms_topics','lms_materials','lms_modules','lms_progress','lms_discussions','lms_quiz_attempts'];
        const snapshot = () => tables.map(table => h.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
        const before = snapshot();
        h.sqlite.exec(migration);
        h.sqlite.exec(migration);
        expect(snapshot()).toEqual(before);
        const fresh = new DatabaseSync(':memory:');
        try {
            fresh.exec(read('cloudflare/schema.sql'));
            for (const name of indexNames) {
                const definition = db => db.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name=?")
                    .get(name).sql.replace(/\s+/g, '').toLowerCase();
                expect(definition(fresh)).toBe(definition(h.sqlite));
            }
        } finally { fresh.close(); }
    });

    test('publication, class, archive and discussion changes appear immediately through the indexes', async () => {
        h.sqlite.exec(migration);
        await learningPath();
        h.sqlite.exec(`UPDATE lms_materials SET is_published=1 WHERE id='draft';
            UPDATE lms_materials SET is_archived=1 WHERE id='spaced';
            UPDATE lms_materials SET class_name='X-2' WHERE id='math';
            UPDATE lms_discussions SET is_hidden=0 WHERE id='d3';`);
        const after = await learningPath();
        const ids = after.materials.map(item => item.id);
        expect(ids).toContain('draft');
        expect(ids).not.toContain('spaced');
        expect(ids).not.toContain('math');
        expect(after.materials.find(item => item.id === 'mat')).toMatchObject({ my_discussion_count: 13, discussion_count: 37 });
    });
});
