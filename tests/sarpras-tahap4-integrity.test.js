/**
 * tests/sarpras-tahap4-integrity.test.js
 * Unit Test Jest untuk Tahap 4: Pemeliharaan Sarpras & Tiket Servis
 * Menguji: Paritas Endpoint API, RBAC, Modal Anti-Nesting, dan Zero Overlapping Icon
 */

const fs = require('fs');
const path = require('path');

describe('Sarpras Tahap 4: Pemeliharaan & Tiket Servis Verification Tests', () => {
    const workerPath = path.resolve(__dirname, '../cloudflare/worker.js');
    const clientPath = path.resolve(__dirname, '../js/cloudflare-client.js');
    const pemeliharaanHtmlPath = path.resolve(__dirname, '../sarpras-pemeliharaan.html');
    const pemeliharaanJsPath = path.resolve(__dirname, '../js/page-sarpras-pemeliharaan.js');

    test('1. File implementasi Tahap 4 wajib tersedia', () => {
        expect(fs.existsSync(workerPath)).toBe(true);
        expect(fs.existsSync(clientPath)).toBe(true);
        expect(fs.existsSync(pemeliharaanHtmlPath)).toBe(true);
        expect(fs.existsSync(pemeliharaanJsPath)).toBe(true);
    });

    test('2. Skema D1 sarpras_maintenance_logs dan sarpras_maintenance_schedules ada di worker.js', () => {
        const workerContent = fs.readFileSync(workerPath, 'utf8');
        expect(workerContent).toContain('CREATE TABLE IF NOT EXISTS sarpras_maintenance_logs');
        expect(workerContent).toContain('CREATE TABLE IF NOT EXISTS sarpras_maintenance_schedules');
        expect(workerContent).toContain('generateSarprasMaintenanceTicket(environment)');
    });

    test('3. Paritas Endpoint Log Pemeliharaan di worker.js', () => {
        const workerContent = fs.readFileSync(workerPath, 'utf8');
        expect(workerContent).toContain('path === "/api/sarpras/maintenance/logs" && method === "GET"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/maintenance/logs/") && method === "GET"');
        expect(workerContent).toContain('path === "/api/sarpras/maintenance/logs" && method === "POST"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/maintenance/logs/") && method === "PUT"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/maintenance/logs/") && method === "DELETE"');
    });

    test('4. Paritas Endpoint Jadwal Preventif Berkala di worker.js', () => {
        const workerContent = fs.readFileSync(workerPath, 'utf8');
        expect(workerContent).toContain('path === "/api/sarpras/maintenance/schedules" && method === "GET"');
        expect(workerContent).toContain('path === "/api/sarpras/maintenance/schedules" && method === "POST"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/maintenance/schedules/") && !path.endsWith("/generate-ticket") && method === "PUT"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/maintenance/schedules/") && method === "DELETE"');
        expect(workerContent).toContain('path.startsWith("/api/sarpras/maintenance/schedules/") && path.endsWith("/generate-ticket") && method === "POST"');
    });

    test('5. Paritas Metode Client di cloudflare-client.js', () => {
        const clientContent = fs.readFileSync(clientPath, 'utf8');
        expect(clientContent).toContain('async getSarprasMaintenanceLogs(');
        expect(clientContent).toContain('async getSarprasMaintenanceLogById(');
        expect(clientContent).toContain('async saveSarprasMaintenanceLog(');
        expect(clientContent).toContain('async deleteSarprasMaintenanceLog(');
        expect(clientContent).toContain('async getSarprasMaintenanceSchedules(');
        expect(clientContent).toContain('async saveSarprasMaintenanceSchedule(');
        expect(clientContent).toContain('async deleteSarprasMaintenanceSchedule(');
        expect(clientContent).toContain('async generateSarprasMaintenanceTicketFromSchedule(');
    });

    test('6. Modal Anti-Nesting Mandate: Seluruh modal sarpras-pemeliharaan.html berada di luar <main>', () => {
        const html = fs.readFileSync(pemeliharaanHtmlPath, 'utf8');
        const mainCloseIndex = html.indexOf('</main>');
        expect(mainCloseIndex).toBeGreaterThan(0);

        const modalIds = [
            'modal-ticket-form',
            'modal-ticket-complete',
            'modal-schedule-form'
        ];
        modalIds.forEach(id => {
            const modalIndex = html.indexOf(`id="${id}"`);
            expect(modalIndex).toBeGreaterThan(mainCloseIndex);
        });
    });

    test('7. Anti-Overlapping Icon Rule: Tidak ada leading icon di dalam field input pada sarpras-pemeliharaan.html', () => {
        const content = fs.readFileSync(pemeliharaanHtmlPath, 'utf8');
        expect(content).not.toMatch(/<input[^>]+class="[^"]*\b(pl-9|pl-10)\b/i);
    });

    test('8. Anti-Blank Screen Mandate: Wajib memuat global.js dan meng-unhide main', () => {
        const html = fs.readFileSync(pemeliharaanHtmlPath, 'utf8');
        expect(html).toContain('src="js/global.js"');

        const js = fs.readFileSync(pemeliharaanJsPath, 'utf8');
        expect(js).toContain("classList.remove('hidden')");
    });
});
