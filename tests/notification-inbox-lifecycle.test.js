/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/notification-inbox.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const notification = (id, extra = {}) => ({ id, title: id, body: 'Isi', url: './agenda.html',
    createdAt: new Date().toISOString(), isRead: false, ...extra });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };

function harness() {
    localStorage.clear();
    document.body.innerHTML = '<span id="notif-badge-desktop"></span><div id="notification-items-list"></div>';
    const auth = { currentUser: { uid: 'A' } };
    const cfClient = { getNotificationInbox: jest.fn(async () => ({ success: true, notifications: [], unreadCount: 0 })),
        markNotificationAsRead: jest.fn(async () => ({ success: true, markedCount: 1 })) };
    const events = {};
    const appWindow = { location: { origin: 'https://simas.test' }, showToast: jest.fn(),
        addEventListener: (type, fn) => { events[type] = fn; } };
    const context = vm.createContext({ auth, cfClient, window: appWindow, document, localStorage,
        navigator: { onLine: true }, setInterval: jest.fn(), console, URL, Date });
    vm.runInContext(source, context);
    return { auth, cfClient, window: appWindow, events, context,
        items: () => JSON.parse(vm.runInContext('JSON.stringify(_inboxNotifications)', context)),
        cache: () => JSON.parse(localStorage.getItem('simas_inbox_cache')),
        push: id => appWindow.injectIncomingNotification({ data: { jobId: id, title: id, recipientUid: auth.currentUser?.uid } }) };
}

test('push selama fetch tetap ada, tersimpan lintas-tab, dan job yang sama tidak menggandakan badge', async () => {
    const h = harness(); const pending = deferred();
    h.cfClient.getNotificationInbox.mockReturnValueOnce(pending.promise);
    const load = h.window.loadNotificationInbox(true);
    h.push('baru'); h.push('baru');
    expect(h.cache().notifications.map(n => n.id)).toEqual(['baru']);
    pending.resolve({ success: true, notifications: [notification('lama')], unreadCount: 1 });
    await load;
    expect(h.items().map(n => n.id)).toEqual(expect.arrayContaining(['baru', 'lama']));
    expect(h.cache().unreadCount).toBe(2);
    h.cfClient.getNotificationInbox.mockResolvedValue({ success: true, notifications: [notification('baru'), notification('lama')] });
    await h.window.loadNotificationInbox(true);
    expect(h.items()).toHaveLength(2);
});

test('respons akun A tidak menimpa akun B atau menulis data A ke cache B', async () => {
    const h = harness(); const pendingA = deferred(); const pendingB = deferred();
    h.cfClient.getNotificationInbox.mockReturnValueOnce(pendingA.promise).mockReturnValueOnce(pendingB.promise);
    const loadA = h.window.loadNotificationInbox(true);
    h.auth.currentUser = { uid: 'B' };
    const loadB = h.window.loadNotificationInbox(true);
    pendingA.resolve({ success: true, notifications: [notification('rahasia-A')] });
    await loadA;
    expect(h.items()).toEqual([]);
    expect(h.cache()).toBeNull();
    // finally milik A tidak boleh menghapus penanda fetch B.
    const anotherLoadB = h.window.loadNotificationInbox(true);
    expect(h.cfClient.getNotificationInbox).toHaveBeenCalledTimes(2);
    pendingB.resolve({ success: true, notifications: [notification('milik-B')] });
    await Promise.all([loadB, anotherLoadB]);
    expect(h.cache().uid).toBe('B');
    expect(h.items().map(n => n.id)).toEqual(['milik-B']);
});

test('logout membatalkan hasil fetch, membersihkan DOM, dan menolak push foreground', async () => {
    const h = harness(); h.push('lama');
    const pending = deferred(); h.cfClient.getNotificationInbox.mockReturnValueOnce(pending.promise);
    const load = h.window.loadNotificationInbox(true);
    h.window.clearNotificationInboxCache(); h.auth.currentUser = null;
    pending.resolve({ success: true, notifications: [notification('lama')] });
    await load; h.push('terlambat'); await h.window.loadNotificationInbox(true);
    expect(h.items()).toEqual([]); expect(h.cache()).toBeNull();
    expect(document.getElementById('notif-badge-desktop').classList.contains('hidden')).toBe(true);
    expect(h.cfClient.getNotificationInbox).toHaveBeenCalledTimes(1);
});

test('status baca gagal tetap belum dibaca dan memberi informasi untuk mencoba lagi', async () => {
    const h = harness(); h.push('job1');
    h.cfClient.markNotificationAsRead.mockRejectedValueOnce(new Error('offline'));
    await h.window.markAllNotificationsAsRead();
    expect(h.items()[0].isRead).toBe(false);
    expect(h.cache().unreadCount).toBe(1);
    expect(h.window.showToast).toHaveBeenLastCalledWith('Status Baca Belum Tersimpan', expect.any(String), 'warning', 3000);
    await h.window.markAllNotificationsAsRead();
    expect(h.items()[0].isRead).toBe(true); expect(h.cache().unreadCount).toBe(0);
});

test('konfirmasi baca tidak hilang karena fetch lama, dan push yang datang saat mark-all tetap baru', async () => {
    const h = harness(); h.push('job1');
    const pending = deferred(); h.cfClient.getNotificationInbox.mockReturnValueOnce(pending.promise);
    const load = h.window.loadNotificationInbox(true);
    const reading = deferred(); h.cfClient.markNotificationAsRead.mockReturnValueOnce(reading.promise);
    const mark = h.window.markAllNotificationsAsRead(); h.push('job2');
    reading.resolve({ success: true }); await mark;
    pending.resolve({ success: true, notifications: [notification('job1')] }); await load;
    expect(h.items().find(n => n.id === 'job1').isRead).toBe(true);
    expect(h.items().find(n => n.id === 'job2').isRead).toBe(false);
    expect(h.cache().unreadCount).toBe(1);
});

test('storage event memperbarui tab lain tanpa fetch tambahan dan hanya untuk akun sama', async () => {
    const h = harness(); await h.window.loadNotificationInbox();
    const cache = { uid: 'A', notifications: [notification('lintas-tab', { isRead: true })], unreadCount: 0, timestamp: Date.now() };
    localStorage.setItem('simas_inbox_cache', JSON.stringify(cache));
    h.events.storage({ key: 'simas_inbox_cache', newValue: JSON.stringify(cache) });
    expect(h.items().map(n => n.id)).toEqual(['lintas-tab']);
    localStorage.setItem('simas_inbox_cache', JSON.stringify({ ...cache, uid: 'B', notifications: [notification('rahasia-B')] }));
    h.events.storage({ key: 'simas_inbox_cache', newValue: 'updated' });
    expect(h.items().map(n => n.id)).toEqual(['lintas-tab']);
    expect(h.cfClient.getNotificationInbox).toHaveBeenCalledTimes(1);
});

test('URL lonceng mempertahankan origin sesi dari halaman bersubfolder dan menolak URL luar', () => {
    const h = harness();
    expect(h.context.notificationTargetUrl('./e-lab.html')).toBe('https://simas.test/e-lab.html');
    expect(h.context.notificationTargetUrl('https://simas-demo-5ead3.web.app/e-lab.html?id=1#detail')).toBe('https://simas.test/e-lab.html?id=1#detail');
    expect(h.context.notificationTargetUrl('//evil.test/')).toBe('https://simas.test/dashboard.html');
    expect(h.context.notificationTargetUrl('javascript:alert(1)')).toBe('https://simas.test/dashboard.html');
});

test('timestamp D1 tanpa timezone menampilkan waktu relatif yang sama dengan push UTC ISO', () => {
    const h = harness();
    const iso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const d1 = iso.slice(0, 19).replace('T', ' ');
    expect(h.context.formatRelativeTime(d1)).toBe('10 mnt lalu');
    expect(h.context.formatRelativeTime(d1)).toBe(h.context.formatRelativeTime(iso));
});

test('panel lonceng tetap terbuka ketika dibuka sebelum pemuatan inbox pertama', async () => {
    const h = harness();
    document.body.insertAdjacentHTML('beforeend', '<div id="notification-center-panel" class="hidden"></div><div id="notification-center-backdrop" class="hidden"></div>');
    h.window.openNotificationCenter();
    await h.window.loadNotificationInbox();
    expect(document.getElementById('notification-center-panel').classList.contains('hidden')).toBe(false);
});

test('push sebelum load awal tidak menghalangi pemuatan riwayat server', async () => {
    const h = harness(); h.push('baru');
    h.cfClient.getNotificationInbox.mockResolvedValue({ success: true, notifications: [notification('riwayat')] });
    await h.window.loadNotificationInbox();
    expect(h.cfClient.getNotificationInbox).toHaveBeenCalledTimes(1);
    expect(h.items().map(n => n.id)).toEqual(expect.arrayContaining(['baru', 'riwayat']));
});

test('refresh gagal mempertahankan daftar lama dan online memulihkan load awal yang gagal', async () => {
    const h = harness();
    h.cfClient.getNotificationInbox.mockRejectedValueOnce(new Error('offline'));
    await h.window.loadNotificationInbox();
    h.cfClient.getNotificationInbox.mockResolvedValue({ success: true, notifications: [notification('riwayat')] });
    await h.events.online();
    expect(h.items().map(n => n.id)).toEqual(['riwayat']);
    h.cfClient.getNotificationInbox.mockRejectedValueOnce(new Error('offline'));
    await h.window.loadNotificationInbox(true);
    expect(document.getElementById('notification-items-list').textContent).toContain('riwayat');
    expect(document.getElementById('notification-items-list').textContent).not.toContain('Memuat notifikasi');
});

test('payload push lama tanpa job D1 dapat dibaca lokal tanpa error mark-read di server', async () => {
    const h = harness();
    h.window.injectIncomingNotification({ notification: { title: 'Pesan lama', body: 'FCM legacy' }, messageId: 'fcm-legacy' });
    h.cfClient.markNotificationAsRead.mockRejectedValue(new Error('404 Notifikasi tidak tersedia'));
    await h.window.openNotificationDetail('fcm-legacy');
    await Promise.resolve();
    expect(h.cfClient.markNotificationAsRead).not.toHaveBeenCalled();
    expect(h.items()[0].isRead).toBe(true);
    expect(h.cache().unreadCount).toBe(0);
});

test('klik ulang detail selama konfirmasi baca belum selesai tidak mengirim mutasi ganda', async () => {
    const h = harness(); h.push('job1');
    const pending = deferred(); h.cfClient.markNotificationAsRead.mockReturnValue(pending.promise);
    await h.window.openNotificationDetail('job1');
    await h.window.openNotificationDetail('job1');
    expect(h.cfClient.markNotificationAsRead).toHaveBeenCalledTimes(1);
    pending.resolve({ success: true });
    await Promise.resolve();
});

test('cache dengan struktur salah diabaikan dan tidak menggagalkan pemuatan inbox', async () => {
    const h = harness();
    localStorage.setItem('simas_inbox_cache', JSON.stringify({ uid: 'A', timestamp: Date.now(), notifications: {}, unreadCount: 0 }));
    h.cfClient.getNotificationInbox.mockResolvedValue({ success: true, notifications: [notification('riwayat')] });
    await expect(h.window.loadNotificationInbox()).resolves.toBeUndefined();
    expect(h.items().map(n => n.id)).toEqual(['riwayat']);
});
