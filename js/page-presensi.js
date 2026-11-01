import { auth, db, PATHS, supabase, SCHOOL_CONFIG } from './config.js';
import { initLayout, escapeHTML } from './global.js';
import { cfClient } from './cloudflare-client.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, getDocs, query, where, orderBy, doc, getDoc, setDoc, writeBatch, increment } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { fetchRegisteredHolidays, getRegisteredHoliday, isRegisteredHoliday } from './holiday-manager.js';

let currentStudents = [];
let cachedClassList = [];
// Kelas aktif sekarang di-manage oleh window.getActiveClasses() di global.js
let userRole = '';
let userAssignedClass = null;
let currentUserName = "";

const getLocalISODate = (d = new Date()) => {
    if (typeof window !== 'undefined' && typeof window.getWitaISODate === 'function') {
        return window.getWitaISODate(d);
    }
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

onAuthStateChanged(auth, (user) => {
    if (!user) { window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash); return; }

    currentUserName = user.email ? user.email.split('@')[0] : 'User';
    userRole = localStorage.getItem('user_role');

    // MULTI-ROLE: Ambil role tertinggi untuk halaman ini
    const effectiveRole = window.getEffectiveRoleForPage ?
        window.getEffectiveRoleForPage('presensi.html') : userRole;

    if (userRole === 'siswa') {
        // window.showAppAlert("Akses ditolak."); // Prevent infinite loop if pure redirect
        window.location.href = 'dashboard.html';
        return;
    }

    initLayout(effectiveRole); // Gunakan role tertinggi

    // UI ADJUSTMENT: Main Button for Read Only Users - Multi-role support
    const isReadOnlyRole = window.hasRole ?
        (!window.hasRole('super_admin') && !window.hasRole('wali_kelas') && !window.hasRole('admin_kelas') &&
            (window.hasRole('guru_mapel') || window.hasRole('staff') || window.hasRole('kepala_sekolah') || window.hasRole('kesiswaan'))) :
        ['guru_mapel', 'staff', 'kepala_sekolah', 'kesiswaan'].includes(userRole);
    if (isReadOnlyRole) {
        const btnMain = document.getElementById('btn-main-input');
        if (btnMain) btnMain.innerHTML = '<i class="fa-solid fa-eye mr-2"></i> Lihat Data';
    }

    document.querySelector('main').classList.remove('hidden');

    document.getElementById('input-date').value = getLocalISODate(); // Fix Local Timezone

    loadUserData(user.uid).then(async () => {
        await loadClassOptions();
        
        // Cek URL params/hash untuk navigasi otomatis rekap semester (Poin 7)
        await checkUrlParamsForPresensi();

        // FIX RACE CONDITION: Pastikan DOM sudah siap sebelum render summary
        if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', loadDailySummary);
        } else {
            loadDailySummary();
        }
    });

    document.getElementById('history-type').addEventListener('change', updateHistoryScope);
    window.addEventListener('hashchange', () => {
        checkUrlParamsForPresensi();
    });
});

async function loadUserData(uid) {
    try {
        let data = null;
        if (typeof window.getCurrentUserDoc === 'function') {
            data = await window.getCurrentUserDoc();
        }
        if (!data) {
            const userDoc = await getDoc(doc(db, PATHS.users, uid));
            if (userDoc.exists()) data = userDoc.data();
        }
        if (data) {
            userAssignedClass = data.assignedClass || data.handledClass || data.kelas || data.class || null;
            if (data.name) currentUserName = data.name;
        }
        // Fallback ke localStorage jika belum terisi
        if (!userAssignedClass) {
            userAssignedClass = localStorage.getItem('user_assigned_class') || localStorage.getItem('user_handled_class') || null;
        }
        // Fallback ke SSOT window.getWaliKelasCache() jika wali kelas belum ada di data user doc
        if (!userAssignedClass && typeof window.getWaliKelasCache === 'function') {
            try {
                const currentUser = auth?.currentUser;
                const userEmail = (currentUser?.email || '').trim().toLowerCase();
                const userName = (currentUserName || '').trim().toLowerCase();
                const waliCache = await window.getWaliKelasCache();
                if (waliCache && typeof waliCache.entries === 'function') {
                    for (const [k, w] of waliCache.entries()) {
                        if (w.uid === uid || 
                            (userEmail && w.email && w.email.trim().toLowerCase() === userEmail) ||
                            (userName && w.name && w.name.trim().toLowerCase() === userName)) {
                            userAssignedClass = w.assignedClass || k;
                            break;
                        }
                    }
                }
            } catch (eCache) {
                console.warn('[Presensi] getWaliKelasCache fallback error:', eCache);
            }
        }
        if (userAssignedClass) {
            userAssignedClass = String(userAssignedClass).trim().replace(/^Kelas\s+/i, '');
            localStorage.setItem('user_assigned_class', userAssignedClass); // Standard key
        }
    } catch (e) { console.error("Gagal load user:", e); }
}

// SECURITY HELPER - Menerima parameter targetClass dan optional dateVal
function checkPresensiAccess(targetClass, dateVal = null) {
    const rawMyClass = localStorage.getItem('user_assigned_class') || userAssignedClass || '';
    const myClass = rawMyClass.trim().replace(/^Kelas\s+/i, '').toLowerCase();
    const target = (targetClass || '').trim().replace(/^Kelas\s+/i, '').toLowerCase();

    // Helper multi-role safe
    const hasRole = (r) => window.hasRole ? window.hasRole(r) : localStorage.getItem('user_role') === r;

    // 1. Super Admin bypass
    if (hasRole('super_admin')) return true;

    // 2. Wali kelas: Bisa edit kelas sendiri, tanggal kapan saja (dukung multi-role guru mapel berkelas ampu)
    let allowedByWaliKelas = false;
    if (hasRole('wali_kelas') || Boolean(myClass && (hasRole('guru_mapel') || hasRole('guru')))) {
        if (myClass && target && myClass === target) {
            allowedByWaliKelas = true;
        }
    }

    // 3. Admin kelas: Bisa edit kelas sendiri, hanya H-0 atau H-1
    let allowedByAdminKelas = false;
    if (hasRole('admin_kelas')) {
        if (myClass === target) {
            const checkDate = dateVal || document.getElementById('input-date')?.value;
            if (checkDate) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const parts = checkDate.split('-');
                const targetDate = new Date(parts[0], parts[1] - 1, parts[2]);
                targetDate.setHours(0, 0, 0, 0);

                const diffTime = today - targetDate;
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                // Hanya boleh hari ini (0) atau kemarin (1)
                if (diffDays >= 0 && diffDays <= 1) {
                    allowedByAdminKelas = true;
                }
            } else {
                allowedByAdminKelas = true; // Fallback jika tidak ada tanggal
            }
        }
    }

    // Kembalikan true jika salah satu role membolehkan
    return allowedByWaliKelas || allowedByAdminKelas;
}

window.loadStudentList = async () => {
    const dateVal = document.getElementById('input-date').value;
    const classVal = document.getElementById('input-class').value;
    const tbody = document.getElementById('student-table-body');

    if (!dateVal || !classVal) {
        document.getElementById('input-class').focus();
        window.showAppAlert("Silakan pilih kelas terlebih dahulu!");
        return;
    }

    const todayStr = getLocalISODate();
    if (dateVal > todayStr) {
        window.showAppAlert("Tidak diizinkan melakukan presensi untuk tanggal masa depan.");
        document.getElementById('input-date').value = todayStr;
        return;
    }

    document.getElementById('daily-summary-container').classList.add('hidden');
    document.getElementById('attendance-list-container').classList.remove('hidden');

    tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center"><i class="fa-solid fa-spinner fa-spin text-blue-500"></i> Memuat daftar siswa...</td></tr>`;

    // 1. Check Access State (Logic Centralized) - Sertakan dateVal untuk validasi batas waktu admin_kelas
    const isAllowed = checkPresensiAccess(classVal, dateVal);
    const isReadOnly = !isAllowed; // Compatibility variable

    try {
        const existingDoc = await window.fetchClassAttendance(classVal, dateVal);
        const existingRecords = existingDoc.records || {};

        // GUNAKAN GLOBAL CACHE (Hemat Kuota Read) - Filter by class di client-side
        const allStudents = await window.getStudentsCache();
        const classStudents = allStudents
            .filter(s => s.class === classVal)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        currentStudents = [];
        let html = '';

        if (classStudents.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-red-500">Tidak ada siswa di kelas ${classVal}.</td></tr>`;
            return;
        }

        classStudents.forEach(s => {
            const sid = s.id || s.nis;
            const nis = s.nis || "";

            let savedData = null;
            if (nis && existingRecords) {
                // Cari record yang punya nis sama
                savedData = Object.values(existingRecords).find(r => r.nis === String(nis));
            }
            savedData = savedData || { status: 'H', note: '', hasLetter: false };

            currentStudents.push({
                id: sid, nis: nis, name: s.name, status: savedData.status, note: savedData.note, hasLetter: savedData.hasLetter
            });

            const check = (st) => savedData.status === st ? 'checked' : '';

            // Render UI with Disabled State if Check Fails
            // Row utama
            html += `
            <tr class="hover:bg-blue-50 dark:hover:bg-slate-700/50 transition border-b border-slate-50 dark:border-slate-700/50 md:border-b" id="row-main-${sid}">
                <td class="px-4 py-3 font-mono text-center text-xs text-slate-500 dark:text-slate-400 hidden md:table-cell">${escapeHTML(nis || '-')}</td>
                <td class="px-1.5 md:px-4 py-1.5 md:py-3 max-w-[80px] md:max-w-none">
                    <div class="font-bold text-slate-700 dark:text-slate-200 text-[11px] md:text-sm md:truncate leading-tight">${escapeHTML(s.name)}</div>
                </td>
                ${renderRadio(sid, 'H', 'green', check('H'), 'H', isReadOnly ? 'disabled' : '')}
                ${renderRadio(sid, 'S', 'yellow', check('S'), 'S', isReadOnly ? 'disabled' : '')}
                ${renderRadio(sid, 'I', 'blue', check('I'), 'I', isReadOnly ? 'disabled' : '')}
                ${renderRadio(sid, 'A', 'red', check('A'), 'A', isReadOnly ? 'disabled' : '')}
                ${renderRadio(sid, 'D', 'purple', check('D'), 'D', isReadOnly ? 'disabled' : '')}
                <!-- Kolom keterangan hanya tampil di desktop -->
                <td class="px-2 md:px-4 py-2 hidden md:table-cell">
                    <div id="note-box-${sid}">${isReadOnly && savedData.note ? `<span class="text-[10px] md:text-xs text-slate-600 dark:text-slate-400 italic border dark:border-slate-700/50 px-1 md:px-2 py-0.5 md:py-1 rounded bg-slate-50 dark:bg-slate-800 block truncate">${escapeHTML(savedData.note)}</span>` : ''}</div>
                </td>
            </tr>
            <!-- Row form keterangan khusus mobile (muncul jika S/I/D) -->
            <tr id="row-mobile-note-${sid}" class="md:hidden hidden bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700/50">
                <td colspan="6" class="px-2 py-2">
                    <div id="note-box-mobile-${sid}"></div>
                </td>
            </tr>`;
        });

        tbody.innerHTML = html;

        if (!isReadOnly) {
            currentStudents.forEach(s => renderNoteUI(s.id, s.status, s.note, s.hasLetter));
            document.getElementById('presensi-alert-container').innerHTML = ''; // Clear alert if allowed
        } else {
            // Evaluasi detail penyebab ReadOnly untuk menampilkan alert yang kontekstual & informatif
            const role = localStorage.getItem('user_role');
            const myAssignedClass = (localStorage.getItem('user_assigned_class') || '').trim();
            const isAdminKelas = window.hasRole ? window.hasRole('admin_kelas') : role === 'admin_kelas';

            // Hitung selisih hari
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const parts = dateVal.split('-');
            const targetDate = new Date(parts[0], parts[1] - 1, parts[2]);
            targetDate.setHours(0, 0, 0, 0);
            const diffTime = today - targetDate;
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

            let readOnlyMsg = '';

            // SKENARIO 1: Admin Kelas membuka kelasnya sendiri tetapi tanggal sudah lewat (> 1 hari / H-2 ke belakang)
            if (isAdminKelas && myAssignedClass === classVal.trim() && diffDays > 1) {
                let waliName = 'Wali Kelas';
                let waliPhone = '';
                try {
                    const waliData = typeof window.getWaliKelasByClass === 'function' ? await window.getWaliKelasByClass(classVal) : null;
                    if (waliData && waliData.name) {
                        waliName = waliData.name;
                        if (waliData.phone) {
                            waliPhone = waliData.phone;
                        } else if (typeof window.getTeachersCache === 'function') {
                            const teachers = await window.getTeachersCache();
                            const found = teachers.find(t => t.name === waliData.name);
                            if (found && (found.phone || found.kontak || found.hp)) {
                                waliPhone = found.phone || found.kontak || found.hp;
                            }
                        }
                    }
                } catch (errWali) {
                    console.warn('[Presensi] Gagal memuat info wali kelas:', errWali);
                }

                let waButtonHtml = '';
                if (waliPhone) {
                    let cleanPhone = waliPhone.replace(/[^0-9]/g, '');
                    if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.substring(1);
                    const waText = encodeURIComponent(`Halo Bapak/Ibu ${waliName}, saya Admin Kelas ${classVal}. Mohon bantuannya untuk perbaikan/pengisian presensi siswa tanggal ${dateVal} karena sudah melewati batas waktu penginputan admin kelas (H-1). Terima kasih.`);
                    waButtonHtml = `
                        <a href="https://api.whatsapp.com/send?phone=${cleanPhone}&text=${waText}" target="_blank" rel="noopener noreferrer"
                           class="inline-flex items-center gap-1.5 mt-2.5 px-3.5 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all active:scale-95">
                            <i class="fa-brands fa-whatsapp text-sm"></i> Hubungi ${escapeHTML(waliName)} via WhatsApp
                        </a>
                    `;
                }

                readOnlyMsg = `
                <div class="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 text-amber-900 dark:text-amber-200 p-4 mb-4 rounded-xl shadow-sm animate-fade-in">
                    <div class="flex items-start gap-3">
                        <div class="p-2.5 bg-amber-100 dark:bg-amber-900/50 rounded-xl text-amber-700 dark:text-amber-300 mt-0.5 shrink-0">
                            <i class="fa-solid fa-clock-rotate-left text-xl"></i>
                        </div>
                        <div class="text-left text-xs md:text-sm">
                            <div class="font-bold text-amber-950 dark:text-amber-100 flex flex-wrap items-center gap-2 mb-1">
                                <span>Batas Waktu Pengisian Presensi Telah Lewat</span>
                                <span class="bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 text-[10px] px-2 py-0.5 rounded font-bold">Mode Lihat Saja</span>
                            </div>
                            <p class="text-amber-800 dark:text-amber-300 leading-relaxed">
                                Admin Kelas hanya dapat menginput atau mengubah presensi untuk <strong>Hari Ini (H-0)</strong> dan <strong>Kemarin (H-1)</strong>. Jika terdapat perbaikan atau pengisian susulan presensi pada tanggal ini (<strong>${escapeHTML(dateVal)}</strong>), silakan <strong>hubungi Wali Kelas (${escapeHTML(waliName)})</strong> karena Wali Kelas memiliki hak akses untuk mengedit presensi tanggal lampau.
                            </p>
                            ${waButtonHtml}
                        </div>
                    </div>
                </div>`;
            } else {
                // Skenario role lainnya
                let warningText = `Anda adalah Wali Kelas ${myAssignedClass || 'Lain'}`;
                if (role === 'guru_mapel') warningText = "Akses Guru Mapel (View Only)";
                else if (role === 'staff') warningText = "Akses Staff (View Only)";
                else if (role === 'kepala_sekolah') warningText = "Akses Kepala Sekolah (View Only)";
                else if (role === 'kesiswaan') warningText = "Akses Kesiswaan (View Only)";
                else if (isAdminKelas && myAssignedClass !== classVal.trim()) warningText = `Anda adalah Admin Kelas ${myAssignedClass || 'Lain'}`;
                else if (role !== 'wali_kelas') warningText = "Akses Lihat Saja (View Only)";

                readOnlyMsg = `
                <div class="bg-yellow-50 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-200 p-3 mb-4 rounded-xl border border-yellow-200 dark:border-yellow-700/50 text-center text-sm font-bold animate-fade-in shadow-sm">
                    <i class="fa-solid fa-eye mr-2"></i> Mode Lihat Saja (${escapeHTML(warningText)})
                </div>`;
            }

            const msgContainer = document.getElementById('presensi-alert-container');
            if (msgContainer) msgContainer.innerHTML = readOnlyMsg;
        }

    } catch (e) {
        console.error(e);
        window.showAppAlert("Gagal memuat siswa: " + e.message);
        window.closeInputMode();
        return; // Important return
    }

    // --- LATE BINDING UI ENFORCEMENT (Runs after everything else) ---
    // Hide Save Button if Access Denied -> Change to "Lihat" button as requested
    const saveBtn = document.getElementById('btn-save-attendance') || document.querySelector("button[onclick*='saveAttendance']");
    if (saveBtn) {
        if (!isAllowed) {
            // Ubah jadi tombol "Lihat" (Non-aktif)
            saveBtn.classList.remove('hidden');
            saveBtn.style.display = '';
            saveBtn.disabled = true;
            saveBtn.onclick = null;
            saveBtn.innerHTML = '<i class="fa-solid fa-eye"></i> Mode Lihat (View Only)';
            saveBtn.className = "w-full md:w-auto bg-slate-400 text-white px-8 py-3 rounded-lg font-bold shadow cursor-not-allowed flex items-center justify-center gap-3";
        } else {
            // Restore tombol Simpan
            saveBtn.classList.remove('hidden');
            saveBtn.style.display = '';
            saveBtn.disabled = false;
            saveBtn.setAttribute('onclick', 'window.saveAttendance()');
            saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Data Presensi';
            saveBtn.className = "w-full md:w-auto bg-green-600 text-white px-8 py-3 rounded-lg font-bold shadow-xl hover:bg-green-700 flex items-center justify-center gap-3 transition-transform active:scale-95";
        }
    }
};

// function renderRadio(sid, val, color, checked, label, disabled = '') {
function renderRadio(sid, val, color, checked, label, explicitDisabled = '') {
    // PARANOID CHECK: Force Check LocalStorage again
    const role = localStorage.getItem('user_role');
    const myClass = localStorage.getItem('user_assigned_class') || '';
    const targetClass = document.getElementById('input-class').value || '';

    let isDisabled = explicitDisabled === 'disabled';

    // Multi-role: Cek apakah user punya role read-only DAN tidak punya role yang bisa edit
    // kesiswaan = read-only untuk presensi (konsisten dengan checkPresensiAccess)
    const readOnlyRoles = ['guru_mapel', 'staff', 'kepala_sekolah', 'kesiswaan'];
    const editRoles = ['super_admin', 'wali_kelas', 'admin_kelas'];
    const isReadOnlyRole = window.hasRole ?
        readOnlyRoles.some(r => window.hasRole(r)) && !editRoles.some(r => window.hasRole(r)) :
        readOnlyRoles.includes(role);
    if (isReadOnlyRole) {
        isDisabled = true;
    }

    // Multi-role: Gunakan hasRole agar additional role wali_kelas juga terdeteksi
    const hasWaliKelas = window.hasRole ? window.hasRole('wali_kelas') : role === 'wali_kelas';
    if (hasWaliKelas && !window.hasRole?.('admin_kelas')) {
        const cleanMyClass = myClass.trim().replace(/^Kelas\s+/i, '').toLowerCase();
        const cleanTargetClass = targetClass.trim().replace(/^Kelas\s+/i, '').toLowerCase();
        if (cleanMyClass !== cleanTargetClass) {
            isDisabled = true;
        }
    }

    const disabledAttr = ''; // REMOVED disabled attribute to keep colors vivid
    const cursor = isDisabled ? 'cursor-not-allowed' : 'cursor-pointer';
    const clickEvt = isDisabled ? '' : `onclick="document.querySelector('input[name=att_${sid}][value=${val}]').click()"`;

    // Prevent interaction if disabled (Keyboard & Mouse)
    const inputClick = isDisabled ? 'onclick="return false;"' : `onclick="updateStatus('${sid}', '${val}')"`;
    const pointerEvents = isDisabled ? 'pointer-events-none' : '';

    return `<td class="px-0.5 md:px-1 text-center bg-${color}-50/50 dark:bg-${color}-900/10 border-r border-white dark:border-slate-700/50">
        <div class="flex flex-col items-center justify-center py-1 md:py-2 ${cursor}" ${clickEvt}>
            <span class="text-[7px] md:text-[10px] leading-none mb-0.5 md:mb-1 text-slate-400 dark:text-slate-500 font-medium block">${label}</span>
            <input type="radio" name="att_${sid}" value="${val}" ${checked} ${disabledAttr} class="w-4 h-4 md:w-5 md:h-5 accent-${color}-600 ${cursor} ${pointerEvents}" ${inputClick}>
        </div>
    </td>`;
}

async function loadClassOptions() {
    const selectInput = document.getElementById('input-class');
    if (!selectInput) return;

    try {
        // Gunakan helper global terpusat (hemat Firestore, pakai cache)
        cachedClassList = await window.getActiveClasses();

        const hasRoleHelper = (r) => window.hasRole ? window.hasRole(r) : (userRole === r);
        const isWali = hasRoleHelper('wali_kelas') || Boolean(userAssignedClass && (hasRoleHelper('guru_mapel') || hasRoleHelper('guru')));
        const isAdmin = hasRoleHelper('admin_kelas');

        const cleanAssignedClass = userAssignedClass ? String(userAssignedClass).trim().replace(/^Kelas\s+/i, '') : '';
        const normAssignedClass = cleanAssignedClass.replace(/[\s\-_]+/g, '').toLowerCase();

        let htmlInput = '<option value="">-- Pilih Kelas --</option>';

        cachedClassList.forEach(c => {
            const cleanC = String(c).trim().replace(/^Kelas\s+/i, '');
            // FITUR REQUES: Admin Kelas (Siswa) hanya boleh melihat kelasnya sendiri di input
            if (isAdmin && cleanAssignedClass && cleanC.toLowerCase() !== cleanAssignedClass.toLowerCase()) {
                return;
            }
            htmlInput += `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`;
        });

        selectInput.innerHTML = htmlInput;
        selectInput.disabled = false; // Wali Kelas & umum tetap bisa memilih / ganti kelas

        // Auto-select kelas sendiri secara instan jika ada (Wali Kelas / Admin Kelas)
        if ((isWali || isAdmin) && cleanAssignedClass) {
            let matchedValue = '';
            for (const opt of selectInput.options) {
                if (!opt.value) continue;
                const cleanOpt = opt.value.trim().replace(/^Kelas\s+/i, '');
                if (opt.value === cleanAssignedClass || cleanOpt.toLowerCase() === cleanAssignedClass.toLowerCase()) {
                    matchedValue = opt.value;
                    break;
                }
            }
            if (!matchedValue) {
                for (const opt of selectInput.options) {
                    if (!opt.value) continue;
                    const normOpt = opt.value.trim().replace(/^Kelas\s+/i, '').replace(/[\s\-_]+/g, '').toLowerCase();
                    if (normOpt && normOpt === normAssignedClass) {
                        matchedValue = opt.value;
                        break;
                    }
                }
            }

            if (matchedValue) {
                selectInput.value = matchedValue;
            }
        }

        updateHistoryScope();

    } catch (e) { console.error("Gagal load kelas:", e); }
}

function updateHistoryScope() {
    const selectHist = document.getElementById('history-scope');
    if (!selectHist) return;
    const reportType = document.getElementById('history-type')?.value;

    let html = '<option value="">-- Pilih Kelas--</option>';
    let isDisabled = false;

    const hasRoleHelper = (r) => window.hasRole ? window.hasRole(r) : (userRole === r);
    const isWali = hasRoleHelper('wali_kelas') || Boolean(userAssignedClass && (hasRoleHelper('guru_mapel') || hasRoleHelper('guru')));
    const isAdmin = hasRoleHelper('admin_kelas');

    if (isAdmin && userAssignedClass) {
        // Admin Kelas (Siswa): dikunci hanya kelas sendiri
        html = `<option value="${escapeHTML(userAssignedClass)}">${escapeHTML(userAssignedClass)}</option>`;
        isDisabled = true;
    } else {
        cachedClassList.forEach(c => {
            html += `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`;
        });

        if (reportType === 'daily') {
            html += '<option disabled class="bg-slate-50 text-slate-300 font-bold text-center">────── REKAP ANGKATAN ──────</option>';
            html += '<option value="ALL-X" class="font-bold bg-blue-50 text-blue-800">Kelas X</option>';
            html += '<option value="ALL-XI" class="font-bold bg-blue-50 text-blue-800">Kelas XI</option>';
            html += '<option value="ALL-XII" class="font-bold bg-blue-50 text-blue-800">Kelas XII</option>';
        }
    }

    selectHist.innerHTML = html;
    selectHist.disabled = isDisabled;

    // Untuk wali kelas di history: auto-select kelas sendiri, tapi tetap bisa ganti kelas jika tidak disabled
    if (isWali && userAssignedClass && !isDisabled) {
        const cleanAssigned = String(userAssignedClass).trim().replace(/^Kelas\s+/i, '');
        for (const opt of selectHist.options) {
            if (opt.value && (opt.value === userAssignedClass || opt.value.trim().replace(/^Kelas\s+/i, '').toLowerCase() === cleanAssigned.toLowerCase())) {
                selectHist.value = opt.value;
                break;
            }
        }
    }
}

/**
 * Memeriksa dan menampilkan banner informatif Hari Libur Sekolah di presensi siswa
 */
export async function checkAndRenderHolidayBanner(targetDate = null) {
    const banner = document.getElementById('holiday-banner-presensi');
    if (!banner) return;

    const rawDate = targetDate || document.getElementById('input-date')?.value;
    if (!rawDate) {
        banner.classList.add('hidden');
        banner.innerHTML = '';
        return;
    }
    const m = String(rawDate).match(/^(\d{4}-\d{2}-\d{2})/);
    const dateVal = m ? m[1] : String(rawDate).trim();

    let holiday = null;
    // 1. Cek memory cache lokal SSOT
    if (typeof getRegisteredHoliday === 'function') {
        holiday = getRegisteredHoliday(dateVal);
    }
    if (!holiday && typeof window !== 'undefined' && window.HolidayManager?.getRegisteredHoliday) {
        holiday = window.HolidayManager.getRegisteredHoliday(dateVal);
    }
    // 2. Cek master libur nasional resmi (in-memory, instan tanpa latensi jaringan)
    if (!holiday && typeof window !== 'undefined' && window.DataHolidays?.isNationalHoliday?.(dateVal)) {
        holiday = window.DataHolidays.getHolidayForDate(dateVal);
    }
    // 3. Fallback network fetch jika belum tercatat di memori lokal
    if (!holiday && typeof fetchRegisteredHolidays === 'function') {
        try {
            const list = await fetchRegisteredHolidays(dateVal, dateVal);
            holiday = list && list.length > 0 ? list[0] : null;
        } catch (e) {}
    }

    if (holiday) {
        const isNational = Boolean(typeof window !== 'undefined' && window.DataHolidays?.isNationalHoliday?.(dateVal));
        const holidayLabel = isNational ? 'Hari Libur Nasional' : 'Hari Libur Sekolah';
        const holidayName = holiday.nama || holiday.title || holiday.name || 'Hari Libur';
        banner.innerHTML = `
            <div class="flex items-center gap-2.5">
                <i class="fa-solid fa-calendar-day text-amber-600 dark:text-amber-400 text-base shrink-0"></i>
                <div class="leading-relaxed">
                    <span class="font-bold text-amber-900 dark:text-amber-200">${holidayLabel}: ${escapeHTML(holidayName)}.</span>
                    <span class="text-amber-800/90 dark:text-amber-300/90 ml-1">Form dan tombol presensi tetap aktif jika kelas Anda mengadakan kegiatan atau dispensasi khusus.</span>
                </div>
            </div>
        `;
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
        banner.innerHTML = '';
    }
}

// ==========================================
// BAGIAN 2: INPUT HARIAN (SSOT CORE)
// ==========================================
document.getElementById('input-date').addEventListener('change', () => {
    window.closeInputMode();
    checkAndRenderHolidayBanner();
    loadDailySummary();
});

// State Sorting Rekap Harian
window.dailySummarySortField = 'class';
window.dailySummarySortDirection = 'asc';
window.currentDailySummaryRows = [];
window.currentDailySummaryDate = '';

window.toggleDailySummarySort = (field) => {
    if (window.dailySummarySortField === field) {
        window.dailySummarySortDirection = (window.dailySummarySortDirection === 'asc') ? 'desc' : 'asc';
    } else {
        window.dailySummarySortField = field;
        // Jika mengurutkan persentase, default dari persentase kehadiran tertinggi (desc)
        window.dailySummarySortDirection = (field === 'percentage') ? 'desc' : 'asc';
    }
    updateDailySummarySortIcons();
    renderDailySummaryRows();
};

function updateDailySummarySortIcons() {
    const classIcon = document.getElementById('sort-icon-class');
    const pctIcon = document.getElementById('sort-icon-percentage');
    if (!classIcon || !pctIcon) return;

    if (window.dailySummarySortField === 'percentage') {
        classIcon.className = 'fa-solid fa-sort text-slate-400 text-[10px]';
        pctIcon.className = (window.dailySummarySortDirection === 'asc')
            ? 'fa-solid fa-arrow-up-wide-short text-emerald-600 text-[10px]'
            : 'fa-solid fa-arrow-down-wide-short text-emerald-600 text-[10px]';
    } else {
        pctIcon.className = 'fa-solid fa-sort text-emerald-500/60 text-[10px]';
        classIcon.className = (window.dailySummarySortDirection === 'asc')
            ? 'fa-solid fa-arrow-down-a-z text-blue-600 text-[10px]'
            : 'fa-solid fa-arrow-up-z-a text-blue-600 text-[10px]';
    }
}


window.onToggleIncludeSakitHistory = function (checked) {
    try {
        localStorage.setItem('simas_presensi_include_sakit', checked ? 'true' : 'false');
    } catch (_) {}
    const badge = document.getElementById('badge-mode-akademik-history');
    if (badge) {
        if (checked) badge.classList.remove('hidden');
        else badge.classList.add('hidden');
    }
    const type = document.getElementById('history-type')?.value;
    if (type === 'monthly') {
        loadRecapMonthly();
    } else if (type === 'semester') {
        loadRecapSemester();
    }
};

function getPresensiIncludeSakitPref() {
    try {
        return localStorage.getItem('simas_presensi_include_sakit') === 'true';
    } catch (_) {
        return false;
    }
}

function getAttendanceSummaryStats(summary, options = {}) {
    if (typeof window.calculateAttendanceStats === 'function') {
        return window.calculateAttendanceStats(summary, options);
    }
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

    return { total, hadirCount, attPct, attPctRounded, attPctFormatted, tier, includeSakit };
}

function getAttendanceBadgeClass(tier) {
    if (tier === 'rose') {
        return 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border border-rose-300 dark:border-rose-700';
    }
    if (tier === 'amber') {
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700';
    }
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700';
}

window.getAttendanceSummaryStats = getAttendanceSummaryStats;
window.getAttendanceBadgeClass = getAttendanceBadgeClass;

function renderDailySummaryRows() {
    const tbody = document.getElementById('daily-summary-body');
    if (!tbody) return;

    const rawRows = window.currentDailySummaryRows || [];
    if (rawRows.length === 0) return;

    const dateVal = window.currentDailySummaryDate || document.getElementById('input-date').value;
    const field = window.dailySummarySortField || 'class';
    const dir = window.dailySummarySortDirection || 'asc';

    const rows = [...rawRows].sort((a, b) => {
        if (field === 'percentage') {
            const statA = getAttendanceSummaryStats(a.summary);
            const statB = getAttendanceSummaryStats(b.summary);

            if (statA.attPct !== statB.attPct) {
                return dir === 'asc' ? statA.attPct - statB.attPct : statB.attPct - statA.attPct;
            }
            // Fallback: Urutkan nama kelas
            return (a.class || '').localeCompare(b.class || '', undefined, { numeric: true });
        } else {
            const cmp = (a.class || '').localeCompare(b.class || '', undefined, { numeric: true });
            return dir === 'asc' ? cmp : -cmp;
        }
    });

    let html = '';
    rows.forEach(d => {
        const stats = getAttendanceSummaryStats(d.summary);
        const sum = d.summary || { H: 0, S: 0, I: 0, D: 0, A: 0 };
        const total = stats.total;
        const attPctFormatted = stats.attPctFormatted;

        // Styling persentase berdasarkan tingkat kehadiran SSOT tier
        let pctBadgeClass = 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50';
        if (stats.tier === 'rose') {
            pctBadgeClass = 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800/50';
        } else if (stats.tier === 'amber') {
            pctBadgeClass = 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50';
        }

        // LOGIC BARU: Cek Batas Waktu Admin Kelas (Hanya boleh edit Hari Ini & Kemarin)
        let isTimeAllowed = true;
        // Multi-role: Gunakan hasRole agar additional role admin_kelas juga terdeteksi
        const isAdminKelas = window.hasRole ? window.hasRole('admin_kelas') : userRole === 'admin_kelas';
        if (isAdminKelas) {
            const parts = dateVal.split('-');
            const curDate = new Date(); curDate.setHours(0, 0, 0, 0);
            const targetDate = new Date(parts[0], parts[1] - 1, parts[2]); // Local midnight

            const diffTime = curDate - targetDate;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            // Allow hanya jika diff 0 (hari ini) atau 1 (kemarin). Lebih dari itu block.
            if (diffDays > 1) isTimeAllowed = false;
        }

        const canEdit = (window.canDo ? window.canDo('edit_presensi', { targetClass: d.class }) : true) && isTimeAllowed;

        // LOGIC BARU: Jika tidak bisa edit, tetap muncul tombol tapi labelnya "Lihat"
        // FITUR REQUES: Jika Admin Kelas melihat kelas orang lain -> SEMBUNYIKAN TOMBOL
        let editBtn = '';

        if (isAdminKelas && d.class !== userAssignedClass) {
            editBtn = ''; // Hide Completely
        } else {
            editBtn = canEdit
                ? `<button onclick="window.editAttendance('${d.class}')" class="text-xs font-bold text-blue-600 hover:text-blue-800 bg-blue-100 px-3 py-1.5 rounded transition-transform active:scale-95"><i class="fa-solid fa-pen-to-square"></i> Edit</button>`
                : `<button onclick="window.editAttendance('${d.class}')" class="text-xs font-bold text-slate-500 hover:text-slate-700 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded transition-transform active:scale-95"><i class="fa-solid fa-eye"></i> Lihat</button>`;
        }

        html += `
        <tr class="hover:bg-blue-50 dark:hover:bg-slate-700/50 transition border-b border-slate-50 dark:border-slate-700/50 last:border-0">
            <td class="px-4 py-3 font-bold text-slate-800 dark:text-slate-200">${escapeHTML(d.class)}</td>
            <td class="px-3 py-3 text-center border-l dark:border-slate-700/50">
                <span class="inline-flex items-center justify-center font-bold text-xs px-2.5 py-0.5 rounded-full ${pctBadgeClass}">
                    ${attPctFormatted}
                </span>
            </td>
            <td class="px-2 py-3 text-center text-green-600 dark:text-green-400 bg-green-50/50 dark:bg-green-900/10 border-l dark:border-slate-700/50">${sum.H}</td>
            <td class="px-2 py-3 text-center text-yellow-600 dark:text-yellow-400 bg-yellow-50/50 dark:bg-yellow-900/10">${sum.S}</td>
            <td class="px-2 py-3 text-center text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/10">${sum.I}</td>
            <td class="px-2 py-3 text-center text-purple-600 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-900/10">${sum.D}</td>
            <td class="px-2 py-3 text-center text-red-600 dark:text-red-400 bg-red-50/50 dark:bg-red-900/10 font-bold">${sum.A}</td>
            <td class="px-4 py-3 text-center text-slate-500 dark:text-slate-400">${total}</td>
            <td class="px-4 py-3 text-right">
                ${editBtn}
            </td>
        </tr>`;
    });

    // Baris agregasi total sekolah jika terdapat lebih dari 1 kelas yang mengisi
    if (rows.length > 1) {
        let totalH = 0, totalS = 0, totalI = 0, totalD = 0, totalA = 0;
        rows.forEach(d => {
            const s = d.summary || {};
            totalH += (s.H || 0);
            totalS += (s.S || 0);
            totalI += (s.I || 0);
            totalD += (s.D || 0);
            totalA += (s.A || 0);
        });
        const grandStats = getAttendanceSummaryStats({ H: totalH, S: totalS, I: totalI, D: totalD, A: totalA });
        const grandTotal = grandStats.total;
        const grandPctFormatted = grandStats.attPctFormatted;
        const grandPctBadge = getAttendanceBadgeClass(grandStats.tier);

        html += `
        <tr class="bg-slate-100/80 dark:bg-slate-900/60 font-bold border-t-2 border-slate-300 dark:border-slate-700">
            <td class="px-4 py-3 text-slate-800 dark:text-slate-100">Total (${rows.length} Kelas)</td>
            <td class="px-3 py-3 text-center border-l dark:border-slate-700/50">
                <span class="inline-flex items-center justify-center font-bold text-xs px-2.5 py-0.5 rounded-full ${grandPctBadge}">
                    ${grandPctFormatted}
                </span>
            </td>
            <td class="px-2 py-3 text-center text-green-700 dark:text-green-400 bg-green-100/50 dark:bg-green-900/20 border-l dark:border-slate-700/50">${totalH}</td>
            <td class="px-2 py-3 text-center text-yellow-700 dark:text-yellow-400 bg-yellow-100/50 dark:bg-yellow-900/20">${totalS}</td>
            <td class="px-2 py-3 text-center text-blue-700 dark:text-blue-400 bg-blue-100/50 dark:bg-blue-900/20">${totalI}</td>
            <td class="px-2 py-3 text-center text-purple-700 dark:text-purple-400 bg-purple-100/50 dark:bg-purple-900/20">${totalD}</td>
            <td class="px-2 py-3 text-center text-red-700 dark:text-red-400 bg-red-100/50 dark:bg-red-900/20">${totalA}</td>
            <td class="px-4 py-3 text-center text-slate-700 dark:text-slate-300">${grandTotal}</td>
            <td class="px-4 py-3"></td>
        </tr>`;
    }

    tbody.innerHTML = html;
}

async function loadDailySummary() {
    const dateVal = document.getElementById('input-date').value;
    checkAndRenderHolidayBanner(dateVal);
    const dateObj = new Date(dateVal);
    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    document.getElementById('summary-date-display').innerText = dateObj.toLocaleDateString('id-ID', options);

    const tbody = document.getElementById('daily-summary-body');
    tbody.innerHTML = '<tr><td colspan="9" class="p-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>';

    try {
        const { rows, source } = await window.fetchDailyAttendanceSummary(dateVal);

        if (!rows || rows.length === 0) {
            window.currentDailySummaryRows = [];
            window.currentDailySummaryDate = dateVal;
            tbody.innerHTML = '<tr><td colspan="9" class="p-8 text-center text-slate-400 border border-dashed border-slate-200 rounded-lg">Belum ada kelas yang melakukan presensi pada tanggal ini.</td></tr>';

            // Tampilkan semua kelas sebagai belum presensi
            const missingContainer = document.getElementById('missing-classes-container');
            // cachedClassList sudah difilter oleh getActiveClasses(), langsung pakai
            const monitoredClasses = cachedClassList;
            if (missingContainer && monitoredClasses && monitoredClasses.length > 0) {
                missingContainer.classList.remove('hidden');
                missingContainer.innerHTML = `
                    <div class="bg-orange-50 border border-orange-200 rounded-xl p-3">
                        <div class="flex items-center gap-2 mb-2">
                            <i class="fa-solid fa-circle-exclamation text-orange-500"></i>
                            <span class="text-xs font-bold text-orange-700 uppercase tracking-wider">Belum Input Presensi (${monitoredClasses.length} Kelas)</span>
                        </div>
                        <div class="flex flex-wrap gap-1.5">
                            ${monitoredClasses.map(c => renderMissingClassBadge(c)).join('')}
                        </div>
                    </div>`;
            }
            return;
        }

        window.currentDailySummaryRows = rows;
        window.currentDailySummaryDate = dateVal;
        updateDailySummarySortIcons();
        renderDailySummaryRows();

        // --- TAMPILKAN KELAS YANG BELUM PRESENSI ---
        const missingContainer = document.getElementById('missing-classes-container');
        // cachedClassList sudah difilter oleh getActiveClasses(), langsung pakai
        const monitoredClasses = cachedClassList;
        if (missingContainer && monitoredClasses && monitoredClasses.length > 0) {
            const normalizeClass = (name) => (name || '').toString().trim().toUpperCase();
            const doneClasses = new Set(rows.map(r => normalizeClass(r.class)));
            const missingClasses = monitoredClasses.filter(c => !doneClasses.has(normalizeClass(c)));

            if (missingClasses.length > 0) {
                missingContainer.classList.remove('hidden');
                missingContainer.innerHTML = `
                    <div class="bg-orange-50 border border-orange-200 rounded-xl p-3">
                        <div class="flex items-center gap-2 mb-2">
                            <i class="fa-solid fa-circle-exclamation text-orange-500"></i>
                            <span class="text-xs font-bold text-orange-700 uppercase tracking-wider">Belum Input Presensi (${missingClasses.length} Kelas)</span>
                        </div>
                        <div class="flex flex-wrap gap-1.5">
                            ${missingClasses.map(c => renderMissingClassBadge(c)).join('')}
                        </div>
                    </div>`;
            } else {
                missingContainer.classList.remove('hidden');
                missingContainer.innerHTML = `
                    <div class="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2">
                        <i class="fa-solid fa-circle-check text-green-500"></i>
                        <span class="text-sm font-bold text-green-700">Semua kelas sudah melakukan presensi! ✅</span>
                    </div>`;
            }
        }

    } catch (e) { console.error(e); tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-red-500">Error.</td></tr>`; }
}

window.editAttendance = (className) => { document.getElementById('input-class').value = className; window.loadStudentList(); };
window.closeInputMode = () => {
    document.getElementById('attendance-list-container')?.classList.add('hidden');
    document.getElementById('daily-summary-container')?.classList.remove('hidden');
    const selectInput = document.getElementById('input-class');
    if (selectInput) {
        const hasRoleHelper = (r) => window.hasRole ? window.hasRole(r) : (userRole === r);
        const isWali = hasRoleHelper('wali_kelas') || Boolean(userAssignedClass && (hasRoleHelper('guru_mapel') || hasRoleHelper('guru')));
        const isAdmin = hasRoleHelper('admin_kelas');
        if ((isWali || isAdmin) && userAssignedClass) {
            selectInput.value = userAssignedClass;
        } else {
            selectInput.value = "";
        }
    }
    loadDailySummary();
};

// ==========================================
// BAGIAN 2B: RENDER BADGE KELAS BELUM PRESENSI (CLICKABLE)
// ==========================================

/**
 * Render badge kelas yang belum presensi.
 * Jika user punya akses kirim pengingat → badge bisa diklik.
 * Role yang diizinkan: super_admin, kesiswaan, kepala_sekolah, guru_mapel
 */
function renderMissingClassBadge(className) {
    const hasRole = (r) => window.hasRole ? window.hasRole(r) : localStorage.getItem('user_role') === r;
    const canSendReminder = hasRole('super_admin') || hasRole('kesiswaan') || hasRole('kepala_sekolah') || hasRole('guru_mapel');

    if (canSendReminder) {
        return `<span 
            class="bg-white border border-orange-200 text-orange-800 px-2.5 py-1 rounded-lg text-xs font-bold shadow-sm cursor-pointer hover:bg-orange-100 hover:border-orange-400 hover:shadow-md transition-all active:scale-95 select-none"
            onclick="window.sendAttendanceReminder('${escapeHTML(className)}', this)"
            title="Klik untuk kirim pengingat WA ke Wali Kelas ${escapeHTML(className)}"
        ><i class="fa-brands fa-whatsapp text-green-600 mr-1"></i>${escapeHTML(className)}</span>`;
    }

    return `<span class="bg-white border border-orange-200 text-orange-800 px-2.5 py-1 rounded-lg text-xs font-bold shadow-sm">${escapeHTML(className)}</span>`;
}

/**
 * Kirim pengingat presensi ke wali kelas & admin kelas melalui Cloudflare Worker.
 * Worker memvalidasi peminta, mencari kontak wali kelas, dan mengirim notifikasi
 * (Push Notifikasi, Telegram Bot, dan WhatsApp) dengan pencatatan di D1.
 */
window.sendAttendanceReminder = async (className, btnEl) => {
    const dateVal = document.getElementById('input-date').value;
    if (!dateVal || !className) return;

    // Disable button sementara
    if (btnEl) {
        btnEl.style.pointerEvents = 'none';
        btnEl.style.opacity = '0.5';
        btnEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i>${escapeHTML(className)}`;
    }

    try {
        await cfClient.sendAttendanceReminder({ className, date: dateVal });

        // Update UI — tandai sudah dikirim
        if (btnEl) {
            btnEl.innerHTML = `<i class="fa-solid fa-check text-green-600 mr-1"></i>${escapeHTML(className)}`;
            // Gaya "terkirim" menggantikan gaya dasar oranye (urutan CSS Tailwind build)
            btnEl.classList.remove('hover:bg-orange-100', 'hover:border-orange-400', 'border-orange-200', 'bg-white', 'text-orange-800');
            btnEl.classList.add('bg-green-50', 'border-green-300', 'text-green-700');
            btnEl.title = 'Pengingat presensi telah dikirim';
        }

        if (typeof window.showToast === 'function') {
            window.showToast('Pengingat Terkirim', `Pengingat presensi untuk kelas ${className} berhasil dikirim (Push Notifikasi & Telegram Bot).`, 'success');
        }
    } catch (e) {
        console.error('Error sending attendance reminder:', e);
        if (btnEl) {
            btnEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-red-500 mr-1"></i>${escapeHTML(className)}`;
            btnEl.style.pointerEvents = 'auto';
            btnEl.style.opacity = '1';
        }
        if (typeof window.showToast === 'function') {
            window.showToast('Gagal', `Gagal mengirim pengingat: ${e.message}`, 'error');
        }
    }
};



window.updateStatus = (sid, newStatus) => { const s = currentStudents.find(x => x.id === sid); if (s) { s.status = newStatus; if (newStatus === 'H') { s.note = ''; s.hasLetter = false; } renderNoteUI(sid, newStatus, s.note, s.hasLetter); } };
window.updateNote = (sid, val) => { const s = currentStudents.find(x => x.id === sid); if (s) s.note = val; };
window.updateLetter = (sid, val) => { const s = currentStudents.find(x => x.id === sid); if (s) s.hasLetter = val; };

function renderNoteUI(sid, status, savedNote, hasLetter) {
    const box = document.getElementById(`note-box-${sid}`);
    const mobileBox = document.getElementById(`note-box-mobile-${sid}`);
    const mobileRow = document.getElementById(`row-mobile-note-${sid}`);

    if (!box) return;

    if (['S', 'I', 'D'].includes(status)) {
        const conf = { S: ['SAKIT', 'yellow'], I: ['IZIN', 'blue'], D: ['DISPEN', 'purple'] };
        const confShort = { S: ['S', 'yellow'], I: ['I', 'blue'], D: ['D', 'purple'] };
        const [txt, col] = conf[status];
        const [txtShort, _] = confShort[status];

        // Desktop: Checkbox surat tampil
        const letterHtmlDesktop = status !== 'D' ? `
            <label class="flex items-center gap-1 cursor-pointer select-none bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 px-1.5 py-0.5 rounded shadow-sm hover:bg-slate-50 dark:hover:bg-slate-600 h-[28px]" title="Ada Bukti Surat?">
                <input type="checkbox" onchange="updateLetter('${sid}', this.checked)" ${hasLetter ? 'checked' : ''} class="w-3 h-3 accent-blue-600 cursor-pointer">
                <span class="text-[9px] font-bold text-slate-500 dark:text-slate-300">Surat</span>
            </label>` : '';

        // Desktop form (di kolom terakhir)
        box.innerHTML = `
            <div class="flex items-center gap-1 animate-fade-in h-[28px]">
                <div class="flex-1 flex items-center gap-1 bg-${col}-50 dark:bg-${col}-900/20 pl-1 pr-2 py-0.5 rounded border border-${col}-200 dark:border-${col}-800 h-full transition-colors focus-within:border-${col}-400 focus-within:bg-white dark:focus-within:bg-slate-800">
                    <span class="text-[9px] font-bold text-${col}-700 dark:text-${col}-400 bg-${col}-200 dark:bg-${col}-800 px-1.5 py-0.5 rounded min-w-[50px] text-center shadow-sm">${txt}</span>
                    <input type="text" id="note-input-${sid}" oninput="updateNote('${sid}', this.value)" value="${escapeHTML(savedNote)}" class="w-full text-xs bg-transparent border-none outline-none text-slate-700 dark:text-slate-200 placeholder-${col}-300/70 h-full" placeholder="Isi keterangan...">
                </div>
                ${letterHtmlDesktop}
            </div>`;

        // Mobile: Checkbox surat di samping input (1 baris)
        const letterHtmlMobile = status !== 'D' ? `
            <label class="shrink-0 flex items-center gap-1 cursor-pointer select-none bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 px-1 py-0.5 rounded shadow-sm" title="Ada Surat?">
                <input type="checkbox" onchange="updateLetter('${sid}', this.checked)" ${hasLetter ? 'checked' : ''} class="w-3 h-3 accent-blue-600 cursor-pointer">
                <span class="text-[8px] font-bold text-slate-500 dark:text-slate-300">Surat</span>
            </label>` : '';

        // Mobile form (di row bawah, 1 baris: badge + input + checkbox)
        if (mobileBox) {
            mobileBox.innerHTML = `
                <div class="flex items-center gap-1 animate-fade-in">
                    <span class="shrink-0 text-[8px] font-bold text-${col}-700 dark:text-${col}-400 bg-${col}-200 dark:bg-${col}-800 px-1 py-0.5 rounded">${txtShort}</span>
                    <input type="text" oninput="updateNote('${sid}', this.value)" value="${escapeHTML(savedNote)}" class="flex-1 min-w-0 text-[10px] bg-white dark:bg-slate-800 border border-${col}-200 dark:border-${col}-800 rounded px-1.5 py-0.5 outline-none focus:border-${col}-400 text-slate-700 dark:text-slate-200" placeholder="Ket...">
                    ${letterHtmlMobile}
                </div>`;
        }

        // Show mobile row
        if (mobileRow) mobileRow.classList.remove('hidden');

    } else if (status === 'A') {
        box.innerHTML = `<div class="animate-fade-in h-[28px] flex items-center"><div class="text-red-600 text-[10px] font-bold flex items-center gap-1.5 bg-red-50 px-3 py-0.5 rounded border border-red-100 h-full w-full"><i class="fa-solid fa-circle-exclamation"></i> Tanpa Keterangan</div></div>`;

        // Hide mobile row for Alpha
        if (mobileRow) mobileRow.classList.add('hidden');
        if (mobileBox) mobileBox.innerHTML = '';
    } else {
        box.innerHTML = '';
        // Hide mobile row for Hadir
        if (mobileRow) mobileRow.classList.add('hidden');
        if (mobileBox) mobileBox.innerHTML = '';
    }
}

window.saveAttendance = () => {
    if (!navigator.onLine) {
        window.showToast('Peringatan', 'Perangkat Anda sedang offline. Koneksi internet wajib aktif untuk menyimpan presensi.', 'warning', 8000);
        return;
    }

    const targetClass = document.getElementById('input-class').value;
    const dateVal = document.getElementById('input-date').value;

    if (!checkPresensiAccess(targetClass, dateVal)) {
        const hasAdminKelas = window.hasRole ? window.hasRole('admin_kelas') : localStorage.getItem('user_role') === 'admin_kelas';
        const myClass = (localStorage.getItem('user_assigned_class') || '').trim();
        if (hasAdminKelas && myClass === (targetClass || '').trim()) {
            window.showAppAlert("Batas waktu edit presensi untuk Admin Kelas sudah lewat (> 1 hari). Silakan hubungi Wali Kelas jika ingin mengubah data presensi tanggal ini.");
        } else {
            window.showAppAlert("AKSES DITOLAK: Anda tidak berhak menyimpan data kelas ini atau tanggal sudah melewati batas waktu edit.");
        }
        return;
    }

    for (const s of currentStudents) {
        if (['S', 'I', 'D'].includes(s.status)) {
            if (!s.note || s.note.trim() === '') {
                // Cek apakah mobile row visible (untuk responsive)
                const mobileRow = document.getElementById(`row-mobile-note-${s.id}`);
                const mobileInput = mobileRow ? mobileRow.querySelector('input[type="text"]') : null;
                const desktopInput = document.getElementById(`note-input-${s.id}`);

                // Pilih input yang visible
                let targetInput = null;
                let targetWrapper = null;

                if (mobileRow && !mobileRow.classList.contains('hidden') && window.innerWidth < 768) {
                    // Mobile mode
                    targetInput = mobileInput;
                    targetWrapper = mobileInput ? mobileInput.parentElement : null;
                } else {
                    // Desktop mode
                    targetInput = desktopInput;
                    targetWrapper = desktopInput ? desktopInput.parentElement : null;
                }

                if (targetInput) {
                    targetInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetInput.focus();
                    if (targetWrapper) {
                        targetWrapper.classList.add('ring-2', 'ring-red-500', 'bg-red-50');
                        setTimeout(() => { targetWrapper.classList.remove('ring-2', 'ring-red-500', 'bg-red-50'); }, 2000);
                    }
                }
                return;
            }
        }
    }
    document.getElementById('modal-confirm-save').classList.remove('hidden');
};

// --- SSOT SAVE LOGIC ---
window.processSave = async () => {
    document.getElementById('modal-confirm-save').classList.add('hidden');
    const mainBtn = document.querySelector("button[onclick='window.saveAttendance()']");
    mainBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    mainBtn.disabled = true;

    try {
        const cls = document.getElementById('input-class').value;
        const date = document.getElementById('input-date').value;
        const records = {};
        const sum = { H: 0, S: 0, I: 0, D: 0, A: 0 };
        const absentDetails = [];

        // 1. AMBIL DATA LAMA (Untuk hitung selisih/delta)
        const oldAttendance = await window.fetchClassAttendance(cls, date);
        const oldRecords = oldAttendance.records || {};

        // 2. LOOP SISWA & SIAPKAN PAYLOAD
        currentStudents.forEach(s => {
            records[s.id] = {
                id: s.id,
                nis: s.nis,
                name: s.name,
                status: s.status,
                note: (s.note || '').trim(),
                hasLetter: !!s.hasLetter
            };
            if (sum[s.status] !== undefined) sum[s.status]++;
            if (s.status !== 'H') {
                absentDetails.push({ name: s.name, status: s.status, note: s.note });
            }
        });

        // 3. EKSEKUSI DUAL-WRITE KE SUPABASE + FIRESTORE
        await window.saveAttendanceDual({
            className: cls,
            dateStr: date,
            records,
            summary: sum,
            recordedBy: currentUserName,
            absentDetails,
            oldRecords
        });

        if (typeof window.logAudit === 'function') {
            const isNew = !oldAttendance.exists;
            window.logAudit(isNew ? 'CREATE_ATTENDANCE' : 'UPDATE_ATTENDANCE', `${cls}_${date}`, isNew ? null : oldRecords, sum, `${isNew ? 'Input' : 'Update'} presensi ${cls} tanggal ${date} (H:${sum.H} S:${sum.S} I:${sum.I} A:${sum.A} D:${sum.D})`);
        }

        // 4. TRIGGER ALERT OTOMATIS JIKA ADA SISWA ALPHA (Verifikasi 2 Hari Beruntun di Edge Worker)
        try {
            const recordList = Array.isArray(records) ? records : Object.values(records || {});
            const alphaStudents = recordList.filter(r => r && r.status === 'A').map(r => ({ nis: r.nis, name: r.name }));
            if (alphaStudents.length > 0 && window.cfClient && typeof window.cfClient.notifyConsecutiveAlpha === 'function') {
                window.cfClient.notifyConsecutiveAlpha({
                    className: cls,
                    dateStr: date,
                    alphaStudents
                }).catch(eAlpha => console.warn('[Presensi] Alert Alpha beruntun gagal dikirim:', eAlpha.message));
            }
        } catch (eAlphaCheck) {
            console.warn('[Presensi] Pengecekan alpha beruntun dilewati:', eAlphaCheck.message);
        }

        await window.openWaModal(cls, date, sum, absentDetails);
        window.closeInputMode();

    } catch (e) {
        console.error('[Presensi] Error menyimpan data:', e);
        if (typeof window.showAppAlert === 'function') {
            window.showAppAlert("Gagal menyimpan data: " + e.message);
        } else if (typeof window.showToast === 'function') {
            window.showToast('Gagal Menyimpan', e.message, 'error');
        }
    } finally {
        mainBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Data Presensi';
        mainBtn.disabled = false;
    }
};

window.loadHistoryData = () => {
    const type = document.getElementById('history-type').value;
    if (type === 'monthly') loadRecapMonthly();
    else if (type === 'semester') loadRecapSemester();
    else loadDailyDetail();
};

// Populate Tahun Ajaran untuk Semester
function populateSemesterYears() {
    const select = document.getElementById('history-semester-year');
    const selectType = document.getElementById('history-semester-type');
    if (!select) return;

    const currentAyText = window.getCurrentAcademicYearString();
    const ayStartYear = parseInt(currentAyText.split('/')[0]);

    // Generate opsi: TA saat ini + 5 tahun sebelumnya
    let html = '';
    for (let y = ayStartYear; y >= ayStartYear - 5; y--) {
        html += `<option value="${y}/${y + 1}">${y}/${y + 1}</option>`;
    }
    select.innerHTML = html;

    // Auto-select TA saat ini
    select.value = currentAyText;

    // Auto-select semester saat ini
    if (selectType) {
        selectType.value = window.getCurrentSemester();
    }
}

// Auto-populate saat halaman dimuat
setTimeout(populateSemesterYears, 100);

// Helper: Deteksi URL params/hash untuk navigasi otomatis ke rekap semester per kelas (Poin 7)
async function checkUrlParamsForPresensi() {
    try {
        const hashStr = window.location.hash ? window.location.hash.substring(1) : '';
        const searchStr = window.location.search ? window.location.search.substring(1) : '';
        const rawParams = hashStr || searchStr;
        if (!rawParams) return;

        const params = new URLSearchParams(rawParams);
        const type = params.get('type');
        const targetClass = params.get('class');

        if (type === 'semester') {
            if (typeof window.switchMode === 'function') {
                window.switchMode('history');
            }
            const typeSelect = document.getElementById('history-type');
            if (typeSelect) {
                typeSelect.value = 'semester';
                if (typeof window.toggleHistoryInputs === 'function') {
                    window.toggleHistoryInputs();
                }
                updateHistoryScope();
            }

            populateSemesterYears();

            if (targetClass) {
                const cleanClass = decodeURIComponent(targetClass).trim();
                const scopeSelect = document.getElementById('history-scope');
                if (scopeSelect) {
                    let attempts = 0;
                    const selectAndLoad = () => {
                        const hasOption = Array.from(scopeSelect.options).some(opt => opt.value === cleanClass);
                        if (hasOption) {
                            scopeSelect.value = cleanClass;
                            if (typeof window.loadHistoryData === 'function') {
                                window.loadHistoryData();
                            }
                        } else if (attempts < 8) {
                            attempts++;
                            setTimeout(selectAndLoad, 150);
                        }
                    };
                    selectAndLoad();
                }
            }
        }
    } catch (e) {
        console.warn('[Presensi] Error parsing URL parameters:', e);
    }
}
window.checkUrlParamsForPresensi = checkUrlParamsForPresensi;

// Fungsi Rekap Semester
async function loadRecapSemester() {
    const semesterType = document.getElementById('history-semester-type').value; // 1 = Ganjil, 2 = Genap
    const semesterYear = document.getElementById('history-semester-year').value; // Format: "2025/2026"
    const classVal = document.getElementById('history-scope').value;

    if (classVal.startsWith('ALL-')) {
        window.showAppAlert("Mohon maaf, Rekap Semester hanya tersedia untuk per Kelas (bukan Angkatan).");
        return;
    }

    const tbody = document.getElementById('history-tbody');
    const container = document.getElementById('history-result-container');
    const emptyState = document.getElementById('history-empty');

    if (!semesterYear || !classVal) { window.showAppAlert("Pilih Kelas dan Semester!"); return; }

    // Parse tahun ajaran
    const [yearStart, yearEnd] = semesterYear.split('/').map(Number);

    // Tentukan rentang tanggal berdasarkan semester
    let startDate, endDate;
    if (semesterType === '1') {
        // Semester Ganjil: Juli - Desember tahun pertama
        startDate = `${yearStart}-07-01`;
        endDate = `${yearStart}-12-31`;
    } else {
        // Semester Genap: Januari - Juni tahun kedua
        startDate = `${yearEnd}-01-01`;
        endDate = `${yearEnd}-06-30`;
    }

    const semesterLabel = semesterType === '1' ? 'Ganjil' : 'Genap';
    const includeSakit = getPresensiIncludeSakitPref();
    const toggleSemEl = document.getElementById('toggle-include-sakit-history');
    if (toggleSemEl) toggleSemEl.checked = includeSakit;
    const badgeSemEl = document.getElementById('badge-mode-akademik-history');
    if (badgeSemEl) {
        if (includeSakit) badgeSemEl.classList.remove('hidden');
        else badgeSemEl.classList.add('hidden');
    }

    emptyState.classList.add('hidden'); container.classList.remove('hidden');
    document.getElementById('history-title').innerText = "Rekap Semester";
    document.getElementById('history-subtitle').innerText = `Semester ${semesterLabel} ${semesterYear} • Kelas: ${classVal}`;
    tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-blue-500"><i class="fa-solid fa-spinner fa-spin"></i> Menghitung data semester...</td></tr>';

    document.getElementById('history-thead').innerHTML = `<tr><th class="px-4 py-3 w-24">NIS</th><th class="px-4 py-3">Nama Siswa</th><th class="px-2 py-3 text-center w-12 bg-green-50">H</th><th class="px-2 py-3 text-center w-12 bg-yellow-50">S</th><th class="px-2 py-3 text-center w-12 bg-blue-50">I</th><th class="px-2 py-3 text-center w-12 bg-purple-50">D</th><th class="px-2 py-3 text-center w-12 bg-red-50">A</th><th class="px-4 py-3 text-center border-l w-24">%</th></tr>`;

    try {
        // GUNAKAN GLOBAL CACHE (Hemat Kuota Read) - Filter by class di client-side
        const allStudents = await window.getStudentsCache();
        const classStudents = allStudents
            .filter(s => s.class === classVal)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        if (classStudents.length === 0) { tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-red-500">Tidak ada siswa.</td></tr>`; return; }

        const stats = {};
        // REVISI: Map By NIS (SSOT)
        classStudents.forEach(s => {
            if (s.nis) {
                stats[String(s.nis)] = { name: s.name, nis: s.nis, H: 0, S: 0, I: 0, D: 0, A: 0 };
            }
        });

        // Query dengan rentang semester (Dual-read: Supabase -> Firestore)
        const resAbsen = await window.fetchClassAttendanceRange(classVal, startDate, endDate);
        const rowsAbsen = resAbsen.rows || [];

        const uniqueDates = new Set();
        rowsAbsen.forEach(recData => {
            if (recData.tanggal) uniqueDates.add(recData.tanggal);
            const targetNis = recData.student_nis ? String(recData.student_nis) : (recData.nis ? String(recData.nis) : null);

            if (targetNis && stats[targetNis]) {
                const st = recData.status || 'H';
                if (stats[targetNis][st] !== undefined) stats[targetNis][st]++;
            }
        });
        const totalDays = uniqueDates.size;

        let html = '';
        let totalH = 0, totalS = 0, totalI = 0, totalD = 0, totalA = 0;
        for (const [sid, s] of Object.entries(stats)) {
            totalH += s.H;
            totalS += s.S;
            totalI += s.I;
            totalD += s.D;
            totalA += s.A;

            const sStats = getAttendanceSummaryStats(s, { includeSakit });
            let percent = sStats ? (sStats.attPctRounded !== undefined ? sStats.attPctRounded : Math.round(sStats.attPct || 0)) : (totalDays > 0 ? Math.round(((s.H + s.D) / totalDays) * 100) : 0);
            const rowClass = s.A > 5 ? 'bg-red-50 dark:bg-red-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30';
            html += `<tr class="${rowClass} border-b border-slate-50 dark:border-slate-700/50"><td class="px-4 py-3 font-mono text-slate-500 dark:text-slate-400 text-xs">${escapeHTML(s.nis)}</td><td class="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">${escapeHTML(s.name)}</td><td class="px-2 py-3 text-center bg-green-50/30 dark:bg-green-900/10 text-green-700 dark:text-green-400">${s.H}</td><td class="px-2 py-3 text-center bg-yellow-50/30 dark:bg-yellow-900/10 text-yellow-700 dark:text-yellow-400">${s.S}</td><td class="px-2 py-3 text-center bg-blue-50/30 dark:bg-blue-900/10 text-blue-700 dark:text-blue-400">${s.I}</td><td class="px-2 py-3 text-center bg-purple-50/30 dark:bg-purple-900/10 text-purple-700 dark:text-purple-400">${s.D}</td><td class="px-2 py-3 text-center bg-red-50/30 dark:bg-red-900/10 text-red-700 dark:text-red-400 font-bold">${s.A}</td><td class="px-4 py-3 text-center font-bold dark:text-slate-200">${percent}%</td></tr>`;
        }

        const classStats = getAttendanceSummaryStats({ H: totalH, S: totalS, I: totalI, D: totalD, A: totalA }, { includeSakit });
        const classBadge = getAttendanceBadgeClass(classStats.tier);

        // Baris 1: Total Per Kolom (8 Kolom, Simetris dengan Header dan Support Export Excel)
        html += `
        <tr class="bg-slate-100/90 dark:bg-slate-900/70 font-bold border-t-2 border-slate-300 dark:border-slate-700">
            <td class="px-4 py-3 font-mono text-slate-700 dark:text-slate-300 text-xs">TOTAL</td>
            <td class="px-4 py-3 text-slate-800 dark:text-slate-100">Rekapitulasi Kelas (${classStudents.length} Siswa)</td>
            <td class="px-2 py-3 text-center text-green-700 dark:text-green-400 bg-green-100/50 dark:bg-green-900/20 border-l dark:border-slate-700/50">${totalH}</td>
            <td class="px-2 py-3 text-center text-yellow-700 dark:text-yellow-400 bg-yellow-100/50 dark:bg-yellow-900/20">${totalS}</td>
            <td class="px-2 py-3 text-center text-blue-700 dark:text-blue-400 bg-blue-100/50 dark:bg-blue-900/20">${totalI}</td>
            <td class="px-2 py-3 text-center text-purple-700 dark:text-purple-400 bg-purple-100/50 dark:bg-purple-900/20">${totalD}</td>
            <td class="px-2 py-3 text-center text-red-700 dark:text-red-400 bg-red-100/50 dark:bg-red-900/20 font-bold">${totalA}</td>
            <td class="px-4 py-3 text-center border-l dark:border-slate-700/50">
                <span class="inline-flex items-center justify-center font-bold text-xs px-2.5 py-0.5 rounded-full ${classBadge}" title="Persentase Kehadiran Klasikal">
                    ${classStats.attPctFormatted}
                </span>
            </td>
        </tr>`;

        // Baris 2: Footer Ringkasan Kehadiran Klasikal & Hari Efektif
        html += `
        <tr class="bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700">
            <td colspan="8" class="px-4 py-3 text-center text-xs text-slate-600 dark:text-slate-300">
                <div class="flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5 font-medium">
                    <span><i class="fa-solid fa-calendar-day text-blue-500 mr-1.5"></i>Hari Efektif: <strong class="text-slate-800 dark:text-slate-100">${totalDays} hari</strong> <span class="text-slate-400 text-[11px]">(${startDate} s/d ${endDate})</span></span>
                    <span><i class="fa-solid fa-users text-indigo-500 mr-1.5"></i>Jumlah Siswa: <strong class="text-slate-800 dark:text-slate-100">${classStudents.length} siswa</strong></span>
                    <span><i class="fa-solid fa-chart-pie text-emerald-500 mr-1.5"></i>Kehadiran Klasikal: <strong class="text-slate-900 dark:text-white font-bold text-sm">${classStats.attPctFormatted}</strong></span>
                </div>
            </td>
        </tr>`;

        tbody.innerHTML = html;
        window.toggleExportButton(true); // Tampilkan tombol export
    } catch (e) { console.error(e); tbody.innerHTML = `<tr><td colspan="8" class="text-center p-4 text-red-500">Error: ${window.escapeHTML(e.message)}</td></tr>`; }
}

async function loadRecapMonthly() {
    const monthVal = document.getElementById('history-month').value;
    const classVal = document.getElementById('history-scope').value;

    if (classVal.startsWith('ALL-')) {
        window.showAppAlert("Mohon maaf, Rekap Bulanan hanya tersedia untuk per Kelas (bukan Angkatan).");
        return;
    }

    const tbody = document.getElementById('history-tbody');
    const container = document.getElementById('history-result-container');
    const emptyState = document.getElementById('history-empty');

    if (!monthVal || !classVal) { window.showAppAlert("Pilih Kelas dan Bulan!"); return; }

    emptyState.classList.add('hidden'); container.classList.remove('hidden');
    document.getElementById('history-title').innerText = "Rekap Bulanan";
    document.getElementById('history-subtitle').innerText = `Periode: ${monthVal} • Kelas: ${classVal}`;
    const includeSakit = getPresensiIncludeSakitPref();
    const toggleMonthEl = document.getElementById('toggle-include-sakit-history');
    if (toggleMonthEl) toggleMonthEl.checked = includeSakit;
    const badgeMonthEl = document.getElementById('badge-mode-akademik-history');
    if (badgeMonthEl) {
        if (includeSakit) badgeMonthEl.classList.remove('hidden');
        else badgeMonthEl.classList.add('hidden');
    }
    tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-blue-500"><i class="fa-solid fa-spinner fa-spin"></i> Menghitung...</td></tr>';

    document.getElementById('history-thead').innerHTML = `<tr><th class="px-4 py-3 w-24">NIS</th><th class="px-4 py-3">Nama Siswa</th><th class="px-2 py-3 text-center w-12 bg-green-50">H</th><th class="px-2 py-3 text-center w-12 bg-yellow-50">S</th><th class="px-2 py-3 text-center w-12 bg-blue-50">I</th><th class="px-2 py-3 text-center w-12 bg-purple-50">D</th><th class="px-2 py-3 text-center w-12 bg-red-50">A</th><th class="px-4 py-3 text-center border-l w-24">%</th></tr>`;

    try {
        // GUNAKAN GLOBAL CACHE (Hemat Kuota Read) - Filter by class di client-side
        const allStudents = await window.getStudentsCache();
        const classStudents = allStudents
            .filter(s => s.class === classVal)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        if (classStudents.length === 0) { tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-red-500">Tidak ada siswa.</td></tr>`; return; }

        const stats = {};
        // REVISI: Map By NIS (SSOT)
        classStudents.forEach(s => {
            if (s.nis) {
                stats[String(s.nis)] = { name: s.name, nis: s.nis, H: 0, S: 0, I: 0, D: 0, A: 0 };
            }
        });

        const [yNum, mNum] = monthVal.split('-').map(Number);
        const lastDay = new Date(yNum, mNum, 0).getDate();
        const startDate = `${monthVal}-01`;
        const endDate = `${monthVal}-${String(lastDay).padStart(2, '0')}`;
        const resAbsen = await window.fetchClassAttendanceRange(classVal, startDate, endDate);
        const rowsAbsen = resAbsen.rows || [];

        const uniqueDates = new Set();
        rowsAbsen.forEach(recData => {
            if (recData.tanggal) uniqueDates.add(recData.tanggal);
            const targetNis = recData.student_nis ? String(recData.student_nis) : (recData.nis ? String(recData.nis) : null);

            if (targetNis && stats[targetNis]) {
                const st = recData.status || 'H';
                if (stats[targetNis][st] !== undefined) stats[targetNis][st]++;
            }
        });
        const totalDays = uniqueDates.size;

        let html = '';
        let totalH = 0, totalS = 0, totalI = 0, totalD = 0, totalA = 0;
        for (const [sid, s] of Object.entries(stats)) {
            totalH += s.H;
            totalS += s.S;
            totalI += s.I;
            totalD += s.D;
            totalA += s.A;

            const sStats = getAttendanceSummaryStats(s, { includeSakit });
            let percent = sStats ? (sStats.attPctRounded !== undefined ? sStats.attPctRounded : Math.round(sStats.attPct || 0)) : (totalDays > 0 ? Math.round(((s.H + s.D) / totalDays) * 100) : 0);
            const rowClass = s.A > 2 ? 'bg-red-50 dark:bg-red-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30';
            html += `<tr class="${rowClass} border-b border-slate-50 dark:border-slate-700/50"><td class="px-4 py-3 font-mono text-slate-500 dark:text-slate-400 text-xs">${escapeHTML(s.nis)}</td><td class="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">${escapeHTML(s.name)}</td><td class="px-2 py-3 text-center bg-green-50/30 dark:bg-green-900/10 text-green-700 dark:text-green-400">${s.H}</td><td class="px-2 py-3 text-center bg-yellow-50/30 dark:bg-yellow-900/10 text-yellow-700 dark:text-yellow-400">${s.S}</td><td class="px-2 py-3 text-center bg-blue-50/30 dark:bg-blue-900/10 text-blue-700 dark:text-blue-400">${s.I}</td><td class="px-2 py-3 text-center bg-purple-50/30 dark:bg-purple-900/10 text-purple-700 dark:text-purple-400">${s.D}</td><td class="px-2 py-3 text-center bg-red-50/30 dark:bg-red-900/10 text-red-700 dark:text-red-400 font-bold">${s.A}</td><td class="px-4 py-3 text-center font-bold dark:text-slate-200">${percent}%</td></tr>`;
        }

        const classStats = getAttendanceSummaryStats({ H: totalH, S: totalS, I: totalI, D: totalD, A: totalA }, { includeSakit });
        const classBadge = getAttendanceBadgeClass(classStats.tier);

        // Baris 1: Total Per Kolom (8 Kolom, Simetris dengan Header dan Support Export Excel)
        html += `
        <tr class="bg-slate-100/90 dark:bg-slate-900/70 font-bold border-t-2 border-slate-300 dark:border-slate-700">
            <td class="px-4 py-3 font-mono text-slate-700 dark:text-slate-300 text-xs">TOTAL</td>
            <td class="px-4 py-3 text-slate-800 dark:text-slate-100">Rekapitulasi Kelas (${classStudents.length} Siswa)</td>
            <td class="px-2 py-3 text-center text-green-700 dark:text-green-400 bg-green-100/50 dark:bg-green-900/20 border-l dark:border-slate-700/50">${totalH}</td>
            <td class="px-2 py-3 text-center text-yellow-700 dark:text-yellow-400 bg-yellow-100/50 dark:bg-yellow-900/20">${totalS}</td>
            <td class="px-2 py-3 text-center text-blue-700 dark:text-blue-400 bg-blue-100/50 dark:bg-blue-900/20">${totalI}</td>
            <td class="px-2 py-3 text-center text-purple-700 dark:text-purple-400 bg-purple-100/50 dark:bg-purple-900/20">${totalD}</td>
            <td class="px-2 py-3 text-center text-red-700 dark:text-red-400 bg-red-100/50 dark:bg-red-900/20 font-bold">${totalA}</td>
            <td class="px-4 py-3 text-center border-l dark:border-slate-700/50">
                <span class="inline-flex items-center justify-center font-bold text-xs px-2.5 py-0.5 rounded-full ${classBadge}" title="Persentase Kehadiran Klasikal">
                    ${classStats.attPctFormatted}
                </span>
            </td>
        </tr>`;

        // Baris 2: Footer Ringkasan Kehadiran Klasikal & Hari Efektif
        html += `
        <tr class="bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700">
            <td colspan="8" class="px-4 py-3 text-center text-xs text-slate-600 dark:text-slate-300">
                <div class="flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5 font-medium">
                    <span><i class="fa-solid fa-calendar-day text-blue-500 mr-1.5"></i>Hari Efektif: <strong class="text-slate-800 dark:text-slate-100">${totalDays} hari</strong> <span class="text-slate-400 text-[11px]">(${startDate} s/d ${endDate})</span></span>
                    <span><i class="fa-solid fa-users text-indigo-500 mr-1.5"></i>Jumlah Siswa: <strong class="text-slate-800 dark:text-slate-100">${classStudents.length} siswa</strong></span>
                    <span><i class="fa-solid fa-chart-pie text-emerald-500 mr-1.5"></i>Kehadiran Klasikal: <strong class="text-slate-900 dark:text-white font-bold text-sm">${classStats.attPctFormatted}</strong></span>
                </div>
            </td>
        </tr>`;

        tbody.innerHTML = html;
        window.toggleExportButton(true); // Tampilkan tombol export
    } catch (e) { console.error(e); tbody.innerHTML = `<tr><td colspan="8" class="text-center p-4 text-red-500">Error: ${window.escapeHTML(e.message)}</td></tr>`; }
}

async function loadDailyDetail() {
    const dateVal = document.getElementById('history-date').value;
    const scopeVal = document.getElementById('history-scope').value;
    const statusVal = document.getElementById('history-filter-status').value;
    const tbody = document.getElementById('history-tbody');
    const container = document.getElementById('history-result-container');
    const emptyState = document.getElementById('history-empty');

    if (!dateVal || !scopeVal) { window.showAppAlert("Pilih Tanggal dan Kelas/Angkatan!"); return; }

    emptyState.classList.add('hidden'); container.classList.remove('hidden');
    document.getElementById('history-title').innerText = "Monitoring Harian";

    let classPrefix = null;
    let isAllScope = false;
    let subtitlePrefix = scopeVal;

    if (scopeVal.startsWith('ALL-')) {
        isAllScope = true;
        classPrefix = scopeVal.split('-')[1];
        subtitlePrefix = `Seluruh Angkatan ${classPrefix}`;
    }

    document.getElementById('history-subtitle').innerText = `${dateVal} • ${subtitlePrefix} • Filter: ${statusVal}`;
    tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-blue-500"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>';
    document.getElementById('history-thead').innerHTML = `<tr><th class="px-4 py-3">Kelas</th><th class="px-4 py-3 w-24">NIS</th><th class="px-4 py-3">Nama Siswa</th><th class="px-4 py-3 text-center w-24">Status</th><th class="px-4 py-3">Keterangan</th><th class="px-4 py-3 text-center w-24">Surat</th></tr>`;

    try {
        // GUNAKAN GLOBAL CACHE (Hemat Kuota Read) - Filter di client-side
        const allStudents = await window.getStudentsCache();

        // Filter berdasarkan scope (kelas tunggal atau angkatan)
        let filteredStudents;
        if (isAllScope) {
            // Filter dengan regex untuk match prefix kelas
            let regex;
            if (classPrefix === 'X') regex = /^X[^I]/;
            else if (classPrefix === 'XI') regex = /^XI[^I]/;
            else regex = /^XII/;

            filteredStudents = allStudents.filter(s => s.class && regex.test(s.class));
        } else {
            filteredStudents = allStudents.filter(s => s.class === scopeVal);
        }

        // Sort by class then name
        filteredStudents.sort((a, b) => {
            const classDiff = (a.class || '').localeCompare(b.class || '', undefined, { numeric: true });
            if (classDiff !== 0) return classDiff;
            return (a.name || '').localeCompare(b.name || '');
        });

        if (filteredStudents.length === 0) { tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-red-500">Data siswa tidak ditemukan.</td></tr>`; return; }

        const studentMap = {};
        filteredStudents.forEach(s => {
            if (s.nis) {
                studentMap[String(s.nis)] = { name: s.name, class: s.class, nis: s.nis };
            }
        });

        // 1. Ambil dari Supabase via fetchAllSupabaseRows (Murni Supabase SSOT)
        let attendanceRows = [];

        const sbClient = supabase || window.supabase;
        if (sbClient && typeof window.fetchAllSupabaseRows === 'function') {
            try {
                const { data, error } = await window.fetchAllSupabaseRows(
                    sbClient,
                    'siswa_presensi',
                    (qb) => qb.eq('tanggal', dateVal)
                );
                if (!error && Array.isArray(data) && data.length > 0) {
                    attendanceRows = data;
                }
            } catch (errSb) {
                console.warn('[PresensiDetail] Supabase fetch warning:', errSb);
            }
        }

        if (attendanceRows.length === 0) { 
            tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400 italic">Belum ada data presensi pada tanggal ini.</td></tr>`; 
            return; 
        }

        let html = '';
        let foundCount = 0;

        attendanceRows.forEach(data => {
            const targetNis = data.student_nis ? String(data.student_nis) : null;
            const targetInfo = targetNis ? studentMap[targetNis] : null;

            if (targetInfo) {
                const isStatusMatch = (statusVal === 'ALL' && data.status !== 'H') || (statusVal === data.status);

                if (isStatusMatch) {
                    foundCount++;
                    const statusLabels = { 
                        'S': ['SAKIT', 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700/50'], 
                        'I': ['IZIN', 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700/50'], 
                        'A': ['ALPHA', 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700/50'], 
                        'D': ['DISPEN', 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700/50'] 
                    };
                    const [label, css] = statusLabels[data.status] || [data.status, 'bg-gray-100 dark:bg-slate-700'];
                    const suratIcon = data.has_letter || data.hasLetter ? '<i class="fa-solid fa-file-lines text-blue-500" title="Ada Surat"></i>' : '-';

                    html += `<tr class="border-b border-slate-50 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30"><td class="px-4 py-3 font-bold text-slate-500 dark:text-slate-400 text-xs">${escapeHTML(targetInfo.class)}</td><td class="px-4 py-3 font-mono text-slate-500 dark:text-slate-400 text-xs">${escapeHTML(targetInfo.nis)}</td><td class="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">${escapeHTML(targetInfo.name)}</td><td class="px-4 py-3 text-center"><span class="text-[10px] font-bold px-2 py-1 rounded border ${css}">${label}</span></td><td class="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">${escapeHTML(data.note || '-')}</td><td class="px-4 py-3 text-center">${suratIcon}</td></tr>`;
                }
            }
        });

        if (foundCount === 0) { 
            html = `<tr><td colspan="6" class="p-8 text-center text-green-600 dark:text-green-400 font-bold bg-green-50 dark:bg-green-900/20 rounded-lg">NIHIL (Tidak ada data yang sesuai filter)</td></tr>`; 
        }

        // Hitung Kehadiran Klasikal untuk seluruh siswa dalam lingkup terpilih pada tanggal ini
        let dayH = 0, dayS = 0, dayI = 0, dayD = 0, dayA = 0;
        attendanceRows.forEach(data => {
            const targetNis = data.student_nis ? String(data.student_nis) : null;
            if (targetNis && studentMap[targetNis]) {
                const st = data.status || 'H';
                if (st === 'H') dayH++;
                else if (st === 'S') dayS++;
                else if (st === 'I') dayI++;
                else if (st === 'D') dayD++;
                else if (st === 'A') dayA++;
            }
        });

        const dayTotal = dayH + dayS + dayI + dayD + dayA;
        if (dayTotal > 0) {
            const dayStats = getAttendanceSummaryStats({ H: dayH, S: dayS, I: dayI, D: dayD, A: dayA });
            const dayBadge = getAttendanceBadgeClass(dayStats.tier);

            html += `
            <tr class="bg-slate-100/90 dark:bg-slate-900/70 border-t-2 border-slate-300 dark:border-slate-700 font-medium">
                <td colspan="6" class="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                        <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                            <span class="font-bold text-slate-700 dark:text-slate-200"><i class="fa-solid fa-clipboard-check text-blue-500 mr-1.5"></i>Rekap Harian:</span>
                            <span class="text-green-700 dark:text-green-400 font-semibold">H: ${dayH}</span>
                            <span class="text-yellow-700 dark:text-yellow-400 font-semibold">S: ${dayS}</span>
                            <span class="text-blue-700 dark:text-blue-400 font-semibold">I: ${dayI}</span>
                            <span class="text-purple-700 dark:text-purple-400 font-semibold">D: ${dayD}</span>
                            <span class="text-red-700 dark:text-red-400 font-bold">A: ${dayA}</span>
                            <span class="text-slate-500 dark:text-slate-400 font-medium">Total: ${dayTotal} Siswa</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="font-bold text-slate-700 dark:text-slate-200">Kehadiran Klasikal:</span>
                            <span class="inline-flex items-center justify-center font-bold text-xs px-2.5 py-0.5 rounded-full ${dayBadge}" title="Persentase Kehadiran Klasikal Harian">
                                ${dayStats.attPctFormatted}
                            </span>
                        </div>
                    </div>
                </td>
            </tr>`;
        }

        tbody.innerHTML = html;
        window.toggleExportButton(true); // Tampilkan tombol export

    } catch (e) { console.error(e); tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">Error: ${window.escapeHTML(e.message)}</td></tr>`; }
}

window.showAppAlert = (message) => { document.getElementById('alert-message').innerText = message; document.getElementById('modal-alert').classList.remove('hidden'); };

window.openWaModal = async (className, dateVal, summary, absentList) => {
    const modal = document.getElementById('modal-wa');
    const txtArea = document.getElementById('wa-msg-preview');
    const infoText = document.getElementById('wa-contact-info');
    const btnSend = document.getElementById('btn-send-wa');

    const eCal = "📅"; const eUser = "👤"; const eDot = "●";
    const eSick = "😷"; const eMail = "📩"; const eX = "❌"; const eScroll = "📜"; const eCheck = "✅";

    const dateObj = new Date(dateVal);
    const tglIndo = dateObj.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const pelapor = currentUserName || (auth.currentUser ? auth.currentUser.displayName : null) || "Admin";

    let msg = `*LAPORAN PRESENSI KELAS ${className}*\n`;
    msg += `${eCal} ${tglIndo}\n`;
    msg += `${eUser} Pelapor: ${pelapor}\n\n`;

    if (absentList.length > 0) {
        msg += `*SISWA TIDAK HADIR:*\n`;
        absentList.forEach((s) => {
            const reason = s.note ? s.note : '-';
            msg += `${eDot} *${s.name}* (${s.status}) - ${reason}\n`;
        });
        msg += `\n`;
    } else { msg += `*SISWA TIDAK HADIR:*\nNIHIL (Semua Hadir)\n\n`; }

    msg += `*REKAPITULASI:*\n`;
    msg += `${eSick} Sakit: ${summary.S}\n`;
    msg += `${eMail} Izin: ${summary.I}\n`;
    msg += `${eX} Alpha: ${summary.A}\n`;
    msg += `${eScroll} Dispen: ${summary.D}\n`;
    msg += `${eCheck} Hadir: ${summary.H}\n`;
    msg += `--------------------------\n`;
    msg += `> _${SCHOOL_CONFIG.appBrand}_`;

    txtArea.value = msg;
    infoText.innerText = "Mencari data Wali Kelas...";
    btnSend.classList.add('opacity-50', 'pointer-events-none');

    try {
        // PAKAI GLOBAL CACHE (Hemat Kuota)
        const waliData = await window.getWaliKelasByClass(className);
        let rawPhone = '';
        if (waliData && waliData.name) {
            if (waliData.phone) {
                rawPhone = waliData.phone;
            } else if (typeof window.getTeachersCache === 'function') {
                try {
                    const teachers = await window.getTeachersCache();
                    const found = teachers.find(t => t.name === waliData.name);
                    if (found && (found.phone || found.kontak || found.hp)) {
                        rawPhone = found.phone || found.kontak || found.hp;
                    }
                } catch (e) {}
            }
            if (!rawPhone && waliData?.name) {
                const tMap = await window.getTeachersMapCache();
                const tFound = tMap.get(waliData.name.toLowerCase().trim());
                if (tFound?.phone) { rawPhone = tFound.phone; }
            }
        }

        let targetUrl = new URL("https://api.whatsapp.com/send");
        if (rawPhone) {
            let phone = rawPhone.replace(/[^0-9]/g, '');
            if (phone.startsWith('0')) phone = '62' + phone.substring(1);
            targetUrl.searchParams.set("phone", phone);
            infoText.innerHTML = `<span class="text-green-600"><i class="fa-solid fa-check"></i> Mengirim ke Wali Kelas</span>`;
        } else {
            infoText.innerHTML = `<span class="text-orange-500"><i class="fa-solid fa-triangle-exclamation"></i> Nomor Wali Kelas tidak ditemukan.</span>`;
        }
        targetUrl.searchParams.set("text", msg);
        btnSend.href = targetUrl.toString();
        btnSend.classList.remove('opacity-50', 'pointer-events-none');

    } catch (e) {
        console.error("Error cari wali kelas:", e);
        let fallbackUrl = new URL("https://api.whatsapp.com/send");
        fallbackUrl.searchParams.set("text", msg);
        btnSend.href = fallbackUrl.toString();
        btnSend.classList.remove('opacity-50', 'pointer-events-none');
    }
    modal.classList.remove('hidden');
};

window.closeWaModal = () => { document.getElementById('modal-wa').classList.add('hidden'); };

// ==========================================
// EXPORT TO EXCEL FUNCTIONALITY
// ==========================================

// Role whitelist untuk akses export
const EXPORT_ALLOWED_ROLES = ['super_admin', 'kepala_sekolah', 'kesiswaan', 'staff', 'wali_kelas', 'guru_bk', 'admin_kelas'];

// Helper: Cek apakah user boleh export (multi-role support)
function canExportExcel() {
    return window.hasRole
        ? EXPORT_ALLOWED_ROLES.some(r => window.hasRole(r))
        : EXPORT_ALLOWED_ROLES.includes(userRole);
}

// Helper: Tampilkan/sembunyikan tombol export berdasarkan role
window.toggleExportButton = function (show = true) {
    const btn = document.getElementById('btn-export-excel');
    if (!btn) return;

    if (show && canExportExcel()) {
        btn.classList.remove('hidden');
    } else {
        btn.classList.add('hidden');
    }
};

// Fungsi utama export ke Excel
window.exportHistoryToExcel = async function () {
    if (!canExportExcel()) {
        window.showAppAlert("Anda tidak memiliki akses untuk mengexport data.");
        return;
    }

    // Cek apakah library XLSX tersedia
    if (typeof XLSX === 'undefined') {
        window.showAppAlert("Library Excel tidak tersedia. Silakan refresh halaman.");
        return;
    }

    const type = document.getElementById('history-type').value;
    const tbody = document.getElementById('history-tbody');
    const thead = document.getElementById('history-thead');

    if (!tbody || tbody.rows.length === 0) {
        window.showAppAlert("Tidak ada data untuk diexport. Silakan cari data terlebih dahulu.");
        return;
    }

    try {
        // Collect data from table
        const headers = [];
        const headerRow = thead.querySelector('tr');
        if (headerRow) {
            headerRow.querySelectorAll('th').forEach(th => {
                headers.push(th.innerText.trim());
            });
        }

        const rows = [];
        tbody.querySelectorAll('tr').forEach(tr => {
            // Skip empty/info rows
            if (tr.cells.length < 2) return;

            const row = [];
            tr.querySelectorAll('td').forEach(td => {
                // Clean text content
                let text = td.innerText.trim();
                // Handle checkbox icon (Surat column)
                if (td.querySelector('.fa-file-lines')) {
                    text = 'Ya';
                } else if (td.innerText === '-' && td.querySelector('i')) {
                    text = 'Tidak';
                }
                row.push(text);
            });
            rows.push(row);
        });

        if (rows.length === 0) {
            window.showAppAlert("Tidak ada data valid untuk diexport.");
            return;
        }

        // Generate filename & sheet title
        let filename = 'presensi_riwayat';
        let sheetTitle = 'Riwayat Presensi';
        let reportInfo = '';

        if (type === 'monthly') {
            const monthVal = document.getElementById('history-month').value;
            const classVal = document.getElementById('history-scope').value;
            filename = `rekap_bulanan_${classVal}_${monthVal}`;
            sheetTitle = 'Rekap Bulanan';
            reportInfo = `Rekap Presensi Kelas ${classVal} - Periode ${monthVal}`;
        } else if (type === 'semester') {
            const semesterType = document.getElementById('history-semester-type').value;
            const semesterYear = document.getElementById('history-semester-year').value;
            const classVal = document.getElementById('history-scope').value;
            const semesterLabel = semesterType === '1' ? 'Ganjil' : 'Genap';
            filename = `rekap_semester_${semesterLabel}_${classVal}_${semesterYear.replace('/', '-')}`;
            sheetTitle = 'Rekap Semester';
            reportInfo = `Rekap Presensi Semester ${semesterLabel} ${semesterYear} - Kelas ${classVal}`;
        } else {
            const dateVal = document.getElementById('history-date').value;
            const scopeVal = document.getElementById('history-scope').value;
            filename = `monitoring_${scopeVal}_${dateVal}`;
            sheetTitle = 'Monitoring Harian';
            reportInfo = `Monitoring Presensi ${scopeVal} - Tanggal ${dateVal}`;
        }

        // Build worksheet data with header info
        const includeSakitExport = getPresensiIncludeSakitPref();
        if (includeSakitExport) {
            reportInfo += ' (Mode Peraturan Akademik: Sakit Dihitung Hadir)';
            if (Array.isArray(headers)) {
                headers = headers.map(h => (h === '%' ? '% (Akademik: H+D+S)' : h));
            }
        }
        const wsData = [];

        // Title row
        wsData.push([reportInfo]);
        wsData.push([]); // Empty row
        wsData.push(headers); // Header row

        // Data rows
        rows.forEach(row => {
            wsData.push(row);
        });

        // Create worksheet
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // Set column widths
        const colWidths = headers.map((h, i) => {
            // Calculate max width based on header and data
            let maxLen = h.length;
            rows.forEach(row => {
                if (row[i] && row[i].length > maxLen) {
                    maxLen = row[i].length;
                }
            });
            return { wch: Math.min(Math.max(maxLen + 2, 8), 40) }; // Min 8, Max 40
        });
        ws['!cols'] = colWidths;

        // Merge title row across all columns
        ws['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }
        ];

        // Create workbook
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetTitle);

        // Export to file
        XLSX.writeFile(wb, `${filename}.xlsx`);

        if (typeof window.showToast === 'function') {
            window.showToast("Berhasil", `File ${filename}.xlsx berhasil didownload.`, "success");
        }

    } catch (e) {
        console.error("Export Error:", e);
        window.showAppAlert("Gagal export data: " + e.message);
    }
};

if (typeof window !== 'undefined') {
    window.checkAndRenderHolidayBanner = checkAndRenderHolidayBanner;
    window.loadClassOptions = loadClassOptions;
    window.loadUserData = loadUserData;
    window.checkPresensiAccess = checkPresensiAccess;
    window.updateHistoryScope = updateHistoryScope;
}
