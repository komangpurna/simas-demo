import fs from 'node:fs';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { jest } from '@jest/globals';

const source = fs.readFileSync(new URL('./push-notification.js', import.meta.url), 'utf8')
    .replace(/^import .+;\r?\n/gm, '').replace(/^export /gm, '');

function clientHarness() {
    const auth = { currentUser: { uid: 'A', getIdToken: jest.fn(async () => 'auth-token') } };
    const owners = [];
    const listeners = [];
    const getToken = jest.fn(async () => 'test-device-token');
    const cfClient = { enabled: true, registerPushToken: jest.fn(async () => ({ success: true })),
        getSystemSetting: jest.fn(async () => ({ enabled: true, vapidPublicKey: 'vapid-key' })) };
    const events = {};
    const banners = new Map();
    const button = { addEventListener: jest.fn() };
    const document = { visibilityState: 'visible', addEventListener: (name, fn) => { events[name] = fn; },
        getElementById: id => banners.get(id), querySelector: () => null,
        createElement: () => ({ querySelector: () => button, remove: () => banners.delete('push-registration-banner') }),
        body: { prepend: banner => banners.set(banner.id, banner) } };
    const Notification = { permission: 'granted', requestPermission: jest.fn(async () => 'granted') };
    const window = { cfClient, showToast: jest.fn(), Notification, addEventListener: (name, fn) => { events[name] = fn; } };
    const navigator = { userAgent: 'Test Browser', serviceWorker: {
        ready: Promise.resolve({ active: { postMessage: (message, ports) => {
            owners.push(message.uid); ports[0].postMessage({ success: true }); ports[0].close();
        } } }),
        addEventListener: (_, fn) => listeners.push(fn)
    } };
    const context = vm.createContext({ auth, cfClient, window, navigator, document, console: { ...console, log: () => {}, error: () => {} },
        app: {}, getMessaging: () => ({}), getToken, isSupported: async () => true,
        Notification, MessageChannel, Date, setTimeout, clearTimeout });
    vm.runInContext(source, context);
    return { auth, cfClient, window, owners, listeners, getToken, events, banners, navigator, document, Notification, button };
}

describe('Push client lifecycle (production functions)', () => {
    test('halaman setelah logout mengabaikan push, termasuk payload rusak', async () => {
        const h = clientHarness(); await h.window.setupPushNotifications('A');
        h.auth.currentUser = null;
        const postMessage = jest.fn();
        h.listeners[0]({ data: { type: 'SIMAS_PUSH_FOREGROUND', payload: { data: { recipientUid: 'A', title: 'Pribadi' } } }, ports: [{ postMessage }] });
        h.listeners[0]({ data: { type: 'SIMAS_PUSH_FOREGROUND' } });
        expect(h.window.showToast).not.toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledWith({ handled: true });
    });

    test('kegagalan menyimpan owner lokal mencegah registrasi token ke backend', async () => {
        const h = clientHarness();
        h.navigator.serviceWorker.ready = Promise.resolve({ active: { postMessage: (_, ports) => {
            ports[0].postMessage({ success: false }); ports[0].close();
        } } });
        expect((await h.window.setupPushNotifications('A')).reason).toBe('error');
        expect(h.cfClient.registerPushToken).not.toHaveBeenCalled();
    });

    test('respons registrasi backend tanpa success tidak dilaporkan aktif', async () => {
        const h = clientHarness(); h.cfClient.registerPushToken.mockResolvedValue({ success: false });
        expect((await h.window.setupPushNotifications('A')).success).toBe(false);
    });
    test('logout mempertahankan token dan binding lokal', async () => {
        const h = clientHarness();
        expect((await h.window.setupPushNotifications('A')).success).toBe(true);
        const ownerUpdates = h.owners.length;
        h.auth.currentUser = null;
        expect(await h.window.unregisterFCMToken('A')).toEqual({ success: true, retained: true });
        expect(h.owners).toHaveLength(ownerUpdates);
        expect(h.cfClient.registerPushToken).toHaveBeenCalledTimes(1);
    });

    test('login B mengganti binding; setup berulang tidak menggandakan listener', async () => {
        const h = clientHarness();
        await h.window.setupPushNotifications('A');
        h.auth.currentUser = { uid: 'B', getIdToken: jest.fn(async () => 'auth-token-B') };
        await h.window.setupPushNotifications('B');
        expect(h.owners.at(-1)).toBe('B');
        expect(h.listeners).toHaveLength(1);
        expect(h.cfClient.registerPushToken).toHaveBeenCalledTimes(2);
    });

    test('setup A yang tertunda tidak mendaftarkan token setelah sesi berubah menjadi B', async () => {
        const h = clientHarness();
        h.getToken.mockImplementation(async () => { h.auth.currentUser = { uid: 'B' }; return 'token'; });
        expect((await h.window.setupPushNotifications('A')).success).toBe(false);
        expect(h.cfClient.registerPushToken).not.toHaveBeenCalled();
    });

    test('foreground memberi ACK setelah toast, dan menolak pesan akun sebelumnya', async () => {
        const h = clientHarness();
        await h.window.setupPushNotifications('A');
        const postMessage = jest.fn();
        const emit = uid => h.listeners[0]({ data: { type: 'SIMAS_PUSH_FOREGROUND', payload: {
            data: { recipientUid: uid, title: 'Judul', body: 'Isi', url: '/agenda.html' }
        } }, ports: [{ postMessage }] });
        emit('A'); emit('B');
        expect(h.window.showToast).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({ handled: true });
        h.window.showToast = undefined;
        emit('A');
        expect(postMessage).toHaveBeenLastCalledWith({ handled: false });
    });

    test('push dijeda tetap memperbarui pemilik lokal dan token yang sudah diizinkan', async () => {
        const h = clientHarness();
        h.cfClient.getSystemSetting.mockResolvedValue({ enabled: false });
        expect((await h.window.setupPushNotifications('A')).reason).toBe('disabled');
        expect(h.owners.at(-1)).toBe('A');
        expect(h.cfClient.registerPushToken).toHaveBeenCalledTimes(1);
    });

    test('izin granted tidak dilaporkan aktif ketika registrasi backend gagal', async () => {
        const h = clientHarness();
        h.cfClient.registerPushToken.mockRejectedValue(new Error('Failed to fetch'));
        expect(await h.window.requestNotificationPermission()).toBe(false);
        expect(h.window.showToast).toHaveBeenLastCalledWith('Push Belum Aktif', expect.any(String), 'warning');
        expect(h.banners.has('push-registration-banner')).toBe(true);
        h.cfClient.registerPushToken.mockResolvedValue({ success: true });
        expect(await h.window.requestNotificationPermission()).toBe(true);
        expect(h.banners.size).toBe(0);
    });

    test('setup serentak untuk akun sama hanya melakukan satu registrasi', async () => {
        const h = clientHarness();
        const results = await Promise.all([h.window.setupPushNotifications('A'), h.window.setupPushNotifications('A')]);
        expect(results.every(result => result.success)).toBe(true);
        expect(h.getToken).toHaveBeenCalledTimes(1);
        expect(h.cfClient.registerPushToken).toHaveBeenCalledTimes(1);
    });

    test('tombol hubungkan ulang memulihkan perangkat setelah event DOM selesai', async () => {
        const h = clientHarness();
        h.cfClient.registerPushToken.mockRejectedValueOnce(new Error('offline'));
        await h.window.setupPushNotifications('A');
        const click = h.button.addEventListener.mock.calls.find(([name]) => name === 'click')[1];
        const event = { currentTarget: h.button };
        const retry = click(event);
        event.currentTarget = null; // Browser menghapus currentTarget setelah dispatch.
        await retry;
        expect(h.button.disabled).toBe(false);
        expect(h.banners.size).toBe(0);
        expect(h.cfClient.registerPushToken).toHaveBeenCalledTimes(2);
    });

    test('kembali online memulihkan registrasi gagal dan focus berulang dibatasi', async () => {
        const h = clientHarness();
        h.cfClient.registerPushToken.mockRejectedValueOnce(new Error('offline'));
        await h.window.setupPushNotifications('A');
        // Kendalikan clock saja; MessageChannel tetap memakai runtime asli.
        const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31000);
        try {
            await h.events.online();
            expect(h.banners.size).toBe(0);
            expect(h.cfClient.registerPushToken).toHaveBeenCalledTimes(2);
            h.events.focus(); h.events.visibilitychange();
            expect(h.cfClient.registerPushToken).toHaveBeenCalledTimes(2);
        } finally { clock.mockRestore(); }
    });

    test('kembali aktif memperbarui token setelah lima menit, hanya untuk akun aktif', async () => {
        const h = clientHarness();
        await h.window.setupPushNotifications('A');
        const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 301000);
        try {
            h.document.visibilityState = 'hidden'; h.events.online();
            expect(h.cfClient.registerPushToken).toHaveBeenCalledTimes(1);
            h.document.visibilityState = 'visible'; await h.events.visibilitychange();
            expect(h.cfClient.registerPushToken).toHaveBeenCalledTimes(2);
            h.auth.currentUser = null; h.events.focus();
            expect(h.cfClient.registerPushToken).toHaveBeenCalledTimes(2);
        } finally { clock.mockRestore(); }
    });

    test('service worker yang tidak pernah siap menghasilkan status gagal dengan batas waktu', async () => {
        jest.useFakeTimers();
        try {
            const h = clientHarness();
            h.navigator.serviceWorker.ready = new Promise(() => {});
            const attempt = h.window.setupPushNotifications('A');
            await jest.advanceTimersByTimeAsync(15001);
            expect((await attempt).reason).toBe('error');
            expect(h.banners.has('push-registration-banner')).toBe(true);
            expect(h.cfClient.registerPushToken).not.toHaveBeenCalled();
        } finally { jest.useRealTimers(); }
    });
});
