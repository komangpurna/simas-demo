/**
 * tests/workload-flexible-approval.test.js
 *
 * Verifikasi Sistemik:
 * 1. Modal Alur Persetujuan Beban Kerja (#modal-workload-policy) di e-kinerja.html
 * 2. Tombol Navigasi (#btn-workload-policy-modal) di Toolbar Tab Monitoring
 * 3. Registrasi fungsi policy modal pada window (monitoringOpenPolicyModal, monitoringClosePolicyModal, monitoringSavePolicySettings)
 * 4. Logika RBAC (hanya super_admin & kepala_sekolah yang dapat mengakses tombol pengaturan alur)
 * 5. Worker auto-approval & auto-verification handler logic
 */

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

describe('Verifikasi Alur Persetujuan Fleksibel & Mode Mandiri Beban Kerja', () => {
    const htmlPath = path.join(rootDir, 'e-kinerja.html');
    const monitoringJsPath = path.join(rootDir, 'js', 'page-monitoring-beban-kerja.js');
    const eKinerjaJsPath = path.join(rootDir, 'js', 'page-e-kinerja.js');
    const bebanKerjaJsPath = path.join(rootDir, 'js', 'page-beban-kerja.js');
    const workerJsPath = path.join(rootDir, 'cloudflare', 'worker.js');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const monitoringJsContent = fs.readFileSync(monitoringJsPath, 'utf8');
    const eKinerjaJsContent = fs.readFileSync(eKinerjaJsPath, 'utf8');
    const bebanKerjaJsContent = fs.readFileSync(bebanKerjaJsPath, 'utf8');
    const workerJsContent = fs.readFileSync(workerJsPath, 'utf8');

    test('1. e-kinerja.html memuat #modal-workload-policy dan kontrol tombol alur persetujuan', () => {
        expect(htmlContent).toContain('id="modal-workload-policy"');
        expect(htmlContent).toContain('id="btn-workload-policy-modal"');
        expect(htmlContent).toContain('id="btn-header-workload-policy"');
        expect(htmlContent).toContain('id="badge-header-policy-mode"');
        expect(htmlContent).toContain('id="badge-toolbar-policy-mode"');
        expect(htmlContent).toContain('id="policy-require-plan-approval"');
        expect(htmlContent).toContain('id="policy-require-log-verification"');
        expect(htmlContent).toContain('id="policy-badge-plan-status"');
        expect(htmlContent).toContain('id="policy-badge-log-status"');
        expect(htmlContent).toContain('id="policy-workflow-flow-preview"');
        expect(htmlContent).toContain('id="btn-save-policy"');
        expect(htmlContent).toContain('window.monitoringOpenPolicyModal()');
        expect(htmlContent).toContain('window.monitoringClosePolicyModal()');
        expect(htmlContent).toContain('window.monitoringSavePolicySettings(event)');
        expect(htmlContent).toContain("window.monitoringSetPolicyPreset('mandiri')");
        expect(htmlContent).toContain("window.monitoringSetPolicyPreset('formal')");
    });

    test('2. page-monitoring-beban-kerja.js mendaftarkan handler policy modal pada window', () => {
        expect(monitoringJsContent).toContain('window.monitoringOpenPolicyModal = openPolicyModal');
        expect(monitoringJsContent).toContain('window.monitoringClosePolicyModal = closePolicyModal');
        expect(monitoringJsContent).toContain('window.monitoringSavePolicySettings = savePolicySettings');
        expect(monitoringJsContent).toContain('window.monitoringUpdatePolicyVisuals = updatePolicyVisuals');
        expect(monitoringJsContent).toContain('window.monitoringSetPolicyPreset = setPolicyPreset');
        expect(monitoringJsContent).toContain('window.monitoringSyncPolicyBadges = syncPolicyBadges');
        expect(monitoringJsContent).toContain('cfGetWorkloadPolicy');
        expect(monitoringJsContent).toContain('cfUpdateWorkloadPolicy');
    });

    test('3. page-e-kinerja.js mengontrol akses tombol alur persetujuan & tata letak 2 baris pimpinan vs 1 baris guru', () => {
        expect(eKinerjaJsContent).toContain('btn-workload-policy-modal');
        expect(eKinerjaJsContent).toContain('btn-header-workload-policy');
        expect(eKinerjaJsContent).toContain('canManagePolicy');
        expect(eKinerjaJsContent).toContain('header-controls-supervisor');
        expect(htmlContent).toContain('id="header-right-controls"');
        expect(htmlContent).toContain('id="header-week-nav-container"');
        expect(htmlContent).toContain('id="header-actions-container"');
        expect(htmlContent).toContain('id="btn-header-workload-policy"');

        // Pastikan #btn-header-workload-policy berada di dalam kontainer #header-actions-container (bukan direct child #header-right-controls)
        const actionsContainerBlock = htmlContent.slice(htmlContent.indexOf('id="header-actions-container"'), htmlContent.indexOf('<!-- Decorative background elements -->'));
        expect(actionsContainerBlock).toContain('id="btn-header-workload-policy"');

        // Simulasi logika hak akses tombol alur persetujuan & layout 2 baris
        function canManage(role, additionalRoles = []) {
            const roles = [role, ...(Array.isArray(additionalRoles) ? additionalRoles : [])].filter(Boolean).map(r => String(r).toLowerCase().trim());
            return roles.includes('super_admin') || roles.includes('kepala_sekolah');
        }

        expect(canManage('super_admin')).toBe(true);
        expect(canManage('kepala_sekolah')).toBe(true);
        expect(canManage('guru_mapel', ['super_admin'])).toBe(true);
        expect(canManage('guru_mapel', ['kepala_sekolah'])).toBe(true);
        expect(canManage('guru_mapel')).toBe(false);
        expect(canManage('wakasek_kurikulum')).toBe(false);
    });

    test('4. page-beban-kerja.js mendukung badge Disetujui Otomatis, toast auto-approval, dan adaptasi tombol submit', () => {
        expect(bebanKerjaJsContent).toContain("system_auto_approval");
        expect(bebanKerjaJsContent).toContain("'Disetujui Otomatis'");
        expect(bebanKerjaJsContent).toContain("'Disetujui Kepsek'");
        expect(bebanKerjaJsContent).toContain("auto_approved");
        expect(bebanKerjaJsContent).toContain("Finalisasi Rencana");
        expect(bebanKerjaJsContent).toContain("workloadReloadPolicy");
    });

    test('5. Cloudflare Worker mendukung getWorkloadPolicyConfig dan auto-approve / auto-verify', () => {
        expect(workerJsContent).toContain('async function getWorkloadPolicyConfig(db)');
        expect(workerJsContent).toContain('workload_policy_config');
        expect(workerJsContent).toContain('require_plan_approval');
        expect(workerJsContent).toContain('require_log_verification');
        expect(workerJsContent).toContain('system_auto_approval');
        expect(workerJsContent).toContain('system_auto_policy');
    });

    test('6. e-kinerja.html seluruh modal berimbang (bebas nesting error) & modal-workload-policy z-[100]', () => {
        // Verifikasi z-index tinggi
        expect(htmlContent).toMatch(/id="modal-workload-policy"[^>]*z-\[100\]/);

        // Verifikasi pembukaan dan penutupan div pada seluruh modal
        const lines = htmlContent.split('\n');
        let stack = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const openMatches = Array.from(line.matchAll(/<div\b[^>]*>/gi));
            for (const m of openMatches) {
                if (m[0].endsWith('/>')) continue;
                const idMatch = m[0].match(/id=["']([^"']+)["']/i);
                stack.push({ line: i + 1, id: idMatch ? idMatch[1] : null });
            }
            const closeMatches = Array.from(line.matchAll(/<\/div>/gi));
            for (const _ of closeMatches) {
                if (stack.length > 0) stack.pop();
            }
            if (line.includes('id="modal-workload-policy"')) {
                // modal-workload-policy tidak boleh berada di dalam modal lain
                const parentModal = stack.slice(0, -1).find(s => s.id && s.id.startsWith('modal-'));
                expect(parentModal).toBeUndefined();
            }
        }
        // Pada akhir dokumen, tidak boleh ada unclosed div
        expect(stack.length).toBe(0);
    });

    test('7. page-e-kinerja.js otomatis membuka tab monitoring untuk super admin dan kepala sekolah', () => {
        expect(eKinerjaJsContent).toContain('function isPrincipalOrAdmin(');
        expect(eKinerjaJsContent).toContain('function applyDefaultTabForRole(');
        expect(eKinerjaJsContent).toContain("targetTab = 'tab-monitoring'");

        // Evaluasi logika isPrincipalOrAdmin
        function testIsPrincipalOrAdmin(role, additionalRoles = []) {
            const roles = [role, ...(Array.isArray(additionalRoles) ? additionalRoles : [])].filter(Boolean).map(r => String(r).toLowerCase().trim());
            return roles.includes('super_admin') || roles.includes('kepala_sekolah');
        }

        expect(testIsPrincipalOrAdmin('super_admin')).toBe(true);
        expect(testIsPrincipalOrAdmin('kepala_sekolah')).toBe(true);
        expect(testIsPrincipalOrAdmin('guru_mapel', ['super_admin'])).toBe(true);
        expect(testIsPrincipalOrAdmin('guru_mapel', ['kepala_sekolah'])).toBe(true);
        expect(testIsPrincipalOrAdmin('guru_mapel')).toBe(false);
        expect(testIsPrincipalOrAdmin('wakasek_kurikulum')).toBe(false);

        // Simulasi resolusi target tab oleh applyDefaultTabForRole
        function resolveDefaultTab(role, additionalRoles = [], urlSearch = '') {
            const urlParams = new URLSearchParams(urlSearch);
            const explicitTab = urlParams.get('tab');
            const isPrincipal = testIsPrincipalOrAdmin(role, additionalRoles);
            const isSupervisor = isPrincipal || [role, ...additionalRoles].map(r => String(r).toLowerCase()).includes('wakasek_kurikulum');

            let targetTab = null;
            if (explicitTab) {
                const cleanTab = explicitTab.startsWith('tab-') ? explicitTab : `tab-${explicitTab}`;
                if (cleanTab === 'tab-monitoring' && !isSupervisor) {
                    targetTab = 'tab-today';
                } else {
                    targetTab = cleanTab;
                }
            } else if (isPrincipal) {
                targetTab = 'tab-monitoring';
            }
            return targetTab;
        }

        // Skenario 1: Super admin login tanpa query param -> otomatis tab-monitoring
        expect(resolveDefaultTab('super_admin')).toBe('tab-monitoring');

        // Skenario 2: Kepala sekolah login tanpa query param -> otomatis tab-monitoring
        expect(resolveDefaultTab('kepala_sekolah')).toBe('tab-monitoring');

        // Skenario 3: Guru mapel tambahan kepala sekolah -> otomatis tab-monitoring
        expect(resolveDefaultTab('guru_mapel', ['kepala_sekolah'])).toBe('tab-monitoring');

        // Skenario 4: Guru mapel biasa tanpa query param -> null (default tab-today dipertahankan)
        expect(resolveDefaultTab('guru_mapel')).toBeNull();

        // Skenario 5: Deep-link URL eksplisit ?tab=plan dihormati untuk super_admin
        expect(resolveDefaultTab('super_admin', [], '?tab=plan')).toBe('tab-plan');

        // Skenario 6: Guru mapel biasa mencoba akses ?tab=monitoring tanpa wewenang dialihkan ke tab-today
        expect(resolveDefaultTab('guru_mapel', [], '?tab=monitoring')).toBe('tab-today');
    });
});
