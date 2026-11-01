export function installLmsResourceFullscreen({modal=document.getElementById('modal-student-resource'),button=document.getElementById('btn-student-resource-fullscreen'),exposeGlobals=true} = {}) {
    if (!modal || !button) return { dispose() {} };
    let expanded = false;
    let nativeActive = false;
    let generation = 0;
    const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
    const render = () => {
        modal.classList.toggle('is-fullscreen', expanded);
        modal.dataset.fullscreenMode = expanded ? (fullscreenElement() === modal ? 'native' : 'page') : '';
        button.setAttribute('aria-pressed', String(expanded));
        button.title = expanded ? 'Keluar dari fullscreen' : 'Buka materi dalam fullscreen';
        button.setAttribute('aria-label', button.title);
        const label = button.querySelector('[data-fullscreen-label]');
        if (label) label.textContent = expanded ? 'Keluar' : 'Fullscreen';
        const icon = button.querySelector('i');
        if (icon) icon.className = `fa-solid ${expanded ? 'fa-compress' : 'fa-expand'}`;
    };
    async function exitNative() {
        if (fullscreenElement() !== modal) return;
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) try { await exit.call(document); } catch (_) { /* CSS layout can still be restored. */ }
    }
    async function exit() {
        generation++;
        expanded = false;
        button.disabled = false;
        render();
        await exitNative();
    }
    async function toggle() {
        if (expanded || fullscreenElement() === modal) return exit();
        if (modal.classList.contains('hidden') || button.disabled || button.classList.contains('hidden')) return;
        const token = ++generation;
        expanded = true;
        button.disabled = true;
        render();
        const request = modal.requestFullscreen || modal.webkitRequestFullscreen;
        try { if (request) await request.call(modal); }
        catch (_) { /* Mobile browsers and embedded windows may need the page fallback. */ }
        if (token !== generation || modal.classList.contains('hidden')) {
            await exitNative();
            return;
        }
        button.disabled = false;
        render();
    }
    const changed = () => {
        if (fullscreenElement() === modal) { nativeActive = true; expanded = true; }
        else if (nativeActive) { nativeActive = false; expanded = false; }
        render();
    };
    const escape = event => {
        if (event.key === 'Escape' && expanded) {
            event.preventDefault();
            event.stopImmediatePropagation();
            void exit();
        }
    };
    if(exposeGlobals){window.toggleStudentResourceFullscreen = toggle;window.resetStudentResourceFullscreen = exit;}
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('webkitfullscreenchange', changed);
    window.addEventListener('keydown', escape, true);
    render();
    return { exit, toggle, dispose() {
        void exit();
        document.removeEventListener('fullscreenchange', changed);
        document.removeEventListener('webkitfullscreenchange', changed);
        window.removeEventListener('keydown', escape, true);
    } };
}
