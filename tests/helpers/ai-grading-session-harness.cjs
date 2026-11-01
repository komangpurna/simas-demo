const {DatabaseSync}=require('node:sqlite');
const {loadWorkerLibModule}=require('./worker-source.cjs');
const {coreHelpers,question,mark,submission}=require('./ai-grading-harness.cjs');
function sessionHarness({legacy=false}={}) {
    const sqlite=new DatabaseSync(':memory:');
    if(legacy)sqlite.exec(`CREATE TABLE ai_grading_sessions(id TEXT PRIMARY KEY,teacher_id TEXT,kelas TEXT NOT NULL,mapel TEXT NOT NULL,semester TEXT NOT NULL,tahun_ajaran TEXT NOT NULL,title TEXT NOT NULL,total_max_score REAL DEFAULT 100,questions_json TEXT DEFAULT '[]',submissions_json TEXT DEFAULT '{}',created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')));`);
    const prepare=(sql,args=[])=>({
        bind:(...values)=>prepare(sql,values), first:async()=>sqlite.prepare(sql).get(...args)||null,
        all:async()=>({results:sqlite.prepare(sql).all(...args)}),
        run:async()=>({meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}})
    });
    const env={DB:{prepare}}, {handleAiGradingSessionRequest}=loadWorkerLibModule('lib/ai-grading.js');
    const deps={verifyFirebaseToken:async request=>request.actor?{valid:true,user:request.actor}:{valid:false},
        jsonResponse:(body,status)=>({status,body}),errorResponse:(error,status)=>({status,body:{error}})};
    const payload={id:'X-A_1',kelas:'X-A',mapel:'Matematika',semester:'1',tahunAjaran:'2026/2027',title:'Asesmen campuran',questions:[question()],submissions:{},expectedRevision:0,updatedAt:'2026-10-15T12:00:00.000Z'};
    const actor={uid:'teacher-a',role:'guru_mapel'};
    const call=(method='POST',body=payload,path='/api/ai-grading/sessions',user=actor)=>handleAiGradingSessionRequest({actor:user,url:'https://api.test'+path,text:async()=>JSON.stringify(body)},env,path.split('?')[0],method,deps);
    return {sqlite,call,payload,actor,close:()=>sqlite.close(),approved:()=>{
        const core=coreHelpers();return submission({status:'completed',scores:[mark()],totalScore:80,isApproved:true,rubricVersion:core.rubricVersion([question()])});
    }};
}
module.exports={sessionHarness};
