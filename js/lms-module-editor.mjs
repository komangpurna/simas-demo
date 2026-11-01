import { quizEscape as esc } from './lms-quiz-ui.mjs';
import { lmsHasMaterial, lmsHasQuiz, lmsHasDiscussion } from './lms-structure.mjs';
import { getLmsScheduleState, validateLmsSchedule, formatLmsScheduleTime, normalizeLmsScheduleTime } from './lms-schedule.mjs';
import { importLmsHtmlFile, mountLmsHtml, validateLmsHtml } from './lms-html.mjs';
import { lmsUiIcon, lmsComponentPills, lmsTopicHeading } from './lms-module-view.mjs';
import { installLmsResourceFullscreen } from './lms-resource-fullscreen.mjs';

const uid = prefix => `${prefix}_${crypto.randomUUID()}`;
const localTime = value => { const time=Date.parse(normalizeLmsScheduleTime(value,true));return Number.isFinite(time)?new Date(time+8*3600000).toISOString().slice(0,16):''; };
const field = (key, label, value = '', type = 'text') => `<label class="lm-field">${label}<input data-field="${key}" type="${type}" value="${esc(value)}" ${type === 'number' ? 'min="1" max="1000"' : ''}></label>`;
const area = (key, label, value = '', css = '', rows = 3) => `<label class="lm-field">${label}<textarea data-field="${key}" class="${css}" rows="${rows}">${esc(value)}</textarea></label>`;
const toggle = (key, label, on, detail = '', title = '') => {const kind={material_enabled:'material',quiz_enabled:'quiz',allow_discussion:'discussion'}[key];return `<label class="lm-toggle" ${kind?`data-lm-part="${kind}"`:''} ${title?`title="${esc(title)}"`:''}><input type="checkbox" data-field="${key}" ${on ? 'checked' : ''}><span>${kind?lmsUiIcon(kind):''}<span>${label}${detail ? `<small>${detail}</small>` : ''}</span></span></label>`;};
const btn = (action, label, cls = '', attrs = '') => `<button type="button" class="lm-btn ${cls}" data-action="${action}" ${attrs}>${label}</button>`;
function dialog(id, title, subtitle, actions = '') {
    document.getElementById(id)?.dispose?.();
    const modal = document.createElement('div'); modal.id=id; modal.className='lms-module-ui lm-dialog';
    modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true'); modal.setAttribute('aria-label',title);
    modal.innerHTML=`<div class="lm-shell"><header class="lm-header"><div><h2>${esc(title)}</h2><p class="lm-muted">${esc(subtitle)}</p></div><div class="lm-actions">${actions}${btn('close','Tutup')}</div></header><div data-body></div><footer class="lm-footer"><p class="lm-muted" data-footer-note></p><div class="lm-actions" data-footer-actions></div></footer></div>`;
    const previous = document.activeElement;
    const keydown = event => {
        const top=[...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(el=>el.getClientRects().length).at(-1);
        if (top && top!==modal) return;
        if(event.key==='Escape') modal.querySelector('[data-action=close]')?.click();
        if(event.key==='Tab') { const items=[...modal.querySelectorAll('button,input,select,textarea,summary,[tabindex="0"]')].filter(el=>!el.disabled && el.getClientRects().length); const first=items[0], last=items.at(-1); if(event.shiftKey && document.activeElement===first){ event.preventDefault();last?.focus(); } else if(!event.shiftKey && document.activeElement===last){event.preventDefault(); first?.focus();} }
    };
    document.addEventListener('keydown',keydown); modal.dispose=()=>{document.removeEventListener('keydown',keydown);modal.remove();previous?.focus();};
    modal.querySelector('[data-action=close]').onclick=()=>modal.dispose();
    document.body.appendChild(modal); return modal;
}

export function openLmsHtmlPreview({code,title='Materi HTML interaktif',instructions=''}={}) {
    validateLmsHtml(code);
    const modal=dialog('lms-module-html-preview',title,'Pratinjau siswa · HTML interaktif',btn('fullscreen','<span aria-hidden="true">⛶</span><span data-fullscreen-label>Fullscreen</span>','','aria-pressed="false"'));
    modal.classList.add('lm-resource-preview');modal.querySelector('.lm-footer').remove();
    const body=modal.querySelector('[data-body]');body.className='lm-preview-body';
    const frame=mountLmsHtml(body,code,title,instructions,{collapsibleInstructions:true});frame.className='lm-preview-frame';
    const button=modal.querySelector('[data-action=fullscreen]'),fullscreen=installLmsResourceFullscreen({modal,button,exposeGlobals:false});
    button.onclick=()=>void fullscreen.toggle();
    const wasLocked=document.body.classList.contains('overflow-hidden');document.body.classList.add('overflow-hidden');
    const dispose=modal.dispose;modal.dispose=()=>{fullscreen.dispose();button.onclick=null;frame.srcdoc='';dispose();if(!wasLocked)document.body.classList.remove('overflow-hidden');};
    return modal;
}

export function installLmsModuleEditor({ api, getContext, reload, notify, openTopic, copy, progress, review, preview, discussion, deleteTopic, journal }) {
    let saving=false;
    const message=(title,error)=>notify(title,error?.message || String(error),'error');
    function readPacket(card,index) {
        const v=key=>card.querySelector(`[data-field=${key}]`).value;
        const on=key=>card.querySelector(`[data-field=${key}]`).checked?1:0;
        const fail=(message,selector)=>{const error=new Error(`Bahan Ajar ${index+1}: ${message}`);error.control=card.querySelector(selector);throw error;};
        if(!v('title').trim())fail('isi judul terlebih dahulu.','[data-field=title]');
        if(!(on('material_enabled')||on('quiz_enabled')||on('allow_discussion')))fail('aktifkan minimal satu bagian.','[data-field=material_enabled]');
        const type=v('resource_type');
        if(on('material_enabled')) {
            if(type==='text'&&!v('content_description').trim())fail('isi Materi terlebih dahulu.','[data-field=content_description]');
            if(type==='html')try{validateLmsHtml(v('html_code'));}catch(error){fail(error.message,'[data-field=html_code]');}
            if(!['text','html'].includes(type))try{const raw=v('resource_url').trim();const url=new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw)?raw:`https://${raw}`);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!url.hostname)throw Error();}catch{fail('isi tautan Materi HTTP(S) yang valid.','[data-field=resource_url]');}
        }
        let quiz=card.original.quiz_payload||'';try{quiz=window.serializeLmsQuizPayload(card);}catch(error){if(on('quiz_enabled'))fail(error.message,'.lms-quiz-questions-list');}
        if(on('allow_discussion')&&!v('discussion_prompt').trim())fail('isi pemantik Forum Diskusi terlebih dahulu.','[data-field=discussion_prompt]');
        return {id:card.dataset.packetId,title:v('title'),material_enabled:on('material_enabled'),quiz_enabled:on('quiz_enabled'),allow_discussion:on('allow_discussion'),resource_type:type,resource_url:v('resource_url'),content_description:type==='html'?v('html_code'):v('content_description'),html_instructions:v('html_instructions'),instructions:v('html_instructions'),discussion_prompt:v('discussion_prompt'),quiz_payload:quiz};
    }
    function packetCard(packet, index) {
        const card=document.createElement('details'); card.open=true; card.className='lm-packet lms-material-card'; card.dataset.packetId=packet.id||uid('packet'); card.original=packet;
        const type=packet.resource_type==='quiz'?'text':packet.resource_type||'text';
        let quiz={}; try { quiz=JSON.parse(packet.quiz_payload||'{}'); } catch { /* Teacher can repair an old quiz. */ }
        const cbtMode = quiz.mode === 'strict' ? 'strict' : 'relaxed';
        const cbtViolations = Number.isInteger(quiz.max_violations) ? quiz.max_violations : 3;
        const cbtShuffleQ = quiz.shuffle_questions ? 1 : 0;
        const cbtShuffleOpt = quiz.shuffle_options ? 1 : 0;
        card.innerHTML=`<summary><span class="lm-packet-number" data-packet-number>${String(index+1).padStart(2,'0')}</span><span class="lm-packet-heading"><span class="lm-overline" data-packet-label>Bahan Ajar ${index+1}</span><span data-packet-heading>${esc(packet.title||'Belum diberi judul')}</span></span><span class="lm-ready-badge" data-packet-ready>Belum lengkap</span></summary><div class="lm-packet-body">
            <div class="lm-packet-tools">${btn('up','↑','', 'aria-label="Naikkan bahan ajar"')}${btn('down','↓','','aria-label="Turunkan bahan ajar"')}${btn('remove','Hapus','lm-danger')}</div>
            ${field('title','Judul Bahan Ajar *',packet.title)}
            <p class="lm-muted">Aktifkan minimal satu bagian. Siswa mengikuti bagian aktif secara berurutan.</p>
            <div class="lm-components" aria-label="Bagian bahan ajar">
            <div class="lm-component-block" data-lm-part="material"><div class="lm-component-toggle">${toggle('material_enabled','Materi',lmsHasMaterial(packet))}</div>
            <section class="lm-section" data-component="material_enabled" aria-label="Area kerja Materi"><div class="lm-actions"><label class="lm-field" style="flex:1;min-width:150px">Format Materi<select data-field="resource_type">${[['text','Teks / Markdown'],['html','Kode HTML interaktif'],['link','Tautan Web'],['youtube','Video YouTube'],['gdrive','Google Drive / PDF']].map(([v,l])=>`<option value="${v}" ${v===type?'selected':''}>${l}</option>`).join('')}</select></label><div data-html-tools class="lm-actions">${btn('import-html','Impor HTML')}${btn('preview-html','Preview')}<input type="file" data-html-file accept=".html,.htm,text/html" hidden></div></div>
            <div data-url>${field('resource_url','Tautan Materi *',packet.resource_url,'url')}</div>
            <div data-content>${area('content_description','Isi Materi *',type==='html'?'':packet.content_description)}</div>
            <div data-html>${area('html_code','Kode HTML *',type==='html'?packet.content_description:'','lm-code lms-field-html',10)}<span class="lms-html-file-name lm-muted"></span><p class="lm-muted">Impor satu file HTML, maksimal 512 KB. Jawaban form standar dicadangkan di perangkat siswa yang sama.</p></div>
            ${area('html_instructions','Petunjuk belajar',packet.html_instructions || packet.instructions)}<p class="lm-muted">Materi di LMS: minimal 5 menit aktif. Tautan eksternal: 5 menit sejak dibuka.</p></section></div>
            <div class="lm-component-block" data-lm-part="quiz"><div class="lm-component-toggle">${toggle('quiz_enabled','Kuis / CBT',lmsHasQuiz(packet))}</div>
            <section class="lm-section" data-component="quiz_enabled" aria-label="Area kerja Kuis / CBT">
            <input type="hidden" class="lms-quiz-mode" value="${esc(cbtMode)}">
            <input type="hidden" class="lms-quiz-max-violations" value="${esc(cbtViolations)}">
            <input type="hidden" class="lms-quiz-shuffle-q" value="${cbtShuffleQ}">
            <input type="hidden" class="lms-quiz-shuffle-opt" value="${cbtShuffleOpt}">
            <input type="hidden" class="lms-quiz-kkm" value="${esc(quiz.passing_grade ?? 75)}">
            <input type="hidden" class="lms-quiz-time" value="${esc(quiz.time_limit_minutes ?? 0)}">
            <input type="checkbox" class="lms-quiz-retake" style="display:none" ${cbtMode === 'strict' ? '' : (quiz.allow_retake !== 0 ? 'checked' : '')}>
            <div class="lm-actions lm-quiz-toolbar">
                <button type="button" class="lm-btn lm-btn-cbt" data-action="cbt-settings" title="Pengaturan Kuis / CBT">⚙️ Pengaturan Kuis / CBT</button>
                <span class="lms-cbt-badge ${cbtMode === 'strict' ? 'lm-badge-cbt-strict' : 'lm-badge-cbt-relaxed'}">${cbtMode === 'strict' ? `🛡️ CBT (${quiz.time_limit_minutes || 30} mnt · KKM ${quiz.passing_grade ?? 75} · 1x · Maks. ${cbtViolations}x)` : `☕ Kuis (${(quiz.time_limit_minutes ?? 0) > 0 ? `${quiz.time_limit_minutes} mnt` : 'Bebas'} · KKM ${quiz.passing_grade ?? 75} · ${quiz.allow_retake !== 0 ? 'Boleh Ulang' : '1x'})`}</span>
                ${btn('import-quiz','Impor soal')}${btn('preview-quiz','Preview kuis')}
            </div>
            <div class="lms-quiz-questions-list" style="margin-top:12px"></div><div class="lm-actions lm-quiz-add-tools" style="margin-top:12px">${btn('question-mc','+ Pilihan Ganda')}${btn('question-short','+ Isian Singkat')}${btn('question-essay','+ Uraian')}</div></section></div>
            <div class="lm-component-block" data-lm-part="discussion"><div class="lm-component-toggle">${toggle('allow_discussion','Forum Diskusi',lmsHasDiscussion(packet))}</div>
            <section class="lm-section" data-component="allow_discussion" aria-label="Area kerja Forum Diskusi"><div class="lm-actions" style="justify-content:space-between;align-items:center;margin-bottom:6px"><span class="lm-muted" style="font-size:11px">Acuan masalah diskusi</span>${btn('math-discussion','√x Simbol Matematika','','title="Sisipkan simbol atau rumus matematika (LaTeX)" aria-label="Sisipkan simbol matematika pemantik"')}</div>${area('discussion_prompt','Pemantik diskusi *',packet.discussion_prompt)}<p class="lm-muted">Forum terbuka setelah Materi dan Kuis Formatif yang diaktifkan telah tuntas.</p></section></div></div></div>`;
        const title=card.querySelector('[data-field=title]');title.classList.add('lms-field-title');
        for(const section of card.querySelectorAll('[data-component]')){section.id=`lms-component-${card.dataset.packetId}-${section.dataset.component}`;card.querySelector(`[data-field=${section.dataset.component}]`).setAttribute('aria-controls',section.id);}
        const refresh=()=>{for(const section of card.querySelectorAll('[data-component]')) section.hidden=!card.querySelector(`[data-field=${section.dataset.component}]`).checked; const t=card.querySelector('[data-field=resource_type]').value; card.querySelector('[data-html-tools]').hidden=t!=='html';card.querySelector('[data-html]').hidden=t!=='html';card.querySelector('[data-content]').hidden=t!=='text';card.querySelector('[data-url]').hidden=['text','html'].includes(t);};
        card.addEventListener('change',refresh);card.addEventListener('input',renumber);refresh();
        for(const q of quiz.questions||[]) window.addLmsQuizQuestion(card,q.type,q);
        card.querySelector('[data-html-file]').onchange=async event=>{ await importLmsHtmlFile(event.target,notify); };
        card.addEventListener('click',event=>{
            const action=event.target.closest('[data-action]')?.dataset.action;if(!action)return;
            if(action==='remove') { if(card.parentElement.children.length===1) return notify('Bahan Ajar wajib','Modul minimal berisi satu Bahan Ajar.','warning'); card.remove();renumber(); }
            if(action==='up' && card.previousElementSibling) {card.previousElementSibling.before(card);renumber();}
            if(action==='down' && card.nextElementSibling) {card.nextElementSibling.after(card);renumber();}
            if(action.startsWith('question-'))window.addLmsQuizQuestion(card,action.slice(9));
            if(action==='import-quiz')window.openLmsQuizImport(card);
            if(action==='preview-quiz')window.previewLmsQuiz(card);
            if(action==='cbt-settings')window.openLmsQuizSettingsModal?.(card);
            if(action==='math-discussion'){const inp=card.querySelector('[data-field=discussion_prompt]');if(inp)window.openLmsMathPaletteModal?.(inp,null,event.target.closest('[data-action]'));}
            if(action==='import-html')card.querySelector('[data-html-file]').click();
            if(action==='preview-html') {try { openLmsHtmlPreview({code:card.querySelector('[data-field=html_code]').value,title:title.value||'Materi HTML interaktif',instructions:card.querySelector('[data-field=html_instructions]').value}); }catch(error){message('Preview gagal',error);} }
        });
        return card;
    }
    function renumber(){document.querySelectorAll('#lms-module-editor .lm-packet').forEach((card,i)=>{
        for(const [selector,text] of [['[data-packet-number]',String(i+1).padStart(2,'0')],['[data-packet-label]',`Bahan Ajar ${i+1}`],['[data-packet-heading]',card.querySelector('[data-field=title]').value.trim()||'Belum diberi judul']]) {
            const node=card.querySelector(selector);if(node.textContent!==text)node.textContent=text;
        }
    });}
    async function open(id=null,topicId=null) {
        const context=getContext();if(!context.topics?.length) return openTopic();
        let module;
        try {module=id?(await api.get(id)).data:null;}catch(error){message('Modul belum dapat dibuka',error);return;}
        module ||= {id:uid('module'),topic_id:topicId||context.topics[0].id,title:'',is_visible:1,publish_at:new Date(Date.now()-60000).toISOString(),due_date:'',order_index:Math.max(0,...(context.modules||[]).filter(m=>m.topic_id===(topicId||context.topics[0].id)).map(m=>Number(m.order_index)||0))+1,packets:[{resource_type:'text',material_enabled:0,quiz_enabled:0,allow_discussion:0}]};
        const modal=dialog('lms-module-editor',id?'Edit Modul':'Susun Modul',`${context.className} · ${context.subject}`,btn('add-packet','+ Bahan Ajar','lm-primary'));
        modal.querySelector('.lm-header>div').classList.add('lm-editor-heading');
        modal.querySelector('.lm-header>div').insertAdjacentHTML('afterbegin',`<span class="lm-editor-icon">${lmsUiIcon('module')}</span>`);
        const body=modal.querySelector('[data-body]');body.className='lm-layout';
        body.innerHTML=`<main class="lm-main"><div class="lm-editor-path"><span>${lmsUiIcon('chapter')} Bab/Topik</span>${lmsUiIcon('arrow')}<span class="is-current">${lmsUiIcon('module')} Modul</span>${lmsUiIcon('arrow')}<span>${lmsUiIcon('packet')} Bahan Ajar</span></div><div class="lm-identity-panel"><p class="lm-overline">Identitas Modul</p><label class="lm-field">Topik/Bab<select data-module="topic_id" ${id?'disabled':''}>${context.topics.map(t=>`<option value="${esc(t.id)}" ${t.id===module.topic_id?'selected':''}>${esc(t.title)}</option>`).join('')}</select></label>${field('module-title','Nama Modul *',module.title)}</div><div class="lm-composition-title"><div><h3>Susunan Bahan Ajar</h3><p class="lm-muted">Siswa mengerjakan berurutan dari atas.</p></div><span class="lm-composition-count" data-packet-count>1 Bahan Ajar</span></div><div data-packets></div><div class="lm-add-area">${btn('add-packet',`${lmsUiIcon('plus')} Tambah Bahan Ajar Berikutnya`,'lm-add-packet')}<p class="lm-muted" data-add-hint role="status" aria-live="polite"></p></div></main><aside class="lm-aside"><div class="lm-aside-title">${lmsUiIcon('calendar')}<div><h3>Pengaturan Modul</h3><p class="lm-muted">Satu jadwal untuk seluruh Bahan Ajar</p></div></div><div class="lm-readiness-panel"><div class="lm-actions"><span class="lm-overline">Kesiapan Isian</span><strong data-ready-count></strong></div><div class="lm-progress"><span data-ready-progress></span></div></div>${toggle('module-visible','Tampilkan ke siswa',Number(module.is_visible)===1,'Matikan untuk menyimpan sebagai draf.','Jika aktif: Siswa wajib mengerjakan tuntas modul ini untuk dapat ke modul berikutnya. Jika disembunyikan: Modul tidak dapat dilihat oleh siswa, dan siswa yang belum mengerjakan modul ini tetap dapat mengerjakan modul berikutnya.')}<div style="margin-top:18px">${field('module-order','Urutan Modul',module.order_index||1,'number')}${field('module-publish','Buka Modul *',localTime(module.publish_at),'datetime-local')}${field('module-due','Target Selesai *',localTime(module.due_date),'datetime-local')}<label class="lm-field">Pembahasan Guru<select data-field="module-teaching"><option value="0">Sedang Dibahas</option><option value="1">Selesai Dibahas</option></select></label><p class="lm-muted">Semua waktu WITA. Jadwal berlaku untuk seluruh Bahan Ajar dalam Modul ini.</p><div class="lm-notice" style="margin-top:12px">Sesudah target selesai, Modul otomatis <b>Selesai Dibahas</b> dan tetap dapat dipelajari. Penyelesaian susulan ditandai <b>Terlambat</b>, tanpa potongan nilai. Untuk mengaktifkan kembali, pilih Sedang Dibahas dan isi target baru.</div></div></aside>`;
        const teachingSelect = modal.querySelector('[data-field=module-teaching]');
        const dueInput = modal.querySelector('[data-field=module-due]');
        teachingSelect.value = getLmsScheduleState({...module,is_published:2}).teachingCompleted?'1':'0';
        const syncTeachingWithDueDate = () => {
            const rawDue = dueInput?.value?.trim();
            if (!rawDue) return;
            const normalized = normalizeLmsScheduleTime(rawDue, true);
            const dueTime = Date.parse(normalized);
            if (Number.isFinite(dueTime)) {
                if (dueTime > Date.now()) {
                    if (teachingSelect.value === '1') {
                        teachingSelect.value = '0';
                        teachingSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                } else if (dueTime <= Date.now()) {
                    if (teachingSelect.value === '0') {
                        teachingSelect.value = '1';
                        teachingSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            }
        };
        dueInput?.addEventListener('input', syncTeachingWithDueDate);
        dueInput?.addEventListener('change', syncTeachingWithDueDate);
        const packets=modal.querySelector('[data-packets]');for(const [i,p]of module.packets.entries())packets.appendChild(packetCard(p,i));
        modal.querySelector('[data-footer-note]').innerHTML='<span data-error class="lm-error" role="alert"></span>';
        modal.querySelector('[data-footer-actions]').innerHTML=btn('cancel','Batal')+btn('save','Simpan Modul','lm-primary');
        if(id)modal.querySelector('.lm-footer').insertAdjacentHTML('afterbegin',btn('delete-module','Hapus Modul','lm-danger lm-editor-delete'));
        function updateReadiness() {
            let ready=0,firstError='';
            [...packets.children].forEach((card,index)=>{
                let error='';try{readPacket(card,index);ready++;}catch(failure){error=failure.message;}
                if(error&&!firstError)firstError=error;
                card.dataset.ready=error?'false':'true';
                const status=card.querySelector('[data-packet-ready]'),text=error?'Belum lengkap':'✓ Siap';
                if(status.textContent!==text)status.textContent=text;
                status.title=error||'Bagian aktif sudah terisi';
            });
            const limit=packets.children.length>=25;
            for(const button of modal.querySelectorAll('[data-action=add-packet]')){button.disabled=Boolean(firstError||limit||saving);button.title=firstError|| (limit?'Maksimal 25 Bahan Ajar':'Tambah Bahan Ajar berikutnya');}
            modal.querySelector('[data-ready-count]').textContent=`${ready}/${packets.children.length}`;
            modal.querySelector('[data-ready-progress]').style.width=`${ready/packets.children.length*100}%`;
            modal.querySelector('[data-packet-count]').textContent=`${packets.children.length} Bahan Ajar`;
            modal.querySelector('[data-add-hint]').textContent=firstError?`${firstError} Lengkapi sebelum menambah Bahan Ajar berikutnya.`:limit?'Maksimal 25 Bahan Ajar dalam satu Modul.':'Semua isian Bahan Ajar siap. Anda dapat menambahkan urutan berikutnya.';
        }
        function showError(error) {
            const node=modal.querySelector('[data-error]');node.textContent=error.message;
            const card=error.control?.closest('.lm-packet');if(card)card.open=true;
            const control=error.control?.matches('input,textarea,select,button')?error.control:error.control?.querySelector('input,textarea,select,button')||card?.querySelector('summary');
            if(control){control.setAttribute('aria-invalid','true');control.scrollIntoView({block:'center',behavior:'smooth'});control.focus();}else node.scrollIntoView({block:'nearest'});
        }
        let dirty=false,requestId=uid('save'),lastSignature='';modal.addEventListener('input',()=>{dirty=true;});modal.addEventListener('change',()=>{dirty=true;});
        for(const event of ['input','change'])modal.addEventListener(event,e=>{e.target.removeAttribute('aria-invalid');updateReadiness();});
        const changes=new MutationObserver(records=>{if(records.some(record=>!(record.target.closest?.('[data-packet-ready],[data-packet-number],[data-packet-label],[data-packet-heading]')))){dirty=true;updateReadiness();}});changes.observe(packets,{childList:true,subtree:true});
        const dispose=modal.dispose;modal.dispose=()=>{changes.disconnect();dispose();};
        const close=()=>{if(saving)return;if(dirty && !window.confirm('Tutup editor dan abaikan perubahan yang belum disimpan?'))return;modal.dispose();};modal.querySelector('[data-action=close]').onclick=close;
        modal.addEventListener('click',async event=>{
            const action=event.target.closest('[data-action]')?.dataset.action;
            if(action==='delete-module'){
                if(saving||!id||!window.confirm(`Hapus Modul "${module.title}" dari LMS? Riwayat jawaban dan nilai tetap disimpan.`))return;
                const controls=[...modal.querySelectorAll('input,textarea,select,button')].filter(el=>!el.disabled),button=event.target.closest('button');
                saving=true;controls.forEach(el=>el.disabled=true);button.textContent='Menghapus…';
                try{await api.remove(module.id);dirty=false;modal.dispose();notify('Modul dihapus','Riwayat jawaban dan nilai tetap disimpan.','success');await reload();}
                catch(error){showError(error);}
                finally{saving=false;controls.forEach(el=>el.disabled=false);button.textContent='Hapus Modul';updateReadiness();}
                return;
            }
            if (action && !['save','cancel','close','preview-html','preview-quiz','import-html','import-quiz','cbt-settings'].includes(action)) dirty=true;
            if(action==='cancel')close();
            if(action==='add-packet'){
                if(saving)return;
                try{[...packets.children].forEach(readPacket);}catch(error){showError(error);return;}
                if(packets.children.length>=25)return notify('Batas Bahan Ajar','Maksimal 25 Bahan Ajar per Modul.','warning');
                const card=packetCard({material_enabled:0,quiz_enabled:0,allow_discussion:0,resource_type:'text'},packets.children.length);packets.appendChild(card);dirty=true;updateReadiness();card.scrollIntoView({block:'nearest',behavior:'smooth'});card.querySelector('input[data-field=title]').focus();
            }
            if(action!=='save'||saving)return;
            const val=key=>modal.querySelector(`[data-field=${key}]`).value;
            const errorEl=modal.querySelector('[data-error]');errorEl.textContent='';
            let disabledControls=[];
            try {
                if(!val('module-title').trim())throw Error('Nama Modul wajib diisi.');
                const schedule=validateLmsSchedule(val('module-publish'),val('module-due'));
                const data=[...packets.children].map(readPacket);
                saving=true;modal.querySelector('[data-action=save]').disabled=true;modal.querySelector('[data-action=save]').textContent='Menyimpan…';
                disabledControls=[...modal.querySelectorAll('input,textarea,select,button')].filter(el=>!el.disabled);
                disabledControls.forEach(el=>el.disabled=true);
                const payload={id:module.id,revision:module.revision||0,topic_id:modal.querySelector('[data-module=topic_id]').value,title:val('module-title'),description:modal.querySelector('[data-field=module-description]')?.value || module.description || '',is_visible:modal.querySelector('[data-field=module-visible]').checked?1:0,order_index:Number(val('module-order')),is_teaching_completed:Number(val('module-teaching')),...schedule,packets:data};
                const signature=JSON.stringify(payload);if(signature!==lastSignature){lastSignature=signature;requestId=uid('save');}
                await api.save({...payload,request_id:requestId});
                dirty=false;modal.dispose();notify('Modul tersimpan','Bahan Ajar dan pengaturan Modul berhasil disimpan.','success');await reload();
            }catch(error){showError(error);}finally{saving=false;disabledControls.forEach(el=>el.disabled=false);updateReadiness();const button=modal.querySelector('[data-action=save]');if(button){button.disabled=false;button.textContent='Simpan Modul';}}
        });
        updateReadiness();
        modal.querySelector('[data-field=module-title]').focus();return modal;
    }
    async function monitor(id){
        try{
            const result=await api.progress(id);const m=dialog('lms-module-monitor',result.material.title,'Monitoring Modul · progres seluruh Bahan Ajar');m.querySelector('.lm-footer').remove();const body=m.querySelector('[data-body]');body.className='lm-monitor-body';
            body.innerHTML=`<div class="lm-actions lm-monitor-toolbar"><span class="lm-badge">${result.summary.completed_count}/${result.summary.total_students} tuntas</span><span class="lm-badge lm-late">${result.summary.late_count} terlambat</span><input data-search class="lm-input" placeholder="Cari nama atau NIS…" aria-label="Cari siswa"></div><div class="lm-table-wrap"><table class="lm-table"><thead><tr><th>Nama Siswa</th><th>Progres</th><th>Durasi aktif</th><th>Nilai kuis</th><th>Rincian</th></tr></thead><tbody>${result.data.map(s=>`<tr data-search-value="${esc(s.name+' '+s.nis).toLowerCase()}"><td><b>${esc(s.name)}</b><div class="lm-muted lm-monitor-nis">${esc(s.nis)}</div></td><td>${s.completed_packets}/${s.total_packets} Bahan Ajar${s.is_late?'<div class="lm-late">Terlambat</div>':''}</td><td>${Math.floor(s.active_seconds_total/60)} m ${s.active_seconds_total%60} d</td><td>${s.quiz_score??'–'}</td><td><details><summary style="cursor:pointer">Lihat</summary>${s.packets.map(p=>`<div style="padding:8px 0"><b>${esc(p.title)}</b><p>${p.status==='completed'?'✓ Tuntas':p.status==='opened'?'Sedang belajar':'Belum dibuka'}${p.is_late?' · Terlambat':''}</p><div class="lm-actions">${btn('packet-progress','Pantau','','data-id="'+esc(p.id)+'"')}${p.has_quiz?btn('review','Periksa kuis','','data-id="'+esc(p.id)+'" data-nis="'+esc(s.nis)+'"'):''}</div></div>`).join('')}</details></td></tr>`).join('')}</tbody></table></div>`;
            body.querySelector('[data-search]').oninput=e=>body.querySelectorAll('tbody tr').forEach(row=>row.hidden=!row.dataset.searchValue.includes(e.target.value.toLowerCase()));
            body.addEventListener('click',e=>{
                const b=e.target.closest('[data-action]');
                if(b?.dataset.action==='packet-progress'){m.dispose();progress(b.dataset.id);}
                if(b?.dataset.action==='review'){m.dispose();review(b.dataset.id,b.dataset.nis);}
            });
        }catch(error){message('Monitoring gagal dimuat',error);}
    }
    function render(container,topics,modules,filter=''){
        container.classList.add('lms-module-ui','lm-teacher-workspace');const query=filter.toLowerCase().trim();
        const expanded=container.lmsTeacherExpansion ||= new Map(),scope=query?`filter:${query}:`:'';
        const key=(kind,id)=>scope+kind+':'+id;
        const isExpanded=(id,fallback)=>expanded.has(id)?expanded.get(id):fallback;
        const allVisibleRows=topics.flatMap(t=>{
            const tm=modules.filter(m=>m.topic_id===t.id);
            return tm.filter(m=>!query||[m.title,t.title,...m.packets.map(p=>p.title)].join(' ').toLowerCase().includes(query));
        });
        const bottomModule=allVisibleRows.at(-1)||null;
        const defaultOpenTopicId=bottomModule?bottomModule.topic_id:(topics[0]?.id||null);
        const defaultOpenModuleId=bottomModule?bottomModule.id:null;
        container.innerHTML=topics.length?topics.map((topic,topicIndex)=>{
            const all=modules.filter(m=>m.topic_id===topic.id).map((m,index)=>({...m,display_index:index+1}));
            const rows=all.filter(m=>!query||[m.title,topic.title,...m.packets.map(p=>p.title)].join(' ').toLowerCase().includes(query));
            if(query&&!rows.length&&!topic.title.toLowerCase().includes(query))return '';
            const actions=btn('edit-topic','Edit Bab','','data-id="'+esc(topic.id)+'"')
                +btn('new-module',`${lmsUiIcon('plus')} Modul`,'lm-primary','data-topic="'+esc(topic.id)+'"');
            const chapterKey=key('chapter',topic.id);
            return `<details class="lm-topic" data-lm-kind="chapter" data-expansion-key="${esc(chapterKey)}" ${isExpanded(chapterKey,Boolean(query)||topic.id===defaultOpenTopicId)?'open':''}>${lmsTopicHeading(topic,topicIndex,all.length,actions,'summary')}<div class="lm-chapter-content">${rows.map((module,moduleIndex)=>{
                const schedule=getLmsScheduleState({...module,is_published:module.is_visible?2:0});
                const moduleKey=key('module',module.id);
                const syncPacket=(module.packets||[]).find(p=>p.id)||module.packets?.[0];
                const canSyncJournal=Boolean(module.is_visible&&schedule.isAccessible&&syncPacket);
                return `<details class="lm-module-card" data-lm-kind="module" data-module-id="${esc(module.id)}" data-expansion-key="${esc(moduleKey)}" name="lms-teacher-module" ${isExpanded(moduleKey,Boolean(query)?false:module.id===defaultOpenModuleId)?'open':''}>
                    <summary class="lm-module-top"><div class="lm-module-identity"><span class="lm-module-icon">${lmsUiIcon('module')}</span><div class="lm-module-copy"><div class="lm-actions"><span class="lm-overline lm-module-label">Modul ${module.display_index}</span><span class="lm-badge">${module.packets.length} Bahan Ajar</span></div><h4>${esc(module.title)}</h4><div class="lm-actions"><span class="lm-badge ${module.is_visible?'lm-visible':''}">${module.is_visible?'Tampil ke siswa':'Draf · Disembunyikan'}</span><span class="lm-badge">${schedule.teachingCompleted?'Selesai Dibahas':schedule.state==='scheduled'?'Terjadwal':'Sedang Dibahas'}</span></div><p class="lm-muted lm-module-schedule">${lmsUiIcon('calendar')}${esc(formatLmsScheduleTime(module.publish_at))} → ${esc(formatLmsScheduleTime(module.due_date))}</p></div></div>
                    <div class="lm-actions lm-module-actions">${btn('edit-module','Edit','lm-button-emphasis','data-id="'+esc(module.id)+'" title="Edit pengaturan modul dan bahan ajar"')}${btn('module-progress','Pantau','','data-id="'+esc(module.id)+'" title="Pantau progres dan ketuntasan belajar siswa di modul ini"')}${canSyncJournal?`<button type="button" class="lm-btn lm-btn-journal" data-action="sync-journal" data-id="${esc(syncPacket.id)}" data-lms-journal-material="${esc(syncPacket.id)}" title="Sinkronkan kehadiran dan materi modul ini ke Jurnal Mengajar">${lmsUiIcon('journal')} Sinkron Jurnal</button>`:''}${btn('visibility',module.is_visible?'Sembunyikan':'Tampilkan','','data-id="'+esc(module.id)+'" title="'+(module.is_visible?'Sembunyikan modul dari pandangan siswa (draf)':'Tampilkan modul ke siswa')+'"')}</div><span class="lm-disclosure" aria-hidden="true">⌄</span></summary>
                    <div class="lm-module-content"><div class="lm-packet-list-label">${lmsUiIcon('packet')} Bahan Ajar dalam Modul</div>${module.packets.map((packet,index)=>`<div class="lm-packet-row" data-lm-kind="packet"><div class="lm-packet-identity"><span class="lm-packet-sequence">${String(index+1).padStart(2,'0')}</span><div><span class="lm-overline">Bahan Ajar ${index+1}</span><h5>${esc(packet.title)}</h5><div class="lm-actions lm-parts">${lmsComponentPills(packet)}</div></div></div><div class="lm-actions">${lmsHasMaterial(packet)?btn('preview-packet','Lihat Materi','','data-id="'+esc(packet.id)+'"'):''}${lmsHasDiscussion(packet)&&discussion?btn('forum','Forum','','data-id="'+esc(packet.id)+'"'):''}${btn('packet-progress','Pantau','','data-id="'+esc(packet.id)+'"')}</div></div>`).join('')}</div>
                </details>`;
            }).join('')||'<div class="lm-empty">Belum ada Modul di Bab ini. Pilih + Modul untuk mulai menyusun Bahan Ajar.</div>'}</div></details>`;
        }).join(''):`<div class="lm-empty"><p>Buat Bab/Topik, lalu susun Modul dan Bahan Ajar.</p>${btn('new-topic','+ Bab/Topik','lm-primary')}</div>`;
        if(!container.innerHTML.trim())container.innerHTML='<div class="lm-empty">Tidak ada Bab, Modul, atau Bahan Ajar yang cocok dengan pencarian.</div>';
        if(container.querySelector('[data-lm-kind=chapter]'))container.insertAdjacentHTML('afterbegin',`<div class="lm-outline-tools"><span class="lm-muted">Susunan LMS</span><div class="lm-actions">${btn('collapse-all','Ringkas Semua')}${btn('expand-all','Buka Semua')}</div></div>`);
        container.onclick=async e=>{const b=e.target.closest('[data-action]');if(!b){const summary=e.target.closest('summary');if(summary&&container.contains(summary)){const details=summary.parentElement;if(details.dataset.lmKind==='module'){const willOpen=!details.open;if(willOpen){container.querySelectorAll('details[data-lm-kind="module"]').forEach(other=>{if(other!==details&&other.open){other.open=false;expanded.set(other.dataset.expansionKey,false);}});}details.open=willOpen;expanded.set(details.dataset.expansionKey,willOpen);e.preventDefault();return;}if(details.dataset.lmKind==='chapter'){const willOpen=!details.open;details.open=willOpen;expanded.set(details.dataset.expansionKey,willOpen);e.preventDefault();return;}if(details.dataset.expansionKey){expanded.set(details.dataset.expansionKey,!details.open);}}return;}
            if(b.disabled)return;if(b.closest('summary'))e.preventDefault();
            const id=b.dataset.id,a=b.dataset.action,m=modules.find(m=>m.id===id);
            if(a==='collapse-all'||a==='expand-all'){e.stopPropagation();container.querySelectorAll('details[data-expansion-key]').forEach(details=>{details.open=a==='expand-all';expanded.set(details.dataset.expansionKey,details.open);});return;}
            try{
            if(a==='new-topic'||a==='edit-topic')openTopic(id);if(a==='forum')discussion?.(id);if(a==='new-module')open(null,b.dataset.topic);if(a==='edit-module')open(id);if(a==='module-progress')monitor(id);if(a==='packet-progress')progress(id);if(a==='preview-packet')preview(id);
            if(a==='sync-journal'){const matId=b.dataset.lmsJournalMaterial||b.dataset.id;if(journal)journal(matId);else if(typeof window?.openLmsJournal==='function')window.openLmsJournal(matId);}
            if(a==='visibility'){b.disabled=true;await api.visibility(id,{revision:m.revision,is_visible:m.is_visible?0:1});await reload();}
        }catch(error){message('Perubahan gagal',error);b.disabled=false;}};
    }
    return {open,render,monitor,previewHtml:openLmsHtmlPreview};
}
