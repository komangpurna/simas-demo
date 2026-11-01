const suite = Cypress.env('lmsHtmlIntegration') ? describe : describe.skip;
suite('LMS discussion: long prompts and visible composer, real handlers and Worker', () => {
    beforeEach(() => {
        cy.request('POST', '/__test__/html/reset');
        cy.visit('/cypress/fixtures/lms-discussion-layout.html');
        cy.window().its('demoReady').should('equal', true);
    });
    function composerWithinScreen(modal, input, button, height, top = 0) {
        cy.get(`${modal} .lms-discussion-panel`).then($el => {
            expect($el[0].scrollWidth).to.be.at.most($el[0].clientWidth + 1);
        });
        for (const selector of [input, button]) cy.get(selector).should('be.visible').then($el => {
            const box = $el[0].getBoundingClientRect();
            expect(box.top).to.be.at.least(top);
            expect(box.bottom).to.be.at.most(top + height);
        });
    }
    function keyboard(height, top = 0) {
        cy.window().then(win => {
            Object.defineProperties(win.visualViewport, { height: { configurable: true, value: height }, offsetTop: { configurable: true, value: top } });
            win.visualViewport.dispatchEvent(new win.Event('resize'));
        });
    }
    for (const dark of [false, true]) it(`student can read a long prompt and submit while the keyboard reduces the screen (${dark ? 'dark' : 'light'})`, () => {
        cy.viewport(392, 850); cy.get('html').invoke('toggleClass', 'dark', dark);
        cy.get('#demo-student-discussion').click();
        cy.get('#student-lms-prompt-container').should('contain', 'AKHIR PEMANTIK');
        composerWithinScreen('#modal-student-lms-discussion', '#input-student-lms-content', '#btn-send-student-lms-comment', 850);
        cy.contains('button', 'Tanggapi Masalah').click();
        cy.get('#input-student-lms-content').should('be.focused').type('Simpulan saya: pengelompokan berkembang berdasarkan bukti baru.');
        cy.get('#modal-student-lms-discussion .lms-discussion-body').scrollTo('bottom');
        keyboard(330, 50);
        composerWithinScreen('#modal-student-lms-discussion', '#input-student-lms-content', '#btn-send-student-lms-comment', 330, 50);
        cy.get('#input-student-lms-content').should('contain.value', 'Simpulan saya');
        cy.screenshot(`lms-discussion-student-keyboard-${dark ? 'dark' : 'light'}`, { capture: 'viewport' });
        cy.get('#btn-send-student-lms-comment').click();
        cy.get('#student-lms-comments-list').should('contain', 'Simpulan saya: pengelompokan berkembang berdasarkan bukti baru.');
        cy.get('#input-student-lms-content').should('have.value', '');
        cy.get('#btn-send-student-lms-comment').should('be.enabled');
        keyboard(850);
        cy.get('#modal-student-lms-discussion button[title="Tutup"]').click();
        cy.get('#demo-teacher-discussion').click();
        cy.get('#lms-discussion-comments-list').should('contain', 'Simpulan saya');
        composerWithinScreen('#modal-lms-discussion', '#input-lms-discussion-content', '#btn-send-lms-comment', 850);
    });
    it('teacher can send feedback and student can read it after a long prompt', () => {
        cy.viewport(360, 640);
        cy.get('#demo-teacher-discussion').click();
        cy.get('#lms-discussion-prompt-container').should('contain', 'AKHIR PEMANTIK');
        composerWithinScreen('#modal-lms-discussion', '#input-lms-discussion-content', '#btn-send-lms-comment', 640);
        cy.get('#modal-lms-discussion .lms-discussion-body').scrollTo('bottom');
        keyboard(300, 20);
        composerWithinScreen('#modal-lms-discussion', '#input-lms-discussion-content', '#btn-send-lms-comment', 300, 20);
        cy.get('#input-lms-discussion-content').type('Arahan guru: sertakan contoh unsur pada simpulan.');
        cy.get('#btn-send-lms-comment').click();
        cy.get('#lms-discussion-comments-list').should('contain', 'Arahan guru: sertakan contoh unsur pada simpulan.');
        cy.screenshot('lms-discussion-teacher-keyboard', { capture: 'viewport' });
        keyboard(640);
        cy.get('#modal-lms-discussion button[aria-label="Tutup ruang diskusi"]').click();
        cy.get('#demo-student-discussion').click();
        cy.get('#student-lms-comments-list').should('contain', 'Arahan guru: sertakan contoh unsur pada simpulan.');
    });
    it('keeps typing accessible on a short landscape screen', () => {
        cy.viewport(844, 350);
        cy.get('#demo-student-discussion').click();
        cy.get('#student-lms-prompt-container').should('contain', 'AKHIR PEMANTIK');
        composerWithinScreen('#modal-student-lms-discussion', '#input-student-lms-content', '#btn-send-student-lms-comment', 350);
        cy.get('#modal-student-lms-discussion .lms-discussion-body').scrollTo('bottom');
        cy.get('#input-student-lms-content').type('Jawaban dari layar mendatar.').should('have.value', 'Jawaban dari layar mendatar.');
        cy.screenshot('lms-discussion-landscape', { capture: 'viewport' });
    });
});
