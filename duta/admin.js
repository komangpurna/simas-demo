/* duta/admin.js - Logika Pemilihan Duta SHAKTI 2026 */
import { db, PATHS, supabase } from '../js/config.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { callSecureEdgeFunction } from '../js/global.js';

// =========================================================================
// 1. SUPABASE CONFIGURATION (SSOT INSTANCE)
// =========================================================================

// =========================================================================
// 1A. MANAGING VOTING STATUS (Firestore-based Config)
// =========================================================================
async function loadVotingStatus() {
    const toggleEl = document.getElementById('toggle-duta-voting');
    const statusEl = document.getElementById('status-duta-voting');
    if (!toggleEl) return;

    try {
        const snap = await getDoc(doc(db, PATHS.settings, 'system_config'));
        if (snap.exists()) {
            const data = snap.data();
            const isActive = data.dutaVoting || false;

            toggleEl.checked = isActive;
            if (statusEl) {
                statusEl.innerText = isActive ? 'Aktif' : 'Nonaktif';
                statusEl.className = `text-[9px] font-black uppercase ${isActive ? 'text-purple-600' : 'text-slate-400'}`;
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

        // Hapus cache lokal SIMAS agar pembaruan langsung terlihat di portal siswa
        sessionStorage.removeItem('session_portal_config');

        if (statusEl) {
            statusEl.innerText = isActive ? 'Aktif' : 'Nonaktif';
            statusEl.className = `text-[9px] font-black uppercase ${isActive ? 'text-purple-600' : 'text-slate-400'}`;
        }
        showAdminToast(`Status Voting Duta berhasil diubah menjadi ${isActive ? 'AKTIF' : 'NONAKTIF'}`, 'success');
    } catch (e) {
        console.error('[Duta Admin] Gagal menyimpan status voting:', e);
        showAdminToast('Gagal mengubah status voting: ' + e.message, 'error');
    }
}

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
        window.location.replace('../index.html?redirect=' + redirectTarget);
        return false;
    }
    return true;
}

// =========================================================================
// 3. INTERNAL STATE & APP INITIALIZATION
// =========================================================================
const categories = ['Sehat', 'Humanis', 'Agamais', 'Kreatif', 'Trampil', 'Inovatif'];

let activeAdminTab = 'nominasi';
let candidatesList = [];
let votesList = [];

// Inisialisasi Supabase (SSOT)
function initSupabase() {
    return !!supabase;
}

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
            hasMore = false;
        } else {
            from += PAGE_SIZE;
        }
    }

    return { data: allData, error: null };
}

// =========================================================================
// 4. TAB NAVIGATION
// =========================================================================
window.switchAdminTab = function (tab) {
    if (activeAdminTab === tab) return;
    activeAdminTab = tab;

    const tabs = ['nominasi', 'hasil', 'pemenang'];
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
    } else if (tab === 'pemenang') {
        loadWinnerStageConfig();
    }
};

// =========================================================================
// 5. CRUD NOMINASI (Kelola Kandidat Duta)
// =========================================================================

// Load daftar kandidat dari Supabase
async function loadCandidates() {
    const listEl = document.getElementById('nominees-list');
    const countEl = document.getElementById('nominees-count');
    if (!listEl) return;

    try {
        const { data, error } = await supabase
            .from('duta_kandidat')
            .select('*')
            .order('kategori', { ascending: true })
            .order('nama', { ascending: true });

        if (error) throw error;
        candidatesList = data || [];

        if (countEl) countEl.innerText = `${candidatesList.length} Nominasi`;

        if (candidatesList.length === 0) {
            listEl.innerHTML = `
                <div class="text-center py-12 text-slate-400 text-xs italic">
                    Belum ada nominasi terdaftar. Tambahkan nominasi baru di form sebelah kiri.
                </div>
            `;
            return;
        }

        listEl.innerHTML = candidatesList.map((c, idx) => {
            const photoUrl = c.foto_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&h=80';
            
            // Warna kategori bagde
            const categoryColors = {
                'Sehat': 'bg-rose-50 text-rose-700 border-rose-100',
                'Humanis': 'bg-blue-50 text-blue-700 border-blue-100',
                'Agamais': 'bg-emerald-50 text-emerald-700 border-emerald-100',
                'Kreatif': 'bg-amber-50 text-amber-700 border-amber-100',
                'Trampil': 'bg-indigo-50 text-indigo-700 border-indigo-100',
                'Inovatif': 'bg-purple-50 text-purple-700 border-purple-100'
            };
            const badgeClass = categoryColors[c.kategori] || 'bg-slate-50 text-slate-700';

            return `
                <div class="flex items-center justify-between p-3.5 bg-slate-50 hover:bg-slate-100/70 border border-slate-100 rounded-2xl transition-all duration-300 group">
                    <div class="flex items-center gap-3 min-w-0">
                        <img src="${photoUrl}" alt="${c.nama}" class="w-10 h-10 rounded-xl object-cover border border-slate-200 shrink-0">
                        <div class="min-w-0">
                            <h4 class="font-bold text-slate-800 text-xs truncate leading-tight">${c.nama}</h4>
                            <div class="flex items-center gap-1.5 mt-1 text-[9px] font-bold">
                                <span class="px-2 py-0.5 rounded border uppercase tracking-wider ${badgeClass}">Duta ${c.kategori}</span>
                                ${c.video_url ? '<span class="text-rose-500 font-extrabold flex items-center gap-0.5"><i class="fa-solid fa-circle-play"></i> Video Ada</span>' : ''}
                            </div>
                        </div>
                    </div>
                    <div class="flex gap-1 shrink-0 ml-2">
                        <button onclick="window.editNominee('${c.id}')" 
                            class="p-2 hover:bg-purple-100 rounded-lg text-purple-600 hover:text-purple-700 text-xs transition-colors" title="Edit Nominasi">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button onclick="window.deleteNominee('${c.id}', '${window.escapeJSString(c.nama)}')" 
                            class="p-2 hover:bg-red-100 rounded-lg text-red-600 hover:text-red-700 text-xs transition-colors" title="Hapus Nominasi">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) {
        console.error('[Duta Admin] Gagal memuat nominasi:', e);
        listEl.innerHTML = `<div class="text-center py-12 text-red-500 text-xs font-bold">Gagal memuat: ${e.message}</div>`;
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
    document.getElementById('form-title').innerHTML = `<i class="fa-solid fa-user-plus text-purple-600"></i> Tambah Nominasi Siswa`;
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

    const btnSubmit = document.getElementById('btn-submit');
    const originalText = btnSubmit.innerText;
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin mr-1"></i> Menyimpan...`;

    try {
        // Simpan nominasi via Edge Function secure proxy
        await callSecureEdgeFunction('duta-kandidat-save', {
            id: id || null,
            nama,
            kategori,
            foto_url,
            video_url
        });
        showAdminToast(id ? `Berhasil mengubah nominasi "${nama}"` : `Berhasil menambahkan nominasi "${nama}"`, 'success');

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
    const ok = typeof window.showConfirmModal === 'function'
        ? await window.showConfirmModal(`Apakah Anda yakin ingin menghapus nominasi "${nama}" secara permanen? Semua suara masuk terkait kandidat ini juga akan ikut terhapus.`, 'Hapus Nominasi', 'danger')
        : true;
    if (!ok) return;

    try {
        // Hapus nominasi via Edge Function secure proxy
        await callSecureEdgeFunction('duta-kandidat-delete', { id });
        
        showAdminToast(`Berhasil menghapus nominasi "${nama}"`, 'success');
        await loadCandidates();

    } catch (err) {
        console.error('[Duta Admin] Gagal menghapus:', err);
        showAdminToast('Gagal menghapus: ' + err.message, 'error');
    }
};

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
            <i class="fa-solid fa-spinner fa-spin mr-1 text-purple-600"></i> Menghitung suara masuk secara real-time...
        </div>
    `;

    try {
        // 1. Tarik seluruh kandidat dan suara masuk dari Supabase
        const [cSnap, vSnap] = await Promise.all([
            supabase.from('duta_kandidat').select('*'),
            fetchAllRows('duta_suara_masuk')
        ]);

        if (cSnap.error) throw cSnap.error;
        if (vSnap.error) throw vSnap.error;

        const candidates = cSnap.data || [];
        const votes = vSnap.data || [];

        // Update Total Suara (Pemilih Unik)
        const uniqueVoters = new Set(votes.map(v => String(v.nis_pemilih)));
        if (totalEl) totalEl.innerText = uniqueVoters.size.toLocaleString('id-ID');

        // 2. Petakan jumlah suara masuk berdasarkan id_kandidat
        const votesCountMap = {};
        votes.forEach(vote => {
            const kid = vote.id_kandidat;
            votesCountMap[kid] = (votesCountMap[kid] || 0) + 1;
        });

        // 3. Render chart per kategori (6 Kategori Duta)
        let chartsHTML = '';
        categories.forEach(cat => {
            const catCandidates = candidates.filter(c => c.kategori === cat);
            
            // Hitung total suara di kategori ini
            let catTotalVotes = 0;
            const scoredCandidates = catCandidates.map(c => {
                const votesCount = votesCountMap[c.id] || 0;
                catTotalVotes += votesCount;
                return { ...c, votes: votesCount };
            });

            // Urutkan nominasi berdasarkan suara tertinggi (DESC)
            scoredCandidates.sort((a, b) => b.votes - a.votes);

            // Icon & Color kategori
            const catIcons = {
                'Sehat': 'fa-heart-pulse text-rose-600 bg-rose-50 border-rose-100',
                'Humanis': 'fa-people-group text-blue-600 bg-blue-50 border-blue-100',
                'Agamais': 'fa-hands-praying text-emerald-600 bg-emerald-50 border-emerald-100',
                'Kreatif': 'fa-lightbulb text-amber-600 bg-amber-50 border-amber-100',
                'Trampil': 'fa-wand-magic-sparkles text-indigo-600 bg-indigo-50 border-indigo-100',
                'Inovatif': 'fa-rocket text-purple-600 bg-purple-50 border-purple-100'
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
                        <div class="space-y-1.5 animate-fade-in">
                            <div class="flex justify-between items-center text-xs">
                                <span class="font-bold text-slate-700 truncate max-w-[200px] flex items-center gap-1.5">
                                    <span class="w-4 h-4 rounded-full text-[9px] font-black text-white ${barColor} flex items-center justify-center">${idx + 1}</span>
                                    ${c.nama}
                                </span>
                                <span class="font-black text-slate-900">${c.votes} Suara <span class="text-slate-400 font-bold ml-1">(${percentage.toFixed(1)}%)</span></span>
                            </div>
                            <div class="w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
                                <div class="h-full rounded-full transition-all duration-1000 ${barColor}" style="width: ${percentage}%"></div>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            chartsHTML += `
                <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm glass-panel flex flex-col hover:border-purple-200 transition-all duration-300">
                    <div class="flex justify-between items-center border-b pb-3 mb-4">
                        <div class="flex items-center gap-2.5 min-w-0">
                            <div class="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 border ${iconConfig.split(' ')[2] + ' ' + iconConfig.split(' ')[1] + ' ' + iconConfig.split(' ')[0]}">
                                <i class="fa-solid ${iconConfig.split(' ')[0]}"></i>
                            </div>
                            <h3 class="font-extrabold text-slate-800 text-xs font-outfit truncate">Kategori Duta ${cat}</h3>
                        </div>
                        <span class="text-[10px] bg-slate-100 border text-slate-500 px-2 py-0.5 rounded font-black shrink-0">${catTotalVotes} Suara Masuk</span>
                    </div>
                    <div class="space-y-3.5 flex-1 justify-center">
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

    // Bersihkan grid kategori
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
        // Ambil data
        const [cSnap, vSnap] = await Promise.all([
            supabase.from('duta_kandidat').select('*'),
            fetchAllRows('duta_suara_masuk')
        ]);

        if (cSnap.error) throw cSnap.error;
        if (vSnap.error) throw vSnap.error;

        const candidates = cSnap.data || [];
        const votes = vSnap.data || [];

        // Petakan suara masuk
        const votesCountMap = {};
        votes.forEach(vote => {
            votesCountMap[vote.id_kandidat] = (votesCountMap[vote.id_kandidat] || 0) + 1;
        });

        let cardsHTML = '';
        categories.forEach(cat => {
            const catCandidates = candidates.filter(c => c.kategori === cat);
            
            // Cari nominator dengan suara tertinggi
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

            // Set persentase pemenang
            if (winner) {
                winner.votes = maxVotes;
                winner.percentage = catTotalVotes > 0 ? (maxVotes / catTotalVotes) * 100 : 0;
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

                    <button onclick="window.triggerWinnerReveal('${cat}', ${winner ? JSON.stringify(winner).replace(/"/g, '&quot;') : 'null'})"
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

// Trigger Reveal Screen Stage (Spotlight Screen Overlay)
window.triggerWinnerReveal = function (kategori, winnerObj) {
    if (!winnerObj || winnerObj.votes === 0) {
        showAdminToast(`Belum ada data suara masuk pada kategori Duta ${kategori}!`, 'warning');
        return;
    }

    activeRevealCategory = kategori;
    winnerCandidateObj = winnerObj;

    // Reset Tampilan
    document.getElementById('tension-screen').classList.remove('hidden');
    document.getElementById('winner-reveal-card').classList.add('hidden', 'scale-90', 'opacity-0');
    document.getElementById('tension-category').innerText = `Duta ${kategori} 2026`;

    // Tampilkan Panggung Utama
    const stage = document.getElementById('winner-stage');
    stage.classList.remove('hidden');

    // Trigger visual tension beat
    simulateTensionDrumbeat();
};

// Tutup Panggung
window.closeWinnerStage = function () {
    document.getElementById('winner-stage').classList.add('hidden');
    activeRevealCategory = '';
    winnerCandidateObj = null;
    
    // Refresh panggung kesiswaan agar data tetap sinkron
    loadWinnerStageConfig();
};

// Simulasi Ketegangan Suara visual
let drumInterval = null;
function simulateTensionDrumbeat() {
    const tensionIcon = document.querySelector('#tension-screen .w-20');
    if (!tensionIcon) return;

    if (drumInterval) clearInterval(drumInterval);

    let scaleUp = false;
    drumInterval = setInterval(() => {
        if (!activeRevealCategory) {
            clearInterval(drumInterval);
            return;
        }
        scaleUp = !scaleUp;
        if (scaleUp) {
            tensionIcon.classList.add('scale-110');
            tensionIcon.classList.remove('scale-100');
        } else {
            tensionIcon.classList.remove('scale-110');
            tensionIcon.classList.add('scale-100');
        }
    }, 450); // visual tempo ketukan drum
}

// BUKA NOMINASI SEKARANG (Reveal Winner)
window.revealWinnerFinal = function () {
    if (drumInterval) clearInterval(drumInterval);

    const tensionScreen = document.getElementById('tension-screen');
    const winnerCard = document.getElementById('winner-reveal-card');
    if (!tensionScreen || !winnerCard) return;

    // 1. Fade out layar ketegangan
    tensionScreen.classList.add('hidden');

    // 2. Set Konten Pemenang
    const photoUrl = winnerCandidateObj.foto_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&h=300';
    document.getElementById('winner-img').src = photoUrl;
    document.getElementById('winner-category-tag').innerText = `DUTA ${activeRevealCategory.toUpperCase()} 2026`;
    document.getElementById('winner-name').innerText = winnerCandidateObj.nama;
    document.getElementById('winner-votes').innerText = `${winnerCandidateObj.votes} Suara`;
    document.getElementById('winner-percent').innerText = `${winnerCandidateObj.percentage.toFixed(1)}%`;
    
    // Cari data siswa di cache SIMAS jika memungkinkan untuk melacak kelas
    document.getElementById('winner-class').innerText = `Kandidat Terbaik Terpilih`;

    // 3. Tampilkan Golden Winner Card dengan animasi megah
    winnerCard.classList.remove('hidden');
    setTimeout(() => {
        winnerCard.classList.remove('scale-90', 'opacity-0');
        winnerCard.classList.add('scale-100', 'opacity-100');
    }, 50);

    // 4. LEDAKKAN CONFETTI EMAS BERUNTUN! (Panggung Teatrikal TV Style)
    sprayTheatricalConfetti();
};

// Semburan Confetti Emas Megah
function sprayTheatricalConfetti() {
    const end = Date.now() + (3.5 * 1000); // Semburan selama 3.5 detik beruntun
    const colors = ['#eab308', '#ca8a04', '#facc15', '#ffffff', '#818cf8']; // Emas, Putih, Ungu gradasi

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

// Tombol ledakan confetti tambahan
window.sprayMoreConfetti = function() {
    sprayTheatricalConfetti();
};

// =========================================================================
// 8. HELPERS & ALERTS
// =========================================================================

// Escape HTML Strings Helper
window.escapeJSString = function(str) {
    if (!str) return '';
    return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
};

// Toast Notification Kustom
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
window.addEventListener('DOMContentLoaded', async () => {
    // 1. Proteksi Akses Admin SIMAS
    if (!checkAdminSession()) return;

    // 2. Inisialisasi Supabase
    if (!initSupabase()) {
        showAdminToast('Supabase gagal terhubung!', 'error');
        return;
    }

    // 3. Load Status Voting Duta
    await loadVotingStatus();

    // 4. Bind Toggle Event Listener
    const toggleEl = document.getElementById('toggle-duta-voting');
    if (toggleEl) {
        toggleEl.addEventListener('change', async (e) => {
            const isActive = e.target.checked;
            await saveVotingStatus(isActive);
        });
    }

    // 5. Load Nominasi Awal
    await loadCandidates();

    // 6. Form Submit handler
    const form = document.getElementById('form-kandidat');
    if (form) form.addEventListener('submit', handleFormSubmit);
});
