/* sukaduka/suka-duka.js - Logika Pengelolaan Iuran & Kas Suka-Duka */
import { auth, db, PATHS, supabase, SCHOOL_CONFIG, resolvePhotoUrl } from '../js/config.js';
import { cfClient } from '../js/cloudflare-client.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, getDocs, query, orderBy, doc, getDoc, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { initLayout, callSecureEdgeFunction } from '../js/global.js';

/**
 * Helper menghasilkan elemen HTML avatar / foto profil resmi GTK (SSOT Cloudflare D1 / R2)
 * Dilengkapi graceful fallback monogram inisial nama, sanitasi anti-XSS, dan perlindungan URL.
 * @param {Object} teacher - Objek master guru GTK
 * @param {string} sizeClass - Ukuran Tailwind misal 'w-8 h-8'
 * @param {string} shapeClass - Bentuk sudut Tailwind misal 'rounded-full' atau 'rounded-2xl'
 * @returns {string} Markup HTML avatar aman
 */
export function renderTeacherAvatarHTML(teacher, sizeClass = 'w-8 h-8', shapeClass = 'rounded-full') {
    const name = (teacher && (teacher.name || teacher.nama)) ? String(teacher.name || teacher.nama) : 'Guru';
    const rawPhoto = teacher ? (teacher.foto || teacher.photo_url || '') : '';
    const resolvedUrl = (typeof resolvePhotoUrl === 'function') 
        ? resolvePhotoUrl(rawPhoto) 
        : ((typeof window !== 'undefined' && typeof window.resolvePhotoUrl === 'function') ? window.resolvePhotoUrl(rawPhoto) : rawPhoto);

    const safeName = (typeof escapeHTML === 'function') ? escapeHTML(name) : (window.escapeHTML ? window.escapeHTML(name) : name.replace(/[&<>"']/g, ''));
    const firstChar = (safeName.trim().charAt(0) || 'G').toUpperCase();

    const borderClass = sizeClass.includes('w-full') ? '' : 'border border-slate-200/80 dark:border-slate-700 shadow-2xs';

    if (resolvedUrl && typeof resolvedUrl === 'string' && !resolvedUrl.trim().toLowerCase().startsWith('javascript:')) {
        const safeUrl = (typeof escapeHTML === 'function') ? escapeHTML(resolvedUrl) : resolvedUrl;
        return `<div class="${sizeClass} ${shapeClass} overflow-hidden flex-shrink-0 bg-slate-100 dark:bg-slate-700 relative ${borderClass} aspect-square max-w-full max-h-full">
            <img src="${safeUrl}" alt="${safeName}" class="w-full h-full object-cover object-center ${shapeClass}" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy" 
                 onerror="this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.style.display='flex';">
            <div class="w-full h-full ${shapeClass} bg-gradient-to-tr from-indigo-600 to-violet-500 text-white font-bold text-xs flex items-center justify-center select-none aspect-square" style="display:none; width: 100%; height: 100%;">${firstChar}</div>
        </div>`;
    }

    return `<div class="${sizeClass} ${shapeClass} bg-gradient-to-tr from-indigo-600 to-violet-500 text-white font-bold text-xs flex items-center justify-center flex-shrink-0 select-none ${sizeClass.includes('w-full') ? '' : 'border border-indigo-400/30 shadow-2xs'} aspect-square max-w-full max-h-full">
        ${firstChar}
    </div>`;
}

// Bind ke window untuk akses global/testing bila dibutuhkan
if (typeof window !== 'undefined') {
    window.renderTeacherAvatarHTML = renderTeacherAvatarHTML;
}

// =========================================================================
// 1. SUPABASE CONFIGURATION (SSOT INSTANCE)
// =========================================================================
let allTeachers = []; // Cache master guru/pegawai dari Firestore
let nominalIuranDefault = 50000; // Fallback default
let dendaAktifDefault = true;
let dendaKelipatanBulanDefault = 3;
let dendaNominalDefault = 50000;
let currentLoggedGuru = null; // Menyimpan data profil guru yang sedang login
let pendingDeleteId = null; // Menyimpan ID transaksi yang akan dihapus
let pendingDeleteType = ''; // 'iuran' atau 'kas'
let pendingDeleteYear = null; // Menyimpan Tahun iuran yang akan dihapus
let pendingDeleteMonth = null; // Menyimpan Bulan iuran yang akan dihapus

// State baru untuk modul kasir iuran mirip SPP
let currentSelectedGuru = null; // Guru yang sedang dipilih di Kasir
let selectedMonths = []; // Bulan iuran yang dipilih untuk dibayar [{ year, month }]
let paymentHistory = {}; // Riwayat pembayaran guru terpilih { 'YYYY-MM': data_iuran }
let displayYear = new Date().getFullYear(); // Tahun kalender aktif di Kartu Iuran
let currentSubLaporanTab = 'pembayaran'; // Sub-tab laporan aktif ('pembayaran' atau 'tunggakan')
let closedYearsList = []; // Daftar tahun yang sudah ditutup bukunya
let closingDataMap = {}; // Map data closing per tahun { year: { saldo_akhir, ... } }


// Inisialisasi Supabase Client (SSOT)
function initSupabase() {
    return !!supabase;
}

// =========================================================================
// 2. AUTH & ROLE CHECK (Dinamic UI Mode)
// =========================================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '../index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
        return;
    }

    const primaryRole = localStorage.getItem('user_role') || 'guru_mapel';
    
    // Cek role tambahan untuk otorisasi admin_sukaduka
    let additionalRoles = [];
    try {
        additionalRoles = JSON.parse(localStorage.getItem('user_additional_roles') || '[]');
    } catch (e) {
        additionalRoles = [];
    }

    const isAdmin = primaryRole === 'super_admin' || primaryRole === 'admin_sukaduka' || additionalRoles.includes('admin_sukaduka');
    
    // Inisialisasi layout global SIMAS
    const effectiveRole = window.getEffectiveRoleForPage ? window.getEffectiveRoleForPage('suka-duka.html') : primaryRole;
    await initLayout(effectiveRole);
    document.querySelector('main').classList.remove('hidden');

    if (initSupabase()) {
        await loadConfig();
        await loadTeachersMaster();
        await loadClosingsData();
        await refreshDashboardStats();
        
        if (isAdmin) {
            // Tampilkan tombol navigasi tab admin
            document.getElementById('admin-tab-nav').classList.remove('hidden');
            
            // Pengaturan denda hanya tampil untuk super_admin
            const isSuperAdmin = primaryRole === 'super_admin';
            const wrapperSettingDenda = document.getElementById('wrapper-setting-denda');
            if (wrapperSettingDenda) {
                if (isSuperAdmin) {
                    wrapperSettingDenda.classList.remove('hidden');
                } else {
                    wrapperSettingDenda.classList.add('hidden');
                }
            }
            
            setupAdminListeners();
            setupYearOptions();
            await refreshRecentPayments();
            window.switchSukaDukaTab('kasir'); // Admin secara default membuka tab kasir
            setTimeout(() => {
                const searchEl = document.getElementById('teacher-search');
                if (searchEl) searchEl.focus();
            }, 300);
            setTimeout(() => {
                const searchEl = document.getElementById('teacher-search');
                if (searchEl) searchEl.focus();
            }, 600);
        } else {
            // Sembunyikan navigasi tab admin & paksa ke tab personal guru
            document.getElementById('admin-tab-nav').classList.add('hidden');
            window.switchSukaDukaTab('guru-view');
        }

        // Jalankan pencarian profil guru berdasarkan email login saat ini
        await identifyCurrentGuru(user.email);
    }
});

// Mengidentifikasi dokumen guru dari email login Firebase Auth
async function identifyCurrentGuru(email) {
    if (!email) return;
    
    // Cari guru yang email-nya cocok di data master guru cache
    currentLoggedGuru = allTeachers.find(t => t.email && t.email.toLowerCase().trim() === email.toLowerCase().trim());
    
    if (currentLoggedGuru) {
        document.getElementById('guru-profile-name').innerText = currentLoggedGuru.name;
        document.getElementById('guru-profile-nip').innerText = 'NIP: ' + (currentLoggedGuru.nip || '-');
        
        // Render Foto Profil Resmi Guru pada Card Profil Saya
        const profileAvatarEl = document.getElementById('guru-profile-avatar-container');
        if (profileAvatarEl) {
            profileAvatarEl.innerHTML = renderTeacherAvatarHTML(currentLoggedGuru, 'w-full h-full', 'rounded-2xl');
        }
        
        await loadGuruPersonalData();
    } else {
        document.getElementById('guru-profile-name').innerText = auth.currentUser.displayName || 'Staff SIMAS';
        document.getElementById('guru-profile-nip').innerText = 'Data profil guru tidak terhubung di server';
        
        const profileAvatarEl = document.getElementById('guru-profile-avatar-container');
        if (profileAvatarEl) {
            profileAvatarEl.innerHTML = `<div class="w-full h-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center font-black text-lg"><i class="fa-solid fa-user-check"></i></div>`;
        }
        document.getElementById('guru-iuran-tbody').innerHTML = `
            <tr>
                <td colspan="5" class="px-4 py-8 text-center text-slate-400 italic">
                    <i class="fa-solid fa-link-slash text-xl mb-2 block"></i>
                    Email login Anda tidak terhubung dengan data Guru/Pegawai di SIMAS.<br>
                    Silakan hubungi admin untuk menghubungkan akun Anda di Menu Manajemen User.
                </td>
            </tr>
        `;
        const statTunggakanEl = document.getElementById('stat-total-tunggakan');
        if (statTunggakanEl) {
            statTunggakanEl.innerText = 'Rp 0';
            statTunggakanEl.className = "text-2xl font-black text-green-600 dark:text-green-455 mt-1";
        }
    }
}

// =========================================================================
// 3. CACHING MASTER DATA GURU (HEMAT READ FIRESTORE)
// =========================================================================
async function loadTeachersMaster() {
    // Coba ambil dari sessionStorage terlebih dahulu
    const CACHE_KEY = 'session_teachers_data';
    const cached = sessionStorage.getItem(CACHE_KEY);
    
    if (cached) {
        try {
            allTeachers = JSON.parse(cached);
            console.log('[Suka-Duka] Master data guru dimuat dari session cache');
            return;
        } catch (e) {
            allTeachers = [];
        }
    }

    // Jika tidak ada cache, ambil dari Cloudflare D1 SSOT (0 Firestore Read)
    try {
        if (cfClient && cfClient.getGtk) {
            const dataGtk = await cfClient.getGtk({ status: 'all' });
            allTeachers = (dataGtk || []).map(t => ({
                id: t.id || t.nip || t.nik,
                name: t.name || t.nama || '',
                nip: t.nip || '',
                nik: t.nik || '',
                status: t.status || 'aktif',
                ...t
            }));
        } else {
            allTeachers = [];
        }
        
        // Simpan ke cache
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(allTeachers));
        console.log('[Suka-Duka] Master data guru dimuat dari Cloudflare D1 & di-cache');
    } catch (e) {
        console.error('[Suka-Duka] Gagal memuat master guru dari Cloudflare D1:', e);
    }
}

// =========================================================================
// 4. LOAD CONFIG & STATS FROM SUPABASE
// =========================================================================
async function loadConfig() {
    try {
        const { data, error } = await supabase
            .from('sukaduka_config')
            .select('*');
            
        if (error) throw error;
        
        if (data) {
            const iuranConfig = data.find(c => c.key === 'nominal_iuran');
            if (iuranConfig) {
                nominalIuranDefault = parseFloat(iuranConfig.value);
            }
            
            const dendaAktifConfig = data.find(c => c.key === 'denda_aktif');
            if (dendaAktifConfig) {
                dendaAktifDefault = dendaAktifConfig.value === 'true';
            }
            
            const dendaKelipatanConfig = data.find(c => c.key === 'denda_kelipatan_bulan');
            if (dendaKelipatanConfig) {
                dendaKelipatanBulanDefault = parseInt(dendaKelipatanConfig.value) || 3;
            }
            
            const dendaNominalConfig = data.find(c => c.key === 'denda_nominal');
            if (dendaNominalConfig) {
                dendaNominalDefault = parseFloat(dendaNominalConfig.value) || 50000;
            }
        }
        
        // Update UI untuk iuran
        document.getElementById('stat-nominal-iuran').innerText = 'Rp ' + nominalIuranDefault.toLocaleString('id-ID');
        const inputAmount = document.getElementById('iuran-amount');
        if (inputAmount) inputAmount.value = nominalIuranDefault.toLocaleString('id-ID');
        const settingNominal = document.getElementById('setting-nominal-iuran');
        if (settingNominal) settingNominal.value = nominalIuranDefault.toLocaleString('id-ID');
        
        // Update UI untuk pengaturan denda
        const settingDendaAktif = document.getElementById('setting-denda-aktif');
        if (settingDendaAktif) settingDendaAktif.value = dendaAktifDefault ? 'true' : 'false';
        
        const settingDendaKelipatan = document.getElementById('setting-denda-kelipatan');
        if (settingDendaKelipatan) settingDendaKelipatan.value = dendaKelipatanBulanDefault;
        
        const settingDendaNominal = document.getElementById('setting-denda-nominal');
        if (settingDendaNominal) settingDendaNominal.value = dendaNominalDefault.toLocaleString('id-ID');
        
        // Memuat setting Kas Awal Migrasi
        await loadKasAwalSetting();
        
    } catch (e) {
        console.error('[Suka-Duka] Gagal memuat konfigurasi:', e);
    }
}

let currentStatFilter = 'tahun_ini'; // Default filter waktu aktif

window.setStatFilter = async function(filterName) {
    currentStatFilter = filterName;
    
    // Perbarui visual status tombol filter aktif
    const filters = ['bulan_ini', 'bulan_lalu', 'tahun_ini'];
    filters.forEach(f => {
        const btn = document.getElementById(`btn-stat-${f}`);
        if (btn) {
            if (f === filterName) {
                btn.className = "px-3 py-1 rounded-md bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm transition-all";
            } else {
                btn.className = "px-3 py-1 rounded-md transition-all text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white";
            }
        }
    });
    
    await refreshDashboardStats();
};

// =========================================================================
// 4a. LOAD CLOSINGS DATA (CACHE DATA TUTUP BUKU)
// =========================================================================
async function loadClosingsData() {
    try {
        const { data, error } = await supabase
            .from('sukaduka_closings')
            .select('id, year, saldo_akhir, total_income, total_expense, closed_at, closed_by')
            .order('year', { ascending: true });

        if (error) throw error;

        closedYearsList = (data || []).map(c => c.year);
        closingDataMap = {};
        (data || []).forEach(c => {
            closingDataMap[c.year] = c;
        });

        console.log('[Suka-Duka] Data closing dimuat:', closedYearsList);

        // Update UI status closing di Pengaturan
        updateClosingStatusUI();
        // Populate filter tahun dan bulan di Arus Kas
        initKasFilters();
    } catch (e) {
        console.error('[Suka-Duka] Gagal memuat data closings:', e);
        closedYearsList = [];
        closingDataMap = {};
    }
}

function updateClosingStatusUI() {
    const statusText = document.getElementById('closing-status-text');
    const historyList = document.getElementById('closing-history-list');
    if (!statusText) return;

    if (closedYearsList.length === 0) {
        statusText.innerHTML = 'Belum ada tahun buku yang ditutup. Tutup buku tahun berjalan dapat dilakukan mulai 1 Desember.';
        if (historyList) historyList.classList.add('hidden');
    } else {
        statusText.innerHTML = `<strong>${closedYearsList.length}</strong> tahun buku sudah ditutup.`;
        if (historyList) {
            historyList.classList.remove('hidden');
            historyList.innerHTML = closedYearsList.map(y => {
                const c = closingDataMap[y];
                const dateStr = c && c.closed_at ? new Date(c.closed_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
                return `<div class="flex justify-between items-center text-[11px] py-1 border-t dark:border-slate-700/50">
                    <span class="font-bold text-slate-600 dark:text-slate-350"><i class="fa-solid fa-lock text-amber-500 mr-1"></i> Tahun ${y}</span>
                    <span class="text-slate-400">Ditutup ${dateStr}</span>
                </div>`;
            }).join('');
        }
    }
}

function populateKasYearFilter() {
    const yearSelect = document.getElementById('filter-kas-year');
    if (!yearSelect) return;

    const currentYear = new Date().getFullYear();
    const minYear = 2024;
    const maxYear = currentYear + 1;

    yearSelect.innerHTML = '';
    for (let y = maxYear; y >= minYear; y--) {
        const opt = document.createElement('option');
        opt.value = String(y);
        const isClosed = closedYearsList.includes(y);
        opt.textContent = isClosed ? `${y} 🔒` : String(y);
        if (y === currentYear) opt.selected = true;
        yearSelect.appendChild(opt);
    }
}

function initKasFilters(force = false) {
    populateKasYearFilter();
    const monthSelect = document.getElementById('filter-kas-month');
    if (monthSelect && (force || !monthSelect.dataset.userChanged)) {
        const currentMonthStr = String(new Date().getMonth() + 1).padStart(2, '0');
        monthSelect.value = currentMonthStr;
    }
}
window.initKasFilters = initKasFilters;

async function refreshDashboardStats() {
    try {
        // Optimasi: jika ada closing, gunakan saldo closing terakhir + hanya query data setelahnya
        const latestClosedYear = closedYearsList.length > 0 ? Math.max(...closedYearsList) : null;
        let baseSaldo = 0;
        let queryStartDate = null;

        if (latestClosedYear && closingDataMap[latestClosedYear]) {
            baseSaldo = parseFloat(closingDataMap[latestClosedYear].saldo_akhir) || 0;
            queryStartDate = `${latestClosedYear + 1}-01-01`;
        }

        // Ambil data buku kas (hanya data setelah closing terakhir jika ada), paginasi agar tidak terpotong 1000 baris
        const { data, error } = await fetchSukaDukaKasRows(
            q => (queryStartDate ? q.gte('tanggal', queryStartDate) : q),
            'id, tipe, jumlah, kategori, tanggal'
        );
        if (error) throw error;
        
        let totalSaldo = baseSaldo; // Saldo dimulai dari closing terakhir
        let totalPencairan = 0;
        let kuantitasSantunan = 0;
        
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        
        let filterStartDate = null;
        let filterEndDate = null;
        
        if (currentStatFilter === 'bulan_ini') {
            filterStartDate = new Date(currentYear, currentMonth - 1, 1);
            filterEndDate = new Date(currentYear, currentMonth, 0, 23, 59, 59);
        } else if (currentStatFilter === 'bulan_lalu') {
            let prevYear = currentYear;
            let prevMonth = currentMonth - 1;
            if (prevMonth === 0) {
                prevMonth = 12;
                prevYear -= 1;
            }
            filterStartDate = new Date(prevYear, prevMonth - 1, 1);
            filterEndDate = new Date(prevYear, prevMonth, 0, 23, 59, 59);
        } else if (currentStatFilter === 'tahun_ini') {
            filterStartDate = new Date(currentYear, 0, 1);
            filterEndDate = new Date(currentYear, 12, 0, 23, 59, 59);
        }
        
        (data || []).forEach(kas => {
            const nominal = parseFloat(kas.jumlah);
            
            if (kas.tipe === 'masuk') {
                totalSaldo += nominal;
            } else if (kas.tipe === 'keluar') {
                totalSaldo -= nominal;
            }
            
            const kasDate = new Date(kas.tanggal);
            const isWithinFilterRange = (!filterStartDate || kasDate >= filterStartDate) && (!filterEndDate || kasDate <= filterEndDate);
            
            if (isWithinFilterRange) {
                if (kas.tipe === 'keluar') {
                    totalPencairan += nominal;
                    if (kas.kategori.startsWith('santunan_') || kas.kategori === 'lain_lain') {
                        kuantitasSantunan += 1;
                    }
                }
            }
        });
        
        document.getElementById('stat-total-saldo').innerText = 'Rp ' + totalSaldo.toLocaleString('id-ID');
        document.getElementById('stat-total-pencairan').innerText = 'Rp ' + totalPencairan.toLocaleString('id-ID');
        document.getElementById('stat-kuantitas-santunan').innerText = kuantitasSantunan;
        
    } catch (e) {
        console.error('[Suka-Duka] Gagal menghitung stats dashboard:', e);
    }
}

// =========================================================================
// 5. VIEW GURU: PERSONAL DATA HISTORY
// =========================================================================
window.loadGuruPersonalData = async function() {
    if (!currentLoggedGuru) return;
    
    const tbody = document.getElementById('guru-iuran-tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-slate-400 italic">Memuat histori pembayaran...</td></tr>';
    
    try {
        // Ambil data iuran guru dari Supabase
        const { data, error } = await supabase
            .from('sukaduka_iuran')
            .select('*')
            .eq('guru_id', currentLoggedGuru.id)
            .order('bulan_tahun', { ascending: false });
            
        if (error) throw error;
        
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-slate-400 italic">Belum ada catatan pembayaran iuran.</td></tr>';
            document.getElementById('guru-total-terbayar').innerText = 'Rp 0';
            document.getElementById('guru-status-bulan-ini').innerHTML = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600 border border-red-200">Belum Bayar</span>';
            renderGuruTunggakanList([]);
            return;
        }
        
        // Tampilkan histori pembayaran
        let totalTerbayar = 0;
        const now = new Date();
        const thisBulanTahun = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        let sudahBayarBulanIni = false;
        
        tbody.innerHTML = data.map(i => {
            totalTerbayar += parseFloat(i.jumlah);
            if (i.bulan_tahun === thisBulanTahun) sudahBayarBulanIni = true;
            
            const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
            const [y, m] = i.bulan_tahun.split('-');
            const displayMonth = monthNames[parseInt(m) - 1] + ' ' + y;
            
            return `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td class="px-4 py-3 font-bold text-slate-700 dark:text-slate-350">${displayMonth}</td>
                    <td class="px-4 py-3 font-mono text-slate-500">${formatDateIndo(i.tanggal_bayar)}</td>
                    <td class="px-4 py-3 font-bold text-slate-800 dark:text-white">Rp ${parseFloat(i.jumlah).toLocaleString('id-ID')}</td>
                    <td class="px-4 py-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-green-50 text-green-600 border border-green-200">Lunas</span>
                    </td>
                    <td class="px-4 py-3 text-slate-500">${escapeHTML(i.created_by || 'Admin')}</td>
                </tr>
            `;
        }).join('');
        
        document.getElementById('guru-total-terbayar').innerText = 'Rp ' + totalTerbayar.toLocaleString('id-ID');
        
        if (sudahBayarBulanIni) {
            document.getElementById('guru-status-bulan-ini').innerHTML = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-600 border border-green-200">Lunas</span>';
        } else {
            document.getElementById('guru-status-bulan-ini').innerHTML = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600 border border-red-200">Belum Bayar</span>';
        }
        
        renderGuruTunggakanList(data);
        
    } catch (e) {
        console.error('[Suka-Duka] Gagal memuat data personal guru:', e);
        tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-red-500">Gagal memuat histori iuran.</td></tr>';
    }
};

// Render daftar tunggakan iuran bulanan untuk guru (awal tahun s.d. bulan ini)
function renderGuruTunggakanList(iuranData) {
    const wrapper = document.getElementById('wrapper-guru-tunggakan');
    const listEl = document.getElementById('guru-tunggakan-list');
    const detailEl = document.getElementById('guru-tunggakan-detail');
    if (!wrapper || !listEl || !detailEl) return;

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // 1-indexed (Januari=1)
    
    // Kumpulkan bulan-bulan yang terdaftar (format 'YYYY-MM' -> data iuran)
    const iuranMap = {};
    (iuranData || []).forEach(i => {
        iuranMap[i.bulan_tahun] = i;
    });
    
    const unpaidMonths = [];
    const monthNamesShort = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
    
    // Loop dari bulan Januari (bulan 1) s.d. bulan saat ini di tahun aktif
    for (let m = 1; m <= currentMonth; m++) {
        const mStr = String(m).padStart(2, '0');
        const key = `${currentYear}-${mStr}`;
        const trx = iuranMap[key];
        const isVirtualPaidRange = (currentYear < 2026) || (currentYear === 2026 && m <= 5);
        
        let isPaid = false;
        if (trx) {
            if (trx.jumlah > 0) {
                isPaid = true;
            } else if (trx.jumlah === 0) {
                isPaid = false; // Dihapus manual -> nunggak
            }
        } else {
            if (isVirtualPaidRange) {
                isPaid = true; // Default lunas virtual
            } else {
                isPaid = false;
            }
        }
        
        if (!isPaid) {
            unpaidMonths.push({
                label: `${monthNamesShort[m - 1]} ${currentYear}`,
                isCurrent: m === currentMonth
            });
        }
    }

    if (unpaidMonths.length > 0) {
        listEl.innerHTML = unpaidMonths.map(item => {
            if (item.isCurrent) {
                return `<span class="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/50" title="Bulan Berjalan">${item.label}</span>`;
            }
            return `<span class="px-2 py-0.5 text-[10px] font-bold rounded bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/50" title="Terlambat">${item.label}</span>`;
        }).join('');
        
        // --- HITUNG RINCIAN NOMINAL TUNGGAKAN & DENDA (PASAL 22) ---
        const count = unpaidMonths.length;
        const iuranPokok = nominalIuranDefault * count;
        
        // Denda keterlambatan: mengecualikan bulan berjalan saat ini jika belum dibayar
        const currentMonthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
        const currentMonthTrx = iuranMap[currentMonthKey];
        const isCurrentMonthVirtualPaid = (currentYear < 2026) || (currentYear === 2026 && currentMonth <= 5);
        
        let isCurrentMonthUnpaid = true;
        if (currentMonthTrx) {
            if (currentMonthTrx.jumlah > 0) {
                isCurrentMonthUnpaid = false;
            } else if (currentMonthTrx.jumlah === 0) {
                isCurrentMonthUnpaid = true;
            }
        } else {
            if (isCurrentMonthVirtualPaid) {
                isCurrentMonthUnpaid = false;
            } else {
                isCurrentMonthUnpaid = true;
            }
        }
        
        // Jumlah bulan yang benar-benar terlambat (lewat jatuh tempo)
        const lateMonthsCount = isCurrentMonthUnpaid ? (count - 1) : count;
        let totalDenda = 0;
        if (dendaAktifDefault) {
            const dendaCount = Math.floor(Math.max(0, lateMonthsCount) / dendaKelipatanBulanDefault);
            totalDenda = dendaCount * dendaNominalDefault;
        }
        
        const grandTotal = iuranPokok + totalDenda;
        
        // Masukkan ke UI
        document.getElementById('tunggakan-pokok-months').innerText = count;
        document.getElementById('tunggakan-pokok-amount').innerText = 'Rp ' + iuranPokok.toLocaleString('id-ID');
        document.getElementById('tunggakan-denda-amount').innerText = 'Rp ' + totalDenda.toLocaleString('id-ID');
        document.getElementById('tunggakan-total-amount').innerText = 'Rp ' + grandTotal.toLocaleString('id-ID');
        
        // Tampilkan panel rincian
        detailEl.classList.remove('hidden');

        // Perbarui grid total tunggakan personal
        const statTunggakanEl = document.getElementById('stat-total-tunggakan');
        if (statTunggakanEl) {
            statTunggakanEl.innerText = 'Rp ' + grandTotal.toLocaleString('id-ID');
            statTunggakanEl.className = "text-2xl font-black text-rose-600 dark:text-rose-400 mt-1";
        }
    } else {
        listEl.innerHTML = `
            <span class="text-green-600 dark:text-green-400 font-bold flex items-center gap-1 text-[11px]">
                <i class="fa-solid fa-circle-check"></i> Bebas Tunggakan
            </span>
        `;
        // Sembunyikan panel rincian
        detailEl.classList.add('hidden');

        // Perbarui grid total tunggakan personal (bebas tunggakan)
        const statTunggakanEl = document.getElementById('stat-total-tunggakan');
        if (statTunggakanEl) {
            statTunggakanEl.innerText = 'Rp 0';
            statTunggakanEl.className = "text-2xl font-black text-green-600 dark:text-green-455 mt-1";
        }
    }
    
    wrapper.classList.remove('hidden');
}

// =========================================================================
// 6. VIEW KASIR: INPUT IURAN GURU (ADMIN ONLY)
// =========================================================================
function setupYearOptions() {
    const yearSelect = document.getElementById('iuran-tahun');
    const filterYearSelect = document.getElementById('laporan-tahun-filter');
    const filterMonthSelect = document.getElementById('laporan-bulan-filter');
    
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // 1-indexed
    
    if (yearSelect) {
        yearSelect.innerHTML = '';
        for (let y = currentYear - 1; y <= currentYear + 2; y++) {
            const opt = document.createElement('option');
            opt.value = String(y);
            opt.textContent = String(y);
            if (y === currentYear) opt.selected = true;
            yearSelect.appendChild(opt);
        }
    }
    
    if (filterYearSelect) {
        filterYearSelect.innerHTML = '';
        // Sesuai aturan iuran suka duka, batasi tahun dari 2024 s.d. 2 tahun ke depan
        const minYear = 2024;
        const maxYear = currentYear + 2;
        for (let y = minYear; y <= maxYear; y++) {
            const opt = document.createElement('option');
            opt.value = String(y);
            opt.textContent = String(y);
            if (y === currentYear) opt.selected = true;
            filterYearSelect.appendChild(opt);
        }
    }

    if (filterMonthSelect) {
        const currentMonthStr = String(currentMonth).padStart(2, '0');
        filterMonthSelect.value = currentMonthStr;
    }
}

function setupAdminListeners() {
    const searchInput = document.getElementById('teacher-search');
    const dropdown = document.getElementById('guru-dropdown');
    const list = document.getElementById('guru-list');
    
    if (!searchInput) return;

    // Fungsi bantu render list guru
    const renderTeacherDropdown = (val) => {
        const filtered = val
            ? allTeachers.filter(t => t.name.toLowerCase().includes(val) || (t.nip && t.nip.includes(val)))
            : allTeachers;
            
        if (filtered.length === 0) {
            list.innerHTML = `<li class="p-2.5 text-xs italic text-slate-400 dark:text-slate-500 text-center">Guru tidak ditemukan</li>`;
        } else {
            list.innerHTML = filtered.map(t => {
                const avatarMini = renderTeacherAvatarHTML(t, 'w-7 h-7', 'rounded-full');
                return `
                    <li onclick="selectGuruForPayment('${t.id}', '${window.escapeJSString(t.name)}', '${t.nip || ''}')" 
                        class="p-2 hover:bg-indigo-50/70 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-350 cursor-pointer transition-colors flex items-center gap-2.5">
                        ${avatarMini}
                        <div class="min-w-0">
                            <div class="truncate leading-tight text-slate-800 dark:text-white font-bold">${escapeHTML(t.name)}</div>
                            <div class="text-[9px] text-slate-400 dark:text-slate-500 font-mono font-normal">NIP: ${escapeHTML(t.nip || '-')}</div>
                        </div>
                    </li>
                `;
            }).join('');
        }
        dropdown.classList.remove('hidden');
    };

    // Event Autocomplete Pencarian Guru
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        if (val.length === 0) {
            window.clearTeacherSearch();
            renderTeacherDropdown(''); // Tampilkan semua jika kosong
            return;
        }
        renderTeacherDropdown(val);
    });

    // Menampilkan dropdownlist langsung saat diklik atau difokuskan tanpa perlu ketik dulu
    searchInput.addEventListener('focus', () => {
        const val = searchInput.value.toLowerCase().trim();
        renderTeacherDropdown(val);
    });

    searchInput.addEventListener('click', () => {
        const val = searchInput.value.toLowerCase().trim();
        renderTeacherDropdown(val);
    });

    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
        if (e.target !== searchInput && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });

    // Form Submit Mutasi Kas
    document.getElementById('form-mutasi-kas').addEventListener('submit', handleInsertMutasiKas);
    
    // Form Pengaturan nominal
    document.getElementById('form-pengaturan-sukaduka').addEventListener('submit', handleSaveConfig);
    
    // Form Pengaturan Kas Awal
    const formKasAwal = document.getElementById('form-kas-awal-sukaduka');
    if (formKasAwal) {
        formKasAwal.addEventListener('submit', handleSaveKasAwal);
    }
    
    // Bind modal confirm delete button
    document.getElementById('btn-confirm-delete').addEventListener('click', executeDeleteTransaction);
    
    // Bind modal execute payment button
    document.getElementById('btn-execute-pay-sukaduka').addEventListener('click', executeSukaDukaPayment);
    
    // Bind Enter keypress untuk memicu pembayaran iuran
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const confirmModal = document.getElementById('modal-confirm-pay-sukaduka');
            const isConfirmModalOpen = confirmModal && !confirmModal.classList.contains('hidden');
            
            if (isConfirmModalOpen) {
                e.preventDefault();
                executeSukaDukaPayment();
                return;
            }
            
            const btnPay = document.getElementById('btn-pay-submit');
            if (btnPay && !btnPay.disabled && selectedMonths.length > 0) {
                // Cek apakah fokus saat ini sedang berada di input form lain (mutasi kas, pengaturan, atau kas awal)
                const activeEl = document.activeElement;
                const isOtherInput = activeEl && (
                    activeEl.closest('#form-mutasi-kas') || 
                    activeEl.closest('#form-pengaturan-sukaduka') || 
                    activeEl.closest('#form-kas-awal-sukaduka')
                );
                
                if (!isOtherInput) {
                    e.preventDefault();
                    window.requestSukaDukaPayment();
                }
            }
        }
    });

    // Inisialisasi Autocomplete Guru Penerima di Mutasi Kas
    setupMutasiGuruAutocomplete();

    // Inisialisasi formatting rupiah pada input form
    setupRupiahFormatters();
}

// Fungsi load riwayat iuran guru dari Supabase
async function loadTeacherPaymentHistory(guruId) {
    paymentHistory = {};
    try {
        const { data, error } = await supabase
            .from('sukaduka_iuran')
            .select('*')
            .eq('guru_id', guruId);
            
        if (error) throw error;
        
        if (data) {
            data.forEach(item => {
                paymentHistory[item.bulan_tahun] = item;
            });
        }
    } catch (e) {
        console.error('[Suka-Duka] Gagal memuat riwayat pembayaran guru:', e);
        showSukaDukaToast('Error', 'Gagal mengambil riwayat iuran.', 'error');
    }
}

// Pilihan Guru dari Autocomplete
window.selectGuruForPayment = async function(id, name, nip) {
    const searchInput = document.getElementById('teacher-search');
    if (searchInput) searchInput.value = name;
    
    document.getElementById('selected-guru-id').value = id;
    document.getElementById('selected-guru-name').value = name;
    document.getElementById('selected-guru-nip').value = nip;
    document.getElementById('guru-dropdown').classList.add('hidden');
    
    // Cari objek master GTK lengkap untuk memperoleh foto profil resmi
    const teacherObj = allTeachers.find(t => String(t.id) === String(id) || (nip && String(t.nip) === String(nip))) || { id, name, nip };
    currentSelectedGuru = teacherObj;
    selectedMonths = [];
    
    document.getElementById('info-guru-name').innerText = name;
    document.getElementById('info-guru-nip').innerText = 'NIP: ' + (nip || '-');
    document.getElementById('info-guru-rate').innerText = `Tarif: Rp ${nominalIuranDefault.toLocaleString('id-ID')}`;
    
    // Render Foto Profil pada Info Card Ringkas
    const infoAvatarContainer = document.getElementById('info-guru-avatar-container');
    if (infoAvatarContainer) {
        infoAvatarContainer.innerHTML = renderTeacherAvatarHTML(teacherObj, 'w-full h-full', 'rounded-xl');
    }

    // Render Foto Profil & Identitas pada Header Buku Kas Anggota (Kartu Iuran Digital)
    const cardGuruAvatarContainer = document.getElementById('card-guru-avatar-container');
    if (cardGuruAvatarContainer) {
        cardGuruAvatarContainer.innerHTML = renderTeacherAvatarHTML(teacherObj, 'w-full h-full', 'rounded-2xl');
    }
    const cardGuruNameEl = document.getElementById('card-guru-name');
    if (cardGuruNameEl) cardGuruNameEl.innerText = name;
    const cardGuruNipEl = document.getElementById('card-guru-nip');
    if (cardGuruNipEl) cardGuruNipEl.innerText = 'NIP: ' + (nip || '-');
    const cardGuruRateBadgeEl = document.getElementById('card-guru-rate-badge');
    if (cardGuruRateBadgeEl) cardGuruRateBadgeEl.innerText = `Rp ${nominalIuranDefault.toLocaleString('id-ID')}`;
    
    document.getElementById('guru-info-card').classList.remove('hidden');
    document.getElementById('payment-form').classList.remove('hidden');
    document.getElementById('sukaduka-placeholder').classList.add('hidden');
    document.getElementById('sukaduka-content').classList.remove('hidden');
    
    // Load data dari Supabase
    const cardContainer = document.getElementById('sukaduka-card-container');
    cardContainer.classList.add('opacity-60');
    await loadTeacherPaymentHistory(id);
    cardContainer.classList.remove('opacity-60');
    
    displayYear = new Date().getFullYear();
    renderSukaDukaGrid(displayYear);
    updateCalculationUI();
};

// Render Grid 12 Bulan (Januari s/d Desember)
window.renderSukaDukaGrid = function(year) {
    document.getElementById('display-sukaduka-year').innerText = year;
    const grid = document.getElementById('sukaduka-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // 1-indexed (Januari=1)
    
    let gridHtml = '';
    
    for (let m = 1; m <= 12; m++) {
        const mStr = String(m).padStart(2, '0');
        const key = `${year}-${mStr}`;
        const trx = paymentHistory[key];
        const isVirtualPaidRange = (year < 2026) || (year === 2026 && m <= 5);
        
        let isPaid = false;
        let isUnpaidVirtual = false; // Flag khusus jika asumsi lunas virtual dihapus manual
        
        if (trx) {
            if (trx.jumlah > 0) {
                isPaid = true;
            } else if (trx.jumlah === 0) {
                isPaid = false;
                isUnpaidVirtual = true;
            }
        } else {
            if (isVirtualPaidRange) {
                isPaid = true;
            } else {
                isPaid = false;
            }
        }
        
        const isSelected = selectedMonths.some(item => item.year === year && item.month === m);
        const isPastMonth = (year < currentYear) || (year === currentYear && m <= currentMonth);
        
        let boxClass = "";
        let statusHtml = "";
        let contentHtml = "";
        let clickAction = `onclick="window.handleSukaDukaGridClick(${year}, ${m})"`;
        
        if (isPaid) {
            boxClass = "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800 relative group cursor-default";
            statusHtml = `<div class="absolute top-2 right-2 text-green-500 dark:text-green-455"><i class="fa-solid fa-circle-check"></i></div>`;
            const lunasLabel = trx ? "Lunas" : "Lunas (Virtual)";
            contentHtml = `<div class="text-[10px] font-bold text-green-700 dark:text-green-455 mt-1">${lunasLabel}</div>`;
            
            // Hak CRUD hapus iuran hanya untuk admin
            const role = localStorage.getItem('user_role') || 'guru_mapel';
            let additionalRoles = [];
            try {
                additionalRoles = JSON.parse(localStorage.getItem('user_additional_roles') || '[]');
            } catch (e) {}
            const isAdmin = role === 'super_admin' || role === 'admin_sukaduka' || additionalRoles.includes('admin_sukaduka');
            
            if (isAdmin) {
                const trxId = trx ? trx.id : 'virtual';
                contentHtml += `
                    <div class="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <button type="button" onclick="event.stopPropagation(); window.confirmDeletePayment(${year}, ${m}, '${trxId}')" 
                            class="w-6 h-6 bg-white dark:bg-slate-700 text-red-500 rounded-full shadow border border-red-150 dark:border-slate-650 hover:bg-red-50 dark:hover:bg-red-900/50 flex items-center justify-center transition-transform hover:scale-110" 
                            title="Hapus Pembayaran">
                            <i class="fa-solid fa-trash-can text-[10px]"></i>
                        </button>
                    </div>
                `;
            }
            clickAction = ""; // Nonaktifkan klik iuran
        } else if (isSelected) {
            boxClass = "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-500 dark:border-indigo-450 ring-2 ring-indigo-300 dark:ring-indigo-700/50 cursor-pointer transform scale-[1.02] shadow-md z-10";
            statusHtml = `<div class="absolute top-2 right-2 text-indigo-600 dark:text-indigo-400"><i class="fa-solid fa-circle-check"></i></div>`;
            contentHtml = `<div class="text-[10px] font-bold text-indigo-700 dark:text-indigo-350 mt-1">Bayar Ini</div>`;
        } else if (isPastMonth || isUnpaidVirtual) {
            boxClass = "bg-red-50/70 dark:bg-red-950/15 border-red-200 dark:border-red-900/50 cursor-pointer hover:bg-red-100 dark:hover:bg-red-950/30 hover:border-red-300 dark:hover:border-red-800";
            statusHtml = `<div class="absolute top-2 right-2 text-red-400 dark:text-red-500 text-[9px] font-bold">Nunggak</div>`;
            contentHtml = `<div class="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Rp ${nominalIuranDefault.toLocaleString('id-ID')}</div>`;
        } else {
            boxClass = "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-500 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-750/50";
            statusHtml = `<div class="absolute top-2 right-2 text-slate-350 dark:text-slate-500 text-[9px] font-medium">Masa Depan</div>`;
            contentHtml = `<div class="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Rp ${nominalIuranDefault.toLocaleString('id-ID')}</div>`;
        }
        
        gridHtml += `
            <div class="relative p-3 rounded-xl border transition-all duration-200 ${boxClass}" ${clickAction}>
                <h4 class="text-xs font-bold text-slate-700 dark:text-slate-200">${monthNames[m - 1]}</h4>
                <div class="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">${year}</div>
                ${contentHtml}
                ${statusHtml}
            </div>
        `;
    }
    
    grid.innerHTML = gridHtml;
};

// Cek status lunas iuran (termasuk lunas virtual range)
function checkIsPaid(year, month) {
    const mStr = String(month).padStart(2, '0');
    const key = `${year}-${mStr}`;
    const trx = paymentHistory[key];
    const isVirtualPaidRange = (year < 2026) || (year === 2026 && month <= 5);
    
    if (trx) {
        return trx.jumlah > 0;
    } else {
        return isVirtualPaidRange;
    }
}

// Mencari bulan tidak lunas pertama di tahun kalender aktif
function getFirstUnpaidMonthInYear(year) {
    for (let m = 1; m <= 12; m++) {
        if (!checkIsPaid(year, m)) {
            return { year, month: m };
        }
    }
    return null;
}

// Logika Klik Grid
window.handleSukaDukaGridClick = function(targetY, targetM) {
    const startPoint = getFirstUnpaidMonthInYear(targetY);
    if (!startPoint) {
        showSukaDukaToast("Info", "Semua iuran di tahun ini sudah lunas!", "info");
        return;
    }
    
    const startScore = startPoint.year * 12 + startPoint.month;
    const targetScore = targetY * 12 + targetM;
    
    if (targetScore < startScore) {
        showSukaDukaToast("Error", "Bulan ini sudah lunas.", "error");
        return;
    }
    
    selectedMonths = [];
    let currY = startPoint.year;
    let currM = startPoint.month;
    
    while (currY < targetY || (currY === targetY && currM <= targetM)) {
        if (!checkIsPaid(currY, currM)) {
            selectedMonths.push({ year: currY, month: currM });
        }
        currM++;
        if (currM > 12) {
            currM = 1;
            currY++;
        }
    }
    
    renderSukaDukaGrid(displayYear);
    updateCalculationUI();
};

// Hitung total bayar & periode terpilih (Dengan Bonus & Sanksi AD-ART 2025)
function updateCalculationUI() {
    if (!currentSelectedGuru) return;
    
    const count = selectedMonths.length;
    const iuranPokok = nominalIuranDefault * count;
    
    // 1. Sanksi Keterlambatan: denda Rp 50.000 setiap kelipatan 3 bulan yang terlambat (lewat jatuh tempo)
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // 1-indexed
    
    // Filter bulan terpilih yang statusnya terlambat (sebelum bulan berjalan saat ini)
    const lateMonthsSelected = selectedMonths.filter(m => {
        return m.year < currentYear || (m.year === currentYear && m.month < currentMonth);
    });
    const lateCount = lateMonthsSelected.length;
    let totalDenda = 0;
    if (dendaAktifDefault) {
        const dendaCount = Math.floor(lateCount / dendaKelipatanBulanDefault);
        totalDenda = dendaCount * dendaNominalDefault;
    }
    
    // 2. Bonus Bayar Dimuka (AD-ART 2025): potongan HANYA jika:
    //    a) Membayar tepat 12 bulan Jan-Des dalam 1 tahun yang sama
    //    b) Dibayar di awal tahun sebelum ada yang jatuh tempo (tidak ada yg terlambat)
    let isBonusEligible = false;
    if (count === 12 && lateCount === 0) {
        // Pastikan ke-12 bulan adalah Jan(1)-Des(12) di tahun yang sama
        const targetYear = selectedMonths[0].year;
        const allSameYear = selectedMonths.every(m => m.year === targetYear);
        const hasAllMonths = selectedMonths.length === 12 &&
            selectedMonths.every((m, i) => m.month === i + 1);
        isBonusEligible = allSameYear && hasAllMonths;
    }
    const totalBonus = isBonusEligible ? nominalIuranDefault : 0;
    
    const totalBayar = iuranPokok + totalDenda - totalBonus;
    
    document.getElementById('calc-months').innerText = count;
    document.getElementById('calc-total').innerText = "Rp " + totalBayar.toLocaleString('id-ID');
    
    const detailsEl = document.getElementById('calc-details');
    detailsEl.classList.remove('hidden');
    
    if (count > 0) {
        const first = selectedMonths[0];
        const last = selectedMonths[selectedMonths.length - 1];
        
        const monthNamesShort = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
        const rangeText = (first.year === last.year && first.month === last.month)
            ? `${monthNamesShort[first.month - 1]} ${first.year}`
            : `${monthNamesShort[first.month - 1]} ${first.year} - ${monthNamesShort[last.month - 1]} ${last.year}`;
            
        let text = `Periode: ${rangeText}\nTarif Pokok: Rp ${nominalIuranDefault.toLocaleString('id-ID')}/bln (Total Rp ${iuranPokok.toLocaleString('id-ID')})`;
        
        if (totalDenda > 0) {
            text += `\n* Sanksi Terlambat (${dendaCount}x): +Rp ${totalDenda.toLocaleString('id-ID')}`;
        }
        if (totalBonus > 0) {
            text += `\n* Bonus Bayar 12 Bulan: -Rp ${totalBonus.toLocaleString('id-ID')}`;
        }
        
        detailsEl.innerText = text;
        document.getElementById('btn-pay-submit').disabled = false;
    } else {
        detailsEl.innerText = "Pilih kotak bulan pada kartu iuran.";
        document.getElementById('btn-pay-submit').disabled = true;
    }
}

// Navigasi tahun iuran
window.changeSukaDukaYear = function(delta) {
    const today = new Date();
    const currentYear = today.getFullYear();
    const minYear = 2024;
    const maxYear = currentYear + 2;
    
    const nextYear = displayYear + delta;
    if (nextYear < minYear || nextYear > maxYear) {
        showSukaDukaToast("Batasan Tahun", `Navigasi tahun dibatasi dari ${minYear} s.d. ${maxYear}.`, "warning");
        return;
    }
    
    displayYear = nextYear;
    selectedMonths = [];
    renderSukaDukaGrid(displayYear);
    updateCalculationUI();
};

// Reset Form Autocomplete & Profil Guru Terpilih
window.clearTeacherSearch = function() {
    const searchInput = document.getElementById('teacher-search');
    if (searchInput) searchInput.value = '';
    
    document.getElementById('selected-guru-id').value = '';
    document.getElementById('selected-guru-name').value = '';
    document.getElementById('selected-guru-nip').value = '';
    
    currentSelectedGuru = null;
    selectedMonths = [];
    paymentHistory = {};
    
    document.getElementById('guru-info-card').classList.add('hidden');
    document.getElementById('payment-form').classList.add('hidden');
    document.getElementById('sukaduka-content').classList.add('hidden');
    document.getElementById('sukaduka-placeholder').classList.remove('hidden');

    const infoAvatarContainer = document.getElementById('info-guru-avatar-container');
    if (infoAvatarContainer) {
        infoAvatarContainer.innerHTML = '<i class="fa-solid fa-user-tie"></i>';
    }
    const cardGuruAvatarContainer = document.getElementById('card-guru-avatar-container');
    if (cardGuruAvatarContainer) {
        cardGuruAvatarContainer.innerHTML = '<i class="fa-solid fa-user-tie text-indigo-500"></i>';
    }
    
    updateCalculationUI();
    
    if (searchInput) {
        setTimeout(() => {
            searchInput.focus();
        }, 50);
    }
};

// Buka Modal Konfirmasi Pembayaran
window.requestSukaDukaPayment = function() {
    if (selectedMonths.length === 0) {
        showSukaDukaToast("Pilih Bulan", "Silakan klik bulan yang ingin dibayar pada kartu iuran.", "warning");
        return;
    }
    
    const totalStr = document.getElementById('calc-total').innerText;
    const first = selectedMonths[0];
    const last = selectedMonths[selectedMonths.length - 1];
    const monthNamesShort = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
    
    const rangeText = (first.year === last.year && first.month === last.month)
        ? `${monthNamesShort[first.month - 1]} ${first.year}`
        : `${monthNamesShort[first.month - 1]} ${first.year} - ${monthNamesShort[last.month - 1]} ${last.year}`;
        
    document.getElementById('confirm-pay-period-text').innerText = `${selectedMonths.length} Bulan (${rangeText})`;
    document.getElementById('confirm-pay-amount-text').innerText = totalStr;
    document.getElementById('modal-confirm-pay-sukaduka').classList.remove('hidden');
};

window.closeConfirmPayModal = function() {
    document.getElementById('modal-confirm-pay-sukaduka').classList.add('hidden');
};

// Eksekusi Simpan Pembayaran Multi-Bulan ke Supabase
// Eksekusi Simpan Pembayaran Multi-Bulan ke Supabase (Dengan Sanksi & Bonus AD-ART 2025)
async function executeSukaDukaPayment() {
    window.closeConfirmPayModal();
    
    const btn = document.getElementById('btn-pay-submit');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i>Memproses...';
    
    try {
        const creator = auth.currentUser.displayName || auth.currentUser.email;
        const errors = [];
        
        const count = selectedMonths.length;
        
        // Validasi Bonus Bayar Dimuka (AD-ART 2025):
        // Bonus HANYA berlaku jika membayar 12 bulan Jan-Des penuh di 1 tahun yang sama,
        // dan tidak ada bulan yang terlambat (dibayar di awal tahun sebelum jatuh tempo).
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1;
        
        const lateMonthsSelected = selectedMonths.filter(m => {
            return m.year < currentYear || (m.year === currentYear && m.month < currentMonth);
        });
        const lateCount = lateMonthsSelected.length;
        
        let isBonusApplied = false;
        if (count === 12 && lateCount === 0) {
            const targetYear = selectedMonths[0].year;
            const allSameYear = selectedMonths.every(m => m.year === targetYear);
            const hasAllMonths = selectedMonths.every((m, i) => m.month === i + 1);
            isBonusApplied = allSameYear && hasAllMonths;
        }
        
        // 1. Proses Pembayaran Bulan demi Bulan (Iuran Pokok & Bonus)
        for (let i = 0; i < count; i++) {
            const item = selectedMonths[i];
            const mStr = String(item.month).padStart(2, '0');
            const bulanTahun = `${item.year}-${mStr}`;
            
            const isLastMonthAndBonus = (isBonusApplied && i === count - 1);
            const nominalBulanIni = isLastMonthAndBonus ? 0 : nominalIuranDefault;
            const keteranganBulanIni = isLastMonthAndBonus
                ? `${currentSelectedGuru.name} (${bulanTahun}) *Bonus Bayar Dimuka`
                : `${currentSelectedGuru.name} (${bulanTahun})`;
            
            try {
                // Simpan ke sukaduka_kas dan sukaduka_iuran via Edge Function Secure Proxy
                await callSecureEdgeFunction('sukaduka-bayar-iuran', {
                    guru_id: currentSelectedGuru.id,
                    anggota_nama: currentSelectedGuru.name,
                    anggota_nip: currentSelectedGuru.nip || null,
                    bulan_tahun: bulanTahun,
                    jumlah: nominalBulanIni,
                    creator: creator
                });
            } catch (err) {
                console.error(`Gagal memproses bulan ${bulanTahun}:`, err);
                errors.push(`${bulanTahun}: ${err.message || 'Error database'}`);
            }
        }
        
        // 2. Proses Pencatatan Denda Keterlambatan jika ada (variabel lateCount sudah dihitung di atas)
        let totalDenda = 0;
        if (dendaAktifDefault) {
            const dendaCount = Math.floor(lateCount / dendaKelipatanBulanDefault);
            totalDenda = dendaCount * dendaNominalDefault;
        }
        
        if (totalDenda > 0 && errors.length === 0) {
            try {
                // Simpan denda ke sukaduka_kas via Edge Function Secure Proxy
                await callSecureEdgeFunction('sukaduka-catat-denda', {
                    jumlah: totalDenda,
                    keterangan: `Denda Keterlambatan Iuran Suka-Duka: ${currentSelectedGuru.name} (${lateCount} Bln Terlambat)`,
                    creator: creator
                });
            } catch (err) {
                console.error('Gagal mencatat denda kas masuk:', err);
                errors.push(`Denda Kas: ${err.message || 'Gagal menyimpan denda'}`);
            }
        }
        
        if (errors.length > 0) {
            showSukaDukaToast('Selesai dengan Error', `Beberapa proses gagal:\n${errors.join('\n')}`, 'warning');
        } else {
            let msg = `Berhasil menyimpan pembayaran iuran untuk ${count} bulan!`;
            if (isBonusApplied) msg += ` (Bonus potongan Rp 50.000 aktif)`;
            if (totalDenda > 0) msg += ` (Sanksi denda Rp ${totalDenda.toLocaleString('id-ID')} masuk)`;
            
            showSukaDukaToast('Berhasil', msg, 'success');
        }
        
        // Refresh UI
        selectedMonths = [];
        await loadTeacherPaymentHistory(currentSelectedGuru.id);
        renderSukaDukaGrid(displayYear);
        updateCalculationUI();
        
        await refreshDashboardStats();
        await refreshRecentPayments();

        // Otomatis fokus dan blok teks pencarian nama guru agar admin bisa langsung mengetik nama baru
        const searchInput = document.getElementById('teacher-search');
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
        
    } catch (e) {
        console.error(e);
        showSukaDukaToast('Gagal', e.message || 'Gagal memproses pembayaran.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// Buka Modal Konfirmasi Hapus Pembayaran Iuran
window.confirmDeletePayment = function(year, month, iuranId) {
    pendingDeleteId = iuranId;
    pendingDeleteYear = year;
    pendingDeleteMonth = month;
    pendingDeleteType = 'iuran';
    document.getElementById('delete-confirm-input').value = '';
    document.getElementById('modal-delete-suka-duka').classList.remove('hidden');
};

// Mengambil Data Transaksi Terbaru
async function refreshRecentPayments() {
    const tbody = document.getElementById('recent-payments-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-slate-400 italic"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Memuat...</td></tr>';
    
    try {
        const { data, error } = await supabase
            .from('sukaduka_iuran')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10);
            
        if (error) throw error;
        
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-slate-400 italic">Belum ada transaksi pembayaran.</td></tr>';
            return;
        }
        
        const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        
        tbody.innerHTML = data.map(i => {
            const [y, m] = i.bulan_tahun.split('-');
            const displayMonth = monthNames[parseInt(m) - 1] + ' ' + y;
            
            // Cocokkan data guru dari master allTeachers
            const teacherObj = allTeachers.find(t => String(t.id) === String(i.guru_id) || (i.guru_id && String(t.nip) === String(i.guru_id))) || { name: i.anggota_nama };
            const avatarMini = renderTeacherAvatarHTML(teacherObj, 'w-7 h-7', 'rounded-full');

            return `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td class="px-4 py-3 font-bold text-slate-800 dark:text-white flex items-center gap-2.5">
                        ${avatarMini}
                        <span class="truncate leading-tight">${escapeHTML(i.anggota_nama)}</span>
                    </td>
                    <td class="px-4 py-3 font-semibold text-slate-600 dark:text-slate-350">${displayMonth}</td>
                    <td class="px-4 py-3 font-mono text-slate-400 text-[11px]">${formatDateIndo(i.tanggal_bayar)}</td>
                    <td class="px-4 py-3 font-black text-green-600 dark:text-green-400">Rp ${parseFloat(i.jumlah).toLocaleString('id-ID')}</td>
                    <td class="px-4 py-3 text-slate-500">${escapeHTML(i.created_by || 'Admin')}</td>
                    <td class="px-4 py-3 text-center">
                        <button onclick="requestDeleteTransaction('${i.id}', 'iuran')" 
                            class="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 p-1.5 rounded-lg transition-colors" title="Hapus">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
        
    } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-red-500">Gagal memuat transaksi terbaru.</td></tr>';
    }
}

// =========================================================================
// 7. VIEW KAS: BUKU KAS & MUTASI KAS (ADMIN ONLY)
// =========================================================================
async function handleInsertMutasiKas(e) {
    e.preventDefault();
    
    const tipe = document.getElementById('mutasi-tipe').value;
    const kategori = document.getElementById('mutasi-kategori').value;
    const jumlah = getCleanNumber(document.getElementById('mutasi-amount').value);
    const keterangan = document.getElementById('mutasi-keterangan').value.trim();
    
    if (jumlah <= 0) {
        showSukaDukaToast('Error', 'Silakan masukkan nominal mutasi kas yang valid.', 'error');
        return;
    }
    
    const btn = document.getElementById('btn-mutasi-submit');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i>Menyimpan...';
    
    try {
        const creator = auth.currentUser.displayName || auth.currentUser.email;
        
        // Simpan mutasi kas ke Supabase via Edge Function secure proxy
        await callSecureEdgeFunction('sukaduka-mutasi-kas', {
            tipe,
            kategori,
            jumlah,
            keterangan,
            created_by: creator
        });
        
        showSukaDukaToast('Berhasil', 'Mutasi kas berhasil disimpan!', 'success');
        document.getElementById('form-mutasi-kas').reset();
        window.clearMutasiGuruSearch();
        const templateSelect = document.getElementById('mutasi-santunan-template');
        if (templateSelect) templateSelect.value = '';
        window.handleMutasiTipeChange();
        
        await refreshDashboardStats();
        await refreshBukuKas();
        
        if (typeof window.closeMutasiModal === 'function') {
            window.closeMutasiModal();
        }
        
    } catch (e) {
        console.error(e);
        showSukaDukaToast('Gagal', e.message || 'Gagal menyimpan mutasi.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

window.refreshBukuKas = async function() {
    const tbody = document.getElementById('buku-kas-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-slate-400 italic"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Memuat Buku Kas...</td></tr>';
    
    try {
        if (typeof initKasFilters === 'function') {
            initKasFilters();
        }
        // Ambil filter tahun dan bulan dari dropdown
        const yearSelect = document.getElementById('filter-kas-year');
        const monthSelect = document.getElementById('filter-kas-month');
        const selectedYear = yearSelect ? parseInt(yearSelect.value) : new Date().getFullYear();
        const selectedMonth = monthSelect ? monthSelect.value : '';

        // Query seluruh data tahun yang dipilih (paginasi); filter bulan diterapkan SETELAH saldo berjalan dihitung
        const { data, error } = await fetchSukaDukaKasRows(q => q
            .gte('tanggal', `${selectedYear}-01-01`)
            .lte('tanggal', `${selectedYear}-12-31`)
            .order('tanggal', { ascending: true })
            .order('created_at', { ascending: true }), '*');
        if (error) throw error;

        // Cek apakah tahun yang dipilih sudah ditutup
        const isYearClosed = closedYearsList.includes(selectedYear);

        // Update badge status closing di Arus Kas
        const closingStatusEl = document.getElementById('kas-closing-status');
        if (closingStatusEl) {
            if (isYearClosed) {
                closingStatusEl.classList.remove('hidden');
                closingStatusEl.innerHTML = '<span class="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 px-2 py-1 rounded-full border border-amber-200 dark:border-amber-900/50"><i class="fa-solid fa-lock"></i> Tahun Buku Ditutup</span>';
            } else {
                closingStatusEl.classList.remove('hidden');
                closingStatusEl.innerHTML = '<span class="inline-flex items-center gap-1 text-[10px] font-bold bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 px-2 py-1 rounded-full border border-green-200 dark:border-green-900/50"><i class="fa-solid fa-lock-open"></i> Tahun Buku Terbuka</span>';
            }
        }

        // Hitung saldo awal dari closing tahun sebelumnya
        const prevYear = selectedYear - 1;
        let saldoAwal = 0;
        if (closingDataMap[prevYear]) {
            saldoAwal = parseFloat(closingDataMap[prevYear].saldo_akhir) || 0;
        } else {
            // Fallback (tahun sebelumnya belum ditutup): mulai dari tutup buku terakhir sebelum tahun terpilih
            // (jika ada), lalu tambahkan seluruh mutasi setelahnya hingga akhir tahun sebelumnya
            const earlierClosedYears = closedYearsList.map(Number).filter(y => y < selectedYear);
            const baseClosedYear = earlierClosedYears.length > 0 ? Math.max(...earlierClosedYears) : null;
            let saldoAwalCents = baseClosedYear !== null
                ? Math.round((parseFloat(closingDataMap[baseClosedYear].saldo_akhir) || 0) * 100)
                : 0;

            const { data: prevData, error: prevError } = await fetchSukaDukaKasRows(q => {
                let pq = q.lt('tanggal', `${selectedYear}-01-01`);
                if (baseClosedYear !== null) pq = pq.gte('tanggal', `${baseClosedYear + 1}-01-01`);
                return pq;
            });
            if (prevError) throw prevError;

            prevData.forEach(kas => {
                const cents = Math.round((parseFloat(kas.jumlah) || 0) * 100);
                if (kas.tipe === 'masuk') saldoAwalCents += cents;
                else if (kas.tipe === 'keluar') saldoAwalCents -= cents;
            });
            saldoAwal = saldoAwalCents / 100;
        }

        const categoryLabels = {
            'iuran_bulanan': 'Iuran Bulanan',
            'donasi': 'Donasi Sosial',
            'kas_awal': 'Kas Awal (Migrasi)',
            'santunan_duka': 'Santunan Duka Cita',
            'santunan_nikah': 'Santunan Pernikahan',
            'santunan_sakit': 'Santunan Rawat Inap',
            'santunan_kelahiran': 'Santunan Kelahiran',
            'santunan_potong_gigi': 'Santunan Potong Gigi',
            'santunan_upacara_agama': 'Santunan Keagamaan',
            'santunan_ngupasaksi': 'Santunan Ngupasaksi',
            'santunan_pensiun': 'Santunan Pensiun',
            'lain_lain': 'Lain-lain'
        };
        
        // Hitung Saldo Berjalan (Running Balance) atas SELURUH transaksi tahun terpilih (satuan sen agar presisi),
        // baru kemudian disaring per bulan agar saldo bulan berjalan tetap memperhitungkan bulan-bulan sebelumnya
        let runningBalanceCents = Math.round(saldoAwal * 100);
        const balancedData = data.map(kas => {
            const cents = Math.round((parseFloat(kas.jumlah) || 0) * 100);
            if (kas.tipe === 'masuk') {
                runningBalanceCents += cents;
            } else {
                runningBalanceCents -= cents;
            }
            return {
                ...kas,
                balance: runningBalanceCents / 100
            };
        });

        // Filter bulan di client-side jika dipilih
        const processedData = selectedMonth
            ? balancedData.filter(kas => (kas.tanggal ? kas.tanggal.substring(5, 7) : '') === selectedMonth)
            : balancedData;

        // Urutkan terbalik agar data terbaru berada paling atas
        processedData.reverse();

        // Tambahkan virtual row Saldo Awal di paling bawah (posisi terakhir setelah reverse = paling bawah tabel)
        const saldoAwalLabel = closingDataMap[prevYear] ? `Saldo Awal (Dari Tutup Buku ${prevYear})` : `Saldo Awal Tahun ${selectedYear}`;
        
        let rows = processedData.map(kas => {
            const isMasuk = kas.tipe === 'masuk';
            const colorClass = isMasuk ? 'text-green-600 dark:text-green-400' : 'text-rose-600 dark:text-rose-400';
            const sign = isMasuk ? '+' : '-';

            const rawKeterangan = kas.keterangan || '-';
            const cleanKeterangan = rawKeterangan.replace(/^(Iuran Bulanan Guru:\s*|Iuran Bulanan Pegawai:\s*)/i, '');

            // Lock delete jika tahun sudah ditutup
            let actionButton;
            if (isYearClosed) {
                actionButton = '<span class="text-[10px] text-amber-500 italic"><i class="fa-solid fa-lock mr-0.5"></i> Terkunci</span>';
            } else {
                const allowDelete = kas.kategori !== 'iuran_bulanan';
                actionButton = allowDelete ? `
                    <button onclick="requestDeleteTransaction('${kas.id}', 'kas')" 
                        class="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 p-1.5 rounded-lg transition-colors" title="Hapus">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                ` : `<span class="text-[10px] text-slate-400 italic">Delete via Kasir</span>`;
            }

            return `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td class="px-4 py-3 font-mono text-slate-500">${formatDateIndo(kas.tanggal)}</td>
                    <td class="px-4 py-3 font-semibold text-slate-700 dark:text-slate-350">${categoryLabels[kas.kategori] || kas.kategori}</td>
                    <td class="px-4 py-3 text-slate-600 dark:text-slate-400 max-w-xs truncate" title="${escapeHTML(cleanKeterangan)}">${escapeHTML(cleanKeterangan)}</td>
                    <td class="px-4 py-3 font-black text-right ${colorClass}">${sign} Rp ${parseFloat(kas.jumlah).toLocaleString('id-ID')}</td>
                    <td class="px-4 py-3 font-bold text-right text-slate-700 dark:text-slate-300">Rp ${parseFloat(kas.balance).toLocaleString('id-ID')}</td>
                    <td class="px-4 py-3 text-center">${actionButton}</td>
                </tr>
            `;
        }).join('');

        // Tambahkan virtual row Saldo Awal di paling bawah tabel (tanpa filter bulan agar selalu terlihat)
        if (!selectedMonth) {
            rows += `
                <tr class="bg-amber-50/50 dark:bg-amber-950/10 border-t-2 border-amber-200 dark:border-amber-900/50">
                    <td class="px-4 py-3 font-mono text-amber-600 dark:text-amber-400 font-bold">01 Jan ${selectedYear}</td>
                    <td class="px-4 py-3 font-bold text-amber-700 dark:text-amber-400"><i class="fa-solid fa-wallet mr-1"></i> Saldo Awal</td>
                    <td class="px-4 py-3 text-amber-600 dark:text-amber-400 italic text-xs">${escapeHTML(saldoAwalLabel)}</td>
                    <td class="px-4 py-3 font-black text-right text-amber-700 dark:text-amber-400">Rp ${saldoAwal.toLocaleString('id-ID')}</td>
                    <td class="px-4 py-3 font-bold text-right text-amber-700 dark:text-amber-400">Rp ${saldoAwal.toLocaleString('id-ID')}</td>
                    <td class="px-4 py-3 text-center"><span class="text-[10px] text-slate-400 italic">-</span></td>
                </tr>
            `;
        }

        if (!rows || processedData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-6 text-center text-slate-400 italic">Tidak ada transaksi kas di ${selectedMonth ? 'bulan ini' : 'tahun ' + selectedYear}.</td></tr>`;
        } else {
            tbody.innerHTML = rows;
        }
        
    } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-red-500">Gagal memuat buku kas.</td></tr>';
    }
};

// Export Buku Kas ke Excel
window.exportBukuKasExcel = async function() {
    try {
        const { data, error } = await fetchSukaDukaKasRows(q => q
            .order('tanggal', { ascending: true })
            .order('created_at', { ascending: true }), '*');

        if (error) throw error;
        
        const categoryLabels = {
            'iuran_bulanan': 'Iuran Bulanan',
            'donasi': 'Donasi Sosial',
            'santunan_duka': 'Santunan Duka Cita',
            'santunan_nikah': 'Santunan Pernikahan',
            'santunan_sakit': 'Santunan Rawat Inap',
            'santunan_kelahiran': 'Santunan Kelahiran',
            'santunan_potong_gigi': 'Santunan Potong Gigi',
            'santunan_upacara_agama': 'Santunan Keagamaan',
            'santunan_ngupasaksi': 'Santunan Ngupasaksi',
            'santunan_pensiun': 'Santunan Pensiun',
            'lain_lain': 'Lain-lain'
        };

        let runningBalance = 0;
        const excelData = (data || []).map((kas, idx) => {
            const isMasuk = kas.tipe === 'masuk';
            if (isMasuk) {
                runningBalance += parseFloat(kas.jumlah);
            } else {
                runningBalance -= parseFloat(kas.jumlah);
            }
            const cleanKeterangan = (kas.keterangan || '-').replace(/^(Iuran Bulanan Guru:\s*|Iuran Bulanan Pegawai:\s*)/i, '');
            return {
                'No': idx + 1,
                'Tanggal': kas.tanggal,
                'Kategori': categoryLabels[kas.kategori] || kas.kategori,
                'Keterangan': cleanKeterangan,
                'Nominal (Rp)': parseFloat(kas.jumlah) * (isMasuk ? 1 : -1),
                'Saldo (Rp)': runningBalance
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(excelData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Buku Kas");
        
        // Auto width columns
        const maxKeys = Object.keys(excelData[0] || {});
        worksheet["!cols"] = maxKeys.map(k => ({ wch: 20 }));

        XLSX.writeFile(workbook, `buku_kas_sukaduka_${new Date().toISOString().split('T')[0]}.xlsx`);
        showSukaDukaToast('Berhasil', 'Buku kas berhasil diexport ke Excel.', 'success');
    } catch (e) {
        console.error(e);
        showSukaDukaToast('Gagal', 'Gagal export data.', 'error');
    }
};

// =========================================================================
// 8. VIEW LAPORAN: TUNGGAKAN & REKAP (ADMIN ONLY)
// =========================================================================
window.switchSubLaporanTab = function(subTab) {
    currentSubLaporanTab = subTab;
    
    const btnPembayaran = document.getElementById('btn-sublaporan-pembayaran');
    const btnTunggakan = document.getElementById('btn-sublaporan-tunggakan');
    
    const panelPembayaran = document.getElementById('panel-laporan-pembayaran');
    const panelTunggakan = document.getElementById('panel-laporan-tunggakan');
    
    const bulanFilter = document.getElementById('laporan-bulan-filter');
    const titleEl = document.getElementById('laporan-title');
    const subtitleEl = document.getElementById('laporan-subtitle');
    
    if (!btnPembayaran || !btnTunggakan || !panelPembayaran || !panelTunggakan || !titleEl || !subtitleEl) return;

    if (subTab === 'pembayaran') {
        // Active button styles
        btnPembayaran.className = "flex-1 lg:flex-none px-4 py-2 text-xs font-bold rounded-lg transition-all bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm";
        btnTunggakan.className = "flex-1 lg:flex-none px-4 py-2 text-xs font-bold rounded-lg transition-all text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white";
        
        // Panels visibility
        panelPembayaran.classList.remove('hidden');
        panelTunggakan.classList.add('hidden');
        
        // Filter visibility
        if (bulanFilter) bulanFilter.classList.remove('hidden');
        
        // Title text
        titleEl.innerHTML = '<i id="laporan-title-icon" class="fa-solid fa-file-invoice text-indigo-500"></i> <span>Laporan Pembayaran Bulanan</span>';
        subtitleEl.innerText = 'Cek siapa saja guru yang belum membayar iuran suka-duka.';
    } else {
        // Active button styles
        btnPembayaran.className = "flex-1 lg:flex-none px-4 py-2 text-xs font-bold rounded-lg transition-all text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white";
        btnTunggakan.className = "flex-1 lg:flex-none px-4 py-2 text-xs font-bold rounded-lg transition-all bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm";
        
        // Panels visibility
        panelPembayaran.classList.add('hidden');
        panelTunggakan.classList.remove('hidden');
        
        // Filter visibility
        if (bulanFilter) bulanFilter.classList.add('hidden');
        
        // Title text
        titleEl.innerHTML = '<i id="laporan-title-icon" class="fa-solid fa-clock-rotate-left text-indigo-500"></i> <span>Rekap Laporan Tunggakan</span>';
        subtitleEl.innerText = 'Daftar tunggakan iuran, denda, dan total tagihan guru / pegawai pada tahun yang dipilih.';
    }
    
    // Refresh content
    window.refreshLaporanIuran();
};

window.refreshLaporanIuran = async function() {
    const filterTahun = document.getElementById('laporan-tahun-filter').value;
    
    if (currentSubLaporanTab === 'pembayaran') {
        const tbody = document.getElementById('laporan-iuran-tbody');
        const filterBulan = document.getElementById('laporan-bulan-filter').value;
        const filterBulanTahun = `${filterTahun}-${filterBulan}`;
        
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400 italic"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Memproses laporan...</td></tr>';
        
        try {
            // 1. Ambil seluruh data pembayaran iuran untuk bulan terpilih dari Supabase
            const { data: iuranData, error } = await supabase
                .from('sukaduka_iuran')
                .select('*')
                .eq('bulan_tahun', filterBulanTahun);
                
            if (error) throw error;
            
            // Petakan pembayaran berdasarkan ID guru
            const paidGuruMap = {};
            (iuranData || []).forEach(i => {
                paidGuruMap[i.guru_id] = i;
            });
            
            // 2. Bandingkan dengan Master Data Guru
            if (allTeachers.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-red-500">Master data guru kosong. Refresh halaman.</td></tr>';
                return;
            }
            
            let reportHTML = '';
            
            const [targetYear, targetMonth] = filterBulanTahun.split('-').map(Number);
            const isVirtualPaidRange = (targetYear < 2026) || (targetYear === 2026 && targetMonth <= 5);

            allTeachers.forEach(t => {
                const paymentRecord = paidGuruMap[t.id];
                
                let isLunas = false;
                if (paymentRecord) {
                    if (paymentRecord.jumlah > 0) {
                        isLunas = true;
                    } else if (paymentRecord.jumlah === 0) {
                        isLunas = false; // deleted manually
                    }
                } else {
                    if (isVirtualPaidRange) {
                        isLunas = true; // default lunas virtual
                    } else {
                        isLunas = false;
                    }
                }
                
                const badgeClass = isLunas 
                    ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/20 dark:text-green-400 dark:border-green-900/50' 
                    : 'bg-rose-50 text-rose-755 border-rose-200 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/50';
                const statusLabel = isLunas 
                    ? (paymentRecord ? 'Lunas' : 'Lunas (Virtual)')
                    : 'Belum Bayar';
                
                const tglBayar = isLunas 
                    ? (paymentRecord ? formatDateIndo(paymentRecord.tanggal_bayar) : '-') 
                    : '-';
                const nominal = isLunas 
                    ? `Rp ${parseFloat(paymentRecord ? paymentRecord.jumlah : nominalIuranDefault).toLocaleString('id-ID')}` 
                    : 'Rp 0';
                const petugas = isLunas 
                    ? (paymentRecord ? (paymentRecord.created_by || 'Admin') : 'Sistem') 
                    : '-';

                const avatarMini = renderTeacherAvatarHTML(t, 'w-7 h-7', 'rounded-full');
                reportHTML += `
                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td class="px-4 py-3 font-bold text-slate-800 dark:text-white flex items-center gap-2.5">
                            ${avatarMini}
                            <span class="truncate leading-tight">${escapeHTML(t.name)}</span>
                        </td>
                        <td class="px-4 py-3 font-mono text-slate-400 text-[11px]">${escapeHTML(t.nip || '-')}</td>
                        <td class="px-4 py-3">
                            <span class="px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${badgeClass}">${statusLabel}</span>
                        </td>
                        <td class="px-4 py-3 font-mono text-slate-500">${tglBayar}</td>
                        <td class="px-4 py-3 font-bold text-slate-700 dark:text-slate-300">${nominal}</td>
                        <td class="px-4 py-3 text-slate-500">${escapeHTML(petugas)}</td>
                    </tr>
                `;
            });
            
            tbody.innerHTML = reportHTML;
            
        } catch (e) {
            console.error(e);
            tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-red-500">Gagal memproses laporan.</td></tr>';
        }
    } else {
        const tbody = document.getElementById('laporan-tunggakan-tbody');
        tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-slate-400 italic"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Memproses rekap tunggakan...</td></tr>';
        
        try {
            // Ambil semua data iuran pada tahun terpilih
            const { data: iuranData, error } = await supabase
                .from('sukaduka_iuran')
                .select('*')
                .gte('bulan_tahun', `${filterTahun}-01`)
                .lte('bulan_tahun', `${filterTahun}-12`);
                
            if (error) throw error;
            
            if (allTeachers.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-red-500">Master data guru kosong. Refresh halaman.</td></tr>';
                return;
            }

            const today = new Date();
            const currentYear = today.getFullYear();
            const currentMonth = today.getMonth() + 1; // 1-indexed
            
            let limitMonth = 12;
            const targetYear = parseInt(filterTahun);
            if (targetYear === currentYear) {
                limitMonth = currentMonth;
            } else if (targetYear > currentYear) {
                limitMonth = 0;
            }

            const monthNamesShort = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
            
            // Kelompokkan iuran berdasarkan guru_id
            const guruIuranMap = {};
            (iuranData || []).forEach(i => {
                if (!guruIuranMap[i.guru_id]) guruIuranMap[i.guru_id] = [];
                guruIuranMap[i.guru_id].push(i);
            });

            let reportHTML = '';
            let countTunggakanTotal = 0;

            allTeachers.forEach(t => {
                const teacherTrxs = guruIuranMap[t.id] || [];
                const unpaidMonths = [];
                
                for (let m = 1; m <= limitMonth; m++) {
                    const mStr = String(m).padStart(2, '0');
                    const key = `${filterTahun}-${mStr}`;
                    const trx = teacherTrxs.find(tx => tx.bulan_tahun === key);
                    const isVirtualPaidRange = (targetYear < 2026) || (targetYear === 2026 && m <= 5);
                    
                    let isPaid = false;
                    if (trx) {
                        if (trx.jumlah > 0) {
                            isPaid = true;
                        } else if (trx.jumlah === 0) {
                            isPaid = false; // dihapus manual -> nunggak
                        }
                    } else {
                        if (isVirtualPaidRange) {
                            isPaid = true; // default lunas virtual
                        } else {
                            isPaid = false;
                        }
                    }
                    
                    if (!isPaid) {
                        unpaidMonths.push({
                            monthNum: m,
                            label: `${monthNamesShort[m - 1]} ${filterTahun}`,
                            isCurrent: targetYear === currentYear && m === currentMonth
                        });
                    }
                }

                if (unpaidMonths.length > 0) {
                    countTunggakanTotal++;
                    const count = unpaidMonths.length;
                    const iuranPokok = nominalIuranDefault * count;
                    
                    let lateMonthsCount = count;
                    if (targetYear === currentYear) {
                        const isCurrentMonthUnpaid = unpaidMonths.some(um => um.monthNum === currentMonth);
                        lateMonthsCount = isCurrentMonthUnpaid ? (count - 1) : count;
                    }
                    let totalDenda = 0;
                    if (dendaAktifDefault) {
                        const dendaCount = Math.floor(Math.max(0, lateMonthsCount) / dendaKelipatanBulanDefault);
                        totalDenda = dendaCount * dendaNominalDefault;
                    }
                    const grandTotal = iuranPokok + totalDenda;

                    const badgesHTML = unpaidMonths.map(item => {
                        if (item.isCurrent) {
                            return `<span class="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-55 text-amber-600 border border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/50 mr-1 mb-1 inline-block" title="Bulan Berjalan">${item.label}</span>`;
                        }
                        return `<span class="px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/50 mr-1 mb-1 inline-block" title="Terlambat">${item.label}</span>`;
                    }).join('');

                    const avatarMini = renderTeacherAvatarHTML(t, 'w-6 h-6', 'rounded-full');

                    reportHTML += `
                        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 text-[11px]">
                            <td class="px-2 py-2.5 font-bold text-slate-800 dark:text-white truncate max-w-[170px]" title="${escapeHTML(t.name)}">
                                <div class="flex items-center gap-2 min-w-0">
                                    ${avatarMini}
                                    <span class="truncate leading-tight">${escapeHTML(t.name)}</span>
                                </div>
                            </td>
                            <td class="px-2 py-2.5 font-mono text-slate-400 truncate max-w-[90px]" title="${escapeHTML(t.nip || '-')}">${escapeHTML(t.nip || '-')}</td>
                            <td class="px-2 py-2.5 max-w-[200px] whitespace-normal flex flex-wrap gap-1">${badgesHTML}</td>
                            <td class="px-2 py-2.5 text-center font-bold text-slate-600 dark:text-slate-400">${count} Bln</td>
                            <td class="px-2 py-2.5 font-bold text-slate-700 dark:text-slate-300">Rp ${iuranPokok.toLocaleString('id-ID')}</td>
                            <td class="px-2 py-2.5 font-bold text-rose-600 dark:text-rose-455">Rp ${totalDenda.toLocaleString('id-ID')}</td>
                            <td class="px-2 py-2.5 font-black text-slate-900 dark:text-white">Rp ${grandTotal.toLocaleString('id-ID')}</td>
                            <td class="px-2 py-2.5 text-center">
                                <button onclick="window.sendWaTunggakanSukaDuka('${t.id}', ${count}, '${unpaidMonths.map(item => item.label).join(', ')}', '${grandTotal.toLocaleString('id-ID')}', this)" 
                                        class="px-2 py-1 rounded bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/20 dark:text-green-400 dark:border-green-900/50 hover:bg-green-100 dark:hover:bg-green-950/40 transition-all font-bold text-[10px] flex items-center justify-center gap-1 mx-auto active:scale-95 w-full max-w-[80px]">
                                    <i class="fa-brands fa-whatsapp text-sm text-green-600 dark:text-green-400"></i> WA
                                </button>
                            </td>
                        </tr>
                    `;
                }
            });

            if (countTunggakanTotal === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" class="px-4 py-8 text-center text-green-600 dark:text-green-455 font-bold italic">
                            <i class="fa-solid fa-circle-check mr-1.5"></i> Luar biasa! Semua anggota bebas tunggakan pada tahun ${filterTahun}.
                        </td>
                    </tr>
                `;
            } else {
                tbody.innerHTML = reportHTML;
            }
        } catch (e) {
            console.error(e);
            tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-red-500">Gagal memproses rekap tunggakan.</td></tr>';
        }
    }
};

window.exportLaporanIuranExcel = async function() {
    const filterTahun = document.getElementById('laporan-tahun-filter').value;
    
    if (currentSubLaporanTab === 'pembayaran') {
        const filterBulan = document.getElementById('laporan-bulan-filter').value;
        const filterBulanTahun = `${filterTahun}-${filterBulan}`;

        try {
            const { data: iuranData, error } = await supabase
                .from('sukaduka_iuran')
                .select('*')
                .eq('bulan_tahun', filterBulanTahun);
                
            if (error) throw error;
            
            const paidGuruMap = {};
            (iuranData || []).forEach(i => {
                paidGuruMap[i.guru_id] = i;
            });

            const [targetYear, targetMonth] = filterBulanTahun.split('-').map(Number);
            const isVirtualPaidRange = (targetYear < 2026) || (targetYear === 2026 && targetMonth <= 5);

            const excelData = allTeachers.map((t, idx) => {
                const paymentRecord = paidGuruMap[t.id];
                
                let isLunas = false;
                if (paymentRecord) {
                    if (paymentRecord.jumlah > 0) {
                        isLunas = true;
                    } else if (paymentRecord.jumlah === 0) {
                        isLunas = false; // deleted manually
                    }
                } else {
                    if (isVirtualPaidRange) {
                        isLunas = true; // default lunas virtual
                    } else {
                        isLunas = false;
                    }
                }

                return {
                    'No': idx + 1,
                    'Nama Lengkap': t.name,
                    'NIP': t.nip || '-',
                    'Jabatan': t.jabatan || '-',
                    'Status Iuran': isLunas ? (paymentRecord ? 'LUNAS' : 'LUNAS (VIRTUAL)') : 'BELUM BAYAR',
                    'Tanggal Bayar': isLunas ? (paymentRecord ? paymentRecord.tanggal_bayar : '-') : '-',
                    'Nominal Bayar': isLunas ? parseFloat(paymentRecord ? paymentRecord.jumlah : nominalIuranDefault) : 0,
                    'Petugas': isLunas ? (paymentRecord ? (paymentRecord.created_by || 'Admin') : 'Sistem') : '-'
                };
            });

            const worksheet = XLSX.utils.json_to_sheet(excelData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Laporan Iuran");

            worksheet["!cols"] = Object.keys(excelData[0] || {}).map(k => ({ wch: 20 }));

            XLSX.writeFile(workbook, `laporan_iuran_sukaduka_${filterBulanTahun}.xlsx`);
            showSukaDukaToast('Berhasil', 'Laporan iuran berhasil diexport ke Excel.', 'success');
        } catch (e) {
            console.error(e);
            showSukaDukaToast('Gagal', 'Gagal export data.', 'error');
        }
    } else {
        try {
            // Ambil semua data iuran pada tahun terpilih
            const { data: iuranData, error } = await supabase
                .from('sukaduka_iuran')
                .select('*')
                .gte('bulan_tahun', `${filterTahun}-01`)
                .lte('bulan_tahun', `${filterTahun}-12`);
                
            if (error) throw error;

            const today = new Date();
            const currentYear = today.getFullYear();
            const currentMonth = today.getMonth() + 1; // 1-indexed
            
            let limitMonth = 12;
            const targetYear = parseInt(filterTahun);
            if (targetYear === currentYear) {
                limitMonth = currentMonth;
            } else if (targetYear > currentYear) {
                limitMonth = 0;
            }

            const monthNamesShort = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
            
            const guruIuranMap = {};
            (iuranData || []).forEach(i => {
                if (!guruIuranMap[i.guru_id]) guruIuranMap[i.guru_id] = [];
                guruIuranMap[i.guru_id].push(i);
            });

            const excelData = [];
            let index = 1;

            allTeachers.forEach(t => {
                const teacherTrxs = guruIuranMap[t.id] || [];
                const unpaidMonths = [];
                
                for (let m = 1; m <= limitMonth; m++) {
                    const mStr = String(m).padStart(2, '0');
                    const key = `${filterTahun}-${mStr}`;
                    const trx = teacherTrxs.find(tx => tx.bulan_tahun === key);
                    const isVirtualPaidRange = (targetYear < 2026) || (targetYear === 2026 && m <= 5);
                    
                    let isPaid = false;
                    if (trx) {
                        if (trx.jumlah > 0) {
                            isPaid = true;
                        } else if (trx.jumlah === 0) {
                            isPaid = false;
                        }
                    } else {
                        if (isVirtualPaidRange) {
                            isPaid = true;
                        } else {
                            isPaid = false;
                        }
                    }
                    
                    if (!isPaid) {
                        unpaidMonths.push({
                            monthNum: m,
                            label: `${monthNamesShort[m - 1]} ${filterTahun}`
                        });
                    }
                }

                if (unpaidMonths.length > 0) {
                    const count = unpaidMonths.length;
                    const iuranPokok = nominalIuranDefault * count;
                    
                    let lateMonthsCount = count;
                    if (targetYear === currentYear) {
                        const isCurrentMonthUnpaid = unpaidMonths.some(um => um.monthNum === currentMonth);
                        lateMonthsCount = isCurrentMonthUnpaid ? (count - 1) : count;
                    }
                    let totalDenda = 0;
                    if (dendaAktifDefault) {
                        const dendaCount = Math.floor(Math.max(0, lateMonthsCount) / dendaKelipatanBulanDefault);
                        totalDenda = dendaCount * dendaNominalDefault;
                    }
                    const grandTotal = iuranPokok + totalDenda;

                    excelData.push({
                        'No': index++,
                        'Nama Lengkap': t.name,
                        'NIP': t.nip || '-',
                        'Jabatan': t.jabatan || '-',
                        'Daftar Bulan Tunggakan': unpaidMonths.map(um => um.label).join(', '),
                        'Jumlah Bulan': count,
                        'Nominal Pokok': iuranPokok,
                        'Denda': totalDenda,
                        'Total Tagihan': grandTotal
                    });
                }
            });

            if (excelData.length === 0) {
                showSukaDukaToast('Info', 'Tidak ada data tunggakan untuk diexport pada tahun terpilih.', 'info');
                return;
            }

            const worksheet = XLSX.utils.json_to_sheet(excelData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Rekap Tunggakan");

            worksheet["!cols"] = Object.keys(excelData[0] || {}).map(k => {
                if (k === 'Daftar Bulan Tunggakan') return { wch: 35 };
                return { wch: 20 };
            });

            XLSX.writeFile(workbook, `rekap_tunggakan_sukaduka_${filterTahun}.xlsx`);
            showSukaDukaToast('Berhasil', 'Rekap tunggakan berhasil diexport ke Excel.', 'success');
        } catch (e) {
            console.error(e);
            showSukaDukaToast('Gagal', 'Gagal export data.', 'error');
        }
    }
};

// =========================================================================
// 9. CONFIGURATION SAVE: PENGATURAN NOMINASI
// =========================================================================
async function handleSaveConfig(e) {
    e.preventDefault();
    
    const nominalInput = getCleanNumber(document.getElementById('setting-nominal-iuran').value);
    const dendaAktifInput = document.getElementById('setting-denda-aktif').value;
    const dendaKelipatanInput = parseInt(document.getElementById('setting-denda-kelipatan').value) || 3;
    const dendaNominalInput = getCleanNumber(document.getElementById('setting-denda-nominal').value);
    
    if (nominalInput <= 0) {
        showSukaDukaToast('Error', 'Silakan masukkan nominal iuran yang valid.', 'error');
        return;
    }
    
    const primaryRole = localStorage.getItem('user_role') || 'guru_mapel';
    const isSuperAdmin = primaryRole === 'super_admin';
    
    if (isSuperAdmin) {
        if (dendaKelipatanInput <= 0) {
            showSukaDukaToast('Error', 'Silakan masukkan kelipatan bulan yang valid (minimal 1).', 'error');
            return;
        }
        if (dendaNominalInput < 0) {
            showSukaDukaToast('Error', 'Silakan masukkan nominal denda yang valid.', 'error');
            return;
        }
    }
    
    const btn = document.getElementById('btn-save-setting');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyimpan...';
    
    try {
        const configUpserts = [
            { key: 'nominal_iuran', value: String(nominalInput), updated_at: new Date() }
        ];
        
        if (isSuperAdmin) {
            configUpserts.push(
                { key: 'denda_aktif', value: String(dendaAktifInput), updated_at: new Date() },
                { key: 'denda_kelipatan_bulan', value: String(dendaKelipatanInput), updated_at: new Date() },
                { key: 'denda_nominal', value: String(dendaNominalInput), updated_at: new Date() }
            );
        }
        
        // Simpan konfigurasi via Edge Function secure proxy
        await callSecureEdgeFunction('sukaduka-update-config', configUpserts);
        
        showSukaDukaToast('Berhasil', 'Pengaturan berhasil disimpan!', 'success');
        
        // Muat ulang konfigurasi default
        await loadConfig();
        
    } catch (e) {
        console.error(e);
        showSukaDukaToast('Gagal', e.message || 'Gagal menyimpan pengaturan.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// =========================================================================
// 10. REUSABLE DELETE LOGIC (KAS & IURAN)
// =========================================================================
window.requestDeleteTransaction = function(id, type) {
    pendingDeleteId = id;
    pendingDeleteType = type;
    
    document.getElementById('delete-confirm-input').value = '';
    document.getElementById('modal-delete-suka-duka').classList.remove('hidden');
};

window.closeDeleteModal = function() {
    document.getElementById('modal-delete-suka-duka').classList.add('hidden');
    pendingDeleteId = null;
    pendingDeleteType = '';
};

async function executeDeleteTransaction() {
    const input = document.getElementById('delete-confirm-input').value.trim();
    if (input !== 'HAPUS') {
        showSukaDukaToast('Error', 'Silakan ketik kata HAPUS untuk konfirmasi penghapusan.', 'error');
        return;
    }
    
    const btn = document.getElementById('btn-confirm-delete');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = 'Menghapus...';
    
    try {
        const creator = auth.currentUser.displayName || auth.currentUser.email;
        await callSecureEdgeFunction('sukaduka-hapus-tx', {
            id: pendingDeleteId,
            type: pendingDeleteType,
            year: pendingDeleteYear,
            month: pendingDeleteMonth,
            guru_id: currentSelectedGuru ? currentSelectedGuru.id : null,
            anggota_nama: currentSelectedGuru ? currentSelectedGuru.name : null,
            anggota_nip: currentSelectedGuru ? (currentSelectedGuru.nip || null) : null,
            creator: creator
        });
        
        showSukaDukaToast('Berhasil', 'Transaksi berhasil dihapus secara permanen.', 'success');
        closeDeleteModal();
        
        // Refresh data di semua tab
        await refreshDashboardStats();
        await refreshRecentPayments();
        
        // Refresh kartu digital guru terpilih jika aktif
        if (currentSelectedGuru) {
            await loadTeacherPaymentHistory(currentSelectedGuru.id);
            renderSukaDukaGrid(displayYear);
            updateCalculationUI();
        }
        
        if (typeof window.refreshBukuKas === 'function') await window.refreshBukuKas();
        if (typeof window.refreshLaporanIuran === 'function') await window.refreshLaporanIuran();
        
    } catch (e) {
        console.error(e);
        showSukaDukaToast('Gagal', e.message || 'Gagal menghapus transaksi.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
}

// =========================================================================
// 10A. LOGIKA TEMPLATE & AUTCOMPLETE MUTASI KAS SANTUNAN (AD-ART 2025)
// =========================================================================

// Mengatur tampilan template & pencarian guru saat jenis mutasi berubah
window.handleMutasiTipeChange = function() {
    const tipe = document.getElementById('mutasi-tipe').value;
    const wrapperTemplate = document.getElementById('wrapper-santunan-template');
    const wrapperGuru = document.getElementById('wrapper-mutasi-guru');
    const kategoriInput = document.getElementById('mutasi-kategori');
    
    if (tipe === 'keluar') {
        wrapperTemplate.classList.remove('hidden');
        wrapperGuru.classList.remove('hidden');
        kategoriInput.value = 'lain_lain';
    } else {
        wrapperTemplate.classList.add('hidden');
        wrapperGuru.classList.add('hidden');
        kategoriInput.value = 'donasi';
        document.getElementById('mutasi-amount').value = '';
        document.getElementById('mutasi-keterangan').value = '';
        document.getElementById('mutasi-santunan-template').value = '';
        window.clearMutasiGuruSearch();
    }
};

// Autocomplete Guru Penerima di Mutasi Kas
function setupMutasiGuruAutocomplete() {
    const searchInput = document.getElementById('mutasi-guru-search');
    const dropdown = document.getElementById('mutasi-guru-dropdown');
    const list = document.getElementById('mutasi-guru-list');
    
    if (!searchInput) return;
    
    // Fungsi bantu render list guru penerima mutasi
    const renderMutasiTeacherDropdown = (val) => {
        const filtered = val
            ? allTeachers.filter(t => t.name.toLowerCase().includes(val) || (t.nip && t.nip.includes(val)))
            : allTeachers;
            
        if (filtered.length === 0) {
            list.innerHTML = `<li class="p-2 text-xs italic text-slate-400 dark:text-slate-500 text-center">Guru tidak ditemukan</li>`;
        } else {
            list.innerHTML = filtered.map(t => {
                const avatarMini = renderTeacherAvatarHTML(t, 'w-6 h-6', 'rounded-full');
                return `
                    <li onclick="selectGuruForMutasi('${t.id}', '${window.escapeJSString(t.name)}')" 
                        class="p-2 hover:bg-indigo-50/70 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-350 cursor-pointer transition-colors flex items-center gap-2.5">
                        ${avatarMini}
                        <div class="min-w-0">
                            <div class="truncate leading-tight text-slate-800 dark:text-white">${escapeHTML(t.name)}</div>
                            <div class="text-[9px] text-slate-400 dark:text-slate-500 font-mono font-normal">NIP: ${escapeHTML(t.nip || '-')}</div>
                        </div>
                    </li>
                `;
            }).join('');
        }
        dropdown.classList.remove('hidden');
    };
    
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        if (val.length === 0) {
            window.clearMutasiGuruSearch();
            renderMutasiTeacherDropdown(''); // Tampilkan semua jika kosong
            return;
        }
        renderMutasiTeacherDropdown(val);
    });

    searchInput.addEventListener('focus', () => {
        const val = searchInput.value.toLowerCase().trim();
        renderMutasiTeacherDropdown(val);
    });

    searchInput.addEventListener('click', () => {
        const val = searchInput.value.toLowerCase().trim();
        renderMutasiTeacherDropdown(val);
    });
    
    document.addEventListener('click', (e) => {
        if (e.target !== searchInput && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });
}

window.selectGuruForMutasi = function(id, name) {
    document.getElementById('mutasi-guru-search').value = name;
    document.getElementById('selected-mutasi-guru-id').value = id;
    document.getElementById('selected-mutasi-guru-name').value = name;
    document.getElementById('mutasi-guru-dropdown').classList.add('hidden');
    
    // Perbarui keterangan otomatis
    updateKeteranganMutasiOtomatis();
};

window.clearMutasiGuruSearch = function() {
    const input = document.getElementById('mutasi-guru-search');
    if (input) input.value = '';
    document.getElementById('selected-mutasi-guru-id').value = '';
    document.getElementById('selected-mutasi-guru-name').value = '';
    const dropdown = document.getElementById('mutasi-guru-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
    
    updateKeteranganMutasiOtomatis();
};

// Mengubah nominal dan keterangan mutasi berdasarkan template santunan (AD-ART 2025)
window.handleSantunanTemplateChange = function() {
    const template = document.getElementById('mutasi-santunan-template').value;
    const amountInput = document.getElementById('mutasi-amount');
    const kategoriInput = document.getElementById('mutasi-kategori');
    
    const templates = {
        'nikah': { amount: 1000000, kategori: 'santunan_nikah' },
        'lahir': { amount: 750000, kategori: 'santunan_kelahiran' },
        'potong_gigi': { amount: 750000, kategori: 'santunan_potong_gigi' },
        'upacara_agama': { amount: 750000, kategori: 'santunan_upacara_agama' },
        'ngupasaksi': { amount: 500000, kategori: 'santunan_ngupasaksi' },
        'sakit_anggota': { amount: 1000000, kategori: 'santunan_sakit' },
        'sakit_keluarga': { amount: 750000, kategori: 'santunan_sakit' },
        'kematian_anggota': { amount: 1000000, kategori: 'santunan_duka' },
        'kematian_keluarga': { amount: 750000, kategori: 'santunan_duka' },
        'pensiun': { amount: 1000000, kategori: 'santunan_pensiun' }
    };
    
    if (templates[template]) {
        amountInput.value = templates[template].amount.toLocaleString('id-ID');
        kategoriInput.value = templates[template].kategori;
    } else {
        amountInput.value = '';
        kategoriInput.value = 'lain_lain';
    }
    
    updateKeteranganMutasiOtomatis();
};

// Generate Keterangan Mutasi Otomatis
function updateKeteranganMutasiOtomatis() {
    const templateSelect = document.getElementById('mutasi-santunan-template');
    const teacherName = document.getElementById('selected-mutasi-guru-name').value;
    const keteranganInput = document.getElementById('mutasi-keterangan');
    
    if (!templateSelect) return;
    
    const templateText = templateSelect.options[templateSelect.selectedIndex]?.text.split('(')[0].trim();
    const templateVal = templateSelect.value;
    
    if (!templateVal || templateVal === 'kustom') {
        keteranganInput.value = '';
        return;
    }
    
    let text = `Santunan ${templateText}`;
    if (teacherName) {
        text += ` Penerima: ${teacherName}`;
    }
    
    keteranganInput.value = text;
}

// =========================================================================
// 11. HELPERS & ALERTS
// =========================================================================

// Escape HTML Strings Helper
function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Escape JS String (untuk inline onclick)
window.escapeJSString = function(str) {
    if (!str) return '';
    return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
};

// Tanggal Indonesia Helper (DD-MM-YYYY)
function formatDateIndo(dateStr) {
    if (!dateStr) return '';
    try {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            return `${parts[2]}-${parts[1]}-${parts[0]}`; // DD-MM-YYYY
        }
        return dateStr;
    } catch (e) { return dateStr; }
}

// Custom Toast Notification SIMAS Style
function showSukaDukaToast(title, msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toastBox = document.getElementById('toast-box');
    const toastIcon = document.getElementById('toast-icon');
    const toastTitle = document.getElementById('toast-title');
    const toastMsg = document.getElementById('toast-message');
    
    if (!container || !toastBox) return;
    
    // Tipe warna & icon
    if (type === 'success') {
        toastIcon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
        toastIcon.className = 'text-green-400 text-xl';
    } else {
        toastIcon.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i>';
        toastIcon.className = 'text-red-400 text-xl';
    }
    
    toastTitle.innerText = title;
    toastMsg.innerText = msg;
    
    // Tampilkan
    container.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
    container.classList.add('translate-y-0', 'opacity-100');
    
    // Auto sembunyikan setelah 3.5 detik
    setTimeout(() => {
        container.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
        container.classList.remove('translate-y-0', 'opacity-100');
    }, 3500);
}

// =========================================================================
// 12. HELPER FORMATTING RUPIAH & KAS AWAL MIGRASI
// =========================================================================

// Format string angka menjadi format ribuan dengan titik
function formatRupiahInput(value) {
    const clean = value.replace(/\D/g, "");
    if (!clean) return "";
    return parseInt(clean, 10).toLocaleString("id-ID");
}

// Ambil nilai numerik murni dari input rupiah
function getCleanNumber(value) {
    const clean = value.replace(/\D/g, "");
    return clean ? parseInt(clean, 10) : 0;
}

// Inisialisasi auto-formatting rupiah pada semua input nominal
function setupRupiahFormatters() {
    const inputs = ['mutasi-amount', 'setting-nominal-iuran', 'setting-kas-awal', 'setting-denda-nominal'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        
        el.addEventListener('input', (e) => {
            const cursorPosition = e.target.selectionStart;
            const originalLength = e.target.value.length;
            
            const formatted = formatRupiahInput(e.target.value);
            e.target.value = formatted;
            
            const newLength = formatted.length;
            const pos = cursorPosition + (newLength - originalLength);
            e.target.setSelectionRange(pos, pos);
        });
    });
}

// Memuat nominal kas awal (migrasi) terdaftar di database
async function loadKasAwalSetting() {
    const inputEl = document.getElementById('setting-kas-awal');
    if (!inputEl) return;
    
    try {
        const { data, error } = await supabase
            .from('sukaduka_kas')
            .select('jumlah')
            .eq('kategori', 'kas_awal')
            .maybeSingle();
            
        if (error) throw error;
        if (data) {
            inputEl.value = parseFloat(data.jumlah).toLocaleString('id-ID');
        }
    } catch (e) {
        console.error('[Suka-Duka] Gagal memuat kas awal:', e);
    }
}

// Menyimpan/mengubah kas awal migrasi
async function handleSaveKasAwal(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-kas-awal');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Menyimpan...';
    
    try {
        const nominal = getCleanNumber(document.getElementById('setting-kas-awal').value);
        if (nominal < 0) {
            throw new Error('Nominal kas awal tidak boleh kurang dari 0.');
        }
        
        const creator = auth.currentUser.displayName || auth.currentUser.email;
        
        // Simpan kas awal via Edge Function Secure Proxy (mematuhi RLS Supabase)
        await callSecureEdgeFunction('sukaduka-save-kas-awal', {
            nominal: nominal,
            creator: creator
        });
        
        showSukaDukaToast('Berhasil', 'Saldo kas awal berhasil disimpan.', 'success');
        
        // Refresh statistik global
        await refreshDashboardStats();
        if (typeof window.refreshBukuKas === 'function') await window.refreshBukuKas();
        
    } catch (err) {
        console.error(err);
        showSukaDukaToast('Gagal', err.message || 'Gagal menyimpan kas awal.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// =========================================================================
// 12. KIRIM PENGINGAT TUNGGAKAN SUKA-DUKA TRI-CHANNEL (WA + PUSH + TELEGRAM)
// =========================================================================
window.sendWaTunggakanSukaDuka = async function(teacherId, totalUnpaidMonths, unpaidMonthsListText, grandTotalText, btnEl) {
    const teacher = allTeachers.find(t => t.id === teacherId);
    if (!teacher) {
        showSukaDukaToast("Gagal", "Data guru/pegawai tidak ditemukan.", "error");
        return;
    }

    // Buat isi pesan WA pengingat terlebih dahulu karena akan dipakai baik otomatis maupun manual
    const message = 
        `*Informasi Rekapitulasi Kas Suka-Duka*\n\n` +
        `Yth. Bapak/Ibu *${teacher.name}*,\n\n` +
        `Diberitahukan informasi rekapitulasi partisipasi Kas Suka-Duka atas nama Anda dengan rincian berikut:\n\n` +
        `• *NIP*: ${teacher.nip || '-'}\n` +
        `• *Periode Belum Terbayar*: ${totalUnpaidMonths} Bulan\n` +
        `• *Daftar Bulan*: ${unpaidMonthsListText}\n` +
        `• *Estimasi Total Partisipasi*: *Rp ${grandTotalText}*\n\n` +
        `Mohon dapat berkoordinasi atau melakukan penyelesaian melalui petugas Kasir Suka-Duka Sekolah. Terima kasih atas kerja samanya.\n\n` +
        `_Catatan: Harap simpan nomor ini agar pemberitahuan sekolah terkirim lancar._\n\n` +
        `> _${SCHOOL_CONFIG.appBrand}_`;

    // Pesan HTML resmi untuk Telegram Bot
    const tgMessage = 
        `💰 <b>[REKAPITULASI IURAN KAS SUKA-DUKA]</b>\n\n` +
        `Yth. Bapak/Ibu <b>${escapeHTML(teacher.name)}</b>,\n\n` +
        `Diberitahukan informasi rekapitulasi partisipasi Kas Suka-Duka atas nama Anda dengan rincian berikut:\n\n` +
        `• <b>NIP:</b> ${escapeHTML(teacher.nip || '-')}\n` +
        `• <b>Periode Belum Terbayar:</b> ${totalUnpaidMonths} Bulan\n` +
        `• <b>Daftar Bulan:</b> ${escapeHTML(unpaidMonthsListText)}\n` +
        `• <b>Estimasi Total Partisipasi:</b> <b>Rp ${escapeHTML(grandTotalText)}</b>\n\n` +
        `Mohon dapat berkoordinasi atau melakukan penyelesaian melalui petugas Kasir Suka-Duka Sekolah. Terima kasih atas kerja samanya.\n\n` +
        `🔗 <a href="${(typeof window !== 'undefined' && window.location?.origin && window.location.origin.startsWith('http')) ? window.location.origin : `https://${SCHOOL_CONFIG.primaryDomain || "simas-demo-5ead3.web.app"}`}/sukaduka/suka-duka.html">Buka Kas Suka-Duka</a>\n\n` +
        `> <i>${escapeHTML(SCHOOL_CONFIG.appBrand)}</i>`;

    let phone = teacher.phone || "";

    // Helper background dispatch: Tri-Channel (Push Notification FCM & Telegram Bot)
    const triggerTriChannelBackground = () => {
        setTimeout(async () => {
            try {
                const targetRecipient = teacher.linkedUserId || teacher.uid || teacher.id || phone;
                const telegramChatId = teacher.telegramChatId || teacher.telegram_chat_id || "";

                // 1. Web Push Notification (FCM D1)
                if (targetRecipient && cfClient && typeof cfClient.sendPushNotification === 'function') {
                    await cfClient.sendPushNotification({
                        title: "💰 Informasi Kas Suka-Duka",
                        body: `Yth. ${teacher.name}, terdapat rekapitulasi iuran Suka-Duka (${totalUnpaidMonths} bulan, Rp ${grandTotalText}). Mohon cek di menu Suka-Duka.`,
                        url: "./sukaduka/suka-duka.html",
                        targetType: "user",
                        targetValue: targetRecipient,
                        sendTelegram: !telegramChatId
                    }).catch(e => console.warn("[Suka-Duka Push Warn]", e.message));
                }

                // 2. Telegram Bot Langsung jika Chat ID tersedia
                if (telegramChatId && cfClient && typeof cfClient.sendTelegramNotification === 'function') {
                    await cfClient.sendTelegramNotification({
                        chatId: telegramChatId,
                        message: tgMessage,
                        parseMode: "HTML"
                    }).catch(e => console.warn("[Suka-Duka Telegram Warn]", e.message));
                }
            } catch (triErr) {
                console.warn("[Suka-Duka Tri-Channel Warning]", triErr.message);
            }
        }, 0);
    };

    // Jika belum memiliki nomor WA di database, arahkan kirim manual (pilih kontak di WA)
    if (!phone) {
        showSukaDukaToast("Info", "Nomor WA tidak terdaftar. Mengalihkan ke WhatsApp untuk memilih kontak secara manual serta mengirimkan Push & Telegram.", "info");

        // Picu Push Notification & Telegram di background
        triggerTriChannelBackground();

        // Arahkan ke WhatsApp manual (tanpa parameter phone agar admin memilih kontak secara manual di WA)
        const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
        window.open(waUrl, "_blank");

        // Tandai tombol sebagai terkirim secara visual agar admin tahu
        btnEl.innerHTML = '<i class="fa-solid fa-check text-green-600"></i> Terkirim';
        btnEl.classList.remove('bg-green-50', 'text-green-700', 'border-green-200');
        btnEl.classList.add('bg-slate-100', 'text-slate-500', 'border-slate-350');
        return;
    }

    // Format target phone (hilangkan non-digit dan ganti prefix 0 ke 62)
    phone = phone.replace(/[^0-9]/g, "");
    if (phone.startsWith("0")) {
        phone = "62" + phone.substring(1);
    }

    // Disable tombol sementara untuk feedback loading
    const originalContent = btnEl.innerHTML;
    btnEl.disabled = true;
    btnEl.style.pointerEvents = 'none';
    btnEl.style.opacity = '0.7';
    btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Memeriksa...';

    try {
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Mengirim...';

        const result = await cfClient.sendWaNotification({
            phone,
            message,
            category: 'suka_duka',
            targetName: teacher.name || '',
            dedupeKey: `suka_duka:${teacher.id || phone}`,
            cooldownHours: 24 * 7
        });

        // Picu Push Notification & Telegram secara asinkronus (Tri-Channel terpadu)
        triggerTriChannelBackground();

        const channelInfo = (teacher.telegramChatId || teacher.telegram_chat_id) ? " (WA + Telegram + Web Push)" : " (WA + Web Push)";
        showSukaDukaToast(
            result.skipped ? "Info" : "Berhasil",
            result.skipped ? `Pengingat WA untuk ${teacher.name} masih dalam masa jeda 1 minggu.${channelInfo}` : `Pengingat untuk ${teacher.name} berhasil dikirim${channelInfo}.`,
            result.skipped ? "warning" : "success"
        );

        // Tandai tombol sebagai terkirim
        btnEl.innerHTML = '<i class="fa-solid fa-check text-green-600"></i> Terkirim';
        btnEl.classList.remove('bg-green-50', 'text-green-700', 'border-green-200');
        btnEl.classList.add('bg-slate-100', 'text-slate-500', 'border-slate-350');
    } catch (error) {
        console.error("Error sending Suka-Duka Reminder:", error);
        showSukaDukaToast("Gagal", `Gagal mengirim pengingat: ${error.message}`, "error");

        // Reset tombol jika gagal
        btnEl.disabled = false;
        btnEl.style.pointerEvents = 'auto';
        btnEl.style.opacity = '1';
        btnEl.innerHTML = originalContent;
    }
};

// =========================================================================
// FILTER ARUS KAS: HANDLER TAHUN & BULAN
// =========================================================================
window.handleKasYearFilterChange = function() {
    if (typeof window.refreshBukuKas === 'function') window.refreshBukuKas();
};

window.handleKasMonthFilterChange = function() {
    if (typeof window.refreshBukuKas === 'function') window.refreshBukuKas();
};

// =========================================================================
// TUTUP BUKU SUKA-DUKA: WIZARD LOGIC
// =========================================================================
let _closingWizardData = { year: 0, totalIncome: 0, totalExpense: 0, saldoAkhir: 0 };

// Ambil seluruh baris kas (paginasi) agar total tidak terpotong limit 1000 baris PostgREST
async function fetchSukaDukaKasRows(buildQueryFn, selectFields = 'id, tipe, jumlah') {
    const { data, error } = await window.fetchAllSupabaseRows(
        supabase,
        'sukaduka_kas',
        q => buildQueryFn(q).order('id', { ascending: true }),
        { selectFields }
    );
    return { data: data || [], error };
}

// Menentukan tahun buku berikutnya yang wajib ditutup (berurutan, tanpa melompati tahun)
async function getNextSukaDukaClosingYear() {
    if (closedYearsList.length > 0) {
        return Math.max(...closedYearsList.map(Number)) + 1;
    }
    // Belum pernah tutup buku: mulai dari tahun transaksi kas paling awal
    const { data, error } = await supabase
        .from('sukaduka_kas')
        .select('tanggal')
        .order('tanggal', { ascending: true })
        .limit(1);
    if (error) throw error;
    const earliestYear = data && data[0] && data[0].tanggal ? parseInt(String(data[0].tanggal).substring(0, 4), 10) : NaN;
    return Number.isInteger(earliestYear) ? earliestYear : new Date().getFullYear() - 1;
}

window.openSukaDukaClosingWizard = async function() {
    try {
        // Muat ulang status closing agar tidak memakai data usang (misal ditutup dari perangkat lain)
        await loadClosingsData();

        const now = new Date();
        const currentYear = now.getFullYear();
        const targetYear = await getNextSukaDukaClosingYear();

        // Tahun buku berjalan baru bisa ditutup mulai 1 Desember (tahun lalu yang belum ditutup bisa kapan saja)
        const isClosingWindowOpen = targetYear < currentYear || (targetYear === currentYear && now.getMonth() === 11);
        if (!isClosingWindowOpen) {
            showSukaDukaToast('Info', `Tahun buku ${targetYear} baru dapat ditutup mulai 1 Desember ${targetYear}.`, 'warning');
            return;
        }

        // Hitung ringkasan keuangan tahun yang akan ditutup (paginasi + satuan sen agar presisi)
        const { data, error } = await fetchSukaDukaKasRows(q => q
            .gte('tanggal', `${targetYear}-01-01`)
            .lte('tanggal', `${targetYear}-12-31`));
        if (error) throw error;

        let incomeCents = 0;
        let expenseCents = 0;
        data.forEach(kas => {
            const cents = Math.round((parseFloat(kas.jumlah) || 0) * 100);
            if (kas.tipe === 'masuk') incomeCents += cents;
            else if (kas.tipe === 'keluar') expenseCents += cents;
        });

        // Saldo awal = saldo akhir tutup buku tahun sebelumnya (0 jika ini tahun buku pertama)
        const prevClosing = closingDataMap[targetYear - 1];
        const saldoAwalCents = prevClosing ? Math.round((parseFloat(prevClosing.saldo_akhir) || 0) * 100) : 0;
        const saldoAkhirCents = saldoAwalCents + incomeCents - expenseCents;

        const totalIncome = incomeCents / 100;
        const totalExpense = expenseCents / 100;
        const saldoAwal = saldoAwalCents / 100;
        const saldoAkhir = saldoAkhirCents / 100;

        _closingWizardData = {
            year: targetYear,
            totalIncome,
            totalExpense,
            saldoAkhir,
            saldoAwal
        };

        // Populate UI
        document.getElementById('closing-year-label').textContent = targetYear;
        document.getElementById('closing-year-label-confirm').textContent = targetYear;
        document.getElementById('closing-total-income').textContent = 'Rp ' + totalIncome.toLocaleString('id-ID');
        document.getElementById('closing-total-expense').textContent = 'Rp ' + totalExpense.toLocaleString('id-ID');
        document.getElementById('closing-saldo-akhir').textContent = 'Rp ' + saldoAkhir.toLocaleString('id-ID');

        // Reset wizard ke step 1
        window.nextSukaDukaClosingStep(1);

        // Reset confirmation input
        const confirmInput = document.getElementById('closing-confirm-input');
        if (confirmInput) confirmInput.value = '';
        const executeBtn = document.getElementById('btn-execute-closing-sukaduka');
        if (executeBtn) executeBtn.disabled = true;

        // Show modal
        document.getElementById('modal-closing-wizard-sukaduka').classList.remove('hidden');

    } catch (e) {
        console.error('[Suka-Duka] Gagal membuka wizard tutup buku:', e);
        showSukaDukaToast('Gagal', 'Gagal menghitung ringkasan tutup buku: ' + e.message, 'error');
    }
};

window.closeSukaDukaClosingWizard = function() {
    document.getElementById('modal-closing-wizard-sukaduka').classList.add('hidden');
};

window.nextSukaDukaClosingStep = function(step) {
    // Show/hide steps
    for (let i = 1; i <= 3; i++) {
        const stepEl = document.getElementById(`closing-step-${i}`);
        const indEl = document.getElementById(`closing-step-ind-${i}`);
        if (stepEl) {
            stepEl.classList.toggle('hidden', i !== step);
        }
        if (indEl) {
            if (i <= step) {
                indEl.className = 'w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs font-bold';
            } else {
                indEl.className = 'w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-400 flex items-center justify-center text-xs font-bold';
            }
        }
    }

    // Setup confirmation input listener pada step 3
    if (step === 3) {
        const confirmInput = document.getElementById('closing-confirm-input');
        const executeBtn = document.getElementById('btn-execute-closing-sukaduka');

        // Remove old listener if exists
        if (confirmInput._closingHandler) {
            confirmInput.removeEventListener('input', confirmInput._closingHandler);
        }

        // Create and store new handler
        const handler = () => {
            const val = confirmInput.value.trim().toUpperCase();
            executeBtn.disabled = val !== 'TUTUP BUKU';
        };
        confirmInput._closingHandler = handler;
        confirmInput.addEventListener('input', handler);
    }
};

window.executeSukaDukaYearEndClosing = async function() {
    const confirmInput = document.getElementById('closing-confirm-input');
    if (!confirmInput || confirmInput.value.trim().toUpperCase() !== 'TUTUP BUKU') {
        showSukaDukaToast('Peringatan', 'Ketik TUTUP BUKU untuk konfirmasi.', 'warning');
        return;
    }

    const executeBtn = document.getElementById('btn-execute-closing-sukaduka');
    const originalText = executeBtn.innerHTML;
    executeBtn.disabled = true;
    executeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Memproses...';

    try {
        const { year, saldoAkhir, totalIncome, totalExpense, saldoAwal } = _closingWizardData;
        const creator = auth.currentUser?.displayName || auth.currentUser?.email || 'Admin';

        // Kirim ke Edge Function
        await callSecureEdgeFunction('sukaduka-tutup-buku', {
            year,
            saldo_akhir: saldoAkhir,
            total_income: totalIncome,
            total_expense: totalExpense,
            closed_by: creator,
            summary: {
                saldo_awal: saldoAwal,
                total_income: totalIncome,
                total_expense: totalExpense,
                saldo_akhir: saldoAkhir,
                closed_at: new Date().toISOString()
            }
        });

        showSukaDukaToast('Berhasil', `Tahun buku ${year} berhasil ditutup!`, 'success');

        // Reload closings data
        await loadClosingsData();
        await refreshDashboardStats();

        // Close modal
        window.closeSukaDukaClosingWizard();

        // Refresh buku kas jika sedang di tab kas
        if (typeof window.refreshBukuKas === 'function') {
            await window.refreshBukuKas();
        }

    } catch (e) {
        console.error('[Suka-Duka] Gagal tutup buku:', e);
        showSukaDukaToast('Gagal', 'Gagal menutup buku: ' + (e.message || 'Terjadi kesalahan'), 'error');
    } finally {
        executeBtn.disabled = false;
        executeBtn.innerHTML = originalText;
    }
};
