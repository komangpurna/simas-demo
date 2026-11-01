/**
 * @jest-environment jsdom
 * 
 * tests/workload-anti-double-click.test.js
 * Unit Test untuk Ketahanan Anti-Double-Click & Umpan Balik Loading Instan pada E-Kinerja Guru
 * Memastikan proteksi multi-klik pada:
 * 1. 1-Klik Realisasi (quickReportComplete) dengan mutex _pendingQuickReports & visual spinner
 * 2. Simpan Rencana (savePlanItem) dengan mutex _isSavingPlanItem & loading state
 * 3. Simpan Laporan/Draf Realisasi (saveLog) dengan mutex _isSavingLog & loading state
 * 4. Ajukan Rencana (submitPlan) & Sinkron Jurnal (syncFromJournal) & Terapkan Template
 * 5. Idempotensi Sisi Server Cloudflare Worker (D1 SQL) untuk mencegah duplikasi work_logs
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Workload Anti-Double-Click & Instant Loading Feedback Suite', () => {
    const rootDir = path.resolve(__dirname, '..');
    const pageBebanKerjaJs = fs.readFileSync(path.join(rootDir, 'js/page-beban-kerja.js'), 'utf8');
    const workerJs = fs.readFileSync(path.join(rootDir, 'cloudflare/worker.js'), 'utf8');
    const eKinerjaHtml = fs.readFileSync(path.join(rootDir, 'e-kinerja.html'), 'utf8');

    test('1. Deklarasi state pelindung mutex & anti-double-click di js/page-beban-kerja.js', () => {
        expect(pageBebanKerjaJs).toContain('const _pendingQuickReports = new Set();');
        expect(pageBebanKerjaJs).toContain('let _isSavingPlanItem = false;');
        expect(pageBebanKerjaJs).toContain('let _isSavingLog = false;');
        expect(pageBebanKerjaJs).toContain('let _isSubmittingPlan = false;');
        expect(pageBebanKerjaJs).toContain('let _isSyncingFromJournal = false;');
    });

    test('2. quickReportComplete memiliki proteksi mutex, visual loading spinner seketika, dan idempotensi client', () => {
        // Mutex guard
        expect(pageBebanKerjaJs).toContain('if (_pendingQuickReports.has(planActivityId))');
        expect(pageBebanKerjaJs).toContain('_pendingQuickReports.add(planActivityId)');
        expect(pageBebanKerjaJs).toContain('_pendingQuickReports.delete(planActivityId)');

        // Loading spinner & disabled state
        expect(pageBebanKerjaJs).toContain('data-quick-plan-id');
        expect(pageBebanKerjaJs).toContain('fa-spinner fa-spin');
        expect(pageBebanKerjaJs).toContain("showToast('Mencatat realisasi kegiatan...', 'info')");

        // Idempotensi existingLink work_log_id
        expect(pageBebanKerjaJs).toContain('const existingLink = (_weekData?.plan_links || []).find(pl => pl.plan_activity_id === planActivityId)');
        expect(pageBebanKerjaJs).toContain('existingLink?.work_log_id');
    });

    test('3. Matriks mingguan menyematkan atribut data-quick-plan-id pada tombol centang', () => {
        expect(pageBebanKerjaJs).toContain('data-quick-plan-id="${seg.activity_id}"');
        expect(pageBebanKerjaJs).toContain("window.workloadQuickReportComplete('${seg.activity_id}', ${i}, this)");
    });

    test('4. savePlanItem memproteksi double submit dengan _isSavingPlanItem dan feedback loading spinner', () => {
        expect(pageBebanKerjaJs).toContain('if (_isSavingPlanItem) return;');
        expect(pageBebanKerjaJs).toContain('_isSavingPlanItem = true;');
        expect(pageBebanKerjaJs).toContain("submitBtn.innerHTML = '<i class=\"fa-solid fa-spinner fa-spin mr-1.5\"></i> Menyimpan...';");
        expect(pageBebanKerjaJs).toContain('_isSavingPlanItem = false;');
    });

    test('5. saveLog dan saveLogDraft memproteksi submit berulang dengan _isSavingLog dan feedback spinner', () => {
        expect(pageBebanKerjaJs).toContain('if (_isSavingLog) return;');
        expect(pageBebanKerjaJs).toContain('_isSavingLog = true;');
        expect(pageBebanKerjaJs).toContain("draftBtn.innerHTML = '<i class=\"fa-solid fa-spinner fa-spin mr-1.5\"></i> Menyimpan Draf...';");
        expect(pageBebanKerjaJs).toContain("submitBtn.innerHTML = '<i class=\"fa-solid fa-spinner fa-spin mr-1.5\"></i> Menyimpan...';");
        expect(pageBebanKerjaJs).toContain('_isSavingLog = false;');
    });

    test('6. submitPlan, syncFromJournal, dan confirmApplyTemplate memiliki proteksi loading', () => {
        expect(pageBebanKerjaJs).toContain('if (_isSubmittingPlan) return;');
        expect(pageBebanKerjaJs).toContain("btn.innerHTML = `<i class=\"fa-solid fa-spinner fa-spin mr-1.5\"></i> ${isAutoApproved ? 'Memproses...' : 'Mengajukan...'}`;");
        expect(pageBebanKerjaJs).toContain('if (_isSyncingFromJournal) return;');
        expect(pageBebanKerjaJs).toContain("btnSubmit.innerHTML = '<i class=\"fa-solid fa-spinner fa-spin mr-1.5\"></i> Menerapkan...';");
        expect(eKinerjaHtml).toContain('id="btn-confirm-apply-template"');
    });

    test('7. Endpoint backend Cloudflare Worker (POST /api/workload/logs) mengamankan idempotensi & anti-duplikasi', () => {
        expect(workerJs).toContain('let targetLogId = body.id || null;');
        expect(workerJs).toContain('SELECT work_log_id FROM plan_log_links WHERE plan_activity_id = ? LIMIT 1');
        expect(workerJs).toContain('targetLogId = existingLink.work_log_id;');
        expect(workerJs).toContain('SELECT work_log_id FROM plan_log_links WHERE plan_activity_id = ? AND work_log_id != ?');
    });
});
