// Disposable localhost fixture: real Worker + SQLite; authentication replaced at the fixture boundary.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { journalHarness } = require('../tests/helpers/lms-journal-harness.cjs');
const port = Number(process.env.LMS_JOURNAL_TEST_PORT) || 8103;
const origin = `http://127.0.0.1:${port}`;
let fixture = journalHarness({ origin });
let queue = Promise.resolve();
const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__test__/journal/')) {
        let input = '';
        req.on('data', chunk => { input += chunk; if (input.length > 500000) req.destroy(); });
        req.on('end', () => {
            queue = queue.then(async () => {
                let result;
                if (url.pathname === '/__test__/journal/reset') { fixture.sqlite.close(); fixture = journalHarness({ origin }); result = { httpStatus:200,success:true }; }
                else if (url.pathname === '/__test__/journal/progress') {
                    fixture.sqlite.exec("INSERT OR IGNORE INTO lms_activity_events(id,material_id,student_nis,action,occurred_at) VALUES ('late','read','200','open','2026-01-15 04:00:00')");
                    result = { httpStatus:200,success:true };
                } else if (url.pathname === '/__test__/journal/remove-materials') {
                    fixture.sqlite.exec('DELETE FROM lms_materials');
                    result = { httpStatus:200,success:true };
                } else if (url.pathname === '/__test__/journal/classroom') {
                    const names = ['Aditya Pratama','Ayu Lestari','Bagas Saputra','Bella Maharani','Cahya Dewi','Daffa Ramadhan','Dewi Anggraini','Dimas Putra','Eka Wulandari','Fajar Nugraha','Farah Safitri','Gede Mahendra','Gita Puspita','Hana Permata','Indah Sari','Intan Prameswari','Kadek Arya','Kevin Adinata','Komang Adelia','Laras Kusuma','Made Arimbawa','Maria Felicia','Nadia Kirana','Naufal Hakim','Ni Luh Putri','Nikita Anjani','Pandu Wijaya','Putu Dharma','Rafi Alfarizi','Rania Zahra','Rizky Firmansyah','Salsa Nabila','Satria Wardana','Tiara Melati','Vina Oktaviani','Wayan Surya Aditya Pramana'];
                    fixture.sqlite.exec('DELETE FROM lms_progress; DELETE FROM lms_activity_events;');
                    names.forEach((name, index) => {
                        const nis=index===0?'100':index===1?'200':String(1000+index);
                        fixture.sqlite.prepare("INSERT INTO students(nis,name,class,status) VALUES (?,?,'X-1','active') ON CONFLICT(nis) DO UPDATE SET name=excluded.name").run(nis,name);
                        if(index%4===2)return;
                        const prior=index%4===3, status=index%4===1?'opened':'completed';
                        const at=prior?'2026-01-14 02:00:00':'2026-01-15 02:00:00', seconds=prior?5400:120+index*47;
                        fixture.sqlite.prepare("INSERT INTO lms_progress(id,material_id,topic_id,student_nis,student_name,student_class,status,first_opened_at,last_accessed_at,active_seconds_total,session_count) VALUES (?,'read','topic',?,?,'X-1',?,?,?,?,?)")
                            .run('classroom_'+index,nis,name,status,at,at,seconds,2);
                    });
                    result={httpStatus:200,success:true};
                } else if (url.pathname === '/__test__/journal/counts') {
                    result = { httpStatus:200,success:true, journals:fixture.sqlite.prepare('SELECT COUNT(*) n FROM jurnal_guru').get().n,
                        logs:fixture.sqlite.prepare('SELECT COUNT(*) n FROM work_logs').get().n, evidence:fixture.sqlite.prepare('SELECT COUNT(*) n FROM lms_journal_evidence').get().n };
                } else result = await fixture.request(url.pathname + url.search, input ? JSON.parse(input) : null, fixture.actor, req.method);
                res.writeHead(result.httpStatus, { 'Content-Type':result.svg ? 'image/svg+xml; charset=utf-8' : 'application/json', 'Cache-Control':'no-store' });
                res.end(result.svg || JSON.stringify(result));
            }).catch(error => { res.writeHead(500); res.end(JSON.stringify({error:error.message})); });
        }); return;
    }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname)), relative = path.relative(root, file);
    if (relative.startsWith('..') || relative.split(path.sep).some(part => part.startsWith('.')) || !mime[path.extname(file)] || !fs.existsSync(file)) {
        res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'Content-Type':mime[path.extname(file)], 'Cache-Control':'no-store' }); fs.createReadStream(file).pipe(res);
});
server.listen(port, '127.0.0.1', () => console.log(`${origin}/cypress/fixtures/lms-journal-workflow.html`));
const shutdown = () => server.close(() => { fixture.sqlite.close(); process.exit(0); });
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
