/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import * as acorn from 'acorn';
import { installLmsModuleEditor, openLmsHtmlPreview } from '../js/lms-module-editor.mjs';
import { renderLmsStudentModules } from '../js/lms-module-student.mjs';
import { installQuizBuilder } from '../js/lms-quiz-ui.mjs';
import { TextEncoder } from 'node:util';
globalThis.TextEncoder=TextEncoder;
beforeEach(()=>{document.body.innerHTML='<div id="stream"></div>';Object.defineProperty(window.crypto,'randomUUID',{configurable:true,value:()=>webcrypto.randomUUID()});window.HTMLElement.prototype.scrollIntoView=()=>{};installQuizBuilder({notify:jest.fn()});});
afterEach(()=>{document.querySelectorAll('.lm-dialog').forEach(m=>m.dispose?.());jest.restoreAllMocks();});
const wait=()=>new Promise(resolve=>setTimeout(resolve,0));
test('HTML preview uses one fill area, collapsible safe instructions and independent fullscreen without resetting its iframe',async()=>{
    const editor=installLmsModuleEditor({api:{},getContext:()=>({topics:[{id:'t',title:'Bab'}]}),reload:jest.fn(),notify:jest.fn(),openTopic:jest.fn()}),form=await editor.open();
    const title=form.querySelector('[data-field=module-title]');title.value='Draf belum disimpan';
    const oldToggle=window.toggleStudentResourceFullscreen,oldReset=window.resetStudentResourceFullscreen;
    const modal=openLmsHtmlPreview({code:'<input id="answer"><button>Latihan</button>',title:'Refleksi',instructions:'Baca **petunjuk**. <img src=x onerror=alert(1)>'});
    const frame=modal.querySelector('iframe'),source=frame.srcdoc,guide=modal.querySelector('details'),button=modal.querySelector('[data-action=fullscreen]');
    expect(modal.parentElement).toBe(document.body);expect(modal.querySelector('.lm-footer')).toBeNull();expect(frame.className).toBe('lm-preview-frame');expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(guide.open).toBe(true);expect(guide.querySelector('strong').textContent).toBe('petunjuk');expect(guide.querySelector('img')).toBeNull();
    guide.querySelector('summary').click();expect(guide.open).toBe(false);expect(modal.querySelector('iframe')).toBe(frame);
    button.click();await wait();expect(modal.dataset.fullscreenMode).toBe('page');expect(button.getAttribute('aria-pressed')).toBe('true');expect(modal.querySelector('iframe')).toBe(frame);expect(frame.srcdoc).toBe(source);
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(modal.classList.contains('is-fullscreen')).toBe(false);expect(modal.isConnected).toBe(true);
    expect(window.toggleStudentResourceFullscreen).toBe(oldToggle);expect(window.resetStudentResourceFullscreen).toBe(oldReset);
    modal.querySelector('[data-action=close]').click();expect(modal.isConnected).toBe(false);expect(frame.srcdoc).toBe('');expect(form.isConnected).toBe(true);expect(title.value).toBe('Draf belum disimpan');expect(document.body.classList.contains('overflow-hidden')).toBe(false);
});

test('empty HTML is rejected before opening a preview or locking the page',()=>{
    expect(()=>openLmsHtmlPreview({code:' '})).toThrow('Kode HTML wajib');expect(document.getElementById('lms-module-html-preview')).toBeNull();expect(document.body.classList.contains('overflow-hidden')).toBe(false);
});
test('Edit Modul opens from a collapsed header; delete exists only there and preserves inputs after cancel or failure',async()=>{
    const module={id:'m',topic_id:'t',title:'Modul tersimpan',is_visible:1,publish_at:'2026-10-16T00:00:00Z',due_date:'2027-01-01T00:00:00Z',packets:[{id:'p',title:'Bahan Ajar',resource_type:'text',material_enabled:1,content_description:'Isi belajar'}]};
    const api={get:jest.fn(async()=>({data:module})),remove:jest.fn().mockRejectedValueOnce(Error('Forbidden: bukan pemilik')).mockResolvedValueOnce({})},reload=jest.fn();
    const editor=installLmsModuleEditor({api,getContext:()=>({topics:[{id:'t',title:'Bab'}],modules:[module]}),reload,notify:jest.fn(),openTopic:jest.fn(),deleteTopic:jest.fn()});
    const container=document.getElementById('stream');editor.render(container,[{id:'t',title:'Bab'}],[module]);
    expect(container.querySelector('[data-action=delete-module],[data-action=delete-topic]')).toBeNull();
    container.querySelector('[data-action=collapse-all]').click();container.querySelector('[data-lm-kind=chapter]>summary').click();
    container.querySelector('[data-action=edit-module]').click();await wait();
    expect(api.get).toHaveBeenCalledWith('m');const modal=document.getElementById('lms-module-editor'),button=modal.querySelector('[data-action=delete-module]');
    expect(button).not.toBeNull();expect(container.querySelector('[data-module-id=m]').open).toBe(false);
    const confirm=jest.spyOn(window,'confirm').mockReturnValue(false);button.click();await wait();expect(api.remove).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);button.click();await wait();expect(api.remove).toHaveBeenCalledWith('m');expect(modal.isConnected).toBe(true);expect(button.disabled).toBe(false);expect(modal.querySelector('[data-error]').textContent).toBe('Forbidden: bukan pemilik');expect(modal.querySelector('[data-field=module-title]').value).toBe('Modul tersimpan');
    button.click();await wait();expect(modal.isConnected).toBe(false);expect(reload).toHaveBeenCalledTimes(1);
    const create=await editor.open();expect(create.querySelector('[data-action=delete-module]')).toBeNull();
});
test('teacher modules enforce single-expand accordion, default to bottom module on initial render, and support global outline actions',async()=>{
    const openTopic=jest.fn(),preview=jest.fn(),editor=installLmsModuleEditor({api:{},getContext:()=>({}),reload:jest.fn(),notify:jest.fn(),openTopic,preview});
    const container=document.getElementById('stream'),topics=[{id:'t1',title:'Bab Pertama'},{id:'t2',title:'Bab Kedua'}];
    const module=(id,topic,title)=>({id,topic_id:topic,title,is_visible:1,packets:[{id:'p-'+id,title:'Bahan '+id,material_enabled:1,resource_type:'text'}]});
    const modules=[module('m1','t1','Modul Pertama'),module('m2','t1','Modul Berikutnya'),module('m3','t2','Modul Terakhir')];
    const chapters=()=>container.querySelectorAll('[data-lm-kind=chapter]'),chapter1=()=>chapters()[0],chapter2=()=>chapters()[1];
    const m1=()=>container.querySelector('[data-module-id=m1]'),m2=()=>container.querySelector('[data-module-id=m2]'),m3=()=>container.querySelector('[data-module-id=m3]');

    // 1. Initial render defaults to bottom module (m3 in chapter2)
    editor.render(container,topics,modules);
    expect(chapter1().open).toBe(false);
    expect(chapter2().open).toBe(true);
    expect(m1().open).toBe(false);
    expect(m2().open).toBe(false);
    expect(m3().open).toBe(true);

    // 2. Open chapter1 and click m2 -> m2 expands, and m3 collapses automatically (single-expand)
    chapter1().querySelector('summary').click();
    expect(chapter1().open).toBe(true);
    m2().querySelector('summary').click();
    expect(m2().open).toBe(true);
    expect(m1().open).toBe(false);
    expect(m3().open).toBe(false);

    // 3. Clicking m2 again closes it
    m2().querySelector('summary').click();
    expect(m2().open).toBe(false);

    chapter1().querySelector('summary').click();
    expect(chapter1().open).toBe(false);
    container.querySelector('[data-action=edit-topic]').click();expect(openTopic).toHaveBeenCalledWith('t1');expect(chapter1().open).toBe(false);

    // Search query retains filtered chapter
    editor.render(container,topics,modules,'Bahan m2');
    expect(chapter1().open).toBe(true);
    expect(m2().querySelector('.lm-module-label').textContent).toBe('Modul 2');

    editor.render(container,topics,modules);
    expect(chapter1().open).toBe(false);

    // Expand-all opens all details
    container.querySelector('[data-action=expand-all]').click();expect([...container.querySelectorAll('details')].every(d=>d.open)).toBe(true);
    const outsideListener = jest.fn(); document.addEventListener('click', outsideListener);
    container.querySelector('[data-action=expand-all]').click();
    expect(outsideListener).not.toHaveBeenCalled();
    expect([...container.querySelectorAll('details')].every(d=>d.open)).toBe(true);
    document.removeEventListener('click', outsideListener);
    container.querySelector('[data-action=preview-packet]').click();expect(preview).toHaveBeenCalledWith('p-m1');expect(chapter1().open).toBe(true);

    // Collapse-all closes all details
    container.querySelector('[data-action=collapse-all]').click();expect([...container.querySelectorAll('details')].every(d=>!d.open)).toBe(true);
    editor.render(container,topics,modules);expect([...container.querySelectorAll('details')].every(d=>!d.open)).toBe(true);
});
test('Bahan Ajar 2 cannot be added until title and every active part of Bahan Ajar 1 are filled',async()=>{
    const api={save:jest.fn()},editor=installLmsModuleEditor({api,getContext:()=>({topics:[{id:'t',title:'Bab'}],modules:[]}),reload:jest.fn(),notify:jest.fn(),openTopic:jest.fn()});
    const modal=await editor.open(),cards=()=>modal.querySelectorAll('.lm-packet'),add=()=>modal.querySelector('.lm-header [data-action=add-packet]');
    const fill=(card,key,value)=>{const input=card.querySelector(`[data-field=${key}]`);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
    expect(add().disabled).toBe(true);add().click();expect(cards()).toHaveLength(1);
    fill(cards()[0],'title','Bahan Ajar pertama');expect(add().disabled).toBe(true);
    expect([...cards()[0].querySelectorAll('.lm-component-toggle input')].every(input=>!input.checked)).toBe(true);
    cards()[0].querySelector('[data-field=material_enabled]').click();
    fill(cards()[0],'content_description','Penjelasan lengkap');expect(add().disabled).toBe(false);
    add().click();await wait();expect(cards()).toHaveLength(2);expect(add().disabled).toBe(true);
    fill(cards()[1],'title','Diskusi kedua');expect([...cards()[1].querySelectorAll('.lm-component-toggle input')].every(input=>!input.checked)).toBe(true);
    expect(add().disabled).toBe(true);cards()[1].querySelector('[data-field=allow_discussion]').click();
    expect(add().disabled).toBe(true);fill(cards()[1],'discussion_prompt','Bagaimana pendapatmu?');expect(add().disabled).toBe(false);
    add().click();expect(cards()).toHaveLength(3);expect(api.save).not.toHaveBeenCalled();
});
test.each(['html','link','quiz'])('active %s must have valid content before adding another teaching packet',async kind=>{
    const editor=installLmsModuleEditor({api:{},getContext:()=>({topics:[{id:'t',title:'Bab'}],modules:[]}),reload:jest.fn(),notify:jest.fn(),openTopic:jest.fn()});
    const modal=await editor.open(),card=modal.querySelector('.lm-packet'),add=modal.querySelector('.lm-header [data-action=add-packet]');
    const fill=(key,value)=>{const input=card.querySelector(`[data-field=${key}]`);input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));};
    fill('title','Bahan Ajar');
    if(kind==='quiz'){
        card.querySelector('[data-field=quiz_enabled]').click();expect(add.disabled).toBe(true);
        window.addLmsQuizQuestion(card,'mc',{question:'Pilih A',options:['A','B'],correct_option:0,points:1});await wait();
    }else{
        card.querySelector('[data-field=material_enabled]').click();
        fill('resource_type',kind);expect(add.disabled).toBe(true);
        if(kind==='html'){fill('html_code','x'.repeat(512*1024+1));expect(add.disabled).toBe(true);fill('html_code','<h1>Belajar</h1>');}
        else{fill('resource_url','javascript:alert(1)');expect(add.disabled).toBe(true);fill('resource_url','https://example.test/materi');}
    }
    expect(add.disabled).toBe(false);add.click();expect(modal.querySelectorAll('.lm-packet')).toHaveLength(2);
});
test('component switches precede their own work areas; new packets start off and switching off retains typed content',async()=>{
    const api={save:jest.fn()},editor=installLmsModuleEditor({api,getContext:()=>({topics:[{id:'t',title:'Bab'}],modules:[]}),reload:jest.fn(),notify:jest.fn(),openTopic:jest.fn()});
    const modal=await editor.open(),card=modal.querySelector('.lm-packet'),blocks=[...card.querySelectorAll('.lm-component-block')];
    expect(blocks.map(block=>block.dataset.lmPart)).toEqual(['material','quiz','discussion']);
    for(const block of blocks){const input=block.querySelector('.lm-component-toggle input'),body=block.querySelector('[data-component]');expect(input.checked).toBe(false);expect(body.hidden).toBe(true);expect(input.getAttribute('aria-controls')).toBe(body.id);expect(input.compareDocumentPosition(body)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();}
    modal.querySelector('[data-field=module-title]').value='Modul Baru';modal.querySelector('[data-field=module-due]').value='2027-01-01T12:00';card.querySelector('[data-field=title]').value='Bahan Ajar';
    modal.querySelector('[data-action=save]').click();await wait();expect(api.save).not.toHaveBeenCalled();expect(modal.querySelector('[data-error]').textContent).toMatch(/aktifkan minimal satu/);
    const toggle=card.querySelector('[data-field=material_enabled]'),body=card.querySelector('[data-component=material_enabled]'),text=card.querySelector('[data-field=content_description]');
    toggle.click();expect(body.hidden).toBe(false);text.value='Materi tetap tersimpan dalam editor.';text.dispatchEvent(new Event('input',{bubbles:true}));
    toggle.click();expect(body.hidden).toBe(true);expect(text.value).toBe('Materi tetap tersimpan dalam editor.');
    toggle.click();expect(body.hidden).toBe(false);expect(text.value).toBe('Materi tetap tersimpan dalam editor.');
});

test('editing existing packets preserves their enabled components and saved HTML, quiz and discussion',async()=>{
    const packet={id:'p',title:'Bahan lama',material_enabled:0,quiz_enabled:1,allow_discussion:1,resource_type:'html',content_description:'<h1>Materi lama</h1>',discussion_prompt:'Pemantik lama',quiz_payload:JSON.stringify({questions:[{id:'q',type:'mc',question:'Pilih A',options:['A','B'],correct_option:0,points:1}]})};
    const editor=installLmsModuleEditor({api:{get:async()=>({data:{id:'m',topic_id:'t',title:'Modul lama',packets:[packet]}})},getContext:()=>({topics:[{id:'t',title:'Bab'}]}),reload:jest.fn(),notify:jest.fn(),openTopic:jest.fn()});
    const modal=await editor.open('m'),card=modal.querySelector('.lm-packet');
    expect([...card.querySelectorAll('.lm-component-toggle input')].map(input=>input.checked)).toEqual([false,true,true]);
    expect(card.querySelector('[data-field=html_code]').value).toBe('<h1>Materi lama</h1>');expect(card.querySelector('.lms-quiz-q-text').value).toBe('Pilih A');expect(card.querySelector('[data-field=discussion_prompt]').value).toBe('Pemantik lama');
    card.querySelector('[data-field=quiz_enabled]').click();expect(card.querySelector('[data-component=quiz_enabled]').hidden).toBe(true);card.querySelector('[data-field=quiz_enabled]').click();expect(card.querySelector('.lms-quiz-q-text').value).toBe('Pilih A');
});
test('student modules collapse independently with completion badges and keep their numbering when filtered',async()=>{
    const p={id:'first',module_id:'m1',module_title:'Modul Selesai',module_order:1,topic_id:'t',title:'Sudah dipelajari',resource_type:'text',material_enabled:1,quiz_enabled:0,allow_discussion:0,is_published:1,reading_complete:true,quiz_passed:true,requirement_met:true};
    const subject={topics:[{id:'t',title:'Bab Utama',materials:[p,{...p,id:'second',module_id:'m2',module_title:'Modul Berikutnya',module_order:2,requirement_met:false,reading_complete:false}]}]},container=document.getElementById('stream');
    renderLmsStudentModules(container,subject);
    expect(container.querySelectorAll('[data-lm-kind=chapter]')).toHaveLength(1);
    const done=container.querySelector('[data-student-module=m1]'),next=container.querySelector('[data-student-module=m2]');
    expect(done.open).toBe(false);expect(done.querySelector('summary').textContent).toContain('Tuntas');expect(next.open).toBe(true);
    next.querySelector('summary').click();await wait();expect(next.open).toBe(false);
    renderLmsStudentModules(container,subject,{filter:'pending'});
    expect(container.querySelector('[data-student-module=m1]')).toBeNull();
    expect(container.querySelector('[data-student-module=m2]').open).toBe(false);expect(container.querySelector('.lm-module-label').textContent).toBe('Modul 2');
});

test('a reminder reveals its packet and all collapsed parents before scrolling and keeps that state after refresh',async()=>{
    const source=fs.readFileSync('js/page-portal-siswa.js','utf8');
    const node=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='ExpressionStatement'&&n.expression.left?.property?.name==='scrollToMaterialCard');
    const p={id:'p',module_id:'m',module_title:'Modul A',title:'Bahan Ajar A',resource_type:'text',material_enabled:1,quiz_enabled:0,allow_discussion:0};
    document.body.innerHTML='<div id="student-lms-list-container"></div>';
    const container=document.getElementById('student-lms-list-container'),subject={topics:[{id:'t',title:'Bab',materials:[p]}]};
    container.lmsExpansion=new Map([['chapter:t',false],['module:m',false],['packet:p',false]]);
    renderLmsStudentModules(container,subject);
    const scrolled=jest.spyOn(document.getElementById('lms-mat-p'),'scrollIntoView');
    const timers=[];
    new Function('studentLmsActiveSubject','selectStudentLmsSubject','setTimeout',source.slice(node.start,node.end))('IPA',jest.fn(),fn=>timers.push(fn));
    window.scrollToMaterialCard('p','IPA');timers.shift()();
    expect(scrolled).toHaveBeenCalled();expect([...container.querySelectorAll('details')].every(d=>d.open)).toBe(true);
    renderLmsStudentModules(container,subject);expect([...container.querySelectorAll('details')].every(d=>d.open)).toBe(true);
});
test('teacher can toggle each component; validation is visible and failed save preserves inputs and permits retry without duplicate requests',async()=>{
    const api={save:jest.fn().mockRejectedValue(new Error('Jaringan terputus')),get:jest.fn()};
    const editor=installLmsModuleEditor({api,getContext:()=>({topics:[{id:'t',title:'Bab'}],modules:[],className:'X-1',subject:'IPA'}),reload:jest.fn(),notify:jest.fn(),openTopic:jest.fn()});
    const modal=await editor.open();
    const input=(key,value)=>{const el=modal.querySelector(`[data-field=${key}]`);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
    input('module-title','Modul A');input('module-due','2027-01-01T12:00');input('title','Bahan Ajar A');input('content_description','Teks pembelajaran');
    const material=modal.querySelector('[data-field=material_enabled]');material.checked=false;material.dispatchEvent(new Event('change',{bubbles:true}));
    modal.querySelector('[data-action=save]').click();await wait();expect(api.save).not.toHaveBeenCalled();expect(modal.querySelector('[data-error]').textContent).toMatch(/minimal satu/);
    material.checked=true;material.dispatchEvent(new Event('change',{bubbles:true}));
    modal.querySelector('[data-action=save]').click();await wait();expect(api.save).toHaveBeenCalledTimes(1);
    expect(modal.querySelector('[data-error]').textContent).toBe('Jaringan terputus');expect(modal.querySelector('[data-field=title]').value).toBe('Bahan Ajar A');expect(material.disabled).toBe(false);expect(modal.querySelector('[data-action=save]').disabled).toBe(false);
    const request=api.save.mock.calls[0][0].request_id;modal.querySelector('[data-action=save]').click();await wait();expect(api.save.mock.calls[1][0].request_id).toBe(request);
    input('title','Bahan Ajar diperbaiki');modal.querySelector('[data-action=save]').click();await wait();expect(api.save.mock.calls[2][0].request_id).not.toBe(request);
});
test('student sees only enabled steps; completed reading permits quiz while forum remains locked until quiz passes',()=>{
    const p={id:'p',module_id:'m',module_title:'Modul A',topic_id:'t',title:'Bahan Ajar A',resource_type:'text',material_enabled:1,quiz_enabled:1,allow_discussion:1,is_published:1,reading_complete:true,quiz_passed:false,discussion_completed:false};
    const container=document.getElementById('stream');
    renderLmsStudentModules(container,{topics:[{id:'t',title:'Bab',materials:[p,{...p,id:'next',title:'Berikutnya',is_locked:true,material_enabled:0,quiz_enabled:0}]}]});
    expect(container.querySelector('[data-lms-step=material]').dataset.stepState).toBe('completed');expect(container.querySelector('[data-lms-step=quiz] button').disabled).toBe(false);expect(container.querySelector('[data-lms-step=discussion] button').disabled).toBe(true);
    expect(container.querySelector('#lms-mat-next [data-lms-step=material]')).toBeNull();expect(container.querySelectorAll('#lms-mat-next .lm-step')).toHaveLength(1);
});
test('reader and HTML continuation go to quiz before forum for compound packets',async()=>{
    const source=fs.readFileSync('js/page-portal-siswa.js','utf8');
    const names=['markCurrentReadingMaterialComplete','openDiscussionFromResourceModal'];
    const code=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.filter(n=>n.type==='ExpressionStatement'&&names.includes(n.expression.left?.property?.name)).map(n=>source.slice(n.start,n.end)).join('\n');
    const material={id:'p',quiz_enabled:1,quiz_passed:false,discussion_required:true};
    window.openStudentQuiz=jest.fn();window.openStudentLmsDiscussion=jest.fn();window.closeStudentReadMaterialModal=jest.fn();window.closeStudentResourceModal=jest.fn();
    new Function('currentReadingStudentMaterial','currentStudentResourceMaterial',code)(material,material);
    await window.markCurrentReadingMaterialComplete();await window.openDiscussionFromResourceModal();
    expect(window.openStudentQuiz.mock.calls).toEqual([['p'],['p']]);expect(window.openStudentLmsDiscussion).not.toHaveBeenCalled();
});
test.each([['continue','X-1'],['continue','X-2'],['topic-only','X-1'],['topic-only','X-2']])('creating a topic via %s saves only to filter class %s with the selected academic year and semester',async(mode,kelas)=>{
    document.body.innerHTML=`<input id="input-lms-topic-mode" value="new"><input id="input-lms-topic-name" value="Bab Baru"><input id="input-lms-topic-id"><input id="input-lms-topic-order" value="3"><textarea id="input-lms-topic-desc">Tujuan belajar</textarea><select id="select-kelas"><option>X-1</option><option>X-2</option></select><select id="select-mapel"><option>IPA</option></select><select id="select-semester"><option>2</option></select><div id="footer-wizard-step-1"></div><input type="checkbox" name="lms-target-class-checkbox" value="X-1" checked><input type="checkbox" name="lms-target-class-checkbox" value="X-2" checked>`;
    document.getElementById('select-kelas').value=kelas;
    const source=fs.readFileSync('js/page-guru-mapel.js','utf8');
    const handlers=['goToLmsWizardStep','saveLmsTopicOnlyFromWizard','saveLmsTopic'];
    const code=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.filter(n=>n.type==='ExpressionStatement'&&handlers.includes(n.expression.left?.property?.name)).map(n=>source.slice(n.start,n.end)).join('\n');
    const save=jest.fn(async()=>({id:'created'})),topics=[];
    window.lmsModuleWorkspace={open:jest.fn()};window.closeUnifiedLmsCreator=jest.fn();window.closeLmsTopicModal=jest.fn();window.loadLmsData=jest.fn();
    new Function('cfSaveLmsTopic','currentLmsTopics','auth','raporConfig','getCurrentAcademicYearString','showToast',code)(save,topics,{currentUser:{uid:'guru',displayName:'Guru'}},{tahun_ajaran_aktif:'2025/2026'},()=>'',jest.fn());
    if(mode==='continue') await window.goToLmsWizardStep(2);
    else await window.saveLmsTopicOnlyFromWizard();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({class_name:kelas,subject_name:'IPA',semester:'Genap',academic_year:'2025/2026',order_index:3});
    if(mode==='continue') {
        expect(topics[0].id).toBe('created');expect(window.lmsModuleWorkspace.open).toHaveBeenCalledWith(null,'created');
    } else expect(window.closeLmsTopicModal).toHaveBeenCalledTimes(1);
    expect(window.loadLmsData).toHaveBeenCalledWith(true);
    delete window.lmsModuleWorkspace;
});
test('teacher page click-outside dropdown listener does not close LMS topic or module accordions',()=>{
    document.body.innerHTML=`
        <div id="lms-topics-container">
            <div class="lm-outline-tools"><button type="button" class="lm-btn" data-action="expand-all">Buka Semua</button></div>
            <details class="lm-topic" data-lm-kind="chapter" data-expansion-key="chapter:1" open>
                <summary>Bab 1</summary>
                <div class="lm-chapter-content">
                    <details class="lm-module-card" data-lm-kind="module" data-expansion-key="module:1" open>
                        <summary>Modul 1</summary>
                        <details class="relative inline-block text-left group" open>
                            <summary>Dropdown Opsi</summary>
                            <div>Menu</div>
                        </details>
                    </details>
                </div>
            </details>
        </div>
    `;
    const source=fs.readFileSync('js/page-guru-mapel.js','utf8');
    // Extract the click listener block from page-guru-mapel.js
    const match = source.match(/if\s*\(typeof window !== 'undefined' && !window\._lmsDetailsClickRegistered\)\s*\{[\s\S]*?\n\}/);
    expect(match).not.toBeNull();
    delete window._lmsDetailsClickRegistered;
    new Function(match[0])();

    // Click outside dropdown (e.g. on the expand-all button or background)
    const btn = document.querySelector('[data-action=expand-all]');
    btn.click();

    // The dropdown inside details.relative should be closed
    expect(document.querySelector('details.relative').hasAttribute('open')).toBe(false);
    // But the chapter and module accordions must remain open!
    expect(document.querySelector('.lm-topic').hasAttribute('open')).toBe(true);
    expect(document.querySelector('.lm-module-card').hasAttribute('open')).toBe(true);
});

test('editing a completed module and extending target selesai to the future automatically switches teaching status to Sedang Dibahas (0)', async () => {
    const pastDue = '2025-01-01T10:00:00.000Z';
    const futureDue = '2028-01-01T12:00';
    const module = {
        id: 'm-completed',
        topic_id: 't1',
        title: 'Modul Selesai',
        is_visible: 1,
        publish_at: '2025-01-01T08:00:00.000Z',
        due_date: pastDue,
        is_teaching_completed: 1,
        packets: [{ id: 'p1', title: 'Bahan Ajar 1', resource_type: 'text', material_enabled: 1, content_description: 'Isi materi' }]
    };
    const api = {
        get: jest.fn(async () => ({ data: module })),
        save: jest.fn(async () => ({ success: true }))
    };
    const editor = installLmsModuleEditor({
        api,
        getContext: () => ({ topics: [{ id: 't1', title: 'Bab 1' }], modules: [module], className: 'X-1', subject: 'IPA' }),
        reload: jest.fn(),
        notify: jest.fn(),
        openTopic: jest.fn()
    });
    const modal = await editor.open('m-completed');
    const teachingSelect = modal.querySelector('[data-field=module-teaching]');
    const dueInput = modal.querySelector('[data-field=module-due]');

    expect(teachingSelect.value).toBe('1');

    dueInput.value = futureDue;
    dueInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(teachingSelect.value).toBe('0');

    modal.querySelector('[data-action=save]').click();
    await wait();

    expect(api.save).toHaveBeenCalled();
    const savedPayload = api.save.mock.calls[0][0];
    expect(savedPayload.is_teaching_completed).toBe(0);
});

test('renders 4 module actions in 1 row with descriptive tooltips, exclusive to module card', async () => {
    const journal = jest.fn();
    const progressApi = jest.fn(async () => ({
        material: { id: 'm-pub', title: 'Modul Aktif', is_visible: 1, publish_at: '2026-01-01T00:00:00Z', due_date: '2027-01-01T00:00:00Z' },
        packets: [{ id: 'p-1', title: 'Bahan Ajar 1' }],
        summary: { completed_count: 5, total_students: 10, late_count: 0 },
        data: [{ name: 'Siswa A', nis: '1001', completed_packets: 1, total_packets: 1, active_seconds_total: 120, quiz_score: 90, packets: [{ id: 'p-1', title: 'Bahan Ajar 1', status: 'completed' }] }]
    }));
    const module = {
        id: 'm-pub',
        topic_id: 't1',
        title: 'Modul Aktif',
        is_visible: 1,
        publish_at: '2026-01-01T00:00:00Z',
        due_date: '2027-01-01T00:00:00Z',
        packets: [{ id: 'p-1', title: 'Bahan Ajar 1', resource_type: 'text', material_enabled: 1, content_description: 'Isi' }]
    };
    const draftModule = {
        id: 'm-draft',
        topic_id: 't1',
        title: 'Modul Draf',
        is_visible: 0,
        publish_at: '2026-01-01T00:00:00Z',
        due_date: '2027-01-01T00:00:00Z',
        packets: [{ id: 'p-2', title: 'Bahan Ajar 2', resource_type: 'text', material_enabled: 1, content_description: 'Isi' }]
    };
    const editor = installLmsModuleEditor({
        api: { progress: progressApi },
        getContext: () => ({ topics: [{ id: 't1', title: 'Bab 1' }], modules: [module, draftModule], className: 'X-1', subject: 'IPA' }),
        reload: jest.fn(),
        notify: jest.fn(),
        openTopic: jest.fn(),
        journal
    });
    const container = document.getElementById('stream');
    editor.render(container, [{ id: 't1', title: 'Bab 1' }], [module, draftModule]);

    // Published module card actions has all 4 buttons with tooltips
    const pubCard = container.querySelector('[data-module-id="m-pub"]');
    const actions = pubCard.querySelector('.lm-module-actions');
    const editBtn = actions.querySelector('[data-action=edit-module]');
    const progressBtn = actions.querySelector('[data-action=module-progress]');
    const syncBtn = actions.querySelector('[data-action=sync-journal]');
    const visibilityBtn = actions.querySelector('[data-action=visibility]');

    expect(editBtn.textContent.trim()).toBe('Edit');
    expect(editBtn.getAttribute('title')).toBe('Edit pengaturan modul dan bahan ajar');

    expect(progressBtn.textContent.trim()).toBe('Pantau');
    expect(progressBtn.getAttribute('title')).toBe('Pantau progres dan ketuntasan belajar siswa di modul ini');

    expect(syncBtn).not.toBeNull();
    expect(syncBtn.dataset.lmsJournalMaterial).toBe('p-1');
    expect(syncBtn.getAttribute('title')).toBe('Sinkronkan kehadiran dan materi modul ini ke Jurnal Mengajar');

    expect(visibilityBtn.textContent.trim()).toBe('Sembunyikan');
    expect(visibilityBtn.getAttribute('title')).toBe('Sembunyikan modul dari pandangan siswa (draf)');

    // Packet row must NOT have sync-journal button
    const packetSyncBtn = pubCard.querySelector('.lm-packet-row [data-action=sync-journal]');
    expect(packetSyncBtn).toBeNull();

    // Draft module card does not have Sinkron Jurnal
    const draftCard = container.querySelector('[data-module-id="m-draft"]');
    expect(draftCard.querySelector('.lm-module-actions [data-action=sync-journal]')).toBeNull();
    const draftVisibilityBtn = draftCard.querySelector('.lm-module-actions [data-action=visibility]');
    expect(draftVisibilityBtn.getAttribute('title')).toBe('Tampilkan modul ke siswa');

    // Clicking sync journal on module card invokes journal callback
    syncBtn.click();
    expect(journal).toHaveBeenCalledWith('p-1');

    // Monitor dialog must NOT have Sinkron Jurnal (exclusive to module card)
    await editor.monitor('m-pub');
    const monitorModal = document.getElementById('lms-module-monitor');
    expect(monitorModal).not.toBeNull();
    expect(monitorModal.querySelector('[data-action=monitor-journal]')).toBeNull();
    monitorModal.dispose();

    // Verify CSS rule for .lm-teacher-workspace .lm-module-actions has max-width: none and flex-shrink: 0, preventing button clipping
    const cssContent = fs.readFileSync('css/lms-modules.css', 'utf8');
    expect(cssContent).not.toMatch(/\.lm-teacher-workspace\s+\.lm-module-actions\{[^}]*max-width:310px/);
    expect(cssContent).toMatch(/\.lm-teacher-workspace\s+\.lm-module-actions\{[^}]*max-width:none;flex-shrink:0/);
});

test('module editor omits module description, provides visibility hover tooltip, and places quiz question type buttons in header', async () => {
    const editor = installLmsModuleEditor({
        api: { get: jest.fn(), save: jest.fn() },
        getContext: () => ({ topics: [{ id: 't1', title: 'Bab 1' }], modules: [] }),
        reload: jest.fn(),
        notify: jest.fn(),
        openTopic: jest.fn()
    });
    const modal = await editor.open();

    // 1. Gambaran modul field is removed from identity panel
    expect(modal.querySelector('[data-field=module-description]')).toBeNull();
    expect(modal.querySelector('[data-field=module-title]')).not.toBeNull();
    expect(modal.querySelector('[data-module=topic_id]')).not.toBeNull();

    // 2. Visibility toggle has informative hover tooltip title
    const visibleToggleLabel = modal.querySelector('label.lm-toggle:has([data-field="module-visible"])') || modal.querySelector('[data-field="module-visible"]').closest('label');
    expect(visibleToggleLabel).not.toBeNull();
    const tooltipTitle = visibleToggleLabel.getAttribute('title') || '';
    expect(tooltipTitle).toContain('wajib mengerjakan tuntas');
    expect(tooltipTitle).toContain('dapat mengerjakan modul berikutnya');

    // 3. Quiz type buttons are inside .lms-quiz-q-header alongside points and move actions
    const card = modal.querySelector('.lm-packet');
    card.querySelector('[data-field=quiz_enabled]').click();
    window.addLmsQuizQuestion(card, 'mc', { question: 'Pertanyaan tes' });
    const qItem = card.querySelector('.lms-quiz-question-item');
    const header = qItem.querySelector('.lms-quiz-q-header');
    expect(header).not.toBeNull();
    expect(header.querySelector('[data-quiz-type="mc"]')).not.toBeNull();
    expect(header.querySelector('[data-quiz-type="short"]')).not.toBeNull();
    expect(header.querySelector('[data-quiz-type="essay"]')).not.toBeNull();
    expect(header.querySelector('.lms-quiz-points')).not.toBeNull();
    expect(header.querySelector('[aria-label="Naikkan soal"]')).not.toBeNull();
    expect(header.querySelector('[aria-label="Turunkan soal"]')).not.toBeNull();

    // 4. Details optional image/explanation is collapsed by default
    const optional = qItem.querySelector('.lms-quiz-optional');
    expect(optional).not.toBeNull();
    expect(optional.open).toBe(false);

    modal.dispose();
});


