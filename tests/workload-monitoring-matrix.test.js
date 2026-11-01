/**
 * tests/workload-monitoring-matrix.test.js
 * Suite Pengujian Unit Jest untuk Fitur Monitoring & Supervisi Kepala Sekolah
 * Menguji:
 * 1. Keberadaan elemen DOM (Compact Stat Chips Bar, Segmented Mode Switch, 3 Kontainer Tampilan)
 * 2. Adaptasi Alur Persetujuan (Mode Mandiri vs Pengawasan Formal Kepsek)
 * 3. Logika Navigasi Guru dan Kalkulasi Balok Gantt (07:30 - 15:30)
 */

const fs = require('fs');
const path = require('path');

describe('Monitoring & Supervisi Beban Kerja (Kepala Sekolah)', () => {
    let htmlContent;
    let jsContent;
    let workerContent;

    beforeAll(() => {
        const htmlPath = path.resolve(__dirname, '../e-kinerja.html');
        htmlContent = fs.readFileSync(htmlPath, 'utf8');

        const jsPath = path.resolve(__dirname, '../js/page-monitoring-beban-kerja.js');
        jsContent = fs.readFileSync(jsPath, 'utf8');

        const workerPath = path.resolve(__dirname, '../cloudflare/worker.js');
        workerContent = fs.readFileSync(workerPath, 'utf8');
    });

    test('1. DOM e-kinerja.html memiliki Compact Stat Chips Bar (Above-The-Fold)', () => {
        expect(htmlContent).toContain('id="kpi-mon-total-teachers"');
        expect(htmlContent).toContain('id="kpi-mon-submitted-count"');
        expect(htmlContent).toContain('id="kpi-mon-avg-planned"');
        expect(htmlContent).toContain('id="kpi-mon-avg-actual"');
        expect(htmlContent).toContain('id="kpi-mon-needs-action"');
    });

    test('2. DOM e-kinerja.html memiliki Segmented Mode Switch dan 3 Kontainer Tampilan', () => {
        // Saklar 3 Mode
        expect(htmlContent).toContain('id="btn-mon-view-table"');
        expect(htmlContent).toContain('id="btn-mon-view-matrix"');
        expect(htmlContent).toContain('id="btn-mon-view-detail"');

        // 3 Kontainer Tampilan
        expect(htmlContent).toContain('id="monitoring-table-view-container"');
        expect(htmlContent).toContain('id="monitoring-matrix-view-container"');
        expect(htmlContent).toContain('id="monitoring-detail-view-container"');

        // Komponen Matriks Sekolah
        expect(htmlContent).toContain('id="monitoring-school-matrix-body"');

        // Komponen Detail Supervisi Guru
        expect(htmlContent).toContain('id="mon-detail-avatar"');
        expect(htmlContent).toContain('id="mon-detail-teacher-name"');
        expect(htmlContent).toContain('id="mon-detail-plan-badge"');
        expect(htmlContent).toContain('id="mon-detail-policy-badge"');
        expect(htmlContent).toContain('id="mon-detail-teacher-select"');
        expect(htmlContent).toContain('id="btn-mon-detail-gantt"');
        expect(htmlContent).toContain('id="btn-mon-detail-focus"');
        expect(htmlContent).toContain('id="mon-detail-approval-actions"');
        expect(htmlContent).toContain('id="mon-detail-gantt-container"');
        expect(htmlContent).toContain('id="mon-detail-focus-container"');
        expect(htmlContent).toContain('id="mon-focus-day-tabs"');
        expect(htmlContent).toContain('id="mon-focus-cards-list"');
    });

    test('3. Script JS monitoring mendaftarkan seluruh fungsi supervisi ke window', () => {
        expect(jsContent).toContain('window.monitoringSwitchViewMode = switchMonitoringViewMode');
        expect(jsContent).toContain('window.monitoringOpenTeacherSupervisionDetail = openTeacherSupervisionDetail');
        expect(jsContent).toContain('window.monitoringBackToOverview = backToOverview');
        expect(jsContent).toContain('window.monitoringNavDetailTeacher = navDetailTeacher');
        expect(jsContent).toContain('window.monitoringOnSelectTeacherChange = onSelectTeacherChange');
        expect(jsContent).toContain('window.monitoringToggleDetailView = toggleDetailView');
        expect(jsContent).toContain('window.monitoringSetFocusDay = setFocusDay');
        expect(jsContent).toContain('window.monitoringQuickApprovePlan = quickApprovePlan');
        expect(jsContent).toContain('window.monitoringOpenRevisionModal = openRevisionModal');
        expect(jsContent).toContain('window.monitoringQuickVerifySingleLog = quickVerifySingleLog');
    });

    test('4. Nama guru dan tombol aksi di tabel memanggil supervisi baru', () => {
        expect(jsContent).toContain("onclick=\"window.monitoringOpenTeacherSupervisionDetail('${t.teacher_id}')\"");
    });

    test('5. Adaptasi alur persetujuan kebijakan diimplementasikan dengan benar', () => {
        // Mode Mandiri menyembunyikan tombol approval rencana dan menampilkan badge mandiri
        expect(jsContent).toContain("policyBadgeEl.textContent = '⚡ Mode Mandiri (Otomatis Sah)'");
        expect(jsContent).toContain("approvalActionsEl.classList.add('hidden')");
        // Log mandiri tidak membutuhkan tombol verifikasi
        expect(jsContent).toContain("Terverifikasi Otomatis (Mandiri)");
        // Mode Mandiri tidak menampilkan sub-metrik guru mengajukan rencana
        expect(jsContent).toContain("elSubmitted.classList.add('hidden')");
    });

    test('6. Kalkulasi balok Gantt menggunakan konstanta rentang waktu resmi (07:30 - 15:30)', () => {
        expect(jsContent).toContain('const GANTT_START = 7 * 60 + 30');
        expect(jsContent).toContain('const GANTT_END = 15 * 60 + 30');
        expect(jsContent).toContain('const GANTT_TOTAL = GANTT_END - GANTT_START');
        expect(jsContent).toContain('calculateDayTimelineSlots');
    });

    test('7. Filter status adaptif bertransisi antara Mode Formal dan Mode Otomatis Evaluasi Beban Kerja', () => {
        expect(jsContent).toContain('syncFilterStatusDropdown');
        expect(jsContent).toContain('window.monitoringSyncFilterStatusDropdown = syncFilterStatusDropdown');
        // Mode Otomatis / Mandiri memuat filter evaluasi beban kerja
        expect(jsContent).toContain('Semua Guru');
        expect(jsContent).toContain('Sudah Ada Rencana');
        expect(jsContent).toContain('target_not_met');
        expect(jsContent).toContain('target_met');
        // Logika applyFilter mendukung evaluasi beban kerja TARGET 2250 menit
        expect(jsContent).toContain('planned >= TARGET');
        expect(jsContent).toContain('planned < TARGET');
    });

    test('8. Fitur Ekspor XLSX didukung oleh SheetJS dan tombol ekspor berdampingan dengan filter status', () => {
        expect(htmlContent).toContain('src="https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"');
        expect(htmlContent).toContain('onclick="window.monitoringExportXLSX()"');
        expect(jsContent).toContain('exportXLSX');
        expect(jsContent).toContain('window.monitoringExportXLSX = exportXLSX');
        expect(jsContent).toContain('XLSX.utils.json_to_sheet');
        expect(jsContent).toContain('XLSX.writeFile');
    });

    test('9. calculateDayTimelineSlots mengembalikan objek timeline yang iterable dan memiliki fungsi forEach (anti slots.forEach is not a function)', () => {
        const { calculateDayTimelineSlots } = require('./workload-guru-utils.js');
        const daySegments = [
            { id: 'seg_1', start_time: '07:30', end_time: '09:00', planned_minutes: 90, activity_title: 'KBM Fisika', is_teaching: 1 }
        ];

        const timeline = calculateDayTimelineSlots('2026-09-28', daySegments);
        expect(timeline).toBeDefined();
        expect(Array.isArray(timeline.slots)).toBe(true);
        expect(typeof timeline.forEach).toBe('function');

        // Verifikasi forEach langsung pada objek timeline berjalan tanpa error
        const iterated = [];
        timeline.forEach(slot => {
            iterated.push(slot.type);
        });
        expect(iterated).toContain('activity');

        // Verifikasi Symbol.iterator
        const iteratedViaForOf = [];
        for (const slot of timeline) {
            iteratedViaForOf.push(slot.type);
        }
        expect(iteratedViaForOf).toContain('activity');
    });

    test('10. Gantt Timeline di page-monitoring-beban-kerja.js mengekstrak dayTimeline.slots secara resilient dan mendukung obstacle_notes', () => {
        // Memastikan tidak ada pemanggilan mentah slots.forEach yang mengasumsikan return langsung array
        expect(jsContent).toContain('const dayTimeline = calculateDayTimelineSlots(');
        expect(jsContent).toContain('const slots = Array.isArray(dayTimeline?.slots) ? dayTimeline.slots : (Array.isArray(dayTimeline) ? dayTimeline : []);');
        expect(jsContent).toContain('matchingLog.obstacle_notes');
    });

    test('11. Kolom checklist tabel monitoring adaptif (tersembunyi pada mode mandiri, tampil pada mode pengawasan Kepsek)', () => {
        // e-kinerja.html memiliki id th-cb-select-all
        expect(htmlContent).toContain('id="th-cb-select-all"');

        // js/page-monitoring-beban-kerja.js menentukan showCheckboxCol berdasarkan require_log_verification !== 0
        expect(jsContent).toContain('const showCheckboxCol = Boolean(_policy?.require_log_verification !== 0);');
        expect(jsContent).toContain("thCb.classList.toggle('hidden', !showCheckboxCol);");
        expect(jsContent).toContain('if (showCheckboxCol) colSpan += 1;');
        expect(jsContent).toContain("thCbSelectAll.classList.toggle('hidden', !logReq);");
    });

    test('12. e-kinerja.html memuat Legenda Status Rencana & Realisasi (Kepala Sekolah)', () => {
        expect(htmlContent).toContain('id="mon-gantt-legend"');
        expect(htmlContent).toContain('Sudah Terealisasi');
        expect(htmlContent).toContain('Belum Terealisasi');
        expect(htmlContent).toContain('Istirahat');
        expect(htmlContent).toContain('Jam Kosong');
    });

    test('13. Gantt Timeline di js/page-monitoring-beban-kerja.js membedakan warna balok realisasi vs belum realisasi', () => {
        // Balok Terealisasi: solid saturated colors + checkmark + badge Terealisasi
        expect(jsContent).toContain('Terealisasi');
        expect(jsContent).toContain('fa-solid fa-circle-check');

        // Balok Belum Realisasi: dashed amber + clock icon + badge Belum Realisasi
        expect(jsContent).toContain('border-2 border-dashed border-amber-400');
        expect(jsContent).toContain('Belum Realisasi');
        expect(jsContent).toContain('fa-regular fa-clock');
    });

    test('14. Focus View di js/page-monitoring-beban-kerja.js membedakan border kartu kegiatan terealisasi vs belum terealisasi', () => {
        // Kartu terealisasi: emerald border + pill Sudah Terealisasi
        expect(jsContent).toContain('border border-emerald-300');
        expect(jsContent).toContain('Sudah Terealisasi');

        // Kartu belum terealisasi: dashed amber border + pill Belum Terealisasi + pesan Menunggu Laporan
        expect(jsContent).toContain('border-2 border-dashed border-amber-300');
        expect(jsContent).toContain('Belum Terealisasi');
        expect(jsContent).toContain('Menunggu Laporan');
        expect(jsContent).toContain('Rencana kegiatan belum dilaporkan realisasinya oleh guru yang bersangkutan.');
    });

    test('15. Pencocokan log ke rencana mendukung plan_links SSOT sebelum fallback ke judul/catalog', () => {
        expect(jsContent).toContain('const planLinks = _detailWeekData?.plan_links || [];');
        expect(jsContent).toContain('pl.plan_activity_id === segId && pl.work_log_id === l.id');
    });

    test('16. js/page-monitoring-beban-kerja.js mengeksklusi Tenaga Kependidikan, Tendik, dan Keamanan dari monitoring E-Kinerja Guru', () => {
        expect(jsContent).toContain('function isWorkloadTeacher(t)');
        expect(jsContent).toContain('_summaryData = rawList.filter(isWorkloadTeacher);');
        expect(jsContent).toContain("j.includes('tenaga kependidikan')");
        expect(jsContent).toContain("j.includes('tendik')");
        expect(jsContent).toContain("j.includes('keamanan')");

        // Evaluasi logika filter secara fungsional
        const fnStart = jsContent.indexOf('function isWorkloadTeacher');
        const fnEnd = jsContent.indexOf('function setMonitoringLoadingState');
        const evalHelper = new Function(`
            ${jsContent.slice(fnStart, fnEnd)}
            return isWorkloadTeacher;
        `)();

        // Positif Guru
        expect(evalHelper({ name: 'Budi Mulyawan, S.Pd', jenis_ptk: 'Guru', role: 'guru_mapel' })).toBe(true);
        expect(evalHelper({ name: 'I Kadek Suardana, S.Pd', jenis_ptk: 'Guru BK', role: 'guru_bk' })).toBe(true);
        expect(evalHelper({ name: 'Guru Pendidik', jenis_ptk: 'Pendidik', role: 'guru_mapel' })).toBe(true);

        // Negatif Tenaga Kependidikan / Tendik / Keamanan
        expect(evalHelper({ name: 'I Gede Putu Yudiasa', jenis_ptk: 'Tenaga Kependidikan', role: 'guru_mapel' })).toBe(false);
        expect(evalHelper({ name: 'I Gede Wiratama', jenis_ptk: 'Tenaga Kependidikan', role: 'guru_mapel' })).toBe(false);
        expect(evalHelper({ name: 'I Kadek Betit Pranata Suma, S.H', jenis_ptk: 'Tenaga Kependidikan', role: 'guru_mapel' })).toBe(false);
        expect(evalHelper({ name: 'Satpam Sekolah', jenis_ptk: 'Keamanan', role: 'guru_mapel' })).toBe(false);
        expect(evalHelper({ name: 'Tata Usaha', jenis_ptk: 'Tata Usaha', role: 'staff' })).toBe(false);
        expect(evalHelper({ name: 'Tendik TU', jenis_ptk: 'Tendik', role: 'tendik' })).toBe(false);
        expect(evalHelper({ name: 'I Gede Yudiasa', jenis_ptk: 'PPPK', role: 'guru_mapel' })).toBe(false);
    });

    test('17. cloudflare/worker.js menyaring query GTK agar Tenaga Kependidikan dan non-guru tidak masuk monitoring dan ekspor', () => {
        const workerPath = path.resolve(__dirname, '../cloudflare/worker.js');
        const workerContent = fs.readFileSync(workerPath, 'utf8');

        // Memastikan query monitoring-summary mengeksklusi Tenaga Kependidikan
        expect(workerContent).toContain("g.jenis_ptk NOT LIKE '%Tenaga Kependidikan%'");
        expect(workerContent).toContain("g.jenis_ptk NOT LIKE '%Keamanan%'");
        expect(workerContent).toContain("g.jenis_ptk NOT LIKE '%Tendik%'");
    });

    test('18. Input pencarian nama guru dan filter status diletakkan di tab-monitoring-toolbar berdampingan dengan saklar mode tampilan', () => {
        expect(htmlContent).toContain('id="filter-teacher-search"');
        expect(htmlContent).toContain('id="filter-plan-status"');

        // Memastikan filter-teacher-search dan filter-plan-status berada di dalam tab-monitoring-toolbar berdampingan dengan saklar mode tampilan
        const topToolbarIdx = htmlContent.indexOf('id="tab-monitoring-toolbar"');
        const endTopToolbarIdx = htmlContent.indexOf('id="input-monitoring-week-start"');
        const searchInTopToolbar = htmlContent.slice(topToolbarIdx, endTopToolbarIdx);

        expect(searchInTopToolbar).toContain('id="filter-teacher-search"');
        expect(searchInTopToolbar).toContain('id="filter-plan-status"');
        expect(searchInTopToolbar).toContain('id="btn-mon-view-table"');
        expect(searchInTopToolbar).toContain('id="btn-mon-view-matrix"');

        const searchIdx = htmlContent.indexOf('id="filter-teacher-search"');
        const statusIdx = htmlContent.indexOf('id="filter-plan-status"');
        expect(searchIdx).toBeGreaterThan(-1);
        expect(statusIdx).toBeGreaterThan(-1);
        expect(Math.abs(searchIdx - statusIdx)).toBeLessThan(800);
    });

    test('19. Navigasi guru sebelumnya dan berikutnya disatukan di sisi kiri mengapit nama guru', () => {
        // Tombol navigasi kiri (<) dan kanan (>) memanggil window.monitoringNavDetailTeacher
        expect(htmlContent).toContain("onclick=\"window.monitoringNavDetailTeacher(-1)\"");
        expect(htmlContent).toContain("onclick=\"window.monitoringNavDetailTeacher(1)\"");

        // Memastikan tombol navigasi berada di dekat nama guru (jarak indeks < 300 karakter)
        const nameIdx = htmlContent.indexOf('id="mon-detail-teacher-name"');
        const prevIdx = htmlContent.lastIndexOf("window.monitoringNavDetailTeacher(-1)", nameIdx);
        const nextIdx = htmlContent.indexOf("window.monitoringNavDetailTeacher(1)", nameIdx);

        expect(nameIdx).toBeGreaterThan(-1);
        expect(prevIdx).toBeGreaterThan(-1);
        expect(nextIdx).toBeGreaterThan(-1);
        expect(nameIdx - prevIdx).toBeLessThan(600);
        expect(nextIdx - nameIdx).toBeLessThan(350);

        // Memastikan mon-detail-teacher-select tetap ada di DOM untuk kompatibilitas
        expect(htmlContent).toContain('id="mon-detail-teacher-select"');
    });

    test('20. Kartu realisasi Focus View dan ringkasan monitoring mengekstrak durasi aktual riil dari work_log_segments (anti 0 menit)', () => {
        const workerPath = path.resolve(__dirname, '../cloudflare/worker.js');
        const workerContent = fs.readFileSync(workerPath, 'utf8');

        // 1. Worker GET /api/workload/week memetakan durasi segmen ke objek logs dan teaching_jp ke summary
        expect(workerContent).toContain('logSegDurationMap[ls.work_log_id]');
        expect(workerContent).toContain('l.actual_minutes = logSegDurationMap[l.id]');
        expect(workerContent).toContain('totalTeachingJp');
        expect(workerContent).toContain('teaching_jp: totalTeachingJp');

        // 2. Worker GET /api/workload/monitoring-summary menggunakan logSegmentsMap[t.work_week_id] (bukan l.id)
        expect(workerContent).toContain('const weekLogStats = logSegmentsMap[t.work_week_id] || { total: 0, verified: 0 };');
        expect(workerContent).toContain('const actualMin = weekLogStats.total || 0;');
        expect(workerContent).toContain('teaching_jp: teachingJp');

        // 3. Focus View di page-monitoring-beban-kerja.js mengekstrak actualDuration dari logSegments
        expect(jsContent).toContain('const logSegments = _detailWeekData?.log_segments || [];');
        expect(jsContent).toContain('const matchingLogSegs = logSegments.filter(ls => ls.work_log_id === matchingLog.id);');
        expect(jsContent).toContain('let actualLogDuration = matchingLogSegs.reduce(');
        expect(jsContent).toContain('${actualLogDuration} menit');

        // 4. Gantt View mengekstrak durasi dari log_segments
        expect(jsContent).toContain('const mLogSegs = logSegs.filter(ls => ls.work_log_id === matchingLog.id);');

        // 5. Header KPI Supervisi Guru menghitung teaching_jp
        expect(jsContent).toContain('teachingJp = segs');
        expect(jsContent).toContain('statTeaching.textContent = `${teachingJp || 0} JP`;');
    });

    test('21. Tab Matriks berlabel singkat "Matriks" dan tab Detail Guru tersembunyi sampai guru dipilih', () => {
        // 1. Label tab matrix harus "Matriks", bukan "Matriks Sekolah"
        expect(htmlContent).toContain('id="btn-mon-view-matrix"');
        expect(htmlContent).toMatch(/<button[^>]*id="btn-mon-view-matrix"[^>]*>[\s\S]*?<span>Matriks<\/span>/);
        expect(htmlContent).not.toMatch(/<span>Matriks Sekolah<\/span>/);

        // 2. Tab Detail Guru di HTML wajib memiliki class "hidden" secara default
        const detailBtnMatch = htmlContent.match(/id="btn-mon-view-detail"[^>]*class="([^"]*)"/);
        expect(detailBtnMatch).toBeTruthy();
        expect(detailBtnMatch[1]).toContain('hidden');

        // 3. switchMonitoringViewMode harus menyembunyikan tab detail jika tidak ada guru terpilih
        // Harus ada percabangan _detailTeacherId di blok btnDetail
        expect(jsContent).toContain('if (_detailTeacherId) {');
        expect(jsContent).toContain("btnDetail.className = inactiveBtnCls + ' hidden';");
    });

    test('22. Mode Matriks memiliki tata letak ultra-compact satu baris horizontal terpadu', () => {
        // 1. Terdapat header kolom bersama pada tampilan desktop di renderSchoolMatrixView
        expect(jsContent).toContain('GURU & BEBAN KERJA');
        expect(jsContent).toContain('hidden lg:flex items-center justify-between');

        // 2. Baris guru menggunakan tata letak horizontal ramping (lg:flex-row lg:items-center)
        expect(jsContent).toContain('flex flex-col lg:flex-row lg:items-center justify-between');

        // 3. Grid 5 hari terintegrasi sejajar dalam satu baris dengan cell compact
        expect(jsContent).toContain('flex-1 grid grid-cols-5 gap-1.5');
        expect(jsContent).toContain('px-2 py-1.5 rounded-lg border');

        // 4. Header title di e-kinerja.html menggunakan Matriks Mingguan yang ringkas
        expect(htmlContent).toContain('Matriks Mingguan (Senin s.d. Jumat)');
    });

    test('23. Kolom dan metrik Terverifikasi adaptif (otomatis disembunyikan pada Mode Mandiri Otomatis)', () => {
        // 1. Header tabel memiliki id th-mon-verified
        expect(htmlContent).toContain('id="th-mon-verified"');

        // 2. js/page-monitoring-beban-kerja.js menyembunyikan kolom Terverifikasi saat require_log_verification === 0
        expect(jsContent).toContain('const showVerifiedCol = Boolean(_policy?.require_log_verification !== 0);');
        expect(jsContent).toContain("thVerified.classList.toggle('hidden', !showVerifiedCol);");
        expect(jsContent).toContain('if (showVerifiedCol) colSpan += 1;');
        expect(jsContent).toContain('const verifiedTd = showVerifiedCol');

        // 3. Popup detail guru menyesuaikan grid KPI mini (2 kolom saat mandiri, 3 kolom saat formal)
        expect(jsContent).toContain("const kpiCols = logReq ? 'grid-cols-3' : 'grid-cols-2';");

        // 4. Ekspor XLSX menyesuaikan kolom Terverifikasi hanya saat logReq aktif
        expect(jsContent).toContain("if (logReq) {");
        expect(jsContent).toContain("row['Terverifikasi (Menit)'] = verified;");
    });

    test('24. Mode Tabel berpenampilan ultra-compact dan NIP tidak menambah tinggi baris', () => {
        // 1. thead di e-kinerja.html menggunakan padding ringkas py-2 px-2.5 sm:px-3
        expect(htmlContent).toContain('<th class="py-2 px-2.5 sm:px-3">Nama Guru</th>');

        // 2. Baris tabel td di js/page-monitoring-beban-kerja.js menggunakan padding ringkas py-1.5 px-2.5 sm:px-3
        expect(jsContent).toContain('<td class="py-1.5 px-2.5 sm:px-3">');

        // 3. Nama guru di renderTable tidak lagi merender baris teks NIP terpisah di bawah nama
        expect(jsContent).not.toMatch(/<td class="p-3">[\s\S]*?<div class="text-\[10px\] text-slate-400">\$\{escapeHTML\(t\.nip/);

        // 4. NIP tetap disematkan sebagai tooltip/title pada nama guru
        expect(jsContent).toContain('title="Buka Detail Supervisi${escapeHTML(nipTooltip)}"');
    });

    test('25. Avatar nama guru pada panel supervisi dan matriks menampilkan foto profil guru dengan fallback inisial', () => {
        // 1. Elemen mon-detail-avatar di e-kinerja.html memiliki class overflow-hidden untuk memuat foto
        expect(htmlContent).toMatch(/id="mon-detail-avatar"[^>]*class="[^"]*overflow-hidden[^"]*"/);

        // 2. js/page-monitoring-beban-kerja.js memiliki fungsi renderTeacherDetailAvatar yang merender img foto profil
        expect(jsContent).toContain('function renderTeacherDetailAvatar(avatarEl, teacher)');
        expect(jsContent).toContain('<img src="${escapeHTML(photoUrl)}"');
        expect(jsContent).toContain('onerror="this.onerror=null; this.classList.add(\'hidden\');');

        // 3. Worker cloudflare/worker.js menyertakan kolom foto pada endpoint monitoring-summary dan week
        expect(workerContent).toContain('SELECT g.id, g.name, g.nip, g.nuptk, g.jenis_ptk, g.mapel, g.foto,');
        expect(workerContent).toContain('foto: t.foto || null');
        expect(workerContent).toContain('g.foto AS teacher_foto');
    });

    test('26. Kolom Pemenuhan pada tabel, matriks, supervisi, dan ekspor mengukur realisasi kerja terhadap target 2.250 menit', () => {
        // 1. renderTable menghitung pct dari actual / TARGET * 100
        expect(jsContent).toContain('const pct = Math.min(100, Math.round(actual / TARGET * 100));');
        expect(jsContent).toContain('title="Pemenuhan Realisasi: ${actual.toLocaleString(\'id-ID\')} / ${TARGET.toLocaleString(\'id-ID\')} mnt (${pct}%)"');

        // 2. renderSchoolMatrixView menghitung pct dari actual / TARGET * 100 dan menyematkannya pada realisasi
        expect(jsContent).toMatch(/const\s+pct\s*=\s*(?:TARGET\s*>\s*0\s*\?\s*)?Math\.min\(100,\s*Math\.round\(actual\s*\/\s*(?:TARGET|2250)\s*\*\s*100\)\)/);
        expect(jsContent).toContain('title="Pemenuhan Realisasi Terlaksana (Target 2.250m)"');

        // 3. loadAndRenderTeacherDetail mengupdate statPct dari actual_minutes
        expect(jsContent).toMatch(/Math\.round\(\(teacher\.actual_minutes\s*\|\|\s*0\)\s*\/\s*(?:effTarget|2250)\s*\*\s*100\)/);
        expect(jsContent).toMatch(/Math\.round\(\(s\.actual_minutes\s*\|\|\s*0\)\s*\/\s*(?:effTarget|2250)\s*\*\s*100\)/);

        // 4. exportXLSX menyertakan Pemenuhan Realisasi (%) berbasis actual
        expect(jsContent).toContain("row['Pemenuhan Realisasi (%)'] = `${pct}%`;");

        // 5. Header thead di e-kinerja.html memiliki tooltip pemenuhan realisasi
        expect(htmlContent).toContain('title="Pemenuhan Realisasi terhadap Target Beban Kerja 37,5 Jam (2.250 menit)">Pemenuhan</th>');
    });
});



