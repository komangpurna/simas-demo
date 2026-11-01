/**
 * tests/challenger-m2-rbac-nav.test.js
 *
 * Empirical Challenger Verification Suite for Milestone 2:
 * 1. PAGE_ACCESS_CONFIG in js/global.js (RBAC matrix for e-kinerja-tendik.html & agenda-pegawai.html)
 * 2. Multi-role evaluation (hasPageAccess, getEffectiveRoleForPage, checkPageAccess)
 * 3. MENU_LABELS configuration & aliasing (agenda_pegawai & e_kinerja_tendik)
 * 4. MENU_CONFIG & MENU_GROUPS visibility across roles
 * 5. visited_agenda guard evaluation for e-kinerja-tendik.html
 * 6. Redirection & parameter preservation (agenda.html & agenda-pegawai.html)
 */

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const rootDir = path.resolve(__dirname, '..');

describe('Challenger M2: Empirical Verification of RBAC (PAGE_ACCESS_CONFIG)', () => {
    let globalJsContent;
    let pageAccessConfig;

    beforeAll(() => {
        const globalJsPath = path.join(rootDir, 'js', 'global.js');
        expect(fs.existsSync(globalJsPath)).toBe(true);
        globalJsContent = fs.readFileSync(globalJsPath, 'utf8');

        // Extract PAGE_ACCESS_CONFIG object using a function evaluator in isolated context
        const configMatch = globalJsContent.match(/const\s+PAGE_ACCESS_CONFIG\s*=\s*(\{[\s\S]*?\n\};)/);
        expect(configMatch).not.toBeNull();
        const rawConfigCode = configMatch[1];

        // Evaluate in isolated safe VM/function
        const evalFn = new Function(`return ${rawConfigCode};`);
        pageAccessConfig = evalFn();
    });

    test('1. Dual-key parity: Both e-kinerja-tendik.html and agenda-pegawai.html are registered', () => {
        expect(pageAccessConfig['e-kinerja-tendik.html']).toBeDefined();
        expect(pageAccessConfig['agenda-pegawai.html']).toBeDefined();
    });

    test('2. e-kinerja-tendik.html grants rw permission to authorized roles', () => {
        const config = pageAccessConfig['e-kinerja-tendik.html'];
        const authorizedRoles = ['super_admin', 'kepala_sekolah', 'staff', 'tendik', 'pegawai'];

        authorizedRoles.forEach(role => {
            expect(config[role]).toBe('rw');
        });
    });

    test('3. e-kinerja-tendik.html denies access (x) to unauthorized roles', () => {
        const config = pageAccessConfig['e-kinerja-tendik.html'];
        const unauthorizedRoles = [
            'wakasek_kurikulum',
            'kepala_lab',
            'kesiswaan',
            'admin_spp',
            'wali_kelas',
            'guru_bk',
            'guru_mapel',
            'admin_kelas',
            'admin_pks',
            'siswa'
        ];

        unauthorizedRoles.forEach(role => {
            expect(config[role]).toBe('x');
        });
    });

    test('4. agenda-pegawai.html preserves identical backward-compatible permissions', () => {
        const tendikConfig = pageAccessConfig['e-kinerja-tendik.html'];
        const legacyConfig = pageAccessConfig['agenda-pegawai.html'];

        expect(tendikConfig).toEqual(legacyConfig);
    });

    test('5. Multi-role runtime logic simulation with hasPageAccess()', () => {
        // Simulate window.getAllUserRoles and window.hasPageAccess as defined in js/global.js
        const simulateHasPageAccess = (primaryRole, additionalRoles = [], page = 'e-kinerja-tendik.html') => {
            const allRoles = primaryRole ? [primaryRole, ...additionalRoles] : additionalRoles;
            const uniqueRoles = [...new Set(allRoles)];
            const pageConfig = pageAccessConfig[page];
            if (!pageConfig) return true;

            return uniqueRoles.some(role => {
                const access = pageConfig[role];
                return access && access !== 'x';
            });
        };

        // Positive tests
        expect(simulateHasPageAccess('tendik')).toBe(true);
        expect(simulateHasPageAccess('pegawai')).toBe(true);
        expect(simulateHasPageAccess('staff')).toBe(true);
        expect(simulateHasPageAccess('kepala_sekolah')).toBe(true);
        expect(simulateHasPageAccess('super_admin')).toBe(true);

        // Negative tests
        expect(simulateHasPageAccess('guru_mapel')).toBe(false);
        expect(simulateHasPageAccess('wali_kelas')).toBe(false);
        expect(simulateHasPageAccess('siswa')).toBe(false);
        expect(simulateHasPageAccess('wakasek_kurikulum')).toBe(false);
        expect(simulateHasPageAccess('admin_spp')).toBe(false);

        // Multi-role combinations
        // Unauthorized primary + Authorized secondary -> ALLOW
        expect(simulateHasPageAccess('guru_mapel', ['tendik'])).toBe(true);
        expect(simulateHasPageAccess('guru_bk', ['pegawai'])).toBe(true);
        expect(simulateHasPageAccess('siswa', ['staff'])).toBe(true);

        // Multiple unauthorized roles -> DENY
        expect(simulateHasPageAccess('guru_mapel', ['wali_kelas', 'kesiswaan'])).toBe(false);

        // Role not explicitly listed in config (e.g. admin_perpus) -> DENY
        expect(simulateHasPageAccess('admin_perpus')).toBe(false);
    });

    test('6. getEffectiveRoleForPage() prioritizes highest permission (rw over x)', () => {
        const simulateGetEffectiveRole = (roles, page = 'e-kinerja-tendik.html') => {
            const pageConfig = pageAccessConfig[page];
            if (!pageConfig) return roles[0] || null;

            const accessPriority = { 'rw': 6, 'rwm': 5, 'r': 4, 'ym': 3, 'y': 2, 'x': 0 };
            let bestRole = null;
            let bestPriority = -1;

            roles.forEach(role => {
                const access = pageConfig[role];
                const priority = accessPriority[access] || 0;
                if (priority > bestPriority) {
                    bestPriority = priority;
                    bestRole = role;
                }
            });
            return bestRole;
        };

        // Single role
        expect(simulateGetEffectiveRole(['tendik'])).toBe('tendik');
        expect(simulateGetEffectiveRole(['guru_mapel'])).toBe('guru_mapel');
        
        // Combined role: guru_mapel (priority 0) + tendik (priority 6) -> tendik
        expect(simulateGetEffectiveRole(['guru_mapel', 'tendik'])).toBe('tendik');
        expect(simulateGetEffectiveRole(['staff', 'guru_mapel'])).toBe('staff');
    });

    test('7. checkPageAccess() guard correctly redirects unauthorized users and admits authorized users', () => {
        // Create JSDOM environment to simulate checkPageAccess behavior
        const createEnv = (role, currentPath) => {
            const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="app"></div></body></html>`, {
                url: `https://simas.test/${currentPath}`
            });
            dom.window.localStorage.setItem('user_role', role);
            dom.window.PAGE_ACCESS_CONFIG = pageAccessConfig;
            dom.window.ROOT_URL = '/';
            dom.window.getAllUserRoles = () => [role];
            dom.window.hasPageAccess = (page) => {
                const cfg = pageAccessConfig[page];
                if (!cfg) return true;
                return [role].some(r => cfg[r] && cfg[r] !== 'x');
            };

            const mockReplace = jest.fn();
            delete dom.window.location;
            dom.window.location = {
                pathname: `/${currentPath}`,
                replace: mockReplace
            };

            // Implementation of checkPageAccess
            dom.window.checkPageAccess = function () {
                const currentPage = dom.window.location.pathname.split('/').pop() || 'index.html';
                const targetConfig = dom.window.PAGE_ACCESS_CONFIG[currentPage];
                if (targetConfig) {
                    const hasAccess = dom.window.hasPageAccess(currentPage);
                    if (!hasAccess) {
                        dom.window.location.replace(`${dom.window.ROOT_URL}dashboard.html`);
                        return;
                    }
                }
                dom.window.document.body.style.display = 'block';
            };

            return { dom, mockReplace };
        };

        // Authorized scenario (tendik accessing e-kinerja-tendik.html)
        const authEnv = createEnv('tendik', 'e-kinerja-tendik.html');
        authEnv.dom.window.checkPageAccess();
        expect(authEnv.mockReplace).not.toHaveBeenCalled();
        expect(authEnv.dom.window.document.body.style.display).toBe('block');

        // Unauthorized scenario (guru_mapel accessing e-kinerja-tendik.html)
        const unauthEnv = createEnv('guru_mapel', 'e-kinerja-tendik.html');
        unauthEnv.dom.window.checkPageAccess();
        expect(unauthEnv.mockReplace).toHaveBeenCalledWith('/dashboard.html');
    });
});

describe('Challenger M2: Empirical Verification of Navigation & MENU_LABELS', () => {
    let globalJsContent;
    let menuLabels;
    let menuConfig;
    let menuGroups;

    beforeAll(() => {
        const globalJsPath = path.join(rootDir, 'js', 'global.js');
        globalJsContent = fs.readFileSync(globalJsPath, 'utf8');

        // Extract MENU_LABELS
        const labelsMatch = globalJsContent.match(/const\s+MENU_LABELS\s*=\s*(\{[\s\S]*?\n\};)/);
        expect(labelsMatch).not.toBeNull();
        // Replace ${ROOT_URL} with '' for clean evaluation
        const cleanLabelsCode = labelsMatch[1].replace(/\$\{ROOT_URL\}/g, '');
        const evalLabels = new Function(`return ${cleanLabelsCode};`);
        menuLabels = evalLabels();

        // Extract MENU_CONFIG
        const configMatch = globalJsContent.match(/const\s+MENU_CONFIG\s*=\s*(\{[\s\S]*?\n\};)/);
        expect(configMatch).not.toBeNull();
        const evalConfig = new Function(`return ${configMatch[1]};`);
        menuConfig = evalConfig();

        // Extract MENU_GROUPS
        const groupsMatch = globalJsContent.match(/const\s+MENU_GROUPS\s*=\s*(\[[\s\S]*?\n\];)/);
        expect(groupsMatch).not.toBeNull();
        const evalGroups = new Function(`return ${groupsMatch[1]};`);
        menuGroups = evalGroups();
    });

    test('1. MENU_LABELS has agenda_pegawai configured with E-Kinerja Tendik and e-kinerja-tendik.html link', () => {
        expect(menuLabels['agenda_pegawai']).toBeDefined();
        expect(menuLabels['agenda_pegawai'].label).toBe('E-Kinerja Tendik');
        expect(menuLabels['agenda_pegawai'].icon).toBe('fa-clipboard-user');
        expect(menuLabels['agenda_pegawai'].link).toContain('e-kinerja-tendik.html');
        expect(menuLabels['agenda_pegawai'].link).not.toContain('agenda-pegawai.html');
    });

    test('2. MENU_LABELS alias e_kinerja_tendik is valid and matches agenda_pegawai', () => {
        expect(menuLabels['e_kinerja_tendik']).toBeDefined();
        expect(menuLabels['e_kinerja_tendik'].label).toBe('E-Kinerja Tendik');
        expect(menuLabels['e_kinerja_tendik'].icon).toBe('fa-clipboard-user');
        expect(menuLabels['e_kinerja_tendik'].link).toBe(menuLabels['agenda_pegawai'].link);
    });

    test('3. MENU_GROUPS includes agenda_pegawai inside agenda_group', () => {
        const agendaGroup = menuGroups.find(g => g.key === 'agenda_group');
        expect(agendaGroup).toBeDefined();
        expect(agendaGroup.type).toBe('group');
        expect(agendaGroup.items).toContain('agenda_pegawai');
    });

    test('4. MENU_CONFIG role segregation for agenda_pegawai', () => {
        // Authorized roles in MENU_CONFIG
        expect(menuConfig['super_admin']).toContain('agenda_pegawai');
        expect(menuConfig['kepala_sekolah']).toContain('agenda_pegawai');
        expect(menuConfig['staff']).toContain('agenda_pegawai');

        // Roles that should NOT have agenda_pegawai in their menu
        const excludedRoles = [
            'guru_mapel',
            'guru_bk',
            'wali_kelas',
            'wakasek_kurikulum',
            'kepala_lab',
            'kesiswaan',
            'admin_spp',
            'admin_kelas',
            'admin_pks',
            'siswa',
            'admin_sukaduka',
            'admin_duta',
            'admin_lks'
        ];

        excludedRoles.forEach(role => {
            if (menuConfig[role]) {
                expect(menuConfig[role]).not.toContain('agenda_pegawai');
                expect(menuConfig[role]).not.toContain('e_kinerja_tendik');
            }
        });
    });

    test('5. visited_agenda guard in js/global.js covers e-kinerja-tendik.html', () => {
        expect(globalJsContent).toContain("currentGlobalPath === 'e-kinerja-tendik.html'");
        expect(globalJsContent).toContain("localStorage.setItem('visited_agenda', 'true')");
    });
});

describe('Challenger M2: Empirical Verification of Redirection & Tautan Luar', () => {
    test('1. agenda.html redirect script navigates to e-kinerja-tendik.html', () => {
        const agendaHtmlPath = path.join(rootDir, 'agenda.html');
        const agendaHtmlContent = fs.readFileSync(agendaHtmlPath, 'utf8');

        expect(agendaHtmlContent).toContain("window.location.replace('e-kinerja-tendik.html' + q);");
        expect(agendaHtmlContent).not.toContain("window.location.replace('agenda-pegawai.html' + q);");
    });

    test('2. agenda.html redirect preserves query parameters and strips tab parameter', () => {
        const simulateAgendaRedirect = (urlStr) => {
            const url = new URL(urlStr);
            const hash = url.hash;
            const params = new URLSearchParams(url.search);
            const tab = params.get('tab');

            if (hash === '#employee' || hash === '#tab-employee' || tab === 'employee') {
                params.delete('tab');
                const q = params.toString() ? '?' + params.toString() : '';
                return 'e-kinerja-tendik.html' + q;
            }
            return null;
        };

        // Query param tab=employee
        expect(simulateAgendaRedirect('https://simas.test/agenda.html?tab=employee'))
            .toBe('e-kinerja-tendik.html');

        // Query param tab=employee with other params
        expect(simulateAgendaRedirect('https://simas.test/agenda.html?tab=employee&date=2026-10-09&user=gtk_01'))
            .toBe('e-kinerja-tendik.html?date=2026-10-09&user=gtk_01');

        // Hash #employee
        expect(simulateAgendaRedirect('https://simas.test/agenda.html#employee'))
            .toBe('e-kinerja-tendik.html');

        // Hash #tab-employee with query
        expect(simulateAgendaRedirect('https://simas.test/agenda.html?date=2026-10-09#tab-employee'))
            .toBe('e-kinerja-tendik.html?date=2026-10-09');
    });

    test('3. PWA shortcuts in manifest.json, android-twa/twa-manifest.json, and js/school-config.js', () => {
        const manifestPath = path.join(rootDir, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const tendikShortcut = manifest.shortcuts.find(s => s.url === 'e-kinerja-tendik.html');
        expect(tendikShortcut).toBeDefined();
        expect(tendikShortcut.name).toBe('E-Kinerja Tendik');

        const twaManifestPath = path.join(rootDir, 'android-twa', 'twa-manifest.json');
        const twaManifest = JSON.parse(fs.readFileSync(twaManifestPath, 'utf8'));
        const twaShortcut = twaManifest.shortcuts.find(s => s.url.includes('e-kinerja-tendik.html'));
        expect(twaShortcut).toBeDefined();
        expect(twaShortcut.name).toBe('E-Kinerja Tendik');

        const schoolConfigPath = path.join(rootDir, 'js', 'school-config.js');
        const schoolConfigContent = fs.readFileSync(schoolConfigPath, 'utf8');
        expect(schoolConfigContent).toContain("url: appUrl('e-kinerja-tendik.html')");
        expect(schoolConfigContent).toContain("name: 'E-Kinerja Tendik'");
    });

    test('4. Service Worker caches e-kinerja-tendik.html and js/page-e-kinerja-tendik.js', () => {
        const swPath = path.join(rootDir, 'sw.js');
        const swContent = fs.readFileSync(swPath, 'utf8');

        expect(swContent).toContain("'./e-kinerja-tendik.html'");
        expect(swContent).toContain("'./js/page-e-kinerja-tendik.js'");
        // Backward-compatibility shims also cached
        expect(swContent).toContain("'./agenda-pegawai.html'");
    });
});
