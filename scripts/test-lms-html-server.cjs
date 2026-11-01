// Disposable localhost fixture. Uses actual UI handlers and actual Worker/SQLite.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { harness } = require('../tests/helpers/lms-quiz-harness.cjs');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const teacher = read('js/page-guru-mapel.js'), student = read('js/page-portal-siswa.js');
function handlers(source, names) {
    return acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.map(n => n.type === 'ExportNamedDeclaration' ? n.declaration : n).filter(n => n && (
        n.type === 'FunctionDeclaration' ? names.includes(n.id.name) : n.type === 'ExpressionStatement' && names.includes(n.expression.left?.property?.name))
        )
        .map(n => source.slice(n.start, n.end)).join('\n');
}
const teacherDoc = new JSDOM(read('guru-mapel.html')).window.document;
const studentDoc = new JSDOM(read('portal-siswa.html')).window.document;
const fixtureData = {
    card: teacherDoc.querySelector('.lms-material-card').outerHTML,
    preview: teacherDoc.getElementById('modal-lms-text-preview').outerHTML,
    resource: studentDoc.getElementById('modal-student-resource').outerHTML,
    studentDiscussion: studentDoc.getElementById('modal-student-lms-discussion').outerHTML,
    teacherDiscussion: teacherDoc.getElementById('modal-lms-discussion').outerHTML,
    studentDiscussionHandlers: handlers(student, ['openStudentLmsDiscussion', 'closeStudentLmsDiscussion', 'renderStudentLmsPromptCard', 'renderStudentLmsDiscussions', 'formatTeacherDisplayName', 'focusStudentDiscussionReply', 'replyToStudentLmsComment', 'cancelStudentLmsReply', 'sendStudentLmsComment']),
    teacherDiscussionHandlers: handlers(teacher, ['openLmsDiscussionModal', 'closeLmsDiscussionModal', 'renderLmsDiscussionPromptCard', 'renderLmsDiscussions', 'focusLmsDiscussionReplyPrompt', 'replyToLmsComment', 'cancelLmsReply', 'sendLmsDiscussionComment', 'closeAllCommentMenus']),
    studentDiscussion: studentDoc.getElementById('modal-student-lms-discussion').outerHTML,
    teacherDiscussion: teacherDoc.getElementById('modal-lms-discussion').outerHTML,
    studentDiscussionHandlers: handlers(student, ['openStudentLmsDiscussion', 'closeStudentLmsDiscussion', 'renderStudentLmsPromptCard', 'renderStudentLmsDiscussions', 'formatTeacherDisplayName', 'focusStudentDiscussionReply', 'replyToStudentLmsComment', 'cancelStudentLmsReply', 'sendStudentLmsComment']),
    teacherDiscussionHandlers: handlers(teacher, ['openLmsDiscussionModal', 'closeLmsDiscussionModal', 'renderLmsDiscussionPromptCard', 'renderLmsDiscussions', 'focusLmsDiscussionReplyPrompt', 'replyToLmsComment', 'cancelLmsReply', 'sendLmsDiscussionComment', 'closeAllCommentMenus']),
    creator: teacherDoc.getElementById('modal-lms-creator').outerHTML,
    creatorStyle: [...teacherDoc.querySelectorAll('style')].map(style => style.textContent).join('\n'),
    creatorHandlers: handlers(teacher, ['addLmsMaterialFormCard', 'switchLmsCreatorTab', 'updateResourcePlaceholder', 'previewLmsHtml', 'closeLmsTextPreviewModal', 'closeUnifiedLmsCreator']),
    progress: teacherDoc.getElementById('modal-lms-progress').outerHTML,
    analytics: teacherDoc.getElementById('tr-lms-analytics-headers').closest('.lms-analytics-table').outerHTML,
    analyticsHandlers: handlers(teacher, ['getLmsStudentEngagementBadge', 'renderLmsClassAnalytics', 'renderLmsAnalyticsTableRows', 'filterLmsAnalyticsTable']),
    progressHandlers: handlers(teacher, ['openLmsProgressModal', 'formatLmsTimestampWITA', 'formatLmsActiveSeconds', 'renderLmsProgressTable', 'filterLmsProgressStudents', 'closeLmsProgressModal']),
    teacher: handlers(teacher, ['updateResourcePlaceholder', 'previewLmsHtml', 'switchMaterialContentTab', 'closeLmsTextPreviewModal', 'saveLmsMaterialFromWizard', 'normalizeLmsPublishAt', 'addLmsMaterialFormCard', 'refreshLmsMaterialCardsState', 'updateLmsSaveButtonLabel', 'clearLmsCardInvalid', 'markLmsCardInvalid', 'toggleLmsDiscussionPrompt']),
    studentFlow: handlers(student, ['renderSingleMaterialCardHtml', 'renderStudentLmsStream']),
    student: handlers(student, ['openStudentMaterial', 'closeStudentResourceModal', 'resumeStudentHtmlMaterial', 'trackStudentItemOpened']),
    tracker: student.slice(student.indexOf('let lmsActiveSession = null;'), student.indexOf('async function trackStudentItemOpened'))
};
let h = harness(undefined, { realLearningPath: true });
let queue = Promise.resolve();
const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/__test__/external-material') {
        response.writeHead(200, { 'Content-Type': 'text/html', 'X-Frame-Options': 'SAMEORIGIN' });
        response.end('<!doctype html><html lang="id"><title>Materi sumber</title><h1>Latihan di situs sumber</h1><label>Jawaban <input id="answer"></label></html>'); return;
    }
    if (url.pathname === '/__test__/html/data') {
        response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(fixtureData)); return;
    }
    if (url.pathname === '/__test__/html/api' || url.pathname === '/__test__/html/reset' || url.pathname === '/__test__/html/clock') {
        let text = '';
        request.on('data', data => { text += data; if (text.length > 1500000) request.destroy(); });
        request.on('end', () => {
            queue = queue.then(async () => {
                if (url.pathname.endsWith('/reset')) { const options = JSON.parse(text || '{}'); h.sqlite.close(); h = harness(undefined, { realLearningPath: true, minimumReadingSeconds: options.minimumReadingSeconds === 300 ? 300 : 0 }); response.writeHead(200); response.end('{}'); return; }
                if (url.pathname.endsWith('/clock')) { const now = Number(JSON.parse(text).now); if (!Number.isFinite(now)) throw new Error('Invalid fixture clock'); vm.runInContext(`Date.now=()=>${now}`, h.context); response.writeHead(200); response.end('{}'); return; }
                const body = JSON.parse(text);
                if (!String(body.route).startsWith('/api/lms/')) throw new Error('Only local LMS fixture routes are available');
                h.context.actor = body.role === 'teacher' ? { uid: 'guru' } : { nis: '100' };
                const res = await h.context.worker.fetch(new Request(`https://worker.test${body.route}`, {
                    method: body.method || 'GET', ...(body.body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body.body) } : {})
                }), h.env, {});
                response.writeHead(res.status, { 'Content-Type': 'application/json' }); response.end(await res.text());
            }).catch(error => { response.writeHead(500); response.end(JSON.stringify({ error: error.message })); });
        }); return;
    }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || relative.split(path.sep).some(s => s.startsWith('.')) || !mime[path.extname(file)] || !fs.existsSync(file)) {
        response.writeHead(404); response.end('Not found'); return;
    }
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(response);
});
const port = Number(process.env.LMS_TEST_PORT || 8102);
server.listen(port, '127.0.0.1', () => console.log(`LMS HTML fixture: http://127.0.0.1:${port}/cypress/fixtures/lms-html-workflow.html`));
process.on('SIGINT', () => server.close(() => { h.sqlite.close(); process.exit(0); }));
