const layouts = new WeakMap();

/** Fit the fixed dialog to the visible viewport, including the phone keyboard. */
export function installLmsDiscussionLayout(modal) {
    if (!modal) return () => {};
    const existing = layouts.get(modal);
    if (existing) { existing.update(); return existing.dispose; }
    const view = modal.ownerDocument.defaultView;
    if (!view) return () => {};
    const viewport = view.visualViewport;
    const update = () => {
        const height = Number(viewport?.height || view.innerHeight);
        const top = Number(viewport?.offsetTop || 0);
        if (Number.isFinite(height) && height > 0) modal.style.setProperty('--lms-discussion-height', `${height}px`);
        if (Number.isFinite(top)) modal.style.setProperty('--lms-discussion-top', `${Math.max(0, top)}px`);
    };
    const dispose = () => {
        view.removeEventListener('resize', update);
        viewport?.removeEventListener('resize', update);
        viewport?.removeEventListener('scroll', update);
        modal.style.removeProperty('--lms-discussion-height');
        modal.style.removeProperty('--lms-discussion-top');
        layouts.delete(modal);
    };
    layouts.set(modal, { update, dispose });
    view.addEventListener('resize', update);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    update();
    return dispose;
}
