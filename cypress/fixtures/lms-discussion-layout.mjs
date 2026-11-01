import { installLmsDiscussionLayout } from '../../js/lms-discussion-layout.mjs';
import { quizEscape } from '../../js/lms-quiz-ui.mjs';
const data = await (await fetch('/__test__/html/data')).json();
document.getElementById('demo-modals').innerHTML = data.studentDiscussion + data.teacherDiscussion;
window.escapeHTML = quizEscape;
const notice = (title, message) => { document.getElementById('demo-notice').textContent = `${title}: ${message}`; };
window.showPopup = notice;
async function api(route, method = 'GET', body, role = 'student') {
    const response = await fetch('/__test__/html/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route, method, body, role }) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || value.message);
    return value;
}
const prompt = Array.from({ length: 24 }, (_, i) => `${i + 1}. Jelaskan perkembangan gagasan para ilmuwan dalam menyusun tabel periodik unsur. Bandingkan dasar pengelompokan, kelebihan, dan kendala tiap model. Gunakan contoh untuk mendukung pendapatmu.`).join('\n') + '\nAKHIR PEMANTIK: Tuliskan simpulan dengan bahasamu sendiri.';
await api('/api/lms/materials', 'POST', { id: 'mat', topic_id: 'topic', title: 'Sejarah perkembangan tabel periodik unsur', teacher_name: 'Guru Mapel', subject_name: 'IPA', class_name: 'X-1', resource_type: 'text', content_description: 'Bacaan untuk diskusi.', allow_discussion: 1, discussion_prompt: prompt, is_published: 1, publish_at: new Date(Date.now() - 3600000).toISOString(), due_date: new Date(Date.now() + 3600000).toISOString() }, 'teacher');
await api('/api/lms/student/track', 'POST', { material_id: 'mat', action: 'open', session_id: 'discussion-layout-test' });
const raw = { materials: [] };
async function refresh() { raw.materials = (await api('/api/lms/student/courses')).materials; return true; }
await refresh();
new Function('studentLmsRawData', 'currentNIS', 'currentStudent', 'cfGetLmsDiscussions', 'cfSaveLmsDiscussion', 'loadStudentLmsData', 'installLmsDiscussionLayout',
    `let activeStudentDiscussionMaterialId, activeStudentReplyingTo, currentStudentLmsCommentsMap = new Map(); ${data.studentDiscussionHandlers}`)(
    raw, '100', { nis: '100', name: 'Siswa Satu', class: 'X-1' },
    id => api(`/api/lms/discussions/${encodeURIComponent(id)}`), body => api('/api/lms/discussions', 'POST', body), refresh, installLmsDiscussionLayout);
new Function('currentLmsMaterials', 'auth', 'cfGetLmsDiscussions', 'cfSaveLmsDiscussion', 'escapeHTML', 'showToast', 'installLmsDiscussionLayout',
    `let currentActiveDiscussionMaterialId, currentReplyingToComment, currentActiveDiscussionMaterialPrompt, currentActiveDiscussionTeacherName, discussionModalKeydownHandler, currentLmsCommentsMap = new Map(); ${data.teacherDiscussionHandlers}`)(
    raw.materials, { currentUser: { uid: 'guru', displayName: 'Guru Mapel' } },
    id => api(`/api/lms/discussions/${encodeURIComponent(id)}`, 'GET', undefined, 'teacher'), body => api('/api/lms/discussions', 'POST', body, 'teacher'), quizEscape, notice, installLmsDiscussionLayout);
document.getElementById('demo-student-discussion').onclick = () => window.openStudentLmsDiscussion('mat');
document.getElementById('demo-teacher-discussion').onclick = () => window.openLmsDiscussionModal('mat');
window.demoReady = true;
