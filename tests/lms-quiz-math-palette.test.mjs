/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { installQuizBuilder } from '../js/lms-quiz-ui.mjs';
import { renderSafeMarkdown, renderMathFormulas } from '../js/utils.mjs';

describe('LMS Quiz Math Palette Modal & Intelligent LaTeX Parser', () => {
    let card;
    let notifyMock;

    beforeEach(() => {
        document.body.innerHTML = '';
        notifyMock = jest.fn();
        installQuizBuilder({ notify: notifyMock });

        card = document.createElement('div');
        card.className = 'lm-packet lms-material-card';
        card.innerHTML = `
            <div class="lms-quiz-questions-list"></div>
        `;
        document.body.appendChild(card);
    });

    afterEach(() => {
        document.body.innerHTML = '';
        jest.restoreAllMocks();
    });

    test('1. Adding a question creates contextual math trigger buttons for Question, Options, and Explanation without static toolbar', () => {
        window.addLmsQuizQuestion(card, 'mc', {
            question: 'Berapakah nilai x?',
            options: ['1', '2', '3', '4', '5'],
            explanation: 'Gunakan rumus cermin.'
        });

        const item = card.querySelector('.lms-quiz-question-item');
        expect(item).not.toBeNull();

        // Static cluttered toolbar must be absent
        expect(item.querySelector('.lms-math-toolbar')).toBeNull();

        // Trigger button on Question header
        const qBtn = item.querySelector('[data-action="math-palette-q"]');
        expect(qBtn).not.toBeNull();

        // Trigger buttons on Options A-E
        const optMathButtons = item.querySelectorAll('[data-math-option]');
        expect(optMathButtons.length).toBe(5);

        // Trigger button on Explanation
        const expBtn = item.querySelector('[data-action="math-palette-exp"]');
        expect(expBtn).not.toBeNull();
    });

    test('2. Clicking Question math trigger opens palette popover, inserts symbol at cursor, and updates live preview', () => {
        window.addLmsQuizQuestion(card, 'essay', {
            question: 'Titik A(6, 4) dicerminkan dengan skala '
        });

        const item = card.querySelector('.lms-quiz-question-item');
        const qText = item.querySelector('.lms-quiz-q-text');
        qText.selectionStart = qText.value.length;
        qText.selectionEnd = qText.value.length;

        const qBtn = item.querySelector('[data-action="math-palette-q"]');
        qBtn.click();

        const popover = document.getElementById('lms-math-palette-popover');
        expect(popover).not.toBeNull();
        expect(popover.getAttribute('aria-label')).toBe('Palet Simbol & Rumus Matematika (LaTeX)');

        // Click symbol button ±
        const plusMinusBtn = popover.querySelector('button[data-insert-math="±"]');
        expect(plusMinusBtn).not.toBeNull();
        plusMinusBtn.click();

        // Target text contains inserted snippet
        expect(qText.value).toContain('±');

        // Popover stays open for multi-insert
        expect(document.getElementById('lms-math-palette-popover')).not.toBeNull();

        // Switch to Formula Builder tab
        const tabBuilderBtn = popover.querySelector('[data-tab-btn="builder"]');
        expect(tabBuilderBtn).not.toBeNull();
        tabBuilderBtn.click();

        const panelBuilder = popover.querySelector('[data-tab-panel="builder"]');
        expect(panelBuilder.classList.contains('hidden')).toBe(false);

        // Fill fraction: num = 1, den = 2
        const numInput = panelBuilder.querySelector('input[data-field="num"]');
        const denInput = panelBuilder.querySelector('input[data-field="den"]');
        numInput.value = '1';
        numInput.dispatchEvent(new Event('input'));
        denInput.value = '2';
        denInput.dispatchEvent(new Event('input'));

        const insertBtn = panelBuilder.querySelector('[data-action="insert-built-formula"]');
        insertBtn.click();

        expect(qText.value).toContain('±$\\frac{1}{2}$');

        // Close popover
        popover.querySelector('[data-action="close-popover"]').click();
        expect(document.getElementById('lms-math-palette-popover')).toBeNull();
    });

    test('3. Option math trigger button accurately inserts math symbols into specific option input', () => {
        window.addLmsQuizQuestion(card, 'mc', {
            options: ['10', '20', '', '', '']
        });

        const item = card.querySelector('.lms-quiz-question-item');
        const optBBtn = item.querySelector('[data-math-option="1"]');
        const optBInput = item.querySelectorAll('.lms-quiz-mc-option')[1];

        optBInput.value = 'Hasil: ';
        optBInput.selectionStart = optBInput.value.length;
        optBInput.selectionEnd = optBInput.value.length;

        optBBtn.click();

        const popover = document.getElementById('lms-math-palette-popover');
        expect(popover).not.toBeNull();

        // Insert square root symbol
        const sqrtBtn = popover.querySelector('button[data-insert-math="√"]');
        expect(sqrtBtn).not.toBeNull();
        sqrtBtn.click();

        expect(optBInput.value).toBe('Hasil: √');
        popover.querySelector('[data-action="close-popover"]').click();
    });

    test('4. Explanation math trigger inserts symbols into explanation textarea', () => {
        window.addLmsQuizQuestion(card, 'short', {
            explanation: 'Langkah pertama: '
        });

        const item = card.querySelector('.lms-quiz-question-item');
        const expBtn = item.querySelector('[data-action="math-palette-exp"]');
        const expInput = item.querySelector('.lms-quiz-q-explanation');

        expInput.selectionStart = expInput.value.length;
        expInput.selectionEnd = expInput.value.length;

        expBtn.click();

        const popover = document.getElementById('lms-math-palette-popover');
        const piBtn = popover.querySelector('button[data-insert-math="π"]');
        expect(piBtn).not.toBeNull();
        piBtn.click();

        expect(expInput.value).toBe('Langkah pertama: π');
        popover.querySelector('[data-action="close-popover"]').click();
    });

    test('5. Intelligent parser: Renders raw standalone TeX like \\frac{1}{3} as mathematical fractions without dollar signs', () => {
        const rawQuestion = '\\frac{1}{3} Titik A(6, 4) dicerminkan terhadap Sumbu-X.';
        const html = renderSafeMarkdown(rawQuestion);

        // Must not remain as raw escaped LaTeX string
        expect(html).not.toContain('\\frac{1}{3}');
        // Must contain fraction HTML structure (either fallback or katex rendered)
        expect(html).toMatch(/<span[^>]*>.*1.*<\/span>.*<span[^>]*>.*3.*<\/span>|class="[^"]*frac[^"]*"/);
    });

    test('6. Intelligent parser: Handles both standard delimited $...$ and standalone TeX properly', () => {
        const textWithDollar = 'Persamaan $x^2 + 5x = 0$ dan pecahan $\\frac{2}{5}$';
        const rendered = renderMathFormulas(textWithDollar);

        expect(rendered).not.toContain('$x^2 + 5x = 0$');
        expect(rendered).not.toContain('$\\frac{2}{5}$');
        expect(rendered).toContain('<sup>2</sup>');
    });
});
