const suite = Cypress.env('lmsHtmlIntegration') ? describe : describe.skip;
suite('Link LMS: actual handlers and Worker with browser security enabled', () => {
    beforeEach(() => {
        expect(Cypress.config('chromeWebSecurity')).to.equal(true);
        cy.request('POST', '/__test__/html/reset');
        cy.visit('/cypress/fixtures/lms-html-workflow.html');
        cy.window().its('demoReady').should('equal', true);
        cy.window().then(win => { win.localStorage.clear(); win.sessionStorage.clear(); });
    });
    function save(url) {
        cy.get('.lms-field-title').type('Simple Past Tense');
        cy.get('.lms-field-resource-type').select('link');
        cy.get('.lms-field-resource-url').type(url);
        cy.get('.lms-field-content').type('Baca **petunjuk guru**, kerjakan latihan, lalu kembali ke LMS.');
        cy.get('#btn-submit-lms-material').click();
        cy.get('#demo-notice').should('contain', 'Berhasil');
    }
    for (const dark of [false, true]) it(`Canva link is actionable on mobile in ${dark ? 'dark' : 'light'} mode, even when the secondary list refresh fails`, () => {
        cy.viewport(390, 844);
        cy.get('html').invoke('toggleClass', 'dark', dark);
        save('https://kuispengimbasan.my.canva.site/simple-past?kelas=X#latihan');
        let reads = 0;
        cy.intercept('POST', '/__test__/html/api', req => {
            if (req.body.route === '/api/lms/student/courses' && ++reads === 2) req.reply({ forceNetworkError: true });
        });
        cy.intercept('GET', 'https://kuispengimbasan.my.canva.site/**').as('canvaFrame');
        cy.clock(); cy.get('#demo-student').click();
        cy.get('#modal-student-resource').should('be.visible');
        cy.get('#student-resource-external').should('be.visible').and('contain', 'Website Canva');
        cy.get('#student-resource-open-link').should('be.visible')
            .and('have.attr', 'href', 'https://kuispengimbasan.my.canva.site/simple-past?kelas=X#latihan')
            .and('have.attr', 'target', '_blank').and('have.attr', 'rel', 'noopener noreferrer');
        cy.get('#student-resource-frame').should('not.be.visible').and('have.attr', 'src', 'about:blank');
        cy.get('#student-resource-loader').should('not.be.visible');
        cy.get('@canvaFrame.all').should('have.length', 0);
        cy.get('#student-resource-instructions-body strong').should('have.text', 'petunjuk guru');
        cy.get('#student-resource-engagement-info').should('have.text', 'Pembukaan materi dicatat di LMS.');
        cy.tick(60000);
        cy.get('#modal-student-resource').then($el => expect($el[0].scrollWidth).to.be.at.most(390));
        cy.screenshot(`lms-link-canva-mobile-${dark ? 'dark' : 'light'}`, { capture: 'viewport' });
        cy.get('#modal-student-resource button[onclick="window.closeStudentResourceModal()"] ').click();
        cy.get('#demo-progress').click();
        cy.get('#demo-duration').should('contain', 'Siswa Satu: 0 detik, 1 sesi');
    });
    it('the primary link points to readable source content', () => {
        save('http://localhost:8102/__test__/external-material');
        cy.get('#demo-student').click();
        cy.get('#student-resource-external').should('be.visible');
        cy.get('#student-resource-frame').should('not.be.visible');
        cy.get('#student-resource-open-link').should('have.attr', 'href', 'http://localhost:8102/__test__/external-material')
            .and('have.attr', 'target', '_blank').then($link => {
            // Production opens a separate tab. Verify its complete destination
            // and source response after the real opening handler finishes.
            cy.request($link[0].href).then(response => {
                expect(response.status).to.equal(200);
                expect(response.headers['x-frame-options']).to.equal('SAMEORIGIN');
                expect(response.body).to.contain('Latihan di situs sumber').and.to.contain('id="answer"');
            });
        });
    });
});
