describe('Modul → Bahan Ajar teacher/student workflow',()=>{
    beforeEach(()=>{cy.request('POST','/__test__/html/reset',{minimumReadingSeconds:300});cy.request('POST','/__test__/html/api',{route:'/api/lms/materials/mat',method:'DELETE',role:'teacher'});cy.visit('/cypress/fixtures/lms-modules-workflow.html');cy.window().its('fixture.ready').should('eq',true);});
    function create(title='Modul Transformasi'){
        cy.get('#new').click();cy.get('[data-field=module-title]').type(title);cy.get('[data-field=module-due]').type('2027-01-01T12:00');
    }
    it('gives teacher module titles full width above actions at narrow widths and keeps module monitoring compact',()=>{
        cy.window().then(async win=>{
            await win.fixture.api('modules',{id:'module-mobile',topic_id:'topic',title:'Refleksi Fungsi Interaktif',is_visible:1,publish_at:new Date(Date.now()-3600000).toISOString(),due_date:'2027-01-01T04:00:00Z',packets:[{id:'packet-mobile',title:'Refleksi Fungsi Interaktif',material_enabled:0,quiz_enabled:0,allow_discussion:1,resource_type:'text',discussion_prompt:'Apa yang kamu pahami?'}]});await win.fixture.reload();
        });
        for(const width of [320,360,390,640,760]){
            cy.viewport(width,780);cy.get('.lm-teacher-workspace .lm-module-top').then(el=>{
                const title=el[0].querySelector('h4').getBoundingClientRect(),identity=el[0].querySelector('.lm-module-identity').getBoundingClientRect(),actions=el[0].querySelector('.lm-module-actions').getBoundingClientRect();
                expect(title.width).to.be.at.least(140);expect(title.height).to.be.at.most(43);expect(actions.top).to.be.at.least(identity.bottom);expect(el[0].scrollWidth).to.be.at.most(el[0].clientWidth+1);
            });
        }
        cy.viewport(360,780);cy.screenshot('teacher-module-mobile-readable-title');cy.get('[data-action=module-progress]').click();
        cy.get('#lms-module-monitor .lm-monitor-nis').should('have.length.at.least',1).each(el=>cy.wrap(el).should('not.be.visible'));
        cy.get('#lms-module-monitor .lm-footer').should('not.exist');cy.get('#lms-module-monitor [data-search]').type('100');cy.get('#lms-module-monitor tbody tr:visible').should('have.length',1);
        cy.screenshot('module-monitor-mobile-compact');cy.viewport(1280,800);cy.get('#lms-module-monitor .lm-monitor-nis').first().should('be.visible');cy.get('#lms-module-monitor [data-action=close]').click();
        cy.get('#theme').click();cy.viewport(360,780);cy.screenshot('teacher-module-mobile-readable-title-dark');
        cy.get('[data-action=collapse-all]').click();cy.get('[data-action=expand-all]').click();cy.get('[data-module-id=module-mobile]').should('have.attr','open');
    });
    const previewCode=`<!doctype html><html><head><style>html,body{height:100%;margin:0;font:16px system-ui}#lesson{height:100dvh;display:flex;flex-direction:column;background:#f0fdf4}header,footer{padding:14px;background:#065f46;color:white;flex:none}main{flex:1;min-height:0;overflow:auto;padding:16px}article{height:1200px}input{padding:10px}footer{display:flex;justify-content:space-between}</style></head><body><div id="lesson"><header>Refleksi Fungsi · Halaman 1/6</header><main><label>Jawaban latihan <input id="answer"></label><article><h1>Materi interaktif</h1><p>Gulir untuk membaca materi panjang.</p></article></main><footer><span>Sebelumnya</span><button>Lanjutkan aktivitas</button></footer></div><script>const instance=Math.random();function report(){parent.postMessage({previewLayout:true,instance,answer:document.getElementById('answer').value,height:innerHeight,footerBottom:document.querySelector('footer').getBoundingClientRect().bottom},'*')}addEventListener('message',event=>{if(event.data?.previewCommand==='fill')document.getElementById('answer').value=event.data.value;if(event.data?.previewCommand)report()});addEventListener('resize',report);report();</script></body></html>`;
    function previewMaterial(){
        create('Modul Pratinjau');cy.get('[data-field=title]').type('Refleksi Fungsi Interaktif');cy.get('[data-field=material_enabled]').check();cy.get('[data-field=resource_type]').select('html');
        cy.get('[data-field=html_code]').invoke('val',previewCode).trigger('input');cy.get('[data-field=html_instructions]').invoke('val','Pelajari **petunjuk ini** sebelum memulai.\n\n'+Array.from({length:25},(_,index)=>`- Langkah ${index+1}: amati dan coba aktivitas.`).join('\n')).trigger('input');
        cy.window().then(win=>{win.previewMessages=[];win.addEventListener('message',event=>{if(event.data?.previewLayout)win.previewMessages.push(event.data);});});
        cy.get('[data-action=preview-html]').click();cy.window().its('previewMessages').should('have.length.at.least',1);
    }
    it('HTML preview fills the viewer like student material and preserves the exercise when resizing or fullscreen changes',()=>{
        cy.viewport(1280,800);previewMaterial();let frame,source,instance,initialHeight;
        cy.get('#lms-module-html-preview').should('be.visible').find('.lm-footer').should('not.exist');
        cy.get('.lm-preview-frame').then(el=>{frame=el[0];source=frame.srcdoc;initialHeight=frame.clientHeight;expect(frame.getAttribute('sandbox')).to.equal('allow-scripts');});
        cy.get('#lms-module-html-preview [data-body]').then(el=>expect(el[0].scrollHeight).to.be.at.most(el[0].clientHeight+1));
        cy.window().then(win=>{instance=win.previewMessages[0].instance;expect(win.previewMessages[0].footerBottom).to.be.at.most(win.previewMessages[0].height+1);frame.contentWindow.postMessage({previewCommand:'fill',value:'Jawaban 42'},'*');const modal=win.document.getElementById('lms-module-html-preview');modal.requestFullscreen=undefined;modal.webkitRequestFullscreen=undefined;});
        cy.window().its('previewMessages').should(messages=>expect(messages.some(message=>message.answer==='Jawaban 42')).to.be.true);
        cy.get('#lms-module-html-preview .lms-html-instructions>summary').click();cy.get('.lm-preview-frame').should(el=>{expect(el[0]).to.equal(frame);expect(el[0].clientHeight).to.be.greaterThan(initialHeight);});
        cy.get('#lms-module-html-preview [data-action=fullscreen]').click();cy.get('#lms-module-html-preview').should('have.class','is-fullscreen');cy.get('.lm-preview-frame').should(el=>{expect(el[0]).to.equal(frame);expect(el[0].srcdoc).to.equal(source);});
        cy.window().then(win=>frame.contentWindow.postMessage({previewCommand:'read'},'*'));cy.window().its('previewMessages').should(messages=>{const latest=messages.at(-1);expect(latest.answer).to.equal('Jawaban 42');expect(latest.instance).to.equal(instance);});
        cy.screenshot('html-preview-student-layout-desktop-fullscreen');cy.window().then(win=>win.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));cy.get('#lms-module-html-preview').should('not.have.class','is-fullscreen').and('be.visible');
        cy.get('#lms-module-html-preview [data-action=close]').click();cy.get('#lms-module-html-preview').should('not.exist');cy.get('[data-field=html_code]').should('have.value',previewCode);
    });
    it('HTML preview stays within a phone viewport with bounded instructions and a visible fullscreen exit',()=>{
        cy.viewport(360,780);previewMaterial();
        cy.get('#lms-module-html-preview').then(el=>expect(el[0].scrollWidth).to.be.at.most(360));cy.get('.lms-html-instructions>div').then(el=>expect(el[0].scrollHeight).to.be.greaterThan(el[0].clientHeight));
        cy.get('#lms-module-html-preview [data-body]').then(el=>expect(el[0].scrollHeight).to.be.at.most(el[0].clientHeight+1));cy.get('.lm-preview-frame').then(el=>expect(el[0].clientHeight).to.be.greaterThan(330));
        cy.screenshot('html-preview-student-layout-phone');cy.get('#lms-module-html-preview .lms-html-instructions>summary').click();
        cy.window().then(win=>{const modal=win.document.getElementById('lms-module-html-preview');modal.requestFullscreen=undefined;modal.webkitRequestFullscreen=undefined;win.document.documentElement.classList.add('dark');});
        cy.get('#lms-module-html-preview [data-action=fullscreen]').click();cy.get('#lms-module-html-preview [data-action=fullscreen]').should('be.visible').and('contain','Keluar');cy.screenshot('html-preview-student-layout-phone-dark-fullscreen');
        cy.get('#lms-module-html-preview [data-action=close]').click();cy.get('#lms-module-editor').should('exist');
    });
    it('starts all parts off and places every switch above its own work area in a vertical sequence',()=>{
        cy.viewport(1280,800);create('Modul dengan Toggle Rapi');
        cy.get('.lm-component-toggle input').should('have.length',3).each(input=>cy.wrap(input).should('not.be.checked'));
        cy.get('.lm-component-block>[data-component]').each(section=>cy.wrap(section).should('have.attr','hidden'));
        cy.get('.lm-main').scrollTo('bottom');cy.screenshot('sequential-components-default-off-desktop');
        const inspectSwitches=()=>cy.get('.lm-component-toggle .lm-toggle').each(label=>{
            const input=label[0].querySelector('input'),copy=label[0].querySelector('span'),win=input.ownerDocument.defaultView;
            const rect=input.getBoundingClientRect(),labelRect=label[0].getBoundingClientRect(),copyRect=copy.getBoundingClientRect();
            expect(rect.width).to.be.greaterThan(rect.height*1.5);expect(Math.round(rect.height)).to.be.at.least(20);expect(rect.right).to.be.at.most(labelRect.right+.1);expect(rect.left).to.be.at.least(copyRect.right+5.9);
            const thumb=win.getComputedStyle(input,'::after'),offset=new win.DOMMatrix(thumb.transform==='none'?undefined:thumb.transform).m41;
            expect(parseFloat(thumb.left)+offset+parseFloat(thumb.width)).to.be.at.most(rect.width-1);
        });
        inspectSwitches();cy.get('[data-field=material_enabled]').check();cy.get('[data-component=material_enabled]').should('not.have.attr','hidden');
        const inspectOrder=()=>cy.get('.lm-components').then(el=>{const blocks=[...el[0].children];expect(blocks.map(block=>block.dataset.lmPart)).to.deep.equal(['material','quiz','discussion']);for(let index=1;index<blocks.length;index++)expect(blocks[index].getBoundingClientRect().top).to.be.at.least(blocks[index-1].getBoundingClientRect().bottom-.1);});
        inspectOrder();cy.get('.lm-components').then(el=>{const main=el[0].closest('.lm-main');main.scrollTop+=el[0].getBoundingClientRect().top-main.getBoundingClientRect().top-8;});cy.screenshot('sequential-components-active-desktop');
        cy.get('[data-field=quiz_enabled]').focus().type(' ').should('be.checked');cy.get('[data-component=quiz_enabled]').should('not.have.attr','hidden');
        inspectOrder();cy.get('[data-field=allow_discussion]').check();inspectOrder();
        cy.viewport(900,800);inspectSwitches();
        cy.viewport(360,780);inspectSwitches();inspectOrder();cy.get('.lm-component-toggle .lm-toggle').each(label=>expect(Math.round(label[0].getBoundingClientRect().height)).to.be.at.least(44));
        cy.get('[data-field=material_enabled]').uncheck();cy.get('[data-field=quiz_enabled]').uncheck();cy.get('[data-field=allow_discussion]').uncheck();
        cy.get('.lm-components').then(el=>el[0].scrollIntoView({block:'center'}));cy.get('.lm-components').screenshot('sequential-components-default-off-phone');
        cy.document().then(doc=>doc.documentElement.classList.add('dark'));inspectSwitches();cy.get('.lm-components').screenshot('sequential-components-default-off-phone-dark');
    });
    it('blocks empty packets and keeps chapter/module/packet hierarchy readable on phones',()=>{
        cy.viewport(390,844);create('Modul yang Rapi');
        cy.get('.lm-header [data-action=add-packet]').should('be.disabled');
        cy.get('.lm-packet').should('have.length',1);cy.get('.lm-packet [data-field=title]').type('Bahan Ajar Pertama');
        cy.get('.lm-header [data-action=add-packet]').should('be.disabled');
        cy.get('.lm-packet [data-field=material_enabled]').check();cy.get('.lm-packet [data-field=content_description]').type('Pelajari uraian ini, kemudian pahami contohnya.');
        cy.get('.lm-header [data-action=add-packet]').should('not.be.disabled');
        cy.get('.lm-layout').scrollTo('bottom');cy.screenshot('modern-editor-phone');
        cy.get('[data-action=save]').click();cy.get('#lms-module-editor').should('not.exist');
        cy.window().then(async win=>{
            const start=new Date(Date.now()-3600000).toISOString(),end=new Date(Date.now()+86400000).toISOString();
            await win.fixture.api('modules',{id:'module-2',topic_id:'topic',title:'Modul Berikutnya',is_visible:1,publish_at:start,due_date:end,order_index:2,packets:[{id:'packet-2',title:'Diskusi Lanjutan',material_enabled:0,quiz_enabled:0,allow_discussion:1,resource_type:'text',discussion_prompt:'Apa yang kamu pahami?'}]});
            await win.fixture.reload();
        });
        cy.get('[data-lm-kind=chapter]').should('have.length',1);cy.get('[data-lm-kind=module]').should('have.length',2);cy.get('[data-lm-kind=packet]').should('have.length',2);
        cy.get('[data-module-id=module-2]').should('not.have.attr','open');cy.get('[data-module-id=module-2]>summary .lm-module-copy h4').click();cy.get('[data-module-id=module-2]').should('have.attr','open');
        cy.get('[data-action=collapse-all]').click();cy.get('[data-lm-kind=chapter]').should('not.have.attr','open');cy.screenshot('teacher-all-collapsed-phone');
        cy.window().then(win=>win.fixture.reload());cy.get('[data-lm-kind=chapter]').should('not.have.attr','open');
        cy.get('[data-action=expand-all]').click();cy.get('[data-module-id=module-2]').should('have.attr','open');
        cy.screenshot('modern-teacher-hierarchy-phone');cy.viewport(1280,800);cy.screenshot('modern-teacher-hierarchy-desktop');
        cy.get('#student').click();cy.viewport(360,780);
        cy.get('[data-student-module]').first().should('have.attr','open');cy.get('[data-student-module=module-2]').should('not.have.attr','open');
        cy.get('[data-student-module=module-2]>.lm-module-top').should('contain','Terkunci');
        cy.get('[data-student-module]').first().children('summary').click();cy.get('[data-student-module]').first().should('not.have.attr','open');
        cy.screenshot('modern-student-modules-collapsed-phone');
        cy.get('[data-student-module]').first().children('summary').click();cy.get('[data-student-module]').first().should('have.attr','open');
        cy.get('[data-lms-step=material] button').first().should('be.visible');
        cy.document().then(doc=>expect(doc.documentElement.scrollWidth).to.be.at.most(360));cy.screenshot('modern-student-open-phone');
        cy.get('#theme').click();cy.screenshot('modern-student-open-phone-dark');
        cy.get('[data-student-module=module-2]>.lm-module-top').click();cy.get('[data-student-module=module-2]').should('have.attr','open');
        cy.get('[data-student-module=module-2] [data-component=discussion]').should('be.disabled');
    });
    it('saves a multi-packet module, imports HTML beside format, restores quiz/questions and separates desktop scrolling',()=>{
        cy.viewport(1280,800);create();
        cy.get('.lm-packet').first().within(()=>{
            cy.get('[data-field=title]').type('Latihan interaktif');cy.get('[data-field=material_enabled]').check();cy.get('[data-field=resource_type]').select('html');
            cy.get('[data-html-file]').selectFile({contents:Cypress.Buffer.from('<h1>Latihan</h1><label>Jawaban <input id="answer"></label>'),fileName:'latihan.html',mimeType:'text/html'},{force:true});
            cy.get('[data-field=html_code]').should('contain.value','Latihan');cy.get('[data-field=html_instructions]').type('Kerjakan latihan sampai tuntas.');
            cy.get('[data-field=quiz_enabled]').check();cy.get('[data-action=question-mc]').click();cy.get('.lms-quiz-q-text').type('Hasil dua tambah dua?');cy.get('.lms-quiz-mc-option').each((el,i)=>cy.wrap(el).clear().type(String(i+4)));cy.get('.lms-quiz-mc-radio').first().check();
            cy.get('[data-field=allow_discussion]').check();cy.get('[data-field=discussion_prompt]').type('Jelaskan caramu.');
        });
        const inspectCompactQuiz=()=>{
            cy.get('.lms-quiz-q-header .lms-quiz-points').should('have.value','1');cy.get('.lms-quiz-optional').should('not.have.attr','open');
            cy.get('.lm-quiz-settings').then(el=>expect(el[0].scrollWidth).to.be.at.most(el[0].clientWidth+1));
            cy.get('.lms-quiz-question-item').then(el=>expect(el[0].scrollWidth).to.be.at.most(el[0].clientWidth+1));
            cy.get('[data-component=quiz_enabled]').then(el=>{const main=el[0].closest('.lm-main'),layout=main.closest('.lm-layout'),scroller=el[0].ownerDocument.defaultView.matchMedia('(max-width:760px)').matches?layout:main;scroller.scrollTop+=el[0].closest('.lm-component-block').getBoundingClientRect().top-scroller.getBoundingClientRect().top-8;});
            cy.get('.lms-quiz-q-text').should('be.visible');
        };
        inspectCompactQuiz();cy.screenshot('compact-formative-quiz-desktop');cy.viewport(390,844);inspectCompactQuiz();
        cy.get('.lms-quiz-type-button').each(el=>expect(el[0].getBoundingClientRect().height).to.be.at.least(44));cy.screenshot('compact-formative-quiz-phone');cy.viewport(1280,800);
        cy.get('.lm-header [data-action=add-packet]').click();cy.get('.lm-packet').last().within(()=>{cy.get('[data-field=title]').type('Refleksi');cy.get('[data-field=material_enabled]').uncheck();cy.get('[data-field=allow_discussion]').check();cy.get('[data-field=discussion_prompt]').type('Apa kesimpulanmu?');});
        cy.get('.lm-aside').then(side=>{const before=side[0].scrollTop;cy.get('.lm-main').scrollTo('bottom');cy.get('.lm-aside').should('be.visible').then(el=>expect(el[0].scrollTop).to.equal(before));});
        cy.screenshot('lms-modules-teacher-desktop');cy.get('[data-action=save]').click();cy.get('#lms-module-editor').should('not.exist');cy.contains('.lm-module-card','Modul Transformasi').should('exist');
        cy.get('#workspace [data-action=delete-module],#workspace [data-action=delete-topic]').should('not.exist');
        cy.get('[data-action=edit-module]').click();cy.get('.lm-packet').should('have.length',2);cy.get('#lms-module-editor [data-action=delete-module]').should('be.visible');cy.screenshot('compact-edit-module-desktop');cy.get('.lms-quiz-q-text').should('have.value','Hasil dua tambah dua?');cy.get('[data-field=html_code]').first().should('contain.value','Latihan');
        cy.get('.lm-header [data-action=close]').click();
        cy.get('#student').click();cy.get('[data-student-module]').should('have.length',1);cy.get('[data-lms-step=quiz] button').should('be.disabled');cy.get('[data-component=material]').first().click();cy.get('[data-lms-step=material]').first().should('have.attr','data-step-state','available');
        cy.viewport(390,844);cy.get('#theme').click();cy.screenshot('lms-modules-student-mobile-dark');cy.document().then(doc=>expect(doc.documentElement.scrollWidth).to.be.at.most(390));
    });
    it('forum-only packets unlock in order; module visibility removes the whole module from student LMS',()=>{
        create('Modul Diskusi');cy.get('.lm-packet').first().within(()=>{cy.get('[data-field=title]').type('Diskusi awal');cy.get('[data-field=material_enabled]').uncheck();cy.get('[data-field=allow_discussion]').check();cy.get('[data-field=discussion_prompt]').type('Bagaimana pendapatmu?');});
        cy.get('.lm-header [data-action=add-packet]').click();cy.get('.lm-packet').last().within(()=>{cy.get('[data-field=title]').type('Diskusi lanjutan');cy.get('[data-field=material_enabled]').uncheck();cy.get('[data-field=allow_discussion]').check();cy.get('[data-field=discussion_prompt]').type('Apa tanggapanmu?');});
        cy.get('[data-action=save]').click();cy.get('#lms-module-editor').should('not.exist');cy.contains('.lm-module-card','Modul Diskusi').should('exist');cy.get('#student').click();cy.get('[data-component=discussion]').first().should('not.be.disabled');cy.get('[data-component=discussion]').last().should('be.disabled');cy.get('[data-component=discussion]').first().click();cy.get('[data-lms-step=discussion]').first().should('have.attr','data-step-state','completed');cy.get('[data-component=discussion]').last().should('not.be.disabled');cy.get('[data-component=discussion]').last().click();cy.contains('2/2 Bahan Ajar tuntas').should('exist');
        cy.get('[data-student-module]').should('not.have.attr','open');cy.get('[data-student-module]>summary').should('contain','Tuntas').click();cy.get('[data-student-module]').should('have.attr','open');
        cy.get('#teacher').click();cy.get('[data-action=module-progress]').click();cy.contains('1/2 tuntas').should('exist');cy.get('#lms-module-monitor .lm-header [data-action=close]').click();cy.get('[data-action=visibility]').click();cy.contains('Draf · Disembunyikan').should('exist');cy.get('#student').click();cy.get('[data-student-module]').should('not.exist');
    });
});
