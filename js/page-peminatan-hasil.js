import { auth } from './config.js';
import { cfClient } from './cloudflare-client.js';
import { initLayout, showToast, escapeHTML } from './global.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

let currentYear = "";
let currentKelas = "";
let allSubmissions = [];
let questionBank = [];
let peminatanCache = {}; // Cache lokal data kuesioner berdasarkan tahun untuk hemat kuota read
let currentLayout = "classic"; // default
let isQuestionnaireActive = true;
let currentWeights = {
    'Kemampuan': 45,
    'Minat': 30,
    'Prestasi': 10,
    'Cita-cita': 5,
    'Gaya Belajar': 10
};
let radarChart = null;
let distribusiChart = null;
let kelasChart = null;
let currentViewMode = 'sudah';
let cachedStudentsX = null; // Cache siswa kelas X for quota saving

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.replace('index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash));
        return;
    }

    const role = localStorage.getItem('user_role');
    const allRoles = window.getAllUserRoles ? window.getAllUserRoles() : [role];
    const allowedRoles = ['super_admin', 'guru_bk', 'wakasek_kurikulum', 'kesiswaan'];
    const hasAccess = allRoles.some(r => allowedRoles.includes(r));

    if (!hasAccess) {
        window.location.replace('dashboard.html');
        return;
    }
    
    // Read-only logic: If user does NOT have super_admin or guru_bk, they are read-only
    const canCRUD = allRoles.some(r => ['super_admin', 'guru_bk'].includes(r));
    const isReadOnly = !canCRUD;
    
    if (isReadOnly) {
        const tabQuestionsBtn = document.getElementById('tab-questions');
        if (tabQuestionsBtn) tabQuestionsBtn.classList.add('hidden');
        
        const btnDeleteResponse = document.querySelector('button[onclick="window.resetAttempt()"]');
        if (btnDeleteResponse) btnDeleteResponse.classList.add('hidden');
    }

    await initLayout(role);
    document.querySelector('main').classList.remove('hidden');

    // 1. Init Filter Tahun & Kelas
    setupYearFilter();
    setupKelasFilter();

    // 2. Load Question Bank (Always load for management)
    loadQuestionBank();

    // Attach search listener
    document.getElementById('search-siswa').addEventListener('input', applyFilters);

    // 3. Show Initial Message
    const body = document.getElementById('results-body');
    body.innerHTML = `<tr><td colspan="7" class="p-10 text-center text-slate-400 italic text-xs">Silakan pilih Tahun dan Kelas untuk memuat data.</td></tr>`;
});

// --- SECTION 1: MANAJEMEN HASIL SISWA ---

async function setupYearFilter() {
    const select = document.getElementById('filter-ta');
    const yearNow = new Date().getFullYear();
    const startYear = yearNow - 5;

    for (let y = yearNow + 1; y >= startYear; y--) {
        const opt = document.createElement('option');
        opt.value = y.toString();
        opt.textContent = `Tahun ${y}`;
        if (y === yearNow) {
            opt.selected = true;
            currentYear = y.toString();
        }
        select.appendChild(opt);
    }

    select.onchange = (e) => {
        currentYear = e.target.value;
        checkAndLoad();
    };
}

async function setupKelasFilter() {
    const select = document.getElementById('filter-kelas');
    // Keep placeholder from HTML
    
    try {
        if (typeof window.getActiveClasses === 'function') {
            const classes = await window.getActiveClasses({ gradeFilter: 'X' });
            
            classes.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c;
                opt.textContent = c;
                select.appendChild(opt);
            });

            const allOpt = document.createElement('option');
            allOpt.value = "ALL";
            allOpt.textContent = "Semua Kelas X";
            select.appendChild(allOpt);
        }
    } catch (e) {
        console.error("Gagal load filter kelas:", e);
    }

    select.onchange = (e) => {
        currentKelas = e.target.value;
        // Optimalisasi Hemat Kuota Read: Jika data peminatan sudah dimuat secara lokal, filter langsung di client-side
        if (allSubmissions && allSubmissions.length > 0 && peminatanCache[currentYear]) {
            applyFilters();
            renderStatsSummary();
        } else {
            checkAndLoad();
        }
    };
}

function checkAndLoad() {
    if (currentYear && currentKelas) {
        loadSubmissions();
    }
}

async function loadSubmissions(forceRefresh = false) {
    const body = document.getElementById('results-body');
    const empty = document.getElementById('results-empty');
    body.innerHTML = `<tr><td colspan="7" class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-2xl text-indigo-500"></i></td></tr>`;
    
    if (forceRefresh) {
        delete peminatanCache[currentYear];
    }

    // Optimalisasi Hemat Kuota Read: Ambil dari cache lokal jika data sudah dimuat sebelumnya
    if (peminatanCache[currentYear]) {
        allSubmissions = peminatanCache[currentYear];
        finishLoadingSubmissions();
        return;
    }
    
    try {
        allSubmissions = await cfClient.getPeminatanResponses({ year: currentYear });

        // Simpan ke cache lokal
        peminatanCache[currentYear] = allSubmissions;

        finishLoadingSubmissions();
    } catch (e) {
        console.error("Load Submissions Error:", e);
        body.innerHTML = `<tr><td colspan="7" class="p-10 text-center text-red-500 font-bold">Gagal memuat data: ${e.message}</td></tr>`;
    }
}

function finishLoadingSubmissions() {
    const body = document.getElementById('results-body');
    const empty = document.getElementById('results-empty');
    const statsSummary = document.getElementById('stats-summary');

    if (allSubmissions.length === 0) {
        body.innerHTML = '';
        empty.classList.remove('hidden');
        statsSummary.classList.add('hidden');
        return;
    }

    empty.classList.add('hidden');
    applyFilters();
    renderStatsSummary();
}

function applyFilters() {
    const searchVal = document.getElementById('search-siswa').value.toLowerCase();
    
    if (currentViewMode === 'sudah') {
        const filtered = allSubmissions.filter(s => {
            const matchSearch = (s.name && s.name.toLowerCase().includes(searchVal)) || (s.nis && s.nis.toLowerCase().includes(searchVal));
            const matchKelas = (currentKelas === 'ALL') || !currentKelas || s.class === currentKelas;
            return matchSearch && matchKelas;
        });

        renderResultsTable(filtered);
    } else {
        loadBelumMengisi();
    }
}

async function renderStatsSummary() {
    const container = document.getElementById('stats-summary');
    if (!allSubmissions.length) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');

    // Filter data pengisi sesuai kelas aktif untuk statistik summary
    let submissionsFiltered = allSubmissions;
    if (currentKelas && currentKelas !== 'ALL') {
        submissionsFiltered = allSubmissions.filter(s => s.class === currentKelas);
    }

    // Fetch total target students
    let totalTarget = 0;
    try {
        let allStudentsX = [];
        const cacheKey = `students_x_${currentKelas}`;
        const cached = sessionStorage.getItem(cacheKey);

        if (cached && cachedStudentsX) {
            allStudentsX = cachedStudentsX;
        } else {
            let loadedList = [];
            if (typeof window.getStudentsCache === 'function') {
                try {
                    const cacheAll = await window.getStudentsCache();
                    if (Array.isArray(cacheAll) && cacheAll.length > 0) {
                        loadedList = cacheAll;
                    }
                } catch (e) {}
            }

            if (loadedList.length === 0 && cfClient && cfClient.enabled) {
                try {
                    const cfList = await cfClient.getStudents({ limit: 1500 });
                    if (Array.isArray(cfList) && cfList.length > 0) {
                        loadedList = cfList;
                    }
                } catch (e) {}
            }

            if (loadedList.length > 0) {
                loadedList.forEach(s => {
                    const c = s.class || s.kelas || '';
                    const matchClass = (!currentKelas || currentKelas === 'ALL')
                        ? (c.startsWith('X') && !c.startsWith('XI'))
                        : (c === currentKelas);
                    if (matchClass) {
                        allStudentsX.push({
                            nis: s.nis || s.id,
                            name: s.name,
                            class: c,
                            birthDate: s.birthDate || '',
                            nisn: s.nisn || ''
                        });
                    }
                });
            }
            cachedStudentsX = allStudentsX;
            sessionStorage.setItem(cacheKey, 'cached');
        }
        totalTarget = allStudentsX.length;
    } catch(e) {
        console.error("Error fetching total students:", e);
        totalTarget = '?';
    }

    // 1. Total Pengisi
    document.getElementById('stat-total').innerText = `${submissionsFiltered.length} / ${totalTarget}`;

    // 2. Hitung distribusi rekomendasi dari recalculated scores
    const dist = { IPA: 0, IPS: 0, Bahasa: 0 };
    let sumIPA = 0, sumIPS = 0, sumBahasa = 0;

    submissionsFiltered.forEach(s => {
        const calc = recalculateScores(s.responses || {});
        let rec = 'IPA', maxV = -1;
        ['IPA', 'IPS', 'Bahasa'].forEach(m => {
            if (calc[m].Total > maxV) { maxV = calc[m].Total; rec = m; }
        });
        dist[rec]++;
        sumIPA += calc.IPA.Total || 0;
        sumIPS += calc.IPS.Total || 0;
        sumBahasa += calc.Bahasa.Total || 0;
    });

    const total = submissionsFiltered.length;

    // 3. Render Mini Doughnut Chart
    const ctx = document.getElementById('chart-distribusi-mini').getContext('2d');
    const chartData = [dist.IPA, dist.IPS, dist.Bahasa];
    const chartColors = ['#10b981', '#f59e0b', '#6366f1'];

    if (distribusiChart) {
        distribusiChart.data.datasets[0].data = chartData;
        distribusiChart.update('active');
    } else {
        distribusiChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['IPA', 'IPS', 'Bahasa'],
                datasets: [{
                    data: chartData,
                    backgroundColor: chartColors,
                    borderWidth: 0,
                    spacing: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                cutout: '65%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (c) => ` ${c.label}: ${c.raw} siswa (${Math.round(c.raw / total * 100)}%)`
                        }
                    }
                },
                animation: { duration: 600, easing: 'easeOutQuart' }
            }
        });
    }

    // 4. Labels distribusi
    const labelsEl = document.getElementById('stat-distribusi-labels');
    labelsEl.innerHTML = [
        { name: 'IPA', count: dist.IPA, color: 'bg-emerald-500' },
        { name: 'IPS', count: dist.IPS, color: 'bg-amber-500' },
        { name: 'Bahasa', count: dist.Bahasa, color: 'bg-indigo-500' }
    ].map(d => `
        <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full ${d.color}"></div>
                <span class="font-bold text-slate-600 dark:text-slate-300">${d.name}</span>
            </div>
            <span class="font-black text-slate-800 dark:text-white">${d.count} <span class="text-[9px] text-slate-400 font-bold">(${total ? Math.round(d.count / total * 100) : 0}%)</span></span>
        </div>
    `).join('');

    // 5. Rata-rata skor per jurusan
    const avgEl = document.getElementById('stat-avg-scores');
    const avgs = [
        { name: 'IPA', avg: total ? Math.round(sumIPA / total) : 0, color: 'bg-emerald-500' },
        { name: 'IPS', avg: total ? Math.round(sumIPS / total) : 0, color: 'bg-amber-500' },
        { name: 'Bahasa', avg: total ? Math.round(sumBahasa / total) : 0, color: 'bg-indigo-500' }
    ];
    avgEl.innerHTML = avgs.map(a => `
        <div class="flex items-center gap-3">
            <span class="text-[10px] font-bold text-slate-500 w-12">${a.name}</span>
            <div class="flex-1 bg-slate-100 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                <div class="${a.color} h-full rounded-full transition-all duration-700" style="width: ${a.avg}%"></div>
            </div>
            <span class="text-xs font-black text-slate-700 dark:text-white w-10 text-right">${a.avg}%</span>
        </div>
    `).join('');

    renderKelasChart();
}

function recalculateScores(studentResponses) {
    const totals = {};
    const categories = ['IPA', 'IPS', 'Bahasa'];
    const aspects = ['Kemampuan', 'Minat', 'Prestasi', 'Cita-cita', 'Gaya Belajar', 'Lingkungan'];
    
    categories.forEach(cat => {
        totals[cat] = {};
        aspects.forEach(asp => totals[cat][asp] = { sum: 0, count: 0 });
    });

    questionBank.forEach(q => {
        const resp = studentResponses[q.kode];
        if (resp === undefined) return;
        
        let score = resp;
        if (q.sifat === 'Negatif') score = 6 - resp;
        
        // RUMUS BARU: (skor / 5) * 100
        const normalized = (score / 5) * 100;
        
        if (totals[q.jurusan] && totals[q.jurusan][q.aspek]) {
            totals[q.jurusan][q.aspek].sum += normalized;
            totals[q.jurusan][q.aspek].count += 1;
        }
    });

    const results = {};
    const wk = (currentWeights['Kemampuan'] || 0) / 100;
    const wm = (currentWeights['Minat'] || 0) / 100;
    const wp = (currentWeights['Prestasi'] || 0) / 100;
    const wc = (currentWeights['Cita-cita'] || 0) / 100;
    const wg = (currentWeights['Gaya Belajar'] || 0) / 100;

    categories.forEach(cat => {
        results[cat] = {};
        let weightedSum = 0;
        
        aspects.forEach(asp => {
            const avg = totals[cat][asp].count > 0 ? (totals[cat][asp].sum / totals[cat][asp].count) : 0;
            results[cat][asp] = avg;
            
            if (asp === 'Kemampuan') weightedSum += avg * wk;
            else if (asp === 'Minat') weightedSum += avg * wm;
            else if (asp === 'Prestasi') weightedSum += avg * wp;
            else if (asp === 'Cita-cita') weightedSum += avg * wc;
            else if (asp === 'Gaya Belajar') weightedSum += avg * wg;
        });
        results[cat].Total = weightedSum;
    });

    return results;
}

function renderResultsTable(data) {
    const body = document.getElementById('results-body');
    body.innerHTML = '';

    if (data.length === 0) {
        body.innerHTML = '<tr><td colspan="7" class="p-10 text-center text-slate-400 italic text-xs">Tidak ada data yang cocok dengan filter.</td></tr>';
        return;
    }

    data.forEach(item => {
        const rawSubDate = item.submittedAt || item.submitted_at;
        const subDate = (typeof window.parseUniversalDate === 'function') 
            ? window.parseUniversalDate(rawSubDate) 
            : (rawSubDate ? new Date(rawSubDate) : null);
        const date = (subDate && !isNaN(subDate.getTime())) ? subDate.toLocaleString('id-ID') : '-';
        
        // Re-calculate everything from raw responses to ensure new formula (skor/5)*100 is applied
        const calculated = recalculateScores(item.responses || {});
        
        const scoreIPA = Math.round(calculated.IPA.Total || 0);
        const scoreIPS = Math.round(calculated.IPS.Total || 0);
        const scoreBahasa = Math.round(calculated.Bahasa.Total || 0);

        // Re-determine recommendation
        let recommendation = 'IPA';
        let maxVal = -1;
        ['IPA', 'IPS', 'Bahasa'].forEach(m => {
            if (calculated[m].Total > maxVal) {
                maxVal = calculated[m].Total;
                recommendation = m;
            }
        });

        const row = document.createElement('tr');
        row.className = "hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors";
        row.innerHTML = `
            <td class="px-6 py-4">
                <div class="font-bold text-slate-800 dark:text-white leading-tight">${escapeHTML(item.name)}</div>
                <div class="text-[10px] text-slate-400 font-bold tracking-tighter uppercase mt-0.5">
                    NIS: ${item.nis || '-'} <span class="mx-1 text-slate-300">|</span> <span class="text-indigo-500">${escapeHTML(item.class || '-')}</span>
                </div>
            </td>
            <td class="px-6 py-4">
                <span class="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800/50">
                    ${recommendation}
                </span>
            </td>
            <td class="px-6 py-4">
                <div class="flex flex-col gap-1 min-w-[60px]">
                    <span class="text-xs font-black text-slate-700 dark:text-slate-300">${scoreIPA}%</span>
                    <div class="w-full bg-slate-100 dark:bg-slate-700 h-1 rounded-full overflow-hidden">
                        <div class="bg-emerald-500 h-full" style="width: ${scoreIPA}%"></div>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4">
                <div class="flex flex-col gap-1 min-w-[60px]">
                    <span class="text-xs font-black text-slate-700 dark:text-slate-300">${scoreIPS}%</span>
                    <div class="w-full bg-slate-100 dark:bg-slate-700 h-1 rounded-full overflow-hidden">
                        <div class="bg-amber-500 h-full" style="width: ${scoreIPS}%"></div>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4">
                <div class="flex flex-col gap-1 min-w-[60px]">
                    <span class="text-xs font-black text-slate-700 dark:text-slate-300">${scoreBahasa}%</span>
                    <div class="w-full bg-slate-100 dark:bg-slate-700 h-1 rounded-full overflow-hidden">
                        <div class="bg-indigo-500 h-full" style="width: ${scoreBahasa}%"></div>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4 text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-tight">${date}</td>
            <td class="px-6 py-4 text-center">
                <button onclick="window.viewDetail('${item.id}')" class="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 transition-all shadow-sm">
                    <i class="fa-solid fa-chart-simple"></i>
                </button>
            </td>
        `;
        body.appendChild(row);
    });
}

// --- DETAIL VIEW & CHART ---

window.viewDetail = (nis) => {
    const student = allSubmissions.find(s => s.id === nis);
    if (!student) return;

    // Recalculate scores using new formula for modal detail
    const calculatedScores = recalculateScores(student.responses || {});
    window.currentViewingScores = calculatedScores;
    window.currentViewingNIS = nis;

    document.getElementById('detail-nama').innerText = student.name;
    document.getElementById('detail-nis-kelas').innerText = `NIS: ${student.nis || '-'} | Kelas: ${student.class || '-'}`;
    
    // Determine recommendation from recalculated scores
    let rec = 'IPA';
    let maxS = -1;
    ['IPA', 'IPS', 'Bahasa'].forEach(m => {
        if (calculatedScores[m].Total > maxS) {
            maxS = calculatedScores[m].Total;
            rec = m;
        }
    });

    const badge = document.getElementById('detail-rec-badge');
    badge.classList.remove('hidden');
    
    // Base classes for a more prominent, premium badge
    const baseClass = "px-5 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-[0.15em] border-2 shadow-xl shadow-indigo-100 dark:shadow-none flex flex-col items-start leading-none transition-all hover:scale-105 md:ml-auto";
    
    if (rec === 'IPA') {
        badge.className = `${baseClass} bg-emerald-50 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800`;
        badge.innerHTML = `
            <span class="text-[8px] opacity-60 mb-1">Rekomendasi Utama</span>
            <div class="flex items-center gap-2 text-sm">
                <i class="fa-solid fa-star"></i> ${rec}
            </div>
        `;
    } else if (rec === 'IPS') {
        badge.className = `${baseClass} bg-amber-50 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800`;
        badge.innerHTML = `
            <span class="text-[8px] opacity-60 mb-1">Rekomendasi Utama</span>
            <div class="flex items-center gap-2 text-sm">
                <i class="fa-solid fa-star"></i> ${rec}
            </div>
        `;
    } else {
        badge.className = `${baseClass} bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800`;
        badge.innerHTML = `
            <span class="text-[8px] opacity-60 mb-1">Rekomendasi Utama</span>
            <div class="flex items-center gap-2 text-sm">
                <i class="fa-solid fa-star"></i> ${rec}
            </div>
        `;
    }

    // Render Major Comparison
    window.currentViewingScores = calculatedScores;
    renderMajorComparison(calculatedScores);
    
    // Render Radar Chart (Show all equally by default)
    renderRadarChart(calculatedScores, null);

    // Render Raw Responses
    renderRawResponses(student.responses);

    document.getElementById('modal-detail-siswa').classList.remove('hidden');
    window.currentViewingNIS = nis;
};

function renderMajorComparison(scores) {
    const container = document.getElementById('major-comparison-list');
    container.innerHTML = '';

    const majors = ['IPA', 'IPS', 'Bahasa'];
    const barColors = { 'IPA': 'bg-emerald-500', 'IPS': 'bg-amber-500', 'Bahasa': 'bg-indigo-500' };

    majors.forEach(m => {
        const s = scores[m] || {};
        let val = Math.round(s.Total || 0);
        
        // Cari aspek tertinggi untuk jurusan ini (Informative aspect)
        let topAspect = '-';
        let maxVal = -1;
        ['Kemampuan', 'Minat', 'Prestasi', 'Cita-cita', 'Gaya Belajar'].forEach(asp => {
            if (s[asp] > maxVal) {
                maxVal = s[asp];
                topAspect = asp;
            }
        });

        const card = document.createElement('div');
        card.id = `major-card-${m}`;
        card.className = "group bg-white dark:bg-slate-800/50 p-3 rounded-2xl border dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 transition-all shadow-sm hover:shadow-md cursor-pointer";
        card.setAttribute('onclick', `window.changeRadarMajor('${m}')`);
        card.innerHTML = `
            <div class="flex flex-col gap-2">
                <div class="flex justify-between items-center">
                    <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-full ${barColors[m]} animate-pulse"></div>
                        <span class="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-tight">${m}</span>
                    </div>
                    <div class="flex flex-col items-end">
                        <span class="text-sm font-black text-slate-800 dark:text-white">${val}%</span>
                        <span class="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Top: ${topAspect}</span>
                    </div>
                </div>
                <div class="w-full bg-slate-100 dark:bg-slate-700/50 h-2 rounded-full overflow-hidden">
                    <div class="${barColors[m]} h-full transition-all duration-1000 shadow-sm rounded-full" style="width: ${val}%"></div>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

function renderRadarChart(scores, focusedMajor = null) {
    const ctx = document.getElementById('chart-radar-aspek').getContext('2d');
    const aspects = ['Kemampuan', 'Minat', 'Prestasi', 'Cita-cita', 'Gaya Belajar'];
    
    // Simpan focusedMajor saat ini secara global untuk logika toggle
    window.currentFocusedMajor = focusedMajor;

    const getDataset = (label, color, focused) => ({
        label: label,
        data: aspects.map(asp => Math.round(scores[label]?.[asp] || 0)),
        borderColor: color,
        backgroundColor: focused === label ? `${color}40` : (focused ? `${color}0D` : `${color}1A`),
        borderWidth: focused === label ? 3 : (focused ? 1 : 2),
        pointRadius: focused === label ? 3 : 2,
        pointBackgroundColor: '#fff',
        pointBorderColor: color,
        transition: 'all 0.4s ease'
    });

    const datasets = [
        getDataset('IPA', '#10b981', focusedMajor),
        getDataset('IPS', '#f59e0b', focusedMajor),
        getDataset('Bahasa', '#6366f1', focusedMajor)
    ];

    const isDark = document.documentElement.classList.contains('dark');
    // Gunakan opasitas 0.2 (bukan 0.05) agar jaring terlihat jelas saat dicetak (print)
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.2)';
    const labelColor = isDark ? '#94a3b8' : '#475569';

    if (radarChart) {
        // Update existing chart for smoothness
        radarChart.options.scales.r.grid.color = gridColor;
        radarChart.options.scales.r.angleLines.color = gridColor;
        radarChart.options.scales.r.pointLabels.color = labelColor;
        
        radarChart.data.datasets.forEach((ds, i) => {
            ds.data = datasets[i].data;
            ds.backgroundColor = datasets[i].backgroundColor;
            ds.borderWidth = datasets[i].borderWidth;
            ds.pointRadius = datasets[i].pointRadius;
        });
        radarChart.update('active'); // Use 'active' mode for smooth animation
    } else {
        radarChart = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: aspects,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 800, easing: 'easeOutQuart' },
                layout: {
                    padding: { top: 10, bottom: 10, left: 10, right: 10 }
                },
                scales: {
                    r: {
                        suggestedMin: 0,
                        suggestedMax: 100,
                        ticks: { display: false },
                        pointLabels: { 
                            font: { size: 10, weight: 'bold' },
                            color: labelColor,
                            padding: 5
                        },
                        grid: { color: gridColor },
                        angleLines: { color: gridColor }
                    }
                },
                plugins: {
                    legend: { 
                        display: false,
                        position: 'bottom',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'circle',
                            padding: 15,
                            font: { size: 10, weight: 'bold' }
                        }
                    },
                    tooltip: {
                        enabled: true,
                        callbacks: {
                            label: function(context) {
                                return ` ${context.dataset.label}: ${context.raw}%`;
                            }
                        }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    intersect: true
                },
                onHover: (event, chartElement) => {
                    // Custom logic to show "Index" mode if hovering near labels could be complex
                    // For now, let's stick to 'nearest' + 'intersect: true' as requested for points.
                    // To handle "hover label -> show all", we can use index mode if no point is intersected but we are near an axis.
                    if (chartElement.length > 0) {
                        event.native.target.style.cursor = 'pointer';
                        radarChart.options.interaction.mode = 'nearest';
                    } else {
                        event.native.target.style.cursor = 'default';
                        // Detect if near label? Chart.js doesn't expose label bounding boxes easily.
                        // We will set mode to index when not intersecting points to allow "general" comparison if near axis
                        radarChart.options.interaction.mode = 'index';
                    }
                }
            }
        });
    }

    // Update UI highlight for cards
    document.querySelectorAll('[id^="major-card-"]').forEach(card => {
        card.classList.remove('ring-2', 'ring-indigo-500', 'border-indigo-300', 'bg-indigo-50/30');
        card.classList.add('bg-white');
    });
    if (focusedMajor) {
        const activeCard = document.getElementById(`major-card-${focusedMajor}`);
        if (activeCard) {
            // Latar sorotan menggantikan latar dasar (urutan CSS Tailwind build)
            activeCard.classList.remove('bg-white');
            activeCard.classList.add('ring-2', 'ring-indigo-500', 'border-indigo-300', 'bg-indigo-50/30');
        }
    }
}

window.changeRadarMajor = (major) => {
    if (!window.currentViewingScores) return;
    
    // Toggle Logic: If clicking the same major, deselect it (null)
    const nextMajor = window.currentFocusedMajor === major ? null : major;
    renderRadarChart(window.currentViewingScores, nextMajor);
};

function renderRawResponses(responses) {
    const container = document.getElementById('detail-responses-body'); // Note: Target ID is still same but structure will change
    container.innerHTML = '';
    
    if (!questionBank || questionBank.length === 0) {
        container.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-slate-400 italic">Data soal tidak tersedia.</td></tr>';
        return;
    }

    // Grouping structure: { Jurusan: { totalRawJurusan: 0, aspects: { Aspek: { items: [], total: 0 } } } }
    const grouped = {};

    questionBank.forEach(q => {
        const jur = q.jurusan || 'Umum';
        const asp = q.aspek || 'Lainnya';
        
        if (!grouped[jur]) {
            grouped[jur] = { totalRawJurusan: 0, aspects: {} };
        }
        if (!grouped[jur].aspects[asp]) {
            grouped[jur].aspects[asp] = { items: [], total: 0 };
        }
        
        const respVal = parseInt(responses[q.kode]) || 0;
        let score = respVal;
        if (q.sifat === 'Negatif' && respVal > 0) score = 6 - respVal;
        
        grouped[jur].aspects[asp].items.push({
            teks: q.teks,
            kode: q.kode,
            jawaban: respVal,
            skor: score,
            sifat: q.sifat
        });
        grouped[jur].aspects[asp].total += score;
        grouped[jur].totalRawJurusan += score;
    });

    // Render grouped data
    let html = '';
    const majors = Object.keys(grouped).sort();

    majors.forEach((jur, idx) => {
        const jurId = `jur-${idx}`;
        // Jurusan Header
        html += `
            <tr class="bg-slate-50 dark:bg-slate-800/80 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" onclick="window.toggleJurusanRow('${jurId}')">
                <td colspan="3" class="px-4 py-4">
                    <div class="flex items-center gap-3">
                        <div id="icon-${jurId}" class="w-5 h-5 rounded-lg bg-slate-400 text-white flex items-center justify-center text-[8px] shadow-sm">
                            <i class="fa-solid fa-plus"></i>
                        </div>
                        <span class="font-black text-slate-800 dark:text-white uppercase tracking-widest text-[11px] flex items-center gap-2">
                            <i class="fa-solid fa-folder-open text-indigo-500 text-xs"></i> ${jur}
                        </span>
                    </div>
                </td>
                <td class="px-4 py-4 text-right">
                    <span class="px-3 py-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg font-black text-xs shadow-sm">${grouped[jur].totalRawJurusan}</span>
                </td>
            </tr>
        `;

        const aspects = Object.keys(grouped[jur].aspects).sort();
        aspects.forEach((asp, aspIdx) => {
            const data = grouped[jur].aspects[asp];
            const aspId = `${jurId}-asp-${aspIdx}`;
            
            // Aspect Header Row (HIDDEN BY DEFAULT)
            html += `
                <tr class="${jurId}-content hidden bg-white dark:bg-slate-900 border-t dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onclick="window.toggleAspectRow('${aspId}', event)">
                    <td colspan="3" class="px-10 py-3 font-bold text-slate-500 dark:text-slate-400 text-[10px] italic">
                        <div class="flex items-center gap-2">
                            <div id="icon-${aspId}" class="w-4 h-4 rounded bg-slate-200 dark:bg-slate-700 text-slate-500 flex items-center justify-center text-[7px]">
                                <i class="fa-solid fa-plus"></i>
                            </div>
                            <span><i class="fa-solid fa-caret-right mr-1 text-indigo-400"></i> ${asp}</span>
                        </div>
                    </td>
                    <td class="px-4 py-3 text-right">
                        <span class="text-indigo-600 dark:text-indigo-400 font-black text-[11px]">${data.total}</span>
                    </td>
                </tr>
            `;

            // Question Rows (HIDDEN BY DEFAULT)
            data.items.forEach(item => {
                html += `
                    <tr class="${jurId}-content ${aspId}-content hidden hover:bg-slate-50/30 dark:hover:bg-slate-800/10 transition-colors border-b border-slate-50 dark:border-slate-800/50">
                        <td class="px-12 py-2.5 text-slate-600 dark:text-slate-400 text-xs leading-relaxed">
                            <span class="text-[9px] font-mono text-slate-300 dark:text-slate-600 mr-2">${item.kode}</span> ${escapeHTML(item.teks)}
                        </td>
                        <td class="px-4 py-2.5 text-center text-[9px] font-bold ${item.sifat === 'Negatif' ? 'text-rose-400' : 'text-emerald-400'} uppercase tracking-tighter">${item.sifat === 'Negatif' ? 'Negatif' : 'Positif'}</td>
                        <td class="px-4 py-2.5 text-center font-medium text-slate-400 text-xs">${item.jawaban || '-'}</td>
                        <td class="px-4 py-2.5 text-right font-bold text-slate-700 dark:text-slate-300 text-xs">${item.skor || '-'}</td>
                    </tr>
                `;
            });
        });
    });

    container.innerHTML = html;
}

window.toggleJurusanRow = (jurId) => {
    const directContents = document.querySelectorAll(`.${jurId}-content`); // All aspects and questions under this jurusan
    const icon = document.getElementById(`icon-${jurId}`);
    
    // Check current state
    const isNowClosing = !icon.querySelector('.fa-plus'); 

    if (isNowClosing) {
        // Close everything under this Jurusan
        directContents.forEach(row => row.classList.add('hidden'));
        icon.innerHTML = '<i class="fa-solid fa-plus"></i>';
        icon.classList.replace('bg-indigo-600', 'bg-slate-400');
    } else {
        // Open only ASPECTS (not questions)
        const aspects = document.querySelectorAll(`tr.${jurId}-content:not([class*="-asp-"])`); // This filter logic is tricky with classes
        // Better: iterate and only show those that are aspects (contain aspect headers)
        directContents.forEach(row => {
            if (row.classList.contains(`${jurId}-content`) && !row.className.includes('-asp-')) {
                // This is an aspect row
                row.classList.remove('hidden');
            }
        });
        
        // Wait, my class naming for aspect rows is ${jurId}-content. 
        // My class naming for question rows is ${jurId}-content ${aspId}-content.
        // So I should show only those that DO NOT have an aspect content class.
        directContents.forEach(row => {
            const classList = Array.from(row.classList);
            const isQuestion = classList.some(c => c.includes('-asp-') && c.endsWith('-content'));
            if (!isQuestion) {
                row.classList.remove('hidden');
            }
        });

        icon.innerHTML = '<i class="fa-solid fa-minus"></i>';
        icon.classList.replace('bg-slate-400', 'bg-indigo-600');
    }
};

window.toggleAspectRow = (aspId, event) => {
    if (event) event.stopPropagation();
    const rows = document.querySelectorAll(`.${aspId}-content`);
    const icon = document.getElementById(`icon-${aspId}`);
    
    rows.forEach(row => {
        row.classList.toggle('hidden');
    });

    if (icon) {
        const isHidden = rows[0].classList.contains('hidden');
        icon.innerHTML = isHidden ? '<i class="fa-solid fa-plus"></i>' : '<i class="fa-solid fa-minus"></i>';
        icon.className = isHidden ? 
            "w-4 h-4 rounded bg-slate-200 dark:bg-slate-700 text-slate-500 flex items-center justify-center text-[7px]" : 
            "w-4 h-4 rounded bg-indigo-500 text-white flex items-center justify-center text-[7px]";
    }
};

// --- HELPER: MODERN CONFIRM (Menggantikan confirm() browser) ---
function showConfirmModal(message, title = 'Konfirmasi', type = 'warning') {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-generic-confirm');
        if (!modal) {
            if (typeof window.showConfirmModal === 'function' && window.showConfirmModal !== showConfirmModal) {
                return resolve(window.showConfirmModal(message, title, type));
            }
            resolve(false);
            return;
        }

        const iconBg = document.getElementById('confirm-icon-bg');
        const icon = document.getElementById('confirm-icon');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-msg');
        const btnOk = document.getElementById('btn-confirm-ok');
        const btnCancel = document.getElementById('btn-confirm-cancel');

        if (type === 'danger') {
            iconBg.className = "w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600 dark:text-red-400";
            icon.className = "fa-solid fa-trash text-3xl";
            btnOk.className = "px-6 py-2.5 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 shadow-lg shadow-red-200 dark:shadow-none transition-all active:scale-95";
            btnOk.innerHTML = '<i class="fa-solid fa-trash-can mr-2"></i>Ya, Hapus';
        } else if (type === 'info') {
            iconBg.className = "w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-600 dark:text-blue-400";
            icon.className = "fa-solid fa-circle-question text-3xl";
            btnOk.className = "px-6 py-2.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200 dark:shadow-none transition-all active:scale-95";
            btnOk.innerHTML = 'Ya, Lanjutkan';
        } else {
            iconBg.className = "w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto mb-4 text-amber-600 dark:text-amber-400";
            icon.className = "fa-solid fa-triangle-exclamation text-3xl";
            btnOk.className = "px-6 py-2.5 rounded-xl font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-lg shadow-amber-200 dark:shadow-none transition-all active:scale-95";
            btnOk.innerHTML = 'Ya, Lanjutkan';
        }

        titleEl.innerText = title;
        msgEl.innerHTML = message;
        modal.classList.remove('hidden');

        // Cleanup handler lama agar tidak duplikat
        const newBtnCancel = btnCancel.cloneNode(true);
        const newBtnOk = btnOk.cloneNode(true);
        btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
        btnOk.parentNode.replaceChild(newBtnOk, btnOk);

        newBtnCancel.onclick = () => { modal.classList.add('hidden'); resolve(false); };
        newBtnOk.onclick = () => { modal.classList.add('hidden'); resolve(true); };
    });
}

// --- SECTION 2: MANAJEMEN BANK SOAL (MIGRATED) ---

async function loadQuestionBank() {
    const body = document.getElementById('pem-soal-body');
    const totalEl = document.getElementById('pem-total-soal');
    
    try {
        const data = await cfClient.getPeminatanConfig();

        if (data) {
            questionBank = data.items || [];
            currentLayout = data.layout || "classic";
            isQuestionnaireActive = data.isActive !== false;
            if (data.weights) currentWeights = data.weights;
            
            totalEl.innerText = questionBank.length;
            renderQuestionList();
            updateLayoutToggleUI();
            updateStatusToggleUI();
            updateWeightInputsUI();
            updateWeightTotal();
            updateRecommendationFooter();
        }
    } catch (e) {
        console.error("Load Questions Error:", e);
    }
}

function updateRecommendationFooter() {
    const footer = document.querySelector('#modal-detail-siswa p.italic');
    if (footer) {
        footer.innerText = `*Hasil dihitung berdasarkan pembobotan aspek Kemampuan (${currentWeights['Kemampuan']}%), Minat (${currentWeights['Minat']}%), Prestasi (${currentWeights['Prestasi']}%), Cita-cita (${currentWeights['Cita-cita']}%), dan Gaya Belajar (${currentWeights['Gaya Belajar']}%).`;
    }
}

function updateWeightInputsUI() {
    document.getElementById('weight-kemampuan').value = currentWeights['Kemampuan'];
    document.getElementById('weight-minat').value = currentWeights['Minat'];
    document.getElementById('weight-prestasi').value = currentWeights['Prestasi'];
    document.getElementById('weight-cita-cita').value = currentWeights['Cita-cita'];
    document.getElementById('weight-gaya-belajar').value = currentWeights['Gaya Belajar'];
}

function updateWeightTotal() {
    const k = parseInt(document.getElementById('weight-kemampuan').value) || 0;
    const m = parseInt(document.getElementById('weight-minat').value) || 0;
    const p = parseInt(document.getElementById('weight-prestasi').value) || 0;
    const c = parseInt(document.getElementById('weight-cita-cita').value) || 0;
    const g = parseInt(document.getElementById('weight-gaya-belajar').value) || 0;
    
    const total = k + m + p + c + g;
    const totalEl = document.getElementById('weight-total-display');
    if (totalEl) {
        totalEl.innerText = `${total}%`;
        if (total === 100) {
            totalEl.className = "text-sm font-bold text-emerald-600 dark:text-emerald-400";
        } else {
            totalEl.className = "text-sm font-bold text-rose-500 animate-pulse";
        }
    }
}

window.savePeminatanSettings = async () => {
    const total = parseInt(document.getElementById('weight-total-display').innerText);
    if (total !== 100) {
        return showToast("Peringatan", "Total bobot harus tepat 100% sebelum disimpan!", "warning");
    }

    const weights = {
        'Kemampuan': parseInt(document.getElementById('weight-kemampuan').value),
        'Minat': parseInt(document.getElementById('weight-minat').value),
        'Prestasi': parseInt(document.getElementById('weight-prestasi').value),
        'Cita-cita': parseInt(document.getElementById('weight-cita-cita').value),
        'Gaya Belajar': parseInt(document.getElementById('weight-gaya-belajar').value)
    };

    try {
        const payload = {
            weights: weights,
            layout: currentLayout,
            isActive: isQuestionnaireActive,
            items: questionBank
        };

        await cfClient.savePeminatanConfig(payload);

        currentWeights = weights;
        updateRecommendationFooter();
        showToast("Berhasil", "Seluruh pengaturan peminatan telah disimpan.", "success");
    } catch (e) {
        console.error("Save Settings Error:", e);
        showToast("Error", "Gagal menyimpan pengaturan.", "error");
    }
};

window.setLayoutMode = async (mode) => {
    currentLayout = mode;
    updateLayoutToggleUI();
    
    try {
        const payload = {
            layout: currentLayout,
            isActive: isQuestionnaireActive,
            weights: currentWeights,
            items: questionBank
        };
        await cfClient.savePeminatanConfig(payload);
        showToast("Berhasil", `Mode tampilan kuesioner diubah ke: ${mode.toUpperCase()}`, "success");
    } catch (e) {
        showToast("Error", "Gagal menyimpan mode tampilan.", "error");
    }
};

window.toggleQuestionnaireStatus = async () => {
    isQuestionnaireActive = !isQuestionnaireActive;
    updateStatusToggleUI();
    
    try {
        const payload = {
            isActive: isQuestionnaireActive,
            layout: currentLayout,
            weights: currentWeights,
            items: questionBank
        };
        await cfClient.savePeminatanConfig(payload);
        showToast("Berhasil", `Kuesioner ${isQuestionnaireActive ? 'DIBUKA' : 'DITUTUP'} untuk siswa.`, "success");
    } catch (e) {
        showToast("Error", "Gagal memperbarui status kuesioner.", "error");
    }
};

function updateLayoutToggleUI() {
    const btnClassic = document.getElementById('btn-layout-classic');
    const btnFocus = document.getElementById('btn-layout-focus');
    if (!btnClassic || !btnFocus) return;

    if (currentLayout === 'focus') {
        btnFocus.className = "px-3 py-1 text-[9px] font-bold rounded transition-all bg-indigo-600 text-white shadow-sm";
        btnClassic.className = "px-3 py-1 text-[9px] font-medium rounded transition-all text-slate-500 hover:text-indigo-600";
    } else {
        btnClassic.className = "px-3 py-1 text-[9px] font-bold rounded transition-all bg-indigo-600 text-white shadow-sm";
        btnFocus.className = "px-3 py-1 text-[9px] font-medium rounded transition-all text-slate-500 hover:text-indigo-600";
    }
}

function updateStatusToggleUI() {
    const btn = document.getElementById('btn-status-toggle');
    const icon = document.getElementById('status-icon');
    const text = document.getElementById('status-text');
    if (!btn || !icon || !text) return;

    if (isQuestionnaireActive) {
        btn.className = "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all shadow-sm border border-emerald-100 bg-emerald-50 text-emerald-600";
        icon.className = "fa-solid fa-circle text-[6px] animate-pulse";
        text.innerText = "AKTIF / DIBUKA";
    } else {
        btn.className = "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all shadow-sm border border-red-100 bg-red-50 text-red-600";
        icon.className = "fa-solid fa-circle-xmark";
        text.innerText = "NONAKTIF / TUTUP";
    }
}

function renderQuestionList() {
    const body = document.getElementById('pem-soal-body');
    body.innerHTML = '';

    if (questionBank.length === 0) {
        body.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-400 italic">Belum ada soal.</td></tr>';
        return;
    }

    questionBank.forEach((q, idx) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="px-4 py-3 font-mono font-bold text-indigo-600">${q.kode}</td>
            <td class="px-4 py-3"><input type="text" value="${escapeHTML(q.teks)}" class="w-full bg-transparent border-b border-transparent focus:border-indigo-500 outline-none" onchange="window.updateQuestion(${idx}, 'teks', this.value)"></td>
            <td class="px-4 py-3 text-slate-500">${q.aspek}</td>
            <td class="px-4 py-3 text-slate-500">${q.jurusan}</td>
            <td class="px-4 py-3"><span class="${q.sifat === 'Positif' ? 'text-emerald-500' : 'text-red-500'} font-bold">${q.sifat}</span></td>
            <td class="px-4 py-3 text-center">
                <button onclick="window.deleteQuestion(${idx})" class="text-red-400 hover:text-red-600"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        body.appendChild(row);
    });
}

window.updateQuestion = (idx, field, val) => {
    questionBank[idx][field] = val;
};

window.deleteQuestion = async (idx) => {
    const confirmed = await showConfirmModal(
        `Butir soal <b>${questionBank[idx]?.kode || ''}</b> akan dihapus dari daftar.<br>Perubahan belum permanen sampai Anda klik "Simpan Perubahan Soal".`,
        'Hapus Butir Soal',
        'danger'
    );
    if (confirmed) {
        questionBank.splice(idx, 1);
        renderQuestionList();
        document.getElementById('pem-total-soal').innerText = questionBank.length;
    }
};

window.savePeminatanChanges = async () => {
    const btn = document.querySelector('button[onclick="window.savePeminatanChanges()"]');
    const oldText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...';
    btn.disabled = true;

    try {
        const payload = {
            items: questionBank,
            weights: currentWeights,
            layout: currentLayout,
            isActive: isQuestionnaireActive
        };

        await cfClient.savePeminatanConfig(payload);
        showToast("Berhasil", "Bank soal telah diperbarui di Cloudflare D1.", "success");
    } catch (e) {
        console.error("Save Error:", e);
        showToast("Error", "Gagal menyimpan perubahan.", "error");
    } finally {
        btn.innerHTML = oldText;
        btn.disabled = false;
    }
};

window.processPeminatanImport = () => {
    const area = document.getElementById('pem-import-area');
    const raw = area.value.trim();
    if (!raw) return showToast("Peringatan", "Area paste masih kosong.", "warning");

    const lines = raw.split('\n');
    const newItems = [];
    let errorCount = 0;

    lines.forEach(line => {
        const cols = line.split('\t');
        if (cols.length >= 5) {
            newItems.push({
                kode: cols[0].trim(),
                teks: cols[1].trim(),
                aspek: cols[2].trim(),
                jurusan: cols[3].trim(),
                sifat: cols[4].trim() // Positif / Negatif
            });
        } else {
            errorCount++;
        }
    });

    if (newItems.length > 0) {
        questionBank = newItems;
        renderQuestionList();
        document.getElementById('pem-total-soal').innerText = questionBank.length;
        document.getElementById('view-q-import').classList.add('hidden');
        document.getElementById('view-q-list').classList.remove('hidden');
        document.getElementById('tab-q-import').className = "px-5 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-indigo-600 transition-all";
        document.getElementById('tab-q-list').className = "px-5 py-2 text-xs font-bold rounded-lg bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm transition-all";
        showToast("Berhasil", `${newItems.length} soal berhasil diproses. Klik Simpan untuk mempermanenkan.`, "success");
        if (errorCount > 0) showToast("Info", `${errorCount} baris diabaikan karena format tidak sesuai.`, "info");
    } else {
        showToast("Error", "Tidak ada data valid yang ditemukan.", "error");
    }
};

// --- ACTION HELPER ---

window.resetAttempt = async () => {
    if (!window.currentViewingNIS) return;
    const nama = document.getElementById('detail-nama')?.innerText || 'siswa ini';
    const confirmed = await showConfirmModal(
        `Semua data kuesioner milik <b>${nama}</b> akan dihapus secara permanen.<br><br>Siswa akan bisa mengisi ulang kuesioner dari awal.`,
        'Hapus & Reset Jawaban',
        'danger'
    );
    if (confirmed) {
        try {
            await cfClient.deletePeminatanResponse(currentYear, window.currentViewingNIS);
            showToast("Berhasil", "Data hasil telah dihapus.", "success");
            document.getElementById('modal-detail-siswa').classList.add('hidden');
            loadSubmissions(true); // Hapus cache lokal & paksa memuat ulang data dari database
        } catch (e) {
            showToast("Error", "Gagal menghapus data: " + e.message, "error");
        }
    }
};

window.exportToExcel = () => {
    if (allSubmissions.length === 0) return showToast("Info", "Tidak ada data untuk diekspor.", "info");
    
    try {
        // Sheet 1: Rekap Hasil
        const headerRow = ['No', 'Nama Siswa', 'NIS', 'Kelas', 'Rekomendasi', 'Skor IPA (%)', 'Skor IPS (%)', 'Skor Bahasa (%)', 'Tanggal Submit'];
        const dataRows = allSubmissions.map((s, i) => {
            const calc = recalculateScores(s.responses || {});
            const rawSubDate = s.submittedAt || s.submitted_at;
            const subDate = (typeof window.parseUniversalDate === 'function') 
                ? window.parseUniversalDate(rawSubDate) 
                : (rawSubDate ? new Date(rawSubDate) : null);
            const date = (subDate && !isNaN(subDate.getTime())) ? subDate.toLocaleString('id-ID') : '-';
            let rec = 'IPA', maxVal = -1;
            ['IPA', 'IPS', 'Bahasa'].forEach(m => {
                if (calc[m].Total > maxVal) { maxVal = calc[m].Total; rec = m; }
            });
            return [
                i + 1,
                s.name,
                s.nis || '-',
                s.class || '-',
                rec,
                Math.round(calc.IPA.Total || 0),
                Math.round(calc.IPS.Total || 0),
                Math.round(calc.Bahasa.Total || 0),
                date
            ];
        });

        // Title rows
        const titleRows = [
            ['REKAP HASIL KUESIONER PEMINATAN SISWA'],
            [`Tahun: ${currentYear}`, '', `Kelas: ${currentKelas || 'Semua'}`, '', `Diekspor: ${new Date().toLocaleString('id-ID')}`],
            [] // empty row
        ];

        const sheetData = [...titleRows, headerRow, ...dataRows];
        const ws = XLSX.utils.aoa_to_sheet(sheetData);

        // Column widths
        ws['!cols'] = [
            { wch: 5 },  // No
            { wch: 30 }, // Nama
            { wch: 15 }, // NIS
            { wch: 12 }, // Kelas
            { wch: 14 }, // Rekomendasi
            { wch: 14 }, // IPA
            { wch: 14 }, // IPS
            { wch: 14 }, // Bahasa
            { wch: 22 }  // Tanggal
        ];

        // Merge title row
        ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }];

        // Sheet 2: Detail Skor Per Aspek
        const detailHeader = ['No', 'Nama', 'NIS', 'Kelas',
            'IPA-Kemampuan', 'IPA-Minat', 'IPA-Prestasi', 'IPA-Cita-cita', 'IPA-Gaya Belajar', 'IPA-Total',
            'IPS-Kemampuan', 'IPS-Minat', 'IPS-Prestasi', 'IPS-Cita-cita', 'IPS-Gaya Belajar', 'IPS-Total',
            'Bahasa-Kemampuan', 'Bahasa-Minat', 'Bahasa-Prestasi', 'Bahasa-Cita-cita', 'Bahasa-Gaya Belajar', 'Bahasa-Total',
            'Rekomendasi'
        ];
        const detailRows = allSubmissions.map((s, i) => {
            const calc = recalculateScores(s.responses || {});
            let rec = 'IPA', maxVal = -1;
            ['IPA', 'IPS', 'Bahasa'].forEach(m => {
                if (calc[m].Total > maxVal) { maxVal = calc[m].Total; rec = m; }
            });
            const aspects = ['Kemampuan', 'Minat', 'Prestasi', 'Cita-cita', 'Gaya Belajar'];
            const row = [i + 1, s.name, s.nis || '-', s.class || '-'];
            ['IPA', 'IPS', 'Bahasa'].forEach(jur => {
                aspects.forEach(asp => row.push(Math.round(calc[jur]?.[asp] || 0)));
                row.push(Math.round(calc[jur].Total || 0));
            });
            row.push(rec);
            return row;
        });

        const ws2 = XLSX.utils.aoa_to_sheet([detailHeader, ...detailRows]);
        ws2['!cols'] = [{ wch: 5 }, { wch: 28 }, { wch: 12 }, { wch: 10 },
            ...Array(18).fill({ wch: 12 }), { wch: 14 }];

        // Sheet 3: Statistik Ringkasan
        const dist = { IPA: 0, IPS: 0, Bahasa: 0 };
        let sumIPA = 0, sumIPS = 0, sumBahasa = 0;
        allSubmissions.forEach(s => {
            const calc = recalculateScores(s.responses || {});
            let rec = 'IPA', maxV = -1;
            ['IPA', 'IPS', 'Bahasa'].forEach(m => {
                if (calc[m].Total > maxV) { maxV = calc[m].Total; rec = m; }
            });
            dist[rec]++;
            sumIPA += calc.IPA.Total || 0;
            sumIPS += calc.IPS.Total || 0;
            sumBahasa += calc.Bahasa.Total || 0;
        });
        const total = allSubmissions.length;
        const statsData = [
            ['STATISTIK RINGKASAN'],
            [],
            ['Jumlah Pengisi', total],
            [],
            ['Distribusi Rekomendasi'],
            ['Jurusan', 'Jumlah', 'Persentase'],
            ['IPA', dist.IPA, `${Math.round(dist.IPA / total * 100)}%`],
            ['IPS', dist.IPS, `${Math.round(dist.IPS / total * 100)}%`],
            ['Bahasa', dist.Bahasa, `${Math.round(dist.Bahasa / total * 100)}%`],
            [],
            ['Rata-rata Skor'],
            ['Jurusan', 'Rata-rata (%)'],
            ['IPA', `${Math.round(sumIPA / total)}%`],
            ['IPS', `${Math.round(sumIPS / total)}%`],
            ['Bahasa', `${Math.round(sumBahasa / total)}%`],
            [],
            ['Pembobotan Aspek'],
            ['Aspek', 'Bobot'],
            ['Kemampuan', `${currentWeights['Kemampuan']}%`],
            ['Minat', `${currentWeights['Minat']}%`],
            ['Prestasi', `${currentWeights['Prestasi']}%`],
            ['Cita-cita', `${currentWeights['Cita-cita']}%`],
            ['Gaya Belajar', `${currentWeights['Gaya Belajar']}%`]
        ];
        const ws3 = XLSX.utils.aoa_to_sheet(statsData);
        ws3['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 15 }];

        // Helper untuk styling baris berdasarkan rekomendasi
        const applyRowStyles = (sheet, startRow, dataLength, maxCol, recColIdx) => {
            for (let i = 0; i < dataLength; i++) {
                const r = startRow + i;
                const recCellRef = XLSX.utils.encode_cell({ r: r, c: recColIdx });
                if (!sheet[recCellRef]) continue;
                const rec = sheet[recCellRef].v;

                let bgColor, fontColor;
                if (rec === 'IPA') { bgColor = 'D1FAE5'; fontColor = '065F46'; } // Emerald 100/800
                else if (rec === 'IPS') { bgColor = 'FEF3C7'; fontColor = '92400E'; } // Amber 100/800
                else if (rec === 'Bahasa') { bgColor = 'E0E7FF'; fontColor = '3730A3'; } // Indigo 100/800
                else continue;

                for (let c = 0; c <= maxCol; c++) {
                    const cellRef = XLSX.utils.encode_cell({ r: r, c: c });
                    if (!sheet[cellRef]) continue;
                    sheet[cellRef].s = {
                        fill: { fgColor: { rgb: bgColor } },
                        font: { color: { rgb: fontColor } }
                    };
                }
            }
        };

        const styleHeader = (sheet, r, maxCol) => {
            for (let c = 0; c <= maxCol; c++) {
                const cellRef = XLSX.utils.encode_cell({ r: r, c: c });
                if (!sheet[cellRef]) continue;
                sheet[cellRef].s = {
                    font: { bold: true, color: { rgb: "1F2937" } },
                    fill: { fgColor: { rgb: "F3F4F6" } }
                };
            }
        };

        // Terapkan styling ke Sheet 1 (Rekap Hasil)
        styleHeader(ws, 3, 8); // Header row is at index 3
        applyRowStyles(ws, 4, dataRows.length, 8, 4);

        // Terapkan styling ke Sheet 2 (Detail Per Aspek)
        styleHeader(ws2, 0, 22); // Header row is at index 0
        applyRowStyles(ws2, 1, detailRows.length, 22, 22);

        // Create Workbook
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Rekap Hasil');
        XLSX.utils.book_append_sheet(wb, ws2, 'Detail Per Aspek');
        XLSX.utils.book_append_sheet(wb, ws3, 'Statistik');

        XLSX.writeFile(wb, `Peminatan_${currentYear}_${currentKelas || 'Semua'}.xlsx`);
        showToast("Berhasil", "File Excel berhasil diunduh.", "success");
    } catch (e) {
        console.error('Export Error:', e);
        showToast("Error", "Gagal mengekspor data.", "error");
    }
};

window.printResult = async () => {
    const modal = document.getElementById('modal-detail-siswa');
    const modalContent = modal.querySelector('.bg-white, .dark\\:bg-slate-900');
    if (!modalContent) { window.print(); return; }

    const btn = modal.querySelector('button[onclick="window.printResult()"]');
    const oldText = btn?.innerHTML;
    if (btn) { btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Memproses Gambar...'; btn.disabled = true; }

    // Sembunyikan elemen yang tidak perlu di-screenshot (footer, tombol close, dan breakdown jawaban)
    const breakdown = document.getElementById('raw-responses-container');
    const breakdownHeader = breakdown?.previousElementSibling;
    const footer = modalContent.lastElementChild; // Ambil elemen footer secara absolut
    const closeBtn = modalContent.querySelector('button .fa-times')?.parentElement;
    
    if (breakdown) breakdown.style.display = 'none';
    if (breakdownHeader) breakdownHeader.style.display = 'none';
    if (footer) footer.style.display = 'none';
    if (closeBtn) closeBtn.style.display = 'none';

    // Matikan animasi chart sementara agar render html2canvas sempurna
    if (window.kelasChart && window.kelasChart.update) {
        window.kelasChart.options.animation = false;
        window.kelasChart.update('none');
    }

    try {
        const canvas = await html2canvas(modalContent, {
            scale: 2, // Resolusi tinggi
            backgroundColor: '#ffffff', // Paksa background putih
            logging: false,
            useCORS: true
        });

        // Kembalikan elemen yang disembunyikan
        if (breakdown) breakdown.style.display = '';
        if (breakdownHeader) breakdownHeader.style.display = '';
        if (footer) footer.style.display = '';
        if (closeBtn) closeBtn.style.display = '';

        canvas.toBlob(async (blob) => {
            if (!blob) throw new Error("Gagal membuat blob gambar");
            
            // 1. Download Gambar
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const nama = document.getElementById('detail-nama')?.innerText || 'Siswa';
            a.download = `Hasil_Peminatan_${nama.replace(/\s+/g, '_')}.png`;
            a.click();
            URL.revokeObjectURL(url);

            // 2. Copy ke Clipboard
            try {
                if (navigator.clipboard && navigator.clipboard.write) {
                    const item = new ClipboardItem({ 'image/png': blob });
                    await navigator.clipboard.write([item]);
                    showToast("Selesai", "Gambar terunduh & berhasil di-copy ke clipboard! Silakan paste (Ctrl+V) di WA.", "success");
                } else {
                    showToast("Selesai", "Gambar berhasil diunduh. (Browser tidak mendukung auto-copy clipboard)", "success");
                }
            } catch (clipErr) {
                console.error("Clipboard API Error:", clipErr);
                showToast("Selesai", "Gambar berhasil diunduh. (Gagal copy otomatis, silakan kirim file manual)", "success");
            }
        }, 'image/png');

    } catch (e) {
        console.error('Image Capture Error:', e);
        showToast("Error", "Gagal memproses gambar.", "error");
        
        // Kembalikan elemen jika error
        if (breakdown) breakdown.style.display = '';
        if (breakdownHeader) breakdownHeader.style.display = '';
        if (footer) footer.style.display = '';
        if (closeBtn) closeBtn.style.display = '';
    } finally {
        if (btn) { btn.innerHTML = oldText; btn.disabled = false; }
        if (window.kelasChart && window.kelasChart.update) {
            window.kelasChart.options.animation = { duration: 1000 };
            window.kelasChart.update();
        }
    }
};

// --- VIEW MODE TOGGLE (Sudah/Belum Mengisi) ---

window.setViewMode = (mode) => {
    if (!currentYear || !currentKelas) {
        showToast("Info", "Pilih Tahun dan Kelas terlebih dahulu.", "info");
        return;
    }
    currentViewMode = mode;
    const btnSudah = document.getElementById('btn-view-sudah');
    const btnBelum = document.getElementById('btn-view-belum');
    const tableSection = document.getElementById('table-sudah-container');
    const belumSection = document.getElementById('view-belum-mengisi');
    const statsSummary = document.getElementById('stats-summary');
    const chartKelasWrapper = document.getElementById('chart-distribusi-kelas-wrapper');

    if (mode === 'sudah') {
        btnSudah.className = 'px-4 py-2 text-[10px] font-bold rounded-lg bg-white dark:bg-slate-700 text-indigo-600 shadow-sm transition-all';
        btnBelum.className = 'px-4 py-2 text-[10px] font-bold rounded-lg text-slate-500 hover:text-indigo-600 transition-all';
        if (tableSection) tableSection.classList.remove('hidden');
        belumSection.classList.add('hidden');
        if (statsSummary && allSubmissions.length > 0) statsSummary.classList.remove('hidden');
        if (chartKelasWrapper && currentKelas === 'ALL' && allSubmissions.length > 0) chartKelasWrapper.classList.remove('hidden');
    } else {
        btnBelum.className = 'px-4 py-2 text-[10px] font-bold rounded-lg bg-white dark:bg-slate-700 text-amber-600 shadow-sm transition-all';
        btnSudah.className = 'px-4 py-2 text-[10px] font-bold rounded-lg text-slate-500 hover:text-indigo-600 transition-all';
        if (tableSection) tableSection.classList.add('hidden');
        belumSection.classList.remove('hidden');
        if (statsSummary) statsSummary.classList.add('hidden');
        if (chartKelasWrapper) chartKelasWrapper.classList.add('hidden');
        loadBelumMengisi();
    }
};

function formatBirthDate(birthDateStr) {
    if (!birthDateStr) return '-';
    const parts = birthDateStr.split('-');
    if (parts.length === 3) {
        const y = parts[0];
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        if (m >= 1 && m <= 12) {
            return `${d} ${months[m - 1]} ${y}`;
        }
    }
    return birthDateStr;
}

async function loadBelumMengisi() {
    const body = document.getElementById('belum-mengisi-body');
    const emptyEl = document.getElementById('belum-empty');
    const countLabel = document.getElementById('belum-count-label');
    body.innerHTML = `<tr><td colspan="6" class="p-8 text-center"><i class="fa-solid fa-spinner fa-spin text-indigo-500 text-xl"></i></td></tr>`;
    emptyEl.classList.add('hidden');

    try {
        // Ambil data siswa kelas X dari cache session atau Firestore
        let allStudentsX = [];
        const cacheKey = `students_x_${currentKelas}`;
        const cached = sessionStorage.getItem(cacheKey);

        if (cached && cachedStudentsX) {
            allStudentsX = cachedStudentsX;
        } else {
            let loadedList = [];
            if (typeof window.getStudentsCache === 'function') {
                try {
                    const cacheAll = await window.getStudentsCache();
                    if (Array.isArray(cacheAll) && cacheAll.length > 0) {
                        loadedList = cacheAll;
                    }
                } catch (e) {}
            }

            if (loadedList.length === 0 && cfClient && cfClient.enabled) {
                try {
                    const cfList = await cfClient.getStudents({ limit: 1500 });
                    if (Array.isArray(cfList) && cfList.length > 0) {
                        loadedList = cfList;
                    }
                } catch (e) {}
            }

            if (loadedList.length > 0) {
                loadedList.forEach(s => {
                    const c = s.class || s.kelas || '';
                    const matchClass = (!currentKelas || currentKelas === 'ALL')
                        ? (c.startsWith('X') && !c.startsWith('XI'))
                        : (c === currentKelas);
                    if (matchClass) {
                        allStudentsX.push({
                            nis: s.nis || s.id,
                            name: s.name,
                            class: c,
                            birthDate: s.birthDate || '',
                            nisn: s.nisn || ''
                        });
                    }
                });
            }
            cachedStudentsX = allStudentsX;
            sessionStorage.setItem(cacheKey, 'cached');
        }

        // Cross-reference: cari yang belum ada di allSubmissions
        const submittedNIS = new Set(allSubmissions.map(s => s.nis));
        let belumMengisi = allStudentsX.filter(s => !submittedNIS.has(s.nis));

        const searchVal = document.getElementById('search-siswa').value.toLowerCase();
        if (searchVal) {
            belumMengisi = belumMengisi.filter(s => 
                (s.name && s.name.toLowerCase().includes(searchVal)) || 
                (s.nis && s.nis.toLowerCase().includes(searchVal))
            );
        }

        // Sort by class then name
        belumMengisi.sort((a, b) => a.class.localeCompare(b.class) || a.name.localeCompare(b.name));

        countLabel.innerText = `${belumMengisi.length} siswa`;

        if (belumMengisi.length === 0) {
            body.innerHTML = '';
            emptyEl.classList.remove('hidden');
            return;
        }

        body.innerHTML = '';
        belumMengisi.forEach((s, i) => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors';
            row.innerHTML = `
                <td class="px-6 py-3 text-xs text-slate-400 font-bold">${i + 1}</td>
                <td class="px-6 py-3 font-bold text-slate-800 dark:text-white text-sm">${escapeHTML(s.name)}</td>
                <td class="px-6 py-3 text-xs text-slate-500 font-mono">${s.nis}</td>
                <td class="px-6 py-3 text-xs text-slate-500 font-mono">${s.nisn || '-'}</td>
                <td class="px-6 py-3 text-xs text-slate-500">${formatBirthDate(s.birthDate)}</td>
                <td class="px-6 py-3 text-xs text-indigo-600 dark:text-indigo-400 font-bold">${escapeHTML(s.class)}</td>
            `;
            body.appendChild(row);
        });
    } catch (e) {
        console.error('Load Belum Mengisi Error:', e);
        body.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-red-500 font-bold text-xs">Gagal memuat data siswa.</td></tr>`;
    }
}

// --- CHART DISTRIBUSI PER KELAS (#11) ---

function renderKelasChart() {
    const wrapper = document.getElementById('chart-distribusi-kelas-wrapper');
    if (!allSubmissions.length || currentKelas !== 'ALL') {
        wrapper.classList.add('hidden');
        return;
    }
    wrapper.classList.remove('hidden');

    // Group submissions by class
    const klasMap = {};
    allSubmissions.forEach(s => {
        const kls = s.class || 'Lainnya';
        if (!klasMap[kls]) klasMap[kls] = { IPA: 0, IPS: 0, Bahasa: 0 };
        const calc = recalculateScores(s.responses || {});
        let rec = 'IPA', maxV = -1;
        ['IPA', 'IPS', 'Bahasa'].forEach(m => {
            if (calc[m].Total > maxV) { maxV = calc[m].Total; rec = m; }
        });
        klasMap[kls][rec]++;
    });

    const labels = Object.keys(klasMap).sort();
    const dataIPA = labels.map(k => klasMap[k].IPA);
    const dataIPS = labels.map(k => klasMap[k].IPS);
    const dataBahasa = labels.map(k => klasMap[k].Bahasa);

    const isDark = document.documentElement.classList.contains('dark');
    const ctx = document.getElementById('chart-distribusi-kelas').getContext('2d');

    if (kelasChart) {
        kelasChart.data.labels = labels;
        kelasChart.data.datasets[0].data = dataIPA;
        kelasChart.data.datasets[1].data = dataIPS;
        kelasChart.data.datasets[2].data = dataBahasa;
        kelasChart.update('active');
    } else {
        kelasChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    { label: 'IPA', data: dataIPA, backgroundColor: '#10b981', borderRadius: 4 },
                    { label: 'IPS', data: dataIPS, backgroundColor: '#f59e0b', borderRadius: 4 },
                    { label: 'Bahasa', data: dataBahasa, backgroundColor: '#6366f1', borderRadius: 4 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { usePointStyle: true, pointStyle: 'circle', padding: 15, font: { size: 10, weight: 'bold' } }
                    },
                    tooltip: {
                        callbacks: { label: (c) => ` ${c.dataset.label}: ${c.raw} siswa` }
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        grid: { display: false },
                        ticks: { font: { size: 10, weight: 'bold' }, color: isDark ? '#94a3b8' : '#64748b' }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        ticks: { stepSize: 1, font: { size: 10 }, color: isDark ? '#94a3b8' : '#64748b' },
                        grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }
                    }
                },
                animation: { duration: 600, easing: 'easeOutQuart' }
            }
        });
    }
}

// Search Logic
document.getElementById('search-siswa').oninput = (e) => {
    applyFilters();
};

// --- PRINT EVENT FIX FOR CHARTS ---
window.addEventListener('beforeprint', () => {
    if (window.radarChart) {
        window.radarChart.options.scales.r.grid.color = 'rgba(0, 0, 0, 0.4)';
        window.radarChart.options.scales.r.angleLines.color = 'rgba(0, 0, 0, 0.4)';
        window.radarChart.options.scales.r.pointLabels.color = '#000';
        window.radarChart.update('none'); // KEY: skip animation for instant print
    }
    if (window.kelasChart) {
        window.kelasChart.options.scales.y.grid.color = 'rgba(0, 0, 0, 0.3)';
        window.kelasChart.options.scales.x.ticks.color = '#000';
        window.kelasChart.options.scales.y.ticks.color = '#000';
        window.kelasChart.update('none');
    }
});

window.addEventListener('afterprint', () => {
    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
    const labelColor = isDark ? '#94a3b8' : '#64748b';
    
    if (window.radarChart) {
        window.radarChart.options.scales.r.grid.color = gridColor;
        window.radarChart.options.scales.r.angleLines.color = gridColor;
        window.radarChart.options.scales.r.pointLabels.color = labelColor;
        window.radarChart.update('none');
    }
    if (window.kelasChart) {
        window.kelasChart.options.scales.y.grid.color = gridColor;
        window.kelasChart.options.scales.x.ticks.color = labelColor;
        window.kelasChart.options.scales.y.ticks.color = labelColor;
        window.kelasChart.update('none');
    }
});
