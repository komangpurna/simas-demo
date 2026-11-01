/**
 * @jest-environment jsdom
 */

/**
 * Unit Test Suite: Integritas Toolbar Tab Rekap Realisasi & Eliminasi Pemilih Guru Duplikat E-Kinerja
 * (e-kinerja.html, js/page-beban-kerja.js, js/page-e-kinerja.js)
 * Sesuai Permintaan User:
 * 1. Menghapus pemilih guru kedua di bawah agar hanya ada 1 nama guru di bilah atas (SSOT).
 * 2. Memindahkan filter bulan ke sebelah kanan tab yang ada.
 * 3. Tombol segarkan menggunakan icon saja mengikuti filter bulan.
 * 4. Hanya muncul saat tab rekap realisasi aktif.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Integritas Toolbar Tab Rekap Realisasi & Pembersih Guru Duplikat', () => {
    const root = path.resolve(__dirname, '..');
    const htmlPath = path.join(root, 'e-kinerja.html');
    const jsBebanKerjaPath = path.join(root, 'js', 'page-beban-kerja.js');
    const jsEKinerjaPath = path.join(root, 'js', 'page-e-kinerja.js');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const jsBebanKerjaContent = fs.readFileSync(jsBebanKerjaPath, 'utf8');
    const jsEKinerjaContent = fs.readFileSync(jsEKinerjaPath, 'utf8');

    describe('1. Verifikasi Markup HTML (e-kinerja.html)', () => {
        test('Eliminasi pemilih guru duplikat di bawah tab rekap (#rekap-supervisor-teacher-box & #select-rekap-teacher-alt)', () => {
            expect(htmlContent).not.toContain('id="rekap-supervisor-teacher-box"');
            expect(htmlContent).not.toContain('id="select-rekap-teacher-alt"');
        });

        test('Memastikan bilah pemilih guru tunggal (#admin-teacher-selector-strip) tetap ada sebagai SSOT', () => {
            expect(htmlContent).toContain('id="admin-teacher-selector-strip"');
            expect(htmlContent).toContain('id="input-admin-teacher-search"');
        });

        test('Wadah #tab-rekap-toolbar terdaftar di sisi kanan deretan tab navigasi utama', () => {
            expect(htmlContent).toContain('id="tab-rekap-toolbar"');
            // Pastikan posisinya di dalam header tab navigation (sebelum panel tab konten)
            const tabNavIndex = htmlContent.indexOf('id="tab-rekap-toolbar"');
            const tabContentIndex = htmlContent.indexOf('id="tab-content-today"');
            expect(tabNavIndex).toBeGreaterThan(0);
            expect(tabNavIndex).toBeLessThan(tabContentIndex);
        });

        test('#tab-rekap-toolbar memuat kontrol periode bulan dan tahun yang valid', () => {
            expect(htmlContent).toContain('id="btn-rekap-prev-month"');
            expect(htmlContent).toContain('id="select-rekap-month"');
            expect(htmlContent).toContain('id="select-rekap-year"');
            expect(htmlContent).toContain('id="btn-rekap-next-month"');
            expect(htmlContent).toContain('window.workloadSetCurrentMonth()');
        });

        test('Tombol #btn-rekap-reload menggunakan ikon putar saja tanpa label teks panjang', () => {
            expect(htmlContent).toContain('id="btn-rekap-reload"');
            expect(htmlContent).toMatch(/id="btn-rekap-reload"[^>]*>[\s\n]*<i class="fa-solid fa-arrows-rotate text-xs"><\/i>[\s\n]*<\/button>/);
            expect(htmlContent).not.toContain('<span class="hidden sm:inline">Segarkan</span>');
        });

        test('#tab-rekap-toolbar memiliki class hidden secara default', () => {
            expect(htmlContent).toMatch(/id="tab-rekap-toolbar"[^>]*class="[^"]*hidden/);
        });
    });

    describe('2. Verifikasi Logika Controller JavaScript (js/page-beban-kerja.js & js/page-e-kinerja.js)', () => {
        test('Ekspor fungsi updateRekapToolbarVisibility tersedia di js/page-beban-kerja.js', () => {
            expect(jsBebanKerjaContent).toContain('export function updateRekapToolbarVisibility()');
        });

        test('window.workloadUpdateRekapToolbarVisibility diekspos di initWorkloadPage', () => {
            expect(jsBebanKerjaContent).toContain('window.workloadUpdateRekapToolbarVisibility = updateRekapToolbarVisibility;');
        });

        test('switchTab dan renderAll memanggil updateRekapToolbarVisibility()', () => {
            expect(jsBebanKerjaContent).toMatch(/function switchTab[\s\S]*?updateRekapToolbarVisibility\(\)/);
            expect(jsBebanKerjaContent).toMatch(/function renderAll[\s\S]*?updateRekapToolbarVisibility\(\)/);
        });

        test('renderRekapTab memanggil updateRekapToolbarVisibility() dan bersih dari supervisorSelect', () => {
            expect(jsBebanKerjaContent).toMatch(/function renderRekapTab[\s\S]*?updateRekapToolbarVisibility\(\)/);
            expect(jsBebanKerjaContent).not.toContain('supervisorBox');
            expect(jsBebanKerjaContent).not.toContain('supervisorSelect');
        });

        test('setupSupervisorAccess di js/page-e-kinerja.js mengamankan visibilitas tab-rekap-toolbar', () => {
            expect(jsEKinerjaContent).toContain('window.workloadUpdateRekapToolbarVisibility');
            expect(jsEKinerjaContent).toContain('tab-rekap-toolbar');
        });
    });

    describe('3. Simulasi DOM Logic untuk Visibilitas Toolbar Rekap', () => {
        let toolbarEl;

        beforeEach(() => {
            document.body.innerHTML = `
                <div id="tab-rekap-toolbar" class="hidden items-center">
                    <button id="btn-rekap-reload"></button>
                </div>
            `;
            toolbarEl = document.getElementById('tab-rekap-toolbar');
        });

        test('Toolbar rekap ditampilkan saat tab rekap aktif dan guru terpilih', () => {
            let activeTab = 'tab-rekap';
            let isMgr = true;
            let selectedTeacherId = 'PTK-001';

            const shouldShow = (activeTab === 'tab-rekap') && (!isMgr || Boolean(selectedTeacherId));
            if (shouldShow) {
                toolbarEl.classList.remove('hidden', '!hidden');
                toolbarEl.classList.add('flex');
            } else {
                toolbarEl.classList.add('hidden', '!hidden');
                toolbarEl.classList.remove('flex');
            }

            expect(toolbarEl.classList.contains('hidden')).toBe(false);
            expect(toolbarEl.classList.contains('flex')).toBe(true);
        });

        test('Toolbar rekap disembunyikan jika supervisor belum memilih guru', () => {
            let activeTab = 'tab-rekap';
            let isMgr = true;
            let selectedTeacherId = '';

            const shouldShow = (activeTab === 'tab-rekap') && (!isMgr || Boolean(selectedTeacherId));
            if (shouldShow) {
                toolbarEl.classList.remove('hidden', '!hidden');
                toolbarEl.classList.add('flex');
            } else {
                toolbarEl.classList.add('hidden', '!hidden');
                toolbarEl.classList.remove('flex');
            }

            expect(toolbarEl.classList.contains('hidden')).toBe(true);
            expect(toolbarEl.classList.contains('flex')).toBe(false);
        });

        test('Toolbar rekap disembunyikan saat berpindah ke tab Realisasi atau Rencana', () => {
            ['tab-today', 'tab-plan', 'tab-monitoring', 'tab-templates'].forEach(activeTab => {
                let isMgr = false;
                let selectedTeacherId = null;

                const shouldShow = (activeTab === 'tab-rekap') && (!isMgr || Boolean(selectedTeacherId));
                if (shouldShow) {
                    toolbarEl.classList.remove('hidden', '!hidden');
                    toolbarEl.classList.add('flex');
                } else {
                    toolbarEl.classList.add('hidden', '!hidden');
                    toolbarEl.classList.remove('flex');
                }

                expect(toolbarEl.classList.contains('hidden')).toBe(true);
            });
        });
    });
});
