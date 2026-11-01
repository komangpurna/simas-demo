import { auth } from './config.js';
import { cfClient } from './cloudflare-client.js';
import { initLayout } from './global.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { parseDate, escapeHTML, showConfirmModal } from './agenda-common.js';

let currentUserRole = null;
let currentUserName = null;
let isDocManager = false;
let agendaDocuments = [];
let editingDocId = null;
let selectedCategoryFilter = 'all';
let previousActiveElement = null;
const usersCache = {};

window.escapeHTML = escapeHTML;

// Helper: Verifikasi status Doc Manager secara dinamis (Multi-Role Support)
function checkIsDocManager() {
    if (isDocManager) return true;
    const managerRoles = ['super_admin', 'kepala_sekolah', 'wakasek_kurikulum', 'kurikulum', 'tim_kurikulum', 'kesiswaan', 'kepala_lab'];
    const role = currentUserRole || localStorage.getItem('user_role') || 'guru_mapel';
    const isMgr = managerRoles.some(r => (typeof window.hasRole === 'function' ? window.hasRole(r) : role === r));
    if (isMgr) isDocManager = true;
    return isDocManager;
}

// Helper: Verifikasi hak kelola dokumen (Manager atau Pengunggah/Pemilik Asli)
function canManageDocument(docItem) {
    if (checkIsDocManager()) return true;
    if (!docItem) return false;
    const activeUser = auth?.currentUser;
    const activeEmail = (activeUser?.email || '').toLowerCase();
    const activeUid = activeUser?.uid || '';
    const uploader = (docItem.uploadedBy || docItem.createdBy || '').toLowerCase();
    return Boolean((activeEmail && uploader === activeEmail) || (activeUid && uploader === activeUid));
}

// Helper: Sinkronisasi visibilitas tombol Kelola Dokumen
function updateManagerButtonVisibility() {
    const btnManage = document.getElementById('btn-manage-docs');
    if (btnManage) {
        checkIsDocManager();
        const activeUser = auth?.currentUser;
        const activeEmail = (activeUser?.email || '').toLowerCase();
        const activeUid = activeUser?.uid || '';
        const hasOwnDoc = agendaDocuments.some(d => {
            const up = (d.uploadedBy || d.createdBy || '').toLowerCase();
            return (activeEmail && up === activeEmail) || (activeUid && up === activeUid);
        });
        if (isDocManager || hasOwnDoc) {
            btnManage.classList.remove('hidden');
        } else {
            btnManage.classList.add('hidden');
        }
    }
}

// 1. Inisialisasi Autentikasi, Layout Navigasi & RBAC Dokumen
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.replace('index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash));
        return;
    }

    try {
        const role = localStorage.getItem('user_role') || 'guru_mapel';
        currentUserRole = role;
        currentUserName = localStorage.getItem(`cached_user_name_${user.uid}`) || user.displayName || 'Pengguna SIMAS';

        // Inisialisasi Kerangka Layout SIMAS (Sidebar Desktop/Mobile, Header, Profil Pengguna)
        await initLayout(role);

        // RBAC: super_admin, kepala_sekolah, wakasek_kurikulum, kurikulum, tim_kurikulum, kesiswaan, kepala_lab
        const managerRoles = ['super_admin', 'kepala_sekolah', 'wakasek_kurikulum', 'kurikulum', 'tim_kurikulum', 'kesiswaan', 'kepala_lab'];
        isDocManager = managerRoles.some(r => window.hasRole ? window.hasRole(r) : role === r);

        const btnManage = document.getElementById('btn-manage-docs');
        if (btnManage) {
            if (isDocManager) {
                btnManage.classList.remove('hidden');
            } else {
                btnManage.classList.add('hidden');
            }
        }

        const mainEl = document.querySelector('main');
        if (mainEl) mainEl.classList.remove('hidden');

        // Panggil pemuatan data dokumen dari Cloudflare D1
        await window.loadAgendaDocuments();

        // Cek hash/query untuk auto open modal manager
        if (window.location.hash === '#settings' || window.location.hash === '#docs-settings' || window.location.search.includes('manage=1')) {
            if (isDocManager) {
                window.openDocsManager();
            }
        }

    } catch (err) {
        console.error('[Dokumen] Error inisialisasi:', err);
        const mainEl = document.querySelector('main');
        if (mainEl) mainEl.classList.remove('hidden');
        await window.loadAgendaDocuments();
    }
});

// 2. Deteksi Jenis Google Drive / URL Berkas
function detectDriveFileType(url) {
    if (!url || typeof url !== 'string') {
        return { 
            btnColor: 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-500/20', 
            btnIcon: 'fa-brands fa-google-drive',
            label: 'Drive'
        };
    }
    const lower = url.toLowerCase();
    if (lower.includes('/document/') || lower.includes('/docs.')) {
        return { 
            btnColor: 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-500/20', 
            btnIcon: 'fa-solid fa-file-lines',
            label: 'Docs'
        };
    }
    if (lower.includes('/spreadsheets/') || lower.includes('/sheets.')) {
        return { 
            btnColor: 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-emerald-500/20', 
            btnIcon: 'fa-solid fa-file-excel',
            label: 'Sheets'
        };
    }
    if (lower.includes('/presentation/') || lower.includes('/slides.')) {
        return { 
            btnColor: 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 shadow-amber-500/20', 
            btnIcon: 'fa-solid fa-file-powerpoint',
            label: 'Slides'
        };
    }
    if (lower.includes('/drive/folders/') || lower.includes('/folders/')) {
        return { 
            btnColor: 'bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-700 hover:to-yellow-700 shadow-amber-500/20', 
            btnIcon: 'fa-solid fa-folder-open',
            label: 'Folder'
        };
    }
    if (lower.includes('.pdf') || lower.includes('/file/d/')) {
        return { 
            btnColor: 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700 shadow-rose-500/20', 
            btnIcon: 'fa-solid fa-file-pdf',
            label: 'PDF'
        };
    }
    return { 
        btnColor: 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-500/20', 
        btnIcon: 'fa-brands fa-google-drive',
        label: 'Drive'
    };
}

// 3. Formatter Tanggal Dokumen
function formatDocDate(ts) {
    if (!ts) return { dateStr: 'Terbaru', isNew: true };
    
    const d = parseDate(ts);
    if (!d) {
        return { dateStr: '-', isNew: false };
    }

    const monthsIndo = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
    const day = d.getDate();
    const month = monthsIndo[d.getMonth()] || 'Bln';
    const year = d.getFullYear();
    const dateStr = `${day} ${month} ${year}`;

    const now = new Date();
    const diffTime = Math.abs(now - d);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const isNew = diffDays <= 7;

    return { dateStr, isNew };
}

// 4. Memuat Dokumen dari Cloudflare D1
window.loadAgendaDocuments = async function() {
    const docsGrid = document.getElementById('docs-grid');
    const settingsList = document.getElementById('docs-settings-list');

    if (docsGrid) {
        docsGrid.innerHTML = `
            <div class="col-span-full text-center py-12 opacity-50">
                <i class="fa-solid fa-spinner fa-spin text-3xl mb-2 text-blue-500"></i>
                <p class="text-xs font-bold uppercase tracking-widest text-slate-500">Memuat Dokumen Sekolah...</p>
            </div>
        `;
    }
    if (settingsList && isDocManager) {
        settingsList.innerHTML = `
            <div class="text-center py-8 opacity-40">
                <i class="fa-solid fa-spinner fa-spin text-2xl mb-2 text-indigo-500"></i>
                <p class="text-xs font-bold uppercase">Memuat Dokumen...</p>
            </div>
        `;
    }

    try {
        const cfDocs = await cfClient.getAgendaDocuments('all');
        if (Array.isArray(cfDocs)) {
            agendaDocuments = cfDocs.map(d => ({
                id: d.id,
                title: d.title,
                driveUrl: d.drive_url || d.driveUrl,
                category: d.category || 'Umum',
                description: d.description || '',
                uploadedBy: d.uploaded_by || d.uploadedBy || d.created_by || d.createdBy || '',
                createdByName: d.uploader_name || d.uploaderName || d.createdByName || 'Pengguna SIMAS',
                createdAt: d.created_at || d.createdAt,
                isArchived: Boolean(d.is_archived || d.isArchived)
            }));
        } else {
            agendaDocuments = [];
        }
    } catch (e) {
        console.error('[Dokumen] Error memuat dari Cloudflare D1:', e);
        agendaDocuments = [];
    }

    // Resolusi nama pengunggah bila kosong (cache lokal)
    for (let docItem of agendaDocuments) {
        if (!docItem.createdByName) {
            const uid = docItem.createdBy || docItem.updatedBy || docItem.uploadedBy;
            if (uid && usersCache[uid]) {
                docItem.createdByName = usersCache[uid];
            } else if (uid && auth.currentUser && uid === auth.currentUser.uid && currentUserName) {
                usersCache[uid] = currentUserName;
                docItem.createdByName = currentUserName;
            } else if (currentUserName) {
                docItem.createdByName = currentUserName;
            }
        }
    }

    updateManagerButtonVisibility();
    window.renderAgendaDocuments();
    if (isDocManager || agendaDocuments.some(d => canManageDocument(d))) {
        window.renderDocsSettingsList();
    }
};

// 5. Filter Kategori
window.filterDocsCategory = function(cat) {
    selectedCategoryFilter = cat;
    document.querySelectorAll('.doc-cat-btn').forEach(btn => {
        if (btn.dataset.cat === cat) {
            btn.className = 'doc-cat-btn px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap bg-blue-600 text-white shadow-md shadow-blue-500/20';
        } else {
            btn.className = 'doc-cat-btn px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200';
        }
    });
    const mobileSelect = document.getElementById('select-doc-category-mobile');
    if (mobileSelect && mobileSelect.value !== cat) {
        mobileSelect.value = cat;
    }
    window.renderAgendaDocuments();
};

// 6. Render Grid Kartu Dokumen
window.renderAgendaDocuments = function() {
    const grid = document.getElementById('docs-grid');
    if (!grid) return;

    const searchVal = (document.getElementById('input-search-docs')?.value || '').toLowerCase().trim();

    const filtered = agendaDocuments.filter(docItem => {
        const isArchived = Boolean(docItem.isArchived);
        
        let matchCat = false;
        if (selectedCategoryFilter === 'archive') {
            matchCat = isArchived;
        } else if (selectedCategoryFilter === 'all') {
            matchCat = !isArchived;
        } else {
            matchCat = (!isArchived) && (docItem.category === selectedCategoryFilter);
        }

        const matchSearch = !searchVal || 
            (docItem.title && docItem.title.toLowerCase().includes(searchVal)) || 
            (docItem.description && docItem.description.toLowerCase().includes(searchVal)) ||
            (docItem.category && docItem.category.toLowerCase().includes(searchVal)) ||
            (docItem.createdByName && docItem.createdByName.toLowerCase().includes(searchVal));
        return matchCat && matchSearch;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center py-16 opacity-40">
                <div class="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-3">
                    <i class="fa-solid fa-folder-open text-3xl text-slate-400"></i>
                </div>
                <p class="text-xs font-bold uppercase tracking-widest text-slate-500">Tidak ada dokumen</p>
                <p class="text-[11px] text-slate-400 mt-1">Belum ada berkas yang sesuai dengan kategori atau kata kunci pencarian.</p>
            </div>
        `;
        return;
    }

    const catIcons = {
        'Kurikulum': 'fa-book text-blue-500',
        'Akademik': 'fa-calendar text-emerald-500',
        'SOP': 'fa-file-lines text-amber-500',
        'Pengumuman': 'fa-bullhorn text-rose-500',
        'Umum': 'fa-folder text-purple-500'
    };

    grid.innerHTML = filtered.map(d => {
        const iconClass = catIcons[d.category] || 'fa-file text-blue-500';
        const driveUrl = escapeHTML(d.driveUrl || '#');
        const title = escapeHTML(d.title || 'Dokumen Tanpa Judul');
        const category = escapeHTML(d.category || 'Umum');
        const uploader = escapeHTML(d.createdByName || currentUserName || 'Pengguna SIMAS');
        const isArchived = Boolean(d.isArchived);
        
        const rawDesc = (d.description || '').trim();
        const hasDesc = rawDesc && rawDesc !== 'Tidak ada deskripsi.' && rawDesc !== '-';
        const descHTML = hasDesc 
            ? `<p class="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1 leading-snug mb-1" title="${escapeHTML(rawDesc)}">${escapeHTML(rawDesc)}</p>` 
            : '';

        const fileType = detectDriveFileType(d.driveUrl);
        const { dateStr } = formatDocDate(d.createdAt);
        const badgeHTML = isArchived 
            ? '<span class="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/90 text-white shadow-xs flex items-center gap-0.5"><i class="fa-solid fa-box-archive text-[9px]"></i> Arsip</span>'
            : '';

        return `
            <div class="group relative bg-white dark:bg-slate-800/90 rounded-xl p-2.5 sm:p-3 border border-slate-200/80 dark:border-slate-700/80 hover:border-blue-400 dark:hover:border-blue-500/50 shadow-xs hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 flex flex-col justify-between">
                <div>
                    <!-- Badges Row -->
                    <div class="flex items-center justify-between gap-1 mb-1.5">
                        <div class="flex items-center gap-1 min-w-0">
                            <span class="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700/70 text-slate-700 dark:text-slate-200 border border-slate-200/60 dark:border-slate-600/60 flex items-center gap-1 truncate">
                                <i class="fa-solid ${iconClass}"></i> ${category}
                            </span>
                            ${badgeHTML}
                        </div>
                        <span class="text-[9px] font-semibold text-slate-400 dark:text-slate-500 flex items-center gap-1 uppercase shrink-0">
                            <i class="${fileType.btnIcon} text-[11px]"></i> <span class="hidden sm:inline text-[9px]">${fileType.label}</span>
                        </span>
                    </div>

                    <!-- Title -->
                    <h4 class="text-xs font-bold text-slate-800 dark:text-white line-clamp-2 leading-snug mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" title="${title}">
                        ${title}
                    </h4>

                    <!-- Description -->
                    ${descHTML}
                </div>

                <!-- Bottom Metadata & Action -->
                <div class="mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-1.5">
                    <div class="flex flex-col min-w-0 pr-1 text-[9px] sm:text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                        <span class="truncate font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1" title="Diunggah oleh: ${uploader}">
                            <i class="fa-solid fa-circle-user text-blue-500 text-[9px] shrink-0"></i>
                            <span class="truncate">${uploader}</span>
                        </span>
                        <span class="text-[8px] sm:text-[9px] text-slate-400 mt-0.5 flex items-center gap-0.5">
                            <i class="fa-regular fa-clock text-[8px]"></i> ${dateStr}
                        </span>
                    </div>

                    <!-- Action Button -->
                    <a href="${driveUrl}" target="_blank" rel="noopener noreferrer" class="shrink-0 py-1 px-2.5 ${fileType.btnColor} text-white rounded-lg font-bold text-[10px] sm:text-[11px] shadow-xs hover:shadow-md transition-all flex items-center gap-1 active:scale-95 whitespace-nowrap">
                        <span>Buka</span> <i class="fa-solid fa-arrow-up-right-from-square text-[8px] opacity-80"></i>
                    </a>
                </div>
            </div>
        `;
    }).join('');
};

// 7. Modal Kelola Pengaturan Dokumen (Mirip Kelola Agenda)
function handleDocsManagerKeydown(e) {
    if (e.key === 'Escape') {
        window.closeDocsManager();
    }
}

window.openDocsManager = function() {
    checkIsDocManager();
    const activeUser = auth?.currentUser;
    const activeEmail = (activeUser?.email || '').toLowerCase();
    const activeUid = activeUser?.uid || '';
    const hasOwnDoc = agendaDocuments.some(d => {
        const up = (d.uploadedBy || d.createdBy || '').toLowerCase();
        return (activeEmail && up === activeEmail) || (activeUid && up === activeUid);
    });

    if (!isDocManager && !hasOwnDoc) {
        if (window.showToast) window.showToast('Akses Terbatas', 'Hanya Tim Pengelola atau pemilik berkas yang berhak mengelola dokumen.', 'warning');
        return;
    }

    const modal = document.getElementById('modal-docs-manager');
    const content = document.getElementById('modal-docs-content');
    if (!modal || !content) return;

    previousActiveElement = document.activeElement;

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    });

    window.resetAgendaDocForm();
    window.renderDocsSettingsList();

    window.addEventListener('keydown', handleDocsManagerKeydown);

    const closeBtn = modal.querySelector('button[aria-label="Tutup modal"]');
    if (closeBtn && typeof closeBtn.focus === 'function') {
        closeBtn.focus();
    }
};

window.closeDocsManager = function() {
    const modal = document.getElementById('modal-docs-manager');
    const content = document.getElementById('modal-docs-content');
    if (!modal || !content) return;

    window.removeEventListener('keydown', handleDocsManagerKeydown);

    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');

    setTimeout(() => {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
        if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
            previousActiveElement.focus();
        }
    }, 200);

    // Render ulang kartu dokumen di halaman utama jika ada penambahan/perubahan
    window.renderAgendaDocuments();
};

window.resetAgendaDocForm = function() {
    editingDocId = null;
    const idInput = document.getElementById('input-doc-id');
    const titleInput = document.getElementById('input-doc-title');
    const urlInput = document.getElementById('input-doc-url');
    const catSelect = document.getElementById('select-doc-category');
    const descInput = document.getElementById('input-doc-desc');

    if (idInput) idInput.value = '';
    if (titleInput) titleInput.value = '';
    if (urlInput) urlInput.value = '';
    if (catSelect) catSelect.value = 'Kurikulum';
    if (descInput) descInput.value = '';

    const formTitle = document.getElementById('doc-form-title');
    if (formTitle) formTitle.textContent = 'Tambah Dokumen Baru';

    const btnSave = document.getElementById('btn-save-doc');
    if (btnSave) {
        btnSave.innerHTML = '<i class="fa-solid fa-save"></i> Simpan Dokumen';
        btnSave.className = "w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-md shadow-emerald-500/20 dark:shadow-none transition-all active:scale-95 flex items-center justify-center gap-1.5";
    }
};

window.editAgendaDocument = function(id) {
    const docItem = agendaDocuments.find(d => d.id === id);
    if (!docItem) return;

    editingDocId = id;
    const idInput = document.getElementById('input-doc-id');
    const titleInput = document.getElementById('input-doc-title');
    const urlInput = document.getElementById('input-doc-url');
    const catSelect = document.getElementById('select-doc-category');
    const descInput = document.getElementById('input-doc-desc');

    if (idInput) idInput.value = id;
    if (titleInput) {
        titleInput.value = docItem.title || '';
        titleInput.focus();
    }
    if (urlInput) urlInput.value = docItem.driveUrl || '';
    if (catSelect) catSelect.value = docItem.category || 'Kurikulum';
    if (descInput) descInput.value = docItem.description || '';

    const formTitle = document.getElementById('doc-form-title');
    if (formTitle) formTitle.textContent = 'Edit Dokumen Sekolah';

    const btnSave = document.getElementById('btn-save-doc');
    if (btnSave) {
        btnSave.innerHTML = '<i class="fa-solid fa-check"></i> Perbarui Dokumen';
        btnSave.className = "w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-md shadow-amber-500/20 dark:shadow-none transition-all active:scale-95 flex items-center justify-center gap-1.5";
    }

    // Scroll form ke tampilan pada layar mobile
    const formEl = document.getElementById('form-agenda-doc');
    if (formEl && typeof formEl.scrollIntoView === 'function' && window.innerWidth < 768) {
        formEl.scrollIntoView({ behavior: 'smooth' });
    }
};

window.renderDocsSettingsList = function() {
    const listEl = document.getElementById('docs-settings-list');
    const countLabel = document.getElementById('docs-count-label');
    if (!listEl) return;

    const modalSearch = (document.getElementById('input-search-docs-modal')?.value || '').toLowerCase().trim();

    const filtered = agendaDocuments.filter(d => {
        if (!modalSearch) return true;
        return (d.title && d.title.toLowerCase().includes(modalSearch)) ||
               (d.category && d.category.toLowerCase().includes(modalSearch)) ||
               (d.description && d.description.toLowerCase().includes(modalSearch)) ||
               (d.createdByName && d.createdByName.toLowerCase().includes(modalSearch));
    });

    if (countLabel) {
        countLabel.textContent = `${filtered.length} / ${agendaDocuments.length} berkas`;
    }

    if (filtered.length === 0) {
        listEl.innerHTML = `
            <div class="text-center py-10 opacity-40">
                <i class="fa-solid fa-folder-open text-2xl mb-2 text-slate-400"></i>
                <p class="text-xs font-bold uppercase tracking-wider text-slate-500">Tidak ada dokumen ditemukan</p>
                <p class="text-[11px] text-slate-400 mt-0.5">Coba sesuaikan kata kunci pencarian Anda.</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = filtered.map(d => {
        const title = escapeHTML(d.title || 'Dokumen Tanpa Judul');
        const desc = escapeHTML(d.description || '-');
        const category = escapeHTML(d.category || 'Umum');
        const uploader = escapeHTML(d.createdByName || currentUserName || 'Pengguna SIMAS');
        const { dateStr } = formatDocDate(d.createdAt);
        const isArchived = Boolean(d.isArchived);

        const archiveBadge = isArchived
            ? `<span class="text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700/50 flex items-center gap-1">
                <i class="fa-solid fa-box-archive text-[10px]"></i> DIARSIPKAN
               </span>`
            : '';

        const archiveBtn = isArchived
            ? `<button type="button" onclick="window.toggleArchiveAgendaDocument('${d.id}', false)" class="w-8 h-8 rounded-lg text-amber-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-all flex items-center justify-center border border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-800 shadow-xs" title="Buka Arsip (Aktifkan kembali)">
                <i class="fa-solid fa-box-open text-xs"></i>
               </button>`
            : `<button type="button" onclick="window.toggleArchiveAgendaDocument('${d.id}', true)" class="w-8 h-8 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-all flex items-center justify-center border border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-800 shadow-xs" title="Arsipkan Dokumen">
                <i class="fa-solid fa-box-archive text-xs"></i>
               </button>`;

        return `
            <div class="flex items-center justify-between p-3 sm:p-3.5 ${isArchived ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-800/40' : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200/80 dark:border-slate-700/80'} rounded-2xl border transition-all gap-2 sm:gap-3 min-w-0">
                <div class="min-w-0 flex-1 pr-1 sm:pr-2">
                    <div class="flex items-center gap-1.5 mb-1 flex-wrap min-w-0">
                        <span class="text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 shrink-0">
                            ${category}
                        </span>
                        ${archiveBadge}
                        <h5 class="text-xs font-bold text-slate-800 dark:text-white truncate max-w-full" title="${title}">${title}</h5>
                    </div>
                    <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate" title="${desc}">${desc}</p>
                    <div class="flex items-center gap-3 text-[10px] text-slate-400 mt-1">
                        <span class="truncate" title="${uploader}"><i class="fa-solid fa-circle-user text-blue-500 mr-1"></i>${uploader}</span>
                        <span class="shrink-0"><i class="fa-regular fa-clock mr-1"></i>${dateStr}</span>
                    </div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    ${canManageDocument(d) ? `
                        ${archiveBtn}
                        <button type="button" onclick="window.editAgendaDocument('${d.id}')" class="w-8 h-8 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-all flex items-center justify-center border border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-800 shadow-xs" title="Edit Dokumen">
                            <i class="fa-solid fa-pen text-xs"></i>
                        </button>
                        <button type="button" onclick="window.deleteAgendaDocument('${d.id}')" class="w-8 h-8 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-all flex items-center justify-center border border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-800 shadow-xs" title="Hapus Dokumen">
                            <i class="fa-solid fa-trash-can text-xs"></i>
                        </button>
                    ` : `
                        <span class="text-[10px] text-slate-400 dark:text-slate-500 italic px-2">Hanya lihat</span>
                    `}
                </div>
            </div>
        `;
    }).join('');
};

window.saveAgendaDocument = async function() {
    checkIsDocManager();
    const currentDoc = editingDocId ? agendaDocuments.find(d => d.id === editingDocId) : null;
    const isDocOwner = canManageDocument(currentDoc);

    if (!isDocManager && !isDocOwner) {
        if (window.showToast) window.showToast('Akses Dibatasi', 'Anda tidak memiliki hak untuk mengelola atau mengedit dokumen ini.', 'warning');
        return;
    }

    const title = document.getElementById('input-doc-title').value.trim();
    const driveUrl = document.getElementById('input-doc-url').value.trim();
    const category = document.getElementById('select-doc-category').value;
    const desc = document.getElementById('input-doc-desc').value.trim();

    if (!title || !driveUrl) {
        if (window.showToast) window.showToast('Peringatan', 'Judul Dokumen dan Link Google Drive wajib diisi.', 'warning');
        return;
    }

    if (!driveUrl.startsWith('http://') && !driveUrl.startsWith('https://')) {
        if (window.showToast) window.showToast('Peringatan', 'Link Google Drive harus diawali dengan http:// atau https://', 'warning');
        return;
    }

    const btn = document.getElementById('btn-save-doc');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Menyimpan...';
    }

    try {
        const uploaderName = currentUserName || 'Pengunggah';

        // Simpan langsung ke Cloudflare D1
        await cfClient.saveAgendaDocument({
            id: editingDocId || undefined,
            title,
            drive_url: driveUrl,
            category,
            description: desc,
            file_type: 'pdf',
            is_archived: currentDoc ? (currentDoc.isArchived ? 1 : 0) : 0,
            uploader_name: uploaderName
        }, Boolean(editingDocId), editingDocId);

        if (window.showToast) window.showToast('Berhasil', editingDocId ? 'Dokumen berhasil diperbarui.' : 'Dokumen baru berhasil ditambahkan.', 'success');
        window.resetAgendaDocForm();
        await window.loadAgendaDocuments();

    } catch (e) {
        console.error('[saveAgendaDocument] Error:', e);
        if (window.showToast) window.showToast('Gagal', e.message || 'Gagal menyimpan dokumen.', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
};

window.deleteAgendaDocument = async function(id) {
    checkIsDocManager();
    const docItem = agendaDocuments.find(d => d.id === id);
    if (!docItem) return;

    if (!canManageDocument(docItem)) {
        if (window.showToast) window.showToast('Akses Dibatasi', 'Anda tidak memiliki hak untuk menghapus dokumen ini.', 'warning');
        return;
    }

    const confirmed = await showConfirmModal(`Apakah Anda yakin ingin menghapus dokumen "${escapeHTML(docItem.title)}"?`, 'Hapus Dokumen', 'danger');
    if (!confirmed) return;

    try {
        if (editingDocId === id) {
            window.resetAgendaDocForm();
        }

        // Hapus langsung dari Cloudflare D1
        await cfClient.deleteAgendaDocument(id);

        if (window.showToast) window.showToast('Berhasil', 'Dokumen telah dihapus.', 'success');
        await window.loadAgendaDocuments();
    } catch (e) {
        console.error('[deleteAgendaDocument] Error:', e);
        if (window.showToast) window.showToast('Gagal', e.message || 'Gagal menghapus dokumen.', 'error');
    }
};

window.toggleArchiveAgendaDocument = async function(id, shouldArchive) {
    checkIsDocManager();
    const docItem = agendaDocuments.find(d => d.id === id);
    if (!docItem) return;

    if (!canManageDocument(docItem)) {
        if (window.showToast) window.showToast('Akses Dibatasi', 'Anda tidak memiliki hak untuk mengubah status arsip dokumen ini.', 'warning');
        return;
    }

    const actionText = shouldArchive ? 'mengarsipkan' : 'mengaktifkan kembali';
    const actionTitle = shouldArchive ? 'Arsipkan Dokumen' : 'Buka Arsip Dokumen';
    
    const confirmed = await showConfirmModal(
        `Apakah Anda yakin ingin ${actionText} dokumen "${escapeHTML(docItem.title)}"?`,
        actionTitle,
        shouldArchive ? 'warning' : 'primary'
    );
    if (!confirmed) return;

    try {
        const uploaderName = currentUserName || 'Pengguna SIMAS';
        await cfClient.saveAgendaDocument({
            id: id,
            title: docItem.title,
            category: docItem.category || 'Umum',
            description: docItem.description || '',
            drive_url: docItem.driveUrl || '#',
            file_type: 'pdf',
            uploader_name: uploaderName,
            is_archived: shouldArchive ? 1 : 0
        }, true, id);

        const successMsg = shouldArchive 
            ? 'Dokumen berhasil diarsipkan.' 
            : 'Dokumen berhasil dikembalikan dari arsip.';
        if (window.showToast) window.showToast('Berhasil', successMsg, 'success');

        await window.loadAgendaDocuments();
    } catch (e) {
        console.error('[toggleArchiveAgendaDocument] Error:', e);
        if (window.showToast) window.showToast('Gagal', e.message || 'Gagal mengubah status arsip dokumen.', 'error');
    }
};
