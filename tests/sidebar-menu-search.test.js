/** @jest-environment jsdom */

const fs = require('node:fs');
const path = require('node:path');

// Muat global.js ke lingkungan pengujian tanpa statement import ES module
const rawSource = fs.readFileSync(path.join(__dirname, '../js/global.js'), 'utf8');
const cleanedSource = rawSource
    .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm, '// import stripped')
    .replace(/import\.meta\.url/g, "'http://localhost/js/global.js'")
    .replace(/^\s*export\s+/gm, '');

describe('Pencarian Menu Sidebar Hybrid & Paritas Otorisasi RBAC', () => {
    let originalLocation;

    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = `
            <div id="app-layout"></div>
            <main class="md:ml-64"></main>
        `;

        // Mock Firebase Auth & window global helpers
        const mockAuth = { currentUser: { uid: 'test-user-guru', email: 'guru@smagesa.sch.id' } };
        window.auth = mockAuth;
        global.auth = mockAuth;
        global.db = {};
        global.PATHS = { users: 'users' };
        global.APP_VERSION = '26.10.29.1';
        global.supabase = {};
        global.SUPABASE_URL = 'http://localhost';
        global.SUPABASE_ANON_KEY = 'anon';
        global.getAiConfig = jest.fn();
        global.getAiConfigAsync = jest.fn();
        global.AI_CONFIG = {};
        global.SCHOOL_CONFIG = {
            schoolShortName: 'SMAGESA',
            schoolName: 'SMA Negeri 1 Abang',
            appBrand: 'SIMAS - SHAKTI',
            logoPath: 'img/logo.png',
            primaryDomain: 'smagesa.web.app'
        };
        global.resolvePhotoUrl = url => url;
        global.onAuthStateChanged = jest.fn((auth, cb) => () => {});
        global.signOut = jest.fn().mockResolvedValue();
        global.updateProfile = jest.fn().mockResolvedValue();
        global.updateEmail = jest.fn().mockResolvedValue();
        global.updatePassword = jest.fn().mockResolvedValue();
        global.reauthenticateWithCredential = jest.fn().mockResolvedValue();
        global.EmailAuthProvider = {};
        global.cfClient = { get: jest.fn(), post: jest.fn() };
        global.doc = jest.fn((...args) => args);
        global.getDoc = jest.fn().mockResolvedValue({ exists: () => false, data: () => null });
        global.updateDoc = jest.fn().mockResolvedValue();
        global.setDoc = jest.fn().mockResolvedValue();
        global.getDocs = jest.fn().mockResolvedValue({ docs: [] });
        global.collection = jest.fn((...args) => args);
        global.query = jest.fn((...args) => args);
        global.where = jest.fn((...args) => args);
        global.serverTimestamp = jest.fn(() => new Date());
        global.onSnapshot = jest.fn((q, cb) => () => {});
        global.setupPushNotifications = jest.fn();
        global.SimasDB = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
        global.startIdleSessionMonitor = jest.fn();

        window.matchMedia = window.matchMedia || function () {
            return {
                matches: false,
                addListener: function () { },
                removeListener: function () { },
                addEventListener: function () { },
                removeEventListener: function () { }
            };
        };
        window.ROOT_URL = 'http://localhost/';
        window.SCHOOL_CONFIG = global.SCHOOL_CONFIG;
        window.APP_VERSION = global.APP_VERSION;
        window.userRole = 'guru_mapel';
        window.getAllUserRoles = () => ['guru_mapel'];
        window.syncDarkModeToggles = jest.fn();
        window.updateSidebarProfileFromDB = jest.fn();
        window.updatePWAInstallUI = jest.fn();
        window.isRankingKelasAllowedForUser = () => true;
        window.resolvePhotoUrl = url => url;

        // Evaluasi global.js
        eval(cleanedSource);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // -------------------------------------------------------------
    // 1. Normalisasi Teks & Logika Pencocokan Multi-Token
    // -------------------------------------------------------------
    describe('1. Normalisasi Teks & Pencocokan Multi-Token', () => {
        test('normalizeMenuSearchText menangani huruf kapital, spasi berlebih, dan karakter aksen diakritik', () => {
            expect(window.normalizeMenuSearchText('  Présensi   SISWA  ')).toBe('presensi siswa');
            expect(window.normalizeMenuSearchText(null)).toBe('');
            expect(window.normalizeMenuSearchText(123)).toBe('');
        });

        test('matchMenuSearch mendukung multi-token AND matching', () => {
            const haystack = 'portal wali kelas rombel catatan siswa';
            expect(window.matchMenuSearch(haystack, 'wali')).toBe(true);
            expect(window.matchMenuSearch(haystack, 'wali kelas')).toBe(true);
            expect(window.matchMenuSearch(haystack, 'kelas wali')).toBe(true);
            expect(window.matchMenuSearch(haystack, 'wali guru')).toBe(false);
        });

        test('matchMenuSearch mendukung pencarian via kata kunci sinonim/alias', () => {
            const searchText = 'presensi siswa presensi & monitoring absen absensi kehadiran siswa hadir bolos izin';
            expect(window.matchMenuSearch(searchText, 'absen')).toBe(true);
            expect(window.matchMenuSearch(searchText, 'kehadiran')).toBe(true);
            expect(window.matchMenuSearch(searchText, 'bolos')).toBe(true);
        });
    });

    // -------------------------------------------------------------
    // 2. Paritas Hak Akses Peran (RBAC Parity)
    // -------------------------------------------------------------
    describe('2. Paritas Hak Akses Peran (RBAC Parity & Zero Leakage)', () => {
        test('Role guru_mapel tidak dapat menemukan menu super_admin / keuangan / sistem', () => {
            window.userRole = 'guru_mapel';
            window.getAllUserRoles = () => ['guru_mapel'];
            window.initLayout('guru_mapel');

            // Verifikasi SSOT allowedKeys
            expect(window.__simasAllowedMenuKeys).not.toContain('users');
            expect(window.__simasAllowedMenuKeys).not.toContain('settings');
            expect(window.__simasAllowedMenuKeys).not.toContain('keuangan');

            // Verifikasi elemen DOM tidak merender menu terlarang
            const usersItem = document.querySelector('[data-menu-key="users"]');
            expect(usersItem).toBeNull();
            const settingsItem = document.querySelector('[data-menu-key="settings"]');
            expect(settingsItem).toBeNull();

            // Jalankan pencarian kata kunci menu terlarang
            window.applyMenuSearch('desktop', 'manajemen user');
            const emptyEl = document.getElementById('desktop-menu-search-empty');
            expect(emptyEl.classList.contains('hidden')).toBe(false);

            window.applyMenuSearch('desktop', 'spp');
            expect(emptyEl.classList.contains('hidden')).toBe(false);
        });

        test('Role super_admin dapat menemukan menu manajemen user, pengaturan, dan spp', () => {
            window.userRole = 'super_admin';
            window.getAllUserRoles = () => ['super_admin'];
            window.initLayout('super_admin');

            expect(window.__simasAllowedMenuKeys).toContain('users');
            expect(window.__simasAllowedMenuKeys).toContain('settings');
            expect(window.__simasAllowedMenuKeys).toContain('keuangan');

            const usersItem = document.querySelector('[data-menu-key="users"]');
            expect(usersItem).not.toBeNull();

            window.applyMenuSearch('desktop', 'user');
            const emptyEl = document.getElementById('desktop-menu-search-empty');
            expect(emptyEl.classList.contains('hidden')).toBe(true);
            expect(usersItem.classList.contains('hidden')).toBe(false);
        });

        test('Kebijakan Ranking Kelas dinonaktifkan: menu ranking_kelas tidak dapat dicari', () => {
            window.userRole = 'super_admin';
            window.getAllUserRoles = () => ['super_admin'];
            window.isRankingKelasAllowedForUser = () => false; // Dinonaktifkan
            window.initLayout('super_admin');

            expect(window.__simasAllowedMenuKeys).not.toContain('ranking_kelas');
            const rankingItem = document.querySelector('[data-menu-key="ranking_kelas"]');
            expect(rankingItem).toBeNull();

            window.applyMenuSearch('desktop', 'ranking');
            const emptyEl = document.getElementById('desktop-menu-search-empty');
            expect(emptyEl.classList.contains('hidden')).toBe(false);
        });
    });

    // -------------------------------------------------------------
    // 3. Penyaringan DOM, Accordion Auto-Expand & Restorasi
    // -------------------------------------------------------------
    describe('3. Penyaringan DOM, Accordion Auto-Expand & Restorasi', () => {
        beforeEach(() => {
            window.userRole = 'super_admin';
            window.getAllUserRoles = () => ['super_admin'];
            window.initLayout('super_admin');
        });

        test('Menyaring menu instan: membuka accordion yang cocok dan menyembunyikan group yang tidak cocok', () => {
            // Sebelum pencarian: group perpustakaan tertutup
            const perpusGroup = document.querySelector('.menu-group[data-group="perpustakaan_group"]');
            expect(perpusGroup).not.toBeNull();
            const perpusItems = perpusGroup.querySelector('.menu-group-items');

            // Cari buku / perpustakaan
            window.applyMenuSearch('desktop', 'sirkulasi');

            // Group perpustakaan harus tampil dan terbuka
            expect(perpusGroup.classList.contains('hidden')).toBe(false);
            expect(perpusItems.classList.contains('hidden')).toBe(false);

            // Item sirkulasi buku harus terlihat
            const sirkulasiItem = document.querySelector('[data-menu-key="lib_sirkulasi"]');
            expect(sirkulasiItem.classList.contains('hidden')).toBe(false);

            // Group sarpras yang tidak cocok harus disembunyikan
            const sarprasGroup = document.querySelector('.menu-group[data-group="sarpras_group"]');
            expect(sarprasGroup.classList.contains('hidden')).toBe(true);

            // Divider visual harus disembunyikan saat pencarian
            const dividers = document.querySelectorAll('[data-menu-divider]');
            dividers.forEach(d => expect(d.classList.contains('hidden')).toBe(true));
        });

        test('Mencocokkan nama group membuka seluruh sub-item di dalam group tersebut', () => {
            window.applyMenuSearch('desktop', 'perpustakaan');
            const perpusGroup = document.querySelector('.menu-group[data-group="perpustakaan_group"]');
            expect(perpusGroup.classList.contains('hidden')).toBe(false);

            const subItems = perpusGroup.querySelectorAll('[data-menu-item]');
            subItems.forEach(item => {
                expect(item.classList.contains('hidden')).toBe(false);
            });
        });

        test('Reset pencarian memulihkan keadaan accordion asli tanpa mengubah localStorage', () => {
            // Set initial open group di localStorage dan buka di DOM
            localStorage.setItem('sidebar_open_groups', JSON.stringify(['agenda_group']));
            const initialAgendaItems = document.querySelector('.menu-group[data-group="agenda_group"] .menu-group-items');
            if (initialAgendaItems) initialAgendaItems.classList.remove('hidden');

            // Cari kata kunci
            window.applyMenuSearch('desktop', 'sirkulasi');

            // Bersihkan pencarian
            window.resetMenuSearch('desktop');

            // Verifikasi dividers muncul kembali
            const dividers = document.querySelectorAll('[data-menu-divider]');
            dividers.forEach(d => expect(d.classList.contains('hidden')).toBe(false));

            // Verifikasi localStorage sidebar_open_groups tetap 'agenda_group'
            expect(localStorage.getItem('sidebar_open_groups')).toBe(JSON.stringify(['agenda_group']));

            // Group agenda_group terbuka kembali
            const agendaItems = document.querySelector('.menu-group[data-group="agenda_group"] .menu-group-items');
            expect(agendaItems.classList.contains('hidden')).toBe(false);

            // Group perpustakaan kembali tertutup
            const perpusItems = document.querySelector('.menu-group[data-group="perpustakaan_group"] .menu-group-items');
            expect(perpusItems.classList.contains('hidden')).toBe(true);
        });

        test('Empty state dan aria-live status beroperasi dengan benar saat tidak ada menu yang cocok', () => {
            window.applyMenuSearch('desktop', 'kata-kunci-ngawur-xyz-123');
            const emptyEl = document.getElementById('desktop-menu-search-empty');
            const statusEl = document.getElementById('desktop-menu-search-status');

            expect(emptyEl.classList.contains('hidden')).toBe(false);
            expect(statusEl.textContent).toBe('Menu tidak ditemukan');
        });
    });

    // -------------------------------------------------------------
    // 4. Riwayat "Terakhir Dibuka" (Recent Menus) & Isolasi Akun
    // -------------------------------------------------------------
    describe('4. Riwayat Terakhir Dibuka (Recent Menus) & Isolasi Akun', () => {
        beforeEach(() => {
            window.userRole = 'guru_mapel';
            window.getAllUserRoles = () => ['guru_mapel'];
            window.initLayout('guru_mapel');
        });

        test('recordRecentMenu menolak menu yang tidak ada dalam hak akses role aktif', () => {
            window.recordRecentMenu('users'); // menu super_admin terlarang untuk guru_mapel
            const keys = window.getRecentMenuKeys('test-user-guru');
            expect(keys).not.toContain('users');
            expect(keys.length).toBe(0);
        });

        test('recordRecentMenu menyimpan menu yang sah maksimal 3 item terbaru tanpa duplikat', () => {
            window.recordRecentMenu('jadwal');
            window.recordRecentMenu('presensi');
            window.recordRecentMenu('agenda');
            window.recordRecentMenu('dokumen'); // item ke-4, jadwal harus tergeser dari top 3

            const keys = window.getRecentMenuKeys('test-user-guru');
            expect(keys.length).toBeLessThanOrEqual(3);
            expect(keys[0]).toBe('dokumen'); // yang paling baru di depan
            expect(keys).toContain('agenda');
            expect(keys).toContain('presensi');
        });

        test('getRecentMenuKeys membuang menu terlarang secara otomatis jika role pengguna diturunkan', () => {
            // Simulasikan akun sebelumnya super_admin menyimpan 'users'
            localStorage.setItem('simas_recent_menus_test-user-guru', JSON.stringify(['users', 'agenda', 'jadwal']));

            // Saat ini role adalah guru_mapel (users tidak diizinkan)
            const keys = window.getRecentMenuKeys('test-user-guru', window.__simasAllowedMenuKeys);
            expect(keys).not.toContain('users');
            expect(keys).toEqual(['agenda', 'jadwal']);
        });

        test('Data corrupt pada localStorage ditangani secara defensif tanpa error runtime', () => {
            localStorage.setItem('simas_recent_menus_test-user-guru', 'bukan-json-valid{{{');
            expect(window.getRecentMenuKeys('test-user-guru')).toEqual([]);

            localStorage.setItem('simas_recent_menus_test-user-guru', JSON.stringify({ bukan: 'array' }));
            expect(window.getRecentMenuKeys('test-user-guru')).toEqual([]);
        });

        test('Isolasi Akun: Riwayat tersimpan per-UID akun dan dibersihkan saat ganti akun', () => {
            localStorage.setItem('simas_recent_menus_user-A', JSON.stringify(['agenda']));
            localStorage.setItem('simas_recent_menus_user-B', JSON.stringify(['jadwal']));

            expect(window.getRecentMenuKeys('user-A')).toEqual(['agenda']);
            expect(window.getRecentMenuKeys('user-B')).toEqual(['jadwal']);
        });
    });

    // -------------------------------------------------------------
    // 5. Pencegahan Kerentanan XSS & Manipulasi Teks
    // -------------------------------------------------------------
    describe('5. Pencegahan Kerentanan XSS & Keamanan DOM', () => {
        beforeEach(() => {
            window.userRole = 'guru_mapel';
            window.getAllUserRoles = () => ['guru_mapel'];
            window.initLayout('guru_mapel');
        });

        test('Pencarian dengan payload XSS tidak mengeksekusi atau merender tag HTML berbahaya', () => {
            const xssPayload = '<img src=x onerror=alert(1)>';
            window.applyMenuSearch('desktop', xssPayload);

            // Pastikan tidak ada tag img berbahaya yang disuntikkan ke DOM
            const dangerousImg = document.querySelector('img[src="x"]');
            expect(dangerousImg).toBeNull();
        });
    });

    // -------------------------------------------------------------
    // 6. Anti-Overlapping UI Guard & Responsivitas Mode Ciut
    // -------------------------------------------------------------
    describe('6. Anti-Overlapping UI Guard & Responsivitas Mode Ciut', () => {
        test('Input pencarian desktop dan mobile tidak memuat leading icon di dalam area ketik', () => {
            window.userRole = 'super_admin';
            window.getAllUserRoles = () => ['super_admin'];
            window.initLayout('super_admin');

            const desktopInput = document.getElementById('sidebar-menu-search-desktop');
            expect(desktopInput).not.toBeNull();
            // Verifikasi padding kiri wajar dan padding kanan lapang untuk tombol clear/shortcut
            expect(desktopInput.className).toContain('pl-3');
            expect(desktopInput.className).toContain('pr-14');
            expect(desktopInput.className).not.toContain('pl-9');
            expect(desktopInput.className).not.toContain('pl-10');

            const mobileInput = document.getElementById('sidebar-menu-search-mobile');
            expect(mobileInput).not.toBeNull();
            expect(mobileInput.className).toContain('pl-3.5');
            expect(mobileInput.className).toContain('pr-10');
            expect(mobileInput.className).not.toContain('pl-9');
            expect(mobileInput.className).not.toContain('pl-10');
        });

        test('Mode sidebar ciut (w-20) menampilkan tombol mini pencarian dan menyembunyikan input utama', () => {
            localStorage.setItem('sidebar_collapsed', 'true');
            window.userRole = 'super_admin';
            window.getAllUserRoles = () => ['super_admin'];
            window.initLayout('super_admin');

            const collapsedBtn = document.getElementById('desktop-menu-search-collapsed');
            const searchContainer = document.getElementById('desktop-menu-search-container');

            expect(collapsedBtn.classList.contains('flex')).toBe(true);
            expect(searchContainer.classList.contains('hidden')).toBe(true);
        });

        test('focusSidebarMenuSearch melebarkan sidebar secara otomatis jika sedang dalam mode ciut', () => {
            localStorage.setItem('sidebar_collapsed', 'true');
            window.userRole = 'super_admin';
            window.getAllUserRoles = () => ['super_admin'];
            window.initLayout('super_admin');

            // Panggil fungsi fokus pencarian
            window.focusSidebarMenuSearch();

            const sidebar = document.getElementById('desktop-sidebar');
            // Sidebar harus melebar kembali ke w-64
            expect(sidebar.classList.contains('w-64')).toBe(true);
            expect(sidebar.classList.contains('w-20')).toBe(false);
        });
    });
});
