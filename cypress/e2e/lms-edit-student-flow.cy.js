const suite = Cypress.env('lmsHtmlIntegration') ? describe : describe.skip;
suite('Edit modules and show the student learning path', () => {
    it('waits five active minutes before checking reading, preserves HTML, and unlocks discussion before the next module', () => {
        const now = Date.now();
        cy.viewport(390, 844);
        cy.request('POST', '/__test__/html/reset', { minimumReadingSeconds: 300 });
        cy.request('POST', '/__test__/html/clock', { now });
        const material = { id: 'mat', topic_id: 'topic', title: 'Belajar lima menit', class_name: 'X-1', subject_name: 'IPA', resource_type: 'html',
            content_description: '<h1>Materi interaktif</h1><label>Jawaban <input></label>', allow_discussion: 1, discussion_prompt: 'Apa hasil belajar?',
            publish_at: new Date(now - 3600000).toISOString(), due_date: new Date(now + 3600000).toISOString() };
        const api = (route, body, role = 'student') => cy.request({ method: 'POST', url: '/__test__/html/api', failOnStatusCode: false, body: { route: '/api/lms/' + route, method: 'POST', body, role } });
        api('materials', material, 'teacher').its('status').should('equal', 200);
        api('materials', { ...material, id: undefined, title: 'Materi berikutnya', order_index: 2 }, 'teacher').its('status').should('equal', 200);
        cy.visit('/cypress/fixtures/lms-html-workflow.html?edit-flow=1');
        cy.window().its('demoRefreshFlow').should('be.a', 'function');
        cy.clock(now, ['Date', 'setInterval', 'clearInterval']);
        cy.get('#demo-student').click();
        cy.get('#modal-student-resource').should('be.visible');
        cy.window().then(win => win.demoRefreshFlow());
        cy.get('#lms-mat-mat [data-lms-step="material"]').should('have.attr', 'data-step-state', 'available');
        cy.get('#lms-mat-mat [data-lms-step="discussion"]').should('have.attr', 'data-step-state', 'locked');
        cy.request('POST', '/__test__/html/clock', { now: now + 299000 });
        cy.tick(299000);
        api('discussions', { material_id: 'mat', content: 'Belum cukup waktu' }).its('status').should('equal', 409);
        cy.request('POST', '/__test__/html/clock', { now: now + 300000 });
        cy.tick(1000);
        cy.get('.lms-reading-live-clock').should('contain', 'terpenuhi');
        cy.window().then(win => win.demoRefreshFlow());
        cy.get('#lms-mat-mat [data-lms-step="material"]').should('have.attr', 'data-step-state', 'completed');
        cy.get('#lms-mat-mat [data-lms-step="discussion"]').should('have.attr', 'data-step-state', 'available');
        cy.get('#student-resource-frame').should($frame => expect($frame[0].srcdoc).to.contain('Materi interaktif'));
        cy.get('#modal-student-resource').should('be.visible');
        cy.screenshot('lms-reading-five-minutes-mobile', { capture: 'viewport' });
        cy.window().then(win => win.closeStudentResourceModal());
        api('discussions', { material_id: 'mat', content: 'Saya memahami materinya.' }).its('status').should('equal', 200);
        cy.window().then(win => win.demoRefreshFlow());
        cy.get('[data-topic-material]').eq(1).should('have.attr', 'data-module-state', 'available');
    });
    it('saves an edited material plus two new modules and checks each prerequisite on mobile', () => {
        cy.viewport(390, 844);
        cy.request('POST', '/__test__/html/reset', {});
        cy.visit('/cypress/fixtures/lms-html-workflow.html?edit-flow=1');
        cy.window().its('demoRefreshFlow').should('be.a', 'function');
        cy.get('#input-lms-material-title').type('Materi awal');
        cy.get('#select-lms-resource-type').select('text');
        cy.get('#input-lms-material-content').type('Pelajari bahan ini.');
        cy.get('#select-lms-material-discussion').select('1');
        cy.get('#input-lms-material-discussion-prompt').type('Apa yang kamu pelajari?');
        for (const title of ['Materi kedua', 'Materi ketiga']) {
            cy.window().then(win => win.addLmsMaterialFormCard());
            cy.get('#container-lms-materials-list .lms-material-card').last().within(() => {
                cy.get('.lms-field-title').type(title);
                cy.get('.lms-field-resource-type').select('text');
                cy.get('.lms-field-content').type('Materi berikutnya.');
            });
        }
        cy.get('#btn-submit-lms-material').click();
        cy.get('#demo-notice').should('contain', '3 materi pembelajaran berhasil disimpan');
        cy.window().then(win => win.demoRefreshFlow());
        cy.get('[data-topic-material]').should('have.length', 3);
        cy.get('[data-module-state="locked"]').should('have.length', 2);
        const api = (route, body) => cy.request('POST', '/__test__/html/api', { route: '/api/lms/' + route, method: 'POST', body });
        api('student/track', { material_id: 'mat', action: 'open' });
        cy.window().then(win => win.demoRefreshFlow());
        cy.get('#lms-mat-mat [data-lms-step="material"]').should('have.attr', 'data-step-state', 'completed');
        cy.get('#lms-mat-mat [data-lms-step="discussion"]').should('have.attr', 'data-step-state', 'available');
        cy.get('#lms-mat-mat').should('contain', 'Buka Materi').and('not.contain', 'Buka Lagi');
        api('discussions', { material_id: 'mat', content: 'Saya memahami materinya.' });
        cy.window().then(win => win.demoRefreshFlow());
        cy.get('#lms-mat-mat [data-lms-step="discussion"]').should('have.attr', 'data-step-state', 'completed');
        cy.get('[data-topic-material]').eq(1).should('have.attr', 'data-module-state', 'available');
        cy.get('[data-topic-material]').eq(2).should('have.attr', 'data-module-state', 'locked');
        cy.get('#student-lms-list-container').scrollIntoView();
        cy.screenshot('lms-sequential-module-checkmarks-mobile', { capture: 'fullPage' });
        cy.viewport(1280, 900);
        cy.get('#student-lms-list-container').then($el => expect($el[0].scrollWidth).to.be.at.most($el[0].clientWidth + 1));
    });
});
