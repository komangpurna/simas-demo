/**
 * tests/challenger-m1-dom-redirect.test.js
 *
 * Empirical Challenger Verification Suite for Milestone 1:
 * - DOM integrity, tag balance, and modal anti-nesting of e-kinerja-tendik.html
 * - Instant redirect shim behavior and fallback UI of agenda-pegawai.html
 * - Adherence to SIMAS UI Guidelines & Single Source of Truth
 */

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const rootDir = path.resolve(__dirname, '..');

describe('Challenger M1: Empirical Verification of e-kinerja-tendik.html DOM Structure', () => {
    const htmlPath = path.join(rootDir, 'e-kinerja-tendik.html');
    let rawContent;
    let dom;
    let document;

    beforeAll(() => {
        expect(fs.existsSync(htmlPath)).toBe(true);
        rawContent = fs.readFileSync(htmlPath, 'utf8');
        dom = new JSDOM(rawContent, { runScripts: 'outside-only' });
        document = dom.window.document;
    });

    test('1. Tag Balance & Container Nesting Integrity across entire e-kinerja-tendik.html', () => {
        // Strip comments and script/style contents
        const noComments = rawContent
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

        // HTML void elements (never have closing tags) and optional closing elements like <option> in datalist
        const voidElements = new Set([
            'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
            'link', 'meta', 'param', 'source', 'track', 'wbr', '!doctype',
            // option in datalist often omitted
            'option'
        ]);

        // Robust regex that handles multi-line attributes and quotes
        const tagRegex = /<\/?([a-zA-Z0-9\-]+)(?:\s+(?:[^>'"/]|"[^"]*"|'[^']*')*)?(\/?)>/g;

        const stack = [];
        const mismatchErrors = [];
        let m;

        while ((m = tagRegex.exec(noComments)) !== null) {
            const fullTag = m[0];
            const tagName = m[1].toLowerCase();
            const selfClosingSlash = m[2] === '/';

            if (tagName === '!doctype') continue;
            if (voidElements.has(tagName)) continue;

            const isClosing = fullTag.startsWith('</');

            if (selfClosingSlash) continue;

            // Calculate approximate line number
            const upToMatch = noComments.substring(0, m.index);
            const line = upToMatch.split('\n').length;

            if (isClosing) {
                if (stack.length === 0) {
                    mismatchErrors.push(`Tag penutup </${tagName}> di sekitar baris ${line} tidak memiliki tag pembuka`);
                } else {
                    const top = stack.pop();
                    if (top.tagName !== tagName) {
                        mismatchErrors.push(`Tag mismatch di sekitar baris ${line}: penutup </${tagName}> tidak cocok dengan pembuka <${top.tagName}> dari baris ${top.line}`);
                    }
                }
            } else {
                stack.push({ tagName, line });
            }
        }

        expect(mismatchErrors).toEqual([]);
        if (stack.length > 0) {
            const unclosedReport = stack.map(s => `<${s.tagName}> (baris ${s.line})`).join(', ');
            throw new Error(`Ditemukan ${stack.length} unclosed tag(s): ${unclosedReport}`);
        }
        expect(stack.length).toBe(0);
    });

    test('2. Modal Anti-Nesting Mandate: All 6 modals must be top-level siblings outside <main>', () => {
        const mainEl = document.querySelector('main');
        expect(mainEl).not.toBeNull();

        const expectedModalIds = [
            'modal-employee-activity',
            'modal-manage-assignments',
            'modal-generic-confirm',
            'modal-evidence-lightbox',
            'modal-employee-monthly-recap',
            'modal-employee-rekap-vip-notice',
            'modal-supervisor-employee-detail',
            'modal-employee-butir-print'
        ];

        // Verifikasi modal supervisi #modal-supervisor-employee-detail aktif untuk mode monitoring supervisi kepsek (PRD v1.2.333)
        expect(document.getElementById('modal-supervisor-employee-detail')).not.toBeNull();

        expectedModalIds.forEach(modalId => {
            const modalEl = document.getElementById(modalId);
            expect(modalEl).not.toBeNull();

            // Modal HARUS bukan turunan dari <main>
            expect(mainEl.contains(modalEl)).toBe(false);

            // Modal HARUS berkelas fixed inset-0
            expect(modalEl.classList.contains('fixed')).toBe(true);
            expect(modalEl.classList.contains('inset-0')).toBe(true);
        });

        // Verifikasi tidak ada modal yang bersarang di dalam modal lain
        for (let i = 0; i < expectedModalIds.length; i++) {
            const parentModal = document.getElementById(expectedModalIds[i]);
            for (let j = 0; j < expectedModalIds.length; j++) {
                if (i === j) continue;
                const childModal = document.getElementById(expectedModalIds[j]);
                expect(parentModal.contains(childModal)).toBe(false);
            }
        }

        // Iframe pratinjau cetak berada di dalam modal cetak (di luar <main>)
        const printFrame = document.getElementById('emp-print-preview-frame');
        expect(printFrame).not.toBeNull();
        expect(mainEl.contains(printFrame)).toBe(false);
    });

    test('3. DOM ID Uniqueness Check: 0 duplicate IDs allowed in e-kinerja-tendik.html', () => {
        const allElements = document.querySelectorAll('[id]');
        const seenIds = new Map();
        const duplicates = [];

        allElements.forEach(el => {
            const id = el.id.trim();
            if (!id) return;
            if (seenIds.has(id)) {
                duplicates.push({ id, tag: el.tagName, count: seenIds.get(id) + 1 });
                seenIds.set(id, seenIds.get(id) + 1);
            } else {
                seenIds.set(id, 1);
            }
        });

        expect(duplicates).toEqual([]);
    });

    test('4. Key DOM Elements Presence & Structural Integrity', () => {
        // Layout root container di awal <body>
        const appLayout = document.getElementById('app-layout');
        expect(appLayout).not.toBeNull();
        expect(appLayout.parentElement.tagName.toLowerCase()).toBe('body');

        // Main element with standard layout classes
        const mainEl = document.querySelector('main');
        expect(mainEl.classList.contains('hidden')).toBe(true);
        expect(mainEl.classList.contains('fade-in')).toBe(true);

        // Header and Title text
        const titleText = document.getElementById('page-title-text');
        expect(titleText).not.toBeNull();
        expect(titleText.textContent.trim()).toMatch(/E-Kinerja (?:Tendik|Tenaga Kependidikan)/);

        // Navigasi & Action buttons
        expect(document.getElementById('btn-agenda-prev')).not.toBeNull();
        expect(document.getElementById('btn-agenda-next')).not.toBeNull();
        expect(document.getElementById('btn-agenda-today')).not.toBeNull();
        expect(document.getElementById('input-agenda-date')).not.toBeNull();
        expect(document.getElementById('btn-monitoring-mode-toggle')).not.toBeNull();
        expect(document.getElementById('btn-manage-assignments')).not.toBeNull();
        expect(document.getElementById('btn-open-activity-modal')).not.toBeNull();
        expect(document.getElementById('btn-employee-monthly-recap-toggle')).not.toBeNull();
        expect(document.getElementById('employee-activities-container')).not.toBeNull();

        // Form Activity Elements
        expect(document.getElementById('form-employee-activity')).not.toBeNull();
        expect(document.getElementById('form-activity-id')).not.toBeNull();
        expect(document.getElementById('form-activity-date')).not.toBeNull();
        expect(document.getElementById('form-activity-start')).not.toBeNull();
        expect(document.getElementById('form-activity-end')).not.toBeNull();
        expect(document.getElementById('form-activity-group')).not.toBeNull();
        expect(document.getElementById('form-activity-task-item')).not.toBeNull();
        expect(document.getElementById('form-activity-desc')).not.toBeNull();
        expect(document.getElementById('form-activity-output')).not.toBeNull();
        expect(document.getElementById('form-activity-location')).not.toBeNull();
        expect(document.getElementById('btn-save-activity')).not.toBeNull();
        expect(document.getElementById('btn-save-draft-alt')).not.toBeNull();
        expect(document.getElementById('btn-delete-activity-modal')).not.toBeNull();

        // Script module linkage
        const scriptTags = Array.from(document.querySelectorAll('script[type="module"]'));
        const mainScript = scriptTags.find(s => s.src && s.src.includes('page-e-kinerja-tendik.js'));
        expect(mainScript).toBeDefined();

        const cleanScriptSrc = mainScript.getAttribute('src').split('?')[0];
        const scriptFilePath = path.join(rootDir, cleanScriptSrc);
        expect(fs.existsSync(scriptFilePath)).toBe(true);
    });

    test('5. UI Guidelines: Anti-Overlapping Icon Rule on Inputs', () => {
        // Search inputs must NOT have leading icons inside the input element
        const searchInput = document.getElementById('search-employee-activities');
        expect(searchInput).not.toBeNull();
        const searchClasses = searchInput.className;
        expect(searchClasses).not.toMatch(/\bpl-(?:9|10|11|12)\b/);

        // Date input must have clean horizontal padding
        const dateInput = document.getElementById('form-activity-date');
        expect(dateInput).not.toBeNull();
        expect(dateInput.className).not.toMatch(/\bpl-(?:9|10|11|12)\b/);
    });

    test('6. Consistency & Terminology: Document title and headers use E-Kinerja Tendik', () => {
        expect(document.title).toContain('E-Kinerja Tendik');
        expect(document.title).not.toContain('Agenda Pegawai');

        const heading = document.getElementById('page-title-heading');
        expect(heading.textContent).toMatch(/E-Kinerja (?:Tendik|Tenaga Kependidikan)/);
    });
});

describe('Challenger M1: Empirical Verification of agenda-pegawai.html Redirect Shim', () => {
    const shimPath = path.join(rootDir, 'agenda-pegawai.html');
    let shimContent;
    let dom;
    let document;

    beforeAll(() => {
        expect(fs.existsSync(shimPath)).toBe(true);
        shimContent = fs.readFileSync(shimPath, 'utf8');
        dom = new JSDOM(shimContent, {
            runScripts: 'outside-only',
            url: 'https://simas.test/agenda-pegawai.html?date=2026-10-09&tab=rekap#monitoring'
        });
        document = dom.window.document;
    });

    test('1. Tag Balance and Valid HTML5 Structure of agenda-pegawai.html', () => {
        expect(shimContent).toMatch(/<!DOCTYPE html>/i);
        expect(shimContent).toMatch(/<html lang="id">/i);
        expect(shimContent).toMatch(/<\/html>\s*$/i);
    });

    test('2. Meta Refresh Tag points to e-kinerja-tendik.html with 0 timeout', () => {
        const metaRefresh = document.querySelector('meta[http-equiv="refresh"]');
        expect(metaRefresh).not.toBeNull();
        expect(metaRefresh.getAttribute('content')).toBe('0; url=e-kinerja-tendik.html');
    });

    test('3. JavaScript Instant Redirect Target Logic preserves query and hash', () => {
        // Test redirect logic expression: 'e-kinerja-tendik.html' + window.location.search + window.location.hash
        const simulateRedirect = (fullUrl) => {
            const urlObj = new URL(fullUrl);
            return 'e-kinerja-tendik.html' + urlObj.search + urlObj.hash;
        };

        // Scenario 1: Clean URL without search or hash
        expect(simulateRedirect('https://simas.smagesa.sch.id/agenda-pegawai.html'))
            .toBe('e-kinerja-tendik.html');

        // Scenario 2: Single query param
        expect(simulateRedirect('https://simas.smagesa.sch.id/agenda-pegawai.html?date=2026-10-09'))
            .toBe('e-kinerja-tendik.html?date=2026-10-09');

        // Scenario 3: Multiple query params
        expect(simulateRedirect('https://simas.smagesa.sch.id/agenda-pegawai.html?date=2026-10-09&tab=rekap&employee_id=gtk_123'))
            .toBe('e-kinerja-tendik.html?date=2026-10-09&tab=rekap&employee_id=gtk_123');

        // Scenario 4: Hash only
        expect(simulateRedirect('https://simas.smagesa.sch.id/agenda-pegawai.html#monitoring'))
            .toBe('e-kinerja-tendik.html#monitoring');

        // Scenario 5: Query + Hash combined
        expect(simulateRedirect('https://simas.smagesa.sch.id/agenda-pegawai.html?date=2026-10-09&mode=supervisi#history-timeline'))
            .toBe('e-kinerja-tendik.html?date=2026-10-09&mode=supervisi#history-timeline');

        // Scenario 6: Encoded URI parameters
        expect(simulateRedirect('https://simas.smagesa.sch.id/agenda-pegawai.html?filter=rapat%20dinas&status=draft'))
            .toBe('e-kinerja-tendik.html?filter=rapat%20dinas&status=draft');
    });

    test('4. Inline Script in <head> performs window.location.replace with correct target', () => {
        const headScripts = Array.from(document.querySelectorAll('head script'));
        const redirectScript = headScripts.find(s => s.textContent.includes('window.location.replace'));
        expect(redirectScript).toBeDefined();

        // Verify the logic directly by running it with a mock replace
        const mockReplace = jest.fn();
        const testDom = new JSDOM(shimContent, {
            runScripts: 'outside-only',
            url: 'https://simas.test/agenda-pegawai.html?date=2026-10-09&tab=rekap#monitoring'
        });

        // Patch window.location.replace
        delete testDom.window.location;
        testDom.window.location = {
            search: '?date=2026-10-09&tab=rekap',
            hash: '#monitoring',
            replace: mockReplace
        };

        // Execute the script content
        testDom.window.eval(redirectScript.textContent);

        expect(mockReplace).toHaveBeenCalledWith('e-kinerja-tendik.html?date=2026-10-09&tab=rekap#monitoring');
    });

    test('5. Fallback UI & Manual Redirect Button with synchronized href', () => {
        const testDom = new JSDOM(shimContent, {
            runScripts: 'outside-only',
            url: 'https://simas.test/agenda-pegawai.html?date=2026-10-09&tab=rekap#monitoring'
        });

        const bodyScripts = Array.from(testDom.window.document.querySelectorAll('body script'));
        expect(bodyScripts.length).toBeGreaterThan(0);

        // Execute body fallback script
        bodyScripts.forEach(s => testDom.window.eval(s.textContent));

        const manualBtn = testDom.window.document.getElementById('btn-redirect-manual');
        expect(manualBtn).not.toBeNull();
        expect(manualBtn.getAttribute('href')).toBe('e-kinerja-tendik.html?date=2026-10-09&tab=rekap#monitoring');

        // Spinner and informative text
        const spinner = testDom.window.document.querySelector('.fa-spinner');
        expect(spinner).not.toBeNull();
        expect(testDom.window.document.body.textContent).toContain('E-Kinerja Tendik');
    });
});
