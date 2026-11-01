/**
 * tests/sarpras-tahap2-integrity.test.js
 * Unit Test Jest untuk Tahap 2: Aduan/Usulan Sarpras & Perencanaan RKAS
 * Menguji: Paritas Endpoint API, RBAC, Modal Anti-Nesting, dan Zero Overlapping Icon
 */

const fs = require('fs');
const path = require('path');

describe('Sarpras Tahap 2: Aduan & RKAS Verification Tests', () => {
    const workerPath = path.resolve(__dirname, '../cloudflare/worker.js');
    const clientPath = path.resolve(__dirname, '../js/cloudflare-client.js');
    const aduanHtmlPath = path.resolve(__dirname, '../sarpras-aduan.html');
    const rkasHtmlPath = path.resolve(__dirname, '../sarpras-rkas.html');
    const aduanJsPath = path.resolve(__dirname, '../js/page-sarpras-aduan.js');
    const rkasJsPath = path.resolve(__dirname, '../js/page-sarpras-rkas.js');

    test('1. File implementasi Tahap 2 wajib tersedia', () => {
        expect(fs.existsSync(workerPath)).toBe(true);
        expect(fs.existsSync(clientPath)).toBe(true);
        expect(fs.existsSync(aduanHtmlPath)).toBe(true);
        expect(fs.existsSync(rkasHtmlPath)).toBe(true);
        expect(fs.existsSync(aduanJsPath)).toBe(true);
        expect(fs.existsSync(rkasJsPath)).toBe(true);
    });

    test('2. Skema D1 sarpras_reports dan sarpras_rkas_items ada di worker.js', () => {
        const workerContent = fs.readFileSync(workerPath, 'utf8');
        expect(workerContent).toContain('CREATE TABLE IF NOT EXISTS sarpras_reports');
        expect(workerContent).toContain('CREATE TABLE IF NOT EXISTS sarpras_rkas_items');
        expect(workerContent).toContain('generateSarprasReportNumber(environment)');
    });

    test('3. Paritas Endpoint Aduan & Usulan Warga di worker.js', () => {
        const workerContent = fs.readFileSync(workerPath, 'utf8');
        expect(workerContent).toContain('path === "/api/sarpras/reports" && method === "GET"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/reports/") && !path.endsWith("/disposition") && method === "GET"');
        expect(workerContent).toContain('path === "/api/sarpras/reports" && method === "POST"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/reports/") && !path.endsWith("/disposition") && method === "PUT"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/reports/") && !path.endsWith("/disposition") && method === "DELETE"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/reports/") && path.endsWith("/disposition") && method === "POST"');
    });

    test('4. Paritas Endpoint Perencanaan RKAS di worker.js', () => {
        const workerContent = fs.readFileSync(workerPath, 'utf8');
        expect(workerContent).toContain('path === "/api/sarpras/rkas/summary" && method === "GET"');
        expect(workerContent).toContain('path === "/api/sarpras/rkas" && method === "GET"');
        expect(workerContent).toContain('path === "/api/sarpras/rkas" && method === "POST"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/rkas/") && !path.endsWith("/approve") && !path.endsWith("/summary") && method === "PUT"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/rkas/") && !path.endsWith("/approve") && !path.endsWith("/summary") && method === "DELETE"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/rkas/") && path.endsWith("/approve") && method === "POST"');
    });

    test('5. Paritas Metode Client di cloudflare-client.js', () => {
        const clientContent = fs.readFileSync(clientPath, 'utf8');
        expect(clientContent).toContain('async getSarprasReports(');
        expect(clientContent).toContain('async getSarprasReportById(');
        expect(clientContent).toContain('async saveSarprasReport(');
        expect(clientContent).toContain('async deleteSarprasReport(');
        expect(clientContent).toContain('async dispositionSarprasReport(');
        expect(clientContent).toContain('async getSarprasRkasSummary(');
        expect(clientContent).toContain('async getSarprasRkas(');
        expect(clientContent).toContain('async saveSarprasRkasItem(');
        expect(clientContent).toContain('async deleteSarprasRkasItem(');
        expect(clientContent).toContain('async approveSarprasRkasItem(');
    });

    test('6. Modal Anti-Nesting Mandate: Seluruh modal sarpras-aduan.html berada di luar <main>', () => {
        const html = fs.readFileSync(aduanHtmlPath, 'utf8');
        const mainCloseIndex = html.indexOf('</main>');
        expect(mainCloseIndex).toBeGreaterThan(0);

        const modalIds = ['modal-report-form', 'modal-report-detail', 'modal-report-disposition'];
        modalIds.forEach(id => {
            const modalIndex = html.indexOf(`id="${id}"`);
            expect(modalIndex).toBeGreaterThan(mainCloseIndex);
        });
    });

    test('7. Modal Anti-Nesting Mandate: Seluruh modal sarpras-rkas.html berada di luar <main>', () => {
        const html = fs.readFileSync(rkasHtmlPath, 'utf8');
        const mainCloseIndex = html.indexOf('</main>');
        expect(mainCloseIndex).toBeGreaterThan(0);

        const modalIds = ['modal-rkas-form', 'modal-rkas-approval', 'modal-print-rkas'];
        modalIds.forEach(id => {
            const modalIndex = html.indexOf(`id="${id}"`);
            expect(modalIndex).toBeGreaterThan(mainCloseIndex);
        });
    });

    test('8. Anti-Overlapping Icon Rule: Tidak ada leading icon di dalam field input pada HTML baru', () => {
        [aduanHtmlPath, rkasHtmlPath].forEach(filePath => {
            const content = fs.readFileSync(filePath, 'utf8');
            // Dilarang pola relative yang memuat input dengan pl-9 / pl-10 bersama icon absolute di dalamnya
            expect(content).not.toMatch(/<input[^>]+class="[^"]*\b(pl-9|pl-10)\b/i);
        });
    });

    test('9. Anti-Blank Screen Mandate: Wajib memuat global.js dan meng-unhide main', () => {
        [aduanHtmlPath, rkasHtmlPath].forEach(filePath => {
            const content = fs.readFileSync(filePath, 'utf8');
            expect(content).toContain('src="js/global.js"');
        });

        [aduanJsPath, rkasJsPath].forEach(filePath => {
            const content = fs.readFileSync(filePath, 'utf8');
            expect(content).toContain("classList.remove('hidden')");
        });
    });
});
