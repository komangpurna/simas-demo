const suite = Cypress.env('lmsHtmlIntegration') ? describe : describe.skip;
suite('Actual LMS creator modal workspace', () => {
    beforeEach(() => { cy.visit('/cypress/fixtures/lms-creator-workspace.html'); cy.window().its('demoReady').should('equal', true); });
    it('keeps mode buttons in the header and scrolls desktop material/settings columns independently', () => {
        cy.viewport(1280, 600);
        cy.get('#btn-creator-tab-create').parents('.lms-creator-header').should('have.length', 1);
        cy.get('#btn-creator-tab-copy').parents('.lms-creator-header').should('have.length', 1);
        cy.get('.lms-field-title').first().type('Materi pertama');
        cy.get('.lms-field-resource-type').first().select('html');
        cy.get('.lms-html-actions').first().should('be.visible');
        cy.get('.lms-media-type-row').first().then($el => expect($el[0].scrollWidth).to.be.at.most($el[0].clientWidth));
        cy.get('.lms-html-file-input').first().selectFile({ contents: Cypress.Buffer.from('<h1>Materi interaktif</h1>'), fileName: 'materi.html' }, { force: true });
        cy.get('.lms-html-actions').first().contains('Preview').click();
        cy.get('#lms-preview-body iframe').should('have.attr', 'sandbox', 'allow-scripts');
        cy.get('#modal-lms-text-preview').contains('button', 'Tutup').click();
        cy.get('#btn-submit-lms-add-another').click();
        cy.get('.lms-material-card').eq(1).find('.lms-field-title').type('Materi kedua');
        cy.get('.lms-material-card').eq(1).find('.lms-field-resource-type').select('html');
        cy.get('.lms-material-card').eq(1).find('.lms-media-type-row .lms-html-actions').should('be.visible');
        let settingsTop, rightScroll;
        cy.get('.lms-creator-settings').then($el => { settingsTop = $el[0].getBoundingClientRect().top; rightScroll = $el[0].scrollTop; });
        cy.get('.lms-creator-materials').scrollTo('bottom', { duration: 0 });
        cy.get('.lms-creator-materials').should($el => expect($el[0].scrollWidth).to.be.at.most($el[0].clientWidth + 1));
        cy.get('.lms-creator-settings').should($el => {
            const rect = $el[0].getBoundingClientRect();
            expect(rect.top).to.be.closeTo(settingsTop, 1); expect($el[0].scrollTop).to.equal(rightScroll);
            expect(rect.bottom).to.be.at.most($el[0].ownerDocument.getElementById('footer-wizard-step-2').getBoundingClientRect().top);
        });
        cy.get('.lms-creator-settings').scrollTo('bottom', { duration: 0 });
        cy.get('#input-lms-material-due').should('be.visible');
        cy.get('#btn-submit-lms-material').should('be.visible');
        cy.screenshot('lms-creator-desktop-independent-scroll', { capture: 'viewport' });
        cy.get('#btn-creator-tab-copy').click();
        cy.get('#container-creator-tab-copy').should('be.visible');
        cy.get('#btn-creator-tab-copy').should('have.attr', 'aria-pressed', 'true');
        cy.get('#btn-creator-tab-create').click();
        cy.get('#lms-wizard-step-2').should('be.visible');
        cy.get('.lms-field-title').first().should('have.value', 'Materi pertama');
    });
    it('keeps import/preview beside the dropdown on mobile and lets students settings remain reachable', () => {
        cy.viewport(390, 844);
        cy.get('.lms-field-resource-type').first().select('html');
        cy.get('.lms-media-type-row').first().then($el => {
            const select = $el[0].querySelector('select').getBoundingClientRect();
            const actions = $el[0].querySelector('.lms-html-actions').getBoundingClientRect();
            expect(actions.left).to.be.at.least(select.right); expect(actions.bottom).to.be.closeTo(select.bottom, 1);
            expect($el[0].scrollWidth).to.be.at.most($el[0].clientWidth);
        });
        cy.get('.lms-creator-materials').should($el => expect($el[0].scrollWidth).to.be.at.most($el[0].clientWidth + 1));
        cy.get('#lms-wizard-step-2').should($el => expect($el[0].scrollWidth).to.be.at.most($el[0].clientWidth + 1));
        cy.screenshot('lms-creator-mobile-html-actions', { capture: 'viewport' });
        cy.get('.lms-creator-settings').scrollIntoView();
        cy.get('#input-lms-material-due').scrollIntoView().should('be.visible');
        cy.get('#btn-submit-lms-material').should('be.visible');
        cy.get('.lms-creator-dialog').then($el => expect($el[0].scrollWidth).to.be.at.most($el[0].clientWidth));
    });
});
