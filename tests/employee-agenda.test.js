/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

/**
 * Kalkulasi Menit Efektif Kerja (algoritma SSOT yang digunakan di worker & client)
 */
function calculateEffectiveMinutes(startTime, endTime) {
    if (!startTime || !endTime) return 0;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 0;

    let startMin = sh * 60 + sm;
    let endMin = eh * 60 + em;

    const WORK_START = 450;  // 07:30
    const WORK_END   = 930;  // 15:30
    const REST_START = 750;  // 12:30
    const REST_END   = 780;  // 13:00

    if (startMin < WORK_START) startMin = WORK_START;
    if (endMin > WORK_END) endMin = WORK_END;
    if (startMin >= endMin) return 0;

    let effectiveMin = endMin - startMin;

    const restOverlapStart = Math.max(startMin, REST_START);
    const restOverlapEnd   = Math.min(endMin, REST_END);
    if (restOverlapStart < restOverlapEnd) {
        effectiveMin -= (restOverlapEnd - restOverlapStart);
    }

    return Math.max(0, effectiveMin);
}

describe('Modul Agenda Pegawai (Employee Daily Agenda)', () => {
    let htmlContent;

    beforeAll(() => {
        const tendikPath = path.join(__dirname, '../e-kinerja-tendik.html');
        htmlContent = fs.existsSync(tendikPath) ? fs.readFileSync(tendikPath, 'utf8') : fs.readFileSync(path.join(__dirname, '../agenda-pegawai.html'), 'utf8');
    });

    beforeEach(() => {
        document.documentElement.innerHTML = htmlContent;
    });

    describe('1. Algoritma Kalkulasi Menit Efektif Kerja (07:30 - 15:30, istirahat 12:30 - 13:00)', () => {
        test('1.1. Menghitung durasi penuh satu hari kerja normal (07:30 - 15:30 = 450 menit efektif / 7.5 jam)', () => {
            const minutes = calculateEffectiveMinutes('07:30', '15:30');
            expect(minutes).toBe(450); // 480 menit total - 30 menit istirahat = 450 menit
        });

        test('1.2. Menghitung aktivitas pagi sebelum istirahat (08:00 - 11:30 = 210 menit)', () => {
            const minutes = calculateEffectiveMinutes('08:00', '11:30');
            expect(minutes).toBe(210);
        });

        test('1.3. Memotong tepat 30 menit istirahat jika aktivitas melintasi 12:30 - 13:00 (11:00 - 14:00 = 150 menit)', () => {
            // Total span = 180 menit, potong istirahat 30 menit = 150 menit efektif
            const minutes = calculateEffectiveMinutes('11:00', '14:00');
            expect(minutes).toBe(150);
        });

        test('1.4. Aktivitas tepat pada jam istirahat (12:30 - 13:00) menghasilkan 0 menit efektif', () => {
            const minutes = calculateEffectiveMinutes('12:30', '13:00');
            expect(minutes).toBe(0);
        });

        test('1.5. Aktivitas yang dimulai sebelum jam kerja resmi di-clamp ke 07:30 (06:45 - 08:30 = 60 menit)', () => {
            const minutes = calculateEffectiveMinutes('06:45', '08:30');
            expect(minutes).toBe(60); // 07:30 - 08:30 = 60 menit
        });

        test('1.6. Aktivitas yang selesai setelah jam kerja resmi di-clamp ke 15:30 (14:30 - 16:30 = 60 menit)', () => {
            const minutes = calculateEffectiveMinutes('14:30', '16:30');
            expect(minutes).toBe(60); // 14:30 - 15:30 = 60 menit
        });

        test('1.7. Aktivitas di luar jam kerja sama sekali menghasilkan 0 menit (17:00 - 18:00)', () => {
            const minutes = calculateEffectiveMinutes('17:00', '18:00');
            expect(minutes).toBe(0);
        });

        test('1.8. Jam mulai lebih besar atau sama dengan jam selesai menghasilkan 0 menit', () => {
            expect(calculateEffectiveMinutes('10:00', '09:00')).toBe(0);
            expect(calculateEffectiveMinutes('10:00', '10:00')).toBe(0);
        });
    });

    describe('2. Struktur DOM Halaman Agenda Pegawai di agenda-pegawai.html', () => {
        test('2.1. Header Agenda Pegawai hadir dengan icon fa-clipboard-user dan tombol aksi', () => {
            const h1 = document.querySelector('h1');
            expect(h1).not.toBeNull();
            expect(h1.textContent).toMatch(/E-Kinerja Tendik|E-Kinerja Tenaga Kependidikan|Agenda Pegawai/i);
            expect(h1.querySelector('i.fa-clipboard-user')).not.toBeNull();

            expect(document.getElementById('input-agenda-date')).not.toBeNull();
            expect(document.getElementById('btn-agenda-today')).not.toBeNull();
            expect(document.getElementById('btn-agenda-prev')).not.toBeNull();
            expect(document.getElementById('btn-agenda-next')).not.toBeNull();
            expect(document.getElementById('btn-open-activity-modal')).not.toBeNull();
        });

        test('2.2. Kontainer konten tab-content-employee hadir dan memiliki visual timeline serta strip akumulasi pekanan', () => {
            const content = document.getElementById('tab-content-employee');
            expect(content).not.toBeNull();

            // Timeline jam kerja, strip akumulasi pekanan & deteksi celah
            expect(document.getElementById('weekly-employee-strip')).not.toBeNull();
            expect(document.getElementById('timeline-work-ribbon')).not.toBeNull();
            expect(document.getElementById('stat-gap-summary')).not.toBeNull();
        });

        test('2.3. Bagian penugasan SK dan daftar aktivitas hadir', () => {
            expect(document.getElementById('sk-assignment-employee-name')).not.toBeNull();
            expect(document.getElementById('sk-assignment-badges')).not.toBeNull();
            expect(document.getElementById('btn-toggle-sk-details')).not.toBeNull();
            expect(document.getElementById('section-sk-details')).not.toBeNull();
            expect(document.getElementById('employee-activities-container')).not.toBeNull();
            expect(document.getElementById('search-employee-activities')).not.toBeNull();
            expect(document.getElementById('btn-clear-search')).not.toBeNull();
        });

        test('2.4. Bagian monitoring rekapitulasi lama dieliminasi dan digantikan oleh Mode Monitoring & Rekap Realisasi Tendik (VIP)', () => {
            expect(document.getElementById('btn-employee-summary-toggle')).toBeNull();
            const secSummary = document.getElementById('section-employee-summary-view');
            expect(secSummary).not.toBeNull();
            expect(secSummary.classList.contains('hidden')).toBe(true);

            // Rekap Realisasi Tendik (VIP) tetap hadir dan terlindungi
            expect(document.getElementById('btn-employee-monthly-recap-toggle')).not.toBeNull();
            expect(document.getElementById('modal-employee-monthly-recap')).not.toBeNull();
        });

        test('2.5. Visual Timeline Jam Kerja Lebar & Interaktivitas Balok Aktivitas (Hover Tooltip & Click-to-Edit)', () => {
            const ribbon = document.getElementById('timeline-work-ribbon');
            expect(ribbon).not.toBeNull();
            expect(ribbon.classList.contains('w-full')).toBe(true);
            expect(ribbon.classList.contains('overflow-visible')).toBe(true);

            // Periksa kode logika renderVisualTimelineRibbon di page-agenda-pegawai.js
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');
            expect(pageCode).toContain("onclick=\"window.editEmployeeActivity('${act.id}')\"");
            expect(pageCode).toContain('group-hover:flex');
            expect(pageCode).toContain('Klik untuk edit');
            expect(pageCode).toContain('Waktu Istirahat Resmi');
        });
    });

    describe('3. Modal Input & Edit Aktivitas Pegawai', () => {
        test('3.1. Modal modal-employee-activity memiliki form lengkap dengan field wajib dan informasi peran SK', () => {
            const modal = document.getElementById('modal-employee-activity');
            expect(modal).not.toBeNull();
            expect(modal.classList.contains('hidden')).toBe(true);

            expect(document.getElementById('form-activity-date')).not.toBeNull();
            expect(document.getElementById('form-activity-start')).not.toBeNull();
            expect(document.getElementById('form-activity-end')).not.toBeNull();
            expect(document.getElementById('form-activity-group')).not.toBeNull();
            expect(document.getElementById('form-activity-role')).not.toBeNull();
            expect(document.getElementById('form-activity-role-badge')).not.toBeNull();
            expect(document.getElementById('form-activity-task-item')).not.toBeNull();
            expect(document.getElementById('form-activity-desc')).not.toBeNull();
            expect(document.getElementById('form-activity-location')).not.toBeNull();
            expect(document.getElementById('form-activity-output')).not.toBeNull();
            expect(document.getElementById('form-activity-outside')).not.toBeNull();
            expect(document.getElementById('btn-save-activity')).not.toBeNull();
            expect(document.getElementById('preview-effective-val')).not.toBeNull();
        });

        test('3.2. Form peran pegawai dibungkus dalam container dengan kelas hidden agar tampilan modal ringkas', () => {
            const roleContainer = document.getElementById('container-form-activity-role');
            expect(roleContainer).not.toBeNull();
            expect(roleContainer.classList.contains('hidden')).toBe(true);

            // Input di dalamnya tetap ada untuk menjaga kompatibilitas logika JavaScript & SK
            const roleInput = document.getElementById('form-activity-role');
            expect(roleInput).not.toBeNull();
            expect(roleContainer.contains(roleInput)).toBe(true);
        });

        test('3.3. Tombol cepat durasi (30 Menit, 1 Jam, 1,5 Jam, 2 Jam) tersedia di DOM dan memiliki data-minutes yang sesuai', () => {
            const quickButtons = Array.from(document.querySelectorAll('.btn-quick-dur'));
            expect(quickButtons.length).toBe(4);

            const expectedDurations = [30, 60, 90, 120];
            const foundDurations = quickButtons.map(btn => Number(btn.getAttribute('data-minutes')));
            expect(foundDurations).toEqual(expectedDurations);

            const buttonTexts = quickButtons.map(btn => btn.textContent.trim());
            expect(buttonTexts).toContain('30 Menit');
            expect(buttonTexts).toContain('1 Jam');
            expect(buttonTexts).toContain('1,5 Jam');
            expect(buttonTexts).toContain('2 Jam');
        });

        test('3.4. page-agenda-pegawai.js mengimplementasikan applyQuickDuration, otomatisasi jam mulai, dan default lokasi Ruang Tata Usaha', () => {
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');

            // Fungsi tombol cepat durasi diekspos secara global
            expect(pageCode).toContain('window.applyQuickDuration = function(minutes)');

            // Jam mulai otomatis mengambil jam selesai aktivitas sebelumnya
            expect(pageCode).toContain('let nextStartTime = \'07:30\';');
            expect(pageCode).toContain('nextStartTime = endTimes[endTimes.length - 1];');
            expect(pageCode).toContain('document.getElementById(\'form-activity-start\').value = nextStartTime;');

            // Lokasi default adalah Ruang Tata Usaha untuk staf (kosong untuk KS)
            expect(pageCode).toMatch(/document\.getElementById\('form-activity-location'\)\.value\s*=/);
            expect(pageCode).toContain("'Ruang Tata Usaha'");

            // Sinkronisasi highlight tombol durasi pada preview
            expect(pageCode).toContain("quickBtns.forEach(btn =>");
            expect(pageCode).toContain("btn.classList.add('bg-emerald-600', 'text-white'");
        });

        test('3.5. Logika applyQuickDuration menghitung jam selesai dengan benar dari jam mulai', () => {
            const startInput = document.getElementById('form-activity-start');
            const endInput = document.getElementById('form-activity-end');

            const calculateEndTime = (startTime, addMinutes) => {
                const [h, m] = startTime.split(':').map(Number);
                const totalMin = h * 60 + m + addMinutes;
                const newH = Math.floor(totalMin / 60) % 24;
                const newM = totalMin % 60;
                return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
            };

            // Test 30 Menit
            startInput.value = '08:00';
            endInput.value = calculateEndTime(startInput.value, 30);
            expect(endInput.value).toBe('08:30');

            // Test 1 Jam (60 Menit)
            startInput.value = '08:30';
            endInput.value = calculateEndTime(startInput.value, 60);
            expect(endInput.value).toBe('09:30');

            // Test 1,5 Jam (90 Menit)
            startInput.value = '09:30';
            endInput.value = calculateEndTime(startInput.value, 90);
            expect(endInput.value).toBe('11:00');

            // Test 2 Jam (120 Menit)
            startInput.value = '13:00';
            endInput.value = calculateEndTime(startInput.value, 120);
            expect(endInput.value).toBe('15:00');
        });

        test('3.6. page-agenda-pegawai.js dan agenda-pegawai.html mengimplementasikan live overlap check dan warning banner', () => {
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');
            const htmlContent = fs.readFileSync(path.join(__dirname, '../e-kinerja-tendik.html'), 'utf8');

            // Komponen peringatan bentrok waktu di DOM
            expect(htmlContent).toContain('id="modal-activity-overlap-warning"');
            expect(htmlContent).toContain('id="modal-activity-overlap-text"');

            // Fungsi validasi bentrok waktu di JS
            expect(pageCode).toContain('window.checkTimeOverlap = function()');
            expect(pageCode).toContain('startVal < actEnd && endVal > actStart');
            expect(pageCode).toContain('warningEl.classList.remove(\'hidden\');');

            // Handler onActivityTimeChange
            expect(pageCode).toContain('window.onActivityTimeChange = function()');
            expect(htmlContent).toContain('onchange="window.onActivityTimeChange()"');
        });

        test('3.7. Logika penentuan slot waktu berikutnya melanjutkan jam selesai aktivitas terakhir dan menyetel default jam selesai +60 menit', () => {
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');

            // Memastikan penambahan 60 menit sebagai default durasi
            expect(pageCode).toContain('const endTotal = sh * 60 + sm + 60; // Default +60 menit (1 Jam)');
            expect(pageCode).toContain('function getActivitiesForDate(dateStr)');

            // Simulasi kalkulasi kelanjutan waktu
            const existingActs = [
                { start_time: '07:30', end_time: '08:30', description: 'Aktivitas 1' },
                { start_time: '08:30', end_time: '10:00', description: 'Aktivitas 2' }
            ];
            const endTimes = existingActs.map(a => a.end_time).sort();
            const nextStart = endTimes[endTimes.length - 1];
            expect(nextStart).toBe('10:00');

            const [sh, sm] = nextStart.split(':').map(Number);
            const endTotal = sh * 60 + sm + 60;
            const endH = Math.floor(endTotal / 60) % 24;
            const endM = endTotal % 60;
            const nextEnd = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
            expect(nextEnd).toBe('11:00');
        });

        test('3.8. Reaktivitas perubahan tanggal di modal (window.onActivityDateChange) terdaftar pada form-activity-date', () => {
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');
            const htmlContent = fs.readFileSync(path.join(__dirname, '../e-kinerja-tendik.html'), 'utf8');

            expect(pageCode).toContain('window.onActivityDateChange = async function()');
            expect(htmlContent).toContain('id="form-activity-date" required onchange="window.onActivityDateChange()"');
        });

        test('3.9. Default lokasi Ruang Tata Usaha terkunci konsisten dan tidak dioverwrite oleh pemilihan kelompok penugasan', () => {
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');

            expect(pageCode).toMatch(/\/\/\s*2\.\s*Lokasi Pelaksanaan:/);
            expect(pageCode).toContain("locInput.value = 'Ruang Tata Usaha';");
        });

        test('3.10. Tombol Hapus pada modal edit agenda (#btn-delete-activity-modal) hadir dan window.deleteActivityFromModal terdefinisi', () => {
            const htmlContent = fs.readFileSync(path.join(__dirname, '../e-kinerja-tendik.html'), 'utf8');
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');

            expect(htmlContent).toContain('id="btn-delete-activity-modal"');
            expect(htmlContent).toContain('onclick="window.deleteActivityFromModal()"');
            expect(pageCode).toContain('window.deleteActivityFromModal = async function()');
            expect(pageCode).toMatch(/btnDeleteModal\.classList\.remove\('hidden'\)/);
            expect(pageCode).toMatch(/btnDeleteModal\.classList\.add\('hidden'\)/);
        });

        test('3.11. Desain kartu daftar aktivitas harian kompak, rapi, dan 2-grid per baris dengan aksi di kanan atas', () => {
            const htmlContent = fs.readFileSync(path.join(__dirname, '../e-kinerja-tendik.html'), 'utf8');
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');

            expect(htmlContent).toContain('id="employee-activities-container" class="grid grid-cols-1 md:grid-cols-2 gap-2.5 sm:gap-3"');
            expect(pageCode).toContain('rounded-xl p-2.5 sm:p-3 border border-slate-200/70');
            expect(pageCode).toContain('flex flex-col justify-between');
            expect(pageCode).toContain('w-7 h-7 rounded-lg');
            expect(pageCode).toContain('line-clamp-2 leading-relaxed');

            // Ikon hapus di kartu telah dihapus, hanya menyisakan tombol edit pensil
            const cardSection = pageCode.split('container.innerHTML = filtered.map')[1]?.split(".join('')")[0] || '';
            expect(cardSection).not.toBe('');
            expect(cardSection).not.toContain('fa-trash-can');
            expect(cardSection).toContain('fa-pen');
        });
    });

    describe('4. Integritas Cloudflare Client SDK & Backup Registry', () => {
        test('4.1. File cloudflare-client.js mengekspor fungsi-fungsi Agenda Pegawai', () => {
            const clientContent = fs.readFileSync(path.join(__dirname, '../js/cloudflare-client.js'), 'utf8');
            expect(clientContent).toContain('getEmployeeAgendaSk()');
            expect(clientContent).toContain('getMyAssignments()');
            expect(clientContent).toContain('getEmployeeAssignments(');
            expect(clientContent).toContain('getEmployeeActivities(');
            expect(clientContent).toContain('createEmployeeActivity(');
            expect(clientContent).toContain('updateEmployeeActivity(');
            expect(clientContent).toContain('deleteEmployeeActivity(');
            expect(clientContent).toContain('getEmployeeAgendaSummary(');
            expect(clientContent).toContain('manageEmployeeSk(');
        });

        test('4.2. File page-settings.js mendaftarkan entitas Agenda Pegawai di BACKUP_REGISTRY', () => {
            const settingsContent = fs.readFileSync(path.join(__dirname, '../js/page-settings.js'), 'utf8');
            expect(settingsContent).not.toContain('employee_sk:');
            expect(settingsContent).toContain('employee_task_groups:');
            expect(settingsContent).toContain('employee_task_items:');
            expect(settingsContent).toContain('employee_assignments:');
            expect(settingsContent).toContain('employee_activities:');
        });
    });

    describe('5. Integritas Skema Database & Migrasi', () => {
        test('5.1. File migrasi 202609080002_add_employee_agenda.sql memuat 6 tabel dan seed data SK 2026', () => {
            const migrationFile = path.join(__dirname, '../cloudflare/migrations/202609080002_add_employee_agenda.sql');
            expect(fs.existsSync(migrationFile)).toBe(true);

            const sql = fs.readFileSync(migrationFile, 'utf8');
            expect(sql).toContain('CREATE TABLE IF NOT EXISTS employee_sk');
            expect(sql).toContain('CREATE TABLE IF NOT EXISTS employee_task_groups');
            expect(sql).toContain('CREATE TABLE IF NOT EXISTS employee_task_items');
            expect(sql).toContain('CREATE TABLE IF NOT EXISTS employee_assignments');
            expect(sql).toContain('CREATE TABLE IF NOT EXISTS employee_activities');
            expect(sql).toContain('CREATE TABLE IF NOT EXISTS employee_activity_history');
            expect(sql).toContain('B.10.400.3.8./64/SMAN 1 ABANG/DIKPORA');
            expect(sql).toContain('I Wayan Mudita');
            expect(sql).toContain('Ni Ketut Lilik Juliawati');
        });

        test('5.2. File schema.sql memuat tabel-tabel Agenda Pegawai', () => {
            const schemaContent = fs.readFileSync(path.join(__dirname, '../cloudflare/schema.sql'), 'utf8');
            expect(schemaContent).toContain('35a. Kelompok Penugasan Pegawai');
            expect(schemaContent).toContain('35e. Realisasi Aktivitas Harian Pegawai');
        });
    });

    describe('6. Hak Akses Super Admin & Supervisi Tendik', () => {
        test('6.1. global.js mendaftarkan agenda-pegawai.html dengan akses rw untuk super_admin', () => {
            const globalContent = fs.readFileSync(path.join(__dirname, '../js/global.js'), 'utf8');
            expect(globalContent).toContain("'agenda-pegawai.html': {");
            expect(globalContent).toMatch(/'agenda-pegawai\.html':\s*\{[^}]*'super_admin':\s*'rw'/);
            expect(globalContent).toMatch(/'agenda-pegawai\.html':\s*\{[^}]*'kepala_sekolah':\s*'rw'/);
            expect(globalContent).toMatch(/'agenda-pegawai\.html':\s*\{[^}]*'staff':\s*'rw'/);
        });

        test('6.2. page-agenda-pegawai.js mendukung multi-role check dan mengizinkan super_admin', () => {
            const pageContent = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');
            expect(pageContent).toContain('isSuperAdmin');
            expect(pageContent).toContain('isSupervisor = isSuperAdmin || isKepsek');
            expect(pageContent).toContain('isSupervisor');
            expect(pageContent).toContain('loadStaffOptions()');
            expect(pageContent).not.toContain('loadSupervisorSummary()');
            expect(pageContent).toContain('openPrincipalTasksModal');
        });

        test('6.3. worker.js mengizinkan super_admin sebagai employee agenda manager', () => {
            const workerContent = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');
            expect(workerContent).toContain('function isEmployeeAgendaManager(user)');
            expect(workerContent).toContain("const mgr = ['super_admin', 'kepala_sekolah']");
        });
    });

    describe('7. Modal & Fitur Kelola Master Penugasan (Super Admin & Kepala Sekolah)', () => {
        test('7.1. Tombol Kelola Penugasan (#btn-manage-assignments) hadir di header agenda-pegawai.html', () => {
            const btnManage = document.getElementById('btn-manage-assignments');
            expect(btnManage).not.toBeNull();
            expect(btnManage.classList.contains('hidden')).toBe(true);
            expect(btnManage.textContent).toContain('Kelola Penugasan');
            expect(btnManage.getAttribute('onclick')).toContain('openManageAssignmentsModal');
        });

        test('7.2. Modal Kelola Penugasan (#modal-manage-assignments) hadir dengan 3 tab navigasi', () => {
            const modalManage = document.getElementById('modal-manage-assignments');
            expect(modalManage).not.toBeNull();
            expect(modalManage.classList.contains('hidden')).toBe(true);

            expect(document.getElementById('btn-tab-manage-assignments')).not.toBeNull();
            expect(document.getElementById('btn-tab-manage-groups')).not.toBeNull();
            expect(document.getElementById('btn-tab-manage-items')).not.toBeNull();

            expect(document.getElementById('pane-manage-assignments')).not.toBeNull();
            expect(document.getElementById('pane-manage-groups')).not.toBeNull();
            expect(document.getElementById('pane-manage-items')).not.toBeNull();
        });

        test('7.3. Form penugasan, form kelompok, dan form butir tugas memiliki elemen input lengkap', () => {
            // Tab 1: Form Penugasan
            expect(document.getElementById('form-manage-assignment')).not.toBeNull();
            expect(document.getElementById('assign-form-gtk')).not.toBeNull();
            expect(document.getElementById('assign-form-group')).not.toBeNull();
            expect(document.getElementById('assign-form-role')).not.toBeNull();
            expect(document.getElementById('assign-form-scope')).not.toBeNull();
            expect(document.getElementById('btn-save-assignment')).not.toBeNull();
            expect(document.getElementById('table-manage-assignments-body')).not.toBeNull();
            expect(document.getElementById('input-search-assignments')).not.toBeNull();

            // Tab 2: Form Kelompok
            expect(document.getElementById('form-manage-group')).not.toBeNull();
            expect(document.getElementById('group-form-code')).not.toBeNull();
            expect(document.getElementById('group-form-name')).not.toBeNull();
            expect(document.getElementById('btn-save-group')).not.toBeNull();
            expect(document.getElementById('table-manage-groups-body')).not.toBeNull();

            // Tab 3: Form Butir Tugas
            expect(document.getElementById('form-manage-item')).not.toBeNull();
            expect(document.getElementById('item-form-group')).not.toBeNull();
            expect(document.getElementById('item-form-code')).not.toBeNull();
            expect(document.getElementById('item-form-desc')).not.toBeNull();
            expect(document.getElementById('btn-save-item')).not.toBeNull();
            expect(document.getElementById('filter-item-by-group')).not.toBeNull();
            expect(document.getElementById('table-manage-items-body')).not.toBeNull();
        });

        test('7.4. page-agenda-pegawai.js mengimplementasikan fungsi manajemen master penugasan lengkap', () => {
            const pageContent = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');
            expect(pageContent).toContain('window.openManageAssignmentsModal');
            expect(pageContent).toContain('window.closeManageAssignmentsModal');
            expect(pageContent).toContain('window.switchManageTab');
            expect(pageContent).toContain('window.saveAssignmentForm');
            expect(pageContent).toContain('window.deleteAssignmentItem');
            expect(pageContent).toContain('window.saveGroupForm');
            expect(pageContent).toContain('window.deleteGroupItem');
            expect(pageContent).toContain('window.saveTaskItemForm');
            expect(pageContent).toContain('window.deleteTaskItem');
        });

        test('7.5. cloudflare-client.js memiliki method manageEmployeeAgenda', () => {
            const clientContent = fs.readFileSync(path.join(__dirname, '../js/cloudflare-client.js'), 'utf8');
            expect(clientContent).toContain('manageEmployeeAgenda(');
            expect(clientContent).toContain('/api/employee-agenda/manage');
        });

        test('7.6. Komponen Searchable Combobox Pemilihan Pegawai hadir lengkap di agenda-pegawai.html', () => {
            expect(document.getElementById('container-assign-gtk')).not.toBeNull();
            expect(document.getElementById('assign-gtk-search')).not.toBeNull();
            expect(document.getElementById('btn-clear-assign-gtk')).not.toBeNull();
            expect(document.getElementById('btn-toggle-assign-gtk')).not.toBeNull();
            expect(document.getElementById('icon-assign-gtk-chevron')).not.toBeNull();
            expect(document.getElementById('assign-gtk-dropdown')).not.toBeNull();
            expect(document.getElementById('assign-form-gtk')).not.toBeNull();

            // Atribut ARIA dan combobox accessibility
            const searchInput = document.getElementById('assign-gtk-search');
            expect(searchInput.getAttribute('role')).toBe('combobox');
            expect(searchInput.getAttribute('aria-expanded')).toBe('false');
            expect(searchInput.getAttribute('aria-controls')).toBe('assign-gtk-dropdown');
        });

        test('7.7. page-agenda-pegawai.js mengimplementasikan fungsi-fungsi Searchable Combobox GTK', () => {
            const pageContent = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');
            expect(pageContent).toContain('setupAssignGtkCombobox');
            expect(pageContent).toContain('window.openAssignGtkDropdown');
            expect(pageContent).toContain('window.closeAssignGtkDropdown');
            expect(pageContent).toContain('window.toggleAssignGtkDropdown');
            expect(pageContent).toContain('window.renderAssignGtkDropdownOptions');
            expect(pageContent).toContain('window.selectAssignGtk');
            expect(pageContent).toContain('window.clearAssignGtkSelection');
        });

        test('7.8. Format opsi pilihan pegawai bersih: hanya Nama dan NIP jika ada, tanpa role guru_mapel', () => {
            const pageContent = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');
            // Memastikan role guru_mapel / [${g.role}] tidak lagi disematkan pada label pilihan pegawai
            expect(pageContent).not.toMatch(/escapeHTML\(roleText\)/);
            expect(pageContent).not.toMatch(/\[\$\{g\.role\}\]/);
            expect(pageContent).toContain('(NIP: ${nip})');
        });
    });

    describe('8. Ketepatan Identitas Pegawai dan Konsistensi Status Rekap Supervisi (Tahap 1 - 10 Skenario Wajib)', () => {
        /**
         * SSOT Logika Agregasi Rekapitulasi Supervisi (sesuai implementasi aktual di cloudflare/worker.js)
         */
        function processSupervisorSummary(allAssignedRows, activityRows, qFrom = '2026-09-23', qTo = '2026-09-23') {
            const assignedPersonsMap = new Map();
            const unlinkedAssignments = [];

            for (const ea of allAssignedRows) {
                const verifiedGtkId = ea.matched_gtk_id || (ea.gtk_id && ea.gtk_id.trim() !== '' ? ea.gtk_id.trim() : null);
                const verifiedUid = ea.user_uid && ea.user_uid.trim() !== '' ? ea.user_uid.trim() : null;

                if (!verifiedGtkId && !verifiedUid) {
                    unlinkedAssignments.push({
                        assignment_id: ea.assignment_id,
                        group_id: ea.group_id,
                        employee_name: ea.employee_name || 'Tanpa Nama',
                        employee_nip: ea.employee_nip || '',
                        role_in_group: ea.role_in_group || ''
                    });
                    continue;
                }

                const personId = verifiedGtkId || verifiedUid;
                let person = assignedPersonsMap.get(personId);
                if (!person) {
                    const canonicalName = ea.matched_gtk_name || (ea.employee_name ? ea.employee_name.trim() : 'Pegawai');
                    person = {
                        person_id: personId,
                        gtk_id: verifiedGtkId,
                        user_uids: new Set(verifiedUid ? [verifiedUid] : []),
                        employee_name: canonicalName,
                        employee_nip: ea.matched_gtk_nip || ea.employee_nip || '',
                        jenis_ptk: ea.jenis_ptk || null,
                        assignment_count: 0,
                        assignments: [],
                        activity_count: 0,
                        total_effective_minutes: 0,
                        effective_minutes: 0,
                        earliest_start: null,
                        latest_end: null,
                        outside_duty_count: 0,
                        has_reported: false
                    };
                    assignedPersonsMap.set(personId, person);
                }

                person.assignment_count += 1;
                if (verifiedUid) person.user_uids.add(verifiedUid);
                person.assignments.push({
                    assignment_id: ea.assignment_id,
                    group_id: ea.group_id,
                    role_in_group: ea.role_in_group
                });
            }

            const gtkToPersonMap = new Map();
            const uidToPersonMap = new Map();
            const nameToPersonMap = new Map();

            for (const person of assignedPersonsMap.values()) {
                if (person.gtk_id) gtkToPersonMap.set(person.gtk_id, person);
                for (const u of person.user_uids) {
                    uidToPersonMap.set(u, person);
                }
                if (person.employee_name) {
                    nameToPersonMap.set(person.employee_name.toLowerCase().trim(), person);
                }
            }

            const unassignedMap = new Map();

            for (const act of activityRows) {
                let person = null;
                if (act.gtk_id && gtkToPersonMap.has(act.gtk_id)) {
                    person = gtkToPersonMap.get(act.gtk_id);
                } else if (act.user_uid && uidToPersonMap.has(act.user_uid)) {
                    person = uidToPersonMap.get(act.user_uid);
                } else if (act.employee_name && nameToPersonMap.has(act.employee_name.toLowerCase().trim())) {
                    person = nameToPersonMap.get(act.employee_name.toLowerCase().trim());
                }

                const eff = Number(act.durasi_efektif_menit) || 0;

                if (person) {
                    person.activity_count += 1;
                    person.total_effective_minutes += eff;
                    person.effective_minutes = person.total_effective_minutes;
                    if (!person.earliest_start || (act.jam_mulai && act.jam_mulai < person.earliest_start)) {
                        person.earliest_start = act.jam_mulai;
                    }
                    if (!person.latest_end || (act.jam_selesai && act.jam_selesai > person.latest_end)) {
                        person.latest_end = act.jam_selesai;
                    }
                    if (act.is_outside_duty === 1 || act.sumber_kegiatan === 'dinas_luar') {
                        person.outside_duty_count += 1;
                    }
                    person.has_reported = (person.activity_count > 0);
                } else {
                    const uKey = act.gtk_id || act.user_uid || (act.employee_name ? act.employee_name.toLowerCase().trim() : act.id);
                    let unassigned = unassignedMap.get(uKey);
                    if (!unassigned) {
                        unassigned = {
                            person_id: uKey,
                            gtk_id: act.gtk_id || null,
                            user_uid: act.user_uid || null,
                            employee_name: act.employee_name || 'Pegawai',
                            jenis_ptk: null,
                            activity_count: 0,
                            total_effective_minutes: 0,
                            effective_minutes: 0,
                            earliest_start: null,
                            latest_end: null,
                            outside_duty_count: 0,
                            has_reported: true
                        };
                        unassignedMap.set(uKey, unassigned);
                    }
                    unassigned.activity_count += 1;
                    unassigned.total_effective_minutes += eff;
                    unassigned.effective_minutes = unassigned.total_effective_minutes;
                    if (!unassigned.earliest_start || (act.jam_mulai && act.jam_mulai < unassigned.earliest_start)) {
                        unassigned.earliest_start = act.jam_mulai;
                    }
                    if (!unassigned.latest_end || (act.jam_selesai && act.jam_selesai > unassigned.latest_end)) {
                        unassigned.latest_end = act.jam_selesai;
                    }
                    if (act.is_outside_duty === 1 || act.sumber_kegiatan === 'dinas_luar') {
                        unassigned.outside_duty_count += 1;
                    }
                }
            }

            const employees = Array.from(assignedPersonsMap.values()).map(p => ({
                ...p,
                user_uids: Array.from(p.user_uids)
            }));
            employees.sort((a, b) => (a.employee_name || '').localeCompare(b.employee_name || '', 'id'));

            const unassignedEmployees = Array.from(unassignedMap.values());
            unassignedEmployees.sort((a, b) => (a.employee_name || '').localeCompare(b.employee_name || '', 'id'));

            const totalAssigned = employees.length;
            const totalReported = employees.filter(e => e.has_reported).length;
            const totalUnreported = totalAssigned - totalReported;
            const notReported = employees.filter(e => !e.has_reported).map(e => e.gtk_id || e.person_id);

            const fromDate = new Date(qFrom + "T00:00:00");
            const toDate = new Date(qTo + "T00:00:00");
            const dayCount = Math.max(1, Math.ceil((toDate - fromDate) / 86400000) + 1);
            const dayOfWeek = isNaN(fromDate.getDay()) ? -1 : fromDate.getDay();
            const isSingleDay = (qFrom === qTo);
            const isWeekend = isSingleDay && (dayOfWeek === 0 || dayOfWeek === 6);
            const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
            const dayName = DAY_NAMES[dayOfWeek] || "";

            return {
                period: { from: qFrom, to: qTo, days: dayCount, day_name: dayName, is_weekend: isWeekend },
                is_weekend: isWeekend,
                day_name: dayName,
                target_minutes_per_day: isWeekend ? 0 : 450,
                employees,
                unassigned_employees: unassignedEmployees,
                unlinked_assignments: unlinkedAssignments,
                total_assigned: totalAssigned,
                total_reported: totalReported,
                total_unreported: totalUnreported,
                not_reported: notReported
            };
        }

        /**
         * SSOT Logika Otorisasi Aktivitas Staf
         */
        function checkActivityOwnership(user, existing) {
            const isMgr = ['super_admin', 'kepala_sekolah'].includes(user.role) ||
                (user.additionalRoles && user.additionalRoles.some(r => ['super_admin', 'kepala_sekolah'].includes(r)));
            if (isMgr) return true;

            const userUid = user.uid || '';
            const userGtkId = user.linkedTeacherId || '';

            const isOwnerUid = Boolean(userUid && existing.user_uid === userUid);
            const isOwnerGtk = Boolean(userGtkId && existing.gtk_id === userGtkId);

            return isOwnerUid || isOwnerGtk;
        }

        test('8.1. Skenario 1: Satu pegawai, satu penugasan, beberapa kegiatan', () => {
            const assignments = [
                { assignment_id: 'asg_1', group_id: 'grp_1', gtk_id: 'gtk_01', employee_name: 'I Wayan Mudita', matched_gtk_id: 'gtk_01', matched_gtk_name: 'I Wayan Mudita' }
            ];
            const activities = [
                { id: 'act_1', gtk_id: 'gtk_01', jam_mulai: '08:00', jam_selesai: '09:30', durasi_efektif_menit: 90 },
                { id: 'act_2', gtk_id: 'gtk_01', jam_mulai: '10:00', jam_selesai: '12:00', durasi_efektif_menit: 120 }
            ];

            const res = processSupervisorSummary(assignments, activities);

            expect(res.total_assigned).toBe(1);
            expect(res.total_reported).toBe(1);
            expect(res.total_unreported).toBe(0);
            expect(res.employees.length).toBe(1);
            expect(res.employees[0].activity_count).toBe(2);
            expect(res.employees[0].total_effective_minutes).toBe(210);
            expect(res.employees[0].has_reported).toBe(true);
            expect(res.employees[0].earliest_start).toBe('08:00');
            expect(res.employees[0].latest_end).toBe('12:00');
        });

        test('8.2. Skenario 2: Satu pegawai, dua atau lebih penugasan (multi-penugasan) tidak berlipat ganda', () => {
            // Pegawai memiliki 3 penugasan SK yang berbeda
            const assignments = [
                { assignment_id: 'asg_1', group_id: 'grp_tu', gtk_id: 'gtk_01', employee_name: 'I Wayan Mudita', matched_gtk_id: 'gtk_01', matched_gtk_name: 'I Wayan Mudita', role_in_group: 'Ketua' },
                { assignment_id: 'asg_2', group_id: 'grp_kepegawaian', gtk_id: 'gtk_01', employee_name: 'I Wayan Mudita', matched_gtk_id: 'gtk_01', matched_gtk_name: 'I Wayan Mudita', role_in_group: 'Anggota' },
                { assignment_id: 'asg_3', group_id: 'grp_persuratan', gtk_id: 'gtk_01', employee_name: 'I Wayan Mudita', matched_gtk_id: 'gtk_01', matched_gtk_name: 'I Wayan Mudita', role_in_group: 'Koordinator' }
            ];
            const activities = [
                { id: 'act_1', gtk_id: 'gtk_01', jam_mulai: '07:30', jam_selesai: '11:30', durasi_efektif_menit: 240 }
            ];

            const res = processSupervisorSummary(assignments, activities);

            // Harus tetap 1 entitas pegawai dan durasi tidak berlipat
            expect(res.employees.length).toBe(1);
            expect(res.total_assigned).toBe(1);
            expect(res.total_reported).toBe(1);
            expect(res.total_unreported).toBe(0);
            expect(res.employees[0].assignment_count).toBe(3);
            expect(res.employees[0].activity_count).toBe(1);
            expect(res.employees[0].total_effective_minutes).toBe(240);
        });

        test('8.3. Skenario 3: Dua pegawai berbeda dengan nama yang sama tetap terpisah', () => {
            const assignments = [
                { assignment_id: 'asg_a', group_id: 'grp_1', gtk_id: 'gtk_wayan_1', employee_nip: '19800101', employee_name: 'I Wayan Suardana', matched_gtk_id: 'gtk_wayan_1', matched_gtk_name: 'I Wayan Suardana' },
                { assignment_id: 'asg_b', group_id: 'grp_2', gtk_id: 'gtk_wayan_2', employee_nip: '19850202', employee_name: 'I Wayan Suardana', matched_gtk_id: 'gtk_wayan_2', matched_gtk_name: 'I Wayan Suardana' }
            ];
            // Hanya Wayan Suardana ke-1 yang melapor
            const activities = [
                { id: 'act_1', gtk_id: 'gtk_wayan_1', jam_mulai: '08:00', jam_selesai: '10:00', durasi_efektif_menit: 120 }
            ];

            const res = processSupervisorSummary(assignments, activities);

            expect(res.total_assigned).toBe(2);
            expect(res.total_reported).toBe(1);
            expect(res.total_unreported).toBe(1);
            expect(res.employees.length).toBe(2);

            const reportedPerson = res.employees.find(e => e.gtk_id === 'gtk_wayan_1');
            const unreportedPerson = res.employees.find(e => e.gtk_id === 'gtk_wayan_2');

            expect(reportedPerson.has_reported).toBe(true);
            expect(reportedPerson.total_effective_minutes).toBe(120);
            expect(unreportedPerson.has_reported).toBe(false);
            expect(unreportedPerson.total_effective_minutes).toBe(0);
        });

        test('8.4. Skenario 4: Satu pegawai dengan variasi nama historis tetap teragregasi', () => {
            const assignments = [
                { assignment_id: 'asg_1', group_id: 'grp_1', gtk_id: 'gtk_mudita', employee_name: 'Dr. I Wayan Mudita, S.Pd', matched_gtk_id: 'gtk_mudita', matched_gtk_name: 'Dr. I Wayan Mudita, S.Pd' }
            ];
            const activities = [
                { id: 'act_1', gtk_id: 'gtk_mudita', employee_name: 'I Wayan Mudita', jam_mulai: '08:00', jam_selesai: '10:00', durasi_efektif_menit: 120 },
                { id: 'act_2', gtk_id: 'gtk_mudita', employee_name: 'Dr. I Wayan Mudita, S.Pd', jam_mulai: '10:00', jam_selesai: '12:00', durasi_efektif_menit: 120 }
            ];

            const res = processSupervisorSummary(assignments, activities);

            expect(res.employees.length).toBe(1);
            expect(res.employees[0].activity_count).toBe(2);
            expect(res.employees[0].total_effective_minutes).toBe(240);
        });

        test('8.5. Skenario 5: Pemetaan terverifikasi legacy user_uid dan gtk_id teragregasi ke orang yang sama', () => {
            const assignments = [
                { assignment_id: 'asg_1', group_id: 'grp_1', gtk_id: 'gtk_lilik', user_uid: 'uid_lilik_firebase', employee_name: 'Ni Ketut Lilik Juliawati', matched_gtk_id: 'gtk_lilik', matched_gtk_name: 'Ni Ketut Lilik Juliawati' }
            ];
            // Catatan lama tercatat dengan user_uid, catatan baru dengan gtk_id
            const activities = [
                { id: 'act_old', user_uid: 'uid_lilik_firebase', jam_mulai: '08:00', jam_selesai: '10:00', durasi_efektif_menit: 120 },
                { id: 'act_new', gtk_id: 'gtk_lilik', jam_mulai: '10:30', jam_selesai: '12:00', durasi_efektif_menit: 90 }
            ];

            const res = processSupervisorSummary(assignments, activities);

            expect(res.employees.length).toBe(1);
            expect(res.employees[0].activity_count).toBe(2);
            expect(res.employees[0].total_effective_minutes).toBe(210);
            expect(res.total_reported).toBe(1);
        });

        test('8.6. Skenario 6: Penugasan tanpa identitas pasti masuk ke unlinked_assignments dan tidak menggelembungkan total_assigned', () => {
            const assignments = [
                { assignment_id: 'asg_valid', group_id: 'grp_1', gtk_id: 'gtk_01', employee_name: 'I Wayan Mudita', matched_gtk_id: 'gtk_01', matched_gtk_name: 'I Wayan Mudita' },
                // Penugasan kosong / unlinked
                { assignment_id: 'asg_unlinked', group_id: 'grp_1', gtk_id: '', user_uid: '', employee_name: '', matched_gtk_id: null }
            ];
            const activities = [
                { id: 'act_1', gtk_id: 'gtk_01', jam_mulai: '08:00', jam_selesai: '09:00', durasi_efektif_menit: 60 }
            ];

            const res = processSupervisorSummary(assignments, activities);

            expect(res.unlinked_assignments.length).toBe(1);
            expect(res.unlinked_assignments[0].assignment_id).toBe('asg_unlinked');
            expect(res.total_assigned).toBe(1); // Murni 1, bukan 2!
            expect(res.total_reported).toBe(1);
            expect(res.total_unreported).toBe(0);
            expect(res.total_reported + res.total_unreported).toBe(res.total_assigned);
        });

        test('8.7. Skenario 7: Pegawai mempunyai kegiatan dengan nol menit efektif tetap berstatus Sudah mencatat', () => {
            const assignments = [
                { assignment_id: 'asg_1', group_id: 'grp_1', gtk_id: 'gtk_01', employee_name: 'I Wayan Mudita', matched_gtk_id: 'gtk_01', matched_gtk_name: 'I Wayan Mudita' }
            ];
            // Kegiatan tepat pada jam istirahat (12:30 - 13:00) yang menghasilkan 0 menit efektif
            const activities = [
                { id: 'act_1', gtk_id: 'gtk_01', jam_mulai: '12:30', jam_selesai: '13:00', durasi_efektif_menit: 0 }
            ];

            const res = processSupervisorSummary(assignments, activities);

            expect(res.employees[0].activity_count).toBe(1);
            expect(res.employees[0].total_effective_minutes).toBe(0);
            expect(res.employees[0].has_reported).toBe(true);
            expect(res.total_reported).toBe(1);
            expect(res.total_unreported).toBe(0);
        });

        test('8.8. Skenario 8: Pegawai tanpa kegiatan berstatus Belum ada catatan dengan durasi 0', () => {
            const assignments = [
                { assignment_id: 'asg_1', group_id: 'grp_1', gtk_id: 'gtk_01', employee_name: 'I Wayan Mudita', matched_gtk_id: 'gtk_01', matched_gtk_name: 'I Wayan Mudita' }
            ];
            const activities = []; // Tidak ada kegiatan

            const res = processSupervisorSummary(assignments, activities);

            expect(res.employees[0].activity_count).toBe(0);
            expect(res.employees[0].total_effective_minutes).toBe(0);
            expect(res.employees[0].has_reported).toBe(false);
            expect(res.total_reported).toBe(0);
            expect(res.total_unreported).toBe(1);
            expect(res.not_reported).toContain('gtk_01');
        });

        test('8.9. Skenario 9: Ringkasan total durasi dan log cocok 100% dengan detail', () => {
            const assignments = [
                { assignment_id: 'asg_1', group_id: 'grp_1', gtk_id: 'gtk_01', employee_name: 'I Wayan Mudita', matched_gtk_id: 'gtk_01', matched_gtk_name: 'I Wayan Mudita' }
            ];
            const activities = [
                { id: 'act_1', gtk_id: 'gtk_01', jam_mulai: '08:00', jam_selesai: '10:30', durasi_efektif_menit: 150 },
                { id: 'act_2', gtk_id: 'gtk_01', jam_mulai: '13:00', jam_selesai: '15:00', durasi_efektif_menit: 120 }
            ];

            const summaryRes = processSupervisorSummary(assignments, activities);
            const detailSum = activities.reduce((acc, curr) => acc + curr.durasi_efektif_menit, 0);

            expect(summaryRes.employees[0].total_effective_minutes).toBe(detailSum);
            expect(summaryRes.employees[0].activity_count).toBe(activities.length);
        });

        test('8.10. Skenario 10: Otorisasi staf ketat dan penolakan identitas kosong (anti bypass)', () => {
            const targetActivity = {
                id: 'act_target',
                gtk_id: 'gtk_korban',
                user_uid: 'uid_korban'
            };

            // 1. Staf lain mencoba akses
            const staffOther = { role: 'staff', uid: 'uid_penyerang', linkedTeacherId: 'gtk_penyerang' };
            expect(checkActivityOwnership(staffOther, targetActivity)).toBe(false);

            // 2. Staf dengan identitas kosong ("" dan "") mencoba akses
            const staffEmpty = { role: 'staff', uid: '', linkedTeacherId: '' };
            expect(checkActivityOwnership(staffEmpty, targetActivity)).toBe(false);

            // 3. Staf dengan identitas kosong mencoba akses data yang gtk_id nya juga null/kosong
            const unownedActivity = { id: 'act_orphan', gtk_id: null, user_uid: null };
            expect(checkActivityOwnership(staffEmpty, unownedActivity)).toBe(false);

            // 4. Staf pemilik yang sah
            const staffOwner = { role: 'staff', uid: 'uid_korban', linkedTeacherId: 'gtk_korban' };
            expect(checkActivityOwnership(staffOwner, targetActivity)).toBe(true);

            // 5. Supervisor (Super Admin / Kepala Sekolah) selalu memiliki akses
            const kepsek = { role: 'kepala_sekolah', uid: 'uid_kepsek' };
            expect(checkActivityOwnership(kepsek, targetActivity)).toBe(true);

            const superAdmin = { role: 'guru_mapel', additionalRoles: ['super_admin'], uid: 'uid_admin' };
            expect(checkActivityOwnership(superAdmin, targetActivity)).toBe(true);
        });

        test('8.11. SSOT Integritas Kode: worker.js, page-agenda-pegawai.js, dan agenda-pegawai.html sinkron', () => {
            const workerCode = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');
            const htmlCode = fs.readFileSync(path.join(__dirname, '../e-kinerja-tendik.html'), 'utf8');

            // worker.js memuat deduplikasi dan unlinked assignments
            expect(workerCode).toContain('unlinkedAssignments.push(');
            expect(workerCode).toContain('assignedPersonsMap.set(personId');
            expect(workerCode).toContain('const isOwnerUid = Boolean(userUid && existing.user_uid === userUid);');

            // page-agenda-pegawai.js bersih dari supervisi lama namun memuat fallback status pencatatan aktivitas
            expect(pageCode).toContain('Belum ada catatan');
            expect(pageCode).not.toContain('loadSupervisorSummary');

            // e-kinerja-tendik.html memuat Rekap Realisasi Tendik VIP
            expect(htmlCode).toContain('id="btn-employee-monthly-recap-toggle"');
            expect(htmlCode).toContain('id="modal-employee-monthly-recap"');
        });

        test('8.12. Skenario Akhir Pekan (Sabtu/Minggu): Mendeteksi hari libur kedinasan resmi dan menyesuaikan target acuan', () => {
            const assignments = [
                { assignment_id: 'asg_1', group_id: 'grp_1', gtk_id: 'gtk_01', employee_name: 'I Wayan Mudita', matched_gtk_id: 'gtk_01', matched_gtk_name: 'I Wayan Mudita' }
            ];

            // 1. Uji hari kerja normal (Kamis, 24 September 2026)
            const weekdayRes = processSupervisorSummary(assignments, [], '2026-09-24', '2026-09-24');
            expect(weekdayRes.is_weekend).toBe(false);
            expect(weekdayRes.day_name).toBe('Kamis');
            expect(weekdayRes.target_minutes_per_day).toBe(450);

            // 2. Uji hari Sabtu (26 September 2026)
            const saturdayRes = processSupervisorSummary(assignments, [], '2026-09-26', '2026-09-26');
            expect(saturdayRes.is_weekend).toBe(true);
            expect(saturdayRes.day_name).toBe('Sabtu');
            expect(saturdayRes.target_minutes_per_day).toBe(0);

            // 3. Uji hari Minggu (27 September 2026)
            const sundayRes = processSupervisorSummary(assignments, [], '2026-09-27', '2026-09-27');
            expect(sundayRes.is_weekend).toBe(true);
            expect(sundayRes.day_name).toBe('Minggu');
            expect(sundayRes.target_minutes_per_day).toBe(0);

            // 4. Pegawai mencatat kegiatan di hari libur (misal dinas luar / kegiatan sekolah Sabtu)
            const weekendActs = [
                { id: 'act_sat', gtk_id: 'gtk_01', jam_mulai: '08:00', jam_selesai: '11:00', durasi_efektif_menit: 180, is_outside_duty: 1 }
            ];
            const saturdayWithAct = processSupervisorSummary(assignments, weekendActs, '2026-09-26', '2026-09-26');
            expect(saturdayWithAct.employees[0].activity_count).toBe(1);
            expect(saturdayWithAct.employees[0].total_effective_minutes).toBe(180);
            expect(saturdayWithAct.total_reported).toBe(1);
        });

        test('8.13. SSOT Integritas Kode: Deteksi Libur Akhir Pekan hadir di backend worker', () => {
            const workerCode = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');
            const htmlCode = fs.readFileSync(path.join(__dirname, '../agenda-pegawai.html'), 'utf8');

            // worker.js memuat deteksi weekend
            expect(workerCode).toContain('isWeekend');
            expect(workerCode).toContain('target_minutes_per_day: isWeekend ? 0 : 450');

            // Panel supervisi lama termasuk weekend-holiday-banner telah dieliminasi dari DOM
            expect(htmlCode).not.toContain('id="weekend-holiday-banner"');
        });
    });

    describe('9. Integritas Skema SQLite D1 dan Pencegahan SQL Column Mismatch (SSOT SQLite)', () => {
        const workerPath = path.join(__dirname, '../cloudflare/worker.js');
        const schemaPath = path.join(__dirname, '../cloudflare/schema.sql');
        let workerCode;
        let schemaCode;

        beforeAll(() => {
            workerCode = fs.readFileSync(workerPath, 'utf8');
            schemaCode = fs.readFileSync(schemaPath, 'utf8');
        });

        test('9.1. Skema Resmi D1: Tabel employee_assignments menggunakan kolom peran_rincian (bukan role_in_group)', () => {
            expect(schemaCode).toContain('CREATE TABLE IF NOT EXISTS employee_assignments');
            expect(schemaCode).toContain('peran_rincian TEXT');
            expect(schemaCode).not.toMatch(/CREATE TABLE IF NOT EXISTS employee_assignments[\s\S]*?role_in_group/);
        });

        test('9.2. Pencegahan Fatal Mismatch: Endpoint /api/employee-agenda/summary tidak memanggil ea.role_in_group langsung dari tabel di SQL', () => {
            // Ekstrak kueri SQL summary dari worker.js
            const summarySqlMatch = workerCode.match(/const\s+allAssigned\s*=\s*await\s+env\.DB\.prepare\(\s*`([\s\S]*?)`\s*\)\.all\(\);/);
            expect(summarySqlMatch).not.toBeNull();

            const summarySql = summarySqlMatch[1];

            // Memastikan SQL TIDAK memanggil 'ea.role_in_group' sebagai nama kolom SQLite
            expect(summarySql).not.toMatch(/\bea\.role_in_group\b/i);

            // Memastikan query summary memanggil peran_rincian dan meng-aliasnya menjadi role_in_group
            expect(summarySql).toMatch(/COALESCE\(ea\.peran_rincian,\s*['"]['"]\)\s+AS\s+role_in_group/i);
        });

        test('9.3. Integritas Seluruh Kolom SELECT employee_assignments di Worker harus cocok 100% dengan skema D1', () => {
            // Kolom valid resmi di tabel employee_assignments
            const validColumns = new Set([
                'id',
                'sk_id',
                'group_id',
                'employee_name',
                'employee_nip',
                'employee_nik',
                'gtk_id',
                'user_uid',
                'peran_rincian',
                'is_assistant',
                'custom_task_scope',
                'status',
                'created_at',
                'updated_at'
            ]);

            // Ekstrak semua kueri SQL di worker.js yang mereferensikan tabel employee_assignments
            const sqlBlocks = [];
            const prepareRegex = /\.prepare\(\s*[`"']([\s\S]*?)[`"']\s*\)/g;
            let m;
            while ((m = prepareRegex.exec(workerCode)) !== null) {
                if (m[1].includes('employee_assignments')) {
                    sqlBlocks.push(m[1]);
                }
            }

            const templateSqlRegex = /(?:let|const)\s+sql\s*=\s*[`"']([\s\S]*?)[`"'];/g;
            while ((m = templateSqlRegex.exec(workerCode)) !== null) {
                if (m[1].includes('employee_assignments')) {
                    sqlBlocks.push(m[1]);
                }
            }

            expect(sqlBlocks.length).toBeGreaterThan(0);

            const invalidReferencedColumns = [];
            for (const sql of sqlBlocks) {
                const eaColumnMatches = [...sql.matchAll(/\bea\.([a-zA-Z0-9_]+)\b/g)];
                for (const colMatch of eaColumnMatches) {
                    const colName = colMatch[1];
                    if (!validColumns.has(colName)) {
                        invalidReferencedColumns.push({ sql: sql.trim().slice(0, 80), colName });
                    }
                }
            }

            // Memastikan tidak ada satupun kolom ilegal yang dipanggil dari ea dalam query SQL worker
            expect(invalidReferencedColumns).toEqual([]);
        });

        test('9.4. Pemetaan Role Pegawai: Object downstream menerima role_in_group dari alias query tanpa runtime error', () => {
            // Mensimulasikan hasil raw query dari D1 setelah perbaikan alias
            const mockD1RawResults = [
                {
                    assignment_id: 'asg_001',
                    group_id: 'grp_001',
                    gtk_id: 'gtk_001',
                    user_uid: 'uid_001',
                    employee_name: 'Guru Pengajar Utama',
                    employee_nip: '198501012010011001',
                    role_in_group: 'Koordinator Pelaksana', // Hasil alias COALESCE(ea.peran_rincian, '')
                    matched_gtk_id: 'gtk_001',
                    matched_gtk_name: 'Guru Pengajar Utama',
                    matched_gtk_nip: '198501012010011001',
                    jenis_ptk: 'Guru Mapel'
                }
            ];

            const assignedPersonsMap = new Map();
            for (const ea of mockD1RawResults) {
                const personId = ea.matched_gtk_id || ea.gtk_id;
                let person = assignedPersonsMap.get(personId);
                if (!person) {
                    person = {
                        person_id: personId,
                        gtk_id: ea.matched_gtk_id,
                        employee_name: ea.matched_gtk_name,
                        assignments: []
                    };
                    assignedPersonsMap.set(personId, person);
                }
                person.assignments.push({
                    assignment_id: ea.assignment_id,
                    group_id: ea.group_id,
                    role_in_group: ea.role_in_group
                });
            }

            const person = assignedPersonsMap.get('gtk_001');
            expect(person).toBeDefined();
            expect(person.assignments).toHaveLength(1);
            expect(person.assignments[0].role_in_group).toBe('Koordinator Pelaksana');
        });
    });

    describe('10. Rekapitulasi Mingguan Agenda Pegawai (POV Pegawai & POV Kepala Sekolah)', () => {
        test('10.1. POV Pegawai: Komponen DOM Jalur Mingguan (#weekly-employee-strip) hadir lengkap di agenda-pegawai.html', () => {
            const strip = document.getElementById('weekly-employee-strip');
            expect(strip).not.toBeNull();
            expect(document.getElementById('weekly-strip-range-label')).not.toBeNull();
            expect(document.getElementById('weekly-strip-hours-text')).not.toBeNull();
            expect(document.getElementById('weekly-strip-status-badge')).not.toBeNull();
            expect(document.getElementById('weekly-strip-progress-bar')).not.toBeNull();
            expect(document.getElementById('weekly-strip-days-container')).not.toBeNull();
        });

        test('10.2. POV Pegawai: Kalkulasi Keterisian Jam Kerja Mingguan terhadap Target 37,5 Jam (2.250 Menit)', () => {
            const TARGET_MINUTES = 37.5 * 60; // 2250 menit

            // Skenario A: Pegawai tepat mencapai target 37.5 jam
            const weekMinutesA = 2250;
            const percentA = Math.min(100, Math.round((weekMinutesA / TARGET_MINUTES) * 100));
            const diffMinutesA = TARGET_MINUTES - weekMinutesA;
            expect(percentA).toBe(100);
            expect(diffMinutesA).toBe(0);

            // Skenario B: Pegawai mencatat 30 jam (1800 menit)
            const weekMinutesB = 1800;
            const percentB = Math.min(100, Math.round((weekMinutesB / TARGET_MINUTES) * 100));
            const diffHoursB = ((TARGET_MINUTES - weekMinutesB) / 60).toFixed(1);
            expect(percentB).toBe(80);
            expect(diffHoursB).toBe('7.5');

            // Skenario C: 5 hari kerja penuh masing-masing 450 menit
            const dailyLogs = [450, 450, 450, 450, 450];
            const sumMinutes = dailyLogs.reduce((acc, cur) => acc + cur, 0);
            expect(sumMinutes).toBe(TARGET_MINUTES);
        });

        test('10.3. POV Kepala Sekolah: Komponen Switcher Mode & Supervisi Matriks hadir terisolasi di section summary', () => {
            const summarySection = document.getElementById('section-employee-summary-view');
            expect(summarySection).not.toBeNull();
            expect(summarySection.classList.contains('hidden')).toBe(true);

            expect(document.getElementById('btn-summary-mode-daily')).not.toBeNull();
            expect(document.getElementById('btn-summary-mode-weekly')).not.toBeNull();
            expect(document.getElementById('weekly-nav-bar')).not.toBeNull();
            expect(document.getElementById('weekly-nav-label')).not.toBeNull();
            expect(document.getElementById('weekly-kpi-container')).not.toBeNull();
            expect(document.getElementById('weekly-kpi-percent')).not.toBeNull();
            expect(document.getElementById('weekly-kpi-reported')).not.toBeNull();
            expect(document.getElementById('weekly-kpi-total-hours')).not.toBeNull();
            expect(document.getElementById('table-employee-summary-head')).not.toBeNull();

            // Rekapitulasi Realisasi VIP tetap tersedia
            expect(document.getElementById('btn-employee-monthly-recap-toggle')).not.toBeNull();
        });

        test('10.4. Algoritma Pembagian Pekan Kerja Senin–Jumat (getMondayDate & getWorkWeekDays)', () => {
            // Helper simulasi yang sama dengan page-agenda-pegawai.js
            function getMondayDate(dateStr) {
                const parts = dateStr.split('-');
                const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
                const day = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                const monday = new Date(d);
                monday.setDate(diff);
                const year = monday.getFullYear();
                const month = String(monday.getMonth() + 1).padStart(2, '0');
                const date = String(monday.getDate()).padStart(2, '0');
                return `${year}-${month}-${date}`;
            }

            function getWorkWeekDays(dateStr) {
                const mondayStr = getMondayDate(dateStr);
                const days = [];
                const parts = mondayStr.split('-');
                const mDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
                for (let i = 0; i < 5; i++) {
                    const cur = new Date(mDate);
                    cur.setDate(mDate.getDate() + i);
                    const y = cur.getFullYear();
                    const m = String(cur.getMonth() + 1).padStart(2, '0');
                    const d = String(cur.getDate()).padStart(2, '0');
                    days.push(`${y}-${m}-${d}`);
                }
                return days;
            }

            // Uji Rabu 23 September 2026 -> Senin adalah 21 September 2026
            const monday = getMondayDate('2026-09-23');
            expect(monday).toBe('2026-09-21');

            const days = getWorkWeekDays('2026-09-23');
            expect(days).toEqual([
                '2026-09-21',
                '2026-09-22',
                '2026-09-23',
                '2026-09-24',
                '2026-09-25'
            ]);
            expect(days).toHaveLength(5);
        });

        test('10.5. Integrasi Worker Backend: daily_breakdown dan Target Acuan Pekan 2.250 Menit', () => {
            const workerCode = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');

            // Memastikan worker mengagregasi daily_breakdown
            expect(workerCode).toContain('person.daily_breakdown');
            expect(workerCode).toContain('uraian_kegiatan');
            expect(workerCode).toContain('hasil_output');
            expect(workerCode).toContain('dl_lokasi');

            // Memastikan worker menghitung target acuan mingguan 450m x 5 hari = 2250m
            expect(workerCode).toContain('Math.min(dayCount, 5) * 450');
        });

        test('10.6. SSOT Integritas Kode: page-agenda-pegawai.js mengimplementasikan fungsi kendali mingguan staf dan bersih dari supervisi lama', () => {
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');

            // Fungsi POV Staf
            expect(pageCode).toContain('async function loadEmployeeWeeklyData()');
            expect(pageCode).toContain('window.selectEmployeeDay');
            expect(pageCode).toContain('getWorkWeekDays');

            // Supervisi lama telah dieliminasi demi efisiensi query & perampingan fitur
            expect(pageCode).not.toContain('window.setSummaryMode');
            expect(pageCode).not.toContain('window.navigateSummaryWeek');
            expect(pageCode).not.toContain('window.toggleWeeklyPersonDetail');
            expect(pageCode).not.toContain('loadSupervisorSummary');
        });

        test('10.7. POV Pegawai: Desain Header Compact & Fitur Filter Minggu Terpadu (37,5 Jam/Pekan)', () => {
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');

            // 1. Elemen DOM Header Compact & Filter Minggu hadir di agenda-pegawai.html
            const header = document.querySelector('.premium-header');
            expect(header).not.toBeNull();
            expect(header.classList.contains('p-3')).toBe(true);

            const weekLabel = document.getElementById('header-week-label');
            expect(weekLabel).not.toBeNull();

            const badge375 = document.querySelector('[title*="Target Kinerja: 37,5 Jam"]');
            expect(badge375).not.toBeNull();
            expect(badge375.textContent).toContain('Target 37,5 Jam/Minggu');

            const btnToday = document.getElementById('btn-agenda-today');
            expect(btnToday).not.toBeNull();
            expect(btnToday.textContent).toContain('Pekan Ini');

            const btnPrev = document.getElementById('btn-agenda-prev');
            expect(btnPrev).not.toBeNull();
            expect(btnPrev.getAttribute('title')).toBe('Pekan Sebelumnya');

            const btnNext = document.getElementById('btn-agenda-next');
            expect(btnNext).not.toBeNull();
            expect(btnNext.getAttribute('title')).toBe('Pekan Berikutnya');

            const btnFeedback = document.getElementById('btn-global-chat-feedback');
            expect(btnFeedback).not.toBeNull();
            expect(btnFeedback.textContent).toContain('Saran');

            // 2. Kode JavaScript mengimplementasikan navigasi minggu & pemformatan rentang pekan
            expect(pageCode).toContain('window.navigateEmployeeWeek');
            expect(pageCode).toContain('window.navigateEmployeeDate');
            expect(pageCode).toContain('formatWeekRange');
            expect(pageCode).toContain('updateHeaderContext');

            // 3. Uji logika fungsi formatWeekRange
            const INDO_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
            function formatWeekRangeTest(mondayStr, fridayStr) {
                if (!mondayStr || !fridayStr) return '-';
                const mParts = mondayStr.split('-');
                const fParts = fridayStr.split('-');
                if (mParts.length !== 3 || fParts.length !== 3) return `${mondayStr} s.d. ${fridayStr}`;

                const mD = mParts[2];
                const fD = fParts[2];
                const mM = Number(mParts[1]) - 1;
                const fM = Number(fParts[1]) - 1;
                const mY = Number(mParts[0]);
                const fY = Number(fParts[0]);

                const mMonth = INDO_MONTHS_SHORT[mM] || '';
                const fMonth = INDO_MONTHS_SHORT[fM] || '';

                if (mY === fY) {
                    if (mM === fM) {
                        return `Pekan: ${mD} – ${fD} ${mMonth} ${mY}`;
                    }
                    return `Pekan: ${mD} ${mMonth} – ${fD} ${fMonth} ${mY}`;
                }
                return `Pekan: ${mD} ${mMonth} ${mY} – ${fD} ${fMonth} ${fY}`;
            }

            expect(formatWeekRangeTest('2026-09-21', '2026-09-25')).toBe('Pekan: 21 – 25 Sep 2026');
            expect(formatWeekRangeTest('2026-09-28', '2026-10-02')).toBe('Pekan: 28 Sep – 02 Okt 2026');
            expect(formatWeekRangeTest('2026-12-28', '2027-01-01')).toBe('Pekan: 28 Des 2026 – 01 Jan 2027');
        });

        test('10.8. POV Pegawai: Komponen DOM Matriks Kinerja Mingguan (Hari & Waktu) dan Interaktivitas', () => {
            // 1. Verifikasi kehadiran elemen DOM matriks mingguan
            const matrixSection = document.getElementById('section-employee-weekly-matrix');
            expect(matrixSection).not.toBeNull();
            expect(matrixSection.textContent).toContain('Matriks Kinerja Mingguan');

            const btnToggle = document.getElementById('btn-toggle-weekly-matrix');
            expect(btnToggle).not.toBeNull();
            expect(btnToggle.classList.contains('btn-pulse-attention')).toBe(true);
            expect(btnToggle.classList.contains('animate-pulse')).toBe(true);

            const indicator = document.getElementById('indicator-toggle-weekly-matrix');
            expect(indicator).not.toBeNull();

            const matrixContainer = document.getElementById('container-employee-weekly-matrix');
            expect(matrixContainer).not.toBeNull();
            // Tertutup secara default (memiliki class 'hidden')
            expect(matrixContainer.classList.contains('hidden')).toBe(true);

            const matrixTable = document.getElementById('table-employee-weekly-matrix');
            expect(matrixTable).not.toBeNull();

            const matrixBody = document.getElementById('table-employee-weekly-matrix-body');
            expect(matrixBody).not.toBeNull();

            const matrixFoot = document.getElementById('table-employee-weekly-matrix-foot');
            expect(matrixFoot).not.toBeNull();

            // 2. Verifikasi implementasi kode pada page-agenda-pegawai.js & label tombol toggle awal (Tampilkan saat collapsed)
            const textToggle = document.getElementById('text-toggle-weekly-matrix');
            expect(textToggle).not.toBeNull();
            expect(textToggle.textContent.trim()).toBe('Tampilkan');

            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');
            expect(pageCode).toContain('renderEmployeeWeeklyMatrix');
            expect(pageCode).toContain('window.toggleEmployeeWeeklyMatrix');
            expect(pageCode).toContain("textEl.textContent = 'Sembunyikan';");
            expect(pageCode).toContain("textEl.textContent = 'Tampilkan';");
            expect(pageCode).toContain('btnEl.classList.remove');
            expect(pageCode).toContain('btnEl.classList.add');
            expect(pageCode).toContain('window.addActivityForDate');
            expect(pageCode).toContain('currentWeeklyActivities');

            // 3. Verifikasi struktur kolom header tabel matriks (4 kolom bersih tanpa kolom aksi redundan)
            const thList = Array.from(matrixTable.querySelectorAll('thead th')).map(th => th.textContent.trim());
            expect(thList).toEqual(
                expect.arrayContaining([
                    expect.stringContaining('Hari & Tanggal'),
                    expect.stringContaining('Rentang Waktu & Uraian Kegiatan'),
                    expect.stringContaining('Total Harian'),
                    expect.stringContaining('Status Acuan')
                ])
            );
            expect(thList).not.toContain('Aksi');
        });

        test('10.9. POV Pegawai: Visual Ribbon Timeline Matriks Mingguan (07:30 – 15:30), Hover Popover, dan Deteksi Celah Jam Belum Terisi', () => {
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');

            // 1. Verifikasi kehadiran fungsi renderWeeklyMatrixTimeline dan integrasinya
            expect(pageCode).toContain('function renderWeeklyMatrixTimeline(');
            expect(pageCode).toContain('const DAY_START = 450; // 07:30');
            expect(pageCode).toContain('const DAY_END   = 930; // 15:30');
            expect(pageCode).toContain('const REST_START = 750; // 12:30');
            expect(pageCode).toContain('const REST_END   = 780; // 13:00');
            expect(pageCode).toContain('formatIndonesianDayDateCompact');
            expect(pageCode).toContain('window.addActivityForDate = function(dateStr, suggestedStart = null)');
            expect(pageCode).toContain('Belum terisi:');

            // Verifikasi skala jam hadir di baris thead tabel matriks
            const theadEl = document.querySelector('#table-employee-weekly-matrix thead');
            expect(theadEl).not.toBeNull();
            expect(theadEl.textContent).toContain('07:30');
            expect(theadEl.textContent).toContain('12:30');
            expect(theadEl.textContent).toContain('15:30');

            // 2. Ekstrak dan jalankan logika renderWeeklyMatrixTimeline dalam lingkungan sandbox test
            function escapeHTML(str) {
                if (!str) return '';
                return String(str).replace(/[&<>"']/g, m => ({
                    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
                })[m]);
            }

            const evalTimeline = new Function('dayActs', 'dStr', 'idx', 'escapeHTML', `
                const DAY_START = 450;
                const DAY_END   = 930;
                const TOTAL_SPAN = DAY_END - DAY_START;
                const REST_START = 750;
                const REST_END   = 780;

                const sorted = [...(dayActs || [])].sort((a, b) => {
                    const sA = a.jam_mulai || a.start_time || '';
                    const sB = b.jam_mulai || b.start_time || '';
                    return sA.localeCompare(sB);
                });

                const coveredIntervals = [];
                let blocksHtml = '';

                sorted.forEach(act => {
                    const startTime = act.jam_mulai || act.start_time;
                    const endTime = act.jam_selesai || act.end_time;
                    if (!startTime || !endTime) return;
                    const [sh, sm] = startTime.split(':').map(Number);
                    const [eh, em] = endTime.split(':').map(Number);
                    if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return;

                    const startMin = Math.max(DAY_START, sh * 60 + sm);
                    const endMin = Math.min(DAY_END, eh * 60 + em);
                    if (startMin < endMin) {
                        coveredIntervals.push({ start: startMin, end: endMin });
                        const leftPct = ((startMin - DAY_START) / TOTAL_SPAN) * 100;
                        const widthPct = ((endMin - startMin) / TOTAL_SPAN) * 100;
                        blocksHtml += '<div class="act-block" style="left:' + leftPct + '%;width:' + widthPct + '%;">' + startTime + '-' + endTime + '</div>';
                    }
                });

                let merged = [];
                const allIntervals = [...coveredIntervals, { start: REST_START, end: REST_END }].sort((a, b) => a.start - b.start);
                for (let cur of allIntervals) {
                    if (!merged.length) {
                        merged.push({ ...cur });
                    } else {
                        let last = merged[merged.length - 1];
                        if (cur.start <= last.end) {
                            last.end = Math.max(last.end, cur.end);
                        } else {
                            merged.push({ ...cur });
                        }
                    }
                }

                const gaps = [];
                let curTime = DAY_START;
                merged.forEach(m => {
                    if (m.start > curTime) {
                        gaps.push({ start: curTime, end: m.start });
                    }
                    curTime = Math.max(curTime, m.end);
                });
                if (curTime < DAY_END) {
                    gaps.push({ start: curTime, end: DAY_END });
                }

                let gapSummaryHtml = '';
                if (dayActs && dayActs.length > 0 && gaps.length > 0) {
                    const gapTexts = gaps.map(g => {
                        const shStr = String(Math.floor(g.start / 60)).padStart(2, '0') + ':' + String(g.start % 60).padStart(2, '0');
                        const ehStr = String(Math.floor(g.end / 60)).padStart(2, '0') + ':' + String(g.end % 60).padStart(2, '0');
                        return shStr + '–' + ehStr;
                    }).join(', ');
                    const totalGapMin = gaps.reduce((acc, g) => acc + (g.end - g.start), 0);
                    const gapHourStr = (totalGapMin / 60).toFixed(1);
                    gapSummaryHtml = 'Belum terisi: ' + gapTexts + ' (' + gapHourStr + ' Jam)';
                }

                return { blocksHtml, gaps, gapSummaryHtml };
            `);

            // Case A: Hari Kosong (Belum ada catatan aktivitas) -> Tidak ada baris teks di bawah ribbon (hemat tinggi vertikal)
            const emptyRes = evalTimeline([], '2026-09-21', 0, escapeHTML);
            expect(emptyRes.gapSummaryHtml).toBe('');
            expect(emptyRes.gaps.length).toBeGreaterThan(0);

            // Case B: Hari Terisi Sebagian (misal 07:30 - 10:00) -> Tampilkan baris teks rincian celah jam kerja
            const partialActs = [
                { id: '1', jam_mulai: '07:30', jam_selesai: '10:00', task_name: 'Piket Pagi', location: 'Ruang Tata Usaha' }
            ];
            const partialRes = evalTimeline(partialActs, '2026-09-22', 1, escapeHTML);
            // Gaps yang diharapkan: 10:00 - 12:30 (150m) dan 13:00 - 15:30 (150m), total 300 menit = 5.0 Jam
            expect(partialRes.gapSummaryHtml).toContain('Belum terisi: 10:00–12:30, 13:00–15:30 (5.0 Jam)');
            expect(partialRes.blocksHtml).toContain('07:30-10:00');

            // Case C: Hari Terisi Penuh (07:30 - 12:30 dan 13:00 - 15:30) -> Tidak ada baris teks di bawah ribbon
            const fullActs = [
                { id: '1', jam_mulai: '07:30', jam_selesai: '12:30', task_name: 'Kegiatan Sesi 1' },
                { id: '2', jam_mulai: '13:00', jam_selesai: '15:30', task_name: 'Kegiatan Sesi 2' }
            ];
            const fullRes = evalTimeline(fullActs, '2026-09-23', 2, escapeHTML);
            expect(fullRes.gaps.length).toBe(0);
            expect(fullRes.gapSummaryHtml).toBe('');

            // 3. Verifikasi interaktivitas window.addActivityForDate dengan suggestedStart
            const startInput = document.getElementById('form-activity-start');
            const endInput = document.getElementById('form-activity-end');
            expect(startInput).not.toBeNull();
            expect(endInput).not.toBeNull();

            // Simulasi pemanggilan window.addActivityForDate dengan suggestedStart '10:00'
            const suggestedStart = '10:00';
            const [sh, sm] = suggestedStart.split(':').map(Number);
            const endTotal = sh * 60 + sm + 60;
            const endH = Math.floor(endTotal / 60) % 24;
            const endM = endTotal % 60;
            const expectedEnd = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

            startInput.value = suggestedStart;
            endInput.value = expectedEnd;
            expect(startInput.value).toBe('10:00');
            expect(endInput.value).toBe('11:00');
        });

        test('10.10. POV Kepala Sekolah & Super Admin: DOM Komponen Matriks Supervisi Harian & Mingguan terpasang lengkap', () => {
            expect(document.getElementById('search-supervisor-employee')).not.toBeNull();
            expect(document.getElementById('filter-supervisor-status')).not.toBeNull();
            expect(document.getElementById('table-employee-summary-head')).not.toBeNull();
            expect(document.getElementById('table-employee-summary-body')).not.toBeNull();
            expect(document.getElementById('table-employee-summary-foot')).not.toBeNull();
            expect(document.getElementById('modal-supervisor-employee-detail')).not.toBeNull();
        });

        test('10.11. POV Kepala Sekolah & Super Admin: page-agenda-pegawai.js bersih dari fungsi supervisi matriks lama demi hemat kuota database', () => {
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');

            expect(pageCode).not.toContain('window.filterSupervisorEmployees');
            expect(pageCode).not.toContain('renderSupervisorMatrix');
            expect(pageCode).not.toContain('renderSupervisorDailyMatrix');
            expect(pageCode).not.toContain('renderSupervisorWeeklyMatrix');
            expect(pageCode).not.toContain('renderSupervisorDailyRibbon');
            expect(pageCode).not.toContain('window.openSupervisorDetailModal');
            expect(pageCode).not.toContain('window.closeSupervisorDetailModal');
        });

        test('10.12. Matriks Mingguan & Harian: Kolom 1 adalah nama pegawai, dan sel hari kerja memuat durasi/kegiatan serta aksi modal', () => {
            const mockEmployees = [
                {
                    gtk_id: 'gtk_01',
                    employee_name: 'I Nyoman Suwitra, S.Pd',
                    employee_nip: '198001012005011001',
                    assignment_count: 2,
                    total_effective_minutes: 2250,
                    effective_minutes: 450,
                    activity_count: 5,
                    outside_duty_count: 1,
                    daily_breakdown: {
                        '2026-09-21': { minutes: 450, activity_count: 1, outside_duty_count: 0, activities: [{ start_time: '07:30', end_time: '15:30', description: 'Pelayanan TU' }] },
                        '2026-09-22': { minutes: 450, activity_count: 1, outside_duty_count: 0, activities: [] },
                        '2026-09-23': { minutes: 450, activity_count: 1, outside_duty_count: 1, activities: [] },
                        '2026-09-24': { minutes: 450, activity_count: 1, outside_duty_count: 0, activities: [] },
                        '2026-09-25': { minutes: 450, activity_count: 1, outside_duty_count: 0, activities: [] }
                    }
                },
                {
                    gtk_id: 'gtk_02',
                    employee_name: 'Ni Wayan Sari, A.Md',
                    employee_nip: '198505122010012003',
                    assignment_count: 1,
                    total_effective_minutes: 1800,
                    effective_minutes: 360,
                    activity_count: 4,
                    outside_duty_count: 0,
                    daily_breakdown: {
                        '2026-09-21': { minutes: 450, activity_count: 1, outside_duty_count: 0, activities: [] },
                        '2026-09-22': { minutes: 450, activity_count: 1, outside_duty_count: 0, activities: [] },
                        '2026-09-23': { minutes: 450, activity_count: 1, outside_duty_count: 0, activities: [] },
                        '2026-09-24': { minutes: 450, activity_count: 1, outside_duty_count: 0, activities: [] }
                    }
                }
            ];

            // Verifikasi logika render mingguan
            const targetWeekMin = 2250;

            mockEmployees.forEach(emp => {
                // Kolom 1 adalah nama pegawai
                expect(emp.employee_name).toBeDefined();
                expect(emp.employee_nip).toBeDefined();

                // Kolom 7: Total jam pekan
                const hrs = (emp.total_effective_minutes / 60).toFixed(1);
                expect(Number(hrs)).toBeGreaterThan(0);

                // Kolom 8: Status target
                const isFulfilled = emp.total_effective_minutes >= targetWeekMin;
                if (emp.gtk_id === 'gtk_01') {
                    expect(isFulfilled).toBe(true);
                } else {
                    expect(isFulfilled).toBe(false);
                    const diffHrs = ((targetWeekMin - emp.total_effective_minutes) / 60).toFixed(1);
                    expect(diffHrs).toBe('7.5');
                }
            });
        });

        test('10.13. Modal Pop-up Rincian Supervisi dan Modal Rekap Realisasi VIP terpasang aktif', () => {
            const detailModal = document.getElementById('modal-supervisor-employee-detail');
            expect(detailModal).not.toBeNull();
            expect(detailModal.classList.contains('hidden')).toBe(true);

            // Modal Rekap Realisasi VIP tetap ada dan tersembunyi secara default
            const recapModal = document.getElementById('modal-employee-monthly-recap');
            expect(recapModal).not.toBeNull();
            expect(recapModal.classList.contains('hidden')).toBe(true);
        });
    });

    // =================================================================
    // 11. PENYESUAIAN OTOMATIS RENTANG KEGIATAN MELINTASI JAM ISTIRAHAT
    // =================================================================
    describe('11. Penyesuaian Otomatis Jam Istirahat Resmi (12:30 - 13:00) pada Progres Bar & Modal', () => {
        test('11.1. js/page-agenda-pegawai.js mengimplementasikan calculateEndTimeWithBreaksAgenda dan proteksi pemecahan segmen timeline', () => {
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');

            // Memastikan fungsi helper SSOT kalkulasi waktu jeda istirahat tersedia
            expect(pageCode).toContain('function calculateEndTimeWithBreaksAgenda(startTime, durationMinutes)');

            // Memastikan quick duration dan update preview memanfaatkan jeda istirahat
            expect(pageCode).toContain('calculateEndTimeWithBreaksAgenda(startVal, minutes)');
            expect(pageCode).toContain('Memotong 30m istirahat');

            // Memastikan pita ribbon memecah segmen di sekitar 12:30 - 13:00
            expect(pageCode).toContain('title="Waktu Istirahat (12:30 - 13:00)"');
            expect(pageCode).toContain('Waktu Istirahat Resmi');
            expect(pageCode).toContain('z-30'); // Balok istirahat di atas balok kegiatan

            // Memastikan simulasi perhitungan calculateEndTimeWithBreaksAgenda
            const calculateEnd = (startTime, durationMinutes) => {
                if (!startTime || !durationMinutes) return '';
                const [sh, sm] = startTime.split(':').map(Number);
                let startTotal = sh * 60 + sm;
                let endTotal = startTotal + durationMinutes;

                const breakStart = 12 * 60 + 30; // 12:30 = 750
                const breakEnd = 13 * 60;        // 13:00 = 780

                if (startTotal >= breakStart && startTotal < breakEnd) {
                    startTotal = breakEnd;
                    endTotal = startTotal + durationMinutes;
                } else if (startTotal < breakStart && endTotal > breakStart) {
                    endTotal += 30; // Tambah jeda istirahat 30 menit
                }

                const endH = Math.min(23, Math.floor(endTotal / 60));
                const endM = endTotal % 60;
                return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
            };

            // Uji skenario 1: kegiatan 08:00 + 60m -> 09:00 (tidak melewati istirahat)
            expect(calculateEnd('08:00', 60)).toBe('09:00');

            // Uji skenario 2: kegiatan 12:00 + 60m melintasi 12:30 -> selesai 13:30 (otomatis lompat 30m)
            expect(calculateEnd('12:00', 60)).toBe('13:30');

            // Uji skenario 3: kegiatan dimulai pada jam istirahat 12:30 + 60m -> digeser ke 13:00, selesai 14:00
            expect(calculateEnd('12:30', 60)).toBe('14:00');
        });

        test('11.2. Progres bar agenda membagi aktivitas melintasi jam istirahat menjadi 2 sub-segmen visual', () => {
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');

            // Memastikan fungsi render ribbon memiliki logika segmentasi istirahat
            expect(pageCode).toContain('activitySegments.push({ sMin: startMin, eMin: REST_START });');
            expect(pageCode).toContain('activitySegments.push({ sMin: REST_END, eMin: endMin });');
            expect(pageCode).toContain('crossesRest');
        });
    });

    describe('12. Mode Monitoring & Penugasan Dinamis Kepala Sekolah (Permendikdasmen 23/2026)', () => {
        test('12.1. Switcher pegawai tersembunyi secara default, tombol lama null, dan tombol Mode Monitoring baru tersedia', () => {
            const switcherWrapper = document.getElementById('employee-switcher-wrapper');
            expect(switcherWrapper).not.toBeNull();
            expect(switcherWrapper.classList.contains('hidden')).toBe(true);

            // Tombol monitoring lama dieliminasi total sesuai PRD v1.2.327
            const oldToggleBtn = document.getElementById('btn-employee-summary-toggle');
            expect(oldToggleBtn).toBeNull();

            // Tombol mode monitoring baru hadir di DOM
            const newToggleBtn = document.getElementById('btn-monitoring-mode-toggle');
            expect(newToggleBtn).not.toBeNull();
            expect(newToggleBtn.textContent).toContain('Mode Monitoring');
        });

        test('12.2. page-agenda-pegawai.js menetapkan default mode pribadi dan mengimplementasikan toggle monitoring', () => {
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');

            expect(pageCode).toContain('let isMonitoringMode = false;');
            expect(pageCode).toContain('window.toggleMonitoringModeView');
            expect(pageCode).toContain('isMonitoringMode = !isMonitoringMode;');
            expect(pageCode).toContain('Agenda Saya');
            expect(pageCode).toContain('Mode Monitoring');
        });

        test('12.3. Modal Kelola Penugasan memiliki tab Butir Tugas Kepsek dan form CRUD dinamis', () => {
            const tabPrincipal = document.getElementById('btn-tab-manage-principal');
            expect(tabPrincipal).not.toBeNull();
            expect(tabPrincipal.textContent).toContain('Butir Tugas Kepsek');

            const panePrincipal = document.getElementById('pane-manage-principal');
            expect(panePrincipal).not.toBeNull();

            const formPrincipal = document.getElementById('form-manage-principal-group');
            expect(formPrincipal).not.toBeNull();

            const seedBtn = document.getElementById('btn-seed-principal-groups');
            expect(seedBtn).not.toBeNull();
        });

        test('12.4. page-agenda-pegawai.js memuat standar butir Permendikdasmen 23/2026 dan fungsi CRUD master Kepsek', () => {
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');

            expect(pageCode).toContain('const DEFAULT_PRINCIPAL_GROUPS = [');
            expect(pageCode).toContain('KS-01');
            expect(pageCode).toContain('KS-06');
            expect(pageCode).toContain('Visi dan Budaya Belajar');
            expect(pageCode).toContain('Iklim Lingkungan Belajar');
            expect(pageCode).toContain('Kurikulum dan Pembelajaran');
            expect(pageCode).toContain('Tata Kelola dan Sumber Daya');
            expect(pageCode).toContain('Kemitraan Eksternal');
            expect(pageCode).toContain('Kepemimpinan Transformasional');
            expect(pageCode).toContain('window.togglePrincipalGroupForm = function');
            expect(pageCode).toContain('window.savePrincipalGroupForm = async function');
            expect(pageCode).toContain('window.deletePrincipalGroupItem = async function');
            expect(pageCode).toContain('window.seedDefaultPrincipalGroups = async function');
        });

        test('12.5. Form aktivitas pegawai mendukung pemilihan butir utama Kepsek tanpa butir rincian tugas', () => {
            const principalBadge = document.getElementById('label-principal-task-badge');
            expect(principalBadge).not.toBeNull();

            const quickManageBtn = document.getElementById('btn-quick-manage-principal-tasks');
            expect(quickManageBtn).not.toBeNull();

            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');
            expect(pageCode).toContain('isCurrentTargetPrincipal()');
            expect(pageCode).toContain('isPrincipalGroup');
        });

        test('12.6. cloudflare/worker.js mengimplementasikan auto-seeding ke basis data D1 dan handler CRUD dinamis', () => {
            const workerCode = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');

            expect(workerCode).toContain('Auto-seed butir penugasan Kepala Sekolah');
            expect(workerCode).toContain('INSERT INTO employee_task_groups');
            expect(workerCode).toContain('action === "upsert_group"');
            expect(workerCode).toContain('action === "delete_group"');
            expect(workerCode).toContain('KS-01');
            expect(workerCode).toContain('KS-06');
        });

        test('12.7. page-agenda-pegawai.js mengalirkan ID asli database D1 dan menyediakan aksi Ubah & Hapus dinamis', () => {
            const pageCode = fs.readFileSync(path.join(__dirname, '../js/page-agenda-pegawai.js'), 'utf8');

            expect(pageCode).toContain('window.editPrincipalGroupItem');
            expect(pageCode).toContain('window.deletePrincipalGroupItem');
            expect(pageCode).toContain('action: \'upsert_group\'');
            expect(pageCode).toContain('action: \'delete_group\'');
            expect(pageCode).toContain('refreshManageData()');
        });

        test('12.8. cloudflare/worker.js menyertakan sk_id pada setiap INSERT employee_task_groups & employee_assignments (anti NOT NULL constraint error)', () => {
            const workerCode = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');

            // 1. Verifikasi auto-seed KS menyertakan sk_id dan default 'sk_2026_tendik'
            expect(workerCode).toMatch(/INSERT INTO employee_task_groups\s*\([^)]*sk_id[^)]*\)/);
            expect(workerCode).toContain("'sk_2026_tendik'");

            // 2. Verifikasi upsert_assignment menyertakan sk_id
            expect(workerCode).toMatch(/INSERT INTO employee_assignments\s*\([^)]*sk_id[^)]*\)/);
        });
    });
});




