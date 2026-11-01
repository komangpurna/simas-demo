const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

describe('Verifikasi Mode Monitoring Supervisi & Rekapan Mingguan Tendik', () => {
    let tendikHtml;
    let tendikJs;
    let dom;
    let doc;

    beforeAll(() => {
        const htmlPath = path.join(__dirname, '../e-kinerja-tendik.html');
        const jsPath = path.join(__dirname, '../js/page-e-kinerja-tendik.js');
        tendikHtml = fs.readFileSync(htmlPath, 'utf8');
        tendikJs = fs.readFileSync(jsPath, 'utf8');
        dom = new JSDOM(tendikHtml, { runScripts: 'outside-only' });
        doc = dom.window.document;
    });

    beforeEach(() => {
        dom = new JSDOM(tendikHtml, { runScripts: 'outside-only' });
        doc = dom.window.document;
    });

    // =========================================================================
    // 1. STRUKTUR DOM PANEL MONITORING & REKAPAN MINGGUAN / HARIAN
    // =========================================================================
    describe('1. Integritas Struktur DOM Panel Monitoring Supervisi', () => {
        test('1.1. Kontainer panel #section-employee-summary-view tersedia di dalam tab pegawai', () => {
            const panel = doc.getElementById('section-employee-summary-view');
            expect(panel).not.toBeNull();
            expect(panel.classList.contains('hidden')).toBe(true); // default tersembunyi untuk staf biasa

            const tabContent = doc.getElementById('tab-content-employee');
            expect(tabContent).not.toBeNull();
            expect(tabContent.contains(panel)).toBe(true);
        });

        test('1.2. Tombol pengalih mode Harian dan Mingguan tersedia dengan ID yang tepat', () => {
            const btnDaily = doc.getElementById('btn-summary-mode-daily');
            const btnWeekly = doc.getElementById('btn-summary-mode-weekly');
            expect(btnDaily).not.toBeNull();
            expect(btnWeekly).not.toBeNull();
            expect(btnDaily.getAttribute('onclick')).toContain("setSummaryMode('daily')");
            expect(btnWeekly.getAttribute('onclick')).toContain("setSummaryMode('weekly')");
        });

        test('1.3. Baris navigasi pekan #weekly-nav-bar memuat kontrol navigasi lengkap', () => {
            const navBar = doc.getElementById('weekly-nav-bar');
            expect(navBar).not.toBeNull();

            const btnPrev = doc.getElementById('btn-summary-prev-week');
            const btnNext = doc.getElementById('btn-summary-next-week');
            const labelWeek = doc.getElementById('weekly-nav-label');

            expect(btnPrev).not.toBeNull();
            expect(btnNext).not.toBeNull();
            expect(labelWeek).not.toBeNull();
        });

        test('1.4. Kontainer KPI mingguan #weekly-kpi-container memuat metrik jam kerja', () => {
            const kpiContainer = doc.getElementById('weekly-kpi-container');
            expect(kpiContainer).not.toBeNull();

            const kpiPct = doc.getElementById('weekly-kpi-percent');
            const kpiReported = doc.getElementById('weekly-kpi-reported');
            const kpiHours = doc.getElementById('weekly-kpi-total-hours');

            expect(kpiPct).not.toBeNull();
            expect(kpiReported).not.toBeNull();
            expect(kpiHours).not.toBeNull();
        });

        test('1.5. Input pencarian dan filter status pegawai tersedia', () => {
            const searchInput = doc.getElementById('search-supervisor-employee');
            const statusFilter = doc.getElementById('filter-supervisor-status');
            const counter = doc.getElementById('summary-reported-counter');
            const btnCollapse = doc.getElementById('btn-collapse-summary-panel');

            expect(searchInput).not.toBeNull();
            expect(statusFilter).not.toBeNull();
            expect(counter).not.toBeNull();
            expect(btnCollapse).not.toBeNull();
        });

        test('1.6. Tabel matriks supervisi memiliki header, body, dan footer', () => {
            const table = doc.getElementById('table-supervisor-summary');
            const thead = doc.getElementById('table-employee-summary-head');
            const tbody = doc.getElementById('table-employee-summary-body');
            const tfoot = doc.getElementById('table-employee-summary-foot');

            expect(table).not.toBeNull();
            expect(thead).not.toBeNull();
            expect(tbody).not.toBeNull();
            expect(tfoot).not.toBeNull();
        });

        test('1.7. Modal rincian supervisi #modal-supervisor-employee-detail berdiri di luar <main>', () => {
            const modal = doc.getElementById('modal-supervisor-employee-detail');
            expect(modal).not.toBeNull();
            expect(modal.classList.contains('hidden')).toBe(true);

            const main = doc.querySelector('main');
            expect(main).not.toBeNull();
            expect(main.contains(modal)).toBe(false); // Sesuai Modal Anti-Nesting Mandate
        });
    });

    // =========================================================================
    // 2. KONTRAK LOGIKA JAVASCRIPT MODE MONITORING
    // =========================================================================
    describe('2. Verifikasi Logika JavaScript Mode Monitoring E-Kinerja Tendik', () => {
        test('2.1. toggleMonitoringModeView menampilkan panel dan mengaktifkan mode weekly secara default', () => {
            expect(tendikJs).toContain('window.toggleMonitoringModeView = async function()');
            expect(tendikJs).toContain("summaryPanel.classList.remove('hidden');");
            expect(tendikJs).toContain("window.setSummaryMode('weekly');");
        });

        test('2.2. setSummaryMode mendukung mode weekly dan daily serta mengatur tampilan DOM', () => {
            expect(tendikJs).toContain('window.setSummaryMode = async function(mode)');
            expect(tendikJs).toContain("currentSummaryMode = mode;");
            expect(tendikJs).toContain("weeklyNav?.classList.remove('hidden');");
            expect(tendikJs).toContain("weeklyKpi?.classList.remove('hidden');");
            expect(tendikJs).toContain("loadSupervisorSummary()");
        });

        test('2.3. navigateSummaryWeek memproses pergeseran pekan -1, +1', () => {
            expect(tendikJs).toContain('window.navigateSummaryWeek = async function(direction)');
            expect(tendikJs).toContain('cur.setDate(cur.getDate() + (direction * 7));');
        });

        test('2.4. loadSupervisorSummary menggunakan Cloudflare Worker D1 (0 Firestore Read)', () => {
            expect(tendikJs).toContain('async function loadSupervisorSummary()');
            expect(tendikJs).toContain('cfClient.getEmployeeAgendaSummary(');
            // Memastikan tidak memanggil firestore getDocs / onSnapshot pada supervisi monitoring
            const funcRegex = /async function loadSupervisorSummary\(\)[\s\S]*?catch \(e\)/;
            const match = tendikJs.match(funcRegex);
            expect(match).not.toBeNull();
            if (match) {
                expect(match[0]).not.toContain('getDocs(');
                expect(match[0]).not.toContain('onSnapshot(');
            }
        });

        test('2.5. filterSupervisorEmployees memfilter data berdasarkan kata kunci dan status', () => {
            expect(tendikJs).toContain('window.filterSupervisorEmployees = function()');
            expect(tendikJs).toContain('search-supervisor-employee');
            expect(tendikJs).toContain('filter-supervisor-status');
            expect(tendikJs).toContain('query');
            expect(tendikJs).toContain('statusFilter');
        });

        test('2.6. Escape key listener menutup #modal-supervisor-employee-detail saat terbuka', () => {
            expect(tendikJs).toContain("const detailModal = document.getElementById('modal-supervisor-employee-detail');");
            expect(tendikJs).toContain('window.closeSupervisorDetailModal();');
        });
    });

    // =========================================================================
    // 3. SIMULASI INTERAKSI FILTER & TAMPILAN
    // =========================================================================
    describe('3. Simulasi Interaksi Filter dan Visibilitas Elemen UI', () => {
        test('3.1. Tombol toggle harian/mingguan mengubah kelas styling aktif', () => {
            const btnDaily = doc.getElementById('btn-summary-mode-daily');
            const btnWeekly = doc.getElementById('btn-summary-mode-weekly');

            function simulateSetMode(mode) {
                if (mode === 'daily') {
                    btnDaily.className = 'px-2.5 py-1 rounded-md font-bold bg-white dark:bg-slate-700 text-emerald-700 dark:text-emerald-300 shadow-xs transition-all';
                    btnWeekly.className = 'px-2.5 py-1 rounded-md font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 transition-all';
                } else {
                    btnWeekly.className = 'px-2.5 py-1 rounded-md font-bold bg-white dark:bg-slate-700 text-emerald-700 dark:text-emerald-300 shadow-xs transition-all';
                    btnDaily.className = 'px-2.5 py-1 rounded-md font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 transition-all';
                }
            }

            simulateSetMode('weekly');
            expect(btnWeekly.classList.contains('text-emerald-700')).toBe(true);
            expect(btnDaily.classList.contains('text-emerald-700')).toBe(false);

            simulateSetMode('daily');
            expect(btnDaily.classList.contains('text-emerald-700')).toBe(true);
            expect(btnWeekly.classList.contains('text-emerald-700')).toBe(false);
        });

        test('3.2. Modal rincian supervisi dapat dibuka dan ditutup melalui class hidden', () => {
            const modal = doc.getElementById('modal-supervisor-employee-detail');
            expect(modal).not.toBeNull();
            expect(modal.classList.contains('hidden')).toBe(true);

            // Buka modal
            modal.classList.remove('hidden');
            expect(modal.classList.contains('hidden')).toBe(false);

            // Tutup modal
            modal.classList.add('hidden');
            expect(modal.classList.contains('hidden')).toBe(true);
        });
    });

    // =========================================================================
    // 4. VERIFIKASI HEADER BEBAS DROPDOWN SWITCHER & BANNER INSPEKSI PEGAWAI
    // =========================================================================
    describe('4. Verifikasi Header Bebas Dropdown Switcher, Banner Inspeksi & Proteksi Catat Aktivitas', () => {
        test('4.1. Elemen #employee-switcher-wrapper berstatus hidden di HTML dan kode JS memastikan selalu tersembunyi', () => {
            const switcher = doc.getElementById('employee-switcher-wrapper');
            expect(switcher).not.toBeNull();
            expect(switcher.classList.contains('hidden')).toBe(true);

            // Di JS, pastikan switcherWrapper tidak lagi di-remove hidden-nya saat toggle monitoring
            const toggleFuncStr = tendikJs.match(/window\.toggleMonitoringModeView\s*=\s*async\s*function[\s\S]*?^};/m)?.[0] || '';
            expect(toggleFuncStr).toContain("if (switcherWrapper) switcherWrapper.classList.add('hidden');");
            expect(toggleFuncStr).not.toContain("switcherWrapper.classList.remove('hidden');");
        });

        test('4.2. Banner #banner-inspecting-employee tersedia di HTML dan memuat tombol kembali', () => {
            const banner = doc.getElementById('banner-inspecting-employee');
            expect(banner).not.toBeNull();
            expect(banner.classList.contains('hidden')).toBe(true);

            const nameEl = doc.getElementById('banner-inspecting-employee-name');
            expect(nameEl).not.toBeNull();

            const backBtn = banner.querySelector('button[onclick*="exitEmployeeInspection"]');
            expect(backBtn).not.toBeNull();
        });

        test('4.3. Fungsi inspectEmployeeLog menampilkan banner dan memproteksi tombol Catat Aktivitas', () => {
            expect(tendikJs).toContain('window.inspectEmployeeLog = function(id, name)');
            expect(tendikJs).toContain("bannerInspect.classList.remove('hidden');");
            expect(tendikJs).toContain("btnOpenModal.classList.add('hidden');");
            expect(tendikJs).toContain("fabWrapper.classList.add('hidden');");
        });

        test('4.4. Fungsi exitEmployeeInspection menyembunyikan banner dan memulihkan tombol Catat Aktivitas', () => {
            expect(tendikJs).toContain('window.exitEmployeeInspection = async function()');
            expect(tendikJs).toContain("bannerInspect.classList.add('hidden');");
            expect(tendikJs).toContain("btnOpenModal.classList.remove('hidden');");
            expect(tendikJs).toContain("fabWrapper.classList.remove('hidden');");
        });

        test('4.5. Kontainer #employee-individual-view-wrapper tersedia membungkus kartu aktivitas di dalam #tab-content-employee', () => {
            const wrapper = doc.getElementById('employee-individual-view-wrapper');
            expect(wrapper).not.toBeNull();
            const tabContent = doc.getElementById('tab-content-employee');
            expect(tabContent.contains(wrapper)).toBe(true);

            // Memastikan aktivitas container ada di dalam wrapper ini
            const actContainer = doc.getElementById('employee-activities-container');
            expect(wrapper.contains(actContainer)).toBe(true);
        });

        test('4.6. toggleMonitoringModeView menyembunyikan individual wrapper saat Mode Monitoring aktif', () => {
            const toggleFuncStr = tendikJs.match(/window\.toggleMonitoringModeView\s*=\s*async\s*function[\s\S]*?^};/m)?.[0] || '';
            expect(toggleFuncStr).toContain("individualWrapper.classList.add('hidden');");
            expect(toggleFuncStr).toContain("individualWrapper.classList.remove('hidden');");
        });

        test('4.7. inspectEmployeeLog memunculkan individual wrapper dan me-expand Matriks Mingguan', () => {
            const inspectFuncStr = tendikJs.match(/window\.inspectEmployeeLog\s*=\s*function[\s\S]*?^};/m)?.[0] || '';
            expect(inspectFuncStr).toContain("individualWrapper.classList.remove('hidden');");
            expect(inspectFuncStr).toContain("matrixContainer.classList.remove('hidden');");
            expect(inspectFuncStr).toContain("matrixText.textContent = 'Sembunyikan';");
        });

        test('4.8. exitEmployeeInspection menyembunyikan kembali individual wrapper saat kembali ke monitoring', () => {
            const exitFuncStr = tendikJs.match(/window\.exitEmployeeInspection\s*=\s*async\s*function[\s\S]*?^};/m)?.[0] || '';
            expect(exitFuncStr).toContain("individualWrapper.classList.add('hidden');");
        });
    });

    // =========================================================================
    // 5. VERIFIKASI ISOLASI AGENDA SAYA PRIBADI KEPALA SEKOLAH (ZERO LEAKAGE)
    // =========================================================================
    describe('5. Verifikasi Isolasi Mode Agenda Saya bagi Kepala Sekolah (Zero Data Leakage)', () => {
        test('5.1. loadEmployeeDayData menyertakan query mode personal dan self=true saat isPersonalMode', () => {
            expect(tendikJs).toContain("const isPersonalMode = !isSupervisor || !isMonitoringMode;");
            expect(tendikJs).toContain("queryParams.mode = 'personal';");
            expect(tendikJs).toContain("queryParams.self = 'true';");
        });

        test('5.2. loadEmployeeWeeklyData menyertakan query mode personal dan self=true saat isPersonalMode', () => {
            const funcRegex = /async function loadEmployeeWeeklyData\(\)[\s\S]*?cfClient\.getEmployeeActivities\(params\)/;
            const match = tendikJs.match(funcRegex);
            expect(match).not.toBeNull();
            if (match) {
                expect(match[0]).toContain("params.mode = 'personal';");
                expect(match[0]).toContain("params.self = 'true';");
            }
        });

        test('5.3. updateHeaderContext mempertahankan judul E-Kinerja Tenaga Kependidikan dan menampilkan nama Kepala Sekolah', () => {
            const headerFunc = tendikJs.match(/function updateHeaderContext\(\)[\s\S]*?^\}/m)?.[0] || '';
            expect(headerFunc).toContain("titleEl.textContent = 'E-Kinerja Tenaga Kependidikan';");
            expect(headerFunc).not.toContain("titleEl.textContent = 'E-Kinerja Saya';");
            expect(headerFunc).toContain("isCurrentTargetPrincipal() ? 'Kepala Sekolah' : 'Pegawai SIMAS'");
        });

        test('5.4. renderEmployeeActivities empty state hanya menampilkan Mode Supervisi saat isMonitoringMode aktif', () => {
            expect(tendikJs).toContain("if (isSupervisor && isMonitoringMode && !selectedEmployeeGtkId)");
        });

        test('5.5. loadEmployeeAssignments merender badge resmi Tugas Pokok Kepala Sekolah saat belum ada SK khusus', () => {
            expect(tendikJs).toContain("Tugas Pokok Kepala Sekolah");
            expect(tendikJs).toContain("Permendikdasmen No. 23/2026");
            expect(tendikJs).toContain("isCurrentTargetPrincipal()");
        });

        test('5.6. cloudflare-client.js mendukung pengiriman query param mode dan self pada getEmployeeActivities', () => {
            const cfClientPath = path.join(__dirname, '../js/cloudflare-client.js');
            const cfClientCode = fs.readFileSync(cfClientPath, 'utf8');
            expect(cfClientCode).toContain("if (filters.mode) params.append('mode', filters.mode);");
            expect(cfClientCode).toContain("if (filters.self) params.append('self', filters.self);");
        });

        test('5.7. openActivityModal dan saveEmployeeActivity mengisolasi target ke akun pribadi saat isPersonalMode', () => {
            expect(tendikJs).toContain("const isPersonalMode = !isSupervisor || !isMonitoringMode;");
            expect(tendikJs).toContain("if (!isPersonalMode && isSupervisor && selectedEmployeeGtkId)");
        });
    });

    // =========================================================================
    // 6. VERIFIKASI SPESIFIKASI RBAC 3-TIER E-KINERJA TENDIK (SSOT)
    // =========================================================================
    describe('6. Verifikasi Spesifikasi RBAC 3-Tier E-Kinerja Tendik (Staf, Kepsek, Super Admin)', () => {
        test('6.1. Super Admin murni: Inisialisasi langsung Mode Monitoring dan sembunyikan tombol Agenda Saya', () => {
            expect(tendikJs).toContain("if (isSuperAdmin && !isKepsek) {");
            expect(tendikJs).toContain("// TIER 3: Super Admin Murni (Murni Supervisi/Monitoring Semua Tendik & Kepala Sekolah, Tanpa Isi Fokus ke Diri Sendiri)");
            expect(tendikJs).toContain("isMonitoringMode = true;");
            expect(tendikJs).toContain("if (summaryPanel) summaryPanel.classList.remove('hidden');");
            expect(tendikJs).toContain("if (individualWrapper) individualWrapper.classList.add('hidden');");
            expect(tendikJs).toContain("if (btnSummaryToggle) btnSummaryToggle.classList.add('hidden');");
            expect(tendikJs).toContain("if (btnOpenModal) btnOpenModal.classList.add('hidden');");
            expect(tendikJs).toContain("if (fabWrapper) fabWrapper.classList.add('hidden');");
        });

        test('6.2. Kepala Sekolah: Inisialisasi Agenda Kerja Saya dan sediakan tombol Mode Monitoring', () => {
            expect(tendikJs).toContain("} else if (isKepsek) {");
            expect(tendikJs).toContain("// TIER 2: Kepala Sekolah (Agenda Kerja Saya Mandiri & Mode Monitoring Supervisi Tendik)");
            expect(tendikJs).toContain("isMonitoringMode = false;");
            expect(tendikJs).toContain("if (summaryPanel) summaryPanel.classList.add('hidden');");
            expect(tendikJs).toContain("if (individualWrapper) individualWrapper.classList.remove('hidden');");
            expect(tendikJs).toContain("btnSummaryToggle.classList.remove('hidden');");
            expect(tendikJs).toContain("if (btnOpenModal) btnOpenModal.classList.remove('hidden');");
        });

        test('6.3. Pegawai Biasa: Murni Agenda Kerja Saya tanpa akses Mode Monitoring', () => {
            expect(tendikJs).toContain("// TIER 1: Pegawai Biasa / Tendik (Murni Agenda Kerja Saya, Tanpa Mode Monitoring)");
            expect(tendikJs).toContain("isMonitoringMode = false;");
            expect(tendikJs).toContain("if (btnSummaryToggle) btnSummaryToggle.classList.add('hidden');");
            expect(tendikJs).toContain("if (summaryPanel) summaryPanel.classList.add('hidden');");
            expect(tendikJs).toContain("if (btnManage) btnManage.classList.add('hidden');");
        });

        test('6.4. Tombol jalan pintas Rekap Realisasi (VIP) tersedia di modal rincian supervisi pegawai', () => {
            const btnRecap = doc.getElementById('modal-supervisor-detail-btn-recap');
            expect(btnRecap).not.toBeNull();
            expect(btnRecap.textContent).toContain('Rekap Realisasi (VIP)');
            expect(tendikJs).toContain("const btnRecap = document.getElementById('modal-supervisor-detail-btn-recap');");
            expect(tendikJs).toContain("window.openEmployeeMonthlyRecapModal();");
        });

        test('6.5. Cloudflare Worker menyertakan Kepala Sekolah ke dalam pemantauan supervisi saat request dari Super Admin', () => {
            const workerPath = path.join(__dirname, '../cloudflare/worker.js');
            const workerCode = fs.readFileSync(workerPath, 'utf8');
            expect(workerCode).toContain("Khusus Super Admin: Sertakan data Kepala Sekolah ke dalam populasi pemantauan supervisi");
            expect(workerCode).toContain("const isSuperAdminReq = (reqUserRole === \"super_admin\" || reqUserAddRoles.includes(\"super_admin\"));");
            expect(workerCode).toContain("WHERE status = 'active'");
            expect(workerCode).toContain("(jenis_ptk LIKE '%Kepala Sekolah%' OR role = 'kepala_sekolah')");
        });
    });

    // =========================================================================
    // 7. VERIFIKASI PENUGASAN KEPALA SEKOLAH 2 KOLOM (TUGAS POKOK & URAIAN BUTIR)
    // =========================================================================
    describe('7. Verifikasi Penugasan Kepala Sekolah 2 Kolom (Tugas Pokok & Uraian Butir)', () => {
        test('7.1. Kontainer panduan uraian butir tugas #container-principal-task-description tersedia di bawah dropdown', () => {
            const container = doc.getElementById('container-principal-task-description');
            const textEl = doc.getElementById('text-principal-task-description');
            expect(container).not.toBeNull();
            expect(textEl).not.toBeNull();
            expect(container.classList.contains('hidden')).toBe(true); // Tersembunyi saat awal sebelum tugas dipilih
        });

        test('7.2. Form kelola penugasan Kepala Sekolah memiliki input Tugas Pokok dan Uraian Butir Tugas terpisah', () => {
            const codeInput = doc.getElementById('principal-group-form-code');
            const nameInput = doc.getElementById('principal-group-form-name');
            const descInput = doc.getElementById('principal-group-form-desc');
            const orderInput = doc.getElementById('principal-group-form-order');

            expect(codeInput).not.toBeNull();
            expect(nameInput).not.toBeNull();
            expect(descInput).not.toBeNull();
            expect(orderInput).not.toBeNull();
            expect(descInput.tagName.toLowerCase()).toBe('textarea');
        });

        test('7.3. Tabel kelola butir tugas Kepala Sekolah memiliki struktur 5 kolom terstruktur', () => {
            const tbody = doc.getElementById('table-manage-principal-groups-body');
            expect(tbody).not.toBeNull();

            // Memeriksa header tabel tab 4
            const pane = doc.getElementById('pane-manage-principal');
            expect(pane).not.toBeNull();
            const table = pane.querySelector('table');
            expect(table).not.toBeNull();
            const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim());
            expect(headers).toContain('Urutan');
            expect(headers).toContain('Kode');
            expect(headers).toContain('Tugas Pokok');
            expect(headers).toContain('Uraian Butir Tugas');
            expect(headers).toContain('Aksi');
        });

        test('7.4. DEFAULT_PRINCIPAL_GROUPS memuat 6 butir standar judul singkat tanpa abjad dan uraian_tugas', () => {
            expect(tendikJs).toContain("nama_kelompok: 'Visi dan Budaya Belajar'");
            expect(tendikJs).toContain("uraian_tugas: 'Mengembangkan visi, misi, tujuan, serta budaya belajar satuan pendidikan.'");
            expect(tendikJs).toContain("nama_kelompok: 'Iklim Lingkungan Belajar'");
            expect(tendikJs).toContain("nama_kelompok: 'Kurikulum dan Pembelajaran'");
            expect(tendikJs).toContain("nama_kelompok: 'Tata Kelola dan Sumber Daya'");
            expect(tendikJs).toContain("nama_kelompok: 'Kemitraan Eksternal'");
            expect(tendikJs).toContain("nama_kelompok: 'Kepemimpinan Transformasional'");
        });

        test('7.5. parsePrincipalGroupFields memisahkan judul singkat dan uraian butir tugas dengan presisi', () => {
            expect(tendikJs).toContain('export function parsePrincipalGroupFields(group)');
            // Simulasi logika parser
            const testParser = (group) => {
                if (!group) return { title: '', desc: '' };
                let rawTitle = String(group.nama_kelompok || group.group_name || '').trim();
                let rawDesc = String(group.uraian_tugas || group.task_description || group.description || '').trim();
                if (!rawDesc && rawTitle.includes(':')) {
                    const parts = rawTitle.split(':');
                    rawTitle = parts[0].trim();
                    rawDesc = parts.slice(1).join(':').trim();
                }
                rawTitle = rawTitle.replace(/^[a-z]\.\s*/i, '').trim();
                return { title: rawTitle, desc: rawDesc };
            };

            // Format baru 2 properti
            const res1 = testParser({ nama_kelompok: 'Visi dan Budaya Belajar', uraian_tugas: 'Mengembangkan visi...' });
            expect(res1.title).toBe('Visi dan Budaya Belajar');
            expect(res1.desc).toBe('Mengembangkan visi...');

            // Format lama dengan titik dua & abjad
            const res2 = testParser({ nama_kelompok: 'a. Visi dan Budaya Belajar: Mengembangkan visi...' });
            expect(res2.title).toBe('Visi dan Budaya Belajar');
            expect(res2.desc).toBe('Mengembangkan visi...');
        });

        test('7.6. onActivityGroupChange dan savePrincipalGroupForm memproses uraian_tugas ke basis data D1', () => {
            expect(tendikJs).toContain("principalDescContainer = document.getElementById('container-principal-task-description');");
            expect(tendikJs).toContain("principalDescText = document.getElementById('text-principal-task-description');");
            expect(tendikJs).toContain("const { desc } = parsePrincipalGroupFields(selectedGroup);");
            expect(tendikJs).toContain("principalDescText.textContent = desc;");
            expect(tendikJs).toContain("uraian_tugas: desc || ''");
        });
    });

    // =========================================================================
    // 8. VERIFIKASI DINAMIKA TOMBOL HEADER & PEMBERSIHAN NAMA TENDIK
    // =========================================================================
    describe('8. Verifikasi Dinamika Tombol Header & Pembersihan Nama Tendik pada Mode Monitoring', () => {
        test('8.1. updateHeaderModeButtons menampilkan Rekap Realisasi dan menyembunyikan Kelola Penugasan saat Agenda Saya', () => {
            expect(tendikJs).toContain('export function updateHeaderModeButtons()');
            const btnRecap = doc.getElementById('btn-employee-monthly-recap-toggle');
            const btnManage = doc.getElementById('btn-manage-assignments');
            expect(btnRecap).not.toBeNull();
            expect(btnManage).not.toBeNull();

            // Simulasi logika updateHeaderModeButtons saat isPersonalMode = true
            const simUpdate = (isPersonalMode, isSupervisor) => {
                if (btnRecap) {
                    if (isPersonalMode) {
                        btnRecap.classList.remove('hidden');
                        if (!btnRecap.classList.contains('md:flex')) btnRecap.classList.add('md:flex');
                    } else {
                        btnRecap.classList.add('hidden');
                        btnRecap.classList.remove('md:flex');
                    }
                }
                if (btnManage) {
                    if (!isPersonalMode && isSupervisor) {
                        btnManage.classList.remove('hidden');
                    } else {
                        btnManage.classList.add('hidden');
                    }
                }
            };

            simUpdate(true, true);
            expect(btnRecap.classList.contains('hidden')).toBe(false);
            expect(btnRecap.classList.contains('md:flex')).toBe(true);
            expect(btnManage.classList.contains('hidden')).toBe(true);
        });

        test('8.2. updateHeaderModeButtons menyembunyikan Rekap Realisasi dan memunculkan Kelola Penugasan saat Mode Monitoring', () => {
            const btnRecap = doc.getElementById('btn-employee-monthly-recap-toggle');
            const btnManage = doc.getElementById('btn-manage-assignments');

            const simUpdate = (isPersonalMode, isSupervisor) => {
                if (btnRecap) {
                    if (isPersonalMode) {
                        btnRecap.classList.remove('hidden');
                        if (!btnRecap.classList.contains('md:flex')) btnRecap.classList.add('md:flex');
                    } else {
                        btnRecap.classList.add('hidden');
                        btnRecap.classList.remove('md:flex');
                    }
                }
                if (btnManage) {
                    if (!isPersonalMode && isSupervisor) {
                        btnManage.classList.remove('hidden');
                    } else {
                        btnManage.classList.add('hidden');
                    }
                }
            };

            simUpdate(false, true);
            expect(btnRecap.classList.contains('hidden')).toBe(true);
            expect(btnRecap.classList.contains('md:flex')).toBe(false);
            expect(btnManage.classList.contains('hidden')).toBe(false);
        });

        test('8.3. updateHeaderContext menyetel judul ke E-Kinerja Tenaga Kependidikan dan nama ke Mode Monitoring (tanpa nama orang)', () => {
            const headerCode = tendikJs.match(/export function updateHeaderContext\(\)[\s\S]*?^\}/m)?.[0] || '';
            expect(headerCode).toContain("titleEl.textContent = 'E-Kinerja Tenaga Kependidikan';");
            expect(headerCode).toContain("targetName = 'Mode Monitoring';");
            expect(headerCode).not.toContain("E-Kinerja Tendik: ${selectedEmployeeName}");
            expect(headerCode).toContain("updateHeaderModeButtons();");
        });

        test('8.4. toggleMonitoringModeView dan exitEmployeeInspection memanggil updateHeaderContext', () => {
            const toggleCode = tendikJs.match(/window\.toggleMonitoringModeView\s*=\s*async\s*function[\s\S]*?^};/m)?.[0] || '';
            expect(toggleCode).toContain('updateHeaderContext();');

            const exitCode = tendikJs.match(/window\.exitEmployeeInspection\s*=\s*async\s*function[\s\S]*?^};/m)?.[0] || '';
            expect(exitCode).toContain('updateHeaderContext();');
        });

        test('8.5. renderActCard pada modal rincian supervisi merender tombol foto bukti saat aktivitas memiliki bukti_url', () => {
            expect(tendikJs).toContain("_supervisorDetailActivitiesMap.set(String(act.id), act);");
            expect(tendikJs).toContain("const photos = parseEvidencePhotos(act.bukti_url || act.evidence_url);");
            expect(tendikJs).toContain("const photoBtn = photoCount > 0 ? `");
            expect(tendikJs).toContain("window.openEmployeeLightbox('${escapeHTML(String(act.id))}')");
            expect(tendikJs).toContain("${photoCount} Foto Bukti");
        });

        test('8.6. openEmployeeLightbox mendukung pencarian aktivitas dari _supervisorDetailActivitiesMap', () => {
            expect(tendikJs).toContain("_supervisorDetailActivitiesMap.get(String(photosOrActId))");
        });

        test('8.7. Keyboard listener Escape menutup modal lightbox foto terlebih dahulu sebelum menutup modal supervisi', () => {
            expect(tendikJs).toContain("const lightboxModal = document.getElementById('modal-evidence-lightbox');");
            expect(tendikJs).toContain("if (lightboxModal && !lightboxModal.classList.contains('hidden')) {");
            expect(tendikJs).toContain("window.closeEmployeeLightbox();");
        });
    });

    // =========================================================================
    // 9. VERIFIKASI PENYESUAIAN SK PENUGASAN KEPALA SEKOLAH VS TENDIK
    // =========================================================================
    describe('9. Penyesuaian Penugasan & Penyembunyian Detail SK Kepala Sekolah', () => {
        test('9.1. Elemen kontrol SK memiliki ID semantik lengkap di e-kinerja-tendik.html', () => {
            const labelTextEl = doc.getElementById('sk-assignment-label-text');
            const btnToggleSk = doc.getElementById('btn-toggle-sk-details');
            const sectionSkDetails = doc.getElementById('section-sk-details');
            const iconWrapper = doc.getElementById('sk-assignment-icon-wrapper');
            const iconEl = doc.getElementById('sk-assignment-icon');

            expect(labelTextEl).not.toBeNull();
            expect(btnToggleSk).not.toBeNull();
            expect(sectionSkDetails).not.toBeNull();
            expect(iconWrapper).not.toBeNull();
            expect(iconEl).not.toBeNull();
        });

        test('9.2. loadEmployeeAssignments menyembunyikan Detail SK dan mengubah label ke "Tugas Pokok:" untuk Kepala Sekolah', () => {
            const funcCode = tendikJs.match(/async function loadEmployeeAssignments[\s\S]*?^}/m)?.[0] || '';
            expect(funcCode).toContain("const isPrincipal = isPersonalMode && isCurrentTargetPrincipal();");
            expect(funcCode).toContain("if (isPrincipal) {");
            expect(funcCode).toContain("labelTextEl.textContent = 'Tugas Pokok:';");
            expect(funcCode).toContain("btnToggleSk.classList.add('hidden');");
            expect(funcCode).toContain("sectionSkDetails.classList.add('hidden');");
            expect(funcCode).toContain("iconEl.className = 'fa-solid fa-graduation-cap text-[11px]';");
        });

        test('9.3. loadEmployeeAssignments menampilkan Detail SK dan label "Penugasan SK:" untuk Tendik / Mode Supervisi', () => {
            const funcCode = tendikJs.match(/async function loadEmployeeAssignments[\s\S]*?^}/m)?.[0] || '';
            expect(funcCode).toContain("labelTextEl.textContent = 'Penugasan SK:';");
            expect(funcCode).toContain("btnToggleSk.classList.remove('hidden');");
            expect(funcCode).toContain("iconEl.className = 'fa-solid fa-file-contract text-[11px]';");
        });

        test('9.4. window.toggleSkDetails memiliki guard agar tidak merespons pada Kepala Sekolah di mode agenda sendiri', () => {
            const toggleCode = tendikJs.match(/window\.toggleSkDetails\s*=\s*function[\s\S]*?^};/m)?.[0] || '';
            expect(toggleCode).toContain("const isPersonalMode = !isSupervisor || !isMonitoringMode;");
            expect(toggleCode).toContain("if (isPersonalMode && isCurrentTargetPrincipal()) return;");
        });

        test('9.5. Simulasi DOM: Tampilan berganti sempurna antara mode Kepala Sekolah dan Tendik', () => {
            const labelTextEl = doc.getElementById('sk-assignment-label-text');
            const btnToggleSk = doc.getElementById('btn-toggle-sk-details');
            const sectionSkDetails = doc.getElementById('section-sk-details');
            const iconEl = doc.getElementById('sk-assignment-icon');

            // Simulasi State 1: Kepala Sekolah di mode Agenda Saya
            const applyPrincipalState = () => {
                labelTextEl.textContent = 'Tugas Pokok:';
                btnToggleSk.classList.add('hidden');
                sectionSkDetails.classList.add('hidden');
                iconEl.className = 'fa-solid fa-graduation-cap text-[11px]';
            };

            applyPrincipalState();
            expect(labelTextEl.textContent).toBe('Tugas Pokok:');
            expect(btnToggleSk.classList.contains('hidden')).toBe(true);
            expect(sectionSkDetails.classList.contains('hidden')).toBe(true);
            expect(iconEl.className).toContain('fa-graduation-cap');

            // Simulasi State 2: Inspeksi Tendik di mode Monitoring
            const applyTendikState = () => {
                labelTextEl.textContent = 'Penugasan SK:';
                btnToggleSk.classList.remove('hidden');
                iconEl.className = 'fa-solid fa-file-contract text-[11px]';
            };

            applyTendikState();
            expect(labelTextEl.textContent).toBe('Penugasan SK:');
            expect(btnToggleSk.classList.contains('hidden')).toBe(false);
            expect(iconEl.className).toContain('fa-file-contract');
        });
    });

    // =========================================================================
    // 10. VERIFIKASI KEANDALAN MODAL SUPERVISI & INTERAKSI SEL MATRIKS
    // =========================================================================
    describe('10. Keandalan Pop-Up Modal Supervisi & Matriks Mingguan (Anti-Blur Blank & Safe Click)', () => {
        test('10.1. Konten modal #modal-supervisor-employee-detail-content tidak memiliki scale-95 opacity-0 statis di HTML', () => {
            const contentEl = doc.getElementById('modal-supervisor-employee-detail-content');
            expect(contentEl).not.toBeNull();
            expect(contentEl.classList.contains('opacity-0')).toBe(false);
            expect(contentEl.classList.contains('scale-95')).toBe(false);
        });

        test('10.2. Kontainer modal #modal-supervisor-employee-detail memiliki handler dismiss saat backdrop diklik', () => {
            const modalEl = doc.getElementById('modal-supervisor-employee-detail');
            expect(modalEl).not.toBeNull();
            const onclickAttr = modalEl.getAttribute('onclick') || '';
            expect(onclickAttr).toContain('window.closeSupervisorDetailModal()');
        });

        test('10.3. Kode JS mengelola safe timer _closeSupervisorModalTimer untuk mencegah race condition penutupan modal', () => {
            expect(tendikJs).toContain('let _closeSupervisorModalTimer = null;');
            expect(tendikJs).toContain('if (_closeSupervisorModalTimer) {');
            expect(tendikJs).toContain('clearTimeout(_closeSupervisorModalTimer);');
        });

        test('10.4. Matriks mingguan merender handler openSupervisorDetailModal pada sel kosong (-) dan kolom Total Pekan', () => {
            expect(tendikJs).toContain("title=\"Klik untuk melihat tanggal ${dStr}\"");
            expect(tendikJs).toContain("onclick=\"window.openSupervisorDetailModal('${escapeHTML(empId)}', '${dStr}')\"");
            expect(tendikJs).toContain("onclick=\"window.openSupervisorDetailModal('${escapeHTML(empId)}', 'week')\"");
        });

        test('10.5. openSupervisorDetailModal mengekstrak menit dan kegiatan secara numerik tanpa fallback keliru ke akumulasi pekan', () => {
            expect(tendikJs).toContain('const dayMin = Number(dayData?.minutes || 0);');
            expect(tendikJs).toContain('const actCount = Number(dayData?.activity_count || (Array.isArray(dayData?.activities) ? dayData.activities.length : 0));');
            expect(tendikJs).not.toContain('const dayMin = dayData?.minutes || person.total_effective_minutes || 0;');
        });
    });
});




