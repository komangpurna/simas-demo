import { auth, supabase, resolvePhotoUrl } from './config.js';
import { initLayout, showToast, escapeHTML, callSecureEdgeFunction } from './global.js';
import { cfClient } from './cloudflare-client.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const ADMIN_WA_NUMBER = '085337053969';
const FEEDBACK_CACHE_KEY = 'simas_feedbacks_cache_v1';

let currentUser = null;
let currentProfile = null;
let currentTeachersMap = null;
let feedbackItems = [];
let currentSocialTab = 'latest'; // 'latest' | 'popular' | 'needs_response' | 'completed'
let selectedCategoryTag = 'all';

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
    admin_sukaduka: 'Admin Suka-Duka'
};

const targetLabels = {
    super_admin: 'Super Admin / Tim IT',
    kepala_sekolah: 'Kepala Sekolah',
    wakasek_kurikulum: 'Wakasek Kurikulum',
    kesiswaan: 'Wakasek Kesiswaan',
    humas: 'Wakasek Humas',
    sarpras: 'Wakasek Sarpras',
    kepala_lab: 'Kepala Laboratorium',
    staff: 'Tata Usaha / Staff TU',
    guru: 'Bapak / Ibu Guru'
};

const reporterLabels = {
    siswa: 'Siswa',
    orang_tua: 'Orang Tua / Wali',
    guru_staf: 'Guru / Pegawai',
    alumni: 'Alumni',
    tamu_umum: 'Tamu / Umum',
    anonim: 'Anonim',
    internal: 'Internal User'
};

const statusStyles = {
    baru: {
        label: 'Baru',
        badge: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800',
        dot: 'bg-sky-500 ring-2 ring-sky-400/30',
        border: 'border-l-sky-500',
        icon: 'fa-sparkles'
    },
    proses: {
        label: 'Dalam Proses',
        badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
        dot: 'bg-amber-500 ring-2 ring-amber-400/30',
        border: 'border-l-amber-500',
        icon: 'fa-arrows-rotate'
    },
    direncanakan: {
        label: 'Direncanakan',
        badge: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800',
        dot: 'bg-indigo-500 ring-2 ring-indigo-400/30',
        border: 'border-l-indigo-500',
        icon: 'fa-calendar-check'
    },
    butuh_info: {
        label: 'Perlu Info',
        badge: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800',
        dot: 'bg-purple-500 ring-2 ring-purple-400/30',
        border: 'border-l-purple-500',
        icon: 'fa-circle-question'
    },
    selesai: {
        label: 'Selesai',
        badge: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
        dot: 'bg-emerald-500 ring-2 ring-emerald-400/30',
        border: 'border-l-emerald-500',
        icon: 'fa-circle-check'
    },
    ditolak: {
        label: 'Ditolak',
        badge: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
        dot: 'bg-rose-500 ring-2 ring-rose-400/30',
        border: 'border-l-rose-500',
        icon: 'fa-circle-xmark'
    }
};

let searchQuery = '';
let searchDebounceTimer = null;

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.replace('index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash));
        return;
    }

    currentUser = user;
    await loadCurrentProfile(user);

    const role = localStorage.getItem('user_role') || currentProfile?.role || 'guru_mapel';
    if (role === 'siswa') {
        showToast('Akses Terbatas', 'Siswa dapat menggunakan tombol Lapor Kendala Global di halaman dashboard/portal siswa.', 'info');
        window.location.replace('portal-siswa.html');
        return;
    }

    const effectiveRole = window.getEffectiveRoleForPage ? window.getEffectiveRoleForPage('masukan.html') : role;
    await initLayout(effectiveRole);

    updateSenderLabel();
    setupEvents();
    await loadFeedback();
    checkSourceParam();

    document.querySelector('main')?.classList.remove('hidden');
});

function isAuthorizedLeadership() {
    const primaryRole = localStorage.getItem('user_role') || currentProfile?.role;
    const allRoles = window.getAllUserRoles ? window.getAllUserRoles() : [primaryRole].filter(Boolean);
    const allowed = ['super_admin', 'kepala_sekolah', 'kesiswaan', 'wakasek_kurikulum', 'kepala_lab', 'humas', 'sarpras'];
    return allRoles.some(r => allowed.includes(r));
}

async function loadCurrentProfile(user) {
    try {
        const cachedUserDoc = await window.getCurrentUserDoc();
        currentProfile = cachedUserDoc || {};
    } catch (error) {
        console.warn('[Masukan] Gagal memuat profil user:', error);
        currentProfile = {};
    }
}

function setupEvents() {
    const form = document.getElementById('feedback-form');
    if (form && !form.dataset.bound) {
        form.addEventListener('submit', submitFeedback);
        form.dataset.bound = 'true';
    }

    const message = document.getElementById('feedback-message');
    const counter = document.getElementById('feedback-char-count');
    if (message && counter && !message.dataset.bound) {
        message.addEventListener('input', () => {
            counter.textContent = `${message.value.length}/1200`;
        });
        message.dataset.bound = 'true';
    }

    // Live Search listener dengan debounce 200ms
    const searchInput = document.getElementById('feedback-search-input');
    const clearBtn = document.getElementById('btn-clear-search');
    if (searchInput && !searchInput.dataset.bound) {
        searchInput.addEventListener('input', () => {
            const val = searchInput.value.trim();
            if (clearBtn) {
                clearBtn.classList.toggle('hidden', val.length === 0);
            }
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                searchQuery = val;
                renderFeedbackList();
            }, 200);
        });
        searchInput.dataset.bound = 'true';
    }

    const responseForm = document.getElementById('response-form');
    if (responseForm && !responseForm.dataset.bound) {
        responseForm.addEventListener('submit', saveFeedbackResponse);
        responseForm.dataset.bound = 'true';
    }

    const replyForm = document.getElementById('reply-form');
    if (replyForm && !replyForm.dataset.bound) {
        replyForm.addEventListener('submit', submitReplyFeedback);
        replyForm.dataset.bound = 'true';
    }

    const replyMsg = document.getElementById('reply-message');
    const replyCounter = document.getElementById('reply-char-count');
    if (replyMsg && replyCounter && !replyMsg.dataset.bound) {
        replyMsg.addEventListener('input', () => {
            replyCounter.textContent = `${replyMsg.value.length}/1500`;
        });
        replyMsg.dataset.bound = 'true';
    }

    const editReplyForm = document.getElementById('edit-reply-form');
    if (editReplyForm && !editReplyForm.dataset.bound) {
        editReplyForm.addEventListener('submit', saveEditReply);
        editReplyForm.dataset.bound = 'true';
    }

    const editReplyMsg = document.getElementById('edit-reply-message');
    const editReplyCounter = document.getElementById('edit-reply-char-count');
    if (editReplyMsg && editReplyCounter && !editReplyMsg.dataset.bound) {
        editReplyMsg.addEventListener('input', () => {
            editReplyCounter.textContent = `${editReplyMsg.value.length}/1500`;
        });
        editReplyMsg.dataset.bound = 'true';
    }

    const editFeedbackForm = document.getElementById('edit-feedback-form');
    if (editFeedbackForm && !editFeedbackForm.dataset.bound) {
        editFeedbackForm.addEventListener('submit', saveEditFeedback);
        editFeedbackForm.dataset.bound = 'true';
    }

    const editFeedbackMsg = document.getElementById('edit-feedback-message');
    const editFeedbackCounter = document.getElementById('edit-feedback-char-count');
    if (editFeedbackMsg && editFeedbackCounter && !editFeedbackMsg.dataset.bound) {
        editFeedbackMsg.addEventListener('input', () => {
            editFeedbackCounter.textContent = `${editFeedbackMsg.value.length}/2500`;
        });
        editFeedbackMsg.dataset.bound = 'true';
    }

    // Escape listener untuk menutup modal yang aktif
    if (!document.dataset?.escBound) {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                window.closeFeedbackModal();
                window.closeFeedbackResponse();
                window.closeFeedbackReply();
                window.closeEditReply();
                window.closeEditFeedback();
            }
        });
        if (document.dataset) {
            document.dataset.escBound = 'true';
        }
    }
}

function checkSourceParam() {
    const urlParams = new URLSearchParams(window.location.search);
    const sourceUrl = urlParams.get('source');
    const pwaAction = urlParams.get('action') || urlParams.get('shortcut') || urlParams.get('open');
    const feedbackIdParam = urlParams.get('feedback_id');

    if (sourceUrl) {
        const messageEl = document.getElementById('feedback-message');
        if (messageEl && !messageEl.dataset.prefilled) {
            let cleanSource = sourceUrl;
            try {
                const parsedUrl = new URL(sourceUrl);
                parsedUrl.searchParams.delete('source');
                cleanSource = parsedUrl.toString();
            } catch (e) {
                // Ignore if not a valid absolute URL
            }

            messageEl.value = `\n\n------------------\nSumber Halaman: ${cleanSource}`;
            messageEl.dataset.prefilled = 'true';

            const counter = document.getElementById('feedback-char-count');
            if (counter) {
                counter.textContent = `${messageEl.value.length}/1200`;
            }

            window.openFeedbackModal();

            setTimeout(() => {
                messageEl.focus();
                messageEl.setSelectionRange(0, 0);
            }, 250);
        }
    } else if (pwaAction === 'lapor' || pwaAction === 'lapormas' || pwaAction === 'input' || pwaAction === 'modal') {
        setTimeout(() => {
            if (typeof window.openFeedbackModal === 'function') {
                window.openFeedbackModal();
            }
        }, 150);
    } else if (feedbackIdParam) {
        setTimeout(() => {
            const cardEl = document.getElementById(`card-${feedbackIdParam}`);
            if (cardEl) {
                cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                cardEl.classList.add('ring-2', 'ring-blue-500', 'border-blue-500');
                setTimeout(() => {
                    cardEl.classList.remove('ring-2', 'ring-blue-500', 'border-blue-500');
                }, 3000);
            }
        }, 300);
    }
}

function updateSenderLabel() {
    const sender = getSenderInfo();
    const label = document.getElementById('sender-label');
    if (label) {
        label.textContent = `Login sebagai ${sender.name} (${sender.roleText})`;
    }
    const composerAvatar = document.getElementById('composer-user-avatar');
    if (composerAvatar) {
        if (sender.photo) {
            composerAvatar.innerHTML = `<img src="${escapeHTML(sender.photo)}" alt="${escapeHTML(sender.name)}" class="w-full h-full object-cover rounded-full" onerror="this.onerror=null; this.parentElement.textContent='${escapeHTML(getInitials(sender.name))}';">`;
        } else {
            composerAvatar.textContent = getInitials(sender.name);
        }
    }
    const modalAvatar = document.getElementById('modal-composer-avatar');
    if (modalAvatar) {
        if (sender.photo) {
            modalAvatar.innerHTML = `<img src="${escapeHTML(sender.photo)}" alt="${escapeHTML(sender.name)}" class="w-full h-full object-cover rounded-full" onerror="this.onerror=null; this.parentElement.innerHTML='<i class=\\'fa-solid fa-pen-to-square\\'></i>';">`;
        } else {
            modalAvatar.innerHTML = `<span class="font-extrabold text-xs text-white">${escapeHTML(getInitials(sender.name))}</span>`;
        }
    }
}

function getSenderInfo() {
    const allRoles = window.getAllUserRoles ? window.getAllUserRoles() : [localStorage.getItem('user_role')].filter(Boolean);
    const roleText = allRoles.map(role => roleLabels[role] || role).join(', ') || '-';
    const name = currentProfile?.name ||
        localStorage.getItem(`cached_user_name_${currentUser?.uid}`) ||
        currentUser?.displayName ||
        currentUser?.email?.split('@')[0] ||
        'Pengguna';
    const primaryRole = currentProfile?.role || localStorage.getItem('user_role') || 'guru_mapel';
    const rawPhoto = (currentUser?.uid ? localStorage.getItem(`cached_user_photo_${currentUser.uid}`) : null) ||
        currentProfile?.photo ||
        currentProfile?.photoURL ||
        currentUser?.photoURL ||
        '';
    const photo = resolvePhotoUrl(rawPhoto);

    return {
        uid: currentUser?.uid || '',
        name,
        email: currentUser?.email || '',
        role: primaryRole,
        primaryRole,
        roles: allRoles,
        roleText,
        photo
    };
}

function isSuperAdmin() {
    return window.hasRole ? window.hasRole('super_admin') : (localStorage.getItem('user_role') === 'super_admin');
}

function isFeedbackAdmin() {
    return isAuthorizedLeadership();
}

function isGtkUser() {
    const primaryRole = localStorage.getItem('user_role') || currentProfile?.role;
    const allRoles = window.getAllUserRoles ? window.getAllUserRoles() : [primaryRole].filter(Boolean);
    return Boolean(currentUser && !allRoles.includes('siswa') && primaryRole !== 'siswa');
}

window.openFeedbackModal = function () {
    const modal = document.getElementById('feedback-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        updateSenderLabel();
        setTimeout(() => {
            document.getElementById('feedback-title')?.focus();
        }, 150);
    }
};

window.closeFeedbackModal = function () {
    const modal = document.getElementById('feedback-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

window.toggleTargetPopover = function (forceState) {
    const popover = document.getElementById('target-popover');
    const chevron = document.getElementById('target-popover-chevron');
    if (!popover) return;
    const shouldOpen = typeof forceState === 'boolean' ? forceState : popover.classList.contains('hidden');
    popover.classList.toggle('hidden', !shouldOpen);
    if (chevron) chevron.classList.toggle('rotate-180', shouldOpen);
};

window.onTargetCheckboxChange = function () {
    const checked = Array.from(document.querySelectorAll('input[name="feedback-target-cb"]:checked'));
    const countBadge = document.getElementById('target-count-badge');
    const labelEl = document.getElementById('selected-targets-label');
    const hiddenTarget = document.getElementById('feedback-target');

    if (hiddenTarget) {
        hiddenTarget.value = checked.map(c => c.value).join(',');
    }

    if (countBadge) {
        countBadge.textContent = `${checked.length} dipilih`;
        countBadge.classList.toggle('text-rose-500', checked.length === 0);
        countBadge.classList.toggle('text-blue-600', checked.length > 0);
    }

    if (labelEl) {
        if (checked.length === 0) {
            labelEl.textContent = 'Pilih sasaran...';
            labelEl.classList.add('text-rose-500');
        } else {
            labelEl.classList.remove('text-rose-500');
            const targetNames = {
                super_admin: 'Super Admin',
                kepala_sekolah: 'Kepala Sekolah',
                wakasek_kurikulum: 'Kurikulum',
                kesiswaan: 'Kesiswaan',
                humas: 'Humas',
                sarpras: 'Sarpras',
                kepala_lab: 'Kepala Lab',
                staff: 'Tata Usaha',
                guru: 'Guru'
            };
            if (checked.length === 1) {
                labelEl.textContent = targetNames[checked[0].value] || checked[0].value;
            } else {
                const names = checked.map(c => targetNames[c.value] || c.value);
                labelEl.textContent = `${checked.length} Sasaran (${names.slice(0, 2).join(', ')}${names.length > 2 ? '...' : ''})`;
            }
        }
    }
};

// Event listener click outside untuk menutup target popover
if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
        const popover = document.getElementById('target-popover');
        const trigger = document.getElementById('btn-target-dropdown');
        if (popover && !popover.classList.contains('hidden')) {
            if (!popover.contains(e.target) && !trigger?.contains(e.target)) {
                window.toggleTargetPopover(false);
            }
        }
    });
}

async function submitFeedback(event) {
    event.preventDefault();

    const checkedBoxes = Array.from(document.querySelectorAll('input[name="feedback-target-cb"]:checked'));
    if (checkedBoxes.length === 0) {
        showToast('Tujuan Wajib Dipilih', 'Pilih minimal satu tujuan laporan / pimpinan.', 'warning');
        window.toggleTargetPopover(true);
        return;
    }

    const selectedTargets = checkedBoxes.map(cb => cb.value.trim());
    const targetRecipient = selectedTargets.join(',');

    const categoryEl = document.getElementById('feedback-category');
    const titleEl = document.getElementById('feedback-title');
    const messageEl = document.getElementById('feedback-message');
    const button = document.getElementById('btn-submit-feedback');

    const category = categoryEl ? categoryEl.value.trim() : "Web App SIMAS-CERDAS";
    const title = titleEl ? titleEl.value.trim() : '';
    const message = messageEl ? messageEl.value.trim() : '';

    if (!title || !message) {
        showToast('Belum lengkap', 'Judul dan isi masukan wajib diisi.', 'warning');
        return;
    }

    const sender = getSenderInfo();

    try {
        setButtonLoading(button, true, 'Mengirim...');

        // 1. Simpan ke Supabase masukkan_saran via Edge Function Secure Proxy
        await callSecureEdgeFunction('submit-feedback', {
            category,
            title,
            message,
            target_recipient: targetRecipient,
            reporter_type: 'guru_staf',
            contact_info: sender.email || '',
            sender_name: sender.name,
            sender_email: sender.email,
            sender_role: sender.primaryRole,
            sender_roles: sender.roles,
            source_url: new URLSearchParams(window.location.search).get('source')
        });

        event.target.reset();
        // Reset pilihan target ke default (hanya super_admin yang dicentang)
        document.querySelectorAll('input[name="feedback-target-cb"]').forEach(cb => {
            cb.checked = (cb.value === 'super_admin');
        });
        window.onTargetCheckboxChange();
        window.toggleTargetPopover(false);

        const charCounter = document.getElementById('feedback-char-count');
        if (charCounter) charCounter.textContent = '0/1200';
        window.closeFeedbackModal();
        showToast('Aspirasi Terkirim', 'Aspirasi Anda berhasil dikirim ke pimpinan sekolah.', 'success');

        // 2. Pemicu Notifikasi Multi-Channel ke Akun Target & Tembusan Pimpinan
        try {
            if (cfClient && typeof cfClient.notifyNewFeedback === 'function') {
                await cfClient.notifyNewFeedback({
                    title,
                    message,
                    targetRecipient,
                    category,
                    senderName: sender.name,
                    isPublic: false
                });
            }
        } catch (notifErr) {
            console.warn('[Masukan] Notifikasi masukan baru dilewati:', notifErr?.message || notifErr);
        }

        await loadFeedback(true);
    } catch (error) {
        console.error('[Masukan] Submit failed:', error);
        showToast('Gagal mengirim', error.message || 'Masukan belum bisa dikirim.', 'error');
    } finally {
        setButtonLoading(button, false);
    }
}

function renderFeedbackSkeleton() {
    const list = document.getElementById('feedback-list');
    if (!list) return;
    let skeletonHtml = '';
    for (let i = 0; i < 3; i++) {
        skeletonHtml += `
            <div class="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-2xs animate-pulse space-y-3">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800"></div>
                        <div class="space-y-1">
                            <div class="h-3.5 w-28 bg-slate-200 dark:bg-slate-800 rounded"></div>
                            <div class="h-2.5 w-20 bg-slate-100 dark:bg-slate-800/60 rounded"></div>
                        </div>
                    </div>
                    <div class="h-5 w-20 bg-slate-200 dark:bg-slate-800 rounded-full"></div>
                </div>
                <div class="h-4 w-3/4 bg-slate-200 dark:bg-slate-800 rounded mb-2"></div>
                <div class="space-y-1.5 pt-1">
                    <div class="h-3 w-full bg-slate-100 dark:bg-slate-800/60 rounded"></div>
                    <div class="h-3 w-5/6 bg-slate-100 dark:bg-slate-800/60 rounded"></div>
                </div>
                <div class="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <div class="h-7 w-16 bg-slate-200 dark:bg-slate-800 rounded-xl"></div>
                        <div class="h-7 w-16 bg-slate-200 dark:bg-slate-800 rounded-xl"></div>
                    </div>
                    <div class="h-7 w-20 bg-slate-200 dark:bg-slate-800 rounded-xl"></div>
                </div>
            </div>
        `;
    }
    list.innerHTML = skeletonHtml;
}

async function loadFeedback(forceRefresh = false) {
    const list = document.getElementById('feedback-list');
    let hasRenderedFromCache = false;

    // Pastikan master GTK D1 dimuat untuk resolusi foto profil pengirim (0 Firestore Read)
    if (!currentTeachersMap && typeof window.getTeachersMapCache === 'function') {
        window.getTeachersMapCache().then(m => {
            currentTeachersMap = m;
            if (hasRenderedFromCache) {
                renderFeedbackList();
            }
        }).catch(eMap => {
            console.warn('[Masukan] Gagal memuat teachersMapCache:', eMap);
        });
    }

    // 1. Stale-While-Revalidate: Render seketika dari cache sessionStorage
    if (!forceRefresh) {
        try {
            const rawCache = sessionStorage.getItem(FEEDBACK_CACHE_KEY);
            if (rawCache) {
                const parsed = JSON.parse(rawCache);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    feedbackItems = parsed;
                    updateKpiStats();
                    renderTrendingTopics();
                    renderFeedbackList();
                    hasRenderedFromCache = true;
                }
            }
        } catch (cacheReadErr) {
            console.warn('[Masukan] Gagal membaca cache masukan:', cacheReadErr);
        }
    }

    if (!hasRenderedFromCache && list) {
        renderFeedbackSkeleton();
    }

    // 2. Ambil data terbaru dari backend Edge Function
    try {
        let rawData = [];
        try {
            const edgeRes = await callSecureEdgeFunction('get-feedbacks');
            rawData = edgeRes?.data || [];
        } catch (edgeErr) {
            if (hasRenderedFromCache) {
                console.warn('[Masukan] Gagal memperbarui data di background:', edgeErr);
                return;
            }
            throw edgeErr;
        }

        feedbackItems = (Array.isArray(rawData) ? rawData : []).map(item => {
            const hasBeenEdited = Boolean(
                item.edited_at ||
                (item.updated_at && item.created_at && Math.abs(new Date(item.updated_at).getTime() - new Date(item.created_at).getTime()) > 2000)
            );
            return {
                id: item.id,
                category: item.category,
                targetRecipient: item.target_recipient || 'all',
                reporterType: item.reporter_type || (item.sender_role === 'public' ? 'tamu_umum' : 'internal'),
                contactInfo: item.contact_info || item.sender_email || '',
                title: item.title,
                message: item.message,
                status: item.status,
                senderUid: item.sender_uid,
                senderName: item.sender_name,
                senderEmail: item.sender_email,
                senderRole: item.sender_role,
                senderRoles: item.sender_roles,
                senderPhoto: item.sender_photo || item.senderPhoto || null,
                sourceUrl: item.source_url,
                responseText: item.response_text,
                responseByUid: item.response_by_uid,
                responseByName: item.response_by_name,
                respondedAt: item.responded_at,
                replies: Array.isArray(item.replies) ? item.replies : [],
                likes: Array.isArray(item.likes) ? item.likes : [],
                createdAt: item.created_at,
                updatedAt: item.updated_at,
                editedAt: hasBeenEdited ? (item.edited_at || item.updated_at) : null
            };
        });

        if (!currentTeachersMap && typeof window.getTeachersMapCache === 'function') {
            try {
                currentTeachersMap = await window.getTeachersMapCache();
            } catch (eMap) {
                console.warn('[Masukan] Gagal memuat teachersMapCache:', eMap);
            }
        }

        try {
            sessionStorage.setItem(FEEDBACK_CACHE_KEY, JSON.stringify(feedbackItems));
        } catch (cacheWriteErr) {
            console.warn('[Masukan] Gagal menulis cache masukan:', cacheWriteErr);
        }

        // Catat kunjungan ke halaman Masukan agar badge 'NEW' di sidebar hilang otomatis
        localStorage.setItem('simas_masukan_last_visited', new Date().toISOString());
        sessionStorage.setItem('simas_masukan_has_new', 'false');
        sessionStorage.setItem('simas_masukan_badge_check_ts', Date.now().toString());
        if (typeof window.updateMasukanBadgeUI === 'function') {
            window.updateMasukanBadgeUI(false);
        }

        updateKpiStats();
        renderTrendingTopics();
        renderFeedbackList();
    } catch (error) {
        console.error('[Masukan] Gagal memuat masukan:', error);
        if (list) {
            list.innerHTML = emptyState('fa-triangle-exclamation', 'Gagal memuat masukan dari server.');
        }
    }
}

function updateKpiStats() {
    const statTotal = document.getElementById('stat-total-count');
    const statNew = document.getElementById('stat-new-count');
    const statProcess = document.getElementById('stat-process-count');
    const statDone = document.getElementById('stat-done-count');

    const totalCount = Array.isArray(feedbackItems) ? feedbackItems.length : 0;
    const newCount = Array.isArray(feedbackItems) ? feedbackItems.filter(f => (f.status || 'baru') === 'baru').length : 0;
    const processCount = Array.isArray(feedbackItems) ? feedbackItems.filter(f => ['proses', 'direncanakan', 'butuh_info'].includes(f.status)).length : 0;
    const doneCount = Array.isArray(feedbackItems) ? feedbackItems.filter(f => ['selesai', 'ditolak'].includes(f.status)).length : 0;

    if (statTotal) statTotal.textContent = totalCount;
    if (statNew) statNew.textContent = newCount;
    if (statProcess) statProcess.textContent = processCount;
    if (statDone) statDone.textContent = doneCount;
}

function updateKpiActiveVisual(activeType) {
    const types = ['all', 'baru', 'proses', 'selesai'];
    types.forEach(t => {
        const el = document.getElementById(`kpi-btn-${t}`);
        if (!el) return;
        if (t === activeType) {
            el.classList.add('ring-2', 'ring-blue-500', 'border-blue-500');
        } else {
            el.classList.remove('ring-2', 'ring-blue-500', 'border-blue-500');
        }
    });
}

window.applyKpiQuickFilter = function (filterType) {
    if (filterType === 'all') {
        window.switchSocialTab('latest');
    } else if (filterType === 'baru' || filterType === 'proses') {
        window.switchSocialTab('needs_response');
    } else if (filterType === 'selesai') {
        window.switchSocialTab('completed');
    }
    updateKpiActiveVisual(filterType);
};

window.switchSocialTab = function (tab) {
    currentSocialTab = tab;
    const tabs = ['latest', 'popular', 'needs_response', 'completed'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-social-${t}`);
        if (!btn) return;
        if (t === tab) {
            btn.className = 'px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-900/60 cursor-pointer';
        } else {
            btn.className = 'px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer';
        }
    });

    renderFeedbackList();
};

window.selectCategoryTag = function (category) {
    selectedCategoryTag = category;

    const chipMap = {
        'all': 'chip-cat-all',
        'Sarana Prasarana & Laboratorium': 'chip-cat-sarpras',
        'Akademik & Pembelajaran': 'chip-cat-akademik',
        'Kesiswaan & Kedisiplinan': 'chip-cat-kesiswaan',
        'Pelayanan Tata Usaha & Administrasi': 'chip-cat-tu',
        'Hubungan Masyarakat & Informasi': 'chip-cat-humas',
        'Sistem Informasi': 'chip-cat-sistem',
        'Saran, Aspirasi & Pengaduan Umum': 'chip-cat-umum'
    };

    Object.entries(chipMap).forEach(([catKey, chipId]) => {
        const chipEl = document.getElementById(chipId);
        if (!chipEl) return;
        const isActive = catKey === category;
        if (isActive) {
            chipEl.className = 'px-3 py-1 rounded-full text-xs font-extrabold transition-all border shrink-0 bg-blue-600 text-white border-blue-600 shadow-2xs cursor-pointer';
        } else {
            chipEl.className = 'px-3 py-1 rounded-full text-xs font-bold transition-all border shrink-0 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 cursor-pointer';
        }
    });

    renderFeedbackList();
};

window.clearFeedbackSearch = function () {
    searchQuery = '';
    const searchInput = document.getElementById('feedback-search-input');
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
    document.getElementById('btn-clear-search')?.classList.add('hidden');
    renderFeedbackList();
};

window.resetAllFeedbackFilters = function () {
    searchQuery = '';
    const searchInput = document.getElementById('feedback-search-input');
    if (searchInput) searchInput.value = '';
    document.getElementById('btn-clear-search')?.classList.add('hidden');

    currentSocialTab = 'latest';
    selectedCategoryTag = 'all';

    window.switchSocialTab('latest');
    window.selectCategoryTag('all');
    updateKpiActiveVisual('all');
};

function renderTrendingTopics() {
    const container = document.getElementById('trending-topics-list');
    if (!container) return;

    if (!Array.isArray(feedbackItems) || feedbackItems.length === 0) {
        container.innerHTML = `<div class="text-[11px] text-slate-400 py-2 text-center">Belum ada topik aktif.</div>`;
        return;
    }

    const counts = {};
    feedbackItems.forEach(item => {
        const cat = item.category || 'Saran, Aspirasi & Pengaduan Umum';
        counts[cat] = (counts[cat] || 0) + 1;
    });

    const sortedCats = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const friendlyShortNames = {
        'Sarana Prasarana & Laboratorium': 'Sarpras & Lab',
        'Akademik & Pembelajaran': 'Akademik',
        'Kesiswaan & Kedisiplinan': 'Kesiswaan',
        'Pelayanan Tata Usaha & Administrasi': 'Tata Usaha',
        'Hubungan Masyarakat & Informasi': 'Humas',
        'Sistem Informasi': 'Sistem Informasi',
        'Saran, Aspirasi & Pengaduan Umum': 'Aspirasi Umum'
    };

    container.innerHTML = sortedCats.map(([cat, count]) => {
        const shortName = friendlyShortNames[cat] || cat;
        const icon = getCategoryIcon(cat);
        const isSelected = selectedCategoryTag === cat;
        return `
            <button type="button" onclick="window.selectCategoryTag('${escapeHTML(cat)}')" class="w-full flex items-center justify-between p-2 rounded-xl text-left text-xs transition-all cursor-pointer ${isSelected ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-extrabold border border-blue-200 dark:border-blue-900' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300 font-medium'}">
                <span class="flex items-center gap-2 truncate">
                    <i class="fa-solid ${icon} text-[10px] shrink-0"></i>
                    <span class="truncate">#${escapeHTML(shortName)}</span>
                </span>
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isSelected ? 'bg-blue-200/60 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'} shrink-0">${count}</span>
            </button>
        `;
    }).join('');
}

function getCategoryIcon(cat = '') {
    if (cat.includes('Akademik')) return 'fa-graduation-cap text-blue-500';
    if (cat.includes('Kesiswaan')) return 'fa-shield-halved text-amber-500';
    if (cat.includes('Sarana') || cat.includes('Laboratorium')) return 'fa-screwdriver-wrench text-orange-500';
    if (cat.includes('Tata Usaha') || cat.includes('Administrasi')) return 'fa-id-card text-emerald-500';
    if (cat.includes('Humas') || cat.includes('Informasi')) return 'fa-bullhorn text-cyan-500';
    if (cat.includes('Sistem')) return 'fa-laptop-code text-indigo-500';
    return 'fa-comments text-slate-500';
}

function extractWhatsAppNumber(contact = '') {
    if (!contact) return null;
    const digitsOnly = contact.replace(/\D/g, '');
    if (digitsOnly.length < 9 || digitsOnly.length > 15) return null;
    if (digitsOnly.startsWith('08')) {
        return '628' + digitsOnly.slice(2);
    }
    if (digitsOnly.startsWith('62')) {
        return digitsOnly;
    }
    if (digitsOnly.startsWith('8')) {
        return '62' + digitsOnly;
    }
    return null;
}

function getRelativeTime(value) {
    if (!value) return 'Baru saja';
    const date = (typeof window.parseUniversalDate === 'function')
        ? window.parseUniversalDate(value)
        : (value.toDate ? value.toDate() : new Date(value));
    if (!date || isNaN(date.getTime())) return 'Baru saja';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 45) return 'Baru saja';
    if (diffMin < 60) return `${diffMin} mnt lalu`;
    if (diffHour < 24) return `${diffHour} jam lalu`;
    if (diffDay === 1) return 'Kemarin';
    if (diffDay < 7) return `${diffDay} hari lalu`;

    return formatDateTime(date);
}

function getInitials(name = '') {
    if (!name || name === 'Anonim') return 'AN';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function resolveSenderPhoto(item, teachersMap = currentTeachersMap) {
    if (!item) return '';
    if (item.reporterType === 'anonim' || item.senderName === 'Anonim') return '';

    // 1. Direct photo URL jika tersimpan di item
    const directPhoto = item.senderPhoto || item.sender_photo;
    if (directPhoto) return resolvePhotoUrl(directPhoto);

    // 2. Jika pengirim adalah user aktif yang sedang login
    if (currentUser && item.senderUid && item.senderUid === currentUser.uid) {
        const myPhoto = localStorage.getItem(`cached_user_photo_${currentUser.uid}`) ||
            currentProfile?.photo ||
            currentUser?.photoURL;
        if (myPhoto) return resolvePhotoUrl(myPhoto);
    }

    // 3. Resolusi dari master GTK D1 (teachersMap) dengan multi-index (0 Firestore Read)
    if (teachersMap) {
        let t = null;
        if (item.senderUid) t = teachersMap.get(item.senderUid);
        if (!t && item.senderEmail) t = teachersMap.get(item.senderEmail.toLowerCase().trim());
        if (!t && item.senderName) t = teachersMap.get(item.senderName.toLowerCase().trim());

        if (t) {
            const raw = t.foto || t.photo_url || t.simasFoto;
            if (raw) return resolvePhotoUrl(raw);
        }
    }

    return '';
}

function renderUserAvatarHtml({ name = 'Pengguna', photoUrl = '', size = 'w-10 h-10 text-xs', isAnon = false, bgGradient = 'from-blue-600 to-indigo-600' } = {}) {
    if (isAnon) {
        return `
            <div class="${size} rounded-full bg-slate-700 text-slate-200 flex items-center justify-center shrink-0 shadow-2xs" title="Anonim">
                <i class="fa-solid fa-user-secret"></i>
            </div>
        `;
    }

    const initials = escapeHTML(getInitials(name));
    const safeName = escapeHTML(name || 'Pengguna');

    if (photoUrl) {
        const safeUrl = escapeHTML(photoUrl);
        return `
            <div class="${size} rounded-full bg-slate-100 dark:bg-slate-800 shrink-0 shadow-2xs overflow-hidden ring-1 ring-slate-200/80 dark:ring-slate-700 flex items-center justify-center">
                <img src="${safeUrl}" alt="${safeName}" class="w-full h-full object-cover rounded-full" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'font-extrabold text-white\\'>${initials}</span>'; this.parentElement.className='${size} rounded-full bg-gradient-to-tr ${bgGradient} text-white font-extrabold flex items-center justify-center shrink-0 shadow-2xs';">
            </div>
        `;
    }

    return `
        <div class="${size} rounded-full bg-gradient-to-tr ${bgGradient} text-white font-extrabold flex items-center justify-center shrink-0 shadow-2xs">
            ${initials}
        </div>
    `;
}

if (typeof window !== 'undefined') {
    window.resolveSenderPhoto = resolveSenderPhoto;
    window.renderUserAvatarHtml = renderUserAvatarHtml;
}

function renderFeedbackList() {
    const list = document.getElementById('feedback-list');
    if (!list) return;

    let filtered = Array.isArray(feedbackItems) ? [...feedbackItems] : [];

    // 1. Search Query filter
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(item => {
            const titleMatch = (item.title || '').toLowerCase().includes(q);
            const msgMatch = (item.message || '').toLowerCase().includes(q);
            const senderMatch = (item.senderName || '').toLowerCase().includes(q);
            const catMatch = (item.category || '').toLowerCase().includes(q);
            const contactMatch = (item.contactInfo || '').toLowerCase().includes(q);
            const repliesMatch = Array.isArray(item.replies) && item.replies.some(r =>
                (r.message || '').toLowerCase().includes(q) || (r.sender_name || '').toLowerCase().includes(q)
            );
            return titleMatch || msgMatch || senderMatch || catMatch || contactMatch || repliesMatch;
        });
    }

    // 2. Category Tag filter
    if (selectedCategoryTag !== 'all') {
        filtered = filtered.filter(item => (item.category || '').includes(selectedCategoryTag));
    }

    // 3. Social Tab filter / sort
    if (currentSocialTab === 'needs_response') {
        filtered = filtered.filter(item => (item.status || 'baru') === 'baru' || ['proses', 'direncanakan', 'butuh_info'].includes(item.status));
    } else if (currentSocialTab === 'completed') {
        filtered = filtered.filter(item => item.status === 'selesai' || item.status === 'ditolak');
    }

    // Sortir
    filtered.sort((a, b) => {
        if (currentSocialTab === 'popular') {
            const countA = Array.isArray(a.likes) ? a.likes.length : 0;
            const countB = Array.isArray(b.likes) ? b.likes.length : 0;
            if (countB !== countA) return countB - countA;
        }
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        return timeB - timeA;
    });

    // Toggle reset filters button
    const btnReset = document.getElementById('btn-reset-filters');
    if (btnReset) {
        const hasActiveFilter = Boolean(searchQuery) || (selectedCategoryTag !== 'all') || (currentSocialTab !== 'latest');
        btnReset.classList.toggle('hidden', !hasActiveFilter);
    }

    if (filtered.length === 0) {
        if (searchQuery) {
            list.innerHTML = `
                <div class="text-center py-14 px-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs">
                    <div class="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center text-xl mx-auto mb-2.5">
                        <i class="fa-solid fa-magnifying-glass"></i>
                    </div>
                    <h3 class="text-sm font-extrabold text-slate-700 dark:text-slate-200">Tidak ada aspirasi yang cocok</h3>
                    <p class="text-xs text-slate-400 mt-1 max-w-sm mx-auto">Tidak ditemukan hasil pencarian untuk kata kunci "${escapeHTML(searchQuery)}".</p>
                    <button type="button" onclick="window.clearFeedbackSearch()" class="mt-3.5 px-3.5 py-1.5 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 text-xs font-bold rounded-xl border border-blue-200 dark:border-blue-800 hover:bg-blue-100 transition-colors cursor-pointer">
                        Bersihkan Pencarian
                    </button>
                </div>
            `;
            return;
        }

        const msg = currentSocialTab === 'completed'
            ? 'Belum ada aspirasi dengan status selesai.'
            : (currentSocialTab === 'needs_response'
                ? 'Semua aspirasi saat ini telah direspon!'
                : 'Belum ada aspirasi yang diposting.');
        list.innerHTML = `
            <div class="text-center py-14 px-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs">
                <div class="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-500 flex items-center justify-center text-xl mx-auto mb-2.5">
                    <i class="fa-solid fa-inbox"></i>
                </div>
                <h3 class="text-sm font-extrabold text-slate-700 dark:text-slate-200">${escapeHTML(msg)}</h3>
                <p class="text-xs text-slate-400 mt-1">Jadilah yang pertama menyampaikan ide konstruktif atau usulan perbaikan.</p>
                <button type="button" onclick="window.openFeedbackModal()" class="mt-3.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold rounded-xl shadow-xs transition-all active:scale-95 cursor-pointer">
                    <i class="fa-solid fa-pen-to-square mr-1.5"></i>Tulis Aspirasi Baru
                </button>
            </div>
        `;
        return;
    }

    const canRespond = isFeedbackAdmin();

    // Jika tab aktif adalah 'completed', tampilkan semua masukan selesai secara langsung
    if (currentSocialTab === 'completed') {
        list.innerHTML = filtered.map(item => renderFeedbackItem(item, canRespond)).join('');
        return;
    }

    // Untuk tab lainnya ('latest', 'popular', 'needs_response'): Pisahkan masukan aktif vs arsip selesai/ditolak
    const activeItems = filtered.filter(item => !['selesai', 'ditolak'].includes(item.status));
    const archivedItems = filtered.filter(item => ['selesai', 'ditolak'].includes(item.status));

    let mainHtml = '';
    if (activeItems.length > 0) {
        mainHtml += activeItems.map(item => renderFeedbackItem(item, canRespond)).join('');
    } else {
        mainHtml += `
            <div class="text-center py-10 px-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs">
                <div class="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-500 flex items-center justify-center text-lg mx-auto mb-2">
                    <i class="fa-solid fa-circle-check"></i>
                </div>
                <h3 class="text-xs sm:text-sm font-extrabold text-slate-700 dark:text-slate-200">Semua Aspirasi Aktif Telah Ditindaklanjuti</h3>
                <p class="text-xs text-slate-400 mt-0.5">Tidak ada aspirasi aktif saat ini. Anda dapat meninjau riwayat aspirasi tuntas pada arsip di bawah.</p>
            </div>
        `;
    }

    // Akordeon Masukan Selesai / Ditolak (Collapsed by Default)
    if (archivedItems.length > 0) {
        mainHtml += `
            <div class="mt-6 pt-4 border-t border-slate-200/80 dark:border-slate-800">
                <button type="button" onclick="window.toggleArchivedFeedbackSection()" class="w-full flex items-center justify-between p-3.5 bg-slate-100/80 dark:bg-slate-800/60 hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-2xl transition-all cursor-pointer">
                    <div class="flex items-center gap-2.5">
                        <span class="w-7 h-7 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs">
                            <i class="fa-solid fa-box-archive"></i>
                        </span>
                        <span class="text-xs font-bold text-slate-700 dark:text-slate-200">
                            Aspirasi Selesai & Ditutup (${archivedItems.length})
                        </span>
                    </div>
                    <div class="flex items-center gap-1.5 text-xs text-slate-400">
                        <span id="label-toggle-archived" class="text-[11px] font-semibold">Tampilkan</span>
                        <i id="icon-toggle-archived" class="fa-solid fa-chevron-down text-[10px] transition-transform duration-200"></i>
                    </div>
                </button>
                <div id="archived-feedback-list" class="hidden mt-3.5 space-y-3.5">
                    ${archivedItems.map(item => renderFeedbackItem(item, canRespond)).join('')}
                </div>
            </div>
        `;
    }

    list.innerHTML = mainHtml;
}

window.toggleArchivedFeedbackSection = function () {
    const archiveList = document.getElementById('archived-feedback-list');
    const label = document.getElementById('label-toggle-archived');
    const icon = document.getElementById('icon-toggle-archived');
    if (!archiveList) return;
    const isHidden = archiveList.classList.contains('hidden');
    archiveList.classList.toggle('hidden', !isHidden);
    if (label) label.textContent = isHidden ? 'Sembunyikan' : 'Tampilkan';
    if (icon) icon.classList.toggle('rotate-180', isHidden);
};

function renderMiniProgressBar(status = 'baru') {
    const isNew = status === 'baru';
    const isProcess = ['proses', 'direncanakan', 'butuh_info'].includes(status);
    const isDone = status === 'selesai';
    const isRejected = status === 'ditolak';

    const step1Active = true;
    const step2Active = isProcess || isDone || isRejected;
    const step3Active = isDone || isRejected;

    const step1Color = 'text-blue-600 dark:text-blue-400 font-extrabold';
    const step2Color = step2Active
        ? (isProcess ? 'text-amber-600 dark:text-amber-400 font-extrabold' : 'text-slate-600 dark:text-slate-300 font-bold')
        : 'text-slate-400 dark:text-slate-500 font-normal';
    const step3Color = isDone
        ? 'text-emerald-600 dark:text-emerald-400 font-extrabold'
        : (isRejected ? 'text-rose-600 dark:text-rose-400 font-extrabold' : 'text-slate-400 dark:text-slate-500 font-normal');

    const line1Color = step2Active ? (isProcess ? 'bg-amber-400 dark:bg-amber-500' : 'bg-blue-400 dark:bg-blue-500') : 'bg-slate-200 dark:bg-slate-700';
    const line2Color = isDone ? 'bg-emerald-500 dark:bg-emerald-400' : (isRejected ? 'bg-rose-500 dark:bg-rose-400' : 'bg-slate-200 dark:bg-slate-700');

    const step3Label = isRejected ? 'Ditolak' : 'Selesai';
    const step3Icon = isRejected ? 'fa-circle-xmark' : 'fa-circle-check';

    return `
        <div class="py-1.5 px-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800/70 mb-3">
            <div class="flex items-center justify-between text-[10px] sm:text-[11px]">
                <div class="flex items-center gap-1.5 ${step1Color}">
                    <i class="fa-solid fa-circle-dot text-[9px]"></i>
                    <span>Diterima</span>
                </div>
                <div class="flex-1 mx-2 h-0.5 ${line1Color} rounded-full transition-colors"></div>
                <div class="flex items-center gap-1.5 ${step2Color}">
                    <i class="fa-solid ${isProcess ? 'fa-arrows-rotate fa-spin' : 'fa-clock'} text-[9px]"></i>
                    <span>Diproses</span>
                </div>
                <div class="flex-1 mx-2 h-0.5 ${line2Color} rounded-full transition-colors"></div>
                <div class="flex items-center gap-1.5 ${step3Color}">
                    <i class="fa-solid ${step3Icon} text-[9px]"></i>
                    <span>${step3Label}</span>
                </div>
            </div>
        </div>
    `;
}

function renderFeedbackItem(item, canRespond) {
    const status = item.status || 'baru';
    const style = statusStyles[status] || statusStyles.baru;
    const likesArray = Array.isArray(item.likes) ? item.likes : [];
    const likeCount = likesArray.length;
    const isLiked = Boolean(currentUser && likesArray.includes(currentUser.uid));

    const targetBadges = {
        kepala_sekolah: { label: 'Kepsek', icon: 'fa-user-tie' },
        wakasek_kurikulum: { label: 'Kurikulum', icon: 'fa-book-open' },
        kesiswaan: { label: 'Kesiswaan', icon: 'fa-shield-halved' },
        humas: { label: 'Humas', icon: 'fa-bullhorn' },
        sarpras: { label: 'Sarpras', icon: 'fa-screwdriver-wrench' },
        kepala_lab: { label: 'Kepala Lab', icon: 'fa-flask' },
        staff: { label: 'Tata Usaha', icon: 'fa-id-card' },
        guru: { label: 'Guru', icon: 'fa-chalkboard-user' },
        super_admin: { label: 'Super Admin', icon: 'fa-gear' }
    };

    // Resolusi nama sasaran multi-target
    const rawTargets = String(item.targetRecipient || 'super_admin').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const targetNames = rawTargets.map(t => targetBadges[t]?.label || targetLabels[t] || t);
    const targetDisplayText = targetNames.length > 0 ? targetNames.join(', ') : 'Super Admin';
    const targetIcon = targetBadges[rawTargets[0]]?.icon || 'fa-bullseye';

    const isPublic = item.senderRole === 'public' || item.reporterType === 'tamu_umum' || item.reporterType === 'anonim';
    const reporterLabel = reporterLabels[item.reporterType] || (isPublic ? 'Publik' : 'Internal');

    const reporterBadge = isPublic
        ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-900"><i class="fa-solid fa-earth-americas text-[8px]"></i>${reporterLabel}</span>`
        : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"><i class="fa-solid fa-user-check text-[8px]"></i>${reporterLabel}</span>`;

    let allReplies = [];
    if (Array.isArray(item.replies) && item.replies.length > 0) {
        allReplies = [...item.replies];
    } else if (item.responseText) {
        allReplies.push({
            id: 'legacy-resp-' + item.id,
            sender_uid: item.responseByUid || 'leadership',
            sender_name: item.responseByName || 'Pimpinan',
            sender_role: 'leadership',
            sender_type: 'leadership',
            message: item.responseText,
            created_at: item.respondedAt || item.updatedAt || item.createdAt
        });
    }

    const userEmail = (currentUser?.email || '').toLowerCase().trim();
    const itemEmail = (item.senderEmail || '').toLowerCase().trim();
    const isReporter = Boolean(currentUser && (
        (item.senderUid && item.senderUid === currentUser.uid) ||
        (userEmail && itemEmail && userEmail === itemEmail)
    ));
    const canReply = Boolean(currentUser && (isReporter || isGtkUser()));
    const canEditThisStatus = !['selesai', 'ditolak'].includes(String(item.status || '').toLowerCase()) || isSuperAdmin();
    const showEditButton = (isReporter && canEditThisStatus) || isSuperAdmin();

    let waButton = '';
    if (isPublic && item.contactInfo && isFeedbackAdmin()) {
        const waNumber = extractWhatsAppNumber(item.contactInfo);
        if (waNumber) {
            const textPrompt = `Halo ${item.senderName || 'Bapak/Ibu'}, kami dari Manajemen SMANTARA menindaklanjuti masukan Anda "${item.title || 'Aduan Sekolah'}"...`;
            const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(textPrompt)}`;
            waButton = `
                <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition-all shadow-2xs active:scale-95" title="Hubungi via WhatsApp">
                    <i class="fa-brands fa-whatsapp text-xs"></i>
                    <span class="hidden sm:inline">WA</span>
                </a>
            `;
        }
    }

    const friendlyShortNames = {
        'Web App SIMAS-SHAKTI': "SIMAS-CERDAS",
        'Sistem Informasi': 'Sistem SIMAS',
        'Sarana Prasarana & Laboratorium': 'Sarpras & Lab',
        'Akademik & Pembelajaran': 'Akademik',
        'Kesiswaan & Kedisiplinan': 'Kesiswaan',
        'Pelayanan Tata Usaha & Administrasi': 'Tata Usaha',
        'Hubungan Masyarakat & Informasi': 'Humas',
        'Saran, Aspirasi & Pengaduan Umum': 'Aspirasi Umum'
    };
    const categoryTag = friendlyShortNames[item.category] || item.category || 'Umum';

    const isAnon = item.reporterType === 'anonim' || item.senderName === 'Anonim';
    const senderPhotoUrl = resolveSenderPhoto(item, currentTeachersMap);
    const senderAvatarHtml = renderUserAvatarHtml({
        name: item.senderName || 'Anonim',
        photoUrl: senderPhotoUrl,
        size: 'w-10 h-10 text-xs',
        isAnon: isAnon,
        bgGradient: 'from-blue-600 to-indigo-600'
    });

    const currentUserSender = getSenderInfo();

    return `
        <article id="card-${item.id}" class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs hover:shadow-md transition-all duration-200 p-4 sm:p-5 flex flex-col justify-between overflow-hidden">
            <div>
                <!-- Baris Atas: Profil Pengirim (Kiri) dan Status Badge (Kanan) -->
                <div class="flex items-start justify-between gap-2 mb-2.5">
                    <div class="flex items-center gap-3 min-w-0 flex-1">
                        ${senderAvatarHtml}
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100 truncate" title="${escapeHTML(item.senderName || 'Anonim')}">
                                    ${escapeHTML(item.senderName || 'Anonim')}
                                </span>
                                ${reporterBadge}
                            </div>
                            
                            <!-- Baris Compact: Waktu Relatif • Kepada Sasaran • Tagar Kategori (Sebaris Sesuai Arahan User) -->
                            <div class="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-tight">
                                <span class="inline-flex items-center gap-1 text-slate-400 dark:text-slate-500 whitespace-nowrap" title="${formatDateTime(item.createdAt)}">
                                    <i class="fa-regular fa-clock text-[10px]"></i>
                                    <span>${getRelativeTime(item.createdAt)}</span>
                                    ${(item.editedAt || item.edited_at) ? `<span class="italic text-[9px] text-slate-400 ml-0.5">(diedit)</span>` : ''}
                                </span>
                                <span class="text-slate-300 dark:text-slate-700 select-none">•</span>
                                <span class="inline-flex items-center gap-1 font-semibold text-slate-600 dark:text-slate-300" title="Tujuan: ${escapeHTML(targetDisplayText)}">
                                    <i class="fa-solid ${targetIcon} text-blue-500 text-[10px]"></i>
                                    <span class="truncate max-w-[140px] sm:max-w-[200px]">Kepada: ${escapeHTML(targetDisplayText)}</span>
                                </span>
                                <span class="text-slate-300 dark:text-slate-700 select-none">•</span>
                                <span class="inline-flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400">
                                    <i class="fa-solid ${getCategoryIcon(item.category)} text-[10px]"></i>
                                    <span>#${escapeHTML(categoryTag)}</span>
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="shrink-0 flex items-center gap-1.5">
                        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] font-extrabold ${style.badge} whitespace-nowrap">
                            <span class="w-1.5 h-1.5 rounded-full ${style.dot} animate-pulse"></span>
                            <span>${style.label}</span>
                        </span>
                    </div>
                </div>

                <!-- Mini Progress Bar Tahap Penanganan (Diterima -> Diproses -> Selesai) -->
                ${renderMiniProgressBar(status)}

                <!-- Judul & Isi Aspirasi -->
                <div class="mb-3">
                    <h3 class="text-sm sm:text-base font-black text-slate-900 dark:text-white leading-snug tracking-tight mb-1.5 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer" onclick="window.toggleFeedbackExpand('${item.id}')" title="${escapeHTML(item.title || '-')}">
                        ${escapeHTML(item.title || '-')}
                    </h3>
                    <div class="text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-line">
                        ${escapeHTML(item.message || '')}
                    </div>
                </div>

                <!-- Preview Sumber Halaman (Jika ada) -->
                ${item.sourceUrl ? `
                <div class="mb-3 p-2.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/50 flex items-center gap-2 text-xs truncate">
                    <i class="fa-solid fa-link text-blue-500 text-[11px] shrink-0"></i>
                    <span class="text-slate-500 dark:text-slate-400 shrink-0">Sumber:</span>
                    <strong class="text-blue-600 dark:text-blue-400 font-semibold truncate">${escapeHTML(item.sourceUrl)}</strong>
                </div>
                ` : ''}
            </div>

            <!-- Action Bar Bawah (Engagement Ala Media Sosial) -->
            <div class="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800/80 mt-1">
                <div class="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                    <!-- Tombol Like / Upvote Aspirasi -->
                    <button type="button" 
                            onclick="window.toggleFeedbackLike('${item.id}', this)" 
                            id="btn-like-${item.id}"
                            class="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs font-bold transition-all active:scale-95 group cursor-pointer ${isLiked ? 'bg-rose-50 border-rose-200 text-rose-600 dark:bg-rose-950/50 dark:border-rose-800 dark:text-rose-300 shadow-2xs' : 'border-slate-200 dark:border-slate-700 hover:bg-rose-50/60 hover:text-rose-600 dark:hover:bg-rose-950/30 dark:hover:text-rose-300 text-slate-600 dark:text-slate-300'}" 
                            title="${isLiked ? 'Batalkan dukungan' : 'Beri dukungan (Like) aspirasi ini'}">
                        <i class="${isLiked ? 'fa-solid text-rose-500' : 'fa-regular text-slate-400 group-hover:text-rose-500'} fa-heart text-xs transition-transform group-hover:scale-110"></i>
                        <span class="like-counter font-black">${likeCount}</span>
                        <span class="hidden sm:inline font-semibold">Dukung</span>
                    </button>

                    <!-- Tombol Komentar / Buka Percakapan -->
                    <button type="button" 
                            onclick="window.toggleFeedbackExpand('${item.id}')" 
                            class="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-blue-50/60 hover:text-blue-600 dark:hover:bg-slate-800 dark:hover:text-blue-400 text-slate-600 dark:text-slate-300 text-xs font-bold transition-all active:scale-95 cursor-pointer" 
                            title="Buka / Tutup Diskusi">
                        <i class="fa-regular fa-comment text-xs text-blue-500"></i>
                        <span class="font-black">${allReplies.length}</span>
                        <span class="hidden sm:inline font-semibold">Balasan</span>
                        <i id="expand-icon-${item.id}" class="fa-solid fa-chevron-down text-[9px] text-slate-400 transition-transform duration-200"></i>
                    </button>

                    <!-- Tombol Salin Tautan -->
                    <button type="button" 
                            onclick="window.copyFeedbackLink('${item.id}')" 
                            class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs font-bold transition-all active:scale-95 cursor-pointer" 
                            title="Salin Tautan Aspirasi">
                        <i class="fa-solid fa-share-nodes text-xs"></i>
                        <span class="hidden sm:inline">Bagikan</span>
                    </button>

                    ${waButton}
                </div>

                <div class="flex items-center gap-1.5 shrink-0 ml-auto">
                    ${showEditButton ? `
                    <button type="button" onclick="window.openEditFeedback('${item.id}')" class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-blue-50/70 hover:text-blue-600 dark:hover:bg-slate-800 dark:hover:text-blue-400 text-slate-600 dark:text-slate-300 text-xs font-bold transition-all active:scale-95 cursor-pointer" title="Edit Aspirasi">
                        <i class="fa-solid fa-pen-to-square text-xs text-blue-500"></i>
                        <span class="hidden sm:inline">Edit</span>
                    </button>
                    ` : ''}

                    ${canRespond ? `
                    <button type="button" onclick="window.openFeedbackResponse('${item.id}')" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 dark:bg-slate-800 dark:hover:bg-slate-700 text-white text-xs font-extrabold transition-all shadow-2xs active:scale-95 cursor-pointer" title="Tanggapi Status">
                        <i class="fa-solid fa-sliders text-xs text-blue-400"></i>
                        <span>Tanggapi</span>
                    </button>
                    ` : ''}

                    ${isSuperAdmin() ? `
                    <button type="button" onclick="window.deleteFeedback('${item.id}')" class="p-1.5 rounded-xl text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer" title="Hapus Masukan">
                        <i class="fa-solid fa-trash text-xs"></i>
                    </button>
                    ` : ''}
                </div>
            </div>

            <!-- Thread Percakapan (Inline Expanded Body) -->
            <div id="expanded-body-${item.id}" class="hidden border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-3.5 sm:p-4 mt-3 rounded-xl space-y-3">
                <div class="flex items-center justify-between pb-1.5 border-b border-slate-200/60 dark:border-slate-800">
                    <h4 class="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <i class="fa-solid fa-comments text-blue-500"></i>
                        <span>Percakapan & Tindak Lanjut (${allReplies.length})</span>
                    </h4>
                    <span class="text-[10px] text-slate-400">Diskusi civitas & respon pimpinan</span>
                </div>

                ${allReplies.length === 0 ? `
                <div class="text-center py-5 text-slate-400">
                    <i class="fa-regular fa-comment-dots text-2xl mb-1.5 opacity-60"></i>
                    <p class="text-xs font-medium">Belum ada balasan pada aspirasi ini.</p>
                </div>
                ` : `
                <div class="space-y-2.5">
                    ${allReplies.map(reply => {
                        const isLeadershipReply = reply.sender_type === 'leadership' || reply.sender_role === 'leadership' || ['super_admin', 'kepala_sekolah', 'kesiswaan', 'wakasek_kurikulum', 'kepala_lab', 'humas', 'sarpras'].includes(reply.sender_role);
                        const isReporterReply = reply.sender_type === 'reporter' || (reply.sender_uid && reply.sender_uid === item.senderUid);
                        const isMyReply = Boolean(currentUser && (reply.sender_uid === currentUser.uid || isSuperAdmin()));
                        const isEdited = Boolean(reply.edited_at);

                        // Resolusi foto profil pembalas
                        let replyPhotoUrl = reply.sender_photo ? resolvePhotoUrl(reply.sender_photo) : '';
                        if (!replyPhotoUrl && reply.sender_uid && currentUser && reply.sender_uid === currentUser.uid) {
                            const myCached = localStorage.getItem(`cached_user_photo_${currentUser.uid}`) || currentProfile?.photo || currentUser?.photoURL;
                            if (myCached) replyPhotoUrl = resolvePhotoUrl(myCached);
                        }
                        if (!replyPhotoUrl && currentTeachersMap) {
                            let t = null;
                            if (reply.sender_uid) t = currentTeachersMap.get(reply.sender_uid);
                            if (!t && reply.sender_name) t = currentTeachersMap.get(reply.sender_name.toLowerCase().trim());
                            if (t) replyPhotoUrl = resolvePhotoUrl(t.foto || t.photo_url || t.simasFoto);
                        }

                        let badgeHtml = '';
                        let bubbleBg = '';
                        let gradient = 'from-indigo-600 to-purple-600';

                        if (isLeadershipReply) {
                            bubbleBg = 'bg-emerald-50/90 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60 text-emerald-950 dark:text-emerald-100';
                            gradient = 'from-emerald-600 to-teal-600';
                            badgeHtml = `
                                <span class="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-600 text-white flex items-center gap-1">
                                    <i class="fa-solid fa-shield-halved text-[8px]"></i> Pimpinan Sekolah
                                </span>
                            `;
                        } else if (isReporterReply) {
                            bubbleBg = 'bg-blue-50/80 dark:bg-blue-950/20 border-blue-200/80 dark:border-blue-900/60 text-slate-800 dark:text-slate-100';
                            gradient = 'from-blue-600 to-indigo-600';
                            badgeHtml = `
                                <span class="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-blue-600 text-white flex items-center gap-1">
                                    <i class="fa-solid fa-user text-[8px]"></i> Pengirim
                                </span>
                            `;
                        } else {
                            bubbleBg = 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 text-slate-800 dark:text-slate-100';
                            const gtkRoleLabel = roleLabels[reply.sender_role] || "GTK SMANTARA";
                            badgeHtml = `
                                <span class="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-indigo-600 text-white flex items-center gap-1">
                                    <i class="fa-solid fa-chalkboard-user text-[8px]"></i> ${escapeHTML(gtkRoleLabel)}
                                </span>
                            `;
                        }

                        const replyAvatarHtml = renderUserAvatarHtml({
                            name: reply.sender_name || 'Pengguna',
                            photoUrl: replyPhotoUrl,
                            size: 'w-6 h-6 text-[10px]',
                            isAnon: false,
                            bgGradient: gradient
                        });

                        return `
                            <div class="rounded-xl p-3 border shadow-2xs ${bubbleBg}">
                                <div class="flex flex-wrap items-center justify-between gap-1 mb-1">
                                    <div class="flex items-center gap-1.5 min-w-0">
                                        ${replyAvatarHtml}
                                        ${badgeHtml}
                                        <span class="font-extrabold text-xs text-slate-800 dark:text-slate-100 truncate">${escapeHTML(reply.sender_name || 'Pengguna')}</span>
                                    </div>
                                    <div class="flex items-center gap-1.5 shrink-0">
                                        ${isEdited ? `<span class="text-[9px] text-slate-400 dark:text-slate-500 italic" title="Diedit ${formatDateTime(reply.edited_at)}">(diedit)</span>` : ''}
                                        <span class="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap" title="${formatDateTime(reply.created_at)}">
                                            ${getRelativeTime(reply.created_at)}
                                        </span>
                                        ${isMyReply ? `
                                        <button type="button" onclick="window.openEditReply('${item.id}', '${reply.id}')" class="p-1 rounded-md text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer" title="Edit Balasan">
                                            <i class="fa-solid fa-pen text-[10px]"></i>
                                        </button>
                                        ` : ''}
                                    </div>
                                </div>
                                <p class="text-xs leading-relaxed whitespace-pre-line pl-7 sm:pl-7.5">${escapeHTML(reply.message || '')}</p>
                            </div>
                        `;
                    }).join('')}
                </div>
                `}

                <!-- Quick Inline Reply Input Box (Bebas Icon Leading) -->
                ${canReply ? `
                <div class="pt-2 border-t border-slate-200/80 dark:border-slate-800">
                    <div class="flex items-start gap-2">
                        <div class="hidden sm:block shrink-0 mt-0.5">
                            ${renderUserAvatarHtml({
                                name: currentUserSender.name,
                                photoUrl: currentUserSender.photo,
                                size: 'w-7 h-7 text-[10px]',
                                bgGradient: 'from-blue-600 to-indigo-600'
                            })}
                        </div>
                        <div class="flex-1 flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
                            <div class="relative flex-1">
                                <textarea id="inline-reply-${item.id}" rows="2" maxlength="1500" placeholder="Ketik balasan atau klarifikasi..." class="w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 outline-none resize-none transition-all shadow-2xs"></textarea>
                            </div>
                            <button type="button" onclick="window.submitInlineReply('${item.id}', this)" class="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow-xs transition-all active:scale-95 shrink-0 cursor-pointer">
                                <i class="fa-solid fa-paper-plane text-[10px]"></i>
                                <span>Kirim</span>
                            </button>
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>
        </article>
    `;
}

window.copyFeedbackLink = function (id) {
    const url = new URL(window.location.href);
    url.searchParams.set('feedback_id', id);
    if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(url.toString()).then(() => {
            showToast('Tautan Disalin', 'Tautan aspirasi berhasil disalin ke papan klip.', 'success');
        }).catch(() => {
            showToast('Tautan Aspirasi', url.toString(), 'info');
        });
    } else {
        showToast('Tautan Aspirasi', url.toString(), 'info');
    }
};

window.toggleFeedbackExpand = function (id) {
    const body = document.getElementById(`expanded-body-${id}`);
    const icon = document.getElementById(`expand-icon-${id}`);
    if (!body || !icon) return;

    if (body.classList.contains('hidden')) {
        body.classList.remove('hidden');
        icon.classList.add('rotate-180');
    } else {
        body.classList.add('hidden');
        icon.classList.remove('rotate-180');
    }
};

window.toggleFeedbackLike = async function (feedbackId, btnEl) {
    if (!currentUser) {
        showToast('Perlu Login', 'Silakan masuk ke akun Anda terlebih dahulu untuk memberikan dukungan pada aspirasi ini.', 'warning');
        return;
    }

    const item = feedbackItems.find(f => f.id === feedbackId);
    if (!item) {
        showToast('Error', 'Data masukan tidak ditemukan.', 'error');
        return;
    }

    const uid = currentUser.uid;
    const initialLikes = Array.isArray(item.likes) ? [...item.likes] : [];
    const wasLiked = initialLikes.includes(uid);
    const newLiked = !wasLiked;

    // Optimistic UI update pada state lokal
    if (newLiked) {
        item.likes = [...initialLikes, uid];
    } else {
        item.likes = initialLikes.filter(u => u !== uid);
    }

    // Update elemen DOM tombol secara instan (zero latency)
    if (btnEl) {
        const counterEl = btnEl.querySelector('.like-counter');
        const iconEl = btnEl.querySelector('.fa-heart');
        if (counterEl) counterEl.textContent = item.likes.length;
        if (iconEl) {
            if (newLiked) {
                iconEl.className = 'fa-solid text-rose-500 fa-heart text-xs transition-transform group-hover:scale-110';
                btnEl.className = 'inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs font-bold transition-all active:scale-95 group bg-rose-50 border-rose-200 text-rose-600 dark:bg-rose-950/50 dark:border-rose-800 dark:text-rose-300 shadow-2xs cursor-pointer';
                btnEl.title = 'Batalkan dukungan';
            } else {
                iconEl.className = 'fa-regular text-slate-400 group-hover:text-rose-500 fa-heart text-xs transition-transform group-hover:scale-110';
                btnEl.className = 'inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs font-bold transition-all active:scale-95 group border-slate-200 dark:border-slate-700 hover:bg-rose-50/60 hover:text-rose-600 dark:hover:bg-rose-950/30 dark:hover:text-rose-300 text-slate-600 dark:text-slate-300 cursor-pointer';
                btnEl.title = 'Beri dukungan (Like) aspirasi ini';
            }
        }
    }

    try {
        const res = await callSecureEdgeFunction('toggle-feedback-like', { id: feedbackId });

        if (res && Array.isArray(res.likes)) {
            item.likes = res.likes;
            if (btnEl) {
                const counterEl = btnEl.querySelector('.like-counter');
                if (counterEl) counterEl.textContent = item.likes.length;
            }
            try {
                sessionStorage.setItem(FEEDBACK_CACHE_KEY, JSON.stringify(feedbackItems));
            } catch (e) {}
        }

        if (currentSocialTab === 'popular') {
            renderFeedbackList();
        }
    } catch (error) {
        console.error('[Masukan] Gagal toggle like:', error);
        // Rollback state lokal & DOM jika terjadi kegagalan jaringan
        item.likes = initialLikes;
        if (btnEl) {
            const counterEl = btnEl.querySelector('.like-counter');
            const iconEl = btnEl.querySelector('.fa-heart');
            if (counterEl) counterEl.textContent = initialLikes.length;
            if (iconEl) {
                if (wasLiked) {
                    iconEl.className = 'fa-solid text-rose-500 fa-heart text-xs transition-transform group-hover:scale-110';
                    btnEl.className = 'inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs font-bold transition-all active:scale-95 group bg-rose-50 border-rose-200 text-rose-600 dark:bg-rose-950/50 dark:border-rose-800 dark:text-rose-300 shadow-2xs cursor-pointer';
                    btnEl.title = 'Batalkan dukungan';
                } else {
                    iconEl.className = 'fa-regular text-slate-400 group-hover:text-rose-500 fa-heart text-xs transition-transform group-hover:scale-110';
                    btnEl.className = 'inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs font-bold transition-all active:scale-95 group border-slate-200 dark:border-slate-700 hover:bg-rose-50/60 hover:text-rose-600 dark:hover:bg-rose-950/30 dark:hover:text-rose-300 text-slate-600 dark:text-slate-300 cursor-pointer';
                    btnEl.title = 'Beri dukungan (Like) aspirasi ini';
                }
            }
        }
        showToast('Gagal Dukung', error.message || 'Tidak dapat memperbarui dukungan saat ini.', 'error');
    }
};

window.openFeedbackResponse = function (feedbackId) {
    const item = feedbackItems.find(entry => entry.id === feedbackId);
    if (!item || !isFeedbackAdmin()) return;

    const validStatuses = ['proses', 'direncanakan', 'butuh_info', 'selesai', 'ditolak'];
    document.getElementById('response-feedback-id').value = feedbackId;
    document.getElementById('response-status').value = validStatuses.includes(item.status) ? item.status : 'proses';
    document.getElementById('response-text').value = item.responseText || '';
    document.getElementById('response-modal-title').textContent = item.title || feedbackId;

    const modal = document.getElementById('response-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
};

window.closeFeedbackResponse = function () {
    const modal = document.getElementById('response-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

async function saveFeedbackResponse(event) {
    event.preventDefault();

    const id = document.getElementById('response-feedback-id').value;
    const status = document.getElementById('response-status').value;
    const text = document.getElementById('response-text').value.trim();
    const button = document.getElementById('btn-save-response');

    if (!id || !text) {
        showToast('Belum lengkap', 'Tanggapan atau alasan wajib diisi.', 'warning');
        return;
    }

    const sender = getSenderInfo();

    try {
        setButtonLoading(button, true, 'Menyimpan...');
        // Update via Edge Function Secure Proxy
        await callSecureEdgeFunction('tanggapi-feedback', {
            id,
            status,
            response_text: text,
            response_by_name: sender.name
        });

        window.closeFeedbackResponse();
        showToast('Tanggapan Tersimpan', 'Status penanganan aspirasi telah diperbarui.', 'success');

        // Pemicu Notifikasi Push ke Pengirim Masukan
        const targetFeedback = feedbackItems.find(f => f.id === id);
        if (targetFeedback?.senderUid && targetFeedback.senderUid !== currentUser?.uid) {
            try {
                if (cfClient && typeof cfClient.sendPushNotification === 'function') {
                    await cfClient.sendPushNotification({
                        title: `Tanggapan Aspirasi: ${targetFeedback.title || 'Aspirasi Sekolah'}`,
                        body: `${sender.name}: ${text.slice(0, 120)}`,
                        url: './masukan.html',
                        targetType: 'user',
                        targetValue: targetFeedback.senderUid
                    });
                }
            } catch (pushErr) {
                console.warn('[Masukan] Push notification ke pengirim masukan dilewati:', pushErr?.message || pushErr);
            }
        }

        await loadFeedback(true);
    } catch (error) {
        console.error('[Masukan] Response failed:', error);
        showToast('Gagal menyimpan', error.message || 'Tanggapan belum bisa disimpan.', 'error');
    } finally {
        setButtonLoading(button, false);
    }
}

window.openFeedbackReply = function (feedbackId) {
    const item = feedbackItems.find(entry => entry.id === feedbackId);
    if (!item) return;

    const isReporter = currentUser && item.senderUid === currentUser.uid;
    const canReply = isReporter || isGtkUser();
    if (!canReply) {
        showToast('Akses Dibatasi', 'Hanya GTK (Guru/Staf) atau pengirim masukan yang dapat membalas pesan ini.', 'warning');
        return;
    }

    document.getElementById('reply-feedback-id').value = feedbackId;
    document.getElementById('reply-modal-title').textContent = item.title || feedbackId;
    const replyMsg = document.getElementById('reply-message');
    if (replyMsg) {
        replyMsg.value = '';
        const counter = document.getElementById('reply-char-count');
        if (counter) counter.textContent = '0/1500';
    }

    const modal = document.getElementById('reply-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => {
            replyMsg?.focus();
        }, 100);
    }
};

window.closeFeedbackReply = function () {
    const modal = document.getElementById('reply-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

async function sendFeedbackReply(id, message, sender, targetFeedback) {
    const isReporter = currentUser && targetFeedback.senderUid === currentUser.uid;

    let success = false;
    let lastError = null;

    // 1. Coba melalui Cloudflare Worker API (Rute utama terdeploy seketika di edge)
    try {
        if (cfClient && typeof cfClient.replyFeedback === 'function') {
            await cfClient.replyFeedback({
                id,
                message,
                senderName: sender.name,
                senderRole: sender.primaryRole || sender.role || 'guru_mapel',
                senderPhoto: sender.photo || ''
            });
            success = true;
        }
    } catch (cfErr) {
        lastError = cfErr;
        console.warn('[Masukan] Pengiriman balasan via Cloudflare Worker dialihkan ke Edge Function:', cfErr?.message || cfErr);
    }

    // 2. Fallback tangguh ke Supabase Edge Function secure-proxy
    if (!success) {
        try {
            await callSecureEdgeFunction('reply-feedback', {
                id,
                message,
                sender_name: sender.name,
                sender_role: sender.primaryRole || sender.role || 'guru_mapel',
                sender_photo: sender.photo || ''
            });
            success = true;
        } catch (error) {
            if (error?.message?.includes('Unknown action: reply-feedback') || (error?.message && error.message.includes('Unknown action'))) {
                throw new Error('Backend Edge Function belum diperbarui di server cloud Supabase (aksi reply-feedback belum terdeploy).');
            }
            throw lastError || error;
        }
    }

    // Pemicu Notifikasi Push ke lawan bicara
    try {
        if (cfClient && typeof cfClient.sendPushNotification === 'function') {
            if (isReporter) {
                if (targetFeedback.responseByUid && targetFeedback.responseByUid !== currentUser.uid) {
                    await cfClient.sendPushNotification({
                        title: `Balasan Aspirasi: ${targetFeedback.title || 'Aspirasi Sekolah'}`,
                        body: `${sender.name}: ${message.slice(0, 120)}`,
                        url: './masukan.html',
                        targetType: 'user',
                        targetValue: targetFeedback.responseByUid
                    });
                } else if (targetFeedback.targetRecipient) {
                    const replyRoles = targetFeedback.targetRecipient === 'all'
                        ? 'super_admin,kepala_sekolah,wakasek_kurikulum,kesiswaan,humas,sarpras,kepala_lab'
                        : targetFeedback.targetRecipient;
                    await cfClient.sendPushNotification({
                        title: `Balasan Aspirasi: ${targetFeedback.title || 'Aspirasi Sekolah'}`,
                        body: `${sender.name}: ${message.slice(0, 120)}`,
                        url: './masukan.html',
                        targetType: 'role',
                        targetValue: replyRoles
                    });
                }
            } else {
                if (targetFeedback.senderUid && targetFeedback.senderUid !== currentUser.uid) {
                    await cfClient.sendPushNotification({
                        title: `Tanggapan Aspirasi: ${targetFeedback.title || 'Aspirasi Sekolah'}`,
                        body: `${sender.name}: ${message.slice(0, 120)}`,
                        url: './masukan.html',
                        targetType: 'user',
                        targetValue: targetFeedback.senderUid
                    });
                }
            }
        }
    } catch (pushErr) {
        console.warn('[Masukan] Push notification balasan dilewati:', pushErr?.message || pushErr);
    }
}

async function submitReplyFeedback(event) {
    event.preventDefault();

    const id = document.getElementById('reply-feedback-id').value;
    const message = document.getElementById('reply-message').value.trim();
    const button = document.getElementById('btn-submit-reply');

    if (!id || !message) {
        showToast('Belum lengkap', 'Pesan balasan wajib diisi.', 'warning');
        return;
    }

    const targetFeedback = feedbackItems.find(entry => entry.id === id);
    if (!targetFeedback) {
        showToast('Error', 'Data masukan tidak ditemukan.', 'error');
        return;
    }

    const sender = getSenderInfo();

    try {
        setButtonLoading(button, true, 'Mengirim...');
        await sendFeedbackReply(id, message, sender, targetFeedback);

        window.closeFeedbackReply();
        showToast('Balasan Terkirim', 'Balasan Anda berhasil dikirim.', 'success');
        await loadFeedback(true);
    } catch (error) {
        console.error('[Masukan] Reply failed:', error);
        showToast('Gagal mengirim', error.message || 'Balasan belum bisa dikirim.', 'error');
    } finally {
        setButtonLoading(button, false);
    }
}

window.submitInlineReply = async function (id, btnEl) {
    const inputEl = document.getElementById(`inline-reply-${id}`);
    if (!inputEl) return;
    const message = inputEl.value.trim();
    if (!message) {
        showToast('Belum Lengkap', 'Ketik balasan Anda terlebih dahulu.', 'warning');
        inputEl.focus();
        return;
    }

    const targetFeedback = feedbackItems.find(entry => entry.id === id);
    if (!targetFeedback) {
        showToast('Error', 'Data masukan tidak ditemukan.', 'error');
        return;
    }

    const sender = getSenderInfo();
    const originalContent = btnEl ? btnEl.innerHTML : '';

    try {
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-[9px]"></i><span>Kirim...</span>';
        }

        await sendFeedbackReply(id, message, sender, targetFeedback);

        inputEl.value = '';
        showToast('Balasan Terkirim', 'Balasan Anda berhasil dikirim.', 'success');
        await loadFeedback(true);

        // Pastikan thread tetap terbuka
        setTimeout(() => {
            const body = document.getElementById(`expanded-body-${id}`);
            const icon = document.getElementById(`expand-icon-${id}`);
            if (body && body.classList.contains('hidden')) {
                body.classList.remove('hidden');
                if (icon) icon.classList.add('rotate-180');
            }
        }, 150);
    } catch (error) {
        console.error('[Masukan] Inline reply failed:', error);
        showToast('Gagal Mengirim', error.message || 'Balasan belum bisa dikirim.', 'error');
    } finally {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = originalContent;
        }
    }
};

window.deleteFeedback = async function (feedbackId) {
    if (!isFeedbackAdmin()) {
        showToast('Akses ditolak', 'Hanya Super Admin yang dapat menghapus masukan.', 'error');
        return;
    }

    const confirmed = typeof window.showConfirmModal === 'function'
        ? await window.showConfirmModal('Apakah Anda yakin ingin menghapus masukan ini? Tindakan ini permanen dan tidak dapat dibatalkan.', 'Hapus Masukan', 'danger')
        : true;

    if (!confirmed) {
        return;
    }

    try {
        // Delete via Edge Function Secure Proxy
        await callSecureEdgeFunction('delete-feedback', {
            id: feedbackId
        });

        showToast('Berhasil dihapus', 'Masukan telah dihapus dari sistem.', 'success');
        await loadFeedback(true);
    } catch (error) {
        console.error('[Masukan] Delete failed:', error);
        showToast('Gagal menghapus', error.message || 'Masukan tidak dapat dihapus.', 'error');
    }
};

window.openEditReply = function (feedbackId, replyId) {
    const item = feedbackItems.find(entry => entry.id === feedbackId);
    if (!item) return;

    let targetReply = null;
    if (Array.isArray(item.replies)) {
        targetReply = item.replies.find(r => r && r.id === replyId);
    }
    if (!targetReply) {
        showToast('Error', 'Data balasan tidak ditemukan.', 'error');
        return;
    }

    const isOwner = currentUser && targetReply.sender_uid === currentUser.uid;
    const canEdit = isOwner || isSuperAdmin();
    if (!canEdit) {
        showToast('Akses Ditolak', 'Anda hanya berhak mengedit balasan milik sendiri.', 'warning');
        return;
    }

    const fidEl = document.getElementById('edit-reply-feedback-id');
    const ridEl = document.getElementById('edit-reply-id');
    const titleEl = document.getElementById('edit-reply-modal-title');
    const msgEl = document.getElementById('edit-reply-message');
    const counterEl = document.getElementById('edit-reply-char-count');

    if (fidEl) fidEl.value = feedbackId;
    if (ridEl) ridEl.value = replyId;
    if (titleEl) titleEl.textContent = item.title || feedbackId;
    if (msgEl) {
        msgEl.value = targetReply.message || '';
        if (counterEl) counterEl.textContent = `${msgEl.value.length}/1500`;
    }

    const modal = document.getElementById('edit-reply-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => {
            msgEl?.focus();
        }, 100);
    }
};

window.closeEditReply = function () {
    const modal = document.getElementById('edit-reply-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

async function saveEditReply(event) {
    event.preventDefault();

    const feedbackId = document.getElementById('edit-reply-feedback-id')?.value;
    const replyId = document.getElementById('edit-reply-id')?.value;
    const message = document.getElementById('edit-reply-message')?.value.trim();
    const button = document.getElementById('btn-submit-edit-reply');

    if (!feedbackId || !replyId || !message) {
        showToast('Belum Lengkap', 'Pesan balasan wajib diisi.', 'warning');
        return;
    }

    try {
        setButtonLoading(button, true, 'Menyimpan...');

        let success = false;
        let lastError = null;

        // 1. Coba melalui Cloudflare Worker API
        try {
            if (cfClient && typeof cfClient.editFeedbackReply === 'function') {
                await cfClient.editFeedbackReply({ id: feedbackId, replyId, message });
                success = true;
            }
        } catch (cfErr) {
            lastError = cfErr;
            console.warn('[Masukan] Edit balasan via Worker dialihkan ke Edge Function:', cfErr?.message || cfErr);
        }

        // 2. Fallback tangguh ke Supabase Edge Function
        if (!success) {
            try {
                await callSecureEdgeFunction('edit-feedback-reply', {
                    id: feedbackId,
                    reply_id: replyId,
                    message
                });
                success = true;
            } catch (err) {
                throw lastError || err;
            }
        }

        window.closeEditReply();
        showToast('Balasan Diperbarui', 'Pesan balasan berhasil diubah.', 'success');
        await loadFeedback(true);

        // Pastikan thread tetap terbuka
        setTimeout(() => {
            const body = document.getElementById(`expanded-body-${feedbackId}`);
            const icon = document.getElementById(`expand-icon-${feedbackId}`);
            if (body && body.classList.contains('hidden')) {
                body.classList.remove('hidden');
                if (icon) icon.classList.add('rotate-180');
            }
        }, 150);
    } catch (error) {
        console.error('[Masukan] Edit reply failed:', error);
        showToast('Gagal Mengedit', error.message || 'Balasan tidak dapat diperbarui.', 'error');
    } finally {
        setButtonLoading(button, false);
    }
}

window.openEditFeedback = function (feedbackId) {
    const item = feedbackItems.find(entry => entry.id === feedbackId);
    if (!item) return;

    const userEmail = (currentUser?.email || '').toLowerCase().trim();
    const itemEmail = (item.senderEmail || '').toLowerCase().trim();
    const isOwner = Boolean(currentUser && (
        (item.senderUid && item.senderUid === currentUser.uid) ||
        (userEmail && itemEmail && userEmail === itemEmail)
    ));
    const isSuper = isSuperAdmin();

    if (!isOwner && !isSuper) {
        showToast('Akses Ditolak', 'Anda hanya berhak mengedit masukan milik sendiri.', 'warning');
        return;
    }

    const itemStatus = String(item.status || '').toLowerCase();
    if (!isSuper && ['selesai', 'ditolak'].includes(itemStatus)) {
        showToast('Tidak Dapat Diedit', `Masukan dengan status "${itemStatus}" sudah ditutup dan tidak dapat diedit kembali.`, 'warning');
        return;
    }

    const fidEl = document.getElementById('edit-feedback-id');
    const catEl = document.getElementById('edit-feedback-category');
    const titleEl = document.getElementById('edit-feedback-title');
    const msgEl = document.getElementById('edit-feedback-message');
    const counterEl = document.getElementById('edit-feedback-char-count');

    if (fidEl) fidEl.value = feedbackId;
    if (catEl) catEl.value = item.category || "Web App SIMAS-CERDAS";
    if (titleEl) titleEl.value = item.title || '';
    if (msgEl) {
        msgEl.value = item.message || '';
        if (counterEl) counterEl.textContent = `${msgEl.value.length}/2500`;
    }

    const modal = document.getElementById('edit-feedback-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => {
            titleEl?.focus();
        }, 100);
    }
};

window.closeEditFeedback = function () {
    const modal = document.getElementById('edit-feedback-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

async function saveEditFeedback(event) {
    event.preventDefault();

    const id = document.getElementById('edit-feedback-id')?.value;
    const category = document.getElementById('edit-feedback-category')?.value;
    const title = document.getElementById('edit-feedback-title')?.value.trim();
    const message = document.getElementById('edit-feedback-message')?.value.trim();
    const button = document.getElementById('btn-submit-edit-feedback');

    if (!id || !title || !message) {
        showToast('Belum Lengkap', 'Judul dan isi aspirasi wajib diisi.', 'warning');
        return;
    }

    try {
        setButtonLoading(button, true, 'Menyimpan...');

        let success = false;
        let lastError = null;

        // 1. Coba via Cloudflare Worker API
        try {
            if (cfClient && typeof cfClient.editFeedback === 'function') {
                await cfClient.editFeedback({ id, title, message, category });
                success = true;
            }
        } catch (cfErr) {
            lastError = cfErr;
            console.warn('[Masukan] Edit feedback via Worker dialihkan ke Edge Function:', cfErr?.message || cfErr);
        }

        // 2. Fallback tangguh ke Supabase Edge Function
        if (!success) {
            try {
                await callSecureEdgeFunction('edit-feedback', {
                    id,
                    title,
                    message,
                    category
                });
                success = true;
            } catch (err) {
                throw lastError || err;
            }
        }

        // Update data in-place di memori dan cache agar UI langsung ter-render tanpa delay
        const nowIso = new Date().toISOString();
        const existingIdx = feedbackItems.findIndex(e => e.id === id);
        if (existingIdx !== -1) {
            feedbackItems[existingIdx].title = title;
            feedbackItems[existingIdx].message = message;
            feedbackItems[existingIdx].category = category;
            feedbackItems[existingIdx].updatedAt = nowIso;
            feedbackItems[existingIdx].editedAt = nowIso;
            feedbackItems[existingIdx].hasBeenEdited = true;
            try {
                sessionStorage.setItem('simas_feedback_cache', JSON.stringify({
                    items: feedbackItems,
                    timestamp: Date.now()
                }));
            } catch (_) { }
        }

        window.closeEditFeedback();
        showToast('Aspirasi Diperbarui', 'Aspirasi Anda berhasil diperbarui.', 'success');
        renderFeedbackList();
        loadFeedback(true).catch(e => console.warn('[Masukan] Background reload after edit error:', e));
    } catch (error) {
        console.error('[Masukan] Edit feedback failed:', error);
        showToast('Gagal Mengedit', error.message || 'Aspirasi tidak dapat diperbarui.', 'error');
    } finally {
        setButtonLoading(button, false);
    }
}

function setButtonLoading(button, loading, label = '') {
    if (!button) return;
    if (loading) {
        button.dataset.originalHtml = button.innerHTML;
        button.disabled = true;
        button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>${label}</span>`;
    } else {
        button.disabled = false;
        if (button.dataset.originalHtml) {
            button.innerHTML = button.dataset.originalHtml;
        }
    }
}

function emptyState(icon, text) {
    return `
        <div class="text-center py-16 text-slate-400 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs">
            <i class="fa-solid ${icon} text-3xl mb-3 text-blue-500"></i>
            <p class="text-xs font-bold uppercase tracking-widest">${escapeHTML(text)}</p>
        </div>
    `;
}

function formatDateTime(date) {
    try {
        return new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Makassar',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    } catch (error) {
        return date.toLocaleString('id-ID');
    }
}

window.loadFeedback = loadFeedback;

window.refreshFeedbackData = async function () {
    const btn = document.getElementById('btn-refresh-feedback');
    const icon = btn?.querySelector('.fa-rotate');
    if (icon) icon.classList.add('fa-spin');
    try {
        await loadFeedback(true);
        showToast('Data Disegarkan', 'Daftar masukan telah diperbarui.', 'success');
    } catch (e) {
        showToast('Gagal Segarkan', e.message || 'Gagal memuat pembaruan.', 'error');
    } finally {
        if (icon) icon.classList.remove('fa-spin');
    }
};
