import { lmsHasMaterial, lmsHasQuiz, lmsHasDiscussion, groupLmsModules } from './lms-structure.mjs';
import { getLmsScheduleState, formatLmsScheduleTime } from './lms-schedule.mjs';
import { lmsViewEscape as esc, lmsUiIcon, lmsComponentPills, lmsTopicHeading } from './lms-module-view.mjs';

export function renderLmsStudentModules(container,subject,{filter='',openMaterial,openQuiz,openDiscussion,onError=()=>{},now=Date.now()}={}) {
    container.classList.remove('hidden');container.classList.add('lms-module-ui','lm-student-workspace');
    const all=(subject.topics||[]).flatMap(topic=>topic.materials||[]).concat(subject.direct_materials||[]);
    const topics=subject.topics?.length?subject.topics:[{id:'',title:'Pembelajaran',materials:all}];
    const expanded=container.lmsExpansion ||= new Map();
    const open=(key,fallback)=>expanded.has(key)?expanded.get(key):fallback;
    const firstTopic=Math.max(0,topics.findIndex(topic=>(topic.materials||[]).some(packet=>!packet.requirement_met&&!packet.is_locked)));
    function packet(p,index,autoOpen) {
        const locked=Boolean(p.is_locked),hasMaterial=lmsHasMaterial(p),hasQuiz=lmsHasQuiz(p),read=!hasMaterial||p.reading_complete===true,quizDone=!hasQuiz||Boolean(p.quiz_submitted||p.quiz_passed),passed=!hasQuiz||p.quiz_passed;
        const steps=[
            ...(hasMaterial?[{key:'material',title:'Materi',done:p.reading_complete,available:!locked,label:'Buka Materi',info:p.reading_complete?'Waktu belajar terpenuhi.':p.reading_mode==='external'?'5 menit sejak tautan dibuka.':`5 menit aktif di LMS${p.is_opened?` · sisa ${Math.ceil((p.reading_remaining_seconds||0)/60)} menit`:''}.`}]:[]),
            ...(hasQuiz?[{key:'quiz',title:'Kuis Formatif / CBT',done:quizDone,available:!locked&&read,label:quizDone?'Lihat Kuis':'Buka Kuis',info:p.my_quiz_score!=null?`Nilai ${p.my_quiz_score} · ${p.quiz_passed?'Tuntas':'Selesai dikerjakan'}`:quizDone?'Jawaban terkirim · Menunggu pemeriksaan guru.':'Kerjakan kuis formatif / CBT.'}]:[]),
            ...(lmsHasDiscussion(p)?[{key:'discussion',title:'Forum Diskusi',done:p.discussion_completed,available:!locked&&read&&quizDone,label:'Buka Diskusi',info:p.discussion_completed?'Tanggapanmu sudah tercatat.':'Tanggapi pemantik dari guru.'}]:[])
        ];
        const key='packet:'+p.id;
        return `<details id="lms-mat-${esc(p.id)}" class="lm-student-packet ${locked?'lm-locked':''}" data-lm-kind="packet" data-expansion-key="${esc(key)}" ${open(key,autoOpen)?'open':''}>
            <summary class="lm-student-packet-header"><span class="lm-packet-sequence">${String(index+1).padStart(2,'0')}</span><div class="lm-packet-copy"><span class="lm-overline">Bahan Ajar ${index+1}</span><h5>${esc(p.title)}</h5><div class="lm-actions lm-parts">${lmsComponentPills(p)}</div></div><span class="lm-badge ${p.requirement_met?'lm-done':''}">${p.requirement_met?'✓ Tuntas':locked?'Terkunci':p.is_opened?'Sedang Belajar':'Belum Tuntas'}</span><span class="lm-disclosure" aria-hidden="true">⌄</span></summary>
            <div class="lm-student-packet-content">${p.instructions&&!locked?`<p class="lm-packet-guide">${esc(p.instructions)}</p>`:''}${locked?`<p class="lm-packet-guide">${esc(p.unlock_reason||'Tuntaskan Bahan Ajar sebelumnya.')}</p>`:''}
            <ol class="lm-steps" aria-label="Alur belajar Bahan Ajar">${steps.map(step=>`<li class="lm-step" data-lms-step="${step.key}" data-step-state="${step.done?'completed':step.available?'available':'locked'}"><span class="lm-step-icon">${lmsUiIcon(step.done?'check':step.key)}</span><div class="lm-step-copy"><b>${step.title}</b><p class="lm-muted">${step.available||step.done?esc(step.info):'Selesaikan langkah sebelumnya.'}</p></div><button type="button" class="lm-btn ${step.available&&!step.done?'lm-primary':''}" data-packet="${esc(p.id)}" data-component="${step.key}" ${!step.available?'disabled':''}>${step.label}</button></li>`).join('')}</ol>
            ${p.requirement_met?'<p class="lm-muted lm-done">✓ Seluruh bagian aktif Bahan Ajar ini selesai.</p>':''}</div></details>`;
    }
    container.innerHTML=`<div class="lm-learning-guide"><span class="lm-guide-icon">${lmsUiIcon('module')}</span><div><b>Belajar selangkah demi selangkah</b><p>Buka Bab → Modul → Bahan Ajar. Tuntaskan setiap bagian hingga tercentang untuk membuka urutan berikutnya. Guru memantau progres dan durasi belajarmu.</p></div></div>`+topics.map((topic,topicIndex)=>{
        const allModules=groupLmsModules(topic.materials||[]).map((module,index)=>({...module,display_index:index+1}));
        const modules=allModules.filter(module=>filter!=='completed'||module.is_completed).filter(module=>!['pending','incomplete','unfinished','not_completed','belum'].includes(filter)||!module.is_completed);
        if(!modules.length)return '';
        const chapterKey='chapter:'+topic.id,firstModule=modules.find(module=>!module.is_completed&&!module.is_locked)?.id;
        return `<details class="lm-topic" data-lm-kind="chapter" data-expansion-key="${esc(chapterKey)}" ${open(chapterKey,topicIndex===firstTopic)?'open':''}>
            ${lmsTopicHeading(topic,topicIndex,allModules.length,'','summary')}<div class="lm-chapter-content">${modules.map(module=>{
                const schedule=getLmsScheduleState(module,now),moduleKey='module:'+module.id,firstPacket=module.packets.find(p=>!p.requirement_met&&!p.is_locked)?.id;
                const status=module.is_completed?'✓ Tuntas':module.is_locked?'Terkunci':'Belum Tuntas';
                return `<details class="lm-module-card" data-lm-kind="module" data-student-module="${esc(module.id)}" data-expansion-key="${esc(moduleKey)}" ${open(moduleKey,module.id===firstModule)?'open':''}>
                    <summary class="lm-module-top"><div class="lm-module-identity"><span class="lm-module-icon">${lmsUiIcon('module')}</span><div class="lm-module-copy"><span class="lm-overline lm-module-label">Modul ${module.display_index}</span><h4>${esc(module.title)}</h4><div class="lm-muted">${module.completed_packets}/${module.total_packets} Bahan Ajar tuntas</div></div></div><span class="lm-badge ${module.is_completed?'lm-done':''}">${status}</span><span class="lm-disclosure" aria-hidden="true">⌄</span><div class="lm-progress" aria-label="Progres Modul"><span style="width:${Math.round(module.completed_packets/module.total_packets*100)}%"></span></div></summary>
                    <div class="lm-module-content"><div class="lm-module-context"><p class="lm-muted">Target ${esc(formatLmsScheduleTime(module.due_date))}</p><div class="lm-actions">${schedule.teachingCompleted?'<span class="lm-badge">Selesai Dibahas</span>':''}${module.is_late?'<span class="lm-badge lm-late">Terlambat</span>':''}</div></div>
                    ${module.description?`<p class="lm-muted">${esc(module.description)}</p>`:''}${module.is_locked?`<p class="lm-packet-guide">${esc(module.packets[0]?.unlock_reason||'Tuntaskan Modul sebelumnya untuk membuka Modul ini.')}</p>`:''}${schedule.teachingCompleted&&!module.is_completed?'<p class="lm-notice">Masih bisa dituntaskan. Penyelesaian susulan ditandai Terlambat tanpa potongan nilai otomatis.</p>':''}
                    ${module.packets.map((p,index)=>packet(p,index,p.id===firstPacket)).join('')}</div></details>`;
            }).join('')}</div></details>`;
    }).join('');
    if(!container.querySelector('[data-lm-kind=chapter]'))container.insertAdjacentHTML('beforeend',`<div class="lm-empty">${filter==='completed'?'Belum ada Modul yang tuntas.':'Semua Modul dalam tampilan ini sudah tuntas.'}</div>`);
    container.onclick=async event=>{
        const summary=event.target.closest('summary');if(summary&&container.contains(summary)){const details=summary.parentElement;if(details.dataset.expansionKey)expanded.set(details.dataset.expansionKey,!details.open);return;}
        const button=event.target.closest('button[data-component]');if(!button||button.disabled)return;
        const p=all.find(packet=>packet.id===button.dataset.packet);if(!p||p.is_locked)return;
        try{button.disabled=true;if(button.dataset.component==='material')await openMaterial(p);if(button.dataset.component==='quiz')await openQuiz(p);if(button.dataset.component==='discussion')await openDiscussion(p);}catch(error){onError(error);}finally{if(button.isConnected)button.disabled=false;}
    };
    return true;
}
