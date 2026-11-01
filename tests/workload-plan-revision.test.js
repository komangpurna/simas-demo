/**
 * Unit Test: Siklus Peninjauan & Permintaan Revisi Rencana Kerja E-Kinerja Guru
 * Memverifikasi implementasi in-place state transition pada review-plan (action: 'request_revision')
 * tanpa kloning data duplikat, dengan jejak audit SSOT yang akuntabel.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Siklus Peninjauan & Revisi Rencana Kerja (Workload Plan In-Place Revision Lifecycle)', () => {
    const root = path.resolve(__dirname, '..');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');
    const pageBebanKerjaJsPath = path.join(root, 'js', 'page-beban-kerja.js');

    const workerContent = fs.readFileSync(workerJsPath, 'utf8');
    const pageBebanKerjaContent = fs.readFileSync(pageBebanKerjaJsPath, 'utf8');

    test('1. Endpoint POST /api/workload/review-plan terdaftar di worker.js', () => {
        expect(workerContent).toContain('path === "/api/workload/review-plan" && method === "POST"');
    });

    test('2. review-plan mendukung action approve dan request_revision', () => {
        const reviewSection = workerContent.slice(workerContent.indexOf('path === "/api/workload/review-plan"'));
        expect(reviewSection).toContain('action === "approve"');
        expect(reviewSection).toContain('action === "request_revision"');
    });

    test('3. request_revision memperbarui status secara in-place ke needs_revision tanpa kloning duplikat segmen', () => {
        const reviewSection = workerContent.slice(workerContent.indexOf('path === "/api/workload/review-plan"'));
        expect(reviewSection).toContain("SET status = 'needs_revision'");
        expect(reviewSection).toContain('REQUEST_REVISION');
        // Memastikan tidak ada INSERT INTO weekly_plan_versions baru di dalam blok request_revision
        const revisionBlock = reviewSection.slice(reviewSection.indexOf('action === "request_revision"'), reviewSection.indexOf('return errorResponse("Action tidak valid"'));
        expect(revisionBlock).not.toContain('INSERT INTO weekly_plan_versions');
        expect(revisionBlock).not.toContain('INSERT INTO plan_time_segments');
    });

    test('4. request_revision mencatat jejak audit dan mengembalikan status needs_revision', () => {
        const reviewSection = workerContent.slice(workerContent.indexOf('path === "/api/workload/review-plan"'));
        expect(reviewSection).toContain('recordWorkloadAuditLog');
        expect(reviewSection).toContain('status: "needs_revision"');
    });

    test('5. updateSubmitButton di page-beban-kerja.js menampilkan banner edukatif needs_revision dengan catatan pimpinan', () => {
        expect(pageBebanKerjaContent).toContain("ver && ver.status === 'needs_revision'");
        expect(pageBebanKerjaContent).toContain('Rencana Kerja Perlu Direvisi');
        expect(pageBebanKerjaContent).toContain('Ajukan Ulang Rencana');
    });
});
