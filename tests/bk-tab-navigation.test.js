/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');

describe('Ruang BK - Navigasi Tab & Eliminasi Bug Tab Ganda (SSOT switchBkTab)', () => {
    const rootDir = path.resolve(__dirname, '..');
    const bkHtmlPath = path.join(rootDir, 'bk.html');
    const pageBkPath = path.join(rootDir, 'js/page-bk.js');

    let bkHtmlContent;
    let pageBkContent;
    let switchBkTab;

    beforeAll(() => {
        bkHtmlContent = fs.readFileSync(bkHtmlPath, 'utf8');
        pageBkContent = fs.readFileSync(pageBkPath, 'utf8');

        // Ekstrak fungsi switchBkTab dari js/page-bk.js
        const fnMatch = pageBkContent.match(/export function switchBkTab\([\s\S]*?\n\}/);
        expect(fnMatch).toBeTruthy();

        const cleanCode = fnMatch[0].replace('export function switchBkTab', 'function switchBkTab');
        const fnFactory = new Function(`${cleanCode}; return switchBkTab;`);
        switchBkTab = fnFactory();
    });

    beforeEach(() => {
        // Setup DOM representasi Ruang BK
        document.body.innerHTML = `
            <div id="tab-nav">
                <button id="tab-dashboard" class="shrink-0 px-3.5 sm:px-5 py-2 text-xs sm:text-sm font-bold rounded-lg bg-blue-600 text-white shadow transition-all">Dashboard</button>
                <button id="tab-input" class="shrink-0 px-3.5 sm:px-5 py-2 text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-all">Input Penanganan</button>
                <button id="tab-history" class="shrink-0 px-3.5 sm:px-5 py-2 text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-all">Data Riwayat</button>
            </div>
            <div id="view-dashboard" class="fade-in space-y-6">Konten Dashboard</div>
            <div id="view-input" class="hidden fade-in">Konten Input</div>
            <div id="view-history" class="hidden fade-in">Konten Riwayat</div>
        `;

        // Mock window.switchTab sesuai implementasi di bk.html
        window.switchTab = function (tab) {
            const tabs = ['dashboard', 'input', 'history'];
            tabs.forEach(t => {
                const btn = document.getElementById(`tab-${t}`);
                const view = document.getElementById(`view-${t}`);
                if (!btn || !view) return;
                if (t === tab) {
                    btn.className = "shrink-0 px-3.5 sm:px-5 py-2 text-xs sm:text-sm font-bold rounded-lg bg-blue-600 text-white shadow transition-all";
                    view.classList.remove('hidden');
                } else {
                    btn.className = "shrink-0 px-3.5 sm:px-5 py-2 text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-all";
                    view.classList.add('hidden');
                }
            });
        };
    });

    afterEach(() => {
        delete window.switchTab;
        document.body.innerHTML = '';
    });

    describe('1. Verifikasi Integritas Script di bk.html & page-bk.js', () => {
        test('bk.html memiliki fungsi switchTab dengan null-check aman', () => {
            expect(bkHtmlContent).toContain('function switchTab(tab)');
            expect(bkHtmlContent).toContain('if (!btn || !view) return;');
        });

        test('page-bk.js mengekspor switchBkTab', () => {
            expect(pageBkContent).toContain('export function switchBkTab(targetTab)');
        });

        test('openActiveCase memanggil switchBkTab alih-alih manipulasi DOM parsial', () => {
            const openCaseMatch = pageBkContent.match(/window\.openActiveCase\s*=\s*async\s*\([\s\S]*?\n\};/);
            expect(openCaseMatch).toBeTruthy();
            const openCaseCode = openCaseMatch[0];
            expect(openCaseCode).toContain("switchBkTab('input')");
            expect(openCaseCode).not.toContain("document.getElementById('tab-history').className =");
        });

        test('selectStudentManual memanggil switchBkTab alih-alih manipulasi DOM parsial', () => {
            const selectManualMatch = pageBkContent.match(/window\.selectStudentManual\s*=\s*\([\s\S]*?\n\};/);
            expect(selectManualMatch).toBeTruthy();
            const selectManualCode = selectManualMatch[0];
            expect(selectManualCode).toContain("switchBkTab('input')");
            expect(selectManualCode).not.toContain("document.getElementById('tab-dashboard').className =");
        });

        test('editBkAction memanggil switchBkTab alih-alih manipulasi DOM parsial', () => {
            const editActionMatch = pageBkContent.match(/window\.editBkAction\s*=\s*async\s*\([\s\S]*?\n\};/);
            expect(editActionMatch).toBeTruthy();
            const editActionCode = editActionMatch[0];
            expect(editActionCode).toContain("switchBkTab('input')");
            expect(editActionCode).not.toContain("document.getElementById('tab-history').className =");
        });
    });

    describe('2. Skenario Penanganan Kasus Dalam Pantauan (openActiveCase)', () => {
        test('berpindah dari Dashboard ke Input tanpa meninggalkan 2 tab aktif bersamaan', () => {
            // Kondisi Awal: Tab Dashboard Aktif, Input & Riwayat Hidden
            const tabDash = document.getElementById('tab-dashboard');
            const tabInput = document.getElementById('tab-input');
            const tabHist = document.getElementById('tab-history');
            const viewDash = document.getElementById('view-dashboard');
            const viewInput = document.getElementById('view-input');
            const viewHist = document.getElementById('view-history');

            expect(tabDash.className).toContain('bg-blue-600 text-white shadow');
            expect(viewDash.classList.contains('hidden')).toBe(false);
            expect(tabInput.className).toContain('text-slate-500');
            expect(viewInput.classList.contains('hidden')).toBe(true);

            // Simulasi pemicu tombol 'Proses' di Kasus Dalam Pantauan
            switchBkTab('input');

            // Kondisi Setelah 'Proses': Hanya Tab Input yang Aktif!
            expect(tabDash.className).not.toContain('bg-blue-600');
            expect(tabDash.className).toContain('text-slate-500');
            expect(viewDash.classList.contains('hidden')).toBe(true);

            expect(tabInput.className).toContain('bg-blue-600 text-white shadow');
            expect(viewInput.classList.contains('hidden')).toBe(false);

            expect(tabHist.className).not.toContain('bg-blue-600');
            expect(viewHist.classList.contains('hidden')).toBe(true);

            // Pastikan tepat 1 tombol bertanda aktif dan tepat 1 view yang tampil
            const activeButtons = [tabDash, tabInput, tabHist].filter(b => b.className.includes('bg-blue-600'));
            const visibleViews = [viewDash, viewInput, viewHist].filter(v => !v.classList.contains('hidden'));

            expect(activeButtons.length).toBe(1);
            expect(visibleViews.length).toBe(1);
            expect(activeButtons[0].id).toBe('tab-input');
            expect(visibleViews[0].id).toBe('view-input');
        });
    });

    describe('3. Ketahanan Mode Mandiri Fallback switchBkTab (Ketika window.switchTab Absen)', () => {
        test('berfungsi sempurna mengisolasi tab aktif meskipun window.switchTab tidak didefinisikan', () => {
            delete window.switchTab;

            // Kondisi awal: tab riwayat aktif
            window.switchTab = null;
            document.getElementById('tab-dashboard').className = "text-slate-500";
            document.getElementById('view-dashboard').classList.add('hidden');
            document.getElementById('tab-history').className = "bg-blue-600 text-white shadow";
            document.getElementById('view-history').classList.remove('hidden');

            switchBkTab('input');

            const tabDash = document.getElementById('tab-dashboard');
            const tabInput = document.getElementById('tab-input');
            const tabHist = document.getElementById('tab-history');
            const viewDash = document.getElementById('view-dashboard');
            const viewInput = document.getElementById('view-input');
            const viewHist = document.getElementById('view-history');

            expect(tabInput.className).toContain('bg-blue-600');
            expect(viewInput.classList.contains('hidden')).toBe(false);

            expect(tabHist.className).not.toContain('bg-blue-600');
            expect(viewHist.classList.contains('hidden')).toBe(true);

            expect(tabDash.className).not.toContain('bg-blue-600');
            expect(viewDash.classList.contains('hidden')).toBe(true);
        });

        test('tidak melempar error jika elemen DOM salah satu tab tidak ditemukan', () => {
            delete window.switchTab;
            // Hapus salah satu view
            const viewHist = document.getElementById('view-history');
            viewHist.remove();

            expect(() => {
                switchBkTab('dashboard');
            }).not.toThrow();

            const tabDash = document.getElementById('tab-dashboard');
            expect(tabDash.className).toContain('bg-blue-600');
        });
    });
});
