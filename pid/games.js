/**
 * Portal Game Interaktif PID
 * Data SSOT: Cloudflare D1 SQL (/api/pid-games)
 * Strategi hemat kuota: LocalStorage cache + metadata timestamp check
 */

// ==================== SCHOOL CONFIG (SSOT) ====================
function getSchoolConfig() {
    return (typeof window !== 'undefined' && window.SCHOOL_CONFIG) ? window.SCHOOL_CONFIG : {
        appName: 'SIMAS',
        schoolName: "SMA Negeri Nusantara",
        schoolShortName: "SMANTARA"
    };
}

// ==================== CACHE ====================
const CACHE_KEY = 'pid_games_data';
const CACHE_TS_KEY = 'pid_games_ts';

// ==================== STATE ====================
let allGames = [];
let activePrimaryTab = 'all'; // 'all' | 'learning' | 'casual'
let activeCategory = 'all';
let searchQuery = '';

// ==================== CLASSIFICATION & PARSING HELPERS ====================
function parseGameSubjects(subjectField) {
    if (!subjectField) return [];
    if (Array.isArray(subjectField)) return subjectField.map(s => String(s).trim()).filter(Boolean);
    if (typeof subjectField === 'string') {
        const trimmed = subjectField.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) return parsed.map(s => String(s).trim()).filter(Boolean);
            } catch (e) {}
        }
        return trimmed.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    }
    return [String(subjectField).trim()].filter(Boolean);
}

function isLearningGame(game) {
    const subjects = parseGameSubjects(game?.subject);
    return subjects.some(s => {
        const norm = s.toUpperCase();
        return norm !== 'UMUM' && norm !== 'ICE BREAKING';
    });
}

function isCasualGame(game) {
    const subjects = parseGameSubjects(game?.subject);
    if (subjects.length === 0) return true;
    const hasCasualTag = subjects.some(s => {
        const norm = s.toUpperCase();
        return norm === 'UMUM' || norm === 'ICE BREAKING';
    });
    return hasCasualTag || !isLearningGame(game);
}

// Export global untuk pengujian unit Jest & interoperabilitas
if (typeof window !== 'undefined') {
    window.parseGameSubjects = parseGameSubjects;
    window.isLearningGame = isLearningGame;
    window.isCasualGame = isCasualGame;
}

// ==================== CATEGORY CONFIG ====================
const CAT = {
    kuis:        { label: 'Kuis & Trivia', icon: '❓', emoji: '❓' },
    puzzle:      { label: 'Puzzle & Logika', icon: '🧩', emoji: '🧩' },
    simulasi:    { label: 'Simulasi & Eksperimen', icon: '🔬', emoji: '🔬' },
    arcade:      { label: 'Arcade & Ketangkasan', icon: '🕹️', emoji: '🕹️' },
    flashcard:   { label: 'Flashcard & Hafalan', icon: '🎴', emoji: '🎴' },
    petualangan: { label: 'Petualangan / Roleplay', icon: '🗺️', emoji: '🗺️' },
    kreativitas: { label: 'Kreativitas & Desain', icon: '🎨', emoji: '🎨' },
    lainnya:     { label: 'Lainnya', icon: '✨', emoji: '✨' }
};

// Pastel card color rotation
const CARD_COLORS = [
    'card-green', 'card-orange', 'card-teal', 'card-red',
    'card-purple', 'card-blue', 'card-pink', 'card-yellow'
];

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    // Inisialisasi hanya jika berada pada halaman Portal PID (memiliki kontainer #game-grid)
    if (document.getElementById('game-grid')) {
        setupMobileMenu();
        setupDiscoveryTabs();
        setupGameDetailModalEvents();
        setupSearch();
        loadGames();
    }
});

// ==================== MOBILE SIDEBAR ====================
function setupMobileMenu() {
    const toggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!toggle || !sidebar || !overlay) return;

    toggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('show');
    });

    overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
    });
}

// ==================== GAME DETAIL MODAL LISTENER ====================
function setupGameDetailModalEvents() {
    const modal = document.getElementById('modal-game-detail');
    if (!modal) return;

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeGameDetailModal();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeGameDetailModal();
        }
    });
}

// ==================== LOAD GAMES ====================
async function loadGames() {
    try {
        const cfWorkerUrl = 'https://simas-smagesa-api.komangpurna1.workers.dev';

        // 1. Cek timestamp update via Cloudflare API
        let serverTs = 0;
        try {
            const cfgRes = await fetch(`${cfWorkerUrl}/api/pid-games/config`);
            if (cfgRes.ok) {
                const cfgJson = await cfgRes.json();
                const lu = cfgJson.data?.last_updated;
                serverTs = lu ? new Date(lu).getTime() : 0;
            }
        } catch (cfgErr) {
            console.warn('[PID Games] Gagal cek config timestamp:', cfgErr);
        }

        const cachedTs = parseInt(localStorage.getItem(CACHE_TS_KEY) || '0');
        const cachedData = localStorage.getItem(CACHE_KEY);

        if (cachedData && serverTs > 0 && serverTs === cachedTs) {
            allGames = JSON.parse(cachedData);
            window.allGames = allGames;
            renderAll();
            return;
        }

        // 2. Fetch all games from Cloudflare D1
        const resp = await fetch(`${cfWorkerUrl}/api/pid-games?status=all`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        const rawGames = json.data || [];

        allGames = rawGames.sort((a, b) => {
            const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
            const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
            return tb - ta;
        });

        window.allGames = allGames;

        localStorage.setItem(CACHE_KEY, JSON.stringify(allGames));
        if (serverTs > 0) {
            localStorage.setItem(CACHE_TS_KEY, String(serverTs));
        }

        renderAll();

    } catch (err) {
        console.error('Gagal memuat game dari Cloudflare:', err);
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            allGames = JSON.parse(cached);
            window.allGames = allGames;
            renderAll();
        } else {
            showEmpty('Gagal memuat data game 😢');
        }
    }
}

function isPubliclyVisibleGame(game) {
    return game?.is_active !== false;
}

function isOwnerGame(game, viewerUid) {
    return Boolean(viewerUid) && game?.submitted_by_uid === viewerUid;
}

function isAuthorGame(game, viewerName) {
    if (!game?.author || game.author === 'none' || !viewerName) return false;
    const cleanAuthor = String(game.author).trim().toLowerCase().replace(/[,.]/g, '');
    const cleanViewer = String(viewerName).trim().toLowerCase().replace(/[,.]/g, '');
    if (!cleanAuthor || !cleanViewer) return false;
    return cleanAuthor === cleanViewer || cleanAuthor.includes(cleanViewer) || cleanViewer.includes(cleanAuthor);
}

function getViewerInfo() {
    const viewerRole = window.pidPortalViewer?.role || localStorage.getItem('user_role') || '';
    const viewerUid = window.auth?.currentUser?.uid || window.pidPortalViewer?.uid || localStorage.getItem('user_uid') || null;
    const viewerName = window.pidPortalViewer?.name ||
        (viewerUid ? localStorage.getItem(`cached_user_name_${viewerUid}`) : null) ||
        localStorage.getItem('user_name') ||
        window.auth?.currentUser?.displayName ||
        '';
    return { role: viewerRole, uid: viewerUid, name: viewerName };
}

function getVisibleGames() {
    const viewer = getViewerInfo();
    return allGames.filter(game => {
        if (isPubliclyVisibleGame(game)) return true;
        if (viewer.role === 'super_admin') return true;
        return isOwnerGame(game, viewer.uid) || isAuthorGame(game, viewer.name);
    });
}

function canUserEditGame(game) {
    if (!game) return false;
    const viewer = getViewerInfo();
    if (viewer.role === 'super_admin') return true;

    // Guru yang mengajukan game (owner) atau GTK yang tercatat sebagai author bisa edit game miliknya
    return isOwnerGame(game, viewer.uid) || isAuthorGame(game, viewer.name);
}

function getGameStatusBadge(game) {
    const viewer = getViewerInfo();
    const isOwner = isOwnerGame(game, viewer.uid);
    const isAuthor = isAuthorGame(game, viewer.name);
    const isSuperAdmin = viewer.role === 'super_admin';

    if (!isSuperAdmin && !isOwner && !isAuthor) return '';

    if (game.is_active === false) {
        return '<div class="card-status-badge status-badge-hidden">👁️ Tidak Tayang</div>';
    }

    if (isSuperAdmin) {
        return '<div class="card-status-badge status-badge-active">🟢 Tayang</div>';
    }

    return '';
}

window.refreshPidGamesVisibility = function refreshPidGamesVisibility() {
    if (!Array.isArray(allGames) || allGames.length === 0) return;
    window.allGames = allGames;
    renderAll();
};

// ==================== DISCOVERY TABS & MODE ====================
function setupDiscoveryTabs() {
    const tabWrap = document.getElementById('discovery-tabs');
    if (tabWrap) {
        tabWrap.addEventListener('click', (e) => {
            const btn = e.target.closest('.discovery-tab');
            if (!btn) return;
            const mode = btn.dataset.mode;
            if (!mode) return;
            setDiscoveryMode(mode);
        });
    }

    const btnSemua = document.getElementById('btn-semua');
    if (btnSemua) {
        btnSemua.onclick = () => {
            setDiscoveryMode('all');
        };
    }
}

function setDiscoveryMode(mode) {
    activePrimaryTab = mode || 'all';
    activeCategory = 'all';

    // Update active styles on discovery tabs
    document.querySelectorAll('.discovery-tab').forEach(b => {
        const isActive = b.dataset.mode === activePrimaryTab;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    const btnSemua = document.getElementById('btn-semua');
    if (btnSemua) {
        btnSemua.classList.toggle('active', activePrimaryTab === 'all');
    }

    renderAll();
}

// ==================== RENDER ALL ====================
function renderAll() {
    renderSidebarNav();
    renderGrid();
}

// ==================== SIDEBAR NAV ====================
function renderSidebarNav() {
    const nav = document.getElementById('sidebar-nav');
    if (!nav) return;

    const visibleGames = getVisibleGames();
    const allCount = visibleGames.length;
    const learningGames = visibleGames.filter(isLearningGame);
    const casualGames = visibleGames.filter(isCasualGame);

    // Update counter badges di Discovery Tabs dan Toolbar
    const elAll = document.getElementById('tab-count-all');
    if (elAll) elAll.textContent = allCount;
    const elLearn = document.getElementById('tab-count-learning');
    if (elLearn) elLearn.textContent = learningGames.length;
    const elCas = document.getElementById('tab-count-casual');
    if (elCas) elCas.textContent = casualGames.length;

    const navCountAll = document.getElementById('nav-count-all');
    if (navCountAll) navCountAll.textContent = allCount;

    // Tentukan pool data game untuk navigasi sidebar aktif
    let currentPool = visibleGames;
    let defaultLabel = 'Semua Game';
    let defaultIco = '🎮';

    if (activePrimaryTab === 'learning') {
        currentPool = learningGames;
        defaultLabel = 'Semua Pelajaran';
        defaultIco = '📚';
    } else if (activePrimaryTab === 'casual') {
        currentPool = casualGames;
        defaultLabel = 'Semua Santai';
        defaultIco = '🕹️';
    }

    // Bersihkan nav
    nav.innerHTML = '';

    // Tombol Utama "Semua" di dalam sidebar
    const btnMainAll = document.createElement('button');
    btnMainAll.className = `nav-btn ${activeCategory === 'all' ? 'active' : ''}`;
    btnMainAll.dataset.category = 'all';
    btnMainAll.innerHTML = `
        <span class="ico">${defaultIco}</span>
        <span>${defaultLabel}</span>
        <span class="nav-count">${currentPool.length}</span>
    `;
    nav.appendChild(btnMainAll);

    if (activePrimaryTab === 'learning') {
        // 1. Ekstrak Mata Pelajaran Aktif (selain Umum dan Ice Breaking)
        const mapelCounts = new Map();
        learningGames.forEach(g => {
            const subs = parseGameSubjects(g.subject);
            subs.forEach(s => {
                const norm = s.trim();
                const up = norm.toUpperCase();
                if (norm && up !== 'UMUM' && up !== 'ICE BREAKING') {
                    mapelCounts.set(norm, (mapelCounts.get(norm) || 0) + 1);
                }
            });
        });

        if (mapelCounts.size > 0) {
            const headerMapel = document.createElement('div');
            headerMapel.className = 'sidebar-section-header';
            headerMapel.textContent = 'MATA PELAJARAN';
            nav.appendChild(headerMapel);

            const sortedMapels = Array.from(mapelCounts.keys()).sort((a, b) => a.localeCompare(b, 'id'));
            sortedMapels.forEach(mapelName => {
                const count = mapelCounts.get(mapelName) || 0;
                const catKey = `subj:${mapelName}`;
                const btn = document.createElement('button');
                btn.className = `nav-btn ${activeCategory === catKey ? 'active' : ''}`;
                btn.dataset.category = catKey;
                btn.innerHTML = `
                    <span class="ico">📖</span>
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(mapelName)}</span>
                    <span class="nav-count">${count}</span>
                `;
                nav.appendChild(btn);
            });
        }

        // 2. Kategori Edukasi yang tersedia di game pembelajaran
        const catCounts = new Map();
        learningGames.forEach(g => {
            const cats = Array.isArray(g.category) ? g.category : [g.category || 'lainnya'];
            cats.forEach(c => {
                catCounts.set(c, (catCounts.get(c) || 0) + 1);
            });
        });

        if (catCounts.size > 0) {
            const headerKat = document.createElement('div');
            headerKat.className = 'sidebar-section-header';
            headerKat.textContent = 'KATEGORI EDUKASI';
            nav.appendChild(headerKat);

            const sortedCats = Array.from(catCounts.keys()).sort();
            sortedCats.forEach(cat => {
                const cfg = CAT[cat] || CAT.lainnya;
                const count = catCounts.get(cat) || 0;
                const btn = document.createElement('button');
                btn.className = `nav-btn ${activeCategory === cat ? 'active' : ''}`;
                btn.dataset.category = cat;
                btn.innerHTML = `
                    <span class="ico">${cfg.icon}</span>
                    <span>${cfg.label}</span>
                    <span class="nav-count">${count}</span>
                `;
                nav.appendChild(btn);
            });
        }

    } else if (activePrimaryTab === 'casual') {
        // Tampilkan Kategori Genre untuk Game Santai & Ice Breaking
        const catCounts = new Map();
        casualGames.forEach(g => {
            const cats = Array.isArray(g.category) ? g.category : [g.category || 'lainnya'];
            cats.forEach(c => {
                catCounts.set(c, (catCounts.get(c) || 0) + 1);
            });
        });

        const headerGenre = document.createElement('div');
        headerGenre.className = 'sidebar-section-header';
        headerGenre.textContent = 'GENRE & AKTIVITAS';
        nav.appendChild(headerGenre);

        const sortedCats = Array.from(catCounts.keys()).sort();
        sortedCats.forEach(cat => {
            const cfg = CAT[cat] || CAT.lainnya;
            const count = catCounts.get(cat) || 0;
            const btn = document.createElement('button');
            btn.className = `nav-btn ${activeCategory === cat ? 'active' : ''}`;
            btn.dataset.category = cat;
            btn.innerHTML = `
                <span class="ico">${cfg.icon}</span>
                <span>${cfg.label}</span>
                <span class="nav-count">${count}</span>
            `;
            nav.appendChild(btn);
        });

    } else {
        // Mode 'all': tampilkan seluruh kategori
        const catCounts = new Map();
        visibleGames.forEach(g => {
            const cats = Array.isArray(g.category) ? g.category : [g.category || 'lainnya'];
            cats.forEach(c => {
                catCounts.set(c, (catCounts.get(c) || 0) + 1);
            });
        });

        const headerAll = document.createElement('div');
        headerAll.className = 'sidebar-section-header';
        headerAll.textContent = 'SEMUA KATEGORI';
        nav.appendChild(headerAll);

        const sortedCats = Array.from(catCounts.keys()).sort();
        sortedCats.forEach(cat => {
            const cfg = CAT[cat] || CAT.lainnya;
            const count = catCounts.get(cat) || 0;
            const btn = document.createElement('button');
            btn.className = `nav-btn ${activeCategory === cat ? 'active' : ''}`;
            btn.dataset.category = cat;
            btn.innerHTML = `
                <span class="ico">${cfg.icon}</span>
                <span>${cfg.label}</span>
                <span class="nav-count">${count}</span>
            `;
            nav.appendChild(btn);
        });
    }

    // Event delegation untuk navigasi sidebar
    nav.onclick = e => {
        const btn = e.target.closest('.nav-btn');
        if (!btn) return;
        
        nav.querySelectorAll('.nav-btn[data-category]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeCategory = btn.dataset.category || 'all';

        renderGrid();

        // Tutup mobile sidebar jika terbuka
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (sidebar && overlay) {
            sidebar.classList.remove('open');
            overlay.classList.remove('show');
        }
    };
}

function syncSidebar() {
    document.querySelectorAll('.nav-btn[data-category]').forEach(b => {
        b.classList.toggle('active', b.dataset.category === activeCategory);
    });
}

// ==================== SEARCH ====================
function setupSearch() {
    const input = document.getElementById('search-input');
    if (!input) return;
    input.value = '';
    searchQuery = '';
    let timer;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            searchQuery = input.value.trim().toLowerCase();
            renderGrid();
        }, 200);
    });

    // Safeguard: Bersihkan jika browser secara agresif meng-autofill email/kredensial ke kolom search
    setTimeout(() => {
        if (input && !input.matches(':focus') && input.value.includes('@')) {
            input.value = '';
            searchQuery = '';
            renderGrid();
        }
    }, 150);
}

// ==================== RENDER GRID ====================
function renderGrid() {
    const grid = document.getElementById('game-grid');
    if (!grid) return;

    let list = getVisibleGames();

    // 1. Filter Scope Primer (Tri-Tab Mode)
    if (activePrimaryTab === 'learning') {
        list = list.filter(g => isLearningGame(g));
    } else if (activePrimaryTab === 'casual') {
        list = list.filter(g => isCasualGame(g));
    }
    // Jika game memiliki kriteria keduanya, otomatis lolos di kedua tab!

    // 2. Filter Kategori Sekunder / Mata Pelajaran
    if (activeCategory !== 'all') {
        if (activeCategory.startsWith('subj:')) {
            const targetSubj = activeCategory.substring(5).toLowerCase().trim();
            list = list.filter(g => {
                const subjects = parseGameSubjects(g.subject);
                return subjects.some(s => s.toLowerCase().trim() === targetSubj);
            });
        } else {
            list = list.filter(g => {
                if (Array.isArray(g.category)) return g.category.includes(activeCategory);
                return g.category === activeCategory;
            });
        }
    }

    // 3. Filter Pencarian Teks
    if (searchQuery) {
        list = list.filter(g =>
            g.title?.toLowerCase().includes(searchQuery) ||
            g.author?.toLowerCase().includes(searchQuery) ||
            g.subject?.toLowerCase().includes(searchQuery) ||
            g.description?.toLowerCase().includes(searchQuery) ||
            (g.is_active === false && ('tidak tayang'.includes(searchQuery) || 'sembunyi'.includes(searchQuery) || 'nonaktif'.includes(searchQuery))) ||
            (g.is_active !== false && ('tayang'.includes(searchQuery) || 'aktif'.includes(searchQuery)))
        );
    }

    if (list.length === 0) {
        showEmpty(searchQuery ? 'Tidak ada game yang cocok dengan pencarian' : 'Belum ada game pada filter ini');
        return;
    }

    grid.innerHTML = list.map((g, i) => cardHTML(g, i)).join('');
}

// ==================== SMART THEMING & VISUAL ENGINE ====================
const SMART_THEMES = {
    matematika: {
        bg: 'linear-gradient(135deg, #38bdf8 0%, #0284c7 50%, #0369a1 100%)',
        border: '#0284c7',
        accent: '#0369a1',
        pattern: 'pat-math',
        emoji: '📐',
        icon: '📐'
    },
    bahasa: {
        bg: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)',
        border: '#d97706',
        accent: '#92400e',
        pattern: 'pat-literature',
        emoji: '📜',
        icon: '🖋️'
    },
    sains: {
        bg: 'linear-gradient(135deg, #4ade80 0%, #22c55e 50%, #16a34a 100%)',
        border: '#15803d',
        accent: '#14532d',
        pattern: 'pat-science',
        emoji: '🔬',
        icon: '🧪'
    },
    seni: {
        bg: 'linear-gradient(135deg, #f472b6 0%, #ec4899 50%, #db2777 100%)',
        border: '#be185d',
        accent: '#831843',
        pattern: 'pat-art',
        emoji: '🎨',
        icon: '🎭'
    },
    informatika: {
        bg: 'linear-gradient(135deg, #818cf8 0%, #6366f1 50%, #4f46e5 100%)',
        border: '#4338ca',
        accent: '#312e81',
        pattern: 'pat-cyber',
        emoji: '💻',
        icon: '🤖'
    },
    olahraga: {
        bg: 'linear-gradient(135deg, #fb923c 0%, #f97316 50%, #ea580c 100%)',
        border: '#c2410c',
        accent: '#7c2d12',
        pattern: 'pat-diagonal',
        emoji: '⚽',
        icon: '🏆'
    },
    sosial: {
        bg: 'linear-gradient(135deg, #2dd4bf 0%, #14b8a6 50%, #0d9488 100%)',
        border: '#0f766e',
        accent: '#115e59',
        pattern: 'pat-waves',
        emoji: '🏛️',
        icon: '🌍'
    },
    icebreaking: {
        bg: 'linear-gradient(135deg, #818cf8 0%, #a855f7 50%, #ec4899 100%)',
        border: '#9333ea',
        accent: '#6b21a8',
        pattern: 'pat-stars',
        emoji: '🎉',
        icon: '✨'
    }
};

function getSmartTheme(subject, category, title = '') {
    let s = '';
    let c = '';
    let t = '';

    if (typeof subject === 'object' && subject !== null && !Array.isArray(subject)) {
        s = String(subject.subject || '').toLowerCase();
        c = Array.isArray(subject.category) ? subject.category.join(' ').toLowerCase() : String(subject.category || '').toLowerCase();
        t = String(subject.title || '').toLowerCase();
    } else {
        s = String(subject || '').toLowerCase();
        c = Array.isArray(category) ? category.join(' ').toLowerCase() : String(category || '').toLowerCase();
        t = String(title || '').toLowerCase();
    }
    const all = `${s} ${c} ${t}`;

    if (all.includes('matematik') || all.includes('aljabar') || all.includes('geometri') || all.includes('fungsi') || all.includes('matriks') || all.includes('angka') || all.includes('hitung') || all.includes('kalkulus') || all.includes('trigonometri')) {
        return SMART_THEMES.matematika;
    }
    if (all.includes('bahasa') || all.includes('indonesia') || all.includes('inggris') || all.includes('bali') || all.includes('sastra') || all.includes('puisi') || all.includes('karya ilmiah') || all.includes('sejarah') || all.includes('literasi') || all.includes('cerpen') || all.includes('buku')) {
        return SMART_THEMES.bahasa;
    }
    if (all.includes('fisika') || all.includes('kimia') || all.includes('biologi') || all.includes('ipa') || all.includes('sains') || all.includes('lab') || all.includes('alkemis') || all.includes('eksperimen') || all.includes('tata surya') || all.includes('astronomi') || all.includes('atom') || all.includes('reaksi')) {
        return SMART_THEMES.sains;
    }
    if (all.includes('seni') || all.includes('budaya') || all.includes('musik') || all.includes('rupa') || all.includes('gambar') || all.includes('sketsa') || all.includes('tari') || all.includes('kreativitas') || all.includes('doodle') || all.includes('kanvas') || all.includes('desain') || all.includes('prakarya')) {
        return SMART_THEMES.seni;
    }
    if (all.includes('informatika') || all.includes('komputer') || all.includes('coding') || all.includes('cyber') || all.includes('ai') || all.includes('algoritma') || all.includes('robot') || all.includes('tekno') || all.includes('digital') || all.includes('siber')) {
        return SMART_THEMES.informatika;
    }
    if (all.includes('pjok') || all.includes('olahraga') || all.includes('penjas') || all.includes('senam') || all.includes('atletik') || all.includes('kebugaran') || all.includes('sehat')) {
        return SMART_THEMES.olahraga;
    }
    if (all.includes('ppkn') || all.includes('pancasila') || all.includes('sosiologi') || all.includes('geografi') || all.includes('ekonomi') || all.includes('ips') || all.includes('hukum') || all.includes('kewarganegaraan')) {
        return SMART_THEMES.sosial;
    }
    if (all.includes('ice breaking') || all.includes('game') || all.includes('trivia') || all.includes('seru') || all.includes('santai') || all.includes('spinner') || all.includes('roda') || all.includes('acak')) {
        return SMART_THEMES.icebreaking;
    }

    if (c.includes('puzzle')) return SMART_THEMES.matematika;
    if (c.includes('simulasi')) return SMART_THEMES.sains;
    if (c.includes('kreativitas')) return SMART_THEMES.seni;
    if (c.includes('arcade')) return SMART_THEMES.informatika;
    if (c.includes('petualangan')) return SMART_THEMES.sosial;

    return SMART_THEMES.icebreaking;
}

// ==================== LUMINANCE & CONTRAST ENGINE ====================
/**
 * Menghitung tingkat kecerahan persepsi warna (Perceived Brightness / Luminance)
 * Menggunakan standar ITU-R BT.709 & formula YIQ (0 - 255).
 * Nilai < 125 dikategorikan sebagai warna gelap.
 */
function parseColorBrightness(colorStr) {
    if (!colorStr || typeof colorStr !== 'string') return 255;
    const str = colorStr.trim().toLowerCase();

    // 1. Format Hex #RGB atau #RRGGBB
    if (str.startsWith('#')) {
        let hex = str.slice(1);
        if (hex.length === 3 || hex.length === 4) {
            hex = hex.split('').slice(0, 3).map(c => c + c).join('');
        }
        if (hex.length >= 6) {
            const r = parseInt(hex.substring(0, 2), 16) || 0;
            const g = parseInt(hex.substring(2, 4), 16) || 0;
            const b = parseInt(hex.substring(4, 6), 16) || 0;
            return (r * 299 + g * 587 + b * 114) / 1000;
        }
    }

    // 2. Format rgb(r, g, b) atau rgba(r, g, b, a)
    const rgbMatch = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgbMatch) {
        const r = parseInt(rgbMatch[1], 10) || 0;
        const g = parseInt(rgbMatch[2], 10) || 0;
        const b = parseInt(rgbMatch[3], 10) || 0;
        return (r * 299 + g * 587 + b * 114) / 1000;
    }

    return 255;
}

/**
 * Menganalisis apakah latar belakang (gradien atau warna solid) tergolong gelap
 * sehingga membutuhkan teks dan elemen kartu bertema terang (theme-dark).
 */
function isDarkBackground(bgGradientOrColor) {
    if (!bgGradientOrColor || typeof bgGradientOrColor !== 'string') return false;
    const bg = bgGradientOrColor.trim();

    // Ekstrak seluruh representasi warna: hex (#123, #123456) dan rgb/rgba
    const hexMatches = bg.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    const rgbMatches = bg.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+[^)]*\)/gi) || [];
    const allColorMatches = [...hexMatches, ...rgbMatches];

    if (allColorMatches.length === 0) {
        const lower = bg.toLowerCase();
        if (lower.includes('black') || lower.includes('navy') || lower.includes('dark') || lower.includes('#000')) {
            return true;
        }
        return false;
    }

    // Hitung rata-rata kecerahan warna dari seluruh stop yang ada
    let totalBrightness = 0;
    for (const c of allColorMatches) {
        totalBrightness += parseColorBrightness(c);
    }
    const avgBrightness = totalBrightness / allColorMatches.length;

    // Threshold 125: jika di bawah 125, tergolong gelap dan membutuhkan teks putih (WCAG AA)
    return avgBrightness < 125;
}

// ==================== GEMINI AI & INSPECTOR HELPERS ====================
async function getAllStoredGeminiApiKeys() {
    let keys = [];

    // 1. Coba dari fungsi SSOT getUserGeminiApiKeysAsync jika ada
    if (typeof window.getUserGeminiApiKeysAsync === 'function') {
        try {
            const uid = window.auth?.currentUser?.uid || window.pidPortalViewer?.uid;
            const resKeys = await window.getUserGeminiApiKeysAsync(uid);
            if (Array.isArray(resKeys) && resKeys.length > 0) {
                keys = resKeys;
            }
        } catch (e) {
            console.warn('[PID AI] getUserGeminiApiKeysAsync error:', e);
        }
    }

    // 2. Coba baca langsung dari Firestore user_secrets
    if (keys.length === 0) {
        try {
            const uid = window.auth?.currentUser?.uid || window.pidPortalViewer?.uid || localStorage.getItem('user_uid');
            if (uid && window.db && window.doc && window.getDoc) {
                const userSecretDoc = await window.getDoc(window.doc(window.db, 'user_secrets', uid));
                if (userSecretDoc.exists()) {
                    const secretData = userSecretDoc.data()?.geminiApiKey;
                    if (Array.isArray(secretData)) {
                        keys = secretData.filter(k => typeof k === 'string' && k.trim());
                    } else if (typeof secretData === 'string' && secretData.length > 5) {
                        keys = [secretData.trim()];
                    }
                }

                // Cek fallback ke dokumen users/{uid} jika di user_secrets belum ada
                if (keys.length === 0) {
                    const userDoc = await window.getDoc(window.doc(window.db, 'users', uid));
                    if (userDoc.exists()) {
                        const uData = userDoc.data()?.geminiApiKey;
                        if (Array.isArray(uData)) {
                            keys = uData.filter(k => typeof k === 'string' && k.trim());
                        } else if (typeof uData === 'string' && uData.length > 5) {
                            keys = [uData.trim()];
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[PID AI] Gagal baca secret doc:', e);
        }
    }

    // 3. Coba dari cache runtime window
    if (keys.length === 0) {
        if (Array.isArray(window.profileUserApiKeys) && window.profileUserApiKeys.length > 0) {
            keys = [...window.profileUserApiKeys];
        } else if (Array.isArray(window.userApiKeys) && window.userApiKeys.length > 0) {
            keys = [...window.userApiKeys];
        } else if (Array.isArray(window.userApiKeysWali) && window.userApiKeysWali.length > 0) {
            keys = [...window.userApiKeysWali];
        } else if (Array.isArray(window.userApiKeysRapor) && window.userApiKeysRapor.length > 0) {
            keys = [...window.userApiKeysRapor];
        }
    }

    // 4. Coba dari seluruh kemungkinan kunci localStorage / sessionStorage
    if (keys.length === 0) {
        const localCandidates = [
            localStorage.getItem('user_gemini_key'),
            localStorage.getItem('user_gemini_api_key'),
            localStorage.getItem('gemini_api_key'),
            localStorage.getItem('simas_gemini_api_key'),
            localStorage.getItem('simas_gemini_key'),
            localStorage.getItem('doodle_apiKey'),
            sessionStorage.getItem('doodle_apiKey')
        ];
        for (const candidate of localCandidates) {
            if (candidate && typeof candidate === 'string' && candidate.trim().length > 5) {
                keys = [candidate.trim()];
                break;
            }
        }
    }

    return keys;
}

async function getStoredGeminiApiKey() {
    const keys = await getAllStoredGeminiApiKeys();
    return keys[0] || null;
}

async function saveStoredGeminiApiKey(apiKey) {
    if (!apiKey) return;
    const cleanKey = apiKey.trim();
    localStorage.setItem('user_gemini_key', cleanKey);
    localStorage.setItem('user_gemini_api_key', cleanKey);

    try {
        const uid = window.auth?.currentUser?.uid || window.pidPortalViewer?.uid;
        if (uid && window.db && window.doc && window.setDoc && window.serverTimestamp) {
            await window.setDoc(window.doc(window.db, 'user_secrets', uid), {
                geminiApiKey: [cleanKey],
                updatedAt: window.serverTimestamp()
            }, { merge: true });
        }
    } catch (e) {
        console.warn('[PID AI] Gagal simpan secret ke Firestore:', e);
    }
}

async function inspectGameUrl(targetUrl) {
    let cleanTarget = String(targetUrl || '').trim();
    if (cleanTarget && !/^https?:\/\//i.test(cleanTarget)) {
        cleanTarget = `https://${cleanTarget}`;
    }

    try {
        const cfWorkerUrl = 'https://simas-smagesa-api.komangpurna1.workers.dev';
        const apiUrl = `${cfWorkerUrl}/api/pid-games/inspect-url?url=${encodeURIComponent(cleanTarget)}`;
        const resp = await fetch(apiUrl);
        if (resp.ok) {
            const json = await resp.json();
            if (json && json.data) return json.data;
        }
    } catch (e) {
        console.warn('[PID AI] Remote inspect endpoint fallback:', e);
    }

    // Client-side fallback: Ekstrak petunjuk judul dan topik dari URL jika worker belum merespon
    let fallbackTitle = '';
    let domainName = '';
    try {
        const u = new URL(cleanTarget);
        domainName = u.hostname;
        const pathSegments = u.pathname.split('/').filter(Boolean);
        const lastSegment = pathSegments[pathSegments.length - 1] || u.hostname;
        fallbackTitle = decodeURIComponent(lastSegment)
            .replace(/[-_+]/g, ' ')
            .replace(/\.[a-z0-9]+$/i, '');
        fallbackTitle = fallbackTitle.charAt(0).toUpperCase() + fallbackTitle.slice(1);
    } catch (e) {
        fallbackTitle = 'Game Edukasi Interaktif';
    }

    return {
        title: fallbackTitle,
        description: `Game edukatif interaktif dari ${domainName || cleanTarget}`,
        headings: [fallbackTitle],
        keywords: [fallbackTitle, 'edukasi', 'game interaktif'],
        client_fallback: true
    };
}

/**
 * Normalisasi SVG string atau Data URI SVG menjadi Data URI yang valid,
 * aman dari XSS, serta tahan terhadap XML parser error di semua browser.
 * Menghilangkan markdown fence, menjamin xmlns, viewBox, dan mengenkode
 * tanda petik tunggal (') menjadi %27 agar tidak dirusak oleh escaping HTML (esc).
 */
function safeSvgToDataUri(input) {
    if (!input || typeof input !== 'string') return '';
    let str = input.trim();
    if (str.startsWith('http://') || str.startsWith('https://')) return str;

    // Jika sudah berupa Data URI SVG, decode dulu konten payloadnya untuk dinormalisasi ulang
    if (str.startsWith('data:image/svg+xml')) {
        try {
            const commaIdx = str.indexOf(',');
            if (commaIdx !== -1) {
                str = decodeURIComponent(str.substring(commaIdx + 1));
            }
        } catch (e) {
            // Jika decode gagal, lanjutkan dengan str apa adanya
        }
    }

    // 1. Bersihkan pembungkus markdown code fences jika Gemini mengembalikannya
    str = str.replace(/^```(?:xml|svg|html)?\s*/i, '').replace(/\s*```$/i, '').trim();

    // 2. Ekstrak tag <svg>...</svg>
    const svgMatch = str.match(/<svg\b[\s\S]*?<\/svg>/i);
    if (!svgMatch) {
        const partialSvg = str.match(/<svg\b[\s\S]*/i);
        if (partialSvg) {
            str = partialSvg[0] + '</svg>';
        } else {
            return '';
        }
    } else {
        str = svgMatch[0];
    }

    // 3. Sanitasi Keamanan XSS (Hapus tag <script> dan event handler on* inline)
    str = str.replace(/<script\b[\s\S]*?<\/script>/gi, '')
             .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
             .replace(/\son\w+\s*=\s*[^\s>]+/gi, '');

    // 4. Pastikan deklarasi namespace XML (xmlns) ada
    if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(str)) {
        str = str.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // 5. Pastikan viewBox tersedia
    if (!/viewBox\s*=/i.test(str)) {
        str = str.replace(/<svg\b/i, '<svg viewBox="0 0 100 100"');
    }

    // 6. Enkode SVG menjadi Data URI standar RFC 3986 dengan mengenkode petik tunggal (') menjadi %27
    const encoded = encodeURIComponent(str).replace(/'/g, '%27');
    return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

async function generateCardVisualAI({ url, inspectData, title, subject, category, apiKey, availableSubjects }) {
    // Ambil Model AI secara dinamis dari SSOT settings/system_config
    let aiModel = null;
    if (typeof window.getAiConfigAsync === 'function') {
        try {
            const cfg = await window.getAiConfigAsync();
            if (cfg && cfg.model) aiModel = cfg.model;
        } catch (e) {}
    } else if (typeof window.getAiConfig === 'function') {
        const cfg = window.getAiConfig();
        if (cfg && cfg.model) aiModel = cfg.model;
    }
    
    if (!aiModel) {
        aiModel = localStorage.getItem('simas_gemini_model');
    }

    if (!aiModel && window.db && window.doc && window.getDoc) {
        try {
            const snap = await window.getDoc(window.doc(window.db, 'settings', 'system_config'));
            if (snap && snap.exists()) {
                const cfg = snap.data();
                if (cfg.geminiModel) {
                    aiModel = cfg.geminiModel;
                    localStorage.setItem('simas_gemini_model', aiModel);
                }
                if (cfg.geminiDisplayName) {
                    localStorage.setItem('simas_gemini_display_name', cfg.geminiDisplayName);
                }
            }
        } catch (e) {}
    }

    aiModel = String(aiModel || '').trim();
    if (!aiModel) {
        aiModel = (typeof AI_CONFIG !== 'undefined' && AI_CONFIG.model) ? AI_CONFIG.model : '';
    }
    if (!aiModel) {
        throw new Error("Model AI Gemini belum dikonfigurasi di menu Pengaturan Aplikasi.");
    }

    const cfWorkerUrl = 'https://simas-smagesa-api.komangpurna1.workers.dev';

    let keysToTry = [];
    if (Array.isArray(apiKey)) {
        keysToTry = apiKey.filter(k => typeof k === 'string' && k.trim());
    } else if (typeof apiKey === 'string' && apiKey.trim()) {
        keysToTry = [apiKey.trim()];
    }
    if (keysToTry.length === 0) {
        keysToTry = await getAllStoredGeminiApiKeys();
    }

    let subjectList = [];
    if (Array.isArray(availableSubjects) && availableSubjects.length > 0) {
        subjectList = availableSubjects;
    } else if (Array.isArray(window.pidAllowedMapelsCache) && window.pidAllowedMapelsCache.length > 0) {
        subjectList = window.pidAllowedMapelsCache;
    }

    const mapelSection = subjectList.length > 0
        ? `[DAFTAR MATA PELAJARAN AKTIF (PILIH 1 ATAU LEBIH DARI DAFTAR BERIKUT)]\n${subjectList.map(s => `"${s}"`).join(', ')}`
        : `[MATA PELAJARAN]\nPilih nama mata pelajaran yang paling relevan dengan materi topik game.`;

    const schoolCfg = getSchoolConfig();
    const promptText = `Anda adalah Asisten AI Desainer Media Edukatif PID untuk ${schoolCfg.schoolName} (${schoolCfg.appName}).
Tugas Anda adalah menganalisis data halaman game berikut, memahami topik pembelajaran serta mekanisme bermainnya, lalu menghasilkan metadata kartu dan kode ilustrasi vektor SVG yang estetik, modern, ceria, dan penuh warna untuk kartu game ini.

[DATA GAME DARI URL]
- URL Target: ${url}
- Judul Input Guru (Jika ada): ${title || '(Belum ada)'}
- Mapel Input Guru (Jika ada): ${subject || '(Belum ada)'}
- Kategori Input Guru (Jika ada): ${category || '(Belum ada)'}
- Judul Web Hasil Inspeksi: ${inspectData?.title || '-'}
- Deskripsi Web Hasil Inspeksi: ${inspectData?.description || '-'}
- Headings Halaman: ${(inspectData?.headings || []).join(' | ') || '-'}
- Cuplikan Konten: ${(inspectData?.textSnippet || '').substring(0, 1000) || '-'}

[DAFTAR KATEGORI VALID (PILIH 1 ATAU LEBIH)]
"kuis", "puzzle", "simulasi", "arcade", "flashcard", "petualangan", "kreativitas", "lainnya"

${mapelSection}

[PANDUAN KLASIFIKASI MATERI PELAJARAN vs GAME SANTAI / ICE BREAKING]:
- Analisis secara teliti apakah game ini mengandung materi pelajaran kurikulum sekolah (seperti Matematika, Fisika, Kimia, Biologi, Sejarah, Geografi, Ekonomi, Sosiologi, Bahasa Indonesia, Bahasa Inggris, Informatika, Agama, Seni Budaya, PJOK, PKn, dsb.) ATAU murni game hiburan santai, refleks, teka-teki logika umum, atau ice breaking kelas tanpa materi ajar khusus.
- Jika mengandung materi kurikulum sekolah spesifik:
  * Wajib memilih mata pelajaran yang tepat dari [DAFTAR MATA PELAJARAN AKTIF].
  * Contoh: jika kuis aljabar -> ["Matematika"]; jika kosa kata animal -> ["Bahasa Inggris"].
- Jika murni game hiburan santai, refleks, ketangkasan, tebak-tebakan umum, atau alat bantu ice breaking:
  * Masukkan ["Umum"] atau ["Ice Breaking"] (atau keduanya) pada array "subject".
- Jika game edukasi materi pelajaran yang dirancang seru untuk mencairkan suasana (ice breaking KBM):
  * Sertakan mata pelajaran terkait DAN sertakan juga "Ice Breaking" (contoh: ["Matematika", "Ice Breaking"]).

[PANDUAN TEMA & WARNA KARTU]:
- Prioritaskan gradien warna yang ceria, segar, estetik, dan ramah media edukasi sekolah (seperti biru langit, toska zamrud cerah, amber keemasan, ungu lavender cerah, dsb).
- Pastikan kontras teks sangat baik dan mudah dibaca:
  * Jika gradien latar yang dipilih bernuansa terang, tentukan "text_theme": "dark"
  * Jika memilih gradien bernuansa gelap (misal tema ruang angkasa atau cyberpunk), tentukan "text_theme": "light"

[PANDUAN ILUSTRASI SVG (svg_illustration)]:
- Format SVG murni (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">...</svg>)
- Ukuran viewBox 0 0 100 100, responsif, modern, penuh warna cerah, kontras bagus, flat/isometric vector style yang cocok untuk ikon kartu game.
- Gambar objek utama yang sangat mencerminkan materi game (contoh: jika tentang Aljabar/Fungsi gambar roda gigi + kurva fungsi; jika tentang Anatomi Tubuh gambar organ/DNA; jika tentang Puisi gambar buku terbuka + bulu pena emas; jika tentang Pemanah Matriks gambar busur bercahaya + angka rune; dsb).
- JANGAN bungkus kode SVG dengan blok markdown (JANGAN gunakan format kode tiga backtick). Hasilkan string SVG murni langsung di dalam properti JSON.
- Gunakan tanda petik ganda (") untuk atribut SVG di dalam JSON (hindari tanda petik tunggal).
- JANGAN sertakan tag script atau event handler di dalam SVG.

[FORMAT OUTPUT WAJIB JSON MURNI TANPA KATA PENGANTAR]:
{
  "title": "Judul game ringkas dan jelas (Maks 40 karakter)",
  "subject": ["Mata Pelajaran yang tepat atau Umum/Ice Breaking"],
  "category": ["kategori_valid_1"],
  "description": "Deskripsi singkat 1-2 kalimat tentang game ini.",
  "emoji": "Satu emoji paling relevan (contoh: ⚙️, 📜, 🔬, 🪐, 🎨, 💻)",
  "theme": {
    "primary_color": "#warna_utama",
    "secondary_color": "#warna_aksen",
    "bg_gradient": "linear-gradient(135deg, #warna1 0%, #warna2 50%, #warna3 100%)",
    "border_color": "#warna_border",
    "pattern_style": "pat-math",
    "text_theme": "dark"
  },
  "svg_illustration": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><circle cx=\"50\" cy=\"50\" r=\"40\" fill=\"#38bdf8\"/></svg>"
}`;

    const bodyPayload = {
        contents: [
            {
                role: 'user',
                parts: [{ text: promptText }]
            }
        ],
        generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json'
        }
    };

    let json = null;

    // Eksekusi Multi-Key Fallback Loop
    for (let ki = 0; ki < keysToTry.length; ki++) {
        const currentKey = keysToTry[ki];
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(aiModel)}:generateContent?key=${encodeURIComponent(currentKey)}`;

        // 1. Percobaan 1: Direct Fetch ke Gemini API
        try {
            const resp = await fetch(geminiUrl, {
                method: 'POST',
                referrerPolicy: 'no-referrer',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload)
            });

            if (resp.ok) {
                json = await resp.json();
                break; // Berhasil dengan direct fetch!
            } else {
                console.warn(`[PID AI] Direct Gemini API (Key ${ki + 1}) responded ${resp.status}, mencoba Worker AI Proxy...`);
            }
        } catch (directErr) {
            console.warn(`[PID AI] Direct Gemini fetch error (Key ${ki + 1}), mencoba Worker AI Proxy:`, directErr);
        }

        // 2. Percobaan 2: Fallback ke Cloudflare Worker AI Proxy
        if (!json) {
            try {
                const proxyResp = await fetch(`${cfWorkerUrl}/api/pid-games/ai-generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        apiKey: currentKey,
                        prompt: promptText,
                        model: aiModel
                    })
                });

                if (proxyResp.ok) {
                    const proxyData = await proxyResp.json();
                    if (proxyData.success && proxyData.data) {
                        json = proxyData.data;
                        break; // Berhasil dengan Worker Proxy!
                    }
                } else {
                    const errProxy = await proxyResp.text();
                    console.warn(`[PID AI] Worker AI Proxy (Key ${ki + 1}) responded ${proxyResp.status}:`, errProxy);
                }
            } catch (proxyErr) {
                console.warn(`[PID AI] Worker AI Proxy fetch error (Key ${ki + 1}):`, proxyErr);
            }
        }

        console.warn(`[PID AI] Key ${ki + 1} tidak berhasil, otomatis fallback ke key berikutnya jika tersedia...`);
    }

    // 3. Ekstraksi hasil JSON dari Gemini
    if (json) {
        const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
            try {
                const cleanJsonStr = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
                return JSON.parse(cleanJsonStr);
            } catch (e) {
                const match = rawText.match(/\{[\s\S]*\}/);
                if (match) return JSON.parse(match[0]);
            }
        }
    }

    // 4. Fallback Deterministik Cerdas (Anti-Gagal jika offline / kuota Gemini habis)
    console.warn('[PID AI] Menggunakan perancang cerdas lokal fallback...');
    const fallbackTitle = inspectData?.title || title || 'Game Edukasi Interaktif';
    const cleanTitle = String(fallbackTitle).replace(/\.[a-z0-9]+$/i, '').trim().substring(0, 40);
    const subTheme = getSmartTheme(subject || 'Umum', category || 'kuis', cleanTitle);

    return {
        title: cleanTitle,
        subject: Array.isArray(subject) ? subject : (subject ? [subject] : ['Umum']),
        category: Array.isArray(category) ? category : (category ? [category] : ['kuis']),
        description: inspectData?.description || `Game edukatif interaktif untuk media pembelajaran yang menyenangkan dan interaktif.`,
        emoji: subTheme.emoji || '🎮',
        theme: {
            primary_color: subTheme.accent || '#38bdf8',
            secondary_color: subTheme.border || '#0284c7',
            bg_gradient: subTheme.bg || 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)',
            border_color: subTheme.border || '#38bdf8',
            pattern_style: subTheme.pattern || 'pat-tech',
            text_theme: isDarkBackground(subTheme.bg || '') ? 'light' : 'dark'
        },
        svg_illustration: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
            <defs>
                <linearGradient id="local-ai-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${subTheme.accent || '#38bdf8'}"/>
                    <stop offset="100%" stop-color="${subTheme.border || '#0284c7'}"/>
                </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="42" fill="url(#local-ai-grad)" opacity="0.2"/>
            <rect x="25" y="25" width="50" height="50" rx="14" fill="url(#local-ai-grad)"/>
            <circle cx="42" cy="45" r="5" fill="#ffffff"/>
            <circle cx="58" cy="45" r="5" fill="#ffffff"/>
            <path d="M 38 60 Q 50 68 62 60" stroke="#ffffff" stroke-width="4" stroke-linecap="round" fill="none"/>
        </svg>`
    };
}

// ==================== CARD HTML ====================
function cardHTML(game, idx = 0) {
    if (game && typeof game.theme === 'string') {
        try { game.theme = JSON.parse(game.theme); } catch (e) {}
    }
    const catArr = Array.isArray(game.category) ? game.category : [game.category || 'lainnya'];
    const mainCat = catArr[0];
    const cfg = CAT[mainCat] || CAT.lainnya;
    const delay = Math.min(idx * 0.02, 0.25);
    const isTayang = game.is_active !== false;

    // Ekstrak seluruh chip mata pelajaran secara utuh tanpa disingkat +1 atau +2
    const subjectList = String(game.subject || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
    const subjectChips = subjectList
        .map(item => `<span class="card-subject-chip">${esc(item)}</span>`)
        .join('');
    const subjectHtml = subjectChips ? `<div class="card-subject">${subjectChips}</div>` : '';

    // Dapatkan Smart Theme atau Custom Theme jika ada
    const smartTheme = getSmartTheme(game.subject, game.category, game.title);
    const bgGradient = game.theme?.bg_gradient || smartTheme.bg;
    const borderColor = game.theme?.border_color || smartTheme.border;
    const patternClass = game.theme?.pattern_style || smartTheme.pattern;
    const themeEmoji = game.theme?.emoji || smartTheme.emoji || cfg.emoji;

    // Deteksi Kontras & Kecerahan Latar Belakang (WCAG AA Accessibility)
    const isDarkCard = (game.theme?.text_theme === 'light') ||
        (game.theme?.text_theme !== 'dark' && isDarkBackground(bgGradient));
    const themeContrastClass = isDarkCard ? 'theme-dark' : 'theme-light';

    let thumb = '';
    if (game.thumbnail_url) {
        const cleanThumb = String(game.thumbnail_url).trim();
        const fallbackOnError = `onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'ph-emoji\\' title=\\'${esc(cfg.label)}\\' aria-label=\\'${esc(cfg.label)}\\'>${themeEmoji}</span>';"`;
        if (cleanThumb.startsWith('data:image/svg+xml') || cleanThumb.startsWith('<svg') || cleanThumb.includes('<svg')) {
            const dataUri = safeSvgToDataUri(cleanThumb);
            if (dataUri) {
                thumb = `<img src="${esc(dataUri)}" alt="${esc(game.title)}" loading="lazy" ${fallbackOnError}>`;
            } else {
                thumb = `<span class="ph-emoji" title="${esc(cfg.label)}" aria-label="${esc(cfg.label)}">${themeEmoji}</span>`;
            }
        } else if (cleanThumb.startsWith('http://') || cleanThumb.startsWith('https://')) {
            thumb = `<img src="${esc(cleanThumb)}" alt="${esc(game.title)}" loading="lazy" ${fallbackOnError}>`;
        } else {
            thumb = `<img src="${esc(cleanThumb)}" alt="${esc(game.title)}" loading="lazy" ${fallbackOnError}>`;
        }
    } else {
        thumb = `<span class="ph-emoji" title="${esc(cfg.label)}" aria-label="${esc(cfg.label)}">${themeEmoji}</span>`;
    }

    const inactiveCardClass = !isTayang ? 'card-not-published' : '';

    // Tentukan tampilan pembuat game (GTK / Guru yang mengajukan)
    const authorLine = game.author && game.author !== 'none' ? `<div class="card-author">${esc(game.author)}</div>` : '';
    const submitterName = game.submitted_by_name || '';
    const showSubmitter = Boolean(authorLine && submitterName && submitterName !== (game.author || ''));
    const submitterLine = showSubmitter
        ? `<div class="card-submitter">Diupload oleh: ${esc(submitterName)}</div>`
        : (!authorLine && submitterName ? `<div class="card-author">${esc(submitterName)}</div>` : '');

    return `
        <div class="game-card ${inactiveCardClass} ${themeContrastClass} pop-in" style="animation-delay:${delay}s; background:${bgGradient}; border-color:${borderColor};" onclick="window.showGameDetailModal?.('${esc(game.id || '')}')" role="button" tabindex="0" title="${esc(game.title || '')} - Klik untuk detail & main">
            <div class="card-pattern-layer ${patternClass}"></div>
            <div class="card-icon-wrap">${thumb}</div>
            <div class="card-title">${esc(game.title || 'Judul Game')}</div>
            ${authorLine}
            ${submitterLine}
            ${subjectHtml}
        </div>
    `;
}

// ==================== GAME DETAIL MODAL POPUP ====================
function showGameDetailModal(gameId) {
    const modal = document.getElementById('modal-game-detail');
    if (!modal) return;

    const game = Array.isArray(allGames) ? allGames.find(g => String(g.id) === String(gameId)) : null;
    if (!game) return;

    if (game && typeof game.theme === 'string') {
        try { game.theme = JSON.parse(game.theme); } catch (e) {}
    }

    const catArr = Array.isArray(game.category) ? game.category : [game.category || 'lainnya'];
    const mainCat = catArr[0];
    const cfg = CAT[mainCat] || CAT.lainnya;
    const isTayang = game.is_active !== false;
    const isHtmlGame = game.source_type === 'html' || Boolean(game.has_html);
    const isEditable = canUserEditGame(game);

    const smartTheme = getSmartTheme(game.subject, game.category, game.title);
    const bgGradient = game.theme?.bg_gradient || smartTheme.bg;
    const borderColor = game.theme?.border_color || smartTheme.border;
    const patternClass = game.theme?.pattern_style || smartTheme.pattern;
    const themeEmoji = game.theme?.emoji || smartTheme.emoji || cfg.emoji;

    // Deteksi Kontras & Kecerahan Latar Belakang Banner
    const isDarkCard = (game.theme?.text_theme === 'light') ||
        (game.theme?.text_theme !== 'dark' && isDarkBackground(bgGradient));

    // Banner & Pattern
    const banner = document.getElementById('game-detail-banner');
    if (banner) {
        banner.style.background = bgGradient;
        banner.style.borderColor = borderColor;
        if (isDarkCard) {
            banner.classList.add('theme-dark');
            banner.classList.remove('theme-light');
        } else {
            banner.classList.add('theme-light');
            banner.classList.remove('theme-dark');
        }
    }

    const patternLayer = document.getElementById('game-detail-pattern');
    if (patternLayer) {
        patternLayer.className = `card-pattern-layer ${patternClass}`;
    }

    // Thumbnail
    const thumbWrap = document.getElementById('game-detail-thumb');
    if (thumbWrap) {
        let thumbContent = '';
        if (game.thumbnail_url) {
            const cleanThumb = String(game.thumbnail_url).trim();
            const modalFallbackOnError = `onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'ph-emoji\\' style=\\'font-size:36px;line-height:1;\\'>${themeEmoji}</span>';"`;
            if (cleanThumb.startsWith('data:image/svg+xml') || cleanThumb.startsWith('<svg') || cleanThumb.includes('<svg')) {
                const dataUri = safeSvgToDataUri(cleanThumb);
                if (dataUri) {
                    thumbContent = `<img src="${esc(dataUri)}" alt="${esc(game.title)}" style="width:100%;height:100%;object-fit:contain;" ${modalFallbackOnError}>`;
                } else {
                    thumbContent = `<span class="ph-emoji" style="font-size:36px;line-height:1;">${themeEmoji}</span>`;
                }
            } else if (cleanThumb.startsWith('http://') || cleanThumb.startsWith('https://')) {
                thumbContent = `<img src="${esc(cleanThumb)}" alt="${esc(game.title)}" style="width:100%;height:100%;object-fit:contain;" ${modalFallbackOnError}>`;
            } else {
                thumbContent = `<img src="${esc(cleanThumb)}" alt="${esc(game.title)}" style="width:100%;height:100%;object-fit:contain;" ${modalFallbackOnError}>`;
            }
        } else {
            thumbContent = `<span class="ph-emoji" style="font-size:36px;line-height:1;">${themeEmoji}</span>`;
        }
        thumbWrap.innerHTML = thumbContent;
    }

    // Title
    const titleEl = document.getElementById('game-detail-title');
    if (titleEl) {
        titleEl.textContent = game.title || 'Judul Game';
        titleEl.style.color = isDarkCard ? '#ffffff' : 'var(--text-dark)';
        titleEl.style.textShadow = isDarkCard ? '0 2px 4px rgba(0,0,0,0.65)' : '0 1px 2px rgba(255,255,255,0.7)';
    }

    // Badges
    const sourceBadge = document.getElementById('game-detail-source-badge');
    if (sourceBadge) {
        sourceBadge.textContent = isHtmlGame ? '📄 HTML SANDBOX' : '🔗 WEB URL';
    }

    const typeBadgeEl = document.getElementById('game-detail-type-badge');
    if (typeBadgeEl) {
        const isLearn = isLearningGame(game);
        const isCas = isCasualGame(game);
        if (isLearn && isCas) {
            typeBadgeEl.textContent = '📚 Pelajaran & 🕹️ Ice Breaking';
            typeBadgeEl.style.background = 'rgba(99, 102, 241, 0.16)';
            typeBadgeEl.style.color = '#4338ca';
            typeBadgeEl.style.borderColor = 'rgba(99, 102, 241, 0.3)';
        } else if (isLearn) {
            typeBadgeEl.textContent = '📚 Game Pembelajaran';
            typeBadgeEl.style.background = 'rgba(2, 132, 199, 0.16)';
            typeBadgeEl.style.color = '#0369a1';
            typeBadgeEl.style.borderColor = 'rgba(2, 132, 199, 0.3)';
        } else {
            typeBadgeEl.textContent = '🕹️ Game Santai & Ice Breaking';
            typeBadgeEl.style.background = 'rgba(245, 158, 11, 0.16)';
            typeBadgeEl.style.color = '#b45309';
            typeBadgeEl.style.borderColor = 'rgba(245, 158, 11, 0.3)';
        }
        typeBadgeEl.style.display = 'inline-flex';
    }

    const catBadge = document.getElementById('game-detail-cat-badge');
    if (catBadge) {
        catBadge.textContent = `${cfg.icon} ${cfg.label}`;
    }

    const statusBadgeEl = document.getElementById('game-detail-status-badge');
    if (statusBadgeEl) {
        const statusHtml = getGameStatusBadge(game);
        if (statusHtml) {
            statusBadgeEl.innerHTML = statusHtml;
            statusBadgeEl.style.display = 'inline-flex';
        } else {
            statusBadgeEl.innerHTML = '';
            statusBadgeEl.style.display = 'none';
        }
    }

    // Author & Submitter
    const authorEl = document.getElementById('game-detail-author');
    if (authorEl) {
        const authorName = (game.author && game.author !== 'none') ? game.author : (game.submitted_by_name || "Guru SMANTARA");
        authorEl.textContent = authorName;
    }

    const submitterEl = document.getElementById('game-detail-submitter');
    if (submitterEl) {
        if (game.author && game.author !== 'none' && game.submitted_by_name && game.submitted_by_name !== game.author) {
            submitterEl.textContent = `Diupload oleh: ${game.submitted_by_name}`;
            submitterEl.style.display = 'block';
        } else {
            submitterEl.textContent = '';
            submitterEl.style.display = 'none';
        }
    }

    // Subjects
    const subjectsWrap = document.getElementById('game-detail-subject-chips');
    if (subjectsWrap) {
        const subjects = String(game.subject || '')
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);
        if (subjects.length > 0) {
            subjectsWrap.innerHTML = subjects.map(s => `<span class="card-subject-chip" style="font-size:11px;padding:3px 12px;font-weight:800;border-radius:999px;background:#ffffff;border:1.5px solid rgba(12,26,105,0.12);box-shadow:0 2px 4px rgba(0,0,0,0.04);color:var(--text-dark);">${esc(s)}</span>`).join('');
        } else {
            subjectsWrap.innerHTML = '<span class="card-subject-chip" style="font-size:11px;padding:3px 12px;font-weight:800;border-radius:999px;background:#ffffff;border:1.5px solid rgba(12,26,105,0.12);box-shadow:0 2px 4px rgba(0,0,0,0.04);color:var(--text-dark);">Umum</span>';
        }
    }

    // Description
    const descEl = document.getElementById('game-detail-desc');
    if (descEl) {
        descEl.textContent = game.description || 'Game edukatif interaktif untuk media pembelajaran yang menyenangkan, menantang, dan seru! Selamat bermain.';
    }

    // Tombol Edit
    const btnEdit = document.getElementById('btn-detail-edit');
    if (btnEdit) {
        if (isEditable) {
            btnEdit.style.display = 'inline-flex';
            btnEdit.onclick = () => {
                closeGameDetailModal();
                window.pidPortalOpenEditor?.(game.id);
            };
        } else {
            btnEdit.style.display = 'none';
            btnEdit.onclick = null;
        }
    }

    // Tombol Main
    const btnPlay = document.getElementById('btn-detail-play');
    const btnPlayText = document.getElementById('btn-detail-play-text');
    if (btnPlay) {
        if (btnPlayText) {
            btnPlayText.textContent = !isTayang ? 'Preview Game' : 'Mainkan Game';
        }
        btnPlay.onclick = () => {
            closeGameDetailModal();
            if (isHtmlGame) {
                window.launchPidGame?.(game.id);
            } else {
                openGame(game.url || '', game.id || '');
            }
        };
    }

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeGameDetailModal() {
    const modal = document.getElementById('modal-game-detail');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}

function renderLiveCardPreview(gameData, containerId = 'live-card-preview') {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = cardHTML(gameData, 0);
}

// ==================== INSPECT HTML CODE (AI HELPER) ====================
function inspectHtmlCode(htmlStr) {
    if (!htmlStr || typeof htmlStr !== 'string') return null;
    const clean = htmlStr.trim();

    // 1. Ekstrak judul dari <title>
    const titleMatch = clean.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // 2. Ekstrak deskripsi dari meta description
    const metaDescMatch = clean.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
                          clean.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
    let description = metaDescMatch ? metaDescMatch[1].trim() : '';

    // 3. Ekstrak teks heading
    const headings = [];
    const hRegex = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi;
    let hm;
    while ((hm = hRegex.exec(clean)) !== null && headings.length < 5) {
        const text = hm[1].replace(/<[^>]+>/g, '').trim();
        if (text) headings.push(text);
    }

    if (!title && headings.length > 0) {
        title = headings[0];
    }
    if (!title) {
        title = 'Game Edukasi Mandiri';
    }

    // 4. Ekstrak cuplikan teks konten
    const textSnippet = clean
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 1500);

    return {
        title: title.substring(0, 40),
        description: description || (textSnippet ? textSnippet.substring(0, 180) + '...' : 'Game edukatif interaktif karya mandiri guru.'),
        headings,
        textSnippet,
        source: 'html_code'
    };
}

// Global Export
window.esc = esc;
window.safeSvgToDataUri = safeSvgToDataUri;
window.parseColorBrightness = parseColorBrightness;
window.isDarkBackground = isDarkBackground;
window.getStoredGeminiApiKey = getStoredGeminiApiKey;
window.getAllStoredGeminiApiKeys = getAllStoredGeminiApiKeys;
window.saveStoredGeminiApiKey = saveStoredGeminiApiKey;
window.getStudentsDataForHandshake = getStudentsDataForHandshake;
window.inspectGameUrl = inspectGameUrl;
window.inspectHtmlCode = inspectHtmlCode;
window.generateCardVisualAI = generateCardVisualAI;
window.getSmartTheme = getSmartTheme;
window.renderLiveCardPreview = renderLiveCardPreview;
window.cardHTML = cardHTML;
window.loadGames = loadGames;
window.openPidGame = openGame;
window.launchPidGame = launchPidGame;
window.closePidGamePlayer = closePidGamePlayer;
window.reloadPidGamePlayer = reloadPidGamePlayer;
window.showGameDetailModal = showGameDetailModal;
window.closeGameDetailModal = closeGameDetailModal;

// Whitelist domain game portal resmi untuk handshake aman
function isTrustedGameOrigin(urlOrOrigin) {
    if (!urlOrOrigin) return false;
    try {
        const u = new URL(urlOrOrigin, window.location.href);
        const origin = u.origin;

        // Domain produksi resmi
        const trustedProductionOrigins = [
            'https://komangpurna.web.app',
            'https://starlink-galaxy.web.app',
            "https://simas-demo-5ead3.web.app",
            'https://sman1abang.web.app',
            'https://simas-shakti.web.app',
            "https://simas-demo-5ead3.firebaseapp.com"
        ];
        if (trustedProductionOrigins.includes(origin)) return true;

        // Lingkungan pengembangan lokal (Live Server / Vite / Web Server di port berapapun)
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]') {
            return true;
        }

        return false;
    } catch {
        return false;
    }
}

// ==================== EKSTRAKSI DATA MASTER SISWA UNTUK GAME ====================
let inMemoryClassesMap = null;

function naturalClassSort(a, b) {
    const parse = (str) => {
        const match = String(str).match(/^(X|XI|XII)[-.\s]*(\d+)/i);
        if (match) {
            const levelMap = { 'X': 10, 'XI': 11, 'XII': 12 };
            const lvl = levelMap[match[1].toUpperCase()] || 99;
            const num = parseInt(match[2], 10) || 0;
            return { lvl, num };
        }
        return { lvl: 999, num: 0 };
    };
    const pA = parse(a);
    const pB = parse(b);
    if (pA.lvl !== pB.lvl) return pA.lvl - pB.lvl;
    if (pA.num !== pB.num) return pA.num - pB.num;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

async function getActiveClassesList() {
    // 1. Coba dari window.getActiveClasses jika ada
    if (typeof window.getActiveClasses === 'function') {
        try {
            const list = await window.getActiveClasses();
            if (Array.isArray(list) && list.length > 0) return list;
        } catch (e) {}
    }

    // 2. Coba dari cache system_config / metadata_classes di localStorage (0 Firestore Read)
    try {
        const sysConfigRaw = localStorage.getItem('simas_system_config_cache');
        const metaClassesRaw = localStorage.getItem('cache_master_classes_v2');
        let activeFilter = null;
        let masterList = [];

        if (sysConfigRaw) {
            const sc = JSON.parse(sysConfigRaw);
            activeFilter = sc.activeClasses || sc.activeAttendanceClasses || null;
        }
        if (metaClassesRaw) {
            masterList = JSON.parse(metaClassesRaw);
        }

        if (Array.isArray(masterList) && masterList.length > 0) {
            let res = masterList.filter(c => !String(c).toLowerCase().includes('alumni'));
            if (Array.isArray(activeFilter) && activeFilter.length > 0) {
                res = res.filter(c => activeFilter.includes(c));
            }
            if (res.length > 0) return res.sort(naturalClassSort);
        }
    } catch (e) {}

    // 3. Coba dari Firestore settings/system_config jika tersedia
    try {
        if (window.db && window.doc && window.getDoc) {
            const snap = await window.getDoc(window.doc(window.db, 'settings', 'system_config'));
            if (snap && snap.exists()) {
                const sc = snap.data();
                const activeFilter = sc.activeClasses || sc.activeAttendanceClasses || null;
                if (Array.isArray(activeFilter) && activeFilter.length > 0) {
                    return activeFilter.sort(naturalClassSort);
                }
            }
        }
    } catch (e) {}

    return null;
}

async function getStudentsDataForHandshake() {
    if (inMemoryClassesMap && Object.keys(inMemoryClassesMap).length > 0) {
        return inMemoryClassesMap;
    }

    let studentList = [];
    const cfWorkerUrl = 'https://simas-smagesa-api.komangpurna1.workers.dev';

    // 1. Coba dari window.getStudentsCache() jika ada
    if (typeof window.getStudentsCache === 'function') {
        try {
            studentList = await window.getStudentsCache();
        } catch (e) {
            console.warn('[PID Handshake] getStudentsCache error:', e);
        }
    }

    // 2. Coba dari cache_students_global (SSOT global.js)
    if (!studentList || studentList.length === 0) {
        const cachedGlobal = localStorage.getItem('cache_students_global');
        if (cachedGlobal) {
            try { studentList = JSON.parse(cachedGlobal); } catch (e) {}
        }
    }

    // 3. Coba dari simas_cached_students
    if (!studentList || studentList.length === 0) {
        const cached = localStorage.getItem('simas_cached_students');
        if (cached) {
            try { studentList = JSON.parse(cached); } catch (e) {}
        }
    }

    // 4. Coba dari IndexedDB langsung
    if ((!studentList || studentList.length === 0) && window.indexedDB) {
        try {
            studentList = await new Promise((resolve) => {
                const req = indexedDB.open('simas_db');
                req.onsuccess = (e) => {
                    const db = e.target.result;
                    if (db && db.objectStoreNames && db.objectStoreNames.contains('students')) {
                        const tx = db.transaction('students', 'readonly');
                        const store = tx.objectStore('students');
                        const getAll = store.getAll();
                        getAll.onsuccess = () => resolve(getAll.result || []);
                        getAll.onerror = () => resolve([]);
                    } else {
                        resolve([]);
                    }
                };
                req.onerror = () => resolve([]);
            });
        } catch (e) {}
    }

    // 5. Coba fetch dari Cloudflare D1 dengan Firebase Auth ID Token resmi
    if (!studentList || studentList.length === 0) {
        try {
            let token = null;
            if (window.auth?.currentUser) {
                token = await window.auth.currentUser.getIdToken();
            }
            const headers = {};
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            const resp = await fetch(`${cfWorkerUrl}/api/students?limit=2000&status=active`, { headers });
            if (resp.ok) {
                const json = await resp.json();
                studentList = json.data?.students || json.data || [];
                if (studentList.length > 0) {
                    try { localStorage.setItem('cache_students_global', JSON.stringify(studentList)); } catch (e) {}
                }
            }
        } catch (e) {
            console.warn('[PID Handshake] Fetch students error:', e);
        }
    }

    // Ambil konfigurasi kelas aktif dari Pengaturan (Single Source of Truth)
    const configuredActiveClasses = await getActiveClassesList();

    // Kelompokkan siswa per rombel/kelas (Hanya kelas aktif sesuai pengaturan)
    const classesMap = {};
    if (Array.isArray(studentList)) {
        studentList.forEach(s => {
            const status = String(s.status || '').toLowerCase().trim();
            if (status && status !== 'active' && status !== 'aktif') return;
            const k = (s.class || s.kelas || s.class_name || s.rombong || s.rombel || '').trim();
            const nama = (s.name || s.nama_lengkap || s.nama || '').trim();
            const lowerK = k.toLowerCase();
            if (!k || !nama || lowerK.includes('alumni') || lowerK.includes('keluar') || lowerK.includes('mutasi')) return;

            // Filter ketat: jika ada konfigurasi kelas aktif dari pengaturan, hanya masukkan kelas yang aktif
            if (configuredActiveClasses && Array.isArray(configuredActiveClasses) && configuredActiveClasses.length > 0) {
                if (!configuredActiveClasses.includes(k)) return;
            }

            if (!classesMap[k]) classesMap[k] = [];
            classesMap[k].push(nama);
        });
    }

    // Urutkan nama per kelas
    Object.keys(classesMap).forEach(k => {
        classesMap[k].sort((a, b) => a.localeCompare(b, 'id'));
    });

    // Urutkan daftar kelas sesuai konfigurasi pengaturan kelas aktif atau urutan alami
    const sortedClassesMap = {};
    const sortedClassNames = Object.keys(classesMap).sort((a, b) => {
        if (configuredActiveClasses && Array.isArray(configuredActiveClasses)) {
            const idxA = configuredActiveClasses.indexOf(a);
            const idxB = configuredActiveClasses.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
        }
        return naturalClassSort(a, b);
    });

    sortedClassNames.forEach(k => {
        sortedClassesMap[k] = classesMap[k];
    });

    if (Object.keys(sortedClassesMap).length > 0) {
        inMemoryClassesMap = sortedClassesMap;
    }

    return sortedClassesMap;
}

// ==================== OPEN GAME & SANDBOX PLAYER ====================
function openGame(urlOrId, fallbackGameId) {
    if (!urlOrId && !fallbackGameId) return;

    // Cek jika urlOrId atau fallbackGameId mengarah ke game berformat HTML
    const targetId = fallbackGameId || urlOrId;
    const matchedGame = Array.isArray(window.allGames) ? window.allGames.find(g => g.id === targetId || g.id === urlOrId) : null;
    if (matchedGame && (matchedGame.source_type === 'html' || matchedGame.has_html)) {
        launchPidGame(matchedGame);
        return;
    }

    const cleanUrl = String((matchedGame && matchedGame.url) ? matchedGame.url : urlOrId).trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        if (cleanUrl.startsWith('/api/pid-games/')) {
            if (matchedGame) launchPidGame(matchedGame);
            return;
        }
        return;
    }
    
    if (isTrustedGameOrigin(cleanUrl)) {
        let targetUrl = cleanUrl;
        try {
            const u = new URL(cleanUrl, window.location.href);
            if (!u.searchParams.has('portal')) {
                u.searchParams.set('portal', 'pid');
            }
            targetUrl = u.toString();
        } catch (e) {}

        const openedWindow = window.open(targetUrl, '_blank');
        
        // Broadcast data siswa (Spinner) & Gemini API Key (Sketsa AI) ke child window saat baru dibuka
        if (openedWindow) {
            // 1. Data Siswa untuk Spinner
            getStudentsDataForHandshake().then(classesMap => {
                if (classesMap && Object.keys(classesMap).length > 0) {
                    const payload = {
                        type: 'SIMAS_STUDENTS_DATA',
                        school: getSchoolConfig().schoolName,
                        classes: classesMap
                    };
                    [200, 500, 1000, 2000, 3500].forEach(delay => {
                        setTimeout(() => {
                            try {
                                if (!openedWindow.closed) {
                                    openedWindow.postMessage(payload, '*');
                                }
                            } catch (e) {}
                        }, delay);
                    });
                }
            });

            // 2. Gemini API Key untuk Game AI (Sketsa AI / Doodle AI)
            getStoredGeminiApiKey().then(apiKey => {
                if (apiKey) {
                    const keyPayload = {
                        type: 'SIMAS_PROVIDE_GEMINI_KEY',
                        apiKey: apiKey
                    };
                    [350, 700, 1400, 2500].forEach(delay => {
                        setTimeout(() => {
                            try {
                                if (!openedWindow.closed) {
                                    openedWindow.postMessage(keyPayload, '*');
                                }
                            } catch (e) {}
                        }, delay);
                    });
                }
            });
        }
    } else {
        window.open(cleanUrl, '_blank', 'noopener,noreferrer');
    }
}

async function launchPidGame(gameOrId, customHtml = null) {
    let game = typeof gameOrId === 'object' && gameOrId !== null ? gameOrId : null;
    if (!game && typeof gameOrId === 'string' && Array.isArray(window.allGames)) {
        game = window.allGames.find(g => g.id === gameOrId);
    }

    const modalPlayer = document.getElementById('modal-game-player');
    const iframe = document.getElementById('player-iframe');
    const titleEl = document.getElementById('player-game-title');
    const authorEl = document.getElementById('player-game-author');
    const emojiEl = document.getElementById('player-game-emoji');
    const spinner = document.getElementById('player-loading-spinner');
    if (!modalPlayer || !iframe) return;

    const title = game?.title || 'Game Edukasi PID';
    const author = (game?.author && game.author !== 'none') ? game.author : (game?.submitted_by_name || "Guru SMANTARA");
    const emoji = game?.theme?.emoji || '🎮';

    if (titleEl) titleEl.textContent = title;
    if (authorEl) authorEl.textContent = author;
    if (emojiEl) emojiEl.textContent = emoji;

    modalPlayer.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // 1. Jika kode HTML kustom diberikan (misal dari uji coba/live test di form)
    if (typeof customHtml === 'string' && customHtml.trim().length > 0) {
        if (spinner) spinner.style.display = 'none';
        iframe.srcdoc = customHtml;
        return;
    }

    // 2. Jika game sudah memiliki html_content di memori/cache
    if (game && game.html_content) {
        if (spinner) spinner.style.display = 'none';
        iframe.srcdoc = game.html_content;
        return;
    }

    // 3. Lazy-fetch html_content dari Cloudflare D1
    if (spinner) spinner.style.display = 'flex';
    iframe.srcdoc = '';

    const gameId = game?.id || (typeof gameOrId === 'string' ? gameOrId : null);
    if (!gameId) {
        if (spinner) spinner.style.display = 'none';
        iframe.srcdoc = '<div style="padding: 24px; font-family: sans-serif; text-align: center; color: #ef4444;"><h3>Kode Game Tidak Ditemukan</h3><p>Pastikan game telah tersimpan dengan benar.</p></div>';
        return;
    }

    try {
        const cfWorkerUrl = 'https://simas-smagesa-api.komangpurna1.workers.dev';
        const res = await fetch(`${cfWorkerUrl}/api/pid-games/${encodeURIComponent(gameId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const loadedHtml = json.data?.html_content || '';
        if (game) {
            game.html_content = loadedHtml;
        }

        if (spinner) spinner.style.display = 'none';
        if (loadedHtml) {
            iframe.srcdoc = loadedHtml;
        } else if (json.data?.url && (json.data.url.startsWith('http://') || json.data.url.startsWith('https://'))) {
            // Fallback jika ternyata game URL eksternal
            closePidGamePlayer();
            openGame(json.data.url);
        } else {
            iframe.srcdoc = '<div style="padding: 24px; font-family: sans-serif; text-align: center; color: #64748b;"><h3>Konten Game Kosong</h3></div>';
        }
    } catch (err) {
        console.error('[PID Player] Gagal memuat game HTML:', err);
        if (spinner) spinner.style.display = 'none';
        iframe.srcdoc = `<div style="padding: 24px; font-family: sans-serif; text-align: center; color: #ef4444;"><h3>Gagal Memuat Game</h3><p>${esc(err.message)}</p></div>`;
    }
}

function closePidGamePlayer() {
    const modalPlayer = document.getElementById('modal-game-player');
    const iframe = document.getElementById('player-iframe');
    if (modalPlayer) modalPlayer.style.display = 'none';
    if (iframe) iframe.srcdoc = '';
    document.body.style.overflow = '';
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    }
}

function reloadPidGamePlayer() {
    const iframe = document.getElementById('player-iframe');
    if (iframe && iframe.srcdoc) {
        const currentDoc = iframe.srcdoc;
        iframe.srcdoc = '';
        setTimeout(() => { iframe.srcdoc = currentDoc; }, 50);
    }
}

// ==================== SECURE HANDSHAKE POSTMESSAGE (0 READ DB) ====================
window.addEventListener('message', async (event) => {
    // 1. Verifikasi Origin Pengirim (OWASP & ASVS compliance)
    if (!isTrustedGameOrigin(event.origin)) return;

    // 2. Handshake Permintaan Data Siswa untuk Game Spinner
    if (event.data && event.data.type === 'SPINNER_REQUEST_STUDENTS') {
        try {
            const classesMap = await getStudentsDataForHandshake();

            // Kirimkan respon ke tab Spinner
            if (event.source && typeof event.source.postMessage === 'function') {
                event.source.postMessage({
                    type: 'SIMAS_STUDENTS_DATA',
                    school: getSchoolConfig().schoolName,
                    classes: classesMap
                }, '*');
            }
        } catch (err) {
            console.error('[PID Handshake] Gagal mengirim data siswa ke Spinner:', err);
        }
    }

    // 3. Handshake Permintaan Gemini API Key (Otomatis dari Sketsa AI / Game AI)
    if (event.data && event.data.type === 'SIMAS_REQUEST_GEMINI_KEY') {
        try {
            const key = await getStoredGeminiApiKey();
            if (event.source && typeof event.source.postMessage === 'function') {
                event.source.postMessage({
                    type: 'SIMAS_PROVIDE_GEMINI_KEY',
                    apiKey: key || null
                }, '*');
            }
        } catch (err) {
            console.warn('[PID Handshake] Gagal menyediakan Gemini API Key:', err);
        }
    }

    // 4. Handshake Penyimpanan Balik Gemini API Key ke Akun SIMAS
    if (event.data && event.data.type === 'SIMAS_SAVE_GEMINI_KEY') {
        try {
            const apiKey = typeof event.data.apiKey === 'string' ? event.data.apiKey.trim() : '';
            if (apiKey) {
                await saveStoredGeminiApiKey(apiKey);
                if (event.source && typeof event.source.postMessage === 'function') {
                    event.source.postMessage({
                        type: 'SIMAS_GEMINI_KEY_SAVED',
                        success: true
                    }, '*');
                }
            }
        } catch (err) {
            console.warn('[PID Handshake] Gagal menyimpan Gemini API Key dari game:', err);
        }
    }
});

// ==================== EMPTY STATE ====================
function showEmpty(msg) {
    document.getElementById('game-grid').innerHTML = `
        <div class="empty-state">
            <span class="e-ico">🎲</span>
            <h3>${esc(msg)}</h3>
            <p>Coba ubah filter atau kata kunci pencarian</p>
        </div>
    `;
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
