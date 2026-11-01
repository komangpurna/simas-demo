/**
 * js/page-e-kinerja.js
 * Controller untuk Halaman Terpadu E-Kinerja Guru (e-kinerja.html)
 * Mengelola penyusunan rencana kerja mingguan guru, template rutin, pelaporan realisasi harian,
 * serta dashboard monitoring & supervisi beban kerja seluruh guru untuk pimpinan sekolah.
 * Sesuai Permendikdasmen No. 11/2025 & Kepmendikdasmen No. 221/P/2025
 * SSOT: Cloudflare D1 Serverless SQL
 */

import './page-beban-kerja.js';
import './page-monitoring-beban-kerja.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { auth, db, PATHS } from './config.js';
import { initLayout } from './global.js';
import { cfGetWorkloadPolicy } from './cloudflare-client.js';

let _hasAutoSelectedTab = false;

function isSupervisorRole(role, additionalRoles = []) {
    const roles = [role, ...(Array.isArray(additionalRoles) ? additionalRoles : [])].filter(Boolean);
    if (typeof window.getAllUserRoles === 'function') {
        try {
            roles.push(...window.getAllUserRoles());
        } catch (_) {}
    }
    const set = new Set(roles.map(r => String(r).toLowerCase().trim()));
    return set.has('super_admin') || set.has('kepala_sekolah') || set.has('wakasek_kurikulum') ||
        (typeof window.hasRole === 'function' && (window.hasRole('super_admin') || window.hasRole('kepala_sekolah') || window.hasRole('wakasek_kurikulum')));
}

function isPrincipalOrAdmin(role, additionalRoles = []) {
    const roles = [role, ...(Array.isArray(additionalRoles) ? additionalRoles : [])].filter(Boolean);
    if (typeof window.getAllUserRoles === 'function') {
        try {
            roles.push(...window.getAllUserRoles());
        } catch (_) {}
    }
    const set = new Set(roles.map(r => String(r).toLowerCase().trim()));
    return set.has('super_admin') || set.has('kepala_sekolah') ||
        (typeof window.hasRole === 'function' && (window.hasRole('super_admin') || window.hasRole('kepala_sekolah')));
}

function applyDefaultTabForRole(role, additionalRoles = []) {
    if (_hasAutoSelectedTab) return;

    const urlParams = new URLSearchParams(window.location.search);
    const explicitTab = urlParams.get('tab');
    const isPrincipal = isPrincipalOrAdmin(role, additionalRoles);

    let targetTab = null;
    if (explicitTab) {
        const cleanTab = explicitTab.startsWith('tab-') ? explicitTab : `tab-${explicitTab}`;
        if (cleanTab === 'tab-monitoring' && !isSupervisorRole(role, additionalRoles)) {
            targetTab = 'tab-today';
        } else if (isPrincipal && cleanTab === 'tab-templates') {
            // Jika Kepsek atau Super Admin mengakses tautan tab template, arahkan ke tab monitoring
            targetTab = 'tab-monitoring';
        } else {
            targetTab = cleanTab;
        }
    } else if (isPrincipal) {
        // Jika yang login super admin atau kepala sekolah, otomatis tab terbuka tab monitoring
        targetTab = 'tab-monitoring';
    }

    if (targetTab) {
        const trySwitch = () => {
            if (typeof window.workloadSwitchTab === 'function') {
                window.workloadSwitchTab(targetTab);
                _hasAutoSelectedTab = true;
                return true;
            }
            return false;
        };

        if (!trySwitch()) {
            let attempts = 0;
            const interval = setInterval(() => {
                attempts++;
                if (trySwitch() || attempts >= 20) {
                    clearInterval(interval);
                }
            }, 50);
        }
    }
}

function setupSupervisorAccess(role, additionalRoles = []) {
    const isSupervisor = isSupervisorRole(role, additionalRoles);
    const isPrincipal = isPrincipalOrAdmin(role, additionalRoles);
    const tabMonitoringBtn = document.getElementById('tab-btn-monitoring');

    if (tabMonitoringBtn) {
        if (isSupervisor) {
            tabMonitoringBtn.classList.remove('hidden');
        } else {
            tabMonitoringBtn.classList.add('hidden');
        }
    }

    // Untuk Kepala Sekolah dan Super Admin: buka akses tab Realisasi dan Rencana dengan bilah Pemilih Guru
    // Tab Template tetap disembunyikan bagi pimpinan
    const tabTodayBtn = document.getElementById('tab-btn-today');
    const tabPlanBtn = document.getElementById('tab-btn-plan');
    const tabTemplatesBtn = document.getElementById('tab-btn-templates');
    const adminSelectorStrip = document.getElementById('admin-teacher-selector-strip');

    if (tabTodayBtn) {
        tabTodayBtn.classList.remove('hidden');
    }
    if (tabPlanBtn) {
        tabPlanBtn.classList.remove('hidden');
    }
    if (tabTemplatesBtn) {
        if (isPrincipal) {
            tabTemplatesBtn.classList.add('hidden');
        } else {
            tabTemplatesBtn.classList.remove('hidden');
        }
    }
    if (adminSelectorStrip) {
        if (isPrincipal) {
            adminSelectorStrip.classList.remove('hidden');
        } else {
            adminSelectorStrip.classList.add('hidden');
        }
    }

    if (isPrincipal) {
        // Tampilkan panel monitoring & sembunyikan toolbar realisasi secara instan (0ms) untuk pimpinan
        const panelToday = document.getElementById('tab-content-today');
        const panelMonitoring = document.getElementById('tab-content-monitoring');
        if (panelToday && panelMonitoring) {
            panelToday.classList.add('hidden');
            panelMonitoring.classList.remove('hidden');
        }
        const realisasiToolbar = document.getElementById('tab-realisasi-toolbar');
        if (realisasiToolbar) {
            realisasiToolbar.classList.add('hidden', '!hidden');
            realisasiToolbar.classList.remove('md:flex');
            realisasiToolbar.style.display = 'none';
        }
        if (typeof window.workloadUpdateMonitoringToolbarVisibility === 'function') {
            window.workloadUpdateMonitoringToolbarVisibility();
        } else {
            const monitoringToolbar = document.getElementById('tab-monitoring-toolbar');
            if (monitoringToolbar) {
                monitoringToolbar.classList.add('hidden', '!hidden');
                monitoringToolbar.classList.remove('flex');
                monitoringToolbar.style.display = 'none';
            }
        }
        if (typeof window.workloadUpdateRekapToolbarVisibility === 'function') {
            window.workloadUpdateRekapToolbarVisibility();
        } else {
            const rekapToolbar = document.getElementById('tab-rekap-toolbar');
            if (rekapToolbar) {
                rekapToolbar.classList.add('hidden', '!hidden');
                rekapToolbar.classList.remove('flex');
                rekapToolbar.style.display = 'none';
            }
        }
        const kpiStrip = document.getElementById('kpi-summary-strip');
        if (kpiStrip) kpiStrip.classList.add('hidden');
    }

    const roles = [role, ...(Array.isArray(additionalRoles) ? additionalRoles : [])].filter(Boolean).map(r => String(r).toLowerCase().trim());
    const canManagePolicy = roles.includes('super_admin') || roles.includes('kepala_sekolah') ||
        (typeof window.hasRole === 'function' && (window.hasRole('super_admin') || window.hasRole('kepala_sekolah')));
    const btnPolicy = document.getElementById('btn-workload-policy-modal');
    if (btnPolicy) {
        // Selalu sembunyikan tombol di toolbar agar tidak duplikat dengan tombol Persetujuan di header utama
        btnPolicy.classList.add('hidden');
    }

    const btnHeaderPolicy = document.getElementById('btn-header-workload-policy');
    if (btnHeaderPolicy) {
        if (canManagePolicy) {
            btnHeaderPolicy.classList.remove('hidden');
        } else {
            btnHeaderPolicy.classList.add('hidden');
        }
    }

    const headerControls = document.getElementById('header-right-controls');
    if (headerControls) {
        if (canManagePolicy) {
            headerControls.classList.add('header-controls-supervisor');
        } else {
            headerControls.classList.remove('header-controls-supervisor');
        }
    }

    if (canManagePolicy) {
        cfGetWorkloadPolicy().then(res => {
            const policy = res?.data?.policy || res?.data || {};
            if (typeof window.monitoringSyncPolicyBadges === 'function') {
                window.monitoringSyncPolicyBadges(policy);
            }
        }).catch(() => {});
    }

    applyDefaultTabForRole(role, additionalRoles);
}

// Ekspos helper ke window untuk pengujian unit & integrasi
window.isSupervisorRole = isSupervisorRole;
window.isPrincipalOrAdmin = isPrincipalOrAdmin;
window.applyDefaultTabForRole = applyDefaultTabForRole;
window.setupSupervisorAccess = setupSupervisorAccess;

// Jembatan pelindung anti-galat (0 Uncaught TypeError) untuk tombol kelola kinerja guru supervisor
if (typeof window !== 'undefined' && typeof window.workloadAdminManageTeacher !== 'function') {
    window.workloadAdminManageTeacher = function(teacherId) {
        if (typeof window.monitoringManageTeacher === 'function' && window.monitoringManageTeacher !== window.workloadAdminManageTeacher) {
            return window.monitoringManageTeacher(teacherId);
        }
        const select = document.getElementById('select-workload-teacher');
        if (select && teacherId) select.value = teacherId;
        if (typeof window.workloadOnAdminTeacherChange === 'function') {
            window.workloadOnAdminTeacherChange(teacherId).catch(() => {});
        }
        if (typeof window.workloadSwitchTab === 'function') {
            window.workloadSwitchTab('tab-today');
        } else {
            document.getElementById('tab-btn-today')?.click();
        }
    };
}

// Inisialisasi cepat dari cache lokal (0ms) untuk mencegah tampilan blank (instant render)
const cachedRole = localStorage.getItem('user_role');
let cachedAdditional = [];
try {
    cachedAdditional = JSON.parse(localStorage.getItem('user_additional_roles') || '[]');
} catch (_) {}

if (cachedRole) {
    initLayout(cachedRole).catch(() => {});
    setupSupervisorAccess(cachedRole, cachedAdditional);
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.classList.remove('hidden');
}

// Sinkronisasi hak akses saat auth state tersedia
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.replace('index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash));
        return;
    }

    try {
        let role = localStorage.getItem('user_role');
        let additionalRoles = [];

        try {
            additionalRoles = JSON.parse(localStorage.getItem('user_additional_roles') || '[]');
        } catch (_) {}

        try {
            const cachedData = localStorage.getItem(`simas_user_data_${user.uid}`);
            if (cachedData) {
                const parsed = JSON.parse(cachedData);
                if (parsed.role) role = parsed.role;
                if (parsed.additionalRoles) additionalRoles = parsed.additionalRoles;
            }
        } catch (_) {}

        if (!role || !additionalRoles.length) {
            const userSnap = await getDoc(doc(db, PATHS.users, user.uid));
            if (userSnap && userSnap.exists()) {
                const data = userSnap.data();
                if (data.role) role = data.role;
                if (data.additionalRoles) additionalRoles = data.additionalRoles;
                localStorage.setItem('user_role', role);
                localStorage.setItem('user_additional_roles', JSON.stringify(additionalRoles));
            }
        }

        role = role || 'guru_mapel';
        await initLayout(role);
        setupSupervisorAccess(role, additionalRoles);

        const mainEl = document.querySelector('main');
        if (mainEl) mainEl.classList.remove('hidden');
    } catch (e) {
        console.warn('[EKinerja] Gagal memeriksa wewenang:', e);
        const mainEl = document.querySelector('main');
        if (mainEl) mainEl.classList.remove('hidden');
    }
});
