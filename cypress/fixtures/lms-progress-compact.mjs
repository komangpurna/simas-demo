// Actual modal/CSS/handlers. Student records are synthetic; only the read API is substituted.
import { quizEscape } from '../../js/lms-quiz-ui.mjs';
const data = await (await fetch('/__test__/html/data')).json();
const style = document.createElement('style'); style.textContent = data.creatorStyle; document.head.append(style);
const root = document.createElement('div'); root.innerHTML = data.progress; document.body.append(root);
const students = Array.from({ length: 35 }, (_, i) => ({
    nis: String(1200 + i), name: `Siswa Uji ${String(i + 1).padStart(2, '0')}`, status: i < 11 ? 'completed' : i < 21 ? 'opened' : 'not_started',
    first_opened_at: i < 21 ? '2026-10-15T00:10:00Z' : '', completed_at: i < 11 ? '2026-10-15T00:15:00Z' : '',
    active_seconds_total: i < 21 ? 265 : 0, session_count: i < 21 ? 1 : 0
}));
students[0].name='Siswa Uji dengan Nama Lebih Panjang';
new Function('currentLmsMaterials', 'cfGetLmsMaterialProgress', 'escapeHTML',
    `let currentLmsProgressMaterial, currentLmsProgressData = []; ${data.progressHandlers}`)(
    [{ id: 'mat', title: 'Rotasi Fungsi', class_name: 'XI-3', resource_type: 'html' }],
    async id => new URLSearchParams(location.search).has('live')
        ? (await fetch('/__test__/html/api', { method: 'POST', body: JSON.stringify({ route: `/api/lms/materials/${id}/progress`, role: 'teacher' }) })).json()
        : ({ summary: { total_students: 35, completed_count: 11, opened_count: 10, not_started_count: 14 }, data: students }), quizEscape);
await window.openLmsProgressModal('mat');
const analytics=document.createElement('section');analytics.id='fixture-analytics';analytics.hidden=true;analytics.style.padding='8px';
analytics.innerHTML='<h1>Matriks Keaktifan</h1><div style="display:flex;gap:6px;margin:8px 0"><button id="analytics-all">Semua Modul</button><button id="analytics-material">Satu Bahan Ajar</button></div><input id="input-search-lms-analytics" placeholder="Cari nama atau NIS" oninput="window.filterLmsAnalyticsTable()" style="width:100%;padding:8px;margin-bottom:8px"><select id="select-filter-lms-analytics-badge" hidden><option value=""></option></select>'+data.analytics;document.body.append(analytics);
new Function('escapeHTML','students',`let currentLmsAnalytics,currentLmsMaterials=[{id:'mat',title:'Refleksi Fungsi Interaktif',allow_discussion:1}],currentLmsTopics=[],currentLmsAnalyticsTopicId='';${data.analyticsHandlers};window.showAnalytics=scope=>{currentLmsAnalytics={scope,material_id:scope==='material'?'mat':null,has_discussion_in_scope:true,data:students.map(s=>({...s,total_materials:3,completed_count:s.status==='completed'?1:0,not_started_count:s.status==='not_started'?3:2,opened_count:s.status==='opened'?1:0,discussion_count:s.status==='completed'?1:0,completion_rate:s.status==='completed'?100:s.status==='opened'?50:0}))};document.getElementById('input-search-lms-analytics').value='';window.closeLmsProgressModal();document.getElementById('fixture-analytics').hidden=false;renderLmsClassAnalytics();};`)(quizEscape,students);
document.getElementById('analytics-all').onclick=()=>window.showAnalytics('global');document.getElementById('analytics-material').onclick=()=>window.showAnalytics('material');
window.overrideStudentProgress=(nis,action,id)=>window.lastOverride={nis,action,id};
window.demoReady = true;
