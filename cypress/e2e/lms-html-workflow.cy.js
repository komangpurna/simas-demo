const suite = Cypress.env('lmsHtmlIntegration') ? describe : describe.skip;
const code = `<!doctype html><html><head><style>body{font:16px system-ui;background:#ecfdf5;padding:20px}h1{color:#065f46}button{padding:12px;border:0;border-radius:12px;background:#059669;color:white}main{max-width:640px;margin:auto}</style></head><body><main><h1>Energi dan kehidupan</h1><p>Tekan tombol untuk mencoba materi interaktif.</p><button id="try">Coba aktivitas</button><p id="result">Belum dicoba</p></main><script>
let counter=Number(localStorage.getItem('counter'))||0;document.getElementById('try').onclick=()=>{counter++;localStorage.setItem('counter',counter);document.getElementById('result').textContent='Aktivitas '+counter;report()};
let parentBlocked=false,storageBlocked=false;try{parent.document.body.dataset.htmlEscaped='yes'}catch(e){parentBlocked=true}try{storageBlocked=sessionStorage.getItem('student_token')===null && localStorage.getItem('simas_inbox_cache')===null;parent.sessionStorage.getItem('student_token');storageBlocked=false}catch(e){}
function report(){parent.postMessage({lmsHtmlTest:true,counter,parentBlocked,storageBlocked},'*')}
window.addEventListener('message',e=>{if(e.data?.lmsHtmlClick)document.getElementById('try').click()});report();
</script></body></html>`;
suite('HTML LMS: actual teacher and student UI, real Worker, disposable SQLite', () => {
    beforeEach(() => {
        expect(Cypress.config('chromeWebSecurity'), 'HTML isolation must run with browser security enabled').to.equal(true);
        cy.request('POST', '/__test__/html/reset'); cy.visit('/cypress/fixtures/lms-html-workflow.html'); cy.window().its('demoReady').should('equal', true);
        cy.window().then(win => { win.localStorage.clear(); win.sessionStorage.clear(); win.sessionStorage.setItem('student_token','PRIVATE_TEST_TOKEN'); });
    });
    function importFile() {
        cy.get('.lms-field-title').type('Materi energi interaktif');
        cy.get('.lms-field-content').type('Tujuan: memahami energi. Ikuti **langkah aktivitas** lalu tulis kesimpulan.');
        cy.get('.lms-field-resource-type').select('html');
        cy.get('.lms-html-file-input').selectFile({ contents: Cypress.Buffer.from(code), fileName: 'energi.html', mimeType: 'text/html' }, { force: true });
        cy.get('.lms-field-html').should('have.value', code);
        cy.get('.lms-field-content').should('contain.value', 'Tujuan: memahami energi');
    }
    it('imports a file, previews interactive HTML safely, saves it, shows it to students and maps active duration to the teacher', () => {
        cy.viewport(390, 844); importFile();
        cy.contains('button', 'Preview').click();
        cy.get('#lms-preview-body iframe').should('have.attr', 'sandbox', 'allow-scripts');
        cy.get('#lms-preview-body .lms-html-instructions').should('contain', 'Tujuan: memahami energi');
        cy.window().its('demoFrameMessages').should('have.length.at.least', 1);
        cy.window().then(win => win.document.querySelector('#lms-preview-body iframe').contentWindow.postMessage({ lmsHtmlClick: true }, '*'));
        cy.window().its('demoFrameMessages').should(messages => expect(messages.some(m => m.counter === 1 && m.parentBlocked && m.storageBlocked)).to.be.true);
        cy.get('body').should('not.have.attr', 'data-html-escaped');
        cy.get('#modal-lms-text-preview').then($el => expect($el[0].scrollWidth).to.be.at.most(390));
        cy.screenshot('lms-html-preview-mobile', { capture: 'viewport' });
        cy.get('#modal-lms-text-preview').contains('button', 'Tutup').click();
        cy.get('#btn-submit-lms-material').click(); cy.get('#demo-notice').should('contain', 'Berhasil');
        cy.intercept('POST', '/__test__/html/api', req => { if (req.body?.body?.action === 'sync_duration') req.alias = 'duration'; });
        cy.clock(); cy.get('#demo-student').click();
        cy.get('#student-resource-frame').should('have.attr', 'sandbox', 'allow-scripts').and('have.attr', 'srcdoc');
        cy.get('#student-resource-type').should('have.text', 'HTML Interaktif');
        cy.get('#student-resource-note').should('contain', 'Durasi belajar aktif tetap dicatat');
        cy.get('#student-resource-engagement-info').should('contain', 'Guru dapat memantau aktivitas, progres, dan durasi belajar aktif');
        cy.get('#student-resource-fallback-link').should('not.be.visible');
        cy.get('#student-resource-instructions').should('be.visible').and('contain', 'Tujuan: memahami energi');
        cy.get('#student-resource-instructions-body strong').should('have.text', 'langkah aktivitas');
        cy.tick(20000);
        cy.window().then(win => {
            const modal = win.document.getElementById('modal-student-resource');
            // Exercise the unsupported-browser path without disabling origin security.
            modal.requestFullscreen = undefined; modal.webkitRequestFullscreen = undefined;
        });
        let frame;
        cy.get('#student-resource-frame').then($el => { frame = $el[0]; });
        cy.get('#btn-student-resource-fullscreen').click();
        cy.get('#modal-student-resource').should('have.class', 'is-fullscreen');
        cy.get('#btn-student-resource-fullscreen').should('contain', 'Keluar');
        cy.get('#student-resource-frame').should($el => expect($el[0]).to.equal(frame));
        cy.tick(22000);
        cy.screenshot('lms-html-student-mobile', { capture: 'viewport' });
        cy.get('#btn-student-resource-fullscreen').click();
        cy.get('#modal-student-resource').should('not.have.class', 'is-fullscreen');
        cy.get('#btn-student-resource-fullscreen').click();
        cy.window().then(win => win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        cy.get('#modal-student-resource').should('not.have.class', 'is-fullscreen').and('be.visible');
        cy.get('#btn-student-resource-fullscreen').click();
        cy.get('#modal-student-resource button[onclick="window.closeStudentResourceModal()"] ').click();
        cy.wait('@duration');
        cy.get('#modal-student-resource').should('not.have.class', 'is-fullscreen');
        cy.get('#demo-progress').click(); cy.get('#demo-duration').should('contain', 'Siswa Satu: 42 detik, 1 sesi').and('contain', 'Siswa Dua: 0 detik');
    });
    it('accepts pasted HTML and previews it before saving', () => {
        cy.viewport(1280, 900);
        cy.get('.lms-field-resource-type').select('html');
        cy.get('.lms-field-html').invoke('val', code).trigger('input');
        cy.contains('button', 'Preview').click();
        cy.window().its('demoFrameMessages').should(messages => expect(messages.some(m => m.parentBlocked && m.storageBlocked)).to.be.true);
        cy.screenshot('lms-html-preview-desktop', { capture: 'viewport' });
    });
    it('restores forms, scoped storage, SDK state and the same duration session after refresh', () => {
        const quiz = `<fieldset><legend>Energi matahari</legend><label>Jawaban <input id="answer"></label><label><input type="radio" name="pg" value="a">A</label><label><input type="radio" name="pg" value="b">B</label><label><input id="agree" type="checkbox">Selesai</label><label>Jenis<select id="choice"><option value="x">X</option><option value="y">Y</option></select></label><textarea id="essay"></textarea><div id="editable" contenteditable="true"></div><input id="secret" type="password"></fieldset><script>
function report(){parent.postMessage({lmsHtmlTest:true,answer:document.getElementById('answer').value,pg:document.querySelector('input[value="b"]').checked,agree:document.getElementById('agree').checked,choice:document.getElementById('choice').value,essay:document.getElementById('essay').value,editable:document.getElementById('editable').textContent,secret:document.getElementById('secret').value,local:localStorage.getItem('progress'),session:sessionStorage.getItem('step'),custom:SimasLmsState.load(),token:sessionStorage.getItem('student_token')},'*')}
window.addEventListener('simas-lms-state-ready',report);
window.addEventListener('message',e=>{if(e.data?.fill){for(const [id,value] of [['answer','panas'],['essay','Jawaban uraian'],['choice','y'],['secret','jangan simpan']]){const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}))}document.querySelector('input[value="b"]').checked=true;document.getElementById('agree').checked=true;document.getElementById('editable').textContent='catatan';localStorage.setItem('progress','2');sessionStorage.setItem('step','3');SimasLmsState.save({score:80});report()}});
</script>`;
        cy.get('.lms-field-title').type('Latihan WFH'); cy.get('.lms-field-resource-type').select('html');
        cy.get('.lms-field-html').invoke('val', quiz).trigger('input'); cy.get('#btn-submit-lms-material').click();
        cy.get('#demo-notice').should('contain','Berhasil');
        cy.clock(); cy.get('#demo-student').click();
        cy.get('#student-resource-draft-status').should('contain','dicadangkan');
        cy.window().then(win => win.document.getElementById('student-resource-frame').contentWindow.postMessage({fill:true},'*'));
        cy.window().its('demoFrameMessages').should(m => expect(m.some(v=>v.answer==='panas' && v.custom?.score===80)).to.be.true);
        cy.tick(30000);
        let firstSession;
        cy.window().then(win => { firstSession=JSON.parse(win.sessionStorage.getItem('simas_lms_html_open_v1:100')).sessionId; });
        cy.reload(); cy.window().its('demoReady').should('equal',true);
        cy.get('#modal-student-resource').should('be.visible');
        cy.window().its('demoFrameMessages').should(m => expect(m.some(v=>v.answer==='panas' && v.pg && v.agree && v.choice==='y' && v.essay==='Jawaban uraian' && v.editable==='catatan' && v.secret==='' && v.local==='2' && v.session==='3' && v.custom?.score===80 && v.token===null)).to.be.true);
        cy.window().then(win => expect(JSON.parse(win.sessionStorage.getItem('simas_lms_html_open_v1:100')).sessionId).to.equal(firstSession));
        cy.get('#student-resource-draft-status').should('contain','dicadangkan');
        cy.clock(); cy.tick(20000);
        cy.get('#modal-student-resource button[onclick="window.closeStudentResourceModal()"] ').click();
        cy.get('#demo-progress').click(); cy.get('#demo-duration').should('contain','1 sesi');
        cy.get('#demo-duration').invoke('text').should(text=>expect(Number(text.match(/Siswa Satu: (\d+)/)[1])).to.be.within(50,55));
        cy.window().then(win => expect(win.sessionStorage.getItem('simas_lms_html_open_v1:100')).to.be.null);
        cy.get('#demo-student').click();
        cy.window().its('demoFrameMessages').should(m => expect(m.filter(v=>v.answer==='panas').length).to.be.at.least(2));
    });
});
