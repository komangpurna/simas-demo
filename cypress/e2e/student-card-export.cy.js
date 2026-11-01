describe('PNG kartu mengikuti preview HTML/CSS', () => {
    before(() => {
        cy.exec('node node_modules/tailwindcss/lib/cli.js --content js/student-card-renderer.js --output scratch/student-card-test.css', { timeout: 60000 });
    });
    beforeEach(() => {
        cy.visit('/cypress/fixtures/student-card-preview.html');
        cy.window().its('cardRenderer').should('exist');
        cy.get('#preview .kts-qr-container canvas').should('exist');
    });

    it('menyalin perubahan warna dan teks terbaru tanpa mengubah DOM preview', () => {
        cy.window().then({ timeout: 60000 }, async win => {
            const face = win.document.querySelector('[data-kts-side="front"]');
            face.querySelector('.kts-identity-name').textContent = 'NAMA HASIL EDIT PREVIEW';
            face.style.setProperty('background-color', 'rgb(255, 0, 255)', 'important');
            const before = face.outerHTML;
            const canvas = await win.cardRenderer.generateKtsFrontCanvas(win.testStudent);
            expect(canvas.width).to.equal(1011);
            expect(canvas.height).to.equal(637);
            expect(face.outerHTML).to.equal(before);
            const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            let magenta = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i] > 220 && pixels[i + 1] < 80 && pixels[i + 2] > 220) magenta++;
            }
            expect(magenta).to.be.greaterThan(10000);
            const first = canvas.toDataURL();
            face.querySelector('.kts-identity-name').textContent = 'BERUBAH LAGI';
            const changed = await win.cardRenderer.generateKtsFrontCanvas(win.testStudent);
            expect(changed.toDataURL() !== first, 'latest preview edit changes PNG').to.equal(true);
            const svgUrl = await win.htmlToImage.toSvg(face, { fontEmbedCSS: '' });
            const svg = new win.DOMParser().parseFromString(await (await win.fetch(svgUrl)).text(), 'image/svg+xml');
            expect(svg.querySelector('.kts-identity-name').style.fontSize)
                .to.equal(win.getComputedStyle(face.querySelector('.kts-identity-name')).fontSize);
            expect(win.document.querySelector('[data-kts-export-stage]')).to.equal(null);
        });
    });

    it('sisi belakang tersembunyi sama dengan sisi belakang yang sedang ditampilkan', () => {
        cy.viewport(390, 844);
        cy.window().then({ timeout: 60000 }, async win => {
            win.document.querySelectorAll('.kts-face').forEach(face => face.style.transition = 'none');
            win.cardRenderer.updateKtsCardScale('preview');
            // An explicitly hidden design element must stay hidden in either flip state.
            win.document.querySelector('.kts-face-back p').style.visibility = 'hidden';
            const hidden = await win.cardRenderer.generateKtsBackCanvas(win.testStudent);
            win.document.querySelector('#preview').classList.add('flipped');
            // Stop the screen flip transition before comparing the stable card.
            win.document.querySelectorAll('.kts-face').forEach(face => face.style.transition = 'none');
            const shown = await win.cardRenderer.generateKtsBackCanvas(win.testStudent);
            shown.style.cssText = 'width:100%;height:auto';
            win.document.querySelector('#result').appendChild(shown);
            return { hidden: hidden.toDataURL().split(',')[1], shown: shown.toDataURL().split(',')[1] };
        }).then(result => {
            if (result.hidden !== result.shown) {
                cy.writeFile('scratch/kts-hidden.png', result.hidden, 'base64');
                cy.writeFile('scratch/kts-shown.png', result.shown, 'base64');
            }
            cy.then(() => expect(result.hidden === result.shown, 'hidden/shown PNG pixels').to.equal(true));
        });
        cy.get('#result canvas').screenshot('kts-export-back');
    });

    it('tanpa preview membuat kartu dan QR milik siswa yang diminta', () => {
        cy.window().then({ timeout: 60000 }, async win => {
            const other = { ...win.testStudent, nis: '99999', photoPublicToken: 'kts_other_student' };
            const qrPayloads = [];
            const OriginalQR = win.QRCode;
            win.QRCode = function (container, options) {
                qrPayloads.push(options.text);
                return new OriginalQR(container, options);
            };
            win.QRCode.CorrectLevel = OriginalQR.CorrectLevel;
            const result = await win.cardRenderer.generateKtsBothCanvas(other);
            expect(qrPayloads).to.deep.equal([`${win.location.origin}/kartu-shakti.html?id=kts_other_student`]);
            expect(result.width).to.equal(2092);
            expect(result.height).to.equal(677);
            result.style.cssText = 'width:100%;height:auto';
            win.document.querySelector('#result').appendChild(result);
        });
        cy.get('#result canvas').screenshot('kts-export-both');
    });

    it('modal yang memasang satu sisi mempertahankan skala dan warna preview untuk sisi lainnya', () => {
        cy.window().then({ timeout: 60000 }, async win => {
            const wrapper = win.document.querySelector('#preview');
            wrapper.style.setProperty('--kts-gold', '#0066cc');
            const mounted = await win.cardRenderer.generateKtsBackCanvas(win.testStudent);
            wrapper.querySelector('[data-kts-side="back"]').remove();
            const generated = await win.cardRenderer.generateKtsBackCanvas(win.testStudent);
            return { mounted: mounted.toDataURL().split(',')[1], generated: generated.toDataURL().split(',')[1] };
        }).then(result => {
            if (result.mounted !== result.generated) {
                cy.writeFile('scratch/kts-mounted.png', result.mounted, 'base64');
                cy.writeFile('scratch/kts-generated.png', result.generated, 'base64');
            }
            cy.then(() => expect(result.mounted === result.generated, 'single-side modal retains preview design').to.equal(true));
        });
    });

    it('aset yang gagal diakses membatalkan unduhan dan membersihkan staging', () => {
        cy.intercept('GET', '/assets/kts-missing-test.png', { statusCode: 404 });
        cy.window().then({ timeout: 60000 }, async win => {
            const photo = win.document.querySelector('#preview .kts-face-front img');
            photo.removeAttribute('onerror');
            photo.src = '/assets/kts-missing-test.png';
            let failure;
            try { await win.cardRenderer.generateKtsFrontCanvas(win.testStudent); }
            catch (error) { failure = error; }
            expect(failure).to.exist;
            expect(win.document.querySelector('[data-kts-export-stage]')).to.equal(null);
        });
    });

    it('cetak memakai piksel PNG yang sama dengan unduhan dan ukuran fisik CR-80', () => {
        cy.window().then({ timeout: 60000 }, async win => {
            const face = win.document.querySelector('[data-kts-side="front"]');
            face.querySelector('.kts-identity-name').textContent = 'EDIT PREVIEW UNTUK CETAK';
            const downloaded = await win.cardRenderer.generateKtsFrontCanvas(win.testStudent);
            const printed = win.document.createElement('div');
            printed.id = 'test-print';
            win.document.body.appendChild(printed);
            await win.cardRenderer.prepareKtsPrintCards([win.testStudent], 'front', printed);
            const image = printed.querySelector('img');
            expect(image.src === downloaded.toDataURL('image/png'), 'print/download PNG pixels').to.equal(true);
            await Cypress.automation('remote:debugger:protocol', {
                command: 'Emulation.setEmulatedMedia', params: { media: 'print' }
            });
            try {
                expect(win.getComputedStyle(image).visibility).to.equal('visible');
                expect(image.getBoundingClientRect().width).to.be.closeTo(85.6 * 96 / 25.4, 0.02);
                expect(image.getBoundingClientRect().height).to.be.closeTo(53.98 * 96 / 25.4, 0.02);
                expect(image.src === downloaded.toDataURL('image/png'), 'print media preserves PNG').to.equal(true);
            } finally {
                await Cypress.automation('remote:debugger:protocol', {
                    command: 'Emulation.setEmulatedMedia', params: { media: 'screen' }
                });
            }
            const front = await win.cardRenderer.generateKtsFrontCanvas(win.testStudent);
            front.style.cssText = 'width:400px;height:auto';
            win.document.querySelector('#result').appendChild(front);
            printed.remove();
        });
        cy.get('#preview').screenshot('kts-live-preview');
        cy.get('#result canvas').screenshot('kts-export-front');
    });
});
