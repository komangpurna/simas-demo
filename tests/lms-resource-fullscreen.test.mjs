/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { installLmsResourceFullscreen } from '../js/lms-resource-fullscreen.mjs';
let controller, active, modal, button;
beforeEach(() => {
    active = null;
    document.body.innerHTML = '<div id="modal-student-resource"><div class="student-resource-panel"><button id="btn-student-resource-fullscreen"><i></i><span data-fullscreen-label>Fullscreen</span></button><iframe srcdoc="<button>Materi</button>"></iframe></div></div>';
    modal = document.getElementById('modal-student-resource');
    button = document.getElementById('btn-student-resource-fullscreen');
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => active });
    document.exitFullscreen = jest.fn(async () => { active = null; document.dispatchEvent(new Event('fullscreenchange')); });
    controller = installLmsResourceFullscreen();
});
afterEach(() => { controller.dispose(); delete document.exitFullscreen; jest.restoreAllMocks(); });
test('native fullscreen toggles, responds to browser exit and preserves the same iframe', async () => {
    const frame = modal.querySelector('iframe');
    modal.requestFullscreen = jest.fn(async () => { active = modal; document.dispatchEvent(new Event('fullscreenchange')); });
    await controller.toggle();
    expect(modal.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(modal.dataset.fullscreenMode).toBe('native');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(modal.querySelector('iframe')).toBe(frame);
    active = null; document.dispatchEvent(new Event('fullscreenchange'));
    expect(modal.classList.contains('is-fullscreen')).toBe(false);
    expect(button.textContent).toContain('Fullscreen');
});
test('denied fullscreen falls back to the page layout; Escape exits without closing the material', async () => {
    const frame = modal.querySelector('iframe'), source = frame.srcdoc;
    modal.requestFullscreen = jest.fn(async () => { throw new Error('Fullscreen denied'); });
    const close = jest.fn(); window.addEventListener('keydown', close);
    await controller.toggle();
    expect(modal.dataset.fullscreenMode).toBe('page');
    expect(frame.srcdoc).toBe(source);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(modal.classList.contains('is-fullscreen')).toBe(false);
    expect(modal.classList.contains('hidden')).toBe(false);
    expect(close).not.toHaveBeenCalled(); window.removeEventListener('keydown', close);
});
test('closing while a native request is pending also exits the late fullscreen response', async () => {
    let resolve;
    modal.requestFullscreen = jest.fn(() => new Promise(r => { resolve = () => { active = modal; document.dispatchEvent(new Event('fullscreenchange')); r(); }; }));
    const entering = controller.toggle();
    await controller.exit(); modal.classList.add('hidden'); resolve(); await entering;
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(modal.classList.contains('is-fullscreen')).toBe(false);
    expect(button.disabled).toBe(false);
});
test('the exit button leaves native fullscreen; hidden media does not enter fullscreen', async () => {
    button.classList.add('hidden'); modal.requestFullscreen = jest.fn();
    await controller.toggle(); expect(modal.requestFullscreen).not.toHaveBeenCalled();
    button.classList.remove('hidden');
    modal.requestFullscreen.mockImplementation(async () => { active = modal; document.dispatchEvent(new Event('fullscreenchange')); });
    await controller.toggle(); await controller.toggle();
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-pressed')).toBe('false');
});
