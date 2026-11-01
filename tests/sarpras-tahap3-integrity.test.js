/**
 * tests/sarpras-tahap3-integrity.test.js
 * Unit Test Jest untuk Tahap 3: Penggunaan Sarpras (Peminjaman Fasilitas/Alat & Sirkulasi BMHP)
 * Menguji: Paritas Endpoint API, RBAC, Modal Anti-Nesting, dan Zero Overlapping Icon
 */

const fs = require('fs');
const path = require('path');

describe('Sarpras Tahap 3: Peminjaman & BMHP Verification Tests', () => {
    const workerPath = path.resolve(__dirname, '../cloudflare/worker.js');
    const clientPath = path.resolve(__dirname, '../js/cloudflare-client.js');
    const penggunaanHtmlPath = path.resolve(__dirname, '../sarpras-penggunaan.html');
    const penggunaanJsPath = path.resolve(__dirname, '../js/page-sarpras-penggunaan.js');

    test('1. File implementasi Tahap 3 wajib tersedia', () => {
        expect(fs.existsSync(workerPath)).toBe(true);
        expect(fs.existsSync(clientPath)).toBe(true);
        expect(fs.existsSync(penggunaanHtmlPath)).toBe(true);
        expect(fs.existsSync(penggunaanJsPath)).toBe(true);
    });

    test('2. Skema D1 sarpras_loans, sarpras_bmhp_items, dan sarpras_bmhp_transactions ada di worker.js', () => {
        const workerContent = fs.readFileSync(workerPath, 'utf8');
        expect(workerContent).toContain('CREATE TABLE IF NOT EXISTS sarpras_loans');
        expect(workerContent).toContain('CREATE TABLE IF NOT EXISTS sarpras_bmhp_items');
        expect(workerContent).toContain('CREATE TABLE IF NOT EXISTS sarpras_bmhp_transactions');
        expect(workerContent).toContain('generateSarprasLoanCode(environment)');
        expect(workerContent).toContain('generateSarprasBmhpCode(environment, category)');
    });

    test('3. Paritas Endpoint Peminjaman (Loans) di worker.js', () => {
        const workerContent = fs.readFileSync(workerPath, 'utf8');
        expect(workerContent).toContain('path === "/api/sarpras/loans/check-conflict" && method === "GET"');
        expect(workerContent).toContain('path === "/api/sarpras/loans" && method === "GET"');
        expect(workerContent).toContain('path === "/api/sarpras/loans" && method === "POST"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/loans/") && !path.endsWith("/status") && !path.endsWith("/check-conflict") && method === "PUT"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/loans/") && !path.endsWith("/status") && !path.endsWith("/check-conflict") && method === "DELETE"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/loans/") && path.endsWith("/status") && method === "POST"');
    });

    test('4. Paritas Endpoint Barang Habis Pakai (BMHP) di worker.js', () => {
        const workerContent = fs.readFileSync(workerPath, 'utf8');
        expect(workerContent).toContain('path === "/api/sarpras/bmhp/items" && method === "GET"');
        expect(workerContent).toContain('path === "/api/sarpras/bmhp/items" && method === "POST"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/bmhp/items/") && method === "PUT"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/bmhp/items/") && method === "DELETE"');
        expect(workerContent).toContain('path === "/api/sarpras/bmhp/transactions" && method === "GET"');
        expect(workerContent).toContain('path === "/api/sarpras/bmhp/transactions" && method === "POST"');
    });

    test('5. Paritas Metode Client di cloudflare-client.js', () => {
        const clientContent = fs.readFileSync(clientPath, 'utf8');
        expect(clientContent).toContain('async checkSarprasLoanConflict(');
        expect(clientContent).toContain('async getSarprasLoans(');
        expect(clientContent).toContain('async saveSarprasLoan(');
        expect(clientContent).toContain('async deleteSarprasLoan(');
        expect(clientContent).toContain('async updateSarprasLoanStatus(');
        expect(clientContent).toContain('async getSarprasBmhpItems(');
        expect(clientContent).toContain('async saveSarprasBmhpItem(');
        expect(clientContent).toContain('async deleteSarprasBmhpItem(');
        expect(clientContent).toContain('async getSarprasBmhpTransactions(');
        expect(clientContent).toContain('async recordSarprasBmhpTransaction(');
    });

    test('6. Modal Anti-Nesting Mandate: Seluruh modal sarpras-penggunaan.html berada di luar <main>', () => {
        const html = fs.readFileSync(penggunaanHtmlPath, 'utf8');
        const mainCloseIndex = html.indexOf('</main>');
        expect(mainCloseIndex).toBeGreaterThan(0);

        const modalIds = [
            'modal-loan-form',
            'modal-loan-status',
            'modal-bmhp-item',
            'modal-bmhp-trx',
            'modal-bmhp-history'
        ];
        modalIds.forEach(id => {
            const modalIndex = html.indexOf(`id="${id}"`);
            expect(modalIndex).toBeGreaterThan(mainCloseIndex);
        });
    });

    test('7. Anti-Overlapping Icon Rule: Tidak ada leading icon di dalam field input pada sarpras-penggunaan.html', () => {
        const content = fs.readFileSync(penggunaanHtmlPath, 'utf8');
        expect(content).not.toMatch(/<input[^>]+class="[^"]*\b(pl-9|pl-10)\b/i);
    });

    test('8. Anti-Blank Screen Mandate: Wajib memuat global.js dan meng-unhide main', () => {
        const html = fs.readFileSync(penggunaanHtmlPath, 'utf8');
        expect(html).toContain('src="js/global.js"');

        const js = fs.readFileSync(penggunaanJsPath, 'utf8');
        expect(js).toContain("classList.remove('hidden')");
    });
});
