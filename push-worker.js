/* Native Web Push: satu handler untuk foreground, background, dan klik. */
function openPushState() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('simas-push-state', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('state');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function storePushOwner(uid) {
    const db = await openPushState();
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction('state', 'readwrite');
            tx.objectStore('state').put(uid, 'owner');
            tx.oncomplete = resolve;
            tx.onerror = tx.onabort = () => reject(tx.error);
        });
    } finally { db.close(); }
}

async function acceptPushMessage(data) {
    const db = await openPushState();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction('state', 'readwrite');
            const store = tx.objectStore('state');
            let accepted = false;
            const owner = store.get('owner');
            owner.onsuccess = () => {
                if (data.recipientUid && owner.result && data.recipientUid !== owner.result) return;
                const recent = store.get('recent');
                recent.onsuccess = () => {
                    const entries = (recent.result || []).filter(item => Date.now() - item.at < 7 * 86400000);
                    // Dedupe berdasarkan job + akun, bukan judul atau isi pesan.
                    const key = data.jobId ? `${data.recipientUid || ''}:${data.jobId}` : '';
                    if (key && entries.some(item => item.key === key)) return;
                    accepted = true;
                    if (key) store.put([...entries, { key, at: Date.now() }].slice(-500), 'recent');
                };
            };
            tx.oncomplete = () => resolve(accepted);
            tx.onerror = tx.onabort = () => reject(tx.error);
        });
    } finally { db.close(); }
}

self.addEventListener('message', event => {
    if (event.data?.type !== 'SIMAS_PUSH_OWNER' || !event.data.uid) return;
    // Hanya halaman dari origin aplikasi yang boleh memperbarui binding lokal.
    if (!event.source?.url || new URL(event.source.url).origin !== self.location.origin) return;
    event.waitUntil(storePushOwner(String(event.data.uid)).then(() => {
        event.ports[0]?.postMessage({ success: true });
    }).catch(error => {
        console.warn('[Push SW] Gagal menyimpan pemilik:', error);
        event.ports[0]?.postMessage({ success: false });
    }));
});

function pushTargetUrl(raw) {
    try {
        const url = new URL(raw || './dashboard.html', self.location.origin);
        if (url.origin === self.location.origin && !url.username && !url.password) return url.href;
        // Payload backend memakai domain kanonis; pertahankan sesi origin PWA.
        if (url.origin === "https://simas-demo-5ead3.web.app") return new URL(url.pathname + url.search + url.hash, self.location.origin).href;
    } catch (_) { /* fallback */ }
    return new URL('/dashboard.html', self.location.origin).href;
}

function deliverToForeground(client, payload) {
    return new Promise(resolve => {
        const channel = new MessageChannel();
        const finish = handled => { clearTimeout(timer); channel.port1.close(); resolve(handled); };
        const timer = setTimeout(() => finish(false), 700);
        channel.port1.onmessage = event => finish(event.data?.handled === true);
        try { client.postMessage({ type: 'SIMAS_PUSH_FOREGROUND', payload }, [channel.port2]); }
        catch (_) { finish(false); }
    });
}

self.addEventListener('push', event => {
    event.waitUntil((async () => {
        let payload;
        try { payload = event.data?.json(); } catch (_) { return; }
        if (!payload || (!payload.notification && !payload.data)) return;
        const data = payload.data || {};
        try { if (!await acceptPushMessage(data)) return; }
        catch (error) { console.warn('[Push SW] Penyimpanan dedupe tidak tersedia:', error); }
        const title = payload.notification?.title || data.title || 'Notifikasi SIMAS';
        const body = payload.notification?.body || data.body || '';
        const url = pushTargetUrl(data.url);
        // Push sistem wajib tampil juga saat aplikasi aktif. ACK toast hanya
        // mengonfirmasi sinkronisasi halaman, bukan pengganti notifikasi perangkat.
        await self.registration.showNotification(title, {
            body,
            icon: new URL('/assets/logo-sekolah.png', self.location.origin).href,
            badge: new URL('/assets/badge-sekolah.png', self.location.origin).href,
            ...(data.jobId ? { tag: `simas-${data.jobId}` } : {}),
            data: { url, recipientUid: data.recipientUid || '' },
            vibrate: [100, 50, 100]
        });
        try {
            const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            const visible = windows.find(client => client.visibilityState === 'visible' && client.focused);
            if (visible) await deliverToForeground(visible, { ...payload, data: { ...data, url }, nativeNotificationShown: true });
        } catch (error) {
            console.warn('[Push SW] Sinkronisasi halaman gagal:', error);
        }
    })());
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil((async () => {
        const url = pushTargetUrl(event.notification.data?.url);
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const exact = windows.find(client => client.url === url && 'focus' in client);
        if (exact) return exact.focus();
        const existing = windows.find(client => new URL(client.url).origin === self.location.origin && 'navigate' in client);
        if (existing) {
            try { const navigated = await existing.navigate(url); if (navigated) return navigated.focus(); }
            catch (_) { /* Buka tab jika tab lama tidak dapat dinavigasi. */ }
        }
        return self.clients.openWindow(url);
    })());
});
