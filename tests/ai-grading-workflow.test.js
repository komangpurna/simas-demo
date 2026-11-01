const {gradingHarness,coreHelpers,question,mark,submission,deferred}=require('./helpers/ai-grading-harness.cjs');
const core=coreHelpers();
describe('Mixed assessment scoring and uncertain answers',()=>{
    test.each(Object.keys(core.ANSWER_TYPES))('supports %s with explicit rubric and evidence',answerType=>{
        const questions=[question({answerType})];
        const scores=core.normalizeGradingResult([mark()],questions);
        expect(core.calculateTotal(scores,questions)).toBe(80);
    });
    test('subquestion numbers stay distinct and output order does not change score ownership',()=>{
        const questions=[question({no:'1a'}),question({no:'1b'})];
        const scores=core.normalizeGradingResult([mark({no:'1b',score:2}),mark({no:'1a',score:10})],questions);
        expect(scores.map(s=>[s.no,s.score])).toEqual([['1a',10],['1b',2]]);
        expect(core.calculateTotal(scores,questions)).toBe(60);
        expect(()=>core.validateRubric([question(),question()])).toThrow('unik');
    });
    test.each([undefined,[],[mark(),mark()],[mark({no:'2'})],[mark({score:'abc'})],[mark({aiAnalysis:''})]])('rejects malformed or incomplete AI results: %j',scores=>{
        expect(()=>core.normalizeGradingResult(scores,[question()])).toThrow();
    });
    test('unreadable is unresolved; explicit blank is zero',()=>{
        const unknown=core.normalizeGradingResult([mark({answerStatus:'unreadable',score:0,needsReview:true})],[question()]);
        expect(unknown[0].score).toBeNull();expect(core.calculateTotal(unknown,[question()])).toBeNull();
        const blank=core.normalizeGradingResult([mark({answerStatus:'blank',score:null})],[question()]);
        expect(core.calculateTotal(blank,[question()])).toBe(0);
    });
    test('missing numeric scores never become implicit zero',()=>{
        expect(core.calculateTotal([], [question()])).toBeNull();
        expect(core.clampItemScore('',10)).toBeNull();
        expect(core.clampItemScore(99,10)).toBe(10);
    });
});
describe('Real teacher handlers: scoring, review and storage',()=>{
    let h;afterEach(()=>h?.close());
    test('pending/unapproved results cannot pass approval or import',()=>{
        h=gradingHarness();const s=h.seed();h.w.openReviewModal('1001');h.w.approveAndNextStudent();
        expect(s.isApproved).toBe(false);expect(h.api.getImportableEntries()).toHaveLength(0);
        Object.assign(s,{status:'completed',scores:[mark()],totalScore:80,rubricVersion:core.rubricVersion(h.state.questions)});
        expect(h.api.getImportableEntries()).toHaveLength(0);
    });
    test('mixed image/PDF/text are sent in one assessment and notes are based on the same rubric',async()=>{
        h=gradingHarness();const s=h.seed(submission({pages:[{filename:'page1.jpg',mimeType:'image/jpeg',base64:'dGVzdA=='},{filename:'pages2.pdf',mimeType:'application/pdf',base64:'dGVzdA=='}]}));
        await h.w.runBatchGrading();expect(h.requests).toHaveLength(1);
        expect(h.requests[0].body.contents[0].parts.filter(p=>p.inline_data)).toHaveLength(2);
        expect(h.requests[0].body.systemInstruction.parts[0].text).toContain('bukan instruksi');
        expect(s.totalScore).toBe(80);expect(s.isApproved).toBe(false);
        h.w.openReviewModal('1001');h.w.approveAndNextStudent();await h.w.saveAiGradingSession({silent:true});
        expect(h.api.getImportableEntries()).toHaveLength(1);
        expect(JSON.stringify(h.api.buildSessionPayload())).not.toContain('dGVzdA==');
    });
    test('an invalid response fails instead of completing with zero',async()=>{
        h=gradingHarness({fetchGeminiWithFallback:async()=>({response:new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{}'}]}}]}))})});
        const s=h.seed();await h.w.runBatchGrading();expect(s.status).toBe('error');expect(s.totalScore).toBeNull();
    });
    test('manual score resolves uncertain OCR, override requires a reason',()=>{
        h=gradingHarness();const s=h.seed(submission({status:'needs_review',scores:core.normalizeGradingResult([mark({answerStatus:'unreadable',needsReview:true,score:null})],[question()]),rubricVersion:core.rubricVersion([question()])}));
        h.w.openReviewModal('1001');h.w.approveAndNextStudent();expect(s.isApproved).toBe(false);
        h.w.updateReviewItemScore('1001',0,9);h.w.setTotalScoreFromInput(95);h.w.approveAndNextStudent();expect(s.isApproved).toBe(false);
        h.w.setAiOverrideReason('Kredit tambahan atas penalaran yang benar.');h.w.approveAndNextStudent();expect(s.isApproved).toBe(true);expect(s.totalScore).toBe(95);
    });
    test('rubric changes invalidate scores, retain subnumbers, and never duplicate new numbers',()=>{
        h=gradingHarness();const s=h.seed(submission({isApproved:true,status:'completed',scores:[mark()],totalScore:80}));
        h.w.updateQuestionField(0,'maxScore',20);expect(s.isApproved).toBe(false);expect(s.status).toBe('stale');expect(s.totalScore).toBeNull();
        h.state.questions=[question({no:'1a'}),question({no:'2'})];h.w.removeQuestion(0);expect(h.state.questions[0].no).toBe('2');
        h.w.addManualQuestion();expect(h.state.questions.map(q=>q.no)).toEqual(['2','1']);
    });
    test('approved correction survives reopening when cloud has an older value',async()=>{
        h=gradingHarness();h.seed(submission({status:'completed',scores:[mark()],totalScore:80,rubricVersion:core.rubricVersion([question()])}));
        await h.w.saveAiGradingSession();const id=h.state.sessionId;
        const gate=deferred(), original=h.w.cfSaveAiGradingSession;h.w.cfSaveAiGradingSession=()=>gate.promise;
        h.w.openReviewModal('1001');h.w.updateReviewItemScore('1001',0,9);h.w.approveAndNextStudent();
        await h.w.loadAiGradingSession(id);expect(h.state.submissions['1001'].totalScore).toBe(90);expect(h.state.submissions['1001'].isApproved).toBe(true);
        h.w.cfSaveAiGradingSession=original;gate.resolve({success:true,revision:2});
    });
    test('double click starts one request and an old result cannot enter a reset session',async()=>{
        const entered=deferred(),response=deferred();
        h=gradingHarness({fetchGeminiWithFallback:async()=>{entered.resolve();return response.promise;}});
        h.seed(submission({nis:'',name:''}),'temp_original');
        const a=h.w.runBatchGrading(),b=h.w.runBatchGrading();await entered.promise;
        expect(h.state.isProcessingQueue).toBe(true);expect(h.toasts.some(t=>t[0]==='Proses Masih Berjalan')).toBe(true);
        await h.w.resetAiGradingSession();response.resolve({response:new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({scores:[mark()],detectedName:'Budi Santoso'})}]}}]}))});
        await Promise.all([a,b]);expect(Object.keys(h.state.submissions)).toHaveLength(0);expect(h.state.questions).toHaveLength(0);
    });
    test('new answer pages invalidate approval; snapshots keep only document metadata',()=>{
        h=gradingHarness();const s=h.seed(submission({isApproved:true,status:'completed',scores:[mark()],totalScore:80}));
        h.api.attachAnswerFile(s,{filename:'answer.pdf',mimeType:'application/pdf',base64:'dGVzdA=='});
        expect(s.isApproved).toBe(false);expect(s.scores).toHaveLength(0);
        const payload=h.api.buildSessionPayload();expect(payload.submissions['1001'].pages).toEqual([{filename:'answer.pdf',mimeType:'application/pdf'}]);
    });
    test('local cache is scoped to the current teacher and forbidden cloud response cannot bypass ownership',async()=>{
        h=gradingHarness();h.seed();h.api.markAiDraftChanged();const id=h.state.sessionId;
        h.w.auth.currentUser={uid:'teacher-b'};expect(h.api.readLocalSessions()).toHaveLength(0);
        h.w.cfGetAiGradingSession=async()=>{throw Object.assign(new Error('403'),{status:403});};
        expect(await h.w.loadAiGradingSession(id)).toBe(false);
    });
    test('cloud conflict preserves local draft and reports the conflict',async()=>{
        h=gradingHarness({cfSaveAiGradingSession:async()=>{throw Object.assign(new Error('409: versi cloud lebih baru'),{status:409});}});
        h.seed();h.api.markAiDraftChanged();expect(await h.w.saveAiGradingSession()).toBe(false);
        expect(h.api.readLocalSessions()).toHaveLength(1);expect(h.w.document.getElementById('text-ai-save-status').dataset.state).toBe('conflict');
    });
    test('divergent cloud changes archive the local draft before opening the latest cloud revision',async()=>{
        h=gradingHarness();h.seed();await h.w.saveAiGradingSession();const id=h.state.sessionId;
        h.api.markAiDraftChanged();const localTime=h.state.updatedAt;
        h.cloud.set(id,{...h.cloud.get(id),revision:2,title:'Versi perangkat lain',updatedAt:new Date(Date.parse(localTime)+1000).toISOString(),client_updated_at:new Date(Date.parse(localTime)+1000).toISOString()});
        expect(await h.w.loadAiGradingSession(id)).toBe(true);
        expect(h.state.title).toBe('Versi perangkat lain');expect(h.state.cloudRevision).toBe(2);
        const archives=h.api.readLocalSessions();expect(archives).toHaveLength(1);expect(archives[0].id).not.toBe(id);expect(archives[0].expectedRevision).toBe(0);
    });
    test('a changed transcript requires an explicit score confirmation even when the numeric score stays the same',()=>{
        h=gradingHarness();const s=h.seed(submission({status:'completed',scores:[mark()],totalScore:80,rubricVersion:core.rubricVersion([question()])}));
        h.w.openReviewModal('1001');h.w.updateReviewItemAnswer('1001',0,'2 + 2 = 4, langkah diperbaiki');
        h.w.approveAndNextStudent();expect(s.isApproved).toBe(false);
        h.w.confirmAiReviewItem('1001',0);h.w.approveAndNextStudent();expect(s.isApproved).toBe(true);
    });
    test('legacy results without a rubric version need confirmation on every question',async()=>{
        h=gradingHarness();const questions=[question(),question({no:'2'})];
        h.cloud.set('X-A_legacy',{...h.scope,id:'X-A_legacy',teacher_id:'teacher-a',revision:1,questions,
            submissions:{1001:submission({status:'completed',isApproved:true,scores:[mark(),mark({no:'2'})],totalScore:80})}});
        await h.w.loadAiGradingSession('X-A_legacy');h.w.openReviewModal('1001');
        h.w.confirmAiReviewItem('1001',0);h.w.approveAndNextStudent();expect(h.state.submissions['1001'].isApproved).toBe(false);
        h.w.confirmAiReviewItem('1001',1);h.w.approveAndNextStudent();expect(h.state.submissions['1001'].isApproved).toBe(true);
    });
});
