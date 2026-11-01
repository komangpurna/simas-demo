import { auth, db, PATHS, supabase } from './config.js';
import { initLayout } from './global.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { doc, getDoc, setDoc, collection, getDocs } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

// =========================================================================
// 1. SUPABASE CONFIGURATION (SSOT INSTANCE)
// =========================================================================

// =========================================================================
// 2. SSO ADMIN SESSION CHECK (Proteksi Akses Panel Admin SIMAS)
// =========================================================================
function checkAdminSession() {
    const allowedRoles = ['super_admin', 'kesiswaan', 'admin_duta'];

    // Memeriksa peran menggunakan window.hasRole agar mendukung multi-role (tugas tambahan)
    const hasAccess = window.hasRole ? 
        allowedRoles.some(r => window.hasRole(r)) : 
        allowedRoles.includes(localStorage.getItem('user_role'));

    if (!hasAccess) {
        console.warn('[Duta Admin] Akses ditolak. Peran tidak mencukupi.');
        const redirectTarget = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
        window.location.replace('index.html?redirect=' + redirectTarget);
        return false;
    }
    return true;
}

// =========================================================================
// 2A. MANAGING VOTING STATUS (Firestore-based Config)
// =========================================================================
async function loadVotingStatus() {
    const toggleEl = document.getElementById('toggle-duta-voting');
    const statusEl = document.getElementById('status-duta-voting');
    if (!toggleEl) return;

    try {
        const data = await window.getSystemConfig();
        if (data) {
            const isActive = data.dutaVoting || false;

            toggleEl.checked = isActive;
            if (statusEl) {
                statusEl.innerText = isActive ? 'Aktif' : 'Nonaktif';
                statusEl.className = `text-[10px] font-black uppercase ${isActive ? 'text-purple-600 dark:text-purple-400' : 'text-slate-400 dark:text-slate-500'}`;
            }
        }
    } catch (e) {
        console.error('[Duta Admin] Gagal memuat status voting:', e);
    }
}

async function saveVotingStatus(isActive) {
    const statusEl = document.getElementById('status-duta-voting');
    try {
        await setDoc(doc(db, PATHS.settings, 'system_config'), {
            dutaVoting: isActive
        }, { merge: true });

        // Invalidasi cache system config
        if (typeof window.invalidateSystemConfig === 'function') window.invalidateSystemConfig();

        // Hapus cache lokal SIMAS agar pembaruan langsung terlihat di portal siswa
        sessionStorage.removeItem('session_portal_config');

        if (statusEl) {
            statusEl.innerText = isActive ? 'Aktif' : 'Nonaktif';
            statusEl.className = `text-[10px] font-black uppercase ${isActive ? 'text-purple-600 dark:text-purple-400' : 'text-slate-400 dark:text-slate-500'}`;
        }
        showAdminToast(`Status Voting Duta berhasil diubah menjadi ${isActive ? 'AKTIF' : 'NONAKTIF'}`, 'success');
    } catch (e) {
        console.error('[Duta Admin] Gagal menyimpan status voting:', e);
        showAdminToast('Gagal mengubah status voting: ' + e.message, 'error');
    }
}

// =========================================================================
// 3. INTERNAL STATE & APP INITIALIZATION
// =========================================================================
const categories = ['Sehat', 'Humanis', 'Agamais', 'Kreatif', 'Trampil', 'Inovatif'];
let dutaWeightSiswa = 40;
let dutaWeightGuru = 40;
let dutaWeightRekamJejak = 20;

let activeAdminTab = 'nominasi';
let candidatesList = [];
let votesList = [];
let secureVotePollingTimer = null;

// Cache data siswa & Pencarian Autocomplete untuk Form
let studentsCache = [];

async function loadStudentsForDropdown() {
    try {
        console.log('[Duta Admin] Memuat data siswa dari cache global SIMAS...');
        const allStudents = (typeof window.getStudentsCache === 'function')
            ? await window.getStudentsCache()
            : [];
        studentsCache = [];
        allStudents.forEach(d => {
            if (d.nis && d.class) {
                const lowerClass = d.class.toLowerCase();
                // Filter alumni & kelas non-aktif (Keluar, Pindah, Mutasi) agar tidak mengotori daftar aktif
                if (lowerClass.includes('alumni') || lowerClass.includes('keluar') || lowerClass.includes('pindah') || lowerClass.includes('mutasi')) return;
                studentsCache.push({
                    nis: d.nis,
                    name: d.name,
                    class: d.class
                });
            }
        });
        
        // Sorting siswa berdasarkan kelas kemudian nama
        studentsCache.sort((a, b) => {
            const classDiff = (a.class || '').localeCompare(b.class || '', undefined, { numeric: true });
            if (classDiff !== 0) return classDiff;
            return (a.name || '').localeCompare(b.name || '');
        });
        console.log(`[Duta Admin] ${studentsCache.length} siswa siap untuk dropdown form.`);
    } catch (e) {
        console.error('[Duta Admin] Gagal memuat data siswa untuk dropdown:', e);
    }
}

function renderStudentDropdown(filterText = '') {
    const dropdown = document.getElementById('student-dropdown-admin');
    if (!dropdown) return;
    const term = filterText.toLowerCase().trim();

    let filtered = studentsCache;
    if (term) {
        filtered = studentsCache.filter(s =>
            s.name.toLowerCase().includes(term) ||
            String(s.nis).includes(term) ||
            (s.class || '').toLowerCase().includes(term)
        );
    }

    const maxShow = 20;
    const sliced = filtered.slice(0, maxShow);

    if (sliced.length === 0) {
        dropdown.innerHTML = `<div class="px-4 py-3 text-xs text-slate-400 text-center">Tidak ditemukan</div>`;
        dropdown.classList.remove('hidden');
        return;
    }

    dropdown.innerHTML = sliced.map(s => `
        <div class="student-dropdown-item px-3 py-2.5 cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-950/20 flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 last:border-0 transition-colors text-xs text-slate-700 dark:text-slate-200"
             data-nis="${s.nis}" data-nama="${s.name}" data-class="${s.class}">
            <div class="w-6 h-6 bg-purple-50 dark:bg-purple-900/30 rounded-full flex items-center justify-center text-purple-600 dark:text-purple-400 text-[10px] font-extrabold shrink-0">
                ${s.name.charAt(0)}
            </div>
            <div class="flex-1 min-w-0 flex items-center justify-between gap-2">
                <div class="font-bold truncate">${s.name}</div>
                <div class="text-[9px] text-slate-400 dark:text-slate-500 whitespace-nowrap bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">${s.nis} &bull; ${s.class}</div>
            </div>
        </div>
    `).join('');

    if (filtered.length > maxShow) {
        dropdown.innerHTML += `<div class="px-4 py-2 text-[9px] text-slate-400 dark:text-slate-500 text-center bg-slate-50 dark:bg-slate-900">...dan ${filtered.length - maxShow} siswa lainnya. Ketik lebih spesifik.</div>`;
    }

    dropdown.classList.remove('hidden');
}

function initStudentDropdownListeners() {
    const inputNama = document.getElementById('kandidat-nama');
    const dropdown = document.getElementById('student-dropdown-admin');
    if (!inputNama || !dropdown) return;

    inputNama.addEventListener('focus', () => {
        if (studentsCache.length > 0) {
            renderStudentDropdown(inputNama.value);
        }
    });

    inputNama.addEventListener('input', (e) => {
        if (studentsCache.length > 0) {
            renderStudentDropdown(e.target.value);
        }
    });

    dropdown.addEventListener('click', (e) => {
        const item = e.target.closest('.student-dropdown-item');
        if (item) {
            const nama = item.dataset.nama;
            const kelas = item.dataset.class;
            inputNama.value = nama;
            
            const classInput = document.getElementById('kandidat-kelas');
            if (classInput) {
                classInput.value = kelas;
            }
            dropdown.classList.add('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        if (!inputNama.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });
}

// Inisialisasi Supabase (SSOT)
function initSupabase() {
    return !!supabase;
}

/**
 * Mengambil SEMUA baris dari tabel Supabase menggunakan pagination.
 * Supabase memiliki server-side max_rows limit (default 1000) yang TIDAK bisa
 * di-override oleh client-side .limit(). Fungsi ini mem-fetch dalam batch
 * 1000 baris per request hingga semua data terambil.
 * 
 * @param {string} table - Nama tabel Supabase
 * @param {string} columns - Kolom yang akan di-select (default: '*')
 * @returns {Promise<{data: Array, error: any}>}
 */
async function fetchAllRows(table, columns = '*') {
    const PAGE_SIZE = 1000;
    let allData = [];
    let from = 0;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase
            .from(table)
            .select(columns)
            .range(from, from + PAGE_SIZE - 1);

        if (error) return { data: null, error };

        allData = allData.concat(data || []);

        if (!data || data.length < PAGE_SIZE) {
            hasMore = false; // Halaman terakhir
        } else {
            from += PAGE_SIZE;
        }
    }

    console.log(`[Duta Admin] fetchAllRows('${table}'): ${allData.length} baris terambil.`);
    return { data: allData, error: null };
}

// =========================================================================
// 4. TAB NAVIGATION
// =========================================================================
window.switchAdminTab = function (tab) {
    // Izinkan re-fetch data terbaru saat klik tab 'hasil' atau 'rekap' meski sudah aktif
    const alwaysRefreshTabs = ['hasil', 'rekap'];
    if (activeAdminTab === tab && !alwaysRefreshTabs.includes(tab)) return;
    activeAdminTab = tab;

    const tabs = ['nominasi', 'hasil', 'partisipasi', 'pemenang', 'rekap'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const view = document.getElementById(`view-${t}`);
        if (!btn || !view) return;

        if (t === tab) {
            btn.classList.add('tab-active');
            btn.classList.remove('text-slate-500');
            view.classList.remove('hidden');
        } else {
            btn.classList.remove('tab-active');
            btn.classList.add('text-slate-500');
            view.classList.add('hidden');
        }
    });

    // Lazy load data on tab switch
    if (tab === 'hasil') {
        loadVotingResults();
    } else if (tab === 'partisipasi') {
        initKelasPartisipasiDropdown().then(() => {
            renderPartisipasiTable();
        });
    } else if (tab === 'pemenang') {
        loadWinnerStageConfig();
    } else if (tab === 'rekap') {
        loadRekapData();
    }
};

// =========================================================================
// 4A. STATUS PARTISIPASI VOTING SISWA (SUDAH & BELUM VOTING)
// =========================================================================
let partisipasiData = [];
let gtkCache = [];

async function loadGTKForDropdown() {
    try {
        console.log('[Duta Admin] Memuat master GTK dari SSOT (0 Firestore Read)...');
        const teachers = typeof window.getTeachersCache === 'function' ? await window.getTeachersCache() : [];
        gtkCache = [];
        
        if (Array.isArray(teachers)) {
            teachers.forEach(t => {
                const status = (t.status || 'aktif').toLowerCase();
                if (status === 'aktif' && t.name) {
                    gtkCache.push({
                        nis: t.id || t.nip || t.nik,
                        name: t.name.trim(),
                        class: 'GTK'
                    });
                }
            });
        }

        // Urutkan GTK berdasarkan nama
        gtkCache.sort((a, b) => a.name.localeCompare(b.name));
        console.log(`[Duta Admin] ${gtkCache.length} GTK berhasil dimuat dari SSOT D1.`);
    } catch (e) {
        console.error('[Duta Admin] Gagal memuat data GTK:', e);
    }
}

async function initKelasPartisipasiDropdown() {
    const filterKelasEl = document.getElementById('filter-kelas-partisipasi');
    if (!filterKelasEl) return;
    
    // Jika dropdown sudah memiliki opsi kelas selain default, lewati
    if (filterKelasEl.options.length > 1) return;

    try {
        if (studentsCache.length === 0) {
            await loadStudentsForDropdown();
        }
        
        const uniqueClasses = Array.from(new Set(studentsCache.map(s => s.class).filter(Boolean)));
        uniqueClasses.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        filterKelasEl.innerHTML = '<option value="">-- Pilih Kelas --</option>' + 
            uniqueClasses.map(c => `<option value="${c}">${c}</option>`).join('') +
            '<option value="" disabled>──────────────────</option>' +
            '<option value="X">Semua Kelas X</option>' +
            '<option value="XI">Semua Kelas XI</option>' +
            '<option value="XII">Semua Kelas XII</option>' +
            '<option value="GTK">GTK (Guru & Tenaga Kependidikan)</option>' +
            '<option value="Semua">Semua Kelas (Seluruh Sekolah)</option>';
    } catch (e) {
        console.error('[Duta Admin] Gagal inisialisasi dropdown kelas partisipasi:', e);
    }
}

async function loadPartisipasiData() {
    const tableBody = document.getElementById('partisipasi-table-body');
    const votedStatsEl = document.getElementById('stats-voted-count');
    const partialStatsEl = document.getElementById('stats-partial-count');
    const unvotedStatsEl = document.getElementById('stats-unvoted-count');
    if (!tableBody) return;

    const selectedClass = document.getElementById('filter-kelas-partisipasi')?.value || '';
    
    if (!selectedClass) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-12 text-slate-400 dark:text-slate-500 italic">
                    <div class="flex flex-col items-center justify-center gap-2">
                        <i class="fa-solid fa-filter text-2xl text-purple-500/80 mb-1 animate-pulse"></i>
                        <span class="font-extrabold text-slate-700 dark:text-slate-300 font-outfit text-xs uppercase tracking-wide">Pemfilteran Kelas</span>
                        <span class="text-[10px] text-slate-400 dark:text-slate-500 max-w-sm leading-relaxed mx-auto">
                            Silakan pilih kelas atau angkatan pada dropdown di atas untuk memuat status partisipasi siswa.
                        </span>
                    </div>
                </td>
            </tr>
        `;
        if (votedStatsEl) votedStatsEl.innerText = '-';
        if (partialStatsEl) partialStatsEl.innerText = '-';
        if (unvotedStatsEl) unvotedStatsEl.innerText = '-';
        return;
    }

    let labelLoad = `kelas ${selectedClass}`;
    if (selectedClass === 'Semua') {
        labelLoad = 'semua kelas';
    } else if (selectedClass === 'GTK') {
        labelLoad = 'GTK (Guru & Tenaga Kependidikan)';
    } else if (selectedClass === 'X' || selectedClass === 'XI' || selectedClass === 'XII') {
        labelLoad = `angkatan kelas ${selectedClass}`;
    }

    tableBody.innerHTML = `
        <tr>
            <td colspan="5" class="text-center py-12 text-slate-400 italic">
                <i class="fa-solid fa-spinner fa-spin mr-1"></i> Memuat data partisipasi ${labelLoad}...
            </td>
        </tr>
    `;

    try {
        // 1. Pastikan data siswa di dropdown/cache sudah dimuat
        if (studentsCache.length === 0) {
            await loadStudentsForDropdown();
        }

        let classStudents = [];
        let votesQuery = supabase.from('duta_suara_masuk').select('nis_pemilih, kategori');

        // 2. Tentukan data siswa dan kueri database berdasarkan filter terpilih
        if (selectedClass === 'Semua') {
            classStudents = [...studentsCache];
            const allClasses = Array.from(new Set(studentsCache.map(s => s.class).filter(Boolean)));
            votesQuery = votesQuery.in('kelas_pemilih', allClasses);
        } else if (selectedClass === 'GTK') {
            if (gtkCache.length === 0) {
                await loadGTKForDropdown();
            }
            classStudents = [...gtkCache];
            votesQuery = votesQuery.eq('role_pemilih', 'guru');
        } else if (selectedClass === 'X' || selectedClass === 'XI' || selectedClass === 'XII') {
            classStudents = studentsCache.filter(s => {
                if (!s.class) return false;
                return s.class.startsWith(selectedClass + ' ') || s.class.startsWith(selectedClass + '-') || s.class === selectedClass;
            });
            const classesInAngkatan = Array.from(new Set(classStudents.map(s => s.class).filter(Boolean)));
            votesQuery = votesQuery.in('kelas_pemilih', classesInAngkatan);
        } else {
            classStudents = studentsCache.filter(s => s.class === selectedClass);
            votesQuery = votesQuery.eq('kelas_pemilih', selectedClass);
        }

        // 3. Ambil data suara masuk dari Supabase dengan pagination (mencegah limit 1000 baris)
        let votesData = [];
        let pageFrom = 0;
        let pageHasMore = true;
        const PAGE_SIZE = 1000;

        while (pageHasMore) {
            const { data: pageData, error: pageErr } = await votesQuery.range(pageFrom, pageFrom + PAGE_SIZE - 1);
            if (pageErr) throw pageErr;
            votesData = votesData.concat(pageData || []);
            if (!pageData || pageData.length < PAGE_SIZE) {
                pageHasMore = false;
            } else {
                pageFrom += PAGE_SIZE;
            }
        }

        // 4. Kelompokkan jumlah voting per NIS pemilih
        const voteCountMap = {}; // nis -> Set of categories
        if (votesData) {
            votesData.forEach(v => {
                const nis = String(v.nis_pemilih);
                if (!voteCountMap[nis]) {
                    voteCountMap[nis] = new Set();
                }
                voteCountMap[nis].add(v.kategori);
            });
        }

        // 5. Petakan data siswa dengan status votingnya
        partisipasiData = classStudents.map(s => {
            const nisStr = String(s.nis);
            const votedSet = voteCountMap[nisStr] || new Set();
            const votedCount = votedSet.size;
            
            let status = 'Belum Memilih';
            if (votedCount === 6) {
                status = 'Lengkap';
            } else if (votedCount > 0) {
                status = 'Belum Lengkap';
            }

            return {
                nis: s.nis,
                nama: s.name,
                kelas: s.class,
                votedCount: votedCount,
                votedCategoriesList: Array.from(votedSet),
                status: status
            };
        });

        // 6. Hitung ringkasan statistik
        const lengkapCount = partisipasiData.filter(p => p.status === 'Lengkap').length;
        const sebagianCount = partisipasiData.filter(p => p.status === 'Belum Lengkap').length;
        const belumCount = partisipasiData.filter(p => p.status === 'Belum Memilih').length;

        const unitLabel = selectedClass === 'GTK' ? 'Guru/Staf' : 'Siswa';
        if (votedStatsEl) votedStatsEl.innerText = `${lengkapCount} ${unitLabel}`;
        if (partialStatsEl) partialStatsEl.innerText = `${sebagianCount} ${unitLabel}`;
        if (unvotedStatsEl) unvotedStatsEl.innerText = `${belumCount} ${unitLabel}`;

        // 7. Render tabel partisipasi
        renderPartisipasiTable();

    } catch (e) {
        console.error('[Duta Admin] Gagal memuat data partisipasi:', e);
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-12 text-red-500 font-bold">
                    Gagal memuat data: ${e.message}
                </td>
            </tr>
        `;
    }
}

async function renderPartisipasiTable() {
    const tableBody = document.getElementById('partisipasi-table-body');
    const searchVal = document.getElementById('search-partisipasi')?.value.toLowerCase().trim() || '';
    const filterVal = document.getElementById('filter-status-partisipasi')?.value || 'Semua';
    const filterKelasVal = document.getElementById('filter-kelas-partisipasi')?.value || '';

    if (!tableBody) return;

    // Jika belum ada kelas terpilih, tampilkan panduan (hemat kuota & bandwidth)
    if (!filterKelasVal) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-12 text-slate-400 dark:text-slate-500 italic">
                    <div class="flex flex-col items-center justify-center gap-2">
                        <i class="fa-solid fa-filter text-2xl text-purple-500/80 mb-1 animate-pulse"></i>
                        <span class="font-extrabold text-slate-700 dark:text-slate-300 font-outfit text-xs uppercase tracking-wide">Pemfilteran Kelas</span>
                        <span class="text-[10px] text-slate-400 dark:text-slate-500 max-w-sm leading-relaxed mx-auto">
                            Silakan pilih kelas atau angkatan pada dropdown di atas untuk memuat status partisipasi siswa.
                        </span>
                    </div>
                </td>
            </tr>
        `;
        const votedStatsEl = document.getElementById('stats-voted-count');
        const partialStatsEl = document.getElementById('stats-partial-count');
        const unvotedStatsEl = document.getElementById('stats-unvoted-count');
        if (votedStatsEl) votedStatsEl.innerText = '-';
        if (partialStatsEl) partialStatsEl.innerText = '-';
        if (unvotedStatsEl) unvotedStatsEl.innerText = '-';
        return;
    }

    // Cek apakah data saat ini di partisipasiData sudah sesuai dengan filter aktif atau perlu dimuat ulang
    let needsLoad = false;
    if (partisipasiData.length === 0) {
        needsLoad = true;
    } else {
        if (filterKelasVal === 'Semua') {
            needsLoad = partisipasiData.length < studentsCache.length;
        } else if (filterKelasVal === 'GTK') {
            if (gtkCache.length === 0) {
                await loadGTKForDropdown();
            }
            needsLoad = partisipasiData.length !== gtkCache.length || partisipasiData.some(p => p.kelas !== 'GTK');
        } else if (filterKelasVal === 'X' || filterKelasVal === 'XI' || filterKelasVal === 'XII') {
            const expectedCount = studentsCache.filter(s => {
                if (!s.class) return false;
                return s.class.startsWith(filterKelasVal + ' ') || s.class.startsWith(filterKelasVal + '-') || s.class === filterKelasVal;
            }).length;
            
            needsLoad = partisipasiData.length !== expectedCount || partisipasiData.some(p => {
                if (!p.kelas) return true;
                return !(p.kelas.startsWith(filterKelasVal + ' ') || p.kelas.startsWith(filterKelasVal + '-') || p.kelas === filterKelasVal);
            });
        } else {
            needsLoad = partisipasiData.some(p => p.kelas !== filterKelasVal);
        }
    }

    if (needsLoad) {
        await loadPartisipasiData();
        return;
    }

    // Perbarui teks header tabel secara dinamis
    const thNis = document.getElementById('partisipasi-th-nis');
    const thNama = document.getElementById('partisipasi-th-nama');
    if (thNis) thNis.innerText = filterKelasVal === 'GTK' ? 'UID' : 'NIS';
    if (thNama) thNama.innerText = filterKelasVal === 'GTK' ? 'Nama Guru/Staf' : 'Nama Siswa';

    // Filter data di client-side
    let filtered = partisipasiData;

    if (searchVal) {
        filtered = filtered.filter(p => 
            String(p.nis).includes(searchVal) ||
            p.nama.toLowerCase().includes(searchVal) ||
            (p.kelas || '').toLowerCase().includes(searchVal)
        );
    }

    if (filterVal !== 'Semua') {
        if (filterVal === 'Lengkap') {
            filtered = filtered.filter(p => p.status === 'Lengkap');
        } else if (filterVal === 'Belum Lengkap') {
            filtered = filtered.filter(p => p.status === 'Belum Lengkap');
        } else if (filterVal === 'Belum Memilih') {
            filtered = filtered.filter(p => p.status === 'Belum Memilih');
        }
    }



    if (filtered.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-8 text-slate-400 italic">
                    Tidak ada data yang cocok dengan kriteria pencarian/filter.
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = filtered.map(p => {
        let badgeHtml = '';
        if (p.status === 'Lengkap') {
            badgeHtml = `<span class="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/50 px-2.5 py-1 rounded-full font-bold text-[9px] uppercase">Lengkap (6/6)</span>`;
        } else if (p.status === 'Belum Lengkap') {
            badgeHtml = `<span class="bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/50 px-2.5 py-1 rounded-full font-bold text-[9px] uppercase">Belum Lengkap (${p.votedCount}/6)</span>`;
        } else {
            badgeHtml = `<span class="bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/50 px-2.5 py-1 rounded-full font-bold text-[9px] uppercase">Belum Memilih</span>`;
        }

        // Tampilkan kategori apa saja yang sudah dipilih (sebagai list mini badge)
        const categoriesBadgeHtml = p.votedCategoriesList.length > 0 
            ? p.votedCategoriesList.map(cat => `<span class="inline-block bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded px-1.5 py-0.5 text-[8px] font-bold mr-1 mt-1">${cat}</span>`).join('')
            : '<span class="text-slate-400 italic text-[10px]">-</span>';

        return `
            <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                <td class="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">${p.nis}</td>
                <td class="px-4 py-3 font-bold text-slate-800 dark:text-white">${p.nama}</td>
                <td class="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">${p.kelas || '-'}</td>
                <td class="px-4 py-3">${categoriesBadgeHtml}</td>
                <td class="px-4 py-3 text-right">${badgeHtml}</td>
            </tr>
        `;
    }).join('');
}

// =========================================================================
// 5. CRUD NOMINASI (Kelola Kandidat Duta)
// =========================================================================

// Mengatur urutan kategori kustom sesuai filter pada gambar:
// 1. Sehat, 2. Humanis, 3. Agamais, 4. Kreatif, 5. Trampil, 6. Inovatif
const CUSTOM_CATEGORY_ORDER = ['Sehat', 'Humanis', 'Agamais', 'Kreatif', 'Trampil', 'Inovatif'];

// Render daftar kandidat di client-side berdasarkan filter terpilih
function renderCandidates() {
    const listEl = document.getElementById('nominees-list');
    const countEl = document.getElementById('nominees-count');
    const filterEl = document.getElementById('filter-kategori-kandidat');
    if (!listEl) return;

    const filterVal = filterEl ? filterEl.value : 'Semua';

    // 1. Saring kandidat berdasarkan filter kategori
    let filteredList = [...candidatesList];
    if (filterVal !== 'Semua') {
        filteredList = filteredList.filter(c => c.kategori === filterVal);
    }

    // 2. Terapkan pengurutan kustom
    if (filterVal === 'Semua') {
        // Urutkan berdasarkan urutan kategori kustom, lalu alfabetis nama
        filteredList.sort((a, b) => {
            const indexA = CUSTOM_CATEGORY_ORDER.indexOf(a.kategori);
            const indexB = CUSTOM_CATEGORY_ORDER.indexOf(b.kategori);
            if (indexA !== indexB) {
                return indexA - indexB;
            }
            return a.nama.localeCompare(b.nama, 'id', { sensitivity: 'base' });
        });
    } else {
        // Urutkan secara alfabetis nama
        filteredList.sort((a, b) => a.nama.localeCompare(b.nama, 'id', { sensitivity: 'base' }));
    }

    // 3. Update total hitungan
    if (countEl) countEl.innerText = `${filteredList.length} Nominasi`;

    if (filteredList.length === 0) {
        listEl.innerHTML = `
            <div class="text-center py-12 text-slate-400 dark:text-slate-500 text-xs italic">
                Tidak ada nominasi terdaftar untuk kategori ini.
            </div>
        `;
        return;
    }

    // 4. Render HTML list
    listEl.innerHTML = filteredList.map((c) => {
        const photoUrl = c.foto_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&h=80';
        
        const categoryColors = {
            'Sehat': 'bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-100 dark:border-rose-900/50',
            'Humanis': 'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-100 dark:border-blue-900/50',
            'Agamais': 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/50',
            'Kreatif': 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900/50',
            'Trampil': 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 border-indigo-100 dark:border-indigo-900/50',
            'Inovatif': 'bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 border-purple-100 dark:border-purple-900/50'
        };
        const badgeClass = categoryColors[c.kategori] || 'bg-slate-50 text-slate-700';

        const kelasTag = c.kelas ? `<span class="bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/50 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider">${c.kelas}</span>` : '';
        const prestasiTag = c.prestasi ? `<span class="text-slate-400 dark:text-slate-500 text-[8px] truncate max-w-[180px]" title="${c.prestasi}"><i class="fa-solid fa-medal text-amber-400 mr-0.5"></i>${c.prestasi}</span>` : '';

        return `
            <div class="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100/70 dark:hover:bg-slate-800/70 border border-slate-100 dark:border-slate-800 rounded-2xl transition-all duration-300 group">
                <div class="flex items-center gap-3 min-w-0">
                    <img src="${photoUrl}" alt="${c.nama}" class="w-10 h-10 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0">
                    <div class="min-w-0">
                        <h4 class="font-bold text-slate-800 dark:text-white text-xs truncate leading-tight">${c.nama}</h4>
                        <div class="flex flex-wrap items-center gap-1.5 mt-1 text-[9px] font-bold">
                            <span class="px-2 py-0.5 rounded border uppercase tracking-wider ${badgeClass}">Duta ${c.kategori}</span>
                            ${kelasTag}
                            ${c.video_url ? '<span class="text-rose-500 font-extrabold flex items-center gap-0.5"><i class="fa-solid fa-circle-play"></i> Video</span>' : ''}
                        </div>
                        ${prestasiTag ? `<div class="mt-1">${prestasiTag}</div>` : ''}
                    </div>
                </div>
                <div class="flex gap-1 shrink-0 ml-2">
                    <button onclick="window.editNominee('${c.id}')" 
                        class="p-2 hover:bg-purple-100 dark:hover:bg-purple-950 rounded-lg text-purple-600 dark:text-purple-400 hover:text-purple-700 text-xs transition-colors" title="Edit Nominasi">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button onclick="window.deleteNominee('${c.id}', '${window.escapeJSString(c.nama)}')" 
                        class="p-2 hover:bg-red-100 dark:hover:bg-red-950 rounded-lg text-red-600 dark:text-red-400 hover:text-red-700 text-xs transition-colors" title="Hapus Nominasi">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Load daftar kandidat dari Supabase
async function loadCandidates() {
    try {
        const { data, error } = await supabase
            .from('duta_kandidat')
            .select('*');

        if (error) throw error;
        candidatesList = data || [];

        // Render daftar ke UI
        renderCandidates();

    } catch (e) {
        console.error('[Duta Admin] Gagal memuat nominasi:', e);
        const listEl = document.getElementById('nominees-list');
        if (listEl) listEl.innerHTML = `<div class="text-center py-12 text-red-500 text-xs font-bold">Gagal memuat: ${e.message}</div>`;
    }
}

// Buka Mode Edit Nominasi
window.editNominee = function (id) {
    const nominee = candidatesList.find(c => c.id === id);
    if (!nominee) return;

    document.getElementById('edit-id').value = nominee.id;
    document.getElementById('kandidat-nama').value = nominee.nama;
    document.getElementById('kandidat-kategori').value = nominee.kategori;
    document.getElementById('kandidat-foto').value = nominee.foto_url || '';
    document.getElementById('kandidat-video').value = nominee.video_url || '';
    document.getElementById('kandidat-kelas').value = nominee.kelas || '';
    document.getElementById('kandidat-prestasi').value = nominee.prestasi || '';
    document.getElementById('kandidat-catatan-lain').value = nominee.catatan_lain || '';

    // Ganti Title Form dan Tampilkan Batal Button
    document.getElementById('form-title').innerHTML = `<i class="fa-solid fa-user-pen text-amber-500"></i> Edit Nominasi Siswa`;
    document.getElementById('btn-submit').innerText = 'Simpan Perubahan';
    document.getElementById('btn-reset').classList.remove('hidden');
    document.getElementById('kandidat-nama').focus();
};

// Reset / Batal Edit Nominasi
window.resetNomineeForm = function () {
    document.getElementById('edit-id').value = '';
    document.getElementById('form-kandidat').reset();
    document.getElementById('form-title').innerHTML = `<i class="fa-solid fa-user-plus text-purple-600 dark:text-purple-400"></i> Tambah Nominasi Siswa`;
    document.getElementById('btn-submit').innerText = 'Simpan Nominasi';
    document.getElementById('btn-reset').classList.add('hidden');
};

// Helper: Konversi link Google Drive menjadi direct link gambar
function convertGDriveUrl(url) {
    if (!url) return '';
    let fileId = '';
    const pattern1 = /\/file\/d\/([a-zA-Z0-9_-]+)/;
    const pattern2 = /[?&]id=([a-zA-Z0-9_-]+)/;
    
    if (pattern1.test(url)) {
        fileId = url.match(pattern1)[1];
    } else if (pattern2.test(url)) {
        fileId = url.match(pattern2)[1];
    }
    
    if (fileId) {
        return `https://lh3.googleusercontent.com/d/${fileId}`;
    }
    return url;
}

// Submit Form (Tambah / Edit)
async function handleFormSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('edit-id').value;
    const nama = document.getElementById('kandidat-nama').value.trim();
    const kategori = document.getElementById('kandidat-kategori').value;
    let foto_url = document.getElementById('kandidat-foto').value.trim();
    foto_url = convertGDriveUrl(foto_url);
    const video_url = document.getElementById('kandidat-video').value.trim();
    const kelas = document.getElementById('kandidat-kelas').value.trim();
    const prestasi = document.getElementById('kandidat-prestasi').value.trim();
    const catatan_lain = document.getElementById('kandidat-catatan-lain').value.trim();

    const btnSubmit = document.getElementById('btn-submit');
    const originalText = btnSubmit.innerText;
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin mr-1"></i> Menyimpan...`;

    try {
        if (id) {
            // Jalankan UPDATE ke Supabase via Edge Function
            const res = await callSecureEdgeFunction('duta-kandidat-save', { id, nama, kategori, foto_url, video_url, kelas, prestasi, catatan_lain });
            if (res.error) throw new Error(res.error);
            showAdminToast(`Berhasil mengubah nominasi "${nama}"`, 'success');
        } else {
            // Jalankan INSERT ke Supabase via Edge Function
            const res = await callSecureEdgeFunction('duta-kandidat-save', { nama, kategori, foto_url, video_url, kelas, prestasi, catatan_lain });
            if (res.error) throw new Error(res.error);
            showAdminToast(`Berhasil menambahkan nominasi "${nama}"`, 'success');
        }

        // Reset Form & Muat Ulang Daftar Kandidat
        resetNomineeForm();
        await loadCandidates();

    } catch (err) {
        console.error('[Duta Admin] Gagal menyimpan nominasi:', err);
        showAdminToast('Error: ' + err.message, 'error');
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerText = originalText;
    }
}

// Hapus Nominasi
window.deleteNominee = async function (id, nama) {
    const modal = document.getElementById('modal-confirm-delete');
    const confirmText = document.getElementById('delete-confirm-text');
    const btnCancel = document.getElementById('btn-cancel-delete');
    const btnExecute = document.getElementById('btn-execute-delete');

    if (!modal || !confirmText || !btnCancel || !btnExecute) {
        // Fallback jika elemen modal tidak ditemukan
        const ok = typeof window.showConfirmModal === 'function'
            ? await window.showConfirmModal(`Apakah Anda yakin ingin menghapus nominasi "${nama}" secara permanen? Semua suara masuk terkait kandidat ini juga akan ikut terhapus.`, 'Hapus Nominasi', 'danger')
            : true;
        if (ok) {
            executeDeleteAction(id, nama);
        }
        return;
    }

    // Tampilkan modal & update teks konfirmasi dengan nama kandidat
    confirmText.innerHTML = `Apakah Anda yakin ingin menghapus nominasi "<b>${nama}</b>" secara permanen? Semua suara masuk terkait kandidat ini juga akan ikut terhapus.`;
    modal.classList.remove('hidden');

    // Buat kloningan tombol eksekusi untuk membersihkan event listener lama
    const newBtnExecute = btnExecute.cloneNode(true);
    btnExecute.parentNode.replaceChild(newBtnExecute, btnExecute);

    // Kloning tombol batal untuk membersihkan event listener lama
    const newBtnCancel = btnCancel.cloneNode(true);
    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);

    // Event listener Batal
    newBtnCancel.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    // Event listener Jalankan Hapus
    newBtnExecute.addEventListener('click', async () => {
        modal.classList.add('hidden');
        await executeDeleteAction(id, nama);
    });
};
async function executeDeleteAction(id, nama) {
    try {
        const res = await callSecureEdgeFunction('duta-kandidat-delete', { id });
        if (res.error) throw new Error(res.error);
        
        showAdminToast(`Berhasil menghapus nominasi "${nama}"`, 'success');
        await loadCandidates();

    } catch (err) {
        console.error('[Duta Admin] Gagal menghapus:', err);
        showAdminToast('Gagal menghapus: ' + err.message, 'error');
    }
}

// =========================================================================
// 5B. AUTHENTICATED POLLING (Auto-refresh tanpa public Realtime SELECT)
// =========================================================================

/**
 * RLS suara kini tertutup untuk koneksi anon Realtime. Polling 15 detik tetap
 * memakai query yang sama, tetapi secara otomatis melewati secure-proxy.
 */
function startRealtimeVoteSubscription() {
    if (secureVotePollingTimer) clearInterval(secureVotePollingTimer);
    secureVotePollingTimer = setInterval(async () => {
        if (document.hidden) return;
        try {
            if (activeAdminTab === 'hasil') await loadVotingResults();
            else if (activeAdminTab === 'rekap') await loadRekapData();
            else if (activeAdminTab === 'partisipasi') await renderPartisipasiTable();
        } catch (error) {
            console.warn('[Duta Admin] Polling suara gagal:', error);
        }
    }, 15000);
    console.log('[Duta Admin] Polling suara terautentikasi aktif (15 detik).');
}

// =========================================================================
// 6. DASHBOARD HASIL VOTING REAL-TIME
// =========================================================================

// Muat Hasil Perolehan Suara
async function loadVotingResults() {
    const container = document.getElementById('voting-charts-container');
    const totalEl = document.getElementById('total-votes-count');
    if (!container) return;

    container.innerHTML = `
        <div class="col-span-full text-center py-12 text-slate-400">
            <i class="fa-solid fa-spinner fa-spin mr-1 text-purple-600 dark:text-purple-400"></i> Menghitung suara masuk secara real-time...
        </div>
    `;

    try {
        const [cSnap, vSnap] = await Promise.all([
            supabase.from('duta_kandidat').select('*'),
            fetchAllRows('duta_suara_masuk')
        ]);

        if (cSnap.error) throw cSnap.error;
        if (vSnap.error) throw vSnap.error;

        const candidates = cSnap.data || [];
        const votes = vSnap.data || [];

        // ====== DIAGNOSTIC LOGGING (hapus setelah debug selesai) ======
        console.log('[DUTA DEBUG] Total baris suara dari query:', votes.length);
        const guruVotes = votes.filter(v => v.role_pemilih === 'guru');
        const siswaVotes = votes.filter(v => v.role_pemilih === 'siswa');
        const nullRoleVotes = votes.filter(v => !v.role_pemilih);
        const otherRoleVotes = votes.filter(v => v.role_pemilih && v.role_pemilih !== 'guru' && v.role_pemilih !== 'siswa');
        console.log(`[DUTA DEBUG] Breakdown role_pemilih → guru: ${guruVotes.length}, siswa: ${siswaVotes.length}, NULL/undefined: ${nullRoleVotes.length}, lainnya: ${otherRoleVotes.length}`);
        if (guruVotes.length > 0) {
            console.log('[DUTA DEBUG] Sample 3 vote guru:', guruVotes.slice(0, 3));
        }
        if (nullRoleVotes.length > 0) {
            console.log('[DUTA DEBUG] Sample 3 vote TANPA role_pemilih:', nullRoleVotes.slice(0, 3));
        }
        if (otherRoleVotes.length > 0) {
            console.log('[DUTA DEBUG] Vote dgn role_pemilih TIDAK DIKENAL:', otherRoleVotes);
        }
        // Cek apakah kolom role_pemilih ada di data
        if (votes.length > 0) {
            console.log('[DUTA DEBUG] Kolom pada baris pertama:', Object.keys(votes[0]));
            console.log('[DUTA DEBUG] Baris pertama lengkap:', votes[0]);
        }
        // ====== END DIAGNOSTIC ======

        // Update Total Suara (Pemilih Unik)
        const uniqueVoters = new Set(votes.map(v => String(v.nis_pemilih)));
        if (totalEl) totalEl.innerText = uniqueVoters.size.toLocaleString('id-ID');

        const totalSiswaEl = document.getElementById('total-votes-siswa');
        const totalGuruEl = document.getElementById('total-votes-guru');
        
        const uniqueStudents = new Set(
            votes.filter(v => v.role_pemilih !== 'guru').map(v => String(v.nis_pemilih))
        );
        const uniqueTeachers = new Set(
            votes.filter(v => v.role_pemilih === 'guru').map(v => String(v.nis_pemilih))
        );

        if (totalSiswaEl) totalSiswaEl.innerText = uniqueStudents.size.toLocaleString('id-ID');
        if (totalGuruEl) totalGuruEl.innerText = uniqueTeachers.size.toLocaleString('id-ID');

        // Petakan jumlah suara masuk berdasarkan id_kandidat dan pemilih
        const votesCountMap = {};
        votes.forEach(vote => {
            const kid = vote.id_kandidat;
            const role = vote.role_pemilih === 'guru' ? 'guru' : 'siswa';
            if (!votesCountMap[kid]) {
                votesCountMap[kid] = { total: 0, siswa: 0, guru: 0 };
            }
            votesCountMap[kid].total++;
            votesCountMap[kid][role]++;
        });

        // Render chart per kategori (6 Kategori Duta)
        let chartsHTML = '';
        categories.forEach(cat => {
            const catCandidates = candidates.filter(c => c.kategori === cat);
            
            // Hitung total suara di kategori ini
            let catTotalVotes = 0;
            let catTotalSiswa = 0;
            let catTotalGuru = 0;

            const scoredCandidates = catCandidates.map(c => {
                const info = votesCountMap[c.id] || { total: 0, siswa: 0, guru: 0 };
                catTotalVotes += info.total;
                catTotalSiswa += info.siswa;
                catTotalGuru += info.guru;
                return { 
                    ...c, 
                    votes: info.total, 
                    siswaVotes: info.siswa, 
                    guruVotes: info.guru 
                };
            });

            // Urutkan nominasi berdasarkan suara tertinggi (DESC)
            scoredCandidates.sort((a, b) => b.votes - a.votes);

            // Icon & Color kategori
            const catIcons = {
                'Sehat': 'fa-heart-pulse text-rose-600 bg-rose-50 border-rose-100 dark:bg-rose-950/20 dark:border-rose-900/50 dark:text-rose-400',
                'Humanis': 'fa-people-group text-blue-600 bg-blue-50 border-blue-100 dark:bg-blue-950/20 dark:border-blue-900/50 dark:text-blue-400',
                'Agamais': 'fa-hands-praying text-emerald-600 bg-emerald-50 border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900/50 dark:text-emerald-400',
                'Kreatif': 'fa-lightbulb text-amber-600 bg-amber-50 border-amber-100 dark:bg-amber-950/20 dark:border-amber-900/50 dark:text-amber-400',
                'Trampil': 'fa-wand-magic-sparkles text-indigo-600 bg-indigo-50 border-indigo-100 dark:bg-indigo-950/20 dark:border-indigo-900/50 dark:text-indigo-400',
                'Inovatif': 'fa-rocket text-purple-600 bg-purple-50 border-purple-100 dark:bg-purple-950/20 dark:border-purple-900/50 dark:text-purple-400'
            };
            const iconConfig = catIcons[cat] || 'fa-star text-slate-500';

            // Generate progress bar nominasi
            let candidatesProgressBarsHTML = '';
            if (scoredCandidates.length === 0) {
                candidatesProgressBarsHTML = `
                    <div class="text-center py-6 text-slate-400 text-[11px] italic">
                        Belum ada nominasi pada kategori ini
                    </div>
                `;
            } else {
                candidatesProgressBarsHTML = scoredCandidates.map((c, idx) => {
                    const percentage = catTotalVotes > 0 ? (c.votes / catTotalVotes) * 100 : 0;
                    
                    // Bar color based on position
                    const barColors = ['bg-amber-500', 'bg-slate-400', 'bg-amber-700'];
                    const barColor = barColors[idx] || 'bg-indigo-500';

                    return `
                        <div class="space-y-1">
                            <div class="flex justify-between items-center text-[11px]">
                                <span class="font-bold text-slate-700 dark:text-slate-300 truncate max-w-[180px] flex items-center gap-1.5">
                                    <span class="w-4 h-4 rounded-full text-[9px] font-black text-white ${barColor} flex items-center justify-center shrink-0">${idx + 1}</span>
                                    ${c.nama}
                                </span>
                                <span class="font-black text-slate-900 dark:text-white shrink-0">${c.votes} Suara <span class="text-slate-400 font-bold ml-0.5">(${percentage.toFixed(1)}%)</span></span>
                            </div>
                            <div class="w-full h-2.5 bg-slate-100 dark:bg-slate-900 rounded-full overflow-hidden border border-slate-200/50 dark:border-slate-700">
                                <div class="h-full rounded-full transition-all duration-1000 ${barColor}" style="width: ${percentage}%"></div>
                            </div>
                            <div class="flex justify-between items-center text-[9px] text-slate-400 dark:text-slate-500 px-1">
                                <div class="flex gap-2">
                                    <span>Siswa: <b class="text-slate-600 dark:text-slate-400">${c.siswaVotes}</b></span>
                                    <span>Guru: <b class="text-slate-600 dark:text-slate-400">${c.guruVotes}</b></span>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            chartsHTML += `
                <div class="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-sm glass-panel flex flex-col hover:border-purple-200 dark:hover:border-purple-800 transition-all duration-300">
                    <div class="flex justify-between items-center border-b dark:border-slate-700 pb-3 mb-4">
                        <div class="flex items-center gap-2.5 min-w-0">
                            <div class="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 border ${iconConfig.split(' ')[2] + ' ' + iconConfig.split(' ')[1] + ' ' + iconConfig.split(' ')[0]}">
                                <i class="fa-solid ${iconConfig.split(' ')[0]}"></i>
                            </div>
                            <h3 class="font-outfit font-extrabold text-slate-800 dark:text-white text-xs truncate">Kategori Duta ${cat}</h3>
                        </div>
                        <div class="flex flex-col items-end gap-0.5 text-right shrink-0">
                            <span class="text-[10px] bg-slate-100 dark:bg-slate-700 border dark:border-slate-600 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded font-black">${catTotalVotes} Suara</span>
                            <span class="text-[8px] text-slate-400 dark:text-slate-500 font-bold">S: ${catTotalSiswa} | G: ${catTotalGuru}</span>
                        </div>
                    </div>
                    <div class="space-y-4 flex-1 justify-center">
                        ${candidatesProgressBarsHTML}
                    </div>
                </div>
            `;
        });

        container.innerHTML = chartsHTML;

    } catch (e) {
        console.error('[Duta Admin] Gagal memuat hasil voting:', e);
        container.innerHTML = `<div class="col-span-full text-center py-12 text-red-500 text-sm font-bold">Gagal memproses hasil suara: ${e.message}</div>`;
    }
}

// =========================================================================
// 7. PANGGUNG PEMENANG TEATRIKAL TV STYLE (COUNTDOWN & CONFETTI REVEAL)
// =========================================================================

let activeRevealCategory = '';
let winnerCandidateObj = null;

// Tampilkan Kategori Panggung Penghargaan
async function loadWinnerStageConfig() {
    const container = document.getElementById('view-pemenang');
    if (!container) return;

    let gridEl = container.querySelector('.grid');
    if (!gridEl) {
        gridEl = document.createElement('div');
        gridEl.className = "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 relative z-10";
        container.appendChild(gridEl);
    }

    gridEl.innerHTML = `
        <div class="col-span-full text-center py-12 text-slate-400">
            <i class="fa-solid fa-spinner fa-spin mr-1 text-yellow-500"></i> Memuat panggung kesiswaan...
        </div>
    `;

    try {
        const [cSnap, vSnap] = await Promise.all([
            supabase.from('duta_kandidat').select('*'),
            fetchAllRows('duta_suara_masuk')
        ]);

        if (cSnap.error) throw cSnap.error;
        if (vSnap.error) throw vSnap.error;

        const candidates = cSnap.data || [];
        const votes = vSnap.data || [];

        const votesCountMap = {};
        votes.forEach(vote => {
            votesCountMap[vote.id_kandidat] = (votesCountMap[vote.id_kandidat] || 0) + 1;
        });

        let cardsHTML = '';
        categories.forEach(cat => {
            const catCandidates = candidates.filter(c => c.kategori === cat);
            
            let winner = null;
            let maxVotes = -1;
            let catTotalVotes = 0;

            catCandidates.forEach(c => {
                const count = votesCountMap[c.id] || 0;
                catTotalVotes += count;
                if (count > maxVotes) {
                    maxVotes = count;
                    winner = c;
                }
            });

            let winnerBase64 = 'null';
            if (winner) {
                winner.votes = maxVotes;
                winner.percentage = catTotalVotes > 0 ? (maxVotes / catTotalVotes) * 100 : 0;
                try {
                    winnerBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(winner))));
                } catch (e) {
                    console.error("Gagal encode data pemenang ke Base64:", e);
                }
            }

            const catColors = {
                'Sehat': 'from-rose-950/40 hover:from-rose-900/50 hover:border-rose-500/30 text-rose-400',
                'Humanis': 'from-blue-950/40 hover:from-blue-900/50 hover:border-blue-500/30 text-blue-400',
                'Agamais': 'from-emerald-950/40 hover:from-emerald-900/50 hover:border-emerald-500/30 text-emerald-400',
                'Kreatif': 'from-amber-950/40 hover:from-amber-900/50 hover:border-amber-500/30 text-amber-400',
                'Trampil': 'from-indigo-950/40 hover:from-indigo-900/50 hover:border-indigo-500/30 text-indigo-400',
                'Inovatif': 'from-purple-950/40 hover:from-purple-900/50 hover:border-purple-500/30 text-purple-400'
            };
            const cardTheme = catColors[cat] || 'from-slate-900';

            cardsHTML += `
                <div class="bg-gradient-to-br ${cardTheme} to-slate-950 border border-slate-800 rounded-3xl p-5 flex flex-col justify-between hover:scale-[1.02] active:scale-[0.99] transition-all duration-300 relative group">
                    <div>
                        <h4 class="font-black text-white text-sm font-outfit tracking-tight">Kategori Duta ${cat}</h4>
                        <p class="text-[9px] text-slate-500 uppercase tracking-widest mt-1">${catTotalVotes} Suara Masuk</p>
                    </div>

                    <button onclick="window.triggerWinnerReveal('${cat}', '${winnerBase64}')"
                        class="w-full mt-6 bg-yellow-500 hover:bg-yellow-600 text-slate-900 text-[10px] font-black py-2.5 px-4 rounded-xl shadow-lg shadow-yellow-500/10 hover:shadow-yellow-500/20 active:scale-95 transition-all text-center flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-clapperboard"></i> UMUMKAN PEMENANG
                    </button>
                </div>
            `;
        });

        gridEl.innerHTML = cardsHTML;

    } catch (e) {
        console.error('[Duta Admin] Gagal load panggung pemenang:', e);
        gridEl.innerHTML = `<div class="col-span-full text-center py-12 text-red-500 text-xs font-bold">Gagal memuat panggung pemenang: ${e.message}</div>`;
    }
}

// Trigger Reveal Screen Stage
window.triggerWinnerReveal = function (kategori, winnerBase64) {
    let winnerObj = null;
    if (winnerBase64 && winnerBase64 !== 'null') {
        try {
            winnerObj = JSON.parse(decodeURIComponent(escape(atob(winnerBase64))));
        } catch (e) {
            console.error("Gagal mendecode data pemenang dari Base64:", e);
        }
    }

    if (!winnerObj || winnerObj.votes === 0) {
        showAdminToast(`Belum ada data suara masuk pada kategori Duta ${kategori}!`, 'warning');
        return;
    }

    activeRevealCategory = kategori;
    winnerCandidateObj = winnerObj;

    const tensionScreen = document.getElementById('tension-screen');
    const winnerCard = document.getElementById('winner-reveal-card');
    const tensionCategory = document.getElementById('tension-category');
    const gridEl = document.getElementById('nominees-split-grid');

    if (tensionScreen) tensionScreen.classList.remove('hidden');
    if (winnerCard) winnerCard.classList.add('hidden', 'scale-90', 'opacity-0');
    if (tensionCategory) tensionCategory.innerText = `Duta ${kategori} 2026`;

    // Filter semua siswa yang masuk nominasi pada kategori ini
    const nominees = candidatesList.filter(c => c.kategori === kategori);
    
    if (gridEl) {
        gridEl.innerHTML = nominees.map((n, idx) => {
            const photoUrl = n.foto_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&h=300';
            
            // Stagger delay animasi masuk (fade in up) ala TV award show
            const delay = idx * 150;
            return `
                <div class="nominee-tv-card bg-slate-950/60 backdrop-blur-md border border-white/10 rounded-3xl p-4 sm:p-5 flex flex-col items-center justify-between text-center relative overflow-hidden transition-all duration-700 hover:border-yellow-500/40 hover:scale-[1.03] shadow-[0_4px_30px_rgba(0,0,0,0.5)] group opacity-0 translate-y-4"
                     style="animation: fadeInUp 0.8s ease-out forwards; animation-delay: ${delay}ms;">
                    <!-- Golden frame glow effect -->
                    <div class="absolute inset-0 bg-gradient-to-t from-yellow-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
                    
                    <!-- Photo Frame with breathing animation -->
                    <div class="relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden border border-white/10 group-hover:border-yellow-500/40 shadow-inner bg-slate-900/50 mb-3 shrink-0 transition-all duration-500">
                        <img src="${photoUrl}" alt="${n.nama}" class="w-full h-full object-cover grayscale-[25%] group-hover:grayscale-0 group-hover:scale-105 transition-all duration-500">
                        <div class="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent"></div>
                    </div>

                    <!-- Details -->
                    <div class="w-full">
                        <span class="bg-white/5 border border-white/10 text-slate-400 group-hover:text-yellow-400 group-hover:border-yellow-500/20 text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest leading-none inline-block mb-2 transition-all">
                            NOMINASI
                        </span>
                        <h4 class="font-extrabold text-white text-[11px] sm:text-xs font-outfit truncate max-w-full" title="${n.nama}">${n.nama}</h4>
                        <p class="text-[9px] font-bold text-slate-500 mt-1 uppercase tracking-wider">${n.kelas || '-'}</p>
                    </div>
                </div>
            `;
        }).join('');
    }

    const stage = document.getElementById('winner-stage');
    if (stage) stage.classList.remove('hidden');

    simulateTensionBeat();
};

window.closeWinnerStage = function () {
    const stage = document.getElementById('winner-stage');
    if (stage) stage.classList.add('hidden');
    activeRevealCategory = '';
    winnerCandidateObj = null;
    loadWinnerStageConfig();
};

let drumInterval = null;
function simulateTensionBeat() {
    const revealBtn = document.getElementById('btn-reveal-now');
    if (!revealBtn) return;

    if (drumInterval) clearInterval(drumInterval);

    let scaleUp = false;
    drumInterval = setInterval(() => {
        if (!activeRevealCategory) {
            clearInterval(drumInterval);
            return;
        }
        scaleUp = !scaleUp;
        if (scaleUp) {
            revealBtn.classList.add('scale-105');
            revealBtn.classList.remove('scale-100');
        } else {
            revealBtn.classList.remove('scale-105');
            revealBtn.classList.add('scale-100');
        }
    }, 450);
}

window.revealWinnerFinal = function () {
    if (drumInterval) clearInterval(drumInterval);

    const tensionScreen = document.getElementById('tension-screen');
    const winnerCard = document.getElementById('winner-reveal-card');
    if (!tensionScreen || !winnerCard) return;

    tensionScreen.classList.add('hidden');

    const photoUrl = winnerCandidateObj.foto_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&h=300';
    document.getElementById('winner-img').src = photoUrl;
    document.getElementById('winner-category-tag').innerText = `DUTA ${activeRevealCategory.toUpperCase()} 2026`;
    document.getElementById('winner-name').innerText = winnerCandidateObj.nama;
    document.getElementById('winner-votes').innerText = `${winnerCandidateObj.votes} Suara`;
    document.getElementById('winner-percent').innerText = `${winnerCandidateObj.percentage.toFixed(1)}%`;
    
    document.getElementById('winner-class').innerText = winnerCandidateObj.kelas ? `Kelas ${winnerCandidateObj.kelas}` : 'Kandidat Terbaik Terpilih';

    winnerCard.classList.remove('hidden');
    setTimeout(() => {
        winnerCard.classList.remove('scale-90', 'opacity-0');
        winnerCard.classList.add('scale-100', 'opacity-100');
    }, 50);

    sprayTheatricalConfetti();
};

function sprayTheatricalConfetti() {
    const end = Date.now() + (3.5 * 1000);
    const colors = ['#eab308', '#ca8a04', '#facc15', '#ffffff', '#818cf8'];

    (function frame() {
        confetti({
            particleCount: 5,
            angle: 60,
            spread: 55,
            origin: { x: 0, y: 0.8 },
            colors: colors
        });
        confetti({
            particleCount: 5,
            angle: 120,
            spread: 55,
            origin: { x: 1, y: 0.8 },
            colors: colors
        });

        if (Date.now() < end) {
            requestAnimationFrame(frame);
        }
    }());
}

window.sprayMoreConfetti = function() {
    sprayTheatricalConfetti();
};

// =========================================================================
// 7A. REKAPITULASI & PERHITUNGAN NILAI AKHIR (JUKNIS)
// =========================================================================
let rekapCandidatesList = [];
let activeRekapCategory = 'Sehat';

async function loadRekapData() {
    const tableBody = document.getElementById('rekap-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = `
        <tr>
            <td colspan="6" class="text-center py-12 text-slate-400 italic">
                <i class="fa-solid fa-spinner fa-spin mr-1 text-purple-600 dark:text-purple-400"></i> Menghitung skor rekapitulasi real-time...
            </td>
        </tr>
    `;

    try {
        const [cSnap, vSnap] = await Promise.all([
            supabase.from('duta_kandidat').select('*'),
            fetchAllRows('duta_suara_masuk')
        ]);

        if (cSnap.error) throw cSnap.error;
        if (vSnap.error) throw vSnap.error;

        const candidates = cSnap.data || [];
        const votes = vSnap.data || [];

        // Map suara per kandidat
        const votesMap = {};
        candidates.forEach(c => {
            votesMap[c.id] = { siswa: 0, guru: 0 };
        });

        // Total suara per kategori
        const totalCategoryVotes = {};
        CUSTOM_CATEGORY_ORDER.forEach(cat => {
            totalCategoryVotes[cat] = { siswa: 0, guru: 0 };
        });

        // Hitung suara
        votes.forEach(v => {
            const kid = v.id_kandidat;
            const role = v.role_pemilih === 'guru' ? 'guru' : 'siswa';
            const cat = v.kategori;

            if (votesMap[kid]) {
                votesMap[kid][role]++;
            }
            if (totalCategoryVotes[cat]) {
                totalCategoryVotes[cat][role]++;
            }
        });

        // Petakan ke rekapCandidatesList
        rekapCandidatesList = candidates.map(c => {
            const kid = c.id;
            const cat = c.kategori;
            
            const siswaVotes = votesMap[kid]?.siswa || 0;
            const guruVotes = votesMap[kid]?.guru || 0;
            
            const totalSiswaCat = totalCategoryVotes[cat]?.siswa || 0;
            const totalGuruCat = totalCategoryVotes[cat]?.guru || 0;
            
            // Perhitungan Matematis Skala 1-100 (Juknis)
            const skorSiswa = totalSiswaCat > 0 ? (siswaVotes / totalSiswaCat) * 100 : 0;
            const skorGuru = totalGuruCat > 0 ? (guruVotes / totalGuruCat) * 100 : 0;
            const rekamJejak = Math.min(100, Math.max(1, Number(c.skor_rekam_jejak || 1)));
            
            // Rumus Dinamis: Nilai Akhir berbasis persentase bobot
            const nilaiAkhir = ((dutaWeightSiswa / 100) * skorSiswa) + 
                               ((dutaWeightGuru / 100) * skorGuru) + 
                               ((dutaWeightRekamJejak / 100) * rekamJejak);

            return {
                ...c,
                siswaVotes,
                guruVotes,
                skorSiswa,
                skorGuru,
                rekamJejak,
                nilaiAkhir
            };
        });

        // Render tabs & leaderboard
        renderRekapCategoryTabs();
        renderRekapLeaderboard();

    } catch (e) {
        console.error('[Duta Rekap] Gagal load data rekap:', e);
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-red-500 font-bold">Gagal memuat rekap: ${e.message}</td></tr>`;
    }
}

function renderRekapCategoryTabs() {
    const container = document.getElementById('rekap-category-tabs');
    if (!container) return;

    container.innerHTML = CUSTOM_CATEGORY_ORDER.map(cat => {
        const isActive = cat === activeRekapCategory;
        const btnClass = isActive
            ? 'bg-purple-600 text-white shadow-md shadow-purple-500/20'
            : 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800';

        return `
            <button onclick="window.switchRekapCategory('${cat}')" 
                class="px-3.5 py-2 rounded-xl text-[10px] font-bold transition-all active:scale-95 ${btnClass}">
                Duta ${cat}
            </button>
        `;
    }).join('');
}

window.switchRekapCategory = function(cat) {
    if (activeRekapCategory === cat) return;
    activeRekapCategory = cat;
    renderRekapCategoryTabs();
    renderRekapLeaderboard();
};

function renderRekapLeaderboard() {
    const tableBody = document.getElementById('rekap-table-body');
    if (!tableBody) return;

    // Filter kandidat berdasarkan kategori aktif
    let filtered = rekapCandidatesList.filter(c => c.kategori === activeRekapCategory);

    // Urutkan berdasarkan Nilai Akhir tertinggi (DESC)
    filtered.sort((a, b) => b.nilaiAkhir - a.nilaiAkhir);

    if (filtered.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-12 text-slate-400 italic">
                    Belum ada kandidat pada kategori ini.
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = filtered.map((c, idx) => {
        const photoUrl = c.foto_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&h=80';
        
        // Peringkat visual styling
        let rankBadge = '';
        if (idx === 0) rankBadge = '<span class="w-6 h-6 bg-yellow-500 text-slate-950 rounded-full flex items-center justify-center font-black shadow shadow-yellow-500/20 text-[10px]">1</span>';
        else if (idx === 1) rankBadge = '<span class="w-6 h-6 bg-slate-300 text-slate-800 rounded-full flex items-center justify-center font-black shadow shadow-slate-300/20 text-[10px]">2</span>';
        else if (idx === 2) rankBadge = '<span class="w-6 h-6 bg-amber-700 text-amber-100 rounded-full flex items-center justify-center font-black shadow shadow-amber-700/20 text-[10px]">3</span>';
        else rankBadge = `<span class="font-bold text-slate-400">${idx + 1}</span>`;

        return `
            <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition duration-200">
                <td class="px-4 py-3 text-center flex items-center justify-center h-16">${rankBadge}</td>
                <td class="px-4 py-3">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <img src="${photoUrl}" alt="${c.nama}" class="w-8 h-8 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0">
                        <span class="font-bold text-slate-800 dark:text-white truncate">${c.nama}</span>
                    </div>
                </td>
                <td class="px-4 py-3 text-center">
                    <div class="font-bold text-slate-800 dark:text-white">${c.siswaVotes} Suara</div>
                    <div class="text-[10px] text-slate-400 mt-0.5">${c.skorSiswa.toFixed(1)} Pts</div>
                </td>
                <td class="px-4 py-3 text-center">
                    <div class="font-bold text-slate-800 dark:text-white">${c.guruVotes} Suara</div>
                    <div class="text-[10px] text-slate-400 mt-0.5">${c.skorGuru.toFixed(1)} Pts</div>
                </td>
                <td class="px-4 py-3 text-center">
                    <div class="flex items-center justify-center">
                        <input type="number" inputmode="numeric" min="1" max="100" value="${c.rekamJejak}" 
                            oninput="window.updateLocalRekamJejak('${c.id}', this.value, this)"
                            onblur="if(this.value==='') { this.value=1; window.updateLocalRekamJejak('${c.id}', 1, this); }"
                            class="w-20 text-center font-bold bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 focus:ring-1 focus:ring-purple-500 rounded-xl px-2 py-1.5 outline-none text-slate-800 dark:text-white transition-all text-xs">
                    </div>
                </td>
                <td class="px-4 py-3 text-right">
                    <span id="final-score-${c.id}" class="text-xs font-black text-purple-600 dark:text-purple-400">${c.nilaiAkhir.toFixed(2)}</span>
                </td>
            </tr>
        `;
    }).join('');
}

window.updateLocalRekamJejak = function(id, val, inputEl) {
    if (val === '') {
        const cand = rekapCandidatesList.find(c => c.id === id);
        if (cand) {
            cand.rekamJejak = 0;
            cand.nilaiAkhir = ((dutaWeightSiswa / 100) * cand.skorSiswa) + ((dutaWeightGuru / 100) * cand.skorGuru);
            const el = document.getElementById(`final-score-${id}`);
            if (el) el.innerText = cand.nilaiAkhir.toFixed(2);
        }
        return;
    }

    let numVal = parseInt(val, 10);
    if (isNaN(numVal)) numVal = 1;
    
    // Batasi minimal 1 dan maksimal 100
    const score = Math.min(100, Math.max(1, numVal));
    
    // Hilangkan leading zero pada input field jika nilai berbeda
    if (inputEl) {
        inputEl.value = score;
    }
    
    // Cari kandidat di list lokal
    const cand = rekapCandidatesList.find(c => c.id === id);
    if (!cand) return;

    // Update rekamJejak
    cand.rekamJejak = score;
    
    // Hitung ulang Nilai Akhir secara real-time di frontend
    cand.nilaiAkhir = ((dutaWeightSiswa / 100) * cand.skorSiswa) + 
                      ((dutaWeightGuru / 100) * cand.skorGuru) + 
                      ((dutaWeightRekamJejak / 100) * score);

    // Update elemen score di tabel
    const el = document.getElementById(`final-score-${id}`);
    if (el) {
        el.innerText = cand.nilaiAkhir.toFixed(2);
    }
};

window.saveAllRekamJejak = async function() {
    const btn = document.getElementById('btn-save-rekap');
    if (!btn) return;
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...`;

    try {
        const payload = rekapCandidatesList.map(cand => ({
            id: cand.id,
            rekamJejak: cand.rekamJejak
        }));

        await callSecureEdgeFunction('duta-rekam-jejak-save', payload);

        showAdminToast('Berhasil menyimpan seluruh nilai rekam jejak!', 'success');
        
        // Reload rekap data untuk menyegarkan dari server
        await loadRekapData();

    } catch (e) {
        console.error('[Duta Rekap] Gagal menyimpan:', e);
        showAdminToast('Gagal menyimpan nilai: ' + (e.message || e), 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
};

async function loadDutaWeights() {
    try {
        const data = await window.getSystemConfig();
        if (data) {
            dutaWeightSiswa = typeof data.dutaWeightSiswa === 'number' ? data.dutaWeightSiswa : 40;
            dutaWeightGuru = typeof data.dutaWeightGuru === 'number' ? data.dutaWeightGuru : 40;
            dutaWeightRekamJejak = typeof data.dutaWeightRekamJejak === 'number' ? data.dutaWeightRekamJejak : 20;
        }
        
        // Update input fields on UI if they exist
        const inSiswa = document.getElementById('weight-siswa');
        const inGuru = document.getElementById('weight-guru');
        const inRekam = document.getElementById('weight-rekam-jejak');
        if (inSiswa) inSiswa.value = dutaWeightSiswa;
        if (inGuru) inGuru.value = dutaWeightGuru;
        if (inRekam) inRekam.value = dutaWeightRekamJejak;
        
        // Update labels on UI
        updateWeightUILabels();
    } catch (e) {
        console.error('[Duta Admin] Gagal memuat bobot duta:', e);
    }
}

function updateWeightUILabels() {
    const descLabel = document.getElementById('weight-description-label');
    if (descLabel) {
        descLabel.innerText = `${dutaWeightSiswa}% Polling Siswa + ${dutaWeightGuru}% Polling Guru + ${dutaWeightRekamJejak}% Rekam Jejak`;
    }
    
    const thSiswa = document.getElementById('th-weight-siswa');
    const thGuru = document.getElementById('th-weight-guru');
    const thRekam = document.getElementById('th-weight-rekam-jejak');
    if (thSiswa) thSiswa.innerText = `Polling Siswa (${dutaWeightSiswa}%)`;
    if (thGuru) thGuru.innerText = `Polling Guru (${dutaWeightGuru}%)`;
    if (thRekam) thRekam.innerText = `Rekam Jejak (${dutaWeightRekamJejak}%)`;
}

window.saveDutaWeights = async function(e) {
    e.preventDefault();
    const inSiswa = document.getElementById('weight-siswa');
    const inGuru = document.getElementById('weight-guru');
    const inRekam = document.getElementById('weight-rekam-jejak');
    if (!inSiswa || !inGuru || !inRekam) return;

    const wSiswa = parseInt(inSiswa.value, 10) || 0;
    const wGuru = parseInt(inGuru.value, 10) || 0;
    const wRekam = parseInt(inRekam.value, 10) || 0;

    if (wSiswa + wGuru + wRekam !== 100) {
        showAdminToast('Total penjumlahan bobot harus sama dengan 100%!', 'error');
        return;
    }

    const btn = document.getElementById('btn-save-weights');
    if (!btn) return;
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...`;

    try {
        await setDoc(doc(db, PATHS.settings, 'system_config'), {
            dutaWeightSiswa: wSiswa,
            dutaWeightGuru: wGuru,
            dutaWeightRekamJejak: wRekam
        }, { merge: true });

        // Invalidasi cache system config
        if (typeof window.invalidateSystemConfig === 'function') window.invalidateSystemConfig();

        dutaWeightSiswa = wSiswa;
        dutaWeightGuru = wGuru;
        dutaWeightRekamJejak = wRekam;

        updateWeightUILabels();
        showAdminToast('Berhasil menyimpan konfigurasi bobot penilaian!', 'success');
        
        // Recalculate and reload rekap data
        await loadRekapData();
    } catch (err) {
        console.error('[Duta Admin] Gagal menyimpan bobot:', err);
        showAdminToast('Gagal menyimpan bobot: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
};

// =========================================================================
// 8. HELPERS & ALERTS
// =========================================================================
window.escapeJSString = function(str) {
    if (!str) return '';
    return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
};

function showAdminToast(msg, type = 'info') {
    const toast = document.createElement('div');
    
    const colors = {
        'success': 'bg-emerald-950/90 text-emerald-200 border-emerald-500/20',
        'error': 'bg-rose-950/90 text-rose-200 border-rose-500/20',
        'warning': 'bg-amber-950/90 text-amber-200 border-amber-500/20',
        'info': 'bg-slate-900/90 text-slate-200 border-slate-700'
    };
    const colorClass = colors[type] || colors.info;

    toast.className = `fixed bottom-5 right-5 z-[200] px-4 py-3 rounded-2xl shadow-2xl border text-xs font-bold font-outfit flex items-center gap-2 animate-fade-in ${colorClass}`;
    
    const icons = {
        'success': '<i class="fa-solid fa-circle-check text-emerald-400"></i>',
        'error': '<i class="fa-solid fa-circle-xmark text-rose-400"></i>',
        'warning': '<i class="fa-solid fa-triangle-exclamation text-amber-400"></i>',
        'info': '<i class="fa-solid fa-circle-info text-blue-400"></i>'
    };
    const icon = icons[type] || icons.info;

    toast.innerHTML = `${icon} <span>${msg}</span>`;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 4000);
}

// =========================================================================
// 9. PAGE ON-LOAD BINDING
// =========================================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.replace('index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash));
        return;
    }

    // 1. Proteksi Akses Admin SIMAS
    if (!checkAdminSession()) return;

    // 2. Inisialisasi Layout Utama SIMAS (Sidebar Terpadu)
    const effectiveRole = window.getEffectiveRoleForPage('duta-admin.html');
    await initLayout(effectiveRole);

    // 3. Tampilkan nama profil di sidebar dengan segera dari data auth / cache
    const cachedName = localStorage.getItem(`cached_user_name_${user.uid}`);
    if (cachedName) {
        document.querySelectorAll('.user-name-el').forEach(el => el.innerText = cachedName);
    } else if (user.displayName) {
        document.querySelectorAll('.user-name-el').forEach(el => el.innerText = user.displayName);
    }

    // Update dari Firestore secara background (hemat kuota)
    if (typeof window.updateSidebarProfileFromDB === 'function') {
        window.updateSidebarProfileFromDB(user.uid);
    }

    // Tampilkan Konten Utama (Hapus class hidden)
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.classList.remove('hidden');

    // 4. Inisialisasi Supabase
    if (!initSupabase()) {
        showAdminToast('Supabase gagal terhubung!', 'error');
        return;
    }

    // 4A. Aktifkan Realtime Subscription untuk auto-refresh hasil voting
    startRealtimeVoteSubscription();

    // 5. Load Status Voting Duta
    await loadVotingStatus();

    // 5A. Load Konfigurasi Bobot Penilaian
    await loadDutaWeights();

    // 6. Bind Toggle Event Listener
    const toggleEl = document.getElementById('toggle-duta-voting');
    if (toggleEl) {
        // Hapus listener ganda jika ada dengan cloning
        const newToggle = toggleEl.cloneNode(true);
        toggleEl.parentNode.replaceChild(newToggle, toggleEl);
        newToggle.addEventListener('change', async (e) => {
            const isActive = e.target.checked;
            await saveVotingStatus(isActive);
        });
    }

    // 6A. Load data siswa untuk dropdown
    await loadStudentsForDropdown();

    // 7. Load Nominasi Awal
    await loadCandidates();

    // 8. Form Submit handler
    const form = document.getElementById('form-kandidat');
    if (form) {
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);
        newForm.addEventListener('submit', handleFormSubmit);
    }

    // Pasang event listener setelah form selesai dikloning & diganti di DOM
    initStudentDropdownListeners();

    // 9. Bind Filter Event Listener (Saring & urutkan nominasi secara reaktif di client-side)
    const filterEl = document.getElementById('filter-kategori-kandidat');
    if (filterEl) {
        filterEl.addEventListener('change', () => {
            renderCandidates();
        });
    }

    // 9B. Bind Partisipasi Search & Filter Event Listener
    const searchPartisipasiEl = document.getElementById('search-partisipasi');
    if (searchPartisipasiEl) {
        searchPartisipasiEl.addEventListener('input', () => {
            renderPartisipasiTable();
        });
    }

    const filterPartisipasiEl = document.getElementById('filter-status-partisipasi');
    if (filterPartisipasiEl) {
        filterPartisipasiEl.addEventListener('change', () => {
            renderPartisipasiTable();
        });
    }

    const filterKelasPartisipasiEl = document.getElementById('filter-kelas-partisipasi');
    if (filterKelasPartisipasiEl) {
        filterKelasPartisipasiEl.addEventListener('change', () => {
            renderPartisipasiTable();
        });
    }
});
