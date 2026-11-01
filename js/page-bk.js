import { auth, resolvePhotoUrl } from './config.js';
import { cfClient } from './cloudflare-client.js';
import { initLayout } from './global.js';
import { SimasEWS } from './ews-calculator.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

let studentsCache = [];
let selectedStudentNIS = null; // VARIABLE BARU UNTUK SSOT
let editingDocId = null; // STATE UNTUK EDIT MODE
let currentUserName = "";
let isKepsekOnly = false; // Multi-role: true jika user HANYA punya role kepala_sekolah (view-only)
let currentBkHistoryDocs = []; // State penampung data riwayat konseling aktif untuk pencarian client & export excel
window.bkHistoryLoaded = false;

// --- TAB SWITCHER HELPER (SSOT & ZERO DOUBLE-ACTIVE TABS) ---
export function switchBkTab(targetTab) {
    if (typeof window.switchTab === 'function') {
        window.switchTab(targetTab);
    } else {
        const tabs = ['dashboard', 'input', 'history'];
        tabs.forEach(t => {
            const btn = document.getElementById(`tab-${t}`);
            const view = document.getElementById(`view-${t}`);
            if (t === targetTab) {
                if (btn) btn.className = "shrink-0 px-3.5 sm:px-5 py-2 text-xs sm:text-sm font-bold rounded-lg bg-blue-600 text-white shadow transition-all";
                if (view) view.classList.remove('hidden');
            } else {
                if (btn) btn.className = "shrink-0 px-3.5 sm:px-5 py-2 text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-all";
                if (view) view.classList.add('hidden');
            }
        });
    }
}

// --- AVATAR & PASFOTO SISWA RESMI HELPER (OWASP ASVS & 0 FIRESTORE READ) ---
export function getStudentInitials(name) {
    if (!name) return 'S';
    const clean = String(name).trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'S';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function renderStudentBkAvatar(studentOrPhoto, name = '', options = {}) {
    let photoUrl = '';
    let studentName = name;
    let nis = '';
    let studentClass = '';

    if (typeof studentOrPhoto === 'object' && studentOrPhoto !== null) {
        photoUrl = studentOrPhoto.activePhotoUrl || studentOrPhoto.photoUrl || studentOrPhoto.foto_url || studentOrPhoto.active_photo_url || '';
        studentName = studentName || studentOrPhoto.name || studentOrPhoto.studentName || studentOrPhoto.student_name || '';
        nis = studentOrPhoto.nis || studentOrPhoto.studentNIS || studentOrPhoto.student_nis || '';
        studentClass = studentOrPhoto.class || studentOrPhoto.studentClass || studentOrPhoto.student_class || '';
    } else if (typeof studentOrPhoto === 'string') {
        photoUrl = studentOrPhoto;
    }

    const size = options.size || 'md'; // 'xs' (24px), 'sm' (28px), 'md' (36px), 'lg' (44px), 'xl' (52px)
    const clickable = options.clickable !== false;
    const rounded = options.rounded || 'rounded-xl';

    const sizeConfig = {
        xs: { wh: 'w-6 h-6', text: 'text-[9px]' },
        sm: { wh: 'w-7 h-7', text: 'text-[10px]' },
        md: { wh: 'w-9 h-9', text: 'text-xs' },
        lg: { wh: 'w-11 h-11', text: 'text-sm' },
        xl: { wh: 'w-13 h-13', text: 'text-base' }
    };
    const conf = sizeConfig[size] || sizeConfig.md;

    const safeName = window.escapeHTML ? window.escapeHTML(studentName) : studentName;
    const initials = getStudentInitials(studentName);

    let resolved = photoUrl ? resolvePhotoUrl(photoUrl) : '';
    // Sanitasi URL OWASP: Hindari skema berbahaya (javascript:, data:text/html, etc.)
    if (resolved && !/^(https?:|\/|data:image\/)/i.test(resolved)) {
        resolved = '';
    }

    const safeUrl = window.escapeHTML ? window.escapeHTML(resolved) : resolved;
    const safeNis = window.escapeHTML ? window.escapeHTML(nis) : nis;
    const safeClass = window.escapeHTML ? window.escapeHTML(studentClass) : studentClass;

    const clickAttr = clickable
        ? `onclick="event.stopPropagation(); window.openStudentPhotoPreview('${safeNis}', '${safeName}', '${safeClass}', '${safeUrl}')"`
        : '';
    const cursorClass = clickable ? 'cursor-pointer hover:opacity-90 active:scale-95 transition-all' : '';

    // Fallback monogram avatar
    const fallbackHTML = `
        <div ${clickAttr} class="${conf.wh} ${rounded} bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-extrabold ${conf.text} flex items-center justify-center shrink-0 shadow-2xs select-none ring-1 ring-blue-500/20 dark:ring-blue-400/30 ${cursorClass}" title="${safeName}">
            <span>${initials}</span>
        </div>
    `.trim();

    if (!safeUrl) {
        return fallbackHTML;
    }

    return `
        <div ${clickAttr} class="relative ${conf.wh} shrink-0 inline-flex items-center justify-center ${cursorClass}" title="${safeName}">
            <img src="${safeUrl}" alt="${safeName}" loading="lazy"
                class="${conf.wh} ${rounded} object-cover shadow-2xs ring-1 ring-slate-200/80 dark:ring-slate-700/80"
                onerror="this.onerror=null; this.classList.add('hidden'); if(this.nextElementSibling) this.nextElementSibling.classList.remove('hidden');" />
            <div class="${conf.wh} ${rounded} bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-extrabold ${conf.text} hidden flex items-center justify-center shrink-0 shadow-2xs select-none ring-1 ring-blue-500/20 dark:ring-blue-400/30">
                <span>${initials}</span>
            </div>
        </div>
    `.trim();
}

window.getStudentInitials = getStudentInitials;
window.renderStudentBkAvatar = renderStudentBkAvatar;

window.openStudentPhotoPreview = (nis, name, classStr, photoUrl) => {
    const modal = document.getElementById('modal-preview-student-photo');
    if (!modal) return;

    const imgEl = document.getElementById('preview-student-img');
    const fallbackEl = document.getElementById('preview-student-fallback');
    const initialsEl = document.getElementById('preview-student-initials');
    const nameEl = document.getElementById('preview-student-name');
    const classEl = document.getElementById('preview-student-class');
    const nisEl = document.getElementById('preview-student-nis');

    if (nameEl) nameEl.innerText = name || '-';
    if (classEl) classEl.innerText = classStr || '-';
    if (nisEl) nisEl.innerText = nis || '-';
    if (initialsEl) initialsEl.innerText = getStudentInitials(name);

    let resolved = photoUrl ? resolvePhotoUrl(photoUrl) : '';
    if (resolved && !/^(https?:|\/|data:image\/)/i.test(resolved)) {
        resolved = '';
    }

    if (resolved && imgEl && fallbackEl) {
        imgEl.src = resolved;
        imgEl.onload = () => {
            imgEl.classList.remove('hidden');
            fallbackEl.classList.add('hidden');
        };
        imgEl.onerror = () => {
            imgEl.classList.add('hidden');
            fallbackEl.classList.remove('hidden');
        };
        // Jika gambar sudah di-cache dan complete
        if (imgEl.complete && imgEl.naturalWidth > 0) {
            imgEl.classList.remove('hidden');
            fallbackEl.classList.add('hidden');
        }
    } else if (imgEl && fallbackEl) {
        imgEl.classList.add('hidden');
        fallbackEl.classList.remove('hidden');
    }

    modal.classList.remove('hidden');
};

window.closeStudentPhotoPreview = () => {
    const modal = document.getElementById('modal-preview-student-photo');
    if (modal) modal.classList.add('hidden');
};

// --- CACHE HELPER FUNCTIONS ---
function getSessionCache(key) {
    try {
        const cached = sessionStorage.getItem(key);
        return cached ? JSON.parse(cached) : null;
    } catch (e) {
        return null;
    }
}

function setSessionCache(key, data) {
    try {
        sessionStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
        console.warn('[Cache] Error writing session cache:', key, e);
    }
}

function clearBkSessionCache() {
    // Clear semua cache BK (dipanggil saat ada perubahan data)
    sessionStorage.removeItem('session_bk_active_cases');
    sessionStorage.removeItem('session_bk_recent_violations');
}

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash); return; }

    // --- AMBIL DATA USER DARI CACHE TERPUSAT (1x read) ---
    const cachedUserDoc = await window.getCurrentUserDoc();
    if (cachedUserDoc && cachedUserDoc.name) {
        currentUserName = cachedUserDoc.name;
    }

    // --- FITUR RECOVERY ROLE ---
    let role = localStorage.getItem('user_role');
    if (!role) {
        role = cachedUserDoc ? (cachedUserDoc.role || 'super_admin') : 'super_admin';
        localStorage.setItem('user_role', role);
    }

    // --- MULTI-ROLE ACCESS CHECK ---
    // Gunakan window.hasRole() untuk cek semua role (primary + additional)
    const allowedRoles = ['super_admin', 'bk', 'guru_bk', 'kepala_sekolah'];
    const hasAccess = allowedRoles.some(r => window.hasRole ? window.hasRole(r) : role === r);

    if (!hasAccess) {
        showToast("Akses Ditolak", "Halaman khusus Guru BK.", "error");
        window.location.href = 'dashboard.html'; return;
    }

    // Gunakan effective role untuk kontrol UI (role dengan akses tertinggi)
    const effectiveRole = window.getEffectiveRoleForPage ?
        window.getEffectiveRoleForPage('bk.html') : role;

    initLayout(effectiveRole);
    document.querySelector('main').classList.remove('hidden');

    // Init Defaults (Default Hari Ini untuk hemat kuota read D1)
    document.getElementById('input-date').valueAsDate = new Date();
    document.getElementById('filter-hist-end').valueAsDate = new Date();
    document.getElementById('filter-hist-start').valueAsDate = new Date();

    // RESTRICT KEPALA SEKOLAH (View Only) - Hitung sekali, pakai di seluruh halaman
    isKepsekOnly = window.hasRole ?
        (window.hasRole('kepala_sekolah') && !window.hasRole('super_admin') && !window.hasRole('guru_bk') && !window.hasRole('bk')) :
        role === 'kepala_sekolah';

    if (isKepsekOnly) {
        const btnSave = document.getElementById('btn-save-bk');
        if (btnSave) btnSave.classList.add('hidden');
    }

    // REVISI: Load Parallel (Dashboard stats muncul duluan, Cache nyusul)
    initDashboard();
    loadStudentList();
    loadClassOptions();
});

// ==========================================
// TAB 1: DASHBOARD
// ==========================================

async function initDashboard() {
    loadBkStats();
    // loadTopViolators(); // DIPINDAH ke akhir loadStudentList agar cache ready dulu
    loadRecentViolations();
    loadActiveCases(); // TAMBAHAN: Load kasus aktif
}

// FUNGSI BARU: LOAD KASUS DALAM PANTAUAN (WITH SESSION CACHE)
async function loadActiveCases() {
    const container = document.getElementById('dash-active-cases');
    const countBadge = document.getElementById('dash-active-count');

    try {
        // === SESSION CACHE ===
        const cacheKey = 'session_bk_active_cases';
        let cachedData = getSessionCache(cacheKey);

        if (cachedData) {
            console.log('[BK] Menggunakan session cache kasus aktif');
            countBadge.innerText = cachedData.length;
            renderActiveCases(container, cachedData);
            return;
        }

        // Fetch dari Cloudflare D1 (0 Firestore Read)
        const casesRes = await cfClient.getBkActions({ status: 'Dalam Pantauan', limit: 10 });
        const cases = Array.isArray(casesRes) ? casesRes : (casesRes?.rows || casesRes?.data || []);

        // Simpan ke session cache
        setSessionCache(cacheKey, cases);
        console.log('[BK] Kasus aktif di-cache ke sessionStorage');

        // Update badge count
        if (countBadge) countBadge.innerText = cases.length;
        renderActiveCases(container, cases);

    } catch (e) {
        console.error("Gagal load active cases:", e);
        container.innerHTML = '<div class="p-4 text-center text-red-500 text-xs">Gagal memuat data.</div>';
    }
}

// Helper function untuk render kasus aktif
function renderActiveCases(container, cases) {
    if (cases.length === 0) {
        container.innerHTML = '<div class="p-4 text-center text-slate-400 text-xs italic"><i class="fa-solid fa-check-circle text-green-500 mr-1"></i> Tidak ada kasus dalam pantauan.</div>';
        return;
    }

    let html = '';

    cases.forEach(r => {
        const dateStr = r.date ? new Date(r.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '-';
        const sName = r.studentName || r.student_name || '';
        const sClass = r.studentClass || r.student_class || '';
        const sNis = r.studentNIS || r.student_nis || '';
        const cName = r.counselorName || r.counselor_name || '';
        const counselorBadge = cName ? `<span class="text-[9px] bg-blue-50 dark:bg-blue-900/40 text-blue-500 dark:text-blue-400 px-1.5 py-0.5 rounded ml-1"><i class="fa-solid fa-user-tie"></i> ${cName}</span>` : '';

        // Avatar Siswa dari Cache
        const cachedStudent = studentsCache.find(itm => (sNis && itm.nis === sNis) || itm.name === sName);
        const sPhoto = cachedStudent?.activePhotoUrl || null;
        const avatarHtml = renderStudentBkAvatar(sPhoto, sName, { size: 'sm', clickable: true });

        // BK-1 FIX: Tombol Proses (hidden untuk kepala sekolah view-only)
        const processBtn = isKepsekOnly ? '' :
            `<button onclick="window.openActiveCase('${r.id}')" class="text-[10px] bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 px-2 py-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900 whitespace-nowrap">
                <i class="fa-solid fa-arrow-right"></i> Proses
            </button>`;

        html += `
        <div class="p-3 hover:bg-yellow-50/50 dark:hover:bg-yellow-900/20 transition border-b border-slate-100 dark:border-slate-700/50 last:border-0">
            <div class="flex justify-between items-start gap-2 mb-1.5">
                <div class="flex items-center gap-2.5 min-w-0 flex-1">
                    ${avatarHtml}
                    <div class="min-w-0 flex-1">
                        <div class="font-bold text-slate-700 dark:text-slate-200 text-sm truncate">${window.escapeHTML(sName)}</div>
                        <div class="text-[10px] text-slate-400 dark:text-slate-500">${window.escapeHTML(sClass)} ${counselorBadge}</div>
                    </div>
                </div>
                <div class="text-right flex-shrink-0">
                    <div class="text-[10px] text-slate-400 dark:text-slate-500">${dateStr}</div>
                    ${processBtn}
                </div>
            </div>
            <div class="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 bg-yellow-50 dark:bg-yellow-900/20 p-1.5 rounded border-l-2 border-yellow-400 dark:border-yellow-500/50">${window.escapeHTML(r.problem || 'Tidak ada keterangan masalah')}</div>
        </div>`;
    });

    container.innerHTML = html;
}

// FUNGSI PENDUKUNG: Buka kasus aktif untuk diproses
window.openActiveCase = async (docId) => {
    try {
        const r = await cfClient.getBkActionById(docId);
        if (!r) {
            showToast("Error", "Data tidak ditemukan.", "error");
            return;
        }

        const sName = r.studentName || r.student_name || '-';
        const sClass = r.studentClass || r.student_class || '-';
        const sNis = r.studentNIS || r.student_nis || '-';

        // Set ke edit mode
        editingDocId = docId;
        selectedStudentNIS = sNis;

        // Cari data di studentsCache untuk foto & info pelengkap
        const cachedStudent = studentsCache.find(s => (sNis !== '-' && s.nis === sNis) || s.name === sName);
        const sPhoto = cachedStudent?.activePhotoUrl || null;
        const sGender = cachedStudent?.gender || '';
        const sAch = cachedStudent?.achievementPoints || 0;
        const sPoints = cachedStudent?.violationPoints !== undefined ? cachedStudent.violationPoints : '-';

        // Fill student profile
        document.getElementById('info-name').innerText = sName;
        document.getElementById('info-class').innerText = sClass;
        document.getElementById('info-nis').innerText = sNis;
        document.getElementById('info-points').innerText = sPoints;

        // Render Avatar di Profile Card
        const avatarSlot = document.getElementById('info-avatar-slot');
        if (avatarSlot) {
            avatarSlot.innerHTML = renderStudentBkAvatar(sPhoto, sName, { size: 'lg', clickable: false });
        }
        const photoContainer = document.getElementById('info-photo-container');
        if (photoContainer) {
            photoContainer.onclick = () => {
                window.openStudentPhotoPreview(sNis, sName, sClass, sPhoto);
            };
        }

        // Gender Badge
        const genderBadge = document.getElementById('info-gender-badge');
        if (genderBadge) {
            if (sGender === 'L' || sGender === 'Laki-laki') {
                genderBadge.className = 'text-[10px] px-1.5 py-0.2 rounded font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
                genderBadge.innerText = 'L';
                genderBadge.classList.remove('hidden');
            } else if (sGender === 'P' || sGender === 'Perempuan') {
                genderBadge.className = 'text-[10px] px-1.5 py-0.2 rounded font-semibold bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300';
                genderBadge.innerText = 'P';
                genderBadge.classList.remove('hidden');
            } else {
                genderBadge.classList.add('hidden');
            }
        }

        // Prestasi Badge
        const achWrapper = document.getElementById('info-achievement-wrapper');
        const achVal = document.getElementById('info-achievement');
        if (achWrapper && achVal) {
            if (sAch > 0) {
                achVal.innerText = sAch;
                achWrapper.classList.remove('hidden');
                achWrapper.classList.add('flex');
            } else {
                achWrapper.classList.add('hidden');
                achWrapper.classList.remove('flex');
            }
        }

        // Fill form - KOSONGKAN untuk input follow-up baru
        document.getElementById('input-problem').value = r.problem || '';
        document.getElementById('input-service-type').value = 'Konseling Individu'; // Default untuk follow-up
        document.getElementById('input-date').valueAsDate = new Date(); // Tanggal hari ini
        document.getElementById('input-status').value = r.status || 'Dalam Pantauan';
        document.getElementById('input-notes').value = ''; // Kosongkan untuk catatan baru

        // Update button
        document.getElementById('btn-save-bk').innerHTML = '<i class="fa-solid fa-plus mr-2"></i> Tambah Follow-Up';

        // Show workspace
        document.getElementById('workspace-placeholder').classList.add('hidden');
        document.getElementById('workspace-bk').classList.remove('hidden');
        document.getElementById('student-profile').classList.remove('hidden');
        const searchInput = document.getElementById('student-search');
        if (searchInput) searchInput.value = `${sName} (${sClass})`;
        const clearBtn = document.getElementById('btn-clear-student-search');
        if (clearBtn) clearBtn.classList.remove('hidden');

        // Render Follow-Up Timeline
        renderFollowUpTimeline(r.followUpHistory || r.follow_up_history || []);

        // Load context data for this student
        loadContextData(sNis);

        // Switch to Input tab
        switchBkTab('input');

        window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (e) {
        console.error("Open Case Error:", e);
        showToast("Error", "Gagal memproses kasus.", "error");
    }
};

function renderFollowUpTimeline(history) {
    const container = document.getElementById('timeline-container');
    const panel = document.getElementById('panel-followup-history');

    if (!history || history.length === 0) {
        panel.classList.add('hidden');
        return;
    }

    panel.classList.remove('hidden');

    let html = '<div class="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-blue-200 dark:before:bg-blue-800">';

    history.forEach((item, idx) => {
        const dateStr = item.date ? new Date(item.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
        const isLatest = idx === history.length - 1;
        const dotColor = isLatest ? 'bg-blue-500 ring-4 ring-blue-100 dark:ring-blue-900' : 'bg-slate-300 dark:bg-slate-600';

        html += `
        <div class="relative">
            <div class="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full ${dotColor}"></div>
            <div class="bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm text-left">
                <div class="flex justify-between items-center text-[10px] text-slate-400 dark:text-slate-500 mb-1">
                    <span class="font-bold text-blue-600 dark:text-blue-400">#${idx + 1} ${window.escapeHTML(item.serviceType || 'Konseling')}</span>
                    <span>${dateStr}</span>
                </div>
                <div class="text-[10px] text-slate-500 dark:text-slate-400 mb-1 font-medium">${window.escapeHTML(item.bimbinganType || 'Pribadi')}</div>
                <p class="text-xs text-slate-600 dark:text-slate-300 line-clamp-3">${window.escapeHTML(item.notes || 'Tidak ada catatan')}</p>
                ${item.counselorName ? `<div class="text-[9px] text-slate-400 dark:text-slate-500 mt-1 italic"><i class="fa-solid fa-user-tie"></i> ${window.escapeHTML(item.counselorName)}</div>` : ''}
            </div>
        </div>`;
    });

    html += '</div>';
    html += `<div class="text-center text-[10px] text-slate-400 mt-2">Total ${history.length} follow-up</div>`;

    container.innerHTML = html;
}

async function loadBkStats() {
    try {
        const todayStr = window.getLocalISODate ? window.getLocalISODate() : new Date().toLocaleDateString('sv-SE');
        // Fetch stats dari Cloudflare D1 (0 Firestore Read)
        const [recStats, bkStats] = await Promise.all([
            cfClient.getRecordStats({ date_start: todayStr, date_end: todayStr }),
            cfClient.getBkStats()
        ]);

        document.getElementById('dash-today-count').innerText = recStats?.violation || 0;
        document.getElementById('dash-monitoring-count').innerText = bkStats?.dalam_pantauan || 0;
        document.getElementById('dash-total-bk').innerText = bkStats?.total || 0;
    } catch (e) { console.error("Stats Error:", e); }
}

async function loadTopViolators() {
    const tbody = document.getElementById('dash-top-students');
    try {
        // Ambil Top 5 Point dari Cloudflare D1 (0 Firestore Read)
        const topList = await cfClient.getTopViolators(5);
        let html = '';

        (topList || []).forEach(item => {
            const nis = item.nis || item.student_nis;
            const points = item.points || 0;
            const s = studentsCache.find(itm => itm.nis === nis) || { name: item.name || nis, class: item.class || '-' };
            const sPhoto = s.activePhotoUrl || null;
            const avatarHtml = renderStudentBkAvatar(sPhoto, s.name, { size: 'xs', clickable: true });

            if (points > 0) {
                const actionBtn = isKepsekOnly ? '' : `<button onclick="window.selectStudentManual('${window.escapeHTML(String(s.nis || (s.name + ' (' + s.class + ')')))}')" class="text-[10px] bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 px-2 py-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900 whitespace-nowrap">Proses</button>`;
                html += `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 border-b border-slate-50 dark:border-slate-700/50">
                    <td class="px-3 py-2">
                        <div class="flex items-center gap-2 min-w-0">
                            ${avatarHtml}
                            <div class="min-w-0 flex-1">
                                <span class="font-bold text-slate-700 dark:text-slate-200 text-xs truncate block">${window.escapeHTML(s.name)}</span>
                                <span class="text-slate-400 dark:text-slate-500 font-normal text-[10px]">${window.escapeHTML(s.class)}</span>
                            </div>
                        </div>
                    </td>
                    <td class="px-3 py-2 text-right font-bold text-red-600 dark:text-red-400 text-xs">${points}</td>
                    <td class="px-3 py-2 text-center">${actionBtn}</td>
                </tr>`;
            }
        });

        tbody.innerHTML = html || '<tr><td colspan="3" class="p-3 text-center text-slate-400 dark:text-slate-500 italic">Bersih (Tidak ada pelanggaran).</td></tr>';
    } catch (e) { console.error("Gagal load top violators:", e); }
}

// LOAD RECENT VIOLATIONS (WITH SESSION CACHE & CLOUDFLARE D1)
async function loadRecentViolations() {
    const container = document.getElementById('dash-recent-violations');
    try {
        // === SESSION CACHE ===
        const cacheKey = 'session_bk_recent_violations';
        let cachedData = getSessionCache(cacheKey);

        if (cachedData) {
            console.log('[BK] Menggunakan session cache pelanggaran terbaru');
            renderRecentViolations(container, cachedData);
            return;
        }

        // Fetch 10 Pelanggaran Terbaru dari Cloudflare D1 (0 Firestore Read)
        const recList = await cfClient.getRecords({ category: 'Pelanggaran', limit: 10, order: 'DESC' });

        const violations = (recList || []).map(r => {
            const timeObj = r.timestamp?.toDate ? r.timestamp.toDate() : (r.timestampIso ? new Date(r.timestampIso) : (r.createdAt?.toDate ? r.createdAt.toDate() : new Date()));
            return {
                studentNis: r.studentNIS || r.student_nis || '',
                studentName: r.studentName || r.student_name || '',
                desc: r.desc || '',
                points: r.points || 0,
                timeStr: timeObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
            };
        });

        // Simpan ke session cache
        setSessionCache(cacheKey, violations);
        console.log('[BK] Pelanggaran terbaru di-cache ke sessionStorage');

        renderRecentViolations(container, violations);
    } catch (e) {
        console.error('Error load recent violations:', e);
    }
}

// Helper function untuk render pelanggaran terbaru
function renderRecentViolations(container, violations) {
    let html = '';
    violations.forEach(r => {
        const s = studentsCache.find(itm => (r.studentNis && itm.nis === r.studentNis) || itm.name === r.studentName);
        const sPhoto = s?.activePhotoUrl || null;
        const avatarHtml = renderStudentBkAvatar(sPhoto, r.studentName, { size: 'xs', clickable: true });

        html += `
        <div class="p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition border-b border-slate-100 dark:border-slate-700/50 last:border-0 text-xs">
            <div class="flex items-center justify-between mb-1">
                <div class="flex items-center gap-2 min-w-0 flex-1">
                    ${avatarHtml}
                    <span class="font-bold text-slate-700 dark:text-slate-200 truncate">${window.escapeHTML(r.studentName)}</span>
                </div>
                <span class="text-slate-400 dark:text-slate-500 shrink-0 text-[11px]">${r.timeStr}</span>
            </div>
            <div class="text-slate-600 dark:text-slate-400 truncate pl-8">
                ${window.escapeHTML(r.desc)} <span class="text-red-500 dark:text-red-400 font-bold ml-1">+${r.points}</span>
            </div>
        </div>`;
    });
    container.innerHTML = html || '<div class="p-3 text-center text-slate-400 dark:text-slate-500 text-xs">Sepi.</div>';
}

window.selectStudentManual = (searchVal) => {
    // Beralih ke tab input penanganan
    switchBkTab('input');

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (!searchVal) return;

    const cleanVal = String(searchVal).trim();
    // Cari siswa yang cocok: NIS, format "NIS | Nama (Kelas)", format "Nama (Kelas)", atau nama siswa
    let match = studentsCache.find(s => String(s.nis).trim() === cleanVal);
    if (!match) {
        match = studentsCache.find(s => `${s.nis} | ${s.name} (${s.class})` === cleanVal);
    }
    if (!match) {
        match = studentsCache.find(s => `${s.name} (${s.class})` === cleanVal);
    }
    if (!match) {
        match = studentsCache.find(s => (s.name || '').toLowerCase() === cleanVal.toLowerCase());
    }

    if (match) {
        window.selectStudentFromDropdown(match.nis);
    } else {
        const input = document.getElementById('student-search');
        if (input) {
            input.value = cleanVal;
            const clearBtn = document.getElementById('btn-clear-student-search');
            if (clearBtn) clearBtn.classList.remove('hidden');
            renderBkStudentDropdownResults(cleanVal);
        }
    }
};

// ==========================================
// TAB 2: INPUT PENANGANAN (SSOT & SEARCHABLE DROPDOWN)
// ==========================================

// State internal Searchable Dropdown
let currentStudentMatches = [];
let activeStudentDropdownIndex = -1;
let isStudentDropdownOpen = false;

// Helper pure function: filter data siswa (multi-attribute: nama, NIS, kelas)
export function filterBkStudents(students = [], query = '') {
    const q = (query || '').toLowerCase().trim();
    if (!q) return students.slice(0, 35);
    return students.filter(s => {
        const nameMatch = (s.name || '').toLowerCase().includes(q);
        const nisMatch = String(s.nis || '').toLowerCase().includes(q);
        const classMatch = (s.class || '').toLowerCase().includes(q);
        return nameMatch || nisMatch || classMatch;
    }).slice(0, 35);
}

// Helper pure function: build HTML hasil dropdown untuk konsistensi & unit testing
export function renderBkStudentDropdownHtml(students = [], selectedNIS = null, query = '') {
    if (!students || students.length === 0) {
        return `
            <div class="p-4 text-center text-xs text-slate-400 dark:text-slate-500">
                <i class="fa-solid fa-user-xmark text-lg mb-1 block opacity-60"></i>
                Tidak ditemukan siswa dengan kata kunci "${window.escapeHTML(query || '')}"
            </div>
        `;
    }

    return students.map((s, idx) => {
        const isSelected = selectedNIS && String(s.nis) === String(selectedNIS);
        const avatarHtml = renderStudentBkAvatar(s, s.name, { size: 'sm', clickable: false });

        let badgesHtml = '';
        if (s.violationPoints > 0) {
            badgesHtml += `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border border-red-200 dark:border-red-800/50 flex items-center gap-0.5" title="Poin Pelanggaran"><i class="fa-solid fa-triangle-exclamation text-[9px]"></i> ${s.violationPoints}</span>`;
        }
        if (s.achievementPoints > 0) {
            badgesHtml += `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50 flex items-center gap-0.5" title="Poin Prestasi"><i class="fa-solid fa-trophy text-[9px]"></i> +${s.achievementPoints}</span>`;
        }

        return `
            <button type="button" id="bk-dropdown-item-${idx}" data-nis="${window.escapeHTML(String(s.nis))}" onclick="window.selectStudentFromDropdown('${window.escapeHTML(String(s.nis))}')"
                class="bk-dropdown-item w-full text-left px-3 py-2.5 bg-white dark:bg-slate-800 hover:!bg-blue-50 dark:hover:!bg-blue-900/40 transition-colors flex items-center justify-between gap-2.5 group cursor-pointer ${isSelected ? '!bg-blue-50/80 dark:!bg-blue-950/60 font-bold' : 'text-slate-700 dark:text-slate-200'}">
                <div class="flex items-center gap-2.5 min-w-0 flex-1">
                    <div class="shrink-0">${avatarHtml}</div>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate">${window.escapeHTML(s.name)}</span>
                            <span class="text-[10px] font-bold px-1.5 py-0.2 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded border border-blue-200 dark:border-blue-800 shrink-0">${window.escapeHTML(s.class || '-')}</span>
                        </div>
                        <div class="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">NIS: ${window.escapeHTML(String(s.nis || '-'))}</div>
                    </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    ${badgesHtml}
                    ${isSelected ? '<i class="fa-solid fa-circle-check text-blue-600 dark:text-blue-400 text-xs ml-1"></i>' : ''}
                </div>
            </button>
        `;
    }).join('');
}

function openBkStudentDropdown() {
    const dropdownList = document.getElementById('student-search-dropdown');
    const arrowIcon = document.getElementById('icon-dropdown-arrow');
    if (dropdownList) {
        dropdownList.classList.remove('hidden');
        isStudentDropdownOpen = true;
    }
    if (arrowIcon) {
        arrowIcon.classList.add('rotate-180');
    }
}

function closeBkStudentDropdown() {
    const dropdownList = document.getElementById('student-search-dropdown');
    const arrowIcon = document.getElementById('icon-dropdown-arrow');
    if (dropdownList) {
        dropdownList.classList.add('hidden');
        isStudentDropdownOpen = false;
        activeStudentDropdownIndex = -1;
    }
    if (arrowIcon) {
        arrowIcon.classList.remove('rotate-180');
    }
}

function updateActiveBkDropdownItem() {
    const dropdownList = document.getElementById('student-search-dropdown');
    if (!dropdownList) return;

    const items = dropdownList.querySelectorAll('.bk-dropdown-item');
    items.forEach((el, idx) => {
        if (idx === activeStudentDropdownIndex) {
            el.classList.add('!bg-blue-100', 'dark:!bg-blue-900/60');
            el.scrollIntoView({ block: 'nearest' });
        } else {
            el.classList.remove('!bg-blue-100', 'dark:!bg-blue-900/60');
        }
    });
}

function renderBkStudentDropdownResults(query = '') {
    const dropdownList = document.getElementById('student-search-dropdown');
    if (!dropdownList) return;

    const filtered = filterBkStudents(studentsCache, query);
    currentStudentMatches = filtered;
    activeStudentDropdownIndex = -1;

    dropdownList.innerHTML = renderBkStudentDropdownHtml(filtered, selectedStudentNIS, query);
    openBkStudentDropdown();
}

function setupBkStudentSearchDropdown() {
    const searchInput = document.getElementById('student-search');
    const dropdownList = document.getElementById('student-search-dropdown');
    const clearBtn = document.getElementById('btn-clear-student-search');
    const container = document.getElementById('bk-student-search-container');

    if (!searchInput || !dropdownList) return;

    if (searchInput._searchDropdownInitialized) return;
    searchInput._searchDropdownInitialized = true;

    // Event input pencarian
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (clearBtn) {
            if (query.length > 0) clearBtn.classList.remove('hidden');
            else clearBtn.classList.add('hidden');
        }
        renderBkStudentDropdownResults(query);
    });

    // Event fokus input: tampilkan opsi
    searchInput.addEventListener('focus', () => {
        const query = searchInput.value.trim();
        renderBkStudentDropdownResults(query);
    });

    // Navigasi Keyboard (ArrowDown, ArrowUp, Enter, Escape)
    searchInput.addEventListener('keydown', (e) => {
        if (!isStudentDropdownOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            renderBkStudentDropdownResults(searchInput.value.trim());
            return;
        }

        if (!isStudentDropdownOpen) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (currentStudentMatches.length === 0) return;
            activeStudentDropdownIndex = (activeStudentDropdownIndex + 1) % currentStudentMatches.length;
            updateActiveBkDropdownItem();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (currentStudentMatches.length === 0) return;
            activeStudentDropdownIndex = (activeStudentDropdownIndex - 1 + currentStudentMatches.length) % currentStudentMatches.length;
            updateActiveBkDropdownItem();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeStudentDropdownIndex >= 0 && activeStudentDropdownIndex < currentStudentMatches.length) {
                const target = currentStudentMatches[activeStudentDropdownIndex];
                if (target) {
                    window.selectStudentFromDropdown(target.nis);
                }
            } else if (currentStudentMatches.length === 1) {
                window.selectStudentFromDropdown(currentStudentMatches[0].nis);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeBkStudentDropdown();
        }
    });

    // Menutup dropdown saat klik di luar area
    document.addEventListener('click', (e) => {
        if (container && !container.contains(e.target)) {
            closeBkStudentDropdown();
        }
    });
}

window.selectStudentFromDropdown = function (nis) {
    if (!nis) return;
    const match = studentsCache.find(s => String(s.nis).trim() === String(nis).trim());
    if (!match) return;

    selectedStudentNIS = match.nis; // SSOT KEY

    // Sinkronisasi teks input & tombol bersihkan
    const searchInput = document.getElementById('student-search');
    if (searchInput) {
        searchInput.value = `${match.name} (${match.class})`;
    }
    const clearBtn = document.getElementById('btn-clear-student-search');
    if (clearBtn) clearBtn.classList.remove('hidden');

    closeBkStudentDropdown();

    // Tampilkan data profil siswa
    document.getElementById('info-name').innerText = match.name;
    document.getElementById('info-class').innerText = match.class;
    document.getElementById('info-nis').innerText = match.nis || '-';
    document.getElementById('info-points').innerText = match.violationPoints || 0;

    // Render Avatar di Profile Card
    const avatarSlot = document.getElementById('info-avatar-slot');
    if (avatarSlot) {
        avatarSlot.innerHTML = renderStudentBkAvatar(match, match.name, { size: 'lg', clickable: false });
    }
    const photoContainer = document.getElementById('info-photo-container');
    if (photoContainer) {
        photoContainer.onclick = () => {
            window.openStudentPhotoPreview(match.nis, match.name, match.class, match.activePhotoUrl);
        };
    }

    // Gender Badge
    const genderBadge = document.getElementById('info-gender-badge');
    if (genderBadge) {
        if (match.gender === 'L' || match.gender === 'Laki-laki') {
            genderBadge.className = 'text-[10px] px-1.5 py-0.2 rounded font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
            genderBadge.innerText = 'L';
            genderBadge.classList.remove('hidden');
        } else if (match.gender === 'P' || match.gender === 'Perempuan') {
            genderBadge.className = 'text-[10px] px-1.5 py-0.2 rounded font-semibold bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300';
            genderBadge.innerText = 'P';
            genderBadge.classList.remove('hidden');
        } else {
            genderBadge.classList.add('hidden');
        }
    }

    // Prestasi Badge
    const achWrapper = document.getElementById('info-achievement-wrapper');
    const achVal = document.getElementById('info-achievement');
    if (achWrapper && achVal) {
        if (match.achievementPoints > 0) {
            achVal.innerText = match.achievementPoints;
            achWrapper.classList.remove('hidden');
            achWrapper.classList.add('flex');
        } else {
            achWrapper.classList.add('hidden');
            achWrapper.classList.remove('flex');
        }
    }

    // EWS Badge
    const ewsBadgeEl = document.getElementById('info-ews-badge');
    if (ewsBadgeEl && window.SimasEWS) {
        const ewsResult = window.SimasEWS.calculateStudentRisk(match, { points: match.violationPoints || 0 }, 0);
        ewsBadgeEl.innerHTML = `
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${ewsResult.colorClass}">
                <span class="w-1.5 h-1.5 rounded-full ${ewsResult.badgeBg}"></span>
                EWS: ${ewsResult.label} (${ewsResult.totalScore})
            </span>
        `;
    }

    // Load Context data siswa (Dibutuhkan untuk SSOT)
    loadContextData(match.nis, match.class);

    document.getElementById('workspace-placeholder')?.classList.add('hidden');
    document.getElementById('workspace-bk')?.classList.remove('hidden');
    document.getElementById('student-profile')?.classList.remove('hidden');
};

window.clearBkStudentSearch = function () {
    selectedStudentNIS = null;

    const searchInput = document.getElementById('student-search');
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }

    const clearBtn = document.getElementById('btn-clear-student-search');
    if (clearBtn) clearBtn.classList.add('hidden');

    closeBkStudentDropdown();

    document.getElementById('workspace-placeholder')?.classList.remove('hidden');
    document.getElementById('workspace-bk')?.classList.add('hidden');
    document.getElementById('student-profile')?.classList.add('hidden');
};

async function loadStudentList() {
    try {
        // LOAD CONFIG SHOW ALUMNI (dari cache terpusat)
        let showAlumni = false;
        try {
            const configData = await window.getSystemConfig();
            showAlumni = configData.showAlumni || false;
        } catch (e) { }

        // GUNAKAN GLOBAL CACHE (Hemat Kuota Read)
        const allStudents = await window.getStudentsCache();
        studentsCache = [];

        allStudents.forEach(s => {
            if (s.class) {
                const lowerClass = s.class.toLowerCase();
                // FILTER ALUMNI & KELAS NON-AKTIF (Keluar, Pindah, Mutasi)
                if (!showAlumni && lowerClass.includes('alumni')) return;
                if (lowerClass.includes('keluar') || lowerClass.includes('pindah') || lowerClass.includes('mutasi')) return;
            }

            studentsCache.push({
                nis: s.nis,
                name: s.name,
                class: s.class,
                gender: s.gender || '',
                violationPoints: Number(s.violationPoints || 0),
                achievementPoints: Number(s.achievementPoints || 0),
                activePhotoUrl: s.activePhotoUrl || s.photoUrl || s.foto_url || null
            });
        });

        studentsCache.sort((a, b) => {
            const classA = (a.class || "").toUpperCase(); const classB = (b.class || "").toUpperCase();
            if (classA < classB) return -1; if (classA > classB) return 1;
            return (a.name || "").localeCompare(b.name || "");
        });

        // Inisialisasi Searchable Dropdown Siswa BK
        setupBkStudentSearchDropdown();

        // Trigger Top Violators & Opsi Kelas setelah cache siap (Hemat Read & Pasti ada namanya)
        loadTopViolators();
        loadClassOptions();

    } catch (e) { console.error("Gagal load siswa:", e); }
}

// LOAD CONTEXT DATA (VIOLATIONS & BK HISTORY) WITH SESSION CACHE
async function loadContextData(studentNIS, studentClass, forceRefresh = false) {
    const listVio = document.getElementById('list-violations');
    const listBk = document.getElementById('list-bk-history');
    const listWali = document.getElementById('list-guru-wali-notes');
    const listAtt = document.getElementById('list-attendance-permisi');

    listVio.innerHTML = '<li class="text-center text-slate-400 py-2"><i class="fa-solid fa-spinner fa-spin"></i> Memuat pelanggaran...</li>';
    listBk.innerHTML = '<li class="text-center text-slate-400 py-2"><i class="fa-solid fa-spinner fa-spin"></i> Memuat konseling...</li>';
    listWali.innerHTML = '<li class="text-center text-slate-400 py-2"><i class="fa-solid fa-spinner fa-spin"></i> Memuat catatan wali...</li>';
    listAtt.innerHTML = '<li class="text-center text-slate-400 py-2"><i class="fa-solid fa-spinner fa-spin"></i> Memuat kehadiran...</li>';

    try {
        if (!studentNIS) throw new Error("Siswa tidak memiliki NIS. SSOT tidak dapat berjalan.");

        // === SESSION CACHE ===
        const cacheKey = `session_bk_context_${studentNIS}`;

        if (!forceRefresh) {
            const cachedData = getSessionCache(cacheKey);
            if (cachedData) {
                console.log(`[BK] Menggunakan session cache context data ${studentNIS}`);
                renderContextData(listVio, listBk, listWali, listAtt, cachedData);
                return;
            }
        }

        // 1 & 2. AMBIL CONTEXT BK & PELANGGARAN DARI CLOUDFLARE D1 (1x Request, 0 Firestore Read)
        const cfContext = await cfClient.getBkStudentContext(studentNIS);
        const violations = cfContext?.violations || [];
        const bkHistory = cfContext?.bkHistory || [];
        const aggregate = cfContext?.aggregate;

        // Update points & foto di header profil jika tersedia dari context
        const ptsEl = document.getElementById('info-points');
        if (ptsEl && aggregate) {
            ptsEl.innerText = `${aggregate.points || 0}`;
        }
        const achWrapper = document.getElementById('info-achievement-wrapper');
        const achVal = document.getElementById('info-achievement');
        if (achWrapper && achVal && aggregate && aggregate.achievement_points !== undefined) {
            const achPts = Number(aggregate.achievement_points || 0);
            if (achPts > 0) {
                achVal.innerText = achPts;
                achWrapper.classList.remove('hidden');
                achWrapper.classList.add('flex');
            }
        }
        if (cfContext?.student?.active_photo_url) {
            const sPhoto = cfContext.student.active_photo_url;
            const avatarSlot = document.getElementById('info-avatar-slot');
            if (avatarSlot) {
                avatarSlot.innerHTML = renderStudentBkAvatar(sPhoto, cfContext.student.name, { size: 'lg', clickable: false });
            }
            const photoContainer = document.getElementById('info-photo-container');
            if (photoContainer) {
                photoContainer.onclick = () => {
                    window.openStudentPhotoPreview(studentNIS, cfContext.student.name, studentClass || cfContext.student.class || '', sPhoto);
                };
            }
        }

        // 3. AMBIL CATATAN GURU WALI (Cloudflare D1)
        const waliNotes = [];
        if (cfClient && cfClient.enabled) {
            try {
                const notes = await cfClient.getGuruWaliNotes({
                    student_nis: studentNIS,
                    limit: 10
                });
                if (Array.isArray(notes)) {
                    notes.forEach(r => {
                        waliNotes.push({
                            category: r.category || 'Umum',
                            dateStr: r.date || '-',
                            title: r.title || r.notes?.split('\n')[0] || 'Catatan Pembinaan',
                            content: r.notes || r.content || ''
                        });
                    });
                }
            } catch (eWali) {
                console.warn('[BK] Error loading guru wali notes from D1:', eWali);
            }
        }

        // 4. AMBIL KEHADIRAN (Sejak Awal Tahun Ajaran via Supabase SSOT) & PERMISI
        const now = new Date();
        const curMonth = now.getMonth();
        const curYear = now.getFullYear();
        const liveStartYear = (curMonth >= 6) ? curYear : curYear - 1;
        const liveStartDateStr = `${liveStartYear}-07-01`;

        const attendance = [];
        try {
            const { rows: attRows } = await window.fetchStudentAttendanceRange(studentNIS, liveStartDateStr, null);
            if (Array.isArray(attRows)) {
                attRows.forEach(r => {
                    if (r.status !== 'H') {
                        attendance.push({
                            type: 'Absen',
                            dateStr: r.date,
                            status: r.status,
                            notes: r.note || '-'
                        });
                    }
                });
            }
        } catch (eAtt) {
            console.warn('[BK] Fetch student attendance notice:', eAtt);
        }

        let permisi = [];
        try {
            if (cfClient && cfClient.enabled) {
                const snapPermisi = await cfClient.getPermisiRequests({
                    student_nis: studentNIS,
                    limit: 10
                });
                if (Array.isArray(snapPermisi)) {
                    snapPermisi.forEach(r => {
                        permisi.push({
                            type: 'Permisi',
                            dateStr: r.date || '-',
                            status: r.status || 'approved',
                            notes: r.reason || r.permission_type || '-'
                        });
                    });
                }
            }
        } catch (ePerm) {
            console.warn('[BK] Skip permisi check from D1:', ePerm);
        }
        
        // Gabungkan dan sort absensi & permisi
        const attPermisi = [...attendance, ...permisi].sort((a,b) => new Date(b.dateStr) - new Date(a.dateStr)).slice(0, 10);

        // Simpan ke session cache
        const contextData = { violations, bkHistory, waliNotes, attPermisi };
        setSessionCache(cacheKey, contextData);
        console.log(`[BK] Context data ${studentNIS} di-cache ke sessionStorage`);

        renderContextData(listVio, listBk, listWali, listAtt, contextData);

    } catch (e) {
        console.error("Gagal load history:", e);
        listVio.innerHTML = '<li class="text-red-500 text-xs p-2">Gagal memuat.</li>';
        listBk.innerHTML = '<li class="text-red-500 text-xs p-2">Gagal memuat (Cek NIS).</li>';
        listWali.innerHTML = '<li class="text-red-500 text-xs p-2">Gagal memuat.</li>';
        listAtt.innerHTML = '<li class="text-red-500 text-xs p-2">Gagal memuat.</li>';
    }
}

// Helper function untuk render context data
function renderContextData(listVio, listBk, listWali, listAtt, data) {
    // Render violations
    let htmlVio = '';
    data.violations.forEach(r => {
        htmlVio += `<li class="border-b border-red-50 dark:border-slate-700/50 pb-2 mb-2 last:mb-0"><div class="flex justify-between"><span class="font-bold text-red-700 dark:text-red-400">${r.dateStr}</span><span class="font-bold text-red-600 dark:text-red-500">+${r.points}</span></div><p class="text-slate-600 dark:text-slate-400 mt-1 text-xs">${window.escapeHTML(r.desc)}</p></li>`;
    });
    listVio.innerHTML = htmlVio || '<li class="text-center text-slate-400 dark:text-slate-500 italic text-xs">Tidak ada catatan pelanggaran.</li>';

    // Render BK history
    let htmlBk = '';
    data.bkHistory.forEach(r => {
        let bg = r.status === 'Selesai' ? 'bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800/50' : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-100 dark:border-yellow-800/50';
        htmlBk += `<li class="${bg} p-2 rounded border mb-2"><div class="flex justify-between font-bold text-blue-700 dark:text-blue-400 mb-1"><span>${window.escapeHTML(r.serviceType)}</span><span class="text-[10px] text-slate-500 dark:text-slate-400 font-normal">${r.dateStr}</span></div><div class="font-bold text-slate-800 dark:text-slate-200 text-[10px] mb-1">Masalah: ${window.escapeHTML(r.problem || '-')}</div><p class="text-slate-600 dark:text-slate-400 text-xs line-clamp-2">${window.escapeHTML(r.notes)}</p></li>`;
    });
    listBk.innerHTML = htmlBk || '<li class="text-center text-slate-400 dark:text-slate-500 italic text-xs">Belum ada riwayat konseling.</li>';

    // Render Guru Wali Notes
    let htmlWali = '';
    data.waliNotes.forEach(r => {
        const badges = {
            'akademik': '<span class="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-bold">Akademik</span>',
            'kompetensi': '<span class="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold">Kompetensi</span>',
            'keterampilan': '<span class="text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-bold">Keterampilan</span>',
            'karakter': '<span class="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-bold">Karakter</span>'
        };
        const badge = badges[r.category] || `<span class="text-[9px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded-full font-bold">${window.escapeHTML(r.category)}</span>`;
        
        // Encode for safe attribute injection
        const safeTitle = encodeURIComponent(r.title || '-');
        const safeContent = encodeURIComponent(r.content || '-');
        const safeDateStr = encodeURIComponent(r.dateStr || '-');
        const safeBadge = encodeURIComponent(badge || '');

        htmlWali += `<li onclick="window.showWaliNoteDetail('${safeTitle}', '${safeContent}', '${safeDateStr}', '${safeBadge}')" 
            class="bg-purple-50/50 dark:bg-purple-900/10 p-2 rounded border border-purple-100 dark:border-purple-800/50 mb-2 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-800/30 transition-colors">
            <div class="flex justify-between items-center mb-1">
                ${badge}
                <span class="text-[10px] text-slate-500 dark:text-slate-400">${r.dateStr}</span>
            </div>
            <div class="font-bold text-slate-700 dark:text-slate-200 text-[11px] mb-0.5">${window.escapeHTML(r.title)}</div>
            <p class="text-slate-600 dark:text-slate-400 text-[10px] line-clamp-2">${window.escapeHTML(r.content)}</p>
        </li>`;
    });
    listWali.innerHTML = htmlWali || '<li class="text-center text-slate-400 dark:text-slate-500 italic text-xs">Belum ada catatan wali.</li>';

    // Render Attendance & Permisi
    let htmlAtt = '';
    data.attPermisi.forEach(r => {
        if (r.type === 'Absen') {
            const statusColor = r.status === 'Sakit' ? 'text-blue-600 bg-blue-50 border-blue-100' :
                                r.status === 'Izin' ? 'text-yellow-600 bg-yellow-50 border-yellow-100' :
                                'text-red-600 bg-red-50 border-red-100'; // Alpa
            htmlAtt += `<li class="p-2 rounded border ${statusColor} mb-2">
                <div class="flex justify-between font-bold text-[11px] mb-0.5">
                    <span>${r.status}</span>
                    <span class="font-normal text-slate-500">${r.dateStr}</span>
                </div>
                <p class="text-slate-600 text-[10px] truncate">${window.escapeHTML(r.notes)}</p>
            </li>`;
        } else {
            const statusColor = r.status === 'approved' ? 'text-emerald-600 bg-emerald-50 border-emerald-100' :
                                r.status === 'pending' ? 'text-orange-600 bg-orange-50 border-orange-100' :
                                'text-red-600 bg-red-50 border-red-100'; // rejected
            const statusText = r.status === 'approved' ? 'Disetujui' : r.status === 'pending' ? 'Menunggu' : 'Ditolak';
            htmlAtt += `<li class="p-2 rounded border ${statusColor} mb-2">
                <div class="flex justify-between font-bold text-[11px] mb-0.5">
                    <span>Permisi: ${statusText}</span>
                    <span class="font-normal text-slate-500">${r.dateStr}</span>
                </div>
                <p class="text-slate-600 text-[10px] truncate">${window.escapeHTML(r.notes)}</p>
            </li>`;
        }
    });
    listAtt.innerHTML = htmlAtt || '<li class="text-center text-slate-400 dark:text-slate-500 italic text-xs">Bersih. Tidak ada absensi bermasalah/permisi.</li>';
}

window.showWaliNoteDetail = (encTitle, encContent, encDateStr, encBadge) => {
    document.getElementById('modal-wali-title').innerText = decodeURIComponent(encTitle);
    document.getElementById('modal-wali-content').innerText = decodeURIComponent(encContent);
    document.getElementById('modal-wali-date').innerText = decodeURIComponent(encDateStr);
    document.getElementById('modal-wali-badge').innerHTML = decodeURIComponent(encBadge);
    document.getElementById('modal-wali-note').classList.remove('hidden');
};

window.confirmSaveBK = () => {
    if (!selectedStudentNIS) { document.getElementById('student-search').focus(); return; }
    const prob = document.getElementById('input-problem').value;
    if (!prob.trim()) { document.getElementById('input-problem').focus(); return; }
    document.getElementById('modal-confirm-bk').classList.remove('hidden');
};

// SAVE DATA BK (SSOT: SAVE NIS + CUSTOM DOC ID + FOLLOW-UP HISTORY)
window.executeSaveBK = async () => {
    document.getElementById('modal-confirm-bk').classList.add('hidden');
    const btn = document.getElementById('btn-save-bk');
    const oldText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = 'Menyimpan...';

    try {
        if (!selectedStudentNIS) throw new Error("NIS Siswa Kosong. Tidak dapat menyimpan data (SSOT).");

        const bimbinganType = document.getElementById('input-bimbingan-type').value;
        const serviceType = document.getElementById('input-service-type').value;
        const dateVal = document.getElementById('input-date').value;
        const statusVal = document.getElementById('input-status').value;
        const notesVal = document.getElementById('input-notes').value;

        if (editingDocId) {
            // EDIT MODE: Tambah Follow-Up ke array (tidak menimpa) di Cloudflare D1
            const followUpEntry = {
                bimbinganType: bimbinganType,
                serviceType: serviceType,
                date: dateVal,
                notes: notesVal,
                counselorName: currentUserName,
                timestamp: new Date().toISOString() // Client timestamp untuk sorting
            };

            await cfClient.updateBkAction(editingDocId, {
                bimbingan_type: bimbinganType,
                service_type: serviceType,
                date: dateVal,
                status: statusVal,
                notes: notesVal,
                counselor_name: currentUserName,
                followUpEntry: followUpEntry
            });

            if (typeof window.logAudit === 'function') {
                window.logAudit('UPDATE_BK_CASE', editingDocId, null, { status: statusVal, followUp: followUpEntry.serviceType }, `Menambahkan follow-up tindak lanjut BK: ${document.getElementById('info-name').innerText}`);
            }

            showToast("Berhasil", "Follow-up berhasil ditambahkan!", "success");
        } else {
            // CREATE MODE: New document di Cloudflare D1
            const customDocID = `${selectedStudentNIS}_${Date.now()}`;
            const newData = {
                id: customDocID,
                student_nis: selectedStudentNIS,
                student_name: document.getElementById('info-name').innerText,
                student_class: document.getElementById('info-class').innerText,
                problem: document.getElementById('input-problem').value,
                bimbingan_type: bimbinganType,
                service_type: serviceType,
                date: dateVal,
                status: statusVal,
                notes: notesVal,
                counselor_name: currentUserName,
                counselor_uid: auth.currentUser?.uid || '',
                follow_up_history: [] // Initialize empty array
            };
            await cfClient.saveBkAction(newData);

            if (typeof window.logAudit === 'function') {
                window.logAudit('CREATE_BK_CASE', customDocID, null, { problem: newData.problem, serviceType: newData.service_type }, `Membuat kasus BK baru: ${newData.student_name}`);
            }

            showToast("Berhasil", "Laporan BK berhasil disimpan ke Cloudflare D1!", "success");
        }

        document.getElementById('input-notes').value = '';

        // Clear cache dan reload
        clearBkSessionCache();
        sessionStorage.removeItem(`session_bk_context_${selectedStudentNIS}`);

        // Jika masih dalam pantauan, reload timeline
        if (editingDocId && statusVal !== 'Selesai') {
            const docData = await cfClient.getBkActionById(editingDocId);
            if (docData) {
                renderFollowUpTimeline(docData.followUpHistory || docData.follow_up_history || []);
            }
        } else {
            // Reset form untuk kasus baru
            document.getElementById('input-problem').value = '';
            document.getElementById('input-status').value = 'Selesai';
            document.getElementById('panel-followup-history')?.classList.add('hidden');
        }

        loadContextData(selectedStudentNIS, true);

        btn.innerHTML = 'Tersimpan!';
        const wasEditing = editingDocId;
        if (statusVal === 'Selesai') editingDocId = null; // Reset edit mode hanya jika selesai

        setTimeout(() => {
            btn.innerHTML = wasEditing && statusVal !== 'Selesai'
                ? '<i class="fa-solid fa-plus mr-2"></i> Tambah Follow-Up'
                : '<i class="fa-solid fa-save mr-2"></i> Simpan Laporan';
            btn.disabled = false;
        }, 1500);

    } catch (e) {
        console.error(e);
        btn.innerHTML = 'Gagal';
        showToast("Gagal Simpan", e.message, "error");
        setTimeout(() => { btn.innerHTML = oldText; btn.disabled = false; }, 1500);
    }
};

// ==========================================
// TAB 3: DATA RIWAYAT (FILTER)
// ==========================================

async function loadClassOptions() {
    const select = document.getElementById('filter-hist-class');
    if (!select) return;

    try {
        let list = [];
        if (typeof window.getActiveClasses === 'function') {
            list = await window.getActiveClasses();
        }

        let classList = (Array.isArray(list) && list.length > 0) ? list : [];

        // Fallback dari studentsCache jika getActiveClasses kosong
        if (classList.length === 0 && studentsCache && studentsCache.length > 0) {
            classList = [...new Set(studentsCache.map(s => s.class).filter(Boolean))];
        }

        if (classList.length > 0) {
            // Extract unique grade levels (X, XI, XII)
            const grades = new Set();
            classList.forEach(c => {
                const grade = c.split('-')[0];
                if (grade) grades.add(grade);
            });

            let html = '<option value="">Semua Kelas</option>';

            // Tambahkan opsi angkatan
            Array.from(grades).sort((a, b) => {
                const order = { 'X': 1, 'XI': 2, 'XII': 3 };
                return (order[a] || 99) - (order[b] || 99);
            }).forEach(g => {
                html += `<option value="ALL-${g}" class="font-bold">📚 Angkatan ${g} (Semua)</option>`;
            });

            // Separator
            html += '<option disabled>───────────</option>';

            // Tambahkan kelas individual
            classList.forEach(c => {
                html += `<option value="${c}">${c}</option>`;
            });
            select.innerHTML = html;
        }
    } catch (e) {
        console.error("[BK] Gagal memuat daftar kelas filter:", e);
    }
}

// ==========================================
// PRESET TANGGAL, PENCARIAN & FILTER RIWAYAT
// ==========================================

window.handleBkPeriodChange = (val) => {
    const customContainer = document.getElementById('custom-date-container');
    if (val === 'custom') {
        if (customContainer) {
            customContainer.classList.remove('hidden');
            customContainer.classList.add('flex');
            document.getElementById('filter-hist-start')?.focus();
        }
        return;
    }

    if (customContainer) {
        customContainer.classList.add('hidden');
        customContainer.classList.remove('flex');
    }
    window.setBkDatePreset(val);
};

window.setBkDatePreset = (preset = 'today') => {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    let start = toDateStr(today);
    let end = toDateStr(today);

    if (preset === 'today') {
        start = end;
    } else if (preset === 'this_month') {
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        start = toDateStr(firstDay);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        end = toDateStr(lastDay);
    } else if (preset === 'this_semester') {
        const year = today.getFullYear();
        const month = today.getMonth(); // 0-indexed (0=Jan, 6=Jul)
        if (month >= 6) { // Semester Ganjil (Juli - Desember)
            start = `${year}-07-01`;
            end = `${year}-12-31`;
        } else { // Semester Genap (Januari - Juni)
            start = `${year}-01-01`;
            end = `${year}-06-30`;
        }
    } else {
        // Fallback default Hari Ini (proteksi kuota D1)
        preset = 'today';
        start = end;
    }

    const startInput = document.getElementById('filter-hist-start');
    const endInput = document.getElementById('filter-hist-end');
    if (startInput) startInput.value = start;
    if (endInput) endInput.value = end;

    const presetSelect = document.getElementById('filter-hist-preset');
    if (presetSelect && presetSelect.value !== preset && preset !== 'custom') {
        presetSelect.value = preset;
    }

    const customContainer = document.getElementById('custom-date-container');
    if (customContainer && preset !== 'custom') {
        customContainer.classList.add('hidden');
        customContainer.classList.remove('flex');
    }

    window.loadBkHistoryFiltered();
};

window.resetBkFilters = () => {
    const searchInput = document.getElementById('filter-hist-search');
    if (searchInput) searchInput.value = '';
    const clearBtn = document.getElementById('btn-clear-search');
    if (clearBtn) clearBtn.classList.add('hidden');

    const classSelect = document.getElementById('filter-hist-class');
    if (classSelect) classSelect.value = '';

    const statusSelect = document.getElementById('filter-hist-status');
    if (statusSelect) statusSelect.value = '';

    const bimbinganSelect = document.getElementById('filter-hist-bimbingan');
    if (bimbinganSelect) bimbinganSelect.value = '';

    const presetSelect = document.getElementById('filter-hist-preset');
    if (presetSelect) presetSelect.value = 'today';

    const customContainer = document.getElementById('custom-date-container');
    if (customContainer) {
        customContainer.classList.add('hidden');
        customContainer.classList.remove('flex');
    }

    window.setBkDatePreset('today');
};

window.applyClientBkSearch = () => {
    const query = (document.getElementById('filter-hist-search')?.value || '').trim().toLowerCase();
    const clearBtn = document.getElementById('btn-clear-search');
    if (clearBtn) {
        if (query) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
    }

    if (!query) {
        renderBkHistoryTable(currentBkHistoryDocs);
        return;
    }

    const filtered = (currentBkHistoryDocs || []).filter(r => {
        const name = (r.studentName || r.student_name || '').toLowerCase();
        const nis = (r.studentNIS || r.student_nis || '').toLowerCase();
        const sClass = (r.studentClass || r.student_class || '').toLowerCase();
        const problem = (r.problem || '').toLowerCase();
        const counselor = (r.counselorName || r.counselor_name || '').toLowerCase();
        const service = (r.serviceType || r.service_type || '').toLowerCase();
        const bimbingan = (r.bimbinganType || r.bimbingan_type || '').toLowerCase();
        const notes = (r.notes || '').toLowerCase();

        return name.includes(query) ||
            nis.includes(query) ||
            sClass.includes(query) ||
            problem.includes(query) ||
            counselor.includes(query) ||
            service.includes(query) ||
            bimbingan.includes(query) ||
            notes.includes(query);
    });

    renderBkHistoryTable(filtered, true);
};

window.clearBkSearch = () => {
    const searchInput = document.getElementById('filter-hist-search');
    if (searchInput) searchInput.value = '';
    const clearBtn = document.getElementById('btn-clear-search');
    if (clearBtn) clearBtn.classList.add('hidden');
    renderBkHistoryTable(currentBkHistoryDocs);
};

// ==========================================
// RENDER TABEL RIWAYAT KASUS BK (8 KOLOM)
// ==========================================

function renderBkHistoryTable(docs, isSearchResult = false) {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;

    if (!docs || docs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="p-12 text-center text-slate-400 dark:text-slate-500">
                    <div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3 text-slate-400">
                        <i class="fa-regular fa-folder-open text-xl"></i>
                    </div>
                    <p class="font-bold text-slate-700 dark:text-slate-200 text-sm mb-1">
                        ${isSearchResult ? 'Tidak ada data yang cocok dengan pencarian' : 'Tidak ada riwayat kasus konseling'}
                    </p>
                    <p class="text-xs text-slate-400 dark:text-slate-500 max-w-sm mx-auto mb-3 leading-relaxed">
                        ${isSearchResult ? 'Coba periksa kembali ejaan nama siswa, NIS, atau kata kunci permasalahan yang Anda cari.' : 'Belum ada catatan riwayat konseling pada filter & rentang waktu yang dipilih.'}
                    </p>
                    ${isSearchResult
                        ? `<button type="button" onclick="window.clearBkSearch()" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 transition-all"><i class="fa-solid fa-times mr-1.5"></i>Bersihkan Pencarian</button>`
                        : `<button type="button" onclick="window.resetBkFilters()" class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 transition-all"><i class="fa-solid fa-rotate-left mr-1.5"></i>Reset ke Default</button>`
                    }
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    docs.forEach((r, idx) => {
        const no = idx + 1;
        const dateStr = r.date ? new Date(r.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

        const sNis = r.studentNIS || r.student_nis || '';
        const sName = r.studentName || r.student_name || 'Tanpa Nama';
        let sClass = r.studentClass || r.student_class || '';
        let sPhoto = null;
        if (studentsCache && studentsCache.length > 0) {
            const st = studentsCache.find(s => (sNis && s.nis === sNis) || s.name === sName);
            if (st) {
                if (!sClass) sClass = st.class || '';
                sPhoto = st.activePhotoUrl || null;
            }
        }
        const avatarHtml = renderStudentBkAvatar(sPhoto, sName, { size: 'sm', clickable: true });

        const bType = r.bimbinganType || r.bimbingan_type || 'Pribadi';
        const sType = r.serviceType || r.service_type || 'Konseling';
        const cName = r.counselorName || r.counselor_name || '-';

        // Bidang Badge Theme
        let bTheme = 'bg-slate-100 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600';
        if (bType === 'Pribadi') {
            bTheme = 'bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/60';
        } else if (bType === 'Sosial') {
            bTheme = 'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/60';
        } else if (bType === 'Belajar') {
            bTheme = 'bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60';
        } else if (bType === 'Karir') {
            bTheme = 'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60';
        }

        // Status Badge Theme
        let statusBadge = '';
        if (r.status === 'Selesai') {
            statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/50"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Selesai</span>`;
        } else if (r.status === 'Dalam Pantauan') {
            statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/50"><span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>Pantau</span>`;
        } else {
            statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border border-rose-200/60 dark:border-rose-800/50"><span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>${window.escapeHTML(r.status || 'Tindak Lanjut')}</span>`;
        }

        const safeProblem = window.escapeHTML(r.problem || '-');
        const safeName = window.escapeHTML(sName);
        const safeClass = window.escapeHTML(sClass || '-');
        const safeNis = window.escapeHTML(sNis || '-');

        html += `
        <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-700/30 border-b border-slate-100 dark:border-slate-700/50 last:border-0 transition-colors">
            <td class="p-3.5 text-center text-xs font-mono text-slate-400 dark:text-slate-500 font-semibold">${no}</td>
            <td class="p-3.5 text-slate-600 dark:text-slate-300 font-mono text-xs whitespace-nowrap">${dateStr}</td>
            <td class="p-3.5">
                <div class="flex items-center gap-2.5 min-w-0">
                    ${avatarHtml}
                    <div class="min-w-0 flex-1">
                        <div class="font-bold text-slate-800 dark:text-slate-100 leading-snug truncate">${safeName}</div>
                        <div class="flex items-center gap-1.5 mt-1">
                            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800/50">${safeClass}</span>
                            <span class="font-mono text-[10px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700/50 px-1.5 py-0.5 rounded">${safeNis}</span>
                        </div>
                    </div>
                </div>
            </td>
            <td class="p-3.5">
                <span class="inline-block px-2 py-0.5 rounded-lg text-[10px] font-bold border ${bTheme} mb-1">${window.escapeHTML(bType)}</span>
                <div class="text-xs font-medium text-slate-600 dark:text-slate-300">${window.escapeHTML(sType)}</div>
            </td>
            <td class="p-3.5 max-w-[260px]">
                <div class="text-xs text-slate-700 dark:text-slate-300 font-medium line-clamp-2 leading-relaxed" title="${safeProblem}">
                    ${safeProblem}
                </div>
            </td>
            <td class="p-3.5 whitespace-nowrap text-xs text-slate-600 dark:text-slate-400">
                <div class="flex items-center gap-1.5">
                    <i class="fa-solid fa-user-tie text-[11px] text-slate-400 dark:text-slate-500"></i>
                    <span class="font-medium">${window.escapeHTML(cName)}</span>
                </div>
            </td>
            <td class="p-3.5 text-center whitespace-nowrap">${statusBadge}</td>
            <td class="p-3.5 text-center whitespace-nowrap">
                <div class="flex items-center justify-center gap-1">
                    <button type="button" onclick="window.viewBkDetail('${r.id}')"
                        title="Lihat Detail Kasus"
                        class="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800/50 flex items-center justify-center transition-colors">
                        <i class="fa-solid fa-eye text-xs"></i>
                    </button>
                    ${isKepsekOnly ? '' : `
                    <button type="button" onclick="window.editBkAction('${r.id}')"
                        title="Edit / Tindak Lanjut"
                        class="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-800/50 flex items-center justify-center transition-colors">
                        <i class="fa-solid fa-pen-to-square text-xs"></i>
                    </button>
                    <button type="button" onclick="window.deleteBkAction('${r.id}')"
                        title="Hapus Kasus"
                        class="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-800/50 flex items-center justify-center transition-colors">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                    `}
                </div>
            </td>
        </tr>`;
    });

    tbody.innerHTML = html;
}

// ==========================================
// LOAD RIWAYAT TERFILTER DARI CLOUDFLARE D1
// ==========================================

window.loadBkHistoryFiltered = async () => {
    const classVal = document.getElementById('filter-hist-class')?.value || '';
    const statusVal = document.getElementById('filter-hist-status')?.value || '';
    const bimbinganVal = document.getElementById('filter-hist-bimbingan')?.value || '';
    const startVal = document.getElementById('filter-hist-start')?.value;
    const endVal = document.getElementById('filter-hist-end')?.value;
    const tbody = document.getElementById('history-table-body');
    const badgeEl = document.getElementById('hist-summary-badge');
    const countTotalEl = document.getElementById('hist-total-count');
    const countSelesaiEl = document.getElementById('hist-selesai-count');
    const countPantauEl = document.getElementById('hist-pantau-count');

    if (!startVal || !endVal) {
        showToast("Peringatan", "Pilih rentang tanggal terlebih dahulu!", "warning");
        return;
    }

    window.bkHistoryLoaded = true;
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="p-12 text-center text-blue-500 dark:text-blue-400">
                    <i class="fa-solid fa-spinner fa-spin text-3xl mb-2.5"></i>
                    <div class="text-xs font-semibold">Memuat riwayat konseling dari Cloudflare D1...</div>
                </td>
            </tr>`;
    }

    try {
        // Fetch riwayat BK dari Cloudflare D1 (0 Firestore Read)
        let docs = await cfClient.getBkActions({
            student_class: (classVal && !classVal.startsWith('ALL-')) ? classVal : undefined,
            status: (statusVal && statusVal !== 'Semua' && statusVal !== 'ALL') ? statusVal : undefined,
            bimbingan_type: (bimbinganVal && bimbinganVal !== 'Semua' && bimbinganVal !== 'ALL') ? bimbinganVal : undefined,
            date_start: startVal,
            date_end: endVal,
            limit: 500
        });

        docs = Array.isArray(docs) ? docs : [];

        // Filter client-side untuk angkatan atau fallback kelas dari cache siswa
        if (classVal) {
            if (classVal.startsWith('ALL-')) {
                const grade = classVal.replace('ALL-', '');
                docs = docs.filter(r => {
                    let c = r.studentClass || r.student_class || '';
                    if (!c && (r.studentNIS || r.student_nis) && studentsCache && studentsCache.length > 0) {
                        const st = studentsCache.find(s => s.nis === (r.studentNIS || r.student_nis));
                        if (st) c = st.class || '';
                    }
                    return c.startsWith(grade + '-') || c === grade;
                });
            } else {
                docs = docs.filter(r => {
                    let c = r.studentClass || r.student_class || '';
                    if (!c && (r.studentNIS || r.student_nis) && studentsCache && studentsCache.length > 0) {
                        const st = studentsCache.find(s => s.nis === (r.studentNIS || r.student_nis));
                        if (st) c = st.class || '';
                    }
                    return c === classVal;
                });
            }
        }

        // Filter client-side untuk bidang bimbingan jika API belum filter
        if (bimbinganVal && bimbinganVal !== 'Semua' && bimbinganVal !== 'ALL') {
            docs = docs.filter(r => (r.bimbinganType || r.bimbingan_type) === bimbinganVal);
        }

        // Simpan ke state global untuk pencarian instan dan ekspor Excel
        currentBkHistoryDocs = docs;

        // Hitung metrik ringkasan
        const total = docs.length;
        const selesai = docs.filter(r => r.status === 'Selesai').length;
        const pantauan = docs.filter(r => r.status !== 'Selesai').length;

        if (countTotalEl) countTotalEl.innerText = total;
        if (countSelesaiEl) countSelesaiEl.innerText = selesai;
        if (countPantauEl) countPantauEl.innerText = pantauan;
        if (badgeEl) badgeEl.classList.remove('hidden');

        // Terapkan filter pencarian teks jika input search sedang terisi
        const activeSearch = (document.getElementById('filter-hist-search')?.value || '').trim();
        if (activeSearch) {
            window.applyClientBkSearch();
        } else {
            renderBkHistoryTable(docs);
        }

    } catch (e) {
        console.error("[BK] Gagal memuat data riwayat:", e);
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="p-8 text-center text-red-500">
                        <i class="fa-solid fa-triangle-exclamation text-2xl mb-1.5 block"></i>
                        <span class="text-xs font-semibold">Gagal memuat data riwayat: ${window.escapeHTML(e.message || 'Terjadi kesalahan sistem')}</span>
                    </td>
                </tr>`;
        }
    }
};

// ==========================================
// QUICK-VIEW DETAIL MODAL KASUS BK
// ==========================================

window.viewBkDetail = async (docId) => {
    try {
        let r = (currentBkHistoryDocs || []).find(d => d.id === docId);
        if (!r) {
            r = await cfClient.getBkActionById(docId);
        }
        if (!r) {
            showToast("Error", "Detail data kasus tidak ditemukan.", "error");
            return;
        }

        const sNis = r.studentNIS || r.student_nis || '-';
        const sName = r.studentName || r.student_name || '-';
        let sClass = r.studentClass || r.student_class || '-';
        let sPhoto = null;
        if (studentsCache && studentsCache.length > 0) {
            const st = studentsCache.find(s => (sNis !== '-' && s.nis === sNis) || s.name === sName);
            if (st) {
                if (!sClass || sClass === '-') sClass = st.class || '-';
                sPhoto = st.activePhotoUrl || null;
            }
        }

        const dateStr = r.date ? new Date(r.date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '-';
        const bType = r.bimbinganType || r.bimbingan_type || 'Pribadi';
        const sType = r.serviceType || r.service_type || 'Konseling Individu';
        const cName = r.counselorName || r.counselor_name || '-';

        document.getElementById('detail-bk-id').innerText = `ID: ${r.id || '-'}`;
        document.getElementById('detail-bk-name').innerText = sName;
        document.getElementById('detail-bk-class').innerText = sClass;
        document.getElementById('detail-bk-nis').innerText = sNis;
        document.getElementById('detail-bk-date').innerText = dateStr;
        document.getElementById('detail-bk-layanan').innerText = `${bType} • ${sType}`;
        document.getElementById('detail-bk-problem').innerText = r.problem || 'Tidak ada keterangan.';
        document.getElementById('detail-bk-notes').innerText = r.notes || 'Belum ada catatan hasil atau tindak lanjut.';
        document.getElementById('detail-bk-counselor').innerText = cName;

        // Render Avatar pada Modal Detail
        const avatarSlot = document.getElementById('detail-bk-avatar-slot');
        if (avatarSlot) {
            avatarSlot.innerHTML = renderStudentBkAvatar(sPhoto, sName, { size: 'lg', clickable: false });
            avatarSlot.onclick = () => {
                window.openStudentPhotoPreview(sNis, sName, sClass, sPhoto);
            };
        }

        // Status Badge di Modal
        const statusBadgeEl = document.getElementById('detail-bk-status-badge');
        if (statusBadgeEl) {
            if (r.status === 'Selesai') {
                statusBadgeEl.innerHTML = `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60"><span class="w-2 h-2 rounded-full bg-emerald-500"></span>Selesai</span>`;
            } else if (r.status === 'Dalam Pantauan') {
                statusBadgeEl.innerHTML = `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200/60"><span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>Dalam Pantauan</span>`;
            } else {
                statusBadgeEl.innerHTML = `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border border-rose-200/60"><span class="w-2 h-2 rounded-full bg-rose-500"></span>${window.escapeHTML(r.status || 'Tindak Lanjut')}</span>`;
            }
        }

        // Timeline Riwayat Follow-Up
        const timelineSect = document.getElementById('detail-bk-timeline-section');
        const timelineCont = document.getElementById('detail-bk-timeline-container');
        const history = r.followUpHistory || r.follow_up_history || [];

        if (Array.isArray(history) && history.length > 0) {
            let tHtml = '';
            history.forEach((h, i) => {
                const hDate = h.date ? new Date(h.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
                tHtml += `
                <div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/70 dark:border-slate-700/60 text-xs">
                    <div class="flex justify-between items-center mb-1">
                        <span class="font-bold text-blue-600 dark:text-blue-400">#${i + 1} ${window.escapeHTML(h.serviceType || 'Tindak Lanjut')}</span>
                        <span class="text-[11px] font-mono text-slate-400 dark:text-slate-500">${hDate}</span>
                    </div>
                    <div class="text-slate-600 dark:text-slate-300 text-xs leading-relaxed whitespace-pre-wrap">${window.escapeHTML(h.notes || '-')}</div>
                    ${h.counselorName ? `<div class="text-[10px] text-slate-400 dark:text-slate-500 mt-1 italic"><i class="fa-solid fa-user-tie mr-1"></i>${window.escapeHTML(h.counselorName)}</div>` : ''}
                </div>`;
            });
            timelineCont.innerHTML = tHtml;
            timelineSect.classList.remove('hidden');
        } else {
            timelineSect.classList.add('hidden');
        }

        // Action Buttons di Modal Detail
        const actBtns = document.getElementById('detail-bk-action-btns');
        if (actBtns) {
            if (isKepsekOnly) {
                actBtns.innerHTML = '';
            } else {
                actBtns.innerHTML = `
                <button type="button" onclick="document.getElementById('modal-detail-bk').classList.add('hidden'); window.editBkAction('${r.id}')"
                    class="px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20 flex items-center gap-1.5 transition-all active:scale-95">
                    <i class="fa-solid fa-pen-to-square"></i>
                    <span>Edit / Lanjutkan Kasus</span>
                </button>`;
            }
        }

        document.getElementById('modal-detail-bk').classList.remove('hidden');
    } catch (e) {
        console.error("[BK] Error viewing detail:", e);
        showToast("Error", "Gagal memuat detail kasus konseling.", "error");
    }
};

// ==========================================
// EXPORT EXCEL RIWAYAT KASUS BK (SHEETJS)
// ==========================================

window.exportBkHistoryToExcel = () => {
    if (!window.XLSX) {
        showToast("Peringatan", "Pustaka Excel sedang dimuat, silakan coba sesaat lagi.", "warning");
        return;
    }
    if (!currentBkHistoryDocs || currentBkHistoryDocs.length === 0) {
        showToast("Peringatan", "Tidak ada data riwayat yang dapat diekspor.", "warning");
        return;
    }

    try {
        const rows = currentBkHistoryDocs.map((r, idx) => {
            const sNis = r.studentNIS || r.student_nis || '-';
            const sName = r.studentName || r.student_name || '-';
            let sClass = r.studentClass || r.student_class || '-';
            if ((!sClass || sClass === '-') && sNis !== '-' && studentsCache && studentsCache.length > 0) {
                const st = studentsCache.find(s => s.nis === sNis);
                if (st && st.class) sClass = st.class;
            }

            return {
                "No": idx + 1,
                "Tanggal": r.date || '-',
                "NIS": sNis,
                "Nama Siswa": sName,
                "Kelas": sClass,
                "Bidang Bimbingan": r.bimbinganType || r.bimbingan_type || 'Pribadi',
                "Jenis Layanan": r.serviceType || r.service_type || 'Konseling',
                "Permasalahan / Kasus": r.problem || '-',
                "Catatan / Hasil Tindak Lanjut": r.notes || '-',
                "Guru Konselor": r.counselorName || r.counselor_name || '-',
                "Status": r.status || '-'
            };
        });

        const ws = window.XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [
            { wch: 6 },  // No
            { wch: 14 }, // Tanggal
            { wch: 14 }, // NIS
            { wch: 28 }, // Nama Siswa
            { wch: 14 }, // Kelas
            { wch: 18 }, // Bidang
            { wch: 24 }, // Layanan
            { wch: 38 }, // Kasus
            { wch: 38 }, // Catatan
            { wch: 24 }, // Konselor
            { wch: 16 }  // Status
        ];

        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, "Riwayat_BK");

        const classFilter = document.getElementById('filter-hist-class')?.value || 'Semua_Kelas';
        const todayStr = new Date().toISOString().split('T')[0];
        const filename = `Riwayat_Konseling_BK_${classFilter}_${todayStr}.xlsx`;

        window.XLSX.writeFile(wb, filename);
        showToast("Sukses", `Berhasil mengekspor ${rows.length} riwayat kasus ke Excel!`, "success");
    } catch (e) {
        console.error("[BK] Export Excel Error:", e);
        showToast("Error", "Gagal mengekspor data ke Excel.", "error");
    }
};

// ==========================================
// EDIT & DELETE FUNCTIONS
// ==========================================

window.editBkAction = async (docId) => {
    try {
        const r = await cfClient.getBkActionById(docId);
        if (!r) {
            showToast("Error", "Data tidak ditemukan.", "error");
            return;
        }

        const sNis = r.studentNIS || r.student_nis || '';
        const sName = r.studentName || r.student_name || '';
        const sClass = r.studentClass || r.student_class || '';

        // Set edit mode
        editingDocId = docId;
        selectedStudentNIS = sNis;

        // Fill student profile bar
        document.getElementById('info-name').innerText = sName || '-';
        document.getElementById('info-class').innerText = sClass || '-';
        document.getElementById('info-nis').innerText = sNis || '-';
        document.getElementById('info-points').innerText = '-';

        // Fill form - Jika status masih "Dalam Pantauan", kosongkan untuk follow-up
        document.getElementById('input-problem').value = r.problem || '';

        if (r.status === 'Dalam Pantauan') {
            // Mode Follow-Up: kosongkan untuk input baru
            document.getElementById('input-service-type').value = 'Konseling Individu';
            document.getElementById('input-bimbingan-type').value = r.bimbinganType || r.bimbingan_type || 'Pribadi';
            document.getElementById('input-date').valueAsDate = new Date();
            document.getElementById('input-notes').value = '';
            document.getElementById('btn-save-bk').innerHTML = '<i class="fa-solid fa-plus mr-2"></i> Tambah Follow-Up';
        } else {
            // Mode Edit biasa
            document.getElementById('input-service-type').value = r.serviceType || r.service_type || 'Konseling Individu';
            document.getElementById('input-bimbingan-type').value = r.bimbinganType || r.bimbingan_type || 'Pribadi';
            document.getElementById('input-date').value = r.date || '';
            document.getElementById('input-notes').value = r.notes || '';
            document.getElementById('btn-save-bk').innerHTML = '<i class="fa-solid fa-pen mr-2"></i> Update Laporan';
        }
        document.getElementById('input-status').value = r.status || 'Selesai';

        // Show workspace
        document.getElementById('workspace-placeholder').classList.add('hidden');
        document.getElementById('workspace-bk').classList.remove('hidden');
        document.getElementById('student-profile').classList.remove('hidden');
        const searchInput = document.getElementById('student-search');
        if (searchInput) searchInput.value = `${sName} (${sClass})`;
        const clearBtn = document.getElementById('btn-clear-student-search');
        if (clearBtn) clearBtn.classList.remove('hidden');

        // Render Follow-Up Timeline
        renderFollowUpTimeline(r.followUpHistory || r.follow_up_history || []);

        // Load context data for this student
        loadContextData(sNis);

        // Switch to Input tab
        switchBkTab('input');

        window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (e) {
        console.error("Edit Error:", e);
        showToast("Error", "Gagal memuat data untuk diedit.", "error");
    }
};

window.deleteBkAction = async (docId) => {
    // Modern Confirm Dialog (Promise-based)
    const confirmed = await new Promise((resolve) => {
        const modal = document.getElementById('modal-confirm-delete');
        if (!modal) {
            if (typeof window.showConfirmModal === 'function') {
                return resolve(window.showConfirmModal("Yakin ingin menghapus data ini? Aksi ini tidak dapat dibatalkan.", "Konfirmasi Hapus", "danger"));
            }
            resolve(false);
            return;
        }

        const titleEl = document.getElementById('confirm-delete-title');
        const msgEl = document.getElementById('confirm-delete-msg');
        const btnOk = document.getElementById('btn-confirm-delete-ok');
        const btnCancel = document.getElementById('btn-confirm-delete-cancel');

        if (titleEl) titleEl.innerText = 'Konfirmasi Hapus';
        if (msgEl) msgEl.innerHTML = 'Yakin ingin menghapus data ini?<br><small class="text-red-500">Aksi ini tidak dapat dibatalkan.</small>';
        modal.classList.remove('hidden');

        // Cleanup previous listeners
        const newBtnOk = btnOk.cloneNode(true);
        const newBtnCancel = btnCancel.cloneNode(true);
        btnOk.parentNode.replaceChild(newBtnOk, btnOk);
        btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);

        newBtnOk.addEventListener('click', () => {
            modal.classList.add('hidden');
            resolve(true);
        });

        newBtnCancel.addEventListener('click', () => {
            modal.classList.add('hidden');
            resolve(false);
        });
    });

    if (!confirmed) return;

    try {
        let oldData = null;
        try {
            oldData = await cfClient.getBkActionById(docId);
        } catch (e) { }

        await cfClient.deleteBkAction(docId);

        if (typeof window.logAudit === 'function') {
            window.logAudit('DELETE_BK_CASE', docId, oldData, null, `Menghapus kasus BK: ${oldData ? (oldData.studentName || oldData.student_name) : docId}`);
        }

        showToast("Berhasil", "Data berhasil dihapus dari Cloudflare D1.", "success");
        // BK-4 FIX: Clear session cache agar dashboard & context ter-update
        clearBkSessionCache();
        // Refresh table
        window.loadBkHistoryFiltered();
    } catch (e) {
        console.error("Delete Error:", e);
        showToast("Error", "Gagal menghapus data.", "error");
    }
};


