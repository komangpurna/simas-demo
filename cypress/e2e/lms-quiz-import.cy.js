describe('LMS question import: Word and PDF in the real browser', () => {
    const aiQuestion = overrides => ({ type: 'essay', question: 'Jelaskan manfaat cahaya.', options: [], correct_option: null, correct_answer: '', accepted_answers: [], grading_guidance: '', explanation: '', points: 1, needs_review: false, review_notes: '', ...overrides });
    const aiResponse = (questions, page_count = 0) => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ complete: true, page_count, warnings: [], questions }) }] } }] });
    const openWithKey = () => {
        cy.visit('/cypress/fixtures/lms-quiz-import-workflow.html?savedKey=1');
        cy.window().its('demoReady').should('equal', true);
        cy.get('#import').click();
        cy.get('[data-import-ai]').should('be.checked').and('be.enabled');
    };
    beforeEach(() => {
        cy.visit('/cypress/fixtures/lms-quiz-import-workflow.html');
        cy.window().its('demoReady').should('equal', true);
        cy.get('#import').click();
    });
    it('reads a real DOCX archive with automatic numbering and imports editable mixed questions on mobile', () => {
        cy.viewport(390, 844);
        const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
        const paragraph = (text, level) => `<w:p>${level === undefined ? '' : `<w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="7"/></w:numPr></w:pPr>`}<w:r><w:t>${text}</w:t></w:r></w:p>`;
        cy.window().then(async win => {
            const zip = new win.JSZip();
            zip.file('word/document.xml', `<w:document xmlns:w="${ns}"><w:body>${paragraph('Bagian tumbuhan yang menyerap air?', 0)}${paragraph('Daun', 1)}${paragraph('Akar', 1)}${paragraph('Kunci: B')}${paragraph('[Isian Singkat] Sebutkan gas hasil fotosintesis.', 0)}${paragraph('[Uraian] Jelaskan manfaat cahaya.', 0)}</w:body></w:document>`);
            zip.file('word/numbering.xml', `<w:numbering xmlns:w="${ns}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="upperLetter"/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="1"/></w:num></w:numbering>`);
            return zip.generateAsync({ type: 'uint8array' });
        }).then(bytes => cy.get('[data-import-file]').selectFile({ contents: Cypress.Buffer.from(bytes), fileName: 'Soal-Guru.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
        cy.get('[data-import-preview-list]').should('contain', '3 soal ditemukan').and('contain', 'Kunci: B');
        cy.get('[data-import-apply]').should('be.enabled');
        cy.get('#lms-quiz-import').then($el => expect($el[0].scrollWidth).to.be.at.most(390));
        cy.screenshot('lms-word-import-mobile', { capture: 'viewport' });
        cy.get('[data-import-apply]').click();
        cy.get('.lms-quiz-question-item').should('have.length', 3);
        cy.get('#save').click();
        cy.get('#result').invoke('text').then(value => {
            const quiz = JSON.parse(value);
            expect(quiz.questions.map(q => q.type)).to.deep.equal(['mc', 'short', 'essay']);
            expect(quiz.questions[0].correct_option).to.equal(1);
            expect(quiz.questions[1].correct_answer).to.equal('');
            expect(quiz.questions[2].grading_guidance).to.equal('');
        });
    });
    it('loads the pinned PDF.js worker and reads a real text PDF without uploading it', () => {
        cy.window().then(win => {
            const pdf = new win.jspdf.jsPDF();
            pdf.setFontSize(12);
            pdf.text(['1. [PG] Gas hasil fotosintesis adalah ...', 'A. Oksigen', 'B. Nitrogen', 'Kunci: A', '2. [Uraian] Jelaskan manfaat cahaya.', 'Bobot: 5'], 20, 25);
            return Cypress.Buffer.from(pdf.output('arraybuffer'));
        }).then(bytes => cy.get('[data-import-file]').selectFile({ contents: bytes, fileName: 'Soal-Guru.pdf', mimeType: 'application/pdf' }));
        cy.get('[data-import-source]', { timeout: 60000 }).should('not.contain', 'Membaca');
        cy.get('[data-import-error]').should('have.text', '');
        cy.get('[data-import-preview-list]', { timeout: 60000 }).should('contain', '2 soal ditemukan').and('contain', 'Kunci: A');
        cy.get('[data-import-apply]').click();
        cy.get('#save').click();
        cy.get('#result').invoke('text').then(value => {
            const quiz = JSON.parse(value);
            expect(quiz.questions).to.have.length(2);
            expect(quiz.questions[0]).to.include({ type: 'mc', correct_option: 0 });
            expect(quiz.questions[1]).to.include({ type: 'essay', points: 5, grading_guidance: '' });
        });
    });
    it('pastes unstructured internet/AI text, uses the saved key and previews before appending', () => {
        cy.intercept('POST', '**/v1beta/models/*:generateContent', request => {
            expect(request.headers['x-goog-api-key']).to.equal('fake-import-key-for-browser-test');
            expect(request.body.contents[0].parts[0].text).to.contain('Dari hasil AI lain');
            expect(request.body.systemInstruction.parts[0].text).to.contain('Bukan membuat soal baru');
            request.reply({ statusCode: 200, body: aiResponse([
                aiQuestion({ type: 'mc', question: 'Bagian penyerap air?', options: ['Daun', 'Akar'], correct_option: 1 }),
                aiQuestion({ type: 'short', question: 'Gas hasil fotosintesis?' })
            ]) });
        }).as('aiImport');
        openWithKey();
        cy.viewport(390, 844);
        cy.get('[data-import-text]').invoke('val', 'Dari hasil AI lain:\nPertanyaan pertama - Bagian penyerap air? Pilihan: daun / akar. Jawaban: akar\nBerikutnya, sebutkan gas hasil fotosintesis.').trigger('input');
        cy.get('[data-import-preview]').should('contain', 'Rapikan dengan AI').click();
        cy.wait('@aiImport').its('response.statusCode').should('equal', 200);
        cy.get('[data-import-preview-list]').should('contain', '2 soal ditemukan').and('contain', 'Draf hasil AI');
        cy.get('.lms-quiz-question-item').should('have.length', 1);
        cy.get('#lms-quiz-import').then($el => expect($el[0].scrollWidth).to.be.at.most(390));
        cy.screenshot('lms-ai-paste-mobile', { capture: 'viewport' });
        cy.get('[data-import-apply]').click();
        cy.get('#save').click();
        cy.get('#result').invoke('text').then(value => {
            const quiz = JSON.parse(value);
            expect(quiz.questions).to.have.length(2);
            expect(quiz.questions[0].correct_option).to.equal(1);
            expect(quiz.questions[1]).to.include({ type: 'short', correct_answer: '' });
        });
    });
    it('sends a scan PDF directly to AI when a teacher key is present', () => {
        cy.intercept('POST', '**/v1beta/models/*:generateContent', request => {
            const part = request.body.contents[0].parts[0];
            expect(part.inlineData.mimeType).to.equal('application/pdf');
            expect(part.inlineData.data).to.match(/^JVBER/);
            request.reply({ statusCode: 200, body: aiResponse([aiQuestion()], 1) });
        }).as('scanImport');
        openWithKey();
        cy.window().then(win => {
            const canvas = win.document.createElement('canvas'); canvas.width = 600; canvas.height = 100;
            const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 600, 100); context.fillStyle = '#111'; context.font = '20px sans-serif'; context.fillText('Jelaskan manfaat cahaya.', 20, 45);
            const pdf = new win.jspdf.jsPDF(); pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 20, 20, 170, 30);
            return Cypress.Buffer.from(pdf.output('arraybuffer'));
        }).then(bytes => cy.get('[data-import-file]').selectFile({ contents: bytes, fileName: 'scan.pdf', mimeType: 'application/pdf' }));
        cy.wait('@scanImport');
        cy.get('[data-import-error]').should('have.text', '');
        cy.get('[data-import-preview-list]').should('contain', '1 soal ditemukan');
        cy.get('[data-import-apply]').click();
        cy.get('#save').click();
        cy.get('#result').invoke('text').then(value => expect(JSON.parse(value).questions[0]).to.include({ type: 'essay', grading_guidance: '' }));
    });
    it('keeps normal paste/import working without a saved key and makes no AI request', () => {
        let requests = 0;
        cy.intercept('POST', '**/v1beta/models/*:generateContent', () => { requests++; });
        cy.get('[data-import-ai]').should('not.be.checked').and('be.disabled');
        cy.get('[data-import-ai-status]').should('contain', 'API key belum tersimpan');
        cy.get('[data-import-text]').invoke('val', '1. [Uraian] Soal tanpa AI').trigger('input');
        cy.get('[data-import-preview]').click();
        cy.get('[data-import-preview-list]').should('contain', '1 soal ditemukan');
        cy.then(() => expect(requests).to.equal(0));
    });
});
