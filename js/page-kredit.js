/* js/page-kredit.js - Master Jenis Pelanggaran via Cloudflare D1 (0 Firestore RW) */
import { auth } from './config.js';
import { cfClient } from './cloudflare-client.js';
import { initLayout } from './global.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

let typesCache = [];
let deleteTargetId = null;

// --- SESSION CACHE HELPERS ---
const CACHE_KEY_TYPES = 'session_violation_types';

function getSessionCache(key) {
    try {
        return JSON.parse(sessionStorage.getItem(key));
    } catch (e) { return null; }
}

function setSessionCache(key, data) {
    try {
        sessionStorage.setItem(key, JSON.stringify(data));
    } catch (e) { console.warn('[Cache] Error:', e); }
}

function clearTypesCache() {
    sessionStorage.removeItem(CACHE_KEY_TYPES);
}

// --- HELPER: MODERN ALERT ---
function showModernAlert(title, message, type = 'success') {
    const modal = document.getElementById('modal-alert');
    if (!modal) { showToast(title, message.replace(/<[^>]*>?/gm, ''), type === 'success' ? 'success' : 'error'); return; }

    const iconBg = document.getElementById('alert-icon-bg');
    const icon = document.getElementById('alert-icon');
    const titleEl = document.getElementById('alert-title');
    const msgEl = document.getElementById('alert-msg');

    if (type === 'success') {
        iconBg.className = "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-green-100 text-green-600 animate-bounce-slow";
        icon.className = "fa-solid fa-check text-3xl";
    } else {
        iconBg.className = "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-red-100 text-red-600 animate-pulse";
        icon.className = "fa-solid fa-xmark text-3xl";
    }

    titleEl.innerText = title;
    msgEl.innerHTML = message;
    modal.classList.remove('hidden');
}

onAuthStateChanged(auth, (user) => {
    if (!user) { window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash); return; }

    const role = localStorage.getItem('user_role');

    // --- MULTI-ROLE ACCESS CHECK ---
    const effectiveRole = window.getEffectiveRoleForPage ?
        window.getEffectiveRoleForPage('kredit.html') : role;

    initLayout(effectiveRole);
    document.querySelector('main').classList.remove('hidden');

    loadTypes(effectiveRole); // Pass role to filtering

    // Hide Form Add & Import for non-editors
    // Cek dengan hasRole untuk multi-role support
    const canAddImport = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('kesiswaan') || window.hasRole('staff')) :
        ['super_admin', 'kesiswaan', 'staff'].includes(role);

    if (!canAddImport) {
        const btnAdd = document.querySelector('button[onclick*="modal-add-type"]');
        if (btnAdd) btnAdd.classList.add('hidden');

        // Sembunyikan Tombol Import
        const btnImp = document.querySelector('button[onclick*="modal-import"]');
        if (btnImp) btnImp.classList.add('hidden');
    }

    setupForms();
});

async function loadTypes(role, forceRefresh = false) {
    const tbody = document.getElementById('types-table-body');
    const table = tbody.closest('table'); // Ambil referensi tabel

    // Guru BK boleh EDIT, tapi TIDAK boleh Delete/Add/Import
    // Multi-role support dengan window.hasRole()
    const canEdit = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('guru_bk') || window.hasRole('kesiswaan') || window.hasRole('staff')) :
        ['super_admin', 'guru_bk', 'kesiswaan', 'staff'].includes(role);
    const canDelete = window.hasRole ?
        (window.hasRole('super_admin') || window.hasRole('kesiswaan') || window.hasRole('staff')) :
        ['super_admin', 'kesiswaan', 'staff'].includes(role);

    // LOGIC HEADERS: Sembunyikan Header 'Aksi' jika sama sekali tidak ada akses (misal siswa/ortu)
    if (table) {
        const thList = table.querySelectorAll('thead th');
        if (thList.length > 0) {
            const lastTh = thList[thList.length - 1]; // Asumsi Kolom Aksi ada di terakhir
            lastTh.style.display = canEdit ? 'table-cell' : 'none';
        }
    }

    try {
        // === SESSION CACHE ===
        if (!forceRefresh) {
            const cached = getSessionCache(CACHE_KEY_TYPES);
            if (cached && cached.length > 0) {
                console.log('[Kredit] Menggunakan session cache jenis pelanggaran');
                typesCache = cached;
                renderTypesTable(tbody, typesCache, canEdit, canDelete);
                return;
            }
        }

        // 1. Ambil murni dari Cloudflare D1 (0 Firestore Read)
        const data = await cfClient.getViolationTypes();
        typesCache = Array.isArray(data) ? data : (data?.rows || data?.data || []);

        if (typesCache.length === 0) {
            const colSpan = canEdit ? 6 : 5;
            tbody.innerHTML = `<tr><td colspan="${colSpan}" class="p-8 text-center text-slate-400">Belum ada data. Silakan Import.</td></tr>`;
            return;
        }

        // Simpan ke session cache
        setSessionCache(CACHE_KEY_TYPES, typesCache);
        console.log('[Kredit] Jenis pelanggaran di-cache ke sessionStorage (' + typesCache.length + ' data)');

        renderTypesTable(tbody, typesCache, canEdit, canDelete);
    } catch (e) { console.error(e); }
}

// Helper function untuk render table
function renderTypesTable(tbody, data, canEdit, canDelete) {
    if (data.length === 0) {
        const colSpan = canEdit ? 6 : 5;
        tbody.innerHTML = `<tr><td colspan="${colSpan}" class="p-8 text-center text-slate-400">Belum ada data. Silakan Import.</td></tr>`;
        return;
    }

    let html = '';
    data.forEach(d => {
        let severityBadge = '';
        if (d.points >= 36) severityBadge = '<span class="text-red-600 font-bold text-xs uppercase">Berat</span>';
        else if (d.points >= 11) severityBadge = '<span class="text-orange-500 font-bold text-xs uppercase">Sedang</span>';
        else severityBadge = '<span class="text-green-600 font-bold text-xs uppercase">Ringan</span>';

        const catClass = d.category === 'Pelanggaran Berat' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-slate-100 text-slate-600 border-slate-200';

        // LOGIC COLUMN: Render kolom aksi HANYA jika canEdit
        const actionColumn = canEdit ? `
            <td class="px-6 py-4 text-center">
                <div class="flex justify-center gap-1 opacity-100 group-hover:opacity-100 transition-opacity">
                    <button onclick="window.openEditType('${d.id}')" class="w-8 h-8 rounded hover:bg-orange-100 text-slate-400 hover:text-orange-600 transition" title="Edit">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    ${canDelete ? `
                    <button onclick="window.confirmDeleteType('${d.id}')" class="w-8 h-8 rounded hover:bg-red-100 text-slate-400 hover:text-red-600 transition" title="Hapus">
                        <i class="fa-solid fa-trash"></i>
                    </button>` : ''}
                </div>
            </td>` : '';

        html += `
        <tr class="hover:bg-slate-50 border-b border-slate-50 transition-colors group">
            <td class="px-6 py-4 font-mono text-xs font-bold text-slate-500">${window.escapeHTML(d.code || '-')}</td>
            <td class="px-6 py-4"><div class="font-bold text-slate-700 text-sm">${window.escapeHTML(d.title)}</div></td>
            <td class="px-6 py-4"><span class="${catClass} px-2 py-1 rounded text-[10px] font-bold uppercase border whitespace-nowrap">${window.escapeHTML(d.category || 'Umum')}</span></td>
            <td class="px-6 py-4 text-center border-l border-slate-50">${severityBadge}</td>
            <td class="px-6 py-4 text-center">
                <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center mx-auto font-bold text-slate-700 text-xs border border-slate-200">${d.points}</div>
            </td>
            ${actionColumn}
        </tr>`;
    });
    tbody.innerHTML = html;
}

function setupForms() {
    // 1. ADD FORM (SMART UPDATE: Jika Kode Sama -> Update)
    document.getElementById('form-add-type').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const originalText = btn.innerText;
        btn.disabled = true; btn.innerText = 'Menyimpan...';

        try {
            const formData = new FormData(e.target);
            const inputCode = formData.get('code').trim();
            const points = parseInt(formData.get('points'), 10) || 0;

            const newData = {
                code: inputCode,
                title: formData.get('title').trim(),
                category: formData.get('category'),
                points: points
            };

            const res = await cfClient.saveViolationType(newData, false, inputCode);

            if (typeof window.logAudit === 'function') {
                window.logAudit(res.isUpdate ? 'UPDATE_VIOLATION_TYPE' : 'CREATE_VIOLATION_TYPE', inputCode, null, newData, `${res.isUpdate ? 'Memperbarui' : 'Menambahkan'} master pelanggaran ${inputCode} via D1`);
            }

            showModernAlert(res.isUpdate ? "Data Diperbarui" : "Berhasil", res.message || `Data pelanggaran <b>${window.escapeHTML(inputCode)}</b> berhasil disimpan.`);

            e.target.reset();
            document.getElementById('modal-add-type').classList.add('hidden');
            clearTypesCache();
            loadTypes(localStorage.getItem('user_role'), true);

        } catch (error) {
            showModernAlert("Gagal", error.message, 'error');
        } finally {
            btn.disabled = false; btn.innerText = originalText;
        }
    });

    // 2. IMPORT FORM (SMART UPDATE: Batch Logic via D1)
    document.getElementById('btn-process-import').addEventListener('click', async () => {
        const rawText = document.getElementById('paste-area').value.trim();
        if (!rawText) { showToast("Info", "Paste data dulu.", "info"); return; }

        const btn = document.getElementById('btn-process-import');
        btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';

        try {
            const rows = rawText.split('\n');
            const itemsToSync = [];

            rows.forEach(row => {
                const cols = row.split('\t');
                if (cols.length >= 4) {
                    const code = cols[0].trim();
                    const title = cols[1].trim();
                    const category = cols[2].trim();
                    const points = parseInt(cols[3].trim(), 10) || 0;

                    if (code && title) {
                        itemsToSync.push({
                            id: code,
                            code: code,
                            title: title,
                            category: category,
                            points: points
                        });
                    }
                }
            });

            if (itemsToSync.length > 0) {
                const res = await cfClient.bulkSyncViolationTypes(itemsToSync);

                if (typeof window.logAudit === 'function') {
                    window.logAudit('IMPORT_VIOLATION_TYPES', 'batch_import', null, { count: itemsToSync.length }, `Mengimpor ${itemsToSync.length} data master pelanggaran ke Cloudflare D1`);
                }

                clearTypesCache();
                loadTypes(localStorage.getItem('user_role'), true);
                document.getElementById('modal-import').classList.add('hidden');
                document.getElementById('paste-area').value = '';

                showModernAlert(
                    "Proses Selesai!",
                    `<b>${itemsToSync.length}</b> Data Jenis Pelanggaran berhasil disinkronkan ke Cloudflare D1.`
                );
            } else {
                showModernAlert("Gagal", "Format data tidak terbaca atau kosong.", "error");
            }
        } catch (e) {
            console.error(e);
            showModernAlert("Error", e.message, "error");
        } finally {
            btn.disabled = false; btn.innerText = 'Proses Data';
        }
    });

    // 3. EDIT FORM (Update by ID via D1)
    document.getElementById('form-edit-type').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const originalText = btn.innerText;
        btn.disabled = true; btn.innerText = 'Menyimpan...';

        try {
            const formData = new FormData(e.target);
            const id = formData.get('id');
            const points = parseInt(formData.get('points'), 10) || 0;

            const oldData = typesCache.find(x => x.id === id) || null;
            const updatePayload = {
                code: formData.get('code') ? formData.get('code').trim() : (oldData?.code || ''),
                title: formData.get('title').trim(),
                category: formData.get('category'),
                points: points
            };

            await cfClient.saveViolationType(updatePayload, true, id);

            if (typeof window.logAudit === 'function') {
                window.logAudit('UPDATE_VIOLATION_TYPE', id, oldData, updatePayload, `Mengkoreksi master pelanggaran ${id} via D1`);
            }

            document.getElementById('modal-edit-type').classList.add('hidden');
            showModernAlert("Berhasil", "Data berhasil diperbarui di Cloudflare D1.");
            clearTypesCache();
            loadTypes(localStorage.getItem('user_role'), true);

        } catch (error) {
            showModernAlert("Gagal", error.message, 'error');
        } finally {
            btn.disabled = false; btn.innerText = originalText;
        }
    });
}

// --- HELPERS ---
window.openEditType = (id) => {
    const data = typesCache.find(x => x.id === id);
    if (!data) return;
    document.getElementById('edit-id').value = id;

    // REVISI: Lock kode agar tidak bisa diedit
    const codeInput = document.getElementById('edit-code');
    codeInput.value = data.code || '';
    codeInput.readOnly = true;
    codeInput.classList.remove('bg-slate-50'); // latar terkunci menggantikan latar dasar (urutan CSS Tailwind build)
    codeInput.classList.add('bg-slate-100', 'text-slate-500', 'cursor-not-allowed');

    document.getElementById('edit-title').value = data.title || '';
    document.getElementById('edit-category').value = data.category || 'Kedisiplinan';
    document.getElementById('edit-points').value = data.points || 0;
    document.getElementById('modal-edit-type').classList.remove('hidden');
};

window.confirmDeleteType = (id) => {
    deleteTargetId = id;
    document.getElementById('modal-confirm').classList.remove('hidden');
};

window.executeDelete = async () => {
    if (!deleteTargetId) return;
    const btn = document.querySelector('#modal-confirm button.bg-red-600');
    const originalText = btn.innerText;
    btn.innerText = "..."; btn.disabled = true;

    try {
        const deletedType = typesCache.find(x => x.id === deleteTargetId) || null;
        await cfClient.deleteViolationType(deleteTargetId);

        if (typeof window.logAudit === 'function') {
            window.logAudit('DELETE_VIOLATION_TYPE', deleteTargetId, deletedType, null, `Menghapus master pelanggaran ${deleteTargetId} dari D1`);
        }

        document.getElementById('modal-confirm').classList.add('hidden');
        showModernAlert("Terhapus", "Data pelanggaran telah dihapus dari Cloudflare D1.");
        clearTypesCache();
        loadTypes(localStorage.getItem('user_role'), true);
    } catch (e) {
        showModernAlert("Gagal", e.message, 'error');
    } finally {
        btn.innerText = originalText; btn.disabled = false; deleteTargetId = null;
    }
};
