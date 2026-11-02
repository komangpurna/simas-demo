import { auth, db, PATHS, APP_VERSION, supabase, SUPABASE_URL, SUPABASE_ANON_KEY, getAiConfig, getAiConfigAsync, AI_CONFIG, SCHOOL_CONFIG, resolvePhotoUrl } from './config.js';
import { onAuthStateChanged, signOut, updateProfile, updateEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { cfClient } from './cloudflare-client.js';
import { doc, getDoc, updateDoc, setDoc, getDocs, collection, query, where, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { setupPushNotifications } from './push-notification.js';
import './notification-inbox.js';
import { SimasDB } from './indexeddb-cache.js';
import './biometric-auth.js';
import './vip-manager.js';
import { startIdleSessionMonitor } from './session-activity.mjs';

if (typeof window !== 'undefined') {
    window.resolvePhotoUrl = resolvePhotoUrl;
}

const ROOT_URL = new URL('../', import.meta.url).href;

// --- CANONICAL DOMAIN REDIRECTION (PWA SCOPE & DOMAIN CONSOLIDATION) ---
// Pengalihan otomatis dari domain alias/mirror ke domain utama (SCHOOL_CONFIG.primaryDomain)
// Mencegah permintaan instalasi PWA ganda dan menjaga konsistensi sesi/cache.
(function () {
    const currentHost = window.location.hostname;
    const primaryDomain = SCHOOL_CONFIG.primaryDomain;
    const aliasDomains = SCHOOL_CONFIG.canonicalAliasDomains || [];

    if (aliasDomains.includes(currentHost)) {
        const canonicalUrl = 'https://' + primaryDomain + window.location.pathname + window.location.search + window.location.hash;
        window.location.replace(canonicalUrl);
    }
})();

// --- PRODUCTION CONSOLE SUPPRESSOR ---
// Menonaktifkan console.log & console.warn di production untuk mencegah kebocoran informasi
// console.error tetap aktif untuk monitoring error kritis
(function () {
    const isProduction = !['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (isProduction) {
        const noop = () => { };
        console.log = noop;
        console.warn = noop;
        console.info = noop;
        console.debug = noop;
        console.table = noop;
        console.time = noop;
        console.timeEnd = noop;
    }
})();

// --- LINK PREFETCHER (Instant Navigation Hover) ---
window._prefetchedHrefs = window._prefetchedHrefs || new Set();
window.prefetchPage = window.prefetchPage || function (href) {
    if (!href || typeof href !== 'string') return;
    if (href.startsWith('http') && !href.startsWith(window.location.origin)) return;
    if (window._prefetchedHrefs.has(href)) return;
    window._prefetchedHrefs.add(href);
    try {
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = href;
        document.head.appendChild(link);
    } catch (e) {
        // Safe fallback
    }
};

// --- PWA SERVICE WORKER REGISTRATION & INSTALLATION ---
let deferredPrompt;

// Fungsi terpusat untuk mendeteksi apakah aplikasi sudah terinstal (Standalone / Related Apps / Local Flag)
window.isPWAInstalled = function () {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                         window.navigator.standalone === true || 
                         (typeof document !== 'undefined' && document.referrer && document.referrer.startsWith('android-app://'));
    if (isStandalone) {
        try { localStorage.setItem('simas_pwa_installed', 'true'); } catch (e) {}
        return true;
    }
    return localStorage.getItem('simas_pwa_installed') === 'true';
};

// Fungsi terpusat untuk mengupdate visibilitas tombol install & floating banner
window.updatePWAInstallUI = async function () {
    const btns = document.querySelectorAll('.pwa-install-btn');
    const banner = document.getElementById('pwa-float-banner');

    // 1. Jika terdeteksi mode standalone atau flag installed aktif, sembunyikan semua UI install
    if (window.isPWAInstalled()) {
        btns.forEach(btn => btn.classList.add('hidden'));
        if (banner) banner.remove();
        return;
    }

    // 2. Cek API navigator.getInstalledRelatedApps jika didukung browser
    if ('getInstalledRelatedApps' in navigator) {
        try {
            const relatedApps = await navigator.getInstalledRelatedApps();
            if (relatedApps && relatedApps.length > 0) {
                try { localStorage.setItem('simas_pwa_installed', 'true'); } catch (e) {}
                btns.forEach(btn => btn.classList.add('hidden'));
                if (banner) banner.remove();
                return;
            }
        } catch (e) {}
    }

    // 3. Jika deferredPrompt aktif (browser mengizinkan instalasi dan aplikasi belum terpasang)
    if (deferredPrompt) {
        btns.forEach(btn => btn.classList.remove('hidden'));
    } else {
        // Jika belum ada event beforeinstallprompt dan bukan standalone:
        // Tombol hanya ditampilkan jika belum terdeteksi pernah terpasang
        if (localStorage.getItem('simas_pwa_installed') === 'true') {
            btns.forEach(btn => btn.classList.add('hidden'));
        }
    }
};

if ('serviceWorker' in navigator) {
    // A worker can take control while a user is typing or uploading. Let the
    // browser activate updates naturally; a controller change must not reload
    // the document and discard work that is still in memory.
    window.addEventListener('load', () => {
        navigator.serviceWorker.register(`${ROOT_URL}sw.js`, { updateViaCache: 'none' })
            .then(reg => {
                console.log('Service Worker registered: ', reg.scope);
                reg.update().catch(err => {
                    if (!isLocalServer) console.warn('[SW] Update failed:', err);
                });
            })
            .catch(err => console.log('Service Worker registration failed: ', err));
        
        if (typeof window.updatePWAInstallUI === 'function') {
            window.updatePWAInstallUI();
        }
    });
}

const isLocalServer = ['localhost', '127.0.0.1', '127.0.0.0', '::1'].includes(window.location.hostname) || window.location.hostname.startsWith('192.168.');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Karena browser menembakkan beforeinstallprompt, aplikasi dipastikan BELUM terinstal pada browser ini
    try { localStorage.removeItem('simas_pwa_installed'); } catch (err) {}

    // Tampilkan tombol install (desktop & mobile)
    const btns = document.querySelectorAll('.pwa-install-btn');
    btns.forEach(btn => btn.classList.remove('hidden'));

    // Logika tampilkan floating banner: tampilkan jika tak ada di cache ATAU jika sudah lewat 1 jam sejak di-close
    const lastHidden = localStorage.getItem('hide_pwa_banner_time');
    let shouldShow = true;

    if (lastHidden) {
        const timePassed = Date.now() - parseInt(lastHidden, 10);
        // 1 Jam = 1 * 60 * 60 * 1000 milidetik
        if (timePassed < 1 * 60 * 60 * 1000) {
            shouldShow = false;
        }
    }

    if (shouldShow && !window.isPWAInstalled()) {
        showPWABanner();
    }
});

// Tampilkan banner popup untuk install PWA
// Mobile: muncul dari bawah | Desktop: muncul dari atas
window.showPWABanner = function () {
    if (window.isPWAInstalled()) return;
    if (document.getElementById('pwa-float-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-float-banner';
    // Mobile: bottom | Desktop (md+): top
    banner.className = 'fixed bottom-4 left-4 right-4 md:bottom-auto md:top-4 md:left-auto md:right-4 md:w-96 z-[9999] bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-blue-200 dark:border-blue-900/50 p-4 flex items-center justify-between gap-3 transition-all duration-500 ease-out';

    // Set initial transform berdasarkan ukuran layar
    const isDesktop = window.matchMedia('(min-width: 768px)').matches;
    banner.style.transform = isDesktop ? 'translateY(-150%)' : 'translateY(150%)';
    banner.style.opacity = '0';

    banner.innerHTML = `
        <div class="flex items-center gap-3 min-w-0">
            <div class="w-10 h-10 bg-gradient-to-tr from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center text-white shadow-md shrink-0">
                <i class="fa-solid fa-download text-lg"></i>
            </div>
            <div class="min-w-0">
                <p class="font-bold text-slate-800 dark:text-white text-sm">Install SIMAS</p>
                <p class="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5">Pasang ke layar utama untuk akses cepat.</p>
            </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
            <button onclick="window.installPWA(); window.dismissPWABanner(false);" class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-md transition-colors whitespace-nowrap active:scale-95">
                Install
            </button>
            <button onclick="window.dismissPWABanner(true);" class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <i class="fa-solid fa-times"></i>
            </button>
        </div>
    `;

    document.body.appendChild(banner);

    // Animasi masuk
    requestAnimationFrame(() => {
        banner.style.transform = 'translateY(0)';
        banner.style.opacity = '1';
    });
};

window.dismissPWABanner = function (remember) {
    const banner = document.getElementById('pwa-float-banner');
    if (banner) {
        const isDesktop = window.matchMedia('(min-width: 768px)').matches;
        banner.style.transform = isDesktop ? 'translateY(-150%)' : 'translateY(150%)';
        banner.style.opacity = '0';
        setTimeout(() => banner.remove(), 500);
    }
    if (remember) {
        // Simpan waktu (timestamp) saat user menekan tanda silang
        localStorage.setItem('hide_pwa_banner_time', Date.now().toString());
    }
};

window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    try { localStorage.setItem('simas_pwa_installed', 'true'); } catch (e) {}

    const btns = document.querySelectorAll('.pwa-install-btn');
    btns.forEach(btn => btn.classList.add('hidden'));

    // Hapus banner jika ada
    const banner = document.getElementById('pwa-float-banner');
    if (banner) banner.remove();
});

window.showDesktopInstallGuide = function () {
    if (window.isPWAInstalled()) return;
    if (document.getElementById('modal-desktop-install-guide')) {
        document.getElementById('modal-desktop-install-guide').classList.remove('hidden');
        return;
    }

    const modal = document.createElement('div');
    modal.id = 'modal-desktop-install-guide';
    modal.className = 'fixed inset-0 z-[100] bg-slate-900/60 dark:bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm fade-in';
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };

    modal.innerHTML = `
        <div class="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6 text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 relative animate-scale-in" onclick="event.stopPropagation()">
            <div class="flex items-center justify-between pb-4 mb-4 border-b border-slate-100 dark:border-slate-800">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl flex items-center justify-center text-lg">
                        <i class="fa-solid fa-laptop-code"></i>
                    </div>
                    <div>
                        <h3 class="font-bold text-base leading-tight">Instal SIMAS di Laptop / PC</h3>
                        <p class="text-xs text-slate-500 dark:text-slate-400">Jadikan aplikasi desktop mandiri</p>
                    </div>
                </div>
                <button onclick="document.getElementById('modal-desktop-install-guide').classList.add('hidden')" class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>

            <div class="space-y-3.5 text-xs text-slate-600 dark:text-slate-300">
                <div class="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-100 dark:border-blue-900/40 flex items-start gap-3">
                    <div class="w-6 h-6 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center shrink-0 text-[11px] mt-0.5">1</div>
                    <div>
                        <p class="font-bold text-slate-800 dark:text-white">Melalui Bilah Alamat (Address Bar):</p>
                        <p class="mt-0.5 text-slate-600 dark:text-slate-300">Perhatikan ujung kanan tempat mengetik URL di Chrome/Edge, klik ikon <strong>Monitor dengan panah bawah</strong> (<i class="fa-solid fa-arrow-down-to-bracket text-blue-500"></i>) lalu klik <strong>Instal</strong>.</p>
                    </div>
                </div>

                <div class="p-3 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl border border-indigo-100 dark:border-indigo-900/40 flex items-start gap-3">
                    <div class="w-6 h-6 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center shrink-0 text-[11px] mt-0.5">2</div>
                    <div>
                        <p class="font-bold text-slate-800 dark:text-white">Melalui Menu Browser (Titik Tiga):</p>
                        <p class="mt-0.5 text-slate-600 dark:text-slate-300">Klik menu <strong>titik tiga (⋮)</strong> di kanan atas browser ➜ Pilih <strong>Simpan dan bagikan</strong> (atau <em>Cast, save, and share</em>) ➜ Pilih <strong>Instal SIMAS...</strong></p>
                    </div>
                </div>
            </div>

            <div class="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                <button onclick="document.getElementById('modal-desktop-install-guide').classList.add('hidden')" class="px-5 py-2.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md transition-all active:scale-95 text-xs">
                    Saya Mengerti
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
};

window.installPWA = async () => {
    if (window.isPWAInstalled()) {
        if (typeof window.showToast === 'function') {
            window.showToast('Aplikasi Terpasang', 'SIMAS sudah terinstal dan berjalan dalam mode aplikasi.', 'success');
        }
        if (typeof window.updatePWAInstallUI === 'function') {
            window.updatePWAInstallUI();
        }
        return;
    }

    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            deferredPrompt = null;
            try { localStorage.setItem('simas_pwa_installed', 'true'); } catch (e) {}
            if (typeof window.updatePWAInstallUI === 'function') {
                window.updatePWAInstallUI();
            }
        }
        return;
    }

    window.showDesktopInstallGuide();
};

// --- GLOBAL TOAST/POPUP (Pengganti Alert Browser) ---
window.showToast = function (title, message, type = 'info', duration = null, onClickUrl = null) {
    // Buat container jika belum ada
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm sm:max-w-md w-full px-3 sm:px-0 pointer-events-none';
        document.body.appendChild(container);
    }

    // Tentukan ikon dan warna
    const config = {
        success: { bg: 'bg-green-50', border: 'border-green-200', icon: 'fa-check-circle', iconColor: 'text-green-500', titleColor: 'text-green-700' },
        error: { bg: 'bg-red-50', border: 'border-red-200', icon: 'fa-times-circle', iconColor: 'text-red-500', titleColor: 'text-red-700' },
        warning: { bg: 'bg-yellow-50', border: 'border-yellow-200', icon: 'fa-exclamation-triangle', iconColor: 'text-yellow-500', titleColor: 'text-yellow-700' },
        info: { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'fa-info-circle', iconColor: 'text-blue-500', titleColor: 'text-blue-700' }
    };
    const c = config[type] || config.info;

    // Durasi adaptif default: error dan warning membutuhkan durasi lebih panjang agar pengguna sempat membaca
    const defaultDurationByType = {
        error: 10000,
        warning: 7000,
        info: 4000,
        success: 4000
    };
    const effectiveDuration = (typeof duration === 'number' && duration > 0)
        ? duration
        : (defaultDurationByType[type] || 4000);

    // Buat toast element
    const toast = document.createElement('div');
    const clickableClass = onClickUrl ? 'cursor-pointer hover:shadow-xl transition-all' : '';
    toast.className = `${c.bg} ${c.border} border rounded-xl p-4 shadow-lg flex items-start gap-3 animate-fade-in-right transform translate-x-full pointer-events-auto ${clickableClass}`;
    
    const clickBadge = onClickUrl ? `<span class="inline-block mt-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"><i class="fa-solid fa-arrow-up-right-from-square mr-1"></i>Buka Halaman</span>` : '';

    toast.innerHTML = `
        <i class="fa-solid ${c.icon} ${c.iconColor} text-lg mt-0.5 shrink-0"></i>
        <div class="flex-1 min-w-0">
            <p class="${c.titleColor} font-bold text-sm leading-snug">${title}</p>
            <p class="text-slate-600 dark:text-slate-300 text-xs mt-1 leading-relaxed break-words">${message}</p>
            ${clickBadge}
        </div>
        <button onclick="event.stopPropagation(); this.parentElement.remove();" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm shrink-0 transition-colors" title="Tutup Notifikasi" aria-label="Tutup Notifikasi">
            <i class="fa-solid fa-times"></i>
        </button>
    `;

    if (onClickUrl && typeof onClickUrl === 'string') {
        toast.onclick = (e) => {
            if (!e.target.closest('button')) {
                window.location.href = onClickUrl;
            }
        };
    }

    // Tambahkan animasi masuk
    container.appendChild(toast);
    requestAnimationFrame(() => {
        toast.classList.remove('translate-x-full');
        toast.classList.add('translate-x-0');
    });

    // Auto remove setelah effectiveDuration
    if (effectiveDuration > 0) {
        setTimeout(() => {
            if (toast.parentElement) {
                toast.classList.add('opacity-0', 'translate-x-full');
                setTimeout(() => toast.remove(), 300);
            }
        }, effectiveDuration);
    }
};

// Export showToast untuk module import
export const showToast = window.showToast;

// CSS untuk animasi toast (inject ke head)
const toastStyle = document.createElement('style');
toastStyle.textContent = `
    .animate-fade-in-right { transition: transform 0.3s ease, opacity 0.3s ease; }
    
    /* Dark mode toast support */
    html.dark #toast-container .bg-green-50 { background-color: rgba(34, 197, 94, 0.15) !important; border-color: rgba(34, 197, 94, 0.3) !important; }
    html.dark #toast-container .bg-red-50 { background-color: rgba(239, 68, 68, 0.15) !important; border-color: rgba(239, 68, 68, 0.3) !important; }
    html.dark #toast-container .bg-yellow-50 { background-color: rgba(234, 179, 8, 0.15) !important; border-color: rgba(234, 179, 8, 0.3) !important; }
    html.dark #toast-container .bg-blue-50 { background-color: rgba(59, 130, 246, 0.15) !important; border-color: rgba(59, 130, 246, 0.3) !important; }
    html.dark #toast-container .text-slate-600 { color: #cbd5e1 !important; }
    html.dark #toast-container .text-slate-400 { color: #94a3b8 !important; }
`;
document.head.appendChild(toastStyle);

// --- GLOBAL CONFIRM MODAL (Pengganti confirm() browser) ---
let closeActiveConfirmModal = null;
let closeActiveAlertModal = null;

// Satu jalur penutupan untuk klik, Escape, dan penggantian modal.
// Promise harus selesai dan listener harus dilepas pada setiap jalur.
function setupGlobalModalLifecycle(overlay, card, onClose) {
    let closing = false;
    let completed = false;
    let closeResult;
    let closeTimer;
    let animationFrame;

    const finish = () => {
        if (completed) return;
        completed = true;
        clearTimeout(closeTimer);
        overlay.remove();
        onClose(closeResult);
    };

    const closeModal = (result, immediate = false) => {
        if (completed) return;
        if (!closing) {
            closing = true;
            closeResult = result;
            cancelAnimationFrame(animationFrame);
            document.removeEventListener('keydown', escHandler);
            overlay.style.opacity = '0';
            card.style.transform = 'scale(0.85) translateY(20px)';
            card.style.opacity = '0';
            closeTimer = setTimeout(finish, 250);
        }
        if (immediate) finish();
    };

    const escHandler = (event) => {
        const overlays = document.querySelectorAll('#global-confirm-overlay, #global-alert-overlay');
        if (event.key === 'Escape' && overlays[overlays.length - 1] === overlay) {
            closeModal(false);
        }
    };
    document.addEventListener('keydown', escHandler);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeModal(false);
    });
    animationFrame = requestAnimationFrame(() => {
        if (closing || !overlay.isConnected) return;
        overlay.style.opacity = '1';
        card.style.transform = 'scale(1) translateY(0)';
        card.style.opacity = '1';
    });
    return closeModal;
}

window.showConfirmModal = function (message, title = 'Konfirmasi', type = 'warning', options = {}) {
    return new Promise((resolve) => {
        if (closeActiveConfirmModal) closeActiveConfirmModal(false, true);
        const existing = document.getElementById('global-confirm-overlay');
        if (existing) existing.remove();

        // Konfigurasi type
        const typeConfig = {
            danger: {
                iconBg: 'background: rgba(239,68,68,0.12);',
                iconColor: 'color: #ef4444;',
                icon: 'fa-trash',
                btnBg: 'background: linear-gradient(135deg, #ef4444, #dc2626);',
                btnHover: '#dc2626',
                btnText: 'Hapus'
            },
            warning: {
                iconBg: 'background: rgba(245,158,11,0.12);',
                iconColor: 'color: #f59e0b;',
                icon: 'fa-question',
                btnBg: 'background: linear-gradient(135deg, #f59e0b, #d97706);',
                btnHover: '#d97706',
                btnText: 'Ya, Lanjutkan'
            },
            info: {
                iconBg: 'background: rgba(59,130,246,0.12);',
                iconColor: 'color: #3b82f6;',
                icon: 'fa-info-circle',
                btnBg: 'background: linear-gradient(135deg, #3b82f6, #2563eb);',
                btnHover: '#2563eb',
                btnText: 'OK'
            }
        };
        const cfg = typeConfig[type] || typeConfig.warning;
        const confirmBtnText = (options && options.confirmText) ? options.confirmText : cfg.btnText;
        const cancelBtnText = (options && options.cancelText) ? options.cancelText : 'Batal';
        const displayIcon = (options && options.icon) ? options.icon : cfg.icon;

        // Buat overlay
        const overlay = document.createElement('div');
        overlay.id = 'global-confirm-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transition:opacity 0.25s ease;';
        overlay.innerHTML = `
            <div id="global-confirm-card" style="background:rgba(255,255,255,0.95);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:1.25rem;padding:2rem 1.75rem 1.5rem;max-width:380px;width:90%;box-shadow:0 25px 60px rgba(0,0,0,0.25),0 0 0 1px rgba(255,255,255,0.1);text-align:center;transform:scale(0.85) translateY(20px);transition:transform 0.3s cubic-bezier(0.34,1.56,0.64,1),opacity 0.3s ease;opacity:0;">
                <div style="width:4rem;height:4rem;border-radius:50%;${cfg.iconBg}display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;">
                    <i class="fa-solid ${displayIcon}" style="font-size:1.5rem;${cfg.iconColor}"></i>
                </div>
                <h3 id="global-confirm-title" style="font-size:1.1rem;font-weight:700;color:#1e293b;margin:0 0 0.5rem;">${title}</h3>
                <div id="global-confirm-message" style="font-size:0.875rem;color:#64748b;line-height:1.5;margin:0 0 1.5rem;white-space:pre-line;">${message}</div>
                <div style="display:flex;gap:0.75rem;justify-content:center;">
                    <button id="global-confirm-cancel" style="flex:1;padding:0.65rem 1rem;border-radius:0.75rem;font-weight:600;font-size:0.85rem;color:#64748b;background:rgba(100,116,139,0.08);border:1px solid rgba(100,116,139,0.15);cursor:pointer;transition:all 0.2s ease;">
                        ${cancelBtnText}
                    </button>
                    <button id="global-confirm-ok" style="flex:1;padding:0.65rem 1rem;border-radius:0.75rem;font-weight:600;font-size:0.85rem;color:#fff;${cfg.btnBg}border:none;cursor:pointer;transition:all 0.2s ease;box-shadow:0 4px 15px rgba(0,0,0,0.15);">
                        ${confirmBtnText}
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        const card = overlay.querySelector('#global-confirm-card');
        const titleEl = card.querySelector('#global-confirm-title');
        const messageEl = card.querySelector('#global-confirm-message');
        const cancelBtn = card.querySelector('#global-confirm-cancel');
        const confirmBtn = card.querySelector('#global-confirm-ok');

        // Dark mode support
        if (document.documentElement.classList.contains('dark')) {
            card.style.background = 'rgba(30,41,59,0.95)';
            titleEl.style.color = '#f1f5f9';
            messageEl.style.color = '#94a3b8';
            cancelBtn.style.color = '#94a3b8';
            cancelBtn.style.background = 'rgba(148,163,184,0.1)';
            cancelBtn.style.borderColor = 'rgba(148,163,184,0.2)';
        }

        const closeModal = setupGlobalModalLifecycle(overlay, card, (result) => {
            if (closeActiveConfirmModal === closeModal) closeActiveConfirmModal = null;
            resolve(result);
        });
        closeActiveConfirmModal = closeModal;
        confirmBtn.addEventListener('click', () => closeModal(true));
        cancelBtn.addEventListener('click', () => closeModal(false));
    });
};

// --- GLOBAL ALERT MODAL (Pengganti alert() browser) ---
window.showAlertModal = function (title, message, type = 'info') {
    return new Promise((resolve) => {
        if (closeActiveAlertModal) closeActiveAlertModal(undefined, true);
        const existing = document.getElementById('global-alert-overlay');
        if (existing) existing.remove();

        const typeConfig = {
            success: { iconBg: 'background:rgba(34,197,94,0.12);', iconColor: 'color:#22c55e;', icon: 'fa-check-circle', btnBg: 'background:linear-gradient(135deg,#22c55e,#16a34a);' },
            error: { iconBg: 'background:rgba(239,68,68,0.12);', iconColor: 'color:#ef4444;', icon: 'fa-times-circle', btnBg: 'background:linear-gradient(135deg,#ef4444,#dc2626);' },
            warning: { iconBg: 'background:rgba(245,158,11,0.12);', iconColor: 'color:#f59e0b;', icon: 'fa-exclamation-triangle', btnBg: 'background:linear-gradient(135deg,#f59e0b,#d97706);' },
            info: { iconBg: 'background:rgba(59,130,246,0.12);', iconColor: 'color:#3b82f6;', icon: 'fa-info-circle', btnBg: 'background:linear-gradient(135deg,#3b82f6,#2563eb);' }
        };
        const cfg = typeConfig[type] || typeConfig.info;

        const overlay = document.createElement('div');
        overlay.id = 'global-alert-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transition:opacity 0.25s ease;';
        overlay.innerHTML = `
            <div id="global-alert-card" style="background:rgba(255,255,255,0.95);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:1.25rem;padding:2rem 1.75rem 1.5rem;max-width:360px;width:90%;box-shadow:0 25px 60px rgba(0,0,0,0.25),0 0 0 1px rgba(255,255,255,0.1);text-align:center;transform:scale(0.85) translateY(20px);transition:transform 0.3s cubic-bezier(0.34,1.56,0.64,1),opacity 0.3s ease;opacity:0;">
                <div style="width:4rem;height:4rem;border-radius:50%;${cfg.iconBg}display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;">
                    <i class="fa-solid ${cfg.icon}" style="font-size:1.5rem;${cfg.iconColor}"></i>
                </div>
                <h3 id="global-alert-title" style="font-size:1.1rem;font-weight:700;color:#1e293b;margin:0 0 0.5rem;">${title}</h3>
                <div id="global-alert-message" style="font-size:0.85rem;color:#64748b;line-height:1.5;margin:0 0 1.5rem;">${message}</div>
                <button id="global-alert-ok" style="width:100%;padding:0.65rem 1rem;border-radius:0.75rem;font-weight:600;font-size:0.85rem;color:#fff;${cfg.btnBg}border:none;cursor:pointer;transition:all 0.2s ease;box-shadow:0 4px 15px rgba(0,0,0,0.15);">OK</button>
            </div>
        `;

        document.body.appendChild(overlay);
        const card = overlay.querySelector('#global-alert-card');
        const titleEl = card.querySelector('#global-alert-title');
        const messageEl = card.querySelector('#global-alert-message');

        if (document.documentElement.classList.contains('dark')) {
            card.style.background = 'rgba(30,41,59,0.95)';
            titleEl.style.color = '#f1f5f9';
            messageEl.style.color = '#94a3b8';
        }

        const closeModal = setupGlobalModalLifecycle(overlay, card, () => {
            if (closeActiveAlertModal === closeModal) closeActiveAlertModal = null;
            resolve();
        });
        closeActiveAlertModal = closeModal;
        overlay.querySelector('#global-alert-ok').addEventListener('click', () => closeModal());
    });
};

export const showConfirmModal = window.showConfirmModal;
export const showAlertModal = window.showAlertModal;

// --- SKELETON LOADING HELPER ---
window.showSkeleton = function (container, count = 3, type = 'card') {
    const skeletonHTML = {
        'card': `
            <div class="skeleton-item bg-white dark:bg-slate-800 rounded-xl p-4 shadow-md animate-pulse border border-slate-100 dark:border-slate-800/50">
                <div class="skeleton bg-slate-200 dark:bg-slate-700/50 rounded h-4 w-3/4 mb-3"></div>
                <div class="skeleton bg-slate-200 dark:bg-slate-700/50 rounded h-3 w-full mb-2"></div>
                <div class="skeleton bg-slate-200 dark:bg-slate-700/50 rounded h-3 w-5/6 mb-2"></div>
                <div class="skeleton bg-slate-200 dark:bg-slate-700/50 h-8 w-1/3 mt-4 rounded-lg"></div>
            </div>
        `,
        'row': `
            <div class="skeleton-item flex items-center gap-4 p-4 border-b border-slate-100 dark:border-slate-800/50 animate-pulse">
                <div class="skeleton bg-slate-200 dark:bg-slate-700/50 h-10 w-10 rounded-full"></div>
                <div class="flex-1">
                    <div class="skeleton bg-slate-200 dark:bg-slate-700/50 rounded h-4 w-1/3 mb-2"></div>
                    <div class="skeleton bg-slate-200 dark:bg-slate-700/50 rounded h-3 w-1/2"></div>
                </div>
                <div class="skeleton bg-slate-200 dark:bg-slate-700/50 h-6 w-16 rounded-lg"></div>
            </div>
        `,
        'table': `
            <tr class="skeleton-item animate-pulse border-b border-slate-100 dark:border-slate-800/50">
                <td class="p-3"><div class="skeleton bg-slate-200 dark:bg-slate-700/50 rounded h-4 w-8"></div></td>
                <td class="p-3"><div class="skeleton bg-slate-200 dark:bg-slate-700/50 rounded h-4 w-full"></div></td>
                <td class="p-3"><div class="skeleton bg-slate-200 dark:bg-slate-700/50 rounded h-4 w-3/4"></div></td>
                <td class="p-3"><div class="skeleton bg-slate-200 dark:bg-slate-700/50 rounded h-6 w-16 rounded"></div></td>
            </tr>
        `,
        'text': `
            <div class="skeleton-item animate-pulse space-y-2">
                <div class="skeleton bg-slate-200 dark:bg-slate-700/50 rounded h-4 w-full"></div>
                <div class="skeleton bg-slate-200 dark:bg-slate-700/50 rounded h-4 w-5/6"></div>
                <div class="skeleton bg-slate-200 dark:bg-slate-700/50 rounded h-4 w-4/5"></div>
            </div>
        `
    };

    const template = skeletonHTML[type] || skeletonHTML['card'];
    let html = '';
    for (let i = 0; i < count; i++) {
        html += template;
    }

    if (typeof container === 'string') {
        container = document.querySelector(container);
    }

    if (container) {
        container.innerHTML = html;
    }

    return html;
};

// Hide skeleton (remove all skeleton items)
window.hideSkeleton = function (container) {
    if (typeof container === 'string') {
        container = document.querySelector(container);
    }
    if (container) {
        container.querySelectorAll('.skeleton-item').forEach(el => el.remove());
    }
};

// Export skeleton functions
export const showSkeleton = window.showSkeleton;
export const hideSkeleton = window.hideSkeleton;

// --- HELPER: Universal Safe Date Parser ---
// Mendukung Date instance, Firestore Timestamp (.toDate() / .toMillis()), JSON serialization ({seconds, nanoseconds} / {_seconds}), ISO String, DD-MM-YYYY, & timestamp number
window.parseUniversalDate = function (val) {
    if (!val) return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    if (typeof val.toDate === 'function') {
        try {
            const d = val.toDate();
            return (d instanceof Date && !isNaN(d.getTime())) ? d : null;
        } catch (e) { return null; }
    }
    if (typeof val.toMillis === 'function') {
        try {
            const d = new Date(val.toMillis());
            return isNaN(d.getTime()) ? null : d;
        } catch (e) { return null; }
    }
    if (typeof val === 'object') {
        if (typeof val.seconds === 'number') {
            const d = new Date(val.seconds * 1000 + (val.nanoseconds ? Math.floor(val.nanoseconds / 1000000) : 0));
            return isNaN(d.getTime()) ? null : d;
        }
        if (typeof val._seconds === 'number') {
            const d = new Date(val._seconds * 1000 + (val._nanoseconds ? Math.floor(val._nanoseconds / 1000000) : 0));
            return isNaN(d.getTime()) ? null : d;
        }
    }
    if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed) return null;
        // Tangani format murni YYYY-MM-DD agar terhindar dari pergeseran UTC Midnight
        const ymd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (ymd) {
            return new Date(parseInt(ymd[1], 10), parseInt(ymd[2], 10) - 1, parseInt(ymd[3], 10));
        }
        // Tangani format DD-MM-YYYY atau DD/MM/YYYY
        const dmy = trimmed.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
        if (dmy) {
            return new Date(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10));
        }
        const d = new Date(trimmed);
        return isNaN(d.getTime()) ? null : d;
    }
    if (typeof val === 'number') {
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
};

// --- HELPER: Get Local ISO Date String (YYYY-MM-DD) ---
// CATATAN: Format ini WAJIB digunakan untuk input type="date", query Firestore, dan SQLite D1.
window.getLocalISODate = function (d = new Date()) {
    const dateObj = window.parseUniversalDate(d) || new Date();
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

// --- HELPER: Get WITA (Asia/Makassar) ISO Date String (YYYY-MM-DD) ---
// Standar SSOT waktu operasional sekolah (WITA / UTC+8)
window.getWitaISODate = function (d = new Date()) {
    try {
        const dateObj = window.parseUniversalDate(d) || new Date();
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(dateObj);
    } catch (e) {
        return window.getLocalISODate(d);
    }
};

// --- HELPER: Immutable Audit Logging (Simpan Log Akses ke Cloudflare D1) ---
window.logAudit = async function (action, targetId, oldData, newData, details = '') {
    try {
        if (!auth.currentUser) return; // Silent shutdown jika tak terautentikasi
        const actorName = auth.currentUser.displayName || auth.currentUser.email || auth.currentUser.uid;
        
        // Simpan log audit ke Cloudflare D1 Serverless SQL
        await cfClient.logAudit({
            action: action || 'UNKNOWN_ACTION',
            target_id: targetId ? String(targetId) : null,
            actor_uid: auth.currentUser.uid,
            actor_name: actorName,
            old_data: oldData || null,
            new_data: newData || null,
            details: details || '',
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        // Non-blocking UI. Kegagalan audit log diredam.
        console.warn("[Keamanan] Skrip logging Cloudflare gagal:", e.message);
    }
};

// --- HELPER: Tanggal Indonesia (DD-MM-YYYY) ---
// Gunakan ini KHUSUS untuk tampilan UI, BUKAN untuk database/input form
window.formatDateIndo = function (dateVal) {
    if (!dateVal) return '';
    const d = window.parseUniversalDate(dateVal);
    if (!d) return String(dateVal);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`; // DD-MM-YYYY
};

// --- HELPER: Tanggal Resmi Indonesia Formal (DD MMMM YYYY, contoh: 09 September 2026) ---
window.formatDateIndoFormal = function (dateVal) {
    if (!dateVal) return '';
    const d = window.parseUniversalDate ? window.parseUniversalDate(dateVal) : new Date(dateVal);
    if (!d || isNaN(d.getTime())) return String(dateVal);
    const day = String(d.getDate()).padStart(2, '0');
    const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
};
window.formatDateIndoFull = window.formatDateIndoFormal;

// --- HELPER: XSS Sanitizer (Escape HTML) ---
// Gunakan ini untuk membersihkan string dari database sebelum dimasukkan ke dalam .innerHTML
window.escapeHTML = function (str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};
window.escapeHtml = window.escapeHTML;

// --- GLOBAL CACHE HELPERS (Hemat Kuota Firestore) ---
const DEFAULT_CACHE_TTL = 30 * 60 * 60 * 1000; // 30 jam
window.getLocalCache = function (key, ttl = DEFAULT_CACHE_TTL) {
    try {
        const cached = localStorage.getItem(key);
        if (cached) {
            const parsed = JSON.parse(cached);
            const now = Date.now();
            if (now - parsed.timestamp < ttl) {
                return parsed.data;
            }
            localStorage.removeItem(key);
        }
    } catch (e) { }
    return null;
};

window.setLocalCache = function (key, data) {
    try {
        localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
    } catch (e) {
        console.warn('Storage limit reached, clearing cache...');
        localStorage.clear();
    }
};

// --- GLOBAL: CENTRALIZED ACTIVE CLASSES HELPER (Hemat Kuota Firestore) ---
// Cache key untuk konfigurasi kelas aktif dari Cloudflare D1
const ACTIVE_CLASSES_CONFIG_CACHE_KEY = 'simas_active_classes_config';
const ACTIVE_CLASSES_CONFIG_CACHE_TTL = 5 * 60 * 1000;
let MASTER_CLASSES_FETCH_PROMISE = null;
let ACTIVE_CLASSES_FETCH_PROMISE = null;

function normalizeClassesSetting(setting) {
    if (Array.isArray(setting)) return setting;
    return Array.isArray(setting?.list) ? setting.list : null;
}

/**
 * fetchMasterClassesList() — Mengambil master list kelas dengan in-flight promise memoization
 * untuk mencegah multiple fetch Firestore paralel jika dipanggil bersamaan saat cache kosong.
 */
async function fetchMasterClassesList() {
    const KELAS_CACHE_KEY = 'simas_kelas_list_cache';
    let masterList = window.getLocalCache(KELAS_CACHE_KEY);
    if (masterList && Array.isArray(masterList) && masterList.length > 0) {
        return masterList;
    }

    if (MASTER_CLASSES_FETCH_PROMISE) {
        return MASTER_CLASSES_FETCH_PROMISE;
    }

    MASTER_CLASSES_FETCH_PROMISE = (async () => {
        try {
            // Cek ulang cache jika ada thread yang selesai menulis
            masterList = window.getLocalCache(KELAS_CACHE_KEY);
            if (masterList && Array.isArray(masterList) && masterList.length > 0) {
                return masterList;
            }

            // Ambil dari Cloudflare D1 system_settings (0 Firestore Read)
            if (window.cfClient && window.cfClient.enabled) {
                const res = await window.cfClient.getSystemSetting('metadata_classes');
                if (res && Array.isArray(res.list) && res.list.length > 0) {
                    masterList = res.list;
                    window.setLocalCache(KELAS_CACHE_KEY, masterList);
                    console.log('🔄 [getActiveClasses] Master list loaded from Cloudflare D1 & cached');
                    return masterList;
                }
            }
            return [];
        } catch (e) {
            console.error('[fetchMasterClassesList] Error fetching metadata_classes from D1:', e);
            return [];
        } finally {
            MASTER_CLASSES_FETCH_PROMISE = null;
        }
    })();

    return MASTER_CLASSES_FETCH_PROMISE;
}

/**
 * fetchActiveClassesList() — Mengambil filter kelas aktif dari D1.
 * Nilai null berarti konfigurasi belum tersedia; pemanggil akan memakai
 * seluruh metadata kelas sebagai default yang aman.
 */
async function fetchActiveClassesList() {
    const cached = window.getLocalCache(ACTIVE_CLASSES_CONFIG_CACHE_KEY, ACTIVE_CLASSES_CONFIG_CACHE_TTL);
    if (Array.isArray(cached)) return cached;

    if (ACTIVE_CLASSES_FETCH_PROMISE) return ACTIVE_CLASSES_FETCH_PROMISE;

    ACTIVE_CLASSES_FETCH_PROMISE = (async () => {
        try {
            if (window.cfClient && window.cfClient.enabled) {
                const setting = await window.cfClient.getSystemSetting('active_classes');
                const activeList = normalizeClassesSetting(setting);
                if (Array.isArray(activeList)) {
                    window.setLocalCache(ACTIVE_CLASSES_CONFIG_CACHE_KEY, activeList);
                    return activeList;
                }
            }
            return null;
        } catch (e) {
            console.warn('[fetchActiveClassesList] Konfigurasi kelas aktif D1 belum tersedia:', e);
            return null;
        } finally {
            ACTIVE_CLASSES_FETCH_PROMISE = null;
        }
    })();

    return ACTIVE_CLASSES_FETCH_PROMISE;
}

/**
 * getActiveClasses() — Fungsi terpusat untuk mendapatkan daftar kelas aktif.
 * Menggabungkan metadata_classes + active_classes dari Cloudflare D1.
 * Menggunakan cache localStorage agar hemat kuota read D1.
 *
 * @param {Object} options
 * @param {string} options.gradeFilter - Filter by tingkat (misal 'XII', 'X')
 * @param {boolean} options.bypassActiveFilter - Jika true, abaikan filter kelas aktif (untuk halaman settings)
 * @returns {Promise<string[]>} Array nama kelas yang sudah difilter & sorted
 */
window.getActiveClasses = async function (options = {}) {
    const { gradeFilter = '', bypassActiveFilter = false } = options;

    try {
        // 1. Ambil master list kelas dari cache atau Firestore (dengan in-flight promise deduplication)
        const masterList = await fetchMasterClassesList();
        if (!masterList || masterList.length === 0) {
            return [];
        }

        // 2. D1 adalah satu-satunya sumber filter kelas aktif.
        const activeClasses = bypassActiveFilter ? null : await fetchActiveClassesList();

        // metadata_classes dari backend sudah mengecualikan alumni/mutasi/keluar.
        let result = [...masterList];

        // 3. Filter Kelas Aktif (kecuali bypass)
        if (!bypassActiveFilter && Array.isArray(activeClasses) && activeClasses.length > 0) {
            result = result.filter(c => activeClasses.includes(c));
        }

        // 4. Filter by tingkat (jika disediakan)
        if (gradeFilter) {
            // Precise matching: X must not be followed by I (to avoid XI and XII)
            if (gradeFilter === 'X') {
                result = result.filter(c => c.startsWith('X') && !c.startsWith('XI'));
            } else {
                result = result.filter(c => c.startsWith(gradeFilter));
            }
        }

        // 5. Sort natural
        result.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        return result;

    } catch (e) {
        console.error('[getActiveClasses] Error:', e);
        return [];
    }
};

/**
 * invalidateActiveClassesCache() — Hapus cache konfigurasi kelas aktif.
 * Panggil setelah admin mengubah pengaturan kelas aktif di settings.
 */
window.invalidateActiveClassesCache = function () {
    try {
        localStorage.removeItem('simas_kelas_list_cache');
        localStorage.removeItem(ACTIVE_CLASSES_CONFIG_CACHE_KEY);
        MASTER_CLASSES_FETCH_PROMISE = null;
        ACTIVE_CLASSES_FETCH_PROMISE = null;
        console.log('🗑️ [invalidateActiveClassesCache] Class list and active classes config caches cleared');
    } catch (e) { }
};

// --- ACADEMIC YEAR & SEMESTER HELPERS ---
window.getCurrentAcademicYearString = function (dateDate = new Date()) {
    const month = dateDate.getMonth(); // 0-11
    const year = dateDate.getFullYear();
    const startYear = (month >= 6) ? year : year - 1; // Juli(6) ke atas = TA baru
    return `${startYear}/${startYear + 1}`;
};

window.getCurrentSemester = function (dateDate = new Date()) {
    const month = dateDate.getMonth();
    // Ganjil (1): Juli(6) - Desember(11)
    // Genap (2): Januari(0) - Juni(5)
    return (month >= 6) ? '1' : '2';
};

/**
 * Validasi Sentral SSOT: Memvalidasi panjang 16 digit angka untuk NIK dan No KK serta
 * memastikan NIK Siswa, NIK Orang Tua (Ayah, Ibu, Wali), dan No KK tidak boleh bernilai sama satu sama lain.
 * @param {Object} data - Objek data kependudukan siswa
 * @param {string} [data.nik] - NIK Siswa
 * @param {string} [data.kk_no] - No Kartu Keluarga (KK)
 * @param {string} [data.father_nik] - NIK Ayah
 * @param {string} [data.mother_nik] - NIK Ibu
 * @param {string} [data.guardian_nik] - NIK Wali
 * @returns {{ valid: boolean, message: string|null, field: string|null }}
 */
window.validateStudentIdentityNumbers = function (data = {}, options = {}) {
    const cleanStr = (v) => (v !== undefined && v !== null ? String(v).replace(/[\s\-_.]/g, '').trim() : '');

    const fields = [
        { key: 'nik', label: 'NIK Siswa', val: cleanStr(data.nik || data.nik_siswa) },
        { key: 'kk_no', label: 'Nomor Kartu Keluarga (No. KK)', val: cleanStr(data.kk_no || data.no_kk || data.kkNumber) },
        { key: 'father_nik', label: 'NIK Ayah', val: cleanStr(data.father_nik || data.nik_ayah) },
        { key: 'mother_nik', label: 'NIK Ibu', val: cleanStr(data.mother_nik || data.nik_ibu) },
        { key: 'guardian_nik', label: 'NIK Wali', val: cleanStr(data.guardian_nik || data.nik_wali) }
    ];

    const isPartialAllowed = options.allowPartial === true || options.isEdit === true;

    // 1. Validasi Format & Panjang
    for (const item of fields) {
        if (item.val && item.val !== '-') {
            if (!/^\d+$/.test(item.val)) {
                return {
                    valid: false,
                    message: `${item.label} hanya boleh berisi angka (tanpa huruf atau simbol).`,
                    field: item.key
                };
            }
            // Jika mode parsial (edit data siswa): biarkan data terisi sebagian (1 - 16 digit).
            // Jika bukan mode parsial (tambah manual strict): wajib tepat 16 digit.
            if (!isPartialAllowed && item.val.length !== 16) {
                return {
                    valid: false,
                    message: `${item.label} harus terdiri dari tepat 16 digit angka (saat ini ${item.val.length} digit).`,
                    field: item.key
                };
            }
            if (item.val.length > 16) {
                return {
                    valid: false,
                    message: `${item.label} tidak boleh melebihi 16 digit angka (saat ini ${item.val.length} digit).`,
                    field: item.key
                };
            }
        }
    }

    // 2. Validasi Keunikan Nilai Antar Field (Hanya dicek jika sama-sama terisi lengkap 16 digit dan bukan dummy)
    const filledExact = fields.filter(item => item.val && item.val !== '-' && item.val.length === 16 && !/^0+$/.test(item.val));
    for (let i = 0; i < filledExact.length; i++) {
        for (let j = i + 1; j < filledExact.length; j++) {
            if (filledExact[i].val === filledExact[j].val) {
                return {
                    valid: false,
                    message: `${filledExact[i].label} tidak boleh sama dengan ${filledExact[j].label}.`,
                    field: filledExact[j].key
                };
            }
        }
    }

    return { valid: true, message: null, field: null };
};

// Export untuk module import
export const parseUniversalDate = window.parseUniversalDate;
export const getLocalISODate = window.getLocalISODate;
export const getWitaISODate = window.getWitaISODate;
export const calculateAttendanceStats = window.calculateAttendanceStats;
export const formatDateIndo = window.formatDateIndo;
export const formatDateIndoFormal = window.formatDateIndoFormal;
export const formatDateIndoFull = window.formatDateIndoFormal;
export const escapeHTML = window.escapeHTML;
export const escapeHtml = window.escapeHTML;
export const getLocalCache = window.getLocalCache;
export const setLocalCache = window.setLocalCache;
export const getCurrentAcademicYearString = window.getCurrentAcademicYearString;
export const getCurrentSemester = window.getCurrentSemester;
export const validateStudentIdentityNumbers = window.validateStudentIdentityNumbers;

const MENU_CONFIG = {
    'super_admin': ['dashboard', 'agenda', 'agenda_pegawai', 'dokumen', 'jadwal', 'beban_kerja', 'peminatan_hasil', 'peminatan', 'input', 'guru_mapel_portal', 'guru_wali', 'wali_kelas', 'e_lab', 'e_rapor', 'rkas_komite', 'keuangan', 'bk_space', 'presensi', 'presensi_guru', 'monitoring_kbm', 'ranking_kelas', 'lib_sirkulasi', 'lib_katalog', 'lib_opac', 'lib_presensi', 'lib_bebas_pustaka', 'lib_laporan', 'lib_pengaturan', 'siswa', 'guru', 'kredit', 'users', 'integrasi', 'settings', 'game_pid', 'jurnal', 'penjualan_buku', 'pesan_lks', 'kapsul_waktu', 'duta_admin', 'yearbook_admin', 'suka_duka', 'sarpras_aduan', 'sarpras_rkas', 'sarpras_inventaris', 'sarpras_penggunaan', 'sarpras_pemeliharaan', 'masukan'],
    'admin_sarpras': ['dashboard', 'sarpras_aduan', 'sarpras_rkas', 'sarpras_inventaris', 'sarpras_penggunaan', 'sarpras_pemeliharaan', 'agenda', 'dokumen', 'jadwal', 'siswa', 'guru', 'ranking_kelas', 'masukan'],
    'admin_perpus': ['dashboard', 'lib_sirkulasi', 'lib_katalog', 'lib_opac', 'lib_presensi', 'lib_bebas_pustaka', 'lib_laporan', 'lib_pengaturan', 'jadwal', 'siswa', 'guru', 'ranking_kelas', 'masukan'],
    'kepala_sekolah': ['dashboard', 'agenda', 'agenda_pegawai', 'dokumen', 'jadwal', 'beban_kerja', 'input', 'guru_mapel_portal', 'guru_wali', 'wali_kelas', 'e_lab', 'rkas_komite', 'keuangan', 'bk_space', 'presensi', 'monitoring_kbm', 'ranking_kelas', 'lib_opac', 'lib_laporan', 'siswa', 'guru', 'kredit', 'suka_duka', 'sarpras_aduan', 'sarpras_rkas', 'sarpras_inventaris', 'sarpras_penggunaan', 'sarpras_pemeliharaan', 'masukan'],
    'wakasek_kurikulum': ['dashboard', 'agenda', 'dokumen', 'jadwal', 'beban_kerja', 'peminatan_hasil', 'peminatan', 'input', 'guru_mapel_portal', 'guru_wali', 'wali_kelas', 'e_lab', 'e_rapor', 'presensi', 'monitoring_kbm', 'ranking_kelas', 'lib_opac', 'lib_laporan', 'siswa', 'guru', 'kredit', 'users', 'jurnal', 'suka_duka', 'sarpras_aduan', 'sarpras_rkas', 'sarpras_inventaris', 'sarpras_penggunaan', 'sarpras_pemeliharaan', 'masukan'],
    'kepala_lab': ['dashboard', 'jadwal', 'beban_kerja', 'input', 'guru_mapel_portal', 'guru_wali', 'e_lab', 'presensi', 'ranking_kelas', 'siswa', 'guru', 'kredit', 'jurnal', 'suka_duka', 'masukan'],
    'kesiswaan': ['dashboard', 'agenda', 'dokumen', 'jadwal', 'beban_kerja', 'peminatan_hasil', 'peminatan', 'input', 'guru_wali', 'wali_kelas', 'e_lab', 'e_rapor', 'rkas_komite', 'keuangan', 'presensi', 'monitoring_kbm', 'ranking_kelas', 'lib_opac', 'siswa', 'guru', 'kredit', 'users', 'duta_admin', 'yearbook_admin', 'suka_duka', 'sarpras_aduan', 'sarpras_penggunaan', 'masukan'],
    'humas': ['dashboard', 'agenda', 'dokumen', 'jadwal', 'beban_kerja', 'input', 'guru_mapel_portal', 'guru_wali', 'wali_kelas', 'e_lab', 'presensi', 'monitoring_kbm', 'ranking_kelas', 'lib_opac', 'siswa', 'guru', 'kredit', 'suka_duka', 'sarpras_aduan', 'sarpras_penggunaan', 'masukan'],
    'sarpras': ['dashboard', 'sarpras_aduan', 'sarpras_rkas', 'sarpras_inventaris', 'sarpras_penggunaan', 'sarpras_pemeliharaan', 'agenda', 'dokumen', 'jadwal', 'beban_kerja', 'input', 'guru_mapel_portal', 'guru_wali', 'wali_kelas', 'e_lab', 'presensi', 'monitoring_kbm', 'ranking_kelas', 'lib_opac', 'siswa', 'guru', 'kredit', 'suka_duka', 'masukan'],
    'admin_spp': ['dashboard', 'jadwal', 'input', 'rkas_komite', 'keuangan', 'presensi', 'ranking_kelas', 'siswa', 'guru', 'kredit', 'suka_duka', 'masukan'],
    'wali_kelas': ['dashboard', 'jadwal', 'beban_kerja', 'input', 'guru_mapel_portal', 'guru_wali', 'wali_kelas', 'e_lab', 'e_rapor', 'presensi', 'monitoring_kbm', 'ranking_kelas', 'lib_opac', 'lib_presensi', 'siswa', 'guru', 'kredit', 'yearbook_admin', 'suka_duka', 'sarpras_aduan', 'sarpras_penggunaan', 'masukan'],
    'staff': ['dashboard', 'agenda', 'agenda_pegawai', 'dokumen', 'jadwal', 'input', 'e_lab', 'presensi', 'monitoring_kbm', 'ranking_kelas', 'lib_sirkulasi', 'lib_katalog', 'lib_opac', 'lib_presensi', 'lib_bebas_pustaka', 'siswa', 'guru', 'kredit', 'users', 'suka_duka', 'sarpras_aduan', 'sarpras_inventaris', 'sarpras_penggunaan', 'masukan'],
    'guru_mapel': ['dashboard', 'agenda', 'dokumen', 'jadwal', 'beban_kerja', 'input', 'guru_mapel_portal', 'guru_wali', 'e_lab', 'e_rapor', 'presensi', 'monitoring_kbm', 'ranking_kelas', 'lib_opac', 'lib_presensi', 'siswa', 'guru', 'kredit', 'game_pid', 'suka_duka', 'sarpras_aduan', 'sarpras_penggunaan', 'masukan'],
    'guru_bk': ['dashboard', 'jadwal', 'beban_kerja', 'peminatan_hasil', 'peminatan', 'input', 'guru_wali', 'e_lab', 'bk_space', 'presensi', 'monitoring_kbm', 'ranking_kelas', 'lib_opac', 'lib_presensi', 'siswa', 'guru', 'kredit', 'game_pid', 'suka_duka', 'sarpras_aduan', 'sarpras_penggunaan', 'masukan'],
    'admin_pks': ['dashboard', 'jadwal', 'input', 'ranking_kelas', 'lib_opac', 'siswa', 'kredit', 'sarpras_aduan', 'masukan'],
    'admin_kelas': ['dashboard', 'jadwal', 'presensi', 'presensi_guru', 'ranking_kelas', 'pesan_lks', 'lib_opac', 'kredit', 'sarpras_aduan', 'masukan'],
    'siswa': ['dashboard', 'jadwal', 'presensi', 'ranking_kelas', 'peminatan', 'lib_opac', 'lib_presensi', 'kredit', 'sarpras_aduan', 'sarpras_penggunaan'],
    'admin_sukaduka': ['dashboard', 'jadwal', 'ranking_kelas', 'suka_duka', 'masukan'],
    'admin_duta': ['dashboard', 'jadwal', 'ranking_kelas', 'duta_admin'],
    'admin_dapodik': ['dashboard', 'siswa', 'jadwal', 'ranking_kelas', 'masukan'],
    'admin_lks': ['dashboard', 'jadwal', 'ranking_kelas', 'penjualan_buku', 'masukan']
};

const PAGE_ACCESS_CONFIG = {
    'sarpras-inventaris.html': {
        'super_admin': 'rw', 'sarpras': 'rw', 'admin_sarpras': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'r', 'staff': 'r', 'guru_mapel': 'r', 'wali_kelas': 'r'
    },
    'sarpras-aduan.html': {
        'super_admin': 'rw', 'sarpras': 'rw', 'admin_sarpras': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'rw', 'kesiswaan': 'rw', 'humas': 'rw', 'staff': 'rw', 'guru_mapel': 'rw', 'wali_kelas': 'rw', 'siswa': 'rw', 'admin_kelas': 'rw', 'admin_pks': 'rw'
    },
    'sarpras-rkas.html': {
        'super_admin': 'rw', 'sarpras': 'rw', 'admin_sarpras': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'r', 'staff': 'r', 'guru_mapel': 'r', 'wali_kelas': 'r'
    },
    'sarpras-penggunaan.html': {
        'super_admin': 'rw', 'sarpras': 'rw', 'admin_sarpras': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'rw', 'kesiswaan': 'rw', 'humas': 'rw', 'staff': 'rw', 'guru_mapel': 'rw', 'wali_kelas': 'rw', 'siswa': 'rw'
    },
    'sarpras-pemeliharaan.html': {
        'super_admin': 'rw', 'sarpras': 'rw', 'admin_sarpras': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'r', 'staff': 'r', 'guru_mapel': 'r', 'wali_kelas': 'r'
    },
    'wali-kelas.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'r', 'kesiswaan': 'r', 'wali_kelas': 'rw'
    },
    'yearbook-admin.html': {
        'super_admin': 'rw', 'kesiswaan': 'rw', 'wali_kelas': 'rw', 'kepala_sekolah': 'r'
    },
    'integrasi.html': {
        'super_admin': 'rw'
    },
    'masukan.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'rw', 'wakasek_kurikulum': 'rw', 'kesiswaan': 'rw', 'kepala_lab': 'rw',
        'humas': 'rw', 'sarpras': 'rw', 'admin_sarpras': 'rw',
        'admin_spp': 'r', 'admin_perpus': 'r', 'wali_kelas': 'r', 'staff': 'r', 'guru_mapel': 'r', 'guru_bk': 'r',
        'admin_pks': 'r', 'admin_kelas': 'r', 'admin_sukaduka': 'r', 'admin_duta': 'r', 'admin_dapodik': 'r', 'admin_lks': 'r'
    },
    'suka-duka.html': {
        'super_admin': 'rw', 'admin_sukaduka': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'r', 'kesiswaan': 'r', 'admin_spp': 'r', 'wali_kelas': 'r', 'staff': 'r', 'guru_mapel': 'r', 'guru_bk': 'r'
    },
    'duta-admin.html': {
        'super_admin': 'rw', 'kesiswaan': 'rw', 'admin_duta': 'rw'
    },
    'dashboard.html': {
        'super_admin': 'y', 'admin_perpus': 'y', 'kepala_sekolah': 'y', 'wakasek_kurikulum': 'y', 'kepala_lab': 'y', 'kesiswaan': 'y',
        'humas': 'y', 'sarpras': 'y', 'admin_sarpras': 'y',
        'admin_spp': 'y', 'wali_kelas': 'y',
        'guru_bk': 'y', 'guru_mapel': 'y', 'staff': 'y', 'admin_kelas': 'ym', 'admin_pks': 'y', 'siswa': 'ym', 'admin_sukaduka': 'y', 'admin_duta': 'y', 'admin_dapodik': 'y', 'admin_lks': 'y'
    },
    'library/index.html': {
        'super_admin': 'rw', 'admin_perpus': 'rw', 'staff': 'rw', 'kepala_sekolah': 'r'
    },
    'library/katalog.html': {
        'super_admin': 'rw', 'admin_perpus': 'rw', 'staff': 'rw', 'kepala_sekolah': 'r'
    },
    'library/opac.html': {
        'super_admin': 'rw', 'admin_perpus': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'r', 'staff': 'r', 'wali_kelas': 'r', 'guru_mapel': 'r', 'guru_bk': 'r', 'admin_pks': 'r', 'admin_kelas': 'r', 'siswa': 'r'
    },
    'library/presensi-perpus.html': {
        'super_admin': 'rw', 'admin_perpus': 'rw', 'staff': 'rw', 'kepala_sekolah': 'r', 'guru_mapel': 'rw', 'wali_kelas': 'rw', 'siswa': 'rw'
    },
    'library/bebas-pustaka.html': {
        'super_admin': 'rw', 'admin_perpus': 'rw', 'staff': 'rw', 'kepala_sekolah': 'r'
    },
    'library/laporan.html': {
        'super_admin': 'rw', 'admin_perpus': 'rw', 'kepala_sekolah': 'r', 'staff': 'r'
    },
    'library/pengaturan.html': {
        'super_admin': 'rw', 'admin_perpus': 'rw'
    },
    'agenda.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'rw', 'wakasek_kurikulum': 'rw', 'kepala_lab': 'rw', 'kesiswaan': 'rw', 'admin_spp': 'x', 'wali_kelas': 'x',
        'guru_bk': 'x', 'guru_mapel': 'r', 'staff': 'r', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'dokumen.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'rw', 'wakasek_kurikulum': 'rw', 'kurikulum': 'rw', 'tim_kurikulum': 'rw', 'kepala_lab': 'rw', 'kesiswaan': 'rw', 'admin_spp': 'x', 'wali_kelas': 'x',
        'guru_bk': 'x', 'guru_mapel': 'r', 'staff': 'r', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'agenda-pegawai.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'rw', 'staff': 'rw', 'tendik': 'rw', 'pegawai': 'rw', 'wakasek_kurikulum': 'x', 'kepala_lab': 'x', 'kesiswaan': 'x', 'admin_spp': 'x', 'wali_kelas': 'x',
        'guru_bk': 'x', 'guru_mapel': 'x', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'e-kinerja-tendik.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'rw', 'staff': 'rw', 'tendik': 'rw', 'pegawai': 'rw', 'wakasek_kurikulum': 'x', 'kepala_lab': 'x', 'kesiswaan': 'x', 'admin_spp': 'x', 'wali_kelas': 'x',
        'guru_bk': 'x', 'guru_mapel': 'x', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'e-kinerja.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'rw', 'wakasek_kurikulum': 'rw', 'guru_mapel': 'rw', 'guru_bk': 'rw', 'wali_kelas': 'rw',
        'kepala_lab': 'rw', 'kesiswaan': 'rw', 'admin_spp': 'x', 'staff': 'x', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'beban-kerja.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'rw', 'wakasek_kurikulum': 'rw', 'guru_mapel': 'rw', 'guru_bk': 'rw', 'wali_kelas': 'rw',
        'kepala_lab': 'rw', 'kesiswaan': 'rw', 'admin_spp': 'x', 'staff': 'x', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'monitoring-beban-kerja.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'rw', 'wakasek_kurikulum': 'r', 'kepala_lab': 'x', 'kesiswaan': 'x',
        'admin_spp': 'x', 'wali_kelas': 'x', 'guru_bk': 'x', 'guru_mapel': 'x', 'staff': 'x', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'siswa.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'rw', 'kepala_lab': 'r', 'kesiswaan': 'rw', 'admin_spp': 'rw', 'wali_kelas': 'rw',
        'guru_bk': 'rw', 'guru_mapel': 'rw', 'staff': 'rw', 'admin_dapodik': 'rw', 'admin_kelas': 'x', 'admin_pks': 'r', 'siswa': 'x'
    },
    'gtk.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'rw', 'kepala_lab': 'r', 'kesiswaan': 'rw', 'admin_spp': 'rw', 'wali_kelas': 'r',
        'guru_bk': 'r', 'guru_mapel': 'r', 'staff': 'rw', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'guru.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'rw', 'kepala_lab': 'r', 'kesiswaan': 'rw', 'admin_spp': 'rw', 'wali_kelas': 'r',
        'guru_bk': 'r', 'guru_mapel': 'r', 'staff': 'rw', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'presensi.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'r', 'kesiswaan': 'r', 'admin_spp': 'x', 'wali_kelas': 'rwm',
        'guru_bk': 'r', 'guru_mapel': 'r', 'staff': 'r', 'admin_kelas': 'rwm', 'admin_pks': 'x', 'siswa': 'r'
    },
    'input.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'rw', 'kesiswaan': 'rw', 'admin_spp': 'x', 'wali_kelas': 'rw',
        'guru_bk': 'rw', 'guru_mapel': 'rw', 'staff': 'rw', 'admin_kelas': 'x', 'admin_pks': 'rw', 'siswa': 'x'
    },
    'kredit.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'r', 'kesiswaan': 'rw', 'admin_spp': 'x', 'wali_kelas': 'r',
        'guru_bk': 'rw', 'guru_mapel': 'r', 'staff': 'rw', 'admin_kelas': 'r', 'admin_pks': 'r', 'siswa': 'r'
    },
    'users.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'rw', 'kesiswaan': 'rw', 'admin_spp': 'x', 'wali_kelas': 'x',
        'guru_bk': 'x', 'guru_mapel': 'x', 'staff': 'rw', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'keuangan.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'r', 'kesiswaan': 'r', 'admin_spp': 'rw', 'wali_kelas': 'x',
        'guru_bk': 'x', 'guru_mapel': 'x', 'staff': 'x', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'rkas-komite.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'r', 'kesiswaan': 'r', 'admin_spp': 'rw', 'wali_kelas': 'x',
        'guru_bk': 'x', 'guru_mapel': 'x', 'staff': 'x', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'bk.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'r', 'kesiswaan': 'x', 'admin_spp': 'x', 'wali_kelas': 'x',
        'guru_bk': 'rw', 'guru_mapel': 'x', 'staff': 'x', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'peminatan.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'r', 'kesiswaan': 'x', 'admin_spp': 'x', 'wali_kelas': 'x',
        'guru_bk': 'r', 'guru_mapel': 'x', 'staff': 'x', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'rw'
    },
    'settings.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'x', 'wakasek_kurikulum': 'x', 'kepala_lab': 'x', 'kesiswaan': 'x', 'admin_spp': 'x', 'wali_kelas': 'x',
        'guru_bk': 'x', 'guru_mapel': 'x', 'staff': 'x', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'penjualan-buku.html': {
        'super_admin': 'rw', 'admin_lks': 'rw', 'kepala_sekolah': 'x', 'wakasek_kurikulum': 'x', 'kepala_lab': 'x', 'kesiswaan': 'x', 'admin_spp': 'x', 'wali_kelas': 'x',
        'guru_bk': 'x', 'guru_mapel': 'x', 'staff': 'x', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'pesan-lks.html': {
        'super_admin': 'rw', 'admin_kelas': 'rw', 'admin_lks': 'x', 'kepala_sekolah': 'x', 'wakasek_kurikulum': 'x', 'kepala_lab': 'x', 'kesiswaan': 'x', 'admin_spp': 'x', 'wali_kelas': 'x',
        'guru_bk': 'x', 'guru_mapel': 'x', 'staff': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'e-lab.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'r', 'kepala_lab': 'rw', 'kesiswaan': 'rw', 'admin_spp': 'x', 'wali_kelas': 'rw',
        'guru_bk': 'rw', 'guru_mapel': 'rw', 'staff': 'rw', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'guru-wali.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'r', 'kepala_lab': 'rw', 'kesiswaan': 'r', 'admin_spp': 'x', 'wali_kelas': 'rw',
        'guru_bk': 'rw', 'guru_mapel': 'rw', 'staff': 'x', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'e-rapor.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'x', 'wakasek_kurikulum': 'rw', 'kepala_lab': 'x', 'kesiswaan': 'rw', 'admin_spp': 'x', 'wali_kelas': 'rw',
        'guru_bk': 'x', 'guru_mapel': 'rw', 'staff': 'x', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'presensi-guru.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'x', 'wakasek_kurikulum': 'x', 'kepala_lab': 'x', 'kesiswaan': 'x', 'admin_spp': 'x', 'wali_kelas': 'x',
        'guru_bk': 'x', 'guru_mapel': 'x', 'staff': 'x', 'admin_kelas': 'rw', 'admin_pks': 'x', 'siswa': 'x'
    },
    'monitoring-kbm.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'r', 'kepala_lab': 'x', 'kesiswaan': 'r', 'admin_spp': 'x', 'wali_kelas': 'r',
        'guru_bk': 'r', 'guru_mapel': 'r', 'staff': 'r', 'admin_kelas': 'x', 'admin_pks': 'x', 'siswa': 'x'
    },
    'ranking-kelas.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'r', 'kesiswaan': 'r', 'kepala_lab': 'r',
        'admin_spp': 'r', 'admin_perpus': 'r', 'wali_kelas': 'r', 'staff': 'r', 'guru_mapel': 'r',
        'guru_bk': 'r', 'admin_pks': 'r', 'admin_kelas': 'r', 'admin_sukaduka': 'r', 'admin_duta': 'r', 'admin_dapodik': 'r', 'admin_lks': 'r',
        'siswa': 'r'
    },
    'peminatan-hasil.html': {
        'super_admin': 'rw', 'guru_bk': 'rw', 'wakasek_kurikulum': 'r', 'kesiswaan': 'r'
    },
    'guru-mapel.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'rw', 'wali_kelas': 'rw', 'guru_mapel': 'rw'
    },
    'jadwal.html': {
        'super_admin': 'rw', 'kepala_sekolah': 'r', 'wakasek_kurikulum': 'rw', 'kepala_lab': 'r', 'kesiswaan': 'r', 'admin_spp': 'r', 'wali_kelas': 'r',
        'guru_bk': 'r', 'guru_mapel': 'r', 'staff': 'r', 'admin_kelas': 'r', 'admin_pks': 'r', 'siswa': 'r', 'admin_sukaduka': 'r', 'admin_duta': 'r', 'admin_dapodik': 'r', 'admin_lks': 'r'
    },
    'jurnal-admin.html': {
        'super_admin': 'rw', 'wakasek_kurikulum': 'rw', 'kepala_lab': 'rw'
    }
    // Edit Profil handled by UI logic
};

// =====================================
// MULTI-ROLE HELPER FUNCTIONS
// =====================================

// HELPER: Ambil semua role user (primary + additional)
window.getAllUserRoles = function () {
    const primaryRole = localStorage.getItem('user_role');
    let additionalRoles = [];
    try {
        additionalRoles = JSON.parse(localStorage.getItem('user_additional_roles') || '[]');
    } catch (e) {
        additionalRoles = [];
    }

    const allRoles = primaryRole ? [primaryRole, ...additionalRoles] : additionalRoles;
    return [...new Set(allRoles)]; // Remove duplicates
};

// HELPER: Cek apakah user memiliki role tertentu (Multi-Role Support)
window.hasRole = function (targetRole) {
    const allRoles = window.getAllUserRoles();
    return allRoles.includes(targetRole);
};

// HELPER: Ambil role terbaik untuk halaman tertentu (akses tertinggi)
// Priority: 'rw' > 'rwm' > 'r' > 'ym' > 'y' > 'x'/undefined
window.getEffectiveRoleForPage = function (page) {
    const allRoles = window.getAllUserRoles();
    const pageConfig = PAGE_ACCESS_CONFIG[page];

    if (!pageConfig) return allRoles[0] || null;

    // Priority order for access codes
    const accessPriority = { 'rw': 6, 'rwm': 5, 'r': 4, 'ym': 3, 'y': 2, 'x': 0 };

    let bestRole = null;
    let bestPriority = -1;

    allRoles.forEach(role => {
        const access = pageConfig[role];
        const priority = accessPriority[access] || 0;
        if (priority > bestPriority) {
            bestPriority = priority;
            bestRole = role;
        }
    });

    return bestRole;
};

// HELPER: Cek otorisasi dinamis menu & halaman Ranking Kelas (Super Admin Configurable via D1)
function isRankingKelasAllowedForUser() {
    const allRoles = window.getAllUserRoles ? window.getAllUserRoles() : [];
    // Super Admin dan Kepala Sekolah selalu memiliki akses mutlak (tidak pernah terblokir)
    if (allRoles.includes('super_admin') || allRoles.includes('kepala_sekolah')) return true;

    let cfg = null;
    try {
        const cachedStr = localStorage.getItem('simas_ranking_access_config');
        if (cachedStr) cfg = JSON.parse(cachedStr);
    } catch (e) {}

    // Default: jika belum pernah diubah di D1, izinkan sesuai konfigurasi awal
    if (!cfg || !cfg.mode || cfg.mode === 'all') return true;

    const allowedRoles = Array.isArray(cfg.allowed_roles) ? cfg.allowed_roles : [];
    const allowedUsers = (Array.isArray(cfg.allowed_users) ? cfg.allowed_users : []).map(u => String(u || '').toLowerCase().trim());

    const userIdentifiers = [
        (localStorage.getItem('user_email') || '').toLowerCase().trim(),
        (localStorage.getItem('user_username') || '').toLowerCase().trim(),
        (localStorage.getItem('user_nip') || '').trim(),
        (localStorage.getItem('user_nis') || '').trim(),
        (localStorage.getItem('user_uid') || '').trim()
    ].filter(Boolean);

    const roleMatch = allRoles.some(r => allowedRoles.includes(r));
    const userMatch = userIdentifiers.some(id => allowedUsers.includes(id));

    if (cfg.mode === 'roles') {
        return roleMatch;
    } else if (cfg.mode === 'specific_users') {
        return userMatch;
    } else if (cfg.mode === 'combined') {
        return roleMatch || userMatch;
    }
    return true;
}
window.isRankingKelasAllowedForUser = isRankingKelasAllowedForUser;

// HELPER: Cek apakah user punya akses ke halaman (any role)
window.hasPageAccess = function (page) {
    const allRoles = window.getAllUserRoles();
    const pageConfig = PAGE_ACCESS_CONFIG[page];

    if ((page === 'ranking-kelas.html' || page === 'ranking-kelas') && typeof isRankingKelasAllowedForUser === 'function') {
        if (!isRankingKelasAllowedForUser()) return false;
    }

    if (!pageConfig) return true; // Halaman tidak terdaftar = default allow

    // Cek setiap role, jika salah satu punya akses selain 'x', return true
    return allRoles.some(role => {
        const access = pageConfig[role];
        return access && access !== 'x';
    });
};

// =====================================
// END MULTI-ROLE HELPERS
// =====================================

// --- GLOBAL ACCESS GUARD (ANTI-FLICKER) - MULTI-ROLE SUPPORT ---
window.checkPageAccess = function () {
    const isLibrarySubdir = window.location.pathname.includes('/library/');
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const pageKey = isLibrarySubdir ? `library/${currentPage}` : currentPage;

    // Bypass untuk halaman publik/login root atau halaman yang memiliki auth guard internal sendiri
    if (!isLibrarySubdir && (currentPage === 'index.html' || currentPage === '' || currentPage === 'peminatan.html' || currentPage === 'portal-siswa.html')) return;

    // Sembunyikan body agar tidak flicker
    document.body.style.display = 'none';

    // Safety Fallback Timer: Pastikan body selalu terbuka (maks 3s) agar tidak ada kasus blank screen permanen
    setTimeout(() => {
        if (document.body && document.body.style.display === 'none') {
            document.body.style.display = 'block';
        }
    }, 3000);

    // Ambil Role (Prioritas: LocalStorage agar cepat)
    const role = localStorage.getItem('user_role');

    // Jika tidak ada role tersimpan di LocalStorage (misal peranti baru membuka PWA via klik notifikasi), 
    // tampilkan body agar tidak tertahan tersembunyi (blank screen) sampai Auth Listener selesai memverifikasi
    if (!role) {
        document.body.style.display = 'block';
        return;
    }

    // Cek Permission dengan MULTI-ROLE support
    const targetConfig = PAGE_ACCESS_CONFIG[pageKey] || PAGE_ACCESS_CONFIG[currentPage];
    if (targetConfig) {
        // Gunakan hasPageAccess untuk cek semua role
        const hasAccess = window.hasPageAccess(pageKey) || window.hasPageAccess(currentPage);
        if (!hasAccess) {
            console.warn(`Akses ditolak ke ${pageKey} untuk semua role user`);
            window.location.replace(`${ROOT_URL}dashboard.html`);
            return;
        }
    }

    // Jika lolos, tampilkan konten
    document.body.style.display = 'block';
};

// Jalankan Immediate Guard
window.checkPageAccess();

// --- CENTRALIZED MAINTENANCE MODE REAL-TIME TRACKING ---
window.initMaintenanceListener = function () {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    
    // Jangan pasang listener di index.html root atau peminatan.html jika tidak perlu memblokir overlay penuh
    if (window.location.pathname === '/' || currentPage === 'index.html' && !window.location.pathname.includes('/library/') || currentPage === '' || currentPage === 'peminatan.html') return;

    // Untuk super_admin, abaikan pengecekan pemblokiran agar tetap bisa mengakses
    const allRoles = window.getAllUserRoles ? window.getAllUserRoles() : [];
    if (allRoles.includes('super_admin')) return;

    try {
        onSnapshot(doc(db, PATHS.settings, 'system_config'), (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                // Populate system config cache dari real-time listener
                _systemConfigCache = data;
                _systemConfigTs = Date.now();
                window.setLocalCache('simas_system_config_cache', data);
                if (data.geminiModel) localStorage.setItem('simas_gemini_model', data.geminiModel);
                if (data.geminiDisplayName) {
                    localStorage.setItem('simas_gemini_display_name', data.geminiDisplayName);
                    const badgeLabels = document.querySelectorAll('#gemini-badge-label, #rapor-gemini-badge-label, .ai-badge-label');
                    badgeLabels.forEach(el => { if (el) el.textContent = data.geminiDisplayName; });
                }
                if (data.maintenanceMode) {
                    showMaintenanceOverlay();
                } else {
                    removeMaintenanceOverlay();
                }
            }
        }, (error) => {
            console.error("[Maintenance] Gagal mendengarkan status pemeliharaan:", error);
        });
    } catch (e) {
        console.error("[Maintenance] Error inisialisasi listener:", e);
    }
};

function showMaintenanceOverlay() {
    if (document.getElementById('maintenance-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'maintenance-overlay';
    overlay.className = 'fixed inset-0 z-[99999] bg-slate-900 flex flex-col items-center justify-center p-6 text-center select-none';
    overlay.innerHTML = `
        <div class="max-w-md w-full bg-slate-800/80 border border-slate-700/50 rounded-3xl p-8 backdrop-blur-md shadow-2xl text-white">
            <div class="w-20 h-20 bg-red-500/10 border border-red-500/30 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <i class="fa-solid fa-screwdriver-wrench text-4xl animate-pulse"></i>
            </div>
            <h2 class="text-2xl font-bold text-white mb-3">Sistem Sedang Dipelihara</h2>
            <div class="w-16 h-1 bg-red-500 rounded-full mx-auto mb-4"></div>
            <p class="text-sm text-slate-300 leading-relaxed mb-6">
                Mohon maaf atas ketidaknyamanannya. SIMAS SMANTARA sedang dalam pemeliharaan rutin tahunan (reset data tahun ajaran baru) untuk meningkatkan performa layanan.
            </p>
            <div class="text-xs text-slate-500 border-t border-slate-700/50 pt-4">
                Silakan hubungi Super Admin untuk informasi lebih lanjut.
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
}

function removeMaintenanceOverlay() {
    const overlay = document.getElementById('maintenance-overlay');
    if (overlay) {
        overlay.remove();
        document.body.style.overflow = '';
    }
}

// Inisialisasi Listener Maintenance
window.initMaintenanceListener();

// --- PERMISSION HELPER (GRANULAR) - MULTI-ROLE SUPPORT ---
window.canDo = function (action, context = {}) {
    const allRoles = window.getAllUserRoles ? window.getAllUserRoles() : [];
    if (allRoles.length === 0) return false;

    // Super Admin Bypass (cek semua role)
    if (allRoles.includes('super_admin')) return true;

    // Presensi Logic
    if (action === 'edit_presensi') {
        // Cek apakah punya role yang bisa edit presensi
        const editRoles = ['wali_kelas', 'admin_kelas'];
        const canEdit = allRoles.some(r => editRoles.includes(r));

        if (!canEdit) return false; // Semua role-nya read-only (kesiswaan read-only)

        // Wali Kelas & Admin Kelas: Hanya kelas sendiri
        if (allRoles.includes('wali_kelas') || allRoles.includes('admin_kelas')) {
            const handledClass = localStorage.getItem('user_assigned_class');
            return (context.targetClass === handledClass) || (context.targetClass === localStorage.getItem('user_handled_class'));
        }
    }

    // User Management Logic - MULTI-ROLE ACCUMULATIVE ACCESS
    if (action === 'manage_user') {
        const targetRole = context.targetRole;
        let allowedTargetRoles = [];

        if (allRoles.includes('kesiswaan')) {
            allowedTargetRoles = [...allowedTargetRoles, 'admin_pks', 'admin_kelas', 'staff'];
        }
        if (allRoles.includes('staff')) {
            allowedTargetRoles = [...allowedTargetRoles, 'wali_kelas', 'guru_mapel', 'admin_kelas', 'admin_pks', 'staff'];
        }
        if (allRoles.includes('wakasek_kurikulum')) {
            allowedTargetRoles = [...allowedTargetRoles, 'wali_kelas', 'guru_mapel', 'admin_kelas', 'staff'];
        }

        // Hilangkan duplikasi
        allowedTargetRoles = [...new Set(allowedTargetRoles)];

        // Jika user memiliki role pengelola, lakukan filter target
        if (allRoles.some(r => ['kesiswaan', 'staff', 'wakasek_kurikulum'].includes(r))) {
            return allowedTargetRoles.includes(targetRole);
        }
    }

    return true;
};

export const canDo = window.canDo;
export const hasRole = window.hasRole;
export const getAllUserRoles = window.getAllUserRoles;

const currentGlobalPath = window.location.pathname.split('/').pop() || 'dashboard.html';
if (currentGlobalPath === 'agenda.html' || currentGlobalPath === 'dokumen.html' || currentGlobalPath === 'agenda-pegawai.html' || currentGlobalPath === 'e-kinerja-tendik.html') {
    localStorage.setItem('visited_agenda', 'true');
}
if (currentGlobalPath === 'portalpid.html') {
    localStorage.setItem('visited_game_pid', 'true');
}
const hasVisitedAgenda = localStorage.getItem('visited_agenda') === 'true';
const agendaBadgeHTML = '';
const gamePidBadgeHTML = '';

const MENU_LABELS = {
    'dashboard': { label: 'Dashboard', icon: 'fa-home', link: `${ROOT_URL}dashboard.html`, keywords: ['beranda', 'home', 'ringkasan', 'statistik'] },
    'agenda': { label: 'Kalender Agenda', icon: 'fa-calendar-days', link: `${ROOT_URL}agenda.html`, keywords: ['kalender', 'jadwal', 'kegiatan', 'acara'] },
    'beban_kerja': { label: 'E-Kinerja Guru', icon: 'fa-clipboard-check', link: `${ROOT_URL}e-kinerja.html`, keywords: ['kinerja', 'guru', 'skp', 'laporan harian', 'jurnal kerja', 'tugas'] },
    'monitoring_beban_kerja': { label: 'Monitoring E-Kinerja', icon: 'fa-chart-pie', link: `${ROOT_URL}e-kinerja.html?tab=monitoring`, keywords: ['pantau kinerja', 'rekap beban', 'verifikasi'] },
    'agenda_pegawai': { label: 'E-Kinerja Tendik', icon: 'fa-clipboard-user', link: `${ROOT_URL}e-kinerja-tendik.html`, keywords: ['tendik', 'pegawai', 'kinerja pegawai', 'staf', 'skp tendik'] },
    'e_kinerja_tendik': { label: 'E-Kinerja Tendik', icon: 'fa-clipboard-user', link: `${ROOT_URL}e-kinerja-tendik.html`, keywords: ['tendik', 'pegawai', 'kinerja pegawai', 'staf', 'skp tendik'] },
    'dokumen': { label: 'Dokumen', icon: 'fa-folder-open', link: `${ROOT_URL}dokumen.html`, keywords: ['arsip', 'file', 'berkas', 'surat', 'sk'] },
    'input': { label: 'Input Catatan', icon: 'fa-pen-to-square', link: `${ROOT_URL}input.html`, keywords: ['catatan', 'pelanggaran', 'poin', 'disiplin', 'tambah catatan'] },
    'siswa': { label: 'Data Siswa', icon: 'fa-users', link: `${ROOT_URL}siswa.html`, keywords: ['murid', 'peserta didik', 'data siswa', 'biodata'] },
    'gtk': { label: 'Data GTK', icon: 'fa-chalkboard-user', link: `${ROOT_URL}gtk.html`, keywords: ['guru', 'pegawai', 'ptk', 'tendik', 'tenaga kependidikan', 'data guru'] },
    'guru': { label: 'Data GTK', icon: 'fa-chalkboard-user', link: `${ROOT_URL}gtk.html`, keywords: ['guru', 'pegawai', 'ptk', 'tendik', 'tenaga kependidikan', 'data guru'] },
    'presensi': { label: 'Presensi Siswa', icon: 'fa-calendar-check', link: `${ROOT_URL}presensi.html`, keywords: ['absen', 'absensi', 'kehadiran siswa', 'hadir', 'bolos', 'izin'] },
    'presensi_guru': { label: 'Presensi Guru', icon: 'fa-user-clock', link: `${ROOT_URL}presensi-guru.html`, keywords: ['absen guru', 'kehadiran guru', 'fingerprint', 'hadir'] },
    'monitoring_kbm': { label: 'Monitoring KBM', icon: 'fa-table-cells', link: `${ROOT_URL}monitoring-kbm.html`, keywords: ['pantau kbm', 'jurnal kbm', 'kelas', 'rekap kbm'] },
    'ranking_kelas': { label: 'Ranking Kelas', icon: 'fa-trophy', link: `${ROOT_URL}ranking-kelas.html`, keywords: ['peringkat', 'juara', 'prestasi kelas', 'nilai tertinggi'] },
    'lib_sirkulasi': { label: 'Sirkulasi Buku', icon: 'fa-repeat', link: `${ROOT_URL}library/index.html`, keywords: ['perpus', 'pinjam buku', 'kembali buku', 'sirkulasi', 'perpustakaan'] },
    'lib_katalog': { label: 'Katalog & Barcode', icon: 'fa-book-atlas', link: `${ROOT_URL}library/katalog.html`, keywords: ['barcode', 'label buku', 'daftar buku', 'katalog perpus'] },
    'lib_opac': { label: 'Katalog Buku (OPAC)', icon: 'fa-magnifying-glass', link: `${ROOT_URL}library/opac.html`, keywords: ['buku', 'cari buku', 'opac', 'katalog online', 'judul'] },
    'lib_presensi': { label: 'Buku Tamu Perpus', icon: 'fa-book-open-reader', link: `${ROOT_URL}library/presensi-perpus.html`, keywords: ['tamu perpus', 'kunjungan', 'pengunjung', 'buku tamu'] },
    'lib_bebas_pustaka': { label: 'Bebas Pustaka', icon: 'fa-file-shield', link: `${ROOT_URL}library/bebas-pustaka.html`, keywords: ['surat bebas perpus', 'bebas pinjam', 'surat perpus'] },
    'lib_laporan': { label: 'Laporan Perpus', icon: 'fa-chart-pie', link: `${ROOT_URL}library/laporan.html`, keywords: ['rekap perpus', 'statistik perpus', 'grafik perpus'] },
    'lib_pengaturan': { label: 'Pengaturan Perpus', icon: 'fa-sliders', link: `${ROOT_URL}library/pengaturan.html`, keywords: ['setting perpus', 'konfigurasi perpus', 'denda'] },
    'kredit': { label: 'Data Kredit Poin', icon: 'fa-scale-balanced', link: `${ROOT_URL}kredit.html`, keywords: ['poin', 'kredit poin', 'sanksi', 'disiplin siswa'] },
    'users': { label: 'Manajemen User', icon: 'fa-user-gear', link: `${ROOT_URL}users.html`, keywords: ['manajemen user', 'pengguna', 'akun', 'password', 'role', 'hak akses'] },
    'rkas_komite': { label: 'RKAS Komite', icon: 'fa-file-invoice-dollar', link: `${ROOT_URL}rkas-komite.html`, keywords: ['anggaran', 'komite', 'keuangan komite', 'rencana kerja', 'rkas'] },
    'keuangan': { label: 'E-SPP', icon: 'fa-file-invoice-dollar', link: `${ROOT_URL}keuangan.html`, keywords: ['spp', 'uang sekolah', 'iuran', 'tagihan', 'pembayaran', 'keuangan'] },
    'bk_space': { label: 'Ruang BK', icon: 'fa-user-nurse', link: `${ROOT_URL}bk.html`, keywords: ['bimbingan konseling', 'guru bk', 'konseling', 'kasus', 'pembinaan'] },
    'jadwal': { label: 'Jadwal Pelajaran', icon: 'fa-calendar-week', link: `${ROOT_URL}jadwal.html`, keywords: ['jadwal pelajaran', 'roster', 'jam pelajaran', 'waktu mengajar'] },
    'e_lab': { label: 'E-Laboratorium', icon: 'fa-flask-vial', link: `${ROOT_URL}e-lab.html`, keywords: ['laboratorium', 'pinjam lab', 'alat lab', 'komputer', 'ipa', 'kimia', 'fisika', 'biologi'] },
    'guru_wali': { label: 'Portal Guru Wali', icon: 'fa-user-graduate', link: `${ROOT_URL}guru-wali.html`, keywords: ['wali siswa', 'binaan', 'catatan wali', 'anak asuh'] },
    'guru_mapel_portal': { label: 'Portal Guru Mapel', icon: 'fa-book-bookmark', link: `${ROOT_URL}guru-mapel.html`, keywords: ['nilai mapel', 'lms', 'materi', 'tugas mapel', 'gradebook'] },
    'wali_kelas': { label: 'Portal Wali Kelas', icon: 'fa-user-tie', link: `${ROOT_URL}wali-kelas.html`, keywords: ['rombel', 'catatan wali kelas', 'rapor wali', 'kelas'] },
    'e_rapor': { label: 'E-Rapor', icon: 'fa-clipboard-check', link: `${ROOT_URL}e-rapor.html`, keywords: ['nilai rapor', 'raport', 'cetak rapor', 'leger', 'predikat'] },
    'peminatan': { label: 'Kuesioner Peminatan', icon: 'fa-clipboard-question', link: `${ROOT_URL}peminatan.html`, keywords: ['angket', 'kuesioner', 'minat bakat', 'survei siswa'] },
    'peminatan_hasil': { label: 'Hasil Peminatan', icon: 'fa-chart-line', link: `${ROOT_URL}peminatan-hasil.html`, keywords: ['grafik peminatan', 'hasil survei', 'rekap peminatan'] },
    'settings': { label: 'Pengaturan', icon: 'fa-screwdriver-wrench', link: `${ROOT_URL}settings.html`, keywords: ['pengaturan', 'konfigurasi', 'setting', 'admin', 'sistem'] },
    'integrasi': { label: 'Integrasi & Notifikasi', icon: 'fa-circle-nodes', link: `${ROOT_URL}integrasi.html`, keywords: ['webhook', 'telegram', 'whatsapp', 'notifikasi', 'api', 'gemini'] },
    'game_pid': { label: 'Game PID', icon: 'fa-gamepad', link: `${ROOT_URL}pid/portalpid.html`, keywords: ['game edukasi', 'pid', 'permainan', 'kuis'] },
    'jurnal': { label: 'Admin Jurnal', icon: 'fa-book-open', link: `${ROOT_URL}jurnal-admin.html`, keywords: ['admin jurnal', 'jurnal mengajar', 'rekap jurnal'] },
    'penjualan_buku': { label: 'Penjualan Buku', icon: 'fa-book-atlas', link: `${ROOT_URL}penjualan-buku.html`, keywords: ['buku lks', 'jual buku', 'stok buku', 'kasir buku'] },
    'pesan_lks': { label: 'Pesan LKS', icon: 'fa-cart-shopping', link: `${ROOT_URL}pesan-lks.html`, keywords: ['lks', 'order lks', 'pemesanan buku'] },
    'kapsul_waktu': { label: 'Kapsul Waktu', icon: 'fa-hourglass-half', link: `${ROOT_URL}pub/admin-kapsul.html`, keywords: ['time capsule', 'surat masa depan', 'pesan masa depan'] },
    'duta_admin': { label: "Admin Duta CERDAS", icon: 'fa-user-shield', link: `${ROOT_URL}duta-admin.html`, keywords: ['duta shakti', 'pemilihan duta', 'voting duta', 'kandidat'] },
    'yearbook_admin': { label: 'Year Book', icon: 'fa-book-bookmark', link: `${ROOT_URL}yearbook-admin.html`, keywords: ['buku kenangan', 'bts', 'album kenangan', 'alumni'] },
    'suka_duka': { label: 'Suka-Duka', icon: 'fa-handshake-angle', link: `${ROOT_URL}sukaduka/suka-duka.html`, keywords: ['sosial', 'duka', 'santunan', 'kas suka duka', 'iuran suka duka'] },
    'koperasi_ssa': { label: 'Koperasi SSA', icon: 'fa-shop', link: 'https://sedana-shakti-amerta.web.app', keywords: ['koperasi', 'toko sekolah', 'ssa', 'belanja'] },
    'sarpras_inventaris': { label: 'Master Inventaris & KIR', icon: 'fa-boxes-stacked', link: `${ROOT_URL}sarpras-inventaris.html`, keywords: ['aset', 'barang', 'kir', 'ruangan', 'kondisi barang'] },
    'sarpras_aduan': { label: 'Aduan & Usulan Sarpras', icon: 'fa-bullhorn', link: `${ROOT_URL}sarpras-aduan.html`, keywords: ['rusak', 'lapor sarpras', 'usulan sarpras', 'perbaikan'] },
    'sarpras_rkas': { label: 'Perencanaan RKAS', icon: 'fa-file-invoice-dollar', link: `${ROOT_URL}sarpras-rkas.html`, keywords: ['rkas sarpras', 'anggaran sarpras', 'pengadaan barang'] },
    'sarpras_penggunaan': { label: 'Peminjaman & BMHP', icon: 'fa-hand-holding-hand', link: `${ROOT_URL}sarpras-penggunaan.html`, keywords: ['pinjam alat', 'bmhp', 'bahan habis pakai', 'peminjaman sarpras'] },
    'sarpras_pemeliharaan': { label: 'Pemeliharaan & Servis', icon: 'fa-screwdriver-wrench', link: `${ROOT_URL}sarpras-pemeliharaan.html`, keywords: ['servis', 'jadwal servis', 'perawatan barang', 'maintenance'] },
    'masukan': { label: 'Masukan', icon: 'fa-message', link: `${ROOT_URL}masukan.html`, keywords: ['saran', 'aspirasi', 'aduan', 'kritik', 'feedback'] }
};

// Menu Grouping Configuration
const MENU_GROUPS = [
    { key: 'dashboard', type: 'single' },
    {
        key: 'agenda_group',
        type: 'group',
        label: 'Agenda dan Dokumen',
        icon: 'fa-calendar-days',
        items: ['jadwal', 'agenda', 'agenda_pegawai', 'beban_kerja', 'dokumen', 'siswa', 'guru']
    },
    { key: 'input', type: 'single' },
    {
        key: 'akademik',
        type: 'group',
        label: 'Akademik',
        icon: 'fa-graduation-cap',
        items: ['guru_mapel_portal', 'guru_wali', 'wali_kelas', 'game_pid', 'e_lab', 'e_rapor']
    },
    {
        key: 'presensi_group',
        type: 'group',
        label: 'Presensi & Monitoring',
        icon: 'fa-calendar-check',
        items: ['presensi', 'presensi_guru', 'monitoring_kbm', 'ranking_kelas']
    },
    {
        key: 'kesiswaan_group',
        type: 'group',
        label: 'Kesiswaan & BK',
        icon: 'fa-user-graduate',
        items: ['bk_space', 'kredit', 'peminatan_hasil', 'kapsul_waktu', 'duta_admin', 'yearbook_admin']
    },
    {
        key: 'perpustakaan_group',
        type: 'group',
        label: 'Perpustakaan',
        icon: 'fa-book-bookmark',
        items: ['lib_sirkulasi', 'lib_katalog', 'lib_opac', 'lib_presensi', 'lib_bebas_pustaka', 'lib_laporan', 'lib_pengaturan']
    },
    {
        key: 'keuangan_group',
        type: 'group',
        label: 'Keuangan & Sosial',
        icon: 'fa-wallet',
        items: ['rkas_komite', 'keuangan', 'penjualan_buku', 'pesan_lks', 'koperasi_ssa', 'suka_duka']
    },
    {
        key: 'sarpras_group',
        type: 'group',
        label: 'Sarana & Prasarana',
        icon: 'fa-warehouse',
        items: ['sarpras_aduan', 'sarpras_rkas', 'sarpras_inventaris', 'sarpras_penggunaan', 'sarpras_pemeliharaan']
    },
    {
        key: 'sistem_group',
        type: 'group',
        label: 'Sistem & Admin',
        icon: 'fa-shield-halved',
        items: ['jurnal', 'users', 'integrasi', 'settings']
    },
    { key: 'masukan', type: 'single' }
];

// =====================================
// GLOBAL SYSTEM CONFIG CACHE (HEMAT KUOTA READ)
// =====================================
// Cache system_config agar tidak baca ulang di setiap halaman
// Sumber: onSnapshot listener (non-super_admin) + syncSystemAiConfig (semua role)

let _systemConfigCache = null;
let _systemConfigTs = 0;
const SYSTEM_CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 menit

/**
 * Ambil system_config dari cache (memory → localStorage → Firestore)
 * @returns {Promise<Object>} - system_config data
 */
export async function getSystemConfig() {
    // 1. Memory cache valid?
    if (_systemConfigCache && (Date.now() - _systemConfigTs) < SYSTEM_CONFIG_CACHE_TTL) {
        return _systemConfigCache;
    }

    // 2. localStorage cache
    const cached = (typeof window !== 'undefined' && typeof window.getLocalCache === 'function')
        ? window.getLocalCache('simas_system_config_cache', SYSTEM_CONFIG_CACHE_TTL)
        : null;
    if (cached) {
        _systemConfigCache = cached;
        _systemConfigTs = Date.now();
        return cached;
    }

    // 3. Fetch Firestore (fallback jika listener belum ready atau super_admin)
    try {
        const snap = await getDoc(doc(db, PATHS.settings, 'system_config'));
        const data = snap.exists() ? snap.data() : {};
        _systemConfigCache = data;
        _systemConfigTs = Date.now();
        if (typeof window !== 'undefined' && typeof window.setLocalCache === 'function') {
            window.setLocalCache('simas_system_config_cache', data);
        }
        return data;
    } catch (e) {
        console.warn('[Cache] Error fetching system_config:', e);
        return _systemConfigCache || {};
    }
}
window.getSystemConfig = getSystemConfig;

/**
 * Invalidasi system config cache (dipanggil saat admin ubah config)
 */
export function invalidateSystemConfig() {
    _systemConfigCache = null;
    _systemConfigTs = 0;
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('simas_system_config_cache');
    }
    console.log('[Cache] System config cache invalidated');
}
window.invalidateSystemConfig = invalidateSystemConfig;

export async function syncSystemAiConfig() {
    try {
        // Gunakan getSystemConfig() terpusat agar tidak double-read
        const getCfg = (typeof window !== 'undefined' && typeof window.getSystemConfig === 'function') ? window.getSystemConfig : getSystemConfig;
        const data = await getCfg();
        if (data) {
            if (data.geminiModel) localStorage.setItem('simas_gemini_model', data.geminiModel);
            if (data.geminiDisplayName) {
                localStorage.setItem('simas_gemini_display_name', data.geminiDisplayName);
                const badgeLabels = document.querySelectorAll('#gemini-badge-label, #rapor-gemini-badge-label, .ai-badge-label');
                badgeLabels.forEach(el => { if (el) el.textContent = data.geminiDisplayName; });
            }
        }
    } catch (e) {
        console.warn("[Global] Error syncing AI config:", e);
    }
}

// =====================================
// DARK MODE TOGGLE FUNCTIONALITY
// =====================================

/**
 * Sync all dark mode toggle buttons (desktop + mobile)
 */
window.syncDarkModeToggles = function (isDark) {
    const toggleDesktop = document.getElementById('dark-mode-toggle');
    const toggleMobile = document.getElementById('dark-mode-toggle-mobile');

    [toggleDesktop, toggleMobile].forEach(toggle => {
        if (toggle) {
            if (isDark) {
                toggle.classList.add('active');
            } else {
                toggle.classList.remove('active');
            }
        }
    });
};

/**
 * Initialize dark mode from localStorage
 * Called on page load to apply saved preference
 */
window.initDarkMode = function () {
    const html = document.documentElement;
    const storedPref = localStorage.getItem('dark_mode');

    // Logika: jika user pernah set manual, pakai pilihan itu.
    // Jika belum pernah set (null), paksa default ke Light Mode (false).
    let isDark = false;
    if (storedPref !== null) {
        isDark = storedPref === 'true';
    }

    if (isDark) {
        html.classList.add('dark');
    } else {
        html.classList.remove('dark');
    }

    // Update toggle button state after layout is rendered (desktop + mobile)
    setTimeout(() => {
        if (typeof window.syncDarkModeToggles === 'function') {
            window.syncDarkModeToggles(isDark);
        }
    }, 100);
};

/**
 * Toggle dark mode on/off
 * Persists preference to localStorage (manual override)
 */
window.toggleDarkMode = function () {
    const html = document.documentElement;
    const isDark = html.classList.contains('dark');

    if (isDark) {
        html.classList.remove('dark');
        localStorage.setItem('dark_mode', 'false');
    } else {
        html.classList.add('dark');
        localStorage.setItem('dark_mode', 'true');
    }

    if (typeof window.syncDarkModeToggles === 'function') {
        window.syncDarkModeToggles(!isDark);
    }
    console.log('[UI] Dark mode (manual):', !isDark);
};

// Initialize dark mode on page load (before layout renders)
window.initDarkMode();

/**
 * Kompresi gambar client-side ke WebP (1:1 square center-crop untuk avatar profil)
 * Menghasilkan DataURL WebP (~15-30 KB) untuk hemat storage Cloudflare R2.
 */
export async function compressImageToWebP(fileOrBlob, maxWidth = 400, maxHeight = 400, quality = 0.82) {
    return new Promise((resolve, reject) => {
        if (!fileOrBlob) return reject(new Error('File tidak ditemukan'));

        const renderToCanvas = (img, cleanupFn) => {
            try {
                const naturalW = img.naturalWidth || img.width;
                const naturalH = img.naturalHeight || img.height;
                const minDim = Math.min(naturalW, naturalH);
                const startX = (naturalW - minDim) / 2;
                const startY = (naturalH - minDim) / 2;

                const canvas = document.createElement('canvas');
                const targetDim = Math.min(minDim, Math.min(maxWidth, maxHeight));
                canvas.width = targetDim;
                canvas.height = targetDim;

                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';

                ctx.drawImage(img, startX, startY, minDim, minDim, 0, 0, targetDim, targetDim);

                if (typeof cleanupFn === 'function') cleanupFn();

                let dataUrl = canvas.toDataURL('image/webp', quality);
                if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
                    dataUrl = canvas.toDataURL('image/jpeg', quality);
                }
                resolve(dataUrl);
            } catch (err) {
                if (typeof cleanupFn === 'function') cleanupFn();
                reject(err);
            }
        };

        const tryFileReader = () => {
            if (typeof FileReader === 'undefined') {
                return reject(new Error('FileReader tidak didukung di browser ini'));
            }
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => renderToCanvas(img);
                img.onerror = () => reject(new Error('Gagal memuat gambar untuk kompresi'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(reader.error || new Error('Gagal membaca file gambar'));
            reader.readAsDataURL(fileOrBlob);
        };

        if (typeof window !== 'undefined' && window.URL && typeof window.URL.createObjectURL === 'function') {
            try {
                const objectUrl = URL.createObjectURL(fileOrBlob);
                const img = new Image();
                let loaded = false;
                img.onload = () => {
                    loaded = true;
                    renderToCanvas(img, () => {
                        try { URL.revokeObjectURL(objectUrl); } catch (_) {}
                    });
                };
                img.onerror = () => {
                    try { URL.revokeObjectURL(objectUrl); } catch (_) {}
                    if (!loaded) {
                        tryFileReader();
                    }
                };
                img.src = objectUrl;
            } catch (_) {
                tryFileReader();
            }
        } else {
            tryFileReader();
        }
    });
}
if (typeof window !== 'undefined') {
    window.compressImageToWebP = compressImageToWebP;
}

// Identitas cache hanya untuk tampilan awal; izin tetap mengikuti sesi/role yang ada.
let sidebarAuthReady = false;
const sidebarResolvedNames = new Map();
const sidebarProfileRequests = new Map();

function getSidebarProfile(user = auth.currentUser) {
    const uid = user?.uid || (!sidebarAuthReady ? localStorage.getItem('last_login_uid') : null);
    const cachedName = uid ? localStorage.getItem(`cached_user_name_${uid}`) : '';
    const cachedDoc = uid ? window.getLocalCache(`simas_userdoc_${uid}`, 10 * 60 * 1000) : null;
    const name = cachedName || sidebarResolvedNames.get(uid) || cachedDoc?.name || user?.name || user?.displayName || '';
    const rawCachedPhoto = uid ? localStorage.getItem(`cached_user_photo_${uid}`) : null;
    const photo = resolvePhotoUrl(rawCachedPhoto);
    const nameHTML = name ? window.escapeHTML(name) : '<span role="status" aria-label="Memuat profil" style="display:inline-block;width:96px;height:12px;border-radius:6px;background:currentColor;opacity:.2"></span>';
    const initialHTML = name ? window.escapeHTML(name.charAt(0).toUpperCase()) : '<i class="fa-solid fa-user opacity-40" aria-hidden="true"></i>';
    return { name, photo, nameHTML, initialHTML };
}

function syncSidebarProfile() {
    const profile = getSidebarProfile();
    document.querySelectorAll('.user-name-el').forEach(el => {
        if (profile.name) el.textContent = profile.name;
        else el.innerHTML = profile.nameHTML;
    });
    window.updateUIAvatars(profile.photo);
}

/**
 * Update semua avatar pengguna di antarmuka (desktop & mobile) secara instan tanpa reload
 */
window.updateUIAvatars = function (photoUrl) {
    const resolvedUrl = resolvePhotoUrl(photoUrl);
    const { name, initialHTML } = getSidebarProfile();

    document.querySelectorAll('.user-avatar-container').forEach(container => {
        const currentImage = container.querySelector('img');
        if (resolvedUrl && currentImage?.getAttribute('src') === resolvedUrl) {
            currentImage.alt = name;
            return;
        }
        let dot = container.querySelector('.animate-pulse');
        let dotHtml = dot ? dot.outerHTML : '';
        if (!dotHtml) {
            const isMobile = container.classList.contains('w-10');
            const dotSize = isMobile ? 'w-3 h-3' : 'w-2.5 h-2.5';
            const dotBorder = isMobile ? 'border-2 border-slate-50 dark:border-slate-800' : 'border-2 border-slate-900';
            dotHtml = `<span class="absolute -bottom-0.5 -right-0.5 ${dotSize} bg-emerald-500 rounded-full ${dotBorder} animate-pulse z-20" title="Online"></span>`;
        }
        if (resolvedUrl) {
            container.innerHTML = `<img src="${window.escapeHTML(resolvedUrl)}" alt="${window.escapeHTML(name)}" class="w-full h-full object-cover rounded-full" onerror="this.remove()">${dotHtml}`;
        } else {
            container.innerHTML = `${initialHTML}${dotHtml}`;
        }
    });

    if (typeof window.applyVipBadgeToAllUserAvatars === 'function') {
        window.applyVipBadgeToAllUserAvatars();
    }
};

export const initLayout = async (userRole = 'guru_mapel') => {
    document.body.style.display = 'block';

    // --- GUARD EMBED / POPUP MODE ---
    // Jika halaman dibuka dalam iframe atau dengan parameter mode=popup (khususnya katalog OPAC), jangan pernah render sidebar/navbar SIMAS
    const isOpacPage = window.location.pathname.includes('opac.html');
    const isEmbedMode = new URLSearchParams(window.location.search).get('mode') === 'popup' || 
                        new URLSearchParams(window.location.search).get('embed') === '1' || 
                        (isOpacPage && window.self !== window.top);
    if (isEmbedMode) {
        document.documentElement.classList.add('is-embed-mode');
        document.body.classList.add('opac-embed-mode');
        const layoutContainer = document.getElementById('app-layout');
        if (layoutContainer) {
            layoutContainer.innerHTML = '';
            layoutContainer.style.display = 'none';
        }
        return;
    } else {
        document.documentElement.classList.remove('is-embed-mode');
        document.body.classList.remove('opac-embed-mode');
        const layoutContainer = document.getElementById('app-layout');
        if (layoutContainer && layoutContainer.style.display === 'none') {
            layoutContainer.style.display = '';
        }
    }

    syncSystemAiConfig();
    const layoutContainer = document.getElementById('app-layout');
    if (!layoutContainer) return;

    // --- DETEKSI SWITCH AKUN: Clear cache role-sensitive jika uid berubah ---
    const user = auth.currentUser;
    if (user) {
        const lastUid = localStorage.getItem('last_login_uid');
        if (lastUid && lastUid !== user.uid) {
            // Switch akun terdeteksi — clear cache SPESIFIK akun lama (JANGAN hapus role baru!)
            localStorage.removeItem(`simas_userdoc_${lastUid}`);
            localStorage.removeItem(`simas_user_data_${lastUid}`);
            localStorage.removeItem(`cached_user_name_${lastUid}`);
            localStorage.removeItem(`cached_user_photo_${lastUid}`);
            localStorage.removeItem('user_assigned_class');
            localStorage.removeItem(`simas_recent_menus_${lastUid}`);
            console.log('[Security] Switch akun terdeteksi, cache akun lama dibersihkan');
        }
        localStorage.setItem('last_login_uid', user.uid);
    }
    // Pulihkan profil cache sebelum Firebase selesai memulihkan sesi.
    // Jika identitas belum tersedia, tampilkan placeholder tanpa nama sementara.
    const { name: userName, photo: cachedPhoto, nameHTML: userNameHTML, initialHTML: userInitial } = getSidebarProfile(user);

    // Role Display - MULTI-ROLE SUPPORT
    const allUserRoles = window.getAllUserRoles ? window.getAllUserRoles() : [userRole];
    const roleLabels = {
        'super_admin': 'Super Admin',
        'admin_perpus': 'Admin Perpustakaan',
        'kepala_sekolah': 'Kepala Sekolah',
        'wakasek_kurikulum': 'Wakasek Kurikulum',
        'kepala_lab': 'Kepala Lab',
        'kesiswaan': 'Wakasek Kesiswaan',
        'admin_spp': 'Admin SPP',
        'staff': 'Staff',
        'wali_kelas': 'Wali Kelas',
        'guru_mapel': 'Guru Mapel',
        'guru_bk': 'Guru BK',
        'admin_pks': 'Admin PKS',
        'admin_kelas': 'Admin Kelas',
        'siswa': 'Siswa',
        'admin_sukaduka': 'Admin Suka-Duka',
        'admin_duta': "Admin Duta CERDAS",
        'admin_lks': 'Admin LKS'
    };
    // Tampilkan semua role dipisah koma
    const roleDisplay = allUserRoles
        .map(r => roleLabels[r] || r.replace('_', ' '))
        .join(', ');

    // Menu Logic - MULTI-ROLE SUPPORT
    // Gabungkan menu dari semua role user (primary + additional)
    // allUserRoles sudah dideklarasi di atas untuk role display
    let allowedKeys = [];

    allUserRoles.forEach(role => {
        const menuForRole = MENU_CONFIG[role] || [];
        menuForRole.forEach(key => {
            if (!allowedKeys.includes(key)) {
                allowedKeys.push(key);
            }
        });
    });

    // Fallback jika tidak ada menu
    if (allowedKeys.length === 0) {
        allowedKeys = [...(MENU_CONFIG['guru_mapel'] || [])];
    }

    // Koperasi SSA adalah menu publik/koperasi sekolah yang bisa diakses oleh semua pengguna
    if (!allowedKeys.includes('koperasi_ssa')) {
        allowedKeys.push('koperasi_ssa');
    }

    // Evaluasi Hak Akses Dinamis Modul Ranking Kelas (Super Admin Policy via D1)
    const checkRankingAllowed = typeof window.isRankingKelasAllowedForUser === 'function' 
        ? window.isRankingKelasAllowedForUser 
        : (typeof isRankingKelasAllowedForUser === 'function' ? isRankingKelasAllowedForUser : null);
    if (allowedKeys.includes('ranking_kelas') && checkRankingAllowed) {
        if (!checkRankingAllowed()) {
            allowedKeys = allowedKeys.filter(k => k !== 'ranking_kelas');
        }
    }

    // SSOT allowedKeys untuk Pencarian Menu & Riwayat (RBAC Parity)
    window.__simasAllowedMenuKeys = Object.freeze([...allowedKeys]);

    function buildMenuSearchText(key, groupLabel = '') {
        const item = MENU_LABELS[key];
        if (!item) return '';
        const parts = [
            item.label || '',
            groupLabel || '',
            Array.isArray(item.keywords) ? item.keywords.join(' ') : ''
        ];
        return parts.filter(Boolean).join(' ').toLowerCase();
    }

    // CATATAN: Wakasek Kurikulum sekarang sudah role-based, tidak perlu cek UID lagi
    // wakasek_kurikulum sudah ada di MENU_CONFIG dengan akses settings & users

    const menuItems = allowedKeys.map(key => MENU_LABELS[key]);
    // Gunakan full current URL untuk pencocokan menu aktif (agar bekerja dari subfolder)
    const currentHref = window.location.href.split('?')[0].split('#')[0];

    // Cek Status Sidebar Desktop (diletakkan sebelum generateGroupedMenuHTML)
    const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
    const sidebarWidth = isCollapsed ? 'w-20' : 'w-64';
    const hideTextClass = isCollapsed ? 'hidden' : 'block';
    const mainMargin = isCollapsed ? 'md:ml-20' : 'md:ml-64';
    const toggleIcon = isCollapsed ? 'fa-chevron-right' : 'fa-chevron-left';

    // Generate grouped menu HTML
    function generateGroupedMenuHTML(isDesktop = true) {
        let html = '';
        const openGroups = JSON.parse(localStorage.getItem('sidebar_open_groups') || '[]');

        MENU_GROUPS.forEach(group => {
            // Divider visual antar kelompok menu (hanya desktop & tersembunyi saat collapsed)
            if (isDesktop && (group.key === 'akademik' || group.key === 'masukan')) {
                html += `<div data-menu-divider class="sidebar-text ${hideTextClass} h-px mx-2 my-2 bg-gradient-to-r from-transparent via-slate-700/60 to-transparent"></div>`;
            }

            if (group.type === 'single') {
                // Single menu item (Dashboard, Input Catatan, Masukan)
                if (!allowedKeys.includes(group.key)) return;
                const m = MENU_LABELS[group.key];
                if (!m) return;
                const searchData = window.escapeHTML ? window.escapeHTML(buildMenuSearchText(group.key, '')) : buildMenuSearchText(group.key, '');

                if (isDesktop) {
                    html += `
                        <a href="${m.link}" data-menu-item data-menu-key="${group.key}" data-search="${searchData}" ${!m.link.startsWith(ROOT_URL) ? 'target="_blank"' : ''} onmouseenter="window.prefetchPage && window.prefetchPage('${m.link}')" onclick="window.closeAllMenuGroups && window.closeAllMenuGroups(); window.recordRecentMenu && window.recordRecentMenu('${group.key}');" class="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all group relative
                            ${currentHref === m.link ? 'bg-blue-600/90 text-white shadow-md shadow-blue-900/40 border-l-[3px] border-blue-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white border-l-[3px] border-transparent'}">
                            <div class="w-5 text-center flex-shrink-0 text-base relative">
                                <i class="fa-solid ${m.icon}"></i>
                                ${group.key === 'masukan' ? `<span id="menu-masukan-dot-desktop" class="hidden absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-slate-900 animate-pulse"></span>` : ''}
                            </div>
                            <span data-menu-label class="sidebar-text ${hideTextClass} whitespace-nowrap transition-opacity duration-200">
                                ${m.label}
                            </span>
                            ${group.key === 'masukan' ? `<span id="menu-masukan-badge-desktop" class="sidebar-text ${hideTextClass} hidden ml-auto px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-rose-500 text-white animate-pulse shadow-sm">NEW</span>` : ''}
                            ${isCollapsed ? `<div class="absolute left-14 bg-slate-800 text-white text-xs px-2 py-1 rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity border border-slate-700">${m.label}</div>` : ''}
                        </a>
                    `;
                } else {
                    html += `
                        <a href="${m.link}" data-menu-item data-menu-key="${group.key}" data-search="${searchData}" ${!m.link.startsWith(ROOT_URL) ? 'target="_blank"' : ''} onclick="window.closeAllMenuGroupsMobile && window.closeAllMenuGroupsMobile(); window.recordRecentMenu && window.recordRecentMenu('${group.key}');" class="flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all ${currentHref === m.link ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}">
                            <div class="w-5 text-center relative">
                                <i class="fa-solid ${m.icon} text-base"></i>
                                ${group.key === 'masukan' ? `<span id="menu-masukan-dot-mobile" class="hidden absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>` : ''}
                            </div>
                            <span data-menu-label class="flex-1">${m.label}</span>
                            ${group.key === 'masukan' ? `<span id="menu-masukan-badge-mobile" class="hidden ml-auto px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-rose-500 text-white animate-pulse shadow-sm">NEW</span>` : ''}
                        </a>
                    `;
                }
            } else if (group.type === 'group') {
                // Group with sub-items
                const visibleItems = group.items.filter(key => allowedKeys.includes(key));
                if (visibleItems.length === 0) return;

                if (visibleItems.length === 1) {
                    // Render as a single menu item if it only has 1 visible sub-item
                    const singleKey = visibleItems[0];
                    const m = MENU_LABELS[singleKey];
                    if (!m) return;
                    const searchData = window.escapeHTML ? window.escapeHTML(buildMenuSearchText(singleKey, group.label)) : buildMenuSearchText(singleKey, group.label);

                    if (isDesktop) {
                        html += `
                            <a href="${m.link}" data-menu-item data-menu-key="${singleKey}" data-search="${searchData}" ${!m.link.startsWith(ROOT_URL) ? 'target="_blank"' : ''} onmouseenter="window.prefetchPage && window.prefetchPage('${m.link}')" onclick="window.closeAllMenuGroups && window.closeAllMenuGroups(); window.recordRecentMenu && window.recordRecentMenu('${singleKey}');" class="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all group relative
                                ${currentHref === m.link ? 'bg-blue-600/90 text-white shadow-md shadow-blue-900/40 border-l-[3px] border-blue-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white border-l-[3px] border-transparent'}">
                                <div class="w-5 text-center flex-shrink-0 text-base">
                                    <i class="fa-solid ${m.icon}"></i>
                                </div>
                                <span data-menu-label class="sidebar-text ${hideTextClass} whitespace-nowrap transition-opacity duration-200">
                                    ${m.label}
                                </span>
                                ${isCollapsed ? `<div class="absolute left-14 bg-slate-800 text-white text-xs px-2 py-1 rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity border border-slate-700">${m.label}</div>` : ''}
                            </a>
                        `;
                    } else {
                        html += `
                            <a href="${m.link}" data-menu-item data-menu-key="${singleKey}" data-search="${searchData}" ${!m.link.startsWith(ROOT_URL) ? 'target="_blank"' : ''} onclick="window.closeAllMenuGroupsMobile && window.closeAllMenuGroupsMobile(); window.recordRecentMenu && window.recordRecentMenu('${singleKey}');" class="flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all ${currentHref === m.link ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}">
                                <div class="w-5 text-center"><i class="fa-solid ${m.icon} text-base"></i></div>
                                <span data-menu-label class="flex-1">${m.label}</span>
                            </a>
                        `;
                    }
                    return;
                }

                const hasActiveItem = visibleItems.some(key => MENU_LABELS[key]?.link === currentHref);
                const isOpen = openGroups.includes(group.key) || hasActiveItem;
                const groupNameEscaped = window.escapeHTML ? window.escapeHTML(group.label) : group.label;

                if (isDesktop) {
                    html += `
                        <div class="menu-group" data-group="${group.key}" data-group-name="${groupNameEscaped}">
                            <button onclick="window.toggleMenuGroup && window.toggleMenuGroup('${group.key}')" class="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all group relative
                                ${hasActiveItem ? 'bg-slate-800 text-white border-l-[3px] border-blue-400' : 'text-slate-400 hover:bg-slate-800 hover:text-white border-l-[3px] border-transparent'}">
                                <div class="w-5 text-center flex-shrink-0 text-base">
                                    <i class="fa-solid ${group.icon}"></i>
                                </div>
                                <span data-group-label class="sidebar-text ${hideTextClass} whitespace-nowrap transition-opacity duration-200 flex-1 text-left">
                                    ${group.label}
                                </span>
                                <i class="fa-solid fa-chevron-down sidebar-text ${hideTextClass} text-[10px] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}"></i>
                                ${isCollapsed ? `<div class="absolute left-14 bg-slate-800 text-white text-xs px-2 py-1 rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity border border-slate-700">${group.label}</div>` : ''}
                            </button>
                            <div class="menu-group-items pl-4 mt-1 space-y-1 overflow-hidden transition-all duration-200 ${isOpen ? '' : 'hidden'}">
                                ${visibleItems.map(key => {
                        const m = MENU_LABELS[key];
                        const searchData = window.escapeHTML ? window.escapeHTML(buildMenuSearchText(key, group.label)) : buildMenuSearchText(key, group.label);
                        return `
                                        <a href="${m.link}" data-menu-item data-menu-key="${key}" data-search="${searchData}" ${!m.link.startsWith(ROOT_URL) ? 'target="_blank"' : ''} onmouseenter="window.prefetchPage && window.prefetchPage('${m.link}')" onclick="window.recordRecentMenu && window.recordRecentMenu('${key}');" class="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all
                                            ${currentHref === m.link ? 'bg-blue-600/90 text-white shadow-sm border-l-[3px] border-blue-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white border-l-[3px] border-transparent'}">
                                            <div class="w-4 text-center flex-shrink-0 text-xs">
                                                <i class="fa-solid ${m.icon}"></i>
                                            </div>
                                            <span data-menu-label class="sidebar-text ${hideTextClass} whitespace-nowrap">${m.label}</span>
                                        </a>
                                    `;
                    }).join('')}
                            </div>
                        </div>
                    `;
                } else {
                    html += `
                        <div class="menu-group-mobile" data-group="${group.key}" data-group-name="${groupNameEscaped}">
                            <button onclick="window.toggleMenuGroupMobile && window.toggleMenuGroupMobile('${group.key}')" class="w-full flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all
                                ${hasActiveItem ? 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}">
                                <div class="w-5 text-center"><i class="fa-solid ${group.icon} text-base"></i></div>
                                <span data-group-label class="flex-1 text-left">${group.label}</span>
                                <i class="fa-solid fa-chevron-down text-xs transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}"></i>
                            </button>
                            <div class="menu-group-items-mobile pl-6 mt-1 space-y-1 overflow-hidden transition-all duration-200 ${isOpen ? '' : 'hidden'}">
                                ${visibleItems.map(key => {
                        const m = MENU_LABELS[key];
                        const searchData = window.escapeHTML ? window.escapeHTML(buildMenuSearchText(key, group.label)) : buildMenuSearchText(key, group.label);
                        return `
                                        <a href="${m.link}" data-menu-item data-menu-key="${key}" data-search="${searchData}" ${!m.link.startsWith(ROOT_URL) ? 'target="_blank"' : ''} onclick="window.recordRecentMenu && window.recordRecentMenu('${key}');" class="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                                            ${currentHref === m.link ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}">
                                            <div class="w-4 text-center"><i class="fa-solid ${m.icon} text-xs"></i></div>
                                            <span data-menu-label>${m.label}</span>
                                        </a>
                                    `;
                    }).join('')}
                            </div>
                        </div>
                    `;
                }
            }
        });
        return html;
    }

    const desktopMenuHTML = generateGroupedMenuHTML(true);
    const mobileMenuHTML = generateGroupedMenuHTML(false);

    const sidebarHTML = `
        <aside id="desktop-sidebar" class="hidden md:flex flex-col ${sidebarWidth} h-screen fixed bg-slate-900 text-white transition-all duration-300 z-50 shadow-xl border-r border-slate-800">
            
            <div class="h-16 flex items-center gap-3 px-4 relative bg-gradient-to-b from-slate-800/60 to-transparent">
                <div class="w-10 h-10 flex-shrink-0 flex items-center justify-center bg-white/10 rounded-lg p-1 ring-1 ring-white/15 shadow-sm">
                      <img src="${new URL(SCHOOL_CONFIG.logoPath, ROOT_URL).href}" alt="Logo ${SCHOOL_CONFIG.schoolShortName}" class="w-full h-full object-contain">
                </div>
                
                <div class="leading-tight overflow-hidden whitespace-nowrap sidebar-text ${hideTextClass} flex-1">
                    <span class="font-bold tracking-wide block text-lg bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">${SCHOOL_CONFIG.appBrand}</span>
                    <span class="text-[10px] text-slate-400 uppercase tracking-wider">${SCHOOL_CONFIG.schoolName}</span>
                </div>

                <!-- Tombol Collapse / Expand Sidebar Desktop -->
                <button onclick="window.toggleSidebar()" class="absolute -right-3 top-6 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs text-white shadow-lg hover:bg-blue-500 hover:scale-110 transition-all border-2 border-slate-900 z-50 cursor-pointer" title="Kecilkan/Lebarkan Sidebar">
                    <i class="fa-solid ${toggleIcon}" id="toggle-icon"></i>
                </button>

                <!-- Tombol Lonceng Notifikasi Desktop (Dark Frosted Glass with Golden Bell Glow) -->
                <button id="btn-notification-bell-desktop" onclick="window.toggleNotificationCenter()" style="left: calc(100% + 18px); top: 20px;" class="absolute w-8 h-8 rounded-full bg-slate-900/85 hover:bg-slate-800 text-amber-400 hover:text-amber-300 backdrop-blur-md border border-slate-700/80 ring-1 ring-white/10 shadow-lg shadow-black/25 transition-all hover:scale-110 active:scale-95 flex items-center justify-center z-50 cursor-pointer group" title="Pusat Notifikasi">
                    <i class="fa-solid fa-bell text-xs group-hover:rotate-12 transition-transform drop-shadow-sm"></i>
                    <span id="notif-badge-desktop" class="hidden absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center border-2 border-slate-900 animate-pulse">0</span>
                </button>
            </div>
            <div class="h-px bg-gradient-to-r from-transparent via-slate-700/60 to-transparent"></div>
            
            <!-- SEARCH MENU DESKTOP -->
            <div id="desktop-menu-search-wrapper" class="px-2.5 pt-2 pb-1 relative">
                <!-- Form Search saat Expanded -->
                <div id="desktop-menu-search-container" class="relative ${hideTextClass}">
                    <input id="sidebar-menu-search-desktop"
                           type="search"
                           role="searchbox"
                           aria-label="Cari menu SIMAS"
                           aria-controls="sidebar-nav-menu"
                           autocomplete="off"
                           spellcheck="false"
                           enterkeyhint="go"
                           placeholder="Cari menu..."
                           class="menu-search-input w-full h-8 pl-3 pr-14 rounded-lg text-xs bg-slate-800/80 hover:bg-slate-800 text-slate-100 placeholder-slate-400 border border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all outline-none">
                    
                    <!-- Shortcut badge Ctrl+K (muncul saat kosong) -->
                    <kbd id="desktop-menu-search-hint" class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[9.5px] font-mono font-semibold bg-slate-700/70 text-slate-300 border border-slate-600/60 shadow-xs">
                        Ctrl K
                    </kbd>
                    
                    <!-- Clear button ✕ (muncul saat ada ketikan) -->
                    <button id="desktop-menu-search-clear"
                            type="button"
                            aria-label="Hapus pencarian"
                            class="hidden absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md flex items-center justify-center text-xs text-slate-400 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <!-- Tombol Pencarian Mini saat Collapsed (w-20) -->
                <button id="desktop-menu-search-collapsed"
                        type="button"
                        onclick="window.focusSidebarMenuSearch && window.focusSidebarMenuSearch()"
                        title="Cari menu (Ctrl+K)"
                        aria-label="Cari menu"
                        class="${isCollapsed ? 'flex' : 'hidden'} w-9 h-8 mx-auto items-center justify-center rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 transition-all cursor-pointer">
                    <i class="fa-solid fa-magnifying-glass text-xs"></i>
                </button>

                <!-- Panel Recent Menus (Terakhir Dibuka) Desktop -->
                <div id="desktop-recent-menus-panel" class="hidden mt-2 p-2 rounded-lg bg-slate-800/95 border border-slate-700/90 shadow-xl space-y-1">
                    <div class="flex items-center justify-between px-1.5 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">
                        <span><i class="fa-solid fa-clock-rotate-left mr-1 text-blue-400"></i> Terakhir Dibuka</span>
                    </div>
                    <div id="desktop-recent-menus-list" class="space-y-0.5 pt-1"></div>
                </div>

                <!-- Empty State Desktop -->
                <div id="desktop-menu-search-empty" class="hidden py-4 px-2 text-center text-xs text-slate-400">
                    <div class="w-8 h-8 mx-auto mb-1.5 rounded-full bg-slate-800 flex items-center justify-center text-slate-500">
                        <i class="fa-solid fa-magnifying-glass text-xs"></i>
                    </div>
                    <p class="font-medium text-slate-300">Menu tidak ditemukan</p>
                    <p class="text-[10px] text-slate-500 mt-0.5">Coba kata kunci: <span class="italic text-slate-400">absen, nilai, perpus</span></p>
                </div>

                <span id="desktop-menu-search-status" class="sr-only" aria-live="polite"></span>
            </div>
            
            <nav id="sidebar-nav-menu" class="flex-1 overflow-y-auto py-2.5 px-2.5 space-y-1 overflow-x-hidden no-scrollbar">
                ${desktopMenuHTML}
            </nav>

            <!-- PWA INSTALL BUTTON DESKTOP -->
            <button onclick="window.installPWA()" id="btn-install-desktop" class="pwa-install-btn hidden mx-3 mt-auto mb-2 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 shadow-md hover:from-blue-700 hover:to-indigo-700 transition">
                <div class="w-5 text-center"><i class="fa-solid fa-download"></i></div>
                <span class="sidebar-text ${hideTextClass} whitespace-nowrap">Install Aplikasi</span>
            </button>



            <div class="p-3 border-t border-slate-800 relative">
                <button onclick="window.toggleUserMenu()" class="flex items-center gap-3 w-full p-2 rounded-lg hover:bg-slate-800 transition-colors text-left group">
                    <div class="user-avatar-container relative w-9 h-9 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center text-sm font-bold shadow-inner flex-shrink-0 border border-slate-600 text-white">
                        ${cachedPhoto ? `<img src="${window.escapeHTML(cachedPhoto)}" alt="${window.escapeHTML(userName)}" class="w-full h-full object-cover rounded-full" onerror="this.remove()">` : userInitial}
                        <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-slate-900 animate-pulse z-20" title="Online"></span>
                    </div>
                    <div class="overflow-hidden sidebar-text ${hideTextClass}">
                        <p class="text-sm font-bold text-white truncate w-32 user-name-el">${userNameHTML}</p>
                        <p class="text-[9px] text-slate-500 mt-0.5">Versi ${APP_VERSION}</p>
                    </div>
                    <i class="fa-solid fa-ellipsis-vertical text-slate-500 ml-auto sidebar-text ${hideTextClass} group-hover:text-white"></i>
                </button>

                <div id="user-popup-menu" class="hidden absolute bottom-full left-3 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-2xl mb-2 border border-slate-200 dark:border-slate-700 overflow-hidden text-slate-700 dark:text-slate-200 animate-fade-in-up z-[60]">
                    <div class="p-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                        <p class="font-bold text-slate-800 dark:text-slate-100 truncate user-name-el">${userNameHTML}</p>
                        <p class="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wide">${roleDisplay}</p>
                    </div>
                    <button onclick="window.openEditProfile()" class="${['admin_kelas', 'admin_pks', 'siswa'].includes(userRole) ? 'hidden' : 'block'} w-full text-left px-4 py-2.5 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-blue-600 dark:hover:text-blue-400 transition text-slate-600 dark:text-slate-300">
                        <i class="fa-solid fa-user-pen w-5 text-slate-400 dark:text-slate-500"></i> Edit Profil
                    </button>
                    <div class="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition">
                        <div class="flex items-center gap-2">
                            <i class="fa-solid fa-moon w-5 text-slate-400 dark:text-slate-500 text-sm"></i>
                            <span class="text-sm font-medium text-slate-600 dark:text-slate-300">Dark Mode</span>
                        </div>
                        <button onclick="window.toggleDarkMode()" id="dark-mode-toggle" class="dark-mode-toggle" title="Toggle Dark Mode"></button>
                    </div>
                    <div class="border-t border-slate-100 dark:border-slate-700 p-1 bg-slate-50 dark:bg-slate-800">
                        <button onclick="window.doLogout()" class="w-full text-left px-3 py-2 text-sm font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-300 rounded-lg transition">
                            <i class="fa-solid fa-right-from-bracket w-5"></i> Keluar
                        </button>
                    </div>
                </div>
            </div>
        </aside>

        <nav class="mobile-topbar md:hidden fixed top-0 left-0 right-0 h-16 bg-slate-900 text-white z-50 flex items-center justify-between px-4 shadow-md" style="color: #ffffff !important;">
            <div class="flex items-center gap-3">
                <img src="${new URL(SCHOOL_CONFIG.logoPath, ROOT_URL).href}" alt="Logo ${SCHOOL_CONFIG.schoolShortName}" class="w-8 h-8 object-contain bg-white/10 rounded p-1">
                <span class="font-bold text-white" style="color: #ffffff !important;">${SCHOOL_CONFIG.appBrand}</span>
            </div>
            <div class="flex items-center gap-2">
                <!-- Tombol Lonceng Notifikasi Mobile -->
                <button id="btn-notification-bell-mobile" onclick="window.toggleNotificationCenter()" class="relative w-11 h-11 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-amber-400 hover:text-amber-300 transition-all flex items-center justify-center border border-slate-700/60 active:scale-95 shadow-sm" aria-label="Notifikasi">
                    <i class="fa-solid fa-bell text-base drop-shadow-sm"></i>
                    <span id="notif-badge-mobile" class="hidden absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-rose-500 text-white text-[10px] font-black rounded-full flex items-center justify-center border-2 border-slate-900 animate-pulse">0</span>
                </button>
                <button onclick="document.getElementById('mobile-menu').classList.remove('hidden')" class="w-11 h-11 flex items-center justify-center text-white active:scale-95 transition-transform" style="color: #ffffff !important;" aria-label="Buka Menu">
                    <i class="fa-solid fa-bars text-xl text-white" style="color: #ffffff !important;"></i>
                </button>
            </div>
        </nav>

        <div id="mobile-menu" class="hidden fixed inset-0 z-[70] bg-black/50 md:hidden transition-opacity" onclick="if(event.target === this) this.classList.add('hidden')">
            <div class="bg-white dark:bg-slate-900 w-72 h-full p-4 flex flex-col slide-in shadow-2xl relative">
                
                <div class="mb-3 font-bold text-slate-800 dark:text-white text-lg border-b border-slate-100 dark:border-slate-700 pb-3 flex justify-between items-center">
                    <span class="flex items-center gap-2"><i class="fa-solid fa-bars-staggered text-blue-600 dark:text-blue-400"></i> Menu Aplikasi</span>
                    <button onclick="document.getElementById('mobile-menu').classList.add('hidden')" aria-label="Tutup Menu" class="w-11 h-11 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-500 transition-colors">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <!-- SEARCH MENU MOBILE -->
                <div id="mobile-menu-search-wrapper" class="mb-3 relative">
                    <div class="relative">
                        <input id="sidebar-menu-search-mobile"
                               type="search"
                               role="searchbox"
                               aria-label="Cari menu SIMAS"
                               aria-controls="mobile-nav-menu"
                               autocomplete="off"
                               spellcheck="false"
                               enterkeyhint="go"
                               placeholder="Cari menu..."
                               class="menu-search-input w-full h-10 pl-3.5 pr-10 rounded-xl text-sm bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 border border-slate-200 dark:border-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all">
                        
                        <button id="mobile-menu-search-clear"
                                type="button"
                                aria-label="Hapus pencarian"
                                class="hidden absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center text-sm text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors cursor-pointer">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>

                    <!-- Panel Recent Menus Mobile -->
                    <div id="mobile-recent-menus-panel" class="hidden mt-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 shadow-lg space-y-1">
                        <div class="flex items-center justify-between px-2 pb-1 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                            <span><i class="fa-solid fa-clock-rotate-left mr-1 text-blue-500"></i> Terakhir Dibuka</span>
                        </div>
                        <div id="mobile-recent-menus-list" class="space-y-1 pt-1"></div>
                    </div>

                    <!-- Empty State Mobile -->
                    <div id="mobile-menu-search-empty" class="hidden py-4 px-2 text-center text-xs text-slate-500 dark:text-slate-400">
                        <p class="font-medium text-slate-700 dark:text-slate-300">Menu tidak ditemukan</p>
                        <p class="text-[11px] mt-0.5">Coba kata kunci: <span class="italic text-slate-600 dark:text-slate-300">absen, nilai, perpus</span></p>
                    </div>

                    <span id="mobile-menu-search-status" class="sr-only" aria-live="polite"></span>
                </div>
                
                <div id="mobile-nav-menu" class="space-y-1 flex-1 overflow-y-auto">
                     ${mobileMenuHTML}
                </div>

                <div class="mt-auto pt-4 border-t border-slate-100 dark:border-slate-700">


                    <div class="bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 mb-3 overflow-hidden">
                        <button onclick="document.getElementById('mobile-user-actions').classList.toggle('hidden'); document.getElementById('mobile-user-chevron').classList.toggle('rotate-180');" class="w-full p-3 flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors">
                            <div class="flex items-center gap-3 text-left w-[85%]">
                                <div class="user-avatar-container relative w-10 h-10 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold shadow-md shrink-0">
                                    ${cachedPhoto ? `<img src="${window.escapeHTML(cachedPhoto)}" alt="${window.escapeHTML(userName)}" class="w-full h-full object-cover rounded-full" onerror="this.remove()">` : userInitial}
                                    <span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-slate-50 dark:border-slate-800 animate-pulse z-20" title="Online"></span>
                                </div>
                                <div class="overflow-hidden">
                                    <p class="text-sm font-bold text-slate-800 dark:text-white truncate leading-tight user-name-el">${userNameHTML}</p>
                                    <p class="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider mt-0.5">${roleDisplay}</p>
                                </div>
                            </div>
                            <i id="mobile-user-chevron" class="fa-solid fa-chevron-down text-slate-400 transition-transform duration-200"></i>
                        </button>
                        
                        <div id="mobile-user-actions" class="hidden border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                            <!-- BUTTON EDIT PROFIL (Hanya untuk opsi non-siswa/admin kelas) -->
                            <button onclick="window.openEditProfile()" class="${['admin_kelas', 'admin_pks', 'siswa'].includes(userRole) ? 'hidden' : 'flex'} w-full items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition border-b border-slate-100 dark:border-slate-700">
                                <span class="w-6 text-center"><i class="fa-solid fa-user-pen text-slate-400"></i></span> Edit Profil
                            </button>
                            <!-- BUTTON KELUAR -->
                            <button onclick="window.doLogout()" class="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition">
                                <span class="w-6 text-center"><i class="fa-solid fa-power-off"></i></span> Keluar
                            </button>
                        </div>
                    </div>

                    <div class="space-y-2">
                        <!-- DARK MODE TOGGLE MOBILE -->
                        <div class="bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3 flex items-center justify-between border border-slate-100 dark:border-slate-700">
                            <div class="flex items-center gap-3 text-slate-600 dark:text-slate-300">
                                <i class="fa-solid fa-moon text-yellow-500 text-sm"></i>
                                <span class="text-sm font-bold">Dark Mode</span>
                            </div>
                            <button onclick="window.toggleDarkMode()" id="dark-mode-toggle-mobile" class="dark-mode-toggle" title="Toggle Dark Mode"></button>
                        </div>

                        <!-- PWA INSTALL BUTTON (Hidden by default, shown via JS) -->
                        <button id="btn-install-mobile" onclick="window.installPWA()" class="pwa-install-btn hidden w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-lg transition-all active:scale-95 mb-1">
                            <i class="fa-solid fa-download"></i> Install Aplikasi
                        </button>
                        <div class="text-center mt-2 text-slate-500 text-[10px] font-semibold opacity-75">Versi ${APP_VERSION}</div>
                    </div>
                </div>
            </div>
        </div>

        <div id="modal-global-logout" class="hidden fixed inset-0 z-[100] bg-slate-900/60 dark:bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm fade-in">
            <div class="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center transform scale-100 transition-all border border-slate-100 dark:border-slate-800" onclick="event.stopPropagation()">
                <div class="w-16 h-16 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500 border border-red-100 dark:border-red-900/30">
                    <i class="fa-solid fa-right-from-bracket text-2xl shadow-inner"></i>
                </div>
                <h3 class="font-bold text-slate-800 dark:text-white text-lg mb-2">Konfirmasi Keluar</h3>
                <p class="text-sm text-slate-500 dark:text-slate-400 mb-6">Apakah Anda yakin ingin mengakhiri sesi ini?</p>
                <div class="flex gap-3 justify-center">
                    <button onclick="document.getElementById('modal-global-logout').classList.add('hidden')" class="flex-1 px-5 py-2.5 rounded-xl font-bold text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 transition-colors text-sm">
                        Batal
                    </button>
                    <button onclick="window.confirmLogout()" class="flex-1 px-5 py-2.5 rounded-xl font-bold text-white bg-red-600 dark:bg-red-600 hover:bg-red-700 dark:hover:!bg-red-700 shadow-md transition-transform active:scale-95 text-sm">
                        Ya, Keluar
                    </button>
                </div>
            </div>
        </div>

        <!-- MODAL EDIT PROFIL -->
        <div id="modal-edit-profile" class="hidden fixed inset-0 z-[100] bg-slate-900/60 dark:bg-black/70 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm fade-in overflow-y-auto" onclick="document.getElementById('modal-edit-profile').classList.add('hidden')">
            <div class="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-3xl p-0 overflow-hidden transform scale-100 transition-all border border-slate-100 dark:border-slate-800 flex flex-col max-h-[92vh] my-auto" onclick="event.stopPropagation()">
                <!-- Header Modal -->
                <div class="bg-slate-50 dark:bg-slate-900/80 p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-2xl bg-blue-500/10 dark:bg-blue-400/10 flex items-center justify-center text-blue-600 dark:text-blue-400 text-lg shrink-0">
                            <i class="fa-solid fa-user-gear"></i>
                        </div>
                        <div>
                            <h3 class="font-bold text-slate-800 dark:text-white text-base sm:text-lg flex items-center gap-2">
                                <span>Edit Profil & Data GTK</span>
                                <span id="profile-role-badge" class="hidden sm:inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">GTK</span>
                            </h3>
                            <p class="text-xs text-slate-500 dark:text-slate-400">Kelola biodata resmi, kepegawaian, domisili, dan keamanan akun</p>
                        </div>
                    </div>
                    <button onclick="document.getElementById('modal-edit-profile').classList.add('hidden')" class="w-8 h-8 rounded-full bg-slate-200/50 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors" title="Tutup">
                        <i class="fa-solid fa-times text-sm"></i>
                    </button>
                </div>

                ${!['admin_kelas', 'admin_pks', 'siswa'].includes(userRole) ? `
                <!-- INDIKATOR KELENGKAPAN DATA GTK (COMPLETENESS SCORE) -->
                <div id="profile-completeness-section" class="px-5 py-3.5 bg-gradient-to-r from-blue-50/70 via-indigo-50/70 to-slate-50/70 dark:from-slate-800/60 dark:via-indigo-950/20 dark:to-slate-800/60 border-b border-indigo-100 dark:border-slate-800 shrink-0">
                    <div class="flex items-center justify-between gap-3 mb-2">
                        <div class="flex items-center gap-2">
                            <span class="w-6 h-6 rounded-lg bg-blue-600/10 dark:bg-blue-400/10 flex items-center justify-center text-blue-600 dark:text-blue-400 text-xs">
                                <i class="fa-solid fa-chart-pie"></i>
                            </span>
                            <div>
                                <span class="text-xs font-bold text-slate-800 dark:text-white">Kelengkapan Data GTK:</span>
                                <span id="profile-completeness-desc" class="text-xs font-medium text-slate-500 dark:text-slate-400 ml-1">Menghitung kelengkapan...</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-1.5">
                            <span id="profile-completeness-percent" class="text-sm font-extrabold text-blue-600 dark:text-blue-400">0%</span>
                        </div>
                    </div>
                    <div class="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                        <div id="profile-completeness-bar" class="h-full bg-gradient-to-r from-amber-500 to-emerald-500 rounded-full transition-all duration-500" style="width: 0%;"></div>
                    </div>
                </div>

                <!-- TABS NAVIGASI 4 TAB LEGA -->
                <div id="profile-tabs-nav" class="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 px-3 pt-2 gap-1 overflow-x-auto shrink-0 custom-scrollbar">
                    <button type="button" id="btn-profile-tab-bio" onclick="window.switchProfileTab('bio')" class="profile-tab-btn px-3.5 py-2 text-xs font-bold rounded-t-xl transition-all flex items-center gap-2 bg-blue-600 text-white shadow-sm shrink-0">
                        <i class="fa-solid fa-user"></i>
                        <span>Biodata</span>
                        <span id="tab-dot-bio" class="hidden w-2 h-2 rounded-full bg-amber-400 inline-block animate-pulse"></span>
                    </button>
                    <button type="button" id="btn-profile-tab-work" onclick="window.switchProfileTab('work')" class="profile-tab-btn px-3.5 py-2 text-xs font-bold rounded-t-xl transition-all flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0">
                        <i class="fa-solid fa-id-card"></i>
                        <span>Kepegawaian</span>
                        <span id="tab-dot-work" class="hidden w-2 h-2 rounded-full bg-amber-400 inline-block animate-pulse"></span>
                    </button>
                    <button type="button" id="btn-profile-tab-address" onclick="window.switchProfileTab('address')" class="profile-tab-btn px-3.5 py-2 text-xs font-bold rounded-t-xl transition-all flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0">
                        <i class="fa-solid fa-map-location-dot"></i>
                        <span>Alamat & Kontak</span>
                        <span id="tab-dot-address" class="hidden w-2 h-2 rounded-full bg-amber-400 inline-block animate-pulse"></span>
                    </button>
                    <button type="button" id="btn-profile-tab-security" onclick="window.switchProfileTab('security')" class="profile-tab-btn px-3.5 py-2 text-xs font-bold rounded-t-xl transition-all flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0">
                        <i class="fa-solid fa-shield-halved"></i>
                        <span>Akun & Keamanan</span>
                        <span id="tab-dot-security" class="hidden w-2 h-2 rounded-full bg-amber-400 inline-block animate-pulse"></span>
                    </button>
                </div>
                ` : ''}

                <!-- Body Scrollable -->
                <div id="profile-tab-panes" oninput="typeof window.updateProfileCompletenessUI === 'function' && window.updateProfileCompletenessUI()" onchange="typeof window.updateProfileCompletenessUI === 'function' && window.updateProfileCompletenessUI()" class="p-5 sm:p-6 overflow-y-auto flex-1 custom-scrollbar">
                    ${!['admin_kelas', 'admin_pks', 'siswa'].includes(userRole) ? `
                    <!-- TAB 1: BIODATA -->
                    <div id="profile-pane-bio" class="profile-tab-pane space-y-4">
                        <div>
                            <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                <i class="fa-solid fa-user text-blue-600 dark:text-blue-400"></i>
                                <span>Nama Lengkap (dengan Gelar)</span>
                            </label>
                            <input type="text" id="edit-profile-name" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-bold text-slate-800 dark:text-white transition-all shadow-sm">
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                    <i class="fa-solid fa-venus-mars text-indigo-500"></i>
                                    <span>Jenis Kelamin</span>
                                </label>
                                <select id="edit-profile-gender" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-semibold text-slate-800 dark:text-white transition-all shadow-sm">
                                    <option value="">-- Pilih Jenis Kelamin --</option>
                                    <option value="L">Laki-laki (L)</option>
                                    <option value="P">Perempuan (P)</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                    <i class="fa-solid fa-hands-praying text-emerald-500"></i>
                                    <span>Agama</span>
                                </label>
                                <select id="edit-profile-agama" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-semibold text-slate-800 dark:text-white transition-all shadow-sm">
                                    <option value="">-- Pilih Agama --</option>
                                    <option value="Islam">Islam</option>
                                    <option value="Kristen Protestan">Kristen Protestan</option>
                                    <option value="Katolik">Katolik</option>
                                    <option value="Hindu">Hindu</option>
                                    <option value="Buddha">Buddha</option>
                                    <option value="Khonghucu">Khonghucu</option>
                                    <option value="Lainnya">Lainnya</option>
                                </select>
                            </div>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                    <i class="fa-solid fa-city text-purple-500"></i>
                                    <span>Tempat Lahir</span>
                                </label>
                                <input type="text" id="edit-profile-birth-place" placeholder="Contoh: Denpasar" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                    <i class="fa-solid fa-cake-candles text-amber-500"></i>
                                    <span>Tanggal Lahir</span>
                                </label>
                                <input type="date" id="edit-profile-birth-date" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm">
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                <i class="fa-solid fa-graduation-cap text-sky-500"></i>
                                <span>Pendidikan Terakhir</span>
                            </label>
                            <select id="edit-profile-pendidikan" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-semibold text-slate-800 dark:text-white transition-all shadow-sm">
                                <option value="">-- Pilih Pendidikan Terakhir --</option>
                                <option value="S3">S3 / Doktoral</option>
                                <option value="S2">S2 / Magister</option>
                                <option value="S1">S1 / Sarjana</option>
                                <option value="D4">D4 / Diploma 4</option>
                                <option value="D3">D3 / Diploma 3</option>
                                <option value="D2">D2 / Diploma 2</option>
                                <option value="D1">D1 / Diploma 1</option>
                                <option value="SMA/SMK Sederajat">SMA/SMK Sederajat</option>
                                <option value="Lainnya">Lainnya</option>
                            </select>
                        </div>
                    </div>

                    <!-- TAB 2: KEPEGAWAIAN (ONE-TIME FILL POLICY) -->
                    <div id="profile-pane-work" class="profile-tab-pane hidden space-y-4">
                        <div class="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 flex items-start gap-3">
                            <i class="fa-solid fa-shield-halved text-amber-600 dark:text-amber-400 mt-0.5 text-base shrink-0"></i>
                            <div class="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                                <strong class="font-bold">Kebijakan Pengisian Satu Kali (One-Time Fill Policy):</strong>
                                NIK, NIP, NUPTK, dan status kepegawaian resmi dapat diisi mandiri apabila masih kosong. Setelah terisi dan tersimpan, data akan terkunci demi integritas pelaporan Dapodik & administrasi sekolah. Perubahan selanjutnya wajib melalui Super Admin atau Staf Tata Usaha.
                            </div>
                        </div>

                        <div>
                            <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center justify-between">
                                <span class="flex items-center gap-1.5">
                                    <i class="fa-solid fa-address-card text-indigo-600 dark:text-indigo-400"></i>
                                    <span>NIK (Nomor Induk Kependudukan - 16 Digit)</span>
                                </span>
                                <span id="lock-badge-nik"></span>
                            </label>
                            <input type="text" inputmode="numeric" maxlength="16" pattern="[0-9]*" id="edit-profile-nik" placeholder="16 digit NIK sesuai KTP" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-mono text-slate-800 dark:text-white transition-all shadow-sm">
                            <p class="text-[10px] text-slate-400 dark:text-slate-500 mt-1">NIK 16 digit adalah identitas tunggal Dapodik & SIMAS.</p>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center justify-between">
                                    <span class="flex items-center gap-1.5">
                                        <i class="fa-solid fa-id-badge text-blue-600 dark:text-blue-400"></i>
                                        <span>NIP (18 Digit)</span>
                                    </span>
                                    <span id="lock-badge-nip"></span>
                                </label>
                                <input type="text" inputmode="numeric" id="edit-profile-nip" placeholder="18 digit (kosongkan jika non-PNS)" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center justify-between">
                                    <span class="flex items-center gap-1.5">
                                        <i class="fa-solid fa-award text-amber-500"></i>
                                        <span>NUPTK (16 Digit)</span>
                                    </span>
                                    <span id="lock-badge-nuptk"></span>
                                </label>
                                <input type="text" inputmode="numeric" id="edit-profile-nuptk" placeholder="16 digit (kosongkan jika belum ada)" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm">
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center justify-between">
                                    <span class="flex items-center gap-1.5">
                                        <i class="fa-solid fa-briefcase text-emerald-500"></i>
                                        <span>Status Kepegawaian</span>
                                    </span>
                                    <span id="lock-badge-status"></span>
                                </label>
                                <select id="edit-profile-status-kepegawaian" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-semibold text-slate-800 dark:text-white transition-all shadow-sm">
                                    <option value="">-- Pilih Status --</option>
                                    <option value="PNS">PNS</option>
                                    <option value="PPPK">PPPK</option>
                                    <option value="GTT/PTT Provinsi">GTT/PTT Provinsi</option>
                                    <option value="GTY/PTY">GTY/PTY</option>
                                    <option value="Guru Honor Sekolah">Guru Honor Sekolah</option>
                                    <option value="Tenaga Honor Sekolah">Tenaga Honor Sekolah</option>
                                    <option value="Lainnya">Lainnya</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center justify-between">
                                    <span class="flex items-center gap-1.5">
                                        <i class="fa-solid fa-user-tag text-purple-500"></i>
                                        <span>Jenis PTK</span>
                                    </span>
                                    <span id="lock-badge-jenis"></span>
                                </label>
                                <select id="edit-profile-jenis-ptk" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-semibold text-slate-800 dark:text-white transition-all shadow-sm">
                                    <option value="">-- Pilih Jenis PTK --</option>
                                    <option value="Guru Mapel">Guru Mapel</option>
                                    <option value="Guru BK">Guru BK</option>
                                    <option value="Guru Pendamping Khusus">Guru Pendamping Khusus</option>
                                    <option value="Tenaga Administrasi Sekolah">Tenaga Administrasi Sekolah</option>
                                    <option value="Laboran">Laboran</option>
                                    <option value="Pustakawan">Pustakawan</option>
                                    <option value="Kepala Sekolah">Kepala Sekolah</option>
                                    <option value="Lainnya">Lainnya</option>
                                </select>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center justify-between">
                                    <span class="flex items-center gap-1.5">
                                        <i class="fa-solid fa-list-check text-sky-500"></i>
                                        <span>Tugas Tambahan</span>
                                    </span>
                                    <span id="lock-badge-tugas"></span>
                                </label>
                                <select id="edit-profile-tugas-tambahan" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-semibold text-slate-800 dark:text-white transition-all shadow-sm">
                                    <option value="-">- Tidak Ada -</option>
                                    <option value="Waka Kurikulum">Waka Kurikulum</option>
                                    <option value="Waka Kesiswaan">Waka Kesiswaan</option>
                                    <option value="Waka Sarpras">Waka Sarpras</option>
                                    <option value="Waka Humas">Waka Humas</option>
                                    <option value="Kepala Laboratorium">Kepala Laboratorium</option>
                                    <option value="Kepala Perpustakaan">Kepala Perpustakaan</option>
                                    <option value="Pembina OSIS">Pembina OSIS</option>
                                    <option value="Koordinator BK">Koordinator BK</option>
                                    <option value="Wali Kelas">Wali Kelas</option>
                                    <option value="Lainnya">Lainnya</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                    <i class="fa-solid fa-book-open text-rose-500"></i>
                                    <span>Mata Pelajaran Utama</span>
                                </label>
                                <input type="text" id="edit-profile-mapel" placeholder="-" disabled class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-100 dark:bg-slate-800/60 cursor-not-allowed opacity-80 text-sm font-semibold text-slate-700 dark:text-slate-300 shadow-sm">
                                <p class="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Ditetapkan melalui pembagian tugas kurikulum & jadwal KBM.</p>
                            </div>
                        </div>
                    </div>

                    <!-- TAB 3: ALAMAT DOMISILI & KONTAK -->
                    <div id="profile-pane-address" class="profile-tab-pane hidden space-y-4">
                        <div>
                            <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                <i class="fa-solid fa-road text-emerald-600 dark:text-emerald-400"></i>
                                <span>Alamat Jalan / Tempat Tinggal</span>
                            </label>
                            <input type="text" id="edit-profile-alamat" placeholder="Contoh: Jl. Diponegoro No. 45" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm">
                        </div>

                        <div class="grid grid-cols-2 gap-3.5">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                    <i class="fa-solid fa-hashtag text-slate-500"></i>
                                    <span>RT</span>
                                </label>
                                <input type="text" id="edit-profile-rt" placeholder="01" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                    <i class="fa-solid fa-hashtag text-slate-500"></i>
                                    <span>RW</span>
                                </label>
                                <input type="text" id="edit-profile-rw" placeholder="02" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm">
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                    <i class="fa-solid fa-tree-city text-indigo-500"></i>
                                    <span>Dusun / Lingkungan / Banjar</span>
                                </label>
                                <input type="text" id="edit-profile-dusun" placeholder="Contoh: Banjar Kuta" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                    <i class="fa-solid fa-building text-blue-500"></i>
                                    <span>Desa / Kelurahan</span>
                                </label>
                                <input type="text" id="edit-profile-kelurahan" placeholder="Contoh: Tuban" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm">
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                    <i class="fa-solid fa-map-pin text-rose-500"></i>
                                    <span>Kecamatan</span>
                                </label>
                                <input type="text" id="edit-profile-kecamatan" placeholder="Contoh: Kuta" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                    <i class="fa-solid fa-envelopes-bulk text-amber-500"></i>
                                    <span>Kode Pos</span>
                                </label>
                                <input type="text" inputmode="numeric" maxlength="5" id="edit-profile-kode-pos" placeholder="80361" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm">
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                    <i class="fa-brands fa-whatsapp text-emerald-600 dark:text-emerald-400"></i>
                                    <span>Nomor HP (WhatsApp)</span>
                                </label>
                                <input type="text" inputmode="tel" id="edit-profile-phone" placeholder="08..." class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm">
                            </div>
                            <div>
                                <div class="flex items-center justify-between mb-1">
                                    <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase flex items-center gap-1.5">
                                        <i class="fa-brands fa-telegram text-sky-500"></i>
                                        <span>Telegram Chat ID</span>
                                    </label>
                                    <a href="https://t.me/${window.SCHOOL_CONFIG?.telegramBotUser || "simas_demo_bot"}" target="_blank" rel="noopener noreferrer" class="text-[10px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-semibold">
                                        <i class="fa-solid fa-arrow-up-right-from-square"></i> Cek Bot
                                    </a>
                                </div>
                                <input type="text" inputmode="numeric" id="edit-profile-telegram-chat-id" placeholder="Contoh: 198160734 (Opsional)" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm">
                            </div>
                        </div>
                    </div>

                    <!-- TAB 4: AKUN & KEAMANAN -->
                    <div id="profile-pane-security" class="profile-tab-pane hidden space-y-4">
                        <!-- FOTO PROFIL GTK (CLOUDFLARE R2 & D1 GTK SSOT) -->
                        <div id="profile-photo-upload-section" class="hidden p-4 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40">
                            <div class="flex items-center gap-4">
                                <div class="relative w-16 h-16 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold shadow-md shrink-0 overflow-hidden border-2 border-white dark:border-slate-700">
                                    <span id="profile-photo-preview-placeholder">${userInitial}</span>
                                    <img id="profile-photo-preview-img" src="" alt="Foto Profil" class="hidden w-full h-full object-cover" onerror="this.classList.add('hidden'); document.getElementById('profile-photo-preview-placeholder')?.classList.remove('hidden');">
                                </div>
                                <div class="flex-1 min-w-0">
                                    <label class="block text-xs font-bold text-slate-800 dark:text-slate-200 uppercase mb-1 flex items-center gap-1.5">
                                        <i class="fa-solid fa-camera text-indigo-600 dark:text-indigo-400"></i> Foto Profil
                                    </label>
                                    <p class="text-[10px] text-slate-500 dark:text-slate-400 mb-2 leading-tight">
                                        Foto profil Anda di database GTK. Otomatis dikompres (WebP).
                                    </p>
                                    <div class="flex flex-wrap items-center gap-2">
                                        <label class="cursor-pointer px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition flex items-center gap-1.5 active:scale-95">
                                            <i class="fa-solid fa-cloud-arrow-up text-xs"></i>
                                            <span id="btn-label-profile-photo">Pilih Foto</span>
                                            <input type="file" id="input-profile-photo" accept="image/jpeg,image/png,image/webp" class="hidden" onchange="window.handleProfilePhotoSelected(event)">
                                        </label>
                                        <button type="button" id="btn-remove-profile-photo" onclick="window.removeProfilePhotoPreview()" class="hidden px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs font-bold hover:bg-rose-50 dark:hover:bg-rose-900/30 transition flex items-center gap-1">
                                            <i class="fa-solid fa-trash text-xs"></i> Hapus Foto
                                        </button>
                                    </div>
                                    <p id="profile-photo-status-text" class="text-[10px] text-slate-400 dark:text-slate-500 mt-1"></p>
                                </div>
                            </div>
                        </div>

                        <!-- AKSELERASI BIOMETRIK / PASSKEY SIDIK JARI -->
                        <div class="p-3.5 rounded-2xl bg-amber-500/10 dark:bg-amber-500/10 border border-amber-500/20 dark:border-amber-500/30">
                            <div class="flex items-center justify-between gap-2">
                                <div class="min-w-0 flex-1">
                                    <label class="block text-xs font-bold text-slate-800 dark:text-slate-200 uppercase flex items-center gap-1.5">
                                        <i class="fa-solid fa-fingerprint text-amber-500 text-sm"></i> Sensor Sidik Jari (Passkey)
                                    </label>
                                    <p id="biometric-status-text" class="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">Memeriksa dukungan perangkat...</p>
                                </div>
                                <div id="biometric-action-container" class="shrink-0"></div>
                            </div>
                        </div>

                        <!-- GOOGLE GEMINI API KEY -->
                        <div class="p-3.5 rounded-2xl bg-purple-500/10 dark:bg-purple-500/10 border border-purple-500/20 dark:border-purple-500/30 space-y-2.5">
                            <div class="flex items-center justify-between gap-2">
                                <div class="min-w-0 flex-1">
                                    <label class="block text-xs font-bold text-slate-800 dark:text-slate-200 uppercase flex items-center gap-1.5">
                                        <i class="fa-solid fa-wand-magic-sparkles text-purple-600 dark:text-purple-400 text-sm"></i> Google Gemini API Key
                                    </label>
                                    <p class="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
                                        Untuk fitur AI (Rapor AI, Analisis BK, PID). Dapatkan key gratis di <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" class="text-purple-600 dark:text-purple-400 font-bold underline hover:text-purple-700">Google AI Studio</a>.
                                    </p>
                                </div>
                                <span id="profile-ai-model-badge" class="text-[10px] font-semibold px-2 py-0.5 bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded-full shrink-0">
                                    Gemini AI
                                </span>
                            </div>

                            <div id="profile-api-key-list-container" class="space-y-1.5">
                                <div class="flex items-center justify-between px-0.5">
                                    <span class="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Kunci Tersimpan</span>
                                    <button type="button" onclick="window.testAllProfileApiKeys()" class="text-[10px] text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 flex items-center gap-1 font-bold hover:underline">
                                        <i class="fa-solid fa-arrows-rotate text-[9px]"></i> Uji Semua Status
                                    </button>
                                </div>
                                <ul id="profile-api-key-list" class="space-y-1.5"></ul>
                                <div id="profile-api-key-empty" class="hidden text-center py-2 px-3 bg-white/70 dark:bg-slate-800/70 rounded-xl border border-dashed border-purple-200 dark:border-purple-800/60">
                                    <p class="text-[10px] text-slate-400 dark:text-slate-500 flex items-center justify-center gap-1">
                                        <i class="fa-solid fa-key text-slate-300 dark:text-slate-600"></i> Belum ada API Key tersimpan.
                                    </p>
                                </div>
                            </div>

                            <div id="profile-add-key-form" class="hidden pt-2 border-t border-purple-200/50 dark:border-purple-800/50 space-y-2">
                                <div class="relative">
                                    <input type="password" id="input-profile-gemini-key" placeholder="Tempelkan API Key (AIzaSy...)" autocomplete="new-password"
                                        class="w-full px-3 py-2 pr-10 border border-purple-200 dark:border-purple-700/60 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 text-xs font-mono text-slate-700 dark:text-white transition-all">
                                    <button type="button" onclick="window.toggleProfileApiKeyVisibility()" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs p-1">
                                        <i class="fa-solid fa-eye" id="icon-profile-api-key-eye"></i>
                                    </button>
                                </div>
                                <div class="flex items-center justify-end gap-2">
                                    <button type="button" onclick="window.hideProfileAddKeyForm()" class="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                                        Batal
                                    </button>
                                    <button type="button" id="btn-save-profile-api-key" onclick="window.saveProfileApiKey()" class="px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-sm transition flex items-center gap-1.5 active:scale-95">
                                        <i class="fa-solid fa-check text-xs"></i> Simpan Key
                                    </button>
                                </div>
                            </div>

                            <div id="profile-add-key-btn-container" class="pt-0.5">
                                <button type="button" onclick="window.showProfileAddKeyForm()" class="w-full py-1.5 px-3 bg-purple-100/60 dark:bg-purple-900/30 hover:bg-purple-100 dark:hover:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 border border-purple-200 dark:border-purple-800/60 active:scale-95">
                                    <i class="fa-solid fa-plus text-xs"></i> Tambah API Key
                                </button>
                            </div>
                        </div>

                        <div>
                            <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                <i class="fa-solid fa-envelope text-blue-600 dark:text-blue-400"></i>
                                <span>Email / Akun Google</span>
                            </label>
                            <input type="email" id="edit-profile-email" placeholder="nama@gmail.com" oninput="typeof window.handleProfileAuthChangeVisibility === 'function' && window.handleProfileAuthChangeVisibility()" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm">
                            <p class="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Gunakan alamat Gmail aktif untuk login instan via "Masuk dengan Google".</p>
                        </div>

                        <div class="pt-2 border-t border-slate-100 dark:border-slate-800">
                            <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                <i class="fa-solid fa-key text-amber-500"></i>
                                <span>Password Baru (Opsional)</span>
                            </label>
                            <input type="password" id="edit-profile-password" minlength="8" placeholder="Isi hanya jika ingin ganti password" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm" oninput="typeof window.handleProfileAuthChangeVisibility === 'function' && window.handleProfileAuthChangeVisibility()">
                            <p class="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Format password baru: minimal 8 karakter dengan kombinasi huruf dan angka.</p>
                        </div>

                        <div id="old-password-section" class="hidden">
                            <label id="old-password-label" class="block text-xs font-bold text-red-500 dark:text-red-400 uppercase mb-1 flex items-center gap-1.5">
                                <i class="fa-solid fa-shield-halved"></i>
                                <span>Password Saat Ini (Konfirmasi Keamanan)</span>
                            </label>
                            <input type="password" id="edit-profile-old-password" placeholder="Wajib diisi untuk konfirmasi keamanan" class="w-full px-3.5 py-2.5 border border-red-200 dark:border-red-500/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 text-sm bg-red-50 dark:bg-red-900/20 text-slate-800 dark:text-white transition-all">
                        </div>
                    </div>
                    ` : `
                    <!-- FORM RINGKAS KHUSUS NON-GTK (SISWA / ADMIN KELAS) -->
                    <div id="profile-pane-nongtk" class="space-y-4">
                        <div>
                            <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                <i class="fa-solid fa-user text-blue-600 dark:text-blue-400"></i>
                                <span>Nama Lengkap</span>
                            </label>
                            <input type="text" id="edit-profile-name" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-bold text-slate-800 dark:text-white transition-all shadow-sm">
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                    <i class="fa-brands fa-whatsapp text-emerald-600"></i>
                                    <span>Nomor HP (WhatsApp)</span>
                                </label>
                                <input type="text" inputmode="tel" id="edit-profile-phone" placeholder="08..." class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                    <i class="fa-brands fa-telegram text-sky-500"></i>
                                    <span>Telegram Chat ID (Opsional)</span>
                                </label>
                                <input type="text" inputmode="numeric" id="edit-profile-telegram-chat-id" placeholder="Chat ID" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm">
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                <i class="fa-solid fa-envelope text-blue-600"></i>
                                <span>Email Akun</span>
                            </label>
                            <input type="email" id="edit-profile-email" placeholder="nama@gmail.com" oninput="typeof window.handleProfileAuthChangeVisibility === 'function' && window.handleProfileAuthChangeVisibility()" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm">
                        </div>
                        <div class="pt-2 border-t border-slate-100 dark:border-slate-800">
                            <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1 flex items-center gap-1.5">
                                <i class="fa-solid fa-key text-amber-500"></i>
                                <span>Password Baru (Opsional)</span>
                            </label>
                            <input type="password" id="edit-profile-password" minlength="8" placeholder="Isi hanya jika ingin ganti password" class="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-800 dark:text-white transition-all shadow-sm" oninput="typeof window.handleProfileAuthChangeVisibility === 'function' && window.handleProfileAuthChangeVisibility()">
                        </div>
                        <div id="old-password-section" class="hidden">
                            <label id="old-password-label" class="block text-xs font-bold text-red-500 dark:text-red-400 uppercase mb-1 flex items-center gap-1.5">
                                <i class="fa-solid fa-shield-halved"></i>
                                <span>Password Saat Ini</span>
                            </label>
                            <input type="password" id="edit-profile-old-password" placeholder="Wajib diisi untuk konfirmasi keamanan" class="w-full px-3.5 py-2.5 border border-red-200 dark:border-red-500/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 text-sm bg-red-50 dark:bg-red-900/20 text-slate-800 dark:text-white transition-all">
                        </div>
                    </div>
                    `}
                </div>

                <!-- Footer Modal -->
                <div class="p-4 sm:p-5 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-center gap-3 shrink-0">
                    <p class="text-[11px] text-slate-400 dark:text-slate-500 text-center sm:text-left flex items-center gap-1.5">
                        <i class="fa-solid fa-circle-info text-blue-500"></i>
                        <span>Perubahan data akan disimpan terpadu ke Cloudflare D1 & SIMAS.</span>
                    </p>
                    <div class="flex items-center gap-2.5 w-full sm:w-auto justify-end">
                        <button type="button" onclick="document.getElementById('modal-edit-profile').classList.add('hidden')" class="px-5 py-2.5 rounded-xl font-bold text-slate-500 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition shadow-sm text-sm">
                            Batal
                        </button>
                        <button type="button" id="btn-save-profile" onclick="window.saveEditProfile()" class="px-5 py-2.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md transition-transform active:scale-95 flex items-center gap-2 text-sm">
                            <i class="fa-solid fa-floppy-disk"></i>
                            <span>Simpan Profil</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- MODAL CROP & ROTATE FOTO PROFIL -->
        <div id="modal-crop-profile-photo" class="hidden fixed inset-0 z-[110] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 fade-in overflow-y-auto" onclick="window.closeProfilePhotoEditor()">
            <div class="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md p-0 overflow-hidden transform scale-100 transition-all border border-slate-100 dark:border-slate-800 flex flex-col max-h-[90vh] my-auto" onclick="event.stopPropagation()">
                <!-- Header -->
                <div class="bg-slate-50 dark:bg-slate-900/90 p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
                    <h3 class="font-bold text-slate-800 dark:text-white flex items-center text-sm sm:text-base">
                        <i class="fa-solid fa-crop-simple mr-2.5 text-indigo-600 dark:text-indigo-400"></i>Sesuaikan Foto Profil
                    </h3>
                    <button type="button" onclick="window.closeProfilePhotoEditor()" class="w-8 h-8 rounded-full bg-slate-200/60 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors" title="Tutup">
                        <i class="fa-solid fa-times text-sm"></i>
                    </button>
                </div>

                <!-- Body Editor -->
                <div class="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 custom-scrollbar flex flex-col items-center">
                    <p class="text-xs text-slate-500 dark:text-slate-400 text-center leading-relaxed">
                        Geser foto untuk menempatkan wajah di tengah lingkaran avatar, lalu gunakan tombol rotasi dan zoom agar pas.
                    </p>

                    <!-- Canvas Container (Square 1:1) -->
                    <div id="profile-crop-canvas-container" class="relative w-[280px] h-[280px] sm:w-[320px] sm:h-[320px] rounded-2xl overflow-hidden shadow-inner border-2 border-indigo-200 dark:border-indigo-900/60 bg-slate-900 flex items-center justify-center select-none touch-none cursor-grab active:cursor-grabbing">
                        <canvas id="profile-crop-canvas" width="400" height="400" class="w-full h-full block"></canvas>
                        
                        <!-- Circular Avatar Mask Overlay -->
                        <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
                            <svg class="w-full h-full" viewBox="0 0 400 400">
                                <defs>
                                    <mask id="profile-crop-mask">
                                        <rect width="400" height="400" fill="white" />
                                        <circle cx="200" cy="200" r="175" fill="black" />
                                    </mask>
                                </defs>
                                <rect width="400" height="400" fill="rgba(15, 23, 42, 0.65)" mask="url(#profile-crop-mask)" />
                                <circle cx="200" cy="200" r="175" fill="none" stroke="rgba(255, 255, 255, 0.85)" stroke-width="2.5" />
                                <circle cx="200" cy="200" r="173" fill="none" stroke="rgba(99, 102, 241, 0.85)" stroke-width="1.5" stroke-dasharray="6 4" />
                            </svg>
                        </div>
                    </div>

                    <!-- Editor Controls Toolbar -->
                    <div class="w-full space-y-3 pt-1">
                        <!-- Zoom Slider & Quick Buttons -->
                        <div class="flex items-center gap-3 px-2">
                            <button type="button" onclick="window.adjustProfileCropZoom(-0.1)" title="Perkecil" class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center justify-center text-xs transition active:scale-95 shadow-sm">
                                <i class="fa-solid fa-magnifying-glass-minus"></i>
                            </button>
                            <input type="range" id="profile-crop-zoom-range" min="0.5" max="3" step="0.05" value="1" oninput="window.setProfileCropZoom(this.value)" class="flex-1 accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg">
                            <button type="button" onclick="window.adjustProfileCropZoom(0.1)" title="Perbesar" class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center justify-center text-xs transition active:scale-95 shadow-sm">
                                <i class="fa-solid fa-magnifying-glass-plus"></i>
                            </button>
                        </div>

                        <!-- Action Controls: Rotasi & Reset -->
                        <div class="flex items-center justify-between gap-2 px-1">
                            <div class="flex items-center gap-1.5">
                                <button type="button" onclick="window.rotateProfileCrop(-90)" class="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 shadow-sm" title="Putar 90° Berlawanan Arah Jarum Jam">
                                    <i class="fa-solid fa-rotate-left text-xs text-indigo-500"></i> Putar Kiri
                                </button>
                                <button type="button" onclick="window.rotateProfileCrop(90)" class="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 shadow-sm" title="Putar 90° Searah Jarum Jam">
                                    <i class="fa-solid fa-rotate-right text-xs text-indigo-500"></i> Putar Kanan
                                </button>
                            </div>
                            <button type="button" onclick="window.resetProfileCrop()" class="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 shadow-sm" title="Reset Posisi, Rotasi, dan Skala">
                                <i class="fa-solid fa-arrow-rotate-left text-xs"></i> Reset
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Footer Actions -->
                <div class="p-4 sm:p-5 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2.5 shrink-0">
                    <button type="button" onclick="window.closeProfilePhotoEditor()" class="px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl font-bold text-slate-500 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition shadow-sm text-xs sm:text-sm">
                        Batal
                    </button>
                    <button type="button" id="btn-apply-profile-crop" onclick="window.applyProfileCrop()" class="px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-md hover:shadow-indigo-500/25 transition active:scale-95 flex items-center gap-2 text-xs sm:text-sm">
                        <i class="fa-solid fa-check"></i>Gunakan Foto
                    </button>
                </div>
            </div>
        </div>

        <!-- BACKDROP PUSAT NOTIFIKASI -->
        <div id="notification-center-backdrop" class="hidden fixed inset-0 z-[75] bg-slate-900/50 backdrop-blur-[2px] transition-opacity" onclick="window.closeNotificationCenter()"></div>

        <!-- PANEL PUSAT NOTIFIKASI ALA FACEBOOK -->
        <div id="notification-center-panel" class="hidden fixed z-[85] bg-white dark:bg-slate-900 rounded-3xl md:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 transition-all overflow-hidden flex-col bottom-0 left-0 right-0 max-h-[85vh] rounded-b-none md:bottom-auto md:top-16 md:w-[410px] md:max-h-[580px] md:rounded-2xl animate-fade-in">
            <!-- Header Panel -->
            <div class="p-4 bg-slate-50 dark:bg-slate-900/90 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-xl bg-blue-500/10 dark:bg-blue-400/10 flex items-center justify-center text-blue-600 dark:text-blue-400 text-sm">
                        <i class="fa-solid fa-bell"></i>
                    </div>
                    <div>
                        <h3 class="font-bold text-sm text-slate-800 dark:text-white flex items-center gap-2">
                            Notifikasi
                            <span id="notif-panel-unread-count" class="hidden px-2 py-0.5 text-[10px] font-black rounded-full bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300">0 Baru</span>
                        </h3>
                    </div>
                </div>
                <div class="flex items-center gap-1.5">
                    <button type="button" onclick="window.markAllNotificationsAsRead()" class="px-2.5 py-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-lg transition-colors flex items-center gap-1 cursor-pointer" title="Tandai semua sudah dibaca">
                        <i class="fa-solid fa-check-double text-xs"></i>
                        <span class="hidden sm:inline">Tandai Dibaca</span>
                    </button>
                    <button type="button" onclick="window.loadNotificationInbox(true)" class="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors text-xs cursor-pointer" title="Segarkan">
                        <i class="fa-solid fa-rotate-right"></i>
                    </button>
                    <button type="button" onclick="window.closeNotificationCenter()" class="w-7 h-7 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center justify-center transition-colors text-sm cursor-pointer" title="Tutup">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>

            <!-- Tab Filter (Semua vs Belum Dibaca) -->
            <div class="px-4 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800/80 flex items-center gap-2 shrink-0">
                <button type="button" id="tab-notif-all" onclick="window.setNotificationTab('all')" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 transition shadow-sm cursor-pointer">
                    Semua
                </button>
                <button type="button" id="tab-notif-unread" onclick="window.setNotificationTab('unread')" class="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer">
                    Belum Dibaca
                </button>
            </div>

            <!-- List Notifikasi Scrollable -->
            <div id="notification-items-list" class="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80 custom-scrollbar max-h-[60vh] md:max-h-[440px]">
                <div class="p-8 text-center text-slate-400 dark:text-slate-500 text-xs">
                    <i class="fa-solid fa-circle-notch fa-spin text-lg text-blue-500 mb-2 block"></i>
                    Memuat notifikasi...
                </div>
            </div>
        </div>

        <!-- MODAL DETAIL NOTIFIKASI LENGKAP -->
        <div id="modal-notification-detail" class="hidden fixed inset-0 z-[110] bg-slate-900/60 dark:bg-black/70 items-center justify-center p-4 backdrop-blur-sm fade-in" onclick="if(event.target === this) window.closeNotificationDetail()">
            <div class="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden transform scale-100 transition-all border border-slate-100 dark:border-slate-800 flex flex-col max-h-[85vh] animate-fade-in" onclick="event.stopPropagation()">
                <!-- Header Detail -->
                <div class="p-5 bg-slate-50 dark:bg-slate-900/90 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
                    <div class="flex items-center gap-3">
                        <div id="notif-detail-icon-container" class="w-10 h-10 rounded-2xl bg-blue-100 dark:bg-blue-950/50 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                            <i id="notif-detail-icon" class="fa-solid fa-bell text-lg"></i>
                        </div>
                        <div>
                            <span id="notif-detail-category-badge" class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">Informasi</span>
                            <p id="notif-detail-time" class="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Waktu</p>
                        </div>
                    </div>
                    <button type="button" onclick="window.closeNotificationDetail()" class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center justify-center transition-colors cursor-pointer">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <!-- Body Detail -->
                <div class="p-6 overflow-y-auto space-y-3 custom-scrollbar flex-1">
                    <h3 id="notif-detail-title" class="text-base font-bold text-slate-800 dark:text-white leading-snug">Judul Notifikasi</h3>
                    <div id="notif-detail-body" class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line bg-slate-50 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
                        Isi pesan notifikasi
                    </div>
                </div>

                <!-- Footer Detail CTA -->
                <div class="p-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
                    <button type="button" onclick="window.closeNotificationDetail()" class="px-4 py-2.5 rounded-xl font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 text-xs transition-colors cursor-pointer">
                        Tutup
                    </button>
                    <button type="button" id="notif-detail-btn-action" class="hidden px-5 py-2.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20 active:scale-95 transition-all text-xs flex items-center gap-2 cursor-pointer">
                        <span>Buka Halaman</span>
                        <i class="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                    </button>
                </div>
            </div>
        </div>
    `;

    layoutContainer.innerHTML = sidebarHTML;
    try {
        localStorage.removeItem('simas_cached_sidebar_html');
        localStorage.removeItem('simas_cached_sidebar_version');
    } catch (e) {}

    // Pasang event listener pencarian menu & shortcut (sekali saja)
    if (typeof setupSidebarMenuSearchEventsOnce === 'function') {
        setupSidebarMenuSearchEventsOnce();
    }

    // Sync dark mode toggle state after layout renders (desktop + mobile)
    const isDark = document.documentElement.classList.contains('dark');
    window.syncDarkModeToggles(isDark);

    // SESUAIKAN MARGIN UTAMA
    const mainContent = document.querySelector('main');
    if (mainContent) {
        mainContent.classList.remove('md:ml-64', 'md:ml-20');
        mainContent.classList.add(mainMargin, 'pt-16', 'md:pt-8', 'p-3.5', 'sm:p-5', 'md:p-6', 'min-h-screen', 'min-h-dvh', 'mobile-nav-offset', 'transition-all', 'duration-300');
    }

    // Mulai sinkronisasi tanpa jeda buatan dan tanpa menahan render halaman.
    if (user && user.uid) {
        Promise.resolve().then(() => window.updateSidebarProfileFromDB(user.uid));
    }
    localStorage.setItem('sidebar_collapsed', isCollapsed); // Ensure consistent string storage

    // CEK ULANG PWA INSTALL PROMPT & STATUS INSTALLED
    if (typeof window.updatePWAInstallUI === 'function') {
        window.updatePWAInstallUI();
    }

    setTimeout(injectChatIcon, 100);
    setTimeout(() => {
        if (typeof window.checkMasukanNewBadge === 'function') {
            window.checkMasukanNewBadge();
        }
        if (typeof window.loadNotificationInbox === 'function') {
            window.loadNotificationInbox();
        }
        if (typeof window.loadVipStatusSummary === 'function') {
            window.loadVipStatusSummary().then(() => {
                if (typeof window.applyVipBadgeToAllUserAvatars === 'function') {
                    window.applyVipBadgeToAllUserAvatars();
                }
            }).catch(e => console.warn('[VIP] Gagal memuat ringkasan VIP:', e));
        }
    }, 400);
};

// --- EARLY INSTANT LAYOUT RENDER (0ms Zero-Flicker) ---
export function earlyInitLayout() {
    const isOpacPage = window.location.pathname.includes('opac.html');
    const isEmbedMode = new URLSearchParams(window.location.search).get('mode') === 'popup' || 
                        new URLSearchParams(window.location.search).get('embed') === '1' || 
                        (isOpacPage && window.self !== window.top);
    if (isEmbedMode) return;

    const layoutContainer = document.getElementById('app-layout');
    if (!layoutContainer || layoutContainer.children.length > 0) return;

    const primaryRole = localStorage.getItem('user_role');
    if (primaryRole) {
        initLayout(primaryRole);
    }
}

// Jalankan earlyInitLayout segera saat modul dimuat & DOM siap
if (typeof window !== 'undefined') {
    window.initLayout = initLayout;
    window.earlyInitLayout = earlyInitLayout;
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', earlyInitLayout);
    } else {
        earlyInitLayout();
    }
}

// =====================================
// PENCARIAN MENU SIDEBAR & RIWAYAT (HYBRID & RBAC PARITY)
// =====================================

function getSidebarCurrentUid() {
    return (typeof auth !== 'undefined' && auth?.currentUser?.uid) || localStorage.getItem('last_login_uid') || '';
}

function normalizeMenuSearchText(str) {
    if (!str || typeof str !== 'string') return '';
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function matchMenuSearch(haystack, query) {
    const normHaystack = normalizeMenuSearchText(haystack);
    const tokens = normalizeMenuSearchText(query).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true;
    return tokens.every(token => normHaystack.includes(token));
}

function highlightMenuLabel(labelEl, query) {
    if (!labelEl) return;
    if (!labelEl.dataset.originalLabel) {
        labelEl.dataset.originalLabel = labelEl.textContent;
    }
    const rawText = labelEl.dataset.originalLabel;
    const tokens = normalizeMenuSearchText(query).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
        labelEl.textContent = rawText;
        return;
    }
    const escapedTokens = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escapedTokens.join('|')})`, 'gi');
    const parts = rawText.split(regex);
    labelEl.textContent = '';
    parts.forEach(part => {
        if (!part) return;
        if (tokens.some(t => normalizeMenuSearchText(part) === t)) {
            const mark = document.createElement('mark');
            mark.className = 'menu-search-mark';
            mark.textContent = part;
            labelEl.appendChild(mark);
        } else {
            labelEl.appendChild(document.createTextNode(part));
        }
    });
}

function getRecentMenuKeys(uid, allowedKeys = window.__simasAllowedMenuKeys) {
    if (!uid || !Array.isArray(allowedKeys)) return [];
    try {
        const raw = localStorage.getItem(`simas_recent_menus_${uid}`);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const currentHref = (typeof window !== 'undefined' && window.location) ? window.location.href.split('?')[0].split('#')[0] : '';
        const valid = parsed.filter(key => {
            return typeof key === 'string' &&
                allowedKeys.includes(key) &&
                MENU_LABELS[key] &&
                MENU_LABELS[key].link !== currentHref;
        });
        return valid.slice(0, 3);
    } catch (e) {
        return [];
    }
}

function recordRecentMenu(key) {
    const uid = getSidebarCurrentUid();
    const allowed = window.__simasAllowedMenuKeys;
    if (!uid || !key || !Array.isArray(allowed) || !allowed.includes(key) || !MENU_LABELS[key]) {
        return;
    }
    try {
        const raw = localStorage.getItem(`simas_recent_menus_${uid}`);
        let list = [];
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) list = parsed.filter(k => typeof k === 'string' && allowed.includes(k));
        }
        list = [key, ...list.filter(k => k !== key)].slice(0, 5);
        localStorage.setItem(`simas_recent_menus_${uid}`, JSON.stringify(list));
    } catch (e) {}
}

function renderRecentMenus(scope) {
    const uid = getSidebarCurrentUid();
    const panel = document.getElementById(`${scope}-recent-menus-panel`);
    const listEl = document.getElementById(`${scope}-recent-menus-list`);
    if (!panel || !listEl) return;

    const recentKeys = getRecentMenuKeys(uid);
    if (recentKeys.length === 0) {
        panel.classList.add('hidden');
        listEl.innerHTML = '';
        return;
    }

    listEl.innerHTML = '';
    recentKeys.forEach(key => {
        const m = MENU_LABELS[key];
        if (!m) return;
        const link = document.createElement('a');
        link.href = m.link;
        if (!m.link.startsWith(ROOT_URL)) link.target = '_blank';
        link.dataset.menuItem = '';
        link.dataset.menuKey = key;
        link.dataset.isRecent = 'true';
        if (scope === 'desktop') {
            link.className = 'flex items-center gap-2 px-2 py-1.5 rounded text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-700/80 transition-colors group cursor-pointer';
            link.innerHTML = `<i class="fa-solid ${m.icon} w-4 text-center text-slate-400 group-hover:text-blue-400"></i><span class="truncate flex-1">${window.escapeHTML ? window.escapeHTML(m.label) : m.label}</span><i class="fa-solid fa-arrow-turn-down -rotate-90 text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"></i>`;
        } else {
            link.className = 'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/70 transition-colors cursor-pointer';
            link.innerHTML = `<i class="fa-solid ${m.icon} w-5 text-center text-slate-500 dark:text-slate-400 text-sm"></i><span class="flex-1 truncate">${window.escapeHTML ? window.escapeHTML(m.label) : m.label}</span><i class="fa-solid fa-arrow-right text-xs text-slate-400"></i>`;
        }
        link.addEventListener('click', () => {
            recordRecentMenu(key);
        });
        listEl.appendChild(link);
    });
    panel.classList.remove('hidden');
}

const sidebarSearchSnapshots = {
    desktop: null,
    mobile: null
};

function applyMenuSearch(scope, query) {
    const navId = scope === 'desktop' ? 'sidebar-nav-menu' : 'mobile-nav-menu';
    const nav = document.getElementById(navId);
    const clearBtn = document.getElementById(`${scope}-menu-search-clear`);
    const hintBadge = document.getElementById(`${scope}-menu-search-hint`);
    const emptyEl = document.getElementById(`${scope}-menu-search-empty`);
    const statusEl = document.getElementById(`${scope}-menu-search-status`);
    const recentPanel = document.getElementById(`${scope}-recent-menus-panel`);

    if (!nav) return;

    const trimmed = (query || '').trim();

    if (!trimmed) {
        resetMenuSearch(scope);
        if (clearBtn) clearBtn.classList.add('hidden');
        if (hintBadge) hintBadge.classList.remove('hidden');
        return;
    }

    if (clearBtn) clearBtn.classList.remove('hidden');
    if (hintBadge) hintBadge.classList.add('hidden');
    if (recentPanel) recentPanel.classList.add('hidden');

    // Ambil snapshot accordion jika belum ada
    if (!sidebarSearchSnapshots[scope]) {
        const groupSelector = scope === 'desktop' ? '.menu-group' : '.menu-group-mobile';
        const itemsSelector = scope === 'desktop' ? '.menu-group-items' : '.menu-group-items-mobile';
        const snapshot = [];
        nav.querySelectorAll(groupSelector).forEach(group => {
            const items = group.querySelector(itemsSelector);
            const isOpen = items && !items.classList.contains('hidden');
            snapshot.push({
                key: group.dataset.group,
                isOpen
            });
        });
        sidebarSearchSnapshots[scope] = snapshot;
    }

    // Sembunyikan dividers
    nav.querySelectorAll('[data-menu-divider]').forEach(el => el.classList.add('hidden'));

    let totalMatches = 0;
    let firstMatchItem = null;

    // Bersihkan penanda active
    nav.querySelectorAll('[data-menu-item]').forEach(item => {
        item.removeAttribute('data-menu-active');
        item.classList.remove('ring-1', 'ring-blue-500');
    });

    const groupSelector = scope === 'desktop' ? '.menu-group' : '.menu-group-mobile';
    const itemsSelector = scope === 'desktop' ? '.menu-group-items' : '.menu-group-items-mobile';

    // Filter setiap group
    nav.querySelectorAll(groupSelector).forEach(group => {
        const groupName = group.dataset.groupName || '';
        const groupMatches = matchMenuSearch(groupName, trimmed);
        const subItems = group.querySelectorAll('[data-menu-item]');
        let groupMatchCount = 0;

        subItems.forEach(item => {
            const searchText = item.dataset.search || '';
            const isMatch = groupMatches || matchMenuSearch(searchText, trimmed);
            const labelEl = item.querySelector('[data-menu-label]');

            if (isMatch) {
                item.classList.remove('hidden');
                highlightMenuLabel(labelEl, trimmed);
                groupMatchCount++;
                totalMatches++;
                if (!firstMatchItem) firstMatchItem = item;
            } else {
                item.classList.add('hidden');
                if (labelEl && labelEl.dataset.originalLabel) {
                    labelEl.textContent = labelEl.dataset.originalLabel;
                }
            }
        });

        const itemsContainer = group.querySelector(itemsSelector);
        const chevron = group.querySelector('.fa-chevron-down');

        if (groupMatchCount > 0) {
            group.classList.remove('hidden');
            if (itemsContainer) itemsContainer.classList.remove('hidden');
            if (chevron) chevron.classList.add('rotate-180');
        } else {
            group.classList.add('hidden');
            if (itemsContainer) itemsContainer.classList.add('hidden');
            if (chevron) chevron.classList.remove('rotate-180');
        }
    });

    // Filter single items di luar group
    nav.querySelectorAll(`:scope > [data-menu-item]`).forEach(item => {
        const searchText = item.dataset.search || '';
        const isMatch = matchMenuSearch(searchText, trimmed);
        const labelEl = item.querySelector('[data-menu-label]');

        if (isMatch) {
            item.classList.remove('hidden');
            highlightMenuLabel(labelEl, trimmed);
            totalMatches++;
            if (!firstMatchItem) firstMatchItem = item;
        } else {
            item.classList.add('hidden');
            if (labelEl && labelEl.dataset.originalLabel) {
                labelEl.textContent = labelEl.dataset.originalLabel;
            }
        }
    });

    // Tandai item pertama sebagai active untuk navigasi keyboard
    if (firstMatchItem) {
        firstMatchItem.setAttribute('data-menu-active', 'true');
        firstMatchItem.classList.add('ring-1', 'ring-blue-500');
    }

    if (totalMatches === 0) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (statusEl) statusEl.textContent = 'Menu tidak ditemukan';
    } else {
        if (emptyEl) emptyEl.classList.add('hidden');
        if (statusEl) statusEl.textContent = `${totalMatches} menu ditemukan`;
    }
}

function resetMenuSearch(scope) {
    const navId = scope === 'desktop' ? 'sidebar-nav-menu' : 'mobile-nav-menu';
    const nav = document.getElementById(navId);
    const clearBtn = document.getElementById(`${scope}-menu-search-clear`);
    const hintBadge = document.getElementById(`${scope}-menu-search-hint`);
    const emptyEl = document.getElementById(`${scope}-menu-search-empty`);
    const statusEl = document.getElementById(`${scope}-menu-search-status`);
    const input = document.getElementById(`sidebar-menu-search-${scope}`);

    if (input) input.value = '';
    if (clearBtn) clearBtn.classList.add('hidden');
    if (hintBadge) hintBadge.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (statusEl) statusEl.textContent = '';

    if (!nav) return;

    // Tampilkan kembali dividers
    nav.querySelectorAll('[data-menu-divider]').forEach(el => el.classList.remove('hidden'));

    // Tampilkan kembali semua menu item dan pulihkan label teks
    nav.querySelectorAll('[data-menu-item]').forEach(item => {
        item.classList.remove('hidden');
        item.removeAttribute('data-menu-active');
        item.classList.remove('ring-1', 'ring-blue-500');
        const labelEl = item.querySelector('[data-menu-label]');
        if (labelEl && labelEl.dataset.originalLabel) {
            labelEl.textContent = labelEl.dataset.originalLabel;
        }
    });

    const groupSelector = scope === 'desktop' ? '.menu-group' : '.menu-group-mobile';
    const itemsSelector = scope === 'desktop' ? '.menu-group-items' : '.menu-group-items-mobile';

    // Pulihkan accordion group berdasarkan snapshot atau openGroups asli
    const snapshot = sidebarSearchSnapshots[scope];
    nav.querySelectorAll(groupSelector).forEach(group => {
        group.classList.remove('hidden');
        const items = group.querySelector(itemsSelector);
        const chevron = group.querySelector('.fa-chevron-down');
        let shouldBeOpen = false;

        if (snapshot) {
            const found = snapshot.find(s => s.key === group.dataset.group);
            shouldBeOpen = found ? found.isOpen : false;
        } else {
            const openGroups = JSON.parse(localStorage.getItem('sidebar_open_groups') || '[]');
            shouldBeOpen = openGroups.includes(group.dataset.group);
        }

        if (items) {
            if (shouldBeOpen) items.classList.remove('hidden');
            else items.classList.add('hidden');
        }
        if (chevron) {
            if (shouldBeOpen) chevron.classList.add('rotate-180');
            else chevron.classList.remove('rotate-180');
        }
    });

    sidebarSearchSnapshots[scope] = null;
}

function moveMenuSearchActive(scope, direction) {
    const navId = scope === 'desktop' ? 'sidebar-nav-menu' : 'mobile-nav-menu';
    const nav = document.getElementById(navId);
    if (!nav) return;

    // Kumpulkan semua item visible (termasuk recent items jika panel sedang tampil)
    const recentPanel = document.getElementById(`${scope}-recent-menus-panel`);
    const isRecentVisible = recentPanel && !recentPanel.classList.contains('hidden');
    let items = [];
    if (isRecentVisible) {
        items = Array.from(recentPanel.querySelectorAll('[data-menu-item]:not(.hidden)'));
    } else {
        items = Array.from(nav.querySelectorAll('[data-menu-item]:not(.hidden)'));
    }

    if (items.length === 0) return;

    const currentIndex = items.findIndex(item => item.getAttribute('data-menu-active') === 'true');
    let nextIndex = 0;
    if (currentIndex >= 0) {
        items[currentIndex].removeAttribute('data-menu-active');
        items[currentIndex].classList.remove('ring-1', 'ring-blue-500');
        if (direction === 'down') {
            nextIndex = (currentIndex + 1) % items.length;
        } else {
            nextIndex = (currentIndex - 1 + items.length) % items.length;
        }
    } else {
        nextIndex = direction === 'down' ? 0 : items.length - 1;
    }

    const nextItem = items[nextIndex];
    if (nextItem) {
        nextItem.setAttribute('data-menu-active', 'true');
        nextItem.classList.add('ring-1', 'ring-blue-500');
        nextItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function openActiveMenuResult(scope) {
    const navId = scope === 'desktop' ? 'sidebar-nav-menu' : 'mobile-nav-menu';
    const nav = document.getElementById(navId);
    const recentPanel = document.getElementById(`${scope}-recent-menus-panel`);
    const isRecentVisible = recentPanel && !recentPanel.classList.contains('hidden');

    let activeItem = null;
    if (isRecentVisible) {
        activeItem = recentPanel.querySelector('[data-menu-item][data-menu-active="true"]:not(.hidden)') ||
            recentPanel.querySelector('[data-menu-item]:not(.hidden)');
    }
    if (!activeItem && nav) {
        activeItem = nav.querySelector('[data-menu-item][data-menu-active="true"]:not(.hidden)') ||
            nav.querySelector('[data-menu-item]:not(.hidden)');
    }

    if (activeItem) {
        const key = activeItem.dataset.menuKey;
        if (key) recordRecentMenu(key);
        if (activeItem.target === '_blank') {
            window.open(activeItem.href, '_blank');
        } else {
            window.location.href = activeItem.href;
        }
    }
}

window.focusSidebarMenuSearch = function () {
    const isMobile = window.innerWidth < 768;
    if (isMobile) {
        const mobileMenu = document.getElementById('mobile-menu');
        if (mobileMenu) {
            mobileMenu.classList.remove('hidden');
            setTimeout(() => {
                const input = document.getElementById('sidebar-menu-search-mobile');
                if (input) {
                    input.focus();
                    renderRecentMenus('mobile');
                }
            }, 60);
        }
    } else {
        const sidebar = document.getElementById('desktop-sidebar');
        if (sidebar && sidebar.classList.contains('w-20')) {
            window.toggleSidebar();
        }
        setTimeout(() => {
            const input = document.getElementById('sidebar-menu-search-desktop');
            if (input) {
                input.focus();
                input.select();
                if (!input.value.trim()) renderRecentMenus('desktop');
            }
        }, 60);
    }
};

function setupSidebarMenuSearchEventsOnce() {
    if (window.__simasMenuSearchBound) return;
    window.__simasMenuSearchBound = true;

    // Event delegation untuk input pencarian
    document.addEventListener('input', (e) => {
        if (e.target && e.target.id === 'sidebar-menu-search-desktop') {
            applyMenuSearch('desktop', e.target.value);
        } else if (e.target && e.target.id === 'sidebar-menu-search-mobile') {
            applyMenuSearch('mobile', e.target.value);
        }
    });

    // Event delegation untuk focus / blur menampilkan Recent Menus
    document.addEventListener('focusin', (e) => {
        if (e.target && e.target.id === 'sidebar-menu-search-desktop') {
            if (!e.target.value.trim()) renderRecentMenus('desktop');
        } else if (e.target && e.target.id === 'sidebar-menu-search-mobile') {
            if (!e.target.value.trim()) renderRecentMenus('mobile');
        }
    });

    document.addEventListener('click', (e) => {
        // Klik tombol clear desktop
        if (e.target.closest('#desktop-menu-search-clear')) {
            resetMenuSearch('desktop');
            document.getElementById('sidebar-menu-search-desktop')?.focus();
            return;
        }
        // Klik tombol clear mobile
        if (e.target.closest('#mobile-menu-search-clear')) {
            resetMenuSearch('mobile');
            document.getElementById('sidebar-menu-search-mobile')?.focus();
            return;
        }
        // Klik di luar recent menu panel desktop -> tutup panel
        if (!e.target.closest('#desktop-menu-search-wrapper')) {
            const panel = document.getElementById('desktop-recent-menus-panel');
            if (panel) panel.classList.add('hidden');
        }
        // Klik di luar recent menu panel mobile -> tutup panel
        if (!e.target.closest('#mobile-menu-search-wrapper')) {
            const panel = document.getElementById('mobile-recent-menus-panel');
            if (panel) panel.classList.add('hidden');
        }
    });

    // Keyboard navigation di input pencarian
    document.addEventListener('keydown', (e) => {
        const isDesktopInput = e.target && e.target.id === 'sidebar-menu-search-desktop';
        const isMobileInput = e.target && e.target.id === 'sidebar-menu-search-mobile';

        if (isDesktopInput || isMobileInput) {
            const scope = isDesktopInput ? 'desktop' : 'mobile';
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveMenuSearchActive(scope, 'down');
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveMenuSearchActive(scope, 'up');
            } else if (e.key === 'Enter') {
                e.preventDefault();
                openActiveMenuResult(scope);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                if (e.target.value.trim()) {
                    resetMenuSearch(scope);
                } else {
                    e.target.blur();
                    const recentPanel = document.getElementById(`${scope}-recent-menus-panel`);
                    if (recentPanel) recentPanel.classList.add('hidden');
                    if (scope === 'mobile') {
                        document.getElementById('mobile-menu')?.classList.add('hidden');
                    }
                }
            }
        }
    });

    // Shortcut global Ctrl+K / Cmd+K
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            window.focusSidebarMenuSearch();
        }
    });
}

window.normalizeMenuSearchText = normalizeMenuSearchText;
window.matchMenuSearch = matchMenuSearch;
window.getRecentMenuKeys = getRecentMenuKeys;
window.recordRecentMenu = recordRecentMenu;
window.applyMenuSearch = applyMenuSearch;
window.resetMenuSearch = resetMenuSearch;

// --- LOGIKA SIDEBAR DESKTOP ---
window.toggleSidebar = () => {
    const sidebar = document.getElementById('desktop-sidebar');
    const texts = document.querySelectorAll('.sidebar-text');
    const mainContent = document.querySelector('main');
    const icon = document.getElementById('toggle-icon');
    const userMenu = document.getElementById('user-popup-menu');
    const searchContainer = document.getElementById('desktop-menu-search-container');
    const searchCollapsed = document.getElementById('desktop-menu-search-collapsed');

    // Tutup panel notifikasi jika sedang terbuka saat sidebar di-toggle
    if (typeof window.closeNotificationCenter === 'function') {
        window.closeNotificationCenter();
    }

    const isCurrentlyCollapsed = sidebar.classList.contains('w-20');

    if (isCurrentlyCollapsed) {
        sidebar.classList.replace('w-20', 'w-64');
        mainContent.classList.replace('md:ml-20', 'md:ml-64');
        icon.classList.replace('fa-chevron-right', 'fa-chevron-left');
        texts.forEach(el => el.classList.remove('hidden'));
        if (searchContainer) searchContainer.classList.remove('hidden');
        if (searchCollapsed) {
            searchCollapsed.classList.remove('flex');
            searchCollapsed.classList.add('hidden');
        }
        localStorage.setItem('sidebar_collapsed', 'false');

        // Otomatis scroll menu sidebar ke atas saat di-expand agar menu tidak ada yang tertutup
        const navMenu = document.getElementById('sidebar-nav-menu');
        if (navMenu) {
            navMenu.scrollTop = 0;
        }
    } else {
        sidebar.classList.replace('w-64', 'w-20');
        mainContent.classList.replace('md:ml-64', 'md:ml-20');
        icon.classList.replace('fa-chevron-left', 'fa-chevron-right');
        texts.forEach(el => el.classList.add('hidden'));
        if (searchContainer) searchContainer.classList.add('hidden');
        if (searchCollapsed) {
            searchCollapsed.classList.remove('hidden');
            searchCollapsed.classList.add('flex');
        }
        localStorage.setItem('sidebar_collapsed', 'true');
        if (userMenu) userMenu.classList.add('hidden');
        // Reset pencarian jika diciutkan
        if (typeof window.resetMenuSearch === 'function') {
            window.resetMenuSearch('desktop');
        }
    }
};

// --- LOGIKA TOGGLE MENU GROUP (ACCORDION) ---
window.toggleMenuGroup = (groupKey) => {
    const sidebar = document.getElementById('desktop-sidebar');
    const isCollapsed = sidebar && sidebar.classList.contains('w-20');

    // Jika sidebar sedang collapsed, expand dulu agar sub-menu terlihat lebar
    if (isCollapsed) {
        window.toggleSidebar();
    }

    const group = document.querySelector(`[data-group="${groupKey}"]`);
    if (!group) return;

    const items = group.querySelector('.menu-group-items');
    const chevron = group.querySelector('.fa-chevron-down');
    const isOpening = items && items.classList.contains('hidden');

    // Tutup semua group lain terlebih dahulu (auto-close)
    document.querySelectorAll('.menu-group').forEach(otherGroup => {
        if (otherGroup.dataset.group !== groupKey) {
            const otherItems = otherGroup.querySelector('.menu-group-items');
            const otherChevron = otherGroup.querySelector('.fa-chevron-down');
            if (otherItems) otherItems.classList.add('hidden');
            if (otherChevron) otherChevron.classList.remove('rotate-180');
        }
    });

    // Toggle group yang diklik
    if (items) {
        items.classList.toggle('hidden');
    }
    if (chevron) {
        chevron.classList.toggle('rotate-180');
    }

    // Simpan state ke localStorage (hanya 1 group yang terbuka)
    if (isOpening) {
        localStorage.setItem('sidebar_open_groups', JSON.stringify([groupKey]));

        // Auto scroll smooth agar menu group yang baru dibuka beserta sub-menunya terlihat penuh
        setTimeout(() => {
            group.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 150); // Jeda singkat agar transisi CSS expand sidebar / render sub-menu selesai
    } else {
        localStorage.setItem('sidebar_open_groups', JSON.stringify([]));
    }
};

window.toggleMenuGroupMobile = (groupKey) => {
    const group = document.querySelector(`.menu-group-mobile[data-group="${groupKey}"]`);
    if (!group) return;

    const items = group.querySelector('.menu-group-items-mobile');
    const chevron = group.querySelector('.fa-chevron-down');
    const isOpening = items && items.classList.contains('hidden');

    // Tutup semua group lain terlebih dahulu (auto-close)
    document.querySelectorAll('.menu-group-mobile').forEach(otherGroup => {
        if (otherGroup.dataset.group !== groupKey) {
            const otherItems = otherGroup.querySelector('.menu-group-items-mobile');
            const otherChevron = otherGroup.querySelector('.fa-chevron-down');
            if (otherItems) otherItems.classList.add('hidden');
            if (otherChevron) otherChevron.classList.remove('rotate-180');
        }
    });

    // Toggle group yang diklik
    if (items) {
        items.classList.toggle('hidden');
    }
    if (chevron) {
        chevron.classList.toggle('rotate-180');
    }

    // Simpan state ke localStorage (hanya 1 group yang terbuka)
    if (isOpening) {
        localStorage.setItem('sidebar_open_groups', JSON.stringify([groupKey]));
    } else {
        localStorage.setItem('sidebar_open_groups', JSON.stringify([]));
    }
};

// Fungsi untuk menutup semua menu group (dipanggil saat klik menu non-group)
window.closeAllMenuGroups = () => {
    document.querySelectorAll('.menu-group').forEach(group => {
        const items = group.querySelector('.menu-group-items');
        const chevron = group.querySelector('.fa-chevron-down');
        if (items) items.classList.add('hidden');
        if (chevron) chevron.classList.remove('rotate-180');
    });
    localStorage.setItem('sidebar_open_groups', JSON.stringify([]));
};

window.closeAllMenuGroupsMobile = () => {
    document.querySelectorAll('.menu-group-mobile').forEach(group => {
        const items = group.querySelector('.menu-group-items-mobile');
        const chevron = group.querySelector('.fa-chevron-down');
        if (items) items.classList.add('hidden');
        if (chevron) chevron.classList.remove('rotate-180');
    });
    localStorage.setItem('sidebar_open_groups', JSON.stringify([]));
};

// --- LOGIKA USER MENU DESKTOP ---
window.toggleUserMenu = () => {
    const menu = document.getElementById('user-popup-menu');
    menu.classList.toggle('hidden');

    if (!menu.classList.contains('hidden')) {
        setTimeout(() => document.addEventListener('click', closeMenuOutside), 100);
    }
};

const closeMenuOutside = (e) => {
    const menu = document.getElementById('user-popup-menu');
    if (menu && !menu.contains(e.target)) {
        menu.classList.add('hidden');
        document.removeEventListener('click', closeMenuOutside);
    }
};

// --- LOGIKA LOGOUT ---
window.doLogout = () => {
    document.getElementById('mobile-menu').classList.add('hidden');
    document.getElementById('modal-global-logout').classList.remove('hidden');
};

window.confirmLogout = async () => {
    const btn = document.querySelector('#modal-global-logout button.bg-red-600');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Proses...';
    btn.disabled = true;

    try {
        // Bersihkan cache per-user sebelum signOut
        const uid = auth.currentUser?.uid;
        if (typeof window.invalidateCurrentUserDoc === 'function') window.invalidateCurrentUserDoc();
        await signOut(auth);
        
        // Panggil clearUserSessionSafe agar kredensial biometrik passkey tidak terhapus saat logout
        if (typeof window.clearUserSessionSafe === 'function') {
            window.clearUserSessionSafe();
        } else {
            if (uid) {
                localStorage.removeItem(`simas_userdoc_${uid}`);
                localStorage.removeItem(`simas_user_data_${uid}`);
                localStorage.removeItem(`cached_user_name_${uid}`);
            }
            localStorage.removeItem('user_role');
            localStorage.removeItem('user_additional_roles');
            localStorage.removeItem('last_login_uid');
            localStorage.removeItem('simas_inbox_cache'); // isi lonceng pribadi (perangkat bersama)
            localStorage.removeItem('user_assigned_class');
            localStorage.removeItem('simas_system_config_cache');
            localStorage.removeItem('simas_finance_rates_cache');
            localStorage.removeItem('simas_finance_config_cache');
            localStorage.removeItem('cache_teachers_global');
            localStorage.removeItem('cache_teachers_global_ts');
            sessionStorage.clear();
        }
        window.location.href = `${ROOT_URL}index.html?redirect=` + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
    } catch (error) {
        console.error("Logout Error:", error);
        showToast("Error", "Gagal logout. Cek koneksi internet.", "error");
        btn.innerHTML = originalText;
        btn.disabled = false;
        document.getElementById('modal-global-logout').classList.add('hidden');
    }
};

let CURRENT_USER_TEACHER_CACHE = new Map();

/**
 * Helper cache untuk mengambil dokumen Linked Teacher dari user aktif (Hemat Read)
 */
window.getLinkedTeacherForUser = async function (user, userData) {
    if (!user || !user.email) return null;
    const email = user.email.toLowerCase();

    if (CURRENT_USER_TEACHER_CACHE.has(email)) {
        return CURRENT_USER_TEACHER_CACHE.get(email);
    }
    const sessStored = sessionStorage.getItem('simas_teacher_' + email);
    if (sessStored) {
        try {
            const parsed = JSON.parse(sessStored);
            CURRENT_USER_TEACHER_CACHE.set(email, parsed);
            return parsed;
        } catch (e) {}
    }

    let linkedTeacherId = userData?.nik || userData?.linkedTeacherId;
    let teacherData = null;

    try {
        const teachersMap = await window.getTeachersMapCache();
        if (linkedTeacherId && teachersMap.has(linkedTeacherId)) {
            teacherData = teachersMap.get(linkedTeacherId);
        } else if (userData?.nip && userData.nip !== '-' && teachersMap.has(userData.nip)) {
            teacherData = teachersMap.get(userData.nip);
            linkedTeacherId = teacherData.id || userData.nip;
        } else if (userData?.nik && userData.nik !== '-' && teachersMap.has(userData.nik)) {
            teacherData = teachersMap.get(userData.nik);
            linkedTeacherId = teacherData.id || userData.nik;
        } else if (user.email && teachersMap.has(user.email.toLowerCase().trim())) {
            teacherData = teachersMap.get(user.email.toLowerCase().trim());
            linkedTeacherId = teacherData.id;
        } else if (userData?.name && teachersMap.has(userData.name.toLowerCase().trim())) {
            teacherData = teachersMap.get(userData.name.toLowerCase().trim());
            linkedTeacherId = teacherData.id || teacherData.nik || teacherData.nip;
        } else if (user.displayName && teachersMap.has(user.displayName.toLowerCase().trim())) {
            teacherData = teachersMap.get(user.displayName.toLowerCase().trim());
            linkedTeacherId = teacherData.id || teacherData.nik || teacherData.nip;
        } else {
            // Pencocokan nama toleran gelar akademik/keagamaan
            const cleanStr = (n) => String(n || '').toLowerCase().replace(/,\s*.*$/g, '').replace(/\b(drs|dr|ir|s\.pd|m\.pd|s\.kom|s\.ag|s\.h|h)\b\.?/gi, '').replace(/[^a-z0-9]/g, '');
            const searchName = cleanStr(userData?.name || user.displayName);
            if (searchName) {
                for (const t of teachersMap.values()) {
                    if (t && t.name && cleanStr(t.name) === searchName) {
                        teacherData = t;
                        linkedTeacherId = t.id || t.nik || t.nip;
                        break;
                    }
                }
            }
        }
    } catch (eMap) {
        console.warn('[getLinkedTeacherForUser] Cache map lookup error:', eMap);
    }

    if (linkedTeacherId && teacherData) {
        const res = { id: linkedTeacherId, data: teacherData || {} };
        CURRENT_USER_TEACHER_CACHE.set(email, res);
        try {
            sessionStorage.setItem('simas_teacher_' + email, JSON.stringify(res));
        } catch (e) {}
        return res;
    }

    return null;
};

let TEACHERS_MAP_CACHE = null;

/**
 * Helper cache terpusat untuk pemetaan Multi-Index Guru (NIK, NIP, ID, Email) -> Data Guru (IndexedDB/SessionStorage)
 * Mendukung pencarian instan dengan 0 read Firestore tambahan.
 */
window.getTeachersMapCache = async function (forceRefresh = false) {
    if (!forceRefresh && TEACHERS_MAP_CACHE) {
        return TEACHERS_MAP_CACHE;
    }

    const sess = sessionStorage.getItem('simas_teachers_map');
    if (!forceRefresh && sess) {
        try {
            const parsed = JSON.parse(sess);
            TEACHERS_MAP_CACHE = new Map(Object.entries(parsed));
            return TEACHERS_MAP_CACHE;
        } catch (e) {}
    }

    try {
        const teachersList = await window.getTeachersCache(forceRefresh);
        const map = new Map();
        const plainObj = {};
        teachersList.forEach(d => {
            const docId = d.id || d.nik || d.nip;
            // Multi-Key Indexing untuk resolusi Hybrid instan
            map.set(docId, d);
            plainObj[docId] = d;

            if (d.nik && d.nik !== '-') {
                map.set(d.nik, d);
                plainObj[d.nik] = d;
            }
            if (d.nip && d.nip !== '-') {
                map.set(d.nip, d);
            }
            if (d.nuptk && d.nuptk !== '-') {
                map.set(d.nuptk, d);
            }
            if (d.email) {
                map.set(d.email.toLowerCase().trim(), d);
            }
            if (d.name) {
                map.set(d.name.toLowerCase().trim(), d);
            }
            if (d.nama) {
                map.set(d.nama.toLowerCase().trim(), d);
            }
        });
        TEACHERS_MAP_CACHE = map;
        try {
            sessionStorage.setItem('simas_teachers_map', JSON.stringify(plainObj));
        } catch (e) {}
        return TEACHERS_MAP_CACHE;
    } catch (e) {
        console.warn('[Cache] getTeachersMapCache error:', e);
        return TEACHERS_MAP_CACHE || new Map();
    }
};

/**
 * Kalkulasi Skor Kelengkapan Data GTK (Completeness Score)
 * Menghitung kelengkapan 21 atribut resmi Dapodik & SIMAS.
 */
window.calculateGtkCompleteness = function (data) {
    if (!data) return { score: 0, filledCount: 0, totalCount: 21, missingTabs: { bio: 6, work: 6, address: 8, security: 1 } };

    const isFilled = (val) => val !== undefined && val !== null && String(val).trim() !== '' && String(val).trim() !== '-';

    const bioFields = ['name', 'gender', 'birth_place', 'birth_date', 'agama', 'pendidikan_terakhir'];
    const workFields = ['nik', 'nip', 'nuptk', 'status_kepegawaian', 'jenis_ptk', 'tugas_tambahan'];
    const addrFields = ['alamat', 'rt', 'rw', 'dusun', 'kelurahan', 'kecamatan', 'kode_pos', 'phone'];

    let filledCount = 0;
    const missingTabs = { bio: 0, work: 0, address: 0, security: 0 };

    bioFields.forEach(f => {
        if (isFilled(data[f])) filledCount++;
        else missingTabs.bio++;
    });

    workFields.forEach(f => {
        if (isFilled(data[f])) filledCount++;
        else missingTabs.work++;
    });

    addrFields.forEach(f => {
        if (isFilled(data[f])) filledCount++;
        else missingTabs.address++;
    });

    // Foto Profil (Identitas Digital & Keamanan)
    if (isFilled(data.foto) || isFilled(data.photo_url)) {
        filledCount++;
    } else {
        missingTabs.security++;
    }

    const totalCount = bioFields.length + workFields.length + addrFields.length + 1; // 21 atribut
    const score = Math.round((filledCount / totalCount) * 100);

    return { score, filledCount, totalCount, missingTabs };
};

/**
 * Penggantian Tab Aktif Modal Edit Profil
 */
window.switchProfileTab = function (tabKey) {
    const tabs = ['bio', 'work', 'address', 'security'];
    if (!tabs.includes(tabKey)) tabKey = 'bio';

    tabs.forEach(key => {
        const btn = document.getElementById(`btn-profile-tab-${key}`);
        const pane = document.getElementById(`profile-pane-${key}`);
        if (key === tabKey) {
            if (btn) {
                btn.className = 'profile-tab-btn px-3.5 py-2 text-xs font-bold rounded-t-xl transition-all flex items-center gap-2 bg-blue-600 text-white shadow-sm shrink-0';
            }
            if (pane) pane.classList.remove('hidden');
        } else {
            if (btn) {
                btn.className = 'profile-tab-btn px-3.5 py-2 text-xs font-bold rounded-t-xl transition-all flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0';
            }
            if (pane) pane.classList.add('hidden');
        }
    });
};

/**
 * Pembaruan Antarmuka Skor Kelengkapan Data GTK
 */
window.updateProfileCompletenessUI = function (data) {
    if (!data && typeof document !== 'undefined') {
        const previewImg = document.getElementById('profile-photo-preview-img');
        const hasPhoto = Boolean(window._pendingProfilePhotoBase64 || (!window._pendingProfilePhotoDelete && previewImg && previewImg.getAttribute('src') && !previewImg.classList.contains('hidden')));
        data = {
            name: document.getElementById('edit-profile-name')?.value,
            gender: document.getElementById('edit-profile-gender')?.value,
            birth_place: document.getElementById('edit-profile-birth-place')?.value,
            birth_date: document.getElementById('edit-profile-birth-date')?.value,
            agama: document.getElementById('edit-profile-agama')?.value,
            pendidikan_terakhir: document.getElementById('edit-profile-pendidikan')?.value,
            nik: document.getElementById('edit-profile-nik')?.value,
            nip: document.getElementById('edit-profile-nip')?.value,
            nuptk: document.getElementById('edit-profile-nuptk')?.value,
            status_kepegawaian: document.getElementById('edit-profile-status-kepegawaian')?.value,
            jenis_ptk: document.getElementById('edit-profile-jenis-ptk')?.value,
            tugas_tambahan: document.getElementById('edit-profile-tugas-tambahan')?.value,
            alamat: document.getElementById('edit-profile-alamat')?.value,
            rt: document.getElementById('edit-profile-rt')?.value,
            rw: document.getElementById('edit-profile-rw')?.value,
            dusun: document.getElementById('edit-profile-dusun')?.value,
            kelurahan: document.getElementById('edit-profile-kelurahan')?.value,
            kecamatan: document.getElementById('edit-profile-kecamatan')?.value,
            kode_pos: document.getElementById('edit-profile-kode-pos')?.value,
            phone: document.getElementById('edit-profile-phone')?.value,
            foto: hasPhoto ? 'has_photo' : ''
        };
    }
    const res = window.calculateGtkCompleteness(data);
    const percentEl = document.getElementById('profile-completeness-percent');
    const descEl = document.getElementById('profile-completeness-desc');
    const barEl = document.getElementById('profile-completeness-bar');

    if (percentEl) percentEl.textContent = `${res.score}%`;
    if (descEl) descEl.textContent = `${res.filledCount} dari ${res.totalCount} atribut terisi`;
    if (barEl) {
        barEl.style.width = `${res.score}%`;
        if (res.score >= 80) {
            barEl.className = 'h-full bg-emerald-500 rounded-full transition-all duration-500';
        } else if (res.score >= 50) {
            barEl.className = 'h-full bg-gradient-to-r from-amber-500 to-emerald-500 rounded-full transition-all duration-500';
        } else {
            barEl.className = 'h-full bg-gradient-to-r from-rose-500 to-amber-500 rounded-full transition-all duration-500';
        }
    }

    ['bio', 'work', 'address', 'security'].forEach(key => {
        const dot = document.getElementById(`tab-dot-${key}`);
        if (dot) {
            if (res.missingTabs && res.missingTabs[key] > 0) {
                dot.classList.remove('hidden');
            } else {
                dot.classList.add('hidden');
            }
        }
    });
};

window.openEditProfile = async function () {
    const user = auth.currentUser;
    if (!user) return;

    // Tutup menu popup dan navigasi mobile
    document.getElementById('user-popup-menu')?.classList.add('hidden');
    document.getElementById('mobile-menu')?.classList.add('hidden');

    const btn = document.querySelector('button[onclick="window.openEditProfile()"] i');
    if (btn) btn.className = "fa-solid fa-circle-notch fa-spin w-5 text-blue-600";

    // Reset pending state foto profil
    window._pendingProfilePhotoBase64 = null;
    window._pendingProfilePhotoDelete = false;

    try {
        // 1. Ambil data User (Login)
        const userDocRef = doc(db, PATHS.users, user.uid);
        const userSnap = await getDoc(userDocRef);
        const userData = userSnap.exists() ? userSnap.data() : {};

        let displayData = {
            name: userData.name || user.displayName || "",
            phone: userData.phone || "",
            nip: userData.nip || "",
            telegramChatId: userData.telegramChatId || ""
        };

        // 2. Cek Linked Teacher (SSOT untuk Guru/Staff)
        const teacherObj = await window.getLinkedTeacherForUser(user, userData);
        let teacherData = teacherObj?.data || {};

        if (teacherObj?.id && typeof cfClient !== 'undefined' && typeof cfClient.getTeacher === 'function') {
            try {
                const fresh = await cfClient.getTeacher(teacherObj.id);
                if (fresh) teacherData = { ...teacherData, ...fresh };
            } catch (eF) {
                console.warn('[openEditProfile] Ambil data GTK fresh dari D1 fallback ke cache:', eF);
            }
        }

        const isGtkUser = Boolean(teacherObj && teacherObj.id);
        const isSuperAdmin = (typeof window.hasRole === 'function' && window.hasRole('super_admin')) ||
                             (localStorage.getItem('user_role') === 'super_admin') ||
                             (userData.role === 'super_admin' || userData.role === 'superadmin');
        const isManager = isSuperAdmin ||
                          (typeof window.hasRole === 'function' && (window.hasRole('admin') || window.hasRole('tu'))) ||
                          ['admin', 'tu'].includes(localStorage.getItem('user_role')) ||
                          ['admin', 'tu'].includes(userData.role);

        // Foto Profil: Tampilkan kontrol upload HANYA jika terhubung ke data GTK
        const photoSection = document.getElementById('profile-photo-upload-section');
        if (photoSection) photoSection.classList.add('hidden');
        const photoPreviewImg = document.getElementById('profile-photo-preview-img');
        const photoPlaceholder = document.getElementById('profile-photo-preview-placeholder');
        const btnRemovePhoto = document.getElementById('btn-remove-profile-photo');
        const statusText = document.getElementById('profile-photo-status-text');
        const fileInput = document.getElementById('input-profile-photo');

        if (fileInput) fileInput.value = '';

        if (isGtkUser) {
            displayData.name = teacherData.name || displayData.name;
            displayData.phone = teacherData.phone || displayData.phone;
            displayData.nip = teacherData.nip || displayData.nip;
            displayData.telegramChatId = teacherData.telegram_chat_id || teacherData.telegramChatId || displayData.telegramChatId;

            if (photoSection) {
                photoSection.classList.remove('hidden');
                const rawPhotoUrl = teacherData.foto || teacherData.photo_url || localStorage.getItem(`cached_user_photo_${user.uid}`);
                const currentPhotoUrl = resolvePhotoUrl(rawPhotoUrl);
                const btnLabel = document.getElementById('btn-label-profile-photo');
                if (currentPhotoUrl) {
                    if (photoPreviewImg) {
                        photoPreviewImg.src = currentPhotoUrl;
                        photoPreviewImg.classList.remove('hidden');
                    }
                    if (photoPlaceholder) photoPlaceholder.classList.add('hidden');
                    if (btnLabel) btnLabel.textContent = 'Ganti Foto';
                    // Khusus Super Admin yang berhak menghapus foto profil GTK; guru/staf hanya edit/ganti
                    if (btnRemovePhoto) {
                        if (isSuperAdmin) {
                            btnRemovePhoto.classList.remove('hidden');
                        } else {
                            btnRemovePhoto.classList.add('hidden');
                        }
                    }
                } else {
                    if (photoPreviewImg) {
                        photoPreviewImg.src = '';
                        photoPreviewImg.classList.add('hidden');
                    }
                    if (photoPlaceholder) {
                        photoPlaceholder.innerText = (displayData.name || 'U').charAt(0).toUpperCase();
                        photoPlaceholder.classList.remove('hidden');
                    }
                    if (btnLabel) btnLabel.textContent = 'Pilih Foto';
                    if (btnRemovePhoto) btnRemovePhoto.classList.add('hidden');
                }
                if (statusText) {
                    statusText.innerText = '';
                    statusText.className = 'text-[10px] text-slate-400 dark:text-slate-500 mt-1';
                }
            }

            // Populate Tab 1: Biodata
            const genderEl = document.getElementById('edit-profile-gender');
            if (genderEl) genderEl.value = teacherData.gender || '';
            const bPlaceEl = document.getElementById('edit-profile-birth-place');
            if (bPlaceEl) bPlaceEl.value = teacherData.birth_place || '';
            const bDateEl = document.getElementById('edit-profile-birth-date');
            if (bDateEl) bDateEl.value = teacherData.birth_date ? String(teacherData.birth_date).substring(0, 10) : '';
            const agamaEl = document.getElementById('edit-profile-agama');
            if (agamaEl) agamaEl.value = teacherData.agama || '';
            const pendEl = document.getElementById('edit-profile-pendidikan');
            if (pendEl) pendEl.value = teacherData.pendidikan_terakhir || '';

            // Populate Tab 2: Kepegawaian (One-Time Fill Policy)
            const nikEl = document.getElementById('edit-profile-nik');
            if (nikEl) nikEl.value = teacherData.nik && teacherData.nik !== '-' ? teacherData.nik : '';
            const nipEl = document.getElementById('edit-profile-nip');
            if (nipEl) nipEl.value = teacherData.nip && teacherData.nip !== '-' ? teacherData.nip : '';
            const nuptkEl = document.getElementById('edit-profile-nuptk');
            if (nuptkEl) nuptkEl.value = teacherData.nuptk && teacherData.nuptk !== '-' ? teacherData.nuptk : '';
            const statusEl = document.getElementById('edit-profile-status-kepegawaian');
            if (statusEl) statusEl.value = teacherData.status_kepegawaian || '';
            const jenisPtkEl = document.getElementById('edit-profile-jenis-ptk');
            if (jenisPtkEl) jenisPtkEl.value = teacherData.jenis_ptk || '';
            const tugasEl = document.getElementById('edit-profile-tugas-tambahan');
            if (tugasEl) tugasEl.value = teacherData.tugas_tambahan || '-';
            const mapelEl = document.getElementById('edit-profile-mapel');
            if (mapelEl) mapelEl.value = teacherData.mapel || '';

            // Kunci Field Kepegawaian Resmi jika sudah terisi dan user bukan Manager
            const officialFields = [
                { id: 'edit-profile-nik', key: 'nik', badge: 'lock-badge-nik' },
                { id: 'edit-profile-nip', key: 'nip', badge: 'lock-badge-nip' },
                { id: 'edit-profile-nuptk', key: 'nuptk', badge: 'lock-badge-nuptk' },
                { id: 'edit-profile-status-kepegawaian', key: 'status_kepegawaian', badge: 'lock-badge-status' },
                { id: 'edit-profile-jenis-ptk', key: 'jenis_ptk', badge: 'lock-badge-jenis' },
                { id: 'edit-profile-tugas-tambahan', key: 'tugas_tambahan', badge: 'lock-badge-tugas' }
            ];

            officialFields.forEach(({ id, key, badge }) => {
                const inputEl = document.getElementById(id);
                const badgeEl = document.getElementById(badge);
                if (!inputEl) return;
                const currentVal = String(teacherData[key] || '').trim();
                const isFilled = currentVal && currentVal !== '-';

                if (isFilled && !isManager) {
                    inputEl.disabled = true;
                    inputEl.classList.add('bg-slate-100', 'dark:bg-slate-800/60', 'cursor-not-allowed', 'opacity-85');
                    if (badgeEl) {
                        badgeEl.innerHTML = `<span class="text-[10px] text-amber-600 dark:text-amber-400 font-bold ml-1.5 inline-flex items-center gap-1" title="Data resmi telah terkunci"><i class="fa-solid fa-lock text-[9px]"></i> Terkunci</span>`;
                    }
                } else {
                    inputEl.disabled = false;
                    inputEl.classList.remove('bg-slate-100', 'dark:bg-slate-800/60', 'cursor-not-allowed', 'opacity-85');
                    if (badgeEl) {
                        if (isManager && isFilled) {
                            badgeEl.innerHTML = `<span class="text-[10px] text-blue-600 dark:text-blue-400 font-bold ml-1.5 inline-flex items-center gap-1" title="Mode Pengelola (Dapat Diedit)"><i class="fa-solid fa-pen text-[9px]"></i> Kelola (Admin)</span>`;
                        } else {
                            badgeEl.innerHTML = `<span class="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold ml-1.5 inline-flex items-center gap-1" title="Dapat diisi mandiri satu kali"><i class="fa-solid fa-lock-open text-[9px]"></i> Isi Mandiri</span>`;
                        }
                    }
                }
            });

            // Populate Tab 3: Alamat Domisili & Kontak
            const alamatEl = document.getElementById('edit-profile-alamat');
            if (alamatEl) alamatEl.value = teacherData.alamat || (teacherData.address && !teacherData.alamat ? teacherData.address : '');
            const rtEl = document.getElementById('edit-profile-rt');
            if (rtEl) rtEl.value = teacherData.rt || '';
            const rwEl = document.getElementById('edit-profile-rw');
            if (rwEl) rwEl.value = teacherData.rw || '';
            const dusunEl = document.getElementById('edit-profile-dusun');
            if (dusunEl) dusunEl.value = teacherData.dusun || '';
            const kelEl = document.getElementById('edit-profile-kelurahan');
            if (kelEl) kelEl.value = teacherData.kelurahan || '';
            const kecEl = document.getElementById('edit-profile-kecamatan');
            if (kecEl) kecEl.value = teacherData.kecamatan || '';
            const posEl = document.getElementById('edit-profile-kode-pos');
            if (posEl) posEl.value = teacherData.kode_pos || '';

            // Update Kelengkapan Data GTK UI
            if (typeof window.updateProfileCompletenessUI === 'function') {
                window.updateProfileCompletenessUI(teacherData);
            }

            // Aktifkan tab pertama
            if (typeof window.switchProfileTab === 'function') {
                window.switchProfileTab('bio');
            }
        } else {
            if (photoSection) photoSection.classList.add('hidden');
        }

        // Field Umum (Nama, Email, HP, Telegram, Password)
        const nameEl = document.getElementById('edit-profile-name');
        if (nameEl) nameEl.value = displayData.name;
        const emailEl = document.getElementById('edit-profile-email');
        const initialEmailVal = (userData.email || user.email || "").toLowerCase().trim();
        if (emailEl) {
            emailEl.value = initialEmailVal;
            emailEl.dataset.initialEmail = initialEmailVal;
        }
        const phoneEl = document.getElementById('edit-profile-phone');
        if (phoneEl) phoneEl.value = displayData.phone;
        const telegramEl = document.getElementById('edit-profile-telegram-chat-id');
        if (telegramEl) telegramEl.value = displayData.telegramChatId;
        const passEl = document.getElementById('edit-profile-password');
        if (passEl) passEl.value = "";
        const oldPassEl = document.getElementById('edit-profile-old-password');
        if (oldPassEl) oldPassEl.value = "";
        document.getElementById('old-password-section')?.classList.add('hidden');

        // Buka Modal
        document.getElementById('modal-edit-profile').classList.remove('hidden');
        if (typeof window.checkBiometricStatusUI === 'function') {
            window.checkBiometricStatusUI();
        }
        if (typeof window.loadProfileApiKeys === 'function') {
            window.loadProfileApiKeys(user.uid);
        }
    } catch (e) {
        console.error("Gagal load profil", e);
        showToast("Error", "Gagal memuat data profil. Cek koneksi.", "error");
    } finally {
        if (btn) btn.className = "fa-solid fa-user-pen w-5 text-slate-400";
    }
};
window.openProfileModal = window.openEditProfile;

// ==========================================
// MODUL EDITOR FOTO PROFIL (CROP 1:1, ROTASI 90°, ZOOM & GESER)
// ==========================================
let profileCropImage = null;
let profileCropZoom = 1.0;
let profileCropRotation = 0;
let profileCropOffsetX = 0;
let profileCropOffsetY = 0;
let isDraggingProfileCrop = false;
let profileDragStartX = 0;
let profileDragStartY = 0;
let profileCropCallback = null;
let profileCropCancelCallback = null;
let profileCropPinchStartDist = 0;
let profileCropPinchStartZoom = 1.0;
let profileCropCurrentBlobUrl = null;

function cleanupProfileCropBlobUrl() {
    if (profileCropCurrentBlobUrl) {
        try {
            URL.revokeObjectURL(profileCropCurrentBlobUrl);
        } catch (_) {}
        profileCropCurrentBlobUrl = null;
    }
}

export function getProfileCropModalHTML() {
    return `
        <div id="modal-crop-profile-photo" class="hidden fixed inset-0 z-[110] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 fade-in overflow-y-auto" onclick="window.closeProfilePhotoEditor()">
            <div class="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md p-0 overflow-hidden transform scale-100 transition-all border border-slate-100 dark:border-slate-800 flex flex-col max-h-[90vh] my-auto" onclick="event.stopPropagation()">
                <div class="bg-slate-50 dark:bg-slate-900/90 p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
                    <h3 class="font-bold text-slate-800 dark:text-white flex items-center text-sm sm:text-base">
                        <i class="fa-solid fa-crop-simple mr-2.5 text-indigo-600 dark:text-indigo-400"></i>Sesuaikan Foto Profil
                    </h3>
                    <button type="button" onclick="window.closeProfilePhotoEditor()" class="w-8 h-8 rounded-full bg-slate-200/60 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors" title="Tutup">
                        <i class="fa-solid fa-times text-sm"></i>
                    </button>
                </div>
                <div class="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 custom-scrollbar flex flex-col items-center">
                    <p class="text-xs text-slate-500 dark:text-slate-400 text-center leading-relaxed">
                        Geser foto untuk menempatkan wajah di tengah lingkaran avatar, lalu gunakan tombol rotasi dan zoom agar pas.
                    </p>
                    <div id="profile-crop-canvas-container" class="relative w-[280px] h-[280px] sm:w-[320px] sm:h-[320px] rounded-2xl overflow-hidden shadow-inner border-2 border-indigo-200 dark:border-indigo-900/60 bg-slate-900 flex items-center justify-center select-none touch-none cursor-grab active:cursor-grabbing">
                        <canvas id="profile-crop-canvas" width="400" height="400" class="w-full h-full block"></canvas>
                        <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
                            <svg class="w-full h-full" viewBox="0 0 400 400">
                                <defs>
                                    <mask id="profile-crop-mask-fallback">
                                        <rect width="400" height="400" fill="white" />
                                        <circle cx="200" cy="200" r="175" fill="black" />
                                    </mask>
                                </defs>
                                <rect width="400" height="400" fill="rgba(15, 23, 42, 0.65)" mask="url(#profile-crop-mask-fallback)" />
                                <circle cx="200" cy="200" r="175" fill="none" stroke="rgba(255, 255, 255, 0.85)" stroke-width="2.5" />
                                <circle cx="200" cy="200" r="173" fill="none" stroke="rgba(99, 102, 241, 0.85)" stroke-width="1.5" stroke-dasharray="6 4" />
                            </svg>
                        </div>
                    </div>
                    <div class="w-full space-y-3 pt-1">
                        <div class="flex items-center gap-3 px-2">
                            <button type="button" onclick="window.adjustProfileCropZoom(-0.1)" title="Perkecil" class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center justify-center text-xs transition active:scale-95 shadow-sm">
                                <i class="fa-solid fa-magnifying-glass-minus"></i>
                            </button>
                            <input type="range" id="profile-crop-zoom-range" min="0.5" max="3" step="0.05" value="1" oninput="window.setProfileCropZoom(this.value)" class="flex-1 accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg">
                            <button type="button" onclick="window.adjustProfileCropZoom(0.1)" title="Perbesar" class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center justify-center text-xs transition active:scale-95 shadow-sm">
                                <i class="fa-solid fa-magnifying-glass-plus"></i>
                            </button>
                        </div>
                        <div class="flex items-center justify-between gap-2 px-1">
                            <div class="flex items-center gap-1.5">
                                <button type="button" onclick="window.rotateProfileCrop(-90)" class="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 shadow-sm" title="Putar 90° Berlawanan Arah Jarum Jam">
                                    <i class="fa-solid fa-rotate-left text-xs text-indigo-500"></i> Putar Kiri
                                </button>
                                <button type="button" onclick="window.rotateProfileCrop(90)" class="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 shadow-sm" title="Putar 90° Searah Jarum Jam">
                                    <i class="fa-solid fa-rotate-right text-xs text-indigo-500"></i> Putar Kanan
                                </button>
                            </div>
                            <button type="button" onclick="window.resetProfileCrop()" class="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 shadow-sm" title="Reset Posisi, Rotasi, dan Skala">
                                <i class="fa-solid fa-arrow-rotate-left text-xs"></i> Reset
                            </button>
                        </div>
                    </div>
                </div>
                <div class="p-4 sm:p-5 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2.5 shrink-0">
                    <button type="button" onclick="window.closeProfilePhotoEditor()" class="px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl font-bold text-slate-500 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition shadow-sm text-xs sm:text-sm">
                        Batal
                    </button>
                    <button type="button" id="btn-apply-profile-crop" onclick="window.applyProfileCrop()" class="px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-md hover:shadow-indigo-500/25 transition active:scale-95 flex items-center gap-2 text-xs sm:text-sm">
                        <i class="fa-solid fa-check"></i>Gunakan Foto
                    </button>
                </div>
            </div>
        </div>
    `;
}

export function ensureProfilePhotoEditorModal() {
    let modal = document.getElementById('modal-crop-profile-photo');
    if (!modal && typeof document !== 'undefined') {
        const div = document.createElement('div');
        div.innerHTML = getProfileCropModalHTML();
        modal = div.firstElementChild;
        if (modal && document.body) {
            document.body.appendChild(modal);
        }
    }
    return modal;
}

export function drawProfileCropCanvas() {
    if (typeof document === 'undefined') return;
    const canvas = document.getElementById('profile-crop-canvas');
    if (!canvas || !profileCropImage) return;

    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const isSideways = profileCropRotation === 90 || profileCropRotation === 270;
    const natW = profileCropImage.naturalWidth || profileCropImage.width || 400;
    const natH = profileCropImage.naturalHeight || profileCropImage.height || 400;
    const effectiveW = isSideways ? natH : natW;
    const effectiveH = isSideways ? natW : natH;

    const baseScale = Math.max(canvas.width / effectiveW, canvas.height / effectiveH);
    const totalScale = baseScale * profileCropZoom;

    const drawW = natW * totalScale;
    const drawH = natH * totalScale;

    // Titik pusat kanvas + translasi geser (pan)
    ctx.translate(canvas.width / 2 + profileCropOffsetX, canvas.height / 2 + profileCropOffsetY);
    ctx.rotate((profileCropRotation * Math.PI) / 180);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(profileCropImage, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
}

function initProfileCropListeners() {
    if (typeof document === 'undefined') return;
    const canvas = document.getElementById('profile-crop-canvas');
    if (!canvas || canvas.dataset.listenersBound === 'true') return;
    canvas.dataset.listenersBound = 'true';

    // Mouse drag
    canvas.addEventListener('mousedown', (e) => {
        isDraggingProfileCrop = true;
        profileDragStartX = e.clientX - profileCropOffsetX;
        profileDragStartY = e.clientY - profileCropOffsetY;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDraggingProfileCrop) return;
        profileCropOffsetX = e.clientX - profileDragStartX;
        profileCropOffsetY = e.clientY - profileDragStartY;
        drawProfileCropCanvas();
    });

    window.addEventListener('mouseup', () => {
        isDraggingProfileCrop = false;
    });

    // Touch Drag & Pinch Zoom
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            isDraggingProfileCrop = true;
            profileDragStartX = e.touches[0].clientX - profileCropOffsetX;
            profileDragStartY = e.touches[0].clientY - profileCropOffsetY;
        } else if (e.touches.length === 2) {
            isDraggingProfileCrop = false;
            profileCropPinchStartDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            profileCropPinchStartZoom = profileCropZoom;
        }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (isDraggingProfileCrop && e.touches.length === 1) {
            profileCropOffsetX = e.touches[0].clientX - profileDragStartX;
            profileCropOffsetY = e.touches[0].clientY - profileDragStartY;
            drawProfileCropCanvas();
        } else if (e.touches.length === 2 && profileCropPinchStartDist > 0) {
            const currentDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const ratio = currentDist / profileCropPinchStartDist;
            const newZoom = Math.max(0.5, Math.min(3.0, profileCropPinchStartZoom * ratio));
            window.setProfileCropZoom(newZoom);
        }
    }, { passive: true });

    window.addEventListener('touchend', () => {
        isDraggingProfileCrop = false;
        profileCropPinchStartDist = 0;
    });

    // Mouse Wheel Zoom
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.08 : -0.08;
        window.adjustProfileCropZoom(delta);
    }, { passive: false });
}

window.setProfileCropZoom = function (val) {
    profileCropZoom = Math.max(0.5, Math.min(3.0, parseFloat(val) || 1.0));
    const range = document.getElementById('profile-crop-zoom-range');
    if (range) range.value = String(profileCropZoom);
    drawProfileCropCanvas();
};

window.adjustProfileCropZoom = function (delta) {
    window.setProfileCropZoom(profileCropZoom + delta);
};

window.rotateProfileCrop = function (degreeDelta) {
    profileCropRotation = (profileCropRotation + degreeDelta + 360) % 360;
    drawProfileCropCanvas();
};

window.resetProfileCrop = function () {
    profileCropZoom = 1.0;
    profileCropRotation = 0;
    profileCropOffsetX = 0;
    profileCropOffsetY = 0;
    const range = document.getElementById('profile-crop-zoom-range');
    if (range) range.value = '1';
    drawProfileCropCanvas();
};

window.openProfilePhotoEditor = function (options = {}) {
    const { file, onApply, onCancel } = options;
    if (!file) return;

    ensureProfilePhotoEditorModal();
    initProfileCropListeners();

    profileCropCallback = typeof onApply === 'function' ? onApply : null;
    profileCropCancelCallback = typeof onCancel === 'function' ? onCancel : null;

    const modal = document.getElementById('modal-crop-profile-photo');
    if (modal) modal.classList.remove('hidden');

    const handleLoadedImage = (img) => {
        profileCropImage = img;
        window.resetProfileCrop();
    };

    const handleLoadFailure = (err, reason) => {
        console.error('[ProfilePhotoEditor] Gagal memuat file foto:', reason || '', err || '');
        cleanupProfileCropBlobUrl();

        const fileName = (file && typeof file === 'object' && file.name) ? String(file.name).toLowerCase() : '';
        const fileType = (file && typeof file === 'object' && file.type) ? String(file.type).toLowerCase() : '';
        const isHeic = fileName.endsWith('.heic') || fileName.endsWith('.heif') || fileType.includes('heic') || fileType.includes('heif');
        const isNotReadable = err && (err.name === 'NotReadableError' || err.name === 'AbortError');

        if (isHeic) {
            showToast("Format HEIC Terdeteksi", "Format foto HEIC/HEIF dari kamera belum didukung langsung oleh browser ini. Silakan simpan sebagai JPG/PNG atau gunakan tangkapan layar (screenshot).", "warning");
        } else if (isNotReadable) {
            showToast("Gagal Membaca File", "File foto di cloud belum terunduh penuh ke galeri HP atau izin terputus. Pastikan foto sudah tersimpan offline di galeri HP.", "error");
        } else {
            showToast("Gagal Memuat", "Tidak dapat membaca file foto. Pastikan format JPG, PNG, atau WebP valid.", "error");
        }
        window.closeProfilePhotoEditor();
    };

    if (typeof file === 'string') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => handleLoadedImage(img);
        img.onerror = (e) => handleLoadFailure(e, 'Image URL onerror');
        img.src = file;
    } else {
        // Coba via URL.createObjectURL terlebih dahulu (Zero-Copy, hemat RAM HP & Instan)
        cleanupProfileCropBlobUrl();
        let loadedViaObjectUrl = false;

        const tryFileReaderFallback = () => {
            cleanupProfileCropBlobUrl();
            if (typeof FileReader === 'undefined') {
                handleLoadFailure(new Error('FileReader tidak didukung di browser ini'), 'No FileReader');
                return;
            }
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => handleLoadedImage(img);
                img.onerror = (imgErr) => handleLoadFailure(imgErr, 'FileReader img.onerror');
                img.src = e.target.result;
            };
            reader.onerror = (readErr) => {
                handleLoadFailure(reader.error || readErr, 'FileReader.onerror');
            };
            try {
                reader.readAsDataURL(file);
            } catch (readSyncErr) {
                handleLoadFailure(readSyncErr, 'FileReader.readAsDataURL exception');
            }
        };

        if (typeof window !== 'undefined' && window.URL && typeof window.URL.createObjectURL === 'function') {
            try {
                const objectUrl = URL.createObjectURL(file);
                profileCropCurrentBlobUrl = objectUrl;

                const img = new Image();
                img.onload = () => {
                    loadedViaObjectUrl = true;
                    handleLoadedImage(img);
                };
                img.onerror = () => {
                    if (!loadedViaObjectUrl) {
                        console.warn('[ProfilePhotoEditor] createObjectURL gagal dirender img, mencoba fallback FileReader...');
                        tryFileReaderFallback();
                    }
                };
                img.src = objectUrl;
            } catch (objUrlErr) {
                console.warn('[ProfilePhotoEditor] createObjectURL gagal:', objUrlErr, 'Mencoba fallback FileReader...');
                tryFileReaderFallback();
            }
        } else {
            tryFileReaderFallback();
        }
    }
};

window.closeProfilePhotoEditor = function () {
    cleanupProfileCropBlobUrl();
    const modal = document.getElementById('modal-crop-profile-photo');
    if (modal) modal.classList.add('hidden');
    if (typeof profileCropCancelCallback === 'function') {
        try { profileCropCancelCallback(); } catch (_) {}
    }
    profileCropCallback = null;
    profileCropCancelCallback = null;
    profileCropImage = null;
};

window.applyProfileCrop = function () {
    const canvas = document.getElementById('profile-crop-canvas');
    if (!canvas || !profileCropImage) {
        window.closeProfilePhotoEditor();
        return;
    }

    let dataUrl = canvas.toDataURL('image/webp', 0.82);
    if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
        dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    }

    const cb = profileCropCallback;
    profileCropCancelCallback = null;
    window.closeProfilePhotoEditor();

    if (typeof cb === 'function') {
        cb(dataUrl);
    }
};

window.handleProfilePhotoSelected = async function (event) {
    const file = event.target?.files?.[0];
    if (!file) return;

    const isImage = (file.type && file.type.startsWith('image/')) ||
                    /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '');
    if (!isImage) {
        showToast("Format Salah", "Pilih file gambar (JPG, PNG, atau WebP).", "warning");
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        showToast("Ukuran Terlalu Besar", "Ukuran foto maksimal 10 MB.", "warning");
        return;
    }

    const statusText = document.getElementById('profile-photo-status-text');
    const photoPreviewImg = document.getElementById('profile-photo-preview-img');
    const photoPlaceholder = document.getElementById('profile-photo-preview-placeholder');
    const btnRemovePhoto = document.getElementById('btn-remove-profile-photo');

    if (statusText) {
        statusText.innerText = "Membuka editor penyesuaian foto...";
        statusText.className = "text-[10px] text-indigo-600 dark:text-indigo-400 mt-1 animate-pulse";
    }

    window.openProfilePhotoEditor({
        file: file,
        onApply: (compressedBase64) => {
            window._pendingProfilePhotoBase64 = compressedBase64;
            window._pendingProfilePhotoDelete = false;

            if (photoPreviewImg) {
                photoPreviewImg.src = compressedBase64;
                photoPreviewImg.classList.remove('hidden');
            }
            if (photoPlaceholder) photoPlaceholder.classList.add('hidden');

            const isSuperAdmin = (typeof window.hasRole === 'function' && window.hasRole('super_admin')) ||
                                 (localStorage.getItem('user_role') === 'super_admin');
            if (btnRemovePhoto) {
                if (isSuperAdmin) {
                    btnRemovePhoto.classList.remove('hidden');
                } else {
                    btnRemovePhoto.classList.add('hidden');
                }
            }

            const approxKb = Math.round((compressedBase64.length * 3 / 4) / 1024);
            if (statusText) {
                statusText.innerText = `Siap disimpan (~${approxKb} KB WebP). Klik Simpan untuk menerapkan.`;
                statusText.className = "text-[10px] text-emerald-600 dark:text-emerald-400 mt-1 font-semibold";
            }
            if (typeof window.updateProfileCompletenessUI === 'function') {
                window.updateProfileCompletenessUI();
            }
        },
        onCancel: () => {
            if (event.target) event.target.value = '';
            if (statusText && !window._pendingProfilePhotoBase64) {
                statusText.innerText = "";
            }
        }
    });
};

window.removeProfilePhotoPreview = async function () {
    const isSuperAdmin = (typeof window.hasRole === 'function' && window.hasRole('super_admin')) ||
                         (localStorage.getItem('user_role') === 'super_admin');
    if (!isSuperAdmin) {
        showToast('Akses Ditolak', 'Hanya Super Admin yang berhak menghapus foto profil GTK.', 'warning');
        return;
    }

    let confirmed = false;
    if (typeof Swal !== 'undefined') {
        const { value: confirmText, isConfirmed } = await Swal.fire({
            title: 'Hapus Foto Profil GTK?',
            html: `Tindakan ini akan menghapus foto profil Anda dari penyimpanan Cloudflare R2.<br><br><span class="text-xs text-rose-600 dark:text-rose-400 font-bold">Ketik kata <b>HAPUS</b> di bawah untuk mengonfirmasi:</span>`,
            input: 'text',
            inputPlaceholder: 'Ketik HAPUS',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#e11d48',
            cancelButtonColor: '#64748b',
            confirmButtonText: '<i class="fa-solid fa-trash-can mr-1"></i> Ya, Hapus Foto',
            cancelButtonText: 'Batal',
            inputValidator: (val) => {
                if (!val || String(val).trim().toUpperCase() !== 'HAPUS') {
                    return 'Ketik kata "HAPUS" secara persis untuk mengonfirmasi!';
                }
            }
        });
        confirmed = isConfirmed && String(confirmText || '').trim().toUpperCase() === 'HAPUS';
    } else {
        const inputPrompt = prompt('HAPUS FOTO PROFIL GTK?\n\nKetik "HAPUS" untuk mengonfirmasi:');
        confirmed = String(inputPrompt || '').trim().toUpperCase() === 'HAPUS';
    }

    if (!confirmed) return;

    window._pendingProfilePhotoBase64 = null;
    window._pendingProfilePhotoDelete = true;

    const photoPreviewImg = document.getElementById('profile-photo-preview-img');
    const photoPlaceholder = document.getElementById('profile-photo-preview-placeholder');
    const btnRemovePhoto = document.getElementById('btn-remove-profile-photo');
    const statusText = document.getElementById('profile-photo-status-text');
    const fileInput = document.getElementById('input-profile-photo');

    if (fileInput) fileInput.value = '';
    if (photoPreviewImg) {
        photoPreviewImg.src = '';
        photoPreviewImg.classList.add('hidden');
    }
    if (photoPlaceholder) {
        const nameVal = document.getElementById('edit-profile-name')?.value || 'U';
        photoPlaceholder.innerText = nameVal.charAt(0).toUpperCase();
        photoPlaceholder.classList.remove('hidden');
    }
    if (btnRemovePhoto) btnRemovePhoto.classList.add('hidden');
    if (statusText) {
        statusText.innerText = "Foto akan dihapus saat Anda menekan tombol Simpan.";
        statusText.className = "text-[10px] text-amber-600 dark:text-amber-400 mt-1 font-semibold";
    }
    if (typeof window.updateProfileCompletenessUI === 'function') {
        window.updateProfileCompletenessUI();
    }
};

window.checkBiometricStatusUI = async function () {
    const statusText = document.getElementById('biometric-status-text');
    const actionContainer = document.getElementById('biometric-action-container');
    if (!statusText || !actionContainer) return;

    let isSupported = false;
    try {
        if (typeof window.isBiometricSupported === 'function') {
            isSupported = await window.isBiometricSupported();
        }
    } catch (_) {}

    if (!isSupported) {
        statusText.innerText = "Tidak didukung di browser/koneksi ini (Perlu HTTPS).";
        statusText.className = "text-[10px] text-rose-500 dark:text-rose-400 mt-0.5";
        actionContainer.innerHTML = `<span class="text-xs text-slate-400 font-semibold px-2.5 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg">Nonaktif</span>`;
        return;
    }

    const boundEmail = localStorage.getItem('simas_passkey_bound_email');
    const boundCredId = localStorage.getItem('simas_passkey_cred_id');
    const user = auth.currentUser;
    const currentEmail = user ? (user.email || '').toLowerCase().trim() : '';

    if (boundCredId && boundEmail && currentEmail && boundEmail.toLowerCase() === currentEmail) {
        statusText.innerText = `Terdaftar untuk akun ${boundEmail}`;
        statusText.className = "text-[10px] text-emerald-600 dark:text-emerald-400 font-bold mt-0.5 truncate";
        actionContainer.innerHTML = `
            <button type="button" onclick="window.removeBiometricPasskeyUI()" class="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 border border-rose-200 dark:border-rose-800 active:scale-95">
                <i class="fa-solid fa-trash-can text-xs"></i> Hapus Sidik Jari
            </button>
        `;
    } else if (boundCredId && boundEmail && currentEmail && boundEmail.toLowerCase() !== currentEmail) {
        statusText.innerText = `Perangkat terhubung ke akun lain (${boundEmail}).`;
        statusText.className = "text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-0.5 truncate";
        actionContainer.innerHTML = `
            <button type="button" onclick="window.registerBiometricPasskeyUI()" class="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-all shadow-sm hover:shadow flex items-center gap-1.5 active:scale-95">
                <i class="fa-solid fa-fingerprint text-sm"></i> Daftarkan untuk Akun Ini
            </button>
        `;
    } else {
        statusText.innerText = "Belum terdaftar di perangkat ini.";
        statusText.className = "text-[10px] text-slate-400 dark:text-slate-500 mt-0.5";
        actionContainer.innerHTML = `
            <button type="button" onclick="window.registerBiometricPasskeyUI()" class="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-all shadow-sm hover:shadow flex items-center gap-1.5 active:scale-95">
                <i class="fa-solid fa-fingerprint text-sm"></i> Aktifkan Sidik Jari
            </button>
        `;
    }
};

window.registerBiometricPasskeyUI = async function () {
    const user = auth.currentUser;
    if (!user) {
        showToast("Peringatan", "Sesi login tidak terdeteksi. Silakan login kembali.", "warning");
        return;
    }

    const currentRole = localStorage.getItem('user_role') || '';
    if (['siswa', 'admin_pks', 'admin_kelas'].includes(currentRole)) {
        showToast("Akses Ditolak", "Pendaftaran login biometrik khusus untuk Guru & Staf Sekolah.", "error");
        return;
    }

    const userEmail = (user.email || document.getElementById('edit-profile-email')?.value || '').trim();
    const userName = document.getElementById('edit-profile-name')?.value?.trim() || user.displayName || userEmail;

    if (!userEmail) {
        showToast("Gagal", "Email akun tidak valid.", "error");
        return;
    }

    try {
        if (typeof window.registerBiometricPasskey !== 'function') {
            throw new Error("Modul biometrik belum termuat sempurna. Silakan muat ulang halaman.");
        }
        showToast("Sensor Aktif 👆", "Silakan tempelkan sidik jari atau gunakan Face ID / Windows Hello pada perangkat Anda...", "info", 4000);
        await window.registerBiometricPasskey(userEmail, userName);
        showToast("Berhasil 🔒", "Sidik jari (Passkey) berhasil terdaftar! Anda dapat login 1-touch via Sidik Jari di perangkat ini.", "success", 5000);
        await window.checkBiometricStatusUI();
    } catch (err) {
        console.error("[Biometric UI] Gagal daftar:", err);
        let errorMsg = err.message || "Gagal mendaftarkan biometrik.";
        if (err.name === 'NotAllowedError' || errorMsg.includes('dibatalkan')) {
            errorMsg = "Pendaftaran biometrik dibatalkan oleh pengguna.";
        }
        showToast("Gagal Biometrik", errorMsg, "error", 6000);
    }
};

window.removeBiometricPasskeyUI = async function () {
    const user = auth.currentUser;
    const userEmail = user ? user.email : localStorage.getItem('simas_passkey_bound_email');

    const confirmed = await window.showConfirmModal(
        "Apakah Anda yakin ingin menghapus data login sidik jari (Passkey) dari perangkat ini?",
        "Hapus Sidik Jari",
        "danger"
    );
    if (!confirmed) return;

    try {
        if (typeof window.removeBiometricPasskey === 'function') {
            await window.removeBiometricPasskey(userEmail);
        } else {
            localStorage.removeItem('simas_passkey_bound_email');
            localStorage.removeItem('simas_passkey_cred_id');
            localStorage.removeItem('simas_passkey_user_name');
            localStorage.removeItem('simas_passkey_profile');
            localStorage.removeItem('simas_passkey_vault');
        }
        showToast("Terhapus", "Data biometrik di perangkat ini telah dihapus.", "info");
        await window.checkBiometricStatusUI();
    } catch (e) {
        console.error("Gagal hapus biometrik:", e);
        showToast("Error", "Gagal menghapus biometrik.", "error");
    }
};

// --- MANAJEMEN GOOGLE GEMINI API KEY DI EDIT PROFIL (SSOT & MULTI-KEY) ---
window.profileUserApiKeys = [];

window.loadProfileApiKeys = async function (uid) {
    if (!uid) return;
    try {
        // 1. Baca dari user_secrets SSOT
        const secretSnap = await getDoc(doc(db, PATHS.userSecrets, uid));
        let keys = [];
        if (secretSnap.exists()) {
            const data = secretSnap.data()?.geminiApiKey;
            if (Array.isArray(data)) {
                keys = data.filter(k => typeof k === 'string' && k.trim());
            } else if (typeof data === 'string' && data.trim().length > 5) {
                keys = [data.trim()];
            }
        }

        // Fallback legacy jika di secrets masih kosong
        if (keys.length === 0) {
            const userSnap = await getDoc(doc(db, PATHS.users, uid));
            if (userSnap.exists()) {
                const legacyKey = userSnap.data()?.geminiApiKey;
                if (Array.isArray(legacyKey)) {
                    keys = legacyKey.filter(k => typeof k === 'string' && k.trim());
                } else if (typeof legacyKey === 'string' && legacyKey.trim().length > 5) {
                    keys = [legacyKey.trim()];
                }
            }
        }
        if (keys.length === 0) {
            const localKey = localStorage.getItem('user_gemini_key_uid') === uid
                ? (localStorage.getItem('user_gemini_key') || localStorage.getItem('user_gemini_api_key')) : '';
            if (localKey && localKey.trim()) {
                keys = [localKey.trim()];
            }
        }

        window.profileUserApiKeys = keys;
        window.profileUserApiKeysOwner = uid;
        window.renderProfileApiKeyList();

        // Update badge model AI secara dinamis
        let activeAiConfig = null;
        try {
            activeAiConfig = (typeof getAiConfigAsync === 'function' ? await getAiConfigAsync() : null) ||
                             (typeof getAiConfig === 'function' ? getAiConfig() : null);
        } catch (_) {}
        if (!activeAiConfig && typeof AI_CONFIG !== 'undefined') activeAiConfig = AI_CONFIG;

        const badgeEl = document.getElementById('profile-ai-model-badge');
        if (badgeEl && activeAiConfig) {
            badgeEl.textContent = activeAiConfig.displayName || activeAiConfig.model || 'Gemini AI';
        }

    } catch (err) {
        console.warn("[Profile API Key] Gagal memuat key:", err);
        window.profileUserApiKeys = [];
        window.renderProfileApiKeyList();
    }
};

window.renderProfileApiKeyList = function () {
    const list = document.getElementById('profile-api-key-list');
    const emptyEl = document.getElementById('profile-api-key-empty');
    const addBtnContainer = document.getElementById('profile-add-key-btn-container');
    if (!list) return;

    list.innerHTML = '';
    const keys = window.profileUserApiKeys || [];

    if (keys.length === 0) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (addBtnContainer) addBtnContainer.classList.remove('hidden');
    } else {
        if (emptyEl) emptyEl.classList.add('hidden');
        keys.forEach((key, index) => {
            const li = document.createElement('li');
            li.className = "flex justify-between items-center bg-white dark:bg-slate-800/90 px-3 py-2 border border-purple-100 dark:border-slate-700 rounded-xl text-xs shadow-sm";
            const masked = key.length > 8 ? (key.substring(0, 4) + '...' + key.substring(key.length - 4)) : '••••••••';
            const safeMasked = window.escapeHTML ? window.escapeHTML(masked) : masked;
            li.innerHTML = `
                <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
                    <div class="w-6 h-6 rounded-lg bg-purple-50 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 flex items-center justify-center text-xs shrink-0">
                        <i class="fa-solid fa-key"></i>
                    </div>
                    <div class="truncate">
                        <span class="font-mono font-bold text-slate-700 dark:text-slate-200">Key ${index + 1}: ${safeMasked}</span>
                    </div>
                    <span id="profile-key-badge-${index}" class="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded shrink-0">
                        <i class="fa-solid fa-circle-check text-[9px]"></i> Aktif
                    </span>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    <button type="button" onclick="window.testSingleProfileApiKey(${index})" class="w-7 h-7 rounded-lg text-slate-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/30 flex items-center justify-center transition active:scale-95" title="Uji ulang koneksi ke Google Gemini">
                        <i class="fa-solid fa-rotate text-xs" id="icon-test-key-${index}"></i>
                    </button>
                    <button type="button" onclick="window.deleteProfileApiKey(${index})" class="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 flex items-center justify-center transition active:scale-95" title="Hapus API Key ini">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </div>
            `;
            list.appendChild(li);
        });
    }
};

window.testSingleProfileApiKey = async function (index) {
    const keys = window.profileUserApiKeys || [];
    if (index < 0 || index >= keys.length) return;
    const apiKey = keys[index];

    const icon = document.getElementById(`icon-test-key-${index}`);
    const badge = document.getElementById(`profile-key-badge-${index}`);

    if (icon) icon.className = 'fa-solid fa-circle-notch fa-spin text-xs text-purple-600';
    if (badge) {
        badge.className = 'text-[10px] text-purple-600 dark:text-purple-400 font-semibold flex items-center gap-1 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded shrink-0';
        badge.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-[9px]"></i> Menguji...';
    }

    try {
        await window.validateGeminiApiKeyDirect(apiKey);
        if (badge) {
            badge.className = 'text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded shrink-0';
            badge.innerHTML = '<i class="fa-solid fa-circle-check text-[9px]"></i> Aktif';
        }
        showToast("Key Terhubung ✅", `Key ${index + 1} aktif dan siap digunakan untuk fitur AI.`, "success", 4000);
    } catch (err) {
        console.warn(`[Profile API Key] Key ${index + 1} tidak valid:`, err);
        let msg = err.message || "Kunci tidak dapat terhubung.";
        if (msg.includes('API key not valid')) msg = "Kunci telah dihapus/tidak ditemukan di Google AI Studio.";
        if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) msg = "Kuota API Key telah habis.";

        if (badge) {
            badge.className = 'text-[10px] text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1 bg-rose-50 dark:bg-rose-900/30 px-1.5 py-0.5 rounded shrink-0';
            badge.innerHTML = '<i class="fa-solid fa-circle-xmark text-[9px]"></i> Tidak Aktif';
        }
        showToast(`Key ${index + 1} Bermasalah ❌`, msg, "error", 6000);
    } finally {
        if (icon) icon.className = 'fa-solid fa-rotate text-xs';
    }
};

window.testAllProfileApiKeys = async function () {
    const keys = window.profileUserApiKeys || [];
    if (keys.length === 0) {
        showToast("Info", "Belum ada API Key tersimpan untuk diuji.", "info");
        return;
    }

    showToast("Menguji Kunci ⏳", `Sedang menguji ${keys.length} API Key ke Google AI...`, "info", 3000);
    for (let i = 0; i < keys.length; i++) {
        await window.testSingleProfileApiKey(i);
    }
};

window.showProfileAddKeyForm = function () {
    const form = document.getElementById('profile-add-key-form');
    const btnContainer = document.getElementById('profile-add-key-btn-container');
    const input = document.getElementById('input-profile-gemini-key');
    if (form) form.classList.remove('hidden');
    if (btnContainer) btnContainer.classList.add('hidden');
    if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 100);
    }
};

window.hideProfileAddKeyForm = function () {
    const form = document.getElementById('profile-add-key-form');
    const btnContainer = document.getElementById('profile-add-key-btn-container');
    if (form) form.classList.add('hidden');
    if (btnContainer) btnContainer.classList.remove('hidden');
};

window.toggleProfileApiKeyVisibility = function () {
    const input = document.getElementById('input-profile-gemini-key');
    const icon = document.getElementById('icon-profile-api-key-eye');
    if (!input || !icon) return;
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fa-solid fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fa-solid fa-eye';
    }
};

window.validateGeminiApiKeyDirect = async function (apiKey) {
    let activeAiConfig = null;
    try {
        activeAiConfig = (typeof getAiConfigAsync === 'function' ? await getAiConfigAsync() : null) ||
                         (typeof getAiConfig === 'function' ? getAiConfig() : null);
    } catch (_) {}
    const model = activeAiConfig?.model || (typeof AI_CONFIG !== 'undefined' ? AI_CONFIG.model : '');
    if (!model) {
        throw new Error("Model AI Gemini belum dikonfigurasi di menu Pengaturan. Harap Super Admin mengisi Model ID di Pengaturan Aplikasi.");
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: "Tes." }] }],
            generationConfig: { maxOutputTokens: 1 }
        })
    });

    const data = await response.json();
    if (!response.ok) {
        const errorMsg = data.error?.message || response.statusText || "Kunci API tidak valid.";
        throw new Error(errorMsg);
    }
    return true;
};

window.saveProfileApiKey = async function () {
    const input = document.getElementById('input-profile-gemini-key');
    const btn = document.getElementById('btn-save-profile-api-key');
    const user = auth.currentUser;
    if (!input || !user) return;

    const apiKey = input.value.trim();
    if (!apiKey) {
        showToast("Peringatan", "API Key tidak boleh kosong!", "warning");
        return;
    }

    if (window.profileUserApiKeys.includes(apiKey)) {
        showToast("Info", "API Key ini sudah ada dalam daftar tersimpan.", "info");
        return;
    }

    const originalBtnHtml = btn.innerHTML;
    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-xs"></i> Cek...';

        // Validasi ke Google Generative Language API
        await window.validateGeminiApiKeyDirect(apiKey);

        window.profileUserApiKeys.push(apiKey);

        // Simpan ke Firestore user_secrets SSOT
        await setDoc(doc(db, PATHS.userSecrets, user.uid), {
            geminiApiKey: window.profileUserApiKeys,
            updatedAt: serverTimestamp()
        }, { merge: true });

        // Sinkronkan ke modul halaman yang sedang terbuka jika ada
        if (typeof window.userApiKeys !== 'undefined') {
            window.userApiKeys = [...window.profileUserApiKeys];
            if (typeof window.renderApiKeyList === 'function') window.renderApiKeyList();
        }
        if (typeof window.userApiKeysRapor !== 'undefined') {
            window.userApiKeysRapor = [...window.profileUserApiKeys];
            if (typeof window.renderApiKeyListRapor === 'function') window.renderApiKeyListRapor();
        }

        showToast("Berhasil 🔑", "Google Gemini API Key berhasil divalidasi dan disimpan!", "success", 4000);
        window.hideProfileAddKeyForm();
        window.renderProfileApiKeyList();

    } catch (err) {
        console.error("[Profile API Key] Gagal simpan:", err);
        let msg = err.message || "Gagal memverifikasi API Key.";
        if (msg.includes('API key not valid')) msg = "API Key tidak valid (Periksa kembali salinan key Anda).";
        if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) msg = "Kuota API Key telah habis.";
        showToast("Validasi Gagal ❌", msg, "error", 6000);
    } finally {
        btn.innerHTML = originalBtnHtml;
        btn.disabled = false;
    }
};

window.deleteProfileApiKey = async function (index) {
    const user = auth.currentUser;
    if (!user) return;

    const keys = window.profileUserApiKeys || [];
    if (index < 0 || index >= keys.length) return;

    const confirmed = typeof window.showConfirmModal === 'function'
        ? await window.showConfirmModal("Apakah Anda yakin ingin menghapus API Key ini dari akun Anda?", "Hapus API Key", "danger")
        : confirm("Apakah Anda yakin ingin menghapus API Key ini?");

    if (!confirmed) return;

    try {
        window.profileUserApiKeys.splice(index, 1);

        await setDoc(doc(db, PATHS.userSecrets, user.uid), {
            geminiApiKey: window.profileUserApiKeys,
            updatedAt: serverTimestamp()
        }, { merge: true });

        // Sinkronkan ke modul halaman terbuka jika ada
        if (typeof window.userApiKeys !== 'undefined') {
            window.userApiKeys = [...window.profileUserApiKeys];
            if (typeof window.renderApiKeyList === 'function') window.renderApiKeyList();
        }
        if (typeof window.userApiKeysRapor !== 'undefined') {
            window.userApiKeysRapor = [...window.profileUserApiKeys];
            if (typeof window.renderApiKeyListRapor === 'function') window.renderApiKeyListRapor();
        }

        showToast("Terhapus 🗑️", "API Key berhasil dihapus dari akun Anda.", "info");
        window.renderProfileApiKeyList();

    } catch (err) {
        console.error("[Profile API Key] Gagal hapus:", err);
        showToast("Error", "Gagal menghapus API Key. Cek koneksi.", "error");
    }
};

const validateProfilePassword = (password) => {
    if (!password) return null;
    if (password.length < 8) {
        return "Password baru minimal 8 karakter.";
    }
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        return "Password baru harus mengandung kombinasi huruf dan angka.";
    }
    return null;
};

window.handleProfileAuthChangeVisibility = function () {
    const emailEl = document.getElementById('edit-profile-email');
    const passEl = document.getElementById('edit-profile-password');
    const oldPassSec = document.getElementById('old-password-section');
    const oldPassLabel = document.getElementById('old-password-label');
    if (!oldPassSec) return;

    const initialEmail = (emailEl?.dataset?.initialEmail || '').toLowerCase().trim();
    const currentEmail = (emailEl?.value || '').toLowerCase().trim();
    const isEmailChanged = Boolean(initialEmail && currentEmail && initialEmail !== currentEmail);
    const isPasswordFilled = Boolean(passEl?.value?.trim());

    if (isEmailChanged || isPasswordFilled) {
        oldPassSec.classList.remove('hidden');
        if (oldPassLabel) {
            if (isEmailChanged && isPasswordFilled) {
                oldPassLabel.innerHTML = '<i class="fa-solid fa-shield-halved mr-1"></i>Password Saat Ini (Wajib untuk ganti email & password)';
            } else if (isEmailChanged) {
                oldPassLabel.innerHTML = '<i class="fa-solid fa-shield-halved mr-1"></i>Password Saat Ini (Wajib untuk konfirmasi ganti email)';
            } else {
                oldPassLabel.innerHTML = '<i class="fa-solid fa-shield-halved mr-1"></i>Password Lama (Wajib untuk ganti password)';
            }
        }
    } else {
        oldPassSec.classList.add('hidden');
    }
};

window.saveEditProfile = async function () {
    const nameInput = document.getElementById('edit-profile-name');
    const emailInput = document.getElementById('edit-profile-email');
    const phoneInput = document.getElementById('edit-profile-phone');
    const telegramChatIdInput = document.getElementById('edit-profile-telegram-chat-id');
    const passInput = document.getElementById('edit-profile-password');
    const btn = document.getElementById('btn-save-profile') || document.querySelector('#modal-edit-profile button.bg-blue-600');

    const newName = nameInput ? nameInput.value.trim() : "";
    const newEmail = emailInput ? emailInput.value.trim().toLowerCase() : "";
    const newPhone = phoneInput ? phoneInput.value.trim() : "";
    const newTelegramChatId = telegramChatIdInput ? telegramChatIdInput.value.trim() : "";
    const newPass = passInput ? passInput.value.trim() : "";

    if (!newName) {
        showToast("Peringatan", "Nama lengkap tidak boleh kosong!", "warning");
        return;
    }
    if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        showToast("Peringatan", "Format email tidak valid!", "warning");
        return;
    }

    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...';
    btn.disabled = true;

    try {
        const user = auth.currentUser;
        if (!user) throw new Error("Sesi login tidak ditemukan. Silakan refresh dan login ulang.");
        const userDocRef = doc(db, PATHS.users, user.uid);

        // Cek Linked Teacher ID & existing Telegram Chat ID
        const userSnap = await getDoc(userDocRef);
        const userData = userSnap.exists() ? userSnap.data() : {};
        const linkedTeacherId = userData.linkedTeacherId || null;
        let existingTelegramId = (userData.telegramChatId || "").trim();
        const initialAuthEmail = (user.email || "").toLowerCase().trim();

        // Cek apakah user terhubung ke data Guru (teachers / GTK) SSOT
        let targetTeacherId = userData.nik || linkedTeacherId;
        let tObj = null;
        if (!targetTeacherId && (user.email || userData.name || user.displayName)) {
            tObj = await window.getLinkedTeacherForUser(user, userData);
            if (tObj?.id) targetTeacherId = tObj.id;
        } else if (targetTeacherId) {
            tObj = await window.getLinkedTeacherForUser(user, userData);
        }
        if (!existingTelegramId && tObj?.data) {
            existingTelegramId = String(tObj.data.telegram_chat_id || tObj.data.telegramChatId || "").trim();
        }

        // VERIFIKASI CHAT ID TELEGRAM VIA BOT API SEBELUM DISIMPAN (hanya jika baru/berubah)
        let telegramCheckWarning = false;
        let telegramCheckMsg = "";
        if (newTelegramChatId && newTelegramChatId !== existingTelegramId) {
            if (!/^-?\d{5,19}$/.test(newTelegramChatId)) {
                showToast("Format Telegram Tidak Sesuai", "Format Chat ID harus berupa 5-19 digit angka (contoh: 198160734). Buka bot @simas_demo_bot untuk melihat Chat ID Anda.", "warning", 6000);
            } else {
                const checkResult = await verifyTelegramChatId(newTelegramChatId, newName);
                if (!checkResult.valid) {
                    telegramCheckWarning = true;
                    telegramCheckMsg = checkResult.message || "Pesan verifikasi bot belum terkirim. Pastikan Anda sudah membuka bot Telegram sekolah (@simas_demo_bot) dan mengklik START.";
                } else if (checkResult.warning) {
                    telegramCheckWarning = true;
                    telegramCheckMsg = checkResult.message;
                }
            }
        }

        const emailEl = document.getElementById('edit-profile-email');
        const formInitialEmail = (emailEl?.dataset?.initialEmail || initialAuthEmail || "").toLowerCase().trim();
        const isFormEmailChanged = Boolean(newEmail && formInitialEmail && newEmail !== formInitialEmail);
        const isAuthEmailDifferent = Boolean(newEmail && initialAuthEmail && newEmail !== initialAuthEmail);
        const isEmailChanged = isFormEmailChanged && isAuthEmailDifferent;
        const isPasswordChanged = Boolean(newPass);
        const oldPass = document.getElementById('edit-profile-old-password')?.value?.trim();

        // 1. RE-AUTENTIKASI & UPDATE AUTH (Hanya jika pengguna secara aktif mengubah email atau password baru diisi)
        if (isEmailChanged || isPasswordChanged) {
            const isPasswordProvider = user.providerData && user.providerData.some(p => p.providerId === 'password');
            const isGoogleProvider = user.providerData && user.providerData.some(p => p.providerId === 'google.com');

            if (isGoogleProvider && !isPasswordProvider) {
                console.info('[saveEditProfile] Akun login Google OAuth, update kredensial auth dilewati. Email baru disimpan sebagai kontak profil.');
            } else if (isPasswordProvider) {
                if (!oldPass) {
                    throw new Error(isEmailChanged && isPasswordChanged
                        ? "Masukkan password saat ini untuk mengonfirmasi perubahan email dan password."
                        : (isEmailChanged ? "Masukkan password saat ini untuk mengonfirmasi perubahan email akun." : "Masukkan password lama untuk mengganti password."));
                }

                if (isPasswordChanged) {
                    const passwordError = validateProfilePassword(newPass);
                    if (passwordError) throw new Error(passwordError);
                    if (oldPass === newPass) throw new Error("Password baru harus berbeda dari password lama.");
                }

                // Re-authenticate user sebelum update email dan/atau password
                const credential = EmailAuthProvider.credential(user.email, oldPass);
                await reauthenticateWithCredential(user, credential);

                if (isEmailChanged && typeof updateEmail === 'function') {
                    await updateEmail(user, newEmail);
                }

                if (isPasswordChanged && typeof updatePassword === 'function') {
                    await updatePassword(user, newPass);
                }
            }
        }

        // 2. Update Display Name (Auth)
        if (newName !== user.displayName) {
            if (typeof updateProfile === 'function') {
                await updateProfile(user, { displayName: newName }).catch(e => console.warn('[saveEditProfile] Auth updateProfile warning:', e));
            }
        }

        // 3. Cek apakah user terhubung ke data Guru (teachers / GTK) SSOT
        if (!targetTeacherId && tObj?.id) targetTeacherId = tObj.id;

        const userUpdates = {
            name: newName,
            telegramChatId: newTelegramChatId
        };
        if (newEmail) {
            userUpdates.email = newEmail;
        }
        if (newPhone) {
            userUpdates.phone = newPhone;
        }

        if (targetTeacherId) {
            // Kumpulkan 21 atribut GTK dari form
            const genderVal = document.getElementById('edit-profile-gender')?.value || '';
            const birthPlaceVal = document.getElementById('edit-profile-birth-place')?.value?.trim() || '';
            const birthDateVal = document.getElementById('edit-profile-birth-date')?.value?.trim() || '';
            const agamaVal = document.getElementById('edit-profile-agama')?.value?.trim() || '';
            const pendidikanVal = document.getElementById('edit-profile-pendidikan')?.value?.trim() || '';
            const nikVal = document.getElementById('edit-profile-nik')?.value?.trim() || '';
            const nipVal = document.getElementById('edit-profile-nip')?.value?.trim() || '';
            const nuptkVal = document.getElementById('edit-profile-nuptk')?.value?.trim() || '';
            const statusVal = document.getElementById('edit-profile-status-kepegawaian')?.value?.trim() || '';
            const jenisPtkVal = document.getElementById('edit-profile-jenis-ptk')?.value?.trim() || '';
            const tugasVal = document.getElementById('edit-profile-tugas-tambahan')?.value?.trim() || '';
            const alamatVal = document.getElementById('edit-profile-alamat')?.value?.trim() || '';
            const rtVal = document.getElementById('edit-profile-rt')?.value?.trim() || '';
            const rwVal = document.getElementById('edit-profile-rw')?.value?.trim() || '';
            const dusunVal = document.getElementById('edit-profile-dusun')?.value?.trim() || '';
            const kelurahanVal = document.getElementById('edit-profile-kelurahan')?.value?.trim() || '';
            const kecamatanVal = document.getElementById('edit-profile-kecamatan')?.value?.trim() || '';
            const kodePosVal = document.getElementById('edit-profile-kode-pos')?.value?.trim() || '';

            // Validasi format NIK jika diisi
            if (nikVal && nikVal !== '-' && !/^\d{16}$/.test(nikVal)) {
                throw new Error("NIK harus terdiri dari tepat 16 digit angka.");
            }

            const teacherUpdates = {
                name: newName,
                phone: newPhone,
                email: newEmail,
                gender: genderVal,
                birth_place: birthPlaceVal,
                birth_date: birthDateVal,
                agama: agamaVal,
                pendidikan_terakhir: pendidikanVal,
                nik: nikVal,
                nip: nipVal,
                nuptk: nuptkVal,
                status_kepegawaian: statusVal,
                jenis_ptk: jenisPtkVal,
                tugas_tambahan: tugasVal,
                alamat: alamatVal,
                rt: rtVal,
                rw: rwVal,
                dusun: dusunVal,
                kelurahan: kelurahanVal,
                kecamatan: kecamatanVal,
                kode_pos: kodePosVal,
                telegram_chat_id: newTelegramChatId,
                telegramChatId: newTelegramChatId
            };

            // Simpan ke Cloudflare D1
            if (typeof cfClient !== 'undefined' && cfClient.updateTeacher) {
                const res = await cfClient.updateTeacher(targetTeacherId, teacherUpdates);
                // Tangani Safe Key Migration (Jika ID bermigrasi ke NIK 16 digit baru)
                if (res && res.id && res.id !== targetTeacherId) {
                    console.info(`[saveEditProfile] GTK ID bermigrasi dari ${targetTeacherId} ke ${res.id}`);
                    targetTeacherId = res.id;
                    userUpdates.linkedTeacherId = res.id;
                    userUpdates.nik = res.id;
                } else if (targetTeacherId) {
                    userUpdates.linkedTeacherId = targetTeacherId;
                    if (/^\d{16}$/.test(targetTeacherId)) {
                        userUpdates.nik = targetTeacherId;
                    }
                }
            }

            // UPLOAD / HAPUS FOTO PROFIL GTK (R2 & D1 GTK TABLE)
            if (typeof cfClient !== 'undefined') {
                if (window._pendingProfilePhotoBase64 && cfClient.uploadGtkPhoto) {
                    try {
                        const photoRes = await cfClient.uploadGtkPhoto({
                            gtkId: targetTeacherId,
                            photoBase64: window._pendingProfilePhotoBase64
                        });
                        if (photoRes && photoRes.foto_url) {
                            const resolvedUrl = resolvePhotoUrl(photoRes.foto_url);
                            localStorage.setItem(`cached_user_photo_${user.uid}`, resolvedUrl);
                            if (typeof window.updateUIAvatars === 'function') {
                                window.updateUIAvatars(resolvedUrl);
                            }
                        }
                    } catch (ePhoto) {
                        console.error('[saveEditProfile] Error upload foto GTK:', ePhoto);
                        showToast("Peringatan Foto", "Profil disimpan, namun gagal mengunggah foto: " + (ePhoto.message || ''), "warning", 5000);
                    }
                } else if (window._pendingProfilePhotoDelete && cfClient.deleteGtkPhoto) {
                    const isSuperAdmin = (typeof window.hasRole === 'function' && window.hasRole('super_admin')) ||
                                         (localStorage.getItem('user_role') === 'super_admin');
                    if (!isSuperAdmin) {
                        showToast("Akses Ditolak", "Hanya Super Admin yang berhak menghapus foto profil GTK.", "error");
                        window._pendingProfilePhotoDelete = false;
                    } else {
                        try {
                            await cfClient.deleteGtkPhoto(targetTeacherId);
                            localStorage.removeItem(`cached_user_photo_${user.uid}`);
                            if (typeof window.updateUIAvatars === 'function') {
                                window.updateUIAvatars(null);
                            }
                        } catch (eDelPhoto) {
                            console.error('[saveEditProfile] Error hapus foto GTK:', eDelPhoto);
                        }
                    }
                }
            }

            // Invalidate cache GTK
            if (typeof window.invalidateTeachersCache === 'function') {
                window.invalidateTeachersCache();
            }
            if (typeof window.invalidateGtkCache === 'function') {
                window.invalidateGtkCache();
            }
            if (typeof CURRENT_USER_TEACHER_CACHE !== 'undefined' && CURRENT_USER_TEACHER_CACHE.clear) {
                CURRENT_USER_TEACHER_CACHE.clear();
            }
            try {
                sessionStorage.removeItem('simas_teachers_map');
                if (user.email) sessionStorage.removeItem('simas_teacher_' + user.email.toLowerCase());
            } catch (eSess) {}
        }

        // Sinkronisasi data ke Firestore users/{uid} (dengan penanganan toleran kesalahan)
        try {
            await setDoc(userDocRef, userUpdates, { merge: true });
        } catch (eUserSync) {
            console.warn('[saveEditProfile] Warning: gagal sinkronisasi ke user doc:', eUserSync);
            if (eUserSync?.code === 'permission-denied') {
                try {
                    const safeUpdates = { name: newName };
                    if (newEmail) safeUpdates.email = newEmail;
                    if (userUpdates.telegramChatId) safeUpdates.telegramChatId = userUpdates.telegramChatId;
                    await setDoc(userDocRef, safeUpdates, { merge: true });
                } catch (_) {}
            }
        }

        // UPDATE CACHE LOCAL STORAGE AGAR UI EFEKTIF
        localStorage.setItem(`cached_user_name_${user.uid}`, newName);
        if (typeof window.invalidateCurrentUserDoc === 'function') window.invalidateCurrentUserDoc();

        // TUTUP MODAL POPUP EDIT PROFIL
        const modalEditProfile = document.getElementById('modal-edit-profile');
        if (modalEditProfile) modalEditProfile.classList.add('hidden');

        if (telegramCheckWarning) {
            showToast("Profil Disimpan ⚠️", telegramCheckMsg, "warning", 6000);
        } else {
            showToast("Berhasil", "Profil dan data GTK berhasil diperbarui!", "success");
        }
        setTimeout(() => window.location.reload(), 1500);

    } catch (error) {
        console.error("Update Profil Error:", error);
        let msg = error?.message || "Gagal menyimpan perubahan.";
        if (error.code === 'auth/requires-recent-login') msg = "Sesi login sudah lama atau memerlukan verifikasi ulang. Silakan masukkan password saat ini atau logout dan login kembali.";
        if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') msg = "Password saat ini / password lama yang Anda masukkan salah.";
        if (error.code === 'auth/weak-password') msg = "Password baru terlalu lemah. Gunakan minimal 8 karakter dengan kombinasi huruf dan angka.";
        if (error.code === 'auth/email-already-in-use') msg = "Alamat email baru tersebut sudah digunakan oleh akun lain.";
        if (error.code === 'auth/invalid-email') msg = "Format alamat email tidak valid.";
        if (error.code === 'auth/operation-not-allowed') {
            msg = "Perubahan email langsung diblokir oleh fitur 'Email enumeration protection' di Firebase Authentication. Silakan nonaktifkan opsi tersebut di Firebase Console (Authentication > Settings > User actions) agar email dapat diubah langsung tanpa tautan verifikasi.";
        }
        showToast("Gagal", msg, "error");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// --- HELPER: UPDATE SIDEBAR DARI DB (BACKGROUND) ---
window.updateSidebarProfileFromDB = function (uid) {
    const user = auth.currentUser;
    if (!user || user.uid !== uid) return Promise.resolve();
    if (sidebarProfileRequests.has(uid)) return sidebarProfileRequests.get(uid);

    const request = (async () => {
        try {
            const userSnap = await getDoc(doc(db, PATHS.users, uid));
            if (auth.currentUser?.uid !== uid) return;
            const data = userSnap.exists() ? userSnap.data() : null;
            // Fallback hanya setelah pencarian profil selesai, bukan selama memuat.
            sidebarResolvedNames.set(uid, data?.name || user.displayName || user.email?.split('@')[0] || 'Pengguna');
            if (data?.name) localStorage.setItem(`cached_user_name_${uid}`, data.name);
            syncSidebarProfile();

            // Sumber foto tetap GTK (Cloudflare D1), seperti alur sebelumnya.
            if (data && typeof window.getLinkedTeacherForUser === 'function') {
                const tObj = await window.getLinkedTeacherForUser(user, data);
                if (auth.currentUser?.uid !== uid) return;
                const rawFotoUrl = tObj?.data?.foto || tObj?.data?.photo_url;
                const fotoUrl = resolvePhotoUrl(rawFotoUrl);
                if (fotoUrl) {
                    localStorage.setItem(`cached_user_photo_${uid}`, fotoUrl);
                    window.updateUIAvatars(fotoUrl);
                }
            }
        } catch (e) {
            if (auth.currentUser?.uid === uid) {
                sidebarResolvedNames.set(uid, user.displayName || user.email?.split('@')[0] || 'Pengguna');
                syncSidebarProfile();
            }
            console.warn("Gagal update sidebar dari DB:", e);
        }
    })();
    sidebarProfileRequests.set(uid, request);
    request.finally(() => sidebarProfileRequests.delete(uid));
    return request;
};

// --- HELPER: BADGE 'NEW' MENU MASUKAN (DINONAKTIFKAN SESUAI ARAHAN USER AGAR TIDAK MUNCUL DOT MERAH) ---
window.updateMasukanBadgeUI = function () {
    const badgeDesktop = document.getElementById('menu-masukan-badge-desktop');
    const badgeMobile = document.getElementById('menu-masukan-badge-mobile');
    const dotDesktop = document.getElementById('menu-masukan-dot-desktop');
    const dotMobile = document.getElementById('menu-masukan-dot-mobile');

    if (badgeDesktop) badgeDesktop.classList.add('hidden');
    if (badgeMobile) badgeMobile.classList.add('hidden');
    if (dotDesktop) dotDesktop.classList.add('hidden');
    if (dotMobile) dotMobile.classList.add('hidden');
};

window.checkMasukanNewBadge = async function () {
    // Dinonaktifkan: Notifikasi masukan kini terarah via Push & Telegram bot terisolasi
    if (typeof window.updateMasukanBadgeUI === 'function') {
        window.updateMasukanBadgeUI(false);
    }
};

// --- AUTO LOGOUT (IDLE TIMEOUT - ASVS LEVEL 2 COMPLIANT) ---
window.initAutoLogout = () => {
    // Jangan jalankan timer di halaman login
    if (window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('/') || window.location.pathname === '/') {
        return;
    }

    if (window._simasIdleSessionMonitor) return;
    window._simasIdleSessionMonitor = startIdleSessionMonitor({
        auth,
        subscribeAuth: onAuthStateChanged,
        onTimeout: async expiredUser => {
            if (auth.currentUser?.uid === expiredUser.uid) {
                window._simasIdleLogoutInProgress = true;
                console.warn('⚠️ [SECURITY] Sesi telah kadaluarsa karena tidak ada aktivitas (AFK). Auto-Logout dijalankan.');
                try {
                    // Panggil Firebase SignOut
                    await signOut(auth);
                    if (auth.currentUser) {
                        window._simasIdleLogoutInProgress = false;
                        return;
                    }

                    // Bersihkan cache data sesi dari localStorage secara selektif (SSOT)
                    // Pertahankan preferensi UI non-sesi
                    const keysToKeep = [
                        'dark_mode', 
                        'sidebar_collapsed', 
                        'sidebar_open_groups', 
                        'hide_pwa_banner_time', 
                        'visited_agenda', 
                        'visited_game_pid',
                        'simas_masukan_last_visited',
                        'login_videos_cache',
                        'login_config_cache'
                    ];
                    
                    for (let i = localStorage.length - 1; i >= 0; i--) {
                        const key = localStorage.key(i);
                        if (key && !keysToKeep.includes(key) && !key.startsWith('simas_passkey_')) {
                            localStorage.removeItem(key);
                        }
                    }
                    sessionStorage.clear();

                    // Tampilkan pesan Toast
                    showToast("Sesi Berakhir", "Sesi Anda telah berakhir karena tidak ada aktivitas.", "warning", 0);
                    
                    // Redirect setelah toast muncul (2 detik)
                    const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
                    setTimeout(() => {
                        if (auth.currentUser) {
                            window._simasIdleLogoutInProgress = false;
                            return;
                        }
                        window.location.replace(`${ROOT_URL}index.html?status=session_expired&redirect=${redirectUrl}`);
                    }, 2000);
                } catch (e) {
                    console.error("Auto logout error", e);
                    const redirectUrl = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
                    window.location.replace(`${ROOT_URL}index.html?status=session_expired&redirect=${redirectUrl}`);
                }
            }
        }
    });
};

window.initAutoLogout();

// =====================================
// GLOBAL CURRENT USER DOC CACHE (HEMAT KUOTA READ)
// =====================================
// Cache users/{uid} agar tidak baca ulang di setiap page-controller
// TTL 10 menit, uid-keyed untuk keamanan multi-akun

const USER_DOC_CACHE_TTL = 10 * 60 * 1000; // 10 menit
let _currentUserDocCache = null;
let _currentUserDocUid = null;

/**
 * Ambil dokumen user yang sedang login dari cache (memory → localStorage → Firestore)
 * @param {boolean} forceRefresh - Paksa fetch dari Firestore
 * @returns {Promise<Object|null>} - User doc data atau null
 */
window.getCurrentUserDoc = async function (forceRefresh = false) {
    const user = auth.currentUser;
    if (!user) return null;

    // Invalidasi jika uid berubah (switch akun tanpa logout)
    if (_currentUserDocUid !== user.uid) {
        _currentUserDocCache = null;
        _currentUserDocUid = user.uid;
    }

    // Memory cache valid?
    if (!forceRefresh && _currentUserDocCache) {
        return _currentUserDocCache;
    }

    // localStorage cache (uid-keyed, TTL 10 menit)
    const cacheKey = `simas_userdoc_${user.uid}`;
    if (!forceRefresh) {
        const cached = window.getLocalCache(cacheKey, USER_DOC_CACHE_TTL);
        if (cached) {
            _currentUserDocCache = cached;
            return cached;
        }
    }

    // Fetch Firestore (1 read)
    try {
        const snap = await getDoc(doc(db, PATHS.users, user.uid));
        const data = snap.exists() ? { uid: user.uid, ...snap.data() } : null;
        _currentUserDocCache = data;
        if (data) window.setLocalCache(cacheKey, data);
        return data;
    } catch (e) {
        console.warn('[Cache] Error fetching user doc:', e);
        return _currentUserDocCache;
    }
};

/**
 * Invalidasi cache user doc (dipanggil saat edit profil sendiri)
 */
window.invalidateCurrentUserDoc = function () {
    _currentUserDocCache = null;
    const user = auth.currentUser;
    if (user) localStorage.removeItem(`simas_userdoc_${user.uid}`);
    console.log('[Cache] Current user doc cache invalidated');
};

// =====================================
// GLOBAL FINANCE CONFIG CACHE (HEMAT KUOTA READ)
// =====================================
// Cache finance_rates dan finance_config (jarang berubah, diubah admin 1x/semester)

const FINANCE_CACHE_TTL = 60 * 60 * 1000; // 1 jam

/**
 * Ambil finance_rates dari cache atau Cloudflare D1 system_settings (0 Firestore Read)
 * @returns {Promise<Object>} - {X, XI, XII, ...}
 */
window.getFinanceRatesCache = async function () {
    const cached = window.getLocalCache('simas_finance_rates_cache', FINANCE_CACHE_TTL);
    if (cached) return cached;

    try {
        let data = {};
        if (window.cfClient && window.cfClient.enabled) {
            data = await window.cfClient.getSystemSetting('finance_rates') || {};
        }
        window.setLocalCache('simas_finance_rates_cache', data);
        return data;
    } catch (e) {
        console.warn('[Cache] Error fetching finance_rates from D1:', e);
        return {};
    }
};

/**
 * Ambil finance_config dari cache atau Cloudflare D1 system_settings (0 Firestore Read)
 * @returns {Promise<Object>} - {dueDate, ...}
 */
window.getFinanceConfigCache = async function () {
    const cached = window.getLocalCache('simas_finance_config_cache', FINANCE_CACHE_TTL);
    if (cached) return cached;

    try {
        let data = {};
        if (window.cfClient && window.cfClient.enabled) {
            data = await window.cfClient.getSystemSetting('finance_config') || {};
        }
        window.setLocalCache('simas_finance_config_cache', data);
        return data;
    } catch (e) {
        console.warn('[Cache] Error fetching finance_config from D1:', e);
        return {};
    }
};

/**
 * Invalidasi finance cache (dipanggil saat admin ubah tarif/config)
 */
window.invalidateFinanceCache = function () {
    localStorage.removeItem('simas_finance_rates_cache');
    localStorage.removeItem('simas_finance_config_cache');
    console.log('[Cache] Finance cache invalidated');
};

// =====================================
// GLOBAL STUDENT CACHE (HEMAT KUOTA READ)
// =====================================
// Cache menggunakan metadata timestamp untuk invalidasi
// Hanya refresh jika ada perubahan data di server (lastUpdateStudents)

let STUDENT_CACHE = null;
let STUDENT_CACHE_SERVER_TS = null; // Timestamp dari server metadata
let STUDENT_CACHE_PROMISE = null;

const STUDENT_CACHE_KEY = 'cache_students_global';
const STUDENT_CACHE_TS_KEY = 'cache_students_global_ts';

let STUDENT_AGGREGATES_CACHE = null;
let STUDENT_AGGREGATES_CACHE_SERVER_TS = null;
let STUDENT_AGGREGATES_CACHE_PROMISE = null;

const STUDENT_AGGREGATES_CACHE_KEY = 'cache_student_aggregates_global';
const STUDENT_AGGREGATES_CACHE_TS_KEY = 'cache_student_aggregates_global_ts';

let SETTINGS_METADATA_CACHE = null;
let SETTINGS_METADATA_CACHE_TIME = 0;
const METADATA_TTL_MS = 30000; // 30s TTL untuk metadata timestamp check

/**
 * Helper terpusat untuk mengambil metadata timestamp dari Cloudflare D1 system_settings (0 Firestore Read)
 */
async function getServerMetadata(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && SETTINGS_METADATA_CACHE !== null && (now - SETTINGS_METADATA_CACHE_TIME < METADATA_TTL_MS)) {
        return SETTINGS_METADATA_CACHE;
    }
    try {
        let data = {};
        if (window.cfClient && window.cfClient.enabled) {
            data = await window.cfClient.getSystemSetting('metadata') || {};
        }
        const studentTimestamp = data.lastUpdateStudents;
        SETTINGS_METADATA_CACHE = {
            studentsTs: studentTimestamp && typeof studentTimestamp.toMillis === 'function'
                ? studentTimestamp.toMillis()
                : Number(studentTimestamp) || 0,
            teachersTs: Number(data.lastUpdateTeachers) || 0,
            aggregateVersion: Math.max(0, Number(data.aggregateVersion) || 0),
            lastAggregateNis: data.lastAggregateNis ? String(data.lastAggregateNis) : ''
        };
        SETTINGS_METADATA_CACHE_TIME = now;
        return SETTINGS_METADATA_CACHE;
    } catch (e) {
        console.warn('[Cache] Gagal membaca server metadata from D1:', e);
        return SETTINGS_METADATA_CACHE || { studentsTs: 0, teachersTs: 0, aggregateVersion: 0, lastAggregateNis: '' };
    }
}

async function getServerMetadataLastUpdate(forceRefresh = false) {
    const metadata = await getServerMetadata(forceRefresh);
    return metadata.studentsTs || 0;
}
window.getServerMetadataLastUpdate = getServerMetadataLastUpdate;
window.getServerMetadataVersions = getServerMetadata;

/**
 * Ambil data siswa dari cache (jika valid) atau query Firestore
 * Menggunakan metadata.lastUpdateStudents untuk validasi
 * @param {boolean} forceRefresh - Paksa refresh dari Firestore
 * @returns {Promise<Array>} - Array of student objects {nis, name, class, ...}
 */
async function loadStudentsCache(forceRefresh = false) {
    try {
        // 1. Ambil timestamp metadata dari server/cache TTL
        const serverTime = await getServerMetadataLastUpdate(forceRefresh);

        // 2. Cek cache di memory dulu
        if (!forceRefresh && STUDENT_CACHE && STUDENT_CACHE.length > 0 && STUDENT_CACHE_SERVER_TS === serverTime) {
            console.log('[Cache] Using memory cache (' + STUDENT_CACHE.length + ' students)');
            return STUDENT_CACHE;
        }

        // 3. Cek IndexedDB (Primary Storage)
        if (!forceRefresh) {
            const idbMeta = await SimasDB.getMeta('students_ts');
            if ((serverTime > 0 && idbMeta && String(idbMeta.ts) === String(serverTime)) || (serverTime <= 0)) {
                const idbData = await SimasDB.getAll('students');
                if (idbData && idbData.length > 0) {
                    console.log('[Cache] Using IndexedDB cache (' + idbData.length + ' students, metadata valid)');
                    STUDENT_CACHE = idbData;
                    STUDENT_CACHE_SERVER_TS = serverTime || (idbMeta?.ts || Date.now());
                    return STUDENT_CACHE;
                }
            }
        }

        // 4. Fallback Cek localStorage (Secondary Storage)
        const localTs = localStorage.getItem(STUDENT_CACHE_TS_KEY);
        const localData = localStorage.getItem(STUDENT_CACHE_KEY);

        if (!forceRefresh && ((serverTime > 0 && localTs && String(serverTime) === String(localTs)) || (serverTime <= 0 && localData)) && localData) {
            console.log('[Cache] Using localStorage cache (metadata valid)');
            STUDENT_CACHE = JSON.parse(localData);
            STUDENT_CACHE_SERVER_TS = serverTime || (Number(localTs) || Date.now());
            SimasDB.saveAll('students', STUDENT_CACHE, STUDENT_CACHE_SERVER_TS);
            return STUDENT_CACHE;
        }

        // 5. Data sudah outdated atau belum ada - Ambil langsung dari Cloudflare D1 (Master Tunggal)
        let studentsList = [];

        try {
            if (window.cfClient && window.cfClient.enabled) {
                console.log('[Cache] Fetching students from Cloudflare D1 (Primary SSOT)...');
                const cfStudents = await window.cfClient.getStudents({ limit: 2000 });
                if (Array.isArray(cfStudents) && cfStudents.length > 0) {
                    studentsList = cfStudents;
                    console.log('[Cache] Successfully loaded ' + cfStudents.length + ' students from Cloudflare D1 (0 Firestore Read)');
                }
            }
        } catch (cfErr) {
            console.warn('[Cache] Cloudflare D1 fetch error, fallback to IndexedDB local cache:', cfErr.message);
        }

        // Jika Cloudflare D1 sedang offline/error, gunakan data IndexedDB / localStorage yang ada
        if (!studentsList || studentsList.length === 0) {
            const idbData = await SimasDB.getAll('students');
            if (idbData && idbData.length > 0) {
                console.log('[Cache] Using IndexedDB fallback (' + idbData.length + ' students)');
                STUDENT_CACHE = idbData;
                return STUDENT_CACHE;
            }
        }

        if (studentsList && studentsList.length > 0) {
            STUDENT_CACHE = studentsList;
            STUDENT_CACHE_SERVER_TS = serverTime || Date.now();

            // 6. Simpan ke IndexedDB (Primary) & localStorage (Secondary Fallback)
            await SimasDB.saveAll('students', STUDENT_CACHE, STUDENT_CACHE_SERVER_TS);
            try {
                localStorage.setItem(STUDENT_CACHE_KEY, JSON.stringify(STUDENT_CACHE));
                localStorage.setItem(STUDENT_CACHE_TS_KEY, String(STUDENT_CACHE_SERVER_TS));
            } catch (e) {
                console.warn('[Cache] localStorage skipped (payload handled by IndexedDB):', e);
            }

            console.log('[Cache] Cached ' + STUDENT_CACHE.length + ' students to IndexedDB');
            return STUDENT_CACHE;
        }

        // Jika data kosong karena kendala jaringan / auth, kembalikan array kosong tanpa mengunci cache TS
        STUDENT_CACHE = [];
        return [];

    } catch (e) {
        console.error('[Cache] Error:', e);
        // Fallback ke IndexedDB jika offline/error
        const idbData = await SimasDB.getAll('students');
        if (idbData && idbData.length > 0) {
            console.log('[Cache] Fallback to IndexedDB (offline)');
            STUDENT_CACHE = idbData;
            return STUDENT_CACHE;
        }
        if (STUDENT_CACHE) return STUDENT_CACHE;

        // Coba dari localStorage
        const localData = localStorage.getItem(STUDENT_CACHE_KEY);
        if (localData) {
            console.log('[Cache] Fallback to localStorage');
            return JSON.parse(localData);
        }
        return [];
    }
}

window.getStudentsCache = function (forceRefresh = false) {
    if (STUDENT_CACHE_PROMISE) return STUDENT_CACHE_PROMISE;
    const request = loadStudentsCache(forceRefresh).finally(() => {
        if (STUDENT_CACHE_PROMISE === request) STUDENT_CACHE_PROMISE = null;
    });
    STUDENT_CACHE_PROMISE = request;
    return request;
};

/**
 * Helper untuk memeriksa apakah siswa berstatus aktif (bukan alumni / lulus / mutasi / keluar / nonaktif).
 * Jika showAlumni == true, maka siswa alumni tetap diizinkan.
 */
window.isStudentActive = function (student, showAlumni = false) {
    if (!student) return false;
    if (showAlumni) return true;

    const normalizeStatusText = value => String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\bbelum\s+lulus\b/g, '');
    const cls = normalizeStatusText(student.kelas || student.class || student.rombel);
    const st = normalizeStatusText(student.status || student.statusSiswa);
    const inactivePatterns = [
        /\balumni\b/,
        /\bmutasi\b/,
        /\bpindah\b/,
        /\bkeluar\b/,
        /\bnon\s*aktif\b/,
        /\blulus\b/,
        /\bdrop\s*out\b/,
        /^do$/
    ];
    if (inactivePatterns.some(pattern => pattern.test(st) || pattern.test(cls))) return false;

    return true;
};

/**
 * Mengambil daftar siswa dari cache yang otomatis difilter sesuai opsi showAlumni di Pengaturan.
 */
window.getActiveStudentsCache = async function (forceRefresh = false) {
    const rawStudents = await window.getStudentsCache(forceRefresh);
    let showAlumni = false;

    try {
        // Modul perpustakaan memiliki toggle sendiri di lib_config. Pakai nilai
        // tersebut bila tersedia; fallback ke konfigurasi sistem untuk instalasi lama.
        const { data: libraryConfig, error: libraryConfigError } = await supabase
            .from('lib_config')
            .select('value')
            .eq('key', 'tampilkan_alumni')
            .maybeSingle();

        if (libraryConfigError) throw libraryConfigError;
        if (libraryConfig) {
            showAlumni = String(libraryConfig.value).toLowerCase() === 'true';
        } else {
            const config = window.getSystemConfig ? await window.getSystemConfig() : null;
            if (config) showAlumni = config.showAlumni === true;
        }
    } catch (e) {
        try {
            const config = window.getSystemConfig ? await window.getSystemConfig() : null;
            showAlumni = config?.showAlumni === true;
        } catch (fallbackError) {
            showAlumni = false;
        }
    }

    if (showAlumni) return rawStudents;
    return rawStudents.filter(s => window.isStudentActive(s, false));
};

/**
 * Ambil data agregat siswa dari cache (jika valid) atau query Firestore.
 * Validasi memakai metadata.aggregateVersion yang terisolasi dari profil siswa.
 * @param {boolean} forceRefresh - Paksa refresh dari Firestore
 * @returns {Promise<Array>} - Array of aggregate objects {nis, points, attendance, ...}
 */
async function loadStudentAggregatesCache(forceRefresh = false) {
    try {
        // 1. Versi agregat terpisah agar perubahan profil siswa tidak memicu full refresh agregat.
        const metadata = await getServerMetadata(forceRefresh);
        const serverTime = `agg:${metadata.aggregateVersion}`;

        // 2. Cek cache di memory
        if (!forceRefresh && STUDENT_AGGREGATES_CACHE && STUDENT_AGGREGATES_CACHE.length > 0 && STUDENT_AGGREGATES_CACHE_SERVER_TS === serverTime) {
            console.log('[Cache Aggregates] Using memory cache (' + STUDENT_AGGREGATES_CACHE.length + ' docs)');
            return STUDENT_AGGREGATES_CACHE;
        }

        // 3. Cek IndexedDB (Primary)
        if (!forceRefresh) {
            const idbMeta = await SimasDB.getMeta('student_aggregates_ts');
            if (idbMeta && String(idbMeta.ts) === String(serverTime)) {
                const idbData = await SimasDB.getAll('student_aggregates');
                if (idbData && idbData.length > 0) {
                    console.log('[Cache Aggregates] Using IndexedDB cache (' + idbData.length + ' docs, metadata valid)');
                    STUDENT_AGGREGATES_CACHE = idbData;
                    STUDENT_AGGREGATES_CACHE_SERVER_TS = serverTime;
                    return STUDENT_AGGREGATES_CACHE;
                }
            }
        }

        // 4. Cek localStorage (Secondary Fallback)
        const localTs = localStorage.getItem(STUDENT_AGGREGATES_CACHE_TS_KEY);
        const localData = localStorage.getItem(STUDENT_AGGREGATES_CACHE_KEY);

        if (!forceRefresh && localTs && String(serverTime) === String(localTs) && localData) {
            console.log('[Cache Aggregates] Using localStorage cache (metadata valid)');
            STUDENT_AGGREGATES_CACHE = JSON.parse(localData);
            STUDENT_AGGREGATES_CACHE_SERVER_TS = serverTime;
            SimasDB.saveAll('student_aggregates', STUDENT_AGGREGATES_CACHE, serverTime);
            return STUDENT_AGGREGATES_CACHE;
        }

        // 5. Fetch dari Cloudflare D1 (100% SSOT, 0 Firestore Read)
        console.log('[Cache Aggregates] Fetching student_aggregates from Cloudflare D1...');
        const cfAggregates = await window.cfClient.getStudentAggregates();

        STUDENT_AGGREGATES_CACHE = (Array.isArray(cfAggregates) ? cfAggregates : (cfAggregates ? [cfAggregates] : [])).map(item => ({
            nis: item.nis || item.student_nis || item.id,
            id: item.nis || item.student_nis || item.id,
            points: item.points || 0,
            violation_count: item.violation_count || 0,
            achievement_count: item.achievement_count || 0,
            permission_count: item.permission_count || 0,
            last_record_at: item.last_record_at || null,
            last_updated: item.last_updated || null
        }));
        STUDENT_AGGREGATES_CACHE_SERVER_TS = serverTime;

        // 6. Simpan ke IndexedDB (Primary) & localStorage (Secondary Fallback)
        await SimasDB.saveAll('student_aggregates', STUDENT_AGGREGATES_CACHE, STUDENT_AGGREGATES_CACHE_SERVER_TS);
        try {
            localStorage.setItem(STUDENT_AGGREGATES_CACHE_KEY, JSON.stringify(STUDENT_AGGREGATES_CACHE));
            localStorage.setItem(STUDENT_AGGREGATES_CACHE_TS_KEY, String(STUDENT_AGGREGATES_CACHE_SERVER_TS));
        } catch (e) {
            console.warn('[Cache Aggregates] localStorage skipped (handled by IndexedDB):', e);
        }

        console.log('[Cache Aggregates] Cached ' + STUDENT_AGGREGATES_CACHE.length + ' student_aggregates to IndexedDB');
        return STUDENT_AGGREGATES_CACHE;

    } catch (e) {
        console.error('[Cache Aggregates] Error:', e);
        const idbData = await SimasDB.getAll('student_aggregates');
        if (idbData && idbData.length > 0) {
            console.log('[Cache Aggregates] Fallback to IndexedDB (offline)');
            STUDENT_AGGREGATES_CACHE = idbData;
            return STUDENT_AGGREGATES_CACHE;
        }
        if (STUDENT_AGGREGATES_CACHE) return STUDENT_AGGREGATES_CACHE;

        const localData = localStorage.getItem(STUDENT_AGGREGATES_CACHE_KEY);
        if (localData) {
            console.log('[Cache Aggregates] Fallback to localStorage');
            return JSON.parse(localData);
        }
        return [];
    }
}

window.getStudentAggregatesCache = function (forceRefresh = false) {
    if (STUDENT_AGGREGATES_CACHE_PROMISE) return STUDENT_AGGREGATES_CACHE_PROMISE;
    const request = loadStudentAggregatesCache(forceRefresh).finally(() => {
        if (STUDENT_AGGREGATES_CACHE_PROMISE === request) STUDENT_AGGREGATES_CACHE_PROMISE = null;
    });
    STUDENT_AGGREGATES_CACHE_PROMISE = request;
    return request;
};

async function persistStudentAggregatesCache(versionKey = STUDENT_AGGREGATES_CACHE_SERVER_TS) {
    if (!Array.isArray(STUDENT_AGGREGATES_CACHE) || !versionKey) return false;
    STUDENT_AGGREGATES_CACHE_SERVER_TS = versionKey;
    await SimasDB.saveAll('student_aggregates', STUDENT_AGGREGATES_CACHE, versionKey);
    try {
        localStorage.setItem(STUDENT_AGGREGATES_CACHE_KEY, JSON.stringify(STUDENT_AGGREGATES_CACHE));
        localStorage.setItem(STUDENT_AGGREGATES_CACHE_TS_KEY, String(versionKey));
    } catch (e) {
        console.warn('[Cache Aggregates] localStorage patch skipped:', e);
    }
    return true;
}

/**
 * Tambal satu agregat pada cache yang sudah aktif tanpa membaca ulang seluruh koleksi.
 * Mengembalikan false bila cache belum pernah dimuat pada sesi ini.
 */
window.patchStudentAggregateCache = async function (nis, aggregateData, aggregateVersion = null) {
    if (!nis || !Array.isArray(STUDENT_AGGREGATES_CACHE)) return false;
    const normalizedNis = String(nis);
    const index = STUDENT_AGGREGATES_CACHE.findIndex(item => String(item.nis || item.id) === normalizedNis);

    if (aggregateData === null) {
        if (index >= 0) STUDENT_AGGREGATES_CACHE.splice(index, 1);
    } else {
        const nextValue = { ...(index >= 0 ? STUDENT_AGGREGATES_CACHE[index] : {}), ...aggregateData, nis: normalizedNis };
        if (index >= 0) STUDENT_AGGREGATES_CACHE[index] = nextValue;
        else STUDENT_AGGREGATES_CACHE.push(nextValue);
    }

    const versionKey = aggregateVersion === null
        ? STUDENT_AGGREGATES_CACHE_SERVER_TS
        : `agg:${Math.max(0, Number(aggregateVersion) || 0)}`;
    await persistStudentAggregatesCache(versionKey);
    return true;
};

async function refreshStudentAggregateCacheEntry(nis, aggregateVersion) {
    if (!nis || !Array.isArray(STUDENT_AGGREGATES_CACHE)) return false;
    try {
        const aggData = await window.cfClient.getStudentAggregateByNis(String(nis));
        const hasData = aggData && (aggData.points > 0 || aggData.violation_count > 0 || aggData.achievement_count > 0 || aggData.permission_count > 0);
        return window.patchStudentAggregateCache(
            nis,
            hasData ? aggData : null,
            aggregateVersion
        );
    } catch (e) {
        console.warn('[Cache Aggregates] refreshStudentAggregateCacheEntry error:', e);
        return false;
    }
}

window.invalidateStudentAggregatesCache = function ({ preserveMetadata = false } = {}) {
    STUDENT_AGGREGATES_CACHE = null;
    STUDENT_AGGREGATES_CACHE_SERVER_TS = null;
    STUDENT_AGGREGATES_CACHE_PROMISE = null;
    if (!preserveMetadata) {
        SETTINGS_METADATA_CACHE = null;
        SETTINGS_METADATA_CACHE_TIME = 0;
    }
    SimasDB.clear('student_aggregates');
    localStorage.removeItem(STUDENT_AGGREGATES_CACHE_KEY);
    localStorage.removeItem(STUDENT_AGGREGATES_CACHE_TS_KEY);
    console.log('[Cache Aggregates] Cache invalidated');
};

/**
 * Invalidasi cache (dipanggil saat data siswa/pelanggaran/presensi berubah)
 */
window.invalidateStudentsCache = function ({ preserveMetadata = false } = {}) {
    STUDENT_CACHE = null;
    STUDENT_CACHE_SERVER_TS = null;
    STUDENT_CACHE_PROMISE = null;
    if (!preserveMetadata) {
        SETTINGS_METADATA_CACHE = null;
        SETTINGS_METADATA_CACHE_TIME = 0;
    }
    
    // Clear IndexedDB cache
    SimasDB.clear('students');

    // Hapus semua data cache siswa di localStorage
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('cache_students_') || key === STUDENT_CACHE_KEY || key === STUDENT_CACHE_TS_KEY || key.startsWith('simas_violations_academic_year_'))) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    localStorage.removeItem('simas_dashboard_active_students_count');
    
    console.log('[Cache] Student master caches invalidated (aggregate cache preserved)');
};

/**
 * Filter siswa berdasarkan kelas dari cache
 * @param {string} className - Nama kelas (exact match)
 * @returns {Promise<Array>} - Filtered students
 */
window.getStudentsByClass = async function (className) {
    const all = await window.getStudentsCache();
    return all.filter(s => s.class === className);
};

/**
 * Filter siswa berdasarkan prefix kelas dari cache
 * @param {string} prefix - Prefix kelas (e.g., 'XII', 'XI IPA')
 * @returns {Promise<Array>} - Filtered students
 */
window.getStudentsByClassPrefix = async function (prefix) {
    const all = await window.getStudentsCache();
    return all.filter(s => s.class && s.class.startsWith(prefix));
};

/**
 * Cari siswa berdasarkan NIS dari cache
 * @param {string} nis - NIS siswa
 * @returns {Promise<Object|null>} - Student object or null
 */
window.getStudentByNIS = async function (nis) {
    const all = await window.getStudentsCache();
    return all.find(s => s.nis === nis || s.id === nis) || null;
};

/**
 * Search siswa berdasarkan nama/NIS dari cache
 * @param {string} term - Search term
 * @returns {Promise<Array>} - Matching students
 */
window.searchStudents = async function (term) {
    if (!term) return [];
    const all = await window.getStudentsCache();
    const lowerTerm = term.toLowerCase();
    return all.filter(s =>
        (s.name && s.name.toLowerCase().includes(lowerTerm)) ||
        (s.nis && s.nis.includes(term))
    );
};

// =====================================
// GLOBAL WALI KELAS CACHE (HEMAT KUOTA READ)
// =====================================
// Cache mapping assignedClass -> wali kelas data
// Digunakan di: page-input.js, page-presensi.js, page-keuangan.js, page-portal-siswa.js

let WALI_KELAS_CACHE = null; // Map: className -> {name, email, uid, ...}
let WALI_KELAS_CACHE_TS = 0;
const WALI_KELAS_CACHE_TTL = 10 * 60 * 1000; // 10 menit (lebih lama karena jarang berubah)

/**
 * Ambil semua wali kelas dari cache atau Firestore
 * Mengambil nomor HP dari koleksi teachers (SSOT) jika ada linkedTeacherId
 * @param {boolean} forceRefresh - Paksa refresh
 * @returns {Promise<Map>} - Map className -> wali kelas data
 */
window.getWaliKelasCache = async function (forceRefresh = false) {
    const now = Date.now();

    // Cache masih valid?
    if (!forceRefresh && WALI_KELAS_CACHE && (now - WALI_KELAS_CACHE_TS) < WALI_KELAS_CACHE_TTL) {
        console.log('[Cache] Using cached wali kelas data');
        return WALI_KELAS_CACHE;
    }

    try {
        console.log('[Cache] Fetching wali kelas from Firestore...');

        // Query 1: User dengan primary role wali_kelas
        const q1 = query(collection(db, PATHS.users), where('role', '==', 'wali_kelas'));
        const snap1 = await getDocs(q1);

        // Query 2: User dengan wali_kelas di additionalRoles (perlu filter manual)
        const q2 = query(collection(db, PATHS.users), where('additionalRoles', 'array-contains', 'wali_kelas'));
        const snap2 = await getDocs(q2);

        // Gabungkan hasil (hindari duplikat dengan Map key = uid)
        const usersMap = new Map();
        snap1.forEach(docSnap => usersMap.set(docSnap.id, docSnap.data()));
        snap2.forEach(docSnap => {
            if (!usersMap.has(docSnap.id)) {
                usersMap.set(docSnap.id, docSnap.data());
            }
        });

        // Ambil data teachers dari Cache D1 SSOT (0 Firestore Read)
        const teachersData = await window.getTeachersMapCache();

        // Build cache dengan nomor HP dari teachers (SSOT)
        WALI_KELAS_CACHE = new Map();
        usersMap.forEach((data, uid) => {
            const rawClass = data.assignedClass || data.kelas || data.handledClass || '';
            if (rawClass) {
                let phone = '';
                let nip = '';
                let name = data.name || data.email?.split('@')[0] || 'Wali Kelas';
                let photo = data.photoURL || data.photo || data.foto || '';

                // Prioritas: Ambil dari teachers jika ada linkedTeacherId
                if (data.linkedTeacherId && teachersData.has(data.linkedTeacherId)) {
                    const teacherData = teachersData.get(data.linkedTeacherId);
                    phone = teacherData.phone || '';
                    nip = teacherData.nip || '';
                    // Nama juga bisa dari teachers jika lebih lengkap
                    if (teacherData.name) name = teacherData.name;
                    if (!photo && (teacherData.foto || teacherData.photo_url || teacherData.photo || teacherData.avatar)) {
                        photo = teacherData.foto || teacherData.photo_url || teacherData.photo || teacherData.avatar;
                    }
                } else {
                    // Fallback ke data user (jarang ada phone di sini)
                    phone = data.phone || '';
                    nip = data.nip || '';

                    // Coba lookup NIP ke teachersData berdasarkan kecocokan nama jika linkedTeacherId belum terpasang
                    if (teachersData && teachersData.size > 0 && name) {
                        const cleanUserName = String(name).trim().toLowerCase();
                        for (const [, tObj] of teachersData.entries()) {
                            const cleanTName = String(tObj?.name || tObj?.nama || '').trim().toLowerCase();
                            if (cleanTName && (cleanTName === cleanUserName || cleanTName.includes(cleanUserName) || cleanUserName.includes(cleanTName))) {
                                if (tObj.nip && !nip) nip = tObj.nip;
                                if (tObj.phone && !phone) phone = tObj.phone;
                                if (!photo && (tObj.foto || tObj.photo_url || tObj.photo || tObj.avatar)) {
                                    photo = tObj.foto || tObj.photo_url || tObj.photo || tObj.avatar;
                                }
                                break;
                            }
                        }
                    }
                }

                // Jika masih belum ada photo tapi ada ID teacher unik, coba endpoint standar foto GTK
                if (!photo && data.linkedTeacherId) {
                    const tObj = teachersData.get(data.linkedTeacherId);
                    if (tObj && tObj.id) {
                        photo = `/api/photos/gtk/${tObj.id}.webp`;
                    }
                }

                const cleanClass = String(rawClass).trim().replace(/^Kelas\s+/i, '');
                const normClass = cleanClass.replace(/[\s\-_]+/g, '').toLowerCase();
                const waliObj = {
                    uid: uid,
                    name: name,
                    email: data.email || '',
                    phone: phone,
                    nip: nip,
                    photo: photo || null,
                    assignedClass: cleanClass,
                    linkedTeacherId: data.linkedTeacherId || null
                };

                WALI_KELAS_CACHE.set(cleanClass, waliObj);
                WALI_KELAS_CACHE.set(rawClass, waliObj);
                WALI_KELAS_CACHE.set(`Kelas ${cleanClass}`, waliObj);
                if (normClass) WALI_KELAS_CACHE.set(normClass, waliObj);
            }
        });
        WALI_KELAS_CACHE_TS = now;

        console.log('[Cache] Cached ' + WALI_KELAS_CACHE.size + ' wali kelas mappings (with teacher phone lookup)');
        return WALI_KELAS_CACHE;

    } catch (e) {
        console.error('[Cache] Error fetching wali kelas:', e);
        if (WALI_KELAS_CACHE) return WALI_KELAS_CACHE;
        return new Map();
    }
};

/**
 * Cari wali kelas berdasarkan nama kelas
 * @param {string} className - Nama kelas (exact match atau dengan/tanpa prefix 'Kelas ')
 * @returns {Promise<Object|null>} - Wali kelas data or null
 */
window.getWaliKelasByClass = async function (className) {
    if (!className) return null;
    const cleanCls = String(className).trim().replace(/^Kelas\s+/i, '');
    const normCls = cleanCls.replace(/[\s\-_]+/g, '').toLowerCase();
    let cache = await window.getWaliKelasCache();
    let res = cache.get(cleanCls) || cache.get(className) || cache.get(`Kelas ${cleanCls}`) || cache.get(normCls);
    if (!res) {
        // Coba scan normalized key
        for (const [k, val] of cache.entries()) {
            const kNorm = String(k).trim().replace(/^Kelas\s+/i, '').replace(/[\s\-_]+/g, '').toLowerCase();
            if (kNorm === normCls) {
                res = val;
                break;
            }
        }
    }
    if (!res) {
        // Fallback: coba refresh cache jika belum terdaftar
        cache = await window.getWaliKelasCache(true);
        res = cache.get(cleanCls) || cache.get(className) || cache.get(`Kelas ${cleanCls}`) || cache.get(normCls);
        if (!res) {
            for (const [k, val] of cache.entries()) {
                const kNorm = String(k).trim().replace(/^Kelas\s+/i, '').replace(/[\s\-_]+/g, '').toLowerCase();
                if (kNorm === normCls) {
                    res = val;
                    break;
                }
            }
        }
    }
    return res || null;
};

/**
 * Resolusi Data Wali Kelas & NIP yang Sah (SSOT per Kelas Siswa)
 * Memastikan nama dan NIP yang dicetak pada lembar dinas rapor perkembangan afektif
 * adalah guru wali kelas yang bersangkutan, sekalipun dicetak oleh super admin, admin,
 * guru wali, BK, atau staf lainnya.
 * 
 * @param {string} className - Nama rombel/kelas siswa
 * @param {Object} [currentUserProfile] - Objek profil pengguna yang sedang login (opsional)
 * @returns {Promise<{ name: string, nip: string, rawNip: string, isActualWali: boolean }>}
 */
window.resolveHomeroomTeacher = async function (className, currentUserProfile = null) {
    const rawClass = String(className || '').trim();
    const cleanClass = rawClass.replace(/^Kelas\s+/i, '');
    const normClass = cleanClass.replace(/[\s\-_]+/g, '').toLowerCase();

    let targetName = '';
    let targetNip = '';

    // 1. Cek apakah pengguna saat ini adalah Wali Kelas yang bersangkutan dari kelas ini
    const isCurrentUserActualWali = Boolean(
        currentUserProfile &&
        (currentUserProfile.role === 'wali_kelas' || currentUserProfile.role === 'guru') &&
        currentUserProfile.assignedClass &&
        normClass &&
        String(currentUserProfile.assignedClass).trim().replace(/^Kelas\s+/i, '').replace(/[\s\-_]+/g, '').toLowerCase() === normClass
    );

    // 2. Ambil data wali kelas resmi kelas ini melalui getWaliKelasByClass (SSOT)
    try {
        if (typeof window.getWaliKelasByClass === 'function' && cleanClass) {
            const classWali = await window.getWaliKelasByClass(cleanClass);
            if (classWali) {
                targetName = classWali.name || '';
                targetNip = classWali.nip || '';

                // Jika NIP belum ada pada data user, cari di Master GTK via linkedTeacherId atau kecocokan nama
                if (!targetNip && typeof window.getTeachersMapCache === 'function') {
                    try {
                        const tMap = await window.getTeachersMapCache();
                        if (classWali.linkedTeacherId && tMap.has(classWali.linkedTeacherId)) {
                            targetNip = tMap.get(classWali.linkedTeacherId)?.nip || '';
                        } else if (targetName && tMap.size > 0) {
                            const cleanWaliName = targetName.trim().toLowerCase();
                            for (const [, tObj] of tMap.entries()) {
                                const tName = String(tObj?.name || '').trim().toLowerCase();
                                if (tName && (tName === cleanWaliName || tName.includes(cleanWaliName) || cleanWaliName.includes(tName))) {
                                    if (tObj.nip) {
                                        targetNip = tObj.nip;
                                        break;
                                    }
                                }
                            }
                        }
                    } catch (eT) {
                        console.warn('[resolveHomeroomTeacher] Gagal lookup GTK NIP:', eT);
                    }
                }
            }
        }
    } catch (eWali) {
        console.warn('[resolveHomeroomTeacher] Gagal ambil wali kelas:', eWali);
    }

    // 3. Jika pengguna saat ini terbukti benar-benar wali kelas kelas ini, gunakan datanya jika getWaliKelasByClass belum lengkap
    if (isCurrentUserActualWali) {
        if (!targetName) targetName = currentUserProfile.name || currentUserProfile.nama || '';
        if (!targetNip) targetNip = currentUserProfile.nip || '';
    }

    // 4. JIKA PENGGUNA YANG LOGIN ADALAH SUPER ADMIN, ADMIN, GURU WALI, BK, ATAU BUKAN WALI KELAS KELAS INI:
    // DILARANG KERAS menggunakan nama/NIP akun yang sedang login!
    if (!targetName) {
        targetName = cleanClass ? `Wali Kelas ${cleanClass}` : 'Wali Kelas';
    }

    // 5. Validasi & Standarisasi Format NIP yang Sah
    const cleanNip = String(targetNip || '').replace(/^NIP[\.\s:]*/i, '').trim();
    const hasValidNip = Boolean(
        cleanNip &&
        cleanNip !== '-' &&
        cleanNip !== '0' &&
        cleanNip.toLowerCase() !== 'null' &&
        cleanNip.toLowerCase() !== 'undefined' &&
        !cleanNip.startsWith('.') &&
        cleanNip.length >= 8
    );

    return {
        name: targetName,
        nip: hasValidNip ? `NIP. ${cleanNip}` : '',
        rawNip: hasValidNip ? cleanNip : '',
        isActualWali: isCurrentUserActualWali
    };
};

/**
 * Invalidasi cache wali kelas
 */
window.invalidateWaliKelasCache = function () {
    WALI_KELAS_CACHE = null;
    WALI_KELAS_CACHE_TS = 0;
    console.log('[Cache] Wali kelas cache invalidated');
};

/**
 * SSOT Helper: Mengambil Riwayat Pembinaan & Konseling Siswa (BK, Guru Wali, Wali Kelas)
 * Menggunakan Cloudflare D1 Serverless SQL (0 Firestore Read, 0 Supabase Write).
 * Mendukung toleransi format NIS (dengan/tanpa leading zero) dan pemetaan properti camelCase/snake_case.
 * 
 * @param {string|number} targetNis - NIS siswa target
 * @param {Object} [options]
 * @param {string} [options.startDateIso] - Tanggal awal filter ISO YYYY-MM-DD
 * @param {string} [options.endDateIso] - Tanggal akhir filter ISO YYYY-MM-DD
 * @param {string} [options.studentClass] - Kelas siswa untuk identifikasi role wali kelas
 * @param {string} [options.currentUid] - UID pengguna saat ini
 * @param {string} [options.currentUserName] - Nama pengguna saat ini
 * @returns {Promise<Array<{ id: string, date: string, source: string, role: string, counselor: string, category: string, title: string, notes: string, followUp: string }>>}
 */
window.fetchStudentPembinaanHistory = async function (targetNis, options = {}) {
    const list = [];
    if (!targetNis) return list;

    const rawNis = String(targetNis).trim();
    if (!rawNis) return list;

    const normNis = rawNis.replace(/^0+/, '');
    const searchNisList = Array.from(new Set([rawNis, normNis, rawNis.padStart(4, '0')].filter(Boolean)));

    const { startDateIso, endDateIso, studentClass, currentUid, currentUserName } = options;
    const teacherName = String(currentUserName || '').trim().toLowerCase();

    // Helper normalisasi tanggal ke YYYY-MM-DD
    const normalizeDateStr = (rawDate) => {
        if (!rawDate) return '';
        if (typeof rawDate === 'string') {
            const trimmed = rawDate.trim();
            if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
                return trimmed.substring(0, 10);
            }
            // Tanggal Indonesia DD/MM/YYYY atau DD-MM-YYYY
            const dmyMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
            if (dmyMatch) {
                const day = dmyMatch[1].padStart(2, '0');
                const month = dmyMatch[2].padStart(2, '0');
                const year = dmyMatch[3];
                return `${year}-${month}-${day}`;
            }
        } else if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
            return rawDate.toISOString().substring(0, 10);
        }
        return String(rawDate).substring(0, 10);
    };

    const client = (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled)
        ? cfClient
        : (typeof window !== 'undefined' && window.cfClient && window.cfClient.enabled ? window.cfClient : null);

    if (client) {
        try {
            // Jalankan kueri untuk setiap kemungkinan format NIS ke Cloudflare D1
            const queryPromises = [];
            searchNisList.forEach(nisToQuery => {
                queryPromises.push(client.getGuruWaliNotes({ student_nis: nisToQuery }));
                queryPromises.push(client.getBkActions({ student_nis: nisToQuery }));
            });

            const queryResults = await Promise.allSettled(queryPromises);
            const seenIds = new Set();

            queryResults.forEach((res, index) => {
                if (res.status !== 'fulfilled' || !Array.isArray(res.value)) return;
                const isGuruWaliQuery = (index % 2 === 0);

                if (isGuruWaliQuery) {
                    // Response dari guru_wali_notes
                    res.value.forEach(n => {
                        const noteId = String(n.id || `${n.guru_uid}_${n.student_nis}_${n.date}`);
                        if (seenIds.has(noteId)) return;
                        seenIds.add(noteId);

                        const normDate = normalizeDateStr(n.date || n.created_at);
                        if (startDateIso && normDate && normDate < startDateIso) return;
                        if (endDateIso && normDate && normDate > endDateIso) return;

                        const authorUid = n.guru_uid || n.guruUid || '';
                        const authorName = String(n.guru_name || n.guruName || '').trim();
                        const isHomeroomAuthor = Boolean(
                            (currentUid && authorUid && currentUid === authorUid) ||
                            (teacherName && authorName && authorName.toLowerCase() === teacherName)
                        );

                        list.push({
                            id: noteId,
                            date: normDate || n.date || '',
                            source: 'guru_wali',
                            role: isHomeroomAuthor ? 'Wali Kelas' : 'Guru Wali',
                            counselor: authorName || (isHomeroomAuthor ? 'Wali Kelas' : 'Guru Wali'),
                            category: n.category || 'Pembinaan Karakter',
                            title: n.title || 'Catatan Pembinaan',
                            notes: n.notes || n.content || '-',
                            followUp: n.follow_up || n.followUp || ''
                        });
                    });
                } else {
                    // Response dari bk_actions (dukung properti camelCase & snake_case)
                    res.value.forEach(b => {
                        const actionId = String(b.id || `${b.student_nis || b.studentNIS}_${b.date}`);
                        if (seenIds.has(actionId)) return;
                        seenIds.add(actionId);

                        const normDate = normalizeDateStr(b.date || b.created_at);
                        if (startDateIso && normDate && normDate < startDateIso) return;
                        if (endDateIso && normDate && normDate > endDateIso) return;

                        const counselorName = b.counselorName || b.counselor_name || b.guruBkName || b.createdByName || 'Guru BK';
                        const serviceType = b.serviceType || b.service_type || 'Konseling';
                        const bimbinganType = b.bimbinganType || b.bimbingan_type || 'Pribadi';
                        const problemStr = b.problem ? `Permasalahan: ${b.problem}` : '';
                        const notesStr = b.notes || b.tindakan || b.content || '';
                        const fullNotes = [problemStr, notesStr ? `Tindakan/Catatan: ${notesStr}` : ''].filter(Boolean).join(' | ');

                        list.push({
                            id: actionId,
                            date: normDate || b.date || '',
                            source: 'bk',
                            role: 'Bimbingan Konseling (BK)',
                            counselor: counselorName,
                            category: `Layanan BK: ${serviceType} (${bimbinganType})`,
                            title: serviceType,
                            notes: fullNotes || 'Layanan konseling bimbingan siswa',
                            followUp: b.status ? `Status: ${b.status}` : ''
                        });
                    });
                }
            });
        } catch (err) {
            console.warn('[fetchStudentPembinaanHistory] Gagal mengambil riwayat pembinaan dari D1:', err);
        }
    }

    // Urutkan catatan dari terlama ke terbaru (kronologis) untuk lembar rapor dinas
    list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    return list;
};

// =====================================
// GLOBAL TEACHERS CACHE (HEMAT KUOTA READ)
// =====================================
// Cache menggunakan metadata timestamp untuk invalidasi
// Hanya refresh jika ada perubahan data di server (lastUpdateTeachers)

let TEACHERS_CACHE = null;
let TEACHERS_CACHE_SERVER_TS = null;
let _teachersInFlightPromise = null;

const TEACHERS_CACHE_KEY = 'cache_teachers_global';
const TEACHERS_CACHE_TS_KEY = 'cache_teachers_global_ts';

/**
 * Ambil data guru dari cache (memory → IndexedDB → localStorage → Firestore)
 * @param {boolean} forceRefresh - Paksa refresh dari Firestore
 * @returns {Promise<Array>} - Array of teacher objects
 */
window.getTeachersCache = async function (forceRefresh = false) {
    if (!forceRefresh && _teachersInFlightPromise) {
        return _teachersInFlightPromise;
    }

    _teachersInFlightPromise = (async () => {
        try {
            // 1. Ambil timestamp metadata dari Cloudflare D1 (0 Firestore Read)
            const meta = await getServerMetadata(forceRefresh);
            const serverTime = meta.teachersTs || 0;

            // 2. Cek cache di memory
            if (!forceRefresh && TEACHERS_CACHE && TEACHERS_CACHE.length > 0 && TEACHERS_CACHE_SERVER_TS === serverTime) {
                console.log('[Cache] Using memory cache (' + TEACHERS_CACHE.length + ' teachers)');
                return TEACHERS_CACHE;
            }

        // 3. Cek IndexedDB
        if (!forceRefresh) {
            const idbMeta = await SimasDB.getMeta('teachers_ts');
            if ((serverTime > 0 && idbMeta && String(idbMeta.ts) === String(serverTime)) || (serverTime <= 0)) {
                const idbData = await SimasDB.getAll('teachers');
                if (idbData && idbData.length > 0) {
                    console.log('[Cache] Using IndexedDB cache (' + idbData.length + ' teachers, metadata valid)');
                    TEACHERS_CACHE = idbData;
                    TEACHERS_CACHE_SERVER_TS = serverTime || (idbMeta?.ts || Date.now());
                    return TEACHERS_CACHE;
                }
            }
        }

        // 4. Fallback cek localStorage
        const localTs = localStorage.getItem(TEACHERS_CACHE_TS_KEY);
        const localData = localStorage.getItem(TEACHERS_CACHE_KEY);

        if (!forceRefresh && ((serverTime > 0 && localTs && String(serverTime) === String(localTs)) || (serverTime <= 0 && localData)) && localData) {
            console.log('[Cache] Using localStorage cache for teachers (metadata valid)');
            TEACHERS_CACHE = JSON.parse(localData);
            TEACHERS_CACHE_SERVER_TS = serverTime || (Number(localTs) || Date.now());
            SimasDB.saveAll('teachers', TEACHERS_CACHE, TEACHERS_CACHE_SERVER_TS);
            return TEACHERS_CACHE;
        }

        // 5. Fetch dari Cloudflare D1 (Pure SSOT - 0 Firestore Read)
        console.log('[Cache] Fetching teachers from Cloudflare D1 SSOT...');
        let teachersData = [];
        if (typeof cfClient !== 'undefined' && cfClient.getTeachers) {
            teachersData = await cfClient.getTeachers({ status: 'all' });
        } else {
            const resp = await fetch("https://simas-demo-api.komangpurna1.workers.dev/api/teachers");
            const json = await resp.json();
            teachersData = json.data || [];
        }

        TEACHERS_CACHE = (teachersData || []).map(d => ({
            id: d.id || d.nik || d.nip,
            ...d
        }));
        TEACHERS_CACHE_SERVER_TS = serverTime || Date.now();

        // 6. Simpan ke IndexedDB & localStorage
        await SimasDB.saveAll('teachers', TEACHERS_CACHE, TEACHERS_CACHE_SERVER_TS);
        try {
            localStorage.setItem(TEACHERS_CACHE_KEY, JSON.stringify(TEACHERS_CACHE));
            localStorage.setItem(TEACHERS_CACHE_TS_KEY, String(TEACHERS_CACHE_SERVER_TS));
        } catch (e) {
            console.warn('[Cache] localStorage skipped for teachers (handled by IndexedDB):', e);
        }

        console.log('[Cache] Cached ' + TEACHERS_CACHE.length + ' teachers to IndexedDB');
        return TEACHERS_CACHE;

    } catch (e) {
        console.error('[Cache] Error loading teachers:', e);
        // Fallback ke IndexedDB jika offline/error
        const idbData = await SimasDB.getAll('teachers');
        if (idbData && idbData.length > 0) {
            console.log('[Cache] Fallback to IndexedDB teachers (offline)');
            TEACHERS_CACHE = idbData;
            return TEACHERS_CACHE;
        }
        if (TEACHERS_CACHE) return TEACHERS_CACHE;

        const localData = localStorage.getItem(TEACHERS_CACHE_KEY);
        if (localData) {
            TEACHERS_CACHE = JSON.parse(localData);
            return TEACHERS_CACHE;
        }
        return [];
    } finally {
        _teachersInFlightPromise = null;
    }
    })();

    return _teachersInFlightPromise;
};

/**
 * Invalidasi cache teachers (dipanggil saat admin tambah/edit/hapus guru)
 */
window.invalidateTeachersCache = function () {
    TEACHERS_CACHE = null;
    TEACHERS_CACHE_SERVER_TS = null;
    TEACHERS_MAP_CACHE = null;
    _teachersInFlightPromise = null;
    SimasDB.clear('teachers');
    localStorage.removeItem(TEACHERS_CACHE_KEY);
    localStorage.removeItem(TEACHERS_CACHE_TS_KEY);
    try {
        sessionStorage.removeItem('simas_teachers_map');
        Object.keys(sessionStorage).forEach(k => {
            if (k.startsWith('simas_teacher_')) sessionStorage.removeItem(k);
        });
    } catch (_) {}
    if (typeof CURRENT_USER_TEACHER_CACHE !== 'undefined' && CURRENT_USER_TEACHER_CACHE.clear) {
        CURRENT_USER_TEACHER_CACHE.clear();
    }
    if (typeof window.invalidateBkTeachersCache === 'function') {
        window.invalidateBkTeachersCache();
    }
    console.log('[Cache] Teachers cache invalidated (IndexedDB, LocalStorage, SessionStorage & Memory)');
};

/**
 * Ambil data teachers/GTK dari memory cache secara sinkron (non-async)
 * Berguna untuk formatter/helper sinkron seperti getUserNameByUid
 */
window.getTeachersCacheSync = function () {
    if (TEACHERS_CACHE && Array.isArray(TEACHERS_CACHE) && TEACHERS_CACHE.length > 0) {
        return TEACHERS_CACHE;
    }
    try {
        const localData = localStorage.getItem(TEACHERS_CACHE_KEY);
        if (localData) {
            TEACHERS_CACHE = JSON.parse(localData);
            return TEACHERS_CACHE || [];
        }
    } catch (e) {}
    return [];
};

// Aliases GTK
window.getGtkCache = window.getTeachersCache;
window.getGtkMapCache = window.getTeachersMapCache;
window.getGtkCacheSync = window.getTeachersCacheSync;
window.invalidateGtkCache = window.invalidateTeachersCache;

// Cache Guru BK SSOT
const BK_TEACHERS_GLOBAL_CACHE_KEY = 'simas_bk_teachers_cache';
const BK_TEACHERS_GLOBAL_CACHE_TTL = 30 * 60 * 1000; // 30 menit TTL
let BK_TEACHERS_GLOBAL_CACHE = null;
let BK_TEACHERS_GLOBAL_CACHE_TS = 0;

/**
 * Ambil daftar seluruh Guru BK riil dari SSOT (users role guru_bk / additionalRoles guru_bk & master teachers)
 * @param {boolean} forceRefresh - Paksa refresh dari Firestore
 * @returns {Promise<Array>} - Array of real BK teacher objects: [{ id, uid, name, nip, jabatan, email, role: 'guru_bk' }]
 */
window.getBkTeachersCache = async function (forceRefresh = false) {
    try {
        const now = Date.now();
        if (!forceRefresh && BK_TEACHERS_GLOBAL_CACHE && BK_TEACHERS_GLOBAL_CACHE.length > 0 && (now - BK_TEACHERS_GLOBAL_CACHE_TS < BK_TEACHERS_GLOBAL_CACHE_TTL)) {
            return BK_TEACHERS_GLOBAL_CACHE;
        }

        if (!forceRefresh) {
            const cachedStr = localStorage.getItem(BK_TEACHERS_GLOBAL_CACHE_KEY);
            const cachedTsStr = localStorage.getItem(BK_TEACHERS_GLOBAL_CACHE_KEY + '_ts');
            if (cachedStr && cachedTsStr) {
                const cachedTs = parseInt(cachedTsStr, 10);
                if (now - cachedTs < BK_TEACHERS_GLOBAL_CACHE_TTL) {
                    try {
                        const parsed = JSON.parse(cachedStr);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            BK_TEACHERS_GLOBAL_CACHE = parsed;
                            BK_TEACHERS_GLOBAL_CACHE_TS = cachedTs;
                            return BK_TEACHERS_GLOBAL_CACHE;
                        }
                    } catch (e) {}
                }
            }
        }

        // Master teachers dari SSOT
        let masterTeachers = [];
        if (typeof window.getTeachersCache === 'function') {
            masterTeachers = await window.getTeachersCache(forceRefresh);
        }
        if (!Array.isArray(masterTeachers)) masterTeachers = [];

        const bkMap = new Map();

        // 1. Query user dengan primary role guru_bk
        try {
            const q1 = query(collection(db, PATHS.users), where('role', '==', 'guru_bk'));
            const snap1 = await getDocs(q1);
            snap1.forEach(docSnap => {
                const u = docSnap.data();
                if (u && (u.name || u.nama || docSnap.id)) {
                    const uName = (u.name || u.nama || u.displayName || '').trim();
                    const uId = docSnap.id;
                    const linkedId = u.linkedTeacherId || uId;
                    bkMap.set(linkedId, {
                        id: linkedId,
                        uid: uId,
                        name: uName,
                        nip: u.nip || '',
                        email: u.email || '',
                        jabatan: 'Guru BK',
                        role: 'guru_bk'
                    });
                }
            });
        } catch (errQ1) {
            console.warn('[GlobalCache] Gagal query users role guru_bk:', errQ1);
        }

        // 2. Query user dengan additionalRoles array-contains guru_bk
        try {
            const q2 = query(collection(db, PATHS.users), where('additionalRoles', 'array-contains', 'guru_bk'));
            const snap2 = await getDocs(q2);
            snap2.forEach(docSnap => {
                const u = docSnap.data();
                if (u && (u.name || u.nama || docSnap.id)) {
                    const uName = (u.name || u.nama || u.displayName || '').trim();
                    const uId = docSnap.id;
                    const linkedId = u.linkedTeacherId || uId;
                    if (!bkMap.has(linkedId)) {
                        bkMap.set(linkedId, {
                            id: linkedId,
                            uid: uId,
                            name: uName,
                            nip: u.nip || '',
                            email: u.email || '',
                            jabatan: 'Guru BK',
                            role: 'guru_bk'
                        });
                    }
                }
            });
        } catch (errQ2) {
            console.warn('[GlobalCache] Gagal query users additionalRoles guru_bk:', errQ2);
        }

        // 3. Fallback: Cek data master teachers jika jabatan / nama mengandung BK
        masterTeachers.forEach(g => {
            if (!g || !g.name) return;
            const jab = (g.jabatan || '').toLowerCase();
            const nm = (g.name || '').toLowerCase();
            if (jab.includes('bk') || jab.includes('bimbingan') || jab.includes('konseling') || nm.includes('guru bk')) {
                if (!bkMap.has(g.id)) {
                    bkMap.set(g.id, {
                        id: g.id,
                        uid: g.id,
                        name: g.name,
                        nip: g.nip || '',
                        email: g.email || '',
                        jabatan: g.jabatan || 'Guru BK',
                        role: 'guru_bk'
                    });
                }
            }
        });

        // 4. Sinkronisasi nama resmi dengan master teachers
        const normalize = (n) => (n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const finalBkList = Array.from(bkMap.values()).map(bk => {
            const matchedTeacher = masterTeachers.find(t => t.id === bk.id || (t.name && normalize(t.name) === normalize(bk.name)));
            if (matchedTeacher) {
                return {
                    id: matchedTeacher.id,
                    uid: bk.uid || matchedTeacher.id,
                    name: matchedTeacher.name || bk.name,
                    nip: matchedTeacher.nip || bk.nip || '',
                    email: matchedTeacher.email || bk.email || '',
                    jabatan: matchedTeacher.jabatan || 'Guru BK',
                    role: 'guru_bk'
                };
            }
            return bk;
        }).filter(bk => bk.name && bk.name.trim().length > 0);

        BK_TEACHERS_GLOBAL_CACHE = finalBkList;
        BK_TEACHERS_GLOBAL_CACHE_TS = now;

        try {
            localStorage.setItem(BK_TEACHERS_GLOBAL_CACHE_KEY, JSON.stringify(finalBkList));
            localStorage.setItem(BK_TEACHERS_GLOBAL_CACHE_KEY + '_ts', now.toString());
        } catch (e) {}

        console.log(`[GlobalCache] Loaded ${finalBkList.length} real Guru BK from SSOT`);
        return finalBkList;
    } catch (e) {
        console.error('[GlobalCache] Error getBkTeachersCache:', e);
        return BK_TEACHERS_GLOBAL_CACHE || [];
    }
};

/**
 * Invalidasi cache Guru BK
 */
window.invalidateBkTeachersCache = function () {
    BK_TEACHERS_GLOBAL_CACHE = null;
    BK_TEACHERS_GLOBAL_CACHE_TS = 0;
    localStorage.removeItem(BK_TEACHERS_GLOBAL_CACHE_KEY);
    localStorage.removeItem(BK_TEACHERS_GLOBAL_CACHE_KEY + '_ts');
};

// --- KEYBOARD SHORTCUTS ---
window.keyboardShortcuts = {
    enabled: true,
    shortcuts: {
        '/': { action: () => window.focusSidebarMenuSearch && window.focusSidebarMenuSearch(), description: 'Cari Menu (atau Ctrl+K)' },
        'd': { action: () => window.location.href = 'dashboard.html', description: 'Dashboard' },
        'i': { action: () => window.location.href = 'input.html', description: 'Input Catatan' },
        's': { action: () => window.location.href = 'siswa.html', description: 'Data Siswa' },
        'g': { action: () => window.location.href = 'gtk.html', description: 'Data GTK' },
        't': { action: () => window.toggleDarkMode(), description: 'Toggle Dark Mode' },
        '?': { action: () => window.showKeyboardHelp(), description: 'Tampilkan Bantuan' },
        'Escape': { action: () => window.closeAllModals(), description: 'Tutup Modal' }
    }
};

// Listen for keyboard events
document.addEventListener('keydown', (e) => {
    // Skip if typing in input/textarea or shortcuts disabled
    if (!window.keyboardShortcuts.enabled) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const shortcut = window.keyboardShortcuts.shortcuts[e.key];
    if (shortcut) {
        e.preventDefault();
        shortcut.action();
    }
});

// Show keyboard shortcuts help
window.showKeyboardHelp = function () {
    const shortcuts = window.keyboardShortcuts.shortcuts;
    let html = '';
    for (const [key, config] of Object.entries(shortcuts)) {
        html += `
            <div class="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
                <span class="text-slate-600 dark:text-slate-300">${config.description}</span>
                <kbd class="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded text-xs font-mono font-bold text-slate-700 dark:text-slate-200">${key}</kbd>
            </div>
        `;
    }

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'keyboard-help-modal';
    modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = `
        <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden transform animate-scale-in">
            <div class="p-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white">
                <h3 class="font-bold flex items-center gap-2">
                    <i class="fa-solid fa-keyboard"></i> Keyboard Shortcuts
                </h3>
            </div>
            <div class="p-4 max-h-80 overflow-y-auto">
                ${html}
            </div>
            <div class="p-4 border-t border-slate-100 dark:border-slate-700 text-center">
                <button onclick="this.closest('#keyboard-help-modal').remove()" class="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg text-sm font-medium transition">
                    Tutup
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
};

// Close all modals
window.closeAllModals = function () {
    document.querySelectorAll('[id*="modal"]').forEach(modal => {
        if (modal.classList.contains('hidden') === false) {
            modal.classList.add('hidden');
        }
    });
    document.getElementById('keyboard-help-modal')?.remove();
};

// Add scale-in animation
const shortcutStyle = document.createElement('style');
shortcutStyle.textContent = `
    @keyframes scale-in { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    .animate-scale-in { animation: scale-in 0.2s ease-out forwards; }
    @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
    .animate-fade-in { animation: fade-in 0.2s ease-out forwards; }
`;
document.head.appendChild(shortcutStyle);

// --- OFFLINE MODE DETECTION ---
window.networkStatus = {
    isOnline: navigator.onLine,
    banner: null,

    init: function () {
        // Create offline banner
        this.banner = document.createElement('div');
        this.banner.id = 'offline-banner';
        this.banner.className = 'fixed top-0 left-0 right-0 z-[10000] bg-gradient-to-r from-red-600 to-red-500 text-white text-center py-2.5 px-4 transform -translate-y-full transition-transform duration-300 ease-out shadow-lg';
        this.banner.innerHTML = `
            <div class="flex items-center justify-center gap-2 text-sm font-medium">
                <i class="fa-solid fa-wifi-slash animate-pulse"></i>
                <span>Anda sedang offline. Beberapa fitur mungkin tidak tersedia.</span>
                <button onclick="window.networkStatus.hideBanner()" aria-label="Tutup pemberitahuan offline" class="relative ml-2 hover:bg-white/20 rounded-full p-1 transition before:absolute before:-inset-3.5">
                    <i class="fa-solid fa-times text-xs"></i>
                </button>
            </div>
        `;
        document.body.appendChild(this.banner);

        // Initial check
        if (!navigator.onLine) {
            this.showBanner();
        }

        // Event listeners
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());

        console.log('[PWA] Network status initialized. Online:', navigator.onLine);
    },

    handleOnline: function () {
        this.isOnline = true;
        this.hideBanner();
        window.showToast('Koneksi Pulih', 'Anda kembali online!', 'success', 3000);
        console.log('[PWA] Back online');
    },

    handleOffline: function () {
        this.isOnline = false;
        this.showBanner();
        window.showToast('Tidak Ada Koneksi', 'Anda sedang offline. Data mungkin tidak sinkron.', 'warning', 5000);
        console.log('[PWA] Went offline');
    },

    showBanner: function () {
        if (this.banner) {
            this.banner.classList.remove('-translate-y-full');
            this.banner.classList.add('translate-y-0');
            // Adjust body padding
            document.body.style.paddingTop = '44px';
        }
    },

    hideBanner: function () {
        if (this.banner) {
            this.banner.classList.add('-translate-y-full');
            this.banner.classList.remove('translate-y-0');
            document.body.style.paddingTop = '';
        }
    }
};

// Initialize network status on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.networkStatus.init());
} else {
    window.networkStatus.init();
}

// Export for module usage
export const networkStatus = window.networkStatus;

// --- AUTO LOGOUT (IDLE TIMEOUT) CONSOLIDATED ---
// Logika auto-logout telah disatukan di fungsi initAutoLogout di atas (SSOT).

// --- DYNAMIC INJECTION FOR FEEDBACK CHAT ICON (POPUP MODAL) ---
// --- DYNAMIC INJECTION FOR FEEDBACK CHAT ICON (POPUP MODAL) ---
function injectChatIcon() {
    // Halaman masukan tidak membutuhkan tombol chat feedback ini
    if (window.location.pathname.includes('masukan') || document.getElementById('feedback-modal')) return;

    // 1. Injeksi di Mobile Top Nav (di sebelah tombol menu/burger)
    const mobileNav = document.querySelector('nav.md\\:hidden');
    if (mobileNav) {
        const menuBtn = mobileNav.querySelector('button');
        if (menuBtn && !document.getElementById('mobile-chat-feedback-btn')) {
            const chatBtn = document.createElement('button');
            chatBtn.id = 'mobile-chat-feedback-btn';
            chatBtn.onclick = (e) => { e.preventDefault(); window.openGlobalFeedbackModal(); };
            chatBtn.className = 'text-white hover:text-blue-300 active:scale-95 transition-all mr-2 flex items-center gap-1 shrink-0 text-xs font-semibold';
            chatBtn.style.cssText = 'color: #ffffff !important;';
            chatBtn.innerHTML = '<i class="fa-solid fa-comment-dots text-sm" style="color: #ffffff !important;"></i><span class="text-xs font-bold" style="color: #ffffff !important;">Saran</span>';
            menuBtn.parentNode.insertBefore(chatBtn, menuBtn);
        }
    }

    if (document.getElementById('btn-global-chat-feedback')) return;

    // 2. Injeksi di .premium-header (untuk halaman yang memilikinya)
    const premiumHeader = document.querySelector('.premium-header');
    if (premiumHeader) {
        let container = premiumHeader.querySelector('#header-actions-container, .relative.z-10.flex, .mt-4, .mt-3, .relative.z-10.flex-row');
        if (!container) {
            const children = Array.from(premiumHeader.children).filter(c => !c.classList.contains('absolute'));
            if (children.length >= 2) {
                container = children[children.length - 1];
            } else {
                container = premiumHeader;
            }
        }
        if (container && container.querySelector && container.querySelector('#header-actions-container')) {
            container = container.querySelector('#header-actions-container');
        }

        const chatBtn = document.createElement('button');
        chatBtn.id = 'btn-global-chat-feedback';
        chatBtn.onclick = (e) => { e.preventDefault(); window.openGlobalFeedbackModal(); };
        chatBtn.className = 'hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-semibold transition-all shadow-sm shrink-0';
        chatBtn.innerHTML = '<i class="fa-solid fa-comment-dots text-xs"></i><span>Saran</span>';
        
        if (container !== premiumHeader && !container.classList.contains('flex')) {
            container.classList.add('flex', 'items-center', 'gap-2');
        }
        
        container.appendChild(chatBtn);
        return;
    }

    // 3. Jika tidak ada .premium-header, cari h1 pertama di dalam main
    const firstH1 = document.querySelector('main h1, main .text-2xl.font-bold');
    if (firstH1) {
        let headerRow = firstH1.closest('.flex');
        if (headerRow === firstH1) {
            headerRow = firstH1.parentElement?.closest('.flex') || firstH1.parentElement;
        }
        if (headerRow) {
            const chatBtn = document.createElement('button');
            chatBtn.id = 'btn-global-chat-feedback';
            chatBtn.onclick = (e) => { e.preventDefault(); window.openGlobalFeedbackModal(); };
            chatBtn.className = 'hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-all shadow-sm ml-3 shrink-0 text-xs font-semibold';
            chatBtn.innerHTML = '<i class="fa-solid fa-comment-dots text-xs"></i><span>Saran</span>';
            headerRow.appendChild(chatBtn);
        }
    }
}

// --- POPUP MODAL FEEDBACK UTILITY FUNCTIONS ---
window.openGlobalFeedbackModal = function () {
    let modal = document.getElementById('global-feedback-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'global-feedback-modal';
        modal.className = 'fixed inset-0 z-[100] hidden overflow-y-auto';
        modal.innerHTML = `
            <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onclick="window.closeGlobalFeedbackModal()"></div>
            <div class="flex min-h-full items-center justify-center p-4">
                <div class="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-700 overflow-hidden animate-fade-in-up">
                    <div class="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                        <div class="flex items-center gap-2.5">
                            <div class="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                                <i class="fa-solid fa-comment-dots text-lg"></i>
                            </div>
                            <div>
                                <h3 class="font-extrabold text-slate-800 dark:text-white text-base">Laporkan Kendala / Masukan</h3>
                                <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Sampaikan saran, ide, atau kendala sistem.</p>
                            </div>
                        </div>
                        <button onclick="window.closeGlobalFeedbackModal()" class="w-8 h-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors flex items-center justify-center">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <form id="global-feedback-form" class="p-5 space-y-4">
                        <div>
                            <label for="global-feedback-target" class="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Tujuan Laporan (Ditujukan Kepada)</label>
                            <select id="global-feedback-target" required class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                                <option value="all">Semua Pimpinan / Umum</option>
                                <option value="kepala_sekolah">Kepala Sekolah</option>
                                <option value="wakasek_kurikulum">Wakasek Kurikulum</option>
                                <option value="kesiswaan">Wakasek Kesiswaan</option>
                                <option value="humas">Wakasek Humas</option>
                                <option value="sarpras">Wakasek Sarpras</option>
                                <option value="kepala_lab">Kepala Laboratorium</option>
                                <option value="staff">Tata Usaha / Staff TU</option>
                                <option value="guru">Bapak / Ibu Guru</option>
                                <option value="super_admin">Super Admin / Tim IT</option>
                            </select>
                        </div>
                        <div>
                            <label for="global-feedback-category" class="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Kategori</label>
                            <select id="global-feedback-category" required class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                                <option value="Akademik & Pembelajaran">Akademik & Pembelajaran</option>
                                <option value="Kesiswaan & Kedisiplinan">Kesiswaan & Kedisiplinan</option>
                                <option value="Sarana Prasarana & Laboratorium">Sarana Prasarana & Laboratorium</option>
                                <option value="Pelayanan Tata Usaha & Administrasi">Pelayanan Tata Usaha & Administrasi</option>
                                <option value="Hubungan Masyarakat & Informasi">Hubungan Masyarakat & Informasi</option>
                                <option value="Sistem Informasi SIMAS & Akun">Sistem Informasi SIMAS & Akun</option>
                                <option value="Saran, Aspirasi & Pengaduan Umum" selected>Saran, Aspirasi & Pengaduan Umum</option>
                            </select>
                        </div>
                        <div>
                            <label for="global-feedback-title" class="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Judul Masukan / Laporan</label>
                            <input id="global-feedback-title" maxlength="120" required placeholder="Ringkasan singkat masukan/laporan" class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                        </div>
                        <div>
                            <label for="global-feedback-message" class="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Isi Masukan / Detail Laporan</label>
                            <textarea id="global-feedback-message" rows="5" maxlength="1200" required placeholder="Tuliskan secara detail apa yang ingin dilaporkan/disampaikan..." class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"></textarea>
                            <div class="flex justify-between items-center mt-1">
                                <span class="text-[10px] text-slate-400 dark:text-slate-500 italic truncate max-w-[70%]">Halaman: ${window.location.pathname.split('/').pop() || 'index.html'}</span>
                                <span id="global-feedback-char-count" class="text-[10px] font-bold text-slate-400">0/1200</span>
                            </div>
                        </div>
                        <button id="btn-submit-global-feedback" type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3 font-extrabold text-sm shadow-lg shadow-blue-600/20 transition-all active:scale-[0.99] flex items-center justify-center gap-2">
                            <i class="fa-solid fa-paper-plane"></i>
                            <span>Kirim Laporan</span>
                        </button>
                    </form>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Pasang event listener character counter
        const messageEl = document.getElementById('global-feedback-message');
        const counterEl = document.getElementById('global-feedback-char-count');
        if (messageEl && counterEl) {
            messageEl.addEventListener('input', () => {
                counterEl.textContent = `${messageEl.value.length}/1200`;
            });
        }

        // Pasang event listener submit
        const formEl = document.getElementById('global-feedback-form');
        if (formEl) {
            formEl.addEventListener('submit', window.submitGlobalFeedback);
        }
    }

    // Reset form
    document.getElementById('global-feedback-form')?.reset();
    const charCountEl = document.getElementById('global-feedback-char-count');
    if (charCountEl) charCountEl.textContent = '0/1200';

    modal.classList.remove('hidden');
};

window.closeGlobalFeedbackModal = function () {
    document.getElementById('global-feedback-modal')?.classList.add('hidden');
};

window.submitGlobalFeedback = async function (event) {
    event.preventDefault();

    const targetEl = document.getElementById('global-feedback-target');
    const categoryEl = document.getElementById('global-feedback-category');
    const titleEl = document.getElementById('global-feedback-title');
    const messageEl = document.getElementById('global-feedback-message');
    const button = document.getElementById('btn-submit-global-feedback');

    const targetRecipient = targetEl ? targetEl.value.trim() : 'all';
    const category = categoryEl.value.trim();
    const title = titleEl.value.trim();
    const message = messageEl.value.trim();

    if (!title || !message) {
        showToast('Belum lengkap', 'Judul dan isi masukan wajib diisi.', 'warning');
        return;
    }

    const user = auth.currentUser;
    if (!user) {
        showToast('Akses ditolak', 'Anda harus masuk sistem untuk melapor.', 'error');
        return;
    }

    // Ambil user cached data
    const primaryRole = localStorage.getItem('user_role') || 'guru_mapel';
    const allRoles = window.getAllUserRoles ? window.getAllUserRoles() : [primaryRole];
    
    const roleLabels = {
        super_admin: 'Super Admin',
        kepala_sekolah: 'Kepala Sekolah',
        wakasek_kurikulum: 'Wakasek Kurikulum',
        kepala_lab: 'Kepala Lab',
        kesiswaan: 'Wakasek Kesiswaan',
        admin_spp: 'Admin SPP',
        staff: 'Staff',
        wali_kelas: 'Wali Kelas',
        guru_mapel: 'Guru Mapel',
        guru_bk: 'Guru BK',
        admin_pks: 'Admin PKS',
        admin_kelas: 'Admin Kelas',
        siswa: 'Siswa',
        admin_sukaduka: 'Admin Suka-Duka',
        admin_duta: "Admin Duta CERDAS",
        admin_lks: 'Admin LKS'
    };
    const roleText = allRoles.map(r => roleLabels[r] || r).join(', ') || '-';

    const cachedName = localStorage.getItem(`cached_user_name_${user.uid}`);
    const name = cachedName || user.displayName || user.email?.split('@')[0] || 'Pengguna';

    const sourceUrl = window.location.href;
    const createdAtLocal = new Date();

    try {
        if (button) {
            button.dataset.originalHtml = button.innerHTML;
            button.disabled = true;
            button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Mengirim...</span>`;
        }

        // 1. Simpan ke Supabase masukkan_saran via Edge Function Secure Proxy
        await callSecureEdgeFunction('submit-feedback', {
            category: category,
            title: title,
            message: message,
            target_recipient: targetRecipient,
            reporter_type: primaryRole === 'siswa' ? 'siswa' : 'guru_staf',
            contact_info: user.email || '',
            sender_name: name,
            sender_email: user.email || '',
            sender_role: primaryRole,
            sender_roles: allRoles,
            source_url: sourceUrl
        });

        window.closeGlobalFeedbackModal();
        showToast('Laporan Terkirim', 'Laporan kendala berhasil dikirim ke pimpinan sekolah.', 'success');

        // Jika berada di halaman masukan.html, reload data list secara dinamis!
        if (window.location.pathname.includes('masukan.html') && typeof window.loadFeedback === 'function') {
            await window.loadFeedback();
        }

    } catch (error) {
        console.error('[Global Feedback] Submit failed:', error);
        showToast('Gagal mengirim', error.message || 'Laporan kendala gagal dikirim.', 'error');
    } finally {
        if (button) {
            button.disabled = false;
            if (button.dataset.originalHtml) {
                button.innerHTML = button.dataset.originalHtml;
            }
        }
    }
};

// --- HELPER: Panggil Supabase Edge Function Aman (100% Gratis & Kriptografis) ---
window.callSecureEdgeFunction = async function (action, payload) {
    const user = auth.currentUser;
    if (!user) {
        throw new Error("Anda harus masuk sistem terlebih dahulu.");
    }
    
    // Dapatkan token Firebase ID dari memori lokal (0ms).
    // Hanya force refresh ke Google STS jika sesi kedaluwarsa (401) atau saat retry.
    let token = await user.getIdToken(false);
    const maxRetries = 2;
    let lastError = null;
    let response = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                const delay = (attempt * 250) + Math.floor(Math.random() * 80);
                await new Promise(r => setTimeout(r, delay));
                try {
                    token = await user.getIdToken(true);
                } catch (tErr) {
                    console.warn('[callSecureEdgeFunction] Gagal force refresh token saat retry:', tErr);
                }
            }

            response = await fetch(`${SUPABASE_URL}/functions/v1/secure-proxy`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
                    "apikey": SUPABASE_ANON_KEY,
                    "x-firebase-token": token
                },
                body: JSON.stringify({ action, payload })
            });

            // Jika token ditolak karena kedaluwarsa di sisi server (401), force refresh sekali dan coba ulang
            if (response.status === 401 && attempt < maxRetries) {
                console.warn(`[callSecureEdgeFunction] Token kedaluwarsa (401) pada action '${action}'. Memperbarui token dan mencoba ulang...`);
                try {
                    token = await user.getIdToken(true);
                    continue;
                } catch (refreshErr) {
                    console.warn('[callSecureEdgeFunction] Gagal memperbarui token:', refreshErr);
                }
            }

            break;
        } catch (fetchErr) {
            lastError = fetchErr;
            if (attempt < maxRetries) {
                console.warn(`[callSecureEdgeFunction] Gangguan jaringan/QUIC pada action '${action}' (${fetchErr?.message || fetchErr}). Mencoba ulang (${attempt + 1}/${maxRetries})...`);
            }
        }
    }

    if (!response) {
        throw lastError || new Error("Gagal menghubungi server proxy.");
    }
    
    const responseText = await response.text();
    let result = {};
    try {
        result = JSON.parse(responseText);
    } catch (e) {
        result = { error: responseText || `HTTP error! status: ${response.status}` };
    }
    
    if (!response.ok) {
        const errorMsg = typeof result.error === 'object'
            ? (result.error.message || JSON.stringify(result.error))
            : (result.error || `HTTP error! status: ${response.status}`);
        throw new Error(errorMsg);
    }
    
    return result;
};

export const callSecureEdgeFunction = window.callSecureEdgeFunction;

// --- REALTIME METADATA LISTENER FOR ZERO READ WASTAGE & INSTANT SYNC ---
let metadataUnsubscribe = null;
let lastKnownMetadata = {};

export function initRealtimeMetadataListener() {
    if (metadataUnsubscribe) return;
    metadataUnsubscribe = () => {};
    // Metadata dikelola secara efisien via Cloudflare D1 system_settings dengan TTL memory cache (0 Firestore Read)
    console.log('🔄 [Metadata Sync] Cloudflare D1 Metadata Mode Active (0 Firestore Read)');
}
window.initRealtimeMetadataListener = initRealtimeMetadataListener;

// --- CENTRALIZED PUSH NOTIFICATION & REALTIME METADATA LISTENER REGISTRATION ---
onAuthStateChanged(auth, (user) => {
    sidebarAuthReady = true;
    if (!user) sidebarResolvedNames.clear();
    if (document.querySelector('#app-layout .user-name-el')) {
        syncSidebarProfile();
        if (user) window.updateSidebarProfileFromDB(user.uid);
    }
    if (!user) window.clearNotificationInboxCache?.();
    if (user) {
        initRealtimeMetadataListener();

        // Jangan jalankan jika siswa menggunakan anonymous auth (Portal Siswa)
        const isAnonymous = user.providerData.length === 0 || user.isAnonymous;
        if (!isAnonymous) {
            // Modul push menunggu SW dengan batas waktu dan menampilkan kegagalan
            // registrasi; jangan sembunyikan setup di balik ready yang tak berbatas.
            setupPushNotifications(user.uid).catch(err => console.error('[Push] Central setup failed:', err));

            // Cek & tampilkan popup Telegram Chat ID jika belum mengisinya (Kecuali admin_kelas, admin_pks, siswa)
            setTimeout(() => {
                checkAndShowTelegramChatIdPrompt(user).catch(err => console.warn('[TelegramPrompt] Failed:', err));
            }, 1500);
        }
    }
});


/**
 * Memeriksa dan menampilkan Popup Form Telegram Chat ID jika pengguna belum mengisinya.
 * Dikecualikan untuk: admin_kelas, admin_pks, dan akun siswa.
 */
export async function checkAndShowTelegramChatIdPrompt(user) {
    if (!user) return;
    const isAnonymous = user.providerData.length === 0 || user.isAnonymous;
    if (isAnonymous) return;

    try {
        // Ambil data User Doc
        const userDocRef = doc(db, PATHS.users, user.uid);
        const userSnap = await getDoc(userDocRef);
        if (!userSnap.exists()) return;

        const userData = userSnap.data();
        const role = String(userData.role || localStorage.getItem('user_role') || '').toLowerCase().trim();
        const additionalRoles = (userData.additionalRoles || []).map(r => String(r).toLowerCase().trim());

        // PENGECUALIAN KETAT: Siswa, admin_kelas, admin_pks
        const excludedRoles = ['admin_kelas', 'admin_pks', 'siswa', 'student'];
        if (excludedRoles.includes(role) || role.includes('siswa') || role.includes('student')) return;
        if (additionalRoles.some(r => excludedRoles.includes(r) || r.includes('siswa') || r.includes('student'))) return;

        // Popup Telegram HANYA untuk akun Guru/Staff (harus terhubung dengan data teachers)
        const teacherObj = await window.getLinkedTeacherForUser(user, userData);
        if (!teacherObj || !teacherObj.id) return;
        const linkedTeacherId = teacherObj.id;
        const teacherChatId = String(teacherObj.data?.telegramChatId || teacherObj.data?.telegram_chat_id || '').trim();
        const fallbackUserChatId = String(userData.telegramChatId || '').trim();

        // D1 GTK adalah sumber utama pengiriman notifikasi. Nilai cadangan di users
        // dipakai untuk mengisi form, tetapi tidak boleh menyamarkan kegagalan simpan D1.
        if (teacherChatId) return;

        // Cek Snooze 24 jam jika pengguna pernah menekan "Nanti Saja"
        const snoozeKey = `hide_telegram_prompt_time_${user.uid}`;
        const lastDismissed = localStorage.getItem(snoozeKey);
        if (lastDismissed) {
            const elapsedDays = (Date.now() - parseInt(lastDismissed, 10)) / (1000 * 60 * 60 * 24);
            if (elapsedDays < 1) return; // Mengingatkan kembali setelah 1 hari (24 jam)
        }

        // Buka Popup Form untuk Guru/Staff
        showTelegramChatIdModal(user.uid, linkedTeacherId, fallbackUserChatId);
    } catch (e) {
        console.warn('[TelegramPrompt] Warning:', e);
    }
}

/**
 * Menampilkan Modal Form Telegram Chat ID yang Elegan
 */
export function showTelegramChatIdModal(uid, linkedTeacherId, initialChatId = '') {
    let modal = document.getElementById('modal-telegram-prompt');
    if (modal) {
        modal.dataset.promptUid = String(uid || '');
        modal.dataset.linkedTeacherId = String(linkedTeacherId || '');
        const existingInput = modal.querySelector('#prompt-telegram-chat-id');
        if (existingInput && !existingInput.value) existingInput.value = String(initialChatId || '');
        modal.classList.remove('hidden');
        return;
    }

    modal = document.createElement('div');
    modal.id = 'modal-telegram-prompt';
    modal.className = 'fixed inset-0 z-[9999] bg-slate-900/70 dark:bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in';
    modal.onclick = (e) => { if (e.target === modal) window.closeTelegramPromptModal(); };

    const tgBotUser = window.SCHOOL_CONFIG?.telegramBotUser || "simas_demo_bot";
    modal.innerHTML = `
        <div class="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md p-0 overflow-hidden border border-slate-200 dark:border-slate-800 transform transition-all" onclick="event.stopPropagation()">
            <div class="bg-gradient-to-r from-sky-600 to-blue-600 p-6 text-white text-center relative overflow-hidden">
                <div class="absolute -right-6 -bottom-6 w-24 h-24 bg-white/10 rounded-full blur-xl"></div>
                <div class="w-14 h-14 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mx-auto mb-3 border border-white/30 shadow-lg">
                    <i class="fa-brands fa-telegram text-3xl text-white animate-bounce"></i>
                </div>
                <h3 class="font-black text-lg text-white">Lengkapi Telegram Chat ID</h3>
                <p class="text-xs text-sky-100 mt-1 max-w-xs mx-auto">Dapatkan notifikasi sekolah (pelanggaran, permisi, presensi & agenda) langsung di Telegram HP Anda.</p>
            </div>
            
            <div class="p-6 space-y-4">
                <div class="bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/50 rounded-2xl p-4 flex items-center justify-between gap-3">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                            <i class="fa-solid fa-robot text-lg"></i>
                        </div>
                        <div>
                            <p class="text-xs font-bold text-slate-800 dark:text-white">Langkah 1: Cek Chat ID</p>
                            <p class="text-[11px] text-slate-500 dark:text-slate-400">Buka bot <span class="font-semibold text-sky-600 dark:text-sky-400">@${tgBotUser}</span></p>
                        </div>
                    </div>
                    <a href="https://t.me/${tgBotUser}" target="_blank" rel="noopener noreferrer" class="px-3 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition shadow-sm shrink-0 flex items-center gap-1">
                        <i class="fa-brands fa-telegram"></i> Buka Bot
                    </a>
                </div>

                <div>
                    <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1">Langkah 2: Tempelkan Chat ID Anda</label>
                    <div class="relative">
                        <input type="text" id="prompt-telegram-chat-id" inputmode="numeric" autocomplete="off" placeholder="Contoh: 198160734" class="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm font-bold font-mono text-slate-800 dark:text-white transition-all shadow-sm">
                    </div>
                    <p class="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Salin angka Chat ID yang diberikan oleh @${tgBotUser} (siap 1-tap copy).</p>
                </div>
            </div>

            <div class="p-5 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3">
                <button onclick="window.closeTelegramPromptModal(true)" class="px-4 py-2.5 rounded-xl font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition text-xs">
                    Nanti Saja
                </button>
                <button type="button" id="btn-save-telegram-prompt" class="px-5 py-2.5 rounded-xl font-bold text-white bg-sky-600 hover:bg-sky-700 transition shadow-md active:scale-95 text-xs flex items-center gap-2">
                    <i class="fa-solid fa-check"></i> Simpan Chat ID
                </button>
            </div>
        </div>
    `;

    modal.dataset.promptUid = String(uid || '');
    modal.dataset.linkedTeacherId = String(linkedTeacherId || '');
    document.body.appendChild(modal);
    const input = modal.querySelector('#prompt-telegram-chat-id');
    const saveButton = modal.querySelector('#btn-save-telegram-prompt');
    if (input) {
        input.value = String(initialChatId || '');
        input.addEventListener('input', () => {
            if (modal.dataset.verifiedChatId !== input.value.trim()) {
                delete modal.dataset.verifiedChatId;
            }
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                window.saveTelegramChatIdFromPrompt();
            }
        });
        setTimeout(() => input.focus(), 0);
    }
    if (saveButton) saveButton.addEventListener('click', () => window.saveTelegramChatIdFromPrompt());
}

window.closeTelegramPromptModal = function (snooze = false) {
    const modal = document.getElementById('modal-telegram-prompt');
    const promptUid = modal?.dataset?.promptUid || auth.currentUser?.uid || '';
    if (modal) modal.remove();
    if (snooze && promptUid) {
        localStorage.setItem(`hide_telegram_prompt_time_${promptUid}`, Date.now().toString());
    }
};

/**
 * Verifikasi instan ke Telegram Bot API apakah Chat ID valid dan aktif
 */
export async function verifyTelegramChatId(chatId, userName = "Pengguna") {
    const cleanChatId = (chatId || '').trim();
    if (!cleanChatId) return { valid: false, message: "Chat ID tidak boleh kosong." };

    if (!/^-?\d{5,19}$/.test(cleanChatId)) {
        return { valid: false, message: "Format Chat ID harus berupa angka (contoh: 198160734)." };
    }

    let displayNameToUse = (userName || "").trim();

    // Resolusi Nama Asli jika nama berupa email (@), username tanpa spasi, atau generic "Pengguna"
    if (!displayNameToUse || displayNameToUse === "Pengguna" || displayNameToUse.includes("@")) {
        const currentUser = auth.currentUser;
        if (currentUser) {
            try {
                const uSnap = await getDoc(doc(db, PATHS.users, currentUser.uid));
                if (uSnap.exists() && uSnap.data().name) {
                    displayNameToUse = uSnap.data().name;
                } else if (currentUser.email) {
                    const tMap = await window.getTeachersMapCache();
                    const tFound = tMap.get(currentUser.email.toLowerCase().trim());
                    if (tFound?.name) {
                        displayNameToUse = tFound.name;
                    }
                }
            } catch (e) {
                console.warn("Gagal resolve nama asli untuk Telegram:", e);
            }
        }
    }

    if (!displayNameToUse || displayNameToUse.includes("@")) {
        displayNameToUse = "Pengguna";
    }

    // Verifikasi melalui Cloudflare Worker; bot token tetap menjadi secret server.
    try {
        const result = await cfClient.verifyTelegramChatId(cleanChatId, displayNameToUse);
        return {
            valid: result.valid === true,
            message: result.message || (result.valid ? "Chat ID Valid!" : "Chat ID tidak valid.")
        };
    } catch (err) {
        return { valid: false, message: `Gagal terhubung ke Server Verifikasi Telegram: ${err.message}` };
    }
}

window.verifyTelegramChatId = verifyTelegramChatId;

window.saveTelegramChatIdFromPrompt = async function () {
    const modal = document.getElementById('modal-telegram-prompt');
    const input = document.getElementById('prompt-telegram-chat-id');
    const btn = document.getElementById('btn-save-telegram-prompt');
    const chatId = input ? input.value.trim() : '';
    const user = auth.currentUser;
    const uid = user?.uid || '';
    let linkedTeacherId = modal?.dataset?.linkedTeacherId || '';

    if (!user || !uid || (modal?.dataset?.promptUid && modal.dataset.promptUid !== uid)) {
        showToast("Sesi Berubah", "Silakan muat ulang halaman lalu coba kembali agar Chat ID tersimpan ke akun yang tepat.", "warning", 6000);
        return;
    }

    if (!chatId) {
        showToast("Peringatan", "Silakan masukkan Chat ID Telegram Anda.", "warning");
        return;
    }

    const originalText = btn ? btn.innerHTML : 'Simpan Chat ID';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Memverifikasi...';
    }

    try {
        let userName = "Pengguna";

        if (linkedTeacherId) {
            try {
                if (typeof window.getGtkMapCache === 'function') {
                    const gtkMap = await window.getGtkMapCache();
                    let teacher = null;
                    if (gtkMap instanceof Map) {
                        teacher = gtkMap.get(linkedTeacherId) || Array.from(gtkMap.values()).find(t => t && (t.id === linkedTeacherId || t.nik === linkedTeacherId || t.nip === linkedTeacherId));
                    } else if (gtkMap && typeof gtkMap === 'object') {
                        teacher = gtkMap[linkedTeacherId] || Object.values(gtkMap).find(t => t && (t.id === linkedTeacherId || t.nik === linkedTeacherId || t.nip === linkedTeacherId));
                    }
                    if (teacher && teacher.name) {
                        userName = teacher.name;
                    }
                } else if (typeof cfClient !== 'undefined' && cfClient.getGtkById) {
                    const teacher = await cfClient.getGtkById(linkedTeacherId);
                    if (teacher && teacher.name) {
                        userName = teacher.name;
                    }
                }
            } catch (e) {
                console.warn('[saveTelegramChatIdFromPrompt] Error resolve teacher name:', e);
            }
        }
        if (userName === "Pengguna" && user) {
            try {
                const uSnap = await getDoc(doc(db, PATHS.users, user.uid));
                if (uSnap.exists() && uSnap.data().name) {
                    userName = uSnap.data().name;
                }
            } catch (e) {}
        }
        if (userName === "Pengguna" && user?.displayName && !user.displayName.includes("@")) {
            userName = user.displayName;
        }

        // Verifikasi instan ke Telegram Bot API
        let verifyWarningMsg = "";
        if (modal?.dataset?.verifiedChatId !== chatId) {
            const checkResult = await verifyTelegramChatId(chatId, userName);
            if (!checkResult.valid) {
                // Jangan blokir simpan jika verifikasi bot gagal atau guru belum klik /start!
                // Chat ID tetap disimpan jika format angka valid, beri catatan ramah kepada guru
                verifyWarningMsg = checkResult.message || "Pesan verifikasi bot belum terkirim. Pastikan Anda sudah membuka bot @simas_demo_bot di Telegram dan mengklik START.";
            } else {
                if (modal) modal.dataset.verifiedChatId = chatId;
            }
        }

        if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...';

        let targetTeacherId = linkedTeacherId;
        if (!targetTeacherId && (user?.email || user?.displayName)) {
            const tObj = await window.getLinkedTeacherForUser(user, null);
            if (tObj?.id) targetTeacherId = tObj.id;
        }

        const canSaveToD1 = typeof cfClient !== 'undefined' && typeof cfClient.updateTeacher === 'function';
        const d1Promise = targetTeacherId && canSaveToD1
            ? cfClient.updateTeacher(targetTeacherId, {
                telegram_chat_id: chatId,
                telegramChatId: chatId
            })
            : (targetTeacherId
                ? Promise.reject(new Error("Layanan penyimpanan GTK belum siap. Muat ulang halaman lalu coba kembali."))
                : Promise.resolve(null));
        const usersPromise = setDoc(doc(db, PATHS.users, uid), { telegramChatId: chatId }, { merge: true });
        const [d1Result, usersResult] = await Promise.allSettled([d1Promise, usersPromise]);
        const d1Saved = Boolean(targetTeacherId) && d1Result.status === 'fulfilled';
        const usersSaved = usersResult.status === 'fulfilled';

        if (d1Result.status === 'rejected') {
            console.error('[saveTelegramChatIdFromPrompt] Error updating D1:', d1Result.reason);
        }
        if (usersResult.status === 'rejected') {
            console.warn('[saveTelegramChatIdFromPrompt] Warning merge to users:', usersResult.reason);
        }

        if (!d1Saved && !usersSaved) {
            throw usersResult.reason || d1Result.reason || new Error("Gagal menyimpan ke database. Silakan periksa koneksi.");
        }

        // Segera perbarui cache in-memory & sessionStorage agar popup tidak muncul kembali pada sesi saat ini
        if (user?.email) {
            const email = user.email.toLowerCase();
            if (typeof CURRENT_USER_TEACHER_CACHE !== 'undefined' && CURRENT_USER_TEACHER_CACHE.has(email)) {
                const cached = CURRENT_USER_TEACHER_CACHE.get(email);
                if (cached && cached.data) {
                    cached.data.telegramChatId = chatId;
                    cached.data.telegram_chat_id = chatId;
                }
            }
            try {
                sessionStorage.removeItem('simas_teacher_' + email);
            } catch (_) {}
        }
        try {
            sessionStorage.removeItem('simas_teachers_map');
        } catch (_) {}
        TEACHERS_MAP_CACHE = null;

        try {
            localStorage.removeItem(`hide_telegram_prompt_time_${uid}`);
        } catch (_) {}

        const successMessage = verifyWarningMsg
            ? `Telegram Chat ID berhasil disimpan. Catatan bot: ${verifyWarningMsg}`
            : (usersSaved
                ? "Telegram Chat ID valid dan berhasil disimpan. Pesan verifikasi telah dikirim ke Telegram Anda."
                : "Telegram Chat ID sudah aktif pada data GTK. Sinkronisasi profil cadangan akan dicoba kembali saat profil diperbarui.");
        showToast(verifyWarningMsg ? "Chat ID Disimpan ⚠️" : "Berhasil ✅", successMessage, verifyWarningMsg ? "warning" : "success", 6000);
        window.closeTelegramPromptModal(false);
    } catch (e) {
        console.error("Gagal simpan Telegram Chat ID:", e);
        showToast(e.isPartialTelegramSave ? "Belum Tersambung" : "Gagal Menyimpan", e.message || "Gagal menyimpan Telegram Chat ID. Cek koneksi.", e.isPartialTelegramSave ? "warning" : "error", 6000);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Coba Simpan Lagi';
        }
    } finally {
        if (btn && btn.disabled) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
};


/**
 * Helper terpusat untuk mengambil SELURUH baris data dari Supabase tanpa terpotong limit 1000 PostgREST.
 * Menggunakan teknik High-Speed Parallel Chunking (Promise.all) sehingga puluhan ribu baris data
 * dapat diunduh secara serentak (paralel) hanya dalam hitungan milidetik.
 * 
 * @param {Object} supabaseClient - Instansi Supabase client
 * @param {string} table - Nama tabel Supabase (misal: 'guru_mapel_scores')
 * @param {Function} buildQueryFn - Function callback yang menerima queryBuilder dan menambahkan filter (where/eq)
 * @param {Object} options - Options tambahan { selectFields: '*', pageSize: 1000 }
 * @returns {Promise<{ data: Array, error: Object|null }>} Hasil gabungan seluruh baris data
 */
window.fetchAllSupabaseRows = async function (supabaseClient, table, buildQueryFn = null, options = {}) {
    if (!supabaseClient) return { data: [], error: { message: 'Supabase client is not initialized' } };

    const selectFields = options.selectFields || '*';
    const pageSize = options.pageSize || 1000;
    const skipCount = options.skipCount || false;

    try {
        // Fast-path: jika skipCount diaktifkan (misal untuk query berlingkup spesifik < pageSize),
        // langsung tembak single range request tanpa membuang 1 round-trip head count query.
        if (skipCount) {
            let singleQuery = supabaseClient.from(table).select(selectFields);
            if (typeof buildQueryFn === 'function') singleQuery = buildQueryFn(singleQuery);
            const { data, error } = await singleQuery.range(0, pageSize - 1);
            return { data: data || [], error: error || null };
        }

        // 1. Cek total baris data secara kilat (head count query ~10ms)
        let countQuery = supabaseClient.from(table).select(selectFields, { count: 'exact', head: true });
        if (typeof buildQueryFn === 'function') {
            countQuery = buildQueryFn(countQuery);
        }
        const { count, error: countErr } = await countQuery;

        // Fallback jika count tidak didukung atau error
        if (countErr || count === null || count === undefined) {
            let allRows = [];
            let page = 0;
            let hasMore = true;
            let lastError = null;

            while (hasMore) {
                const from = page * pageSize;
                const to = from + pageSize - 1;

                let queryBuilder = supabaseClient.from(table).select(selectFields);
                if (typeof buildQueryFn === 'function') {
                    queryBuilder = buildQueryFn(queryBuilder);
                }

                const { data, error } = await queryBuilder.range(from, to);

                if (error) {
                    lastError = error;
                    break;
                }

                if (data && Array.isArray(data)) {
                    allRows = allRows.concat(data);
                    if (data.length < pageSize) {
                        hasMore = false;
                    } else {
                        page++;
                    }
                } else {
                    hasMore = false;
                }
            }
            return { data: allRows, error: lastError };
        }

        if (count === 0) return { data: [], error: null };

        // 2. Hitung jumlah chunk / halaman
        const totalPages = Math.ceil(count / pageSize);

        // Jika data <= 1000 (normal case di SIMAS), tembak 1 request saja (~30ms)
        if (totalPages === 1) {
            let singleQuery = supabaseClient.from(table).select(selectFields);
            if (typeof buildQueryFn === 'function') singleQuery = buildQueryFn(singleQuery);
            return await singleQuery.range(0, pageSize - 1);
        }

        // 3. CONTROLLED PARALLEL CHUNKING: Tembak chunk dalam kelompok (batch) per 5 request paralel
        // Mencegah lonjakan koneksi HTTP berlebih yang bisa memicu rate-limit (HTTP 429) atau browser network lag.
        const maxConcurrency = options.maxConcurrency || 5;
        let allRows = [];
        let firstError = null;

        for (let i = 0; i < totalPages; i += maxConcurrency) {
            const batchPromises = [];
            for (let p = i; p < Math.min(i + maxConcurrency, totalPages); p++) {
                const from = p * pageSize;
                const to = from + pageSize - 1;
                let pageQuery = supabaseClient.from(table).select(selectFields);
                if (typeof buildQueryFn === 'function') pageQuery = buildQueryFn(pageQuery);
                batchPromises.push(pageQuery.range(from, to));
            }

            const batchResults = await Promise.all(batchPromises);
            for (const res of batchResults) {
                if (res.error && !firstError) firstError = res.error;
                if (res.data && Array.isArray(res.data)) {
                    allRows = allRows.concat(res.data);
                }
            }

            if (firstError) break; // Hentikan batch selanjutnya jika terjadi error di batch ini
        }

        return { data: allRows, error: firstError };
    } catch (err) {
        console.error(`[Supabase Safe Parallel Auto-Chunk] Exception on table '${table}':`, err);
        return { data: [], error: err };
    }
};

// =========================================================================
// CENTRALIZED SISWA ATTENDANCE SERVICE (MURNI SUPABASE SSOT - 0 FIRESTORE READ/WRITE)
// =========================================================================
if (typeof window !== 'undefined') {
    window.supabase = supabase;
}

/**
 * SSOT Kalkulasi Statistik Kehadiran Siswa
 * Formula resmi SIMAS:
 * - Standar: ((H + D) / Total) * 100%
 * - Mode Akademik (includeSakit): ((H + D + S) / Total) * 100%
 * di mana Total = H + S + I + D + A.
 * @param {Object} summary - Objek { H, S, I, D, A }
 * @param {Object} [options] - Konfigurasi opsional { includeSakit: boolean }
 * @returns {{ total: number, hadirCount: number, attPct: number, attPctRounded: number, attPctFormatted: string, tier: 'emerald'|'amber'|'rose', includeSakit: boolean }}
 */
window.calculateAttendanceStats = function (summary, options = {}) {
    const sum = summary || {};
    const includeSakit = !!(options?.includeSakit || sum.includeSakit);
    const h = Number(sum.H) || 0;
    const s = Number(sum.S) || 0;
    const i = Number(sum.I) || 0;
    const d = Number(sum.D) || 0;
    const a = Number(sum.A) || 0;
    const total = h + s + i + d + a;
    const hadirCount = includeSakit ? (h + d + s) : (h + d);
    const rawPct = total > 0 ? ((hadirCount / total) * 100) : 0;
    const attPct = parseFloat(rawPct.toFixed(1));
    const attPctRounded = Math.round(rawPct);
    const attPctFormatted = total > 0
        ? (Number.isInteger(attPct) ? `${attPct}%` : `${attPct.toFixed(1)}%`)
        : '0%';

    let tier = 'emerald';
    if (attPct < 80) {
        tier = 'rose';
    } else if (attPct < 90) {
        tier = 'amber';
    }

    return {
        total,
        hadirCount,
        attPct,
        attPctRounded,
        attPctFormatted,
        tier,
        includeSakit
    };
};

/**
 * Fetch Daily Attendance Summary for all classes (Supabase SSOT)
 * Digunakan oleh loadDailySummary di page-presensi.js
 * @param {string} dateStr - Tanggal format 'YYYY-MM-DD'
 * @returns {Promise<{ rows: Array, source: string }>}
 */
window.fetchDailyAttendanceSummary = async function (dateStr) {
    if (!dateStr) return { rows: [], source: 'empty' };

    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('siswa_presensi_harian')
                .select('*')
                .eq('tanggal', dateStr);

            if (!error && Array.isArray(data) && data.length > 0) {
                const rows = data.map(d => ({
                    id: d.id,
                    class: d.kelas,
                    date: d.tanggal,
                    summary: d.summary || { H: 0, S: 0, I: 0, D: 0, A: 0 },
                    total_students: d.total_students || 0,
                    recordedBy: d.recorded_by,
                    updatedAt: d.updated_at
                }));
                rows.sort((a, b) => (a.class || '').localeCompare(b.class || '', undefined, { numeric: true }));
                return { rows, source: 'supabase' };
            }
        } catch (e) {
            console.warn('[AttendanceService] Supabase daily summary warning:', e);
        }
    }

    return { rows: [], source: 'empty' };
};

/**
 * Fetch Class Attendance for specific date (Supabase SSOT)
 * Digunakan oleh loadStudentList di page-presensi.js dan wali-kelas.js
 * @param {string} className - Nama kelas misal 'X-1'
 * @param {string} dateStr - Tanggal format 'YYYY-MM-DD'
 * @returns {Promise<{ exists: boolean, records: Object, summary: Object, source: string }>}
 */
window.fetchClassAttendance = async function (className, dateStr) {
    if (!className || !dateStr) return { exists: false, records: {}, summary: {}, source: 'empty' };

    if (supabase) {
        try {
            const { data: rows, error: errRows } = await supabase
                .from('siswa_presensi')
                .select('*')
                .eq('kelas', className)
                .eq('tanggal', dateStr);

            if (!errRows && Array.isArray(rows) && rows.length > 0) {
                const records = {};
                const summary = { H: 0, S: 0, I: 0, D: 0, A: 0 };
                rows.forEach(r => {
                    records[r.student_nis] = {
                        nis: r.student_nis,
                        name: r.student_name,
                        status: r.status || 'H',
                        note: r.note || '',
                        hasLetter: !!r.has_letter
                    };
                    if (summary[r.status] !== undefined) {
                        summary[r.status]++;
                    }
                });
                return { exists: true, records, summary, source: 'supabase' };
            }
        } catch (e) {
            console.warn('[AttendanceService] Supabase class attendance warning:', e);
        }
    }

    return { exists: false, records: {}, summary: {}, source: 'supabase_empty' };
};

/**
 * Sanitasi string tanggal ISO (YYYY-MM-DD) agar selalu valid di database Postgres/Supabase
 * Mencegah error 22008 'date/time field value out of range' bila ada bulan 30 hari atau Feb yang dioper tanggal 31.
 * @param {string} dateStr 
 * @returns {string}
 */
function sanitizeDateIso(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return dateStr;
    const parts = dateStr.trim().split('-');
    if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        let d = parseInt(parts[2], 10);
        if (!isNaN(y) && !isNaN(m) && !isNaN(d) && m >= 1 && m <= 12) {
            const maxDays = new Date(y, m, 0).getDate();
            if (d > maxDays) d = maxDays;
            if (d < 1) d = 1;
            return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
    }
    return dateStr;
}
window.sanitizeDateIso = sanitizeDateIso;

/**
 * Fetch Student Attendance Range (Supabase SSOT)
 * Digunakan oleh portal-siswa.js, bk.js, guru-wali.js, dan modal detail siswa
 * @param {string} studentNIS - NIS siswa
 * @param {string} startDate - Tanggal mulai 'YYYY-MM-DD'
 * @param {string} endDate - Tanggal akhir 'YYYY-MM-DD'
 * @returns {Promise<{ rows: Array, stats: Object, source: string }>}
 */
window.fetchStudentAttendanceRange = async function (studentNIS, startDate, endDate) {
    if (!studentNIS) return { rows: [], stats: { H: 0, S: 0, I: 0, D: 0, A: 0 }, source: 'empty' };

    const nisStr = String(studentNIS).trim();
    const cleanStart = startDate ? sanitizeDateIso(startDate) : null;
    const cleanEnd = endDate ? sanitizeDateIso(endDate) : null;

    if (supabase && typeof window.fetchAllSupabaseRows === 'function') {
        try {
            const cleanNorm = nisStr.replace(/^0+/, '');
            const nisVariants = Array.from(new Set([
                nisStr,
                cleanNorm,
                cleanNorm ? cleanNorm.padStart(4, '0') : nisStr,
                cleanNorm ? cleanNorm.padStart(5, '0') : nisStr
            ])).filter(Boolean);

            const { data, error } = await window.fetchAllSupabaseRows(
                supabase,
                'siswa_presensi',
                (qb) => {
                    let q = (nisVariants.length === 1)
                        ? qb.eq('student_nis', nisVariants[0])
                        : qb.in('student_nis', nisVariants);
                    q = q.order('tanggal', { ascending: false });
                    if (cleanStart) q = q.gte('tanggal', cleanStart);
                    if (cleanEnd) q = q.lte('tanggal', cleanEnd);
                    return q;
                }
            );

            if (!error && Array.isArray(data) && data.length > 0) {
                const stats = { H: 0, S: 0, I: 0, D: 0, A: 0 };
                const rows = data.map(r => {
                    const st = r.status || 'H';
                    if (stats[st] !== undefined) stats[st]++;
                    return {
                        date: r.tanggal,
                        status: st,
                        note: r.note || '',
                        hasLetter: !!r.has_letter,
                        className: r.kelas
                    };
                });
                return { rows, stats, source: 'supabase' };
            }
        } catch (e) {
            console.warn('[AttendanceService] Supabase student attendance warning:', e);
        }
    }

    return { rows: [], stats: { H: 0, S: 0, I: 0, D: 0, A: 0 }, source: 'supabase_empty' };
};

/**
 * Fetch Class Attendance for Date Range (Supabase SSOT)
 * Digunakan oleh rekap bulanan & semester di page-presensi.js dan wali-kelas.js
 * @param {string} className - Nama kelas
 * @param {string} startDate - Tanggal mulai 'YYYY-MM-DD'
 * @param {string} endDate - Tanggal akhir 'YYYY-MM-DD'
 * @returns {Promise<{ rows: Array, source: string }>}
 */
window.fetchClassAttendanceRange = async function (className, startDate, endDate) {
    if (!className || !startDate || !endDate) return { rows: [], source: 'empty' };

    const cleanStart = sanitizeDateIso(startDate);
    const cleanEnd = sanitizeDateIso(endDate);

    if (supabase && typeof window.fetchAllSupabaseRows === 'function') {
        try {
            const { data, error } = await window.fetchAllSupabaseRows(
                supabase,
                'siswa_presensi',
                (qb) => {
                    let q = qb.eq('kelas', className);
                    if (cleanStart) q = q.gte('tanggal', cleanStart);
                    if (cleanEnd) q = q.lte('tanggal', cleanEnd);
                    return q;
                }
            );

            if (!error && Array.isArray(data) && data.length > 0) {
                return { rows: data, source: 'supabase' };
            }
        } catch (e) {
            console.warn('[AttendanceService] Supabase class range warning:', e);
        }
    }

    return { rows: [], source: 'empty' };
};

/**
 * Save Attendance (Murni Supabase SSOT)
 * @param {Object} payload - { className, dateStr, records, summary, recordedBy, absentDetails, oldRecords }
 * @returns {Promise<{ success: boolean, supabaseSaved: boolean }>}
 */
window.saveAttendanceDual = async function (payload) {
    const { className, dateStr, records, summary, recordedBy } = payload;
    if (!className || !dateStr || !records) {
        throw new Error('Payload presensi tidak lengkap');
    }

    if (!navigator.onLine) {
        throw new Error('Koneksi internet terputus. Presensi wajib disimpan saat online.');
    }

    if (!supabase) {
        throw new Error('Database Supabase belum terhubung.');
    }

    let supabaseSaved = false;

    // 1. SIMPAN KE SUPABASE (PRIMARY & ONLY TARGET)
    try {
        // A. Header Summary
        const headerPayload = {
            id: `${className}_${dateStr}`,
            kelas: className,
            tanggal: dateStr,
            summary: summary || { H: 0, S: 0, I: 0, D: 0, A: 0 },
            total_students: Object.keys(records).length,
            recorded_by: recordedBy || 'System',
            updated_at: new Date().toISOString()
        };
        const { error: errHeader } = await supabase
            .from('siswa_presensi_harian')
            .upsert(headerPayload);

        if (errHeader) console.warn('[AttendanceService] Supabase header upsert warning:', errHeader);

        // B. Detail Records per Siswa
        const detailRows = Object.values(records).map(r => ({
            kelas: className,
            tanggal: dateStr,
            student_nis: String(r.nis || ''),
            student_name: r.name || '',
            status: r.status || 'H',
            note: r.note || '',
            has_letter: !!r.hasLetter,
            recorded_by: recordedBy || 'System',
            updated_at: new Date().toISOString()
        })).filter(r => r.student_nis);

        if (detailRows.length > 0) {
            const { error: errDetails } = await supabase
                .from('siswa_presensi')
                .upsert(detailRows, { onConflict: 'student_nis,tanggal' });

            if (errDetails) console.warn('[AttendanceService] Supabase details upsert warning:', errDetails);
        }

        supabaseSaved = true;
        console.log(`✅ [Supabase SSOT] Presensi ${className} (${dateStr}) sukses tersimpan (${detailRows.length} siswa).`);
    } catch (eSb) {
        console.error('[AttendanceService] Supabase save error:', eSb);
        throw eSb;
    }

    return { success: supabaseSaved, supabaseSaved };
};

// =====================================
// BACKGROUND SYNC: RANKING ACCESS CONFIG (0 FIRESTORE READ)
// =====================================
(async function syncRankingAccessConfig() {
    if (typeof window === 'undefined') return;
    try {
        if (window.cfClient && typeof window.cfClient.getSystemSetting === 'function') {
            const cfg = await window.cfClient.getSystemSetting('ranking_access_config');
            if (cfg && typeof cfg === 'object') {
                localStorage.setItem('simas_ranking_access_config', JSON.stringify(cfg));
            }
        }
    } catch (e) {
        // Silent non-blocking fail
    }
})();

