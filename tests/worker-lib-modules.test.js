/**
 * Tes perilaku modul cloudflare/lib hasil refaktor bertahap worker.js (tahap 1).
 * Nilai patokan dihitung dari implementasi lama di worker.js sebelum dipindah, sehingga
 * pemindahan modul terbukti tidak mengubah perilaku.
 */
const { loadWorkerLibModule, buildFlatWorkerSource } = require('./helpers/worker-source.cjs');

describe('cloudflare/lib/http.js', () => {
    const { ALLOWED_ORIGINS, getCorsHeaders, jsonResponse, errorResponse } = loadWorkerLibModule('lib/http.js');
    const req = origin => new Request('https://api.test/x', { headers: origin ? { Origin: origin } : {} });

    test('origin produksi & localhost dipantulkan, origin asing diganti origin utama', () => {
        expect(getCorsHeaders(req('https://simas-shakti.web.app'))['Access-Control-Allow-Origin']).toBe('https://simas-shakti.web.app');
        expect(getCorsHeaders(req('http://localhost:5173'))['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
        expect(getCorsHeaders(req('https://evil.example'))['Access-Control-Allow-Origin']).toBe(ALLOWED_ORIGINS[0]);
        expect(getCorsHeaders(req(null))['Access-Control-Allow-Origin']).toBe('*');
        expect(getCorsHeaders(null)['Access-Control-Allow-Origin']).toBe('*');
    });

    test('header keamanan selalu terpasang', () => {
        const headers = getCorsHeaders(req('https://smagesa.web.app'));
        expect(headers).toMatchObject({ Vary: 'Origin', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    });

    test('jsonResponse & errorResponse mempertahankan envelope dan status', async () => {
        const ok = jsonResponse({ a: 1 }, 201, req('https://smagesa.web.app'));
        expect(ok.status).toBe(201);
        expect(ok.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
        expect(await ok.json()).toEqual({ a: 1 });

        const err = errorResponse('Tidak boleh', 403);
        expect(err.status).toBe(403);
        expect(err.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(await err.json()).toEqual({ success: false, error: 'Tidak boleh' });
        expect(errorResponse('x').status).toBe(400);
    });
});

describe('cloudflare/lib/secure-card-token.js', () => {
    const { encryptSecureCardToken, decryptSecureCardToken } = loadWorkerLibModule('lib/secure-card-token.js');
    const SECRET = 'synthetic-card-token-secret-for-tests';
    // Token yang dulu diterbitkan dengan kunci hardcode (bocor lewat js/utils.mjs) tidak boleh diterima lagi.
    const LEGACY_LEAKED_TOKEN = 'kts_dfca9ce4b8bdc2f4e2999e42b5a3551c';

    test.each(['12345', '0098765432', ' 777 '])('token NIS %p dapat dibolak-balik dengan secret yang sama', nis => {
        const token = encryptSecureCardToken(nis, SECRET);
        expect(token).toMatch(/^kts_[0-9a-f]+$/);
        expect(decryptSecureCardToken(token, SECRET)).toBe(nis.trim());
        expect(decryptSecureCardToken(token, 'secret-lain-yang-berbeda-panjang')).toBeNull();
    });

    test('tanpa secret (atau secret terlalu pendek) token tidak diterbitkan maupun diterima', () => {
        const token = encryptSecureCardToken('12345', SECRET);
        expect(encryptSecureCardToken('12345')).toBeNull();
        expect(encryptSecureCardToken('12345', 'pendek')).toBeNull();
        expect(decryptSecureCardToken(token)).toBeNull();
        expect(decryptSecureCardToken(token, '')).toBeNull();
    });

    test('token dari kunci hardcode lama ditolak', () => {
        expect(decryptSecureCardToken(LEGACY_LEAKED_TOKEN, SECRET)).toBeNull();
    });

    test('token rusak, dimodifikasi, atau bukan kts_ ditolak', () => {
        const token = encryptSecureCardToken('12345', SECRET);
        const tampered = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
        expect(encryptSecureCardToken('', SECRET)).toBeNull();
        expect(decryptSecureCardToken(null, SECRET)).toBeNull();
        expect(decryptSecureCardToken('abc_dfca9ce4b8bdc2f4', SECRET)).toBeNull();
        expect(decryptSecureCardToken('kts_123', SECRET)).toBeNull();
        expect(decryptSecureCardToken(tampered, SECRET)).toBeNull();
    });

    test('kunci token kartu tidak lagi tertanam di kode', () => {
        const fs = require('node:fs');
        const path = require('node:path');
        const leakedKey = /0x534d4147|SMAGESA-SHAKTI-KTS-2026/;
        for (const file of ['cloudflare/lib/secure-card-token.js', 'js/utils.mjs', 'js/student-card-renderer.js', 'kartu-shakti.html']) {
            expect(fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).not.toMatch(leakedKey);
        }
    });

    test('helper internal cipher tidak diekspor', () => {
        const exported = loadWorkerLibModule('lib/secure-card-token.js');
        expect(Object.keys(exported).sort()).toEqual(['decryptSecureCardToken', 'encryptSecureCardToken']);
    });
});

describe('cloudflare/lib/messaging-format.js', () => {
    const { cleanPhoneNumber, escapeTelegramHtml, isValidTelegramChatId } = loadWorkerLibModule('lib/messaging-format.js');

    test('normalisasi nomor WhatsApp ke format 62', () => {
        expect(cleanPhoneNumber('0812-3456 789')).toBe('628123456789');
        expect(cleanPhoneNumber('8123')).toBe('628123');
        expect(cleanPhoneNumber('+62812')).toBe('62812');
        expect(cleanPhoneNumber('62812')).toBe('62812');
        expect(cleanPhoneNumber(null)).toBe('');
    });

    test('escape HTML Telegram & validasi chat id', () => {
        expect(escapeTelegramHtml('<b>A & B</b>')).toBe('&lt;b&gt;A &amp; B&lt;/b&gt;');
        expect(escapeTelegramHtml(undefined)).toBe('');
        expect(isValidTelegramChatId('-1001234567')).toBe(true);
        expect(isValidTelegramChatId('12ab')).toBe(false);
    });
});

describe('Sumber Worker datar untuk tes lama', () => {
    const flat = buildFlatWorkerSource();

    test('tanpa import/export modul, tetapi tetap memuat export default Worker', () => {
        expect(flat).not.toMatch(/^import\s/m);
        expect(flat).not.toMatch(/^export\s+(?!default\b)/m);
        expect(flat.match(/^export default \{/gm)).toHaveLength(1);
        expect(flat).toContain('function getCorsHeaders(request)');
        expect(flat).toContain('function xxteaBtea(v, n, k)');
    });

    test('fs.readFileSync(worker.js) di tes mengembalikan sumber datar', () => {
        const fs = require('node:fs');
        const path = require('node:path');
        expect(fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js'), 'utf8')).toBe(flat);
        expect(fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker.js')).toString('utf8')).toBe(flat);
    });
});
