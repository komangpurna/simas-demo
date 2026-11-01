// Local browser test fixture only. The real Worker runs against disposable SQLite;
// Firebase identity is replaced at the authentication boundary by the unit-test harness.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { harness } = require('../tests/helpers/lms-quiz-harness.cjs');
const root = path.resolve(__dirname, '..');
let fixture = harness();
let queue = Promise.resolve();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/__test__/quiz/')) {
        const action = url.pathname.split('/').pop();
        let input = '';
        request.on('data', data => { input += data; if (input.length > 1000000) request.destroy(); });
        request.on('end', () => {
            queue = queue.then(async () => {
                let result;
                if (action === 'reset') { fixture.sqlite.close(); fixture = harness(); result = { status: 200, success: true }; }
                else {
                    const body = input ? JSON.parse(input) : Object.fromEntries(url.searchParams);
                    const teacher = ['list', 'review', 'material', 'materials'].includes(action);
                    result = await fixture.call(action, body, teacher ? { uid: 'guru' } : { nis: '100' });
                }
                response.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                response.end(JSON.stringify(result));
            }).catch(error => { response.writeHead(500); response.end(JSON.stringify({ error: error.message })); });
        });
        return;
    }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || relative.split(path.sep).some(segment => segment.startsWith('.')) || !mime[path.extname(file)] || !fs.existsSync(file)) {
        response.writeHead(404); response.end('Not found'); return;
    }
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(response);
});
server.listen(8100, '127.0.0.1', () => console.log('LMS quiz test fixture: http://127.0.0.1:8100/cypress/fixtures/lms-quiz-workflow.html'));
const shutdown = () => server.close(() => { fixture.sqlite.close(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
