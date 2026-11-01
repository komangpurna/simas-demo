const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
global.TextEncoder ||= require('node:util').TextEncoder;
global.TextDecoder ||= require('node:util').TextDecoder;
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname,'../..');
function executable(file) {
    let source = fs.readFileSync(path.join(root,file),'utf8');
    const edits = acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.flatMap(node =>
        node.type === 'ImportDeclaration' ? [{start:node.start,end:node.end}] : node.type === 'ExportNamedDeclaration' && node.declaration ? [{start:node.start,end:node.declaration.start}] : []);
    for (const edit of edits.sort((a,b)=>b.start-a.start)) source=source.slice(0,edit.start)+source.slice(edit.end);
    return source;
}
function coreHelpers() {
    const source = fs.readFileSync(path.join(root,'js/ai-grading-core.mjs'),'utf8');
    const names = acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.filter(n=>n.type==='ExportNamedDeclaration').map(n=>n.declaration.id?.name || n.declaration.declarations?.[0].id.name);
    return new Function(executable('js/ai-grading-core.mjs') + `\nreturn {${names.join(',')}};`)();
}
const question = (overrides={}) => ({no:'1',text:'Hitung 2 + 2',rubric:'Jawaban 4; langkah yang sah diterima.',maxScore:10,answerType:'calculation',...overrides});
const mark = (overrides={}) => ({no:'1',score:8,studentAnswerText:'2 + 2 = 4',aiAnalysis:'Hasil benar, langkah belum lengkap.',answerStatus:'answered',confidence:'high',needsReview:false,reviewReason:'',...overrides});
const submission = (overrides={}) => ({nis:'1001',name:'Budi Santoso',noAbsen:1,typedAnswer:'1. 2 + 2 = 4',pages:[],status:'pending',scores:[],totalScore:null,isApproved:false,...overrides});
function deferred() { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; }
function gradingHarness(overrides={}) {
    const dom = new JSDOM(fs.readFileSync(path.join(root,'guru-mapel.html'),'utf8'),{url:'https://grading.test/guru-mapel.html',runScripts:'outside-only'});
    const w=dom.window, core=coreHelpers(), cloud=new Map(), requests=[], toasts=[], timers=new Map();
    let timerId=0;
    const scope={kelas:'X-A',mapel:'Matematika',semester:'1',tahunAjaran:'2026/2027'};
    Object.assign(w,core,{
        auth:{currentUser:{uid:'teacher-a'}},db:null,PATHS:{},AI_CONFIG:{},supabase:null,
        getGuruMapelScope:()=>scope,getLoadedStudents:()=>[{nis:'1001',name:'Budi Santoso',noAbsen:1},{nis:'1002',name:'Citra Lestari',noAbsen:2}],
        getCurrentAcademicYearString:()=>scope.tahunAjaran,getAiConfigAsync:async()=>({model:'test-model'}),getUserGeminiApiKeysAsync:async()=>['fake-test-key-123456'],
        escapeHTML:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
        showToast:(...args)=>toasts.push(args),showConfirmModal:async()=>true,
        fetch:async(url,init)=>{requests.push({url,body:JSON.parse(init.body),signal:init.signal});return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({scores:[mark()],detectedName:'Budi Santoso',detectedNoAbsen:'1',identityConflict:false,overallNotes:'Periksa langkah.'})}]}}]}),{status:200});},
        fetchGeminiWithFallback:fn=>fn('fake-test-key-123456').then(response=>({response})),
        cfSaveAiGradingSession:async data=>{
            const existing=cloud.get(data.id);
            if ((existing?.revision||0)!==data.expectedRevision) throw Object.assign(new Error('409: Konflik versi cloud lebih baru'),{status:409});
            const revision=data.expectedRevision+1;
            cloud.set(data.id,JSON.parse(JSON.stringify({...data,teacher_id:data.teacherId,revision,client_updated_at:data.updatedAt,dirty:false})));
            return {success:true,revision};
        },
        cfGetAiGradingSession:async id=>cloud.has(id)?JSON.parse(JSON.stringify(cloud.get(id))):null,
        cfGetAiGradingSessions:async()=>[...cloud.values()],cfDeleteAiGradingSession:async id=>cloud.delete(id),...overrides
    });
    w.URL.createObjectURL=()=> 'blob:https://grading.test/test'; w.URL.revokeObjectURL=()=>{};
    w.setTimeout=(callback,delay)=>{const id=++timerId;if(delay<=500)queueMicrotask(callback);else timers.set(id,{callback,delay});return id;};
    w.clearTimeout=id=>timers.delete(id);
    for(const [id,value] of [['select-kelas','X-A'],['select-mapel','Matematika'],['select-semester','1']])w.document.getElementById(id).innerHTML=`<option>${value}</option>`;
    vm.runInContext(executable('js/gemini-grading.js')+'\nwindow.__grading={state:AI_GRADING_STATE,getImportableEntries,buildSessionPayload,readLocalSessions,markAiDraftChanged,attachAnswerFile};',dom.getInternalVMContext());
    const api=w.__grading;
    api.state.questions=[question()];
    return {w,core,state:api.state,api,cloud,requests,toasts,scope,close:()=>dom.window.close(),
        flush:async()=>{for(const [id,timer] of [...timers])if(timer.delay===1200){timers.delete(id);timer.callback();}for(let i=0;i<30;i++)await Promise.resolve();},
        seed:(sub=submission(),key='1001')=>{api.state.submissions[key]=sub;return sub;}};
}
module.exports={gradingHarness,coreHelpers,question,mark,submission,deferred,executable};
