import { auth, db, PATHS, firebaseConfig } from './config.js';
import { initLayout, getLocalCache, setLocalCache, escapeHTML } from './global.js';
import { cfClient } from './cloudflare-client.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, getDocs, doc, setDoc, deleteDoc, updateDoc, serverTimestamp, query, orderBy, getDoc, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// Firebase config untuk app kedua (membuat user baru) — diambil dari config.js (SSOT)
const secondaryFirebaseConfig = firebaseConfig;

let teacherDataCache = [];
let allUsersData = []; // Cache lokal seluruh data pengguna dari Firestore (Hemat kuota Firestore)

// --- CACHE CONSTANTS (HEMAT KUOTA FIRESTORE) ---
const CACHE_TTL = 30 * 60 * 60 * 1000; // 30 jam
const TEACHERS_CACHE_KEY = 'simas_teachers_cache';
const KELAS_CACHE_KEY = 'simas_kelas_list_cache';


// --- DAFTAR SEMUA ROLE (MULTI-ROLE SUPPORT) ---
const ALL_ROLES = [
    { value: 'super_admin', label: 'Super Admin' },
    { value: 'admin_perpus', label: 'Admin Perpustakaan' },
    { value: 'kepala_sekolah', label: 'Kepala Sekolah' },
    { value: 'wakasek_kurikulum', label: 'Wakasek Kurikulum' },
    { value: 'kepala_lab', label: 'Kepala Lab' },
    { value: 'kesiswaan', label: 'Wakasek Kesiswaan' },
    { value: 'admin_spp', label: 'Admin SPP / Keuangan' },
    { value: 'admin_sukaduka', label: 'Admin Suka-Duka' },
    { value: 'admin_duta', label: "Admin Duta CERDAS" },
    { value: 'admin_dapodik', label: 'Admin Dapodik' },
    { value: 'admin_lks', label: 'Admin LKS' },
    { value: 'staff', label: 'Staff' },
    { value: 'wali_kelas', label: 'Wali Kelas' },
    { value: 'guru_mapel', label: 'Guru Mapel' },
    { value: 'guru_bk', label: 'Guru BK' },
    { value: 'admin_pks', label: 'Admin PKS' },
    { value: 'admin_kelas', label: 'Admin Kelas' }
];

// --- HELPER: GENERATE ADDITIONAL ROLES CHECKBOXES ---
// Role Tambahan (tugas rangkap untuk Staff/Guru)
const ADDITIONAL_ONLY_ROLES = [
    { value: 'admin_perpus', label: 'Admin Perpustakaan' },
    { value: 'wakasek_kurikulum', label: 'Wakasek Kurikulum' },
    { value: 'kesiswaan', label: 'Wakasek Kesiswaan' },
    { value: 'humas', label: 'Wakasek Humas' },
    { value: 'sarpras', label: 'Wakasek Sarpras' },
    { value: 'admin_sarpras', label: 'Admin Sarpras' },
    { value: 'kepala_lab', label: 'Kepala Lab' },
    { value: 'admin_spp', label: 'Admin SPP / Keuangan' },
    { value: 'admin_sukaduka', label: 'Admin Suka-Duka' },
    { value: 'admin_duta', label: "Admin Duta CERDAS" },
    { value: 'admin_dapodik', label: 'Admin Dapodik' },
    { value: 'admin_lks', label: 'Admin LKS' },
    { value: 'wali_kelas', label: 'Wali Kelas' },
    { value: 'guru_bk', label: 'Guru BK' }
];

// allowedRoles: Jika diset (array), hanya role dalam list ini yang ditampilkan
function renderAdditionalRolesCheckboxes(containerId, excludePrimaryRole = '', existingRoles = [], allowedRoles = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let html = '';
    ADDITIONAL_ONLY_ROLES.forEach(role => {
        // Skip jika sama dengan primary role (seharusnya tidak terjadi, tapi untuk safety)
        if (role.value === excludePrimaryRole) return;

        // Jika allowedRoles diset, hanya tampilkan role yang ada dalam list
        if (allowedRoles && !allowedRoles.includes(role.value)) return;

        const checked = existingRoles.includes(role.value) ? 'checked' : '';
        html += `
            <label class="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 px-2 py-1.5 rounded border dark:border-slate-700 cursor-pointer hover:border-purple-300 transition-colors">
                <input type="checkbox" name="additionalRoles" value="${role.value}" ${checked} 
                    class="w-3.5 h-3.5 rounded border-slate-300 text-purple-600 focus:ring-purple-500">
                <span>${role.label}</span>
            </label>
        `;
    });

    container.innerHTML = html || '<p class="text-xs text-slate-400 italic">Tidak ada role tambahan yang tersedia</p>';
}

// --- HELPER: GET CHECKED ADDITIONAL ROLES ---
function getCheckedAdditionalRoles(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];

    const checkboxes = container.querySelectorAll('input[name="additionalRoles"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

// --- HELPER: NATURAL SORT UNTUK KELAS (X-1, X-2, ... X-10) ---
function naturalSortClass(a, b) {
    const classA = a.assignedClass || '';
    const classB = b.assignedClass || '';
    return classA.localeCompare(classB, undefined, { numeric: true });
}


// --- HELPER: MODERN ALERT ---
function showModernAlert(title, message, type = 'success') {
    const modal = document.getElementById('modal-alert');
    if (!modal) { showToast(title, message, type === 'success' ? 'success' : 'error'); return; }

    const titleEl = document.getElementById('alert-title');
    const msgEl = document.getElementById('alert-msg');
    const iconContainer = document.getElementById('alert-icon-container');
    const icon = document.getElementById('alert-icon');

    titleEl.innerText = title;
    msgEl.innerHTML = message;

    if (type === 'success') {
        iconContainer.className = "w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600";
        icon.className = "fa-solid fa-check text-3xl";
    } else if (type === 'error') {
        iconContainer.className = "w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600";
        icon.className = "fa-solid fa-triangle-exclamation text-3xl";
    }
    modal.classList.remove('hidden');
}

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash); return; }

    let role = localStorage.getItem('user_role');
    if (!role) {
        try {
            const cachedUserDoc = await window.getCurrentUserDoc();
            role = cachedUserDoc ? (cachedUserDoc.role || 'super_admin') : 'super_admin';
            localStorage.setItem('user_role', role);
        } catch (e) { role = 'super_admin'; }
    }

    // Cek apakah user punya role wakasek_kurikulum (ROLE-BASED)
    let isWakasekKurikulum = false;
    if (typeof window.hasRole === 'function') {
        isWakasekKurikulum = window.hasRole('wakasek_kurikulum');
    } else {
        // Fallback: cek langsung localStorage
        const additionalRoles = JSON.parse(localStorage.getItem('user_additional_roles') || '[]');
        isWakasekKurikulum = role === 'wakasek_kurikulum' || additionalRoles.includes('wakasek_kurikulum');
    }

    // Akses Control: super_admin, kepala_sekolah, wakasek_kurikulum, kesiswaan, staff
    // Multi-role support: gunakan hasRole untuk cek semua role
    const allowedRoles = ['super_admin', 'kepala_sekolah', 'wakasek_kurikulum', 'kesiswaan', 'staff'];
    const hasAccess = window.hasRole ?
        allowedRoles.some(r => window.hasRole(r)) :
        (allowedRoles.includes(role) || isWakasekKurikulum);
    if (!hasAccess) {
        showModernAlert("Akses Ditolak", "Halaman ini khusus Super Admin, Kepala Sekolah, Wakasek Kurikulum, Kesiswaan & Staff.", "error");
        setTimeout(() => window.location.href = 'dashboard.html', 2000);
        return;
    }

    // MULTI-ROLE: Ambil role tertinggi untuk halaman ini
    const effectiveRole = window.getEffectiveRoleForPage ?
        window.getEffectiveRoleForPage('users.html') : role;

    // Simpan role dan status wakasek di global scope agar bisa diakses loadUsers/setupForm
    window.currentUserRole = effectiveRole;
    window.isWakasekKurikulum = isWakasekKurikulum;

    initLayout(effectiveRole); // Gunakan role tertinggi
    document.querySelector('main').classList.remove('hidden');

    loadUsers();
    await preloadTeacherData();
    await populateKelasSelect(); // Await to ensure options are loaded before setupForm
    setupForm();
    await syncMissingGtkUserDocs();

    // LOGIKA TAMPILKAN TAB MAPPING (Eksklusif untuk super_admin, staff, dan wakasek_kurikulum)
    const allowedMappingRoles = ['super_admin', 'staff', 'wakasek_kurikulum'];
    const hasMappingAccess = window.hasRole ? 
        (allowedMappingRoles.some(r => window.hasRole(r)) || isWakasekKurikulum) :
        (allowedMappingRoles.includes(effectiveRole) || isWakasekKurikulum);

    if (hasMappingAccess) {
        const navTabs = document.getElementById('nav-tabs');
        if (navTabs) navTabs.classList.remove('hidden');
    }
});

// --- 1. LOAD USERS LIST (GROUPED BY ROLE) ---
let USERS_SESSION_CACHE = null;
let USERS_SESSION_CACHE_TIME = 0;
const USERS_CACHE_TTL_MS = 300000; // 5 menit

window.invalidateUsersSessionCache = function () {
    USERS_SESSION_CACHE = null;
    USERS_SESSION_CACHE_TIME = 0;
};

async function loadUsers(forceRefresh = false) {
    const tbody = document.getElementById('users-table-body');
    const myRole = window.currentUserRole;
    const myClass = window.currentUserClass;

    // DEFINISI PRIORITAS TAMPILAN ROLE
    const rolePriority = [
        'super_admin', 'admin_perpus', 'kepala_sekolah', 'wakasek_kurikulum', 'kepala_lab',
        'kesiswaan', 'admin_spp', 'admin_sukaduka', 'admin_duta', 'admin_lks', 'staff', 'wali_kelas', 'guru_mapel', 'guru_bk',
        'admin_pks', 'admin_kelas', 'siswa'
    ];

    try {
        const now = Date.now();
        if (!forceRefresh && USERS_SESSION_CACHE && (now - USERS_SESSION_CACHE_TIME < USERS_CACHE_TTL_MS)) {
            allUsersData = USERS_SESSION_CACHE;
        } else {
            const snap = await getDocs(collection(db, PATHS.users));
            allUsersData = []; // Reset cache memori lokal
            snap.forEach(docSnap => {
                const u = docSnap.data();
                allUsersData.push({ id: docSnap.id, ...u });
            });
            USERS_SESSION_CACHE = allUsersData;
            USERS_SESSION_CACHE_TIME = now;
        }

        const groupedUsers = {};
        let totalUsers = 0;

        allUsersData.forEach(userData => {
            const u = userData;

            // === FILTER LOGIC ===

            // 2. Kesiswaan: Hanya Admin PKS, Admin Kelas, dan Staff
            if (myRole === 'kesiswaan') {
                const allowed = ['admin_pks', 'admin_kelas', 'staff'];
                if (!allowed.includes(u.role)) return;
            }

            // 3. Staff: Hanya wali_kelas, guru_mapel, staff, admin_kelas, admin_pks
            if (myRole === 'staff') {
                const allowedRoles = ['wali_kelas', 'guru_mapel', 'staff', 'admin_kelas', 'admin_pks'];
                if (!allowedRoles.includes(u.role)) return;
            }

            // 4. Wakasek Kurikulum: Hanya wali_kelas, guru_mapel, admin_kelas, staff
            if (window.isWakasekKurikulum && myRole !== 'super_admin') {
                const allowedRoles = ['wali_kelas', 'guru_mapel', 'admin_kelas', 'staff'];
                if (!allowedRoles.includes(u.role)) return;
            }

            // Masukkan ke Group
            const roleKey = u.role || 'unknown';
            if (!groupedUsers[roleKey]) groupedUsers[roleKey] = [];
            groupedUsers[roleKey].push(u);
            totalUsers++;
        });

        if (totalUsers === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-slate-400 italic">Tidak ada user yang ditemukan (Sesuai filter akses Anda).</td></tr>';
            return;
        }

        // REVISI STRUKTUR HTML
        // Kita akan generate string row demi row.

        let flatHtml = '';
        rolePriority.forEach(roleKey => {
            const users = groupedUsers[roleKey];
            if (!users || users.length === 0) return;

            // Sorting: Wali Kelas berdasarkan Kelas (natural sort), role lain berdasarkan nama
            if (roleKey === 'wali_kelas') {
                users.sort(naturalSortClass);
            } else {
                users.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            }

            const roleLabels = {
                'super_admin': 'Super Admin',
                'admin_perpus': 'Admin Perpustakaan',
                'kepala_sekolah': 'Kepala Sekolah',
                'wakasek_kurikulum': 'Wakasek Kurikulum',
                'kepala_lab': 'Kepala Lab',
                'kesiswaan': 'Wakasek Kesiswaan',
                'admin_spp': 'Admin SPP / Keuangan',
                'admin_sukaduka': 'Admin Suka-Duka',
                'admin_duta': "Admin Duta CERDAS",
                'admin_dapodik': 'Admin Dapodik',
                'admin_lks': 'Admin LKS',
                'staff': 'Staff / Tata Usaha',
                'wali_kelas': 'Guru Wali Kelas',
                'guru_mapel': 'Guru Mapel',
                'guru_bk': 'Guru BK',
                'admin_pks': 'Admin PKS (Siswa)',
                'admin_kelas': 'Admin Kelas (Siswa)',
                'siswa': 'Siswa',
                'unknown': 'Role Tidak Dikenal'
            };
            const label = roleLabels[roleKey] || roleKey;

            // HEADER
            // DEFAULT: CLOSED (LOGIKA IKON + & STYLE)
            flatHtml += `
            <tr class="bg-slate-100 dark:bg-slate-800/80 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition select-none" onclick="window.toggleUserGroup('${roleKey}')">
                <td colspan="4" class="px-6 py-3 font-bold text-slate-700 dark:text-slate-200 text-sm border-b border-white dark:border-slate-700">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                             <div id="icon-container-${roleKey}" class="w-5 h-5 flex items-center justify-center bg-blue-100 dark:bg-blue-900/40 rounded-full text-blue-500 dark:text-blue-400 transition-transform duration-300">
                                <i class="fa-solid fa-plus text-[10px]"></i>
                             </div>
                             <span>${label}</span>
                             <span class="bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-600 font-mono">${users.length}</span>
                        </div>
                    </div>
                </td>
            </tr>
            `;

            // ROWS
            // DEFAULT: HIDDEN (CLOSED)
            users.forEach(u => {
                const userRoleBadge = getUserRoleBadge(u.role);
                const linkedIcon = u.linkedTeacherId
                    ? `<i class="fa-solid fa-link text-blue-500 ml-1" title="Terhubung Data Guru"></i>`
                    : `<i class="fa-solid fa-link-slash text-slate-300 ml-1" title="Tidak terhubung"></i>`;

                // MULTI-ROLE: Additional Roles Badge (dengan warna berbeda per role)
                const additionalRoles = u.additionalRoles || [];
                let additionalRolesBadge = '';
                if (additionalRoles.length > 0) {
                    // Config warna & label per role tambahan (DARK MODE FRIENDLY)
                    const roleConfig = {
                        'admin_perpus': { label: 'Admin Perpustakaan', bg: 'bg-teal-600', text: 'text-white', border: 'border-teal-700' },
                        'kepala_sekolah': { label: 'Kepala Sekolah', bg: 'bg-amber-500', text: 'text-white', border: 'border-amber-600' },
                        'wakasek_kurikulum': { label: 'Wakasek Kurikulum', bg: 'bg-amber-400', text: 'text-amber-900', border: 'border-amber-500' },
                        'kepala_lab': { label: 'Kepala Lab', bg: 'bg-cyan-500', text: 'text-white', border: 'border-cyan-600' },
                        'kesiswaan': { label: 'Wakasek Kesiswaan', bg: 'bg-indigo-500', text: 'text-white', border: 'border-indigo-600' },
                        'admin_spp': { label: 'Admin SPP / Keuangan', bg: 'bg-emerald-500', text: 'text-white', border: 'border-emerald-600' },
                        'admin_sukaduka': { label: 'Admin Suka-Duka', bg: 'bg-indigo-600', text: 'text-white', border: 'border-indigo-700' },
                        'admin_duta': { label: "Admin Duta CERDAS", bg: 'bg-purple-500', text: 'text-white', border: 'border-purple-600' },
                        'admin_dapodik': { label: 'Admin Dapodik', bg: 'bg-teal-600', text: 'text-white', border: 'border-teal-700' },
                        'admin_lks': { label: 'Admin LKS', bg: 'bg-sky-600', text: 'text-white', border: 'border-sky-700' },
                        'staff': { label: 'Staff', bg: 'bg-gray-500', text: 'text-white', border: 'border-gray-600' },
                        'wali_kelas': { label: 'Wali Kelas', bg: 'bg-blue-500', text: 'text-white', border: 'border-blue-600' },
                        'guru_mapel': { label: 'Guru Mapel', bg: 'bg-orange-500', text: 'text-white', border: 'border-orange-600' },
                        'guru_bk': { label: 'Guru BK', bg: 'bg-pink-500', text: 'text-white', border: 'border-pink-600' }
                    };

                    // Generate badge per role dengan warna masing-masing
                    const badgesHtml = additionalRoles.map(r => {
                        const config = roleConfig[r] || { label: r, bg: 'bg-purple-500', text: 'text-white', border: 'border-purple-600' };
                        let displayLabel = config.label;

                        // Untuk wali_kelas, tambahkan nama kelas jika ada
                        if (r === 'wali_kelas' && u.assignedClass) {
                            displayLabel = `Wali Kelas ${u.assignedClass}`;
                        }

                        return `<span class="${config.bg} ${config.text} text-[10px] px-1.5 py-0.5 rounded ${config.border} inline-flex items-center gap-1 font-medium" title="Role Tambahan"><i class="fa-solid fa-plus text-[8px]"></i>${displayLabel}</span>`;
                    }).join(' ');

                    additionalRolesBadge = ` ${badgesHtml}`;
                }

                const nikLabel = u.nik ? `<span class="font-mono text-[10px] text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-1 py-0.5 rounded border border-indigo-200 dark:border-indigo-800" title="NIK Guru (SSOT)">NIK: ${escapeHTML(u.nik)}</span>` : '';
                const nipLabel = u.nip ? `<span class="font-mono text-[10px] text-slate-500 dark:text-slate-400">NIP: ${escapeHTML(u.nip)}</span>` : '';
                const idBadgesHtml = [nikLabel, nipLabel].filter(Boolean).join(' ');

                flatHtml += `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 border-b border-slate-50 dark:border-slate-700/50 group-item-${roleKey} animate-fade-in-down hidden">
                    <td class="px-6 py-4">
                        <div class="font-bold text-slate-800 dark:text-slate-200 flex items-center flex-wrap gap-1">${escapeHTML(u.name || 'Tanpa Nama')} ${linkedIcon}${additionalRolesBadge}</div>
                        <div class="text-xs text-slate-500 dark:text-slate-400 flex items-center flex-wrap gap-2 mt-0.5">
                            <span>${escapeHTML(u.email || '')}</span>
                            ${idBadgesHtml ? `<span>•</span> ${idBadgesHtml}` : ''}
                        </div>
                    </td>
                    <td class="px-6 py-4">${userRoleBadge}</td>
                    <td class="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">${escapeHTML(u.assignedClass || '-')}</td>
                    <td class="px-6 py-4 text-center">
                        ${myRole === 'kepala_sekolah' ? '<span class="text-xs text-slate-400 italic">View Only</span>' : `
                        <button onclick="window.editUser('${u.id}')" class="text-blue-500 hover:text-blue-400 transition-colors p-2 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/40 mr-1" title="Edit User">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        ${myRole === 'wali_kelas' ? '' : `<button onclick="window.deleteUser('${u.id}')" class="text-red-400 hover:text-red-400 transition-colors p-2 rounded-full hover:bg-red-50 dark:hover:bg-red-900/40" title="Hapus User"><i class="fa-solid fa-trash"></i></button>`}
                        `}
                    </td>
                </tr>`;
            });
        });

        // Any roles not in priority list?
        // (Optional: handle 'others' if necessary, but current strict roles cover mostly everything)

        tbody.innerHTML = flatHtml;

    } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-red-500">Gagal memuat data.</td></tr>';
    }
}

// Helper Badge (Extracted)
function getUserRoleBadge(role) {
    const roleLabels = {
        'super_admin': '<span class="bg-purple-100 text-purple-700 px-2 py-1 rounded text-xs font-bold border border-purple-200">Super Admin</span>',
        'admin_perpus': '<span class="bg-teal-100 text-teal-800 px-2 py-1 rounded text-xs font-bold border border-teal-200"><i class="fa-solid fa-book-bookmark text-[10px] mr-1"></i>Admin Perpustakaan</span>',
        'kepala_sekolah': '<span class="bg-slate-800 text-yellow-400 px-2 py-1 rounded text-xs font-bold border border-slate-600"><i class="fa-solid fa-crown text-[10px] mr-1"></i>Kepala Sekolah</span>',
        'wakasek_kurikulum': '<span class="bg-amber-100 text-amber-800 px-2 py-1 rounded text-xs font-bold border border-amber-200"><i class="fa-solid fa-user-tie text-[10px] mr-1"></i>Wakasek Kurikulum</span>',
        'kepala_lab': '<span class="bg-cyan-100 text-cyan-700 px-2 py-1 rounded text-xs font-bold border border-cyan-200"><i class="fa-solid fa-flask text-[10px] mr-1"></i>Kepala Lab</span>',
        'kesiswaan': '<span class="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold border border-indigo-200">Kesiswaan</span>',
        'admin_spp': '<span class="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-xs font-bold border border-emerald-200"><i class="fa-solid fa-money-bill-wave text-[10px] mr-1"></i>Admin SPP</span>',
        'admin_sukaduka': '<span class="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold border border-indigo-200"><i class="fa-solid fa-handshake-angle text-[10px] mr-1"></i>Admin Suka-Duka</span>',
        'admin_duta': "<span class=\"bg-purple-100 text-purple-700 px-2 py-1 rounded text-xs font-bold border border-purple-200\"><i class=\"fa-solid fa-award text-[10px] mr-1\"></i>Admin Duta CERDAS</span>",
        'admin_dapodik': '<span class="bg-teal-100 text-teal-800 px-2 py-1 rounded text-xs font-bold border border-teal-200"><i class="fa-solid fa-graduation-cap text-[10px] mr-1"></i>Admin Dapodik</span>',
        'admin_lks': '<span class="bg-sky-100 text-sky-800 px-2 py-1 rounded text-xs font-bold border border-sky-200"><i class="fa-solid fa-book-atlas text-[10px] mr-1"></i>Admin LKS</span>',
        'staff': '<span class="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs font-bold border border-gray-200">Staff</span>',
        'wali_kelas': '<span class="bg-orange-100 text-orange-700 px-2 py-1 rounded text-xs font-bold border border-orange-200">Wali Kelas</span>',
        'guru_mapel': '<span class="bg-orange-100 text-orange-700 px-2 py-1 rounded text-xs font-bold border border-orange-200">Guru Mapel</span>',
        'guru_bk': '<span class="bg-pink-100 text-pink-700 px-2 py-1 rounded text-xs font-bold border border-pink-200">Guru BK</span>',
        'admin_pks': '<span class="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold border border-red-200">PKS</span>',
        'admin_kelas': '<span class="bg-teal-100 text-teal-700 px-2 py-1 rounded text-xs font-bold border border-teal-200">Adm. Kelas</span>',
        'siswa': '<span class="bg-slate-100 text-slate-500 px-2 py-1 rounded text-xs font-bold border border-slate-200">Siswa</span>'
    };
    return roleLabels[role] || `<span class="text-xs">${role}</span>`;
}

// --- TOGGLE FUNCTION (ACCORDION BEHAVIOR) ---
window.toggleUserGroup = function (roleKey) {
    const rows = document.querySelectorAll(`.group-item-${roleKey}`);
    const iconContainer = document.getElementById(`icon-container-${roleKey}`);
    const icon = iconContainer.querySelector('i');

    // Cek state: kalau ada row yg hidden, berarti sedang closed -> kita open
    let isHidden = false;
    if (rows.length > 0 && rows[0].classList.contains('hidden')) {
        isHidden = true;
    }

    // ACCORDION: Jika akan membuka, tutup semua group lain dulu
    if (isHidden) {
        const allRoleKeys = [
            'super_admin', 'admin_perpus', 'kepala_sekolah', 'wakasek_kurikulum', 'kepala_lab',
            'kesiswaan', 'admin_spp', 'admin_sukaduka', 'admin_duta', 'admin_dapodik', 'admin_lks', 'staff', 'wali_kelas', 'guru_mapel', 'guru_bk',
            'admin_pks', 'admin_kelas', 'siswa'
        ];
        allRoleKeys.forEach(otherRoleKey => {
            if (otherRoleKey === roleKey) return; // Skip current

            const otherRows = document.querySelectorAll(`.group-item-${otherRoleKey}`);
            const otherIconContainer = document.getElementById(`icon-container-${otherRoleKey}`);
            if (!otherIconContainer) return;

            const otherIcon = otherIconContainer.querySelector('i');

            // Jika group lain sedang terbuka, tutup
            if (otherRows.length > 0 && !otherRows[0].classList.contains('hidden')) {
                otherRows.forEach(r => r.classList.add('hidden'));
                otherIcon.className = "fa-solid fa-plus text-[10px]";
                otherIconContainer.classList.remove('bg-white', 'dark:bg-slate-700', 'text-slate-400', 'dark:text-slate-300');
                otherIconContainer.classList.add('bg-blue-100', 'dark:bg-blue-900/40', 'text-blue-500', 'dark:text-blue-400');
            }
        });
    }

    // Toggle current group
    rows.forEach(r => {
        if (isHidden) r.classList.remove('hidden');
        else r.classList.add('hidden');
    });

    // Update Icon
    if (isHidden) {
        // Now Open
        icon.className = "fa-solid fa-minus text-[10px]";
        iconContainer.classList.remove('bg-blue-100', 'dark:bg-blue-900/40', 'text-blue-500', 'dark:text-blue-400');
        iconContainer.classList.add('bg-white', 'dark:bg-slate-700', 'text-slate-400', 'dark:text-slate-300');
    } else {
            // Now Closed
        icon.className = "fa-solid fa-plus text-[10px]";
        iconContainer.classList.remove('bg-white', 'dark:bg-slate-700', 'text-slate-400', 'dark:text-slate-300');
        iconContainer.classList.add('bg-blue-100', 'dark:bg-blue-900/40', 'text-blue-500', 'dark:text-blue-400');
    }
};

// --- 2. PRELOAD DATA ---
let existingUserNames = new Set(); // Cache nama user yang sudah terdaftar

async function preloadTeacherData() {
    try {
        existingUserNames = new Set();
        const excludedRoles = ['guru_mapel', 'admin_perpus', 'admin_lks', 'kepala_sekolah', 'staff', 'wakasek_kurikulum', 'kepala_lab', 'kesiswaan', 'wali_kelas', 'guru_bk'];

        // Gunakan allUsersData yang sudah dimuat di memori (hemat read)
        let sourceUsers = allUsersData;
        if (!sourceUsers || sourceUsers.length === 0) {
            if (Array.isArray(USERS_SESSION_CACHE) && USERS_SESSION_CACHE.length > 0) {
                sourceUsers = USERS_SESSION_CACHE;
            } else {
                const usersSnap = await getDocs(collection(db, PATHS.users));
                sourceUsers = [];
                usersSnap.forEach(docSnap => sourceUsers.push({ id: docSnap.id, ...docSnap.data() }));
            }
        }

        sourceUsers.forEach(data => {
            if (excludedRoles.includes(data.role)) {
                if (data.name) existingUserNames.add(data.name.toLowerCase().trim());
            }
        });

        // Load teachers menggunakan cache terpusat
        teacherDataCache = (await window.getTeachersCache()) || [];
        if (!Array.isArray(teacherDataCache)) teacherDataCache = [];

        // Initial datalist update (tanpa filter jabatan)
        updateTeacherDatalist();
    } catch (e) { console.error("Gagal load guru:", e); }
}

// Filter datalist berdasarkan role yang dipilih
function updateTeacherDatalist(selectedRole = '') {
    const datalist = document.getElementById('teacher-list');
    if (!datalist) return;

    datalist.innerHTML = '';
    if (!Array.isArray(teacherDataCache)) return;

    teacherDataCache.forEach(t => {
        const nameKey = (t.name || '').toLowerCase().trim();

        // Skip jika sudah terdaftar sebagai user
        if (existingUserNames.has(nameKey)) return;

        const jabatan = (t.jabatan || '').toLowerCase();

        // Filter berdasarkan jabatan sesuai role yang dipilih
        if (selectedRole === 'guru_mapel' || selectedRole === 'wali_kelas' || selectedRole === 'guru_bk') {
            // Hanya tampilkan yang jabatannya 'Guru'
            if (jabatan !== 'guru') return;
        } else if (selectedRole === 'staff') {
            // Tampilkan yang bukan Guru dan bukan Kepala Sekolah
            if (jabatan === 'guru' || jabatan === 'kepala sekolah') return;
        } else if (selectedRole === 'kepala_sekolah') {
            // Hanya tampilkan yang jabatannya 'Kepala Sekolah'
            if (jabatan !== 'kepala sekolah') return;
        }

        const opt = document.createElement('option');
        opt.value = t.name;
        const nikInfo = t.nik && t.nik !== '-' ? `NIK: ${t.nik}` : '';
        const nipInfo = t.nip && t.nip !== '-' ? `NIP: ${t.nip}` : '';
        const idBadge = [nikInfo, nipInfo].filter(Boolean).join(' | ');
        const kontakInfo = t.phone || t.kontak ? ` | HP: ${t.phone || t.kontak}` : '';
        opt.label = `${t.jabatan || 'Guru'}${idBadge ? ' | ' + idBadge : ''}${kontakInfo}`;
        datalist.appendChild(opt);
    });
}

// --- AUTO-SYNC GTK USER PROFILES TO FIRESTORE ---
async function syncMissingGtkUserDocs() {
    try {
        const role = window.currentUserRole;
        if (role !== 'super_admin' && role !== 'staff') return;

        const teachers = (Array.isArray(teacherDataCache) && teacherDataCache.length > 0) ? teacherDataCache : (await window.getTeachersCache()) || [];
        if (!teachers || teachers.length === 0) return;

        // Peta UID yang sudah dibuat di Auth untuk pendaftaran batch GTK
        const KNOWN_AUTH_MAP = {
            'pesotrio@gmail.com': 'fX9psO8t7KgcHmD27iARb5Vw3GQ2',
            'betitkadek@gmail.com': 'YZRUwnAMZaaX6SvFIpEkpmO46PI3',
            'indrad0088@gmail.com': '21xGXUxBsRZwhHVyWUAu6bDm1Uf2',
            'ikmdwipermanaputra1998@gmail.com': 'hk7VWfXPi1Sho4VzYBUoAI8LAoy1',
            'nengaharta735@gmail.com': 'nrZuPfQdgNOXsrfp9ruy11oA8Zh2',
            'madeediputrawan88@gmail.com': 'DJKOIdPyGReLhKZ4q9eGDtWKlAg2',
            'sulidra@yahoo.co.id': 'r4pr2wgWfEXgZ4mIU0AkWF9t3MG3',
            'yudikabawa@gmail.com': 'Z5GXMriTSgMowrP3k4ku5nJQtzC2'
        };

        const existingEmails = new Set();
        const existingNiks = new Set();
        const existingNips = new Set();
        const existingTeacherIds = new Set();

        const currentUsers = Array.isArray(allUsersData) ? allUsersData : [];
        currentUsers.forEach(u => {
            if (u.email) existingEmails.add(u.email.trim().toLowerCase());
            if (u.nik) existingNiks.add(String(u.nik).trim());
            if (u.nip) existingNips.add(String(u.nip).trim());
            if (u.linkedTeacherId) existingTeacherIds.add(String(u.linkedTeacherId).trim());
        });

        let anyCreated = false;

        for (const t of teachers) {
            const jenisPtk = String(t.jenis_ptk || '').trim();
            const email = String(t.email || '').trim().toLowerCase();
            if (!email || email === '-' || !email.includes('@')) continue;

            let targetRole = null;
            if (jenisPtk === 'Guru') targetRole = 'guru_mapel';
            else if (jenisPtk === 'Tenaga Kependidikan') targetRole = 'staff';
            if (!targetRole) continue;

            const nikStr = t.nik && t.nik !== '-' ? String(t.nik).trim() : null;
            const nipStr = t.nip && t.nip !== '-' ? String(t.nip).trim() : null;
            const linkedId = nikStr || t.id || nipStr || null;

            const isAlreadyRegistered = (
                existingEmails.has(email) ||
                (nikStr && existingNiks.has(nikStr)) ||
                (nipStr && existingNips.has(nipStr)) ||
                (linkedId && existingTeacherIds.has(linkedId))
            );

            if (isAlreadyRegistered) continue;

            const uid = KNOWN_AUTH_MAP[email];
            if (uid) {
                const userDocData = {
                    uid: uid,
                    name: t.name || '',
                    email: email,
                    role: targetRole,
                    nik: nikStr,
                    nip: nipStr,
                    additionalRoles: [],
                    assignedClass: null,
                    linkedTeacherId: linkedId,
                    createdAt: serverTimestamp()
                };

                await setDoc(doc(db, PATHS.users, uid), userDocData, { merge: true });
                existingEmails.add(email);
                if (nikStr) existingNiks.add(nikStr);
                if (nipStr) existingNips.add(nipStr);
                if (linkedId) existingTeacherIds.add(linkedId);
                anyCreated = true;
                console.log(`[AutoSync GTK] Berhasil sinkronisasi dokumen profil Firestore: ${t.name} (${email}) [${targetRole}] - UID: ${uid}`);
            }
        }

        if (anyCreated) {
            invalidateUsersSessionCache();
            loadUsers(true);
        }
    } catch (eSync) {
        console.warn('[AutoSync GTK] Gagal sinkronisasi dokumen GTK:', eSync);
    }
}
window.syncMissingGtkUserDocs = syncMissingGtkUserDocs;

// --- 3. POPULATE KELAS SELECT UNTUK FORM TAMBAH & EDIT USER ---
async function populateKelasSelect() {
    const selectAdd = document.getElementById('input-assigned-class') || document.getElementById('add-assigned-class');
    const selectEdit = document.getElementById('edit-assigned-class');

    try {
        const classList = await window.getActiveClasses({ bypassActiveFilter: true });
        if (classList && classList.length > 0) {
            let html = '<option value="">-- Pilih Kelas --</option>';
            classList.forEach(c => html += `<option value="${c}">${c}</option>`);
            if (selectAdd) selectAdd.innerHTML = html;
            if (selectEdit) selectEdit.innerHTML = html;
        }
    } catch (e) { console.error("Gagal load kelas:", e); }
}

const loadClassOptions = populateKelasSelect;
window.loadClassOptions = populateKelasSelect;
window.populateKelasSelect = populateKelasSelect;

// --- HELPER VALIDASI WALI KELAS GANDA (GLOBAL SCOPE) ---
async function checkExistingWaliKelas(targetClass, excludeUid = null) {
    if (!targetClass) return null; // Tidak perlu cek jika tidak ada kelas

    // Prioritaskan pencarian di memori allUsersData / USERS_SESSION_CACHE (0 read)
    const usersList = (allUsersData && allUsersData.length > 0) ? allUsersData : (typeof USERS_SESSION_CACHE !== 'undefined' ? USERS_SESSION_CACHE : []);
    if (usersList.length > 0) {
        for (const u of usersList) {
            if (excludeUid && (u.id === excludeUid || u.uid === excludeUid)) continue;
            if (u.assignedClass === targetClass) {
                const roles = u.additionalRoles || [];
                const isWaliKelas = u.role === 'wali_kelas' || roles.includes('wali_kelas');
                if (isWaliKelas) {
                    return u.name || 'User Tanpa Nama';
                }
            }
        }
        return null;
    }

    // Fallback: Query cari user dengan assignedClass yang sama jika memori kosong
    const q = query(collection(db, PATHS.users), where('assignedClass', '==', targetClass));
    const snap = await getDocs(q);

    let conflictName = null;
    snap.forEach(docSnap => {
        if (conflictName) return; // Sudah ketemu, skip
        if (excludeUid && docSnap.id === excludeUid) return; // Skip diri sendiri

        const u = docSnap.data();
        const roles = u.additionalRoles || [];

        // Cek apakah user ini adalah Wali Kelas (Primary Role atau Additional Role)
        const isWaliKelas = u.role === 'wali_kelas' || roles.includes('wali_kelas');

        if (isWaliKelas) {
            conflictName = u.name || 'User Tanpa Nama';
        }
    });

    return conflictName;
}

// --- 3. SETUP FORM ---
function setupForm() {
    const roleSelect = document.getElementById('role-select');

    // HIDE ADD BUTTON FOR KEPALA SEKOLAH
    if (window.currentUserRole === 'kepala_sekolah') {
        const btnAdd = document.getElementById('btn-add-user') || document.querySelector("button[onclick*=\"modal-add-user\"]");
        if (btnAdd) btnAdd.classList.add('hidden');
    }

    // CATATAN: Logika khusus Wali Kelas dihapus karena wali_kelas tidak lagi punya akses ke halaman users

    // LOGIKA UI KHUSUS KESISWAAN
    if (window.currentUserRole === 'kesiswaan') {
        // Limit Role Options: admin_pks, admin_kelas, staff
        const allowedOptions = `
            <option value="admin_pks">Admin PKS (Siswa)</option>
            <option value="admin_kelas">Admin Kelas</option>
            <option value="staff">Staff</option>
        `;
        roleSelect.innerHTML = allowedOptions;
    }

    // LOGIKA UI KHUSUS STAFF
    if (window.currentUserRole === 'staff') {
        // Limit Role Options: staff, admin_kelas, admin_pks
        const allowedOptions = `
            <option value="staff">Staff</option>
            <option value="admin_kelas">Admin Kelas</option>
            <option value="admin_pks">Admin PKS</option>
        `;
        roleSelect.innerHTML = allowedOptions;

        setTimeout(() => {
            updateTeacherDatalist('staff');
            roleSelect.dispatchEvent(new Event('change'));
        }, 200);
    }

    // LOGIKA UI KHUSUS WAKASEK KURIKULUM
    if (window.isWakasekKurikulum && window.currentUserRole !== 'super_admin') {
        // Limit Role Options: wali_kelas, guru_mapel, admin_kelas, staff
        const allowedOptions = `
            <option value="wali_kelas">Wali Kelas</option>
            <option value="guru_mapel">Guru Mapel</option>
            <option value="admin_kelas">Admin Kelas</option>
            <option value="staff">Staff</option>
        `;
        roleSelect.innerHTML = allowedOptions;

        // FIX: Langsung update datalist dengan filter wali_kelas (default role pertama untuk wakasek)
        // Ini harus dipanggil SETELAH data guru di-load
        setTimeout(() => {
            updateTeacherDatalist('wali_kelas');
            roleSelect.dispatchEvent(new Event('change'));
        }, 200);
    }

    // Helper: Cek apakah wali_kelas ada di primary role atau additional roles (di level setupForm agar accessible)
    function shouldShowKelasField() {
        const primaryRole = roleSelect.value;
        if (primaryRole === 'wali_kelas' || primaryRole === 'admin_kelas') return true;
        // Cek additional roles checkboxes
        const additionalRolesChecked = getCheckedAdditionalRoles('additional-roles-checkboxes');
        return additionalRolesChecked.includes('wali_kelas') || additionalRolesChecked.includes('admin_kelas');
    }

    // Helper: Update visibility field-kelas (di level setupForm agar accessible)
    function updateKelasFieldVisibility() {
        const primaryRole = roleSelect.value;
        const fieldKelas = document.getElementById('field-kelas');
        const labelKelas = document.getElementById('label-kelas');
        if (!fieldKelas || !labelKelas) return;

        if (shouldShowKelasField()) {
            fieldKelas.classList.remove('hidden');
            // Label based on primary role or additional
            const additionalRolesChecked = getCheckedAdditionalRoles('additional-roles-checkboxes');
            if (primaryRole === 'wali_kelas' || additionalRolesChecked.includes('wali_kelas')) {
                labelKelas.innerText = "Wali Kelas Untuk:";
            } else {
                labelKelas.innerText = "Admin Untuk Kelas:";
            }
        } else {
            fieldKelas.classList.add('hidden');
        }
    }

    roleSelect.addEventListener('change', (e) => {
        const role = e.target.value;
        const fieldKelas = document.getElementById('field-kelas');
        const labelKelas = document.getElementById('label-kelas');
        const fieldGuru = document.getElementById('field-guru-ref');
        const inputEmail = document.getElementById('input-email');
        const fieldAdditionalRoles = document.getElementById('field-additional-roles');

        // Update datalist berdasarkan role yang dipilih
        updateTeacherDatalist(role);
        // Reset field pencarian guru
        const searchInput = document.getElementById('input-teacher-search');
        if (searchInput) searchInput.value = '';

        // Show/hide field-kelas based on role
        updateKelasFieldVisibility();

        const rolesWithTeacherLink = ['staff', 'wali_kelas', 'guru_bk', 'kepala_sekolah', 'kesiswaan', 'admin_spp', 'super_admin', 'guru_mapel', 'admin_duta', 'admin_dapodik', 'admin_perpus', 'admin_lks', 'admin_sarpras'];
        // Multi-role: Cek apakah role yg akan dibuat/diedit perlu link ke guru
        if (rolesWithTeacherLink.includes(role)) {
            fieldGuru.classList.remove('hidden');
        } else {
            fieldGuru.classList.add('hidden');
        }

        // Kunci email untuk role selain siswa dan super_admin (harus ambil dari data guru)
        const rolesWithLockedEmail = ['staff', 'wali_kelas', 'guru_bk', 'kepala_sekolah', 'kesiswaan', 'admin_spp', 'admin_sukaduka', 'guru_mapel', 'admin_duta', 'admin_dapodik', 'admin_perpus', 'admin_lks', 'admin_sarpras'];
        // Multi-role: Cek apakah role yg akan dibuat/diedit perlu email auto dari guru
        if (rolesWithLockedEmail.includes(role)) {
            inputEmail.readOnly = true;
            inputEmail.classList.add('bg-slate-100', 'cursor-not-allowed');
            inputEmail.placeholder = 'Pilih guru di atas untuk mengisi email';
            inputEmail.value = ''; // Reset email, harus dari data guru
        } else {
            inputEmail.readOnly = false;
            inputEmail.classList.remove('bg-slate-100', 'cursor-not-allowed');
            inputEmail.placeholder = 'nama@gmail.com';
        }

        // === MULTI-ROLE SUPPORT: Additional Roles Field ===
        // Role yang support additional roles (Guru/Staff roles only)
        const rolesWithAdditionalRoles = ['staff', 'wali_kelas', 'guru_bk', 'guru_mapel', 'kesiswaan', 'kepala_sekolah', 'kepala_lab', 'admin_spp', 'admin_sukaduka', 'admin_duta', 'admin_dapodik', 'admin_perpus', 'admin_lks', 'admin_sarpras'];
        // Wakasek Kurikulum hanya bisa tambah additional role wali_kelas
        const canManageAdditionalRoles = window.currentUserRole === 'super_admin' || window.isWakasekKurikulum;
        // Role utama yang support additional roles untuk wakasek: guru_mapel, staff, admin_sukaduka (bisa ditambah wali_kelas)
        const wakasekAllowedPrimaryRoles = ['guru_mapel', 'staff', 'admin_sukaduka'];
        const isWakasekValidRole = window.isWakasekKurikulum && window.currentUserRole !== 'super_admin' && wakasekAllowedPrimaryRoles.includes(role);
        const isSuperAdminValidRole = window.currentUserRole === 'super_admin' && rolesWithAdditionalRoles.includes(role);

        if (isSuperAdminValidRole || isWakasekValidRole) {
            fieldAdditionalRoles.classList.remove('hidden');
            // Wakasek hanya bisa lihat wali_kelas, super_admin bisa lihat semua
            const allowedAdditionalRoles = window.isWakasekKurikulum && window.currentUserRole !== 'super_admin' ? ['wali_kelas'] : null;
            renderAdditionalRolesCheckboxes('additional-roles-checkboxes', role, [], allowedAdditionalRoles);

            // Tambah listener ke setiap checkbox additional roles untuk toggle field-kelas
            setTimeout(() => {
                const checkboxes = document.querySelectorAll('#additional-roles-checkboxes input[type="checkbox"]');
                checkboxes.forEach(cb => {
                    cb.addEventListener('change', updateKelasFieldVisibility);
                });
            }, 100);
        } else {
            fieldAdditionalRoles.classList.add('hidden');
        }
    });

    const searchInput = document.getElementById('input-teacher-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const val = e.target.value;
            const inputName = document.getElementById('input-name');
            const inputEmail = document.getElementById('input-email');

            const match = teacherDataCache.find(t => t.name.trim().toLowerCase() === val.trim().toLowerCase());
            if (match) {
                inputName.value = match.name;
                if (match.email) inputEmail.value = match.email;
                inputName.classList.add('bg-yellow-50');
                inputEmail.classList.add('bg-yellow-50');
                setTimeout(() => {
                    inputName.classList.remove('bg-yellow-50');
                    inputEmail.classList.remove('bg-yellow-50');
                }, 500);
            }
        });
    }



    const validateUserPassword = (password) => {
        if (!password || password.length < 8) {
            return "Sandi wajib minimal 8 karakter untuk keamanan.";
        }
        if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
            return "Sandi harus berisi kombinasi huruf dan angka.";
        }
        return null;
    };

    document.getElementById('form-add-user').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const originalText = btn.innerText;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Proses...';

        // Validasi Variabel Config
        if (typeof secondaryFirebaseConfig === 'undefined') {
            showModernAlert("Error Koding", "Variabel 'secondaryFirebaseConfig' tidak ditemukan. Cek file page-users.js baris atas.", "error");
            btn.disabled = false; btn.innerText = originalText;
            return;
        }

        const formData = new FormData(e.target);
        const email = formData.get('email');
        const password = formData.get('password');

        const passwordError = validateUserPassword(password);
        if (passwordError) {
            showModernAlert("Gagal", passwordError, "error");
            btn.disabled = false; btn.innerHTML = originalText;
            return;
        }

        let role = formData.get('role');
        const name = formData.get('name');
        let assignedClass = formData.get('assignedClass');

        // SECURITY FORCE FOR KESISWAAN
        if (window.currentUserRole === 'kesiswaan') {
            const allowed = ['admin_pks', 'admin_kelas', 'staff'];
            if (!allowed.includes(role)) {
                showModernAlert("Error", "Role tidak diizinkan. Kesiswaan hanya bisa menambah Admin PKS, Admin Kelas, atau Staff.", "error");
                btn.disabled = false;
                btn.innerText = originalText;
                return;
            }
        } else if (window.isWakasekKurikulum && window.currentUserRole !== 'super_admin') {
            // SECURITY FORCE FOR WAKASEK KURIKULUM
            // Role utama yang diizinkan: wali_kelas, guru_mapel, admin_kelas, staff
            const allowedRoles = ['wali_kelas', 'guru_mapel', 'admin_kelas', 'staff'];
            if (!allowedRoles.includes(role)) {
                showModernAlert("Error", "Role tidak diizinkan. Wakasek hanya bisa menambah Wali Kelas, Guru Mapel, Admin Kelas, atau Staff.", "error");
                btn.disabled = false;
                btn.innerText = originalText;
                return;
            }
        } else if (window.currentUserRole === 'staff') {
            // SECURITY FORCE FOR STAFF
            const allowedRoles = ['staff', 'admin_kelas', 'admin_pks'];
            if (!allowedRoles.includes(role)) {
                showModernAlert("Error", "Role tidak diizinkan. Staff hanya bisa menambah Staff, Admin Kelas, atau Admin PKS.", "error");
                btn.disabled = false;
                btn.innerText = originalText;
                return;
            }
        }

        const teacherNameVal = document.getElementById('input-teacher-search') ? document.getElementById('input-teacher-search').value : '';
        let linkedTeacherId = null;
        let linkedTeacherNik = null;
        let linkedTeacherNip = null;

        if (teacherNameVal) {
            const match = teacherDataCache.find(t => t.name.trim().toLowerCase() === teacherNameVal.trim().toLowerCase());
            if (match) {
                // Hybrid Reference: Prioritaskan NIK sebagai ID SSOT, lalu doc ID/NIP
                linkedTeacherId = match.nik || match.id || match.nip || null;
                linkedTeacherNik = match.nik || null;
                linkedTeacherNip = match.nip || null;
            }
        }

        // MULTI-ROLE: Ambil additional roles dari checkboxes
        const additionalRoles = getCheckedAdditionalRoles('additional-roles-checkboxes');

        // VALIDASI WALI KELAS GANDA (ADD USER)
        // Cek jika user yang akan dibuat memiliki role Wali Kelas
        const isNewUserWaliKelas = role === 'wali_kelas' || additionalRoles.includes('wali_kelas');

        if (isNewUserWaliKelas && assignedClass) {
            const existingWaliName = await checkExistingWaliKelas(assignedClass);
            if (existingWaliName) {
                showModernAlert("Gagal Simpan", `Kelas <b>${escapeHTML(assignedClass)}</b> sudah memiliki Wali Kelas aktif: <b>${escapeHTML(existingWaliName)}</b>.<br>Satu kelas hanya boleh punya 1 Wali Kelas.`, "error");
                btn.disabled = false;
                btn.innerText = originalText;
                return;
            }
        }

        // Initialize Secondary App
        let secondaryApp;
        try {
            // Gunakan variabel yang sudah diperbaiki namanya: secondaryFirebaseConfig
            secondaryApp = initializeApp(secondaryFirebaseConfig, "SecondaryApp");
            const secondaryAuth = getAuth(secondaryApp);

            // 1. Buat User di Auth
            const userCred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
            const newUid = userCred.user.uid;

            // Logout & Hapus App Sementara
            await signOut(secondaryAuth);
            await deleteApp(secondaryApp);

            // 1b. Tandai emailVerified: true di Firebase Auth agar aman dari pencabutan password saat Google Sign-In
            try {
                if (typeof cfClient !== 'undefined' && typeof cfClient.setUserEmailVerified === 'function') {
                    await cfClient.setUserEmailVerified(newUid, true);
                    console.log(`[CreateUser] Berhasil menandai emailVerified: true untuk UID: ${newUid}`);
                }
            } catch (eVerify) {
                console.warn('[CreateUser] Gagal set emailVerified di Edge Worker:', eVerify?.message || eVerify);
            }

            // 2. Simpan Data di Firestore (dengan additionalRoles & NIK SSOT)
            // Simpan assignedClass jika primary role atau additional role memerlukan kelas
            const needsClass = (role === 'wali_kelas' || role === 'admin_kelas') || additionalRoles.includes('wali_kelas');

            const newUserData = {
                uid: newUid,
                name: name,
                email: email,
                role: role,
                nik: linkedTeacherNik,
                nip: linkedTeacherNip,
                additionalRoles: additionalRoles.length > 0 ? additionalRoles : [], // MULTI-ROLE: Simpan array
                assignedClass: needsClass ? assignedClass : null,
                linkedTeacherId: linkedTeacherId,
                createdAt: serverTimestamp()
            };

            await setDoc(doc(db, PATHS.users, newUid), newUserData);

            if (typeof window.logAudit === 'function') {
                window.logAudit('CREATE_USER', newUid, null, newUserData, `Membuat user baru: ${name} (${role}) - NIK: ${linkedTeacherNik || '-'}`);
            }

            showModernAlert("User Berhasil Dibuat!", `Akun <b>${escapeHTML(name)}</b> telah aktif.<br>Role: ${role}<br>Link Guru: ${linkedTeacherId ? 'YA' : 'TIDAK'}`);

            e.target.reset();
            if (document.getElementById('input-teacher-search')) document.getElementById('input-teacher-search').value = "";
            document.getElementById('modal-add-user').classList.add('hidden');
            invalidateUsersSessionCache();
            loadUsers(true);

        } catch (error) {
            console.error(error);
            showModernAlert("Gagal", error.message, 'error');
            if (secondaryApp) { try { await deleteApp(secondaryApp); } catch (err) { } }
        } finally {
            btn.disabled = false;
            btn.innerText = originalText;
        }
    });
}

let pendingDeleteUserId = null;

window.deleteUser = function (docId) {
    pendingDeleteUserId = docId;

    // Setup modal dan event handler
    const modal = document.getElementById('modal-confirm');
    const btnConfirm = document.getElementById('btn-confirm-yes');

    btnConfirm.onclick = executeDeleteUser;
    modal.classList.remove('hidden');
};

async function executeDeleteUser() {
    if (!pendingDeleteUserId) return;

    const modal = document.getElementById('modal-confirm');
    const btnConfirm = document.getElementById('btn-confirm-yes');
    const originalText = btnConfirm.innerHTML;

    btnConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Menghapus...';
    btnConfirm.disabled = true;

    try {
        // Ambil data sebelum dihapus untuk audit trail (prioritaskan memori)
        let oldData = (allUsersData && allUsersData.find(u => u.id === pendingDeleteUserId)) || null;
        if (!oldData) {
            try {
                const oldSnap = await getDoc(doc(db, PATHS.users, pendingDeleteUserId));
                if (oldSnap.exists()) oldData = oldSnap.data();
            } catch (err) { console.warn("Gagal ambil oldData untuk audit:", err); }
        }

        await deleteDoc(doc(db, PATHS.users, pendingDeleteUserId));

        if (typeof window.logAudit === 'function') {
            window.logAudit('DELETE_USER', pendingDeleteUserId, oldData, null, `Menghapus user: ${oldData ? oldData.name : pendingDeleteUserId}`);
        }

        modal.classList.add('hidden');
        invalidateUsersSessionCache();
        loadUsers(true);
        showModernAlert("Terhapus", "User berhasil dihapus.");
    } catch (e) {
        showModernAlert("Gagal Hapus", e.message, 'error');
    } finally {
        btnConfirm.disabled = false;
        btnConfirm.innerHTML = originalText;
        pendingDeleteUserId = null;
    }
}

// --- 4. FITUR EDIT USER ---

// A. Setup Form Edit (Event Listener untuk Dropdown Role)
function setupEditForm() {
    const roleSelect = document.getElementById('edit-role-select');

    roleSelect.addEventListener('change', (e) => {
        toggleEditClassField(e.target.value);

        // MULTI-ROLE: Update checkboxes saat role berubah
        const fieldAdditionalRoles = document.getElementById('field-edit-additional-roles');
        const rolesWithAdditionalRoles = ['staff', 'wali_kelas', 'guru_bk', 'guru_mapel', 'kesiswaan', 'kepala_sekolah', 'kepala_lab', 'admin_spp', 'admin_sukaduka', 'admin_duta', 'admin_dapodik', 'admin_perpus', 'admin_lks'];
        // Wakasek hanya bisa tambah additional role wali_kelas untuk guru_mapel, staff, admin_sukaduka
        const wakasekAllowedPrimaryRoles = ['guru_mapel', 'staff', 'admin_sukaduka'];
        const isWakasekValidRole = window.isWakasekKurikulum && window.currentUserRole !== 'super_admin' && wakasekAllowedPrimaryRoles.includes(e.target.value);
        const isSuperAdminValidRole = window.currentUserRole === 'super_admin' && rolesWithAdditionalRoles.includes(e.target.value);

        if (isSuperAdminValidRole || isWakasekValidRole) {
            fieldAdditionalRoles.classList.remove('hidden');
            const allowedAdditionalRoles = window.isWakasekKurikulum && window.currentUserRole !== 'super_admin' ? ['wali_kelas'] : null;
            renderAdditionalRolesCheckboxes('edit-additional-roles-checkboxes', e.target.value, [], allowedAdditionalRoles);

            // Tambah listener ke setiap checkbox additional roles untuk toggle field-kelas
            setTimeout(() => {
                const checkboxes = document.querySelectorAll('#edit-additional-roles-checkboxes input[type="checkbox"]');
                checkboxes.forEach(cb => {
                    cb.addEventListener('change', () => {
                        toggleEditClassField(document.getElementById('edit-role-select').value);
                    });
                });
            }, 100);
        } else {
            fieldAdditionalRoles.classList.add('hidden');
        }
    });

    // Handle Submit Form Edit
    document.getElementById('form-edit-user').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const originalText = btn.innerText;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';

        try {
            const uid = document.getElementById('edit-uid').value;
            let newRole = document.getElementById('edit-role-select').value;
            const newName = document.getElementById('edit-name').value;
            let newClass = document.getElementById('edit-assigned-class').value;

            // SECURITY FORCE FOR KESISWAAN
            if (window.currentUserRole === 'kesiswaan') {
                const allowed = ['admin_pks', 'admin_kelas', 'staff'];
                if (!allowed.includes(newRole)) {
                    showModernAlert("Error", "Role tidak diizinkan. Kesiswaan hanya bisa mengedit ke Admin PKS, Admin Kelas, atau Staff.", "error");
                    btn.disabled = false;
                    btn.innerText = originalText;
                    return;
                }
            } else if (window.isWakasekKurikulum && window.currentUserRole !== 'super_admin') {
                // SECURITY FORCE FOR WAKASEK KURIKULUM
                const allowedRoles = ['wali_kelas', 'guru_mapel', 'admin_kelas', 'staff'];
                if (!allowedRoles.includes(newRole)) {
                    showModernAlert("Error", "Role tidak diizinkan. Wakasek hanya bisa mengedit ke Wali Kelas, Guru Mapel, Admin Kelas, atau Staff.", "error");
                    btn.disabled = false;
                    btn.innerText = originalText;
                    return;
                }
            }

            // MULTI-ROLE: Ambil additional roles dari checkboxes edit DULU
            const additionalRoles = getCheckedAdditionalRoles('edit-additional-roles-checkboxes');

            // Validasi Logika Kelas - termasuk cek additional roles
            let finalClass = null;
            if (['admin_kelas', 'wali_kelas'].includes(newRole) || additionalRoles.includes('wali_kelas')) {
                finalClass = newClass;
            }

            // VALIDASI WALI KELAS GANDA (EDIT USER)
            // Cek jika user yang diedit memiliki role Wali Kelas
            const isEditUserWaliKelas = newRole === 'wali_kelas' || additionalRoles.includes('wali_kelas');

            if (isEditUserWaliKelas && finalClass) {
                const existingWaliName = await checkExistingWaliKelas(finalClass, uid);
                if (existingWaliName) {
                    showModernAlert("Gagal Update", `Kelas <b>${escapeHTML(finalClass)}</b> sudah memiliki Wali Kelas aktif: <b>${escapeHTML(existingWaliName)}</b>.<br>Silakan ganti kelas atau role user ini.`, "error");
                    btn.disabled = false;
                    btn.innerText = originalText;
                    return;
                }
            }

            // Ambil data lama sebelum diupdate untuk audit trail (prioritaskan memori)
            let oldData = (allUsersData && allUsersData.find(u => u.id === uid)) || null;
            if (!oldData) {
                try {
                    const oldSnap = await getDoc(doc(db, PATHS.users, uid));
                    if (oldSnap.exists()) oldData = oldSnap.data();
                } catch (err) { console.warn("Gagal ambil oldData untuk audit:", err); }
            }

            const updateData = {
                name: newName,
                role: newRole,
                additionalRoles: additionalRoles, // MULTI-ROLE: Update array
                assignedClass: finalClass,
                updatedAt: serverTimestamp()
            };

            const editEmail = document.getElementById('edit-email')?.value?.trim()?.toLowerCase();
            if (editEmail) {
                updateData.email = editEmail;
            }

            // Sync NIK / linkedTeacherId jika akun terhubung ke guru master (SSOT)
            let matchedTeacher = null;
            if (oldData?.linkedTeacherId) {
                matchedTeacher = teacherDataCache.find(t => t.id === oldData.linkedTeacherId || t.nik === oldData.linkedTeacherId || t.nip === oldData.linkedTeacherId);
            }
            if (!matchedTeacher && (editEmail || oldData?.email)) {
                const targetEmail = editEmail || oldData?.email;
                matchedTeacher = teacherDataCache.find(t => t.email && t.email.toLowerCase() === targetEmail.toLowerCase());
            }

            if (matchedTeacher) {
                updateData.nik = matchedTeacher.nik || oldData?.nik || null;
                updateData.nip = matchedTeacher.nip || oldData?.nip || null;
                updateData.linkedTeacherId = matchedTeacher.nik || matchedTeacher.id || matchedTeacher.nip || oldData?.linkedTeacherId;

                try {
                    const targetDocId = matchedTeacher.nik || matchedTeacher.id;
                    const teacherSyncPayload = { name: newName };
                    if (editEmail) teacherSyncPayload.email = editEmail;
                    if (typeof cfClient !== 'undefined' && cfClient.updateTeacher) {
                        await cfClient.updateTeacher(targetDocId, teacherSyncPayload);
                    }
                    if (typeof window.invalidateTeachersCache === 'function') {
                        window.invalidateTeachersCache();
                    }
                } catch (eTeacher) {
                    console.warn('[saveEditUser] Gagal sinkron ke teachers D1:', eTeacher);
                }
            } else if (editEmail && oldData?.email && editEmail !== oldData.email) {
                try {
                    const teachersMap = await window.getTeachersMapCache();
                    const existingTeacher = teachersMap.get(oldData.email.toLowerCase().trim());
                    if (existingTeacher) {
                        updateData.nik = existingTeacher.nik || null;
                        updateData.nip = existingTeacher.nip || null;
                        updateData.linkedTeacherId = existingTeacher.nik || existingTeacher.id;
                        if (typeof cfClient !== 'undefined' && cfClient.updateTeacher) {
                            await cfClient.updateTeacher(existingTeacher.id, { email: editEmail, name: newName });
                        }
                        if (typeof window.invalidateTeachersCache === 'function') {
                            window.invalidateTeachersCache();
                        }
                    }
                } catch (eTeacher) {
                    console.warn('[saveEditUser] Gagal sinkron ke teachers D1 via email:', eTeacher);
                }
            }

            // Update Kata Sandi di Firebase Auth jika diisi oleh Admin
            const newPassword = document.getElementById('edit-password')?.value?.trim();
            if (newPassword) {
                if (newPassword.length < 6) {
                    showModernAlert("Gagal Update", "Kata sandi baru minimal 6 karakter.", "error");
                    btn.disabled = false;
                    btn.innerText = originalText;
                    return;
                }
                if (typeof cfClient !== 'undefined' && typeof cfClient.setUserPassword === 'function') {
                    await cfClient.setUserPassword(uid, newPassword);
                }
            }

            // Update ke Firestore (dengan additionalRoles)
            await updateDoc(doc(db, PATHS.users, uid), updateData);

            if (typeof window.logAudit === 'function') {
                window.logAudit('UPDATE_USER', uid, oldData, updateData, `Memperbarui user: ${newName}`);
            }

            showModernAlert("Berhasil Update", `Data user <b>${escapeHTML(newName)}</b> telah diperbarui.`);
            document.getElementById('modal-edit-user').classList.add('hidden');
            loadUsers(); // Refresh Tabel

        } catch (error) {
            console.error(error);
            showModernAlert("Gagal Update", error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerText = originalText;
        }
    });
}

// Helper: Show/Hide Field Kelas di Modal Edit (MULTI-ROLE SUPPORT)
function toggleEditClassField(role) {
    const field = document.getElementById('field-edit-kelas');
    const label = document.getElementById('label-edit-kelas');

    // Cek additional roles checkboxes
    const additionalRolesChecked = getCheckedAdditionalRoles('edit-additional-roles-checkboxes');

    // Role yang butuh input kelas (primary OR additional)
    const needsKelas = ['admin_kelas', 'wali_kelas'].includes(role) ||
        additionalRolesChecked.includes('wali_kelas') ||
        additionalRolesChecked.includes('admin_kelas');

    if (needsKelas) {
        field.classList.remove('hidden');
        if (role === 'wali_kelas' || additionalRolesChecked.includes('wali_kelas')) {
            label.innerText = "Wali Kelas Untuk:";
        } else if (role === 'admin_kelas') {
            label.innerText = "Admin Kelas Untuk:";
        } else {
            label.innerText = "Admin Untuk Kelas:";
        }
    } else {
        field.classList.add('hidden');
    }
}

// B. Fungsi Window Edit (Dipanggil dari Tombol Tabel)
window.editUser = async (uid) => {
    // 1. Ambil Data User (prioritaskan dari memori)
    try {
        let u = (allUsersData && allUsersData.find(user => user.id === uid)) || null;
        if (!u) {
            const docSnap = await getDoc(doc(db, PATHS.users, uid));
            if (!docSnap.exists()) {
                showModernAlert("Error", "User tidak ditemukan!", "error");
                return;
            }
            u = docSnap.data();
        }

        // 2. Isi Form Modal
        document.getElementById('edit-uid').value = uid;
        document.getElementById('edit-email').value = u.email;
        if (document.getElementById('edit-password')) {
            document.getElementById('edit-password').value = '';
        }
        document.getElementById('edit-name').value = u.name;
        document.getElementById('edit-role-select').value = u.role;

        // 3. Populate Opsi Kelas - Gunakan helper global terpusat
        const selectClass = document.getElementById('edit-assigned-class');
        try {
            const classList = await window.getActiveClasses({ bypassActiveFilter: true });
            if (classList && classList.length > 0) {
                let html = '<option value="">-- Pilih Kelas --</option>';
                classList.forEach(c => html += `<option value="${c}">${c}</option>`);
                selectClass.innerHTML = html;
            }
        } catch (e) {
            console.error("Gagal load kelas untuk edit:", e);
            // Fallback: copy dari form tambah jika gagal fetch
            const sourceOptions = document.getElementById('input-assigned-class').innerHTML;
            selectClass.innerHTML = sourceOptions;
        }

        // 4. MULTI-ROLE: Setup Additional Roles Checkboxes DULU (sebelum toggle field kelas)
        const fieldAdditionalRoles = document.getElementById('field-edit-additional-roles');
        const rolesWithAdditionalRoles = ['staff', 'wali_kelas', 'guru_bk', 'guru_mapel', 'kesiswaan', 'kepala_sekolah', 'kepala_lab', 'admin_spp', 'admin_sukaduka', 'admin_duta', 'admin_dapodik', 'admin_perpus', 'admin_lks'];
        const existingAdditionalRoles = u.additionalRoles || [];
        // Wakasek hanya bisa tambah additional role wali_kelas untuk guru_mapel, staff, admin_sukaduka
        const wakasekAllowedPrimaryRoles = ['guru_mapel', 'staff', 'admin_sukaduka'];
        const isWakasekValidRole = window.isWakasekKurikulum && window.currentUserRole !== 'super_admin' && wakasekAllowedPrimaryRoles.includes(u.role);
        const isSuperAdminValidRole = window.currentUserRole === 'super_admin' && rolesWithAdditionalRoles.includes(u.role);

        if (isSuperAdminValidRole || isWakasekValidRole) {
            fieldAdditionalRoles.classList.remove('hidden');
            const allowedAdditionalRoles = window.isWakasekKurikulum && window.currentUserRole !== 'super_admin' ? ['wali_kelas'] : null;
            renderAdditionalRolesCheckboxes('edit-additional-roles-checkboxes', u.role, existingAdditionalRoles, allowedAdditionalRoles);

            // FIX: Tambahkan event listener agar toggle kelas berfungsi saat checkbox diklik
            setTimeout(() => {
                const checkboxes = document.querySelectorAll('#edit-additional-roles-checkboxes input[type="checkbox"]');
                checkboxes.forEach(cb => {
                    cb.addEventListener('change', () => {
                        toggleEditClassField(document.getElementById('edit-role-select').value);
                    });
                });
            }, 100);

        } else {
            fieldAdditionalRoles.classList.add('hidden');
        }

        // 5. Atur Visibilitas Field Kelas (SETELAH checkboxes di-render)
        // Cek jika primary role atau additional role memerlukan field kelas
        const needsKelasField = ['admin_kelas', 'wali_kelas'].includes(u.role) ||
            existingAdditionalRoles.includes('wali_kelas');

        const fieldKelas = document.getElementById('field-edit-kelas');
        const labelKelas = document.getElementById('label-edit-kelas');

        if (needsKelasField) {
            fieldKelas.classList.remove('hidden');
            if (u.role === 'wali_kelas' || existingAdditionalRoles.includes('wali_kelas')) {
                labelKelas.innerText = "Wali Kelas Untuk:";
            } else if (u.role === 'admin_kelas') {
                labelKelas.innerText = "Admin Kelas Untuk:";
            } else {
                labelKelas.innerText = "Admin Untuk Kelas:";
            }
        } else {
            fieldKelas.classList.add('hidden');
        }

        // 6. Set Nilai Kelas (SETELAH opsi di-load dan field ditampilkan)
        if (u.assignedClass) {
            selectClass.value = u.assignedClass;
            // Debug: Pastikan value ter-set dengan benar
            console.log('Prefill kelas:', u.assignedClass, 'Selected:', selectClass.value);
        }

        // CATATAN: Logika khusus Wali Kelas dihapus karena wali_kelas tidak lagi punya akses ke halaman users

        if (window.currentUserRole === 'kesiswaan') {
            const allowedOptions = `
                <option value="admin_pks">Admin PKS</option>
                <option value="admin_kelas">Admin Kelas</option>
                <option value="staff">Staff</option>
            `;
            const editRoleSelect = document.getElementById('edit-role-select');
            editRoleSelect.innerHTML = allowedOptions;
            editRoleSelect.disabled = false;

            if (['admin_pks', 'admin_kelas', 'staff'].includes(u.role)) {
                editRoleSelect.value = u.role;
            }
        }

        if (window.currentUserRole === 'staff') {
            const allowedOptions = `
                <option value="staff">Staff</option>
                <option value="wali_kelas">Wali Kelas</option>
                <option value="guru_mapel">Guru Mapel</option>
                <option value="admin_kelas">Admin Kelas</option>
                <option value="admin_pks">Admin PKS</option>
            `;
            const editRoleSelect = document.getElementById('edit-role-select');
            editRoleSelect.innerHTML = allowedOptions;
            editRoleSelect.disabled = false;

            // Set value again because innerHTML reset it
            if (['staff', 'wali_kelas', 'guru_mapel', 'admin_kelas', 'admin_pks'].includes(u.role)) {
                editRoleSelect.value = u.role;
            }
        }

        // LOGIKA WAKASEK KURIKULUM (EDIT)
        if (window.isWakasekKurikulum && window.currentUserRole !== 'super_admin') {
            // Wakasek hanya bisa edit role wali_kelas, guru_mapel, admin_kelas, staff
            const allowedOptions = `
                <option value="wali_kelas">Wali Kelas</option>
                <option value="guru_mapel">Guru Mapel</option>
                <option value="admin_kelas">Admin Kelas</option>
                <option value="staff">Staff</option>
            `;
            const editRoleSelect = document.getElementById('edit-role-select');
            editRoleSelect.innerHTML = allowedOptions;
            editRoleSelect.disabled = false;

            // Set value again because innerHTML reset it
            if (['wali_kelas', 'guru_mapel', 'admin_kelas', 'staff'].includes(u.role)) {
                editRoleSelect.value = u.role;
            }
        }

        // 5. Tampilkan Modal
        document.getElementById('modal-edit-user').classList.remove('hidden');

    } catch (e) {
        console.error(e);
        showModernAlert("Error", "Gagal memuat data user.", "error");
    }
};

// Panggil setupEditForm saat halaman dimuat
setTimeout(setupEditForm, 1000);

// ==========================================
// FITUR BARU: PEMETAAN WALI KELAS MASSAL
// ==========================================

// 1. Switch Tab
window.switchTab = function (tabName) {
    const tabUsersBtn = document.getElementById('tab-btn-users');
    const tabMappingBtn = document.getElementById('tab-btn-mapping');
    const tabUsersContent = document.getElementById('tab-content-users');
    const tabMappingContent = document.getElementById('tab-content-mapping');
    const btnAddUser = document.getElementById('btn-add-user');

    if (!tabUsersBtn || !tabMappingBtn || !tabUsersContent || !tabMappingContent) return;

    if (tabName === 'users') {
        tabUsersBtn.className = "px-4 py-2.5 border-b-2 border-slate-900 dark:border-white font-bold text-sm text-slate-900 dark:text-white transition-all";
        tabMappingBtn.className = "px-4 py-2.5 border-b-2 border-transparent font-semibold text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all";
        tabUsersContent.classList.remove('hidden');
        tabMappingContent.classList.add('hidden');
        if (window.currentUserRole !== 'kepala_sekolah') {
            if (btnAddUser) btnAddUser.classList.remove('hidden');
        }
    } else if (tabName === 'mapping') {
        tabUsersBtn.className = "px-4 py-2.5 border-b-2 border-transparent font-semibold text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all";
        tabMappingBtn.className = "px-4 py-2.5 border-b-2 border-slate-900 dark:border-white font-bold text-sm text-slate-900 dark:text-white transition-all";
        tabUsersContent.classList.add('hidden');
        tabMappingContent.classList.remove('hidden');
        if (btnAddUser) btnAddUser.classList.add('hidden');

        window.loadWaliKelasMapping();
    }
};

// 2. Load Mapping Wali Kelas
window.loadWaliKelasMapping = async function () {
    const tbody = document.getElementById('mapping-table-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat pemetaan kelas...</td></tr>';

    try {
        // A. Ambil kelas aktif
        let classList = await window.getActiveClasses({ bypassActiveFilter: true });
        if (!classList || classList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-slate-400 italic">Tidak ada kelas aktif yang ditemukan.</td></tr>';
            return;
        }

        // Filter kelas yang tidak wajar (keluar, mutasi, pindah)
        const unallowedClassKeywords = ['keluar', 'mutasi', 'pindah'];
        classList = classList.filter(c => {
            const lowerC = c.toLowerCase();
            return !unallowedClassKeywords.some(keyword => lowerC.includes(keyword));
        });

        // B. Filter user guru/staff untuk opsi dropdown (role: guru_mapel, wali_kelas, guru_bk, staff)
        const teacherRoles = ['guru_mapel', 'wali_kelas', 'guru_bk', 'staff'];
        const teachersList = allUsersData.filter(u => {
            const hasPrimaryRole = teacherRoles.includes(u.role);
            const hasAdditionalRole = u.additionalRoles && u.additionalRoles.some(ar => teacherRoles.includes(ar));
            return hasPrimaryRole || hasAdditionalRole;
        });

        // Urutkan guru berdasarkan nama secara alfabetis
        teachersList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        // C. Render pemetaan per kelas
        const isReadOnly = window.currentUserRole === 'kepala_sekolah';
        let html = '';
        classList.forEach(kelas => {
            // Dapatkan wali kelas aktif untuk kelas ini
            const currentWali = allUsersData.find(u => {
                const isWaliRole = u.role === 'wali_kelas' || (u.additionalRoles && u.additionalRoles.includes('wali_kelas'));
                return u.assignedClass === kelas && isWaliRole;
            });

            // Kolom Aksi: Edit & Copot jika sudah ada, Tugaskan jika belum ada
            let actionBtn = '';
            if (isReadOnly) {
                actionBtn = `<span class="text-xs text-slate-400 italic">Hanya Lihat</span>`;
            } else if (currentWali) {
                actionBtn = `
                    <div class="flex items-center justify-center gap-1.5">
                        <button type="button" onclick="window.focusWaliKelasInput('${escapeHTML(kelas)}')" class="px-2.5 py-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-lg transition-all active:scale-95 flex items-center gap-1" title="Ubah Wali Kelas">
                            <i class="fa-solid fa-pen-to-square"></i> Edit
                        </button>
                        <button type="button" onclick="window.removeWaliKelas('${escapeHTML(kelas)}', '${escapeHTML(currentWali.id)}')" class="px-2.5 py-1.5 text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/50 hover:bg-red-100 dark:hover:bg-red-900/60 rounded-lg transition-all active:scale-95 flex items-center gap-1" title="Copot Wali Kelas">
                            <i class="fa-solid fa-user-minus"></i> Copot
                        </button>
                    </div>`;
            } else {
                actionBtn = `
                    <button type="button" onclick="window.focusWaliKelasInput('${escapeHTML(kelas)}')" class="px-2.5 py-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 rounded-lg transition-all active:scale-95 flex items-center gap-1 mx-auto" title="Tugaskan Wali Kelas">
                        <i class="fa-solid fa-user-plus"></i> Tugaskan
                    </button>`;
            }

            const inputDisabledAttr = isReadOnly ? 'disabled' : '';
            const inputCursorClass = isReadOnly ? 'cursor-not-allowed opacity-75' : 'cursor-pointer';
            const inputPlaceholder = isReadOnly ? 'Hanya lihat (tidak dapat diedit)' : 'Ketik & pilih nama guru...';

            html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700/50 mapping-row" data-class="${escapeHTML(kelas)}">
                <td class="px-6 py-4 font-bold text-slate-800 dark:text-slate-200">${escapeHTML(kelas)}</td>
                <td class="px-6 py-4 relative">
                    <div class="relative w-full max-w-md">
                        <!-- Input Cari Guru -->
                        <input type="text" 
                            class="teacher-search-input w-full p-2 border dark:border-slate-700 rounded-lg text-sm bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-semibold focus:ring-2 focus:ring-blue-400 focus:bg-white dark:focus:bg-slate-800 outline-none transition-all ${inputCursorClass}"
                            value="${escapeHTML(currentWali ? currentWali.name : '')}"
                            placeholder="${inputPlaceholder}"
                            data-class="${escapeHTML(kelas)}"
                            data-current-uid="${currentWali ? currentWali.id : ''}"
                            onchange="window.changeWaliKelasDatalist('${escapeHTML(kelas)}', this.value, '${currentWali ? currentWali.id : ''}')"
                            autocomplete="off"
                            ${inputDisabledAttr}>
                        
                        <!-- Dropdown Sugesti Guru (Melayang) -->
                        <div class="teacher-dropdown hidden absolute left-0 right-0 z-20 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 max-h-48 overflow-y-auto mt-1 divide-y divide-slate-50 dark:divide-slate-700/50">
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 text-center">
                    ${actionBtn}
                </td>
            </tr>`;
        });

        tbody.innerHTML = html;

        if (!isReadOnly) {
            // D. Daftarkan event listener untuk input pencarian guru kustom
            const searchInputs = tbody.querySelectorAll('.teacher-search-input');
            searchInputs.forEach(input => {
                const kelas = input.getAttribute('data-class');
                const currentWaliUid = input.getAttribute('data-current-uid');
                const dropdown = input.nextElementSibling; // div.teacher-dropdown

                // 1. Event Focus -> Munculkan dropdown
                input.addEventListener('focus', () => {
                    window.renderTeacherDropdownForClass(input, dropdown, teachersList, input.value, kelas, currentWaliUid);
                });

                // 2. Event Input -> Saring & render ulang
                input.addEventListener('input', (e) => {
                    window.renderTeacherDropdownForClass(input, dropdown, teachersList, e.target.value, kelas, currentWaliUid);
                });
            });
        }

    } catch (e) {
        console.error("Gagal load pemetaan:", e);
        tbody.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-red-500">Gagal memuat pemetaan kelas.</td></tr>';
    }
};

// 2b. Fokus ke input wali kelas untuk memicu perubahan/penugasan
window.focusWaliKelasInput = function (kelas) {
    if (!kelas) return;
    const rows = document.querySelectorAll('.mapping-row');
    let targetRow = null;
    rows.forEach(r => {
        if (r.getAttribute('data-class') === kelas) {
            targetRow = r;
        }
    });
    if (!targetRow) return;
    const input = targetRow.querySelector('.teacher-search-input');
    if (input && !input.disabled) {
        input.focus();
        input.select();
        input.dispatchEvent(new Event('focus'));
    }
};

// 3. Ubah/Tugaskan Wali Kelas
window.changeWaliKelas = async function (kelas, selectedUid, currentWaliUid) {
    if (!selectedUid) {
        // Jika admin memilih opsi kosong (kosongkan wali kelas)
        if (currentWaliUid) {
            window.removeWaliKelas(kelas, currentWaliUid);
        }
        return;
    }

    const newWali = allUsersData.find(u => u.id === selectedUid);
    if (!newWali) return;

    // A. Validasi jika guru baru sudah menjabat wali kelas di kelas lain
    const isWali = newWali.role === 'wali_kelas' || (newWali.additionalRoles && newWali.additionalRoles.includes('wali_kelas'));
    if (newWali.assignedClass && newWali.assignedClass !== kelas && isWali) {
        showModernAlert("Gagal Ditugaskan", `<b>${escapeHTML(newWali.name)}</b> sudah menjabat sebagai Wali Kelas di kelas <b>${escapeHTML(newWali.assignedClass)}</b>.<br>Silakan kosongkan terlebih dahulu kelas tersebut jika ingin memindahkannya.`, "error");
        window.loadWaliKelasMapping(); // Reset select ke semula
        return;
    }

    // B. Susun konfirmasi
    let confirmMsg = `Apakah Anda yakin ingin menugaskan <b>${escapeHTML(newWali.name)}</b> sebagai Wali Kelas <b>${escapeHTML(kelas)}</b>?`;
    if (currentWaliUid && currentWaliUid !== selectedUid) {
        const oldWali = allUsersData.find(u => u.id === currentWaliUid);
        if (oldWali) {
            confirmMsg = `Kelas <b>${escapeHTML(kelas)}</b> saat ini memiliki Wali Kelas aktif: <b>${escapeHTML(oldWali.name)}</b>.<br><br>Apakah Anda yakin ingin menggantinya dengan <b>${escapeHTML(newWali.name)}</b>?<br><b>${escapeHTML(oldWali.name)}</b> akan otomatis dicopot dari jabatan Wali Kelas ${escapeHTML(kelas)}.`;
        }
    }

    const modal = document.getElementById('modal-confirm');
    const msgEl = document.getElementById('confirm-msg');
    const btnConfirm = document.getElementById('btn-confirm-yes');

    msgEl.innerHTML = confirmMsg;
    btnConfirm.innerText = 'Ya, Tugaskan';
    
    btnConfirm.onclick = async () => {
        btnConfirm.disabled = true;
        btnConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Menyimpan...';

        try {
            // 1. Copot Wali Kelas Lama jika ada
            if (currentWaliUid && currentWaliUid !== selectedUid) {
                const oldWali = allUsersData.find(u => u.id === currentWaliUid);
                if (oldWali) {
                    const updateOld = {
                        assignedClass: null,
                        updatedAt: serverTimestamp()
                    };
                    if (oldWali.role === 'wali_kelas') {
                        updateOld.role = 'guru_mapel';
                    }
                    if (oldWali.additionalRoles && oldWali.additionalRoles.includes('wali_kelas')) {
                        updateOld.additionalRoles = oldWali.additionalRoles.filter(r => r !== 'wali_kelas');
                    }
                    await updateDoc(doc(db, PATHS.users, currentWaliUid), updateOld);
                    
                    if (typeof window.logAudit === 'function') {
                        window.logAudit('UPDATE_USER', currentWaliUid, oldWali, updateOld, `Mencopot Wali Kelas ${kelas} (digantikan)`);
                    }
                }
            }

            // 2. Tugaskan Wali Kelas Baru
            const updateNew = {
                assignedClass: kelas,
                updatedAt: serverTimestamp()
            };
            if (newWali.role !== 'wali_kelas') {
                const currentAdditional = newWali.additionalRoles || [];
                if (!currentAdditional.includes('wali_kelas')) {
                    updateNew.additionalRoles = [...currentAdditional, 'wali_kelas'];
                }
            }
            await updateDoc(doc(db, PATHS.users, selectedUid), updateNew);

            if (typeof window.logAudit === 'function') {
                window.logAudit('UPDATE_USER', selectedUid, newWali, updateNew, `Menugaskan Wali Kelas ${kelas}`);
            }

            modal.classList.add('hidden');
            showModernAlert("Berhasil Ditugaskan", `Wali Kelas baru untuk kelas <b>${escapeHTML(kelas)}</b> berhasil disimpan.`);
            
            // 3. Sinkronisasi Data (SSOT)
            invalidateUsersSessionCache();
            await loadUsers(true); // reload user list & update allUsersData cache
            window.loadWaliKelasMapping(); // render ulang
            
        } catch (error) {
            console.error(error);
            showModernAlert("Gagal Menyimpan", error.message, 'error');
            window.loadWaliKelasMapping();
        } finally {
            btnConfirm.disabled = false;
            btnConfirm.innerHTML = 'Ya, Hapus'; // Kembalikan text default
            btnConfirm.onclick = executeDeleteUser; // Kembalikan handler hapus default
        }
    };

    modal.classList.remove('hidden');
};

// 5. Copot/Hapus Wali Kelas Cepat
window.removeWaliKelas = async function (kelas, uid) {
    const waliUser = allUsersData.find(u => u.id === uid);
    if (!waliUser) return;

    const confirmMsg = `Apakah Anda yakin ingin mencopot <b>${escapeHTML(waliUser.name)}</b> dari jabatan Wali Kelas <b>${escapeHTML(kelas)}</b>?`;

    const modal = document.getElementById('modal-confirm');
    const msgEl = document.getElementById('confirm-msg');
    const btnConfirm = document.getElementById('btn-confirm-yes');

    msgEl.innerHTML = confirmMsg;
    btnConfirm.innerText = 'Ya, Copot';

    btnConfirm.onclick = async () => {
        btnConfirm.disabled = true;
        btnConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Mencopot...';

        try {
            const updateWali = {
                assignedClass: null,
                updatedAt: serverTimestamp()
            };
            if (waliUser.role === 'wali_kelas') {
                updateWali.role = 'guru_mapel';
            }
            if (waliUser.additionalRoles && waliUser.additionalRoles.includes('wali_kelas')) {
                updateWali.additionalRoles = waliUser.additionalRoles.filter(r => r !== 'wali_kelas');
            }
            await updateDoc(doc(db, PATHS.users, uid), updateWali);

            if (typeof window.logAudit === 'function') {
                window.logAudit('UPDATE_USER', uid, waliUser, updateWali, `Mencopot Wali Kelas ${kelas}`);
            }

            modal.classList.add('hidden');
            showModernAlert("Berhasil Dicopot", `Wali Kelas untuk kelas <b>${escapeHTML(kelas)}</b> telah dinonaktifkan.`);
            
            // Sinkronisasi Data (SSOT)
            await loadUsers(); // reload user list & update allUsersData cache
            window.loadWaliKelasMapping(); // render ulang
            
        } catch (error) {
            console.error(error);
            showModernAlert("Gagal Mencopot", error.message, 'error');
            window.loadWaliKelasMapping();
        } finally {
            btnConfirm.disabled = false;
            btnConfirm.innerHTML = 'Ya, Hapus';
            btnConfirm.onclick = executeDeleteUser;
        }
    };

    modal.classList.remove('hidden');
};

// 6. Handler Perubahan Input Searchable Datalist
window.changeWaliKelasDatalist = async function (kelas, selectedName, currentWaliUid) {
    if (!selectedName.trim()) {
        // Jika nama dikosongkan secara manual oleh admin, maka copot jabatan wali kelas
        if (currentWaliUid) {
            window.removeWaliKelas(kelas, currentWaliUid);
        }
        return;
    }

    // Cari user guru berdasarkan nama di cache memori lokal (case-insensitive)
    const newWali = allUsersData.find(u => (u.name || '').trim().toLowerCase() === selectedName.trim().toLowerCase());
    if (!newWali) {
        showModernAlert("Guru Tidak Ditemukan", `Guru dengan nama <b>${escapeHTML(selectedName)}</b> tidak terdaftar di database user.<br>Silakan pilih dari daftar sugesti yang muncul.`, "error");
        window.loadWaliKelasMapping(); // Reset input ke nilai semula
        return;
    }

    // Jika guru ditemukan, teruskan ke fungsi changeWaliKelas
    window.changeWaliKelas(kelas, newWali.id, currentWaliUid);
};

// 7. Render Dropdown Guru Kustom per Kelas
window.renderTeacherDropdownForClass = function (input, dropdown, teachersList, filterText, kelas, currentWaliUid) {
    const term = filterText.toLowerCase().trim();

    // Filter guru
    let filtered = teachersList;
    if (term) {
        filtered = teachersList.filter(t => 
            (t.name || '').toLowerCase().includes(term) ||
            (t.email || '').toLowerCase().includes(term)
        );
    }

    // Batasi sugesti (maks 10)
    const maxShow = 10;
    const sliced = filtered.slice(0, maxShow);

    if (sliced.length === 0) {
        dropdown.innerHTML = `<div class="px-4 py-2.5 text-xs text-slate-400 text-center italic">Tidak ditemukan</div>`;
        dropdown.classList.remove('hidden');
        return;
    }

    dropdown.innerHTML = sliced.map(t => {
        let labelExtra = '';
        if (t.assignedClass && (t.role === 'wali_kelas' || (t.additionalRoles && t.additionalRoles.includes('wali_kelas')))) {
            labelExtra = `<span class="text-[9px] text-slate-400 dark:text-slate-500 whitespace-nowrap bg-slate-100 dark:bg-slate-700/50 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">Wali Kelas ${t.assignedClass}</span>`;
        }

        return `
        <div class="teacher-dropdown-item px-3 py-2 cursor-pointer hover:bg-blue-50 dark:hover:bg-slate-700/50 flex items-center justify-between gap-2 border-b border-slate-50 dark:border-slate-700/50 last:border-0 transition-colors select-none"
             data-uid="${escapeHTML(t.id)}" data-name="${escapeHTML(t.name || '')}">
            <div class="flex items-center gap-2 min-w-0">
                <div class="w-5 h-5 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-400 text-[10px] font-bold shrink-0">
                    ${escapeHTML((t.name || 'G').charAt(0).toUpperCase())}
                </div>
                <div class="font-semibold text-xs text-slate-700 dark:text-slate-200 truncate">${escapeHTML(t.name || '')}</div>
            </div>
            ${labelExtra}
        </div>`;
    }).join('');

    if (filtered.length > maxShow) {
        dropdown.innerHTML += `<div class="px-3 py-1.5 text-[9px] text-slate-400 dark:text-slate-500 text-center bg-slate-50 dark:bg-slate-900/50 border-t dark:border-slate-700/50">...dan ${filtered.length - maxShow} guru lainnya.</div>`;
    }

    // Daftarkan event klik ke setiap item sugesti kustom
    dropdown.querySelectorAll('.teacher-dropdown-item').forEach(item => {
        item.addEventListener('mousedown', (e) => {
            // Gunakan mousedown agar event trigger sebelum event blur pada input
            const selectedUid = item.getAttribute('data-uid');
            const selectedName = item.getAttribute('data-name');
            
            input.value = selectedName;
            dropdown.classList.add('hidden');

            window.changeWaliKelas(kelas, selectedUid, currentWaliUid);
        });
    });

    dropdown.classList.remove('hidden');
};

// Event Listener: Tutup dropdown kustom ketika klik di luar input/dropdown
document.addEventListener('click', (e) => {
    const dropdowns = document.querySelectorAll('.teacher-dropdown');
    dropdowns.forEach(dropdown => {
        const input = dropdown.previousElementSibling; // input.teacher-search-input
        if (input && dropdown) {
            if (!input.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.add('hidden');
                
                // Kembalikan ke nama wali kelas yang sah jika admin mengetik asal-asalan lalu mengklik luar
                const currentName = input.value.trim();
                const match = allUsersData.find(u => (u.name || '').trim().toLowerCase() === currentName.toLowerCase());
                
                if (currentName === '') {
                    window.changeWaliKelasDatalist(input.getAttribute('data-class'), '', input.getAttribute('data-current-uid'));
                } else if (!match) {
                    const currentWaliUid = input.getAttribute('data-current-uid');
                    if (currentWaliUid) {
                        const originalWali = allUsersData.find(u => u.id === currentWaliUid);
                        input.value = originalWali ? originalWali.name : '';
                    } else {
                        input.value = '';
                    }
                }
            }
        }
    });
});

// === SINKRONISASI & VERIFIKASI EMAIL GTK (PROTEKSI AKUN GOOGLE SIGN-IN) ===
window.syncGtkEmailVerification = async () => {
    const btn = document.getElementById('btn-sync-emails');
    if (!btn) return;
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Memverifikasi...';
    try {
        if (!allUsersData || allUsersData.length === 0) {
            await loadUsers();
        }
        const uidsToVerify = (allUsersData || []).map(u => u.id || u.uid).filter(Boolean);
        if (uidsToVerify.length === 0) {
            showModernAlert("Informasi", "Tidak ada data pengguna yang ditemukan.", "info");
            return;
        }
        const resp = await cfClient.batchVerifyUserEmails(uidsToVerify);
        showModernAlert(
            "Verifikasi Berhasil",
            `Sebanyak <b>${resp.verifiedCount || uidsToVerify.length}</b> email akun GTK berhasil ditandai terverifikasi (emailVerified: true).<br><span class="text-xs text-slate-500 mt-1 block">Akun kini terlindungi dari pencabutan kata sandi saat pertama kali mencoba Login Google.</span>`,
            "success"
        );
    } catch (e) {
        console.error('[Sync Email Verification Error]:', e);
        showModernAlert("Gagal Verifikasi", e.message || "Gagal memverifikasi email akun pengguna.", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
};
