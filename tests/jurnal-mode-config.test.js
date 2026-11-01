const fs = require('fs');
const path = require('path');
const vm = require('vm');
const acorn = require('acorn');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/page-jurnal.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
function code(name) {
    const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name ||
        n.type === 'ExpressionStatement' && n.expression.type === 'AssignmentExpression' && n.expression.left.property?.name === name);
    if (!node) throw new Error(name);
    return source.slice(node.start, node.end);
}
function section(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
function deferred() {
    let resolve;
    const promise = new Promise(yes => { resolve = yes; });
    return { promise, resolve };
}
const response = mode => ({ ok: true, json: async () => ({ success: true, data: { mode_daring: mode } }) });

function harness(mode = true) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'jurnal.html'), 'utf8'), { url: 'https://jurnal.test/jurnal.html' });
    const ctx = {
        document: dom.window.document, localStorage: dom.window.localStorage, location: dom.window.location,
        URLSearchParams, AbortController, setTimeout, clearTimeout,
        console: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
        fetch: jest.fn().mockResolvedValue(response(mode)),
        CloudflareAPI: { isEnabled: true, baseUrl: 'https://worker.test', getHeaders: jest.fn().mockResolvedValue({}),
            getMasterBundle: jest.fn().mockResolvedValue({ mode_daring: mode, teachers: [{ id: 'gtk-1', nama: 'Guru Uji' }] }) },
        navigator: { geolocation: { getCurrentPosition: jest.fn() } },
        stopGpsRetry: jest.fn(), attemptGps: jest.fn(), safeRenderLucide: jest.fn(), loadDailyRecap: jest.fn(),
        checkSystemVersionAndInvalidateCache: jest.fn().mockResolvedValue(), sortSchoolClasses: data => data,
        selectClass: jest.fn().mockResolvedValue(), renderGuruDropdown: jest.fn(), showToast: jest.fn()
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext([
        section('// --- APP STATE ---', '// --- UNIVERSAL DATE PARSER ---'),
        section('const CacheHelper =', 'function sortSchoolClasses('),
        section('function normalizeTeacherName(', '// --- JOURNAL TEACHER VERIFICATION ---'),
        section('// --- JOURNAL TEACHER VERIFICATION ---', 'async function loadAndParseScheduleXML('),
        ...['applyJournalModeConfig', 'fetchAppConfig', 'applyModeDaringUI', 'switchHomeTab', 'fetchWithTimeout',
            'getTeachersForClass', 'getSilentLocation', 'refreshClassData', 'ensureMasterData'].map(code),
        'window.cache = CacheHelper;',
        'window.setClass = () => { currentClass = { name: "X-1" }; document.getElementById("screen-form").classList.remove("hidden"); };',
        'window.setCoordinates = value => { geoCoordinates = value; }; window.getCoordinates = () => geoCoordinates;'
    ].join('\n'), ctx);
    return { ctx, el: id => dom.window.document.getElementById(id) };
}

afterEach(() => jest.useRealTimers());

test.each([[false, true], [true, false]])('cache mode %s diperbarui dari server menjadi %s tanpa mengambil bundle guru', async (old, fresh) => {
    const { ctx, el } = harness(fresh);
    ctx.cache.set('app_mode_daring_config', old);
    await ctx.fetchAppConfig();
    expect(ctx.isModeDaring).toBe(fresh);
    expect(ctx.cache.get('app_mode_daring_config')).toBe(fresh);
    expect(ctx.fetch.mock.calls[0][0]).toBe('https://worker.test/api/jurnal/settings?refresh=1');
    expect(ctx.fetch.mock.calls[0][1].cache).toBe('no-store');
    expect(ctx.CloudflareAPI.getMasterBundle).not.toHaveBeenCalled();
    expect(el('file-camera').hasAttribute('capture')).toBe(!fresh);
    expect(el('photo-btn-text').textContent).toBe(fresh ? 'Pilih Galeri' : 'Kamera HD');
});

test('gagal membaca konfigurasi pertama tidak menyimpan default luring sebagai cache', async () => {
    const { ctx } = harness(); ctx.fetch.mockRejectedValue(new Error('offline'));
    await ctx.fetchAppConfig();
    expect(ctx.cache.get('app_mode_daring_config')).toBeNull();
});

test('gangguan jaringan mempertahankan mode dan umur cache terakhir yang berhasil', async () => {
    const { ctx } = harness(); ctx.cache.set('app_mode_daring_config', true);
    const saved = ctx.localStorage.getItem('app_mode_daring_config');
    ctx.fetch.mockRejectedValue(new Error('offline'));
    await ctx.fetchAppConfig();
    expect(ctx.isModeDaring).toBe(true);
    expect(ctx.localStorage.getItem('app_mode_daring_config')).toBe(saved);
});

test('panggilan bersamaan berbagi satu request konfigurasi', async () => {
    const { ctx } = harness(); const gate = deferred(); ctx.fetch.mockReturnValue(gate.promise);
    const first = ctx.fetchAppConfig(); const second = ctx.fetchAppConfig();
    gate.resolve(response(true)); await Promise.all([first, second]);
    expect(ctx.fetch).toHaveBeenCalledTimes(1);
    expect(ctx.isModeDaring).toBe(true);
});

test.each(['token', 'header', 'body'])('batas waktu mencakup fase %s dan hasil terlambat tidak mengubah mode', async phase => {
    jest.useFakeTimers();
    const { ctx } = harness(); const gate = deferred();
    if (phase === 'token') ctx.CloudflareAPI.getHeaders.mockReturnValue(gate.promise);
    if (phase === 'header') ctx.fetch.mockReturnValue(gate.promise);
    if (phase === 'body') ctx.fetch.mockResolvedValue({ ok: true, json: () => gate.promise });
    const pending = ctx.fetchAppConfig();
    await jest.advanceTimersByTimeAsync(12000); await pending;
    expect(ctx.cache.get('app_mode_daring_config')).toBeNull();
    if (phase === 'token') gate.resolve({});
    if (phase === 'header') gate.resolve(response(true));
    if (phase === 'body') gate.resolve({ success: true, data: { mode_daring: true } });
    await jest.advanceTimersByTimeAsync(0);
    expect(ctx.isModeDaring).toBe(false);
    expect(ctx.cache.get('app_mode_daring_config')).toBeNull();
    ctx.CloudflareAPI.getHeaders.mockResolvedValue({}); ctx.fetch.mockResolvedValue(response(true));
    await ctx.fetchAppConfig(); expect(ctx.isModeDaring).toBe(true);
});

test('tombol perbarui menerapkan mode dari bundle segar walaupun cache sebelumnya luring', async () => {
    const { ctx } = harness(); ctx.setClass(); ctx.cache.set('app_mode_daring_config', false);
    await ctx.refreshClassData();
    expect(ctx.CloudflareAPI.getMasterBundle).toHaveBeenCalledWith(true);
    expect(ctx.isModeDaring).toBe(true);
    expect(ctx.cache.get('app_mode_daring_config')).toBe(true);
    expect(ctx.selectClass).toHaveBeenCalledWith('X-1');
});

test('perubahan mode menyelaraskan GPS dan galeri tanpa menghapus isian aktif', async () => {
    const { ctx, el } = harness(); ctx.setClass();
    el('input-guru').value = 'Guru Uji'; el('input-topik').value = 'Materi tetap'; el('input-catatan').value = 'Catatan tetap';
    el('image-preview').src = 'https://foto.test/tersimpan.jpg';
    ctx.setCoordinates({ lat: -8, lng: 115 });
    ctx.applyJournalModeConfig(true);
    expect(JSON.stringify(ctx.getCoordinates())).toBe('{"lat":0,"lng":0}');
    ctx.applyJournalModeConfig(false);
    expect(ctx.getCoordinates()).toBeNull(); expect(ctx.attemptGps).toHaveBeenCalledTimes(1);
    expect(el('input-guru').value).toBe('Guru Uji'); expect(el('input-topik').value).toBe('Materi tetap');
    expect(el('input-catatan').value).toBe('Catatan tetap'); expect(el('image-preview').src).toBe('https://foto.test/tersimpan.jpg');
});

test('edit jurnal mempertahankan koordinat historis ketika mode berubah', () => {
    const { ctx } = harness(); ctx.setClass(); ctx.currentEditDocId = 'lama';
    ctx.setCoordinates({ lat: -8, lng: 115 }); ctx.applyJournalModeConfig(true);
    expect(JSON.stringify(ctx.getCoordinates())).toBe('{"lat":-8,"lng":115}');
    expect(ctx.attemptGps).not.toHaveBeenCalled();
});

test('tab daring tampil kembali setelah mode dimatikan lalu diaktifkan tanpa memaksa pindah dari tab rekap', () => {
    const { ctx, el } = harness();
    ctx.applyJournalModeConfig(true); ctx.applyJournalModeConfig(false); ctx.applyJournalModeConfig(true);
    expect(el('view-daring-classes').classList.contains('hidden')).toBe(false);
    ctx.switchHomeTab('rekap'); ctx.applyJournalModeConfig(false); ctx.applyJournalModeConfig(true);
    expect(el('view-recap-today').classList.contains('hidden')).toBe(false);
    expect(el('view-daring-classes').classList.contains('hidden')).toBe(true);
});

test('cache yang tidak bisa ditulis tidak menimpa mode segar pada pemanggilan berikutnya', async () => {
    const { ctx } = harness(); ctx.cache.set('app_mode_daring_config', false);
    ctx.cache.set = jest.fn(); await ctx.fetchAppConfig();
    ctx.fetch.mockRejectedValue(new Error('offline')); await ctx.fetchAppConfig();
    expect(ctx.isModeDaring).toBe(true);
});

test.each([{ success: false, data: {} }, { data: null }, { data: [] }, { data: { mode_daring: 'false' } }])('respons rusak tidak disimpan sebagai keputusan mode', async data => {
    const { ctx } = harness(); ctx.fetch.mockResolvedValue({ ok: true, json: async () => data });
    await ctx.fetchAppConfig(); expect(ctx.cache.get('app_mode_daring_config')).toBeNull();
});

test('setting yang belum dibuat memakai default normal setelah respons server berhasil', async () => {
    const { ctx } = harness(); ctx.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
    await ctx.fetchAppConfig(); expect(ctx.cache.get('app_mode_daring_config')).toBe(false);
});

test('bundle menjadi fallback saat konfigurasi gagal tanpa mengunci mode fallback sebagai cache segar', async () => {
    const { ctx } = harness(); ctx.fetch.mockRejectedValue(new Error('offline'));
    await ctx.fetchAppConfig(); await ctx.ensureMasterData();
    expect(ctx.isModeDaring).toBe(true);
    expect(ctx.cache.get('app_mode_daring_config')).toBeNull();
    ctx.fetch.mockResolvedValue(response(false)); await ctx.fetchAppConfig();
    expect(ctx.isModeDaring).toBe(false);
});

test('bundle lama tidak menimpa status yang baru diverifikasi', async () => {
    const { ctx } = harness(false); await ctx.fetchAppConfig();
    ctx.CloudflareAPI.getMasterBundle.mockResolvedValue({ mode_daring: true, teachers: [{ id: 'gtk', nama: 'Guru Uji' }] });
    await ctx.ensureMasterData(); expect(ctx.isModeDaring).toBe(false);
    expect(ctx.cache.get('app_mode_daring_config')).toBe(false);
});
