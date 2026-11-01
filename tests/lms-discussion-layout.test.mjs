/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import fs from 'node:fs';
import { installLmsDiscussionLayout } from '../js/lms-discussion-layout.mjs';

test('follows the visible screen as the keyboard opens, moves, and closes; installing twice shares listeners', () => {
    const viewport = new EventTarget();
    viewport.height = 760; viewport.offsetTop = 0;
    const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    const modal = document.createElement('div');
    const listen = jest.spyOn(viewport, 'addEventListener');
    const dispose = installLmsDiscussionLayout(modal);
    expect(modal.style.getPropertyValue('--lms-discussion-height')).toBe('760px');
    viewport.height = 320; viewport.offsetTop = 60; viewport.dispatchEvent(new Event('resize'));
    expect(modal.style.getPropertyValue('--lms-discussion-height')).toBe('320px');
    expect(modal.style.getPropertyValue('--lms-discussion-top')).toBe('60px');
    expect(installLmsDiscussionLayout(modal)).toBe(dispose);
    expect(listen).toHaveBeenCalledTimes(2);
    viewport.height = 760; viewport.offsetTop = 0; viewport.dispatchEvent(new Event('scroll'));
    expect(modal.style.getPropertyValue('--lms-discussion-height')).toBe('760px');
    dispose();
    viewport.height = 200; viewport.dispatchEvent(new Event('resize'));
    expect(modal.style.getPropertyValue('--lms-discussion-height')).toBe('');
    listen.mockRestore();
    if (original) Object.defineProperty(window, 'visualViewport', original);
    else delete window.visualViewport;
});
test('falls back to window resizing when VisualViewport is unavailable', () => {
    const modal = document.createElement('div');
    const dispose = installLmsDiscussionLayout(modal);
    expect(modal.style.getPropertyValue('--lms-discussion-height')).toBe(`${window.innerHeight}px`);
    window.dispatchEvent(new Event('resize'));
    expect(modal.style.getPropertyValue('--lms-discussion-top')).toBe('0px');
    dispose();
    expect(() => installLmsDiscussionLayout(null)()).not.toThrow();
});
test.each([
    ['portal-siswa.html', 'modal-student-lms-discussion', 'student-lms-prompt-container', 'student-lms-comments-list', 'input-student-lms-content'],
    ['guru-mapel.html', 'modal-lms-discussion', 'lms-discussion-prompt-container', 'lms-discussion-comments-list', 'input-lms-discussion-content']
])('keeps the real composer outside the scrollable prompt and comments: %s', (file, id, prompt, comments, input) => {
    const doc = new DOMParser().parseFromString(fs.readFileSync(file, 'utf8'), 'text/html');
    const modal = doc.getElementById(id), body = modal.querySelector('.lms-discussion-body');
    expect(body.contains(doc.getElementById(prompt))).toBe(true);
    expect(body.contains(doc.getElementById(comments))).toBe(true);
    expect(body.contains(doc.getElementById(input))).toBe(false);
    expect(modal.querySelector('.lms-discussion-composer').contains(doc.getElementById(input))).toBe(true);
});
