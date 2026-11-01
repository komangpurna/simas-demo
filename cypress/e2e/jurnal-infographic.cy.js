describe('Infografis jurnal bulanan', () => {
    function openReport(count = 16, fetchError = false, longNames = false) {
        cy.visit('/cypress/fixtures/infographic-preview.html');
        cy.clock(Date.UTC(2026, 8, 20), ['Date']);
        cy.window().then(async win => {
            const mod = await win.Function('return import("/js/jurnal-infographic.mjs")')();
            const period = mod.currentReportPeriod();
            const options = { kelas: 'XI A1', mapel: 'Matematika', teacherName: 'I Komang Guru, S.Pd.', teacherNip: '19800101 200501 1 001', teacherUid: 'guru-test', school: { schoolName: 'SMA Negeri 1 Abang', schoolShortName: 'SMAGESA', schoolCity: 'Abang', logoPath: 'assets/logo-sekolah.png' }, fetchData: async () => {
                if (fetchError) throw new Error('Koneksi terputus');
                return { students: Array.from({ length: 40 }, (_, i) => ({ nis: String(1000 + i), name: longNames ? `${i % 2 ? 'I Gusti Ngurah Aditya Pratama Wijaya' : 'Ni Kadek Dwi Putri Wulandari'} ${i + 1}` : `I ${i % 2 ? 'Made' : 'Putu'} Siswa ${String(i + 1).padStart(2, '0')}`, class: 'XI A1' })), journals: Array.from({ length: count }, (_, i) => ({ id: `j${i}`, tanggal: `${period.month}-${String(Math.floor(i / 5) + 1).padStart(2, '0')}`, kelas: 'XI A1', mapel: 'Matematika', uid_guru: 'journal-master-test', guru: 'I Komang Guru,S.Pd.', jp: [(i % 5) * 2 + 1, (i % 5) * 2 + 2], topik: ['Eksplorasi fungsi kuadrat dan penerapannya dalam kehidupan sehari-hari', 'Diskusi kelompok: persamaan dan pertidaksamaan', 'Refleksi pembelajaran dan asesmen formatif'][i % 3], foto_url: i % 3 ? '/assets/logo-sekolah.png' : '/missing-journal-photo.jpg', presensi_detail: [{ nis: '1000', nama: 'I Putu Siswa 01', status: 'S' }] })) };
            } };
            await mod.openInfographicDialog(options);
        });
    }
    function sign() {
        cy.get('#ji-signature').scrollIntoView().then($canvas => {
            const rect = $canvas[0].getBoundingClientRect();
            cy.wrap($canvas).trigger('pointerdown', { pointerId: 1, button: 0, clientX: rect.left + 25, clientY: rect.top + 30 })
                .trigger('pointermove', { pointerId: 1, clientX: rect.left + 110, clientY: rect.top + 60 })
                .trigger('pointerup', { pointerId: 1 });
        });
    }
    it('merender 10 jurnal pilihan dan kehadiran seluruh 16 pertemuan untuk 40 siswa', () => {
        openReport();
        cy.get('[data-action="preview"]').should('be.disabled');
        // Pointer capture requires native active pointers; keep this fixture deterministic.
        cy.get('#ji-signature').then($canvas => { $canvas[0].setPointerCapture = () => {}; $canvas[0].hasPointerCapture = () => true; });
        sign();
        cy.get('[data-action="preview"]').should('not.be.disabled').click();
        cy.get('[data-action="print"]', { timeout: 20000 }).should($button => {
            const doc = $button[0].ownerDocument;
            const frameDoc = doc.querySelector('iframe').contentDocument;
            const sizes = [...frameDoc.querySelectorAll('.fit-area')].map(area => [area.clientHeight, area.firstElementChild.scrollHeight, area.firstElementChild.style.transform]);
            expect($button[0].disabled, doc.querySelector('.ji-message').textContent + JSON.stringify(sizes)).to.equal(false);
        });
        cy.get('iframe').then($frame => {
            const doc = $frame[0].contentDocument;
            const win = $frame[0].contentWindow;
            expect(doc.querySelectorAll('.sheet')).to.have.length(2);
            expect(doc.querySelectorAll('.lesson')).to.have.length(10);
            expect(doc.querySelectorAll('tbody tr')).to.have.length(40);
            expect(parseFloat(win.getComputedStyle(doc.querySelector('td.col-name')).fontSize)).to.be.at.least(11.5);
            expect(parseFloat(win.getComputedStyle(doc.querySelector('.lesson-topic-row h3')).fontSize)).to.be.at.least(12);
            expect(doc.querySelector('[data-page="2"] .fit-content').style.transform).to.equal('scale(1)');
            expect(doc.body.textContent).to.contain('Foto tidak dapat dimuat');
            doc.querySelectorAll('.sheet').forEach(sheet => expect(sheet.scrollHeight).to.be.at.most(sheet.clientHeight + 2));
            doc.querySelectorAll('.fit-area').forEach(area => expect(area.firstElementChild.getBoundingClientRect().height).to.be.at.most(area.clientHeight + 2));
            cy.stub($frame[0].contentWindow, 'print').as('printReport');
        });
        cy.get('[data-action="print"]').click();
        cy.get('@printReport').should('have.been.calledOnce');
        let previewBody, previewStyles;
        cy.get('iframe').then($frame => { previewBody = $frame[0].contentDocument.body.innerHTML; previewStyles = $frame[0].contentDocument.querySelector('link[rel="stylesheet"]').outerHTML; });
        cy.get('[data-action="back"]').click();
        cy.get('[data-action="clear"]').click();
        cy.get('[data-action="preview"]').should('be.disabled');
        cy.get('[data-action="close"]').click();
        cy.get('#ji-dialog').should('not.exist');
        cy.document().then(doc => { doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => link.remove()); doc.head.insertAdjacentHTML('beforeend', previewStyles); doc.body.className = 'ji-report'; doc.body.innerHTML = previewBody; });
        cy.viewport(1100, 660);
        cy.scrollTo('top');
        cy.screenshot('infographic-page-1-top', { capture: 'viewport' });
        cy.scrollTo(0, 500);
        cy.screenshot('infographic-page-1-bottom', { capture: 'viewport' });
        cy.get('.sheet').last().then($sheet => cy.scrollTo(0, $sheet[0].offsetTop));
        cy.screenshot('infographic-page-2-top', { capture: 'viewport' });
        cy.scrollTo('bottom');
        cy.screenshot('infographic-page-2-bottom', { capture: 'viewport' });
    });
    it('menampilkan keadaan kosong dan kegagalan tanpa laporan palsu', () => {
        openReport(0);
        cy.get('.ji-message').should('contain', 'Belum ada jurnal Anda');
        cy.get('.ji-sign-form').should('not.be.visible');
        cy.get('[data-action="close"]').click();
        openReport(0, true);
        cy.get('.ji-message').should('contain', 'Koneksi terputus');
        cy.get('.ji-preview').should('not.be.visible');
    });
    it('form tanda tangan dapat digunakan pada layar ponsel', () => {
        cy.viewport(390, 844);
        openReport(4);
        cy.get('#ji-signature').scrollIntoView().should('be.visible').then($canvas => expect($canvas[0].getBoundingClientRect().right).to.be.at.most(390));
        cy.get('[data-action="close"]').click();
    });
    it('foto pengganti hanya muncul pada laporan dan dapat dipulihkan', () => {
        openReport(4);
        cy.get('[data-photo-index="0"]').selectFile('assets/logo-sekolah.png', { force: true });
        cy.get('[data-photo-card="0"] .ji-photo-state').should('contain', 'Foto khusus laporan');
        cy.get('[data-photo-card="0"] img').should('have.attr', 'src').and('match', /^data:image\/jpeg;base64,/);
        cy.get('#ji-signature').then($canvas => { $canvas[0].setPointerCapture = () => {}; $canvas[0].hasPointerCapture = () => true; });
        sign();
        cy.get('[data-action="preview"]').click();
        cy.get('[data-action="print"]', { timeout: 20000 }).should('not.be.disabled');
        cy.get('iframe').then($frame => expect($frame[0].contentDocument.querySelector('.lesson-photo img').src).to.match(/^data:image\/jpeg;base64,/));
        cy.get('[data-action="back"]').click();
        cy.get('[data-photo-card="0"] [data-action="restore-photo"]').click();
        cy.get('[data-photo-card="0"] .ji-photo-state').should('contain', 'Foto asli jurnal');
        cy.get('[data-photo-index="0"]').selectFile({ contents: Cypress.Buffer.from('foto rusak'), fileName: 'rusak.png', mimeType: 'image/png' }, { force: true });
        cy.get('.ji-message').should('contain', 'Foto tidak dapat dibaca');
        cy.get('[data-photo-card="0"] .ji-photo-state').should('contain', 'Foto asli jurnal');
    });
    it('membatasi pilihan maksimal 8 jurnal dan mengizinkan penggantian pilihan', () => {
        openReport(16);
        cy.get('[data-journal-select]:checked').should('have.length', 8);
        cy.get('[data-journal-select="0"]').check();
        cy.get('.ji-message').should('contain', 'Maksimal 8 jurnal');
        cy.get('[data-journal-select="0"]').should('not.be.checked');
        cy.get('[data-journal-select="8"]').uncheck();
        cy.get('[data-journal-select="0"]').check();
        cy.get('[data-journal-select]:checked').should('have.length', 8);
        cy.get('#ji-signature').then($canvas => { $canvas[0].setPointerCapture = () => {}; $canvas[0].hasPointerCapture = () => true; });
        sign();
        cy.get('[data-action="preview"]').click();
        cy.get('[data-action="print"]', { timeout: 20000 }).should('not.be.disabled');
        cy.get('iframe').then($frame => expect($frame[0].contentDocument.querySelectorAll('.lesson')).to.have.length(8));
    });
    it('editor lapang dengan satu area scroll dan tombol pratinjau tetap terlihat', () => {
        cy.viewport(1280, 850);
        openReport(8);
        cy.get('.ji-photo-list').then($list => {
            expect($list[0].scrollHeight).to.be.at.most($list[0].clientHeight + 1);
            expect($list[0].getBoundingClientRect().width).to.be.greaterThan(650);
        });
        cy.get('.ji-photo-thumb').first().then($photo => expect($photo[0].getBoundingClientRect().height).to.be.greaterThan(150));
        cy.get('.ji-dialog').screenshot('infographic-editor-desktop');
        cy.get('.ji-dialog-body').scrollTo('bottom');
        cy.get('[data-action="preview"]').then($button => {
            const rect = $button[0].getBoundingClientRect();
            expect(rect.bottom).to.be.at.most(850);
            expect(rect.top).to.be.greaterThan(0);
        });
        cy.viewport(390, 844);
        cy.get('.ji-dialog-body').scrollTo('top');
        cy.get('.ji-dialog').then($dialog => expect($dialog[0].scrollWidth).to.be.at.most($dialog[0].clientWidth + 1));
        cy.get('[data-action="signature"]').click();
        cy.get('#ji-signature').should('be.focused');
        cy.get('.ji-dialog').screenshot('infographic-editor-mobile');
    });
    it('menjaga keterbacaan dan batas A4 untuk jumlah foto yang dinamis', () => {
        openReport(10);
        cy.get('#ji-signature').then($canvas => { $canvas[0].setPointerCapture = () => {}; $canvas[0].hasPointerCapture = () => true; });
        sign();
        [1, 2, 4, 6, 7, 8, 9, 10].forEach(count => {
            cy.get('[data-journal-select]').uncheck({ force: true });
            cy.get('[data-journal-select]').each(($input, index) => { if (index < count) cy.wrap($input).check({ force: true }); });
            cy.get('[data-action="preview"]').click();
            cy.get('[data-action="print"]', { timeout: 20000 }).should($button => {
                const doc = $button[0].ownerDocument;
                const sizes = [...doc.querySelector('iframe').contentDocument.querySelectorAll('.fit-area')].map(area => [area.clientHeight, area.firstElementChild.scrollHeight, area.firstElementChild.scrollWidth]);
                expect($button[0].disabled, `${count} foto: ${doc.querySelector('.ji-message').textContent} ${JSON.stringify(sizes)}`).to.equal(false);
            });
            cy.get('iframe').then($frame => {
                const doc = $frame[0].contentDocument;
                expect(doc.querySelectorAll('.lesson')).to.have.length(count);
                doc.querySelectorAll('.lesson-topic-row h3').forEach(topic => expect(topic.scrollHeight).to.be.at.most(topic.clientHeight + 1));
            });
            cy.get('[data-action="back"]').click();
        });
    });
    it('nama panjang tetap terbaca untuk dua pertemuan dan pratinjau ponsel bisa diperbesar', () => {
        cy.viewport(390, 844);
        openReport(2, false, true);
        cy.get('#ji-signature').then($canvas => { $canvas[0].setPointerCapture = () => {}; $canvas[0].hasPointerCapture = () => true; });
        sign();
        cy.get('[data-action="preview"]').click();
        cy.get('[data-action="print"]', { timeout: 20000 }).should('not.be.disabled').then($button => expect($button[0].getBoundingClientRect().right).to.be.at.most(390));
        cy.get('iframe').then($frame => {
            const doc = $frame[0].contentDocument;
            expect(Number(doc.documentElement.style.getPropertyValue('--ji-preview-zoom'))).to.be.lessThan(1);
            expect(doc.querySelectorAll('td.col-name')).to.have.length(40);
            doc.querySelectorAll('td.col-rate').forEach(cell => expect(cell.scrollWidth).to.be.at.most(cell.clientWidth + 1));
        });
        cy.get('[data-action="zoom"]').click();
        cy.get('iframe').then($frame => expect($frame[0].contentDocument.documentElement.style.getPropertyValue('--ji-preview-zoom')).to.equal('1'));
        cy.get('[data-action="zoom"]').click();
        cy.get('iframe').then($frame => {
            const source = $frame[0].contentDocument;
            const page = source.querySelector('[data-page="2"]').outerHTML;
            const stylesheet = source.querySelector('link').outerHTML;
            cy.get('[data-action="close"]').click();
            cy.document().then(doc => {
                doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => link.remove());
                doc.head.insertAdjacentHTML('beforeend', stylesheet);
                doc.body.className = 'ji-report'; doc.body.innerHTML = page;
            });
        });
        cy.viewport(1100, 660);
        cy.scrollTo('top');
        cy.screenshot('infographic-long-names-top', { capture: 'viewport' });
        cy.scrollTo('bottom');
        cy.screenshot('infographic-long-names-bottom', { capture: 'viewport' });
    });
});
