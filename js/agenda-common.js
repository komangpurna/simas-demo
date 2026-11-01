/**
 * SIMAS - Shared Agenda & Documents Utilities (js/agenda-common.js)
 * Modul pembantu bersama untuk Kalender Agenda, Dokumen, dan Agenda Pegawai
 */

// Robust Date Parser untuk Firestore Timestamps, JSON Cache Objects, String ISO, maupun Date Objects
export function parseDate(ts) {
    if (!ts) return null;
    if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;
    if (typeof ts.toDate === 'function') {
        const d = ts.toDate();
        return isNaN(d.getTime()) ? null : d;
    }
    if (typeof ts === 'object') {
        if (ts.seconds !== undefined) {
            const d = new Date(ts.seconds * 1000);
            return isNaN(d.getTime()) ? null : d;
        }
        if (ts._seconds !== undefined) {
            const d = new Date(ts._seconds * 1000);
            return isNaN(d.getTime()) ? null : d;
        }
    }
    if (typeof ts === 'string') {
        const match = ts.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
            return new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
        }
    }
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
}

// Format timestamp to YYYY-MM-DD
export function formatYMD(ts) {
    const d = parseDate(ts);
    if (!d) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Sanitasi string untuk mencegah injeksi HTML / XSS
export function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Dialog Konfirmasi Kustom SIMAS (Pengganti confirm() native)
export function showConfirmModal(message, title = 'Konfirmasi', type = 'warning') {
    return new Promise((resolve) => {
        // Jika modul global sudah menyediakan showConfirmModal
        if (typeof window.showConfirmModal === 'function' && window.showConfirmModal !== showConfirmModal) {
            return window.showConfirmModal(message, title, type).then(resolve);
        }

        const modal = document.getElementById('modal-generic-confirm');
        if (!modal) {
            // Fallback aman jika modal belum terpasang di DOM
            return resolve(window.confirm(`${title}: ${message}`));
        }

        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-msg');
        const btnOk = document.getElementById('btn-confirm-ok');
        const btnCancel = document.getElementById('btn-confirm-cancel');
        const iconBg = document.getElementById('confirm-icon-bg');
        const icon = document.getElementById('confirm-icon');

        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;

        if (type === 'danger') {
            if (iconBg) iconBg.className = 'w-16 h-16 bg-rose-100 dark:bg-rose-900/30 rounded-full flex items-center justify-center mx-auto mb-4 text-rose-600 dark:text-rose-400';
            if (icon) icon.className = 'fa-solid fa-triangle-exclamation text-3xl';
            if (btnOk) {
                btnOk.className = 'flex-1 px-5 py-3 rounded-xl font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-lg shadow-rose-200 dark:shadow-none transition-transform active:scale-95';
                btnOk.textContent = 'Ya, Hapus';
            }
        } else {
            if (iconBg) iconBg.className = 'w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto mb-4 text-amber-600 dark:text-amber-400';
            if (icon) icon.className = 'fa-solid fa-question text-3xl';
            if (btnOk) {
                btnOk.className = 'flex-1 px-5 py-3 rounded-xl font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-lg shadow-amber-200 dark:shadow-none transition-transform active:scale-95';
                btnOk.textContent = 'Ya, Lanjutkan';
            }
        }

        modal.classList.remove('hidden');

        const cleanup = () => {
            modal.classList.add('hidden');
            if (btnOk) btnOk.onclick = null;
            if (btnCancel) btnCancel.onclick = null;
        };

        if (btnOk) {
            btnOk.onclick = () => {
                cleanup();
                resolve(true);
            };
        }
        if (btnCancel) {
            btnCancel.onclick = () => {
                cleanup();
                resolve(false);
            };
        }
    });
}

// Algoritma SSOT Kalkulasi Menit Efektif Kerja Tendik (07:30 - 15:30 WITA, istirahat 12:30 - 13:00)
export function calculateEffectiveMinutes(startTime, endTime) {
    if (!startTime || !endTime) return 0;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 0;

    let startMin = sh * 60 + sm;
    let endMin = eh * 60 + em;

    const WORK_START = 450;  // 07:30
    const WORK_END   = 930;  // 15:30
    const REST_START = 750;  // 12:30
    const REST_END   = 780;  // 13:00

    if (startMin < WORK_START) startMin = WORK_START;
    if (endMin > WORK_END) endMin = WORK_END;
    if (startMin >= endMin) return 0;

    let effectiveMin = endMin - startMin;

    const restOverlapStart = Math.max(startMin, REST_START);
    const restOverlapEnd   = Math.min(endMin, REST_END);
    if (restOverlapStart < restOverlapEnd) {
        effectiveMin -= (restOverlapEnd - restOverlapStart);
    }

    return Math.max(0, effectiveMin);
}

