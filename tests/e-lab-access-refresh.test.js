/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

// Execute the production functions, with only network/render dependencies mocked.
const source = fs.readFileSync(path.join(__dirname, '../js/page-e-lab.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const functions = new Set([
    'isLabAdminUser', 'isUserCoordinatorForLab', 'isUserCoordinatorForAnyLab',
    'canUserManageLab', 'getAccessibleLabsForWrite', 'syncLabAccessUI',
    'refreshLabAccess', 'loadLabs', 'fetchLabs', 'updateInventoryAddButtonVisibility',
    'populateLabFilters', 'populateFilterLabOptions', 'escapeHtml', 'safeCloseModal'
]);
const state = new Set([
    'currentUser', 'currentRole', 'labsList', 'labsAccessVerified', 'labsLoadPromise',
    'labsLoadUid', 'labPageReady', 'lastLabAccessRefreshAt', 'isKepalaLab',
    'selectedInventoryItem', 'currentInventoryLabFilter', 'filterLab'
]);
const production = ast.body.filter(node =>
    (node.type === 'FunctionDeclaration' && functions.has(node.id.name)) ||
    (node.type === 'VariableDeclaration' && node.declarations.every(decl => state.has(decl.id.name)))
).map(node => source.slice(node.start, node.end)).join('\n');

const lab = (id, uid) => ({ id, nama: `Lab ${id}`, koordinator_uid: uid });
const hidden = id => document.getElementById(id).classList.contains('hidden');
let context;
let api;
let pendingBookings;
let history;

function run(code) { return vm.runInContext(code, context); }
function assign(labs, verified = true) {
    context.nextLabs = labs;
    run(`labsList = nextLabs; labsAccessVerified = ${verified};`);
}

beforeEach(() => {
    document.body.innerHTML = `
        <button class="tab-btn active" data-tab="jadwal"></button>
        <button id="btn-tab-approval" class="hidden"></button>
        <button id="btn-tab-pengaturan" class="hidden"></button>
        <div id="riwayat-filter-owner-container" class="hidden"></div>
        <select id="riwayat-filter-owner"><option value="mine">Mine</option><option value="all">All</option></select>
        <span id="badge-pending" class="hidden"></span>
        <table><tbody id="pending-bookings-body"></tbody></table>
        <p id="lab-access-summary" class="hidden"></p>
        <button id="btn-inv-add-item" class="hidden" style="display:none"></button>
        <button id="btn-inv-import-excel" class="hidden" style="display:none"></button>
        <button id="empty-add" class="inv-auth-add-btn hidden" style="display:none"></button>
        <div id="detail-inv-actions" class="hidden"></div>
        <select id="booking-lab"></select><select id="filter-lab"></select>
        <select id="approval-filter-lab"></select><select id="inv-filter-lab"></select>
        <select id="inv-form-lab"><option value="bio">Bio</option></select>
        <select id="inv-import-lab"><option value="bio">Bio</option></select>
        <div id="modal-booking-detail"></div><div id="modal-inventory-form"></div>
        <div id="modal-inventory-import"></div><div id="modal-inventory-condition"></div>`;
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    api = { getLabs: jest.fn() };
    pendingBookings = jest.fn().mockResolvedValue(undefined);
    history = jest.fn().mockResolvedValue(undefined);
    window.loadPendingBookings = pendingBookings;
    window.loadMyBookingHistory = history;
    window.switchTab = jest.fn();
    window.escapeHTML = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    window.closeModal = id => document.getElementById(id)?.classList.add('hidden');
    context = vm.createContext({
        document, window, localStorage, sessionStorage, cfClient: api, Date,
        console: { error: jest.fn(), warn: jest.fn() },
        renderManageLabsList: jest.fn(), showToast: jest.fn()
    });
    run(production);
    run("currentUser = { uid: 'teacher' }; currentRole = 'guru_mapel'; labPageReady = true;");
});

test('cached assignment cannot grant access before the server responds', async () => {
    localStorage.setItem('simas_elab_labs_cache', JSON.stringify([lab('bio', 'teacher')]));
    let resolve;
    api.getLabs.mockReturnValue(new Promise(done => { resolve = done; }));
    const loading = run('loadLabs()');
    expect(api.getLabs).toHaveBeenCalledTimes(1);
    expect(run('labsList.length')).toBe(1);
    expect(run("canUserManageLab('bio')")).toBe(false);
    resolve([lab('bio', 'replacement')]);
    await loading;
    expect(run("canUserManageLab('bio')")).toBe(false);
    expect(hidden('btn-tab-approval')).toBe(true);
});

test('new coordinator gets approval, inventory buttons and a lab badge', async () => {
    assign([lab('bio', 'someone')]);
    api.getLabs.mockResolvedValue([lab('bio', 'teacher'), lab('kim', 'someone')]);
    await run('loadLabs(true)');
    expect(run("canUserManageLab('bio')")).toBe(true);
    expect(run("canUserManageLab('kim')")).toBe(false);
    expect(hidden('btn-tab-approval')).toBe(false);
    expect(hidden('btn-tab-pengaturan')).toBe(true);
    expect(hidden('btn-inv-add-item')).toBe(false);
    expect(document.getElementById('lab-access-summary').textContent).toBe('Koordinator: Lab bio');
    expect([...document.getElementById('approval-filter-lab').options].map(option => option.value)).toEqual(['', 'bio']);
    expect(pendingBookings).toHaveBeenCalledTimes(1);
});

test('revocation hides open actions, resets history and leaves the approval tab', async () => {
    assign([lab('bio', 'teacher')]);
    run("selectedInventoryItem = { lab_id: 'bio' }; syncLabAccessUI();");
    document.querySelector('.tab-btn.active').dataset.tab = 'approval';
    document.getElementById('riwayat-filter-owner').value = 'all';
    document.getElementById('pending-bookings-body').innerHTML = '<tr><td>Old action</td></tr>';
    api.getLabs.mockResolvedValue([lab('bio', 'replacement')]);
    await run('loadLabs(true)');
    for (const id of ['btn-tab-approval', 'btn-inv-add-item', 'btn-inv-import-excel', 'empty-add',
        'detail-inv-actions', 'modal-inventory-form', 'modal-inventory-import',
        'modal-inventory-condition', 'modal-booking-detail', 'lab-access-summary']) {
        expect(hidden(id)).toBe(true);
    }
    expect(window.switchTab).toHaveBeenCalledWith('jadwal');
    expect(document.getElementById('pending-bookings-body').innerHTML).toBe('');
    expect(document.getElementById('riwayat-filter-owner').value).toBe('mine');
    expect(history).toHaveBeenCalledTimes(1);
    expect(pendingBookings).not.toHaveBeenCalled();
});

test('failed refresh keeps the lab list readable but disables coordinator actions', async () => {
    assign([lab('bio', 'teacher')]);
    api.getLabs.mockRejectedValue(new Error('Offline'));
    expect(await run('loadLabs(true)')).toBe(false);
    expect(run('labsList.length')).toBe(1);
    expect(run("isUserCoordinatorForLab('bio')")).toBe(false);
    expect(hidden('btn-inv-add-item')).toBe(true);
    api.getLabs.mockResolvedValue([lab('bio', 'teacher')]);
    await run("refreshLabAccess({ type: 'online' })");
    expect(hidden('btn-inv-add-item')).toBe(false);
});

test('overlapping refreshes share one request and release it for the next refresh', async () => {
    let resolve;
    api.getLabs.mockReturnValue(new Promise(done => { resolve = done; }));
    const first = run('loadLabs(true)');
    const second = run('loadLabs(true)');
    expect(api.getLabs).toHaveBeenCalledTimes(1);
    resolve([]);
    await Promise.all([first, second]);
    api.getLabs.mockResolvedValue([]);
    await run('loadLabs(true)');
    expect(api.getLabs).toHaveBeenCalledTimes(2);
});

test('refresh preserves the booking lab and schedule filters', async () => {
    assign([lab('bio', 'teacher'), lab('kim', 'other')]);
    for (const id of ['booking-lab', 'filter-lab', 'approval-filter-lab']) {
        document.getElementById(id).innerHTML = '<option value="bio" selected>Bio</option>';
    }
    api.getLabs.mockResolvedValue([lab('bio', 'teacher'), lab('kim', 'other')]);
    await run('loadLabs(true)');
    for (const id of ['booking-lab', 'filter-lab', 'approval-filter-lab']) {
        expect(document.getElementById(id).value).toBe('bio');
    }
    expect(pendingBookings).not.toHaveBeenCalled();
});

test('focus and visibility refresh only when ready and visible, and coalesce events', async () => {
    api.getLabs.mockResolvedValue([]);
    run('labPageReady = false;');
    await run('refreshLabAccess()');
    expect(api.getLabs).not.toHaveBeenCalled();
    run('labPageReady = true;');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await run('refreshLabAccess()');
    expect(api.getLabs).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await run("refreshLabAccess({ type: 'focus' })");
    await run("refreshLabAccess({ type: 'visibilitychange' })");
    expect(api.getLabs).toHaveBeenCalledTimes(1);
    await run("refreshLabAccess({ type: 'online' })");
    expect(api.getLabs).toHaveBeenCalledTimes(2);
});

test.each(['admin', 'super_admin', 'kepala_lab'])('%s retains global access across lab assignments', async role => {
    context.role = role;
    run("currentRole = role; isKepalaLab = role === 'kepala_lab';");
    api.getLabs.mockResolvedValue([lab('bio', 'other'), lab('kim', 'other')]);
    await run('loadLabs(true)');
    expect(run("canUserManageLab('bio')")).toBe(true);
    expect(run("canUserManageLab('kim')")).toBe(true);
    expect(hidden('btn-tab-pengaturan')).toBe(false);
});

test('a response from the previous account cannot replace the current assignment', async () => {
    let resolve;
    api.getLabs.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const previous = run('loadLabs(true)');
    run("currentUser = { uid: 'replacement' }; labsAccessVerified = false;");
    api.getLabs.mockResolvedValueOnce([lab('kim', 'replacement')]);
    await run('loadLabs(true)');
    resolve([lab('bio', 'teacher')]);
    await previous;
    expect(run("canUserManageLab('kim')")).toBe(true);
    expect(run("canUserManageLab('bio')")).toBe(false);
});

test('production registers refresh handlers for visibility, focus and restored connectivity', () => {
    const registrations = ast.body.filter(node =>
        node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression' &&
        node.expression.arguments[1]?.name === 'refreshLabAccess'
    ).map(node => source.slice(node.start, node.end)).join('\n');
    const onDocument = jest.spyOn(document, 'addEventListener').mockImplementation(() => {});
    const onWindow = jest.spyOn(window, 'addEventListener').mockImplementation(() => {});
    try {
        run(registrations);
        expect(onDocument).toHaveBeenCalledWith('visibilitychange', context.refreshLabAccess);
        expect(onWindow).toHaveBeenCalledWith('focus', context.refreshLabAccess);
        expect(onWindow).toHaveBeenCalledWith('online', context.refreshLabAccess);
    } finally {
        onDocument.mockRestore();
        onWindow.mockRestore();
    }
});

test('the lab client explicitly bypasses the browser HTTP cache', async () => {
    const clientSource = fs.readFileSync(path.join(__dirname, '../js/cloudflare-client.js'), 'utf8');
    const clientAst = acorn.parse(clientSource, { ecmaVersion: 'latest', sourceType: 'module' });
    const clientClass = clientAst.body.find(node => node.type === 'ClassDeclaration' && node.id.name === 'CloudflareClient');
    const method = clientClass.body.body.find(node => node.key.name === 'getLabs');
    const client = vm.runInNewContext(`({${clientSource.slice(method.start, method.end)}})`);
    client.request = jest.fn().mockResolvedValue({ data: [] });
    await client.getLabs();
    expect(client.request).toHaveBeenCalledWith('/api/labs', { method: 'GET', cache: 'no-store' });
});

test('the production server checks the current database assignment on each inventory write', async () => {
    const { buildFlatWorkerSource } = require('./helpers/worker-source.cjs');
    const workerSource = buildFlatWorkerSource();
    const workerAst = acorn.parse(workerSource, { ecmaVersion: 'latest', sourceType: 'module' });
    const authorizationFunctions = new Set(['verifyLabAccess', 'isLabAdmin', 'isKepalaLabUser']);
    const workerCode = workerAst.body.filter(node =>
        node.type === 'FunctionDeclaration' && authorizationFunctions.has(node.id.name)
    ).map(node => workerSource.slice(node.start, node.end)).join('\n');
    let storedLab = lab('bio', 'teacher');
    const first = jest.fn(async () => storedLab);
    const env = { DB: { prepare: () => ({ bind: () => ({ first }) }) } };
    const server = vm.createContext({ env, user: { uid: 'teacher', role: 'guru_mapel' } });
    vm.runInContext(workerCode, server);
    const check = () => vm.runInContext("verifyLabAccess(env, user, 'bio', 'write')", server);
    expect((await check()).allowed).toBe(true);
    storedLab = lab('bio', 'replacement');
    expect(await check()).toMatchObject({ allowed: false, status: 403 });
    server.user = { uid: 'replacement', role: 'guru_mapel' };
    expect((await check()).allowed).toBe(true);
    expect(first).toHaveBeenCalledTimes(3);
});
