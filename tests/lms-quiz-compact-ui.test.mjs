/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { installQuizBuilder } from '../js/lms-quiz-ui.mjs';

describe('LMS Quiz & CBT Compact UI Settings Modal', () => {
    let card;
    let notifyMock;

    beforeEach(() => {
        document.body.innerHTML = '';
        notifyMock = jest.fn();
        installQuizBuilder({ notify: notifyMock });

        card = document.createElement('div');
        card.className = 'lm-packet lms-material-card';
        card.innerHTML = `
            <input type="hidden" class="lms-quiz-mode" value="relaxed">
            <input type="hidden" class="lms-quiz-max-violations" value="3">
            <input type="hidden" class="lms-quiz-shuffle-q" value="0">
            <input type="hidden" class="lms-quiz-shuffle-opt" value="0">
            <input type="hidden" class="lms-quiz-kkm" value="75">
            <input type="hidden" class="lms-quiz-time" value="0">
            <input type="checkbox" class="lms-quiz-retake" checked style="display:none">
            <div class="lm-actions lm-quiz-toolbar">
                <button type="button" class="lm-btn lm-btn-cbt" data-action="cbt-settings">⚙️ Pengaturan Kuis / CBT</button>
                <span class="lms-cbt-badge lm-badge-cbt-relaxed">☕ Kuis (Bebas · KKM 75 · Boleh Ulang)</span>
            </div>
            <div class="lms-quiz-questions-list"></div>
        `;
        document.body.appendChild(card);
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('1. Modal opens with 3 structured sections and initialized with card values', () => {
        window.openLmsQuizSettingsModal(card);
        const modal = document.getElementById('lms-quiz-settings-modal');
        expect(modal).not.toBeNull();
        expect(modal.getAttribute('aria-label')).toBe('Pengaturan Kuis / CBT');

        // Bagian 1: Mode
        const relaxedRadio = modal.querySelector('input[name="cbt_modal_mode"][value="relaxed"]');
        const strictRadio = modal.querySelector('input[name="cbt_modal_mode"][value="strict"]');
        expect(relaxedRadio.checked).toBe(true);
        expect(strictRadio.checked).toBe(false);

        // Bagian 2: Parameter Utama
        const kkmInput = modal.querySelector('[data-cbt-kkm]');
        const durationInput = modal.querySelector('[data-cbt-duration]');
        const retakeCheckbox = modal.querySelector('[data-cbt-retake]');
        expect(kkmInput.value).toBe('75');
        expect(durationInput.value).toBe('0');
        expect(retakeCheckbox.checked).toBe(true);
        expect(retakeCheckbox.disabled).toBe(false);

        // Bagian 3: Pengamanan CBT (dimmed on relaxed mode)
        const securitySection = modal.querySelector('[data-cbt-options-section]');
        expect(securitySection.classList.contains('opacity-50')).toBe(true);
    });

    test('2. Switching to CBT mode forces duration >= 5, locks retake OFF, and enables CBT security section', () => {
        window.openLmsQuizSettingsModal(card);
        const modal = document.getElementById('lms-quiz-settings-modal');

        const strictRadio = modal.querySelector('input[name="cbt_modal_mode"][value="strict"]');
        strictRadio.checked = true;
        strictRadio.dispatchEvent(new Event('change'));

        const durationInput = modal.querySelector('[data-cbt-duration]');
        const retakeCheckbox = modal.querySelector('[data-cbt-retake]');
        const securitySection = modal.querySelector('[data-cbt-options-section]');

        // Duration is automatically elevated to minimum 30 if previously 0
        expect(Number(durationInput.value)).toBeGreaterThanOrEqual(5);
        expect(durationInput.min).toBe('5');

        // Retake must be locked and disabled in CBT mode
        expect(retakeCheckbox.checked).toBe(false);
        expect(retakeCheckbox.disabled).toBe(true);

        // Security options section must be interactive
        expect(securitySection.classList.contains('opacity-50')).toBe(false);
        expect(securitySection.classList.contains('pointer-events-none')).toBe(false);
    });

    test('3. Applying CBT settings syncs back to card DOM, formats compact badge, and fires change events', () => {
        let changed = false;
        card.addEventListener('change', () => { changed = true; });

        window.openLmsQuizSettingsModal(card);
        const modal = document.getElementById('lms-quiz-settings-modal');

        // Select CBT
        modal.querySelector('input[name="cbt_modal_mode"][value="strict"]').checked = true;
        modal.querySelector('input[name="cbt_modal_mode"][value="strict"]').dispatchEvent(new Event('change'));

        // Modify parameters
        const kkmInput = modal.querySelector('[data-cbt-kkm]');
        kkmInput.value = '80';
        const durationInput = modal.querySelector('[data-cbt-duration]');
        durationInput.value = '45';
        const violationsInput = modal.querySelector('[data-cbt-violations]');
        violationsInput.value = '4';
        const shuffleQ = modal.querySelector('[data-cbt-shuffle-q]');
        shuffleQ.checked = true;

        // Click save
        modal.querySelector('[data-cbt-save]').click();

        // Modal closed
        expect(document.getElementById('lms-quiz-settings-modal')).toBeNull();

        // Card DOM inputs updated
        expect(card.querySelector('.lms-quiz-mode').value).toBe('strict');
        expect(card.querySelector('.lms-quiz-kkm').value).toBe('80');
        expect(card.querySelector('.lms-quiz-time').value).toBe('45');
        expect(card.querySelector('.lms-quiz-retake').checked).toBe(false);
        expect(card.querySelector('.lms-quiz-max-violations').value).toBe('4');
        expect(card.querySelector('.lms-quiz-shuffle-q').value).toBe('1');

        // Card Badge updated
        const badge = card.querySelector('.lms-cbt-badge');
        expect(badge.className).toContain('lm-badge-cbt-strict');
        expect(badge.textContent).toBe('🛡️ CBT (45 mnt · KKM 80 · 1x · Maks. 4x)');

        expect(changed).toBe(true);
        expect(notifyMock).toHaveBeenCalledWith(
            'Pengaturan Kuis / CBT Disimpan',
            expect.stringContaining('CBT'),
            'success'
        );
    });

    test('4. Applying Kuis (relaxed) settings allows time 0 (bebas) and preserves retake toggle', () => {
        // Pre-configure card as CBT
        card.querySelector('.lms-quiz-mode').value = 'strict';
        card.querySelector('.lms-quiz-kkm').value = '70';
        card.querySelector('.lms-quiz-time').value = '60';
        card.querySelector('.lms-quiz-retake').checked = false;

        window.openLmsQuizSettingsModal(card);
        const modal = document.getElementById('lms-quiz-settings-modal');

        // Switch to Kuis
        modal.querySelector('input[name="cbt_modal_mode"][value="relaxed"]').checked = true;
        modal.querySelector('input[name="cbt_modal_mode"][value="relaxed"]').dispatchEvent(new Event('change'));

        const durationInput = modal.querySelector('[data-cbt-duration]');
        durationInput.value = '0'; // Bebas
        const retakeCheckbox = modal.querySelector('[data-cbt-retake]');
        retakeCheckbox.checked = true;

        modal.querySelector('[data-cbt-save]').click();

        expect(card.querySelector('.lms-quiz-mode').value).toBe('relaxed');
        expect(card.querySelector('.lms-quiz-time').value).toBe('0');
        expect(card.querySelector('.lms-quiz-retake').checked).toBe(true);

        const badge = card.querySelector('.lms-cbt-badge');
        expect(badge.className).toContain('lm-badge-cbt-relaxed');
        expect(badge.textContent).toBe('☕ Kuis (Bebas · KKM 70 · Boleh Ulang)');
    });

    test('5. Validations: Rejects invalid KKM and duration < 5 in CBT mode with warning notification', () => {
        window.openLmsQuizSettingsModal(card);
        const modal = document.getElementById('lms-quiz-settings-modal');

        // Case A: Invalid KKM (> 100)
        modal.querySelector('[data-cbt-kkm]').value = '150';
        modal.querySelector('[data-cbt-save]').click();
        expect(notifyMock).toHaveBeenCalledWith('Batas ketuntasan tidak valid', expect.any(String), 'warning');
        expect(document.getElementById('lms-quiz-settings-modal')).not.toBeNull();

        // Fix KKM
        modal.querySelector('[data-cbt-kkm]').value = '75';

        // Case B: CBT with duration < 5
        modal.querySelector('input[name="cbt_modal_mode"][value="strict"]').checked = true;
        modal.querySelector('input[name="cbt_modal_mode"][value="strict"]').dispatchEvent(new Event('change'));
        modal.querySelector('[data-cbt-duration]').value = '3';
        modal.querySelector('[data-cbt-save]').click();

        expect(notifyMock).toHaveBeenCalledWith('Durasi tidak valid', expect.stringContaining('minimal 5 menit'), 'warning');
        expect(document.getElementById('lms-quiz-settings-modal')).not.toBeNull();
    });
});
