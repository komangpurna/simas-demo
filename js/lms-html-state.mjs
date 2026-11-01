// Only material data crosses this bridge. The opaque iframe never receives app storage.
export const LMS_HTML_DRAFT_LIMIT = 256 * 1024;
const draftPrefix = 'simas_lms_html_draft_v1:';
const sessionPrefix = 'simas_lms_html_open_v1:';

export function lmsHtmlRevision(code) {
    let a = 2166136261, b = 5381;
    for (let i = 0; i < code.length; i++) {
        a = Math.imul(a ^ code.charCodeAt(i), 16777619);
        b = Math.imul(b, 33) ^ code.charCodeAt(i);
    }
    return `${code.length}-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}

function safeRead(storage, key) {
    try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
}

export function readLmsHtmlSession(nis, storage) {
    try { storage ??= window.sessionStorage; } catch { return null; }
    const value = safeRead(storage, sessionPrefix + encodeURIComponent(nis));
    if (!value || value.nis !== String(nis) || typeof value.materialId !== 'string' ||
        typeof value.revision !== 'string' || !/^sess_[\w-]{1,95}$/.test(value.sessionId) ||
        !Number.isFinite(value.activeSeconds) || value.activeSeconds < 0 || value.activeSeconds > 86400 ||
        !Number.isFinite(value.updatedAt) || Date.now() - value.updatedAt > 12 * 3600000 || value.updatedAt > Date.now() + 60000) return null;
    return value;
}

export function writeLmsHtmlSession(session, storage) {
    if (!session?.htmlRevision) return;
    try {
        storage ??= window.sessionStorage;
        storage.setItem(sessionPrefix + encodeURIComponent(session.studentNis), JSON.stringify({
            nis: String(session.studentNis), materialId: session.materialId, revision: session.htmlRevision,
            sessionId: session.sessionId, activeSeconds: session.activeSeconds, updatedAt: Date.now()
        }));
    } catch { /* Tracking still works when browser storage is unavailable. */ }
}

export function clearLmsHtmlSession(nis, storage) {
    try { (storage || window.sessionStorage).removeItem(sessionPrefix + encodeURIComponent(nis)); } catch { /* optional cache */ }
}

function cleanState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    try {
        const json = JSON.stringify(value);
        if (new TextEncoder().encode(json).byteLength > LMS_HTML_DRAFT_LIMIT) return null;
        const state = JSON.parse(json);
        if (!state.forms || typeof state.forms !== 'object' || Array.isArray(state.forms) ||
            !state.local || typeof state.local !== 'object' || Array.isArray(state.local) ||
            !state.session || typeof state.session !== 'object' || Array.isArray(state.session)) return null;
        for (const map of [state.local, state.session]) {
            if (Object.values(map).some(v => typeof v !== 'string')) return null;
        }
        return { forms: state.forms, local: state.local, session: state.session, custom: state.custom ?? null };
    } catch { return null; }
}

export function attachLmsHtmlState(frame, { nis, materialId, code, onStatus = () => {}, getStudentId = () => nis,
    storage, eventTarget = window } = {}) {
    const key = draftPrefix + [nis, materialId, lmsHtmlRevision(code)].map(encodeURIComponent).join(':');
    let cache = storage, available = true;
    try { cache ??= window.localStorage; } catch { available = false; }
    const stored = available ? safeRead(cache, key) : null;
    const seed = cleanState(stored?.state) || { forms: {}, local: {}, session: {}, custom: null };
    const channel = globalThis.crypto?.randomUUID?.() || `draft_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let active = true, lastJson = '';
    const status = value => { try { onStatus(value); } catch { /* UI status is optional. */ } };
    const receive = event => {
        if (!active || event.source !== frame.contentWindow || event.origin !== 'null' ||
            event.data?.type !== 'simas-lms-html-state' || event.data.channel !== channel ||
            String(getStudentId()) !== String(nis)) return;
        const state = cleanState(event.data.state);
        if (!state || event.data.error) { status('failed'); return; }
        try {
            if (!available) throw new Error('Storage unavailable');
            const json = JSON.stringify(state);
            if (json !== lastJson) cache.setItem(key, JSON.stringify({ state, updatedAt: Date.now() }));
            lastJson = json;
            status('saved');
        } catch { status('failed'); }
    };
    eventTarget.addEventListener('message', receive);
    status(available ? (stored ? 'restoring' : 'ready') : 'failed');
    return { bootstrap: { channel, state: seed, limit: LMS_HTML_DRAFT_LIMIT }, dispose() {
        active = false; eventTarget.removeEventListener('message', receive);
    } };
}

// Serialized into srcdoc before author scripts. No imports or parent DOM access.
function htmlStateBootstrap(config) {
    try {
        const state = config.state || { forms: {}, local: {}, session: {}, custom: null };
        const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
        const clone = value => JSON.parse(JSON.stringify(value));
        const forms = Object.assign(Object.create(null), state.forms);
        const local = Object.assign(Object.create(null), state.local);
        const session = Object.assign(Object.create(null), state.session);
        let custom = state.custom ?? null, scheduled = false, restoring = false, initialized = false;
        const handled = new WeakSet();
        function fields() {
            const occurrences = Object.create(null);
            return Array.from(document.querySelectorAll('input,textarea,select,[contenteditable="true"]')).filter(el =>
                !['file', 'password', 'hidden', 'button', 'submit', 'reset', 'image'].includes(el.type)).map(el => {
                const descriptor = JSON.stringify([el.tagName, el.type || '', el.id, el.name || '', el.getAttribute('placeholder') || '',
                    Array.from(el.labels || []).map(label => label.textContent.trim()),
                    el.closest('fieldset')?.querySelector('legend')?.textContent.trim() || '',
                    el.closest('[data-lms-question-id]')?.getAttribute('data-lms-question-id') || '',
                    el.tagName === 'SELECT' ? Array.from(el.options).map(o => [o.value, o.textContent]) :
                        ['radio', 'checkbox'].includes(el.type) ? el.value : '']);
                const index = occurrences[descriptor] || 0;
                occurrences[descriptor] = index + 1;
                return { el, key: descriptor + ':' + index };
            });
        }
        function snapshot() {
            for (const { el, key } of initialized ? fields() : []) {
                forms[key] = el.isContentEditable || el.getAttribute('contenteditable') === 'true' ? { text: el.textContent } :
                    ['radio', 'checkbox'].includes(el.type) ? { checked: el.checked } :
                        el.tagName === 'SELECT' ? { selected: Array.from(el.selectedOptions).map(o => o.value) } : { value: el.value };
            }
            return { forms, local, session, custom };
        }
        function send(error = false) {
            try {
                const data = snapshot();
                const tooLarge = new TextEncoder().encode(JSON.stringify(data)).byteLength > config.limit;
                if (config.channel) parent.postMessage({ type: 'simas-lms-html-state', channel: config.channel,
                    state: tooLarge ? null : data, error: error || tooLarge }, '*');
            } catch { /* A draft failure cannot stop author content. */ }
        }
        function schedule() {
            if (scheduled || restoring) return;
            scheduled = true;
            queueMicrotask(() => { scheduled = false; send(); });
        }
        function makeStorage(map) {
            const api = {
                getItem(key) { key = String(key); return own(map, key) ? map[key] : null; },
                setItem(key, value) {
                    const text = String(value), name = String(key), previous = map[name];
                    map[name] = text;
                    if (new TextEncoder().encode(JSON.stringify(map)).byteLength > config.limit) {
                        if (previous === undefined) delete map[name]; else map[name] = previous;
                        send(true); return;
                    }
                    schedule();
                },
                removeItem(key) { delete map[String(key)]; schedule(); },
                clear() { for (const key of Object.keys(map)) delete map[key]; schedule(); },
                key(index) { return Object.keys(map)[Number(index)] ?? null; }
            };
            return new Proxy(api, {
                get(target, prop) { return prop === 'length' ? Object.keys(map).length : own(target, prop) ? target[prop] : map[prop]; },
                set(_target, prop, value) { api.setItem(prop, value); return true; },
                deleteProperty(_target, prop) { api.removeItem(prop); return true; },
                ownKeys() { return Object.keys(map); },
                getOwnPropertyDescriptor(_target, prop) { return own(map, prop) ? { configurable: true, enumerable: true, writable: true, value: map[prop] } : undefined; }
            });
        }
        for (const [name, map] of [['localStorage', local], ['sessionStorage', session]]) {
            try { Object.defineProperty(window, name, { configurable: true, value: makeStorage(map) }); } catch { /* SDK remains available */ }
        }
        window.SimasLmsState = Object.freeze({
            load() { try { return clone(custom); } catch { return null; } },
            save(value) { try { const copy = clone(value); if (new TextEncoder().encode(JSON.stringify(copy)).byteLength > config.limit) return false;
                custom = copy; schedule(); return true; } catch { return false; } },
            clear() { custom = null; schedule(); }
        });
        function restore() {
            restoring = true;
            try {
                for (const { el, key } of fields()) {
                    if (handled.has(el) || !own(forms, key)) continue;
                    const value = forms[key];
                    if (!value || typeof value !== 'object') continue;
                    handled.add(el);
                    if (typeof value.checked === 'boolean' && ['radio', 'checkbox'].includes(el.type)) el.checked = value.checked;
                    else if (Array.isArray(value.selected) && el.tagName === 'SELECT') {
                        for (const option of el.options) option.selected = value.selected.includes(option.value);
                    } else if (typeof value.text === 'string' && el.getAttribute('contenteditable') === 'true') el.textContent = value.text;
                    else if (typeof value.value === 'string' && 'value' in el) el.value = value.value;
                    else continue;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } catch { /* Invalid fields or authored handlers must not break the bridge. */ }
            finally { restoring = false; }
        }
        for (const type of ['input', 'change']) document.addEventListener(type, event => {
            if (restoring) return;
            handled.add(event.target); schedule();
        }, true);
        document.addEventListener('reset', () => setTimeout(() => send(), 0), true);
        function ready() {
            setTimeout(() => {
                restore(); initialized = true; send();
                new MutationObserver(() => restore()).observe(document.body, { childList: true, subtree: true });
                setInterval(() => send(), 1000);
                window.dispatchEvent(new Event('simas-lms-state-ready'));
            }, 0);
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true }); else ready();
        window.addEventListener('pagehide', () => send());
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send(); });
    } catch { /* Bootstrap is optional: render the teacher's HTML even if it fails. */ }
}

export function createLmsHtmlStateScript(config = { channel: null, state: null, limit: LMS_HTML_DRAFT_LIMIT }) {
    const seed = JSON.stringify(config).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return `<script>(${htmlStateBootstrap.toString()})(${seed});</script>`;
}
