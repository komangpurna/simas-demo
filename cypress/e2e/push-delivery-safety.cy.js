/* IndexedDB dan MessageChannel browser asli, tanpa FCM atau akun produksi. */
describe('Native push lifecycle', () => {
    let source;
    let harness;
    before(() => cy.readFile('push-worker.js').then(text => { source = text; }));
    beforeEach(() => {
        cy.visit('/cypress/fixtures/push-harness.html');
        cy.window().then(async win => {
            await new Promise((resolve, reject) => {
                const request = win.indexedDB.deleteDatabase('simas-push-state');
                request.onsuccess = resolve;
                request.onerror = () => reject(request.error);
            });
            const handlers = {};
            const notifications = [];
            const windows = [];
            const self = {
                location: win.location,
                clients: { matchAll: async () => windows, openWindow: async url => url },
                registration: { showNotification: async (title, options) => notifications.push({ title, ...options }) },
                addEventListener: (type, handler) => { handlers[type] = handler; }
            };
            const api = new win.Function('self', `${source}\nreturn { storePushOwner, pushTargetUrl };`)(self);
            harness = { ...api, handlers, notifications, windows, push: (data, notification) => {
                let pending;
                handlers.push({ data: { json: () => ({ data, notification }) }, waitUntil: promise => { pending = promise; } });
                return pending;
            } };
        });
    });

    it('hanya dedupe job yang sama; judul/isi identik dengan job baru tetap tampil', () => cy.then(async () => {
        await harness.storePushOwner('A');
        await Promise.all([1, 2].map(() => harness.push({ recipientUid: 'A', jobId: 'job1', title: 'Sama', body: 'Isi sama' })));
        await harness.push({ recipientUid: 'A', jobId: 'job2', title: 'Sama', body: 'Isi sama' });
        expect(harness.notifications).to.have.length(2);
        expect(harness.notifications.map(item => item.tag)).to.deep.equal(['simas-job1', 'simas-job2']);
    }));

    it('logout mempertahankan binding; login B menolak push tertunda untuk A', () => cy.then(async () => {
        await harness.storePushOwner('A');
        // Logout tidak mengubah penyimpanan owner.
        await harness.push({ recipientUid: 'A', jobId: 'after-logout', title: 'Untuk A' });
        await harness.storePushOwner('B');
        await harness.push({ recipientUid: 'A', jobId: 'old-in-flight', title: 'Pesan lama' });
        await harness.push({ recipientUid: 'B', jobId: 'new-owner', title: 'Untuk B' });
        expect(harness.notifications.map(item => item.title)).to.deep.equal(['Untuk A', 'Untuk B']);
    }));

    it('foreground tetap menampilkan satu push sistem dan menyinkronkan satu tab', () => cy.then(async () => {
        let received = 0;
        let nativeShown = false;
        harness.windows.push(...[1, 2].map(() => ({ focused: true, visibilityState: 'visible',
            postMessage: (message, ports) => { received++; nativeShown = message.payload.nativeNotificationShown;
                ports[0].postMessage({ handled: true }); ports[0].close(); } })));
        await harness.push({ jobId: 'foreground', title: 'Tes' });
        await harness.push({ jobId: 'foreground', title: 'Tes' });
        expect(received).to.equal(1);
        expect(nativeShown).to.equal(true);
        expect(harness.notifications).to.have.length(1);
    }));

    it('kegagalan mencari tab tidak menggagalkan push sistem', () => cy.then(async () => {
        harness.windows.push({ get visibilityState() { throw new Error('tab unavailable'); } });
        await harness.push({ jobId: 'page-error', title: 'Persetujuan Lab' });
        expect(harness.notifications).to.have.length(1);
        expect(harness.notifications[0].title).to.equal('Persetujuan Lab');
    }));

    it('tab lama tanpa listener tetap menerima banner OS melalui fallback', () => cy.then(async () => {
        harness.windows.push({ focused: true, visibilityState: 'visible', postMessage: () => {} });
        await harness.push({ jobId: 'fallback', title: 'Tetap sampai' });
        expect(harness.notifications).to.have.length(1);
    }));

    it('payload lama tetap diterima dan URL eksternal tidak dibuka', () => cy.then(async () => {
        await harness.push({ url: '//evil.example' }, { title: 'Legacy', body: 'Payload versi lama' });
        expect(harness.notifications).to.have.length(1);
        expect(harness.notifications[0].data.url).to.equal(`${window.location.origin}/dashboard.html`);
    }));
});
