/**
 * Admin Panel - Game Interaktif PID
 * CRUD game ke Cloudflare D1 SQL (/api/pid-games)
 */

(function() {
'use strict';

// ==================== STATE ====================
let allGames = [];
let editingId = null;
let adminFilterMode = 'all'; // 'all' | 'learning' | 'casual'
let adminReviewer = {
    uid: null,
    name: 'Admin'
};

function getGameSubjects(subjectField) {
    if (typeof window.parseGameSubjects === 'function') {
        return window.parseGameSubjects(subjectField);
    }
    if (!subjectField) return [];
    if (Array.isArray(subjectField)) return subjectField.map(s => String(s).trim()).filter(Boolean);
    return String(subjectField).split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

function checkIsLearningGame(game) {
    if (typeof window.isLearningGame === 'function') return window.isLearningGame(game);
    const subs = getGameSubjects(game?.subject);
    return subs.some(s => {
        const u = s.toUpperCase();
        return u !== 'UMUM' && u !== 'ICE BREAKING';
    });
}

function checkIsCasualGame(game) {
    if (typeof window.isCasualGame === 'function') return window.isCasualGame(game);
    const subs = getGameSubjects(game?.subject);
    if (subs.length === 0) return true;
    const hasCas = subs.some(s => {
        const u = s.toUpperCase();
        return u === 'UMUM' || u === 'ICE BREAKING';
    });
    return hasCas || !checkIsLearningGame(game);
}

// ==================== CATEGORY MAP ====================
const CAT_CLASS = {
    kuis: 'cat-kuis',
    puzzle: 'cat-puzzle',
    simulasi: 'cat-simulasi',
    arcade: 'cat-lainnya',
    flashcard: 'cat-puzzle',
    petualangan: 'cat-kreativitas',
    kreativitas: 'cat-kreativitas',
    lainnya: 'cat-lainnya'
};

const CAT_LABEL = {
    kuis: 'Kuis & Trivia',
    puzzle: 'Puzzle & Logika',
    simulasi: 'Simulasi & Eksperimen',
    arcade: 'Arcade & Ketangkasan',
    flashcard: 'Flashcard & Hafalan',
    petualangan: 'Petualangan / Roleplay',
    kreativitas: 'Kreativitas & Desain',
    lainnya: 'Lainnya'
};

// ==================== DOM ====================
const els = {
    sTotal: document.getElementById('s-total'),
    sActive: document.getElementById('s-active'),
    sHidden: document.getElementById('s-hidden') || document.getElementById('s-pending'),
    sAuthors: document.getElementById('s-authors'),
    formTitle: document.getElementById('form-title'),
    editId: document.getElementById('edit-id'),
    fTitle: document.getElementById('f-title'),
    fUrl: document.getElementById('f-url'),
    fAuthor: document.getElementById('f-author'),
    fAuthorSearch: document.getElementById('f-author-search'),
    adminGtkDropdown: document.getElementById('admin-gtk-dropdown'),
    btnAdminSelfGtk: document.getElementById('btn-admin-self-gtk'),
    chkAdminGameEksternal: document.getElementById('chk-admin-game-eksternal'),
    adminAuthorReqStar: document.getElementById('admin-author-req-star'),
    adminGtkHint: document.getElementById('admin-gtk-hint'),
    fCategoryContainer: document.getElementById('f-category-container'),
    fMapelContainer: document.getElementById('f-mapel-container'),
    fThumb: document.getElementById('f-thumb'),
    fDesc: document.getElementById('f-desc'),
    fThemeData: document.getElementById('f-theme-data'),
    btnAdminAiInspect: document.getElementById('btn-admin-ai-inspect'),
    adminAiStatus: document.getElementById('admin-ai-status'),
    adminAiStatusText: document.getElementById('admin-ai-status-text'),
    btnSave: document.getElementById('btn-save'),
    btnCancel: document.getElementById('btn-cancel'),
    btnShowAddForm: document.getElementById('btn-show-add-form'),
    searchGames: document.getElementById('search-games'),
    tbody: document.getElementById('game-tbody'),
    toast: document.getElementById('toast'),
    // Settings Mapel
    cfgMapelContainer: document.getElementById('cfg-mapel-container'),
    cfgMapelCustom: document.getElementById('cfg-mapel-custom'),
    btnCfgAddMapel: document.getElementById('btn-cfg-add-mapel'),
    btnSaveMapelCfg: document.getElementById('btn-save-mapel-cfg')
};

let allowedMapels = [];
let dbMapelsCache = [];
let adminGtkList = [];
let lastValidAdminTeacher = '';

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    const role = localStorage.getItem('user_role');
    if (role !== 'super_admin') {
        window.location.replace('../dashboard.html');
        return;
    }
    adminReviewer.uid = window.auth?.currentUser?.uid || null;
    adminReviewer.name = localStorage.getItem(`cached_user_name_${adminReviewer.uid}`) || localStorage.getItem('user_name') || window.auth?.currentUser?.displayName || 'Admin';
    loadGtkMasterAdmin();
    loadMapelConfig();
    loadGames();
    setupEvents();
    setupAdminAiAndCombobox();
});

const CF_API_URL = 'https://simas-smagesa-api.komangpurna1.workers.dev';

// Header JSON + token Firebase untuk operasi tulis (Worker mewajibkan login staf)
async function getAuthJsonHeaders() {
    const token = window.auth?.currentUser ? await window.auth.currentUser.getIdToken().catch(() => null) : null;
    return { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) };
}

async function loadGtkMasterAdmin() {
    // Cek cache lokal
    const cached = localStorage.getItem('simas_cached_gtk_master');
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
                adminGtkList = parsed;
            }
        } catch(e) {}
    }

    try {
        const token = window.auth?.currentUser ? await window.auth.currentUser.getIdToken().catch(() => null) : null;
        const headers = {
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        };

        let mRes = await fetch(`${CF_API_URL}/api/pid-games/teachers`, { headers });
        if (!mRes.ok) {
            mRes = await fetch(`${CF_API_URL}/api/jurnal/master`, { headers });
        }
        if (!mRes.ok) {
            mRes = await fetch(`${CF_API_URL}/api/gtk?status=active&limit=500`, { headers });
        }

        if (mRes.ok) {
            const mJson = await mRes.json();
            const teachers = mJson.data?.teachers || mJson.data || [];
            if (Array.isArray(teachers) && teachers.length > 0) {
                adminGtkList = teachers.map(t => ({
                    id: t.id || t.uid || '',
                    nama: (t.nama || t.name || '').trim(),
                    nip: t.nip || ''
                })).filter(t => Boolean(t.nama));
                adminGtkList.sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
                localStorage.setItem('simas_cached_gtk_master', JSON.stringify(adminGtkList));
            }
        }
    } catch (e) {
        console.warn('[Admin GTK] Gagal load master GTK:', e);
    }
}

// ==================== LOAD ALL GAMES ====================
async function loadGames() {
    try {
        const resp = await fetch(`${CF_API_URL}/api/pid-games?status=all`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        allGames = json.data || [];
        allGames.sort((a, b) => {
            const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
            const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
            return tb - ta;
        });
        renderStats();
        renderTable();
    } catch (err) {
        console.error('Gagal memuat game:', err);
        els.tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><span class="ico">❌</span>Gagal memuat data: ${esc(err.message)}</td></tr>`;
    }
}

// ==================== RENDER STATS ====================
function renderStats() {
    if (els.sTotal) els.sTotal.textContent = allGames.length;
    if (els.sActive) els.sActive.textContent = allGames.filter(g => g.is_active !== false).length;
    if (els.sHidden) els.sHidden.textContent = allGames.filter(g => g.is_active === false).length;
    if (els.sAuthors) els.sAuthors.textContent = new Set(allGames.map(g => (g.author && g.author !== 'none') ? g.author : g.submitted_by_name).filter(Boolean)).size;
}

// ==================== RENDER TABLE ====================
function renderTable() {
    const q = (els.searchGames.value || '').toLowerCase().trim();
    let list = allGames;

    if (adminFilterMode === 'learning') {
        list = list.filter(checkIsLearningGame);
    } else if (adminFilterMode === 'casual') {
        list = list.filter(checkIsCasualGame);
    }

    if (q) {
        list = list.filter(g =>
            g.title?.toLowerCase().includes(q) ||
            g.author?.toLowerCase().includes(q) ||
            g.subject?.toLowerCase().includes(q) ||
            g.submitted_by_name?.toLowerCase().includes(q) ||
            (g.is_active === false && ('tidak tayang'.includes(q) || 'sembunyi'.includes(q))) ||
            (g.is_active !== false && ('tayang'.includes(q) || 'aktif'.includes(q)))
        );
    }

    if (list.length === 0) {
        els.tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><span class="ico">📭</span>${q ? 'Tidak ditemukan' : 'Belum ada game'}</td></tr>`;
        return;
    }

    els.tbody.innerHTML = list.map((g, i) => {
        const catArr = Array.isArray(g.category) ? g.category : [g.category || 'lainnya'];
        const badgesHTML = catArr.map(c => {
            const catClass = CAT_CLASS[c] || 'cat-lainnya';
            const catLabel = CAT_LABEL[c] || c;
            return `<span class="cat-badge ${catClass}" style="margin-right:4px; margin-bottom:4px; display:inline-block;">${catLabel}</span>`;
        }).join('');
        const hasAuthor = g.author && g.author !== 'none';
        const primaryAuthor = hasAuthor ? g.author : (g.submitted_by_name || '-');
        const submitterNote = (hasAuthor && g.submitted_by_name && g.submitted_by_name !== g.author)
            ? `<div style="font-size:11.5px; color: var(--text-muted); margin-top: 3px;">Diupload oleh: <span style="color: var(--text-dim);">${esc(g.submitted_by_name)}</span></div>`
            : '';
        const isTayang = g.is_active !== false;
        const statusBadge = getAdminStatusBadge(isTayang);
        const actionButtons = buildAdminActionButtons(g);

        const isHtmlGame = g.source_type === 'html' || Boolean(g.has_html);
        const htmlBadge = isHtmlGame
            ? `<span style="background: rgba(16,185,129,0.15); color: #059669; border: 1px solid rgba(16,185,129,0.3); font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px; margin-left: 6px;">HTML</span>`
            : '';

        return `
            <tr>
                <td style="color: var(--text-muted); font-weight: 600;">${i + 1}</td>
                <td><strong style="color: var(--text);">${esc(g.title)}</strong>${htmlBadge}</td>
                <td>${badgesHTML}</td>
                <td>
                    <div>${primaryAuthor === '-' ? '-' : `<strong style="color: var(--text);">${esc(primaryAuthor)}</strong>`}</div>
                    ${submitterNote}
                    <div style="margin-top: 6px;">${statusBadge}</div>
                </td>
                <td><span style="color: var(--text-dim); font-weight: 500;">${esc(g.subject || '-')}</span></td>
                <td>${actionButtons}</td>
                <td style="white-space:nowrap">
                    <button class="btn-sm btn-edit" onclick="startEdit('${g.id}')">✏️ Edit</button>
                    <button class="btn-sm btn-del" onclick="deleteGame('${g.id}', '${esc(g.title)}')">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');
}

// ==================== LOAD MAPEL CONFIG ====================
async function loadMapelConfig() {
    try {
        let scheduleSubjects = [];
        let allowed = [];

        // 1. Ambil config & master mapel aktif dari Jadwal XML SSOT via Cloudflare D1
        try {
            const cfgRes = await fetch(`${CF_API_URL}/api/pid-games/config`);
            if (cfgRes.ok) {
                const cfgJson = await cfgRes.json();
                if (cfgJson.data) {
                    if (Array.isArray(cfgJson.data.schedule_subjects) && cfgJson.data.schedule_subjects.length > 0) {
                        scheduleSubjects = cfgJson.data.schedule_subjects;
                    }
                    if (Array.isArray(cfgJson.data.allowed_subjects)) {
                        allowed = cfgJson.data.allowed_subjects;
                    }
                }
            }
        } catch (e) {
            console.warn('[PID Admin] Gagal fetch mapel config:', e);
        }

        // 2. Set DB Mapels Cache murni dari schedule_subjects (Master Jadwal Sekolah)
        dbMapelsCache = scheduleSubjects.length > 0 ? scheduleSubjects : ['Umum', 'Ice Breaking'];

        // 3. Set Allowed Mapels: jika sudah ada konfigurasi simpanan gunakan itu, jika baru default ke seluruh mapel jadwal
        if (Array.isArray(allowed) && allowed.length > 0) {
            allowedMapels = allowed;
        } else {
            allowedMapels = [...dbMapelsCache];
        }

        refreshMapelConfigUI();
        renderEditFormMapels();
    } catch (e) {
        console.error('Gagal load mapel config:', e);
        toast('Gagal memuat daftar mapel', 'error');
    }
}

function refreshMapelConfigUI() {
    const allMapelSet = new Set([...allowedMapels, ...dbMapelsCache]);
    const allMapels = Array.from(allMapelSet).sort();

    let html = '';
    allMapels.forEach(m => {
        const isChecked = allowedMapels.includes(m) ? 'checked' : '';
        const isCustom = !dbMapelsCache.includes(m);
        
        let actions = '';
        if (isCustom) {
            actions = `<div style="margin-left: auto; display: flex; gap: 6px;">
                <button type="button" class="btn-edit-mapel" data-val="${m}" style="background:none; border:none; cursor:pointer; font-size:12px; padding:2px; opacity:0.8;" title="Edit">✏️</button>
                <button type="button" class="btn-del-mapel" data-val="${m}" style="background:none; border:none; cursor:pointer; font-size:12px; padding:2px; opacity:0.8;" title="Hapus">❌</button>
            </div>`;
        }
        
        html += `<label style="display: flex; align-items: center; width: 100%;"><input type="checkbox" value="${m}" ${isChecked}> <span style="margin-left:6px;">${m}</span>${actions}</label>`;
    });
    els.cfgMapelContainer.innerHTML = html;

    // Attach event listeners for edit and delete
    els.cfgMapelContainer.querySelectorAll('.btn-edit-mapel').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            const oldVal = btn.getAttribute('data-val');
            const newVal = prompt('Edit nama mapel:', oldVal);
            if (newVal && newVal.trim() && newVal.trim() !== oldVal) {
                const finalVal = newVal.trim();
                // Sync UI state
                allowedMapels = Array.from(els.cfgMapelContainer.querySelectorAll('input:checked')).map(i => i.value);
                
                const idx = allowedMapels.indexOf(oldVal);
                if (idx !== -1) allowedMapels[idx] = finalVal;
                
                // Cek duplicate saat edit
                if (!dbMapelsCache.includes(finalVal) && !allowedMapels.includes(finalVal)) {
                     // Biarkan saja, sudah diupdate via index
                }
                refreshMapelConfigUI();
            }
        };
    });

    els.cfgMapelContainer.querySelectorAll('.btn-del-mapel').forEach(btn => {
        btn.onclick = async (e) => {
            e.preventDefault();
            const val = btn.getAttribute('data-val');
            const ok = typeof window.showConfirmModal === 'function'
                ? await window.showConfirmModal(`Hapus mapel "${val}" dari daftar?`, 'Hapus Mapel', 'danger')
                : true;
            if (ok) {
                // Sync UI state
                allowedMapels = Array.from(els.cfgMapelContainer.querySelectorAll('input:checked')).map(i => i.value);
                allowedMapels = allowedMapels.filter(x => x !== val);
                refreshMapelConfigUI();
            }
        };
    });
}

function renderEditFormMapels() {
    let html = '';
    if (allowedMapels.length === 0) {
        html = '<div style="grid-column:1/-1; color:var(--text-muted); text-align:center; padding:8px;">Belum ada mapel dikonfigurasi</div>';
    } else {
        const customMapels = allowedMapels.filter(m => !dbMapelsCache.includes(m));
        const normalMapels = allowedMapels.filter(m => dbMapelsCache.includes(m));
        
        customMapels.forEach(m => {
            html += `<label><input type="checkbox" value="${m}"> <span style="color: #c084fc; font-weight: 700;">${m}</span></label>`;
        });
        normalMapels.forEach(m => {
            html += `<label><input type="checkbox" value="${m}"> <span>${m}</span></label>`;
        });
    }
    els.fMapelContainer.innerHTML = html;
}

// ==================== SETUP EVENTS ====================
function setupEvents() {
    els.btnSave.addEventListener('click', saveGame);
    els.btnCancel.addEventListener('click', cancelEdit);

    const adminModeFilters = document.getElementById('admin-mode-filters');
    if (adminModeFilters) {
        adminModeFilters.addEventListener('click', (e) => {
            const btn = e.target.closest('.admin-filter-btn');
            if (!btn) return;
            const mode = btn.dataset.mode;
            if (!mode) return;
            adminFilterMode = mode;
            adminModeFilters.querySelectorAll('.admin-filter-btn').forEach(b => {
                const isActive = b.dataset.mode === mode;
                b.classList.toggle('active', isActive);
                b.style.background = isActive ? 'var(--cyan)' : 'transparent';
                b.style.color = isActive ? '#0b1120' : 'var(--text-dim)';
            });
            renderTable();
        });
    }

    let timer;
    if (els.btnShowAddForm) {
        els.btnShowAddForm.addEventListener('click', () => {
            clearForm();
            const formSection = document.getElementById('form-section');
            if (formSection) {
                formSection.style.display = 'block';
                formSection.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }

    els.searchGames.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(renderTable, 200);
    });

    els.btnCfgAddMapel.addEventListener('click', () => {
        const custom = els.cfgMapelCustom.value.trim();
        if (!custom) return;
        
        // Sync UI state
        allowedMapels = Array.from(els.cfgMapelContainer.querySelectorAll('input:checked')).map(i => i.value);

        // Cek duplicate di UI
        const existing = Array.from(els.cfgMapelContainer.querySelectorAll('input[type="checkbox"]')).map(i => i.value.toLowerCase());
        if (!existing.includes(custom.toLowerCase())) {
            allowedMapels.push(custom);
            refreshMapelConfigUI();
            els.cfgMapelCustom.value = '';
        } else {
            toast('Mapel sudah ada di daftar', 'error');
        }
    });

    els.btnSaveMapelCfg.addEventListener('click', async () => {
        els.btnSaveMapelCfg.disabled = true;
        els.btnSaveMapelCfg.textContent = '⏳ Menyimpan...';
        try {
            const checked = Array.from(els.cfgMapelContainer.querySelectorAll('input:checked')).map(i => i.value);
            
            const resp = await fetch(`${CF_API_URL}/api/pid-games/config`, {
                method: 'POST',
                headers: await getAuthJsonHeaders(),
                body: JSON.stringify({ allowed_subjects: checked })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            
            allowedMapels = checked;
            renderEditFormMapels();
            toast('Pengaturan mapel berhasil disimpan ✅', 'success');
        } catch (e) {
            console.error(e);
            toast('Gagal menyimpan mapel', 'error');
        } finally {
            els.btnSaveMapelCfg.disabled = false;
            els.btnSaveMapelCfg.textContent = '💾 Simpan Pengaturan Mapel';
        }
    });
}

function setAdminGameEksternalState(isEksternal) {
    const active = Boolean(isEksternal);
    if (els.chkAdminGameEksternal) els.chkAdminGameEksternal.checked = active;
    if (active) {
        if (els.fAuthorSearch) {
            els.fAuthorSearch.disabled = true;
            els.fAuthorSearch.placeholder = 'Game publik / karya luar (tanpa nama guru)';
            els.fAuthorSearch.value = '';
            els.fAuthorSearch.style.background = 'rgba(15, 23, 42, 0.4)';
            els.fAuthorSearch.style.color = 'var(--text-muted)';
        }
        if (els.fAuthor) els.fAuthor.value = 'none';
        if (els.btnAdminSelfGtk) els.btnAdminSelfGtk.style.display = 'none';
        if (els.adminAuthorReqStar) els.adminAuthorReqStar.style.display = 'none';
        if (els.adminGtkHint) els.adminGtkHint.textContent = 'Karya umum / luar sekolah (nama guru tidak ditampilkan)';
        if (els.adminGtkDropdown) els.adminGtkDropdown.style.display = 'none';
    } else {
        if (els.fAuthorSearch) {
            els.fAuthorSearch.disabled = false;
            els.fAuthorSearch.placeholder = 'Ketik untuk mencari nama GTK...';
            els.fAuthorSearch.style.background = 'rgba(15, 23, 42, 0.8)';
            els.fAuthorSearch.style.color = 'var(--text)';
        }
        if (els.btnAdminSelfGtk) els.btnAdminSelfGtk.style.display = 'inline-block';
        if (els.adminAuthorReqStar) els.adminAuthorReqStar.style.display = 'inline';
        if (els.adminGtkHint) els.adminGtkHint.textContent = 'Wajib memilih dari data master GTK sekolah';
        selectAdminGtkTeacher(lastValidAdminTeacher || adminReviewer.name || 'Admin');
    }
    updateAdminLivePreview();
}

function selectAdminGtkTeacher(name) {
    const cleanName = String(name || '').trim();
    if (els.fAuthor) els.fAuthor.value = cleanName;
    if (els.fAuthorSearch) els.fAuthorSearch.value = cleanName;
    lastValidAdminTeacher = cleanName;
    if (els.adminGtkDropdown) els.adminGtkDropdown.style.display = 'none';
    updateAdminLivePreview();
}

function renderAdminGtkDropdown(filterQuery = '') {
    if (!els.adminGtkDropdown || els.chkAdminGameEksternal?.checked) return;
    const q = filterQuery.toLowerCase().trim();
    const filtered = adminGtkList.filter(t => 
        t.nama.toLowerCase().includes(q) || (t.nip && t.nip.includes(q))
    );

    if (filtered.length === 0) {
        els.adminGtkDropdown.innerHTML = '<div style="padding: 10px; font-size: 11.5px; color: var(--text-muted); text-align: center;">Tidak ada GTK yang cocok</div>';
    } else {
        els.adminGtkDropdown.innerHTML = filtered.map(t => `
            <div class="gtk-dropdown-item ${t.nama === els.fAuthor?.value ? 'active' : ''}" data-name="${esc(t.nama)}" style="padding: 8px 12px; font-size: 12px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; justify-content: space-between;">
                <span>${esc(t.nama)}</span>
                ${t.nip ? `<span style="font-size: 10px; color: var(--text-muted);">${esc(t.nip)}</span>` : ''}
            </div>
        `).join('');

        els.adminGtkDropdown.querySelectorAll('.gtk-dropdown-item').forEach(item => {
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                selectAdminGtkTeacher(item.dataset.name);
            });
        });
    }
    els.adminGtkDropdown.style.display = 'block';
}

function updateAdminLivePreview() {
    const previewContainer = document.getElementById('admin-card-preview');
    if (!previewContainer || !window.renderLiveCardPreview) return;

    const checkedMapels = Array.from(els.fMapelContainer.querySelectorAll('input:checked')).map(cb => cb.value);
    const checkedKats = Array.from(els.fCategoryContainer.querySelectorAll('input:checked')).map(cb => cb.value);
    
    let themeObj = null;
    if (els.fThemeData && els.fThemeData.value) {
        try { themeObj = JSON.parse(els.fThemeData.value); } catch(e) {}
    }

    const isEksternal = els.chkAdminGameEksternal && els.chkAdminGameEksternal.checked;
    const effectiveAuthor = isEksternal ? 'none' : (els.fAuthor?.value || adminReviewer.name || 'Admin');

    const gameData = {
        title: els.fTitle?.value.trim() || 'Judul Game',
        subject: checkedMapels.join(', ') || 'Umum',
        category: checkedKats.length > 0 ? checkedKats : ['lainnya'],
        author: effectiveAuthor,
        url: els.fUrl?.value.trim() || '#',
        thumbnail_url: els.fThumb?.value.trim() || '',
        theme: themeObj,
        is_active: true
    };

    window.renderLiveCardPreview(gameData, 'admin-card-preview');
}

function setupAdminAiAndCombobox() {
    if (els.chkAdminGameEksternal) {
        els.chkAdminGameEksternal.addEventListener('change', (e) => {
            setAdminGameEksternalState(e.target.checked);
        });
    }

    if (els.fAuthorSearch) {
        els.fAuthorSearch.addEventListener('focus', () => {
            if (!els.chkAdminGameEksternal?.checked) renderAdminGtkDropdown(els.fAuthorSearch.value);
        });
        els.fAuthorSearch.addEventListener('input', () => {
            if (!els.chkAdminGameEksternal?.checked) renderAdminGtkDropdown(els.fAuthorSearch.value);
        });
        els.fAuthorSearch.addEventListener('blur', () => {
            if (els.chkAdminGameEksternal?.checked) return;
            setTimeout(() => {
                if (els.adminGtkDropdown) els.adminGtkDropdown.style.display = 'none';
                const match = adminGtkList.find(t => t.nama.toLowerCase() === els.fAuthorSearch.value.trim().toLowerCase());
                if (match) {
                    selectAdminGtkTeacher(match.nama);
                } else if (lastValidAdminTeacher) {
                    selectAdminGtkTeacher(lastValidAdminTeacher);
                }
            }, 200);
        });
    }

    if (els.btnAdminSelfGtk) {
        els.btnAdminSelfGtk.addEventListener('click', () => {
            if (els.chkAdminGameEksternal?.checked) return;
            const selfName = adminReviewer.name || 'Admin';
            const matched = adminGtkList.find(t => t.nama.toLowerCase() === selfName.toLowerCase());
            selectAdminGtkTeacher(matched ? matched.nama : selfName);
        });
    }

    if (els.fTitle) els.fTitle.addEventListener('input', updateAdminLivePreview);
    if (els.fThumb) els.fThumb.addEventListener('input', updateAdminLivePreview);
    if (els.fMapelContainer) els.fMapelContainer.addEventListener('change', updateAdminLivePreview);
    if (els.fCategoryContainer) els.fCategoryContainer.addEventListener('change', updateAdminLivePreview);

    if (els.btnAdminAiInspect) {
        els.btnAdminAiInspect.addEventListener('click', async () => {
            const rawUrl = els.fUrl.value.trim();
            if (!rawUrl) {
                toast('Masukkan URL game terlebih dahulu', 'error');
                els.fUrl.focus();
                return;
            }

            let allKeys = window.getAllStoredGeminiApiKeys ? await window.getAllStoredGeminiApiKeys() : [];
            if (allKeys.length === 0) {
                const legacyKey = (window.getStoredGeminiApiKey ? await window.getStoredGeminiApiKey() : null) || localStorage.getItem('user_gemini_key');
                if (legacyKey) allKeys.push(legacyKey);
            }

            if (allKeys.length === 0) {
                const manualKey = prompt('Masukkan Google Gemini API Key Anda (dapatkan gratis di aistudio.google.com):');
                if (!manualKey || manualKey.length < 10) {
                    toast('API Key diperlukan untuk asisten AI', 'error');
                    return;
                }
                if (window.saveStoredGeminiApiKey) await window.saveStoredGeminiApiKey(manualKey);
                else localStorage.setItem('user_gemini_key', manualKey.trim());
                allKeys.push(manualKey.trim());
            }

            if (els.adminAiStatus) {
                els.adminAiStatus.style.display = 'flex';
                els.adminAiStatusText.textContent = '🤖 Sedang mengintip konten game dari URL...';
            }
            els.btnAdminAiInspect.disabled = true;

            try {
                const inspectData = window.inspectGameUrl ? await window.inspectGameUrl(rawUrl) : {};
                if (els.adminAiStatusText) els.adminAiStatusText.textContent = '🎨 Gemini AI sedang merancang tema visual & SVG...';

                const checkedMapels = Array.from(els.fMapelContainer.querySelectorAll('input:checked')).map(cb => cb.value);
                const checkedKats = Array.from(els.fCategoryContainer.querySelectorAll('input:checked')).map(cb => cb.value);

                const allAvailableMapels = Array.from(els.fMapelContainer.querySelectorAll('input')).map(cb => cb.value);
                const aiResult = window.generateCardVisualAI ? await window.generateCardVisualAI({
                    url: rawUrl,
                    inspectData,
                    title: els.fTitle.value.trim(),
                    subject: checkedMapels.join(', '),
                    category: checkedKats,
                    apiKey: allKeys,
                    availableSubjects: allAvailableMapels
                }) : null;

                if (aiResult) {
                    if (aiResult.title) els.fTitle.value = aiResult.title;
                    if (aiResult.description) els.fDesc.value = aiResult.description;

                    if (Array.isArray(aiResult.subject)) {
                        aiResult.subject.forEach(sub => {
                            const cb = els.fMapelContainer.querySelector(`input[value="${sub}"]`) ||
                                       Array.from(els.fMapelContainer.querySelectorAll('input')).find(i => i.value.toLowerCase() === sub.toLowerCase());
                            if (cb) cb.checked = true;
                        });
                    }

                    if (Array.isArray(aiResult.category)) {
                        aiResult.category.forEach(kat => {
                            const cb = els.fCategoryContainer.querySelector(`input[value="${kat}"]`);
                            if (cb) cb.checked = true;
                        });
                    }

                    if (aiResult.svg_illustration) {
                        const svgDataUri = (typeof window.safeSvgToDataUri === 'function')
                            ? window.safeSvgToDataUri(aiResult.svg_illustration)
                            : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(aiResult.svg_illustration).replace(/'/g, '%27')}`;
                        els.fThumb.value = svgDataUri;
                    }
                    if (aiResult.theme) {
                        els.fThemeData.value = JSON.stringify(aiResult.theme);
                    }

                    updateAdminLivePreview();
                    toast('Visual & Metadata kartu berhasil dirancang oleh Gemini AI ✨', 'success');
                }
            } catch (err) {
                console.error(err);
                toast('Gagal AI Inspector: ' + err.message, 'error');
            } finally {
                if (els.adminAiStatus) els.adminAiStatus.style.display = 'none';
                els.btnAdminAiInspect.disabled = false;
            }
        });
    }
}

// ==================== SAVE GAME (ADD / UPDATE) ====================
async function saveGame() {
    const title = els.fTitle.value.trim();
    const url = els.fUrl.value.trim();
    const isEksternal = els.chkAdminGameEksternal && els.chkAdminGameEksternal.checked;
    const author = isEksternal ? 'none' : els.fAuthor.value.trim();
    const checkedKats = Array.from(els.fCategoryContainer.querySelectorAll('input:checked')).map(cb => cb.value);

    // Validasi
    if (!title || !url || (!isEksternal && (!author || author === 'none')) || checkedKats.length === 0) {
        toast('Isi semua field wajib (*) dan pilih minimal 1 kategori', 'error');
        return;
    }

    const category = checkedKats;

    els.btnSave.disabled = true;
    els.btnSave.textContent = '⏳ Menyimpan...';

    const checkedMapels = Array.from(els.fMapelContainer.querySelectorAll('input:checked')).map(cb => cb.value);
    
    let themePayload = null;
    if (els.fThemeData && els.fThemeData.value) {
        try {
            themePayload = typeof els.fThemeData.value === 'string' ? JSON.parse(els.fThemeData.value) : els.fThemeData.value;
        } catch (e) {
            themePayload = null;
        }
    } else if (editingId) {
        themePayload = allGames.find(g => g.id === editingId)?.theme || null;
    }

    const existingGame = editingId ? allGames.find(g => g.id === editingId) : null;

    const data = {
        title,
        url,
        source_type: existingGame?.source_type || 'url',
        html_content: existingGame?.html_content || null,
        author: isEksternal ? 'none' : (author || 'none'),
        category,
        subject: checkedMapels.length > 0 ? checkedMapels.join(', ') : null,
        thumbnail_url: els.fThumb.value.trim() || null,
        theme: themePayload,
        description: els.fDesc.value.trim() || null,
        review_status: 'approved',
        is_active: existingGame ? (existingGame.is_active !== false) : true
    };

    try {
        if (editingId) {
            const resp = await fetch(`${CF_API_URL}/api/pid-games/${encodeURIComponent(editingId)}`, {
                method: 'PUT',
                headers: await getAuthJsonHeaders(),
                body: JSON.stringify(data)
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            toast('Game berhasil diperbarui ✅', 'success');
        } else {
            const resp = await fetch(`${CF_API_URL}/api/pid-games`, {
                method: 'POST',
                headers: await getAuthJsonHeaders(),
                body: JSON.stringify(data)
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            toast('Game berhasil ditambahkan 🎮', 'success');
        }

        clearForm();
        await loadGames();

    } catch (err) {
        console.error('Gagal simpan:', err);
        toast('Gagal menyimpan: ' + err.message, 'error');
    } finally {
        els.btnSave.disabled = false;
        els.btnSave.textContent = '💾 Simpan Game';
    }
}

// ==================== EDIT ====================
function startEdit(id) {
    const game = allGames.find(g => g.id === id);
    if (!game) return;

    editingId = id;
    els.formTitle.textContent = '✏️ Edit Game';
    els.fTitle.value = game.title || '';
    els.fUrl.value = game.url || '';
    
    if (!game.author || game.author === 'none') {
        setAdminGameEksternalState(true);
    } else {
        setAdminGameEksternalState(false);
        selectAdminGtkTeacher(game.author);
    }
    
    // Clear check
    els.fCategoryContainer.querySelectorAll('input').forEach(cb => cb.checked = false);
    if (Array.isArray(game.category)) {
        game.category.forEach(c => {
            const cb = els.fCategoryContainer.querySelector(`input[value="${c}"]`);
            if (cb) cb.checked = true;
        });
    } else if (game.category) {
        const cb = els.fCategoryContainer.querySelector(`input[value="${game.category}"]`);
        if (cb) cb.checked = true;
    }
    
    // Check mapel
    els.fMapelContainer.querySelectorAll('input').forEach(cb => cb.checked = false);
    if (game.subject) {
        const subjects = game.subject.split(',').map(s => s.trim());
        subjects.forEach(s => {
            const cb = els.fMapelContainer.querySelector(`input[value="${s}"]`);
            if (cb) cb.checked = true;
        });
    }

    els.fThumb.value = game.thumbnail_url || '';
    els.fDesc.value = game.description || '';
    if (els.fThemeData) els.fThemeData.value = game.theme ? JSON.stringify(game.theme) : '';
    els.btnCancel.style.display = '';
    els.btnSave.textContent = '💾 Update Game';

    document.getElementById('form-section').style.display = 'block';
    updateAdminLivePreview();

    document.getElementById('form-section').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
    clearForm();
}

function clearForm() {
    editingId = null;
    els.formTitle.textContent = 'Tambah Game Baru';
    els.fTitle.value = '';
    els.fUrl.value = '';
    setAdminGameEksternalState(false);
    selectAdminGtkTeacher(adminReviewer.name || 'Admin');
    els.fCategoryContainer.querySelectorAll('input').forEach(cb => cb.checked = false);
    els.fMapelContainer.querySelectorAll('input').forEach(cb => cb.checked = false);
    els.fThumb.value = '';
    els.fDesc.value = '';
    if (els.fThemeData) els.fThemeData.value = '';
    els.btnCancel.style.display = 'none';
    els.btnSave.textContent = '💾 Simpan Game';
    document.getElementById('form-section').style.display = 'none';
}

// ==================== VISIBILITY ACTION ====================
async function toggleVisibility(id, checked) {
    try {
        const resp = await fetch(`${CF_API_URL}/api/pid-games/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: await getAuthJsonHeaders(),
            body: JSON.stringify({ is_active: checked })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        updateMetaTimestamp();
        const game = allGames.find(g => g.id === id);
        if (game) {
            game.is_active = checked;
        }
        renderStats();
        renderTable();
        toast(checked ? 'Game di-set Tayang ✅' : 'Game di-set Tidak Tayang', 'success');
    } catch (err) {
        console.error('Gagal toggle visibilitas:', err);
        toast('Gagal mengubah status game: ' + err.message, 'error');
        await loadGames();
    }
}

// ==================== DELETE ====================
async function deleteGame(id, title) {
    const ok = typeof window.showConfirmModal === 'function'
        ? await window.showConfirmModal(`Hapus game "${title}"? Aksi ini tidak bisa dibatalkan.`, 'Hapus Game', 'danger')
        : true;
    if (!ok) return;

    try {
        const resp = await fetch(`${CF_API_URL}/api/pid-games/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: await getAuthJsonHeaders()
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        updateMetaTimestamp();
        toast('Game dihapus 🗑️', 'success');
        await loadGames();
    } catch (err) {
        console.error('Gagal hapus:', err);
        toast('Gagal menghapus: ' + err.message, 'error');
    }
}

// ==================== UPDATE METADATA TIMESTAMP ====================
function updateMetaTimestamp() {
    localStorage.removeItem('simas_game_pid_config_cache');
    localStorage.removeItem('pid_games_data');
    localStorage.removeItem('pid_games_ts');
}

// ==================== HELPERS ====================
function getAdminStatusBadge(isVisible) {
    if (isVisible) return '<span class="status-badge status-approved">🟢 Tayang</span>';
    return '<span class="status-badge status-hidden">👁️ Tidak Tayang</span>';
}

function buildAdminActionButtons(game) {
    const safeId = esc(game.id);
    const isVisible = game.is_active !== false;

    return `
        <div class="toggle-wrap">
            <label class="switch">
                <input type="checkbox" ${isVisible ? 'checked' : ''} onchange="toggleVisibility('${safeId}', this.checked)">
                <span class="slider"></span>
            </label>
            <span style="font-size:12px; font-weight:700; color: ${isVisible ? '#34d399' : '#94a3b8'};">${isVisible ? 'Tayang' : 'Tidak Tayang'}</span>
        </div>
    `;
}


// ==================== TOAST ====================
function toast(msg, type = 'success') {
    els.toast.textContent = msg;
    els.toast.className = `toast ${type} show`;
    setTimeout(() => {
        els.toast.classList.remove('show');
    }, 3000);
}

// ==================== HELPERS ====================
function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

window.startEdit = startEdit;
window.deleteGame = deleteGame;
window.toggleVisibility = toggleVisibility;
window.cancelEdit = cancelEdit;

})();
