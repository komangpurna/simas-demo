/**
 * SIMAS SMAGESA - Modul Buku Kenangan (Yearbook) Kelas XII & Arsip Master PDF
 * Berkas: js/page-yearbook.js
 * Standar: SSOT, Zero Bloat, 0 Firestore Read, Responsive & Accessible
 *
 * Alur halaman publik:
 *   Hero statistik angkatan → pilih rombel (chip) → kartu potret (hover = foto santai)
 *   → klik kartu = "spread" profil lengkap + dinding pesan → tulis pesan (khusus siswa yang login portal).
 */

import cfClient from './cloudflare-client.js';

let _activeTab = 'gallery';
let _classesList = [];
let _classSummary = {};
let _currentClass = '';
let _classStudents = [];
let _visibleStudents = [];
let _archivesList = [];
let _archivesLoaded = false;
let _activeProfileIdx = -1;
let _profilePhotoMode = 'formal';
let _classLoadSeq = 0;
let _academicYear = '';
let _lastFocus = null;

// Helper: Escape Karakter HTML anti-XSS
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Worker menyimpan pesan dengan < > yang sudah di-escape; kembalikan dulu agar tidak ter-escape dua kali.
function decodeStoredText(str) {
    return String(str || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function getInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function toTitleCase(name) {
    return String(name || '').toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}

function isSafeHttpUrl(url) {
    return /^https?:\/\//i.test(String(url || '').trim());
}

function getDefaultAcademicYear() {
    const now = new Date();
    const yr = now.getFullYear();
    return now.getMonth() + 1 >= 7 ? `${yr}/${yr + 1}` : `${yr - 1}/${yr}`;
}

function getGraduationYear(academicYear) {
    const match = String(academicYear || '').match(/^\d{4}\/(\d{4})$/);
    return match ? match[1] : String(new Date().getFullYear());
}

// Helper: Toast Notifikasi Ringan
function showYearbookToast(title, message, type = 'info') {
    const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    document.querySelectorAll('.yb-toast').forEach(t => t.remove());
    const toast = document.createElement('div');
    toast.className = `yb-toast is-${type}`;
    toast.setAttribute('role', 'status');
    toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span><strong>${escapeHTML(title)}</strong> &middot; ${escapeHTML(message)}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 4200);
}

// Helper: Resolusi URL Foto
function resolveYearbookPhoto(url) {
    if (!url) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    const workerUrl = (typeof window !== 'undefined' && window.CLOUDFLARE_CONFIG?.WORKER_URL)
        ? window.CLOUDFLARE_CONFIG.WORKER_URL
        : 'https://simas-smagesa-api.komangpurna1.workers.dev';
    return `${workerUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
}

// Sesi siswa dari Portal Siswa (navigasi tab yang sama mempertahankan sessionStorage)
function getStudentSession() {
    try {
        const token = sessionStorage.getItem('student_token') || localStorage.getItem('student_token');
        if (!token) return null;
        return {
            nis: String(sessionStorage.getItem('student_nis') || '').trim(),
            name: sessionStorage.getItem('student_name') || '',
            className: sessionStorage.getItem('student_class') || ''
        };
    } catch (_) {
        return null;
    }
}

function normalizeStudent(st) {
    return {
        ...st,
        formalPhoto: resolveYearbookPhoto(st.formal_photo_url),
        casualPhoto: resolveYearbookPhoto(st.casual_photo_url),
        displayName: toTitleCase(st.name),
        messages: Array.isArray(st.messages) ? st.messages : [],
        social: st.social_media && typeof st.social_media === 'object' ? st.social_media : {}
    };
}

// =========================================================================
// 1. INISIALISASI
// =========================================================================
async function initYearbookPage() {
    applyThemeIcon();
    setupPortalLink();
    setHeroAcademicYear(getDefaultAcademicYear());
    renderGallerySkeleton();
    bindKeyboard();

    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'archives') window.switchYearbookTab('archives');

    loadYearbookSummary();

    try {
        _classesList = await cfClient.getYearbookClasses();
        populateClassDropdowns(_classesList);

        if (_classesList.length > 0) {
            const requested = params.get('kelas');
            const initial = requested && _classesList.includes(requested) ? requested : _classesList[0];
            await loadClassYearbookData(initial);
        } else {
            setClassHeader('', []);
            renderEmptyState('fa-folder-open', 'Belum ada angkatan aktif', 'Tidak ditemukan rombel Kelas XII aktif saat ini. Silakan kunjungi rak arsip untuk buku tahunan angkatan sebelumnya.');
        }
    } catch (err) {
        console.error('[Yearbook] Init error:', err);
        const chips = document.getElementById('yb-class-chips');
        if (chips) chips.innerHTML = '';
        const reason = err?.name === 'AbortError' ? 'Server terlalu lama merespons.' : (err?.message || 'Terjadi kesalahan jaringan.');
        renderEmptyState('fa-plug-circle-exclamation', 'Gagal memuat angkatan',
            `${escapeHTML(reason)} Periksa koneksi internet lalu coba lagi.`,
            '<button type="button" class="yb-btn yb-btn-primary yb-btn-sm" style="margin-top:16px;" onclick="window.retryYearbookInit()"><i class="fa-solid fa-rotate-right"></i> Coba lagi</button>');
    }
}

window.retryYearbookInit = function() {
    const chips = document.getElementById('yb-class-chips');
    if (chips) chips.innerHTML = '<span class="yb-chip">Memuat rombel...</span>';
    initYearbookPage();
};

function setHeroAcademicYear(academicYear) {
    _academicYear = academicYear;
    const taEl = document.getElementById('yb-hero-ta');
    const yearEl = document.getElementById('yb-hero-year');
    if (taEl) taEl.textContent = `Tahun Ajaran ${academicYear}`;
    if (yearEl) yearEl.textContent = getGraduationYear(academicYear);
}

async function loadYearbookSummary() {
    const statsEl = document.querySelector('.yb-stats');
    try {
        const summary = await cfClient.getYearbookSummary();
        if (!summary || !summary.success) throw new Error('Ringkasan angkatan tidak tersedia');
        if (summary.academic_year) setHeroAcademicYear(summary.academic_year);

        const setStat = (id, value) => {
            const el = document.getElementById(id);
            if (el) animateNumber(el, Number(value || 0));
        };
        setStat('yb-stat-students', summary.total_students);
        setStat('yb-stat-classes', summary.total_classes);
        setStat('yb-stat-profiles', summary.profiles_filled);
        setStat('yb-stat-messages', summary.approved_messages);

        _classSummary = {};
        (summary.classes || []).forEach(c => { _classSummary[c.class] = c; });
        if (_classesList.length) populateClassDropdowns(_classesList);
    } catch (err) {
        // Statistik bersifat pelengkap: sembunyikan daripada menampilkan angka kosong.
        console.warn('[Yearbook] Summary unavailable:', err);
        if (statsEl) statsEl.classList.add('hidden');
    }
}

function animateNumber(el, target) {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || target <= 0) {
        el.textContent = target.toLocaleString('id-ID');
        return;
    }
    const start = performance.now();
    const duration = 900;
    const step = (now) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased).toLocaleString('id-ID');
        if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

// =========================================================================
// 2. CHIP ROMBEL
// =========================================================================
function populateClassDropdowns(classes) {
    const chips = document.getElementById('yb-class-chips');
    if (!chips) return;

    if (!classes || classes.length === 0) {
        chips.innerHTML = '<span class="yb-chip">Tidak ada rombel XII</span>';
        return;
    }

    chips.innerHTML = classes.map(c => {
        const info = _classSummary[c];
        const isActive = c === _currentClass;
        return `
            <button type="button" role="tab" class="yb-chip ${isActive ? 'is-active' : ''}" aria-selected="${isActive}"
                data-class="${escapeHTML(c)}" onclick="window.loadClassYearbookData(this.dataset.class)">
                <span>${escapeHTML(c)}</span>${info ? `<small>${info.total}</small>` : ''}
            </button>
        `;
    }).join('');
}

function syncActiveChip() {
    document.querySelectorAll('#yb-class-chips .yb-chip[data-class]').forEach(btn => {
        const active = btn.dataset.class === _currentClass;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', String(active));
        if (active && typeof btn.scrollIntoView === 'function') {
            btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        }
    });
}

// =========================================================================
// 3. TAB (Galeri & Arsip)
// =========================================================================
window.switchYearbookTab = function(tabName) {
    _activeTab = tabName === 'archives' ? 'archives' : 'gallery';

    ['gallery', 'archives'].forEach(t => {
        const btn = document.getElementById(`nav-${t}`);
        const sec = document.getElementById(`section-${t}`);
        if (!btn || !sec) return;
        const active = t === _activeTab;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-current', active ? 'page' : 'false');
        sec.classList.toggle('hidden', !active);
    });

    const url = new URL(window.location.href);
    if (_activeTab === 'archives') url.searchParams.set('tab', 'archives');
    else url.searchParams.delete('tab');
    window.history.replaceState(null, '', url);

    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (_activeTab === 'archives' && !_archivesLoaded) {
        loadYearbookArchives();
    }
};

// =========================================================================
// 4. DATA ROMBEL
// =========================================================================
async function loadClassYearbookData(className) {
    if (!className) return;
    _currentClass = className;
    const seq = ++_classLoadSeq;
    syncActiveChip();
    renderGallerySkeleton();

    const url = new URL(window.location.href);
    url.searchParams.set('kelas', className);
    window.history.replaceState(null, '', url);

    try {
        const data = await cfClient.getYearbookClass(className);
        if (seq !== _classLoadSeq) return; // Pengguna sudah berpindah rombel
        _classStudents = (data || []).map(normalizeStudent);
        setClassHeader(className, _classStudents);

        const search = document.getElementById('gallery-search-input');
        window.filterGalleryStudents(search ? search.value : '');
    } catch (err) {
        if (seq !== _classLoadSeq) return;
        console.error('[Yearbook] Load class error:', err);
        renderEmptyState('fa-circle-exclamation', 'Gagal memuat rombel',
            escapeHTML(err?.name === 'AbortError' ? 'Server terlalu lama merespons.' : (err.message || 'Terjadi kesalahan jaringan.')),
            '<button type="button" class="yb-btn yb-btn-primary yb-btn-sm" style="margin-top:16px;" onclick="window.refreshClassData()"><i class="fa-solid fa-rotate-right"></i> Coba lagi</button>');
    }
}

function setClassHeader(className, students) {
    const total = students.length;
    const filled = students.filter(s => String(s.quote || '').trim()).length;
    const pct = total > 0 ? Math.round((filled / total) * 100) : 0;

    const kicker = document.getElementById('yb-class-kicker');
    const title = document.getElementById('yb-class-title');
    const count = document.getElementById('yb-class-count');
    const pctEl = document.getElementById('yb-class-pct');
    const bar = document.getElementById('yb-class-bar');

    if (kicker) kicker.textContent = `Rombel · Class of ${getGraduationYear(_academicYear)}`;
    if (title) title.textContent = className || '—';
    if (count) count.textContent = `${total} siswa`;
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (bar) requestAnimationFrame(() => { bar.style.width = `${pct}%`; });
}

window.refreshClassData = function() {
    if (_currentClass) loadClassYearbookData(_currentClass);
};

// =========================================================================
// 5. PENCARIAN
// =========================================================================
window.filterGalleryStudents = function(query) {
    const q = String(query || '').toLowerCase().trim();
    _visibleStudents = !q ? [..._classStudents] : _classStudents.filter(s =>
        [s.name, s.nis, s.quote, s.ambition, s.dream_campus, s.social?.instagram]
            .some(v => String(v || '').toLowerCase().includes(q))
    );
    renderGalleryCards(_visibleStudents, q);
};

// =========================================================================
// 6. RENDER KARTU POTRET
// =========================================================================
function renderGallerySkeleton(count = 10) {
    const grid = document.getElementById('gallery-students-grid');
    if (!grid) return;
    grid.setAttribute('aria-busy', 'true');
    grid.innerHTML = Array.from({ length: count }, () => `
        <div class="yb-skel" aria-hidden="true">
            <div class="yb-skel-block"></div>
            <div class="yb-skel-line"></div>
            <div class="yb-skel-line short"></div>
        </div>
    `).join('');
}

function renderEmptyState(icon, title, message, actionHtml = '') {
    const grid = document.getElementById('gallery-students-grid');
    if (!grid) return;
    grid.removeAttribute('aria-busy');
    grid.innerHTML = `
        <div class="yb-empty">
            <i class="fa-solid ${icon}"></i>
            <h3>${escapeHTML(title)}</h3>
            <p>${message}</p>
            ${actionHtml}
        </div>
    `;
}

function renderGalleryCards(students, query = '') {
    const grid = document.getElementById('gallery-students-grid');
    if (!grid) return;
    grid.removeAttribute('aria-busy');

    if (!students || students.length === 0) {
        renderEmptyState('fa-user-slash',
            query ? 'Tidak ada yang cocok' : 'Rombel ini masih kosong',
            query ? `Tidak ada siswa dengan kata kunci &ldquo;${escapeHTML(query)}&rdquo; di ${escapeHTML(_currentClass)}.` : 'Belum ada profil siswa yang dipublikasikan pada rombel ini.');
        return;
    }

    grid.innerHTML = students.map((st, idx) => {
        const quote = String(st.quote || '').trim();
        const ambition = st.ambition || st.dream_campus || '';
        const msgCount = st.messages.length;
        const hasCasual = Boolean(st.casualPhoto);
        const mainPhoto = st.formalPhoto || st.casualPhoto;

        return `
            <article class="yb-card ${hasCasual && st.formalPhoto ? 'has-casual' : ''}" style="--i:${Math.min(idx, 20)}"
                tabindex="0" role="button" aria-label="Buka profil ${escapeHTML(st.displayName)}"
                onclick="window.openYearbookProfile(${idx})"
                onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.openYearbookProfile(${idx});}">
                <div class="yb-card-photo">
                    <div class="yb-initials" aria-hidden="true">${escapeHTML(getInitials(st.name))}</div>
                    ${mainPhoto
                        ? `<img class="yb-ph-formal" src="${escapeHTML(mainPhoto)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
                        : ''}
                    ${hasCasual && st.formalPhoto
                        ? `<img class="yb-ph-casual" src="${escapeHTML(st.casualPhoto)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
                        : ''}
                    <div class="yb-card-tags">
                        ${hasCasual ? '<span class="yb-pill yb-pill-casual"><i class="fa-solid fa-camera-retro"></i></span>' : '<span></span>'}
                        ${msgCount > 0 ? `<span class="yb-pill" title="${msgCount} pesan kenangan"><i class="fa-solid fa-feather-pointed"></i>${msgCount}</span>` : ''}
                    </div>
                </div>
                <div class="yb-card-body">
                    <h3 class="yb-card-name">${escapeHTML(st.displayName)}</h3>
                    ${ambition ? `<p class="yb-card-ambition">${escapeHTML(ambition)}</p>` : ''}
                    ${quote ? `<p class="yb-card-quote">&ldquo;${escapeHTML(quote)}&rdquo;</p>` : ''}
                </div>
            </article>
        `;
    }).join('');
}

// =========================================================================
// 7. SPREAD PROFIL
// =========================================================================
window.openYearbookProfile = function(idx) {
    if (!_visibleStudents[idx]) return;
    const modal = document.getElementById('yb-profile-modal');
    if (modal && modal.classList.contains('hidden')) {
        _lastFocus = document.activeElement;
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }
    _activeProfileIdx = idx;
    renderProfileSpread(_visibleStudents[idx]);
    const closeBtn = modal?.querySelector('.yb-spread-close');
    if (closeBtn) closeBtn.focus({ preventScroll: true });
};

window.closeYearbookProfile = function() {
    const modal = document.getElementById('yb-profile-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    _activeProfileIdx = -1;
    if (_lastFocus && typeof _lastFocus.focus === 'function') _lastFocus.focus({ preventScroll: true });
};

window.stepYearbookProfile = function(delta) {
    if (_activeProfileIdx < 0 || _visibleStudents.length === 0) return;
    const next = (_activeProfileIdx + delta + _visibleStudents.length) % _visibleStudents.length;
    window.openYearbookProfile(next);
};

window.setProfilePhotoMode = function(mode) {
    const st = _visibleStudents[_activeProfileIdx];
    if (!st) return;
    _profilePhotoMode = mode === 'casual' && st.casualPhoto ? 'casual' : 'formal';
    applyProfilePhoto(st);
};

function applyProfilePhoto(st) {
    const img = document.getElementById('ybp-photo');
    const initials = document.getElementById('ybp-initials');
    const btnFormal = document.getElementById('ybp-btn-formal');
    const btnCasual = document.getElementById('ybp-btn-casual');

    const src = _profilePhotoMode === 'casual' ? (st.casualPhoto || st.formalPhoto) : (st.formalPhoto || st.casualPhoto);
    if (img) {
        if (src) {
            img.src = src;
            img.alt = `Foto ${st.displayName}`;
            img.classList.remove('hidden');
        } else {
            img.removeAttribute('src');
            img.classList.add('hidden');
        }
    }
    if (initials) {
        initials.textContent = getInitials(st.name);
        initials.classList.toggle('hidden', Boolean(src));
    }
    if (btnFormal) {
        btnFormal.classList.toggle('is-active', _profilePhotoMode === 'formal');
        btnFormal.disabled = !st.formalPhoto;
    }
    if (btnCasual) {
        btnCasual.classList.toggle('is-active', _profilePhotoMode === 'casual');
        btnCasual.disabled = !st.casualPhoto;
    }
}

function renderProfileSpread(st) {
    _profilePhotoMode = st.casualPhoto ? 'casual' : 'formal';
    applyProfilePhoto(st);

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    setText('ybp-class', st.class || _currentClass);
    setText('ybp-year', `Class of ${getGraduationYear(_academicYear)}`);
    setText('ybp-name', st.displayName);
    setText('ybp-position', `${_activeProfileIdx + 1} / ${_visibleStudents.length}`);

    const quoteEl = document.getElementById('ybp-quote');
    if (quoteEl) {
        const quote = String(st.quote || '').trim();
        quoteEl.textContent = quote || 'Kutipan kelulusan belum ditulis — tetapi ceritanya tetap abadi di sini.';
        quoteEl.style.opacity = quote ? '1' : '0.6';
    }

    const facts = [];
    if (st.ambition) facts.push({ icon: 'fa-briefcase', label: 'Cita-cita', value: escapeHTML(st.ambition) });
    if (st.dream_campus) facts.push({ icon: 'fa-building-columns', label: 'Tujuan Studi', value: escapeHTML(st.dream_campus) });
    const ig = String(st.social?.instagram || '').replace(/^@+/, '').replace(/[^a-zA-Z0-9._]/g, '');
    if (ig) facts.push({ icon: 'fa-brands fa-instagram', label: 'Instagram', value: `<a href="https://instagram.com/${encodeURIComponent(ig)}" target="_blank" rel="noopener noreferrer">@${escapeHTML(ig)}</a>` });
    if (st.social?.spotify) facts.push({ icon: 'fa-brands fa-spotify', label: 'Lagu Kenangan', value: escapeHTML(st.social.spotify) });

    const factsEl = document.getElementById('ybp-facts');
    if (factsEl) {
        factsEl.innerHTML = facts.map(f => `
            <div class="yb-fact">
                <i class="${f.icon.startsWith('fa-brands') ? f.icon : `fa-solid ${f.icon}`}"></i>
                <div style="min-width:0;">
                    <span class="yb-fact-label">${f.label}</span>
                    <span class="yb-fact-value">${f.value}</span>
                </div>
            </div>
        `).join('');
        factsEl.classList.toggle('hidden', facts.length === 0);
    }

    setText('ybp-notes-label', st.messages.length > 0 ? `Pesan dari Kawan (${st.messages.length})` : 'Pesan dari Kawan');
    const notesEl = document.getElementById('ybp-notes');
    if (notesEl) {
        notesEl.innerHTML = st.messages.length > 0
            ? st.messages.map(m => `
                <figure class="yb-note" style="margin:0;">
                    <p>${escapeHTML(decodeStoredText(m.message))}</p>
                    <span>— ${escapeHTML(toTitleCase(m.sender_name || 'Kawan'))}${m.sender_class ? ` · ${escapeHTML(m.sender_class)}` : ''}</span>
                </figure>
            `).join('')
            : `<div class="yb-notes-empty" style="grid-column:1/-1;">Belum ada pesan yang tampil. Jadilah yang pertama menuliskan kenangan untuk ${escapeHTML(st.displayName.split(' ')[0])}!</div>`;
    }

    const writeBtn = document.getElementById('ybp-write-btn');
    const session = getStudentSession();
    if (writeBtn) writeBtn.classList.toggle('hidden', Boolean(session?.nis && session.nis === String(st.nis)));

    const content = document.querySelector('#yb-profile-modal .yb-spread-content');
    if (content) content.scrollTop = 0;
}

let _keyboardBound = false;
function bindKeyboard() {
    if (_keyboardBound) return;
    _keyboardBound = true;
    document.addEventListener('keydown', (e) => {
        const sendModal = document.getElementById('modal-send-message');
        if (sendModal && !sendModal.classList.contains('hidden')) {
            if (e.key === 'Escape') window.closeSendMessageModal();
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                const form = document.getElementById('modal-message-form');
                if (form && !form.classList.contains('hidden')) form.requestSubmit();
            }
            return;
        }
        const profileModal = document.getElementById('yb-profile-modal');
        if (profileModal && !profileModal.classList.contains('hidden')) {
            if (e.key === 'Escape') window.closeYearbookProfile();
            if (e.key === 'ArrowRight') window.stepYearbookProfile(1);
            if (e.key === 'ArrowLeft') window.stepYearbookProfile(-1);
        }
    });
}

// =========================================================================
// 8. MODAL KIRIM PESAN KENANGAN
// =========================================================================
window.openSendMessageForActive = function() {
    const st = _visibleStudents[_activeProfileIdx];
    if (st) window.openSendMessageModal(st.nis, st.displayName, st.class, st.formalPhoto || st.casualPhoto);
};

window.openSendMessageModal = function(targetNis, targetName, targetClass, avatarUrl = null) {
    const modal = document.getElementById('modal-send-message');
    const session = getStudentSession();
    const loginBox = document.getElementById('modal-login-required');
    const form = document.getElementById('modal-message-form');

    const inputNis = document.getElementById('modal-target-nis');
    const nameEl = document.getElementById('modal-target-name');
    const classEl = document.getElementById('modal-target-class');
    const avatarEl = document.getElementById('modal-target-avatar');
    const msgInput = document.getElementById('modal-input-message');
    const counter = document.getElementById('modal-msg-counter');
    const senderInfo = document.getElementById('modal-sender-info');

    if (inputNis) inputNis.value = targetNis;
    if (nameEl) nameEl.textContent = targetName;
    if (classEl) classEl.textContent = `Kelas ${targetClass}`;
    if (avatarEl) {
        avatarEl.innerHTML = avatarUrl
            ? `<img src="${escapeHTML(avatarUrl)}" alt="">`
            : escapeHTML(getInitials(targetName));
    }
    if (msgInput) msgInput.value = '';
    if (counter) counter.textContent = '0 / 250';

    const loggedIn = Boolean(session);
    if (loginBox) loginBox.classList.toggle('hidden', loggedIn);
    if (form) form.classList.toggle('hidden', !loggedIn);
    if (senderInfo && session) {
        senderInfo.textContent = session.name
            ? `Dikirim sebagai ${toTitleCase(session.name)}${session.className ? ` · ${session.className}` : ''}`
            : 'Dikirim sebagai siswa yang sedang login';
    }

    if (modal) modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    if (loggedIn && msgInput) setTimeout(() => msgInput.focus(), 50);
};

window.closeSendMessageModal = function() {
    const modal = document.getElementById('modal-send-message');
    if (modal) modal.classList.add('hidden');
    const profileOpen = !document.getElementById('yb-profile-modal')?.classList.contains('hidden');
    if (!profileOpen) document.body.style.overflow = '';
};

window.submitYearbookMessage = async function(e) {
    if (e) e.preventDefault();
    const btn = document.getElementById('btn-submit-msg');
    const targetNis = document.getElementById('modal-target-nis')?.value;
    const message = document.getElementById('modal-input-message')?.value || '';

    if (!targetNis || message.trim().length < 3) {
        showYearbookToast('Pesan terlalu pendek', 'Tuliskan minimal 3 karakter.', 'warning');
        return;
    }

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Mengirim...</span>';
        }

        const res = await cfClient.sendYearbookMessage({
            targetNis,
            message: message.trim()
        });

        if (res && res.success) {
            showYearbookToast(res.updated ? 'Pesan diperbarui' : 'Terkirim', res.message, 'success');
            window.closeSendMessageModal();
        } else {
            throw new Error(res?.error || 'Gagal mengirim pesan.');
        }
    } catch (err) {
        console.error('[Yearbook] Send message error:', err);
        const msg = /401|sesi|login/i.test(err.message || '')
            ? 'Sesi Portal Siswa berakhir. Silakan masuk kembali melalui Portal Siswa.'
            : (err.message || 'Gagal mengirim pesan kenangan.');
        showYearbookToast('Gagal', msg, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i><span>Kirim Pesan</span>';
        }
    }
};

// =========================================================================
// 9. RAK ARSIP ALUMNI
// =========================================================================
function renderArchiveSkeleton() {
    const grid = document.getElementById('archives-list-grid');
    if (!grid) return;
    grid.innerHTML = Array.from({ length: 4 }, () => `
        <div aria-hidden="true">
            <div class="yb-skel-block" style="border-radius:4px 12px 12px 4px;"></div>
            <div class="yb-skel-line"></div>
            <div class="yb-skel-line short"></div>
        </div>
    `).join('');
}

async function loadYearbookArchives() {
    const grid = document.getElementById('archives-list-grid');
    if (!grid) return;
    renderArchiveSkeleton();

    try {
        _archivesList = await cfClient.getYearbookArchives();
        _archivesLoaded = true;
        if (_archivesList.length === 0) {
            grid.innerHTML = `
                <div class="yb-empty">
                    <i class="fa-solid fa-book-open"></i>
                    <h3>Rak masih kosong</h3>
                    <p>Master PDF buku tahunan akan tampil di sini setelah diterbitkan oleh tim kesiswaan.</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = _archivesList.map(item => {
            const year = getGraduationYear(item.academic_year);
            const pdfUrl = isSafeHttpUrl(item.pdf_url) ? item.pdf_url : '';
            const coverUrl = isSafeHttpUrl(item.cover_url) ? item.cover_url : '';
            const total = Number(item.total_students || 0);
            const tag = pdfUrl ? 'a' : 'div';
            const linkAttrs = pdfUrl ? `href="${escapeHTML(pdfUrl)}" target="_blank" rel="noopener noreferrer"` : '';

            return `
                <${tag} class="yb-book" ${linkAttrs} aria-label="${escapeHTML(item.title)}">
                    <div class="yb-book-cover">
                        ${coverUrl
                            ? `<img src="${escapeHTML(coverUrl)}" alt="" loading="lazy">`
                            : `<div class="yb-book-art">
                                    <small>The Yearbook</small>
                                    <div>
                                        <span>Class of</span>
                                        <strong>${escapeHTML(year)}</strong>
                                    </div>
                                    <small>${escapeHTML(item.batch_name || item.academic_year)}</small>
                               </div>`
                        }
                    </div>
                    <div class="yb-book-meta">
                        <div class="yb-book-year">Tahun Ajaran ${escapeHTML(item.academic_year)}</div>
                        <h3 class="yb-book-title">${escapeHTML(item.title)}</h3>
                        <div class="yb-book-sub">
                            ${item.batch_name ? `${escapeHTML(item.batch_name)}` : ''}${item.batch_name && total ? ' · ' : ''}${total ? `${total} alumni` : ''}
                        </div>
                        ${pdfUrl ? '<span class="yb-book-cta"><i class="fa-solid fa-book-open-reader"></i> Baca / Unduh PDF</span>' : ''}
                    </div>
                </${tag}>
            `;
        }).join('');

    } catch (err) {
        console.error('[Yearbook] Load archives error:', err);
        grid.innerHTML = `
            <div class="yb-empty">
                <i class="fa-solid fa-circle-exclamation"></i>
                <h3>Gagal memuat arsip</h3>
                <p>${escapeHTML(err.message)}</p>
            </div>
        `;
    }
}

// =========================================================================
// 10. TEMA & TAUTAN PORTAL
// =========================================================================
function applyThemeIcon() {
    const icon = document.getElementById('yb-theme-icon');
    const isDark = document.documentElement.classList.contains('dark');
    if (icon) icon.className = `fa-solid ${isDark ? 'fa-sun' : 'fa-moon'}`;
}

window.toggleYearbookTheme = function() {
    const isDark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('dark_mode', String(isDark)); } catch (_) {}
    applyThemeIcon();
};

function setupPortalLink() {
    const link = document.getElementById('yb-portal-link');
    const session = getStudentSession();
    if (!link || !session) return;
    link.title = 'Kembali ke Portal Siswa';
    link.innerHTML = '<i class="fa-solid fa-arrow-left"></i><span class="yb-portal-label">Portal Saya</span>';
}

window.loadClassYearbookData = loadClassYearbookData;
window.loadYearbookArchives = loadYearbookArchives;

// Start
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initYearbookPage);
    } else {
        initYearbookPage();
    }
}

export {
    initYearbookPage,
    loadClassYearbookData,
    loadYearbookArchives,
    renderGalleryCards
};
