/* js/page-jurnal-admin.js - Portal Admin Jurnal Mengajar Terpadu (100% Pure Cloudflare D1 SSOT) */

import { auth, db, PATHS, supabase, SCHOOL_CONFIG, schoolAssetUrl, resolvePhotoUrl } from './config.js';
import { cfClient } from './cloudflare-client.js';
import { initLayout, showToast, escapeHTML, getLocalISODate } from './global.js';
import { formatJpDisplay, parseJpList } from './utils.mjs';
import { getScheduleForClassAndDate, getClassScheduleTeachersAndMapels } from './asc-schedule-parser.js';
import { selectJurnalExportRows, fetchAllJurnalRows, createJurnalReport, buildJurnalWorkbook, loadJurnalPdfLibrary, buildJurnalPdf } from './jurnal-admin-export.mjs';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, getDocs, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// --- GLOBAL STATE ---
let currentMasterData = {
    classes: [],
    teachers: [],
    mapels: [],
    lokasis: [],
    settings: {},
    motivasi: []
};

let currentTab = 'rekap';
let currentUser = null;
let currentUserRoles = [];
let currentUserData = null;
let currentQrCodeInstance = null;

let currentRekapDate = '';
let currentRekapClass = 'ALL';
let currentRekapStatus = 'ALL';
let currentRekapSearch = '';
let currentRekapData = [];
let currentUnfilledData = [];
let isRekapLoading = false;
let loadedRekapDate = '';
let isJurnalExporting = false;

// --- INITIALIZATION & AUTH ---
document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'index.html';
            return;
        }

        currentUser = user;
        const userDoc = await getDoc(doc(db, PATHS.users, user.uid));
        const userData = userDoc.exists() ? userDoc.data() : {};
        const primaryRole = userData.role || 'guru_mapel';
        const additionalRoles = Array.isArray(userData.additionalRoles) ? userData.additionalRoles : [];
        const allRoles = [primaryRole, ...additionalRoles];

        currentUserRoles = allRoles;
        currentUserData = userData;

        // Hak Akses Khusus: Super Admin, Wakasek Kurikulum, dan Kepala Lab
        const allowedRoles = ['super_admin', 'wakasek_kurikulum', 'kurikulum', 'kepala_lab'];
        const hasAccess = allRoles.some(r => allowedRoles.includes(r));

        if (!hasAccess) {
            Swal.fire({
                icon: 'error',
                title: 'Akses Ditolak',
                text: 'Halaman ini khusus untuk Super Admin, Tim Kurikulum, dan Kepala Laboratorium.',
                confirmButtonColor: '#2563eb'
            }).then(() => {
                window.location.href = 'dashboard.html';
            });
            return;
        }

        // Render SIMAS Shell Layout
        await initLayout(primaryRole);
        document.querySelector('main')?.classList.remove('hidden');

        // Load Initial Master Bundle dari Cloudflare D1
        await loadMasterData();

        // Aktifkan Tab Default (Rekap Jurnal)
        window.switchTab('rekap');
    });
});

// --- HELPER: NATURAL SORT ---
function naturalSort(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

// --- HELPER: IDENTIFIKASI ANGKATAN KELAS ---
export function getAngkatanFromClass(className) {
    if (!className) return 'OTHER';
    const clean = String(className).trim().replace(/^KELAS\s+/i, '').toUpperCase();
    if (clean.startsWith('XII') || clean.startsWith('12')) return 'XII';
    if (clean.startsWith('XI') || clean.startsWith('11')) return 'XI';
    if (clean.startsWith('X') || clean.startsWith('10')) return 'X';
    const m = clean.match(/^(X|XI|XII|\d+)/i);
    return m ? m[1].toUpperCase() : 'OTHER';
}

// --- HELPER: HAK AKSES EDIT & HAPUS JURNAL ---
export function canUserModifyJurnal(item, user = currentUser, roles = currentUserRoles, profile = currentUserData) {
    if (!user) return false;
    const allowedRoles = ['super_admin', 'wakasek_kurikulum', 'kurikulum', 'kepala_lab', 'admin'];
    const hasAdminRole = Array.isArray(roles) && roles.some(r => allowedRoles.includes(r));
    if (hasAdminRole) return true;

    // Cek jika guru pemilik jurnal (berdasarkan nama guru atau uid)
    const userTeacherName = (profile?.nama || profile?.name || user?.displayName || '').trim().toLowerCase();
    const itemGuruName = (item?.guru || '').trim().toLowerCase();
    if (userTeacherName && itemGuruName && (userTeacherName === itemGuruName || itemGuruName.includes(userTeacherName) || userTeacherName.includes(itemGuruName))) {
        return true;
    }
    if (item?.uid_guru && user?.uid && item.uid_guru === user.uid) {
        return true;
    }
    const userNik = (profile?.nik || profile?.linkedTeacherId || '').trim();
    if (item?.uid_guru && userNik && item.uid_guru === userNik) {
        return true;
    }
    return false;
}

// --- HELPER: KOMPUTASI KELAS & JP BELUM DIISI JURNAL (KBM EFEKTIF & GURU HADIR DI PRESENSI) ---
export async function computeUnfilledEffectiveSlots(
    targetDateStr,
    filledList = [],
    classes = [],
    scheduleGetter = getScheduleForClassAndDate,
    presensiRowsOrGetter = null
) {
    if (!targetDateStr) return [];
    const dateObj = new Date(targetDateStr + 'T12:00:00');
    const dayOfWeek = dateObj.getDay();

    // Hari Sabtu (6) dan Minggu (0) bukan jam belajar efektif reguler
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return [];
    }

    // 0. Ambil Data Presensi Guru (Input Siswa dari Supabase) jika belum disediakan
    let presensiRows = [];
    if (Array.isArray(presensiRowsOrGetter)) {
        presensiRows = presensiRowsOrGetter;
    } else if (typeof presensiRowsOrGetter === 'function') {
        try {
            presensiRows = await presensiRowsOrGetter(targetDateStr);
        } catch (e) {
            presensiRows = [];
        }
    } else if (typeof supabase !== 'undefined' && supabase) {
        try {
            const { data, error } = await supabase
                .from('guru_presensi')
                .select('*')
                .eq('tanggal', targetDateStr);
            if (!error && Array.isArray(data)) {
                presensiRows = data;
            }
        } catch (sbErr) {
            console.warn('[Admin Jurnal] Gagal fetch guru_presensi dari Supabase:', sbErr);
        }
    }

    // Petakan presensi guru yang diisi siswa dengan status HADIR ('H')
    // key: `${normClass(row.kelas)}_${row.jp}` -> row
    const normClass = (c) => String(c || '').trim().replace(/^KELAS\s+/i, '').replace(/\s+/g, '').toUpperCase();
    const hadirPresensiMap = new Map();
    const recordedPresensiMap = new Map();
    (presensiRows || []).forEach(row => {
        const k = normClass(row.kelas);
        const jp = parseInt(row.jp, 10);
        if (k && !isNaN(jp) && jp >= 1 && jp <= 10) {
            recordedPresensiMap.set(`${k}_${jp}`, row);
            const st = (row.status || '').trim().toUpperCase();
            if (st === 'H' || st === 'HADIR') {
                hadirPresensiMap.set(`${k}_${jp}`, row);
            }
        }
    });

    // 1. Petakan jurnal yang sudah terisi per kelas dan per JP
    const filledMap = {};

    (filledList || []).forEach(d => {
        const k = (d.kelas || '').trim();
        if (!k) return;
        const jps = parseJpList(d.jp);
        if (!filledMap[k]) filledMap[k] = {};

        jps.forEach(jpNum => {
            if (jpNum >= 1 && jpNum <= 10) {
                if (!filledMap[k][jpNum]) {
                    filledMap[k][jpNum] = d;
                }
            }
        });
    });

    const targetClasses = classes && classes.length > 0 ? classes : [];

    // 2. Ambil jadwal kelas & terapkan pewarisan status Hadir (H) pada blok jam berurutan (Contiguous Lesson Presence)
    const classSchedules = new Map();
    await Promise.all(targetClasses.map(async (kelas) => {
        try {
            const items = await scheduleGetter(kelas, targetDateStr);
            if (Array.isArray(items)) {
                classSchedules.set(kelas, items);
            }
        } catch (err) {
            console.warn(`[Admin Jurnal] Gagal mengambil jadwal kelas ${kelas}:`, err);
        }
    }));

    // Pewarisan presensi Hadir: Jika seorang guru mengajar blok jam pelajaran berurutan (misal 3 JP)
    // dan siswa mencatat Hadir (H) di salah satu JP (misal JP 1 atau JP 2), maka JP berikutnya (misal JP 3)
    // yang belum diisi presensi (dan tidak dicatat absen secara eksplisit seperti S/I/TK) otomatis mewarisi status Hadir (H).
    targetClasses.forEach(kelas => {
        const kNorm = normClass(kelas);
        const scheduleItems = classSchedules.get(kelas) || [];
        if (scheduleItems.length === 0) return;

        const lessonBlocks = [];
        let currentBlock = [];

        scheduleItems.forEach(slot => {
            const jpNum = slot.jp;
            if (!jpNum || jpNum < 1 || jpNum > 10) return;
            const mapel = (slot.mapel || '').trim().toLowerCase();
            const guru = (slot.guruNama || '').trim().toLowerCase();
            if (!mapel || !guru || mapel === '-' || guru === '-') {
                if (currentBlock.length > 0) {
                    lessonBlocks.push(currentBlock);
                    currentBlock = [];
                }
                return;
            }

            const prev = currentBlock[currentBlock.length - 1];
            if (prev && prev.guru === guru && prev.mapel === mapel && prev.jp === jpNum - 1) {
                currentBlock.push({ jp: jpNum, guru, mapel, rawSlot: slot });
            } else {
                if (currentBlock.length > 0) lessonBlocks.push(currentBlock);
                currentBlock = [{ jp: jpNum, guru, mapel, rawSlot: slot }];
            }
        });
        if (currentBlock.length > 0) lessonBlocks.push(currentBlock);

        lessonBlocks.forEach(block => {
            const blockHadir = block.map(b => hadirPresensiMap.get(`${kNorm}_${b.jp}`)).find(Boolean);
            if (!blockHadir) return;

            block.forEach(b => {
                const key = `${kNorm}_${b.jp}`;
                if (!hadirPresensiMap.has(key)) {
                    const existingRecord = recordedPresensiMap.get(key);
                    const existingStatus = (existingRecord?.status || '').trim().toUpperCase();
                    const isExplicitAbsent = ['S', 'SAKIT', 'I', 'IZIN', 'TK', 'TANPA KETERANGAN', 'A', 'ALPA'].includes(existingStatus);
                    if (!isExplicitAbsent) {
                        hadirPresensiMap.set(key, {
                            ...blockHadir,
                            jp: b.jp,
                            inheritedFromJp: blockHadir.jp || null
                        });
                    }
                }
            });
        });
    });

    // 3. Kriteria Belajar Efektif (Acuan Monitoring KBM):
    // - Upacara Bendera (Senin JP 1) = bukan KBM efektif reguler.
    // - Ekstrakurikuler (Jumat JP 10) = bukan KBM efektif reguler.
    // - Hitung rombel KBM aktif per angkatan pada JP ini (baik yang sudah isi jurnal maupun yang sudah dicatat hadir oleh siswa).
    // - JP HANYA belajar efektif jika jumlah rombel aktif pada angkatan tersebut > 2 (jika <= 2, maka non-efektif massal).
    const activeRombelSetByAngkatan = { X: {}, XI: {}, XII: {}, OTHER: {} };

    (classes || []).forEach(k => {
        const angk = getAngkatanFromClass(k);
        const kNorm = normClass(k);
        for (let jp = 1; jp <= 10; jp++) {
            const hasJournal = Boolean(filledMap[k]?.[jp]);
            const hasPresensiHadir = hadirPresensiMap.has(`${kNorm}_${jp}`);
            if (hasJournal || hasPresensiHadir) {
                if (!activeRombelSetByAngkatan[angk]) activeRombelSetByAngkatan[angk] = {};
                if (!activeRombelSetByAngkatan[angk][jp]) activeRombelSetByAngkatan[angk][jp] = new Set();
                activeRombelSetByAngkatan[angk][jp].add(kNorm);
            }
        }
    });

    const isEffectiveJP = (angk, jpNum) => {
        if (dayOfWeek === 1 && jpNum === 1) return false;
        if (dayOfWeek === 5 && jpNum === 10) return false;
        const activeCount = activeRombelSetByAngkatan[angk]?.[jpNum]?.size || 0;
        return activeCount > 2;
    };

    // 4. Pindai seluruh kelas untuk memeriksa slot jadwal XML
    const unfilledSlots = [];

    for (const kelas of targetClasses) {
        const angk = getAngkatanFromClass(kelas);
        const kNorm = normClass(kelas);
        const scheduleItems = classSchedules.get(kelas) || [];
        if (scheduleItems.length === 0) continue;

        const missingJpSlots = [];
        scheduleItems.forEach(slot => {
            const jpNum = slot.jp;
            if (!jpNum || jpNum < 1 || jpNum > 10) return;

            const mapel = (slot.mapel || '').trim();
            const guru = (slot.guruNama || '').trim();

            if (!mapel || !guru || mapel === '-' || guru === '-') return;

            // Jika jurnal sudah terisi oleh guru
            if (filledMap[kelas]?.[jpNum]) return;

            // Jika jam pelajaran TIDAK belajar efektif untuk angkatan ini (aturan Monitoring KBM)
            if (!isEffectiveJP(angk, jpNum)) return;

            // SYARAT MUTLAK: Jurnal kosong yang tampil HANYA apabila di presensi guru, siswa mengisi guru tsb dgn status Hadir (H)
            // (termasuk status Hadir yang diwariskan dari blok pengajaran jam pelajaran yang sama)
            const presensiHadir = hadirPresensiMap.get(`${kNorm}_${jpNum}`);
            if (!presensiHadir) return;

            let slotGuru = (presensiHadir.guru_nama || guru || '').trim();

            missingJpSlots.push({
                jp: jpNum,
                kelas: kelas,
                mapel: presensiHadir.mapel || mapel,
                guru: slotGuru,
                angkatan: angk,
                presensiStatus: presensiHadir.status || 'H'
            });
        });

        if (missingJpSlots.length === 0) continue;

        // Kelompokkan JP berurutan untuk rombel, guru, dan mapel yang sama
        const grouped = [];
        missingJpSlots.forEach(slot => {
            const last = grouped[grouped.length - 1];
            if (last && last.guru === slot.guru && last.mapel === slot.mapel && last.jps[last.jps.length - 1] === slot.jp - 1) {
                last.jps.push(slot.jp);
            } else {
                grouped.push({
                    kelas: slot.kelas,
                    guru: slot.guru,
                    mapel: slot.mapel,
                    angkatan: slot.angkatan,
                    jps: [slot.jp]
                });
            }
        });

        grouped.forEach(g => {
            unfilledSlots.push({
                id: `unfilled-${g.kelas}-${g.jps.join('-')}`,
                kelas: g.kelas,
                guru: g.guru,
                mapel: g.mapel,
                jp: g.jps,
                jpDisplay: g.jps.length > 1 ? `${g.jps[0]} - ${g.jps[g.jps.length - 1]}` : `${g.jps[0]}`,
                tanggal: targetDateStr,
                isUnfilledSlot: true,
                presensiStatus: 'H'
            });
        });
    }

    return unfilledSlots;
}

// --- TAB SWITCHING ---
window.switchTab = function (tabKey) {
    currentTab = tabKey;
    const tabPanes = document.querySelectorAll('.tab-pane');
    const tabBtns = document.querySelectorAll('.tab-btn');

    tabPanes.forEach(pane => pane.classList.add('hidden'));
    tabBtns.forEach(btn => {
        btn.classList.remove('bg-white', 'dark:bg-slate-900', 'text-blue-600', 'dark:text-blue-400', 'shadow-sm', 'border', 'border-slate-200', 'dark:border-slate-700');
        btn.classList.add('text-slate-600', 'dark:text-slate-400');
    });

    const targetPane = document.getElementById(`tab-content-${tabKey}`);
    const targetBtn = document.getElementById(`tab-btn-${tabKey}`);

    if (targetPane) targetPane.classList.remove('hidden');
    if (targetBtn) {
        targetBtn.classList.remove('text-slate-600', 'dark:text-slate-400');
        targetBtn.classList.add('bg-white', 'dark:bg-slate-900', 'text-blue-600', 'dark:text-blue-400', 'shadow-sm', 'border', 'border-slate-200', 'dark:border-slate-700');
    }

    if (tabKey === 'rekap') {
        window.loadRekapJurnal();
    } else if (tabKey === 'qr') {
        window.renderAllClassQrCodes();
    } else if (tabKey === 'lokasi') {
        renderLokasiTable();
    } else if (tabKey === 'motivasi') {
        renderMotivasiTable();
    } else if (tabKey === 'pengaturan') {
        populateSettingsForm();
    }
};

// --- LOAD MASTER DATA (CLOUDFLARE D1 & SETTINGS SSOT) ---
async function loadMasterData() {
    try {
        // Ambil daftar kelas aktif dari SSOT Settings (global.js getActiveClasses)
        let activeClasses = [];
        if (typeof window.getActiveClasses === 'function') {
            activeClasses = await window.getActiveClasses();
        }

        const res = await cfClient.getJurnalMaster();
        currentMasterData = {
            classes: (activeClasses && activeClasses.length > 0) ? activeClasses : (res.classes || []),
            teachers: res.teachers || [],
            mapels: res.mapels || [],
            lokasis: res.lokasis || [],
            settings: res.settings || {},
            motivasi: Array.isArray(res.motivasi) ? res.motivasi : []
        };

        // Populate Dropdown Filter Kelas Rekap
        populateRekapClassDropdown();

        // Populate Lokasis
        renderLokasiTable();

        // Populate Motivasi
        renderMotivasiTable();

        // Populate Settings
        populateSettingsForm();

    } catch (err) {
        console.error('[Admin Jurnal] Gagal memuat master bundle D1:', err);
        showToast('Gagal memuat master data Cloudflare D1: ' + err.message, 'error');
    }
}

// =========================================================================
// --- TAB 0: REKAPITULASI JURNAL MENGAJAR HARIAN (CLOUDFLARE D1 SSOT) ---
// =========================================================================

function getTodayISODate() {
    if (typeof getLocalISODate === 'function') {
        return getLocalISODate();
    }
    if (typeof window.getLocalISODate === 'function') {
        return window.getLocalISODate();
    }
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function populateRekapClassDropdown() {
    const select = document.getElementById('filter-rekap-kelas');
    if (!select) return;

    const classes = currentMasterData.classes || [];
    const sortedClasses = [...classes].sort(naturalSort);
    const prevVal = select.value || 'ALL';

    select.innerHTML = '<option value="ALL">Semua Kelas</option>' +
        sortedClasses.map(cls => `<option value="${escapeHTML(cls)}">${escapeHTML(cls)}</option>`).join('');

    if (prevVal && (prevVal === 'ALL' || sortedClasses.includes(prevVal))) {
        select.value = prevVal;
    }
}

window.setRekapToday = function () {
    const dateInput = document.getElementById('filter-rekap-tanggal');
    const today = getTodayISODate();
    if (dateInput) dateInput.value = today;
    currentRekapDate = today;
    window.loadRekapJurnal();
};

window.navigateRekapDate = function (offsetDays) {
    const dateInput = document.getElementById('filter-rekap-tanggal');
    const baseDateStr = dateInput?.value || currentRekapDate || getTodayISODate();
    const d = new Date(baseDateStr + 'T12:00:00');
    d.setDate(d.getDate() + offsetDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const newDateStr = `${y}-${m}-${day}`;

    if (dateInput) dateInput.value = newDateStr;
    currentRekapDate = newDateStr;
    window.loadRekapJurnal();
};

window.handleRekapFilterChange = function () {
    const dateInput = document.getElementById('filter-rekap-tanggal');
    const classSelect = document.getElementById('filter-rekap-kelas');
    const statusSelect = document.getElementById('filter-rekap-status');

    currentRekapDate = dateInput?.value || getTodayISODate();
    currentRekapClass = classSelect?.value || 'ALL';
    currentRekapStatus = statusSelect?.value || 'ALL';
    if (!isRekapLoading && loadedRekapDate === currentRekapDate) {
        renderRekapTable();
        updateRekapKPIs();
    } else {
        window.loadRekapJurnal();
    }
};

window.handleRekapSearch = function (val) {
    currentRekapSearch = (val || '').toLowerCase().trim();
    renderRekapTable();
    updateRekapKPIs();
};

window.loadRekapJurnal = async function (forceRefresh = false) {
    if (isRekapLoading) return;
    const tbody = document.getElementById('table-rekap-body');
    const refreshIcon = document.getElementById('icon-refresh-rekap');
    const dateInput = document.getElementById('filter-rekap-tanggal');
    const classSelect = document.getElementById('filter-rekap-kelas');
    const statusSelect = document.getElementById('filter-rekap-status');

    if (!currentRekapDate) {
        currentRekapDate = dateInput?.value || getTodayISODate();
        if (dateInput && !dateInput.value) dateInput.value = currentRekapDate;
    }
    if (classSelect) {
        currentRekapClass = classSelect.value || 'ALL';
    }
    if (statusSelect) {
        currentRekapStatus = statusSelect.value || 'ALL';
    }

    if (refreshIcon) refreshIcon.classList.add('fa-spin');
    isRekapLoading = true;
    loadedRekapDate = '';
    const requestedDate = currentRekapDate;

    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="p-12 text-center text-slate-400">
                    <i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2 text-blue-500 block"></i>
                    Memuat rekap jurnal Cloudflare D1 (${currentRekapDate})...
                </td>
            </tr>
        `;
    }

    try {
        const [res, sbPresensiRes] = await Promise.all([
            fetchAllJurnalRows(filters => cfClient.getJurnalKbm(filters), { tanggal: requestedDate }),
            (async () => {
                if (!supabase) return [];
                try {
                    const { data, error } = await supabase
                        .from('guru_presensi')
                        .select('*')
                        .eq('tanggal', requestedDate);
                    return (!error && Array.isArray(data)) ? data : [];
                } catch (sbErr) {
                    console.warn('[Admin Jurnal] Gagal fetch guru_presensi dari Supabase:', sbErr);
                    return [];
                }
            })()
        ]);
        // Hitung slot belum diisi (KBM Efektif & Guru Hadir di Presensi Siswa)
        const activeClasses = currentMasterData.classes && currentMasterData.classes.length > 0 ? currentMasterData.classes : [];
        const unfilled = await computeUnfilledEffectiveSlots(requestedDate, res, activeClasses, getScheduleForClassAndDate, sbPresensiRes);
        if (requestedDate !== currentRekapDate) return;
        currentRekapData = res;
        currentUnfilledData = unfilled;
        loadedRekapDate = requestedDate;

        renderRekapTable();
        updateRekapKPIs();

        if (forceRefresh) {
            showToast(`Rekap jurnal (${currentRekapData.length} entri) berhasil dimuat.`, 'success');
        }
    } catch (err) {
        if (requestedDate !== currentRekapDate) return;
        console.error('[Admin Jurnal] Gagal memuat rekap jurnal:', err);
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="p-8 text-center text-rose-500">
                        <i class="fa-solid fa-triangle-exclamation text-2xl mb-2 block"></i>
                        Gagal memuat rekap jurnal: ${escapeHTML(err.message)}
                    </td>
                </tr>
            `;
        }
        showToast('Gagal memuat rekap jurnal: ' + err.message, 'error');
    } finally {
        isRekapLoading = false;
        if (refreshIcon) refreshIcon.classList.remove('fa-spin');
        if (requestedDate !== currentRekapDate) window.loadRekapJurnal();
    }
};

function renderRekapTable() {
    const tbody = document.getElementById('table-rekap-body');
    if (!tbody) return;

    // --- JIKA MODE FILTER: BELUM DIISI (KBM EFEKTIF) ---
    if (currentRekapStatus === 'UNFILLED') {
        const unfilled = selectJurnalExportRows(currentUnfilledData, { kelas: currentRekapClass, search: currentRekapSearch, status: 'UNFILLED' });

        if (unfilled.length === 0) {
            const emptyMsg = currentRekapSearch
                ? `Tidak ada slot belum diisi yang cocok dengan pencarian "<strong>${escapeHTML(currentRekapSearch)}</strong>".`
                : `Tidak ditemukan jurnal kosong pada tanggal <strong>${escapeHTML(currentRekapDate)}</strong>${currentRekapClass !== 'ALL' ? ` untuk kelas <strong>${escapeHTML(currentRekapClass)}</strong>` : ''}. Seluruh guru yang hadir telah mengisi jurnal mengajar.`;
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="p-12 text-center text-slate-400">
                        <i class="fa-solid fa-circle-check text-3xl mb-3 text-emerald-500 block"></i>
                        <p class="font-bold text-sm text-slate-700 dark:text-slate-200">${emptyMsg}</p>
                        <p class="text-xs text-slate-400 mt-1">Hanya menampilkan guru yang dicatat Hadir (H) oleh siswa pada presensi kelas namun belum menginput jurnal KBM.</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = unfilled.map((d, idx) => {
            const jpDisplay = d.jpDisplay || formatJpDisplay(d.jp);
            const jpCsv = Array.isArray(d.jp) ? d.jp.join(',') : String(d.jp || '');

            return `
                <tr class="hover:bg-amber-50/50 dark:hover:bg-amber-950/20 transition bg-white dark:bg-slate-800">
                    <td class="p-3 text-center text-slate-400 font-mono">${idx + 1}</td>
                    <td class="p-3 text-center">
                        <span class="px-2 py-0.5 rounded-lg bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 font-bold font-mono text-[11px] border border-amber-200 dark:border-amber-800">
                            JP ${escapeHTML(jpDisplay)}
                        </span>
                    </td>
                    <td class="p-3 text-center">
                        <span class="font-bold text-slate-900 dark:text-white">${escapeHTML(d.kelas || '-')}</span>
                    </td>
                    <td class="p-3">
                        <div class="font-bold text-slate-900 dark:text-white leading-tight">${escapeHTML(d.guru || '-')}</div>
                        <div class="text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-0.5 flex items-center gap-1">
                            <i class="fa-solid fa-triangle-exclamation text-[9px]"></i> Belum Mengisi Jurnal
                        </div>
                    </td>
                    <td class="p-3">
                        <div class="font-semibold text-slate-800 dark:text-slate-200 leading-tight">${escapeHTML(d.mapel || '-')}</div>
                        <div class="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5 flex items-center gap-1 font-semibold">
                            <i class="fa-solid fa-user-check text-[10px]"></i> Presensi Siswa: Hadir (H)
                        </div>
                    </td>
                    <td class="p-3">
                        <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80">
                            <i class="fa-solid fa-circle-exclamation mr-1 text-[9px]"></i> KBM Efektif (Jurnal Kosong)
                        </span>
                    </td>
                    <td class="p-3 text-center">
                        <span class="text-slate-400 text-xs italic">-</span>
                    </td>
                    <td class="p-3 text-center">
                        <span class="text-slate-400 text-xs font-mono">-</span>
                    </td>
                    <td class="p-3 text-center">
                        <button onclick="window.openCreateJurnalForSlot('${escapeHTML(d.kelas)}', '${escapeHTML(d.guru)}', '${escapeHTML(d.mapel)}', '${escapeHTML(jpCsv)}')"
                            class="px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1 shadow-xs transition active:scale-95 cursor-pointer mx-auto" title="Input Jurnal untuk Slot Ini">
                            <i class="fa-solid fa-pen-to-square"></i> Input
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
        return;
    }

    // --- MODE FILTER: SEMUA JURNAL TERISI ---
    const filtered = selectJurnalExportRows(currentRekapData, { kelas: currentRekapClass, search: currentRekapSearch });

    if (filtered.length === 0) {
        const msg = currentRekapSearch
            ? `Tidak ada jurnal yang cocok dengan pencarian "<strong>${escapeHTML(currentRekapSearch)}</strong>".`
            : `Belum ada pengisian jurnal KBM pada tanggal <strong>${escapeHTML(currentRekapDate)}</strong>${currentRekapClass !== 'ALL' ? ` untuk kelas <strong>${escapeHTML(currentRekapClass)}</strong>` : ''}.`;
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="p-12 text-center text-slate-400">
                    <i class="fa-solid fa-folder-open text-3xl mb-3 text-slate-300 dark:text-slate-600 block"></i>
                    <p class="font-bold text-sm text-slate-600 dark:text-slate-300">${msg}</p>
                    <p class="text-xs text-slate-400 mt-1">Ganti tanggal atau periksa kelas lain.</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map((d, idx) => {
        const originalIndex = currentRekapData.indexOf(d);
        const jpDisplay = formatJpDisplay(d.jp);
        const presensi = Array.isArray(d.presensi_detail) ? d.presensi_detail : [];
        const sCount = presensi.filter(p => p.status === 'S' || p.status === 'Sakit').length;
        const iCount = presensi.filter(p => p.status === 'I' || p.status === 'Izin').length;
        const aCount = presensi.filter(p => p.status === 'A' || p.status === 'Alpa').length;
        const dCount = presensi.filter(p => p.status === 'D' || p.status === 'Dispensasi').length;
        const totalAbsen = sCount + iCount + aCount + dCount;

        let presensiBadgeHtml = '';
        if (totalAbsen === 0) {
            presensiBadgeHtml = `
                <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                    <i class="fa-solid fa-check mr-1 text-[9px]"></i> Hadir Semua
                </span>
            `;
        } else {
            const badges = [];
            if (sCount > 0) badges.push(`<span class="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">S: ${sCount}</span>`);
            if (iCount > 0) badges.push(`<span class="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">I: ${iCount}</span>`);
            if (aCount > 0) badges.push(`<span class="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">A: ${aCount}</span>`);
            if (dCount > 0) badges.push(`<span class="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">D: ${dCount}</span>`);

            presensiBadgeHtml = `
                <div class="flex flex-col items-center gap-1">
                    <div class="flex items-center gap-1 flex-wrap justify-center">${badges.join('')}</div>
                    <button onclick="window.openModalDetailPresensi(${originalIndex})"
                        class="text-[10px] font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer">
                        <i class="fa-solid fa-users-viewfinder"></i> ${totalAbsen} Tidak Hadir
                    </button>
                </div>
            `;
        }

        const fotoHtml = d.foto_url ? `
            <div class="relative group cursor-pointer inline-block" onclick="window.openModalFoto(${originalIndex})">
                <img src="${escapeHTML(d.foto_url)}" alt="Foto KBM" class="w-10 h-10 object-cover rounded-lg border border-slate-200 dark:border-slate-700 hover:opacity-80 transition shadow-xs" onerror="this.parentElement.innerHTML='<span class=\\'text-slate-400 text-xs font-mono\\'>-</span>'">
                <div class="absolute inset-0 bg-black/35 rounded-lg opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[10px] transition">
                    <i class="fa-solid fa-expand"></i>
                </div>
            </div>
        ` : `<span class="text-slate-400 text-xs font-mono">-</span>`;

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
                <td class="p-3 text-center text-slate-400 font-mono">${idx + 1}</td>
                <td class="p-3 text-center">
                    <span class="px-2 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-bold font-mono text-[11px]">
                        ${escapeHTML(jpDisplay)}
                    </span>
                </td>
                <td class="p-3 text-center">
                    <span class="font-bold text-slate-900 dark:text-white">${escapeHTML(d.kelas || '-')}</span>
                </td>
                <td class="p-3">
                    <div class="font-bold text-slate-900 dark:text-white leading-tight">${escapeHTML(d.guru || '-')}</div>
                    ${d.created_at ? `<div class="text-[10px] text-slate-400 mt-0.5"><i class="fa-regular fa-clock text-[9px] mr-1"></i>${escapeHTML(d.created_at)}</div>` : ''}
                </td>
                <td class="p-3">
                    <div class="font-semibold text-slate-800 dark:text-slate-200 leading-tight">${escapeHTML(d.mapel || '-')}</div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1">
                        <i class="fa-solid fa-location-dot text-[10px] text-slate-400"></i> ${escapeHTML(d.lokasi_mengajar || 'Ruang Kelas')}
                    </div>
                </td>
                <td class="p-3">
                    <div class="font-semibold text-slate-800 dark:text-slate-200 line-clamp-2">${escapeHTML(d.topik || '-')}</div>
                    ${d.catatan ? `<div class="text-[11px] text-slate-500 dark:text-slate-400 italic line-clamp-1 mt-0.5">"${escapeHTML(d.catatan)}"</div>` : ''}
                </td>
                <td class="p-3 text-center">
                    ${presensiBadgeHtml}
                </td>
                <td class="p-3 text-center">
                    ${fotoHtml}
                </td>
                <td class="p-3 text-center">
                    <button onclick="window.showJurnalRowDetail(${originalIndex})"
                        class="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition cursor-pointer" title="Rincian Lengkap">
                        <i class="fa-solid fa-eye"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function updateRekapKPIs() {
    const elJurnal = document.getElementById('stat-total-jurnal');
    const elGuru = document.getElementById('stat-total-guru');
    const elSakitIzin = document.getElementById('stat-total-sakit-izin');
    const elAlpa = document.getElementById('stat-total-alpa');

    const filtered = selectJurnalExportRows(currentRekapData, { kelas: currentRekapClass, search: currentRekapSearch });
    const totalJurnal = filtered.length;
    const guruSet = new Set(filtered.map(d => (d.guru || '').trim()).filter(Boolean));
    const totalGuru = guruSet.size;

    let totalSakit = 0;
    let totalIzin = 0;
    let totalAlpa = 0;

    filtered.forEach(d => {
        const presensi = Array.isArray(d.presensi_detail) ? d.presensi_detail : [];
        presensi.forEach(p => {
            const st = (p.status || '').toUpperCase();
            if (st === 'S' || st === 'SAKIT') totalSakit++;
            else if (st === 'I' || st === 'IZIN') totalIzin++;
            else if (st === 'A' || st === 'ALPA') totalAlpa++;
        });
    });

    if (elJurnal) elJurnal.textContent = totalJurnal;
    if (elGuru) elGuru.textContent = totalGuru;
    if (elSakitIzin) elSakitIzin.textContent = totalSakit + totalIzin;
    if (elAlpa) elAlpa.textContent = totalAlpa;
}

window.openModalFoto = function (indexOrUrl, guru = '', kelas = '', mapel = '', jp = '') {
    const modal = document.getElementById('modal-foto-kbm');
    const img = document.getElementById('modal-foto-img');
    const title = document.getElementById('modal-foto-title');
    const subtitle = document.getElementById('modal-foto-subtitle');

    let url = '';
    let g = guru;
    let k = kelas;
    let m = mapel;
    let j = jp;

    if (typeof indexOrUrl === 'number' && currentRekapData[indexOrUrl]) {
        const item = currentRekapData[indexOrUrl];
        url = item.foto_url || '';
        g = item.guru || '';
        k = item.kelas || '';
        m = item.mapel || '';
        j = formatJpDisplay(item.jp);
    } else if (typeof indexOrUrl === 'string') {
        url = indexOrUrl;
    }

    if (!url) {
        showToast('Foto dokumentasi KBM tidak tersedia.', 'info');
        return;
    }

    if (img) img.src = url;
    if (title) title.innerText = `Foto KBM - Kelas ${k || '-'}`;
    if (subtitle) subtitle.innerText = `${g || '-'} - ${m || '-'} (JP: ${j || '-'})`;

    modal?.classList.remove('hidden');
};

window.closeModalFoto = function () {
    document.getElementById('modal-foto-kbm')?.classList.add('hidden');
    const img = document.getElementById('modal-foto-img');
    if (img) img.src = '';
};

window.openModalDetailPresensi = function (index) {
    const item = currentRekapData[index];
    if (!item) return;

    const modal = document.getElementById('modal-detail-presensi');
    const title = document.getElementById('modal-presensi-title');
    const subtitle = document.getElementById('modal-presensi-subtitle');
    const content = document.getElementById('modal-presensi-content');

    const jpDisplay = formatJpDisplay(item.jp);
    if (title) title.innerText = `Rincian Presensi Kelas ${item.kelas || '-'}`;
    if (subtitle) subtitle.innerText = `${item.guru || '-'} - ${item.mapel || '-'} (JP: ${jpDisplay})`;

    const presensi = Array.isArray(item.presensi_detail) ? item.presensi_detail : [];
    if (presensi.length === 0) {
        if (content) {
            content.innerHTML = `
                <div class="p-6 text-center text-slate-400">
                    <i class="fa-solid fa-check-circle text-2xl text-emerald-500 mb-2 block"></i>
                    Semua siswa tercatat hadir lengkap pada jam KBM ini.
                </div>
            `;
        }
    } else {
        if (content) {
            content.innerHTML = presensi.map(s => {
                const st = (s.status || '').toUpperCase();
                let badgeClass = 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
                let statusLabel = s.status || '-';
                if (st === 'S' || st === 'SAKIT') {
                    badgeClass = 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800';
                    statusLabel = 'Sakit';
                } else if (st === 'I' || st === 'IZIN') {
                    badgeClass = 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800';
                    statusLabel = 'Izin';
                } else if (st === 'A' || st === 'ALPA') {
                    badgeClass = 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800';
                    statusLabel = 'Alpa';
                } else if (st === 'D' || st === 'DISPENSASI') {
                    badgeClass = 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800';
                    statusLabel = 'Dispensasi';
                }

                return `
                    <div class="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between gap-3">
                        <div class="min-w-0">
                            <div class="font-bold text-slate-900 dark:text-white truncate">${escapeHTML(s.nama || '-')}</div>
                            <div class="text-[11px] text-slate-400">NIS: ${escapeHTML(s.nis || '-')} ${s.absen ? `| No Absen: ${escapeHTML(s.absen)}` : ''}</div>
                        </div>
                        <span class="px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 ${badgeClass}">
                            ${escapeHTML(statusLabel)}
                        </span>
                    </div>
                `;
            }).join('');
        }
    }

    modal?.classList.remove('hidden');
};

window.closeModalDetailPresensi = function () {
    document.getElementById('modal-detail-presensi')?.classList.add('hidden');
};

// --- POPULATE DROPDOWNS UNTUK MODAL EDIT/INPUT JURNAL (SSOT aSc TIMETABLE) ---
const cachedClassScheduleMap = new Map();

export async function getCachedClassSchedule(className) {
    if (!className) return null;
    if (cachedClassScheduleMap.has(className)) {
        return cachedClassScheduleMap.get(className);
    }
    try {
        const info = await getClassScheduleTeachersAndMapels(className);
        cachedClassScheduleMap.set(className, info);
        return info;
    } catch (err) {
        console.warn(`[Admin Jurnal] Gagal memuat info jadwal aSc kelas ${className}:`, err);
        return null;
    }
}

export async function updateEditGuruDropdown(targetKelas = '', selectedGuru = '') {
    const elGuru = document.getElementById('edit-jurnal-guru');
    if (!elGuru) return;

    const scheduleInfo = targetKelas ? await getCachedClassSchedule(targetKelas) : null;
    const classTeachers = (scheduleInfo && Array.isArray(scheduleInfo.teachers)) ? scheduleInfo.teachers : [];

    // Semua guru dari master data
    const allMasterTeachers = [...(currentMasterData.teachers || [])].sort((a, b) => naturalSort(a.nama || a.name || '', b.nama || b.name || ''));
    const allTeacherNames = allMasterTeachers.map(t => (t.nama || t.name || '').trim()).filter(Boolean);

    // Kumpulan nama guru yang mengajar di kelas ini menurut jadwal aSc
    const classTeacherNameSet = new Set(classTeachers.map(t => t.name.toLowerCase()));

    // Guru lainnya yang tidak mengajar di kelas ini
    const otherTeacherNames = allTeacherNames.filter(name => !classTeacherNameSet.has(name.toLowerCase()));

    let html = '<option value="">-- Pilih Guru Pengajar --</option>';

    if (classTeachers.length > 0) {
        html += `<optgroup label="Guru Pengajar Kelas ${escapeHTML(targetKelas)} (Jadwal aSc)">`;
        classTeachers.forEach(t => {
            const isSel = (t.name === selectedGuru);
            const mapelHint = (t.mapels && t.mapels.length > 0) ? ` (${t.mapels.join(', ')})` : '';
            html += `<option value="${escapeHTML(t.name)}" ${isSel ? 'selected' : ''}>${escapeHTML(t.name)}${escapeHTML(mapelHint)}</option>`;
        });
        html += `</optgroup>`;

        if (otherTeacherNames.length > 0) {
            html += `<optgroup label="Guru Lainnya (Pengganti / Tambahan)">`;
            otherTeacherNames.forEach(name => {
                const isSel = (name === selectedGuru);
                html += `<option value="${escapeHTML(name)}" ${isSel ? 'selected' : ''}>${escapeHTML(name)}</option>`;
            });
            html += `</optgroup>`;
        }
    } else {
        allTeacherNames.forEach(name => {
            const isSel = (name === selectedGuru);
            html += `<option value="${escapeHTML(name)}" ${isSel ? 'selected' : ''}>${escapeHTML(name)}</option>`;
        });
    }

    if (selectedGuru && !html.includes(`value="${escapeHTML(selectedGuru)}"`)) {
        html += `<option value="${escapeHTML(selectedGuru)}" selected>${escapeHTML(selectedGuru)}</option>`;
    }

    elGuru.innerHTML = html;
    if (selectedGuru) {
        elGuru.value = selectedGuru;
    }
}

export async function updateEditMapelDropdown(targetKelas = '', targetGuru = '', selectedMapel = '') {
    const elMapel = document.getElementById('edit-jurnal-mapel');
    if (!elMapel) return;

    const scheduleInfo = targetKelas ? await getCachedClassSchedule(targetKelas) : null;
    const classTeachers = (scheduleInfo && Array.isArray(scheduleInfo.teachers)) ? scheduleInfo.teachers : [];
    const classMapels = (scheduleInfo && Array.isArray(scheduleInfo.mapels)) ? scheduleInfo.mapels : [];

    // Cari mapel yang diajar guru bersangkutan di kelas ini
    let guruMapels = [];
    if (targetGuru && classTeachers.length > 0) {
        const normTargetGuru = targetGuru.trim().toLowerCase();
        const matched = classTeachers.find(t => 
            t.name.trim().toLowerCase() === normTargetGuru ||
            (t.xmlName && t.xmlName.trim().toLowerCase() === normTargetGuru) ||
            t.name.toLowerCase().includes(normTargetGuru) ||
            normTargetGuru.includes(t.name.toLowerCase())
        );
        if (matched && Array.isArray(matched.mapels)) {
            guruMapels = matched.mapels;
        }
    }

    // Seluruh mapel dari master
    const allMasterMapels = [...(currentMasterData.mapels || [])]
        .map(m => (m.nama || m.name || m.mapel || '').trim())
        .filter(Boolean)
        .sort(naturalSort);

    const guruMapelSet = new Set(guruMapels);
    const otherClassMapels = classMapels.filter(m => !guruMapelSet.has(m));
    const classMapelSet = new Set(classMapels);
    const otherMasterMapels = allMasterMapels.filter(m => !guruMapelSet.has(m) && !classMapelSet.has(m));

    let html = '<option value="">-- Pilih Mata Pelajaran --</option>';

    if (guruMapels.length > 0) {
        html += `<optgroup label="Mapel Guru di Kelas ${escapeHTML(targetKelas)} (Jadwal aSc)">`;
        guruMapels.forEach(m => {
            const isSel = (m === selectedMapel) || (!selectedMapel && guruMapels.length === 1);
            html += `<option value="${escapeHTML(m)}" ${isSel ? 'selected' : ''}>${escapeHTML(m)}</option>`;
        });
        html += `</optgroup>`;

        if (otherClassMapels.length > 0) {
            html += `<optgroup label="Mapel Lainnya di Kelas ${escapeHTML(targetKelas)}">`;
            otherClassMapels.forEach(m => {
                const isSel = (m === selectedMapel);
                html += `<option value="${escapeHTML(m)}" ${isSel ? 'selected' : ''}>${escapeHTML(m)}</option>`;
            });
            html += `</optgroup>`;
        }

        if (otherMasterMapels.length > 0) {
            html += `<optgroup label="Mata Pelajaran Lainnya">`;
            otherMasterMapels.forEach(m => {
                const isSel = (m === selectedMapel);
                html += `<option value="${escapeHTML(m)}" ${isSel ? 'selected' : ''}>${escapeHTML(m)}</option>`;
            });
            html += `</optgroup>`;
        }
    } else if (classMapels.length > 0) {
        html += `<optgroup label="Mata Pelajaran Kelas ${escapeHTML(targetKelas)} (Jadwal aSc)">`;
        classMapels.forEach(m => {
            const isSel = (m === selectedMapel);
            html += `<option value="${escapeHTML(m)}" ${isSel ? 'selected' : ''}>${escapeHTML(m)}</option>`;
        });
        html += `</optgroup>`;

        if (otherMasterMapels.length > 0) {
            html += `<optgroup label="Mata Pelajaran Lainnya">`;
            otherMasterMapels.forEach(m => {
                const isSel = (m === selectedMapel);
                html += `<option value="${escapeHTML(m)}" ${isSel ? 'selected' : ''}>${escapeHTML(m)}</option>`;
            });
            html += `</optgroup>`;
        }
    } else {
        allMasterMapels.forEach(m => {
            const isSel = (m === selectedMapel);
            html += `<option value="${escapeHTML(m)}" ${isSel ? 'selected' : ''}>${escapeHTML(m)}</option>`;
        });
    }

    if (selectedMapel && !html.includes(`value="${escapeHTML(selectedMapel)}"`)) {
        html += `<option value="${escapeHTML(selectedMapel)}" selected>${escapeHTML(selectedMapel)}</option>`;
    }

    elMapel.innerHTML = html;

    // Otomatisasi cerdas: jika guru memiliki 1 mapel di kelas ini dan user belum memilih mapel, pilihkan langsung!
    if (!selectedMapel && guruMapels.length === 1) {
        elMapel.value = guruMapels[0];
    } else if (selectedMapel) {
        elMapel.value = selectedMapel;
    }
}

function setupEditJurnalModalEvents() {
    const elKelas = document.getElementById('edit-jurnal-kelas');
    const elGuru = document.getElementById('edit-jurnal-guru');

    if (elKelas && !elKelas.dataset.eventsBound) {
        elKelas.dataset.eventsBound = 'true';
        elKelas.addEventListener('change', async () => {
            const newKelas = elKelas.value;
            const currentGuru = elGuru ? elGuru.value : '';
            await updateEditGuruDropdown(newKelas, currentGuru);
            const updatedGuru = elGuru ? elGuru.value : '';
            const currentMapel = document.getElementById('edit-jurnal-mapel')?.value || '';
            await updateEditMapelDropdown(newKelas, updatedGuru, currentMapel);
        });
    }

    if (elGuru && !elGuru.dataset.eventsBound) {
        elGuru.dataset.eventsBound = 'true';
        elGuru.addEventListener('change', async () => {
            const currentKelas = document.getElementById('edit-jurnal-kelas')?.value || '';
            const newGuru = elGuru.value;
            const currentMapel = document.getElementById('edit-jurnal-mapel')?.value || '';
            await updateEditMapelDropdown(currentKelas, newGuru, currentMapel);
        });
    }
}

export async function populateEditJurnalDropdowns(selectedKelas = '', selectedGuru = '', selectedMapel = '', selectedLokasi = '', selectedJps = []) {
    setupEditJurnalModalEvents();

    const elKelas = document.getElementById('edit-jurnal-kelas');
    const elLokasi = document.getElementById('edit-jurnal-lokasi');
    const elJpContainer = document.getElementById('edit-jurnal-jp-container');

    // 1. Kelas
    if (elKelas) {
        const classes = [...(currentMasterData.classes || [])].sort(naturalSort);
        elKelas.innerHTML = '<option value="">-- Pilih Kelas --</option>' +
            classes.map(c => `<option value="${escapeHTML(c)}" ${c === selectedKelas ? 'selected' : ''}>${escapeHTML(c)}</option>`).join('');
        if (selectedKelas && !classes.includes(selectedKelas)) {
            elKelas.innerHTML += `<option value="${escapeHTML(selectedKelas)}" selected>${escapeHTML(selectedKelas)}</option>`;
        }
        elKelas.value = selectedKelas || '';
    }

    // 2. Guru & 3. Mapel (Disesuaikan dengan jadwal aSc untuk kelas yang dipilih)
    await updateEditGuruDropdown(selectedKelas, selectedGuru);
    await updateEditMapelDropdown(selectedKelas, selectedGuru, selectedMapel);

    // 4. Lokasi
    if (elLokasi) {
        const lokasis = [...(currentMasterData.lokasis || [])].sort((a, b) => naturalSort(a.nama_lokasi || a.nama || '', b.nama_lokasi || b.nama || ''));
        const defaultLokasi = selectedLokasi || 'Ruang Kelas';
        elLokasi.innerHTML = '<option value="Ruang Kelas">Ruang Kelas</option>' +
            lokasis.map(l => {
                const name = l.nama_lokasi || l.nama || '';
                if (!name || name === 'Ruang Kelas') return '';
                return `<option value="${escapeHTML(name)}" ${name === defaultLokasi ? 'selected' : ''}>${escapeHTML(name)}</option>`;
            }).join('');
        if (defaultLokasi && defaultLokasi !== 'Ruang Kelas' && !lokasis.some(l => (l.nama_lokasi || l.nama) === defaultLokasi)) {
            elLokasi.innerHTML += `<option value="${escapeHTML(defaultLokasi)}" selected>${escapeHTML(defaultLokasi)}</option>`;
        }
        elLokasi.value = defaultLokasi;
    }

    // 5. JP (1 s/d 10)
    if (elJpContainer) {
        const jpSelectedNums = Array.isArray(selectedJps) ? selectedJps.map(Number) : [];
        elJpContainer.innerHTML = Array.from({ length: 10 }, (_, i) => i + 1).map(num => {
            const isChecked = jpSelectedNums.includes(num);
            return `
                <label class="flex items-center justify-center p-1.5 rounded-lg border text-center cursor-pointer transition select-none ${isChecked ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-400 text-blue-700 dark:text-blue-300 font-bold' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'}">
                    <input type="checkbox" name="edit-jp-checkbox" value="${num}" ${isChecked ? 'checked' : ''} class="sr-only" onchange="this.parentElement.classList.toggle('bg-blue-50', this.checked); this.parentElement.classList.toggle('dark:bg-blue-950/60', this.checked); this.parentElement.classList.toggle('border-blue-400', this.checked); this.parentElement.classList.toggle('border-slate-200', !this.checked); this.parentElement.classList.toggle('bg-white', !this.checked); this.parentElement.classList.toggle('dark:bg-slate-800', !this.checked); this.parentElement.classList.toggle('font-bold', this.checked);">
                    <span>${num}</span>
                </label>
            `;
        }).join('');
    }
}

// --- RENDERING PRESENSI SISWA TIDAK HADIR DI MODAL EDIT ---
function renderPresensiEditList(presensiList = []) {
    const container = document.getElementById('edit-jurnal-presensi-list');
    if (!container) return;

    if (!Array.isArray(presensiList) || presensiList.length === 0) {
        container.innerHTML = `
            <div id="empty-presensi-msg" class="p-3 text-center text-slate-400 italic text-[11px]">
                Semua siswa hadir (tidak ada catatan ketidakhadiran).
            </div>
        `;
        return;
    }

    container.innerHTML = presensiList.map(s => `
        <div class="siswa-absen-row flex items-center gap-2 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <input type="text" class="input-absen-nama flex-1 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white" placeholder="Nama Siswa" value="${escapeHTML(s.nama || '')}" required>
            <input type="text" inputmode="numeric" pattern="[0-9]*" class="input-absen-nis w-24 px-2 py-1 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white" placeholder="NIS" value="${escapeHTML(s.nis || '')}">
            <select class="input-absen-status w-24 px-2 py-1 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white">
                <option value="S" ${(s.status === 'S' || s.status === 'Sakit') ? 'selected' : ''}>Sakit</option>
                <option value="I" ${(s.status === 'I' || s.status === 'Izin') ? 'selected' : ''}>Izin</option>
                <option value="A" ${(s.status === 'A' || s.status === 'Alpa') ? 'selected' : ''}>Alpa</option>
                <option value="D" ${(s.status === 'D' || s.status === 'Dispensasi') ? 'selected' : ''}>Dispen</option>
            </select>
            <button type="button" onclick="window.removeSiswaAbsenRowEdit(this)" class="p-1 text-rose-500 hover:text-rose-700 cursor-pointer" title="Hapus">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        </div>
    `).join('');
}

window.addSiswaAbsenRowEdit = function (nama = '', nis = '', status = 'S') {
    const container = document.getElementById('edit-jurnal-presensi-list');
    if (!container) return;
    document.getElementById('empty-presensi-msg')?.remove();

    const row = document.createElement('div');
    row.className = 'siswa-absen-row flex items-center gap-2 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700';
    row.innerHTML = `
        <input type="text" class="input-absen-nama flex-1 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white" placeholder="Nama Siswa" value="${escapeHTML(nama)}" required>
        <input type="text" inputmode="numeric" pattern="[0-9]*" class="input-absen-nis w-24 px-2 py-1 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white" placeholder="NIS" value="${escapeHTML(nis)}">
        <select class="input-absen-status w-24 px-2 py-1 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white">
            <option value="S" ${status === 'S' ? 'selected' : ''}>Sakit</option>
            <option value="I" ${status === 'I' ? 'selected' : ''}>Izin</option>
            <option value="A" ${status === 'A' ? 'selected' : ''}>Alpa</option>
            <option value="D" ${status === 'D' ? 'selected' : ''}>Dispen</option>
        </select>
        <button type="button" onclick="window.removeSiswaAbsenRowEdit(this)" class="p-1 text-rose-500 hover:text-rose-700 cursor-pointer" title="Hapus">
            <i class="fa-solid fa-trash-can"></i>
        </button>
    `;
    container.appendChild(row);
};

window.removeSiswaAbsenRowEdit = function (btn) {
    const row = btn.closest('.siswa-absen-row');
    if (row) row.remove();
    const container = document.getElementById('edit-jurnal-presensi-list');
    if (container && container.querySelectorAll('.siswa-absen-row').length === 0) {
        container.innerHTML = `
            <div id="empty-presensi-msg" class="p-3 text-center text-slate-400 italic text-[11px]">
                Semua siswa hadir (tidak ada catatan ketidakhadiran).
            </div>
        `;
    }
};

window.openEditJurnalAdmin = async function (index) {
    const item = currentRekapData[index];
    if (!item) return;

    const modal = document.getElementById('modal-edit-jurnal-admin');
    if (!modal) return;

    document.getElementById('edit-jurnal-id').value = item.id || '';
    document.getElementById('edit-jurnal-tanggal').value = item.tanggal || currentRekapDate;
    document.getElementById('edit-jurnal-topik').value = item.topik || '';
    document.getElementById('edit-jurnal-catatan').value = item.catatan || '';

    const selectedJps = parseJpList(item.jp);
    await populateEditJurnalDropdowns(item.kelas, item.guru, item.mapel, item.lokasi_mengajar, selectedJps);
    renderPresensiEditList(Array.isArray(item.presensi_detail) ? item.presensi_detail : []);

    modal.classList.remove('hidden');
};

window.openCreateJurnalForSlot = async function (kelas, guru, mapel, jpCsv) {
    const modal = document.getElementById('modal-edit-jurnal-admin');
    if (!modal) return;

    document.getElementById('edit-jurnal-id').value = '';
    document.getElementById('edit-jurnal-tanggal').value = currentRekapDate;
    document.getElementById('edit-jurnal-topik').value = '';
    document.getElementById('edit-jurnal-catatan').value = '';

    const selectedJps = (jpCsv || '').split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
    await populateEditJurnalDropdowns(kelas, guru, mapel, 'Ruang Kelas', selectedJps);
    renderPresensiEditList([]);

    modal.classList.remove('hidden');
};

window.closeModalEditJurnal = function () {
    document.getElementById('modal-edit-jurnal-admin')?.classList.add('hidden');
};

window.saveEditJurnalAdmin = async function (event) {
    event.preventDefault();
    const btnSubmit = document.getElementById('btn-submit-edit-jurnal');
    const id = document.getElementById('edit-jurnal-id')?.value;
    const tanggal = document.getElementById('edit-jurnal-tanggal')?.value;
    const kelas = document.getElementById('edit-jurnal-kelas')?.value;
    const guru = document.getElementById('edit-jurnal-guru')?.value;
    const mapel = document.getElementById('edit-jurnal-mapel')?.value;
    const lokasi = document.getElementById('edit-jurnal-lokasi')?.value || 'Ruang Kelas';
    const topik = document.getElementById('edit-jurnal-topik')?.value?.trim();
    const catatan = document.getElementById('edit-jurnal-catatan')?.value?.trim();

    // Ambil JP terpilih
    const jpCheckboxes = document.querySelectorAll('input[name="edit-jp-checkbox"]:checked');
    const selectedJps = Array.from(jpCheckboxes).map(cb => parseInt(cb.value, 10)).filter(Boolean).sort((a, b) => a - b);

    if (selectedJps.length === 0) {
        showToast('Pilih minimal 1 Jam Pelajaran (JP).', 'warning');
        return;
    }
    if (!kelas || !guru || !mapel || !topik) {
        showToast('Mohon lengkapi seluruh field bertanda bintang (*).', 'warning');
        return;
    }

    // Ambil rincian siswa tidak hadir
    const absenRows = document.querySelectorAll('.siswa-absen-row');
    const presensiDetail = [];
    absenRows.forEach(row => {
        const nama = row.querySelector('.input-absen-nama')?.value?.trim();
        const nis = row.querySelector('.input-absen-nis')?.value?.trim() || '';
        const status = row.querySelector('.input-absen-status')?.value || 'S';
        if (nama) {
            presensiDetail.push({ nama, nis, status });
        }
    });

    const isEdit = Boolean(id);
    const payload = {
        tanggal,
        kelas,
        guru,
        mapel,
        lokasi_mengajar: lokasi,
        topik,
        catatan,
        jp: selectedJps,
        presensi_detail: presensiDetail,
        force_submit: true
    };
    if (isEdit) payload.id = id;

    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    }

    try {
        await cfClient.saveJurnalEntry(payload, isEdit, isEdit ? id : null);
        window.closeModalEditJurnal();
        showToast(isEdit ? 'Jurnal mengajar berhasil diperbarui.' : 'Jurnal mengajar berhasil ditambahkan.', 'success');
        await window.loadRekapJurnal(true);
    } catch (err) {
        console.error('[Admin Jurnal] Gagal menyimpan jurnal:', err);
        showToast('Gagal menyimpan jurnal: ' + err.message, 'error');
    } finally {
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = '<i class="fa-solid fa-save"></i> Simpan Perubahan';
        }
    }
};

window.confirmDeleteJurnal = async function (index) {
    const item = currentRekapData[index];
    if (!item) return;

    const result = await Swal.fire({
        icon: 'warning',
        title: 'Hapus Jurnal Mengajar?',
        html: `
            <p class="text-xs text-slate-600 dark:text-slate-300 mb-2">
                Apakah Anda yakin ingin menghapus entri jurnal ini secara permanen?
            </p>
            <div class="p-3 bg-rose-50 dark:bg-rose-950/40 rounded-xl border border-rose-200 dark:border-rose-900 text-left text-xs space-y-1 text-slate-800 dark:text-slate-200">
                <div><span class="text-slate-400">Kelas:</span> <strong>${escapeHTML(item.kelas || '-')}</strong></div>
                <div><span class="text-slate-400">Guru:</span> <strong>${escapeHTML(item.guru || '-')}</strong></div>
                <div><span class="text-slate-400">Mapel:</span> <strong>${escapeHTML(item.mapel || '-')}</strong></div>
                <div><span class="text-slate-400">JP:</span> <strong>${escapeHTML(formatJpDisplay(item.jp))}</strong></div>
            </div>
            <p class="text-[11px] text-rose-600 dark:text-rose-400 mt-2 font-semibold">
                Tindakan ini tidak dapat dibatalkan.
            </p>
        `,
        showCancelButton: true,
        confirmButtonText: 'Ya, Hapus Jurnal',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        customClass: { popup: 'rounded-2xl dark:bg-slate-800 dark:text-white' }
    });

    if (!result.isConfirmed) return;

    try {
        showToast('Menghapus jurnal...', 'info');
        await cfClient.deleteJurnalEntry(item.id);
        showToast('Jurnal mengajar berhasil dihapus.', 'success');
        await window.loadRekapJurnal(true);
    } catch (err) {
        console.error('[Admin Jurnal] Gagal menghapus jurnal:', err);
        showToast('Gagal menghapus jurnal: ' + err.message, 'error');
    }
};

window.showJurnalRowDetail = function (index) {
    const item = currentRekapData[index];
    if (!item) return;

    const jpDisplay = formatJpDisplay(item.jp);
    const presensi = Array.isArray(item.presensi_detail) ? item.presensi_detail : [];
    let presensiInfo = '<span class="text-emerald-600 font-bold">Semua siswa hadir lengkap</span>';
    if (presensi.length > 0) {
        presensiInfo = `<ul class="text-left mt-1 space-y-1 list-disc list-inside text-xs">` +
            presensi.map(p => `<li><strong>${escapeHTML(p.nama)}</strong> (${escapeHTML(p.status)}) ${p.nis ? `<span class="text-slate-400">NIS: ${escapeHTML(p.nis)}</span>` : ''}</li>`).join('') +
            `</ul>`;
    }

    const canModify = canUserModifyJurnal(item);
    let actionButtonsHtml = '';
    if (canModify) {
        actionButtonsHtml = `
            <div class="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
                <button type="button" id="swal-btn-delete-jurnal" class="px-3.5 py-2 text-xs font-bold rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 dark:text-rose-400 border border-rose-200 dark:border-rose-800 transition flex items-center gap-1.5 cursor-pointer">
                    <i class="fa-solid fa-trash-can"></i> Hapus Jurnal
                </button>
                <button type="button" id="swal-btn-edit-jurnal" class="px-4 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition flex items-center gap-1.5 shadow-xs cursor-pointer">
                    <i class="fa-solid fa-pen-to-square"></i> Edit Jurnal
                </button>
            </div>
        `;
    }

    Swal.fire({
        title: `Rincian Jurnal KBM`,
        html: `
            <div class="text-left text-xs space-y-3 pt-2">
                <div class="grid grid-cols-2 gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                    <div><span class="text-slate-400 block">Kelas:</span><strong class="text-slate-800 dark:text-slate-100">${escapeHTML(item.kelas || '-')}</strong></div>
                    <div><span class="text-slate-400 block">Jam (JP):</span><strong class="text-blue-600 font-mono">${escapeHTML(jpDisplay)}</strong></div>
                    <div><span class="text-slate-400 block">Guru:</span><strong class="text-slate-800 dark:text-slate-100">${escapeHTML(item.guru || '-')}</strong></div>
                    <div><span class="text-slate-400 block">Mata Pelajaran:</span><strong class="text-slate-800 dark:text-slate-100">${escapeHTML(item.mapel || '-')}</strong></div>
                    <div class="col-span-2"><span class="text-slate-400 block">Lokasi:</span><strong class="text-slate-800 dark:text-slate-100">${escapeHTML(item.lokasi_mengajar || 'Ruang Kelas')}</strong></div>
                </div>
                <div>
                    <span class="font-bold text-slate-700 dark:text-slate-300 block mb-1">Materi / Topik KBM:</span>
                    <div class="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-slate-800 dark:text-slate-200 leading-relaxed">${escapeHTML(item.topik || '-')}</div>
                </div>
                ${item.catatan ? `
                    <div>
                        <span class="font-bold text-slate-700 dark:text-slate-300 block mb-1">Catatan / Refleksi:</span>
                        <div class="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 italic leading-relaxed">"${escapeHTML(item.catatan)}"</div>
                    </div>
                ` : ''}
                <div>
                    <span class="font-bold text-slate-700 dark:text-slate-300 block mb-1">Siswa Tidak Hadir:</span>
                    <div class="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/80">${presensiInfo}</div>
                </div>
                ${item.foto_url ? `
                    <div class="pt-2 text-center">
                        <img src="${escapeHTML(item.foto_url)}" alt="Foto KBM" class="max-h-48 rounded-xl mx-auto border border-slate-200 dark:border-slate-700 shadow-xs object-cover" onerror="this.style.display='none'">
                    </div>
                ` : ''}
                <div class="text-[10px] text-slate-400 pt-1 text-right">
                    Waktu input: ${escapeHTML(item.created_at || '-')}
                </div>
                ${actionButtonsHtml}
            </div>
        `,
        confirmButtonText: 'Tutup',
        confirmButtonColor: '#64748b',
        customClass: {
            popup: 'rounded-2xl dark:bg-slate-800 dark:text-white'
        },
        didOpen: () => {
            const btnDelete = document.getElementById('swal-btn-delete-jurnal');
            const btnEdit = document.getElementById('swal-btn-edit-jurnal');
            if (btnDelete) {
                btnDelete.addEventListener('click', () => {
                    Swal.close();
                    window.confirmDeleteJurnal(index);
                });
            }
            if (btnEdit) {
                btnEdit.addEventListener('click', () => {
                    Swal.close();
                    window.openEditJurnalAdmin(index);
                });
            }
        }
    });
};

function getJurnalExportSnapshot() {
    if (isJurnalExporting) return null;
    if (isRekapLoading || loadedRekapDate !== currentRekapDate) {
        showToast('Tunggu sampai rekap tanggal terpilih selesai dimuat. Jika gagal, klik Refresh.', 'warning');
        return null;
    }
    const report = createJurnalReport({
        rows: currentRekapStatus === 'UNFILLED' ? currentUnfilledData : currentRekapData,
        date: currentRekapDate, kelas: currentRekapClass, status: currentRekapStatus, search: currentRekapSearch,
        school: { ...SCHOOL_CONFIG, kopUrl: schoolAssetUrl(SCHOOL_CONFIG.kopPath) },
        baseUrl: window.location.href, resolvePhoto: resolvePhotoUrl
    });
    if (!report.entries.length) {
        showToast('Tidak ada data yang sesuai filter aktif untuk diekspor.', 'warning');
        return null;
    }
    return report;
}

function setJurnalExportBusy(busy, message) {
    isJurnalExporting = busy;
    ['btn-export-jurnal-excel', 'btn-export-jurnal-pdf'].forEach(id => {
        const button = document.getElementById(id);
        if (!button) return;
        button.disabled = busy;
        button.setAttribute('aria-busy', String(busy));
        button.style.opacity = busy ? '0.6' : '';
    });
    const status = document.getElementById('jurnal-export-status');
    if (status) status.textContent = message;
}

window.exportRekapJurnalExcel = async function () {
    const report = getJurnalExportSnapshot();
    if (!report) return;
    setJurnalExportBusy(true, `Menyiapkan Excel untuk ${report.entries.length} entri...`);
    try {
        if (!window.XLSX) throw new Error('Library Excel belum siap. Silakan muat ulang halaman.');
        const workbook = buildJurnalWorkbook(window.XLSX, report);
        await window.XLSX.writeFile(workbook, `${report.filename}.xlsx`, { compression: true });
        showToast(`Excel berisi ${report.entries.length} entri dan ${report.totals.evidence} tautan bukti berhasil diunduh.`, 'success');
    } catch (error) {
        console.error('[Admin Jurnal] Ekspor Excel:', error);
        showToast('Gagal ekspor Excel: ' + error.message, 'error');
    } finally {
        setJurnalExportBusy(false, 'Ekspor mengikuti filter aktif. Excel memuat tautan bukti; PDF memuat 10 jurnal per halaman dengan kop, foto, dan caption.');
    }
};

window.exportRekapJurnalPDF = async function () {
    const report = getJurnalExportSnapshot();
    if (!report) return;
    const controller = new AbortController();
    setJurnalExportBusy(true, `Menyiapkan PDF untuk ${report.entries.length} entri...`);
    Swal.fire({
        title: 'Menyusun laporan PDF',
        html: '<p id="jurnal-pdf-progress" role="status" aria-live="polite">Menyiapkan kop resmi sekolah...</p><progress id="jurnal-pdf-meter" max="100" value="0" style="width:100%;margin-top:16px;accent-color:#087f82"></progress><p style="font-size:12px;margin-top:12px">Foto diproses bertahap. Bukti yang gagal dimuat tetap disertai tautan aslinya.</p>',
        showConfirmButton: false, showCancelButton: true, cancelButtonText: 'Batalkan',
        allowOutsideClick: false, allowEscapeKey: false
    }).then(result => { if (result.dismiss === Swal.DismissReason.cancel) controller.abort(); });
    try {
        const jsPDF = await loadJurnalPdfLibrary({ signal: controller.signal });
        const { pdf, failed, pages } = await buildJurnalPdf(report, {
            jsPDF, signal: controller.signal,
            onProgress: progress => {
                const message = progress.phase === 'kop' ? 'Memuat kop resmi sekolah...' :
                    `Menyusun ${progress.done}/${progress.total} jurnal${progress.failed ? ` · ${progress.failed} bukti memakai tautan` : ''}...`;
                const label = document.getElementById('jurnal-pdf-progress');
                const meter = document.getElementById('jurnal-pdf-meter');
                if (label) label.textContent = message;
                if (meter) meter.value = Math.round(progress.done / progress.total * 100);
                const status = document.getElementById('jurnal-export-status');
                if (status) status.textContent = message;
            }
        });
        if (controller.signal.aborted) throw new DOMException('Ekspor dibatalkan.', 'AbortError');
        Swal.close();
        await pdf.save(`${report.filename}.pdf`, { returnPromise: true });
        showToast(`PDF ${pages} halaman berhasil diunduh.${failed ? ` ${failed} bukti tidak dapat dimuat; tautan asli tersedia pada laporan.` : ''}`, failed ? 'warning' : 'success');
    } catch (error) {
        Swal.close();
        if (error.name === 'AbortError') showToast('Ekspor PDF dibatalkan.', 'info');
        else {
            console.error('[Admin Jurnal] Ekspor PDF:', error);
            showToast('Gagal ekspor PDF: ' + error.message, 'error');
        }
    } finally {
        setJurnalExportBusy(false, 'Ekspor mengikuti filter aktif. Excel memuat tautan bukti; PDF memuat 10 jurnal per halaman dengan kop, foto, dan caption.');
    }
};

// --- TAB 2: DATA LOKASI ---
function renderLokasiTable() {
    const tbody = document.getElementById('table-lokasi-body');
    if (!tbody) return;

    const lokasis = currentMasterData.lokasis || [];
    if (lokasis.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-slate-400">Belum ada data lokasi.</td></tr>`;
        return;
    }

    tbody.innerHTML = lokasis.map((l) => `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
            <td class="p-3 text-center font-bold text-slate-500">${l.urutan || 1}</td>
            <td class="p-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">${escapeHTML(l.id || '-')}</td>
            <td class="p-3 font-bold text-slate-900 dark:text-white">${escapeHTML(l.nama_lokasi || '-')}</td>
            <td class="p-3 text-center">
                <div class="flex items-center justify-center gap-1.5">
                    <button onclick="window.editLokasi('${escapeHTML(l.id)}', '${escapeHTML(l.nama_lokasi)}', ${l.urutan || 1})" class="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/40 text-blue-600 hover:bg-blue-100 transition" title="Edit Lokasi">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button onclick="window.deleteLokasi('${escapeHTML(l.id)}', '${escapeHTML(l.nama_lokasi)}')" class="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-900/40 text-rose-600 hover:bg-rose-100 transition" title="Hapus Lokasi">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

window.openModalLokasi = function (id = '', nama = '', urutan = 1) {
    const modal = document.getElementById('modal-lokasi');
    const inputId = document.getElementById('input-lokasi-id');
    const inputNama = document.getElementById('input-lokasi-nama');
    const inputUrutan = document.getElementById('input-lokasi-urutan');
    const modalTitle = document.getElementById('modal-lokasi-title');

    if (inputId) inputId.value = id;
    if (inputNama) inputNama.value = nama;
    if (inputUrutan) inputUrutan.value = urutan;
    if (modalTitle) modalTitle.innerText = id ? 'Edit Lokasi' : 'Tambah Lokasi';

    modal?.classList.remove('hidden');
    inputNama?.focus();
};

window.closeModalLokasi = function () {
    document.getElementById('modal-lokasi')?.classList.add('hidden');
};

window.editLokasi = function (id, nama, urutan) {
    window.openModalLokasi(id, nama, urutan);
};

window.saveLokasiForm = async function (e) {
    e.preventDefault();
    const id = document.getElementById('input-lokasi-id').value.trim();
    const nama = document.getElementById('input-lokasi-nama').value.trim();
    const urutan = parseInt(document.getElementById('input-lokasi-urutan').value, 10) || 1;
    if (!nama) return;

    const lokasiId = id || nama.toLowerCase().replace(/[^a-z0-9]/g, '_');

    try {
        await cfClient.syncJurnalMaster({
            lokasis: [{ id: lokasiId, nama_lokasi: nama, urutan }]
        });
        window.closeModalLokasi();
        showToast('Lokasi berhasil disimpan.', 'success');
        await loadMasterData();
    } catch (err) {
        showToast('Gagal menyimpan lokasi: ' + err.message, 'error');
    }
};

window.deleteLokasi = async function (id, nama) {
    const confirm = await Swal.fire({
        title: 'Hapus Lokasi?',
        text: `Apakah Anda yakin ingin menghapus lokasi "${nama}"?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Ya, Hapus'
    });

    if (!confirm.isConfirmed) return;

    try {
        await cfClient.deleteJurnalLokasi(id);
        showToast('Lokasi berhasil dihapus.', 'success');
        await loadMasterData();
    } catch (err) {
        showToast('Gagal menghapus lokasi: ' + err.message, 'error');
    }
};

// --- TAB: QR CODE KELAS TERPADU (SELURUH KELAS AKTIF) ---
let currentQrItems = [];

window.renderAllClassQrCodes = function () {
    const grid = document.getElementById('qr-grid-all-classes');
    if (!grid) return;

    const rawClasses = currentMasterData.classes || [];
    if (rawClasses.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full text-center py-16 text-slate-400">
                <i class="fa-solid fa-chalkboard text-4xl mb-3 text-slate-300 dark:text-slate-600 block"></i>
                <p class="font-bold text-sm text-slate-600 dark:text-slate-300">Belum ada data kelas aktif</p>
                <p class="text-xs text-slate-400 mt-1">Pastikan data kelas telah tersedia di Master Siswa Dapodik / Cloudflare D1.</p>
            </div>
        `;
        return;
    }

    const sortedClasses = rawClasses.slice().sort(naturalSort);

    currentQrItems = [];
    let cardsHtml = '';
    const baseUrl = (window.location.origin && window.location.origin.startsWith('http')) 
        ? `${window.location.origin}/jurnal.html` 
        : "https://simas-demo-5ead3.web.app/jurnal.html";

    sortedClasses.forEach((cls, index) => {
        const salt1 = Math.random().toString(36).substring(2, 10);
        const salt2 = Math.random().toString(36).substring(2, 10);
        // Metode encode warisan SSOT: salt1|nama_kelas|salt2 di-encode Base64
        const customId = btoa(`${salt1}|${cls}|${salt2}`);
        const fullUrl = `${baseUrl}?c=${encodeURIComponent(customId)}`;
        const containerId = `qrcode-box-${index}`;

        currentQrItems.push({
            index,
            cls,
            customId,
            fullUrl,
            containerId
        });

        // Deteksi tingkat (X, XI, XII)
        let tingkat = 'X';
        const uCls = cls.toUpperCase();
        if (uCls.startsWith('XII') || uCls.includes('12')) tingkat = 'XII';
        else if (uCls.startsWith('XI') || uCls.includes('11')) tingkat = 'XI';

        cardsHtml += `
            <div class="qr-class-card bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs hover:shadow-md transition flex flex-col items-center text-center p-4 group"
                 data-class="${escapeHTML(cls)}" data-tingkat="${tingkat}" id="qr-card-item-${index}">
                
                <!-- HEADER KARTU -->
                <div class="w-full flex items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                    <div class="flex items-center gap-1.5">
                        <img src="assets/logo-sekolah.png" alt="Logo" class="w-5 h-5 object-contain">
                        <span class="text-[10px] font-black text-slate-500 tracking-wider">SMANTARA</span>
                    </div>
                    <span class="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/80">
                        KELAS ${escapeHTML(cls)}
                    </span>
                </div>

                <!-- QR CANVAS CONTAINER (PRINT TARGET) -->
                <div class="w-full bg-white p-3 rounded-xl border border-slate-200/80 shadow-inner flex flex-col items-center justify-center mb-3">
                    <div id="${containerId}" class="min-h-[140px] min-w-[140px] flex items-center justify-center"></div>
                    <div class="mt-2 text-center text-slate-900">
                        <h4 class="font-black text-[11px] tracking-wider uppercase text-blue-950">${SCHOOL_CONFIG.schoolNameUpper}</h4>
                        <p class="text-[9px] text-slate-500 font-bold">JURNAL MENGAJAR • ${escapeHTML(cls)}</p>
                    </div>
                </div>

                <!-- TOMBOL AKSI 1 BARIS -->
                <div class="w-full grid grid-cols-3 gap-1.5 mt-auto">
                    <a href="${fullUrl}" target="_blank" title="Buka Form Kelas"
                        class="px-2 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-600 dark:text-blue-400 text-[11px] font-bold transition flex items-center justify-center gap-1">
                        <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i> Buka
                    </a>
                    <button onclick="window.cetakQRSatuan(${index})" title="Cetak Kartu QR"
                        class="px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-bold transition flex items-center justify-center gap-1">
                        <i class="fa-solid fa-print text-[9px]"></i> Cetak
                    </button>
                    <button onclick="window.downloadQRSatuan(${index})" title="Unduh Gambar PNG"
                        class="px-2 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/80 text-slate-600 dark:text-slate-300 text-[11px] font-bold transition flex items-center justify-center gap-1">
                        <i class="fa-solid fa-download text-[9px]"></i> Unduh
                    </button>
                </div>
            </div>
        `;
    });

    grid.innerHTML = cardsHtml;

    // Render QRCode instances via EasyQRCodeJS with embedded school logo
    sortedClasses.forEach((cls, index) => {
        const item = currentQrItems[index];
        if (!item) return;

        setTimeout(() => {
            const container = document.getElementById(item.containerId);
            if (!container) return;
            container.innerHTML = '';

            if (typeof QRCode !== 'undefined') {
                try {
                    new QRCode(container, {
                        text: item.fullUrl,
                        width: 145,
                        height: 145,
                        colorDark: "#0f172a",
                        colorLight: "#ffffff",
                        correctLevel: QRCode.CorrectLevel.H,
                        logo: "assets/logo-sekolah.png",
                        logoWidth: 38,
                        logoHeight: 38,
                        logoBackgroundColor: '#ffffff',
                        logoBackgroundTransparent: false
                    });
                } catch (e) {
                    console.warn(`[QR Generator] Error rendering QR for class ${cls}:`, e);
                }
            } else {
                container.innerHTML = `<p class="text-[10px] text-rose-500 font-bold">Pustaka QR belum siap.</p>`;
            }
        }, 50 + (index * 30));
    });
};

// Cetak Massal Seluruh Kartu QR Kelas (Format Siap Cetak A4 / Stiker - Grid 3 Kolom)
window.cetakQRMassal = function () {
    const grid = document.getElementById('qr-grid-all-classes');
    if (!grid || currentQrItems.length === 0) {
        showToast('Tidak ada data kelas yang dapat dicetak.', 'warning');
        return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        Swal.fire({ icon: 'error', title: 'Pop-up Diblokir', text: 'Izinkan pop-up browser untuk mencetak kartu QR.' });
        return;
    }

    const visibleCards = Array.from(grid.querySelectorAll('.qr-class-card')).filter(c => !c.classList.contains('hidden'));
    if (visibleCards.length === 0) {
        showToast('Tidak ada kartu kelas yang cocok dengan filter saat ini.', 'warning');
        printWindow.close();
        return;
    }

    const cardItemsHtml = visibleCards.map(card => {
        const cls = card.getAttribute('data-class') || '';
        const canvas = card.querySelector('canvas');
        let imgDataUrl = '';
        if (canvas) {
            try {
                imgDataUrl = canvas.toDataURL('image/png');
            } catch (e) {
                console.warn('Canvas toDataURL failed:', e);
            }
        }

        return `
            <div class="qr-print-box">
                <div class="box-top">
                    <img src="${schoolAssetUrl(SCHOOL_CONFIG.logoPath)}" alt="Logo ${SCHOOL_CONFIG.schoolShortName}" class="logo-top">
                    <div class="school-text">
                        <div class="school-name">${SCHOOL_CONFIG.schoolNameUpper}</div>
                        <div class="school-sub">JURNAL MENGAJAR DIGITAL</div>
                    </div>
                </div>
                <div class="qr-img-wrapper">
                    ${imgDataUrl ? `<img src="${imgDataUrl}" class="qr-img" alt="QR Kelas ${cls}">` : `<div style="padding:15px;">QR Code Kelas ${cls}</div>`}
                </div>
                <div class="class-badge">KELAS ${cls}</div>
            </div>
        `;
    });

    // Chunking: 9 kartu per halaman A4 (Grid 3 Kolom x 3 Baris, hemat kertas & proporsional)
    const chunkSize = 9;
    let pagesHtml = '';

    for (let i = 0; i < cardItemsHtml.length; i += chunkSize) {
        const chunk = cardItemsHtml.slice(i, i + chunkSize);
        pagesHtml += `
            <div class="print-page">
                <div class="page-header">
                    <h2>KARTU QR CODE JURNAL KELAS • ${SCHOOL_CONFIG.schoolNameUpper}</h2>
                    <p>Format Grid 3 Kolom (3 Kolom x 3 Baris / 9 Kelas per Lembar A4). Tempelkan kartu ini pada meja atau dinding kelas.</p>
                </div>
                <div class="print-grid">
                    ${chunk.join('')}
                </div>
            </div>
        `;
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Cetak QR Code Jurnal Kelas - SMANTARA</title>
            <style>
                @page { size: A4 portrait; margin: 8mm; }
                * { box-sizing: border-box; }
                body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #0f172a; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .print-page { page-break-after: always; break-after: page; padding-bottom: 4px; }
                .print-page:last-child { page-break-after: avoid; break-after: auto; }
                .page-header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 4px; margin-bottom: 10px; }
                .page-header h2 { font-size: 13px; font-weight: 800; margin: 0; letter-spacing: 0.5px; color: #0f172a; }
                .page-header p { font-size: 9px; color: #475569; margin: 2px 0 0 0; }
                .print-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 10px; }
                .qr-print-box { border: 2px dashed #334155; border-radius: 14px; padding: 12px 8px; text-align: center; background: #ffffff; display: flex; flex-direction: column; align-items: center; justify-content: space-between; box-sizing: border-box; min-height: 275px; }
                .box-top { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 4px; }
                .logo-top { width: 28px; height: 28px; object-fit: contain; }
                .school-text { text-align: left; }
                .school-name { font-size: 10px; font-weight: 900; color: #1e3a8a; line-height: 1.15; }
                .school-sub { font-size: 7.5px; font-weight: 700; color: #64748b; letter-spacing: 0.3px; }
                .qr-img-wrapper { margin: 6px 0; padding: 5px; border: 1.5px solid #cbd5e1; border-radius: 10px; background: #fff; display: inline-flex; align-items: center; justify-content: center; }
                .qr-img { width: 145px; height: 145px; display: block; margin: 0 auto; }
                .class-badge { font-size: 12.5px; font-weight: 900; color: #1e3a8a; background: #eff6ff; border: 1.5px solid #93c5fd; border-radius: 9999px; padding: 3px 16px; margin-top: 4px; display: inline-block; letter-spacing: 0.5px; }
            </style>
        </head>
        <body onload="window.print(); window.setTimeout(window.close, 600);">
            ${pagesHtml}
        </body>
        </html>
    `);
    printWindow.document.close();
};

// Cetak Satuan Kartu QR Kelas (Format 3 Kartu Berdampingan / Grid 3 Kolom per Lembar A4)
window.cetakQRSatuan = function (index) {
    const item = currentQrItems[index];
    if (!item) return;

    const container = document.getElementById(item.containerId);
    const canvas = container ? container.querySelector('canvas') : null;
    let imgDataUrl = '';
    if (canvas) {
        try {
            imgDataUrl = canvas.toDataURL('image/png');
        } catch (e) {
            console.warn('Canvas toDataURL failed:', e);
        }
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        Swal.fire({ icon: 'error', title: 'Pop-up Diblokir', text: 'Izinkan pop-up browser untuk mencetak kartu QR.' });
        return;
    }

    // Buat 3 kartu identik untuk 1 kelas dalam 1 baris (Grid 3 Kolom A4: Meja Guru, Dinding Kelas, Cadangan/Arsip)
    const cardSlots = [
        { label: 'MEJA GURU / PIKET' },
        { label: 'DINDING / PAPAN KELAS' },
        { label: 'CADANGAN / ARSIP' }
    ];

    const cardsHtml = cardSlots.map(slot => `
        <div class="qr-print-box">
            <div class="target-label">${slot.label}</div>
            <div class="box-top">
                <img src="${schoolAssetUrl(SCHOOL_CONFIG.logoPath)}" alt="Logo ${SCHOOL_CONFIG.schoolShortName}" class="logo-top">
                <div class="school-text">
                    <div class="school-name">${SCHOOL_CONFIG.schoolNameUpper}</div>
                    <div class="school-sub">JURNAL MENGAJAR DIGITAL</div>
                </div>
            </div>
            <div class="qr-img-wrapper">
                ${imgDataUrl ? `<img src="${imgDataUrl}" class="qr-img" alt="QR Kelas ${item.cls}">` : `<div style="padding:20px;">QR Code Kelas ${item.cls}</div>`}
            </div>
            <div class="class-badge">KELAS ${item.cls}</div>
        </div>
    `).join('');

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Cetak QR Kelas ${item.cls} - SMANTARA</title>
            <style>
                @page { size: A4 portrait; margin: 8mm; }
                * { box-sizing: border-box; }
                body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #0f172a; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .page-header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 4px; margin-bottom: 10px; }
                .page-header h2 { font-size: 13px; font-weight: 800; margin: 0; letter-spacing: 0.5px; color: #0f172a; }
                .page-header p { font-size: 9px; color: #475569; margin: 2px 0 0 0; }
                .print-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 10px; }
                .qr-print-box { border: 2px dashed #334155; border-radius: 14px; padding: 12px 8px; text-align: center; background: #ffffff; display: flex; flex-direction: column; align-items: center; justify-content: space-between; box-sizing: border-box; min-height: 275px; }
                .target-label { font-size: 8px; font-weight: 800; color: #475569; background: #f1f5f9; border-radius: 4px; padding: 2px 8px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
                .box-top { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 4px; }
                .logo-top { width: 28px; height: 28px; object-fit: contain; }
                .school-text { text-align: left; }
                .school-name { font-size: 10px; font-weight: 900; color: #1e3a8a; line-height: 1.15; }
                .school-sub { font-size: 7.5px; font-weight: 700; color: #64748b; letter-spacing: 0.3px; }
                .qr-img-wrapper { margin: 6px 0; padding: 5px; border: 1.5px solid #cbd5e1; border-radius: 10px; background: #fff; display: inline-flex; align-items: center; justify-content: center; }
                .qr-img { width: 145px; height: 145px; display: block; margin: 0 auto; }
                .class-badge { font-size: 12.5px; font-weight: 900; color: #1e3a8a; background: #eff6ff; border: 1.5px solid #93c5fd; border-radius: 9999px; padding: 3px 16px; margin-top: 4px; display: inline-block; letter-spacing: 0.5px; }
                .cut-guide { margin-top: 20px; padding-top: 10px; border-top: 1.5px dashed #94a3b8; text-align: center; font-size: 8.5px; color: #64748b; font-weight: 600; letter-spacing: 0.3px; }
            </style>
        </head>
        <body onload="window.print(); window.setTimeout(window.close, 600);">
            <div class="page-header">
                <h2>KARTU QR CODE JURNAL KELAS ${item.cls} • ${SCHOOL_CONFIG.schoolNameUpper}</h2>
                <p>Format Strip 3 Kartu: 1 untuk Meja Guru/Piket, 1 untuk Dinding/Papan Kelas, dan 1 untuk Cadangan.</p>
            </div>
            <div class="print-grid">
                ${cardsHtml}
            </div>
            <div class="cut-guide">✂ Potong sepanjang garis putus-putus. Sisa kertas A4 bagian bawah dapat digunakan kembali.</div>
        </body>
        </html>
    `);
    printWindow.document.close();
};

// Unduh Gambar Kartu QR Satuan (Format PNG High Quality dengan Desain Kartu Utuh)
window.downloadQRSatuan = async function (index) {
    const item = currentQrItems[index];
    if (!item) return;

    const container = document.getElementById(item.containerId);
    const qrCanvas = container ? container.querySelector('canvas') : null;
    if (!qrCanvas) {
        showToast('Gambar QR sedang diproses, silakan tunggu sebentar.', 'warning');
        return;
    }

    try {
        const cardWidth = 600;
        const cardHeight = 820;
        const outCanvas = document.createElement('canvas');
        outCanvas.width = cardWidth;
        outCanvas.height = cardHeight;
        const ctx = outCanvas.getContext('2d');

        // 1. Background Putih
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cardWidth, cardHeight);

        // Helper fungsi rounded rect
        function drawRoundedRect(x, y, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r);
            ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
        }

        // Bingkai Luar Kartu (Navy Solid)
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#1e3a8a';
        drawRoundedRect(20, 20, cardWidth - 40, cardHeight - 40, 24);
        ctx.stroke();

        // 2. Load & Gambar Logo Sekolah
        const logoImg = new Image();
        logoImg.crossOrigin = 'anonymous';
        logoImg.src = 'assets/logo-sekolah.png';

        await new Promise((resolve) => {
            logoImg.onload = () => resolve();
            logoImg.onerror = () => resolve();
            setTimeout(resolve, 500);
        });

        const logoSize = 64;
        const headerY = 55;
        let textStartX = 50;

        if (logoImg.complete && logoImg.naturalWidth > 0) {
            ctx.font = 'bold 24px "Segoe UI", Arial, sans-serif';
            const nameWidth = ctx.measureText(SCHOOL_CONFIG.schoolNameUpper).width;
            const totalHeaderWidth = logoSize + 16 + nameWidth;
            const headerStartX = (cardWidth - totalHeaderWidth) / 2;

            ctx.drawImage(logoImg, headerStartX, headerY, logoSize, logoSize);
            textStartX = headerStartX + logoSize + 16;
            
            ctx.textAlign = 'left';
            ctx.fillStyle = '#1e3a8a';
            ctx.font = '900 24px "Segoe UI", Arial, sans-serif';
            ctx.fillText(SCHOOL_CONFIG.schoolNameUpper, textStartX, headerY + 30);

            ctx.fillStyle = '#64748b';
            ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif';
            ctx.fillText('JURNAL MENGAJAR DIGITAL', textStartX, headerY + 54);
        } else {
            ctx.textAlign = 'center';
            ctx.fillStyle = '#1e3a8a';
            ctx.font = '900 26px "Segoe UI", Arial, sans-serif';
            ctx.fillText(SCHOOL_CONFIG.schoolNameUpper, cardWidth / 2, headerY + 30);

            ctx.fillStyle = '#64748b';
            ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
            ctx.fillText('JURNAL MENGAJAR DIGITAL', cardWidth / 2, headerY + 56);
        }

        // Garis Pembatas Header
        ctx.beginPath();
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2;
        ctx.moveTo(50, 145);
        ctx.lineTo(cardWidth - 50, 145);
        ctx.stroke();

        // 3. Bingkai QR Code & Gambar QR Code
        const qrBoxSize = 420;
        const qrBoxX = (cardWidth - qrBoxSize) / 2;
        const qrBoxY = 175;

        ctx.lineWidth = 2;
        ctx.strokeStyle = '#cbd5e1';
        drawRoundedRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 20);
        ctx.stroke();

        // Gambar QR Code dari Canvas
        const qrInnerPadding = 20;
        ctx.drawImage(qrCanvas, qrBoxX + qrInnerPadding, qrBoxY + qrInnerPadding, qrBoxSize - (qrInnerPadding * 2), qrBoxSize - (qrInnerPadding * 2));

        // 4. Badge Kelas (Pill Style)
        const badgeWidth = 280;
        const badgeHeight = 56;
        const badgeX = (cardWidth - badgeWidth) / 2;
        const badgeY = 635;

        // Background Pill
        ctx.fillStyle = '#eff6ff';
        drawRoundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 28);
        ctx.fill();

        // Border Pill
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#93c5fd';
        drawRoundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 28);
        ctx.stroke();

        // Teks Badge Kelas
        ctx.textAlign = 'center';
        ctx.fillStyle = '#1e3a8a';
        ctx.font = '900 24px "Segoe UI", Arial, sans-serif';
        ctx.fillText(`KELAS ${item.cls}`, cardWidth / 2, badgeY + 37);

        // 5. Download PNG
        const dataUrl = outCanvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `Kartu_QR_Jurnal_Kelas_${item.cls.replace(/\s+/g, '_')}.png`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast(`Kartu QR Kelas ${item.cls} berhasil diunduh!`, 'success');
    } catch (e) {
        console.error('Download QR card failed:', e);
        showToast('Gagal mengunduh gambar kartu QR.', 'error');
    }
};

// Salin Link URL QR ke Clipboard
window.salinLinkQR = function (index) {
    const item = currentQrItems[index];
    if (!item) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(item.fullUrl).then(() => {
            showToast(`Tautan QR Kelas ${item.cls} berhasil disalin!`, 'success');
        }).catch(() => {
            fallbackCopy(item.fullUrl, item.cls);
        });
    } else {
        fallbackCopy(item.fullUrl, item.cls);
    }
};

function fallbackCopy(text, cls) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        showToast(`Tautan QR Kelas ${cls} berhasil disalin!`, 'success');
    } catch (e) {
        showToast('Gagal menyalin tautan.', 'error');
    }
    document.body.removeChild(textarea);
}

// --- TAB 7: DATA MOTIVASI ---
function renderMotivasiTable() {
    const tbody = document.getElementById('table-motivasi-body');
    if (!tbody) return;

    const motivasiList = currentMasterData.motivasi || [];
    if (motivasiList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="p-8 text-center text-slate-400">Belum ada kutipan motivasi.</td></tr>`;
        return;
    }

    tbody.innerHTML = motivasiList.map((m, idx) => `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
            <td class="p-3 text-center text-slate-400 font-mono">${idx + 1}</td>
            <td class="p-3 font-semibold text-slate-800 dark:text-slate-200">"${escapeHTML(m)}"</td>
            <td class="p-3 text-center">
                <div class="flex items-center justify-center gap-1.5">
                    <button onclick="window.editMotivasi(${idx})" class="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/40 text-blue-600 hover:bg-blue-100 transition" title="Edit Motivasi">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button onclick="window.deleteMotivasi(${idx})" class="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-900/40 text-rose-600 hover:bg-rose-100 transition" title="Hapus Motivasi">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

window.openModalMotivasi = function (index = -1, teks = '') {
    const modal = document.getElementById('modal-motivasi');
    const inputIdx = document.getElementById('input-motivasi-index');
    const inputTeks = document.getElementById('input-motivasi-teks');
    const modalTitle = document.getElementById('modal-motivasi-title');

    if (inputIdx) inputIdx.value = index;
    if (inputTeks) inputTeks.value = teks;
    if (modalTitle) modalTitle.innerText = index >= 0 ? 'Edit Motivasi' : 'Tambah Motivasi Harian';

    modal?.classList.remove('hidden');
    inputTeks?.focus();
};

window.closeModalMotivasi = function () {
    document.getElementById('modal-motivasi')?.classList.add('hidden');
};

window.editMotivasi = function (idx) {
    const motivasiList = currentMasterData.motivasi || [];
    window.openModalMotivasi(idx, motivasiList[idx] || '');
};

window.saveMotivasiForm = async function (e) {
    e.preventDefault();
    const idx = parseInt(document.getElementById('input-motivasi-index').value, 10);
    const teks = document.getElementById('input-motivasi-teks').value.trim();
    if (!teks) return;

    let motivasiList = [...(currentMasterData.motivasi || [])];
    if (idx >= 0 && idx < motivasiList.length) {
        motivasiList[idx] = teks;
    } else {
        motivasiList.push(teks);
    }

    try {
        await cfClient.saveJurnalSettings({ motivasi: motivasiList });
        window.closeModalMotivasi();
        showToast('Motivasi harian berhasil disimpan.', 'success');
        await loadMasterData();
    } catch (err) {
        showToast('Gagal menyimpan motivasi: ' + err.message, 'error');
    }
};

window.deleteMotivasi = async function (idx) {
    const confirm = await Swal.fire({
        title: 'Hapus Motivasi?',
        text: 'Apakah Anda yakin ingin menghapus kutipan motivasi ini?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Ya, Hapus'
    });

    if (!confirm.isConfirmed) return;

    let motivasiList = [...(currentMasterData.motivasi || [])];
    motivasiList.splice(idx, 1);

    try {
        await cfClient.saveJurnalSettings({ motivasi: motivasiList });
        showToast('Motivasi berhasil dihapus.', 'success');
        await loadMasterData();
    } catch (err) {
        showToast('Gagal menghapus motivasi: ' + err.message, 'error');
    }
};

// --- TAB 8: PENGATURAN & PJJ ---
function populateSettingsForm() {
    const settings = currentMasterData.settings || {};
    const chkDaring = document.getElementById('setting-mode-daring');
    const badgeEl = document.getElementById('badge-status-daring');
    const iconBadge = document.getElementById('icon-daring-badge');

    const isDaring = Boolean(settings.mode_daring !== undefined ? settings.mode_daring : currentMasterData.mode_daring);

    if (chkDaring) chkDaring.checked = isDaring;

    if (badgeEl) {
        if (isDaring) {
            badgeEl.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 animate-pulse";
            badgeEl.textContent = "AKTIF (PJJ/Daring)";
        } else {
            badgeEl.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300";
            badgeEl.textContent = "Non-Aktif (Luring/Normal)";
        }
    }

    if (iconBadge) {
        if (isDaring) {
            iconBadge.className = "p-3 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl shrink-0 mt-0.5 transition-colors";
        } else {
            iconBadge.className = "p-3 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-xl shrink-0 mt-0.5 transition-colors";
        }
    }
}

window.handleToggleModeDaring = async function (isChecked) {
    const toggleEl = document.getElementById('setting-mode-daring');
    const badgeEl = document.getElementById('badge-status-daring');

    const infoText = isChecked
        ? "Guru dapat mengisi jurnal langsung tanpa scan QR kelas, GPS dilewati (bypass), dan bisa memilih foto dari galeri HP/Laptop."
        : "Pengisian jurnal kembali ke mode normal (wajib scan QR kelas & validasi GPS sekolah).";

    const result = await Swal.fire({
        title: isChecked ? 'Aktifkan Mode Daring (PJJ)?' : 'Kembali ke Mode Normal (Luring)?',
        text: infoText,
        icon: isChecked ? 'warning' : 'question',
        showCancelButton: true,
        confirmButtonText: isChecked ? 'Ya, Aktifkan!' : 'Ya, Matikan!',
        cancelButtonText: 'Batal',
        confirmButtonColor: isChecked ? '#2563eb' : '#4b5563'
    });

    if (!result.isConfirmed) {
        if (toggleEl) toggleEl.checked = !isChecked;
        return;
    }

    try {
        Swal.fire({
            title: 'Menyimpan Pengaturan...',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        // 1. Simpan ke Cloudflare D1 SSOT (0 Firestore Write)
        await cfClient.saveJurnalSettings({
            mode_daring: isChecked
        });

        // 3. Jika PJJ diaktifkan, pastikan opsi lokasi "Daring (PJJ)" ada di master lokasi
        if (isChecked) {
            try {
                await cfClient.saveJurnalLokasi({
                    id: "lokasi_daring",
                    nama_lokasi: "Daring (PJJ)",
                    urutan: 0
                });
            } catch (locErr) {
                console.warn('[Lokasi] Daring location create notice:', locErr);
            }
        }

        // 4. Update memory cache & UI
        if (currentMasterData.settings) {
            currentMasterData.settings.mode_daring = isChecked;
        }
        currentMasterData.mode_daring = isChecked;
        populateSettingsForm();

        Swal.fire({
            icon: 'success',
            title: isChecked ? 'Mode Daring Aktif ⚡' : 'Mode Normal Aktif 🏫',
            text: isChecked 
                ? 'Guru sekarang dapat mengisi jurnal daring dari mana saja tanpa validasi GPS.' 
                : 'Sistem kembali ke mode normal (wajib QR kelas & validasi GPS).',
            timer: 2500,
            showConfirmButton: false
        });
    } catch (err) {
        console.error("Gagal simpan mode daring:", err);
        if (toggleEl) toggleEl.checked = !isChecked;
        Swal.fire({ icon: 'error', title: 'Gagal Menyimpan', text: err.message });
    }
};
