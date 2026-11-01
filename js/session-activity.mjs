// UID-scoped activity coordinates tabs without storing credentials or student data.
export function startIdleSessionMonitor({
    auth, subscribeAuth, onTimeout,
    windowObject = window, documentObject = document,
    timeoutMs = 60 * 60 * 1000
}) {
    const events = ['mousemove', 'keydown', 'input', 'scroll', 'click', 'touchstart', 'touchmove'];
    const listenerOptions = { passive: true, capture: true };
    let uid = null;
    let lastActivity = 0;
    let lastPublished = 0;
    let timer = null;
    let stopped = false;
    let expiring = false;

    const activityKey = () => `simas_session_activity_${uid}`;
    const readActivity = () => {
        try {
            const timestamp = Number(windowObject.localStorage.getItem(activityKey()));
            // Ignore corrupt values and future timestamps after a clock change.
            return Number.isFinite(timestamp) && timestamp > 0 && timestamp <= Date.now() ? timestamp : 0;
        } catch (_) { return 0; }
    };
    const publishActivity = (force = false) => {
        if (!force && lastActivity - lastPublished < 5000) return;
        lastActivity = Math.max(lastActivity, readActivity());
        try {
            windowObject.localStorage.setItem(activityKey(), String(lastActivity));
            lastPublished = lastActivity;
        } catch (_) { /* Local activity still works with restricted browser storage. */ }
    };
    const schedule = () => {
        clearTimeout(timer);
        if (stopped || !uid || expiring) return;
        const latest = Math.max(lastActivity, readActivity());
        timer = setTimeout(checkExpiry, Math.max(0, timeoutMs - (Date.now() - latest)));
    };
    const checkExpiry = () => {
        if (stopped || !uid || expiring || auth.currentUser?.uid !== uid) return;
        lastActivity = Math.max(lastActivity, readActivity());
        if (Date.now() - lastActivity < timeoutMs) {
            schedule();
            return;
        }
        expiring = true;
        clearTimeout(timer);
        // The callback owns the logout UI and redirect.
        void onTimeout(auth.currentUser);
    };
    const recordActivity = () => {
        if (stopped || !uid || expiring || auth.currentUser?.uid !== uid) return;
        lastActivity = Date.now();
        publishActivity();
        schedule();
    };
    const syncUser = user => {
        if (stopped || (user?.uid || null) === uid) return;
        clearTimeout(timer);
        uid = user?.uid || null;
        expiring = false;
        lastPublished = 0;
        if (!uid) return;
        // A fresh login or navigation starts its own full inactivity interval.
        lastActivity = Date.now();
        publishActivity(true);
        schedule();
    };
    const onStorage = event => {
        if (uid && event.key === activityKey()) schedule();
    };
    const onVisible = () => {
        if (documentObject.visibilityState !== 'hidden') checkExpiry();
    };

    events.forEach(event => documentObject.addEventListener(event, recordActivity, listenerOptions));
    documentObject.addEventListener('visibilitychange', onVisible);
    windowObject.addEventListener('storage', onStorage);
    windowObject.addEventListener('pageshow', onVisible);
    windowObject.addEventListener('focus', onVisible);
    // Flush throttled activity before Safari suspends this document.
    const onPageHide = () => { if (uid && !expiring) publishActivity(true); };
    windowObject.addEventListener('pagehide', onPageHide);
    syncUser(auth.currentUser);
    const unsubscribe = subscribeAuth(auth, syncUser);

    return {
        stop() {
            if (stopped) return;
            stopped = true;
            clearTimeout(timer);
            unsubscribe();
            events.forEach(event => documentObject.removeEventListener(event, recordActivity, listenerOptions));
            documentObject.removeEventListener('visibilitychange', onVisible);
            windowObject.removeEventListener('storage', onStorage);
            windowObject.removeEventListener('pageshow', onVisible);
            windowObject.removeEventListener('focus', onVisible);
            windowObject.removeEventListener('pagehide', onPageHide);
        }
    };
}
