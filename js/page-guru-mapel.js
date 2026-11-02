import { lmsHasQuiz } from './lms-structure.mjs';
import { installLmsModuleEditor } from './lms-module-editor.mjs';
/* js/page-guru-mapel.js - Logika Portal Guru Mapel (Input Nilai Spreadsheet-like) */
import { auth, db, PATHS, supabase, SCHOOL_CONFIG, getAiConfigAsync, getUserGeminiApiKeysAsync, fetchGeminiWithFallback } from './config.js';
import {
    cfClient,
    cfFetch,
    cfGetLmsQuizAttempts,
    cfReviewLmsQuiz,
    cfUnlockLmsQuiz,
    cfResetLmsQuiz,
    cfGetLmsTopics,
    cfGetLmsModules, cfGetLmsModule, cfSaveLmsModule, cfSetLmsModuleVisibility, cfDeleteLmsModule, cfGetLmsModuleProgress,
    cfGetLmsMaterials,
    cfGetLmsClassAnalytics,
    cfSaveLmsTopic,
    cfDeleteLmsTopic,
    cfSaveLmsMaterial,
    cfDeleteLmsMaterial,
    cfCopyLmsFromClass,
    cfReorderLmsItems,
    cfGetLmsMaterialProgress,
    cfOverrideLmsStudentProgress,
    cfGetLmsDiscussions,
    cfUpdateLmsDiscussionPrompt,
    cfSaveLmsDiscussion,
    cfDeleteLmsDiscussion,
    cfPinLmsDiscussion,
    cfGetKoreksiAiVipSettings,
    cfSaveKoreksiAiVipSettings
} from './cloudflare-client.js';
import { parseJpList, formatJpDisplay, getJurnalDateStr, calculateDueDateUrgency, renderSafeMarkdown, isClassEqual } from './utils.mjs';
import { openLmsMathPaletteModal } from './lms-math-palette.mjs';
import { installQuizBuilder, installTeacherQuiz } from './lms-quiz-ui.mjs';
import { createQuizAiImporter } from './lms-quiz-import-ai.mjs';
import { configureLmsHtmlEditor, getLmsMaterialInstructions, importLmsHtmlFile, mountLmsHtml, validateLmsHtml } from './lms-html.mjs';
import { openInfographicDialog } from './jurnal-infographic.mjs';
import { installLmsJournal } from './lms-journal.mjs';
import { installLmsDiscussionLayout } from './lms-discussion-layout.mjs';
import { validateLmsSchedule, normalizeLmsScheduleTime, formatLmsScheduleTime, getLmsScheduleState } from './lms-schedule.mjs';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, getDocs, query, where, doc, getDoc, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
    initLayout,
    getCurrentAcademicYearString,
    getCurrentSemester,
    escapeHTML,
    showToast,
    getLocalCache,
    setLocalCache
} from './global.js';
import { getTeacherScheduleForToday, getCurrentJPInfo, getSubjectsWithLessonsFromXML } from './asc-schedule-parser.js';

function showModernAlert(title, message, type = 'success') {
    if (typeof showToast === 'function') {
        showToast(title, message.replace(/<[^>]*>?/gm, ''), type === 'success' ? 'success' : (type === 'warning' ? 'warning' : 'error'));
    }
}

// =========================================================================
// 1. SUPABASE CONFIGURATION (SSOT INSTANCE)
// =========================================================================
function initSupabase() {
    return !!supabase;
}

// State tracker scope modul (Lazy Loading on-demand untuk menghemat bandwidth & kuota read)
let currentLoadedGradebookScope = '';
let currentLoadedKehadiranScope = '';
let currentLoadedJurnalScope = '';
let currentLoadedLmsScope = '';
let portalDataRevision = 0;
let portalFilterSelection = null;
const portalLoadSequences = new Map();
const previouslyLoadedPortalTabs = new Set();
const sessionPortalDataCache = new Map();

function getPortalFilterSelection() {
    return Object.fromEntries(['select-kelas', 'select-mapel', 'select-semester'].map(id =>
        [id, document.getElementById(id)?.value || '']));
}

window.getGuruMapelScope = () => ({
    kelas: document.getElementById('select-kelas')?.value || '',
    mapel: document.getElementById('select-mapel')?.value || '',
    semester: document.getElementById('select-semester')?.value || '1',
    tahunAjaran: raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString()
});

function invalidatePortalJournalCache() {
    const { kelas, mapel, semester, tahunAjaran } = window.getGuruMapelScope();
    const key = `cache_jurnal_${tahunAjaran.replace(/\//g, '-')}_S${semester}_${kelas.replace(/\s+/g, '_')}_${mapel.replace(/\s+/g, '_')}`;
    sessionPortalDataCache.delete(key);
    localStorage.removeItem(key);
    currentLoadedJurnalScope = '';
    currentLoadedKehadiranScope = '';
}

function beginPortalDataLoad(tab) {
    const revision = portalDataRevision;
    const selection = JSON.stringify(getPortalFilterSelection());
    const sequence = (portalLoadSequences.get(tab) || 0) + 1;
    portalLoadSequences.set(tab, sequence);
    return () => revision === portalDataRevision && sequence === portalLoadSequences.get(tab)
        && selection === JSON.stringify(getPortalFilterSelection());
}

// Keep the old filters active while the existing unsaved-score dialog is open.
function deferUnsavedPortalFilterChange(id, retry) {
    if (!isGradebookDirty || !portalFilterSelection) return false;
    const nextValue = document.getElementById(id)?.value || '';
    Object.entries(portalFilterSelection).forEach(([filterId, value]) => {
        const element = document.getElementById(filterId);
        if (element) element.value = value;
    });
    confirmUnsavedChanges(() => {
        document.getElementById(id).value = nextValue;
        retry();
    });
    return true;
}

// =========================================================================
// KONTROL HAK AKSES FITUR EKSKLUSIF KOREKSI ASESMEN SISWA BERBASIS AI (SIMAS VIP)
// =========================================================================
let _koreksiAiVipConfig = null;
let _koreksiAiTeachersList = [];
let _selectedAiVipTeacherIds = new Set();
let _searchAiVipTeachersQuery = '';

export async function loadKoreksiAiVipConfig(forceRefresh = false) {
    if (_koreksiAiVipConfig && !forceRefresh) return _koreksiAiVipConfig;
    try {
        const res = typeof cfGetKoreksiAiVipSettings === 'function'
            ? await cfGetKoreksiAiVipSettings()
            : (typeof window.cfGetKoreksiAiVipSettings === 'function' ? await window.cfGetKoreksiAiVipSettings() : null);
        if (res && res.success && res.config) {
            _koreksiAiVipConfig = res.config;
        } else if (res && res.config) {
            _koreksiAiVipConfig = res.config;
        }
    } catch (e) {
        console.warn('[Koreksi AI] Gagal memuat konfigurasi VIP:', e);
    }
    return _koreksiAiVipConfig || { all_teachers: false, allowed_teacher_ids: [], allowed_uids: [] };
}
window.loadKoreksiAiVipConfig = loadKoreksiAiVipConfig;

export function canAccessKoreksiAi() {
    const isSuper = (typeof window !== 'undefined' && typeof window.hasRole === 'function' && window.hasRole('super_admin'))
        || (typeof localStorage !== 'undefined' && localStorage.getItem('user_role') === 'super_admin')
        || (typeof currentUserDocData !== 'undefined' && (currentUserDocData?.role === 'super_admin' || currentUserDocData?.role === 'superadmin'));
    if (isSuper) return true;

    const isKepsek = (typeof window !== 'undefined' && typeof window.hasRole === 'function' && window.hasRole('kepala_sekolah'))
        || (typeof localStorage !== 'undefined' && localStorage.getItem('user_role') === 'kepala_sekolah')
        || (typeof currentUserDocData !== 'undefined' && currentUserDocData?.role === 'kepala_sekolah');
    if (isKepsek) return true;

    const vipCfg = (typeof _koreksiAiVipConfig !== 'undefined' && _koreksiAiVipConfig)
        ? _koreksiAiVipConfig
        : ((typeof window !== 'undefined' && window._koreksiAiVipConfig) ? window._koreksiAiVipConfig : null);

    if (vipCfg?.all_teachers === true) {
        return true;
    }

    const currentTId = typeof currentTeacherId !== 'undefined' ? currentTeacherId : (typeof window !== 'undefined' ? window.currentTeacherId : '');
    const userDocLinked = typeof currentUserDocData !== 'undefined' ? currentUserDocData?.linkedTeacherId : null;
    const localLinked = typeof localStorage !== 'undefined' ? localStorage.getItem('linked_teacher_id') : '';
    const teacherId = String(currentTId || userDocLinked || localLinked || '').trim();
    if (teacherId && Array.isArray(vipCfg?.allowed_teacher_ids) && vipCfg.allowed_teacher_ids.map(String).includes(teacherId)) {
        return true;
    }

    const authObj = typeof auth !== 'undefined' ? auth : (typeof window !== 'undefined' ? window.auth : null);
    const currentUid = authObj?.currentUser?.uid;
    if (currentUid && Array.isArray(vipCfg?.allowed_uids) && vipCfg.allowed_uids.includes(currentUid)) {
        return true;
    }

    if (typeof window !== 'undefined' && typeof window.isCurrentUserVip === 'function' && window.isCurrentUserVip()) {
        return true;
    }

    return false;
}
window.canAccessKoreksiAi = canAccessKoreksiAi;

export function openKoreksiAiVipModal() {
    const modal = document.getElementById('modal-koreksi-ai-vip-notice');
    const isSuper = (typeof window.hasRole === 'function' && window.hasRole('super_admin'))
        || (localStorage.getItem('user_role') === 'super_admin')
        || (currentUserDocData?.role === 'super_admin' || currentUserDocData?.role === 'superadmin');

    const btnAdmin = document.getElementById('btn-open-vip-settings-from-notice');
    if (btnAdmin) {
        if (isSuper) btnAdmin.classList.remove('hidden');
        else btnAdmin.classList.add('hidden');
    }

    if (modal) {
        modal.classList.remove('hidden');
    } else {
        showToast('SIMAS VIP', 'Fitur Koreksi Asesmen Siswa Berbasis AI merupakan fitur eksklusif SIMAS VIP dan dalam tahap pengembangan.', 'info');
    }
}
window.openKoreksiAiVipModal = openKoreksiAiVipModal;

export function closeKoreksiAiVipModal() {
    const modal = document.getElementById('modal-koreksi-ai-vip-notice');
    if (modal) modal.classList.add('hidden');
}
window.closeKoreksiAiVipModal = closeKoreksiAiVipModal;

export async function openKoreksiAiVipSettingsModal() {
    closeKoreksiAiVipModal();
    const isSuper = (typeof window.hasRole === 'function' && window.hasRole('super_admin'))
        || (localStorage.getItem('user_role') === 'super_admin')
        || (currentUserDocData?.role === 'super_admin' || currentUserDocData?.role === 'superadmin');
    if (!isSuper) {
        showToast('Akses Ditolak', 'Hanya Super Admin yang berwenang mengatur hak akses VIP Koreksi AI.', 'warning');
        return;
    }

    const modal = document.getElementById('modal-koreksi-ai-vip-settings');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const cfg = await loadKoreksiAiVipConfig(true);
    _selectedAiVipTeacherIds = new Set(Array.isArray(cfg?.allowed_teacher_ids) ? cfg.allowed_teacher_ids.map(String) : []);

    const toggleAll = document.getElementById('toggle-ai-vip-all-teachers');
    const labelStatus = document.getElementById('label-ai-vip-all-status');
    if (toggleAll) toggleAll.checked = cfg?.all_teachers === true;
    if (labelStatus) {
        labelStatus.textContent = cfg?.all_teachers === true ? 'Aktif untuk Semua Guru Mapel' : 'Hanya guru terpilih di bawah ini yang dapat mengakses';
        labelStatus.className = `text-[11px] font-semibold ${cfg?.all_teachers === true ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`;
    }

    // Ambil daftar guru dari cache master GTK
    try {
        let tMap = typeof window.getTeachersMapCache === 'function' ? await window.getTeachersMapCache() : null;
        if (tMap && tMap.size > 0) {
            _koreksiAiTeachersList = Array.from(tMap.values()).filter(t => {
                const j = String(t.jenis_ptk || '').toLowerCase();
                const r = String(t.role || '').toLowerCase();
                if (j.includes('tenaga kependidikan') || j.includes('tendik') || r.includes('tendik')) return false;
                return true;
            });
        }
    } catch (e) {
        console.warn('[VIP Modal] Gagal memuat master guru:', e);
    }

    renderKoreksiAiVipTeacherList();
}
window.openKoreksiAiVipSettingsModal = openKoreksiAiVipSettingsModal;

export function closeKoreksiAiVipSettingsModal() {
    const modal = document.getElementById('modal-koreksi-ai-vip-settings');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}
window.closeKoreksiAiVipSettingsModal = closeKoreksiAiVipSettingsModal;

export function handleToggleAiVipAllTeachers(isChecked) {
    if (!_koreksiAiVipConfig) _koreksiAiVipConfig = {};
    _koreksiAiVipConfig.all_teachers = Boolean(isChecked);

    const labelStatus = document.getElementById('label-ai-vip-all-status');
    if (labelStatus) {
        labelStatus.textContent = isChecked ? 'Aktif untuk Semua Guru Mapel' : 'Hanya guru terpilih di bawah ini yang dapat mengakses';
        labelStatus.className = `text-[11px] font-semibold ${isChecked ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`;
    }
    renderKoreksiAiVipTeacherList();
}
window.handleToggleAiVipAllTeachers = handleToggleAiVipAllTeachers;

export function handleSearchAiVipTeachers(val) {
    _searchAiVipTeachersQuery = (val || '').toLowerCase().trim();
    renderKoreksiAiVipTeacherList();
}
window.handleSearchAiVipTeachers = handleSearchAiVipTeachers;

export function toggleSelectAiVipTeacher(teacherId) {
    if (!teacherId) return;
    const sId = String(teacherId);
    if (_selectedAiVipTeacherIds.has(sId)) {
        _selectedAiVipTeacherIds.delete(sId);
    } else {
        _selectedAiVipTeacherIds.add(sId);
    }
    renderKoreksiAiVipTeacherList();
}
window.toggleSelectAiVipTeacher = toggleSelectAiVipTeacher;

export function renderKoreksiAiVipTeacherList() {
    const container = document.getElementById('container-ai-vip-teachers-list');
    const badgeCount = document.getElementById('badge-ai-vip-selected-count');
    if (!container) return;

    const isAll = _koreksiAiVipConfig?.all_teachers === true;
    if (badgeCount) {
        badgeCount.textContent = isAll ? 'Semua Guru (Global Aktif)' : `${_selectedAiVipTeacherIds.size} Guru Terpilih`;
    }

    const q = _searchAiVipTeachersQuery;
    const filtered = _koreksiAiTeachersList.filter(t => {
        if (!q) return true;
        const name = String(t.name || t.nama || '').toLowerCase();
        const mapel = String(t.mapel || '').toLowerCase();
        const nip = String(t.nip || '').toLowerCase();
        return name.includes(q) || mapel.includes(q) || nip.includes(q);
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                <i class="fa-solid fa-user-slash text-2xl mb-1.5 block opacity-50"></i>
                Tidak ada guru mapel yang cocok dengan kata kunci pencarian.
            </div>`;
        return;
    }

    container.innerHTML = filtered.map(t => {
        const id = String(t.id);
        const isChecked = isAll || _selectedAiVipTeacherIds.has(id);
        const name = t.name || t.nama || 'Guru Mapel';
        const initial = name.charAt(0).toUpperCase();
        const rawPhoto = t.foto || t.photo_url || t.photo || '';
        const photoUrl = rawPhoto ? (typeof resolvePhotoUrl === 'function' ? resolvePhotoUrl(rawPhoto) : rawPhoto) : '';
        const mapel = t.mapel && t.mapel !== '-' ? t.mapel : '';
        const nip = t.nip && t.nip !== '-' ? `NIP. ${t.nip}` : (t.nuptk && t.nuptk !== '-' ? `NUPTK. ${t.nuptk}` : "Guru SMANTARA");

        return `
            <div class="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all ${isChecked ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}">
                <div class="flex items-center gap-2.5 min-w-0 mr-2">
                    <div class="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0 overflow-hidden flex items-center justify-center font-bold text-xs text-slate-600 dark:text-slate-300">
                        ${photoUrl ? `<img src="${photoUrl}" alt="${escapeHTML(name)}" class="w-full h-full object-cover" onerror="this.onerror=null;this.parentNode.innerHTML='${initial}'">` : initial}
                    </div>
                    <div class="min-w-0">
                        <div class="font-bold text-slate-800 dark:text-white text-xs truncate flex items-center gap-1.5">
                            <span class="truncate">${escapeHTML(name)}</span>
                            ${isChecked ? '<i class="fa-solid fa-crown text-[10px] text-amber-500 shrink-0" title="Hak Akses VIP Aktif"></i>' : ''}
                        </div>
                        <div class="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5 truncate">
                            <span class="truncate">${escapeHTML(nip)}</span>
                            ${mapel ? `<span class="px-1.5 py-0.2 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 font-semibold truncate max-w-[120px]">${escapeHTML(mapel)}</span>` : ''}
                        </div>
                    </div>
                </div>
                <label class="relative inline-flex items-center cursor-pointer shrink-0">
                    <input type="checkbox" ${isAll ? 'disabled' : ''} ${isChecked ? 'checked' : ''} onchange="window.toggleSelectAiVipTeacher('${id}')" class="w-4 h-4 rounded text-amber-500 border-slate-300 focus:ring-amber-500/30">
                </label>
            </div>
        `;
    }).join('');
}
window.renderKoreksiAiVipTeacherList = renderKoreksiAiVipTeacherList;

export async function saveKoreksiAiVipSettings() {
    const btn = document.getElementById('btn-save-ai-vip-settings');
    const originalText = btn ? btn.innerHTML : '';
    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i> Menyimpan...';
        }

        const allTeachers = _koreksiAiVipConfig?.all_teachers === true;
        const allowedTeacherIds = Array.from(_selectedAiVipTeacherIds);

        const payload = {
            all_teachers: allTeachers,
            allowed_teacher_ids: allowedTeacherIds,
            allowed_uids: _koreksiAiVipConfig?.allowed_uids || []
        };

        const res = typeof cfSaveKoreksiAiVipSettings === 'function'
            ? await cfSaveKoreksiAiVipSettings(payload)
            : (typeof window.cfSaveKoreksiAiVipSettings === 'function' ? await window.cfSaveKoreksiAiVipSettings(payload) : null);

        if (!res || !res.success) {
            throw new Error(res?.message || 'Gagal menyimpan konfigurasi ke server');
        }

        _koreksiAiVipConfig = res.config || payload;
        showToast('Sukses', 'Pengaturan hak akses VIP Koreksi AI berhasil disimpan.', 'success');
        closeKoreksiAiVipSettingsModal();

        // Refresh agregat status VIP terpadu agar foto profil langsung terupdate
        if (typeof window.loadVipStatusSummary === 'function') {
            await window.loadVipStatusSummary(true);
            if (typeof window.applyVipBadgeToAllUserAvatars === 'function') {
                window.applyVipBadgeToAllUserAvatars();
            }
        }
    } catch (err) {
        console.error('[VIP Modal] Gagal simpan pengaturan:', err);
        showToast('Error', err.message || 'Gagal menyimpan pengaturan VIP', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}
window.saveKoreksiAiVipSettings = saveKoreksiAiVipSettings;

// Window global helper yang harus tersedia langsung saat DOM dimuat
window.switchGuruMapelTab = function (tabName) {
    console.log('[Tab] switchGuruMapelTab dipanggil dengan tabName:', tabName);

    // Proteksi Hak Akses SIMAS VIP: Koreksi AI eksklusif untuk Super Admin & Kepala Sekolah
    if (tabName === 'koreksi-ai') {
        if (!canAccessKoreksiAi()) {
            openKoreksiAiVipModal();
            return;
        }
    }

    const btnPenilaian = document.getElementById('tab-guru-penilaian');
    const btnKehadiran = document.getElementById('tab-guru-kehadiran');
    const btnJurnal = document.getElementById('tab-guru-jurnal');
    const btnLms = document.getElementById('tab-guru-lms');
    const btnKoreksiAi = document.getElementById('tab-guru-koreksi-ai');

    const panelPenilaian = document.getElementById('panel-penilaian');
    const panelKehadiran = document.getElementById('panel-kehadiran');
    const panelJurnal = document.getElementById('panel-jurnal');
    const panelLms = document.getElementById('panel-lms');
    const panelKoreksiAi = document.getElementById('panel-koreksi-ai');

    const scopeTitle = document.getElementById('table-scope-title');

    const mapel = document.getElementById('select-mapel')?.value || '';
    const kelas = document.getElementById('select-kelas')?.value || '';
    const semester = document.getElementById('select-semester')?.value || '1';
    const activeTahun = (typeof raporConfig !== 'undefined' && raporConfig?.tahun_ajaran_aktif) || (typeof getCurrentAcademicYearString === 'function' ? getCurrentAcademicYearString() : '');
    const currentScope = `${activeTahun}_${semester}_${kelas}_${mapel}`;

    const activeBtnClass = "px-2.5 sm:px-3 py-1.5 rounded-lg font-bold text-xs transition-all duration-150 bg-emerald-600 text-white shadow-sm flex items-center gap-1.5";
    const inactiveBtnClass = "px-2.5 sm:px-3 py-1.5 rounded-lg font-bold text-xs transition-all duration-150 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5";

    if (typeof window.hideKehadiranDateTooltip === 'function') window.hideKehadiranDateTooltip();

    if (panelPenilaian) panelPenilaian.classList.add('hidden');
    if (panelKehadiran) panelKehadiran.classList.add('hidden');
    if (panelJurnal) panelJurnal.classList.add('hidden');
    if (panelLms) panelLms.classList.add('hidden');
    if (panelKoreksiAi) panelKoreksiAi.classList.add('hidden');

    if (btnPenilaian) btnPenilaian.className = inactiveBtnClass;
    if (btnKehadiran) btnKehadiran.className = inactiveBtnClass;
    if (btnJurnal) btnJurnal.className = inactiveBtnClass;
    if (btnLms) btnLms.className = inactiveBtnClass;
    if (btnKoreksiAi) btnKoreksiAi.className = inactiveBtnClass;

    const wrapperTools = document.getElementById('wrapper-penilaian-tools');
    const btnConfigMobile = document.getElementById('btn-config-mobile');
    const btnToggleMobile = document.getElementById('btn-toggle-perhotelan-mobile');
    const btnInfographicMobile = document.getElementById('btn-infographic-mobile');
    if (btnToggleMobile) {
        btnToggleMobile.classList.add('hidden');
        btnToggleMobile.classList.remove('flex');
    }
    const wrapperJurnalTools = document.getElementById('wrapper-jurnal-tools');
    if (wrapperJurnalTools) {
        wrapperJurnalTools.hidden = tabName !== 'jurnal';
        wrapperJurnalTools.classList.toggle('hidden', tabName !== 'jurnal');
        wrapperJurnalTools.classList.toggle('flex', tabName === 'jurnal');
    }

    if (tabName === 'penilaian') {
        if (panelPenilaian) panelPenilaian.classList.remove('hidden');
        if (btnPenilaian) btnPenilaian.className = activeBtnClass;
        if (wrapperTools) {
            wrapperTools.classList.add('hidden');
            wrapperTools.classList.add('sm:flex');
        }
        // Tampilkan tombol Atur mobile saat tab Nilai aktif
        if (btnConfigMobile) {
            btnConfigMobile.classList.remove('hidden');
            btnConfigMobile.classList.add('sm:hidden');
        }
        if (typeof updatePerhotelanToggleButton === 'function') {
            updatePerhotelanToggleButton(typeof isPerhotelanMapel === 'function' ? isPerhotelanMapel(mapel) : false);
        }
        if (btnInfographicMobile) {
            btnInfographicMobile.classList.add('hidden');
        }
        if (scopeTitle) {
            scopeTitle.textContent = (mapel && kelas) ? `Penilaian ${mapel} - ${kelas} (Semester ${semester})` : 'Lembar Penilaian Siswa';
        }
        if (mapel && kelas && currentLoadedGradebookScope !== currentScope) {
            window.loadGradebookData(false);
        }
    } else if (tabName === 'kehadiran') {
        if (panelKehadiran) panelKehadiran.classList.remove('hidden');
        if (btnKehadiran) btnKehadiran.className = activeBtnClass;
        if (wrapperTools) {
            wrapperTools.classList.add('hidden');
            wrapperTools.classList.remove('sm:flex');
        }
        // Sembunyikan tombol Atur mobile saat bukan tab Nilai
        if (btnConfigMobile) {
            btnConfigMobile.classList.add('hidden');
        }
        if (btnInfographicMobile) {
            btnInfographicMobile.classList.add('hidden');
        }
        if (scopeTitle) {
            scopeTitle.textContent = (mapel && kelas) ? `Rekap Kehadiran ${mapel} - ${kelas} (Semester ${semester})` : 'Rekap Kehadiran Siswa';
        }
        // Lazy load kehadiran jika belum dimuat untuk kelas/mapel/semester aktif
        if (mapel && kelas && currentLoadedKehadiranScope !== currentScope && typeof window.loadKehadiranSiswaData === 'function') {
            window.loadKehadiranSiswaData(false);
        }
    } else if (tabName === 'jurnal') {
        if (panelJurnal) panelJurnal.classList.remove('hidden');
        if (btnJurnal) btnJurnal.className = activeBtnClass;
        if (wrapperTools) {
            wrapperTools.classList.add('hidden');
            wrapperTools.classList.remove('sm:flex');
        }
        // Sembunyikan tombol Atur mobile saat bukan tab Nilai
        if (btnConfigMobile) {
            btnConfigMobile.classList.add('hidden');
        }
        // Tampilkan tombol Infografis mobile saat tab Jurnal aktif
        if (btnInfographicMobile) {
            btnInfographicMobile.classList.remove('hidden');
            btnInfographicMobile.classList.add('sm:hidden');
        }
        if (scopeTitle) {
            scopeTitle.textContent = (mapel && kelas) ? `Daftar Jurnal ${mapel} - ${kelas} (Semester ${semester})` : 'Daftar Jurnal Mengajar';
        }
        // Lazy load jurnal jika belum dimuat untuk kelas/mapel/semester aktif
        if (mapel && kelas && currentLoadedJurnalScope !== currentScope && typeof window.loadDaftarJurnalData === 'function') {
            window.loadDaftarJurnalData(false);
        }
    } else if (tabName === 'lms') {
        if (panelLms) panelLms.classList.remove('hidden');
        if (btnLms) btnLms.className = activeBtnClass;
        if (wrapperTools) {
            wrapperTools.classList.add('hidden');
            wrapperTools.classList.remove('sm:flex');
        }
        if (btnConfigMobile) {
            btnConfigMobile.classList.add('hidden');
        }
        if (btnInfographicMobile) {
            btnInfographicMobile.classList.add('hidden');
        }
        if (scopeTitle) {
            scopeTitle.textContent = (mapel && kelas) ? `LMS & Modul Ajar ${mapel} - ${kelas} (Semester ${semester})` : 'LMS / Modul Ajar Siswa';
        }

        // Lazy load LMS data jika mapel dan kelas sudah dipilih & belum termuat untuk scope ini
        if (mapel && kelas && currentLoadedLmsScope !== currentScope && typeof window.loadLmsData === 'function') {
            window.loadLmsData(false);
        }
    } else if (tabName === 'koreksi-ai') {
        if (panelKoreksiAi) panelKoreksiAi.classList.remove('hidden');
        if (btnKoreksiAi) btnKoreksiAi.className = activeBtnClass;
        if (wrapperTools) {
            wrapperTools.classList.add('hidden');
            wrapperTools.classList.remove('sm:flex');
        }
        if (btnConfigMobile) {
            btnConfigMobile.classList.add('hidden');
        }
        if (btnInfographicMobile) {
            btnInfographicMobile.classList.add('hidden');
        }
        if (scopeTitle) {
            scopeTitle.textContent = (mapel && kelas) ? `Koreksi Asesmen AI ${mapel} - ${kelas} (Semester ${semester})` : 'Koreksi Asesmen Siswa Otomatis Berbasis Gemini AI';
        }
        const isSuper = (typeof window.hasRole === 'function' && window.hasRole('super_admin'))
            || (localStorage.getItem('user_role') === 'super_admin')
            || (currentUserDocData?.role === 'super_admin' || currentUserDocData?.role === 'superadmin');
        const btnVipAdmin = document.getElementById('btn-open-koreksi-ai-vip-settings');
        if (btnVipAdmin) {
            if (isSuper) btnVipAdmin.classList.remove('hidden');
            else btnVipAdmin.classList.add('hidden');
        }
        if (typeof window.checkTeacherApiKeyAvailability === 'function') {
            window.checkTeacherApiKeyAvailability();
        }
        if (typeof window.renderStudentSubmissionsUI === 'function') {
            window.renderStudentSubmissionsUI();
        }
    }
};

window.checkInitialTabFromUrl = function () {
    try {
        const hash = (window.location.hash || '').toLowerCase();
        const searchParams = new URLSearchParams(window.location.search);
        const tabParam = (searchParams.get('tab') || '').toLowerCase();

        let targetTab = null;
        if (tabParam === 'koreksi-ai' || hash.includes('koreksi-ai')) {
            targetTab = 'koreksi-ai';
        } else if (tabParam === 'lms' || hash.includes('lms')) {
            targetTab = 'lms';
        } else if (tabParam === 'jurnal' || hash.includes('jurnal')) {
            targetTab = 'jurnal';
        } else if (tabParam === 'kehadiran' || hash.includes('kehadiran')) {
            targetTab = 'kehadiran';
        } else if (tabParam === 'penilaian' || hash.includes('penilaian')) {
            targetTab = 'penilaian';
        }

        if (targetTab && typeof window.switchGuruMapelTab === 'function') {
            window.switchGuruMapelTab(targetTab);
        }
    } catch (e) {
        console.warn('[Portal Guru Mapel] Error checking initial tab from URL:', e);
    }
};

window.addEventListener('hashchange', () => {
    if (typeof window.checkInitialTabFromUrl === 'function') window.checkInitialTabFromUrl();
});

window.toggleKehadiranPeriode = function () {
    const tipe = document.getElementById('filter-kehadiran-tipe')?.value || 'bulan';
    const elBulan = document.getElementById('filter-kehadiran-bulan');
    const elSemester = document.getElementById('filter-kehadiran-semester');

    if (!elBulan || !elSemester) return;

    if (tipe === 'semester' || tipe === 'tahun') {
        elBulan.classList.add('hidden');
        elSemester.classList.remove('hidden');
    } else {
        elSemester.classList.add('hidden');
        elBulan.classList.remove('hidden');
    }
};


// =========================================================================
// 2. STATE & VARIABLES
// =========================================================================
let currentUser = null;
let currentUserDocData = null;
let currentUserNip = '';
installLmsJournal({
    request: cfFetch,
    school: SCHOOL_CONFIG,
    loadMotivations: async () => (await cfClient.getJurnalMaster()).motivasi,
    scheduleSuggestions: async (scope, date) => {
        const schedule = await getTeacherScheduleForToday(currentUser, currentUserNip, [scope.teacher_name], new Date(`${date}T12:00:00+08:00`));
        return (schedule.todaySlots || []).filter(slot =>
            slot.className.replace(/[^a-z0-9]/gi, '').toLowerCase() === scope.class_name.replace(/[^a-z0-9]/gi, '').toLowerCase()
            && slot.mapel.trim().toLowerCase() === scope.subject_name.trim().toLowerCase()).map(slot => slot.jp);
    },
    onSaved: () => invalidatePortalJournalCache(),
    notify: message => showToast('Jurnal LMS', message, 'error')
});
window.openLmsJournalForProgress = function () {
    const materialId = currentLmsProgressMaterial?.id;
    if (materialId) { window.closeLmsProgressModal(); window.openLmsJournal(materialId); }
};
let currentTeacherIds = [];
let currentTeacherNames = [];

window.openJurnalInfographic = async function () {
    const kelas = document.getElementById('select-kelas')?.value;
    const mapel = document.getElementById('select-mapel')?.value;
    if (!kelas || !mapel || !currentUser) {
        showToast('Pilih kelas dan mapel', 'Pilih kelas serta mata pelajaran terlebih dahulu.', 'warning');
        return;
    }
    const buttons = [
        document.getElementById('btn-jurnal-infographic'),
        document.getElementById('btn-infographic-mobile'),
        document.getElementById('btn-jurnal-infographic-panel')
    ].filter(Boolean);
    if (buttons.some(b => b.disabled)) return;
    buttons.forEach(b => { b.disabled = true; });
    try {
        const isSuperAdmin = window.hasRole('super_admin');
        const isSuperOrAdmin = isSuperAdmin || window.hasRole('wakasek_kurikulum') || window.hasRole('kepala_sekolah');

        // RBAC: Hanya Super Admin yang dapat memilih seluruh kelas sekolah.
        // Guru Mapel dan Wakasek Kurikulum dibatasi pada kelas yang diampunya untuk mapel tersebut.
        let availableClasses = [];
        if (isSuperAdmin) {
            availableClasses = (activeClassesList && activeClassesList.length > 0)
                ? [...activeClassesList]
                : [kelas];
        } else {
            availableClasses = (assignedMapelMap && assignedMapelMap[mapel] && assignedMapelMap[mapel].length > 0)
                ? [...assignedMapelMap[mapel]]
                : [kelas];
        }
        if (kelas && !availableClasses.includes(kelas)) {
            availableClasses.unshift(kelas);
        }
        availableClasses = Array.from(new Set(availableClasses));
        availableClasses.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

        // Sinkronisasi Periode Bulan Jurnal
        const selectMonthEl = document.getElementById('select-jurnal-month');
        const selectedMonth = (selectMonthEl && selectMonthEl.value && selectMonthEl.value !== 'all') ? selectMonthEl.value : '';
        const availableMonths = [];
        if (selectMonthEl && selectMonthEl.options) {
            for (let i = 0; i < selectMonthEl.options.length; i++) {
                const opt = selectMonthEl.options[i];
                if (opt.value && opt.value !== 'all') {
                    availableMonths.push({ value: opt.value, label: opt.textContent.split(' - ')[0].trim() });
                }
            }
        }

        // 1. Identifikasi guru yang ditugaskan untuk kelas & mapel terpilih (SSOT)
        const assignedInfo = await resolveAssignedTeacherForClassAndMapel(kelas, mapel);

        let teacherName = '';
        let teacherUid = currentUser.uid;
        let teacherNip = '';

        if (isSuperOrAdmin && assignedInfo.isAssigned) {
            teacherName = assignedInfo.name || '';
            teacherUid = assignedInfo.uid || currentUser.uid;
            teacherNip = assignedInfo.nip || '';
        }

        if (!teacherName || teacherName === 'Guru Mapel') {
            teacherName = await getTeacherRealName(currentUser);
        }

        if (!teacherNip || !/\d{4,}/.test(teacherNip)) {
            teacherNip = currentUserNip;
            if (!teacherNip || !/\d{4,}/.test(teacherNip)) {
                teacherNip = await resolveTeacherNipFromGtk(currentUser, currentUserDocData, teacherName);
                if (teacherNip) currentUserNip = teacherNip;
            }
        }

        let teacherPhoto = '';
        if (!isSuperOrAdmin && currentUser?.uid) {
            teacherPhoto = localStorage.getItem(`cached_user_photo_${currentUser.uid}`) || '';
        }
        if (!teacherPhoto) {
            try {
                let tData = null;
                if (typeof window.getTeachersMapCache === 'function') {
                    const tMap = await window.getTeachersMapCache();
                    if (tMap) {
                        tData = (teacherUid ? tMap.get(teacherUid) : null)
                            || (currentUser?.uid ? tMap.get(currentUser.uid) : null)
                            || (teacherName ? tMap.get(teacherName.toLowerCase().trim()) : null);
                    }
                }
                if (!tData && typeof window.getTeachersCache === 'function') {
                    const list = await window.getTeachersCache();
                    if (Array.isArray(list)) {
                        const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        const targetNorm = norm(teacherName);
                        tData = list.find(t => {
                            if (teacherUid && (t.id === teacherUid || t.nik === teacherUid)) return true;
                            if (targetNorm && norm(t.name) === targetNorm) return true;
                            return false;
                        });
                    }
                }
                if (tData?.foto || tData?.photo_url) {
                    const rawP = tData.foto || tData.photo_url;
                    teacherPhoto = (typeof window.resolvePhotoUrl === 'function') ? window.resolvePhotoUrl(rawP) : rawP;
                }
            } catch (ePhoto) {
                console.warn('[Portal Guru Mapel] Gagal resolve foto GTK:', ePhoto);
            }
        }

        const names = [
            teacherName,
            currentUser.displayName,
            assignedInfo.name,
            ...currentTeacherNames
        ].filter(Boolean);

        const candidateIds = [
            currentUser.uid,
            teacherUid,
            assignedInfo.uid,
            ...currentTeacherIds
        ].filter(Boolean);

        const candidates = getMapelNameCandidates(mapel);
        await openInfographicDialog({
            kelas, mapel, teacherName, teacherNip: teacherNip || '',
            teacherUid, teacherIds: candidateIds, teacherNames: names, school: SCHOOL_CONFIG,
            teacherPhoto,
            allowAnyTeacher: isSuperAdmin,
            isSuperOrAdmin: isSuperAdmin,
            matchesSubject: value => isMapelMatching(value, candidates),
            availableClasses,
            selectedMonth,
            availableMonths,
            async fetchData(period, targetKelas = kelas) {
                if (!cfClient?.enabled) throw new Error('Layanan jurnal belum tersedia. Silakan coba kembali.');
                const [journals, students] = await Promise.all([
                    (async () => {
                        const all = [];
                        for (let offset = 0; ; offset += 1000) {
                            const page = await cfClient.getJurnalKbm({ kelas: targetKelas, startDate: period.start, endDate: period.end, limit: 1000, offset });
                            if (!Array.isArray(page)) throw new Error('Data jurnal tidak valid.');
                            all.push(...page);
                            if (page.length < 1000) return all;
                        }
                    })(),
                    cfClient.getStudents({ class: targetKelas, limit: 1000 })
                ]);
                if (!Array.isArray(students)) throw new Error('Data siswa tidak valid.');
                return { journals, students: students.filter(s => isClassEqual(s.class || s.kelas, targetKelas) && !s.is_alumni && s.status !== 'inactive') };
            }
        });
    } catch (error) {
        showToast('Infografis belum dapat dibuat', error.message, 'error');
    } finally {
        buttons.forEach(b => { b.disabled = false; });
    }
};

// =========================================================================
// 1b. REPLAY PANGGILAN STUB (klik pengguna sebelum modul siap)
// =========================================================================
if (Array.isArray(window._pendingModuleCalls) && window._pendingModuleCalls.length > 0) {
    console.log('[Portal] Replaying', window._pendingModuleCalls.length, 'panggilan stub tertampung...');
    window._pendingModuleCalls.forEach(function(call) {
        if (typeof window[call.fn] === 'function') {
            try {
                window[call.fn].apply(null, call.args);
            } catch (e) {
                console.warn('[Portal] Gagal replay stub:', call.fn, e);
            }
        }
    });
    window._pendingModuleCalls = []; // Reset setelah replay
}

let raporConfig = {};
let assignedMapelMap = {}; // { mapelName: ['XII MIPA 1', 'XII MIPA 2'] }
let activeClassesList = [];
let loadedStudents = []; // [{ nis, name, class }]
let activeColumns = []; // [{ key: 'tugas_1', label: 'Tugas 1', type: 'tugas' }]
let weights = { tugas: 20, sumatif: 40, sas: 40 };
let visibleTugasCount = 1;
let visibleSumatifCount = 1;
let minRequiredTugasCount = 1;
let minRequiredSumatifCount = 1;
let isGradebookDirty = false;
let kkmValue = 75;
let currentSortColumn = 'name';
let currentSortOrder = 'asc';

function setGradebookDirty(dirty) {
    isGradebookDirty = dirty;
    const topSaveBar = document.getElementById('top-save-bar');
    const bottomSaveBar = document.getElementById('bottom-save-bar');

    if (dirty) {
        if (topSaveBar) {
            topSaveBar.classList.remove('hidden');
            topSaveBar.classList.add('flex');
        }
        if (bottomSaveBar) {
            bottomSaveBar.classList.remove('hidden');
            bottomSaveBar.classList.add('flex');
        }
    } else {
        if (topSaveBar) {
            topSaveBar.classList.add('hidden');
            topSaveBar.classList.remove('flex');
        }
        if (bottomSaveBar) {
            bottomSaveBar.classList.add('hidden');
            bottomSaveBar.classList.remove('flex');
        }
    }
}

// Global listener pencegah penutupan tab/refresh saat ada perubahan nilai belum disimpan
window.addEventListener('beforeunload', (e) => {
    if (isGradebookDirty) {
        e.preventDefault();
        e.returnValue = 'Ada perubahan nilai yang belum disimpan di lembar penilaian.';
        return e.returnValue;
    }
});

// Listener intersept navigasi link internal saat ada nilai belum disimpan
document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (link && isGradebookDirty) {
        const href = link.getAttribute('href');
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            e.preventDefault();
            confirmUnsavedChanges(() => {
                window.location.href = href;
            });
        }
    }
});

// Helper Modal Dialog Konfirmasi Unsaved Changes (Bisa Digunakan Kembali)
function confirmUnsavedChanges(onProceed) {
    if (!isGradebookDirty) {
        return onProceed();
    }

    const modal = document.getElementById('modal-unsaved-changes');
    const card = document.getElementById('modal-unsaved-card');
    const btnSave = document.getElementById('btn-unsaved-save');
    const btnDiscard = document.getElementById('btn-unsaved-discard');
    const btnCancel = document.getElementById('btn-unsaved-cancel');

    if (!modal || !card) {
        if (typeof window.showConfirmModal === 'function') {
            window.showConfirmModal('Ada nilai yang belum disimpan! Apakah Anda yakin ingin mengabaikan perubahan dan melanjutkan?', 'Perubahan Belum Disimpan', 'warning').then(ok => {
                if (ok) {
                    setGradebookDirty(false);
                    onProceed();
                }
            });
        }
        return;
    }

    const closeModal = () => {
        card.classList.remove('scale-100', 'opacity-100');
        card.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 150);
    };

    const newBtnSave = btnSave.cloneNode(true);
    const newBtnDiscard = btnDiscard.cloneNode(true);
    const newBtnCancel = btnCancel.cloneNode(true);

    btnSave.parentNode.replaceChild(newBtnSave, btnSave);
    btnDiscard.parentNode.replaceChild(newBtnDiscard, btnDiscard);
    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);

    newBtnSave.onclick = async () => {
        const origContent = newBtnSave.innerHTML;
        newBtnSave.disabled = true;
        newBtnDiscard.disabled = true;
        newBtnCancel.disabled = true;
        newBtnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Menyimpan...</span>';

        try {
            const saveFn = window.saveScores || window.saveGradebookData;
            if (typeof saveFn !== 'function') {
                throw new Error('Fungsi penyimpanan nilai tidak ditemukan.');
            }
            const res = await saveFn();
            if (res === true) {
                closeModal();
                setGradebookDirty(false);
                onProceed();
            } else {
                newBtnSave.disabled = false;
                newBtnDiscard.disabled = false;
                newBtnCancel.disabled = false;
                newBtnSave.innerHTML = origContent;
                if (typeof showToast === 'function') {
                    showToast('Gagal Menyimpan', 'Nilai belum berhasil disimpan ke server. Data Anda tetap aman di halaman ini.', 'error');
                }
            }
        } catch (err) {
            console.error('[Portal Guru Mapel] Error saving unsaved changes:', err);
            newBtnSave.disabled = false;
            newBtnDiscard.disabled = false;
            newBtnCancel.disabled = false;
            newBtnSave.innerHTML = origContent;
            if (typeof showToast === 'function') {
                showToast('Gagal Menyimpan', (err && err.message) ? err.message : 'Terjadi kesalahan saat menyimpan nilai. Data Anda tetap aman di halaman ini.', 'error');
            }
        }
    };

    newBtnDiscard.onclick = () => {
        closeModal();
        setGradebookDirty(false);
        onProceed();
    };

    newBtnCancel.onclick = () => {
        closeModal();
    };

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        card.classList.remove('scale-95', 'opacity-0');
        card.classList.add('scale-100', 'opacity-100');
    }, 10);
}

const ALL_COLUMNS_S1 = [
    { key: 'tugas_1', label: 'Tugas 1', type: 'tugas', is_optional: true },
    { key: 'tugas_2', label: 'Tugas 2', type: 'tugas', is_optional: true },
    { key: 'tugas_3', label: 'Tugas 3', type: 'tugas', is_optional: true },
    { key: 'tugas_4', label: 'Tugas 4', type: 'tugas', is_optional: true },
    { key: 'tugas_5', label: 'Tugas 5', type: 'tugas', is_optional: true },
    { key: 'sumatif_1', label: 'Sumatif 1', type: 'sumatif', is_optional: false },
    { key: 'sumatif_2', label: 'Sumatif 2', type: 'sumatif', is_optional: false },
    { key: 'sumatif_3', label: 'Sumatif 3', type: 'sumatif', is_optional: false },
    { key: 'sumatif_4', label: 'Sumatif 4', type: 'sumatif', is_optional: false },
    { key: 'sumatif_5', label: 'Sumatif 5', type: 'sumatif', is_optional: false },
    { key: 'sas_sat', label: 'SAS', type: 'sas', is_optional: false }
];

const ALL_COLUMNS_S2 = [
    { key: 'tugas_1', label: 'Tugas 1', type: 'tugas', is_optional: true },
    { key: 'tugas_2', label: 'Tugas 2', type: 'tugas', is_optional: true },
    { key: 'tugas_3', label: 'Tugas 3', type: 'tugas', is_optional: true },
    { key: 'tugas_4', label: 'Tugas 4', type: 'tugas', is_optional: true },
    { key: 'tugas_5', label: 'Tugas 5', type: 'tugas', is_optional: true },
    { key: 'sumatif_1', label: 'Sumatif 1', type: 'sumatif', is_optional: false },
    { key: 'sumatif_2', label: 'Sumatif 2', type: 'sumatif', is_optional: false },
    { key: 'sumatif_3', label: 'Sumatif 3', type: 'sumatif', is_optional: false },
    { key: 'sumatif_4', label: 'Sumatif 4', type: 'sumatif', is_optional: false },
    { key: 'sumatif_5', label: 'Sumatif 5', type: 'sumatif', is_optional: false },
    { key: 'sas_sat', label: 'SAT', type: 'sat', is_optional: false }
];

function getActiveColumns(semester) {
    const base = semester === '2' ? ALL_COLUMNS_S2 : ALL_COLUMNS_S1;
    const tugas = base.filter(c => c.type === 'tugas').slice(0, visibleTugasCount);
    const sumatif = base.filter(c => c.type === 'sumatif').slice(0, visibleSumatifCount);
    const sasCol = base.find(c => c.type === 'sas' || c.type === 'sat');
    return [...tugas, ...sumatif, sasCol].filter(Boolean);
}

// Cache data dari Supabase
let supabaseComponentMap = {}; // { key -> component_id }
let existingScoresMap = {}; // { nis: { key: scoreVal } }
let existingSummariesMap = {}; // { nis: { tugas_avg, sumatif_avg, sas_sat_score, final_score, deskripsi_cp, nilai_rapor } }

// Helper deteksi apakah mata pelajaran merupakan program kejuruan Perhotelan
function isPerhotelanMapel(mapel) {
    if (!mapel) return false;
    return String(mapel).toLowerCase().includes('perhotelan');
}
window.isPerhotelanMapel = isPerhotelanMapel;

// State visibilitas kolom rapor (Nilai Rapor & Deskripsi CP) khusus Perhotelan
// Default false (tersembunyi) karena baru digunakan di akhir semester saat persiapan cetak rapor
let isPerhotelanRaporVisible = false;
window.isPerhotelanRaporVisible = isPerhotelanRaporVisible;

function updatePerhotelanToggleButton(isPerhotenan) {
    const btnDesktop = document.getElementById('btn-toggle-perhotelan-rapor');
    const btnMobile = document.getElementById('btn-toggle-perhotelan-mobile');
    const textDesktop = document.getElementById('btn-toggle-perhotelan-text');
    const textMobile = document.getElementById('btn-toggle-perhotelan-mobile-text');
    const iconDesktop = btnDesktop?.querySelector('i');
    const iconMobile = btnMobile?.querySelector('i');

    if (!isPerhotenan) {
        if (btnDesktop) {
            btnDesktop.classList.add('hidden');
            btnDesktop.classList.remove('flex');
        }
        if (btnMobile) {
            btnMobile.classList.add('hidden');
            btnMobile.classList.remove('flex');
        }
        return;
    }

    if (btnDesktop) {
        btnDesktop.classList.remove('hidden');
        btnDesktop.classList.add('flex');
    }
    const panelPenilaian = document.getElementById('panel-penilaian');
    const isPenilaianActive = panelPenilaian && !panelPenilaian.classList.contains('hidden');
    if (btnMobile) {
        if (isPenilaianActive) {
            btnMobile.classList.remove('hidden');
            btnMobile.classList.add('flex');
        } else {
            btnMobile.classList.add('hidden');
            btnMobile.classList.remove('flex');
        }
    }

    if (isPerhotelanRaporVisible) {
        if (textDesktop) textDesktop.textContent = 'Rapor';
        if (textMobile) textMobile.textContent = 'Rapor';
        if (iconDesktop) iconDesktop.className = 'fa-solid fa-eye-slash text-purple-600 dark:text-purple-400';
        if (iconMobile) iconMobile.className = 'fa-solid fa-eye-slash text-purple-200 text-[10px]';
        if (btnDesktop) {
            btnDesktop.classList.remove('bg-purple-100', 'hover:bg-purple-200', 'text-purple-800');
            btnDesktop.classList.add('bg-purple-200', 'hover:bg-purple-300', 'text-purple-950', 'ring-1', 'ring-purple-400');
            btnDesktop.title = 'Sembunyikan Kolom Rapor (Khusus Perhotelan)';
        }
        if (btnMobile) {
            btnMobile.title = 'Sembunyikan Kolom Rapor (Khusus Perhotelan)';
        }
    } else {
        if (textDesktop) textDesktop.textContent = 'Rapor';
        if (textMobile) textMobile.textContent = 'Rapor';
        if (iconDesktop) iconDesktop.className = 'fa-solid fa-eye text-purple-600 dark:text-purple-400';
        if (iconMobile) iconMobile.className = 'fa-solid fa-eye text-purple-200 text-[10px]';
        if (btnDesktop) {
            btnDesktop.classList.remove('bg-purple-200', 'hover:bg-purple-300', 'text-purple-950', 'ring-1', 'ring-purple-400');
            btnDesktop.classList.add('bg-purple-100', 'hover:bg-purple-200', 'text-purple-800');
            btnDesktop.title = 'Tampilkan Kolom Rapor (Khusus Perhotelan)';
        }
        if (btnMobile) {
            btnMobile.title = 'Tampilkan Kolom Rapor (Khusus Perhotelan)';
        }
    }
}
window.updatePerhotelanToggleButton = updatePerhotelanToggleButton;

// Toggle interaktif untuk memunculkan / menyembunyikan kolom rapor Perhotelan
window.togglePerhotelanRaporSection = function () {
    // 1. Amankan input aktif saat ini sebelum me-render ulang tabel
    const rows = document.querySelectorAll('#gradebook-tbody tr');
    rows.forEach(row => {
        const nis = row.dataset.nis;
        if (!nis) return;
        const nrInp = row.querySelector('.perhotelan-nilai-rapor');
        if (nrInp) {
            if (!existingSummariesMap[nis]) existingSummariesMap[nis] = {};
            const v = parseFloat(nrInp.value.trim());
            existingSummariesMap[nis].nilai_rapor = isNaN(v) ? null : v;
        }
        const cpInp = row.querySelector('.perhotelan-deskripsi-cp');
        if (cpInp) {
            if (!existingSummariesMap[nis]) existingSummariesMap[nis] = {};
            existingSummariesMap[nis].deskripsi_cp = cpInp.value;
        }
    });

    isPerhotelanRaporVisible = !isPerhotelanRaporVisible;
    window.isPerhotelanRaporVisible = isPerhotelanRaporVisible;

    const currentMapel = document.getElementById('select-mapel')?.value || '';
    const isPerhotenan = isPerhotelanMapel(currentMapel);
    updatePerhotelanToggleButton(isPerhotenan);

    const semSelect = document.getElementById('select-semester');
    const semester = semSelect ? semSelect.value : '1';
    renderGradebookTable(semester);

    if (typeof showToast === 'function') {
        showToast(
            isPerhotelanRaporVisible ? 'Kolom Rapor Ditampilkan' : 'Kolom Rapor Disembunyikan',
            isPerhotelanRaporVisible 
                ? 'Kolom Nilai Rapor & Deskripsi CP Perhotelan siap diisi.'
                : 'Kolom Nilai Rapor & Deskripsi CP disembunyikan. Data tersimpan aman.',
            'info'
        );
    }
};

// Helper pembaruan pewarnaan input Nilai Rapor Perhotelan berdasarkan KKM (< KKM: merah, >= KKM: hijau, kosong: ungu)
function updateNilaiRaporHighlight(nrInput, currentKkm) {
    if (!nrInput) return;
    const kkm = currentKkm !== undefined ? currentKkm : (parseFloat(kkmValue) || 75);
    const valStr = nrInput.value.trim();
    const nrVal = parseFloat(valStr);

    nrInput.classList.remove(
        'bg-rose-50', 'dark:bg-rose-950/60', 'text-rose-700', 'dark:text-rose-300', 'border-rose-300', 'dark:border-rose-800',
        'bg-emerald-50', 'dark:bg-emerald-950/60', 'text-emerald-800', 'dark:text-emerald-200', 'border-emerald-300', 'dark:border-emerald-700',
        'bg-purple-50', 'dark:bg-purple-900/40', 'border-purple-300', 'dark:border-purple-700', 'text-purple-800', 'dark:text-purple-100'
    );

    if (valStr !== '' && !isNaN(nrVal)) {
        if (nrVal < kkm) {
            nrInput.classList.add('bg-rose-50', 'dark:bg-rose-950/60', 'text-rose-700', 'dark:text-rose-300', 'border-rose-300', 'dark:border-rose-800');
            nrInput.title = `Nilai Rapor di bawah KKM (${kkm})`;
        } else {
            nrInput.classList.add('bg-emerald-50', 'dark:bg-emerald-950/60', 'text-emerald-800', 'dark:text-emerald-200', 'border-emerald-300', 'dark:border-emerald-700');
            nrInput.title = `Tuntas KKM (${kkm})`;
        }
    } else {
        // Kosong → kembalikan warna default ungu (Perhotelan)
        nrInput.classList.add('bg-purple-50', 'dark:bg-purple-900/40', 'border-purple-300', 'dark:border-purple-700', 'text-purple-800', 'dark:text-purple-100');
        nrInput.title = '';
    }
}
window.updateNilaiRaporHighlight = updateNilaiRaporHighlight;

// Handler perubahan Nilai Rapor (Khusus Perhotelan)
window.onNilaiRaporChange = function (input) {
    input.dataset.manual = "true";

    // Validasi rentang numerik 0 - 100
    let v = parseFloat(input.value);
    if (!isNaN(v)) {
        if (v < 0) input.value = 0;
        else if (v > 100) input.value = 100;
    }

    const nis = input.dataset.nis;
    if (nis) {
        if (!existingSummariesMap[nis]) existingSummariesMap[nis] = {};
        const val = parseFloat(input.value.trim());
        existingSummariesMap[nis].nilai_rapor = isNaN(val) ? null : val;
    }
    if (typeof setGradebookDirty === 'function') {
        setGradebookDirty(true);
    }

    // Terapkan penanda warna KKM langsung pada saat diketik secara real-time
    const currentKkm = parseFloat(kkmValue) || 75;
    updateNilaiRaporHighlight(input, currentKkm);

    // Perbarui status tombol reset pada footer tabel
    if (typeof updateColumnHighlightsAndQuartiles === 'function') {
        updateColumnHighlightsAndQuartiles();
    }
};

// Handler perubahan Deskripsi CP per siswa (Khusus Perhotelan)
window.onDeskripsiCpChange = function (textarea) {
    const nis = textarea.dataset.nis;
    if (nis) {
        if (!existingSummariesMap[nis]) existingSummariesMap[nis] = {};
        existingSummariesMap[nis].deskripsi_cp = textarea.value;
    }
    if (typeof setGradebookDirty === 'function') {
        setGradebookDirty(true);
    }

    // Perbarui status tombol reset pada footer tabel
    if (typeof updateColumnHighlightsAndQuartiles === 'function') {
        updateColumnHighlightsAndQuartiles();
    }
};

// Handler Enter key pada input NR dan Deskripsi CP: pindah ke baris siswa berikutnya
window.onPerhotelanInputKeydown = function (e, input) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const currentRow = input.closest('tr');
    if (!currentRow) return;
    const nextRow = currentRow.nextElementSibling;
    if (!nextRow) return;
    const selector = input.classList.contains('perhotelan-nilai-rapor')
        ? '.perhotelan-nilai-rapor'
        : '.perhotelan-deskripsi-cp';
    const nextInput = nextRow.querySelector(selector);
    if (nextInput) {
        nextInput.focus();
        nextInput.select();
    }
};

// =========================================================================
// 3. INITIALIZATION & AUTH GUARD
// =========================================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
        return;
    }

    currentUser = user;
    initSupabase();
    await initLayout('guru_mapel');
    loadKoreksiAiVipConfig().catch(e => console.warn('[VIP] Gagal memuat config VIP Koreksi AI:', e));

    // Unhide Main Content (Anti-Blank Screen)
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.classList.remove('hidden');

    // Ambil Nama Asli Guru dari Firestore User Doc / Teachers / Profile
    const realName = await getTeacherRealName(user);

    // Display Nama Guru Asli pada Header
    const nameEl = document.getElementById('header-guru-name');
    if (nameEl) {
        nameEl.textContent = realName;
    }

    // Load active classes & Rapor Config
    if (typeof window.getActiveClasses === 'function') {
        activeClassesList = await window.getActiveClasses({ bypassActiveFilter: true });
    }

    // Set Default Semester Dropdown based on current date
    const currentSem = getCurrentSemester();
    const semSelect = document.getElementById('select-semester');
    if (semSelect) semSelect.value = currentSem;

    await loadTeacherScope();
    if (typeof window.checkInitialTabFromUrl === 'function') {
        window.checkInitialTabFromUrl();
    }
});

// Helper Resolving Nama Asli Guru (Comprehensive & Cached)
async function getTeacherRealName(user) {
    if (!user) return 'Guru Mapel';

    // 1. Cek LocalStorage Cache terlebih dahulu
    const cachedName = localStorage.getItem('cached_user_name_' + user.uid) || localStorage.getItem('user_name');
    if (cachedName && cachedName !== 'Guru Mapel' && !cachedName.includes('@')) {
        return cachedName;
    }

    // 2. Cek User Doc via window.getCurrentUserDoc / Firestore
    try {
        let uData = null;
        if (typeof window.getCurrentUserDoc === 'function') {
            uData = await window.getCurrentUserDoc(user.uid);
        }
        if (!uData) {
            const userSnap = await getDoc(doc(db, PATHS.users, user.uid));
            if (userSnap.exists()) uData = userSnap.data();
        }

        if (uData) {
            const resolved = uData.name || uData.nama || uData.displayName || uData.full_name || uData.nama_lengkap;
            if (resolved && !resolved.includes('@')) {
                localStorage.setItem('cached_user_name_' + user.uid, resolved);
                return resolved;
            }
        }
    } catch (e) {
        console.warn('[Portal Guru Mapel] Error reading user doc for name:', e);
    }

    // 3. Fallback: Cek cache teachers D1 SSOT
    try {
        const tMap = await window.getTeachersMapCache();
        const tData = tMap.get(user.uid) || (user.email ? tMap.get(user.email.toLowerCase().trim()) : null);
        if (tData) {
            const resolved = tData.name || tData.nama || tData.nama_lengkap;
            if (resolved) {
                localStorage.setItem('cached_user_name_' + user.uid, resolved);
                return resolved;
            }
        }
    } catch (e) {
        console.warn('[Portal Guru Mapel] Error reading teachers cache for name:', e);
    }

    // 4. Fallback ke Auth displayName jika bukan email
    if (user.displayName && !user.displayName.includes('@')) {
        return user.displayName;
    }

    return 'Guru Mapel';
}

// Helper Matching Guru Pengampu (Multi-Field: UID, NIP, Email, Normalized Name)
function normalizeTeacherName(name) {
    if (!name) return '';
    return name
        .toLowerCase()
        .replace(/^(drs\.|dr\.|drai\.|h\.|hj\.|m\.|ir\.)\s+/g, '')
        .replace(/,\s*(s\.pd|m\.pd|s\.kom|s\.ag|m\.ag|s\.si|m\.si|s\.t|m\.t|s\.e|m\.e|s\.sos|m\.sos|s\.ip|s\.psi|m\.psi|a\.md|s\.sos\.i|s\.h|m\.h|s\.pd\.i)\.?/gi, '')
        .replace(/[^a-z0-9]/gi, '')
        .trim();
}

/**
 * Resolusi NIP resmi guru dari Master GTK (Cloudflare D1 SSOT)
 * Jika guru berstatus PNS/PPPK dan memiliki NIP di tabel GTK, NIP akan dikembalikan.
 * Jika guru non-NIP (honorer), NIP '-', atau tidak ada di GTK, kembalikan string kosong ''.
 */
async function resolveTeacherNipFromGtk(user, userDocData, teacherName) {
    if (!user && !userDocData && !teacherName) return '';

    // 1. Cek jika userDocData sudah memiliki NIP valid (berupa angka/digit)
    const docNip = String(userDocData?.nip || '').trim();
    if (docNip && docNip !== '-' && !/^(undefined|null)$/i.test(docNip) && /\d{4,}/.test(docNip)) {
        return docNip;
    }

    // 2. Cari di Master GTK via window.getTeachersMapCache / getTeachersCache (Cloudflare D1 SSOT)
    try {
        let tData = null;
        if (typeof window.getTeachersMapCache === 'function') {
            const tMap = await window.getTeachersMapCache();
            if (tMap) {
                tData = (user?.uid ? tMap.get(user.uid) : null)
                    || (userDocData?.linkedTeacherId ? tMap.get(userDocData.linkedTeacherId) : null)
                    || (userDocData?.nik ? tMap.get(userDocData.nik) : null)
                    || (user?.email ? tMap.get(user.email.toLowerCase().trim()) : null)
                    || (teacherName ? tMap.get(teacherName.toLowerCase().trim()) : null);
            }
        }

        if (!tData && typeof window.getTeachersCache === 'function') {
            const list = await window.getTeachersCache();
            if (Array.isArray(list)) {
                const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                const targetNorm = norm(teacherName || user?.displayName);
                const targetClean = normalizeTeacherName(teacherName || user?.displayName);
                tData = list.find(t => {
                    if (user?.uid && (t.id === user.uid || t.nik === user.uid)) return true;
                    if (user?.email && t.email && t.email.toLowerCase().trim() === user.email.toLowerCase().trim()) return true;
                    if (userDocData?.nik && t.nik === userDocData.nik) return true;
                    if (userDocData?.linkedTeacherId && (t.id === userDocData.linkedTeacherId || t.nik === userDocData.linkedTeacherId)) return true;
                    const tNorm = norm(t.name || t.nama);
                    if (targetNorm && tNorm === targetNorm) return true;
                    const tClean = normalizeTeacherName(t.name || t.nama);
                    if (targetClean && tClean === targetClean) return true;
                    return false;
                });
            }
        }

        if (!tData && typeof cfClient !== 'undefined' && cfClient?.enabled && cfClient?.getGtk) {
            const results = await cfClient.getGtk({ search: teacherName || user?.displayName || '' });
            if (Array.isArray(results) && results.length > 0) {
                const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                const targetNorm = norm(teacherName || user?.displayName);
                tData = results.find(t => norm(t.name || t.nama) === targetNorm) || results[0];
            }
        }

        if (tData) {
            const rawNip = String(tData.nip || '').trim();
            if (rawNip && rawNip !== '-' && !/^(undefined|null)$/i.test(rawNip) && /\d{4,}/.test(rawNip)) {
                return rawNip;
            }
        }
    } catch (err) {
        console.warn('[Portal Guru Mapel] Gagal mengambil NIP dari tabel GTK:', err);
    }

    return '';
}

// Helper Fase Kurikulum Merdeka (E untuk Kelas X, F untuk Kelas XI & XII)
export function getFaseFromClass(className) {
    if (!className) return 'E';
    const trimmed = String(className).trim().toUpperCase();
    if (trimmed.startsWith('X-') || trimmed.startsWith('X.') || trimmed.startsWith('X ') || trimmed.startsWith('X_') || trimmed === 'X') {
        return 'E';
    }
    return 'F';
}
window.getFaseFromClass = getFaseFromClass;

// Helper Resolving Variasi Alias Nama Mapel (Backward-Compatible untuk Jurnal & Nilai Lama)
export function getMapelNameCandidates(mapelName) {
    if (!mapelName) return [];
    const candidates = new Set();
    const cleanMapel = mapelName.trim();
    candidates.add(cleanMapel);

    const shortCodes = (raporConfig && raporConfig.mapel_short_codes) ? raporConfig.mapel_short_codes : {};
    if (shortCodes[cleanMapel]) {
        candidates.add(shortCodes[cleanMapel]);
    }
    Object.keys(shortCodes).forEach(fullKey => {
        if (shortCodes[fullKey] === cleanMapel) {
            candidates.add(fullKey);
        }
    });

    if (cleanMapel.match(/^Matematika\s*(\((Umum|Wajib)\))?$/i) || cleanMapel === "Matematika Wajib" || cleanMapel === "Matematika Umum") {
        candidates.add("Matematika");
        candidates.add("Matematika (Umum)");
        candidates.add("Matematika Umum");
        candidates.add("Matematika (Wajib)");
        candidates.add("Matematika Wajib");
        candidates.add("MTK");
    }

    if (cleanMapel.match(/^Bahasa\s*Indonesia\s*(\((Umum|Wajib)\))?$/i) || cleanMapel === "Bahasa Indonesia Wajib" || cleanMapel === "Bahasa Indonesia Umum") {
        candidates.add("Bahasa Indonesia");
        candidates.add("Bahasa Indonesia (Umum)");
        candidates.add("Bahasa Indonesia Umum");
        candidates.add("Bahasa Indonesia (Wajib)");
        candidates.add("Bahasa Indonesia Wajib");
        candidates.add("B. Indonesia");
        candidates.add("B.Indo");
    }

    if (cleanMapel.match(/^Bahasa\s*Inggris\s*(\((Umum|Wajib)\))?$/i) || cleanMapel === "Bahasa Inggris Wajib" || cleanMapel === "Bahasa Inggris Umum") {
        candidates.add("Bahasa Inggris");
        candidates.add("Bahasa Inggris (Umum)");
        candidates.add("Bahasa Inggris Umum");
        candidates.add("Bahasa Inggris (Wajib)");
        candidates.add("Bahasa Inggris Wajib");
        candidates.add("B. Inggris");
        candidates.add("B.Ing");
    }

    if (cleanMapel.includes("Tingkat Lanjut")) {
        candidates.add(cleanMapel.replace(/Tingkat Lanjut/gi, "Tk Lanjut"));
        candidates.add(cleanMapel.replace(/Tingkat Lanjut/gi, "Tk. Lanjut"));
    } else if (cleanMapel.includes("Tk Lanjut") || cleanMapel.includes("Tk. Lanjut")) {
        candidates.add(cleanMapel.replace(/Tk\.?\s*Lanjut/gi, "Tingkat Lanjut"));
    }

    if (cleanMapel.includes("Pendidikan Pancasila")) {
        candidates.add(cleanMapel.replace(/Pendidikan Pancasila (dan Kewarganegaraan)?/gi, "PPKn"));
        candidates.add(cleanMapel.replace(/Pendidikan Pancasila (dan Kewarganegaraan)?/gi, "PKn"));
    } else if (cleanMapel === "PPKn" || cleanMapel === "PKn") {
        candidates.add("Pendidikan Pancasila");
        candidates.add("Pendidikan Pancasila dan Kewarganegaraan");
    }

    if (cleanMapel.includes("Pendidikan Agama")) {
        candidates.add(cleanMapel.replace(/Pendidikan Agama (dan Budi Pekerti)?/gi, "PABP"));
        candidates.add(cleanMapel.replace(/Pendidikan Agama (dan Budi Pekerti)?/gi, "PAB P"));
    } else if (cleanMapel === "PABP" || cleanMapel === "PAB P") {
        candidates.add("Pendidikan Agama dan Budi Pekerti");
        candidates.add("Pendidikan Agama");
    }

    if (cleanMapel.includes("Pendidikan Jasmani")) {
        candidates.add(cleanMapel.replace(/Pendidikan Jasmani,?\s*Olahraga\s*(dan|&)\s*Kesehatan/gi, "PJOK"));
        candidates.add(cleanMapel.replace(/Pendidikan Jasmani,?\s*Olahraga\s*(dan|&)\s*Kesehatan/gi, "Penjasorkas"));
    } else if (cleanMapel === "PJOK" || cleanMapel === "Penjasorkas") {
        candidates.add("Pendidikan Jasmani Olahraga dan Kesehatan");
        candidates.add("Pendidikan Jasmani, Olahraga, dan Kesehatan");
    }

    if (cleanMapel.includes("Bimbingan")) {
        candidates.add(cleanMapel.replace(/Bimbingan (dan)? Konseling/gi, "BK"));
    } else if (cleanMapel === "BK") {
        candidates.add("Bimbingan Konseling");
        candidates.add("Bimbingan dan Konseling");
    }

    if (cleanMapel.match(/Prakarya|PKWU|Kewirausahaan|KWU/i)) {
        candidates.add("Prakarya dan Kewirausahaan");
        candidates.add("Prakarya & Kewirausahaan");
        candidates.add("Prakarya dan Kewirausahaan (PKWU)");
        candidates.add("Prakarya");
        candidates.add("PKWU");
        candidates.add("Kewirausahaan");
        candidates.add("KWU");
        candidates.add("Prakarya/PKWU");
        candidates.add("Prakarya & KWU");
    }

    if (cleanMapel.includes("Informatika") || cleanMapel === "TIK") {
        candidates.add("Informatika");
        candidates.add("TIK");
        candidates.add("Teknologi Informasi dan Komunikasi");
    }

    if (cleanMapel.match(/^Sejarah\s*(\((Umum|Wajib|Indonesia)\))?$/i) || cleanMapel === "Sejarah Indonesia" || cleanMapel === "Sejarah Wajib") {
        candidates.add("Sejarah");
        candidates.add("Sejarah Indonesia");
        candidates.add("Sejarah (Wajib)");
        candidates.add("Sejarah Wajib");
        candidates.add("Sejarah (Umum)");
        candidates.add("Sejarah Umum");
    }

    if (cleanMapel.includes("Bali")) {
        candidates.add("Bahasa Bali");
        candidates.add("B. Bali");
        candidates.add("B.Bali");
        candidates.add("Muatan Lokal Bahasa Bali");
        candidates.add("Mulok Bahasa Bali");
    }

    return Array.from(candidates);
}

export function isMapelMatching(docMapel, mapelCandidates = []) {
    if (!docMapel) return false;
    const cleanDocMapel = String(docMapel).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!cleanDocMapel) return false;
    const candidates = Array.isArray(mapelCandidates) ? mapelCandidates : [mapelCandidates];
    return candidates.some(c => {
        const cleanC = String(c).trim().toLowerCase().replace(/\s+/g, ' ');
        return cleanC === cleanDocMapel;
    });
}

function isTeacherAssigned(g, user, userNip, candidateNames = [], userNik = '') {
    if (!g || !user) return false;
    const uidStr = (user.uid || '').toString().trim();
    const emailStr = (user.email || '').toString().trim().toLowerCase();
    const nipStr = (userNip || '').toString().trim();
    const nikStr = (userNik || '').toString().trim();

    const namesArray = Array.isArray(candidateNames) ? candidateNames : [candidateNames];
    const candidateNorms = namesArray
        .map(n => normalizeTeacherName(n))
        .filter(Boolean);

    const matchName = (targetName) => {
        const normTarget = normalizeTeacherName(targetName);
        if (!normTarget) return false;
        for (const cn of candidateNorms) {
            if (normTarget === cn || normTarget.includes(cn) || cn.includes(normTarget)) return true;
            const targetTokens = normTarget.split(/\s+/).filter(t => t.length > 2);
            const cnTokens = cn.split(/\s+/).filter(t => t.length > 2);
            if (targetTokens.length > 0 && targetTokens.every(t => cn.includes(t))) return true;
            if (cnTokens.length > 0 && cnTokens.every(t => normTarget.includes(t))) return true;
        }
        return false;
    };

    if (typeof g === 'string') {
        const val = g.trim();
        if (!val) return false;
        if (nikStr && val === nikStr) return true;
        if (val === uidStr) return true;
        if (nipStr && val === nipStr) return true;
        if (emailStr && val.toLowerCase() === emailStr) return true;
        if (matchName(val)) return true;
        return false;
    }

    if (typeof g === 'object') {
        const gNik = (g.nik || '').toString().trim();
        const gUid = (g.uid || g.id || '').toString().trim();
        const gNip = (g.nip || '').toString().trim();
        const gEmail = (g.email || '').toString().trim().toLowerCase();
        const gNama = g.nama || g.name || '';

        if (gNik && nikStr && gNik === nikStr) return true;
        if (gUid && (gUid === uidStr || (nikStr && gUid === nikStr))) return true;
        if (gUid && nipStr && gUid === nipStr) return true;
        if (gNip && (gNip === nipStr || gNip === uidStr || (nikStr && gNip === nikStr))) return true;
        if (gEmail && emailStr && gEmail === emailStr) return true;
        if (gNama && matchName(gNama)) return true;
    }

    return false;
}

// =========================================================================
// 4. TEACHER SCOPE & ASSIGNMENT LOADING
// =========================================================================

// Helper pencocokan nama kelas yang fleksibel dan robust (mengabaikan spasi, tanda minus, dan case)
export function isClassMatching(classA, classB) {
    if (!classA || !classB) return false;
    if (classA === classB) return true;
    const cleanA = String(classA).trim().toLowerCase();
    const cleanB = String(classB).trim().toLowerCase();
    if (cleanA === cleanB) return true;
    return cleanA.replace(/[^a-z0-9]/gi, '') === cleanB.replace(/[^a-z0-9]/gi, '');
}

// Helper filter mapel berdasarkan kelas yang dipilih (berlaku untuk Super Admin maupun Guru Mapel)
export function getMapelsForClass(assignedMap, selectedClass) {
    if (!assignedMap || !selectedClass) return [];
    const allowed = [];
    Object.keys(assignedMap).forEach(mapel => {
        const classList = assignedMap[mapel] || [];
        if (classList.some(c => isClassMatching(c, selectedClass))) {
            allowed.push(mapel);
        }
    });
    return allowed.sort((a, b) => a.localeCompare(b, 'id'));
}

// Helper penyusunan assignedMapelMap untuk role Super Admin / Kurikulum / Kepsek
export function buildAdminAssignedMapelMap(mapelGuruConfig = {}, masterMapelList = [], activeClassesList = [], xmlSubjects = []) {
    const masterMapelSet = masterMapelList.length > 0 ? new Set(masterMapelList) : null;
    const assignedMap = {};

    Object.keys(mapelGuruConfig).forEach(mapel => {
        if (masterMapelSet && !masterMapelSet.has(mapel)) return;

        const guruList = mapelGuruConfig[mapel] || [];
        guruList.forEach(g => {
            let classList = [];
            if (typeof g === 'object' && Array.isArray(g.kelas) && g.kelas.length > 0) {
                classList = g.kelas;
            } else {
                // Guru mengampu semua kelas aktif jika kelas kosong/undefined
                classList = [...activeClassesList];
            }
            if (!assignedMap[mapel]) {
                assignedMap[mapel] = [];
            }
            classList.forEach(c => {
                if (!assignedMap[mapel].includes(c)) {
                    assignedMap[mapel].push(c);
                }
            });
        });
    });

    if (Array.isArray(xmlSubjects) && xmlSubjects.length > 0) {
        xmlSubjects.forEach(sub => {
            const mName = sub.name ? sub.name.trim() : '';
            if (!mName || (masterMapelSet && !masterMapelSet.has(mName))) return;
            if (!assignedMap[mName]) {
                assignedMap[mName] = [];
            }
            (sub.guruList || []).forEach(g => {
                (g.kelas || []).forEach(c => {
                    if (!assignedMap[mName].includes(c)) {
                        assignedMap[mName].push(c);
                    }
                });
            });
        });
    }

    return assignedMap;
}

/**
 * Resolusi Identitas Guru Pengampu Resmi untuk kombinasi Kelas dan Mata Pelajaran
 * Menelusuri raporConfig.mapel_guru (Cloudflare D1 SSOT), fallback ke jadwal mengajar XML,
 * dan memvalidasi nama lengkap serta NIP resmi dari Master GTK D1.
 * 
 * @param {string} kelas - Nama rombel kelas (misal: "X-A", "XI-1")
 * @param {string} mapel - Nama mata pelajaran (misal: "Matematika", "Bahasa Indonesia")
 * @param {object} [options] - Opsi override untuk testing (config, xmlSubjects, teachersMap)
 * @returns {Promise<{ name: string, uid: string, nip: string, isAssigned: boolean, teachers: Array }>}
 */
export async function resolveAssignedTeacherForClassAndMapel(kelas, mapel, options = {}) {
    const activeRaporConfig = options.config || raporConfig || {};
    const defaultName = (currentUser ? await getTeacherRealName(currentUser) : null) || 'Guru Mapel';
    const fallbackResult = {
        name: defaultName,
        uid: currentUser?.uid || '',
        nip: currentUserNip || '',
        isAssigned: false,
        teachers: []
    };

    if (!kelas || !mapel || String(kelas).includes('--') || String(mapel).includes('--')) {
        return fallbackResult;
    }

    const cleanKelas = String(kelas).trim();
    const cleanMapel = String(mapel).trim();
    if (!cleanKelas || !cleanMapel) return fallbackResult;

    // 1. Cari di raporConfig.mapel_guru (SSOT Rapor Config)
    let candidateGurus = [];
    const mapelGuruConfig = activeRaporConfig.mapel_guru || {};

    if (Array.isArray(mapelGuruConfig[cleanMapel]) && mapelGuruConfig[cleanMapel].length > 0) {
        candidateGurus = mapelGuruConfig[cleanMapel];
    } else {
        // Coba matching dengan kandidat alias nama mapel
        const candidates = getMapelNameCandidates(cleanMapel);
        for (const [key, val] of Object.entries(mapelGuruConfig)) {
            if (isMapelMatching(key, candidates) && Array.isArray(val) && val.length > 0) {
                candidateGurus = val;
                break;
            }
        }
    }

    // Filter guru yang secara spesifik mengampu kelas ini
    let matchedGurus = candidateGurus.filter(g => {
        if (!g) return false;
        if (typeof g === 'object' && Array.isArray(g.kelas) && g.kelas.length > 0) {
            return g.kelas.some(c => (typeof isClassEqual === 'function' && isClassEqual(c, cleanKelas)) || isClassMatching(c, cleanKelas));
        }
        return false;
    });

    // Jika belum ada yang cocok spesifik per kelas, ambil guru dengan kelas kosong (mengampu semua rombel)
    if (matchedGurus.length === 0) {
        matchedGurus = candidateGurus.filter(g => {
            if (!g) return false;
            if (typeof g === 'string') return true;
            if (typeof g === 'object' && (!Array.isArray(g.kelas) || g.kelas.length === 0)) return true;
            return false;
        });
    }

    // 2. Fallback: Cari di Jadwal Mengajar XML jika belum ditemukan di mapel_guru
    if (matchedGurus.length === 0) {
        try {
            const xmlSubjects = options.xmlSubjects || (typeof getSubjectsWithLessonsFromXML === 'function' ? await getSubjectsWithLessonsFromXML() : []);
            if (Array.isArray(xmlSubjects) && xmlSubjects.length > 0) {
                const candidates = getMapelNameCandidates(cleanMapel);
                const matchedSub = xmlSubjects.find(sub => {
                    const subName = (sub.name || '').trim();
                    return subName === cleanMapel || isMapelMatching(subName, candidates);
                });

                if (matchedSub && Array.isArray(matchedSub.guruList) && matchedSub.guruList.length > 0) {
                    matchedGurus = matchedSub.guruList.filter(g => {
                        if (!g) return false;
                        if (Array.isArray(g.kelas) && g.kelas.length > 0) {
                            return g.kelas.some(c => (typeof isClassEqual === 'function' && isClassEqual(c, cleanKelas)) || isClassMatching(c, cleanKelas));
                        }
                        return false;
                    });
                    if (matchedGurus.length === 0) {
                        matchedGurus = matchedSub.guruList.filter(g => !Array.isArray(g.kelas) || g.kelas.length === 0);
                    }
                }
            }
        } catch (errXml) {
            console.warn('[Portal Guru Mapel] Gagal membaca fallback XML untuk guru pengampu:', errXml);
        }
    }

    if (matchedGurus.length === 0) {
        return fallbackResult;
    }

    // 3. Resolusi Nama Resmi & NIP dari Master GTK D1 Cache
    let tMap = options.teachersMap || null;
    if (!tMap && typeof window.getTeachersMapCache === 'function') {
        try {
            tMap = await window.getTeachersMapCache();
        } catch (e) {}
    }

    const resolvedTeachers = [];
    for (const g of matchedGurus) {
        let rawName = '';
        let rawUid = '';
        let rawNip = '';

        if (typeof g === 'string') {
            rawName = g.trim();
        } else if (typeof g === 'object' && g) {
            rawName = (g.name || g.nama || '').trim();
            rawUid = (g.uid || g.id || '').toString().trim();
            rawNip = (g.nip || '').toString().trim();
        }

        // Cari detail dari GTK Map Cache
        let gtkData = null;
        if (tMap) {
            gtkData = (rawUid ? tMap.get(rawUid) : null)
                || (rawNip ? tMap.get(rawNip) : null)
                || (rawName ? tMap.get(rawName.toLowerCase().trim()) : null);
        }

        const finalName = gtkData?.name || gtkData?.nama || gtkData?.nama_lengkap || rawName || rawUid;
        const finalNip = (gtkData?.nip && /\d{4,}/.test(gtkData.nip)) ? gtkData.nip : rawNip;
        const finalUid = gtkData?.id || rawUid || '';

        if (finalName && !resolvedTeachers.some(t => t.name === finalName)) {
            resolvedTeachers.push({
                name: finalName,
                uid: finalUid,
                nip: finalNip
            });
        }
    }

    if (resolvedTeachers.length === 0) {
        return fallbackResult;
    }

    const combinedName = resolvedTeachers.length === 2
        ? `${resolvedTeachers[0].name} & ${resolvedTeachers[1].name}`
        : resolvedTeachers.map(t => t.name).join(', ');

    return {
        name: combinedName,
        uid: resolvedTeachers[0].uid || '',
        nip: resolvedTeachers[0].nip || '',
        isAssigned: true,
        teachers: resolvedTeachers
    };
}

/**
 * Memperbarui tampilan nama Guru Pengampu di Header Portal Guru Mapel
 */
export async function updateHeaderGuruName(targetKelas, targetMapel, options = {}) {
    const nameEl = document.getElementById('header-guru-name');
    if (!nameEl) return;

    const kelas = targetKelas !== undefined ? targetKelas : document.getElementById('select-kelas')?.value;
    const mapel = targetMapel !== undefined ? targetMapel : document.getElementById('select-mapel')?.value;

    const result = await resolveAssignedTeacherForClassAndMapel(kelas, mapel, options);
    if (kelas !== (document.getElementById('select-kelas')?.value || '') ||
        mapel !== (document.getElementById('select-mapel')?.value || '')) return;
    nameEl.textContent = result.name;

    if (result.isAssigned) {
        nameEl.title = `Guru Pengampu ${mapel} - ${kelas}: ${result.name}${result.nip ? ` (NIP. ${result.nip})` : ''}`;
    } else {
        nameEl.title = `User Login: ${result.name}`;
    }
}

window.resolveAssignedTeacherForClassAndMapel = resolveAssignedTeacherForClassAndMapel;
window.updateHeaderGuruName = updateHeaderGuruName;

async function loadTeacherScope() {
    try {
        // Caching Rapor Config (TTL 30 Menit)
        const cachedConfig = getLocalCache('simas_rapor_config_cache');
        if (cachedConfig) {
            raporConfig = cachedConfig;
        } else {
            if (cfClient && cfClient.enabled) {
                try {
                    const configData = await cfClient.getRaporConfig();
                    if (configData && (configData.mapel_list || configData.mapel_guru)) {
                        raporConfig = configData;
                        setLocalCache('simas_rapor_config_cache', raporConfig, 30 * 60 * 1000);
                        console.log('⚡ [GuruMapel] rapor_config loaded from Cloudflare D1 SSOT');
                    }
                } catch (cfErr) {
                    console.error('[GuruMapel] Gagal memuat rapor_config dari Cloudflare D1:', cfErr);
                }
            }
        }

        const activeClassesList = await window.getActiveClasses({ bypassActiveFilter: true });

        // Dapatkan data user dari cache Firestore
        let userDocData = null;
        if (typeof window.getCurrentUserDoc === 'function') {
            userDocData = await window.getCurrentUserDoc();
        }
        if (!userDocData && currentUser) {
            const userDocSnap = await getDoc(doc(db, PATHS.users, currentUser.uid));
            if (userDocSnap.exists()) {
                userDocData = userDocSnap.data();
            }
        }

        let currentUserNik = '';
        currentTeacherIds = [currentUser?.uid, userDocData?.nik, userDocData?.linkedTeacherId, userDocData?.nip].filter(Boolean);
        if (userDocData) {
            currentUserDocData = userDocData;
            currentUserNip = (userDocData.nip && /\d{4,}/.test(userDocData.nip)) ? userDocData.nip : '';
            currentUserNik = userDocData.nik || userDocData.linkedTeacherId || '';
        }

        const teacherRealName = await getTeacherRealName(currentUser);
        if (!currentUserNip || !/\d{4,}/.test(currentUserNip)) {
            const gtkNip = await resolveTeacherNipFromGtk(currentUser, userDocData, teacherRealName);
            if (gtkNip) currentUserNip = gtkNip;
        }
        const candidateNames = [
            teacherRealName,
            currentUser.displayName,
            userDocData?.name,
            userDocData?.nama,
            userDocData?.full_name,
            userDocData?.nama_lengkap
        ].filter(n => n && n !== 'Guru Mapel' && !n.includes('@'));
        currentTeacherNames = candidateNames;

        const isSuperOrAdmin = window.hasRole('super_admin') || window.hasRole('wakasek_kurikulum') || window.hasRole('kepala_sekolah');
        const mapelGuruConfig = raporConfig.mapel_guru || {};
        const masterMapelList = raporConfig.mapel_list || [];
        const masterMapelSet = masterMapelList.length > 0 ? new Set(masterMapelList) : null;

        assignedMapelMap = {};

        if (isSuperOrAdmin) {
            // Super Admin / Kurikulum / Kepsek:
            // Petakan setiap mapel HANYA ke kelas-kelas yang memang memiliki alokasi mapel tersebut di Pengaturan Rapor & Jadwal XML
            let xmlSubjects = [];
            try {
                xmlSubjects = await getSubjectsWithLessonsFromXML();
            } catch (errXml) {
                console.warn('[Portal Guru Mapel] Suplemen jadwal XML dilewati:', errXml);
            }
            assignedMapelMap = buildAdminAssignedMapelMap(mapelGuruConfig, masterMapelList, activeClassesList, xmlSubjects);
        } else {
            // Guru Mapel: Filter mapel dan kelas yang diampu saja (Multi-Field Matching)
            Object.keys(mapelGuruConfig).forEach(mapel => {
                // Abaikan mapel yang tidak terdaftar di masterMapelList (legacy/orphan key)
                if (masterMapelSet && !masterMapelSet.has(mapel)) return;

                const guruList = mapelGuruConfig[mapel] || [];
                guruList.forEach(g => {
                    if (isTeacherAssigned(g, currentUser, currentUserNip, candidateNames, currentUserNik)) {
                        let classList = [];
                        if (typeof g === 'object' && Array.isArray(g.kelas) && g.kelas.length > 0) {
                            classList = g.kelas;
                        } else {
                            // Jika g.kelas [] (empty array) atau undefined atau g string -> guru mengampu SEMUA KELAS AKTIF
                            classList = [...activeClassesList];
                        }
                        if (!assignedMapelMap[mapel]) {
                            assignedMapelMap[mapel] = [];
                        }
                        classList.forEach(c => {
                            if (!assignedMapelMap[mapel].includes(c)) {
                                assignedMapelMap[mapel].push(c);
                            }
                        });
                    }
                });
            });

            // Suplemen pemetaan dari XML jika guru terdaftar di XML tapi belum tersinkron ke mapel_guru
            try {
                const xmlSubjects = await getSubjectsWithLessonsFromXML();
                if (Array.isArray(xmlSubjects) && xmlSubjects.length > 0) {
                    xmlSubjects.forEach(sub => {
                        const mName = sub.name ? sub.name.trim() : '';
                        if (!mName || (masterMapelSet && !masterMapelSet.has(mName))) return;
                        (sub.guruList || []).forEach(g => {
                            if (isTeacherAssigned(g, currentUser, currentUserNip, candidateNames, currentUserNik)) {
                                if (!assignedMapelMap[mName]) {
                                    assignedMapelMap[mName] = [];
                                }
                                (g.kelas || []).forEach(c => {
                                    if (!assignedMapelMap[mName].includes(c)) {
                                        assignedMapelMap[mName].push(c);
                                    }
                                });
                            }
                        });
                    });
                }
            } catch (errXml) {
                console.warn('[Portal Guru Mapel] Suplemen jadwal XML guru dilewati:', errXml);
            }
        }

        // 1. Kumpulkan semua Kelas unik yang diampu oleh Guru ini
        let allAssignedClasses = new Set();
        Object.keys(assignedMapelMap).forEach(mapel => {
            const classList = assignedMapelMap[mapel] || [];
            classList.forEach(c => allAssignedClasses.add(c));
        });

        let availableClasses = Array.from(allAssignedClasses);
        if (isSuperOrAdmin) {
            availableClasses = [...activeClassesList];
        }
        availableClasses.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

        // 2. Populate Select Kelas Dropdown (PERTAMA)
        const kelasSelect = document.getElementById('select-kelas');
        if (kelasSelect) {
            if (availableClasses.length === 0) {
                kelasSelect.innerHTML = '<option value="">-- Tidak ada kelas --</option>';
            } else {
                kelasSelect.innerHTML = '<option value="">-- Kelas --</option>';
                availableClasses.forEach(k => {
                    kelasSelect.innerHTML += `<option value="${escapeHTML(k)}">${escapeHTML(k)}</option>`;
                });
            }
        }

        // Auto-select kelas (dengan deteksi cerdas jadwal mengajar real-time XML)
        if (availableClasses.length > 0 && kelasSelect) {
            let targetKelas = availableClasses[0];
            let preferredMapel = null;
            let detectedInfo = null;

            try {
                const scheduleResult = await getTeacherScheduleForToday(currentUser, currentUserNip, candidateNames);
                if (scheduleResult && scheduleResult.targetSlot) {
                    const slot = scheduleResult.targetSlot;
                    // Cocokkan nama kelas dari XML dengan daftar kelas aktif SIMAS
                    const matchedClass = availableClasses.find(c =>
                        c.trim().toLowerCase() === slot.className.trim().toLowerCase() ||
                        c.replace(/[^a-z0-9]/gi, '').toLowerCase() === slot.className.replace(/[^a-z0-9]/gi, '').toLowerCase()
                    );

                    if (matchedClass) {
                        targetKelas = matchedClass;
                        preferredMapel = slot.mapel;
                        detectedInfo = {
                            jp: slot.jp,
                            mapel: slot.mapel,
                            className: matchedClass,
                            reason: scheduleResult.matchReason,
                            jpInfo: scheduleResult.currentJPInfo
                        };
                    }
                }
            } catch (errSched) {
                console.warn('[Portal Guru Mapel] Deteksi jadwal otomatis dilewati:', errSched);
            }

            kelasSelect.value = targetKelas;
            window.onKelasChange(preferredMapel);

            if (detectedInfo) {
                renderScheduleIndicator(detectedInfo);
            }
        } else {
            const mapelSelect = document.getElementById('select-mapel');
            if (mapelSelect) {
                mapelSelect.innerHTML = '<option value="">-- Tidak ada mapel --</option>';
                window.adjustMapelSelectWidth();
            }
            updateHeaderGuruName('', '');
            if (!isSuperOrAdmin) {
                showToast('Info Penugasan', 'Akun Anda belum terdaftar mengampu kelas/mapel di Pengaturan Rapor.', 'warning');
            }
        }

    } catch (e) {
        console.error('[Portal Guru Mapel] Error loading teacher scope:', e);
        showToast('Gagal Memuat Scope', 'Tidak dapat memuat penugasan mapel guru.', 'error');
    }
}

// Render Badge & Visual Indicator Jadwal Mengajar Aktif
let activeScheduleSlotInfo = null;

function renderScheduleIndicator(info) {
    activeScheduleSlotInfo = info;
    const badge = document.getElementById('header-schedule-badge');
    const textEl = document.getElementById('header-schedule-text');
    if (!badge || !textEl || !info) return;

    let badgeText = '';
    let toastTitle = 'Jadwal Mengajar Terdeteksi';
    let toastMsg = '';

    if (info.reason === 'exact_current_jp') {
        badgeText = `JP ${info.jp} Aktif: ${info.className} • ${info.mapel}`;
        toastTitle = '🕒 Jam Mengajar Aktif';
        toastMsg = `Otomatis memfilter Kelas ${info.className} - ${info.mapel} pada Jam Pelajaran ke-${info.jp}.`;
    } else if (info.reason === 'upcoming_jp') {
        badgeText = `JP ${info.jp} (Mendatang): ${info.className} • ${info.mapel}`;
        toastTitle = '📅 Jadwal Mengajar Berikutnya';
        toastMsg = `Otomatis memfilter Kelas ${info.className} - ${info.mapel} untuk JP ke-${info.jp} hari ini.`;
    } else if (info.reason === 'recent_jp') {
        badgeText = `JP ${info.jp}: ${info.className} • ${info.mapel}`;
        toastTitle = '📅 Jadwal Mengajar Hari Ini';
        toastMsg = `Otomatis memfilter Kelas ${info.className} - ${info.mapel} (JP ${info.jp}).`;
    } else {
        badgeText = `Jadwal Hari Ini: JP ${info.jp} (${info.className})`;
        toastTitle = '📅 Jadwal Mengajar Hari Ini';
        toastMsg = `Otomatis memfilter Kelas ${info.className} - ${info.mapel} (JP ${info.jp}).`;
    }

    textEl.textContent = badgeText;
    badge.title = `Klik untuk memfilter ulang ke ${info.className} - ${info.mapel} (JP ${info.jp})`;
    badge.classList.remove('hidden');
    badge.classList.add('inline-flex');

    badge.onclick = () => {
        const kelasSelect = document.getElementById('select-kelas');
        if (kelasSelect) {
            kelasSelect.value = info.className;
            window.onKelasChange(info.mapel);
            showToast('Filter Diterapkan', `Memfilter kembali ke ${info.className} - ${info.mapel} (JP ${info.jp})`, 'info');
        }
    };

    // Tampilkan toast informatif jika exact atau upcoming
    if (info.reason === 'exact_current_jp' || info.reason === 'upcoming_jp') {
        showToast(toastTitle, toastMsg, 'info');
    }
}

// Handler saat KELAS berubah (PERTAMA) -> Filter Mapel
window.onKelasChange = function (preferredMapel = null) {
    if (deferUnsavedPortalFilterChange('select-kelas', () => window.onKelasChange(preferredMapel))) return;
    selectedJurnalMonth = null;
    currentLoadedGradebookScope = '';
    currentLoadedKehadiranScope = '';
    currentLoadedJurnalScope = '';
    currentLoadedLmsScope = '';
    const selectedKelas = document.getElementById('select-kelas')?.value;
    const mapelSelect = document.getElementById('select-mapel');
    if (!mapelSelect) return;

    mapelSelect.innerHTML = '<option value="">-- Mapel --</option>';

    if (!selectedKelas) {
        window.adjustMapelSelectWidth();
        window.checkAutoLoadSessionCache();
        return;
    }

    // Ambil hanya mapel yang memang ada di kelas ini (berlaku untuk seluruh role, termasuk Super Admin)
    const allowedMapels = getMapelsForClass(assignedMapelMap, selectedKelas);

    if (allowedMapels.length === 0) {
        mapelSelect.innerHTML = '<option value="">-- Tidak ada mapel --</option>';
        window.adjustMapelSelectWidth();
        window.checkAutoLoadSessionCache();
        return;
    }

    allowedMapels.forEach(m => {
        mapelSelect.innerHTML += `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`;
    });

    // Otomatis pilih mapel:
    // 1. Jika ada preferredMapel (misal dari deteksi jadwal aktif), cocokkan kandidat namanya
    // 2. Jika ada mapel yang sebelumnya dipilih user dan mapel tersebut juga ada di kelas ini, pertahankan
    // 3. Fallback: pilih mapel pertama dalam daftar
    let chosenMapel = allowedMapels[0];
    const targetCandidate = preferredMapel || mapelSelect.dataset.prevMapel;
    if (targetCandidate) {
        const candidates = getMapelNameCandidates(targetCandidate);
        const matched = allowedMapels.find(m => {
            const mClean = m.trim().toLowerCase();
            return candidates.some(cand => cand.trim().toLowerCase() === mClean) ||
                   mClean === targetCandidate.trim().toLowerCase() ||
                   mClean.replace(/[^a-z0-9]/gi, '') === targetCandidate.replace(/[^a-z0-9]/gi, '').toLowerCase();
        });
        if (matched) {
            chosenMapel = matched;
        }
    }

    mapelSelect.value = chosenMapel;
    mapelSelect.dataset.prevMapel = chosenMapel;

    window.adjustMapelSelectWidth();
    updateHeaderGuruName(selectedKelas, chosenMapel);
    window.checkAutoLoadSessionCache();
};

window.adjustMapelSelectWidth = function () {
    const selectElem = document.getElementById('select-mapel');
    if (!selectElem) return;
    const selectedOption = selectElem.options[selectElem.selectedIndex];
    const text = selectedOption ? selectedOption.text : selectElem.value;
    if (!text || text.includes('-- Mapel --') || text.includes('-- Pilih Mapel --')) {
        selectElem.style.width = '100px';
        return;
    }
    const isMobile = window.innerWidth < 640;
    const charLen = text.length;
    const maxAllowedWidth = isMobile ? Math.min(Math.max(window.innerWidth - 170, 140), 220) : 380;
    const calcWidth = Math.min(Math.max(charLen * 7.2 + 28, 90), maxAllowedWidth);
    selectElem.style.width = `${calcWidth}px`;
};

// Resizing Listener untuk responsivitas dinamis saat putar layar/resize
window.addEventListener('resize', () => {
    if (typeof window.adjustMapelSelectWidth === 'function') {
        window.adjustMapelSelectWidth();
    }
});

// Listener Event Pembaruan Jadwal XML SSOT Real-Time
window.addEventListener('simas-schedule-updated', async (e) => {
    console.log('[Portal Guru Mapel] Jadwal XML baru terdeteksi via SSOT:', e.detail);
    await loadTeacherScope();
});

window.onMapelChange = function () {
    if (deferUnsavedPortalFilterChange('select-mapel', () => window.onMapelChange())) return;
    const mapelSelect = document.getElementById('select-mapel');
    const selectedKelas = document.getElementById('select-kelas')?.value;
    if (mapelSelect && mapelSelect.value) {
        mapelSelect.dataset.prevMapel = mapelSelect.value;
    }
    selectedJurnalMonth = null;
    currentLoadedGradebookScope = '';
    currentLoadedKehadiranScope = '';
    currentLoadedJurnalScope = '';
    currentLoadedLmsScope = '';
    // Soft reset saat mapel dipilih manual
    window.adjustMapelSelectWidth();
    updateHeaderGuruName(selectedKelas, mapelSelect?.value);
    window.checkAutoLoadSessionCache();
};

window.onSemesterChange = function () {
    if (deferUnsavedPortalFilterChange('select-semester', () => window.onSemesterChange())) return;
    const sem = document.getElementById('select-semester').value;
    const labelSasSat = document.getElementById('label-weight-sas-sat');
    if (labelSasSat) {
        labelSasSat.textContent = sem === '1' ? 'Ujian SAS (%)' : 'Ujian SAT (%)';
    }
    selectedJurnalMonth = null;
    currentLoadedGradebookScope = '';
    currentLoadedKehadiranScope = '';
    currentLoadedJurnalScope = '';
    currentLoadedLmsScope = '';
    window.checkAutoLoadSessionCache();
};

// Modal Handler Bobot & Kolom
window.openConfigModal = function () {
    updateModalVisibilityOptions();
    const modal = document.getElementById('modal-config-weight');
    if (modal) modal.classList.remove('hidden');
};

window.closeConfigModal = function () {
    const modal = document.getElementById('modal-config-weight');
    if (modal) modal.classList.add('hidden');
};

function updateModalVisibilityOptions() {
    const selTugas = document.getElementById('select-visible-tugas');
    const selSumatif = document.getElementById('select-visible-sumatif');

    if (selTugas) {
        selTugas.value = visibleTugasCount;
        Array.from(selTugas.options).forEach(opt => {
            const val = parseInt(opt.value);
            if (val < minRequiredTugasCount) {
                opt.disabled = true;
                opt.textContent = `${val} Kolom (Tugas 1 - ${val}) [Ada Nilai]`;
            } else {
                opt.disabled = false;
                opt.textContent = `${val} Kolom (Tugas 1 - ${val})`;
            }
        });
    }

    if (selSumatif) {
        selSumatif.value = visibleSumatifCount;
        Array.from(selSumatif.options).forEach(opt => {
            const val = parseInt(opt.value);
            if (val < minRequiredSumatifCount) {
                opt.disabled = true;
                opt.textContent = `${val} Kolom (Sumatif 1 - ${val}) [Ada Nilai]`;
            } else {
                opt.disabled = false;
                opt.textContent = `${val} Kolom (Sumatif 1 - ${val})`;
            }
        });
    }
}

let sessionGradebookCache = {};

// =========================================================================
// 5. LOAD GRADEBOOK DATA (STUDENTS & SUPABASE SCORES)
// =========================================================================
window.loadGradebookData = function (forceReFetch = true) {
    return confirmUnsavedChanges(() => executeLoadGradebookData(forceReFetch));
};

window.getLoadedStudents = function () {
    return Array.isArray(loadedStudents) ? loadedStudents : [];
};

// Daftar seluruh kolom komponen nilai (termasuk yang sedang disembunyikan) untuk modul Koreksi AI
window.getGradebookColumnOptions = function () {
    const semester = document.getElementById('select-semester')?.value || '1';
    const base = semester === '2' ? ALL_COLUMNS_S2 : ALL_COLUMNS_S1;
    return base.map(col => ({ key: col.key, label: col.label, type: col.type }));
};

// Menampilkan kolom komponen nilai tertentu tanpa membuang nilai yang sudah diketik tetapi belum disimpan
window.ensureGradebookColumnVisible = function (colKey) {
    const match = String(colKey || '').match(/^(tugas|sumatif)_(\d+)$/);
    if (!match) return false;

    const num = parseInt(match[2], 10);
    const nextTugas = match[1] === 'tugas' ? Math.max(visibleTugasCount, Math.min(5, num)) : visibleTugasCount;
    const nextSumatif = match[1] === 'sumatif' ? Math.max(visibleSumatifCount, Math.min(5, num)) : visibleSumatifCount;
    if (nextTugas === visibleTugasCount && nextSumatif === visibleSumatifCount) return false;

    const pendingValues = [];
    document.querySelectorAll('#gradebook-tbody tr[data-nis] .score-input').forEach(inp => {
        pendingValues.push({ nis: inp.closest('tr')?.dataset.nis, key: inp.dataset.colKey, value: inp.value });
    });

    visibleTugasCount = nextTugas;
    visibleSumatifCount = nextSumatif;
    const selTugas = document.getElementById('select-visible-tugas');
    const selSumatif = document.getElementById('select-visible-sumatif');
    if (selTugas) selTugas.value = visibleTugasCount;
    if (selSumatif) selSumatif.value = visibleSumatifCount;

    const mapel = document.getElementById('select-mapel')?.value || '';
    const kelas = document.getElementById('select-kelas')?.value || '';
    const semester = document.getElementById('select-semester')?.value || '1';
    const tahunAjaran = raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString();
    if (mapel && kelas) {
        const gradebookId = `${tahunAjaran.replace('/', '-')}_S${semester}_${kelas.replace(/\s+/g, '_')}_${mapel.replace(/\s+/g, '_')}`;
        saveLocalConfig(mapel, kelas, gradebookId);
    }

    activeColumns = getActiveColumns(semester);
    renderGradebookTable(semester);

    pendingValues.forEach(({ nis, key, value }) => {
        if (!nis || !key) return;
        const inp = document.querySelector(`#gradebook-tbody tr[data-nis="${CSS.escape(nis)}"] .score-input[data-col-key="${CSS.escape(key)}"]`);
        if (inp && inp.value !== value) {
            inp.value = value;
            window.onScoreInputChange(inp);
        }
    });
    return true;
};

window.resetPortalTablesToEmpty = function () {
    portalDataRevision++;
    const mapel = document.getElementById('select-mapel')?.value || '';
    const kelas = document.getElementById('select-kelas')?.value || '';
    const semester = document.getElementById('select-semester')?.value || '1';

    // 1. Reset state Penilaian & Trackers
    loadedStudents = [];
    existingScoresMap = {};
    existingSummariesMap = {};
    window._lastKehadiranRekapData = [];
    supabaseComponentMap = {};
    minRequiredTugasCount = 1;
    minRequiredSumatifCount = 1;
    setGradebookDirty(false);
    currentLoadedGradebookScope = '';
    currentLoadedKehadiranScope = '';
    currentLoadedJurnalScope = '';
    currentLoadedLmsScope = '';
    const btnLoad = document.getElementById('btn-load-data');
    if (btnLoad) {
        btnLoad.innerHTML = '<i class="fa-solid fa-rotate text-[9px]"></i> <span>Load</span>';
        btnLoad.disabled = false;
    }

    const studentCountBadge = document.getElementById('student-count-badge');
    if (studentCountBadge) studentCountBadge.textContent = '0 Siswa';

    const wrapperClassCp = document.getElementById('wrapper-class-cp');
    if (wrapperClassCp) wrapperClassCp.classList.add('hidden');

    const analyticsWrapper = document.getElementById('gradebook-analytics-wrapper');
    if (analyticsWrapper) analyticsWrapper.classList.add('hidden');

    const topSaveBar = document.getElementById('top-save-bar');
    if (topSaveBar) {
        topSaveBar.classList.add('hidden');
        topSaveBar.classList.remove('flex');
    }
    const bottomSaveBar = document.getElementById('bottom-save-bar');
    if (bottomSaveBar) {
        bottomSaveBar.classList.add('hidden');
        bottomSaveBar.classList.remove('flex');
    }

    const kehadiranFilterBar = document.getElementById('kehadiran-filter-bar');
    if (kehadiranFilterBar) {
        kehadiranFilterBar.classList.add('hidden');
        kehadiranFilterBar.classList.remove('flex');
    }

    // 2. Kosongkan Tabel Penilaian
    const wrapperPenilaian = document.getElementById('gradebook-table-wrapper');
    if (wrapperPenilaian) {
        wrapperPenilaian.innerHTML = `
            <div id="gradebook-empty-state" class="flex flex-col items-center justify-center p-12 text-center text-slate-400">
                <i class="fa-solid fa-hand-pointer text-4xl mb-3 text-emerald-500/50"></i>
                <p class="font-bold text-slate-700 dark:text-slate-200 text-sm">Pilih Kelas & Mata Pelajaran</p>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                    ${(kelas && mapel) ? `Data penilaian untuk <b>${escapeHTML(kelas)} - ${escapeHTML(mapel)}</b> belum dimuat. Klik tombol <b>Load</b> di bawah atau di samping filter untuk membuka lembar penilaian.` : 'Pilih kelas dan mapel pengampu Anda pada baris filter di atas, lalu klik tombol <b>Load</b> untuk membuka lembar penilaian.'}
                </p>
                <button type="button" onclick="window.loadGradebookData()" id="btn-center-load-gradebook"
                    class="mt-4 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer">
                    <i class="fa-solid fa-rotate text-xs"></i>
                    <span>${(kelas && mapel) ? `Muat Data ${escapeHTML(kelas)} - ${escapeHTML(mapel)}` : 'Muat Data (Load)'}</span>
                </button>
            </div>
        `;
    }

    // 3. Kosongkan Tabel Kehadiran
    const wrapperKehadiran = document.getElementById('kehadiran-table-wrapper');
    if (wrapperKehadiran) {
        wrapperKehadiran.innerHTML = `
            <div id="kehadiran-empty-state" class="flex flex-col items-center justify-center p-12 text-center text-slate-400">
                <i class="fa-solid fa-user-check text-4xl mb-3 text-emerald-500/50"></i>
                <p class="font-bold text-slate-700 dark:text-slate-200 text-sm">Rekap Kehadiran Siswa</p>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                    ${(kelas && mapel) ? `Rekap presensi untuk <b>${escapeHTML(kelas)} - ${escapeHTML(mapel)}</b> belum dimuat. Klik tombol <b>Load</b> di bawah atau di samping filter untuk memuat rekap kehadiran.` : 'Pilih kelas & mapel pada filter di atas, lalu klik tombol <b>Load</b> untuk memuat rekap kehadiran harian.'}
                </p>
                <button type="button" onclick="window.loadGradebookData()" id="btn-center-load-kehadiran"
                    class="mt-4 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer">
                    <i class="fa-solid fa-rotate text-xs"></i>
                    <span>${(kelas && mapel) ? `Muat Rekap Kehadiran ${escapeHTML(kelas)}` : 'Muat Data Kehadiran (Load)'}</span>
                </button>
            </div>
        `;
    }

    // 4. Kosongkan Tabel Jurnal
    currentJurnalAllList = [];
    selectedJurnalMonth = null;
    const filterBarJurnal = document.getElementById('jurnal-filter-bar');
    if (filterBarJurnal) {
        filterBarJurnal.classList.add('hidden');
        filterBarJurnal.classList.remove('flex');
    }

    const wrapperJurnal = document.getElementById('jurnal-table-wrapper');
    if (wrapperJurnal) {
        wrapperJurnal.innerHTML = `
            <div id="jurnal-empty-state" class="flex flex-col items-center justify-center p-12 text-center text-slate-400">
                <i class="fa-solid fa-book-open text-4xl mb-3 text-emerald-500/50"></i>
                <p class="font-bold text-slate-700 dark:text-slate-200 text-sm">Daftar Jurnal Mengajar</p>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                    ${(kelas && mapel) ? `Daftar jurnal untuk <b>${escapeHTML(kelas)} - ${escapeHTML(mapel)}</b> belum dimuat. Klik tombol <b>Load</b> di bawah atau di samping filter untuk memuat rekam jurnal mengajar.` : 'Pilih kelas & mapel pada filter di atas, lalu klik tombol <b>Load</b> untuk memuat rekam jurnal mengajar.'}
                </p>
                <button type="button" onclick="window.loadGradebookData()" id="btn-center-load-jurnal"
                    class="mt-4 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer">
                    <i class="fa-solid fa-rotate text-xs"></i>
                    <span>${(kelas && mapel) ? `Muat Jurnal ${escapeHTML(kelas)}` : 'Muat Daftar Jurnal (Load)'}</span>
                </button>
            </div>
        `;
    }

    // Clear LMS materials and analytics, including requests still in flight.
    lmsLoadSequence++;
    currentLmsTopics = [];
    currentLmsModules = [];
    currentLmsMaterials = [];
    currentLmsAnalytics = null;
    currentLmsAnalyticsTopicId = '';
    currentLmsAnalyticsMaterialId = '';
    lmsAnalyticsCache = new Map();
    populateLmsAnalyticsTopicSelector();
    renderLmsClassAnalytics();
    const lmsTopics = document.getElementById('lms-topics-container');
    if (lmsTopics) lmsTopics.innerHTML = '';
    document.getElementById('lms-materials-empty-state')?.classList.remove('hidden');
    document.getElementById('lms-materials-health-summary')?.classList.add('hidden');
    ['select-lms-analytics-topic', 'select-lms-analytics-material'].forEach(id => {
        const select = document.getElementById(id);
        if (select) select.disabled = false;
    });

    // 5. Update Table Scope Title
    const scopeTitle = document.getElementById('table-scope-title');
    const panelKehadiran = document.getElementById('panel-kehadiran');
    const panelJurnal = document.getElementById('panel-jurnal');
    const isKehadiranActive = panelKehadiran && !panelKehadiran.classList.contains('hidden');
    const isJurnalActive = panelJurnal && !panelJurnal.classList.contains('hidden');
    const isLmsActive = document.getElementById('panel-lms')?.classList.contains('hidden') === false;
    const isAiActive = document.getElementById('panel-koreksi-ai')?.classList.contains('hidden') === false;

    if (scopeTitle) {
        if (isAiActive) {
            scopeTitle.textContent = (mapel && kelas) ? `Koreksi Asesmen AI ${mapel} - ${kelas} (Semester ${semester})` : 'Koreksi Asesmen Siswa Otomatis Berbasis Gemini AI';
        } else if (isLmsActive) {
            scopeTitle.textContent = (mapel && kelas) ? `LMS & Modul Ajar ${mapel} - ${kelas} (Semester ${semester})` : 'LMS / Modul Ajar Siswa';
        } else if (isJurnalActive) {
            scopeTitle.textContent = (mapel && kelas) ? `Daftar Jurnal ${mapel} - ${kelas} (Semester ${semester})` : 'Daftar Jurnal Mengajar';
        } else if (isKehadiranActive) {
            scopeTitle.textContent = (mapel && kelas) ? `Rekap Kehadiran ${mapel} - ${kelas} (Semester ${semester})` : 'Rekap Kehadiran Siswa';
        } else {
            scopeTitle.textContent = (mapel && kelas) ? `Penilaian ${mapel} - ${kelas} (Semester ${semester})` : 'Lembar Penilaian Siswa';
        }
    }

    updateHeaderGuruName(kelas, mapel);
    if (typeof window.syncAiGradingScope === 'function') window.syncAiGradingScope({ kelas, mapel, semester, tahunAjaran: raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString() });
    if (typeof window.renderStudentSubmissionsUI === 'function') window.renderStudentSubmissionsUI();
};

window.checkAutoLoadSessionCache = function () {
    const mapel = document.getElementById('select-mapel')?.value;
    const kelas = document.getElementById('select-kelas')?.value;
    const semester = document.getElementById('select-semester')?.value;
    const tahunAjaran = raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString();
    if (isGradebookDirty) return;
    portalFilterSelection = getPortalFilterSelection();
    // Reset every panel before restoring/loading the active filter, including hidden tabs.
    window.resetPortalTablesToEmpty();
    if (mapel && kelas && semester) {
        const gradebookId = `${tahunAjaran.replace('/', '-')}_S${semester}_${kelas.replace(/\s+/g, '_')}_${mapel.replace(/\s+/g, '_')}`;
        if (sessionGradebookCache[gradebookId] && !isGradebookDirty) {
            console.log(`[Portal Guru Mapel] ⚡ Cache ditemukan untuk ${gradebookId}, memuat otomatis dari cache...`);
            return window.loadGradebookData(false);
        } else {
            const tab = ['penilaian', 'kehadiran', 'jurnal', 'lms', 'koreksi-ai'].find(name =>
                document.getElementById(`panel-${name}`)?.classList.contains('hidden') === false);
            if (previouslyLoadedPortalTabs.has(tab)) return window.loadGradebookData(false);
        }
    }
};

async function executeLoadGradebookData(forceReFetch = true) {
    const isCurrentLoad = beginPortalDataLoad('penilaian');
    portalFilterSelection = getPortalFilterSelection();
    const mapel = document.getElementById('select-mapel').value;
    const kelas = document.getElementById('select-kelas').value;
    const semester = document.getElementById('select-semester').value;
    const tahunAjaran = raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString();

    if (!mapel || !kelas) {
        showToast('Pilih Mapel & Kelas', 'Silakan pilih Mata Pelajaran dan Rombel Kelas terlebih dahulu.', 'warning');
        if (!kelas) {
            document.getElementById('select-kelas')?.focus();
        } else if (!mapel) {
            document.getElementById('select-mapel')?.focus();
        }
        return;
    }

    updateHeaderGuruName(kelas, mapel);

    const gradebookId = `${tahunAjaran.replace('/', '-')}_S${semester}_${kelas.replace(/\s+/g, '_')}_${mapel.replace(/\s+/g, '_')}`;
    const currentScope = `${tahunAjaran}_${semester}_${kelas}_${mapel}`;

    const panelPenilaian = document.getElementById('panel-penilaian');
    const panelKehadiran = document.getElementById('panel-kehadiran');
    const panelJurnal = document.getElementById('panel-jurnal');
    const panelLms = document.getElementById('panel-lms');

    const isKehadiranActive = panelKehadiran && !panelKehadiran.classList.contains('hidden');
    const isJurnalActive = panelJurnal && !panelJurnal.classList.contains('hidden');
    const isLmsActive = panelLms && !panelLms.classList.contains('hidden');

    // ⚡ BUKA DARI CACHE SESI (0 READS) JIKA PERNAH DIBUKA DALAM SESI INI
    if (!forceReFetch && sessionGradebookCache[gradebookId]) {
        console.log(`[Portal Guru Mapel] ⚡ Auto-Load dari Cache Sesi (0 Reads): ${gradebookId}`);
        const sessionData = sessionGradebookCache[gradebookId];
        loadedStudents = sessionData.students || [];
        existingScoresMap = JSON.parse(JSON.stringify(sessionData.scoresMap || {}));
        existingSummariesMap = JSON.parse(JSON.stringify(sessionData.summariesMap || {}));
        supabaseComponentMap = { ...sessionData.componentMap };
        minRequiredTugasCount = sessionData.minTugas || 1;
        minRequiredSumatifCount = sessionData.minSumatif || 1;

        const studentCountBadge = document.getElementById('student-count-badge');
        if (studentCountBadge) studentCountBadge.textContent = `${loadedStudents.length} Siswa`;

        loadLocalConfig(mapel, kelas, semester, gradebookId);
        renderGradebookTable(semester);
        setGradebookDirty(false);
        currentLoadedGradebookScope = currentScope;
        previouslyLoadedPortalTabs.add('penilaian');
        if (typeof window.renderStudentSubmissionsUI === 'function') window.renderStudentSubmissionsUI();

        // Jika user sedang di tab non-penilaian, muat tab tersebut jika belum sesuai scope
        if (isKehadiranActive && currentLoadedKehadiranScope !== currentScope && typeof window.loadKehadiranSiswaData === 'function') {
            window.loadKehadiranSiswaData(false);
        } else if (isJurnalActive && currentLoadedJurnalScope !== currentScope && typeof window.loadDaftarJurnalData === 'function') {
            window.loadDaftarJurnalData(false);
        } else if (isLmsActive && currentLoadedLmsScope !== currentScope && typeof window.loadLmsData === 'function') {
            window.loadLmsData(false);
        }

        const scopeTitle = document.getElementById('table-scope-title');
        if (scopeTitle) {
            if (isJurnalActive) {
                scopeTitle.textContent = `Daftar Jurnal ${mapel} - ${kelas} (Semester ${semester})`;
            } else if (isKehadiranActive) {
                scopeTitle.textContent = `Rekap Kehadiran ${mapel} - ${kelas} (Semester ${semester})`;
            } else if (isLmsActive) {
                scopeTitle.textContent = `LMS & Modul Ajar ${mapel} - ${kelas} (Semester ${semester})`;
            } else {
                scopeTitle.textContent = `Penilaian ${mapel} - ${kelas} (Semester ${semester})`;
            }
        }
        return;
    }

    const btnLoad = document.getElementById('btn-load-data');
    if (btnLoad) {
        btnLoad.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i> Loading...';
        btnLoad.disabled = true;
    }

    const wrapperPenilaian = document.getElementById('gradebook-table-wrapper');

    try {
        if (forceReFetch) {
            currentLoadedKehadiranScope = '';
            currentLoadedJurnalScope = '';
            currentLoadedLmsScope = '';
        }

        if (isKehadiranActive) {
            await window.loadKehadiranSiswaData(forceReFetch);
        } else if (isJurnalActive) {
            await window.loadDaftarJurnalData(forceReFetch);
        } else if (isLmsActive) {
            if (typeof window.loadLmsData === 'function') {
                await window.loadLmsData(forceReFetch);
            }
        } else {
            // Prioritas: Tab Penilaian (Nilai)
            if (wrapperPenilaian) {
                wrapperPenilaian.innerHTML = '<div class="text-center py-12 text-slate-400 dark:text-slate-500"><i class="fa-solid fa-spinner fa-spin text-3xl mb-2 text-emerald-500"></i><br><span class="text-sm font-semibold">Memuat lembar penilaian...</span></div>';
            }

            // A. Fetch Roster Siswa & Fetch Skor Supabase secara PARALEL (0 Blocking)
            const fetchStudentsTask = (async () => {
                let loadedStudents = [];
                const cacheStudentsKey = `cache_students_${tahunAjaran.replace('/', '-')}_${kelas.replace(/\s+/g, '_')}`;
                const cachedStudents = sessionPortalDataCache.get(cacheStudentsKey) || getLocalCache(cacheStudentsKey);

                if (Array.isArray(cachedStudents)) {
                    console.log(`[Portal Guru Mapel] Menggunakan cache siswa kelas ${kelas} (0 Reads)`);
                    loadedStudents = cachedStudents;
                    let tempAlpha = [...loadedStudents].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id'));
                    tempAlpha.forEach((student, idx) => {
                        if (!student.noAbsen) {
                            student.noAbsen = student.no_absen && !isNaN(parseInt(student.no_absen)) ? parseInt(student.no_absen) : (idx + 1);
                        }
                    });
                    sessionPortalDataCache.set(cacheStudentsKey, loadedStudents);
                    return loadedStudents;
                }

                // Prioritaskan cache IndexedDB terpusat (0 Reads)
                let studentsFromCache = null;
                if (typeof window.getStudentsCache === 'function') {
                    try {
                        const allStudents = await window.getStudentsCache();
                        if (allStudents && allStudents.length > 0) {
                            studentsFromCache = allStudents.filter(s =>
                                (s.class === kelas || s.kelas === kelas || isClassEqual(s.class || s.kelas, kelas)) &&
                                (typeof window.isStudentActive === 'function' ? window.isStudentActive(s) : (s.status === 'active' || !s.is_alumni))
                            );
                        }
                    } catch (e) { console.warn('[GuruMapel] getStudentsCache error:', e); }
                }

                if (studentsFromCache && studentsFromCache.length > 0) {
                    console.log(`[Portal Guru Mapel] Menggunakan IndexedDB siswa kelas ${kelas} (0 Reads)`);
                    loadedStudents = studentsFromCache;
                } else {
                    try {
                        if (cfClient && cfClient.enabled) {
                            const cfStudents = await cfClient.getStudents({ class: kelas, limit: 100 });
                            if (Array.isArray(cfStudents) && cfStudents.length > 0) {
                                loadedStudents = cfStudents.filter(s =>
                                    typeof window.isStudentActive === 'function' ? window.isStudentActive(s) : (s.status === 'active' || !s.is_alumni)
                                );
                                console.log(`[Portal Guru Mapel] Memuat ${loadedStudents.length} siswa dari Cloudflare D1 (0 Read)`);
                            }
                        }
                    } catch (cfErr) {
                        console.warn('[GuruMapel] Gagal memuat siswa dari Cloudflare D1:', cfErr);
                    }

                    if (!loadedStudents || loadedStudents.length === 0) {
                        const allStudents = typeof window.getStudentsCache === 'function' ? await window.getStudentsCache() : [];
                        loadedStudents = allStudents.filter(s =>
                            (s.class === kelas || s.kelas === kelas || isClassEqual(s.class || s.kelas, kelas)) &&
                            (typeof window.isStudentActive === 'function' ? window.isStudentActive(s) : (s.status === 'active' || !s.is_alumni))
                        );
                    }
                }

                loadedStudents.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id'));
                loadedStudents.forEach((student, idx) => {
                    student.noAbsen = student.no_absen && !isNaN(parseInt(student.no_absen)) ? parseInt(student.no_absen) : (idx + 1);
                });

                if (loadedStudents.length > 0) {
                    setLocalCache(cacheStudentsKey, loadedStudents, 24 * 60 * 60 * 1000);
                }
                if (isCurrentLoad()) sessionPortalDataCache.set(cacheStudentsKey, loadedStudents);
                return loadedStudents;
            })();

            const fetchScoresTask = (async () => {
                loadLocalConfig(mapel, kelas, semester, gradebookId);
                await fetchScoresFromSupabase(gradebookId, isCurrentLoad);
            })();

            const [students] = await Promise.all([fetchStudentsTask, fetchScoresTask]);
            if (!isCurrentLoad()) return;
            loadedStudents = students;

            const studentCountBadge = document.getElementById('student-count-badge');
            if (studentCountBadge) studentCountBadge.textContent = `${loadedStudents.length} Siswa`;

            previouslyLoadedPortalTabs.add('penilaian');
            currentLoadedGradebookScope = currentScope;
            if (loadedStudents.length === 0) {
                sessionGradebookCache[gradebookId] = {
                    students: [],
                    scoresMap: JSON.parse(JSON.stringify(existingScoresMap)),
                    summariesMap: JSON.parse(JSON.stringify(existingSummariesMap)),
                    componentMap: { ...supabaseComponentMap },
                    minTugas: minRequiredTugasCount,
                    minSumatif: minRequiredSumatifCount
                };
                if (wrapperPenilaian) wrapperPenilaian.innerHTML = '<div class="text-center py-12 text-slate-400">Tidak ada data siswa di kelas ini.</div>';
                return;
            }

            renderGradebookTable(semester);
            setGradebookDirty(false);
            currentLoadedGradebookScope = currentScope;
            previouslyLoadedPortalTabs.add('penilaian');
            if (typeof window.renderStudentSubmissionsUI === 'function') window.renderStudentSubmissionsUI();

            // ⚡ SIMPAN KE CACHE SESI (In-Memory Sesuai Aturan Pengguna)
            sessionGradebookCache[gradebookId] = {
                students: [...loadedStudents],
                scoresMap: JSON.parse(JSON.stringify(existingScoresMap)),
                summariesMap: JSON.parse(JSON.stringify(existingSummariesMap)),
                componentMap: { ...supabaseComponentMap },
                minTugas: minRequiredTugasCount,
                minSumatif: minRequiredSumatifCount
            };
        }

        if (!isCurrentLoad()) return;
        const scopeTitle = document.getElementById('table-scope-title');
        if (scopeTitle) {
            if (isLmsActive) {
                scopeTitle.textContent = `LMS & Modul Ajar ${mapel} - ${kelas} (Semester ${semester})`;
            } else if (isJurnalActive) {
                scopeTitle.textContent = `Daftar Jurnal ${mapel} - ${kelas} (Semester ${semester})`;
            } else if (isKehadiranActive) {
                scopeTitle.textContent = `Rekap Kehadiran ${mapel} - ${kelas} (Semester ${semester})`;
            } else {
                scopeTitle.textContent = `Penilaian ${mapel} - ${kelas} (Semester ${semester})`;
            }
        }

    } catch (e) {
        if (!isCurrentLoad()) return;
        console.error('[Portal Guru Mapel] Error load gradebook data:', e);
        showModernAlert('Gagal Memuat Data', e.message, 'error');
        if (wrapperPenilaian) {
            wrapperPenilaian.innerHTML = `
                <div class="flex flex-col items-center justify-center p-12 text-center text-rose-500 font-semibold gap-3">
                    <i class="fa-solid fa-circle-exclamation text-3xl"></i>
                    <p class="text-sm">Gagal memuat lembar penilaian: ${escapeHTML(e.message || 'Terjadi kesalahan.')}</p>
                    <button type="button" onclick="window.loadGradebookData()" class="mt-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-xs font-bold rounded-xl shadow transition cursor-pointer flex items-center gap-1.5">
                        <i class="fa-solid fa-rotate text-xs"></i>
                        <span>Coba Muat Ulang</span>
                    </button>
                </div>
            `;
        }
    } finally {
        if (btnLoad && isCurrentLoad()) {
            btnLoad.innerHTML = '<i class="fa-solid fa-rotate text-[9px]"></i> <span>Load</span>';
            btnLoad.disabled = false;
        }
    }
};

// Helper mengekstrak Tingkat/Angkatan dari Rombel Kelas (misal: "XI-1" -> "XI", "XII MIPA 2" -> "XII", "X-3" -> "X")
function getTingkatFromKelas(kelasName) {
    if (!kelasName) return 'ALL';
    const clean = kelasName.trim().toUpperCase();
    if (clean.startsWith('XII') || clean.startsWith('12')) return 'XII';
    if (clean.startsWith('XI') || clean.startsWith('11')) return 'XI';
    if (clean.startsWith('X') || clean.startsWith('10')) return 'X';
    const match = clean.match(/^(XII|XI|X|\d+)/i);
    return match ? match[1] : 'ALL';
}

// =========================================================================
// 6. LOCAL CONFIGURATION (SCOPED PER MAPEL & TINGKAT ANGKATAN)
// =========================================================================
function loadLocalConfig(mapel, kelas, semester, gradebookId) {
    const tingkat = getTingkatFromKelas(kelas);
    const scopeKey = mapel && kelas ? `${mapel.replace(/\s+/g, '_')}_${tingkat}` : gradebookId;

    // 1. Load Weights (Prioritas Scope Per Mapel + Tingkat)
    const savedWeightsKey = `simas_weights_${currentUser.uid}_${scopeKey}`;
    const savedWeightsKeyGb = `simas_weights_${currentUser.uid}_${gradebookId}`;
    const savedWeights = localStorage.getItem(savedWeightsKey) || localStorage.getItem(savedWeightsKeyGb);

    if (savedWeights) {
        try {
            weights = JSON.parse(savedWeights);
        } catch (e) {
            weights = { tugas: 20, sumatif: 40, sas: 40 };
        }
    } else {
        weights = { tugas: 20, sumatif: 40, sas: 40 };
    }

    document.getElementById('input-weight-tugas').value = weights.tugas;
    document.getElementById('input-weight-sumatif').value = weights.sumatif;
    document.getElementById('input-weight-sas').value = weights.sas;
    updateWeightsUI();

    // 2. Load Column Visibility (Prioritas Scope Per Mapel + Tingkat)
    const savedVisKey = `simas_visibility_${currentUser.uid}_${scopeKey}`;
    const savedVisKeyGb = `simas_visibility_${currentUser.uid}_${gradebookId}`;
    const savedVis = localStorage.getItem(savedVisKey) || localStorage.getItem(savedVisKeyGb);

    if (savedVis) {
        try {
            const parsed = JSON.parse(savedVis);
            visibleTugasCount = Math.min(5, Math.max(1, parseInt(parsed.tugas) || 1));
            visibleSumatifCount = Math.min(5, Math.max(1, parseInt(parsed.sumatif) || 1));
        } catch (e) {
            visibleTugasCount = 1;
            visibleSumatifCount = 1;
        }
    } else {
        visibleTugasCount = 1;
        visibleSumatifCount = 1;
    }

    const selTugas = document.getElementById('select-visible-tugas');
    const selSumatif = document.getElementById('select-visible-sumatif');
    if (selTugas) selTugas.value = visibleTugasCount;
    if (selSumatif) selSumatif.value = visibleSumatifCount;

    // 3. Load KKM (Prioritas Scope Per Mapel + Tingkat)
    const savedKkmKey = `simas_kkm_${currentUser.uid}_${scopeKey}`;
    const savedKkmKeyGb = `simas_kkm_${currentUser.uid}_${gradebookId}`;
    const savedKkm = localStorage.getItem(savedKkmKey) || localStorage.getItem(savedKkmKeyGb);

    if (savedKkm) {
        kkmValue = Math.min(100, Math.max(0, parseInt(savedKkm) || 75));
    } else {
        kkmValue = 75;
    }

    const inputKkm = document.getElementById('input-kkm-value');
    if (inputKkm) inputKkm.value = kkmValue;

    activeColumns = getActiveColumns(semester);
}

function saveLocalConfig(mapel, kelas, gradebookId) {
    if (!currentUser) return;
    const tingkat = getTingkatFromKelas(kelas);
    const scopeKey = mapel && kelas ? `${mapel.replace(/\s+/g, '_')}_${tingkat}` : gradebookId;
    if (!scopeKey) return;

    const savedWeightsKey = `simas_weights_${currentUser.uid}_${scopeKey}`;
    const savedVisKey = `simas_visibility_${currentUser.uid}_${scopeKey}`;
    const savedKkmKey = `simas_kkm_${currentUser.uid}_${scopeKey}`;

    const visData = JSON.stringify({
        tugas: visibleTugasCount,
        sumatif: visibleSumatifCount
    });

    localStorage.setItem(savedWeightsKey, JSON.stringify(weights));
    localStorage.setItem(savedVisKey, visData);
    localStorage.setItem(savedKkmKey, kkmValue.toString());

    if (gradebookId) {
        localStorage.setItem(`simas_weights_${currentUser.uid}_${gradebookId}`, JSON.stringify(weights));
        localStorage.setItem(`simas_visibility_${currentUser.uid}_${gradebookId}`, visData);
        localStorage.setItem(`simas_kkm_${currentUser.uid}_${gradebookId}`, kkmValue.toString());
    }
}

window.updateColumnVisibilityFromUI = function () {
    const selTugas = document.getElementById('select-visible-tugas');
    const selSumatif = document.getElementById('select-visible-sumatif');

    let requestedTugas = selTugas ? parseInt(selTugas.value) || 1 : 1;
    let requestedSumatif = selSumatif ? parseInt(selSumatif.value) || 1 : 1;

    if (requestedTugas < minRequiredTugasCount) {
        showToast('Kolom Terkunci', `Kolom Tugas 1 - ${minRequiredTugasCount} wajib tampil karena sudah berisi data nilai siswa.`, 'warning');
        requestedTugas = minRequiredTugasCount;
        if (selTugas) selTugas.value = requestedTugas;
    }

    if (requestedSumatif < minRequiredSumatifCount) {
        showToast('Kolom Terkunci', `Kolom Sumatif 1 - ${minRequiredSumatifCount} wajib tampil karena sudah berisi data nilai siswa.`, 'warning');
        requestedSumatif = minRequiredSumatifCount;
        if (selSumatif) selSumatif.value = requestedSumatif;
    }

    visibleTugasCount = requestedTugas;
    visibleSumatifCount = requestedSumatif;

    const mapel = document.getElementById('select-mapel').value;
    const kelas = document.getElementById('select-kelas').value;
    const semester = document.getElementById('select-semester').value;
    const tahunAjaran = raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString();

    if (mapel && kelas) {
        const gradebookId = `${tahunAjaran.replace('/', '-')}_S${semester}_${kelas.replace(/\s+/g, '_')}_${mapel.replace(/\s+/g, '_')}`;
        saveLocalConfig(mapel, kelas, gradebookId);
    }

    activeColumns = getActiveColumns(semester);
    renderGradebookTable(semester);
};

window.updateWeightsFromUI = function () {
    const wt = parseFloat(document.getElementById('input-weight-tugas').value) || 0;
    const ws = parseFloat(document.getElementById('input-weight-sumatif').value) || 0;
    const wsas = parseFloat(document.getElementById('input-weight-sas').value) || 0;

    weights = { tugas: wt, sumatif: ws, sas: wsas };

    const mapel = document.getElementById('select-mapel').value;
    const kelas = document.getElementById('select-kelas').value;
    const semester = document.getElementById('select-semester').value;
    const tahunAjaran = raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString();

    if (mapel && kelas) {
        const gradebookId = `${tahunAjaran.replace('/', '-')}_S${semester}_${kelas.replace(/\s+/g, '_')}_${mapel.replace(/\s+/g, '_')}`;
        saveLocalConfig(gradebookId);
    }

    updateWeightsUI();
    recalculateAllRowsLive();
};

window.updateKkmFromUI = function () {
    const inputKkm = document.getElementById('input-kkm-value');
    let val = inputKkm ? parseInt(inputKkm.value) : 75;
    if (isNaN(val) || val < 0) val = 0;
    if (val > 100) val = 100;
    kkmValue = val;

    const mapel = document.getElementById('select-mapel').value;
    const kelas = document.getElementById('select-kelas').value;
    const semester = document.getElementById('select-semester').value;
    const tahunAjaran = raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString();

    if (mapel && kelas) {
        const gradebookId = `${tahunAjaran.replace('/', '-')}_S${semester}_${kelas.replace(/\s+/g, '_')}_${mapel.replace(/\s+/g, '_')}`;
        saveLocalConfig(mapel, kelas, gradebookId);
    }

    recalculateAllRowsLive();
};

function updateWeightsUI() {
    const total = (weights.tugas || 0) + (weights.sumatif || 0) + (weights.sas || 0);
    const badge = document.getElementById('weight-total-badge');
    const summary = document.getElementById('config-weight-summary');

    if (badge) {
        badge.textContent = `Total: ${total}%`;
        if (total === 100) {
            badge.className = 'text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
        } else {
            badge.className = 'text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
        }
    }

    if (summary) {
        summary.textContent = `Bobot: ${weights.tugas}% Tugas | ${weights.sumatif}% Sumatif | ${weights.sas}% SAS/SAT`;
    }
}

window.toggleConfigAccordion = function () {
    const content = document.getElementById('config-panel-content');
    const icon = document.getElementById('config-accordion-icon');
    if (!content || !icon) return;

    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        icon.classList.add('rotate-180');
    } else {
        content.classList.add('hidden');
        icon.classList.remove('rotate-180');
    }
};

// =========================================================================
// 7. COLUMN VISIBILITY TRIGGER
// =========================================================================
function triggerColumnUpdate() {
    const semester = document.getElementById('select-semester')?.value || '1';
    activeColumns = getActiveColumns(semester);
    renderGradebookTable(semester);
}

// =========================================================================
// 8. SUPABASE FETCHERS
// =========================================================================
async function fetchScoresFromSupabase(gradebookId, isCurrentLoad = () => true) {
    existingScoresMap = {};
    existingSummariesMap = {};
    supabaseComponentMap = {};
    minRequiredTugasCount = 1;
    minRequiredSumatifCount = 1;

    if (!supabase) return;

    try {
        const selectedMapel = document.getElementById('select-mapel')?.value || '';
        const selectedKelas = document.getElementById('select-kelas')?.value || '';
        const selectedSemester = document.getElementById('select-semester')?.value || '1';
        const activeTahun = raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString();

        const mapelCandidates = getMapelNameCandidates(selectedMapel);
        const candidateGbIds = Array.from(new Set([
            gradebookId,
            ...mapelCandidates.map(m => `${activeTahun.replace('/', '-')}_S${selectedSemester}_${selectedKelas.replace(/\s+/g, '_')}_${m.replace(/\s+/g, '_')}`)
        ])).filter(Boolean);

        const filterGbId = (q) => candidateGbIds.length > 1 ? q.in('gradebook_id', candidateGbIds) : q.eq('gradebook_id', gradebookId);

        // 1. Fetch Components, Scores, dan Summaries secara PARALEL (Optimasi Egress & Latensi ~200ms)
        const [compRes, scoreRes, summaryRes] = await Promise.all([
            window.fetchAllSupabaseRows(
                supabase,
                'guru_mapel_components',
                filterGbId,
                { selectFields: 'id, gradebook_id, component_type, label, sequence, is_optional', skipCount: true }
            ),
            window.fetchAllSupabaseRows(
                supabase,
                'guru_mapel_scores',
                filterGbId,
                { selectFields: 'student_nis, component_id, score', skipCount: true }
            ),
            window.fetchAllSupabaseRows(
                supabase,
                'guru_mapel_summaries',
                filterGbId,
                { selectFields: 'id, student_nis, tugas_avg, sumatif_avg, sas_sat_score, final_score, deskripsi_cp, catatan_apresiasi, catatan_perilaku, catatan_evaluasi', skipCount: true }
            )
        ]);

        if (!isCurrentLoad()) return;
        const compData = compRes?.data;
        const compErr = compRes?.error;
        const scoreData = scoreRes?.data;
        const scoreErr = scoreRes?.error;
        const summaryData = summaryRes?.data;
        const summaryErr = summaryRes?.error;

        if (compErr) console.warn('[Portal Guru Mapel] Error fetching components:', compErr);
        if (scoreErr) console.warn('[Portal Guru Mapel] Error fetching scores:', scoreErr);
        if (summaryErr) console.warn('[Portal Guru Mapel] Error fetching summaries:', summaryErr);

        if (!compErr && compData) {
            const allPossibleCols = ALL_COLUMNS_S1.concat(ALL_COLUMNS_S2);
            compData.forEach(c => {
                const colMatch = allPossibleCols.find(ac =>
                    ac.label === c.label && ac.type === c.component_type
                );
                if (colMatch) {
                    supabaseComponentMap[colMatch.key] = c.id;
                }
            });
        }

        if (!scoreErr && scoreData) {
            scoreData.forEach(s => {
                if (!existingScoresMap[s.student_nis]) {
                    existingScoresMap[s.student_nis] = {};
                }
                const matchingColKey = Object.keys(supabaseComponentMap).find(k => supabaseComponentMap[k] === s.component_id);
                if (matchingColKey) {
                    existingScoresMap[s.student_nis][matchingColKey] = s.score;

                    if (s.score !== null && s.score !== undefined && String(s.score).trim() !== '') {
                        if (matchingColKey.startsWith('tugas_')) {
                            const num = parseInt(matchingColKey.replace('tugas_', '')) || 1;
                            minRequiredTugasCount = Math.max(minRequiredTugasCount, num);
                        } else if (matchingColKey.startsWith('sumatif_')) {
                            const num = parseInt(matchingColKey.replace('sumatif_', '')) || 1;
                            minRequiredSumatifCount = Math.max(minRequiredSumatifCount, num);
                        }
                    }
                }
            });
        }

        // Otomatis naikkan visible count jika ada nilai terisi di kolom lebih tinggi
        if (visibleTugasCount < minRequiredTugasCount) {
            visibleTugasCount = minRequiredTugasCount;
        }
        if (visibleSumatifCount < minRequiredSumatifCount) {
            visibleSumatifCount = minRequiredSumatifCount;
        }

        const semester = document.getElementById('select-semester')?.value || '1';
        activeColumns = getActiveColumns(semester);
        updateModalVisibilityOptions();

        let foundClassCp = '';
        const fetchMapel = document.getElementById('select-mapel')?.value || '';
        const isFetchPerhotelan = isPerhotelanMapel(fetchMapel);

        if (!summaryErr && summaryData) {
            summaryData.forEach(sm => {
                existingSummariesMap[sm.student_nis] = sm;
                // Untuk Perhotelan, deskripsi_cp adalah per-siswa, jangan set class-level
                if (!isFetchPerhotelan && !foundClassCp && sm.deskripsi_cp && sm.deskripsi_cp.trim() !== '') {
                    foundClassCp = sm.deskripsi_cp;
                }
                // Perhotelan: simpan nilai_rapor dari final_score untuk pre-fill
                if (isFetchPerhotelan && sm.final_score !== null && sm.final_score !== undefined) {
                    existingSummariesMap[sm.student_nis].nilai_rapor = Math.round(sm.final_score);
                }
            });
        }

        const wrapperCp = document.getElementById('wrapper-class-cp');
        if (wrapperCp) {
            wrapperCp.classList.add('hidden');
            wrapperCp.classList.add('sm:block');
            // Untuk Perhotelan, sembunyikan kolom CP kelas karena CP per siswa
            if (isFetchPerhotelan) {
                wrapperCp.classList.add('hidden');
                wrapperCp.classList.remove('sm:block');
            }
        }

        const inputCp = document.getElementById('input-class-cp-desc');
        if (inputCp) inputCp.value = foundClassCp;

    } catch (e) {
        console.error('[Portal Guru Mapel] Error fetching Supabase scores:', e);
    }
}

// =========================================================================
// 9. RENDER SPREADSHEET TABLE & LIVE CALCULATION
// =========================================================================
function renderGradebookTable(semester) {
    const wrapper = document.getElementById('gradebook-table-wrapper');
    if (!wrapper) return;

    if (loadedStudents.length === 0) {
        wrapper.innerHTML = '<div class="text-center py-12 text-slate-400">Tidak ada data siswa.</div>';
        return;
    }

    const sasLabel = semester === '1' ? 'SAS' : 'SAT';
    const currentMapel = document.getElementById('select-mapel')?.value || '';
    const isPerhotenan = isPerhotelanMapel(currentMapel);
    updatePerhotelanToggleButton(isPerhotenan);
    const showPerhotelanRapor = isPerhotenan && isPerhotelanRaporVisible;

    function getSortIconHtml(colKey) {
        if (currentSortColumn === colKey) {
            return currentSortOrder === 'asc'
                ? `<i class="fa-solid fa-arrow-up-wide-short text-emerald-500 text-[10px] ml-1"></i>`
                : `<i class="fa-solid fa-arrow-down-short-wide text-emerald-500 text-[10px] ml-1"></i>`;
        }
        return `<i class="fa-solid fa-sort text-slate-400/60 dark:text-slate-500/60 group-hover:text-slate-600 dark:group-hover:text-slate-300 text-[10px] ml-1 transition-colors"></i>`;
    }

    let tableHTML = `
        <table class="w-full text-xs text-left border-collapse select-none">
            <thead class="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 uppercase font-bold sticky top-0 z-20 shadow-sm border-b border-slate-200 dark:border-slate-700">
                <tr>
                    <th onclick="window.sortGradebookTable('no')" title="Klik untuk urutkan No Absen Siswa" class="col-no-urut px-3 py-3 text-center border-r border-slate-200 dark:border-slate-700 w-10 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors group">
                        <span class="inline-flex items-center gap-0.5 justify-center">No ${getSortIconHtml('no')}</span>
                    </th>
                    <th onclick="window.sortGradebookTable('nis')" title="Klik untuk urutkan NIS" class="mobile-hide-col px-2 py-2 text-center border-r border-slate-200 dark:border-slate-700 w-20 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors group">
                        <span class="inline-flex items-center gap-0.5 justify-center">NIS ${getSortIconHtml('nis')}</span>
                    </th>
                    <th onclick="window.sortGradebookTable('name')" title="Klik untuk urutkan Nama Siswa" class="col-nama-siswa px-3 py-2 border-r border-slate-200 dark:border-slate-700 min-w-[180px] cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors group">
                        <span class="inline-flex items-center gap-0.5">Nama Siswa ${getSortIconHtml('name')}</span>
                    </th>
                    
                    <!-- Dynamic Component Columns -->
                    ${activeColumns.map(col => {
        let badgeColor = 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200';
        if (col.type === 'sumatif') badgeColor = 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200';
        if (col.type === 'sas' || col.type === 'sat') badgeColor = 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200';

        // Label ringkas untuk mobile: "T1", "S2", "SAS"
        const shortLabel = col.type === 'tugas' ? 'T' + col.key.split('_')[1] :
                           col.type === 'sumatif' ? 'S' + col.key.split('_')[1] :
                           col.label;

        return `
                            <th onclick="window.sortGradebookTable('${col.key}')" title="Klik untuk urutkan nilai ${escapeHTML(col.label)}" class="col-score-header px-1.5 py-2 text-center border-r border-slate-200 dark:border-slate-700 w-20 whitespace-nowrap cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors group">
                                <span class="badge-label px-1.5 py-0.5 rounded text-[10px] ${badgeColor} inline-flex items-center justify-center font-bold">
                                    <span class="hidden sm:inline">${escapeHTML(col.label)}</span>
                                    <span class="inline sm:hidden">${escapeHTML(shortLabel)}</span>
                                    ${getSortIconHtml(col.key)}
                                </span>
                            </th>
                        `;
    }).join('')}

                    <!-- Calculated Columns -->
                    <th onclick="window.sortGradebookTable('tugas_avg')" title="Klik untuk urutkan Rata Tugas" class="col-calc-header px-2 py-2 text-center border-r border-slate-200 dark:border-slate-700 w-20 bg-blue-50/50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 cursor-pointer hover:bg-blue-100/70 dark:hover:bg-blue-900/50 transition-colors group">
                        <span class="inline-flex items-center gap-0.5 justify-center">
                            <span class="hidden sm:inline">Rata Tugas</span>
                            <span class="inline sm:hidden">RT</span>
                            ${getSortIconHtml('tugas_avg')}
                        </span>
                    </th>
                    <th onclick="window.sortGradebookTable('sumatif_avg')" title="Klik untuk urutkan Rata Sumatif" class="col-calc-header px-2 py-2 text-center border-r border-slate-200 dark:border-slate-700 w-20 bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 cursor-pointer hover:bg-indigo-100/70 dark:hover:bg-indigo-900/50 transition-colors group">
                        <span class="inline-flex items-center gap-0.5 justify-center">
                            <span class="hidden sm:inline">Rata Sumatif</span>
                            <span class="inline sm:hidden">RS</span>
                            ${getSortIconHtml('sumatif_avg')}
                        </span>
                    </th>
                    <th onclick="window.sortGradebookTable('final_score')" title="Klik untuk urutkan Nilai Akhir (NA)" class="col-calc-header px-2 py-2 text-center border-r border-slate-200 dark:border-slate-700 w-16 bg-emerald-100/70 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 font-extrabold cursor-pointer hover:bg-emerald-200/80 dark:hover:bg-emerald-900/70 transition-colors group">
                        <span class="inline-flex items-center gap-0.5 justify-center">
                            <span>NA</span>
                            ${getSortIconHtml('final_score')}
                        </span>
                    </th>
                    ${showPerhotelanRapor ? `
                    <th onclick="window.sortGradebookTable('nilai_rapor')" title="Klik untuk urutkan Nilai Rapor" class="col-calc-header px-2 py-2 text-center border-r border-slate-200 dark:border-slate-700 w-20 bg-purple-50/50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 cursor-pointer hover:bg-purple-100/70 dark:hover:bg-purple-900/50 transition-colors group">
                        <span class="inline-flex items-center gap-0.5 justify-center">
                            <span class="hidden sm:inline">Nilai Rapor</span>
                            <span class="inline sm:hidden">NR</span>
                            ${getSortIconHtml('nilai_rapor')}
                        </span>
                    </th>
                    <th class="col-calc-header px-2 py-2 text-center border-r border-slate-200 dark:border-slate-700 min-w-[180px] bg-purple-50/50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300">
                        <span class="inline-flex items-center gap-0.5 justify-center">Deskripsi CP</span>
                    </th>
                    ` : ''}
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900" id="gradebook-tbody">
    `;

    loadedStudents.forEach((student, idx) => {
        const existingStudentScores = existingScoresMap[student.nis] || {};
        const existingSummary = existingSummariesMap[student.nis] || {};
        const studentNoAbsen = student.noAbsen !== undefined && student.noAbsen !== null ? student.noAbsen : (idx + 1);

        // Ekstraksi dan sanitasi pasfoto siswa (SSOT Cloudflare D1/R2 via resolvePhotoUrl)
        const rawPhoto = student.active_photo_url || student.activePhotoUrl || student.photoUrl || student.photo_url || student.foto || student.foto_url || '';
        const sPhotoUrl = rawPhoto ? (typeof window.resolvePhotoUrl === 'function' ? window.resolvePhotoUrl(rawPhoto) : rawPhoto) : '';
        const sInitial = (student.name || 'S').trim().charAt(0).toUpperCase();
        // Foto circular ringkas (w-5 h-5 / 20px) agar sama sekali tidak menambah tinggi baris form nilai yang ada
        const sAvatarHtml = sPhotoUrl
            ? `<div class="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center text-[9px] font-bold shrink-0 overflow-hidden ring-1 ring-slate-200/80 dark:ring-slate-700/80 shadow-2xs"><img src="${escapeHTML(sPhotoUrl)}" alt="${escapeHTML(student.name || '')}" class="w-full h-full object-cover" loading="lazy" onerror="this.onerror=null; this.parentElement.classList.add('bg-blue-600','text-white'); this.parentElement.classList.remove('bg-slate-100'); this.parentElement.innerHTML='${escapeHTML(sInitial)}';" /></div>`
            : `<div class="w-5 h-5 rounded-full bg-blue-600 text-white text-[9px] flex items-center justify-center font-bold shrink-0 shadow-2xs">${escapeHTML(sInitial)}</div>`;

        tableHTML += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors group" data-nis="${student.nis}">
                <td class="col-no-urut px-1.5 py-0.5 text-center text-slate-400 dark:text-slate-500 font-mono text-xs font-medium border-r border-slate-100 dark:border-slate-800">${studentNoAbsen}</td>
                <td class="mobile-hide-col px-1.5 py-0.5 text-center font-mono text-xs font-bold border-r border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-200">
                    ${escapeHTML(student.nis)}
                </td>
                <td class="col-nama-siswa px-2.5 py-0.5 font-bold border-r border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-100 cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors group"
                    onclick="window.openStudentDetailModal('${escapeHTML(student.nis)}')" title="Klik untuk membuka Detail Snapshot & Catatan Siswa">
                    <div class="flex items-center justify-between gap-1.5 min-w-0">
                        <div class="flex items-center gap-1.5 min-w-0 overflow-hidden">
                            ${sAvatarHtml}
                            <span class="truncate" title="${escapeHTML(student.name)}">${escapeHTML(student.name)}</span>
                        </div>
                        ${(existingSummary.catatan_apresiasi || existingSummary.catatan_perilaku || existingSummary.catatan_evaluasi) ? '<i class="fa-solid fa-comment-dots text-amber-500 text-xs flex-shrink-0 transition-transform group-hover:scale-125" title="Ada Catatan Guru Mapel"></i>' : ''}
                    </div>
                </td>

                <!-- Inputs Component -->
                ${activeColumns.map(col => {
            const val = existingStudentScores[col.key] !== undefined && existingStudentScores[col.key] !== null ? existingStudentScores[col.key] : '';
            const placeholderText = col.type === 'tugas' ? 'T' + col.key.split('_')[1] :
                                    col.type === 'sumatif' ? 'S' + col.key.split('_')[1] :
                                    (col.type === 'sas' ? 'SAS' : (col.type === 'sat' ? 'SAT' : col.label));
            return `
                        <td class="col-score-cell px-0.5 py-0.5 border-r border-slate-100 dark:border-slate-800 text-center">
                            <input type="number" min="0" max="100" step="1" value="${val}"
                                placeholder="${escapeHTML(placeholderText)}"
                                data-col-key="${col.key}" data-col-type="${col.type}"
                                oninput="window.onScoreInputChange(this)"
                                onwheel="this.blur(); event.preventDefault();"
                                onkeydown="window.onScoreInputKeydown(event, this)"
                                inputmode="numeric" pattern="[0-9]*"
                                class="score-input w-14 p-1 text-center text-xs font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-800 dark:text-slate-100 outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white dark:focus:bg-slate-900 transition">
                        </td>
                    `;
        }).join('')}

                <!-- Computed Cells -->
                <td class="col-calc-cell px-2 py-0.5 text-center font-bold font-mono text-blue-700 dark:text-blue-300 border-r border-slate-100 dark:border-slate-800 bg-blue-50/20 dark:bg-blue-950/20 cell-tugas-avg leading-tight">
                    ${existingSummary.tugas_avg !== undefined && existingSummary.tugas_avg !== null ? Number(existingSummary.tugas_avg).toFixed(1) : '-'}
                </td>
                <td class="col-calc-cell px-2 py-0.5 text-center font-bold font-mono text-indigo-700 dark:text-indigo-300 border-r border-slate-100 dark:border-slate-800 bg-indigo-50/20 dark:bg-indigo-950/20 cell-sumatif-avg leading-tight">
                    ${existingSummary.sumatif_avg !== undefined && existingSummary.sumatif_avg !== null ? Number(existingSummary.sumatif_avg).toFixed(1) : '-'}
                </td>
                <td class="col-calc-cell px-2 py-0.5 text-center font-extrabold font-mono text-xs sm:text-[13px] text-emerald-700 dark:text-emerald-300 border-r border-slate-100 dark:border-slate-800 bg-emerald-50 dark:bg-emerald-950/40 cell-final-score leading-tight">
                    ${existingSummary.final_score !== undefined && existingSummary.final_score !== null ? Math.round(existingSummary.final_score) : '-'}
                </td>
                ${showPerhotelanRapor ? (() => {
                    const nilaiRapor = existingSummary.nilai_rapor !== undefined && existingSummary.nilai_rapor !== null
                        ? existingSummary.nilai_rapor
                        : (existingSummary.final_score !== undefined && existingSummary.final_score !== null
                            ? Math.round(existingSummary.final_score)
                            : '');
                    const perStudentCp = existingSummary.deskripsi_cp || '';
                    return `
                <td class="col-calc-cell px-0.5 py-0.5 border-r border-slate-100 dark:border-slate-800 text-center bg-purple-50/20 dark:bg-purple-950/20">
                    <input type="number" min="0" max="100" step="1" value="${nilaiRapor}"
                        placeholder="NR"
                        data-nis="${student.nis}" data-col-type="nilai_rapor" ${existingSummary.nilai_rapor !== undefined && existingSummary.nilai_rapor !== null ? 'data-manual="true"' : ''}
                        oninput="window.onNilaiRaporChange(this)"
                        onkeydown="window.onPerhotelanInputKeydown(event, this)"
                        onwheel="this.blur(); event.preventDefault();"
                        inputmode="numeric" pattern="[0-9]*"
                        class="perhotelan-nilai-rapor w-14 p-1 text-center text-[11px] font-bold bg-purple-50 dark:bg-purple-900/40 border border-purple-300 dark:border-purple-700 rounded-md text-purple-800 dark:text-purple-100 outline-none focus:ring-1 focus:ring-purple-500 focus:bg-white dark:focus:bg-purple-900 transition leading-tight">
                </td>
                <td class="col-calc-cell px-0.5 py-0.5 border-r border-slate-100 dark:border-slate-800 bg-purple-50/20 dark:bg-purple-950/20">
                    <input type="text" value="${escapeHTML(perStudentCp)}"
                        placeholder="Deskripsi CP siswa..."
                        title="${escapeHTML(perStudentCp)}"
                        data-nis="${student.nis}"
                        oninput="window.onDeskripsiCpChange(this)"
                        onkeydown="window.onPerhotelanInputKeydown(event, this)"
                        class="perhotelan-deskripsi-cp w-full min-w-[180px] p-1 text-[11px] bg-purple-50 dark:bg-purple-900/40 border border-purple-300 dark:border-purple-700 rounded-md text-slate-800 dark:text-slate-100 outline-none focus:ring-1 focus:ring-purple-500 focus:bg-white dark:focus:bg-purple-900 transition leading-tight">
                </td>`;
                })() : ''}
            </tr>
        `;
    });

    tableHTML += `</tbody>
        <tfoot class="bg-slate-100/90 dark:bg-slate-800/90 border-t-2 border-slate-300 dark:border-slate-700">
            <tr>
                <td class="col-no-urut px-2 py-2 text-center text-slate-400 dark:text-slate-500 font-bold text-[10px] border-r border-slate-200 dark:border-slate-700">#</td>
                <td class="mobile-hide-col px-2 py-2 text-center font-bold text-[10px] border-r border-slate-200 dark:border-slate-700 text-slate-500">Aksi</td>
                <td class="col-nama-siswa px-3 py-2 font-extrabold text-[11px] border-r border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-between">
                    <span>Reset Data Kolom</span>
                    <i class="fa-solid fa-rotate-left text-rose-500 text-xs"></i>
                </td>

                <!-- Reset Buttons per Component Column at VERY BOTTOM (Tampil Hanya Jika Ada Nilai) -->
                ${activeColumns.map(col => {
            const hasColumnData = loadedStudents.some(s => {
                const sScores = existingScoresMap[s.nis];
                return sScores && sScores[col.key] !== undefined && sScores[col.key] !== null && String(sScores[col.key]).trim() !== '';
            });
            return `
                    <td class="col-score-cell px-1 py-1.5 border-r border-slate-200 dark:border-slate-700 text-center">
                        <button onclick="window.openResetColumnModal('${col.key}', '${escapeHTML(col.label)}')"
                                title="Reset/Hapus seluruh nilai kolom ${escapeHTML(col.label)}"
                                data-col-key="${col.key}"
                                class="btn-reset-col ${hasColumnData ? '' : 'hidden'} w-full py-1 text-[9px] font-bold text-rose-600 dark:text-rose-400 hover:text-white bg-rose-50 hover:bg-rose-600 dark:bg-rose-950/60 dark:hover:bg-rose-600 border border-rose-300 dark:border-rose-800 rounded-md transition active:scale-95 shadow-2xs inline-flex items-center justify-center gap-0.5">
                            <i class="fa-solid fa-rotate-left text-[8px]"></i>
                            <span>Reset</span>
                        </button>
                        <span data-col-key="${col.key}" class="span-empty-reset ${hasColumnData ? 'hidden' : ''} text-xs text-slate-300 dark:text-slate-600 font-mono">-</span>
                    </td>
                `;
        }).join('')}

                <!-- Empty space for Calculated Columns -->
                <td class="col-calc-cell px-2 py-2 text-center text-xs text-slate-400 border-r border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50">-</td>
                <td class="col-calc-cell px-2 py-2 text-center text-xs text-slate-400 border-r border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50">-</td>
                <td class="col-calc-cell px-2 py-2 text-center text-xs text-slate-400 border-r border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50">-</td>
                ${showPerhotelanRapor ? (() => {
                    const hasNrData = loadedStudents.some(s => {
                        const sum = existingSummariesMap[s.nis];
                        return sum && sum.nilai_rapor !== undefined && sum.nilai_rapor !== null && String(sum.nilai_rapor).trim() !== '';
                    });
                    const hasCpData = loadedStudents.some(s => {
                        const sum = existingSummariesMap[s.nis];
                        return sum && sum.deskripsi_cp && String(sum.deskripsi_cp).trim() !== '';
                    });
                    return `
                    <td class="col-score-cell px-1 py-1.5 border-r border-slate-200 dark:border-slate-700 text-center bg-purple-50/20 dark:bg-purple-950/20">
                        <button onclick="window.openResetColumnModal('nilai_rapor', 'Nilai Rapor')"
                                title="Reset/Hapus seluruh nilai kolom Nilai Rapor"
                                data-col-key="nilai_rapor"
                                class="btn-reset-col ${hasNrData ? '' : 'hidden'} w-full py-1 text-[9px] font-bold text-rose-600 dark:text-rose-400 hover:text-white bg-rose-50 hover:bg-rose-600 dark:bg-rose-950/60 dark:hover:bg-rose-600 border border-rose-300 dark:border-rose-800 rounded-md transition active:scale-95 shadow-2xs inline-flex items-center justify-center gap-0.5">
                            <i class="fa-solid fa-rotate-left text-[8px]"></i>
                            <span>Reset</span>
                        </button>
                        <span data-col-key="nilai_rapor" class="span-empty-reset ${hasNrData ? 'hidden' : ''} text-xs text-slate-300 dark:text-slate-600 font-mono">-</span>
                    </td>
                    <td class="col-score-cell px-1 py-1.5 border-r border-slate-200 dark:border-slate-700 text-center bg-purple-50/20 dark:bg-purple-950/20">
                        <button onclick="window.openResetColumnModal('deskripsi_cp', 'Deskripsi CP')"
                                title="Reset/Hapus seluruh narasi kolom Deskripsi CP"
                                data-col-key="deskripsi_cp"
                                class="btn-reset-col ${hasCpData ? '' : 'hidden'} w-full py-1 text-[9px] font-bold text-rose-600 dark:text-rose-400 hover:text-white bg-rose-50 hover:bg-rose-600 dark:bg-rose-950/60 dark:hover:bg-rose-600 border border-rose-300 dark:border-rose-800 rounded-md transition active:scale-95 shadow-2xs inline-flex items-center justify-center gap-0.5">
                            <i class="fa-solid fa-rotate-left text-[8px]"></i>
                            <span>Reset</span>
                        </button>
                        <span data-col-key="deskripsi_cp" class="span-empty-reset ${hasCpData ? 'hidden' : ''} text-xs text-slate-300 dark:text-slate-600 font-mono">-</span>
                    </td>
                    `;
                })() : ''}
            </tr>
        </tfoot>
    </table>`;
    wrapper.innerHTML = tableHTML;

    // Recalculate live for all rows immediately
    recalculateAllRowsLive();
}

// Helper Ekstraksi Nilai Kolom Siswa untuk Sortir Tabel
function getStudentColumnValue(student, colKey) {
    if (colKey === 'no') return student.noAbsen !== undefined && student.noAbsen !== null ? student.noAbsen : 0;
    if (colKey === 'name') return (student.name || '').toLowerCase();
    if (colKey === 'nis') return student.nis || '';

    // Cek input live di DOM row jika tabel sudah dirender
    const row = document.querySelector(`#gradebook-tbody tr[data-nis="${student.nis}"]`);
    if (row) {
        if (colKey === 'tugas_avg') {
            const text = row.querySelector('.cell-tugas-avg')?.textContent?.trim();
            const val = parseFloat(text);
            return isNaN(val) ? -1 : val;
        }
        if (colKey === 'sumatif_avg') {
            const text = row.querySelector('.cell-sumatif-avg')?.textContent?.trim();
            const val = parseFloat(text);
            return isNaN(val) ? -1 : val;
        }
        if (colKey === 'final_score') {
            const text = row.querySelector('.cell-final-score')?.textContent?.trim();
            const val = parseFloat(text);
            return isNaN(val) ? -1 : val;
        }
        if (colKey === 'nilai_rapor') {
            const nrInput = row.querySelector('.perhotelan-nilai-rapor');
            if (nrInput) {
                const val = parseFloat(nrInput.value.trim());
                return isNaN(val) ? -1 : val;
            }
        }
        const inputEl = row.querySelector(`input[data-col-key="${colKey}"]`);
        if (inputEl) {
            const valStr = inputEl.value.trim();
            const val = parseFloat(valStr);
            return isNaN(val) || valStr === '' ? -1 : val;
        }
    }

    // Fallback ke data cache maps
    if (colKey === 'tugas_avg') return existingSummariesMap[student.nis]?.tugas_avg ?? -1;
    if (colKey === 'sumatif_avg') return existingSummariesMap[student.nis]?.sumatif_avg ?? -1;
    if (colKey === 'final_score') return existingSummariesMap[student.nis]?.final_score ?? -1;
    if (colKey === 'nilai_rapor') return existingSummariesMap[student.nis]?.nilai_rapor ?? existingSummariesMap[student.nis]?.final_score ?? -1;

    const val = existingScoresMap[student.nis]?.[colKey];
    return val !== undefined && val !== null && val !== '' ? Number(val) : -1;
}

// Fungsi Public Handler Sortir Kolom Tabel Penilaian Guru Mapel
window.sortGradebookTable = function (columnKey) {
    if (!loadedStudents || loadedStudents.length === 0) return;

    if (currentSortColumn === columnKey) {
        currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortColumn = columnKey;
        if (['tugas_avg', 'sumatif_avg', 'final_score'].includes(columnKey) || columnKey.startsWith('tugas_') || columnKey.startsWith('sumatif_') || columnKey === 'sas' || columnKey === 'sat') {
            currentSortOrder = 'desc';
        } else {
            currentSortOrder = 'asc';
        }
    }

    // Amankan input nilai yang belum disimpan di DOM sebelum sortir
    document.querySelectorAll('#gradebook-tbody tr').forEach(row => {
        const nis = row.dataset.nis;
        if (!nis) return;
        if (!existingScoresMap[nis]) existingScoresMap[nis] = {};
        row.querySelectorAll('input.score-input').forEach(inp => {
            const cKey = inp.dataset.colKey;
            const valStr = inp.value.trim();
            if (cKey) {
                if (valStr === '') {
                    delete existingScoresMap[nis][cKey];
                } else {
                    existingScoresMap[nis][cKey] = Number(valStr);
                }
            }
        });

        // Amankan nilai rapor dan deskripsi CP jika perhotelan
        const nrInp = row.querySelector('.perhotelan-nilai-rapor');
        if (nrInp) {
            if (!existingSummariesMap[nis]) existingSummariesMap[nis] = {};
            const v = parseFloat(nrInp.value.trim());
            existingSummariesMap[nis].nilai_rapor = isNaN(v) ? null : v;
        }
        const cpInp = row.querySelector('.perhotelan-deskripsi-cp');
        if (cpInp) {
            if (!existingSummariesMap[nis]) existingSummariesMap[nis] = {};
            existingSummariesMap[nis].deskripsi_cp = cpInp.value;
        }
    });

    loadedStudents.sort((a, b) => {
        const valA = getStudentColumnValue(a, columnKey);
        const valB = getStudentColumnValue(b, columnKey);

        if (typeof valA === 'string' && typeof valB === 'string') {
            return currentSortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }

        if (valA < valB) return currentSortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return currentSortOrder === 'asc' ? 1 : -1;

        return (a.name || '').localeCompare(b.name || '');
    });

    const semSelect = document.getElementById('select-semester');
    const semester = semSelect ? semSelect.value : '1';
    renderGradebookTable(semester);
};

window.onCpInputChange = function () {
    setGradebookDirty(true);
};

// Navigasi Keyboard Spreadsheet (Enter -> Pindah ke baris siswa di bawahnya)
window.onScoreInputKeydown = function (e, inputEl) {
    if (['e', 'E', '+', '-'].includes(e.key)) {
        e.preventDefault();
        return;
    }

    if (e.key === 'Enter') {
        e.preventDefault();
        const currentRow = inputEl.closest('tr');
        if (!currentRow) return;

        const targetRow = e.shiftKey ? currentRow.previousElementSibling : currentRow.nextElementSibling;
        if (targetRow) {
            const colKey = inputEl.dataset.colKey;
            const targetInput = targetRow.querySelector(`input[data-col-key="${colKey}"]`);
            if (targetInput) {
                targetInput.focus();
                targetInput.select();
            }
        }
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const currentRow = inputEl.closest('tr');
        if (!currentRow) return;

        const nextRow = currentRow.nextElementSibling;
        if (nextRow) {
            const colKey = inputEl.dataset.colKey;
            const nextInput = nextRow.querySelector(`input[data-col-key="${colKey}"]`);
            if (nextInput) {
                nextInput.focus();
                nextInput.select();
            }
        }
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const currentRow = inputEl.closest('tr');
        if (!currentRow) return;

        const prevRow = currentRow.previousElementSibling;
        if (prevRow) {
            const colKey = inputEl.dataset.colKey;
            const prevInput = prevRow.querySelector(`input[data-col-key="${colKey}"]`);
            if (prevInput) {
                prevInput.focus();
                prevInput.select();
            }
        }
    }
};

window.onClassCpInputChange = function (inputEl) {
    setGradebookDirty(true);
};

window.onScoreInputChange = function (inputEl) {
    let valStr = inputEl.value;
    if (valStr !== '') {
        let valNum = parseFloat(valStr);
        if (isNaN(valNum)) {
            inputEl.value = '';
        } else if (valNum < 0) {
            inputEl.value = 0;
        } else if (valNum > 100) {
            inputEl.value = 100;
        }
    }
    inputEl.classList.remove('ring-2', 'ring-rose-500', 'border-rose-500');

    setGradebookDirty(true);

    const row = inputEl.closest('tr');
    if (row) calculateRowLive(row);
    updateColumnHighlightsAndQuartiles();
    renderSimpleAnalytics();
};

function calculateRowLive(row) {
    const inputs = row.querySelectorAll('.score-input');
    const tugasVals = [];
    const sumatifVals = [];
    let sasSatVal = null;

    inputs.forEach(inp => {
        const type = inp.dataset.colType;
        const vStr = inp.value.trim();
        if (vStr !== '') {
            const vNum = parseFloat(vStr);
            if (!isNaN(vNum) && vNum >= 0 && vNum <= 100) {
                if (type === 'tugas') tugasVals.push(vNum);
                else if (type === 'sumatif') sumatifVals.push(vNum);
                else if (type === 'sas' || type === 'sat') sasSatVal = vNum;
            }
        }
    });

    // Rata-rata Tugas (Skip empty)
    const tugasAvg = tugasVals.length > 0
        ? (tugasVals.reduce((a, b) => a + b, 0) / tugasVals.length)
        : null;

    // Rata-rata Sumatif
    const sumatifAvg = sumatifVals.length > 0
        ? (sumatifVals.reduce((a, b) => a + b, 0) / sumatifVals.length)
        : null;

    // Nilai Akhir Formula = (Tugas_avg * wT + Sumatif_avg * wS + SAS_SAT * wSAS) / 100
    const wT = parseFloat(weights.tugas) || 0;
    const wS = parseFloat(weights.sumatif) || 0;
    const wSAS = parseFloat(weights.sas) || 0;

    let finalScore = null;
    let weightedSum = 0;
    let weightDivider = 0;

    if (tugasAvg !== null) {
        weightedSum += tugasAvg * (wT / 100);
        weightDivider += wT;
    }
    if (sumatifAvg !== null) {
        weightedSum += sumatifAvg * (wS / 100);
        weightDivider += wS;
    }
    if (sasSatVal !== null) {
        weightedSum += sasSatVal * (wSAS / 100);
        weightDivider += wSAS;
    }

    if (weightDivider > 0) {
        // Skala ulang 100% jika beberapa komponen optional belum diisi
        finalScore = (weightedSum * (100 / weightDivider));
    }

    // Update DOM Cells
    const cellTugas = row.querySelector('.cell-tugas-avg');
    const cellSumatif = row.querySelector('.cell-sumatif-avg');
    const cellFinal = row.querySelector('.cell-final-score');

    if (cellTugas) cellTugas.textContent = tugasAvg !== null ? tugasAvg.toFixed(1) : '-';
    if (cellSumatif) cellSumatif.textContent = sumatifAvg !== null ? sumatifAvg.toFixed(1) : '-';
    if (cellFinal) cellFinal.textContent = finalScore !== null ? Math.round(finalScore) : '-';

    // Perhotelan: Auto-sync Nilai Rapor dengan NA kecuali jika sudah diubah manual
    const nilaiRaporInput = row.querySelector('.perhotelan-nilai-rapor');
    if (nilaiRaporInput && nilaiRaporInput.dataset.manual !== 'true') {
        nilaiRaporInput.value = finalScore !== null ? Math.round(finalScore) : '';
    }
}

function recalculateAllRowsLive() {
    const rows = document.querySelectorAll('#gradebook-tbody tr');
    rows.forEach(r => calculateRowLive(r));
    updateColumnHighlightsAndQuartiles();
    renderSimpleAnalytics();
}

// Helper Penanda Visual Nilai (< KKM vs Kuartil Atas / Top 25%) Live 0 Reads
function updateColumnHighlightsAndQuartiles() {
    const currentKkm = parseFloat(kkmValue) || 75;

    const kkmSpanLegends = document.querySelectorAll('.val-kkm-legend');
    kkmSpanLegends.forEach(el => el.textContent = currentKkm);

    const rows = document.querySelectorAll('#gradebook-tbody tr');
    if (rows.length === 0) return;

    // 1. Kumpulkan seluruh nilai numerik terisi di setiap kolom & Update Tombol Reset tfoot
    const columnValuesMap = {};
    activeColumns.forEach(col => {
        columnValuesMap[col.key] = [];
    });
    columnValuesMap['tugas_avg'] = [];
    columnValuesMap['sumatif_avg'] = [];
    columnValuesMap['final_score'] = [];

    activeColumns.forEach(col => {
        let hasData = false;
        rows.forEach(row => {
            const inp = row.querySelector(`input[data-col-key="${col.key}"]`);
            if (inp && inp.value.trim() !== '') {
                hasData = true;
                const v = parseFloat(inp.value.trim());
                if (!isNaN(v)) columnValuesMap[col.key].push(v);
            }
        });

        const resetBtn = document.querySelector(`.btn-reset-col[data-col-key="${col.key}"]`);
        const emptySpan = document.querySelector(`.span-empty-reset[data-col-key="${col.key}"]`);

        if (resetBtn && emptySpan) {
            if (hasData) {
                resetBtn.classList.remove('hidden');
                emptySpan.classList.add('hidden');
            } else {
                resetBtn.classList.add('hidden');
                emptySpan.classList.remove('hidden');
            }
        }
    });

    // Toggle tombol reset khusus Perhotelan (Nilai Rapor & Deskripsi CP)
    let hasNrData = false;
    let hasCpData = false;
    rows.forEach(row => {
        const nrInp = row.querySelector('.perhotelan-nilai-rapor');
        if (nrInp && nrInp.value.trim() !== '') hasNrData = true;
        const cpInp = row.querySelector('.perhotelan-deskripsi-cp');
        if (cpInp && cpInp.value.trim() !== '') hasCpData = true;
    });

    const resetBtnNr = document.querySelector('.btn-reset-col[data-col-key="nilai_rapor"]');
    const emptySpanNr = document.querySelector('.span-empty-reset[data-col-key="nilai_rapor"]');
    if (resetBtnNr && emptySpanNr) {
        if (hasNrData) {
            resetBtnNr.classList.remove('hidden');
            emptySpanNr.classList.add('hidden');
        } else {
            resetBtnNr.classList.add('hidden');
            emptySpanNr.classList.remove('hidden');
        }
    }

    const resetBtnCp = document.querySelector('.btn-reset-col[data-col-key="deskripsi_cp"]');
    const emptySpanCp = document.querySelector('.span-empty-reset[data-col-key="deskripsi_cp"]');
    if (resetBtnCp && emptySpanCp) {
        if (hasCpData) {
            resetBtnCp.classList.remove('hidden');
            emptySpanCp.classList.add('hidden');
        } else {
            resetBtnCp.classList.add('hidden');
            emptySpanCp.classList.remove('hidden');
        }
    }

    rows.forEach(row => {
        const cellTugas = row.querySelector('.cell-tugas-avg')?.textContent?.trim();
        if (cellTugas && cellTugas !== '-') {
            const v = parseFloat(cellTugas);
            if (!isNaN(v)) columnValuesMap['tugas_avg'].push(v);
        }

        const cellSumatif = row.querySelector('.cell-sumatif-avg')?.textContent?.trim();
        if (cellSumatif && cellSumatif !== '-') {
            const v = parseFloat(cellSumatif);
            if (!isNaN(v)) columnValuesMap['sumatif_avg'].push(v);
        }

        const cellFinal = row.querySelector('.cell-final-score')?.textContent?.trim();
        if (cellFinal && cellFinal !== '-') {
            const v = parseFloat(cellFinal);
            if (!isNaN(v)) columnValuesMap['final_score'].push(v);
        }
    });

    // 2. Hitung Nilai Kuartil Atas (Q3 / Top 25%) per Kolom
    const q3Map = {};
    Object.keys(columnValuesMap).forEach(key => {
        const arr = columnValuesMap[key].sort((a, b) => a - b);
        if (arr.length > 0) {
            if (arr.length < 4) {
                q3Map[key] = Math.max(currentKkm, arr[arr.length - 1]);
            } else {
                const pos = (arr.length - 1) * 0.75;
                const base = Math.floor(pos);
                const rest = pos - base;
                q3Map[key] = arr[base + 1] !== undefined ? arr[base] + rest * (arr[base + 1] - arr[base]) : arr[base];
            }
        } else {
            q3Map[key] = null;
        }
    });

    // 3. Terapkan Style Penanda (< KKM vs Kuartil Atas) ke setiap Input & Sel Terkalkulasi
    rows.forEach(row => {
        // A. Inputs Komponen
        activeColumns.forEach(col => {
            const inp = row.querySelector(`input[data-col-key="${col.key}"]`);
            if (inp) {
                const valStr = inp.value.trim();
                const q3 = q3Map[col.key];

                // Reset kelas dasar
                inp.classList.remove(
                    'bg-rose-50', 'dark:bg-rose-950/60', 'text-rose-700', 'dark:text-rose-300', 'border-rose-300', 'dark:border-rose-800',
                    'bg-emerald-50', 'dark:bg-emerald-950/60', 'text-emerald-800', 'dark:text-emerald-200', 'border-emerald-300', 'dark:border-emerald-700',
                    'bg-slate-50', 'dark:bg-slate-800', 'text-slate-800', 'dark:text-slate-100', 'border-slate-200', 'dark:border-slate-700'
                );

                if (valStr !== '') {
                    const v = parseFloat(valStr);
                    if (!isNaN(v)) {
                        if (v < currentKkm) {
                            // Penanda Di Bawah KKM (Merah Muda)
                            inp.classList.add('bg-rose-50', 'dark:bg-rose-950/60', 'text-rose-700', 'dark:text-rose-300', 'border-rose-300', 'dark:border-rose-800');
                            inp.title = `Nilai di bawah KKM (${currentKkm})`;
                        } else if (q3 !== null && v >= q3 && v > currentKkm) {
                            // Penanda Kuartil Atas / Top 25% (Hijau Zamrud)
                            inp.classList.add('bg-emerald-50', 'dark:bg-emerald-950/60', 'text-emerald-800', 'dark:text-emerald-200', 'border-emerald-300', 'dark:border-emerald-700');
                            inp.title = `Kuartil Atas (Top 25% Kolom: ≥ ${q3.toFixed(1)})`;
                        } else {
                            // Normal Tuntas
                            inp.classList.add('bg-slate-50', 'dark:bg-slate-800', 'text-slate-800', 'dark:text-slate-100', 'border-slate-200', 'dark:border-slate-700');
                            inp.title = `Tuntas (≥ KKM ${currentKkm})`;
                        }
                    } else {
                        inp.classList.add('bg-slate-50', 'dark:bg-slate-800', 'text-slate-800', 'dark:text-slate-100', 'border-slate-200', 'dark:border-slate-700');
                    }
                } else {
                    inp.classList.add('bg-slate-50', 'dark:bg-slate-800', 'text-slate-800', 'dark:text-slate-100', 'border-slate-200', 'dark:border-slate-700');
                    inp.title = '';
                }
            }
        });

        // B. Cell Rata Tugas
        const cellTugas = row.querySelector('.cell-tugas-avg');
        if (cellTugas) {
            const vText = cellTugas.textContent.trim();
            const q3Tugas = q3Map['tugas_avg'];
            cellTugas.classList.remove('text-rose-600', 'dark:text-rose-400', 'text-emerald-700', 'dark:text-emerald-300', 'text-blue-700', 'dark:text-blue-300');

            if (vText && vText !== '-') {
                const v = parseFloat(vText);
                if (!isNaN(v)) {
                    if (v < currentKkm) {
                        cellTugas.classList.add('text-rose-600', 'dark:text-rose-400');
                    } else if (q3Tugas !== null && v >= q3Tugas && v > currentKkm) {
                        cellTugas.classList.add('text-emerald-700', 'dark:text-emerald-300');
                    } else {
                        cellTugas.classList.add('text-blue-700', 'dark:text-blue-300');
                    }
                }
            }
        }

        // C. Cell Rata Sumatif
        const cellSumatif = row.querySelector('.cell-sumatif-avg');
        if (cellSumatif) {
            const vText = cellSumatif.textContent.trim();
            const q3Sumatif = q3Map['sumatif_avg'];
            cellSumatif.classList.remove('text-rose-600', 'dark:text-rose-400', 'text-emerald-700', 'dark:text-emerald-300', 'text-indigo-700', 'dark:text-indigo-300');

            if (vText && vText !== '-') {
                const v = parseFloat(vText);
                if (!isNaN(v)) {
                    if (v < currentKkm) {
                        cellSumatif.classList.add('text-rose-600', 'dark:text-rose-400');
                    } else if (q3Sumatif !== null && v >= q3Sumatif && v > currentKkm) {
                        cellSumatif.classList.add('text-emerald-700', 'dark:text-emerald-300');
                    } else {
                        cellSumatif.classList.add('text-indigo-700', 'dark:text-indigo-300');
                    }
                }
            }
        }

        // D. Cell Nilai Akhir (NA)
        const cellFinal = row.querySelector('.cell-final-score');
        if (cellFinal) {
            const vText = cellFinal.textContent.trim();
            const q3Final = q3Map['final_score'];
            cellFinal.classList.remove(
                'bg-rose-100/90', 'dark:bg-rose-950/70', 'text-rose-700', 'dark:text-rose-300',
                'bg-emerald-100/90', 'dark:bg-emerald-950/70', 'text-emerald-800', 'dark:text-emerald-200',
                'bg-emerald-50', 'dark:bg-emerald-950/40', 'text-emerald-700', 'dark:text-emerald-300'
            );

            if (vText && vText !== '-') {
                const v = parseFloat(vText);
                if (!isNaN(v)) {
                    if (v < currentKkm) {
                        cellFinal.classList.add('bg-rose-100/90', 'dark:bg-rose-950/70', 'text-rose-700', 'dark:text-rose-300');
                        cellFinal.title = `Nilai Akhir di bawah KKM (${currentKkm})`;
                    } else if (q3Final !== null && v >= q3Final && v > currentKkm) {
                        // Kuartil Atas NA (Samakan dengan Komponen: Hijau Zamrud Emerald)
                        cellFinal.classList.add('bg-emerald-100/90', 'dark:bg-emerald-950/70', 'text-emerald-800', 'dark:text-emerald-200');
                        cellFinal.title = `Kuartil Atas (Top 25% NA Kelas: ≥ ${q3Final.toFixed(1)})`;
                    } else {
                        cellFinal.classList.add('bg-emerald-50', 'dark:bg-emerald-950/40', 'text-emerald-700', 'dark:text-emerald-300');
                        cellFinal.title = `Tuntas KKM (${currentKkm})`;
                    }
                }
            } else {
                cellFinal.classList.add('bg-emerald-50', 'dark:bg-emerald-950/40', 'text-emerald-700', 'dark:text-emerald-300');
            }
        }

        // E. Input Nilai Rapor Perhotelan (warna berdasarkan KKM)
        const nrInput = row.querySelector('.perhotelan-nilai-rapor');
        if (nrInput) {
            updateNilaiRaporHighlight(nrInput, currentKkm);
        }
    });
}

// Helper Kalkulasi Analisis Sederhana Data Penilaian Kelas (Live 0 Reads)
function renderSimpleAnalytics() {
    const analyticsWrapper = document.getElementById('gradebook-analytics-wrapper');
    if (!analyticsWrapper) return;

    if (loadedStudents.length === 0) {
        analyticsWrapper.classList.add('hidden');
        return;
    }

    analyticsWrapper.classList.remove('hidden');

    const rows = document.querySelectorAll('#gradebook-tbody tr');
    let totalTugasAvg = 0, countTugas = 0;
    let totalSumatifAvg = 0, countSumatif = 0;
    let totalSasAvg = 0, countSas = 0;
    let totalFinalScore = 0, countFinal = 0;

    let highestScore = -1, highestStudentName = '-';
    let lowestScore = 999, lowestStudentName = '-';
    let passCount = 0;
    let belowKkmFinalStudents = [];

    const semester = document.getElementById('select-semester')?.value || '1';
    const sasLabelEl = document.getElementById('stat-label-sas');
    if (sasLabelEl) {
        sasLabelEl.textContent = semester === '1' ? 'Rata SAS' : 'Rata SAT';
    }

    rows.forEach(row => {
        const nis = row.dataset.nis;
        const student = loadedStudents.find(s => s.nis === nis);
        const name = student ? student.name : (row.querySelector('td:nth-child(3)')?.textContent.trim() || '-');

        // Tugas Avg
        const cellTugas = row.querySelector('.cell-tugas-avg')?.textContent.trim();
        if (cellTugas && cellTugas !== '-') {
            const v = parseFloat(cellTugas);
            if (!isNaN(v)) { totalTugasAvg += v; countTugas++; }
        }

        // Sumatif Avg
        const cellSumatif = row.querySelector('.cell-sumatif-avg')?.textContent.trim();
        if (cellSumatif && cellSumatif !== '-') {
            const v = parseFloat(cellSumatif);
            if (!isNaN(v)) { totalSumatifAvg += v; countSumatif++; }
        }

        // SAS / SAT
        const sasInp = row.querySelector('input[data-col-type="sas"], input[data-col-type="sat"]');
        if (sasInp && sasInp.value.trim() !== '') {
            const v = parseFloat(sasInp.value.trim());
            if (!isNaN(v)) { totalSasAvg += v; countSas++; }
        }

        // Final Score
        const cellFinal = row.querySelector('.cell-final-score')?.textContent.trim();
        if (cellFinal && cellFinal !== '-') {
            const v = parseFloat(cellFinal);
            if (!isNaN(v)) {
                totalFinalScore += v;
                countFinal++;

                if (v >= kkmValue) {
                    passCount++;
                } else {
                    belowKkmFinalStudents.push(`${name} (${Math.round(v)})`);
                }

                if (v > highestScore) {
                    highestScore = v;
                    highestStudentName = name;
                }
                if (v < lowestScore) {
                    lowestScore = v;
                    lowestStudentName = name;
                }
            }
        }
    });

    const kkmLabelEl = document.getElementById('stat-kkm-label');
    if (kkmLabelEl) kkmLabelEl.textContent = kkmValue;

    const elTotal = document.getElementById('analytics-student-total');
    if (elTotal) elTotal.textContent = `${loadedStudents.length} Siswa Terdata`;

    const elAvgTugas = document.getElementById('stat-avg-tugas');
    if (elAvgTugas) elAvgTugas.textContent = countTugas > 0 ? (totalTugasAvg / countTugas).toFixed(1) : '-';

    const elAvgSumatif = document.getElementById('stat-avg-sumatif');
    if (elAvgSumatif) elAvgSumatif.textContent = countSumatif > 0 ? (totalSumatifAvg / countSumatif).toFixed(1) : '-';

    const elAvgSas = document.getElementById('stat-avg-sas');
    if (elAvgSas) elAvgSas.textContent = countSas > 0 ? (totalSasAvg / countSas).toFixed(1) : '-';

    const elAvgFinal = document.getElementById('stat-avg-final');
    if (elAvgFinal) elAvgFinal.textContent = countFinal > 0 ? Math.round(totalFinalScore / countFinal) : '-';

    const elHighStudent = document.getElementById('stat-highest-student');
    const elHighScore = document.getElementById('stat-highest-score');
    if (elHighStudent && elHighScore) {
        if (highestScore >= 0) {
            elHighStudent.textContent = highestStudentName;
            elHighScore.textContent = `NA: ${Math.round(highestScore)}`;
        } else {
            elHighStudent.textContent = '-';
            elHighScore.textContent = '-';
        }
    }

    const elLowStudent = document.getElementById('stat-lowest-student');
    const elLowScore = document.getElementById('stat-lowest-score');
    if (elLowStudent && elLowScore) {
        if (lowestScore <= 100) {
            elLowStudent.textContent = lowestStudentName;
            elLowScore.textContent = `NA: ${Math.round(lowestScore)}`;
        } else {
            elLowStudent.textContent = '-';
            elHighScore.textContent = '-';
        }
    }

    const elPassCount = document.getElementById('stat-pass-count');
    const elPassBar = document.getElementById('stat-pass-bar');
    const elPassPercent = document.getElementById('stat-pass-percent');
    const elBelowKkmCount = document.getElementById('stat-below-kkm-count');

    if (elPassCount && elPassBar && elPassPercent) {
        const total = loadedStudents.length;
        const pct = total > 0 ? Math.round((passCount / total) * 100) : 0;
        elPassCount.textContent = `${passCount} / ${total} Siswa`;
        elPassBar.style.width = `${pct}%`;
        elPassPercent.textContent = `${pct}% Tuntas (≥${kkmValue})`;
    }

    if (elBelowKkmCount) {
        if (belowKkmFinalStudents.length > 0) {
            elBelowKkmCount.textContent = `${belowKkmFinalStudents.length} Siswa Remidial (<${kkmValue})`;
            elBelowKkmCount.title = `Siswa di bawah KKM (${kkmValue}): ${belowKkmFinalStudents.join(', ')}`;
            elBelowKkmCount.className = 'text-rose-500 font-extrabold truncate';
        } else {
            elBelowKkmCount.textContent = `0 Siswa Remidial (<${kkmValue})`;
            elBelowKkmCount.title = '';
            elBelowKkmCount.className = 'text-slate-400 font-bold truncate';
        }
    }

    // Populate Dynamic Scope Select for WA Quick Copy
    const selectWaScope = document.getElementById('select-wa-scope');
    if (selectWaScope) {
        const curVal = selectWaScope.value || 'all';
        let optHTML = '<option value="all">Keseluruhan (Remidial NA Kelas)</option>';
        activeColumns.forEach(col => {
            optHTML += `<option value="${col.key}">${col.label}</option>`;
        });
        selectWaScope.innerHTML = optHTML;
        const exists = activeColumns.some(c => c.key === curVal) || curVal === 'all';
        selectWaScope.value = exists ? curVal : 'all';
    }

    // Catatan & Rekomendasi Pedagogis Guru (Mesin Analisis AI Multi-Variabel)
    const elRec = document.getElementById('stat-pedagogy-recommendation');
    if (elRec) {
        const totalSiswa = loadedStudents.length;
        const pctTuntas = totalSiswa > 0 ? Math.round((passCount / totalSiswa) * 100) : 0;
        const totalRemidi = belowKkmFinalStudents.length;
        const avgTugasVal = countTugas > 0 ? (totalTugasAvg / countTugas) : 0;
        const avgSumatifVal = countSumatif > 0 ? (totalSumatifAvg / countSumatif) : 0;

        // Cari komponen dengan rata-rata terendah & tertinggi
        let lowestCol = null;
        let lowestColAvg = 999;
        let highestCol = null;
        let highestColAvg = -1;

        activeColumns.forEach(col => {
            let colSum = 0, colCount = 0;
            rows.forEach(r => {
                const inp = r.querySelector(`input[data-col-key="${col.key}"]`);
                if (inp && inp.value.trim() !== '') {
                    const v = parseFloat(inp.value.trim());
                    if (!isNaN(v)) { colSum += v; colCount++; }
                }
            });
            if (colCount > 0) {
                const avg = colSum / colCount;
                if (avg < lowestColAvg) {
                    lowestColAvg = avg;
                    lowestCol = col.label;
                }
                if (avg > highestColAvg) {
                    highestColAvg = avg;
                    highestCol = col.label;
                }
            }
        });

        if (countFinal === 0) {
            elRec.innerHTML = `<p class="text-slate-500 italic">Silakan lakukan pengisian nilai siswa pada tabel di atas untuk menampilkan analisis pedagogis AI dan rekomendasi tindak lanjut secara otomatis.</p>`;
        } else {
            const gapScore = (highestScore >= 0 && lowestScore <= 100) ? (highestScore - lowestScore) : 0;
            const diffTugasVsSumatif = (avgTugasVal > 0 && avgSumatifVal > 0) ? (avgTugasVal - avgSumatifVal) : 0;

            // 1. Status Mastery Class & Badge Header
            let statusBadge = '';
            let statusHeader = '';
            let mainInsight = '';
            let pedagogicalAction = '';

            // Matrix Ketuntasan Rombel (6 Tier Skenario Utama)
            if (pctTuntas === 100) {
                if (avgSumatifVal >= 85) {
                    statusBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200 border border-emerald-300">🌟 PERFORMA KELAS EXCELLENT (100% TUNTAS)</span>`;
                    statusHeader = `Luar biasa! Seluruh <b>${totalSiswa} siswa</b> telah tuntas melampaui KKM (<b>${kkmValue}</b>) dengan capaian rata-rata kelas yang sangat memuaskan.`;
                    mainInsight = `Rombel menunjukkan penguasaan materi yang tinggi dan merata di seluruh indikator pencapaian pembelajaran.`;
                    pedagogicalAction = `Disarankan memberikan <b>Materi Pengayaan / Proyek Tantangan HOTS</b> bagi <b>${escapeHTML(highestStudentName.split(' ')[0])}</b> dan rekan-rekan untuk mengosah kepemimpinan akademis.`;
                } else {
                    statusBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-teal-100 text-teal-800 dark:bg-teal-950/80 dark:text-teal-200 border border-teal-300">✅ 100% TUNTAS KKM</span>`;
                    statusHeader = `Seluruh <b>${totalSiswa} siswa</b> telah memenuhi KKM (<b>${kkmValue}</b>).`;
                    mainInsight = `Ketuntasan sudah aman 100%, namun nilai rata-rata kelas masih dapat ditingkatkan dari <b>${Math.round(totalFinalScore / countFinal)}</b> ke tingkat optimal.`;
                    pedagogicalAction = `Pembelajaran dapat dilanjutkan ke modul berikutnya dengan menyelipkan latihan penerapan konsep aplikatif secara rutin.`;
                }
            } else if (pctTuntas >= 85) {
                statusBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-200 border border-blue-300">📈 KETUNTASAN TINGGI (${pctTuntas}%)</span>`;
                statusHeader = `Sebanyak <b>${passCount} dari ${totalSiswa} siswa (${pctTuntas}%)</b> telah tuntas melampaui KKM (<b>${kkmValue}</b>).`;
                mainInsight = `Hanya terdapat <b>${totalRemidi} siswa</b> yang masih memerlukan pembimbingan remediasi parsial.`;
                pedagogicalAction = `Terapkan program <b>Tutor Sebaya (Peer Tutoring)</b> dengan memberdayakan siswa bernilai tertinggi seperti <b>${escapeHTML(highestStudentName.split(' ')[0])}</b> untuk mendampingi <b>${totalRemidi} rekan yang belum tuntas</b>.`;
            } else if (pctTuntas >= 60) {
                statusBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-200 border border-amber-300">⚠️ PERLU REMEDIASI KELOMPOK (${pctTuntas}% TUNTAS)</span>`;
                statusHeader = `Ketuntasan kelas berada pada tingkat menengah (<b>${pctTuntas}%</b>) dengan <b>${totalRemidi} siswa (${100 - pctTuntas}%)</b> berada di bawah KKM (<b>${kkmValue}</b>).`;
                mainInsight = `Diperlukan pendampingan kelompok khusus sebelum kelas melangkah ke modul kompetensi selanjutnya.`;
                pedagogicalAction = `Disarankan membuka <b>Klinik Belajar Remedial</b> terfokus pada materi <b>${lowestCol || 'Komponen Terendah'}</b> (Rata-rata: <b>${lowestColAvg <= 100 ? lowestColAvg.toFixed(1) : '-'}</b>).`;
            } else if (pctTuntas >= 35) {
                statusBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-200 border border-rose-300">🚨 INTERVENSI PEMBELAJARAN REQUIRED (${pctTuntas}% TUNTAS)</span>`;
                statusHeader = `Ketuntasan kelas masih di bawah standar harapan (baru <b>${pctTuntas}%</b> tuntas, <b>${totalRemidi} siswa remidial</b>).`;
                mainInsight = `Sebagian besar rombel mengalami hambatan dalam menyerap indikator kompetensi dasar.`;
                pedagogicalAction = `Sangat direkomendasikan melakukan <b>Pembelajaran Ulang (Re-teaching) Kelompok</b> dengan penyederhanaan metode ajar sebelum mengadakan tes ulang.`;
            } else {
                statusBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-red-200 text-red-900 dark:bg-red-950/90 dark:text-red-200 border border-red-400">🔥 KRITIS (HANYA ${pctTuntas}% TUNTAS)</span>`;
                statusHeader = `Mayoritas siswa dalam rombel (<b>${totalRemidi} dari ${totalSiswa} siswa</b>) belum mencapai batas KKM (<b>${kkmValue}</b>).`;
                mainInsight = `Terdapat indikasi kendala serapan materi atau instrumen tes yang terlalu kompleks secara kolektif.`;
                pedagogicalAction = `Diperlukan <b>Evaluasi Instrumen Soal & Pembelajaran Ulang Total</b>. Pertimbangkan untuk merevisi tingkat kesulitan instrumen serta mengadakan sesi pembahasan materi dasar bersama rombel.`;
            }

            // 2. Analisis Komparatif: Proses (Tugas) vs Evaluasi Ujian (Sumatif)
            let processInsight = '';
            if (diffTugasVsSumatif >= 15) {
                processInsight = `<li class="flex items-start gap-1.5"><i class="fa-solid fa-lightbulb text-amber-500 mt-0.5 shrink-0"></i><span><b>Disparitas Proses vs Ujian:</b> Rata-rata Tugas (<b>${avgTugasVal.toFixed(1)}</b>) jauh melampaui Rata Sumatif (<b>${avgSumatifVal.toFixed(1)}</b>). Siswa sangat rajin dalam tugas harian namun mengalami kecemasan/kendala saat ujian mandiri. <i>Saran: Berikan latihan simulasi tes bermodel waktu (time-bound quiz).</i></span></li>`;
            } else if (diffTugasVsSumatif <= -12) {
                processInsight = `<li class="flex items-start gap-1.5"><i class="fa-solid fa-bolt text-indigo-500 mt-0.5 shrink-0"></i><span><b>Potensi Tinggi, Kedisiplinan Tugas Perlu Ditingkatkan:</b> Rata Sumatif (<b>${avgSumatifVal.toFixed(1)}</b>) lebih tinggi dibanding Tugas Harian (<b>${avgTugasVal.toFixed(1)}</b>). Siswa cepat paham saat tes, namun kurang disiplin mengumpulkan tugas. <i>Saran: Terapkan reminder tugas berkala.</i></span></li>`;
            } else if (avgTugasVal > 0 && avgSumatifVal > 0) {
                processInsight = `<li class="flex items-start gap-1.5"><i class="fa-solid fa-circle-check text-emerald-500 mt-0.5 shrink-0"></i><span><b>Konsistensi Pembelajaran:</b> Nilai Tugas (<b>${avgTugasVal.toFixed(1)}</b>) dan Nilai Sumatif (<b>${avgSumatifVal.toFixed(1)}</b>) berjalan selaras dan seimbang, menandakan proses belajar yang stabil.</span></li>`;
            }

            // 3. Analisis Variansi / Rentang Nilai (Gap Score)
            let gapInsight = '';
            if (gapScore >= 35) {
                gapInsight = `<li class="flex items-start gap-1.5"><i class="fa-solid fa-arrows-left-right text-purple-500 mt-0.5 shrink-0"></i><span><b>Kesenjangan Nilai Lebar (Rentang ${Math.round(gapScore)} poin):</b> Terdapat selisih besar antara nilai tertinggi (<b>${Math.round(highestScore)}</b> - ${escapeHTML(highestStudentName.split(' ')[0])}) dan terendah (<b>${Math.round(lowestScore)}</b> - ${escapeHTML(lowestStudentName.split(' ')[0])}). <i>Saran: Gunakan Pembelajaran Berdiferensiasi (Differentiated Instruction) berdasar kelompok kesiapan belajar.</i></span></li>`;
            } else if (gapScore > 0 && gapScore <= 15) {
                gapInsight = `<li class="flex items-start gap-1.5"><i class="fa-solid fa-bullseye text-blue-500 mt-0.5 shrink-0"></i><span><b>Heterogenitas Terkontrol:</b> Rentang nilai antarsiswa relatif homogen/sempit (${Math.round(gapScore)} poin), menunjukkan daya serap kelas terdistribusi secara merata.</span></li>`;
            }

            // 4. Komponen Titik Lemah Rombel
            let bottleneckInsight = '';
            if (lowestCol && lowestColAvg <= 100) {
                bottleneckInsight = `<li class="flex items-start gap-1.5"><i class="fa-solid fa-triangle-exclamation text-amber-600 mt-0.5 shrink-0"></i><span><b>Komponen Titik Lemah Rombel:</b> Pencapaian terendah kelas ada pada <b>${lowestCol}</b> (Rata-rata: <b>${lowestColAvg.toFixed(1)}</b>). Sesi ulasan/pembahasan soal difokuskan pada materi indikator ini.</span></li>`;
            }

            elRec.innerHTML = `
                <div class="space-y-2">
                    <div class="flex items-center gap-2 flex-wrap">
                        ${statusBadge}
                    </div>
                    <p class="text-xs leading-relaxed text-slate-700 dark:text-slate-200 font-normal">
                        ${statusHeader} ${mainInsight}
                    </p>
                    <div class="p-2.5 bg-white/90 dark:bg-slate-900/90 rounded-lg border border-indigo-100 dark:border-indigo-900/50 shadow-2xs space-y-2">
                        <span class="font-extrabold text-[11px] text-indigo-900 dark:text-indigo-200 block border-b border-indigo-100 dark:border-indigo-900/40 pb-1.5 uppercase tracking-wide">
                            📌 Rekomendasi Langkah Pedagogis Guru:
                        </span>
                        <div class="text-xs text-indigo-950 dark:text-indigo-200 font-semibold leading-relaxed">
                            ${pedagogicalAction}
                        </div>
                        <ul class="text-[11px] text-slate-600 dark:text-slate-300 space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                            ${processInsight}
                            ${gapInsight}
                            ${bottleneckInsight}
                        </ul>
                    </div>
                </div>
            `;
        }
    }

    // Analisis Detail per Komponen Kolom Aktif (Tugas 1..5, Sumatif 1..5, SAS/SAT)
    const compContainer = document.getElementById('analytics-component-cards');
    if (compContainer) {
        let compHTML = '';

        activeColumns.forEach(col => {
            let sum = 0;
            let count = 0;
            let maxVal = -1;
            let maxStudent = '-';
            let minVal = 999;
            let minStudent = '-';
            let passCountCol = 0;
            let zeroOrEmptyStudents = [];
            let belowKkmColStudents = [];

            // Cek apakah kolom ini sudah mulai diisi nilai oleh minimal 1 siswa
            let colHasAnyScores = false;
            rows.forEach(r => {
                const inp = r.querySelector(`input[data-col-key="${col.key}"]`);
                if (inp && inp.value.trim() !== '') colHasAnyScores = true;
            });

            rows.forEach(row => {
                const nis = row.dataset.nis;
                const student = loadedStudents.find(s => s.nis === nis);
                const name = student ? student.name : (row.querySelector('td:nth-child(3)')?.textContent.trim() || '-');
                const inp = row.querySelector(`input[data-col-key="${col.key}"]`);
                const valStr = inp ? inp.value.trim() : '';

                if (valStr !== '') {
                    const v = parseFloat(valStr);
                    if (!isNaN(v) && v >= 0 && v <= 100) {
                        sum += v;
                        count++;
                        if (v >= kkmValue) {
                            passCountCol++;
                        } else {
                            belowKkmColStudents.push(`${name} (${v})`);
                        }

                        if (v === 0 && colHasAnyScores) zeroOrEmptyStudents.push(`${name} (0)`);

                        if (v > maxVal) {
                            maxVal = v;
                            maxStudent = name;
                        }
                        if (v < minVal) {
                            minVal = v;
                            minStudent = name;
                        }
                    }
                } else if (colHasAnyScores) {
                    // Kolom sudah diisi, sehingga input kosong terdeteksi sebagai belum ada nilai/kosong
                    zeroOrEmptyStudents.push(`${name} (Kosong)`);
                }
            });

            const avgCol = count > 0 ? (sum / count).toFixed(1) : '-';
            const pctPass = count > 0 ? Math.round((passCountCol / count) * 100) : 0;

            let badgeBg = 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200';
            if (col.type === 'sumatif') badgeBg = 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200';
            if (col.type === 'sas' || col.type === 'sat') badgeBg = 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200';

            const zeroText = zeroOrEmptyStudents.length > 0
                ? `${zeroOrEmptyStudents.length} Siswa (${escapeHTML(zeroOrEmptyStudents[0].split(' ')[0])}${zeroOrEmptyStudents.length > 1 ? ` +${zeroOrEmptyStudents.length - 1}` : ''})`
                : '0 Siswa';

            const belowKkmColText = belowKkmColStudents.length > 0
                ? `${belowKkmColStudents.length} Siswa (${escapeHTML(belowKkmColStudents[0].split(' ')[0])}${belowKkmColStudents.length > 1 ? ` +${belowKkmColStudents.length - 1}` : ''})`
                : '0 Siswa';

            compHTML += `
                <div class="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-2.5 rounded-xl shadow-2xs flex flex-col justify-between">
                    <div>
                        <div class="flex items-center justify-between gap-1 mb-1">
                            <span class="font-extrabold text-[11px] text-slate-800 dark:text-slate-100 truncate">${escapeHTML(col.label)}</span>
                            <span class="text-[8px] font-bold px-1.5 py-0.2 rounded ${badgeBg} uppercase">${col.type}</span>
                        </div>
                        <div class="text-base font-black text-slate-800 dark:text-slate-100 mt-0.5">
                            ${avgCol} <span class="text-[9px] font-normal text-slate-400">Rata</span>
                        </div>
                    </div>

                    <div class="mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800 text-[10px] space-y-0.5">
                        <div class="flex justify-between text-slate-500 dark:text-slate-400">
                            <span>Max:</span>
                            <span class="font-bold text-emerald-600 dark:text-emerald-400 truncate max-w-[85px]" title="${escapeHTML(maxStudent)}">${maxVal >= 0 ? `${maxVal} (${escapeHTML(maxStudent.split(' ')[0])})` : '-'}</span>
                        </div>
                        <div class="flex justify-between text-slate-500 dark:text-slate-400">
                            <span>Min:</span>
                            <span class="font-bold text-rose-500 truncate max-w-[85px]" title="${escapeHTML(minStudent)}">${minVal <= 100 ? `${minVal} (${escapeHTML(minStudent.split(' ')[0])})` : '-'}</span>
                        </div>
                        <div class="flex justify-between text-slate-500 dark:text-slate-400">
                            <span>0 / Kosong:</span>
                            <span class="font-bold ${zeroOrEmptyStudents.length > 0 ? 'text-rose-600 dark:text-rose-400 font-extrabold' : 'text-slate-400'} truncate max-w-[90px]" title="${escapeHTML(zeroOrEmptyStudents.join(', '))}">${zeroText}</span>
                        </div>
                        <div class="flex justify-between text-slate-500 dark:text-slate-400">
                            <span>< KKM (${kkmValue}):</span>
                            <span class="font-bold ${belowKkmColStudents.length > 0 ? 'text-amber-600 dark:text-amber-400 font-extrabold' : 'text-slate-400'} truncate max-w-[90px]" title="${escapeHTML(belowKkmColStudents.join(', '))}">${belowKkmColText}</span>
                        </div>
                        <div class="flex justify-between text-slate-500 dark:text-slate-400 pt-0.5 border-t border-slate-100 dark:border-slate-800/60">
                            <span>Tuntas:</span>
                            <span class="font-bold text-slate-700 dark:text-slate-200">${passCountCol}/${count} (${pctPass}%)</span>
                        </div>
                    </div>
                </div>
            `;
        });

        compContainer.innerHTML = compHTML;
    }
}

// =========================================================================
// RESET DATA PER KOLOM DENGAN VERIFIKASI KEAMANAN KETIK NAMA KOLOM
// =========================================================================
let pendingResetColumnKey = null;
let pendingResetColumnLabel = null;

window.openResetColumnModal = function (colKey, colLabel) {
    pendingResetColumnKey = colKey;
    pendingResetColumnLabel = colLabel;

    const modal = document.getElementById('modal-reset-column');
    const card = document.getElementById('modal-reset-column-card');
    const titleEl = document.getElementById('reset-column-title');
    const targetNameEl = document.getElementById('reset-column-target-name');
    const expectedTextEl = document.getElementById('reset-column-expected-text');
    const inputConfirm = document.getElementById('input-confirm-reset-name');
    const btnConfirm = document.getElementById('btn-confirm-reset-column');

    if (!modal || !card) return;

    if (titleEl) titleEl.textContent = `Reset Data ${colLabel}`;
    if (targetNameEl) targetNameEl.textContent = `"${colLabel}"`;
    if (expectedTextEl) expectedTextEl.textContent = `"${colLabel}"`;
    if (inputConfirm) inputConfirm.value = '';
    if (btnConfirm) {
        btnConfirm.disabled = true;
        btnConfirm.onclick = () => window.executeResetColumnData();
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        card.classList.remove('scale-95', 'opacity-0');
        card.classList.add('scale-100', 'opacity-100');
        if (inputConfirm) inputConfirm.focus();
    }, 10);
};

window.validateResetColumnConfirmationInput = function () {
    const inputConfirm = document.getElementById('input-confirm-reset-name');
    const btnConfirm = document.getElementById('btn-confirm-reset-column');
    if (!inputConfirm || !btnConfirm || !pendingResetColumnLabel) return;

    const typedText = inputConfirm.value.trim().toLowerCase();
    const expectedText = pendingResetColumnLabel.trim().toLowerCase();

    btnConfirm.disabled = (typedText !== expectedText);
};

window.closeResetColumnModal = function () {
    const modal = document.getElementById('modal-reset-column');
    const card = document.getElementById('modal-reset-column-card');
    if (!modal || !card) return;

    card.classList.remove('scale-100', 'opacity-100');
    card.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        pendingResetColumnKey = null;
        pendingResetColumnLabel = null;
    }, 150);
};

window.executeResetColumnData = function () {
    if (!pendingResetColumnKey || !pendingResetColumnLabel) return;

    const targetKey = pendingResetColumnKey;
    const targetLabel = pendingResetColumnLabel;

    if (targetKey === 'nilai_rapor') {
        // Bersihkan nilai rapor di DOM inputs
        const nrInputs = document.querySelectorAll('#gradebook-tbody tr .perhotelan-nilai-rapor');
        nrInputs.forEach(inp => {
            inp.value = '';
            inp.dataset.manual = "true";
            updateNilaiRaporHighlight(inp);
        });
        // Bersihkan di existingSummariesMap
        Object.keys(existingSummariesMap).forEach(nis => {
            if (existingSummariesMap[nis]) {
                existingSummariesMap[nis].nilai_rapor = null;
            }
        });
    } else if (targetKey === 'deskripsi_cp') {
        // Bersihkan deskripsi CP di DOM inputs
        const cpInputs = document.querySelectorAll('#gradebook-tbody tr .perhotelan-deskripsi-cp');
        cpInputs.forEach(inp => {
            inp.value = '';
        });
        // Bersihkan di existingSummariesMap
        Object.keys(existingSummariesMap).forEach(nis => {
            if (existingSummariesMap[nis]) {
                existingSummariesMap[nis].deskripsi_cp = '';
            }
        });
    } else {
        // 1. Bersihkan nilai di DOM inputs
        const inputs = document.querySelectorAll(`#gradebook-tbody tr input[data-col-key="${targetKey}"]`);
        inputs.forEach(inp => {
            inp.value = '';
        });

        // 2. Bersihkan nilai di existingScoresMap
        Object.keys(existingScoresMap).forEach(nis => {
            if (existingScoresMap[nis]) {
                delete existingScoresMap[nis][targetKey];
            }
        });
    }

    window.closeResetColumnModal();
    setGradebookDirty(true);
    recalculateAllRowsLive();

    showModernAlert(
        'Kolom Berhasil Direset',
        `Seluruh data pada kolom <b>${escapeHTML(targetLabel)}</b> telah dibersihkan. Klik <b>'Simpan Nilai'</b> untuk menyimpan perubahan ke database.`,
        'success'
    );
};

// Salin Teks Pengumuman Remidial Siap Kirim ke WhatsApp Kelas
window.copyRemedialWaText = function () {
    const mapel = document.getElementById('select-mapel').value;
    const kelas = document.getElementById('select-kelas').value;
    const semester = document.getElementById('select-semester').value;
    const scopeVal = document.getElementById('select-wa-scope')?.value || 'all';
    const showScores = document.getElementById('checkbox-wa-show-scores')?.checked ?? true;

    if (!mapel || !kelas || loadedStudents.length === 0) {
        showToast('Peringatan', 'Muat data penilaian terlebih dahulu!', 'warning');
        return;
    }

    const rows = document.querySelectorAll('#gradebook-tbody tr');

    if (scopeVal === 'all') {
        // Mode Keseluruhan (Remidial NA & Semua Component Unfilled/Remidial)
        let remedialList = [];

        rows.forEach((row, idx) => {
            const nis = row.dataset.nis;
            const student = loadedStudents.find(s => s.nis === nis);
            const name = student ? student.name : (row.querySelector('td:nth-child(3)')?.textContent.trim() || `Siswa ${idx + 1}`);

            const cellFinal = row.querySelector('.cell-final-score')?.textContent.trim();
            const v = cellFinal && cellFinal !== '-' ? parseFloat(cellFinal) : null;

            let unfilledCols = [];
            activeColumns.forEach(col => {
                const inp = row.querySelector(`input[data-col-key="${col.key}"]`);
                const valStr = inp ? inp.value.trim() : '';
                if (valStr === '') {
                    unfilledCols.push(`${col.label}: Kosong`);
                } else {
                    const valNum = parseFloat(valStr);
                    if (!isNaN(valNum) && valNum < kkmValue) {
                        unfilledCols.push(showScores ? `${col.label}: ${valNum}` : `${col.label}: Belum Tuntas`);
                    }
                }
            });

            if ((v !== null && v < kkmValue) || unfilledCols.length > 0) {
                let scoreInfo = '';
                if (showScores && v !== null) {
                    scoreInfo = ` (NA: ${Math.round(v)})`;
                }
                remedialList.push({
                    name,
                    scoreInfo,
                    details: unfilledCols.join(', ')
                });
            }
        });

        let text = `📢 *PENGUMUMAN REMIDIAL & TAGIHAN NILAI KELAS*\n`;
        text += `📖 Mapel: *${mapel}*\n`;
        text += `🏫 Kelas: *${kelas}* (Semester ${semester})\n`;
        text += `🎯 Batas KKM: *${kkmValue}*\n\n`;

        if (remedialList.length === 0) {
            text += `🎉 *SELAMAT!* Seluruh siswa kelas ${kelas} telah tuntas mencapai/melampaui KKM ${kkmValue}. Terus tingkatkan prestasi! 💪`;
        } else {
            text += `Daftar siswa yang perlu mengikuti remidial / melengkapi nilai:\n`;
            remedialList.forEach((item, i) => {
                text += `${i + 1}. *${item.name}*${item.scoreInfo}\n`;
                if (item.details) text += `   └ Detail: ${item.details}\n`;
            });
            text += `\nMohon siswa yang bersangkutan segera menemui Guru Mapel. Terima kasih! 🙏`;
        }

        navigator.clipboard.writeText(text).then(() => {
            showModernAlert('Berhasil Disalin!', 'Teks daftar remidial kelas berhasil disalin ke clipboard. Tinggal tempel (paste) di WhatsApp.', 'success');
        }).catch(() => {
            showToast('Error', 'Gagal menyalin ke clipboard', 'error');
        });

    } else {
        // Mode Per Komponen Spesifik (misal Tugas 1, Tugas 2, Sumatif 1, SAS/SAT)
        const targetCol = activeColumns.find(c => c.key === scopeVal);
        const colLabel = targetCol ? targetCol.label : 'Komponen';
        let componentRemedialList = [];

        rows.forEach((row, idx) => {
            const nis = row.dataset.nis;
            const student = loadedStudents.find(s => s.nis === nis);
            const name = student ? student.name : (row.querySelector('td:nth-child(3)')?.textContent.trim() || `Siswa ${idx + 1}`);

            const inp = row.querySelector(`input[data-col-key="${scopeVal}"]`);
            const valStr = inp ? inp.value.trim() : '';

            if (valStr === '') {
                componentRemedialList.push({ name, status: 'Kosong (Belum Mengumpulkan)' });
            } else {
                const vNum = parseFloat(valStr);
                if (!isNaN(vNum) && vNum < kkmValue) {
                    const statusText = showScores ? `Nilai: ${vNum}` : 'Belum Tuntas';
                    componentRemedialList.push({ name, status: statusText });
                }
            }
        });

        let text = `📢 *PENGUMUMAN TAGIHAN / REMIDIAL ${colLabel.toUpperCase()}*\n`;
        text += `📖 Mapel: *${mapel}*\n`;
        text += `🏫 Kelas: *${kelas}* (Semester ${semester})\n`;
        text += `🎯 Batas KKM: *${kkmValue}*\n\n`;

        if (componentRemedialList.length === 0) {
            text += `🎉 *SELAMAT!* Seluruh siswa kelas ${kelas} telah tuntas mencapai/melampaui KKM ${kkmValue} pada *${colLabel}*. Terus pertahankan! 💪`;
        } else {
            text += `Daftar siswa yang belum tuntas / perlu remidial pada *${colLabel}*:\n`;
            componentRemedialList.forEach((item, i) => {
                text += `${i + 1}. *${item.name}* (${item.status})\n`;
            });
            text += `\nMohon siswa yang bersangkutan segera menemui Guru Mapel untuk perbaikan. Terima kasih! 🙏`;
        }

        navigator.clipboard.writeText(text).then(() => {
            showModernAlert('Berhasil Disalin!', `Teks pengumuman remidial ${colLabel} berhasil disalin ke clipboard. Tinggal tempel (paste) di WhatsApp.`, 'success');
        }).catch(() => {
            showToast('Error', 'Gagal menyalin ke clipboard', 'error');
        });
    }
};

// =========================================================================
// 10. SAVE SCORES TO SUPABASE (BATCH UPSERT)
// =========================================================================
window.saveScores = async function () {
    const mapel = document.getElementById('select-mapel').value;
    const kelas = document.getElementById('select-kelas').value;
    const semester = document.getElementById('select-semester').value;
    const tahunAjaran = raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString();

    if (!mapel || !kelas) {
        showToast('Peringatan', 'Pilih Mata Pelajaran dan Kelas terlebih dahulu!', 'warning');
        return false;
    }

    if (!supabase) {
        showModernAlert('Server Offline', 'Koneksi database tidak terhubung. Periksa koneksi internet.', 'error');
        return false;
    }

    const btnTopSave = document.getElementById('btn-top-save');
    const btnTopText = document.getElementById('btn-top-save-text');
    const btnBottomSave = document.getElementById('btn-bottom-save');
    const btnBottomText = document.getElementById('btn-bottom-save-text');

    if (btnTopSave && btnTopText) {
        btnTopSave.disabled = true;
        btnTopText.textContent = 'Menyimpan...';
    }
    if (btnBottomSave && btnBottomText) {
        btnBottomSave.disabled = true;
        btnBottomText.textContent = 'Menyimpan...';
    }

    const gradebookId = `${tahunAjaran.replace('/', '-')}_S${semester}_${kelas.replace(/\s+/g, '_')}_${mapel.replace(/\s+/g, '_')}`;

    try {
        // 1. Upsert Gradebook Master Record
        const { error: gbErr } = await supabase
            .from('guru_mapel_gradebooks')
            .upsert({
                id: gradebookId,
                tahun_ajaran: tahunAjaran,
                semester: semester,
                class_id: kelas,
                subject_id: mapel,
                teacher_nip: currentUserNip,
                updated_at: new Date().toISOString()
            }, { onConflict: 'id' });

        if (gbErr) throw gbErr;

        // 2. Upsert Components Structure
        const componentPayloads = activeColumns.map((col, idx) => ({
            gradebook_id: gradebookId,
            component_type: col.type,
            label: col.label,
            sequence: idx + 1,
            is_optional: col.is_optional || false
        }));

        const { data: compRes, error: compErr } = await supabase
            .from('guru_mapel_components')
            .upsert(componentPayloads, { onConflict: 'gradebook_id,component_type,label' })
            .select('*');

        if (compErr) throw compErr;

        // Map key ke component_id yang dikembalikan Supabase
        const compIdMap = {};
        if (compRes) {
            compRes.forEach(c => {
                const matchingCol = activeColumns.find(ac => ac.label === c.label && ac.type === c.component_type);
                if (matchingCol) {
                    compIdMap[matchingCol.key] = c.id;
                }
            });
        }

        // 3. Prepare Batch Scores & Summaries Payloads & Cleared Scores List
        const rows = document.querySelectorAll('#gradebook-tbody tr');
        const scorePayloads = [];
        const summaryPayloads = [];
        const clearedNisListByCompId = {}; // compId -> array of NIS
        const classCpDesc = document.getElementById('input-class-cp-desc')?.value.trim() || '';
        const isPerhotenanSave = isPerhotelanMapel(mapel);

        rows.forEach(row => {
            const nis = row.dataset.nis;
            if (!nis) return;

            const inputs = row.querySelectorAll('.score-input');

            const tugasVals = [];
            const sumatifVals = [];
            let sasSatVal = null;

            inputs.forEach(inp => {
                const colKey = inp.dataset.colKey;
                const type = inp.dataset.colType;
                const vStr = inp.value.trim();
                const compId = compIdMap[colKey];

                if (vStr !== '') {
                    const vNum = parseFloat(vStr);
                    if (!isNaN(vNum) && vNum >= 0 && vNum <= 100) {
                        if (type === 'tugas') tugasVals.push(vNum);
                        else if (type === 'sumatif') sumatifVals.push(vNum);
                        else if (type === 'sas' || type === 'sat') sasSatVal = vNum;

                        if (compId) {
                            scorePayloads.push({
                                gradebook_id: gradebookId,
                                student_nis: nis,
                                component_id: compId,
                                score: vNum,
                                updated_at: new Date().toISOString()
                            });
                        }
                    }
                } else if (compId) {
                    // Input dikosongkan/dihapus -> catat NIS untuk dihapus dari database
                    if (!clearedNisListByCompId[compId]) {
                        clearedNisListByCompId[compId] = [];
                    }
                    clearedNisListByCompId[compId].push(nis);

                    // Bersihkan dari map memori lokal
                    if (existingScoresMap[nis]) {
                        delete existingScoresMap[nis][colKey];
                    }
                }
            });

            // Calculate Averages & Final Score for Summary
            const tugasAvg = tugasVals.length > 0 ? (tugasVals.reduce((a, b) => a + b, 0) / tugasVals.length) : null;
            const sumatifAvg = sumatifVals.length > 0 ? (sumatifVals.reduce((a, b) => a + b, 0) / sumatifVals.length) : null;

            const wT = parseFloat(weights.tugas) || 0;
            const wS = parseFloat(weights.sumatif) || 0;
            const wSAS = parseFloat(weights.sas) || 0;

            let finalScore = null;
            let weightedSum = 0;
            let weightDivider = 0;

            if (tugasAvg !== null) { weightedSum += tugasAvg * (wT / 100); weightDivider += wT; }
            if (sumatifAvg !== null) { weightedSum += sumatifAvg * (wS / 100); weightDivider += wS; }
            if (sasSatVal !== null) { weightedSum += sasSatVal * (wSAS / 100); weightDivider += wSAS; }

            if (weightDivider > 0) {
                finalScore = Math.round(weightedSum * (100 / weightDivider));
            }

            const existingStudentSummary = existingSummariesMap[nis] || {};

            // Perhotelan: Ambil Nilai Rapor & Deskripsi CP per siswa dari input DOM atau cache memori jika sedang disembunyikan
            let savedFinalScore = finalScore;
            let savedCpDesc = classCpDesc;
            if (isPerhotenanSave) {
                const nilaiRaporInput = row.querySelector('.perhotelan-nilai-rapor');
                if (nilaiRaporInput) {
                    const nrVal = parseFloat(nilaiRaporInput.value.trim());
                    savedFinalScore = !isNaN(nrVal) ? Math.round(nrVal) : finalScore;
                } else if (existingStudentSummary.nilai_rapor !== undefined && existingStudentSummary.nilai_rapor !== null) {
                    savedFinalScore = existingStudentSummary.nilai_rapor;
                }
                const cpTextarea = row.querySelector('.perhotelan-deskripsi-cp');
                if (cpTextarea) {
                    savedCpDesc = cpTextarea.value.trim();
                } else if (existingStudentSummary.deskripsi_cp) {
                    savedCpDesc = existingStudentSummary.deskripsi_cp;
                }
            }

            summaryPayloads.push({
                gradebook_id: gradebookId,
                student_nis: nis,
                tugas_avg: tugasAvg !== null ? parseFloat(tugasAvg.toFixed(2)) : null,
                sumatif_avg: sumatifAvg !== null ? parseFloat(sumatifAvg.toFixed(2)) : null,
                sas_sat_score: sasSatVal,
                final_score: savedFinalScore,
                deskripsi_cp: savedCpDesc,
                catatan_apresiasi: existingStudentSummary.catatan_apresiasi || null,
                catatan_perilaku: existingStudentSummary.catatan_perilaku || null,
                catatan_evaluasi: existingStudentSummary.catatan_evaluasi || null,
                updated_at: new Date().toISOString()
            });

            // Update memori lokal ringkasan siswa agar sinkron
            existingSummariesMap[nis] = {
                ...existingStudentSummary,
                gradebook_id: gradebookId,
                student_nis: nis,
                tugas_avg: tugasAvg !== null ? parseFloat(tugasAvg.toFixed(2)) : null,
                sumatif_avg: sumatifAvg !== null ? parseFloat(sumatifAvg.toFixed(2)) : null,
                sas_sat_score: sasSatVal,
                final_score: savedFinalScore,
                deskripsi_cp: savedCpDesc,
                nilai_rapor: isPerhotenanSave ? savedFinalScore : undefined
            };
        });

        // 4. Batch Upsert Non-Empty Scores (Secara Otomatis Ter-chunk per 500 Baris)
        if (scorePayloads.length > 0) {
            const chunkSize = 500;
            for (let i = 0; i < scorePayloads.length; i += chunkSize) {
                const chunk = scorePayloads.slice(i, i + chunkSize);
                const { error: scErr } = await supabase
                    .from('guru_mapel_scores')
                    .upsert(chunk, { onConflict: 'gradebook_id,student_nis,component_id' });
                if (scErr) throw scErr;
            }
        }

        // 4.b Hapus Nilai yang Dikosongkan/Direset dari Supabase Database
        const compIdsToClean = Object.keys(clearedNisListByCompId);
        for (const compId of compIdsToClean) {
            const nises = clearedNisListByCompId[compId];
            if (nises && nises.length > 0) {
                const chunkSize = 500;
                for (let i = 0; i < nises.length; i += chunkSize) {
                    const nisChunk = nises.slice(i, i + chunkSize);
                    const { error: delErr } = await supabase
                        .from('guru_mapel_scores')
                        .delete()
                        .eq('gradebook_id', gradebookId)
                        .eq('component_id', compId)
                        .in('student_nis', nisChunk);
                    if (delErr) console.warn('Gagal menghapus nilai kosong dari Supabase:', delErr);
                }
            }
        }

        // 5. Batch Upsert Summaries (Secara Otomatis Ter-chunk per 500 Baris)
        if (summaryPayloads.length > 0) {
            const chunkSize = 500;
            for (let i = 0; i < summaryPayloads.length; i += chunkSize) {
                const chunk = summaryPayloads.slice(i, i + chunkSize);
                const { data: sumData, error: sumErr } = await supabase
                    .from('guru_mapel_summaries')
                    .upsert(chunk, { onConflict: 'gradebook_id,student_nis' })
                    .select('id, student_nis');
                if (sumErr) throw sumErr;
                if (sumData && Array.isArray(sumData)) {
                    sumData.forEach(item => {
                        if (item.student_nis && existingSummariesMap[item.student_nis]) {
                            existingSummariesMap[item.student_nis].id = item.id;
                        }
                    });
                }
            }
        }

        // Audit Trail Lokal / Firebase jika diperlukan
        if (typeof window.logAudit === 'function') {
            window.logAudit('SAVE_GURU_MAPEL_GRADES', 'guru_mapel_gradebooks', gradebookId, {
                mapel, kelas, studentCount: loadedStudents.length, scoresCount: scorePayloads.length
            }, `Menyimpan data nilai ${mapel} kelas ${kelas}`);
        }

        setGradebookDirty(false);
        sessionGradebookCache[gradebookId] = {
            students: [...loadedStudents],
            scoresMap: JSON.parse(JSON.stringify(existingScoresMap)),
            summariesMap: JSON.parse(JSON.stringify(existingSummariesMap)),
            componentMap: { ...supabaseComponentMap },
            minTugas: minRequiredTugasCount,
            minSumatif: minRequiredSumatifCount
        };
        showModernAlert('Berhasil Disimpan', `Data nilai <b>${mapel}</b> kelas <b>${kelas}</b> berhasil disimpan ke server database.`, 'success');
        return true;

    } catch (e) {
        console.error('[Portal Guru Mapel] Gagal menyimpan data nilai:', e);
        showModernAlert('Gagal Menyimpan', e.message || 'Terjadi kesalahan saat menyimpan data ke server.', 'error');
        return false;
    } finally {
        if (btnTopSave && btnTopText) {
            btnTopSave.disabled = false;
            btnTopText.textContent = 'Simpan Nilai';
        }
        if (btnBottomSave && btnBottomText) {
            btnBottomSave.disabled = false;
            btnBottomText.textContent = 'Simpan Nilai';
        }
    }
};

// SSOT Alias Backward Compatibility
window.saveGradebookData = window.saveScores;

// =========================================================================
// 11. PASTE EXCEL FEATURE
// =========================================================================
// Helper parsing baris paste Excel / Google Sheets
function parsePasteExcelRow(line, target) {
    if (!line) return null;
    const trimmed = line.trim();
    if (!trimmed) return null;

    if (target === 'nilai_rapor') {
        // Khusus Nilai Rapor Perhotelan: Membutuhkan 3 komponen: NIS, NR, Deskripsi CP
        if (trimmed.includes('\t')) {
            const rawParts = trimmed.split('\t').map(p => p.trim());
            if (rawParts.length >= 3) {
                return [rawParts[0], rawParts[1], rawParts.slice(2).join(' ').trim()];
            } else if (rawParts.length === 2) {
                return [rawParts[0], rawParts[1], ''];
            }
            return rawParts;
        } else if (trimmed.includes(';')) {
            const rawParts = trimmed.split(';').map(p => p.trim());
            if (rawParts.length >= 3) {
                return [rawParts[0], rawParts[1], rawParts.slice(2).join(';').trim()];
            } else if (rawParts.length === 2) {
                return [rawParts[0], rawParts[1], ''];
            }
            return rawParts;
        } else {
            // Coba ekstrak pola: [NIS] [Nilai Numerik] [Deskripsi CP]
            const match = trimmed.match(/^(\S+)[\s\t]+(\d+(?:[\.,]\d+)?)[\s\t]+(.*)$/);
            if (match) {
                return [match[1], match[2], match[3].trim()];
            }
            // Fallback split spasi ganda atau spasi biasa
            const rawParts = trimmed.split(/\s{2,}|\t/).map(p => p.trim()).filter(Boolean);
            if (rawParts.length >= 3) {
                return [rawParts[0], rawParts[1], rawParts.slice(2).join(' ').trim()];
            }
            const spaceParts = trimmed.split(/\s+/);
            if (spaceParts.length >= 3 && !isNaN(parseFloat(spaceParts[1].replace(',', '.')))) {
                return [spaceParts[0], spaceParts[1], spaceParts.slice(2).join(' ').trim()];
            }
            return rawParts;
        }
    } else {
        // Format umum: Satu Kolom atau Semua Kolom Aktif
        if (trimmed.includes('\t')) {
            return trimmed.split('\t').map(p => p.trim()).filter(p => p !== '');
        } else {
            return trimmed.split(/\t|;|,|\s{2,}/).map(p => p.trim()).filter(p => p !== '');
        }
    }
}
window.parsePasteExcelRow = parsePasteExcelRow;

// Helper pencocokan siswa berdasarkan NIS (mendukung full NIS atau 4-digit NIS sekolah)
function findStudentByNis(rawNisInput) {
    const cleanNis = String(rawNisInput || '').replace(/[^\d]/g, '');
    if (!cleanNis || !Array.isArray(loadedStudents)) return null;
    return loadedStudents.find(s => {
        const sNis = String(s.nis || '').replace(/[^\d]/g, '');
        return sNis === cleanNis || (cleanNis.length >= 4 && sNis.endsWith(cleanNis)) || (sNis.length >= 4 && cleanNis.endsWith(sNis));
    }) || null;
}
window.findStudentByNis = findStudentByNis;

window.onPasteTargetChange = function () {
    const selectTarget = document.getElementById('select-paste-target');
    const target = selectTarget ? selectTarget.value : 'all';
    const guidePerhotelan = document.getElementById('paste-guide-perhotelan');
    const textarea = document.getElementById('textarea-excel-paste');
    const previewContainer = document.getElementById('paste-preview-container');
    const previewTable = document.getElementById('table-paste-preview');
    const summaryBadge = document.getElementById('paste-preview-summary-badge');

    if (previewContainer) previewContainer.classList.add('hidden');
    if (previewTable) previewTable.innerHTML = '';
    if (summaryBadge) summaryBadge.innerHTML = '';

    if (target === 'nilai_rapor') {
        if (guidePerhotelan) guidePerhotelan.classList.remove('hidden');
        if (textarea) {
            textarea.placeholder = "Tempel 3 kolom berurutan dari Excel (NIS, Nilai Rapor, Deskripsi CP):\nContoh:\n4243\t85\tMenunjukkan penguasaan sangat baik dalam Housekeeping, reservasi, dan laundry.\n4396\t78\tMenunjukkan penguasaan baik dalam Front Office dan pelayanan tamu.";
        }
    } else {
        if (guidePerhotelan) guidePerhotelan.classList.add('hidden');
        if (textarea) {
            textarea.placeholder = "Tempel (Paste / Ctrl+V) data hasil copy dari Excel di sini...";
        }
    }
};

window.openPasteModal = function () {
    const mapel = document.getElementById('select-mapel').value;
    const kelas = document.getElementById('select-kelas').value;

    if (!mapel || !kelas || loadedStudents.length === 0) {
        showToast('Peringatan', 'Muat data siswa kelas & mapel terlebih dahulu!', 'warning');
        return;
    }

    const selectTarget = document.getElementById('select-paste-target');
    if (selectTarget) {
        selectTarget.innerHTML = `<option value="all">Semua Kolom Aktif (${activeColumns.length} Kolom: ${activeColumns.map(c => c.label).join(', ')})</option>`;
        activeColumns.forEach(c => {
            selectTarget.innerHTML += `<option value="${c.key}">${c.label}</option>`;
        });
        if (isPerhotelanMapel(mapel)) {
            selectTarget.innerHTML += `<option value="nilai_rapor">Nilai Rapor (Khusus Perhotelan)</option>`;
        }
    }

    const textarea = document.getElementById('textarea-excel-paste');
    if (textarea) textarea.value = '';

    window.onPasteTargetChange();

    const modal = document.getElementById('modal-paste-excel');
    if (modal) modal.classList.remove('hidden');
};

window.closePasteModal = function () {
    const modal = document.getElementById('modal-paste-excel');
    if (modal) modal.classList.add('hidden');
    const previewContainer = document.getElementById('paste-preview-container');
    if (previewContainer) previewContainer.classList.add('hidden');
};

window.previewPasteExcelData = function () {
    const rawData = document.getElementById('textarea-excel-paste')?.value.trim();
    const target = document.getElementById('select-paste-target')?.value;
    const previewContainer = document.getElementById('paste-preview-container');
    const previewTable = document.getElementById('table-paste-preview');
    const summaryBadge = document.getElementById('paste-preview-summary-badge');

    if (!rawData) {
        showToast('Peringatan', 'Tempel (Paste) data dari Excel terlebih dahulu!', 'warning');
        return;
    }

    const lines = rawData.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) {
        showToast('Peringatan', 'Data yang ditempel kosong!', 'warning');
        return;
    }

    let validCount = 0;
    let tableRowsHTML = '';

    if (target === 'nilai_rapor') {
        let completeRowsCount = 0;

        lines.forEach((line, idx) => {
            const parts = parsePasteExcelRow(line, 'nilai_rapor');
            const rawNis = parts && parts[0] ? parts[0].replace(/[^\d]/g, '') : '';
            const rawNr = parts && parts[1] !== undefined ? parts[1] : '';
            const rawCp = parts && parts[2] !== undefined ? parts[2] : '';

            const student = findStudentByNis(rawNis);
            const studentName = student ? student.name : (rawNis ? 'Siswa tidak ditemukan di kelas ini' : 'NIS Kosong');

            const nrNum = parseFloat(String(rawNr).replace(',', '.'));
            const isNrValid = !isNaN(nrNum) && nrNum >= 0 && nrNum <= 100;
            const isCpValid = rawCp && rawCp.trim().length > 0;
            const has3Cols = parts && parts.length >= 3 && rawNis && rawNr !== '' && isCpValid;

            let statusHtml = '';
            let isValid = false;

            if (!has3Cols) {
                statusHtml = '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300">Wajib 3 Kolom</span>';
            } else if (!student) {
                statusHtml = '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">NIS Tidak Cocok</span>';
            } else if (!isNrValid) {
                statusHtml = '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300">NR Tidak Valid</span>';
            } else {
                isValid = true;
                validCount++;
                statusHtml = '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300"><i class="fa-solid fa-check text-[9px] mr-0.5"></i> Siap Diterapkan</span>';
            }

            if (has3Cols) completeRowsCount++;

            tableRowsHTML += `
                <tr class="border-b border-slate-100 dark:border-slate-800 ${isValid ? 'hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20' : 'bg-rose-50/20 dark:bg-rose-950/10'}">
                    <td class="p-2 text-center text-slate-400 text-[10px] font-mono">${idx + 1}</td>
                    <td class="p-2 font-mono font-bold text-slate-700 dark:text-slate-300">${escapeHTML(rawNis || '-')}</td>
                    <td class="p-2 font-medium text-slate-800 dark:text-slate-100 ${student ? '' : 'italic text-amber-600 dark:text-amber-400'}">${escapeHTML(studentName)}</td>
                    <td class="p-2 text-center font-bold ${isNrValid ? 'text-purple-700 dark:text-purple-300' : 'text-rose-500'}">${isNrValid ? nrNum : (escapeHTML(String(rawNr)) || '-')}</td>
                    <td class="p-2 text-slate-600 dark:text-slate-300 max-w-[240px] truncate" title="${escapeHTML(rawCp || '')}">${escapeHTML(rawCp || '-')}</td>
                    <td class="p-2 text-center whitespace-nowrap">${statusHtml}</td>
                </tr>
            `;
        });

        if (previewTable) {
            previewTable.innerHTML = `
                <thead class="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold sticky top-0 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                        <th class="p-2 text-center w-8">#</th>
                        <th class="p-2 w-16">NIS</th>
                        <th class="p-2">Nama Siswa</th>
                        <th class="p-2 text-center w-14">NR</th>
                        <th class="p-2">Deskripsi CP</th>
                        <th class="p-2 text-center w-28">Status</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                    ${tableRowsHTML}
                </tbody>
            `;
        }

        if (summaryBadge) {
            summaryBadge.innerHTML = `
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${validCount > 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200' : 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200'}">
                    ${validCount} dari ${lines.length} Baris Siap Diterapkan
                </span>
            `;
        }

        if (completeRowsCount === 0) {
            showToast('Perhatian Wajib 3 Kolom', 'Data belum memuat 3 kolom (NIS, Nilai Rapor, Deskripsi CP). Periksa format data Excel Anda!', 'warning');
        }

    } else {
        // Mode umum (Satu Kolom atau Semua Kolom Aktif)
        lines.forEach((line, idx) => {
            const parts = parsePasteExcelRow(line, target);
            const rawNis = parts && parts[0] ? parts[0].replace(/[^\d]/g, '') : '';
            const student = findStudentByNis(rawNis);
            const studentName = student ? student.name : (rawNis ? 'Siswa tidak ditemukan di kelas ini' : 'NIS Kosong');

            let isValid = false;
            let statusHtml = '';
            let valPreview = '';

            if (!parts || parts.length < 2) {
                statusHtml = '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300">Format Kurang</span>';
                valPreview = '-';
            } else if (!student) {
                statusHtml = '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">NIS Tidak Cocok</span>';
                valPreview = parts.slice(1).join(', ');
            } else {
                if (target === 'all') {
                    const scores = parts.slice(1, 1 + activeColumns.length).map(v => {
                        const n = parseFloat(String(v).replace(',', '.'));
                        return !isNaN(n) ? n : '-';
                    });
                    valPreview = scores.join(', ');
                    isValid = scores.some(s => s !== '-');
                } else {
                    const vNum = parseFloat(String(parts[1]).replace(',', '.'));
                    if (!isNaN(vNum) && vNum >= 0 && vNum <= 100) {
                        valPreview = String(vNum);
                        isValid = true;
                    } else {
                        valPreview = parts[1] || '-';
                    }
                }

                if (isValid) {
                    validCount++;
                    statusHtml = '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300"><i class="fa-solid fa-check text-[9px] mr-0.5"></i> Siap</span>';
                } else {
                    statusHtml = '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300">Nilai Invalid</span>';
                }
            }

            tableRowsHTML += `
                <tr class="border-b border-slate-100 dark:border-slate-800 ${isValid ? 'hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20' : 'bg-rose-50/20 dark:bg-rose-950/10'}">
                    <td class="p-2 text-center text-slate-400 text-[10px] font-mono">${idx + 1}</td>
                    <td class="p-2 font-mono font-bold text-slate-700 dark:text-slate-300">${escapeHTML(rawNis || '-')}</td>
                    <td class="p-2 font-medium text-slate-800 dark:text-slate-100 ${student ? '' : 'italic text-amber-600 dark:text-amber-400'}">${escapeHTML(studentName)}</td>
                    <td class="p-2 text-center font-bold text-emerald-700 dark:text-emerald-300">${escapeHTML(valPreview)}</td>
                    <td class="p-2 text-center whitespace-nowrap">${statusHtml}</td>
                </tr>
            `;
        });

        if (previewTable) {
            previewTable.innerHTML = `
                <thead class="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold sticky top-0 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                        <th class="p-2 text-center w-8">#</th>
                        <th class="p-2 w-16">NIS</th>
                        <th class="p-2">Nama Siswa</th>
                        <th class="p-2 text-center w-32">Nilai ${target === 'all' ? 'Komponen' : ''}</th>
                        <th class="p-2 text-center w-28">Status</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                    ${tableRowsHTML}
                </tbody>
            `;
        }

        if (summaryBadge) {
            summaryBadge.innerHTML = `
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${validCount > 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200' : 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200'}">
                    ${validCount} dari ${lines.length} Baris Siap Diterapkan
                </span>
            `;
        }
    }

    if (previewContainer) {
        previewContainer.classList.remove('hidden');
    }
};

window.applyPasteExcelData = function () {
    const rawData = document.getElementById('textarea-excel-paste')?.value.trim();
    const target = document.getElementById('select-paste-target')?.value;

    if (!rawData) {
        showToast('Peringatan', 'Paste data terlebih dahulu!', 'warning');
        return;
    }

    const lines = rawData.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) {
        showToast('Peringatan', 'Data yang ditempel kosong!', 'warning');
        return;
    }

    // Validasi Wajib 3 Kolom khusus target Nilai Rapor Perhotelan
    if (target === 'nilai_rapor') {
        const valid3ColRows = lines.filter(line => {
            const parts = parsePasteExcelRow(line, 'nilai_rapor');
            return parts && parts.length >= 3 && parts[0] && parts[1] !== '' && parts[2] && parts[2].trim().length > 0;
        });

        if (valid3ColRows.length === 0) {
            showToast(
                'Wajib 3 Kolom',
                'Impor Nilai Rapor Perhotelan wajib memuat 3 kolom: NIS, Nilai Rapor (NR), dan Deskripsi CP!',
                'error'
            );
            return;
        }

        // Auto-reveal kolom rapor jika sedang disembunyikan
        if (!isPerhotelanRaporVisible) {
            const curRows = document.querySelectorAll('#gradebook-tbody tr');
            curRows.forEach(row => {
                const nis = row.dataset.nis;
                if (!nis) return;
                const nrInp = row.querySelector('.perhotelan-nilai-rapor');
                if (nrInp) {
                    if (!existingSummariesMap[nis]) existingSummariesMap[nis] = {};
                    const v = parseFloat(nrInp.value.trim());
                    existingSummariesMap[nis].nilai_rapor = isNaN(v) ? null : v;
                }
                const cpInp = row.querySelector('.perhotelan-deskripsi-cp');
                if (cpInp) {
                    if (!existingSummariesMap[nis]) existingSummariesMap[nis] = {};
                    existingSummariesMap[nis].deskripsi_cp = cpInp.value;
                }
            });

            isPerhotelanRaporVisible = true;
            window.isPerhotelanRaporVisible = true;
            const currentMapel = document.getElementById('select-mapel')?.value || '';
            updatePerhotelanToggleButton(isPerhotelanMapel(currentMapel));
            const semSelect = document.getElementById('select-semester');
            renderGradebookTable(semSelect ? semSelect.value : '1');
        }
    }

    let matchCount = 0;
    const allRows = document.querySelectorAll('#gradebook-tbody tr');

    lines.forEach(line => {
        const parts = parsePasteExcelRow(line, target);
        if (!parts || parts.length < 2) return;

        // Extract NIS digits only (bisa 4 digit untuk NIS sekolah)
        const rawNis = parts[0].replace(/[^\d]/g, '');
        if (!rawNis) return;

        // Match student row by NIS (matching exact NIS / 4-digit NIS)
        let row = null;
        allRows.forEach(r => {
            const rNis = (r.dataset.nis || '').replace(/[^\d]/g, '');
            if (rNis === rawNis || (rawNis.length >= 4 && rNis.endsWith(rawNis)) || (rNis.length >= 4 && rawNis.endsWith(rNis))) {
                row = r;
            }
        });

        if (row) {
            const rowNis = row.dataset.nis || rawNis;

            if (target === 'all') {
                // Paste berurutan ke seluruh kolom aktif (inputs) yang tampil saat ini
                const inputs = row.querySelectorAll('.score-input');
                let rowUpdated = false;
                inputs.forEach((inp, idx) => {
                    if (parts[idx + 1] !== undefined) {
                        const vNum = parseFloat(String(parts[idx + 1]).replace(',', '.'));
                        if (!isNaN(vNum) && vNum >= 0 && vNum <= 100) {
                            inp.value = vNum;
                            window.onScoreInputChange(inp);
                            rowUpdated = true;
                        }
                    }
                });
                if (rowUpdated) matchCount++;
            } else if (target === 'nilai_rapor') {
                // Wajib 3 kolom (NIS, NR, Deskripsi CP)
                const nrPart = parts[1];
                const cpPart = parts[2];

                if (nrPart !== undefined && cpPart !== undefined && cpPart.trim().length > 0) {
                    const vNum = parseFloat(String(nrPart).replace(',', '.'));
                    if (!isNaN(vNum) && vNum >= 0 && vNum <= 100) {
                        const nrInput = row.querySelector('.perhotelan-nilai-rapor');
                        if (nrInput) {
                            nrInput.value = vNum;
                            window.onNilaiRaporChange(nrInput);
                        } else {
                            if (!existingSummariesMap[rowNis]) existingSummariesMap[rowNis] = {};
                            existingSummariesMap[rowNis].nilai_rapor = vNum;
                        }

                        const cpInput = row.querySelector('.perhotelan-deskripsi-cp');
                        const cleanCp = cpPart.trim();
                        if (cpInput) {
                            cpInput.value = cleanCp;
                            window.onDeskripsiCpChange(cpInput);
                        } else {
                            if (!existingSummariesMap[rowNis]) existingSummariesMap[rowNis] = {};
                            existingSummariesMap[rowNis].deskripsi_cp = cleanCp;
                        }
                        matchCount++;
                    }
                }
            } else {
                // Paste spesifik ke 1 kolom target
                const inputs = row.querySelectorAll('.score-input');
                const targetInp = Array.from(inputs).find(i => i.dataset.colKey === target);
                if (targetInp && parts[1] !== undefined) {
                    const vNum = parseFloat(String(parts[1]).replace(',', '.'));
                    if (!isNaN(vNum) && vNum >= 0 && vNum <= 100) {
                        targetInp.value = vNum;
                        window.onScoreInputChange(targetInp);
                        matchCount++;
                    }
                }
            }
        }
    });

    window.closePasteModal();

    if (matchCount > 0) {
        if (typeof setGradebookDirty === 'function') {
            setGradebookDirty(true);
        }
        if (target === 'nilai_rapor') {
            showToast('Paste Berhasil', `${matchCount} baris Nilai Rapor & Deskripsi CP (3 Kolom) berhasil diterapkan.`, 'success');
        } else {
            showToast('Paste Berhasil', `${matchCount} baris nilai siswa (NIS 4 Digit) berhasil diterapkan.`, 'success');
        }
    } else {
        showToast('Peringatan', 'Tidak ada data siswa yang cocok dengan NIS yang ditempel.', 'warning');
    }
};

// =========================================================================
// 5.B IMPOR NILAI SISWA DARI KUIS LMS KE TABEL PENILAIAN
// =========================================================================
let currentImportLmsStudents = [];
let currentImportLmsMaterials = [];

window.openImportLmsModal = async function (preselectedMaterialId = null) {
    const mapel = document.getElementById('select-mapel')?.value;
    const kelas = document.getElementById('select-kelas')?.value;

    if (!mapel || !kelas || !loadedStudents || loadedStudents.length === 0) {
        showToast('Peringatan', 'Muat data siswa kelas & mapel pada lembar penilaian terlebih dahulu!', 'warning');
        return;
    }

    const modal = document.getElementById('modal-import-lms-grade');
    if (!modal) return;

    modal.classList.remove('hidden');
    const selectTargetCol = document.getElementById('select-import-lms-target-col');
    const selectMaterial = document.getElementById('select-import-lms-material');
    const checkOverwrite = document.getElementById('check-import-lms-overwrite');
    const btnApply = document.getElementById('btn-apply-import-lms');
    const tbody = document.getElementById('tbody-import-lms-preview');
    const summaryBadge = document.getElementById('badge-import-lms-summary');

    if (checkOverwrite) checkOverwrite.checked = true;
    if (btnApply) btnApply.disabled = true;
    if (summaryBadge) summaryBadge.innerHTML = '';
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">Pilih kuis LMS di atas untuk melihat pratinjau nilai siswa.</td></tr>';
    }

    // Populate target columns
    if (selectTargetCol) {
        selectTargetCol.innerHTML = '';
        const semester = document.getElementById('select-semester')?.value || '1';
        if (!activeColumns || activeColumns.length === 0) {
            if (typeof getActiveColumns === 'function') {
                activeColumns = getActiveColumns(semester);
            }
        }
        if (!activeColumns || activeColumns.length === 0) {
            const base = semester === '2' ? ALL_COLUMNS_S2 : ALL_COLUMNS_S1;
            if (Array.isArray(base)) {
                activeColumns = base;
            }
        }
        (activeColumns || []).forEach(c => {
            selectTargetCol.innerHTML += `<option value="${escapeHTML(c.key)}">${escapeHTML(c.label)}</option>`;
        });
        if (isPerhotelanMapel(mapel)) {
            selectTargetCol.innerHTML += `<option value="nilai_rapor">Nilai Rapor (Khusus Perhotelan)</option>`;
        }
        if (!selectTargetCol.innerHTML) {
            selectTargetCol.innerHTML = '<option value="">Tidak ada kolom penilaian aktif</option>';
        }
    }

    // Populate quiz materials
    if (selectMaterial) {
        selectMaterial.innerHTML = '<option value="">Memuat daftar kuis LMS...</option>';
        selectMaterial.disabled = true;
    }

    try {
        let quizes = (currentLmsMaterials || []).filter(m =>
            isClassEqual(m.class_name, kelas) && (Number(m.quiz_enabled) === 1 || m.resource_type === 'quiz' || lmsHasQuiz(m))
        );

        if (quizes.length === 0) {
            const fetched = await cfGetLmsMaterials({ class: kelas, subject: mapel });
            if (Array.isArray(fetched)) {
                quizes = fetched.filter(m => (Number(m.quiz_enabled) === 1 || m.resource_type === 'quiz' || lmsHasQuiz(m)));
            }
        }

        currentImportLmsMaterials = quizes;

        if (selectMaterial) {
            selectMaterial.disabled = false;
            if (quizes.length === 0) {
                selectMaterial.innerHTML = '<option value="">Tidak ada kuis LMS aktif pada kelas & mapel ini</option>';
                if (btnApply) btnApply.disabled = true;
                return;
            }

            selectMaterial.innerHTML = quizes.map(q => 
                `<option value="${escapeHTML(String(q.id))}">${escapeHTML(q.title || 'Kuis Tanpa Judul')}</option>`
            ).join('');

            if (preselectedMaterialId) {
                const found = quizes.find(q => String(q.id) === String(preselectedMaterialId));
                if (found) {
                    selectMaterial.value = String(preselectedMaterialId);
                }
            }

            await window.onImportLmsSourceChange();
        }
    } catch (err) {
        console.error('[Import LMS] Error loading quizes:', err);
        showToast('Error', 'Gagal memuat daftar kuis LMS: ' + (err.message || ''), 'error');
        if (selectMaterial) {
            selectMaterial.disabled = false;
            selectMaterial.innerHTML = '<option value="">Gagal memuat kuis</option>';
        }
    }
};

window.closeImportLmsModal = function () {
    const modal = document.getElementById('modal-import-lms-grade');
    if (modal) modal.classList.add('hidden');
    currentImportLmsStudents = [];
};

window.onImportLmsSourceChange = async function () {
    const selectMaterial = document.getElementById('select-import-lms-material');
    const loadingEl = document.getElementById('wrapper-import-lms-loading');
    const previewEl = document.getElementById('wrapper-import-lms-preview');
    const btnApply = document.getElementById('btn-apply-import-lms');
    const materialId = selectMaterial?.value;

    if (!materialId) {
        currentImportLmsStudents = [];
        window.renderImportLmsPreview();
        return;
    }

    if (loadingEl) loadingEl.classList.remove('hidden');
    if (previewEl) previewEl.classList.add('hidden');
    if (btnApply) btnApply.disabled = true;

    try {
        const res = await cfGetLmsMaterialProgress(materialId);
        currentImportLmsStudents = Array.isArray(res?.data) ? res.data : [];
    } catch (err) {
        console.error('[Import LMS] Error fetching progress:', err);
        showToast('Error', 'Gagal mengambil nilai kuis LMS: ' + (err.message || ''), 'error');
        currentImportLmsStudents = [];
    } finally {
        if (loadingEl) loadingEl.classList.add('hidden');
        if (previewEl) previewEl.classList.remove('hidden');
        window.renderImportLmsPreview();
    }
};

window.renderImportLmsPreview = function () {
    const tbody = document.getElementById('tbody-import-lms-preview');
    const summaryBadge = document.getElementById('badge-import-lms-summary');
    const btnApply = document.getElementById('btn-apply-import-lms');
    const selectTargetCol = document.getElementById('select-import-lms-target-col');
    const checkOverwrite = document.getElementById('check-import-lms-overwrite');

    if (!tbody) return;

    const targetCol = selectTargetCol?.value || '';
    const isOverwrite = !!checkOverwrite?.checked;

    if (!currentImportLmsStudents || currentImportLmsStudents.length === 0 || !targetCol) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">Tidak ada data kuis atau siswa untuk ditampilkan.</td></tr>';
        if (btnApply) btnApply.disabled = true;
        if (summaryBadge) summaryBadge.innerHTML = '';
        return;
    }

    let readyCount = 0;
    let tableRowsHTML = '';
    const allRows = document.querySelectorAll('#gradebook-tbody tr');
    const gradebookRowMap = new Map();
    allRows.forEach(r => {
        const raw = (r.dataset.nis || '').replace(/[^\d]/g, '');
        if (raw) gradebookRowMap.set(raw, r);
    });

    const students = Array.isArray(loadedStudents) && loadedStudents.length > 0 
        ? loadedStudents 
        : currentImportLmsStudents;

    students.forEach((student, idx) => {
        const cleanNis = String(student.nis || '').replace(/[^\d]/g, '');
        const studentName = student.name || student.nama || '-';

        let row = gradebookRowMap.get(cleanNis);
        if (!row && cleanNis.length >= 4) {
            for (const [rNis, rElem] of gradebookRowMap.entries()) {
                if (rNis.endsWith(cleanNis) || cleanNis.endsWith(rNis)) {
                    row = rElem;
                    break;
                }
            }
        }

        let currentScoreStr = '';
        if (row) {
            if (targetCol === 'nilai_rapor') {
                const nrInp = row.querySelector('.perhotelan-nilai-rapor');
                currentScoreStr = nrInp ? nrInp.value.trim() : (existingSummariesMap[cleanNis]?.nilai_rapor ?? '');
            } else {
                const targetInp = Array.from(row.querySelectorAll('.score-input')).find(i => i.dataset.colKey === targetCol);
                currentScoreStr = targetInp ? targetInp.value.trim() : '';
            }
        }

        const lmsRecord = (currentImportLmsStudents || []).find(ls => {
            const lNis = String(ls.nis || '').replace(/[^\d]/g, '');
            return lNis === cleanNis || (cleanNis.length >= 4 && (lNis.endsWith(cleanNis) || cleanNis.endsWith(lNis)));
        });

        let lmsScoreVal = null;
        let isPendingReview = false;
        let lmsScoreDisplay = '<span class="text-slate-400 italic">Belum Mengerjakan</span>';

        if (lmsRecord) {
            let quizMeta = {};
            try { quizMeta = JSON.parse(lmsRecord.quiz_answers || '{}'); } catch (_) {}
            isPendingReview = (quizMeta.status === 'pending_review');

            if (isPendingReview) {
                lmsScoreDisplay = '<span class="text-amber-600 dark:text-amber-400 font-semibold">Menunggu Diperiksa</span>';
            } else if (lmsRecord.quiz_score !== null && lmsRecord.quiz_score !== undefined && !isNaN(Number(lmsRecord.quiz_score))) {
                lmsScoreVal = Math.round(Number(lmsRecord.quiz_score) * 10) / 10;
                lmsScoreDisplay = `<span class="font-bold text-slate-800 dark:text-slate-100">${lmsScoreVal}</span>`;
            }
        }

        const hasValidLmsScore = (lmsScoreVal !== null && !isPendingReview);
        const hasExistingScore = (currentScoreStr !== '' && !isNaN(Number(currentScoreStr)));

        let finalScoreDisplay = '-';
        let statusBadge = '';
        let rowClass = 'hover:bg-slate-50 dark:hover:bg-slate-800/40';

        if (!hasValidLmsScore) {
            finalScoreDisplay = hasExistingScore ? escapeHTML(String(currentScoreStr)) : '-';
            statusBadge = isPendingReview
                ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">Dilewati (Esai)</span>'
                : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">Dilewati</span>';
        } else if (!row) {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">NIS Tidak Ada</span>';
        } else if (hasExistingScore && !isOverwrite) {
            finalScoreDisplay = escapeHTML(String(currentScoreStr));
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">Nilai Lama Tetap</span>';
        } else {
            finalScoreDisplay = `<span class="font-bold text-purple-700 dark:text-purple-300">${lmsScoreVal}</span>`;
            readyCount++;
            rowClass = 'bg-purple-50/20 dark:bg-purple-950/10 hover:bg-purple-50/40 dark:hover:bg-purple-950/20';
            statusBadge = hasExistingScore
                ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">Akan Ditimpa</span>'
                : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60"><i class="fa-solid fa-check mr-0.5"></i> Siap Diimpor</span>';
        }

        tableRowsHTML += `
            <tr class="border-b border-slate-100 dark:border-slate-800 ${rowClass}">
                <td class="p-2 text-center text-slate-400 text-[10px] font-mono">${idx + 1}</td>
                <td class="p-2 font-mono font-bold text-slate-700 dark:text-slate-300">${escapeHTML(cleanNis || '-')}</td>
                <td class="p-2 font-medium text-slate-800 dark:text-slate-100">${escapeHTML(studentName)}</td>
                <td class="p-2 text-center">${lmsScoreDisplay}</td>
                <td class="p-2 text-center text-slate-600 dark:text-slate-400">${hasExistingScore ? escapeHTML(String(currentScoreStr)) : '-'}</td>
                <td class="p-2 text-center font-bold">${finalScoreDisplay}</td>
                <td class="p-2 text-center whitespace-nowrap">${statusBadge}</td>
            </tr>
        `;
    });

    tbody.innerHTML = tableRowsHTML;

    if (summaryBadge) {
        summaryBadge.innerHTML = `
            <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold ${readyCount > 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700'}">
                ${readyCount} dari ${students.length} Siswa Siap Diimpor
            </span>
        `;
    }

    if (btnApply) {
        btnApply.disabled = (readyCount === 0);
    }
};

window.applyImportLmsData = function () {
    const selectTargetCol = document.getElementById('select-import-lms-target-col');
    const checkOverwrite = document.getElementById('check-import-lms-overwrite');
    const targetCol = selectTargetCol?.value;
    const isOverwrite = !!checkOverwrite?.checked;

    if (!targetCol) {
        showToast('Peringatan', 'Pilih kolom tujuan penilaian terlebih dahulu!', 'warning');
        return;
    }

    if (!currentImportLmsStudents || currentImportLmsStudents.length === 0) {
        showToast('Peringatan', 'Tidak ada data nilai kuis LMS yang dimuat.', 'warning');
        return;
    }

    const allRows = document.querySelectorAll('#gradebook-tbody tr');
    const gradebookRowMap = new Map();
    allRows.forEach(r => {
        const raw = (r.dataset.nis || '').replace(/[^\d]/g, '');
        if (raw) gradebookRowMap.set(raw, r);
    });

    if (targetCol === 'nilai_rapor' && !isPerhotelanRaporVisible) {
        isPerhotelanRaporVisible = true;
        window.isPerhotelanRaporVisible = true;
        const currentMapel = document.getElementById('select-mapel')?.value || '';
        updatePerhotelanToggleButton(isPerhotelanMapel(currentMapel));
        const semSelect = document.getElementById('select-semester');
        renderGradebookTable(semSelect ? semSelect.value : '1');
    }

    let matchCount = 0;

    currentImportLmsStudents.forEach(ls => {
        let quizMeta = {};
        try { quizMeta = JSON.parse(ls.quiz_answers || '{}'); } catch (_) {}
        if (quizMeta.status === 'pending_review') return;
        if (ls.quiz_score === null || ls.quiz_score === undefined || isNaN(Number(ls.quiz_score))) return;

        const cleanNis = String(ls.nis || '').replace(/[^\d]/g, '');
        if (!cleanNis) return;

        let row = gradebookRowMap.get(cleanNis);
        if (!row && cleanNis.length >= 4) {
            for (const [rNis, rElem] of gradebookRowMap.entries()) {
                if (rNis.endsWith(cleanNis) || cleanNis.endsWith(rNis)) {
                    row = rElem;
                    break;
                }
            }
        }

        if (!row) return;

        const scoreVal = Math.round(Number(ls.quiz_score) * 10) / 10;

        if (targetCol === 'nilai_rapor') {
            const nrInput = row.querySelector('.perhotelan-nilai-rapor');
            const curVal = nrInput ? nrInput.value.trim() : (existingSummariesMap[cleanNis]?.nilai_rapor ?? '');
            if (curVal !== '' && !isOverwrite) return;

            if (nrInput) {
                nrInput.value = scoreVal;
                window.onNilaiRaporChange(nrInput);
                matchCount++;
            } else {
                if (!existingSummariesMap[cleanNis]) existingSummariesMap[cleanNis] = {};
                existingSummariesMap[cleanNis].nilai_rapor = scoreVal;
                matchCount++;
            }
        } else {
            const inputs = row.querySelectorAll('.score-input');
            const targetInp = Array.from(inputs).find(i => i.dataset.colKey === targetCol);
            if (!targetInp) return;

            const curVal = targetInp.value.trim();
            if (curVal !== '' && !isOverwrite) return;

            targetInp.value = scoreVal;
            window.onScoreInputChange(targetInp);
            matchCount++;
        }
    });

    window.closeImportLmsModal();

    if (matchCount > 0) {
        if (typeof setGradebookDirty === 'function') {
            setGradebookDirty(true);
        }
        const targetLabel = selectTargetCol?.selectedOptions?.[0]?.textContent || targetCol;
        showToast('Impor Berhasil', `${matchCount} nilai siswa dari kuis LMS berhasil diterapkan ke kolom ${targetLabel}.`, 'success');
    } else {
        showToast('Peringatan', 'Tidak ada nilai siswa yang diterapkan. Periksa kembali kondisi kuis dan opsi penimpaan.', 'warning');
    }
};

window.exportCurrentLmsQuizToGradebook = function () {
    const mat = currentLmsProgressMaterial;
    if (!mat) {
        showToast('Peringatan', 'Materi kuis LMS tidak ditemukan.', 'warning');
        return;
    }
    window.closeLmsProgressModal();
    window.switchGuruMapelTab('penilaian');
    window.openImportLmsModal(mat.id);
};

// =========================================================================
// Helper Query Data Jurnal untuk Export Excel Hemat Reads (dengan Local Cache)
async function fetchJurnalDocsForExport(mapel, kelas, semester, tahunAjaran) {
    const mapelCandidates = getMapelNameCandidates(mapel);
    const cacheJurnalKey = `cache_jurnal_${tahunAjaran.replace(/\//g, '-')}_S${semester}_${kelas.replace(/\s+/g, '_')}_${mapel.replace(/\s+/g, '_')}`;
    let docsArray = getLocalCache(cacheJurnalKey, 10 * 60 * 1000);
    if (docsArray && Array.isArray(docsArray)) {
        return docsArray.filter(d => isMapelMatching(d.mapel, mapelCandidates));
    }

    const parts = tahunAjaran.split("/");
    const year1 = parseInt(parts[0]) || new Date().getFullYear();
    const year2 = parseInt(parts[1]) || year1 + 1;

    let startDate, endDate;
    if (semester === "1") {
        startDate = new Date(year1, 6, 1);
        endDate = new Date(year1, 11, 31, 23, 59, 59);
    } else {
        startDate = new Date(year2, 0, 1);
        endDate = new Date(year2, 5, 30, 23, 59, 59);
    }

    try {
        if (cfClient && cfClient.enabled) {
            const startStr = window.getLocalISODate ? window.getLocalISODate(startDate) : startDate.toISOString().split('T')[0];
            const endStr = window.getLocalISODate ? window.getLocalISODate(endDate) : endDate.toISOString().split('T')[0];
            const res = await cfClient.getJurnalKbm({
                kelas: kelas,
                startDate: startStr,
                endDate: endStr,
                limit: 1000
            });
            docsArray = (res || [])
                .filter(d => isMapelMatching(d.mapel, mapelCandidates))
                .map(d => {
                    const timestampMs = d.tanggal ? new Date(d.tanggal).getTime() : (d.created_at ? new Date(d.created_at).getTime() : Date.now());
                    let presensiDetail = d.presensi_detail;
                    if (typeof presensiDetail === 'string') {
                        try { presensiDetail = JSON.parse(presensiDetail); } catch (e) {}
                    }
                    return {
                        ...d,
                        timestampMs,
                        presensi_detail: presensiDetail || []
                    };
                });
        } else {
            docsArray = [];
        }
        setLocalCache(cacheJurnalKey, docsArray, 10 * 60 * 1000);
        return docsArray;
    } catch (e) {
        console.warn('[Export Excel] Gagal mengambil data Jurnal:', e);
        return [];
    }
}

// =========================================================================
// 12. EXPORT TO EXCEL (.XLSX) - HIGH PRECISION 3-SHEET EXPORTER
// =========================================================================
window.exportToExcel = async function () {
    const mapel = document.getElementById('select-mapel').value;
    const kelas = document.getElementById('select-kelas').value;
    const semester = document.getElementById('select-semester').value;

    if (!mapel || !kelas || loadedStudents.length === 0) {
        showToast('Peringatan', 'Silakan pilih Kelas & Mapel lalu klik Load Data terlebih dahulu!', 'warning');
        return;
    }

    if (typeof XLSX === 'undefined') {
        showToast('Library Belum Siap', 'Pustaka SheetJS XLSX belum selesai dimuat.', 'error');
        return;
    }

    let teacherName = document.getElementById('header-guru-name')?.textContent?.trim();
    let teacherNip = '';
    const assigned = await resolveAssignedTeacherForClassAndMapel(kelas, mapel);
    if (!teacherName || teacherName === 'Guru Mapel' || teacherName === 'Guru Mata Pelajaran' || teacherName === 'Loading...') {
        teacherName = assigned?.name || (await getTeacherRealName(currentUser || auth.currentUser));
    }
    if (assigned?.nip) {
        teacherNip = assigned.nip;
    }
    if (!teacherNip || !/\d{4,}/.test(teacherNip)) {
        teacherNip = currentUserNip;
        if (!teacherNip || !/\d{4,}/.test(teacherNip)) {
            teacherNip = await resolveTeacherNipFromGtk(currentUser, currentUserDocData, teacherName);
            if (teacherNip) currentUserNip = teacherNip;
        }
    }
    const tahunAjaran = raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString();
    const faseDisplay = typeof getFaseFromClass === 'function' ? getFaseFromClass(kelas) : 'F';
    const semesterDisplay = semester === '1' ? '1 (satu)' : semester === '2' ? '2 (dua)' : semester;

    const workbook = XLSX.utils.book_new();

    // =========================================================================
    // SHEET 1: PENILAIAN SISWA
    // =========================================================================
    const identityPenilaian = [
        ['DAFTAR NILAI PESERTA DIDIK'],
        [],
        ['Mata Pelajaran', ':', mapel],
        ['Fase / Kelas', ':', `${faseDisplay} / ${kelas}`],
        ['Semester', ':', semesterDisplay],
        ['Th. Pelajaran', ':', tahunAjaran],
        ['Batas KKM', ':', kkmValue],
        ['Guru Pengampu', ':', teacherName],
        ['Tanggal Cetak', ':', new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })],
        [] // Baris kosong pemisah
    ];

    const isPerhotelan = isPerhotelanMapel(mapel);
    const mergesPenilaian = [];
    const headerRowIndex = identityPenilaian.length; // 0-based row index for table header row 1

    const thRow1 = ['NO', 'NISN / NIS', 'NAMA PESERTA DIDIK'];
    const thRow2 = ['', '', ''];

    // Vertical merge for NO, NISN / NIS, NAMA PESERTA DIDIK
    mergesPenilaian.push({ s: { r: headerRowIndex, c: 0 }, e: { r: headerRowIndex + 1, c: 0 } });
    mergesPenilaian.push({ s: { r: headerRowIndex, c: 1 }, e: { r: headerRowIndex + 1, c: 1 } });
    mergesPenilaian.push({ s: { r: headerRowIndex, c: 2 }, e: { r: headerRowIndex + 1, c: 2 } });

    // Separate activeColumns into groups
    const tugasCols = activeColumns.filter(c => c.type === 'tugas');
    const sumatifCols = activeColumns.filter(c => c.type === 'sumatif');
    const sasCols = activeColumns.filter(c => c.type === 'sas' || c.type === 'sat');
    const otherCols = activeColumns.filter(c => c.type !== 'tugas' && c.type !== 'sumatif' && c.type !== 'sas' && c.type !== 'sat');

    // Ordered columns array to drive data row cells
    const orderedPenilaianCols = [...tugasCols, ...sumatifCols, ...sasCols, ...otherCols];

    // Tugas / Formatif Group
    if (tugasCols.length > 0) {
        const colStart = thRow1.length;
        const colEnd = colStart + tugasCols.length - 1;
        thRow1.push('TUGAS / FORMATIF');
        for (let i = 1; i < tugasCols.length; i++) thRow1.push('');
        tugasCols.forEach(c => thRow2.push(c.label.toUpperCase()));
        if (tugasCols.length > 1) {
            mergesPenilaian.push({ s: { r: headerRowIndex, c: colStart }, e: { r: headerRowIndex, c: colEnd } });
        }
    }

    // Sumatif Lingkup Materi Group
    if (sumatifCols.length > 0) {
        const colStart = thRow1.length;
        const colEnd = colStart + sumatifCols.length - 1;
        thRow1.push('SUMATIF LINGKUP MATERI');
        for (let i = 1; i < sumatifCols.length; i++) thRow1.push('');
        sumatifCols.forEach(c => thRow2.push(c.label.toUpperCase()));
        if (sumatifCols.length > 1) {
            mergesPenilaian.push({ s: { r: headerRowIndex, c: colStart }, e: { r: headerRowIndex, c: colEnd } });
        }
    }

    // SAS / SAT Group
    if (sasCols.length > 0) {
        sasCols.forEach(c => {
            const colIdx = thRow1.length;
            thRow1.push(c.label.toUpperCase());
            thRow2.push(c.label.toUpperCase());
            mergesPenilaian.push({ s: { r: headerRowIndex, c: colIdx }, e: { r: headerRowIndex + 1, c: colIdx } });
        });
    }

    // Other cols (if any)
    if (otherCols.length > 0) {
        otherCols.forEach(c => {
            const colIdx = thRow1.length;
            thRow1.push(c.label.toUpperCase());
            thRow2.push(c.label.toUpperCase());
            mergesPenilaian.push({ s: { r: headerRowIndex, c: colIdx }, e: { r: headerRowIndex + 1, c: colIdx } });
        });
    }

    // Rata-rata Group (RATA TUGAS & RATA SUMATIF)
    const rataStartCol = thRow1.length;
    thRow1.push('RATA-RATA', '');
    thRow2.push('RATA TUGAS', 'RATA SUMATIF');
    mergesPenilaian.push({ s: { r: headerRowIndex, c: rataStartCol }, e: { r: headerRowIndex, c: rataStartCol + 1 } });

    // Nilai Akhir (NA)
    const naColIdx = thRow1.length;
    thRow1.push('NILAI AKHIR');
    thRow2.push('NA');
    mergesPenilaian.push({ s: { r: headerRowIndex, c: naColIdx }, e: { r: headerRowIndex + 1, c: naColIdx } });

    // Nilai Rapor (khusus Perhotelan)
    if (isPerhotelan) {
        const nrColIdx = thRow1.length;
        thRow1.push('NILAI RAPOR');
        thRow2.push('NILAI RAPOR');
        mergesPenilaian.push({ s: { r: headerRowIndex, c: nrColIdx }, e: { r: headerRowIndex + 1, c: nrColIdx } });
    }

    // Deskripsi CP
    const cpColIdx = thRow1.length;
    thRow1.push('DESKRIPSI CP');
    thRow2.push('DESKRIPSI CP');
    mergesPenilaian.push({ s: { r: headerRowIndex, c: cpColIdx }, e: { r: headerRowIndex + 1, c: cpColIdx } });

    const rowsPenilaianData = [...identityPenilaian, thRow1, thRow2];
    const classCpDesc = document.getElementById('input-class-cp-desc')?.value.trim() || '';

    // Penampung rekapan data per siswa agar mudah dihitung statistiknya secara akurat
    const studentRecordsForExport = [];

    loadedStudents.forEach((student, idx) => {
        const row = document.querySelector(`#gradebook-tbody tr[data-nis="${student.nis}"]`);
        const existingStudentScores = existingScoresMap[student.nis] || {};
        const existingSummary = existingSummariesMap[student.nis] || {};

        const nisnDisplay = student.nisn ? String(student.nisn).trim() : '';
        const nisDisplay = student.nis ? String(student.nis).trim() : '';
        let combinedNis = '-';
        if (nisnDisplay && nisDisplay) {
            combinedNis = `${nisnDisplay} / ${nisDisplay}`;
        } else if (nisDisplay) {
            combinedNis = nisDisplay;
        } else if (nisnDisplay) {
            combinedNis = nisnDisplay;
        }

        const rowData = [
            idx + 1,
            combinedNis,
            student.name
        ];

        const colScores = {};

        // Membaca Nilai Komponen (DOM Input / Cache)
        orderedPenilaianCols.forEach(col => {
            let val = '';
            if (row) {
                const inp = row.querySelector(`input[data-col-key="${col.key}"]`);
                if (inp && inp.value.trim() !== '') {
                    val = parseFloat(inp.value.trim());
                }
            }
            if (val === '' && existingStudentScores[col.key] !== undefined && existingStudentScores[col.key] !== null) {
                val = Number(existingStudentScores[col.key]);
            }
            const numVal = (typeof val === 'number' && !isNaN(val)) ? val : '';
            colScores[col.key] = numVal;
            rowData.push(numVal);
        });

        // Membaca Rata-rata & NA
        let cellTugas = '';
        let cellSumatif = '';
        let cellFinal = '';

        if (row) {
            const tText = row.querySelector('.cell-tugas-avg')?.textContent.trim();
            const sText = row.querySelector('.cell-sumatif-avg')?.textContent.trim();
            const fText = row.querySelector('.cell-final-score')?.textContent.trim();
            if (tText && tText !== '-') cellTugas = parseFloat(tText);
            if (sText && sText !== '-') cellSumatif = parseFloat(sText);
            if (fText && fText !== '-') cellFinal = Math.round(parseFloat(fText));
        }

        if (cellTugas === '' && existingSummary.tugas_avg !== undefined) cellTugas = Number(existingSummary.tugas_avg);
        if (cellSumatif === '' && existingSummary.sumatif_avg !== undefined) cellSumatif = Number(existingSummary.sumatif_avg);
        if (cellFinal === '' && existingSummary.final_score !== undefined) cellFinal = Math.round(Number(existingSummary.final_score));

        let cellNilaiRapor = '';
        let studentCp = '';

        if (isPerhotelan) {
            if (row) {
                const nrInp = row.querySelector('.perhotelan-nilai-rapor');
                if (nrInp && nrInp.value.trim() !== '') {
                    cellNilaiRapor = parseFloat(nrInp.value.trim());
                }
            }
            if (cellNilaiRapor === '' && existingSummary.nilai_rapor !== undefined && existingSummary.nilai_rapor !== null) {
                cellNilaiRapor = Number(existingSummary.nilai_rapor);
            }
            if (cellNilaiRapor === '' && existingSummary.final_score !== undefined && existingSummary.final_score !== null) {
                cellNilaiRapor = Math.round(Number(existingSummary.final_score));
            }
            if (cellNilaiRapor === '' && cellFinal !== '') {
                cellNilaiRapor = cellFinal;
            }

            if (row) {
                const cpInp = row.querySelector('.perhotelan-deskripsi-cp');
                if (cpInp && cpInp.value !== undefined) {
                    studentCp = cpInp.value.trim();
                }
            }
            if (!studentCp && existingSummary.deskripsi_cp) {
                studentCp = existingSummary.deskripsi_cp.trim();
            }

            rowData.push(
                typeof cellTugas === 'number' && !isNaN(cellTugas) ? cellTugas : '',
                typeof cellSumatif === 'number' && !isNaN(cellSumatif) ? cellSumatif : '',
                typeof cellFinal === 'number' && !isNaN(cellFinal) ? cellFinal : '',
                typeof cellNilaiRapor === 'number' && !isNaN(cellNilaiRapor) ? cellNilaiRapor : '',
                studentCp
            );
        } else {
            rowData.push(
                typeof cellTugas === 'number' && !isNaN(cellTugas) ? cellTugas : '',
                typeof cellSumatif === 'number' && !isNaN(cellSumatif) ? cellSumatif : '',
                typeof cellFinal === 'number' && !isNaN(cellFinal) ? cellFinal : '',
                classCpDesc
            );
        }

        studentRecordsForExport.push({
            student,
            colScores,
            cellTugas: typeof cellTugas === 'number' && !isNaN(cellTugas) ? cellTugas : '',
            cellSumatif: typeof cellSumatif === 'number' && !isNaN(cellSumatif) ? cellSumatif : '',
            cellFinal: typeof cellFinal === 'number' && !isNaN(cellFinal) ? cellFinal : '',
            cellNilaiRapor: typeof cellNilaiRapor === 'number' && !isNaN(cellNilaiRapor) ? cellNilaiRapor : '',
            deskripsiCp: isPerhotelan ? studentCp : classCpDesc
        });

        rowsPenilaianData.push(rowData);
    });

    // =========================================================================
    // BARIS REKAPITULASI STATISTIK PER KOMPONEN PADA SHEET 1
    // =========================================================================
    function calcExportColStats(values, kkm) {
        const nums = values.filter(v => typeof v === 'number' && !isNaN(v));
        const count = nums.length;
        if (count === 0) {
            return { count: 0, avg: '-', max: '-', min: '-', pass: 0, remidial: 0, pctPass: 0 };
        }
        const sum = nums.reduce((acc, curr) => acc + curr, 0);
        const avg = parseFloat((sum / count).toFixed(1));
        const max = Math.max(...nums);
        const min = Math.min(...nums);
        const pass = nums.filter(v => v >= kkm).length;
        const remidial = nums.filter(v => v < kkm).length;
        const pctPass = Math.round((pass / count) * 100);
        return { count, avg, max, min, pass, remidial, pctPass };
    }
    window.calcExportColStats = calcExportColStats;

    const colsToStat = [];
    orderedPenilaianCols.forEach(c => {
        colsToStat.push({
            key: c.key,
            label: c.label,
            getter: r => r.colScores[c.key]
        });
    });
    colsToStat.push({ key: 'tugas_avg', label: 'RATA TUGAS', getter: r => r.cellTugas });
    colsToStat.push({ key: 'sumatif_avg', label: 'RATA SUMATIF', getter: r => r.cellSumatif });
    colsToStat.push({ key: 'final_score', label: 'NA', getter: r => r.cellFinal });
    if (isPerhotelan) {
        colsToStat.push({ key: 'nilai_rapor', label: 'NILAI RAPOR', getter: r => r.cellNilaiRapor });
    }

    const statsPerCol = colsToStat.map(colDef => {
        const values = studentRecordsForExport.map(colDef.getter);
        return calcExportColStats(values, kkmValue);
    });

    // Baris Pemisah & Rekapitulasi Statistik per Komponen di Sheet 1
    rowsPenilaianData.push([]); // Baris kosong pemisah
    const startStatsRowIndex = rowsPenilaianData.length;

    const rowAvg = ['', '', 'RATA-RATA KELAS'];
    const rowMax = ['', '', 'NILAI TERTINGGI (MAX)'];
    const rowMin = ['', '', 'NILAI TERENDAH (MIN)'];
    const rowPass = ['', '', `JUMLAH TUNTAS (≥${kkmValue})`];
    const rowRemidial = ['', '', `JUMLAH REMIDIAL (<${kkmValue})`];

    statsPerCol.forEach(st => {
        rowAvg.push(st.avg !== '-' ? st.avg : '');
        rowMax.push(st.max !== '-' ? st.max : '');
        rowMin.push(st.min !== '-' ? st.min : '');
        rowPass.push(st.count > 0 ? st.pass : '');
        rowRemidial.push(st.count > 0 ? st.remidial : '');
    });

    // Kolom DESKRIPSI CP (baris statistik kosong)
    rowAvg.push('');
    rowMax.push('');
    rowMin.push('');
    rowPass.push('');
    rowRemidial.push('');

    rowsPenilaianData.push(rowAvg, rowMax, rowMin, rowPass, rowRemidial);

    // Penggabungan Sel (Merges) Baris Statistik Sheet 1 (Kolom 0..2: NO s.d. NAMA)
    for (let r = startStatsRowIndex; r < startStatsRowIndex + 5; r++) {
        mergesPenilaian.push({
            s: { r, c: 0 },
            e: { r, c: 2 }
        });
    }

    // Footer Tanda Tangan Sheet 1 (Resmi Kedinasan)
    rowsPenilaianData.push([]);
    rowsPenilaianData.push([]);
    const tglCetakText = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const schoolCity = SCHOOL_CONFIG.schoolCity || 'Denpasar';
    const totalColsPenilaian = thRow1.length;
    const signLeftCol = 1;
    const signRightCol = Math.max(totalColsPenilaian - 3, 4);

    const signRow1 = Array(totalColsPenilaian).fill('');
    signRow1[signLeftCol] = 'Mengetahui,';
    signRow1[signRightCol] = `${schoolCity}, ${tglCetakText}`;

    const signRow2 = Array(totalColsPenilaian).fill('');
    signRow2[signLeftCol] = SCHOOL_CONFIG.headmasterTitle || "Kepala SMA Negeri Nusantara";
    signRow2[signRightCol] = 'Guru Mata Pelajaran,';

    const signRow3 = Array(totalColsPenilaian).fill('');
    const signRow4 = Array(totalColsPenilaian).fill('');
    const signRow5 = Array(totalColsPenilaian).fill('');

    const signRow6 = Array(totalColsPenilaian).fill('');
    signRow6[signLeftCol] = SCHOOL_CONFIG.headmasterName || "Dr. I Wayan Sudarsana, M.Pd.";
    signRow6[signRightCol] = teacherName;

    const signRow7 = Array(totalColsPenilaian).fill('');
    signRow7[signLeftCol] = `NIP. ${SCHOOL_CONFIG.headmasterNIP || "197501012000031001"}`;
    signRow7[signRightCol] = (teacherNip && teacherNip !== '-') ? `NIP. ${teacherNip}` : 'NIP. -';

    rowsPenilaianData.push(signRow1, signRow2, signRow3, signRow4, signRow5, signRow6, signRow7);

    const wsPenilaian = XLSX.utils.aoa_to_sheet(rowsPenilaianData);
    wsPenilaian['!merges'] = mergesPenilaian;

    // Pengaturan Lebar Kolom (Column Widths) Sheet 1
    const colsPenilaian = [
        { wch: 6 },  // NO
        { wch: 24 }, // NISN / NIS
        { wch: 34 }, // NAMA PESERTA DIDIK
    ];
    orderedPenilaianCols.forEach(() => colsPenilaian.push({ wch: 12 }));
    colsPenilaian.push({ wch: 14 }); // RATA TUGAS
    colsPenilaian.push({ wch: 14 }); // RATA SUMATIF
    colsPenilaian.push({ wch: 10 }); // NA
    if (isPerhotelan) {
        colsPenilaian.push({ wch: 14 }); // NILAI RAPOR
    }
    colsPenilaian.push({ wch: 60 }); // DESKRIPSI CP
    wsPenilaian['!cols'] = colsPenilaian;

    XLSX.utils.book_append_sheet(workbook, wsPenilaian, 'Penilaian Siswa');

    // =========================================================================
    // SHEET 2: KEHADIRAN SISWA (PRESENSI SISWA DALAM KBM)
    // =========================================================================
    const identityKehadiran = [
        ['PRESENSI SISWA DALAM KBM'],
        [],
        ['KELAS / FASE', ':', `${kelas} / ${faseDisplay}`, '', '', '', '', '', '', '', '', '', '', 'SEMESTER', ':', semesterDisplay],
        ['MATA PELAJARAN', ':', mapel, '', '', '', '', '', '', '', '', '', '', 'TAHUN PELAJARAN', ':', tahunAjaran],
        []
    ];

    const docsArray = await fetchJurnalDocsForExport(mapel, kelas, semester, tahunAjaran);

    const pertemuanMap = {};
    docsArray.forEach((data) => {
        const tgl = getJurnalDateStr(data) || (data.timestampMs ? (typeof window.getLocalISODate === 'function' ? window.getLocalISODate(new Date(data.timestampMs)) : new Date(data.timestampMs).toISOString().split('T')[0]) : '');
        if (!tgl) return;
        const jpStr = formatJpDisplay(data.jp);
        const key = `${tgl}_JP${jpStr}`;
        const attendanceEntries = extractJournalAttendanceGuru(data);
        if (!pertemuanMap[key]) {
            pertemuanMap[key] = {
                tgl,
                jp: jpStr,
                presensi: {},
                presensiByNis: {},
                presensiNormalized: {}
            };
        }
        if (attendanceEntries.length > 0) {
            attendanceEntries.forEach((item) => {
                const st = item.status || "H";
                const nm = item.nama || "-";
                const nis = String(item.nis || '').trim();
                pertemuanMap[key].presensi[nm] = st;
                const normNm = String(nm).trim().replace(/\s+/g, ' ').toLowerCase();
                if (normNm) pertemuanMap[key].presensiNormalized[normNm] = st;
                if (nis) pertemuanMap[key].presensiByNis[nis] = st;
            });
        }
    });

    const pertemuanKeys = Object.keys(pertemuanMap).sort();

    const allNamesFromJurnal = new Set();
    pertemuanKeys.forEach(k => {
        Object.keys(pertemuanMap[k].presensi).forEach(n => allNamesFromJurnal.add(n));
    });

    const rowsKehadiran = [];
    const matchedNames = new Set();
    loadedStudents.forEach(s => {
        const jName = findMatchingNameGuru(s.name, allNamesFromJurnal);
        if (jName) matchedNames.add(jName);
        rowsKehadiran.push({ nis: s.nis, nisn: s.nisn || '', name: s.name, jurnalName: jName || s.name });
    });
    allNamesFromJurnal.forEach(n => {
        if (!matchedNames.has(n)) {
            rowsKehadiran.push({ nis: '-', nisn: '', name: n, jurnalName: n });
        }
    });

    const rekapData = rowsKehadiran.map(row => {
        const totals = { H: 0, S: 0, I: 0, A: 0, D: 0, T: 0 };
        const pertemuan = [];
        pertemuanKeys.forEach(k => {
            const st = findJournalStatusGuru(pertemuanMap[k], row);
            let finalSt = (st !== undefined && st !== "") ? st : "H";
            if (totals[finalSt] !== undefined) totals[finalSt]++;
            pertemuan.push(finalSt);
        });
        return { nis: row.nis, nisn: row.nisn, name: row.name, pertemuan, totals };
    });

    // Baris 1 & 2 Header Rekap Kehadiran
    const startRowIndexIndex = identityKehadiran.length; // Row index 0-based
    const meetingCount = Math.max(pertemuanKeys.length, 1);
    const mergesKehadiran = [
        { s: { r: startRowIndexIndex, c: 0 }, e: { r: startRowIndexIndex + 1, c: 0 } }, // NO
        { s: { r: startRowIndexIndex, c: 1 }, e: { r: startRowIndexIndex + 1, c: 1 } }, // NISN / NIS
        { s: { r: startRowIndexIndex, c: 2 }, e: { r: startRowIndexIndex + 1, c: 2 } }, // NAMA PESERTA DIDIK
    ];

    const headerKehadiranRow1 = ['NO', 'NISN / NIS', 'NAMA PESERTA DIDIK'];
    headerKehadiranRow1.push('TANGGAL KEGIATAN PEMBELAJARAN/PERTEMUAN KE -');
    for (let i = 1; i < meetingCount; i++) {
        headerKehadiranRow1.push('');
    }
    mergesKehadiran.push({
        s: { r: startRowIndexIndex, c: 3 },
        e: { r: startRowIndexIndex, c: 3 + meetingCount - 1 }
    });

    const rekapStartCol = 3 + meetingCount;
    headerKehadiranRow1.push('RINCIAN KETIDAKHADIRAN', '', '', '', '', '');
    mergesKehadiran.push({
        s: { r: startRowIndexIndex, c: rekapStartCol },
        e: { r: startRowIndexIndex, c: rekapStartCol + 5 }
    });

    const headerKehadiranRow2 = ['', '', ''];
    if (pertemuanKeys.length > 0) {
        pertemuanKeys.forEach((_, i) => {
            headerKehadiranRow2.push(String(i + 1));
        });
    } else {
        headerKehadiranRow2.push('1');
    }
    headerKehadiranRow2.push('S', 'I', 'A', 'D', 'T', 'JML');

    const rowsKehadiranSheet = [...identityKehadiran, headerKehadiranRow1, headerKehadiranRow2];

    rekapData.forEach((r, idx) => {
        const nisnDisplay = r.nisn && r.nisn !== '-' ? String(r.nisn).trim() : '';
        const nisDisplay = r.nis && r.nis !== '-' ? String(r.nis).trim() : '';
        let combinedNis = '-';
        if (nisnDisplay && nisDisplay) {
            combinedNis = `${nisnDisplay} / ${nisDisplay}`;
        } else if (nisDisplay) {
            combinedNis = nisDisplay;
        } else if (nisnDisplay) {
            combinedNis = nisnDisplay;
        }

        const studentRow = [
            idx + 1,
            combinedNis,
            r.name
        ];
        if (pertemuanKeys.length > 0) {
            r.pertemuan.forEach(st => studentRow.push(st || 'H'));
        } else {
            studentRow.push('-');
        }
        const t = r.totals;
        const totalAbsen = (t.S || 0) + (t.I || 0) + (t.A || 0) + (t.D || 0);
        studentRow.push(t.S || 0, t.I || 0, t.A || 0, t.D || 0, t.T || 0, totalAbsen);
        rowsKehadiranSheet.push(studentRow);
    });

    // Footer Tanda Tangan Sheet 2 (Resmi Kedinasan)
    rowsKehadiranSheet.push([]);
    rowsKehadiranSheet.push([]);
    const totalColsKehadiran = headerKehadiranRow1.length;
    const signLeftColK = 1;
    const signRightColK = Math.max(rekapStartCol, 4);

    const signKRow1 = Array(totalColsKehadiran).fill('');
    signKRow1[signLeftColK] = 'Mengetahui,';
    signKRow1[signRightColK] = `${schoolCity}, ${tglCetakText}`;

    const signKRow2 = Array(totalColsKehadiran).fill('');
    signKRow2[signLeftColK] = SCHOOL_CONFIG.headmasterTitle || "Kepala SMA Negeri Nusantara";
    signKRow2[signRightColK] = 'Guru Mata Pelajaran,';

    const signKRow3 = Array(totalColsKehadiran).fill('');
    const signKRow4 = Array(totalColsKehadiran).fill('');
    const signKRow5 = Array(totalColsKehadiran).fill('');

    const signKRow6 = Array(totalColsKehadiran).fill('');
    signKRow6[signLeftColK] = SCHOOL_CONFIG.headmasterName || "Dr. I Wayan Sudarsana, M.Pd.";
    signKRow6[signRightColK] = teacherName;

    const signKRow7 = Array(totalColsKehadiran).fill('');
    signKRow7[signLeftColK] = `NIP. ${SCHOOL_CONFIG.headmasterNIP || "197501012000031001"}`;
    signKRow7[signRightColK] = (teacherNip && teacherNip !== '-') ? `NIP. ${teacherNip}` : 'NIP. -';

    rowsKehadiranSheet.push(signKRow1, signKRow2, signKRow3, signKRow4, signKRow5, signKRow6, signKRow7);

    const wsKehadiran = XLSX.utils.aoa_to_sheet(rowsKehadiranSheet);
    wsKehadiran['!merges'] = mergesKehadiran;

    // Lebar Kolom (Column Widths) Sheet 2
    const colsKehadiran = [
        { wch: 6 },  // NO
        { wch: 24 }, // NISN / NIS
        { wch: 34 }, // NAMA PESERTA DIDIK
    ];
    for (let i = 0; i < meetingCount; i++) colsKehadiran.push({ wch: 6 });
    colsKehadiran.push({ wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 8 });
    wsKehadiran['!cols'] = colsKehadiran;

    XLSX.utils.book_append_sheet(workbook, wsKehadiran, 'Kehadiran Siswa');

    // =========================================================================
    // SHEET 3: DAFTAR JURNAL MENGAJAR (STRUCTURED & DETAILED)
    // =========================================================================
    const identityJurnal = [
        [`${SCHOOL_CONFIG.schoolNameUpper} - ${SCHOOL_CONFIG.appBrand}`],
        ['DAFTAR JURNAL MENGAJAR GURU'],
        [],
        ['Mata Pelajaran', ':', mapel],
        ['Kelas / Rombel', ':', kelas],
        ['Semester', ':', `Semester ${semester}`],
        ['Tahun Ajaran', ':', tahunAjaran],
        ['Guru Pengampu', ':', teacherName],
        ['Tanggal Cetak', ':', new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })],
        []
    ];

    const headersJurnal = [
        'NO',
        'TANGGAL & WAKTU',
        'JAM KE (JP)',
        'GURU PENGAMPU',
        'MATA PELAJARAN',
        'KELAS',
        'TOPIK & MATERI MENGAJAR',
        'CATATAN GURU',
        'RINCIAN KETIDAKHADIRAN SISWA'
    ];

    const rowsJurnalSheet = [...identityJurnal, headersJurnal];

    const jurnalList = [];
    docsArray.forEach(data => {
        const d = data.timestampMs ? new Date(data.timestampMs) : new Date();
        const tanggalStr = d.toLocaleDateString("id-ID", {
            weekday: "short",
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });

        let jpStr = "-";
        if (data.jp) {
            if (Array.isArray(data.jp) && data.jp.length > 0) {
                const minJp = Math.min(...data.jp);
                const maxJp = Math.max(...data.jp);
                jpStr = minJp === maxJp ? `${minJp}` : `${minJp}-${maxJp}`;
            } else if (!Array.isArray(data.jp)) {
                jpStr = String(data.jp);
            }
        }

        const tdkHadirArray = [];
        if (data.presensi_detail && Array.isArray(data.presensi_detail)) {
            data.presensi_detail.forEach(item => {
                if (item.status !== "H" && item.status !== "") {
                    tdkHadirArray.push(`${item.nama || item.nis || '-'} (${item.status})`);
                }
            });
        } else if (data.presensi && typeof data.presensi === "object") {
            Object.entries(data.presensi).forEach(([nama, st]) => {
                if (st !== "H" && st !== "") {
                    tdkHadirArray.push(`${nama} (${st})`);
                }
            });
        }

        jurnalList.push({
            timestamp: d.getTime(),
            waktuStr: tanggalStr,
            kelas: data.kelas || kelas,
            mapel: data.mapel || mapel,
            guru: data.guru || teacherName,
            jp: jpStr,
            topik: data.topik || data.materi || "-",
            catatan: data.catatan || "-",
            absenText: tdkHadirArray.length > 0 ? tdkHadirArray.join('; ') : 'Hadir Semua'
        });
    });

    jurnalList.sort((a, b) => b.timestamp - a.timestamp);

    jurnalList.forEach((j, idx) => {
        rowsJurnalSheet.push([
            idx + 1,
            j.waktuStr,
            j.jp,
            j.guru,
            j.mapel,
            j.kelas,
            j.topik,
            j.catatan,
            j.absenText
        ]);
    });

    // Footer Tanda Tangan Sheet 3 (Resmi Kedinasan)
    rowsJurnalSheet.push([]);
    rowsJurnalSheet.push([]);
    const totalColsJurnal = headersJurnal.length;
    const signLeftColJ = 1;
    const signRightColJ = Math.max(totalColsJurnal - 3, 5);

    const signJRow1 = Array(totalColsJurnal).fill('');
    signJRow1[signLeftColJ] = 'Mengetahui,';
    signJRow1[signRightColJ] = `${schoolCity}, ${tglCetakText}`;

    const signJRow2 = Array(totalColsJurnal).fill('');
    signJRow2[signLeftColJ] = SCHOOL_CONFIG.headmasterTitle || "Kepala SMA Negeri Nusantara";
    signJRow2[signRightColJ] = 'Guru Mata Pelajaran,';

    const signJRow3 = Array(totalColsJurnal).fill('');
    const signJRow4 = Array(totalColsJurnal).fill('');
    const signJRow5 = Array(totalColsJurnal).fill('');

    const signJRow6 = Array(totalColsJurnal).fill('');
    signJRow6[signLeftColJ] = SCHOOL_CONFIG.headmasterName || "Dr. I Wayan Sudarsana, M.Pd.";
    signJRow6[signRightColJ] = teacherName;

    const signJRow7 = Array(totalColsJurnal).fill('');
    signJRow7[signLeftColJ] = `NIP. ${SCHOOL_CONFIG.headmasterNIP || "197501012000031001"}`;
    signJRow7[signRightColJ] = (teacherNip && teacherNip !== '-') ? `NIP. ${teacherNip}` : 'NIP. -';

    rowsJurnalSheet.push(signJRow1, signJRow2, signJRow3, signJRow4, signJRow5, signJRow6, signJRow7);

    const wsJurnal = XLSX.utils.aoa_to_sheet(rowsJurnalSheet);

    wsJurnal['!cols'] = [
        { wch: 6 },  // NO
        { wch: 24 }, // TANGGAL & WAKTU
        { wch: 12 }, // JP
        { wch: 28 }, // GURU
        { wch: 20 }, // MAPEL
        { wch: 14 }, // KELAS
        { wch: 42 }, // TOPIK & MATERI
        { wch: 30 }, // CATATAN
        { wch: 45 }  // KETIDAKHADIRAN
    ];

    XLSX.utils.book_append_sheet(workbook, wsJurnal, 'Jurnal Mengajar');

    // =========================================================================
    // SHEET 4: ANALISIS PENILAIAN & REKOMENDASI PEDAGOGIS KELAS
    // =========================================================================
    const identityAnalisis = [
        [`${SCHOOL_CONFIG.schoolNameUpper} - ${SCHOOL_CONFIG.appBrand}`],
        ['LAPORAN ANALISIS & EVALUASI PENILAIAN AKADEMIK KELAS'],
        [],
        ['Mata Pelajaran', ':', mapel],
        ['Kelas / Rombel', ':', kelas],
        ['Semester', ':', `Semester ${semester}`],
        ['Tahun Ajaran', ':', tahunAjaran],
        ['Batas KKM', ':', kkmValue],
        ['Guru Pengampu', ':', teacherName],
        ['Tanggal Cetak', ':', new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })],
        []
    ];

    // Perhitungan Metrik Keseluruhan Kelas untuk Sheet 4
    const totalSiswa = loadedStudents.length;
    const finalScoresList = studentRecordsForExport
        .map(r => ({ student: r.student, score: r.cellFinal }))
        .filter(item => typeof item.score === 'number' && !isNaN(item.score));

    let countFinal = finalScoresList.length;
    let totalFinalScore = finalScoresList.reduce((acc, curr) => acc + curr.score, 0);
    let avgFinalVal = countFinal > 0 ? parseFloat((totalFinalScore / countFinal).toFixed(1)) : 0;

    let highestScore = -1, highestStudentName = '-';
    let lowestScore = 999, lowestStudentName = '-';
    let passCount = 0;
    const belowKkmFinalStudents = [];

    finalScoresList.forEach(item => {
        if (item.score >= kkmValue) {
            passCount++;
        } else {
            belowKkmFinalStudents.push(`${item.student.name} (${Math.round(item.score)})`);
        }
        if (item.score > highestScore) {
            highestScore = item.score;
            highestStudentName = item.student.name;
        }
        if (item.score < lowestScore) {
            lowestScore = item.score;
            lowestStudentName = item.student.name;
        }
    });

    const pctTuntas = totalSiswa > 0 ? Math.round((passCount / totalSiswa) * 100) : 0;
    const totalRemidi = belowKkmFinalStudents.length;

    // Rata-rata Tugas & Sumatif Kelas
    const tugasScores = studentRecordsForExport.map(r => r.cellTugas).filter(v => typeof v === 'number' && !isNaN(v));
    const avgTugasVal = tugasScores.length > 0 ? parseFloat((tugasScores.reduce((a, b) => a + b, 0) / tugasScores.length).toFixed(1)) : 0;

    const sumatifScores = studentRecordsForExport.map(r => r.cellSumatif).filter(v => typeof v === 'number' && !isNaN(v));
    const avgSumatifVal = sumatifScores.length > 0 ? parseFloat((sumatifScores.reduce((a, b) => a + b, 0) / sumatifScores.length).toFixed(1)) : 0;

    // SAS / SAT scores
    const sasCol = activeColumns.find(c => c.type === 'sas' || c.type === 'sat');
    let avgSasVal = 0;
    if (sasCol) {
        const sasScores = studentRecordsForExport.map(r => r.colScores[sasCol.key]).filter(v => typeof v === 'number' && !isNaN(v));
        avgSasVal = sasScores.length > 0 ? parseFloat((sasScores.reduce((a, b) => a + b, 0) / sasScores.length).toFixed(1)) : 0;
    }

    // Detail Per Komponen Penilaian untuk Sheet 4
    const compAnalysisList = activeColumns.map(col => {
        const colScoresWithStudent = studentRecordsForExport.map(r => ({
            student: r.student,
            score: r.colScores[col.key]
        }));
        const validScores = colScoresWithStudent.filter(s => typeof s.score === 'number' && !isNaN(s.score));
        const count = validScores.length;
        let sum = 0, maxVal = -1, maxStudent = '-', minVal = 999, minStudent = '-', passCol = 0;

        validScores.forEach(s => {
            sum += s.score;
            if (s.score >= kkmValue) passCol++;
            if (s.score > maxVal) {
                maxVal = s.score;
                maxStudent = s.student.name;
            }
            if (s.score < minVal) {
                minVal = s.score;
                minStudent = s.student.name;
            }
        });

        const avg = count > 0 ? parseFloat((sum / count).toFixed(1)) : '-';
        const pctPass = count > 0 ? Math.round((passCol / count) * 100) : 0;
        const remidialCol = count - passCol;
        const emptyCount = totalSiswa - count;

        let category = 'Tugas Formatif';
        if (col.type === 'sumatif') category = 'Sumatif Materi';
        if (col.type === 'sas' || col.type === 'sat') category = semester === '1' ? 'Sumatif Akhir Semester (SAS)' : 'Sumatif Akhir Tahun (SAT)';

        return {
            key: col.key,
            label: col.label,
            category,
            count,
            avg,
            maxVal: maxVal >= 0 ? maxVal : '-',
            maxText: maxVal >= 0 ? `${maxVal} (${maxStudent})` : '-',
            minVal: minVal <= 100 ? minVal : '-',
            minText: minVal <= 100 ? `${minVal} (${minStudent})` : '-',
            pass: passCol,
            pctPass,
            remidial: remidialCol,
            emptyCount
        };
    });

    // Cari komponen terendah & tertinggi untuk rekomendasi pedagogis
    let lowestColLabel = null, lowestColAvg = 999;
    compAnalysisList.forEach(c => {
        if (c.count > 0 && typeof c.avg === 'number') {
            if (c.avg < lowestColAvg) {
                lowestColAvg = c.avg;
                lowestColLabel = c.label;
            }
        }
    });

    // Logika Narasi Pedagogis Guru
    let statusBadgeText = '';
    let statusHeaderText = '';
    let mainInsightText = '';
    let pedagogicalActionText = '';

    if (countFinal === 0) {
        statusBadgeText = 'BELUM ADA NILAI';
        statusHeaderText = 'Data penilaian belum diinput.';
        pedagogicalActionText = 'Silakan lakukan penginputan nilai untuk melihat evaluasi pedagogis.';
    } else {
        if (pctTuntas === 100) {
            if (avgSumatifVal >= 85) {
                statusBadgeText = 'PERFORMA KELAS EXCELLENT (100% TUNTAS)';
                statusHeaderText = `Luar biasa! Seluruh ${totalSiswa} siswa telah tuntas melampaui KKM (${kkmValue}) dengan capaian rata-rata kelas yang sangat memuaskan.`;
                mainInsightText = 'Rombel menunjukkan penguasaan materi yang tinggi dan merata di seluruh indikator pencapaian pembelajaran.';
                pedagogicalActionText = `Disarankan memberikan Materi Pengayaan / Proyek Tantangan HOTS bagi ${highestStudentName.split(' ')[0]} dan rekan-rekan untuk mengasah kepemimpinan akademis.`;
            } else {
                statusBadgeText = '100% TUNTAS KKM';
                statusHeaderText = `Seluruh ${totalSiswa} siswa telah memenuhi KKM (${kkmValue}).`;
                mainInsightText = `Ketuntasan sudah aman 100%, namun nilai rata-rata kelas masih dapat ditingkatkan dari ${Math.round(avgFinalVal)} ke tingkat optimal.`;
                pedagogicalActionText = 'Pembelajaran dapat dilanjutkan ke modul berikutnya dengan menyelipkan latihan penerapan konsep aplikatif secara rutin.';
            }
        } else if (pctTuntas >= 85) {
            statusBadgeText = `KETUNTASAN TINGGI (${pctTuntas}%)`;
            statusHeaderText = `Sebanyak ${passCount} dari ${totalSiswa} siswa (${pctTuntas}%) telah tuntas melampaui KKM (${kkmValue}).`;
            mainInsightText = `Hanya terdapat ${totalRemidi} siswa yang masih memerlukan pembimbingan remediasi parsial.`;
            pedagogicalActionText = `Terapkan program Tutor Sebaya (Peer Tutoring) dengan memberdayakan siswa bernilai tertinggi seperti ${highestStudentName.split(' ')[0]} untuk mendampingi ${totalRemidi} rekan yang belum tuntas.`;
        } else if (pctTuntas >= 60) {
            statusBadgeText = `PERLU REMEDIASI KELOMPOK (${pctTuntas}% TUNTAS)`;
            statusHeaderText = `Ketuntasan kelas berada pada tingkat menengah (${pctTuntas}%) dengan ${totalRemidi} siswa (${100 - pctTuntas}%) berada di bawah KKM (${kkmValue}).`;
            mainInsightText = 'Diperlukan pendampingan kelompok khusus sebelum kelas melangkah ke modul kompetensi selanjutnya.';
            pedagogicalActionText = `Disarankan membuka Klinik Belajar Remedial terfokus pada materi ${lowestColLabel || 'Komponen Terendah'} (Rata-rata: ${lowestColAvg <= 100 ? lowestColAvg : '-'}).`;
        } else if (pctTuntas >= 35) {
            statusBadgeText = `INTERVENSI PEMBELAJARAN REQUIRED (${pctTuntas}% TUNTAS)`;
            statusHeaderText = `Ketuntasan kelas masih di bawah standar harapan (baru ${pctTuntas}% tuntas, ${totalRemidi} siswa remidial).`;
            mainInsightText = 'Sebagian besar rombel mengalami hambatan dalam menyerap indikator kompetensi dasar.';
            pedagogicalActionText = 'Sangat direkomendasikan melakukan Pembelajaran Ulang (Re-teaching) Kelompok dengan penyederhanaan metode ajar sebelum mengadakan tes ulang.';
        } else {
            statusBadgeText = `KRITIS (HANYA ${pctTuntas}% TUNTAS)`;
            statusHeaderText = `Mayoritas siswa dalam rombel (${totalRemidi} dari ${totalSiswa} siswa) belum mencapai batas KKM (${kkmValue}).`;
            mainInsightText = 'Terdapat indikasi kendala serapan materi atau instrumen tes yang terlalu kompleks secara kolektif.';
            pedagogicalActionText = 'Diperlukan Evaluasi Instrumen Soal & Pembelajaran Ulang Total. Pertimbangkan untuk merevisi tingkat kesulitan instrumen serta mengadakan sesi pembahasan materi dasar bersama rombel.';
        }
    }

    // Disparitas Proses vs Ujian
    const diffTugasVsSumatif = (avgTugasVal > 0 && avgSumatifVal > 0) ? (avgTugasVal - avgSumatifVal) : 0;
    let processInsightClean = '';
    if (diffTugasVsSumatif >= 15) {
        processInsightClean = `Disparitas Proses vs Ujian: Rata-rata Tugas (${avgTugasVal}) jauh melampaui Rata Sumatif (${avgSumatifVal}). Siswa rajin tugas harian namun mengalami kendala saat ujian mandiri. Saran: Berikan latihan simulasi tes bertenggat waktu (time-bound quiz).`;
    } else if (diffTugasVsSumatif <= -12) {
        processInsightClean = `Potensi Tinggi, Kedisiplinan Tugas Perlu Ditingkatkan: Rata Sumatif (${avgSumatifVal}) lebih tinggi dibanding Tugas Harian (${avgTugasVal}). Siswa cepat paham saat tes namun kurang disiplin mengumpulkan tugas. Saran: Terapkan reminder tugas berkala.`;
    } else if (avgTugasVal > 0 && avgSumatifVal > 0) {
        processInsightClean = `Konsistensi Pembelajaran: Nilai Tugas (${avgTugasVal}) dan Nilai Sumatif (${avgSumatifVal}) berjalan selaras dan seimbang, menandakan proses belajar yang stabil.`;
    }

    // Gap Score
    const gapScore = (highestScore >= 0 && lowestScore <= 100) ? (highestScore - lowestScore) : 0;
    let gapInsightClean = '';
    if (gapScore >= 35) {
        gapInsightClean = `Kesenjangan Nilai Lebar (Rentang ${Math.round(gapScore)} poin): Selisih tinggi antara nilai tertinggi (${highestScore} - ${highestStudentName}) dan terendah (${lowestScore} - ${lowestStudentName}). Saran: Gunakan Pembelajaran Berdiferensiasi (Differentiated Instruction).`;
    } else if (gapScore > 0 && gapScore <= 15) {
        gapInsightClean = `Heterogenitas Terkontrol: Rentang nilai antarsiswa relatif homogen (${Math.round(gapScore)} poin), menunjukkan daya serap kelas merata.`;
    }

    // Titik Lemah Rombel
    let bottleneckInsightClean = '';
    if (lowestColLabel && lowestColAvg <= 100) {
        bottleneckInsightClean = `Pencapaian terendah rombel ada pada ${lowestColLabel} (Rata-rata: ${lowestColAvg}). Sesi penguatan/ulasan soal difokuskan pada materi indikator ini.`;
    }

    const rowsAnalisisData = [
        ...identityAnalisis,
        ['I. RANGKUMAN STATISTIK PENILAIAN KELAS'],
        ['NO', 'INDIKATOR STATISTIK', 'CAPAIAN NILAI', 'KETERANGAN EVALUASI'],
        [1, 'Total Siswa Terdata', `${totalSiswa} Siswa`, 'Jumlah peserta didik aktif dalam rombel'],
        [2, 'Kriteria Ketuntasan Minimal (KKM)', kkmValue, 'Batas acuan ketuntasan minimal mapel'],
        [3, 'Rata-Rata Nilai Tugas', avgTugasVal > 0 ? avgTugasVal : '-', 'Rata-rata penugasan formatif harian'],
        [4, 'Rata-Rata Nilai Sumatif', avgSumatifVal > 0 ? avgSumatifVal : '-', 'Rata-rata sumatif lingkup materi'],
        [5, semester === '1' ? 'Rata-Rata Nilai SAS' : 'Rata-Rata Nilai SAT', avgSasVal > 0 ? avgSasVal : '-', 'Evaluasi akhir semester'],
        [6, 'Rata-Rata Nilai Akhir (NA)', avgFinalVal > 0 ? avgFinalVal : '-', 'Rata-rata nilai akhir rapor rombel'],
        [7, 'Nilai Akhir Tertinggi (Max)', highestScore >= 0 ? highestScore : '-', highestStudentName !== '-' ? `Diraih oleh: ${highestStudentName}` : '-'],
        [8, 'Nilai Akhir Terendah (Min)', lowestScore <= 100 ? lowestScore : '-', lowestStudentName !== '-' ? `Perlu bimbingan: ${lowestStudentName}` : '-'],
        [9, 'Ketuntasan Belajar (≥ KKM)', `${passCount} Siswa`, `${pctTuntas}% siswa tuntas melampaui KKM`],
        [10, 'Siswa Remidial (< KKM)', `${totalRemidi} Siswa`, `${totalSiswa > 0 ? 100 - pctTuntas : 0}% siswa belum mencapai KKM`],
        [],
        ['II. ANALISIS DETAIL PER KOMPONEN PENILAIAN'],
        [
            'NO',
            'KOMPONEN PENILAIAN',
            'KATEGORI',
            'JUMLAH TERISI',
            'RATA-RATA',
            'NILAI TERTINGGI (MAX)',
            'NILAI TERENDAH (MIN)',
            `TUNTAS (≥${kkmValue})`,
            '% TUNTAS',
            `REMIDIAL (<${kkmValue})`,
            'NILAI KOSONG'
        ]
    ];

    compAnalysisList.forEach((c, cIdx) => {
        rowsAnalisisData.push([
            cIdx + 1,
            c.label,
            c.category,
            `${c.count} Siswa`,
            c.avg,
            c.maxText,
            c.minText,
            `${c.pass} Siswa`,
            `${c.pctPass}%`,
            `${c.remidial} Siswa`,
            `${c.emptyCount} Siswa`
        ]);
    });

    rowsAnalisisData.push(
        [],
        ['III. CATATAN & REKOMENDASI PEDAGOGIS GURU'],
        ['KATEGORI EVALUASI', '', 'RINCIAN ANALISIS & LANGKAH TINDAK LANJUT INSTRUSIONAL'],
        ['Status Capaian Rombel', '', `${statusBadgeText} - ${statusHeaderText} ${mainInsightText}`.trim()],
        ['Rekomendasi Langkah Guru', '', pedagogicalActionText]
    );

    if (processInsightClean) {
        rowsAnalisisData.push(['Disparitas Tugas vs Ujian', '', processInsightClean]);
    }
    if (gapInsightClean) {
        rowsAnalisisData.push(['Kesenjangan Nilai Rombel', '', gapInsightClean]);
    }
    if (bottleneckInsightClean) {
        rowsAnalisisData.push(['Komponen Titik Lemah', '', bottleneckInsightClean]);
    }

    rowsAnalisisData.push([
        'Daftar Siswa Perlu Remediasi',
        '',
        belowKkmFinalStudents.length > 0 ? belowKkmFinalStudents.join(', ') : 'Tidak ada (Seluruh siswa tuntas mencapai KKM)'
    ]);

    const wsAnalisis = XLSX.utils.aoa_to_sheet(rowsAnalisisData);

    wsAnalisis['!cols'] = [
        { wch: 6 },  // NO
        { wch: 30 }, // KOMPONEN / INDIKATOR
        { wch: 18 }, // KATEGORI
        { wch: 18 }, // JUMLAH TERISI / KETERANGAN
        { wch: 14 }, // RATA-RATA
        { wch: 30 }, // MAX
        { wch: 30 }, // MIN
        { wch: 16 }, // TUNTAS
        { wch: 14 }, // % TUNTAS
        { wch: 16 }, // REMIDIAL
        { wch: 16 }  // KOSONG
    ];

    XLSX.utils.book_append_sheet(workbook, wsAnalisis, 'Analisis Penilaian');

    // =========================================================================
    // EXPORT WORKBOOK FILE
    // =========================================================================
    const filename = `Rekap_Lengkap_${mapel.replace(/\s+/g, '_')}_${kelas.replace(/\s+/g, '_')}_S${semester}.xlsx`;
    XLSX.writeFile(workbook, filename);
    showToast('Export Excel Selesai', `File ${filename} (4 Sheet Rapi & Analisis Lengkap) berhasil diunduh.`, 'success');
};

// =========================================================================
// 12A-1. BUILDER EXCEL REKAP ABSEN KBM 5 SHEET SIAP CETAK A4 (EXCELJS ENGINE)
// =========================================================================
export async function buildRekapAbsenWorkbook(params = {}, ExcelJSLib = null) {
    const Lib = ExcelJSLib || (typeof window !== 'undefined' && window.ExcelJS ? window.ExcelJS : (typeof ExcelJS !== 'undefined' ? ExcelJS : null));
    if (!Lib) {
        throw new Error('Pustaka ExcelJS tidak ditemukan untuk merender rekap cetak A4.');
    }

    const {
        mapel = '',
        kelas = '',
        semester = '1',
        tahunAjaran = '2026/2027',
        faseDisplay = 'F',
        schoolCity = 'Denpasar',
        headmasterName = "Dr. I Wayan Sudarsana, M.Pd.",
        headmasterTitle = "Kepala SMA Negeri Nusantara",
        headmasterNIP = "197501012000031001",
        teacherName = 'Guru Mata Pelajaran',
        teacherNip = '-',
        tglCetakText = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
        students = [],
        meetings = []
    } = params;

    const semesterDisplay = semester === '1' ? '1 (satu)' : semester === '2' ? '2 (dua)' : semester;
    const wb = new Lib.Workbook();
    wb.creator = "SIMAS SMANTARA";
    wb.created = new Date();

    const THIN_BORDER = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
    };
    const HEADER_FILL = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9E2F3' }
    };

    function applyOfficialKopAndMeta(ws, sheetTitle, lastColLetter, midColIndex) {
        // 1. KOP SEKOLAH RESMI KEDINASAN (Baris 1 - 4)
        ws.mergeCells(`A1:${lastColLetter}1`);
        const c1 = ws.getCell('A1');
        c1.value = 'PEMERINTAH PROVINSI BALI';
        c1.font = { name: 'Calibri', size: 10, bold: true };
        c1.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(1).height = 14;

        ws.mergeCells(`A2:${lastColLetter}2`);
        const c2 = ws.getCell('A2');
        c2.value = 'DINAS PENDIDIKAN, KEPEMUDAAN DAN OLAHRAGA';
        c2.font = { name: 'Calibri', size: 10, bold: true };
        c2.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(2).height = 14;

        ws.mergeCells(`A3:${lastColLetter}3`);
        const c3 = ws.getCell('A3');
        c3.value = "SMA NEGERI NUSANTARA";
        c3.font = { name: 'Calibri', size: 13, bold: true };
        c3.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(3).height = 18;

        ws.mergeCells(`A4:${lastColLetter}4`);
        const c4 = ws.getCell('A4');
        c4.value = "Jl. Nusantara No. 1, Denpasar 80234 | Website: smanusantara.sch.id";
        c4.font = { name: 'Calibri', size: 8, italic: true };
        c4.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(4).height = 13;

        // Garis batas kop surat (border bottom tebal di baris 4)
        const lastColNum = ws.getColumn(lastColLetter).number;
        for (let col = 1; col <= lastColNum; col++) {
            const cell = ws.getCell(4, col);
            cell.border = {
                bottom: { style: 'medium', color: { argb: 'FF000000' } }
            };
        }

        ws.getRow(5).height = 6; // Spacing halus

        // 2. JUDUL DOKUMEN / SHEET (Baris 6)
        ws.mergeCells(`A6:${lastColLetter}6`);
        const c6 = ws.getCell('A6');
        c6.value = sheetTitle;
        c6.font = { name: 'Calibri', size: 12, bold: true };
        c6.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(6).height = 18;

        ws.getRow(7).height = 6; // Spacing

        // 3. DATA DI ATAS TABEL (METADATA KBM - RAPI, BERKOLOM & SEJAJAR)
        const mid = midColIndex || 16;

        // Baris 8
        ws.getCell('A8').value = 'Mata Pelajaran';
        ws.getCell('A8').font = { name: 'Calibri', size: 10, bold: true };
        ws.getCell('C8').value = `: ${mapel}`;
        ws.getCell('C8').font = { name: 'Calibri', size: 10 };

        ws.getCell(8, mid).value = 'Kelas / Fase';
        ws.getCell(8, mid).font = { name: 'Calibri', size: 10, bold: true };
        ws.getCell(8, mid + 2).value = `: ${kelas} / ${faseDisplay}`;
        ws.getCell(8, mid + 2).font = { name: 'Calibri', size: 10 };

        // Baris 9
        ws.getCell('A9').value = 'Tahun Pelajaran';
        ws.getCell('A9').font = { name: 'Calibri', size: 10, bold: true };
        ws.getCell('C9').value = `: ${tahunAjaran}`;
        ws.getCell('C9').font = { name: 'Calibri', size: 10 };

        ws.getCell(9, mid).value = 'Semester';
        ws.getCell(9, mid).font = { name: 'Calibri', size: 10, bold: true };
        ws.getCell(9, mid + 2).value = `: ${semesterDisplay}`;
        ws.getCell(9, mid + 2).font = { name: 'Calibri', size: 10 };

        // Baris 10
        ws.getCell('A10').value = 'Guru Pengampu';
        ws.getCell('A10').font = { name: 'Calibri', size: 10, bold: true };
        ws.getCell('C10').value = `: ${teacherName}`;
        ws.getCell('C10').font = { name: 'Calibri', size: 10 };

        [8, 9, 10].forEach(r => {
            ws.getRow(r).height = 15;
            ws.getCell(`A${r}`).alignment = { horizontal: 'left', vertical: 'middle' };
            ws.getCell(`C${r}`).alignment = { horizontal: 'left', vertical: 'middle' };
            ws.getCell(r, mid).alignment = { horizontal: 'left', vertical: 'middle' };
            ws.getCell(r, mid + 2).alignment = { horizontal: 'left', vertical: 'middle' };
        });

        ws.getRow(11).height = 8; // Spacing sebelum tabel (Baris 11 kosong)
    }

    function applyTandaTangan(ws, startRow, colKiri, colKanan) {
        ws.getCell(startRow, colKiri).value = 'Mengetahui,';
        ws.getCell(startRow, colKanan).value = `${schoolCity}, ${tglCetakText}`;

        ws.getCell(startRow + 1, colKiri).value = headmasterTitle;
        ws.getCell(startRow + 1, colKanan).value = 'Guru Mata Pelajaran,';

        ws.getCell(startRow + 5, colKiri).value = headmasterName;
        ws.getCell(startRow + 5, colKiri).font = { name: 'Calibri', size: 10, bold: true, underline: true };
        ws.getCell(startRow + 5, colKanan).value = teacherName;
        ws.getCell(startRow + 5, colKanan).font = { name: 'Calibri', size: 10, bold: true, underline: true };

        ws.getCell(startRow + 6, colKiri).value = `NIP. ${headmasterNIP}`;
        ws.getCell(startRow + 6, colKiri).font = { name: 'Calibri', size: 10 };
        ws.getCell(startRow + 6, colKanan).value = (teacherNip && teacherNip !== '-') ? `NIP. ${teacherNip}` : 'NIP. -';
        ws.getCell(startRow + 6, colKanan).font = { name: 'Calibri', size: 10 };

        for (let r = startRow; r <= startRow + 6; r++) {
            ws.getRow(r).height = 15;
            [colKiri, colKanan].forEach(c => {
                const cell = ws.getCell(r, c);
                if (!cell.font) cell.font = { name: 'Calibri', size: 10 };
                cell.alignment = { horizontal: 'left', vertical: 'middle' };
            });
        }
        return startRow + 6;
    }

    function colLetter(colIdx) {
        let temp = colIdx;
        let letter = '';
        while (temp > 0) {
            let mod = (temp - 1) % 26;
            letter = String.fromCharCode(65 + mod) + letter;
            temp = Math.floor((temp - mod) / 26);
        }
        return letter;
    }

    // --- SHEET 1: DATA (Landscape, 17 pertemuan + tanggal di header, ada TTD) ---
    const meetingCount = Math.max(meetings.length, 1);
    const totalColsData = 3 + meetingCount + 6 + 1;
    const lastColLetterData = colLetter(totalColsData);

    const wsData = wb.addWorksheet('Data', {
        pageSetup: {
            paperSize: 9,
            orientation: 'landscape',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            horizontalCentered: true,
            showGridLines: false,
            margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 },
            printTitlesRow: '12:14' // Header 3-tier berulang di halaman lanjutan
        },
        views: [{ showGridLines: false }],
        headerFooter: { oddFooter: "&L SMA Negeri Nusantara &C Halaman &P dari &N &R Dicetak: &D" }
    });

    applyOfficialKopAndMeta(wsData, 'PRESENSI SISWA DALAM KBM', lastColLetterData, 16);

    // 3-TIER HEADER TABEL DATA (Baris 12 - 14)
    wsData.mergeCells('A12:A14'); wsData.getCell('A12').value = 'NO';
    wsData.mergeCells('B12:B14'); wsData.getCell('B12').value = 'NISN / NIS';
    wsData.mergeCells('C12:C14'); wsData.getCell('C12').value = 'NAMA PESERTA DIDIK';

    const pStartCol = 4;
    const pEndCol = 3 + meetingCount;

    // Tier 1: Grup Pertemuan & Ketidakhadiran
    wsData.mergeCells(12, pStartCol, 12, pEndCol);
    wsData.getCell(12, pStartCol).value = 'TANGGAL KEGIATAN PEMBELAJARAN / PERTEMUAN KE -';

    const rStartCol = pEndCol + 1;
    wsData.mergeCells(12, rStartCol, 13, rStartCol + 5);
    wsData.getCell(12, rStartCol).value = 'RINCIAN KETIDAKHADIRAN';

    const hCol = rStartCol + 6;
    wsData.mergeCells(12, hCol, 14, hCol);
    wsData.getCell(12, hCol).value = 'H%';

    // Tier 2: Tanggal KBM per pertemuan (Baris 13)
    if (meetings.length > 0) {
        meetings.forEach((m, idx) => {
            const shortTgl = m.shortTgl || (m.tgl ? (m.tgl.length >= 10 ? `${m.tgl.split('-')[2]}/${m.tgl.split('-')[1]}` : m.tgl) : '-');
            wsData.getCell(13, pStartCol + idx).value = shortTgl;
        });
    } else {
        wsData.getCell(13, pStartCol).value = '-';
    }

    // Tier 3: Nomor Pertemuan (Baris 14)
    if (meetings.length > 0) {
        meetings.forEach((m, idx) => {
            wsData.getCell(14, pStartCol + idx).value = m.no || (idx + 1);
        });
    } else {
        wsData.getCell(14, pStartCol).value = '1';
    }

    ['S', 'I', 'A', 'D', 'T', 'JML'].forEach((lbl, idx) => {
        wsData.getCell(14, rStartCol + idx).value = lbl;
    });

    for (let r = 12; r <= 14; r++) {
        const row = wsData.getRow(r);
        row.height = r === 13 ? 24 : 18;
        for (let c = 1; c <= totalColsData; c++) {
            const cell = wsData.getCell(r, c);
            cell.font = { name: 'Calibri', size: (r === 13 && c >= pStartCol && c <= pEndCol) ? 9 : 10, bold: true };
            cell.fill = HEADER_FILL;
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = THIN_BORDER;
        }
    }

    students.forEach((s, idx) => {
        const rIdx = 15 + idx;
        const row = wsData.getRow(rIdx);
        const combinedNis = (s.nisn && s.nis && s.nisn !== '-' && s.nis !== '-') ? `${s.nisn} / ${s.nis}` : (s.nis || s.nisn || '-');
        const rowVals = [idx + 1, combinedNis, s.name];

        if (Array.isArray(s.pertemuan) && s.pertemuan.length > 0) {
            s.pertemuan.forEach(st => rowVals.push(st || 'H'));
        } else {
            for (let m = 0; m < meetingCount; m++) rowVals.push('H');
        }

        const t = s.totals || { H: meetingCount, S: 0, I: 0, A: 0, D: 0, T: 0 };
        const jmlAbsen = (t.S || 0) + (t.I || 0) + (t.A || 0) + (t.D || 0);
        const totalHadir = (t.H || 0) + (t.T || 0);
        const pctHadir = meetingCount > 0 ? Math.round((totalHadir / meetingCount) * 100) : 100;
        rowVals.push(t.S || 0, t.I || 0, t.A || 0, t.D || 0, t.T || 0, jmlAbsen, `${pctHadir}%`);

        row.values = rowVals;
        row.height = 15;
        row.eachCell((c, colNum) => {
            c.font = { name: 'Calibri', size: 10 };
            c.border = THIN_BORDER;
            c.alignment = { horizontal: colNum === 3 ? 'left' : 'center', vertical: 'middle' };
        });
    });

    const lastDataRowData = 14 + Math.max(students.length, 1);
    const startTtdData = lastDataRowData + 2;
    const lastRowData = applyTandaTangan(wsData, startTtdData, 2, rStartCol);
    wsData.pageSetup.printArea = `A1:${lastColLetterData}${lastRowData}`;

    wsData.getColumn(1).width = 4.5;
    wsData.getColumn(2).width = 17;
    wsData.getColumn(3).width = 28;
    for (let c = pStartCol; c <= pEndCol; c++) wsData.getColumn(c).width = 5.2;
    for (let c = rStartCol; c <= rStartCol + 5; c++) wsData.getColumn(c).width = 4.5;
    wsData.getColumn(hCol).width = 6.5;

    // --- SHEET 2: REKAP SISWA (Portrait, Muat Tepat 1 Halaman 34 Siswa + TTD) ---
    const wsRekap = wb.addWorksheet('Rekap Siswa', {
        pageSetup: {
            paperSize: 9,
            orientation: 'portrait',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 1, // Kunci 1 halaman penuh
            horizontalCentered: true,
            showGridLines: false,
            margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
            printTitlesRow: '12:12'
        },
        views: [{ showGridLines: false }],
        headerFooter: { oddFooter: "&L SMA Negeri Nusantara &C Halaman &P dari &N &R Dicetak: &D" }
    });

    applyOfficialKopAndMeta(wsRekap, 'REKAP KEHADIRAN SISWA PER KELAS', 'K', 7);

    const headersRekap = ['NO', 'NISN / NIS', 'NAMA PESERTA DIDIK', 'S', 'I', 'A', 'D', 'T', 'JML', '% HADIR', 'STATUS'];
    const hRowRekap = wsRekap.getRow(12);
    hRowRekap.values = headersRekap;
    hRowRekap.height = 18;
    hRowRekap.eachCell(c => {
        c.font = { name: 'Calibri', size: 9.5, bold: true };
        c.fill = HEADER_FILL;
        c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        c.border = THIN_BORDER;
    });

    students.forEach((s, idx) => {
        const rIdx = 13 + idx;
        const row = wsRekap.getRow(rIdx);
        const t = s.totals || { H: meetingCount, S: 0, I: 0, A: 0, D: 0, T: 0 };
        const jmlAbsen = (t.S || 0) + (t.I || 0) + (t.A || 0) + (t.D || 0);
        const totalHadir = (t.H || 0) + (t.T || 0);
        const pctHadir = meetingCount > 0 ? Math.round((totalHadir / meetingCount) * 100) : 100;
        const status = pctHadir >= 85 ? 'Tuntas' : 'Perlu Pembinaan';
        const combinedNis = (s.nisn && s.nis && s.nisn !== '-' && s.nis !== '-') ? `${s.nisn} / ${s.nis}` : (s.nis || s.nisn || '-');

        row.values = [idx + 1, combinedNis, s.name, t.S || 0, t.I || 0, t.A || 0, t.D || 0, t.T || 0, jmlAbsen, `${pctHadir}%`, status];
        row.height = 13.5; // Kompak agar 34 siswa + kop + ttd muat pas 1 halaman A4
        row.eachCell((c, colNum) => {
            c.font = { name: 'Calibri', size: 9 };
            c.border = THIN_BORDER;
            c.alignment = { horizontal: colNum === 3 ? 'left' : 'center', vertical: 'middle' };
        });
    });

    const startTtdRekap = 12 + Math.max(students.length, 1) + 2;
    const lastRowRekap = applyTandaTangan(wsRekap, startTtdRekap, 2, 8);
    wsRekap.pageSetup.printArea = `A1:K${lastRowRekap}`;

    const widthsRekap = [4.5, 17, 27, 4.5, 4.5, 4.5, 4.5, 4.5, 5, 8, 12];
    widthsRekap.forEach((w, idx) => wsRekap.getColumn(idx + 1).width = w);

    // --- SHEET 3: RINGKASAN (Portrait, 1 Halaman, tanpa TTD) ---
    const wsRingkasan = wb.addWorksheet('Ringkasan', {
        pageSetup: {
            paperSize: 9,
            orientation: 'portrait',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 1,
            horizontalCentered: true,
            showGridLines: false,
            margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 },
            printTitlesRow: '12:12'
        },
        views: [{ showGridLines: false }],
        headerFooter: { oddFooter: "&L SMA Negeri Nusantara &C Halaman &P dari &N &R Dicetak: &D" }
    });

    applyOfficialKopAndMeta(wsRingkasan, 'RINGKASAN KEHADIRAN KBM', 'D', 3);

    const hRowRingkasan = wsRingkasan.getRow(12);
    hRowRingkasan.values = ['NO', 'INDIKATOR / PARAMETER', 'JUMLAH / NILAI', 'PERSENTASE / KETERANGAN'];
    hRowRingkasan.height = 20;
    hRowRingkasan.eachCell(c => {
        c.font = { name: 'Calibri', size: 10, bold: true };
        c.fill = HEADER_FILL;
        c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        c.border = THIN_BORDER;
    });

    let totalS = 0, totalI = 0, totalA = 0, totalD = 0, totalT = 0, totalPctSum = 0;
    let perfectCount = 0, pembinaanCount = 0;

    students.forEach(s => {
        const t = s.totals || {};
        totalS += (t.S || 0);
        totalI += (t.I || 0);
        totalA += (t.A || 0);
        totalD += (t.D || 0);
        totalT += (t.T || 0);
        const hTotal = (t.H || 0) + (t.T || 0);
        const p = meetingCount > 0 ? Math.round((hTotal / meetingCount) * 100) : 100;
        totalPctSum += p;
        if (p === 100) perfectCount++;
        if (p < 85) pembinaanCount++;
    });

    const avgRate = students.length > 0 ? (totalPctSum / students.length).toFixed(1) : '100.0';

    const summaryData = [
        ['1', 'Total Siswa Terdaftar', `${students.length} Siswa`, '100% Peserta Rombel Aktif'],
        ['2', 'Total Pertemuan KBM Terlaksana', `${meetingCount} Pertemuan`, `Alokasi Semester ${semester} Lengkap`],
        ['3', 'Rata-rata Tingkat Kehadiran Kelas', `${avgRate}%`, parseFloat(avgRate) >= 90 ? 'Kategori Sangat Baik (≥ 90%)' : 'Kategori Baik'],
        ['4', 'Akumulasi Sakit (S)', `${totalS} Kali`, 'Surat Keterangan Dokter / Orang Tua'],
        ['5', 'Akumulasi Izin (I)', `${totalI} Kali`, 'Izin Kepentingan Keluarga / Upacara'],
        ['6', 'Akumulasi Tanpa Keterangan (A)', `${totalA} Kali`, totalA > 0 ? 'Perlu Pemanggilan / Pendampingan' : 'Nihil / Sangat Tertib'],
        ['7', 'Akumulasi Dispensasi Sekolah (D)', `${totalD} Kali`, 'Tugas / Lomba Mewakili Sekolah'],
        ['8', 'Akumulasi Keterlambatan (T)', `${totalT} Kali`, 'Tetap Mengikuti KBM Penuh'],
        ['9', 'Siswa dengan Kehadiran Sempurna (100%)', `${perfectCount} Siswa`, 'Apresiasi & Teladan Disiplin'],
        ['10', 'Siswa Memerlukan Pembinaan (< 85%)', `${pembinaanCount} Siswa`, pembinaanCount > 0 ? 'Koordinasi Guru Mapel & Wali Kelas/BK' : 'Seluruh Siswa Tuntas']
    ];

    summaryData.forEach((rowVals, idx) => {
        const row = wsRingkasan.getRow(13 + idx);
        row.values = rowVals;
        row.height = 18;
        row.eachCell((c, colNum) => {
            c.font = { name: 'Calibri', size: 10 };
            c.border = THIN_BORDER;
            c.alignment = { horizontal: colNum === 2 ? 'left' : 'center', vertical: 'middle' };
        });
    });

    wsRingkasan.pageSetup.printArea = `A1:D${12 + summaryData.length}`;
    wsRingkasan.getColumn(1).width = 6;
    wsRingkasan.getColumn(2).width = 38;
    wsRingkasan.getColumn(3).width = 22;
    wsRingkasan.getColumn(4).width = 36;

    // --- SHEET 4: REKAP PERTEMUAN (Landscape, 1 Halaman, tanpa TTD) ---
    const wsPertemuan = wb.addWorksheet('Rekap Pertemuan', {
        pageSetup: {
            paperSize: 9,
            orientation: 'landscape',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 1,
            horizontalCentered: true,
            showGridLines: false,
            margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 },
            printTitlesRow: '12:12'
        },
        views: [{ showGridLines: false }],
        headerFooter: { oddFooter: "&L SMA Negeri Nusantara &C Halaman &P dari &N &R Dicetak: &D" }
    });

    applyOfficialKopAndMeta(wsPertemuan, 'REKAPITULASI AGENDA & KEHADIRAN PER PERTEMUAN', 'L', 7);

    const hRowPertemuan = wsPertemuan.getRow(12);
    hRowPertemuan.values = ['NO', 'TANGGAL KBM', 'JP', 'GURU PENGAMPU', 'MATERI / TOPIK PEMBELAJARAN', 'HADIR', 'SAKIT', 'IZIN', 'ALPHA', 'DISP', 'TELAT', '% HADIR'];
    hRowPertemuan.height = 20;
    hRowPertemuan.eachCell(c => {
        c.font = { name: 'Calibri', size: 10, bold: true };
        c.fill = HEADER_FILL;
        c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        c.border = THIN_BORDER;
    });

    const activeMeetings = meetings.length > 0 ? meetings : [{ no: 1, tgl: tglCetakText, jp: '1-2', topik: 'KBM Pertemuan Perdana' }];
    activeMeetings.forEach((m, idx) => {
        const row = wsPertemuan.getRow(13 + idx);
        const mHadir = m.hadir !== undefined ? m.hadir : (students.length - (m.absen ? m.absen.length : 0));
        const mSakit = m.sakit || 0;
        const mIzin = m.izin || 0;
        const mAlpha = m.alpha || 0;
        const mDisp = m.disp || 0;
        const mTelat = m.telat || 0;
        const mPct = students.length > 0 ? `${Math.round(((mHadir + mTelat) / students.length) * 100)}%` : '100%';

        row.values = [m.no || (idx + 1), m.tgl || '-', m.jp || '-', m.guru || teacherName, m.topik || '-', mHadir, mSakit, mIzin, mAlpha, mDisp, mTelat, mPct];
        row.height = 16;
        row.eachCell((c, colNum) => {
            c.font = { name: 'Calibri', size: 10 };
            c.border = THIN_BORDER;
            c.alignment = { horizontal: (colNum === 4 || colNum === 5) ? 'left' : 'center', vertical: 'middle' };
        });
    });

    wsPertemuan.pageSetup.printArea = `A1:L${12 + activeMeetings.length}`;
    const widthsPertemuan = [5, 13, 7, 24, 38, 7, 6, 6, 6, 6, 6, 9];
    widthsPertemuan.forEach((w, idx) => wsPertemuan.getColumn(idx + 1).width = w);

    // --- SHEET 5: TINDAK LANJUT (Portrait, ada TTD) ---
    const wsTindakLanjut = wb.addWorksheet('Tindak Lanjut', {
        pageSetup: {
            paperSize: 9,
            orientation: 'portrait',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            horizontalCentered: true,
            showGridLines: false,
            margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 },
            printTitlesRow: '12:12'
        },
        views: [{ showGridLines: false }],
        headerFooter: { oddFooter: "&L SMA Negeri Nusantara &C Halaman &P dari &N &R Dicetak: &D" }
    });

    applyOfficialKopAndMeta(wsTindakLanjut, 'DAFTAR TINDAK LANJUT PEMBINAAN KEHADIRAN SISWA', 'H', 5);

    const hRowTL = wsTindakLanjut.getRow(12);
    hRowTL.values = ['NO', 'NISN / NIS', 'NAMA PESERTA DIDIK', 'TOTAL ABSEN', '% HADIR', 'IDENTIFIKASI MASALAH', 'BENTUK TINDAK LANJUT GURU', 'PARAF / KET'];
    hRowTL.height = 20;
    hRowTL.eachCell(c => {
        c.font = { name: 'Calibri', size: 10, bold: true };
        c.fill = HEADER_FILL;
        c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        c.border = THIN_BORDER;
    });

    const needFollowUp = students
        .map(s => {
            const t = s.totals || {};
            const jmlAbsen = (t.S || 0) + (t.I || 0) + (t.A || 0);
            const totalHadir = (t.H || 0) + (t.T || 0);
            const pct = meetingCount > 0 ? Math.round((totalHadir / meetingCount) * 100) : 100;
            return { ...s, jmlAbsen, pct, aCount: t.A || 0, sCount: t.S || 0 };
        })
        .filter(s => s.jmlAbsen > 0 || s.pct < 85)
        .sort((a, b) => b.jmlAbsen - a.jmlAbsen);

    const tlRows = [];
    if (needFollowUp.length > 0) {
        needFollowUp.forEach((s, idx) => {
            const combinedNis = (s.nisn && s.nis && s.nisn !== '-' && s.nis !== '-') ? `${s.nisn} / ${s.nis}` : (s.nis || s.nisn || '-');
            let masalah = 'Ketidakhadiran berkala';
            let tindakan = 'Konseling dan pembimbingan motivasi belajar';
            if (s.aCount >= 2) {
                masalah = 'Kerap tidak hadir tanpa keterangan (Alpha)';
                tindakan = 'Koordinasi dengan Wali Kelas & Pemanggilan Orang Tua';
            } else if (s.sCount >= 3) {
                masalah = 'Sakit berkepanjangan';
                tindakan = 'Pendampingan materi dan tugas mandiri susulan';
            }
            tlRows.push([idx + 1, combinedNis, s.name, `${s.jmlAbsen} Kali`, `${s.pct}%`, masalah, tindakan, 'Tuntas']);
        });
    } else {
        tlRows.push([1, '-', 'Seluruh siswa rombel tuntas mencapai kehadiran baik (≥ 85%)', '0 Kali', '100%', 'Disiplin & Partisipasi KBM Sangat Baik', 'Pemberian apresiasi dan teladan disiplin positif', 'Tuntas']);
    }

    tlRows.forEach((rowVals, idx) => {
        const row = wsTindakLanjut.getRow(13 + idx);
        row.values = rowVals;
        row.height = 20;
        row.eachCell((c, colNum) => {
            c.font = { name: 'Calibri', size: 10 };
            c.border = THIN_BORDER;
            c.alignment = { horizontal: (colNum === 3 || colNum === 6 || colNum === 7) ? 'left' : 'center', vertical: 'middle' };
        });
    });

    const startTtdTL = 12 + tlRows.length + 2;
    const lastRowTL = applyTandaTangan(wsTindakLanjut, startTtdTL, 2, 6);
    wsTindakLanjut.pageSetup.printArea = `A1:H${lastRowTL}`;

    const widthsTL = [5, 17, 25, 11, 8, 24, 28, 11];
    widthsTL.forEach((w, idx) => wsTindakLanjut.getColumn(idx + 1).width = w);

    return wb;
}

// =========================================================================
// 12A-2. EKSPOR RESMI REKAP ABSEN KBM 5 SHEET SIAP CETAK A4 (AKSI UI BROWSER)
// =========================================================================
export async function exportRekapAbsenA4() {
    const mapel = document.getElementById('select-mapel')?.value;
    const kelas = document.getElementById('select-kelas')?.value;
    const semester = document.getElementById('select-semester')?.value || '1';

    if (!mapel || !kelas) {
        showToast('Peringatan', 'Silakan pilih Kelas & Mapel lalu klik Load Data terlebih dahulu!', 'warning');
        return;
    }

    if (typeof ExcelJS === 'undefined' && typeof XLSX === 'undefined') {
        showToast('Pustaka Belum Siap', 'Pustaka Excel sedang dimuat. Silakan coba kembali dalam beberapa detik.', 'warning');
        return;
    }

    let teacherName = document.getElementById('header-guru-name')?.textContent?.trim();
    let teacherNip = '';
    const assigned = await resolveAssignedTeacherForClassAndMapel(kelas, mapel);
    if (!teacherName || teacherName === 'Guru Mapel' || teacherName === 'Guru Mata Pelajaran' || teacherName === 'Loading...') {
        teacherName = assigned?.name || (await getTeacherRealName(currentUser || auth.currentUser));
    }
    if (assigned?.nip) {
        teacherNip = assigned.nip;
    }
    if (!teacherNip || !/\d{4,}/.test(teacherNip)) {
        teacherNip = currentUserNip;
        if (!teacherNip || !/\d{4,}/.test(teacherNip)) {
            teacherNip = await resolveTeacherNipFromGtk(currentUser, currentUserDocData, teacherName);
            if (teacherNip) currentUserNip = teacherNip;
        }
    }

    const tahunAjaran = raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString();
    const faseDisplay = typeof getFaseFromClass === 'function' ? getFaseFromClass(kelas) : 'F';
    const schoolCity = SCHOOL_CONFIG.schoolCity || 'Denpasar';
    const headmasterName = SCHOOL_CONFIG.headmasterName || "Dr. I Wayan Sudarsana, M.Pd.";
    const headmasterTitle = SCHOOL_CONFIG.headmasterTitle || "Kepala SMA Negeri Nusantara";
    const headmasterNIP = SCHOOL_CONFIG.headmasterNIP || "197501012000031001";
    const tglCetakText = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    if (!loadedStudents || loadedStudents.length === 0) {
        showToast('Info', 'Memuat data siswa kelas...', 'info');
        await window.loadGradebookData();
    }
    if (!loadedStudents || loadedStudents.length === 0) {
        showToast('Peringatan', 'Data siswa tidak ditemukan untuk kelas ini.', 'warning');
        return;
    }

    showToast('Memproses Rekap', 'Menyusun berkas 5 Sheet siap cetak A4...', 'info');

    const docsArray = await fetchJurnalDocsForExport(mapel, kelas, semester, tahunAjaran);
    const pertemuanMap = {};
    docsArray.forEach((data) => {
        const tgl = getJurnalDateStr(data) || (data.timestampMs ? (typeof window.getLocalISODate === 'function' ? window.getLocalISODate(new Date(data.timestampMs)) : new Date(data.timestampMs).toISOString().split('T')[0]) : '');
        if (!tgl) return;
        const jpStr = formatJpDisplay(data.jp);
        const key = `${tgl}_JP${jpStr}`;
        const attendanceEntries = extractJournalAttendanceGuru(data);
        if (!pertemuanMap[key]) {
            pertemuanMap[key] = {
                tgl,
                jp: jpStr,
                guru: data.guru || teacherName,
                topik: data.materi || data.topik || '-',
                catatan: data.catatan || '-',
                presensi: {},
                presensiByNis: {},
                presensiNormalized: {},
                absen: []
            };
        }
        if (attendanceEntries.length > 0) {
            attendanceEntries.forEach((item) => {
                const st = item.status || "H";
                const nm = item.nama || "-";
                const nis = String(item.nis || '').trim();
                pertemuanMap[key].presensi[nm] = st;
                const normNm = String(nm).trim().replace(/\s+/g, ' ').toLowerCase();
                if (normNm) pertemuanMap[key].presensiNormalized[normNm] = st;
                if (nis) pertemuanMap[key].presensiByNis[nis] = st;
                if (st !== 'H') {
                    pertemuanMap[key].absen.push({ nama: nm, status: st });
                }
            });
        }
    });

    const pertemuanKeys = Object.keys(pertemuanMap).sort();
    const allNamesFromJurnal = new Set();
    pertemuanKeys.forEach(k => {
        Object.keys(pertemuanMap[k].presensi).forEach(n => allNamesFromJurnal.add(n));
    });

    const rowsKehadiran = [];
    const matchedNames = new Set();
    loadedStudents.forEach(s => {
        const jName = findMatchingNameGuru(s.name, allNamesFromJurnal);
        if (jName) matchedNames.add(jName);
        rowsKehadiran.push({ nis: s.nis, nisn: s.nisn || '', name: s.name, jurnalName: jName || s.name });
    });
    allNamesFromJurnal.forEach(n => {
        if (!matchedNames.has(n)) {
            rowsKehadiran.push({ nis: '-', nisn: '', name: n, jurnalName: n });
        }
    });

    const studentsForExport = rowsKehadiran.map((row, idx) => {
        const totals = { H: 0, S: 0, I: 0, A: 0, D: 0, T: 0 };
        const pertemuan = [];
        pertemuanKeys.forEach(k => {
            const st = findJournalStatusGuru(pertemuanMap[k], row);
            let finalSt = (st !== undefined && st !== "") ? st : "H";
            if (totals[finalSt] !== undefined) totals[finalSt]++;
            pertemuan.push(finalSt);
        });
        return {
            no: idx + 1,
            nis: row.nis,
            nisn: row.nisn,
            name: row.name,
            pertemuan,
            totals
        };
    });

    const meetingsForExport = pertemuanKeys.map((k, idx) => {
        const p = pertemuanMap[k];
        let sCount = 0, iCount = 0, aCount = 0, dCount = 0, tCount = 0, hCount = 0;
        Object.values(p.presensi).forEach(st => {
            if (st === 'S') sCount++;
            else if (st === 'I') iCount++;
            else if (st === 'A') aCount++;
            else if (st === 'D') dCount++;
            else if (st === 'T') tCount++;
            else hCount++;
        });
        let shortTgl = p.tgl || '-';
        if (p.tgl && p.tgl.length >= 10) {
            const parts = p.tgl.split('-');
            if (parts.length === 3) shortTgl = `${parts[2]}/${parts[1]}`;
        }
        return {
            no: idx + 1,
            tgl: p.tgl,
            shortTgl,
            jp: p.jp,
            guru: p.guru,
            topik: p.topik,
            catatan: p.catatan,
            hadir: hCount,
            sakit: sCount,
            izin: iCount,
            alpha: aCount,
            disp: dCount,
            telat: tCount,
            absen: p.absen
        };
    });

    const exportParams = {
        mapel,
        kelas,
        semester,
        tahunAjaran,
        faseDisplay,
        schoolCity,
        headmasterName,
        headmasterTitle,
        headmasterNIP,
        teacherName,
        teacherNip,
        tglCetakText,
        students: studentsForExport,
        meetings: meetingsForExport
    };

    const filename = `Rekap_Absen_${kelas.replace(/\s+/g, '_')}_S${semester}.xlsx`;

    try {
        if (typeof ExcelJS !== 'undefined') {
            const wb = await buildRekapAbsenWorkbook(exportParams, ExcelJS);
            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

            if (typeof saveAs !== 'undefined') {
                saveAs(blob, filename);
            } else {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }
            showToast('Export Excel Selesai', `File ${filename} (5 Sheet Siap Cetak A4) berhasil diunduh.`, 'success');
        } else {
            // Fallback dengan XLSX SheetJS jika ExcelJS belum terload
            const wb = XLSX.utils.book_new();
            // Data Sheet
            const dataRows = [
                ["SMA NEGERI NUSANTARA"],
                ['DATA PRESENSI KEHADIRAN SISWA'],
                [`Kelas / Fase : ${kelas} / ${faseDisplay}`, '', '', '', `Semester : ${semester}`],
                [`Mata Pelajaran : ${mapel}`, '', '', '', `Tahun Pelajaran : ${tahunAjaran}`],
                []
            ];
            const dataH1 = ['NO', 'NISN / NIS', 'NAMA PESERTA DIDIK'];
            meetingsForExport.forEach((m, i) => dataH1.push(`Pertemuan ${m.no || i + 1}`));
            dataH1.push('S', 'I', 'A', 'D', 'T', 'JML', 'H%');
            dataRows.push(dataH1);

            studentsForExport.forEach((s, idx) => {
                const combinedNis = (s.nisn && s.nis) ? `${s.nisn} / ${s.nis}` : (s.nis || s.nisn || '-');
                const row = [idx + 1, combinedNis, s.name];
                s.pertemuan.forEach(st => row.push(st));
                const t = s.totals;
                const jml = (t.S || 0) + (t.I || 0) + (t.A || 0) + (t.D || 0);
                const pct = meetingsForExport.length > 0 ? Math.round(((t.H + t.T) / meetingsForExport.length) * 100) : 100;
                row.push(t.S || 0, t.I || 0, t.A || 0, t.D || 0, t.T || 0, jml, `${pct}%`);
                dataRows.push(row);
            });

            const wsD = XLSX.utils.aoa_to_sheet(dataRows);
            wsD['!margins'] = { left: 0.5, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 };
            XLSX.utils.book_append_sheet(wb, wsD, 'Data');
            XLSX.writeFile(wb, filename);
            showToast('Export Excel Selesai', `File ${filename} berhasil diunduh.`, 'success');
        }
    } catch (err) {
        console.error('[Export Rekap Absen Error]', err);
        showToast('Gagal Ekspor', err.message || 'Terjadi kesalahan saat mengekspor rekap absen.', 'error');
    }
}
window.exportRekapAbsenA4 = exportRekapAbsenA4;

// =========================================================================
// 12B. CETAK DOKUMEN RESMI A4: LEGER NILAI & LAPORAN ANALISIS PENILAIAN LENGKAP
// =========================================================================
window.printGradebookAnalytics = async function () {
    const mapel = document.getElementById('select-mapel')?.value;
    const kelas = document.getElementById('select-kelas')?.value;
    const semester = document.getElementById('select-semester')?.value || '1';

    if (!mapel || !kelas || loadedStudents.length === 0) {
        showToast('Peringatan', 'Silakan pilih Kelas & Mapel lalu klik tombol Muat Siswa (Load) terlebih dahulu!', 'warning');
        return;
    }

    // Reserve the preview during the click, before teacher lookup can consume user activation.
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'warning',
                title: 'Pop-up Terblokir',
                text: 'Peramban memblokir jendela pratinjau cetak. Mohon izinkan pop-up (Always allow pop-ups) pada peramban Anda untuk mencetak dokumen nilai dan analisis.',
            });
        } else {
            showToast('Pop-up Terblokir', 'Harap izinkan pop-up peramban untuk mencetak dokumen nilai & analisis.', 'warning');
        }
        return;
    }

    let teacherName = document.getElementById('header-guru-name')?.textContent?.trim();
    try {
        if (!teacherName || teacherName === 'Guru Mapel' || teacherName === 'Guru Mata Pelajaran' || teacherName === 'Loading...') {
            const assigned = await resolveAssignedTeacherForClassAndMapel(kelas, mapel);
            teacherName = assigned?.name || (await getTeacherRealName(currentUser || auth.currentUser));
        }
    } catch (_) {
        printWindow.close();
        showToast('Gagal Mencetak', 'Identitas guru belum dapat dimuat. Silakan coba lagi.', 'error');
        return;
    }
    if (printWindow.closed) return;
    const tahunAjaran = (typeof raporConfig !== 'undefined' && raporConfig.tahun_ajaran_aktif) || getCurrentAcademicYearString();

    let teacherNIP = '-';
    try {
        if (typeof allTeachers !== 'undefined' && Array.isArray(allTeachers)) {
            const foundT = allTeachers.find(t => (t.nama || t.name) === teacherName);
            if (foundT && (foundT.nip || foundT.nuptk)) {
                teacherNIP = foundT.nip || foundT.nuptk;
            }
        }
    } catch (_) {}

    function esc(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    const isPerhotelan = typeof isPerhotelanMapel === 'function' ? isPerhotelanMapel(mapel) : false;
    const classCpDesc = document.getElementById('input-class-cp-desc')?.value.trim() || '';
    const studentRecords = [];

    function scoreValue(value) {
        if (value === null || value === undefined || String(value).trim() === '') return '';
        const number = Number(value);
        return Number.isFinite(number) ? number : '';
    }

    function summaryValue(row, selector, saved, round = false) {
        const cell = row?.querySelector(selector);
        const value = scoreValue(cell ? cell.textContent.trim() : saved);
        return round && value !== '' ? Math.round(value) : value;
    }

    const rowsByNis = new Map([...document.querySelectorAll('#gradebook-tbody tr[data-nis]')]
        .map(row => [row.dataset.nis, row]));
    loadedStudents.forEach((student, idx) => {
        const row = rowsByNis.get(String(student.nis));
        const existingStudentScores = existingScoresMap[student.nis] || {};
        const existingSummary = existingSummariesMap[student.nis] || {};

        const colScores = {};
        const inputsByKey = new Map([...(row?.querySelectorAll('input[data-col-key]') || [])]
            .map(input => [input.dataset.colKey, input]));
        activeColumns.forEach(col => {
            const input = inputsByKey.get(String(col.key));
            // A present, cleared input is authoritative; only absent controls use saved scores.
            colScores[col.key] = scoreValue(input ? input.value : existingStudentScores[col.key]);
        });

        const cellTugas = summaryValue(row, '.cell-tugas-avg', existingSummary.tugas_avg);
        const cellSumatif = summaryValue(row, '.cell-sumatif-avg', existingSummary.sumatif_avg);
        const cellFinal = summaryValue(row, '.cell-final-score', existingSummary.final_score, true);

        let cellNilaiRapor = '';
        let studentCp = '';

        if (isPerhotelan) {
            const nrInp = row?.querySelector('.perhotelan-nilai-rapor');
            cellNilaiRapor = scoreValue(nrInp ? nrInp.value : existingSummary.nilai_rapor);
            if (!nrInp && cellNilaiRapor === '' && cellFinal !== '') cellNilaiRapor = cellFinal;

            if (row) {
                const cpInp = row.querySelector('.perhotelan-deskripsi-cp');
                if (cpInp && cpInp.value !== undefined) studentCp = cpInp.value.trim();
            }
            if (!studentCp && existingSummary.deskripsi_cp) studentCp = existingSummary.deskripsi_cp.trim();
        }

        studentRecords.push({
            no: idx + 1,
            student,
            colScores,
            cellTugas: typeof cellTugas === 'number' && !isNaN(cellTugas) ? cellTugas : '',
            cellSumatif: typeof cellSumatif === 'number' && !isNaN(cellSumatif) ? cellSumatif : '',
            cellFinal: typeof cellFinal === 'number' && !isNaN(cellFinal) ? cellFinal : '',
            cellNilaiRapor: typeof cellNilaiRapor === 'number' && !isNaN(cellNilaiRapor) ? cellNilaiRapor : '',
            deskripsiCp: isPerhotelan ? studentCp : classCpDesc
        });
    });

    function calcColStats(values, kkm) {
        const nums = values.filter(v => typeof v === 'number' && !isNaN(v));
        const count = nums.length;
        if (count === 0) return { count: 0, avg: '-', max: '-', min: '-', pass: 0, remidial: 0, pctPass: 0 };
        const sum = nums.reduce((acc, curr) => acc + curr, 0);
        const avg = parseFloat((sum / count).toFixed(1));
        const max = Math.max(...nums);
        const min = Math.min(...nums);
        const pass = nums.filter(v => v >= kkm).length;
        const remidial = nums.filter(v => v < kkm).length;
        const pctPass = Math.round((pass / count) * 100);
        return { count, avg, max, min, pass, remidial, pctPass };
    }

    const totalSiswa = studentRecords.length;
    const finalScoresList = studentRecords
        .map(r => ({ student: r.student, score: r.cellFinal }))
        .filter(item => typeof item.score === 'number' && !isNaN(item.score));
    const countFinal = finalScoresList.length;
    const totalFinalScore = finalScoresList.reduce((acc, curr) => acc + curr.score, 0);
    const avgFinalVal = countFinal > 0 ? parseFloat((totalFinalScore / countFinal).toFixed(1)) : 0;

    let highestScore = -1, highestStudentName = '-';
    let lowestScore = 999, lowestStudentName = '-';
    let passCount = 0;
    const belowKkmFinalStudents = [];

    finalScoresList.forEach(item => {
        if (item.score >= kkmValue) {
            passCount++;
        } else {
            belowKkmFinalStudents.push({
                nis: item.student.nis,
                name: item.student.name,
                score: Math.round(item.score)
            });
        }
        if (item.score > highestScore) {
            highestScore = item.score;
            highestStudentName = item.student.name;
        }
        if (item.score < lowestScore) {
            lowestScore = item.score;
            lowestStudentName = item.student.name;
        }
    });

    const pctTuntas = totalSiswa > 0 ? Math.round((passCount / totalSiswa) * 100) : 0;
    const totalRemidi = belowKkmFinalStudents.length;
    const pctRemidi = totalSiswa > 0 ? Math.round((totalRemidi / totalSiswa) * 100) : 0;
    const missingFinal = totalSiswa - countFinal;

    const tugasScores = studentRecords.map(r => r.cellTugas).filter(v => typeof v === 'number' && !isNaN(v));
    const avgTugasVal = tugasScores.length > 0 ? parseFloat((tugasScores.reduce((a, b) => a + b, 0) / tugasScores.length).toFixed(1)) : 0;

    const sumatifScores = studentRecords.map(r => r.cellSumatif).filter(v => typeof v === 'number' && !isNaN(v));
    const avgSumatifVal = sumatifScores.length > 0 ? parseFloat((sumatifScores.reduce((a, b) => a + b, 0) / sumatifScores.length).toFixed(1)) : 0;

    const sasCol = activeColumns.find(c => c.type === 'sas' || c.type === 'sat');
    let avgSasVal = '-';
    if (sasCol) {
        const sasScores = studentRecords.map(r => r.colScores[sasCol.key]).filter(v => typeof v === 'number' && !isNaN(v));
        avgSasVal = sasScores.length > 0 ? parseFloat((sasScores.reduce((a, b) => a + b, 0) / sasScores.length).toFixed(1)) : '-';
    }

    const compAnalysisList = activeColumns.map(col => {
        const colScoresWithStudent = studentRecords.map(r => ({
            student: r.student,
            score: r.colScores[col.key]
        }));
        const validScores = colScoresWithStudent.filter(s => typeof s.score === 'number' && !isNaN(s.score));
        const count = validScores.length;
        let sum = 0, maxVal = -1, maxStudent = '-', minVal = 999, minStudent = '-', passCol = 0;

        validScores.forEach(s => {
            sum += s.score;
            if (s.score >= kkmValue) passCol++;
            if (s.score > maxVal) { maxVal = s.score; maxStudent = s.student.name; }
            if (s.score < minVal) { minVal = s.score; minStudent = s.student.name; }
        });

        const avg = count > 0 ? parseFloat((sum / count).toFixed(1)) : '-';
        const pctPass = count > 0 ? Math.round((passCol / count) * 100) : 0;
        const remidialCol = count - passCol;
        const emptyCount = totalSiswa - count;

        let category = 'Tugas Formatif';
        if (col.type === 'sumatif') category = 'Sumatif Materi';
        if (col.type === 'sas' || col.type === 'sat') category = semester === '1' ? 'Sumatif Akhir Semester (SAS)' : 'Sumatif Akhir Tahun (SAT)';

        return {
            key: col.key,
            label: col.label,
            category,
            count,
            avg,
            maxVal: maxVal >= 0 ? maxVal : '-',
            maxStudent,
            minVal: minVal <= 100 ? minVal : '-',
            minStudent,
            pass: passCol,
            pctPass,
            remidial: remidialCol,
            emptyCount
        };
    });

    let lowestColLabel = null, lowestColAvg = 999;
    compAnalysisList.forEach(c => {
        if (c.count > 0 && typeof c.avg === 'number') {
            if (c.avg < lowestColAvg) {
                lowestColAvg = c.avg;
                lowestColLabel = c.label;
            }
        }
    });

    let statusBadgeText = '';
    let statusHeaderText = '';
    let mainInsightText = '';
    let pedagogicalActionText = '';

    if (countFinal === 0) {
        statusBadgeText = 'BELUM ADA NILAI';
        statusHeaderText = 'Data penilaian belum diinput.';
        pedagogicalActionText = 'Silakan lakukan penginputan nilai untuk melihat evaluasi pedagogis.';
    } else if (missingFinal > 0) {
        statusBadgeText = 'PENILAIAN BELUM LENGKAP';
        statusHeaderText = `${countFinal} dari ${totalSiswa} siswa memiliki nilai akhir: ${passCount} tuntas dan ${totalRemidi} memerlukan remediasi.`;
        mainInsightText = `${missingFinal} siswa belum memiliki nilai akhir; evaluasi capaian rombel masih sementara.`;
        pedagogicalActionText = 'Lengkapi nilai akhir sebelum menyimpulkan capaian seluruh kelas; berikan pendampingan kepada siswa bernilai di bawah KKM.';
    } else {
        if (passCount === totalSiswa) {
            if (avgSumatifVal >= 85) {
                statusBadgeText = 'PERFORMA KELAS EXCELLENT (100% TUNTAS)';
                statusHeaderText = `Luar biasa! Seluruh ${totalSiswa} siswa telah tuntas melampaui KKM (${kkmValue}) dengan capaian rata-rata kelas yang sangat memuaskan.`;
                mainInsightText = 'Rombel menunjukkan penguasaan materi yang tinggi dan merata di seluruh indikator pencapaian pembelajaran.';
                pedagogicalActionText = `Disarankan memberikan Materi Pengayaan / Proyek Tantangan HOTS bagi ${highestStudentName.split(' ')[0]} dan rekan-rekan untuk mengasah kepemimpinan akademis.`;
            } else {
                statusBadgeText = '100% TUNTAS KKM';
                statusHeaderText = `Seluruh ${totalSiswa} siswa telah memenuhi KKM (${kkmValue}).`;
                mainInsightText = `Ketuntasan sudah aman 100%, namun nilai rata-rata kelas masih dapat ditingkatkan dari ${Math.round(avgFinalVal)} ke tingkat optimal.`;
                pedagogicalActionText = 'Pembelajaran dapat dilanjutkan ke modul berikutnya dengan menyelipkan latihan penerapan konsep aplikatif secara rutin.';
            }
        } else if (pctTuntas >= 85) {
            statusBadgeText = `KETUNTASAN TINGGI (${pctTuntas}%)`;
            statusHeaderText = `Sebanyak ${passCount} dari ${totalSiswa} siswa (${pctTuntas}%) telah tuntas melampaui KKM (${kkmValue}).`;
            mainInsightText = `Hanya terdapat ${totalRemidi} siswa yang masih memerlukan pembimbingan remediasi parsial.`;
            pedagogicalActionText = `Terapkan program Tutor Sebaya (Peer Tutoring) dengan memberdayakan siswa bernilai tertinggi (${highestStudentName.split(' ')[0]}) untuk mendampingi ${totalRemidi} rekan yang belum tuntas.`;
        } else if (pctTuntas >= 60) {
            statusBadgeText = `PERLU REMEDIASI KELOMPOK (${pctTuntas}% TUNTAS)`;
            statusHeaderText = `Ketuntasan kelas berada pada tingkat menengah (${pctTuntas}%) dengan ${totalRemidi} siswa (${pctRemidi}%) berada di bawah KKM (${kkmValue}).`;
            mainInsightText = 'Diperlukan pendampingan kelompok khusus sebelum kelas melangkah ke modul kompetensi selanjutnya.';
            pedagogicalActionText = `Disarankan membuka Klinik Belajar Remedial terfokus pada materi ${lowestColLabel || 'Komponen Terendah'} (Rata-rata: ${lowestColAvg <= 100 ? lowestColAvg : '-'}).`;
        } else if (pctTuntas >= 35) {
            statusBadgeText = `INTERVENSI PEMBELAJARAN REQUIRED (${pctTuntas}% TUNTAS)`;
            statusHeaderText = `Ketuntasan kelas masih di bawah standar harapan (baru ${pctTuntas}% tuntas, ${totalRemidi} siswa remidial).`;
            mainInsightText = 'Sebagian besar rombel mengalami hambatan dalam menyerap indikator kompetensi dasar.';
            pedagogicalActionText = 'Sangat direkomendasikan melakukan Pembelajaran Ulang (Re-teaching) Kelompok dengan penyederhanaan metode ajar sebelum mengadakan tes ulang.';
        } else {
            statusBadgeText = `KRITIS (HANYA ${pctTuntas}% TUNTAS)`;
            statusHeaderText = `Mayoritas siswa dalam rombel (${totalRemidi} dari ${totalSiswa} siswa) belum mencapai batas KKM (${kkmValue}).`;
            mainInsightText = 'Terdapat indikasi kendala serapan materi atau instrumen tes yang terlalu kompleks secara kolektif.';
            pedagogicalActionText = 'Diperlukan Evaluasi Instrumen Soal & Pembelajaran Ulang Total. Pertimbangkan untuk merevisi tingkat kesulitan instrumen serta mengadakan sesi pembahasan materi dasar bersama rombel.';
        }
    }

    const diffTugasVsSumatif = (avgTugasVal > 0 && avgSumatifVal > 0) ? (avgTugasVal - avgSumatifVal) : 0;
    let processInsightClean = '';
    if (diffTugasVsSumatif >= 15) {
        processInsightClean = `Disparitas Proses vs Ujian: Rata-rata Tugas (${avgTugasVal}) jauh melampaui Rata Sumatif (${avgSumatifVal}). Siswa rajin tugas harian namun mengalami kendala saat ujian mandiri. Saran: Berikan latihan simulasi tes bertenggat waktu (time-bound quiz).`;
    } else if (diffTugasVsSumatif <= -12) {
        processInsightClean = `Potensi Tinggi, Kedisiplinan Tugas Perlu Ditingkatkan: Rata Sumatif (${avgSumatifVal}) lebih tinggi dibanding Tugas Harian (${avgTugasVal}). Siswa cepat paham saat tes namun kurang disiplin mengumpulkan tugas. Saran: Terapkan reminder tugas berkala.`;
    } else if (avgTugasVal > 0 && avgSumatifVal > 0) {
        processInsightClean = `Konsistensi Pembelajaran: Nilai Tugas (${avgTugasVal}) dan Nilai Sumatif (${avgSumatifVal}) berjalan selaras dan seimbang, menandakan proses belajar yang stabil.`;
    }

    const gapScore = (highestScore >= 0 && lowestScore <= 100) ? (highestScore - lowestScore) : 0;
    let gapInsightClean = '';
    if (gapScore >= 35) {
        gapInsightClean = `Kesenjangan Nilai Lebar (Rentang ${Math.round(gapScore)} poin): Selisih tinggi antara nilai tertinggi (${highestScore} - ${highestStudentName}) dan terendah (${lowestScore} - ${lowestStudentName}). Saran: Gunakan Pembelajaran Berdiferensiasi (Differentiated Instruction).`;
    } else if (gapScore > 0 && gapScore <= 15) {
        gapInsightClean = `Heterogenitas Terkontrol: Rentang nilai antarsiswa relatif homogen (${Math.round(gapScore)} poin), menunjukkan daya serap kelas merata.`;
    }

    let bottleneckInsightClean = '';
    if (lowestColLabel && lowestColAvg <= 100) {
        bottleneckInsightClean = `Pencapaian terendah rombel ada pada ${lowestColLabel} (Rata-rata: ${lowestColAvg}). Sesi penguatan/ulasan soal difokuskan pada materi indikator ini.`;
    }

    // Statistik Kolom untuk Baris Rekapitulasi Tabel Leger
    const statsCols = [];
    activeColumns.forEach(c => {
        statsCols.push({ key: c.key, label: c.label, stats: calcColStats(studentRecords.map(r => r.colScores[c.key]), kkmValue) });
    });
    const tugasColStats = calcColStats(studentRecords.map(r => r.cellTugas), kkmValue);
    const sumatifColStats = calcColStats(studentRecords.map(r => r.cellSumatif), kkmValue);
    const finalColStats = calcColStats(studentRecords.map(r => r.cellFinal), kkmValue);
    const nrColStats = isPerhotelan ? calcColStats(studentRecords.map(r => r.cellNilaiRapor), kkmValue) : null;

    const kopUrl = new URL(SCHOOL_CONFIG?.kopPath || 'assets/kop.png', window.location.href).href;
    const tglCetak = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const schoolCity = SCHOOL_CONFIG.schoolCity || 'Denpasar';

    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="id">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Leger Nilai & Laporan Analisis - ${esc(mapel)} ${esc(kelas)}</title>
            <style>
                @page {
                    size: A4 portrait;
                    margin: 4mm 7mm 4mm 7mm;
                }
                * {
                    box-sizing: border-box;
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    font-size: 8.5pt;
                    line-height: 1.35;
                    color: #0f172a;
                    background: #ffffff;
                    margin: 0;
                    padding: 0;
                }
                .kop-wrapper {
                    text-align: center;
                    margin-bottom: 8px;
                    border-bottom: 2px solid #0f172a;
                    padding-bottom: 4px;
                }
                .kop-img {
                    width: 100%;
                    max-height: 95px;
                    object-fit: contain;
                    display: block;
                    margin: 0 auto;
                }
                .kop-fallback {
                    display: none;
                    text-align: center;
                }
                .kop-fallback h2 { font-size: 11pt; margin: 0; font-weight: bold; }
                .kop-fallback h1 { font-size: 14pt; margin: 2px 0; font-weight: 800; }
                .kop-fallback p { font-size: 8pt; margin: 0; }
                
                .doc-header {
                    text-align: center;
                    margin: 6px 0 10px 0;
                }
                .doc-title {
                    font-size: 11pt;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: #0f172a;
                    margin: 0;
                }
                .doc-subtitle {
                    font-size: 8.5pt;
                    font-weight: 600;
                    color: #475569;
                    margin-top: 2px;
                }

                .meta-table {
                    width: 100%;
                    margin-bottom: 6px;
                    border-collapse: collapse;
                    font-size: 7.5pt;
                }
                .meta-table td {
                    padding: 1px 2px;
                    vertical-align: middle;
                }
                .meta-lbl { width: 12%; color: #475569; font-weight: 600; white-space: nowrap; }
                .meta-sep { width: 1%; text-align: center; font-weight: bold; }
                .meta-val { width: 20%; font-weight: 700; color: #0f172a; }

                /* Tabel Leger Nilai */
                .table-clean {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 7.2pt;
                    line-height: 1.15;
                    margin-bottom: 10px;
                }
                .table-clean th, .table-clean td {
                    border: 1px solid #cbd5e1;
                    padding: 1.5px 2.5px;
                }
                .table-clean th {
                    background: #f1f5f9;
                    color: #1e293b;
                    font-weight: 800;
                    text-align: center;
                    text-transform: uppercase;
                    padding: 2.5px 2px;
                }
                .table-clean tr:nth-child(even) td {
                    background: #fafafa;
                }
                .text-center { text-align: center; }
                .text-left { text-align: left; }
                .text-right { text-align: right; }
                .font-bold { font-weight: 700; }
                
                .badge-pass {
                    color: #15803d;
                    font-weight: 700;
                }
                .badge-rem {
                    color: #dc2626;
                    font-weight: 800;
                }
                .score-rem {
                    color: #dc2626 !important;
                    font-weight: 800 !important;
                }
                
                .stat-heading {
                    background: #e2e8f0 !important;
                    font-weight: 800 !important;
                    text-align: left !important;
                    padding-left: 6px !important;
                }
                .stat-cell {
                    background: #f8fafc;
                    font-weight: 700;
                    text-align: center;
                }

                /* Halaman Analisis */
                .page-break {
                    page-break-before: always;
                    break-before: page;
                    margin-top: 15px;
                }
                .analysis-banner {
                    background: #f8fafc;
                    border: 1.5px solid #cbd5e1;
                    border-radius: 6px;
                    padding: 8px 12px;
                    margin-bottom: 10px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .analysis-banner-title {
                    font-size: 10pt;
                    font-weight: 800;
                    color: #1e293b;
                    text-transform: uppercase;
                }
                .analysis-banner-sub {
                    font-size: 8pt;
                    color: #475569;
                    margin-top: 1px;
                }
                .analysis-section {
                    margin-bottom: 10px;
                }
                .section-tag {
                    font-size: 8.5pt;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 0.3px;
                    color: #1e293b;
                    margin-bottom: 4px;
                    border-left: 3px solid #2563eb;
                    padding-left: 6px;
                }
                
                .pedagogy-card {
                    border: 1px solid #cbd5e1;
                    background: #fdfdfd;
                    border-radius: 4px;
                    padding: 8px 10px;
                    font-size: 8pt;
                }
                .pedagogy-item {
                    margin-bottom: 6px;
                    line-height: 1.4;
                }
                .pedagogy-item:last-child {
                    margin-bottom: 0;
                }
                .pedagogy-title {
                    font-weight: 800;
                    color: #1e293b;
                }

                /* Lembar Pengesahan */
                .sign-container {
                    margin-top: 16px;
                    page-break-inside: avoid;
                }
                .sign-grid {
                    width: 100%;
                    border-collapse: collapse;
                }
                .sign-grid td {
                    width: 50%;
                    vertical-align: top;
                    padding: 0 10px;
                    font-size: 8.5pt;
                }
                .sign-role {
                    font-weight: 700;
                    color: #1e293b;
                    margin-top: 2px;
                }
                .sign-space {
                    height: 52px;
                }
                .sign-name {
                    font-weight: 800;
                    text-decoration: underline;
                    color: #0f172a;
                }
                .sign-nip {
                    font-size: 8pt;
                    color: #334155;
                }
            </style>
        </head>
        <body>
            <!-- =================================================================== -->
            <!-- BAGIAN 1: DAFTAR NILAI PESERTA DIDIK (LEGER NILAI KELAS) -->
            <!-- =================================================================== -->
            <div class="kop-wrapper">
                <img src="${esc(kopUrl)}" alt="Kop Sekolah" class="kop-img" onerror="this.style.display='none'; document.getElementById('kop-fb').style.display='block';">
                <div id="kop-fb" class="kop-fallback">
                    <h2>PEMERINTAH PROVINSI BALI - DINAS PENDIDIKAN KEPEMUDAAN DAN OLAHRAGA</h2>
                    <h1>${esc(SCHOOL_CONFIG?.schoolNameUpper || "SMA NEGERI NUSANTARA")}</h1>
                    <p>Alamat: ${esc(SCHOOL_CONFIG?.schoolAddress || "Jl. Nusantara No. 1, Denpasar")}${SCHOOL_CONFIG?.schoolPostalCode ? ' ' + esc(SCHOOL_CONFIG.schoolPostalCode) : ''}</p>
                </div>
            </div>

            <div class="doc-header">
                <h2 class="doc-title">DAFTAR NILAI HASIL BELAJAR PESERTA DIDIK</h2>
                <div class="doc-subtitle">LEGER NILAI AKADEMIK KELAS &bull; TAHUN PELAJARAN ${esc(tahunAjaran)}</div>
            </div>

            <table class="meta-table">
                <tr>
                    <td class="meta-lbl">Mata Pelajaran</td>
                    <td class="meta-sep">:</td>
                    <td class="meta-val">${esc(mapel)}</td>
                    <td class="meta-lbl">Kelas / Rombel</td>
                    <td class="meta-sep">:</td>
                    <td class="meta-val">${esc(kelas)}</td>
                    <td class="meta-lbl">Batas KKM</td>
                    <td class="meta-sep">:</td>
                    <td class="meta-val">${kkmValue}</td>
                </tr>
                <tr>
                    <td class="meta-lbl">Semester</td>
                    <td class="meta-sep">:</td>
                    <td class="meta-val">Semester ${esc(semester)}</td>
                    <td class="meta-lbl">Tahun Ajaran</td>
                    <td class="meta-sep">:</td>
                    <td class="meta-val">${esc(tahunAjaran)}</td>
                    <td class="meta-lbl">Guru Pengampu</td>
                    <td class="meta-sep">:</td>
                    <td class="meta-val">${esc(teacherName)}</td>
                </tr>
            </table>

            <table class="table-clean">
                <thead>
                    <tr>
                        <th style="width: 24px;">NO</th>
                        <th style="width: 65px;">NIS</th>
                        <th style="text-align: left; padding-left: 6px;">NAMA PESERTA DIDIK</th>
                        ${activeColumns.map(c => `<th style="width: 30px;">${esc(c.label)}</th>`).join('')}
                        <th style="width: 36px; background: #e2e8f0;">RATA TUGAS</th>
                        <th style="width: 36px; background: #e2e8f0;">RATA SUMATIF</th>
                        <th style="width: 38px; background: #dbeafe;">NA</th>
                        ${isPerhotelan ? '<th style="width: 38px; background: #f3e8ff;">NILAI RAPOR</th>' : ''}
                        <th style="width: 55px;">STATUS</th>
                    </tr>
                </thead>
                <tbody>
                    ${studentRecords.map(r => {
                        const finalVal = r.cellFinal;
                        const isPass = (typeof finalVal === 'number' && finalVal >= kkmValue);
                        const isRem = (typeof finalVal === 'number' && finalVal < kkmValue);
                        const statusBadge = isPass ? '<span class="badge-pass">Tuntas</span>' : (isRem ? '<span class="badge-rem">Remedial</span>' : '-');
                        return `
                        <tr>
                            <td class="text-center">${r.no}</td>
                            <td class="text-center" style="font-family: monospace;">${esc(r.student.nis)}</td>
                            <td class="text-left" style="padding-left: 6px;">${esc(r.student.name)}</td>
                            ${activeColumns.map(c => {
                                const val = r.colScores[c.key];
                                const isBelow = (typeof val === 'number' && val < kkmValue);
                                return `<td class="text-center ${isBelow ? 'score-rem' : ''}">${val !== '' ? val : '-'}</td>`;
                            }).join('')}
                            <td class="text-center font-bold" style="background: #f8fafc;">${r.cellTugas !== '' ? r.cellTugas : '-'}</td>
                            <td class="text-center font-bold" style="background: #f8fafc;">${r.cellSumatif !== '' ? r.cellSumatif : '-'}</td>
                            <td class="text-center font-bold ${isRem ? 'score-rem' : ''}" style="background: #eff6ff;">${r.cellFinal !== '' ? r.cellFinal : '-'}</td>
                            ${isPerhotelan ? `<td class="text-center font-bold" style="background: #faf5ff;">${r.cellNilaiRapor !== '' ? r.cellNilaiRapor : '-'}</td>` : ''}
                            <td class="text-center">${statusBadge}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="3" class="stat-heading">RATA-RATA KELAS</td>
                        ${statsCols.map(sc => `<td class="stat-cell">${sc.stats.avg}</td>`).join('')}
                        <td class="stat-cell">${tugasColStats.avg}</td>
                        <td class="stat-cell">${sumatifColStats.avg}</td>
                        <td class="stat-cell" style="background: #dbeafe; color: #1e3a8a;">${finalColStats.avg}</td>
                        ${isPerhotelan ? `<td class="stat-cell" style="background: #f3e8ff;">${nrColStats ? nrColStats.avg : '-'}</td>` : ''}
                        <td class="stat-cell">-</td>
                    </tr>
                    <tr>
                        <td colspan="3" class="stat-heading">NILAI TERTINGGI (MAX)</td>
                        ${statsCols.map(sc => `<td class="stat-cell">${sc.stats.max}</td>`).join('')}
                        <td class="stat-cell">${tugasColStats.max}</td>
                        <td class="stat-cell">${sumatifColStats.max}</td>
                        <td class="stat-cell" style="background: #dbeafe; color: #15803d;">${finalColStats.max}</td>
                        ${isPerhotelan ? `<td class="stat-cell" style="background: #f3e8ff;">${nrColStats ? nrColStats.max : '-'}</td>` : ''}
                        <td class="stat-cell">-</td>
                    </tr>
                    <tr>
                        <td colspan="3" class="stat-heading">NILAI TERENDAH (MIN)</td>
                        ${statsCols.map(sc => `<td class="stat-cell">${sc.stats.min}</td>`).join('')}
                        <td class="stat-cell">${tugasColStats.min}</td>
                        <td class="stat-cell">${sumatifColStats.min}</td>
                        <td class="stat-cell" style="background: #dbeafe; color: #dc2626;">${finalColStats.min}</td>
                        ${isPerhotelan ? `<td class="stat-cell" style="background: #f3e8ff;">${nrColStats ? nrColStats.min : '-'}</td>` : ''}
                        <td class="stat-cell">-</td>
                    </tr>
                    <tr>
                        <td colspan="3" class="stat-heading">JUMLAH TUNTAS (&ge;${kkmValue})</td>
                        ${statsCols.map(sc => `<td class="stat-cell">${sc.stats.pass}</td>`).join('')}
                        <td class="stat-cell">${tugasColStats.pass}</td>
                        <td class="stat-cell">${sumatifColStats.pass}</td>
                        <td class="stat-cell" style="background: #dbeafe; color: #15803d;">${finalColStats.pass}</td>
                        ${isPerhotelan ? `<td class="stat-cell" style="background: #f3e8ff;">${nrColStats ? nrColStats.pass : '-'}</td>` : ''}
                        <td class="stat-cell" style="color: #15803d; font-weight: 800;">${pctTuntas}%</td>
                    </tr>
                    <tr>
                        <td colspan="3" class="stat-heading">JUMLAH REMIDIAL (&lt;${kkmValue})</td>
                        ${statsCols.map(sc => `<td class="stat-cell">${sc.stats.remidial}</td>`).join('')}
                        <td class="stat-cell">${tugasColStats.remidial}</td>
                        <td class="stat-cell">${sumatifColStats.remidial}</td>
                        <td class="stat-cell" style="background: #dbeafe; color: #dc2626;">${finalColStats.remidial}</td>
                        ${isPerhotelan ? `<td class="stat-cell" style="background: #f3e8ff;">${nrColStats ? nrColStats.remidial : '-'}</td>` : ''}
                        <td class="stat-cell" style="color: #dc2626; font-weight: 800;">${totalRemidi}</td>
                    </tr>
                </tfoot>
            </table>

            <!-- =================================================================== -->
            <!-- BAGIAN 2: LAPORAN ANALISIS PENILAIAN LENGKAP & REKOMENDASI PEDAGOGIS -->
            <!-- =================================================================== -->
            <div class="page-break"></div>

            <div class="analysis-banner">
                <div>
                    <div class="analysis-banner-title">LAPORAN ANALISIS &amp; EVALUASI PENILAIAN AKADEMIK KELAS</div>
                    <div class="analysis-banner-sub">
                        Mata Pelajaran: <b>${esc(mapel)}</b> &bull; Kelas: <b>${esc(kelas)}</b> &bull; Semester ${esc(semester)} TA ${esc(tahunAjaran)} &bull; KKM: <b>${kkmValue}</b>
                    </div>
                </div>
                <div style="font-size: 8pt; font-weight: 700; color: #475569; text-align: right;">
                    ${totalSiswa} Siswa Terdata
                </div>
            </div>

            <!-- I. RANGKUMAN STATISTIK PENILAIAN KELAS -->
            <div class="analysis-section">
                <div class="section-tag">I. Rangkuman Statistik Penilaian Kelas</div>
                <table class="table-clean" style="font-size: 8pt; margin-bottom: 8px;">
                    <thead>
                        <tr>
                            <th style="width: 28px;">NO</th>
                            <th style="text-align: left; padding-left: 6px;">INDIKATOR STATISTIK</th>
                            <th style="width: 130px;">CAPAIAN NILAI</th>
                            <th style="text-align: left; padding-left: 6px;">KETERANGAN EVALUASI</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="text-center">1</td>
                            <td class="text-left" style="padding-left: 6px;">Total Peserta Didik Terdata</td>
                            <td class="text-center font-bold">${totalSiswa} Siswa</td>
                            <td class="text-left" style="padding-left: 6px;">Jumlah peserta didik terdaftar aktif dalam rombel</td>
                        </tr>
                        <tr>
                            <td class="text-center">2</td>
                            <td class="text-left" style="padding-left: 6px;">Kriteria Ketuntasan Minimal (KKM)</td>
                            <td class="text-center font-bold">${kkmValue}</td>
                            <td class="text-left" style="padding-left: 6px;">Batas acuan ketuntasan minimal kompetensi mapel</td>
                        </tr>
                        <tr>
                            <td class="text-center">3</td>
                            <td class="text-left" style="padding-left: 6px;">Rata-Rata Nilai Tugas (Formatif)</td>
                            <td class="text-center font-bold">${tugasScores.length > 0 ? avgTugasVal : '-'}</td>
                            <td class="text-left" style="padding-left: 6px;">Rata-rata kumulatif penugasan formatif harian</td>
                        </tr>
                        <tr>
                            <td class="text-center">4</td>
                            <td class="text-left" style="padding-left: 6px;">Rata-Rata Nilai Sumatif (Lingkup Materi)</td>
                            <td class="text-center font-bold">${sumatifScores.length > 0 ? avgSumatifVal : '-'}</td>
                            <td class="text-left" style="padding-left: 6px;">Rata-rata evaluasi sumatif tujuan pembelajaran</td>
                        </tr>
                        <tr>
                            <td class="text-center">5</td>
                            <td class="text-left" style="padding-left: 6px;">Rata-Rata Nilai ${semester === '1' ? 'SAS' : 'SAT'}</td>
                            <td class="text-center font-bold">${avgSasVal}</td>
                            <td class="text-left" style="padding-left: 6px;">Evaluasi sumatif akhir semester / akhir tahun</td>
                        </tr>
                        <tr style="background: #eff6ff;">
                            <td class="text-center font-bold">6</td>
                            <td class="text-left font-bold" style="padding-left: 6px;">Rata-Rata Nilai Akhir (NA) Rombel</td>
                            <td class="text-center font-bold" style="color: #1e40af; font-size: 9pt;">${countFinal > 0 ? avgFinalVal : '-'}</td>
                            <td class="text-left font-bold" style="padding-left: 6px;">Rata-rata capaian nilai akhir kelas</td>
                        </tr>
                        <tr>
                            <td class="text-center">7</td>
                            <td class="text-left" style="padding-left: 6px;">Nilai Akhir Tertinggi (Max)</td>
                            <td class="text-center font-bold" style="color: #15803d;">${highestScore >= 0 ? highestScore : '-'}</td>
                            <td class="text-left" style="padding-left: 6px;">Diraih oleh: <b>${esc(highestStudentName)}</b></td>
                        </tr>
                        <tr>
                            <td class="text-center">8</td>
                            <td class="text-left" style="padding-left: 6px;">Nilai Akhir Terendah (Min)</td>
                            <td class="text-center font-bold" style="color: #dc2626;">${lowestScore <= 100 ? lowestScore : '-'}</td>
                            <td class="text-left" style="padding-left: 6px;">Perlu pembimbingan: <b>${esc(lowestStudentName)}</b></td>
                        </tr>
                        <tr>
                            <td class="text-center">9</td>
                            <td class="text-left" style="padding-left: 6px;">Ketuntasan Belajar (&ge; KKM)</td>
                            <td class="text-center font-bold" style="color: #15803d;">${passCount} Siswa (${pctTuntas}%)</td>
                            <td class="text-left" style="padding-left: 6px;">Tuntas memenuhi batas kriteria KKM (${kkmValue})</td>
                        </tr>
                        <tr>
                            <td class="text-center">10</td>
                            <td class="text-left" style="padding-left: 6px;">Peserta Didik Remidial (&lt; KKM)</td>
                            <td class="text-center font-bold" style="color: ${totalRemidi > 0 ? '#dc2626' : '#64748b'};">${totalRemidi} Siswa (${pctRemidi}%)</td>
                            <td class="text-left" style="padding-left: 6px;">Memerlukan intervensi remedial &amp; bimbingan khusus</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- II. ANALISIS DETAIL PER KOMPONEN PENILAIAN -->
            <div class="analysis-section">
                <div class="section-tag">II. Analisis Detail Per Komponen Penilaian</div>
                <table class="table-clean" style="font-size: 7.5pt; margin-bottom: 8px;">
                    <thead>
                        <tr>
                            <th style="width: 24px;">NO</th>
                            <th style="text-align: left; padding-left: 6px;">KOMPONEN</th>
                            <th style="text-align: left; padding-left: 6px; width: 110px;">KATEGORI</th>
                            <th style="width: 48px;">TERISI</th>
                            <th style="width: 44px;">RATA</th>
                            <th style="width: 48px;">MAX</th>
                            <th style="width: 48px;">MIN</th>
                            <th style="width: 48px;">TUNTAS</th>
                            <th style="width: 44px;">% TUNTAS</th>
                            <th style="width: 48px;">REMIDIAL</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${compAnalysisList.map((c, idx) => `
                        <tr>
                            <td class="text-center">${idx + 1}</td>
                            <td class="text-left font-bold" style="padding-left: 6px;">${esc(c.label)}</td>
                            <td class="text-left" style="padding-left: 6px;">${esc(c.category)}</td>
                            <td class="text-center">${c.count}</td>
                            <td class="text-center font-bold">${c.avg}</td>
                            <td class="text-center" style="color: #15803d; font-weight: 700;">${c.maxVal}</td>
                            <td class="text-center" style="color: #dc2626; font-weight: 700;">${c.minVal}</td>
                            <td class="text-center font-bold">${c.pass}</td>
                            <td class="text-center font-bold" style="color: ${c.pctPass >= 75 ? '#15803d' : '#dc2626'};">${c.pctPass}%</td>
                            <td class="text-center ${c.remidial > 0 ? 'score-rem' : ''}">${c.remidial}</td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <!-- III. CATATAN & REKOMENDASI PEDAGOGIS GURU -->
            <div class="analysis-section">
                <div class="section-tag">III. Catatan &amp; Rekomendasi Pedagogis Guru</div>
                <div class="pedagogy-card">
                    <div class="pedagogy-item">
                        <span class="pedagogy-title">&bull; Status Capaian Rombel:</span>
                        <span><b>${esc(statusBadgeText)}</b> &mdash; ${esc(statusHeaderText)} ${esc(mainInsightText)}</span>
                    </div>
                    <div class="pedagogy-item">
                        <span class="pedagogy-title">&bull; Rekomendasi Tindak Lanjut Guru:</span>
                        <span>${esc(pedagogicalActionText)}</span>
                    </div>
                    ${processInsightClean ? `
                    <div class="pedagogy-item">
                        <span class="pedagogy-title">&bull; Evaluasi Disparitas Tugas vs Ujian:</span>
                        <span>${esc(processInsightClean)}</span>
                    </div>` : ''}
                    ${gapInsightClean ? `
                    <div class="pedagogy-item">
                        <span class="pedagogy-title">&bull; Rentang Kesenjangan Nilai Rombel:</span>
                        <span>${esc(gapInsightClean)}</span>
                    </div>` : ''}
                    ${bottleneckInsightClean ? `
                    <div class="pedagogy-item">
                        <span class="pedagogy-title">&bull; Titik Lemah Capaian Materi:</span>
                        <span>${esc(bottleneckInsightClean)}</span>
                    </div>` : ''}
                </div>
            </div>

            <!-- IV. DAFTAR PESERTA DIDIK MEMERLUKAN REMEDIASI -->
            <div class="analysis-section">
                <div class="section-tag">IV. Daftar Peserta Didik Memerlukan Remediasi (&lt; KKM ${kkmValue})</div>
                ${missingFinal > 0 ? `<div class="pedagogy-card"><b>Penilaian belum lengkap:</b> ${missingFinal} siswa belum memiliki nilai akhir. Ketuntasan mereka belum dapat ditentukan.</div>` : ''}
                ${belowKkmFinalStudents.length > 0 ? `
                <table class="table-clean" style="font-size: 7.5pt; margin-bottom: 8px;">
                    <thead>
                        <tr>
                            <th style="width: 28px;">NO</th>
                            <th style="width: 75px;">NIS</th>
                            <th style="text-align: left; padding-left: 6px;">NAMA PESERTA DIDIK</th>
                            <th style="width: 65px;">NILAI AKHIR</th>
                            <th style="text-align: left; padding-left: 6px;">RENCANA TINDAK LANJUT INSTRUSIONAL</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${belowKkmFinalStudents.map((s, sIdx) => `
                        <tr>
                            <td class="text-center">${sIdx + 1}</td>
                            <td class="text-center" style="font-family: monospace;">${esc(s.nis)}</td>
                            <td class="text-left font-bold" style="padding-left: 6px;">${esc(s.name)}</td>
                            <td class="text-center score-rem">${s.score}</td>
                            <td class="text-left" style="padding-left: 6px;">Pembelajaran tutor sebaya dan penugasan ulang kompetensi ${esc(lowestColLabel || 'pokok bahasan')}</td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
                ` : missingFinal === 0 ? `
                <div class="pedagogy-card" style="background: #f0fdf4; border-color: #bbf7d0; color: #166534;">
                    <b>Nir-Remedial:</b> Seluruh peserta didik (${totalSiswa} Siswa) telah tuntas mencapai KKM (${kkmValue}). Tidak ada siswa yang memerlukan program remedial akhir semester.
                </div>
                ` : ''}
            </div>

            <!-- V. LEMBAR PENGESAHAN DOKUMEN RESMI -->
            <div class="sign-container">
                <table class="sign-grid">
                    <tr>
                        <td>
                            <div>Mengetahui,</div>
                            <div class="sign-role">Kepala SMA Negeri Nusantara</div>
                            <div class="sign-space"></div>
                            <div class="sign-name">${esc(SCHOOL_CONFIG.headmasterName)}</div>
                            <div class="sign-nip">${esc(SCHOOL_CONFIG.headmasterRank)}</div>
                            <div class="sign-nip">NIP. ${esc(SCHOOL_CONFIG.headmasterNIP)}</div>
                        </td>
                        <td>
                            <div>${esc(schoolCity)}, ${esc(tglCetak)}</div>
                            <div class="sign-role">Guru Mata Pelajaran,</div>
                            <div class="sign-space"></div>
                            <div class="sign-name">${esc(teacherName)}</div>
                            <div class="sign-nip">${teacherNIP !== '-' ? `NIP. ${esc(teacherNIP)}` : 'Guru Pengampu Mata Pelajaran'}</div>
                        </td>
                    </tr>
                </table>
            </div>

            <script>
                window.onload = function() {
                    setTimeout(function() {
                        window.focus();
                        window.print();
                    }, 350);
                };
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
};
window.printLegerAndAnalytics = window.printGradebookAnalytics;

// =========================================================================
// 13. INTEGRATED KEHADIRAN SISWA DATA (JURNAL MENGAJAR)
// =========================================================================
const STATUS_COLORS_GURU = {
    H: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    S: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    I: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    A: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    D: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    T: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

function extractJournalAttendanceGuru(data) {
    const entries = [];
    if (data.presensi && typeof data.presensi === "object") {
        Object.entries(data.presensi).forEach(([nama, status]) => {
            entries.push({ nama: nama || "-", status: status || "H" });
        });
    }
    if (Array.isArray(data.presensi_detail)) {
        data.presensi_detail.forEach((item) => {
            if (!item || typeof item !== "object") return;
            entries.push({ nama: item.nama || "-", nis: item.nis || "", status: item.status || "H" });
        });
    }
    return entries;
}

function findMatchingNameGuru(masterName, jurnalNames) {
    if (!masterName) return null;
    if (jurnalNames.has(masterName)) return masterName;

    const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const normalizedMaster = norm(masterName);

    for (const jName of jurnalNames) {
        if (norm(jName) === normalizedMaster) return jName;
    }
    return null;
}

function findJournalStatusGuru(pertemuan, row) {
    const byNis = pertemuan.presensiByNis || {};
    const byName = pertemuan.presensi || {};
    const normalizedByName = pertemuan.presensiNormalized || {};

    const normText = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const normNis = (v) => String(v || '').trim();

    const normalizedRowName = normText(row.jurnalName || row.name);
    const normalizedRowNis = normNis(row.nis);

    if (normalizedRowNis && byNis[normalizedRowNis] !== undefined) return byNis[normalizedRowNis];
    if (row.jurnalName && byName[row.jurnalName] !== undefined) return byName[row.jurnalName];
    if (normalizedRowName && normalizedByName[normalizedRowName] !== undefined) return normalizedByName[normalizedRowName];

    return undefined;
}

window.loadKehadiranSiswaData = async function (force = false) {
    console.log('[Kehadiran] loadKehadiranSiswaData() dipanggil (force = ' + force + ')');

    const isCurrentLoad = beginPortalDataLoad('kehadiran');
    let attendanceStudents = loadedStudents;
    const mapel = document.getElementById('select-mapel')?.value;
    const kelas = document.getElementById('select-kelas')?.value;
    const semester = document.getElementById('select-semester')?.value || '1';
    const wrapper = document.getElementById('kehadiran-table-wrapper');

    console.log('[Kehadiran] Filter values:', { mapel, kelas, semester });
    console.log('[Kehadiran] Wrapper element:', wrapper);

    if (!wrapper) {
        console.error('[Kehadiran] ERROR: #kehadiran-table-wrapper tidak ditemukan di DOM!');
        return;
    }

    if (!mapel || !kelas) {
        console.warn('[Kehadiran] Mapel atau Kelas belum dipilih');
        wrapper.innerHTML = `
            <div class="flex flex-col items-center justify-center p-12 text-center">
                <i class="fa-solid fa-user-check text-4xl mb-3 text-emerald-500/50"></i>
                <p class="font-bold text-slate-700 dark:text-slate-200 text-sm">Rekap Kehadiran Siswa</p>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                    Silakan pilih Kelas & Mapel pada filter di atas, lalu klik <b>Load Data</b>.
                </p>
            </div>
        `;
        return;
    }

    if (typeof window.hideKehadiranDateTooltip === 'function') window.hideKehadiranDateTooltip();

    // Tampilkan spinner loading
    wrapper.innerHTML = `
        <div class="text-center py-12">
            <i class="fa-solid fa-spinner fa-spin text-2xl text-emerald-500"></i>
            <p class="text-xs text-slate-400 mt-2">Memuat data rekap presensi kehadiran harian dari Jurnal Mengajar...</p>
        </div>
    `;

    try {
        const tahunAjaran = raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString();
        console.log('[Kehadiran] tahunAjaran:', tahunAjaran);

        // 1. Auto load students if empty
        if (!attendanceStudents || attendanceStudents.length === 0) {
            console.log('[Kehadiran] attendanceStudents kosong, memuat dari Cloudflare D1/cache...');
            const cacheStudentsKey = `cache_students_${tahunAjaran.replace('/', '-')}_${kelas.replace(/\s+/g, '_')}`;
            const cachedStudents = sessionPortalDataCache.get(cacheStudentsKey) || getLocalCache(cacheStudentsKey);

            if (Array.isArray(cachedStudents)) {
                attendanceStudents = cachedStudents;
                console.log('[Kehadiran] Siswa dimuat dari cache:', attendanceStudents.length);
            } else {
                // Prioritaskan cache IndexedDB terpusat (0 Reads)
                let studentsFromCache = null;
                if (typeof window.getStudentsCache === 'function') {
                    try {
                        const allStudents = await window.getStudentsCache();
                        if (allStudents && allStudents.length > 0) {
                            studentsFromCache = allStudents.filter(s => s.class === kelas && s.is_alumni !== true);
                        }
                    } catch (e) { console.warn('[GuruMapel Kehadiran] getStudentsCache error:', e); }
                }

                if (studentsFromCache && studentsFromCache.length > 0) {
                    console.log('[Kehadiran] Siswa dimuat dari IndexedDB (0 Reads):', studentsFromCache.length);
                    attendanceStudents = studentsFromCache;
                } else {
                    try {
                        if (cfClient && cfClient.enabled) {
                            const cfStudents = await cfClient.getStudents({ class: kelas, limit: 100 });
                            if (Array.isArray(cfStudents) && cfStudents.length > 0) {
                                attendanceStudents = cfStudents.filter(s => s.status === 'active' || !s.is_alumni);
                                console.log(`[Kehadiran] Memuat ${attendanceStudents.length} siswa dari Cloudflare D1 (0 Read)`);
                            }
                        }
                    } catch (cfErr) {
                        console.warn('[Kehadiran] Gagal memuat siswa dari Cloudflare D1:', cfErr);
                    }

                    if (!attendanceStudents || attendanceStudents.length === 0) {
                        const allStudents = typeof window.getStudentsCache === 'function' ? await window.getStudentsCache() : [];
                        attendanceStudents = allStudents.filter(s => (s.class === kelas || s.kelas === kelas) && (s.status === 'active' || !s.is_alumni));
                    }
                }

                attendanceStudents.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                if (attendanceStudents.length > 0) {
                    setLocalCache(cacheStudentsKey, attendanceStudents, 24 * 60 * 60 * 1000);
                }
            }
            if (!isCurrentLoad()) return;
            sessionPortalDataCache.set(cacheStudentsKey, attendanceStudents);
        } else {
            console.log('[Kehadiran] attendanceStudents sudah ada:', attendanceStudents.length);
        }

        // 2. Date Range based on Semester & Academic Year
        const parts = tahunAjaran.split("/");
        const year1 = parseInt(parts[0]) || new Date().getFullYear();
        const year2 = parseInt(parts[1]) || year1 + 1;

        let startDate, endDate;
        if (semester === "1") {
            startDate = new Date(year1, 6, 1); // 1 Juli
            endDate = new Date(year1, 11, 31, 23, 59, 59); // 31 Des
        } else {
            startDate = new Date(year2, 0, 1); // 1 Jan
            endDate = new Date(year2, 5, 30, 23, 59, 59); // 30 Juni
        }
        const subtitleText = `Semester ${semester} — TA ${tahunAjaran}`;
        console.log('[Kehadiran] Date range:', startDate.toISOString(), '-', endDate.toISOString());

        // 3. Query Cloudflare D1 Jurnal KBM (Dengan Shared Cache Local 10 Menit)
        const mapelCandidates = mapel ? getMapelNameCandidates(mapel) : [];
        const cacheJurnalKey = `cache_jurnal_${tahunAjaran.replace(/\//g, '-')}_S${semester}_${kelas.replace(/\s+/g, '_')}_${mapel.replace(/\s+/g, '_')}`;
        let cachedRaw = force ? null : (sessionPortalDataCache.get(cacheJurnalKey) || getLocalCache(cacheJurnalKey, 10 * 60 * 1000));
        let docsArray = null;

        if (cachedRaw && Array.isArray(cachedRaw)) {
            sessionPortalDataCache.set(cacheJurnalKey, cachedRaw);
            docsArray = cachedRaw.filter(d => isMapelMatching(d.mapel, mapelCandidates));
            console.log('[Kehadiran] ⚡ Memuat data jurnal dari Cache Local (0 Read!):', docsArray.length);
        } else {
            try {
                if (cfClient && cfClient.enabled) {
                    const startStr = window.getLocalISODate ? window.getLocalISODate(startDate) : startDate.toISOString().split('T')[0];
                    const endStr = window.getLocalISODate ? window.getLocalISODate(endDate) : endDate.toISOString().split('T')[0];
                    const res = await cfClient.getJurnalKbm({
                        kelas: kelas,
                        startDate: startStr,
                        endDate: endStr,
                        limit: 1000
                    });
                    docsArray = (res || [])
                        .filter(d => isMapelMatching(d.mapel, mapelCandidates))
                        .map(d => {
                            const timestampMs = d.tanggal ? new Date(d.tanggal).getTime() : (d.created_at ? new Date(d.created_at).getTime() : Date.now());
                            let presensiDetail = d.presensi_detail;
                            if (typeof presensiDetail === 'string') {
                                try { presensiDetail = JSON.parse(presensiDetail); } catch (e) {}
                            }
                            return {
                                ...d,
                                timestampMs,
                                presensi_detail: presensiDetail || []
                            };
                        });
                } else {
                    docsArray = [];
                }

                setLocalCache(cacheJurnalKey, docsArray, 10 * 60 * 1000);
                if (isCurrentLoad()) sessionPortalDataCache.set(cacheJurnalKey, docsArray);
            } catch (err) {
                console.error('[Kehadiran] Query jurnal error:', err);
                docsArray = [];
            }
        }

        if (!isCurrentLoad()) return;
        loadedStudents = attendanceStudents;
        // 4. Parse data jurnal menjadi pertemuan
        const pertemuanMap = {};
        let totalJurnal = 0;

        docsArray.forEach((data) => {
            totalJurnal++;
            const tgl = getJurnalDateStr(data) || (data.timestampMs ? (typeof window.getLocalISODate === 'function' ? window.getLocalISODate(new Date(data.timestampMs)) : new Date(data.timestampMs).toISOString().split('T')[0]) : '');
            if (!tgl) return;

            const jpStr = formatJpDisplay(data.jp);
            const key = `${tgl}_JP${jpStr}`;
            const attendanceEntries = extractJournalAttendanceGuru(data);

            if (!pertemuanMap[key]) {
                pertemuanMap[key] = {
                    key,
                    tgl,
                    jp: jpStr,
                    presensi: {},
                    presensiByNis: {},
                    presensiNormalized: {},
                    guru: data.guru || "-",
                    topik: data.topik || data.materi || "-",
                    materi: data.materi || data.topik || "-",
                    catatan: data.catatan || "-",
                    lokasi: data.lokasi_mengajar || data.lokasi || "",
                    id: data.id || ""
                };
            } else {
                if ((!pertemuanMap[key].topik || pertemuanMap[key].topik === '-') && (data.topik || data.materi)) {
                    pertemuanMap[key].topik = data.topik || data.materi;
                    pertemuanMap[key].materi = data.materi || data.topik;
                }
                if ((!pertemuanMap[key].catatan || pertemuanMap[key].catatan === '-') && data.catatan) {
                    pertemuanMap[key].catatan = data.catatan;
                }
                if (!pertemuanMap[key].id && data.id) {
                    pertemuanMap[key].id = data.id;
                }
                if (!pertemuanMap[key].lokasi && (data.lokasi_mengajar || data.lokasi)) {
                    pertemuanMap[key].lokasi = data.lokasi_mengajar || data.lokasi;
                }
            }

            if (attendanceEntries.length > 0) {
                attendanceEntries.forEach((item) => {
                    const st = item.status || "H";
                    const nm = item.nama || "-";
                    const nis = String(item.nis || '').trim();

                    pertemuanMap[key].presensi[nm] = st;
                    const normNm = String(nm).trim().replace(/\s+/g, ' ').toLowerCase();
                    if (normNm) pertemuanMap[key].presensiNormalized[normNm] = st;
                    if (nis) pertemuanMap[key].presensiByNis[nis] = st;
                });
            }
        });

        const pertemuanKeys = Object.keys(pertemuanMap).sort();
        window._lastKehadiranPertemuanMap = pertemuanMap;
        console.log('[Kehadiran] Total jurnal:', totalJurnal, '| Pertemuan unik:', pertemuanKeys.length);
        previouslyLoadedPortalTabs.add('kehadiran');
        currentLoadedKehadiranScope = `${tahunAjaran}_${semester}_${kelas}_${mapel}`;

        if (pertemuanKeys.length === 0) {
            window._lastKehadiranRekapData = [];
            window._lastKehadiranPertemuanMap = {};
            if (typeof window.hideKehadiranDateTooltip === 'function') window.hideKehadiranDateTooltip();
            wrapper.innerHTML = `
                <div class="text-center text-slate-400 py-12">
                    <i class="fa-solid fa-inbox text-3xl mb-2"></i>
                    <p class="text-sm font-bold text-slate-700 dark:text-slate-200">Tidak ada data presensi KBM untuk periode ini.</p>
                    <p class="text-xs text-slate-400 mt-1">Pastikan Jurnal Mengajar untuk kelas <b>${escapeHTML(kelas)}</b> mapel <b>${escapeHTML(mapel)}</b> telah diisi di periode ini.</p>
                    <p class="text-xs text-slate-500 mt-2">Rentang: ${subtitleText}</p>
                </div>
            `;
            return;
        }

        // 5. Build Rekap Data
        const allNamesFromJurnal = new Set();
        pertemuanKeys.forEach(k => {
            Object.keys(pertemuanMap[k].presensi).forEach(n => allNamesFromJurnal.add(n));
        });

        const rows = [];
        const matchedNames = new Set();

        attendanceStudents.forEach(s => {
            const jName = findMatchingNameGuru(s.name, allNamesFromJurnal);
            if (jName) matchedNames.add(jName);
            rows.push({ nis: s.nis, nisn: s.nisn || '-', name: s.name, jurnalName: jName || s.name });
        });

        allNamesFromJurnal.forEach(n => {
            if (!matchedNames.has(n)) {
                rows.push({ nis: '-', nisn: '-', name: n, jurnalName: n });
            }
        });

        rows.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id'));

        const rekapData = rows.map(row => {
            const totals = { H: 0, S: 0, I: 0, A: 0, D: 0, T: 0 };
            const pertemuan = [];

            pertemuanKeys.forEach(k => {
                const st = findJournalStatusGuru(pertemuanMap[k], row);
                let finalSt = (st !== undefined && st !== "") ? st : "H";
                if (totals[finalSt] !== undefined) totals[finalSt]++;
                pertemuan.push(finalSt);
            });

            return { nis: row.nis, nisn: row.nisn, name: row.name, pertemuan, totals };
        });

        window._lastKehadiranRekapData = rekapData;
        console.log('[Kehadiran] rekapData built, jumlah baris:', rekapData.length);

        // 7. Render Attendance Grid Table
        let thDates = '';
        pertemuanKeys.forEach((k, idx) => {
            const pt = pertemuanMap[k];
            const parts = (pt.tgl || '').split('-');
            const dayNum = parts.length === 3 ? parseInt(parts[2], 10) : 1;
            const monthNum = parts.length === 3 ? parseInt(parts[1], 10) : 1;
            const jpHtml = pt.jp ? `<div class="text-[8px] font-normal text-slate-200 leading-tight">JP ${escapeHTML(pt.jp)}</div>` : '';
            thDates += `<th class="px-1 py-1.5 text-center text-[10px] font-bold min-w-[28px] sm:min-w-[36px] border border-slate-500 dark:border-slate-600 bg-slate-600 dark:bg-slate-700 hover:bg-slate-500 dark:hover:bg-slate-600 text-white col-presensi-date cursor-pointer transition select-none group"
                onclick="window.showKehadiranDateTooltip(event, '${escapeHTML(k)}', ${idx + 1})"
                title="${pt.tgl} JP ${pt.jp || '-'} • Guru: ${escapeHTML(pt.guru || '-')} • Topik: ${escapeHTML(pt.topik || '-')} (Klik untuk detail materi & catatan)">
                <div class="group-hover:text-emerald-300 font-extrabold transition-colors">${dayNum}/${monthNum}</div>
                ${jpHtml}
            </th>`;
        });

        let tbodyHtml = '';
        rekapData.forEach((r, idx) => {
            let tdDates = '';
            r.pertemuan.forEach(st => {
                let display = '';
                if (st !== 'H' && st !== '-') {
                    const cClass = STATUS_COLORS_GURU[st] || '';
                    display = `<span class="${cClass} px-1 py-0.5 rounded text-[10px] font-bold inline-block">${st}</span>`;
                }
                tdDates += `<td class="px-1 py-1 text-center border border-slate-200 dark:border-slate-800 col-presensi-date">${display}</td>`;
            });

            const t = r.totals;
            const totalHadir = (t.H || 0) + (t.T || 0); // Yang telat tetap terhitung hadir
            const jmlAbsen = (t.S || 0) + (t.I || 0) + (t.A || 0) + (t.D || 0);
            const totalPertemuan = pertemuanKeys.length;
            const persenHadir = totalPertemuan > 0 ? Math.round((totalHadir / totalPertemuan) * 100) : 100;

            tbodyHtml += `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                    <td class="px-2 py-1.5 text-center text-xs font-mono text-slate-400 border border-slate-200 dark:border-slate-800 hidden sm:table-cell col-presensi-no">${idx + 1}</td>
                    <td class="hidden col-presensi-nis">${escapeHTML(r.nis)}</td>
                    <td class="px-2.5 sm:px-3 py-1.5 font-bold text-xs border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 sticky left-0 z-10 bg-white dark:bg-slate-900 col-presensi-nama shadow-[4px_0_6px_-2px_rgba(0,0,0,0.1)] dark:shadow-[4px_0_6px_-2px_rgba(0,0,0,0.4)]">
                        <span class="presensi-student-name" title="${escapeHTML(r.name)}">${escapeHTML(r.name)}</span>
                    </td>
                    ${tdDates}
                    <td class="px-1.5 py-1 text-center text-xs font-bold border border-slate-200 dark:border-slate-800 col-presensi-stat ${t.S > 0 ? 'text-amber-600 dark:text-amber-400 font-extrabold bg-amber-50 dark:bg-amber-900/20' : 'text-slate-300 dark:text-slate-600'}">${t.S}</td>
                    <td class="px-1.5 py-1 text-center text-xs font-bold border border-slate-200 dark:border-slate-800 col-presensi-stat ${t.I > 0 ? 'text-blue-600 dark:text-blue-400 font-extrabold bg-blue-50 dark:bg-blue-900/20' : 'text-slate-300 dark:text-slate-600'}">${t.I}</td>
                    <td class="px-1.5 py-1 text-center text-xs font-bold border border-slate-200 dark:border-slate-800 col-presensi-stat ${t.A > 0 ? 'text-rose-600 dark:text-rose-400 font-extrabold bg-rose-50 dark:bg-rose-900/20' : 'text-slate-300 dark:text-slate-600'}">${t.A}</td>
                    <td class="px-1.5 py-1 text-center text-xs font-bold border border-slate-200 dark:border-slate-800 col-presensi-stat ${t.D > 0 ? 'text-emerald-600 dark:text-emerald-400 font-extrabold bg-emerald-50 dark:bg-emerald-950/20' : 'text-slate-300 dark:text-slate-600'}">${t.D}</td>
                    <td class="px-1.5 py-1 text-center text-xs font-bold border border-slate-200 dark:border-slate-800 col-presensi-stat ${t.T > 0 ? 'text-orange-600 dark:text-orange-400 font-extrabold bg-orange-50 dark:bg-orange-900/20' : 'text-slate-300 dark:text-slate-600'}" title="${t.T > 0 ? t.T + ' kali terlambat (tetap terhitung hadir)' : '0'}">${t.T}</td>
                    <td class="px-1.5 py-1 text-center text-xs font-black border border-slate-300 dark:border-slate-700 col-presensi-stat ${jmlAbsen > 0 ? 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40' : 'text-slate-300 dark:text-slate-600'}" title="Jumlah Ketidakhadiran (S+I+A+D)">${jmlAbsen}</td>
                    <td class="px-1.5 py-1 text-center text-xs font-extrabold border border-slate-200 dark:border-slate-800 col-presensi-stat font-mono ${persenHadir < 80 ? 'text-rose-600 dark:text-rose-400 bg-rose-50/60 dark:bg-rose-950/30' : 'text-emerald-600 dark:text-emerald-400'}" title="${totalHadir} Hadir / ${totalPertemuan} Pertemuan (${persenHadir}%)">${persenHadir}%</td>
                </tr>
            `;
        });

        wrapper.innerHTML = `
            <table class="w-full text-xs text-left border-collapse select-none">
                <thead class="sticky top-0 z-20 shadow-sm">
                    <!-- Baris 1: Header Utama -->
                    <tr class="bg-slate-700 dark:bg-slate-800 text-white">
                        <th rowspan="3" class="px-2 py-2 text-center text-xs font-bold border border-slate-500 dark:border-slate-600 hidden sm:table-cell sticky left-0 bg-slate-700 dark:bg-slate-800 z-30 min-w-[45px]">NO</th>
                        <th rowspan="3" class="hidden col-presensi-nis">NIS</th>
                        <th rowspan="3" class="px-2 sm:px-3 py-2 text-center text-xs font-bold border border-slate-500 dark:border-slate-600 sticky left-0 bg-slate-700 dark:bg-slate-800 z-30 min-w-[110px] sm:min-w-[160px] col-presensi-nama shadow-[4px_0_6px_-2px_rgba(0,0,0,0.1)] dark:shadow-[4px_0_6px_-2px_rgba(0,0,0,0.4)]">NAMA PESERTA DIDIK</th>
                        <th colspan="${pertemuanKeys.length}" class="px-2 py-2 text-center text-[11px] font-bold border border-slate-500 dark:border-slate-600">TANGGAL KEGIATAN PEMBELAJARAN/PERTEMUAN KE -</th>
                        <th colspan="6" rowspan="2" class="px-2 py-2 text-center text-[11px] font-bold border border-slate-500 dark:border-slate-600">RINCIAN KETIDAKHADIRAN</th>
                        <th rowspan="3" class="px-1.5 py-2 text-center text-[11px] font-bold border border-slate-500 dark:border-slate-600 text-emerald-300 col-presensi-stat min-w-[42px]" title="Persentase Kehadiran: (Hadir + Terlambat) ÷ Total Pertemuan × 100%">H%</th>
                    </tr>
                    <!-- Baris 2: Sub-header Tanggal -->
                    <tr class="bg-slate-600 dark:bg-slate-700 text-white">
                        ${thDates}
                    </tr>
                    <!-- Baris 3: Sub-header Pertemuan Ke- & Status -->
                    <tr class="bg-slate-600 dark:bg-slate-700 text-white">
                        ${pertemuanKeys.map((k, i) => `<th class="px-1 py-1 text-center text-[10px] font-bold border border-slate-500 dark:border-slate-600 text-slate-200 hover:text-white hover:bg-slate-500 dark:hover:bg-slate-600 col-presensi-date min-w-[28px] sm:min-w-[34px] cursor-pointer transition select-none"
                            onclick="window.showKehadiranDateTooltip(event, '${escapeHTML(k)}', ${i + 1})"
                            title="Pertemuan ke-${i + 1} (${pertemuanMap[k]?.tgl || ''}): Klik untuk detail materi & catatan">${i + 1}</th>`).join("")}
                        <th class="px-1.5 py-1 text-center text-[11px] font-bold border border-slate-500 dark:border-slate-600 text-yellow-300 col-presensi-stat" title="Sakit">S</th>
                        <th class="px-1.5 py-1 text-center text-[11px] font-bold border border-slate-500 dark:border-slate-600 text-blue-300 col-presensi-stat" title="Izin">I</th>
                        <th class="px-1.5 py-1 text-center text-[11px] font-bold border border-slate-500 dark:border-slate-600 text-red-300 col-presensi-stat" title="Alpha">A</th>
                        <th class="px-1.5 py-1 text-center text-[11px] font-bold border border-slate-500 dark:border-slate-600 text-emerald-300 col-presensi-stat" title="Dispensasi">D</th>
                        <th class="px-1.5 py-1 text-center text-[11px] font-bold border border-slate-500 dark:border-slate-600 text-orange-300 col-presensi-stat" title="Terlambat (Tetap Terhitung Hadir)">T</th>
                        <th class="px-1.5 py-1 text-center text-[11px] font-bold border border-slate-500 dark:border-slate-600 text-white col-presensi-stat" title="Jumlah Ketidakhadiran (S+I+A+D)">JML</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    ${tbodyHtml}
                </tbody>
            </table>
        `;

        wrapper.removeEventListener('scroll', window._onKehadiranScrollDismiss);
        window._onKehadiranScrollDismiss = () => {
            if (typeof window.hideKehadiranDateTooltip === 'function') {
                window.hideKehadiranDateTooltip();
            }
        };
        wrapper.addEventListener('scroll', window._onKehadiranScrollDismiss, { passive: true });

        console.log('[Kehadiran] ✅ Tabel presensi berhasil dirender!');

        const filterBarKeh = document.getElementById('kehadiran-filter-bar');
        if (filterBarKeh) {
            filterBarKeh.classList.remove('hidden');
            filterBarKeh.classList.add('flex');
        }
        const countTextKeh = document.getElementById('kehadiran-count-text');
        if (countTextKeh) {
            countTextKeh.textContent = `${pertemuanKeys.length} Pertemuan (${rekapData.length} Siswa)`;
        }

    } catch (e) {
        if (!isCurrentLoad()) return;
        console.error('[Kehadiran] ERROR FATAL:', e);
        wrapper.innerHTML = `
            <div class="text-center text-rose-500 py-8">
                <i class="fa-solid fa-triangle-exclamation text-3xl mb-2"></i>
                <p class="text-sm font-bold">Gagal memuat presensi</p>
                <p class="text-xs mt-1 text-rose-400">${escapeHTML(e.message || String(e))}</p>
            </div>
        `;
    }
};

// =========================================================================
// 12. TAB 3: DAFTAR JURNAL MENGAJAR (INTEGRASI JURNAL MENGAJAR & FILTER BULAN)
// =========================================================================
let currentJurnalAllList = [];
let selectedJurnalMonth = null;

export function getJurnalMonthKey(data) {
    if (!data) return '';
    if (data.tanggal && typeof data.tanggal === 'string' && /^\d{4}-\d{2}/.test(data.tanggal)) {
        return data.tanggal.substring(0, 7);
    }
    const d = data.timestampMs ? new Date(data.timestampMs) : (data.created_at ? new Date(data.created_at) : (data.timestamp ? new Date(data.timestamp) : null));
    if (d && !isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}`;
    }
    return '';
}

export function getCurrentRunningMonthKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

const INDO_MONTH_NAMES = [
    '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

export function getSemesterMonthsList(tahunAjaran, semester) {
    const parts = (tahunAjaran || '').split('/');
    const year1 = parseInt(parts[0]) || new Date().getFullYear();
    const year2 = parseInt(parts[1]) || (year1 + 1);

    if (String(semester) === '2') {
        return [
            { key: `${year2}-01`, name: 'Januari', year: year2 },
            { key: `${year2}-02`, name: 'Februari', year: year2 },
            { key: `${year2}-03`, name: 'Maret', year: year2 },
            { key: `${year2}-04`, name: 'April', year: year2 },
            { key: `${year2}-05`, name: 'Mei', year: year2 },
            { key: `${year2}-06`, name: 'Juni', year: year2 }
        ];
    }

    return [
        { key: `${year1}-07`, name: 'Juli', year: year1 },
        { key: `${year1}-08`, name: 'Agustus', year: year1 },
        { key: `${year1}-09`, name: 'September', year: year1 },
        { key: `${year1}-10`, name: 'Oktober', year: year1 },
        { key: `${year1}-11`, name: 'November', year: year1 },
        { key: `${year1}-12`, name: 'Desember', year: year1 }
    ];
}

window.loadDaftarJurnalData = async function (force = false) {
    const isCurrentLoad = beginPortalDataLoad('jurnal');
    const mapel = document.getElementById('select-mapel')?.value;
    const kelas = document.getElementById('select-kelas')?.value;
    const semester = document.getElementById('select-semester')?.value || '1';
    const wrapper = document.getElementById('jurnal-table-wrapper');
    const filterBar = document.getElementById('jurnal-filter-bar');

    console.log('[Jurnal] loadDaftarJurnalData() dipanggil (force = ' + force + '):', { mapel, kelas, semester });

    if (!wrapper) {
        console.error('[Jurnal] ERROR: #jurnal-table-wrapper tidak ditemukan!');
        return;
    }

    if (filterBar) {
        filterBar.classList.add('hidden');
        filterBar.classList.remove('flex');
    }

    if (!mapel || !kelas) {
        currentJurnalAllList = [];
        wrapper.innerHTML = `
            <div class="flex flex-col items-center justify-center p-12 text-center text-slate-400">
                <i class="fa-solid fa-book-open text-4xl mb-3 text-emerald-500/50"></i>
                <p class="font-bold text-slate-700 dark:text-slate-200 text-sm">Daftar Jurnal Mengajar</p>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                    Silakan pilih Kelas & Mapel pada filter di atas, lalu klik <b>Load Data</b>.
                </p>
            </div>
        `;
        return;
    }

    wrapper.innerHTML = `
        <div class="text-center py-12">
            <i class="fa-solid fa-spinner fa-spin text-2xl text-emerald-500"></i>
            <p class="text-xs text-slate-400 mt-2">Memuat daftar jurnal mengajar dari Jurnal SMANTARA...</p>
        </div>
    `;

    try {
        const tahunAjaran = raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString();
        const [year1Str, year2Str] = tahunAjaran.split("/");
        const year1 = parseInt(year1Str) || new Date().getFullYear();
        const year2 = parseInt(year2Str) || (year1 + 1);

        let startDate, endDate;
        if (semester === "1") {
            startDate = new Date(year1, 6, 1, 0, 0, 0); // 1 Juli
            endDate = new Date(year1, 11, 31, 23, 59, 59); // 31 Des
        } else {
            startDate = new Date(year2, 0, 1, 0, 0, 0); // 1 Jan
            endDate = new Date(year2, 5, 30, 23, 59, 59); // 30 Juni
        }

        const mapelCandidates = mapel ? getMapelNameCandidates(mapel) : [];

        // Shared 10-minute Local Cache
        const cacheJurnalKey = `cache_jurnal_${tahunAjaran.replace(/\//g, '-')}_S${semester}_${kelas.replace(/\s+/g, '_')}_${mapel.replace(/\s+/g, '_')}`;
        let cachedRaw = force ? null : (sessionPortalDataCache.get(cacheJurnalKey) || getLocalCache(cacheJurnalKey, 10 * 60 * 1000));
        let docsArray = null;

        if (cachedRaw && Array.isArray(cachedRaw)) {
            sessionPortalDataCache.set(cacheJurnalKey, cachedRaw);
            docsArray = cachedRaw.filter(d => isMapelMatching(d.mapel, mapelCandidates));
            console.log('[Jurnal] ⚡ Memuat data jurnal dari Cache Local (0 Firestore Read!):', docsArray.length);
        } else {
            try {
                if (cfClient && cfClient.enabled) {
                    const startStr = window.getLocalISODate ? window.getLocalISODate(startDate) : startDate.toISOString().split('T')[0];
                    const endStr = window.getLocalISODate ? window.getLocalISODate(endDate) : endDate.toISOString().split('T')[0];
                    const res = await cfClient.getJurnalKbm({
                        kelas: kelas,
                        startDate: startStr,
                        endDate: endStr,
                        limit: 1000
                    });
                    docsArray = (res || [])
                        .filter(d => isMapelMatching(d.mapel, mapelCandidates))
                        .map(d => {
                            const timestampMs = d.tanggal ? new Date(d.tanggal).getTime() : (d.created_at ? new Date(d.created_at).getTime() : Date.now());
                            let presensiDetail = d.presensi_detail;
                            if (typeof presensiDetail === 'string') {
                                try { presensiDetail = JSON.parse(presensiDetail); } catch (e) {}
                            }
                            return {
                                ...d,
                                timestampMs,
                                presensi_detail: presensiDetail || []
                            };
                        });
                } else {
                    docsArray = [];
                }

                setLocalCache(cacheJurnalKey, docsArray, 10 * 60 * 1000);
                if (isCurrentLoad()) sessionPortalDataCache.set(cacheJurnalKey, docsArray);
            } catch (err) {
                console.error('[Jurnal] Query jurnal error:', err);
                docsArray = [];
            }
        }

        if (!isCurrentLoad()) return;
        previouslyLoadedPortalTabs.add('jurnal');
        if (!docsArray || docsArray.length === 0) {
            currentJurnalAllList = [];
            currentLoadedJurnalScope = `${tahunAjaran}_${semester}_${kelas}_${mapel}`;
            wrapper.innerHTML = `
                <div class="text-center text-slate-400 py-12">
                    <i class="fa-solid fa-inbox text-3xl mb-2"></i>
                    <p class="text-sm font-bold text-slate-700 dark:text-slate-200">Tidak ada rekam jurnal mengajar untuk filter ini.</p>
                    <p class="text-xs text-slate-400 mt-1">Belum ada jurnal mengajar yang diinput di kelas <b>${escapeHTML(kelas)}</b> mapel <b>${escapeHTML(mapel)}</b>.</p>
                </div>
            `;
            return;
        }

        loadedJurnalDocsMap = {};
        const jurnalList = [];
        docsArray.forEach(data => {
            loadedJurnalDocsMap[data.id] = data;
            const d = data.timestampMs ? new Date(data.timestampMs) : new Date();
            const tanggalStr = d.toLocaleDateString("id-ID", {
                weekday: "short",
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit"
            });

            const jpStr = formatJpDisplay(data.jp);

            const tdkHadirArray = [];
            if (data.presensi_detail && Array.isArray(data.presensi_detail)) {
                data.presensi_detail.forEach(item => {
                    if (item.status !== "H" && item.status !== "") {
                        tdkHadirArray.push({ nama: item.nama || item.nis || "-", status: item.status });
                    }
                });
            } else if (data.presensi && typeof data.presensi === "object") {
                Object.entries(data.presensi).forEach(([nama, st]) => {
                    if (st !== "H" && st !== "") {
                        tdkHadirArray.push({ nama: nama, status: st });
                    }
                });
            }

            const monthKey = getJurnalMonthKey(data);

            jurnalList.push({
                id: data.id,
                timestamp: d.getTime(),
                monthKey: monthKey,
                waktuStr: tanggalStr,
                kelas: data.kelas || kelas,
                mapel: data.mapel || mapel,
                guru: data.guru || "-",
                jp: jpStr,
                topik: data.topik || data.materi || "-",
                catatan: data.catatan || "-",
                foto_url: data.foto_url || "",
                absen: tdkHadirArray
            });
        });

        // Sort descending by timestamp (terbaru di atas)
        jurnalList.sort((a, b) => b.timestamp - a.timestamp);
        currentJurnalAllList = jurnalList;

        // Inisialisasi Filter Bulan: Default ke Bulan Berjalan
        const semesterMonths = getSemesterMonthsList(tahunAjaran, semester);
        const nowMonthKey = getCurrentRunningMonthKey();
        const isNowInSemester = semesterMonths.some(m => m.key === nowMonthKey);

        // Jika belum dipilih atau pilihan sebelumnya tidak valid untuk semester ini, default ke bulan berjalan
        if (!selectedJurnalMonth || (selectedJurnalMonth !== 'all' && !semesterMonths.some(m => m.key === selectedJurnalMonth))) {
            selectedJurnalMonth = isNowInSemester ? nowMonthKey : 'all';
        }

        // Render Opsi Dropdown Bulan
        const selectMonthEl = document.getElementById('select-jurnal-month');
        if (selectMonthEl) {
            let optionsHtml = '';
            
            // Opsi 1: Semua Bulan
            optionsHtml += `<option value="all" ${selectedJurnalMonth === 'all' ? 'selected' : ''}>Semua Bulan (Semester ${escapeHTML(semester)}) - ${currentJurnalAllList.length} Jurnal</option>`;
            
            // Opsi per Bulan dalam Semester Aktif
            semesterMonths.forEach(m => {
                const countInMonth = currentJurnalAllList.filter(j => j.monthKey === m.key).length;
                const isRunningMonth = m.key === nowMonthKey;
                const runningTag = isRunningMonth ? ' (Bulan Berjalan)' : '';
                const isSelected = selectedJurnalMonth === m.key ? 'selected' : '';
                optionsHtml += `<option value="${escapeHTML(m.key)}" ${isSelected}>${escapeHTML(m.name)} ${escapeHTML(String(m.year))}${runningTag} - ${countInMonth} Jurnal</option>`;
            });

            selectMonthEl.innerHTML = optionsHtml;
            selectMonthEl.value = selectedJurnalMonth;
        }

        // Tampilkan filter bar saat data jurnal siap
        if (filterBar) {
            filterBar.classList.remove('hidden');
            filterBar.classList.add('flex');
        }

        // Render tabel jurnal sesuai bulan terpilih
        window.renderDaftarJurnalTable();
        currentLoadedJurnalScope = `${tahunAjaran}_${semester}_${kelas}_${mapel}`;

    } catch (e) {
        if (!isCurrentLoad()) return;
        console.error('[Jurnal] ERROR FATAL:', e);
        if (filterBar) {
            filterBar.classList.add('hidden');
            filterBar.classList.remove('flex');
        }
        wrapper.innerHTML = `
            <div class="text-center text-rose-500 py-8">
                <i class="fa-solid fa-triangle-exclamation text-3xl mb-2"></i>
                <p class="text-sm font-bold">Gagal memuat daftar jurnal</p>
                <p class="text-xs mt-1 text-rose-400">${escapeHTML(e.message || String(e))}</p>
            </div>
        `;
    }
};

window.renderDaftarJurnalTable = function () {
    const wrapper = document.getElementById('jurnal-table-wrapper');
    if (!wrapper) return;

    const kelas = document.getElementById('select-kelas')?.value || '';
    const mapel = document.getElementById('select-mapel')?.value || '';
    const semester = document.getElementById('select-semester')?.value || '1';

    // ⚡ FILTER SECARA FISIK: HANYA JURNAL BULAN TERPILIH YANG MASUK KE ARRAY RENDER
    // Ini menjamin tag <img> HANYA dibuat untuk jurnal bulan terpilih, sehingga browser TIDAK PERNAH merequest foto bulan lain ke Google Drive!
    let filteredList = currentJurnalAllList;
    if (selectedJurnalMonth && selectedJurnalMonth !== 'all') {
        filteredList = currentJurnalAllList.filter(j => j.monthKey === selectedJurnalMonth);
    }

    // Perbarui badge counter jurnal
    const countText = document.getElementById('jurnal-count-text');
    if (countText) {
        if (selectedJurnalMonth && selectedJurnalMonth !== 'all') {
            const [y, m] = selectedJurnalMonth.split('-');
            const mName = INDO_MONTH_NAMES[parseInt(m, 10)] || m;
            countText.textContent = `${filteredList.length} Jurnal (${mName} ${y})`;
        } else {
            countText.textContent = `${filteredList.length} Jurnal (Semua)`;
        }
    }

    // Jika bulan yang dipilih tidak memiliki data jurnal
    if (!filteredList || filteredList.length === 0) {
        let periodName = 'periode ini';
        if (selectedJurnalMonth && selectedJurnalMonth !== 'all') {
            const [y, m] = selectedJurnalMonth.split('-');
            const mName = INDO_MONTH_NAMES[parseInt(m, 10)] || m;
            periodName = `bulan ${mName} ${y}`;
        }
        wrapper.innerHTML = `
            <div class="text-center text-slate-400 py-12">
                <i class="fa-solid fa-calendar-xmark text-3xl mb-2 text-slate-300 dark:text-slate-600"></i>
                <p class="text-sm font-bold text-slate-700 dark:text-slate-200">Tidak ada jurnal mengajar pada ${periodName}</p>
                <p class="text-xs text-slate-400 mt-1">Belum ada catatan jurnal KBM di kelas <b>${escapeHTML(kelas)}</b> mapel <b>${escapeHTML(mapel)}</b> untuk ${periodName}.</p>
                <button type="button" onclick="window.onJurnalMonthChange('all')"
                    class="mt-3 px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl border border-slate-300 dark:border-slate-700 transition active:scale-95 shadow-2xs inline-flex items-center gap-1.5 cursor-pointer">
                    <i class="fa-solid fa-list-ul text-emerald-500"></i>
                    <span>Tampilkan Semua Bulan (${currentJurnalAllList.length} Jurnal)</span>
                </button>
            </div>
        `;
        return;
    }

    let rowsHtml = '';
    filteredList.forEach((j, idx) => {
        let fotoHtml = '-';
        if (j.foto_url && j.foto_url.length > 5) {
            fotoHtml = `
                <div class="w-10 h-10 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 shadow-2xs mx-auto group">
                    <a href="${escapeHTML(j.foto_url)}" target="_blank" rel="noopener noreferrer" title="Buka foto kegiatan">
                        <img src="${escapeHTML(j.foto_url)}" class="w-full h-full object-cover group-hover:scale-110 transition cursor-zoom-in" alt="Foto Jurnal" loading="lazy" decoding="async">
                    </a>
                </div>
            `;
        } else {
            fotoHtml = `
                <div class="w-10 h-10 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 mx-auto flex items-center justify-center text-slate-300 dark:text-slate-600" title="Tidak ada foto">
                    <i class="fa-solid fa-camera text-xs"></i>
                </div>
            `;
        }

        let absenHtml = '-';
        if (j.absen && j.absen.length > 0) {
            const rincian = j.absen.map(a => {
                const cCls = STATUS_COLORS_GURU[a.status] || 'bg-rose-100 text-rose-700';
                return `
                    <div class="flex items-center justify-between py-1 border-b border-rose-100 dark:border-rose-900/30 last:border-0 text-[11px]">
                        <span class="truncate font-semibold text-slate-700 dark:text-slate-200">${escapeHTML(a.nama)}</span>
                        <span class="${cCls} px-1.5 py-0.2 rounded text-[9px] font-extrabold ml-2">${escapeHTML(a.status)}</span>
                    </div>
                `;
            }).join('');

            absenHtml = `
                <details class="group cursor-pointer">
                    <summary class="font-bold flex items-center justify-between p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200/70 dark:border-rose-800/60 list-none outline-none text-rose-700 dark:text-rose-300 text-xs">
                        <span class="flex items-center gap-1.5"><i class="fa-solid fa-user-minus text-[10px]"></i> ${j.absen.length} Tidak Hadir</span>
                        <i class="fa-solid fa-chevron-down text-[9px] transition-transform group-open:rotate-180"></i>
                    </summary>
                    <div class="mt-1.5 pl-2 border-l-2 border-rose-300 dark:border-rose-700">
                        ${rincian}
                    </div>
                </details>
            `;
        } else {
            absenHtml = `<span class="text-emerald-600 dark:text-emerald-400 font-bold text-xs flex items-center gap-1 justify-center"><i class="fa-solid fa-circle-check text-[10px]"></i> Hadir Semua</span>`;
        }

        rowsHtml += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 transition-colors text-xs">
                <td class="p-3 text-center font-mono text-slate-400 border-r border-slate-200 dark:border-slate-800">${idx + 1}</td>
                <td class="p-3 whitespace-nowrap">
                    <div class="hidden sm:flex font-bold text-slate-800 dark:text-slate-100 items-center gap-1.5 mb-1">
                        <i class="fa-regular fa-calendar-check text-emerald-600"></i> ${escapeHTML(j.waktuStr)}
                    </div>
                    <div class="flex items-center gap-1.5">
                        <span class="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded font-extrabold border border-slate-200 dark:border-slate-700 text-[10px]">${escapeHTML(j.kelas)}</span>
                        <span class="bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded font-extrabold border border-emerald-200 dark:border-emerald-800 text-[10px]">JP ${escapeHTML(j.jp)}</span>
                    </div>
                </td>
                <td class="p-3 hidden sm:table-cell">
                    <div class="font-bold text-slate-800 dark:text-slate-100 mb-0.5">${escapeHTML(j.guru)}</div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400 font-medium">${escapeHTML(j.mapel)}</div>
                </td>
                <td class="p-3 max-w-[260px]">
                    <div class="font-bold text-slate-800 dark:text-slate-100 mb-0.5 leading-snug">${escapeHTML(j.topik)}</div>
                    ${j.catatan !== '-' ? `<div class="text-[10px] text-slate-400 dark:text-slate-500 italic mt-0.5 truncate" title="${escapeHTML(j.catatan)}"><i class="fa-regular fa-comment mr-1"></i>${escapeHTML(j.catatan)}</div>` : ''}
                </td>
                <td class="p-3 text-center w-16">${fotoHtml}</td>
                <td class="p-3 w-56 align-top">${absenHtml}</td>
                <td class="p-3 text-center w-24 border-l border-slate-200 dark:border-slate-800">
                    <button onclick="window.openEditJurnalModal('${escapeHTML(j.id)}')"
                            title="${String(j.id).startsWith('lmsj_') ? 'Edit kehadiran pada jurnal tersimpan dan tanda tangani ulang' : 'Edit Jurnal Mengajar'}"
                            class="px-2.5 py-1 text-xs font-bold text-amber-700 dark:text-amber-300 hover:text-white bg-amber-100 hover:bg-amber-600 dark:bg-amber-950/60 dark:hover:bg-amber-600 border border-amber-300 dark:border-amber-700 rounded-lg transition active:scale-95 shadow-2xs inline-flex items-center gap-1">
                        <i class="fa-solid fa-pen-to-square text-[10px]"></i>
                        <span>${String(j.id).startsWith('lmsj_') ? 'Edit Kehadiran' : 'Edit'}</span>
                    </button>
                </td>
            </tr>
        `;
    });

    wrapper.innerHTML = `
        <table class="w-full text-xs text-left border-collapse select-none">
            <thead class="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 uppercase font-bold sticky top-0 z-20 shadow-sm border-b border-slate-200 dark:border-slate-700 text-[11px]">
                <tr>
                    <th class="p-3 text-center border border-slate-300 dark:border-slate-700 w-10">No</th>
                    <th class="p-3 border border-slate-300 dark:border-slate-700 min-w-[90px] sm:min-w-[170px]">Waktu & JP</th>
                    <th class="p-3 border border-slate-300 dark:border-slate-700 min-w-[150px] hidden sm:table-cell">Guru Pengampu</th>
                    <th class="p-3 border border-slate-300 dark:border-slate-700 min-w-[220px]">Materi & Topik Pembelajaran</th>
                    <th class="p-3 text-center border border-slate-300 dark:border-slate-700 w-16">Foto</th>
                    <th class="p-3 border border-slate-300 dark:border-slate-700 min-w-[180px]">Presensi Siswa</th>
                    <th class="p-3 text-center border border-slate-300 dark:border-slate-700 w-24">Aksi</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                ${rowsHtml}
            </tbody>
        </table>
    `;

    console.log('[Jurnal] ✅ Daftar jurnal berhasil dirender untuk periode:', selectedJurnalMonth || 'all', `(${filteredList.length} jurnal)`);
};

window.onJurnalMonthChange = function (newMonthKey) {
    selectedJurnalMonth = newMonthKey;
    const sel = document.getElementById('select-jurnal-month');
    if (sel && sel.value !== newMonthKey) {
        sel.value = newMonthKey;
    }
    window.renderDaftarJurnalTable();
};

// =========================================================================
// 14. MODAL SNAPSHOT DETAIL & CATATAN SISWA 3-IN-1 (SUPABASE INTEGRATED)
// =========================================================================
let currentDetailStudentNis = null;

window.openStudentDetailModal = function (studentNis) {
    const student = loadedStudents.find(s => s.nis === studentNis);
    if (!student) {
        showToast('Peringatan', 'Data siswa tidak ditemukan.', 'warning');
        return;
    }

    currentDetailStudentNis = studentNis;

    const mapel = document.getElementById('select-mapel')?.value || 'Mapel';
    const kelas = document.getElementById('select-kelas')?.value || 'Kelas';
    const semester = document.getElementById('select-semester')?.value || '1';

    // 1. Populate Header Info
    const nameElem = document.getElementById('detail-student-name');
    const classElem = document.getElementById('detail-student-class');
    const infoElem = document.getElementById('detail-student-info');

    if (nameElem) nameElem.textContent = student.name;
    if (classElem) classElem.textContent = kelas;
    if (infoElem) infoElem.textContent = `NIS: ${student.nis} • NISN: ${student.nisn || '-'} • Mapel: ${mapel} (Smt ${semester})`;

    // 2. Find row values from DOM table
    const row = document.querySelector(`#gradebook-tbody tr[data-nis="${studentNis}"]`);
    let valTugas = '-';
    let valSumatif = '-';
    let valFinal = '-';
    let valExam = '-';

    if (row) {
        valTugas = row.querySelector('.cell-tugas-avg')?.textContent.trim() || '-';
        valSumatif = row.querySelector('.cell-sumatif-avg')?.textContent.trim() || '-';
        valFinal = row.querySelector('.cell-final-score')?.textContent.trim() || '-';

        const examInput = row.querySelector('input[data-col-type="sas"], input[data-col-type="sat"]');
        if (examInput && examInput.value.trim() !== '') {
            valExam = examInput.value.trim();
        }
    }

    const elemTugas = document.getElementById('detail-val-tugas');
    const elemSumatif = document.getElementById('detail-val-sumatif');
    const elemExam = document.getElementById('detail-val-exam');
    const elemFinal = document.getElementById('detail-val-final');
    const elemKkmStatus = document.getElementById('detail-kkm-status');

    if (elemTugas) elemTugas.textContent = valTugas;
    if (elemSumatif) elemSumatif.textContent = valSumatif;
    if (elemExam) elemExam.textContent = valExam;
    if (elemFinal) elemFinal.textContent = valFinal;

    const finalNum = parseFloat(valFinal);
    if (!isNaN(finalNum)) {
        if (finalNum >= kkmValue) {
            if (elemKkmStatus) {
                elemKkmStatus.className = 'px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300/40';
                elemKkmStatus.textContent = `Tuntas (KKM ${kkmValue})`;
            }
        } else {
            if (elemKkmStatus) {
                elemKkmStatus.className = 'px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300/40';
                elemKkmStatus.textContent = `Perlu Bimbingan (KKM ${kkmValue})`;
            }
        }
    } else {
        if (elemKkmStatus) {
            elemKkmStatus.className = 'px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300/40';
            elemKkmStatus.textContent = `Belum Ada Nilai (KKM ${kkmValue})`;
        }
    }

    // 3. Populate Attendance Totals from Kehadiran memory / DOM
    let h = 0, s = 0, i = 0, a = 0, d = 0, t = 0;
    const rekapStudent = (window._lastKehadiranRekapData || []).find(r => String(r.nis || '').trim() === String(studentNis || '').trim() || r.name === student?.name);
    if (rekapStudent) {
        h = rekapStudent.totals.H || 0;
        s = rekapStudent.totals.S || 0;
        i = rekapStudent.totals.I || 0;
        a = rekapStudent.totals.A || 0;
        d = rekapStudent.totals.D || 0;
        t = rekapStudent.totals.T || 0;
    } else {
        const kehTable = document.querySelector('#kehadiran-table-wrapper table');
        if (kehTable) {
            const kehRows = kehTable.querySelectorAll('tbody tr');
            kehRows.forEach(tr => {
                const nisCell = tr.children[1]?.textContent.trim();
                if (nisCell === studentNis || tr.children[2]?.textContent.trim() === student?.name) {
                    const cells = tr.children;
                    const totalCells = cells.length;
                    if (totalCells >= 7) {
                        s = parseInt(cells[totalCells - 6]?.textContent) || 0;
                        i = parseInt(cells[totalCells - 5]?.textContent) || 0;
                        a = parseInt(cells[totalCells - 4]?.textContent) || 0;
                        d = parseInt(cells[totalCells - 3]?.textContent) || 0;
                        t = parseInt(cells[totalCells - 2]?.textContent) || 0;
                    }
                }
            });
        }
    }

    const elemH = document.getElementById('detail-presensi-h');
    const elemS = document.getElementById('detail-presensi-s');
    const elemI = document.getElementById('detail-presensi-i');
    const elemA = document.getElementById('detail-presensi-a');
    const elemD = document.getElementById('detail-presensi-d');
    const elemT = document.getElementById('detail-presensi-t');
    const elemPct = document.getElementById('detail-presensi-pct');

    const totalHadir = h + t; // Yang telat tetap terhitung hadir
    const totalAbsen = s + i + a + d; // Hanya S, I, A, D yang dihitung absen
    const totalMeetings = totalHadir + totalAbsen;
    const pct = totalMeetings > 0 ? ((totalHadir / totalMeetings) * 100).toFixed(1) : '100';

    if (elemH) elemH.textContent = `${pct}%`;
    if (elemS) elemS.textContent = s;
    if (elemI) elemI.textContent = i;
    if (elemA) elemA.textContent = a;
    if (elemD) elemD.textContent = d;
    if (elemT) elemT.textContent = t;
    if (elemPct) elemPct.textContent = `${totalHadir} Hadir / ${totalMeetings} Pertemuan`;

    // 4. Populate Teacher Notes from existingSummariesMap[studentNis]
    const existingSummary = existingSummariesMap[studentNis] || {};
    const inputApresiasi = document.getElementById('input-note-apresiasi');
    const inputPerilaku = document.getElementById('input-note-perilaku');
    const inputEvaluasi = document.getElementById('input-note-evaluasi');

    if (inputApresiasi) inputApresiasi.value = existingSummary.catatan_apresiasi || '';
    if (inputPerilaku) inputPerilaku.value = existingSummary.catatan_perilaku || '';
    if (inputEvaluasi) inputEvaluasi.value = existingSummary.catatan_evaluasi || '';

    // Show Modal
    const modal = document.getElementById('modal-student-detail');
    if (modal) modal.classList.remove('hidden');
};

window.closeStudentDetailModal = function () {
    const modal = document.getElementById('modal-student-detail');
    if (modal) modal.classList.add('hidden');
    currentDetailStudentNis = null;
};

window.saveStudentNotes = async function () {
    if (!currentDetailStudentNis) {
        showToast('Peringatan', 'Tidak ada siswa yang dipilih.', 'warning');
        return;
    }

    const mapel = document.getElementById('select-mapel')?.value;
    const kelas = document.getElementById('select-kelas')?.value;
    const semester = document.getElementById('select-semester')?.value || '1';
    const tahunAjaran = raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString();

    if (!mapel || !kelas) {
        showToast('Peringatan', 'Pilih Kelas dan Mapel terlebih dahulu.', 'warning');
        return;
    }

    const valApresiasi = document.getElementById('input-note-apresiasi')?.value.trim() || '';
    const valPerilaku = document.getElementById('input-note-perilaku')?.value.trim() || '';
    const valEvaluasi = document.getElementById('input-note-evaluasi')?.value.trim() || '';

    const btnSave = document.getElementById('btn-save-student-notes');
    if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    }

    try {
        const gradebookId = `${tahunAjaran.replace('/', '-')}_S${semester}_${kelas.replace(/\s+/g, '_')}_${mapel.replace(/\s+/g, '_')}`;

        const existingSummary = existingSummariesMap[currentDetailStudentNis] || {};

        const summaryPayload = {
            gradebook_id: gradebookId,
            student_nis: currentDetailStudentNis,
            catatan_apresiasi: valApresiasi,
            catatan_perilaku: valPerilaku,
            catatan_evaluasi: valEvaluasi,
            updated_at: new Date().toISOString()
        };

        if (existingSummary.tugas_avg !== undefined) summaryPayload.tugas_avg = existingSummary.tugas_avg;
        if (existingSummary.sumatif_avg !== undefined) summaryPayload.sumatif_avg = existingSummary.sumatif_avg;
        if (existingSummary.sas_sat_score !== undefined) summaryPayload.sas_sat_score = existingSummary.sas_sat_score;
        if (existingSummary.final_score !== undefined) summaryPayload.final_score = existingSummary.final_score;
        if (existingSummary.deskripsi_cp !== undefined) summaryPayload.deskripsi_cp = existingSummary.deskripsi_cp;

        let savedSummaryId = existingSummary.id;

        if (supabase) {
            // 1. Pastikan record master gradebook ada di database untuk memenuhi foreign key constraint (fk_summaries_gradebook)
            const { error: gbErr } = await supabase
                .from('guru_mapel_gradebooks')
                .upsert({
                    id: gradebookId,
                    tahun_ajaran: tahunAjaran,
                    semester: semester,
                    class_id: kelas,
                    subject_id: mapel,
                    teacher_nip: currentUserNip,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'id' });

            if (gbErr) throw gbErr;

            // 2. Upsert catatan ringkasan siswa
            const { data: sumData, error: sumErr } = await supabase
                .from('guru_mapel_summaries')
                .upsert([summaryPayload], { onConflict: 'gradebook_id,student_nis' })
                .select('id, student_nis, gradebook_id, catatan_apresiasi, catatan_perilaku, catatan_evaluasi');

            if (sumErr) throw sumErr;
            if (sumData && sumData.length > 0 && sumData[0].id) {
                savedSummaryId = sumData[0].id;
            }
        }

        // Update local state map
        existingSummariesMap[currentDetailStudentNis] = {
            ...existingSummary,
            ...(savedSummaryId ? { id: savedSummaryId } : {}),
            catatan_apresiasi: valApresiasi,
            catatan_perilaku: valPerilaku,
            catatan_evaluasi: valEvaluasi
        };

        // Re-render main gradebook table to update note indicator badge
        renderGradebookTable(semester);

        showToast('Catatan Tersimpan', 'Catatan guru mapel berhasil disimpan.', 'success');
        window.closeStudentDetailModal();

    } catch (e) {
        console.error('[Portal Guru Mapel] Error saving student notes:', e);
        showModernAlert('Gagal Menyimpan Catatan', e.message || String(e), 'error');
    } finally {
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> <span>Simpan Catatan Siswa</span>';
        }
    }
};

// =========================================================================
// 15. EDIT JURNAL MENGAJAR (FIRESTORE JURNAL_GURU INTEGRATED)
// =========================================================================
let currentEditingJurnalId = null;
let loadedJurnalDocsMap = {};

window.openEditJurnalModal = function (jurnalId) {
    if (String(jurnalId).startsWith('lmsj_')) { window.openLmsJournalEntry(jurnalId); return; }
    const data = loadedJurnalDocsMap[jurnalId];
    if (!data) {
        showToast('Peringatan', 'Data jurnal tidak ditemukan!', 'warning');
        return;
    }

    currentEditingJurnalId = jurnalId;

    const modal = document.getElementById('modal-edit-jurnal');
    const card = document.getElementById('modal-edit-jurnal-card');
    const titleEl = document.getElementById('edit-jurnal-modal-title');
    const waktuEl = document.getElementById('edit-jurnal-waktu-str');
    const badgeKelas = document.getElementById('edit-jurnal-badge-kelas');
    const badgeMapel = document.getElementById('edit-jurnal-badge-mapel');
    const inputJp = document.getElementById('input-edit-jurnal-jp');
    const inputTopik = document.getElementById('input-edit-jurnal-topik');
    const txtCatatan = document.getElementById('textarea-edit-jurnal-catatan');
    const presensiContainer = document.getElementById('edit-jurnal-presensi-list');

    if (!modal || !card) return;

    const d = data.timestampMs ? new Date(data.timestampMs) : new Date();
    const waktuStr = d.toLocaleDateString("id-ID", {
        weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    });

    const jpStr = formatJpDisplay(data.jp);

    if (titleEl) titleEl.textContent = `Edit Jurnal - ${data.kelas || '-'} (${data.mapel || '-'})`;
    if (waktuEl) waktuEl.textContent = waktuStr;
    if (badgeKelas) badgeKelas.textContent = data.kelas || '-';
    if (badgeMapel) badgeMapel.textContent = data.mapel || '-';
    if (inputJp) inputJp.value = jpStr;
    if (inputTopik) inputTopik.value = data.topik || data.materi || '';
    if (txtCatatan) txtCatatan.value = data.catatan && data.catatan !== '-' ? data.catatan : '';

    // Render Student Presence Editor
    let presensiMap = {};
    if (data.presensi_detail && Array.isArray(data.presensi_detail)) {
        data.presensi_detail.forEach(item => {
            const key = item.nama || item.nis;
            if (key) presensiMap[key] = item.status || 'H';
        });
    } else if (data.presensi && typeof data.presensi === 'object') {
        presensiMap = { ...data.presensi };
    }

    // Jika presensiMap kosong, isi dari loadedStudents
    if (Object.keys(presensiMap).length === 0 && loadedStudents.length > 0) {
        loadedStudents.forEach(s => {
            presensiMap[s.name] = 'H';
        });
    }

    let presensiHTML = '';
    const studentNames = Object.keys(presensiMap);
    studentNames.forEach((nama, idx) => {
        const currentSt = presensiMap[nama] || 'H';
        presensiHTML += `
            <div class="p-2 flex items-center justify-between gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition" data-student-name="${escapeHTML(nama)}">
                <span class="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[200px]">${idx + 1}. ${escapeHTML(nama)}</span>
                <div class="flex items-center gap-1 shrink-0">
                    ${['H', 'I', 'S', 'A', 'D'].map(st => {
                        let activeCls = 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
                        if (currentSt === st) {
                            if (st === 'H') activeCls = 'bg-emerald-600 text-white font-extrabold shadow-2xs';
                            else if (st === 'I') activeCls = 'bg-blue-600 text-white font-extrabold shadow-2xs';
                            else if (st === 'S') activeCls = 'bg-amber-600 text-white font-extrabold shadow-2xs';
                            else if (st === 'A') activeCls = 'bg-rose-600 text-white font-extrabold shadow-2xs';
                            else if (st === 'D') activeCls = 'bg-purple-600 text-white font-extrabold shadow-2xs';
                        }
                        return `
                            <button type="button" onclick="window.selectJurnalStudentStatus(this, '${st}')"
                                class="btn-jurnal-st px-2 py-0.5 text-[10px] rounded font-bold transition active:scale-95 ${activeCls}">
                                ${st}
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    });

    if (presensiContainer) presensiContainer.innerHTML = presensiHTML;
    window.updateEditJurnalPresensiSummary();

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        card.classList.remove('scale-95', 'opacity-0');
        card.classList.add('scale-100', 'opacity-100');
    }, 10);
};

window.updateEditJurnalPresensiSummary = function () {
    const container = document.getElementById('edit-jurnal-presensi-list');
    if (!container) return;
    const rows = container.querySelectorAll('[data-student-name]');
    const total = rows.length;
    let counts = { H: 0, I: 0, S: 0, A: 0, D: 0 };

    rows.forEach(row => {
        const activeBtn = row.querySelector('.btn-jurnal-st.text-white');
        const st = activeBtn ? activeBtn.textContent.trim() : 'H';
        if (counts.hasOwnProperty(st)) {
            counts[st]++;
        } else {
            counts.H++;
        }
    });

    const elTotal = document.getElementById('edit-jurnal-sum-total');
    const elH = document.getElementById('edit-jurnal-sum-h');
    const elS = document.getElementById('edit-jurnal-sum-s');
    const elI = document.getElementById('edit-jurnal-sum-i');
    const elA = document.getElementById('edit-jurnal-sum-a');
    const elD = document.getElementById('edit-jurnal-sum-d');

    if (elTotal) elTotal.textContent = total;
    if (elH) elH.textContent = counts.H;

    const setBadge = (el, prefix, count, activeCls) => {
        if (!el) return;
        el.textContent = `${prefix}: ${count}`;
        if (count > 0) {
            el.className = `px-2 py-0.5 rounded-md ${activeCls} font-extrabold text-[10px] shadow-2xs`;
        } else {
            el.className = `px-2 py-0.5 rounded-md bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300 font-extrabold text-[10px]`;
        }
    };

    setBadge(elS, 'S', counts.S, 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 border border-amber-300 dark:border-amber-700');
    setBadge(elI, 'I', counts.I, 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200 border border-blue-300 dark:border-blue-700');
    setBadge(elA, 'A', counts.A, 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200 border border-rose-300 dark:border-rose-700');
    setBadge(elD, 'D', counts.D, 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200 border border-purple-300 dark:border-purple-700');
};

window.selectJurnalStudentStatus = function (btnEl, st) {
    const parent = btnEl.closest('.flex');
    if (!parent) return;
    const allBtns = parent.querySelectorAll('.btn-jurnal-st');
    allBtns.forEach(b => {
        b.className = 'btn-jurnal-st px-2 py-0.5 text-[10px] rounded font-bold transition active:scale-95 bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
    });

    let activeCls = 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
    if (st === 'H') activeCls = 'bg-emerald-600 text-white font-extrabold shadow-2xs';
    else if (st === 'I') activeCls = 'bg-blue-600 text-white font-extrabold shadow-2xs';
    else if (st === 'S') activeCls = 'bg-amber-600 text-white font-extrabold shadow-2xs';
    else if (st === 'A') activeCls = 'bg-rose-600 text-white font-extrabold shadow-2xs';
    else if (st === 'D') activeCls = 'bg-purple-600 text-white font-extrabold shadow-2xs';

    btnEl.className = `btn-jurnal-st px-2 py-0.5 text-[10px] rounded font-bold transition active:scale-95 ${activeCls}`;
    window.updateEditJurnalPresensiSummary();
};

window.closeEditJurnalModal = function () {
    const modal = document.getElementById('modal-edit-jurnal');
    const card = document.getElementById('modal-edit-jurnal-card');
    if (!modal || !card) return;

    card.classList.remove('scale-100', 'opacity-100');
    card.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        currentEditingJurnalId = null;
    }, 150);
};

window.saveJurnalChanges = async function () {
    if (!currentEditingJurnalId) return;

    const btnSave = document.getElementById('btn-save-edit-jurnal');
    const btnText = document.getElementById('btn-save-edit-jurnal-text');
    const inputJp = document.getElementById('input-edit-jurnal-jp');
    const inputTopik = document.getElementById('input-edit-jurnal-topik');
    const txtCatatan = document.getElementById('textarea-edit-jurnal-catatan');
    const presensiContainer = document.getElementById('edit-jurnal-presensi-list');

    const newTopik = inputTopik ? inputTopik.value.trim() : '';
    const newCatatan = txtCatatan ? txtCatatan.value.trim() : '';
    const rawJp = inputJp ? inputJp.value.trim() : '';

    if (!newTopik) {
        showToast('Peringatan', 'Materi / Topik Pembelajaran wajib diisi!', 'warning');
        return;
    }

    if (btnSave && btnText) {
        btnSave.disabled = true;
        btnText.textContent = 'Menyimpan...';
    }

    // Parse JP String back to array if range, e.g. "1-2" -> [1, 2], "3" -> [3]
    let parsedJp = rawJp;
    if (rawJp.includes('-')) {
        const parts = rawJp.split('-').map(p => parseInt(p.trim())).filter(n => !isNaN(n));
        if (parts.length >= 2) {
            parsedJp = [];
            for (let i = parts[0]; i <= parts[1]; i++) parsedJp.push(i);
        }
    } else if (!isNaN(parseInt(rawJp))) {
        parsedJp = [parseInt(rawJp)];
    }

    // Collect Presensi Detail
    const newPresensiDetail = [];
    const newPresensiObj = {};

    if (presensiContainer) {
        const studentRows = presensiContainer.querySelectorAll('[data-student-name]');
        studentRows.forEach(row => {
            const nama = row.dataset.studentName;
            const activeBtn = row.querySelector('.btn-jurnal-st.text-white');
            const st = activeBtn ? activeBtn.textContent.trim() : 'H';
            newPresensiDetail.push({ nama, status: st });
            newPresensiObj[nama] = st;
        });
    }

    try {
        const updatePayload = {
            topik: newTopik,
            catatan: newCatatan || '-',
            jp: parsedJp,
            presensi_detail: newPresensiDetail,
            updated_at: new Date().toISOString()
        };

        await cfClient.saveJurnalEntry(updatePayload, true, currentEditingJurnalId);

        // Hapus cache lokal agar jurnal langsung ter-refresh
        const mapel = document.getElementById('select-mapel').value;
        const kelas = document.getElementById('select-kelas').value;
        const semester = document.getElementById('select-semester').value;
        const tahunAjaran = raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString();
        const cacheJurnalKey = `cache_jurnal_${tahunAjaran.replace(/\//g, '-')}_S${semester}_${kelas.replace(/\s+/g, '_')}_${mapel.replace(/\s+/g, '_')}`;
        localStorage.removeItem(cacheJurnalKey);

        window.closeEditJurnalModal();
        showModernAlert('Berhasil', 'Data Jurnal Mengajar berhasil diperbarui!', 'success');

        // Refresh Jurnal & Kehadiran Table
        if (typeof window.loadDaftarJurnalData === 'function') window.loadDaftarJurnalData(true);
        if (typeof window.loadKehadiranSiswaData === 'function') window.loadKehadiranSiswaData(true);
    } catch (err) {
        console.error('[Edit Jurnal] Error updating document:', err);
        showModernAlert('Gagal Menyimpan', 'Terjadi kesalahan saat mengedit jurnal: ' + err.message, 'error');
    } finally {
        if (btnSave && btnText) {
            btnSave.disabled = false;
            btnText.textContent = 'Simpan Perubahan Jurnal';
        }
    }
};

window.loadJurnalData = function (force = true) {
    if (typeof window.loadDaftarJurnalData === 'function') window.loadDaftarJurnalData(force);
};

window.loadKehadiranData = function (force = true) {
    if (typeof window.loadKehadiranSiswaData === 'function') window.loadKehadiranSiswaData(force);
};

// =========================================================================
// 16. TOOLTIP DETAIL TANGGAL KBM & MATERI/CATATAN KEHADIRAN SISWA
// =========================================================================

const INDO_DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function formatIndoDateLong(dateStr) {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        const dt = new Date(y, m - 1, d);
        const dayName = INDO_DAY_NAMES[dt.getDay()] || '';
        const monthName = (typeof INDO_MONTH_NAMES !== 'undefined' && INDO_MONTH_NAMES[m]) ? INDO_MONTH_NAMES[m] : parts[1];
        return `${dayName}, ${d} ${monthName} ${y}`;
    }
    return dateStr;
}

let activeKehadiranTooltipKey = null;

export function hideKehadiranDateTooltip() {
    const el = document.getElementById('kehadiran-date-tooltip');
    if (el) {
        el.classList.add('hidden');
    }
    activeKehadiranTooltipKey = null;
    window._activeKehadiranTooltipKey = null;
}
window.hideKehadiranDateTooltip = hideKehadiranDateTooltip;

export function showKehadiranDateTooltip(event, key, pertemuanNum) {
    if (event) {
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
        if (typeof event.preventDefault === 'function') event.preventDefault();
    }

    const pertemuanMap = window._lastKehadiranPertemuanMap || {};
    const pt = pertemuanMap[key];
    if (!pt) {
        console.warn('[Kehadiran] Data pertemuan tidak ditemukan untuk key:', key);
        return;
    }

    let tooltipEl = document.getElementById('kehadiran-date-tooltip');
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'kehadiran-date-tooltip';
        tooltipEl.className = 'hidden fixed z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-2xl p-3.5 sm:p-4 text-xs w-[290px] sm:w-[330px] max-w-[92vw] select-none pointer-events-auto transition-opacity duration-150';
        document.body.appendChild(tooltipEl);
    }

    // Toggle close jika diklik pada elemen yang sama saat sedang terbuka
    if (activeKehadiranTooltipKey === key && !tooltipEl.classList.contains('hidden')) {
        hideKehadiranDateTooltip();
        return;
    }
    activeKehadiranTooltipKey = key;
    window._activeKehadiranTooltipKey = key;

    const triggerEl = event ? (event.currentTarget || event.target) : null;
    const tglFormatted = formatIndoDateLong(pt.tgl);
    const topikMateri = (pt.topik && pt.topik !== '-') ? pt.topik : ((pt.materi && pt.materi !== '-') ? pt.materi : '');
    const catatan = (pt.catatan && pt.catatan !== '-') ? pt.catatan : '';

    const materiHtml = topikMateri
        ? `<div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 text-slate-800 dark:text-slate-100 font-medium leading-relaxed text-xs break-words max-h-32 overflow-y-auto custom-scrollbar select-text">${escapeHTML(topikMateri)}</div>`
        : `<div class="p-2.5 rounded-xl bg-slate-50/60 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700/60 text-slate-400 dark:text-slate-500 italic text-[11px] text-center">Belum ada materi/topik pembelajaran tercatat</div>`;

    const catatanHtml = catatan
        ? `<div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 text-slate-700 dark:text-slate-200 font-normal leading-relaxed text-xs break-words max-h-32 overflow-y-auto custom-scrollbar select-text">${escapeHTML(catatan)}</div>`
        : `<div class="p-2.5 rounded-xl bg-slate-50/60 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700/60 text-slate-400 dark:text-slate-500 italic text-[11px] text-center">Tidak ada catatan kegiatan pada hari ini</div>`;

    const guruHtml = (pt.guru && pt.guru !== '-')
        ? `<div class="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span class="truncate flex items-center gap-1.5"><i class="fa-solid fa-chalkboard-user text-emerald-500 text-[10px]"></i> <span class="truncate" title="${escapeHTML(pt.guru)}">${escapeHTML(pt.guru)}</span></span>
            ${pt.lokasi ? `<span class="shrink-0 text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300 font-medium border border-slate-200/60 dark:border-slate-700/60">${escapeHTML(pt.lokasi)}</span>` : ''}
           </div>`
        : '';

    const actionHtml = pt.id
        ? `<button type="button" onclick="window.navigateToJurnalFromKehadiran('${escapeHTML(pt.id)}')"
               class="mt-3 w-full py-1.5 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/60 font-bold text-[11px] transition active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs">
               <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
               <span>Buka di Tab Jurnal Mengajar</span>
           </button>`
        : '';

    tooltipEl.innerHTML = `
        <div class="relative">
            <!-- Header Tooltip -->
            <div class="flex items-start justify-between gap-2 mb-2">
                <div>
                    <div class="flex items-center gap-1.5">
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800/60 font-extrabold text-[10px] tracking-wide uppercase">
                            Pertemuan ${pertemuanNum || '-'}
                        </span>
                        <span class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-bold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[10px]">
                            JP ${escapeHTML(pt.jp || '-')}
                        </span>
                    </div>
                    <div class="mt-1 font-bold text-slate-800 dark:text-slate-100 text-xs flex items-center gap-1.5">
                        <i class="fa-regular fa-calendar-check text-emerald-600 dark:text-emerald-400"></i>
                        <span>${escapeHTML(tglFormatted)}</span>
                    </div>
                </div>
                <button type="button" onclick="window.hideKehadiranDateTooltip()"
                    class="w-6 h-6 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center justify-center transition shrink-0 cursor-pointer"
                    title="Tutup Tooltip">
                    <i class="fa-solid fa-xmark text-xs"></i>
                </button>
            </div>

            <!-- Konten Materi / Topik -->
            <div class="space-y-1 mt-2.5">
                <div class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400">
                    <i class="fa-solid fa-book-open text-[10px]"></i>
                    <span>Materi / Topik Pembelajaran</span>
                </div>
                ${materiHtml}
            </div>

            <!-- Konten Catatan Kegiatan -->
            <div class="space-y-1 mt-2.5">
                <div class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                    <i class="fa-solid fa-comment-dots text-[10px]"></i>
                    <span>Catatan Kegiatan / Refleksi</span>
                </div>
                ${catatanHtml}
            </div>

            ${guruHtml}
            ${actionHtml}
        </div>
    `;

    tooltipEl.classList.remove('hidden');

    if (triggerEl && typeof triggerEl.getBoundingClientRect === 'function') {
        const rect = triggerEl.getBoundingClientRect();
        const tooltipWidth = tooltipEl.offsetWidth || 310;
        const tooltipHeight = tooltipEl.offsetHeight || 260;

        let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
        const minLeft = 10;
        const maxLeft = Math.max(10, (window.innerWidth || 1024) - tooltipWidth - 10);
        left = Math.max(minLeft, Math.min(maxLeft, left));

        let top = rect.bottom + 8;
        if (top + tooltipHeight > (window.innerHeight || 768) - 10 && rect.top - tooltipHeight - 8 > 10) {
            top = rect.top - tooltipHeight - 8;
        }

        tooltipEl.style.left = `${Math.round(left)}px`;
        tooltipEl.style.top = `${Math.round(top)}px`;
        tooltipEl.style.transform = '';
    } else {
        tooltipEl.style.left = '50%';
        tooltipEl.style.top = '50%';
        tooltipEl.style.transform = 'translate(-50%, -50%)';
    }
}
window.showKehadiranDateTooltip = showKehadiranDateTooltip;

export function navigateToJurnalFromKehadiran(jurnalId) {
    hideKehadiranDateTooltip();
    if (typeof window.switchGuruMapelTab === 'function') {
        window.switchGuruMapelTab('jurnal');
    }

    setTimeout(() => {
        const data = loadedJurnalDocsMap ? loadedJurnalDocsMap[jurnalId] : null;
        if (data && typeof window.onJurnalMonthChange === 'function') {
            const mKey = getJurnalMonthKey(data);
            if (mKey && selectedJurnalMonth !== 'all' && selectedJurnalMonth !== mKey) {
                window.onJurnalMonthChange(mKey);
            }
        }
        const targetBtn = document.querySelector(`button[onclick*="${jurnalId}"]`);
        if (targetBtn) {
            const tr = targetBtn.closest('tr');
            if (tr) {
                tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
                tr.classList.add('bg-teal-50', 'dark:bg-teal-950/40');
                setTimeout(() => {
                    tr.classList.remove('bg-teal-50', 'dark:bg-teal-950/40');
                }, 2000);
            }
        }
    }, 250);
}
window.navigateToJurnalFromKehadiran = navigateToJurnalFromKehadiran;

if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
        const tooltipEl = document.getElementById('kehadiran-date-tooltip');
        if (tooltipEl && !tooltipEl.classList.contains('hidden')) {
            if (!tooltipEl.contains(e.target)) {
                hideKehadiranDateTooltip();
            }
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideKehadiranDateTooltip();
        }
    });
}

// =========================================================================
// 12. LOGIKA MODUL LMS (Learning Management System D1 & Modul Ajar Guru)
// =========================================================================

let currentLmsModules = [];
let currentLmsTopics = [];
let currentLmsMaterials = [];
let currentLmsSubView = 'materials'; // 'materials' | 'analytics'
let currentLmsAnalytics = null;
let currentLmsAnalyticsTopicId = '';
let currentLmsAnalyticsMaterialId = '';
let lmsAnalyticsCache = new Map();
let currentActiveDiscussionMaterialId = null;
let currentReplyingToComment = null;
let lmsLoadSequence = 0;

export function getLmsStudentEngagementBadge(s) {
    if (!s) return 'Perlu Perhatian';
    if (s.engagement_badge && typeof s.engagement_badge === 'string' && s.engagement_badge !== 'undefined' && s.engagement_badge.trim() !== '') {
        return s.engagement_badge.trim();
    }
    if (s.status_badge && typeof s.status_badge === 'string' && s.status_badge !== 'undefined' && s.status_badge.trim() !== '') {
        return s.status_badge.trim();
    }
    const score = Number(s.engagement_score ?? s.total_score ?? s.completion_rate ?? 0);
    if (score >= 75) return 'Sangat Aktif';
    if (score >= 50) return 'Aktif';
    return 'Perlu Perhatian';
}
window.getLmsStudentEngagementBadge = getLmsStudentEngagementBadge;

function normalizeLmsAnalyticsPayload(payload, fallbackClass = '') {
    if (!payload || !Array.isArray(payload.data)) return payload || null;
    payload.data.forEach(s => {
        s.engagement_score = Number(s.engagement_score ?? s.total_score ?? 0);
        s.total_score = s.engagement_score;
        s.engagement_badge = getLmsStudentEngagementBadge(s);
        s.status_badge = s.engagement_badge;
        s.class = s.class || s.class_name || fallbackClass;
    });
    return payload;
}

function populateLmsAnalyticsTopicSelector() {
    const topicSelect = document.getElementById('select-lms-analytics-topic');
    if (topicSelect) {
        topicSelect.innerHTML = '<option value="">Global — Semua Topik</option>' + (currentLmsTopics || []).map((topic, index) =>
            `<option value="${escapeHTML(topic.id)}">Topik ${index + 1} — ${escapeHTML(topic.title)}</option>`
        ).join('');
        topicSelect.value = currentLmsAnalyticsTopicId || '';
    }
    populateLmsAnalyticsMaterialSelector();
}

function populateLmsAnalyticsMaterialSelector() {
    const matSelect = document.getElementById('select-lms-analytics-material');
    if (!matSelect) return;

    let materialsToShow = currentLmsMaterials || [];
    if (currentLmsAnalyticsTopicId) {
        materialsToShow = materialsToShow.filter(m => String(m.topic_id) === String(currentLmsAnalyticsTopicId));
    }

    const defaultLabel = currentLmsAnalyticsTopicId ? 'Semua Bahan Ajar di Topik Ini' : 'Semua Bahan Ajar (Global)';
    let optionsHtml = `<option value="">${defaultLabel} (${materialsToShow.length} modul)</option>`;

    materialsToShow.forEach((mat, index) => {
        let typeIcon = '🔗';
        if (mat.resource_type === 'youtube') typeIcon = '🎥';
        else if (mat.resource_type === 'gdrive') typeIcon = '📁';
        else if (mat.resource_type === 'text') typeIcon = '📄';

        const discIndicator = Number(mat.allow_discussion) === 1 ? ' [💬 Ada Diskusi]' : ' [Tanpa Diskusi]';
        optionsHtml += `<option value="${escapeHTML(mat.id)}">${typeIcon} Modul ${index + 1}: ${escapeHTML(mat.title)}${discIndicator}</option>`;
    });

    matSelect.innerHTML = optionsHtml;
    if (currentLmsAnalyticsMaterialId && materialsToShow.some(m => String(m.id) === String(currentLmsAnalyticsMaterialId))) {
        matSelect.value = currentLmsAnalyticsMaterialId;
    } else {
        currentLmsAnalyticsMaterialId = '';
        matSelect.value = '';
    }
}

window.changeLmsAnalyticsScope = async function (triggeredBy = 'topic') {
    const loadSequence = lmsLoadSequence;
    const topicSelect = document.getElementById('select-lms-analytics-topic');
    const matSelect = document.getElementById('select-lms-analytics-material');
    const scopeLabel = document.getElementById('lms-analytics-scope-label');
    const tbody = document.getElementById('tbody-lms-analytics');
    const mapel = document.getElementById('select-mapel')?.value || '';
    const kelas = document.getElementById('select-kelas')?.value || '';

    if (!mapel || !kelas) return;

    if (triggeredBy === 'topic') {
        currentLmsAnalyticsTopicId = String(topicSelect?.value || '').trim();
        currentLmsAnalyticsMaterialId = '';
        populateLmsAnalyticsMaterialSelector();
    } else if (triggeredBy === 'material') {
        currentLmsAnalyticsMaterialId = String(matSelect?.value || '').trim();
        if (currentLmsAnalyticsMaterialId) {
            const matObj = (currentLmsMaterials || []).find(m => String(m.id) === currentLmsAnalyticsMaterialId);
            if (matObj && matObj.topic_id && String(topicSelect?.value) !== String(matObj.topic_id)) {
                currentLmsAnalyticsTopicId = String(matObj.topic_id);
                if (topicSelect) topicSelect.value = currentLmsAnalyticsTopicId;
                populateLmsAnalyticsMaterialSelector();
                if (matSelect) matSelect.value = currentLmsAnalyticsMaterialId;
            }
        }
    } else if (triggeredBy === 'refresh') {
        currentLmsAnalyticsTopicId = String(topicSelect?.value || '').trim();
        currentLmsAnalyticsMaterialId = String(matSelect?.value || '').trim();
    }

    const requestedTopicId = currentLmsAnalyticsTopicId;
    const requestedMaterialId = currentLmsAnalyticsMaterialId;
    const cacheKey = requestedMaterialId ? `mat_${requestedMaterialId}` : (requestedTopicId ? `top_${requestedTopicId}` : 'global');

    const cached = lmsAnalyticsCache.get(cacheKey);
    if (cached) {
        currentLmsAnalytics = cached;
        renderLmsClassAnalytics();
        return;
    }

    if (topicSelect) topicSelect.disabled = true;
    if (matSelect) matSelect.disabled = true;
    if (scopeLabel) scopeLabel.textContent = 'Memuat matriks keaktifan...';
    if (tbody) {
        const colSpan = requestedMaterialId ? 8 : 9;
        tbody.innerHTML = `<tr><td colspan="${colSpan}" class="py-8 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-1.5"></i>Memuat data siswa...</td></tr>`;
    }

    try {
        const result = await cfGetLmsClassAnalytics({
            class: kelas,
            subject: mapel,
            topicId: requestedTopicId,
            materialId: requestedMaterialId
        });
        const normalized = normalizeLmsAnalyticsPayload(result || null, kelas);

        if (currentLmsAnalyticsTopicId !== requestedTopicId || currentLmsAnalyticsMaterialId !== requestedMaterialId || loadSequence !== lmsLoadSequence) return;
        currentLmsAnalytics = normalized;
        if (normalized) lmsAnalyticsCache.set(cacheKey, normalized);
        renderLmsClassAnalytics();
    } catch (err) {
        if (currentLmsAnalyticsTopicId !== requestedTopicId || currentLmsAnalyticsMaterialId !== requestedMaterialId || loadSequence !== lmsLoadSequence) return;
        console.error('[LMS Guru] Error loading analytics scope:', err);
        if (scopeLabel) scopeLabel.textContent = 'Gagal memuat cakupan matriks yang dipilih';
        if (tbody) {
            const colSpan = requestedMaterialId ? 8 : 9;
            tbody.innerHTML = `<tr><td colspan="${colSpan}" class="py-8 text-center text-rose-500">${escapeHTML(err.message || 'Data matriks tidak dapat dimuat.')}</td></tr>`;
        }
        showToast('Gagal Memuat Matriks', err.message || 'Data keaktifan tidak dapat dimuat.', 'error');
    } finally {
        if (topicSelect) topicSelect.disabled = false;
        if (matSelect) matSelect.disabled = false;
    }
};

window.switchLmsSubView = function (viewName) {
    currentLmsSubView = viewName;
    const btnMat = document.getElementById('btn-lms-view-materials');
    const btnAna = document.getElementById('btn-lms-view-analytics');
    const wrapMat = document.getElementById('wrapper-lms-materials-view');
    const wrapAna = document.getElementById('wrapper-lms-analytics-view');
    const btnExport = document.getElementById('btn-export-lms-analytics');
    const btnUnifiedCreator = document.getElementById('btn-open-unified-lms-creator');
    const materialSearch = document.getElementById('lms-material-search-wrapper');
    const btnReminder = document.getElementById('btn-lms-wa-reminder');
    const btnReorder = document.getElementById('btn-reorder-lms');

    const activeClass = "h-9 px-3 sm:px-3.5 rounded-lg text-xs font-bold transition-all bg-emerald-600 text-white shadow-xs flex items-center gap-1.5 whitespace-nowrap shrink-0";
    const inactiveClass = "h-9 px-3 sm:px-3.5 rounded-lg text-xs font-semibold transition-all text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5 whitespace-nowrap shrink-0";

    if (viewName === 'analytics') {
        if (btnMat) btnMat.className = inactiveClass;
        if (btnAna) btnAna.className = activeClass;
        if (wrapMat) wrapMat.classList.add('hidden');
        if (wrapAna) wrapAna.classList.remove('hidden');
        if (btnExport) {
            btnExport.classList.remove('hidden');
            btnExport.classList.add('flex');
        }
        if (btnUnifiedCreator) btnUnifiedCreator.classList.add('hidden');
        if (materialSearch) materialSearch.classList.add('hidden');
        if (btnReminder) btnReminder.classList.add('hidden');
        if (btnReorder) btnReorder.classList.add('hidden');

        renderLmsClassAnalytics();
    } else {
        if (btnMat) btnMat.className = activeClass;
        if (btnAna) btnAna.className = inactiveClass;
        if (wrapMat) wrapMat.classList.remove('hidden');
        if (wrapAna) wrapAna.classList.add('hidden');
        if (btnExport) {
            btnExport.classList.add('hidden');
            btnExport.classList.remove('flex');
        }
        if (btnUnifiedCreator) btnUnifiedCreator.classList.remove('hidden');
        if (materialSearch) materialSearch.classList.remove('hidden');
        if (btnReminder) btnReminder.classList.remove('hidden');
        if (btnReorder) btnReorder.classList.remove('hidden');

        renderLmsMaterialsList();
    }
};

window.loadLmsData = async function (forceReFetch = true) {
    const isCurrentLoad = beginPortalDataLoad('lms');
    const requestSequence = ++lmsLoadSequence;
    const mapel = document.getElementById('select-mapel')?.value || '';
    const kelas = document.getElementById('select-kelas')?.value || '';
    const semester = document.getElementById('select-semester')?.value || '1';
    const semesterText = semester === '1' ? 'Ganjil' : 'Genap';
    const academicYear = raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString();
    const cacheKey = JSON.stringify(['lms', academicYear, semester, kelas, mapel]);

    const emptyState = document.getElementById('lms-materials-empty-state');
    const topicsContainer = document.getElementById('lms-topics-container');

    if (!mapel || !kelas) {
        if (emptyState) emptyState.classList.remove('hidden');
        if (topicsContainer) topicsContainer.innerHTML = '';
        currentLmsTopics = [];
        currentLmsModules = [];
        currentLmsMaterials = [];
        currentLmsAnalytics = null;
        currentLmsAnalyticsTopicId = '';
        currentLmsAnalyticsMaterialId = '';
        lmsAnalyticsCache = new Map();
        populateLmsAnalyticsTopicSelector();
        return;
    }

    try {
        console.log(`[LMS Guru] 🔄 Memuat data LMS untuk Kelas: ${kelas}, Mapel: ${mapel}...`);

        if (forceReFetch) sessionPortalDataCache.delete(cacheKey);
        const cached = !forceReFetch && sessionPortalDataCache.get(cacheKey);
        const [topics, materials, analytics, modules] = cached?.data?.[3] ? cached.data : await Promise.all([
            cfGetLmsTopics({ class: kelas, subject: mapel, semester: semesterText, academicYear }),
            cfGetLmsMaterials({ class: kelas, subject: mapel }),
            cfGetLmsClassAnalytics({ class: kelas, subject: mapel }),
            cfGetLmsModules({class: kelas, subject: mapel})
        ]);
        if (requestSequence !== lmsLoadSequence || !isCurrentLoad()) return;

        currentLmsModules = Array.isArray(modules) ? [...modules] : [];
        currentLmsTopics = Array.isArray(topics) ? [...topics] : [];
        currentLmsMaterials = Array.isArray(materials) ? [...materials] : [];
        currentLmsAnalyticsTopicId = '';
        currentLmsAnalyticsMaterialId = '';
        currentLmsAnalytics = normalizeLmsAnalyticsPayload(analytics || null, kelas);
        lmsAnalyticsCache = cached ? cached.analyticsCache : new Map();
        if (currentLmsAnalytics) lmsAnalyticsCache.set('global', currentLmsAnalytics);
        sessionPortalDataCache.set(cacheKey, { data: [[...currentLmsTopics], [...currentLmsMaterials], analytics, [...currentLmsModules]], analyticsCache: lmsAnalyticsCache });
        populateLmsAnalyticsTopicSelector();

        console.log(`[LMS Guru] ✅ Berhasil memuat ${currentLmsTopics.length} Topik & ${currentLmsMaterials.length} Materi.`);
        previouslyLoadedPortalTabs.add('lms');
        currentLoadedLmsScope = `${academicYear}_${semester}_${kelas}_${mapel}`;

        if (currentLmsSubView === 'analytics') {
            renderLmsClassAnalytics();
        } else {
            renderLmsMaterialsList();
        }
    } catch (err) {
        if (requestSequence !== lmsLoadSequence || !isCurrentLoad()) return;
        console.error('[LMS Guru] Error loading LMS data:', err);
        if (topicsContainer) {
            topicsContainer.innerHTML = `
                <div class="p-6 text-center text-rose-500 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl">
                    <i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i>
                    <p class="font-bold text-sm">Gagal Memuat Modul LMS</p>
                    <p class="text-xs text-rose-600 dark:text-rose-400 mt-1">${escapeHTML(err.message || 'Terjadi kesalahan jaringan ke Cloudflare D1.')}</p>
                </div>
            `;
        }
    }
};

const lmsExpandedState = new Map();

function getLmsCurrentContextKey() {
    const mapel = (document.getElementById('select-mapel')?.value || '').trim();
    const kelas = (document.getElementById('select-kelas')?.value || '').trim();
    const semester = (document.getElementById('select-semester')?.value || '1').trim();
    return `${kelas}__${mapel}__${semester}`;
}

function getLmsContextExpandedState() {
    const key = getLmsCurrentContextKey();
    if (!lmsExpandedState.has(key)) {
        const defaultTopicId = (currentLmsTopics && currentLmsTopics.length > 0 && currentLmsTopics[0]?.id)
            ? currentLmsTopics[0].id
            : null;
        lmsExpandedState.set(key, {
            topics: new Set(defaultTopicId ? [defaultTopicId] : []),
            materials: new Set()
        });
    }
    return lmsExpandedState.get(key);
}

window.toggleLmsTopicCollapse = function (topicId) {
    if (!topicId) return;
    const state = getLmsContextExpandedState();
    const isCurrentlyOpen = state.topics.has(topicId);
    if (isCurrentlyOpen) {
        state.topics.delete(topicId);
    } else {
        state.topics.add(topicId);
    }

    const bodyEl = document.getElementById(`lms-topic-body-${topicId}`);
    const btnEl = document.getElementById(`lms-topic-toggle-btn-${topicId}`);
    const chevronEl = document.getElementById(`lms-topic-chevron-${topicId}`);

    if (bodyEl && btnEl && chevronEl) {
        const nextState = !isCurrentlyOpen;
        btnEl.setAttribute('aria-expanded', String(nextState));
        if (nextState) {
            bodyEl.classList.remove('hidden');
            chevronEl.classList.add('rotate-90');
        } else {
            bodyEl.classList.add('hidden');
            chevronEl.classList.remove('rotate-90');
        }
    } else {
        renderLmsMaterialsList();
    }
};

window.toggleLmsMaterialCollapse = function (matId) {
    if (!matId) return;
    const state = getLmsContextExpandedState();
    const isCurrentlyOpen = state.materials.has(matId);
    if (isCurrentlyOpen) {
        state.materials.delete(matId);
    } else {
        state.materials.add(matId);
    }

    const detailEl = document.getElementById(`lms-mat-detail-${matId}`);
    const btnEl = document.getElementById(`lms-mat-toggle-btn-${matId}`);
    const chevronEl = document.getElementById(`lms-mat-chevron-${matId}`);

    if (detailEl && btnEl && chevronEl) {
        const nextState = !isCurrentlyOpen;
        btnEl.setAttribute('aria-expanded', String(nextState));
        if (nextState) {
            detailEl.classList.remove('hidden');
            chevronEl.classList.add('rotate-90', 'text-emerald-600', 'dark:text-emerald-400');
            chevronEl.classList.remove('text-slate-400');
        } else {
            detailEl.classList.add('hidden');
            chevronEl.classList.remove('rotate-90', 'text-emerald-600', 'dark:text-emerald-400');
            chevronEl.classList.add('text-slate-400');
        }
    } else {
        renderLmsMaterialsList();
    }
};

function renderLmsMaterialsList() {
    clearTimeout(renderLmsMaterialsList.scheduleTimer);
    const now = Date.now();
    const nextBoundary = (currentLmsMaterials || []).flatMap(material => [material.publish_at, material.due_date])
        .map(value => Date.parse(normalizeLmsScheduleTime(value, true))).filter(value => value > now).sort((a, b) => a - b)[0];
    if (nextBoundary) renderLmsMaterialsList.scheduleTimer = setTimeout(() => renderLmsMaterialsList(), Math.min(nextBoundary - now + 50, 2147483647));
    const emptyState = document.getElementById('lms-materials-empty-state');
    const topicsContainer = document.getElementById('lms-topics-container');
    const healthSummary = document.getElementById('lms-materials-health-summary');
    if (!topicsContainer) return;
    if (window.lmsModuleWorkspace) {
        emptyState?.classList.add('hidden'); healthSummary?.classList.add('hidden');
        window.lmsModuleWorkspace.render(topicsContainer,currentLmsTopics,currentLmsModules,document.getElementById('input-search-lms')?.value || '');
        return;
    }

    if (!currentLmsTopics || currentLmsTopics.length === 0) {
        if (healthSummary) healthSummary.classList.add('hidden');
        if (emptyState) emptyState.classList.remove('hidden');
        topicsContainer.innerHTML = `
            <div class="flex flex-col items-center justify-center p-8 bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl text-center">
                <div class="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center text-xl mb-3">
                    <i class="fa-solid fa-folder-plus"></i>
                </div>
                <h4 class="font-bold text-slate-800 dark:text-slate-100 text-sm">Belum Ada Topik Pembelajaran</h4>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                    Mulai dengan membuat topik/bab materi pertama untuk kelas dan mata pelajaran ini.
                </p>
                <div class="flex items-center gap-2 mt-3.5 flex-wrap justify-center">
                    <button onclick="window.openLmsCopyModal()" class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition shadow active:scale-95 flex items-center gap-1.5" title="Salin materi yang sudah ada dari kelas lain">
                        <i class="fa-solid fa-copy"></i>
                        <span>Salin dr Kelas Lain</span>
                    </button>
                    <button onclick="window.openLmsTopicModal()" class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition shadow active:scale-95 flex items-center gap-1.5">
                        <i class="fa-solid fa-plus"></i>
                        <span>Buat Topik Baru</span>
                    </button>
                </div>
            </div>
        `;
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    if (healthSummary) {
        healthSummary.classList.remove('hidden');
        const visibleTopicIds = new Set((currentLmsTopics || []).map(t => t.id));
        const semesterMaterials = (currentLmsMaterials || []).filter(m => visibleTopicIds.has(m.topic_id));
        const totalMats = semesterMaterials.length;
        const totalTopics = currentLmsTopics.length;
        let totalDiscussions = 0;
        let sumRate = 0;
        let validRateCount = 0;

        semesterMaterials.forEach(m => {
            totalDiscussions += Number(m.discussion_count) || 0;
            const activeClass = (m.class_name || document.getElementById('select-kelas')?.value || '').trim();
            const filteredLoadedStudents = (Array.isArray(loadedStudents) ? loadedStudents : []).filter(s => {
                if (!s || !s.class) return false;
                if (typeof isClassEqual === 'function') return isClassEqual(s.class, activeClass);
                return (s.class || '').trim().toLowerCase() === activeClass.toLowerCase();
            });
            const totalStudents = Number(m.total_students)
                || (filteredLoadedStudents.length > 0 ? filteredLoadedStudents.length : 0)
                || (currentLmsAnalytics && Array.isArray(currentLmsAnalytics.data) ? currentLmsAnalytics.data.length : 0);
            const doneCount = Number(m.completed_count) || 0;
            if (totalStudents > 0) {
                sumRate += Math.round((doneCount / totalStudents) * 100);
                validRateCount++;
            }
        });

        const avgRate = validRateCount > 0 ? Math.round(sumRate / validRateCount) : 0;

        const elTotalMat = document.getElementById('lms-health-total-materials');
        const elTotalTop = document.getElementById('lms-health-total-topics');
        const elTotalDisc = document.getElementById('lms-health-total-discussions');
        const elAvgRate = document.getElementById('lms-health-avg-completion');

        if (elTotalMat) elTotalMat.textContent = totalMats;
        if (elTotalTop) elTotalTop.textContent = totalTopics;
        if (elTotalDisc) elTotalDisc.textContent = totalDiscussions;
        if (elAvgRate) elAvgRate.textContent = `${avgRate}%`;
    }

    const expandedState = getLmsContextExpandedState();
    let html = '';

    currentLmsTopics.forEach((topic, tIdx) => {
        const topicMaterials = currentLmsMaterials.filter(m => m.topic_id === topic.id);
        const teachingCompletedCount = topicMaterials.filter(m => getLmsScheduleState(m).teachingCompleted).length;
        const topicTeachingCompleted = topicMaterials.length > 0 && teachingCompletedCount === topicMaterials.length;
        const isFirstTopic = tIdx === 0;
        const isLastTopic = tIdx === currentLmsTopics.length - 1;
        const isTopicOpen = expandedState.topics.has(topic.id);

        html += `
            <div class="lms-topic-card bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs overflow-hidden transition hover:border-slate-300 dark:hover:border-slate-700"
                data-topic-id="${topic.id}"
                data-topic-title="${escapeHTML(topic.title)}"
                data-topic-desc="${escapeHTML(topic.description || '')}">

                <!-- Topic Header -->
                <div class="px-3.5 py-2.5 sm:px-4 sm:py-3 bg-slate-50/90 dark:bg-slate-800/70 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                    <button type="button" id="lms-topic-toggle-btn-${topic.id}"
                        onclick="window.toggleLmsTopicCollapse('${topic.id}')"
                        aria-expanded="${isTopicOpen}"
                        aria-controls="lms-topic-body-${topic.id}"
                        class="flex-1 min-w-0 flex items-center gap-2.5 text-left focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded-lg py-0.5 group">
                        <i id="lms-topic-chevron-${topic.id}"
                            class="fa-solid fa-chevron-right text-xs text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200 transition-transform duration-200 shrink-0 ${isTopicOpen ? 'rotate-90' : ''}"></i>
                        <div class="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 flex items-center justify-center text-xs font-bold shrink-0 border border-emerald-200/60 dark:border-emerald-800/60">
                            ${topic.order_index || (tIdx + 1)}
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-baseline gap-2 flex-wrap">
                                <h4 class="font-bold text-slate-800 dark:text-slate-100 text-sm sm:text-base leading-none group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                                    ${escapeHTML(topic.title)}
                                </h4>
                                <span class="text-xs text-slate-500 dark:text-slate-400 font-normal">
                                    • ${topicMaterials.length} materi${topicMaterials.length > 0 ? (topicTeachingCompleted ? '<span class="text-teal-600 dark:text-teal-400 font-medium"> • Selesai dibahas</span>' : ` • ${teachingCompletedCount}/${topicMaterials.length} dibahas`) : ''}
                                </span>
                            </div>
                            ${topic.description ? `<p class="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">${escapeHTML(topic.description)}</p>` : ''}
                        </div>
                    </button>

                    <div class="flex items-center gap-1.5 shrink-0">
                        <button onclick="window.openLmsTopicModal('${topic.id}')"
                            class="h-7 sm:h-8 px-2.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 transition flex items-center gap-1.5 shadow-2xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            title="Edit Topik" aria-label="Edit Topik">
                            <i class="fa-solid fa-pen text-[10px]"></i>
                            <span class="hidden sm:inline">Edit Topik</span>
                        </button>

                        <details class="relative inline-block text-left group">
                            <summary class="list-none cursor-pointer h-7 w-7 sm:h-8 sm:w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition focus:outline-none focus:ring-2 focus:ring-emerald-500" title="Opsi Topik" aria-label="Opsi Topik">
                                <i class="fa-solid fa-ellipsis-vertical text-xs"></i>
                            </summary>
                            <div class="absolute right-0 mt-1 w-40 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-20">
                                <button type="button" onclick="window.quickMoveLmsTopic('${topic.id}', 'up')" ${isFirstTopic ? 'disabled' : ''}
                                    class="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none flex items-center gap-2">
                                    <i class="fa-solid fa-arrow-up text-[10px] w-3 text-slate-400"></i> Geser Naik
                                </button>
                                <button type="button" onclick="window.quickMoveLmsTopic('${topic.id}', 'down')" ${isLastTopic ? 'disabled' : ''}
                                    class="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none flex items-center gap-2">
                                    <i class="fa-solid fa-arrow-down text-[10px] w-3 text-slate-400"></i> Geser Turun
                                </button>
                                <div class="my-1 border-t border-slate-100 dark:border-slate-700"></div>
                                <button type="button" onclick="window.deleteLmsTopic('${topic.id}')"
                                    class="w-full text-left px-3 py-1.5 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2 font-medium">
                                    <i class="fa-solid fa-trash text-[10px] w-3"></i> Hapus Topik
                                </button>
                            </div>
                        </details>
                    </div>
                </div>

                <!-- Materials List inside Topic -->
                <div id="lms-topic-body-${topic.id}" class="${isTopicOpen ? '' : 'hidden'} p-2.5 sm:p-3 space-y-2 sm:space-y-2.5">
        `;

        if (topicMaterials.length === 0) {
            html += `
                <div class="text-center py-6 text-slate-400 text-xs font-medium">
                    Belum ada modul materi pada topik ini. Gunakan tombol <strong>"+ Tambah Modul"</strong> di bagian atas untuk menambahkan materi pembelajaran.
                </div>
            `;
        } else {
            topicMaterials.forEach((mat, mIdx) => {
                const isFirstMat = mIdx === 0;
                const isLastMat = mIdx === topicMaterials.length - 1;
                const isMatOpen = expandedState.materials.has(mat.id);

                let resIcon = '<i class="fa-solid fa-link text-indigo-500 text-[10px]"></i>';
                let resLabel = 'Tautan Web';
                if (mat.resource_type === 'gdrive') {
                    resIcon = '<i class="fa-brands fa-google-drive text-blue-500 text-[10px]"></i>';
                    resLabel = 'Google Drive';
                } else if (mat.resource_type === 'youtube') {
                    resIcon = '<i class="fa-brands fa-youtube text-rose-500 text-[10px]"></i>';
                    resLabel = 'YouTube Video';
                } else if (mat.resource_type === 'text') {
                    resIcon = '<i class="fa-solid fa-file-lines text-teal-600 text-[10px]"></i>';
                    resLabel = 'Teks Mandiri';
                } else if (mat.resource_type === 'html') {
                    resIcon = '<i class="fa-solid fa-code text-emerald-600 text-[10px]"></i>';
                    resLabel = 'HTML Interaktif';
                } else if (mat.resource_type === 'quiz') {
                    resIcon = '<i class="fa-solid fa-circle-question text-purple-600 text-[10px]"></i>';
                    resLabel = 'Kuis Formatif';
                }

                const completedCount = Number(mat.completed_count) || 0;
                const discCount = Number(mat.discussion_count) || 0;
                const activeClass = (mat.class_name || document.getElementById('select-kelas')?.value || '').trim();
                const filteredLoadedStudents = (Array.isArray(loadedStudents) ? loadedStudents : []).filter(s => {
                    if (!s || !s.class) return false;
                    if (typeof isClassEqual === 'function') return isClassEqual(s.class, activeClass);
                    return (s.class || '').trim().toLowerCase() === activeClass.toLowerCase();
                });
                const totalStudents = Number(mat.total_students)
                    || (filteredLoadedStudents.length > 0 ? filteredLoadedStudents.length : 0)
                    || (currentLmsAnalytics && Array.isArray(currentLmsAnalytics.data) ? currentLmsAnalytics.data.length : 0);
                const percentDone = totalStudents > 0 ? Math.min(100, Math.round((completedCount / totalStudents) * 100)) : 0;

                const materialSchedule = getLmsScheduleState(mat);
                let publishBadgeHtml = '';
                if (mat.is_published === 0) {
                    publishBadgeHtml = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 text-[11px] font-medium"><i class="fa-solid fa-eye-slash text-[9px]"></i> Draft</span>';
                } else if (mat.is_published === 2) {
                    const isLive = mat.publish_at ? new Date(mat.publish_at).getTime() <= Date.now() : false;
                    if (isLive) {
                        publishBadgeHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60 text-[11px] font-medium" title="Tayang sejak ${formatLmsPublishDate(mat.publish_at)}"><i class="fa-solid fa-circle-check text-[9px]"></i> Aktif</span>`;
                    } else {
                        publishBadgeHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200/60 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60 text-[11px] font-medium" title="Akan tayang pada ${formatLmsPublishDate(mat.publish_at)}"><i class="fa-solid fa-clock text-[9px]"></i> Terjadwal: ${formatLmsPublishDate(mat.publish_at)}</span>`;
                    }
                } else {
                    publishBadgeHtml = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60 text-[11px] font-medium"><i class="fa-solid fa-circle-check text-[9px]"></i> Aktif</span>';
                }

                const teachingBadgeHtml = materialSchedule.teachingCompleted
                    ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300 text-[11px] font-normal" title="Pembahasan selesai. Materi tetap dapat dipelajari dan dituntaskan siswa."><i class="fa-solid fa-chalkboard-user text-[9px] text-teal-500"></i> Selesai Dibahas</span>'
                    : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50/70 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 text-[11px] font-normal" title="Modul sedang aktif dibahas"><i class="fa-solid fa-person-chalkboard text-[9px] text-amber-500"></i> Sedang Dibahas</span>';

                let dueBadgeHtml = '';
                if (mat.due_date) {
                    const urgency = calculateDueDateUrgency(mat.due_date, false);
                    const isUrgent = urgency.isUrgent;
                    const dueCls = isUrgent
                        ? (urgency.level === 'overdue' ? 'bg-rose-50 text-rose-700 border border-rose-200/80 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800' : 'bg-amber-50 text-amber-800 border border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800')
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60';
                    dueBadgeHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${dueCls}" title="Batas waktu pengerjaan"><i class="${urgency.icon} text-[10px]"></i> <span>${escapeHTML(urgency.label.replace(/^Target:\s*/i, ''))}</span></span>`;
                }

                const isTextResource = ['text', 'html'].includes(mat.resource_type);

                html += `
                    <div class="lms-material-card bg-white dark:bg-slate-800/40 p-3 sm:p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 transition hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-2xs"
                        data-material-id="${mat.id}"
                        data-material-title="${escapeHTML(mat.title)}"
                        data-material-desc="${escapeHTML(getLmsMaterialInstructions(mat))}"
                        data-material-disc="${escapeHTML(mat.discussion_prompt || '')}">

                        <!-- Summary Row -->
                        <div class="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 min-h-[38px]">
                            <button type="button" id="lms-mat-toggle-btn-${mat.id}"
                                onclick="window.toggleLmsMaterialCollapse('${mat.id}')"
                                aria-expanded="${isMatOpen}"
                                aria-controls="lms-mat-detail-${mat.id}"
                                class="flex-1 min-w-0 flex items-center gap-2 text-left focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded-lg py-0.5 group">
                                <i id="lms-mat-chevron-${mat.id}"
                                    class="fa-solid fa-chevron-right text-[11px] transition-transform duration-200 shrink-0 ${isMatOpen ? 'rotate-90 text-emerald-600 dark:text-emerald-400' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200'}"></i>
                                <div class="min-w-0 flex-1 flex items-baseline gap-2 flex-wrap">
                                    <h5 class="text-sm sm:text-[15px] font-bold text-slate-900 dark:text-slate-100 leading-snug group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                                        ${escapeHTML(mat.title)}
                                    </h5>
                                    <div class="flex items-center gap-1.5 flex-wrap">
                                        ${publishBadgeHtml}
                                        ${teachingBadgeHtml}
                                        ${dueBadgeHtml}
                                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-semibold border border-slate-200/60 dark:border-slate-700/60" title="Progres ketuntasan siswa">
                                            ${percentDone}%
                                        </span>
                                    </div>
                                </div>
                            </button>

                            <div class="flex items-center gap-1.5 shrink-0 ml-auto sm:ml-0">
                                ${isTextResource ? `
                                    <button type="button" onclick="window.previewTeacherLmsText('${mat.id}')"
                                        class="h-7 px-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80 rounded-lg text-xs font-bold transition inline-flex items-center gap-1.5 shrink-0 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-2xs"
                                        title="Buka Materi (Pratinjau Teks Mandiri)" aria-label="Buka Materi">
                                        <i class="fa-solid fa-eye text-xs"></i>
                                        <span class="hidden sm:inline">Buka Materi</span>
                                    </button>
                                ` : (mat.resource_url ? `
                                    <a href="${escapeHTML(mat.resource_url)}" target="_blank" rel="noopener noreferrer"
                                        class="h-7 px-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80 rounded-lg text-xs font-bold transition inline-flex items-center gap-1.5 shrink-0 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-2xs"
                                        title="Buka Tautan Materi" aria-label="Buka Materi">
                                        <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                                        <span class="hidden sm:inline">Buka Materi</span>
                                    </a>
                                ` : '')}

                                ${(Number(mat.is_published) === 1 || (Number(mat.is_published) === 2 && Date.parse(mat.publish_at) <= Date.now())) ? `<button type="button" data-lms-journal-material="${escapeHTML(mat.id)}"
                                    class="h-7 px-2 sm:px-2.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 rounded-lg text-xs font-semibold border border-emerald-200 dark:border-emerald-800 shrink-0">Sinkron Jurnal Mengajar</button>` : ''}
                                <button type="button" onclick="window.openLmsMaterialModal('${mat.id}', '${topic.id}')"
                                    class="h-7 px-2 sm:px-2.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg text-xs font-semibold transition inline-flex items-center gap-1.5 shrink-0 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                    title="Edit Modul" aria-label="Edit Modul">
                                    <i class="fa-solid fa-pen text-[10px]"></i>
                                    <span class="hidden sm:inline">Edit</span>
                                </button>

                                <details class="relative inline-block text-left group">
                                    <summary class="list-none cursor-pointer h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition focus:outline-none focus:ring-2 focus:ring-emerald-500" title="Menu Opsi Lainnya" aria-label="Menu Opsi Lainnya">
                                        <i class="fa-solid fa-ellipsis-vertical text-xs"></i>
                                    </summary>
                                    <div class="absolute right-0 mt-1 w-36 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-20">
                                        ${materialSchedule.teachingCompleted ? `<button type="button" onclick="window.reactivateLmsMaterial('${mat.id}')" class="w-full text-left px-3 py-2 text-xs font-semibold text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950">Aktifkan Kembali</button>` : ''}
                                        <button type="button" onclick="window.quickMoveLmsMaterial('${mat.id}', 'up')" ${isFirstMat ? 'disabled' : ''}
                                            class="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none flex items-center gap-2">
                                            <i class="fa-solid fa-arrow-up text-[10px] w-3 text-slate-400"></i> Geser Naik
                                        </button>
                                        <button type="button" onclick="window.quickMoveLmsMaterial('${mat.id}', 'down')" ${isLastMat ? 'disabled' : ''}
                                            class="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none flex items-center gap-2">
                                            <i class="fa-solid fa-arrow-down text-[10px] w-3 text-slate-400"></i> Geser Turun
                                        </button>
                                        <div class="my-1 border-t border-slate-100 dark:border-slate-700"></div>
                                        <button type="button" onclick="window.deleteLmsMaterial('${mat.id}')"
                                            class="w-full text-left px-3 py-1.5 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2 font-medium">
                                            <i class="fa-solid fa-trash text-[10px] w-3"></i> Hapus Modul
                                        </button>
                                    </div>
                                </details>
                            </div>
                        </div>

                        <!-- Panel Detail Materi -->
                        <div id="lms-mat-detail-${mat.id}" class="${isMatOpen ? '' : 'hidden'} border-t border-slate-100 dark:border-slate-800/80 pt-2.5 mt-2 space-y-2.5 text-xs">
                            ${mat.content_description && mat.resource_type !== 'html' ? `
                                <p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-sans break-words">
                                    ${escapeHTML(mat.content_description)}
                                </p>
                            ` : ''}

                            <div class="flex flex-col md:flex-row md:items-end justify-between gap-3 pt-0.5">
                                <div class="flex-1 min-w-0 space-y-1.5">
                                    <div class="flex items-center gap-1.5 flex-wrap">
                                        <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-medium border border-slate-200/60 dark:border-slate-700/60">
                                            ${resIcon} <span>${resLabel}</span>
                                        </span>
                                        ${mat.due_date ? dueBadgeHtml : ''}
                                    </div>

                                    ${Number(mat.allow_discussion) === 1 ? `
                                        <div class="pt-0.5">
                                            <button type="button" onclick="window.openLmsDiscussionModal('${mat.id}')"
                                                class="group inline-flex items-center gap-1.5 max-w-full text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition text-left focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded"
                                                title="Buka Ruang Diskusi Siswa: ${escapeHTML(mat.discussion_prompt || 'Ruang diskusi')}" aria-label="Buka Ruang Diskusi Siswa">
                                                <i class="fa-solid fa-comments text-indigo-500 text-[11px] shrink-0"></i>
                                                <span class="font-medium text-slate-700 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 truncate">
                                                    Diskusi: ${escapeHTML(mat.discussion_prompt || 'Ruang diskusi')}
                                                </span>
                                                <span class="shrink-0 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-1.5 py-0.5 rounded border border-indigo-100 dark:border-indigo-900/60">
                                                    ${discCount} balasan
                                                </span>
                                                <i class="fa-solid fa-arrow-right text-[9px] text-indigo-400 group-hover:translate-x-0.5 transition-transform shrink-0"></i>
                                            </button>
                                        </div>
                                    ` : ''}
                                </div>

                                <div class="w-full md:w-56 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800 space-y-1">
                                    <div class="flex items-center justify-between text-[11px]">
                                        <span class="text-slate-500 dark:text-slate-400 font-medium">Progres siswa</span>
                                        <span class="font-bold text-slate-800 dark:text-slate-100">
                                            ${totalStudents > 0 ? `${completedCount}/${totalStudents} siswa` : `${completedCount} siswa`} • <span class="${percentDone === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}">${percentDone}%</span>
                                        </span>
                                    </div>
                                    <div class="w-full bg-slate-100 dark:bg-slate-700/60 h-1.5 rounded-full overflow-hidden">
                                        <div class="h-full rounded-full transition-all duration-300 ${percentDone === 100 ? 'bg-emerald-500' : percentDone > 0 ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-600'}" style="width: ${percentDone}%"></div>
                                    </div>
                                    <div class="flex justify-end pt-0.5">
                                        <button type="button" onclick="window.openLmsProgressModal('${mat.id}')"
                                            class="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline transition focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded"
                                            title="Pantau Rekapitulasi Progres Siswa Rombel" aria-label="Lihat Progres Siswa">
                                            <i class="fa-solid fa-chart-simple text-[10px] text-slate-400"></i>
                                            <span>Lihat Progres</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        html += `
                </div>
            </div>
        `;
    });

    topicsContainer.innerHTML = html;
}

if (typeof window !== 'undefined' && !window._lmsDetailsClickRegistered) {
    window._lmsDetailsClickRegistered = true;
    document.addEventListener('click', (e) => {
        if (!e.target.closest('details.relative')) {
            document.querySelectorAll('#lms-topics-container details.relative[open]').forEach(el => el.removeAttribute('open'));
        }
    });
}

function renderLmsClassAnalytics() {
    const statTotal = document.getElementById('lms-stat-total-students');
    const statSangatAktif = document.getElementById('lms-stat-sangat-aktif');
    const statAktif = document.getElementById('lms-stat-aktif');
    const statPerlu = document.getElementById('lms-stat-perlu-perhatian');
    const statAvg = document.getElementById('lms-stat-avg-completion');
    const scopeLabel = document.getElementById('lms-analytics-scope-label');
    const discBadge = document.getElementById('lms-analytics-discussion-badge');
    const trHeader = document.getElementById('tr-lms-analytics-headers');
    const tbody = document.getElementById('tbody-lms-analytics');

    if (!currentLmsAnalytics || !currentLmsAnalytics.data) {
        [statTotal, statSangatAktif, statAktif, statPerlu].forEach(el => { if (el) el.textContent = '0'; });
        if (statAvg) statAvg.textContent = '0%';
        if (scopeLabel) scopeLabel.textContent = 'Pilih kelas & mapel lalu load data';
        if (discBadge) discBadge.classList.add('hidden');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="py-8 text-center text-slate-400">
                        Belum ada data matriks keaktifan. Silakan pilih kelas &amp; mapel lalu load data.
                    </td>
                </tr>
            `;
        }
        return;
    }

    const list = currentLmsAnalytics.data || [];
    const isSingleMaterial = currentLmsAnalytics.scope === 'material' || Boolean(currentLmsAnalytics.material_id);
    const selectedMatId = currentLmsAnalytics.material_id;
    const selectedMat = (currentLmsMaterials || []).find(m => String(m.id) === String(selectedMatId));
    const isDiscussionRequired = selectedMat ? Number(selectedMat.allow_discussion) === 1 : (currentLmsAnalytics.allow_discussion === true);
    const hasDiscussionInScope = currentLmsAnalytics.has_discussion_in_scope !== undefined
        ? Boolean(currentLmsAnalytics.has_discussion_in_scope)
        : (isSingleMaterial ? isDiscussionRequired : (currentLmsMaterials || []).some(m => Number(m.allow_discussion) === 1));

    if (isSingleMaterial) {
        const matTitle = currentLmsAnalytics.material_title || selectedMat?.title || 'Modul Terpilih';
        const topTitle = currentLmsAnalytics.topic_title || (currentLmsTopics || []).find(t => String(t.id) === String(selectedMat?.topic_id))?.title || '';
        if (scopeLabel) {
            scopeLabel.textContent = topTitle ? `Topik: ${topTitle} • Modul: ${matTitle}` : `Modul: ${matTitle}`;
        }
        if (discBadge) {
            discBadge.classList.remove('hidden');
            if (isDiscussionRequired) {
                discBadge.className = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800';
                discBadge.innerHTML = '<i class="fa-solid fa-comments text-indigo-600 dark:text-indigo-400 text-[9px]"></i> Ruang Diskusi Wajib Aktif';
            } else {
                discBadge.className = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700';
                discBadge.innerHTML = '<i class="fa-solid fa-book-open text-slate-500 text-[9px]"></i> Modul Mandiri (Tanpa Diskusi)';
            }
        }
    } else {
        const topicTitle = currentLmsAnalytics.topic_title || (currentLmsTopics || []).find(topic => String(topic.id) === String(currentLmsAnalyticsTopicId))?.title || '';
        if (scopeLabel) {
            scopeLabel.textContent = currentLmsAnalytics.scope === 'topic' || currentLmsAnalyticsTopicId
                ? `Topik: ${topicTitle || 'Topik terpilih'} — ${Number(currentLmsAnalytics.total_materials) || 0} modul`
                : `Global — seluruh topik (${Number(currentLmsAnalytics.total_materials) || 0} modul)`;
        }
        if (discBadge) {
            if (!hasDiscussionInScope) {
                discBadge.classList.remove('hidden');
                discBadge.className = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700';
                discBadge.innerHTML = '<i class="fa-solid fa-ban text-slate-400 text-[9px]"></i> Topik Tanpa Diskusi';
            } else {
                discBadge.classList.add('hidden');
            }
        }
    }

    if (trHeader) {
        if (isSingleMaterial) {
            trHeader.innerHTML = `
                <th class="py-2.5 px-2 text-center w-8">No</th>
                <th class="py-2.5 px-3">NIS</th>
                <th class="py-2.5 px-3 min-w-[150px]">Nama Siswa</th>
                <th class="py-2.5 px-2 text-center">Status Akses / Baca</th>
                <th class="py-2.5 px-2 text-center ${isDiscussionRequired ? 'text-indigo-600 dark:text-indigo-400 font-bold' : 'text-slate-400 font-normal'}">
                    ${isDiscussionRequired ? '<i class="fa-solid fa-comments mr-1 text-[10px]"></i>Partisipasi Diskusi' : 'Diskusi'}
                </th>
                <th class="py-2.5 px-3 text-center min-w-[110px]">% Ketuntasan</th>
                <th class="py-2.5 px-3 text-center">Status Keaktifan</th>
                <th class="py-2.5 px-2 text-center">Aksi Cepat</th>
            `;
        } else {
            trHeader.innerHTML = `
                <th class="py-2.5 px-2 text-center w-8">No</th>
                <th class="py-2.5 px-3">NIS</th>
                <th class="py-2.5 px-3 min-w-[150px]">Nama Siswa</th>
                <th class="py-2.5 px-2 text-center">Total Modul</th>
                <th class="py-2.5 px-2 text-center text-emerald-600">Modul Selesai</th>
                <th class="py-2.5 px-2 text-center text-slate-400">Belum Buka</th>
                <th class="py-2.5 px-2 text-center ${hasDiscussionInScope ? 'text-indigo-500' : 'text-slate-400 font-normal'}">
                    Diskusi ${!hasDiscussionInScope ? '<span class="text-[9px] text-slate-400">(Nonaktif)</span>' : ''}
                </th>
                <th class="py-2.5 px-3 text-center min-w-[110px]">% Ketuntasan</th>
                <th class="py-2.5 px-3 text-center">Status Keaktifan</th>
            `;
        }
    }

    list.forEach(s => {
        s.engagement_badge = getLmsStudentEngagementBadge(s);
        s.status_badge = s.engagement_badge;
        s.engagement_score = Number(s.engagement_score ?? s.total_score ?? 0);
        s.total_score = s.engagement_score;
    });

    const summary = currentLmsAnalytics.summary || {};
    const totalStudents = summary.total_students ?? list.length;
    const sangatAktifCount = summary.sangat_aktif_count ?? list.filter(s => s.engagement_badge === 'Sangat Aktif').length;
    const aktifCount = summary.aktif_count ?? list.filter(s => s.engagement_badge === 'Aktif').length;
    const perluPerhatianCount = summary.perlu_perhatian_count ?? list.filter(s => s.engagement_badge === 'Perlu Perhatian').length;
    const avgRate = summary.average_completion_rate ?? (list.length > 0 ? Math.round(list.reduce((acc, c) => acc + (Number(c.completion_rate) || 0), 0) / list.length) : 0);

    if (statTotal) statTotal.textContent = totalStudents;
    if (statSangatAktif) statSangatAktif.textContent = sangatAktifCount;
    if (statAktif) statAktif.textContent = aktifCount;
    if (statPerlu) statPerlu.textContent = perluPerhatianCount;
    if (statAvg) statAvg.textContent = `${avgRate}%`;

    if (!tbody) return;

    if (list.length === 0) {
        const colSpan = isSingleMaterial ? 8 : 9;
        tbody.innerHTML = `
            <tr>
                <td colspan="${colSpan}" class="py-8 text-center text-slate-400">
                    Tidak ada data siswa ditemukan di rombel ini.
                </td>
            </tr>
        `;
        return;
    }

    window.filterLmsAnalyticsTable();
}

function renderLmsAnalyticsTableRows(list) {
    const tbody = document.getElementById('tbody-lms-analytics');
    if (!tbody) return;

    const isSingleMaterial = currentLmsAnalytics && (currentLmsAnalytics.scope === 'material' || Boolean(currentLmsAnalytics.material_id));
    const selectedMatId = currentLmsAnalytics?.material_id;
    const selectedMat = (currentLmsMaterials || []).find(m => String(m.id) === String(selectedMatId));
    const isDiscussionRequired = selectedMat ? Number(selectedMat.allow_discussion) === 1 : (currentLmsAnalytics?.allow_discussion === true);

    const colSpan = isSingleMaterial ? 8 : 9;

    if (!list || list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="${colSpan}" class="py-8 text-center text-slate-400">
                    Tidak ada data siswa yang cocok dengan pencarian / filter.
                </td>
            </tr>
        `;
        return;
    }

    let rowsHtml = '';
    list.forEach((s, idx) => {
        const badge = getLmsStudentEngagementBadge(s);
        let badgeBg = 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300';
        let badgeIcon = 'fa-triangle-exclamation';

        if (badge === 'Sangat Aktif') {
            badgeBg = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300';
            badgeIcon = 'fa-star text-amber-400';
        } else if (badge === 'Aktif') {
            badgeBg = 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300';
            badgeIcon = 'fa-thumbs-up text-blue-500';
        }

        const compRate = Number(s.completion_rate) || 0;
        const sPhotoUrl = s.active_photo_url ? (typeof window.resolvePhotoUrl === 'function' ? window.resolvePhotoUrl(s.active_photo_url) : s.active_photo_url) : '';
        const sInitial = (s.name || 'S').charAt(0).toUpperCase();
        const sAvatarHtml = sPhotoUrl
            ? `<div class="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] shrink-0 overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700 shadow-2xs"><img src="${sPhotoUrl}" alt="${escapeHTML(s.name || '')}" class="w-full h-full object-cover" onerror="this.onerror=null; this.parentElement.classList.add('bg-blue-600','text-white','font-bold'); this.parentElement.innerHTML='${sInitial}';" /></div>`
            : `<div class="w-6 h-6 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold shrink-0 shadow-2xs">${sInitial}</div>`;
        const studentNameColHtml = `
            <div class="flex items-center gap-2">
                ${sAvatarHtml}
                <span class="truncate max-w-[160px] sm:max-w-[200px]" title="${escapeHTML(s.name || '-')}">${escapeHTML(s.name || '-')}</span>
                ${s.is_late ? `<span class="text-[10px] font-bold text-amber-700 dark:text-amber-300" title="Aktivitas susulan setelah selesai dibahas; tanpa potongan nilai otomatis">Terlambat${!isSingleMaterial && Number(s.late_count) > 1 ? ` • ${Number(s.late_count)} materi` : ''}</span>` : ''}
            </div>
        `;

        if (isSingleMaterial) {
            const hasOpened = Boolean(s.has_opened || s.first_opened_at || s.opened_count > 0 || s.completed_count > 0);
            const isCompleted = Number(s.completed_count) > 0 || s.status === 'completed';
            const discCount = Number(s.discussion_count) || 0;

            let accessBadgeHtml = '<span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-500 dark:bg-slate-800">Belum Buka</span>';
            if (isCompleted) {
                accessBadgeHtml = '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 inline-flex items-center justify-center gap-1"><i class="fa-solid fa-circle-check text-emerald-500 text-[9px]"></i> Selesai Membaca</span>';
            } else if (hasOpened) {
                accessBadgeHtml = '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 inline-flex items-center justify-center gap-1"><i class="fa-solid fa-clock text-amber-500 text-[9px]"></i> Sedang Membaca</span>';
            }

            let discCellHtml = '';
            if (isDiscussionRequired) {
                if (discCount > 0) {
                    discCellHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/80"><i class="fa-solid fa-circle-check text-emerald-500 text-[9px]"></i> ${discCount} balasan</span>`;
                } else {
                    discCellHtml = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200/80 dark:border-rose-800/80"><i class="fa-solid fa-circle-xmark text-rose-500 text-[9px]"></i> Belum respon</span>';
                }
            } else {
                discCellHtml = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60"><i class="fa-solid fa-ban text-[9px]"></i> Tanpa Diskusi</span>';
            }

            let completionCellHtml = '';
            if (isCompleted) {
                completionCellHtml = `
                    <div class="flex items-center justify-center gap-1.5">
                        <span class="font-black text-xs text-emerald-600 dark:text-emerald-400">100%</span>
                        <div class="w-10 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                            <div class="bg-emerald-500 h-full rounded-full" style="width: 100%"></div>
                        </div>
                    </div>
                `;
            } else if (hasOpened && isDiscussionRequired && discCount === 0) {
                completionCellHtml = `
                    <div class="flex flex-col items-center">
                        <span class="font-black text-[11px] text-amber-600 dark:text-amber-400 leading-tight">50% <span class="text-[9px] font-semibold block">(Kurang Diskusi)</span></span>
                        <div class="w-10 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden mt-0.5">
                            <div class="bg-amber-500 h-full rounded-full" style="width: 50%"></div>
                        </div>
                    </div>
                `;
            } else if (hasOpened) {
                completionCellHtml = `
                    <div class="flex items-center justify-center gap-1.5">
                        <span class="font-black text-xs text-amber-600">50%</span>
                        <div class="w-10 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                            <div class="bg-amber-500 h-full rounded-full" style="width: 50%"></div>
                        </div>
                    </div>
                `;
            } else {
                completionCellHtml = '<span class="text-xs font-bold text-slate-400">0%</span>';
            }

            const actionBtn = isCompleted
                ? `<button onclick="window.overrideStudentProgress('${escapeHTML(s.nis)}', 'reset', '${escapeHTML(selectedMatId)}')" class="px-2 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 rounded border border-rose-200 text-[10px] font-bold transition flex items-center gap-1 mx-auto" title="Reset status siswa ini agar mempelajari ulang"><i class="fa-solid fa-rotate-left text-[9px]"></i><span>Reset</span></button>`
                : `<button onclick="window.overrideStudentProgress('${escapeHTML(s.nis)}', 'complete', '${escapeHTML(selectedMatId)}')" class="px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 rounded border border-emerald-200 text-[10px] font-bold transition flex items-center gap-1 mx-auto" title="Verifikasi ketuntasan belajar siswa"><i class="fa-solid fa-check text-[9px]"></i><span>Verifikasi</span></button>`;

            rowsHtml += `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td class="py-2.5 px-2 text-center font-bold text-slate-400">${idx + 1}</td>
                    <td class="py-2.5 px-3 font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300">${escapeHTML(s.nis || '-')}</td>
                    <td class="py-2.5 px-3 font-bold text-slate-800 dark:text-slate-100">${studentNameColHtml}</td>
                    <td class="py-2.5 px-2 text-center">${accessBadgeHtml}</td>
                    <td class="py-2.5 px-2 text-center">${discCellHtml}</td>
                    <td class="py-2.5 px-3 text-center">${completionCellHtml}</td>
                    <td class="py-2.5 px-3 text-center">
                        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${badgeBg}">
                            <i class="fa-solid ${badgeIcon}"></i>
                            <span>${escapeHTML(badge)}</span>
                        </span>
                    </td>
                    <td class="py-2.5 px-2 text-center">${actionBtn}</td>
                </tr>
            `;
        } else {
            const discText = (currentLmsAnalytics?.has_discussion_in_scope)
                ? `<span class="font-extrabold text-indigo-500">${s.discussion_count ?? 0}</span>`
                : `<span class="text-slate-400 text-[11px]">-</span>`;

            rowsHtml += `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td class="py-2.5 px-2 text-center font-bold text-slate-400">${idx + 1}</td>
                    <td class="py-2.5 px-3 font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300">${escapeHTML(s.nis || '-')}</td>
                    <td class="py-2.5 px-3 font-bold text-slate-800 dark:text-slate-100">${studentNameColHtml}</td>
                    <td class="py-2.5 px-2 text-center font-extrabold text-slate-600 dark:text-slate-300">${s.total_materials ?? 0}</td>
                    <td class="py-2.5 px-2 text-center font-extrabold text-emerald-600">${s.completed_count ?? 0}</td>
                    <td class="py-2.5 px-2 text-center font-extrabold text-slate-400">${s.not_started_count ?? 0}</td>
                    <td class="py-2.5 px-2 text-center">${discText}</td>
                    <td class="py-2.5 px-3 text-center">
                        <div class="flex items-center justify-center gap-1.5">
                            <span class="font-black text-xs">${compRate}%</span>
                            <div class="w-12 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                                <div class="bg-emerald-500 h-full rounded-full" style="width: ${compRate}%"></div>
                            </div>
                        </div>
                    </td>
                    <td class="py-2.5 px-3 text-center">
                        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${badgeBg}">
                            <i class="fa-solid ${badgeIcon}"></i>
                            <span>${escapeHTML(badge)}</span>
                        </span>
                    </td>
                </tr>
            `;
        }
    });

    tbody.innerHTML = rowsHtml;
}

window.filterLmsAnalyticsTable = function () {
    if (!currentLmsAnalytics || !currentLmsAnalytics.data) return;

    const q = (document.getElementById('input-search-lms-analytics')?.value || '').toLowerCase().trim();
    const badge = (document.getElementById('select-filter-lms-analytics-badge')?.value || '').trim();

    const filtered = currentLmsAnalytics.data.filter(s => {
        const studentBadge = getLmsStudentEngagementBadge(s);
        const matchesQuery = !q || (s.name || '').toLowerCase().includes(q) || String(s.nis || '').includes(q);
        const matchesBadge = !badge || studentBadge === badge;
        return matchesQuery && matchesBadge;
    });

    renderLmsAnalyticsTableRows(filtered);
};

window.filterLmsMaterials = function () {
    if (window.lmsModuleWorkspace) return renderLmsMaterialsList();
    const q = (document.getElementById('input-search-lms')?.value || '').trim().toLowerCase();
    const topicsContainer = document.getElementById('lms-topics-container');
    if (!topicsContainer) return;

    if (!q) {
        renderLmsMaterialsList();
        return;
    }

    const topicCards = topicsContainer.querySelectorAll('.lms-topic-card');
    topicCards.forEach(topicEl => {
        const topicId = topicEl.getAttribute('data-topic-id');
        const topicTitle = (topicEl.getAttribute('data-topic-title') || '').toLowerCase();
        const topicDesc = (topicEl.getAttribute('data-topic-desc') || '').toLowerCase();
        const topicSelfMatch = topicTitle.includes(q) || topicDesc.includes(q);

        let matchedMaterialCount = 0;
        const matCards = topicEl.querySelectorAll('.lms-material-card');
        matCards.forEach(matEl => {
            const matId = matEl.getAttribute('data-material-id');
            const matTitle = (matEl.getAttribute('data-material-title') || '').toLowerCase();
            const matDesc = (matEl.getAttribute('data-material-desc') || '').toLowerCase();
            const matDisc = (matEl.getAttribute('data-material-disc') || '').toLowerCase();

            const titleMatch = matTitle.includes(q);
            const detailMatch = matDesc.includes(q) || matDisc.includes(q);
            const matMatched = topicSelfMatch || titleMatch || detailMatch;

            if (matMatched) {
                matEl.style.display = '';
                matchedMaterialCount++;
                if (detailMatch) {
                    const detailEl = document.getElementById(`lms-mat-detail-${matId}`);
                    const btnEl = document.getElementById(`lms-mat-toggle-btn-${matId}`);
                    const chevronEl = document.getElementById(`lms-mat-chevron-${matId}`);
                    if (detailEl) detailEl.classList.remove('hidden');
                    if (btnEl) btnEl.setAttribute('aria-expanded', 'true');
                    if (chevronEl) {
                        chevronEl.classList.add('rotate-90', 'text-emerald-600', 'dark:text-emerald-400');
                        chevronEl.classList.remove('text-slate-400');
                    }
                }
            } else {
                matEl.style.display = 'none';
            }
        });

        if (topicSelfMatch || matchedMaterialCount > 0) {
            topicEl.style.display = '';
            const bodyEl = document.getElementById(`lms-topic-body-${topicId}`);
            const btnEl = document.getElementById(`lms-topic-toggle-btn-${topicId}`);
            const chevronEl = document.getElementById(`lms-topic-chevron-${topicId}`);
            if (bodyEl) bodyEl.classList.remove('hidden');
            if (btnEl) btnEl.setAttribute('aria-expanded', 'true');
            if (chevronEl) chevronEl.classList.add('rotate-90');
        } else {
            topicEl.style.display = 'none';
        }
    });
};

let currentLmsCreatorMode = 'create';
let currentLmsCreatorStep = 1;
let lmsCopyLoadedSourceData = { topics: [], materials: [] };

export function getEligibleClassesForLmsTarget(mapel, kelas) {
    if (!kelas) return [];
    const currentTingkat = typeof getTingkatFromKelas === 'function' ? getTingkatFromKelas(kelas) : 'ALL';

    let candidateClasses = [];
    if (typeof assignedMapelMap !== 'undefined' && assignedMapelMap && Array.isArray(assignedMapelMap[mapel]) && assignedMapelMap[mapel].length > 0) {
        candidateClasses = [...assignedMapelMap[mapel]];
    } else if (typeof availableClasses !== 'undefined' && Array.isArray(availableClasses) && availableClasses.length > 0) {
        candidateClasses = [...availableClasses];
    } else {
        candidateClasses = [kelas];
    }

    const filtered = candidateClasses.filter(c => {
        if (!c) return false;
        const t = typeof getTingkatFromKelas === 'function' ? getTingkatFromKelas(c) : 'ALL';
        return t === currentTingkat;
    });

    if (kelas && !filtered.some(c => typeof isClassEqual === 'function' ? isClassEqual(c, kelas) : c.trim().toLowerCase() === kelas.trim().toLowerCase())) {
        filtered.unshift(kelas);
    }

    return filtered.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}
window.getEligibleClassesForLmsTarget = getEligibleClassesForLmsTarget;

window.openUnifiedLmsCreator = function (mode = 'create', step = 1, topicId = null, materialId = null) {
    if (window.lmsModuleWorkspace && mode === 'create' && step === 2) {
        const packet = currentLmsMaterials.find(p => p.id === materialId);
        return window.lmsModuleWorkspace.open(packet?.module_id || materialId, topicId);
    }
    const topicIdentityInput = document.getElementById('input-lms-topic-id');
    if (topicIdentityInput) delete topicIdentityInput.dataset.requestId;
    if (typeof mode === 'object' && mode !== null) {
        const opts = mode;
        mode = opts.mode || 'create';
        step = opts.step || 1;
        topicId = opts.topicId || null;
        materialId = opts.materialId || null;
    }

    const mapel = document.getElementById('select-mapel')?.value || '';
    const kelas = document.getElementById('select-kelas')?.value || '';

    if (!mapel || !kelas) {
        showToast('Pilih Mapel & Kelas', 'Silakan pilih Mata Pelajaran dan Rombel Kelas terlebih dahulu.', 'warning');
        return;
    }

    const modal = document.getElementById('modal-lms-creator');
    const targetLabel = document.getElementById('lms-creator-target-label');
    const topicTargetLabel = document.getElementById('lms-topic-target-label');
    const modalTitle = document.getElementById('modal-lms-creator-title');
    const headerIcon = document.getElementById('modal-lms-creator-header-icon');
    const btnSubmitMat = document.getElementById('btn-submit-lms-material');

    if (targetLabel) targetLabel.textContent = `${kelas} • ${mapel}`;
    if (topicTargetLabel) topicTargetLabel.textContent = `${kelas} • ${mapel}`;

    const selectTopic = document.getElementById('select-lms-material-topic');
    const hasTopics = Array.isArray(currentLmsTopics) && currentLmsTopics.length > 0;
    if (selectTopic) {
        selectTopic.innerHTML = hasTopics
            ? currentLmsTopics.map(t => `<option value="${t.id}">${escapeHTML(t.title)}</option>`).join('')
            : '<option value="">-- Belum ada topik di kelas ini --</option>';
    }

    const bannerNoTopic = document.getElementById('banner-no-topic-info');
    const btnChoiceExisting = document.getElementById('btn-choice-topic-existing');

    if (!hasTopics) {
        if (btnChoiceExisting) btnChoiceExisting.classList.add('hidden');
        if (bannerNoTopic) bannerNoTopic.classList.remove('hidden');
    } else {
        if (btnChoiceExisting) btnChoiceExisting.classList.remove('hidden');
        if (bannerNoTopic) bannerNoTopic.classList.add('hidden');
    }

    if (materialId) {
        const mat = (currentLmsMaterials || []).find(m => String(m.id) === String(materialId));
        if (mat) {
            window.resetLmsMultiCards();
            const assignedTopicId = mat.topic_id || topicId || '';
            const topic = (currentLmsTopics || []).find(t => String(t.id) === String(assignedTopicId));

            window.selectLmsTopicMode('existing');
            if (selectTopic && assignedTopicId) {
                selectTopic.value = assignedTopicId;
            }
            const inputTopicId = document.getElementById('input-lms-topic-id');
            if (inputTopicId) inputTopicId.value = assignedTopicId;

            const labelSelected = document.getElementById('label-selected-topic-title');
            if (labelSelected) {
                labelSelected.textContent = topic ? topic.title : (selectTopic?.options[selectTopic.selectedIndex]?.text || 'Topik Terpilih');
            }

            const inputMatId = document.getElementById('input-lms-material-id');
            const inputTitle = document.getElementById('input-lms-material-title');
            const selectType = document.getElementById('select-lms-resource-type');
            const inputUrl = document.getElementById('input-lms-resource-url');
            const inputContent = document.getElementById('input-lms-material-content');
            const selectPub = document.getElementById('select-lms-material-published');
            const inputPubAt = document.getElementById('input-lms-material-publish-at');
            const selectDisc = document.getElementById('select-lms-material-discussion');
            const inputPrompt = document.getElementById('input-lms-material-discussion-prompt');
            const inputDue = document.getElementById('input-lms-material-due');
            const selectTeachingStatus = document.getElementById('select-lms-material-teaching-status');

            if (inputMatId) inputMatId.value = mat.id || '';
            if (inputTitle) inputTitle.value = mat.title || '';
            if (selectType) selectType.value = mat.resource_type || 'gdrive';
            if (inputUrl) inputUrl.value = mat.resource_url || '';
            if (inputContent) inputContent.value = mat.resource_type === 'html' ? (mat.html_instructions || '') : (mat.content_description || '');
            const htmlEditor = document.getElementById('input-lms-html-code');
            if (htmlEditor) htmlEditor.value = mat.resource_type === 'html' ? (mat.content_description || '') : '';
            if (selectPub) selectPub.value = "2";
            if (inputPubAt) inputPubAt.value = formatToDatetimeLocal(mat.publish_at);
            if (selectDisc) selectDisc.value = (mat.allow_discussion !== undefined && mat.allow_discussion !== null) ? String(mat.allow_discussion) : '0';
            if (inputPrompt) inputPrompt.value = mat.discussion_prompt || '';
            if (inputDue) {
                inputDue.value = formatToDatetimeLocal(normalizeLmsScheduleTime(mat.due_date, true));
                inputDue.oninput = window.syncLmsMaterialTeachingStatusWithDue;
                inputDue.onchange = window.syncLmsMaterialTeachingStatusWithDue;
            }
            if (selectTeachingStatus) selectTeachingStatus.value = getLmsScheduleState(mat).teachingCompleted ? '1' : '0';
            
            const card0 = document.querySelector('.lms-material-card[data-card-index="0"]');
            if (card0) card0.setAttribute('data-original-order', mat.order_index || 1);

            if (mat.resource_type === 'quiz') {
                try {
                    const parsedPayload = typeof mat.quiz_payload === 'string' ? JSON.parse(mat.quiz_payload || '{}') : (mat.quiz_payload || {});
                    if (card0) {
                        const kkmInput = card0.querySelector('.lms-quiz-kkm');
                        const timeInput = card0.querySelector('.lms-quiz-time');
                        const retakeInput = card0.querySelector('.lms-quiz-retake');
                        if (retakeInput) retakeInput.checked = parsedPayload.allow_retake !== 0 && parsedPayload.allow_retake !== false;
                        if (kkmInput) kkmInput.value = parsedPayload.passing_grade !== undefined ? parsedPayload.passing_grade : 75;
                        if (timeInput) timeInput.value = parsedPayload.time_limit_minutes !== undefined ? parsedPayload.time_limit_minutes : 0;
                        const qList = card0.querySelector('.lms-quiz-questions-list');
                        if (qList) {
                            qList.innerHTML = '';
                            if (Array.isArray(parsedPayload.questions) && parsedPayload.questions.length > 0) {
                                parsedPayload.questions.forEach(q => window.addLmsQuizQuestion(card0, q.type || 'mc', q));
                            } else {
                                window.addLmsQuizQuestion(card0, 'mc');
                            }
                        }
                    }
                } catch (errParse) {
                    console.warn('[LMS Quiz] Gagal memuat data butir soal kuis:', errParse);
                }
            }

            if (modalTitle) modalTitle.textContent = 'Edit Modul Pembelajaran';
            if (headerIcon) headerIcon.className = 'fa-solid fa-pen-to-square text-emerald-500';
            if (btnSubmitMat) btnSubmitMat.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> <span>Perbarui Modul Materi</span>';
            document.getElementById('btn-submit-lms-add-another')?.classList.remove('hidden');
        }
        step = 2;
        mode = 'create';
    } else if (topicId && step === 2) {
        window.resetLmsMultiCards();
        const topic = (currentLmsTopics || []).find(t => String(t.id) === String(topicId));
        window.selectLmsTopicMode('existing');
        if (selectTopic && topicId) {
            selectTopic.value = topicId;
        }
        const inputTopicId = document.getElementById('input-lms-topic-id');
        if (inputTopicId) inputTopicId.value = topicId;

        const labelSelected = document.getElementById('label-selected-topic-title');
        if (labelSelected) {
            labelSelected.textContent = topic ? topic.title : (selectTopic?.options[selectTopic.selectedIndex]?.text || 'Topik Terpilih');
        }

        document.getElementById('input-lms-material-id').value = '';
        document.getElementById('input-lms-material-title').value = '';
        document.getElementById('select-lms-resource-type').value = 'gdrive';
        document.getElementById('input-lms-resource-url').value = '';
        document.getElementById('input-lms-material-content').value = '';
        document.getElementById('select-lms-material-published').value = '2';
        document.getElementById('input-lms-material-publish-at').value = '';
        document.getElementById('select-lms-material-teaching-status').value = '0';
        document.getElementById('select-lms-material-discussion').value = '0';
        const promptInput2 = document.getElementById('input-lms-material-discussion-prompt');
        if (promptInput2) promptInput2.value = '';
        document.getElementById('input-lms-material-due').value = '';

        if (modalTitle) modalTitle.textContent = 'Tambah Modul Pembelajaran';
        if (headerIcon) headerIcon.className = 'fa-solid fa-plus-circle text-emerald-500';
        if (btnSubmitMat) btnSubmitMat.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> <span>Simpan Modul Materi</span>';
        document.getElementById('btn-submit-lms-add-another')?.classList.remove('hidden');

        step = 2;
        mode = 'create';
    } else if (topicId) {
        const topic = (currentLmsTopics || []).find(t => String(t.id) === String(topicId));
        if (topic) {
            window.selectLmsTopicMode('new');
            document.getElementById('input-lms-topic-id').value = topic.id;
            document.getElementById('input-lms-topic-name').value = topic.title || '';
            document.getElementById('input-lms-topic-desc').value = topic.description || '';
            document.getElementById('input-lms-topic-order').value = topic.order_index || 1;
        }
        if (modalTitle) modalTitle.textContent = 'Edit Bab / Topik Pembelajaran';
        if (headerIcon) headerIcon.className = 'fa-solid fa-pen-to-square text-emerald-500';

        const labelSaveTopicOnly = document.getElementById('label-save-topic-only');
        if (labelSaveTopicOnly) labelSaveTopicOnly.textContent = 'Perbarui Topik';

        step = 1;
        mode = 'create';
    } else {
        window.resetLmsMultiCards();
        document.getElementById('input-lms-topic-id').value = '';
        document.getElementById('input-lms-topic-name').value = '';
        document.getElementById('input-lms-topic-desc').value = '';
        document.getElementById('input-lms-topic-order').value = (currentLmsTopics ? currentLmsTopics.length + 1 : 1);

        document.getElementById('input-lms-material-id').value = '';
        document.getElementById('input-lms-material-title').value = '';
        document.getElementById('select-lms-resource-type').value = 'gdrive';
        document.getElementById('input-lms-resource-url').value = '';
        document.getElementById('input-lms-material-content').value = '';
        document.getElementById('select-lms-material-published').value = '2';
        document.getElementById('input-lms-material-publish-at').value = '';
        document.getElementById('select-lms-material-teaching-status').value = '0';
        document.getElementById('select-lms-material-discussion').value = '0';
        const promptInput4 = document.getElementById('input-lms-material-discussion-prompt');
        if (promptInput4) promptInput4.value = '';
        document.getElementById('input-lms-material-due').value = '';

        if (modalTitle) modalTitle.textContent = 'Buat Modul Pembelajaran';
        if (headerIcon) headerIcon.className = 'fa-solid fa-book-bookmark text-emerald-500';
        if (btnSubmitMat) btnSubmitMat.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> <span>Simpan Modul Materi</span>';
        document.getElementById('btn-submit-lms-add-another')?.classList.remove('hidden');

        const labelSaveTopicOnly = document.getElementById('label-save-topic-only');
        if (labelSaveTopicOnly) labelSaveTopicOnly.textContent = 'Simpan Topik Saja';

        window.selectLmsTopicMode(hasTopics ? 'existing' : 'new');
        step = 1;
    }

    const deleteTopicButton = document.getElementById('btn-delete-lms-topic');
    if (deleteTopicButton) {
        const editingTopic = !materialId && step === 1 && (currentLmsTopics || []).some(topic => String(topic.id) === String(topicId));
        deleteTopicButton.classList.toggle('hidden', !editingTopic);
        deleteTopicButton.onclick = async () => {
            if (!editingTopic || deleteTopicButton.disabled) return;
            deleteTopicButton.disabled = true;
            try { await window.deleteLmsTopic(topicId); } finally { deleteTopicButton.disabled = false; }
        };
    }
    window.toggleLmsPublishSchedule();
    window.toggleLmsDiscussionPrompt();
    window.updateResourcePlaceholder();
    window.switchMaterialContentTab('editor');
    window.updateLmsSaveButtonLabel();

    window.switchLmsCreatorTab(mode);
    if (mode === 'create') {
        window.goToLmsWizardStep(step);
    }

    if (modal) modal.classList.remove('hidden');
};

window.closeUnifiedLmsCreator = function () {
    const modal = document.getElementById('modal-lms-creator');
    if (modal) modal.classList.add('hidden');
};

window.switchLmsCreatorTab = function (tabName) {
    currentLmsCreatorMode = tabName;
    const btnTabCreate = document.getElementById('btn-creator-tab-create');
    const btnTabCopy = document.getElementById('btn-creator-tab-copy');
    const containerCreate = document.getElementById('container-creator-tab-create');
    const containerCopy = document.getElementById('container-creator-tab-copy');
    const modalTitle = document.getElementById('modal-lms-creator-title');
    const headerIcon = document.getElementById('modal-lms-creator-header-icon');

    const activeTabClass = "py-2 px-3 border-b-2 font-bold text-xs flex items-center gap-1.5 transition-all border-emerald-600 text-emerald-600 dark:text-emerald-400";
    const inactiveTabClass = "py-2 px-3 border-b-2 font-bold text-xs flex items-center gap-1.5 transition-all border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200";
    btnTabCreate?.setAttribute('aria-pressed', String(tabName !== 'copy'));
    btnTabCopy?.setAttribute('aria-pressed', String(tabName === 'copy'));

    if (tabName === 'copy') {
        if (btnTabCreate) btnTabCreate.className = inactiveTabClass;
        if (btnTabCopy) btnTabCopy.className = activeTabClass;
        if (containerCreate) containerCreate.classList.add('hidden');
        if (containerCopy) containerCopy.classList.remove('hidden');
        if (modalTitle) modalTitle.textContent = 'Salin Topik & Materi dari Kelas Lain';
        if (headerIcon) headerIcon.className = 'fa-solid fa-clone text-indigo-500';

        window.initLmsCopyTabState();
    } else {
        if (btnTabCreate) btnTabCreate.className = activeTabClass;
        if (btnTabCopy) btnTabCopy.className = inactiveTabClass;
        if (containerCreate) containerCreate.classList.remove('hidden');
        if (containerCopy) containerCopy.classList.add('hidden');
        if (modalTitle) modalTitle.textContent = 'Buat Modul Pembelajaran';
        if (headerIcon) headerIcon.className = 'fa-solid fa-book-bookmark text-emerald-500';
    }
};

window.selectLmsTopicMode = function (mode) {
    const hasTopics = Array.isArray(currentLmsTopics) && currentLmsTopics.length > 0;
    if (!hasTopics && mode === 'existing') {
        mode = 'new';
    }

    const inputHidden = document.getElementById('input-lms-topic-mode');
    if (inputHidden) inputHidden.value = mode;

    const btnExisting = document.getElementById('btn-choice-topic-existing');
    const btnNew = document.getElementById('btn-choice-topic-new');
    const containerExisting = document.getElementById('container-topic-existing-select');
    const containerNew = document.getElementById('container-topic-new-form');

    const activeBtnClass = "px-3 py-1.5 rounded-lg font-bold text-xs transition-all bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-2xs border border-slate-200 dark:border-slate-600 flex items-center gap-1.5";
    const inactiveBtnClass = "px-3 py-1.5 rounded-lg font-bold text-xs transition-all text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-transparent flex items-center gap-1.5";

    if (mode === 'new') {
        if (btnExisting) btnExisting.className = inactiveBtnClass;
        if (btnNew) btnNew.className = activeBtnClass;
        if (containerExisting) containerExisting.classList.add('hidden');
        if (containerNew) containerNew.classList.remove('hidden');
        setTimeout(() => document.getElementById('input-lms-topic-name')?.focus(), 50);
    } else {
        if (btnExisting) btnExisting.className = activeBtnClass;
        if (btnNew) btnNew.className = inactiveBtnClass;
        if (containerExisting) containerExisting.classList.remove('hidden');
        if (containerNew) containerNew.classList.add('hidden');
    }
};

window.goToLmsWizardStep = async function (targetStep) {
    if (targetStep === 2 && window.lmsModuleWorkspace) {
        const mode = document.getElementById('input-lms-topic-mode')?.value || 'existing';
        if (mode === 'new') {
            const title = document.getElementById('input-lms-topic-name')?.value.trim();
            if (!title) return showToast('Judul wajib','Isi judul Topik/Bab terlebih dahulu.','warning');
            const kelas = document.getElementById('select-kelas')?.value || '';
            const mapel = document.getElementById('select-mapel')?.value || '';
            if (!mapel || !kelas) return showToast('Pilih Mapel & Kelas','Silakan pilih Mata Pelajaran dan Rombel Kelas pada filter atas terlebih dahulu.','warning');
            const button = document.getElementById('footer-wizard-step-1');
            if (button?.dataset.saving) return;
            if (button) button.dataset.saving='1';
            try {
                const topicInput=document.getElementById('input-lms-topic-id');
                if(topicInput && !topicInput.dataset.requestId) topicInput.dataset.requestId=crypto.randomUUID();
                const topicPayload={id:topicInput?.value || undefined,client_request_id:topicInput?.dataset.requestId,title,
                    description:document.getElementById('input-lms-topic-desc')?.value || '',
                    class_name:kelas,subject_name:mapel,
                    academic_year:raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString(),semester:document.getElementById('select-semester')?.value==='2'?'Genap':'Ganjil',
                    order_index:Number(document.getElementById('input-lms-topic-order')?.value)||currentLmsTopics.length+1};
                const saved = await cfSaveLmsTopic(topicPayload);
                if(topicInput)topicInput.value=saved.id;
                if(!currentLmsTopics.some(t=>t.id===saved.id)) currentLmsTopics.push({...topicPayload,id:saved.id});
                window.closeUnifiedLmsCreator();await window.loadLmsData(true);
                return window.lmsModuleWorkspace.open(null,saved.id);
            }catch(error){showToast('Topik belum tersimpan',error.message,'error');}finally{if(button)delete button.dataset.saving;}
            return;
        }
        const topicId=document.getElementById('select-lms-material-topic')?.value;
        if (!topicId) return showToast('Pilih Topik','Pilih Topik/Bab terlebih dahulu.','warning');
        window.closeUnifiedLmsCreator();return window.lmsModuleWorkspace.open(null,topicId);
    }
    if (targetStep === 2) {
        const topicMode = document.getElementById('input-lms-topic-mode')?.value ||
                          document.querySelector('input[name="lms-topic-mode"]:checked')?.value ||
                          'existing';
        let chosenTitle = '';

        if (topicMode === 'new') {
            const topicName = (document.getElementById('input-lms-topic-name')?.value || '').trim();
            if (!topicName) {
                showToast('Judul Bab Wajib', 'Silakan isi judul bab/topik baru terlebih dahulu.', 'warning');
                document.getElementById('input-lms-topic-name')?.focus();
                return;
            }
            chosenTitle = topicName;
        } else {
            const selectTopic = document.getElementById('select-lms-material-topic');
            if (!selectTopic || !selectTopic.value) {
                showToast('Pilih Topik', 'Silakan pilih bab/topik yang ada atau beralih ke "+ Buat Bab Baru".', 'warning');
                return;
            }
            chosenTitle = selectTopic.options[selectTopic.selectedIndex]?.text || 'Topik Terpilih';
        }

        const labelSelected = document.getElementById('label-selected-topic-title');
        if (labelSelected) labelSelected.textContent = chosenTitle;

        document.getElementById('lms-wizard-step-1')?.classList.add('hidden');
        document.getElementById('footer-wizard-step-1')?.classList.add('hidden');
        document.getElementById('lms-wizard-step-2')?.classList.remove('hidden');
        document.getElementById('footer-wizard-step-2')?.classList.remove('hidden');

        const pill1 = document.getElementById('step-pill-1');
        const pill2 = document.getElementById('step-pill-2');
        if (pill1) pill1.className = "flex items-center gap-2 text-slate-400 dark:text-slate-500";
        if (pill2) pill2.className = "flex items-center gap-2 text-emerald-700 dark:text-emerald-300";

        currentLmsCreatorStep = 2;
    } else {
        document.getElementById('lms-wizard-step-2')?.classList.add('hidden');
        document.getElementById('footer-wizard-step-2')?.classList.add('hidden');
        document.getElementById('lms-wizard-step-1')?.classList.remove('hidden');
        document.getElementById('footer-wizard-step-1')?.classList.remove('hidden');

        const pill1 = document.getElementById('step-pill-1');
        const pill2 = document.getElementById('step-pill-2');
        if (pill1) pill1.className = "flex items-center gap-2 text-emerald-700 dark:text-emerald-300";
        if (pill2) pill2.className = "flex items-center gap-2 text-slate-400 dark:text-slate-500";

        currentLmsCreatorStep = 1;
    }
};

window.saveLmsTopicOnlyFromWizard = async function () {
    await window.saveLmsTopic();
};

window.normalizeLmsResourceUrl = function (rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    let url = rawUrl.trim();
    if (!url) return '';
    url = url.replace(/^\/+/, '');
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(url)) {
        url = `https://${url}`;
    }
    return url;
};

window.addLmsMaterialFormCard = function () {
    const container = document.getElementById('container-lms-materials-list');
    if (!container) return;

    const cards = container.querySelectorAll('.lms-material-card');
    const lastCard = cards[cards.length - 1];

    if (lastCard) {
        const lastTitle = lastCard.querySelector('.lms-field-title');
        if (lastTitle && !lastTitle.value.trim()) {
            showToast('Judul Belum Diisi', 'Isi judul materi pada modul sebelumnya terlebih dahulu.', 'warning');
            lastTitle.focus();
            return;
        }
    }

    const newIndex = cards.length;
    const cardHtml = `
        <div class="lms-material-card border border-slate-200 dark:border-slate-700 rounded-xl p-3 space-y-2.5 bg-white dark:bg-slate-900/50 relative" data-card-index="${newIndex}">
            <div class="flex items-center justify-between">
                <span class="lms-card-badge text-[10px] font-extrabold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md">Modul / Materi ${newIndex + 1}</span>
                <button type="button" class="lms-btn-remove-card text-[10px] font-bold text-red-500 hover:text-red-700 dark:text-red-400 flex items-center gap-1 px-2 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 transition" onclick="window.removeLmsMaterialCard(this)">
                    <i class="fa-solid fa-trash-can text-[9px]"></i> Hapus
                </button>
            </div>

            <div>
                <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Judul Materi / Modul *</label>
                <input type="text" required placeholder="Contoh: Pertemuan ${newIndex + 1} - ..." class="lms-field-title w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-sm font-medium placeholder:font-medium placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-emerald-500">
            </div>

            <div class="lms-container-resource space-y-2">
                <div class="lms-resource-fields">
                    <div class="lms-media-type-row flex items-end gap-2">
                        <div class="flex-1 min-w-0">
                        <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Tipe Media</label>
                        <select onchange="window.updateResourcePlaceholder(this.closest('.lms-material-card'))" class="lms-field-resource-type w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500">
                            <option value="gdrive">Google Drive / PDF</option>
                            <option value="youtube">Video YouTube</option>
                            <option value="link">Tautan Web</option>
                            <option value="text">Teks Bacaan</option>
                            <option value="html">HTML Interaktif</option>
                            <option value="quiz">Kuis Formatif</option>
                        </select>
                        </div>
                        <div class="lms-html-actions hidden flex shrink-0 items-center gap-1">
                            <label class="lms-html-import-button cursor-pointer px-2 py-2 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold inline-flex items-center gap-1" title="Impor file HTML, maksimal 512 KB">
                                <input type="file" accept=".html,.htm,text/html" onchange="window.importLmsHtmlFile(this)" class="lms-html-file-input sr-only" aria-label="Impor file HTML">
                                <i class="fa-solid fa-file-import" aria-hidden="true"></i><span>Impor</span>
                            </label>
                            <button type="button" onclick="window.previewLmsHtml(this.closest('.lms-material-card'))" class="px-2 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold inline-flex items-center gap-1"><i class="fa-solid fa-eye" aria-hidden="true"></i><span>Preview</span></button>
                        </div>
                    </div>
                    <div class="lms-container-resource-url">
                        <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">URL / Link Tautan</label>
                        <div class="flex items-center gap-1">
                            <input type="text" inputmode="url" placeholder="drive.google.com/... atau youtu.be/... (boleh tanpa https://)" class="lms-field-resource-url w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-sm font-normal placeholder:font-normal placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-emerald-500">
                            <button type="button" onclick="window.testOpenResourceUrl(this.closest('.lms-material-card'))" class="lms-btn-test-url px-2 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 shrink-0" title="Uji Coba Buka Link">
                                <i class="fa-solid fa-arrow-up-right-from-square"></i>
                            </button>
                        </div>
                    </div>
                </div>
                <details class="lms-resource-help">
                <summary>Tips akses materi untuk siswa</summary>
                <div class="lms-resource-tip p-2 bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-900/60 rounded-xl flex items-start gap-2 text-[10px] text-blue-800 dark:text-blue-200">
                    <i class="fa-solid fa-lightbulb text-amber-500 mt-0.5 shrink-0"></i>
                    <p class="leading-relaxed"><strong>Tips Google Drive:</strong> Pastikan dokumen di Google Drive telah diatur aksesnya ke <em>"Anyone with the link"</em>.</p>
                </div>
                </details>
            </div>

            <div class="lms-container-quiz-builder hidden p-3 bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200/80 dark:border-purple-900/60 rounded-xl space-y-3 text-xs">
                <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-purple-200/80 dark:border-purple-800">
                    <div class="flex items-center gap-2">
                        <span class="w-6 h-6 rounded-lg bg-purple-600 text-white flex items-center justify-center text-xs shadow-2xs">
                            <i class="fa-solid fa-circle-question"></i>
                        </span>
                        <div>
                            <h4 class="font-bold text-purple-950 dark:text-purple-200 text-xs">Konfigurasi Kuis Formatif</h4>
                            <p class="text-[10px] text-purple-700 dark:text-purple-400">Buat soal pilihan ganda, isian singkat, dan uraian untuk asesmen formatif.</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 flex-wrap">
                        <div class="flex items-center gap-1 bg-white dark:bg-slate-900 px-2 py-1 rounded-lg border border-purple-200 dark:border-purple-800">
                            <label class="text-[10px] font-bold text-purple-900 dark:text-purple-300">KKM:</label>
                            <input type="number" inputmode="numeric" min="0" max="100" value="75" class="lms-quiz-kkm w-12 text-center text-xs font-black bg-transparent text-purple-700 dark:text-purple-300 outline-none" title="Nilai KKM Kelulusan (0-100)">
                        </div>
                        <div class="flex items-center gap-1 bg-white dark:bg-slate-900 px-2 py-1 rounded-lg border border-purple-200 dark:border-purple-800">
                            <label class="text-[10px] font-bold text-purple-900 dark:text-purple-300">Waktu:</label>
                            <input type="number" inputmode="numeric" min="0" max="180" value="0" placeholder="0" class="lms-quiz-time w-12 text-center text-xs font-bold bg-transparent text-purple-700 dark:text-purple-300 outline-none" title="Batas waktu pengerjaan dalam menit (0 = tanpa batas)">
                            <span class="text-[10px] text-slate-400">mnt</span>
                        </div>
                    </div>
                </div>

                <label class="flex gap-2 items-center"><input type="checkbox" class="lms-quiz-retake" checked>Izinkan pengerjaan ulang setelah hasil diterbitkan</label>
                <p class="text-[11px] text-slate-500">PG dan isian berkunci dinilai otomatis. Uraian dan isian tanpa kunci diperiksa guru. Bobot menentukan nilai akhir.</p>
                <button type="button" onclick="window.openLmsQuizImport(this.closest('.lms-material-card'))" class="px-3 py-2 rounded-lg border border-purple-300 dark:border-purple-700 font-bold"><i class="fa-solid fa-file-import" aria-hidden="true"></i> Impor soal</button>
                <div class="lms-quiz-questions-list space-y-3"></div>
                <div class="flex flex-wrap gap-2"><button type="button" onclick="window.addLmsQuizQuestion(this.closest('.lms-material-card'), 'essay')" class="px-3 py-2 rounded-lg bg-indigo-600 text-white font-bold">Tambah uraian</button><button type="button" onclick="window.previewLmsQuiz(this.closest('.lms-material-card'))" class="px-3 py-2 rounded-lg border border-purple-300 font-bold">Pratinjau soal siswa</button></div>

                <div class="flex items-center gap-2 pt-1 border-t border-purple-200/60 dark:border-purple-800/60">
                    <button type="button" onclick="window.addLmsQuizQuestion(this.closest('.lms-material-card'), 'mc')" class="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-2xs active:scale-95">
                        <i class="fa-solid fa-plus text-[10px]"></i> <span>Tambah Pilihan Ganda (PG)</span>
                    </button>
                    <button type="button" onclick="window.addLmsQuizQuestion(this.closest('.lms-material-card'), 'short')" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-2xs active:scale-95">
                        <i class="fa-solid fa-plus text-[10px]"></i> <span>Tambah Isian Singkat</span>
                    </button>
                </div>
            </div>

            <div class="lms-html-tools hidden space-y-2 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-3">
                <span class="lms-html-file-name block text-xs text-slate-600 dark:text-slate-300 break-all"></span>
                <p class="text-[11px] text-slate-600 dark:text-slate-300">Tempel kode di bawah atau impor satu file .html/.htm, maksimal 512 KB. Sertakan CSS/JavaScript di dalam file; gambar dan aset lain dapat memakai tautan HTTPS.</p>
                <p class="text-[11px] text-slate-600 dark:text-slate-300">Jawaban form standar siswa dicadangkan di perangkat yang sama. Latihan dengan soal acak atau state khusus perlu fitur penyimpanan di kode HTML agar pulih dengan tepat.</p>
                <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300">Kode HTML, CSS &amp; JavaScript
                    <textarea rows="12" spellcheck="false" autocapitalize="off" placeholder="Tempel kode HTML lengkap di sini, atau impor file HTML di atas..." class="lms-field-html mt-1 w-full p-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-mono outline-none focus:ring-2 focus:ring-emerald-500"></textarea>
                </label>
            </div>

            <div class="lms-container-content-editor space-y-1">
                <div class="flex items-center justify-between">
                    <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300">Petunjuk / Modul Teks (Markdown)</label>
                    <div class="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[10px]">
                        <button type="button" onclick="window.switchMaterialContentTab('editor', this.closest('.lms-material-card'))" class="lms-btn-tab-editor px-2 py-0.5 rounded font-bold bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-2xs">Editor</button>
                        <button type="button" onclick="window.switchMaterialContentTab('preview', this.closest('.lms-material-card'))" class="lms-btn-tab-preview px-2 py-0.5 rounded font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">Pratinjau</button>
                    </div>
                </div>
                <textarea rows="3" placeholder="Tuliskan petunjuk belajar atau uraian materi... (Markdown: **tebal**, *miring*, # Judul, - list)" class="lms-field-content w-full p-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-mono outline-none focus:ring-2 focus:ring-emerald-500"></textarea>
                <div class="lms-content-preview hidden min-h-[80px] max-h-[180px] overflow-y-auto p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 custom-scrollbar"></div>
            </div>

            <div class="lms-container-discussion px-3 py-2 bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-900/60 rounded-xl text-xs">
                <div class="flex items-center justify-between gap-2">
                    <label class="font-semibold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5 whitespace-nowrap text-xs">
                        <i class="fa-solid fa-comments text-indigo-500 text-[11px]"></i> Forum Diskusi
                        <span class="text-[9px] text-indigo-600 dark:text-indigo-400 font-normal hidden sm:inline">Wajib jika aktif</span>
                    </label>
                    <select onchange="window.toggleLmsDiscussionPrompt(this.closest('.lms-material-card'))" class="lms-field-discussion w-36 sm:w-40 border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-sm font-medium outline-none">
                        <option value="0">Tidak Aktif</option>
                        <option value="1">Aktifkan</option>
                    </select>
                </div>
                <div class="lms-discussion-prompt-container hidden pt-2 mt-2 border-t border-indigo-200/80 dark:border-indigo-800 space-y-1">
                    <div class="flex items-center justify-between gap-2">
                        <label class="font-semibold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5 text-xs">
                            <i class="fa-solid fa-lightbulb text-amber-500"></i> Pemantik Diskusi *
                        </label>
                        <span class="text-[9px] text-indigo-600 dark:text-indigo-400 font-semibold">Wajib</span>
                    </div>
                    <textarea rows="2" placeholder="Tuliskan masalah, studi kasus, atau pertanyaan pemantik..." class="lms-field-discussion-prompt w-full p-2 border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
                </div>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', cardHtml);
    window.refreshLmsMaterialCardsState();
    window.updateLmsSaveButtonLabel();

    const newCard = container.querySelector(`.lms-material-card[data-card-index="${newIndex}"]`);
    if (newCard) {
        newCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
            const titleInput = newCard.querySelector('.lms-field-title');
            if (titleInput) titleInput.focus();
        }, 300);
    }
};

window.removeLmsMaterialCard = function (btn) {
    const card = btn.closest('.lms-material-card');
    const container = document.getElementById('container-lms-materials-list');
    if (!card || !container) return;

    if (card.getAttribute('data-card-index') === '0' || card.querySelector('#input-lms-material-title')) {
        showToast('Tidak Bisa Dihapus', 'Modul pertama merupakan modul dasar dan tidak dapat dihapus.', 'warning');
        return;
    }

    const cards = container.querySelectorAll('.lms-material-card');
    if (cards.length <= 1) {
        showToast('Tidak Bisa Dihapus', 'Minimal satu modul materi harus ada.', 'warning');
        return;
    }

    card.remove();
    window.refreshLmsMaterialCardsState();
    window.updateLmsSaveButtonLabel();
};

window.refreshLmsMaterialCardsState = function () {
    const container = document.getElementById('container-lms-materials-list');
    if (!container) return;

    const cards = container.querySelectorAll('.lms-material-card');
    cards.forEach((card, i) => {
        card.setAttribute('data-card-index', i);
        const badge = card.querySelector('.lms-card-badge');
        if (badge) badge.textContent = `Modul / Materi ${i + 1}`;

        const removeBtn = card.querySelector('.lms-btn-remove-card');
        if (removeBtn) {
            if (i > 0) {
                removeBtn.classList.remove('hidden');
            } else {
                removeBtn.classList.add('hidden');
            }
        }
    });
};

window.updateLmsSaveButtonLabel = function () {
    const container = document.getElementById('container-lms-materials-list');
    const btnSubmit = document.getElementById('btn-submit-lms-material');
    if (!container || !btnSubmit) return;

    const count = container.querySelectorAll('.lms-material-card').length;
    const label = btnSubmit.querySelector('span');
    if (label) {
        label.textContent = count > 1 ? `Simpan ${count} Modul Materi` : 'Simpan Modul Materi';
    }
};

window.resetLmsMultiCards = function () {
    const container = document.getElementById('container-lms-materials-list');
    if (!container) return;

    const cards = container.querySelectorAll('.lms-material-card');
    cards.forEach((card, i) => {
        if (i > 0) card.remove();
        else {
            delete card.dataset.savedId;
            delete card.dataset.requestId;
            card.removeAttribute('data-original-order');
        }
    });

    const titleEl = document.getElementById('input-lms-material-title');
    const resourceTypeEl = document.getElementById('select-lms-resource-type');
    const resourceUrlEl = document.getElementById('input-lms-resource-url');
    const contentEl = document.getElementById('input-lms-material-content');
    const htmlEl = document.getElementById('input-lms-html-code');
    const discussionEl = document.getElementById('select-lms-material-discussion');
    const discussionPromptEl = document.getElementById('input-lms-material-discussion-prompt');

    if (titleEl) titleEl.value = '';
    if (resourceTypeEl) resourceTypeEl.value = 'gdrive';
    if (resourceUrlEl) resourceUrlEl.value = '';
    if (contentEl) contentEl.value = '';
    if (htmlEl) htmlEl.value = '';
    if (discussionEl) discussionEl.value = '0';
    if (discussionPromptEl) discussionPromptEl.value = '';

    const card0 = container.querySelector('.lms-material-card[data-card-index="0"]');
    if (card0) {
        configureLmsHtmlEditor(card0);
        const htmlFileName = card0.querySelector('.lms-html-file-name');
        if (htmlFileName) htmlFileName.textContent = '';
        const qList0 = card0.querySelector('.lms-quiz-questions-list');
        if (qList0) qList0.innerHTML = '';
        const kkm0 = card0.querySelector('.lms-quiz-kkm');
        if (kkm0) kkm0.value = '75';
        const time0 = card0.querySelector('.lms-quiz-time');
        if (time0) time0.value = '0';
        const retake0 = card0.querySelector('.lms-quiz-retake');
        if (retake0) retake0.checked = true;
        const builder0 = card0.querySelector('.lms-container-quiz-builder');
        if (builder0) builder0.classList.add('hidden');
    }

    window.refreshLmsMaterialCardsState();
    window.updateLmsSaveButtonLabel();
};

// Border merah validasi harus MENGGANTIKAN border dasar (border-slate-*), bukan menumpuk:
// pada CSS Tailwind hasil build, border-slate-* menang urutan atas border-red-500.
const LMS_CARD_BASE_BORDER_RE = /^border-slate-\d+(?:\/\d+)?$/;
function markLmsCardInvalid(card) {
    const baseBorders = [...card.classList].filter(c => LMS_CARD_BASE_BORDER_RE.test(c));
    if (baseBorders.length) {
        card.dataset.baseBorder = baseBorders.join(' ');
        card.classList.remove(...baseBorders);
    }
    card.classList.add('border-red-500');
}
function clearLmsCardInvalid(card) {
    card.classList.remove('border-red-500');
    if (card.dataset.baseBorder) {
        card.classList.add(...card.dataset.baseBorder.split(' '));
        delete card.dataset.baseBorder;
    }
}

window.saveLmsMaterialFromWizard = async function () {
    const mapel = document.getElementById('select-mapel')?.value || '';
    const kelas = document.getElementById('select-kelas')?.value || '';
    const semester = document.getElementById('select-semester')?.value || '1';
    const semesterText = semester === '1' ? 'Ganjil' : 'Genap';
    const academicYear = raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString();

    const topicMode = document.getElementById('input-lms-topic-mode')?.value ||
                      document.querySelector('input[name="lms-topic-mode"]:checked')?.value ||
                      'existing';
    let topicId = '';

    const btnSubmit = document.getElementById('btn-submit-lms-material');
    const btnAddAnother = document.getElementById('btn-submit-lms-add-another');
    if (btnSubmit?.disabled) return;
    if (btnSubmit) btnSubmit.disabled = true;
    if (btnAddAnother) btnAddAnother.disabled = true;

    try {
        const user = auth?.currentUser;
        if (!mapel || !kelas) {
            showToast('Pilih Mapel & Kelas', 'Silakan pilih Mata Pelajaran dan Rombel Kelas pada filter atas terlebih dahulu.', 'warning');
            window.goToLmsWizardStep(1);
            return;
        }

        let pendingTopicPayload = null;

        if (topicMode === 'new') {
            const topicTitle = (document.getElementById('input-lms-topic-name')?.value || '').trim();
            if (!topicTitle) {
                showToast('Judul Topik Wajib', 'Silakan isi judul topik/bab pembelajaran terlebih dahulu.', 'warning');
                window.goToLmsWizardStep(1);
                return;
            }
            const topicDesc = (document.getElementById('input-lms-topic-desc')?.value || '').trim();
            const topicOrder = Number(document.getElementById('input-lms-topic-order')?.value) || (currentLmsTopics ? currentLmsTopics.length + 1 : 1);
            const existingTopicId = document.getElementById('input-lms-topic-id')?.value || '';

            const topicPayload = {
                teacher_id: user?.uid || 'guru_mapel',
                teacher_name: user?.displayName || 'Guru Mapel',
                subject_name: mapel,
                class_name: kelas,
                title: topicTitle,
                description: topicDesc,
                order_index: topicOrder,
                academic_year: academicYear,
                semester: semesterText
            };
            if (existingTopicId) topicPayload.id = existingTopicId;

            pendingTopicPayload = topicPayload;
            topicId = existingTopicId;
        } else {
            topicId = document.getElementById('select-lms-material-topic')?.value || '';
            if (!topicId) {
                showToast('Topik Wajib', 'Silakan tentukan topik pembelajaran untuk modul ini.', 'warning');
                window.goToLmsWizardStep(1);
                return;
            }
        }

        const isPublished = 2;
        const isTeachingCompleted = Number(document.getElementById('select-lms-material-teaching-status')?.value ?? 0);
        let publishAt, dueDate;
        try {
            ({ publish_at: publishAt, due_date: dueDate } = validateLmsSchedule(
                document.getElementById('input-lms-material-publish-at')?.value,
                document.getElementById('input-lms-material-due')?.value));
        } catch (error) {
            showToast('Jadwal Wajib & Valid', error.message, 'warning');
            return;
        }

        const matId = document.getElementById('input-lms-material-id')?.value || '';
        const materialsToSave = [];

        if (matId) {
            const card0 = document.querySelector('.lms-material-card[data-card-index="0"]');
            
            let title = (document.getElementById('input-lms-material-title')?.value || '').trim();
            let resourceType = document.getElementById('select-lms-resource-type')?.value || 'gdrive';
            let resourceUrl = (document.getElementById('input-lms-resource-url')?.value || '').trim();
            let contentDescription = (document.getElementById('input-lms-material-content')?.value || '').trim();
            let allowDiscussionStr = document.getElementById('select-lms-material-discussion')?.value || '0';
            let allowDiscussion = allowDiscussionStr === '1' ? 1 : 0;
            let discussionPrompt = (document.getElementById('input-lms-material-discussion-prompt')?.value || '').trim();

            if (card0) {
                title = (card0.querySelector('.lms-field-title')?.value || title).trim();
                resourceType = card0.querySelector('.lms-field-resource-type')?.value || resourceType;
                resourceUrl = (card0.querySelector('.lms-field-resource-url')?.value || resourceUrl).trim();
                contentDescription = (card0.querySelector('.lms-field-content')?.value || contentDescription).trim();
                allowDiscussionStr = card0.querySelector('.lms-field-discussion')?.value || allowDiscussionStr;
                allowDiscussion = allowDiscussionStr === '1' ? 1 : 0;
                discussionPrompt = (card0.querySelector('.lms-field-discussion-prompt')?.value ?? discussionPrompt).trim();
            }

            let quizPayload = '';
            if (resourceType === 'quiz') {
                try {
                    quizPayload = window.serializeLmsQuizPayload(card0);
                } catch (errQuiz) {
                    showToast('Validasi Kuis', errQuiz.message, 'warning');
                    return;
                }
            }

            if (!title) { showToast('Judul Materi Wajib', 'Silakan masukkan judul modul/materi pembelajaran.', 'warning'); return; }
            if (allowDiscussion === 1 && !discussionPrompt) { showToast('Pemantik Diskusi Wajib', 'Silakan tuliskan masalah atau pertanyaan pemantik diskusi agar siswa memiliki acuan berdiskusi.', 'warning'); document.getElementById('input-lms-material-discussion-prompt')?.focus(); return; }
            if (!['text', 'quiz', 'html'].includes(resourceType) && !resourceUrl) { showToast('Tautan Materi Wajib', 'Masukkan URL dokumen, video, atau halaman web yang akan dibuka siswa.', 'warning'); document.getElementById('input-lms-resource-url')?.focus(); return; }
            if (resourceType === 'text' && !contentDescription) { showToast('Isi Materi Wajib', 'Tuliskan isi materi teks agar siswa memiliki bahan belajar.', 'warning'); document.getElementById('input-lms-material-content')?.focus(); return; }

            if (!['text', 'quiz', 'html'].includes(resourceType) && resourceUrl) {
                resourceUrl = window.normalizeLmsResourceUrl(resourceUrl);
            }

            materialsToSave.push({
                id: matId,
                title, resourceType, resourceUrl, contentDescription, allowDiscussion, discussionPrompt,
                htmlCode: (card0?.querySelector('.lms-field-html') || document.getElementById('input-lms-html-code'))?.value || '',
                quizPayload,
                order_index: card0 ? Number(card0.getAttribute('data-original-order')) || 1 : 1
            });
        }
        {
            const cards = document.querySelectorAll('#container-lms-materials-list .lms-material-card');
            for (let i = matId ? 1 : 0; i < cards.length; i++) {
                const card = cards[i];
                clearLmsCardInvalid(card);

                let title = (card.querySelector('.lms-field-title')?.value || '').trim();
                let resourceType = card.querySelector('.lms-field-resource-type')?.value || 'gdrive';
                let resourceUrl = (card.querySelector('.lms-field-resource-url')?.value || '').trim();
                let contentDescription = (card.querySelector('.lms-field-content')?.value || '').trim();
                let allowDiscussionStr = card.querySelector('.lms-field-discussion')?.value || '0';
                let allowDiscussion = allowDiscussionStr === '1' ? 1 : 0;
                let discussionPrompt = (card.querySelector('.lms-field-discussion-prompt')?.value || '').trim();

                if (i === 0) {
                    title = title || (document.getElementById('input-lms-material-title')?.value || '').trim();
                    resourceType = card.querySelector('.lms-field-resource-type')?.value || document.getElementById('select-lms-resource-type')?.value || 'gdrive';
                    resourceUrl = resourceUrl || (document.getElementById('input-lms-resource-url')?.value || '').trim();
                    contentDescription = contentDescription || (document.getElementById('input-lms-material-content')?.value || '').trim();
                    allowDiscussionStr = card.querySelector('.lms-field-discussion')?.value || document.getElementById('select-lms-material-discussion')?.value || '0';
                    allowDiscussion = allowDiscussionStr === '1' ? 1 : 0;
                    discussionPrompt = discussionPrompt || (document.getElementById('input-lms-material-discussion-prompt')?.value || '').trim();
                }

                let quizPayload = '';
                if (resourceType === 'quiz') {
                    try {
                        quizPayload = window.serializeLmsQuizPayload(card);
                    } catch (errQuiz) {
                        markLmsCardInvalid(card);
                        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        showToast('Validasi Kuis', `Modul ke-${i+1}: ${errQuiz.message}`, 'warning');
                        return;
                    }
                }

                if (!title) {
                    markLmsCardInvalid(card);
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    card.querySelector('.lms-field-title')?.focus();
                    showToast('Judul Materi Wajib', `Silakan masukkan judul modul/materi pembelajaran pada modul ke-${i+1}.`, 'warning');
                    return;
                }
                if (allowDiscussion === 1 && !discussionPrompt) {
                    markLmsCardInvalid(card);
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    card.querySelector('.lms-field-discussion-prompt')?.focus();
                    showToast('Pemantik Diskusi Wajib', `Silakan tuliskan masalah atau pertanyaan pemantik diskusi pada modul ke-${i+1}.`, 'warning');
                    return;
                }
                if (!['text', 'quiz', 'html'].includes(resourceType) && !resourceUrl) {
                    markLmsCardInvalid(card);
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    card.querySelector('.lms-field-resource-url')?.focus();
                    showToast('Tautan Materi Wajib', `Masukkan URL dokumen, video, atau halaman web pada modul ke-${i+1}.`, 'warning');
                    return;
                }
                if (resourceType === 'text' && !contentDescription) {
                    markLmsCardInvalid(card);
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    card.querySelector('.lms-field-content')?.focus();
                    showToast('Isi Materi Wajib', `Tuliskan isi materi teks pada modul ke-${i+1}.`, 'warning');
                    return;
                }

                if (!['text', 'quiz', 'html'].includes(resourceType) && resourceUrl) {
                    resourceUrl = window.normalizeLmsResourceUrl(resourceUrl);
                }

                card.dataset.requestId ||= crypto.randomUUID();
                materialsToSave.push({ title, resourceType, resourceUrl, contentDescription, allowDiscussion, discussionPrompt,
                    htmlCode: card.querySelector('.lms-field-html')?.value || '',
                    quizPayload,
                    card, id: card.dataset.savedId || '', client_request_id: card.dataset.requestId,
                    isAppended: Boolean(matId),
                    order_index: Number(card.dataset.originalOrder) || 0 });
            }
        }

        if (!materialsToSave.length) throw new Error('Tambahkan minimal satu modul materi.');
        for (const mat of materialsToSave) {
            if (mat.resourceType === 'html') {
                validateLmsHtml(mat.htmlCode);
                if (mat.contentDescription.length > 16000) throw new Error('Petunjuk belajar maksimal 16.000 karakter.');
                mat.resourceUrl = '';
            }
            if (!['text', 'quiz', 'html'].includes(mat.resourceType)) {
                mat.resourceUrl = window.normalizeLmsResourceUrl(mat.resourceUrl);
                let url;
                try { url = new URL(mat.resourceUrl); } catch (_) { }
                if (!url || !['http:', 'https:'].includes(url.protocol) || (!url.hostname.includes('.') && url.hostname !== 'localhost')) {
                    throw new Error(`Tautan modul "${mat.title}" harus berupa URL web yang valid (contoh: drive.google.com/... atau youtu.be/...).`);
                }
            }
        }
        if (pendingTopicPayload) {
            const topicInput = document.getElementById('input-lms-topic-id');
            if (!pendingTopicPayload.id && topicInput) {
                topicInput.dataset.requestId ||= crypto.randomUUID();
                pendingTopicPayload.client_request_id = topicInput.dataset.requestId;
            }
            const topicRes = await cfSaveLmsTopic(pendingTopicPayload);
            topicId = String(topicRes?.id || '').trim();
            if (!topicId) throw new Error('ID topik baru tidak diterima dari server.');
            if (topicInput) topicInput.value = topicId;
        }

        const baseOrderIndex = (currentLmsMaterials || [])
            .filter(item => String(item.topic_id) === String(topicId))
            .reduce((max, item) => Math.max(max, Number(item.order_index) || 0), 0);

        let savedCount = 0;
        let nextOrderIndex = baseOrderIndex;

        for (let i = 0; i < materialsToSave.length; i++) {
            const mat = materialsToSave[i];
            const materialPayload = {
                topic_id: topicId,
                teacher_id: user?.uid || 'guru_mapel',
                teacher_name: user?.displayName || 'Guru Mapel',
                subject_name: mapel,
                class_name: kelas,
                title: mat.title,
                content_description: mat.resourceType === 'html' ? mat.htmlCode : mat.contentDescription,
                html_instructions: mat.resourceType === 'html' ? mat.contentDescription : undefined,
                resource_type: mat.resourceType,
                resource_url: mat.resourceUrl,
                quiz_payload: mat.quizPayload || '',
                is_published: isPublished,
                is_teaching_completed: mat.isAppended ? 0 : isTeachingCompleted,
                publish_at: publishAt,
                allow_discussion: mat.allowDiscussion,
                discussion_prompt: mat.discussionPrompt,
                due_date: dueDate,
                order_index: mat.id ? mat.order_index : ++nextOrderIndex
            };
            if (mat.id) materialPayload.id = mat.id;
            else if (mat.client_request_id) materialPayload.client_request_id = mat.client_request_id;

            try {
                const saved = await cfSaveLmsMaterial(materialPayload);
                if (mat.card) {
                    mat.card.dataset.savedId = saved.id;
                    mat.card.dataset.originalOrder = materialPayload.order_index;
                }
                savedCount++;
            } catch (err) {
                showToast('Error Simpan', `Modul ke-${i + 1} (${mat.title}) gagal disimpan: ${err.message}`, 'error');
                break;
            }
        }

        if (savedCount === 0) {
            return;
        }

        if (savedCount < materialsToSave.length) {
            await window.loadLmsData(true);
            showToast('Sebagian Berhasil', `${savedCount} dari ${materialsToSave.length} modul berhasil disimpan. Semua isian dipertahankan; klik Simpan untuk melanjutkan tanpa menggandakan modul.`, 'warning');
            return;
        }
        showToast('Berhasil', `${savedCount} materi pembelajaran berhasil disimpan.`, 'success');

        await window.loadLmsData(true);
        window.closeUnifiedLmsCreator();

    } catch (err) {
        console.error('[LMS Guru] Error saving material wizard:', err);
        showToast('Gagal Menyimpan', err.message || 'Terjadi kesalahan.', 'error');
    } finally {
        if (btnSubmit) btnSubmit.disabled = false;
        if (btnAddAnother) btnAddAnother.disabled = false;
    }
};


window.initLmsCopyTabState = function () {
    const mapel = document.getElementById('select-mapel')?.value || '';
    const targetClass = document.getElementById('select-kelas')?.value || '';
    const targetClassLabel = document.getElementById('lms-copy-target-class-label');
    const targetMapelLabel = document.getElementById('lms-copy-target-mapel-label');
    const sourceClassSelect = document.getElementById('select-lms-copy-source-class');
    const previewContainer = document.getElementById('lms-copy-preview-container');
    const btnSubmit = document.getElementById('btn-submit-lms-copy');

    document.getElementById('input-lms-copy-publish-at').value = '';
    document.getElementById('input-lms-copy-due').value = '';
    const scheduleWrapper = document.getElementById('wrapper-lms-copy-schedule');
    if (scheduleWrapper) scheduleWrapper.classList.add('hidden');

    if (targetClassLabel) targetClassLabel.textContent = targetClass || '-';
    if (targetMapelLabel) targetMapelLabel.textContent = mapel || '-';

    lmsCopyLoadedSourceData = { topics: [], materials: [] };
    if (previewContainer) {
        previewContainer.innerHTML = `
            <div class="text-center py-6 text-slate-400 text-xs italic">
                Silakan pilih kelas asal di atas untuk memuat daftar topik &amp; materi.
            </div>
        `;
    }
    if (btnSubmit) btnSubmit.disabled = true;

    if (sourceClassSelect) {
        sourceClassSelect.innerHTML = '<option value="">-- Pilih Kelas Sumber Materi --</option>';

        const eligibleClasses = typeof getEligibleClassesForLmsTarget === 'function'
            ? getEligibleClassesForLmsTarget(mapel, targetClass)
            : [];

        const otherClasses = eligibleClasses.filter(c => {
            if (!c) return false;
            return typeof isClassEqual === 'function' ? !isClassEqual(c, targetClass) : c.trim().toLowerCase() !== targetClass.trim().toLowerCase();
        });

        if (otherClasses.length === 0) {
            sourceClassSelect.innerHTML = '<option value="">-- Tidak ada kelas lain yang tersedia dalam 1 angkatan --</option>';
        } else {
            otherClasses.forEach(c => {
                sourceClassSelect.innerHTML += `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`;
            });
        }
    }
};

window.openLmsTopicModal = function (topicId = null) {
    window.openUnifiedLmsCreator('create', 1, topicId);
};
window.closeLmsTopicModal = function () {
    window.closeUnifiedLmsCreator();
};
window.openLmsMaterialModal = function (materialId = null, defaultTopicId = null) {
    window.openUnifiedLmsCreator('create', 2, defaultTopicId, materialId);
};
window.reactivateLmsMaterial = function (materialId) {
    const material = currentLmsMaterials.find(item => item.id === materialId);
    if (!material) return;
    window.openLmsMaterialModal(materialId, material.topic_id);
    document.getElementById('select-lms-material-teaching-status').value = '0';
    const target = document.getElementById('input-lms-material-due');
    target.value = '';
    target.focus();
    showToast('Aktifkan Kembali', 'Atur target selesai baru, lalu simpan. Nilai dan riwayat siswa tetap tersimpan.', 'info');
};
window.closeLmsMaterialModal = function () {
    window.closeUnifiedLmsCreator();
};
window.openLmsCopyModal = function () {
    window.openUnifiedLmsCreator('copy');
};
window.closeLmsCopyModal = function () {
    window.closeUnifiedLmsCreator();
};

window.saveLmsTopic = async function () {
    const mapel = document.getElementById('select-mapel')?.value || '';
    const kelas = document.getElementById('select-kelas')?.value || '';
    const semester = document.getElementById('select-semester')?.value || '1';
    const semesterText = semester === '1' ? 'Ganjil' : 'Genap';
    const academicYear = raporConfig.tahun_ajaran_aktif || getCurrentAcademicYearString();

    const id = document.getElementById('input-lms-topic-id')?.value || '';
    const title = (document.getElementById('input-lms-topic-name')?.value || '').trim();
    const description = (document.getElementById('input-lms-topic-desc')?.value || '').trim();
    const orderIndex = Number(document.getElementById('input-lms-topic-order')?.value) || (currentLmsTopics ? currentLmsTopics.length + 1 : 1);

    if (!title) {
        showToast('Judul Wajib Diisi', 'Silakan masukkan judul bab/topik.', 'warning');
        return;
    }

    if (!mapel || !kelas) {
        showToast('Pilih Mapel & Kelas', 'Silakan pilih Mata Pelajaran dan Rombel Kelas pada filter atas terlebih dahulu.', 'warning');
        return;
    }

    const btnSubmit = document.getElementById('btn-submit-lms-topic');
    if (btnSubmit) btnSubmit.disabled = true;

    try {
        const user = auth?.currentUser;
        const payload = {
            id: id || undefined,
            teacher_id: user?.uid || 'guru_mapel',
            teacher_name: user?.displayName || 'Guru Mapel',
            subject_name: mapel,
            class_name: kelas,
            title,
            description,
            order_index: orderIndex,
            academic_year: academicYear,
            semester: semesterText
        };

        await cfSaveLmsTopic(payload);

        showToast('Berhasil', 'Topik pembelajaran berhasil disimpan.', 'success');
        window.closeLmsTopicModal();
        await window.loadLmsData(true);
    } catch (err) {
        console.error('[LMS Guru] Error saving topic:', err);
        showToast('Gagal Menyimpan', err.message || 'Terjadi kesalahan.', 'error');
    } finally {
        if (btnSubmit) btnSubmit.disabled = false;
    }
};

window.deleteLmsTopic = async function (topicId) {
    const topic = (currentLmsTopics || []).find(t => String(t.id) === String(topicId));
    const topicTitle = topic ? `"${topic.title}"` : 'ini';
    const msg = `Apakah Anda yakin ingin menghapus topik <b>${window.escapeHTML ? window.escapeHTML(topicTitle) : topicTitle}</b> beserta seluruh modul materi di dalamnya?<br><br><span style="font-size:0.85rem;color:#64748b;display:block;line-height:1.5;">Seluruh materi belajar dan catatan progres siswa di dalam topik ini akan dihapus permanen.</span>`;

    const confirmed = typeof window.showConfirmModal === 'function'
        ? await window.showConfirmModal(
            msg,
            'Hapus Topik Pembelajaran',
            'danger',
            {
                confirmText: 'Ya, Hapus Topik',
                requireText: 'hapus topik'
            }
        )
        : (prompt(`Ketik "hapus topik" untuk mengonfirmasi penghapusan topik ${topicTitle}:`) || '').trim().toLowerCase() === 'hapus topik';
    if (!confirmed) return;

    // Helper untuk membersihkan state lokal & cache sesi
    const purgeTopicLocally = () => {
        if (Array.isArray(currentLmsTopics)) {
            const keep = currentLmsTopics.filter(t => String(t.id) !== String(topicId));
            currentLmsTopics.length = 0;
            currentLmsTopics.push(...keep);
        } else {
            currentLmsTopics = [];
        }
        if (Array.isArray(currentLmsMaterials)) {
            const keep = currentLmsMaterials.filter(m => String(m.topic_id) !== String(topicId));
            currentLmsMaterials.length = 0;
            currentLmsMaterials.push(...keep);
        } else {
            currentLmsMaterials = [];
        }
        if (Array.isArray(currentLmsModules)) {
            const keep = currentLmsModules.filter(m => String(m.topic_id) !== String(topicId));
            currentLmsModules.length = 0;
            currentLmsModules.push(...keep);
        } else {
            currentLmsModules = [];
        }
        for (const key of sessionPortalDataCache.keys()) {
            try {
                const parsed = JSON.parse(key);
                if (Array.isArray(parsed) && parsed[0] === 'lms') sessionPortalDataCache.delete(key);
            } catch (_) {}
        }
        if (String(document.getElementById('input-lms-topic-id')?.value) === String(topicId)) window.closeLmsTopicModal();
    };

    try {
        const res = await cfDeleteLmsTopic(topicId);
        purgeTopicLocally();
        const successMsg = res?.already_deleted
            ? 'Topik pembelajaran sudah tidak ada di server dan telah dibersihkan.'
            : 'Topik pembelajaran berhasil dihapus.';
        showToast('Berhasil Dihapus', successMsg, 'success');
        await window.loadLmsData(true);
    } catch (err) {
        console.error('[LMS Guru] Error deleting topic:', err);
        const isNotFound = err.status === 404 || (err.message && /tidak ditemukan|not found/i.test(err.message));
        if (isNotFound) {
            // Self-healing: Topik sudah tidak ada di database D1
            purgeTopicLocally();
            showToast('Topik Dibersihkan', 'Topik sudah tidak ada di server dan telah dihapus dari tampilan.', 'info');
            await window.loadLmsData(true);
        } else {
            showToast('Gagal Menghapus', err.message || 'Terjadi kesalahan.', 'error');
        }
    }
};

window.deleteLmsMaterial = async function (materialId) {
    const mat = (currentLmsMaterials || []).find(m => String(m.id) === String(materialId));
    const matTitle = mat ? `"${mat.title}"` : 'ini';
    const msg = `Apakah Anda yakin ingin menghapus modul materi <b>${window.escapeHTML ? window.escapeHTML(matTitle) : matTitle}</b>?<br><br><span style="font-size:0.85rem;color:#64748b;display:block;line-height:1.5;">Seluruh progres baca dan diskusi terkait materi ini akan dihapus permanen.</span>`;

    const confirmed = typeof window.showConfirmModal === 'function'
        ? await window.showConfirmModal(
            msg,
            'Hapus Modul Materi',
            'danger',
            {
                confirmText: 'Ya, Hapus Modul',
                requireText: 'hapus modul'
            }
        )
        : (prompt(`Ketik "hapus modul" untuk mengonfirmasi penghapusan modul materi ${matTitle}:`) || '').trim().toLowerCase() === 'hapus modul';
    if (!confirmed) return;

    // Helper untuk membersihkan state materi secara lokal
    const purgeMaterialLocally = () => {
        if (Array.isArray(currentLmsMaterials)) {
            const keep = currentLmsMaterials.filter(m => String(m.id) !== String(materialId));
            currentLmsMaterials.length = 0;
            currentLmsMaterials.push(...keep);
        } else {
            currentLmsMaterials = [];
        }
        for (const key of sessionPortalDataCache.keys()) {
            try {
                const parsed = JSON.parse(key);
                if (Array.isArray(parsed) && parsed[0] === 'lms') sessionPortalDataCache.delete(key);
            } catch (_) {}
        }
    };

    try {
        const res = await cfDeleteLmsMaterial(materialId);
        purgeMaterialLocally();
        const successMsg = res?.already_deleted
            ? 'Materi pembelajaran sudah tidak ada di server dan telah dibersihkan.'
            : 'Materi pembelajaran berhasil dihapus.';
        showToast('Berhasil Dihapus', successMsg, 'success');
        await window.loadLmsData(true);
    } catch (err) {
        console.error('[LMS Guru] Error deleting material:', err);
        const isNotFound = err.status === 404 || (err.message && /tidak ditemukan|not found/i.test(err.message));
        if (isNotFound) {
            purgeMaterialLocally();
            showToast('Materi Dibersihkan', 'Materi sudah tidak ada di server dan telah dihapus dari tampilan.', 'info');
            await window.loadLmsData(true);
        } else {
            showToast('Gagal Menghapus', err.message || 'Terjadi kesalahan.', 'error');
        }
    }
};

function formatLmsPublishDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const d = new Date(typeof dateStr === 'string' && !/(Z|[+-]\d{2}:\d{2})$/i.test(dateStr) ? `${dateStr}+08:00` : dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return new Intl.DateTimeFormat('id-ID', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Makassar'
        }).format(d);
    } catch {
        return dateStr;
    }
}

function normalizeLmsPublishAt(dateStr) {
    if (!dateStr) return '';
    const value = String(dateStr).trim();
    // datetime-local represents school time (WITA), regardless of the device timezone.
    const date = new Date(/(Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}+08:00`);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function formatToDatetimeLocal(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(typeof dateStr === 'string' && !/(Z|[+-]\d{2}:\d{2})$/i.test(dateStr) ? `${dateStr}+08:00` : dateStr);
        if (isNaN(d.getTime())) return '';
        return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
    } catch {
        return '';
    }
}

window.toggleLmsPublishSchedule = function () {
    const status = document.getElementById('select-lms-material-published');
    if (status) status.value = '2';
    document.getElementById('container-lms-material-schedule')?.classList.remove('hidden');
    const opens = document.getElementById('input-lms-material-publish-at');
    const closes = document.getElementById('input-lms-material-due');
    if (opens) opens.required = true;
    if (closes) { closes.required = true; closes.min = opens?.value || ''; }
};

window.syncLmsMaterialTeachingStatusWithDue = function () {
    const inputDue = document.getElementById('input-lms-material-due');
    const selectTeachingStatus = document.getElementById('select-lms-material-teaching-status');
    if (!inputDue || !selectTeachingStatus) return;
    const rawDue = inputDue.value?.trim();
    if (!rawDue) return;
    const normalized = normalizeLmsScheduleTime(rawDue, true);
    const dueTime = Date.parse(normalized);
    if (Number.isFinite(dueTime)) {
        if (dueTime > Date.now()) {
            if (selectTeachingStatus.value === '1') {
                selectTeachingStatus.value = '0';
                selectTeachingStatus.dispatchEvent(new Event('change', { bubbles: true }));
            }
        } else if (dueTime <= Date.now()) {
            if (selectTeachingStatus.value === '0') {
                selectTeachingStatus.value = '1';
                selectTeachingStatus.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    }
};
window.toggleLmsItemType = function () {
    window.toggleLmsDiscussionPrompt();
};

window.toggleLmsDiscussionPrompt = function (cardEl) {
    let selectDisc, container, inputPrompt;
    if (cardEl) {
        selectDisc = cardEl.querySelector('.lms-field-discussion');
        container = cardEl.querySelector('.lms-discussion-prompt-container');
        inputPrompt = cardEl.querySelector('.lms-field-discussion-prompt');
    } else {
        selectDisc = document.getElementById('select-lms-material-discussion');
        container = document.getElementById('container-lms-discussion-prompt');
        inputPrompt = document.getElementById('input-lms-material-discussion-prompt');
    }
    if (!selectDisc || !container) return;

    if (selectDisc.value === '1') {
        container.classList.remove('hidden');
        if (inputPrompt) inputPrompt.required = true;
    } else {
        container.classList.add('hidden');
        if (inputPrompt) {
            inputPrompt.required = false;
        }
    }
};

let currentLmsProgressData = [];
let currentLmsProgressMaterial = null;

installQuizBuilder({ notify: showToast, aiImport: createQuizAiImporter({
    getUserId: () => auth?.currentUser?.uid,
    getApiKeys: getUserGeminiApiKeysAsync,
    getConfig: getAiConfigAsync,
    requestWithFallback: fetchGeminiWithFallback
}) });
installTeacherQuiz({
    api: { list: cfGetLmsQuizAttempts, review: cfReviewLmsQuiz, unlock: cfUnlockLmsQuiz, reset: cfResetLmsQuiz },
    getMaterial: id => currentLmsMaterials.find(m => m.id === id),
    refresh: id => window.refreshLmsMaterialProgress(id),
    notify: showToast
});

window.updateResourcePlaceholder = function (cardEl) {
    configureLmsHtmlEditor(cardEl || document.querySelector('.lms-material-card[data-card-index="0"]'));
    let selectType, inputUrl, tipEl, quizBuilderEl;
    if (cardEl) {
        selectType = cardEl.querySelector('.lms-field-resource-type');
        inputUrl = cardEl.querySelector('.lms-field-resource-url');
        tipEl = cardEl.querySelector('.lms-resource-tip');
        quizBuilderEl = cardEl.querySelector('.lms-container-quiz-builder');
    } else {
        selectType = document.getElementById('select-lms-resource-type');
        inputUrl = document.getElementById('input-lms-resource-url');
        tipEl = document.getElementById('lms-resource-helper-tip');
        quizBuilderEl = document.querySelector('.lms-container-quiz-builder');
    }
    const type = selectType?.value || 'gdrive';
    if (!inputUrl) return;

    if (type === 'quiz') {
        inputUrl.placeholder = '(Opsional untuk kuis formatif)';
        if (tipEl) {
            tipEl.innerHTML = `
                <i class="fa-solid fa-lightbulb text-amber-500 mt-0.5 shrink-0"></i>
                <p class="leading-relaxed">
                    <strong>Tips Kuis Formatif:</strong> Susun PG, isian singkat, atau uraian. Atur bobot dan gunakan pratinjau. Periksa jawaban serta beri umpan balik melalui tombol Periksa jawaban pada progres siswa.
                </p>
            `;
        }
        if (quizBuilderEl) {
            quizBuilderEl.classList.remove('hidden');
            const qList = quizBuilderEl.querySelector('.lms-quiz-questions-list');
            if (qList && qList.children.length === 0) {
                window.addLmsQuizQuestion(cardEl || document.querySelector('.lms-material-card[data-card-index="0"]'), 'mc');
            }
        }
    } else {
        if (quizBuilderEl) quizBuilderEl.classList.add('hidden');
        if (type === 'html') {
            inputUrl.placeholder = '(Tidak diperlukan untuk materi HTML)';
            if (tipEl) tipEl.textContent = 'Materi HTML ditampilkan sebagai web interaktif. Gunakan Preview untuk mencoba tombol, animasi, dan latihan sebelum disimpan.';
        } else if (type === 'gdrive') {
            inputUrl.placeholder = 'drive.google.com/file/d/... atau folder (boleh tanpa https://)';
            if (tipEl) {
                tipEl.innerHTML = `
                    <i class="fa-solid fa-lightbulb text-amber-500 mt-0.5 shrink-0"></i>
                    <p class="leading-relaxed">
                        <strong>Tips Google Drive:</strong> Pastikan dokumen/slide/PDF di Google Drive telah diatur aksesnya ke <em>"Siapa saja yang memiliki link (Anyone with the link)"</em> agar seluruh siswa dapat langsung membukanya.
                    </p>
                `;
            }
        } else if (type === 'youtube') {
            inputUrl.placeholder = 'youtube.com/watch?v=... atau youtu.be/... (boleh tanpa https://)';
            if (tipEl) {
                tipEl.innerHTML = `
                    <i class="fa-solid fa-lightbulb text-amber-500 mt-0.5 shrink-0"></i>
                    <p class="leading-relaxed">
                        <strong>Tips Video YouTube:</strong> Salin tautan video YouTube (boleh diawali atau tanpa <code>https://</code>). Siswa dapat langsung menonton materi melalui tautan tersebut.
                    </p>
                `;
            }
        } else if (type === 'link') {
            inputUrl.placeholder = 'alamat-website.com/... (boleh tanpa https://)';
            if (tipEl) {
                tipEl.innerHTML = `
                    <i class="fa-solid fa-lightbulb text-amber-500 mt-0.5 shrink-0"></i>
                    <p class="leading-relaxed">
                        <strong>Tips Tautan Web:</strong> Masukkan URL modul atau artikel web (boleh diawali atau tanpa <code>https://</code>). Website seperti Canva dibuka melalui tombol Buka materi di tab browser. Catatan buka tetap masuk LMS. Gunakan HTML Interaktif jika memiliki kode/file HTML untuk belajar di dalam LMS.
                    </p>
                `;
            }
        } else {
            inputUrl.placeholder = '(Opsional untuk modul teks)';
            if (tipEl) {
                tipEl.innerHTML = `
                    <i class="fa-solid fa-lightbulb text-amber-500 mt-0.5 shrink-0"></i>
                    <p class="leading-relaxed">
                        <strong>Tips Teks Mandiri:</strong> Tautan URL bersifat opsional. Tuliskan ringkasan materi, catatan kelas, atau instruksi belajar pada kolom teks di bawah.
                    </p>
                `;
            }
        }
    }
};

window.testOpenResourceUrl = function (cardEl) {
    let inputUrl;
    if (cardEl) {
        inputUrl = cardEl.querySelector('.lms-field-resource-url');
    } else {
        inputUrl = document.getElementById('input-lms-resource-url');
    }
    let url = (inputUrl?.value || '').trim();
    if (!url) {
        showToast('Link Kosong', 'Masukkan URL link materi terlebih dahulu.', 'warning');
        return;
    }
    url = window.normalizeLmsResourceUrl(url);
    if (inputUrl && inputUrl.value !== url) {
        inputUrl.value = url;
    }
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch (_) { }
    if (!parsedUrl || !['http:', 'https:'].includes(parsedUrl.protocol) || (!parsedUrl.hostname.includes('.') && parsedUrl.hostname !== 'localhost')) {
        showToast('URL Tidak Valid', 'Format link belum valid (contoh: drive.google.com/... atau youtu.be/...).', 'warning');
        return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
};

window.saveLmsMaterial = async function () {
    const mapel = document.getElementById('select-mapel')?.value || '';
    const kelas = document.getElementById('select-kelas')?.value || '';

    const id = document.getElementById('input-lms-material-id')?.value || '';
    const topicId = document.getElementById('select-lms-material-topic')?.value || '';
    const title = (document.getElementById('input-lms-material-title')?.value || '').trim();
    const resourceType = document.getElementById('select-lms-resource-type')?.value || 'gdrive';
    let resourceUrl = (document.getElementById('input-lms-resource-url')?.value || '').trim();
    if (!['text', 'quiz', 'html'].includes(resourceType) && resourceUrl) {
        resourceUrl = window.normalizeLmsResourceUrl(resourceUrl);
    }
    const contentDescription = (document.getElementById('input-lms-material-content')?.value || '').trim();
    const htmlCode = document.getElementById('input-lms-html-code')?.value || '';
    const isPublished = 2;
    const isTeachingCompleted = Number(document.getElementById('select-lms-material-teaching-status')?.value ?? 0);
    const selectDiscussion = document.getElementById('select-lms-material-discussion');
    const allowDiscussion = selectDiscussion?.value === '0' ? 0 : 1;
    const discussionPrompt = (document.getElementById('input-lms-material-discussion-prompt')?.value || '').trim();
    const orderIndex = Number(document.getElementById('input-lms-material-order')?.value) ||
        ((currentLmsMaterials || []).filter(item => String(item.topic_id) === String(topicId)).reduce((max, item) => Math.max(max, Number(item.order_index) || 0), 0) + 1);
    let publishAt, dueDate;
    try {
        ({ publish_at: publishAt, due_date: dueDate } = validateLmsSchedule(
            document.getElementById('input-lms-material-publish-at')?.value,
            document.getElementById('input-lms-material-due')?.value));
    } catch (error) {
        showToast('Jadwal Wajib & Valid', error.message, 'warning');
        return;
    }

    if (!topicId || !title) {
        showToast('Lengkapi Form', 'Pilih Topik dan masukkan Judul Materi.', 'warning');
        return;
    }
    if (allowDiscussion === 1 && !discussionPrompt) {
        showToast('Pemantik Diskusi Wajib', 'Isi pertanyaan atau pernyataan pemantik ketika forum diskusi diaktifkan.', 'warning');
        document.getElementById('input-lms-material-discussion-prompt')?.focus();
        return;
    }
    if (!['text', 'quiz', 'html'].includes(resourceType)) {
        if (!resourceUrl) {
            showToast('Tautan Materi Wajib', 'Masukkan URL dokumen, video, atau halaman web yang akan dibuka siswa.', 'warning');
            return;
        }
        let parsedUrl;
        try { parsedUrl = new URL(resourceUrl); } catch (_) { }
        if (!parsedUrl || !['http:', 'https:'].includes(parsedUrl.protocol) || (!parsedUrl.hostname.includes('.') && parsedUrl.hostname !== 'localhost')) {
            showToast('URL Tidak Valid', 'Tautan materi harus berupa URL web yang valid (contoh: drive.google.com/... atau youtu.be/...).', 'warning');
            return;
        }
    }
    if (resourceType === 'text' && !contentDescription) {
        showToast('Isi Materi Wajib', 'Tuliskan isi materi teks agar siswa memiliki bahan belajar.', 'warning');
        return;
    }
    if (resourceType === 'html') {
        try {
            validateLmsHtml(htmlCode);
            if (contentDescription.length > 16000) throw new Error('Petunjuk belajar maksimal 16.000 karakter.');
            resourceUrl = '';
        }
        catch (error) { showToast('Kode HTML Tidak Valid', error.message, 'warning'); return; }
    }

    const btnSubmit = document.getElementById('btn-submit-lms-material');
    if (btnSubmit) btnSubmit.disabled = true;

    try {
        const user = auth?.currentUser;
        const payload = {
            id: id || undefined,
            topic_id: topicId,
            teacher_id: user?.uid || 'guru_mapel',
            teacher_name: user?.displayName || 'Guru Mapel',
            subject_name: mapel,
            class_name: kelas,
            title,
            content_description: resourceType === 'html' ? htmlCode : contentDescription,
            html_instructions: resourceType === 'html' ? contentDescription : undefined,
            resource_type: resourceType,
            resource_url: resourceUrl,
            is_published: isPublished,
            is_teaching_completed: isTeachingCompleted,
            publish_at: publishAt,
            allow_discussion: allowDiscussion,
            discussion_prompt: discussionPrompt,
            due_date: dueDate,
            order_index: orderIndex
        };

        await cfSaveLmsMaterial(payload);
        showToast('Berhasil', 'Materi pembelajaran berhasil disimpan.', 'success');
        window.closeLmsMaterialModal();
        await window.loadLmsData(true);
    } catch (err) {
        console.error('[LMS Guru] Error saving material:', err);
        showToast('Gagal Menyimpan', err.message || 'Terjadi kesalahan.', 'error');
    } finally {
        if (btnSubmit) btnSubmit.disabled = false;
    }
};

window.updateLmsCopyScheduleVisibility = function () {
    const scheduleWrapper = document.getElementById('wrapper-lms-copy-schedule');
    const btnSubmit = document.getElementById('btn-submit-lms-copy');
    const toggleBtn = document.getElementById('btn-lms-copy-toggle-all');
    const allCheckboxes = document.querySelectorAll('input[name="lms-copy-topic"]');
    const checkedCheckboxes = document.querySelectorAll('input[name="lms-copy-topic"]:checked');
    const checkedCount = checkedCheckboxes.length;

    if (scheduleWrapper) {
        if (checkedCount > 0) {
            scheduleWrapper.classList.remove('hidden');
        } else {
            scheduleWrapper.classList.add('hidden');
        }
    }

    if (btnSubmit) {
        btnSubmit.disabled = (checkedCount === 0);
    }

    if (toggleBtn && allCheckboxes.length > 0) {
        const allChecked = checkedCount === allCheckboxes.length;
        toggleBtn.textContent = allChecked ? 'Batal Pilih Semua' : 'Pilih Semua';
    }
};

window.onLmsCopyTopicCheckboxChange = function () {
    if (typeof window.updateLmsCopyScheduleVisibility === 'function') {
        window.updateLmsCopyScheduleVisibility();
    }
};

window.onLmsCopySourceClassChange = async function () {
    const sourceClass = document.getElementById('select-lms-copy-source-class')?.value || '';
    const previewContainer = document.getElementById('lms-copy-preview-container');
    const scheduleWrapper = document.getElementById('wrapper-lms-copy-schedule');
    const btnSubmit = document.getElementById('btn-submit-lms-copy');
    const mapel = document.getElementById('select-mapel')?.value || '';

    if (scheduleWrapper) scheduleWrapper.classList.add('hidden');

    if (!sourceClass) {
        lmsCopyLoadedSourceData = { topics: [], materials: [] };
        if (previewContainer) {
            previewContainer.innerHTML = `
                <div class="text-center py-6 text-slate-400 text-xs italic">
                    Silakan pilih kelas asal di atas untuk memuat daftar topik &amp; materi.
                </div>
            `;
        }
        if (btnSubmit) btnSubmit.disabled = true;
        return;
    }

    if (previewContainer) {
        previewContainer.innerHTML = `
            <div class="p-6 text-center text-slate-400 text-xs italic">
                <i class="fa-solid fa-spinner fa-spin text-lg mb-2 text-indigo-500"></i>
                <p>Memuat daftar Topik &amp; Modul dari ${escapeHTML(sourceClass)}...</p>
            </div>
        `;
    }

    try {
        const [topics, materials] = await Promise.all([
            cfGetLmsTopics({ class: sourceClass, subject: mapel }),
            cfGetLmsMaterials({ class: sourceClass, subject: mapel })
        ]);

        lmsCopyLoadedSourceData = { topics: topics || [], materials: materials || [] };

        if (!topics || topics.length === 0) {
            if (previewContainer) {
                previewContainer.innerHTML = `
                    <div class="p-6 text-center text-amber-600 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-900/60 text-xs font-semibold">
                        <i class="fa-solid fa-folder-open text-xl mb-1 text-amber-500"></i>
                        <p>Belum ada topik materi di kelas <strong>${escapeHTML(sourceClass)}</strong> untuk mapel ini.</p>
                    </div>
                `;
            }
            if (btnSubmit) btnSubmit.disabled = true;
            return;
        }

        renderLmsCopyPreviewList();
    } catch (err) {
        console.error('[LMS Copy] Error fetching source class LMS data:', err);
        if (previewContainer) {
            previewContainer.innerHTML = `
                <div class="p-4 text-center text-rose-500 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-xs font-semibold">
                    <i class="fa-solid fa-triangle-exclamation text-lg mb-1"></i>
                    <p>Gagal memuat materi kelas asal: ${escapeHTML(err.message || 'Kesalahan jaringan.')}</p>
                </div>
            `;
        }
        if (btnSubmit) btnSubmit.disabled = true;
    }
};

function renderLmsCopyPreviewList() {
    const previewContainer = document.getElementById('lms-copy-preview-container');
    if (!previewContainer) return;

    const topics = lmsCopyLoadedSourceData.topics || [];
    const materials = lmsCopyLoadedSourceData.materials || [];

    let html = '';
    topics.forEach((t, idx) => {
        const tMats = materials.filter(m => m.topic_id === t.id);
        html += `
            <div class="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700/80 shadow-2xs space-y-1.5">
                <div class="flex items-center gap-2">
                    <input type="checkbox" name="lms-copy-topic" value="${escapeHTML(t.id)}" id="chk-topic-${idx}" checked onchange="window.onLmsCopyTopicCheckboxChange()"
                        class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer">
                    <label for="chk-topic-${idx}" class="text-xs font-bold text-slate-800 dark:text-slate-100 cursor-pointer flex-1 truncate">
                        ${idx + 1}. ${escapeHTML(t.title)}
                    </label>
                    <span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-bold shrink-0">
                        ${tMats.length} Modul
                    </span>
                </div>
        `;

        if (tMats.length > 0) {
            html += `<ul class="pl-6 space-y-1 border-l-2 border-slate-100 dark:border-slate-800 ml-2 mt-1">`;
            tMats.forEach(m => {
                let icon = '<i class="fa-solid fa-link text-purple-500 text-[10px]"></i>';
                if (m.resource_type === 'gdrive') icon = '<i class="fa-brands fa-google-drive text-blue-500 text-[10px]"></i>';
                else if (m.resource_type === 'youtube') icon = '<i class="fa-brands fa-youtube text-rose-500 text-[10px]"></i>';
                else if (m.resource_type === 'text') icon = '<i class="fa-solid fa-file-lines text-slate-500 text-[10px]"></i>';

                html += `
                    <li class="text-[11px] text-slate-600 dark:text-slate-300 truncate flex items-center gap-1.5">
                        ${icon}
                        <span class="truncate">${escapeHTML(m.title)}</span>
                    </li>
                `;
            });
            html += `</ul>`;
        }

        html += `</div>`;
    });

    previewContainer.innerHTML = html;
    if (typeof window.updateLmsCopyScheduleVisibility === 'function') {
        window.updateLmsCopyScheduleVisibility();
    }
}

window.toggleLmsCopySelectAll = function () {
    const checkboxes = document.querySelectorAll('input[name="lms-copy-topic"]');
    if (checkboxes.length === 0) return;
    const anyUnchecked = Array.from(checkboxes).some(cb => !cb.checked);
    checkboxes.forEach(cb => {
        cb.checked = anyUnchecked;
    });
    if (typeof window.updateLmsCopyScheduleVisibility === 'function') {
        window.updateLmsCopyScheduleVisibility();
    }
};

window.executeLmsCopyFromClass = async function () {
    const sourceClass = document.getElementById('select-lms-copy-source-class')?.value || '';
    const targetClass = document.getElementById('select-kelas')?.value || '';
    const mapel = document.getElementById('select-mapel')?.value || '';
    let schedule;
    try { schedule = validateLmsSchedule(document.getElementById('input-lms-copy-publish-at')?.value, document.getElementById('input-lms-copy-due')?.value); }
    catch (error) { showToast('Jadwal Wajib & Valid', error.message, 'warning'); return; }
    const checkedTopicEls = document.querySelectorAll('input[name="lms-copy-topic"]:checked');
    const selectedTopicIds = Array.from(checkedTopicEls).map(el => el.value);

    if (!sourceClass || !targetClass || !mapel) {
        showToast('Validasi Gagal', 'Data kelas asal, tujuan, atau mapel tidak valid.', 'warning');
        return;
    }

    if (selectedTopicIds.length === 0) {
        showToast('Pilih Topik', 'Silakan centang minimal 1 topik pembelajaran yang ingin disalin.', 'warning');
        return;
    }

    const btnSubmit = document.getElementById('btn-submit-lms-copy');
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyalin...';
    }

    try {
        const payload = {
            source_class: sourceClass,
            target_class: targetClass,
            subject_name: mapel,
            topic_ids: selectedTopicIds,
            ...schedule
        };

        const res = await cfCopyLmsFromClass(payload);
        showToast('Berhasil Disalin! 🎉', res.message || `Materi dari ${sourceClass} berhasil disalin ke ${targetClass}.`, 'success');
        window.closeLmsCopyModal();

        if (typeof window.loadLmsData === 'function') {
            await window.loadLmsData(true);
        }
    } catch (err) {
        console.error('[LMS Copy] Execution failed:', err);
        showToast('Gagal Menyalin Materi', err.message || 'Terjadi kesalahan saat menduplikasi materi.', 'error');
    } finally {
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = '<i class="fa-solid fa-clone"></i> <span>Salin ke Kelas Ini</span>';
        }
    }
};

window.switchMaterialContentTab = function (tab, cardEl) {
    let btnEditor, btnPreview, textarea, previewBox;
    if (cardEl) {
        btnEditor = cardEl.querySelector('.lms-btn-tab-editor');
        btnPreview = cardEl.querySelector('.lms-btn-tab-preview');
        textarea = cardEl.querySelector('.lms-field-content');
        previewBox = cardEl.querySelector('.lms-content-preview');
    } else {
        btnEditor = document.getElementById('btn-tab-lms-editor');
        btnPreview = document.getElementById('btn-tab-lms-preview');
        textarea = document.getElementById('input-lms-material-content');
        previewBox = document.getElementById('container-lms-material-preview');
    }
    if (!btnEditor || !btnPreview || !textarea || !previewBox) return;

    if (tab === 'preview') {
        btnPreview.className = 'lms-btn-tab-preview px-2 py-0.5 rounded font-bold bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-2xs';
        btnEditor.className = 'lms-btn-tab-editor px-2 py-0.5 rounded font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200';
        const raw = textarea.value || '';
        previewBox.style.maxHeight = '';
        previewBox.innerHTML = raw.trim() ? renderSafeMarkdown(raw) : '<p class="text-xs text-slate-400 italic">Belum ada petunjuk atau konten teks untuk dipratinjau.</p>';
        previewBox.classList.remove('hidden');
        textarea.classList.add('hidden');
    } else {
        btnEditor.className = 'lms-btn-tab-editor px-2 py-0.5 rounded font-bold bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-2xs';
        btnPreview.className = 'lms-btn-tab-preview px-2 py-0.5 rounded font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200';
        previewBox.classList.add('hidden');
        previewBox.replaceChildren();
        textarea.classList.remove('hidden');
    }
};

window.importLmsHtmlFile = input => importLmsHtmlFile(input, showToast);
window.previewLmsHtml = function (cardEl) {
    const code = cardEl?.querySelector('.lms-field-html')?.value || '';
    const instructions = cardEl?.querySelector('.lms-field-content')?.value || '';
    try {
        const title = cardEl?.querySelector('.lms-field-title')?.value || 'Preview materi HTML';
        if(window.lmsModuleWorkspace?.previewHtml)return window.lmsModuleWorkspace.previewHtml({code,title,instructions});
        const body = document.getElementById('lms-preview-body');
        if (!body) return;
        mountLmsHtml(body, code, title, instructions);
        const heading = document.getElementById('lms-preview-title');
        if (heading) heading.textContent = title;
        document.getElementById('modal-lms-text-preview')?.classList.remove('hidden');
    } catch (error) { showToast('Preview HTML Gagal', error.message, 'warning'); }
};

window.previewTeacherLmsText = function (materialId) {
    const mat = currentLmsMaterials.find(m => m.id === materialId);
    if (!mat) return;
    if(mat.resource_type==='html'&&window.lmsModuleWorkspace?.previewHtml){
        try{return window.lmsModuleWorkspace.previewHtml({code:mat.content_description||'',title:mat.title||'Materi HTML interaktif',instructions:mat.instructions||mat.html_instructions||''});}
        catch(error){showToast('Preview HTML Gagal',error.message,'warning');return;}
    }
    const modal = document.getElementById('modal-lms-text-preview');
    const titleEl = document.getElementById('lms-preview-title');
    const bodyEl = document.getElementById('lms-preview-body');
    if (titleEl) titleEl.textContent = mat.title || 'Pratinjau Materi';
    if (bodyEl) {
        const raw = mat.content_description || '';
        if (mat.resource_type === 'html') {
            try { mountLmsHtml(bodyEl, raw, mat.title, mat.html_instructions || ''); }
            catch (error) { showToast('Preview HTML Gagal', error.message, 'warning'); return; }
        } else bodyEl.innerHTML = raw.trim() ? renderSafeMarkdown(raw) : '<p class="text-xs text-slate-400 italic">Belum ada konten teks modul.</p>';
    }
    if (modal) modal.classList.remove('hidden');
};

window.closeLmsTextPreviewModal = function () {
    const modal = document.getElementById('modal-lms-text-preview');
    if (modal) modal.classList.add('hidden');
    document.getElementById('lms-preview-body')?.replaceChildren();
};

let lmsReorderSaving = false;

window.quickMoveLmsTopic = async function (topicId, direction) {
    if (lmsReorderSaving) return;
    const idx = currentLmsTopics.findIndex(t => t.id === topicId);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= currentLmsTopics.length) return;

    const temp = currentLmsTopics[idx];
    currentLmsTopics[idx] = currentLmsTopics[targetIdx];
    currentLmsTopics[targetIdx] = temp;

    currentLmsTopics.forEach((t, i) => {
        t.order_index = i + 1;
    });

    renderLmsMaterialsList();

    const items = currentLmsTopics.map(t => ({ id: t.id, order_index: t.order_index }));
    try {
        lmsReorderSaving = true;
        await cfReorderLmsItems({ type: 'topics', items });
        showToast('Urutan Disimpan', 'Urutan topik berhasil diperbarui.', 'success');
    } catch (err) {
        console.error('[Reorder Topic Error]:', err);
        showToast('Gagal Mengurutkan', err.message || 'Gagal memperbarui urutan topik.', 'error');
        await window.loadLmsData(true);
    } finally {
        lmsReorderSaving = false;
    }
};

window.quickMoveLmsMaterial = async function (materialId, direction) {
    if (lmsReorderSaving) return;
    const mat = currentLmsMaterials.find(m => m.id === materialId);
    if (!mat) return;
    const topicId = mat.topic_id;
    const topicMats = currentLmsMaterials.filter(m => m.topic_id === topicId);
    const idx = topicMats.findIndex(m => m.id === materialId);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= topicMats.length) return;

    const temp = topicMats[idx];
    topicMats[idx] = topicMats[targetIdx];
    topicMats[targetIdx] = temp;

    topicMats.forEach((m, i) => {
        m.order_index = i + 1;
    });

    topicMats.forEach(updated => {
        const globalIdx = currentLmsMaterials.findIndex(m => m.id === updated.id);
        if (globalIdx >= 0) currentLmsMaterials[globalIdx].order_index = updated.order_index;
    });

    currentLmsMaterials.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    renderLmsMaterialsList();

    const items = topicMats.map(m => ({ id: m.id, order_index: m.order_index }));
    try {
        lmsReorderSaving = true;
        await cfReorderLmsItems({ type: 'materials', items });
        showToast('Urutan Disimpan', 'Urutan materi berhasil diperbarui.', 'success');
    } catch (err) {
        console.error('[Reorder Material Error]:', err);
        showToast('Gagal Mengurutkan', err.message || 'Gagal memperbarui urutan materi.', 'error');
        await window.loadLmsData(true);
    } finally {
        lmsReorderSaving = false;
    }
};

let reorderActiveTab = 'topics';
let reorderWorkingTopics = [];
let reorderWorkingMaterials = [];
let reorderTopicsChanged = false;
let reorderChangedTopicIds = new Set();

window.openLmsReorderModal = function () {
    if (lmsReorderSaving) return;
    reorderTopicsChanged = false;
    reorderChangedTopicIds.clear();
    const mapel = document.getElementById('select-mapel')?.value || '';
    const kelas = document.getElementById('select-kelas')?.value || '';

    if (!mapel || !kelas) {
        showToast('Pilih Kelas & Mapel', 'Silakan pilih Mata Pelajaran dan Rombel Kelas terlebih dahulu.', 'warning');
        return;
    }

    if (!currentLmsTopics || currentLmsTopics.length === 0) {
        showToast('Belum Ada Topik', 'Buat minimal satu topik untuk dapat menyusun urutan.', 'info');
        return;
    }

    const modal = document.getElementById('modal-lms-reorder');
    const scopeLabel = document.getElementById('lms-reorder-scope-label');
    if (scopeLabel) scopeLabel.textContent = `Mapel: ${mapel} | Kelas: ${kelas}`;

    reorderWorkingTopics = JSON.parse(JSON.stringify(currentLmsTopics)).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
    reorderWorkingMaterials = JSON.parse(JSON.stringify(window.lmsModuleWorkspace ? currentLmsModules : currentLmsMaterials)).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    const selectFilter = document.getElementById('select-reorder-topic-filter');
    if (selectFilter) {
        selectFilter.innerHTML = reorderWorkingTopics.map(t => `<option value="${t.id}">${escapeHTML(t.title)}</option>`).join('');
    }

    window.switchReorderTab('topics');
    if (modal) modal.classList.remove('hidden');
};

window.closeLmsReorderModal = function () {
    if (lmsReorderSaving) return;
    const modal = document.getElementById('modal-lms-reorder');
    if (modal) modal.classList.add('hidden');
};

window.switchReorderTab = function (tab) {
    reorderActiveTab = tab;
    const btnTopics = document.getElementById('btn-reorder-tab-topics');
    const btnMaterials = document.getElementById('btn-reorder-tab-materials');
    const topicFilterContainer = document.getElementById('container-reorder-topic-filter');

    if (tab === 'topics') {
        if (btnTopics) btnTopics.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold transition bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-2xs flex items-center justify-center gap-1.5';
        if (btnMaterials) btnMaterials.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold transition text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center justify-center gap-1.5';
        if (topicFilterContainer) topicFilterContainer.classList.add('hidden');
    } else {
        if (btnMaterials) btnMaterials.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold transition bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-2xs flex items-center justify-center gap-1.5';
        if (btnTopics) btnTopics.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold transition text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center justify-center gap-1.5';
        if (topicFilterContainer) topicFilterContainer.classList.remove('hidden');
    }

    window.renderLmsReorderItems();
};

window.onReorderTopicFilterChange = function () {
    window.renderLmsReorderItems();
};

window.renderLmsReorderItems = function () {
    const container = document.getElementById('lms-reorder-items-container');
    if (!container) return;

    let items = [];
    if (reorderActiveTab === 'topics') {
        items = reorderWorkingTopics;
    } else {
        const selectedTopicId = document.getElementById('select-reorder-topic-filter')?.value || (reorderWorkingTopics[0]?.id || '');
        items = reorderWorkingMaterials.filter(m => m.topic_id === selectedTopicId).sort((a, b) => a.order_index - b.order_index);
    }

    if (items.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-slate-400 text-xs italic bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                Tidak ada item yang dapat diurutkan pada tampilan ini.
            </div>
        `;
        return;
    }

    let html = '';
    items.forEach((item, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === items.length - 1;
        const title = item.title || 'Tanpa Judul';

        html += `
            <div class="flex items-center justify-between p-2.5 bg-white dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs">
                <div class="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                    <span class="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-black flex items-center justify-center shrink-0 border border-slate-200 dark:border-slate-600">
                        ${idx + 1}
                    </span>
                    <span class="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                        ${escapeHTML(title)}
                    </span>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    <button type="button" onclick="window.moveReorderItem('${item.id}', 'up')" ${isFirst ? 'disabled' : ''}
                        class="p-1 px-2 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 disabled:opacity-25 disabled:pointer-events-none transition text-xs font-bold"
                        title="Geser Naik">
                        <i class="fa-solid fa-arrow-up"></i>
                    </button>
                    <button type="button" onclick="window.moveReorderItem('${item.id}', 'down')" ${isLast ? 'disabled' : ''}
                        class="p-1 px-2 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 disabled:opacity-25 disabled:pointer-events-none transition text-xs font-bold"
                        title="Geser Turun">
                        <i class="fa-solid fa-arrow-down"></i>
                    </button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
};

window.moveReorderItem = function (id, direction) {
    if (lmsReorderSaving) return;
    if (reorderActiveTab === 'topics') {
        const idx = reorderWorkingTopics.findIndex(t => t.id === id);
        if (idx < 0) return;
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= reorderWorkingTopics.length) return;

        const temp = reorderWorkingTopics[idx];
        reorderWorkingTopics[idx] = reorderWorkingTopics[targetIdx];
        reorderWorkingTopics[targetIdx] = temp;

        reorderWorkingTopics.forEach((t, i) => {
            t.order_index = i + 1;
        });
        reorderTopicsChanged = true;
    } else {
        const selectedTopicId = document.getElementById('select-reorder-topic-filter')?.value;
        const topicItems = reorderWorkingMaterials.filter(m => m.topic_id === selectedTopicId).sort((a, b) => a.order_index - b.order_index);
        const idx = topicItems.findIndex(m => m.id === id);
        if (idx < 0) return;
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= topicItems.length) return;

        const temp = topicItems[idx];
        topicItems[idx] = topicItems[targetIdx];
        topicItems[targetIdx] = temp;

        topicItems.forEach((m, i) => {
            m.order_index = i + 1;
            const gIdx = reorderWorkingMaterials.findIndex(item => item.id === m.id);
            if (gIdx >= 0) reorderWorkingMaterials[gIdx].order_index = m.order_index;
        });
        reorderChangedTopicIds.add(selectedTopicId);
    }

    window.renderLmsReorderItems();
};

window.saveLmsReorderChanges = async function () {
    if (lmsReorderSaving) return;
    const btnSave = document.getElementById('btn-save-lms-reorder');
    if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Menyimpan...</span>';
    }

    try {
        const groups = [];
        const toItem = item => ({ id: item.id, order_index: item.order_index });
        if (reorderTopicsChanged) groups.push({ type: 'topics', items: reorderWorkingTopics.map(toItem) });
        for (const topicId of reorderChangedTopicIds) {
            groups.push({ type: window.lmsModuleWorkspace ? 'modules' : 'materials', items: reorderWorkingMaterials.filter(m => m.topic_id === topicId).map(toItem) });
        }
        lmsReorderSaving = true;
        if (groups.length) await cfReorderLmsItems({ groups });
        currentLmsTopics = structuredClone(reorderWorkingTopics);
        if (window.lmsModuleWorkspace) await window.loadLmsData(true);
        else currentLmsMaterials = structuredClone(reorderWorkingMaterials).sort((a, b) => a.order_index - b.order_index);
        lmsReorderSaving = false;
        renderLmsMaterialsList();
        window.closeLmsReorderModal();
        showToast('Susunan Tersimpan', 'Urutan berhasil disimpan dan diterapkan.', 'success');
    } catch (err) {
        console.error('[Save Reorder Error]:', err);
        showToast('Gagal Menyimpan', err.message || 'Terjadi kesalahan saat menyimpan susunan.', 'error');
    } finally {
        lmsReorderSaving = false;
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = '<i class="fa-solid fa-check"></i> <span>Simpan Susunan</span>';
        }
    }
};

window.openLmsProgressModal = async function (materialId) {
    const modal = document.getElementById('modal-lms-progress');
    const titleEl = document.getElementById('lms-progress-material-title');
    const classBadge = document.getElementById('lms-progress-class-badge');
    const statTotal = document.getElementById('lms-prog-total-count');
    const statDone = document.getElementById('lms-prog-completed-count');
    const statOpened = document.getElementById('lms-prog-opened-count');
    const statNot = document.getElementById('lms-prog-not-started-count');
    const statLate = document.getElementById('lms-progress-late-count');
    const searchInput = document.getElementById('input-search-lms-progress');
    const tbody = document.getElementById('tbody-lms-progress-students');

    if (searchInput) searchInput.value = '';
    if (statLate) statLate.classList.add('hidden');

    const mat = currentLmsMaterials.find(m => m.id === materialId);
    currentLmsProgressMaterial = mat;

    if (mat) {
        if (titleEl) titleEl.textContent = mat.title;
        if (classBadge) classBadge.textContent = mat.class_name;
    }

    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat progres belajar siswa...</td></tr>';
    }
    if (modal) modal.classList.remove('hidden');

    try {
        const res = await cfGetLmsMaterialProgress(materialId);
        const summary = res.summary || {};
        const students = res.data || [];
        currentLmsProgressData = students;
        if (res.material) {
            currentLmsProgressMaterial = { ...mat, ...res.material };
            if (titleEl) titleEl.textContent = res.material.title;
            if (classBadge) classBadge.textContent = res.material.class_name;
        }
        if (statLate) {
            statLate.textContent = `Terlambat: ${summary.late_count || 0}`;
            statLate.classList.toggle('hidden', !summary.late_count);
        }

        if (statTotal) statTotal.textContent = summary.total_students || 0;
        if (statDone) statDone.textContent = summary.completed_count || 0;
        if (statOpened) statOpened.textContent = summary.opened_count || 0;
        if (statNot) statNot.textContent = summary.not_started_count || 0;

        renderLmsProgressTable(students);
        const btnSendGradebook = document.getElementById('btn-lms-progress-to-gradebook');
        if (btnSendGradebook) {
            const hasQuiz = (Number(currentLmsProgressMaterial?.quiz_enabled) === 1 || currentLmsProgressMaterial?.resource_type === 'quiz' || lmsHasQuiz(currentLmsProgressMaterial));
            btnSendGradebook.classList.toggle('hidden', !hasQuiz);
        }
    } catch (err) {
        console.error('[LMS Progress] Error fetching progress:', err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-rose-500 font-bold">Gagal memuat: ${escapeHTML(err.message)}</td></tr>`;
        }
    }
};

function formatLmsTimestampWITA(dateStr) {
    if (!dateStr) return '<span class="text-slate-400">-</span>';
    try {
        let str = String(dateStr).trim();
        if (!str) return '<span class="text-slate-400">-</span>';
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(str)) {
            str = str.replace(' ', 'T') + 'Z';
        } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(str)) {
            str = str + 'Z';
        }
        const d = new Date(str);
        if (isNaN(d.getTime())) return escapeHTML(dateStr);

        const datePart = new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Makassar',
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        }).format(d);

        const timePart = new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Makassar',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).format(d).replace('.', ':');

        return `
            <div class="flex flex-col items-center leading-tight">
                <span class="text-[11px] font-medium text-slate-700 dark:text-slate-200">${escapeHTML(datePart)}</span>
                <span class="text-[10px] text-slate-400 font-mono">${escapeHTML(timePart)} WITA</span>
            </div>
        `;
    } catch {
        return escapeHTML(String(dateStr));
    }
}

function formatLmsActiveSeconds(totalSeconds) {
    const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    if (sec === 0) return '0 dtk';
    if (sec < 60) return `${sec} dtk`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    if (min < 60) {
        return remSec > 0 ? `${min} mnt ${remSec} dtk` : `${min} mnt`;
    }
    const hours = Math.floor(min / 60);
    const remMin = min % 60;
    return remMin > 0 ? `${hours} jam ${remMin} mnt` : `${hours} jam`;
}

function renderLmsProgressTable(students) {
    const tbody = document.getElementById('tbody-lms-progress-students');
    if (!tbody) return;

    if (students.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-slate-400">Tidak ada data siswa ditemukan.</td></tr>';
        return;
    }

    let passingGrade = 75;
    try {
        if (currentLmsProgressMaterial?.quiz_payload) {
            const parsed = JSON.parse(currentLmsProgressMaterial.quiz_payload);
            if (parsed.passing_grade !== undefined) passingGrade = Number(parsed.passing_grade);
        }
    } catch (_) {}

    let html = '';
    students.forEach((s, idx) => {
        let statusBadge = '<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 text-[10px] font-bold">Belum Membuka</span>';
        let actionBtn = `<button onclick="window.overrideStudentProgress('${escapeHTML(s.nis)}', 'complete')" class="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800 rounded-md text-[10px] font-bold transition flex items-center gap-1 mx-auto active:scale-95 shadow-2xs" title="Verifikasi ketuntasan belajar siswa ini secara manual"><i class="fa-solid fa-check-double text-[9px]"></i><span>Verifikasi</span></button>`;

        const activeSec = Number(s.active_seconds_total) || 0;
        const sessionCount = Number(s.session_count) || 0;

        let durBadge = '';
        if (s.status === 'completed' && activeSec < 60 && s.first_opened_at) {
            durBadge = `<span class="inline-flex items-center gap-1 text-[9px] font-black text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-700 mt-0.5" title="Durasi aktif: ${activeSec} detik"><i class="fa-solid fa-bolt text-amber-500 text-[8px]"></i> &lt; 1 mnt (Kilat)</span>`;
        }

        let durasiColHtml = '<span class="text-slate-400">-</span>';
        if (s.first_opened_at || activeSec > 0) {
            const formattedDur = formatLmsActiveSeconds(activeSec);
            const sessionTitle = sessionCount > 0 ? `${sessionCount} sesi` : '1 sesi';
            durasiColHtml = `
                <div class="flex flex-col items-center gap-0.5" title="Total waktu aktif: ${formattedDur} (${sessionTitle})">
                    <span class="text-[11px] font-semibold text-slate-700 dark:text-slate-200">${formattedDur}</span>
                    ${durBadge}
                </div>
            `;
        }

        let quizMeta = {};
        try { quizMeta = JSON.parse(s.quiz_answers || '{}'); } catch (_) {}
        let quizScoreColHtml = '<span class="text-slate-400">-</span>';
        if (s.quiz_score !== null && s.quiz_score !== undefined) {
            const scoreNum = Number(s.quiz_score);
            const isPassed = scoreNum >= Number(quizMeta.passing_grade ?? passingGrade);
            quizScoreColHtml = `
                <div class="flex flex-col items-center gap-0.5">
                    <span class="px-2 py-0.5 rounded-md text-[11px] font-black ${isPassed ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'}">
                        ${scoreNum} / 100
                    </span>
                    <span class="text-[9px] font-semibold ${isPassed ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}">${isPassed ? 'Lulus KKM' : 'Remidial'}</span>
                </div>
            `;
        }

        let completedColHtml = '<span class="text-slate-400">-</span>';

        if (s.status === 'completed') {
            statusBadge = '<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 text-[10px] font-extrabold flex items-center gap-1 w-fit mx-auto"><i class="fa-solid fa-check"></i> Selesai</span>';
            actionBtn = `<button onclick="window.overrideStudentProgress('${escapeHTML(s.nis)}', 'reset')" class="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-800 rounded-md text-[10px] font-bold transition flex items-center gap-1 mx-auto active:scale-95 shadow-2xs" title="Reset status belajar siswa ini ke Belum Buka agar mempelajari ulang"><i class="fa-solid fa-rotate-left text-[9px]"></i><span>Reset</span></button>`;
            completedColHtml = s.completed_at ? formatLmsTimestampWITA(s.completed_at) : '<span class="text-slate-400">-</span>';
        } else if (s.status === 'opened') {
            statusBadge = '<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 text-[10px] font-bold w-fit mx-auto">Sedang Membaca</span>';
        }

        if ((Number(currentLmsProgressMaterial?.quiz_enabled ?? (currentLmsProgressMaterial?.resource_type === 'quiz' ? 1 : 0)) === 1)) {
            if (quizMeta.status === 'pending_review') {
                quizScoreColHtml = '<span class="text-amber-700 dark:text-amber-300 text-xs font-bold">Menunggu diperiksa</span>';
                statusBadge = '<span class="text-amber-700 dark:text-amber-300 text-xs">Jawaban terkumpul</span>';
            }
            actionBtn = '<button type="button" data-quiz-review-nis="' + escapeHTML(s.nis) + '" class="px-3 py-2 rounded-lg bg-purple-600 text-white text-xs font-bold">Periksa jawaban</button>';
        }

        if (s.is_late) statusBadge += '<span class="block mt-1 text-[10px] font-bold text-amber-700 dark:text-amber-300" title="Aktivitas susulan setelah selesai dibahas; tanpa potongan nilai otomatis">Terlambat</span>';

        const sPhotoUrl = s.active_photo_url ? (typeof window.resolvePhotoUrl === 'function' ? window.resolvePhotoUrl(s.active_photo_url) : s.active_photo_url) : '';
        const sInitial = (s.name || 'S').charAt(0).toUpperCase();
        const sAvatarHtml = sPhotoUrl
            ? `<div class="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] shrink-0 overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700 shadow-2xs"><img src="${sPhotoUrl}" alt="${escapeHTML(s.name)}" class="w-full h-full object-cover" onerror="this.onerror=null; this.parentElement.classList.add('bg-blue-600','text-white','font-bold'); this.parentElement.innerHTML='${sInitial}';" /></div>`
            : `<div class="w-6 h-6 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold shrink-0 shadow-2xs">${sInitial}</div>`;

        html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td class="py-2 px-2 text-center font-bold text-slate-400">${idx + 1}</td>
                <td class="py-2 px-3 font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300">${escapeHTML(s.nis)}</td>
                <td class="py-2 px-3 font-bold text-slate-800 dark:text-slate-100">
                    <div class="flex items-center gap-2">
                        ${sAvatarHtml}
                        <span class="truncate max-w-[180px] sm:max-w-xs" title="${escapeHTML(s.name)}">${escapeHTML(s.name)}</span>
                    </div>
                </td>
                <td class="py-2 px-3 text-center">${statusBadge}</td>
                <td class="py-2 px-3 text-center">${formatLmsTimestampWITA(s.first_opened_at)}</td>
                <td class="py-2 px-3 text-center">${durasiColHtml}</td>
                <td class="py-2 px-3 text-center">${quizScoreColHtml}</td>
                <td class="py-2 px-3 text-center">${completedColHtml}</td>
                <td class="py-2 px-3 text-center">${actionBtn}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    tbody.querySelectorAll('[data-quiz-review-nis]').forEach(button => {
        button.onclick = () => window.openLmsQuizReview(currentLmsProgressMaterial.id, button.dataset.quizReviewNis);
    });
}

window.filterLmsProgressStudents = function () {
    const q = (document.getElementById('input-search-lms-progress')?.value || '').toLowerCase().trim();
    if (!q) {
        renderLmsProgressTable(currentLmsProgressData);
        return;
    }

    const filtered = currentLmsProgressData.filter(s =>
        (s.name || '').toLowerCase().includes(q) ||
        String(s.nis || '').includes(q) ||
        (s.status || '').toLowerCase().includes(q)
    );

    renderLmsProgressTable(filtered);
};

function buildLmsWaMaterialInstructions(material) {
    const instructions = getLmsMaterialInstructions(material).replace(/\s+/g, ' ');
    if (!instructions) return material?.resource_type === 'html'
        ? '📝 *Petunjuk Guru:* Buka materi HTML interaktif di LMS dan ikuti arahan guru hingga tuntas.\n' : '';
    return `📝 *Petunjuk Guru:* ${instructions.slice(0, 120)}${instructions.length > 120 ? '…' : ''}\n`;
}

function buildLmsWaAccessInstructions() {
    return `🌐 *Cara Login & Mengakses Modul:*\n`
        + `1. Buka Portal Siswa SIMAS: https://simas-demo-5ead3.web.app\n`
        + `2. Isi kolom *Identitas Pengguna* dengan *NIS 4 digit* milik masing-masing siswa (contoh: 1234).\n`
        + `3. Pada bagian *Tanggal Lahir*, pilih *tanggal, bulan, dan tahun lahir* sesuai data siswa yang terdaftar di sekolah.\n`
        + `4. Klik tombol *Masuk Aplikasi* untuk masuk ke Portal Siswa.\n`
        + `5. Pilih menu *LMS* / *LMS Modul*, lalu buka mata pelajaran yang tercantum dalam pesan ini.\n`
        + `6. Buka modul yang disebutkan di atas dan ikuti urutan belajar: pelajari materi, tanggapi diskusi jika diwajibkan, dan kerjakan kuis jika tersedia.\n`
        + `7. Pastikan seluruh kegiatan pada modul sudah dituntaskan sebelum batas waktu yang ditentukan.\n\n`
        + `ℹ️ Guru dapat memantau aktivitas, progres, dan durasi belajar aktif di LMS. Pelajari materi serta kerjakan petunjuk/tugas hingga tuntas; membuka lalu menutup LMS belum berarti pembelajaran selesai.\n`;
}

window.copyLmsProgressReminderToWa = function () {
    if (!currentLmsProgressMaterial || currentLmsProgressData.length === 0) {
        showToast('Data Kosong', 'Data progres siswa belum tersedia.', 'warning');
        return;
    }

    const mapel = document.getElementById('select-mapel')?.value || '';
    const kelas = currentLmsProgressMaterial.class_name || document.getElementById('select-kelas')?.value || '';
    const uncompleted = currentLmsProgressData.filter(s => s.status !== 'completed');

    let text = `📢 *PENGINGAT PENYELESAIAN MODUL LMS*\n`;
    text += `📖 Mata Pelajaran: *${mapel}*\n`;
    text += `🏫 Kelas: *${kelas}*\n`;
    text += `📚 Modul: *${currentLmsProgressMaterial.title}*\n`;
    if (currentLmsProgressMaterial.publish_at) text += `🕒 Dibuka: *${formatLmsScheduleTime(currentLmsProgressMaterial.publish_at)}*\n`;
    if (currentLmsProgressMaterial.due_date) {
        text += `🎯 Batas Target: *${formatLmsScheduleTime(currentLmsProgressMaterial.due_date)}*\n`;
    }
    text += buildLmsWaMaterialInstructions(currentLmsProgressMaterial);
    text += `\n`;

    if (uncompleted.length === 0) {
        text += `🎉 *SELAMAT!* Seluruh siswa kelas ${kelas} (${currentLmsProgressData.length} siswa) telah menyelesaikan modul ini. Terima kasih atas kerja kerasnya! 👍\n`;
    } else {
        text += `Daftar siswa yang *BELUM SELESAI* (${uncompleted.length} siswa):\n`;
        uncompleted.forEach((s, idx) => {
            const statusLabel = s.status === 'opened' ? 'Sedang Membaca' : 'Belum Membuka';
            text += `${idx + 1}. *${s.name}* (NIS: ${s.nis}) - _${statusLabel}_\n`;
        });
        text += `\nMohon siswa yang bersangkutan segera mengakses dan menuntaskan modul dengan langkah berikut:\n\n`;
        text += buildLmsWaAccessInstructions();
        text += `\nTerima kasih! 🙏\n`;
    }

    navigator.clipboard.writeText(text).then(() => {
        showModernAlert('Berhasil Disalin!', 'Pesan pengingat penyelesaian modul telah disalin ke clipboard. Tinggal tempel (paste) ke grup WhatsApp kelas.', 'success');
    }).catch(() => {
        showToast('Error', 'Gagal menyalin pesan ke clipboard.', 'error');
    });
};

window.closeLmsProgressModal = function () {
    const modal = document.getElementById('modal-lms-progress');
    if (modal) modal.classList.add('hidden');
    const btnSendGradebook = document.getElementById('btn-lms-progress-to-gradebook');
    if (btnSendGradebook) btnSendGradebook.classList.add('hidden');
};

window.openLmsClassWaReminderModal = function () {
    const modal = document.getElementById('modal-lms-class-wa');
    const selectMaterial = document.getElementById('select-lms-wa-target-material');
    if (!modal) return;

    if (selectMaterial) {
        let opts = '<option value="all">-- Semua Modul Aktif & Mendekati Tenggat --</option>';
        const sources = typeof currentLmsModules !== 'undefined' && currentLmsModules.length ? currentLmsModules.filter(m=>Number(m.is_visible)===1) : currentLmsMaterials || [];
        sources.forEach(m => {
            const dueInfo = m.due_date ? ` (Tenggat: ${formatLmsScheduleTime(m.due_date)})` : '';
            opts += `<option value="${m.id}">${escapeHTML(m.title)}${dueInfo}</option>`;
        });
        selectMaterial.innerHTML = opts;
    }

    window.generateLmsClassWaMessage();
    modal.classList.remove('hidden');
};

window.closeLmsClassWaReminderModal = function () {
    const modal = document.getElementById('modal-lms-class-wa');
    if (modal) modal.classList.add('hidden');
};

window.generateLmsClassWaMessage = function () {
    const targetVal = document.getElementById('select-lms-wa-target-material')?.value || 'all';
    const previewEl = document.getElementById('textarea-lms-wa-preview');
    if (!previewEl) return;

    const mapel = document.getElementById('select-mapel')?.value || 'Mata Pelajaran';
    const kelas = document.getElementById('select-kelas')?.value || 'Kelas';

    if (typeof currentLmsModules !== 'undefined' && currentLmsModules.length) {
        const modules=currentLmsModules.filter(m=>Number(m.is_visible)===1 && (targetVal==='all'||m.id===targetVal));
        const lines=[`📢 *PENGINGAT MODUL LMS*`, `📖 Mata Pelajaran: *${mapel}*`, `🏫 Kelas: *${kelas}*`, '', 'Ikuti Topik/Bab → Modul → Bahan Ajar secara berurutan.'];
        for(const [i,m] of modules.entries()){
            lines.push('',`${i+1}. *${m.title}*`,`Buka: ${formatLmsScheduleTime(m.publish_at)}`,`Target: ${formatLmsScheduleTime(m.due_date)}`);
            for(const [j,p] of m.packets.entries()){
                const parts=[...(Number(p.material_enabled)===1?['Materi']:[]),...(Number(p.quiz_enabled)===1?['Kuis Formatif']:[]),...(Number(p.allow_discussion)===1?['Forum Diskusi']:[])];
                lines.push(`   Bahan Ajar ${j+1}: ${p.title} (${parts.join(' · ')})`);
                if(p.instructions||Number(p.material_enabled)===1)lines.push(buildLmsWaMaterialInstructions(p).trim());
            }
        }
        if(!modules.length)lines.push('Belum ada Modul yang ditampilkan ke siswa.');
        lines.push('',buildLmsWaAccessInstructions(),'Tuntaskan seluruh bagian aktif hingga tercentang untuk membuka Bahan Ajar dan Modul berikutnya.');
        previewEl.value=lines.filter(line=>line!==undefined).join('\n');return;
    }
    let msg = `📢 *PENGINGAT PEMBELAJARAN & MODUL LMS*\n`;
    msg += `📖 Mata Pelajaran: *${mapel}*\n`;
    msg += `🏫 Kelas: *${kelas}*\n\n`;

    if (targetVal === 'all') {
        msg += `Halo anak-anak kelas *${kelas}*, mohon lanjutkan alur belajar di Portal SIMAS sesuai urutan yang tersedia.\n\n`;
        msg += `📚 *Daftar Modul Pembelajaran Aktif:*\n`;
        if (!currentLmsMaterials || currentLmsMaterials.length === 0) {
            msg += `- Belum ada materi yang dipublikasikan.\n`;
        } else {
            currentLmsMaterials.slice(0, 8).forEach((m, idx) => {
                const dueText = m.due_date ? ` [Buka: ${formatLmsScheduleTime(m.publish_at)} | Tutup: ${formatLmsScheduleTime(m.due_date)}]` : '';
                msg += `${idx + 1}. *${m.title}*${dueText}\n`;
                msg += buildLmsWaMaterialInstructions(m);
            });
            if (currentLmsMaterials.length > 8) {
                msg += `...dan ${currentLmsMaterials.length - 8} modul lainnya.\n`;
            }
        }
    } else {
        const mat = (currentLmsMaterials || []).find(m => m.id === targetVal);
        if (mat) {
            msg += `Halo anak-anak kelas *${kelas}*, mohon segera mempelajari modul berikut:\n\n`;
            msg += `📌 *${mat.title}*\n`;
            if (mat.publish_at) msg += `🕒 *Dibuka:* ${formatLmsScheduleTime(mat.publish_at)}\n`;
            if (mat.due_date) {
                msg += `🎯 *Batas Target Pengerjaan:* ${formatLmsScheduleTime(mat.due_date)}\n`;
            }
            msg += buildLmsWaMaterialInstructions(mat);
        }
    }

    msg += `\n${buildLmsWaAccessInstructions()}\n`;
    msg += `Mari tuntaskan pembelajaran tepat waktu demi hasil belajar yang optimal. Terima kasih! 🙏✨`;

    previewEl.value = msg;
};

window.copyLmsClassWaText = function () {
    const previewEl = document.getElementById('textarea-lms-wa-preview');
    if (!previewEl || !previewEl.value.trim()) {
        showToast('Teks Kosong', 'Tidak ada pesan yang dapat disalin.', 'warning');
        return;
    }

    navigator.clipboard.writeText(previewEl.value).then(() => {
        showModernAlert('Berhasil Disalin!', 'Pesan pengingat kelas telah disalin ke clipboard. Silakan tempel (paste) ke grup WhatsApp kelas.', 'success');
    }).catch(() => {
        showToast('Error', 'Gagal menyalin pesan ke clipboard.', 'error');
    });
};

window.sendLmsClassWaDirect = function () {
    const previewEl = document.getElementById('textarea-lms-wa-preview');
    if (!previewEl || !previewEl.value.trim()) {
        showToast('Teks Kosong', 'Tidak ada pesan yang dapat dikirim.', 'warning');
        return;
    }

    const encoded = encodeURIComponent(previewEl.value);
    window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
};

window.overrideStudentProgress = async function (studentNis, action, targetMaterialId = null) {
    const mat = (targetMaterialId && (currentLmsMaterials || []).find(m => String(m.id) === String(targetMaterialId)))
        || currentLmsProgressMaterial
        || (currentLmsAnalytics?.material_id && (currentLmsMaterials || []).find(m => String(m.id) === String(currentLmsAnalytics.material_id)));

    if (!mat || !studentNis || !action) return;
    if (lmsHasQuiz(mat)) return window.openLmsQuizReview(mat.id, studentNis);

    let studentName = studentNis;
    if (currentLmsProgressData && Array.isArray(currentLmsProgressData)) {
        const found = currentLmsProgressData.find(s => String(s.nis).trim() === String(studentNis).trim());
        if (found?.name) studentName = found.name;
    }
    if (studentName === studentNis && currentLmsAnalytics?.data) {
        const found = currentLmsAnalytics.data.find(s => String(s.nis).trim() === String(studentNis).trim());
        if (found?.name) studentName = found.name;
    }

    const title = action === 'reset' ? 'Reset Progres Siswa' : 'Verifikasi Ketuntasan';
    const confirmMsg = action === 'reset'
        ? `Reset progres belajar untuk siswa <b>${escapeHTML(studentName)}</b> (${escapeHTML(studentNis)})?<br><br><span style="font-size:0.85rem;color:#64748b;display:block;line-height:1.5;">Siswa akan kembali ke status <b>"Belum Membuka"</b> dan wajib membuka serta mempelajari ulang materi ini.</span>`
        : `Verifikasi ketuntasan belajar secara manual untuk siswa <b>${escapeHTML(studentName)}</b> (${escapeHTML(studentNis)})?<br><br><span style="font-size:0.85rem;color:#64748b;display:block;line-height:1.5;">Status progres belajar siswa akan langsung diubah menjadi <b>"Selesai"</b>.</span>`;

    const confirmed = typeof window.showConfirmModal === 'function'
        ? await window.showConfirmModal(
            confirmMsg,
            title,
            action === 'reset' ? 'danger' : 'info',
            {
                confirmText: action === 'reset' ? 'Ya, Reset' : 'Ya, Verifikasi',
                icon: action === 'reset' ? 'fa-rotate-left' : 'fa-circle-check'
            }
        )
        : confirm(confirmMsg.replace(/<[^>]*>?/gm, ''));

    if (!confirmed) return;

    try {
        const res = await cfOverrideLmsStudentProgress({
            material_id: mat.id,
            student_nis: studentNis,
            action
        });

        showToast('Berhasil', res.message || 'Status progres siswa berhasil diperbarui.', 'success');

        if (currentLmsProgressMaterial && currentLmsProgressMaterial.id === mat.id) {
            await window.refreshLmsMaterialProgress(mat.id);
        }
        lmsAnalyticsCache.clear();
        if (currentLmsSubView === 'analytics') {
            await window.changeLmsAnalyticsScope('refresh');
        }
    } catch (err) {
        console.error('[LMS Progress Override Error]:', err);
        showToast('Gagal Memperbarui', err.message || 'Gagal mengubah status progres siswa.', 'error');
    }
};

window.refreshLmsMaterialProgress = async function (materialId) {
    if (!materialId) return;
    const statTotal = document.getElementById('lms-prog-total-count');
    const statDone = document.getElementById('lms-prog-completed-count');
    const statOpened = document.getElementById('lms-prog-opened-count');
    const statNot = document.getElementById('lms-prog-not-started-count');

    try {
        const res = await cfGetLmsMaterialProgress(materialId);
        const summary = res.summary || {};
        const students = res.data || [];
        currentLmsProgressData = students;

        if (statTotal) statTotal.textContent = summary.total_students || 0;
        if (statDone) statDone.textContent = summary.completed_count || 0;
        if (statOpened) statOpened.textContent = summary.opened_count || 0;
        if (statNot) statNot.textContent = summary.not_started_count || 0;

        window.filterLmsProgressStudents();
    } catch (err) {
        console.error('[LMS Progress Refresh Error]:', err);
    }
};

let currentActiveDiscussionMaterialPrompt = '';
let currentActiveDiscussionTeacherName = '';
let discussionModalKeydownHandler = null;

window.openLmsDiscussionModal = async function (materialId) {
    currentActiveDiscussionMaterialId = materialId;
    currentReplyingToComment = null;
    window.cancelLmsReply();

    const modal = document.getElementById('modal-lms-discussion');
    installLmsDiscussionLayout(modal);
    const discussionBody = modal?.querySelector('.lms-discussion-body');
    if (discussionBody) discussionBody.scrollTop = 0;
    const titleEl = document.getElementById('lms-discussion-material-title');
    const countBadge = document.getElementById('lms-discussion-count-badge');
    const listEl = document.getElementById('lms-discussion-comments-list');

    const mat = currentLmsMaterials.find(m => m.id === materialId);
    if (mat && titleEl) {
        titleEl.textContent = mat.title;
    }

    currentActiveDiscussionMaterialPrompt = mat?.discussion_prompt || '';
    currentActiveDiscussionTeacherName = mat?.teacher_name || 'Guru Mapel';

    renderLmsDiscussionPromptCard(currentActiveDiscussionMaterialPrompt, currentActiveDiscussionTeacherName);

    if (listEl) {
        listEl.innerHTML = '<div class="text-center py-10 text-slate-400 text-xs"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat ruang diskusi...</div>';
    }
    if (modal) modal.classList.remove('hidden');

    if (!discussionModalKeydownHandler) {
        discussionModalKeydownHandler = (e) => {
            if (e.key === 'Escape') {
                window.closeLmsDiscussionModal();
            }
        };
        document.addEventListener('keydown', discussionModalKeydownHandler);
    }

    try {
        const res = await cfGetLmsDiscussions(materialId);
        if (currentActiveDiscussionMaterialId !== materialId) return;
        const comments = res.data || [];
        if (countBadge) countBadge.textContent = `${res.total_comments || 0} Tanggapan`;

        if (res.material) {
            currentActiveDiscussionMaterialPrompt = res.material.discussion_prompt || '';
            currentActiveDiscussionTeacherName = res.material.teacher_name || currentActiveDiscussionTeacherName;
            if (mat) {
                mat.discussion_prompt = currentActiveDiscussionMaterialPrompt;
            }
            renderLmsDiscussionPromptCard(currentActiveDiscussionMaterialPrompt, currentActiveDiscussionTeacherName);
        }

        renderLmsDiscussions(comments);
    } catch (err) {
        if (currentActiveDiscussionMaterialId !== materialId) return;
        console.error('[LMS Discussion] Error loading comments:', err);
        if (listEl) {
            listEl.innerHTML = `<div class="text-center py-8 text-rose-500 text-xs font-bold">Gagal memuat diskusi: ${escapeHTML(err.message)}</div>`;
        }
    }
};

window.closeLmsDiscussionModal = function () {
    currentActiveDiscussionMaterialId = null;
    currentReplyingToComment = null;
    currentActiveDiscussionMaterialPrompt = '';
    window.closeAllCommentMenus();
    if (discussionModalKeydownHandler) {
        document.removeEventListener('keydown', discussionModalKeydownHandler);
        discussionModalKeydownHandler = null;
    }
    const modal = document.getElementById('modal-lms-discussion');
    if (modal) modal.classList.add('hidden');
};

window.openDiscussionMathPalette = function (target, triggerBtn = null) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    const btn = typeof triggerBtn === 'string' ? document.getElementById(triggerBtn) : triggerBtn;
    if (el) openLmsMathPaletteModal(el, null, btn);
};

function renderLmsDiscussionPromptCard(prompt, teacherName) {
    const container = document.getElementById('lms-discussion-prompt-container');
    if (!container) return;

    if (prompt && prompt.trim() !== '') {
        container.innerHTML = `
            <div class="p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xs space-y-2">
                <div class="lms-discussion-prompt-toolbar flex items-center justify-between gap-2">
                    <div class="lms-discussion-prompt-identity flex items-center gap-2 min-w-0">
                        <span class="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-[10px] font-extrabold flex items-center gap-1 shrink-0">
                            <i class="fa-solid fa-lightbulb"></i> Pemantik Diskusi
                        </span>
                        <span class="text-[11px] font-bold text-slate-600 dark:text-slate-400 truncate">
                            ${escapeHTML(teacherName || 'Guru Mapel')}
                        </span>
                    </div>
                    <button type="button" onclick="window.showEditLmsDiscussionPromptInline()"
                        class="px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1 shrink-0 transition shadow-2xs" aria-label="Edit pemantik diskusi">
                        <i class="fa-solid fa-pen-to-square"></i>
                        <span>Ubah Masalah</span>
                    </button>
                </div>
                <div class="text-xs text-slate-800 dark:text-slate-100 font-semibold leading-relaxed pl-3 border-l-3 border-indigo-400 dark:border-indigo-500">
                    ${renderSafeMarkdown(prompt)}
                </div>
                <div class="flex items-center justify-between pt-1 text-[10px] text-slate-500 dark:text-slate-400 border-t border-slate-200/60 dark:border-slate-700/60">
                    <span>📌 Seluruh tanggapan siswa di bawah ini mengacu pada pemantik ini.</span>
                    <button type="button" onclick="window.focusLmsDiscussionReplyPrompt()" class="text-indigo-600 dark:text-indigo-400 font-bold hover:underline flex items-center gap-1" aria-label="Fokus ke composer tanggapan">
                        <i class="fa-solid fa-reply"></i> Beri Arahan / Tanggapi
                    </button>
                </div>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="p-3 bg-amber-50/90 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/80 rounded-2xl space-y-2.5">
                <div class="flex items-start gap-2 text-amber-900 dark:text-amber-200 text-xs">
                    <i class="fa-solid fa-triangle-exclamation text-amber-600 text-base mt-0.5 shrink-0"></i>
                    <div class="space-y-0.5">
                        <p class="font-extrabold text-xs">Pemantik Diskusi Belum Diatur</p>
                        <p class="text-[11px] text-amber-800 dark:text-amber-300 leading-snug">
                            Guru hendaknya melempar suatu masalah, kasus, atau pertanyaan pemantik agar siswa memiliki bahan acuan yang jelas untuk membalas diskusi.
                        </p>
                    </div>
                </div>
                <div id="container-quick-prompt-form" class="space-y-2 pt-1 border-t border-amber-200/80 dark:border-amber-900/60">
                    <div class="flex gap-2 items-stretch">
                        <textarea id="input-quick-lms-prompt" rows="2"
                            placeholder="Tuliskan masalah, studi kasus, atau pertanyaan pemantik diskusi guru di sini..."
                            class="flex-1 p-2 border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-amber-500"></textarea>
                        <button type="button" onclick="window.openDiscussionMathPalette('input-quick-lms-prompt', this)"
                            class="px-2.5 bg-amber-100 dark:bg-amber-950/60 hover:bg-amber-200 dark:hover:bg-amber-900/60 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 rounded-xl text-xs font-bold transition shadow-2xs flex items-center justify-center gap-1 shrink-0 active:scale-95"
                            title="Sisipkan simbol / rumus matematika (LaTeX)" aria-label="Sisipkan simbol matematika pemantik">
                            <i class="fa-solid fa-square-root-variable text-sm"></i>
                            <span class="hidden sm:inline font-mono text-[11px] font-bold">√x</span>
                        </button>
                    </div>
                    <div class="flex items-center justify-end">
                        <button type="button" onclick="window.saveLmsDiscussionPromptDirectly()" id="btn-save-quick-prompt"
                            class="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-extrabold transition shadow flex items-center gap-1.5 active:scale-95">
                            <i class="fa-solid fa-paper-plane text-[11px]"></i>
                            <span>Tulis Pemantik Sekarang</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
}

window.showEditLmsDiscussionPromptInline = function () {
    const container = document.getElementById('lms-discussion-prompt-container');
    if (!container) return;

    container.innerHTML = `
        <div class="p-3 bg-indigo-50/90 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/80 rounded-2xl space-y-2">
            <div class="flex items-center justify-between text-xs">
                <span class="font-bold text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                    <i class="fa-solid fa-pen-to-square text-indigo-600"></i> Edit Masalah / Pemantik Diskusi Guru
                </span>
                <span class="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold">Live Real-time</span>
            </div>
            <div class="flex gap-2 items-stretch">
                <textarea id="input-quick-lms-prompt" rows="2"
                    class="flex-1 p-2 border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500">${escapeHTML(currentActiveDiscussionMaterialPrompt)}</textarea>
                <button type="button" onclick="window.openDiscussionMathPalette('input-quick-lms-prompt', this)"
                    class="px-2.5 bg-indigo-100 dark:bg-indigo-950/60 hover:bg-indigo-200 dark:hover:bg-indigo-900/60 border border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 rounded-xl text-xs font-bold transition shadow-2xs flex items-center justify-center gap-1 shrink-0 active:scale-95"
                    title="Sisipkan simbol / rumus matematika (LaTeX)" aria-label="Sisipkan simbol matematika pemantik">
                    <i class="fa-solid fa-square-root-variable text-sm"></i>
                    <span class="hidden sm:inline font-mono text-[11px] font-bold">√x</span>
                </button>
            </div>
            <div class="flex items-center justify-end gap-2">
                <button type="button" onclick="window.cancelEditLmsDiscussionPromptInline()"
                    class="px-3 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold transition">
                    Batal
                </button>
                <button type="button" onclick="window.saveLmsDiscussionPromptDirectly()" id="btn-save-quick-prompt"
                    class="px-3.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-extrabold transition shadow flex items-center gap-1 active:scale-95">
                    <i class="fa-solid fa-floppy-disk text-[11px]"></i>
                    <span>Simpan Perubahan</span>
                </button>
            </div>
        </div>
    `;
    setTimeout(() => document.getElementById('input-quick-lms-prompt')?.focus(), 50);
};

window.cancelEditLmsDiscussionPromptInline = function () {
    renderLmsDiscussionPromptCard(currentActiveDiscussionMaterialPrompt, currentActiveDiscussionTeacherName);
};

window.saveLmsDiscussionPromptDirectly = async function () {
    if (!currentActiveDiscussionMaterialId) return;

    const input = document.getElementById('input-quick-lms-prompt');
    const newPrompt = (input?.value || '').trim();
    if (!newPrompt) {
        showToast('Pemantik Kosong', 'Tuliskan masalah atau pertanyaan pemantik diskusi terlebih dahulu.', 'warning');
        input?.focus();
        return;
    }

    const btn = document.getElementById('btn-save-quick-prompt');
    if (btn) btn.disabled = true;

    try {
        await cfUpdateLmsDiscussionPrompt(currentActiveDiscussionMaterialId, newPrompt);
        currentActiveDiscussionMaterialPrompt = newPrompt;

        const mat = (currentLmsMaterials || []).find(m => m.id === currentActiveDiscussionMaterialId);
        if (mat) mat.discussion_prompt = newPrompt;

        renderLmsDiscussionPromptCard(currentActiveDiscussionMaterialPrompt, currentActiveDiscussionTeacherName);
        showToast('Berhasil', 'Masalah / topik pemantik diskusi berhasil diperbarui.', 'success');
    } catch (err) {
        console.error('[LMS Discussion Prompt Error]:', err);
        showToast('Gagal Menyimpan', err.message || 'Terjadi kesalahan.', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
};

window.focusLmsDiscussionReplyPrompt = function () {
    const input = document.getElementById('input-lms-discussion-content');
    if (input) {
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

let currentLmsCommentsMap = new Map();

function renderLmsDiscussions(comments) {
    const listEl = document.getElementById('lms-discussion-comments-list');
    if (!listEl) return;

    currentLmsCommentsMap.clear();
    const registerComments = (items) => {
        (items || []).forEach(it => {
            currentLmsCommentsMap.set(String(it.id), it);
            if (it.replies && it.replies.length > 0) {
                registerComments(it.replies);
            }
        });
    };
    registerComments(comments);

    if (!comments || comments.length === 0) {
        listEl.innerHTML = `
            <div class="text-center py-10 text-slate-400 text-xs space-y-2">
                <div class="w-12 h-12 mx-auto rounded-full bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-500 dark:text-indigo-400 text-xl">
                    <i class="fa-solid fa-comments"></i>
                </div>
                <p class="font-bold text-slate-700 dark:text-slate-200">Belum Ada Tanggapan Siswa</p>
                <p class="text-[11px] text-slate-400 max-w-sm mx-auto leading-relaxed">Siswa akan menanggapi pemantik di atas. Guru juga dapat memberikan arahan atau umpan balik tambahan di bawah.</p>
            </div>
        `;
        return;
    }

    let html = '';

    comments.forEach(c => {
        const isGuru = c.user_role !== 'siswa';
        const roleBadge = isGuru
            ? '<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[9px] font-extrabold">Guru Mapel</span>'
            : '<span class="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 text-[9px] font-extrabold">Siswa</span>';

        const pinnedBadge = c.is_pinned === 1
            ? '<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[9px] font-extrabold flex items-center gap-1"><i class="fa-solid fa-thumbtack text-[9px]"></i> Disematkan</span>'
            : '';

        const replies = c.replies || [];
        const cPhotoUrl = (!isGuru && c.user_photo_url) ? (typeof window.resolvePhotoUrl === 'function' ? window.resolvePhotoUrl(c.user_photo_url) : c.user_photo_url) : '';
        const cInitial = (c.user_name || 'S').charAt(0).toUpperCase();
        const cAvatarHtml = isGuru
            ? `<div class="w-7 h-7 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center font-black shrink-0 mt-0.5 shadow-2xs"><i class="fa-solid fa-chalkboard-user text-[11px]"></i></div>`
            : cPhotoUrl
                ? `<div class="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs shrink-0 mt-0.5 overflow-hidden ring-1 ring-blue-500/20 shadow-2xs"><img src="${cPhotoUrl}" alt="${escapeHTML(c.user_name)}" class="w-full h-full object-cover" onerror="this.onerror=null; this.parentElement.classList.add('bg-blue-600','text-white','font-black'); this.parentElement.innerHTML='${cInitial}';" /></div>`
                : `<div class="w-7 h-7 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-black shrink-0 mt-0.5 shadow-2xs">${cInitial}</div>`;

        html += `
            <div class="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border ${c.is_pinned ? 'border-amber-300 dark:border-amber-700/80 bg-amber-50/20' : 'border-slate-200/70 dark:border-slate-700/60'} space-y-2">
                <div class="flex items-start justify-between gap-2">
                    <div class="flex items-start gap-2.5 min-w-0">
                        ${cAvatarHtml}
                        <div class="min-w-0">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="font-bold text-xs text-slate-800 dark:text-slate-100 truncate max-w-[200px] sm:max-w-xs">${escapeHTML(c.user_name)}</span>
                                ${roleBadge}
                                ${pinnedBadge}
                            </div>
                            <span class="text-[10px] text-slate-400 font-medium">${c.created_at || ''}</span>
                        </div>
                    </div>

                    <div class="flex items-center gap-1 shrink-0">
                        <button type="button" onclick="window.replyToLmsComment('${c.id}')"
                            class="px-2 py-1 rounded-lg text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 flex items-center gap-1 transition"
                            title="Balas Tanggapan Ini">
                            <i class="fa-solid fa-reply text-[10px]"></i>
                            <span class="hidden sm:inline">Balas</span>
                        </button>

                        <div class="relative">
                            <button type="button" onclick="window.toggleCommentActionsMenu(event, '${c.id}')"
                                class="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 flex items-center justify-center transition"
                                title="Menu Opsi" aria-label="Menu opsi tanggapan">
                                <i class="fa-solid fa-ellipsis-vertical text-xs"></i>
                            </button>
                            <div id="comment-menu-${c.id}" class="hidden absolute right-0 top-8 z-30 w-44 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 text-xs">
                                <button type="button" onclick="window.togglePinLmsDiscussion('${c.id}'); window.closeAllCommentMenus();"
                                    class="w-full px-3 py-1.5 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 font-medium transition">
                                    <i class="fa-solid fa-thumbtack ${c.is_pinned ? 'text-amber-500' : 'text-slate-400'} text-xs"></i>
                                    <span>${c.is_pinned ? 'Lepas Sematan' : 'Sematkan Tanggapan'}</span>
                                </button>
                                <button type="button" onclick="window.deleteLmsDiscussionComment('${c.id}'); window.closeAllCommentMenus();"
                                    class="w-full px-3 py-1.5 text-left text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center gap-2 font-medium transition">
                                    <i class="fa-solid fa-trash text-xs"></i>
                                    <span>Hapus Tanggapan</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="text-xs text-slate-700 dark:text-slate-200 leading-relaxed pl-9">
                    ${renderSafeMarkdown(c.content)}
                </div>

                ${replies.length > 0 ? `
                    <div class="pl-4 sm:pl-5 space-y-2 border-l-2 border-slate-200 dark:border-slate-700 ml-3.5 my-2">
                        ${replies.map(r => {
                            const rIsGuru = r.user_role !== 'siswa';
                            const rReplies = r.replies || [];
                            const rPhotoUrl = (!rIsGuru && r.user_photo_url) ? (typeof window.resolvePhotoUrl === 'function' ? window.resolvePhotoUrl(r.user_photo_url) : r.user_photo_url) : '';
                            const rInitial = (r.user_name || 'S').charAt(0).toUpperCase();
                            const rAvatarHtml = rIsGuru
                                ? `<div class="w-5 h-5 rounded-full bg-emerald-600 text-white text-[9px] flex items-center justify-center font-bold shrink-0 shadow-2xs"><i class="fa-solid fa-chalkboard-user text-[8px]"></i></div>`
                                : rPhotoUrl
                                    ? `<div class="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[9px] shrink-0 overflow-hidden ring-1 ring-blue-500/20 shadow-2xs"><img src="${rPhotoUrl}" alt="${escapeHTML(r.user_name)}" class="w-full h-full object-cover" onerror="this.onerror=null; this.parentElement.classList.add('bg-blue-600','text-white','font-bold'); this.parentElement.innerHTML='${rInitial}';" /></div>`
                                    : `<div class="w-5 h-5 rounded-full bg-blue-600 text-white text-[9px] flex items-center justify-center font-bold shrink-0 shadow-2xs">${rInitial}</div>`;

                            return `
                                <div class="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/60 dark:border-slate-800 space-y-1.5 shadow-2xs">
                                    <div class="flex items-center justify-between gap-1.5">
                                        <div class="flex items-center gap-1.5 flex-wrap min-w-0">
                                            ${rAvatarHtml}
                                            <span class="font-bold text-[11px] text-slate-800 dark:text-slate-200 truncate max-w-[180px] sm:max-w-xs">${escapeHTML(r.user_name)}</span>
                                            ${rIsGuru ? '<span class="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[8px] font-bold">Guru Mapel</span>' : '<span class="px-1.5 py-0.2 rounded bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 text-[8px] font-bold">Siswa</span>'}
                                            <span class="text-[9px] text-slate-400">${r.created_at || ''}</span>
                                        </div>
                                        <div class="flex items-center gap-1 shrink-0">
                                            <button type="button" onclick="window.replyToLmsComment('${r.id}')"
                                                class="px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 transition"
                                                title="Balas tanggapan">
                                                <i class="fa-solid fa-reply text-[9px]"></i>
                                                <span class="hidden sm:inline">Balas</span>
                                            </button>
                                            <button type="button" onclick="window.deleteLmsDiscussionComment('${r.id}')"
                                                class="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-[10px] transition"
                                                title="Hapus Tanggapan" aria-label="Hapus tanggapan ${escapeHTML(r.user_name)}">
                                                <i class="fa-solid fa-trash text-[9px]"></i>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="text-[11px] text-slate-600 dark:text-slate-300 leading-snug pl-6.5">
                                        ${renderSafeMarkdown(r.content)}
                                    </div>

                                    ${rReplies.length > 0 ? `
                                        <div class="pl-3.5 space-y-1.5 border-l-2 border-indigo-200 dark:border-indigo-900 ml-1.5 mt-2">
                                            ${rReplies.map(r2 => {
                                                const r2IsGuru = r2.user_role !== 'siswa';
                                                const r2PhotoUrl = (!r2IsGuru && r2.user_photo_url) ? (typeof window.resolvePhotoUrl === 'function' ? window.resolvePhotoUrl(r2.user_photo_url) : r2.user_photo_url) : '';
                                                const r2Initial = (r2.user_name || 'S').charAt(0).toUpperCase();
                                                const r2AvatarHtml = r2IsGuru
                                                    ? `<div class="w-4.5 h-4.5 rounded-full bg-emerald-600 text-white text-[8px] flex items-center justify-center font-bold shrink-0 shadow-2xs"><i class="fa-solid fa-chalkboard-user text-[7px]"></i></div>`
                                                    : r2PhotoUrl
                                                        ? `<div class="w-4.5 h-4.5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[8px] shrink-0 overflow-hidden ring-1 ring-blue-500/20 shadow-2xs"><img src="${r2PhotoUrl}" alt="${escapeHTML(r2.user_name)}" class="w-full h-full object-cover" onerror="this.onerror=null; this.parentElement.classList.add('bg-blue-600','text-white','font-bold'); this.parentElement.innerHTML='${r2Initial}';" /></div>`
                                                        : `<div class="w-4.5 h-4.5 rounded-full bg-blue-600 text-white text-[8px] flex items-center justify-center font-bold shrink-0 shadow-2xs">${r2Initial}</div>`;

                                                return `
                                                    <div class="p-2 bg-slate-50 dark:bg-slate-950/60 rounded-lg border border-slate-200/50 dark:border-slate-800/80 space-y-1">
                                                        <div class="flex items-center justify-between gap-1.5">
                                                            <div class="flex items-center gap-1.5 flex-wrap min-w-0">
                                                                ${r2AvatarHtml}
                                                                <span class="font-bold text-[10px] text-slate-800 dark:text-slate-200 truncate max-w-[160px] sm:max-w-xs">${escapeHTML(r2.user_name)}</span>
                                                                ${r2IsGuru ? '<span class="px-1 py-0.2 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[7px] font-bold">Guru Mapel</span>' : '<span class="px-1 py-0.2 rounded bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 text-[7px] font-bold">Siswa</span>'}
                                                                <span class="text-[8px] text-slate-400">${r2.created_at || ''}</span>
                                                            </div>
                                                            <button type="button" onclick="window.deleteLmsDiscussionComment('${r2.id}')"
                                                                class="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-[9px] transition shrink-0"
                                                                title="Hapus Balasan" aria-label="Hapus balasan ${escapeHTML(r2.user_name)}">
                                                                <i class="fa-solid fa-trash text-[8px]"></i>
                                                            </button>
                                                        </div>
                                                        <div class="text-[10px] text-slate-600 dark:text-slate-300 leading-snug pl-6">
                                                            ${renderSafeMarkdown(r2.content)}
                                                        </div>
                                                    </div>
                                                `;
                                            }).join('')}
                                        </div>
                                    ` : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    });

    listEl.innerHTML = html;
}

window.toggleCommentActionsMenu = function (e, id) {
    if (e) e.stopPropagation();
    const target = document.getElementById(`comment-menu-${id}`);
    const isCurrentlyOpen = target && !target.classList.contains('hidden');
    window.closeAllCommentMenus();
    if (!isCurrentlyOpen && target) {
        target.classList.remove('hidden');
    }
};

window.closeAllCommentMenus = function () {
    document.querySelectorAll('[id^="comment-menu-"]').forEach(m => m.classList.add('hidden'));
};

document.addEventListener('click', () => {
    if (typeof window.closeAllCommentMenus === 'function') {
        window.closeAllCommentMenus();
    }
});

window.replyToLmsComment = function (commentId, explicitAuthorName) {
    const commentObj = currentLmsCommentsMap.get(String(commentId));
    const authorName = explicitAuthorName || commentObj?.user_name || 'Tanggapan';
    currentReplyingToComment = { id: commentId, name: authorName };
    const banner = document.getElementById('lms-replying-to-banner');
    const nameEl = document.getElementById('lms-replying-to-name');
    const input = document.getElementById('input-lms-discussion-content');

    if (banner) banner.classList.remove('hidden');
    if (nameEl) nameEl.textContent = authorName;
    if (input) {
        input.focus();
        input.placeholder = `Balas tanggapan ${authorName}...`;
    }
};

window.cancelLmsReply = function () {
    currentReplyingToComment = null;
    const banner = document.getElementById('lms-replying-to-banner');
    const input = document.getElementById('input-lms-discussion-content');
    if (banner) banner.classList.add('hidden');
    if (input) input.placeholder = 'Tuliskan tanggapan atau arahan guru...';
};

window.sendLmsDiscussionComment = async function () {
    if (!currentActiveDiscussionMaterialId) return;
    const materialId = currentActiveDiscussionMaterialId;
    const parentId = currentReplyingToComment?.id || null;

    const input = document.getElementById('input-lms-discussion-content');
    const content = (input?.value || '').trim();
    if (!content) {
        showToast('Tanggapan Kosong', 'Tuliskan tanggapan Anda terlebih dahulu.', 'warning');
        return;
    }

    const btnSend = document.getElementById('btn-send-lms-comment');
    if (btnSend?.disabled) return;
    if (btnSend) btnSend.disabled = true;

    try {
        const user = auth?.currentUser;
        const cachedName = user ? localStorage.getItem(`cached_user_name_${user.uid}`) : null;
        let authorName = cachedName || user?.displayName;
        if (!authorName && typeof window.getCurrentUserDoc === 'function' && user?.uid) {
            try {
                const uDoc = await window.getCurrentUserDoc(user.uid);
                authorName = uDoc?.name || uDoc?.nama || uDoc?.displayName;
            } catch (_e) {}
        }
        if (!authorName && user?.email) {
            authorName = user.email.split('@')[0];
        }
        authorName = authorName || 'Guru Mapel';

        const payload = {
            material_id: materialId,
            parent_id: parentId,
            user_id: user?.uid || 'guru_mapel',
            user_name: authorName,
            user_role: 'guru',
            content
        };

        await cfSaveLmsDiscussion(payload);
        if (currentActiveDiscussionMaterialId !== materialId) return;
        if (input) input.value = '';
        window.cancelLmsReply();

        const res = await cfGetLmsDiscussions(materialId);
        if (currentActiveDiscussionMaterialId !== materialId) return;
        const countBadge = document.getElementById('lms-discussion-count-badge');
        if (countBadge) countBadge.textContent = `${res.total_comments || 0} Tanggapan`;
        renderLmsDiscussions(res.data || []);
    } catch (err) {
        console.error('[LMS Discussion] Error sending comment:', err);
        showToast('Gagal Mengirim', err.message || 'Terjadi kesalahan.', 'error');
    } finally {
        if (btnSend) btnSend.disabled = false;
    }
};

window.deleteLmsDiscussionComment = async function (commentId) {
    const confirmed = typeof window.showConfirmModal === 'function'
        ? await window.showConfirmModal('Apakah Anda yakin ingin menghapus tanggapan ini secara permanen?', 'Hapus Tanggapan Diskusi', 'danger', { confirmText: 'Ya, Hapus Tanggapan' })
        : confirm('Hapus tanggapan ini?');
    if (!confirmed) return;

    try {
        await cfDeleteLmsDiscussion(commentId);
        if (currentActiveDiscussionMaterialId) {
            const res = await cfGetLmsDiscussions(currentActiveDiscussionMaterialId);
            renderLmsDiscussions(res.data || []);
            const countBadge = document.getElementById('lms-discussion-count-badge');
            if (countBadge) countBadge.textContent = `${res.total_comments || (res.data ? res.data.length : 0)} Tanggapan`;
        }
    } catch (err) {
        console.error('[LMS Discussion] Error deleting comment:', err);
        showToast('Gagal Menghapus', err.message || 'Terjadi kesalahan.', 'error');
    }
};

window.togglePinLmsDiscussion = async function (commentId) {
    try {
        await cfPinLmsDiscussion(commentId);
        if (currentActiveDiscussionMaterialId) {
            const res = await cfGetLmsDiscussions(currentActiveDiscussionMaterialId);
            renderLmsDiscussions(res.data || []);
            const countBadge = document.getElementById('lms-discussion-count-badge');
            if (countBadge) countBadge.textContent = `${res.total_comments || (res.data ? res.data.length : 0)} Tanggapan`;
        }
    } catch (err) {
        console.error('[LMS Discussion] Error pinning comment:', err);
        showToast('Gagal Sematkan', err.message || 'Terjadi kesalahan.', 'error');
    }
};

window.exportLmsAnalyticsToExcel = function () {
    if (!currentLmsAnalytics || !currentLmsAnalytics.data || currentLmsAnalytics.data.length === 0) {
        showToast('Tidak Ada Data', 'Belum ada data analitik keaktifan yang bisa diekspor.', 'warning');
        return;
    }

    if (typeof XLSX === 'undefined') {
        showToast('SheetJS Belum Siap', 'Pustaka Excel XLSX sedang dimuat, coba lagi.', 'warning');
        return;
    }

    const mapel = currentLmsAnalytics.subject_name || 'Mapel';
    const kelas = currentLmsAnalytics.class_name || 'Kelas';
    const isSingleMaterial = currentLmsAnalytics.scope === 'material' || Boolean(currentLmsAnalytics.material_id);
    const matTitle = currentLmsAnalytics.material_title || '';
    const isTopicScope = currentLmsAnalytics.scope === 'topic' || Boolean(currentLmsAnalytics.topic_id);
    const topicTitle = currentLmsAnalytics.topic_title || 'Topik Terpilih';
    let scopeLabel = 'Global — Semua Topik';
    if (isSingleMaterial) {
        scopeLabel = `Modul: ${matTitle} (Topik: ${topicTitle})`;
    } else if (isTopicScope) {
        scopeLabel = `Topik: ${topicTitle}`;
    }
    const summary = currentLmsAnalytics.summary || {};
    const students = currentLmsAnalytics.data || [];

    const studentRows = students.map((s, idx) => {
        if (isSingleMaterial) {
            const hasOpened = Boolean(s.has_opened || s.first_opened_at || s.opened_count > 0 || s.completed_count > 0);
            const isCompleted = Number(s.completed_count) > 0 || s.status === 'completed';
            const discCount = Number(s.discussion_count) || 0;
            const statusMembaca = isCompleted ? 'Selesai Membaca' : (hasOpened ? 'Sedang Membaca' : 'Belum Buka');
            const statusDiskusi = currentLmsAnalytics.allow_discussion === false ? 'Tanpa Diskusi' : (discCount > 0 ? `${discCount} Balasan (Sudah)` : 'Belum Respon');

            return {
                'No': idx + 1,
                'NIS': s.nis || '-',
                'Nama Lengkap Siswa': s.name || '-',
                'Kelas': s.class || s.class_name || kelas,
                'Status Membaca': statusMembaca,
                'Aktivitas Susulan': s.is_late ? 'Terlambat' : '-',
                'Partisipasi Diskusi': statusDiskusi,
                'Persentase Ketuntasan (%)': s.completion_rate ?? 0,
                'Skor Keaktifan (0-100)': s.engagement_score ?? s.total_score ?? 0,
                'Kategori Keaktifan': getLmsStudentEngagementBadge(s)
            };
        }

        return {
            'No': idx + 1,
            'NIS': s.nis || '-',
            'Nama Lengkap Siswa': s.name || '-',
            'Kelas': s.class || s.class_name || kelas,
            'Total Modul': s.total_materials ?? 0,
            'Modul Selesai': s.completed_count ?? 0,
            'Modul Terlambat': s.late_count ?? 0,
            'Sedang Membaca': s.opened_count ?? 0,
            'Belum Membuka': s.not_started_count ?? 0,
            'Kontribusi Diskusi': s.discussion_count ?? 0,
            'Persentase Ketuntasan (%)': s.completion_rate ?? 0,
            'Skor Keaktifan (0-100)': s.engagement_score ?? s.total_score ?? 0,
            'Kategori Keaktifan': getLmsStudentEngagementBadge(s)
        };
    });

    const wsStudents = XLSX.utils.json_to_sheet(studentRows);

    const summaryRows = [
        { 'Indikator': 'Mata Pelajaran', 'Nilai': mapel },
        { 'Indikator': 'Rombel Kelas', 'Nilai': kelas },
        { 'Indikator': 'Cakupan Matriks', 'Nilai': scopeLabel },
        { 'Indikator': 'Total Bahan Ajar dalam Cakupan', 'Nilai': currentLmsAnalytics.total_materials || 0 },
        { 'Indikator': 'Total Siswa', 'Nilai': summary.total_students || 0 },
        { 'Indikator': 'Siswa Sangat Aktif', 'Nilai': summary.sangat_aktif_count || 0 },
        { 'Indikator': 'Siswa Aktif', 'Nilai': summary.aktif_count || 0 },
        { 'Indikator': 'Perlu Perhatian', 'Nilai': summary.perlu_perhatian_count || 0 },
        { 'Indikator': 'Rata-rata Ketuntasan Rombel', 'Nilai': `${summary.average_completion_rate || 0}%` },
        { 'Indikator': 'Waktu Generate Laporan', 'Nilai': new Date().toLocaleString('id-ID') }
    ];

    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsStudents, "Matriks Keaktifan Siswa");
    XLSX.utils.book_append_sheet(wb, wsSummary, "Ringkasan Rombel");

    const scopeSlug = (isSingleMaterial ? `Modul_${matTitle}` : (isTopicScope ? topicTitle : 'Global')).replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'Cakupan';
    const fileName = `LMS_Keaktifan_${kelas.replace(/\s+/g, '_')}_${mapel.replace(/\s+/g, '_')}_${scopeSlug}_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    showToast('Berhasil Diexport', `Laporan keaktifan LMS berhasil diunduh (${fileName}).`, 'success');
};

// Top-level module editor; packet IDs remain compatible with progress, quiz and forum viewers.
window.lmsModuleWorkspace = installLmsModuleEditor({
    api: {
        get: cfGetLmsModule, save: cfSaveLmsModule, visibility: cfSetLmsModuleVisibility,
        remove: cfDeleteLmsModule, progress: cfGetLmsModuleProgress
    },
    getContext: () => ({topics:currentLmsTopics,modules:currentLmsModules,className:document.getElementById('select-kelas')?.value,subject:document.getElementById('select-mapel')?.value}),
    reload: () => window.loadLmsData(true),notify:showToast,
    openTopic: id => window.openLmsTopicModal(id),copy:()=>window.openLmsCopyModal(),
    discussion:id=>window.openLmsDiscussionModal(id),deleteTopic:id=>window.deleteLmsTopic(id),
    progress: id=>window.openLmsProgressModal(id),review:(id,nis)=>window.openLmsQuizReview(id,nis),
    preview:id=>{const p=currentLmsMaterials.find(p=>p.id===id);if(['text','html'].includes(p?.resource_type))window.previewTeacherLmsText(id);else if(p?.resource_url)window.open(p.resource_url,'_blank','noopener,noreferrer');},
    journal: id => window.openLmsJournal(id)
});

// Handlers dialog import nilai kuis LMS aktif terpasang di baris 5380
