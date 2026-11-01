/**
 * js/page-pesan-lks.js
 * Modul Matriks Pemesanan & Distribusi Buku LKS Siswa per Rombel
 * Terintegrasi penuh dengan Master Siswa D1, Penjualan Buku LKS, dan Distribusi Fisik
 * Single Source of Truth: PRD_SIMAS.md & Cloudflare D1 Serverless SQL / LocalStorage Cache
 */

import { auth, SCHOOL_CONFIG } from './config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { initLayout, escapeHTML, showToast, formatDateIndo } from './global.js';
import { cfClient } from './cloudflare-client.js';
import { parseASCSchedule } from './asc-schedule-parser.js';

// Kunci Penyimpanan SSOT
export const BOOK_SALES_STORAGE_KEY = 'simas_book_sales_lks_data';
export const BOOK_SALES_D1_KEY = 'book_sales_lks_data';
export const ORDERS_STORAGE_KEY = 'simas_book_orders_data';
export const ORDERS_D1_KEY = 'book_orders_data';

// State Global Halaman
let currentBookData = [];
let currentTransactionsData = [];
let currentOrders = [];
let currentUserInfo = null; // { uid, name, role, class }
let activeClassName = '';
let activeGrade = '10'; // '10' | '11' | '12'
let currentClassStudents = [];
let currentGradeBooks = [];
let currentMatrixData = {}; // { [nis]: { name, books: { [subject]: { ordered: bool, received: bool, receivedAt: string|null } } } }
let currentMatrixStatus = 'draft'; // 'draft' | 'pending' | 'approved' | 'fulfilled'
let currentActiveTab = 'matrix-order'; // 'matrix-order' | 'matrix-rekap'
let cachedMasterClasses = [];
let currentViewMode = 'table'; // 'cards' | 'table' (default tabel)
let currentStudentSearchKeyword = '';
let isMatrixOrderDirty = false; // Menandakan apakah terdapat perubahan pemesanan yang belum difinalisasi / disimpan
let matrixSaveQueue = Promise.resolve();
let isSubmittingMatrix = false;
let currentParsedSchedule = null;
let activeSemester = '1'; // '1' (Ganjil) | '2' (Genap)
let isHistoryReadOnly = false; // true jika semester bukan semester berjalan

/**
 * Mendapatkan semester berjalan SSOT ('1' atau '2')
 */
export function getRunningSemester() {
    if (typeof window !== 'undefined' && typeof window.getCurrentSemester === 'function') {
        try {
            const sem = String(window.getCurrentSemester());
            if (sem === '1' || sem === '2') return sem;
        } catch (e) {}
    }
    // Fallback: Juli - Desember (bulan 6 - 11) = Semester 1 (Ganjil), sisanya Semester 2 (Genap)
    const month = new Date().getMonth();
    return month >= 6 ? '1' : '2';
}

/**
 * Membangun kunci penyimpanan matriks rombel per semester
 */
export function buildMatrixStorageKey(className, semester = activeSemester) {
    const safeClass = normalizeKey(className).replace(/\s+/g, '_');
    const sem = String(semester || '1');
    return `book_matrix_${safeClass}_sem${sem}`;
}

/**
 * Menerapkan tampilan mode Read-Only ketika membuka semester lampau
 */
export function applyHistoryReadOnlyState() {
    const runningSem = getRunningSemester();
    isHistoryReadOnly = (String(activeSemester) !== String(runningSem));

    if (typeof document === 'undefined') return;

    const badge = document.getElementById('badge-history-readonly');
    if (badge) {
        if (isHistoryReadOnly) {
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    const btnSaveHeader = document.getElementById('btn-save-matrix');
    const topSaveBar = document.getElementById('top-save-bar-order');

    if (isHistoryReadOnly) {
        if (btnSaveHeader) btnSaveHeader.classList.add('hidden');
        if (topSaveBar) {
            topSaveBar.classList.add('hidden');
            topSaveBar.classList.remove('flex');
        }
    } else {
        if (btnSaveHeader) btnSaveHeader.classList.remove('hidden');
        if (isMatrixOrderDirty && topSaveBar) {
            topSaveBar.classList.remove('hidden');
            topSaveBar.classList.add('flex');
        }
    }
}

export function getCurrentParsedSchedule() {
    return currentParsedSchedule;
}

export function setCurrentParsedSchedule(schedule) {
    currentParsedSchedule = schedule;
}

/**
 * Mengatur status perubahan data pemesanan (dirty state) & menampilkan/menyembunyikan alert top-save-bar-order
 */
export function setMatrixOrderDirty(dirty) {
    isMatrixOrderDirty = !!dirty;
    if (typeof document === 'undefined') return;

    const topSaveBar = document.getElementById('top-save-bar-order');
    const btnSaveHeader = document.getElementById('btn-save-matrix');

    if (dirty) {
        if (topSaveBar) {
            topSaveBar.classList.remove('hidden');
            topSaveBar.classList.add('flex');
        }
        if (btnSaveHeader) {
            btnSaveHeader.classList.add('ring-2', 'ring-emerald-300');
        }
    } else {
        if (topSaveBar) {
            topSaveBar.classList.add('hidden');
            topSaveBar.classList.remove('flex');
        }
        if (btnSaveHeader) {
            btnSaveHeader.classList.remove('ring-2', 'ring-emerald-300');
        }
    }
}

/**
 * Normalisasi string teks untuk pencocokan toleran
 */
export function normalizeKey(text) {
    if (!text || typeof text !== 'string') return '';
    return text.toLowerCase()
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export const SUBJECT_ALIAS_MAP = {
    'prakarya dan kewirausahaan': 'pkwu',
    'prakarya': 'pkwu',
    'seni budaya': 'seni tari',
    'kearifan lokal bali': 'bahasa bali',
    'pendidikan pancasila': 'pendidikan pancasila',
    'pendidikan agama hindu dan budi pekerti': 'agama dan budi pekerti',
    'pendidikan agama islam dan budi pekerti': 'agama dan budi pekerti',
    'pendidikan jasmani, olahraga, dan kesehatan': 'pjok',
    'pendidikan jasmani olahraga dan kesehatan': 'pjok'
};

export function isAdvancedSubject(normText) {
    if (!normText) return false;
    return normText.includes('tingkat lanjut') || normText.includes('tk lanjut') || normText.includes('lanjut');
}

/**
 * Pencocokan Cerdas dari Nama Mapel Resmi Jadwal XML ke Baris Judul Buku di Master Data
 */
export function findBookEntryForSchedule(grade, subjectXmlName, books = currentBookData) {
    const g = parseInt(grade, 10);
    const normXml = normalizeKey(subjectXmlName);
    const isXmlAdvanced = isAdvancedSubject(normXml);
    const list = Array.isArray(books) ? books : [];

    // 1. Direct match
    let found = list.find(b => parseInt(b.grade, 10) === g && normalizeKey(b.subject) === normXml);
    if (found) return found;

    // 2. Alias mapping Jadwal XML -> Buku Sekolah
    if (normXml.includes('prakarya') || normXml === 'prakarya dan kewirausahaan') {
        found = list.find(b => parseInt(b.grade, 10) === g && (normalizeKey(b.subject) === 'pkwu' || normalizeKey(b.subject).includes('prakarya')));
        if (found) return found;
    }
    if (normXml.includes('seni budaya')) {
        found = list.find(b => parseInt(b.grade, 10) === g && (normalizeKey(b.subject).includes('seni tari') || normalizeKey(b.subject).includes('seni rupa') || normalizeKey(b.subject).includes('seni budaya')));
        if (found) return found;
    }
    if (normXml.includes('kearifan lokal bali') || (g === 12 && normXml.includes('bali'))) {
        found = list.find(b => parseInt(b.grade, 10) === g && normalizeKey(b.subject).includes('bahasa bali'));
        if (found) return found;
    }
    if (isXmlAdvanced) {
        if (normXml.includes('indonesia')) {
            found = list.find(b => parseInt(b.grade, 10) === g && normalizeKey(b.subject).includes('bahasa indonesia') && isAdvancedSubject(normalizeKey(b.subject)));
            if (found) return found;
        }
        if (normXml.includes('inggris')) {
            found = list.find(b => parseInt(b.grade, 10) === g && normalizeKey(b.subject).includes('bahasa inggris') && isAdvancedSubject(normalizeKey(b.subject)));
            if (found) return found;
        }
        if (normXml.includes('sejarah')) {
            found = list.find(b => parseInt(b.grade, 10) === g && normalizeKey(b.subject).includes('sejarah') && isAdvancedSubject(normalizeKey(b.subject)));
            if (found) return found;
        }
        if (normXml.includes('matematika')) {
            found = list.find(b => parseInt(b.grade, 10) === g && normalizeKey(b.subject).includes('matematika') && isAdvancedSubject(normalizeKey(b.subject)));
            if (found) return found;
        }
    }

    // 3. Substring match toleran
    found = list.find(b => {
        if (parseInt(b.grade, 10) !== g) return false;
        const normB = normalizeKey(b.subject);
        if (isXmlAdvanced !== isAdvancedSubject(normB)) return false;
        return normB.includes(normXml) || normXml.includes(normB);
    });
    return found || null;
}

/**
 * Mengambil daftar nama mata pelajaran resmi dari Jadwal XML yang diajarkan pada rombel kelas tertentu.
 * Mapel yang dinonaktifkan di Pengaturan (isActive === false) otomatis disaring.
 */
export function getSubjectsForClassSchedule(grade, className, schedule = currentParsedSchedule, books = currentBookData) {
    const g = parseInt(grade, 10);
    if (schedule && schedule.lessonsMap && schedule.classesMap && schedule.subjectsMap) {
        const { lessonsMap, classesMap, subjectsMap } = schedule;
        let targetClassId = null;
        for (const [cid, cObj] of classesMap.entries()) {
            if (cObj && (cObj.name === className || cid === className)) {
                targetClassId = cid;
                break;
            }
        }

        const subjectsSet = new Set();
        const excludedSubjects = new Set(['UPACARA', 'Ekstrakurikuler', 'Bimbingan dan Konseling']);

        lessonsMap.forEach(lesson => {
            const hasClass = (lesson.classIds || []).includes(targetClassId) ||
                             (lesson.classIds || []).some(cid => {
                                 const cObj = classesMap.get(cid);
                                 return cObj && cObj.name === className;
                             });
            if (hasClass) {
                const subObj = subjectsMap.get(lesson.subjectId);
                const subName = subObj ? subObj.name : lesson.subjectId;
                if (subName && !excludedSubjects.has(subName)) {
                    const matchedBook = findBookEntryForSchedule(g, subName, books);
                    // Kecualikan jika disembunyikan/dinonaktifkan di Pengaturan
                    if (matchedBook && matchedBook.isActive === false) {
                        return;
                    }
                    if (matchedBook && matchedBook.subject) {
                        subjectsSet.add(matchedBook.subject);
                    } else {
                        subjectsSet.add(subName);
                    }
                }
            }
        });

        if (subjectsSet.size > 0) {
            return Array.from(subjectsSet).sort();
        }
    }

    // Fallback jika schedule belum termuat
    return (books || [])
        .filter(b => parseInt(b.grade, 10) === g && b.isActive !== false)
        .map(b => b.subject)
        .sort();
}

/**
 * Format mata uang Rupiah
 */
export function formatRupiah(num) {
    const val = parseInt(num, 10);
    if (isNaN(val)) return 'Rp 0';
    return 'Rp ' + val.toLocaleString('id-ID');
}

/**
 * Format harga singkat untuk tabel matriks (contoh: 17000 -> "17rb", 23000 -> "23rb", 34500 -> "34,5rb")
 */
export function formatShortPrice(num) {
    const val = parseInt(num, 10);
    if (isNaN(val) || val === 0) return '0';
    if (val >= 1000) {
        const inRb = val / 1000;
        const formatted = Number.isInteger(inRb) ? inRb : inRb.toFixed(1).replace('.', ',');
        return `${formatted}rb`;
    }
    return String(val);
}

/**
 * Format nama mapel panjang menjadi [depan]...[belakang] untuk header tabel matriks
 * Contoh: "Pendidikan Pancasila" -> "Pend...sila", "Bahasa Indonesia" -> "Baha...esia", "Informatika" -> "Info...tika"
 */
export function formatSubjectDisplayName(subject, maxLength = 10) {
    if (!subject || typeof subject !== 'string') return '';
    const clean = subject.trim();
    if (clean.length <= maxLength) return clean;

    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
        const first = words[0];
        const last = words[words.length - 1];
        const depan = first.length > 5 ? first.slice(0, 4) : first;
        const belakang = last.length > 5 ? last.slice(-4) : last;
        return `${depan}...${belakang}`;
    } else {
        const depan = clean.slice(0, 4);
        const belakang = clean.slice(-4);
        return `${depan}...${belakang}`;
    }
}

/**
 * Konversi angka jenjang ke angka Romawi (X, XI, XII)
 */
export function getGradeRoman(grade) {
    if (!grade && grade !== 0) return '';
    const g = String(grade).trim();
    if (g === '10' || g.toLowerCase() === 'x') return 'X';
    if (g === '11' || g.toLowerCase() === 'xi') return 'XI';
    if (g === '12' || g.toLowerCase() === 'xii') return 'XII';
    return g;
}

/**
 * Ekstraksi angka jenjang dari nama rombel (contoh: "X-1" -> "10", "XI-4" -> "11", "XII-2" -> "12")
 */
export function extractGradeFromClassName(className) {
    if (!className || typeof className !== 'string') return '10';
    const c = className.trim().toUpperCase();
    if (c.startsWith('XII-') || c.startsWith('XII ') || c.startsWith('12')) return '12';
    if (c.startsWith('XI-') || c.startsWith('XI ') || c.startsWith('11')) return '11';
    if (c.startsWith('X-') || c.startsWith('X ') || c.startsWith('10')) return '10';
    return '10';
}

/**
 * Format timestamp ringkas untuk serah terima buku di HP (dd/mm hh:mm)
 */
export function formatTimestampShort(isoStr) {
    if (!isoStr) return '';
    try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return '';
        const day = String(d.getDate()).padStart(2, '0');
        const mon = String(d.getMonth() + 1).padStart(2, '0');
        const hour = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return `${day}/${mon} ${hour}:${min}`;
    } catch (e) {
        return '';
    }
}

/**
 * Mendapatkan daftar seluruh rombel kelas aktif di sekolah (SSOT)
 */
export async function getMasterClasses() {
    if (cachedMasterClasses && cachedMasterClasses.length > 0) {
        return cachedMasterClasses;
    }

    if (typeof window !== 'undefined' && typeof window.getActiveClasses === 'function') {
        try {
            const list = await window.getActiveClasses();
            if (Array.isArray(list) && list.length > 0) {
                cachedMasterClasses = list;
                return cachedMasterClasses;
            }
        } catch (e) {
            console.warn('[PesanLKS] getActiveClasses gagal, fallback standar:', e);
        }
    }

    // Fallback daftar rombel resmi SMAGESA
    cachedMasterClasses = [
        'X-1', 'X-2', 'X-3', 'X-4', 'X-5', 'X-6', 'X-7', 'X-8', 'X-9',
        'XI-1', 'XI-2', 'XI-3', 'XI-4', 'XI-5', 'XI-6', 'XI-7', 'XI-8', 'XI-9', 'XI-10',
        'XII-1', 'XII-2', 'XII-3', 'XII-4', 'XII-5', 'XII-6', 'XII-7', 'XII-8', 'XII-9'
    ];
    return cachedMasterClasses;
}

function parseSettingValue(setting) {
    if (!setting) return null;
    let val = setting;
    if (typeof val === 'string') {
        try { val = JSON.parse(val); } catch (e) { return null; }
    }
    if (val && typeof val === 'object') {
        if (val.value !== undefined && val.value !== null) {
            if (typeof val.value === 'string') {
                try { return JSON.parse(val.value); } catch (e) { return val.value; }
            }
            return val.value;
        }
    }
    return val;
}

// Nilai JSON di dalam atribut HTML tetap aman untuk nama/mapel berapostrof.
function inlineArgument(value) {
    return escapeHTML(JSON.stringify(String(value)));
}

/**
 * Memuat master buku dan transaksi penjualan dari SSOT Cloudflare D1 / LocalStorage
 */
export async function loadBookSalesData() {
    let d1Data = null;
    if (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled) {
        try {
            const setting = await cfClient.getSystemSetting(BOOK_SALES_D1_KEY);
            d1Data = parseSettingValue(setting);
        } catch (e) {
            console.warn('[PesanLKS] Gagal memuat setting buku dari D1:', e);
        }
    }

    if (!d1Data) {
        try {
            const local = localStorage.getItem(BOOK_SALES_STORAGE_KEY);
            if (local) d1Data = JSON.parse(local);
        } catch (e) {
            console.warn('[PesanLKS] Gagal membaca cache localStorage buku:', e);
        }
    }

    if (d1Data && Array.isArray(d1Data.books)) {
        currentBookData = d1Data.books;
        currentTransactionsData = Array.isArray(d1Data.transactions) ? d1Data.transactions : [];
    } else {
        currentBookData = [];
        currentTransactionsData = [];
    }
}

/**
 * Stok fisik mengikuti master admin LKS; pesanan siswa belum mengurangi stok.
 */
export function getBookRemainingStock(book) {
    if (Number.isFinite(book.sisa)) return Math.max(0, book.sisa);
    const quantity = value => parseInt(value, 10) || 0;
    return Math.max(0, quantity(book.terima) - quantity(book.diam) - quantity(book.retur) - quantity(book.terjual));
}

export function renderBookStockSummary() {
    const list = document.getElementById('lks-stock-list');
    const grade = document.getElementById('lks-stock-grade');
    if (grade) grade.textContent = `Kelas ${getGradeRoman(activeGrade)}`;
    if (!list) return;

    if (currentGradeBooks.length === 0) {
        list.innerHTML = '<li class="text-xs text-slate-500 dark:text-slate-400">Belum ada buku LKS aktif untuk jenjang ini.</li>';
        return;
    }

    list.innerHTML = currentGradeBooks.map(book => {
        const stock = getBookRemainingStock(book);
        const stockClass = stock === 0
            ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
            : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300';
        return `<li class="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2.5 py-1.5 rounded-lg border text-[10px] sm:text-xs ${stockClass}">
            <span class="font-semibold">${escapeHTML(book.subject)}</span>
            <span class="font-bold font-mono whitespace-nowrap">${stock.toLocaleString('id-ID')} eks${stock === 0 ? ' · Habis' : ''}</span>
        </li>`;
    }).join('');
}

/**
 * Memuat data pesanan buku master dari SSOT D1 / LocalStorage
 */
export async function loadOrdersData() {
    let d1Data = null;
    if (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled) {
        try {
            const setting = await cfClient.getSystemSetting(ORDERS_D1_KEY);
            d1Data = parseSettingValue(setting);
        } catch (e) {
            console.warn('[PesanLKS] Gagal memuat pesanan master dari D1:', e);
        }
    }

    if (!d1Data) {
        try {
            const local = localStorage.getItem(ORDERS_STORAGE_KEY);
            if (local) d1Data = JSON.parse(local);
        } catch (e) {
            console.warn('[PesanLKS] Gagal membaca cache pesanan master:', e);
        }
    }

    currentOrders = Array.isArray(d1Data?.orders) ? d1Data.orders : [];
}

/**
 * Memuat data matriks pemesanan rombel aktif dari D1 / LocalStorage berdasarkan semester aktif
 */
export async function loadClassMatrixData(className, semester = activeSemester) {
    if (!className) return;
    const targetSem = String(semester || activeSemester || '1');
    const safeKey = buildMatrixStorageKey(className, targetSem);
    const storageKey = `simas_${safeKey}`;

    let matrixDoc = null;

    if (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled) {
        try {
            const setting = await cfClient.getSystemSetting(safeKey);
            matrixDoc = parseSettingValue(setting);
        } catch (e) {
            console.warn(`[PesanLKS] Gagal memuat matriks ${safeKey} dari D1:`, e);
        }
    }

    try {
        const local = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (!matrixDoc || (local?.dirty === true && local.updatedAt > (matrixDoc.updatedAt || ''))) matrixDoc = local;
    } catch (e) {}

    // Kompatibilitas migrasi: Jika membuka semester berjalan dan kunci baru belum ada data,
    // baca fallback dari kunci lama tanpa akhiran semester (book_matrix_${safeClass})
    if (!matrixDoc && targetSem === getRunningSemester()) {
        const oldSafeKey = `book_matrix_${normalizeKey(className).replace(/\s+/g, '_')}`;
        const oldStorageKey = `simas_${oldSafeKey}`;
        if (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled) {
            try {
                const oldSetting = await cfClient.getSystemSetting(oldSafeKey);
                matrixDoc = parseSettingValue(oldSetting);
            } catch (e) {}
        }
        if (!matrixDoc) {
            try {
                const oldLocal = JSON.parse(localStorage.getItem(oldStorageKey) || 'null');
                if (oldLocal) matrixDoc = oldLocal;
            } catch (e) {}
        }
    }

    if (matrixDoc && matrixDoc.matrix && typeof matrixDoc.matrix === 'object') {
        currentMatrixData = matrixDoc.matrix;
        currentMatrixStatus = matrixDoc.status || 'draft';
    } else {
        // Inisialisasi matriks baru
        currentMatrixData = {};
        currentMatrixStatus = 'draft';
    }
    setMatrixOrderDirty(!isHistoryReadOnly && matrixDoc?.dirty === true);
}

/**
 * Menyimpan data matriks pemesanan rombel aktif ke D1 dan LocalStorage berdasarkan semester aktif
 */
export async function saveClassMatrixData(className, syncToMasterOrders = false) {
    if (!className) return false;
    if (isHistoryReadOnly) {
        console.warn('[PesanLKS] Penyimpanan dibatalkan: Data Semester historis bersifat Read-Only.');
        return false;
    }
    const safeKey = buildMatrixStorageKey(className, activeSemester);
    const storageKey = `simas_${safeKey}`;
    const legacySafeKey = `book_matrix_${normalizeKey(className).replace(/\s+/g, '_')}`;
    const legacyStorageKey = `simas_${legacySafeKey}`;

    const summary = calculateMatrixSummary();

    const payload = {
        class: className,
        grade: activeGrade,
        semester: activeSemester,
        status: currentMatrixStatus,
        updatedAt: new Date().toISOString(),
        updatedBy: {
            uid: currentUserInfo?.uid || '',
            name: currentUserInfo?.name || 'Admin',
            role: currentUserInfo?.role || 'admin_kelas'
        },
        matrix: JSON.parse(JSON.stringify(currentMatrixData)),
        dirty: isMatrixOrderDirty && !syncToMasterOrders,
        summary: summary
    };

    try {
        localStorage.setItem(storageKey, JSON.stringify(payload));
        if (activeSemester === getRunningSemester()) {
            localStorage.setItem(legacyStorageKey, JSON.stringify(payload));
        }
    } catch (e) {
        console.warn('[PesanLKS] Gagal menyimpan ke localStorage:', e);
    }

    // Urutkan autosave dan pengiriman agar draft lama tidak menimpa hasil kirim.
    const save = matrixSaveQueue.then(async () => {
        if (!cfClient?.enabled) {
            if (syncToMasterOrders) throw new Error('Koneksi server belum tersedia. Pesanan masih tersimpan sebagai draft.');
            return;
        }
        if (activeSemester === getRunningSemester()) {
            await cfClient.saveSystemSetting(legacySafeKey, payload);
        }
        await cfClient.saveSystemSetting(safeKey, payload);
        if (syncToMasterOrders) await syncMatrixToMasterBookOrders(className, summary);
    });
    matrixSaveQueue = save.catch(() => {});
    try {
        await save;
        return true;
    } catch (error) {
        console.warn('[PesanLKS] Gagal menyimpan ke server:', error);
        showToast('Belum Terkirim', 'Draft tersimpan di perangkat. Periksa koneksi lalu simpan kembali.', 'warning');
        return false;
    }
}

/**
 * Sinkronisasi pemesanan rombel ke daftar pesanan master book_orders_data
 * Memperbarui atau membuat tiket pesanan per mata pelajaran untuk kelas ini
 */
export async function syncMatrixToMasterBookOrders(className, summary) {
    // Pengiriman harus membaca server terbaru; cache yang usang dapat menghapus pesanan kelas lain.
    const latest = parseSettingValue(await cfClient.getSystemSetting(ORDERS_D1_KEY));
    currentOrders = Array.isArray(latest?.orders) ? latest.orders : [];

    // Matriks merupakan total kebutuhan kelas, sehingga menggantikan tiket lama pada jenjang ini.
    currentOrders = currentOrders.filter(o => !(normalizeKey(o.orderedBy?.class || o.className || o.class) === normalizeKey(className)
        && getGradeRoman(o.grade) === getGradeRoman(extractGradeFromClassName(className))));

    Object.keys(summary.items).forEach(subject => {
        const item = summary.items[subject];
        if (item.qty > 0) {
            const newOrder = {
                id: `order_${Date.now()}_${normalizeKey(className)}_${normalizeKey(subject).replace(/\s+/g, '_')}`,
                orderedBy: {
                    uid: currentUserInfo?.uid || '',
                    name: currentUserInfo?.name || 'Admin Kelas',
                    class: className,
                    role: currentUserInfo?.role || 'admin_kelas'
                },
                bookSubject: subject,
                grade: extractGradeFromClassName(className),
                qty: item.qty,
                pricePerUnit: item.price,
                totalPrice: item.total,
                status: 'pending',
                note: `Pemesanan kolektif siswa kelas ${className} (${item.qty} siswa)`,
                orderedAt: new Date().toISOString(),
                processedAt: null,
                processedBy: null,
                cancelledAt: null,
                rejectedReason: null
            };
            currentOrders.push(newOrder);
        }
    });

    // Simpan ke D1 book_orders_data
    const ordersPayload = {
        orders: currentOrders,
        updatedAt: new Date().toISOString()
    };

    await cfClient.saveSystemSetting(ORDERS_D1_KEY, ordersPayload);
    try {
        localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(ordersPayload));
    } catch (e) {}
}

/**
 * Mengambil daftar siswa untuk rombel yang aktif
 */
export async function fetchStudentsForClass(className) {
    if (!className) return [];
    let students = [];

    if (typeof window !== 'undefined' && typeof window.getStudentsByClass === 'function') {
        try {
            students = await window.getStudentsByClass(className);
        } catch (e) {
            console.warn('[PesanLKS] getStudentsByClass gagal:', e);
        }
    }

    if (!Array.isArray(students) || students.length === 0) {
        if (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled) {
            try {
                const res = await cfClient.getStudents({ class: className, limit: 100 });
                if (Array.isArray(res) && res.length > 0) students = res;
            } catch (e) {}
        }
    }

    // Fallback: Baca cache lokal simas_students_data jika D1 / serverless offline
    if (!Array.isArray(students) || students.length === 0) {
        try {
            const raw = localStorage.getItem('simas_students_data') || localStorage.getItem('students_cache');
            if (raw) {
                const all = JSON.parse(raw);
                if (Array.isArray(all)) {
                    students = all.filter(s => (s.kelas === className || s.rombel === className || s.class === className));
                }
            }
        } catch (e) {}
    }

    // Urutkan siswa berdasarkan NIS atau Nama
    if (Array.isArray(students)) {
        students.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    return students || [];
}

/**
 * Menghitung rekapitulasi akumulasi dari matriks saat ini
 */
export function calculateMatrixSummary() {
    let totalBooks = 0;
    let totalReceived = 0;
    let totalValue = 0;
    const items = {};

    currentGradeBooks.forEach(book => {
        items[book.subject] = {
            subject: book.subject,
            price: parseInt(book.harga, 10) || 0,
            qty: 0,
            receivedCount: 0,
            total: 0
        };
    });

    currentClassStudents.forEach(student => {
        const nis = String(student.nis || student.id || student.name);
        const studentRecord = currentMatrixData[nis]?.books || {};

        currentGradeBooks.forEach(book => {
            const entry = studentRecord[book.subject];
            if (entry && entry.ordered) {
                totalBooks++;
                const price = parseInt(book.harga, 10) || 0;
                totalValue += price;

                if (items[book.subject]) {
                    items[book.subject].qty++;
                    items[book.subject].total += price;
                    if (entry.received) {
                        items[book.subject].receivedCount++;
                        totalReceived++;
                    }
                }
            }
        });
    });

    return {
        totalBooks,
        totalReceived,
        totalValue,
        items
    };
}

/**
 * Memperbarui angka pada 4 kartu KPI
 */
export function updateKpiCards() {
    const summary = calculateMatrixSummary();

    const elTotalStudents = document.getElementById('kpi-total-students');
    if (elTotalStudents) {
        elTotalStudents.textContent = `${currentClassStudents.length} Siswa`;
    }

    const elTotalOrdered = document.getElementById('kpi-total-ordered-books');
    if (elTotalOrdered) {
        elTotalOrdered.textContent = `${summary.totalBooks} eks`;
    }

    const elTotalReceived = document.getElementById('kpi-total-received-books');
    if (elTotalReceived) {
        elTotalReceived.textContent = `${summary.totalReceived} / ${summary.totalBooks}`;
    }

    const elTotalVal = document.getElementById('kpi-total-matrix-value');
    if (elTotalVal) {
        elTotalVal.textContent = formatRupiah(summary.totalValue);
    }

    // Quick Summary Bar di HP
    const elMobileBooks = document.getElementById('mobile-quick-books');
    if (elMobileBooks) elMobileBooks.textContent = `${summary.totalBooks} eks`;
    const elMobileVal = document.getElementById('mobile-quick-value');
    if (elMobileVal) elMobileVal.textContent = formatRupiah(summary.totalValue);

    // Badge pending serah terima di Tab 2
    const badgePending = document.getElementById('badge-pending-distribution');
    if (badgePending) {
        const remaining = summary.totalBooks - summary.totalReceived;
        if (remaining > 0) {
            badgePending.textContent = String(remaining);
            badgePending.classList.remove('hidden');
        } else {
            badgePending.classList.add('hidden');
        }
    }

    // Status badge rombel
    const statusBadge = document.getElementById('matrix-order-status-badge');
    if (statusBadge) {
        const statusMap = {
            draft: { label: 'Draft', class: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
            pending: { label: 'Menunggu Persetujuan', class: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
            approved: { label: 'Disetujui Sekolah', class: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
            fulfilled: { label: 'Selesai Didistribusikan', class: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' }
        };
        const conf = statusMap[currentMatrixStatus] || statusMap.draft;
        statusBadge.textContent = conf.label;
        statusBadge.className = `px-2.5 py-1 rounded-lg text-xs font-bold border border-current ${conf.class}`;
    }
}

/**
 * Geser posisi horizontal tabel matriks secara halus (kiri / kanan)
 */
export function scrollMatrixHorizontally(targetId = 'table-order-matrix', delta = 280) {
    if (typeof document === 'undefined') return;
    let el = targetId ? document.getElementById(targetId) : null;
    if (!el) {
        el = document.querySelector('.matrix-table-scroll-container') || document.getElementById('table-order-matrix');
    }
    if (!el) return;

    const scrollContainer = el.classList?.contains('matrix-table-scroll-container')
        ? el
        : (el.closest?.('.matrix-table-scroll-container') || el.parentElement || el);

    if (scrollContainer) {
        const step = typeof delta === 'number' ? delta : 280;
        if (typeof scrollContainer.scrollBy === 'function') {
            try {
                scrollContainer.scrollBy({ left: step, behavior: 'smooth' });
            } catch (e) {
                scrollContainer.scrollLeft += step;
            }
        } else {
            scrollContainer.scrollLeft += step;
        }

        // Sinkronkan scrollbar tiruan atas seketika
        const topContainer = document.getElementById('top-scrollbar-container-order');
        if (topContainer) {
            topContainer.scrollLeft = scrollContainer.scrollLeft;
            setTimeout(() => {
                topContainer.scrollLeft = scrollContainer.scrollLeft;
            }, 50);
        }
    }
}

/**
 * Sinkronisasi dua arah antara top scrollbar tiruan dan tabel matriks utama
 */
export function syncTopScrollbar(tableId, topContainerId, topTrackId) {
    if (typeof document === 'undefined') return;
    const table = document.getElementById(tableId);
    const topContainer = document.getElementById(topContainerId);
    const topTrack = document.getElementById(topTrackId);
    if (!table || !topContainer || !topTrack) return;

    const scrollContainer = table.closest('.matrix-table-scroll-container') || table.parentElement;
    if (!scrollContainer) return;

    const updateTrackWidth = () => {
        const fullWidth = Math.max(table.scrollWidth || 0, scrollContainer.scrollWidth || 0);
        topTrack.style.width = `${fullWidth}px`;
        if (fullWidth <= (scrollContainer.clientWidth || 0)) {
            topContainer.classList.add('hidden');
        } else {
            topContainer.classList.remove('hidden');
        }
    };

    updateTrackWidth();

    if (!scrollContainer._hasSyncScrollListeners) {
        scrollContainer._hasSyncScrollListeners = true;

        let isSyncingFromTop = false;
        let isSyncingFromMain = false;

        topContainer.addEventListener('scroll', () => {
            if (isSyncingFromMain) return;
            isSyncingFromTop = true;
            scrollContainer.scrollLeft = topContainer.scrollLeft;
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => { isSyncingFromTop = false; });
            } else {
                setTimeout(() => { isSyncingFromTop = false; }, 10);
            }
        }, { passive: true });

        scrollContainer.addEventListener('scroll', () => {
            if (isSyncingFromTop) return;
            isSyncingFromMain = true;
            topContainer.scrollLeft = scrollContainer.scrollLeft;
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => { isSyncingFromMain = false; });
            } else {
                setTimeout(() => { isSyncingFromMain = false; }, 10);
            }
        }, { passive: true });

        scrollContainer.addEventListener('wheel', (e) => {
            if (e.shiftKey) {
                e.preventDefault();
                scrollContainer.scrollLeft += e.deltaY;
            }
        }, { passive: false });
    }
}

/**
 * Sinkronkan seluruh top scrollbar matriks yang aktif
 */
export function syncAllMatrixScrollbars() {
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
            syncTopScrollbar('table-order-matrix', 'top-scrollbar-container-order', 'top-scrollbar-track-order');
        });
    } else {
        syncTopScrollbar('table-order-matrix', 'top-scrollbar-container-order', 'top-scrollbar-track-order');
    }
}

/**
 * Render Tabel Tab 1: Matriks Pemesanan Siswa
 */
export function renderMatrixOrderTable() {
    const theadRow = document.getElementById('table-matrix-order-header-row');
    const tbody = document.getElementById('table-matrix-order-body');
    const tfoot = document.getElementById('table-matrix-order-footer');
    if (!theadRow || !tbody || !tfoot) return;

    // 1. Buat Header Kolom Dinamis (Nama Siswa + Setiap Mata Pelajaran)
    let headerHtml = `
        <th class="hidden sm:table-cell py-1.5 sm:py-2 px-1.5 sm:px-2 w-8 sm:w-10 text-center sticky left-0 z-30 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700">No</th>
        <th class="py-1.5 sm:py-2 px-2 sm:px-2.5 sticky left-0 sm:left-10 z-30 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 min-w-[105px] max-w-[125px] sm:min-w-[190px] sm:max-w-none">
            <div class="truncate leading-tight">Nama Siswa</div>
            <div class="text-[9px] sm:text-[10px] text-slate-500 font-normal truncate leading-tight">Total Buku & Tagihan</div>
        </th>
    `;

    currentGradeBooks.forEach((book, bIdx) => {
        const shortSubject = formatSubjectDisplayName(book.subject);
        const shortPrice = formatShortPrice(book.harga);
        headerHtml += `
            <th class="py-1 sm:py-1.5 px-1 text-center w-16 sm:w-20 min-w-[64px] sm:min-w-[76px] max-w-[80px] sm:max-w-[88px] border-r border-slate-200 dark:border-slate-700 select-none align-top">
                <div class="font-bold text-slate-800 dark:text-slate-100 text-[10px] sm:text-[11px] leading-tight line-clamp-2 break-words mb-0.5" title="${escapeHTML(book.subject)}">
                    ${escapeHTML(shortSubject)}
                </div>
                <div class="text-[9px] sm:text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-bold leading-tight">
                    ${shortPrice}
                </div>
            </th>`;
    });

    theadRow.innerHTML = headerHtml;

    // 2. Buat Baris Siswa (Body) dengan Filter Pencarian
    const filteredStudents = currentClassStudents.filter(student => {
        if (!currentStudentSearchKeyword) return true;
        const nameMatch = (student.name || '').toLowerCase().includes(currentStudentSearchKeyword);
        const nisMatch = String(student.nis || '').toLowerCase().includes(currentStudentSearchKeyword);
        return nameMatch || nisMatch;
    });

    if (filteredStudents.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="${currentGradeBooks.length + 2}" class="text-center py-10 text-slate-400 italic">
                    <i class="fa-solid fa-users text-2xl mb-2 block opacity-40"></i>
                    ${currentStudentSearchKeyword ? `Tidak ada siswa yang cocok dengan pencarian "${escapeHTML(currentStudentSearchKeyword)}".` : `Belum ada data siswa yang terdaftar di rombel <strong>${escapeHTML(activeClassName)}</strong>.`}
                </td>
            </tr>`;
        tfoot.innerHTML = '';
        renderMatrixOrderCards();
        return;
    }

    let bodyHtml = '';
    filteredStudents.forEach((student, sIdx) => {
        const nis = String(student.nis || student.id || student.name);
        const studentName = student.name || `Siswa ${sIdx + 1}`;
        const studentRecord = currentMatrixData[nis]?.books || {};

        let studentTotalBooks = 0;
        let studentTotalValue = 0;

        let cellsHtml = '';
        const disabledAttr = isHistoryReadOnly ? 'disabled' : '';
        const cursorClass = isHistoryReadOnly ? 'cursor-not-allowed opacity-60' : 'cursor-pointer';

        currentGradeBooks.forEach(book => {
            const isChecked = studentRecord[book.subject]?.ordered === true;
            if (isChecked) {
                studentTotalBooks++;
                studentTotalValue += parseInt(book.harga, 10) || 0;
            }

            cellsHtml += `
                <td class="py-0.5 sm:py-1 px-0.5 text-center border-r border-slate-100 dark:border-slate-800 align-middle">
                    <label class="inline-flex items-center justify-center p-0.5 rounded ${isHistoryReadOnly ? '' : 'hover:bg-emerald-50 dark:hover:bg-emerald-950/40 active:scale-95'} ${cursorClass} transition w-6 h-6 sm:w-7 sm:h-7 mx-auto">
                        <input type="checkbox"
                            ${isChecked ? 'checked' : ''}
                            ${disabledAttr}
                            onchange="window.onMatrixOrderCheckChanged(${inlineArgument(nis)}, ${inlineArgument(studentName)}, ${inlineArgument(book.subject)}, this.checked)"
                            class="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 dark:border-slate-600 ${cursorClass} accent-emerald-600">
                    </label>
                </td>`;
        });

        bodyHtml += `
            <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                <td class="hidden sm:table-cell py-1 px-1 sm:px-2 text-center text-slate-400 font-mono text-[11px] sm:text-xs sticky left-0 z-10 bg-white dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800 align-middle">${sIdx + 1}</td>
                <td class="py-1 px-2 sm:px-2.5 sticky left-0 sm:left-10 z-10 bg-white dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800 min-w-[105px] max-w-[125px] sm:min-w-[180px] sm:max-w-none align-middle">
                    <div class="font-bold text-slate-800 dark:text-slate-100 text-[11px] sm:text-xs leading-tight truncate" title="${escapeHTML(studentName)}">${escapeHTML(studentName)}</div>
                    <div class="flex items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[10px] font-mono leading-none mt-0.5 truncate">
                        <span class="font-bold ${studentTotalBooks > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}">${studentTotalBooks} eks</span>
                        <span class="text-slate-300 dark:text-slate-600">·</span>
                        <span class="font-bold ${studentTotalValue > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}">${formatShortPrice(studentTotalValue)}</span>
                    </div>
                </td>
                ${cellsHtml}
            </tr>`;
    });

    tbody.innerHTML = bodyHtml;

    // 3. Buat Baris Total Bawah (Footer) - Selalu presisi sejajar dengan kolom Nama Siswa & Mapel saat di-scroll
    const summary = calculateMatrixSummary();
    let footerHtml = `
        <tr>
            <td class="hidden sm:table-cell py-1 px-1.5 sm:px-2 text-center text-slate-400 font-bold text-[10px] sm:text-xs sticky left-0 z-30 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 align-middle">Σ</td>
            <td class="py-1 px-2 sm:px-2.5 sticky left-0 sm:left-10 z-30 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 min-w-[105px] max-w-[125px] sm:min-w-[190px] sm:max-w-none align-middle">
                <div class="text-[9px] text-slate-500 font-bold uppercase tracking-wider truncate leading-tight">TOTAL:</div>
                <div class="text-[10px] sm:text-xs font-black font-mono flex items-center gap-1 sm:gap-1.5 text-slate-800 dark:text-white truncate leading-tight">
                    <span class="text-blue-600 dark:text-blue-400">${summary.totalBooks} eks</span>
                    <span class="text-slate-400">·</span>
                    <span class="text-emerald-600 dark:text-emerald-400">${formatShortPrice(summary.totalValue)}</span>
                </div>
            </td>
    `;

    currentGradeBooks.forEach(book => {
        const item = summary.items[book.subject] || { qty: 0, total: 0 };
        footerHtml += `
            <td class="py-1 px-1 text-center border-r border-slate-200 dark:border-slate-700 align-middle">
                <div class="font-black text-[10px] sm:text-[11px] font-mono text-emerald-600 dark:text-emerald-400 leading-tight">${item.qty} eks</div>
                <div class="text-[8px] sm:text-[9px] text-slate-500 font-mono truncate leading-tight">${formatShortPrice(item.total)}</div>
            </td>`;
    });

    footerHtml += `</tr>`;
    tfoot.innerHTML = footerHtml;

    // Sinkronkan juga tampilan Kartu Siswa di HP dan top scrollbar tabel
    renderMatrixOrderCards();
    syncTopScrollbar('table-order-matrix', 'top-scrollbar-container-order', 'top-scrollbar-track-order');
}

/**
 * Render Kartu Pemesanan Siswa (Sangat Optimal & Ergonomis untuk Layar HP)
 */
export function renderMatrixOrderCards() {
    const container = document.getElementById('cards-matrix-order-list');
    if (!container) return;

    const filteredStudents = currentClassStudents.filter(student => {
        if (!currentStudentSearchKeyword) return true;
        const nameMatch = (student.name || '').toLowerCase().includes(currentStudentSearchKeyword);
        const nisMatch = String(student.nis || '').toLowerCase().includes(currentStudentSearchKeyword);
        return nameMatch || nisMatch;
    });

    if (filteredStudents.length === 0) {
        container.innerHTML = `
            <div class="text-center py-10 text-slate-400 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6">
                <i class="fa-solid fa-user-slash text-3xl mb-2 text-slate-300 dark:text-slate-600"></i>
                <p class="text-xs sm:text-sm font-semibold">${currentStudentSearchKeyword ? `Tidak ada siswa yang cocok dengan pencarian "${escapeHTML(currentStudentSearchKeyword)}"` : 'Belum ada data siswa di rombel ini.'}</p>
            </div>`;
        return;
    }

    let cardsHtml = '';
    filteredStudents.forEach((student, sIdx) => {
        const nis = String(student.nis || student.id || student.name);
        const studentName = student.name || `Siswa ${sIdx + 1}`;
        const studentRecord = currentMatrixData[nis]?.books || {};

        let studentTotalBooks = 0;
        let studentTotalValue = 0;

        let chipsHtml = '';
        const disabledAttr = isHistoryReadOnly ? 'disabled' : '';
        const cursorClass = isHistoryReadOnly ? 'cursor-not-allowed opacity-60' : 'cursor-pointer';
        const btnClass = isHistoryReadOnly ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer active:scale-95';

        currentGradeBooks.forEach(book => {
            const isChecked = studentRecord[book.subject]?.ordered === true;
            if (isChecked) {
                studentTotalBooks++;
                studentTotalValue += parseInt(book.harga, 10) || 0;
            }

            chipsHtml += `
                <label class="flex items-center gap-1.5 py-1 px-1.5 sm:py-1.5 sm:px-2 rounded-lg border text-[10px] sm:text-xs select-none transition-all ${isHistoryReadOnly ? 'cursor-not-allowed opacity-75' : 'cursor-pointer active:scale-98'} ${isChecked ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200 shadow-2xs font-semibold' : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-400 hover:bg-slate-100'}">
                    <input type="checkbox"
                        ${isChecked ? 'checked' : ''}
                        ${disabledAttr}
                        onchange="window.onMatrixOrderCheckChanged(${inlineArgument(nis)}, ${inlineArgument(studentName)}, ${inlineArgument(book.subject)}, this.checked)"
                        class="w-3.5 h-3.5 rounded text-emerald-600 accent-emerald-600 focus:ring-emerald-500 shrink-0 ${cursorClass}">
                    <div class="min-w-0 flex-1 flex items-center justify-between gap-1 leading-none">
                        <span class="font-bold truncate" title="${escapeHTML(book.subject)}">${escapeHTML(formatSubjectDisplayName(book.subject))}</span>
                        <span class="text-[9px] sm:text-[10px] opacity-80 font-mono shrink-0 font-semibold">${formatShortPrice(book.harga)}</span>
                    </div>
                </label>
            `;
        });

        cardsHtml += `
            <div class="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl sm:rounded-2xl p-2 sm:p-2.5 shadow-2xs space-y-1 sm:space-y-1.5">
                <div class="flex items-center justify-between gap-1.5 border-b border-slate-100 dark:border-slate-800/80 pb-1">
                    <div class="flex items-center gap-1.5 min-w-0 flex-1">
                        <span class="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center font-black text-[10px] font-mono shrink-0">
                            ${sIdx + 1}
                        </span>
                        <div class="min-w-0 flex-1 flex items-center gap-1.5 truncate">
                            <h4 class="font-bold text-slate-800 dark:text-white text-xs sm:text-sm truncate leading-none" title="${escapeHTML(studentName)}">
                                ${escapeHTML(studentName)}
                            </h4>
                            <div class="flex items-center gap-1 text-[9px] sm:text-[10px] font-mono leading-none shrink-0">
                                <span class="text-slate-300 dark:text-slate-600">·</span>
                                <span class="font-bold ${studentTotalBooks > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}">${studentTotalBooks} eks</span>
                                <span class="text-slate-300 dark:text-slate-600">·</span>
                                <span class="font-bold ${studentTotalValue > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}">${formatShortPrice(studentTotalValue)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                        <div class="flex items-center gap-0.5 sm:gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
                            <button type="button" ${disabledAttr} onclick="${isHistoryReadOnly ? '' : `window.toggleStudentAllBooks(${inlineArgument(nis)}, true)`}"
                                class="px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold rounded bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-2xs leading-tight ${btnClass}" title="${isHistoryReadOnly ? 'Histori Read-Only' : 'Pesan Semua Buku'}">
                                [✓ Semua]
                            </button>
                            <button type="button" ${disabledAttr} onclick="${isHistoryReadOnly ? '' : `window.toggleStudentAllBooks(${inlineArgument(nis)}, false)`}"
                                class="px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold rounded bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-2xs leading-tight ${btnClass}" title="${isHistoryReadOnly ? 'Histori Read-Only' : 'Kosongkan Semua'}">
                                [✕]
                            </button>
                        </div>
                    </div>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-1 sm:gap-1.5">
                    ${chipsHtml}
                </div>
            </div>
        `;
    });

    container.innerHTML = cardsHtml;
}

/**
 * Render Tabel Tab 2: Matriks Distribusi & Serah Terima Fisik
 */
export function renderMatrixDistributionTable() {
    const theadRow = document.getElementById('table-matrix-dist-header-row');
    const tbody = document.getElementById('table-matrix-dist-body');
    const tfoot = document.getElementById('table-matrix-dist-footer');
    if (!theadRow || !tbody || !tfoot) return;

    const summary = calculateMatrixSummary();

    // 1. Header Kolom
    let headerHtml = `
        <th class="hidden sm:table-cell py-2.5 px-3 w-10 text-center sticky left-0 z-30 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700">No</th>
        <th class="py-2.5 px-2 sm:px-3 min-w-[105px] max-w-[125px] sm:min-w-[180px] sm:max-w-none sticky left-0 sm:left-10 z-30 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 truncate">Nama Siswa</th>
    `;

    currentGradeBooks.forEach(book => {
        const item = summary.items[book.subject] || { qty: 0, receivedCount: 0 };
        const remaining = item.qty - item.receivedCount;
        const shortSubject = formatSubjectDisplayName(book.subject);

        headerHtml += `
            <th class="py-2 px-1 text-center w-20 sm:w-24 min-w-[76px] sm:min-w-[90px] max-w-[90px] sm:max-w-[110px] border-r border-slate-200 dark:border-slate-700 select-none align-top">
                <div class="font-bold text-slate-800 dark:text-slate-100 text-[10px] leading-tight mb-1 line-clamp-2 break-words" title="${escapeHTML(book.subject)}">
                    ${escapeHTML(shortSubject)}
                </div>
                <div class="text-[9px] font-mono text-slate-500 mb-1">
                    Diterima: <span class="font-bold text-emerald-600">${item.receivedCount}</span>/${item.qty}
                    ${remaining > 0 ? `<span class="text-amber-500">(-${remaining})</span>` : ''}
                </div>
                <button type="button" onclick="window.markAllColumnReceived(${inlineArgument(book.subject)})"
                    class="px-1.5 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 text-[8px] font-bold cursor-pointer" title="Tandai Semua Siswa yang Memesan Telah Menerima">
                    [✓ Semua Diterima]
                </button>
            </th>`;
    });

    headerHtml += `
        <th class="py-2.5 px-3 text-center min-w-[100px] bg-slate-200/70 dark:bg-slate-700/70 font-bold">Progress Terima</th>
    `;
    theadRow.innerHTML = headerHtml;

    // 2. Baris Siswa (Body) dengan Filter Pencarian
    const filteredStudents = currentClassStudents.filter(student => {
        if (!currentStudentSearchKeyword) return true;
        const nameMatch = (student.name || '').toLowerCase().includes(currentStudentSearchKeyword);
        const nisMatch = String(student.nis || '').toLowerCase().includes(currentStudentSearchKeyword);
        return nameMatch || nisMatch;
    });

    if (filteredStudents.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="${currentGradeBooks.length + 3}" class="text-center py-12 text-slate-400 italic">
                    ${currentStudentSearchKeyword ? `Tidak ada siswa yang cocok dengan pencarian "${escapeHTML(currentStudentSearchKeyword)}".` : 'Belum ada data siswa di rombel ini.'}
                </td>
            </tr>`;
        tfoot.innerHTML = '';
        renderMatrixDistributionCards();
        return;
    }

    let bodyHtml = '';
    filteredStudents.forEach((student, sIdx) => {
        const nis = String(student.nis || student.id || student.name);
        const studentName = student.name || `Siswa ${sIdx + 1}`;
        const studentRecord = currentMatrixData[nis]?.books || {};

        let orderedCount = 0;
        let receivedCount = 0;

        let cellsHtml = '';
        currentGradeBooks.forEach(book => {
            const entry = studentRecord[book.subject];
            const isOrdered = entry?.ordered === true;
            const isReceived = entry?.received === true;

            if (isOrdered) {
                orderedCount++;
                if (isReceived) receivedCount++;

                const btnClass = isReceived
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                    : 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800';

                const label = isReceived
                    ? '<i class="fa-solid fa-check mr-1 text-[10px]"></i>Diterima'
                    : '<i class="fa-solid fa-clock mr-1 text-[10px]"></i>Belum';

                cellsHtml += `
                    <td class="py-2 px-2.5 text-center border-r border-slate-100 dark:border-slate-800">
                        <button type="button"
                            onclick="window.toggleDistributionStatus(${inlineArgument(nis)}, ${inlineArgument(book.subject)})"
                            class="px-2 py-1 rounded-md text-[10px] font-bold border transition-colors shadow-2xs active:scale-95 cursor-pointer ${btnClass}"
                            title="${isReceived ? 'Buku fisik telah diserahkan (Klik untuk ubah)' : 'Buku belum diserahkan (Klik jika sudah diserahkan)'}">
                            ${label}
                        </button>
                    </td>`;
            } else {
                cellsHtml += `
                    <td class="py-2 px-2.5 text-center border-r border-slate-100 dark:border-slate-800 text-slate-300 dark:text-slate-600 select-none">
                        -
                    </td>`;
            }
        });

        const progressPercent = orderedCount > 0 ? Math.round((receivedCount / orderedCount) * 100) : 0;
        const progressColor = progressPercent === 100 ? 'text-emerald-600' : (progressPercent > 0 ? 'text-blue-600' : 'text-slate-400');

        bodyHtml += `
            <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                <td class="hidden sm:table-cell py-2 px-1.5 sm:px-3 text-center text-slate-400 font-mono text-xs sticky left-0 z-10 bg-white dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800">${sIdx + 1}</td>
                <td class="py-2 px-2 sm:px-3 sticky left-0 sm:left-10 z-10 bg-white dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800 min-w-[105px] max-w-[125px] sm:min-w-[180px] sm:max-w-none">
                    <div class="font-bold text-slate-800 dark:text-slate-100 text-xs truncate" title="${escapeHTML(studentName)}">${escapeHTML(studentName)}</div>
                </td>
                ${cellsHtml}
                <td class="py-2 px-3 text-center font-mono font-bold text-xs bg-slate-50/80 dark:bg-slate-800/40 ${progressColor}">
                    ${receivedCount}/${orderedCount} (${progressPercent}%)
                </td>
            </tr>`;
    });

    tbody.innerHTML = bodyHtml;

    // 3. Footer Bawah
    let footerHtml = `
        <tr>
            <td colspan="2" class="py-2.5 px-2 sm:px-3 text-right font-bold text-xs sticky left-0 z-10 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 min-w-[105px] max-w-[125px] sm:min-w-[230px] sm:max-w-none">
                <span class="truncate">TOTAL PENYERAHAN:</span>
            </td>
    `;

    currentGradeBooks.forEach(book => {
        const item = summary.items[book.subject] || { qty: 0, receivedCount: 0 };
        const percent = item.qty > 0 ? Math.round((item.receivedCount / item.qty) * 100) : 0;
        footerHtml += `
            <td class="py-2 px-2.5 text-center border-r border-slate-200 dark:border-slate-700">
                <div class="font-black text-xs font-mono ${percent === 100 ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-200'}">
                    ${item.receivedCount} / ${item.qty}
                </div>
                <div class="text-[10px] text-slate-400 font-mono">${percent}%</div>
            </td>`;
    });

    footerHtml += `
            <td class="py-2.5 px-3 text-center font-black text-xs font-mono text-emerald-600 dark:text-emerald-400 bg-slate-200 dark:bg-slate-700">
                ${summary.totalReceived} / ${summary.totalBooks}
            </td>
        </tr>
    `;
    tfoot.innerHTML = footerHtml;

    // Sinkronkan juga tampilan Kartu Distribusi di HP dan top scrollbar tabel
    renderMatrixDistributionCards();
    syncTopScrollbar('table-distribution-matrix', 'top-scrollbar-container-dist', 'top-scrollbar-track-dist');
}

/**
 * Render Kartu Pelacakan Distribusi Siswa di HP (Touch Friendly)
 */
export function renderMatrixDistributionCards() {
    const container = document.getElementById('cards-matrix-dist-list');
    if (!container) return;

    const filteredStudents = currentClassStudents.filter(student => {
        if (!currentStudentSearchKeyword) return true;
        const nameMatch = (student.name || '').toLowerCase().includes(currentStudentSearchKeyword);
        const nisMatch = String(student.nis || '').toLowerCase().includes(currentStudentSearchKeyword);
        return nameMatch || nisMatch;
    });

    if (filteredStudents.length === 0) {
        container.innerHTML = `
            <div class="text-center py-10 text-slate-400 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6">
                <i class="fa-solid fa-user-slash text-3xl mb-2 text-slate-300 dark:text-slate-600"></i>
                <p class="text-xs sm:text-sm font-semibold">${currentStudentSearchKeyword ? `Tidak ada siswa cocok dengan kata kunci "${escapeHTML(currentStudentSearchKeyword)}"` : 'Belum ada data siswa di rombel ini.'}</p>
            </div>`;
        return;
    }

    let cardsHtml = '';
    filteredStudents.forEach((student, sIdx) => {
        const nis = String(student.nis || student.id || student.name);
        const studentName = student.name || `Siswa ${sIdx + 1}`;
        const studentRecord = currentMatrixData[nis]?.books || {};

        let orderedCount = 0;
        let receivedCount = 0;
        let chipsHtml = '';

        currentGradeBooks.forEach(book => {
            const entry = studentRecord[book.subject];
            const isOrdered = entry?.ordered === true;
            const isReceived = entry?.received === true;

            if (isOrdered) {
                orderedCount++;
                if (isReceived) receivedCount++;

                chipsHtml += `
                    <button type="button"
                        onclick="window.toggleDistributionStatus(${inlineArgument(nis)}, ${inlineArgument(book.subject)})"
                        class="flex items-center justify-between p-2 sm:p-2.5 rounded-xl border text-xs cursor-pointer select-none transition-all active:scale-98 text-left ${isReceived ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200' : 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'}">
                        <div class="min-w-0 flex-1 mr-1">
                            <span class="font-bold block truncate leading-tight">${escapeHTML(book.subject)}</span>
                            <span class="text-[9px] opacity-75 font-mono block">
                                ${isReceived ? (entry.receivedAt ? 'Diterima: ' + formatTimestampShort(entry.receivedAt) : 'Diterima') : 'Belum Diserahkan'}
                            </span>
                        </div>
                        <span class="px-2 py-0.5 rounded-md text-[10px] font-black shrink-0 ${isReceived ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'}">
                            ${isReceived ? '✓ Diterima' : '⏳ Belum'}
                        </span>
                    </button>
                `;
            }
        });

        const progressPercent = orderedCount > 0 ? Math.round((receivedCount / orderedCount) * 100) : 0;
        const progressColor = progressPercent === 100 ? 'text-emerald-600 dark:text-emerald-400' : (progressPercent > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400');

        cardsHtml += `
            <div class="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-3 sm:p-3.5 shadow-2xs space-y-2.5">
                <div class="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-2.5">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center font-black text-xs font-mono shrink-0">
                            ${sIdx + 1}
                        </span>
                        <div class="min-w-0">
                            <h4 class="font-bold text-slate-800 dark:text-white text-xs sm:text-sm truncate" title="${escapeHTML(studentName)}">
                                ${escapeHTML(studentName)}
                            </h4>
                            <div class="text-[10px] text-slate-400 font-mono">
                                NIS: ${escapeHTML(student.nis || '-')}
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <span class="text-xs font-bold font-mono ${progressColor}">
                            ${receivedCount}/${orderedCount} (${progressPercent}%)
                        </span>
                        ${(orderedCount > 0 && receivedCount < orderedCount) ? `
                            <button type="button" onclick="window.markStudentAllReceived(${inlineArgument(nis)})"
                                class="px-2 py-1 text-[10px] font-bold rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 active:scale-95 cursor-pointer" title="Tandai Semua Diterima">
                                [✓ Selesai]
                            </button>
                        ` : ''}
                    </div>
                </div>
                ${orderedCount > 0 ? `
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-2">
                        ${chipsHtml}
                    </div>
                ` : `
                    <div class="text-slate-400 text-xs italic py-1">Tidak ada pesanan buku untuk siswa ini.</div>
                `}
            </div>
        `;
    });

    container.innerHTML = cardsHtml;
}

/**
 * Render Tabel Tab 3: Tagihan & Kwitansi per Siswa
 */
export function renderMatrixRekapTable() {
    const tbody = document.getElementById('table-rekap-body');
    const tfoot = document.getElementById('table-rekap-footer');
    if (!tbody || !tfoot) return;

    const filteredStudents = currentClassStudents.filter(student => {
        if (!currentStudentSearchKeyword) return true;
        const nameMatch = (student.name || '').toLowerCase().includes(currentStudentSearchKeyword);
        const nisMatch = String(student.nis || '').toLowerCase().includes(currentStudentSearchKeyword);
        return nameMatch || nisMatch;
    });

    if (filteredStudents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-slate-400 italic">${currentStudentSearchKeyword ? `Tidak ada siswa yang cocok dengan "${escapeHTML(currentStudentSearchKeyword)}".` : 'Belum ada siswa di rombel ini.'}</td></tr>`;
        tfoot.innerHTML = '';
        renderMatrixRekapCards();
        return;
    }

    let grandTotalBooks = 0;
    let grandTotalValue = 0;
    let bodyHtml = '';

    filteredStudents.forEach((student, sIdx) => {
        const nis = String(student.nis || student.id || student.name);
        const studentName = student.name || `Siswa ${sIdx + 1}`;
        const studentRecord = currentMatrixData[nis]?.books || {};

        const orderedBooks = [];
        let studentTotalValue = 0;

        currentGradeBooks.forEach(book => {
            if (studentRecord[book.subject]?.ordered === true) {
                const p = parseInt(book.harga, 10) || 0;
                orderedBooks.push({ subject: book.subject, price: p });
                studentTotalValue += p;
            }
        });

        grandTotalBooks += orderedBooks.length;
        grandTotalValue += studentTotalValue;

        const booksListHtml = orderedBooks.length > 0
            ? orderedBooks.map(b => `<span class="inline-block mr-1.5 mb-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-medium border border-slate-200 dark:border-slate-700">${escapeHTML(b.subject)} (${formatRupiah(b.price)})</span>`).join('')
            : '<span class="text-slate-400 text-xs italic">Tidak memesan buku LKS</span>';

        bodyHtml += `
            <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                <td class="hidden sm:table-cell py-1.5 sm:py-2 px-2.5 text-center text-slate-400 font-mono text-xs sticky left-0 z-10 bg-white dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800">${sIdx + 1}</td>
                <td class="py-1.5 sm:py-2 px-2 sm:px-2.5 text-xs sm:text-sm min-w-[105px] max-w-[140px] sm:max-w-none sticky left-0 sm:left-12 z-10 bg-white dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800">
                    <div class="font-bold text-slate-800 dark:text-slate-100 truncate" title="${escapeHTML(studentName)}">${escapeHTML(studentName)}</div>
                </td>
                <td class="py-1.5 sm:py-2 px-2.5">${booksListHtml}</td>
                <td class="py-1.5 sm:py-2 px-2 text-center font-mono font-bold text-xs ${orderedBooks.length > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}">
                    ${orderedBooks.length} buku
                </td>
                <td class="py-1.5 sm:py-2 px-2.5 text-right font-mono font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-100">
                    ${formatRupiah(studentTotalValue)}
                </td>
            </tr>`;
    });

    if (grandTotalBooks === 0 && !currentStudentSearchKeyword) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="py-10 px-4 text-center">
                    <div class="max-w-sm mx-auto space-y-3">
                        <div class="w-12 h-12 mx-auto rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-500 flex items-center justify-center text-xl">
                            <i class="fa-solid fa-cart-shopping"></i>
                        </div>
                        <div>
                            <h4 class="font-bold text-slate-800 dark:text-white text-sm">Belum Ada Buku yang Dipesan</h4>
                            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Rombel ${escapeHTML(activeClassName)} belum memiliki pesanan buku LKS. Silakan pilih dan centang pesanan buku siswa pada Tab Pemesanan terlebih dahulu.</p>
                        </div>
                        <button type="button" onclick="window.switchTab('matrix-order')"
                            class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-xs transition active:scale-95 cursor-pointer">
                            <i class="fa-solid fa-arrow-left"></i>
                            <span>Buka Tab Pemesanan Sekarang</span>
                        </button>
                    </div>
                </td>
            </tr>`;
        tfoot.innerHTML = '';
        renderMatrixRekapCards();
        return;
    }

    tbody.innerHTML = bodyHtml;

    tfoot.innerHTML = `
        <tr>
            <td class="hidden sm:table-cell py-2 px-2.5 text-center text-slate-400 sticky left-0 z-10 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700"></td>
            <td colspan="2" class="py-2 px-2.5 text-right font-bold text-xs sticky left-0 sm:left-12 z-10 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700">TOTAL KESELURUHAN TAGIHAN ROMBEL:</td>
            <td class="py-2 px-2 text-center font-mono font-black text-xs sm:text-sm text-emerald-600 dark:text-emerald-400">${grandTotalBooks} buku</td>
            <td class="py-2 px-2.5 text-right font-mono font-black text-xs sm:text-sm text-emerald-600 dark:text-emerald-400">${formatRupiah(grandTotalValue)}</td>
        </tr>
    `;

    // Sinkronkan juga tampilan Kartu Rekap di HP
    renderMatrixRekapCards();
}

/**
 * Render Kartu Rekapitulasi Tagihan per Siswa di HP (Dilengkapi Tombol Salin WA)
 */
export function renderMatrixRekapCards() {
    const container = document.getElementById('cards-rekap-list');
    if (!container) return;

    const filteredStudents = currentClassStudents.filter(student => {
        if (!currentStudentSearchKeyword) return true;
        const nameMatch = (student.name || '').toLowerCase().includes(currentStudentSearchKeyword);
        const nisMatch = String(student.nis || '').toLowerCase().includes(currentStudentSearchKeyword);
        return nameMatch || nisMatch;
    });

    if (filteredStudents.length === 0) {
        container.innerHTML = `
            <div class="text-center py-10 text-slate-400 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6">
                <i class="fa-solid fa-user-slash text-3xl mb-2 text-slate-300 dark:text-slate-600"></i>
                <p class="text-xs sm:text-sm font-semibold">${currentStudentSearchKeyword ? `Tidak ada siswa cocok dengan kata kunci "${escapeHTML(currentStudentSearchKeyword)}"` : 'Belum ada data siswa di rombel ini.'}</p>
            </div>`;
        return;
    }

    let grandTotalBooks = 0;
    const studentOrders = filteredStudents.map(student => {
        const nis = String(student.nis || student.id || student.name);
        const studentName = student.name || `Siswa NIS ${nis}`;
        const studentRecord = currentMatrixData[nis]?.books || {};

        const orderedBooks = [];
        let studentTotalValue = 0;

        currentGradeBooks.forEach(book => {
            if (studentRecord[book.subject]?.ordered === true) {
                const p = parseInt(book.harga, 10) || 0;
                orderedBooks.push({ subject: book.subject, price: p });
                studentTotalValue += p;
            }
        });

        grandTotalBooks += orderedBooks.length;
        return {
            nis,
            student,
            studentName,
            orderedBooks,
            studentTotalValue
        };
    });

    if (grandTotalBooks === 0 && !currentStudentSearchKeyword) {
        container.innerHTML = `
            <div class="text-center py-10 px-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs space-y-3">
                <div class="w-12 h-12 mx-auto rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-500 flex items-center justify-center text-xl">
                    <i class="fa-solid fa-cart-shopping"></i>
                </div>
                <div class="max-w-xs mx-auto">
                    <h4 class="font-bold text-slate-800 dark:text-white text-sm">Belum Ada Tagihan Buku</h4>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Belum ada buku LKS yang dicentang untuk rombel ${escapeHTML(activeClassName)}. Rincian tagihan per siswa akan otomatis muncul setelah pesanan dipilih.</p>
                </div>
                <button type="button" onclick="window.switchTab('matrix-order')"
                    class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-xs transition active:scale-95 cursor-pointer">
                    <i class="fa-solid fa-arrow-left"></i>
                    <span>Buka Tab Pemesanan Sekarang</span>
                </button>
            </div>
        `;
        return;
    }

    let cardsHtml = '';
    studentOrders.forEach((item, sIdx) => {
        const { nis, studentName, orderedBooks, studentTotalValue } = item;

        if (orderedBooks.length > 0) {
            const booksChips = orderedBooks.map(b => `<span class="inline-block px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-semibold border border-slate-200 dark:border-slate-700">${escapeHTML(b.subject)} · ${formatRupiah(b.price)}</span>`).join('');

            cardsHtml += `
                <div class="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-3 sm:p-3.5 shadow-2xs space-y-2.5">
                    <div class="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                        <div class="min-w-0 flex items-center gap-1.5">
                            <span class="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center font-bold text-[10px] font-mono shrink-0">${sIdx + 1}</span>
                            <h4 class="font-bold text-slate-800 dark:text-white text-xs sm:text-sm truncate" title="${escapeHTML(studentName)}">${escapeHTML(studentName)}</h4>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-xs sm:text-sm font-black font-mono text-emerald-600 dark:text-emerald-400">${formatRupiah(studentTotalValue)}</div>
                            <div class="text-[10px] text-slate-400 font-mono">${orderedBooks.length} buku</div>
                        </div>
                    </div>
                    <div class="flex flex-wrap gap-1">
                        ${booksChips}
                    </div>
                    <div class="pt-1 flex justify-end">
                        <button type="button" onclick="window.copyStudentBillSummary(${inlineArgument(nis)})"
                            class="px-2.5 py-1.5 text-xs font-bold rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80 flex items-center gap-1.5 active:scale-95 cursor-pointer shadow-2xs" title="Salin Tagihan ke Format Pesan WhatsApp">
                            <i class="fa-brands fa-whatsapp text-sm text-emerald-600 dark:text-emerald-400"></i>
                            <span>Salin Tagihan (WA)</span>
                        </button>
                    </div>
                </div>
            `;
        } else {
            // Siswa tanpa pesanan: Compact 1 baris
            cardsHtml += `
                <div class="bg-white/60 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800/60 rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-xs">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center font-bold text-[10px] font-mono shrink-0">${sIdx + 1}</span>
                        <span class="font-medium text-slate-500 dark:text-slate-400 truncate" title="${escapeHTML(studentName)}">${escapeHTML(studentName)}</span>
                    </div>
                    <span class="text-[11px] text-slate-400 italic shrink-0">Tidak memesan</span>
                </div>
            `;
        }
    });

    container.innerHTML = cardsHtml;
}

/**
 * Mengatur Mode Tampilan (Kartu HP vs Tabel Matriks)
 */
export function setViewMode(mode) {
    currentViewMode = mode;
    try {
        localStorage.setItem('simas_pesan_lks_view_mode', mode);
    } catch (e) {}

    // Perbarui styling tombol toggle
    const btnCardsList = document.querySelectorAll('.btn-view-cards-toggle');
    const btnTableList = document.querySelectorAll('.btn-view-table-toggle');

    btnCardsList.forEach(btn => {
        if (mode === 'cards') {
            btn.className = 'btn-view-cards-toggle flex-1 sm:flex-none px-2.5 py-1 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-bold';
            const icon = btn.querySelector('i');
            if (icon) icon.className = 'fa-solid fa-table-list text-xs text-emerald-500';
        } else {
            btn.className = 'btn-view-cards-toggle flex-1 sm:flex-none px-2.5 py-1 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-semibold';
            const icon = btn.querySelector('i');
            if (icon) icon.className = 'fa-solid fa-table-list text-xs';
        }
    });

    btnTableList.forEach(btn => {
        if (mode === 'table') {
            btn.className = 'btn-view-table-toggle flex-1 sm:flex-none px-2.5 py-1 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-bold';
            const icon = btn.querySelector('i');
            if (icon) icon.className = 'fa-solid fa-table text-xs text-emerald-500';
        } else {
            btn.className = 'btn-view-table-toggle flex-1 sm:flex-none px-2.5 py-1 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-semibold';
            const icon = btn.querySelector('i');
            if (icon) icon.className = 'fa-solid fa-table text-xs';
        }
    });

    // Kontainer Tab 1: Pemesanan
    const orderCards = document.getElementById('container-matrix-order-cards');
    const orderTable = document.getElementById('container-matrix-order-table');
    if (orderCards && orderTable) {
        if (mode === 'cards') {
            orderCards.classList.remove('hidden');
            orderTable.classList.add('hidden');
        } else {
            orderCards.classList.add('hidden');
            orderTable.classList.remove('hidden');
        }
    }

    // Kontainer Tab 2: Tagihan / Rekap
    const rekapCards = document.getElementById('cards-rekap-list');
    const rekapTable = document.getElementById('container-rekap-table');
    if (rekapCards && rekapTable) {
        if (mode === 'cards') {
            rekapCards.classList.remove('hidden');
            rekapTable.classList.add('hidden');
        } else {
            rekapCards.classList.add('hidden');
            rekapTable.classList.remove('hidden');
        }
    }

    if (mode === 'table') {
        syncAllMatrixScrollbars();
    }
}

/**
 * Filter pencarian real-time nama atau NIS siswa
 */
export function onStudentSearchInput(keyword) {
    currentStudentSearchKeyword = (keyword || '').toLowerCase().trim();

    // Sinkronkan input pencarian dan toggle tombol clear
    const searchInputs = document.querySelectorAll('.input-student-search');
    const clearBtns = document.querySelectorAll('.btn-clear-student-search');

    searchInputs.forEach(inp => {
        if (inp.value !== keyword) inp.value = keyword;
    });

    clearBtns.forEach(btn => {
        if (currentStudentSearchKeyword) {
            btn.classList.remove('hidden');
        } else {
            btn.classList.add('hidden');
        }
    });

    if (currentActiveTab === 'matrix-order') renderMatrixOrderTable();
    else if (currentActiveTab === 'matrix-rekap') renderMatrixRekapTable();
}

/**
 * Reset kata kunci pencarian siswa
 */
export function clearStudentSearch() {
    onStudentSearchInput('');
}

/**
 * Centang atau batalkan seluruh buku untuk 1 siswa di Mode Kartu
 */
export function toggleStudentAllBooks(nis, shouldOrder) {
    if (isSubmittingMatrix || isHistoryReadOnly) return;
    const student = currentClassStudents.find(s => String(s.nis || s.id || s.name) === String(nis));
    const studentName = student?.name || `Siswa NIS ${nis}`;

    if (!currentMatrixData[nis]) {
        currentMatrixData[nis] = { name: studentName, books: {} };
    }
    if (!currentMatrixData[nis].books) {
        currentMatrixData[nis].books = {};
    }

    currentGradeBooks.forEach(book => {
        if (shouldOrder) {
            currentMatrixData[nis].books[book.subject] = {
                ordered: true,
                received: false,
                receivedAt: null
            };
        } else {
            if (currentMatrixData[nis].books[book.subject]) {
                currentMatrixData[nis].books[book.subject].ordered = false;
            }
        }
    });

    setMatrixOrderDirty(true);
    updateKpiCards();
    renderMatrixOrderTable();
    saveClassMatrixData(activeClassName, false);
    showToast('Diperbarui', `${studentName} telah ${shouldOrder ? 'didaftarkan memesan semua' : 'dibatalkan memesan'} buku LKS.`, 'info');
}

/**
 * Tandai seluruh pesanan buku 1 siswa telah diterima fisiknya
 */
export function markStudentAllReceived(nis) {
    if (!currentMatrixData[nis]?.books) return;
    const student = currentClassStudents.find(s => String(s.nis || s.id || s.name) === String(nis));
    const studentName = student?.name || currentMatrixData[nis].name || `Siswa NIS ${nis}`;

    let count = 0;
    Object.keys(currentMatrixData[nis].books).forEach(subject => {
        const entry = currentMatrixData[nis].books[subject];
        if (entry && entry.ordered && !entry.received) {
            entry.received = true;
            entry.receivedAt = new Date().toISOString();
            count++;
        }
    });

    updateKpiCards();
    renderMatrixDistributionTable();
    saveClassMatrixData(activeClassName, false);
    showToast('Selesai', `Seluruh pesanan buku (${count} buku) untuk ${studentName} ditandai telah diterima.`, 'success');
}

/**
 * Salin ringkasan tagihan buku LKS per siswa ke format pesan WhatsApp
 */
export function copyStudentBillSummary(nis) {
    const student = currentClassStudents.find(s => String(s.nis || s.id || s.name) === String(nis));
    const studentName = student?.name || currentMatrixData[nis]?.name || `Siswa NIS ${nis}`;
    const studentRecord = currentMatrixData[nis]?.books || {};

    const orderedBooks = [];
    let totalBill = 0;

    currentGradeBooks.forEach(book => {
        if (studentRecord[book.subject]?.ordered === true) {
            const p = parseInt(book.harga, 10) || 0;
            orderedBooks.push({ subject: book.subject, price: p });
            totalBill += p;
        }
    });

    if (orderedBooks.length === 0) {
        showToast('Info', `${studentName} tidak memiliki pesanan buku LKS.`, 'info');
        return;
    }

    let msg = `*RINCIAN TAGIHAN BUKU LKS - ${SCHOOL_CONFIG.schoolNameUpper}*\n`;
    msg += `------------------------------------------\n`;
    msg += `Nama: *${studentName}*\n`;
    msg += `Kelas: *${activeClassName}*\n`;
    msg += `NIS: ${student?.nis || '-'}\n`;
    msg += `------------------------------------------\n`;
    orderedBooks.forEach((b, i) => {
        msg += `${i + 1}. LKS ${b.subject}: ${formatRupiah(b.price)}\n`;
    });
    msg += `------------------------------------------\n`;
    msg += `*Total Tagihan: ${formatRupiah(totalBill)}* (${orderedBooks.length} buku)\n\n`;
    msg += `_Catatan: Harap melakukan pembayaran melalui Pengurus/Admin Kelas._`;

    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(msg).then(() => {
            showToast('Tersalin!', `Rincian tagihan WhatsApp untuk ${studentName} berhasil disalin ke clipboard.`, 'success');
        }).catch(() => {
            showToast('Info', 'Gagal menyalin otomatis, silakan salin manual.', 'warning');
        });
    } else {
        showToast('Tersalin', `Rincian tagihan untuk ${studentName} berhasil disiapkan.`, 'info');
    }
}
export function switchTab(tabKey) {
    currentActiveTab = tabKey;

    const tabs = ['matrix-order', 'matrix-rekap'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-btn-${t}`);
        const panel = document.getElementById(`tab-panel-${t}`);
        if (btn) {
            if (t === tabKey) {
                btn.className = 'py-3 px-3 sm:px-4 border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold text-xs sm:text-sm flex items-center gap-2 -mb-px whitespace-nowrap transition-colors cursor-pointer';
            } else {
                btn.className = 'py-3 px-3 sm:px-4 border-b-2 border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-semibold text-xs sm:text-sm flex items-center gap-2 -mb-px whitespace-nowrap transition-colors cursor-pointer';
            }
        }
        if (panel) {
            if (t === tabKey) panel.classList.remove('hidden');
            else panel.classList.add('hidden');
        }
    });

    if (tabKey === 'matrix-order') renderMatrixOrderTable();
    else if (tabKey === 'matrix-rekap') renderMatrixRekapTable();

    // Pastikan sinkronisasi mode tampilan (kartu HP vs tabel) dan scrollbar selalu aktif saat berpindah tab
    setViewMode(currentViewMode);
}

/**
 * Handler ketika checkbox pemesanan per siswa diubah
 */
export function onMatrixOrderCheckChanged(nis, studentName, subject, isChecked) {
    if (isSubmittingMatrix || isHistoryReadOnly) return;
    if (!currentMatrixData[nis]) {
        currentMatrixData[nis] = { name: studentName, books: {} };
    }
    if (!currentMatrixData[nis].books) {
        currentMatrixData[nis].books = {};
    }

    if (isChecked) {
        currentMatrixData[nis].books[subject] = {
            ordered: true,
            received: false,
            receivedAt: null
        };
    } else {
        if (currentMatrixData[nis].books[subject]) {
            currentMatrixData[nis].books[subject].ordered = false;
        }
    }

    setMatrixOrderDirty(true);
    updateKpiCards();
    renderMatrixOrderTable();
    saveClassMatrixData(activeClassName, false);
}

/**
 * Handler tombol cepat centang/kosongkan seluruh kolom mapel
 */
export function toggleAllColumnOrders(subject, shouldOrder) {
    if (isSubmittingMatrix || isHistoryReadOnly) return;
    currentClassStudents.forEach(student => {
        const nis = String(student.nis || student.id || student.name);
        if (!currentMatrixData[nis]) {
            currentMatrixData[nis] = { name: student.name, books: {} };
        }
        if (!currentMatrixData[nis].books) {
            currentMatrixData[nis].books = {};
        }

        if (shouldOrder) {
            currentMatrixData[nis].books[subject] = {
                ordered: true,
                received: false,
                receivedAt: null
            };
        } else {
            if (currentMatrixData[nis].books[subject]) {
                currentMatrixData[nis].books[subject].ordered = false;
            }
        }
    });

    setMatrixOrderDirty(true);
    updateKpiCards();
    renderMatrixOrderTable();
    saveClassMatrixData(activeClassName, false);
    showToast('Diperbarui', `Seluruh siswa telah ${shouldOrder ? 'didaftarkan' : 'dibatalkan'} untuk LKS ${subject}.`, 'info');
}

/**
 * Toggle status penyerahan fisik (Distribusi Bertahap: Belum ⟷ Diterima)
 */
export function toggleDistributionStatus(nis, subject) {
    if (!currentMatrixData[nis]?.books?.[subject]) return;

    const entry = currentMatrixData[nis].books[subject];
    const newStatus = !entry.received;
    entry.received = newStatus;
    entry.receivedAt = newStatus ? new Date().toISOString() : null;

    updateKpiCards();
    renderMatrixDistributionTable();
    saveClassMatrixData(activeClassName, false);

    showToast(
        newStatus ? 'Buku Diterima' : 'Dibatalkan',
        newStatus ? `LKS ${subject} ditandai sudah diserahkan ke ${currentMatrixData[nis].name}.` : `Status penyerahan LKS ${subject} dibatalkan.`,
        newStatus ? 'success' : 'info'
    );
}

/**
 * Tandai seluruh siswa yang memesan mapel tertentu telah menerima buku
 */
export function markAllColumnReceived(subject) {
    let count = 0;
    currentClassStudents.forEach(student => {
        const nis = String(student.nis || student.id || student.name);
        const entry = currentMatrixData[nis]?.books?.[subject];
        if (entry && entry.ordered && !entry.received) {
            entry.received = true;
            entry.receivedAt = new Date().toISOString();
            count++;
        }
    });

    updateKpiCards();
    renderMatrixDistributionTable();
    saveClassMatrixData(activeClassName, false);
    showToast('Selesai', `${count} siswa yang memesan LKS ${subject} ditandai telah menerima buku.`, 'success');
}

/**
 * Membuka Modal Konfirmasi Pengiriman Pemesanan Rombel
 */
export function saveMatrixOrders() {
    if (isHistoryReadOnly) {
        showToast('Histori Read-Only', 'Semester lampau bersifat read-only dan tidak dapat diubah.', 'warning');
        return;
    }
    const summary = calculateMatrixSummary();
    if (summary.totalBooks === 0 && !isMatrixOrderDirty) {
        showToast('Peringatan', 'Belum ada buku yang dicentang untuk dipesan pada rombel ini.', 'warning');
        return;
    }

    const modal = document.getElementById('modal-confirm-matrix');
    const elClassName = document.getElementById('modal-confirm-class-name');
    const elTotalBooks = document.getElementById('modal-confirm-total-books');
    const elTotalVal = document.getElementById('modal-confirm-total-value');

    if (elClassName) elClassName.textContent = activeClassName;
    if (elTotalBooks) elTotalBooks.textContent = `${summary.totalBooks} eksemplar`;
    if (elTotalVal) elTotalVal.textContent = formatRupiah(summary.totalValue);

    if (modal) modal.classList.remove('hidden');
}

/**
 * Menutup Modal Konfirmasi
 */
export function closeConfirmModal() {
    const modal = document.getElementById('modal-confirm-matrix');
    if (modal) modal.classList.add('hidden');
}

/**
 * Eksekusi pengiriman pemesanan rombel ke sistem sekolah
 */
export async function executeSubmitMatrixOrder() {
    if (isSubmittingMatrix || !activeClassName || isHistoryReadOnly) return;
    isSubmittingMatrix = true;
    showToast('Mengirim', 'Pesanan sedang disimpan ke server.', 'info');
    const previousStatus = currentMatrixStatus;
    closeConfirmModal();
    currentMatrixStatus = 'pending';
    let saved;
    try {
        saved = await saveClassMatrixData(activeClassName, true);
    } finally {
        isSubmittingMatrix = false;
    }
    if (!saved) {
        currentMatrixStatus = previousStatus;
        setMatrixOrderDirty(true);
        await saveClassMatrixData(activeClassName, false);
        updateKpiCards();
        return;
    }
    setMatrixOrderDirty(false);
    updateKpiCards();

    showToast('Berhasil Dikirim', `Pemesanan buku rombel ${activeClassName} berhasil disimpan & dikirim ke pengelola sekolah.`, 'success');
}

/**
 * Cetak Rekapitulasi Tagihan & Matriks Kelas (Window Print Friendly)
 */
export function printMatrixSummary() {
    window.print();
}

/**
 * Handler ketika rombel aktif diubah (Super Admin)
 */
export async function onActiveClassChanged(newClass) {
    if (isSubmittingMatrix) {
        const selectEl = document.getElementById('header-class-select');
        if (selectEl) selectEl.value = activeClassName;
        return;
    }
    if (!newClass || newClass === activeClassName) return;

    if (isMatrixOrderDirty && typeof window !== 'undefined') {
        const confirmLeave = window.confirm(`Terdapat perubahan pemesanan buku untuk rombel ${activeClassName} yang belum disimpan!\n\nYakin ingin berpindah ke rombel ${newClass} tanpa menyimpan?`);
        if (!confirmLeave) {
            const selectEl = document.getElementById('header-class-select');
            if (selectEl) selectEl.value = activeClassName;
            return;
        }
    }

    activeClassName = newClass;
    activeGrade = extractGradeFromClassName(activeClassName);

    const elHeaderClass = document.getElementById('header-class-name');
    if (elHeaderClass) elHeaderClass.textContent = `Rombel: ${activeClassName}`;

    await loadClassDataAndRender(activeClassName);
}

/**
 * Handler ketika semester aktif diubah melalui dropdown di header
 */
export async function onActiveSemesterChanged(semesterVal) {
    if (isSubmittingMatrix) {
        const sel = document.getElementById('header-semester-select');
        if (sel) sel.value = activeSemester;
        return;
    }
    const val = String(semesterVal || '1');
    if (val === activeSemester) return;

    if (isMatrixOrderDirty && typeof window !== 'undefined') {
        const confirmLeave = window.confirm(`Terdapat perubahan pemesanan buku pada Semester ${activeSemester} yang belum disimpan!\n\nYakin ingin berpindah ke Semester ${val} tanpa menyimpan?`);
        if (!confirmLeave) {
            const sel = document.getElementById('header-semester-select');
            if (sel) sel.value = activeSemester;
            return;
        }
    }

    activeSemester = val;
    isMatrixOrderDirty = false;
    setMatrixOrderDirty(false);

    applyHistoryReadOnlyState();
    await loadClassDataAndRender(activeClassName);

    showToast('Semester Berubah', `Menampilkan data pemesanan LKS Semester ${activeSemester}${isHistoryReadOnly ? ' (Histori Read-Only)' : ' (Berjalan)'}.`, 'info');
}

/**
 * Memuat data siswa, buku, dan matriks untuk rombel tertentu
 */
export async function loadClassDataAndRender(className) {
    activeGrade = extractGradeFromClassName(className);

    // Sinkronkan status Read-Only histori semester
    applyHistoryReadOnlyState();

    // Pastikan Jadwal XML sudah dimuat/diparse
    if (!currentParsedSchedule) {
        try {
            currentParsedSchedule = await parseASCSchedule();
        } catch (err) {
            console.warn('[PesanLKS] Gagal memuat/parsing jadwal XML:', err);
        }
    }

    // Ambil daftar nama mapel resmi untuk rombel ini dari Jadwal XML
    const scheduleSubjects = getSubjectsForClassSchedule(activeGrade, className, currentParsedSchedule, currentBookData);
    const scheduleSubjectsSet = new Set(scheduleSubjects.map(s => (s || '').toLowerCase().trim()));

    // Filter buku LKS yang aktif untuk jenjang, rombel, dan periode semester ini:
    // 1. Status master buku aktif (isActive !== false)
    // 2. Jenjang sesuai (String(b.grade) === String(activeGrade))
    // 3. Periode semester sesuai jika metadata periode/semester ada pada buku
    // 4. Hanya mapel yang diajarkan pada rombel ini di Jadwal XML
    currentGradeBooks = currentBookData.filter(b => {
        if (b.isActive === false) return false;
        if (String(b.grade) !== String(activeGrade)) return false;

        // Filter periode semester jika buku memiliki properti periode / semester
        if (b.periode || b.semester) {
            const p = String(b.periode || b.semester).toLowerCase().trim();
            if (activeSemester === '1' && (p === '2' || p === 'genap' || p.includes('genap') || p.includes('sem 2') || p.includes('semester 2'))) {
                return false;
            }
            if (activeSemester === '2' && (p === '1' || p === 'ganjil' || p.includes('ganjil') || p.includes('sem 1') || p.includes('semester 1'))) {
                return false;
            }
        }

        if (scheduleSubjectsSet.size > 0) {
            return scheduleSubjectsSet.has((b.subject || '').toLowerCase().trim());
        }
        return true;
    });

    // Urutkan buku berdasarkan abjad mapel
    currentGradeBooks.sort((a, b) => (a.subject || '').localeCompare(b.subject || ''));
    renderBookStockSummary();

    // Ambil data siswa
    currentClassStudents = await fetchStudentsForClass(className);

    // Ambil matriks tersimpan untuk semester aktif
    await loadClassMatrixData(className, activeSemester);

    // Perbarui metrik & tampilan
    updateKpiCards();
    switchTab(currentActiveTab);
}

/**
 * Inisialisasi Halaman Matriks Pesan LKS
 */
export async function initPesanLksPage() {
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname);
            return;
        }

        // Cek RBAC: Hanya Admin Kelas dan Super Admin
        let role = localStorage.getItem('user_role');
        let userDocData = null;

        if (window.getCurrentUserDoc) {
            try {
                userDocData = await window.getCurrentUserDoc();
                if (!role && userDocData?.role) {
                    role = userDocData.role;
                    localStorage.setItem('user_role', role);
                }
            } catch (e) {}
        }

        const isAuthorized = role === 'admin_kelas' || role === 'super_admin' ||
            (typeof window.hasRole === 'function' && (window.hasRole('admin_kelas') || window.hasRole('super_admin')));

        const main = document.querySelector('main');
        const denied = document.getElementById('access-denied-container');

        if (!isAuthorized) {
            if (main) main.classList.add('hidden');
            if (denied) denied.classList.remove('hidden');
            return;
        }

        const effectiveRole = role === 'super_admin' || (typeof window.hasRole === 'function' && window.hasRole('super_admin')) ? 'super_admin' : 'admin_kelas';
        await initLayout(effectiveRole);

        if (main) main.classList.remove('hidden');
        if (denied) denied.classList.add('hidden');

        // Setup Informasi User & Rombel
        const userName = localStorage.getItem('user_name') || userDocData?.name || user.displayName || 'Admin';
        const isSuperAdmin = effectiveRole === 'super_admin';

        let assignedClass = '';
        if (isSuperAdmin) {
            assignedClass = 'X-1'; // Default rombel untuk super admin
        } else {
            assignedClass = userDocData?.assignedClass || userDocData?.kelas || userDocData?.class || localStorage.getItem('user_assigned_class') || localStorage.getItem('user_kelas') || '';
            if (!assignedClass) {
                if (main) main.classList.add('hidden');
                if (denied) denied.classList.remove('hidden');
                showToast('Rombel Belum Diatur', 'Hubungi admin sekolah untuk menetapkan rombel akun Anda.', 'warning');
                return;
            }
        }

        activeClassName = assignedClass;
        activeGrade = extractGradeFromClassName(activeClassName);

        currentUserInfo = {
            uid: user.uid,
            name: userName,
            role: effectiveRole,
            class: assignedClass
        };

        // Header Metadata
        const elHeaderUser = document.getElementById('header-user-name');
        if (elHeaderUser) elHeaderUser.textContent = userName;

        const elHeaderClass = document.getElementById('header-class-name');
        if (elHeaderClass) elHeaderClass.textContent = `Rombel: ${activeClassName}`;

        const elHeaderDate = document.getElementById('header-current-date');
        if (elHeaderDate) {
            elHeaderDate.textContent = typeof formatDateIndo === 'function'
                ? formatDateIndo(new Date().toISOString())
                : new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        }

        // Tampilkan pemilih rombel di header jika Super Admin
        const pickerSuperAdmin = document.getElementById('header-superadmin-class-picker');
        const selectHeaderClass = document.getElementById('header-class-select');
        if (isSuperAdmin && pickerSuperAdmin && selectHeaderClass) {
            pickerSuperAdmin.classList.remove('hidden');
            const allClasses = await getMasterClasses();

            // Kelompokkan rombel per jenjang untuk kejelasan visual dan keterbacaan tinggi di dropdown
            const groups = { 'X': [], 'XI': [], 'XII': [], 'Lainnya': [] };
            (allClasses || []).forEach(c => {
                const grade = extractGradeFromClassName(c);
                if (grade === '10') groups['X'].push(c);
                else if (grade === '11') groups['XI'].push(c);
                else if (grade === '12') groups['XII'].push(c);
                else groups['Lainnya'].push(c);
            });

            let optHtml = '';
            const renderGroup = (label, classes) => {
                if (!classes || classes.length === 0) return '';
                let html = `<optgroup label="${escapeHTML(label)}" class="bg-slate-900 text-slate-300 font-bold">`;
                classes.forEach(c => {
                    const isSel = c === activeClassName ? 'selected' : '';
                    html += `<option value="${escapeHTML(c)}" class="bg-slate-800 text-white font-medium" ${isSel}>${escapeHTML(c)}</option>`;
                });
                html += '</optgroup>';
                return html;
            };

            optHtml += renderGroup('Kelas X', groups['X']);
            optHtml += renderGroup('Kelas XI', groups['XI']);
            optHtml += renderGroup('Kelas XII', groups['XII']);
            optHtml += renderGroup('Rombel Lain', groups['Lainnya']);

            // Fallback datar jika tidak ada grup yang terdeteksi
            if (!optHtml && Array.isArray(allClasses)) {
                allClasses.forEach(c => {
                    const isSel = c === activeClassName ? 'selected' : '';
                    optHtml += `<option value="${escapeHTML(c)}" class="bg-slate-800 text-white font-medium" ${isSel}>${escapeHTML(c)}</option>`;
                });
            }

            selectHeaderClass.innerHTML = optHtml;
        }

        // Muat Data SSOT
        await loadBookSalesData();
        await loadOrdersData();

        // Setup Semester Aktif SSOT (Otomatis terpilih semester berjalan)
        const runningSem = getRunningSemester();
        activeSemester = runningSem;
        const selectSemester = document.getElementById('header-semester-select');
        if (selectSemester) {
            selectSemester.value = activeSemester;
        }
        applyHistoryReadOnlyState();

        // Setup preferensi View Mode (Default Mode Kartu di Mobile, Tabel di Layar Lebar)
        try {
            const savedMode = localStorage.getItem('simas_pesan_lks_view_mode');
            if (savedMode === 'cards' || savedMode === 'table') {
                currentViewMode = savedMode;
            } else {
                const isMobileDevice = typeof window !== 'undefined' && window.innerWidth < 640;
                currentViewMode = isMobileDevice ? 'cards' : 'table';
            }
        } catch (e) {
            const isMobileDevice = typeof window !== 'undefined' && window.innerWidth < 640;
            currentViewMode = isMobileDevice ? 'cards' : 'table';
        }
        // Tentukan preferensi sebelum render pertama yang menyimpan mode ke localStorage.
        await loadClassDataAndRender(activeClassName);
        setViewMode(currentViewMode);

        // Event Listener Tombol Segarkan
        const btnRefresh = document.getElementById('btn-refresh');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', async () => {
                if (isSubmittingMatrix) return;
                if (isMatrixOrderDirty && !window.confirm('Ada perubahan pesanan yang belum dikirim. Muat ulang data dari server?')) return;
                await loadBookSalesData();
                await loadOrdersData();
                await loadClassDataAndRender(activeClassName);
                showToast('Segar', 'Data buku, siswa, dan matriks rombel berhasil diperbarui.', 'info');
            });
        }

        // Event Listener Tombol Navigasi Geser Horisontal Matriks Pemesanan
        const btnScrollLeft = document.getElementById('btn-scroll-matrix-left');
        if (btnScrollLeft && !btnScrollLeft._hasClickListener) {
            btnScrollLeft._hasClickListener = true;
            btnScrollLeft.addEventListener('click', () => scrollMatrixHorizontally('table-order-matrix', -280));
        }
        const btnScrollRight = document.getElementById('btn-scroll-matrix-right');
        if (btnScrollRight && !btnScrollRight._hasClickListener) {
            btnScrollRight._hasClickListener = true;
            btnScrollRight.addEventListener('click', () => scrollMatrixHorizontally('table-order-matrix', 280));
        }

        // Event Listener Tombol Navigasi Geser Horisontal Rekap Tagihan
        const btnRekapLeft = document.getElementById('btn-scroll-rekap-left');
        if (btnRekapLeft && !btnRekapLeft._hasClickListener) {
            btnRekapLeft._hasClickListener = true;
            btnRekapLeft.addEventListener('click', () => scrollMatrixHorizontally('table-rekap', -280));
        }
        const btnRekapRight = document.getElementById('btn-scroll-rekap-right');
        if (btnRekapRight && !btnRekapRight._hasClickListener) {
            btnRekapRight._hasClickListener = true;
            btnRekapRight.addEventListener('click', () => scrollMatrixHorizontally('table-rekap', 280));
        }

        // Event Listener Resize Layar untuk Penyesuaian Lebar Scrollbar Matriks
        window.addEventListener('resize', () => {
            if (currentViewMode === 'table') {
                syncAllMatrixScrollbars();
            }
        });
    });

    // Ekspos Fungsi ke Window
    window.switchTab = switchTab;
    window.setViewMode = setViewMode;
    window.onStudentSearchInput = onStudentSearchInput;
    window.clearStudentSearch = clearStudentSearch;
    window.toggleStudentAllBooks = toggleStudentAllBooks;
    window.markStudentAllReceived = markStudentAllReceived;
    window.copyStudentBillSummary = copyStudentBillSummary;
    window.onMatrixOrderCheckChanged = onMatrixOrderCheckChanged;
    window.toggleAllColumnOrders = toggleAllColumnOrders;
    window.toggleDistributionStatus = toggleDistributionStatus;
    window.markAllColumnReceived = markAllColumnReceived;
    window.saveMatrixOrders = saveMatrixOrders;
    window.closeConfirmModal = closeConfirmModal;
    window.executeSubmitMatrixOrder = executeSubmitMatrixOrder;
    window.printMatrixSummary = printMatrixSummary;
    window.onActiveClassChanged = onActiveClassChanged;
    window.scrollMatrixHorizontally = scrollMatrixHorizontally;
    window.syncTopScrollbar = syncTopScrollbar;
    window.syncAllMatrixScrollbars = syncAllMatrixScrollbars;
    window.purgeExpiredOrders = purgeExpiredOrders;
    window.formatShortPrice = formatShortPrice;
    window.formatSubjectDisplayName = formatSubjectDisplayName;
    window.setMatrixOrderDirty = setMatrixOrderDirty;
    window.isMatrixOrderDirty = () => isMatrixOrderDirty;
    window.onActiveSemesterChanged = onActiveSemesterChanged;
    window.getActiveSemester = () => activeSemester;
    window.setActiveSemester = (s) => { activeSemester = String(s); applyHistoryReadOnlyState(); };
    window.isHistoryReadOnlyMode = () => isHistoryReadOnly;
    window.getRunningSemester = getRunningSemester;
    window.buildMatrixStorageKey = buildMatrixStorageKey;
    window.applyHistoryReadOnlyState = applyHistoryReadOnlyState;
}

/**
 * Memangkas riwayat pesanan buku yang berusia lebih dari retentionYears (default 5 tahun)
 */
export function purgeExpiredOrders(ordersList, retentionYears = 5) {
    if (!Array.isArray(ordersList)) return { payload: ordersList, purgedCount: 0 };
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - retentionYears);
    const cutoffDateStr = cutoffDate.toISOString().slice(0, 10);

    let purgedCount = 0;
    const kept = ordersList.filter(o => {
        const orderDate = o.date || (o.createdAt ? o.createdAt.slice(0, 10) : '');
        if (orderDate && orderDate < cutoffDateStr) {
            purgedCount++;
            return false;
        }
        return true;
    });

    return { payload: kept, purgedCount };
}

if (typeof window !== 'undefined') {
    window.switchTab = switchTab;
    window.setViewMode = setViewMode;
    window.onStudentSearchInput = onStudentSearchInput;
    window.clearStudentSearch = clearStudentSearch;
    window.toggleStudentAllBooks = toggleStudentAllBooks;
    window.markStudentAllReceived = markStudentAllReceived;
    window.copyStudentBillSummary = copyStudentBillSummary;
    window.onMatrixOrderCheckChanged = onMatrixOrderCheckChanged;
    window.toggleAllColumnOrders = toggleAllColumnOrders;
    window.toggleDistributionStatus = toggleDistributionStatus;
    window.markAllColumnReceived = markAllColumnReceived;
    window.saveMatrixOrders = saveMatrixOrders;
    window.closeConfirmModal = closeConfirmModal;
    window.executeSubmitMatrixOrder = executeSubmitMatrixOrder;
    window.printMatrixSummary = printMatrixSummary;
    window.onActiveClassChanged = onActiveClassChanged;
    window.scrollMatrixHorizontally = scrollMatrixHorizontally;
    window.syncTopScrollbar = syncTopScrollbar;
    window.syncAllMatrixScrollbars = syncAllMatrixScrollbars;
    window.purgeExpiredOrders = purgeExpiredOrders;
    window.formatShortPrice = formatShortPrice;
    window.formatSubjectDisplayName = formatSubjectDisplayName;
    window.setMatrixOrderDirty = setMatrixOrderDirty;
    window.isMatrixOrderDirty = () => isMatrixOrderDirty;
    window.getSubjectsForClassSchedule = getSubjectsForClassSchedule;
    window.findBookEntryForSchedule = findBookEntryForSchedule;
    window.setCurrentParsedSchedule = setCurrentParsedSchedule;
    window.getCurrentParsedSchedule = getCurrentParsedSchedule;
    window.loadClassDataAndRender = loadClassDataAndRender;
    window.getCurrentGradeBooks = () => currentGradeBooks;
    window.setCurrentGradeBooks = (b) => { currentGradeBooks = b; };
    window.onActiveSemesterChanged = onActiveSemesterChanged;
    window.getActiveSemester = () => activeSemester;
    window.setActiveSemester = (s) => { activeSemester = String(s); applyHistoryReadOnlyState(); };
    window.isHistoryReadOnlyMode = () => isHistoryReadOnly;
    window.getRunningSemester = getRunningSemester;
    window.buildMatrixStorageKey = buildMatrixStorageKey;
    window.applyHistoryReadOnlyState = applyHistoryReadOnlyState;

    // Global listener pencegah penutupan tab/refresh saat ada perubahan pemesanan belum disimpan
    window.addEventListener('beforeunload', (e) => {
        if (isMatrixOrderDirty) {
            e.preventDefault();
            e.returnValue = 'Terdapat perubahan pemesanan buku yang belum disimpan!';
            return e.returnValue;
        }
    });
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', initPesanLksPage);
}

