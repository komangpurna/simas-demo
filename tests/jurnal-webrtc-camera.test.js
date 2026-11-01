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

function createHarness() {
    const dom = new JSDOM(`<!doctype html><body>
        <div id="screen-scan"></div><div id="screen-form"></div>
        <div id="preview-container" class="hidden"><img id="image-preview"><button onclick="clearImage()">Hapus</button></div>
        <div id="photo-buttons" class="grid grid-cols-2 gap-2">
            <input id="file-camera" type="file">
            <button id="btn-webrtc" onclick="openWebRtcCamera()">Kamera Lite</button>
            <button id="btn-native" onclick="document.getElementById('file-camera').click()">Kamera HD</button>
        </div>
        <div id="upload-status-badge" class="hidden"></div>

        <!-- MODAL WEBRTC -->
        <div id="modal-webrtc-camera" class="hidden">
            <video id="webrtc-video"></video>
            <div id="webrtc-loading" class="hidden"></div>
            <div id="webrtc-error" class="hidden"><p id="webrtc-error-text"></p></div>
            <button id="webrtc-btn-flip" onclick="toggleWebRtcCamera()"></button>
            <button id="webrtc-btn-snap" onclick="captureWebRtcPhoto()"></button>
            <button id="webrtc-btn-close" onclick="closeWebRtcCamera()"></button>
            <canvas id="webrtc-canvas"></canvas>
        </div>
    </body>`, { url: 'https://jurnal.test/' });

    const tracks = [
        { stop: jest.fn(), kind: 'video' }
    ];
    const mockStream = {
        getTracks: jest.fn(() => tracks)
    };

    const mockGetUserMedia = jest.fn().mockResolvedValue(mockStream);

    const ctx = {
        window: null,
        document: dom.window.document,
        localStorage: dom.window.localStorage,
        Promise,
        Date,
        Blob: dom.window.Blob,
        File: dom.window.File,
        atob: str => Buffer.from(str, 'base64').toString('binary'),
        setTimeout: jest.fn(setTimeout),
        clearTimeout: jest.fn(clearTimeout),
        console: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() },
        safeRenderLucide: jest.fn(),
        showPopup: jest.fn(),
        navigator: {
            mediaDevices: {
                getUserMedia: mockGetUserMedia
            }
        },
        CloudflareAPI: {
            isEnabled: true
        }
    };
    ctx.window = ctx;

    vm.createContext(ctx);
    vm.runInContext([
        section('// --- APP STATE ---', '// --- UNIVERSAL DATE PARSER ---'),
        section('// --- IMAGE COMPRESSION & UPLOAD ke GOOGLE DRIVE ---', '// --- CANVAS ---'),
        'currentClass = { name: "X-1" };',
        'window.getPhoto = () => activePhotoUpload;'
    ].join('\n'), ctx, { filename: 'page-jurnal-webrtc.js' });

    // Mock canvas context
    const canvas = dom.window.document.getElementById('webrtc-canvas');
    canvas.getContext = jest.fn(() => ({
        drawImage: jest.fn()
    }));
    canvas.toBlob = jest.fn(cb => {
        cb(new dom.window.Blob(['mock-image-data'], { type: 'image/jpeg' }));
    });

    const video = dom.window.document.getElementById('webrtc-video');
    video.play = jest.fn().mockResolvedValue(undefined);

    const element = id => dom.window.document.getElementById(id);

    return {
        ctx,
        dom,
        element,
        mockStream,
        tracks,
        mockGetUserMedia,
        canvas,
        video
    };
}

describe('In-App WebRTC Camera (Kamera Lite Anti-Reload)', () => {
    let h;

    beforeEach(() => {
        h = createHarness();
    });

    afterEach(() => {
        h.dom.window.close();
    });

    test('openWebRtcCamera menampilkan modal, memicu getUserMedia dengan mode environment 720p', async () => {
        await h.ctx.openWebRtcCamera();

        expect(h.element('modal-webrtc-camera').classList.contains('hidden')).toBe(false);
        expect(h.mockGetUserMedia).toHaveBeenCalledWith({
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        });
        expect(h.video.srcObject).toBe(h.mockStream);
        expect(h.video.play).toHaveBeenCalled();
        expect(h.element('webrtc-loading').classList.contains('hidden')).toBe(true);
    });

    test('openWebRtcCamera menangani jika browser tidak mendukung mediaDevices dengan fallback ke file-camera', async () => {
        delete h.ctx.navigator.mediaDevices;
        const camClickSpy = jest.spyOn(h.element('file-camera'), 'click');

        await h.ctx.openWebRtcCamera();

        expect(h.ctx.showPopup).toHaveBeenCalledWith('info', expect.stringContaining('Kamera Lite'), expect.any(String));
        expect(camClickSpy).toHaveBeenCalled();
        expect(h.element('modal-webrtc-camera').classList.contains('hidden')).toBe(true);
    });

    test('closeWebRtcCamera menghentikan semua track kamera dan menyembunyikan modal', async () => {
        await h.ctx.openWebRtcCamera();
        h.ctx.closeWebRtcCamera();

        expect(h.tracks[0].stop).toHaveBeenCalled();
        expect(h.video.srcObject).toBeNull();
        expect(h.element('modal-webrtc-camera').classList.contains('hidden')).toBe(true);
    });

    test('toggleWebRtcCamera mengubah facingMode dari environment ke user dan menghentikan stream sebelumnya', async () => {
        await h.ctx.openWebRtcCamera();
        expect(h.mockGetUserMedia).toHaveBeenLastCalledWith(expect.objectContaining({
            video: expect.objectContaining({ facingMode: { ideal: 'environment' } })
        }));

        await h.ctx.toggleWebRtcCamera();
        expect(h.tracks[0].stop).toHaveBeenCalled();
        expect(h.mockGetUserMedia).toHaveBeenLastCalledWith(expect.objectContaining({
            video: expect.objectContaining({ facingMode: { ideal: 'user' } })
        }));
    });

    test('penolakan izin kamera menampilkan pesan kesalahan ramah dan opsi coba lagi', async () => {
        const permError = new Error('Permission denied');
        permError.name = 'NotAllowedError';
        h.mockGetUserMedia.mockRejectedValueOnce(permError);

        await h.ctx.openWebRtcCamera();

        expect(h.element('webrtc-error').classList.contains('hidden')).toBe(false);
        expect(h.element('webrtc-error-text').textContent).toContain('Izin kamera ditolak');
    });

    test('captureWebRtcPhoto menolak jepret jika video belum siap (resolusi 0)', () => {
        Object.defineProperty(h.video, 'videoWidth', { value: 0, configurable: true, writable: true });
        Object.defineProperty(h.video, 'videoHeight', { value: 0, configurable: true, writable: true });

        h.ctx.captureWebRtcPhoto();

        expect(h.ctx.showPopup).toHaveBeenCalledWith('error', 'Kamera Belum Siap', expect.any(String));
        expect(h.canvas.getContext).not.toHaveBeenCalled();
    });

    test('captureWebRtcPhoto menggambar frame video, menutup stream, dan mengalirkan file ke upload pipeline', async () => {
        Object.defineProperty(h.video, 'videoWidth', { value: 1280, configurable: true, writable: true });
        Object.defineProperty(h.video, 'videoHeight', { value: 720, configurable: true, writable: true });
        await h.ctx.openWebRtcCamera();

        h.ctx.captureWebRtcPhoto();

        const ctx2d = h.canvas.getContext.mock.results[0].value;
        expect(ctx2d.drawImage).toHaveBeenCalledWith(h.video, 0, 0, 1280, 720);
        expect(h.tracks[0].stop).toHaveBeenCalled();
        expect(h.element('modal-webrtc-camera').classList.contains('hidden')).toBe(true);

        // Memastikan activePhotoUpload terbuat dan terintegrasi
        const photo = h.ctx.getPhoto();
        expect(photo).not.toBeNull();
        expect(photo.fileName).toMatch(/^X-1_Background_\d+_\d+\.jpg$/);
    });
});
