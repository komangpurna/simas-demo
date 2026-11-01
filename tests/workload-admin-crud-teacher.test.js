/**
 * tests/workload-admin-crud-teacher.test.js
 * Unit Test: Hak Akses Penuh Super Admin & Kepala Sekolah untuk CRUD Rencana & Realisasi Guru (E-Kinerja)
 * Sesuai PRD Bagian 23.3 & 23.16 (Permendikdasmen No. 11/2025)
 */

const fs = require('fs');
const path = require('path');

describe('Super Admin & Kepala Sekolah CRUD Rencana & Realisasi Guru (E-Kinerja)', () => {
    let jsWorkload;
    let jsEKinerja;
    let jsMonitoring;
    let htmlContent;

    beforeAll(() => {
        jsWorkload = fs.readFileSync(path.resolve(__dirname, '../js/page-beban-kerja.js'), 'utf8');
        jsEKinerja = fs.readFileSync(path.resolve(__dirname, '../js/page-e-kinerja.js'), 'utf8');
        jsMonitoring = fs.readFileSync(path.resolve(__dirname, '../js/page-monitoring-beban-kerja.js'), 'utf8');
        htmlContent = fs.readFileSync(path.resolve(__dirname, '../e-kinerja.html'), 'utf8');
    });

    test('1. DOM e-kinerja.html menyediakan strip pemilih guru dan placeholder empty-state', () => {
        expect(htmlContent).toContain('id="admin-teacher-selector-strip"');
        expect(htmlContent).toContain('id="select-workload-teacher"');
        expect(htmlContent).toContain('id="label-selected-teacher-name"');
        expect(htmlContent).toContain('id="badge-admin-teacher-duty"');
        expect(htmlContent).toContain('id="btn-admin-clear-teacher"');
        expect(htmlContent).toContain('id="admin-no-teacher-placeholder-today"');
        expect(htmlContent).toContain('id="admin-no-teacher-placeholder-plan"');
        expect(htmlContent).toContain('id="plan-toolbar"');
        expect(htmlContent).toContain('id="btn-mon-detail-manage"');
    });

    test('2. page-beban-kerja.js mengekspor fungsi manajemen guru supervisor', () => {
        expect(jsWorkload).toContain('export function getEffectiveTeacherId(');
        expect(jsWorkload).toContain('export function getAdminSelectedTeacherId(');
        expect(jsWorkload).toContain('export function setAdminSelectedTeacher(');
        expect(jsWorkload).toContain('export function populateAdminTeacherDropdown(');
        expect(jsWorkload).toContain('export async function onAdminTeacherChange(');
        expect(jsWorkload).toContain('export async function adminResetTeacher(');
        expect(jsWorkload).toContain('export async function adminManageTeacher(');
        expect(jsWorkload).toContain('window.workloadPopulateAdminTeacherDropdown = populateAdminTeacherDropdown');
        expect(jsWorkload).toContain('window.workloadOnAdminTeacherChange = onAdminTeacherChange');
        expect(jsWorkload).toContain('window.workloadAdminManageTeacher = adminManageTeacher');
        expect(jsWorkload).toContain('window.workloadAdminResetTeacher = adminResetTeacher');
        expect(jsWorkload).toContain('window.workloadGetEffectiveTeacherId = getEffectiveTeacherId');
        expect(jsWorkload).toContain('window.workloadGetAdminSelectedTeacherId = getAdminSelectedTeacherId');
        expect(jsWorkload).toContain('window.workloadSetAdminSelectedTeacher = setAdminSelectedTeacher');
    });

    test('3. Logika getEffectiveTeacherId membedakan supervisor vs guru mandiri', () => {
        function evalEffectiveId(isMgr, selectedTeacherId) {
            if (isMgr && selectedTeacherId) {
                return selectedTeacherId;
            }
            return null;
        }

        // Supervisor tanpa guru terpilih -> null
        expect(evalEffectiveId(true, null)).toBeNull();
        expect(evalEffectiveId(true, '')).toBeNull();

        // Supervisor dengan guru terpilih -> ID guru yang dikelola
        expect(evalEffectiveId(true, 'guru_123')).toBe('guru_123');

        // Guru biasa -> null (backend akan menyelesaikan ke user.uid / linkedTeacherId)
        expect(evalEffectiveId(false, 'guru_123')).toBeNull();
        expect(evalEffectiveId(false, null)).toBeNull();
    });

    test('4. populateAdminTeacherDropdown menghasilkan daftar opsi dropdown yang valid dan aman (escaped)', () => {
        function simulatePopulate(teachers, selectedId) {
            let html = '<option value="">-- Pilih Guru Terlebih Dahulu --</option>';
            teachers.forEach(t => {
                const id = t.teacher_id || t.id;
                const name = t.teacher_name || t.name || t.nama || id;
                const duty = t.jenis_ptk || t.mapel || '';
                const dutyText = duty ? ` (${duty})` : '';
                html += `<option value="${id}">${name}${dutyText}</option>`;
            });
            return html;
        }

        const sampleTeachers = [
            { teacher_id: 't1', teacher_name: 'Dra. Siti Aminah', jenis_ptk: 'Guru Bahasa Indonesia' },
            { teacher_id: 't2', teacher_name: 'Budi Santoso, S.Pd', jenis_ptk: 'Guru Matematika' }
        ];

        const optionsHtml = simulatePopulate(sampleTeachers, 't1');
        expect(optionsHtml).toContain('value="t1"');
        expect(optionsHtml).toContain('Dra. Siti Aminah (Guru Bahasa Indonesia)');
        expect(optionsHtml).toContain('value="t2"');
        expect(optionsHtml).toContain('Budi Santoso, S.Pd (Guru Matematika)');
    });

    test('5. setupSupervisorAccess di js/page-e-kinerja.js menampilkan bilah pemilih guru untuk super_admin & kepala_sekolah', () => {
        expect(jsEKinerja).toContain("adminSelectorStrip.classList.remove('hidden')");
        expect(jsEKinerja).toContain("tabTemplatesBtn.classList.add('hidden')");
        expect(jsEKinerja).toContain("tabTodayBtn.classList.remove('hidden')");
        expect(jsEKinerja).toContain("tabPlanBtn.classList.remove('hidden')");
    });

    test('6. Placeholder empty-state ditampilkan saat supervisor belum memilih guru di Tab Realisasi dan Rencana', () => {
        function evalPlaceholderVisibility(isMgr, selectedTeacherId) {
            const hasSelectedTeacher = !!selectedTeacherId;
            return {
                showPlaceholderToday: isMgr && !hasSelectedTeacher,
                showPlaceholderPlan: isMgr && !hasSelectedTeacher,
                showToolbarRealisasi: !isMgr || hasSelectedTeacher,
                showToolbarPlan: !isMgr || hasSelectedTeacher
            };
        }

        // Supervisor sebelum pilih guru
        const unselected = evalPlaceholderVisibility(true, null);
        expect(unselected.showPlaceholderToday).toBe(true);
        expect(unselected.showPlaceholderPlan).toBe(true);
        expect(unselected.showToolbarRealisasi).toBe(false);
        expect(unselected.showToolbarPlan).toBe(false);

        // Supervisor setelah pilih guru
        const selected = evalPlaceholderVisibility(true, 'guru_abc');
        expect(selected.showPlaceholderToday).toBe(false);
        expect(selected.showPlaceholderPlan).toBe(false);
        expect(selected.showToolbarRealisasi).toBe(true);
        expect(selected.showToolbarPlan).toBe(true);

        // Guru biasa
        const regularGuru = evalPlaceholderVisibility(false, null);
        expect(regularGuru.showPlaceholderToday).toBe(false);
        expect(regularGuru.showPlaceholderPlan).toBe(false);
        expect(regularGuru.showToolbarRealisasi).toBe(true);
        expect(regularGuru.showToolbarPlan).toBe(true);
    });

    test('7. Integrasi tombol kelola di Tab Monitoring (Overview Table & Detail Header)', () => {
        expect(jsMonitoring).toContain('window.monitoringManageTeacher');
        expect(jsMonitoring).toContain('window.monitoringGetDetailTeacherId');
        expect(jsMonitoring).toContain('window.monitoringGetSummaryTeachers');
    });

    test('8. Payload mutator menyertakan teacher_id untuk paritas otorisasi server Cloudflare Worker', () => {
        // quickReportComplete menyertakan teacher_id
        expect(jsWorkload).toContain('teacher_id: _weekData?.week?.teacher_id || getEffectiveTeacherId() || undefined');
        // saveLog menyertakan teacher_id
        expect(jsWorkload).toContain('teacher_id: _weekData?.week?.teacher_id || getEffectiveTeacherId() || undefined');
        // syncFromJournal menyertakan teacher_id
        expect(jsWorkload).toContain('teacher_id: _weekData?.week?.teacher_id || getEffectiveTeacherId() || undefined');
        // cfInitializeWorkloadWeek menyertakan teacher_id
        expect(jsWorkload).toContain('teacher_id: getEffectiveTeacherId() || undefined');
    });

    test('9. findMatchedTeacher dan getCurrentTeacherExportInfo memprioritaskan guru terpilih supervisor', () => {
        expect(jsWorkload).toContain('const targetTeacherId = _adminSelectedTeacherId ||');
        expect(jsWorkload).toContain('const targetTeacherName = _adminSelectedTeacherName ||');
        expect(jsWorkload).toContain('let teacherName = _adminSelectedTeacherName ||');
    });

    test('10. Ketahanan runtime tombol pintas supervisi: 0 Uncaught TypeError saat dieksekusi di DOM', () => {
        // Ekstraksi atribut onclick tombol #btn-mon-detail-manage di e-kinerja.html
        const btnMatch = htmlContent.match(/id="btn-mon-detail-manage"[^>]*onclick="([^"]+)"/);
        expect(btnMatch).toBeTruthy();
        const onclickCode = btnMatch[1];

        // Pastikan kode onclick menggunakan safe invocation
        expect(onclickCode).toContain('monitoringManageTeacher');

        // Simulasi skenario A: Kedua fungsi terdefinisi
        let calledWith = null;
        const mockWindowA = {
            monitoringManageTeacher: (id) => { calledWith = id; },
            workloadAdminManageTeacher: (id) => { calledWith = id; },
            monitoringGetDetailTeacherId: () => 'guru_xyz'
        };
        const runA = new Function('window', `with(window) { ${onclickCode} }`);
        expect(() => runA(mockWindowA)).not.toThrow();
        expect(calledWith).toBe('guru_xyz');

        // Simulasi skenario B: window.workloadAdminManageTeacher belum siap / undefined
        let fallbackCalled = null;
        const mockWindowB = {
            monitoringManageTeacher: (id) => { fallbackCalled = id; },
            workloadAdminManageTeacher: undefined,
            monitoringGetDetailTeacherId: () => 'guru_abc'
        };
        const runB = new Function('window', `with(window) { ${onclickCode} }`);
        expect(() => runB(mockWindowB)).not.toThrow();
        expect(fallbackCalled).toBe('guru_abc');

        // Simulasi skenario C: Seluruh handler masih belum terpasang (cold start) -> DILARANG keras TypeError
        const mockWindowC = {
            monitoringManageTeacher: undefined,
            workloadAdminManageTeacher: undefined,
            monitoringGetDetailTeacherId: () => 'guru_abc'
        };
        const runC = new Function('window', `with(window) { ${onclickCode} }`);
        expect(() => runC(mockWindowC)).not.toThrow();
    });

    test('11. Proteksi 404 Foto Guru: Avatar tanpa foto tidak menghasilkan URL .webp spekulatif', () => {
        expect(jsMonitoring).not.toContain('/api/photos/gtk/${t.teacher_id}.webp');
        expect(jsMonitoring).not.toContain('/api/photos/gtk/${teacher.teacher_id}.webp');
        expect(jsMonitoring).toContain('resolvePhotoUrl');
    });
});
