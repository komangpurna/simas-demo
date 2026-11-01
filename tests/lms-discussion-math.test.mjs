/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { openLmsMathPaletteModal, closeLmsMathPalette } from '../js/lms-math-palette.mjs';
import { renderSafeMarkdown, renderMathFormulas } from '../js/utils.mjs';

describe('Universal LMS Math Palette & Discussion Forum Math Integration', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        window.openLmsMathPaletteModal = openLmsMathPaletteModal;
        window.closeLmsMathPalette = closeLmsMathPalette;
        // Mock KaTeX in jsdom test environment to simulate browser KaTeX CDN
        window.katex = {
            renderToString: (tex, opts) => `<span class="katex"><span class="katex-html font-math">${tex.replace(/\\/g, '')}</span></span>`
        };
    });

    afterEach(() => {
        closeLmsMathPalette();
        document.body.innerHTML = '';
        delete window.katex;
        jest.restoreAllMocks();
    });

    test('1. openLmsMathPaletteModal opens Smart Floating Popover with Quick Symbols & Formula Builder', () => {
        const textarea = document.createElement('textarea');
        textarea.id = 'input-test-math';
        textarea.value = 'Hitunglah ';
        document.body.appendChild(textarea);

        const btnTrigger = document.createElement('button');
        btnTrigger.id = 'btn-math-trigger';
        document.body.appendChild(btnTrigger);

        textarea.selectionStart = textarea.value.length;
        textarea.selectionEnd = textarea.value.length;

        const onUpdateSpy = jest.fn();
        const popover = openLmsMathPaletteModal(textarea, onUpdateSpy, btnTrigger);

        expect(popover).not.toBeNull();
        expect(popover.className).toContain('z-[130]');
        expect(document.getElementById('lms-math-palette-popover')).toBe(popover);

        // 1. Tab 1 (Quick Symbols) test
        const plusMinusBtn = popover.querySelector('button[data-insert-math="±"]');
        expect(plusMinusBtn).not.toBeNull();
        plusMinusBtn.click();

        expect(textarea.value).toBe('Hitunglah ±');
        expect(onUpdateSpy).toHaveBeenCalled();

        // 2. Tab 2 (Formula Builder) test
        const tabBuilderBtn = popover.querySelector('[data-tab-btn="builder"]');
        expect(tabBuilderBtn).not.toBeNull();
        tabBuilderBtn.click();

        const panelBuilder = popover.querySelector('[data-tab-panel="builder"]');
        expect(panelBuilder.classList.contains('hidden')).toBe(false);

        // Fill fraction: num = 3x+1, den = 2
        const numInput = panelBuilder.querySelector('input[data-field="num"]');
        const denInput = panelBuilder.querySelector('input[data-field="den"]');
        expect(numInput).not.toBeNull();
        expect(denInput).not.toBeNull();

        numInput.value = '3x+1';
        numInput.dispatchEvent(new Event('input'));
        denInput.value = '2';
        denInput.dispatchEvent(new Event('input'));

        // Check Live Preview in Builder
        const preview = panelBuilder.querySelector('[data-builder-preview]');
        expect(preview.innerHTML).toContain('katex');
        expect(preview.innerHTML).toContain('3x+1');

        // Insert built formula
        const insertBtn = panelBuilder.querySelector('[data-action="insert-built-formula"]');
        insertBtn.click();

        expect(textarea.value).toBe('Hitunglah ±$\\frac{3x+1}{2}$');

        // Test toggle closing behavior
        openLmsMathPaletteModal(textarea, onUpdateSpy, btnTrigger);
        expect(document.getElementById('lms-math-palette-popover')).toBeNull();
    });

    test('2. Forum discussion comments render math expressions and TeX syntax with KaTeX', () => {
        const commentWithMath = 'Menurut saya solusinya adalah $x = \\frac{-b \\pm \\sqrt{D}}{2a}$ dengan nilai $D > 0$.';
        const rendered = renderSafeMarkdown(commentWithMath);

        expect(rendered).toContain('katex');
        expect(rendered).toContain('katex-html');
        expect(rendered).toContain('frac{-b');
    });

    test('3. Raw TeX expressions without dollar delimiters render cleanly in discussion', () => {
        const rawTeX = 'Silakan diskusikan turunan pertama dari f(x) = \\frac{1}{x^2}';
        const rendered = renderSafeMarkdown(rawTeX);

        expect(rendered).toContain('katex');
        expect(rendered).toContain('frac{1}{x^2}');
    });

    test('4. Teacher prompt card with math formulas renders KaTeX and neutralizes malicious XSS script tags', () => {
        const maliciousPrompt = 'Pemantik: Carilah nilai dari $\\sqrt{144}$ <script>alert("hack")</script><img src=x onerror="alert(1)">';
        const rendered = renderSafeMarkdown(maliciousPrompt);

        // Math must render
        expect(rendered).toContain('katex');
        expect(rendered).toContain('sqrt{144}');

        // Dangerous executable tags must be neutralized into safe entities
        expect(rendered).not.toContain('<script>');
        expect(rendered).toContain('&lt;script&gt;');
        expect(rendered).not.toContain('<img');
        expect(rendered).toContain('&lt;img');
    });

    test('5. Student quiz result review formatting renders math in explanations, answers, and keys', () => {
        const explanation = 'Pembahasan: Substitusikan ke rumus $y = mx + c$, didapat $c = -3$.';
        const renderedExp = renderSafeMarkdown(explanation);
        expect(renderedExp).toContain('katex');
        expect(renderedExp).toContain('y = mx + c');

        const key = 'A. $\\frac{1}{4}$';
        const renderedKey = renderSafeMarkdown(key);
        expect(renderedKey).toContain('katex');
        expect(renderedKey).toContain('frac{1}{4}');

        const studentAnswer = 'B. $\\sqrt{25} = 5$';
        const renderedAns = renderSafeMarkdown(studentAnswer);
        expect(renderedAns).toContain('katex');
        expect(renderedAns).toContain('sqrt{25} = 5');
    });

    test('6. Graceful fallback when KaTeX is offline/unavailable', () => {
        delete window.katex; // Simulate offline without KaTeX script
        const raw = 'Hitung \\frac{2}{3} + x^2';
        const rendered = renderSafeMarkdown(raw);

        // Must render structured HTML fallback
        expect(rendered).not.toContain('\\frac{2}{3}');
        expect(rendered).toMatch(/<span[^>]*>.*2.*<\/span>/);
    });
});
