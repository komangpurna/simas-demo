const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../js/page-jurnal.js'), 'utf8');
const teacher = { id: 'GTK-1', uid: 'account-1', nama: 'I Made Pengajar, S.Pd.', mapel: 'Matematika', mengajar: [] };
const otherTeacher = { id: 'GTK-2', nama: 'Ni Wayan Guru, S.Pd.', mapel: 'Biologi' };

function section(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    if (from < 0 || to < 0) throw new Error(`Bagian kode tidak ditemukan: ${start}`);
    return source.slice(from, to);
}

function productionFunction(name) {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
    if (!match) throw new Error(`Fungsi tidak ditemukan: ${name}`);
    return match[0];
}

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

// Jalankan pencocokan, pemuatan master, autofill, blur dan preflight submit produksi.
// Handoff GPS/simpan distub; pengujian tidak mengirim jurnal atau foto sungguhan.
function createHarness({ storageDenied = false, writeDenied = false } = {}) {
    const dom = new JSDOM(`<!doctype html><body>
        <input id="input-guru" value="I Made Pengajar, S.Pd."><div id="guru-dropdown" class="hidden"></div>
        <select id="input-mapel"><option>Matematika</option></select><input id="input-mapel-manual">
        <select id="input-lokasi"><option>Ruang Kelas</option></select>
        <textarea id="input-topik">Materi tetap ada</textarea><textarea id="input-catatan">Catatan tetap ada</textarea>
        <div id="preview-container"><img id="image-preview" src="https://photo.test/foto.jpg"></div>
        <canvas id="signature-pad"></canvas><div id="photo-buttons"></div><div id="signature-container"></div>
        <button onclick="submitData()">Simpan Laporan</button><div id="jp-container"></div>
        <button class="jp-btn" data-val="4"></button><button class="jp-btn" data-val="5"></button>
        <div class="student-row" data-id="1" data-name="Siswa Uji"></div><div id="attendance-1" data-value="S"></div>
    </body>`, { url: 'https://jurnal.test/' });
    dom.window.HTMLCanvasElement.prototype.toDataURL = function () {
        return this.id === 'signature-pad' ? 'signature-unchanged' : 'blank';
    };
    const deny = () => { throw new Error('Browser storage denied'); };
    const storage = {
        getItem: storageDenied ? deny : key => dom.window.localStorage.getItem(key),
        setItem: storageDenied || writeDenied ? deny : (key, value) => dom.window.localStorage.setItem(key, value),
        removeItem: storageDenied ? deny : key => dom.window.localStorage.removeItem(key)
    };
    const ctx = {
        document: dom.window.document, localStorage: storage, DOMParser: dom.window.DOMParser,
        setTimeout, clearTimeout, console: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
        CloudflareAPI: { isEnabled: true, getMasterBundle: jest.fn().mockResolvedValue({ teachers: [teacher] }) },
        checkSystemVersionAndInvalidateCache: jest.fn().mockResolvedValue(), sortSchoolClasses: data => data,
        loadAndParseScheduleXML: jest.fn().mockResolvedValue(null), getCurrentJP: () => 4,
        getLessonBlockJPs: () => [4, 5], safeRenderLucide: jest.fn(), showPopup: jest.fn(), showToast: jest.fn(),
        updateTeacherPhotoPreview: jest.fn(), renderTeacherJournalAvatar: () => '',
        filterMapelByGuru: jest.fn(), autoFillTeacherSchedule: jest.fn(), checkManualMapel: jest.fn(),
        checkHistoryTrigger: jest.fn(), showPresensiNav: jest.fn(), debouncedCheckHistoryTrigger: jest.fn(),
        compareWithActualSchedule: jest.fn().mockResolvedValue({ hasSchedule: true, isMatch: true }),
        showConfirmSubmitDialog: jest.fn(), handleGpsAndProceed: jest.fn()
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext([
        section('// --- APP STATE ---', '// --- UNIVERSAL DATE PARSER ---'),
        section('const CacheHelper =', 'function sortSchoolClasses('),
        section('function normalizeTeacherName(', '// --- JOURNAL TEACHER VERIFICATION ---'),
        section('// --- JOURNAL TEACHER VERIFICATION ---', 'async function loadAndParseScheduleXML('),
        productionFunction('getTeachersForClass'), productionFunction('ensureMasterData'),
        productionFunction('autoPopulateSchedule'),
        section('window.refreshClassData = async function', 'safeRenderLucide();\n\nfunction renderAppVersion'),
        section('window.submitData = async function', '// Fungsi lanjutan submit setelah validasi lolos'),
        section('// --- CUSTOM TEACHER DROPDOWN LOGIC ---', '// --- RIWAYAT TOPIK SEBELUMNYA ---'),
        'currentClass = { name: "X-1" }; selectedJp = new Set([4]);',
        'window.setActiveTeachers = data => { activeTeachers = data; };',
        'window.getActiveTeachers = () => activeTeachers;',
        'window.changeClass = name => { currentClass = { name }; };',
        'window.setJps = data => { selectedJp = new Set(data); };',
        'window.setSchedule = data => { cachedScheduleData = data; };',
        'window.setSelectedName = name => { selectedGuruName = name; };'
    ].join('\n'), ctx);
    const el = id => ctx.document.getElementById(id);
    const button = ctx.document.querySelector('button[onclick="submitData()"]');
    const snapshot = () => ({
        guru: el('input-guru').value, mapel: el('input-mapel').value,
        topik: el('input-topik').value, catatan: el('input-catatan').value,
        foto: el('image-preview').src, ttd: el('signature-pad').toDataURL(),
        presensi: el('attendance-1').dataset.value
    });
    return { ctx, dom, el, button, snapshot };
}

afterEach(() => jest.useRealTimers());

test('nama jadwal otomatis memakai record master meskipun daftar aktif kosong; submit normal tanpa request tambahan', async () => {
    const { ctx, el } = createHarness();
    ctx.rememberJournalTeachers([teacher]);
    const schedule = { scheduleMap: { 'X-1': { [new Date().getDay()]: { 4: { guruNama: 'I Made Pengajar', mapel: 'Matematika' } } } } };
    ctx.loadAndParseScheduleXML.mockResolvedValue(schedule);
    await ctx.autoPopulateSchedule('X-1');
    expect(el('input-guru').value).toBe(teacher.nama);
    expect(ctx.getActiveTeachers()[0].id).toBe(teacher.id);
    await ctx.submitData();
    expect(ctx.CloudflareAPI.getMasterBundle).not.toHaveBeenCalled();
    expect(ctx.handleGpsAndProceed).toHaveBeenCalledTimes(1);
    expect(ctx.guruDetailsMap[teacher.nama].uid).toBe(teacher.uid);
});

test('array master kosong tidak menutupi cache guru yang valid', () => {
    const { ctx } = createHarness();
    ctx.localStorage.setItem('data_guru', JSON.stringify({ data: [teacher], timestamp: Date.now() }));
    ctx.allMasterTeachers = [];
    expect(ctx.findJournalTeacher(teacher.nama).id).toBe(teacher.id);
});

test('cache guru dengan format lama atau rusak diabaikan lalu dipulihkan otomatis', async () => {
    const { ctx } = createHarness();
    ctx.localStorage.setItem('data_guru', JSON.stringify({ data: [null, 'Guru Lama'], timestamp: Date.now() }));
    ctx.allMasterTeachers = [{ nama: 123 }];
    await ctx.submitData();
    expect(ctx.CloudflareAPI.getMasterBundle).toHaveBeenCalledWith(true);
    expect(ctx.handleGpsAndProceed).toHaveBeenCalledTimes(1);
});

test.each([{ storageDenied: true }, { writeDenied: true }])('master yang berhasil dimuat tetap dapat dipakai ketika storage bermasalah: %j', async options => {
    const { ctx } = createHarness(options);
    await ctx.ensureMasterData();
    expect(ctx.findJournalTeacher('I Made Pengajar').id).toBe(teacher.id);
    await ctx.submitData();
    expect(ctx.handleGpsAndProceed).toHaveBeenCalledTimes(1);
    expect(ctx.CloudflareAPI.getMasterBundle).toHaveBeenCalledTimes(1);
});

test('storage ditolak tidak menghentikan pembacaan jadwal dari server', async () => {
    const { ctx } = createHarness({ storageDenied: true });
    ctx.CloudflareAPI.getMasterBundle.mockResolvedValue({ schedule_config: { xmlContent: '<timetable><subjects><subject id="s1" name="Matematika"/></subjects></timetable>' } });
    vm.runInContext(productionFunction('loadAndParseScheduleXML'), ctx);
    const schedule = await ctx.loadAndParseScheduleXML();
    expect(schedule.xmlSubjectsList).toEqual(['Matematika']);
});

test('nama tampilan jadwal tanpa record master belum dianggap guru terverifikasi', async () => {
    const { ctx } = createHarness();
    ctx.setActiveTeachers([{ nama: teacher.nama }]);
    expect(ctx.findJournalTeacher(teacher.nama)).toBeNull();
    await ctx.submitData();
    expect(ctx.CloudflareAPI.getMasterBundle).toHaveBeenCalledWith(true);
    expect(ctx.handleGpsAndProceed).toHaveBeenCalledTimes(1);
});

test('nama jadwal yang belum terdaftar tetap ditolak setelah daftar segar berhasil diambil', async () => {
    const { ctx } = createHarness();
    ctx.setActiveTeachers([{ nama: teacher.nama }]);
    ctx.setSchedule({ classTeachersMap: { 'X-1': { teacherNames: [teacher.nama] } } });
    ctx.CloudflareAPI.getMasterBundle.mockResolvedValue({ teachers: [otherTeacher] });
    await ctx.submitData();
    expect(ctx.handleGpsAndProceed).not.toHaveBeenCalled();
    expect(ctx.showPopup.mock.calls[0][1]).toContain('Nama Pengajar Wajib Dipilih');
});

test('daftar guru lama dipulihkan saat Simpan dengan nama resmi dan identitas akun lengkap', async () => {
    const { ctx, el } = createHarness();
    ctx.rememberJournalTeachers([otherTeacher]);
    el('input-guru').value = 'I Made Pengajar, S. Pd';
    await ctx.submitData();
    expect(ctx.CloudflareAPI.getMasterBundle).toHaveBeenCalledWith(true);
    expect(el('input-guru').value).toBe(teacher.nama);
    expect(ctx.handleGpsAndProceed.mock.calls[0][2]).toBe(teacher.nama);
    expect(ctx.guruDetailsMap[teacher.nama].uid).toBe(teacher.uid);
});

test('kegagalan jaringan mempertahankan seluruh isian dan memberi pesan data, tanpa menyalahkan guru', async () => {
    const { ctx, snapshot, button } = createHarness();
    const before = snapshot();
    ctx.CloudflareAPI.getMasterBundle.mockRejectedValue(new Error('offline'));
    await ctx.submitData();
    expect(snapshot()).toEqual(before);
    expect(ctx.showPopup.mock.calls[0][1]).toBe('Data Guru Belum Dapat Diverifikasi');
    expect(ctx.handleGpsAndProceed).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Simpan Laporan');
});

test('data kosong atau rusak diperlakukan sebagai gangguan data, bukan nama tidak terdaftar', async () => {
    for (const teachers of [[], null, [{ id: 'invalid' }]]) {
        const { ctx } = createHarness();
        ctx.CloudflareAPI.getMasterBundle.mockResolvedValue({ teachers });
        await ctx.submitData();
        expect(ctx.showPopup.mock.calls[0][1]).toBe('Data Guru Belum Dapat Diverifikasi');
        expect(ctx.handleGpsAndProceed).not.toHaveBeenCalled();
    }
});

test('koneksi menggantung dibatasi, hasil terlambat diabaikan dan Simpan bisa dicoba lagi', async () => {
    jest.useFakeTimers();
    const { ctx, button, snapshot } = createHarness();
    const request = deferred();
    ctx.CloudflareAPI.getMasterBundle.mockReturnValueOnce(request.promise);
    const before = snapshot();
    const pending = ctx.submitData();
    expect(button.disabled).toBe(true);
    await jest.advanceTimersByTimeAsync(12000);
    await pending;
    expect(snapshot()).toEqual(before);
    expect(button.disabled).toBe(false);
    request.resolve({ teachers: [otherTeacher] });
    await Promise.resolve();
    expect(ctx.findJournalTeacher(otherTeacher.nama)).toBeNull();
    await ctx.submitData();
    expect(ctx.handleGpsAndProceed).toHaveBeenCalledTimes(1);
});

test('tekan Simpan berulang saat pemulihan hanya menjalankan satu request dan satu handoff', async () => {
    const { ctx } = createHarness();
    const request = deferred();
    ctx.CloudflareAPI.getMasterBundle.mockReturnValue(request.promise);
    const first = ctx.submitData();
    await ctx.submitData();
    expect(ctx.CloudflareAPI.getMasterBundle).toHaveBeenCalledTimes(1);
    request.resolve({ teachers: [teacher] });
    await first;
    expect(ctx.handleGpsAndProceed).toHaveBeenCalledTimes(1);
});

test('pemanggil verifikasi paralel berbagi satu pemulihan data', async () => {
    const { ctx } = createHarness();
    const request = deferred();
    ctx.CloudflareAPI.getMasterBundle.mockReturnValue(request.promise);
    const pending = [ctx.verifyJournalTeacher(teacher.nama), ctx.verifyJournalTeacher(teacher.nama)];
    request.resolve({ teachers: [teacher] });
    const result = await Promise.all(pending);
    expect(result.map(r => r.status)).toEqual(['matched', 'matched']);
    expect(ctx.CloudflareAPI.getMasterBundle).toHaveBeenCalledTimes(1);
});

test('blur mempertahankan nama yang belum terverifikasi agar dapat dipulihkan saat Simpan', async () => {
    jest.useFakeTimers();
    const { ctx, el, dom } = createHarness();
    ctx.setSelectedName(teacher.nama);
    el('input-guru').dispatchEvent(new dom.window.Event('blur'));
    await jest.advanceTimersByTimeAsync(250);
    expect(el('input-guru').value).toBe(teacher.nama);
    expect(ctx.showPopup).not.toHaveBeenCalled();
    expect(ctx.CloudflareAPI.getMasterBundle).not.toHaveBeenCalled();
});

test('blur memakai master resmi meskipun daftar aktif kosong dan tetap menjalankan pengisian jadwal', async () => {
    jest.useFakeTimers();
    const { ctx, el, dom } = createHarness();
    ctx.rememberJournalTeachers([teacher]);
    el('input-guru').value = 'I Made Pengajar';
    el('input-guru').dispatchEvent(new dom.window.Event('blur'));
    await jest.advanceTimersByTimeAsync(250);
    expect(el('input-guru').value).toBe(teacher.nama);
    expect(ctx.autoFillTeacherSchedule).toHaveBeenCalledWith(teacher.nama);
});

test.each(['kelas', 'guru', 'edit'])('perubahan konteks %s selama verifikasi membatalkan submit lama', async change => {
    const { ctx, el } = createHarness();
    const request = deferred();
    ctx.CloudflareAPI.getMasterBundle.mockReturnValue(request.promise);
    const pending = ctx.submitData();
    if (change === 'kelas') ctx.changeClass('X-2');
    if (change === 'guru') el('input-guru').value = otherTeacher.nama;
    if (change === 'edit') ctx.currentEditDocId = 'edit-baru';
    request.resolve({ teachers: [teacher] });
    await pending;
    expect(ctx.handleGpsAndProceed).not.toHaveBeenCalled();
    expect(ctx.showPopup).not.toHaveBeenCalled();
});

test('materi, catatan dan JP dibaca kembali setelah verifikasi selesai', async () => {
    const { ctx, el } = createHarness();
    const request = deferred();
    ctx.CloudflareAPI.getMasterBundle.mockReturnValue(request.promise);
    const pending = ctx.submitData();
    el('input-topik').value = 'Materi diperbarui';
    el('input-catatan').value = 'Catatan diperbarui';
    ctx.setJps([4, 5]);
    request.resolve({ teachers: [teacher] });
    await pending;
    expect(ctx.handleGpsAndProceed.mock.calls[0].slice(5, 8)).toEqual(['Materi diperbarui', 'Catatan diperbarui', [4, 5]]);
});

test('nama kosong tetap divalidasi tanpa request jaringan', async () => {
    const { ctx, el } = createHarness();
    el('input-guru').value = '';
    await ctx.submitData();
    expect(ctx.CloudflareAPI.getMasterBundle).not.toHaveBeenCalled();
    expect(ctx.handleGpsAndProceed).not.toHaveBeenCalled();
    expect(ctx.showPopup.mock.calls[0][1]).toContain('Nama Pengajar Wajib Dipilih');
});

test('edit jurnal lama tetap bisa memakai pengajar historis yang terkunci tanpa foto/TTD baru', async () => {
    const { ctx, el } = createHarness();
    ctx.currentEditDocId = 'jurnal-lama';
    ctx.currentEditData = { guru: teacher.nama, uid_guru: teacher.uid, tanggal: '2026-10-01' };
    ctx.rememberJournalTeachers([otherTeacher]);
    el('input-guru').disabled = true;
    el('preview-container').classList.add('hidden');
    el('signature-pad').toDataURL = () => 'blank';
    await ctx.submitData();
    expect(ctx.CloudflareAPI.getMasterBundle).not.toHaveBeenCalled();
    expect(ctx.handleGpsAndProceed).toHaveBeenCalledTimes(1);
    expect(ctx.handleGpsAndProceed.mock.calls[0][2]).toBe(teacher.nama);
    expect(ctx.compareWithActualSchedule.mock.calls[0][4]).toBe('2026-10-01');
});

test('nama baru yang tidak terdaftar tidak dapat memakai pengecualian pengajar historis', async () => {
    const { ctx, el } = createHarness();
    ctx.currentEditDocId = 'jurnal-lama';
    ctx.currentEditData = { guru: otherTeacher.nama };
    el('input-guru').value = 'Nama Tidak Terdaftar';
    await ctx.submitData();
    expect(ctx.handleGpsAndProceed).not.toHaveBeenCalled();
    expect(ctx.showPopup.mock.calls[0][1]).toContain('Nama Pengajar Wajib Dipilih');
});

test('tombol perbarui data tetap mengambil guru segar meskipun salinan memori sudah ada', async () => {
    const { ctx } = createHarness({ storageDenied: true });
    ctx.rememberJournalTeachers([otherTeacher]);
    ctx.selectClass = jest.fn().mockResolvedValue();
    await ctx.refreshClassData();
    expect(ctx.CloudflareAPI.getMasterBundle).toHaveBeenCalledWith(true);
    expect(ctx.findJournalTeacher(teacher.nama).id).toBe(teacher.id);
    expect(ctx.selectClass).toHaveBeenCalledWith('X-1');
    expect(ctx.showToast.mock.calls[0][0]).toBe('Memperbarui Data...');
});
