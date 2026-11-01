const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../js/page-jurnal.js'), 'utf8');
function section(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    if (from < 0 || to < 0) throw new Error(`Bagian kode tidak ditemukan: ${start}`);
    return source.slice(from, to);
}

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

// Jalankan fungsi produksi dengan DOM dan layanan terkendali; tidak mengirim foto/jurnal sungguhan.
function createHarness() {
    const dom = new JSDOM(`<!doctype html><body>
        <div id="screen-scan"></div><div id="screen-form"></div>
        <div id="header-class-name"></div><div id="ttd-optional-label"></div>
        <div id="upload-status-badge" class="hidden"></div>
        <div id="preview-container" class="hidden"><img id="image-preview"><button onclick="clearImage()">Hapus</button></div>
        <div id="photo-buttons"><input id="file-camera" type="file"><button>Foto</button></div>
        <input id="input-guru" value="Guru Uji"><select id="input-mapel"><option>Matematika</option></select>
        <input id="input-topik" value="Materi tetap ada"><input id="input-catatan" value="Catatan tetap ada">
        <button id="save-button">Simpan Laporan</button>
        <div class="student-row" data-id="1" data-name="Siswa Uji" data-nis="123" data-absen="1"></div>
        <div id="attendance-1" data-value="S"></div>
    </body>`, { url: 'https://jurnal.test/' });
    const uploads = [];
    const deletes = [];
    const reads = [];
    const ctx = {
        window: null, document: dom.window.document, localStorage: dom.window.localStorage,
        Promise, Date, setTimeout: jest.fn(setTimeout), clearTimeout: jest.fn(clearTimeout),
        APPS_SCRIPT_URL: 'https://upload.invalid/exec',
        console: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() },
        safeRenderLucide: jest.fn(), showPopup: jest.fn(), loadClasses: jest.fn(), selectClass: jest.fn(),
        location: { reload: jest.fn() },
        CacheHelper: { get: jest.fn(() => ['Semangat']), set: jest.fn(), remove: jest.fn() },
        CloudflareAPI: {
            isEnabled: true, saveJurnal: jest.fn().mockResolvedValue({ success: true }),
            updateJurnal: jest.fn().mockResolvedValue({ success: true })
        },
        FileReader: class {
            readAsDataURL(file) {
                reads.push(file);
                Promise.resolve(file.readGate && file.readGate.promise).then(() => {
                    if (file.readError) this.onerror();
                    else this.onload({ target: { result: `original:${file.name}` } });
                });
            }
        },
        Image: class {
            set src(value) { this._src = value; Promise.resolve().then(() => this.onload()); }
            get src() { return this._src; }
        },
        fetch: jest.fn((url, options) => {
            const body = JSON.parse(options.body);
            if (body.action === 'delete') {
                deletes.push(body.fileId);
                return Promise.resolve({ ok: true });
            }
            const request = deferred();
            uploads.push({ body, ...request });
            return request.promise;
        })
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext([
        section('// --- APP STATE ---', '// --- UNIVERSAL DATE PARSER ---'),
        section('// --- IMAGE COMPRESSION & UPLOAD ke GOOGLE DRIVE ---', '// --- CANVAS ---'),
        section('async function proceedSubmit(', '// --- CUSTOM TEACHER DROPDOWN LOGIC ---'),
        section('window.editJurnal = function', 'async function handleQrDeepLink'),
        section('window.resetApp = function', '// QR Deep Link handler'),
        'currentClass = { name: "X-1" };',
        'window.getPhoto = () => activePhotoUpload;',
        'window.getSubmitting = () => isSubmittingJurnal;'
    ].join('\n'), ctx, { filename: 'page-jurnal-photo-functions.js' });
    ctx.compressImage = jest.fn(async img => `data:image/jpeg;base64,${Buffer.from(img.src).toString('base64')}`);
    const element = id => dom.window.document.getElementById(id);
    return {
        ctx, dom, uploads, deletes, reads, element,
        pick: file => ctx.handleFileSelect({ files: [typeof file === 'string' ? { name: file } : file] }),
        submit: () => ctx.proceedSubmit(element('save-button'), 'Simpan Laporan', 'Guru Uji', 'Matematika',
            'Kelas', element('input-topik').value, element('input-catatan').value, [2, 3],
            { toDataURL: () => 'data:image/png;base64,signature' }, false),
        succeed(index, id) {
            uploads[index].resolve({ ok: true, json: async () => ({ success: true, url: `https://drive.test/${id}`, fileId: id }) });
        },
        confirmReset() {
            ctx.resetApp();
            const args = ctx.showPopup.mock.calls.at(-1);
            args[3]();
        }
    };
}

const flush = () => jest.advanceTimersByTimeAsync(0);
async function failThreeAttempts(h, firstIndex = 0, message = 'Failed to fetch') {
    h.uploads[firstIndex].reject(new Error(message));
    await jest.advanceTimersByTimeAsync(1800);
    h.uploads[firstIndex + 1].reject(new Error(message));
    await jest.advanceTimersByTimeAsync(3000);
    h.uploads[firstIndex + 2].reject(new Error(message));
    await flush();
}

describe('Unggah foto jurnal: hasil, konkurensi, pemulihan, dan integrasi simpan', () => {
    let h;
    beforeEach(() => { jest.useFakeTimers(); h = createHarness(); });
    afterEach(() => { h.dom.window.close(); jest.clearAllTimers(); jest.useRealTimers(); });

    test('unggah berhasil menyimpan hasil, pratinjau, dan kontrak payload Drive', async () => {
        const task = h.pick('A');
        await flush();
        expect(h.uploads[0].body).toEqual({
            action: 'upload', image: Buffer.from('original:A').toString('base64'),
            fileName: expect.stringMatching(/^X-1_Background_\d+_1\.jpg$/), kelas: 'X-1'
        });
        h.succeed(0, 'A');
        await task;
        expect(h.ctx.uploadedFotoObj).toEqual({ url: 'https://drive.test/A', fileId: 'A' });
        expect(h.element('upload-status-badge').textContent).toBe('Foto Siap');
        expect(h.element('preview-container').classList.contains('hidden')).toBe(false);
    });

    test('klik coba ulang berulang berbagi satu request dan memakai kompresi yang sama', async () => {
        const file = { name: 'A' };
        const first = h.pick(file);
        await flush();
        await failThreeAttempts(h);
        await first;
        const retry = h.element('upload-status-badge').onclick;
        const task = retry();
        expect(retry()).toBe(task);
        expect(h.pick(file)).toBe(task);
        expect(h.element('upload-status-badge').onclick).toBeNull();
        await flush();
        expect(h.uploads).toHaveLength(4);
        expect(h.reads).toHaveLength(1);
        expect(h.ctx.compressImage).toHaveBeenCalledTimes(1);
        h.succeed(3, 'A-retry');
        await task;
        expect(h.element('upload-status-badge').textContent).toBe('Foto Siap');
    });

    test.each(['old-first', 'new-first'])('foto pengganti tidak ditimpa unggahan lama: %s', async order => {
        const old = h.pick('A');
        await flush();
        h.ctx.clearImage();
        const current = h.pick('B');
        await flush();
        if (order === 'old-first') {
            h.succeed(0, 'A');
            await old;
            expect(h.ctx.uploadedFotoObj).toBeNull();
            expect(h.ctx.getPhoto().promise).not.toBeNull();
            expect(h.element('upload-status-badge').textContent).toBe('Mengunggah...');
        }
        h.succeed(1, 'B');
        await current;
        if (order === 'new-first') { h.succeed(0, 'A'); await old; }
        expect(h.ctx.uploadedFotoObj.fileId).toBe('B');
        expect(h.element('image-preview').src).toContain(Buffer.from('original:B').toString('base64'));
        expect(h.element('upload-status-badge').textContent).toBe('Foto Siap');
        expect(h.deletes).toEqual(['A']);
    });

    test('kegagalan unggahan lama tidak menghapus hasil foto baru atau memulai retry lama', async () => {
        const old = h.pick('A');
        await flush();
        const current = h.pick('B');
        await flush();
        h.succeed(1, 'B');
        await current;
        h.uploads[0].reject(new Error('Failed to fetch'));
        await old;
        await jest.advanceTimersByTimeAsync(5000);
        expect(h.uploads).toHaveLength(2);
        expect(h.ctx.uploadedFotoObj.fileId).toBe('B');
        expect(h.element('upload-status-badge').textContent).toBe('Foto Siap');
    });

    test('kompresi foto lama yang selesai terlambat tidak mengunggah atau mengganti pratinjau baru', async () => {
        const readGate = deferred();
        const old = h.pick({ name: 'A', readGate });
        await flush();
        const current = h.pick('B');
        await flush();
        h.succeed(0, 'B');
        await current;
        readGate.resolve();
        await old;
        expect(h.uploads).toHaveLength(1);
        expect(h.ctx.uploadedFotoObj.fileId).toBe('B');
        expect(h.element('image-preview').src).toContain(Buffer.from('original:B').toString('base64'));
    });

    test.each(['clear', 'reset'])('unggahan selesai setelah %s dibersihkan tanpa muncul kembali', async action => {
        const task = h.pick('A');
        await flush();
        if (action === 'clear') h.ctx.clearImage(); else h.confirmReset();
        h.succeed(0, 'A');
        await task;
        expect(h.ctx.getPhoto()).toBeNull();
        expect(h.ctx.uploadedFotoObj).toBeNull();
        expect(h.element('preview-container').classList.contains('hidden')).toBe(true);
        expect(h.element('upload-status-badge').classList.contains('hidden')).toBe(true);
        expect(h.deletes).toEqual(['A']);
    });

    test('handler coba ulang yang sudah kedaluwarsa tidak menghidupkan foto lama', async () => {
        const task = h.pick('A');
        await flush();
        await failThreeAttempts(h);
        await task;
        const oldRetry = h.element('upload-status-badge').onclick;
        h.confirmReset();
        await oldRetry();
        expect(h.ctx.getPhoto()).toBeNull();
        expect(h.uploads).toHaveLength(3);
    });

    test('gagal membaca foto memberi jalan memilih ulang tanpa mengirim request', async () => {
        const file = { name: 'A', readError: true };
        await h.pick(file);
        expect(h.uploads).toHaveLength(0);
        expect(h.element('photo-buttons').classList.contains('hidden')).toBe(false);
        expect(h.element('upload-status-badge').textContent).toContain('Coba Lagi');
        file.readError = false;
        const retry = h.element('upload-status-badge').onclick();
        await flush();
        h.succeed(0, 'A');
        await retry;
        expect(h.reads).toHaveLength(2);
    });

    test('simpan menunggu unggahan lebih dari 20 detik lalu memakai hasilnya sekali', async () => {
        const task = h.pick('A');
        await flush();
        const saving = h.submit();
        const duplicateSave = h.submit();
        await jest.advanceTimersByTimeAsync(25000);
        expect(h.ctx.CloudflareAPI.saveJurnal).not.toHaveBeenCalled();
        expect(h.ctx.showPopup).not.toHaveBeenCalled();
        expect(h.element('save-button').disabled).toBe(true);
        h.succeed(0, 'A');
        await Promise.all([task, saving, duplicateSave]);
        expect(h.uploads).toHaveLength(1);
        expect(h.ctx.CloudflareAPI.saveJurnal).toHaveBeenCalledTimes(1);
        expect(h.ctx.CloudflareAPI.saveJurnal.mock.calls[0][0]).toMatchObject({
            foto_url: 'https://drive.test/A', kelas: 'X-1', topik: 'Materi tetap ada',
            presensi_detail: [{ nama: 'Siswa Uji', nis: '123', absen: '1', status: 'S' }]
        });
    });

    test('simpan dapat menunggu kompresi yang belum selesai', async () => {
        const readGate = deferred();
        const task = h.pick({ name: 'A', readGate });
        const saving = h.submit();
        await flush();
        expect(h.ctx.CloudflareAPI.saveJurnal).not.toHaveBeenCalled();
        readGate.resolve();
        await flush();
        h.succeed(0, 'A');
        await Promise.all([task, saving]);
        expect(h.ctx.CloudflareAPI.saveJurnal).toHaveBeenCalledTimes(1);
    });

    test('batas 45 detik mempertahankan form dan unggahan; simpan ulang tidak mengunggah ulang', async () => {
        const task = h.pick('A');
        await flush();
        const saving = h.submit();
        await jest.advanceTimersByTimeAsync(45000);
        await saving;
        expect(h.ctx.showPopup).toHaveBeenLastCalledWith('confirm', 'Foto Masih Diunggah', expect.stringContaining('Jurnal belum disimpan'));
        expect(h.ctx.CloudflareAPI.saveJurnal).not.toHaveBeenCalled();
        expect(h.element('input-topik').value).toBe('Materi tetap ada');
        expect(h.element('input-catatan').value).toBe('Catatan tetap ada');
        expect(h.element('save-button').disabled).toBe(false);
        expect(h.ctx.getSubmitting()).toBe(false);
        expect(h.ctx.getPhoto().promise).not.toBeNull();
        h.succeed(0, 'A');
        await task;
        expect(h.ctx.CloudflareAPI.saveJurnal).not.toHaveBeenCalled();
        await h.submit();
        expect(h.uploads).toHaveLength(1);
        expect(h.ctx.CloudflareAPI.saveJurnal).toHaveBeenCalledTimes(1);
        expect(h.deletes).toEqual([]);
        const waitTimers = h.ctx.setTimeout.mock.calls.flatMap((args, index) =>
            args[1] === 45000 ? [h.ctx.setTimeout.mock.results[index].value] : []);
        expect(waitTimers).toHaveLength(2);
        waitTimers.forEach(timer => expect(h.ctx.clearTimeout).toHaveBeenCalledWith(timer));
    });

    test('gagal unggah saat simpan memulihkan tombol, menjaga form, dan menampilkan error sebagai teks', async () => {
        const task = h.pick('A');
        await flush();
        const saving = h.submit();
        await failThreeAttempts(h, 0, '<img src=x onerror=alert(1)>');
        await Promise.all([task, saving]);
        expect(h.ctx.CloudflareAPI.saveJurnal).not.toHaveBeenCalled();
        expect(h.ctx.showPopup.mock.calls.at(-1)[2]).toContain('&lt;img');
        expect(h.ctx.showPopup.mock.calls.at(-1)[2]).not.toContain('<img');
        expect(h.element('save-button').disabled).toBe(false);
        expect(h.element('file-camera').disabled).toBe(false);
        expect(h.element('input-topik').value).toBe('Materi tetap ada');
        expect(h.element('upload-status-badge').onclick).toEqual(expect.any(Function));
    });

    test('klik simpan setelah upload gagal memakai ulang kompresi dan satu proses unggah', async () => {
        const task = h.pick('A');
        await flush();
        await failThreeAttempts(h);
        await task;
        const saving = h.submit();
        await flush();
        h.succeed(3, 'A');
        await saving;
        expect(h.ctx.compressImage).toHaveBeenCalledTimes(1);
        expect(h.ctx.CloudflareAPI.saveJurnal).toHaveBeenCalledTimes(1);
    });

    test('foto dan navigasi tidak berubah saat save berlangsung; foto tersimpan tidak terhapus', async () => {
        const task = h.pick('A');
        await flush();
        h.succeed(0, 'A');
        await task;
        const saveGate = deferred();
        h.ctx.CloudflareAPI.saveJurnal.mockReturnValueOnce(saveGate.promise);
        const saving = h.submit();
        await flush();
        h.ctx.clearImage();
        h.ctx.resetApp();
        await h.pick('B');
        expect(h.ctx.uploadedFotoObj.fileId).toBe('A');
        expect(h.deletes).toEqual([]);
        expect(h.uploads).toHaveLength(1);
        expect(h.element('file-camera').disabled).toBe(true);
        saveGate.resolve({ success: true });
        await saving;
        h.ctx.clearImage();
        expect(h.deletes).toEqual([]);
        expect(h.element('file-camera').disabled).toBe(false);
    });

    test('save gagal tidak mengunggah ulang, dan respons save ambigu tidak menyebabkan penghapusan foto', async () => {
        const task = h.pick('A');
        await flush();
        h.succeed(0, 'A');
        await task;
        h.ctx.CloudflareAPI.saveJurnal.mockRejectedValueOnce(new Error('Respons simpan terputus'));
        await h.submit();
        expect(h.element('save-button').disabled).toBe(false);
        expect(h.ctx.getSubmitting()).toBe(false);
        expect(h.ctx.getPhoto().saveAttempted).toBe(true);
        await h.submit();
        expect(h.uploads).toHaveLength(1);
        expect(h.ctx.CloudflareAPI.saveJurnal).toHaveBeenCalledTimes(2);
        h.confirmReset();
        expect(h.deletes).toEqual([]);
    });

    test('foto dipertahankan ketika guru kembali setelah respons save gagal', async () => {
        const task = h.pick('A');
        await flush();
        h.succeed(0, 'A');
        await task;
        h.ctx.CloudflareAPI.saveJurnal.mockRejectedValueOnce(new Error('Respons simpan terputus'));
        await h.submit();
        h.confirmReset();
        expect(h.deletes).toEqual([]);
    });

    test('entri baru tanpa foto tetap ditolak', async () => {
        await h.submit();
        expect(h.ctx.CloudflareAPI.saveJurnal).not.toHaveBeenCalled();
        expect(h.ctx.showPopup.mock.calls.at(-1)[2]).toContain('Foto kegiatan KBM wajib');
        expect(h.ctx.getSubmitting()).toBe(false);
    });

    test.each(['https://drive.test/historis', ''])('mode edit menjaga foto dan tanggal lama: %s', async oldPhoto => {
        h.ctx.recapDocs = [{ id: 'jurnal-lama', kelas: 'X-2', mapel: 'Matematika', topik: 'Lama',
            tanggal: '2026-08-01', foto_url: oldPhoto, koordinat: { lat: -8, lng: 115 } }];
        h.ctx.editJurnal('jurnal-lama');
        await h.pick('baru');
        await h.submit();
        expect(h.uploads).toHaveLength(0);
        expect(h.ctx.CloudflareAPI.updateJurnal).toHaveBeenCalledWith('jurnal-lama', expect.objectContaining({
            tanggal: '2026-08-01', foto_url: oldPhoto, koordinat: { lat: -8, lng: 115 }
        }));
        expect(h.element('file-camera').disabled).toBe(true);
    });

    test('membuka edit mengisolasi hasil unggahan form baru yang masih berjalan', async () => {
        const task = h.pick('A');
        await flush();
        h.ctx.recapDocs = [{ id: 'lama', kelas: 'X-2', mapel: 'Matematika', foto_url: 'https://drive.test/lama' }];
        h.ctx.editJurnal('lama');
        h.succeed(0, 'A');
        await task;
        expect(h.ctx.getPhoto()).toBeNull();
        expect(h.ctx.uploadedFotoObj).toBeNull();
        expect(h.ctx.uploadedFotoUrl).toBe('https://drive.test/lama');
        expect(h.element('preview-container').classList.contains('hidden')).toBe(true);
        expect(h.deletes).toEqual(['A']);
    });

    test('diagnosis kegagalan mencatat tahap dan durasi tanpa isi foto atau identitas guru', async () => {
        const task = h.pick('A');
        await flush();
        await failThreeAttempts(h);
        await task;
        expect(h.ctx.console.warn).toHaveBeenCalledWith('[Upload Drive] Percobaan gagal', expect.objectContaining({
            stage: 'request', attempt: 1, durationMs: expect.any(Number), bytes: expect.any(Number)
        }));
        const logs = JSON.stringify(h.ctx.console.warn.mock.calls);
        expect(logs).not.toContain(Buffer.from('original:A').toString('base64'));
        expect(logs).not.toContain('Guru Uji');
        expect(h.ctx.getPhoto().error.message).not.toContain('sedang padat');
    });

    test('respons URL tanpa ID file tetap kompatibel untuk penyimpanan jurnal', async () => {
        const task = h.pick('A');
        await flush();
        h.uploads[0].resolve({ ok: true, json: async () => ({ success: true, url: 'https://drive.test/A' }) });
        await task;
        await h.submit();
        expect(h.ctx.CloudflareAPI.saveJurnal).toHaveBeenCalledWith(expect.objectContaining({ foto_url: 'https://drive.test/A' }));
        expect(h.element('upload-status-badge').textContent).toBe('Foto Siap');
    });

    test.each([
        ['HTTP', () => ({ ok: false, status: 503 }), 'request'],
        ['JSON', () => ({ ok: true, json: async () => { throw new Error('JSON tidak valid'); } }), 'response'],
        ['server', () => ({ ok: true, json: async () => ({ success: false, error: 'Izin Drive ditolak' }) }), 'server'],
        ['URL kosong', () => ({ ok: true, json: async () => ({ success: true, fileId: 'A' }) }), 'server']
    ])('respons gagal %s tidak ditandai Foto Siap atau disimpan sebagai jurnal', async (label, response, stage) => {
        const task = h.pick('A');
        await flush();
        const saving = h.submit();
        for (let i = 0; i < 3; i++) {
            h.uploads[i].resolve(response());
            await jest.advanceTimersByTimeAsync(i === 0 ? 1800 : i === 1 ? 3000 : 0);
        }
        await Promise.all([task, saving]);
        expect(h.ctx.CloudflareAPI.saveJurnal).not.toHaveBeenCalled();
        expect(h.ctx.uploadedFotoObj).toBeNull();
        expect(h.element('upload-status-badge').textContent).toContain('Gagal');
        expect(h.ctx.console.warn).toHaveBeenCalledWith('[Upload Drive] Percobaan gagal', expect.objectContaining({ stage }));
        expect(h.ctx.getSubmitting()).toBe(false);
    });
});
