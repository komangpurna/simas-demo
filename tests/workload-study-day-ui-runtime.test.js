/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');
const { extractFunctions, loadWorkloadCalculations } = require('./helpers/ui-runtime-source.cjs');
const functions = extractFunctions('js/page-beban-kerja.js', ['determineTeacherStudyDay', 'setTeacherStudyDay', 'renderTeacherStudyDayControl', 'el']);
const page = new DOMParser().parseFromString(fs.readFileSync(path.join(__dirname, '../e-kinerja.html'), 'utf8'), 'text/html');
const auto = { studyDayIndex: 2, studyDayName: 'Rabu', isAutoDetected: true, status: 'auto', reason: 'Hari tanpa KBM' };

function harness(overrides = {}) {
    const data = { initialized: true, week: { id: 'week-a', teacher_id: 'guru-a' }, active_version: { id: 'version-a', revision_lock: 1, status: 'draft' }, study_day: auto };
    const dependencies = {
        ...loadWorkloadCalculations(),
        cfSaveWorkloadStudyDay: jest.fn(async payload => ({ data: { revision_lock: 2, study_day: payload.manual_day_index === null ? auto : {
            studyDayIndex: payload.manual_day_index, studyDayName: ['Senin','Selasa','Rabu','Kamis','Jumat'][payload.manual_day_index], status: 'manual'
        } } })),
        cfInitializeWorkloadWeek: jest.fn().mockResolvedValue({}),
        cfGetWorkloadWeek: jest.fn().mockResolvedValue({ data }),
        showToast: jest.fn(), ...overrides
    };
    const runtime = new Function('document', 'dependencies', 'initialData', `
        const { ${Object.keys(dependencies).join(', ')} } = dependencies;
        let _weekData = initialData; let _weekStartDate = '2026-10-12';
        let _studyDayIndex = null; let _studyDayIsAuto = false;
        let _isSavingStudyDay = false; let _isSubmittingPlan = false;
        const DAY_NAMES = ['Senin','Selasa','Rabu','Kamis','Jumat'];
        let teacher = 'guru-a'; const getEffectiveTeacherId = () => teacher;
        const renderAll = () => { determineTeacherStudyDay(); renderTeacherStudyDayControl(); };
        ${functions}
        return { determineTeacherStudyDay, setTeacherStudyDay, renderTeacherStudyDayControl,
            getData: () => _weekData, setSubmitting: v => { _isSubmittingPlan = v; },
            switchTeacher: () => { teacher = 'guru-b'; _weekData = { ...initialData, week: { id: 'week-b' }, study_day: { status: 'unavailable', studyDayIndex: null } }; } };
    `)(document, dependencies, data);
    return { ...runtime, dependencies, data };
}

describe.each(['light', 'dark'])('HBG controls in %s theme', theme => {
    beforeEach(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        document.body.innerHTML = ['select-workload-study-day','study-day-auto-badge','study-day-help'].map(id => page.getElementById(id).outerHTML).join('');
        localStorage.setItem('simas_study_day_2026-10-12_admin', '0');
    });
    afterEach(() => { localStorage.clear(); document.documentElement.classList.remove('dark'); });
    test('server choice takes precedence over the unsafe legacy browser preference', () => {
        const h = harness();
        expect(h.determineTeacherStudyDay().studyDayIndex).toBe(2);
        h.renderTeacherStudyDayControl();
        expect(document.getElementById('select-workload-study-day').value).toBe('auto');
        expect(document.getElementById('study-day-auto-badge').textContent).toBe('Otomatis');
        expect(document.getElementById('study-day-help').textContent).toContain('Rabu');
    });
    test('suggestions remain unselected and show a clear explanation', () => {
        const h = harness();
        h.data.study_day = { status: 'needs_selection', studyDayIndex: null, suggestedDayIndex: 4, reason: 'Semua hari memiliki KBM.' };
        h.renderTeacherStudyDayControl();
        expect(document.getElementById('study-day-auto-badge').textContent).toBe('Pilih hari');
        expect(document.getElementById('study-day-help').textContent).toContain('Saran: Jumat');
        expect(h.determineTeacherStudyDay().studyDayIndex).toBeNull();
    });
    test('manual selection saves to the precise version and reset sends null', async () => {
        const h = harness();
        await h.setTeacherStudyDay('1');
        expect(h.dependencies.cfSaveWorkloadStudyDay).toHaveBeenCalledWith({ work_week_id: 'week-a', plan_version_id: 'version-a', revision_lock: 1, manual_day_index: 1 });
        expect(h.getData().study_day.studyDayIndex).toBe(1);
        expect(document.getElementById('select-workload-study-day').value).toBe('1');
        await h.setTeacherStudyDay('auto');
        expect(h.dependencies.cfSaveWorkloadStudyDay).toHaveBeenLastCalledWith({ work_week_id: 'week-a', plan_version_id: 'version-a', revision_lock: 2, manual_day_index: null });
        expect(document.getElementById('select-workload-study-day').value).toBe('auto');
    });
    test('saving errors restore the prior selection and permit retry', async () => {
        const h = harness();
        h.dependencies.cfSaveWorkloadStudyDay.mockRejectedValueOnce(new Error('Koneksi terputus'));
        await h.setTeacherStudyDay('1');
        expect(h.getData().study_day).toBe(auto);
        expect(document.getElementById('select-workload-study-day').disabled).toBe(false);
        expect(h.dependencies.showToast).toHaveBeenCalledWith('Koneksi terputus', 'error');
        await h.setTeacherStudyDay('1');
        expect(h.getData().study_day.studyDayIndex).toBe(1);
    });
    test('changing teachers during the save cannot overwrite the new teacher context', async () => {
        let finish;
        const h = harness({ cfSaveWorkloadStudyDay: jest.fn(() => new Promise(resolve => { finish = resolve; })) });
        const pending = h.setTeacherStudyDay('1');
        await h.setTeacherStudyDay('4');
        expect(h.dependencies.cfSaveWorkloadStudyDay).toHaveBeenCalledTimes(1);
        h.switchTeacher();
        finish({ data: { study_day: { status: 'manual', studyDayIndex: 1 }, revision_lock: 2 } });
        await pending;
        expect(h.getData().week.id).toBe('week-b');
        expect(h.getData().study_day.studyDayIndex).toBeNull();
    });
    test('finalized and submitting plans disable changes', async () => {
        const h = harness();
        h.data.active_version.status = 'approved';
        h.renderTeacherStudyDayControl();
        expect(document.getElementById('select-workload-study-day').disabled).toBe(true);
        await h.setTeacherStudyDay('1');
        h.data.active_version.status = 'draft';
        h.setSubmitting(true);
        h.renderTeacherStudyDayControl();
        expect(document.getElementById('select-workload-study-day').disabled).toBe(true);
        await h.setTeacherStudyDay('1');
        expect(h.dependencies.cfSaveWorkloadStudyDay).not.toHaveBeenCalled();
    });
    test('first selection can initialize a week and then persist the choice', async () => {
        const h = harness();
        const initialized = { ...h.data, active_version: { ...h.data.active_version } };
        h.data.active_version = null;
        h.dependencies.cfGetWorkloadWeek.mockResolvedValueOnce({ data: initialized });
        await h.setTeacherStudyDay('1');
        expect(h.dependencies.cfInitializeWorkloadWeek).toHaveBeenCalledWith({ week_start_date: '2026-10-12', teacher_id: 'guru-a' });
        expect(h.getData().active_version.revision_lock).toBe(2);
    });
});
