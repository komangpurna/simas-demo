/**
 * tests/workload-vip-whitelist.test.js
 * ====================================================================
 * Test Suite: Verifikasi Pengaturan Hak Akses VIP Guru (Whitelist Super Admin)
 * Sesuai Standar Keamanan OWASP Top 10 & ASVS Level 2
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Hak Akses VIP Guru (Whitelist Rekap Realisasi Bulanan)', () => {
    const root = path.resolve(__dirname, '..');
    const workerPath = path.join(root, 'cloudflare', 'worker.js');
    const htmlPath = path.join(root, 'e-kinerja.html');
    const monitoringJsPath = path.join(root, 'js', 'page-monitoring-beban-kerja.js');
    const bebanKerjaJsPath = path.join(root, 'js', 'page-beban-kerja.js');

    const workerContent = fs.readFileSync(workerPath, 'utf8');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const monitoringJsContent = fs.readFileSync(monitoringJsPath, 'utf8');
    const bebanKerjaJsContent = fs.readFileSync(bebanKerjaJsPath, 'utf8');

    describe('1. Backend RBAC & Data Isolation (cloudflare/worker.js)', () => {
        test('Helper isWorkloadSuperAdmin mendeteksi pengguna super_admin di role utama atau additionalRoles', () => {
            expect(workerContent).toMatch(/function\s+isWorkloadSuperAdmin\s*\(\s*user\s*\)/);
            expect(workerContent).toContain('role === "super_admin"');
            expect(workerContent).toContain('user.additionalRoles.some');
        });

        test('GET /api/workload/policy HANYA mengekspos vip_teacher_ids kepada Super Admin (Kepsek & Guru Umum diisolasi)', () => {
            expect(workerContent).toContain('const isSuperAdminUser = isWorkloadSuperAdmin(authResult.user);');
            expect(workerContent).toContain('if (isSuperAdminUser) {');
            expect(workerContent).toContain('mergedPolicy.vip_teacher_ids = vipList;');
            // Pastikan can_access_vip dihitung untuk pemanggil
            expect(workerContent).toContain('can_access_vip: Boolean(canAccessVip)');
        });

        test('PUT /api/workload/policy menolak tegas (HTTP 403) jika non-Super Admin mencoba memodifikasi vip_teacher_ids', () => {
            expect(workerContent).toContain('if (body.vip_teacher_ids !== undefined)');
            expect(workerContent).toContain('if (!isWorkloadSuperAdmin(authResult.user))');
            expect(workerContent).toContain('Forbidden: Hanya Super Admin yang berwenang');
            expect(workerContent).toContain('UPDATE_VIP_WHITELIST');
        });

        test('GET /api/workload/monthly-recap mengizinkan guru di whitelist VIP dan menolak non-VIP (403 Forbidden)', () => {
            expect(workerContent).toContain('const isVipUser = isMgr ||');
            expect(workerContent).toContain('vipList.includes(userTeacherId)');
            expect(workerContent).toContain('if (!isVipUser)');
            expect(workerContent).toContain('Akses Terbatas: Modul Rekapitulasi Realisasi merupakan fitur eksklusif SIMAS VIP');
        });

        test('GET /api/workload/monthly-recap mengisolasi data guru lain dari intipan guru VIP umum', () => {
            expect(workerContent).toContain('if (!isMgr && requestedTeacherId && requestedTeacherId !== userTeacherId)');
            expect(workerContent).toContain('Akses ditolak: Anda hanya dapat melihat rekap realisasi beban kerja Anda sendiri');
        });
    });

    describe('2. UI Modal Kebijakan & Hierarki DOM (e-kinerja.html)', () => {
        test('Tab navigasi kebijakan memiliki tab alur dan tab VIP khusus Super Admin', () => {
            expect(htmlContent).toContain('id="tab-policy-btn-flow"');
            expect(htmlContent).toContain('id="tab-policy-btn-vip"');
            expect(htmlContent).toContain('monitoringSwitchPolicyTab(\'flow\')');
            expect(htmlContent).toContain('monitoringSwitchPolicyTab(\'vip\')');
            expect(htmlContent).toContain('Super Admin');
        });

        test('Form memuat panel alur (#panel-policy-flow) dan panel VIP (#panel-policy-vip)', () => {
            expect(htmlContent).toContain('id="panel-policy-flow"');
            expect(htmlContent).toContain('id="panel-policy-vip"');
        });

        test('Panel VIP mematuhi aturan Anti-Overlapping Icon pada input pencarian guru', () => {
            expect(htmlContent).toContain('id="input-vip-teacher-search"');
            // Pastikan padding px-3.5 seimbang dan tidak ada leading icon absolut di dalam input
            expect(htmlContent).toMatch(/id="input-vip-teacher-search"[^>]*class="[^"]*px-3\.5/);
            expect(htmlContent).not.toMatch(/pl-9[^>]*id="input-vip-teacher-search"/);
            expect(htmlContent).not.toMatch(/pl-10[^>]*id="input-vip-teacher-search"/);
        });

        test('Panel VIP menyediakan tombol cepat batch Pilih Semua dan Batal Semua serta counter', () => {
            expect(htmlContent).toContain('monitoringToggleAllVip(true)');
            expect(htmlContent).toContain('monitoringToggleAllVip(false)');
            expect(htmlContent).toContain('id="label-vip-counter"');
            expect(htmlContent).toContain('id="vip-teachers-list-container"');
        });
    });

    describe('3. Kontrol Klien & Integrasi State (js/page-monitoring-beban-kerja.js & js/page-beban-kerja.js)', () => {
        test('page-monitoring-beban-kerja.js mengelola state _selectedVipTeacherIds dan _vipTeachersList', () => {
            expect(monitoringJsContent).toContain('let _selectedVipTeacherIds = new Set();');
            expect(monitoringJsContent).toContain('let _vipTeachersList = [];');
            expect(monitoringJsContent).toContain('export function monitoringSwitchPolicyTab');
            expect(monitoringJsContent).toContain('export function monitoringToggleTeacherVip');
            expect(monitoringJsContent).toContain('export function monitoringToggleAllVip');
            expect(monitoringJsContent).toContain('export function monitoringFilterVipTeachers');
        });

        test('openPolicyModal hanya menampilkan tab VIP jika pengguna adalah Super Admin', () => {
            expect(monitoringJsContent).toContain('const roleInfo = getMonitoringUserRoleInfo();');
            expect(monitoringJsContent).toContain('const isSuperAdmin = Boolean(roleInfo.isSuperAdmin);');
            expect(monitoringJsContent).toMatch(/if\s*\(isSuperAdmin\)\s*\{\s*tabVipBtn\.classList\.remove\('hidden'\);/);
        });

        test('savePolicySettings menyertakan vip_teacher_ids dalam payload hanya untuk Super Admin', () => {
            expect(monitoringJsContent).toContain('if (roleInfo.isSuperAdmin) {');
            expect(monitoringJsContent).toContain('payload.vip_teacher_ids = Array.from(_selectedVipTeacherIds);');
        });

        test('canAccessMonthlyRecap di page-beban-kerja.js meloloskan Super Admin, Kepsek, dan guru whitelist VIP', () => {
            expect(bebanKerjaJsContent).toContain('export function canAccessMonthlyRecap()');
            expect(bebanKerjaJsContent).toContain('_policy?.can_access_vip === true');
            expect(bebanKerjaJsContent).toContain('_policy.vip_teacher_ids.includes(myTeacherId)');
        });
    });
});
