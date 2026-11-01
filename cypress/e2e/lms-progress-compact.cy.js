const suite = Cypress.env('lmsHtmlIntegration') ? describe : describe.skip;
suite('Compact LMS progress monitor', () => {
    beforeEach(() => { cy.visit('/cypress/fixtures/lms-progress-compact.html'); cy.window().its('demoReady').should('equal', true); });
    it('shows at least seven complete student rows at the supplied desktop screenshot size and keeps search/actions accessible', () => {
        cy.viewport(1045, 648);
        cy.get('#tbody-lms-progress-students tr').should('have.length', 35);
        cy.get('#lms-prog-total-count').should('have.text', '35');
        cy.get('.lms-progress-header button[onclick="window.openLmsJournalForProgress()"]').should('be.visible');
        cy.get('.lms-progress-table').then($el => {
            const rect = $el[0].getBoundingClientRect();
            expect(rect.height).to.be.at.least(350);
            const headerBottom = $el[0].querySelector('thead').getBoundingClientRect().bottom;
            const visible = [...$el[0].querySelectorAll('tbody tr')].filter(row => {
                const r = row.getBoundingClientRect(); return r.top >= headerBottom && r.bottom <= rect.bottom;
            });
            expect(visible.length).to.be.at.least(7);
        });
        cy.get('.lms-progress-header').then($el => expect($el[0].getBoundingClientRect().height).to.be.at.most(64));
        cy.screenshot('lms-progress-compact-desktop', { capture: 'viewport' });
        cy.get('#input-search-lms-progress').type('Siswa Uji 35');
        cy.get('#tbody-lms-progress-students tr').should('have.length', 1).and('contain', 'Siswa Uji 35');
        cy.get('#input-search-lms-progress').clear().type('1201');
        cy.get('#tbody-lms-progress-students tr').should('have.length', 1).and('contain', 'Siswa Uji 02');
        cy.get('#input-search-lms-progress').clear();
        cy.get('.lms-progress-table').scrollTo('bottom', { duration: 0 });
        cy.get('.lms-progress-table thead').should('be.visible');
        cy.get('.lms-progress-footer button').should('be.visible').click();
        cy.get('#modal-lms-progress').should('not.be.visible');
    });
    it('keeps mobile controls visible and confines horizontal scrolling to the table', () => {
        cy.viewport(390, 844);
        cy.get('.lms-progress-table thead th').eq(0).should('not.be.visible');cy.get('.lms-progress-table thead th').eq(1).should('not.be.visible');
        cy.get('#tbody-lms-progress-students tr').first().within(()=>{cy.get('td').eq(0).should('not.be.visible');cy.get('td').eq(1).should('not.be.visible');cy.get('td').eq(2).find('div>div').should('not.be.visible');});
        cy.get('#tbody-lms-progress-students tr').each(row=>expect(row[0].getBoundingClientRect().height).to.be.at.most(58));
        let nameLeft;cy.get('#tbody-lms-progress-students tr:first td').eq(2).then(el=>{nameLeft=el[0].getBoundingClientRect().left;});
        cy.get('.lms-progress-dialog').then($el => expect($el[0].scrollWidth).to.be.at.most($el[0].clientWidth + 1));
        cy.get('.lms-progress-header button[onclick="window.openLmsJournalForProgress()"]').should('be.visible');
        cy.get('#input-search-lms-progress').should('be.visible').type('1234');
        cy.get('#tbody-lms-progress-students tr').should('have.length', 1).and('contain', 'Siswa Uji 35');
        cy.get('#input-search-lms-progress').clear();
        cy.screenshot('lms-progress-compact-mobile-names',{capture:'viewport'});
        cy.get('.lms-progress-table').scrollTo('right', { duration: 0 });
        cy.get('#tbody-lms-progress-students tr:first td').eq(2).should(el=>expect(el[0].getBoundingClientRect().left).to.be.closeTo(nameLeft,1));
        cy.get('.lms-progress-table th').last().should('be.visible');
        cy.get('.lms-progress-footer button').should('be.visible');
        cy.screenshot('lms-progress-compact-mobile', { capture: 'viewport' });
    });
    it('hides mobile identity columns in both matrix scopes, keeps names pinned and preserves NIS search/actions',()=>{
        cy.viewport(360,780);cy.window().then(win=>win.showAnalytics('global'));
        const checkIdentity=()=>{cy.get('#tr-lms-analytics-headers th').eq(0).should('not.be.visible');cy.get('#tr-lms-analytics-headers th').eq(1).should('not.be.visible');cy.get('#tbody-lms-analytics tr:first td').eq(2).should('be.visible');};
        checkIdentity();cy.get('#input-search-lms-analytics').type('1201');cy.get('#tbody-lms-analytics tr').should('have.length',1).and('contain','Siswa Uji 02');cy.get('#input-search-lms-analytics').clear();
        cy.screenshot('lms-matrix-compact-mobile-global',{capture:'viewport'});
        cy.get('#analytics-material').click();checkIdentity();
        let nameLeft;cy.get('#tbody-lms-analytics tr:first td').eq(2).then(el=>{nameLeft=el[0].getBoundingClientRect().left;});
        cy.get('.lms-analytics-table').scrollTo('right');cy.get('#tbody-lms-analytics tr:first td').eq(2).should(el=>expect(el[0].getBoundingClientRect().left).to.be.closeTo(nameLeft,1));
        cy.get('#input-search-lms-analytics').type('1201');cy.get('#tbody-lms-analytics button').click();cy.window().its('lastOverride').should('deep.equal',{nis:'1201',action:'reset',id:'mat'});
        cy.get('#input-search-lms-analytics').clear().type('Tidak ditemukan');cy.get('#tbody-lms-analytics [colspan]').should('be.visible');cy.get('#input-search-lms-analytics').clear();
        cy.document().then(doc=>doc.documentElement.classList.add('dark'));cy.screenshot('lms-matrix-compact-mobile-material-dark',{capture:'viewport'});
        cy.viewport(1045,648);cy.get('#tr-lms-analytics-headers th').eq(0).should('be.visible');cy.get('#tr-lms-analytics-headers th').eq(1).should('be.visible');
    });
    it('shows actual catch-up progress as completed and late, and retains the marker after reactivation', () => {
        cy.viewport(390, 844);
        cy.request('POST', '/__test__/html/reset', {});
        const now = Date.now();
        const material = { id: 'mat', topic_id: 'topic', class_name: 'X-1', subject_name: 'IPA', title: 'Materi lewat target', resource_type: 'html',
            content_description: '<h1>Latihan</h1><input aria-label="Jawaban">', html_instructions: 'Selesaikan latihan', allow_discussion: 1,
            discussion_prompt: 'Jelaskan hasilnya', publish_at: new Date(now - 7200000).toISOString(), due_date: new Date(now - 3600000).toISOString() };
        const api = (route, body, role = 'student') => cy.request('POST', '/__test__/html/api', { route: '/api/lms/' + route, method: 'POST', body, role });
        api('materials', material, 'teacher').its('status').should('equal', 200);
        api('student/track', { material_id: 'mat', action: 'open' }).its('status').should('equal', 200);
        api('discussions', { material_id: 'mat', content: 'Saya sudah memahami materinya.' }).its('status').should('equal', 200);
        cy.visit('/cypress/fixtures/lms-progress-compact.html?live=1');
        cy.window().its('demoReady').should('equal', true);
        cy.get('#lms-progress-late-count').should('be.visible').and('have.text', 'Terlambat: 1');
        cy.get('#tbody-lms-progress-students tr').filter(':contains("Siswa Satu")').should('contain', 'Selesai').and('contain', 'Terlambat');
        cy.get('.lms-progress-footer button').should('be.visible');
        cy.screenshot('lms-late-completed-mobile', { capture: 'viewport' });
        api('materials', { ...material, is_teaching_completed: 0, due_date: new Date(now + 3600000).toISOString() }, 'teacher').its('status').should('equal', 200);
        cy.reload(); cy.window().its('demoReady').should('equal', true);
        cy.get('#lms-progress-late-count').should('have.text', 'Terlambat: 1');
        cy.get('#tbody-lms-progress-students tr').filter(':contains("Siswa Satu")').should('contain', 'Selesai').and('contain', 'Terlambat');
    });
});
