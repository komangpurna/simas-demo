/**
 * js/page-monitoring-beban-kerja.js
 * Dashboard Monitoring Beban Kerja Guru (Kepala Sekolah)
 * Menampilkan ringkasan semua guru, review plan & log, export CSV
 * SSOT: Cloudflare D1
 */

import './global.js';
import {
    cfGetWorkloadMonitoringSummary, cfReviewWorkloadPlan, cfReviewWorkloadLogs,
    cfGetWorkloadExportUrl, cfGetWorkloadWeek, cfGetWorkloadPolicy, cfUpdateWorkloadPolicy
} from './cloudflare-client.js';
import {
    DEFAULT_WORKLOAD_POLICY,
    WORKLOAD_DAY_NAMES,
    timeStringToMinutes,
    minutesToTimeString,
    formatDurationDisplay,
    calculateDayTimelineSlots,
    isStudyDayCompliantActivity,
    calculateAdjustedWeeklyTarget,
    countWeekWorkHolidays
} from './workload-calc.js';
import {
    fetchRegisteredHolidays,
    isHolidayDate,
    getHolidayDateInfo
} from './holiday-manager.js';
import { resolvePhotoUrl } from './config.js';
import { createWeekCache } from './workload-week-cache.mjs';

// ========== STATE ==========
let _weekStart = '';
let _summaryData = [];       // Array of teacher summaries
const _monitoringCache = createWeekCache({ max: 12, staleMs: 30000, expireMs: 300000 });
let _loadSummarySeq = 0;
let _summaryAbortController = null;
let _filteredData = [];      // After filter applied
let _selectedTeacherIds = new Set();
let _monitoringViewMode = 'table'; // 'table' | 'matrix' | 'detail'
let _detailTeacherId = '';
let _detailWeekData = null;
let _detailViewMode = 'matrix'; // 'matrix' | 'focus'
let _detailFocusDayIndex = 0; // 0..4 (Senin..Jumat)
let _policy = null;
let _selectedVipTeacherIds = new Set();
let _vipTeachersList = [];
let _activePolicyTab = 'flow';

// ========== KONSTANTA GANTT ==========
const GANTT_START = 7 * 60 + 30; // 07:30 WITA = 450 menit
const GANTT_END = 15 * 60 + 30;   // 15:30 WITA = 930 menit
const GANTT_TOTAL = GANTT_END - GANTT_START; // 480 menit
const MIN_BLOCK_MINUTES = 25;

// ========== HELPERS ==========
function todayWITA() {
    return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

function getMondayOfWeek(dateStr) {
    const d = new Date(dateStr || todayWITA());
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
}

function getMonitoringEffectiveTarget() {
    if (!_weekStart) return 2250;
    const adj = calculateAdjustedWeeklyTarget(_weekStart, [], {
        policy: _policy,
        isHolidayFn: (d) => isHolidayDate(d),
        getHolidayInfoFn: (d) => getHolidayDateInfo(d)
    });
    return adj.adjustedTargetMinutes;
}

function getMonitoringHolidayInfo() {
    if (!_weekStart) return { holidayCount: 0, holidayDates: [] };
    return countWeekWorkHolidays(_weekStart, [], {
        policy: _policy,
        isHolidayFn: (d) => isHolidayDate(d),
        getHolidayInfoFn: (d) => getHolidayDateInfo(d)
    });
}

function showToast(msg, type = 'success') {
    if (typeof window.showToast === 'function') {
        const title = type === 'error' ? 'Peringatan' : (type === 'warning' ? 'Perhatian' : 'Informasi');
        window.showToast(title, msg, type);
    } else if (typeof window.showNotification === 'function') {
        window.showNotification(msg, type);
    } else {
        console.warn(`[Workload Monitoring] [${type}] ${msg}`);
    }
}

async function askConfirm(message, title = 'Konfirmasi', type = 'warning', options = {}) {
    try {
        if (typeof window.showConfirmModal === 'function') {
            return (await window.showConfirmModal(message, title, type, options)) === true;
        }
    } catch (err) {
        console.error('[Workload Monitoring] Gagal menampilkan konfirmasi:', err);
    }
    showToast('Konfirmasi tidak dapat ditampilkan. Silakan muat ulang halaman lalu coba kembali.', 'error');
    return false;
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    try {
        let validUrlStr = trimmed;
        if (/^\/\//.test(validUrlStr)) {
            validUrlStr = 'https:' + validUrlStr;
        } else if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//i.test(validUrlStr)) {
            validUrlStr = 'https://' + validUrlStr;
        }
        const parsed = new URL(validUrlStr);
        if (['http:', 'https:'].includes(parsed.protocol)) {
            return parsed.href;
        }
    } catch (_) {}
    return '';
}

const INDO_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function formatMonitoringWeekRangeDisplay(mondayStr) {
    if (!mondayStr) return '-';
    try {
        const parts = mondayStr.split('-');
        if (parts.length !== 3) return mondayStr;
        const m = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        if (isNaN(m.getTime())) return mondayStr;
        const f = new Date(m);
        f.setDate(m.getDate() + 4);

        const mD = m.getDate();
        const fD = f.getDate();
        const mM = m.getMonth();
        const fM = f.getMonth();
        const mY = m.getFullYear();
        const fY = f.getFullYear();

        const mMonth = INDO_MONTHS_SHORT[mM] || '';
        const fMonth = INDO_MONTHS_SHORT[fM] || '';

        if (mY === fY) {
            if (mM === fM) {
                return `${mD} – ${fD} ${mMonth} ${mY}`;
            }
            return `${mD} ${mMonth} – ${fD} ${fMonth} ${mY}`;
        }
        return `${mD} ${mMonth} ${mY} – ${fD} ${fMonth} ${fY}`;
    } catch {
        return mondayStr;
    }
}

function renderMonitoringWeekRangeLabel() {
    const lbl = el('label-monitoring-week-range');
    if (lbl) {
        lbl.textContent = formatMonitoringWeekRangeDisplay(_weekStart);
    }
}

function el(id) { return document.getElementById(id); }

export function monitoringManageTeacher(teacherId) {
    const targetId = teacherId || (typeof _detailTeacherId === 'string' && _detailTeacherId ? _detailTeacherId : '') || (typeof window.monitoringGetDetailTeacherId === 'function' ? window.monitoringGetDetailTeacherId() : '');
    if (!targetId) {
        if (typeof window.showToast === 'function') {
            window.showToast('Pilih guru terlebih dahulu untuk mengelola kinerjanya.', 'warning');
        }
        return;
    }
    if (typeof window.workloadAdminManageTeacher === 'function' && window.workloadAdminManageTeacher !== monitoringManageTeacher) {
        return window.workloadAdminManageTeacher(targetId);
    }
    // Fallback terpadu jika modul page-beban-kerja.js belum siap atau sedang loading
    const select = el('select-workload-teacher');
    if (select) select.value = targetId;
    if (typeof window.workloadOnAdminTeacherChange === 'function') {
        window.workloadOnAdminTeacherChange(targetId).catch(() => {});
    }
    if (typeof window.workloadSwitchTab === 'function') {
        window.workloadSwitchTab('tab-today');
    } else {
        const todayTab = el('tab-btn-today');
        if (todayTab) todayTab.click();
    }
    if (typeof window.showToast === 'function') {
        window.showToast('Membuka Tab Realisasi Kinerja Guru...', 'info');
    }
}

if (typeof window !== 'undefined') {
    window.monitoringManageTeacher = monitoringManageTeacher;
    if (typeof window.workloadAdminManageTeacher !== 'function') {
        window.workloadAdminManageTeacher = monitoringManageTeacher;
    }
}

// ========== INIT ==========
function initMonitoringPage() {
    const globalWeek = (typeof window.workloadGetWeekStartDate === 'function')
        ? window.workloadGetWeekStartDate()
        : (el('input-week-start-date')?.value || getMondayOfWeek(todayWITA()));
    _weekStart = globalWeek || getMondayOfWeek(todayWITA());

    const inp = el('input-monitoring-week-start');
    if (inp) inp.value = _weekStart;
    renderMonitoringWeekRangeLabel();

    window.monitoringNavWeek = navWeek;
    window.monitoringOnDateChange = onDateChange;
    window.monitoringSetCurrentWeek = setCurrentWeek;
    window.monitoringSetWeek = setWeek;
    window.monitoringApplyFilter = applyFilter;
    window.monitoringToggleSelectAll = toggleSelectAll;
    window.monitoringBulkVerify = bulkVerify;
    window.monitoringExportXLSX = exportXLSX;
    window.monitoringExportCSV = exportXLSX;

    window.monitoringOpenReviewPlan = openReviewPlan;
    window.monitoringCloseReviewPlan = closeReviewPlan;
    window.monitoringSubmitReviewPlan = submitReviewPlan;

    window.monitoringOpenPolicyModal = openPolicyModal;
    window.monitoringClosePolicyModal = closePolicyModal;
    window.monitoringSavePolicySettings = savePolicySettings;
    window.monitoringUpdatePolicyVisuals = updatePolicyVisuals;
    window.monitoringSetPolicyPreset = setPolicyPreset;
    window.monitoringSyncPolicyBadges = syncPolicyBadges;
    window.monitoringSyncFilterStatusDropdown = syncFilterStatusDropdown;
    window.monitoringSwitchPolicyTab = monitoringSwitchPolicyTab;
    window.monitoringToggleTeacherVip = monitoringToggleTeacherVip;
    window.monitoringToggleAllVip = monitoringToggleAllVip;
    window.monitoringFilterVipTeachers = monitoringFilterVipTeachers;

    // Direct event listener fallback anti-gagal untuk tombol alur persetujuan
    const btnToolbarPolicy = el('btn-workload-policy-modal');
    if (btnToolbarPolicy && !btnToolbarPolicy._boundPolicyClick) {
        btnToolbarPolicy._boundPolicyClick = true;
        btnToolbarPolicy.addEventListener('click', (e) => {
            e.preventDefault();
            openPolicyModal();
        });
    }
    const btnHeaderPolicy = el('btn-header-workload-policy');
    if (btnHeaderPolicy && !btnHeaderPolicy._boundPolicyClick) {
        btnHeaderPolicy._boundPolicyClick = true;
        btnHeaderPolicy.addEventListener('click', (e) => {
            e.preventDefault();
            openPolicyModal();
        });
    }

    window.monitoringOpenReviewLogs = openReviewLogs;
    window.monitoringCloseReviewLogs = closeReviewLogs;
    window.monitoringSubmitReviewLogs = submitReviewLogs;

    window.monitoringOpenTeacherDetail = openTeacherDetail;
    window.monitoringCloseTeacherDetail = closeTeacherDetail;

    // Registrasi Supervisi Terpadu Baru (Matriks Mingguan & Fokus Harian)
    window.monitoringSwitchViewMode = switchMonitoringViewMode;
    window.monitoringOpenTeacherSupervisionDetail = openTeacherSupervisionDetail;
    window.monitoringBackToOverview = backToOverview;
    window.monitoringNavDetailTeacher = navDetailTeacher;
    window.monitoringOnSelectTeacherChange = onSelectTeacherChange;
    window.monitoringToggleDetailView = toggleDetailView;
    window.monitoringSetFocusDay = setFocusDay;
    window.monitoringQuickApprovePlan = quickApprovePlan;
    window.monitoringOpenRevisionModal = openRevisionModal;
    window.monitoringQuickVerifySingleLog = quickVerifySingleLog;

    window.monitoringToggleTeacher = toggleTeacher;
    window.monitoringLoadSummary = loadSummary;
    window.monitoringIsWorkloadTeacher = isWorkloadTeacher;
    window.monitoringGetDetailTeacherId = () => _detailTeacherId;
    window.monitoringGetSummaryTeachers = () => _summaryData;
    window.monitoringManageTeacher = monitoringManageTeacher;
    if (typeof window.workloadAdminManageTeacher !== 'function') {
        window.workloadAdminManageTeacher = monitoringManageTeacher;
    }

    const role = localStorage.getItem('user_role') || '';
    const allRoles = (window.getAllUserRoles ? window.getAllUserRoles() : [role]).filter(Boolean);
    const isSupervisor = allRoles.includes('super_admin') || allRoles.includes('kepala_sekolah') || allRoles.includes('wakasek_kurikulum') ||
        (window.hasRole && (window.hasRole('super_admin') || window.hasRole('kepala_sekolah') || window.hasRole('wakasek_kurikulum')));

    if (isSupervisor && el('table-monitoring-body')) {
        loadSummary();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMonitoringPage);
} else {
    initMonitoringPage();
}

function isCurrentUserSupervisor() {
    const role = localStorage.getItem('user_role') || '';
    const allRoles = (window.getAllUserRoles ? window.getAllUserRoles() : [role]).filter(Boolean);
    return allRoles.includes('super_admin') || allRoles.includes('kepala_sekolah') || allRoles.includes('wakasek_kurikulum') ||
        (typeof window.hasRole === 'function' && (window.hasRole('super_admin') || window.hasRole('kepala_sekolah') || window.hasRole('wakasek_kurikulum')));
}

// ========== NAVIGATION (Sinkron dengan SSOT Header Utama) ==========
function setWeek(mondayStr, force = false) {
    if (!mondayStr) return;
    if (_weekStart === mondayStr && !force) return;
    _weekStart = mondayStr;
    const inp = el('input-monitoring-week-start');
    if (inp) inp.value = _weekStart;
    renderMonitoringWeekRangeLabel();
    if (isCurrentUserSupervisor()) {
        loadSummary({ useCache: true });
        if (_monitoringViewMode === 'detail' && _detailTeacherId) {
            loadAndRenderTeacherDetail(_detailTeacherId);
        }
    }
}

function navWeek(dir) {
    if (typeof window.workloadNavWeek === 'function') {
        window.workloadNavWeek(dir);
        return;
    }
    const d = new Date(_weekStart);
    d.setDate(d.getDate() + dir * 7);
    _weekStart = d.toISOString().slice(0, 10);
    const inp = el('input-monitoring-week-start');
    if (inp) inp.value = _weekStart;
    renderMonitoringWeekRangeLabel();
    loadSummary();
}

function onDateChange() {
    if (typeof window.workloadOnDateChange === 'function') {
        window.workloadOnDateChange();
        return;
    }
    const inp = el('input-monitoring-week-start');
    if (!inp || !inp.value) return;
    _weekStart = getMondayOfWeek(inp.value);
    inp.value = _weekStart;
    renderMonitoringWeekRangeLabel();
    loadSummary();
}

function setCurrentWeek() {
    if (typeof window.workloadSetCurrentWeek === 'function') {
        window.workloadSetCurrentWeek();
        return;
    }
    _weekStart = getMondayOfWeek(todayWITA());
    const inp = el('input-monitoring-week-start');
    if (inp) inp.value = _weekStart;
    renderMonitoringWeekRangeLabel();
    loadSummary();
}

/**
 * Memvalidasi apakah item GTK merupakan Guru / Pendidik untuk modul E-Kinerja Guru (Permendikdasmen 11/2025).
 * Tenaga Kependidikan, Tendik, Keamanan, Tata Usaha, dan Pegawai dipantau terpisah di modul Agenda Pegawai.
 */
function isWorkloadTeacher(t) {
    if (!t) return false;
    const j = String(t.jenis_ptk || '').toLowerCase().trim();
    const r = String(t.role || '').toLowerCase().trim();

    // Eksklusi tegas Tenaga Kependidikan / Tendik / Keamanan / Tata Usaha / Pegawai / Staff / Kepala Sekolah
    if (
        j.includes('tenaga kependidikan') ||
        j.includes('kependidikan') ||
        j.includes('tendik') ||
        j.includes('keamanan') ||
        j.includes('tata usaha') ||
        j.includes('pegawai') ||
        j.includes('staff') ||
        j.includes('kepala sekolah') ||
        j === 'pppk'
    ) {
        return false;
    }

    if (
        r === 'kepala_sekolah' ||
        r === 'tendik' ||
        r === 'tenaga_kependidikan' ||
        r === 'keamanan' ||
        r === 'pegawai' ||
        r === 'staff'
    ) {
        return false;
    }

    // Inklusi: Guru atau Pendidik
    return j.includes('guru') || j.includes('pendidik') || (!j && r.includes('guru'));
}

// ========== LOADING STATE & LOAD ==========
function setMonitoringLoadingState(isLoading) {
    const containers = [
        el('monitoring-table-view-container'),
        el('monitoring-matrix-view-container'),
        el('monitoring-detail-view-container')
    ].filter(Boolean);

    containers.forEach(c => {
        if (isLoading) {
            c.classList.add('opacity-40', 'pointer-events-none', 'select-none');
            c.setAttribute('aria-busy', 'true');
        } else {
            c.classList.remove('opacity-40', 'pointer-events-none', 'select-none');
            c.removeAttribute('aria-busy');
        }
    });
}

async function loadSummary(opts = {}) {
    if (!isCurrentUserSupervisor()) {
        _summaryData = [];
        return;
    }

    const useCache = opts.useCache === true;
    const silent = opts.silent === true;

    if (useCache && !silent) {
        const cached = _monitoringCache.get(null, _weekStart);
        if (cached) {
            _summaryData = cached.data;
            if (typeof window.workloadPopulateAdminTeacherDropdown === 'function') {
                window.workloadPopulateAdminTeacherDropdown(_summaryData);
            }
            setMonitoringLoadingState(false);
            _selectedTeacherIds.clear();
            renderMonitoringWeekRangeLabel();
            syncPolicyBadges(_policy || DEFAULT_WORKLOAD_POLICY);
            updateMonitoringFooterPolicyBadge();
            applyFilter();
            renderKPI();
            if (_monitoringViewMode === 'matrix') {
                renderSchoolMatrixView();
            } else if (_monitoringViewMode === 'detail' && _detailTeacherId) {
                loadAndRenderTeacherDetail(_detailTeacherId);
            }

            if (cached.stale) {
                loadSummary({ useCache: false, silent: true }).catch(() => {});
            }
            return;
        }
    }

    if (!silent) {
        setMonitoringLoadingState(true);
    }

    if (_summaryAbortController) {
        try { _summaryAbortController.abort(); } catch (_) {}
    }
    _summaryAbortController = new AbortController();
    const currentSeq = ++_loadSummarySeq;

    try {
        const promises = [
            cfGetWorkloadMonitoringSummary(_weekStart, { signal: _summaryAbortController.signal })
        ];
        if (!_policy) {
            promises.push(cfGetWorkloadPolicy());
        }
        if (typeof window.loadVipStatusSummary === 'function') {
            promises.push(window.loadVipStatusSummary());
        }
        if (_weekStart) {
            const d = new Date(_weekStart);
            d.setDate(d.getDate() + 4);
            const endOfWeekDate = d.toISOString().slice(0, 10);
            promises.push(fetchRegisteredHolidays(_weekStart, endOfWeekDate));
        }

        const results = await Promise.allSettled(promises);
        if (currentSeq !== _loadSummarySeq) return;

        const sumRes = results[0];
        if (sumRes.status === 'fulfilled') {
            const res = sumRes.value;
            const rawList = Array.isArray(res?.data) ? res.data : (Array.isArray(res?.data?.teachers) ? res.data.teachers : (Array.isArray(res) ? res : []));
            _summaryData = rawList.filter(isWorkloadTeacher);
            _monitoringCache.set(null, _weekStart, _summaryData);
            if (typeof window.workloadPopulateAdminTeacherDropdown === 'function') {
                window.workloadPopulateAdminTeacherDropdown(_summaryData);
            }
        } else {
            const err = sumRes.reason;
            if (err?.name === 'AbortError' || err?.message?.includes('aborted')) {
                return;
            }
            console.warn('[Monitoring] Gagal memuat ringkasan:', err?.message);
            _summaryData = [];
            if (typeof window.workloadPopulateAdminTeacherDropdown === 'function') {
                window.workloadPopulateAdminTeacherDropdown([]);
            }
        }

        if (!_policy) {
            const polRes = results[1];
            if (polRes?.status === 'fulfilled') {
                _policy = polRes.value?.data?.policy || polRes.value?.data || DEFAULT_WORKLOAD_POLICY;
            } else {
                _policy = DEFAULT_WORKLOAD_POLICY;
            }
        }
    } catch (e) {
        if (currentSeq !== _loadSummarySeq) return;
        console.warn('[Monitoring] Gagal memuat:', e.message);
        _summaryData = [];
        if (!_policy) _policy = DEFAULT_WORKLOAD_POLICY;
    } finally {
        if (currentSeq === _loadSummarySeq) {
            setMonitoringLoadingState(false);
        }
    }

    _selectedTeacherIds.clear();
    renderMonitoringWeekRangeLabel();
    syncPolicyBadges(_policy);
    updateMonitoringFooterPolicyBadge();
    applyFilter();
    renderKPI();

    if (_monitoringViewMode === 'matrix') {
        renderSchoolMatrixView();
    } else if (_monitoringViewMode === 'detail' && _detailTeacherId) {
        loadAndRenderTeacherDetail(_detailTeacherId);
    }
}

// ========== FILTER ==========
function applyFilter() {
    const statusFilter = el('filter-plan-status')?.value || '';
    const searchText = (el('filter-teacher-search')?.value || '').toLowerCase().trim();
    const TARGET = getMonitoringEffectiveTarget();

    _filteredData = _summaryData.filter(t => {
        // Status & Evaluasi filter
        if (statusFilter) {
            const planStatus = t.plan_status || '';
            const planned = t.planned_minutes || 0;

            if (statusFilter === 'no_plan') {
                if (planStatus && planStatus !== '') return false;
            } else if (statusFilter === 'has_plan') {
                if (!planStatus || planStatus === '') return false;
            } else if (statusFilter === 'target_not_met') {
                if (planned >= TARGET) return false;
            } else if (statusFilter === 'target_met') {
                if (planned < TARGET) return false;
            } else if (planStatus !== statusFilter) {
                return false;
            }
        }
        // Search
        if (searchText && !(t.teacher_name || '').toLowerCase().includes(searchText)) return false;
        return true;
    });

    renderTable();
    if (_monitoringViewMode === 'matrix') {
        renderSchoolMatrixView();
    }
}

// ========== KPI ==========
function renderKPI() {
    const totalTeachers = _summaryData.length;
    const planReq = _policy?.require_plan_approval !== 0;
    const logReq = _policy?.require_log_verification !== 0;

    const submitted = _summaryData.filter(t => t.plan_status === 'submitted').length;
    let needsAction = 0;
    if (planReq) {
        needsAction += submitted;
    }
    if (logReq) {
        needsAction += _summaryData.filter(t => (t.unverified_log_count || 0) > 0).length;
    }

    let totalPlanned = 0, totalActual = 0, planCount = 0;
    _summaryData.forEach(t => {
        totalPlanned += (t.planned_minutes || 0);
        totalActual += (t.actual_minutes || 0);
        if (t.planned_minutes > 0) planCount++;
    });
    const avgPlanned = planCount > 0 ? Math.round(totalPlanned / planCount) : 0;
    const actualCount = _summaryData.filter(t => t.actual_minutes > 0).length;
    const avgActual = actualCount > 0 ? Math.round(totalActual / actualCount) : 0;

    const elTotal = el('kpi-mon-total-teachers');
    if (elTotal) elTotal.textContent = totalTeachers;

    const elSubmitted = el('kpi-mon-submitted-count');
    if (elSubmitted) {
        if (planReq) {
            elSubmitted.textContent = `(${submitted} diajukan)`;
            elSubmitted.classList.remove('hidden');
        } else {
            elSubmitted.textContent = '';
            elSubmitted.classList.add('hidden');
        }
    }

    const elAvgPlan = el('kpi-mon-avg-planned');
    if (elAvgPlan) elAvgPlan.textContent = avgPlanned.toLocaleString('id-ID');

    const elAvgAct = el('kpi-mon-avg-actual');
    if (elAvgAct) elAvgAct.textContent = avgActual.toLocaleString('id-ID');

    const elNeedsAction = el('kpi-mon-needs-action');
    if (elNeedsAction) elNeedsAction.textContent = needsAction;
}

// ========== TABLE ==========
function renderTable() {
    const tbody = el('table-monitoring-body');
    if (!tbody) return;

    const showCheckboxCol = Boolean(_policy?.require_log_verification !== 0);
    const thCb = el('th-cb-select-all');
    if (thCb) {
        thCb.classList.toggle('hidden', !showCheckboxCol);
    }

    if (!showCheckboxCol) {
        _selectedTeacherIds.clear();
        const cbSelectAll = el('cb-select-all');
        if (cbSelectAll) cbSelectAll.checked = false;
    }

    const showVerifiedCol = Boolean(_policy?.require_log_verification !== 0);
    const thVerified = el('th-mon-verified');
    if (thVerified) {
        thVerified.classList.toggle('hidden', !showVerifiedCol);
    }

    let colSpan = 9;
    if (showCheckboxCol) colSpan += 1;
    if (showVerifiedCol) colSpan += 1;

    if (_filteredData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${colSpan}" class="p-8 text-center text-slate-400 text-xs">Tidak ada data guru yang sesuai filter.</td></tr>`;
        return;
    }

    const TARGET = getMonitoringEffectiveTarget();
    let html = '';
    _filteredData.forEach(t => {
        const planned = t.planned_minutes || 0;
        const actual = t.actual_minutes || 0;
        const verified = t.verified_minutes || 0;
        const teachingJP = t.teaching_jp || 0;
        const eqJP = t.equivalent_jp || 0;
        const pct = Math.min(100, Math.round(actual / TARGET * 100));
        const isChecked = _selectedTeacherIds.has(t.teacher_id);

        // Status badge
        const statusMap = {
            'draft': { text: 'Draft', cls: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400' },
            'submitted': { text: 'Menunggu', cls: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
            'approved': { text: 'Disetujui', cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' },
            'needs_revision': { text: 'Revisi', cls: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300' }
        };
        const st = statusMap[t.plan_status] || { text: 'Belum ada', cls: 'bg-slate-100 dark:bg-slate-800 text-slate-400' };

        // Pemenuhan bar (Realisasi terhadap target 2.250 menit)
        const barColor = pct >= 90 ? 'bg-emerald-500' : (pct >= 60 ? 'bg-blue-500' : 'bg-amber-500');

        const planReq = _policy?.require_plan_approval !== 0;
        const logReq = _policy?.require_log_verification !== 0;

        // Action buttons
        let actions = '';
        if (t.plan_status === 'submitted' && planReq) {
            actions += `<button type="button" onclick="window.monitoringOpenReviewPlan('${t.teacher_id}')" class="h-6 w-6 rounded-md bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 transition-all flex items-center justify-center cursor-pointer shrink-0" title="Review Rencana"><i class="fa-solid fa-stamp text-[10px]"></i></button>`;
        }
        if (t.unverified_log_count > 0 && logReq) {
            actions += `<button type="button" onclick="window.monitoringOpenReviewLogs('${t.teacher_id}')" class="h-6 px-1.5 rounded-md bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 transition-all flex items-center justify-center gap-1 cursor-pointer shrink-0" title="Verifikasi Log (${t.unverified_log_count})"><i class="fa-solid fa-clipboard-check text-[10px]"></i><span class="text-[9px] font-bold">${t.unverified_log_count}</span></button>`;
        }
        actions += `<button type="button" onclick="window.monitoringOpenTeacherSupervisionDetail('${t.teacher_id}')" class="h-6 w-6 rounded-md bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 transition-all flex items-center justify-center cursor-pointer shrink-0" title="Buka Detail Supervisi (Gantt & Harian)"><i class="fa-solid fa-chart-gantt text-[10px]"></i></button>`;
        actions += `<button type="button" onclick="window.monitoringOpenTeacherDetail('${t.teacher_id}')" class="h-6 w-6 rounded-md bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 transition-all flex items-center justify-center cursor-pointer shrink-0" title="Popup Ringkas"><i class="fa-solid fa-eye text-[10px]"></i></button>`;
        actions += `<button type="button" onclick="(window.monitoringManageTeacher || window.workloadAdminManageTeacher)('${t.teacher_id}')" class="h-6 w-6 rounded-md bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 transition-all flex items-center justify-center cursor-pointer shrink-0" title="Kelola Rencana & Realisasi Guru Ini"><i class="fa-solid fa-pen-to-square text-[10px]"></i></button>`;

        const cbTd = showCheckboxCol
            ? `<td class="py-1.5 px-2.5 sm:px-3 text-center"><input type="checkbox" ${isChecked ? 'checked' : ''} onchange="window.monitoringToggleTeacher('${t.teacher_id}')" class="rounded border-slate-300"></td>`
            : '';

        const verifiedTd = showVerifiedCol
            ? `<td class="py-1.5 px-2.5 sm:px-3 text-center font-bold text-xs font-mono text-emerald-600 dark:text-emerald-400">${verified.toLocaleString('id-ID')}</td>`
            : '';

        const nipTooltip = t.nip || t.nuptk ? ` · NIP: ${t.nip || t.nuptk}` : '';

        html += `
        <tr class="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
            ${cbTd}
            <td class="py-1.5 px-2.5 sm:px-3">
                <span onclick="window.monitoringOpenTeacherSupervisionDetail('${t.teacher_id}')" class="font-bold text-slate-800 dark:text-white text-xs hover:text-emerald-600 dark:hover:text-emerald-400 cursor-pointer transition-colors truncate block" title="Buka Detail Supervisi${escapeHTML(nipTooltip)}">${escapeHTML(t.teacher_name || t.teacher_id)}</span>
            </td>
            <td class="py-1.5 px-2.5 sm:px-3 text-xs text-slate-600 dark:text-slate-400 truncate">${escapeHTML(t.jenis_ptk || '-')}</td>
            <td class="py-1.5 px-2.5 sm:px-3 text-center font-bold text-xs font-mono ${planned >= TARGET ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-300'}">${planned.toLocaleString('id-ID')}</td>
            <td class="py-1.5 px-2.5 sm:px-3 text-center font-bold text-xs font-mono text-blue-600 dark:text-blue-400">${actual.toLocaleString('id-ID')}</td>
            ${verifiedTd}
            <td class="py-1.5 px-2.5 sm:px-3 text-center font-semibold text-xs font-mono">${teachingJP}</td>
            <td class="py-1.5 px-2.5 sm:px-3 text-center font-semibold text-xs font-mono text-purple-600 dark:text-purple-400">${eqJP > 0 ? '+' + eqJP : '0'}</td>
            <td class="py-1.5 px-2.5 sm:px-3">
                <div class="flex items-center gap-1.5" title="Pemenuhan Realisasi: ${actual.toLocaleString('id-ID')} / ${TARGET.toLocaleString('id-ID')} mnt (${pct}%)">
                    <div class="w-14 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden"><div class="${barColor} h-full rounded-full" style="width:${pct}%"></div></div>
                    <span class="text-[10px] font-bold font-mono ${pct >= 90 ? 'text-emerald-600' : 'text-slate-500'}">${pct}%</span>
                </div>
            </td>
            <td class="py-1.5 px-2.5 sm:px-3"><span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${st.cls}">${st.text}</span></td>
            <td class="py-1.5 px-2.5 sm:px-3"><div class="flex items-center justify-center gap-1">${actions}</div></td>
        </tr>`;
    });

    tbody.innerHTML = html;
}

// ========== CHECKBOX ==========
function toggleTeacher(teacherId) {
    if (_selectedTeacherIds.has(teacherId)) {
        _selectedTeacherIds.delete(teacherId);
    } else {
        _selectedTeacherIds.add(teacherId);
    }
}

function toggleSelectAll() {
    const cb = el('cb-select-all');
    if (cb?.checked) {
        _filteredData.forEach(t => _selectedTeacherIds.add(t.teacher_id));
    } else {
        _selectedTeacherIds.clear();
    }
    renderTable();
}

// ========== REVIEW PLAN ==========
async function openReviewPlan(teacherId) {
    const modal = el('modal-review-plan');
    if (!modal) return;

    el('review-plan-teacher-id').value = teacherId;
    el('review-plan-decision').value = 'approved';
    el('review-plan-notes').value = '';

    // Ambil data minggu guru ini
    const teacher = _summaryData.find(t => t.teacher_id === teacherId);
    const infoEl = el('review-plan-info');
    if (infoEl && teacher) {
        infoEl.innerHTML = `
            <div class="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-white"><i class="fa-solid fa-user text-emerald-600"></i>${teacher.teacher_name}</div>
            <div class="text-slate-500">${teacher.jenis_ptk || ''} · ${teacher.nip || teacher.nuptk || ''}</div>
            <div>Rencana: <span class="font-bold text-blue-600">${(teacher.planned_minutes || 0).toLocaleString('id-ID')} menit</span> dari target 2.250</div>
        `;
    }

    // Ambil detail rencana via GET week (read-only view)
    try {
        const weekRes = await cfGetWorkloadWeek(teacherId, _weekStart);
        const data = weekRes?.data;
        if (data?.active_version) {
            el('review-plan-week-id').value = data.week.id;
            el('review-plan-version-id').value = data.active_version.id;
            el('review-plan-revision-lock').value = data.active_version.revision_lock || 0;
        }

        // Render summary
        const summaryEl = el('review-plan-summary');
        if (summaryEl && data?.segments) {
            const dayNames = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
            let sumHtml = '<div class="font-bold text-slate-700 dark:text-slate-200 mb-2">Ringkasan Rencana</div>';
            for (let i = 1; i <= 5; i++) {
                const daySegs = data.segments.filter(s => s.day_of_week === i);
                const dayTotal = daySegs.reduce((sum, s) => sum + (s.planned_minutes || 0), 0);
                sumHtml += `<div class="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <span class="font-semibold">${dayNames[i - 1]}</span>
                    <span class="font-bold ${dayTotal >= 450 ? 'text-emerald-600' : 'text-slate-600'}">${dayTotal} / 450m</span>
                </div>`;
                daySegs.forEach(s => {
                    sumHtml += `<div class="ml-4 text-[10px] text-slate-400">${s.start_time}–${s.end_time} · ${s.activity_title || 'Kegiatan'} (${s.planned_minutes || 0}m)</div>`;
                });
            }
            summaryEl.innerHTML = sumHtml;
        }
    } catch (e) {
        console.warn('[Monitoring] Error fetching teacher week:', e.message);
    }

    modal.classList.remove('hidden');
}

function closeReviewPlan() {
    el('modal-review-plan')?.classList.add('hidden');
}

async function submitReviewPlan() {
    const weekId = el('review-plan-week-id')?.value;
    const versionId = el('review-plan-version-id')?.value;
    const decision = el('review-plan-decision')?.value;
    const notes = el('review-plan-notes')?.value?.trim() || '';
    const revLock = parseInt(el('review-plan-revision-lock')?.value || '0');

    if (!weekId || !versionId) {
        showToast('Data rencana tidak lengkap. Guru mungkin belum mengajukan rencana.', 'error');
        return;
    }

    try {
        await cfReviewWorkloadPlan({
            work_week_id: weekId,
            plan_version_id: versionId,
            decision: decision,
            review_notes: notes,
            revision_reason: decision === 'needs_revision' ? notes : '',
            revision_lock: revLock
        });
        showToast(decision === 'approved' ? 'Rencana berhasil disetujui' : 'Permintaan revisi berhasil dikirim');
        closeReviewPlan();
        await loadSummary();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ========== REVIEW LOGS ==========
async function openReviewLogs(teacherId) {
    const modal = el('modal-review-logs');
    if (!modal) return;

    el('review-logs-teacher-id').value = teacherId;
    el('review-logs-decision').value = 'verified';
    el('review-logs-notes').value = '';

    // Ambil data minggu guru ini
    try {
        const weekRes = await cfGetWorkloadWeek(teacherId, _weekStart);
        const logs = weekRes?.data?.logs || [];
        const unverifiedLogs = logs.filter(l => l.verification_status === 'unverified');

        const listEl = el('review-logs-list');
        if (listEl) {
            if (unverifiedLogs.length === 0) {
                listEl.innerHTML = '<div class="text-center text-slate-400 py-4 text-xs">Tidak ada log yang perlu diverifikasi.</div>';
            } else {
                listEl.innerHTML = unverifiedLogs.map(l => {
                    const safeEv = l.evidence_url ? sanitizeUrl(l.evidence_url) : '';
                    return `
                    <div class="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-xs">
                        <div class="flex items-center justify-between">
                            <span class="font-bold text-slate-700 dark:text-white">${escapeHTML(l.title)}</span>
                            <span class="text-[10px] text-slate-400">${l.date}</span>
                        </div>
                        <div class="text-[10px] text-slate-500 mt-0.5">Status: ${escapeHTML(l.status_execution)} · ${escapeHTML(l.output_summary || '')}</div>
                        ${safeEv ? `
                            <div class="mt-2 pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                                <a href="${escapeHTML(safeEv)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline">
                                    <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                                    <span>Buka Gambar Bukti Dukung (Google Drive / Foto)</span>
                                </a>
                            </div>
                        ` : ''}
                    </div>
                `;}).join('');
            }
        }
    } catch (e) {
        console.warn('[Monitoring] Error fetching teacher logs:', e.message);
    }

    modal.classList.remove('hidden');
}

function closeReviewLogs() {
    el('modal-review-logs')?.classList.add('hidden');
}

async function submitReviewLogs() {
    const teacherId = el('review-logs-teacher-id')?.value;
    const decision = el('review-logs-decision')?.value;
    const notes = el('review-logs-notes')?.value?.trim() || '';

    if (!teacherId) { showToast('Data guru tidak tersedia', 'error'); return; }

    try {
        // Ambil data guru week lagi untuk ambil log IDs
        const weekRes = await cfGetWorkloadWeek(teacherId, _weekStart);
        const logs = weekRes?.data?.logs || [];
        const unverifiedLogs = logs.filter(l => l.verification_status === 'unverified');
        const logIds = unverifiedLogs.map(l => l.id);

        if (logIds.length === 0) {
            showToast('Tidak ada log yang perlu diverifikasi', 'error');
            return;
        }

        await cfReviewWorkloadLogs({
            log_ids: logIds,
            decision: decision,
            review_notes: notes
        });
        showToast(decision === 'verified' ? `${logIds.length} log berhasil diverifikasi` : `${logIds.length} log ditolak`);
        closeReviewLogs();
        await loadSummary();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ========== TEACHER DETAIL ==========
async function openTeacherDetail(teacherId) {
    const modal = el('modal-teacher-detail');
    if (!modal) return;

    const content = el('teacher-detail-content');
    if (!content) return;
    content.innerHTML = '<div class="text-center py-8 text-slate-400 text-xs"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat data guru...</div>';
    modal.classList.remove('hidden');

    try {
        const weekRes = await cfGetWorkloadWeek(teacherId, _weekStart);
        const data = weekRes?.data;
        const teacher = _summaryData.find(t => t.teacher_id === teacherId);
        const dayNames = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];

        if (!data) {
            content.innerHTML = '<div class="text-center py-8 text-slate-400 text-xs">Data minggu ini tidak tersedia untuk guru ini.</div>';
            return;
        }

        let html = `
        <div class="flex items-center gap-3 mb-4">
            <div class="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-lg font-bold text-emerald-600">${(teacher?.teacher_name || '?')[0]}</div>
            <div>
                <div class="font-bold text-sm text-slate-800 dark:text-white">${teacher?.teacher_name || teacherId}</div>
                <div class="text-[11px] text-slate-400">${teacher?.jenis_ptk || ''} · ${teacher?.nip || teacher?.nuptk || ''}</div>
            </div>
        </div>`;

        // KPI mini
        const planned = data.summary?.planned_minutes || 0;
        const actual = data.summary?.actual_minutes || 0;
        const verified = data.summary?.verified_minutes || 0;
        const logReq = _policy?.require_log_verification !== 0;

        const kpiCols = logReq ? 'grid-cols-3' : 'grid-cols-2';
        const verifiedKpiHtml = logReq
            ? `<div class="bg-purple-50 dark:bg-purple-950/30 rounded-xl p-2"><div class="font-bold text-purple-600">${verified}</div><div class="text-[10px] text-slate-400">Verifikasi (m)</div></div>`
            : '';

        html += `
        <div class="grid ${kpiCols} gap-2 text-center text-xs mb-4">
            <div class="bg-blue-50 dark:bg-blue-950/30 rounded-xl p-2"><div class="font-bold text-blue-600">${planned}</div><div class="text-[10px] text-slate-400">Rencana (m)</div></div>
            <div class="bg-emerald-50 dark:bg-emerald-950/30 rounded-xl p-2"><div class="font-bold text-emerald-600">${actual}</div><div class="text-[10px] text-slate-400">Realisasi (m)</div></div>
            ${verifiedKpiHtml}
        </div>`;

        // Rencana per hari
        const segments = data.segments || [];
        for (let i = 1; i <= 5; i++) {
            const daySegs = segments.filter(s => s.day_of_week === i).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
            const dayTotal = daySegs.reduce((sum, s) => sum + (s.planned_minutes || 0), 0);
            html += `
            <div class="mb-3">
                <div class="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    <span>${dayNames[i - 1]}</span>
                    <span class="${dayTotal >= 450 ? 'text-emerald-600' : 'text-slate-400'}">${dayTotal}/450m</span>
                </div>`;
            if (daySegs.length === 0) {
                html += '<div class="text-[10px] text-slate-400 ml-2">— Tidak ada kegiatan —</div>';
            } else {
                daySegs.forEach(s => {
                    html += `<div class="flex items-center gap-2 py-1 ml-2 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-50 dark:border-slate-800/50 last:border-0">
                        <span class="font-semibold w-20 shrink-0">${s.start_time}–${s.end_time}</span>
                        <span class="truncate">${s.activity_title || 'Kegiatan'}</span>
                        <span class="font-bold ${s.is_teaching ? 'text-blue-600' : 'text-slate-400'} ml-auto shrink-0">${s.planned_minutes || 0}m${s.is_teaching ? ' KBM' : ''}</span>
                    </div>`;
                });
            }
            html += '</div>';
        }

        content.innerHTML = html;
    } catch (e) {
        content.innerHTML = `<div class="text-center py-8 text-rose-500 text-xs"><i class="fa-solid fa-circle-exclamation mr-1"></i>Gagal memuat data: ${e.message}</div>`;
    }
}

function closeTeacherDetail() {
    el('modal-teacher-detail')?.classList.add('hidden');
}

// ========== SUPERVISI TERPADU KEPALA SEKOLAH ==========
function updateMonitoringFooterPolicyBadge() {
    const footerLbl = el('label-mon-footer-policy');
    if (!footerLbl) return;
    const planReq = _policy?.require_plan_approval !== 0;
    const logReq = _policy?.require_log_verification !== 0;
    if (!planReq && !logReq) {
        footerLbl.textContent = '⚡ Mode Mandiri 100%';
        footerLbl.className = 'text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 border border-emerald-300/40';
    } else if (planReq && logReq) {
        footerLbl.textContent = '📋 Pengawasan Formal Penuh';
        footerLbl.className = 'text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 border border-amber-300/40';
    } else {
        footerLbl.textContent = '🔄 Mode Alur Hibrida';
        footerLbl.className = 'text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 border border-blue-300/40';
    }
}

function switchMonitoringViewMode(mode) {
    _monitoringViewMode = mode;
    const btnTable = el('btn-mon-view-table');
    const btnMatrix = el('btn-mon-view-matrix');
    const btnDetail = el('btn-mon-view-detail');

    const containerTable = el('monitoring-table-view-container');
    const containerMatrix = el('monitoring-matrix-view-container');
    const containerDetail = el('monitoring-detail-view-container');

    const activeBtnCls = 'px-2.5 py-1 rounded-md text-[11px] font-bold transition-all flex items-center gap-1.5 bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-2xs cursor-pointer';
    const inactiveBtnCls = 'px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white cursor-pointer';

    if (btnTable) btnTable.className = mode === 'table' ? activeBtnCls : inactiveBtnCls;
    if (btnMatrix) btnMatrix.className = mode === 'matrix' ? activeBtnCls : inactiveBtnCls;
    if (btnDetail) {
        if (_detailTeacherId) {
            btnDetail.className = mode === 'detail' ? activeBtnCls : inactiveBtnCls;
        } else {
            btnDetail.className = inactiveBtnCls + ' hidden';
        }
    }

    if (containerTable) containerTable.classList.toggle('hidden', mode !== 'table');
    if (containerMatrix) containerMatrix.classList.toggle('hidden', mode !== 'matrix');
    if (containerDetail) containerDetail.classList.toggle('hidden', mode !== 'detail');

    if (mode === 'matrix') {
        renderSchoolMatrixView();
    } else if (mode === 'detail' && _detailTeacherId) {
        loadAndRenderTeacherDetail(_detailTeacherId);
    }
}

function renderSchoolMatrixView() {
    const container = el('monitoring-school-matrix-body');
    if (!container) return;

    if (_filteredData.length === 0) {
        container.innerHTML = '<div class="p-8 text-center text-slate-400 text-xs">Tidak ada data guru yang sesuai filter.</div>';
        return;
    }

    const dayNames = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];

    // Header Kolom Matriks (Desktop)
    let headerDaysHtml = '';
    for (let d = 0; d < 5; d++) {
        const dObj = new Date(_weekStart);
        dObj.setDate(dObj.getDate() + d);
        const dFmt = `${dObj.getDate()} ${INDO_MONTHS_SHORT[dObj.getMonth()] || ''}`;
        headerDaysHtml += `
            <div class="text-center">
                <span class="font-bold text-slate-700 dark:text-slate-200">${dayNames[d]}</span>
                <span class="text-[9px] text-slate-400 font-normal block xl:inline xl:ml-1">${dFmt}</span>
            </div>`;
    }

    let html = `
    <div class="hidden lg:flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-50/80 dark:bg-slate-800/60 rounded-xl text-[10px] font-bold text-slate-500 dark:text-slate-400 border border-slate-200/50 dark:border-slate-700/50 mb-1">
        <div class="w-64 xl:w-72 shrink-0">GURU & BEBAN KERJA</div>
        <div class="flex-1 grid grid-cols-5 gap-1.5 text-center">
            ${headerDaysHtml}
        </div>
        <div class="w-16 text-right pr-1 shrink-0">AKSI</div>
    </div>`;

    const TARGET = getMonitoringEffectiveTarget();

    _filteredData.forEach(t => {
        const planned = t.planned_minutes || 0;
        const actual = t.actual_minutes || 0;
        const teachingJP = t.teaching_jp || 0;
        const pct = TARGET > 0 ? Math.min(100, Math.round(actual / TARGET * 100)) : 100; // const pct = Math.min(100, Math.round(actual / 2250 * 100));
        const rawPhoto = t.foto || t.photo_url || t.teacher_foto || '';
        const tPhoto = rawPhoto ? (typeof resolvePhotoUrl === 'function' ? resolvePhotoUrl(rawPhoto) : rawPhoto) : '';

        const statusMap = {
            'draft': { text: 'Draft', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
            'submitted': { text: 'Menunggu', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' },
            'approved': { text: 'Disetujui', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' },
            'needs_revision': { text: 'Revisi', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' }
        };
        const st = statusMap[t.plan_status] || { text: 'Belum Ada', cls: 'bg-slate-100 text-slate-400 dark:bg-slate-800' };

        // 5 Sel Hari
        let daysHtml = '';
        for (let d = 0; d < 5; d++) {
            const dateObj = new Date(_weekStart);
            dateObj.setDate(dateObj.getDate() + d);
            const dateFormatted = `${dateObj.getDate()} ${INDO_MONTHS_SHORT[dateObj.getMonth()] || ''}`;
            const dateStr = dateObj.toISOString().slice(0, 10);
            const isHoliday = isHolidayDate(dateStr);
            const holidayInfo = isHoliday ? getHolidayDateInfo(dateStr) : null;

            const isFilled = planned > 0;
            const avgDayPlanned = isFilled ? Math.round(planned / 5) : 0;

            let cellBg = 'bg-slate-50/70 hover:bg-slate-100/80 dark:bg-slate-800/40 dark:hover:bg-slate-800/80 border-slate-200/60 dark:border-slate-700/60';
            let badgeStatus = '<span class="text-slate-400 text-[10px] font-normal">Kosong</span>';

            if (isHoliday) {
                cellBg = 'bg-amber-100/70 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-950/60 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200';
                const hName = escapeHTML(holidayInfo?.title || holidayInfo?.name || 'Libur Resmi');
                badgeStatus = `<span class="text-amber-800 dark:text-amber-200 font-bold text-[9px] truncate" title="${hName}">🏖️ Libur</span>`;
            } else if (isFilled) {
                if (avgDayPlanned >= 450) {
                    cellBg = 'bg-emerald-50/60 hover:bg-emerald-100/70 border-emerald-200/80 dark:bg-emerald-950/20 dark:border-emerald-800/50 dark:hover:bg-emerald-950/40';
                    badgeStatus = `<span class="text-emerald-700 dark:text-emerald-300 font-bold text-[10px]">${avgDayPlanned}m</span>`;
                } else {
                    cellBg = 'bg-amber-50/60 hover:bg-amber-100/70 border-amber-200/80 dark:bg-amber-950/20 dark:border-amber-800/50 dark:hover:bg-amber-950/40';
                    badgeStatus = `<span class="text-amber-700 dark:text-amber-300 font-bold text-[10px]">${avgDayPlanned}m</span>`;
                }
            }

            const dayTitle = isHoliday
                ? `Hari Libur: ${escapeHTML(holidayInfo?.title || holidayInfo?.name || 'Libur Resmi')} - ${dayNames[d]} (${dateFormatted})`
                : `Klik untuk supervisi ${dayNames[d]} (${dateFormatted}) - ${escapeHTML(t.teacher_name)}`;

            daysHtml += `
            <div onclick="window.monitoringOpenTeacherSupervisionDetail('${t.teacher_id}', ${d})" class="px-2 py-1.5 rounded-lg border ${cellBg} transition-all cursor-pointer flex flex-col sm:flex-row items-center justify-between sm:justify-center gap-0.5 sm:gap-1 text-center group" title="${dayTitle}">
                <span class="text-[9px] font-bold text-slate-500 dark:text-slate-400 group-hover:text-emerald-600 transition-colors lg:hidden">${dayNames[d].slice(0, 3)}</span>
                <span class="text-[10px] font-mono leading-tight">${badgeStatus}</span>
            </div>`;
        }

        html += `
        <div class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 hover:border-emerald-200 dark:hover:border-emerald-800/60 hover:shadow-2xs transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-2">
            <!-- Kolom Guru & Metrik Ringkas -->
            <div class="w-full lg:w-64 xl:w-72 shrink-0 flex items-center gap-2 min-w-0">
                ${(() => {
                    const isVip = typeof window.isPtkVip === 'function' ? window.isPtkVip(t.teacher_id) : false;
                    const rawAvatar = `
                        <div class="w-7 h-7 rounded-lg overflow-hidden bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center font-bold text-emerald-700 dark:text-emerald-300 text-[11px] shrink-0 relative select-none">
                            ${tPhoto ? `
                                <img src="${escapeHTML(tPhoto)}" alt="${escapeHTML(t.teacher_name || '')}" loading="lazy" class="w-full h-full object-cover" onerror="this.onerror=null; this.classList.add('hidden'); if(this.nextElementSibling) this.nextElementSibling.classList.remove('hidden');" />
                                <span class="hidden">${(t.teacher_name || '?')[0].toUpperCase()}</span>
                            ` : `
                                <span>${(t.teacher_name || '?')[0].toUpperCase()}</span>
                            `}
                        </div>
                    `;
                    return typeof window.wrapVipAvatarHtml === 'function' ? window.wrapVipAvatarHtml(rawAvatar, isVip, 'vip-avatar-sm') : rawAvatar;
                })()}
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                        <span onclick="window.monitoringOpenTeacherSupervisionDetail('${t.teacher_id}')" class="font-bold text-xs text-slate-800 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 cursor-pointer truncate" title="Supervisi ${escapeHTML(t.teacher_name)}">
                            ${escapeHTML(t.teacher_name || t.teacher_id)}
                        </span>
                        <span class="px-1.5 py-0.2 rounded text-[8px] font-bold shrink-0 ${st.cls}">${st.text}</span>
                    </div>
                    <div class="text-[10px] text-slate-400 flex items-center gap-2 truncate">
                        <span title="Target Rencana Mingguan">🎯 <strong class="font-mono text-slate-600 dark:text-slate-300">${planned.toLocaleString('id-ID')}m</strong></span>
                        <span title="Pemenuhan Realisasi Terlaksana (Target 2.250m)">⚡ <strong class="font-mono text-emerald-600">${actual.toLocaleString('id-ID')}m</strong> <span class="text-[9px] font-bold font-mono ${pct >= 90 ? 'text-emerald-600' : (pct >= 60 ? 'text-blue-600' : 'text-slate-500')}">(${pct}%)</span></span>
                        <span title="Jam Mengajar KBM">📖 <strong class="text-purple-600">${teachingJP} JP</strong></span>
                    </div>
                </div>
            </div>

            <!-- Grid 5 Hari -->
            <div class="flex-1 grid grid-cols-5 gap-1.5">
                ${daysHtml}
            </div>

            <!-- Tombol Aksi Detail -->
            <div class="w-full lg:w-16 shrink-0 flex items-center justify-end">
                <button type="button" onclick="window.monitoringOpenTeacherSupervisionDetail('${t.teacher_id}')" class="h-6.5 px-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40 text-[10px] font-bold transition-all flex items-center gap-1 active:scale-95 cursor-pointer shrink-0" title="Buka Detail Supervisi">
                    <i class="fa-solid fa-chart-gantt text-[10px]"></i> <span class="hidden sm:inline">Detail</span>
                </button>
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

function openTeacherSupervisionDetail(teacherId, targetDayIndex = null) {
    if (!teacherId) return;
    _detailTeacherId = teacherId;
    if (targetDayIndex !== null && targetDayIndex >= 0 && targetDayIndex < 5) {
        _detailFocusDayIndex = targetDayIndex;
        _detailViewMode = 'focus';
    }
    switchMonitoringViewMode('detail');
}

function backToOverview() {
    switchMonitoringViewMode('table');
}

function navDetailTeacher(dir) {
    const list = _filteredData.length > 0 ? _filteredData : _summaryData;
    if (list.length === 0) return;
    const currentIdx = list.findIndex(t => t.teacher_id === _detailTeacherId);
    let nextIdx = (currentIdx === -1 ? 0 : currentIdx + dir);
    if (nextIdx < 0) nextIdx = list.length - 1;
    if (nextIdx >= list.length) nextIdx = 0;
    _detailTeacherId = list[nextIdx].teacher_id;
    loadAndRenderTeacherDetail(_detailTeacherId);
}

function onSelectTeacherChange(teacherId) {
    if (!teacherId) return;
    _detailTeacherId = teacherId;
    loadAndRenderTeacherDetail(_detailTeacherId);
}

function toggleDetailView(mode) {
    _detailViewMode = mode;
    const btnGantt = el('btn-mon-detail-gantt');
    const btnFocus = el('btn-mon-detail-focus');
    const ganttContainer = el('mon-detail-gantt-container');
    const focusContainer = el('mon-detail-focus-container');

    const activeCls = 'px-2 py-1 rounded-md text-[11px] font-bold transition-all flex items-center gap-1 bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-2xs cursor-pointer';
    const inactiveCls = 'px-2 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white cursor-pointer';

    if (btnGantt) btnGantt.className = mode === 'matrix' ? activeCls : inactiveCls;
    if (btnFocus) btnFocus.className = mode === 'focus' ? activeCls : inactiveCls;

    if (ganttContainer) ganttContainer.classList.toggle('hidden', mode !== 'matrix');
    if (focusContainer) focusContainer.classList.toggle('hidden', mode !== 'focus');

    if (mode === 'matrix') {
        renderTeacherGanttView();
    } else {
        renderTeacherFocusView();
    }
}

function setFocusDay(dayIndex) {
    _detailFocusDayIndex = dayIndex;
    renderTeacherFocusView();
}

function renderTeacherDetailAvatar(avatarEl, teacher) {
    if (!avatarEl) return;
    const name = teacher.teacher_name || teacher.name || '?';
    const initial = (name || '?')[0].toUpperCase();
    const rawPhoto = teacher.foto || teacher.photo_url || teacher.teacher_foto || '';
    const photoUrl = rawPhoto ? (typeof resolvePhotoUrl === 'function' ? resolvePhotoUrl(rawPhoto) : rawPhoto) : '';

    avatarEl.className = 'w-10 h-10 rounded-xl overflow-hidden bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center font-extrabold text-emerald-700 dark:text-emerald-300 text-sm shrink-0 select-none shadow-2xs relative';

    if (photoUrl) {
        avatarEl.innerHTML = `
            <img src="${escapeHTML(photoUrl)}" alt="${escapeHTML(name)}" loading="lazy"
                class="w-full h-full object-cover"
                onerror="this.onerror=null; this.classList.add('hidden'); if(this.nextElementSibling) this.nextElementSibling.classList.remove('hidden');" />
            <span class="hidden">${initial}</span>
        `;
    } else {
        avatarEl.innerHTML = `<span>${initial}</span>`;
    }

    const tId = teacher.teacher_id || teacher.id;
    const isVip = typeof window.isPtkVip === 'function' ? window.isPtkVip(tId) : false;
    if (typeof window.applyVipBadgeToAvatarContainer === 'function') {
        window.applyVipBadgeToAvatarContainer(avatarEl, isVip);
    }
}

async function loadAndRenderTeacherDetail(teacherId) {
    const list = _filteredData.length > 0 ? _filteredData : _summaryData;
    const teacher = list.find(t => t.teacher_id === teacherId) || _summaryData.find(t => t.teacher_id === teacherId) || { teacher_id: teacherId, teacher_name: teacherId };

    // Update Dropdown Guru
    const selEl = el('mon-detail-teacher-select');
    if (selEl) {
        selEl.innerHTML = list.map(t =>
            `<option value="${t.teacher_id}" ${t.teacher_id === teacherId ? 'selected' : ''}>${escapeHTML(t.teacher_name || t.teacher_id)}</option>`
        ).join('');
    }

    // Header Profile
    const avatarEl = el('mon-detail-avatar');
    if (avatarEl) {
        renderTeacherDetailAvatar(avatarEl, teacher);
    }

    const nameEl = el('mon-detail-teacher-name');
    if (nameEl) nameEl.textContent = teacher.teacher_name || teacherId;

    const subtextEl = el('mon-detail-teacher-subtext');
    if (subtextEl) subtextEl.textContent = `${teacher.jenis_ptk || 'Guru'} · ${teacher.nip || teacher.nuptk || 'NIP -'}`;

    // Status Rencana Badge
    const planBadgeEl = el('mon-detail-plan-badge');
    const statusMap = {
        'draft': { text: 'Draft Rencana', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
        'submitted': { text: 'Menunggu Persetujuan', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' },
        'approved': { text: 'Disetujui', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' },
        'needs_revision': { text: 'Perlu Revisi', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' }
    };
    const st = statusMap[teacher.plan_status] || { text: 'Belum Ada Rencana', cls: 'bg-slate-100 text-slate-400 dark:bg-slate-800' };
    if (planBadgeEl) {
        planBadgeEl.textContent = st.text;
        planBadgeEl.className = `px-2 py-0.5 rounded-md text-[10px] font-bold ${st.cls}`;
    }

    // Policy Badge
    const policyBadgeEl = el('mon-detail-policy-badge');
    const planReq = _policy?.require_plan_approval !== 0;
    if (policyBadgeEl) {
        if (!planReq) {
            policyBadgeEl.textContent = '⚡ Mode Mandiri (Otomatis Sah)';
            policyBadgeEl.className = 'text-[10px] px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 font-bold';
        } else {
            policyBadgeEl.textContent = '📋 Persetujuan Formal Kepsek';
            policyBadgeEl.className = 'text-[10px] px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800 font-bold';
        }
    }

    // Mini KPI Awal
    const statPlanned = el('mon-detail-stat-planned');
    if (statPlanned) statPlanned.textContent = `${(teacher.planned_minutes || 0).toLocaleString('id-ID')}m`;
    const statActual = el('mon-detail-stat-actual');
    if (statActual) statActual.textContent = `${(teacher.actual_minutes || 0).toLocaleString('id-ID')}m`;
    const statTeaching = el('mon-detail-stat-teaching');
    if (statTeaching) statTeaching.textContent = `${teacher.teaching_jp || 0} JP`;
    const statPct = el('mon-detail-stat-pct');
    const effTarget = getMonitoringEffectiveTarget();
    // Standar 37,5 jam: Math.round((teacher.actual_minutes || 0) / 2250 * 100)
    if (statPct) statPct.textContent = `${Math.min(100, Math.round((teacher.actual_minutes || 0) / effTarget * 100))}%`;

    // Tombol Aksi Persetujuan Rencana
    const approvalActionsEl = el('mon-detail-approval-actions');
    if (approvalActionsEl) {
        if (planReq && teacher.plan_status === 'submitted') {
            approvalActionsEl.classList.remove('hidden');
        } else {
            approvalActionsEl.classList.add('hidden');
        }
    }

    // Tampilkan loading placeholder di kontainer
    const ganttGrid = el('mon-gantt-matrix-grid');
    if (ganttGrid) ganttGrid.innerHTML = '<div class="text-center py-10 text-slate-400 text-xs"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat matriks beban kerja...</div>';
    const focusList = el('mon-focus-cards-list');
    if (focusList) focusList.innerHTML = '<div class="text-center py-10 text-slate-400 text-xs"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat kegiatan harian...</div>';

    // Fetch data pekan kerja guru
    try {
        const weekRes = await cfGetWorkloadWeek(teacherId, _weekStart);
        _detailWeekData = weekRes?.data || null;

        const photoFromWeek = _detailWeekData?.week?.teacher_foto || _detailWeekData?.teacher_foto;
        if (avatarEl && photoFromWeek && !teacher.foto) {
            renderTeacherDetailAvatar(avatarEl, { ...teacher, foto: photoFromWeek });
        }

        if (_detailWeekData?.summary) {
            const s = _detailWeekData.summary;
            if (statPlanned) statPlanned.textContent = `${(s.planned_minutes || 0).toLocaleString('id-ID')}m`;
            if (statActual) statActual.textContent = `${(s.actual_minutes || 0).toLocaleString('id-ID')}m`;
            let teachingJp = s.teaching_jp;
            if (teachingJp == null || teachingJp === 0) {
                const segs = _detailWeekData?.segments || [];
                teachingJp = segs
                    .filter(sg => sg.is_teaching === 1 || sg.is_teaching === true || sg.catalog_id === 'cat_kbm' || sg.category_code === 'PELAKSANAAN_KBM')
                    .reduce((sum, sg) => sum + (Number(sg.jp_count) || Math.round(Number(sg.planned_minutes || 45) / 45) || 1), 0);
            }
            if (statTeaching) statTeaching.textContent = `${teachingJp || 0} JP`;
            // Standar 37,5 jam: Math.round((s.actual_minutes || 0) / 2250 * 100)
            if (statPct) statPct.textContent = `${Math.min(100, Math.round((s.actual_minutes || 0) / effTarget * 100))}%`;

            if (teacher) {
                if (s.actual_minutes !== undefined) teacher.actual_minutes = s.actual_minutes;
                if (s.planned_minutes !== undefined) teacher.planned_minutes = s.planned_minutes;
                if (teachingJp !== undefined) teacher.teaching_jp = teachingJp;
            }
        }

        const realPlanStatus = _detailWeekData?.week?.plan_status || teacher.plan_status;
        if (planBadgeEl) {
            const realSt = statusMap[realPlanStatus] || { text: 'Belum Ada', cls: 'bg-slate-100 text-slate-400' };
            planBadgeEl.textContent = realSt.text;
            planBadgeEl.className = `px-2 py-0.5 rounded-md text-[10px] font-bold ${realSt.cls}`;
        }
        if (approvalActionsEl) {
            if (planReq && realPlanStatus === 'submitted') {
                approvalActionsEl.classList.remove('hidden');
            } else {
                approvalActionsEl.classList.add('hidden');
            }
        }

        toggleDetailView(_detailViewMode);
    } catch (e) {
        console.warn('[Monitoring Detail] Error fetching week:', e.message);
        if (ganttGrid) ganttGrid.innerHTML = `<div class="p-6 text-center text-rose-500 text-xs"><i class="fa-solid fa-circle-exclamation mr-1"></i>Gagal memuat detail pekan guru: ${escapeHTML(e.message)}</div>`;
        if (focusList) focusList.innerHTML = `<div class="p-6 text-center text-rose-500 text-xs"><i class="fa-solid fa-circle-exclamation mr-1"></i>Gagal memuat kegiatan: ${escapeHTML(e.message)}</div>`;
    }
}

function renderTeacherGanttView() {
    const rulerEl = el('mon-gantt-time-ruler');
    const gridEl = el('mon-gantt-matrix-grid');
    if (!gridEl) return;

    // Render Time Ruler (07:30 s.d. 15:30)
    if (rulerEl) {
        let rulerHtml = '<div class="w-24 sm:w-28 shrink-0 text-right pr-3 font-semibold text-[10px]">Waktu</div><div class="flex-1 relative h-4">';
        for (let m = GANTT_START; m <= GANTT_END; m += 60) {
            const pct = ((m - GANTT_START) / GANTT_TOTAL) * 100;
            const timeStr = minutesToTimeString(m);
            rulerHtml += `<div class="absolute -translate-x-1/2" style="left:${pct}%">${timeStr}</div>`;
        }
        rulerHtml += '</div>';
        rulerEl.innerHTML = rulerHtml;
    }

    const segments = _detailWeekData?.segments || [];
    const logs = _detailWeekData?.logs || [];
    const planLinks = _detailWeekData?.plan_links || [];
    const dayNames = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
    let gridHtml = '';

    for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
        const d = new Date(_weekStart);
        d.setDate(d.getDate() + dayIdx);
        const dayDateStr = d.toISOString().slice(0, 10);
        const dayFormatted = `${d.getDate()} ${INDO_MONTHS_SHORT[d.getMonth()] || ''}`;

        const daySegs = segments.filter(s => s.day_of_week === (dayIdx + 1));
        const dayLogs = logs.filter(l => l.date === dayDateStr);

        const dayPlanned = daySegs.reduce((sum, s) => sum + (s.planned_minutes || 0), 0);

        const dayTimeline = calculateDayTimelineSlots(dayDateStr, daySegs, { policy: _policy, canEdit: false });
        const slots = Array.isArray(dayTimeline?.slots) ? dayTimeline.slots : (Array.isArray(dayTimeline) ? dayTimeline : []);

        let slotsHtml = '';
        slots.forEach(slot => {
            const startMins = slot.startMin !== undefined
                ? slot.startMin
                : (slot.startMinutes !== undefined ? slot.startMinutes : (slot.startTime ? timeStringToMinutes(slot.startTime) : GANTT_START));
            const dur = slot.durationMinutes || (slot.endMin !== undefined && slot.startMin !== undefined ? Math.max(0, slot.endMin - slot.startMin) : 0);
            const leftPct = Math.max(0, Math.min(100, ((startMins - GANTT_START) / GANTT_TOTAL) * 100));
            const widthPct = Math.max(1, Math.min(100 - leftPct, (dur / GANTT_TOTAL) * 100));

            if (slot.type === 'break') {
                const breakTitle = slot.name || slot.title || 'Istirahat';
                slotsHtml += `
                <div class="absolute top-1 bottom-1 rounded-lg bg-slate-200/80 dark:bg-slate-700/60 border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 text-[9px] flex items-center justify-center select-none overflow-hidden" style="left:${leftPct}%; width:${widthPct}%" title="${escapeHTML(breakTitle)} (${slot.startTime}–${slot.endTime})">
                    <span class="truncate px-0.5">☕ ${dur}m</span>
                </div>`;
            } else if (slot.type === 'empty' || slot.type === 'empty_slot') {
                slotsHtml += `
                <div class="absolute top-1 bottom-1 rounded-lg bg-rose-50/70 dark:bg-rose-950/20 border border-dashed border-rose-300 dark:border-rose-800/60 text-rose-500 dark:text-rose-400 text-[9px] flex items-center justify-center select-none overflow-hidden" style="left:${leftPct}%; width:${widthPct}%" title="Slot Jam Kosong: ${slot.startTime}–${slot.endTime} (${dur}m)">
                    <span class="truncate px-0.5">⚠️ ${dur}m</span>
                </div>`;
            } else if (slot.type === 'holiday' || dayTimeline?.isHoliday) {
                const holidayTitle = slot.title || dayTimeline?.holidaySegment?.activity_title || 'Libur Resmi Sekolah';
                slotsHtml += `
                <div class="absolute top-1 bottom-1 rounded-lg bg-amber-100 dark:bg-amber-950/40 border border-amber-300 text-amber-800 dark:text-amber-300 text-[10px] font-bold flex items-center justify-center select-none" style="left:0%; width:100%" title="${escapeHTML(holidayTitle)}">
                    <span>🎉 ${escapeHTML(holidayTitle)}</span>
                </div>`;
            } else {
                // Activity
                const seg = slot.segment;
                const isTeaching = seg?.is_teaching === 1 || seg?.is_teaching === true;
                const isStudyDay = isStudyDayCompliantActivity(seg?.catalog_id || '', seg?.activity_title || '');

                const slotTitle = slot.title || seg?.activity_title || seg?.title || 'Kegiatan';
                const segId = seg?.activity_id || seg?.id;
                let matchingLog = null;
                if (segId && planLinks.length > 0) {
                    matchingLog = dayLogs.find(l => planLinks.some(pl => pl.plan_activity_id === segId && pl.work_log_id === l.id));
                }
                if (!matchingLog) {
                    matchingLog = dayLogs.find(l => l.title === slotTitle || (seg?.catalog_id && l.catalog_id === seg.catalog_id));
                }
                const isRealized = !!matchingLog;

                let blockBg = '';
                let statusBadge = '';
                let statusIcon = '';

                if (isRealized) {
                    let baseColor = 'bg-emerald-600 hover:bg-emerald-700 border-emerald-700 text-white';
                    if (isTeaching) {
                        baseColor = 'bg-blue-600 hover:bg-blue-700 border-blue-700 text-white';
                    } else if (isStudyDay) {
                        baseColor = 'bg-purple-600 hover:bg-purple-700 border-purple-700 text-white';
                    }
                    blockBg = `${baseColor} border shadow-xs`;
                    const logSegs = _detailWeekData?.log_segments || [];
                    const mLogSegs = logSegs.filter(ls => ls.work_log_id === matchingLog.id);
                    const mDur = mLogSegs.reduce((sum, ls) => sum + (Number(ls.actual_minutes) || 0), 0)
                        || matchingLog.actual_minutes
                        || (matchingLog.status_execution === 'tidak_terlaksana' ? 0 : dur);
                    statusIcon = `<i class="fa-solid fa-circle-check text-emerald-200 text-[9px] shrink-0" title="Terealisasi: ${mDur}m"></i>`;
                    statusBadge = '<span class="text-[7.5px] px-1 py-0.2 rounded bg-black/25 text-emerald-100 font-bold leading-none shrink-0">Terealisasi</span>';
                } else {
                    blockBg = 'bg-amber-50/90 hover:bg-amber-100/90 text-amber-950 dark:bg-amber-950/35 dark:hover:bg-amber-900/40 dark:text-amber-200 border-2 border-dashed border-amber-400 dark:border-amber-600/80 border-l-[4px] border-l-amber-500 shadow-2xs';
                    statusIcon = '<i class="fa-regular fa-clock text-amber-600 dark:text-amber-400 text-[9px] shrink-0" title="Belum Terealisasi"></i>';
                    statusBadge = '<span class="text-[7.5px] px-1 py-0.2 rounded bg-amber-200/80 dark:bg-amber-900/70 text-amber-900 dark:text-amber-300 font-bold border border-amber-300/80 dark:border-amber-700/80 leading-none shrink-0">Belum Realisasi</span>';
                }

                slotsHtml += `
                <div onclick="window.monitoringOpenTeacherSupervisionDetail('${_detailTeacherId}', ${dayIdx})" class="absolute top-1 bottom-1 rounded-lg ${blockBg} p-1 text-[10px] leading-tight font-medium cursor-pointer transition-all overflow-hidden flex flex-col justify-between group" style="left:${leftPct}%; width:${widthPct}%" title="${escapeHTML(slotTitle)} (${slot.startTime}–${slot.endTime}, ${dur} menit) - ${isRealized ? 'SUDAH TEREALISASI' : 'BELUM TEREALISASI'}">
                    <div class="truncate font-bold flex items-center justify-between gap-1">
                        <span class="truncate flex items-center gap-1">
                            ${!isRealized ? `<span class="inline-block w-1.5 h-1.5 rounded-full shrink-0 ${isTeaching ? 'bg-blue-500' : (isStudyDay ? 'bg-purple-500' : 'bg-emerald-500')}" title="${isTeaching ? 'KBM' : (isStudyDay ? 'HBG' : 'Umum')}"></span>` : ''}
                            <span class="truncate">${escapeHTML(slotTitle)}</span>
                        </span>
                        ${statusIcon}
                    </div>
                    <div class="text-[9px] opacity-85 flex items-center justify-between gap-1">
                        <span>${slot.startTime} · ${dur}m</span>
                        ${statusBadge}
                    </div>
                </div>`;
            }
        });

        gridHtml += `
        <div class="p-2 sm:p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-2xs flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
            <div class="w-full sm:w-28 shrink-0 flex sm:flex-col items-center sm:items-start justify-between sm:justify-center border-b sm:border-b-0 sm:border-r border-slate-100 dark:border-slate-800 pb-1 sm:pb-0 sm:pr-2">
                <div class="flex items-center gap-1.5">
                    <span class="font-extrabold text-xs text-slate-800 dark:text-white">${dayNames[dayIdx]}</span>
                    <span class="text-[10px] text-slate-400">${dayFormatted}</span>
                </div>
                <div class="flex items-center gap-2 text-[10px] mt-0.5">
                    <span class="font-bold ${dayPlanned >= 450 ? 'text-emerald-600' : 'text-slate-500'} font-mono">${dayPlanned}/450m</span>
                    <button type="button" onclick="window.monitoringOpenTeacherSupervisionDetail('${_detailTeacherId}', ${dayIdx})" class="text-emerald-600 hover:underline text-[9px] font-bold" title="Lihat detail hari ${dayNames[dayIdx]}">Fokus</button>
                </div>
            </div>

            <!-- Track Gantt 07:30 - 15:30 -->
            <div class="flex-1 relative h-12 bg-slate-100/70 dark:bg-slate-800/50 rounded-xl overflow-hidden border border-slate-200/50 dark:border-slate-700/50">
                ${slotsHtml || '<div class="text-center text-slate-400 text-xs py-3.5">— Tidak ada jadwal —</div>'}
            </div>
        </div>`;
    }

    gridEl.innerHTML = gridHtml;
}

function renderTeacherFocusView() {
    const tabsEl = el('mon-focus-day-tabs');
    const cardsEl = el('mon-focus-cards-list');
    if (!tabsEl || !cardsEl) return;

    const dayNames = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
    const segments = _detailWeekData?.segments || [];
    const logs = _detailWeekData?.logs || [];
    const logSegments = _detailWeekData?.log_segments || [];
    const planLinks = _detailWeekData?.plan_links || [];

    // Render 5 Tab Hari
    let tabsHtml = '';
    for (let i = 0; i < 5; i++) {
        const d = new Date(_weekStart);
        d.setDate(d.getDate() + i);
        const dayDateStr = d.toISOString().slice(0, 10);
        const dayFormatted = `${d.getDate()} ${INDO_MONTHS_SHORT[d.getMonth()] || ''}`;

        const daySegs = segments.filter(s => s.day_of_week === (i + 1));
        const dayPlanned = daySegs.reduce((sum, s) => sum + (s.planned_minutes || 0), 0);

        const isActive = i === _detailFocusDayIndex;
        const activeCls = 'bg-emerald-600 text-white shadow-xs font-bold';
        const inactiveCls = 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 font-semibold';

        tabsHtml += `
        <button type="button" onclick="window.monitoringSetFocusDay(${i})" class="px-3 py-1.5 rounded-xl text-xs transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${isActive ? activeCls : inactiveCls}">
            <span>${dayNames[i]}</span>
            <span class="text-[10px] opacity-75">(${dayFormatted})</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded-md ${isActive ? 'bg-black/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'} font-mono">${dayPlanned}m</span>
        </button>`;
    }
    tabsEl.innerHTML = tabsHtml;

    // Render Kartu Kegiatan Hari Terpilih
    const targetD = new Date(_weekStart);
    targetD.setDate(targetD.getDate() + _detailFocusDayIndex);
    const targetDateStr = targetD.toISOString().slice(0, 10);

    const focusSegs = segments.filter(s => s.day_of_week === (_detailFocusDayIndex + 1)).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    const focusLogs = logs.filter(l => l.date === targetDateStr);

    if (focusSegs.length === 0) {
        cardsEl.innerHTML = `
        <div class="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 text-slate-400 text-xs">
            <i class="fa-regular fa-calendar-xmark text-2xl mb-2 text-slate-300"></i>
            <p>Tidak ada kegiatan terencana pada hari ${dayNames[_detailFocusDayIndex]}.</p>
        </div>`;
        return;
    }

    let cardsHtml = '';
    focusSegs.forEach(s => {
        const isTeaching = s.is_teaching === 1 || s.is_teaching === true;
        const isStudyDay = isStudyDayCompliantActivity(s.catalog_id || '', s.activity_title || '');

        const segId = s.activity_id || s.id;
        let matchingLog = null;
        if (segId && planLinks.length > 0) {
            matchingLog = focusLogs.find(l => planLinks.some(pl => pl.plan_activity_id === segId && pl.work_log_id === l.id));
        }
        if (!matchingLog) {
            matchingLog = focusLogs.find(l => l.title === s.activity_title || (s.catalog_id && l.catalog_id === s.catalog_id));
        }
        const isRealized = !!matchingLog;

        let dutyBadge = '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Kegiatan Umum</span>';
        if (isTeaching) {
            dutyBadge = '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">KBM Tatap Muka</span>';
        } else if (isStudyDay) {
            dutyBadge = '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">Hari Belajar Guru</span>';
        }

        let realisasiSection = '';
        if (matchingLog) {
            const safeEv = matchingLog.evidence_url ? sanitizeUrl(matchingLog.evidence_url) : '';
            const isVerified = matchingLog.verification_status === 'verified';
            const logReq = _policy?.require_log_verification !== 0;

            // Hitung durasi aktual riil dari work_log_segments, fallback ke matchingLog.actual_minutes atau rencana
            const matchingLogSegs = logSegments.filter(ls => ls.work_log_id === matchingLog.id);
            let actualLogDuration = matchingLogSegs.reduce((sum, ls) => sum + (Number(ls.actual_minutes) || 0), 0);
            if (!actualLogDuration && matchingLog.actual_minutes != null && matchingLog.actual_minutes > 0) {
                actualLogDuration = Number(matchingLog.actual_minutes);
            }
            if (!actualLogDuration && matchingLog.status_execution !== 'tidak_terlaksana' && matchingLog.status_execution !== 'draft') {
                actualLogDuration = Number(s.planned_minutes || s.duration_minutes || 0);
            }

            let logTimeRangeHtml = '';
            if (matchingLogSegs.length > 0 && matchingLogSegs[0].start_time && matchingLogSegs[matchingLogSegs.length - 1].end_time) {
                logTimeRangeHtml = `<span class="text-[11px] text-slate-400 font-mono">(${matchingLogSegs[0].start_time} - ${matchingLogSegs[matchingLogSegs.length - 1].end_time})</span>`;
            }

            let verifyActionHtml = '';
            if (!logReq) {
                verifyActionHtml = '<span class="px-2.5 py-1 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-bold text-xs flex items-center gap-1"><i class="fa-solid fa-bolt"></i> Terverifikasi Otomatis (Mandiri)</span>';
            } else if (isVerified) {
                verifyActionHtml = '<span class="px-2.5 py-1 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-bold text-xs flex items-center gap-1"><i class="fa-solid fa-circle-check"></i> Terverifikasi oleh Kepsek</span>';
            } else {
                verifyActionHtml = `
                <div class="flex items-center gap-1.5">
                    <button type="button" onclick="window.monitoringQuickVerifySingleLog('${matchingLog.id}', 'verified')" class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-all flex items-center gap-1 active:scale-95 cursor-pointer">
                        <i class="fa-solid fa-check"></i> <span>Verifikasi</span>
                    </button>
                    <button type="button" onclick="window.monitoringQuickVerifySingleLog('${matchingLog.id}', 'rejected')" class="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800 font-bold text-xs transition-all flex items-center gap-1 active:scale-95 cursor-pointer">
                        <i class="fa-solid fa-xmark"></i> <span>Tolak</span>
                    </button>
                </div>`;
            }

            realisasiSection = `
            <div class="mt-2.5 pt-2.5 border-t border-emerald-200/50 dark:border-emerald-800/40 space-y-2">
                <div class="flex items-center justify-between flex-wrap gap-2 text-xs">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                            <i class="fa-solid fa-clock-rotate-left text-emerald-600"></i> Laporan Realisasi:
                        </span>
                        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${matchingLog.status_execution === 'terlaksana' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}">
                            ${escapeHTML(matchingLog.status_execution || 'terlaksana')}
                        </span>
                        <span class="font-mono font-bold text-slate-700 dark:text-slate-300">${actualLogDuration} menit</span>
                        ${logTimeRangeHtml}
                    </div>
                    <div>
                        ${verifyActionHtml}
                    </div>
                </div>

                ${matchingLog.output_summary ? `
                <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 text-xs">
                    <strong class="block text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Uraian / Ringkasan Hasil:</strong>
                    <p class="leading-relaxed whitespace-pre-line">${escapeHTML(matchingLog.output_summary)}</p>
                </div>` : ''}

                ${matchingLog.obstacle_notes ? `
                <div class="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 text-xs border border-amber-200 dark:border-amber-800/50">
                    <strong class="block text-[10px] text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-0.5">Catatan Kendala:</strong>
                    <p class="leading-relaxed whitespace-pre-line">${escapeHTML(matchingLog.obstacle_notes)}</p>
                </div>` : ''}

                ${safeEv ? `
                <div>
                    <a href="${escapeHTML(safeEv)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/40 text-xs font-bold transition-all border border-blue-200 dark:border-blue-800">
                        <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                        <span>Buka Bukti Dukung (Google Drive / Foto)</span>
                    </a>
                </div>` : ''}
            </div>`;
        } else {
            realisasiSection = `
            <div class="mt-2.5 pt-2.5 border-t border-amber-200/50 dark:border-amber-800/40 text-[11px] text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2 flex-wrap">
                <span class="flex items-center gap-1.5 font-medium">
                    <i class="fa-solid fa-triangle-exclamation text-amber-500"></i> Rencana kegiatan belum dilaporkan realisasinya oleh guru yang bersangkutan.
                </span>
                <span class="text-[10px] px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 font-bold border border-amber-300/60">
                    Menunggu Laporan
                </span>
            </div>`;
        }

        const cardBorderCls = isRealized
            ? 'border border-emerald-300 dark:border-emerald-800/60 bg-emerald-50/15 dark:bg-emerald-950/10 border-l-[5px] border-l-emerald-500 shadow-xs'
            : 'border-2 border-dashed border-amber-300 dark:border-amber-700/60 bg-amber-50/20 dark:bg-amber-950/10 border-l-[5px] border-l-amber-500 shadow-2xs';

        const realizationStatusPill = isRealized
            ? '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 flex items-center gap-1 shrink-0"><i class="fa-solid fa-circle-check"></i> Sudah Terealisasi</span>'
            : '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 flex items-center gap-1 shrink-0 border border-amber-300/80 dark:border-amber-700/80"><i class="fa-regular fa-clock"></i> Belum Terealisasi</span>';

        cardsHtml += `
        <div class="p-3.5 rounded-2xl bg-white dark:bg-slate-900 ${cardBorderCls} space-y-2">
            <div class="flex items-start justify-between gap-3">
                <div>
                    <div class="flex items-center gap-2 flex-wrap mb-1">
                        <span class="font-mono text-xs font-bold text-slate-800 dark:text-white px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800">
                            ${s.start_time} – ${s.end_time}
                        </span>
                        <span class="text-xs font-mono text-slate-500 font-semibold">${s.planned_minutes || 0} menit</span>
                        ${dutyBadge}
                    </div>
                    <h4 class="font-bold text-sm text-slate-800 dark:text-white">${escapeHTML(s.activity_title || 'Kegiatan')}</h4>
                </div>
                <div>
                    ${realizationStatusPill}
                </div>
            </div>
            ${realisasiSection}
        </div>`;
    });

    cardsEl.innerHTML = cardsHtml;
}

async function quickApprovePlan() {
    const week = _detailWeekData?.week;
    const version = _detailWeekData?.active_version;
    if (!week?.id || !version?.id) {
        showToast('Data rencana tidak lengkap untuk disetujui', 'error');
        return;
    }

    const teacher = _summaryData.find(t => t.teacher_id === _detailTeacherId);
    const teacherName = teacher?.teacher_name || _detailTeacherId;

    const ok = await askConfirm(
        `Setujui rencana beban kerja mingguan untuk ${teacherName}?`,
        'Persetujuan Rencana',
        'info',
        { confirmText: 'Setujui Rencana' }
    );
    if (!ok) return;

    try {
        await cfReviewWorkloadPlan({
            work_week_id: week.id,
            plan_version_id: version.id,
            decision: 'approved',
            review_notes: 'Disetujui oleh Kepala Sekolah',
            revision_reason: '',
            revision_lock: version.revision_lock || 0
        });
        showToast(`Rencana mingguan ${teacherName} berhasil disetujui!`);
        await loadSummary();
        await loadAndRenderTeacherDetail(_detailTeacherId);
    } catch (e) {
        showToast(e.message || 'Gagal menyetujui rencana', 'error');
    }
}

function openRevisionModal() {
    if (!_detailTeacherId) return;
    openReviewPlan(_detailTeacherId);
    const decisionEl = el('review-plan-decision');
    if (decisionEl) decisionEl.value = 'needs_revision';
}

async function quickVerifySingleLog(logId, decision) {
    if (!logId) return;
    try {
        await cfReviewWorkloadLogs({
            log_ids: [logId],
            decision: decision,
            review_notes: decision === 'verified' ? 'Diverifikasi langsung oleh Kepala Sekolah' : 'Ditolak oleh Kepala Sekolah'
        });
        showToast(decision === 'verified' ? 'Log realisasi berhasil diverifikasi' : 'Log realisasi ditolak');
        await loadSummary();
        if (_detailTeacherId) {
            await loadAndRenderTeacherDetail(_detailTeacherId);
        }
    } catch (e) {
        showToast(e.message || 'Gagal memproses verifikasi log', 'error');
    }
}

// ========== BULK VERIFY ==========
async function bulkVerify() {
    if (_selectedTeacherIds.size === 0) {
        showToast('Pilih guru terlebih dahulu', 'error');
        return;
    }

    const ok = await askConfirm(
        `Apakah Anda yakin ingin memverifikasi semua log realisasi dari ${_selectedTeacherIds.size} guru terpilih sekaligus?`,
        'Verifikasi Massal',
        'warning',
        { confirmText: 'Verifikasi Semua' }
    );
    if (!ok) return;

    let successCount = 0;
    let errorCount = 0;

    for (const teacherId of _selectedTeacherIds) {
        try {
            const weekRes = await cfGetWorkloadWeek(teacherId, _weekStart);
            const logs = weekRes?.data?.logs || [];
            const unverified = logs.filter(l => l.verification_status === 'unverified');
            if (unverified.length > 0) {
                await cfReviewWorkloadLogs({
                    log_ids: unverified.map(l => l.id),
                    decision: 'verified',
                    review_notes: 'Verifikasi massal oleh Kepala Sekolah'
                });
                successCount += unverified.length;
            }
        } catch (e) {
            errorCount++;
            console.warn(`[Monitoring] Gagal verifikasi ${teacherId}:`, e.message);
        }
    }

    showToast(`Verifikasi massal: ${successCount} log berhasil${errorCount > 0 ? `, ${errorCount} guru gagal` : ''}`, errorCount > 0 ? 'warning' : 'success');
    await loadSummary();
}

// ========== EXPORT XLSX ==========
function exportXLSX() {
    try {
        const teachers = _summaryData || [];
        if (teachers.length === 0) {
            showToast('Peringatan', 'Tidak ada data beban kerja untuk diekspor.', 'warning');
            return;
        }

        const TARGET = getMonitoringEffectiveTarget();
        const statusMap = {
            'draft': 'Draft',
            'submitted': 'Menunggu Persetujuan',
            'approved': 'Disetujui',
            'needs_revision': 'Perlu Revisi'
        };

        const planReq = _policy?.require_plan_approval !== 0;
        const logReq = _policy?.require_log_verification !== 0;

        const dataRows = teachers.map((t, idx) => {
            const planned = t.planned_minutes || 0;
            const actual = t.actual_minutes || 0;
            const verified = t.verified_minutes || 0;
            const teachingJP = t.teaching_jp || 0;
            const eqJP = t.equivalent_jp || 0;
            const pct = Math.min(100, Math.round(actual / TARGET * 100));

            let statusRencana = statusMap[t.plan_status] || 'Belum Ada Rencana';
            if (!planReq && t.planned_minutes > 0) {
                statusRencana = 'Otomatis Sah (Mandiri)';
            }

            const row = {
                'No': idx + 1,
                'Nama Guru': t.teacher_name || t.teacher_id,
                'NIP / NUPTK': t.nip || t.nuptk || '-',
                'Jenis PTK': t.jenis_ptk || 'Guru Mapel',
                'Status Rencana': statusRencana,
                'Target (Menit)': TARGET,
                'Rencana (Menit)': planned,
                'Realisasi (Menit)': actual
            };
            if (logReq) {
                row['Terverifikasi (Menit)'] = verified;
            }
            row['KBM (JP)'] = teachingJP;
            row['JP Ekuivalen'] = eqJP;
            row['Pemenuhan Realisasi (%)'] = `${pct}%`;
            return row;
        });

        if (typeof window.XLSX !== 'undefined') {
            const ws = window.XLSX.utils.json_to_sheet(dataRows);
            ws['!cols'] = [
                { wch: 6 },
                { wch: 32 },
                { wch: 22 },
                { wch: 18 },
                { wch: 22 },
                { wch: 14 },
                { wch: 16 },
                { wch: 16 },
                { wch: 18 },
                { wch: 10 },
                { wch: 12 },
                { wch: 16 }
            ];

            const wb = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(wb, ws, 'Rekap Beban Kerja');
            const fileName = `Rekap_Beban_Kerja_${_weekStart}.xlsx`;
            window.XLSX.writeFile(wb, fileName);
            showToast('Berhasil', `Data beban kerja guru berhasil diekspor ke ${fileName}`, 'success');
        } else {
            // Fallback ke CSV jika library SheetJS belum termuat
            const url = cfGetWorkloadExportUrl(_weekStart);
            if (url) {
                window.open(url, '_blank');
            } else {
                showToast('Error', 'Pustaka Excel belum siap dan URL cadangan tidak ditemukan.', 'error');
            }
        }
    } catch (e) {
        console.error('[Workload Export XLSX] Error:', e);
        showToast('Error', 'Gagal mengekspor data: ' + e.message, 'error');
    }
}
const exportCSV = exportXLSX;

// ========== WORKLOAD POLICY MODAL ==========
function syncPolicyBadges(policy) {
    const planReq = policy?.require_plan_approval !== 0;
    const logReq = policy?.require_log_verification !== 0;

    let modeText = 'Wajib Kepsek';
    let modeCls = 'bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300';
    let headerText = 'Formal Kepsek';

    if (!planReq && !logReq) {
        modeText = 'Otomatis (Mandiri)';
        modeCls = 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300';
        headerText = 'Otomatis';
    } else if (!planReq || !logReq) {
        modeText = 'Hibrida';
        modeCls = 'bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300';
        headerText = 'Hibrida';
    }

    const toolbarBadge = el('badge-toolbar-policy-mode');
    if (toolbarBadge) {
        toolbarBadge.textContent = modeText;
        toolbarBadge.className = `ml-1 text-[10px] px-2 py-0.5 rounded-lg font-bold uppercase tracking-wider ${modeCls}`;
    }

    const headerBadge = el('badge-header-policy-mode');
    if (headerBadge) {
        headerBadge.textContent = headerText;
        headerBadge.className = 'ml-1 text-[9px] px-1.5 py-0.5 rounded-md font-extrabold tracking-wide bg-black/25 text-white border border-white/20';
    }

    // Kontrol visibilitas tombol Verifikasi Massal (#btn-mon-bulk-verify) dan kolom checklist
    // Jika verifikasi log otomatis/mandiri, tombol verifikasi massal & kolom checklist disembunyikan total!
    const btnBulkVerify = el('btn-mon-bulk-verify');
    if (btnBulkVerify) {
        btnBulkVerify.classList.toggle('hidden', !logReq);
    }

    const thCbSelectAll = el('th-cb-select-all');
    if (thCbSelectAll) {
        thCbSelectAll.classList.toggle('hidden', !logReq);
    }

    // Sinkronisasi opsi dropdown filter (Mode Otomatis vs Mode Formal)
    syncFilterStatusDropdown(planReq);
}

function syncFilterStatusDropdown(isManualApproval) {
    const sel = el('filter-plan-status');
    if (!sel) return;

    const currentVal = sel.value;
    const currentMode = sel.dataset.mode;
    const targetMode = isManualApproval ? 'manual' : 'auto';

    if (currentMode === targetMode) return;

    sel.dataset.mode = targetMode;

    if (isManualApproval) {
        // Mode Manual/Formal Pengawasan Kepala Sekolah (Filter Status Persetujuan)
        sel.innerHTML = `
            <option value="">Semua Status</option>
            <option value="submitted">Menunggu Persetujuan</option>
            <option value="approved">Disetujui</option>
            <option value="needs_revision">Perlu Revisi</option>
            <option value="draft">Draft</option>
            <option value="no_plan">Belum Ada Rencana</option>
        `;
        const validValues = ['', 'submitted', 'approved', 'needs_revision', 'draft', 'no_plan'];
        sel.value = validValues.includes(currentVal) ? currentVal : '';
    } else {
        // Mode Otomatis/Mandiri: Filter Evaluasi Pemenuhan Beban Kerja
        sel.innerHTML = `
            <option value="">Semua Guru</option>
            <option value="no_plan">Belum Ada Rencana</option>
            <option value="has_plan">Sudah Ada Rencana</option>
            <option value="target_not_met">Beban &lt; 37.5 Jam (Belum Terpenuhi)</option>
            <option value="target_met">Beban ≥ 37.5 Jam (Terpenuhi)</option>
        `;
        const validValues = ['', 'no_plan', 'has_plan', 'target_not_met', 'target_met'];
        sel.value = validValues.includes(currentVal) ? currentVal : '';
    }
}

function updatePolicyVisuals() {
    const cbPlan = el('policy-require-plan-approval');
    const cbLog = el('policy-require-log-verification');
    const planReq = cbPlan ? cbPlan.checked : true;
    const logReq = cbLog ? cbLog.checked : true;

    // 1. Badge & Styling Card Plan
    const badgePlan = el('policy-badge-plan-status');
    const cardPlan = el('card-policy-plan');
    if (badgePlan) {
        if (planReq) {
            badgePlan.textContent = 'Wajib Persetujuan Kepsek';
            badgePlan.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800';
        } else {
            badgePlan.textContent = 'Mode Mandiri (Otomatis Sah)';
            badgePlan.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800';
        }
    }
    if (cardPlan) {
        cardPlan.classList.toggle('border-blue-300', planReq);
        cardPlan.classList.toggle('border-emerald-300', !planReq);
    }

    // 2. Badge & Styling Card Log
    const badgeLog = el('policy-badge-log-status');
    const cardLog = el('card-policy-log');
    if (badgeLog) {
        if (logReq) {
            badgeLog.textContent = 'Wajib Verifikasi Kepsek';
            badgeLog.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800';
        } else {
            badgeLog.textContent = 'Mode Mandiri (Otomatis Terverifikasi)';
            badgeLog.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800';
        }
    }
    if (cardLog) {
        cardLog.classList.toggle('border-amber-300', logReq);
        cardLog.classList.toggle('border-emerald-300', !logReq);
    }

    // 3. Status text ringkas
    const flowModeText = el('policy-flow-mode-text');
    if (flowModeText) {
        if (!planReq && !logReq) {
            flowModeText.textContent = 'Mode Mandiri 100% (Bebas Antrean Acc)';
            flowModeText.className = 'text-[10px] font-bold text-emerald-600 dark:text-emerald-400';
        } else if (planReq && logReq) {
            flowModeText.textContent = 'Pengawasan Penuh Formal (Kepala Sekolah)';
            flowModeText.className = 'text-[10px] font-bold text-amber-600 dark:text-amber-400';
        } else {
            flowModeText.textContent = 'Mode Hibrida (Mandiri + Formal)';
            flowModeText.className = 'text-[10px] font-bold text-blue-600 dark:text-blue-400';
        }
    }

    // 4. Live Workflow Diagram Preview
    const flowPreview = el('policy-workflow-flow-preview');
    if (flowPreview) {
        const planStatusStep = planReq
            ? `<span class="px-2 py-1 rounded-lg bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-bold shrink-0 flex items-center gap-1 shadow-xs"><i class="fa-solid fa-hourglass-half text-[10px]"></i> Menunggu Kepsek</span>`
            : `<span class="px-2 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 font-bold shrink-0 flex items-center gap-1 shadow-xs"><i class="fa-solid fa-bolt text-[10px]"></i> Disetujui Otomatis</span>`;

        const logStatusStep = logReq
            ? `<span class="px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 font-bold shrink-0 flex items-center gap-1 shadow-xs"><i class="fa-solid fa-stamp text-[10px]"></i> Verifikasi Kepsek</span>`
            : `<span class="px-2 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 font-bold shrink-0 flex items-center gap-1 shadow-xs"><i class="fa-solid fa-bolt text-[10px]"></i> Terverifikasi Otomatis</span>`;

        flowPreview.innerHTML = `
            <div class="flex items-center gap-1.5 shrink-0">
                <span class="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold">1. Guru Buat Rencana</span>
                <i class="fa-solid fa-chevron-right text-[10px] text-slate-400"></i>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
                ${planStatusStep}
                <i class="fa-solid fa-chevron-right text-[10px] text-slate-400"></i>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
                <span class="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold">2. Guru Lapor Harian</span>
                <i class="fa-solid fa-chevron-right text-[10px] text-slate-400"></i>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
                ${logStatusStep}
            </div>
        `;
    }
}

function setPolicyPreset(presetType) {
    const cbPlan = el('policy-require-plan-approval');
    const cbLog = el('policy-require-log-verification');
    if (!cbPlan || !cbLog) return;

    if (presetType === 'mandiri') {
        cbPlan.checked = false;
        cbLog.checked = false;
    } else if (presetType === 'formal') {
        cbPlan.checked = true;
        cbLog.checked = true;
    }
    updatePolicyVisuals();
}

function getMonitoringUserRoleInfo() {
    if (typeof window.getWorkloadUserRoleInfo === 'function') {
        return window.getWorkloadUserRoleInfo();
    }
    const directRole = (typeof localStorage !== 'undefined' ? (localStorage.getItem('user_role') || '') : '').toLowerCase().trim();
    let cachedDoc = null;
    try {
        if (typeof localStorage !== 'undefined' && window.auth?.currentUser?.uid) {
            cachedDoc = JSON.parse(localStorage.getItem(`simas_user_data_${window.auth.currentUser.uid}`) || 'null');
        }
    } catch (_) {}
    const role = (cachedDoc?.role || cachedDoc?.currentRole || directRole || '').toLowerCase().trim();
    const addRoles = Array.isArray(cachedDoc?.additionalRoles)
        ? cachedDoc.additionalRoles.map(r => String(r).toLowerCase().trim())
        : [];
    const allRoles = [role, ...addRoles];
    if (typeof window !== 'undefined' && typeof window.getAllUserRoles === 'function') {
        try {
            allRoles.push(...window.getAllUserRoles().map(r => String(r).toLowerCase().trim()));
        } catch (_) {}
    }
    const isSuperAdmin = allRoles.includes('super_admin') || (typeof window !== 'undefined' && typeof window.hasRole === 'function' && window.hasRole('super_admin'));
    const isKepalaSekolah = allRoles.includes('kepala_sekolah') || (typeof window !== 'undefined' && typeof window.hasRole === 'function' && window.hasRole('kepala_sekolah'));
    return { role, addRoles, allRoles, isKepalaSekolah, isSuperAdmin };
}

export function monitoringSwitchPolicyTab(tab) {
    _activePolicyTab = tab === 'vip' ? 'vip' : 'flow';
    const btnFlow = el('tab-policy-btn-flow');
    const btnVip = el('tab-policy-btn-vip');
    const panelFlow = el('panel-policy-flow');
    const panelVip = el('panel-policy-vip');

    if (btnFlow && btnVip && panelFlow && panelVip) {
        if (_activePolicyTab === 'vip') {
            btnFlow.className = 'px-3.5 py-2 text-xs font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center gap-2 transition-all cursor-pointer';
            btnVip.className = 'px-3.5 py-2 text-xs font-bold border-b-2 border-amber-500 text-amber-600 dark:text-amber-400 flex items-center gap-2 transition-all cursor-pointer';
            panelFlow.classList.add('hidden');
            panelVip.classList.remove('hidden');
        } else {
            btnFlow.className = 'px-3.5 py-2 text-xs font-bold border-b-2 border-amber-500 text-amber-600 dark:text-amber-400 flex items-center gap-2 transition-all cursor-pointer';
            btnVip.className = 'px-3.5 py-2 text-xs font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center gap-2 transition-all cursor-pointer';
            panelFlow.classList.remove('hidden');
            panelVip.classList.add('hidden');
        }
    }
}

function renderVipTeachersList(filteredTeachers = null) {
    const container = el('vip-teachers-list-container');
    const counterLabel = el('label-vip-counter');
    if (!container) return;

    const list = filteredTeachers || _vipTeachersList || [];
    const totalSelected = _selectedVipTeacherIds.size;
    const totalTeachers = (_vipTeachersList || []).length;

    if (counterLabel) {
        counterLabel.textContent = `${totalSelected} guru terpilih dari ${totalTeachers} guru aktif`;
    }

    if (list.length === 0) {
        container.innerHTML = `
            <div class="p-6 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-1.5">
                <i class="fa-solid fa-user-slash text-base text-slate-300 dark:text-slate-600"></i>
                <span>Tidak ada guru yang cocok dengan kata kunci pencarian.</span>
            </div>
        `;
        return;
    }

    container.innerHTML = list.map(t => {
        const isChecked = _selectedVipTeacherIds.has(t.id);
        const photoUrl = resolvePhotoUrl(t.foto);
        const initial = (t.name || 'G').charAt(0).toUpperCase();
        const mapelBadge = t.mapel && t.mapel !== '-' ? `<span class="px-1.5 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 font-semibold text-[10px] truncate max-w-[130px]">${t.mapel}</span>` : '';
        const nipText = t.nip && t.nip !== '-' ? `NIP. ${t.nip}` : (t.nuptk && t.nuptk !== '-' ? `NUPTK. ${t.nuptk}` : "Guru SMANTARA");

        return `
            <div class="flex items-center justify-between p-2 rounded-xl hover:bg-white dark:hover:bg-slate-800/80 transition-all ${isChecked ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}">
                <div class="flex items-center gap-2.5 min-w-0 mr-2">
                    <div class="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0 overflow-hidden flex items-center justify-center font-bold text-xs text-slate-600 dark:text-slate-300">
                        ${photoUrl ? `<img src="${photoUrl}" alt="${t.name}" class="w-full h-full object-cover" onerror="this.onerror=null;this.parentNode.innerHTML='${initial}'">` : initial}
                    </div>
                    <div class="min-w-0">
                        <div class="font-bold text-slate-800 dark:text-white text-xs truncate flex items-center gap-1.5">
                            <span>${t.name}</span>
                            ${isChecked ? '<i class="fa-solid fa-crown text-[10px] text-amber-500 shrink-0"></i>' : ''}
                        </div>
                        <div class="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                            <span class="truncate">${nipText}</span>
                            ${mapelBadge}
                        </div>
                    </div>
                </div>
                <label class="relative inline-flex items-center cursor-pointer shrink-0">
                    <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="window.monitoringToggleTeacherVip('${t.id}')" class="sr-only peer">
                    <div class="w-9 h-5 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500 shadow-inner"></div>
                </label>
            </div>
        `;
    }).join('');
}

export function monitoringToggleTeacherVip(teacherId) {
    if (!teacherId) return;
    if (_selectedVipTeacherIds.has(teacherId)) {
        _selectedVipTeacherIds.delete(teacherId);
    } else {
        _selectedVipTeacherIds.add(teacherId);
    }
    const q = el('input-vip-teacher-search')?.value || '';
    if (q.trim()) {
        monitoringFilterVipTeachers(q);
    } else {
        renderVipTeachersList();
    }
}

export function monitoringToggleAllVip(checked) {
    if (checked) {
        (_vipTeachersList || []).forEach(t => {
            if (t.id) _selectedVipTeacherIds.add(t.id);
        });
    } else {
        _selectedVipTeacherIds.clear();
    }
    const q = el('input-vip-teacher-search')?.value || '';
    if (q.trim()) {
        monitoringFilterVipTeachers(q);
    } else {
        renderVipTeachersList();
    }
}

export function monitoringFilterVipTeachers(queryStr) {
    const q = (queryStr || '').toLowerCase().trim();
    if (!q) {
        renderVipTeachersList();
        return;
    }
    const filtered = (_vipTeachersList || []).filter(t => {
        const nameMatch = (t.name || '').toLowerCase().includes(q);
        const nipMatch = (t.nip || '').toLowerCase().includes(q);
        const mapelMatch = (t.mapel || '').toLowerCase().includes(q);
        return nameMatch || nipMatch || mapelMatch;
    });
    renderVipTeachersList(filtered);
}

async function openPolicyModal() {
    const modal = el('modal-workload-policy');
    if (!modal) return;

    // Tampilkan modal segera untuk kelancaran UX
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // Reset ke tab alur persetujuan saat modal dibuka
    monitoringSwitchPolicyTab('flow');

    const roleInfo = getMonitoringUserRoleInfo();
    const isSuperAdmin = Boolean(roleInfo.isSuperAdmin);

    const tabVipBtn = el('tab-policy-btn-vip');
    if (tabVipBtn) {
        if (isSuperAdmin) {
            tabVipBtn.classList.remove('hidden');
        } else {
            tabVipBtn.classList.add('hidden');
        }
    }

    try {
        const res = await cfGetWorkloadPolicy();
        const policy = res?.data?.policy || res?.data || {};

        const cbPlan = el('policy-require-plan-approval');
        if (cbPlan) {
            // Nilai 0 berarti mode mandiri (tanpa persetujuan), nilai 1 atau null berarti wajib persetujuan
            cbPlan.checked = policy.require_plan_approval !== 0;
        }

        const cbLog = el('policy-require-log-verification');
        if (cbLog) {
            // Nilai 0 berarti otomatis verified, nilai 1 atau null berarti wajib verifikasi
            cbLog.checked = policy.require_log_verification !== 0;
        }

        updatePolicyVisuals();
        syncPolicyBadges(policy);

        // Jika Super Admin, inisialisasi daftar guru dan whitelist VIP
        if (isSuperAdmin) {
            const serverVipIds = Array.isArray(policy.vip_teacher_ids) ? policy.vip_teacher_ids : [];
            _selectedVipTeacherIds = new Set(serverVipIds);

            // Ambil daftar guru dari cache summary atau panggil API
            let teachers = [];
            if (Array.isArray(_summaryData) && _summaryData.length > 0) {
                teachers = _summaryData.map(s => s.teacher || s);
            } else {
                const monRes = await cfGetWorkloadMonitoringSummary(_weekStart || new Date().toISOString().slice(0, 10)).catch(() => null);
                teachers = monRes?.data?.teachers || monRes?.data?.summary || [];
            }

            _vipTeachersList = teachers.map(t => ({
                id: t.id || t.teacher_id,
                name: t.name || t.teacher_name || 'Guru',
                nip: t.nip || '-',
                nuptk: t.nuptk || '-',
                mapel: t.mapel || '-',
                foto: t.foto || null
            })).filter(t => Boolean(t.id));

            renderVipTeachersList();
        }
    } catch (err) {
        showToast('Gagal memuat pengaturan kebijakan: ' + (err?.message || err), 'error');
    }
}

function closePolicyModal() {
    const modal = el('modal-workload-policy');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
}

async function savePolicySettings(event) {
    if (event) event.preventDefault();
    const btnSubmit = el('btn-save-policy');
    const originalHtml = btnSubmit ? btnSubmit.innerHTML : '';
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Menyimpan...';
    }

    try {
        const require_plan_approval = el('policy-require-plan-approval')?.checked ? 1 : 0;
        const require_log_verification = el('policy-require-log-verification')?.checked ? 1 : 0;

        const payload = {
            require_plan_approval,
            require_log_verification
        };

        const roleInfo = getMonitoringUserRoleInfo();
        if (roleInfo.isSuperAdmin) {
            payload.vip_teacher_ids = Array.from(_selectedVipTeacherIds);
        }

        await cfUpdateWorkloadPolicy(payload);

        const planDesc = require_plan_approval ? 'Persetujuan Formal' : 'Otomatis Sah';
        const logDesc = require_log_verification ? 'Verifikasi Kepsek' : 'Otomatis Terverifikasi';
        const vipMsg = roleInfo.isSuperAdmin ? ` | VIP Guru: ${_selectedVipTeacherIds.size} orang` : '';
        showToast(`Kebijakan alur persetujuan disimpan! (Rencana: ${planDesc}, Log: ${logDesc}${vipMsg})`);

        syncPolicyBadges({ require_plan_approval, require_log_verification });

        if (typeof window.workloadReloadPolicy === 'function') {
            await window.workloadReloadPolicy();
        }

        closePolicyModal();
        _policy = null;
        _monitoringCache.clear();
        await loadSummary({ useCache: false });
    } catch (err) {
        showToast('Gagal menyimpan kebijakan: ' + (err.message || 'Terjadi kesalahan sistem'), 'error');
    } finally {
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = originalHtml || '<i class="fa-solid fa-check"></i> <span>Simpan Pengaturan</span>';
        }
    }
}

if (typeof window !== 'undefined') {
    window.monitoringClearCache = () => _monitoringCache.clear();
    window.monitoringSwitchPolicyTab = monitoringSwitchPolicyTab;
    window.monitoringToggleTeacherVip = monitoringToggleTeacherVip;
    window.monitoringToggleAllVip = monitoringToggleAllVip;
    window.monitoringFilterVipTeachers = monitoringFilterVipTeachers;
}

