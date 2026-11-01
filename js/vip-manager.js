/**
 * SIMAS - VIP STATUS & AVATAR BADGE MANAGER (SSOT)
 * Mengelola status VIP terpadu (E-Kinerja Guru, E-Kinerja Tendik, Koreksi AI, Kepala Sekolah)
 * Sumber Data: Cloudflare D1 SQL via /api/vip/status-summary (0 Firestore Read)
 */

import { cfGetVipStatusSummary } from './cloudflare-client.js';
import { auth } from './config.js';

let _vipSummaryCache = null;
let _vipPtkSet = new Set();
let _vipUidSet = new Set();
let _isCurrentUserVip = false;
let _fetchPromise = null;

// Cache lintas halaman (per tab, per akun) agar pindah halaman tidak memanggil Worker/D1 ulang
const VIP_SESSION_CACHE_KEY = 'simas_vip_summary_v1';
const VIP_SESSION_CACHE_TTL_MS = 10 * 60 * 1000;

function getCurrentUid() {
    try {
        return auth?.currentUser?.uid ? String(auth.currentUser.uid) : '';
    } catch (_) {
        return '';
    }
}

function readSessionCache() {
    const uid = getCurrentUid();
    if (!uid) return null;
    try {
        const raw = sessionStorage.getItem(VIP_SESSION_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.uid !== uid || (Date.now() - Number(parsed.ts || 0)) > VIP_SESSION_CACHE_TTL_MS) return null;
        return parsed.data || null;
    } catch (_) {
        return null;
    }
}

function writeSessionCache(data) {
    const uid = getCurrentUid();
    if (!uid) return;
    try {
        sessionStorage.setItem(VIP_SESSION_CACHE_KEY, JSON.stringify({ uid, ts: Date.now(), data }));
    } catch (_) { /* storage penuh / diblokir: abaikan */ }
}

function applySummaryToState(summary) {
    _vipPtkSet = new Set(summary.vip_ptk_ids);
    _vipUidSet = new Set(summary.vip_uids);
    _isCurrentUserVip = Boolean(summary.is_current_user_vip);
    _vipSummaryCache = summary;
}

/**
 * Muat ringkasan status VIP dari Cloudflare D1 (in-memory cached)
 * @param {boolean} forceRefresh
 * @returns {Promise<{vip_ptk_ids: string[], vip_uids: string[], is_current_user_vip: boolean}>}
 */
export async function loadVipStatusSummary(forceRefresh = false) {
    if (_vipSummaryCache && !forceRefresh) {
        return _vipSummaryCache;
    }

    if (_fetchPromise && !forceRefresh) {
        return await _fetchPromise;
    }

    if (!forceRefresh) {
        const cached = readSessionCache();
        if (cached) {
            applySummaryToState(cached);
            startVipBadgeAutoApply();
            return _vipSummaryCache;
        }
    }

    _fetchPromise = (async () => {
        try {
            const res = typeof cfGetVipStatusSummary === 'function'
                ? await cfGetVipStatusSummary()
                : (typeof window.cfGetVipStatusSummary === 'function' ? await window.cfGetVipStatusSummary() : null);

            if (res && res.success) {
                applySummaryToState({
                    vip_ptk_ids: Array.isArray(res.vip_ptk_ids) ? res.vip_ptk_ids.map(String) : [],
                    vip_uids: Array.isArray(res.vip_uids) ? res.vip_uids.map(String) : [],
                    is_current_user_vip: Boolean(res.is_current_user_vip)
                });
                writeSessionCache(_vipSummaryCache);
                startVipBadgeAutoApply();
            } else {
                console.warn('[VIP Manager] Respons status VIP tidak valid atau gagal:', res?.message);
            }
        } catch (err) {
            console.warn('[VIP Manager] Gagal memuat ringkasan status VIP:', err?.message || err);
        } finally {
            _fetchPromise = null;
        }

        return _vipSummaryCache || {
            vip_ptk_ids: Array.from(_vipPtkSet),
            vip_uids: Array.from(_vipUidSet),
            is_current_user_vip: _isCurrentUserVip
        };
    })();

    return await _fetchPromise;
}

/**
 * Periksa apakah PTK / Guru / GTK tertentu merupakan pengguna VIP
 * @param {string|number} ptkId
 * @returns {boolean}
 */
export function isPtkVip(ptkId) {
    if (!ptkId) return false;
    return _vipPtkSet.has(String(ptkId));
}

/**
 * Periksa apakah UID user tertentu merupakan pengguna VIP
 * @param {string} uid
 * @returns {boolean}
 */
export function isUidVip(uid) {
    if (!uid) return false;
    return _vipUidSet.has(String(uid));
}

/**
 * Periksa apakah user yang sedang login saat ini merupakan pengguna VIP
 * @returns {boolean}
 */
export function isCurrentUserVip() {
    return _isCurrentUserVip;
}

/**
 * Set status VIP user secara manual (misal setelah switch akun atau update instan)
 * @param {boolean} status
 */
export function setCurrentUserVip(status) {
    _isCurrentUserVip = Boolean(status);
    if (_vipSummaryCache) {
        _vipSummaryCache.is_current_user_vip = _isCurrentUserVip;
    }
}

/**
 * Helper pembungkus HTML avatar dengan cincin gradasi emas mewah dan pin mahkota VIP
 * @param {string} innerAvatarHtml - HTML elemen avatar asal (misal <img> atau <div initial>)
 * @param {boolean} isVip - true jika ingin dibungkus penanda VIP
 * @param {string} sizeClass - Opsi: '' (standar), 'vip-avatar-sm', atau 'vip-avatar-lg'
 * @returns {string} HTML string avatar
 */
export function wrapVipAvatarHtml(innerAvatarHtml, isVip, sizeClass = '') {
    if (!isVip) return innerAvatarHtml;

    const safeSize = sizeClass ? ` ${sizeClass.trim()}` : '';
    return `<div class="vip-avatar-container${safeSize}"><div class="vip-avatar-ring">${innerAvatarHtml}</div><span class="vip-avatar-crown" title="Pengguna VIP SIMAS"><i class="fa-solid fa-crown"></i></span></div>`;
}

/**
 * Terapkan penanda cincin emas & mahkota VIP secara in-place pada elemen kontainer avatar (aman dari overflow-hidden)
 * @param {HTMLElement} avatarEl - Elemen avatar asal (misal .user-avatar-container)
 * @param {boolean} isVip
 * @param {string} sizeClass - Opsi: '' (standar), 'vip-avatar-sm', atau 'vip-avatar-lg'
 */
export function applyVipBadgeToAvatarContainer(avatarEl, isVip, sizeClass = '') {
    if (!avatarEl || !(avatarEl instanceof HTMLElement)) return;

    // Periksa apakah avatarEl sudah berada di dalam .vip-avatar-container
    let vipWrapper = avatarEl.closest('.vip-avatar-container');

    if (!isVip) {
        if (vipWrapper && vipWrapper.parentElement) {
            // Un-wrap: keluarkan avatarEl dari wrapper
            vipWrapper.parentElement.insertBefore(avatarEl, vipWrapper);
            vipWrapper.remove();
        }
        return;
    }

    if (vipWrapper) {
        // Sudah terbungkus, pastikan crown ada
        if (!vipWrapper.querySelector('.vip-avatar-crown')) {
            const crown = document.createElement('span');
            crown.className = 'vip-avatar-crown';
            crown.title = 'Pengguna VIP SIMAS';
            crown.innerHTML = '<i class="fa-solid fa-crown"></i>';
            vipWrapper.appendChild(crown);
        }
        return;
    }

    // Bungkus avatarEl dengan vip-avatar-container dan vip-avatar-ring
    const parent = avatarEl.parentElement;
    if (!parent) return;

    const wrapper = document.createElement('div');
    const safeSize = sizeClass ? ` ${sizeClass.trim()}` : '';
    wrapper.className = `vip-avatar-container${safeSize}`;

    const ring = document.createElement('div');
    ring.className = 'vip-avatar-ring';

    const crown = document.createElement('span');
    crown.className = 'vip-avatar-crown';
    crown.title = 'Pengguna VIP SIMAS';
    crown.innerHTML = '<i class="fa-solid fa-crown"></i>';

    parent.insertBefore(wrapper, avatarEl);
    ring.appendChild(avatarEl);
    wrapper.appendChild(ring);
    wrapper.appendChild(crown);
}

/**
 * Terapkan penanda VIP pada semua elemen avatar pengguna aktif di navbar / sidebar
 * @param {boolean} [forcedStatus] - Opsi override status VIP (default: menggunakan isCurrentUserVip())
 */
export function applyVipBadgeToAllUserAvatars(forcedStatus = null) {
    const isVip = typeof forcedStatus === 'boolean' ? forcedStatus : isCurrentUserVip();
    document.querySelectorAll('.user-avatar-container').forEach(avatarEl => {
        applyVipBadgeToAvatarContainer(avatarEl, isVip);
    });
}

/**
 * Terapkan penanda cincin emas & mahkota VIP secara in-place pada kontainer DOM avatar
 * @param {HTMLElement} avatarContainerEl - Elemen kontainer avatar
 * @param {boolean} isVip
 * @param {string} sizeClass - Opsi: '' (standar), 'vip-avatar-sm', atau 'vip-avatar-lg'
 */
export function applyVipBadgeToElement(avatarContainerEl, isVip, sizeClass = '') {
    if (!avatarContainerEl || !(avatarContainerEl instanceof HTMLElement)) return;

    const existingCrown = avatarContainerEl.querySelector('.vip-avatar-crown');

    if (!isVip) {
        if (existingCrown) existingCrown.remove();
        avatarContainerEl.classList.remove('vip-avatar-container', 'vip-avatar-ring', 'vip-avatar-sm', 'vip-avatar-lg');
        return;
    }

    avatarContainerEl.classList.add('vip-avatar-container');
    avatarContainerEl.classList.add('vip-avatar-ring');
    if (sizeClass) {
        avatarContainerEl.classList.add(sizeClass.trim());
    }

    if (!existingCrown) {
        const crown = document.createElement('span');
        crown.className = 'vip-avatar-crown';
        crown.title = 'Pengguna VIP SIMAS';
        crown.innerHTML = '<i class="fa-solid fa-crown"></i>';
        avatarContainerEl.appendChild(crown);
    }
}

/**
 * Cari dan terapkan penanda VIP pada semua elemen di dalam kontainer yang memiliki data-vip-ptk-id
 * @param {HTMLElement|Document} rootContainer
 */
export function applyVipBadgesInContainer(rootContainer = document) {
    if (!rootContainer || typeof rootContainer.querySelectorAll !== 'function') return;

    const elements = rootContainer.querySelectorAll('[data-vip-ptk-id]');
    elements.forEach(el => {
        const ptkId = el.getAttribute('data-vip-ptk-id');
        const isVip = isPtkVip(ptkId);
        const sizeClass = el.getAttribute('data-vip-size') || '';
        applyVipBadgeToAvatarContainer(el, isVip, sizeClass);
    });
}

let _autoApplyObserver = null;
let _pendingRoots = new Set();
let _autoApplyScheduled = false;

function flushPendingVipRoots() {
    _autoApplyScheduled = false;
    const roots = Array.from(_pendingRoots);
    _pendingRoots.clear();
    roots.forEach(root => {
        if (!root.isConnected) return;
        if (root.hasAttribute && root.hasAttribute('data-vip-ptk-id')) {
            applyVipBadgeToAvatarContainer(root, isPtkVip(root.getAttribute('data-vip-ptk-id')), root.getAttribute('data-vip-size') || '');
        }
        applyVipBadgesInContainer(root);
    });
}

/**
 * Pantau DOM sekali per halaman: setiap avatar ber-atribut data-vip-ptk-id (termasuk yang dirender belakangan)
 * otomatis diberi cincin & mahkota VIP. Murni sisi klien, tanpa request tambahan.
 */
export function startVipBadgeAutoApply() {
    if (typeof document === 'undefined' || !document.body) return;

    applyVipBadgesInContainer(document);
    if (_autoApplyObserver || typeof MutationObserver === 'undefined') return;

    _autoApplyObserver = new MutationObserver(mutations => {
        for (const m of mutations) {
            m.addedNodes.forEach(node => {
                if (node.nodeType !== 1 || node.classList?.contains('vip-avatar-container')) return;
                if (node.hasAttribute('data-vip-ptk-id') || node.querySelector('[data-vip-ptk-id]')) {
                    _pendingRoots.add(node);
                }
            });
        }
        if (_pendingRoots.size && !_autoApplyScheduled) {
            _autoApplyScheduled = true;
            requestAnimationFrame(flushPendingVipRoots);
        }
    });
    _autoApplyObserver.observe(document.body, { childList: true, subtree: true });
}

// Global binding untuk kemudahan integrasi di seluruh script SIMAS
const vipManager = {
    loadVipStatusSummary,
    isPtkVip,
    isUidVip,
    isCurrentUserVip,
    setCurrentUserVip,
    wrapVipAvatarHtml,
    applyVipBadgeToElement,
    applyVipBadgeToAvatarContainer,
    applyVipBadgeToAllUserAvatars,
    applyVipBadgesInContainer,
    startVipBadgeAutoApply,
    getVipSummary: () => _vipSummaryCache
};

if (typeof window !== 'undefined') {
    window.vipManager = vipManager;
    window.loadVipStatusSummary = loadVipStatusSummary;
    window.isPtkVip = isPtkVip;
    window.isCurrentUserVip = isCurrentUserVip;
    window.setCurrentUserVip = setCurrentUserVip;
    window.wrapVipAvatarHtml = wrapVipAvatarHtml;
    window.applyVipBadgeToElement = applyVipBadgeToElement;
    window.applyVipBadgeToAvatarContainer = applyVipBadgeToAvatarContainer;
    window.applyVipBadgeToAllUserAvatars = applyVipBadgeToAllUserAvatars;
    window.applyVipBadgesInContainer = applyVipBadgesInContainer;
    window.startVipBadgeAutoApply = startVipBadgeAutoApply;
}

export default vipManager;
