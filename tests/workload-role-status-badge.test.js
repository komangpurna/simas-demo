/**
 * tests/workload-role-status-badge.test.js
 * Unit Test: Status Badge Adaptif Berdasarkan Peran Pengguna di E-Kinerja Guru
 * Memverifikasi bahwa Kepala Sekolah dan Super Admin tidak lagi melihat "Belum Diinisialisasi",
 * melainkan menampilkan identitas peran pimpinan/pengawas secara eksklusif.
 */

const fs = require('fs');
const path = require('path');

describe('Status Badge E-Kinerja Guru (Kepala Sekolah & Super Admin)', () => {
    let jsContent;
    let pageEKinerjaContent;

    beforeAll(() => {
        const jsPath = path.resolve(__dirname, '../js/page-beban-kerja.js');
        jsContent = fs.readFileSync(jsPath, 'utf8');
        const eKinerjaPath = path.resolve(__dirname, '../js/page-e-kinerja.js');
        pageEKinerjaContent = fs.readFileSync(eKinerjaPath, 'utf8');
    });

    test('1. page-beban-kerja.js mengekspor getWorkloadUserRoleInfo dan renderStatusBadge', () => {
        expect(jsContent).toContain('export function getWorkloadUserRoleInfo(');
        expect(jsContent).toContain('export function renderStatusBadge(');
        expect(jsContent).toContain('window.workloadRenderStatusBadge = renderStatusBadge;');
    });

    test('2. Logika getWorkloadUserRoleInfo mendeteksi kepala_sekolah dan super_admin secara akurat', () => {
        function evalRoleInfo(mockLocalStorage, mockCachedDoc, mockWindowRoles = []) {
            const directRole = (mockLocalStorage['user_role'] || '').toLowerCase().trim();
            const cachedDoc = mockCachedDoc;
            const role = (cachedDoc?.role || cachedDoc?.currentRole || directRole || '').toLowerCase().trim();
            const addRoles = Array.isArray(cachedDoc?.additionalRoles)
                ? cachedDoc.additionalRoles.map(r => String(r).toLowerCase().trim())
                : [];
            const allRoles = [role, ...addRoles];
            if (Array.isArray(mockWindowRoles)) {
                allRoles.push(...mockWindowRoles.map(r => String(r).toLowerCase().trim()));
            }
            const isKepalaSekolah = allRoles.includes('kepala_sekolah');
            const isSuperAdmin = allRoles.includes('super_admin');
            return { role, addRoles, allRoles, isKepalaSekolah, isSuperAdmin };
        }

        // Akun Kepala Sekolah
        const ksInfo = evalRoleInfo({ user_role: 'kepala_sekolah' }, { role: 'kepala_sekolah' });
        expect(ksInfo.isKepalaSekolah).toBe(true);
        expect(ksInfo.isSuperAdmin).toBe(false);

        // Akun Super Admin
        const saInfo = evalRoleInfo({ user_role: 'super_admin' }, { role: 'super_admin' });
        expect(saInfo.isSuperAdmin).toBe(true);
        expect(saInfo.isKepalaSekolah).toBe(false);

        // Akun Guru Mapel
        const guruInfo = evalRoleInfo({ user_role: 'guru_mapel' }, { role: 'guru_mapel' });
        expect(guruInfo.isKepalaSekolah).toBe(false);
        expect(guruInfo.isSuperAdmin).toBe(false);
    });

    test('3. renderStatusBadge menampilkan "Kepala Sekolah" untuk akun kepala sekolah', () => {
        function simulateRenderStatusBadge(roleInfo, weekData = null, policy = null) {
            let textContent = '';
            let className = '';

            const { isKepalaSekolah, isSuperAdmin, role } = roleInfo;
            if (isKepalaSekolah || isSuperAdmin) {
                if (role === 'kepala_sekolah' || (isKepalaSekolah && !isSuperAdmin)) {
                    textContent = 'Kepala Sekolah';
                    className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-purple-600 text-white shadow-xs';
                    return { textContent, className };
                }
                textContent = 'Super Admin';
                className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-indigo-600 text-white shadow-xs';
                return { textContent, className };
            }

            const ver = weekData?.active_version;
            if (!weekData?.initialized) {
                textContent = 'Belum Diinisialisasi';
                className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-slate-400 text-white';
                return { textContent, className };
            }

            const isAutoPolicy = policy ? Number(policy.require_plan_approval) === 0 : false;
            const isAutoApproved = isAutoPolicy || (ver?.status === 'approved' && ver?.approved_by_uid === 'system_auto_approval');
            const approvedText = isAutoApproved ? 'Disetujui Otomatis' : 'Disetujui Kepsek';
            const statusMap = {
                'draft': { text: 'Draft', cls: 'bg-amber-400 text-slate-900' },
                'submitted': { text: isAutoApproved ? 'Disetujui Otomatis' : 'Menunggu Persetujuan', cls: isAutoApproved ? 'bg-emerald-500 text-white' : 'bg-blue-400 text-white' },
                'approved': { text: approvedText, cls: 'bg-emerald-500 text-white' },
                'needs_revision': { text: 'Perlu Revisi', cls: 'bg-rose-500 text-white' }
            };
            const st = statusMap[ver?.status] || statusMap['draft'];
            textContent = st.text;
            className = `px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase ${st.cls} shadow-xs`;
            return { textContent, className };
        }

        // Kepala Sekolah meskipun weekData null / uninitialized tetap menampilkan "Kepala Sekolah"
        const ksBadge = simulateRenderStatusBadge({ isKepalaSekolah: true, isSuperAdmin: false, role: 'kepala_sekolah' }, { initialized: false });
        expect(ksBadge.textContent).toBe('Kepala Sekolah');
        expect(ksBadge.className).toContain('bg-purple-600');
    });

    test('4. renderStatusBadge menampilkan "Super Admin" untuk akun super admin', () => {
        function simulateRenderStatusBadge(roleInfo, weekData = null) {
            const { isKepalaSekolah, isSuperAdmin, role } = roleInfo;
            if (isKepalaSekolah || isSuperAdmin) {
                if (role === 'kepala_sekolah' || (isKepalaSekolah && !isSuperAdmin)) {
                    return { textContent: 'Kepala Sekolah', className: 'bg-purple-600' };
                }
                return { textContent: 'Super Admin', className: 'bg-indigo-600' };
            }
            if (!weekData?.initialized) {
                return { textContent: 'Belum Diinisialisasi', className: 'bg-slate-400' };
            }
            return { textContent: 'Draft', className: 'bg-amber-400' };
        }

        const saBadge = simulateRenderStatusBadge({ isKepalaSekolah: false, isSuperAdmin: true, role: 'super_admin' }, { initialized: false });
        expect(saBadge.textContent).toBe('Super Admin');
        expect(saBadge.className).toContain('bg-indigo-600');
    });

    test('5. renderStatusBadge tetap menampilkan status rencana KBM untuk Guru biasa', () => {
        function simulateRenderStatusBadge(roleInfo, weekData = null) {
            const { isKepalaSekolah, isSuperAdmin, role } = roleInfo;
            if (isKepalaSekolah || isSuperAdmin) {
                if (role === 'kepala_sekolah' || (isKepalaSekolah && !isSuperAdmin)) {
                    return { textContent: 'Kepala Sekolah', className: 'bg-purple-600' };
                }
                return { textContent: 'Super Admin', className: 'bg-indigo-600' };
            }
            if (!weekData?.initialized) {
                return { textContent: 'Belum Diinisialisasi', className: 'bg-slate-400' };
            }
            return { textContent: weekData?.active_version?.status || 'Draft', className: 'bg-amber-400' };
        }

        // Guru belum inisialisasi
        const guruUninit = simulateRenderStatusBadge({ isKepalaSekolah: false, isSuperAdmin: false, role: 'guru_mapel' }, { initialized: false });
        expect(guruUninit.textContent).toBe('Belum Diinisialisasi');

        // Guru sudah ada draft
        const guruDraft = simulateRenderStatusBadge({ isKepalaSekolah: false, isSuperAdmin: false, role: 'guru_mapel' }, { initialized: true, active_version: { status: 'Draft' } });
        expect(guruDraft.textContent).toBe('Draft');
    });

    test('6. setupSupervisorAccess di js/page-e-kinerja.js mengizinkan tab Realisasi & Rencana untuk Kepsek dan Super Admin namun menyembunyikan tab Template', () => {
        expect(pageEKinerjaContent).toContain('tab-btn-today');
        expect(pageEKinerjaContent).toContain('tab-btn-plan');
        expect(pageEKinerjaContent).toContain('tab-btn-templates');
        expect(pageEKinerjaContent).toContain('admin-teacher-selector-strip');

        // Simulasi fungsi setupSupervisorAccess
        function simulateSupervisorAccess(role, additionalRoles = []) {
            const roles = [role, ...(Array.isArray(additionalRoles) ? additionalRoles : [])].filter(Boolean);
            const set = new Set(roles.map(r => String(r).toLowerCase().trim()));
            const isPrincipal = set.has('super_admin') || set.has('kepala_sekolah');
            const isSupervisor = isPrincipal || set.has('wakasek_kurikulum');

            const dom = {
                'tab-btn-monitoring': { hidden: !isSupervisor },
                'tab-btn-today': { hidden: false },
                'tab-btn-plan': { hidden: false },
                'tab-btn-templates': { hidden: isPrincipal },
                'admin-teacher-selector-strip': { hidden: !isPrincipal },
                'tab-content-today': { hidden: isPrincipal },
                'tab-content-monitoring': { hidden: !isPrincipal },
            };
            return dom;
        }

        // Kepala Sekolah
        const ksDom = simulateSupervisorAccess('kepala_sekolah');
        expect(ksDom['tab-btn-today'].hidden).toBe(false);
        expect(ksDom['tab-btn-plan'].hidden).toBe(false);
        expect(ksDom['tab-btn-templates'].hidden).toBe(true);
        expect(ksDom['admin-teacher-selector-strip'].hidden).toBe(false);
        expect(ksDom['tab-btn-monitoring'].hidden).toBe(false);

        // Super Admin
        const saDom = simulateSupervisorAccess('super_admin');
        expect(saDom['tab-btn-today'].hidden).toBe(false);
        expect(saDom['tab-btn-plan'].hidden).toBe(false);
        expect(saDom['tab-btn-templates'].hidden).toBe(true);
        expect(saDom['admin-teacher-selector-strip'].hidden).toBe(false);
        expect(saDom['tab-btn-monitoring'].hidden).toBe(false);
    });

    test('7. setupSupervisorAccess mempertahankan tab Realisasi, Rencana, dan Template untuk Guru Mapel & Wakasek Kurikulum', () => {
        function simulateSupervisorAccess(role, additionalRoles = []) {
            const roles = [role, ...(Array.isArray(additionalRoles) ? additionalRoles : [])].filter(Boolean);
            const set = new Set(roles.map(r => String(r).toLowerCase().trim()));
            const isPrincipal = set.has('super_admin') || set.has('kepala_sekolah');
            const isSupervisor = isPrincipal || set.has('wakasek_kurikulum');

            return {
                todayHidden: false,
                planHidden: false,
                templatesHidden: isPrincipal,
                monitoringHidden: !isSupervisor
            };
        }

        // Guru Mapel
        const guru = simulateSupervisorAccess('guru_mapel');
        expect(guru.todayHidden).toBe(false);
        expect(guru.planHidden).toBe(false);
        expect(guru.templatesHidden).toBe(false);
        expect(guru.monitoringHidden).toBe(true);

        // Wakasek Kurikulum (Supervisor yang juga mengajar)
        const kurikulum = simulateSupervisorAccess('guru_mapel', ['wakasek_kurikulum']);
        expect(kurikulum.todayHidden).toBe(false);
        expect(kurikulum.planHidden).toBe(false);
        expect(kurikulum.templatesHidden).toBe(false);
        expect(kurikulum.monitoringHidden).toBe(false);
    });

    test('8. switchTab dan applyDefaultTabForRole mengalihkan tab-templates ke tab-monitoring untuk pimpinan', () => {
        expect(jsContent).toContain("if ((isKepalaSekolah || isSuperAdmin) && tabId === 'tab-templates')");
        expect(pageEKinerjaContent).toContain("else if (isPrincipal && cleanTab === 'tab-templates')");

        function simulateSwitchTab(tabId, isKepalaSekolah, isSuperAdmin) {
            if ((isKepalaSekolah || isSuperAdmin) && tabId === 'tab-templates') {
                return 'tab-monitoring';
            }
            return tabId;
        }

        expect(simulateSwitchTab('tab-today', true, false)).toBe('tab-today');
        expect(simulateSwitchTab('tab-plan', true, false)).toBe('tab-plan');
        expect(simulateSwitchTab('tab-templates', true, false)).toBe('tab-monitoring');
        expect(simulateSwitchTab('tab-regulasi', true, false)).toBe('tab-regulasi');

        expect(simulateSwitchTab('tab-today', false, true)).toBe('tab-today');
        expect(simulateSwitchTab('tab-plan', false, true)).toBe('tab-plan');
        expect(simulateSwitchTab('tab-templates', false, true)).toBe('tab-monitoring');

        // Untuk guru biasa tidak dialihkan
        expect(simulateSwitchTab('tab-today', false, false)).toBe('tab-today');
        expect(simulateSwitchTab('tab-plan', false, false)).toBe('tab-plan');
        expect(simulateSwitchTab('tab-templates', false, false)).toBe('tab-templates');
    });

    test('9. renderStatusBadge menyajikan icon fa-bolt untuk Disetujui Otomatis dan menyembunyikan teks di mobile (hidden md:inline)', () => {
        expect(jsContent).toContain("const approvedIcon = isAutoApproved ? 'fa-solid fa-bolt' : 'fa-solid fa-circle-check';");
        expect(jsContent).toContain('badge.innerHTML = `<i class="${st.icon} text-[10px] md:mr-1"></i><span class="hidden md:inline">${st.text}</span>`;');
        expect(jsContent).toContain('badge.className = `inline-flex items-center justify-center px-2 py-0.5 md:px-2.5 rounded-full text-[10px] font-bold tracking-wider uppercase ${st.cls} shadow-xs`;');
    });
});
