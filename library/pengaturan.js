/* library/pengaturan.js - Pengaturan Operasional Perpustakaan */
import { auth, db, PATHS, supabase } from '../js/config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { initLayout, escapeHTML } from '../js/global.js';

// =========================================================================
// 1. STATE
// =========================================================================
let ddcList = [];
let allGtkList = [];
let selectedKepalaPerpus = { id: '', nama: '', nip: '' };
let _isKepalaPerpusComboboxInit = false;

// =========================================================================
// 2. AUTH & INITIALIZATION
// =========================================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '../index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
        return;
    }

    const primaryRole = localStorage.getItem('user_role') || 'guru_mapel';
    const allRoles = window.getAllUserRoles ? window.getAllUserRoles() : [primaryRole];
    
    // RBAC: super_admin, admin_perpus
    const allowedRoles = ['super_admin', 'admin_perpus'];
    const hasAccess = allRoles.some(r => allowedRoles.includes(r));

    if (!hasAccess) {
        Swal.fire({
            icon: 'error',
            title: 'Akses Ditolak',
            text: 'Halaman Pengaturan Perpustakaan hanya untuk Super Admin dan Admin Perpustakaan.',
            confirmButtonColor: '#2563eb'
        }).then(() => {
            window.location.href = 'index.html';
        });
        return;
    }

    await initLayout(primaryRole);
    document.querySelector('main')?.classList.remove('hidden');

    await loadGtkMaster();
    await loadConfigurations();
    await loadMasterDDC();
    setupEventListeners();
});

async function loadGtkMaster() {
    try {
        if (typeof window.getTeachersCache === 'function') {
            allGtkList = await window.getTeachersCache().catch(() => []);
        } else if (typeof window.getGtkCache === 'function') {
            allGtkList = await window.getGtkCache().catch(() => []);
        }
        if (!Array.isArray(allGtkList)) allGtkList = [];
    } catch (err) {
        console.warn('[Pengaturan] Gagal memuat data GTK:', err);
        allGtkList = [];
    }
}

// =========================================================================
// 3. LOAD CONFIGURATIONS & TOGGLE RULES
// =========================================================================
const TOGGLE_FIELDS = [
    {
        toggleId: 'cfg-toggle-max-pinjam-siswa',
        inputId: 'cfg-max-pinjam-siswa',
        labelId: 'cfg-label-max-pinjam-siswa',
        hintId: 'cfg-hint-max-pinjam-siswa',
        configKey: 'enable_max_pinjam_siswa',
        activeHint: 'Jumlah buku per siswa.',
        inactiveHint: 'Bebas kuota: Siswa dapat meminjam tanpa batas maksimal buku.',
        inactivePlaceholder: 'Tanpa Batas (Unlimited)'
    },
    {
        toggleId: 'cfg-toggle-max-pinjam-guru',
        inputId: 'cfg-max-pinjam-guru',
        labelId: 'cfg-label-max-pinjam-guru',
        hintId: 'cfg-hint-max-pinjam-guru',
        configKey: 'enable_max_pinjam_guru',
        activeHint: 'Jumlah buku per guru/staf.',
        inactiveHint: 'Bebas kuota: Guru/staf dapat meminjam tanpa batas maksimal buku.',
        inactivePlaceholder: 'Tanpa Batas (Unlimited)'
    },
    {
        toggleId: 'cfg-toggle-durasi-siswa',
        inputId: 'cfg-durasi-siswa',
        labelId: 'cfg-label-durasi-siswa',
        hintId: 'cfg-hint-durasi-siswa',
        configKey: 'enable_durasi_siswa',
        activeHint: 'Masa pinjam standar per transaksi.',
        inactiveHint: 'Bebas durasi: Waktu pinjam siswa fleksibel / tidak dibatasi.',
        inactivePlaceholder: 'Bebas Durasi / Fleksibel'
    },
    {
        toggleId: 'cfg-toggle-durasi-guru',
        inputId: 'cfg-durasi-guru',
        labelId: 'cfg-label-durasi-guru',
        hintId: 'cfg-hint-durasi-guru',
        configKey: 'enable_durasi_guru',
        activeHint: 'Masa pinjam standar guru/staf.',
        inactiveHint: 'Bebas durasi: Waktu pinjam guru/staf fleksibel / tidak dibatasi.',
        inactivePlaceholder: 'Bebas Durasi / Fleksibel'
    },
    {
        toggleId: 'cfg-toggle-denda',
        inputId: 'cfg-tarif-denda',
        labelId: 'cfg-label-denda',
        hintId: 'cfg-hint-denda',
        configKey: 'enable_denda',
        activeHint: 'Denda keterlambatan per buku per hari.',
        inactiveHint: 'Bebas denda: Tidak dikenakan sanksi denda keterlambatan (Rp 0).',
        inactivePlaceholder: 'Bebas Denda (Rp 0)'
    },
    {
        toggleId: 'cfg-toggle-max-perpanjangan',
        inputId: 'cfg-max-perpanjangan',
        labelId: 'cfg-label-max-perpanjangan',
        hintId: 'cfg-hint-max-perpanjangan',
        configKey: 'enable_max_perpanjangan',
        activeHint: 'Jumlah maksimal perpanjangan masa pinjam.',
        inactiveHint: 'Tanpa batas: Peminjaman buku dapat diperpanjang berkali-kali.',
        inactivePlaceholder: 'Tanpa Batas Perpanjangan'
    }
];

function syncToggleFieldUI(field) {
    const toggleEl = document.getElementById(field.toggleId);
    const inputEl = document.getElementById(field.inputId);
    const labelEl = document.getElementById(field.labelId);
    const hintEl = document.getElementById(field.hintId);
    if (!toggleEl || !inputEl) return;

    const isEnabled = toggleEl.checked;
    inputEl.disabled = !isEnabled;
    inputEl.required = isEnabled;

    if (isEnabled) {
        if (labelEl) {
            labelEl.textContent = 'Aktif';
            labelEl.className = 'text-[10px] font-bold text-blue-600 dark:text-blue-400';
        }
        inputEl.classList.remove('opacity-40', 'bg-slate-100', 'dark:bg-slate-800', 'cursor-not-allowed', 'border-dashed');
        inputEl.classList.add('bg-white', 'dark:bg-slate-900');
        if (hintEl) {
            hintEl.textContent = field.activeHint;
            hintEl.className = 'text-[10px] text-slate-400 mt-0.5';
        }
    } else {
        if (labelEl) {
            labelEl.textContent = 'Nonaktif';
            labelEl.className = 'text-[10px] font-bold text-slate-400 dark:text-slate-500';
        }
        // Lepas latar dasar agar latar nonaktif tidak kalah urutan CSS (Tailwind build mengurutkan class sejenis secara alfabetis)
        inputEl.classList.remove('bg-white', 'dark:bg-slate-900');
        inputEl.classList.add('opacity-40', 'bg-slate-100', 'dark:bg-slate-800', 'cursor-not-allowed', 'border-dashed');
        inputEl.placeholder = field.inactivePlaceholder;
        if (hintEl) {
            hintEl.textContent = field.inactiveHint;
            hintEl.className = 'text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-0.5';
        }
    }
}

// =========================================================================
// SEARCHABLE COMBOBOX GTK: KEPALA PERPUSTAKAAN
// =========================================================================
function setupKepalaPerpusCombobox() {
    if (_isKepalaPerpusComboboxInit) return;
    const searchInput = document.getElementById('cfg-kepala-perpus-search');
    const dropdown = document.getElementById('cfg-kepala-perpus-dropdown');
    const container = document.getElementById('container-cfg-kepala-perpus');
    const btnToggle = document.getElementById('btn-toggle-kepala-perpus');
    const btnClear = document.getElementById('btn-clear-kepala-perpus');
    if (!searchInput || !dropdown) return;

    _isKepalaPerpusComboboxInit = true;

    // Live search
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (btnClear) {
            if (e.target.value.length > 0) btnClear.classList.remove('hidden');
            else btnClear.classList.add('hidden');
        }
        renderKepalaPerpusDropdownOptions(query);
        openKepalaPerpusDropdown();
    });

    // Focus input
    searchInput.addEventListener('focus', () => {
        const query = searchInput.value.trim();
        renderKepalaPerpusDropdownOptions(query);
        openKepalaPerpusDropdown();
    });

    // Toggle dropdown button
    btnToggle?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleKepalaPerpusDropdown();
    });

    // Clear selection button
    btnClear?.addEventListener('click', (e) => {
        e.stopPropagation();
        window.clearKepalaPerpusSelection();
    });

    // Klik di luar container untuk menutup dropdown
    document.addEventListener('click', (e) => {
        if (container && !container.contains(e.target)) {
            closeKepalaPerpusDropdown();
        }
    });

    // Keyboard navigation pada Search Input
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeKepalaPerpusDropdown();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            openKepalaPerpusDropdown();
            const firstBtn = dropdown.querySelector('button[data-gtk-id]');
            if (firstBtn) firstBtn.focus();
        }
    });

    // Keyboard navigation di dalam dropdown list
    dropdown.addEventListener('keydown', (e) => {
        const buttons = Array.from(dropdown.querySelectorAll('button[data-gtk-id]'));
        const activeIdx = buttons.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (activeIdx >= 0 && activeIdx < buttons.length - 1) {
                buttons[activeIdx + 1].focus();
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (activeIdx > 0) {
                buttons[activeIdx - 1].focus();
            } else {
                searchInput.focus();
            }
        } else if (e.key === 'Escape') {
            closeKepalaPerpusDropdown();
            searchInput.focus();
        }
    });
}

function openKepalaPerpusDropdown() {
    const dropdown = document.getElementById('cfg-kepala-perpus-dropdown');
    const chevron = document.getElementById('icon-kepala-perpus-chevron');
    const searchInput = document.getElementById('cfg-kepala-perpus-search');
    if (dropdown) dropdown.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
    if (searchInput) searchInput.setAttribute('aria-expanded', 'true');
}

function closeKepalaPerpusDropdown() {
    const dropdown = document.getElementById('cfg-kepala-perpus-dropdown');
    const chevron = document.getElementById('icon-kepala-perpus-chevron');
    const searchInput = document.getElementById('cfg-kepala-perpus-search');
    if (dropdown) dropdown.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
    if (searchInput) searchInput.setAttribute('aria-expanded', 'false');
}

function toggleKepalaPerpusDropdown() {
    const dropdown = document.getElementById('cfg-kepala-perpus-dropdown');
    if (!dropdown) return;
    if (dropdown.classList.contains('hidden')) {
        const searchInput = document.getElementById('cfg-kepala-perpus-search');
        renderKepalaPerpusDropdownOptions(searchInput ? searchInput.value.trim() : '');
        openKepalaPerpusDropdown();
        searchInput?.focus();
    } else {
        closeKepalaPerpusDropdown();
    }
}

function renderKepalaPerpusDropdownOptions(query = '') {
    const dropdown = document.getElementById('cfg-kepala-perpus-dropdown');
    if (!dropdown) return;

    const currentId = document.getElementById('cfg-kepala-perpus-id')?.value || '';
    const lower = query.toLowerCase().trim();

    const sortedGtk = [...allGtkList].sort((a, b) => (a.name || a.nama || '').localeCompare(b.name || b.nama || ''));
    const filtered = sortedGtk.filter(g => {
        if (!lower) return true;
        const nameMatch = (g.name || g.nama || '').toLowerCase().includes(lower);
        const nipMatch = (g.nip || '').toString().toLowerCase().includes(lower);
        return nameMatch || nipMatch;
    });

    let html = `
        <button type="button" onclick="window.clearKepalaPerpusSelection()"
            class="w-full text-left px-3.5 py-2.5 bg-slate-50/80 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700/60">
            <span class="text-xs text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5">
                <i class="fa-solid fa-user-slash text-slate-400 text-[11px]"></i>
                -- Kosongkan / Belum Ditentukan --
            </span>
            ${!currentId ? '<i class="fa-solid fa-check text-blue-600 dark:text-blue-400 text-xs font-bold"></i>' : ''}
        </button>
    `;

    if (filtered.length === 0) {
        html += `
            <div class="p-4 text-center text-xs text-slate-400 italic">
                <i class="fa-solid fa-user-xmark text-base mb-1 block opacity-60"></i>
                Tidak ditemukan GTK dengan kata kunci "${escapeHTML(query)}"
            </div>
        `;
    } else {
        filtered.forEach(g => {
            const gId = String(g.id || g.nip || '');
            const gName = g.name || g.nama || 'Tanpa Nama';
            const rawNip = (g.nip && String(g.nip).trim() !== '-' && String(g.nip).trim() !== '') ? String(g.nip).trim() : '';
            const isSelected = gId && gId === currentId;
            const nipDisplay = rawNip ? `<span class="text-[11px] text-slate-400 font-mono">(NIP: ${escapeHTML(rawNip)})</span>` : '<span class="text-[10px] text-slate-400 italic font-mono">(Non-NIP)</span>';

            html += `
                <button type="button" data-gtk-id="${escapeHTML(gId)}" onclick="window.selectKepalaPerpus('${escapeHTML(gId)}', '${escapeHTML(gName)}', '${escapeHTML(rawNip)}')"
                    class="w-full text-left px-3.5 py-2.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition flex items-center justify-between gap-2 ${isSelected ? 'bg-blue-50/90 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold' : 'text-slate-700 dark:text-slate-200'}">
                    <div class="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
                        <span class="text-xs font-semibold">${escapeHTML(gName)}</span>
                        ${nipDisplay}
                    </div>
                    ${isSelected ? '<i class="fa-solid fa-check text-blue-600 dark:text-blue-400 text-xs font-bold shrink-0"></i>' : ''}
                </button>
            `;
        });
    }

    dropdown.innerHTML = html;
}

window.selectKepalaPerpus = function(id, name, nip) {
    selectedKepalaPerpus = { id, nama: name, nip };

    const searchInput = document.getElementById('cfg-kepala-perpus-search');
    const idInput = document.getElementById('cfg-kepala-perpus-id');
    const namaInput = document.getElementById('cfg-kepala-perpus-nama');
    const nipInput = document.getElementById('cfg-kepala-perpus-nip');
    const clearBtn = document.getElementById('btn-clear-kepala-perpus');
    const infoBox = document.getElementById('cfg-kepala-perpus-info');
    const selectedText = document.getElementById('cfg-kepala-perpus-selected-text');
    const selectedNip = document.getElementById('cfg-kepala-perpus-selected-nip');

    if (idInput) idInput.value = id;
    if (namaInput) namaInput.value = name;
    if (nipInput) nipInput.value = nip || '-';

    if (searchInput) {
        searchInput.value = nip ? `${name} (NIP: ${nip})` : name;
    }
    if (clearBtn) clearBtn.classList.remove('hidden');

    if (infoBox && selectedText && selectedNip) {
        selectedText.textContent = name;
        selectedNip.textContent = nip ? `NIP. ${nip}` : 'NIP. -';
        infoBox.classList.remove('hidden');
    }

    closeKepalaPerpusDropdown();
};

window.clearKepalaPerpusSelection = function() {
    selectedKepalaPerpus = { id: '', nama: '', nip: '' };

    const searchInput = document.getElementById('cfg-kepala-perpus-search');
    const idInput = document.getElementById('cfg-kepala-perpus-id');
    const namaInput = document.getElementById('cfg-kepala-perpus-nama');
    const nipInput = document.getElementById('cfg-kepala-perpus-nip');
    const clearBtn = document.getElementById('btn-clear-kepala-perpus');
    const infoBox = document.getElementById('cfg-kepala-perpus-info');

    if (idInput) idInput.value = '';
    if (namaInput) namaInput.value = '';
    if (nipInput) nipInput.value = '';
    if (searchInput) searchInput.value = '';
    if (clearBtn) clearBtn.classList.add('hidden');
    if (infoBox) infoBox.classList.add('hidden');

    closeKepalaPerpusDropdown();
};

async function loadConfigurations() {
    try {
        const { data, error } = await supabase.from('lib_config').select('key, value');
        if (error) throw error;

        const configMap = {};
        if (data) {
            data.forEach(item => {
                configMap[item.key] = item.value;
            });
        }

        if (configMap.nama_perpustakaan) document.getElementById('cfg-nama-perpustakaan').value = configMap.nama_perpustakaan;
        if (configMap.max_pinjam_siswa) document.getElementById('cfg-max-pinjam-siswa').value = configMap.max_pinjam_siswa;
        if (configMap.max_pinjam_guru) document.getElementById('cfg-max-pinjam-guru').value = configMap.max_pinjam_guru;
        if (configMap.durasi_pinjam_siswa_hari) document.getElementById('cfg-durasi-siswa').value = configMap.durasi_pinjam_siswa_hari;
        if (configMap.durasi_pinjam_guru_hari) document.getElementById('cfg-durasi-guru').value = configMap.durasi_pinjam_guru_hari;
        if (configMap.tarif_denda_per_hari) document.getElementById('cfg-tarif-denda').value = configMap.tarif_denda_per_hari;
        if (configMap.max_perpanjangan) document.getElementById('cfg-max-perpanjangan').value = configMap.max_perpanjangan;
        if (configMap.prefix_nomor_induk !== undefined) document.getElementById('cfg-prefix-nomor-induk').value = configMap.prefix_nomor_induk;
        if (configMap.abaikan_hari_libur) document.getElementById('cfg-abaikan-libur').checked = configMap.abaikan_hari_libur === 'true';
        if (configMap.tampilkan_alumni) document.getElementById('cfg-tampilkan-alumni').checked = configMap.tampilkan_alumni === 'true';

        // Bind Konfigurasi Kepala Perpustakaan
        if (configMap.kepala_perpustakaan_id || configMap.kepala_perpustakaan_nama) {
            const kId = configMap.kepala_perpustakaan_id || '';
            let kNama = configMap.kepala_perpustakaan_nama || '';
            let kNip = configMap.kepala_perpustakaan_nip || '';

            // Jika kId ada namun nama belum tersimpan di DB, cari di master GTK
            if (kId && !kNama && allGtkList.length > 0) {
                const found = allGtkList.find(g => String(g.id || g.nip) === String(kId));
                if (found) {
                    kNama = found.name || found.nama || '';
                    kNip = found.nip && String(found.nip).trim() !== '-' ? String(found.nip).trim() : '-';
                }
            }

            if (kNama) {
                window.selectKepalaPerpus(kId, kNama, kNip);
            }
        }

        // Bind Toggles
        TOGGLE_FIELDS.forEach(field => {
            const toggleEl = document.getElementById(field.toggleId);
            if (toggleEl) {
                if (configMap[field.configKey] !== undefined) {
                    toggleEl.checked = configMap[field.configKey] === 'true';
                } else {
                    toggleEl.checked = true; // Default aktif
                }
                syncToggleFieldUI(field);
            }
        });

    } catch (e) {
        console.error('[Pengaturan] Error load config:', e);
    }
}

// =========================================================================
// 4. LOAD MASTER DDC
// =========================================================================
async function loadMasterDDC() {
    try {
        const { data, error } = await supabase
            .from('lib_kategori_ddc')
            .select('*')
            .order('kode', { ascending: true });

        if (error) throw error;
        ddcList = data || [];
        renderMasterDDCTable();

    } catch (e) {
        console.error('[Pengaturan] Error load DDC:', e);
    }
}

function renderMasterDDCTable() {
    const tbody = document.getElementById('master-ddc-tbody');
    if (ddcList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-slate-400 italic">Belum ada kategori DDC.</td></tr>';
        return;
    }

    tbody.innerHTML = ddcList.map(d => `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition">
            <td class="px-4 py-2.5 font-mono font-bold text-blue-600 dark:text-blue-400">${escapeHTML(d.kode)}</td>
            <td class="px-4 py-2.5 font-semibold text-slate-800 dark:text-slate-200">${escapeHTML(d.nama)}</td>
            <td class="px-4 py-2.5 text-center whitespace-nowrap">
                <button onclick="window.editDDC('${d.kode}')" class="w-6 h-6 rounded bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-600 dark:text-slate-300 text-[10px]" title="Edit DDC">
                    <i class="fa-solid fa-pen"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// =========================================================================
// 5. EVENT LISTENERS
// =========================================================================
function setupEventListeners() {
    const formConfig = document.getElementById('form-lib-config');
    const btnAddDDC = document.getElementById('btn-open-add-ddc');

    formConfig.addEventListener('submit', handleSaveConfig);
    btnAddDDC.addEventListener('click', handleOpenAddDDCModal);

    // Inisialisasi Searchable Combobox GTK Kepala Perpustakaan
    setupKepalaPerpusCombobox();

    // Event listener masing-masing toggle switch batasan
    TOGGLE_FIELDS.forEach(field => {
        const toggleEl = document.getElementById(field.toggleId);
        if (toggleEl) {
            toggleEl.addEventListener('change', () => syncToggleFieldUI(field));
        }
    });
}

// =========================================================================
// 6. SAVE CONFIGURATIONS
// =========================================================================
async function handleSaveConfig(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-config');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Menyimpan...';

    try {
        const updates = [
            { key: 'nama_perpustakaan', value: document.getElementById('cfg-nama-perpustakaan').value.trim() },
            { key: 'kepala_perpustakaan_id', value: document.getElementById('cfg-kepala-perpus-id')?.value || '' },
            { key: 'kepala_perpustakaan_nama', value: document.getElementById('cfg-kepala-perpus-nama')?.value.trim() || '' },
            { key: 'kepala_perpustakaan_nip', value: document.getElementById('cfg-kepala-perpus-nip')?.value.trim() || '' },
            { key: 'max_pinjam_siswa', value: document.getElementById('cfg-max-pinjam-siswa').value },
            { key: 'max_pinjam_guru', value: document.getElementById('cfg-max-pinjam-guru').value },
            { key: 'durasi_pinjam_siswa_hari', value: document.getElementById('cfg-durasi-siswa').value },
            { key: 'durasi_pinjam_guru_hari', value: document.getElementById('cfg-durasi-guru').value },
            { key: 'tarif_denda_per_hari', value: document.getElementById('cfg-tarif-denda').value },
            { key: 'max_perpanjangan', value: document.getElementById('cfg-max-perpanjangan').value },
            { key: 'prefix_nomor_induk', value: document.getElementById('cfg-prefix-nomor-induk').value.trim() },
            { key: 'abaikan_hari_libur', value: document.getElementById('cfg-abaikan-libur').checked ? 'true' : 'false' },
            { key: 'tampilkan_alumni', value: document.getElementById('cfg-tampilkan-alumni').checked ? 'true' : 'false' }
        ];

        // Tambahkan status aktif/nonaktif masing-masing batasan
        TOGGLE_FIELDS.forEach(field => {
            const toggleEl = document.getElementById(field.toggleId);
            if (toggleEl) {
                updates.push({
                    key: field.configKey,
                    value: toggleEl.checked ? 'true' : 'false'
                });
            }
        });

        for (const item of updates) {
            await supabase
                .from('lib_config')
                .upsert({ key: item.key, value: item.value, updated_at: new Date().toISOString() });
        }

        Swal.fire({
            icon: 'success',
            title: 'Pengaturan Disimpan!',
            text: 'Konfigurasi operasional perpustakaan berhasil diperbarui.',
            confirmButtonColor: '#2563eb'
        });

    } catch (err) {
        console.error('[Pengaturan] Gagal simpan config:', err);
        Swal.fire({ icon: 'error', title: 'Gagal', text: err.message, confirmButtonColor: '#2563eb' });
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// =========================================================================
// 7. MASTER DDC CRUD
// =========================================================================
function handleOpenAddDDCModal() {
    Swal.fire({
        title: 'Tambah Klasifikasi DDC',
        html: `
            <div class="text-left text-xs space-y-3">
                <div>
                    <label class="font-bold block mb-1">Kode DDC</label>
                    <input type="text" id="swal-input-ddc-code" placeholder="Contoh: 510 atau 813" class="w-full p-2 border rounded-xl font-mono">
                </div>
                <div>
                    <label class="font-bold block mb-1">Nama Klasifikasi</label>
                    <input type="text" id="swal-input-ddc-name" placeholder="Contoh: Matematika" class="w-full p-2 border rounded-xl">
                </div>
                <div>
                    <label class="font-bold block mb-1">Keterangan / Subjek</label>
                    <textarea id="swal-input-ddc-desc" placeholder="Rincian subjek..." class="w-full p-2 border rounded-xl"></textarea>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Simpan',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#2563eb',
        preConfirm: () => {
            const kode = document.getElementById('swal-input-ddc-code').value.trim();
            const nama = document.getElementById('swal-input-ddc-name').value.trim();
            const ket = document.getElementById('swal-input-ddc-desc').value.trim();

            if (!kode || !nama) {
                Swal.showValidationMessage('Kode DDC dan Nama wajib diisi');
                return false;
            }
            return { kode, nama, keterangan: ket };
        }
    }).then(async (result) => {
        if (result.isConfirmed && result.value) {
            try {
                const { error } = await supabase.from('lib_kategori_ddc').insert([result.value]);
                if (error) throw error;

                Swal.fire({ icon: 'success', title: 'Berhasil', text: 'Klasifikasi DDC berhasil ditambahkan.', timer: 1500, showConfirmButton: false });
                await loadMasterDDC();
            } catch (e) {
                Swal.fire({ icon: 'error', title: 'Gagal', text: e.message, confirmButtonColor: '#2563eb' });
            }
        }
    });
}

window.editDDC = function (kode) {
    const item = ddcList.find(d => d.kode === kode);
    if (!item) return;

    Swal.fire({
        title: 'Edit Klasifikasi DDC',
        html: `
            <div class="text-left text-xs space-y-3">
                <div>
                    <label class="font-bold block mb-1">Kode DDC</label>
                    <input type="text" id="swal-edit-ddc-code" value="${escapeHTML(item.kode)}" readonly class="w-full p-2 border rounded-xl font-mono bg-slate-100">
                </div>
                <div>
                    <label class="font-bold block mb-1">Nama Klasifikasi</label>
                    <input type="text" id="swal-edit-ddc-name" value="${escapeHTML(item.nama)}" class="w-full p-2 border rounded-xl">
                </div>
                <div>
                    <label class="font-bold block mb-1">Keterangan / Subjek</label>
                    <textarea id="swal-edit-ddc-desc" class="w-full p-2 border rounded-xl">${escapeHTML(item.keterangan || '')}</textarea>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Simpan Perubahan',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#2563eb',
        preConfirm: () => {
            const nama = document.getElementById('swal-edit-ddc-name').value.trim();
            const ket = document.getElementById('swal-edit-ddc-desc').value.trim();

            if (!nama) {
                Swal.showValidationMessage('Nama Klasifikasi wajib diisi');
                return false;
            }
            return { nama, keterangan: ket };
        }
    }).then(async (result) => {
        if (result.isConfirmed && result.value) {
            try {
                const { error } = await supabase
                    .from('lib_kategori_ddc')
                    .update(result.value)
                    .eq('kode', kode);

                if (error) throw error;

                Swal.fire({ icon: 'success', title: 'Tersimpan', text: 'Klasifikasi DDC diperbarui.', timer: 1500, showConfirmButton: false });
                await loadMasterDDC();
            } catch (e) {
                Swal.fire({ icon: 'error', title: 'Gagal', text: e.message, confirmButtonColor: '#2563eb' });
            }
        }
    });
};
