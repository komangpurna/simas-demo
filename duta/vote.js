/* duta/vote.js - Logika Pemilihan Duta SHAKTI 2026 dengan Alur Instan & Hybrid */
import { auth, db, PATHS, APP_VERSION, supabase } from '../js/config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { callSecureEdgeFunction } from '../js/global.js';

// =========================================================================
// 1. SUPABASE CONFIGURATION (SSOT INSTANCE)
// =========================================================================

// =========================================================================
// 2. SSO SESSION CHECK (SSOT - Single Source of Truth SIMAS Hybrid)
// =========================================================================
let currentStudent = null;
let currentNIS = null;

async function checkUserSession(user) {
    const savedNIS = sessionStorage.getItem('student_nis');
    const cachedData = sessionStorage.getItem('student_data');

    // 1. Jika pengguna login adalah SISWA
    if (savedNIS && cachedData) {
        try {
            currentStudent = JSON.parse(cachedData);
            currentNIS = savedNIS;

            document.getElementById('student-name').innerText = currentStudent.name || '-';
            document.getElementById('student-class').innerText = currentStudent.class || '-';
            document.getElementById('student-nis').innerText = currentStudent.nis || currentNIS;

            return true;
        } catch (e) {
            console.error('[Duta] Gagal mengurai sesi data siswa:', e);
        }
    }

    // 2. Jika pengguna login adalah STAF SEKOLAH
    const userRole = localStorage.getItem('user_role');
    const hasRole = userRole && userRole !== 'undefined';
    if (user && hasRole) {
        try {
            const cacheKey = `simas_user_data_cache_${user.uid}`;
            let userData = null;

            try {
                const cached = localStorage.getItem(cacheKey);
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (parsed && parsed.data) userData = parsed.data;
                }
            } catch (e) { console.warn('[Duta] Gagal membaca cache user data:', e); }

            if (!userData) {
                const snap = await getDoc(doc(db, PATHS.users, user.uid));
                if (snap.exists()) {
                    userData = snap.data();
                    const cacheObj = { data: userData, timestamp: Date.now() };
                    localStorage.setItem(cacheKey, JSON.stringify(cacheObj));
                }
            }

            if (userData) {
                // Cek apakah role termasuk yang dilarang memilih (super_admin, admin_kelas, admin_pks)
                const forbiddenRoles = ['super_admin', 'admin_kelas', 'admin_pks'];
                const primaryRole = userData.role;
                const additionalRoles = userData.additionalRoles || [];
                const allRoles = primaryRole ? [primaryRole, ...additionalRoles] : additionalRoles;
                const hasForbiddenRole = allRoles.some(r => forbiddenRoles.includes(r));

                if (hasForbiddenRole) {
                    if (allRoles.includes('super_admin')) {
                        // Masuk ke Mode Peninjau untuk Super Admin
                        currentNIS = 'ADMIN-SIMULASI';
                        currentStudent = {
                            nis: 'ADMIN-SIMULASI',
                            name: userData.name || 'Super Admin Peninjau',
                            class: 'Mode Peninjau (Read-only)'
                        };
                        document.getElementById('student-name').innerText = currentStudent.name;
                        document.getElementById('student-class').innerText = currentStudent.class;
                        
                        const nisLabelContainer = document.getElementById('student-nis').parentElement;
                        if (nisLabelContainer) {
                            nisLabelContainer.innerHTML = `<span class="bg-amber-100 text-amber-700 px-2.5 py-0.5 rounded-full text-[9px] font-black border border-amber-200 uppercase tracking-wide">Mode Peninjau</span>`;
                        }
                    } else {
                        showForbiddenRoleScreen(primaryRole);
                        return false;
                    }
                } else {
                    const roles = {
                        'kesiswaan': 'Staf Kesiswaan',
                        'guru_bk': 'Guru BK',
                        'wali_kelas': 'Wali Kelas',
                        'guru': 'Guru',
                        'admin_spp': 'Bendahara SPP',
                        'admin_kelas': 'Administrator Kelas',
                        'kepala_lab': 'Kepala Lab',
                        'guru_mapel': 'Guru Mata Pelajaran',
                        'staff': 'Staf Pegawai',
                        'admin_pks': 'Admin PKS',
                        'kepala_sekolah': 'Kepala Sekolah'
                    };
                    const roleLabel = roles[userData.role] || 'Staf Sekolah';

                    currentStudent = {
                        nis: user.uid,
                        name: userData.name || user.email.split('@')[0],
                        class: roleLabel
                    };
                    currentNIS = user.uid;

                    document.getElementById('student-name').innerText = currentStudent.name;
                    document.getElementById('student-class').innerText = currentStudent.class;

                    const nisLabelContainer = document.getElementById('student-nis').parentElement;
                    if (nisLabelContainer) {
                        nisLabelContainer.innerHTML = `UID: <span id="student-nis" class="font-bold text-slate-700">${currentNIS.substring(0, 10)}...</span>`;
                    } else {
                        document.getElementById('student-nis').innerText = currentNIS;
                    }
                }

                return true;
            }
        } catch (err) {
            console.error('[Duta] Gagal mengurai sesi user staf:', err);
        }
    }

    console.warn('[Duta] Sesi tidak valid. Mengalihkan...');
    const redirectTarget = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
    window.location.replace('../index.html?redirect=' + redirectTarget);
    return false;
}

// =========================================================================
// 3. INTERNAL STATE & APP INITIALIZATION
// =========================================================================
const categories = ['Sehat', 'Humanis', 'Agamais', 'Kreatif', 'Trampil', 'Inovatif'];
const categoryIcons = {
    'Sehat': 'fa-heart-pulse text-rose-500 bg-rose-50',
    'Humanis': 'fa-people-group text-blue-500 bg-blue-50',
    'Agamais': 'fa-hands-praying text-emerald-500 bg-emerald-50',
    'Kreatif': 'fa-lightbulb text-amber-500 bg-amber-50',
    'Trampil': 'fa-wand-magic-sparkles text-indigo-500 bg-indigo-50',
    'Inovatif': 'fa-rocket text-purple-500 bg-purple-50'
};

let activeCategory = 'Sehat';
let votedCategories = [];
let votedCandidatesMap = {};
let candidatesList = [];
let candidatesLoaded = false;

function isSupabaseConfigured() {
    return !!supabase;
}

function initSupabase() {
    return !!supabase;
}

// =========================================================================
// 4. DATA FETCHERS (SUPABASE)
// =========================================================================
async function fetchVotedCategories() {
    votedCandidatesMap = {};
    if (!supabase) {
        const localVotes = JSON.parse(localStorage.getItem(`demo_votes_${currentNIS}`)) || [];
        votedCategories = localVotes.map(v => v.kategori);
        localVotes.forEach(v => {
            votedCandidatesMap[v.kategori] = v.id_kandidat;
        });
        return;
    }

    try {
        const { data, error } = await supabase
            .from('duta_suara_masuk')
            .select('kategori, id_kandidat')
            .eq('nis_pemilih', String(currentNIS));

        if (error) throw error;

        votedCategories = data ? data.map(item => item.kategori) : [];
        if (data) {
            data.forEach(item => {
                votedCandidatesMap[item.kategori] = item.id_kandidat;
            });
        }
    } catch (err) {
        console.error('[Duta] Gagal mengambil riwayat suara:', err.message);
        showDemoToast('Database gagal terhubung. Berjalan dalam mode offline.', 'error');
    }
}

async function fetchCandidates() {
    if (!supabase) {
        candidatesList = getDummyCandidates();
        candidatesLoaded = true;
        return;
    }

    try {
        const { data, error } = await supabase
            .from('duta_kandidat')
            .select('*');

        if (error) throw error;
        candidatesList = data || [];
    } catch (err) {
        console.error('[Duta] Gagal memuat kandidat:', err.message);
        candidatesList = getDummyCandidates();
    } finally {
        candidatesLoaded = true;
    }
}

// =========================================================================
// 5. FRONTEND RENDERING LOGIC
// =========================================================================
function renderCategoryList() {
    const container = document.getElementById('category-list');
    if (!container) return;

    container.innerHTML = categories.map(cat => {
        const isActive = cat === activeCategory;
        const isVoted = votedCategories.includes(cat);
        const iconClass = categoryIcons[cat] || 'fa-star text-slate-500 bg-slate-50';

        const activeStyle = isActive
            ? 'category-tab-active border-transparent'
            : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-100 hover:border-slate-200';

        let badgeHtml = '';
        if (isVoted) {
            badgeHtml = `
                <span class="ml-auto shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 border border-emerald-250 font-bold" title="Pilihan Tersimpan">
                    <i class="fa-solid fa-check text-[9px]"></i>
                </span>
            `;
        } else {
            badgeHtml = `
                <span class="ml-auto shrink-0 w-2 h-2 rounded-full bg-purple-500 animate-ping" title="Belum Vote"></span>
            `;
        }

        return `
            <button onclick="window.switchCategory('${cat}')" 
                class="flex items-center gap-3 px-4 py-3 rounded-xl border text-xs font-bold font-outfit transition-all duration-300 active:scale-[0.98] w-full ${activeStyle}">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 ${isActive ? 'bg-white/20 text-white' : iconClass.split(' ')[1] + ' ' + iconClass.split(' ')[2]}">
                    <i class="fa-solid ${iconClass.split(' ')[0]}"></i>
                </div>
                <span class="truncate">Duta ${cat}</span>
                ${badgeHtml}
            </button>
        `;
    }).join('');
}

function renderCandidatesGrid() {
    const grid = document.getElementById('candidates-grid');
    const summaryTitle = document.getElementById('current-category-title');
    const summaryBadge = document.getElementById('category-status-badge');
    if (!grid || !summaryTitle || !summaryBadge) return;

    if (!candidatesLoaded) {
        summaryTitle.innerText = `Duta CERDAS Kategori ${activeCategory}`;
        summaryBadge.innerHTML = `
            <span class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-extrabold bg-slate-100 text-slate-500 border border-slate-200 uppercase tracking-wide">
                <i class="fa-solid fa-circle-notch fa-spin"></i> Memuat...
            </span>
        `;
        grid.className = "grid grid-cols-1 gap-5 min-h-[300px]";
        grid.innerHTML = `
            <div class="col-span-full flex items-center justify-center py-12">
                <div class="text-center text-slate-400">
                    <i class="fa-solid fa-circle-notch fa-spin text-3xl mb-3 text-purple-500"></i>
                    <p class="text-xs font-medium">Memuat data kandidat...</p>
                </div>
            </div>
        `;
        return;
    }

    const filtered = candidatesList.filter(c => c.kategori === activeCategory);
    summaryTitle.innerText = `Duta CERDAS Kategori ${activeCategory}`;

    const isVoted = votedCategories.includes(activeCategory);
    const chosenCandidateId = votedCandidatesMap[activeCategory];

    if (isVoted) {
        summaryBadge.innerHTML = `
            <span class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-700 border border-emerald-200 uppercase tracking-wide">
                <i class="fa-solid fa-circle-check"></i> Sudah Memilih
            </span>
        `;
    } else {
        summaryBadge.innerHTML = `
            <span class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-extrabold bg-purple-100 text-purple-700 border border-purple-200 uppercase tracking-wide">
                <i class="fa-solid fa-circle-info"></i> Menunggu Suara
            </span>
        `;
    }

    if (filtered.length === 0) {
        grid.className = "grid grid-cols-1 gap-5 min-h-[300px]";
        grid.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center bg-white border border-slate-100 rounded-3xl p-12 text-center shadow-sm">
                <div class="w-16 h-16 bg-slate-50 text-slate-400 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-slate-100">
                    <i class="fa-solid fa-user-slash text-2xl"></i>
                </div>
                <h4 class="font-extrabold text-slate-800 text-sm mb-1">Belum Ada Kandidat</h4>
                <p class="text-xs text-slate-400 max-w-xs mx-auto">
                    Kandidat Duta CERDAS kategori ${activeCategory} belum ditambahkan.
                </p>
            </div>
        `;
        return;
    }

    grid.className = "grid grid-cols-1 md:grid-cols-2 gap-5 min-h-[300px]";
    grid.innerHTML = filtered.map(c => {
        const photoUrl = c.foto_url || `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&h=300`;

        let actionButtonHtml = '';
        if (isVoted) {
            if (chosenCandidateId === c.id) {
                // Kandidat yang dipilih menampilkan centang hijau instan
                actionButtonHtml = `
                    <button onclick="window.executeVote('${c.id}', '${window.escapeJSString(c.nama)}', this)"
                        class="w-full bg-emerald-50 text-emerald-700 border-2 border-emerald-500 py-3 px-4 rounded-xl text-xs font-black flex items-center justify-center gap-2 select-none shadow shadow-emerald-500/10 hover:bg-emerald-100/70 transition-all duration-300">
                        <i class="fa-solid fa-circle-check text-base text-emerald-600"></i> Pilihan Anda (Tersimpan)
                    </button>
                `;
            } else {
                // Kandidat lain menampilkan tombol pindahkan suara secara instan
                actionButtonHtml = `
                    <button onclick="window.executeVote('${c.id}', '${window.escapeJSString(c.nama)}', this)"
                        class="w-full bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 py-3 px-4 rounded-xl text-xs font-bold hover:scale-[1.01] active:scale-95 transition-all duration-300 flex items-center justify-center gap-2">
                        <i class="fa-solid fa-arrows-rotate text-sm text-slate-400"></i> Pindahkan Suara Ke Sini
                    </button>
                `;
            }
        } else {
            // Tombol vote standar jika belum pernah memilih kategori ini
            actionButtonHtml = `
                <button onclick="window.executeVote('${c.id}', '${window.escapeJSString(c.nama)}', this)"
                    class="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-extrabold text-xs py-3 px-4 rounded-xl shadow-md shadow-purple-100 hover:shadow-lg hover:shadow-purple-200/50 hover:scale-[1.01] active:scale-95 transition-all duration-300 flex items-center justify-center gap-2">
                    <i class="fa-solid fa-check-to-slot text-sm"></i> Berikan Suara
                </button>
            `;
        }

        // Tampilkan Kelas, Prestasi Utama & Catatan Lainnya secara Informatif
        const infoKelas = c.kelas ? `<span class="bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider">Kelas ${c.kelas}</span>` : '';

        const infoPrestasi = c.prestasi ? `
            <div class="mt-3 bg-slate-50 border border-slate-100 rounded-xl p-2.5 text-left text-[10px] text-slate-600 leading-relaxed">
                <div class="font-extrabold text-slate-800 flex items-center gap-1 mb-0.5"><i class="fa-solid fa-medal text-amber-500 text-xs"></i> Prestasi Utama:</div>
                <span class="font-medium block space-y-0.5">
                    ${c.prestasi.includes(';') ?
                c.prestasi.split(';').map(p => p.trim()).filter(p => p).map(p => `<div class="flex items-start gap-1"><span class="text-amber-500">•</span><span>${p}</span></div>`).join('') :
                `<span>${c.prestasi}</span>`
            }
                </span>
            </div>
        ` : '';

        const infoCatatan = c.catatan_lain ? `
            <div class="mt-2 text-left text-[9px] text-slate-400 italic">
                <span class="font-bold text-slate-500 uppercase not-italic tracking-wide text-[8px]">Catatan:</span> ${c.catatan_lain}
            </div>
        ` : '';

        return `
            <div class="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col p-4 sm:p-5 hover:shadow-md transition-all duration-300 group hover:border-purple-200 animate-fade-in">
                <!-- Foto Kandidat Container -->
                <div class="relative rounded-2xl overflow-hidden aspect-square w-full mb-4 bg-slate-50 border border-slate-100 shrink-0">
                    <img src="${photoUrl}" alt="${c.nama}" class="w-full h-full object-cover group-hover:scale-103 transition-transform duration-500">
                    <div class="absolute top-3 left-3 bg-white/95 backdrop-blur px-2.5 py-1 rounded-lg border border-slate-100 text-[9px] font-black text-purple-600 shadow-sm uppercase tracking-wide">
                        Duta ${c.kategori}
                    </div>
                </div>

                <!-- Info Kandidat -->
                <div class="mb-4 flex-1 flex flex-col justify-start">
                    <div class="flex flex-wrap items-center gap-1.5 mb-1.5">
                        ${infoKelas}
                    </div>
                    <h3 class="text-xs font-black text-slate-800 leading-snug group-hover:text-purple-700 transition-colors font-outfit truncate">${c.nama}</h3>
                    ${infoPrestasi}
                    ${infoCatatan}
                </div>

                <!-- Action Button -->
                <div class="shrink-0 mt-3">
                    ${actionButtonHtml}
                </div>
            </div>
        `;
    }).join('');
}

window.switchCategory = function (category) {
    if (activeCategory === category) return;
    activeCategory = category;
    renderCategoryList();
    renderCandidatesGrid();
};
// =========================================================================
// 6. LOGIKA KIRIM/PINDAH SUARA INSTAN (OTOMATIS TERSIMPAN)
// =========================================================================
window.executeVote = async function (candidateId, candidateName, btnEl) {
    if (currentNIS === 'ADMIN-SIMULASI') {
        // Mode Peninjau: bypass sukses visual
        if (!votedCategories.includes(activeCategory)) {
            votedCategories.push(activeCategory);
        }
        votedCandidatesMap[activeCategory] = candidateId;
        renderCategoryList();
        renderCandidatesGrid();
        updateSubmitButtonState();
        showDemoToast('Mode Peninjau: Suara berhasil disimulasikan pindah.');
        return;
    }

    let originalHtml = '';
    if (btnEl) {
        originalHtml = btnEl.innerHTML;
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...';
    }

    try {
        const role_pemilih = sessionStorage.getItem('student_nis') ? 'siswa' : 'guru';
        const payload = {
            nis_pemilih: String(currentNIS),
            nama_pemilih: String(currentStudent.name),
            kelas_pemilih: String(currentStudent.class),
            id_kandidat: candidateId,
            kategori: activeCategory,
            role_pemilih: role_pemilih
        };

        if (!supabase) {
            // Mode Demo / Offline
            const localVotes = JSON.parse(localStorage.getItem(`demo_votes_${currentNIS}`)) || [];
            // Hapus suara lama pada kategori ini jika ada
            const filteredVotes = localVotes.filter(v => v.kategori !== activeCategory);
            filteredVotes.push(payload);
            localStorage.setItem(`demo_votes_${currentNIS}`, JSON.stringify(filteredVotes));
            await new Promise(r => setTimeout(r, 600));
        } else {
            // Simpan ke Supabase via Edge Function secure proxy
            await callSecureEdgeFunction('duta-vote', payload);
        }

        // Simpan pilihan di memori lokal agar UI langsung update
        if (!votedCategories.includes(activeCategory)) {
            votedCategories.push(activeCategory);
        }
        votedCandidatesMap[activeCategory] = candidateId;

        // Cek jika seluruh 6 kategori sudah diisi
        const isCompleted = votedCategories.length === 6;
        if (isCompleted) {
            // Hapus cache portal untuk menghilangkan banner di dashboard utama
            sessionStorage.removeItem('session_portal_config');
            localStorage.setItem(`duta_voting_completed_${currentNIS}`, 'true');

            // Tampilkan modal sukses setelah seluruh kategori selesai dipilih
            const modal = document.getElementById('modal-success-vote');
            if (modal) {
                const portalLink = document.getElementById('btn-success-portal-link');
                if (portalLink) {
                    const isStudent = !!sessionStorage.getItem('student_nis');
                    portalLink.href = isStudent ? '../portal-siswa.html' : '../dashboard.html';
                    portalLink.innerText = isStudent ? 'Ke Halaman Utama Portal' : 'Ke Dashboard';
                }
                modal.classList.remove('hidden');
            }
        }

        // Render ulang reaktif
        renderCategoryList();
        renderCandidatesGrid();
        updateSubmitButtonState();

        showDemoToast(`Kandidat ${candidateName} terpilih untuk kategori Duta ${activeCategory}.`, 'success');
    } catch (e) {
        console.error('[Duta] Gagal mengirim voting:', e);
        showDemoToast('Gagal menyimpan suara: ' + e.message, 'error');
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = originalHtml;
        }
    }
};

// Fungsi Baru: Update progress status di left panel
function updateSubmitButtonState() {
    const container = document.getElementById('submit-votes-container');
    if (!container) return;

    const count = votedCategories.length;
    const isCompleted = count === 6;

    if (!isCompleted) {
        container.innerHTML = `
            <div class="bg-purple-50/50 border border-purple-100/80 rounded-xl p-3.5 text-center">
                <span class="text-[10px] uppercase font-black text-purple-600 tracking-wider block mb-1">Kemajuan Voting</span>
                <div class="flex items-center justify-center gap-1">
                    <span class="font-outfit text-base font-extrabold text-purple-800">${count}</span>
                    <span class="text-xs text-slate-400">dari</span>
                    <span class="font-outfit text-base font-extrabold text-slate-600">6</span>
                    <span class="text-xs text-slate-400">Kategori Terisi</span>
                </div>
                <div class="w-full bg-slate-100 rounded-full h-1.5 mt-2.5 overflow-hidden">
                    <div class="bg-gradient-to-r from-purple-500 to-indigo-500 h-1.5 rounded-full transition-all duration-500" style="width: ${(count / 6) * 100}%"></div>
                </div>
                <p class="text-[9px] text-slate-400 mt-2.5 leading-relaxed">
                    Silakan tentukan pilihan Anda di semua kategori. Pilihan otomatis tersimpan ketika Anda mengklik kandidat.
                </p>
            </div>
        `;
    } else {
        const isStudent = !!sessionStorage.getItem('student_nis');
        const backUrl = isStudent ? '../portal-siswa.html' : '../dashboard.html';
        const backLabel = isStudent ? 'Kembali ke Portal' : 'Kembali ke Dashboard';

        container.innerHTML = `
            <div class="space-y-3">
                <div class="bg-emerald-50/50 border border-emerald-100/80 rounded-xl p-3.5 text-center animate-fade-in">
                    <div class="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-2 border border-emerald-200">
                        <i class="fa-solid fa-circle-check text-sm"></i>
                    </div>
                    <span class="text-[10px] uppercase font-black text-emerald-700 tracking-wider block mb-0.5">Voting Selesai</span>
                    <p class="text-[9px] text-emerald-600 font-bold leading-relaxed">
                        Suara Anda untuk semua kategori telah berhasil disimpan secara permanen di database.
                    </p>
                    <p class="text-[9px] text-slate-400 mt-2 leading-relaxed">
                        Anda masih bisa mengubah pilihan kapan saja dengan memilih kandidat lain sebelum masa voting ditutup.
                    </p>
                </div>
                <a href="${backUrl}" class="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-extrabold text-xs py-3 px-4 rounded-xl shadow-md hover:scale-[1.01] active:scale-95 transition-all duration-300 flex items-center justify-center gap-2">
                    <i class="fa-solid fa-arrow-left"></i> ${backLabel}
                </a>
            </div>
        `;
    }
}

window.closeSuccessModal = function () {
    const modal = document.getElementById('modal-success-vote');
    if (modal) modal.classList.add('hidden');
};

// =========================================================================
// 7. HELPERS & ALERTS
// =========================================================================
function showDemoToast(msg, type = 'info') {
    // Hapus toast lama jika ada agar tidak menumpuk
    const oldToast = document.getElementById('duta-toast');
    if (oldToast) oldToast.remove();

    const toast = document.createElement('div');
    toast.id = 'duta-toast';

    const colors = {
        'success': 'bg-emerald-950/90 text-emerald-200 border-emerald-500/20',
        'error': 'bg-rose-950/90 text-rose-200 border-rose-500/20',
        'info': 'bg-slate-900/90 text-slate-200 border-slate-700'
    };
    const colorClass = colors[type] || colors.info;

    toast.className = `fixed bottom-5 right-5 z-[200] px-4 py-3 rounded-2xl shadow-2xl border text-[11px] font-bold font-outfit flex items-center gap-2 animate-fade-in ${colorClass}`;

    const icons = {
        'success': '<i class="fa-solid fa-circle-check text-emerald-400"></i>',
        'error': '<i class="fa-solid fa-circle-xmark text-rose-400"></i>',
        'info': '<i class="fa-solid fa-circle-info text-blue-400 animate-pulse"></i>'
    };
    const icon = icons[type] || icons.info;

    toast.innerHTML = `${icon} <span>${msg}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
        if (document.body.contains(toast)) toast.remove();
    }, 3500);
}

window.escapeJSString = function (str) {
    if (!str) return '';
    return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
};

function getDummyCandidates() {
    return [
        { id: 'c1', nama: 'I Gede Aditya Wiranata', kategori: 'Sehat', kelas: 'XII-3', prestasi: 'Juara 1 Lomba Senam Sekolah Tingkat Kabupaten', catatan_lain: 'Sangat disiplin dan aktif menjaga kebugaran', foto_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&h=300' },
        { id: 'c2', nama: 'Ni Putu Evelyn Pradnya', kategori: 'Sehat', kelas: 'XI-1', prestasi: 'Juara 2 Badminton Putri O2SN', catatan_lain: 'Menjaga pola makan sehat secara konsisten', foto_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&h=300' },
        { id: 'c3', nama: 'I Komang Purna Wijaya', kategori: 'Humanis', kelas: 'XII-1', prestasi: 'Koordinator Relawan Bencana PMI Sekolah', catatan_lain: 'Sopan, ramah, dan sangat peka terhadap lingkungan sosial', foto_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&h=300' },
        { id: 'c4', nama: 'Ni Made Ayu Saraswati', kategori: 'Humanis', kelas: 'XI-2', prestasi: 'Ketua Divisi Pengabdian Masyarakat OSIS', catatan_lain: 'Selalu mendahulukan kepentingan bersama', foto_url: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=300&h=300' }
    ];
}

function showForbiddenRoleScreen(role) {
    const roles = {
        'super_admin': 'Super Admin',
        'admin_kelas': 'Administrator Kelas',
        'admin_pks': 'Admin PKS'
    };
    const roleLabel = roles[role] || 'Administrator/Akses Khusus';

    document.body.innerHTML = `
        <div class="min-h-screen bg-slate-50 flex items-center justify-center p-4 selection:bg-purple-100 selection:text-purple-900 font-sans">
            <div class="bg-white rounded-[2rem] border border-slate-100 shadow-2xl p-8 max-w-md w-full text-center relative overflow-hidden">
                <div class="absolute -right-20 -top-20 w-52 h-52 bg-purple-500/10 rounded-full blur-3xl"></div>
                <div class="absolute -left-20 -bottom-20 w-52 h-52 bg-indigo-500/10 rounded-full blur-3xl"></div>
                
                <div class="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-6 border border-amber-100 shadow-inner">
                    <i class="fa-solid fa-triangle-exclamation text-3xl"></i>
                </div>
                
                <h3 class="font-extrabold font-outfit text-slate-800 text-lg mb-3">Akses Voting Dibatasi</h3>
                <p class="text-xs text-slate-500 mb-6 leading-relaxed">
                    Mohon maaf, akun Anda dengan peran <b>${roleLabel}</b> dikecualikan dari hak suara pemilihan Duta CERDAS.
                </p>
                <a href="../dashboard.html" class="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold text-xs py-3.5 px-4 rounded-xl shadow-lg shadow-purple-500/10 active:scale-95 transition-all inline-block text-center">
                    Kembali ke Dashboard
                </a>
            </div>
        </div>
    `;
}

// Tampilkan screen khusus jika voting dinonaktifkan
function showVotingClosedScreen() {
    const isStudent = !!sessionStorage.getItem('student_nis');
    const backUrl = isStudent ? '../portal-siswa.html' : '../dashboard.html';
    const backLabel = isStudent ? 'Kembali ke Portal Siswa' : 'Kembali ke Dashboard';

    document.body.innerHTML = `
        <div class="min-h-screen bg-slate-50 flex items-center justify-center p-4 selection:bg-purple-100 selection:text-purple-900 font-sans">
            <div class="bg-white rounded-[2rem] border border-slate-100 shadow-2xl p-8 max-w-md w-full text-center relative overflow-hidden">
                <div class="absolute -right-20 -top-20 w-52 h-52 bg-purple-500/10 rounded-full blur-3xl"></div>
                <div class="absolute -left-20 -bottom-20 w-52 h-52 bg-indigo-500/10 rounded-full blur-3xl"></div>
                
                <div class="w-16 h-16 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-6 border border-rose-150 shadow-inner">
                    <i class="fa-solid fa-circle-xmark text-3xl animate-pulse"></i>
                </div>
                
                <h3 class="font-extrabold font-outfit text-slate-800 text-lg mb-3">Voting Duta Shakti Ditutup</h3>
                <p class="text-xs text-slate-500 mb-6 leading-relaxed">
                    Mohon maaf, pemilihan <b>Anugerah Duta CERDAS 2026</b> saat ini sedang dinonaktifkan atau telah ditutup oleh pihak Panitia.
                </p>
                <a href="${backUrl}" class="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold text-xs py-3.5 px-4 rounded-xl shadow-lg shadow-purple-500/10 active:scale-95 transition-all inline-block text-center">
                    ${backLabel}
                </a>
            </div>
        </div>
    `;
}

// =========================================================================
// 8. PAGE ON-LOAD BINDING & TRIGGER
// =========================================================================
onAuthStateChanged(auth, async (user) => {
    const sessionActive = await checkUserSession(user);
    if (!sessionActive) return;

    // Cek status aktif voting dari Firestore (SSOT settings/system_config)
    let votingActive = true;
    try {
        const configSnap = await getDoc(doc(db, PATHS.settings, 'system_config'));
        if (configSnap.exists()) {
            const configData = configSnap.data();
            if (configData.dutaVoting === false) {
                votingActive = false;
            }
        }
    } catch (e) {
        console.error('[Duta] Gagal memeriksa status voting:', e);
    }

    if (!votingActive) {
        showVotingClosedScreen();
        document.body.style.display = 'block';
        return;
    }

    // Tampilkan body secara eksplisit (memintas anti-flicker guard dari global.js)
    document.body.style.display = 'block';

    // Render versi dinamis dari SSOT
    const versionEl = document.getElementById('duta-version-display');
    if (versionEl) {
        versionEl.innerText = `Portal Pemilihan Duta CERDAS ${APP_VERSION}`;
    }

    const supabaseActive = initSupabase();

    if (!supabaseActive) {
        showDemoToast('Server database offline. Berjalan dalam Mode Simulasi Lokal.', 'info');
    }

    // Render tampilan/skeleton awal secara instan agar halaman tidak kosong putih saat loading
    renderCategoryList();
    renderCandidatesGrid();
    updateSubmitButtonState();

    // Jalankan fetch data secara paralel untuk menghemat waktu latensi
    try {
        await Promise.all([
            fetchVotedCategories(),
            fetchCandidates()
        ]);
    } catch (e) {
        console.error('[Duta] Gagal memuat data voting:', e);
    }

    // Render ulang dengan data terbaru dari server
    renderCategoryList();
    renderCandidatesGrid();
    updateSubmitButtonState();
});
