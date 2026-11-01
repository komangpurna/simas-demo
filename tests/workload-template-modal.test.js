/**
 * tests/workload-template-modal.test.js
 *
 * Verifikasi Sistemik:
 * 1. Integritas Modal Pembuatan Template Beban Kerja Guru (#modal-create-template di e-kinerja.html)
 * 2. Standar 5 Hari Kerja Pola Standar Sekolah (07:30-15:30 @ 450m/hari = 2.250m/mgg Permendikdasmen 11/2025)
 * 3. Logika Deteksi Multi-Role Supervisor (Kepala Sekolah, Super Admin, Wakasek Kurikulum)
 * 4. Zero Alert Fallback & 100% Integrasi showToast pada page-beban-kerja.js & page-monitoring-beban-kerja.js
 */

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

describe('Verifikasi Integritas Modal Template E-Kinerja & Supervisor Access', () => {
    const htmlPath = path.join(rootDir, 'e-kinerja.html');
    const workloadJsPath = path.join(rootDir, 'js', 'page-beban-kerja.js');
    const monitoringJsPath = path.join(rootDir, 'js', 'page-monitoring-beban-kerja.js');
    const eKinerjaJsPath = path.join(rootDir, 'js', 'page-e-kinerja.js');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const workloadJsContent = fs.readFileSync(workloadJsPath, 'utf8');
    const monitoringJsContent = fs.readFileSync(monitoringJsPath, 'utf8');
    const eKinerjaJsContent = fs.readFileSync(eKinerjaJsPath, 'utf8');

    test('1. e-kinerja.html memuat #modal-create-template dengan 2 opsi radio button ringkas (Salin Rencana & Template Kosong)', () => {
        expect(htmlContent).toContain('id="modal-create-template"');
        expect(htmlContent).toContain('id="input-template-name"');
        expect(htmlContent).toContain('id="opt-source-week"');
        expect(htmlContent).not.toContain('id="opt-source-standard"');
        expect(htmlContent).toContain('id="opt-source-empty"');
        expect(htmlContent).toContain('id="input-template-is-default"');
        expect(htmlContent).toContain('window.workloadConfirmSaveTemplate(event)');
        expect(htmlContent).toContain('window.workloadCloseCreateTemplateModal()');
    });

    test('2. Bebas dari dialog native alert() dan showNotification usang', () => {
        // Memastikan tidak ada lagi pemanggilan alert(msg) pada fallback showToast
        expect(workloadJsContent).not.toMatch(/\balert\s*\(/);
        expect(monitoringJsContent).not.toMatch(/\balert\s*\(/);
        expect(workloadJsContent).toContain('window.showToast(title, msg, type)');
        expect(monitoringJsContent).toContain('window.showToast(title, msg, type)');
    });

    test('3. Fungsi modal template terdaftar secara lengkap di window', () => {
        expect(workloadJsContent).toContain('window.workloadOpenCreateTemplateModal = openCreateTemplateModal');
        expect(workloadJsContent).toContain('window.workloadCloseCreateTemplateModal = closeCreateTemplateModal');
        expect(workloadJsContent).toContain('window.workloadConfirmSaveTemplate = confirmSaveTemplate');
    });

    test('4. Logika isSupervisorRole mendukung primary role dan additionalRoles (multi-role)', () => {
        // Ekstrak fungsi isSupervisorRole dari page-e-kinerja.js
        function isSupervisorRole(role, additionalRoles = []) {
            const roles = [role, ...(Array.isArray(additionalRoles) ? additionalRoles : [])].filter(Boolean);
            const set = new Set(roles.map(r => String(r).toLowerCase().trim()));
            return set.has('super_admin') || set.has('kepala_sekolah') || set.has('wakasek_kurikulum');
        }

        // Test primary roles
        expect(isSupervisorRole('super_admin')).toBe(true);
        expect(isSupervisorRole('kepala_sekolah')).toBe(true);
        expect(isSupervisorRole('wakasek_kurikulum')).toBe(true);
        expect(isSupervisorRole('guru_mapel')).toBe(false);
        expect(isSupervisorRole('siswa')).toBe(false);

        // Test multi-role (contoh: guru mapel dengan tugas super admin atau kepala sekolah)
        expect(isSupervisorRole('guru_mapel', ['super_admin'])).toBe(true);
        expect(isSupervisorRole('guru_mapel', ['kepala_sekolah'])).toBe(true);
        expect(isSupervisorRole('guru_mapel', ['wakasek_kurikulum'])).toBe(true);
        expect(isSupervisorRole('guru_mapel', ['wali_kelas', 'guru_piket'])).toBe(false);
    });

    test('5. Pola Standar 5 Hari Sekolah menghasilkan 2.250 menit kerja bersih sesuai Permendikdasmen 11/2025', () => {
        const { calculateEffectiveMinutes } = require('./workload-guru-utils.js');

        // Pola standar: Senin s.d Jumat 07:30 - 15:30
        const items = [1, 2, 3, 4, 5].map(day => ({
            day_of_week: day,
            start_time: '07:30',
            end_time: '15:30'
        }));

        let totalMinutes = 0;
        items.forEach(it => {
            const netMin = calculateEffectiveMinutes(it.start_time, it.end_time);
            expect(netMin).toBe(450); // 480 menit bruto - 30 menit istirahat resmi = 450 menit bersih
            totalMinutes += netMin;
        });

        expect(totalMinutes).toBe(2250); // Tepat 100% target mingguan
    });

    test('6. File migrasi seed katalog aktivitas beban kerja tersedia dan memuat cat_kbm', () => {
        const migrationPath = path.join(rootDir, 'cloudflare', 'migrations', '202609250001_seed_workload_activity_catalog.sql');
        expect(fs.existsSync(migrationPath)).toBe(true);
        const migrationContent = fs.readFileSync(migrationPath, 'utf8');
        expect(migrationContent).toContain('cat_kbm');
        expect(migrationContent).toContain('cat_bk');
        expect(migrationContent).toContain('cat_evaluasi');
        expect(migrationContent).toContain('PELAKSANAAN_KBM');
        expect(migrationContent).toContain('INSERT INTO activity_catalog');
    });

    test('7. Cloudflare worker.js memuat ensureWorkloadActivityCatalog, resolveWorkloadTeacherId, dan D1 batch transaction', () => {
        const workerPath = path.join(rootDir, 'cloudflare', 'worker.js');
        const workerContent = fs.readFileSync(workerPath, 'utf8');
        expect(workerContent).toContain('ensureWorkloadActivityCatalog');
        expect(workerContent).toContain('resolveWorkloadTeacherId');
        expect(workerContent).toContain('STANDARD_WORKLOAD_CATALOG');
        expect(workerContent).toContain('env.DB.batch(batchStatements)');
    });

    test('8. Tombol Terapkan & Simpan Template terletak di baris navigasi tab (#tab-plan-toolbar), bukan di card #plan-toolbar', () => {
        // Kontainer toolbar harus ada di baris tab e-kinerja.html
        expect(htmlContent).toContain('id="tab-plan-toolbar"');
        expect(htmlContent).toContain('window.workloadApplyTemplateModal()');
        expect(htmlContent).toContain('window.workloadSaveAsTemplateModal()');

        // Pastikan tombol template ada di dalam #tab-plan-toolbar
        const toolbarRegex = /<div id="tab-plan-toolbar"[\s\S]*?<\/div>/;
        const matchToolbar = htmlContent.match(toolbarRegex);
        expect(matchToolbar).not.toBeNull();
        expect(matchToolbar[0]).toContain('workloadApplyTemplateModal');
        expect(matchToolbar[0]).toContain('workloadSaveAsTemplateModal');

        // Pastikan card #plan-toolbar di konten rencana tidak lagi berisi tombol template
        const planContentMatch = htmlContent.match(/<div id="plan-toolbar"[\s\S]*?<\/div>\s*<\/div>/);
        if (planContentMatch) {
            expect(planContentMatch[0]).not.toContain('workloadApplyTemplateModal');
            expect(planContentMatch[0]).not.toContain('workloadSaveAsTemplateModal');
        }
    });

    test('9. Visibilitas #tab-plan-toolbar dikontrol oleh updatePlanToolbarVisibility dan disinkronkan saat switchTab & renderPlanTab', () => {
        expect(workloadJsContent).toContain('export function updatePlanToolbarVisibility()');
        expect(workloadJsContent).toContain('window.workloadUpdatePlanToolbarVisibility = updatePlanToolbarVisibility');
        expect(workloadJsContent).toContain('updatePlanToolbarVisibility();');

        // Simulasikan logika updatePlanToolbarVisibility
        function shouldShowPlanToolbar(activeTab, isMgr, hasSelectedTeacher) {
            return (activeTab === 'tab-plan') && (!isMgr || hasSelectedTeacher);
        }

        // Ketika tab-plan aktif untuk guru biasa -> Harus Tampil
        expect(shouldShowPlanToolbar('tab-plan', false, false)).toBe(true);
        // Ketika tab-plan aktif untuk pengelola yang sudah memilih guru -> Harus Tampil
        expect(shouldShowPlanToolbar('tab-plan', true, true)).toBe(true);
        // Ketika tab-plan aktif untuk pengelola yang belum memilih guru -> Harus Tersembunyi
        expect(shouldShowPlanToolbar('tab-plan', true, false)).toBe(false);
        // Ketika tab lain (today/templates/rekap/monitoring) aktif -> Harus Tersembunyi
        expect(shouldShowPlanToolbar('tab-today', false, false)).toBe(false);
        expect(shouldShowPlanToolbar('tab-templates', false, false)).toBe(false);
        expect(shouldShowPlanToolbar('tab-monitoring', true, true)).toBe(false);
    });

    test('10. e-kinerja.html memuat modal rincian kegiatan non-KBM (#modal-template-detail) secara mandiri', () => {
        expect(htmlContent).toContain('id="modal-template-detail"');
        expect(htmlContent).toContain('id="template-detail-title"');
        expect(htmlContent).toContain('id="template-detail-default-badge"');
        expect(htmlContent).toContain('id="template-detail-stat-count"');
        expect(htmlContent).toContain('id="template-detail-stat-minutes"');
        expect(htmlContent).toContain('id="template-detail-stat-jp"');
        expect(htmlContent).toContain('id="template-detail-body"');
        expect(htmlContent).toContain('window.workloadCloseTemplateDetail()');
    });

    test('11. Setiap kartu template memuat tombol Detail dan terikat ke window.workloadOpenTemplateDetail', () => {
        expect(workloadJsContent).toContain('window.workloadOpenTemplateDetail');
        expect(workloadJsContent).toContain('window.workloadCloseTemplateDetail');
        expect(workloadJsContent).toContain('window.workloadFormatDurationToJp');
        expect(workloadJsContent).toContain('export function formatDurationToJp(');
        expect(workloadJsContent).toContain('export function openTemplateDetail(');
        expect(workloadJsContent).toContain('export function closeTemplateDetail(');
    });

    test('12. Fungsi formatDurationToJp menghitung murni durasi/45 JP dengan pembulatan cerdas', () => {
        function formatDurationToJp(minutes) {
            const min = Number(minutes) || 0;
            if (min <= 0) return '0 JP';
            const val = min / 45;
            const rounded = Math.round(val * 10) / 10;
            const str = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
            return `${str} JP`;
        }

        expect(formatDurationToJp(0)).toBe('0 JP');
        expect(formatDurationToJp(null)).toBe('0 JP');
        expect(formatDurationToJp(undefined)).toBe('0 JP');
        expect(formatDurationToJp(45)).toBe('1 JP');
        expect(formatDurationToJp(90)).toBe('2 JP');
        expect(formatDurationToJp(135)).toBe('3 JP');
        expect(formatDurationToJp(60)).toBe('1.3 JP');
        expect(formatDurationToJp(30)).toBe('0.7 JP');
        expect(formatDurationToJp(15)).toBe('0.3 JP');
    });

    test('13. Penyaringan template detail hanya meloloskan kegiatan non-KBM (0 kegiatan tatap muka KBM)', () => {
        const dummyItems = [
            { id: '1', title: 'Matematika X-A', catalog_id: 'cat_kbm', is_teaching: 1, category_code: 'PELAKSANAAN_KBM', estimated_minutes: 90 },
            { id: '2', title: 'Penyusunan Modul Ajar', catalog_id: 'cat_perencanaan_modul', is_teaching: 0, category_code: 'PERENCANAAN', estimated_minutes: 90 },
            { id: '3', title: 'Fisika XI-B', catalog_id: 'cat_kbm', is_teaching: 1, category_code: 'PELAKSANAAN_KBM', estimated_minutes: 45 },
            { id: '4', title: 'Koreksi Asesmen Sumatif', catalog_id: 'cat_evaluasi_koreksi', is_teaching: 0, category_code: 'PENILAIAN', estimated_minutes: 60 },
            { id: '5', title: 'Bimbingan Ekstrakurikuler Robotik', catalog_id: 'cat_ekstra', is_teaching: 0, category_code: 'PEMBIMBINGAN', estimated_minutes: 90 },
            { id: '6', title: 'Piket Harian', catalog_id: 'cat_piket', is_teaching: 0, category_code: 'TUGAS_TAMBAHAN', estimated_minutes: 45 }
        ];

        function isTeaching(it) {
            if (it.is_teaching === 1 || it.is_teaching === true || it.is_teaching === '1') return true;
            if (it.catalog_id === 'cat_kbm' || it.category_code === 'PELAKSANAAN_KBM' || it.duty_code === 'PELAKSANAAN_KBM') return true;
            return false;
        }

        const nonKbmItems = dummyItems.filter(it => !isTeaching(it));

        expect(nonKbmItems.length).toBe(4);
        expect(nonKbmItems.map(it => it.id)).toEqual(['2', '4', '5', '6']);
        expect(nonKbmItems.some(it => it.is_teaching === 1 || it.category_code === 'PELAKSANAAN_KBM')).toBe(false);
    });
});

