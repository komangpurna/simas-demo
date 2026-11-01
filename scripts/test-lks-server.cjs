// Isolated browser fixture: actual page markup and logic; auth and D1 replaced locally.
// Bind loopback only. No production APIs or data are accessed.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let settings;
const reset = () => { settings = new Map([['book_sales_lks_data', {
    books: [{ grade: 10, subject: 'Matematika', harga: 17000, terima: 10, terjual: 0, diam: 0, sisa: 10, isActive: true }],
    transactions: [], circulations: [], cashFlows: [], vendors: []
}]]); };
reset();
const bootstrap = `
const auth = {}, SCHOOL_CONFIG = {};
const role = new URL(location.href).searchParams.get('role') || 'admin_kelas';
localStorage.setItem('user_role', role);
localStorage.setItem('user_name', 'Penguji LKS');
window.hasRole = target => target === role;
window.getCurrentUserDoc = async () => ({ role, assignedClass: 'X-1' });
window.getActiveClasses = async () => ['X-1', 'X-2'];
window.getStudentsByClass = async () => [{ nis: '100', name: "I Made O'Brian", class: 'X-1' }, { nis: '101', name: 'Ni Luh Ayu', class: 'X-1' }];
const initLayout = async () => {};
const parseASCSchedule = async () => null;
const formatDateIndo = () => '13 Oktober 2026';
const escapeHTML = value => { const div = document.createElement('div'); div.textContent = String(value ?? ''); return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };
const showToast = (title, message, type) => { const el = document.getElementById('lks-test-notice'); el.textContent = title + ': ' + message; el.dataset.type = type; };
const cfClient = {
    enabled: true,
    async getSystemSetting(key) { const response = await fetch('/__test__/lks/settings/' + encodeURIComponent(key)); if (!response.ok) throw new Error('Read failed'); return response.json(); },
    async saveSystemSetting(key, value) { const response = await fetch('/__test__/lks/settings/' + encodeURIComponent(key), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }); if (!response.ok) throw new Error('Save failed'); return response.json(); }
};
const onAuthStateChanged = (_, callback) => { Promise.resolve(callback({ uid: 'lks-browser-test' })).then(() => { window.lksReady = true; }); };
`;
const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const send = (status, content, type = 'application/json') => { response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(content); };
    if (url.pathname === '/__test__/lks/reset' && request.method === 'POST') { reset(); send(200, '{}'); return; }
    if (url.pathname.startsWith('/__test__/lks/settings/')) {
        const key = decodeURIComponent(url.pathname.split('/').pop());
        if (request.method === 'POST') {
            let body = '';
            for await (const chunk of request) { body += chunk; if (body.length > 1000000) { send(413, '{}'); return; } }
            try { settings.set(key, JSON.parse(body)); } catch { send(400, '{}'); return; }
            send(200, '{"success":true}');
        } else send(200, JSON.stringify(settings.get(key) || null));
        return;
    }
    const match = url.pathname.match(/^\/__test__\/lks\/(page|module)\/(pesan-lks|penjualan-buku)$/);
    if (match) {
        const [, type, name] = match;
        if (type === 'page') {
            const html = fs.readFileSync(path.join(root, name + '.html'), 'utf8')
                .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<link\b[^>]*>/gi, '')
                .replace('</head>', '<link rel="stylesheet" href="/css/tailwind.css"></head>')
                .replace('</body>', '<div id="lks-test-notice" role="status"></div><script type="module" src="/__test__/lks/module/' + name + '"></script></body>');
            send(200, html, 'text/html');
        } else {
            const source = fs.readFileSync(path.join(root, 'js/page-' + name + '.js'), 'utf8').replace(/^import\s+[^;]+;?/gm, '');
            send(200, bootstrap + source, 'text/javascript');
        }
        return;
    }
    if (url.pathname === '/css/tailwind.css') { send(200, fs.readFileSync(path.join(root, 'css/tailwind.css')), 'text/css'); return; }
    send(404, '{}');
});
server.listen(8101, '127.0.0.1', () => console.log('LKS browser fixture: http://127.0.0.1:8101/__test__/lks/page/pesan-lks'));
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
