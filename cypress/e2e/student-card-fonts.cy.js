describe('Ekspor kartu dengan font halaman asli', () => {
    it('menanam Inter dan Font Awesome, menjaga stylesheet, serta mencetak PNG yang sama', () => {
        cy.exec('node node_modules/tailwindcss/lib/cli.js --content js/student-card-renderer.js --output scratch/student-card-test.css');
        cy.visit('/cypress/fixtures/student-card-preview.html', { timeout: 90000 });
        cy.window().its('cardRenderer').should('exist');
        cy.window().then({ timeout: 90000 }, async win => {
            await win.document.fonts.ready;
            expect(win.document.fonts.check('700 12px Inter')).to.equal(true);
            expect(win.document.fonts.check('900 12px "Font Awesome 6 Free"')).to.equal(true);
            const nativeSheets = () => Array.from(win.document.styleSheets).map(sheet => {
                try { return Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n'); }
                catch { return sheet.href; }
            });
            const before = nativeSheets();
            const front = await win.cardRenderer.generateKtsFrontCanvas(win.testStudent);
            const originalExport = win.htmlToImage.toCanvas;
            let embedded = '';
            win.htmlToImage.toCanvas = (face, options) => {
                embedded = options.fontEmbedCSS;
                return originalExport(face, options);
            };
            const back = await win.cardRenderer.generateKtsBackCanvas(win.testStudent);
            win.htmlToImage.toCanvas = originalExport;
            expect(embedded.includes('Inter'), 'Inter embedded').to.equal(true);
            expect(embedded.includes('Font Awesome 6 Free'), 'icons embedded').to.equal(true);
            expect(embedded.includes('data:'), 'font data embedded').to.equal(true);
            expect(/url\(["']?https?:/.test(embedded), 'no external font URLs').to.equal(false);
            expect(JSON.stringify(nativeSheets()) === JSON.stringify(before), 'live styles unchanged').to.equal(true);
            const printed = win.document.createElement('div');
            win.document.body.appendChild(printed);
            await win.cardRenderer.prepareKtsPrintCards([win.testStudent], 'both', printed);
            const printImages = printed.querySelectorAll('img');
            expect(printImages[0].src === front.toDataURL(), 'front print/download pixels').to.equal(true);
            expect(printImages[1].src === back.toDataURL(), 'back print/download pixels').to.equal(true);
            printed.remove();
            for (const canvas of [front, back]) {
                canvas.style.cssText = 'width:400px;height:auto;display:block;margin:20px 0';
                win.document.querySelector('#result').appendChild(canvas);
            }
            return {
                front: front.toDataURL().split(',')[1], back: back.toDataURL().split(',')[1],
                complete: (await win.cardRenderer.generateKtsBothCanvas(win.testStudent)).toDataURL().split(',')[1]
            };
        }).then(result => {
            cy.writeFile('scratch/card-font-test/corrected-front.png', result.front, 'base64', { log: false });
            cy.writeFile('scratch/card-font-test/corrected-back.png', result.back, 'base64', { log: false });
            cy.writeFile('scratch/card-font-test/corrected-complete.png', result.complete, 'base64', { log: false });
        });
        cy.get('#preview').screenshot('actual-fonts-preview-front');
        cy.get('#result canvas').first().screenshot('actual-fonts-export-front');
        cy.get('#preview').invoke('addClass', 'flipped');
        cy.get('#preview').screenshot('actual-fonts-preview-back');
        cy.get('#result canvas').last().screenshot('actual-fonts-export-back');
    });
});
