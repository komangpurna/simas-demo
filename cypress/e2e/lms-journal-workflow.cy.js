const node = name => `[data-journal-node="${name}"]`;
const field = name => `[data-journal-field="${name}"]`;
function openHistoricalJournal() {
    cy.intercept('GET','**/api/lms/journal/context*').as('context');
    cy.get('[data-lms-journal-material]').click(); cy.wait('@context');
    cy.get(field('tanggal')).should('have.value','2026-01-15').and('have.attr','type','hidden');
    cy.get(field('jp')).should('have.value','2,3,4');
    cy.get(node('preview-content')).should('contain','Hadir 1/2');
    cy.get('#lms-journal-title').should('have.text','Sinkron Jurnal Mengajar');
    cy.get(node('teacher')).should('have.value','Guru Resmi').and('have.attr','readonly');
    cy.get(node('class')).should('have.value','X-1'); cy.get(node('subject')).should('have.value','IPA');
    cy.get('[data-journal-jp="2"]').should('have.text','2');
    cy.get(node('settings')).should('not.be.visible');
    cy.get(node('evidence-preview')).should('be.visible');
    cy.get(node('evidence-image')).should($image=>expect($image[0].naturalWidth).to.be.greaterThan(0));
}
function signJournal() {
    cy.get(node('save')).click(); cy.get(node('sign')).should('be.visible');
    cy.get(node('commit')).click(); cy.get(node('sign-message')).should('contain','Centang');
    cy.get(node('confirmed')).check();
    cy.get(node('sign-message')).should('not.be.visible');
    drawJournalSignature();
}
function drawJournalSignature() {
    cy.get(node('canvas')).then($canvas => {
        const rect=$canvas[0].getBoundingClientRect();
        cy.wrap($canvas).trigger('pointerdown',{pointerId:1,pointerType:'pen',clientX:rect.left+25,clientY:rect.top+25,eventConstructor:'PointerEvent'});
        cy.wrap($canvas).trigger('pointermove',{pointerId:1,pointerType:'pen',clientX:rect.left+90,clientY:rect.top+70,eventConstructor:'PointerEvent'});
        cy.wrap($canvas).trigger('pointermove',{pointerId:1,pointerType:'pen',clientX:rect.left+140,clientY:rect.top+35,eventConstructor:'PointerEvent'});
        cy.wrap($canvas).trigger('pointerup',{pointerId:1,pointerType:'pen',eventConstructor:'PointerEvent'});
    });
}
describe('Jurnal LMS → pertemuan → presensi → popup TTD → realisasi e-Kinerja',()=>{
    beforeEach(()=>{cy.request('POST','/__test__/journal/reset');cy.viewport(390,844);cy.clock(Date.UTC(2026,0,15,4),['Date']);cy.visit('/cypress/fixtures/lms-journal-workflow.html');});
    it('refreshes attendance in a saved journal and persists it only after a new signature',()=>{
        cy.intercept('POST','**/api/lms/journal/save').as('saveRefreshedJournal');
        openHistoricalJournal();signJournal();cy.get(node('commit')).click();cy.get(node('success-card')).should('be.visible');
        cy.wait('@saveRefreshedJournal').its('response.body.id').then(id=>{
            cy.get(node('done')).click();cy.window().then(win=>win.openLmsJournalEntry(id));
        });
        cy.get(node('preview-content')).should('contain','Hadir 1/2');
        cy.request('POST','/__test__/journal/progress');
        cy.get(node('preview')).click();cy.get(node('preview-content')).should('contain','Hadir 2/2');
        cy.get('[data-student-nis="200"] select').should('have.value','H');
        cy.request('/__test__/journal/counts').its('body.evidence').should('eq',1);
        cy.get('.lms-journal-dialog').scrollTo('bottom');cy.screenshot('phone-saved-attendance-refreshed');
        signJournal();cy.get(node('commit')).click();cy.get(node('success-card')).should('contain','Revisi 2');
        cy.request('/__test__/journal/counts').its('body').should('include',{journals:1,logs:1,evidence:2});
    });
    it('renders on a phone, previews without writes and signs with aggregate evidence',()=>{
        openHistoricalJournal();
        cy.get('.lms-journal-dialog').then($dialog=>expect($dialog[0].scrollWidth).to.be.at.most($dialog[0].clientWidth+1));
        cy.request('/__test__/journal/counts').its('body').should('include',{journals:0,logs:0});
        cy.screenshot('phone-journal-preview'); signJournal(); cy.screenshot('phone-journal-signature');
        cy.get(node('commit')).click(); cy.get(node('success-workload')).should('contain','e-Kinerja tersinkron');
        cy.get(node('success-card')).should('be.visible').and('contain','Guru Resmi');
        cy.get(node('saved-evidence')).click();
        cy.get('[data-evidence-fit]').click();
        cy.get('.lms-journal-evidence-dialog img').should('be.visible').and($image=>expect($image[0].naturalWidth).to.be.greaterThan(0));
        cy.get('[data-evidence-close]').click();
        cy.request('/__test__/journal/counts').its('body').should('include',{journals:1,logs:1,evidence:1}); cy.screenshot('phone-journal-saved');
    });
    it('shows the familiar prefilled form and requires a reason when correcting automatic attendance',()=>{
        openHistoricalJournal();
        cy.get('.lms-journal-dialog').scrollTo('top'); cy.screenshot('phone-prefilled-journal-form');
        cy.get('[data-student-nis="200"] [data-attendance-status]').select('I');
        cy.get('[data-student-nis="200"] .lms-journal-correction').should('be.visible');
        cy.get(node('save')).should('be.enabled').click();
        cy.get(node('save-hint')).should('be.visible').and('contain','alasan');
        cy.get('[data-student-nis="200"] [data-attendance-reason]').type('Izin keluarga');
        cy.get(node('save')).click(); cy.get(node('sign')).should('be.visible');
        cy.get(node('sign-summary')).should('contain','Izin: 1'); cy.get(node('back')).click();
        cy.get('[data-student-nis="200"] [data-attendance-status]').should('have.value','I');
        cy.get('[data-student-nis="200"] [data-attendance-reason]').should('have.value','Izin keluarga');
        cy.get(node('save')).should('be.enabled');
        cy.viewport(1366,1000); cy.get('.lms-journal-dialog').scrollTo('bottom'); cy.screenshot('desktop-journal-validation');
        cy.request('/__test__/journal/counts').its('body').should('include',{journals:0,logs:0});
    });
    it('recovers a lost response without creating duplicate journals or realizations',()=>{
        openHistoricalJournal(); signJournal(); cy.window().then(win=>{win.dropNextJournalSaveResponse=true;});
        cy.get(node('commit')).click(); cy.get(node('message')).should('contain','Koneksi terputus');
        cy.get(node('commit')).click(); cy.get(node('result')).should('contain','Jurnal berhasil disimpan');
        cy.request('/__test__/journal/counts').its('body').should('include',{journals:1,logs:1,evidence:1});
    });
    it('keeps the meeting form and attendance readable on a dark desktop',()=>{
        cy.viewport(1366,900); cy.document().then(doc=>doc.documentElement.classList.add('dark'));
        openHistoricalJournal(); cy.get('.lms-journal-dialog').then($dialog=>{$dialog[0].scrollTop=0;expect($dialog[0].scrollWidth).to.be.at.most($dialog[0].clientWidth+1);});
        cy.get(field('tanggal')).should('not.be.visible'); cy.get(node('evidence-image')).should('be.visible'); cy.screenshot('desktop-dark-journal-form');
    });
    it('later student progress does not change signed evidence until a new confirmation and signature',()=>{
        openHistoricalJournal(); signJournal(); cy.get(node('commit')).click(); cy.get(node('result')).should('contain','Jurnal berhasil');
        cy.get('.lms-journal-evidence').invoke('attr','src').then(oldEvidence=>{
            cy.request('POST','/__test__/journal/progress'); cy.request(oldEvidence).its('body').should('contain','Hadir: 1/2');
            cy.get(node('success-close')).click();
            cy.get('[data-lms-journal-material]').click(); cy.wait('@context');
            cy.get(node('existing')).should('contain','revisi 1');
            cy.get(node('preview-content')).should('contain','Hadir 2/2'); signJournal(); cy.get(node('commit')).click();
            cy.get(node('result')).should('contain','Revisi 2'); cy.request(oldEvidence).its('body').should('contain','Hadir: 1/2');
            cy.request('/__test__/journal/counts').its('body').should('include',{journals:1,logs:1,evidence:2});
        });
    });
    it('edits saved attendance after all source materials are deleted',()=>{
        cy.intercept('POST','**/api/lms/journal/save').as('saveJournal');
        openHistoricalJournal(); signJournal(); cy.get(node('commit')).click();
        cy.wait('@saveJournal').its('response.body.id').then(id=>{
            cy.get(node('done')).click();
            cy.request('POST','/__test__/journal/remove-materials');
            cy.window().then(win=>win.openLmsJournalEntry(id));
        });
        cy.get('#lms-journal-title').should('contain','Edit Kehadiran Jurnal');
        cy.get(node('preview-content')).should('contain','Hadir 1/2').and('contain','15 mnt 15 dtk');
        cy.get(field('topik')).should('have.prop','readOnly',true);
        cy.get('[data-student-nis="200"] [data-attendance-status]').select('I');
        cy.get('[data-student-nis="200"] [data-attendance-reason]').type('Izin keluarga');
        cy.get('.lms-journal-dialog').scrollTo('bottom'); cy.screenshot('phone-edit-saved-attendance-without-material');
        cy.get(node('save')).should('contain','Simpan Kehadiran').click();
        cy.get(node('sign-summary')).should('contain','Izin: 1');
        cy.get(node('confirmed')).check();
        drawJournalSignature();
        cy.get(node('commit')).click();
        cy.get(node('result')).should('contain','Revisi 2').and('contain','Presensi diperbarui');
        cy.request('/__test__/journal/counts').its('body').should('include',{journals:1,logs:1,evidence:2});
    });
    it('includes all 36 students and readable durations in the enlarged evidence',()=>{
        cy.request('POST','/__test__/journal/classroom');
        cy.get('[data-lms-journal-material]').click();
        cy.get(node('preview-content')).should('contain','Hadir 18/36');
        cy.get(node('evidence-image')).invoke('attr','src').then(src=>{
            const svg=decodeURIComponent(src.slice(src.indexOf(',')+1));
            expect(svg.match(/data-evidence-student-row=/g)).to.have.length(36);
            expect(svg).to.contain('Wayan Surya Aditya Pramana'); expect(svg).to.contain('1 jam 30 mnt');
            cy.writeFile('scratch/lms-journal-evidence-36.svg',svg);
        });
        cy.get(node('evidence-open')).click();
        cy.get('.lms-journal-evidence-dialog').should('be.visible');
        cy.get('.lms-journal-evidence-viewport img').should($img=>expect($img[0].naturalHeight).to.be.greaterThan(3000));
        cy.get('.lms-journal-evidence-viewport').then($view=>expect($view[0].scrollWidth).to.be.greaterThan($view[0].clientWidth));
        cy.get('[data-evidence-close]').should('be.visible'); cy.screenshot('phone-full-class-evidence');
        cy.viewport(1180,800); cy.get('[data-evidence-fit]').click(); cy.screenshot('desktop-full-class-evidence');
        cy.get('[data-evidence-close]').click(); cy.get('.lms-journal-dialog').should('be.visible');
        cy.request('/__test__/journal/counts').its('body').should('include',{journals:0,logs:0,evidence:0});
    });
    it('shows an official teacher photo and an attractive, readable success card on phone and dark desktop',()=>{
        cy.intercept('GET','**/api/jurnal/master',{body:{success:true,data:{motivasi:['Setiap ilmu yang Anda bagikan hari ini menjadi bekal masa depan siswa.']}}});
        cy.intercept('GET','**/api/photos/gtk/gtk-guru.webp',{fixture:'lms-journal-teacher-avatar.svg',headers:{'Content-Type':'image/svg+xml'}});
        openHistoricalJournal(); signJournal(); cy.get(node('commit')).click();
        cy.get(node('success-card')).should('be.visible').and('contain','SMAGESA').and('contain','Guru Resmi');
        cy.get(node('success-photo')).should('be.visible').and($image=>expect($image[0].naturalWidth).to.be.greaterThan(0));
        cy.get(node('success-workload')).should('have.class','is-synced');
        cy.get('.lms-journal-success-source').should('be.visible').and('contain','Tersinkron otomatis dari LMS SIMAS-SHAKTI');
        cy.get(node('success-motivation')).should('be.visible').and('contain','Setiap ilmu yang Anda bagikan');
        cy.get('.lms-journal-head').should('not.be.visible');
        cy.get('#lms-journal-success-title').should('have.css','outline-style','none');
        cy.get('.lms-journal-dialog').then($dialog=>expect($dialog[0].scrollWidth).to.be.at.most($dialog[0].clientWidth+1));
        cy.get(node('success-card')).screenshot('phone-success-card-with-photo');
        cy.viewport(1180,900); cy.document().then(doc=>doc.documentElement.classList.add('dark'));
        cy.get(node('success-card')).screenshot('desktop-dark-success-card-with-photo');
        cy.get(node('done')).click(); cy.get('.lms-journal-dialog').should('not.be.visible');
    });
});
