/**
 * SIMAS SMAGESA - Controller Panel Admin Buku Kenangan (Yearbook) Kelas XII
 * Berkas: js/page-yearbook-admin.js
 * Standar: SSOT, Zero Bloat, 0 Firestore Read, Responsive & Print-Engine Ready
 *
 * Alur kerja kesiswaan / wali kelas:
 *   Monitoring kelengkapan → salin daftar pengingat → moderasi pesan → cetak Master PDF A4
 *   → unggah PDF ke R2/Drive → publikasikan ke rak arsip alumni.
 */

import { auth } from './config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { initLayout } from './global.js';
import { SCHOOL_CONFIG } from './school-config.js';
import cfClient from './cloudflare-client.js';

let _adminActiveTab = 'monitoring';
let _adminClasses = [];
let _allStudents = [];
let _filteredStudents = [];
let _allMessages = [];
let _filteredMessages = [];
let _archivesList = [];
let _isLoading = false;
let _academicYear = '';
let _printStudents = [];
let _printClass = '';

const SCHOOL_NAME = SCHOOL_CONFIG?.schoolName || "SMA Negeri Nusantara";
const SCHOOL_SHORT = SCHOOL_CONFIG?.schoolShortName || "SMANTARA";
const SCHOOL_VISI = SCHOOL_CONFIG?.schoolVisiAcronym || "CERDAS";
const SCHOOL_MOTTO = "Terwujudnya Peserta Didik yang CERDAS (Sehat, Humanis, Agamais, Kreatif, Terampil, Inovatif) Berwawasan Lingkungan.";

// Helper: Escape Karakter HTML anti-XSS
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Worker menyimpan pesan dengan < > yang sudah di-escape; kembalikan dulu agar tidak ter-escape dua kali.
function decodeStoredText(str) {
    return String(str || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function toTitleCase(name) {
    return String(name || '').toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}

function getInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function isSafeHttpUrl(url) {
    return /^https?:\/\//i.test(String(url || '').trim());
}

function getDefaultAcademicYear() {
    const now = new Date();
    const yr = now.getFullYear();
    return now.getMonth() + 1 >= 7 ? `${yr}/${yr + 1}` : `${yr - 1}/${yr}`;
}

function getGraduationYear(academicYear) {
    const match = String(academicYear || '').match(/^\d{4}\/(\d{4})$/);
    return match ? match[1] : String(new Date().getFullYear());
}

function profileChecklist(st) {
    return {
        quote: Boolean(String(st.quote || '').trim()),
        casual: Boolean(st.casual_photo_url),
        ambition: Boolean(String(st.ambition || st.dream_campus || '').trim())
    };
}

function isComplete(st) {
    const c = profileChecklist(st);
    return c.quote && c.casual;
}

function isPublished(st) {
    return Number(st.is_published) !== 0;
}

// Helper: Toast Notifikasi
function showAdminToast(title, message, type = 'info') {
    if (typeof window.showToast === 'function') {
        window.showToast(title, message, type);
        return;
    }
    const colors = {
        success: 'bg-emerald-600',
        error: 'bg-rose-600',
        warning: 'bg-amber-600',
        info: 'bg-slate-900'
    };
    const toast = document.createElement('div');
    toast.className = `fixed bottom-5 right-5 z-[9999] px-4 py-3 rounded-2xl text-white text-xs font-bold shadow-xl transition-all duration-300 flex items-center gap-2 ${colors[type] || colors.info}`;
    toast.innerHTML = `<span>${escapeHTML(title)}: ${escapeHTML(message)}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// Helper: Resolusi URL Foto
function resolveYearbookPhoto(url) {
    if (!url) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    const workerUrl = (typeof window !== 'undefined' && window.CLOUDFLARE_CONFIG?.WORKER_URL)
        ? window.CLOUDFLARE_CONFIG.WORKER_URL
        : "https://simas-demo-api.komangpurna1.workers.dev";
    return `${workerUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
}

function setSyncIndicator(state) {
    const text = document.getElementById('admin-cache-text');
    const dot = document.getElementById('admin-cache-dot');
    const map = {
        loading: ['Memuat...', 'text-amber-400 animate-pulse'],
        ready: ['Tersinkronisasi', 'text-emerald-500'],
        error: ['Gagal sinkron', 'text-rose-500']
    };
    const [label, color] = map[state] || map.ready;
    if (text) text.textContent = label;
    if (dot) dot.className = `fa-solid fa-circle text-[7px] ${color}`;
}

// =========================================================================
// 1. INISIALISASI
// =========================================================================
async function initAdminYearbookPage() {
    try {
        setSyncIndicator('loading');
        setAcademicYear(_academicYear || getDefaultAcademicYear());

        cfClient.getYearbookSummary()
            .then(summary => { if (summary?.academic_year) setAcademicYear(summary.academic_year); })
            .catch(() => {});

        // 1. Ambil daftar kelas XII aktif
        _adminClasses = await cfClient.getYearbookClasses();
        populateAdminDropdowns(_adminClasses);

        // 2. Ambil data seluruh siswa kelas XII
        await loadAllYearbookStudents();

        // 3. Ambil seluruh pesan kenangan untuk moderasi
        loadAdminMessages();

        // 4. Ambil katalog arsip
        loadAdminArchives();

        setSyncIndicator('ready');
    } catch (err) {
        console.error('[Yearbook Admin] Init error:', err);
        setSyncIndicator('error');
        showAdminToast('Kesalahan', 'Gagal memuat data admin yearbook: ' + err.message, 'error');
    }
}

function setAcademicYear(academicYear) {
    _academicYear = academicYear;
    const badge = document.getElementById('admin-class-of-badge');
    if (badge) badge.textContent = `Class of ${getGraduationYear(academicYear)} · TA ${academicYear}`;
}

// 2. Mengisi Dropdown Rombel
function populateAdminDropdowns(classes) {
    const filterClass = document.getElementById('filter-admin-class');
    const printClass = document.getElementById('print-class-select');

    if (!classes || classes.length === 0) {
        if (filterClass) filterClass.innerHTML = '<option value="all">Semua Rombel XII</option>';
        if (printClass) printClass.innerHTML = '<option value="">Tidak ada kelas XII</option>';
        return;
    }

    const options = classes.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
    const currentFilter = filterClass?.value || 'all';
    const currentPrint = printClass?.value || '';
    if (filterClass) {
        filterClass.innerHTML = '<option value="all">Semua Rombel XII</option>' + options;
        filterClass.value = classes.includes(currentFilter) ? currentFilter : 'all';
    }
    if (printClass) {
        printClass.innerHTML = '<option value="">Pilih Rombel Cetak...</option>' + options;
        printClass.value = classes.includes(currentPrint) ? currentPrint : '';
    }
}

// 3. Memuat Seluruh Siswa Rombel XII
async function loadAllYearbookStudents() {
    if (_isLoading) return;
    _isLoading = true;

    try {
        if (_adminClasses.length === 0) {
            _allStudents = [];
            _filteredStudents = [];
            renderAdminStudentsTable([]);
            updateAdminStats([]);
            renderClassProgress([]);
            return;
        }

        // Fetch seluruh rombel secara paralel
        const classResults = await Promise.all(_adminClasses.map(c => cfClient.getYearbookClass(c)));
        _allStudents = classResults.flat();
        _filteredStudents = [..._allStudents];

        updateAdminStats(_allStudents);
        renderClassProgress(_allStudents);
        filterAdminStudents();

    } catch (err) {
        console.error('[Yearbook Admin] Load students error:', err);
        showAdminToast('Kesalahan', 'Gagal memuat daftar siswa: ' + err.message, 'error');
    } finally {
        _isLoading = false;
    }
}

// 4. Update Kartu Statistik
function updateAdminStats(students) {
    const total = students.length;
    const complete = students.filter(isComplete).length;
    const hidden = students.filter(s => !isPublished(s)).length;
    const totalMsgs = students.reduce((acc, s) => acc + (s.messages || []).length, 0);
    const pending = total - complete;
    const pct = total > 0 ? Math.round((complete / total) * 100) : 0;

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    setText('stat-total-students', total);
    setText('stat-hidden-students', `${hidden} disembunyikan dari publik`);
    setText('stat-complete-students', complete);
    setText('stat-complete-pct', `${pct}% Partisipasi`);
    setText('stat-pending-students', pending);
    setText('stat-total-messages', totalMsgs);

    const bar = document.getElementById('stat-complete-bar');
    if (bar) bar.style.width = `${pct}%`;
}

function renderClassProgress(students) {
    const container = document.getElementById('admin-class-progress');
    if (!container) return;
    if (!_adminClasses.length) {
        container.innerHTML = '<div class="text-xs text-slate-400">Belum ada rombel Kelas XII aktif.</div>';
        return;
    }

    container.innerHTML = _adminClasses.map(c => {
        const list = students.filter(s => s.class === c);
        const done = list.filter(isComplete).length;
        const pct = list.length ? Math.round((done / list.length) * 100) : 0;
        const tone = pct >= 80 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-rose-500';
        return `
            <button type="button" data-class="${escapeHTML(c)}" onclick="window.focusAdminClass(this.dataset.class)"
                class="text-left group rounded-xl px-2 py-1.5 -mx-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
                <div class="flex items-center justify-between text-xs mb-1">
                    <span class="font-bold text-slate-800 dark:text-slate-100 group-hover:text-amber-600">${escapeHTML(c)}</span>
                    <span class="text-slate-500 dark:text-slate-400 font-medium tabular-nums">${done}/${list.length} &middot; ${pct}%</span>
                </div>
                <div class="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div class="h-full rounded-full ${tone} transition-all duration-700" style="width:${pct}%"></div>
                </div>
            </button>
        `;
    }).join('');
}

window.focusAdminClass = function(className) {
    const sel = document.getElementById('filter-admin-class');
    if (sel) sel.value = className;
    window.filterAdminStudents();
    document.getElementById('table-admin-students-body')?.closest('.overflow-hidden')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// 5. Filter Siswa di Tabel Monitoring
window.filterAdminStudents = function() {
    const selectedClass = document.getElementById('filter-admin-class')?.value || 'all';
    const selectedStatus = document.getElementById('filter-admin-status')?.value || 'all';
    const searchQuery = (document.getElementById('filter-admin-search')?.value || '').toLowerCase().trim();

    _filteredStudents = _allStudents.filter(st => {
        if (selectedClass !== 'all' && st.class !== selectedClass) return false;

        const complete = isComplete(st);
        if (selectedStatus === 'complete' && !complete) return false;
        if (selectedStatus === 'incomplete' && complete) return false;
        if (selectedStatus === 'hidden' && isPublished(st)) return false;

        if (searchQuery) {
            const haystack = [st.name, st.nis, st.ambition, st.dream_campus].map(v => String(v || '').toLowerCase());
            if (!haystack.some(v => v.includes(searchQuery))) return false;
        }

        return true;
    });

    renderAdminStudentsTable(_filteredStudents);
};

// 6. Render Tabel Siswa Monitoring
function renderAdminStudentsTable(students) {
    const tbody = document.getElementById('table-admin-students-body');
    if (!tbody) return;

    if (!students || students.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="p-8 text-center text-slate-400">
                    <i class="fa-solid fa-user-slash text-2xl mb-1 text-slate-300"></i>
                    <p class="text-xs">Tidak ada data siswa yang cocok dengan filter.</p>
                </td>
            </tr>
        `;
        return;
    }

    const checkIcon = (ok, label) => `
        <span title="${label}: ${ok ? 'sudah' : 'belum'}"
            class="w-6 h-6 rounded-full inline-flex items-center justify-center text-[10px] ${ok ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'}">
            <i class="fa-solid ${label === 'Quote' ? 'fa-quote-left' : label === 'Foto santai' ? 'fa-camera-retro' : 'fa-briefcase'}"></i>
        </span>`;

    tbody.innerHTML = students.map((st, idx) => {
        const formalPhoto = resolveYearbookPhoto(st.formal_photo_url);
        const casualPhoto = resolveYearbookPhoto(st.casual_photo_url);
        const thumb = casualPhoto || formalPhoto;
        const published = isPublished(st);
        const msgCount = (st.messages || []).length;
        const quote = st.quote || '';
        const ambition = [st.ambition, st.dream_campus].filter(Boolean).join(' · ');
        const check = profileChecklist(st);

        return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition ${published ? '' : 'opacity-60'}">
                <td class="p-3 text-center text-slate-400 font-mono text-[11px]">${idx + 1}</td>
                <td class="p-3">
                    <div class="flex items-center gap-3 min-w-[200px]">
                        <div class="w-9 h-11 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center shrink-0 text-[11px] font-bold text-amber-700">
                            ${thumb
                                ? `<img src="${escapeHTML(thumb)}" alt="" class="w-full h-full object-cover ${casualPhoto ? 'cursor-zoom-in' : ''}" loading="lazy" ${casualPhoto ? `onclick="window.open('${escapeHTML(casualPhoto)}', '_blank', 'noopener')"` : ''}>`
                                : escapeHTML(getInitials(st.name))}
                        </div>
                        <div class="min-w-0">
                            <div class="font-bold text-slate-900 dark:text-white leading-tight">${escapeHTML(toTitleCase(st.name))}</div>
                            <div class="text-[10px] text-slate-400 font-mono mt-0.5">NIS ${escapeHTML(st.nis)}</div>
                        </div>
                    </div>
                </td>
                <td class="p-3">
                    <span class="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-bold whitespace-nowrap">${escapeHTML(st.class)}</span>
                </td>
                <td class="p-3 max-w-[240px]">
                    ${quote
                        ? `<p class="text-[11px] italic text-slate-600 dark:text-slate-300 line-clamp-2 font-serif-heading" title="${escapeHTML(quote)}">&ldquo;${escapeHTML(quote)}&rdquo;</p>`
                        : `<span class="text-[10px] px-2 py-0.5 rounded bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 font-bold">Belum diisi</span>`
                    }
                </td>
                <td class="p-3 max-w-[180px]">
                    ${ambition
                        ? `<span class="text-[11px] text-slate-700 dark:text-slate-300 truncate block font-medium" title="${escapeHTML(ambition)}">${escapeHTML(ambition)}</span>`
                        : `<span class="text-[10px] text-slate-400 italic">-</span>`
                    }
                </td>
                <td class="p-3">
                    <div class="flex items-center justify-center gap-1">
                        ${checkIcon(check.quote, 'Quote')}
                        ${checkIcon(check.casual, 'Foto santai')}
                        ${checkIcon(check.ambition, 'Cita-cita')}
                    </div>
                </td>
                <td class="p-3 text-center">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${msgCount > 0 ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}">
                        ${msgCount} pesan
                    </span>
                </td>
                <td class="p-3 text-center">
                    <button onclick="window.toggleStudentPublishStatus('${escapeHTML(st.nis)}')"
                        title="${published ? 'Sembunyikan dari galeri publik & cetak' : 'Tampilkan kembali di galeri publik'}"
                        class="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 mx-auto whitespace-nowrap ${published ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 hover:bg-emerald-200' : 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 hover:bg-rose-200'}">
                        <i class="fa-solid ${published ? 'fa-eye' : 'fa-eye-slash'}"></i>
                        <span>${published ? 'Publik' : 'Sembunyi'}</span>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// 6b. Salin daftar siswa yang belum lengkap (untuk grup WhatsApp kelas)
window.copyIncompleteStudents = async function() {
    const selectedClass = document.getElementById('filter-admin-class')?.value || 'all';
    const pool = _allStudents.filter(st => isPublished(st) && !isComplete(st) && (selectedClass === 'all' || st.class === selectedClass));
    if (pool.length === 0) {
        showAdminToast('Mantap', 'Semua siswa pada filter ini sudah melengkapi profil.', 'success');
        return;
    }

    const byClass = {};
    pool.forEach(st => { (byClass[st.class] = byClass[st.class] || []).push(st); });

    const lines = [
        `*Pengingat Buku Kenangan Class of ${getGraduationYear(_academicYear)}*`,
        'Yuk lengkapi profil yearbook kalian di Portal Siswa → tab Buku Kenangan (quote kelulusan + foto santai):',
        ''
    ];
    Object.keys(byClass).sort().forEach(c => {
        lines.push(`*${c}*`);
        byClass[c].forEach((st, i) => {
            const check = profileChecklist(st);
            const missing = [!check.quote && 'quote', !check.casual && 'foto santai'].filter(Boolean).join(' & ');
            lines.push(`${i + 1}. ${toTitleCase(st.name)} — belum ${missing}`);
        });
        lines.push('');
    });
    const text = lines.join('\n').trim();

    try {
        await navigator.clipboard.writeText(text);
    } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }
    showAdminToast('Tersalin', `${pool.length} nama siswa disalin — tinggal tempel di grup kelas.`, 'success');
};

// 7. Toggle Publikasi Profil Siswa
window.toggleStudentPublishStatus = async function(nis) {
    if (!nis) return;
    try {
        const res = await cfClient.toggleYearbookPublish(nis);
        if (res && res.success) {
            showAdminToast('Berhasil', res.message, 'success');
            const st = _allStudents.find(s => String(s.nis) === String(nis));
            if (st) st.is_published = res.is_published;
            updateAdminStats(_allStudents);
            filterAdminStudents();
        } else {
            throw new Error(res?.error || 'Gagal mengubah status publikasi.');
        }
    } catch (err) {
        console.error('[Yearbook Admin] Toggle publish error:', err);
        showAdminToast('Gagal', err.message, 'error');
    }
};

// 8. Tab Switching Admin (4 Tab)
window.switchAdminTab = function(tabName) {
    _adminActiveTab = tabName;
    const tabs = ['monitoring', 'print', 'messages', 'archives'];

    tabs.forEach(t => {
        const btn = document.getElementById(`nav-${t}`);
        const sec = document.getElementById(`section-${t}`);
        if (!btn || !sec) return;
        btn.classList.toggle('is-active', t === tabName);
        sec.classList.toggle('hidden', t !== tabName);
    });

    if (tabName === 'messages' && _allMessages.length === 0) {
        loadAdminMessages();
    }
    if (tabName === 'archives' && _archivesList.length === 0) {
        loadAdminArchives();
    }
};

// =========================================================================
// 9. CETAK MASTER PDF A4
// =========================================================================
function getPrintOptions() {
    return {
        perPage: document.getElementById('print-layout-select')?.value === '6' ? 6 : 4,
        includeNotes: document.getElementById('print-opt-notes')?.checked !== false,
        includeClosing: document.getElementById('print-opt-closing')?.checked !== false
    };
}

window.renderAdminPrintPreview = async function(className) {
    const container = document.getElementById('print-preview-container');
    const info = document.getElementById('print-page-info');
    _printClass = className || '';
    if (!className) {
        _printStudents = [];
        if (info) info.textContent = '';
        if (container) {
            container.innerHTML = `
                <div class="text-center py-16 text-slate-400 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <i class="fa-solid fa-book-open text-3xl mb-2 text-slate-300"></i>
                    <p class="text-xs">Silakan pilih rombel di atas untuk memuat pratinjau lembar cetak.</p>
                </div>
            `;
        }
        return;
    }

    if (container) {
        container.innerHTML = `
            <div class="text-center py-16 text-slate-400 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-amber-500"></i>
                <p class="text-xs font-semibold">Menyusun tata letak buku tahunan ${escapeHTML(className)}...</p>
            </div>
        `;
    }

    try {
        const students = await cfClient.getYearbookClass(className);
        if (_printClass !== className) return;
        _printStudents = students || [];
        buildAdminPrintPages(_printStudents, className, container, getPrintOptions());
    } catch (err) {
        console.error('[Yearbook Admin] Render print error:', err);
        if (container) {
            container.innerHTML = `
                <div class="text-center py-16 text-rose-500 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <i class="fa-solid fa-circle-exclamation text-3xl mb-2"></i>
                    <p class="text-xs font-semibold">Gagal memuat pratinjau cetak: ${escapeHTML(err.message)}</p>
                </div>
            `;
        }
    }
};

window.rebuildAdminPrintPreview = function() {
    if (!_printClass) return;
    const container = document.getElementById('print-preview-container');
    buildAdminPrintPages(_printStudents, _printClass, container, getPrintOptions());
};

function buildPrintProfile(st, opts) {
    const formal = resolveYearbookPhoto(st.formal_photo_url);
    const casual = resolveYearbookPhoto(st.casual_photo_url);
    const main = formal || casual;
    const inset = opts.perPage === 4 && formal && casual ? casual : null;
    const quote = String(st.quote || '').trim();
    const meta = [st.ambition, st.dream_campus].filter(Boolean).join(' · ');
    const ig = String(st.social_media?.instagram || '').replace(/^@+/, '').replace(/[^a-zA-Z0-9._]/g, '');
    const song = st.social_media?.spotify || '';
    const note = opts.includeNotes ? (st.messages || [])[0] : null;

    const facts = opts.perPage === 4
        ? [ig && `<b>IG</b> @${escapeHTML(ig)}`, song && `<b>Lagu</b> ${escapeHTML(song)}`].filter(Boolean).join(' &nbsp;·&nbsp; ')
        : (ig ? `@${escapeHTML(ig)}` : '');

    return `
        <div class="ybp-profile">
            <div class="ybp-photo">
                <div class="ybp-initials">${escapeHTML(getInitials(st.name))}</div>
                ${main ? `<img src="${escapeHTML(main)}" alt="" onerror="this.remove()" style="position:relative;">` : ''}
                ${inset ? `<div class="ybp-photo-inset"><img src="${escapeHTML(inset)}" alt="" onerror="this.parentNode.remove()"></div>` : ''}
            </div>
            <div class="ybp-info">
                <h4 class="ybp-name">${escapeHTML(toTitleCase(st.name))}</h4>
                ${meta ? `<div class="ybp-meta">${escapeHTML(meta)}</div>` : ''}
                <p class="ybp-quote">${quote ? `&ldquo;${escapeHTML(quote)}&rdquo;` : '&ldquo;Selalu diingat dalam kebersamaan.&rdquo;'}</p>
                ${facts ? `<div class="ybp-facts">${facts}</div>` : ''}
                ${note ? `
                    <div class="ybp-note-wrap">
                        <div class="ybp-note">${escapeHTML(decodeStoredText(note.message))}</div>
                        <div class="ybp-note-from">— ${escapeHTML(toTitleCase(note.sender_name || 'Kawan'))}</div>
                    </div>` : ''}
            </div>
        </div>
    `;
}

function buildAdminPrintPages(students, className, targetContainer, options = {}) {
    if (!targetContainer) return;
    const opts = { perPage: 4, includeNotes: true, includeClosing: true, ...options };
    const printable = (students || []).filter(isPublished);
    const hiddenCount = (students || []).length - printable.length;
    const info = document.getElementById('print-page-info');

    if (printable.length === 0) {
        targetContainer.innerHTML = `<div class="text-center py-16 text-slate-400 text-xs bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">Tidak ada data siswa yang dipublikasikan untuk dicetak pada rombel ini.</div>`;
        if (info) info.textContent = '';
        return;
    }

    const classOf = getGraduationYear(_academicYear || getDefaultAcademicYear());
    const pages = [];
    for (let i = 0; i < printable.length; i += opts.perPage) {
        pages.push(printable.slice(i, i + opts.perPage));
    }

    const folio = (pageNo) => `
        <div class="ybp-folio">
            <span>${escapeHTML(SCHOOL_NAME)} &middot; The Yearbook</span>
            <strong>${pageNo}</strong>
        </div>
    `;

    let pagesHtml = '';

    // SAMPUL ROMBEL
    pagesHtml += `
        <section class="ybp-sheet ybp-cover">
            <div class="ybp-cover-top">
                <span>${escapeHTML(SCHOOL_NAME)}</span>
                <img src="assets/logo-sekolah.png" alt="">
            </div>
            <div class="ybp-cover-center">
                <div class="ybp-cover-kicker">Buku Tahunan &middot; The Yearbook</div>
                <h1 class="ybp-cover-title"><em>Class of</em>${escapeHTML(classOf)}</h1>
                <div class="ybp-cover-rule"></div>
                <div class="ybp-cover-class">${escapeHTML(className)}</div>
                <p class="ybp-cover-motto">&ldquo;${escapeHTML(SCHOOL_MOTTO)}&rdquo;</p>
            </div>
            <div class="ybp-cover-bottom">
                <span>Peserta Didik<strong>${printable.length} Siswa</strong></span>
                <span style="text-align:right;">Tahun Ajaran<strong>${escapeHTML(_academicYear || getDefaultAcademicYear())}</strong></span>
            </div>
        </section>
    `;

    // HALAMAN PROFIL
    const pageOfStudent = new Map();
    pages.forEach((pageStudents, pageIdx) => {
        const pageNo = pageIdx + 2;
        pageStudents.forEach(st => pageOfStudent.set(st.nis, pageNo));
        pagesHtml += `
            <section class="ybp-sheet ybp-page">
                <div class="ybp-runhead">
                    <strong>${escapeHTML(className)}</strong>
                    <span>Class of ${escapeHTML(classOf)} &middot; ${escapeHTML(SCHOOL_SHORT)} ${escapeHTML(SCHOOL_VISI)}</span>
                </div>
                <div class="ybp-grid ybp-grid-${opts.perPage}">
                    ${pageStudents.map(st => buildPrintProfile(st, opts)).join('')}
                </div>
                ${folio(pageNo)}
            </section>
        `;
    });

    // HALAMAN PENUTUP & INDEKS NAMA
    if (opts.includeClosing) {
        const closingNo = pages.length + 2;
        pagesHtml += `
            <section class="ybp-sheet ybp-page">
                <div class="ybp-runhead">
                    <strong>${escapeHTML(className)}</strong>
                    <span>Indeks Nama &middot; Class of ${escapeHTML(classOf)}</span>
                </div>
                <h2 class="ybp-closing-title">Sampai jumpa <em>di puncak.</em></h2>
                <p class="ybp-closing-lead">
                    Tiga tahun di ${escapeHTML(SCHOOL_NAME)} kini menjadi halaman yang tak akan pernah usang.
                    Terima kasih untuk setiap tawa, perjuangan, dan persahabatan &mdash; semoga kita bertemu lagi
                    dengan cerita yang lebih hebat.
                </p>
                <ol class="ybp-index">
                    ${printable.map((st, i) => `
                        <li><span>${String(i + 1).padStart(2, '0')}</span><span style="flex:1;">${escapeHTML(toTitleCase(st.name))}</span><span>hlm. ${pageOfStudent.get(st.nis)}</span></li>
                    `).join('')}
                </ol>
                <div style="flex:1;"></div>
                ${folio(closingNo)}
            </section>
        `;
    }

    targetContainer.innerHTML = `<div class="ybp-stage">${pagesHtml}</div>`;

    const totalPages = 1 + pages.length + (opts.includeClosing ? 1 : 0);
    if (info) {
        info.textContent = `${totalPages} halaman A4 · ${printable.length} siswa${hiddenCount ? ` · ${hiddenCount} disembunyikan tidak dicetak` : ''}`;
    }
}

function waitForPrintAssets(root, timeoutMs = 8000) {
    const images = [...root.querySelectorAll('img')];
    const imagePromises = images.map(img => (img.complete
        ? Promise.resolve()
        : new Promise(resolve => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
        })));
    const fontsReady = document.fonts?.ready || Promise.resolve();
    return Promise.race([
        Promise.all([...imagePromises, fontsReady]),
        new Promise(resolve => setTimeout(resolve, timeoutMs))
    ]);
}

window.triggerAdminPrint = async function() {
    const preview = document.getElementById('print-preview-container');
    const printContainer = document.getElementById('print-yearbook-container');
    const stage = preview?.querySelector('.ybp-stage');
    if (!stage) {
        showAdminToast('Peringatan', 'Silakan pilih rombel terlebih dahulu sebelum mencetak.', 'warning');
        return;
    }
    if (!printContainer) return;

    const btn = document.getElementById('btn-admin-print');
    const original = btn ? btn.innerHTML : '';
    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Menyiapkan foto...</span>';
        }
        printContainer.innerHTML = stage.outerHTML;
        await waitForPrintAssets(printContainer);
        const previousTitle = document.title;
        document.title = `Buku Tahunan ${_printClass} - Class of ${getGraduationYear(_academicYear)}`;
        window.print();
        document.title = previousTitle;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }
};

// =========================================================================
// 10. MODERASI PESAN SAHABAT
// =========================================================================
async function loadAdminMessages() {
    const tbody = document.getElementById('table-admin-messages-body');
    if (!tbody) return;

    try {
        _allMessages = await cfClient.getYearbookAdminMessages();
        _filteredMessages = [..._allMessages];
        updatePendingBadge();
        filterAdminMessages();
    } catch (err) {
        console.error('[Yearbook Admin] Load messages error:', err);
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="p-8 text-center text-rose-500">
                    <i class="fa-solid fa-circle-exclamation text-2xl mb-1"></i>
                    <p class="text-xs">Gagal memuat pesan kenangan: ${escapeHTML(err.message)}</p>
                </td>
            </tr>
        `;
    }
}

function updatePendingBadge() {
    const badge = document.getElementById('nav-messages-pending');
    if (!badge) return;
    const pending = _allMessages.filter(m => Number(m.is_approved) !== 1).length;
    badge.textContent = pending;
    badge.classList.toggle('hidden', pending === 0);
    badge.title = `${pending} pesan menunggu persetujuan penerima`;
}

window.filterAdminMessages = function() {
    const status = document.getElementById('filter-msg-status')?.value || 'all';
    const query = (document.getElementById('filter-msg-search')?.value || '').toLowerCase().trim();

    _filteredMessages = _allMessages.filter(m => {
        const approved = Number(m.is_approved) === 1;
        if (status === 'approved' && !approved) return false;
        if (status === 'hidden' && approved) return false;

        if (query) {
            const fields = [m.message, m.sender_name, m.sender_nis, m.recipient_name, m.target_nis, m.recipient_class, m.sender_class];
            if (!fields.some(v => String(v || '').toLowerCase().includes(query))) return false;
        }

        return true;
    });

    renderAdminMessagesTable(_filteredMessages);
};

function renderAdminMessagesTable(messages) {
    const tbody = document.getElementById('table-admin-messages-body');
    if (!tbody) return;

    if (!messages || messages.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="p-8 text-center text-slate-400">
                    <i class="fa-solid fa-comments text-2xl mb-1 text-slate-300"></i>
                    <p class="text-xs">Tidak ada pesan kenangan yang cocok.</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = messages.map((m, idx) => {
        const isApproved = Number(m.is_approved) === 1;
        const created = m.created_at ? new Date(String(m.created_at).replace(' ', 'T') + (String(m.created_at).includes('Z') ? '' : 'Z')) : null;
        const timeStr = created && !isNaN(created) ? created.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

        return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
                <td class="p-3 text-center text-slate-400 font-mono text-[11px]">${idx + 1}</td>
                <td class="p-3">
                    <div class="font-bold text-slate-900 dark:text-white whitespace-nowrap">${escapeHTML(toTitleCase(m.sender_name || 'Teman'))}</div>
                    <div class="text-[10px] text-slate-400 font-mono">${escapeHTML(m.sender_class || '')} · NIS ${escapeHTML(m.sender_nis)}</div>
                </td>
                <td class="p-3">
                    <div class="font-bold text-slate-900 dark:text-white whitespace-nowrap">${escapeHTML(toTitleCase(m.recipient_name || 'Siswa'))}</div>
                    <div class="text-[10px] text-slate-400 font-mono">${escapeHTML(m.recipient_class || '')} · NIS ${escapeHTML(m.target_nis)}</div>
                </td>
                <td class="p-3 max-w-[320px]">
                    <p class="text-[11px] italic text-slate-700 dark:text-slate-300 leading-snug line-clamp-3">
                        &ldquo;${escapeHTML(decodeStoredText(m.message))}&rdquo;
                    </p>
                </td>
                <td class="p-3 text-[10px] text-slate-400 whitespace-nowrap">${escapeHTML(timeStr)}</td>
                <td class="p-3 text-center">
                    <span class="px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap ${isApproved ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'}">
                        ${isApproved ? 'Tampil' : 'Menunggu'}
                    </span>
                </td>
                <td class="p-3 text-center">
                    <div class="flex items-center justify-center gap-1.5">
                        <button onclick="window.toggleApproveMessageAdmin('${escapeHTML(m.id)}', ${isApproved ? 1 : 0})"
                            title="${isApproved ? 'Sembunyikan Pesan' : 'Setujui Pesan'}"
                            class="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition">
                            <i class="fa-solid ${isApproved ? 'fa-eye-slash text-amber-500' : 'fa-check text-emerald-500'} text-xs"></i>
                        </button>
                        <button onclick="window.deleteMessageAdmin('${escapeHTML(m.id)}')"
                            title="Hapus Pesan Permanen"
                            class="p-1.5 rounded-lg border border-rose-200 dark:border-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 transition">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

window.toggleApproveMessageAdmin = async function(msgId, currentStatus) {
    if (!msgId) return;
    try {
        const newStatus = currentStatus ? 0 : 1;
        const res = await cfClient.toggleApproveYearbookMessage(msgId, newStatus);
        if (res && res.success) {
            showAdminToast('Berhasil', res.message, 'success');
            const m = _allMessages.find(item => item.id === msgId);
            if (m) m.is_approved = newStatus;
            updatePendingBadge();
            filterAdminMessages();
        } else {
            throw new Error(res?.error || 'Gagal mengubah status pesan.');
        }
    } catch (err) {
        console.error('[Yearbook Admin] Toggle approve error:', err);
        showAdminToast('Gagal', err.message, 'error');
    }
};

window.deleteMessageAdmin = async function(msgId) {
    if (!msgId) return;
    if (!confirm('Apakah Anda yakin ingin menghapus pesan kenangan ini secara permanen?')) return;

    try {
        const res = await cfClient.deleteYearbookMessage(msgId);
        if (res && res.success) {
            showAdminToast('Berhasil', 'Pesan kenangan berhasil dihapus.', 'success');
            _allMessages = _allMessages.filter(item => item.id !== msgId);
            updatePendingBadge();
            filterAdminMessages();
        } else {
            throw new Error(res?.error || 'Gagal menghapus pesan.');
        }
    } catch (err) {
        console.error('[Yearbook Admin] Delete message error:', err);
        showAdminToast('Gagal', err.message, 'error');
    }
};

// =========================================================================
// 11. MANAJEMEN ARSIP MASTER PDF ALUMNI
// =========================================================================
async function loadAdminArchives() {
    const grid = document.getElementById('admin-archives-grid');
    if (!grid) return;

    try {
        _archivesList = await cfClient.getYearbookArchives();
        if (_archivesList.length === 0) {
            grid.innerHTML = `
                <div class="col-span-full text-center py-16 text-slate-400 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6">
                    <i class="fa-solid fa-box-archive text-3xl mb-2 text-indigo-400"></i>
                    <p class="text-xs font-semibold">Belum ada katalog master PDF buku tahunan yang diterbitkan.</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = _archivesList.map(item => {
            const pdfUrl = isSafeHttpUrl(item.pdf_url) ? item.pdf_url : '';
            const coverUrl = isSafeHttpUrl(item.cover_url) ? item.cover_url : '';
            const year = getGraduationYear(item.academic_year);
            return `
                <div class="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 flex gap-4">
                    <div class="w-28 shrink-0">
                        <div class="yb-book-cover">
                            ${coverUrl
                                ? `<img src="${escapeHTML(coverUrl)}" alt="" loading="lazy">`
                                : `<div class="yb-book-art" style="padding:10px 8px 10px 18px;">
                                        <small style="font-size:7px;">Yearbook</small>
                                        <div><span style="font-size:10px;">Class of</span> <strong style="font-size:1.35rem;">${escapeHTML(year)}</strong></div>
                                        <small style="font-size:7px;">${escapeHTML(item.academic_year)}</small>
                                   </div>`}
                        </div>
                    </div>
                    <div class="min-w-0 flex-1 flex flex-col">
                        <span class="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">TA ${escapeHTML(item.academic_year)}</span>
                        <h3 class="font-bold text-sm text-slate-900 dark:text-white leading-tight mt-0.5 font-serif-heading">${escapeHTML(item.title)}</h3>
                        ${item.batch_name ? `<p class="text-xs text-slate-500 mt-0.5">${escapeHTML(item.batch_name)}</p>` : ''}
                        <p class="text-[11px] text-slate-400 mt-1">${Number(item.total_students || 0)} alumni${Number(item.is_public) === 0 ? ' · <span class="text-rose-500 font-bold">Privat</span>' : ''}</p>
                        <div class="mt-auto pt-3 flex items-center gap-1.5">
                            ${pdfUrl
                                ? `<a href="${escapeHTML(pdfUrl)}" target="_blank" rel="noopener noreferrer"
                                    class="flex-1 py-1.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white font-bold text-[11px] transition flex items-center justify-center gap-1.5">
                                    <i class="fa-solid fa-file-pdf"></i><span>Buka PDF</span></a>`
                                : '<span class="flex-1 text-[11px] text-rose-500 font-bold">Tautan tidak valid</span>'}
                            <button onclick="window.editAdminArchive('${escapeHTML(item.academic_year)}')"
                                class="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition" title="Ubah Arsip">
                                <i class="fa-solid fa-pen text-xs"></i>
                            </button>
                            <button onclick="window.deleteAdminArchive('${escapeHTML(item.academic_year)}')"
                                class="p-2 rounded-xl border border-rose-200 dark:border-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 transition" title="Hapus Arsip (Super Admin)">
                                <i class="fa-solid fa-trash text-xs"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error('[Yearbook Admin] Load archives error:', err);
        grid.innerHTML = `<div class="col-span-full text-center py-10 text-rose-500 text-xs">Gagal memuat arsip: ${escapeHTML(err.message)}</div>`;
    }
}

function fillArchiveForm(values) {
    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value ?? '';
    };
    set('archive-admin-ta', values.academic_year);
    set('archive-admin-title', values.title);
    set('archive-admin-theme', values.batch_name);
    set('archive-admin-pdf', values.pdf_url);
    set('archive-admin-cover', values.cover_url);
    set('archive-admin-total', values.total_students);
}

window.openAdminArchiveModal = function() {
    const ta = _academicYear || getDefaultAcademicYear();
    fillArchiveForm({
        academic_year: ta,
        title: `Buku Tahunan Angkatan ${getGraduationYear(ta)}`,
        batch_name: '',
        pdf_url: '',
        cover_url: '',
        total_students: _allStudents.filter(isPublished).length || ''
    });
    const modal = document.getElementById('modal-admin-archive');
    if (modal) modal.classList.remove('hidden');
};

window.editAdminArchive = function(academicYear) {
    const item = _archivesList.find(a => a.academic_year === academicYear);
    if (!item) return;
    fillArchiveForm(item);
    const modal = document.getElementById('modal-admin-archive');
    if (modal) modal.classList.remove('hidden');
};

window.closeAdminArchiveModal = function() {
    const modal = document.getElementById('modal-admin-archive');
    if (modal) modal.classList.add('hidden');
};

window.submitAdminArchive = async function(e) {
    if (e) e.preventDefault();
    const btn = document.getElementById('btn-submit-admin-archive');
    const ta = document.getElementById('archive-admin-ta')?.value || '';
    const title = document.getElementById('archive-admin-title')?.value || '';
    const theme = document.getElementById('archive-admin-theme')?.value || '';
    const pdfUrl = document.getElementById('archive-admin-pdf')?.value || '';
    const coverUrl = document.getElementById('archive-admin-cover')?.value || '';
    const total = document.getElementById('archive-admin-total')?.value;

    if (!ta.trim() || !title.trim() || !pdfUrl.trim()) {
        showAdminToast('Peringatan', 'Tahun ajaran, judul dokumen, dan tautan PDF master wajib diisi.', 'warning');
        return;
    }
    if (!isSafeHttpUrl(pdfUrl) || (coverUrl.trim() && !isSafeHttpUrl(coverUrl))) {
        showAdminToast('Peringatan', 'Tautan wajib diawali http:// atau https://', 'warning');
        return;
    }

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
        }

        const res = await cfClient.saveYearbookArchive({
            academic_year: ta.trim(),
            title: title.trim(),
            batch_name: theme.trim(),
            pdf_url: pdfUrl.trim(),
            cover_url: coverUrl.trim(),
            total_students: Number(total || 0),
            is_public: 1
        });

        if (res && res.success) {
            showAdminToast('Berhasil', res.message, 'success');
            window.closeAdminArchiveModal();
            loadAdminArchives();
        } else {
            throw new Error(res?.error || 'Gagal menerbitkan arsip.');
        }
    } catch (err) {
        console.error('[Yearbook Admin] Submit archive error:', err);
        showAdminToast('Gagal', err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> <span>Simpan & Publikasikan</span>';
        }
    }
};

window.deleteAdminArchive = async function(academicYear) {
    if (!academicYear) return;
    if (!confirm(`Apakah Anda yakin ingin menghapus katalog arsip buku tahunan tahun ${academicYear}?`)) return;

    try {
        const res = await cfClient.deleteYearbookArchive(academicYear);
        if (res && res.success) {
            showAdminToast('Berhasil', res.message, 'success');
            loadAdminArchives();
        } else {
            throw new Error(res?.error || 'Gagal menghapus arsip.');
        }
    } catch (err) {
        console.error('[Yearbook Admin] Delete archive error:', err);
        showAdminToast('Gagal', err.message, 'error');
    }
};

window.refreshAdminYearbookData = async function() {
    await initAdminYearbookPage();
    if (_printClass) window.renderAdminPrintPreview(_printClass);
};

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.closeAdminArchiveModal();
});

window.initAdminYearbookPage = initAdminYearbookPage;
window.loadAllYearbookStudents = loadAllYearbookStudents;
window.loadAdminMessages = loadAdminMessages;
window.loadAdminArchives = loadAdminArchives;

// --- SIKLUS HIDUP AUTENTIKASI & LAYOUT RESMI SIMAS ---
if (typeof window !== 'undefined' && auth) {
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            const redirectParam = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
            window.location.replace(`index.html?redirect=${redirectParam}`);
            return;
        }

        const role = localStorage.getItem('user_role') || '';
        const effectiveRole = (typeof window.getEffectiveRoleForPage === 'function')
            ? window.getEffectiveRoleForPage('yearbook-admin.html')
            : role;

        // Validasi hak akses halaman admin buku tahunan
        const hasAccess = (typeof window.hasPageAccess === 'function')
            ? (window.hasPageAccess('yearbook-admin.html') || window.hasPageAccess('yearbook-admin'))
            : ['super_admin', 'kesiswaan', 'wali_kelas', 'kepala_sekolah'].includes(role);

        if (!hasAccess) {
            console.warn('[Yearbook Admin] Akses ditolak untuk role:', role);
            window.location.replace('dashboard.html');
            return;
        }

        // Render Shell Layout Utama SIMAS (Sidebar, Header, Profil Pengguna)
        if (typeof initLayout === 'function') {
            try {
                await initLayout(effectiveRole);
            } catch (layoutErr) {
                console.warn('[Yearbook Admin] Init layout warning:', layoutErr);
            }
        }

        // Tampilkan kontainer utama halaman admin (unhide)
        const mainEl = document.querySelector('main');
        if (mainEl) {
            mainEl.classList.remove('hidden');
        }

        // Jalankan pemuatan data admin buku tahunan
        await initAdminYearbookPage();
    });
}

export {
    initAdminYearbookPage,
    loadAllYearbookStudents,
    loadAdminMessages,
    loadAdminArchives,
    buildAdminPrintPages
};
