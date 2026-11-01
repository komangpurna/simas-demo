// DOM, localStorage, dan storage event browser asli untuk kode inbox produksi.
describe('Notification inbox: regression audit', () => {
    let source;
    let app;
    const item = (id, isRead = false) => ({ id, title: id, body: 'Isi <b>teks</b>',
        url: 'https://smagesa.web.app/e-lab.html', createdAt: new Date().toISOString(), isRead });
    const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };

    before(() => cy.readFile('js/notification-inbox.js').then(text => {
        source = text.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
    }));
    beforeEach(() => {
        cy.visit('/cypress/fixtures/push-harness.html');
        cy.window().then(win => {
            win.localStorage.removeItem('simas_inbox_cache');
            win.document.body.innerHTML = `
                <span id="notif-badge-desktop" class="hidden"></span>
                <div id="notification-center-panel" class="hidden"><div id="notification-items-list"></div></div>
                <div id="notification-center-backdrop" class="hidden"></div>
                <div id="modal-notification-detail" class="hidden">
                    <span id="notif-detail-category-badge"></span><span id="notif-detail-icon-container"></span>
                    <span id="notif-detail-icon"></span><h4 id="notif-detail-title"></h4>
                    <span id="notif-detail-time"></span><p id="notif-detail-body"></p>
                    <button id="notif-detail-btn-action">Buka halaman</button>
                </div>`;
            const auth = { currentUser: { uid: 'A' } };
            const reads = [];
            const cfClient = {
                getNotificationInbox: async () => ({ success: true, notifications: [], unreadCount: 0 }),
                markNotificationAsRead: async (id, markAll) => { reads.push({ id, markAll }); return { success: true }; }
            };
            win.showToast = () => {};
            new win.Function('auth', 'cfClient', source)(auth, cfClient);
            app = { win, auth, cfClient, reads, cache: () => JSON.parse(win.localStorage.getItem('simas_inbox_cache')) };
        });
    });

    it('klik detail memakai DOM nyata, isi tetap teks, dan konfirmasi baca tidak diduplikasi', () => {
        const pending = deferred();
        cy.then(async () => {
            app.cfClient.getNotificationInbox = async () => ({ success: true, notifications: [item('job1')] });
            app.cfClient.markNotificationAsRead = (id, markAll) => { app.reads.push({ id, markAll }); return pending.promise; };
            app.win.openNotificationCenter();
            await app.win.loadNotificationInbox();
            expect(app.cache().notifications[0].url).to.equal(`${app.win.location.origin}/e-lab.html`);
        });
        cy.get('#notification-center-panel').should('not.have.class', 'hidden');
        cy.get('[data-notification-id="job1"]').click().click();
        cy.get('#modal-notification-detail').should('not.have.class', 'hidden');
        cy.get('#notif-detail-body').should('have.text', 'Isi <b>teks</b>').find('b').should('not.exist');
        cy.then(() => { expect(app.reads).to.have.length(1); pending.resolve({ success: true }); });
        cy.get('#notif-badge-desktop').should('have.class', 'hidden');
    });

    it('storage event dari iframe menyinkronkan tab dan tidak ditimpa respons server lama', () => cy.then(async () => {
        let requests = 0;
        app.cfClient.getNotificationInbox = async () => { requests++; return { success: true, notifications: [item('job1')] }; };
        await app.win.loadNotificationInbox();
        const pending = deferred();
        app.cfClient.getNotificationInbox = () => { requests++; return pending.promise; };
        const loading = app.win.loadNotificationInbox(true);
        const frame = app.win.document.createElement('iframe');
        frame.src = '/cypress/fixtures/push-harness.html';
        const ready = new Promise(resolve => { frame.onload = resolve; });
        app.win.document.body.append(frame);
        await ready;
        const received = new Promise(resolve => app.win.addEventListener('storage', resolve, { once: true }));
        frame.contentWindow.localStorage.setItem('simas_inbox_cache', JSON.stringify({
            uid: 'A', notifications: [item('job2'), item('job1', true)], loaded: true,
            unreadCount: 1, timestamp: Date.now()
        }));
        await received;
        frame.remove();
        pending.resolve({ success: true, notifications: [item('job1')] });
        await loading;
        expect(app.cache().notifications.find(n => n.id === 'job1').isRead).to.equal(true);
        expect(app.win.document.querySelector('[data-notification-id="job2"]')).not.to.equal(null);
        expect(app.cache().unreadCount).to.equal(1);
        expect(requests).to.equal(2);
    }));

    it('push legacy dapat dibaca lokal dan respons tertunda setelah logout tidak mengisi kembali inbox', () => cy.then(async () => {
        app.win.injectIncomingNotification({ messageId: 'legacy', notification: { title: 'Pesan lama', body: 'Legacy' } });
        await app.win.openNotificationDetail('legacy');
        expect(app.reads).to.have.length(0);
        expect(app.cache().unreadCount).to.equal(0);
        const pending = deferred();
        app.cfClient.getNotificationInbox = () => pending.promise;
        const loading = app.win.loadNotificationInbox(true);
        app.auth.currentUser = null;
        app.win.clearNotificationInboxCache();
        pending.resolve({ success: true, notifications: [item('lama')] });
        await loading;
        expect(app.cache()).to.equal(null);
        expect(app.win.document.querySelector('[data-notification-id="lama"]')).to.equal(null);
        expect(app.win.document.getElementById('notif-badge-desktop').classList.contains('hidden')).to.equal(true);
    }));

    it('cache yang rusak tidak menghalangi load atau menutup panel pertama', () => cy.then(async () => {
        app.win.localStorage.setItem('simas_inbox_cache', JSON.stringify({ uid: 'A', timestamp: Date.now(), notifications: {} }));
        app.cfClient.getNotificationInbox = async () => ({ success: true, notifications: [item('baru')] });
        app.win.openNotificationCenter();
        await app.win.loadNotificationInbox();
        expect(app.cache().notifications[0].id).to.equal('baru');
        expect(app.win.document.getElementById('notification-center-panel').classList.contains('hidden')).to.equal(false);
    }));
});
