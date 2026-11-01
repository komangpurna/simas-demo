/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

// Execute the real handlers without starting authentication or remote module imports.
function extract(file, names) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    return acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.flatMap(entry => {
        const node = entry.type === 'ExportNamedDeclaration' ? entry.declaration : entry;
        const name = node?.type === 'VariableDeclaration' ? node.declarations[0].id.name
            : node?.type === 'FunctionDeclaration' ? node.id.name
            : node?.expression?.left?.object?.name === 'window' ? node.expression.left.property.name : null;
        return names.has(name) ? [source.slice(node.start, node.end)] : [];
    }).join('\n');
}

const portalNames = new Set([
    'currentLoadedGradebookScope', 'currentLoadedKehadiranScope', 'currentLoadedJurnalScope', 'currentLoadedLmsScope',
    'portalDataRevision', 'portalFilterSelection', 'portalLoadSequences', 'previouslyLoadedPortalTabs', 'sessionPortalDataCache',
    'getPortalFilterSelection', 'beginPortalDataLoad', 'deferUnsavedPortalFilterChange',
    'raporConfig', 'assignedMapelMap', 'loadedStudents', 'isGradebookDirty', 'setGradebookDirty', 'confirmUnsavedChanges',
    'supabaseComponentMap', 'existingScoresMap', 'existingSummariesMap', 'minRequiredTugasCount', 'minRequiredSumatifCount',
    'sessionGradebookCache', 'getLoadedStudents', 'loadGradebookData', 'executeLoadGradebookData', 'fetchScoresFromSupabase',
    'resetPortalTablesToEmpty', 'checkAutoLoadSessionCache', 'onKelasChange', 'onMapelChange', 'onSemesterChange',
    'currentJurnalAllList', 'selectedJurnalMonth', 'loadDaftarJurnalData', 'loadKehadiranSiswaData',
    'currentLmsTopics', 'currentLmsModules', 'currentLmsMaterials', 'currentLmsSubView', 'currentLmsAnalytics',
    'currentLmsAnalyticsTopicId', 'currentLmsAnalyticsMaterialId', 'lmsAnalyticsCache', 'lmsLoadSequence',
    'loadLmsData', 'renderLmsClassAnalytics', 'switchGuruMapelTab'
]);
const portalSource = extract('js/page-guru-mapel.js', portalNames);
const aiSource = extract('js/gemini-grading.js', new Set([
    'AI_GRADING_STATE', 'aiGradingScopeCache', 'activeAiGradingScope', 'aiGradingScopeRevision',
    'beginAiScopeTask', 'matchesAiGradingScope', 'syncAiGradingScope', 'handleSingleStudentPhotoUpload', 'loadAiGradingSession'
]));

function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function setup(overrides = {}) {
    document.body.innerHTML = `
        <select id="select-kelas"><option value="">Pilih</option><option>X-A</option><option>X-B</option><option>X-C</option></select>
        <select id="select-mapel"><option value="">Pilih</option><option>Matematika</option><option>Fisika</option></select>
        <select id="select-semester"><option>1</option><option>2</option></select>
        <input id="input-ai-session-title">
        <button id="btn-load-data">Load</button><span id="student-count-badge"></span>
        <div id="table-scope-title"></div>
        ${['penilaian', 'kehadiran', 'jurnal', 'lms', 'koreksi-ai'].map(tab => `<div id="panel-${tab}" class="${tab === 'penilaian' ? '' : 'hidden'}"></div>`).join('')}
        ${['gradebook-table-wrapper', 'kehadiran-table-wrapper', 'jurnal-table-wrapper', 'lms-topics-container',
        'lms-materials-empty-state', 'lms-materials-health-summary', 'gradebook-analytics-wrapper', 'jurnal-filter-bar',
        'kehadiran-filter-bar', 'top-save-bar', 'bottom-save-bar', 'wrapper-class-cp', 'lms-analytics-discussion-badge'].map(id => `<div id="${id}">OLD CLASS</div>`).join('')}
        <table><tbody id="tbody-lms-analytics"><tr><td>OLD CLASS</td></tr></tbody></table>
        ${['total-students', 'sangat-aktif', 'aktif', 'perlu-perhatian', 'avg-completion'].map(id => `<span id="lms-stat-${id}">99</span>`).join('')}
        <span id="lms-analytics-scope-label">OLD CLASS</span>`;
    document.getElementById('select-kelas').value = 'X-A';
    document.getElementById('select-mapel').value = 'Matematika';
    const mocks = {
        escapeHTML: value => String(value || ''),
        getCurrentAcademicYearString: () => '2026/2027',
        updateHeaderGuruName: jest.fn(),
        getMapelsForClass: (map, kelas) => Object.keys(map).filter(mapel => map[mapel].includes(kelas)),
        getMapelNameCandidates: value => [value],
        isMapelMatching: (value, candidates) => candidates.includes(value),
        getLocalCache: jest.fn(() => null), setLocalCache: jest.fn(),
        populateLmsAnalyticsTopicSelector: jest.fn(),
        renderGradebookTable: jest.fn(() => { document.getElementById('gradebook-table-wrapper').textContent = window.getLoadedStudents().map(s => s.name).join(','); }),
        renderLmsMaterialsList: jest.fn(), loadLocalConfig: jest.fn(), normalizeLmsAnalyticsPayload: value => value,
        showToast: jest.fn(), showModernAlert: jest.fn(), isClassEqual: (a, b) => a === b,
        cfClient: { enabled: true, getStudents: jest.fn(async () => []), getJurnalKbm: jest.fn(async () => []) },
        cfGetLmsTopics: jest.fn(async () => []), cfGetLmsMaterials: jest.fn(async () => []), cfGetLmsModules: jest.fn(async () => []), cfGetLmsClassAnalytics: jest.fn(async () => null),
        supabase: null, canAccessKoreksiAi: () => true,
        updatePerhotelanToggleButton: jest.fn(), isPerhotelanMapel: () => false,
        console: { log() {}, warn() {}, error: jest.fn() }
    };
    Object.assign(mocks, overrides);
    window.adjustMapelSelectWidth = jest.fn();
    window.getStudentsCache = jest.fn(async () => []);
    window.showConfirmModal = jest.fn(async () => false);
    delete window.syncAiGradingScope;
    delete window.renderStudentSubmissionsUI;
    const run = new Function(...Object.keys(mocks), `${portalSource}\nreturn code => eval(code);`)(...Object.values(mocks));
    run("assignedMapelMap = { Matematika: ['X-A', 'X-B'], Fisika: ['X-A'] }");
    return { run, mocks };
}

function activate(tab) {
    ['penilaian', 'kehadiran', 'jurnal', 'lms', 'koreksi-ai'].forEach(name =>
        document.getElementById(`panel-${name}`).classList.toggle('hidden', name !== tab));
}

describe('Guru Mapel filter isolation', () => {
    test.each(['X-B', '', 'X-C'])('class change to %s clears every panel, roster, scores, and LMS statistics', kelas => {
        const { run } = setup();
        run("loadedStudents = [{ nis: '1', name: 'OLD CLASS' }]; existingScoresMap = { 1: { tugas_1: 90 } }; currentLmsTopics = [{ id: 'old' }]");
        document.getElementById('select-kelas').value = kelas;
        window.onKelasChange();
        ['gradebook-table-wrapper', 'kehadiran-table-wrapper', 'jurnal-table-wrapper', 'lms-topics-container', 'tbody-lms-analytics'].forEach(id =>
            expect(document.getElementById(id).textContent).not.toContain('OLD CLASS'));
        expect(window.getLoadedStudents()).toEqual([]);
        expect(run('existingScoresMap')).toEqual({});
        expect(run('currentLmsTopics')).toEqual([]);
        expect(document.getElementById('lms-stat-total-students').textContent).toBe('0');
        expect(document.getElementById('lms-stat-avg-completion').textContent).toBe('0%');
    });

    test.each(['select-mapel', 'select-semester'])('%s change clears inactive panels as well', id => {
        setup();
        document.getElementById(id).value = id === 'select-mapel' ? 'Fisika' : '2';
        window[id === 'select-mapel' ? 'onMapelChange' : 'onSemesterChange']();
        expect(document.getElementById('lms-topics-container').textContent).toBe('');
        expect(document.getElementById('jurnal-table-wrapper').textContent).not.toContain('OLD CLASS');
    });

    test('restores only the selected class cache and still clears hidden tabs', async () => {
        const { run } = setup();
        run(`sessionGradebookCache['2026-2027_S1_X-B_Matematika'] = {
            students: [{ nis: '2', name: 'Budi kelas B' }], scoresMap: { 2: { tugas_1: 80 } },
            summariesMap: {}, componentMap: { tugas_1: 'component-b' }, minTugas: 2
        }`);
        document.getElementById('select-kelas').value = 'X-B';
        window.onKelasChange();
        expect(document.getElementById('gradebook-table-wrapper').textContent).toBe('Budi kelas B');
        expect(run('supabaseComponentMap')).toEqual({ tugas_1: 'component-b' });
        expect(run('minRequiredTugasCount')).toBe(2);
        expect(document.getElementById('jurnal-table-wrapper').textContent).not.toContain('OLD CLASS');
        expect(document.getElementById('lms-topics-container').textContent).toBe('');
    });

    test.each(['kehadiran', 'jurnal', 'lms'])('reloads the active %s tab after a previous load without requiring a gradebook cache', async tab => {
        const { run } = setup();
        activate(tab);
        run(`previouslyLoadedPortalTabs.add('${tab}')`);
        const load = jest.spyOn(window, 'loadGradebookData').mockResolvedValue();
        document.getElementById('select-kelas').value = 'X-B';
        window.onKelasChange();
        expect(load).toHaveBeenCalledWith(false);
        load.mockRestore();
    });

    test('keeps filters and unsaved scores when cancelling; discarding applies the new filter', async () => {
        const { run } = setup();
        window.checkAutoLoadSessionCache();
        run("loadedStudents = [{ nis: '1', name: 'Draft' }]; setGradebookDirty(true)");
        document.getElementById('select-kelas').value = 'X-B';
        window.onKelasChange();
        await Promise.resolve();
        expect(document.getElementById('select-kelas').value).toBe('X-A');
        expect(window.getLoadedStudents()[0].name).toBe('Draft');
        window.showConfirmModal.mockResolvedValueOnce(true);
        document.getElementById('select-kelas').value = 'X-B';
        window.onKelasChange();
        await Promise.resolve();
        expect(document.getElementById('select-kelas').value).toBe('X-B');
        expect(window.getLoadedStudents()).toEqual([]);
    });

    test.each(['penilaian', 'kehadiran', 'jurnal', 'lms'])('late %s responses cannot repopulate a reset page, including A → B → A', async tab => {
        const { mocks } = setup();
        const pending = deferred();
        const loader = { penilaian: 'loadGradebookData', kehadiran: 'loadKehadiranSiswaData', jurnal: 'loadDaftarJurnalData', lms: 'loadLmsData' }[tab];
        activate(tab);
        if (tab === 'penilaian' || tab === 'kehadiran') window.getStudentsCache.mockReturnValue(pending.promise);
        if (tab === 'jurnal') mocks.cfClient.getJurnalKbm.mockReturnValue(pending.promise);
        if (tab === 'lms') mocks.cfGetLmsTopics.mockReturnValue(pending.promise);
        const loading = window[loader]();
        document.getElementById('select-kelas').value = 'X-B';
        window.onKelasChange();
        document.getElementById('select-kelas').value = 'X-A';
        window.onKelasChange();
        const before = document.body.innerHTML;
        pending.resolve([{ nis: '1', name: 'OLD RESPONSE', class: 'X-A', id: 'old' }]);
        await loading;
        expect(document.body.innerHTML).toBe(before);
        expect(window.getLoadedStudents()).toEqual([]);
    });

    test('switching from attendance to grades loads scores even when the roster is already present', () => {
        const { run } = setup();
        run("loadedStudents = [{ nis: '1', name: 'Budi' }]");
        const load = jest.spyOn(window, 'loadGradebookData').mockResolvedValue();
        window.switchGuruMapelTab('penilaian');
        expect(load).toHaveBeenCalledWith(false);
        load.mockRestore();
    });

    test('late score responses cannot overwrite the newly selected class', async () => {
        const { run } = setup({ supabase: {} });
        const pending = deferred();
        window.fetchAllSupabaseRows = jest.fn((_, table) => table === 'guru_mapel_scores'
            ? pending.promise : Promise.resolve({ data: null }));
        const loading = run('fetchScoresFromSupabase')('old', run("beginPortalDataLoad('penilaian')"));
        document.getElementById('select-kelas').value = 'X-B';
        window.onKelasChange();
        run('existingScoresMap = { new: { tugas_1: 80 } }');
        pending.resolve({ data: [{ student_nis: 'old', component_id: 'old-component', score: 99 }] });
        await loading;
        expect(run('existingScoresMap')).toEqual({ new: { tugas_1: 80 } });
    });

    test.each(['kehadiran', 'jurnal', 'lms'])('%s returns to a previously opened class without server reads; Load explicitly refreshes it', async tab => {
        const { run, mocks } = setup();
        activate(tab);
        mocks.cfGetLmsTopics.mockImplementation(async ({ class: kelas }) => [{ id: kelas, title: `Topik ${kelas}` }]);
        const load = jest.spyOn(window, 'loadGradebookData');
        const request = tab === 'lms' ? mocks.cfGetLmsTopics : mocks.cfClient.getJurnalKbm;
        await window.loadGradebookData();
        expect(mocks.console.error).not.toHaveBeenCalled();
        expect(request).toHaveBeenCalledTimes(1);
        for (const kelas of ['X-B', 'X-A']) {
            document.getElementById('select-kelas').value = kelas;
            window.onKelasChange();
            await load.mock.results.at(-1).value;
        }
        expect(request).toHaveBeenCalledTimes(2);
        expect(run(`currentLoaded${{ kehadiran: 'Kehadiran', jurnal: 'Jurnal', lms: 'Lms' }[tab]}Scope`))
            .toBe('2026/2027_1_X-A_Matematika');
        if (tab === 'kehadiran') expect(mocks.cfClient.getStudents).toHaveBeenCalledTimes(2);
        if (tab === 'lms') {
            expect(run('currentLmsTopics[0].id')).toBe('X-A');
            expect(mocks.cfGetLmsMaterials).toHaveBeenCalledTimes(2);
            expect(mocks.cfGetLmsClassAnalytics).toHaveBeenCalledTimes(2);
        }
        await window.loadGradebookData();
        expect(request).toHaveBeenCalledTimes(3);
        expect(mocks.showModernAlert).not.toHaveBeenCalled();
        load.mockRestore();
    });
});

describe('Koreksi AI scope isolation',()=>{
    const {gradingHarness,deferred}=require('./helpers/ai-grading-harness.cjs');
    let h;afterEach(()=>h?.close());
    test('restores the earlier class draft without mixing class state',()=>{
        h=gradingHarness();h.state.submissions['1001']={name:'Budi',imageBase64:'photo'};
        h.w.document.getElementById('input-ai-session-title').value='Asesmen A';
        h.w.syncAiGradingScope({...h.scope,kelas:'X-B'});expect(h.state.questions).toEqual([]);expect(h.state.submissions).toEqual({});
        h.w.syncAiGradingScope(h.scope);expect(h.state.submissions['1001'].imageBase64).toBe('photo');
        expect(h.w.document.getElementById('input-ai-session-title').value).toBe('Asesmen A');
    });
    test('ignores a saved session response after changing class',async()=>{
        h=gradingHarness();const pending=deferred();h.w.cfGetAiGradingSession=()=>pending.promise;
        const loading=h.w.loadAiGradingSession('X-A_1');h.w.syncAiGradingScope({...h.scope,kelas:'X-B'});
        pending.resolve({...h.scope,id:'X-A_1',teacher_id:'teacher-a',questions:[]});await loading;
        expect(h.state.sessionId).toBeNull();expect(h.state.kelas).toBe('X-B');
    });
    test.each([{kelas:'X-B'},{semester:'2'},{mapel:'Fisika'}])('rejects sessions outside active filters: %j',async other=>{
        h=gradingHarness();h.w.cfGetAiGradingSession=async()=>({...h.scope,...other,id:'other',teacher_id:'teacher-a',questions:[]});
        expect(await h.w.loadAiGradingSession('other')).toBe(false);
    });
});
