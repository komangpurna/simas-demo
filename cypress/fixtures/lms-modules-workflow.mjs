import { installLmsModuleEditor } from '/js/lms-module-editor.mjs';
import { renderLmsStudentModules } from '/js/lms-module-student.mjs';
import { installQuizBuilder } from '/js/lms-quiz-ui.mjs';
const notify=(title,text)=>document.getElementById('notice').textContent=`${title}: ${text}`;
installQuizBuilder({notify});
let modules=[],mode='teacher',context;
async function api(route,body,role='teacher',method=body?'POST':'GET'){
    const response=await fetch('/__test__/html/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({route:'/api/lms/'+route,method,body,role})});
    const result=await response.json();if(!response.ok)throw Error(result.error);return result;
}
const workspace=document.getElementById('workspace');
async function reload(){
    if(mode==='teacher'){
        modules=(await api('modules')).data;
        const topics=(await api('topics')).data;
        context={topics,modules,className:'X-1',subject:topics[0]?.subject_name||'IPA'};
        editor.render(workspace,context.topics,modules);
    }else{
        const result=await api('student/courses',null,'student');
        renderLmsStudentModules(workspace,{topics:result.topics.map(t=>({...t,materials:result.materials.filter(p=>p.topic_id===t.id&&p.module_id)}))},{
            openMaterial:async p=>{await api('student/track',{material_id:p.id,action:'open',session_id:'browser-read'},'student');window.lastPacket=p;notify('Materi dibuka',p.title);await reload();},
            openQuiz:p=>notify('Kuis',p.id),
            openDiscussion:async p=>{if(!p.is_opened)await api('student/track',{material_id:p.id,action:'open'},'student');await api('discussions',{material_id:p.id,content:'Saya sudah memahami pembahasan.'},'student');await reload();},
            onError:error=>notify('Gagal',error.message)
        });
    }
}
const editor=installLmsModuleEditor({api:{get:id=>api('modules/'+id),save:p=>api('modules',p),visibility:(id,p)=>api('modules/'+id+'/settings',p),remove:id=>api('modules/'+id,null,'teacher','DELETE'),progress:id=>api('modules/'+id+'/progress')},getContext:()=>context,reload,notify,openTopic:()=>{},copy:()=>{},progress:id=>notify('Pantau',id),review:(id,nis)=>notify('Periksa',`${id}/${nis}`),preview:id=>notify('Preview',id)});
document.getElementById('new').onclick=()=>editor.open(null,'topic');
document.getElementById('teacher').onclick=()=>{mode='teacher';return reload();};document.getElementById('student').onclick=()=>{mode='student';return reload();};document.getElementById('theme').onclick=()=>document.documentElement.classList.toggle('dark');
window.fixture={api,reload,editor};await reload();window.fixture.ready=true;
