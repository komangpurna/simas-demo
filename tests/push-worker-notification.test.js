/**
 * tests/push-worker-notification.test.js
 * Memvalidasi opsi showNotification pada Service Worker Push (push-worker.js)
 * Memastikan icon warna penuh logo sekolah tetap aktif, dan opsi badge monokrom ditiadakan
 * agar sistem Android / Samsung One UI tidak memaksakan konversi lingkaran putih solid.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

describe('Push Worker Notification Options (push-worker.js)', () => {
    const workerPath = path.resolve(__dirname, '../push-worker.js');
    const workerSource = fs.readFileSync(workerPath, 'utf8');

    test('1. push-worker.js ada dan mendefinisikan event listener push', () => {
        expect(fs.existsSync(workerPath)).toBe(true);
        expect(workerSource).toContain("self.addEventListener('push'");
    });

    test('2. push-worker.js menyetel icon logo sekolah berwarna', () => {
        expect(workerSource).toMatch(/icon:\s*new\s+URL\('\/assets\/logo-sekolah\.png'/);
    });

    test('3. push-worker.js menyetel opsi badge ke siluet monokrom resmi /assets/badge-sekolah.png', () => {
        // Android menggunakan opsi badge untuk smallIcon status bar yang wajib monokrom transparan.
        // /assets/badge-sekolah.png mempertahankan semua detail lambang SMAGESA (teratai, teks, sayap, obor, buku).
        expect(workerSource).toMatch(/badge:\s*new\s+URL\('\/assets\/badge-sekolah\.png'/);
    });

    test('4. Berkas fisik assets/badge-sekolah.png eksis dan valid (192x192, transparan, RGB murni 255)', async () => {
        const badgePath = path.resolve(__dirname, '../assets/badge-sekolah.png');
        expect(fs.existsSync(badgePath)).toBe(true);

        const buf = fs.readFileSync(badgePath);
        expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

        let offset = 8;
        let width = 0;
        let height = 0;
        let colorType = 0;
        const idatParts = [];

        while (offset < buf.length) {
            const length = buf.readUInt32BE(offset);
            const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
            const data = buf.subarray(offset + 8, offset + 8 + length);
            offset += 12 + length;

            if (type === 'IHDR') {
                width = data.readUInt32BE(0);
                height = data.readUInt32BE(4);
                colorType = data.readUInt8(9);
            } else if (type === 'IDAT') {
                idatParts.push(data);
            } else if (type === 'IEND') {
                break;
            }
        }

        expect(width).toBe(192);
        expect(height).toBe(192);
        expect(colorType === 4 || colorType === 6).toBe(true);

        const decompressed = zlib.inflateSync(Buffer.concat(idatParts));
        let hasTransparent = false;
        let hasWhite = false;

        const bytesPerPixel = 4;
        const stride = 1 + width * bytesPerPixel;

        for (let y = 0; y < height; y++) {
            const rowStart = y * stride + 1;
            for (let x = 0; x < width; x++) {
                const idx = rowStart + x * bytesPerPixel;
                const r = decompressed[idx];
                const g = decompressed[idx + 1];
                const b = decompressed[idx + 2];
                const a = decompressed[idx + 3];

                if (a === 0) hasTransparent = true;
                if (a > 0 && r === 255 && g === 255 && b === 255) hasWhite = true;
            }
        }

        expect(hasTransparent).toBe(true);
        expect(hasWhite).toBe(true);
    });

    test('5. Simulasi penerimaan push memanggil showNotification dengan icon berwarna dan badge siluet resmi', async () => {
        const notifications = [];
        const handlers = {};

        const fakeSelf = {
            location: { origin: 'https://smagesa.web.app' },
            clients: { matchAll: async () => [] },
            registration: {
                showNotification: async (title, options) => {
                    notifications.push({ title, options });
                }
            },
            addEventListener: (type, fn) => {
                handlers[type] = fn;
            }
        };

        const context = vm.createContext({
            self: fakeSelf,
            URL,
            console,
            indexedDB: { open: () => ({ onupgradeneeded: null, onsuccess: null, onerror: null }) }
        });

        // Jalankan script push-worker
        // Mock acceptPushMessage agar selalu true tanpa akses IndexedDB asli
        const modifiedSource = workerSource.replace(
            'if (!await acceptPushMessage(data)) return;',
            '/* mocked accept */'
        );

        vm.runInContext(modifiedSource, context);

        expect(typeof handlers['push']).toBe('function');

        let waitUntilPromise;
        const fakeEvent = {
            data: {
                json: () => ({
                    notification: {
                        title: 'Info Sekolah',
                        body: 'Pengumuman terbaru hari ini'
                    },
                    data: {
                        jobId: 'test-job-123',
                        url: '/agenda.html'
                    }
                })
            },
            waitUntil: promise => {
                waitUntilPromise = promise;
            }
        };

        handlers['push'](fakeEvent);
        await waitUntilPromise;

        expect(notifications.length).toBe(1);
        const notification = notifications[0];

        expect(notification.title).toBe('Info Sekolah');
        expect(notification.options.body).toBe('Pengumuman terbaru hari ini');
        expect(notification.options.icon).toBe('https://smagesa.web.app/assets/logo-sekolah.png');
        expect(notification.options.badge).toBe('https://smagesa.web.app/assets/badge-sekolah.png');
        expect(notification.options.tag).toBe('simas-test-job-123');
        expect(notification.options.vibrate).toEqual([100, 50, 100]);
    });
});
