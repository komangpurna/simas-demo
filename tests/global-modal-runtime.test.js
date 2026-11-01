/** @jest-environment jsdom */

const { loadGlobalModals } = require('./helpers/ui-runtime-source.cjs');

describe.each(['light', 'dark'])('Global modal runtime in %s mode', theme => {
    beforeEach(() => {
        jest.useFakeTimers();
        document.body.innerHTML = '';
        document.documentElement.classList.toggle('dark', theme === 'dark');
        loadGlobalModals();
    });

    afterEach(() => {
        document.getElementById('global-confirm-cancel')?.click();
        document.getElementById('global-alert-ok')?.click();
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
        document.documentElement.classList.remove('dark');
    });

    test.each(['warning', 'danger', 'info', 'unknown'])('confirm %s renders and resolves after OK', async type => {
        const result = window.showConfirmModal('Pesan\nBaris kedua', 'Finalisasi Rencana', type, {
            confirmText: 'Finalisasi Rencana', cancelText: 'Kembali', icon: 'fa-check'
        });
        const message = document.getElementById('global-confirm-message');
        expect(message.textContent).toBe('Pesan\nBaris kedua');
        expect(document.getElementById('global-confirm-title').textContent).toBe('Finalisasi Rencana');
        expect(document.getElementById('global-confirm-ok').textContent.trim()).toBe('Finalisasi Rencana');
        expect(document.getElementById('global-confirm-cancel').textContent.trim()).toBe('Kembali');
        expect(message.style.color).toBe(theme === 'dark' ? 'rgb(148, 163, 184)' : 'rgb(100, 116, 139)');
        jest.advanceTimersByTime(20);
        expect(document.getElementById('global-confirm-overlay').style.opacity).toBe('1');
        document.getElementById('global-confirm-ok').click();
        jest.runAllTimers();
        await expect(result).resolves.toBe(true);
        expect(document.getElementById('global-confirm-overlay')).toBeNull();
    });

    test.each(['cancel', 'backdrop', 'Escape'])('confirm dismisses with %s', async action => {
        const result = window.showConfirmModal('Batalkan?');
        if (action === 'cancel') document.getElementById('global-confirm-cancel').click();
        if (action === 'backdrop') document.getElementById('global-confirm-overlay').click();
        if (action === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        jest.runAllTimers();
        await expect(result).resolves.toBe(false);
    });

    test.each(['success', 'error', 'warning', 'info', 'unknown'])('alert %s supports rich message markup', async type => {
        // Block content previously invalidated the surrounding <p> in alert HTML.
        const result = window.showAlertModal('Informasi', '<div>Isi <strong>pesan</strong></div><p>Rincian</p>', type);
        const message = document.getElementById('global-alert-message');
        expect(message.querySelector('strong').textContent).toBe('pesan');
        expect(message.querySelector('p').textContent).toBe('Rincian');
        expect(message.style.color).toBe(theme === 'dark' ? 'rgb(148, 163, 184)' : 'rgb(100, 116, 139)');
        document.getElementById('global-alert-ok').click();
        jest.runAllTimers();
        await expect(result).resolves.toBeUndefined();
        expect(document.getElementById('global-alert-overlay')).toBeNull();
    });

    test.each(['backdrop', 'Escape'])('alert dismisses with %s', async action => {
        const result = window.showAlertModal('Informasi', 'Isi pesan');
        if (action === 'backdrop') document.getElementById('global-alert-overlay').click();
        if (action === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        jest.runAllTimers();
        await expect(result).resolves.toBeUndefined();
    });

    test('card clicks leave the confirmation pending', async () => {
        const result = window.showConfirmModal('Isi pesan');
        const settled = jest.fn();
        result.then(settled);
        document.getElementById('global-confirm-card').click();
        jest.runAllTimers();
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();
        document.getElementById('global-confirm-cancel').click();
        jest.runAllTimers();
        await expect(result).resolves.toBe(false);
    });

    test('rapid replacement cancels the old confirm and keeps the new one usable', async () => {
        const first = window.showConfirmModal('Pertama');
        const second = window.showConfirmModal('Kedua');
        await expect(first).resolves.toBe(false);
        expect(document.querySelectorAll('#global-confirm-overlay')).toHaveLength(1);
        jest.advanceTimersByTime(20);
        document.getElementById('global-confirm-ok').click();
        jest.runAllTimers();
        await expect(second).resolves.toBe(true);
    });

    test('rapid replacement settles the old alert', async () => {
        const first = window.showAlertModal('Pertama', 'Isi');
        const second = window.showAlertModal('Kedua', 'Isi');
        await expect(first).resolves.toBeUndefined();
        expect(document.querySelectorAll('#global-alert-overlay')).toHaveLength(1);
        document.getElementById('global-alert-ok').click();
        jest.runAllTimers();
        await expect(second).resolves.toBeUndefined();
    });

    test('the first close action wins even before the opening animation', async () => {
        const result = window.showConfirmModal('Isi');
        document.getElementById('global-confirm-ok').click();
        document.getElementById('global-confirm-cancel').click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        jest.advanceTimersByTime(20);
        expect(document.getElementById('global-confirm-overlay').style.opacity).toBe('0');
        jest.runAllTimers();
        await expect(result).resolves.toBe(true);
    });

    test('replacement during closing preserves the decision and removes stale timers', async () => {
        const first = window.showConfirmModal('Pertama');
        document.getElementById('global-confirm-ok').click();
        const second = window.showConfirmModal('Kedua');
        await expect(first).resolves.toBe(true);
        jest.advanceTimersByTime(300);
        expect(document.getElementById('global-confirm-message').textContent).toBe('Kedua');
        document.getElementById('global-confirm-cancel').click();
        jest.runAllTimers();
        await expect(second).resolves.toBe(false);
    });

    test.each(['confirm', 'alert'])('%s removes its Escape listener on button close and replacement', async kind => {
        const add = jest.spyOn(document, 'addEventListener');
        const remove = jest.spyOn(document, 'removeEventListener');
        const open = () => kind === 'confirm' ? window.showConfirmModal('Isi') : window.showAlertModal('Judul', 'Isi');
        const first = open();
        const second = open();
        document.getElementById(`global-${kind}-ok`).click();
        jest.runAllTimers();
        await Promise.all([first, second]);
        const handlers = add.mock.calls.filter(([event]) => event === 'keydown').map(([, handler]) => handler);
        expect(handlers).toHaveLength(2);
        handlers.forEach(handler => expect(remove).toHaveBeenCalledWith('keydown', handler));
        expect(jest.getTimerCount()).toBe(0);
    });

    test('Escape closes only the topmost global dialog', async () => {
        const confirm = window.showConfirmModal('Konfirmasi');
        const alert = window.showAlertModal('Informasi', 'Isi');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        jest.runAllTimers();
        await expect(alert).resolves.toBeUndefined();
        expect(document.getElementById('global-confirm-overlay')).not.toBeNull();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        jest.runAllTimers();
        await expect(confirm).resolves.toBe(false);
    });
});
