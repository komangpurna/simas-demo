/** @jest-environment jsdom */

const fs = require('node:fs');
const path = require('node:path');
const { loadGlobalModals, extractFunctions, loadWorkloadCalculations } = require('./helpers/ui-runtime-source.cjs');

const calculations = loadWorkloadCalculations();
const productionFunctions = extractFunctions('js/page-beban-kerja.js', [
    'submitPlan', 'askConfirm', 'formatSavePlanErrorMessage', 'dateOfDay', 'el'
]);
const page = new DOMParser().parseFromString(fs.readFileSync(path.join(__dirname, '../e-kinerja.html'), 'utf8'), 'text/html');
const submitButtonHtml = page.getElementById('btn-submit-plan').outerHTML;

function makeHarness(approval = 0, overrides = {}) {
    const dependencies = {
        ...calculations,
        isHolidayDate: () => false,
        getHolidayDateInfo: () => null,
        autoDeduplicatePlan: jest.fn().mockResolvedValue(false),
        cfSubmitWorkloadPlan: jest.fn().mockResolvedValue({ data: { auto_approved: approval === 0 } }),
        loadWeek: jest.fn().mockResolvedValue(undefined),
        showToast: jest.fn(),
        renderTeacherStudyDayControl: jest.fn(),
        ...overrides
    };
    const state = {
        weekStart: '2026-10-12',
        policy: { require_plan_approval: approval },
        weekData: {
            initialized: true,
            study_day: { studyDayIndex: 0, studyDayName: 'Senin', status: 'manual', isExempt: false },
            week: { id: 'week-1', is_locked: 0 },
            active_version: { id: 'version-1', status: 'draft', revision_lock: 7 },
            segments: [12, 13, 14, 15, 16].map((day, index) => ({
                id: `segment-${index}`, activity_id: `activity-${index}`,
                date: `2026-10-${day}`, day_of_week: index + 1,
                start_time: '07:30', end_time: '15:30',
                category_code: 'PERENCANAAN', activity_title: 'Perencanaan Pembelajaran'
            }))
        }
    };
    const runtime = new Function('document', 'window', 'dependencies', 'state', `
        const { ${Object.keys(dependencies).join(', ')} } = dependencies;
        let _weekData = state.weekData;
        let _weekStartDate = state.weekStart;
        let _policy = state.policy;
        let _studyDayIndex = null;
        let _isSubmittingPlan = false;
        let _isSavingStudyDay = false;
        const DAY_NAMES = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
        ${productionFunctions}
        return { submitPlan, setStudyDay: value => { _studyDayIndex = value; state.weekData.study_day = { studyDayIndex: value, studyDayName: DAY_NAMES[value], status: 'manual', isExempt: false }; } };
    `)(document, window, dependencies, state);
    return { ...runtime, dependencies, state };
}

describe.each(['light', 'dark'])('Workload submission runtime in %s mode', theme => {
    let button;
    let originalHtml;

    beforeEach(() => {
        jest.useFakeTimers();
        document.documentElement.classList.toggle('dark', theme === 'dark');
        document.body.innerHTML = submitButtonHtml;
        button = document.getElementById('btn-submit-plan');
        originalHtml = button.innerHTML;
        loadGlobalModals();
    });

    afterEach(() => {
        document.getElementById('global-confirm-cancel')?.click();
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
        document.documentElement.classList.remove('dark');
    });

    test.each([0, 1])('approval=%s submits once only after explicit confirmation', async approval => {
        const { submitPlan, dependencies } = makeHarness(approval);
        const pending = submitPlan();
        expect(button.disabled).toBe(true);
        expect(dependencies.cfSubmitWorkloadPlan).not.toHaveBeenCalled();
        expect(document.getElementById('global-confirm-title').textContent)
            .toBe(approval === 0 ? 'Finalisasi Rencana' : 'Pengajuan Rencana Kerja');
        expect(document.getElementById('global-confirm-ok').textContent.trim())
            .toBe(approval === 0 ? 'Finalisasi Rencana' : 'Ajukan Sekarang');
        document.getElementById('global-confirm-ok').click();
        jest.runAllTimers();
        await expect(pending).resolves.toBeUndefined();
        expect(dependencies.cfSubmitWorkloadPlan).toHaveBeenCalledTimes(1);
        expect(dependencies.cfSubmitWorkloadPlan).toHaveBeenCalledWith({
            work_week_id: 'week-1', plan_version_id: 'version-1', revision_lock: 7
        });
        expect(dependencies.loadWeek).toHaveBeenCalledTimes(1);
        expect(dependencies.showToast).toHaveBeenCalledWith(approval === 0
            ? 'Rencana kerja berhasil difinalisasi (Mode Mandiri Aktif)'
            : 'Rencana kerja berhasil diajukan ke Kepala Sekolah');
        expect(button.disabled).toBe(false);
        expect(button.innerHTML).toBe(originalHtml);
    });

    test.each(['cancel', 'backdrop', 'Escape'])('dismissal with %s sends no request and permits retry', async action => {
        const { submitPlan, dependencies } = makeHarness();
        const first = submitPlan();
        if (action === 'cancel') document.getElementById('global-confirm-cancel').click();
        if (action === 'backdrop') document.getElementById('global-confirm-overlay').click();
        if (action === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        jest.runAllTimers();
        await first;
        expect(dependencies.cfSubmitWorkloadPlan).not.toHaveBeenCalled();
        expect(button.disabled).toBe(false);
        const retry = submitPlan();
        document.getElementById('global-confirm-ok').click();
        jest.runAllTimers();
        await retry;
        expect(dependencies.cfSubmitWorkloadPlan).toHaveBeenCalledTimes(1);
    });

    test('repeated clicks during confirmation and during the API call stay single', async () => {
        let finishRequest;
        const request = new Promise(resolve => { finishRequest = resolve; });
        const { submitPlan, dependencies } = makeHarness(0, {
            cfSubmitWorkloadPlan: jest.fn().mockReturnValue(request)
        });
        const first = submitPlan();
        const overlay = document.getElementById('global-confirm-overlay');
        await submitPlan();
        expect(document.getElementById('global-confirm-overlay')).toBe(overlay);
        document.getElementById('global-confirm-ok').click();
        jest.runAllTimers();
        // Allow the confirmation promise to reach the API await.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await submitPlan();
        expect(dependencies.cfSubmitWorkloadPlan).toHaveBeenCalledTimes(1);
        expect(button.disabled).toBe(true);
        expect(button.innerHTML).toContain('Memproses...');
        finishRequest({ data: { auto_approved: true } });
        await first;
        expect(button.disabled).toBe(false);
    });

    test('network failure restores the button and allows another confirmed attempt', async () => {
        const { submitPlan, dependencies } = makeHarness();
        dependencies.cfSubmitWorkloadPlan.mockRejectedValueOnce(new Error('Failed to fetch'));
        const first = submitPlan();
        document.getElementById('global-confirm-ok').click();
        jest.runAllTimers();
        await expect(first).resolves.toBeUndefined();
        expect(dependencies.loadWeek).not.toHaveBeenCalled();
        expect(dependencies.showToast).toHaveBeenCalledWith(expect.stringContaining('Koneksi internet'), 'error', 12000, 'Gagal Mengajukan Rencana');
        expect(button.disabled).toBe(false);
        expect(button.innerHTML).toBe(originalHtml);
        const retry = submitPlan();
        document.getElementById('global-confirm-ok').click();
        jest.runAllTimers();
        await retry;
        expect(dependencies.cfSubmitWorkloadPlan).toHaveBeenCalledTimes(2);
    });

    test('incomplete weeks fail the production validator before opening confirmation', async () => {
        const { submitPlan, dependencies, state } = makeHarness();
        state.weekData.segments = [];
        await submitPlan();
        expect(document.getElementById('global-confirm-overlay')).toBeNull();
        expect(dependencies.cfSubmitWorkloadPlan).not.toHaveBeenCalled();
        expect(dependencies.showToast).toHaveBeenCalledWith(expect.any(String), 'warning');
        expect(button.disabled).toBe(false);
    });

    test('missing study-day activity blocks finalization without leaving the mutex locked', async () => {
        const { submitPlan, setStudyDay, dependencies, state } = makeHarness();
        setStudyDay(2);
        state.weekData.segments.forEach(segment => { segment.category_code = 'PELAKSANAAN_KBM'; });
        await submitPlan();
        expect(dependencies.cfSubmitWorkloadPlan).not.toHaveBeenCalled();
        expect(dependencies.showToast).toHaveBeenCalledWith(expect.stringContaining('Hari Belajar Guru'), 'warning', 7000);
        expect(button.disabled).toBe(false);
        state.weekData.segments[2].category_code = 'PERENCANAAN';
        const retry = submitPlan();
        document.getElementById('global-confirm-cancel').click();
        jest.runAllTimers();
        await retry;
    });

    test('the mutex also covers asynchronous deduplication before confirmation', async () => {
        let finishDeduplication;
        const deduplication = new Promise(resolve => { finishDeduplication = resolve; });
        const validate = jest.fn()
            .mockReturnValueOnce({ isValid: false, message: 'benturan jam kerja' })
            .mockReturnValue({ isValid: true });
        const { submitPlan, dependencies } = makeHarness(0, {
            validateWeeklyPlanCompleteness: validate,
            autoDeduplicatePlan: jest.fn().mockReturnValue(deduplication)
        });
        const first = submitPlan();
        await submitPlan();
        expect(dependencies.autoDeduplicatePlan).toHaveBeenCalledTimes(1);
        expect(document.getElementById('global-confirm-overlay')).toBeNull();
        finishDeduplication(true);
        await Promise.resolve();
        document.getElementById('global-confirm-ok').click();
        jest.runAllTimers();
        await first;
        expect(dependencies.cfSubmitWorkloadPlan).toHaveBeenCalledTimes(1);
    });

    test.each(['missing', 'rejecting'])('a %s modal cancels finalization and reports a recoverable error', async failure => {
        const log = jest.spyOn(console, 'error').mockImplementation(() => {});
        if (failure === 'missing') delete window.showConfirmModal;
        else window.showConfirmModal = jest.fn().mockRejectedValue(new TypeError('DOM unavailable'));
        const { submitPlan, dependencies } = makeHarness();
        await expect(submitPlan()).resolves.toBeUndefined();
        expect(dependencies.cfSubmitWorkloadPlan).not.toHaveBeenCalled();
        expect(dependencies.showToast).toHaveBeenCalledWith(expect.stringContaining('Konfirmasi tidak dapat ditampilkan'), 'error');
        expect(button.disabled).toBe(false);
        expect(button.innerHTML).toBe(originalHtml);
        if (failure === 'rejecting') expect(log).toHaveBeenCalled();
    });

    test('deduplication uses the refreshed revision rather than the stale version object', async () => {
        const { submitPlan, dependencies, state } = makeHarness(0, {
            validateWeeklyPlanCompleteness: jest.fn()
                .mockReturnValueOnce({ isValid: false, message: 'benturan jam kerja' })
                .mockReturnValue({ isValid: true })
        });
        dependencies.autoDeduplicatePlan.mockImplementation(async () => {
            state.weekData.active_version = { ...state.weekData.active_version, revision_lock: 8 };
            return true;
        });
        const pending = submitPlan();
        await Promise.resolve();
        document.getElementById('global-confirm-ok').click();
        jest.runAllTimers();
        await pending;
        expect(dependencies.cfSubmitWorkloadPlan).toHaveBeenCalledWith({
            work_week_id: 'week-1', plan_version_id: 'version-1', revision_lock: 8
        });
    });

    test('switching week during confirmation cannot mix week and version identifiers', async () => {
        const { submitPlan, dependencies, state } = makeHarness();
        const pending = submitPlan();
        state.weekData.week = { id: 'week-2', is_locked: 0 };
        state.weekData.active_version = { id: 'version-2', status: 'draft', revision_lock: 3 };
        document.getElementById('global-confirm-ok').click();
        jest.runAllTimers();
        await pending;
        expect(dependencies.cfSubmitWorkloadPlan).toHaveBeenCalledWith({
            work_week_id: 'week-1', plan_version_id: 'version-1', revision_lock: 7
        });
    });
});

describe.each(['js/page-beban-kerja.js', 'js/page-monitoring-beban-kerja.js'])('Confirmation safety in %s', relativePath => {
    const source = extractFunctions(relativePath, ['askConfirm']);
    afterEach(() => jest.restoreAllMocks());

    test.each([undefined, null, false, 'true'])('a modal result of %s never authorizes the action', async result => {
        const showToast = jest.fn();
        window.showConfirmModal = jest.fn().mockResolvedValue(result);
        const askConfirm = new Function('window', 'showToast', `${source}\nreturn askConfirm;`)(window, showToast);
        await expect(askConfirm('Isi')).resolves.toBe(false);
    });

    test.each(['missing', 'throwing', 'rejecting'])('%s modal stops the action and reports the error', async failure => {
        const showToast = jest.fn();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        if (failure === 'missing') delete window.showConfirmModal;
        if (failure === 'throwing') window.showConfirmModal = () => { throw new Error('Render failed'); };
        if (failure === 'rejecting') window.showConfirmModal = jest.fn().mockRejectedValue(new Error('Render failed'));
        const askConfirm = new Function('window', 'showToast', `${source}\nreturn askConfirm;`)(window, showToast);
        await expect(askConfirm('Isi')).resolves.toBe(false);
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Konfirmasi tidak dapat ditampilkan'), 'error');
    });
});
