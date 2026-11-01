/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { startIdleSessionMonitor } from '../js/session-activity.mjs';

const hour = 3600000;
let monitors;
beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-15T02:00:00Z'));
    monitors = [];
});
afterEach(() => { monitors.forEach(monitor => monitor.stop()); jest.useRealTimers(); });

function tab(shared = new Map(), user = { uid: 'student-1' }, restricted = false) {
    const windowObject = new EventTarget();
    const writes = jest.fn((key, value) => { if (restricted) throw new Error('Storage unavailable'); shared.set(key, value); });
    windowObject.localStorage = {
        getItem: key => { if (restricted) throw new Error('Storage unavailable'); return shared.get(key) ?? null; },
        setItem: writes
    };
    const documentObject = document.implementation.createHTMLDocument('Session test');
    Object.defineProperty(documentObject, 'visibilityState', { value: 'visible', configurable: true });
    const auth = { currentUser: user };
    let listener;
    const unsubscribe = jest.fn();
    const onTimeout = jest.fn();
    const monitor = startIdleSessionMonitor({
        auth, windowObject, documentObject, onTimeout,
        subscribeAuth: (_auth, callback) => { listener = callback; return unsubscribe; }
    });
    monitors.push(monitor);
    return { auth, window: windowObject, document: documentObject, onTimeout, writes, monitor, unsubscribe,
        changeUser(next) { auth.currentUser = next; listener(next); } };
}

test('genuine inactivity still logs out once after one hour', async () => {
    const h = tab();
    await jest.advanceTimersByTimeAsync(hour - 1);
    expect(h.onTimeout).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(h.onTimeout).toHaveBeenCalledWith(h.auth.currentUser);
    await jest.advanceTimersByTimeAsync(hour);
    expect(h.onTimeout).toHaveBeenCalledTimes(1);
});

test('an old tab checks shared activity even if it missed storage events while suspended', async () => {
    const shared = new Map();
    const old = tab(shared);
    const active = tab(shared);
    await jest.advanceTimersByTimeAsync(hour - 60000);
    active.document.dispatchEvent(new Event('touchstart'));
    await jest.advanceTimersByTimeAsync(60000);
    expect(old.onTimeout).not.toHaveBeenCalled();
    expect(active.onTimeout).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(hour - 60000);
    expect(old.onTimeout).toHaveBeenCalledTimes(1);
    expect(active.onTimeout).toHaveBeenCalledTimes(1);
});

test('scrolling a nested panel counts even though scroll does not bubble', async () => {
    const h = tab();
    const panel = h.document.createElement('div');
    h.document.body.appendChild(panel);
    await jest.advanceTimersByTimeAsync(hour - 1000);
    panel.dispatchEvent(new Event('scroll', { bubbles: false }));
    await jest.advanceTimersByTimeAsync(1000);
    expect(h.onTimeout).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(hour - 1000);
    expect(h.onTimeout).toHaveBeenCalledTimes(1);
});

test('suspending an old tab cannot overwrite newer activity from another tab', async () => {
    const shared = new Map();
    const old = tab(shared);
    const active = tab(shared);
    await jest.advanceTimersByTimeAsync(hour - 1000);
    active.document.dispatchEvent(new Event('click'));
    old.window.dispatchEvent(new Event('pagehide'));
    await jest.advanceTimersByTimeAsync(1000);
    expect(old.onTimeout).not.toHaveBeenCalled();
    expect(active.onTimeout).not.toHaveBeenCalled();
});

test('frequent touch movement does not write storage for every event', async () => {
    const h = tab();
    await jest.advanceTimersByTimeAsync(1000);
    for (let i = 0; i < 100; i++) h.document.dispatchEvent(new Event('touchmove'));
    expect(h.writes).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5000);
    h.document.dispatchEvent(new Event('touchmove'));
    expect(h.writes).toHaveBeenCalledTimes(2);
});

test('restricted storage falls back to local activity without breaking the page', async () => {
    const h = tab(new Map(), { uid: 'student-1' }, true);
    await jest.advanceTimersByTimeAsync(hour - 1000);
    h.document.dispatchEvent(new Event('input'));
    await jest.advanceTimersByTimeAsync(1000);
    expect(h.onTimeout).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(hour - 1000);
    expect(h.onTimeout).toHaveBeenCalledTimes(1);
});

test('a new login gets a fresh interval rather than inheriting the previous account timer', async () => {
    const h = tab();
    await jest.advanceTimersByTimeAsync(hour - 1000);
    h.changeUser({ uid: 'student-2' });
    await jest.advanceTimersByTimeAsync(1000);
    expect(h.onTimeout).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(hour - 1000);
    expect(h.onTimeout).toHaveBeenCalledWith({ uid: 'student-2' });
});

test('another account activity cannot extend this account session', async () => {
    const shared = new Map();
    const first = tab(shared);
    const other = tab(shared, { uid: 'student-2' });
    await jest.advanceTimersByTimeAsync(hour - 1000);
    other.document.dispatchEvent(new Event('click'));
    await jest.advanceTimersByTimeAsync(1000);
    expect(first.onTimeout).toHaveBeenCalledTimes(1);
    expect(other.onTimeout).not.toHaveBeenCalled();
});

test('returning from a suspended page rechecks the actual elapsed time', () => {
    const h = tab();
    jest.setSystemTime(Date.now() + hour + 1000);
    h.window.dispatchEvent(new Event('pageshow'));
    expect(h.onTimeout).toHaveBeenCalledTimes(1);
});

test('auth restoration starts the interval only once a user is ready; stop removes the monitor', async () => {
    const h = tab(new Map(), null);
    await jest.advanceTimersByTimeAsync(hour);
    expect(h.onTimeout).not.toHaveBeenCalled();
    h.changeUser({ uid: 'restored-student' });
    await jest.advanceTimersByTimeAsync(hour - 1);
    h.monitor.stop();
    await jest.advanceTimersByTimeAsync(hour);
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.onTimeout).not.toHaveBeenCalled();
});
