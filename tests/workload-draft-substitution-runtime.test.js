/** @jest-environment jsdom */

const fs = require('node:fs');
const path = require('node:path');
const { extractFunctions } = require('./helpers/ui-runtime-source.cjs');

const sourceFunctions = extractFunctions('js/page-beban-kerja.js', [
    'openLogModal', 'openEditLogModal', 'closeLogModal', 'syncLogStatusOptions',
    'onStatusExecutionChange', 'saveLogDraft', 'saveLog', 'updateLogMinutesPreview',
    'canReportActivityNow', 'currentTimeMinutesWITA', 'todayWITA',
    'isTeachingActivity', 'isLogLockedByManualVerification', 'parseTime', 'calcEffective',
    'dateOfDay', 'el'
]);
const page = new DOMParser().parseFromString(
    fs.readFileSync(path.join(__dirname, '../e-kinerja.html'), 'utf8'), 'text/html'
);
const modalHtml = page.getElementById('modal-workload-log').outerHTML;
const input = id => document.getElementById(id);

function makeHarness(isKbm = false) {
    const catalog = [
        { id: 'cat_plan', name: 'Perencanaan', category_code: 'PERENCANAAN' },
        { id: 'cat_kbm', name: 'KBM', category_code: 'PELAKSANAAN_KBM', is_teaching: 1 },
        { id: 'cat_meeting', name: 'Rapat', category_code: 'TUGAS_TAMBAHAN' }
    ];
    const plannedCatalog = catalog[isKbm ? 1 : 0];
    const state = {
        initialized: true,
        week: { id: 'week', teacher_id: 'teacher', is_locked: 0 },
        active_version: { id: 'version', status: 'approved' },
        activities: [{ id: 'activity', catalog_id: plannedCatalog.id, category_code: plannedCatalog.category_code }],
        segments: [{ activity_id: 'activity', date: '2026-10-22', start_time: '10:00', end_time: '12:00',
            activity_title: 'Rencana awal', catalog_id: plannedCatalog.id, is_teaching: isKbm ? 1 : 0 }],
        logs: [], log_segments: [], plan_links: []
    };
    const dependencies = {
        showToast: jest.fn(),
        cfSaveWorkloadLog: jest.fn().mockResolvedValue({ success: true }),
        cfInitializeWorkloadWeek: jest.fn(),
        loadWeek: jest.fn().mockResolvedValue(undefined),
        isManagerViewingOtherTeacher: () => false,
        getEffectiveTeacherId: () => 'teacher',
        applyManagerReadOnlyLogButtons: () => false,
        closeLogCatalogDropdown: jest.fn(),
        openLogCatalogDropdown: jest.fn(),
        workloadSyncEvidenceButtons: jest.fn(),
        renderEvidencePhotosGrid: jest.fn(),
        parseEvidencePhotos: raw => raw?.startsWith('[') ? JSON.parse(raw) : [],
        onLogCatalogChange: jest.fn(),
        findTimeOverlap: () => ({ hasOverlap: false }),
        populateLogCatalogDropdownByDuty: (duty, selectedId) => {
            input('log-input-catalog').innerHTML = '<option value="">Pilih</option>' +
                catalog.filter(item => item.category_code === duty)
                    .map(item => `<option value="${item.id}" data-teaching="${item.is_teaching || 0}" data-jp="0">${item.name}</option>`).join('');
            input('log-input-catalog').value = selectedId || '';
        }
    };
    const runtime = new Function('document', 'window', 'dependencies', 'state', 'catalog', `
        const { ${Object.keys(dependencies).join(', ')} } = dependencies;
        const BREAKS = [{ start: '09:45', end: '10:00' }, { start: '12:15', end: '12:30' }];
        const _weekData = state, _catalog = catalog, _assignments = [];
        const _weekStartDate = '2026-10-19', _selectedDayIndex = 3;
        const _policy = { require_log_verification: 1 };
        let _isSavingLog = false, _currentLogPhotos = [];
        ${sourceFunctions}
        return { openLogModal, openEditLogModal, onStatusExecutionChange, saveLogDraft, saveLog,
            setPhotos: photos => { _currentLogPhotos = photos; } };
    `)(document, window, dependencies, state, catalog);
    return { ...runtime, dependencies, state };
}

function selectSubstitution(harness) {
    input('log-input-status-execution').value = 'diganti';
    harness.onStatusExecutionChange();
    input('log-input-main-duty').value = 'TUGAS_TAMBAHAN';
    harness.dependencies.populateLogCatalogDropdownByDuty('TUGAS_TAMBAHAN', 'cat_meeting');
    input('log-input-substitute').value = 'Rapat koordinasi sekolah';
}

function seedDraft(harness, substitution = true) {
    harness.state.logs = [{ id: 'log', date: '2026-10-22', status_execution: 'draft',
        title: substitution ? 'Rapat koordinasi sekolah' : 'Rencana awal',
        catalog_id: substitution ? 'cat_meeting' : harness.state.segments[0].catalog_id,
        evidence_url: '[{"url":"https://example.test/foto.jpg","caption":"Bukti rapat"}]' }];
    harness.state.log_segments = [{ work_log_id: 'log', start_time: '10:00', end_time: '12:00', actual_minutes: 0 }];
    harness.state.plan_links = [{ work_log_id: 'log', plan_activity_id: 'activity',
        link_type: substitution ? 'substitution' : 'fulfillment', reason_notes: substitution ? 'Rapat koordinasi sekolah' : '' }];
}

describe.each([false, true])('Draf kegiatan pengganti e-Kinerja (rencana KBM=%s)', isKbm => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-10-22T03:00:00Z')); // 11:00 WITA, kegiatan belum berakhir.
        document.body.innerHTML = modalHtml;
        window.workloadOnFilterLogCatalog = jest.fn();
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        delete window.workloadOnFilterLogCatalog;
    });

    test('status pengganti dapat dipilih sebelum selesai, hanya tombol Simpan Draf tersedia', () => {
        const h = makeHarness(isKbm);
        h.openLogModal('activity');
        const status = input('log-input-status-execution');
        expect(status.disabled).toBe(false);
        expect(status.value).toBe('draft');
        expect([...status.options].filter(option => !option.disabled).map(option => option.value))
            .toEqual(['diganti', 'draft']);
        selectSubstitution(h);
        expect(input('log-substitute-wrapper').classList.contains('hidden')).toBe(false);
        expect(input('log-duty-catalog-wrapper').classList.contains('hidden')).toBe(false);
        expect(input('btn-draft-workload-log').classList.contains('hidden')).toBe(false);
        expect(input('btn-submit-workload-log').classList.contains('hidden')).toBe(true);
    });

    test('membuka aksi Diganti langsung mempertahankan pilihan pengganti dalam mode draf', () => {
        const h = makeHarness(isKbm);
        h.openLogModal('activity', false, 'diganti');
        expect(input('log-input-status-execution').value).toBe('diganti');
        expect(input('log-substitute-wrapper').classList.contains('hidden')).toBe(false);
        expect(input('btn-submit-workload-log').classList.contains('hidden')).toBe(true);
    });

    test('Simpan Draf mempertahankan katalog, judul, catatan, foto, dan relasi rencana pengganti', async () => {
        const h = makeHarness(isKbm);
        h.openLogModal('activity');
        selectSubstitution(h);
        h.setPhotos([{ url: 'https://example.test/foto.jpg', name: 'Foto rapat', caption: 'Bukti rapat', state: 'ready' }]);
        await h.saveLogDraft();
        expect(h.dependencies.cfSaveWorkloadLog).toHaveBeenCalledTimes(1);
        const payload = h.dependencies.cfSaveWorkloadLog.mock.calls[0][0];
        expect(payload).toMatchObject({
            status_execution: 'draft', draft_status_execution: 'diganti', catalog_id: 'cat_meeting',
            title: 'Rapat koordinasi sekolah', substitute_notes: 'Rapat koordinasi sekolah',
            category_code: 'TUGAS_TAMBAHAN', plan_activity_id: 'activity',
            start_time: '10:00', end_time: '12:00'
        });
        expect(JSON.parse(payload.evidence_url)).toEqual([
            expect.objectContaining({ url: 'https://example.test/foto.jpg', caption: 'Bukti rapat' })
        ]);
        expect(h.dependencies.showToast).toHaveBeenCalledWith('Kegiatan berhasil disimpan sebagai draf');
    });

    test.each(['notes', 'catalog'])('draf pengganti tetap memvalidasi isian %s', async field => {
        const h = makeHarness(isKbm);
        h.openLogModal('activity');
        selectSubstitution(h);
        input(field === 'notes' ? 'log-input-substitute' : 'log-input-catalog').value = '';
        await h.saveLogDraft();
        expect(h.dependencies.cfSaveWorkloadLog).not.toHaveBeenCalled();
        expect(h.dependencies.showToast).toHaveBeenCalledWith(
            field === 'notes' ? 'Catatan kegiatan pengganti wajib diisi' : 'Silakan pilih sub-kegiatan terlebih dahulu',
            field === 'notes' ? 'error' : 'warning'
        );
    });

    test('draf pengganti dibuka dan disimpan ulang tanpa kehilangan identitas penggantinya', async () => {
        const h = makeHarness(isKbm);
        seedDraft(h);
        h.openEditLogModal('log');
        expect(input('log-input-status-execution').value).toBe('diganti');
        expect(input('log-input-substitute').value).toBe('Rapat koordinasi sekolah');
        expect(input('log-input-catalog').value).toBe('cat_meeting');
        expect(input('log-substitute-wrapper').classList.contains('hidden')).toBe(false);
        expect(input('btn-submit-workload-log').classList.contains('hidden')).toBe(true);
        await h.saveLogDraft();
        expect(h.dependencies.cfSaveWorkloadLog).toHaveBeenCalledWith(expect.objectContaining({
            id: 'log', status_execution: 'draft', draft_status_execution: 'diganti', catalog_id: 'cat_meeting'
        }));
    });

    test('finalisasi pengganti masih ditolak sebelum waktunya dan tetap tersedia setelah selesai', async () => {
        const h = makeHarness(isKbm);
        seedDraft(h);
        h.openEditLogModal('log');
        await h.saveLog();
        expect(h.dependencies.cfSaveWorkloadLog).not.toHaveBeenCalled();
        expect(h.dependencies.showToast).toHaveBeenCalledWith(expect.stringContaining('Kegiatan belum berakhir'), 'warning');
        jest.setSystemTime(new Date('2026-10-22T04:10:00Z')); // 12:10 WITA.
        h.openEditLogModal('log');
        expect(input('log-input-status-execution').value).toBe('diganti');
        expect(input('btn-submit-workload-log').classList.contains('hidden')).toBe(false);
        expect(input('btn-draft-workload-log').classList.contains('hidden')).toBe(true);
        await h.saveLog();
        expect(h.dependencies.cfSaveWorkloadLog).toHaveBeenCalledWith(expect.objectContaining({
            id: 'log', status_execution: 'diganti', catalog_id: 'cat_meeting', substitute_notes: 'Rapat koordinasi sekolah'
        }));
        expect(h.dependencies.cfSaveWorkloadLog.mock.calls[0][0]).not.toHaveProperty('draft_status_execution');
    });

    test('draf kegiatan semula tetap menggunakan katalog rencana dan tanpa penanda pengganti', async () => {
        const h = makeHarness(isKbm);
        h.openLogModal('activity');
        await h.saveLogDraft();
        const payload = h.dependencies.cfSaveWorkloadLog.mock.calls[0][0];
        expect(payload).toMatchObject({ status_execution: 'draft', title: 'Rencana awal', catalog_id: h.state.segments[0].catalog_id });
        expect(payload).not.toHaveProperty('draft_status_execution');
    });

    test('draf biasa tetap mengikuti status finalisasi semula setelah waktunya selesai', () => {
        const h = makeHarness(isKbm);
        seedDraft(h, false);
        jest.setSystemTime(new Date('2026-10-22T04:10:00Z'));
        h.openEditLogModal('log');
        expect(input('log-input-status-execution').value).toBe(isKbm ? 'tidak_terlaksana' : 'terlaksana');
    });
});
