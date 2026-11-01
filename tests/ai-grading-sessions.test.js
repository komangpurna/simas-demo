const {sessionHarness}=require('./helpers/ai-grading-session-harness.cjs');
describe('AI sessions: SQLite persistence, ownership and optimistic revisions',()=>{
    let h;beforeEach(()=>h=sessionHarness({legacy:true}));afterEach(()=>h.close());
    test('upgrades legacy schema and supports owner save/list/read/update/delete',async()=>{
        const a=await h.call();expect(a.status).toBe(200);expect(a.body.revision).toBe(1);
        expect(h.sqlite.prepare('PRAGMA table_info(ai_grading_sessions)').all().map(r=>r.name)).toContain('client_updated_at');
        const read=await h.call('GET',null,'/api/ai-grading/sessions/X-A_1');expect(read.body.data.questions[0].answerType).toBe('calculation');
        const list=await h.call('GET',null,'/api/ai-grading/sessions?semester=1&tahunAjaran=2026%2F2027');expect(list.body.data).toHaveLength(1);
        const update=await h.call('POST',{...h.payload,expectedRevision:1,submissions:{1001:h.approved()}});expect(update.body.revision).toBe(2);
        expect((await h.call('DELETE',null,'/api/ai-grading/sessions/X-A_1')).status).toBe(200);
    });
    test.each(['GET','POST','DELETE'])('another teacher cannot %s the session',async method=>{
        await h.call();const path=method==='POST'?'/api/ai-grading/sessions':'/api/ai-grading/sessions/X-A_1';
        const result=await h.call(method,{...h.payload,expectedRevision:1},path,{uid:'teacher-b',role:'guru_mapel'});expect(result.status).toBe(403);
    });
    test('manager can manage own sessions but cannot claim another teacher session',async()=>{
        await h.call();expect((await h.call('POST',{...h.payload,expectedRevision:1},undefined,{uid:'admin',role:'super_admin'})).status).toBe(403);
        expect((await h.call('POST',{...h.payload,id:'X-A_admin'},undefined,{uid:'admin',role:'super_admin'})).status).toBe(200);
    });
    test('stale updates fail and preserve the newer result',async()=>{
        await h.call();await h.call('POST',{...h.payload,expectedRevision:1,title:'Terbaru'});
        expect((await h.call('POST',{...h.payload,expectedRevision:1,title:'Usang'})).status).toBe(409);
        expect(h.sqlite.prepare('SELECT title,revision FROM ai_grading_sessions').get()).toMatchObject({title:'Terbaru',revision:2});
    });
    test('concurrent inserts cannot take over ownership',async()=>{
        const results=await Promise.all([h.call(),h.call('POST',h.payload,undefined,{uid:'teacher-b',role:'guru_mapel'})]);
        expect(results.filter(r=>r.status===200)).toHaveLength(1);
        expect(h.sqlite.prepare('SELECT teacher_id FROM ai_grading_sessions').get().teacher_id).toBe('teacher-a');
    });
    test('tokens without teacher role and missing tokens are rejected',async()=>{
        expect((await h.call('GET',null,undefined,null)).status).toBe(401);
        expect((await h.call('POST',h.payload,undefined,{uid:'student',role:'siswa'})).status).toBe(403);
    });
    test('ownerless historical data cannot be read or claimed by arbitrary teachers',async()=>{
        await h.call();h.sqlite.exec("UPDATE ai_grading_sessions SET teacher_id=NULL");
        expect((await h.call('GET',null,'/api/ai-grading/sessions/X-A_1')).status).toBe(403);
        expect((await h.call('POST',{...h.payload,expectedRevision:1})).status).toBe(403);
        expect((await h.call('GET',null)).body.data).toHaveLength(0);
    });
    test('rejects persisted attachments and incomplete approval; accepts unresolved draft',async()=>{
        expect((await h.call('POST',{...h.payload,submissions:{1001:{imageBase64:'secret'}}})).status).toBe(400);
        expect((await h.call('POST',{...h.payload,submissions:{1001:{...h.approved(),scores:[]}}})).status).toBe(400);
        expect((await h.call('POST',{...h.payload,submissions:{1001:{nis:'1001',isApproved:false,status:'needs_review',scores:[]}}})).status).toBe(200);
    });
});
