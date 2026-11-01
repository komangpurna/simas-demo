const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..');

describe('Verifikasi Pengecualian Pop-up Guru Wali untuk Super Admin, Kepala Sekolah & Staff', () => {
    const pageDashboardJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-dashboard.js'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    const prdSimas = fs.readFileSync(path.join(projectRoot, 'PRD_SIMAS.md'), 'utf8');
    const configJs = fs.readFileSync(path.join(projectRoot, 'js', 'config.js'), 'utf8');

    test('1. Analisis Statis Kode page-dashboard.js', () => {
        expect(pageDashboardJs).toContain('function isExemptFromGuruWaliReminder(role)');
        expect(pageDashboardJs).toContain("exemptRoles = ['super_admin', 'kepala_sekolah', 'staff'");
        expect(pageDashboardJs).toContain('window.isExemptFromGuruWaliReminder = isExemptFromGuruWaliReminder');
        expect(pageDashboardJs).toContain('if (isExemptFromGuruWaliReminder(role))');
        expect(pageDashboardJs).toContain('function showGuruWaliWarningPopup(role)');
    });

    test('2. Runtime Evaluasi Logika Peran di Sandbox VM', () => {
        const sandbox = {
            window: {},
            localStorage: {
                _data: {},
                getItem(key) { return this._data[key] || null; },
                setItem(key, val) { this._data[key] = String(val); },
                removeItem(key) { delete this._data[key]; }
            },
            currentUserData: null,
            document: {
                getElementById(id) {
                    if (id === 'warning-guru-wali' && sandbox._hasWarningEl) {
                        return { remove() { sandbox._hasWarningEl = false; } };
                    }
                    return null;
                }
            },
            _hasWarningEl: false
        };

        const fnMatch = pageDashboardJs.match(/function isExemptFromGuruWaliReminder\(role\)[\s\S]*?\n\}/);
        expect(fnMatch).not.toBeNull();
        vm.runInNewContext(fnMatch[0], sandbox);

        const isExempt = sandbox.isExemptFromGuruWaliReminder;

        // Skenario A: Super Admin (Primary Role & Multi-Role)
        expect(isExempt('super_admin')).toBe(true);
        sandbox.localStorage.setItem('user_role', 'super_admin');
        expect(isExempt()).toBe(true);

        sandbox.localStorage.setItem('user_role', 'guru_mapel');
        sandbox.window.hasRole = (r) => r === 'super_admin' || r === 'guru_mapel';
        expect(isExempt('guru_mapel')).toBe(true);

        sandbox.window.hasRole = () => false;
        sandbox.currentUserData = { role: 'guru_mapel', additionalRoles: ['super_admin'] };
        expect(isExempt('guru_mapel')).toBe(true);

        // Skenario B: Kepala Sekolah (Primary Role & Multi-Role)
        expect(isExempt('kepala_sekolah')).toBe(true);
        sandbox.localStorage.setItem('user_role', 'kepala_sekolah');
        expect(isExempt()).toBe(true);

        sandbox.localStorage.setItem('user_role', 'guru_mapel');
        sandbox.window.hasRole = (r) => r === 'kepala_sekolah' || r === 'guru_mapel';
        expect(isExempt('guru_mapel')).toBe(true);

        // Skenario C: Staff Tata Usaha (Primary Role & Multi-Role)
        expect(isExempt('staff')).toBe(true);
        sandbox.localStorage.setItem('user_role', 'staff');
        expect(isExempt()).toBe(true);

        sandbox.localStorage.setItem('user_role', 'guru_mapel');
        sandbox.window.hasRole = (r) => r === 'staff' || r === 'guru_mapel';
        expect(isExempt('guru_mapel')).toBe(true);

        // Skenario D: Jabatan GTK mengandung Kepala Sekolah, Staff, atau Admin
        sandbox.window.hasRole = () => false;
        sandbox.currentUserData = { role: 'guru_mapel', jabatan: 'Kepala Sekolah' };
        expect(isExempt('guru_mapel')).toBe(true);

        sandbox.currentUserData = { role: 'guru_mapel', jabatan: 'Staff Tata Usaha' };
        expect(isExempt('guru_mapel')).toBe(true);

        sandbox.currentUserData = { role: 'guru_mapel', jabatan: 'Administrator Sekolah' };
        expect(isExempt('guru_mapel')).toBe(true);

        // Skenario E: Guru Mapel Murni (Non-exempt)
        sandbox.currentUserData = { role: 'guru_mapel', jabatan: 'Guru Mata Pelajaran' };
        sandbox.window.hasRole = (r) => r === 'guru_mapel';
        sandbox.window.getAllUserRoles = () => ['guru_mapel'];
        sandbox.localStorage.setItem('user_role', 'guru_mapel');
        expect(isExempt('guru_mapel')).toBe(false);
    });

    test('3. Sinkronisasi Versi di Seluruh Berkas SSOT', () => {
        expect(packageJson.version).toMatch(/^\d{2}\.\d{2}\.\d{2}\.\d+$/);
        expect(prdSimas).toContain(`[${packageJson.version}]`);
        expect(configJs).toContain(`export const APP_VERSION = "${packageJson.version}";`);
    });
});
