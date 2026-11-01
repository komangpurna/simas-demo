import { getMessaging, getToken, isSupported } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging.js";
import { app, auth } from './config.js';
import { cfClient } from './cloudflare-client.js';

let messaging = null;
let foregroundListenerAttached = false;
let recoveryListenersAttached = false;
let setupInFlight = null;
let lastSetupUid = '';
let lastSetupAt = 0;
let lastSetupSucceeded = false;

function attachPushRecoveryListeners() {
    if (recoveryListenersAttached) return;
    recoveryListenersAttached = true;
    const recover = () => {
        const uid = auth.currentUser?.uid;
        if (!uid || Notification.permission !== 'granted' || document.visibilityState === 'hidden' || navigator.onLine === false) return;
        const interval = lastSetupSucceeded ? 5 * 60 * 1000 : 30 * 1000;
        if (uid === lastSetupUid && Date.now() - lastSetupAt < interval) return;
        return setupPushNotifications(uid);
    };
    window.addEventListener('online', recover);
    window.addEventListener('focus', recover);
    document.addEventListener('visibilitychange', recover);
}

function showPushRegistrationFailure() {
    if (Notification.permission !== 'granted' || !auth.currentUser || document.getElementById('push-registration-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'push-registration-banner';
    banner.className = 'bg-amber-50 dark:bg-amber-950 border border-amber-300 rounded-xl p-4 mb-4 text-sm text-amber-900 dark:text-amber-100';
    banner.innerHTML = '<p>Izin notifikasi sudah diberikan, tetapi perangkat belum berhasil terhubung untuk menerima push.</p><button type="button" class="mt-2 font-bold underline">Hubungkan Ulang</button>';
    banner.querySelector('button').addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try { await setupPushNotifications(auth.currentUser?.uid); }
        finally { button.disabled = false; }
    });
    const container = document.querySelector('main') || document.body;
    container.prepend(banner);
}

/**
 * Memutar suara lonceng/chime halus saat push notification diterima di foreground
 */
function playNotificationChime() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, now); // D5
        gain1.gain.setValueAtTime(0.15, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.3);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(880, now + 0.12); // A5
        gain2.gain.setValueAtTime(0.2, now + 0.12);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.12);
        osc2.stop(now + 0.5);
        osc2.onended = () => ctx.close().catch(() => {});
    } catch (e) {
        console.warn('[Push] Audio chime warning:', e);
    }
}

/**
 * Meminta izin Push Notification secara proaktif dari pengguna
 */
export async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        if (typeof window.showToast === 'function') {
            window.showToast('Tidak Didukung', 'Browser Anda tidak mendukung Web Push Notification.', 'warning');
        }
        return false;
    }

    if (Notification.permission === 'denied') {
        showPushPermissionGuideModal();
        return false;
    }

    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            const result = auth.currentUser ? await setupPushNotifications(auth.currentUser.uid) : null;
            if (typeof window.showToast === 'function') {
                if (result?.success) {
                    window.showToast('Notifikasi Aktif', 'Perangkat berhasil terhubung untuk menerima push notification.', 'success');
                } else {
                    window.showToast('Push Belum Aktif', result?.reason === 'disabled'
                        ? 'Izin diberikan, tetapi pengiriman push sedang dinonaktifkan oleh administrator.'
                        : 'Izin diberikan, tetapi perangkat belum terdaftar untuk menerima push. Silakan hubungkan ulang setelah login dan koneksi tersedia.', 'warning');
                }
            }
            return result?.success === true;
        } else if (permission === 'denied') {
            if (typeof window.showToast === 'function') {
                window.showToast('Izin Ditolak', 'Izin notifikasi ditolak di browser. Menampilkan panduan buka blokir.', 'warning');
            }
            showPushPermissionGuideModal();
            return false;
        }
    } catch (e) {
        console.error('[Push] Gagal meminta izin notifikasi:', e);
    }
    return false;
}

export async function setupPushNotifications(userId = null) {
    const uid = (typeof userId === 'string' && userId.trim()) || auth.currentUser?.uid || '';
    if (setupInFlight?.uid === uid) return setupInFlight.promise;
    const attempt = { uid, promise: null };
    setupInFlight = attempt;
    attempt.promise = (async () => {
        const result = await performPushSetup(uid);
        if (auth.currentUser?.uid === uid) {
            lastSetupUid = uid;
            lastSetupAt = Date.now();
            lastSetupSucceeded = result?.success === true;
            if (result?.success || result?.reason === 'disabled') {
                document.getElementById('push-registration-banner')?.remove();
            } else if (result?.reason === 'error') {
                showPushRegistrationFailure();
            }
        }
        return result;
    })();
    try { return await attempt.promise; }
    finally { if (setupInFlight === attempt) setupInFlight = null; }
}

async function performPushSetup(userId = null) {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker) {
        console.warn('[Push] Service Worker tidak didukung pada browser/konteks ini.');
        return null;
    }

    try {
        // Resolusi UID yang aman — tidak pernah undefined/null
        const targetUid = (typeof userId === 'string' && userId.trim()) 
            ? userId.trim() 
            : (auth.currentUser ? auth.currentUser.uid : null);

        if (!targetUid) {
            console.log('[Push] Setup dilewati: Pengguna belum login.');
            return { success: false, reason: 'unauthenticated' };
        }

        const isIOS = (typeof navigator !== 'undefined') && (/iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
        const isStandalone = (typeof window !== 'undefined') && (window.navigator?.standalone === true || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches));

        const supported = await isSupported();
        if (!supported) {
            console.log('[Push] Browser tidak mendukung push notification.');
            if (isIOS && !isStandalone) {
                checkAndShowPushPermissionBanner();
            }
            return { success: false, reason: 'unsupported' };
        }

        messaging = getMessaging(app);
        attachPushRecoveryListeners();

        // sw.js meneruskan pesan native hanya ke satu tab foreground.
        try {
            if (!foregroundListenerAttached) {
            navigator.serviceWorker.addEventListener('message', event => {
                if (event.data?.type !== 'SIMAS_PUSH_FOREGROUND') return;
                const payload = event.data.payload;
                if (!payload || !auth.currentUser || (payload.data?.recipientUid && payload.data.recipientUid !== auth.currentUser.uid)) {
                    event.ports?.[0]?.postMessage({ handled: true });
                    return;
                }
                console.log('[Push] 🔔 Pesan terdeteksi saat halaman aktif:', payload);
                const title = payload.notification?.title || payload.data?.title || 'Notifikasi SIMAS';
                const body = payload.notification?.body || payload.data?.body || '';
                const targetUrl = payload.data?.url || payload.fcmOptions?.link || null;

                if (typeof window.showToast === 'function') {
                    window.showToast(title, body, 'info', 6000, targetUrl);
                    if (!payload.nativeNotificationShown) playNotificationChime();
                    event.ports?.[0]?.postMessage({ handled: true });
                } else {
                    event.ports?.[0]?.postMessage({ handled: false });
                }
                if (typeof window.injectIncomingNotification === 'function') {
                    window.injectIncomingNotification(payload);
                }
            });
            foregroundListenerAttached = true;
            }
        } catch (msgErr) {
            console.warn('[Push] Gagal memasang listener foreground:', msgErr);
        }

        // Binding lokal diperbarui saat login, juga ketika push sedang dijeda.
        // Tidak dihapus saat logout; mencegah push akun lama yang sudah di FCM.
        if (auth.currentUser?.uid !== targetUid) return { success: false, reason: 'account_changed' };
        await syncPushOwner(targetUid);

        // Ambil konfigurasi push dari Cloudflare D1 system_settings (0 Firestore Read)
        let vapidKey = "";
        let config = null;
        if (window.cfClient && window.cfClient.enabled) {
            try {
                config = await window.cfClient.getSystemSetting('push_config');
            } catch (cfgErr) {
                console.warn('[Push] Gagal memuat push_config dari Cloudflare D1, menggunakan konfigurasi fallback/default:', cfgErr?.message || cfgErr);
            }
        }
        if (config) {
            if (config.enabled === false) {
                console.log('[Push] Push notification dinonaktifkan di Cloudflare D1 push_config.');
                // Tetap rebind token yang sudah diizinkan saat akun berganti.
                // Sakelar ini menjeda pengiriman di backend, bukan kepemilikan.
                if (Notification.permission !== 'granted') return { success: false, reason: 'disabled' };
            }
            vapidKey = config.vapidPublicKey || "";
        }

        // Cek permission browser
        if (Notification.permission === 'default') {
            console.log('[Push] Izin notifikasi browser belum diberikan (default). Menampilkan banner izin.');
            checkAndShowPushPermissionBanner();
        } else if (Notification.permission === 'denied') {
            console.log('[Push] Izin notifikasi ditolak sebelumnya. Menampilkan banner panduan.');
            checkAndShowPushDeniedBanner();
            return { success: false, reason: 'permission_denied' };
        }

        // Dapatkan token jika diizinkan (atau minta izin jika sudah granted)
        if (Notification.permission === 'granted') {
            const token = await registerFCMToken(targetUid, vapidKey);
            if (config?.enabled === false) return { success: false, reason: 'disabled', token };
            return { success: true, token };
        }

        return { success: false, reason: 'permission_not_granted' };
    } catch (error) {
        console.error('[Push] Gagal setup push notification:', error);
        return { success: false, reason: 'error', error };
    }
}

/**
 * Menampilkan banner izin notifikasi yang elegan jika permission masih default
 */
export function checkAndShowPushPermissionBanner() {
    const isIOS = (typeof navigator !== 'undefined') && (/iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    const isStandalone = (typeof window !== 'undefined') && (window.navigator?.standalone === true || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches));

    // Jika iOS dan belum standalone (belum add to home screen), Safari biasa belum mendukung Web Push
    if (isIOS && !isStandalone) {
        const lastDismissed = localStorage.getItem('hide_push_banner_ios_time');
        if (lastDismissed) {
            const elapsedDays = (Date.now() - parseInt(lastDismissed, 10)) / (1000 * 60 * 60 * 24);
            if (elapsedDays < 1) return;
        }

        let banner = document.getElementById('push-permission-banner');
        if (banner) return;

        banner = document.createElement('div');
        banner.id = 'push-permission-banner';
        banner.className = 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-2xl p-4 shadow-xl mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in border border-blue-400/30';
        banner.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center shrink-0">
                    <i class="fa-brands fa-apple text-white text-xl"></i>
                </div>
                <div>
                    <h4 class="font-bold text-sm text-white">Aktifkan Notifikasi SIMAS di iOS</h4>
                    <p class="text-xs text-blue-100 mt-0.5">Tambahkan SIMAS ke Layar Utama (Add to Home Screen) agar dapat menerima notifikasi dan pengingat presensi di iPhone/iPad.</p>
                </div>
            </div>
            <div class="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                <button id="btn-dismiss-push-banner" class="px-3 py-1.5 text-xs text-blue-100 hover:text-white transition-all rounded-lg cursor-pointer">
                    Nanti Saja
                </button>
                <button id="btn-guide-ios-push-banner" class="px-4 py-2 text-xs font-bold bg-white text-blue-700 hover:bg-blue-50 transition-all rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer">
                    <i class="fa-solid fa-circle-info"></i> Petunjuk iOS
                </button>
            </div>
        `;

        const container = document.querySelector('main') || document.querySelector('.container') || document.body;
        if (container.firstChild) {
            container.insertBefore(banner, container.firstChild);
        } else {
            container.appendChild(banner);
        }

        document.getElementById('btn-guide-ios-push-banner')?.addEventListener('click', () => {
            banner.remove();
            showPushPermissionGuideModal();
        });

        document.getElementById('btn-dismiss-push-banner')?.addEventListener('click', () => {
            banner.remove();
            localStorage.setItem('hide_push_banner_ios_time', Date.now().toString());
        });
        return;
    }

    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default') return;

    const lastDismissed = localStorage.getItem('hide_push_banner_time');
    if (lastDismissed) {
        const elapsedDays = (Date.now() - parseInt(lastDismissed, 10)) / (1000 * 60 * 60 * 24);
        if (elapsedDays < 1) return; // Belum 1 hari (24 jam) sejak ditutup
    }

    let banner = document.getElementById('push-permission-banner');
    if (banner) return;

    banner = document.createElement('div');
    banner.id = 'push-permission-banner';
    banner.className = 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-2xl p-4 shadow-xl mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in border border-blue-400/30';
    banner.innerHTML = `
        <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center shrink-0">
                <i class="fa-solid fa-bell text-yellow-300 text-xl animate-bounce"></i>
            </div>
            <div>
                <h4 class="font-bold text-sm text-white">Aktifkan Push Notification SIMAS</h4>
                <p class="text-xs text-blue-100 mt-0.5">Dapatkan pengingat presensi, agenda kegiatan, dan notifikasi sekolah langsung di perangkat Anda.</p>
            </div>
        </div>
        <div class="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
            <button id="btn-dismiss-push-banner" class="px-3 py-1.5 text-xs text-blue-100 hover:text-white transition-all rounded-lg cursor-pointer">
                Nanti Saja
            </button>
            <button id="btn-grant-push-banner" class="px-4 py-2 text-xs font-bold bg-white text-blue-700 hover:bg-blue-50 transition-all rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer">
                <i class="fa-solid fa-check"></i> Aktifkan Sekarang
            </button>
        </div>
    `;

    const container = document.querySelector('main') || document.querySelector('.container') || document.body;
    if (container.firstChild) {
        container.insertBefore(banner, container.firstChild);
    } else {
        container.appendChild(banner);
    }

    document.getElementById('btn-grant-push-banner')?.addEventListener('click', async () => {
        banner.remove();
        await requestNotificationPermission();
    });

    document.getElementById('btn-dismiss-push-banner')?.addEventListener('click', () => {
        banner.remove();
        localStorage.setItem('hide_push_banner_time', Date.now().toString());
    });
}

/**
 * Menampilkan banner peringatan jika izin notifikasi ditolak (denied) oleh browser
 */
export function checkAndShowPushDeniedBanner() {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'denied') return;

    const lastDismissed = localStorage.getItem('hide_push_denied_banner_time');
    if (lastDismissed) {
        const elapsedDays = (Date.now() - parseInt(lastDismissed, 10)) / (1000 * 60 * 60 * 24);
        if (elapsedDays < 3) return; // Belum 3 hari sejak ditutup
    }

    let banner = document.getElementById('push-denied-banner');
    if (banner) return;

    banner = document.createElement('div');
    banner.id = 'push-denied-banner';
    banner.className = 'bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 text-white rounded-2xl p-4 shadow-xl mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in border border-amber-400/30';
    banner.innerHTML = `
        <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center shrink-0">
                <i class="fa-solid fa-bell-slash text-amber-200 text-xl"></i>
            </div>
            <div>
                <h4 class="font-bold text-sm text-white flex items-center gap-2">
                    Notifikasi Diblokir di Browser
                    <span class="bg-amber-900/60 text-amber-200 text-[10px] px-2 py-0.5 rounded-full font-mono font-normal border border-amber-500/40">Denied</span>
                </h4>
                <p class="text-xs text-amber-100 mt-0.5">Pengingat presensi & agenda SIMAS tidak dapat muncul karena diblokir oleh setelan browser Anda.</p>
            </div>
        </div>
        <div class="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
            <button id="btn-dismiss-push-denied-banner" class="px-3 py-1.5 text-xs text-amber-100 hover:text-white transition-all rounded-lg">
                Nanti Saja
            </button>
            <button id="btn-guide-push-denied" class="px-4 py-2 text-xs font-bold bg-white text-orange-700 hover:bg-orange-50 transition-all rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer">
                <i class="fa-solid fa-circle-info"></i> Cara Aktifkan
            </button>
        </div>
    `;

    const container = document.querySelector('main') || document.querySelector('.container') || document.body;
    if (container.firstChild) {
        container.insertBefore(banner, container.firstChild);
    } else {
        container.appendChild(banner);
    }

    document.getElementById('btn-guide-push-denied')?.addEventListener('click', () => {
        showPushPermissionGuideModal();
    });

    document.getElementById('btn-dismiss-push-denied-banner')?.addEventListener('click', () => {
        banner.remove();
        localStorage.setItem('hide_push_denied_banner_time', Date.now().toString());
    });
}

/**
 * Menampilkan modal interaktif berisi panduan langkah-demi-langkah mengaktifkan notifikasi
 * jika status izin browser berada dalam kondisi 'denied' (terblokir).
 */
export function showPushPermissionGuideModal() {
    let modal = document.getElementById('modal-push-guide');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        return;
    }

    const isIOS = (typeof navigator !== 'undefined') && (/iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    const isStandalone = (typeof window !== 'undefined') && (window.navigator?.standalone === true || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches));

    modal = document.createElement('div');
    modal.id = 'modal-push-guide';
    modal.className = 'fixed inset-0 z-[9999] bg-slate-900/70 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in';

    if (isIOS && !isStandalone) {
        modal.innerHTML = `
        <div class="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-3xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700 transition-all transform scale-100">
            <!-- Header Modal iOS -->
            <div class="bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 p-6 text-white relative">
                <button id="btn-close-push-guide" class="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-all cursor-pointer">
                    <i class="fa-solid fa-xmark text-lg"></i>
                </button>
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-white text-2xl shrink-0">
                        <i class="fa-brands fa-apple text-white"></i>
                    </div>
                    <div>
                        <h3 class="font-bold text-lg leading-tight">Panduan Notifikasi iOS (iPhone/iPad)</h3>
                        <p class="text-xs text-blue-100 mt-1">Apple mewajibkan aplikasi web ditambahkan ke Layar Utama untuk mengaktifkan notifikasi.</p>
                    </div>
                </div>
            </div>

            <!-- Body Content iOS -->
            <div class="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
                <div class="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/50 rounded-2xl p-3.5 flex items-start gap-3">
                    <i class="fa-solid fa-circle-info text-blue-600 dark:text-blue-400 text-lg mt-0.5 shrink-0"></i>
                    <p class="text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
                        Pada iOS 16.4+, notifikasi push web hanya dapat diterima jika aplikasi dijalankan dalam mode Layar Utama (Home Screen / PWA Standalone).
                    </p>
                </div>

                <!-- Langkah per Langkah iOS -->
                <div class="space-y-3">
                    <div class="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700">
                        <div class="w-7 h-7 rounded-lg bg-blue-600 text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">1</div>
                        <div>
                            <h5 class="font-bold text-xs text-slate-800 dark:text-white flex items-center gap-1.5">
                                Buka di Safari & Ketuk Tombol Bagikan
                                <span class="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 text-[10px]"><i class="fa-solid fa-arrow-up-from-bracket"></i></span>
                            </h5>
                            <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5">Buka SIMAS di Safari, lalu ketuk ikon <b>Bagikan (Share)</b> di baris menu browser.</p>
                        </div>
                    </div>

                    <div class="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700">
                        <div class="w-7 h-7 rounded-lg bg-blue-600 text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">2</div>
                        <div>
                            <h5 class="font-bold text-xs text-slate-800 dark:text-white flex items-center gap-1.5">
                                Pilih "Tambahkan ke Layar Utama"
                                <span class="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 text-[10px]"><i class="fa-regular fa-square-plus"></i></span>
                            </h5>
                            <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5">Gulir ke bawah pada lembar menu opsi dan ketuk <b>"Add to Home Screen"</b> (Tambahkan ke Layar Utama).</p>
                        </div>
                    </div>

                    <div class="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700">
                        <div class="w-7 h-7 rounded-lg bg-blue-600 text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">3</div>
                        <div>
                            <h5 class="font-bold text-xs text-slate-800 dark:text-white">Buka SIMAS dari Layar Utama</h5>
                            <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5">Tutup Safari, lalu buka ikon aplikasi <b>SIMAS</b> yang baru muncul di Layar Utama iPhone/iPad Anda.</p>
                        </div>
                    </div>

                    <div class="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700">
                        <div class="w-7 h-7 rounded-lg bg-blue-600 text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">4</div>
                        <div>
                            <h5 class="font-bold text-xs text-slate-800 dark:text-white flex items-center gap-1">
                                Izinkan Notifikasi
                                <i class="fa-solid fa-circle-check text-green-500"></i>
                            </h5>
                            <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5">Saat dialog konfirmasi izin muncul di layar, ketuk <b>"Izinkan" (Allow)</b>.</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Footer Modal -->
            <div class="p-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-700/80 flex items-center justify-between gap-3">
                <span class="text-[11px] text-slate-500 dark:text-slate-400 italic">SMANTARA CERDAS iOS PWA</span>
                <button id="btn-understood-push-guide" class="px-5 py-2 text-xs font-bold bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 rounded-xl shadow-md transition-all cursor-pointer">
                    Saya Mengerti
                </button>
            </div>
        </div>
        `;
    } else {
        modal.innerHTML = `
        <div class="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-3xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700 transition-all transform scale-100">
            <!-- Header Modal -->
            <div class="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 p-6 text-white relative">
                <button id="btn-close-push-guide" class="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-all cursor-pointer">
                    <i class="fa-solid fa-xmark text-lg"></i>
                </button>
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-white text-2xl shrink-0">
                        <i class="fa-solid fa-lock-open text-amber-200"></i>
                    </div>
                    <div>
                        <h3 class="font-bold text-lg leading-tight">Panduan Buka Blokir Notifikasi</h3>
                        <p class="text-xs text-amber-100 mt-1">Ikuti langkah mudah di bawah untuk mengizinkan kembali notifikasi di browser Anda.</p>
                    </div>
                </div>
            </div>

            <!-- Body Content -->
            <div class="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
                <div class="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 rounded-2xl p-3.5 flex items-start gap-3">
                    <i class="fa-solid fa-triangle-exclamation text-amber-600 dark:text-amber-400 text-lg mt-0.5 shrink-0"></i>
                    <p class="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                        Browser memblokir permintaan izin otomatis demi keamanan. Anda dapat mengaktifkannya sendiri melalui ikon setelan di URL Bar.
                    </p>
                </div>

                <!-- Langkah per Langkah -->
                <div class="space-y-3">
                    <div class="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700">
                        <div class="w-7 h-7 rounded-lg bg-orange-600 text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">1</div>
                        <div>
                            <h5 class="font-bold text-xs text-slate-800 dark:text-white flex items-center gap-1.5">
                                Klik Ikon Setelan / Gembok
                                <span class="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 text-[10px] font-mono">🔒</span>
                            </h5>
                            <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5">Lihat di sebelah kiri alamat web (URL bar) browser Anda pada bagian paling atas layar.</p>
                        </div>
                    </div>

                    <div class="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700">
                        <div class="w-7 h-7 rounded-lg bg-orange-600 text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">2</div>
                        <div>
                            <h5 class="font-bold text-xs text-slate-800 dark:text-white">Pilih "Notifikasi" / "Notifications"</h5>
                            <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5">Cari menu Izin Situs (Permissions) dan temukan opsi Notifikasi.</p>
                        </div>
                    </div>

                    <div class="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700">
                        <div class="w-7 h-7 rounded-lg bg-orange-600 text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">3</div>
                        <div>
                            <h5 class="font-bold text-xs text-slate-800 dark:text-white flex items-center gap-1">
                                Ubah Menjadi "Izinkan" / "Allow"
                                <i class="fa-solid fa-circle-check text-green-500"></i>
                            </h5>
                            <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5">Geser sakelar atau ubah opsi status dari <i>Blokir (Block)</i> menjadi <b>Izinkan (Allow)</b>.</p>
                        </div>
                    </div>

                    <div class="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700">
                        <div class="w-7 h-7 rounded-lg bg-orange-600 text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">4</div>
                        <div>
                            <h5 class="font-bold text-xs text-slate-800 dark:text-white">Refresh / Muat Ulang Halaman</h5>
                            <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5">Setelah diubah, muat ulang halaman ini agar sistem SIMAS dapat mendaftarkan perangkat Anda.</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Footer Modal -->
            <div class="p-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-700/80 flex items-center justify-between gap-3">
                <span class="text-[11px] text-slate-500 dark:text-slate-400 italic">SMANTARA CERDAS Notification System</span>
                <button id="btn-understood-push-guide" class="px-5 py-2 text-xs font-bold bg-gradient-to-r from-amber-600 to-orange-600 text-white hover:from-amber-700 hover:to-orange-700 rounded-xl shadow-md transition-all cursor-pointer">
                    Saya Mengerti
                </button>
            </div>
        </div>
        `;
    }

    document.body.appendChild(modal);

    const closeModal = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    };

    document.getElementById('btn-close-push-guide')?.addEventListener('click', closeModal);
    document.getElementById('btn-understood-push-guide')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
}

async function syncPushOwner(uid) {
    const registration = await readyPushWorker();
    if (auth.currentUser?.uid !== uid) return;
    const worker = registration.active;
    if (!worker) throw new Error('Service Worker push belum aktif.');
    await new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Sinkronisasi pemilik push belum dikonfirmasi.')); }, 3000);
        channel.port1.onmessage = event => {
            clearTimeout(timer);
            channel.port1.close();
            if (event.data?.success === true) resolve();
            else reject(new Error('Gagal menyimpan pemilik push di perangkat.'));
        };
        worker.postMessage({ type: 'SIMAS_PUSH_OWNER', uid }, [channel.port2]);
    });
}

async function readyPushWorker() {
    let timer;
    try {
        return await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Service Worker belum siap. Muat ulang SIMAS lalu hubungkan ulang notifikasi.')), 15000);
            })
        ]);
    } finally { clearTimeout(timer); }
}

export async function registerFCMToken(userId, vapidPublicKey) {
    // Resolusi UID yang aman
    const targetUid = (typeof userId === 'string' && userId.trim()) 
        ? userId.trim() 
        : (auth.currentUser ? auth.currentUser.uid : null);

    if (!targetUid) {
        console.warn('[Push] Gagal registrasi token: User ID tidak ditemukan.');
        return null;
    }

    // Dapatkan registrasi Service Worker aktif
    const registration = await readyPushWorker();
    if (!registration) {
        throw new Error('Service Worker tidak aktif atau belum siap.');
    }

    // ===== LANGKAH 1: Dapatkan token FCM dari browser =====
    let token;
    try {
        const getTokenOptions = { serviceWorkerRegistration: registration };
        if (vapidPublicKey && typeof vapidPublicKey === 'string' && vapidPublicKey.trim()) {
            getTokenOptions.vapidKey = vapidPublicKey.trim();
        }

        token = await getToken(messaging, getTokenOptions);
        console.log('[Push] ✅ getToken berhasil. Token:', token ? token.substring(0, 20) + '...' : 'NULL');
    } catch (fcmError) {
        console.error('[Push] ❌ GAGAL di getToken (FCM/Browser):', fcmError.code, fcmError.message);
        throw fcmError;
    }

    if (!token) {
        throw new Error('Gagal mendapatkan token FCM (token null).');
    }

    // Jangan biarkan setup akun sebelumnya mendaftarkan token setelah ganti akun.
    if (auth.currentUser?.uid !== targetUid) throw new Error('Akun berubah saat registrasi notifikasi.');
    // Pertahankan refresh claims agar perubahan role tidak memakai JWT lama.
    try { await auth.currentUser.getIdToken(true); }
    catch (error) { console.warn('[Push] Auth token sync warning:', error); }
    if (auth.currentUser?.uid !== targetUid) throw new Error('Akun berubah saat registrasi notifikasi.');
    await syncPushOwner(targetUid);
    if (auth.currentUser?.uid !== targetUid) throw new Error('Akun berubah saat registrasi notifikasi.');

    try {
        // Worker mengikat token ke UID JWT. UNIQUE(token) secara atomik
        // mengganti binding akun lama jika HP yang sama dipakai user berbeda.
        const result = await cfClient.registerPushToken({
            token,
            deviceType: getDeviceType(),
            userAgent: navigator.userAgent
        });
        if (result?.success !== true) throw new Error('Registrasi push belum dikonfirmasi oleh server.');
        console.log('[Push] ✅ Token berhasil disimpan ke Cloudflare D1 untuk user', targetUid);
    } catch (registrationError) {
        console.error('[Push] ❌ Gagal menyimpan token ke Cloudflare D1:', registrationError.message);
        throw registrationError;
    }
    return token;
}

/**
 * Logout sengaja tidak mencabut token. Dengan begitu perangkat tetap dapat
 * menerima notifikasi; binding akan diganti saat akun lain login di HP sama.
 */
export async function unregisterFCMToken(userId) {
    const targetUid = userId || (auth.currentUser ? auth.currentUser.uid : null);
    console.log(`[Push] Token user ${targetUid || '-'} dipertahankan saat logout sesuai kebijakan notifikasi perangkat.`);
    return { success: true, retained: true };
}

function getDeviceType() {
    const ua = navigator.userAgent;
    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
        return "tablet";
    }
    if (/Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i.test(ua)) {
        return "mobile";
    }
    return "desktop";
}

// Bind ke window untuk mempermudah pemanggilan global di file lain
window.setupPushNotifications = setupPushNotifications;
window.registerFCMToken = registerFCMToken;
window.unregisterFCMToken = unregisterFCMToken;
window.requestNotificationPermission = requestNotificationPermission;
window.checkAndShowPushPermissionBanner = checkAndShowPushPermissionBanner;
window.checkAndShowPushDeniedBanner = checkAndShowPushDeniedBanner;
window.showPushPermissionGuideModal = showPushPermissionGuideModal;
