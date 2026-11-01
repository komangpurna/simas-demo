// Run with scripts/test-lks-server.cjs; never accesses production APIs.
const suite = Cypress.env('lksWorkflow') ? describe : describe.skip;
suite('LKS siswa/admin kelas dan admin LKS', () => {
    beforeEach(() => { cy.request('POST', '/__test__/lks/reset'); cy.clearLocalStorage(); });
    const visit = (name, role) => {
        cy.visit(`/__test__/lks/page/${name}?role=${role}`, { onBeforeLoad(win) {
            win.lksErrors = [];
            win.addEventListener('error', event => win.lksErrors.push(event.message));
            win.addEventListener('unhandledrejection', event => win.lksErrors.push(String(event.reason)));
        } });
        cy.window().should(win => expect(win.lksErrors).to.deep.equal([]));
        cy.window().its('lksReady').should('equal', true);
    };
    it('pesan dari HP, lihat tagihan, admin catat bertahap hingga stok dan kebutuhan sesuai', () => {
        cy.viewport(390, 844);
        visit('pesan-lks', 'admin_kelas');
        cy.get('#lks-stock-list').should('be.visible').and('contain', 'Matematika').and('contain', '10 eks');
        cy.screenshot('lks-stok-admin-kelas-mobile', { capture: 'viewport' });
        cy.get('#cards-matrix-order-list input[type=checkbox]').first().check();
        cy.get('#cards-matrix-order-list input[type=checkbox]').last().check();
        cy.get('#btn-top-save-order').click();
        cy.contains('Ya, Kirim Pesanan').click();
        cy.get('#lks-test-notice').should('contain', 'Berhasil Dikirim');
        cy.get('#tab-btn-matrix-rekap').click();
        cy.get('#cards-rekap-list').should('contain', 'Rp 17.000').and('contain', "I Made O'Brian");
        cy.screenshot('lks-tagihan-siswa-mobile', { capture: 'viewport' });
        cy.clearLocalStorage();
        cy.viewport(1280, 900);
        visit('penjualan-buku', 'admin_lks');
        cy.get('#tab-btn-orders').click();
        cy.get('#tab-btn-settings').should('not.be.visible');
        cy.get('#table-orders-body').should('contain', 'Kurang 2 eks');
        cy.get('#table-orders-body button').click();
        cy.get('#tx-class').should('have.value', 'X-1');
        cy.get('#tx-qty').should('have.value', '2').clear().type('1');
        cy.get('#modal-add-transaction form').submit();
        cy.get('#table-orders-body').should('contain', 'Kurang 1 eks');
        cy.get('#table-orders-body button').click();
        cy.get('#modal-add-transaction form').submit();
        cy.get('#table-orders-body').should('contain', 'Seluruh Pesanan Kelas Sudah Terpenuhi');
        cy.request('/__test__/lks/settings/book_sales_lks_data').its('body').then(data => {
            expect(data.transactions).to.have.length(2);
            expect(data.books[0].sisa).to.equal(8);
        });
        cy.screenshot('lks-admin-pesanan-terpenuhi', { capture: 'viewport' });
        cy.window().its('lksErrors').should('deep.equal', []);
        cy.clearLocalStorage();
        visit('pesan-lks', 'admin_kelas');
        cy.get('#lks-stock-list').should('be.visible').and('contain', '8 eks');
        cy.request('/__test__/lks/settings/book_sales_lks_data').then(({ body }) => {
            body.books[0].sisa = 0;
            cy.request('POST', '/__test__/lks/settings/book_sales_lks_data', body);
        });
        cy.get('#btn-refresh').click();
        cy.get('#lks-stock-list').should('contain', '0 eks').and('contain', 'Habis');
        cy.screenshot('lks-stok-admin-kelas-desktop', { capture: 'viewport' });
    });
    it('koneksi gagal menjaga pilihan, lalu retry dan pembatalan seluruh pesanan berhasil', () => {
        visit('pesan-lks', 'admin_kelas');
        let fail = true;
        cy.intercept('POST', '**/__test__/lks/settings/book_orders_data', req => { if (fail) req.reply({ statusCode: 503, body: {} }); else req.continue(); });
        cy.get('#table-matrix-order-body input[type=checkbox]').first().check();
        cy.get('#btn-top-save-order').click();
        cy.contains('Ya, Kirim Pesanan').click();
        cy.get('#lks-test-notice').should('contain', 'Belum Terkirim');
        cy.get('#top-save-bar-order').should('be.visible');
        cy.then(() => { fail = false; });
        cy.get('#btn-top-save-order').click();
        cy.contains('Ya, Kirim Pesanan').click();
        cy.get('#lks-test-notice').should('contain', 'Berhasil Dikirim');
        cy.get('#table-matrix-order-body input[type=checkbox]').first().uncheck();
        cy.get('#btn-top-save-order').click();
        cy.contains('Ya, Kirim Pesanan').click();
        cy.get('#lks-test-notice').should('contain', 'Berhasil Dikirim');
        cy.request('/__test__/lks/settings/book_orders_data').its('body.orders').should('have.length', 0);
    });
});
