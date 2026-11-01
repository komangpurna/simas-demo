import { configureLmsHtmlEditor, importLmsHtmlFile, mountLmsHtml, setLmsHtmlFrame, validateLmsHtml, getLmsMaterialInstructions } from '../../js/lms-html.mjs';
import { resolveLmsResourceLink } from '../../js/lms-resource-link.mjs';
import { installLmsResourceFullscreen } from '../../js/lms-resource-fullscreen.mjs';
import { renderSafeMarkdown, calculateDueDateUrgency } from '../../js/utils.mjs';
import { validateLmsSchedule, getLmsScheduleState, formatLmsScheduleTime } from '../../js/lms-schedule.mjs';
import { attachLmsHtmlState, lmsHtmlRevision, readLmsHtmlSession, writeLmsHtmlSession, clearLmsHtmlSession } from '../../js/lms-html-state.mjs';
const data = await (await fetch('/__test__/html/data')).json();
document.getElementById('container-lms-materials-list').innerHTML = data.card;
document.getElementById('demo-modals').innerHTML = data.preview + data.resource;
const schoolTime = time => new Date(time + 8 * 3600000).toISOString().slice(0, 16);
document.getElementById('input-lms-material-publish-at').value = schoolTime(Date.now() - 3600000);
document.getElementById('input-lms-material-due').type = 'datetime-local';
document.getElementById('input-lms-material-due').value = schoolTime(Date.now() + 3600000);
installLmsResourceFullscreen();
const notice = (title, message) => { document.getElementById('demo-notice').textContent = `${title}: ${message}`; };
async function request(route, method = 'GET', body, role = 'student') {
    const res = await fetch('/__test__/html/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route, method, body, role }) });
    const value = await res.json(); if (!res.ok) throw new Error(value.error); return value;
}
const materials = [];
if (new URLSearchParams(location.search).has('edit-flow')) {
    materials.push(...(await request('/api/lms/materials', 'GET', undefined, 'teacher')).data);
    document.querySelector('.lms-material-card').dataset.originalOrder = materials.find(m => m.id === 'mat')?.order_index || 1;
}
const raw = { materials: [] };
async function refresh() { const course = await request('/api/lms/student/courses'); raw.materials = course.materials; return true; }
window.importLmsHtmlFile = input => importLmsHtmlFile(input, notice);
window.loadLmsData = async () => {};
window.closeUnifiedLmsCreator = () => {};
window.normalizeLmsResourceUrl = value => value;
new Function('configureLmsHtmlEditor','mountLmsHtml','validateLmsHtml','showToast','renderSafeMarkdown','auth','raporConfig',
    'getSelectedLmsTargetClasses','currentLmsTopics','currentLmsMaterials','lmsReplicationRequests','cfSaveLmsMaterial','validateLmsSchedule', data.teacher)(
    configureLmsHtmlEditor, mountLmsHtml, validateLmsHtml, notice, renderSafeMarkdown, { currentUser: { uid: 'guru', displayName: 'Guru' } },
    { tahun_ajaran_aktif: '2026/2027' }, () => ['X-1'], [{ id: 'topic', title: 'Bab WFH' }], materials, new Map(),
    body => request('/api/lms/materials', 'POST', body, 'teacher'), validateLmsSchedule);
new Function('studentLmsRawData','currentNIS','currentStudent','cfTrackLmsStudentProgress','loadStudentLmsData','processAndRenderStudentLms','resolveLmsResourceLink','getLmsMaterialInstructions',
    'setLmsHtmlFrame','validateLmsHtml','renderSafeMarkdown','attachLmsHtmlState','lmsHtmlRevision',
    'readLmsHtmlSession','writeLmsHtmlSession','clearLmsHtmlSession', `${data.tracker}\nlet currentStudentResourceMaterial, studentHtmlStateController, studentHtmlResumeAttempted = false; ${data.student}\nwindow.demoResume = resumeStudentHtmlMaterial;`)(
    raw, '100', { nis: '100', class: 'X-1', name: 'Siswa Satu' }, body => request('/api/lms/student/track', 'POST', body),
    async () => { try { return await refresh(); } catch (_) { return false; } }, () => {}, resolveLmsResourceLink, getLmsMaterialInstructions,
    setLmsHtmlFrame, validateLmsHtml, renderSafeMarkdown, attachLmsHtmlState, lmsHtmlRevision,
    readLmsHtmlSession, writeLmsHtmlSession, clearLmsHtmlSession);
window.demoFrameMessages = [];
window.addEventListener('message', event => {
    if ([document.querySelector('#lms-preview-body iframe')?.contentWindow, document.getElementById('student-resource-frame')?.contentWindow].includes(event.source) && event.data?.lmsHtmlTest) {
        window.demoFrameMessages.push(event.data);
    }
});
document.getElementById('demo-student').onclick = async () => { await refresh(); await window.openStudentMaterial('mat'); };
document.getElementById('demo-progress').onclick = async () => {
    const progress = await request('/api/lms/materials/mat/progress', 'GET', undefined, 'teacher');
    document.getElementById('demo-duration').textContent = progress.data.map(s => `${s.name}: ${s.active_seconds_total} detik, ${s.session_count} sesi`).join('\n');
};
window.demoReady = true;
if (new URLSearchParams(location.search).has('edit-flow')) {
    const section = document.createElement('section'); section.id = 'student-lms-list-container';
    document.querySelector('main').append(section);
    const subjects = [];
    const render = new Function('studentLmsSubjects', 'getLmsScheduleState', 'formatLmsScheduleTime', 'calculateDueDateUrgency',
        `const studentLmsClockOffset=0,studentLmsActiveSubject='IPA',studentLmsStatusFilter='',studentLmsOpenTopics=new Map(),studentLmsCompletedSections=new Set();const updateStudentLmsFilterCounters=()=>{};${data.studentFlow};return renderStudentLmsStream;`)(subjects, getLmsScheduleState, formatLmsScheduleTime, calculateDueDateUrgency);
    window.escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
    window.demoRefreshFlow = async () => {
        const courses = await request('/api/lms/student/courses');
        subjects.splice(0, subjects.length, { subject_name: 'IPA', topics: courses.topics.map(t => ({ ...t, materials: courses.materials.filter(m => m.topic_id === t.id) })) });
        render(); return courses;
    };
}
// Match production: resume only after the fresh server response validated access.
if (readLmsHtmlSession('100')) { await refresh(); await window.demoResume(); }
