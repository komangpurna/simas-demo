/* library/presensi-perpus.js - Buku Tamu Digital Pengunjung Perpustakaan */
import { auth, db, PATHS, supabase, resolvePhotoUrl } from '../js/config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { initLayout, escapeHTML, formatDateIndo, getLocalISODate } from '../js/global.js';
import { extractNisFromQrInput, extractCardTokenFromQrInput, resolveNisFromQrInput, isQrInputSettled } from '../js/utils.mjs';

// =========================================================================
// 1. STATE & DATA
// =========================================================================
let allStudentsCache = [];
let allTeachersCache = [];
let todayVisitorsList = [];
let currentVisitorPhoto = '';

/**
 * Dapatkan 2 huruf inisial pengunjung dengan penyaringan gelar akademik
 */
export function getVisitorInitials(name) {
    if (!name || typeof name !== 'string') return 'P';
    let clean = name.trim();
    // Hapus gelar dan singkatan akademik umum di awal/akhir nama
    const titleRegex = /\b(Drs|Dra|Dr|Prof|Ir|H|Hj|M\.Pd|S\.Pd|M\.Si|S\.T|S\.Ag|S\.Kom|M\.M|Gr|S\.E|S\.P|M\.P)\b\.?/gi;
    let filtered = clean.replace(titleRegex, ' ');

    filtered = filtered.replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!filtered) {
        filtered = clean.replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (!filtered) return 'P';

    const parts = filtered.split(' ').filter(Boolean);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return filtered.slice(0, 2).toUpperCase();
}

/**
 * Render cardlet pratinjau verifikasi foto pengunjung di form check-in
 */
export function renderVisitorCardlet(item, type) {
    const cardlet = document.getElementById('visitor-preview-cardlet');
    if (!cardlet) return;

    const nama = item.nama || item.name || 'Pengunjung';
    const idVal = item.nis || item.nisn || item.nip || item.id || '';
    const sub = type === 'siswa' ? (item.kelas || item.class || 'Siswa') : (item.jabatan || 'Guru / Staf');
    const foto = item.foto || item.photo_url || item.activePhotoUrl || item.active_photo_url || item.photoUrl || '';

    currentVisitorPhoto = foto;

    const nameEl = document.getElementById('visitor-cardlet-name');
    const badgeEl = document.getElementById('visitor-cardlet-badge');
    const subEl = document.getElementById('visitor-cardlet-sub');
    const imgEl = document.getElementById('visitor-cardlet-img');
    const fallbackEl = document.getElementById('visitor-cardlet-fallback');
    const initialsEl = document.getElementById('visitor-cardlet-initials');

    if (nameEl) nameEl.textContent = nama;
    if (badgeEl) {
        if (type === 'guru') {
            badgeEl.className = 'px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 font-bold text-[9px]';
            badgeEl.textContent = 'Guru / Staf';
        } else {
            badgeEl.className = 'px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-bold text-[9px]';
            badgeEl.textContent = 'Siswa';
        }
    }
    if (subEl) {
        const idLabel = type === 'guru' ? (idVal ? `NIP. ${idVal}` : 'NIP. -') : (idVal ? `NIS. ${idVal}` : 'NIS. -');
        subEl.textContent = `${idLabel} • ${sub}`;
    }

    const initials = getVisitorInitials(nama);
    if (initialsEl) initialsEl.textContent = initials;

    let resolved = foto ? resolvePhotoUrl(foto) : '';
    if (resolved && !/^(https?:|\/|data:image\/)/i.test(resolved)) {
        resolved = '';
    }

    if (resolved && imgEl && fallbackEl) {
        imgEl.src = resolved;
        imgEl.classList.remove('hidden');
        fallbackEl.classList.add('hidden');
    } else if (imgEl && fallbackEl) {
        imgEl.src = '';
        imgEl.classList.add('hidden');
        fallbackEl.classList.remove('hidden');
    }

    cardlet.classList.remove('hidden');
}

export function resetVisitorPreview() {
    currentVisitorPhoto = '';
    const cardlet = document.getElementById('visitor-preview-cardlet');
    if (cardlet) cardlet.classList.add('hidden');
    const searchInput = document.getElementById('input-visitor-search');
    if (searchInput) searchInput.value = '';
    const classInput = document.getElementById('input-visitor-class');
    if (classInput) classInput.value = '';
    const hiddenId = document.getElementById('visitor-hidden-id');
    if (hiddenId) hiddenId.value = '';
    const hiddenName = document.getElementById('visitor-hidden-name');
    if (hiddenName) hiddenName.value = '';
}

/**
 * Ekstraksi & resolusi pengunjung dari input scan/teks
 */
export function extractVisitorFromInput(rawQuery, typeHint = null) {
    if (!rawQuery || typeof rawQuery !== 'string') return null;
    let query = rawQuery.trim();
    if (!query) return null;

    let extractedNis = '';
    try {
        if (typeof extractNisFromQrInput === 'function') {
            extractedNis = extractNisFromQrInput(query);
        } else if (typeof window !== 'undefined' && typeof window.extractNisFromQrInput === 'function') {
            extractedNis = window.extractNisFromQrInput(query);
        }
    } catch (_) {}

    if (!extractedNis && (query.includes('kartu-shakti.html') || query.startsWith('kts_'))) {
        const urlMatch = query.match(/[?&]nis=([^&#\s]+)/) || query.match(/[?&]id=([^&#\s]+)/);
        if (urlMatch) extractedNis = decodeURIComponent(urlMatch[1]).trim();
    }

    const queryLower = query.toLowerCase();
    const nisLower = (extractedNis || '').toLowerCase();

    // 1. Cek kecocokan di Master GTK / Guru (SSOT)
    if (typeHint !== 'siswa' && Array.isArray(allTeachersCache) && allTeachersCache.length > 0) {
        const matchedTeacher = allTeachersCache.find(t => {
            const nip = String(t.nip || '').trim().toLowerCase();
            const nik = String(t.nik || '').trim().toLowerCase();
            const id = String(t.id || '').trim().toLowerCase();
            const nama = String(t.nama || t.name || '').trim().toLowerCase();
            return (nip && nip === queryLower) ||
                   (nik && nik === queryLower) ||
                   (id && id === queryLower) ||
                   (nama && nama === queryLower);
        });
        if (matchedTeacher) {
            return { item: matchedTeacher, type: 'guru' };
        }
    }

    // 2. Cek kecocokan di Master Siswa Aktif (Mendukung pencocokan NIS hasil dekripsi QR, NIS polos, NISN, ID, atau Nama)
    if (typeHint !== 'guru' && Array.isArray(allStudentsCache) && allStudentsCache.length > 0) {
        const matchedStudent = allStudentsCache.find(s => {
            const nis = String(s.nis || '').trim().toLowerCase();
            const nisn = String(s.nisn || '').trim().toLowerCase();
            const id = String(s.id || '').trim().toLowerCase();
            const nama = String(s.nama || s.name || '').trim().toLowerCase();
            return (nis && (nis === nisLower || nis === queryLower)) ||
                   (nisn && (nisn === nisLower || nisn === queryLower)) ||
                   (id && (id === nisLower || id === queryLower)) ||
                   (nama && nama === queryLower);
        });
        if (matchedStudent) {
            return { item: matchedStudent, type: 'siswa' };
        }
    }

    return null;
}

/**
 * Versi async extractVisitorFromInput: token QR kartu (kts_ / public token) diterjemahkan dulu
 * menjadi NIS oleh Worker, karena kunci token kartu hanya ada di server.
 */
export async function resolveVisitorFromInput(rawQuery, typeHint = null) {
    if (extractCardTokenFromQrInput(rawQuery)) {
        const nis = await resolveNisFromQrInput(rawQuery);
        return nis ? extractVisitorFromInput(nis, 'siswa') : null;
    }
    return extractVisitorFromInput(rawQuery, typeHint);
}

window.getVisitorInitials = getVisitorInitials;
window.renderVisitorCardlet = renderVisitorCardlet;
window.resetVisitorPreview = resetVisitorPreview;
window.extractVisitorFromInput = extractVisitorFromInput;
window.resolveVisitorFromInput = resolveVisitorFromInput;

// =========================================================================
// 2. AUTH & INITIALIZATION
// =========================================================================
onAuthStateChanged(auth, async (user) => {
    // Presensi buku tamu dapat diakses oleh semua pengguna
    const primaryRole = localStorage.getItem('user_role') || 'siswa';
    
    await initLayout(primaryRole);
    document.querySelector('main')?.classList.remove('hidden');

    await loadMasterCache();
    await loadVisitorsStats();
    await loadTodayVisitors();
    setupPresensiEventListeners();
});

// =========================================================================
// 3. LOAD MASTER DATA & STATS
// =========================================================================
async function loadMasterCache() {
    try {
        if (window.getActiveStudentsCache) {
            allStudentsCache = await window.getActiveStudentsCache();
        } else if (window.getStudentsCache) {
            const rawStudents = await window.getStudentsCache();
            allStudentsCache = rawStudents.filter(s => window.isStudentActive ? window.isStudentActive(s) : !String(s.kelas || s.class || '').toLowerCase().includes('alumni'));
        }
        if (window.getTeachersCache) allTeachersCache = await window.getTeachersCache();
    } catch (e) {
        console.warn('[Presensi] Error load master cache:', e);
    }
}

async function loadVisitorsStats() {
    try {
        const todayStr = getLocalISODate();
        const firstDayOfMonth = todayStr.substring(0, 7) + '-01';

        // 1. Hari ini
        const { data: todayData, error: errToday } = await supabase
            .from('lib_pengunjung')
            .select('tipe_pengunjung')
            .eq('tanggal', todayStr);

        if (errToday) throw errToday;

        const countToday = todayData ? todayData.length : 0;
        const countSiswa = todayData ? todayData.filter(d => d.tipe_pengunjung === 'siswa').length : 0;
        const pctSiswa = countToday > 0 ? Math.round((countSiswa / countToday) * 100) : 0;

        // 2. Bulan ini
        const { count: countMonth } = await supabase
            .from('lib_pengunjung')
            .select('*', { count: 'exact', head: true })
            .gte('tanggal', firstDayOfMonth);

        document.getElementById('stat-visitor-today').textContent = countToday.toLocaleString('id-ID');
        document.getElementById('stat-visitor-month').textContent = (countMonth || 0).toLocaleString('id-ID');
        document.getElementById('stat-visitor-siswa-pct').textContent = `${pctSiswa}%`;
        document.getElementById('badge-total-today').textContent = `${countToday} Pengunjung`;

    } catch (e) {
        console.error('[Presensi] Error load stats:', e);
    }
}

// =========================================================================
// 4. LOAD & RENDER TODAY VISITORS
// =========================================================================
async function loadTodayVisitors() {
    try {
        const todayStr = getLocalISODate();
        const { data, error } = await supabase
            .from('lib_pengunjung')
            .select('*')
            .eq('tanggal', todayStr)
            .order('created_at', { ascending: false });

        if (error) throw error;
        todayVisitorsList = data || [];
        renderTodayVisitorsTable();

    } catch (e) {
        console.error('[Presensi] Error load today visitors:', e);
        const tbody = document.getElementById('visitors-table-body');
        if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-rose-500">Gagal memuat log pengunjung.</td></tr>';
    }
}

function renderTodayVisitorsTable() {
    const tbody = document.getElementById('visitors-table-body');
    if (todayVisitorsList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-slate-400 italic">Belum ada pengunjung perpustakaan hari ini.</td></tr>';
        return;
    }

    tbody.innerHTML = todayVisitorsList.map(v => {
        let typeBadge = '';
        if (v.tipe_pengunjung === 'siswa') {
            typeBadge = `<span class="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold text-[9px]">Siswa</span>`;
        } else if (v.tipe_pengunjung === 'guru') {
            typeBadge = `<span class="px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-bold text-[9px]">Guru</span>`;
        } else {
            typeBadge = `<span class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-[9px]">Tamu</span>`;
        }

        const waktuStr = v.waktu ? v.waktu.substring(0, 5) : '-';

        // Resolusi foto avatar pengunjung
        let fotoUrl = '';
        if (v.tipe_pengunjung === 'guru' && Array.isArray(allTeachersCache)) {
            const matchedT = allTeachersCache.find(t =>
                (v.identitas_id && (String(t.nip || '').trim() === String(v.identitas_id).trim() || String(t.nik || '').trim() === String(v.identitas_id).trim() || String(t.id || '').trim() === String(v.identitas_id).trim())) ||
                (v.nama && String(t.nama || t.name || '').toLowerCase().trim() === String(v.nama).toLowerCase().trim())
            );
            fotoUrl = matchedT?.foto || matchedT?.photo_url || '';
        } else if (v.tipe_pengunjung === 'siswa' && Array.isArray(allStudentsCache)) {
            const matchedS = allStudentsCache.find(s =>
                (v.identitas_id && (String(s.nis || '').trim() === String(v.identitas_id).trim() || String(s.nisn || '').trim() === String(v.identitas_id).trim())) ||
                (v.nama && String(s.nama || s.name || '').toLowerCase().trim() === String(v.nama).toLowerCase().trim())
            );
            fotoUrl = matchedS?.foto || matchedS?.photo_url || matchedS?.activePhotoUrl || matchedS?.active_photo_url || matchedS?.photoUrl || '';
        }

        const initials = getVisitorInitials(v.nama);
        const resolvedPhoto = fotoUrl ? resolvePhotoUrl(fotoUrl) : '';
        const safePhoto = (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto)) ? escapeHTML(resolvedPhoto) : '';

        const avatarBg = v.tipe_pengunjung === 'guru'
            ? 'bg-gradient-to-tr from-purple-600 to-indigo-600 text-white'
            : (v.tipe_pengunjung === 'siswa' ? 'bg-gradient-to-tr from-blue-600 to-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300');

        const avatarHtml = `
            <div class="w-8 h-8 rounded-xl overflow-hidden shrink-0 bg-slate-100 dark:bg-slate-800 flex items-center justify-center shadow-2xs border border-slate-200 dark:border-slate-700 ring-1 ring-slate-200/50">
                ${safePhoto ? `<img src="${safePhoto}" alt="${escapeHTML(v.nama)}" class="w-full h-full object-cover" onerror="this.remove()">` : ''}
                <div class="w-full h-full ${avatarBg} flex items-center justify-center font-bold text-[10px] select-none">
                    <span>${initials}</span>
                </div>
            </div>
        `;

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
                <td class="px-4 py-3 font-mono font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap text-[11px]">${waktuStr}</td>
                <td class="px-4 py-3">
                    <div class="flex items-center gap-2.5">
                        ${avatarHtml}
                        <div class="min-w-0">
                            <div class="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">${escapeHTML(v.nama)} ${typeBadge}</div>
                            ${v.identitas_id ? `<div class="text-[10px] text-slate-400 font-mono">${escapeHTML(v.identitas_id)}</div>` : ''}
                        </div>
                    </div>
                </td>
                <td class="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">${escapeHTML(v.kelas_jabatan || '-')}</td>
                <td class="px-4 py-3 font-medium text-slate-700 dark:text-slate-300 text-xs">${escapeHTML(v.keperluan)}</td>
            </tr>
        `;
    }).join('');
}

// =========================================================================
// 5. EVENT LISTENERS & AUTOCOMPLETE
// =========================================================================
function setupPresensiEventListeners() {
    const inputSearch = document.getElementById('input-visitor-search');
    const dropdown = document.getElementById('visitor-autocomplete-dropdown');
    const formCheckin = document.getElementById('form-checkin');
    const btnExport = document.getElementById('btn-export-pengunjung');
    const btnResetPreview = document.getElementById('btn-reset-visitor-preview');

    if (btnResetPreview) {
        btnResetPreview.addEventListener('click', resetVisitorPreview);
    }

    // Fast-scan Keydown Enter
    inputSearch.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = inputSearch.value.trim();
            if (!val) return;
            const resolved = await resolveVisitorFromInput(val);
            if (resolved) {
                const targetRadio = document.querySelector(`input[name="visitor_type"][value="${resolved.type}"]`);
                if (targetRadio && !targetRadio.checked) {
                    targetRadio.checked = true;
                }
                selectVisitor(resolved.item, resolved.type);
                dropdown.classList.add('hidden');
                document.getElementById('input-visitor-purpose')?.focus();
            }
        }
    });

    // Autocomplete & Smart QR Scanner Input Parser
    inputSearch.addEventListener('input', async (e) => {
        let rawVal = e.target.value.trim();
        const type = document.querySelector('input[name="visitor_type"]:checked')?.value || 'siswa';

        // Auto-resolve jika input dari scan QR kartu atau NIP/NIS fisik
        if (rawVal.includes('kartu-shakti.html') || rawVal.startsWith('kts_') || /^\d{4,}$/.test(rawVal)) {
            if (extractCardTokenFromQrInput(rawVal) && !(await isQrInputSettled(inputSearch, rawVal))) return;
            const resolved = await resolveVisitorFromInput(rawVal);
            if (resolved) {
                const targetRadio = document.querySelector(`input[name="visitor_type"][value="${resolved.type}"]`);
                if (targetRadio && !targetRadio.checked) {
                    targetRadio.checked = true;
                }
                selectVisitor(resolved.item, resolved.type);
                dropdown.classList.add('hidden');
                document.getElementById('input-visitor-purpose')?.focus();
                return;
            }
        }

        const query = rawVal.toLowerCase();
        renderAutocomplete(query, type);
    });

    inputSearch.addEventListener('focus', (e) => {
        const type = document.querySelector('input[name="visitor_type"]:checked')?.value || 'siswa';
        renderAutocomplete(e.target.value.trim().toLowerCase(), type);
    });

    document.addEventListener('click', (e) => {
        if (!inputSearch.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });

    // Radio change
    document.querySelectorAll('input[name="visitor_type"]').forEach(r => {
        r.addEventListener('change', () => {
            resetVisitorPreview();
            inputSearch.focus();
        });
    });

    // Submit check-in
    formCheckin.addEventListener('submit', handleCheckinSubmit);

    // Export Excel
    btnExport.addEventListener('click', exportVisitorsToExcel);
}

function selectVisitor(item, type) {
    const nama = item.nama || item.name || 'Tanpa Nama';
    const idVal = (item.nis || item.nisn || item.nip || item.id || '').toString();
    const sub = type === 'siswa' ? (item.kelas || item.class || 'Kelas -') : (item.jabatan || 'Guru / Staf');

    document.getElementById('input-visitor-search').value = nama;
    document.getElementById('visitor-hidden-name').value = nama;
    document.getElementById('visitor-hidden-id').value = idVal;
    document.getElementById('input-visitor-class').value = sub;

    renderVisitorCardlet(item, type);
}

function renderAutocomplete(query, type) {
    const dropdown = document.getElementById('visitor-autocomplete-dropdown');
    dropdown.innerHTML = '';

    if (type === 'tamu') {
        dropdown.classList.add('hidden');
        return;
    }

    let matches = [];
    if (type === 'siswa') {
        matches = allStudentsCache.filter(s => {
            const name = (s.nama || s.name || '').toLowerCase();
            const nis = (s.nis || s.nisn || '').toString().toLowerCase();
            const kelas = (s.kelas || s.class || '').toLowerCase();
            return name.includes(query) || nis.includes(query) || kelas.includes(query);
        }).slice(0, 15);
    } else {
        matches = allTeachersCache.filter(t => {
            const name = (t.nama || t.name || '').toLowerCase();
            const nip = (t.nip || '').toString().toLowerCase();
            return name.includes(query) || nip.includes(query);
        }).slice(0, 15);
    }

    if (matches.length === 0) {
        dropdown.innerHTML = `<div class="p-3 text-xs text-slate-400 text-center italic">Ketik nama secara manual jika tidak ditemukan di daftar</div>`;
        dropdown.classList.remove('hidden');
        return;
    }

    matches.forEach(item => {
        const div = document.createElement('div');
        div.className = 'p-3 hover:bg-blue-50 dark:hover:bg-slate-700/60 cursor-pointer flex items-center justify-between text-xs transition-colors';
        
        const nama = item.nama || item.name || 'Tanpa Nama';
        const idVal = item.nis || item.nisn || item.nip || item.id || '-';
        const sub = type === 'siswa' ? (item.kelas || item.class || 'Kelas -') : (item.jabatan || 'Guru / Staf');
        const foto = item.foto || item.photo_url || item.activePhotoUrl || '';
        const initials = getVisitorInitials(nama);
        const resolvedPhoto = foto ? resolvePhotoUrl(foto) : '';
        const safePhoto = (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto)) ? escapeHTML(resolvedPhoto) : '';

        div.innerHTML = `
            <div class="flex items-center gap-2.5 min-w-0">
                <div class="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-slate-100 dark:bg-slate-700 flex items-center justify-center border border-slate-200 dark:border-slate-600">
                    ${safePhoto ? `<img src="${safePhoto}" alt="${escapeHTML(nama)}" class="w-full h-full object-cover" onerror="this.remove()">` : ''}
                    <span class="text-[10px] font-bold text-slate-500 dark:text-slate-300 select-none">${initials}</span>
                </div>
                <div class="min-w-0">
                    <span class="font-bold text-slate-800 dark:text-slate-200 block truncate">${escapeHTML(nama)}</span>
                    <span class="text-[11px] text-slate-400 font-mono block truncate">${escapeHTML(idVal.toString())}</span>
                </div>
            </div>
            <span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold text-[10px] shrink-0 ml-2">${escapeHTML(sub)}</span>
        `;

        div.addEventListener('click', () => {
            selectVisitor(item, type);
            dropdown.classList.add('hidden');
        });

        dropdown.appendChild(div);
    });

    dropdown.classList.remove('hidden');
}

// =========================================================================
// 6. PROCESS CHECK-IN
// =========================================================================
async function handleCheckinSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-checkin');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Mencatat...';

    try {
        const type = document.querySelector('input[name="visitor_type"]:checked')?.value || 'siswa';
        const searchInputVal = document.getElementById('input-visitor-search').value.trim();
        let hiddenName = document.getElementById('visitor-hidden-name').value.trim();
        let identitasId = document.getElementById('visitor-hidden-id').value.trim() || null;
        let kelasJabatan = document.getElementById('input-visitor-class').value.trim() || null;
        const keperluan = document.getElementById('input-visitor-purpose').value;

        // Auto-resolve jika form langsung disubmit scanner tanpa klik dropdown
        if (!hiddenName && searchInputVal) {
            const resolved = await resolveVisitorFromInput(searchInputVal);
            if (resolved) {
                hiddenName = resolved.item.nama || resolved.item.name;
                identitasId = resolved.item.nip || resolved.item.nis || identitasId;
                kelasJabatan = (resolved.type === 'siswa' ? (resolved.item.kelas || resolved.item.class) : resolved.item.jabatan) || kelasJabatan;
                currentVisitorPhoto = resolved.item.foto || resolved.item.photo_url || '';
            }
        }

        const nama = hiddenName || searchInputVal;

        const now = new Date();
        const waktuStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        const payload = {
            tanggal: getLocalISODate(),
            waktu: waktuStr,
            tipe_pengunjung: type,
            identitas_id: identitasId,
            nama: nama,
            kelas_jabatan: kelasJabatan,
            keperluan: keperluan
        };

        const { error } = await supabase.from('lib_pengunjung').insert([payload]);
        if (error) throw error;

        const photoUrl = currentVisitorPhoto;
        const initials = getVisitorInitials(nama);
        const resolvedPhoto = photoUrl ? resolvePhotoUrl(photoUrl) : '';
        const safePhoto = (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto)) ? escapeHTML(resolvedPhoto) : '';

        const photoHtml = safePhoto ? `
            <div class="w-16 h-16 rounded-2xl overflow-hidden shadow-md border-2 border-blue-500 ring-4 ring-blue-100 dark:ring-blue-900/40 bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-2">
                <img src="${safePhoto}" alt="${escapeHTML(nama)}" class="w-full h-full object-cover">
            </div>
        ` : `
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-extrabold text-lg flex items-center justify-center mx-auto mb-2 shadow-md ring-4 ring-blue-100 dark:ring-blue-900/40 select-none">
                <span>${initials}</span>
            </div>
        `;

        Swal.fire({
            icon: 'success',
            title: 'Selamat Datang di Perpustakaan!',
            html: `
                <div class="text-center">
                    ${photoHtml}
                    <h4 class="font-bold text-slate-800 dark:text-white text-base">${escapeHTML(nama)}</h4>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">${escapeHTML(kelasJabatan || '')}</p>
                    <div class="mt-2 text-xs font-semibold px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 inline-block">${escapeHTML(keperluan)}</div>
                </div>
            `,
            timer: 2500,
            showConfirmButton: false
        });

        // Reset Form
        document.getElementById('form-checkin').reset();
        resetVisitorPreview();

        await loadVisitorsStats();
        await loadTodayVisitors();

    } catch (err) {
        console.error('[Presensi] Error submit checkin:', err);
        Swal.fire({ icon: 'error', title: 'Gagal Check-in', text: err.message, confirmButtonColor: '#2563eb' });
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// =========================================================================
// 7. EXPORT VISITORS TO EXCEL
// =========================================================================
async function exportVisitorsToExcel() {
    Swal.fire({
        title: 'Mengekspor Data...',
        html: 'Mengambil log pengunjung perpustakaan...',
        didOpen: () => Swal.showLoading()
    });

    try {
        const { data, error } = await supabase
            .from('lib_pengunjung')
            .select('*')
            .order('tanggal', { ascending: false })
            .order('waktu', { ascending: false })
            .limit(1000);

        if (error) throw error;

        if (!data || data.length === 0) {
            Swal.fire({ icon: 'info', title: 'Data Kosong', text: 'Belum ada log pengunjung untuk diekspor.', confirmButtonColor: '#2563eb' });
            return;
        }

        const rows = data.map((v, idx) => ({
            'No': idx + 1,
            'Tanggal': v.tanggal,
            'Waktu Kunjungan': v.waktu,
            'Tipe Pengunjung': v.tipe_pengunjung.toUpperCase(),
            'NIS / NIP': v.identitas_id || '-',
            'Nama Pengunjung': v.nama,
            'Kelas / Jabatan': v.kelas_jabatan || '-',
            'Keperluan': v.keperluan
        }));

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Pengunjung Perpustakaan");
        XLSX.writeFile(wb, `Log_Pengunjung_Perpustakaan_SMANTARA_${getLocalISODate()}.xlsx`);

        Swal.close();

    } catch (e) {
        console.error('[Presensi] Error export:', e);
        Swal.fire({ icon: 'error', title: 'Gagal Export', text: e.message, confirmButtonColor: '#2563eb' });
    }
}
