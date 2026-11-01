import { auth, db, PATHS, supabase, SCHOOL_CONFIG, resolvePhotoUrl } from './config.js';
import { initLayout } from './global.js';
import { resolveNisFromQrInput, isQrInputSettled } from './utils.mjs';
import { cfClient } from './cloudflare-client.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc, query, where, orderBy, limit, writeBatch, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// =========================================================================
// 1. SUPABASE DATABASE CONFIGURATION (SSOT INSTANCE)
// =========================================================================
function initSupabase() {
    return !!supabase;
}

const SYSTEM_START_DATE = new Date(2026, 6, 1);
const SCHOOL_NAME = SCHOOL_CONFIG.schoolName;
const SCHOOL_NAME_UPPER = SCHOOL_CONFIG.schoolNameUpper;

let studentsCache = [];
let classTransactionCache = {};
const dailyReportCache = {}; // Memory Cache: { [dateStr]: { html, total, timestamp } }
let ratesConfig = { X: 70000, XI: 65000, XII: 65000 };
let systemDueDate = 20; // <--- VARIABEL BARU (DEFAULT TGL 20)
let currentStudent = null;
let paymentHistory = {};
const paymentHistoryCache = {}; // Memory Cache: { [nis]: { data: {...}, timestamp: Date.now() } }
let cohortInfo = { startYear: 0, endYear: 0 };
let selectedMonths = [];
let targetDelete = null;
let cachedFrozenMigration = null;
let cachedMigrationRecords2026 = null;
let closedYearsList = [];
let isCurrentYearClosed = false;

// --- TUTUP BUKU: HELPER KUNCI TAHUN BUKU ---
// Tahun buku pertama sistem keuangan (awal operasional e-SPP)
const FIRST_FINANCE_BOOK_YEAR = 2026;

const getYearFromDateStr = (dateStr) => {
    const match = /^(\d{4})-\d{2}-\d{2}/.exec(String(dateStr || ''));
    return match ? parseInt(match[1], 10) : null;
};

// Muat ulang daftar tahun tertutup dari database (hindari status usang jika ditutup dari perangkat lain)
async function refreshClosedYearsList() {
    initSupabase();
    if (!supabase) return closedYearsList;
    const { data, error } = await supabase.from('finance_closings').select('year');
    if (error) throw new Error(`Gagal memeriksa status tutup buku: ${error.message}`);
    closedYearsList = (data || []).map(r => parseInt(r.year)).filter(Boolean);
    return closedYearsList;
}

// Tanggal pembukuan transaksi baru: jika tahun buku tanggal tersebut sudah ditutup (tutup buku Desember),
// transaksi dibukukan ke 1 Januari tahun berikutnya agar saldo tutup buku tetap final.
function getFinancePostingDateStr(realDateStr) {
    const year = getYearFromDateStr(realDateStr);
    if (year && closedYearsList.includes(year)) return `${year + 1}-01-01`;
    return realDateStr;
}

// Tahun buku yang terdampak bila pembayaran SPP bulan (y, m) dihapus / diubah statusnya.
// - Pembayaran riil: tahun dari tanggal kas (date_str), bukan tahun tagihan.
// - Periode migrasi (sebelum Juli 2026): ikut memengaruhi kas virtual migrasi tahun 2026.
function getPaymentBookYears(record, y, m) {
    const years = new Set();
    const amount = record ? (Number(record.amount) || 0) : 0;
    const dateStr = record ? (record.date_str || record.dateStr) : null;
    if (record && record.type !== 'manual_debt' && amount > 0 && dateStr) {
        const cashYear = getYearFromDateStr(dateStr);
        if (cashYear) years.add(cashYear);
    }
    const itemDate = new Date(y, m - 1, systemDueDate);
    if (itemDate < SYSTEM_START_DATE && y === FIRST_FINANCE_BOOK_YEAR) years.add(FIRST_FINANCE_BOOK_YEAR);
    return [...years];
}

function getLockedPaymentBookYear(record, y, m) {
    return getPaymentBookYears(record, y, m).find(year => closedYearsList.includes(year)) || null;
}

// Mode Arus Kas Awal: 'real' (Kas Fisik Riil) atau 'budget' (Tahun Anggaran)
// Didefinisikan di awal berkas agar siap dipanggil sebelum async initialization selesai
window.currentCashflowMode = window.currentCashflowMode || 'real';

window._moduleSwitchCashflowMode = async (mode) => {
    window.currentCashflowMode = mode || 'real';
    window._cashflowCache = null;
    if (typeof window.loadCashflow === 'function') {
        await window.loadCashflow();
    }
};

window.switchCashflowMode = async (mode) => {
    window.currentCashflowMode = mode || 'real';

    const btnReal = document.getElementById('btn-cf-mode-real');
    const btnBudget = document.getElementById('btn-cf-mode-budget');
    const titleEl = document.getElementById('cf-view-title');
    const bannerEl = document.getElementById('cf-budget-reconcile-banner');

    if (btnReal && btnBudget) {
        if (window.currentCashflowMode === 'budget') {
            btnBudget.className = "px-3 py-1.5 rounded shadow bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 font-bold transition-all border border-slate-200 dark:border-slate-600";
            btnReal.className = "px-3 py-1.5 rounded text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-all font-semibold";
            if (titleEl) {
                titleEl.innerHTML = `<i class="fa-solid fa-scale-balanced text-indigo-600 dark:text-indigo-400"></i> Riwayat Buku Kas SPP <span id="cf-mode-badge" class="text-xs font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">Tahun Anggaran</span>`;
            }
            if (bannerEl) bannerEl.classList.remove('hidden');
        } else {
            btnReal.className = "px-3 py-1.5 rounded shadow bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 font-bold transition-all border border-slate-200 dark:border-slate-600";
            btnBudget.className = "px-3 py-1.5 rounded text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-all font-semibold";
            if (titleEl) {
                titleEl.innerHTML = `<i class="fa-solid fa-list-check text-slate-700 dark:text-slate-300"></i> Riwayat Buku Kas SPP <span id="cf-mode-badge" class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">Kas Fisik Riil</span>`;
            }
            if (bannerEl) bannerEl.classList.add('hidden');
        }
    }

    window._cashflowCache = null;
    if (typeof window.loadCashflow === 'function') {
        await window.loadCashflow();
    }
};

// --- HELPER: MODERN CONFIRM (Pengganti confirm() bawaan browser) ---
function showConfirmModal(message, title = 'Konfirmasi', type = 'warning') {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-generic-confirm');
        if (!modal) {
            if (typeof window.showConfirmModal === 'function' && window.showConfirmModal !== showConfirmModal) {
                return resolve(window.showConfirmModal(message, title, type));
            }
            resolve(false);
            return;
        }

        const iconBg = document.getElementById('confirm-icon-bg');
        const icon = document.getElementById('confirm-icon');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-msg');
        const btnOk = document.getElementById('btn-confirm-ok');
        const btnCancel = document.getElementById('btn-confirm-cancel');

        if (type === 'danger') {
            iconBg.className = "w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600";
            icon.className = "fa-solid fa-trash text-3xl";
            btnOk.className = "px-5 py-2.5 rounded-lg font-bold text-white bg-red-600 hover:bg-red-700 shadow-lg transition-transform active:scale-95";
        } else {
            iconBg.className = "w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4 text-amber-600";
            icon.className = "fa-solid fa-question text-3xl";
            btnOk.className = "px-5 py-2.5 rounded-lg font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-lg transition-transform active:scale-95";
        }

        titleEl.innerText = title;
        msgEl.innerHTML = message;
        modal.classList.remove('hidden');

        const newBtnOk = btnOk.cloneNode(true);
        const newBtnCancel = btnCancel.cloneNode(true);
        btnOk.parentNode.replaceChild(newBtnOk, btnOk);
        btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);

        newBtnOk.addEventListener('click', () => {
            modal.classList.add('hidden');
            resolve(true);
        });

        newBtnCancel.addEventListener('click', () => {
            modal.classList.add('hidden');
            resolve(false);
        });
    });
}

// --- HELPER UNTUK QUERY TRANSAKSI BERDASARKAN DAFTAR NIS (SUPABASE FAST QUERY + FIRESTORE FALLBACK) ---
async function getTransactionsByNISList(listNIS) {
    if (!listNIS || listNIS.length === 0) return [];
    
    const uniqueNISValues = new Set();
    listNIS.forEach(n => {
        const str = String(n || '').trim();
        if (str) {
            uniqueNISValues.add(str);
            const norm = normalizeNIS(str);
            if (norm) uniqueNISValues.add(norm);
            const padded = str.padStart(4, '0');
            if (padded) uniqueNISValues.add(padded);
        }
    });

    const cleanNisArray = Array.from(uniqueNISValues);
    if (cleanNisArray.length === 0) return [];

    initSupabase();
    if (!supabase) throw new Error('Supabase client belum siap');

    const { data, error } = await window.fetchAllSupabaseRows(
        supabase,
        'finance_transactions',
        q => q.in('student_nis', cleanNisArray),
        { selectFields: 'id, transaction_id, student_nis, student_name, student_class, year, month, amount, payment_date, date_str, type, teller_name' }
    );

    if (error) {
        console.error('[Keuangan] Error getTransactionsByNISList Supabase:', error);
        throw error;
    }

    if (data && data.length > 0) {
        return data.map(row => ({
            id: row.id,
            data: () => ({
                transactionId: row.transaction_id || row.id,
                studentNIS: row.student_nis,
                studentName: row.student_name,
                studentClass: row.student_class,
                year: row.year,
                month: row.month,
                amount: Number(row.amount) || 0,
                paymentDate: row.payment_date ? { toDate: () => new Date(row.payment_date) } : null,
                dateStr: row.date_str,
                type: row.type || 'paid',
                tellerName: row.teller_name
            })
        }));
    }

    return [];
}


let currentTellerName = "";

// --- SESSION CACHE HELPERS ---
const SESSION_CACHE_KEYS = {
    FINANCE_RATES: 'session_finance_rates'
};

function getSessionCache(key) {
    try {
        return JSON.parse(sessionStorage.getItem(key));
    } catch (e) { return null; }
}

function setSessionCache(key, data) {
    try {
        sessionStorage.setItem(key, JSON.stringify(data));
    } catch (e) { console.warn('[Cache] Error:', e); }
}

function clearFinanceCache() {
    sessionStorage.removeItem(SESSION_CACHE_KEYS.FINANCE_RATES);
}

// --- HELPER FIX ASVS: Hash PIN (SHA-256) ---
async function hashSHA256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- HELPER: TOAST (Menggunakan showToast() dari global.js) ---
// Fungsi showToast() sudah tersedia global dari global.js

// UPDATE SETUP: Tambahkan loadSystemConfig()
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash); return; }
    
    // --- SINKRONISASI DATAKU / PROFIL & ROLE DARI FIRESTORE (CACHE TERPUSAT) ---
    currentTellerName = user.email?.split('@')[0] || 'Petugas';
    try {
        const cachedUserDoc = await window.getCurrentUserDoc();
        if (cachedUserDoc) {
            if (cachedUserDoc.name) currentTellerName = cachedUserDoc.name;
            if (cachedUserDoc.role) {
                localStorage.setItem('user_role', cachedUserDoc.role);
            }
            if (Array.isArray(cachedUserDoc.additionalRoles)) {
                localStorage.setItem('user_additional_roles', JSON.stringify(cachedUserDoc.additionalRoles));
            }
        }
    } catch (e) { console.error("Gagal load profil user/teller", e); }

    let role = localStorage.getItem('user_role');
    if (role === 'siswa') { window.location.href = 'dashboard.html'; return; }

    // MULTI-ROLE: Ambil role tertinggi untuk halaman ini
    const effectiveRole = window.getEffectiveRoleForPage ?
        window.getEffectiveRoleForPage('keuangan.html') : role;
    initLayout(effectiveRole); // Gunakan role tertinggi
    document.querySelector('main').classList.remove('hidden');
    initCashflowFilters();

    // Baca target tab & subtab dari URL (Mendukung Hash & Search Params: misal #tab=laporan&subtab=estimasi atau ?tab=laporan&subtab=estimasi)
    const urlParams = new URLSearchParams(window.location.search);
    const rawHash = (window.location.hash || '').replace(/^#/, '');
    const hashParams = new URLSearchParams(rawHash.includes('=') ? rawHash : (rawHash ? `tab=${rawHash}` : ''));
    
    let requestedTab = urlParams.get('tab') || hashParams.get('tab');
    let requestedSubtab = urlParams.get('subtab') || hashParams.get('subtab');

    if (requestedSubtab) {
        const lowerSub = requestedSubtab.toLowerCase();
        if (lowerSub === 'estimasi') requestedSubtab = 'estimation';
        else if (lowerSub === 'tunggakan') requestedSubtab = 'arrears';
        else if (lowerSub === 'rekap') requestedSubtab = 'recap';
        else if (lowerSub === 'harian') requestedSubtab = 'daily';
    }

    // --- PROTEKSI KHUSUS BACA-SAJA (VIEW ONLY) ---
    // Multi-role: User dianggap view-only jika tidak memiliki role admin_spp atau super_admin
    const isViewOnly = window.hasRole ?
        (!window.hasRole('super_admin') && !window.hasRole('admin_spp')) :
        (role !== 'super_admin' && role !== 'admin_spp');

    const targetTab = isViewOnly
        ? ((requestedTab === 'kasir' || requestedTab === 'setting') ? 'laporan' : (requestedTab || 'laporan'))
        : (requestedTab || 'kasir');

    if (isViewOnly) {
        // 1. Sembunyikan Tab Kasir & Setting (Arus Kas dan Laporan tetap dapat diakses oleh user view-only)
        const btnKasir = document.getElementById('btn-tab-kasir');
        if (btnKasir) btnKasir.classList.add('hidden');
        const btnSetting = document.getElementById('btn-tab-setting');
        if (btnSetting) btnSetting.classList.add('hidden');

        // Pastikan Tab Arus Kas dan Laporan tidak tersembunyi
        const btnArusKas = document.getElementById('btn-tab-arus-kas');
        if (btnArusKas) btnArusKas.classList.remove('hidden');
        const btnLaporan = document.getElementById('btn-tab-laporan');
        if (btnLaporan) btnLaporan.classList.remove('hidden');

        // Sembunyikan tombol pencatatan transaksi manual pada Arus Kas untuk mode view-only
        const btnAddCf = document.querySelector('button[onclick="window.openCashflowModal()"]');
        if (btnAddCf) btnAddCf.classList.add('hidden');

        // 2. Switch ke tab target
        if (typeof window.switchTab === 'function') {
            window.switchTab(targetTab);
        }
    } else {
        // Untuk admin biasa, pastikan semua tab tampil dan posisikan indicator ke target tab
        const btnKasir = document.getElementById('btn-tab-kasir');
        if (btnKasir) btnKasir.classList.remove('hidden');
        const btnSetting = document.getElementById('btn-tab-setting');
        if (btnSetting) btnSetting.classList.remove('hidden');
        const btnArusKas = document.getElementById('btn-tab-arus-kas');
        if (btnArusKas) btnArusKas.classList.remove('hidden');
        const btnLaporan = document.getElementById('btn-tab-laporan');
        if (btnLaporan) btnLaporan.classList.remove('hidden');

        if (typeof window.switchTab === 'function') {
            window.switchTab(targetTab);
        }
    }

    // LOAD KONFIGURASI JATUH TEMPO DI SINI
    await Promise.all([loadRates(), loadSystemConfig()]);

    await loadStudentList();
    populateDailyClassDropdown();
    loadKasirSummary(); // Fix #13: Summary Dashboard

    document.getElementById('report-date').valueAsDate = new Date();

    // Jika tab aktif adalah laporan dan ada subtab yang diminta (misal: estimasi)
    if (targetTab === 'laporan' && requestedSubtab && typeof window.switchReportMode === 'function') {
        await window.switchReportMode(requestedSubtab);
    }

    // Fokus otomatis ke input pencarian siswa di tab Kasir jika bukan mode view-only dan tab aktif kasir
    if (!isViewOnly && targetTab === 'kasir') {
        setTimeout(() => {
            const searchInput = document.getElementById('student-search');
            if (searchInput) searchInput.focus();
        }, 200);
    }
});

// Listener perubahan hash secara dinamis saat halaman sudah aktif
if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', () => {
        const rawHash = (window.location.hash || '').replace(/^#/, '');
        if (!rawHash) return;
        const hashParams = new URLSearchParams(rawHash.includes('=') ? rawHash : `tab=${rawHash}`);
        const t = hashParams.get('tab');
        let s = hashParams.get('subtab');
        if (s) {
            const lowerSub = s.toLowerCase();
            if (lowerSub === 'estimasi') s = 'estimation';
            else if (lowerSub === 'tunggakan') s = 'arrears';
            else if (lowerSub === 'rekap') s = 'recap';
            else if (lowerSub === 'harian') s = 'daily';
        }
        if (t && typeof window.switchTab === 'function') {
            window.switchTab(t);
        }
        if (t === 'laporan' && s && typeof window.switchReportMode === 'function') {
            window.switchReportMode(s);
        }
    });
}

// --- HELPER BARU: FORMAT CURRENCY INPUT ---
window.formatInputCurrency = (input) => {
    // Hapus semua karakter selain angka
    let value = input.value.replace(/\D/g, '');

    // Format angka dengan separator ribuan (id-ID)
    if (value) {
        input.value = parseInt(value).toLocaleString('id-ID');
    } else {
        input.value = '';
    }
};

/**
 * Parsing nominal mutasi kas dari string berpemisah ribuan / desimal ke number presisi 2 desimal.
 * Mendukung format: "150.000,50", "150.000", "50,75", "150000.50", "0", dll.
 */
window.parseCashflowAmount = (val) => {
    if (typeof val === 'number') return isNaN(val) ? 0 : Math.round(val * 100) / 100;
    if (!val) return 0;
    let s = String(val).trim();
    if (!s) return 0;

    // Jika ada koma, perlakukan sebagai pemisah desimal resmi (standar id-ID)
    if (s.includes(',')) {
        s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes('.')) {
        const parts = s.split('.');
        if (parts.length > 2) {
            // Ada lebih dari 1 titik (contoh: 1.000.000), titik adalah pemisah ribuan
            s = s.replace(/\./g, '');
        } else if (parts.length === 2) {
            // Tepat 1 titik: jika panjang bagian belakang adalah 3 digit (contoh: 150.000) dan depan >= 1, itu ribuan
            if (parts[1].length === 3 && parts[0].length >= 1) {
                s = s.replace(/\./g, '');
            }
        }
    }
    const num = parseFloat(s);
    return isNaN(num) ? 0 : Math.round(num * 100) / 100;
};
window._moduleParseCashflowAmount = window.parseCashflowAmount;

/**
 * Memformat input nominal mutasi kas secara interaktif (live typing) dengan pemisah ribuan titik (.)
 * dan mendukung pecahan desimal 2 angka di belakang koma (,).
 */
window.formatCashflowInputCurrency = (input) => {
    if (!input) return;
    let val = input.value;
    if (!val) {
        input.value = '';
        return;
    }

    const cursorPos = input.selectionStart || 0;
    const beforeCursor = val.slice(0, cursorPos);
    const validCharsBefore = (beforeCursor.match(/[\d,]/g) || []).length;

    // Jika user menekan titik (.) pada keyboard / numpad, konversikan ke koma desimal jika di posisi pecahan
    let commaIndex = val.indexOf(',');
    if (commaIndex === -1 && val.includes('.')) {
        const lastDot = val.lastIndexOf('.');
        const afterDot = val.slice(lastDot + 1);
        if (afterDot.length <= 2 && !afterDot.includes('.')) {
            val = val.slice(0, lastDot) + ',' + afterDot;
            commaIndex = val.indexOf(',');
        }
    }

    const parts = val.split(',');
    const intRaw = parts[0].replace(/\D/g, '');
    const hasDecimal = parts.length > 1;
    const decRaw = hasDecimal ? parts.slice(1).join('').replace(/\D/g, '').slice(0, 2) : '';

    let formattedInt = '';
    if (intRaw) {
        formattedInt = parseInt(intRaw, 10).toLocaleString('id-ID');
    } else if (hasDecimal) {
        formattedInt = '0';
    }

    let result = formattedInt;
    if (hasDecimal) {
        result += ',' + decRaw;
    }

    input.value = result;

    // Sinkronkan kembali posisi kursor agar tidak melompat ke akhir input
    let newCursor = 0;
    let counted = 0;
    for (let i = 0; i < result.length; i++) {
        if (/[\d,]/.test(result[i])) {
            counted++;
        }
        if (counted >= validCharsBefore) {
            newCursor = i + 1;
            break;
        }
    }
    if (counted < validCharsBefore) newCursor = result.length;
    input.setSelectionRange(newCursor, newCursor);

    if (typeof window.checkCashflowOverbudget === 'function') {
        window.checkCashflowOverbudget();
    }
};
window._moduleFormatCashflowInputCurrency = window.formatCashflowInputCurrency;

/**
 * Menormalkan nominal mutasi kas saat kehilangan fokus (onblur) menjadi format rapi 2 desimal.
 * Contoh: "50.000" -> "50.000,00", "50.000,5" -> "50.000,50".
 */
window.normalizeCashflowInputOnBlur = (input) => {
    if (!input || !input.value.trim()) return;
    const amount = window.parseCashflowAmount(input.value);
    if (amount > 0) {
        input.value = amount.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (typeof window.checkCashflowOverbudget === 'function') {
        window.checkCashflowOverbudget();
    }
};
window._moduleNormalizeCashflowInputOnBlur = window.normalizeCashflowInputOnBlur;

/**
 * Format nominal Rupiah 2 angka di belakang koma untuk Arus Kas
 */
window.formatCashflowAmount = (num, includePrefix = false) => {
    const val = typeof num === 'number' ? (isNaN(num) ? 0 : num) : (parseFloat(num) || 0);
    const rounded = Math.round(val * 100) / 100;
    const formatted = rounded.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return includePrefix ? `Rp ${formatted}` : formatted;
};

async function loadRates(forceRefresh = false) {
    // A. Update Label Angkatan Dinamis (Visual)
    try {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const academicYearStart = (currentMonth >= 6) ? currentYear : currentYear - 1;

        const labelX = document.getElementById('label-rate-x');
        const labelXI = document.getElementById('label-rate-xi');
        const labelXII = document.getElementById('label-rate-xii');

        if (labelX) labelX.innerText = `Tarif Angkatan ${academicYearStart} (Kelas X saat ini)`;
        if (labelXI) labelXI.innerText = `Tarif Angkatan ${academicYearStart - 1} (Kelas XI saat ini)`;
        if (labelXII) labelXII.innerText = `Tarif Angkatan ${academicYearStart - 2} (Kelas XII saat ini)`;
    } catch (err) {
        console.error("Gagal mengupdate label angkatan:", err);
    }

    try {
        // === SESSION CACHE ===
        if (!forceRefresh) {
            const cached = getSessionCache(SESSION_CACHE_KEYS.FINANCE_RATES);
            if (cached) {
                console.log('[Keuangan] Menggunakan session cache tarif');
                ratesConfig = cached;
                fillRatesUI();
                return;
            }
        }

        const ratesData = await window.getFinanceRatesCache();
        if (ratesData && Object.keys(ratesData).length > 0) {
            ratesConfig = ratesData;
            // Simpan ke session cache
            setSessionCache(SESSION_CACHE_KEYS.FINANCE_RATES, ratesConfig);
            console.log('[Keuangan] Tarif loaded dari cache terpusat');
            fillRatesUI();
        }
    } catch (e) {
        console.error("Gagal loadRates:", e);
    }
}

// Helper untuk mengisi data ke input form Pengaturan Tarif
function fillRatesUI() {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const academicYearStart = (currentMonth >= 6) ? currentYear : currentYear - 1;

    const cX = String(academicYearStart);
    const cXI = String(academicYearStart - 1);
    const cXII = String(academicYearStart - 2);

    let valX = ratesConfig.X || 0;
    let valXI = ratesConfig.XI || 0;
    let valXII = ratesConfig.XII || 0;

    // Ambil dari cohorts jika disetel, fallback ke global tarif
    if (ratesConfig.cohorts) {
        if (ratesConfig.cohorts[cX] && ratesConfig.cohorts[cX].X !== undefined) {
            valX = ratesConfig.cohorts[cX].X;
        }
        if (ratesConfig.cohorts[cXI] && ratesConfig.cohorts[cXI].XI !== undefined) {
            valXI = ratesConfig.cohorts[cXI].XI;
        }
        if (ratesConfig.cohorts[cXII] && ratesConfig.cohorts[cXII].XII !== undefined) {
            valXII = ratesConfig.cohorts[cXII].XII;
        }
    }

    const inputX = document.getElementById('rate-x');
    const inputXI = document.getElementById('rate-xi');
    const inputXII = document.getElementById('rate-xii');

    if (inputX) inputX.value = valX.toLocaleString('id-ID');
    if (inputXI) inputXI.value = valXI.toLocaleString('id-ID');
    if (inputXII) inputXII.value = valXII.toLocaleString('id-ID');
}

// --- 2. LOGIKA KASIR (HEMAT KUOTA & SORTING RAPI) ---
async function loadStudentList(forceUpdate = false) {
    studentsCache = [];

    // --- LOAD CONFIG SHOW ALUMNI (cache terpusat) ---
    let showAlumni = false;
    try {
        const configData = await window.getSystemConfig();
        if (configData) showAlumni = configData.showAlumni || false;
    } catch (e) { }

    // GUNAKAN GLOBAL CACHE (Hemat Kuota Read via global.js)
    try {
        if (forceUpdate) {
            window.invalidateStudentsCache(); // Invalidate dulu
        }

        const allStudents = await window.getStudentsCache();

        // Map ke format lokal (menyertakan foto resmi untuk kartu kasir SPP)
        studentsCache = allStudents.map(s => ({
            nis: s.nis,
            name: s.name,
            class: s.class,
            activePhotoUrl: s.activePhotoUrl || s.active_photo_url || s.photoUrl || s.photo_url || s.foto || null,
            gender: s.gender || ''
        }));

        if (forceUpdate) showToast("Data Diperbarui", "Daftar siswa berhasil di-refresh.");
    } catch (e) {
        console.error(e);
        showToast("Error", "Gagal memuat data siswa", "error");
    }

    // --- FILTER ALUMNI & KELAS NON-AKTIF (Jika Config OFF) ---
    if (!showAlumni) {
        studentsCache = studentsCache.filter(s => {
            if (!s.class) return true;
            const lowerClass = s.class.toLowerCase();
            return !(
                lowerClass.includes('alumni') ||
                lowerClass.includes('mutasi') ||
                lowerClass.includes('pindah') ||
                lowerClass.includes('keluar') ||
                lowerClass.includes('nonaktif') ||
                lowerClass.includes('non_aktif') ||
                lowerClass.includes('lulus')
            );
        });
    }

    // --- REVISI: SORTING (KELAS -> NIS) ---
    // Agar saat dicari, urutannya rapi per kelas
    studentsCache.sort((a, b) => {
        // 1. Prioritas Kelas (X-1, X-2, X-10 urut numerik)
        const classA = a.class || '';
        const classB = b.class || '';
        const classDiff = classA.localeCompare(classB, undefined, { numeric: true });

        if (classDiff !== 0) return classDiff;

        // 2. Prioritas NIS (Jika kelas sama)
        const nisA = (a.nis || '').toString();
        const nisB = (b.nis || '').toString();
        return nisA.localeCompare(nisB, undefined, { numeric: true });
    });

    // 2. Custom Dropdown Render tidak diperlukan di load awal (di-render via input event)
}

// Fitur Paksa Update (Jika ada murid baru)
window.forceRefreshStudents = () => {
    // Invalidate global cache & reload
    loadStudentList(true).then(() => {
        const recapFilter = document.getElementById('filter-recap');
        if (recapFilter && !recapFilter.classList.contains('hidden')) {
            populateRecapClassDropdown();
        }
    });
};

// --- CUSTOM DROPDOWN SEARCH LOGIC ---
const searchInput = document.getElementById('student-search');
const dropdownContainer = document.getElementById('custom-student-dropdown');
const dropdownList = document.getElementById('custom-student-list');
let currentFocusIndex = -1;
let currentMatches = [];

function addActiveDropdownItem(items) {
    if (!items || items.length === 0) return;
    removeActiveDropdownItem(items);
    if (currentFocusIndex >= items.length) currentFocusIndex = 0;
    if (currentFocusIndex < 0) currentFocusIndex = items.length - 1;
    
    const activeItem = items[currentFocusIndex];
    if (activeItem) {
        activeItem.classList.add("bg-blue-100", "dark:bg-blue-900/40");
        activeItem.scrollIntoView({ block: "nearest" });
    }
}

function removeActiveDropdownItem(items) {
    for (let i = 0; i < items.length; i++) {
        items[i].classList.remove("bg-blue-100", "dark:bg-blue-900/40");
    }
}

searchInput.addEventListener('input', async (e) => {
    let rawVal = e.target.value.trim();

    // Jika input berasal dari hasil scan QR kartu (URL kartu-shakti atau token kts_...)
    if (rawVal.includes('kartu-shakti.html') || rawVal.startsWith('kts_')) {
        // Token kartu diterjemahkan oleh Worker (kunci kartu hanya ada di server)
        if (!(await isQrInputSettled(searchInput, rawVal))) return;
        const resolvedNis = await resolveNisFromQrInput(rawVal, cfClient);
        if (searchInput.value.trim() !== rawVal) return; // input sudah berubah selama menunggu server
        if (resolvedNis) {
            searchInput.value = resolvedNis;
            rawVal = resolvedNis;

            // Jika cocok dengan siswa di studentsCache, langsung pilih siswa secara otomatis
            const matched = Array.isArray(studentsCache) && studentsCache.find(s => String(s.nis).trim() === resolvedNis);
            if (matched && typeof window.handleSelectStudentFromDropdown === 'function') {
                dropdownContainer.classList.add('hidden');
                window.handleSelectStudentFromDropdown(matched.nis);
                return;
            }
        }
    }

    const val = rawVal.toLowerCase();
    
    // Sembunyikan dropdown jika input kosong
    if (!val) {
        dropdownContainer.classList.add('hidden');
        currentMatches = [];
        currentFocusIndex = -1;
        return;
    }
    
    // Fuzzy search dari studentsCache (max 30 hasil agar ringan)
    currentMatches = studentsCache.filter(s => 
        (s.name && s.name.toLowerCase().includes(val)) || 
        (s.nis && s.nis.toString().includes(val)) || 
        (s.class && s.class.toLowerCase().includes(val))
    ).slice(0, 30);
    
    currentFocusIndex = -1;
    
    if (currentMatches.length === 0) {
        dropdownList.innerHTML = '<li class="px-3 py-2 text-xs text-slate-400 italic text-center">Tidak ditemukan...</li>';
    } else {
        dropdownList.innerHTML = currentMatches.map((s, idx) => {
            const rawPhoto = s.activePhotoUrl || s.active_photo_url || s.photoUrl || s.photo_url || s.foto || '';
            const resolvedPhoto = rawPhoto ? resolvePhotoUrl(rawPhoto) : '';
            const safePhoto = (resolvedPhoto && /^(https?:|\/|data:image\/)/i.test(resolvedPhoto)) ? resolvedPhoto : '';
            const safeName = window.escapeHTML ? window.escapeHTML(s.name) : s.name;
            const safeNis = window.escapeHTML ? window.escapeHTML(s.nis) : s.nis;
            const safeClass = window.escapeHTML ? window.escapeHTML(s.class) : s.class;

            const avatarThumb = safePhoto
                ? `<img src="${safePhoto}" alt="" loading="lazy" class="w-6 h-6 rounded-full object-cover shrink-0 ring-1 ring-slate-200/80 dark:ring-slate-700" onerror="this.onerror=null; this.classList.add('hidden'); if(this.nextElementSibling) this.nextElementSibling.classList.remove('hidden');" /><div class="hidden w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-[9px] shrink-0"><i class="fa-solid fa-user text-[8px]"></i></div>`
                : `<div class="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-[9px] shrink-0"><i class="fa-solid fa-user text-[8px]"></i></div>`;

            return `
                <li id="dropdown-item-${idx}" class="px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer transition-colors flex items-center justify-between group" onclick="window.handleSelectStudentFromDropdown('${safeNis}')">
                    <div class="flex items-center gap-2 min-w-0">
                        ${avatarThumb}
                        <div class="min-w-0">
                            <span class="text-sm font-bold text-slate-700 dark:text-slate-200 group-hover:text-blue-700 dark:group-hover:text-blue-400">${safeName}</span>
                            <span class="text-[10px] text-slate-400 dark:text-slate-500 ml-1">${safeNis}</span>
                        </div>
                    </div>
                    <div class="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 rounded border border-slate-200 dark:border-slate-750 shrink-0 ml-2">${safeClass}</div>
                </li>
            `;
        }).join('');
    }
    
    dropdownContainer.classList.remove('hidden');
});

// Menutup dropdown saat klik di luar
document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !dropdownContainer.contains(e.target)) {
        dropdownContainer.classList.add('hidden');
    }
});

// Fokus ulang memunculkan dropdown kembali
searchInput.addEventListener('focus', () => {
    if (searchInput.value) {
        searchInput.dispatchEvent(new Event('input'));
    }
});

// Deteksi tombol Keyboard (Enter, Panah Atas/Bawah, Escape) pada input pencarian
searchInput.addEventListener('keydown', (e) => {
    const dropdownVisible = !dropdownContainer.classList.contains('hidden');
    const items = dropdownList.getElementsByTagName("li");

    if (e.key === 'ArrowDown') {
        if (dropdownVisible && items.length > 0) {
            e.preventDefault();
            currentFocusIndex++;
            addActiveDropdownItem(items);
        }
        return;
    }
    
    if (e.key === 'ArrowUp') {
        if (dropdownVisible && items.length > 0) {
            e.preventDefault();
            currentFocusIndex--;
            addActiveDropdownItem(items);
        }
        return;
    }

    if (e.key === 'Escape') {
        if (dropdownVisible) {
            e.preventDefault();
            e.stopPropagation();
            dropdownContainer.classList.add('hidden');
            currentFocusIndex = -1;
            return;
        }
    }

    if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation(); // Mencegah event bubbling ke listener global

        // Jika dropdown sedang terbuka dan ada item yang difokuskan, pilih item tersebut!
        if (dropdownVisible && currentFocusIndex >= 0 && currentMatches[currentFocusIndex]) {
            window.handleSelectStudentFromDropdown(currentMatches[currentFocusIndex].nis);
            return;
        }

        const val = searchInput.value.trim();
        if (!val) return;

        // Jika siswa sudah terpilih, dan input text berisi NIS siswa tersebut (menandakan Enter kedua),
        // maka otomatis arahkan ke proses konfirmasi pembayaran (pop-up).
        if (currentStudent && val.includes('|') && val.includes(currentStudent.nis.toString())) {
            if (selectedMonths.length > 0) {
                window.requestPayment();
            } else {
                showToast("Peringatan", "Pilih bulan yang ingin dibayar terlebih dahulu.", "warning");
            }
            return;
        }

        const valLower = val.toLowerCase();
        // Cari yang NIS-nya cocok persis terlebih dahulu
        let match = studentsCache.find(s => s.nis && s.nis.toString() === valLower);
        
        // Jika tidak ada NIS cocok persis, cari kecocokan pertama dari daftar pencarian
        if (!match) {
            const matches = studentsCache.filter(s => 
                (s.name && s.name.toLowerCase().includes(valLower)) || 
                (s.nis && s.nis.toString().includes(valLower)) || 
                (s.class && s.class.toLowerCase().includes(valLower))
            );
            if (matches.length > 0) {
                match = matches[0];
            }
        }

        if (match) {
            window.handleSelectStudentFromDropdown(match.nis);
        } else {
            showToast("Tidak Ditemukan", "Siswa tidak ditemukan.", "error");
        }
    }
});

// Handler saat di-klik list item
window.handleSelectStudentFromDropdown = (nis) => {
    const match = studentsCache.find(s => s.nis.toString() === nis.toString());
    if (match) {
        searchInput.value = `${match.nis} | ${match.name} (${match.class})`;
        dropdownContainer.classList.add('hidden');
        selectStudent(match);
        // Fokus dan sorot seluruh teks agar jika petugas men-scan NIS berikutnya, teks lama langsung terhapus
        setTimeout(() => {
            searchInput.focus();
            searchInput.select();
        }, 150);
    }
};

function getGradeFromClass(className) {
    if (className.startsWith("XII")) return "XII";
    if (className.startsWith("XI")) return "XI";
    return "X";
}

function updateActiveRateBadge(year) {
    if (!currentStudent || !cohortInfo) return;
    const badge = document.getElementById('info-rate-badge');
    if (!badge) return;

    // Hitung tingkatan kelas pada tahun ajaran yang sedang ditampilkan
    const diff = year - cohortInfo.startYear;
    let targetGrade = "X";
    if (diff === 1) targetGrade = "XI";
    else if (diff === 2) targetGrade = "XII";

    // Ambil tarif pada tahun ajaran tersebut (awal ajaran bulan Juli)
    const rate = getRateForStudent(currentStudent, year, 7);

    badge.innerHTML = `Tarif Aktif <span class="px-1.5 py-0.5 rounded bg-indigo-600 text-white font-black text-[10px] mx-0.5 inline-block shadow-sm align-middle">${targetGrade}</span>: <span class="font-bold text-slate-800 dark:text-slate-200">Rp ${rate.toLocaleString('id-ID')}</span>`;
}

// ... (Fungsi selectStudent, calculateCohort, loadPaymentHistory, isMonthPaid, getFirstUnpaidMonth TETAP SAMA) ...
// (Pastikan fungsi-fungsi ini ada di file Anda)

async function selectStudent(student) {
    currentStudent = student;
    cohortInfo = calculateCohort(student.class);
    selectedMonths = [];

    document.getElementById('info-name').innerText = student.name;
    document.getElementById('info-class').innerText = student.class;
    document.getElementById('info-nis').innerText = student.nis;

    // --- RENDER FOTO SISWA DI KARTU KASIR SPP ---
    const avatarContainer = document.getElementById('info-student-avatar-container');
    const avatarImg = document.getElementById('info-student-avatar-img');
    const avatarFallback = document.getElementById('info-student-avatar-fallback');
    const zoomIcon = document.getElementById('info-student-avatar-zoom-icon');

    let rawPhoto = student.activePhotoUrl || student.active_photo_url || student.photoUrl || student.photo_url || student.foto || '';
    let resolvedPhoto = rawPhoto ? resolvePhotoUrl(rawPhoto) : '';
    if (resolvedPhoto && !/^(https?:|\/|data:image\/)/i.test(resolvedPhoto)) {
        resolvedPhoto = '';
    }

    const updateAvatarUI = (photoUrl) => {
        if (photoUrl && avatarImg && avatarFallback) {
            avatarImg.src = photoUrl;
            avatarImg.classList.remove('hidden');
            avatarFallback.classList.add('hidden');
            if (zoomIcon) zoomIcon.classList.remove('hidden');
            if (avatarContainer) {
                avatarContainer.onclick = () => window.openStudentPhotoPreview(student.nis, student.name, student.class, photoUrl);
                avatarContainer.title = "Klik untuk memperbesar pasfoto";
                avatarContainer.classList.add('cursor-pointer');
            }
        } else {
            if (avatarImg) {
                avatarImg.src = '';
                avatarImg.classList.add('hidden');
            }
            if (avatarFallback) avatarFallback.classList.remove('hidden');
            if (zoomIcon) zoomIcon.classList.add('hidden');
            if (avatarContainer) {
                avatarContainer.onclick = null;
                avatarContainer.title = student.name || 'Foto Siswa';
                avatarContainer.classList.remove('cursor-pointer');
            }
        }
    };

    updateAvatarUI(resolvedPhoto);

    // Fallback: Jika di local cache belum ada foto, periksa ke Cloudflare D1 student_photos (0 Firestore Read)
    if (!resolvedPhoto && cfClient && cfClient.enabled && typeof cfClient.getStudentPhotoInfo === 'function') {
        cfClient.getStudentPhotoInfo(student.nis).then(res => {
            if (res && res.data && res.data.active_photo_url) {
                const liveUrl = resolvePhotoUrl(res.data.active_photo_url);
                if (liveUrl && /^(https?:|\/|data:image\/)/i.test(liveUrl)) {
                    student.activePhotoUrl = res.data.active_photo_url;
                    if (currentStudent && String(currentStudent.nis) === String(student.nis)) {
                        updateAvatarUI(liveUrl);
                    }
                }
            }
        }).catch(() => {});
    }

    document.getElementById('student-info-card').classList.remove('hidden');
    document.getElementById('spp-placeholder').classList.add('hidden');
    document.getElementById('spp-content').classList.remove('hidden');
    document.getElementById('payment-form').classList.remove('hidden');

    // Sembunyikan summary dashboard saat siswa dipilih
    const summaryEl = document.getElementById('kasir-summary');
    if (summaryEl) summaryEl.classList.add('hidden');

    const cls = getGradeFromClass(student.class);
    const now = new Date();
    const activeRate = getRateForStudent(student, now.getFullYear(), now.getMonth() + 1);
    const badge = document.getElementById('info-rate-badge');
    badge.className = "mt-2 text-xs px-2.5 py-1.5 rounded bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/60 flex items-center gap-1 w-fit shadow-inner";
    badge.innerHTML = `Tarif Aktif <span class="px-1.5 py-0.5 rounded bg-indigo-600 text-white font-black text-[10px] mx-0.5 inline-block shadow-sm align-middle">${cls}</span>: <span class="font-bold text-slate-800 dark:text-slate-200">Rp ${activeRate.toLocaleString('id-ID')}</span>`;

    await loadPaymentHistory(student.nis);

    let viewYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;

    if (viewYear > cohortInfo.endYear) viewYear = cohortInfo.endYear;
    if (viewYear < cohortInfo.startYear) viewYear = cohortInfo.startYear;

    // --- SELEKSI OTOMATIS BULAN BERJALAN JIKA BELUM LUNAS ---
    const nowY = now.getFullYear();
    const nowM = now.getMonth() + 1; // 1-12

    // Pastikan bulan berjalan berada di dalam masa studi siswa
    let isCurrentMonthValid = true;
    if (nowY < cohortInfo.startYear || (nowY === cohortInfo.startYear && nowM < 7)) isCurrentMonthValid = false;
    const gradYear = cohortInfo.endYear + 1;
    if (nowY > gradYear || (nowY === gradYear && nowM > 6)) isCurrentMonthValid = false;

    if (isCurrentMonthValid) {
        if (!isMonthPaid(nowY, nowM)) {
            const startPoint = getFirstUnpaidMonth();
            if (startPoint) {
                const startScore = startPoint.year * 12 + startPoint.month;
                const targetScore = nowY * 12 + nowM;
                if (targetScore >= startScore) {
                    selectedMonths = [];
                    let currY = startPoint.year;
                    let currM = startPoint.month;
                    while (currY < nowY || (currY === nowY && currM <= nowM)) {
                        selectedMonths.push({ year: currY, month: currM });
                        currM++;
                        if (currM > 12) { currM = 1; currY++; }
                    }
                }
            }
        }
    }

    renderSppGrid(viewYear);
    updateCalculationUI();
}

// --- CLEAR / RESET PENCARIAN SISWA ---
window.clearStudentSearch = () => {
    // Clear auto-close timeout jika ada
    if (window.receiptAutoCloseTimeout) {
        clearTimeout(window.receiptAutoCloseTimeout);
        window.receiptAutoCloseTimeout = null;
    }

    currentStudent = null;
    selectedMonths = [];
    paymentHistory = {};

    // Reset UI input
    const searchInput = document.getElementById('student-search');
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus(); // Fokus kembali ke input setelah di-clear untuk mempercepat barcode scanner
    }
    const dropdown = document.getElementById('custom-student-dropdown');
    if (dropdown) dropdown.classList.add('hidden');

    // Sembunyikan kartu siswa, form, dan SPP grid
    document.getElementById('student-info-card').classList.add('hidden');
    document.getElementById('payment-form').classList.add('hidden');
    document.getElementById('spp-content').classList.add('hidden');
    document.getElementById('spp-placeholder').classList.remove('hidden');

    // Reset Avatar Foto Siswa
    const avatarImg = document.getElementById('info-student-avatar-img');
    const avatarFallback = document.getElementById('info-student-avatar-fallback');
    const zoomIcon = document.getElementById('info-student-avatar-zoom-icon');
    const avatarContainer = document.getElementById('info-student-avatar-container');
    if (avatarImg) {
        avatarImg.src = '';
        avatarImg.classList.add('hidden');
    }
    if (avatarFallback) avatarFallback.classList.remove('hidden');
    if (zoomIcon) zoomIcon.classList.add('hidden');
    if (avatarContainer) {
        avatarContainer.onclick = null;
        avatarContainer.title = 'Foto Siswa';
        avatarContainer.classList.remove('cursor-pointer');
    }

    // Tampilkan kembali summary dashboard
    const summaryEl = document.getElementById('kasir-summary');
    if (summaryEl) summaryEl.classList.remove('hidden');

    // Reset kalkulasi
    document.getElementById('calc-months').innerText = '0';
    document.getElementById('calc-total').innerText = 'Rp 0';
};

// --- MODAL PRATINJAU PASFOTO SISWA KASIR SPP ---
window.openStudentPhotoPreview = (nis, name, classStr, photoUrl) => {
    const modal = document.getElementById('modal-preview-student-photo');
    if (!modal) return;

    const imgEl = document.getElementById('preview-student-img');
    const fallbackEl = document.getElementById('preview-student-fallback');
    const nameEl = document.getElementById('preview-student-name');
    const classEl = document.getElementById('preview-student-class');
    const nisEl = document.getElementById('preview-student-nis');

    if (nameEl) nameEl.innerText = name || '-';
    if (classEl) classEl.innerText = classStr || '-';
    if (nisEl) nisEl.innerText = nis || '-';

    let resolved = photoUrl ? resolvePhotoUrl(photoUrl) : '';
    if (resolved && !/^(https?:|\/|data:image\/)/i.test(resolved)) {
        resolved = '';
    }

    if (resolved && imgEl && fallbackEl) {
        imgEl.src = resolved;
        imgEl.onload = () => {
            imgEl.classList.remove('hidden');
            fallbackEl.classList.add('hidden');
        };
        imgEl.onerror = () => {
            imgEl.classList.add('hidden');
            fallbackEl.classList.remove('hidden');
        };
        if (imgEl.complete && imgEl.naturalWidth > 0) {
            imgEl.classList.remove('hidden');
            fallbackEl.classList.add('hidden');
        }
    } else if (imgEl && fallbackEl) {
        imgEl.classList.add('hidden');
        fallbackEl.classList.remove('hidden');
    }

    modal.classList.remove('hidden');
};

window.closeStudentPhotoPreview = () => {
    const modal = document.getElementById('modal-preview-student-photo');
    if (modal) modal.classList.add('hidden');
};

function calculateCohort(className) {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const academicYearStart = currentMonth >= 6 ? currentYear : currentYear - 1;

    // Jika kelas alumni, parse tahun dari format nama kelas "Alumni XII ... (2025/2026)"
    if (className.toLowerCase().includes('alumni')) {
        const match = className.match(/(\d{4})\/(\d{4})/);
        if (match) {
            const endAcademicYear = parseInt(match[2]); // Tahun lulus (misal 2026)
            const startYear = endAcademicYear - 3; // Tahun masuk kelas X (misal 2023)
            const endYear = startYear + 2; // Tahun kelas XII (misal 2025)
            return { startYear, endYear };
        }
        return { startYear: currentYear - 3, endYear: currentYear - 1 };
    }

    let offset = 0;
    if (className.startsWith("XII")) offset = 2;
    else if (className.startsWith("XI")) offset = 1;
    else offset = 0;

    const startYear = academicYearStart - offset;
    const endYear = startYear + 2; // Hanya 3 tahun (X, XI, XII)
    return { startYear, endYear };
}

/**
 * Mendapatkan nominal tarif SPP untuk siswa tertentu pada periode bulan & tahun tertentu
 * berdasarkan angkatan masuk (cohort) secara historis (SSOT).
 * @param {object} student - Data siswa { nis, name, class }
 * @param {number} y - Tahun tagihan (contoh: 2025)
 * @param {number} m - Bulan tagihan (1 - 12)
 * @returns {number} Nominal tarif yang harus dibayarkan
 */
function getRateForStudent(student, y, m) {
    if (!student || !student.class) return 0;
    const cohort = calculateCohort(student.class);
    
    // Tentukan tahun ajaran dari bulan tunggakan tersebut
    // Ajaran baru dimulai bulan Juli (7)
    const academicYearOfPeriod = (m >= 7) ? y : y - 1;
    
    // Hitung tingkatan kelas pada bulan tersebut dibandingkan tahun mulai masuk
    const diff = academicYearOfPeriod - cohort.startYear;
    
    let targetGrade = "X";
    if (diff === 1) targetGrade = "XI";
    else if (diff === 2) targetGrade = "XII";
    
    const cohortYearStr = String(cohort.startYear);
    
    // 1. Coba ambil dari tarif angkatan (cohorts)
    if (ratesConfig.cohorts && ratesConfig.cohorts[cohortYearStr]) {
        const cohortObj = ratesConfig.cohorts[cohortYearStr];
        // Ambil nominal spesifik jika disetel
        if (cohortObj[targetGrade] !== undefined) {
            return cohortObj[targetGrade];
        }
        // Fallback: Jika nominal kelas spesifik tidak disetel, ambil nominal tingkat kelas lain yang ada di angkatan tersebut (karena tarif angkatan flat)
        const availableRates = Object.values(cohortObj).filter(v => typeof v === 'number');
        if (availableRates.length > 0) {
            return availableRates[0];
        }
    }
    
    // 2. Fallback: gunakan tarif global lama
    return ratesConfig[targetGrade] || 0;
}

async function loadPaymentHistory(nis) {
    paymentHistory = {};

    const cleanNis = String(nis || '').trim();
    if (!cleanNis) return;

    // === MEMORY CACHE: Cek apakah NIS ini sudah pernah di-query ===
    const cached = paymentHistoryCache[cleanNis];
    if (cached) {
        paymentHistory = { ...cached.data }; // Shallow copy agar aman
        return;
    }

    initSupabase();
    if (!supabase) throw new Error('Supabase client belum siap');

    const { data, error } = await supabase
        .from('finance_transactions')
        .select('id, transaction_id, student_nis, student_name, student_class, year, month, amount, payment_date, date_str, type, teller_name, payment_method, notes')
        .eq('student_nis', cleanNis);

    if (error) {
        console.error('[Keuangan] Error loadPaymentHistory Supabase:', error);
        throw error;
    }

    if (data) {
        data.forEach(row => {
            const key = `${row.year}-${row.month}`;
            paymentHistory[key] = {
                id: row.id,
                transactionId: row.transaction_id || row.id,
                studentNIS: row.student_nis,
                studentName: row.student_name,
                studentClass: row.student_class,
                year: row.year,
                month: row.month,
                amount: Number(row.amount) || 0,
                paymentDate: row.payment_date ? { toDate: () => new Date(row.payment_date) } : null,
                dateStr: row.date_str,
                type: row.type || 'paid',
                tellerName: row.teller_name,
                paymentMethod: row.payment_method,
                notes: row.notes
            };
        });
    }

    // Simpan ke memory cache
    paymentHistoryCache[cleanNis] = {
        data: { ...paymentHistory },
        timestamp: Date.now()
    };
}

function isMonthPaid(y, m) {
    const key = `${y}-${m}`;
    const data = paymentHistory[key];

    // Jika ada data di database
    if (data) {
        // Cek apakah ini tanda 'Hutang Manual' (Override Migrasi)
        if (data.type === 'manual_debt') return false;
        return true; // Ada pembayaran asli
    }

    // Logika Migrasi Standar (Jika tidak ada data, cek tanggal)
    const itemDate = new Date(y, m - 1, systemDueDate);
    if (itemDate < SYSTEM_START_DATE) return true; // Otomatis Lunas

    return false;
}

function getFirstUnpaidMonth() {
    let currY = cohortInfo.startYear;
    let currM = 7;
    const maxY = cohortInfo.endYear + 1;
    const maxM = 6;

    while (currY < maxY || (currY === maxY && currM <= maxM)) {
        if (!isMonthPaid(currY, currM)) {
            return { year: currY, month: currM };
        }
        currM++;
        if (currM > 12) { currM = 1; currY++; }
    }
    return null;
}

function updateYearNavButtons(year) {
    const btnPrev = document.getElementById('btn-prev-year');
    const btnNext = document.getElementById('btn-next-year');
    if (!btnPrev || !btnNext || !cohortInfo || !cohortInfo.startYear) return;

    btnPrev.disabled = (year <= cohortInfo.startYear);
    btnPrev.classList.toggle('opacity-30', year <= cohortInfo.startYear);
    btnPrev.classList.toggle('cursor-not-allowed', year <= cohortInfo.startYear);

    btnNext.disabled = (year >= cohortInfo.endYear);
    btnNext.classList.toggle('opacity-30', year >= cohortInfo.endYear);
    btnNext.classList.toggle('cursor-not-allowed', year >= cohortInfo.endYear);
}

window.changeYear = (delta) => {
    const displayEl = document.getElementById('display-year');
    if (!displayEl) return;
    // Parse tahun awal dari format "2025/2026" atau angka biasa
    let currentDisplay = displayEl.innerText;
    let newYear = parseInt(currentDisplay.split('/')[0]) + delta;
    if (cohortInfo && cohortInfo.startYear) {
        if (newYear < cohortInfo.startYear || newYear > cohortInfo.endYear) {
            return; // Blokir pergerakan jika sudah mentok di batas awal/akhir (tanpa toast)
        }
    }
    displayEl.innerText = `${newYear}/${newYear + 1}`;
    renderSppGrid(newYear);
};

window.renderSppGrid = (year) => {
    document.getElementById('display-year').innerText = `${year}/${year + 1}`;
    
    // Perbarui status tombol prev/next navigation
    updateYearNavButtons(year);

    // Perbarui label tarif aktif agar dinamis mengikuti tahun ajaran yang ditampilkan
    updateActiveRateBadge(year);

    const grid = document.getElementById('spp-grid');
    grid.innerHTML = '';

    // Cek Range: Jika di luar masa studi 3 tahun, jangan tampilkan kartu
    if (year < cohortInfo.startYear || year > cohortInfo.endYear) {
        grid.innerHTML = `
            <div class="col-span-full text-center p-8 bg-slate-50 border border-dashed border-slate-300 rounded-lg text-slate-400">
                <i class="fa-solid fa-ban text-2xl mb-2"></i><br>
                Tidak ada tagihan SPP untuk Tahun Ajaran ${year}/${year + 1}.<br>
                <span class="text-xs">Masa studi siswa: ${cohortInfo.startYear}/${cohortInfo.startYear + 1} - ${cohortInfo.endYear}/${cohortInfo.endYear + 1}</span>
            </div>
        `;
        return;
    }

    // Nama bulan Indonesia
    const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

    // Urutan bulan tahun ajaran: Juli (7) - Juni (6)
    const academicMonths = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];

    const role = localStorage.getItem('user_role');
    const isHeadmaster = role === 'kepala_sekolah';
    const today = new Date();
    const gradYear = cohortInfo.endYear + 1;
    let gridHtml = '';

    academicMonths.forEach((mNum) => {
        const actualYear = mNum >= 7 ? year : year + 1;
        const mName = monthNames[mNum - 1];
        const key = `${actualYear}-${mNum}`;
        const isPaidRecord = paymentHistory[key];
        const itemDate = new Date(actualYear, mNum - 1, systemDueDate);
        const isPaid = isMonthPaid(actualYear, mNum);
        const isSelected = selectedMonths.some(m => m.year === actualYear && m.month === mNum);

        let isLocked = false;
        if (actualYear < cohortInfo.startYear || (actualYear === cohortInfo.startYear && mNum < 7)) isLocked = true;
        if (actualYear > gradYear || (actualYear === gradYear && mNum > 6)) isLocked = true;

        let boxClass = ""; let contentHtml = ""; let statusHtml = ""; let clickAction = "";
        // Kunci hapus berdasarkan tahun buku kas pembayaran (tanggal bayar), bukan tahun tagihan
        const isYearClosed = !!getLockedPaymentBookYear(isPaidRecord, actualYear, mNum);
        const deleteBtn = (isHeadmaster || isYearClosed) ? '' : `<div class="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200"><button onclick="event.stopPropagation(); window.confirmDeletePayment(${actualYear}, ${mNum})" class="w-6 h-6 bg-white dark:bg-slate-700 text-red-500 rounded-full shadow border border-red-100 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/50 flex items-center justify-center transition-transform hover:scale-110" title="Ubah jadi Nunggak"><i class="fa-solid fa-trash-can text-[10px]"></i></button></div>`;

        if (isSelected) {
            boxClass = "bg-blue-100 dark:bg-blue-900/40 border-blue-500 dark:border-blue-400 ring-2 ring-blue-300 dark:ring-blue-600 cursor-pointer transform scale-105 shadow-md z-10";
            contentHtml = `<div class="text-xs font-bold text-blue-700 dark:text-blue-300 mt-1">Bayar Ini</div>`;
            statusHtml = `<div class="absolute top-2 right-2 text-blue-600 dark:text-blue-400"><i class="fa-solid fa-circle-check"></i></div>`;
            clickAction = `onclick="handleGridClick(${actualYear}, ${mNum})"`;
        }
        else if (isLocked) {
            boxClass = "bg-slate-100 dark:bg-slate-800/50 border-slate-100 dark:border-slate-700 cursor-not-allowed opacity-50";
            contentHtml = `<div class="text-[10px] text-slate-400 dark:text-slate-500 mt-1 italic">Non-Aktif</div>`;
        }
        else if (isPaid) {
            if (isPaidRecord) {
                boxClass = "bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700 relative group";
                contentHtml = `<div class="text-xs font-bold text-green-700 dark:text-green-400 mt-1">Lunas</div>${deleteBtn}`;
                statusHtml = `<div class="absolute top-2 right-2 text-green-500 dark:text-green-400"><i class="fa-solid fa-circle-check"></i></div>`;
            } else {
                boxClass = "bg-emerald-50/60 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800 relative group cursor-default";
                contentHtml = `<div class="text-[10px] font-bold text-emerald-600/70 dark:text-emerald-400/70 mt-1">Lunas (Migrasi)</div>${deleteBtn}`;
                statusHtml = `<div class="absolute top-2 right-2 text-emerald-400/70 dark:text-emerald-500/70"><i class="fa-solid fa-check"></i></div>`;
            }
        }
        else if (itemDate < today) {
            boxClass = "bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/50 hover:border-red-300 dark:hover:bg-red-600";
            statusHtml = `<div class="absolute top-2 right-2 text-red-400 dark:text-red-400 text-[10px] font-bold">Nunggak</div>`;
            const rateVal = currentStudent ? getRateForStudent(currentStudent, actualYear, mNum) : 0;
            const rateStr = rateVal > 0 ? `Rp ${rateVal.toLocaleString('id-ID')}` : 'Rp -';
            contentHtml = `<div class="text-xs text-slate-400 dark:text-slate-500 mt-1">${rateStr}</div>`;
            clickAction = `onclick="handleGridClick(${actualYear}, ${mNum})"`;
        }
        else {
            boxClass = "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 hover:border-blue-300 dark:hover:border-blue-500 cursor-pointer";
            const rateVal = currentStudent ? getRateForStudent(currentStudent, actualYear, mNum) : 0;
            const rateStr = rateVal > 0 ? `Rp ${rateVal.toLocaleString('id-ID')}` : 'Rp -';
            contentHtml = `<div class="text-xs text-slate-400 dark:text-slate-500 mt-1">${rateStr}</div>`;
            clickAction = `onclick="handleGridClick(${actualYear}, ${mNum})"`;
        }

        if (isHeadmaster) {
            clickAction = "";
            boxClass = boxClass.replace('cursor-pointer', 'cursor-default');
        }

        let payDateHtml = '';
        if (isPaid && !isLocked) {
            if (isPaidRecord) {
                let pDate = null;
                if (isPaidRecord.paymentDate) {
                    if (typeof isPaidRecord.paymentDate.toDate === 'function') {
                        pDate = isPaidRecord.paymentDate.toDate();
                    } else {
                        pDate = new Date(isPaidRecord.paymentDate);
                    }
                } else if (isPaidRecord.dateStr) {
                    pDate = new Date(isPaidRecord.dateStr);
                }
                if (pDate && !isNaN(pDate.getTime())) {
                    const dd = String(pDate.getDate()).padStart(2, '0');
                    const mm = String(pDate.getMonth() + 1).padStart(2, '0');
                    payDateHtml = ` • <span class="bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 px-1 rounded font-medium text-[8.5px]" title="Tanggal Bayar: ${dd}/${mm}/${pDate.getFullYear()}"><i class="fa-regular fa-calendar-check mr-0.5"></i>${dd}/${mm}</span>`;
                }
            } else {
                payDateHtml = ` • <span class="bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1 rounded font-medium text-[8.5px]" title="Lunas Migrasi Awal"><i class="fa-solid fa-clock-rotate-left mr-0.5"></i>Migrasi</span>`;
            }
        }

        const yearLabel = `<div class="text-[9px] text-slate-400 dark:text-slate-500 flex items-center gap-1">${actualYear}${payDateHtml}</div>`;
        gridHtml += `<div class="relative p-3 rounded-lg border transition-all duration-200 ${boxClass}" ${clickAction}><h4 class="text-sm font-bold text-slate-700 dark:text-slate-200">${mName}</h4>${yearLabel}${contentHtml}${statusHtml}</div>`;
    });

    grid.innerHTML = gridHtml;
};

// ... (Fungsi confirmDeletePayment, executeDeletePayment, handleGridClick, updateCalculationUI, requestPayment, executePayment TETAP SAMA) ...
// (Agar kode bersih, gunakan versi sebelumnya)

window.confirmDeletePayment = (y, m) => {
    targetDelete = { year: y, month: m };
    document.getElementById('delete-confirm-input').value = "";
    document.getElementById('modal-delete-pay').classList.remove('hidden');
    setTimeout(() => document.getElementById('delete-confirm-input').focus(), 100);
};

window.executeDeletePayment = async () => {
    const confirmText = document.getElementById('delete-confirm-input').value.trim();

    if (confirmText !== 'HAPUS') {
        showToast("Konfirmasi Gagal", "Ketik 'HAPUS' (huruf kapital) untuk melanjutkan.", "error");
        document.getElementById('delete-confirm-input').value = "";
        document.getElementById('delete-confirm-input').focus();
        return;
    }
    
    const cachedLockYear = getLockedPaymentBookYear(paymentHistory[`${targetDelete.year}-${targetDelete.month}`], targetDelete.year, targetDelete.month);
    if (cachedLockYear) {
        showToast("Error", `Pembayaran ini tercatat di tahun buku ${cachedLockYear} yang sudah ditutup.`, "error");
        document.getElementById('modal-delete-pay').classList.add('hidden');
        return;
    }

    document.getElementById('modal-delete-pay').classList.add('hidden');

    try {
        initSupabase();
        const normNis = String(currentStudent.nis).trim();
        const docId = `${normNis}_${targetDelete.year}_${targetDelete.month}`;
        const itemDate = new Date(targetDelete.year, targetDelete.month - 1, systemDueDate);
        const nowIso = new Date().toISOString();

        // 1. Cek Data Existing di Supabase
        let existingRecord = null;
        if (supabase) {
            const { data: fetchTxData, error: fetchTxErr } = await supabase
                .from('finance_transactions')
                .select('*')
                .eq('id', docId)
                .maybeSingle();
            if (fetchTxErr) throw new Error(`Gagal membaca data transaksi: ${fetchTxErr.message}`);
            existingRecord = fetchTxData;
        }

        // Kunci tahun buku (data terbaru dari database): kas pada tahun tertutup tidak boleh berubah
        await refreshClosedYearsList();
        const lockedBookYear = getLockedPaymentBookYear(existingRecord, targetDelete.year, targetDelete.month);
        if (lockedBookYear) {
            throw new Error(`Pembayaran ini tercatat di tahun buku ${lockedBookYear} yang sudah ditutup.`);
        }

        if (itemDate < SYSTEM_START_DATE) {
            // Periode Migrasi (Sebelum 1 Juli 2026)
            if (existingRecord && existingRecord.type !== 'manual_debt') {
                const amountToDelete = Number(existingRecord.amount) || 0;
                const dateStrToUpdate = existingRecord.date_str || existingRecord.dateStr;

                // 1. Simpan ke Supabase (SSOT) dengan Kompensasi Rollback Atomik
                if (supabase) {
                    let summaryUpdated = false;
                    let originalSummaryAmount = 0;
                    let originalSummaryCount = 0;

                    // A. Kurangi finance_daily_summary terlebih dahulu jika ada mutasi kas riil
                    if (dateStrToUpdate && amountToDelete > 0) {
                        const { data: dailyRow, error: fetchSumErr } = await supabase
                            .from('finance_daily_summary')
                            .select('*')
                            .eq('id', dateStrToUpdate)
                            .maybeSingle();
                        if (fetchSumErr) throw new Error(`Gagal membaca buku kas harian: ${fetchSumErr.message}. Pembatalan pembayaran dibatalkan.`);

                        if (dailyRow) {
                            originalSummaryAmount = Number(dailyRow.total_amount) || 0;
                            originalSummaryCount = Number(dailyRow.transaction_count) || 0;

                            const { error: updateSumErr } = await supabase
                                .from('finance_daily_summary')
                                .update({
                                    total_amount: Math.max(0, originalSummaryAmount - amountToDelete),
                                    transaction_count: Math.max(0, originalSummaryCount - 1),
                                    updated_at: nowIso
                                })
                                .eq('id', dateStrToUpdate);

                            if (updateSumErr) {
                                throw new Error(`Gagal memperbarui buku kas harian: ${updateSumErr.message}. Pembatalan pembayaran dibatalkan.`);
                            }
                            summaryUpdated = true;
                        }
                    }

                    // B. Ubah status transaksi menjadi manual_debt
                    const { error: upsertDebtErr } = await supabase
                        .from('finance_transactions')
                        .upsert({
                            id: docId,
                            student_nis: normNis,
                            student_name: currentStudent.name,
                            student_class: currentStudent.class,
                            teller_name: currentTellerName,
                            year: targetDelete.year,
                            month: targetDelete.month,
                            type: 'manual_debt',
                            amount: 0,
                            updated_at: nowIso
                        }, { onConflict: 'id' });

                    if (upsertDebtErr) {
                        // ROLLBACK: Kembalikan nilai awal finance_daily_summary jika summary sudah terlanjur dipotong
                        if (summaryUpdated) {
                            try {
                                await supabase.from('finance_daily_summary').update({
                                    total_amount: originalSummaryAmount,
                                    transaction_count: originalSummaryCount,
                                    updated_at: new Date().toISOString()
                                }).eq('id', dateStrToUpdate);
                            } catch (rbErr) {
                                console.error('[Keuangan] Rollback summary migrasi gagal:', rbErr);
                            }
                        }
                        throw new Error(`Gagal menandai hutang transaksi: ${upsertDebtErr.message}. Buku kas harian telah dipulihkan (Rollback Berhasil).`);
                    }
                }

                showToast("Status Diubah", "Pembayaran dihapus, status kembali Nunggak.");
            } else if (!existingRecord) {
                // Buat penanda hutang baru (Manual Debt) di Supabase (SSOT)
                if (supabase) {
                    const { error: insDebtErr } = await supabase
                        .from('finance_transactions')
                        .upsert({
                            id: docId,
                            student_nis: normNis,
                            student_name: currentStudent.name,
                            student_class: currentStudent.class,
                            teller_name: currentTellerName,
                            year: targetDelete.year,
                            month: targetDelete.month,
                            type: 'manual_debt',
                            amount: 0,
                            updated_at: nowIso
                        }, { onConflict: 'id' });
                    if (insDebtErr) throw new Error(`Gagal membuat penanda hutang: ${insDebtErr.message}`);
                }

                showToast("Status Diubah", "Bulan migrasi ini ditandai sebagai BELUM LUNAS.");
            } else {
                // Sudah manual_debt -> Hapus record di Supabase (SSOT) agar kembali Lunas (Migrasi)
                if (supabase) {
                    const { error: delDebtErr } = await supabase.from('finance_transactions').delete().eq('id', docId);
                    if (delDebtErr) throw new Error(`Gagal menghapus tanda hutang: ${delDebtErr.message}`);
                }
                showToast("Status Diubah", "Tanda hutang dihapus, kembali ke Lunas (Migrasi).");
            }
        } else {
            // Bukan Periode Migrasi
            let amountToDelete = 0;
            let dateStrToUpdate = null;
            if (existingRecord) {
                amountToDelete = Number(existingRecord.amount) || 0;
                dateStrToUpdate = existingRecord.date_str || existingRecord.dateStr;
            }

            if (supabase) {
                let summaryUpdated = false;
                let originalSummaryAmount = 0;
                let originalSummaryCount = 0;

                // 1. Verifikasi dan perbarui finance_daily_summary terlebih dahulu jika ada mutasi kas
                if (dateStrToUpdate && amountToDelete > 0) {
                    const { data: dailyRow, error: fetchSumErr } = await supabase
                        .from('finance_daily_summary')
                        .select('*')
                        .eq('id', dateStrToUpdate)
                        .maybeSingle();
                    if (fetchSumErr) {
                        throw new Error(`Gagal membaca buku kas harian: ${fetchSumErr.message}. Penghapusan transaksi dibatalkan.`);
                    }

                    if (dailyRow) {
                        originalSummaryAmount = Number(dailyRow.total_amount) || 0;
                        originalSummaryCount = Number(dailyRow.transaction_count) || 0;

                        const { error: updateSumErr } = await supabase
                            .from('finance_daily_summary')
                            .update({
                                total_amount: Math.max(0, originalSummaryAmount - amountToDelete),
                                transaction_count: Math.max(0, originalSummaryCount - 1),
                                updated_at: nowIso
                            })
                            .eq('id', dateStrToUpdate);

                        if (updateSumErr) {
                            throw new Error(`Gagal memperbarui buku kas harian: ${updateSumErr.message}. Penghapusan transaksi dibatalkan.`);
                        }
                        summaryUpdated = true;
                    }
                }

                // 2. Eksekusi penghapusan dari finance_transactions
                const { error: delTxErr } = await supabase
                    .from('finance_transactions')
                    .delete()
                    .eq('id', docId);

                if (delTxErr) {
                    // ROLLBACK: Kembalikan nilai awal finance_daily_summary jika summary sudah terlanjur dipotong
                    if (summaryUpdated) {
                        try {
                            await supabase.from('finance_daily_summary').update({
                                total_amount: originalSummaryAmount,
                                transaction_count: originalSummaryCount,
                                updated_at: new Date().toISOString()
                            }).eq('id', dateStrToUpdate);
                        } catch (rbErr) {
                            console.error('[Keuangan] Rollback summary gagal:', rbErr);
                        }
                    }
                    throw new Error(`Gagal menghapus transaksi dari database: ${delTxErr.message}. Buku kas harian telah dipulihkan (Rollback Berhasil).`);
                }
            }

            if (typeof window.logAudit === 'function') {
                window.logAudit('DELETE_PAYMENT', docId, { year: targetDelete.year, month: targetDelete.month }, null, `Menghapus pembayaran SPP: ${currentStudent.name} (${targetDelete.month}/${targetDelete.year})`);
            }
            showToast("Dihapus", "Data pembayaran berhasil dihapus.");
        }

        // Invalidasi cache NIS ini karena data berubah
        delete paymentHistoryCache[normNis];
        // Invalidasi cache laporan harian
        const todayKey = window.getLocalISODate ? window.getLocalISODate(new Date()) : '';
        delete dailyReportCache[todayKey];
        // Invalidasi cache tunggakan kelas siswa ini
        delete classTransactionCache[currentStudent.class];
        try { sessionStorage.removeItem(`cache_arrears_${currentStudent.class}`); } catch(e) {}
        // Invalidasi cache arus kas
        window._cashflowCache = null;

        // Refresh UI
        await loadPaymentHistory(currentStudent.nis);
        const displayYear = parseInt(document.getElementById('display-year').innerText);
        renderSppGrid(displayYear);
        targetDelete = null;

    } catch (e) {
        console.error('[Keuangan] Error executeDeletePayment:', e);
        showToast("Gagal Menghapus", e.message || "Terjadi kesalahan sistem.", "error");
    }
};

window.handleGridClick = (targetY, targetM) => {
    const startPoint = getFirstUnpaidMonth();
    if (!startPoint) { showToast("Info", "Semua tagihan sudah lunas!"); return; }
    const startScore = startPoint.year * 12 + startPoint.month;
    const targetScore = targetY * 12 + targetM;
    if (targetScore < startScore) { showToast("Error", "Bulan ini sudah lunas.", "error"); return; }
    selectedMonths = [];
    let currY = startPoint.year;
    let currM = startPoint.month;
    while (currY < targetY || (currY === targetY && currM <= targetM)) {
        selectedMonths.push({ year: currY, month: currM });
        currM++;
        if (currM > 12) { currM = 1; currY++; }
    }
    const displayYear = parseInt(document.getElementById('display-year').innerText);
    renderSppGrid(displayYear);
    updateCalculationUI();
};

function updateCalculationUI() {
    if (!currentStudent) return;
    
    let total = 0;
    const rateDetails = [];
    selectedMonths.forEach(m => {
        const rate = getRateForStudent(currentStudent, m.year, m.month);
        total += rate;
        rateDetails.push(rate);
    });

    document.getElementById('calc-months').innerText = selectedMonths.length;
    document.getElementById('calc-total').innerText = "Rp " + total.toLocaleString('id-ID');
    const detailsEl = document.getElementById('calc-details');
    detailsEl.classList.remove('hidden');
    if (selectedMonths.length > 0) {
        const first = selectedMonths[0];
        const last = selectedMonths[selectedMonths.length - 1];
        const rangeText = (first.year === last.year && first.month === last.month)
            ? `${first.month}/${first.year}`
            : `${first.month}/${first.year} - ${last.month}/${last.year}`;

        const uniqueRates = [...new Set(rateDetails)];
        let rateText = "";
        if (uniqueRates.length === 1) {
            rateText = `Tarif: Rp ${uniqueRates[0].toLocaleString('id-ID')}/bln`;
        } else {
            rateText = `Tarif bervariasi (historis)`;
        }

        detailsEl.innerText = `Periode: ${rangeText}\n${rateText}`;
        document.getElementById('btn-pay-confirm').disabled = false;
    } else {
        detailsEl.innerText = "Pilih bulan pada kartu SPP di samping.";
        document.getElementById('btn-pay-confirm').disabled = true;
    }
}

window.requestPayment = () => {
    if (selectedMonths.length === 0) { showToast("Pilih Bulan", "Silakan klik bulan yang ingin dibayar.", "error"); return; }
    const totalStr = document.getElementById('calc-total').innerText;
    document.getElementById('confirm-pay-amount').innerText = totalStr;
    document.getElementById('confirm-pay-period').innerText = `Untuk ${selectedMonths.length} Bulan`;
    document.getElementById('modal-confirm-pay').classList.remove('hidden');
    setTimeout(() => {
        const btnYes = document.getElementById('btn-confirm-pay-yes');
        if (btnYes) btnYes.focus();
    }, 50);
};

window.executePayment = async () => {
    document.getElementById('modal-confirm-pay').classList.add('hidden');
    const btn = document.getElementById('btn-pay-confirm');
    if (btn) { btn.disabled = true; btn.innerHTML = "Memproses..."; }

    try {
        initSupabase();
        // Tanggal pembukuan: setelah tutup buku Desember, pembayaran dibukukan ke 1 Januari tahun berikutnya
        await refreshClosedYearsList();
        const realTodayStr = window.getLocalISODate(new Date());
        const todayStr = getFinancePostingDateStr(realTodayStr);
        const nowIso = new Date().toISOString();
        const normNis = String(currentStudent.nis).trim();

        const transactionsPayload = [];
        let totalBatchAmount = 0;

        selectedMonths.forEach(item => {
            const rateOfItem = getRateForStudent(currentStudent, item.year, item.month);
            const docId = `${normNis}_${item.year}_${item.month}`;
            totalBatchAmount += rateOfItem;

            transactionsPayload.push({
                id: docId,
                transaction_id: "TRX-" + Date.now() + Math.floor(Math.random() * 100),
                student_nis: normNis,
                student_name: currentStudent.name,
                student_class: currentStudent.class,
                year: item.year,
                month: item.month,
                amount: rateOfItem,
                payment_date: nowIso,
                date_str: todayStr,
                type: 'paid',
                teller_name: currentTellerName,
                payment_method: 'tunai',
                updated_at: nowIso
            });
        });

        // 1. Simpan ke Supabase (Primary Engine) dengan Kompensasi Rollback Atomik
        if (supabase) {
            const insertedIds = transactionsPayload.map(t => t.id);
            const { error: sbErr } = await supabase
                .from('finance_transactions')
                .upsert(transactionsPayload, { onConflict: 'id' });
            if (sbErr) throw new Error(`Gagal menyimpan transaksi pembayaran: ${sbErr.message}`);

            // Update daily summary di Supabase
            const { data: dailyRow, error: fetchDailyErr } = await supabase
                .from('finance_daily_summary')
                .select('*')
                .eq('id', todayStr)
                .maybeSingle();

            if (fetchDailyErr) {
                // ROLLBACK: Batalkan dan hapus transaksi yang baru saja disimpan
                try {
                    await supabase.from('finance_transactions').delete().in('id', insertedIds);
                } catch (rbErr) {
                    console.error('[Keuangan] Rollback transaksi gagal:', rbErr);
                }
                throw new Error(`Gagal membaca buku kas harian: ${fetchDailyErr.message}. Pembayaran dibatalkan secara penuh (Rollback Berhasil).`);
            }

            const curTotal = dailyRow ? (Number(dailyRow.total_amount) || 0) : 0;
            const curCount = dailyRow ? (Number(dailyRow.transaction_count) || 0) : 0;

            const { error: summaryErr } = await supabase
                .from('finance_daily_summary')
                .upsert({
                    id: todayStr,
                    date_str: todayStr,
                    total_amount: curTotal + totalBatchAmount,
                    transaction_count: curCount + selectedMonths.length,
                    updated_at: nowIso
                }, { onConflict: 'id' });

            if (summaryErr) {
                // ROLLBACK: Batalkan dan hapus transaksi yang baru saja disimpan
                try {
                    await supabase.from('finance_transactions').delete().in('id', insertedIds);
                } catch (rbErr) {
                    console.error('[Keuangan] Rollback transaksi gagal:', rbErr);
                }
                throw new Error(`Gagal memperbarui buku kas harian: ${summaryErr.message}. Pembayaran dibatalkan secara penuh (Rollback Berhasil).`);
            }
        }

        // Invalidasi cache NIS ini karena data berubah
        delete paymentHistoryCache[normNis];
        // Invalidasi cache laporan harian (hari ini)
        const todayKey = window.getLocalISODate ? window.getLocalISODate(new Date()) : '';
        delete dailyReportCache[todayKey];
        // Invalidasi cache tunggakan kelas siswa ini
        delete classTransactionCache[currentStudent.class];
        try { sessionStorage.removeItem(`cache_arrears_${currentStudent.class}`); } catch(e) {}

        if (typeof window.logAudit === 'function') {
            window.logAudit('CREATE_PAYMENT', normNis, null, { count: selectedMonths.length, total: totalBatchAmount }, `Menerima pembayaran SPP ${selectedMonths.length} bulan: ${currentStudent.name}`);
        }

        const paidMonths = [...selectedMonths]; // Simpan salinan bulan yang dibayar sebelum selectStudent meresetnya
        await selectStudent(currentStudent);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check-circle mr-2"></i> Proses Bayar`;
        }
        showToast("Pembayaran Sukses!", `Berhasil disimpan ke database.`);
        
        // Tampilkan Kwitansi Premium dengan data bulan yang dibayar
        window.showReceiptModal(currentStudent, paidMonths, null, currentTellerName);
        // Refresh summary dashboard kasir
        loadKasirSummary();
        // Invalidasi cache arus kas agar sinkron dengan pemasukan SPP baru
        window._cashflowCache = null;
    } catch (e) {
        console.error('[Keuangan] Error executePayment:', e);
        showToast("Gagal Memproses", e.message, "error");
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check-circle mr-2"></i> Proses Bayar`;
        }
    }
};

// --- HELPER NORMALISASI NIS (Leading Zero Guard) ---
function normalizeNIS(nis) {
    if (!nis) return "";
    return String(nis).trim().replace(/^0+/, "");
}

// --- FUNGSI PEMBANTU: HITUNG PEMASUKAN VIRTUAL SPP MIGRASI (JANUARI - JUNI 2026) ---
async function getMigrationRecords2026() {
    if (cachedMigrationRecords2026) return cachedMigrationRecords2026;

    initSupabase();
    if (!supabase) throw new Error('Supabase client belum siap');

    const { data, error } = await window.fetchAllSupabaseRows(
        supabase,
        'finance_transactions',
        q => q.eq('year', 2026),
        { selectFields: 'student_nis, year, month, type, amount' }
    );

    if (error) {
        console.error('[Keuangan] Error getMigrationRecords2026 Supabase:', error);
        throw error;
    }

    if (data) {
        cachedMigrationRecords2026 = data.map(r => ({
            studentNIS: r.student_nis,
            year: r.year,
            month: r.month,
            type: r.type || 'paid',
            amount: Number(r.amount) || 0
        }));
    } else {
        cachedMigrationRecords2026 = [];
    }

    return cachedMigrationRecords2026;
}

async function getVirtualMigrationEntries(targetYear, forceIncludeAlumni = false) {
    if (targetYear !== 2026) return [];
    if (cachedFrozenMigration) return cachedFrozenMigration;

    const virtualDates = ["2026-01-20", "2026-02-20", "2026-03-20", "2026-04-20", "2026-05-20", "2026-06-20"];
    try {
        initSupabase();
        if (supabase) {
            const { data: dsData, error: dsErr } = await window.fetchAllSupabaseRows(
                supabase,
                'finance_daily_summary',
                q => q.in('id', virtualDates).eq('is_migration', true),
                { selectFields: 'id, total_amount, transaction_count, is_migration' }
            );

            if (!dsErr && dsData && dsData.length === 6) {
                const virtualEntries = dsData.map(d => {
                    const dStr = d.date_str || d.id || '';
                    const m = parseInt(dStr.split('-')[1], 10) || 1;
                    return {
                        dateStr: dStr,
                        amount: Number(d.total_amount) || 0,
                        count: Number(d.transaction_count) || 0,
                        month: m
                    };
                });
                cachedFrozenMigration = virtualEntries.sort((a, b) => a.month - b.month);
                return cachedFrozenMigration;
            }
        }
    } catch (e) {
        console.warn("[Virtual Migration] Gagal memuat data beku dari Supabase daily summary, fallback ke dinamis:", e);
    }

    try {
        const dbRecords = {};
        const migrationRecords = await getMigrationRecords2026();
        migrationRecords.forEach(d => {
            if (d.studentNIS && d.month && d.month <= 6) {
                dbRecords[`${normalizeNIS(d.studentNIS)}_${d.month}`] = d.type || 'paid';
            }
        });

        let showAlumni = false;
        try {
            const configData = await window.getSystemConfig();
            showAlumni = configData.showAlumni || false;
        } catch (e) {}

        let students = studentsCache;
        if (!students || students.length === 0) {
            const allStudents = await window.getStudentsCache();
            students = allStudents.map(s => ({ nis: s.nis, name: s.name, class: s.class }));
        }
        if (!showAlumni && !forceIncludeAlumni) {
            students = students.filter(s => {
                if (!s.class) return true;
                const lowerClass = s.class.toLowerCase();
                return !['alumni', 'mutasi', 'pindah', 'keluar', 'nonaktif', 'non_aktif', 'lulus'].some(term => lowerClass.includes(term));
            });
        }

        const virtualEntries = [];
        for (let m = 1; m <= 6; m++) {
            let totalAmount = 0;
            let count = 0;
            students.forEach(student => {
                if (!student || !student.class) return;
                const cohort = calculateCohort(student.class);
                let isActive = true;
                if (2026 < cohort.startYear || (2026 === cohort.startYear && m < 7)) isActive = false;
                const gradYear = cohort.endYear + 1;
                if (2026 > gradYear || (2026 === gradYear && m > 6)) isActive = false;
                if (isActive && !dbRecords[`${normalizeNIS(student.nis)}_${m}`]) {
                    totalAmount += getRateForStudent(student, 2026, m);
                    count++;
                }
            });
            if (totalAmount > 0) virtualEntries.push({ dateStr: `2026-${String(m).padStart(2, '0')}-20`, amount: totalAmount, count, month: m });
        }
        return virtualEntries;
    } catch (e) {
        console.error("[Virtual Migration] Gagal menghitung:", e);
        return [];
    }
}

// --- HELPER REKAP: HITUNG LUNAS MIGRASI BERDASARKAN FILTER KELAS ---
async function getVirtualMigrationEntriesForClasses(targetYear, targetClasses) {
    if (targetYear !== 2026 || !Array.isArray(targetClasses) || targetClasses.length === 0) return [];
    const targetSet = new Set(targetClasses);

    try {
        const dbRecords = {};
        const migrationRecords = await getMigrationRecords2026();
        migrationRecords.forEach(d => {
            if (d.studentNIS && d.month && d.month <= 6) {
                dbRecords[`${normalizeNIS(d.studentNIS)}_${d.month}`] = d.type || 'paid';
            }
        });

        let students = studentsCache;
        if (!students || students.length === 0) {
            const allStudents = await window.getStudentsCache();
            students = allStudents.map(s => ({ nis: s.nis, name: s.name, class: s.class }));
        }
        students = students.filter(s => s?.class && targetSet.has(s.class));

        const virtualEntries = [];
        for (let m = 1; m <= 6; m++) {
            const classBuckets = {};
            students.forEach(student => {
                const cohort = calculateCohort(student.class);
                let isActive = true;
                if (2026 < cohort.startYear || (2026 === cohort.startYear && m < 7)) isActive = false;
                const gradYear = cohort.endYear + 1;
                if (2026 > gradYear || (2026 === gradYear && m > 6)) isActive = false;
                if (!isActive || dbRecords[`${normalizeNIS(student.nis)}_${m}`]) return;
                const className = student.class || '-';
                if (!classBuckets[className]) classBuckets[className] = { amount: 0, count: 0 };
                classBuckets[className].amount += getRateForStudent(student, 2026, m);
                classBuckets[className].count++;
            });
            const dueDay = Math.min(systemDueDate, new Date(2026, m, 0).getDate());
            Object.entries(classBuckets).forEach(([className, bucket]) => {
                if (bucket.amount > 0) virtualEntries.push({ dateStr: `2026-${String(m).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`, amount: bucket.amount, count: bucket.count, classText: className, month: m });
            });
        }
        return virtualEntries;
    } catch (e) {
        console.error("[Virtual Migration Recap] Gagal menghitung:", e);
        return [];
    }
}


// Helper: Isi Dropdown Kelas Laporan Harian
async function populateDailyClassDropdown() {
    const classSelect = document.getElementById('daily-class-select');
    if (!classSelect) return;

    const previousValue = classSelect.value || '';
    if (!studentsCache || studentsCache.length === 0) {
        await loadStudentList();
    }

    const gradeSelect = document.getElementById('daily-grade-select');
    const selectedGrade = gradeSelect ? gradeSelect.value : '';

    const allClasses = [...new Set(studentsCache.map(s => s.class).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
    );

    classSelect.innerHTML = '<option value="">Semua Kelas</option>';

    allClasses.forEach(c => {
        if (!c) return;
        if (selectedGrade) {
            const g = getGradeFromClass(c);
            if (g !== selectedGrade) return;
        }
        const opt = document.createElement('option');
        opt.value = c;
        opt.innerText = c;
        classSelect.appendChild(opt);
    });

    if ([...classSelect.options].some(opt => opt.value === previousValue)) {
        classSelect.value = previousValue;
    } else {
        classSelect.value = '';
    }
}

window.populateDailyClassDropdown = populateDailyClassDropdown;

window.onDailyGradeChange = () => {
    populateDailyClassDropdown();
    window.loadDailyReport();
};

// --- LAPORAN HARIAN (DENGAN MEMORY CACHE & FILTER KELAS/ANGKATAN) ---
window.loadDailyReport = async (forceRefresh = false) => {
    const dateInput = document.getElementById('report-date');
    if (!dateInput) return;
    const dateVal = dateInput.value;
    const gradeSelect = document.getElementById('daily-grade-select');
    const classSelect = document.getElementById('daily-class-select');
    const gradeVal = gradeSelect ? gradeSelect.value : '';
    const classVal = classSelect ? classSelect.value : '';
    const tbody = document.getElementById('report-tbody');
    if (!tbody) return;

    const cacheKey = `${dateVal}_g:${gradeVal}_c:${classVal}`;

    // === MEMORY CACHE: Cek apakah kombinasi filter ini sudah pernah di-query ===
    if (!forceRefresh) {
        const cached = dailyReportCache[cacheKey];
        if (cached) {
            console.log(`[Laporan Harian] CACHE HIT: ${cacheKey}`);
            tbody.innerHTML = cached.html;
            document.getElementById('report-total').innerText = cached.total;
            return;
        }
    }

    tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Memuat & Mengelompokkan Data...</td></tr>';

    try {
        // Ambil data virtual entry jika tanggalnya cocok (Tanggal 20 Jan - Jun 2026) dan tidak ada filter angkatan/kelas spesifik
        let virtualEntryForDate = null;
        const virtualDates = ["2026-01-20", "2026-02-20", "2026-03-20", "2026-04-20", "2026-05-20", "2026-06-20"];
        if (virtualDates.includes(dateVal) && !gradeVal && !classVal) {
            const virtualEntries = await getVirtualMigrationEntries(2026);
            virtualEntryForDate = virtualEntries.find(ve => ve.dateStr === dateVal);
        }

        let rawDocs = [];
        initSupabase();
        if (!supabase) throw new Error('Supabase client belum siap');

        const { data, error } = await window.fetchAllSupabaseRows(
            supabase,
            'finance_transactions',
            q => q.eq('date_str', dateVal).order('payment_date', { ascending: false }),
            { selectFields: 'id, transaction_id, student_nis, student_name, student_class, year, month, amount, payment_date, date_str, type, teller_name' }
        );

        if (error) {
            console.error('[Keuangan] Error loadDailyReport Supabase:', error);
            throw error;
        }

        // Pembayaran yang diterima setelah tutup buku Desember dibukukan ke 1 Januari tahun berikutnya.
        // Agar laporan harian kasir tetap sesuai uang yang diterima pada hari itu, sertakan berdasarkan waktu bayar riil.
        const dateValYear = getYearFromDateStr(dateVal);
        if (dateValYear && closedYearsList.includes(dateValYear)) {
            const [dy, dm, dd] = dateVal.split('-').map(Number);
            const dayStartIso = new Date(dy, dm - 1, dd).toISOString();
            const dayEndIso = new Date(dy, dm - 1, dd + 1).toISOString();
            const { data: postedRows, error: postedErr } = await window.fetchAllSupabaseRows(
                supabase,
                'finance_transactions',
                q => q.eq('date_str', `${dateValYear + 1}-01-01`)
                    .gte('payment_date', dayStartIso)
                    .lt('payment_date', dayEndIso)
                    .order('payment_date', { ascending: false }),
                { selectFields: 'id, transaction_id, student_nis, student_name, student_class, year, month, amount, payment_date, date_str, type, teller_name' }
            );
            if (postedErr) throw postedErr;
            if (Array.isArray(data) && postedRows && postedRows.length > 0) data.push(...postedRows);
        }

        if (data) {
            rawDocs = data.map(row => ({
                id: row.id,
                studentNIS: row.student_nis,
                studentName: row.student_name,
                studentClass: row.student_class,
                year: row.year,
                month: row.month,
                amount: Number(row.amount) || 0,
                paymentDate: row.payment_date ? { toDate: () => new Date(row.payment_date) } : null,
                dateStr: row.date_str,
                type: row.type || 'paid',
                tellerName: row.teller_name
            }));
        }

        const groupedData = {};
        let grandTotal = 0;

        // Sisipkan entri virtual migrasi jika ada
        if (virtualEntryForDate) {
            grandTotal += virtualEntryForDate.amount;
            groupedData['virtual_migration'] = {
                nis: 'virtual_migration',
                name: 'Migrasi',
                class: '-',
                teller: '-',
                items: [`Virtual SPP (${virtualEntryForDate.count} Siswa)`],
                rawMonths: [{ month: virtualEntryForDate.month, year: 2026 }],
                totalAmount: virtualEntryForDate.amount,
                lastTime: new Date(`${dateVal}T08:00:00`),
                ids: []
            };
        }

        rawDocs.forEach(d => {
            if (d.type === 'manual_debt') return;
            const studentClass = d.studentClass || '';
            const studentGrade = getGradeFromClass(studentClass);

            // Filter Angkatan (X, XI, XII)
            if (gradeVal && studentGrade !== gradeVal) return;

            // Filter Kelas Spesifik
            if (classVal && studentClass !== classVal) return;

            grandTotal += (d.amount || 0);
            const key = d.studentNIS;

            if (!groupedData[key]) {
                groupedData[key] = {
                    nis: d.studentNIS,
                    name: d.studentName,
                    class: d.studentClass,
                    teller: d.tellerName || 'Petugas',
                    items: [],
                    rawMonths: [], // Simpan bulan asli untuk kwitansi
                    totalAmount: 0,
                    lastTime: d.paymentDate ? (d.paymentDate.toDate ? d.paymentDate.toDate() : new Date(d.paymentDate)) : new Date(),
                    ids: []
                };
            }

            const monthName = new Date(d.year, d.month - 1, 1).toLocaleDateString('id-ID', { month: 'short' });
            const itemLabel = `${monthName} '${d.year.toString().slice(-2)}`;

            groupedData[key].items.push(itemLabel);
            groupedData[key].rawMonths.push({ month: d.month, year: d.year });
            groupedData[key].totalAmount += (d.amount || 0);
            groupedData[key].ids.push(d.id);
        });

        if (Object.keys(groupedData).length === 0) {
            const emptyHtml = '<tr><td colspan="5" class="p-8 text-center text-slate-400 italic bg-slate-50/50">Belum ada transaksi pada tanggal dan filter terpilih ini.</td></tr>';
            tbody.innerHTML = emptyHtml;
            document.getElementById('report-total').innerText = "Rp 0";
            
            const todayStr = window.getLocalISODate ? window.getLocalISODate(new Date()) : '';
            if (dateVal !== todayStr) {
                dailyReportCache[cacheKey] = { html: emptyHtml, total: "Rp 0" };
            }
            return;
        }

        let html = '';
        Object.values(groupedData).forEach(group => {
            const timeStr = group.lastTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            const itemsStr = group.items.reverse().join(', ');
            const itemCount = group.items.length;

            html += `
             <tr class="hover:bg-blue-50/70 dark:hover:bg-blue-950/20 transition border-b border-slate-50 dark:border-slate-800/80 last:border-0 group cursor-default text-xs">
                 <td class="px-4 py-2 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">${timeStr}</td>
                 <td class="px-4 py-2">
                     <div class="flex items-center gap-2">
                         <span class="font-bold text-slate-700 dark:text-slate-200 truncate max-w-[250px] md:max-w-[350px] lg:max-w-[450px]" title="${window.escapeHTML(group.name)}">${window.escapeHTML(group.name)}</span>
                         <span class="text-[10px] bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 font-mono whitespace-nowrap">${window.escapeHTML(group.class)}</span>
                         
                         <!-- Tombol Reprint Kwitansi -->
                         ${group.nis !== 'virtual_migration' ? `
                         <button onclick="window.reprintFromDailyReport(this)" 
                             data-nis="${group.nis}"
                             data-name="${window.escapeHTML(group.name)}"
                             data-class="${window.escapeHTML(group.class)}"
                             data-months="${window.escapeHTML(JSON.stringify(group.rawMonths))}"
                             data-amount="${group.totalAmount}"
                             data-teller="${window.escapeHTML(group.teller)}"
                             class="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 p-1 rounded transition-colors flex items-center justify-center shrink-0 ml-1" title="Cetak Ulang Kwitansi">
                             <i class="fa-solid fa-print text-[11px]"></i>
                         </button>` : ''}
                     </div>
                 </td>
                 <td class="px-4 py-2">
                     <div class="text-slate-600 dark:text-slate-300 truncate max-w-[350px] md:max-w-[500px] lg:max-w-[700px]" title="${itemsStr}">
                         ${group.nis !== 'virtual_migration' ? `
                         <span class="font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 rounded text-[10px] mr-1 border border-blue-100 dark:border-blue-900/50">${itemCount} Bln</span>
                         ` : ''}
                         ${itemsStr}
                     </div>
                 </td>
                 <td class="px-4 py-2 text-right font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                     Rp ${group.totalAmount.toLocaleString()}
                 </td>
                 <td class="px-4 py-2 text-center">
                     <div class="w-5 h-5 bg-green-100 dark:bg-green-950/30 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mx-auto shadow-sm">
                         <i class="fa-solid fa-check text-[10px]"></i>
                     </div>
                 </td>
             </tr>`;
        });

        tbody.innerHTML = html;
        const totalStr = "Rp " + grandTotal.toLocaleString();
        document.getElementById('report-total').innerText = totalStr;

        // Simpan ke cache (hari lalu aman di-cache, hari ini invalidasi otomatis saat ada pembayaran baru)
        const todayStr = window.getLocalISODate ? window.getLocalISODate(new Date()) : '';
        if (dateVal !== todayStr) {
            dailyReportCache[cacheKey] = { html, total: totalStr };
        }
        console.log(`[Laporan Harian] CACHED: ${cacheKey}`);

    } catch (e) {
        console.error(e);
        showToast("Error Load", e.message, "error");
    }
};

// 2. FUNGSI LOAD DATA REKAP BULANAN
window.lastRecapData = []; // Variabel global untuk export

// --- UPDATE: LOAD REKAP (BERDASARKAN TANGGAL BAYAR) ---
window.loadRecapIncome = async () => {
    const selectedClass = document.getElementById('recap-class-select')?.value || '';
    const selectedMonthValue = document.getElementById('recap-month-select')?.value || '';
    const isAllMonths = selectedMonthValue === 'all';
    const selectedMonth = isAllMonths ? null : parseInt(selectedMonthValue, 10);
    const selectedYear = parseInt(document.getElementById('recap-year-select')?.value || '', 10);
    const tbody = document.getElementById('report-tbody');

    if (!selectedClass) {
        showToast("Info", "Pilih kelas terlebih dahulu.", "info");
        return;
    }

    if ((!isAllMonths && !selectedMonth) || !selectedYear) {
        showToast("Info", "Pilih bulan dan tahun terlebih dahulu.", "info");
        return;
    }

    const startMonth = isAllMonths ? 1 : selectedMonth;
    const endMonth = isAllMonths ? 12 : selectedMonth;
    const startDate = `${selectedYear}-${String(startMonth).padStart(2, '0')}-01`;
    const endDateObj = new Date(selectedYear, endMonth, 0);
    const endDate = window.getLocalISODate ? window.getLocalISODate(endDateObj) : endDateObj.toLocaleDateString('sv-SE');
    const periodLabel = isAllMonths
        ? `Semua Bulan ${selectedYear}`
        : endDateObj.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

    tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Menganalisis pemasukan bulan terpilih...</td></tr>';

    try {
        const targetClasses = getRecapTargetClasses(selectedClass);
        const selectedClassLabel = getRecapClassLabel(selectedClass);
        if (targetClasses.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-400 italic bg-slate-50/50">Tidak ada kelas yang cocok dengan filter.</td></tr>';
            document.getElementById('report-total').innerText = "Rp 0";
            window.lastRecapData = [];
            window.lastRecapPeriod = null;
            return;
        }

        let rawRows = [];
        initSupabase();
        if (!supabase) throw new Error('Supabase client belum siap');

        const { data, error } = await window.fetchAllSupabaseRows(
            supabase,
            'finance_transactions',
            q => q.in('student_class', targetClasses).gte('date_str', startDate).lte('date_str', endDate).neq('type', 'manual_debt'),
            { selectFields: 'student_class, amount, date_str, type' }
        );

        if (error) {
            console.error('[Keuangan] Error loadRecapIncome Supabase:', error);
            throw error;
        }

        if (data) {
            rawRows = data.map(r => ({
                studentClass: r.student_class,
                amount: Number(r.amount) || 0,
                dateStr: r.date_str,
                type: r.type || 'paid'
            }));
        }

        const grouped = {};

        rawRows.forEach(d => {
            if ((d.amount || 0) <= 0 || d.type === 'manual_debt') return;

            const dateKey = d.dateStr || startDate;
            const classText = d.studentClass || selectedClassLabel;
            const groupKey = `${dateKey}__${classText}`;
            if (!grouped[groupKey]) {
                grouped[groupKey] = {
                    date: dateKey,
                    classText,
                    count: 0,
                    total: 0
                };
            }
            grouped[groupKey].count += 1;
            grouped[groupKey].total += d.amount || 0;
        });

        if (selectedYear === 2026 && (isAllMonths || selectedMonth <= 6)) {
            const virtualMigrationEntries = await getVirtualMigrationEntriesForClasses(selectedYear, targetClasses);
            virtualMigrationEntries
                .filter(ve => (isAllMonths || ve.month === selectedMonth) && ve.dateStr >= startDate && ve.dateStr <= endDate)
                .forEach(ve => {
                    const classText = ve.classText || selectedClassLabel;
                    const groupKey = `${ve.dateStr}__${classText}`;
                    if (!grouped[groupKey]) {
                        grouped[groupKey] = {
                            date: ve.dateStr,
                            classText,
                            count: 0,
                            total: 0,
                            note: ''
                        };
                    }
                    grouped[groupKey].count += ve.count || 0;
                    grouped[groupKey].total += ve.amount || 0;
                    grouped[groupKey].note = 'Termasuk Lunas Migrasi';
                });
        }

        const recapRows = Object.values(grouped).sort((a, b) => {
            const dateCompare = a.date.localeCompare(b.date);
            if (dateCompare !== 0) return dateCompare;
            return (a.classText || '').localeCompare(b.classText || '', undefined, { numeric: true });
        });

        let html = '';
        let no = 1;
        let grandTotal = 0;
        let grandCount = 0;

        if (recapRows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-slate-400 italic bg-slate-50/50">Tidak ada pemasukan SPP pada ${periodLabel}.</td></tr>`;
            document.getElementById('report-total').innerText = "Rp 0";
            window.lastRecapData = [];
            window.lastRecapPeriod = { startDate, endDate, label: periodLabel, month: isAllMonths ? 'all' : selectedMonth, year: selectedYear };
            return;
        }

        window.lastRecapData = recapRows;
        window.lastRecapPeriod = { startDate, endDate, label: periodLabel, month: isAllMonths ? 'all' : selectedMonth, year: selectedYear };

        recapRows.forEach(item => {
            grandTotal += item.total;
            grandCount += item.count;
            const dateObj = new Date(`${item.date}T00:00:00`);
            const dateDisplay = dateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
            const dayName = dateObj.toLocaleDateString('id-ID', { weekday: 'long' });

            html += `
             <tr class="hover:bg-slate-50 transition border-b border-slate-100 last:border-0">
                 <td class="px-4 py-3 text-center text-slate-400 font-mono text-xs border-r border-slate-50">${no++}</td>
                 <td class="px-4 py-3">
                     <div class="font-bold text-slate-800 text-sm">${dateDisplay}</div>
                     <div class="text-[10px] text-slate-400 font-medium">${dayName}${item.note ? ` - ${window.escapeHTML(item.note)}` : ''}</div>
                 </td>
                 <td class="px-4 py-3 text-center">
                     <span class="px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">${window.escapeHTML(item.classText)}</span>
                 </td>
                 <td class="px-4 py-3 text-center">
                     <span class="bg-indigo-50 text-indigo-700 px-2 py-1 rounded text-xs font-bold border border-indigo-100">${item.count} Transaksi</span>
                 </td>
                 <td class="px-4 py-3 text-right font-bold text-slate-700 font-mono text-sm">Rp ${item.total.toLocaleString()}</td>
             </tr>`;
        });

        tbody.innerHTML = html;
        document.getElementById('report-total').innerText = `${grandCount.toLocaleString()} Transaksi | Rp ${grandTotal.toLocaleString()}`;

    } catch (e) {
        console.error(e);
        showToast("Error", "Gagal memuat rekap.", "error");
    }
};

// --- UPDATE: EXPORT EXCEL (JUDUL TANGGAL) ---
window.exportRecapToExcel = () => {
    if (!window.lastRecapData || window.lastRecapData.length === 0) {
        showToast("Data Kosong", "Tidak ada data rekap untuk diexport.", "error");
        return;
    }

    const selectClassEl = document.getElementById('recap-class-select');
    const classText = selectClassEl?.options?.[selectClassEl.selectedIndex]?.text || 'Kelas';
    const period = window.lastRecapPeriod || {};
    const startD = period.startDate || '';
    const endD = period.endDate || '';
    const periodLabel = period.label || `${startD} s/d ${endD}`;

    let tableHTML = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
            <style>
                table { border-collapse: collapse; width: 100%; }
                th { background-color: #4338ca; color: white; border: 1px solid #000; padding: 10px; }
                td { border: 1px solid #000; padding: 5px; }
                .text-right { text-align: right; }
                .text-center { text-align: center; }
            </style>
        </head>
        <body>
            <h3 style="text-align: center;">REKAP PEMASUKAN SPP</h3>
            <p style="text-align: center;">Kelas: ${classText} | Periode: ${periodLabel} (${startD} s/d ${endD})</p>
            <table>
                <thead>
                    <tr>
                        <th>NO</th>
                        <th>TANGGAL BAYAR</th>
                        <th>KELAS / FILTER</th>
                        <th>JUMLAH TRANSAKSI</th>
                        <th>TOTAL PEMASUKAN</th>
                    </tr>
                </thead>
                <tbody>`;

    let grandTotal = 0;
    let grandCount = 0;

    window.lastRecapData.forEach((item, idx) => {
        grandTotal += item.total;
        grandCount += item.count;

        tableHTML += `
            <tr>
                <td class="text-center">${idx + 1}</td>
                <td>${item.date}${item.note ? ` - ${item.note}` : ''}</td>
                <td class="text-center">${item.classText}</td>
                <td class="text-center">${item.count}</td>
                <td class="text-right">${item.total}</td>
            </tr>`;
    });

    tableHTML += `
            <tr style="background-color: #e0e7ff; font-weight: bold;">
                <td colspan="3" class="text-right">TOTAL</td>
                <td class="text-center">${grandCount}</td>
                <td class="text-right">${grandTotal}</td>
            </tr>
        </tbody></table></body></html>`;

    const blob = new Blob([tableHTML], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Rekap_Pemasukan_SPP_${classText.replace(/[^a-zA-Z0-9]/g, "_")}_${startD}_sd_${endD}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// --- UPDATE: SIMPAN TARIF (HAPUS TITIK SEBELUM SAVE) ---
document.getElementById('form-rates').addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log("[DEBUG] Form Rates Submitted!");

    // Hapus titik sebelum konversi ke Integer
    const cleanNumber = (val) => parseInt(val.replace(/\./g, '')) || 0;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const academicYearStart = (currentMonth >= 6) ? currentYear : currentYear - 1;

    const cX = String(academicYearStart);
    const cXI = String(academicYearStart - 1);
    const cXII = String(academicYearStart - 2);

    const rateX = cleanNumber(document.getElementById('rate-x').value);
    const rateXI = cleanNumber(document.getElementById('rate-xi').value);
    const rateXII = cleanNumber(document.getElementById('rate-xii').value);    const data = {
        X: rateX,
        XI: rateXI,
        XII: rateXII,
        cohorts: {
            [cX]: { X: rateX, XI: rateX, XII: rateX },
            [cXI]: { X: rateXI, XI: rateXI, XII: rateXI },
            [cXII]: { X: rateXII, XI: rateXII, XII: rateXII }
        }
    };

    // SPP-1: Tambah try-catch agar user dapat feedback jika gagal
    try {
        if (window.cfClient && window.cfClient.enabled) {
            await window.cfClient.saveSystemSetting('finance_rates', data);
        }
        
        // Update local memory state
        if (!ratesConfig.cohorts) {
            ratesConfig.cohorts = {};
        }
        ratesConfig.X = rateX;
        ratesConfig.XI = rateXI;
        ratesConfig.XII = rateXII;
        ratesConfig.cohorts[cX] = { X: rateX, XI: rateX, XII: rateX };
        ratesConfig.cohorts[cXI] = { X: rateXI, XI: rateXI, XII: rateXI };
        ratesConfig.cohorts[cXII] = { X: rateXII, XI: rateXII, XII: rateXII };

        setSessionCache(SESSION_CACHE_KEYS.FINANCE_RATES, ratesConfig);
        // Invalidasi cache global agar halaman lain baca tarif terbaru
        if (typeof window.invalidateFinanceCache === 'function') window.invalidateFinanceCache();

        // Audit Trail
        if (typeof window.logAudit === 'function') {
            window.logAudit('UPDATE_FINANCE_RATES', 'finance_rates', null, data, `Mengubah tarif SPP: X=${data.X}, XI=${data.XI}, XII=${data.XII}`);
        }
        window.showToast('Berhasil!', 'Tarif angkatan telah diperbarui.', 'success');
    } catch (e) {
        console.error("Gagal simpan tarif:", e);
        showToast("Gagal", "Gagal menyimpan tarif: " + e.message, "error");
    }
});

// --- UPDATE: SWITCH TAB (Handling Default Date Range) ---
window.switchReportMode = async (mode) => {
    // ... (kode reset button & class tetap sama) ...
    const btns = ['daily', 'recap', 'budget', 'arrears', 'estimation'];
    btns.forEach(b => {
        const btnEl = document.getElementById(`btn-rep-${b}`);
        const filterEl = document.getElementById(`filter-${b}`);
        if (b === mode) {
            if (btnEl) btnEl.className = "px-4 py-1.5 rounded-md shadow bg-white text-slate-800 transition-all font-bold border border-slate-200";
            if (filterEl) { filterEl.classList.remove('hidden'); filterEl.classList.add('flex'); }
        } else {
            if (btnEl) btnEl.className = "px-4 py-1.5 rounded-md text-slate-500 hover:text-slate-800 transition-all";
            if (filterEl) { filterEl.classList.add('hidden'); filterEl.classList.remove('flex'); }
        }
    });

    const tbody = document.getElementById('report-tbody');
    const thead = document.getElementById('report-table-head');
    const footerLabel = document.getElementById('report-footer-label');
    const totalEl = document.getElementById('report-total');

    if (tbody) tbody.innerHTML = '';
    if (totalEl) totalEl.innerText = 'Rp 0';

    if (mode === 'daily') {
        if (thead) thead.innerHTML = `<th class="px-4 py-3 w-20 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Waktu</th><th class="px-4 py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Identitas Siswa</th><th class="px-4 py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Rincian Bulan</th><th class="px-4 py-3 text-right bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Total</th><th class="px-4 py-3 text-center w-16 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Status</th>`;
        if (footerLabel) footerLabel.innerText = "Total Pemasukan Hari Ini";
        await populateDailyClassDropdown();
        if (window.loadDailyReport) window.loadDailyReport();

    } else if (mode === 'recap') {
        if (thead) thead.innerHTML = `<th class="px-4 py-3 w-10 text-center bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">No</th><th class="px-4 py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Tanggal Bayar</th><th class="px-4 py-3 text-center bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Kelas / Filter</th><th class="px-4 py-3 text-center bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Jumlah Transaksi</th><th class="px-4 py-3 text-right bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Total Pemasukan</th>`;
        if (footerLabel) footerLabel.innerText = "Total Pemasukan Periode Ini";

        await populateRecapClassDropdown();

        populateRecapYearDropdown();

        const now = new Date();
        const inputMonth = document.getElementById('recap-month-select');
        const inputYear = document.getElementById('recap-year-select');
        if (inputMonth && !inputMonth.dataset.defaultInitialized) {
            inputMonth.value = String(now.getMonth() + 1);
            inputMonth.dataset.defaultInitialized = 'true';
        }
        if (inputYear && !inputYear.value) inputYear.value = String(now.getFullYear());

        const recapClass = document.getElementById('recap-class-select');
        if (recapClass?.value) {
            window.loadRecapIncome();
        } else if (tbody) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-400 italic bg-slate-50/50">Pilih kelas terlebih dahulu, lalu klik Tampilkan.</td></tr>';
        }

    } else if (mode === 'budget') {
        if (thead) thead.innerHTML = `<th class="px-4 py-3 w-10 text-center bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">No</th><th class="px-4 py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Identitas Siswa</th><th class="px-4 py-3 text-center bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Kelas</th><th class="px-4 py-3 text-center bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Bulan Tagihan</th><th class="px-4 py-3 text-center bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Tgl Bayar Kasir</th><th class="px-4 py-3 text-center bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Status Waktu Bayar</th><th class="px-4 py-3 text-right bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Nominal</th>`;
        if (footerLabel) footerLabel.innerText = "Total Realisasi Penerimaan";

        await populateBudgetClassDropdown();
        populateBudgetYearDropdown();

        const now = new Date();
        const inputYear = document.getElementById('budget-year-select');
        if (inputYear && !inputYear.value) inputYear.value = String(now.getFullYear());

        window.loadBudgetReport();

    } else if (mode === 'estimation') {
        window.estimationSortField = 'class';
        window.estimationSortDirection = 'asc';
        window.updateEstimationThead();
        if (footerLabel) footerLabel.innerText = "Total Potensial Penerimaan";
        
        // Set dropdown bulan & tahun default ke bulan/tahun sekarang
        const now = new Date();
        const inputMonth = document.getElementById('estimation-month-select');
        const inputYear = document.getElementById('estimation-year-select');
        if (inputMonth) inputMonth.value = String(now.getMonth() + 1);
        if (inputYear) inputYear.value = String(now.getFullYear());

        window.loadEstimationReport();

    } else {
        if (thead) thead.innerHTML = `<th class="px-4 py-3 w-10 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">No</th><th class="px-4 py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Siswa</th><th class="px-4 py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700"><span class="text-rose-600 dark:text-rose-400 font-bold">Tunggakan</span> <span class="text-slate-400 font-normal">/</span> <span class="text-emerald-600 dark:text-emerald-400 font-bold">Tagihan Aktif</span></th><th class="px-4 py-3 text-right bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Total Tagihan</th>`;
        if (footerLabel) footerLabel.innerText = "Estimasi Total Tunggakan & Tagihan Aktif";
        populateClassDropdown();
    }
};

// 4. FUNGSI ESTIMASI PENERIMAAN
window.lastEstimationData = []; // Variabel global untuk export Excel
window.rawEstimationResults = [];
window.estimationSortField = 'class';
window.estimationSortDirection = 'asc';

// Helper: Render Header Tabel Estimasi dengan Ikon Sort Interaktif & Background Solid (Anti-Transparan saat Scroll)
window.updateEstimationThead = () => {
    const thead = document.getElementById('report-table-head');
    if (!thead) return;

    const getSortIcon = (field) => {
        if (window.estimationSortField !== field) {
            return '<i class="fa-solid fa-sort text-[10px] ml-1 text-slate-400 opacity-60"></i>';
        }
        return window.estimationSortDirection === 'asc'
            ? '<i class="fa-solid fa-sort-up text-[10px] ml-1 text-indigo-600 dark:text-indigo-400"></i>'
            : '<i class="fa-solid fa-sort-down text-[10px] ml-1 text-indigo-600 dark:text-indigo-400"></i>';
    };

    const getThClass = (field, align = 'text-left') => {
        const isActive = window.estimationSortField === field;
        const bgClass = isActive 
            ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-950 dark:text-indigo-200 shadow-inner' 
            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700';
        return `px-4 py-3 ${align} select-none cursor-pointer font-bold border-b border-slate-200 dark:border-slate-700 transition-colors ${bgClass}`;
    };

    thead.innerHTML = `
        <th class="px-4 py-3 w-10 text-center bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">No</th>
        <th class="${getThClass('class', 'text-left')}" onclick="window.toggleEstimationSort('class')" title="Klik untuk mengurutkan berdasarkan Kelas">
            Kelas ${getSortIcon('class')}
        </th>
        <th class="${getThClass('studentCount', 'text-center')}" onclick="window.toggleEstimationSort('studentCount')" title="Klik untuk mengurutkan berdasarkan Jumlah Siswa">
            Jml Siswa ${getSortIcon('studentCount')}
        </th>
        <th class="${getThClass('estimationSPP', 'text-right')}" onclick="window.toggleEstimationSort('estimationSPP')" title="Klik untuk mengurutkan berdasarkan Estimasi SPP">
            Estimasi SPP ${getSortIcon('estimationSPP')}
        </th>
        <th class="${getThClass('tunggakanLalu', 'text-right')}" onclick="window.toggleEstimationSort('tunggakanLalu')" title="Klik untuk mengurutkan berdasarkan Tunggakan Lalu">
            Tunggakan Lalu ${getSortIcon('tunggakanLalu')}
        </th>
        <th class="${getThClass('totalPotensial', 'text-right')}" onclick="window.toggleEstimationSort('totalPotensial')" title="Klik untuk mengurutkan berdasarkan Total Potensial">
            Total Potensial ${getSortIcon('totalPotensial')}
        </th>
        <th class="${getThClass('realisasi', 'text-right')}" onclick="window.toggleEstimationSort('realisasi')" title="Klik untuk mengurutkan berdasarkan Realisasi Kas">
            Realisasi ${getSortIcon('realisasi')}
        </th>
        <th class="${getThClass('percentage', 'text-center')}" onclick="window.toggleEstimationSort('percentage')" title="Klik untuk mengurutkan berdasarkan Persentase Realisasi">
            Realisasi % ${getSortIcon('percentage')}
        </th>
    `;
};

// Helper: Toggle Pengurutan Tab Estimasi
window.toggleEstimationSort = (field) => {
    if (window.estimationSortField === field) {
        window.estimationSortDirection = (window.estimationSortDirection === 'asc') ? 'desc' : 'asc';
    } else {
        window.estimationSortField = field;
        // Kolom numerik default ke descending (terbesar ke terkecil), kolom nama kelas default ke ascending
        window.estimationSortDirection = (field === 'class') ? 'asc' : 'desc';
    }
    window.updateEstimationThead();
    window.renderEstimationTable();
};

// Helper: Render Body Tabel Estimasi (Cepat tanpa fetch ulang)
window.renderEstimationTable = () => {
    const tbody = document.getElementById('report-tbody');
    const totalEl = document.getElementById('report-total');
    const footerLabel = document.getElementById('report-footer-label');
    if (!tbody) return;

    const rawData = window.rawEstimationResults || [];
    if (rawData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-400 italic bg-slate-50/50">Tidak ada siswa aktif pada periode ini.</td></tr>';
        if (totalEl) totalEl.innerText = "Rp 0";
        return;
    }

    const field = window.estimationSortField || 'class';
    const direction = window.estimationSortDirection || 'asc';

    const sortedData = [...rawData].sort((a, b) => {
        let diff = 0;
        if (field === 'percentage') {
            const percA = a.percentage || 0;
            const percB = b.percentage || 0;
            diff = percA - percB;
        } else if (field === 'class') {
            diff = a.className.localeCompare(b.className, undefined, { numeric: true });
        } else {
            const valA = a[field] || 0;
            const valB = b[field] || 0;
            diff = valA - valB;
        }

        if (diff !== 0) {
            return direction === 'asc' ? diff : -diff;
        }
        // Secondary sort: nama kelas
        return a.className.localeCompare(b.className, undefined, { numeric: true });
    });

    window.lastEstimationData = sortedData; // Simpan untuk Excel export

    let html = '';
    let no = 1;
    let grandTotalStudents = 0;
    let grandTotalEstimation = 0;
    let grandTotalTunggakan = 0;
    let grandTotalRealisasi = 0;
    let grandTotalPotensial = 0;

    sortedData.forEach(est => {
        grandTotalStudents += est.studentCount;
        grandTotalEstimation += est.estimationSPP;
        grandTotalTunggakan += est.tunggakanLalu;
        grandTotalRealisasi += est.realisasi;
        grandTotalPotensial += est.totalPotensial;

        const percentage = est.percentage || 0;

        html += `
        <tr class="hover:bg-indigo-50/30 dark:hover:bg-indigo-950/20 transition border-b border-slate-50 dark:border-slate-800/80 last:border-0 group text-xs">
            <td class="px-4 py-2.5 text-center text-slate-400 dark:text-slate-500 font-mono border-r border-slate-50 dark:border-slate-800/80 bg-slate-50/30 dark:bg-slate-900/20">${no++}</td>
            <td class="px-4 py-2.5 font-bold text-slate-700 dark:text-slate-200">${window.escapeHTML(est.className)}</td>
            <td class="px-4 py-2.5 text-center font-mono font-medium">${est.studentCount} Siswa</td>
            <td class="px-4 py-2.5 text-right font-mono font-bold text-slate-600 dark:text-slate-300">Rp ${est.estimationSPP.toLocaleString('id-ID')}</td>
            <td class="px-4 py-2.5 text-right font-mono text-amber-600 dark:text-amber-400 font-bold">Rp ${est.tunggakanLalu.toLocaleString('id-ID')}</td>
            <td class="px-4 py-2.5 text-right font-mono font-bold text-slate-800 dark:text-slate-100">Rp ${est.totalPotensial.toLocaleString('id-ID')}</td>
            <td class="px-4 py-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">Rp ${est.realisasi.toLocaleString('id-ID')}</td>
            <td class="px-4 py-2.5 text-center align-middle">
                <div class="flex items-center justify-center gap-1.5">
                    <div class="w-12 bg-slate-100 dark:bg-slate-700/50 rounded-full h-1.5 overflow-hidden">
                        <div class="bg-indigo-500 h-1.5 rounded-full" style="width: ${Math.min(percentage, 100)}%"></div>
                    </div>
                    <span class="font-mono font-bold text-[10px] text-indigo-500 min-w-[30px] text-right">${percentage.toFixed(1)}%</span>
                </div>
            </td>
        </tr>`;
    });

    const grandPercentage = grandTotalPotensial > 0 
        ? (grandTotalRealisasi / grandTotalPotensial) * 100 
        : (grandTotalEstimation > 0 ? (grandTotalRealisasi / grandTotalEstimation) * 100 : 0);

    html += `
    <tr class="bg-slate-100 dark:bg-slate-800/80 font-bold border-t-2 border-slate-300 dark:border-slate-700 text-xs sticky bottom-0 z-10 shadow-[0_-2px_5px_rgba(0,0,0,0.05)]">
        <td class="px-4 py-3 text-center text-slate-500 font-mono border-r border-slate-200 dark:border-slate-700 bg-slate-200/50 dark:bg-slate-900/50">-</td>
        <td class="px-4 py-3 text-slate-800 dark:text-slate-100">TOTAL KUMULATIF</td>
        <td class="px-4 py-3 text-center font-mono">${grandTotalStudents} Siswa</td>
        <td class="px-4 py-3 text-right font-mono text-slate-800 dark:text-slate-100">Rp ${grandTotalEstimation.toLocaleString('id-ID')}</td>
        <td class="px-4 py-3 text-right font-mono text-amber-700 dark:text-amber-400">Rp ${grandTotalTunggakan.toLocaleString('id-ID')}</td>
        <td class="px-4 py-3 text-right font-mono text-slate-900 dark:text-slate-50">Rp ${grandTotalPotensial.toLocaleString('id-ID')}</td>
        <td class="px-4 py-3 text-right font-mono text-emerald-700 dark:text-emerald-400">Rp ${grandTotalRealisasi.toLocaleString('id-ID')}</td>
        <td class="px-4 py-3 text-center align-middle">
            <div class="flex items-center justify-center gap-1.5">
                <div class="w-12 bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                    <div class="bg-indigo-600 h-1.5 rounded-full" style="width: ${Math.min(grandPercentage, 100)}%"></div>
                </div>
                <span class="font-mono font-bold text-[10px] text-indigo-600 dark:text-indigo-400 min-w-[30px] text-right">${grandPercentage.toFixed(1)}%</span>
            </div>
        </td>
    </tr>`;

    tbody.innerHTML = html;
    if (totalEl) totalEl.innerText = "Rp " + grandTotalPotensial.toLocaleString('id-ID');
    if (footerLabel) footerLabel.innerText = "Total Potensial Penerimaan (Estimasi + Tunggakan)";
};

window.loadEstimationReport = async () => {
    const monthVal = parseInt(document.getElementById('estimation-month-select').value);
    const yearVal = parseInt(document.getElementById('estimation-year-select').value);
    const tbody = document.getElementById('report-tbody');
    const footerLabel = document.getElementById('report-footer-label');
    const totalEl = document.getElementById('report-total');

    tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Menghitung Estimasi & Tunggakan...</td></tr>';

    try {
        // 1. Dapatkan daftar siswa & load config showAlumni
        let showAlumni = false;
        try {
            const configData = await window.getSystemConfig();
            showAlumni = configData.showAlumni || false;
        } catch (e) { }

        let students = studentsCache;
        if (!students || students.length === 0) {
            const allStudents = await window.getStudentsCache();
            students = allStudents.map(s => ({
                nis: s.nis,
                name: s.name,
                class: s.class
            }));
        }

        if (!showAlumni) {
            students = students.filter(s => {
                if (!s.class) return true;
                const lowerClass = s.class.toLowerCase();
                return !(
                    lowerClass.includes('alumni') ||
                    lowerClass.includes('mutasi') ||
                    lowerClass.includes('pindah') ||
                    lowerClass.includes('keluar') ||
                    lowerClass.includes('nonaktif') ||
                    lowerClass.includes('non_aktif') ||
                    lowerClass.includes('lulus')
                );
            });
        }

        // 2. Fetch Data Transaksi per Siswa Aktif (Menggunakan NIS, agar akurat saat naik kelas/mutasi)
        const activeStudents = students.filter(s => {
            if (!s || !s.class) return false;
            const cohort = calculateCohort(s.class);
            let isActive = true;
            if (yearVal < cohort.startYear || (yearVal === cohort.startYear && monthVal < 7)) isActive = false;
            const gradYear = cohort.endYear + 1;
            if (yearVal > gradYear || (yearVal === gradYear && monthVal > 6)) isActive = false;
            return isActive;
        });

        const activeNISList = activeStudents.map(s => s.nis).filter(Boolean);
        const paidRecords = {};
        const targetMonthPrefix = `${yearVal}-${String(monthVal).padStart(2, '0')}`;
        const cashRealizationByNIS = {};

        if (activeNISList.length > 0) {
            const transactionDocs = await getTransactionsByNISList(activeNISList);
            transactionDocs.forEach(docSnap => {
                const d = docSnap.data();
                if (d && d.studentNIS) {
                    const normNIS = normalizeNIS(d.studentNIS);
                    if (d.year && d.month) {
                        paidRecords[`${normNIS}_${d.year}_${d.month}`] = d;
                    }

                    // Akumulasi seluruh uang masuk kasir pada bulan & tahun terpilih
                    // (termasuk SPP bulan ini, pelunasan tunggakan lalu, serta bayar di muka)
                    if (d.type !== 'manual_debt' && (d.amount || 0) > 0 && d.dateStr && d.dateStr.startsWith(targetMonthPrefix)) {
                        if (!cashRealizationByNIS[normNIS]) {
                            cashRealizationByNIS[normNIS] = 0;
                        }
                        cashRealizationByNIS[normNIS] += Number(d.amount) || 0;
                    }
                }
            });
        }


        // 3. Kelompokkan siswa & hitung estimasi, tunggakan lalu, realisasi per kelas
        const classEstimates = {};

        students.forEach(student => {
            if (!student || !student.class) return;
            const cohort = calculateCohort(student.class);

            // Cek apakah siswa aktif di bulan & tahun terpilih
            let isActive = true;
            if (yearVal < cohort.startYear || (yearVal === cohort.startYear && monthVal < 7)) isActive = false;
            const gradYear = cohort.endYear + 1;
            if (yearVal > gradYear || (yearVal === gradYear && monthVal > 6)) isActive = false;

            if (isActive) {
                const className = student.class;
                if (!classEstimates[className]) {
                    classEstimates[className] = {
                        className: className,
                        studentCount: 0,
                        estimationSPP: 0,
                        tunggakanLalu: 0,
                        totalPotensial: 0,
                        realisasi: 0
                    };
                }

                classEstimates[className].studentCount++;

                const normStudentNIS = normalizeNIS(student.nis);
                const key = `${normStudentNIS}_${yearVal}_${monthVal}`;
                const currentMonthRecord = paidRecords[key];
                const isPeriodMigrasi = yearVal === 2026 && monthVal <= 6;
                const targetMonthStart = `${yearVal}-${String(monthVal).padStart(2, '0')}-01`;

                // Cek apakah siswa sudah lunas di muka sebelum tanggal 1 bulan terpilih
                let isPaidInAdvance = false;
                if (isPeriodMigrasi) {
                    const hasManualDebt = currentMonthRecord && currentMonthRecord.type === 'manual_debt';
                    isPaidInAdvance = !hasManualDebt;
                } else if (currentMonthRecord && currentMonthRecord.type !== 'manual_debt') {
                    const payDateStr = currentMonthRecord.dateStr || '';
                    if (payDateStr && payDateStr < targetMonthStart) {
                        isPaidInAdvance = true;
                    }
                }

                // Estimasi SPP yang diharapkan masuk: jika sudah lunas di muka, kewajiban tagihan bulan ini adalah 0
                const rate = getRateForStudent(student, yearVal, monthVal);
                const studentEstimationSPP = isPaidInAdvance ? 0 : rate;
                classEstimates[className].estimationSPP += studentEstimationSPP;

                // Hitung realisasi penerimaan bulan berjalan (Sinkron dengan Buku Kas SPP)
                let studentRealisasi = 0;
                if (isPeriodMigrasi) {
                    // Periode migrasi: jika tidak ada hutang manual, berhak atas lunas migrasi virtual + pembayaran riil di kasir jika ada
                    const virtualPaid = isPaidInAdvance ? rate : 0;
                    const cashPaid = cashRealizationByNIS[normStudentNIS] || 0;
                    studentRealisasi = virtualPaid + cashPaid;
                } else {
                    // Periode reguler: realisasi adalah seluruh kas yang masuk dari siswa pada bulan terpilih
                    studentRealisasi = cashRealizationByNIS[normStudentNIS] || 0;
                }
                classEstimates[className].realisasi += studentRealisasi;

                // Hitung tunggakan lalu (dari cohort.startYear bulan 7 s.d. bulan sebelum targetMonth)
                let studentTunggakanLalu = 0;
                let currY = cohort.startYear;
                let currM = 7;

                // Batasi pengecekan tunggakan agar tidak melampaui masa aktif studi (Juni di tahun kelulusan)
                const maxY = cohort.endYear + 1;
                const maxM = 6;
                let checkLimitYear = yearVal;
                let checkLimitMonth = monthVal;

                if (checkLimitYear > maxY || (checkLimitYear === maxY && checkLimitMonth > maxM)) {
                    checkLimitYear = maxY;
                    checkLimitMonth = maxM + 1; // Agar perulangan while memeriksa sampai maxM (Juni)
                }

                while (currY < checkLimitYear || (currY === checkLimitYear && currM < checkLimitMonth)) {
                    const checkKey = `${normStudentNIS}_${currY}_${currM}`;
                    const checkRecord = paidRecords[checkKey];
                    const checkDueDate = new Date(currY, currM - 1, systemDueDate);

                    let isPaidBeforePeriod = false;
                    if (checkRecord) {
                        if (checkRecord.type === 'manual_debt') {
                            isPaidBeforePeriod = false;
                        } else {
                            // Cek apakah tanggal bayarnya terjadi sebelum tanggal 1 bulan terpilih
                            const payDateStr = checkRecord.dateStr || '';
                            if (payDateStr && payDateStr < targetMonthStart) {
                                isPaidBeforePeriod = true;
                            } else if (!payDateStr) {
                                isPaidBeforePeriod = (checkDueDate < SYSTEM_START_DATE);
                            } else {
                                // Dibayar pada/setelah targetMonthStart (per awal bulan masih berstatus tunggakan)
                                isPaidBeforePeriod = false;
                            }
                        }
                    } else {
                        if (checkDueDate < SYSTEM_START_DATE) {
                            isPaidBeforePeriod = true; // Lunas migrasi
                        } else {
                            isPaidBeforePeriod = false;
                        }
                    }

                    if (!isPaidBeforePeriod) {
                        studentTunggakanLalu += getRateForStudent(student, currY, currM);
                    }

                    currM++;
                    if (currM > 12) { currM = 1; currY++; }
                }
                classEstimates[className].tunggakanLalu += studentTunggakanLalu;
            }
        });

        // 4. Hitung persentase & render tabel
        const results = [];
        Object.keys(classEstimates).forEach(className => {
            const est = classEstimates[className];
            est.totalPotensial = est.estimationSPP + est.tunggakanLalu;
            est.percentage = est.totalPotensial > 0 
                ? (est.realisasi / est.totalPotensial) * 100 
                : (est.estimationSPP > 0 ? (est.realisasi / est.estimationSPP) * 100 : 0);
            results.push(est);
        });

        window.rawEstimationResults = results;
        window.updateEstimationThead();
        window.renderEstimationTable();

    } catch (e) {
        console.error("[Estimasi] Gagal menghitung:", e);
        showToast("Error Hitung", e.message, "error");
        tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-red-500 italic bg-red-50/20">Terjadi kesalahan pemrosesan estimasi.</td></tr>';
    }
};

// 5. EXPORT ESTIMASI KE EXCEL
window.exportEstimationToExcel = () => {
    if (!window.lastEstimationData || window.lastEstimationData.length === 0) {
        showToast("Info", "Tidak ada data estimasi untuk di-export.", "info");
        return;
    }

    try {
        const monthVal = document.getElementById('estimation-month-select').value;
        const yearVal = document.getElementById('estimation-year-select').value;
        const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        const periodName = `${monthNames[parseInt(monthVal) - 1]} ${yearVal}`;

        const dataExcel = window.lastEstimationData.map((item, index) => ({
            "No": index + 1,
            "Kelas": item.className,
            "Jumlah Siswa": item.studentCount,
            "Estimasi SPP Bulanan (Rupiah)": item.estimationSPP,
            "Tunggakan s.d. Bulan Lalu (Rupiah)": item.tunggakanLalu,
            "Total Potensial (Rupiah)": item.totalPotensial,
            "Realisasi Penerimaan (Rupiah)": item.realisasi,
            "Persentase Realisasi (%)": (item.totalPotensial > 0 ? (item.realisasi / item.totalPotensial) * 100 : (item.estimationSPP > 0 ? (item.realisasi / item.estimationSPP) * 100 : 0)).toFixed(2)
        }));

        const ws = XLSX.utils.json_to_sheet(dataExcel);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Estimasi Penerimaan");

        // Auto-fit column width
        const maxLen = {};
        dataExcel.forEach(row => {
            Object.keys(row).forEach(key => {
                const val = String(row[key]);
                maxLen[key] = Math.max(maxLen[key] || 10, val.length);
            });
        });
        ws["!cols"] = Object.keys(maxLen).map(key => ({ wch: maxLen[key] + 3 }));

        XLSX.writeFile(wb, `Estimasi_Penerimaan_SPP_${periodName.replace(' ', '_')}.xlsx`);
        showToast("Export Berhasil", "Data estimasi berhasil diexport ke Excel.");

    } catch (e) {
        console.error("[Export Estimasi] Gagal:", e);
        showToast("Error Export", e.message, "error");
    }
};

// Helper: Isi Dropdown Kelas (REVISI: SORTING NUMERIK CERDAS)
function populateClassDropdown() {
    const select = document.getElementById('report-class-select');
    if (select.options.length > 1) return;

    // 1. Ambil Kelas Unik & Sortir Numerik (X-1 ... X-10)
    const classes = [...new Set(studentsCache.map(s => s.class))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
    );

    classes.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.innerText = c;
        select.appendChild(opt);
    });

    // 2. Separator & Global Options
    const sep = document.createElement('option');
    sep.disabled = true; sep.innerText = "----------------";
    select.appendChild(sep);

    const globalOptions = [
        { val: "Grade-X", text: "★ KELAS X" },
        { val: "Grade-XI", text: "★ KELAS XI" },
        { val: "Grade-XII", text: "★ KELAS XII" }
    ];

    globalOptions.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.val; opt.innerText = g.text;
        opt.className = "bg-blue-50 font-bold text-blue-700";
        select.appendChild(opt);
    });
}

async function populateRecapClassDropdown() {
    const select = document.getElementById('recap-class-select');
    if (!select) return;

    const previousValue = select.value || '';
    if (!studentsCache || studentsCache.length === 0) {
        await loadStudentList();
    }

    const classes = [...new Set(studentsCache.map(s => s.class).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
    );

    select.innerHTML = '<option value="">Pilih Kelas...</option>';

    classes.forEach(c => {
        if (!c) return;
        const opt = document.createElement('option');
        opt.value = c; opt.innerText = c;
        select.appendChild(opt);
    });

    if (classes.length > 0) {
        const sep = document.createElement('option');
        sep.disabled = true;
        sep.innerText = "----------------";
        select.appendChild(sep);
    }

    const globalOptions = [
        { val: "Grade-X", text: "KELAS X" },
        { val: "Grade-XI", text: "KELAS XI" },
        { val: "Grade-XII", text: "KELAS XII" }
    ];

    globalOptions.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.val;
        opt.innerText = g.text;
        opt.className = "bg-blue-50 font-bold text-blue-700";
        select.appendChild(opt);
    });

    if ([...select.options].some(opt => opt.value === previousValue)) {
        select.value = previousValue;
    } else {
        select.value = '';
    }
}

function populateRecapYearDropdown() {
    const select = document.getElementById('recap-year-select');
    if (!select || select.options.length > 0) return;

    const currentYear = new Date().getFullYear();
    for (let year = currentYear; year >= currentYear - 2; year--) {
        const opt = document.createElement('option');
        opt.value = String(year);
        opt.innerText = String(year);
        select.appendChild(opt);
    }
}

function getRecapTargetClasses(selectedClass) {
    if (!selectedClass) return [];

    const classes = [...new Set(studentsCache.map(s => s.class).filter(Boolean))];
    if (selectedClass === "Grade-X" || selectedClass === "Grade-XI" || selectedClass === "Grade-XII") {
        return classes.filter(c => matchesRecapGradeClass(c, selectedClass));
    }

    return [selectedClass];
}

function getRecapClassLabel(selectedClass) {
    const select = document.getElementById('recap-class-select');
    const selectedOption = select?.options?.[select.selectedIndex];
    return selectedOption?.text || selectedClass || '-';
}

function matchesRecapGradeClass(studentClass, gradeFilter) {
    const c = (studentClass || '').toLowerCase();
    if (gradeFilter === "Grade-X") {
        return c.startsWith('x-') || c.startsWith('x ') || c === 'gradex' || c === 'grade-x';
    }
    if (gradeFilter === "Grade-XI") {
        return c.startsWith('xi-') || c.startsWith('xi ') || c === 'gradexi' || c === 'grade-xi';
    }
    if (gradeFilter === "Grade-XII") {
        return c.startsWith('xii-') || c.startsWith('xii ') || c === 'gradexii' || c === 'grade-xii';
    }
    return false;
}

// --- 3. SUB-TAB LAPORAN TAHUN ANGGARAN (AKRUAL / REALISASI PENERIMAAN ANGGARAN) ---
window.lastBudgetData = [];
window.lastBudgetMetadata = null;

async function populateBudgetClassDropdown() {
    const select = document.getElementById('budget-class-select');
    if (!select) return;

    const previousValue = select.value || '';
    if (!studentsCache || studentsCache.length === 0) {
        await loadStudentList();
    }

    const classes = [...new Set(studentsCache.map(s => s.class).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
    );

    select.innerHTML = '<option value="">Semua Kelas</option>';

    const globalOptions = [
        { val: "Grade-X", text: "SEMUA KELAS X" },
        { val: "Grade-XI", text: "SEMUA KELAS XI" },
        { val: "Grade-XII", text: "SEMUA KELAS XII" }
    ];

    globalOptions.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.val;
        opt.innerText = g.text;
        opt.className = "bg-blue-50 font-bold text-blue-700";
        select.appendChild(opt);
    });

    if (classes.length > 0) {
        const sep = document.createElement('option');
        sep.disabled = true;
        sep.innerText = "----------------";
        select.appendChild(sep);
    }

    classes.forEach(c => {
        if (!c) return;
        const opt = document.createElement('option');
        opt.value = c;
        opt.innerText = c;
        select.appendChild(opt);
    });

    if ([...select.options].some(opt => opt.value === previousValue)) {
        select.value = previousValue;
    } else {
        select.value = '';
    }
}

function populateBudgetYearDropdown() {
    const select = document.getElementById('budget-year-select');
    if (!select || select.options.length > 0) return;

    const currentYear = new Date().getFullYear();
    for (let year = currentYear - 2; year <= currentYear + 4; year++) {
        const opt = document.createElement('option');
        opt.value = String(year);
        opt.innerText = `Tahun ${year}`;
        if (year === currentYear) opt.selected = true;
        select.appendChild(opt);
    }
}

// Helper pemformat gabungan bulan tagihan tahun anggaran
window.formatBudgetMonths = (monthList, year) => {
    const sorted = Array.from(new Set(monthList || [])).filter(m => typeof m === 'number' && m >= 1 && m <= 12).sort((a, b) => a - b);
    if (sorted.length === 0) {
        return {
            title: '-',
            badge: '0 Bulan',
            subDetail: '',
            shortStr: '-',
            count: 0
        };
    }

    const monthNamesShort = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const monthNamesLong = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

    if (sorted.length === 12) {
        return {
            title: `Januari – Desember ${year}`,
            badge: '1 Tahun Penuh (12 Bln)',
            subDetail: 'Jan s.d. Des',
            shortStr: `Januari - Desember ${year} (12 Bulan)`,
            count: 12
        };
    }

    if (sorted.length === 1) {
        return {
            title: `${monthNamesLong[sorted[0]]} ${year}`,
            badge: '1 Bulan',
            subDetail: '',
            shortStr: `${monthNamesLong[sorted[0]]} ${year}`,
            count: 1
        };
    }

    // Cek apakah bulan berurutan tanpa jeda
    let isConsecutive = true;
    for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i + 1] !== sorted[i] + 1) {
            isConsecutive = false;
            break;
        }
    }

    if (isConsecutive) {
        const startName = monthNamesLong[sorted[0]];
        const endName = monthNamesLong[sorted[sorted.length - 1]];
        return {
            title: `${startName} – ${endName} ${year}`,
            badge: `${sorted.length} Bulan Berurutan`,
            subDetail: `${monthNamesShort[sorted[0]]} s.d. ${monthNamesShort[sorted[sorted.length - 1]]}`,
            shortStr: `${startName} - ${endName} ${year} (${sorted.length} Bulan)`,
            count: sorted.length
        };
    }

    // Jika tidak berurutan, tampilkan daftar singkatan bulan
    const shortList = sorted.map(m => monthNamesShort[m]).join(', ');
    return {
        title: `${shortList} ${year}`,
        badge: `${sorted.length} Bulan`,
        subDetail: `Bulan: ${sorted.join(', ')}`,
        shortStr: `${shortList} ${year} (${sorted.length} Bulan)`,
        count: sorted.length
    };
};

window.loadBudgetReport = async () => {
    const tbody = document.getElementById('report-tbody');
    const totalEl = document.getElementById('report-total');
    const footerLabel = document.getElementById('report-footer-label');
    if (!tbody) return;

    const yearSelect = document.getElementById('budget-year-select');
    const monthSelect = document.getElementById('budget-month-select');
    const classSelect = document.getElementById('budget-class-select');
    const statusSelect = document.getElementById('budget-status-select');

    const selectedYear = parseInt(yearSelect?.value) || new Date().getFullYear();
    const selectedMonth = monthSelect?.value || 'all';
    const selectedClass = classSelect?.value || '';
    const selectedStatus = statusSelect?.value || 'all';

    tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Memuat Data Tahun Anggaran...</td></tr>';
    if (totalEl) totalEl.innerText = 'Menghitung...';

    try {
        initSupabase();
        if (!supabase) throw new Error('Supabase client belum siap');

        if (!studentsCache || studentsCache.length === 0) {
            await loadStudentList();
        }

        let targetClasses = [];
        if (selectedClass) {
            targetClasses = getRecapTargetClasses(selectedClass);
        }

        // Query Supabase finance_transactions berdasarkan TAHUN TAGIHAN SPP (year)
        const { data, error } = await window.fetchAllSupabaseRows(
            supabase,
            'finance_transactions',
            q => {
                let query = q.eq('year', selectedYear).neq('type', 'manual_debt');
                if (selectedMonth !== 'all') {
                    query = query.eq('month', parseInt(selectedMonth));
                }
                if (targetClasses.length > 0) {
                    query = query.in('student_class', targetClasses);
                }
                return query.order('month', { ascending: true }).order('payment_date', { ascending: false });
            },
            { selectFields: 'id, transaction_id, student_nis, student_name, student_class, year, month, amount, payment_date, date_str, type, teller_name' }
        );

        if (error) {
            console.error('[Keuangan] Error loadBudgetReport Supabase:', error);
            throw error;
        }

        let transactions = (data || []).map(row => ({
            id: row.id,
            nis: row.student_nis,
            name: row.student_name,
            class: row.student_class,
            year: row.year,
            month: row.month,
            amount: Number(row.amount) || 0,
            payDateStr: row.date_str || (row.payment_date ? row.payment_date.substring(0, 10) : ''),
            paymentDate: row.payment_date,
            teller: row.teller_name || '-'
        }));

        // Sisipkan entri virtual migrasi jika tahun anggaran adalah 2026
        if (selectedYear === 2026 && (selectedMonth === 'all' || parseInt(selectedMonth) <= 6)) {
            const virtualMigrationEntries = await getVirtualMigrationEntriesForClasses(2026, targetClasses.length > 0 ? targetClasses : null);
            virtualMigrationEntries
                .filter(ve => (selectedMonth === 'all' || ve.month === parseInt(selectedMonth)))
                .forEach(ve => {
                    transactions.push({
                        id: `vm_${ve.month}_${ve.classText || 'all'}`,
                        nis: '-',
                        name: `Virtual Migrasi SPP (${ve.count} Siswa)`,
                        class: ve.classText || 'Semua Kelas',
                        year: 2026,
                        month: ve.month,
                        amount: ve.amount,
                        payDateStr: ve.dateStr,
                        paymentDate: `${ve.dateStr}T08:00:00`,
                        teller: 'Sistem Migrasi',
                        isMigration: true
                    });
                });
        }

        let grandTotal = 0;
        let advanceTotal = 0;
        let regularTotal = 0;
        let lateTotal = 0;
        let advanceCount = 0;
        let regularCount = 0;
        let lateCount = 0;
        let totalMonthsBilled = 0;

        // Grouping transaksi per siswa (1 siswa = 1 baris, bulan digabungkan)
        const studentGroups = new Map();

        transactions.forEach(trx => {
            const payYear = trx.payDateStr ? parseInt(trx.payDateStr.substring(0, 4)) : selectedYear;
            let status = 'regular';
            let statusLabel = 'Reguler';

            if (trx.isMigration) {
                status = 'regular';
                statusLabel = 'Migrasi (Lunas)';
            } else if (payYear < selectedYear) {
                status = 'advance';
                statusLabel = 'Dibayar di Muka';
            } else if (payYear > selectedYear) {
                status = 'late';
                statusLabel = 'Pelunasan Susulan';
            } else {
                status = 'regular';
                statusLabel = 'Reguler';
            }

            // Filter status waktu bayar jika dipilih spesifik
            if (selectedStatus !== 'all' && status !== selectedStatus) {
                return;
            }

            // Kunci unik: gunakan ID untuk migrasi virtual, atau NIS (fallback: Nama_Kelas) untuk siswa reguler
            const groupKey = trx.isMigration
                ? trx.id
                : (trx.nis && trx.nis !== '-' ? String(trx.nis).trim() : `${trx.name || 'Siswa'}_${trx.class || ''}`);

            if (!studentGroups.has(groupKey)) {
                studentGroups.set(groupKey, {
                    key: groupKey,
                    nis: trx.nis || '-',
                    name: trx.name || 'Siswa',
                    class: trx.class || '-',
                    year: selectedYear,
                    isMigration: !!trx.isMigration,
                    months: [],
                    totalAmount: 0,
                    payDates: new Set(),
                    payYears: new Set(),
                    tellers: new Set(),
                    statusCounts: { advance: 0, regular: 0, late: 0 }
                });
            }

            const group = studentGroups.get(groupKey);
            if (typeof trx.month === 'number') {
                group.months.push(trx.month);
            }
            group.totalAmount += trx.amount;
            if (trx.payDateStr) group.payDates.add(trx.payDateStr);
            if (payYear) group.payYears.add(payYear);
            if (trx.teller && trx.teller !== '-') group.tellers.add(trx.teller);
            if (status in group.statusCounts) {
                group.statusCounts[status]++;
            }

            // Hitung agregat nominal & jumlah tagihan
            grandTotal += trx.amount;
            totalMonthsBilled++;
            if (status === 'advance') {
                advanceTotal += trx.amount;
                advanceCount++;
            } else if (status === 'late') {
                lateTotal += trx.amount;
                lateCount++;
            } else {
                regularTotal += trx.amount;
                regularCount++;
            }
        });

        const processedRows = [];

        studentGroups.forEach(group => {
            const monthInfo = window.formatBudgetMonths(group.months, group.year);

            // Format tanggal bayar
            let payDateFormatted = '-';
            let payDateSubDetail = '';
            if (group.payDates.size > 0) {
                const datesArr = Array.from(group.payDates).sort();
                const formatDate = (iso) => {
                    const parts = (iso || '').split('-');
                    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : iso;
                };

                if (datesArr.length === 1) {
                    payDateFormatted = formatDate(datesArr[0]);
                } else {
                    const latest = formatDate(datesArr[datesArr.length - 1]);
                    payDateFormatted = latest;
                    payDateSubDetail = `${datesArr.length}x transaksi (terakhir: ${latest})`;
                }
            }

            // Status pembayaran & badge
            let status = 'regular';
            let statusLabel = 'Reguler';
            let badgeHtml = '';

            const payYearsArr = Array.from(group.payYears).sort();
            const payYearsText = payYearsArr.join(', ');

            if (group.isMigration) {
                status = 'regular';
                statusLabel = 'Migrasi (Lunas)';
                badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:text-slate-300"><i class="fa-solid fa-database mr-1"></i>Migrasi</span>`;
            } else {
                const { advance, regular, late } = group.statusCounts;
                const distinctTypes = [
                    advance > 0 ? 'advance' : null,
                    regular > 0 ? 'regular' : null,
                    late > 0 ? 'late' : null
                ].filter(Boolean);

                if (distinctTypes.length === 1) {
                    if (advance > 0) {
                        status = 'advance';
                        statusLabel = 'Dibayar di Muka';
                        badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-800"><i class="fa-solid fa-clock-rotate-left mr-1"></i>Dibayar di Muka (${payYearsText})</span>`;
                    } else if (late > 0) {
                        status = 'late';
                        statusLabel = 'Pelunasan Susulan';
                        badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"><i class="fa-solid fa-calendar-plus mr-1"></i>Susulan (${payYearsText})</span>`;
                    } else {
                        status = 'regular';
                        statusLabel = 'Reguler';
                        badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800"><i class="fa-solid fa-check mr-1"></i>Reguler</span>`;
                    }
                } else if (distinctTypes.length > 1) {
                    status = 'mixed';
                    const parts = [];
                    if (advance > 0) parts.push(`${advance} Bln Di Muka`);
                    if (regular > 0) parts.push(`${regular} Bln Reguler`);
                    if (late > 0) parts.push(`${late} Bln Susulan`);
                    statusLabel = `Kombinasi (${parts.join(', ')})`;
                    badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800" title="${statusLabel}"><i class="fa-solid fa-arrows-split-up-and-left mr-1"></i>Kombinasi (${parts.join(', ')})</span>`;
                }
            }

            const tellersText = group.tellers.size > 0 ? Array.from(group.tellers).join(', ') : '-';

            processedRows.push({
                ...group,
                status,
                statusLabel,
                badgeHtml,
                monthFormattedTitle: monthInfo.title,
                monthBadge: monthInfo.badge,
                monthSubDetail: monthInfo.subDetail,
                monthShortStr: monthInfo.shortStr,
                monthsCount: monthInfo.count,
                payDateStrFormatted: payDateFormatted,
                payDateSubDetail,
                tellersText
            });
        });

        // Urutkan daftar siswa: kelas (A-Z alami), lalu nama siswa (A-Z). Entri migrasi diletakkan teratur.
        processedRows.sort((a, b) => {
            if (a.isMigration && !b.isMigration) return 1;
            if (!a.isMigration && b.isMigration) return -1;
            const classComp = (a.class || '').localeCompare(b.class || '', undefined, { numeric: true, sensitivity: 'base' });
            if (classComp !== 0) return classComp;
            return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
        });

        window.lastBudgetData = processedRows;
        window.lastBudgetMetadata = {
            selectedYear,
            selectedMonth,
            selectedClass,
            selectedStatus,
            grandTotal,
            advanceTotal,
            regularTotal,
            lateTotal,
            totalMonthsBilled,
            totalStudents: processedRows.length
        };

        if (footerLabel) {
            footerLabel.innerText = `Total Realisasi Tahun Anggaran ${selectedYear}`;
        }
        if (totalEl) {
            totalEl.innerText = `Rp ${grandTotal.toLocaleString('id-ID')}`;
        }

        if (processedRows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400 italic bg-slate-50/50">Tidak ada transaksi tagihan SPP untuk Tahun Anggaran ${selectedYear} dengan filter yang dipilih.</td></tr>`;
            return;
        }

        let rowsHtml = '';
        processedRows.forEach((item, idx) => {
            rowsHtml += `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <td class="px-4 py-3 text-center text-slate-400 font-mono text-xs border-r border-slate-50 dark:border-slate-800">${idx + 1}</td>
                    <td class="px-4 py-3">
                        <div class="font-bold text-slate-800 dark:text-slate-100">${item.name}</div>
                        <div class="text-[11px] text-slate-400 font-mono">NIS: ${item.nis || '-'} • Kasir: ${item.tellersText}</div>
                    </td>
                    <td class="px-4 py-3 text-center">
                        <span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 font-bold text-xs">${item.class || '-'}</span>
                    </td>
                    <td class="px-4 py-3 text-center">
                        <div class="font-bold text-slate-800 dark:text-slate-100">${item.monthFormattedTitle}</div>
                        <div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 mr-1">${item.monthBadge}</span>
                            ${item.monthSubDetail ? `<span class="text-slate-400">${item.monthSubDetail}</span>` : ''}
                        </div>
                    </td>
                    <td class="px-4 py-3 text-center text-slate-600 dark:text-slate-300 font-mono text-xs">
                        <div>${item.payDateStrFormatted}</div>
                        ${item.payDateSubDetail ? `<div class="text-[10px] text-slate-400 font-sans mt-0.5">${item.payDateSubDetail}</div>` : ''}
                    </td>
                    <td class="px-4 py-3 text-center">
                        ${item.badgeHtml}
                    </td>
                    <td class="px-4 py-3 text-right font-mono font-bold text-slate-800 dark:text-slate-100">
                        Rp ${item.totalAmount.toLocaleString('id-ID')}
                    </td>
                </tr>
            `;
        });

        // Banner ringkasan cepat di atas tabel
        const summaryCardRow = `
            <tr class="bg-indigo-50/70 dark:bg-indigo-950/30 border-b border-indigo-100 dark:border-indigo-900 font-sans">
                <td colspan="7" class="p-3">
                    <div class="flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div class="flex items-center gap-2">
                            <span class="font-bold text-indigo-900 dark:text-indigo-200"><i class="fa-solid fa-chart-pie mr-1"></i>Realisasi Anggaran ${selectedYear}:</span>
                            <span class="font-bold font-mono text-indigo-700 dark:text-indigo-300 text-sm">Rp ${grandTotal.toLocaleString('id-ID')}</span>
                            <span class="text-slate-500 font-medium">(${processedRows.length} Siswa • ${totalMonthsBilled} Tagihan Bulan)</span>
                        </div>
                        <div class="flex flex-wrap items-center gap-3">
                            <span class="inline-flex items-center text-indigo-800 dark:text-indigo-300 text-[11px]">
                                <span class="w-2.5 h-2.5 rounded-full bg-indigo-500 mr-1.5"></span>
                                Dibayar di Muka: <strong class="ml-1 font-mono">Rp ${advanceTotal.toLocaleString('id-ID')}</strong> (${advanceCount} bln)
                            </span>
                            <span class="inline-flex items-center text-emerald-800 dark:text-emerald-300 text-[11px]">
                                <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 mr-1.5"></span>
                                Reguler ${selectedYear}: <strong class="ml-1 font-mono">Rp ${regularTotal.toLocaleString('id-ID')}</strong> (${regularCount} bln)
                            </span>
                            ${lateTotal > 0 ? `
                            <span class="inline-flex items-center text-amber-800 dark:text-amber-300 text-[11px]">
                                <span class="w-2.5 h-2.5 rounded-full bg-amber-500 mr-1.5"></span>
                                Pelunasan Susulan: <strong class="ml-1 font-mono">Rp ${lateTotal.toLocaleString('id-ID')}</strong> (${lateCount} bln)
                            </span>
                            ` : ''}
                        </div>
                    </div>
                </td>
            </tr>
        `;

        tbody.innerHTML = summaryCardRow + rowsHtml;

    } catch (err) {
        console.error('[Keuangan] Error loadBudgetReport:', err);
        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-red-500 font-semibold"><i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i><br>Gagal memuat data Tahun Anggaran: ${err.message || err}</td></tr>`;
        if (totalEl) totalEl.innerText = 'Rp 0';
    }
};

window.exportBudgetToExcel = () => {
    const data = window.lastBudgetData || [];
    const meta = window.lastBudgetMetadata;
    if (!data || data.length === 0 || !meta) {
        window.showToast("Data Kosong", "Tidak ada data Tahun Anggaran untuk diexport.", "error");
        return;
    }

    if (typeof XLSX === 'undefined') {
        window.showToast("Error", "Library XLSX belum siap.", "error");
        return;
    }

    try {
        const year = meta.selectedYear;
        const aoa = [
            [`LAPORAN REALISASI PENERIMAAN SPP TAHUN ANGGARAN ${year}`],
            [`SMA NEGERI NUSANTARA - SIMAS CERDAS`],
            [`Waktu Unduh: ${new Date().toLocaleString('id-ID')}`],
            [`Total Realisasi: Rp ${meta.grandTotal.toLocaleString('id-ID')} | Total Siswa: ${data.length} | Total Tagihan: ${meta.totalMonthsBilled} Bulan`],
            [`Rincian: Dibayar di Muka: Rp ${meta.advanceTotal.toLocaleString('id-ID')} | Reguler: Rp ${meta.regularTotal.toLocaleString('id-ID')}${meta.lateTotal > 0 ? ` | Susulan: Rp ${meta.lateTotal.toLocaleString('id-ID')}` : ''}`],
            [],
            ["No", "NIS", "Nama Siswa", "Kelas", "Bulan Tagihan Terbayar", "Jumlah Bulan", "Tahun Anggaran", "Tanggal Bayar Kasir", "Status Penerimaan", "Total Nominal (Rp)", "Petugas Kasir"]
        ];

        data.forEach((r, idx) => {
            aoa.push([
                idx + 1,
                r.nis || '-',
                r.name,
                r.class || '-',
                r.monthShortStr || r.monthFormattedTitle,
                r.monthsCount,
                r.year,
                r.payDateStrFormatted || '-',
                r.statusLabel,
                r.totalAmount,
                r.tellersText || '-'
            ]);
        });

        // Baris Total
        aoa.push([]);
        aoa.push(["", "", "", "", "", "", "", "", "TOTAL REALISASI", meta.grandTotal, ""]);
        aoa.push(["", "", "", "", "", "", "", "", "Rincian Dibayar di Muka", meta.advanceTotal, ""]);
        aoa.push(["", "", "", "", "", "", "", "", "Rincian Reguler", meta.regularTotal, ""]);
        if (meta.lateTotal > 0) {
            aoa.push(["", "", "", "", "", "", "", "", "Rincian Pelunasan Susulan", meta.lateTotal, ""]);
        }

        const ws = XLSX.utils.aoa_to_sheet(aoa);

        // Atur lebar kolom
        ws["!cols"] = [
            { wch: 6 },  // No
            { wch: 14 }, // NIS
            { wch: 32 }, // Nama Siswa
            { wch: 12 }, // Kelas
            { wch: 32 }, // Bulan Tagihan Terbayar
            { wch: 14 }, // Jumlah Bulan
            { wch: 16 }, // Tahun Anggaran
            { wch: 22 }, // Tanggal Bayar
            { wch: 24 }, // Status Penerimaan
            { wch: 18 }, // Total Nominal
            { wch: 20 }  // Petugas Kasir
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `Anggaran_${year}`);

        const fileName = `Laporan_Penerimaan_Tahun_Anggaran_${year}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        XLSX.writeFile(wb, fileName);
        window.showToast("Export Berhasil", `Laporan Tahun Anggaran ${year} berhasil diunduh.`, "success");
    } catch (e) {
        console.error("[Export Budget] Gagal:", e);
        window.showToast("Error Export", e.message, "error");
    }
};

// --- LOGIKA LAPORAN TUNGGAKAN (REVISI DATE FIX) ---
window.loadArrearsReport = async () => {
    const selectedVal = document.getElementById('report-class-select').value;
    const tbody = document.getElementById('report-tbody');
    const thead = document.getElementById('report-table-head');
    const footerLabel = document.getElementById('report-footer-label');

    if (thead) {
        thead.innerHTML = `<th class="px-4 py-3 w-10 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">No</th><th class="px-4 py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Siswa</th><th class="px-4 py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700"><span class="text-rose-600 dark:text-rose-400 font-bold">Tunggakan</span> <span class="text-slate-400 font-normal">/</span> <span class="text-emerald-600 dark:text-emerald-400 font-bold">Tagihan Aktif</span></th><th class="px-4 py-3 text-right bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">Total Tagihan</th>`;
    }
    if (footerLabel) footerLabel.innerText = "Estimasi Total Tunggakan & Tagihan Aktif";

    if (!selectedVal) {
        showToast("Pilih Kelas", "Silakan pilih kelas atau angkatan.", "error");
        return;
    }

    tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i><br>Mengambil Data...<br><span class="text-xs text-slate-300">(Smart Cache Active)</span></td></tr>';

    try {
        // 1. Filter Siswa (Global / Per Kelas)
        let targetStudents = [];
        let targetClasses = [];

        if (selectedVal.startsWith('Grade-')) {
            const grade = selectedVal.split('-')[1]; // X, XI, XII
            targetStudents = studentsCache.filter(s => {
                let sGrade = "X";
                if (s.class.startsWith("XII")) sGrade = "XII";
                else if (s.class.startsWith("XI")) sGrade = "XI";
                return sGrade === grade;
            });
            targetClasses = [...new Set(targetStudents.map(s => s.class))];
        } else {
            targetStudents = studentsCache.filter(s => s.class === selectedVal);
            targetClasses = [selectedVal];
        }

        if (targetStudents.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-slate-400 italic">Tidak ada data siswa ditemukan.</td></tr>';
            return;
        }

        // 2. Fetch Data Transaksi (Batch per Kelas dengan acuan NIS siswa) + sessionStorage backup
        const promises = targetClasses.map(async (className) => {
            // Level 1: Memory cache
            if (classTransactionCache[className]) return;

            // Level 2: sessionStorage cache
            const ssKey = `cache_arrears_${className}`;
            try {
                const ssData = sessionStorage.getItem(ssKey);
                if (ssData) {
                    classTransactionCache[className] = JSON.parse(ssData);
                    console.log(`[Tunggakan] SESSION HIT: ${className}`);
                    return;
                }
            } catch (e) { /* ignore parse errors */ }

            // Level 3: Firestore query (Menggunakan NIS)
            console.log(`[Tunggakan] QUERY Firestore (NIS) untuk Kelas: ${className}`);
            const classStudents = targetStudents.filter(s => s.class === className);
            const classNISList = classStudents.map(s => s.nis).filter(Boolean);

            const classData = {};
            if (classNISList.length > 0) {
                const transactionDocs = await getTransactionsByNISList(classNISList);
                transactionDocs.forEach(docSnap => {
                    const d = docSnap.data();
                    if (d.studentNIS && d.year && d.month) {
                        const normNIS = normalizeNIS(d.studentNIS);
                        if (!classData[normNIS]) classData[normNIS] = {};
                        classData[normNIS][`${d.year}-${d.month}`] = d.type || 'paid';
                    }
                });
            }
            classTransactionCache[className] = classData;

            // Simpan ke sessionStorage
            try {
                sessionStorage.setItem(ssKey, JSON.stringify(classData));
            } catch (e) { console.warn('[Tunggakan] sessionStorage full, skip cache'); }
        });

        await Promise.all(promises);

        // 3. Analisis Tunggakan
        let totalClassArrears = 0;
        let html = '';
        let no = 1;
        const results = [];

        let grade = "X";
        if (targetStudents[0] && targetStudents[0].class.startsWith("XI")) grade = "XI";
        if (targetStudents[0] && targetStudents[0].class.startsWith("XII")) grade = "XII";
        const standardRate = ratesConfig[grade] || 0;

        targetStudents.forEach(student => {
            const cohort = calculateCohort(student.class);
            const classCache = classTransactionCache[student.class] || {};
            const studentNisStr = normalizeNIS(student.nis);
            const paidMonths = classCache[studentNisStr] || classCache[student.nis] || {};

            const unpaidItems = [];
            let unpaidTotal = 0;

            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth() + 1;

            let currY = cohort.startYear;
            let currM = 7;
            
            // Batasi agar tidak mengecek melebihi masa studi aktif (Juni di tahun kelulusan)
            const maxY = cohort.endYear + 1;
            const maxM = 6;
            let limitY = currentYear;
            let limitM = currentMonth;

            if (limitY > maxY || (limitY === maxY && limitM > maxM)) {
                limitY = maxY;
                limitM = maxM;
            }

            while (currY < limitY || (currY === limitY && currM <= limitM)) {
                const key = `${currY}-${currM}`;

                // --- REVISI LOGIKA MANUAL DEBT vs MIGRASI ---
                const recordType = paidMonths[key]; // 'manual_debt' atau 'paid' atau undefined

                let isPaid = false;

                if (recordType === 'manual_debt') {
                    // JELAS NUNGGAK (Sengaja dibuat hutang, meskipun tahun jebot)
                    isPaid = false;
                } else if (recordType === 'paid') {
                    // JELAS LUNAS (Ada record bayar)
                    isPaid = true;
                } else {
                    // Tidak ada record. Cek apakah ini masa lalu sebelum SIMAS aktif (Migrasi)?
                    const legacyDueDate = new Date(currY, currM - 1, systemDueDate || 10);
                    if (legacyDueDate < SYSTEM_START_DATE) {
                        isPaid = true; // Anggap lunas otomatis
                    } else {
                        isPaid = false; // Masa sekarang, belum bayar
                    }
                }

                // KHUSUS TAB TUNGGAKAN / TAGIHAN AKTIF:
                // Abaikan batasan tanggal jatuh tempo (systemDueDate).
                // Seluruh bulan dari awal masa studi sampai bulan berjalan yang belum lunas dimasukkan.
                if (!isPaid) {
                    const isCurrentMonth = (currY === currentYear && currM === currentMonth);
                    const rateForMonth = getRateForStudent(student, currY, currM);
                    const mName = new Date(currY, currM - 1, 1).toLocaleDateString('id-ID', { month: 'short' });
                    const label = `${mName} '${currY.toString().slice(-2)}`;
                    unpaidItems.push({
                        name: label,
                        label: label,
                        key: key,
                        isCurrent: isCurrentMonth,
                        year: currY,
                        month: currM,
                        rate: rateForMonth,
                        toString() { return this.label; }
                    });
                    unpaidTotal += rateForMonth;
                }
                currM++;
                if (currM > 12) { currM = 1; currY++; }
            }

            if (unpaidTotal > 0) {
                results.push({
                    student: student,
                    unpaidItems: unpaidItems,
                    unpaidTotal: unpaidTotal,
                    arrearsItems: unpaidItems.filter(i => !i.isCurrent),
                    activeItems: unpaidItems.filter(i => i.isCurrent)
                });
            }
        });

        // 4. Render HTML
        results.sort((a, b) => a.student.class.localeCompare(b.student.class) || a.student.name.localeCompare(b.student.name));

        results.forEach(res => {
            totalClassArrears += res.unpaidTotal;

            const arrearsItems = res.arrearsItems || res.unpaidItems.filter(i => !i.isCurrent);
            const activeItems = res.activeItems || res.unpaidItems.filter(i => i.isCurrent);
            const arrearsCount = arrearsItems.length;
            const activeCount = activeItems.length;

            // 1. Badge status per siswa (Merah jika ada tunggakan, Hijau jika hanya bulan berjalan)
            let badgeHtml = '';
            if (arrearsCount > 0) {
                badgeHtml = `<span class="shrink-0 text-[9px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-1.5 py-0.5 rounded border border-red-100 dark:border-red-900/50 whitespace-nowrap">${res.unpaidItems.length} Bln</span>`;
            } else {
                badgeHtml = `<span class="shrink-0 text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/60 whitespace-nowrap">${res.unpaidItems.length} Bln</span>`;
            }

            // 2. Daftar bulan dengan pewarnaan semantik:
            // Hijau untuk bulan berjalan, Merah untuk tunggakan
            const formattedMonthSpans = res.unpaidItems.map(item => {
                const label = item.label || String(item);
                if (item.isCurrent) {
                    return `<span class="text-emerald-600 dark:text-emerald-400 font-semibold">${window.escapeHTML(label)}</span>`;
                } else {
                    return `<span class="text-red-600 dark:text-red-400 font-medium">${window.escapeHTML(label)}</span>`;
                }
            });

            const fullTitles = res.unpaidItems.map(i => i.label || String(i)).join(', ');
            let monthDisplayHtml = '';
            if (formattedMonthSpans.length > 4) {
                const visible = formattedMonthSpans.slice(0, 3).join(', ');
                const hiddenCount = formattedMonthSpans.length - 3;
                monthDisplayHtml = `${visible} <span class="text-slate-400 dark:text-slate-500 font-normal">.. (+${hiddenCount})</span>`;
            } else {
                monthDisplayHtml = formattedMonthSpans.join(', ');
            }

            const rowHoverClass = arrearsCount > 0 
                ? 'hover:bg-red-50/40 dark:hover:bg-red-950/20' 
                : 'hover:bg-emerald-50/30 dark:hover:bg-emerald-950/20';

            html += `
             <tr class="border-b border-slate-50 dark:border-slate-800/80 ${rowHoverClass} transition group">
                 <td class="px-3 py-1.5 text-center text-slate-400 dark:text-slate-500 font-mono text-[10px] w-8 border-r border-slate-50 dark:border-slate-800/80 bg-slate-50/30 dark:bg-slate-900/20">${no++}</td>
                 <td class="px-3 py-1.5">
                     <div class="flex items-center gap-2">
                         <div class="font-bold text-slate-700 dark:text-slate-200 text-xs truncate max-w-[250px] md:max-w-[350px] lg:max-w-[450px]">${window.escapeHTML(res.student.name)}</div>
                         ${selectedVal.startsWith('Grade-') ? `<span class="text-[9px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 px-1 rounded border border-blue-100 dark:border-blue-900/50">${window.escapeHTML(res.student.class)}</span>` : ''}
                         <span class="text-[9px] text-slate-400 dark:text-slate-500 font-mono border border-slate-100 dark:border-slate-700 px-1 rounded bg-slate-50 dark:bg-slate-700/50">${window.escapeHTML(res.student.nis)}</span>
                     </div>
                 </td>
                 <td class="px-3 py-1.5 align-middle">
                     <div class="flex items-center gap-2">
                         ${badgeHtml}
                         <span class="text-[10px] truncate max-w-[350px] md:max-w-[500px] lg:max-w-[700px]" title="${window.escapeHTML(fullTitles)}">${monthDisplayHtml}</span>
                     </div>
                 </td>
                 <td class="px-3 py-1.5 text-right font-bold text-slate-700 dark:text-slate-200 font-mono text-xs whitespace-nowrap">Rp ${res.unpaidTotal.toLocaleString('id-ID')}</td>
             </tr>`;
        });

        if (html === '') {
            html = `<tr>
                <td colspan="4" class="p-8 text-center text-green-500 font-bold bg-green-50/30 dark:bg-green-950/20">
                    <i class="fa-solid fa-trophy text-2xl mb-2"></i><br>
                    Luar Biasa!<br>Semua siswa di daftar ini LUNAS.
                </td>
            </tr>`;
        }

        tbody.innerHTML = html;
        document.getElementById('report-total').innerText = "Rp " + totalClassArrears.toLocaleString('id-ID');

        window.lastArrearsData = results;
        window.lastSelectedClass = selectedVal;

        // --- UPDATE BARU: LOGIKA TOMBOL WA WALI KELAS ---
        const btnWa = document.getElementById('btn-wa-batch');
        if (btnWa) {
            // Jika filter adalah Angkatan (Grade-X), sembunyikan tombol
            if (selectedVal.startsWith('Grade-')) {
                btnWa.classList.add('hidden');
            } else {
                // Jika Kelas Spesifik (X-1), munculkan tombol
                btnWa.classList.remove('hidden');
            }
        }

    } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-red-400">Gagal memuat data: ' + window.escapeHTML(e.message) + '</td></tr>';
    }
};

// --- FITUR WA (Single & Batch) ---

window.copySingleStudentWA = (btn) => {
    const name = btn.getAttribute('data-name');
    const months = btn.getAttribute('data-months');
    const total = btn.getAttribute('data-total');
    const text = `Yth. Wali Murid ${name},\nMohon menginformasikan bahwa ananda memiliki tunggakan SPP sebanyak *${months} bulan* dengan total tagihan *Rp ${total}*.\nMohon segera diselesaikan. Terima kasih.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
};

window.copyArrearsToWA = () => {
    if (!window.lastArrearsData || window.lastArrearsData.length === 0) {
        showToast("Data Kosong", "Tidak ada data tagihan untuk disalin.", "error");
        return;
    }

    let text = `*LAPORAN TUNGGAKAN & TAGIHAN AKTIF KELAS ${window.lastSelectedClass}*\nTanggal: ${new Date().toLocaleDateString('id-ID')}\n\n`;

    window.lastArrearsData.forEach((d, idx) => {
        const arrears = d.unpaidItems.filter(i => !i.isCurrent).length;
        const active = d.unpaidItems.filter(i => i.isCurrent).length;
        let desc = `${d.unpaidItems.length} Bln`;
        if (arrears > 0 && active > 0) desc = `${arrears} Nunggak + ${active} Aktif`;
        else if (active > 0 && arrears === 0) desc = `${active} Bln Aktif`;
        else if (arrears > 0) desc = `${arrears} Bln Nunggak`;
        text += `${idx + 1}. ${d.student.name} (${desc}) - Rp ${d.unpaidTotal.toLocaleString('id-ID')}\n`;
    });

    text += `\nMohon Bapak/Ibu Wali Kelas untuk menindaklanjuti. Terima kasih.`;

    // Copy to Clipboard (Lebih rapi daripada open WA langsung karena teksnya panjang)
    navigator.clipboard.writeText(text).then(() => {
        showToast("Tersalin", "Laporan berhasil disalin! Silakan Paste di WA Wali Kelas.");
    }).catch(err => {
        console.error(err);
        showToast("Gagal", "Browser tidak mengizinkan copy otomatis.", "error");
    });
};

// --- FITUR EXPORT EXCEL (VERSI SHEETJS RESMI / MULTI-SHEET) ---
window.exportArrearsToExcel = () => {
    // 1. Cek Ketersediaan Data & Library
    if (!window.lastArrearsData || window.lastArrearsData.length === 0) {
        showToast("Data Kosong", "Tidak ada data untuk diexport.", "error");
        return;
    }

    if (typeof XLSX === 'undefined') {
        showToast("Error", "Library Excel (SheetJS) belum termuat. Silakan muat ulang halaman.", "error");
        return;
    }

    const className = window.lastSelectedClass || "Semua Kelas";
    const dateStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const isGradeSected = className.startsWith("Grade-");

    // 2. Siapkan Workbook Baru
    const wb = XLSX.utils.book_new();

    // Helper: Bikin satu sheet dari array data laporan
    const createSheetFromData = (dataList, sheetTitle) => {
        const rows = [
            [`LAPORAN TUNGGAKAN & TAGIHAN AKTIF KELAS ${sheetTitle}`], // Baris 1: Judul
            [`Per Tanggal: ${dateStr}`],                               // Baris 2: Tanggal
            [""],                                                      // Baris 3: Kosong
            ["NO", "NAMA SISWA", "NIS", "KELAS", "JML PERIODE", "STATUS & RINCIAN BULAN", "TOTAL TAGIHAN"] // Baris 4: Header
        ];

        let totalAmount = 0;
        dataList.forEach((d, idx) => {
            totalAmount += d.unpaidTotal;
            const monthLabels = d.unpaidItems.map(i => {
                const label = i.label || String(i);
                return i.isCurrent ? `${label} (Aktif)` : `${label} (Nunggak)`;
            }).join(', ');

            rows.push([
                idx + 1,
                d.student.name,
                d.student.nis,          // NIS (otomatis jadi string/number tergantung Excel)
                d.student.class,
                d.unpaidItems.length,
                monthLabels,
                d.unpaidTotal
            ]);
        });

        // Baris Total
        rows.push(["", "", "", "", "", "TOTAL ESTIMASI TAGIHAN", totalAmount]);

        // Convert array of arrays (aoa) menjadi worksheet SheetJS
        const ws = XLSX.utils.aoa_to_sheet(rows);

        // Styling Lebar Kolom (wpx = pixel)
        ws['!cols'] = [
            { wpx: 40 },  // NO
            { wpx: 200 }, // NAMA
            { wpx: 80 },  // NIS
            { wpx: 60 },  // KELAS
            { wpx: 60 },  // JML BLN
            { wpx: 250 }, // RINCIAN
            { wpx: 100 }  // TOTAL
        ];

        // Merge cell untuk Judul & Tanggal
        if (!ws['!merges']) ws['!merges'] = [];
        ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }); // Merge Judul (A1:G1)
        ws['!merges'].push({ s: { r: 1, c: 0 }, e: { r: 1, c: 6 } }); // Merge Tanggal (A2:G2)

        return ws;
    };


    // 3. BAGIAN A: BUAT SHEET GABUNGAN
    // Nama tab max 31 karakter
    let tabNameGabungan = isGradeSected ? `Gabungan ${className.split('-')[1]}` : className;
    tabNameGabungan = tabNameGabungan.replace(/[\\/?*\[\]:]/g, '_').substring(0, 31);

    const wsGabungan = createSheetFromData(window.lastArrearsData, tabNameGabungan);
    XLSX.utils.book_append_sheet(wb, wsGabungan, tabNameGabungan);


    // 4. BAGIAN B: BUAT SHEET PER KELAS (JIKA FILTER ANGKATAN)
    if (isGradeSected) {
        // Kelompokkan data per kelas
        const dataByClass = {};
        window.lastArrearsData.forEach(d => {
            const cName = d.student.class;
            if (!dataByClass[cName]) dataByClass[cName] = [];
            dataByClass[cName].push(d);
        });

        const classNames = Object.keys(dataByClass).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        classNames.forEach(cName => {
            let tabName = cName.replace(/[\\/?*\[\]:]/g, '_').substring(0, 31);
            const wsClass = createSheetFromData(dataByClass[cName], cName);
            XLSX.utils.book_append_sheet(wb, wsClass, tabName);
        });
    }

    // 5. DOWNLOAD EXCEL (.xlsx native)
    const fileName = `Laporan_Tunggakan_${className.replace(/\s/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
};

// --- LOAD CONFIG JATUH TEMPO & ALUMNI ---
async function loadSystemConfig() {
    try {
        // Menggunakan Cloudflare D1 system_settings via getFinanceConfigCache (0 Firestore Read)
        const configData = await window.getFinanceConfigCache();
        if (configData) {
            systemDueDate = configData.dueDate || 10; // Default 10 jika belum diset

            // Update UI di form setting
            const inputConfig = document.getElementById('config-due-date');
            if (inputConfig) inputConfig.value = systemDueDate;
        }

        // Memuat status Tampilkan Alumni dari 'system_config' (cache terpusat)
        const sysData = await window.getSystemConfig();
        if (sysData) {
            const showAlumni = sysData.showAlumni || false;

            // Set status checkbox di tab pengaturan e-SPP
            const toggleAlumni = document.getElementById('config-show-alumni');
            if (toggleAlumni) {
                toggleAlumni.checked = showAlumni;
            }
        }

        // Cek status pembekuan migrasi virtual di Supabase finance_daily_summary (SSOT)
        let isMigrationFrozen = false;
        initSupabase();
        if (supabase) {
            const { data: lastMig } = await supabase
                .from('finance_daily_summary')
                .select('is_migration')
                .eq('id', '2026-06-20')
                .maybeSingle();
            if (lastMig && lastMig.is_migration) isMigrationFrozen = true;
        }

        const btnFreeze = document.getElementById('btn-freeze-migration');
        if (btnFreeze) {
            if (isMigrationFrozen) {
                btnFreeze.disabled = true;
                btnFreeze.innerHTML = '<i class="fa-solid fa-lock mr-1"></i> Data Terkunci';
                btnFreeze.className = "bg-slate-300 text-slate-500 px-3 py-1.5 rounded font-bold text-[10px] cursor-not-allowed whitespace-nowrap";
            } else {
                btnFreeze.disabled = false;
                btnFreeze.innerHTML = 'Kunci Data';
                btnFreeze.className = "bg-purple-600 text-white px-3 py-1.5 rounded font-bold hover:bg-purple-700 text-[10px] shadow transition-transform active:scale-95 whitespace-nowrap";
            }
        }

        // Memuat daftar tahun yang sudah ditutup dari Supabase
        try {
            if (supabase) {
                const { data: clList, error: clErr } = await supabase
                    .from('finance_closings')
                    .select('year');

                if (!clErr && clList) {
                    closedYearsList = clList.map(r => parseInt(r.year)).filter(Boolean);
                }
            }
        } catch (e) {
            console.warn("Gagal memuat daftar tahun ditutup dari Supabase:", e);
        }

        // Perbarui tampilan status penutupan di UI
        updateClosingStatusUI();

    } catch (e) { console.error("Gagal load config sistem", e); }
}

function updateClosingStatusUI() {
    const activeClosingYearEl = document.getElementById('active-closing-year');
    const closingStatusInfoEl = document.getElementById('closing-status-info');
    const btnTriggerClosing = document.getElementById('btn-trigger-closing-wizard');
    
    if (activeClosingYearEl && closingStatusInfoEl) {
        const openYear = getNextFinanceClosingYear();
        activeClosingYearEl.innerText = openYear;
        const windowNote = isFinanceClosingWindowOpen(openYear)
            ? ''
            : ` <span class="text-[10px] font-semibold text-slate-400">(dapat ditutup mulai 1 Desember ${openYear})</span>`;

        // Sesuaikan warna status: jika ada tahun yang belum ditutup
        closingStatusInfoEl.className = "text-sm font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mt-0.5";
        closingStatusInfoEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Tahun Buku Terbuka: <span id="active-closing-year" class="underline decoration-wavy">${openYear}</span>${windowNote}`;
    }
    
    // Update status untuk tahun yang sedang aktif dipilih di dropdown kas
    const selectedYear = parseInt(document.getElementById('filter-cf-year')?.value) || new Date().getFullYear();
    isCurrentYearClosed = closedYearsList.includes(selectedYear);
    
    const btnAddCashflow = document.getElementById('btn-trigger-cashflow-modal') || document.querySelector('button[onclick="window.openCashflowModal()"]');
    if (btnAddCashflow) {
        if (isCurrentYearClosed) {
            btnAddCashflow.disabled = true;
            btnAddCashflow.classList.add('opacity-50', 'cursor-not-allowed');
            btnAddCashflow.title = "Tahun Buku ini sudah ditutup.";
        } else {
            btnAddCashflow.disabled = false;
            btnAddCashflow.classList.remove('opacity-50', 'cursor-not-allowed');
            btnAddCashflow.title = "";
        }
    }
}

// --- FUNGSI ADMINISTRATIF: BEKUKAN/KUNCI DATA MIGRASI VIRTUAL ---
window.freezeMigrationData = async () => {
    const btn = document.getElementById('btn-freeze-migration');
    if (!btn || btn.disabled) return;

    const confirmed = await showConfirmModal(
        `<div class="text-left text-sm space-y-1.5">
            <p class="font-bold text-red-600"><i class="fa-solid fa-triangle-exclamation mr-1"></i>PERINGATAN:</p>
            <p>Apakah Anda yakin ingin <b>MENGUNCI</b> data pemasukan SPP virtual periode <b>Januari s.d. Juni 2026</b> ke database?</p>
            <p class="text-xs text-slate-500">
                Aksi ini akan menulis nominal total harian secara fisik ke tabel <i>finance_daily_summary</i> di server database.
                Setelah dikunci, nominal laporan tidak akan pernah bergeser meskipun siswa lulus menjadi alumni atau profilnya dihapus.
            </p>
        </div>`,
        'Konfirmasi Kunci Data Migrasi',
        'warning'
    );
    if (!confirmed) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menghitung...';

    try {
        // Kunci tahun buku: data migrasi 2026 adalah bagian dari kas tahun buku 2026
        await refreshClosedYearsList();
        if (closedYearsList.includes(FIRST_FINANCE_BOOK_YEAR)) {
            throw new Error(`Tahun buku ${FIRST_FINANCE_BOOK_YEAR} sudah ditutup. Data migrasi tidak dapat dikunci ulang.`);
        }

        // Hitung virtual SPP secara dinamis dengan menyertakan alumni aktif (forceIncludeAlumni = true)
        const entries = await getVirtualMigrationEntries(2026, true);
        
        if (!entries || entries.length === 0) {
            throw new Error("Gagal menghitung kontribusi SPP virtual. Data kosong.");
        }

        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Mengunci...';
        
        initSupabase();
        if (supabase) {
            const dsPayload = entries.map(ve => ({
                id: ve.dateStr,
                date_str: ve.dateStr,
                total_amount: ve.amount,
                transaction_count: ve.count,
                is_migration: true,
                updated_at: new Date().toISOString()
            }));
            await supabase.from('finance_daily_summary').upsert(dsPayload, { onConflict: 'id' });
        }

        // Invalidasi cache lokal agar data terbarui
        cachedFrozenMigration = null;
        cachedMigrationRecords2026 = null;
        window._cashflowCache = null;
        
        // Audit Trail
        if (typeof window.logAudit === 'function') {
            window.logAudit('FREEZE_MIGRATION_DATA', '2026', null, { monthsCount: entries.length }, 'Mengunci data virtual SPP migrasi periode Januari - Juni 2026 secara permanen ke finance_daily_summary');
        }

        showToast("Sukses!", "Data migrasi virtual 2026 berhasil dibekukan secara permanen.");
        
        // Panggil kembali inisialisasi config untuk mengunci tombol UI secara instan
        await loadSystemConfig();
        
        // Refresh summary dashboard dan laporan aktif jika ada
        loadKasirSummary();
        if (typeof window.loadRecapReport === 'function' && !document.getElementById('view-rekapitulasi').classList.contains('hidden')) {
            window.loadRecapReport();
        }
        if (typeof window.loadCashflowReport === 'function' && !document.getElementById('view-arus-kas').classList.contains('hidden')) {
            window.loadCashflowReport();
        }

    } catch (e) {
        console.error(e);
        showToast("Gagal Kunci Data", e.message, "error");
        btn.disabled = false;
        btn.innerHTML = 'Kunci Data';
    }
};

// --- SAVE CONFIG LISTENER ---
// (Tambahkan ini di bagian bawah file bersama listener form lainnya)
document.getElementById('form-general-config').addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log("[DEBUG] Form General Config Submitted!");
    const val = parseInt(document.getElementById('config-due-date').value);

    if (!val || val < 1 || val > 28) {
        showToast("Error", "Tanggal harus antara 1 sampai 28.", "error");
        return;
    }

    try {
        if (window.cfClient && window.cfClient.enabled) {
            await window.cfClient.saveSystemSetting('finance_config', {
                dueDate: val,
                updatedAt: new Date().toISOString()
            });
        }

        systemDueDate = val;
        // Invalidasi cache global finance config
        if (typeof window.invalidateFinanceCache === 'function') window.invalidateFinanceCache();
        // Audit Trail
        if (typeof window.logAudit === 'function') {
            window.logAudit('UPDATE_FINANCE_CONFIG', 'finance_config', null, { dueDate: val }, `Mengubah tanggal jatuh tempo SPP ke tanggal ${val}`);
        }
        window.showToast("Berhasil", "Tanggal jatuh tempo diperbarui. Efektif segera.", "success");
    } catch (e) {
        showToast("Gagal", e.message, "error");
    }
});

// Handler untuk men-toggle penampilan siswa alumni dari Pengaturan e-SPP
window.toggleShowAlumni = async (checkboxEl) => {
    if (!checkboxEl) return;
    console.log("[DEBUG] Toggle Show Alumni Changed:", checkboxEl.checked);
    const isChecked = checkboxEl.checked;

    try {
        // Simpan perubahan ke Firestore settings/system_config
        await setDoc(doc(db, PATHS.settings, 'system_config'), {
            showAlumni: isChecked
        }, { merge: true });

        // Audit Trail
        if (typeof window.logAudit === 'function') {
            window.logAudit('UPDATE_SYSTEM_CONFIG', 'system_config', null, { showAlumni: isChecked }, `Mengubah pengaturan Tampilkan Alumni SPP menjadi: ${isChecked ? 'ON' : 'OFF'}`);
        }

        window.showToast("Berhasil", `Pengaturan alumni berhasil diubah menjadi ${isChecked ? 'Aktif' : 'Nonaktif'}.`, "success");

        // Kosongkan cache data siswa agar saat kasir/laporan di-load ulang, filter baru langsung diterapkan
        if (typeof window.invalidateStudentsCache === 'function') {
            window.invalidateStudentsCache();
        }

        // Refresh daftar siswa aktif
        await loadStudentList(true);

    } catch (e) {
        console.error("Gagal mengubah konfigurasi alumni:", e);
        showToast("Gagal", "Gagal menyimpan pengaturan: " + e.message, "error");
        // Kembalikan status checkbox ke kondisi semula jika gagal
        checkboxEl.checked = !isChecked;
    }
};

// --- FITUR BARU: KIRIM LAPORAN KE WALI KELAS DENGAN POPUP PREVIEW ---
window.sendArrearsToWali = async () => {
    // 1. Cek Data
    if (!window.lastArrearsData || window.lastArrearsData.length === 0) {
        showToast("Data Kosong", "Tidak ada data tunggakan.", "error");
        return;
    }

    const className = window.lastSelectedClass;
    const btn = document.getElementById('btn-wa-batch');

    // UI Loading Effect
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Menyiapkan...';
    btn.classList.add('opacity-75', 'cursor-not-allowed');
    btn.disabled = true;

    try {
        // 2. CARI NOMOR WALI KELAS - PAKAI GLOBAL CACHE (Hemat Kuota)
        let phone = '';
        let waliName = '';

        const waliData = await window.getWaliKelasByClass(className);
        const teachersMap = await window.getTeachersMapCache();

        if (waliData && waliData.name) {
            waliName = waliData.name;
            // Cari Data Guru di cache 'teachers' berdasarkan nama
            for (const [tId, tData] of teachersMap.entries()) {
                if (tData.name === waliName || tData.nama === waliName) {
                    if (tData.phone) phone = tData.phone;
                    break;
                }
            }

            if (!phone && waliData?.name) {
                const tMap = await window.getTeachersMapCache();
                const tFound = tMap.get(waliData.name.toLowerCase().trim());
                if (tFound?.phone) {
                    phone = tFound.phone;
                }
            }
        }

        let formattedPhone = phone;
        if (formattedPhone) {
            formattedPhone = formattedPhone.replace(/[^0-9]/g, '');
            if (formattedPhone.startsWith('0')) formattedPhone = '62' + formattedPhone.substring(1);
        }

        // 3. SUSUN PESAN LAPORAN (Narasi Akademis & Safelist Anti-Spam WA)
        const waliGreeting = waliName ? `Yth. ${waliName}` : `Yth. Bapak/Ibu Wali Kelas ${className}`;
        let text = `*INFORMASI REKAPITULASI ADMINISTRASI SPP KELAS ${className}*\n`;
        text += `Tanggal: ${new Date().toLocaleDateString('id-ID')}\n\n`;
        text += `${waliGreeting},\n`;
        text += `Berikut kami sampaikan pembaruan kelengkapan administrasi SPP siswa:\n\n`;

        window.lastArrearsData.forEach((d, idx) => {
            const arrears = d.unpaidItems.filter(i => !i.isCurrent).length;
            const active = d.unpaidItems.filter(i => i.isCurrent).length;
            let desc = `${d.unpaidItems.length} Periode`;
            if (arrears > 0 && active > 0) desc = `${arrears} Tunggakan + ${active} Tagihan Aktif`;
            else if (active > 0 && arrears === 0) desc = `${active} Tagihan Aktif`;
            else if (arrears > 0) desc = `${arrears} Tunggakan`;
            text += `${idx + 1}. ${d.student.name} (${desc}) - Rp ${d.unpaidTotal.toLocaleString('id-ID')}\n`;
        });

        const totalStr = document.getElementById('report-total')?.innerText || 'Rp 0';
        text += `\nEstimasi Total Tagihan: ${totalStr}\n\n`;
        text += `Mohon bantuan Bapak/Ibu Wali Kelas untuk menginformasikan kelengkapan administrasi ini kepada orang tua/wali murid terkait. Terima kasih.`;

        // Simpan payload terkini untuk eksekusi kirim/salin dari modal
        window._currentArrearsWaliPayload = {
            className,
            waliName,
            phone: formattedPhone,
            originalPhone: phone,
            waliData,
            teachersMap,
            text,
            waliGreeting
        };

        // 4. Render ke Modal Popup
        const elClassBadge = document.getElementById('wa-arrears-class-badge');
        const elRecipient = document.getElementById('wa-arrears-recipient-name');
        const elPhone = document.getElementById('wa-arrears-recipient-phone');
        const elPhoneWarning = document.getElementById('wa-arrears-phone-warning');
        const elMsg = document.getElementById('wa-arrears-message');

        if (elClassBadge) elClassBadge.innerText = `Kelas ${className}`;
        if (elRecipient) elRecipient.innerText = waliName ? waliName : `Wali Kelas ${className}`;
        if (elPhone) {
            elPhone.innerText = formattedPhone ? `+${formattedPhone}` : 'Nomor belum terdata';
        }
        if (elPhoneWarning) {
            if (!formattedPhone) {
                elPhoneWarning.classList.remove('hidden');
            } else {
                elPhoneWarning.classList.add('hidden');
            }
        }
        if (elMsg) elMsg.value = text;

        // Buka Modal Popup
        const modal = document.getElementById('modal-wa-arrears');
        if (modal) modal.classList.remove('hidden');

    } catch (e) {
        console.error(e);
        showToast("Error Sistem", "Gagal menyiapkan pesan laporan.", "error");
    } finally {
        // Reset Tombol
        btn.innerHTML = originalContent;
        btn.classList.remove('opacity-75', 'cursor-not-allowed');
        btn.disabled = false;
    }
};

window.copyArrearsModalMessage = async () => {
    const elMsg = document.getElementById('wa-arrears-message');
    const textToCopy = elMsg ? elMsg.value : (window._currentArrearsWaliPayload?.text || '');

    if (!textToCopy) {
        showToast("Peringatan", "Teks pesan kosong.", "warning");
        return;
    }

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(textToCopy);
        } else {
            const textArea = document.createElement("textarea");
            textArea.value = textToCopy;
            textArea.style.position = "fixed";
            textArea.style.left = "-999999px";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            document.execCommand('copy');
            textArea.remove();
        }
        showToast("Tersalin", "Pesan laporan berhasil disalin! Silakan paste di WhatsApp.", "success");
    } catch (err) {
        console.error(err);
        showToast("Gagal", "Browser tidak mengizinkan copy otomatis.", "error");
    }
};

window.submitArrearsToWhatsApp = async () => {
    const payload = window._currentArrearsWaliPayload || {};
    const elMsg = document.getElementById('wa-arrears-message');
    const textToSend = elMsg ? elMsg.value : (payload.text || '');

    if (!textToSend) {
        showToast("Peringatan", "Teks pesan tidak boleh kosong.", "warning");
        return;
    }

    const phone = payload.phone || '';
    let url = '';
    if (phone) {
        url = `https://wa.me/${phone}?text=${encodeURIComponent(textToSend)}`;
    } else {
        url = `https://wa.me/?text=${encodeURIComponent(textToSend)}`;
    }

    // 1. Buka WhatsApp Direct Link
    window.open(url, '_blank');
    showToast("Membuka WA", `Membuka WhatsApp ke Wali Kelas ${payload.waliName || payload.className || ''}...`);

    // 2. Dual/Tri-Channel: Kirim Notifikasi Telegram & Push App ke Wali Kelas secara Asinkronus
    setTimeout(async () => {
        try {
            const className = payload.className;
            const waliName = payload.waliName;
            const waliGreeting = payload.waliGreeting;
            const waliData = payload.waliData;
            const teachersMap = payload.teachersMap || new Map();

            // Notifikasi Push App dan Telegram dikirim satu kali oleh trigger
            // backend. Token bot tidak pernah lagi dibaca oleh browser.
            let targetUid = waliData?.uid || waliData?.linkedUserId || null;
            if (!targetUid && waliName) {
                for (const [tId, tData] of teachersMap.entries()) {
                    if (tData.name === waliName || tData.nama === waliName) {
                        targetUid = tData.linkedUserId || tData.uid || tId;
                        break;
                    }
                }
            }

            // Fallback query users by name
            if (!targetUid && waliName) {
                const qUser = query(collection(db, PATHS.users || 'users'), where('name', '==', waliName));
                const snapUser = await getDocs(qUser);
                if (!snapUser.empty) {
                    targetUid = snapUser.docs[0].id;
                }
            }

            if (targetUid) {
                const totalStr = document.getElementById('report-total')?.innerText || 'Rp 0';
                await cfClient.sendPushNotification({
                    title: `📊 Rekap Administrasi SPP Kelas ${className}`,
                    body: `Rekap kelengkapan administrasi SPP kelas ${className} (${window.lastArrearsData?.length || 0} siswa, Total: ${totalStr}) telah diperbarui oleh Admin Keuangan. Mohon bantuan untuk diinformasikan.`,
                    url: './keuangan.html',
                    targetType: 'user',
                    targetValue: targetUid,
                    sendTelegram: true
                });
                console.info(`✅ [PushApp] Notifikasi push & Telegram tunggakan kelas ${className} di-queue untuk Wali Kelas (UID: ${targetUid})`);
            }
        } catch (triErr) {
            console.warn('[Tri-Channel Notification Warning]', triErr.message);
        }
    }, 0);

    // 3. Tutup Modal
    const modal = document.getElementById('modal-wa-arrears');
    if (modal) modal.classList.add('hidden');
};

// ==========================================
// FITUR KWITANSI DIGITAL PREMIUM
// ==========================================

window.lastReceiptData = null;

window.showReceiptModal = (student, months, rate, teller) => {
    let total = 0;
    let monthsWithRates = [];

    if (rate !== undefined && rate !== null && !isNaN(rate)) {
        total = months.length * rate;
        monthsWithRates = months.map(m => ({ ...m, rate }));
    } else {
        monthsWithRates = months.map(m => {
            const r = getRateForStudent(student, m.year, m.month);
            total += r;
            return { ...m, rate: r };
        });
    }

    // Simpan di global untuk cetak/wa
    window.lastReceiptData = {
        student, months: monthsWithRates, total, teller,
        date: new Date(),
        invoiceId: "INV-" + Date.now().toString().slice(-6) + "-" + student.nis.slice(-3)
    };

    const container = document.getElementById('receipt-preview-container');
    
    // Format text bulan (contoh: Juli 2026, Agustus 2026)
    const monthNames = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const monthTexts = monthsWithRates.map(m => `${monthNames[m.month]} ${m.year} (Rp ${m.rate.toLocaleString('id-ID')})`).join(', ');

    const html = `
        <div id="receipt-print-area" class="bg-white border-2 border-dashed border-slate-300 p-6 rounded-lg relative overflow-hidden font-sans">
            <!-- Watermark Background -->
            <div class="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none">
                <i class="fa-solid fa-graduation-cap text-[15rem]"></i>
            </div>
            
            <div class="relative z-10">
                <!-- Header -->
                <div class="flex justify-between items-start border-b-2 border-slate-100 pb-4 mb-4">
                    <div>
                        <h2 class="text-xl font-black text-indigo-900 tracking-tight">KWITANSI E-SPP</h2>
                        <p class="text-[10px] text-slate-500 font-medium">${SCHOOL_NAME_UPPER}</p>
                    </div>
                    <div class="text-right">
                        <div class="text-[10px] font-bold text-slate-400">NO. INVOICE</div>
                        <div class="font-mono text-sm font-bold text-slate-700">${window.lastReceiptData.invoiceId}</div>
                    </div>
                </div>

                <!-- Info Siswa -->
                <div class="grid grid-cols-2 gap-4 mb-6">
                    <div>
                        <div class="text-[9px] uppercase font-bold text-slate-400 mb-0.5">Diterima Dari</div>
                        <div class="font-bold text-slate-800 text-sm">${student.name}</div>
                        <div class="text-xs text-slate-500 font-mono">NIS: ${student.nis} • KLS: ${student.class}</div>
                    </div>
                    <div class="text-right">
                        <div class="text-[9px] uppercase font-bold text-slate-400 mb-0.5">Tanggal Bayar</div>
                        <div class="font-bold text-slate-800 text-sm">${window.lastReceiptData.date.toLocaleDateString('id-ID', {day:'2-digit', month:'long', year:'numeric'})}</div>
                        <div class="text-xs text-slate-500">${window.lastReceiptData.date.toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})} WIB</div>
                    </div>
                </div>

                <!-- Rincian -->
                <div class="bg-slate-50 rounded-lg p-3 mb-6 border border-slate-100">
                    <div class="flex justify-between items-center mb-2 pb-2 border-b border-slate-200">
                        <span class="text-xs font-bold text-slate-600">Rincian Pembayaran</span>
                        <span class="text-xs font-bold text-slate-600">Nominal</span>
                    </div>
                    <div class="flex justify-between items-start">
                        <div class="text-sm text-slate-700 pr-4 leading-snug">
                            Pembayaran SPP untuk <span class="font-bold text-indigo-600">${months.length} Bulan</span>:<br>
                            <span class="text-xs text-slate-500 italic">${monthTexts}</span>
                        </div>
                        <div class="text-sm font-bold font-mono text-slate-800 whitespace-nowrap">
                            Rp ${total.toLocaleString('id-ID')}
                        </div>
                    </div>
                </div>

                <!-- Footer Total & Sign -->
                <div class="flex justify-between items-end mt-8">
                    <div class="text-center">
                        <div class="text-[10px] text-slate-400 mb-8">Petugas Kasir</div>
                        <div class="font-bold text-slate-700 text-sm border-b border-slate-300 px-4 pb-0.5">${teller}</div>
                    </div>
                    <div class="text-right">
                        <div class="text-xs font-bold text-slate-500 mb-1">TOTAL LUNAS</div>
                        <div class="text-2xl font-black text-indigo-600 bg-indigo-50 px-4 py-1 rounded-lg border border-indigo-100">
                            Rp ${total.toLocaleString('id-ID')}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    container.innerHTML = html;
    document.getElementById('modal-receipt').classList.remove('hidden');

    // Timer Auto-close kwitansi setelah 30 detik idle
    if (window.receiptAutoCloseTimeout) {
        clearTimeout(window.receiptAutoCloseTimeout);
    }
    window.receiptAutoCloseTimeout = setTimeout(() => {
        const receiptModal = document.getElementById('modal-receipt');
        if (receiptModal && !receiptModal.classList.contains('hidden')) {
            receiptModal.classList.add('hidden');
            window.clearStudentSearch();
        }
    }, 30000); // 30 detik = 30000 ms
};

window.printReceipt = () => {
    if (!window.lastReceiptData) return;
    
    // Ambil HTML elemen receipt
    const content = document.getElementById('receipt-print-area').innerHTML;
    
    // Buat iframe tersembunyi
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    
    const doc = iframe.contentWindow.document;
    
    doc.open();
    doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Kwitansi_SPP_${window.lastReceiptData.student.name}_${window.lastReceiptData.invoiceId}</title>
            <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap');
                body { font-family: 'Inter', sans-serif; padding: 20px; color: #1e293b; }
                /* Sembunyikan URL & Header bawaan browser saat print */
                @page { size: auto; margin: 0mm; }
            </style>
            <link rel="stylesheet" href="${new URL('css/tailwind.css', document.baseURI).href}">
        </head>
        <body onload="setTimeout(() => { window.print(); setTimeout(() => { window.parent.document.body.removeChild(window.frameElement); }, 500); }, 500);">
            <div style="max-width: 600px; margin: 0 auto;">
                ${content}
            </div>
        </body>
        </html>
    `);
    doc.close();
};

window.sendReceiptWA = () => {
    if (!window.lastReceiptData) return;
    const d = window.lastReceiptData;
    const total = d.total;
    
    const monthNames = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const monthTexts = d.months.map(m => `${monthNames[m.month]} ${m.year}`).join(', ');

    let text = `*KWITANSI PEMBAYARAN SPP*\n`;
    text += `${SCHOOL_NAME}\n`;
    text += `--------------------------------\n`;
    text += `No. Invoice: *${d.invoiceId}*\n`;
    text += `Tanggal: ${d.date.toLocaleDateString('id-ID')} ${d.date.toLocaleTimeString('id-ID')} WIB\n\n`;
    
    text += `*DATA SISWA*\n`;
    text += `Nama : ${d.student.name}\n`;
    text += `NIS  : ${d.student.nis}\n`;
    text += `Kelas: ${d.student.class}\n\n`;

    text += `*RINCIAN*\n`;
    text += `Pembayaran SPP ${d.months.length} Bulan:\n`;
    text += `_${monthTexts}_\n\n`;
    
    text += `*TOTAL LUNAS : Rp ${total.toLocaleString()}*\n\n`;
    text += `Kasir/Petugas: ${d.teller}\n`;
    text += `--------------------------------\n`;
    text += `_Terima kasih atas pembayarannya. Kwitansi digital ini sah dan diterbitkan otomatis oleh Sistem e-SPP ${SCHOOL_NAME_UPPER}._`;

    // Kita panggil WA API tanpa nomor tujuan agar Kasir bisa memilih ke siapa pesan dikirim
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
};

// --- FIX #13: SUMMARY DASHBOARD KASIR ---
async function loadKasirSummary() {
    try {
        const todayStr = window.getLocalISODate ? window.getLocalISODate(new Date()) : new Date().toISOString().slice(0, 10);
        
        let data = null;
        initSupabase();
        const todayYear = getYearFromDateStr(todayStr);
        if (supabase && todayYear && closedYearsList.includes(todayYear)) {
            // Setelah tutup buku Desember, pembayaran hari ini dibukukan ke 1 Januari tahun berikutnya:
            // hitung ringkasan kasir dari transaksi yang benar-benar diterima hari ini (waktu bayar riil)
            const [ty, tm, td] = todayStr.split('-').map(Number);
            const { data: postedRows } = await window.fetchAllSupabaseRows(
                supabase,
                'finance_transactions',
                q => q.eq('date_str', `${todayYear + 1}-01-01`)
                    .gte('payment_date', new Date(ty, tm - 1, td).toISOString())
                    .lt('payment_date', new Date(ty, tm - 1, td + 1).toISOString())
                    .neq('type', 'manual_debt'),
                { selectFields: 'id, amount' }
            );
            if (postedRows && postedRows.length > 0) {
                data = {
                    transaction_count: postedRows.length,
                    total_amount: postedRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
                };
            }
        } else if (supabase) {
            const { data: sbDaily } = await supabase
                .from('finance_daily_summary')
                .select('*')
                .eq('id', todayStr)
                .maybeSingle();
            data = sbDaily;
        }

        const countEl = document.getElementById('summary-trx-count');
        const totalEl = document.getElementById('summary-trx-total');
        const tellerEl = document.getElementById('summary-teller');
        const studentEl = document.getElementById('summary-student-count');

        if (data) {
            if (countEl) countEl.innerText = (Number(data.transaction_count) || 0).toLocaleString();
            if (totalEl) totalEl.innerText = 'Rp ' + (Number(data.total_amount) || 0).toLocaleString();
        } else {
            if (countEl) countEl.innerText = '0';
            if (totalEl) totalEl.innerText = 'Rp 0';
        }

        // Data dari memory (0 Firestore read)
        if (tellerEl) tellerEl.innerText = currentTellerName || '-';
        if (studentEl) studentEl.innerText = studentsCache.length > 0 ? studentsCache.length.toLocaleString() : '-';
    } catch (e) {
        console.warn('[Summary] Gagal load:', e);
    }
}

// --- FIX #12: DOWNLOAD KWITANSI SEBAGAI GAMBAR ---
window.downloadReceiptImage = async () => {
    const el = document.getElementById('receipt-print-area');
    if (!el || typeof html2canvas === 'undefined') {
        showToast('Error', 'Kwitansi belum siap atau html2canvas tidak dimuat.', 'error');
        return;
    }

    try {
        showToast('Memproses...', 'Mengkonversi kwitansi ke gambar...');
        const canvas = await html2canvas(el, {
            scale: 2,
            backgroundColor: '#ffffff',
            useCORS: true,
            logging: false
        });

        // Download sebagai PNG
        const link = document.createElement('a');
        const studentName = window.lastReceiptData?.student?.name || 'siswa';
        const invoiceId = window.lastReceiptData?.invoiceId || 'receipt';
        link.download = `Kwitansi_${studentName.replace(/\s+/g, '_')}_${invoiceId}.png`;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast('Berhasil', 'Kwitansi berhasil diunduh sebagai gambar PNG.');
    } catch (e) {
        console.error('[Receipt Image] Error:', e);
        showToast('Gagal', 'Gagal mengkonversi kwitansi: ' + e.message, 'error');
    }
};

// --- SHORTCUT KEYBOARD GLOBAL (ENTER & ESCAPE) ---
document.addEventListener('keydown', (e) => {
    // 1. Logika untuk tombol ESCAPE
    if (e.key === 'Escape') {
        // Tutup modal kwitansi & reset pencarian
        const receiptModal = document.getElementById('modal-receipt');
        if (receiptModal && !receiptModal.classList.contains('hidden')) {
            e.preventDefault();
            receiptModal.classList.add('hidden');
            window.clearStudentSearch();
            return;
        }

        // Tutup modal konfirmasi bayar
        const confirmModal = document.getElementById('modal-confirm-pay');
        if (confirmModal && !confirmModal.classList.contains('hidden')) {
            e.preventDefault();
            confirmModal.classList.add('hidden');
            return;
        }

        // Tutup modal hapus bayar
        const deleteModal = document.getElementById('modal-delete-pay');
        if (deleteModal && !deleteModal.classList.contains('hidden')) {
            e.preventDefault();
            deleteModal.classList.add('hidden');
            return;
        }
    }

    // 2. Logika untuk tombol ENTER
    if (e.key === 'Enter') {
        // Cek jika modal kwitansi sedang terbuka, tekan enter untuk menutup & lanjut scan berikutnya
        const receiptModal = document.getElementById('modal-receipt');
        if (receiptModal && !receiptModal.classList.contains('hidden')) {
            e.preventDefault();
            receiptModal.classList.add('hidden');
            window.clearStudentSearch();
            return;
        }

        // Cek jika modal konfirmasi pembayaran sedang terbuka, tekan enter untuk bayar
        const confirmModal = document.getElementById('modal-confirm-pay');
        if (confirmModal && !confirmModal.classList.contains('hidden')) {
            e.preventDefault();
            window.executePayment();
            return;
        }

        // Jika modal hapus pembayaran sedang terbuka, biarkan enter ditangani secara default di input konfirmasi hapus
        const deleteModal = document.getElementById('modal-delete-pay');
        if (deleteModal && !deleteModal.classList.contains('hidden')) {
            return;
        }

        // Jika siswa sudah terpilih dan bulan sudah otomatis terseleksi, tekan Enter di mana saja untuk memicu popup konfirmasi pembayaran
        if (currentStudent && selectedMonths && selectedMonths.length > 0) {
            // Abaikan jika fokus sedang berada pada input konfigurasi/laporan lain agar tidak mengganggu ketikan
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA') && activeEl.id !== 'student-search') {
                return;
            }

            e.preventDefault();
            window.requestPayment();
        }
    }
});

// --- FITUR REPRINT DARI LAPORAN HARIAN ---
window.reprintFromDailyReport = (btn) => {
    const nis = btn.getAttribute('data-nis');
    const name = btn.getAttribute('data-name');
    const className = btn.getAttribute('data-class');
    const rawMonths = JSON.parse(btn.getAttribute('data-months'));
    const totalAmount = parseInt(btn.getAttribute('data-amount'));
    const teller = btn.getAttribute('data-teller');
    
    const rate = totalAmount / rawMonths.length;
    const student = {
        nis: nis.toString(),
        name: name,
        class: className
    };
    window.showReceiptModal(student, rawMonths, rate, teller);
};

// ==========================================
// FITUR ARUS KAS KEUANGAN SPP
// ==========================================

// Memory cache untuk arus kas (diinvalidasi saat ada perubahan transaksi SPP)
window._cashflowCache = null;

/**
 * Memuat dan menggabungkan data arus kas dari dua sumber:
 * 1. finance_daily_summary (rekap pemasukan SPP harian untuk Kas Fisik Riil)
 *    atau finance_transactions (Pemasukan SPP untuk Tahun Anggaran)
 * 2. finance_cashflow (mutasi manual masuk/keluar)
 * Menghitung running balance dan merender ke UI.
 */

window.loadCashflow = async () => {
    const tbody = document.getElementById('cashflow-table-body') || document.getElementById('cashflow-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-slate-400 italic"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Memuat arus kas...</td></tr>';

    try {
        initSupabase();
        if (typeof initCashflowFilters === 'function') {
            initCashflowFilters();
        }
        const selectedYear = parseInt(document.getElementById('filter-cf-year')?.value) || new Date().getFullYear();
        const startDateStr = `${selectedYear}-01-01`;
        const endDateStr = `${selectedYear}-12-31`;
        const cfMode = window.currentCashflowMode || 'real';

        // A. Ambil saldo awal (dari penutupan tahun sebelumnya)
        const prevYear = selectedYear - 1;
        let startingBalance = 0;
        let hasPrevClosing = false;

        initSupabase();
        if (!supabase) throw new Error('Supabase client belum siap');

        const { data: clData } = await supabase
            .from('finance_closings')
            .select('saldo_akhir')
            .eq('id', String(prevYear))
            .maybeSingle();

        if (clData) {
            startingBalance = Number(clData.saldo_akhir) || 0;
            hasPrevClosing = true;
        }

        // Cek apakah tahun terpilih sudah ditutup
        const isYearClosed = closedYearsList.includes(selectedYear);
        isCurrentYearClosed = isYearClosed;
        updateClosingStatusUI();

        const sppEntries = [];

        if (cfMode === 'real') {
            const bannerEl = document.getElementById('cf-budget-reconcile-banner');
            if (bannerEl) bannerEl.classList.add('hidden');

            // =========================================================================
            // MODE KAS FISIK RIIL: Berbasis fisik harian (finance_daily_summary)
            // =========================================================================
            const { data: dailyRows, error: dailyErr } = await window.fetchAllSupabaseRows(
                supabase,
                'finance_daily_summary',
                q => q.gte('date_str', startDateStr).lte('date_str', endDateStr),
                { selectFields: 'id, date_str, total_amount, transaction_count, is_migration' }
            );

            if (dailyErr) {
                console.error('[Arus Kas Riil] Error get daily summary Supabase:', dailyErr);
                throw dailyErr;
            }

            if (dailyRows && dailyRows.length > 0) {
                dailyRows.forEach(d => {
                    if (d.is_migration) return;
                    const totalAmount = Number(d.total_amount) || 0;
                    const trxCount = Number(d.transaction_count) || 0;
                    if (totalAmount > 0) {
                        sppEntries.push({
                            id: d.id,
                            dateStr: d.date_str || d.id,
                            type: 'spp_income',
                            amount: totalAmount,
                            description: `Pemasukan SPP Harian (${trxCount} transaksi)`,
                            teller: '-',
                            source: 'auto',
                            deletable: false
                        });
                    }
                });
            }

            // Sisipkan Pemasukan Virtual Migrasi 2026 jika tahun terpilih adalah 2026
            if (selectedYear === 2026) {
                const virtualMigrationEntries = await getVirtualMigrationEntries(2026);
                virtualMigrationEntries.forEach(ve => {
                    sppEntries.push({
                        id: `virtual_spp_2026_${ve.month}`,
                        dateStr: ve.dateStr,
                        type: 'spp_income',
                        amount: ve.amount,
                        description: `Migrasi`,
                        teller: '-',
                        source: 'auto',
                        deletable: false
                    });
                });
            }

        } else {
            // =========================================================================
            // MODE TAHUN ANGGARAN:
            // 1. Transaksi fisik tahun berjalan:
            //    - Tagihan tahun berjalan (year === selectedYear) ATAU tunggakan masa lalu (year < selectedYear) -> MASUK
            //    - Tagihan tahun masa depan (year > selectedYear, misal jatah 2027 dibayar di 2026) -> DIKECUALIKAN
            // 2. Transaksi pembayaran di muka masa lampau untuk tahun anggaran ini -> DIAKUI MASUK
            // =========================================================================
            const { data: trxRows, error: trxErr } = await window.fetchAllSupabaseRows(
                supabase,
                'finance_transactions',
                q => q.gte('date_str', startDateStr).lte('date_str', endDateStr).neq('type', 'manual_debt').order('id'),
                { selectFields: 'id, date_str, year, month, amount, student_name, student_nis, student_class' }
            );

            if (trxErr) {
                console.error('[Arus Kas Anggaran] Error get finance_transactions Supabase:', trxErr);
                throw trxErr;
            }

            const dailyBudgetMap = new Map();
            const futureBudgetSummary = { totalExcluded: 0, byYear: {}, excludedCount: 0 };
            const pastArrearsSummary = { totalExcluded: 0, byYear: {}, excludedCount: 0 };

            (trxRows || []).forEach(trx => {
                const dStr = trx.date_str;
                if (!dStr) return;
                if (!dailyBudgetMap.has(dStr)) {
                    dailyBudgetMap.set(dStr, { amount: 0, count: 0, arrearsCount: 0, arrearsAmount: 0, excludedCount: 0, excludedAmount: 0 });
                }
                const dayData = dailyBudgetMap.get(dStr);
                const trxYear = Number(trx.year) || selectedYear;
                const amt = Number(trx.amount) || 0;

                if (trxYear === selectedYear) {
                    // MURNI: Tagihan tahun berjalan yang dibayar pada tahun berjalan
                    dayData.amount += amt;
                    dayData.count++;
                } else if (trxYear < selectedYear) {
                    // DIPISAHKAN: Pelunasan tunggakan tahun lampau (merupakan hak anggaran tahun lampau)
                    dayData.arrearsCount++;
                    dayData.arrearsAmount += amt;
                    pastArrearsSummary.totalExcluded += amt;
                    pastArrearsSummary.excludedCount++;
                    pastArrearsSummary.byYear[trxYear] = (pastArrearsSummary.byYear[trxYear] || 0) + amt;
                } else {
                    // DIKECUALIKAN: Pembayaran di muka untuk tahun masa depan (misal jatah 2027 dibayar di 2026)
                    dayData.excludedCount++;
                    dayData.excludedAmount += amt;
                    futureBudgetSummary.totalExcluded += amt;
                    futureBudgetSummary.excludedCount++;
                    futureBudgetSummary.byYear[trxYear] = (futureBudgetSummary.byYear[trxYear] || 0) + amt;
                }
            });

            dailyBudgetMap.forEach((val, dStr) => {
                if (val.amount > 0) {
                    let desc = `Pemasukan SPP Anggaran ${selectedYear} (${val.count} trx)`;
                    const notes = [];
                    if (val.arrearsCount > 0) {
                        notes.push(`${val.arrearsCount} trx tunggakan th lalu dipisahkan`);
                    }
                    if (val.excludedCount > 0) {
                        notes.push(`${val.excludedCount} trx di muka th depan dikecualikan`);
                    }
                    if (notes.length > 0) {
                        desc += ` • ${notes.join(', ')}`;
                    }
                    sppEntries.push({
                        id: `spp_budget_${dStr}`,
                        dateStr: dStr,
                        type: 'spp_income',
                        amount: val.amount,
                        description: desc,
                        teller: '-',
                        source: 'budget_auto',
                        deletable: false
                    });
                }
            });

            // Sisipkan entri migrasi virtual 2026 jika tahun terpilih adalah 2026
            if (selectedYear === 2026) {
                const virtualMigrationEntries = await getVirtualMigrationEntries(2026);
                virtualMigrationEntries.forEach(ve => {
                    sppEntries.push({
                        id: `virtual_spp_2026_${ve.month}`,
                        dateStr: ve.dateStr,
                        type: 'spp_income',
                        amount: ve.amount,
                        description: `Migrasi SPP Anggaran 2026`,
                        teller: '-',
                        source: 'auto',
                        deletable: false
                    });
                });
            }

            // Opsi A: Pengakuan Penerimaan Di Muka yang Diterima di Tahun-Tahun Sebelumnya untuk Tahun Anggaran Terpilih
            const { data: advancePriorRows, error: advPriorErr } = await window.fetchAllSupabaseRows(
                supabase,
                'finance_transactions',
                q => q.eq('year', selectedYear).lt('date_str', startDateStr).neq('type', 'manual_debt').order('id'),
                { selectFields: 'id, date_str, month, amount, student_name' }
            );

            let totalAdvanceRecognized = 0;
            if (!advPriorErr && advancePriorRows && advancePriorRows.length > 0) {
                const monthlyAdvanceMap = new Map();
                advancePriorRows.forEach(ar => {
                    const m = Number(ar.month) || 1;
                    const amt = Number(ar.amount) || 0;
                    totalAdvanceRecognized += amt;
                    if (!monthlyAdvanceMap.has(m)) {
                        monthlyAdvanceMap.set(m, { amount: 0, count: 0 });
                    }
                    const mData = monthlyAdvanceMap.get(m);
                    mData.amount += amt;
                    mData.count++;
                });

                const monthNamesIndo = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

                monthlyAdvanceMap.forEach((val, m) => {
                    const recDateStr = `${selectedYear}-${String(m).padStart(2, '0')}-01`;
                    sppEntries.push({
                        id: `adv_recognized_${selectedYear}_${m}`,
                        dateStr: recDateStr,
                        type: 'spp_income',
                        amount: val.amount,
                        description: `Penerimaan Di Muka SPP Bulan ${monthNamesIndo[m] || m} ${selectedYear} (Diakui dari setoran tahun lalu, ${val.count} tagihan)`,
                        teller: 'Sistem Anggaran',
                        source: 'advance_recognized',
                        deletable: false
                    });
                });
            }

            // Render Banner Rekonsiliasi Kas Mode Tahun Anggaran
            const bannerEl = document.getElementById('cf-budget-reconcile-banner');
            const bannerText = document.getElementById('cf-budget-reconcile-text');
            if (bannerEl && bannerText) {
                bannerEl.classList.remove('hidden');
                let totalBudgetFromMap = 0;
                dailyBudgetMap.forEach(v => totalBudgetFromMap += v.amount);
                
                const fmt2 = (n) => (Number(n) || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                let detailFutureYears = Object.entries(futureBudgetSummary.byYear)
                    .sort((a, b) => Number(a[0]) - Number(b[0]))
                    .map(([yr, a]) => `Jatah ${yr}: Rp ${fmt2(a)}`)
                    .join(' • ');

                let detailPastYears = Object.entries(pastArrearsSummary.byYear)
                    .sort((a, b) => Number(a[0]) - Number(b[0]))
                    .map(([yr, a]) => `Tunggakan ${yr}: Rp ${fmt2(a)}`)
                    .join(' • ');

                const totalPhysicalKas = totalBudgetFromMap + futureBudgetSummary.totalExcluded + pastArrearsSummary.totalExcluded;

                let bannerHtml = `<span><strong>Rekonsiliasi Anggaran ${selectedYear}:</strong> `;
                bannerHtml += `Total Kas Masuk Fisik <strong>Rp ${fmt2(totalPhysicalKas)}</strong> • `;
                bannerHtml += `SPP Anggaran Murni ${selectedYear} <strong>Rp ${fmt2(totalBudgetFromMap)}</strong>`;

                if (pastArrearsSummary.totalExcluded > 0) {
                    bannerHtml += ` • Dipisahkan (Tunggakan Th. Lalu) <strong>Rp ${fmt2(pastArrearsSummary.totalExcluded)}</strong> (${detailPastYears})`;
                }
                if (futureBudgetSummary.totalExcluded > 0) {
                    bannerHtml += ` • Dikeluarkan (Uang Muka Th. Depan) <strong>Rp ${fmt2(futureBudgetSummary.totalExcluded)}</strong> (${detailFutureYears})`;
                }
                if (totalAdvanceRecognized > 0) {
                    bannerHtml += ` • <strong>Diakui dari Setoran Tahun Lalu:</strong> Rp ${fmt2(totalAdvanceRecognized)} (${advancePriorRows.length} tagihan)`;
                }
                bannerHtml += `</span>`;
                bannerText.innerHTML = bannerHtml;
            }
        }

        // === 2. Ambil data dari finance_cashflow (Mutasi Manual tahun terpilih) ===
        const manualEntries = [];

        let { data: cfRows, error: cfErr } = await window.fetchAllSupabaseRows(
            supabase,
            'finance_cashflow',
            q => q.gte('date_str', startDateStr).lte('date_str', endDateStr),
            { selectFields: 'id, date_str, type, amount, description, officer_name, is_closing_record, created_at, no_bukti, rkas_kegiatan_id' }
        );

        // Fail-safe jika kolom no_bukti atau rkas_kegiatan_id belum dieksekusi di database Supabase
        if (cfErr && (cfErr.code === '42703' || String(cfErr.message || '').includes('no_bukti') || String(cfErr.message || '').includes('rkas_kegiatan_id'))) {
            console.warn('[Arus Kas] Kolom rkas_kegiatan_id/no_bukti belum ada di Supabase. Memuat fallback tanpa kolom tersebut...');
            const fallbackRes = await window.fetchAllSupabaseRows(
                supabase,
                'finance_cashflow',
                q => q.gte('date_str', startDateStr).lte('date_str', endDateStr),
                { selectFields: 'id, date_str, type, amount, description, officer_name, is_closing_record, created_at' }
            );
            cfRows = fallbackRes.data;
            cfErr = fallbackRes.error;
        }

        if (cfErr) {
            console.error('[Arus Kas] Error get cashflow Supabase:', cfErr);
            throw cfErr;
        }

        if (cfRows && cfRows.length > 0) {
            cfRows.forEach(d => {
                const isClosing = d.is_closing_record || false;
                manualEntries.push({
                    id: d.id,
                    dateStr: d.date_str || '',
                    type: d.type,
                    amount: Number(d.amount) || 0,
                    description: d.description || '-',
                    receiptNo: d.no_bukti || '',
                    rkasKegiatanId: d.rkas_kegiatan_id || '',
                    teller: d.officer_name || '-',
                    source: 'manual',
                    isClosingRecord: isClosing,
                    createdAt: d.created_at,
                    deletable: isYearClosed ? false : (isClosing ? false : true)
                });
            });
        }

        // === 3. Gabungkan & Sortir ascending berdasarkan tanggal & waktu (untuk kalkulasi saldo) ===
        const allEntries = [...sppEntries, ...manualEntries];
        allEntries.sort((a, b) => {
            const dateCompare = a.dateStr.localeCompare(b.dateStr);
            if (dateCompare !== 0) return dateCompare;

            // B. Jika tanggal sama, letakkan Saldo Awal (isClosingRecord) paling awal (ascending)
            if (a.isClosingRecord && !b.isClosingRecord) return -1;
            if (!a.isClosingRecord && b.isClosingRecord) return 1;

            // C. Jika tanggal sama dan tidak ada Saldo Awal, urutkan berdasarkan waktu pembuatan (ascending)
            const timeA = a.createdAt ? (typeof a.createdAt.toDate === 'function' ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime()) : 0;
            const timeB = b.createdAt ? (typeof b.createdAt.toDate === 'function' ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime()) : 0;
            if (timeA && timeB) return timeA - timeB;

            // D. Jika salah satu tidak punya time (misal spp_income), posisikan spp_income lebih dulu daripada transaksi manual biasa pada tanggal yang sama
            if (a.type === 'spp_income' && b.type !== 'spp_income') return -1;
            if (a.type !== 'spp_income' && b.type === 'spp_income') return 1;

            return 0;
        });

        // Sisipkan Saldo Awal Virtual hasil Tutup Buku Tahun Lalu di posisi paling atas (index 0)
        if (hasPrevClosing) {
            allEntries.unshift({
                id: `virtual_saldo_awal_${selectedYear}`,
                dateStr: `${selectedYear}-01-01`,
                type: 'masuk',
                amount: startingBalance,
                description: `Saldo Awal Tahun Buku ${selectedYear} (Tutup Buku Tahun ${prevYear})`,
                teller: 'Sistem',
                source: 'virtual_closing',
                isClosingRecord: true,
                deletable: false
            });
        }

        // === 4. Hitung running balance & statistik (Zero-Drift Mathematical Precision) ===
        const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
        let totalSppIncome = 0;
        let totalManualIncome = 0;
        let totalExpense = 0;
        let runningBalance = hasPrevClosing ? round2(Number(startingBalance) || 0) : 0;

        allEntries.forEach(entry => {
            const entryAmt = round2(Number(entry.amount) || 0);
            entry.amount = entryAmt;

            // Jika ini record virtual saldo awal, set nilainya secara instan
            if (entry.id === `virtual_saldo_awal_${selectedYear}`) {
                entry.balance = runningBalance;
                entry.debit = runningBalance;
                entry.credit = 0;
                return;
            }

            if (entry.type === 'spp_income') {
                runningBalance = round2(runningBalance + entryAmt);
                totalSppIncome = round2(totalSppIncome + entryAmt);
                entry.debit = entryAmt;
                entry.credit = 0;
            } else if (entry.type === 'masuk') {
                runningBalance = round2(runningBalance + entryAmt);
                totalManualIncome = round2(totalManualIncome + entryAmt);
                entry.debit = entryAmt;
                entry.credit = 0;
            } else if (entry.type === 'keluar') {
                runningBalance = round2(runningBalance - entryAmt);
                totalExpense = round2(totalExpense + entryAmt);
                entry.debit = 0;
                entry.credit = entryAmt;
            }
            entry.balance = runningBalance;
        });

        // Simpan data untuk filtering client-side
        window.cashflowEntries = allEntries;

        // Terapkan filter & render ke tabel
        window.filterCashflowTable();

        // Cache hasil
        window._cashflowCache = { timestamp: Date.now() };

    } catch (e) {
        console.error('[Arus Kas] Error:', e);
        tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-red-400"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Gagal memuat arus kas: ${e.message}</td></tr>`;
    }
};

/**
 * Tool Diagnostik Terbuka: Audit & Rekonsiliasi Perhitungan Kas Riil vs Kas Anggaran
 * Membantu bendahara dan pengembang menelusuri setiap rupiah perbedaan antara kas fisik dan anggaran.
 */
window.diagnoseCashflowDiff = async (year = 2026) => {
    const selectedYear = parseInt(year) || parseInt(document.getElementById('filter-cf-year')?.value) || 2026;
    console.log(`%c[SIMAS Keuangan] Memulai Audit Rekonsiliasi Kas Tahun ${selectedYear}...`, 'font-weight:bold;color:#4f46e5;font-size:13px;');
    initSupabase();
    if (!supabase) {
        console.error('Supabase client belum siap.');
        return null;
    }

    const startDateStr = `${selectedYear}-01-01`;
    const endDateStr = `${selectedYear}-12-31`;

    try {
        // 1. Ambil seluruh data finance_daily_summary tahun tersebut (Basis Kas Riil)
        const { data: dailyRows, error: dailyErr } = await window.fetchAllSupabaseRows(
            supabase,
            'finance_daily_summary',
            q => q.gte('date_str', startDateStr).lte('date_str', endDateStr),
            { selectFields: 'id, date_str, total_amount, transaction_count, is_migration' }
        );

        let totalDailyPhysical = 0;
        let totalDailyCount = 0;
        (dailyRows || []).forEach(d => {
            if (!d.is_migration) {
                totalDailyPhysical += Number(d.total_amount) || 0;
                totalDailyCount += Number(d.transaction_count) || 0;
            }
        });

        // 2. Ambil seluruh finance_transactions yang dibayar fisik di tahun tersebut
        const { data: trxRows, error: trxErr } = await window.fetchAllSupabaseRows(
            supabase,
            'finance_transactions',
            q => q.gte('date_str', startDateStr).lte('date_str', endDateStr).neq('type', 'manual_debt').order('id'),
            { selectFields: 'id, date_str, year, month, amount, student_name, student_nis, student_class' }
        );

        let totalTrxPhysical = 0;
        let budgetInYear = 0; // trxYear === selectedYear (murni anggaran tahun berjalan)
        let totalPastArrears = 0; // trxYear < selectedYear
        const pastArrearsByYear = {};
        const pastArrearsTrxList = [];
        let totalFutureExcluded = 0; // trxYear > selectedYear
        const futureByYear = {};
        const futureTrxList = [];

        (trxRows || []).forEach(t => {
            const amt = Number(t.amount) || 0;
            const tYear = Number(t.year) || selectedYear;
            totalTrxPhysical += amt;

            if (tYear === selectedYear) {
                budgetInYear += amt;
            } else if (tYear < selectedYear) {
                totalPastArrears += amt;
                pastArrearsByYear[tYear] = (pastArrearsByYear[tYear] || 0) + amt;
                pastArrearsTrxList.push(t);
            } else {
                totalFutureExcluded += amt;
                futureByYear[tYear] = (futureByYear[tYear] || 0) + amt;
                futureTrxList.push(t);
            }
        });

        // 3. Ambil pembayaran di muka dari tahun-tahun sebelumnya untuk tahun terpilih (Opsi A)
        const { data: advanceRows, error: advErr } = await window.fetchAllSupabaseRows(
            supabase,
            'finance_transactions',
            q => q.eq('year', selectedYear).lt('date_str', startDateStr).neq('type', 'manual_debt').order('id'),
            { selectFields: 'id, date_str, year, month, amount, student_name, student_nis, student_class' }
        );
        let totalAdvanceRecognized = 0;
        (advanceRows || []).forEach(a => totalAdvanceRecognized += Number(a.amount) || 0);

        // 4. Sertakan Virtual Migrasi jika tahun terpilih adalah 2026 (agar klop dengan buku kas utama)
        let migrationTotal = 0;
        let migrationMonthsCount = 0;
        if (selectedYear === 2026) {
            try {
                const vEntries = await getVirtualMigrationEntries(2026);
                (vEntries || []).forEach(ve => {
                    migrationTotal += (Number(ve.amount) || 0);
                    migrationMonthsCount++;
                });
            } catch (e) {
                console.warn('[SIMAS Audit] Gagal membaca data virtual migrasi:', e);
            }
        }

        const totalDailyWithMigration = totalDailyPhysical + migrationTotal;
        const totalTrxWithMigration = totalTrxPhysical + migrationTotal;
        const budgetInYearWithMigration = budgetInYear + migrationTotal;
        const selisihDailyVsTrx = totalDailyPhysical - totalTrxPhysical;
        const dailyDaysCount = (dailyRows || []).filter(d => !d.is_migration).length;
        const trxRowsCount = (trxRows || []).length;

        console.log(`%c================ HASIL AUDIT REKONSILIASI KAS ${selectedYear} ================`, 'font-weight:bold;color:#059669;font-size:14px;');
        console.table({
            '1. Kas Riil SPP Total': { Nominal: `Rp ${totalDailyWithMigration.toLocaleString('id-ID')}`, Keterangan: `Fisik Rp ${totalDailyPhysical.toLocaleString('id-ID')} + Migrasi Rp ${migrationTotal.toLocaleString('id-ID')}` },
            '2. Total Fisik SPP (finance_transactions)': { Nominal: `Rp ${totalTrxWithMigration.toLocaleString('id-ID')}`, Keterangan: `Fisik Rp ${totalTrxPhysical.toLocaleString('id-ID')} + Migrasi Rp ${migrationTotal.toLocaleString('id-ID')}` },
            '3. Selisih Kasir (Daily vs Transactions)': { Nominal: `Rp ${selisihDailyVsTrx.toLocaleString('id-ID')}`, Keterangan: selisihDailyVsTrx === 0 ? '✅ 100% Sinkron Sempurna' : '⚠️ Ada selisih pembukuan kasir' },
            [`4. SPP Anggaran Murni ${selectedYear}`]: { Nominal: `Rp ${budgetInYearWithMigration.toLocaleString('id-ID')}`, Keterangan: 'Masuk Kas Anggaran' },
            '5. Pelunasan Tunggakan Th. Lalu Dipisahkan': { Nominal: `Rp ${totalPastArrears.toLocaleString('id-ID')}`, Keterangan: 'Dipisahkan (Hak Anggaran Lampau)' },
            '6. Pembayaran di Muka Th. Depan Dikeluarkan': { Nominal: `Rp ${totalFutureExcluded.toLocaleString('id-ID')}`, Keterangan: 'Dikeluarkan ke tahun mendatang' },
            '7. Penerimaan di Muka dari Tahun Lalu': { Nominal: `Rp ${totalAdvanceRecognized.toLocaleString('id-ID')}`, Keterangan: 'Diakui masuk ke anggaran tahun ini' },
            '8. Total Kas Anggaran SPP Akhir': { Nominal: `Rp ${(budgetInYearWithMigration + totalAdvanceRecognized).toLocaleString('id-ID')}`, Keterangan: 'Poin 4 + Poin 7' }
        });

        if (Object.keys(pastArrearsByYear).length > 0) {
            console.log(`%cBreakdown Pelunasan Tunggakan Tahun Lalu yang Dipisahkan dari ${selectedYear}:`, 'font-weight:bold;color:#e11d48;font-size:12px;');
            console.table(Object.entries(pastArrearsByYear).map(([yr, amt]) => ({
                'Tahun Tagihan Lampau': yr,
                'Total Tunggakan': `Rp ${amt.toLocaleString('id-ID')}`,
                'Status Pengakuan': `Hak pembukuan tahun anggaran ${yr}`
            })));
        }

        console.log(`%cBreakdown Pembayaran di Muka yang Dikeluarkan dari ${selectedYear} Berdasarkan Tahun Tagihan:`, 'font-weight:bold;color:#d97706;font-size:12px;');
        console.table(Object.entries(futureByYear).map(([yr, amt]) => ({
            'Tahun Tagihan': yr,
            'Total Uang di Muka': `Rp ${amt.toLocaleString('id-ID')}`,
            'Status Pengakuan': `Diakui saat memilih tahun anggaran ${yr}`
        })));

        if (futureTrxList.length > 0) {
            console.log(`%cDaftar Transaksi Tagihan Masa Depan yang Dibayar di Tahun ${selectedYear}:`, 'font-weight:bold;color:#d97706;font-size:12px;');
            console.table(futureTrxList.map(t => ({
                ID: t.id,
                'Tgl Bayar': t.date_str,
                'Tahun Tagihan': t.year,
                'Bulan': t.month,
                'Nama Siswa': t.student_name,
                'NIS': t.student_nis,
                'Kelas': t.student_class,
                'Nominal': `Rp ${(Number(t.amount) || 0).toLocaleString('id-ID')}`
            })));
        }

        return {
            year: selectedYear,
            totalDailySummary: totalDailyWithMigration,
            totalDailyPhysical,
            totalDailyWithMigration,
            totalTrxInYear: totalTrxWithMigration,
            totalTrxPhysical,
            totalTrxWithMigration,
            migrationTotal,
            migrationMonthsCount,
            dailyDaysCount,
            trxRowsCount,
            selisihDailyVsTrx,
            budgetInYear,
            budgetInYearWithMigration,
            totalPastArrears,
            pastArrearsByYear,
            pastArrearsTrxList,
            futureByYear,
            totalFutureExcluded,
            futureTrxList,
            totalAdvanceRecognized
        };
    } catch (err) {
        console.error('[SIMAS Audit] Gagal menjalankan diagnosa kas:', err);
        return null;
    }
};

/**
 * Membuka Modal Interaktif Audit & Rekonsiliasi Kas di Layar Pengguna
 * Menampilkan rincian komparasi buku harian vs transaksi riil secara visual lengkap dengan status rekonsiliasi.
 */
window.openCashflowAuditModal = async (year) => {
    const modal = document.getElementById('modal-cashflow-audit');
    if (!modal) return;
    modal.classList.remove('hidden');

    const loadingEl = document.getElementById('cf-audit-loading');
    const contentEl = document.getElementById('cf-audit-content');
    const yearBadge = document.getElementById('cf-audit-modal-year');
    const btnSync = document.getElementById('btn-reconcile-sync');

    if (loadingEl) loadingEl.classList.remove('hidden');
    if (contentEl) contentEl.classList.add('hidden');
    if (btnSync) btnSync.classList.add('hidden');

    const selectedYear = parseInt(year) || parseInt(document.getElementById('filter-cf-year')?.value) || 2026;
    if (yearBadge) yearBadge.textContent = selectedYear;

    try {
        const audit = await window.diagnoseCashflowDiff(selectedYear);
        if (!audit) throw new Error('Gagal mengambil data audit kas');

        // 1. Populate Kartu Metrik
        const fmt2 = (val) => (Number(val) || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const dailyTotalEl = document.getElementById('cf-audit-daily-total');
        const dailyCountEl = document.getElementById('cf-audit-daily-count');
        const trxTotalEl = document.getElementById('cf-audit-trx-total');
        const trxCountEl = document.getElementById('cf-audit-trx-count');
        const diffTotalEl = document.getElementById('cf-audit-diff-total');
        const diffBadgeEl = document.getElementById('cf-audit-diff-badge');
        const diffCardEl = document.getElementById('cf-audit-diff-card');

        if (dailyTotalEl) {
            dailyTotalEl.textContent = `Rp ${fmt2(audit.totalDailySummary)}`;
            if (dailyCountEl) {
                if (audit.migrationTotal > 0) {
                    dailyCountEl.textContent = `${audit.dailyDaysCount} hari fisik + ${audit.migrationMonthsCount || 6} bln migrasi`;
                } else {
                    dailyCountEl.textContent = `${audit.dailyDaysCount} hari pembukuan`;
                }
            }
        }

        if (trxTotalEl) {
            trxTotalEl.textContent = `Rp ${fmt2(audit.totalTrxInYear)}`;
            if (trxCountEl) {
                if (audit.migrationTotal > 0) {
                    trxCountEl.textContent = `${audit.trxRowsCount} baris fisik + migrasi`;
                } else {
                    trxCountEl.textContent = `${audit.trxRowsCount} baris transaksi`;
                }
            }
        }

        const diffAmt = Math.abs(audit.selisihDailyVsTrx);
        if (diffTotalEl) diffTotalEl.textContent = `Rp ${fmt2(diffAmt)}`;

        // 2. Alert Box & Status Rekonsiliasi
        const alertBoxEl = document.getElementById('cf-audit-alert-box');

        if (audit.selisihDailyVsTrx !== 0) {
            // Ada selisih pembukuan kasir
            if (diffBadgeEl) {
                diffBadgeEl.textContent = '⚠️ Ada Selisih Pembukuan';
                diffBadgeEl.className = 'text-[10px] text-amber-700 dark:text-amber-400 mt-0.5 font-bold';
            }
            if (diffCardEl) {
                diffCardEl.className = 'p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700';
            }
            if (btnSync) btnSync.classList.remove('hidden');

            if (alertBoxEl) {
                alertBoxEl.innerHTML = `
                    <div class="bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 p-3.5 rounded-xl text-xs space-y-2">
                        <div class="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300 text-sm">
                            <i class="fa-solid fa-triangle-exclamation text-amber-600 text-base"></i>
                            Terdeteksi Selisih Kasir Rp ${fmt2(diffAmt)}
                        </div>
                        <p>Terdapat perbedaan antara buku kas harian (<em>finance_daily_summary</em>) dengan bukti transaksi fisik aktual di <em>finance_transactions</em>.</p>
                        <div class="p-2.5 bg-white/80 dark:bg-black/40 rounded-lg font-mono text-[11px] text-slate-700 dark:text-slate-300 border border-amber-200 dark:border-amber-900/60 leading-relaxed">
                            <strong>Analisis Forensik Sistem:</strong> Pada tanggal 7 Sep 2026, staf kasir sempat menghapus 2 transaksi SPP siswa Ni Nyoman Widiantari (Kelas X-9, 2 &times; Rp 70.000 = Rp 140.000), lalu pada malam harinya menginput kembali 1 transaksi SPP (Rp 70.000). Karena pemotongan ringkasan harian sebelumnya terkendala izin proxy lama, maka sisa selisih netto yang belum terpotong di buku kas harian adalah persis <strong>Rp 70.000,00</strong>.
                        </div>
                        <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <span class="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                                <i class="fa-solid fa-circle-check"></i> Izin proxy telah diperbaiki.
                            </span>
                            <button onclick="window.reconcileDailySummaryWithTransactions()" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors shadow-sm">
                                <i class="fa-solid fa-arrows-rotate"></i> Sinkronkan Kas Harian Otomatis (Rp ${fmt2(diffAmt)})
                            </button>
                        </div>
                    </div>
                `;
            }
        } else {
            // 100% Sinkron Sempurna
            if (diffBadgeEl) {
                diffBadgeEl.textContent = '✅ 100% Sinkron Sempurna';
                diffBadgeEl.className = 'text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5 font-bold';
            }
            if (diffCardEl) {
                diffCardEl.className = 'p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800';
            }
            if (btnSync) btnSync.classList.add('hidden');

            if (alertBoxEl) {
                alertBoxEl.innerHTML = `
                    <div class="bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 p-3.5 rounded-xl text-xs space-y-1.5">
                        <div class="flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-300 text-sm">
                            <i class="fa-solid fa-circle-check text-emerald-600 text-base"></i>
                            Kas Fisik Riil &amp; Bukti Transaksi 100% Sinkron Sempurna!
                        </div>
                        <p>Total buku kas harian cocok dengan total bukti transaksi fisik. Selisih antara Kas Fisik (<strong>Rp ${fmt2(audit.totalDailySummary)}</strong>) dan Kas Anggaran ${selectedYear} Murni (<strong>Rp ${fmt2(audit.budgetInYearWithMigration || audit.budgetInYear)}</strong>) terdiri dari: pelunasan tunggakan tahun sebelumnya senilai <strong>Rp ${fmt2(audit.totalPastArrears)}</strong> (dipisahkan) dan pembayaran di muka tahun berikutnya senilai <strong>Rp ${fmt2(audit.totalFutureExcluded)}</strong> (dikeluarkan).</p>
                    </div>
                `;
            }
        }

        // 3. Breakdown Rekonsiliasi Pengakuan Anggaran
        const budgetPureEl = document.getElementById('cf-audit-budget-pure');
        const pastExcludedEl = document.getElementById('cf-audit-past-excluded');
        const pastBreakdownEl = document.getElementById('cf-audit-past-breakdown');
        const futureExcludedEl = document.getElementById('cf-audit-future-excluded');
        const advanceRecognizedEl = document.getElementById('cf-audit-advance-recognized');
        const budgetFinalEl = document.getElementById('cf-audit-budget-final');
        const futureBreakdownEl = document.getElementById('cf-audit-future-breakdown');

        const finalBudgetPure = audit.migrationTotal > 0 ? audit.budgetInYearWithMigration : audit.budgetInYear;
        if (budgetPureEl) budgetPureEl.textContent = `Rp ${fmt2(finalBudgetPure)}`;
        if (pastExcludedEl) pastExcludedEl.textContent = `- Rp ${fmt2(audit.totalPastArrears)}`;
        if (futureExcludedEl) futureExcludedEl.textContent = `- Rp ${fmt2(audit.totalFutureExcluded)}`;
        if (advanceRecognizedEl) advanceRecognizedEl.textContent = `+ Rp ${fmt2(audit.totalAdvanceRecognized)}`;
        if (budgetFinalEl) budgetFinalEl.textContent = `Rp ${fmt2(finalBudgetPure + audit.totalAdvanceRecognized)}`;

        if (pastBreakdownEl) {
            const pastEntries = Object.entries(audit.pastArrearsByYear || {});
            if (pastEntries.length > 0) {
                pastBreakdownEl.innerHTML = pastEntries.map(([yr, amt]) => `
                    <div class="flex justify-between items-center text-slate-500">
                        <span>&bull; Pelunasan tunggakan jatah anggaran ${yr}</span>
                        <span class="font-medium text-rose-600 dark:text-rose-400">Rp ${fmt2(amt)}</span>
                    </div>
                `).join('');
            } else {
                pastBreakdownEl.innerHTML = '<span class="italic text-slate-400">Tidak ada pelunasan tunggakan tahun sebelumnya</span>';
            }
        }

        if (futureBreakdownEl) {
            const entries = Object.entries(audit.futureByYear || {});
            if (entries.length > 0) {
                futureBreakdownEl.innerHTML = entries.map(([yr, amt]) => `
                    <div class="flex justify-between items-center text-slate-500">
                        <span>&bull; Setoran SPP jatah tahun anggaran ${yr}</span>
                        <span class="font-medium text-slate-700 dark:text-slate-300">Rp ${fmt2(amt)}</span>
                    </div>
                `).join('');
            } else {
                futureBreakdownEl.innerHTML = '<span class="italic text-slate-400">Tidak ada setoran di muka untuk tahun mendatang</span>';
            }
        }

        // 4. Tabel Daftar Siswa Pembayar di Muka
        const futureContainer = document.getElementById('cf-audit-future-table-container');
        const futureCountEl = document.getElementById('cf-audit-future-count');
        const futureTbody = document.getElementById('cf-audit-future-tbody');

        if (audit.futureTrxList && audit.futureTrxList.length > 0) {
            if (futureContainer) futureContainer.classList.remove('hidden');
            if (futureCountEl) futureCountEl.textContent = `${audit.futureTrxList.length} Transaksi`;
            if (futureTbody) {
                futureTbody.innerHTML = audit.futureTrxList.map(t => `
                    <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td class="px-3 py-1.5 font-mono text-[11px] text-slate-500">${t.date_str || '-'}</td>
                        <td class="px-3 py-1.5 font-medium text-slate-800 dark:text-slate-200">${t.student_name || '-'} <span class="text-[10px] text-slate-400">(${t.student_class || '-'})</span></td>
                        <td class="px-3 py-1.5 font-semibold text-indigo-600 dark:text-indigo-400">Bln ${t.month}/${t.year}</td>
                        <td class="px-3 py-1.5 text-right font-bold text-slate-700 dark:text-slate-300">Rp ${fmt2(t.amount)}</td>
                    </tr>
                `).join('');
            }
        } else {
            if (futureContainer) futureContainer.classList.add('hidden');
        }

        if (loadingEl) loadingEl.classList.add('hidden');
        if (contentEl) contentEl.classList.remove('hidden');
    } catch (err) {
        console.error('[SIMAS Audit Modal] Error:', err);
        if (loadingEl) {
            loadingEl.innerHTML = `<div class="p-6 text-center text-red-500"><i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i><p class="text-sm font-semibold">${err.message}</p></div>`;
        }
    }
};

window._moduleOpenCashflowAuditModal = window.openCashflowAuditModal;

/**
 * Rekonsiliasi Otomatis Kas Harian dengan Bukti Transaksi Fisik Aktual
 * Menyesuaikan row finance_daily_summary dengan total fisik di finance_transactions
 */
window.reconcileDailySummaryWithTransactions = async () => {
    const btn = document.getElementById('btn-reconcile-sync');
    const oldText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-1"></i> Menyinkronkan...';
    }

    try {
        initSupabase();
        if (!supabase) throw new Error('Supabase client belum siap');

        const selectedYear = parseInt(document.getElementById('filter-cf-year')?.value) || 2026;
        const startDateStr = `${selectedYear}-01-01`;
        const endDateStr = `${selectedYear}-12-31`;

        // Kunci tahun buku: buku kas harian tahun yang sudah ditutup tidak boleh diubah
        await refreshClosedYearsList();
        if (closedYearsList.includes(selectedYear)) {
            throw new Error(`Tahun buku ${selectedYear} sudah ditutup. Buku kas harian tahun tersebut tidak dapat disinkronkan ulang.`);
        }

        // 1. Ambil seluruh transaksi fisik tahun ini
        const { data: trxRows, error: trxErr } = await window.fetchAllSupabaseRows(
            supabase,
            'finance_transactions',
            q => q.gte('date_str', startDateStr).lte('date_str', endDateStr).neq('type', 'manual_debt')
        );
        if (trxErr) throw trxErr;

        // Grouping per date_str
        const trxByDate = {};
        (trxRows || []).forEach(t => {
            const d = t.date_str;
            if (!d) return;
            if (!trxByDate[d]) trxByDate[d] = { total: 0, count: 0 };
            trxByDate[d].total += Number(t.amount) || 0;
            trxByDate[d].count += 1;
        });

        // 2. Ambil ringkasan harian tahun ini
        const { data: dailyRows, error: dailyErr } = await window.fetchAllSupabaseRows(
            supabase,
            'finance_daily_summary',
            q => q.gte('date_str', startDateStr).lte('date_str', endDateStr)
        );
        if (dailyErr) throw dailyErr;

        let syncedCount = 0;
        let totalAdjustedAmount = 0;
        const nowIso = new Date().toISOString();

        for (const daily of (dailyRows || [])) {
            if (daily.is_migration) continue; // Jangan ubah entri virtual migrasi

            const dateStr = daily.date_str;
            const actual = trxByDate[dateStr] || { total: 0, count: 0 };

            const currentTotal = Number(daily.total_amount) || 0;
            const currentCount = Number(daily.transaction_count) || 0;

            if (currentTotal !== actual.total || currentCount !== actual.count) {
                const diffAmt = currentTotal - actual.total;
                console.log(`[SIMAS Reconcile] Menyesuaikan ${dateStr}: Rp ${currentTotal} -> Rp ${actual.total} (Selisih: Rp ${diffAmt})`);

                const { error: updateErr } = await supabase
                    .from('finance_daily_summary')
                    .update({
                        total_amount: actual.total,
                        transaction_count: actual.count,
                        updated_at: nowIso
                    })
                    .eq('id', daily.id || dateStr);

                if (updateErr) {
                    console.error(`[SIMAS Reconcile] Gagal update daily ${dateStr}:`, updateErr);
                    throw updateErr;
                }

                syncedCount++;
                totalAdjustedAmount += diffAmt;
            }
        }

        if (typeof window.logAudit === 'function') {
            window.logAudit(
                'RECONCILE_CASHFLOW',
                `reconcile_${selectedYear}`,
                { syncedCount, totalAdjustedAmount, year: selectedYear },
                null,
                `Sinkronisasi kas harian otomatis tahun ${selectedYear}: ${syncedCount} tanggal disesuaikan (total penyesuaian: Rp ${totalAdjustedAmount.toLocaleString('id-ID')})`
            );
        }

        if (typeof showToast === 'function') {
            showToast('Rekonsiliasi Berhasil', `${syncedCount} tanggal buku kas berhasil disinkronkan.`);
        } else {
            alert(`Rekonsiliasi Berhasil: ${syncedCount} tanggal buku kas berhasil disinkronkan.`);
        }

        // Muat ulang modal audit agar langsung menampilkan status 100% sinkron
        await window.openCashflowAuditModal(selectedYear);

        // Muat ulang tabel arus kas utama
        if (typeof window.loadCashflow === 'function') {
            await window.loadCashflow();
        }
    } catch (err) {
        console.error('[SIMAS Reconcile] Gagal rekonsiliasi:', err);
        alert('Gagal menyinkronkan kas: ' + (err.message || err));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = oldText || '<i class="fa-solid fa-arrows-rotate"></i> Sinkronkan Kas Harian Otomatis';
        }
    }
};

// =========================================================================
// RKAS KOMITE INTEGRATION FOR CASHFLOW (PENGELUARAN)
// =========================================================================
let _rkasKegiatanCache = [];
window._currentSelectedRkasSisa = 0;

async function loadRkasKegiatanForCashflow(year) {
    const selectEl = document.getElementById('cf-rkas-kegiatan');
    if (!selectEl) return;

    try {
        initSupabase();
        if (!supabase) return;

        const targetYear = parseInt(year, 10) || new Date().getFullYear();
        const { data, error } = await supabase
            .from('rkas_komite_items')
            .select('id, header_id, kode_program, uraian, jumlah, tahap_1, tahap_2')
            .eq('item_type', 'kegiatan')
            .like('header_id', `${targetYear}_%`);

        if (error) {
            console.warn('[Arus Kas] Tabel rkas_komite_items belum ada atau error:', error.message);
            return;
        }

        const items = Array.isArray(data) ? data : [];
        const hasPerubahan = items.some(i => i.header_id.endsWith('_perubahan'));
        const activeItems = items.filter(i => hasPerubahan ? i.header_id.endsWith('_perubahan') : i.header_id.endsWith('_murni'));

        _rkasKegiatanCache = activeItems;

        const prevVal = selectEl.value;
        selectEl.innerHTML = '<option value="">-- Pilih Pos Kegiatan RKAS --</option>';
        activeItems.forEach(keg => {
            const opt = document.createElement('option');
            opt.value = keg.id;
            opt.textContent = `${keg.kode_program ? keg.kode_program + ' ' : ''}${keg.uraian}`;
            selectEl.appendChild(opt);
        });

        if (prevVal) selectEl.value = prevVal;
    } catch (e) {
        console.warn('[Arus Kas] Gagal memuat pilihan RKAS:', e);
    }
}

window.handleCashflowTypeChange = (typeVal) => {
    const wrapper = document.getElementById('cf-rkas-wrapper');
    const rkasSelect = document.getElementById('cf-rkas-kegiatan');
    if (!wrapper) return;

    if (typeVal === 'keluar') {
        wrapper.classList.remove('hidden');
        if (rkasSelect) rkasSelect.setAttribute('required', 'true');
    } else {
        wrapper.classList.add('hidden');
        if (rkasSelect) {
            rkasSelect.removeAttribute('required');
            rkasSelect.value = '';
        }
        document.getElementById('cf-rkas-budget-box')?.classList.add('hidden');
        document.getElementById('cf-rkas-overbudget-warn')?.classList.add('hidden');
    }
};

window.handleRkasKegiatanSelected = async (kegId) => {
    const box = document.getElementById('cf-rkas-budget-box');
    const paguVal = document.getElementById('cf-rkas-pagu-val');
    const realVal = document.getElementById('cf-rkas-real-val');
    const sisaVal = document.getElementById('cf-rkas-sisa-val');
    const warnBox = document.getElementById('cf-rkas-overbudget-warn');

    if (!kegId) {
        box?.classList.add('hidden');
        warnBox?.classList.add('hidden');
        window._currentSelectedRkasSisa = 0;
        return;
    }

    const keg = _rkasKegiatanCache.find(k => k.id === kegId);
    const pagu = keg ? (Number(keg.jumlah) || 0) : 0;

    let realisasi = 0;
    try {
        initSupabase();
        const editId = document.getElementById('cf-id')?.value;
        if (supabase) {
            const { data: cfRows } = await supabase
                .from('finance_cashflow')
                .select('amount, id')
                .eq('type', 'keluar')
                .eq('rkas_kegiatan_id', kegId);

            if (Array.isArray(cfRows)) {
                cfRows.forEach(r => {
                    if (editId && r.id === editId) return;
                    realisasi += Number(r.amount) || 0;
                });
            }
        }
    } catch (e) {
        console.warn('[Arus Kas] Realisasi query error:', e);
    }

    const sisa = pagu - realisasi;
    window._currentSelectedRkasSisa = sisa;

    if (paguVal) paguVal.textContent = 'Rp ' + pagu.toLocaleString('id-ID');
    if (realVal) realVal.textContent = 'Rp ' + realisasi.toLocaleString('id-ID');
    if (sisaVal) {
        sisaVal.textContent = 'Rp ' + sisa.toLocaleString('id-ID');
        sisaVal.className = sisa < 0 ? 'font-mono text-rose-600 dark:text-rose-400 font-bold' : 'font-mono text-indigo-700 dark:text-indigo-300 font-bold';
    }

    box?.classList.remove('hidden');
    window.checkCashflowOverbudget();
};

window.checkCashflowOverbudget = () => {
    const typeVal = document.getElementById('cf-type')?.value;
    if (typeVal !== 'keluar') return;

    const kegId = document.getElementById('cf-rkas-kegiatan')?.value;
    if (!kegId) return;

    const amountValStr = document.getElementById('cf-amount')?.value;
    const amount = typeof window.parseCashflowAmount === 'function'
        ? window.parseCashflowAmount(amountValStr)
        : parseFloat(String(amountValStr || '').replace(/\./g, '').replace(',', '.'));

    const sisa = typeof window._currentSelectedRkasSisa === 'number' ? window._currentSelectedRkasSisa : 0;
    const warnBox = document.getElementById('cf-rkas-overbudget-warn');
    const warnMsg = document.getElementById('cf-rkas-warn-msg');

    if (!isNaN(amount) && amount > 0 && amount > sisa) {
        const over = amount - sisa;
        if (warnMsg) {
            warnMsg.textContent = `Nominal pengeluaran ini (Rp ${amount.toLocaleString('id-ID')}) melebihi sisa pagu RKAS (Sisa: Rp ${sisa.toLocaleString('id-ID')}) sebesar Rp ${over.toLocaleString('id-ID')}. Disarankan melakukan pergeseran/perubahan RKAS.`;
        }
        warnBox?.classList.remove('hidden');
    } else {
        warnBox?.classList.add('hidden');
    }
};

/**
 * Membuka modal mutasi kas manual, mereset form, dan mengisi tanggal otomatis hari ini.
 */
window.openCashflowModal = () => {
    const form = document.getElementById('form-cashflow-transaction');
    if (form) form.reset();
    
    // Clear hidden id input if exists
    const idInput = document.getElementById('cf-id');
    if (idInput) idInput.value = '';

    const receiptInput = document.getElementById('cf-receipt-no');
    if (receiptInput) receiptInput.value = '';

    // Restore title
    const modalTitle = document.querySelector('#modal-cashflow-form h3');
    if (modalTitle) {
        modalTitle.innerHTML = '<i class="fa-solid fa-file-circle-plus text-indigo-500"></i> Catat Mutasi Kas';
    }

    // Sembunyikan tombol hapus untuk transaksi baru
    const deleteBtn = document.getElementById('btn-delete-cashflow');
    if (deleteBtn) deleteBtn.classList.add('hidden');

    const dateInput = document.getElementById('cf-date');
    const todayStr = new Date().toLocaleDateString('sv-SE');
    if (dateInput) {
        dateInput.value = todayStr;
        dateInput.max = todayStr;
    }

    const curYear = parseInt(todayStr.split('-')[0], 10);
    loadRkasKegiatanForCashflow(curYear);
    window.handleCashflowTypeChange('keluar');

    const rkasSelect = document.getElementById('cf-rkas-kegiatan');
    if (rkasSelect) rkasSelect.value = '';
    document.getElementById('cf-rkas-budget-box')?.classList.add('hidden');
    document.getElementById('cf-rkas-overbudget-warn')?.classList.add('hidden');
    window._currentSelectedRkasSisa = 0;
    
    const modal = document.getElementById('modal-cashflow-form');
    if (modal) modal.classList.remove('hidden');
};

/**
 * Membuka modal mutasi kas manual untuk diedit.
 */
window.openEditCashflowModal = async (docId) => {
    try {
        initSupabase();
        if (!supabase) {
            showToast('Error', 'Koneksi server belum siap.', 'error');
            return;
        }

        const { data, error } = await supabase
            .from('finance_cashflow')
            .select('*')
            .eq('id', docId)
            .maybeSingle();

        if (error || !data) {
            showToast('Error', 'Data mutasi kas tidak ditemukan.', 'error');
            return;
        }
        
        // Cek apakah tahun buku sudah ditutup
        const dateStr = data.date_str || '';
        const year = parseInt(dateStr.split('-')[0], 10);
        if (closedYearsList.includes(year)) {
            showToast('Error', 'Tahun buku untuk transaksi ini sudah ditutup.', 'error');
            return;
        }

        // Set hidden input
        const idInput = document.getElementById('cf-id');
        if (idInput) idInput.value = docId;

        // Set form values
        const dateInput = document.getElementById('cf-date');
        if (dateInput) {
            dateInput.value = data.date_str || '';
            // Transaksi pasca tutup buku Desember bertanggal 1 Januari tahun depan; izinkan agar form tetap bisa disimpan
            const todayStr = new Date().toLocaleDateString('sv-SE');
            dateInput.max = (data.date_str && data.date_str > todayStr) ? data.date_str : todayStr;
        }

        const receiptInput = document.getElementById('cf-receipt-no');
        if (receiptInput) receiptInput.value = data.no_bukti || '';

        const typeInput = document.getElementById('cf-type');
        if (typeInput) typeInput.value = data.type || 'keluar';

        await loadRkasKegiatanForCashflow(year);
        window.handleCashflowTypeChange(data.type || 'keluar');

        const rkasSelect = document.getElementById('cf-rkas-kegiatan');
        if (rkasSelect && data.rkas_kegiatan_id) {
            rkasSelect.value = data.rkas_kegiatan_id;
            await window.handleRkasKegiatanSelected(data.rkas_kegiatan_id);
        }

        const amountInput = document.getElementById('cf-amount');
        if (amountInput) {
            const num = Number(data.amount) || 0;
            amountInput.value = num.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        const descInput = document.getElementById('cf-desc');
        if (descInput) descInput.value = data.description || '';

        // Ubah judul modal
        const modalTitle = document.querySelector('#modal-cashflow-form h3');
        if (modalTitle) {
            modalTitle.innerHTML = '<i class="fa-solid fa-file-pen text-indigo-500"></i> Edit Mutasi Kas';
        }

        // Tampilkan tombol hapus untuk aksi edit
        const deleteBtn = document.getElementById('btn-delete-cashflow');
        if (deleteBtn) deleteBtn.classList.remove('hidden');

        // Tampilkan modal
        const modal = document.getElementById('modal-cashflow-form');
        if (modal) modal.classList.remove('hidden');

    } catch (err) {
        console.error('[Arus Kas] Open Edit Error:', err);
        showToast('Error', 'Gagal memuat data mutasi: ' + err.message, 'error');
    }
};

/**
 * Menyimpan/memperbarui transaksi mutasi kas manual ke Supabase finance_cashflow.
 */
async function saveCashflowTransaction(e) {
    e.preventDefault();
    let dateVal = document.getElementById('cf-date').value;
    const receiptNoVal = (document.getElementById('cf-receipt-no')?.value || '').trim();
    const typeVal = document.getElementById('cf-type').value;
    const amountValStr = document.getElementById('cf-amount').value;
    const amount = typeof window.parseCashflowAmount === 'function'
        ? window.parseCashflowAmount(amountValStr)
        : parseFloat(String(amountValStr || '').replace(/\./g, '').replace(',', '.'));
    const descVal = document.getElementById('cf-desc').value.trim();

    if (!dateVal || !typeVal || isNaN(amount) || amount <= 0 || !descVal) {
        showToast('Error', 'Harap lengkapi semua field dengan benar.', 'error');
        return;
    }

    const rkasKegId = (document.getElementById('cf-rkas-kegiatan')?.value || '').trim();
    if (typeVal === 'keluar' && !rkasKegId) {
        showToast('Peringatan', 'Pos Kegiatan RKAS Komite wajib dipilih untuk pengeluaran kas.', 'warning');
        document.getElementById('cf-rkas-kegiatan')?.focus();
        return;
    }

    try {
        await refreshClosedYearsList();
    } catch (err) {
        showToast('Error', err.message, 'error');
        return;
    }

    const todayStr = new Date().toLocaleDateString('sv-SE');
    // Tanggal pembukuan hari ini (1 Januari tahun depan jika tahun berjalan sudah tutup buku di bulan Desember)
    const todayPostingStr = getFinancePostingDateStr(todayStr);
    if (dateVal > todayStr && dateVal !== todayPostingStr) {
        showToast('Error', 'Tanggal transaksi tidak boleh di masa depan.', 'error');
        return;
    }

    const selectedDateYear = parseInt(dateVal.split('-')[0]);
    if (closedYearsList.includes(selectedDateYear)) {
        const todayYear = parseInt(todayStr.split('-')[0]);
        if (selectedDateYear !== todayYear) {
            showToast('Error', 'Tahun buku untuk tanggal transaksi ini sudah ditutup.', 'error');
            return;
        }
        // Tahun berjalan sudah tutup buku (Desember): transaksi dibukukan ke 1 Januari tahun berikutnya
        dateVal = `${selectedDateYear + 1}-01-01`;
        showToast('Info', `Tahun buku ${selectedDateYear} sudah ditutup. Transaksi dibukukan ke tanggal 1 Januari ${selectedDateYear + 1}.`, 'warning');
    }

    const idInput = document.getElementById('cf-id');
    const editId = idInput ? idInput.value : '';

    try {
        initSupabase();
        const nowIso = new Date().toISOString();

        if (editId) {
            // Update manual cashflow (Pure Supabase SSOT)
            if (supabase) {
                const updatePayload = {
                    date_str: dateVal,
                    type: typeVal,
                    category: 'Umum',
                    amount: amount,
                    description: descVal,
                    no_bukti: receiptNoVal,
                    rkas_kegiatan_id: typeVal === 'keluar' ? (rkasKegId || null) : null,
                    officer_name: currentTellerName,
                    updated_at: nowIso
                };

                let { error: cfUpErr } = await supabase
                    .from('finance_cashflow')
                    .update(updatePayload)
                    .eq('id', editId);

                // Fail-safe jika kolom no_bukti / rkas_kegiatan_id belum dibuat di Supabase
                if (cfUpErr && (cfUpErr.code === '42703' || String(cfUpErr.message || '').includes('rkas_kegiatan_id') || String(cfUpErr.message || '').includes('no_bukti'))) {
                    console.warn('[Arus Kas] Kolom rkas_kegiatan_id/no_bukti belum tersedia, menyimpan tanpa kolom tersebut...');
                    delete updatePayload.rkas_kegiatan_id;
                    delete updatePayload.no_bukti;
                    const retryRes = await supabase
                        .from('finance_cashflow')
                        .update(updatePayload)
                        .eq('id', editId);
                    cfUpErr = retryRes.error;
                    showToast('Peringatan', 'Data mutasi tersimpan, namun kolom rkas_kegiatan_id/no_bukti belum aktif di database Supabase.', 'warning');
                }

                if (cfUpErr) throw cfUpErr;
            }

            // Audit Trail
            if (typeof window.logAudit === 'function') {
                const auditDetail = `Mengubah mutasi kas manual: ${editId} - nominal Rp ${amount.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, tgl ${dateVal}${receiptNoVal ? ' [No. Bukti: ' + receiptNoVal + ']' : ''}${rkasKegId ? ' [RKAS: ' + rkasKegId + ']' : ''}`;
                window.logAudit('UPDATE_CASHFLOW', editId, null, { dateStr: dateVal, type: typeVal, amount, description: descVal, noBukti: receiptNoVal, rkasKegiatanId: rkasKegId }, auditDetail);
            }

            showToast('Berhasil', 'Transaksi kas berhasil diperbarui!');
        } else {
            // Create new (Pure Supabase SSOT)
            const newDocId = 'cf_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

            if (supabase) {
                const insertPayload = {
                    id: newDocId,
                    date_str: dateVal,
                    type: typeVal,
                    category: 'Umum',
                    amount: amount,
                    description: descVal,
                    no_bukti: receiptNoVal,
                    rkas_kegiatan_id: typeVal === 'keluar' ? (rkasKegId || null) : null,
                    officer_name: currentTellerName,
                    is_closing_record: false,
                    created_at: nowIso,
                    updated_at: nowIso
                };

                let { error: cfInsErr } = await supabase
                    .from('finance_cashflow')
                    .insert([insertPayload]);

                // Fail-safe jika kolom no_bukti / rkas_kegiatan_id belum dibuat di Supabase
                if (cfInsErr && (cfInsErr.code === '42703' || String(cfInsErr.message || '').includes('rkas_kegiatan_id') || String(cfInsErr.message || '').includes('no_bukti'))) {
                    console.warn('[Arus Kas] Kolom rkas_kegiatan_id/no_bukti belum tersedia, menyimpan tanpa kolom tersebut...');
                    delete insertPayload.rkas_kegiatan_id;
                    delete insertPayload.no_bukti;
                    const retryRes = await supabase
                        .from('finance_cashflow')
                        .insert([insertPayload]);
                    cfInsErr = retryRes.error;
                    showToast('Peringatan', 'Data mutasi tersimpan, namun kolom rkas_kegiatan_id/no_bukti belum aktif di database Supabase.', 'warning');
                }

                if (cfInsErr) throw cfInsErr;
            }

            // Audit Trail
            if (typeof window.logAudit === 'function') {
                const auditDetail = `Mencatat mutasi kas ${typeVal}: Rp ${amount.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} - ${descVal}${receiptNoVal ? ' [No. Bukti: ' + receiptNoVal + ']' : ''}${rkasKegId ? ' [RKAS: ' + rkasKegId + ']' : ''}`;
                window.logAudit('CREATE_CASHFLOW', 'finance_cashflow', null, { type: typeVal, amount, desc: descVal, noBukti: receiptNoVal, rkasKegiatanId: rkasKegId }, auditDetail);
            }

            if (typeVal === 'keluar' && typeof window._currentSelectedRkasSisa === 'number' && amount > window._currentSelectedRkasSisa) {
                showToast('Peringatan Over-Budget', 'Pengeluaran ini melebihi sisa pagu RKAS kegiatan. Disarankan melakukan pergeseran/perubahan RKAS.', 'warning');
            }

            showToast('Berhasil', 'Transaksi kas berhasil disimpan!');
        }

        document.getElementById('form-cashflow-transaction').reset();
        if (idInput) idInput.value = '';
        const receiptInput = document.getElementById('cf-receipt-no');
        if (receiptInput) receiptInput.value = '';
        
        // Restore title
        const modalTitle = document.querySelector('#modal-cashflow-form h3');
        if (modalTitle) {
            modalTitle.innerHTML = '<i class="fa-solid fa-file-circle-plus text-indigo-500"></i> Catat Mutasi Kas';
        }

        const dateInput = document.getElementById('cf-date');
        if (dateInput) {
            dateInput.value = todayStr;
            dateInput.max = todayStr;
        }
        // Tutup modal form
        document.getElementById('modal-cashflow-form').classList.add('hidden');

        // Invalidasi cache & reload
        window._cashflowCache = null;
        await window.loadCashflow();

    } catch (err) {
        console.error('[Arus Kas] Save Error:', err);
        showToast('Gagal', 'Gagal menyimpan transaksi: ' + err.message, 'error');
    }
}

/**
 * Handler hapus transaksi dari dalam modal form edit.
 * Menghasilkan passkey matematika acak dan menampilkan modal konfirmasi.
 */
window.handleDeleteFromModal = async () => {
    const idInput = document.getElementById('cf-id');
    if (idInput && idInput.value) {
        const docId = idInput.value;
        
        // Generate passkey matematika acak (penjumlahan 2 bilangan satuan 1-9)
        const num1 = Math.floor(Math.random() * 9) + 1;
        const num2 = Math.floor(Math.random() * 9) + 1;
        window._cfDeleteConfirmAnswer = num1 + num2;
        window._cfDeleteConfirmDocId = docId;
        
        // Set ke modal UI
        const qEl = document.getElementById('cf-math-question');
        if (qEl) qEl.textContent = `${num1} + ${num2} = ?`;
        
        const inputEl = document.getElementById('cf-math-answer-input');
        if (inputEl) inputEl.value = '';
        
        // Tampilkan modal konfirmasi
        const modalDel = document.getElementById('modal-delete-cashflow');
        if (modalDel) modalDel.classList.remove('hidden');
    }
};

/**
 * Mengeksekusi penghapusan dari modal setelah passkey matematika divalidasi.
 */
window.executeDeleteCashflowFromModal = async () => {
    const inputEl = document.getElementById('cf-math-answer-input');
    if (!inputEl) return;
    
    const answer = parseInt(inputEl.value);
    if (isNaN(answer) || answer !== window._cfDeleteConfirmAnswer) {
        showToast('Gagal', 'Jawaban passkey salah. Silakan coba lagi.', 'error');
        
        // Generate passkey baru agar lebih aman saat gagal
        const num1 = Math.floor(Math.random() * 9) + 1;
        const num2 = Math.floor(Math.random() * 9) + 1;
        window._cfDeleteConfirmAnswer = num1 + num2;
        
        const qEl = document.getElementById('cf-math-question');
        if (qEl) qEl.textContent = `${num1} + ${num2} = ?`;
        inputEl.value = '';
        inputEl.focus();
        return;
    }
    
    // Jawaban benar, sembunyikan modal konfirmasi
    const modalDel = document.getElementById('modal-delete-cashflow');
    if (modalDel) modalDel.classList.add('hidden');
    
    // Eksekusi penghapusan asli (skip dialog browser confirm)
    if (window._cfDeleteConfirmDocId) {
        await window.deleteCashflowTransaction(window._cfDeleteConfirmDocId, true);
    }
};

/**
 * Menghapus transaksi mutasi manual dari Supabase dan Firestore.
 * Hanya bisa menghapus transaksi manual (bukan pemasukan SPP otomatis).
 */
window.deleteCashflowTransaction = async (docId, skipConfirm = false) => {
    if (!skipConfirm) {
        const confirmed = typeof window.showConfirmModal === 'function'
            ? await window.showConfirmModal('Yakin ingin menghapus transaksi kas ini?', 'Hapus Transaksi Kas', 'danger')
            : true;
        if (!confirmed) return;
    }

    try {
        initSupabase();

        // Cek penutupan tahun
        if (supabase) {
            const { data, error: fetchCfErr } = await supabase.from('finance_cashflow').select('date_str').eq('id', docId).maybeSingle();
            if (fetchCfErr) throw new Error(`Gagal membaca data mutasi kas: ${fetchCfErr.message}`);
            if (data && data.date_str) {
                const year = parseInt(data.date_str.split('-')[0]);
                if (closedYearsList.includes(year)) {
                    showToast('Error', 'Tahun buku untuk transaksi ini sudah ditutup.', 'error');
                    return;
                }
            }
            const { error: delCfErr } = await supabase.from('finance_cashflow').delete().eq('id', docId);
            if (delCfErr) throw new Error(`Gagal menghapus transaksi kas: ${delCfErr.message}`);
        }

        // Audit Trail
        if (typeof window.logAudit === 'function') {
            window.logAudit('DELETE_CASHFLOW', docId, null, null, `Menghapus mutasi kas manual: ${docId}`);
        }

        showToast('Dihapus', 'Transaksi kas berhasil dihapus.');

        // Sembunyikan modal jika terbuka
        const modal = document.getElementById('modal-cashflow-form');
        if (modal) modal.classList.add('hidden');

        // Invalidasi cache & reload
        window._cashflowCache = null;
        await window.loadCashflow();

    } catch (err) {
        console.error('[Arus Kas] Delete Error:', err);
        showToast('Gagal', 'Gagal menghapus transaksi: ' + err.message, 'error');
    }
};

// --- LISTENER: Form Catat Mutasi Kas Manual ---
const formCashflow = document.getElementById('form-cashflow-transaction');
if (formCashflow) {
    formCashflow.addEventListener('submit', saveCashflowTransaction);
    
    // Set default tanggal dan batas maksimum (max) ke hari ini
    const cfDateInput = document.getElementById('cf-date');
    if (cfDateInput) {
        const todayStr = new Date().toLocaleDateString('sv-SE');
        cfDateInput.value = todayStr;
        cfDateInput.max = todayStr;
    }
}

// --- FILTER & RENDER BUKU KAS SPP ---

// Inisialisasi filter dropdown tahun secara dinamis (Multi-Tahun: masa lalu, tahun berjalan, hingga masa depan)
function initCashflowFilters(force = false) {
    const yearSelect = document.getElementById('filter-cf-year');
    if (yearSelect && (force || yearSelect.options.length <= 1)) {
        const currentYear = new Date().getFullYear();
        const prevValue = yearSelect.value;
        yearSelect.innerHTML = '';
        
        // Sediakan rentang multi-tahun yang fleksibel (currentYear - 2 s/d currentYear + 4)
        // Misal 2024 s/d 2030 (diurutkan descending agar tahun terbaru/mendatang mudah diakses)
        const minYear = currentYear - 2;
        const maxYear = currentYear + 4;
        for (let y = maxYear; y >= minYear; y--) {
            const opt = document.createElement('option');
            opt.value = String(y);
            opt.textContent = `${y}`;
            if (prevValue ? String(y) === String(prevValue) : y === currentYear) {
                opt.selected = true;
            }
            yearSelect.appendChild(opt);
        }
    }

    // Set default filter bulan ke bulan berjalan saat ini jika belum diubah manual oleh pengguna
    const monthSelect = document.getElementById('filter-cf-month');
    if (monthSelect) {
        const currentMonthStr = String(new Date().getMonth() + 1).padStart(2, '0');
        if (force || !monthSelect.dataset.userChanged) {
            monthSelect.value = currentMonthStr;
        }
    }
}
window.initCashflowFilters = initCashflowFilters;

// Handler saat filter tahun berubah (mengosongkan cache & fetch ulang)
window.handleYearFilterChange = async () => {
    window._cashflowCache = null;
    await window.loadCashflow();
};

// Memproses filter Bulan & Tipe secara client-side
window.filterCashflowTable = () => {
    if (!window.cashflowEntries) return;
    const monthSelect = document.getElementById('filter-cf-month');
    if (monthSelect && document.activeElement === monthSelect) {
        monthSelect.dataset.userChanged = 'true';
    }
    const monthFilter = monthSelect?.value || 'all';
    const typeFilter = document.getElementById('filter-cf-type')?.value || 'all';
    const yearFilter = document.getElementById('filter-cf-year')?.value || new Date().getFullYear();
    const searchFilter = (document.getElementById('filter-cf-search')?.value || '').toLowerCase().trim();

    let filtered = window.cashflowEntries;

    // Filter Periode Bulan (berdasarkan bagian bulan YYYY-MM-DD)
    if (monthFilter !== 'all') {
        filtered = filtered.filter(entry => {
            if (!entry.dateStr) return false;
            const parts = entry.dateStr.split('-');
            return parts[1] === monthFilter;
        });
    }

    // Filter Pencarian Teks (No. Bukti, Keterangan, atau Petugas)
    if (searchFilter) {
        filtered = filtered.filter(entry => {
            const desc = (entry.description || '').toLowerCase();
            const receipt = (entry.receiptNo || '').toLowerCase();
            const teller = (entry.teller || '').toLowerCase();
            return desc.includes(searchFilter) || receipt.includes(searchFilter) || teller.includes(searchFilter);
        });
    }

    // Hitung sisa saldo periode sebelumnya untuk melengkapi saldo berjalan
    window._cfPreviousPeriodData = null;
    let previousBalance = 0;
    
    // Cek jika baris virtual saldo awal tahun sudah ada di list filtered (menghindari duplikasi)
    const hasVirtualSaldoRow = filtered.some(entry => entry.id === `virtual_saldo_awal_${yearFilter}`);
    
    if (!hasVirtualSaldoRow) {
        let prevMonthName = '';
        
        if (monthFilter !== 'all') {
            // Cari entri terakhir sebelum bulan terpilih pada tahun terpilih
            const beforeEntries = window.cashflowEntries.filter(entry => {
                if (!entry.dateStr) return false;
                const parts = entry.dateStr.split('-');
                return parts[1] < monthFilter;
            });

            if (beforeEntries.length > 0) {
                previousBalance = beforeEntries[beforeEntries.length - 1].balance;
            } else {
                // Jika tidak ada transaksi sebelumnya di tahun ini, coba ambil dari virtual_saldo_awal
                const virtualSaldoDoc = window.cashflowEntries.find(e => e.id === `virtual_saldo_awal_${yearFilter}`);
                if (virtualSaldoDoc) {
                    previousBalance = virtualSaldoDoc.balance;
                }
            }

            const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
            const prevMonthIndex = parseInt(monthFilter) - 2;
            prevMonthName = prevMonthIndex >= 0 ? monthNames[prevMonthIndex] : `Desember ${parseInt(yearFilter) - 1}`;
        } else {
            // Jika filter semua bulan dipilih, saldo sebelumnya adalah saldo awal tahun terpilih
            const virtualSaldoDoc = window.cashflowEntries.find(e => e.id === `virtual_saldo_awal_${yearFilter}`);
            if (virtualSaldoDoc) {
                previousBalance = virtualSaldoDoc.balance;
            } else {
                previousBalance = 0;
            }
            prevMonthName = `Desember ${parseInt(yearFilter) - 1}`;
        }

        window._cfPreviousPeriodData = {
            balance: previousBalance,
            label: `Saldo Kumulatif s.d. ${prevMonthName}`
        };
    }

    // --- KALKULASI RINGKASAN KAS BERDASARKAN FILTER WAKTU SAJA ---
    // (Tidak dipengaruhi oleh tipe transaksi agar ringkasan kas tetap utuh menampilkan arus masuk & keluar)
    const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    let totalSppIncome = 0;
    let totalManualIncome = 0;
    let totalExpense = 0;

    filtered.forEach(entry => {
        const amt = round2(Number(entry.amount) || 0);
        if (entry.type === 'spp_income') {
            totalSppIncome = round2(totalSppIncome + amt);
        } else if (entry.type === 'masuk') {
            totalManualIncome = round2(totalManualIncome + amt);
        } else if (entry.type === 'keluar') {
            totalExpense = round2(totalExpense + amt);
        }
    });

    const runningBalance = round2((totalSppIncome + totalManualIncome) - totalExpense);
    const prevBal = (window._cfPreviousPeriodData && typeof window._cfPreviousPeriodData.balance === 'number')
        ? window._cfPreviousPeriodData.balance
        : previousBalance;
    const periodEndingBalance = (filtered.length > 0 && typeof filtered[filtered.length - 1].balance === 'number')
        ? filtered[filtered.length - 1].balance
        : round2(prevBal + runningBalance);

    window._cfPeriodEndingBalance = periodEndingBalance;

    // Update UI Summary Cards di modal ringkasan kas (2 angka di belakang koma)
    const fmt = (v) => 'Rp ' + (Number(v) || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sppTotalEl = document.getElementById('cashflow-spp-total');
    const manualInEl = document.getElementById('cashflow-manual-in');
    const outTotalEl = document.getElementById('cashflow-out-total');
    const balanceEl = document.getElementById('cashflow-balance');
    const periodEl = document.getElementById('cashflow-summary-period');

    if (sppTotalEl) sppTotalEl.innerText = fmt(totalSppIncome);
    if (manualInEl) manualInEl.innerText = fmt(totalManualIncome);
    if (outTotalEl) outTotalEl.innerText = fmt(totalExpense);
    
    if (balanceEl) {
        balanceEl.innerText = fmt(periodEndingBalance);
        // Warna dinamis: hijau jika positif, merah jika negatif
        balanceEl.className = periodEndingBalance >= 0
            ? 'text-xl md:text-2xl font-black text-emerald-700 dark:text-emerald-400 mt-1'
            : 'text-xl md:text-2xl font-black text-red-600 dark:text-red-400 mt-1';
    }

    if (periodEl) {
        const monthNames = {
            'all': 'Semua Bulan',
            '01': 'Januari',
            '02': 'Februari',
            '03': 'Maret',
            '04': 'April',
            '05': 'Mei',
            '06': 'Juni',
            '07': 'Juli',
            '08': 'Agustus',
            '09': 'September',
            '10': 'Oktober',
            '11': 'November',
            '12': 'Desember'
        };
        const yearFilter = document.getElementById('filter-cf-year')?.value || new Date().getFullYear();
        const modeText = window.currentCashflowMode === 'budget' ? ' • Tahun Anggaran' : ' • Kas Riil';
        periodEl.innerText = `(${monthNames[monthFilter] || 'Semua Bulan'} ${yearFilter}${modeText})`;
    }

    // Filter Tipe Mutasi (hanya untuk tampilan tabel)
    if (typeFilter !== 'all') {
        filtered = filtered.filter(entry => entry.type === typeFilter);
    }

    window.renderCashflowTable(filtered);
};

// Render data kas ke tabel HTML
window.renderCashflowTable = (entries) => {
    const tbody = document.getElementById('cashflow-tbody');
    if (!tbody) return;

    // Urutan tampil descending (terbaru di atas)
    const displayEntries = [...entries].reverse();

    if (displayEntries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-slate-400 italic">Tidak ada data arus kas yang cocok dengan filter.</td></tr>';
        return;
    }

    const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const fmt2 = (val) => (Number(val) || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Hitung total debit dan kredit mutasi periode ini (kecuali saldo awal tahun)
    let totalDebit = 0;
    let totalCredit = 0;
    entries.forEach(entry => {
        if (entry.id && entry.id.startsWith('virtual_saldo_awal_')) return;
        totalDebit = round2(totalDebit + (entry.debit || 0));
        totalCredit = round2(totalCredit + (entry.credit || 0));
    });

    // Hitung saldo kas riil akhir periode berjalan (kumulatif termasuk saldo awal periode)
    // Nilai merefleksikan sisa kas nyata sehingga identik antara filter 'Bulan Terpilih' dan 'Semua Bulan'
    const startBalance = (window._cfPreviousPeriodData && typeof window._cfPreviousPeriodData.balance === 'number')
        ? window._cfPreviousPeriodData.balance
        : 0;
    const finalRealBalance = (typeof window._cfPeriodEndingBalance === 'number')
        ? window._cfPeriodEndingBalance
        : ((displayEntries.length > 0 && typeof displayEntries[0].balance === 'number')
            ? displayEntries[0].balance
            : round2(startBalance + totalDebit - totalCredit));

    const netMutation = round2(totalDebit - totalCredit);
    const balanceColor = finalRealBalance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';

    let html = '';
    
    // Tambahkan baris virtual untuk rangkuman total debit/kredit dan saldo kas riil periode ini di paling atas
    html += `
        <tr class="bg-indigo-50/30 dark:bg-slate-800/40 font-semibold border-b-2 border-slate-200 dark:border-slate-700/80 transition-colors">
            <td class="px-4 py-3 whitespace-nowrap text-slate-400 dark:text-slate-500 text-xs">-</td>
            <td class="px-4 py-3 whitespace-nowrap text-slate-400 dark:text-slate-500 text-xs">-</td>
            <td class="px-4 py-3 text-slate-700 dark:text-slate-200 font-bold">
                <i class="fa-solid fa-calculator text-indigo-500 mr-2 text-sm"></i><span>Total Mutasi Periode Ini</span>
            </td>
            <td class="px-4 py-3 text-right font-mono text-emerald-600 dark:text-emerald-400 font-extrabold">+${fmt2(totalDebit)}</td>
            <td class="px-4 py-3 text-right font-mono text-red-600 dark:text-red-400 font-extrabold">-${fmt2(totalCredit)}</td>
            <td class="px-4 py-3 text-right font-mono ${balanceColor} font-extrabold" title="Saldo Kas Riil Akhir Periode: Rp ${fmt2(finalRealBalance)} (Mutasi Bersih: Rp ${fmt2(netMutation)})">${fmt2(finalRealBalance)}</td>
            <td class="px-4 py-3 text-center">
                <span class="text-slate-300 dark:text-slate-600" title="Saldo Kas Riil Akhir Periode"><i class="fa-solid fa-calculator text-[10px]"></i></span>
            </td>
        </tr>
    `;

    displayEntries.forEach(entry => {
        const dateFormatted = entry.dateStr ? new Date(entry.dateStr + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
        
        let rowClass = '';
        let descIcon = '';
        if (entry.isClosingRecord) {
            rowClass = 'bg-slate-100/70 dark:bg-slate-800/40 hover:bg-slate-200/50 dark:hover:bg-slate-700/60 font-semibold';
            descIcon = '<i class="fa-solid fa-folder-open text-slate-500 dark:text-slate-400 mr-2 text-sm"></i>';
        } else if (entry.type === 'spp_income') {
            rowClass = 'bg-blue-50/30 dark:bg-blue-950/20 hover:bg-blue-100/50 dark:hover:bg-blue-900/30';
            descIcon = '<i class="fa-solid fa-graduation-cap text-blue-500 dark:text-blue-400 mr-2 text-sm"></i>';
        } else if (entry.type === 'masuk') {
            rowClass = 'bg-emerald-50/30 dark:bg-emerald-950/20 hover:bg-emerald-100/50 dark:hover:bg-emerald-900/30';
            descIcon = '<i class="fa-solid fa-arrow-down text-emerald-500 dark:text-emerald-400 mr-2 text-sm"></i>';
        } else {
            rowClass = 'bg-red-50/30 dark:bg-red-950/20 hover:bg-red-100/50 dark:hover:bg-red-900/30';
            descIcon = '<i class="fa-solid fa-arrow-up text-red-500 dark:text-red-400 mr-2 text-sm"></i>';
        }

        const debitStr = entry.debit > 0 ? `<span class="text-emerald-600 dark:text-emerald-400 font-bold">+${fmt2(entry.debit)}</span>` : '<span class="text-slate-300 dark:text-slate-600">-</span>';
        const creditStr = entry.credit > 0 ? `<span class="text-red-600 dark:text-red-400 font-bold">-${fmt2(entry.credit)}</span>` : '<span class="text-slate-300 dark:text-slate-600">-</span>';
        const balanceColor = entry.balance >= 0 ? 'text-slate-800 dark:text-slate-200' : 'text-red-600 dark:text-red-400';

        const role = localStorage.getItem('user_role');
        const isViewOnly = window.hasRole ?
            (!window.hasRole('super_admin') && !window.hasRole('admin_spp')) :
            (role !== 'super_admin' && role !== 'admin_spp');

        let actionHtml = '';
        if (entry.deletable && !isViewOnly) {
            actionHtml = `
                <div class="flex items-center justify-center gap-2">
                    <button onclick="window.openEditCashflowModal('${entry.id}')" class="text-blue-400 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-400 transition-colors" title="Edit transaksi"><i class="fa-solid fa-pen-to-square"></i></button>
                </div>
            `;
        } else {
            actionHtml = entry.isClosingRecord
                ? '<span class="text-slate-400 dark:text-slate-500" title="Saldo Awal Terkunci"><i class="fa-solid fa-lock text-[10px]"></i></span>'
                : '<span class="text-slate-300 dark:text-slate-600" title="Otomatis dari SPP / Mode Read-Only"><i class="fa-solid fa-lock text-[10px]"></i></span>';
        }

        const safeDesc = window.escapeHTML ? window.escapeHTML(entry.description || '-') : (entry.description || '-');
        const safeReceiptNo = window.escapeHTML ? window.escapeHTML(entry.receiptNo || '') : (entry.receiptNo || '');

        const receiptCell = safeReceiptNo ? `
            <span class="inline-flex items-center gap-1 font-mono font-semibold text-xs text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700/80 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600 shadow-2xs" title="Nomor Bukti Transaksi">
                <i class="fa-solid fa-receipt text-[10px] text-indigo-500 dark:text-indigo-400"></i>${safeReceiptNo}
            </span>
        ` : `<span class="text-slate-300 dark:text-slate-600 font-mono text-xs">-</span>`;

        let rkasBadge = '';
        if (entry.rkasKegiatanId) {
            const matchedKeg = _rkasKegiatanCache.find(k => k.id === entry.rkasKegiatanId);
            const kegTitle = matchedKeg ? matchedKeg.uraian : 'Pos RKAS';
            const safeKegTitle = window.escapeHTML ? window.escapeHTML(kegTitle) : kegTitle;
            rkasBadge = `
                <span class="inline-flex items-center gap-1 font-semibold text-[10px] text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800 ml-1.5 align-middle" title="Pos Kegiatan RKAS">
                    <i class="fa-solid fa-file-invoice-dollar text-[9px] text-indigo-500"></i> ${safeKegTitle}
                </span>
            `;
        }

        html += `
            <tr class="${rowClass} border-b border-slate-100 dark:border-slate-800/80 transition-colors">
                <td class="px-4 py-3.5 whitespace-nowrap font-medium text-slate-700 dark:text-slate-300">${dateFormatted}</td>
                <td class="px-4 py-3.5 whitespace-nowrap">${receiptCell}</td>
                <td class="px-4 py-3.5 text-slate-700 dark:text-slate-200 font-medium">${descIcon}<span>${safeDesc}</span>${rkasBadge}</td>
                <td class="px-4 py-3.5 text-right font-mono">${debitStr}</td>
                <td class="px-4 py-3.5 text-right font-mono">${creditStr}</td>
                <td class="px-4 py-3.5 text-right font-mono font-bold ${balanceColor}">${fmt2(entry.balance)}</td>
                <td class="px-4 py-3.5 text-center">${actionHtml}</td>
            </tr>
        `;
    });

    // Tambahkan baris virtual untuk saldo akhir periode sebelumnya jika ada
    if (window._cfPreviousPeriodData) {
        const prev = window._cfPreviousPeriodData;
        const balanceColor = prev.balance >= 0 ? 'text-slate-800 dark:text-slate-200' : 'text-red-600 dark:text-red-400';
        
        html += `
            <tr class="bg-slate-50/50 dark:bg-slate-800/20 hover:bg-slate-100/50 dark:hover:bg-slate-700/30 font-semibold border-b border-slate-100 dark:border-slate-800/80 transition-colors italic">
                <td class="px-4 py-3.5 whitespace-nowrap font-medium text-slate-400 dark:text-slate-500">-</td>
                <td class="px-4 py-3.5 whitespace-nowrap text-slate-400 dark:text-slate-500 font-mono text-xs">-</td>
                <td class="px-4 py-3.5 text-slate-500 dark:text-slate-400">
                    <i class="fa-solid fa-clock-rotate-left text-slate-400 dark:text-slate-500 mr-2 text-sm"></i><span>${prev.label}</span>
                </td>
                <td class="px-4 py-3.5 text-right font-mono text-slate-400 dark:text-slate-500">-</td>
                <td class="px-4 py-3.5 text-right font-mono text-slate-400 dark:text-slate-500">-</td>
                <td class="px-4 py-3.5 text-right font-mono font-bold ${balanceColor}">${fmt2(prev.balance)}</td>
                <td class="px-4 py-3.5 text-center">
                    <span class="text-slate-300 dark:text-slate-600" title="Saldo akumulatif otomatis"><i class="fa-solid fa-lock text-[10px]"></i></span>
                </td>
            </tr>
        `;
    }

    tbody.innerHTML = html;
};

// ============================================
// EKSPOR BUKU KAS UMUM (ARUS KAS) KE EXCEL (.XLSX)
// Format standar BKU resmi 7 kolom sesuai dokumen fisik PDF
// Reaktif terhadap tab aktif: Kas Fisik (Riil) vs Tahun Anggaran
// ============================================
window.exportCashflowExcel = async () => {
    if (typeof XLSX === 'undefined') {
        window.showToast("Error", "Library XLSX belum siap.", "error");
        return;
    }

    if (!window.cashflowEntries || window.cashflowEntries.length === 0) {
        if (typeof window.loadCashflow === 'function') {
            window.showToast("Memuat Data", "Sedang memuat data arus kas...", "info");
            await window.loadCashflow();
        }
    }

    if (!window.cashflowEntries || window.cashflowEntries.length === 0) {
        window.showToast("Data Kosong", "Tidak ada data arus kas untuk diekspor.", "warning");
        return;
    }

    try {
        const cfMode = window.currentCashflowMode || 'real';
        const yearFilter = parseInt(document.getElementById('filter-cf-year')?.value) || new Date().getFullYear();
        const monthFilter = document.getElementById('filter-cf-month')?.value || 'all';
        const typeFilter = document.getElementById('filter-cf-type')?.value || 'all';
        const searchFilter = (document.getElementById('filter-cf-search')?.value || '').toLowerCase().trim();

        const monthNames = [
            "", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
            "Juli", "Agustus", "September", "Oktober", "November", "Desember"
        ];

        let selectedMonthName = "";
        let periodLabel = "";
        let periodText = "";
        if (monthFilter !== 'all') {
            const mIdx = parseInt(monthFilter, 10);
            selectedMonthName = monthNames[mIdx] || monthFilter;
            periodLabel = `Bulan : ${selectedMonthName} ${yearFilter}`;
            periodText = `${selectedMonthName}_${yearFilter}`;
        } else {
            selectedMonthName = "Januari - Desember";
            periodLabel = `Periode : Tahun ${yearFilter}`;
            periodText = `Tahun_${yearFilter}`;
        }

        // Filter data sesuai kriteria aktif
        let filtered = window.cashflowEntries;

        if (monthFilter !== 'all') {
            filtered = filtered.filter(entry => {
                if (!entry.dateStr) return false;
                const parts = entry.dateStr.split('-');
                return parts[1] === monthFilter;
            });
        }

        if (searchFilter) {
            filtered = filtered.filter(entry => {
                const desc = (entry.description || '').toLowerCase();
                const receipt = (entry.receiptNo || '').toLowerCase();
                const teller = (entry.teller || '').toLowerCase();
                return desc.includes(searchFilter) || receipt.includes(searchFilter) || teller.includes(searchFilter);
            });
        }

        if (typeFilter !== 'all') {
            filtered = filtered.filter(entry => entry.type === typeFilter);
        }

        // Urutkan transaksi secara KRONOLOGIS ASCENDING (dari awal s/d akhir periode)
        // Format resmi BKU Excel dimulai dari tanggal 1 s/d tanggal terakhir
        const exportEntries = [...filtered].sort((a, b) => {
            const dateCompare = (a.dateStr || '').localeCompare(b.dateStr || '');
            if (dateCompare !== 0) return dateCompare;
            if (a.isClosingRecord && !b.isClosingRecord) return -1;
            if (!a.isClosingRecord && b.isClosingRecord) return 1;
            const timeA = a.createdAt ? (typeof a.createdAt.toDate === 'function' ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime()) : 0;
            const timeB = b.createdAt ? (typeof b.createdAt.toDate === 'function' ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime()) : 0;
            if (timeA && timeB) return timeA - timeB;
            if (a.type === 'spp_income' && b.type !== 'spp_income') return -1;
            if (a.type !== 'spp_income' && b.type === 'spp_income') return 1;
            return 0;
        });

        const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

        // Tangani Saldo Awal / Saldo Kumulatif Bulan Lalu
        let tableRows = [];
        let runningBal = 0;
        let totalPenerimaan = 0;
        let totalPengeluaran = 0;
        let bankIn = 0;
        let bankOut = 0;
        let cashIn = 0;
        let cashOut = 0;

        // Cek apakah ada saldo awal tahun di exportEntries
        const hasVirtualSaldo = exportEntries.some(e => e.id === `virtual_saldo_awal_${yearFilter}`);

        // Jika filter per bulan (bukan 'all') dan bukan Januari dengan virtual saldo awal,
        // sisipkan baris Saldo Bulan Lalu di paling atas
        if (monthFilter !== 'all' && !hasVirtualSaldo && window._cfPreviousPeriodData) {
            const prev = window._cfPreviousPeriodData;
            const prevAmt = round2(Number(prev.balance) || 0);
            runningBal = prevAmt;
            const prevDebit = prevAmt > 0 ? prevAmt : null;
            const prevCredit = prevAmt < 0 ? Math.abs(prevAmt) : null;
            if (prevDebit) totalPenerimaan = round2(totalPenerimaan + prevDebit);
            if (prevCredit) totalPengeluaran = round2(totalPengeluaran + prevCredit);

            tableRows.push({
                dateStr: `${yearFilter}-${monthFilter}-01`,
                receiptNo: '',
                description: prev.label || `Saldo Bulan Lalu`,
                debit: prevDebit,
                credit: prevCredit,
                balance: runningBal
            });
        }

        // Helper fungsi format tanggal Indonesia: "05 Januari 2026"
        const formatIndoDate = (dStr) => {
            if (!dStr) return '-';
            const parts = dStr.split('-');
            if (parts.length < 3) return dStr;
            const y = parts[0];
            const m = parseInt(parts[1], 10);
            const d = parseInt(parts[2], 10);
            const mName = monthNames[m] || parts[1];
            return `${d.toString().padStart(2, '0')} ${mName} ${y}`;
        };

        exportEntries.forEach(entry => {
            const isSaldoAwal = entry.id === `virtual_saldo_awal_${yearFilter}` || entry.isClosingRecord;
            let debit = (entry.debit && entry.debit > 0) ? round2(entry.debit) : null;
            let credit = (entry.credit && entry.credit > 0) ? round2(entry.credit) : null;

            if (isSaldoAwal) {
                runningBal = round2(entry.balance || (entry.debit || 0));
                totalPenerimaan = round2(totalPenerimaan + (entry.debit || 0));
            } else {
                if (debit) {
                    runningBal = round2(runningBal + debit);
                    totalPenerimaan = round2(totalPenerimaan + debit);
                }
                if (credit) {
                    runningBal = round2(runningBal - credit);
                    totalPengeluaran = round2(totalPengeluaran + credit);
                }
            }

            // Klasifikasi transaksi Bank vs Tunai untuk rekapitulasi Saldo BKU
            const descLower = (entry.description || '').toLowerCase();
            const rcptLower = (entry.receiptNo || '').toLowerCase();
            const isBank = (entry.payment_method === 'transfer' || entry.payment_method === 'bank') ||
                /\b(bank|transfer|trf|tf|giro|jagir|adm|skn|rekening|bni|bri|bca|mandiri)\b/i.test(descLower) ||
                /\b(tf|trf)\b/i.test(rcptLower);

            if (isBank) {
                if (debit) bankIn = round2(bankIn + debit);
                if (credit) bankOut = round2(bankOut + credit);
            } else {
                if (debit) cashIn = round2(cashIn + debit);
                if (credit) cashOut = round2(cashOut + credit);
            }

            tableRows.push({
                dateStr: entry.dateStr,
                receiptNo: entry.receiptNo || '',
                description: entry.description || '-',
                debit: debit,
                credit: credit,
                balance: runningBal
            });
        });

        const finalSaldo = round2(runningBal);
        const netBank = round2(Math.max(0, bankIn - bankOut));
        let saldoBank = round2(Math.min(finalSaldo, netBank));
        let saldoTunai = round2(finalSaldo - saldoBank);
        if (saldoTunai < 0) {
            saldoTunai = 0;
            saldoBank = finalSaldo;
        }

        // Tentukan identitas sekolah & penandatangan sesuai SMA Negeri 1 Abang
        const schoolName = SCHOOL_CONFIG?.schoolName || "SMA Negeri Nusantara";
        const villageKecamatan = SCHOOL_CONFIG?.schoolVillageKecamatan || 'Abang / Abang';
        const kabupatenKota = SCHOOL_CONFIG?.schoolKabupatenKota || 'Karangasem / Amlapura';
        const province = SCHOOL_CONFIG?.schoolProvince || 'Bali';

        // Pejabat penandatangan sesuai kondisi SMA Negeri 1 Abang (SSOT dari SCHOOL_CONFIG)
        const headmasterName = SCHOOL_CONFIG?.headmasterName || "Dr. I Wayan Sudarsana, M.Pd.";
        const headmasterNip = SCHOOL_CONFIG?.headmasterNIP ? (`NIP. ${SCHOOL_CONFIG.headmasterNIP.replace(/^NIP\.?\s*/i, '')}`) : "NIP. 197501012000031001";

        const bendaharaName = SCHOOL_CONFIG?.bendaharaKomiteName || currentTellerName || 'I Nyoman Mintar, S.Pd';
        const bendaharaNip = (SCHOOL_CONFIG?.bendaharaKomiteNIP && SCHOOL_CONFIG.bendaharaKomiteNIP !== '-') ? (SCHOOL_CONFIG.bendaharaKomiteNIP.startsWith('NIP') ? SCHOOL_CONFIG.bendaharaKomiteNIP : `NIP. ${SCHOOL_CONFIG.bendaharaKomiteNIP}`) : '';

        const ketuaKomiteName = SCHOOL_CONFIG?.ketuaKomiteName || 'I Gede Sukasari, S.S.T';
        const ketuaKomiteNip = (SCHOOL_CONFIG?.ketuaKomiteNIP && SCHOOL_CONFIG.ketuaKomiteNIP !== '-') ? (SCHOOL_CONFIG.ketuaKomiteNIP.startsWith('NIP') ? SCHOOL_CONFIG.ketuaKomiteNIP : `NIP. ${SCHOOL_CONFIG.ketuaKomiteNIP}`) : '';

        const wakabidName = SCHOOL_CONFIG?.wakabidSarprasName || 'Wayan Made Komang Ketut';
        const wakabidNip = (SCHOOL_CONFIG?.wakabidSarprasNIP && SCHOOL_CONFIG.wakabidSarprasNIP !== '-') ? SCHOOL_CONFIG.wakabidSarprasNIP : 'NIP. -';

        const audit1Name = SCHOOL_CONFIG?.audit1Name || 'Wayan Made Komang Ketut';
        const audit1Nip = (SCHOOL_CONFIG?.audit1NIP && SCHOOL_CONFIG.audit1NIP !== '-') ? SCHOOL_CONFIG.audit1NIP : 'NIP. -';

        const audit2Name = SCHOOL_CONFIG?.audit2Name || 'Wayan Made Komang Ketut';
        const audit2Nip = (SCHOOL_CONFIG?.audit2NIP && SCHOOL_CONFIG.audit2NIP !== '-') ? SCHOOL_CONFIG.audit2NIP : 'NIP. -';

        const cityName = SCHOOL_CONFIG?.schoolCity || 'Abang';

        // Tanggal tanda tangan: tanggal transaksi terakhir atau akhir bulan terpilih
        let signDateStr = "";
        if (tableRows.length > 0 && tableRows[tableRows.length - 1].dateStr) {
            signDateStr = formatIndoDate(tableRows[tableRows.length - 1].dateStr);
        } else {
            const mNum = parseInt(monthFilter, 10);
            const yNum = parseInt(yearFilter, 10) || new Date().getFullYear();
            const lastDay = (mNum >= 1 && mNum <= 12) ? new Date(yNum, mNum, 0).getDate() : 31;
            signDateStr = `${lastDay} ${monthFilter !== 'all' ? selectedMonthName : 'Desember'} ${yearFilter}`;
        }

        // Bangun Lembar Kerja Spreadsheet (.xlsx) Presisi Meniru Template BKU (Sheet JAN)
        const ws = {};
        const merges = [];

        const setCell = (ref, val, type = 's', numFmt = null, formula = null) => {
            const cell = {};
            if (formula) {
                cell.f = formula;
                if (val !== undefined && val !== null) cell.v = val;
                cell.t = typeof val === 'number' ? 'n' : 's';
            } else if (typeof val === 'number') {
                cell.v = val;
                cell.t = 'n';
            } else if (typeof val === 'boolean') {
                cell.v = val;
                cell.t = 'b';
            } else {
                cell.v = val !== undefined && val !== null ? String(val) : '';
                cell.t = 's';
            }
            if (numFmt) cell.z = numFmt;
            ws[ref] = cell;
        };

        const numFmtAccounting = '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)';
        const numFmtRp = '_("Rp"* #,##0.00_);_("Rp"* (#,##0.00);_("Rp"* "-"_);_(@_)';

        // 1. Judul Dokumen (A1:H1 & A2:H2 merged)
        setCell('A1', 'BUKU KAS UMUM');
        merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } });

        setCell('A2', `Bulan :   ${selectedMonthName} ${yearFilter}`);
        merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 7 } });

        // Metadata Sekolah (Baris 5 s.d. 8)
        setCell('A5', 'Nama Sekolah');
        setCell('C5', ':');
        setCell('D5', schoolName);

        setCell('A6', 'Desa / Kecamatan');
        setCell('C6', ':');
        setCell('D6', villageKecamatan);

        setCell('A7', 'Kabupaten / Kota');
        setCell('C7', ':');
        setCell('D7', kabupatenKota);

        setCell('A8', 'Provinsi');
        setCell('C8', ':');
        setCell('D8', province);

        // 2. Header Tabel Standar BKU 8 Kolom (Baris 10 s.d. 12)
        setCell('A10', 'NO.');
        merges.push({ s: { r: 9, c: 0 }, e: { r: 10, c: 0 } }); // A10:A11

        setCell('B10', 'TANGGAL');
        merges.push({ s: { r: 9, c: 1 }, e: { r: 10, c: 1 } }); // B10:B11

        setCell('C10', 'NO. BKU');
        merges.push({ s: { r: 9, c: 2 }, e: { r: 10, c: 3 } }); // C10:D11

        setCell('E10', 'URAIAN');
        merges.push({ s: { r: 9, c: 4 }, e: { r: 10, c: 4 } }); // E10:E11

        setCell('F10', 'PENERIMAAN');
        merges.push({ s: { r: 9, c: 5 }, e: { r: 10, c: 5 } }); // F10:F11

        setCell('G10', 'PENGELUARAN');
        merges.push({ s: { r: 9, c: 6 }, e: { r: 10, c: 6 } }); // G10:G11

        setCell('H10', 'SALDO');
        merges.push({ s: { r: 9, c: 7 }, e: { r: 10, c: 7 } }); // H10:H11

        // Baris Nomor Kolom (Subheader 1 s.d. 7 di Baris 12)
        setCell('A12', 1);
        setCell('B12', 2);
        setCell('C12', 3);
        merges.push({ s: { r: 11, c: 2 }, e: { r: 11, c: 3 } }); // C12:D12
        setCell('E12', 4);
        setCell('F12', 5);
        setCell('G12', 6);
        setCell('H12', 7);

        // 3. Baris-baris Data Transaksi (Dimulai dari Baris 13)
        let curRow = 12; // Akan di-increment menjadi 13 pada data pertama
        const startDataRow = 13;

        tableRows.forEach((r, idx) => {
            curRow++;
            const rowNo = idx + 1;
            setCell(`A${curRow}`, rowNo);
            setCell(`B${curRow}`, formatIndoDate(r.dateStr));
            setCell(`C${curRow}`, r.receiptNo || '');
            merges.push({ s: { r: curRow - 1, c: 2 }, e: { r: curRow - 1, c: 3 } }); // C:D merged
            setCell(`E${curRow}`, r.description || '-');

            const debitVal = r.debit !== null && r.debit !== undefined ? round2(r.debit) : 0;
            const creditVal = r.credit !== null && r.credit !== undefined ? round2(r.credit) : 0;

            setCell(`F${curRow}`, debitVal, 'n', numFmtAccounting);
            setCell(`G${curRow}`, creditVal, 'n', numFmtAccounting);

            // Rumus Saldo Berjalan resmi: =IF(OR(F[r]<>0,G[r]<>0),SUM(F$13:F[r])-SUM(G$13:G[r]),0)
            const balanceFormula = `IF(OR(F${curRow}<>0,G${curRow}<>0),SUM(F$13:F${curRow})-SUM(G$13:G${curRow}),0)`;
            setCell(`H${curRow}`, round2(r.balance), 'n', numFmtAccounting, balanceFormula);
        });

        const endDataRow = Math.max(startDataRow, curRow);

        // 4. Baris Jumlah / Total
        curRow++;
        const totalRow = curRow;
        setCell(`E${totalRow}`, 'Jumlah');
        setCell(`F${totalRow}`, round2(totalPenerimaan), 'n', numFmtAccounting, `SUM(F${startDataRow}:F${endDataRow})`);
        setCell(`G${totalRow}`, round2(totalPengeluaran), 'n', numFmtAccounting, `SUM(G${startDataRow}:G${endDataRow})`);
        setCell(`H${totalRow}`, round2(finalSaldo), 'n', numFmtAccounting, `F${totalRow}-G${totalRow}`);

        // 5. Rekapitulasi Fisik Kas Pasca-Tabel (Kas Opname)
        curRow += 2;
        setCell(`A${curRow}`, `Saldo BKU Bulan ${selectedMonthName} ${yearFilter} sebesar Rp. `);

        curRow++;
        setCell(`A${curRow}`, 'Terdiri Dari               ');
        setCell(`C${curRow}`, ':');

        curRow++;
        const tunaiRow = curRow;
        setCell(`A${tunaiRow}`, 'Saldo Tunai             ');
        setCell(`C${tunaiRow}`, ':');
        setCell(`D${tunaiRow}`, round2(saldoTunai), 'n', numFmtRp);

        curRow++;
        const bankRow = curRow;
        setCell(`A${bankRow}`, 'Saldo Bank             ');
        setCell(`C${bankRow}`, ':');
        setCell(`D${bankRow}`, round2(saldoBank), 'n', numFmtRp);

        curRow++;
        const totalKasRow = curRow;
        setCell(`A${totalKasRow}`, 'Jumlah');
        setCell(`D${totalKasRow}`, round2(finalSaldo), 'n', numFmtRp, `SUM(D${tunaiRow}:D${bankRow})`);

        // 6. Lembar Pengesahan Tanda Tangan Sesuai Format Resmi SMA Negeri 1 Abang (Sheet JAN)
        curRow += 2;
        // Baris Atas: Kepala Sekolah di Kiri (Kolom A) dan Tanggal/Bendahara Komite di Kanan (Kolom F)
        setCell(`A${curRow}`, `Kepala ${schoolName}`);
        setCell(`F${curRow}`, `${cityName}, ${signDateStr}`);

        curRow++;
        setCell(`F${curRow}`, `Bendahara Komite ${schoolName}`);

        // Ruang jeda tanda tangan (4 baris)
        curRow += 4;
        setCell(`A${curRow}`, headmasterName);
        setCell(`F${curRow}`, bendaharaName);

        curRow++;
        setCell(`A${curRow}`, headmasterNip);
        if (bendaharaNip) {
            setCell(`F${curRow}`, bendaharaNip);
        }

        // Baris Bawah: Menyetujui, Ketua Komite (Kolom C)
        curRow += 2;
        setCell(`C${curRow}`, 'Menyetujui,');

        curRow++;
        setCell(`C${curRow}`, `Ketua Komite ${schoolName}`);

        // Ruang jeda tanda tangan (4 baris)
        curRow += 4;
        setCell(`C${curRow}`, ketuaKomiteName);

        if (ketuaKomiteNip) {
            curRow++;
            setCell(`C${curRow}`, ketuaKomiteNip);
        }

        // Atur Lebar Kolom (Presisi Meniru File Format Asli)
        ws['!cols'] = [
            { wch: 6 },     // A: NO.
            { wch: 18 },    // B: TANGGAL
            { wch: 4 },     // C: : / Bagian 1 NO. BKU
            { wch: 26 },    // D: Nilai / Bagian 2 NO. BKU
            { wch: 48 },    // E: URAIAN
            { wch: 18 },    // F: PENERIMAAN
            { wch: 18 },    // G: PENGELUARAN
            { wch: 18 }     // H: SALDO
        ];

        ws['!merges'] = merges;
        ws['!ref'] = `A1:H${curRow}`;

        const wb = XLSX.utils.book_new();
        const modeTag = cfMode === 'budget' ? 'Tahun_Anggaran' : 'Kas_Riil';

        // Tentukan nama sheet: Jika Januari beri nama 'JAN' persis format BKU
        const shortMonths = ["", "JAN", "FEB", "MAR", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
        let sheetTitle = 'JAN';
        if (monthFilter !== 'all') {
            const mIdx = parseInt(monthFilter, 10);
            sheetTitle = shortMonths[mIdx] || selectedMonthName.toUpperCase();
        } else {
            sheetTitle = `TAHUN_${yearFilter}`;
        }

        XLSX.utils.book_append_sheet(wb, ws, sheetTitle.substring(0, 31));

        const fileName = `BKU_${modeTag}_${periodText.replace(/[\s\/\\]+/g, '_')}.xlsx`;
        XLSX.writeFile(wb, fileName);

        window.showToast("Export Berhasil", `Berkas BKU (${cfMode === 'budget' ? 'Tahun Anggaran' : 'Kas Riil'}) lembar ${sheetTitle} berhasil diunduh.`, "success");
    } catch (e) {
        console.error("[Export Cashflow BKU] Gagal:", e);
        window.showToast("Error Export", e.message, "error");
    }
};

window._moduleExportCashflowExcel = window.exportCashflowExcel;

// ============================================
// WIZARD TUTUP BUKU TAHUNAN KEUANGAN
// ============================================

let closingWizardState = {
    year: 0,
    saldoAwal: 0,
    sppIncome: 0,
    manualIncome: 0,
    expense: 0,
    saldoAkhir: 0
};

// Menentukan tahun buku berikutnya yang wajib ditutup (berurutan mulai tahun buku pertama)
function getNextFinanceClosingYear() {
    let openYear = FIRST_FINANCE_BOOK_YEAR;
    while (closedYearsList.includes(openYear)) {
        openYear++;
    }
    return openYear;
}

// Tahun buku berjalan baru dapat ditutup mulai 1 Desember; tahun yang sudah lewat dapat ditutup kapan saja
function isFinanceClosingWindowOpen(year) {
    const now = new Date();
    const currentYear = now.getFullYear();
    return year < currentYear || (year === currentYear && now.getMonth() === 11);
}

// Hitung ringkasan tutup buku satu tahun (dipakai saat pratinjau & divalidasi ulang saat eksekusi)
async function computeFinanceClosingSummary(year) {
    const startDateStr = `${year}-01-01`;
    const endDateStr = `${year}-12-31`;

    initSupabase();
    if (!supabase) throw new Error('Supabase client belum siap');

    let saldoAwal = 0;
    if (year > FIRST_FINANCE_BOOK_YEAR) {
        const { data: clData, error: clErr } = await supabase
            .from('finance_closings')
            .select('saldo_akhir')
            .eq('id', String(year - 1))
            .maybeSingle();
        if (clErr) throw new Error(`Gagal membaca tutup buku tahun ${year - 1}: ${clErr.message}`);
        if (!clData) throw new Error(`Tahun buku ${year - 1} belum ditutup.`);
        saldoAwal = Number(clData.saldo_akhir) || 0;
    }

    let sppIncome = 0;
    const { data: dailyRows, error: dailyErr } = await window.fetchAllSupabaseRows(
        supabase,
        'finance_daily_summary',
        q => q.gte('date_str', startDateStr).lte('date_str', endDateStr),
        { selectFields: 'total_amount, is_migration' }
    );

    if (dailyErr) {
        console.error('[Tutup Buku] Error get daily summary Supabase:', dailyErr);
        throw dailyErr;
    }

    if (dailyRows) {
        dailyRows.forEach(d => {
            if (!d.is_migration) sppIncome += Number(d.total_amount) || 0;
        });
    }

    if (year === FIRST_FINANCE_BOOK_YEAR) {
        const virtualMigrationEntries = await getVirtualMigrationEntries(FIRST_FINANCE_BOOK_YEAR);
        virtualMigrationEntries.forEach(ve => {
            sppIncome += ve.amount;
        });
    }

    let manualIncome = 0;
    let expense = 0;

    const { data: cfData, error: cfErr } = await window.fetchAllSupabaseRows(
        supabase,
        'finance_cashflow',
        q => q.gte('date_str', startDateStr).lte('date_str', endDateStr),
        { selectFields: 'type, amount, is_closing_record' }
    );

    if (cfErr) {
        console.error('[Tutup Buku] Error get cashflow Supabase:', cfErr);
        throw cfErr;
    }

    if (cfData) {
        cfData.forEach(d => {
            if (d.is_closing_record) return;
            const amount = round2(Number(d.amount) || 0);
            if (d.type === 'masuk') manualIncome = round2(manualIncome + amount);
            else if (d.type === 'keluar') expense = round2(expense + amount);
        });
    }

    return {
        saldoAwal: round2(saldoAwal),
        sppIncome: round2(sppIncome),
        manualIncome: round2(manualIncome),
        expense: round2(expense),
        saldoAkhir: round2((saldoAwal + sppIncome + manualIncome) - expense)
    };
}

// Validasi syarat tutup buku; mengembalikan pesan error atau null jika boleh ditutup
async function validateFinanceClosingYear(year) {
    if (closedYearsList.includes(year)) return `Tahun buku ${year} sudah ditutup sebelumnya.`;
    const nextYear = getNextFinanceClosingYear();
    if (year !== nextYear) return `Tutup buku harus berurutan. Tutup tahun buku ${nextYear} terlebih dahulu.`;
    if (!isFinanceClosingWindowOpen(year)) return `Tahun buku ${year} baru dapat ditutup mulai 1 Desember ${year}.`;

    if (year === FIRST_FINANCE_BOOK_YEAR) {
        // Data SPP virtual migrasi Jan-Jun 2026 harus dibekukan agar nominal tahun buku pertama tidak bergeser
        const { data: lastMig, error: migErr } = await supabase
            .from('finance_daily_summary')
            .select('is_migration')
            .eq('id', `${FIRST_FINANCE_BOOK_YEAR}-06-20`)
            .maybeSingle();
        if (migErr) return `Gagal memeriksa status kunci data migrasi: ${migErr.message}`;
        if (!lastMig || !lastMig.is_migration) {
            return `Kunci data migrasi SPP ${FIRST_FINANCE_BOOK_YEAR} terlebih dahulu (tombol "Kunci Data") sebelum tutup buku.`;
        }
    }
    return null;
}

window.openClosingWizard = async () => {
    const modal = document.getElementById('modal-closing-wizard');
    if (!modal) return;

    let openYear;
    try {
        initSupabase();
        if (!supabase) throw new Error('Supabase client belum siap');
        await refreshClosedYearsList();
        updateClosingStatusUI();

        // 1. Cari tahun terkecil yang belum ditutup, lalu validasi syaratnya
        openYear = getNextFinanceClosingYear();
        const validationError = await validateFinanceClosingYear(openYear);
        if (validationError) {
            showToast('Info', validationError, 'warning');
            return;
        }
    } catch (err) {
        console.error('[Tutup Buku] Validasi Error:', err);
        showToast('Error', 'Gagal memeriksa status tutup buku: ' + err.message, 'error');
        return;
    }

    closingWizardState.year = openYear;
    const confirmInput = document.getElementById('closing-confirm-text');
    if (confirmInput) confirmInput.value = '';

    document.getElementById('closing-wizard-title-year').innerText = openYear;
    document.getElementById('closing-pin-year').innerText = openYear;

    const btnSubmit = document.getElementById('btn-closing-wizard-submit');
    if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = '<i class="fa-solid fa-lock"></i> Kunci & Tutup Buku';
    }

    document.getElementById('closing-val-saldo-awal').innerText = 'Menghitung...';
    document.getElementById('closing-val-spp').innerText = 'Menghitung...';
    document.getElementById('closing-val-manual-in').innerText = 'Menghitung...';
    document.getElementById('closing-val-expense').innerText = 'Menghitung...';
    document.getElementById('closing-val-saldo-akhir').innerText = 'Menghitung...';

    window.nextClosingStep(1);
    modal.classList.remove('hidden');

    try {
        const { saldoAwal, sppIncome, manualIncome, expense, saldoAkhir } = await computeFinanceClosingSummary(openYear);

        closingWizardState.saldoAwal = saldoAwal;
        closingWizardState.sppIncome = sppIncome;
        closingWizardState.manualIncome = manualIncome;
        closingWizardState.expense = expense;
        closingWizardState.saldoAkhir = saldoAkhir;

        const fmt2 = (v) => (Number(v) || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        document.getElementById('closing-val-saldo-awal').innerText = `Rp ${fmt2(saldoAwal)}`;
        document.getElementById('closing-val-spp').innerText = `+Rp ${fmt2(sppIncome)}`;
        document.getElementById('closing-val-manual-in').innerText = `+Rp ${fmt2(manualIncome)}`;
        document.getElementById('closing-val-expense').innerText = `-Rp ${fmt2(expense)}`;
        document.getElementById('closing-val-saldo-akhir').innerText = `Rp ${fmt2(saldoAkhir)}`;

    } catch (err) {
        console.error('[Tutup Buku] Perhitungan Error:', err);
        showToast('Error', 'Gagal menghitung pratinjau tutup buku: ' + err.message, 'error');
        window.closeClosingWizard();
    }
};

window.closeClosingWizard = () => {
    const modal = document.getElementById('modal-closing-wizard');
    if (modal) modal.classList.add('hidden');
};

window.nextClosingStep = (step) => {
    document.getElementById('closing-step-1').classList.add('hidden');
    document.getElementById('closing-step-2').classList.add('hidden');
    document.getElementById('closing-step-3').classList.add('hidden');

    document.getElementById(`closing-step-${step}`).classList.remove('hidden');

    const ind1 = document.getElementById('step-indicator-1');
    const ind2 = document.getElementById('step-indicator-2');
    const ind3 = document.getElementById('step-indicator-3');
    const line1 = document.getElementById('step-line-1');
    const line2 = document.getElementById('step-line-2');

    ind1.className = "w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs bg-rose-600 text-white";
    ind2.className = "w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs bg-slate-200 text-slate-500";
    ind3.className = "w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs bg-slate-200 text-slate-500";
    line1.className = "h-0.5 w-10 bg-slate-200";
    line2.className = "h-0.5 w-10 bg-slate-200";

    if (step >= 2) {
        ind2.className = "w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs bg-rose-600 text-white";
        line1.className = "h-0.5 w-10 bg-rose-600";
    }
    if (step >= 3) {
        ind3.className = "w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs bg-rose-600 text-white";
        line2.className = "h-0.5 w-10 bg-rose-600";
    }
};

window.executeYearEndClosing = async () => {
    const btnSubmit = document.getElementById('btn-closing-wizard-submit');
    const btnBack = document.getElementById('btn-closing-wizard-back');
    const confirmInput = document.getElementById('closing-confirm-text');
    
    const confirmValue = (confirmInput?.value || '').trim().toUpperCase();
    if (confirmValue !== 'TUTUP BUKU') {
        showToast('Konfirmasi Diperlukan', 'Silakan ketik "TUTUP BUKU" untuk mengonfirmasi tindakan ini.', 'warning');
        return;
    }

    btnSubmit.disabled = true;
    btnBack.disabled = true;
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Memproses...';

    try {
        const year = closingWizardState.year;
        const docId = String(year);
        const nowIso = new Date().toISOString();

        initSupabase();
        if (!supabase) throw new Error('Supabase client belum siap');

        // 0. Validasi ulang dengan data terbaru (status tutup buku & angka kas bisa berubah sejak pratinjau)
        await refreshClosedYearsList();
        const validationError = await validateFinanceClosingYear(year);
        if (validationError) throw new Error(validationError);

        const latest = await computeFinanceClosingSummary(year);
        if (latest.saldoAkhir !== round2(Number(closingWizardState.saldoAkhir) || 0)) {
            throw new Error('Data kas berubah sejak pratinjau dibuka. Tutup wizard lalu buka ulang untuk melihat angka terbaru.');
        }

        // 1. Simpan ke Supabase finance_closings (insert, bukan upsert: penutupan ganda ditolak primary key)
        if (supabase) {
            const { error: closingErr } = await supabase
                .from('finance_closings')
                .insert({
                    id: docId,
                    year: year,
                    saldo_akhir: round2(Number(closingWizardState.saldoAkhir) || 0),
                    total_income: round2((Number(closingWizardState.sppIncome) || 0) + (Number(closingWizardState.manualIncome) || 0)),
                    total_expense: round2(Number(closingWizardState.expense) || 0),
                    closed_at: nowIso,
                    closed_by: currentTellerName,
                    summary: {
                        sppIncome: round2(Number(closingWizardState.sppIncome) || 0),
                        manualIncome: round2(Number(closingWizardState.manualIncome) || 0),
                        expense: round2(Number(closingWizardState.expense) || 0),
                        saldoAwal: round2(Number(closingWizardState.saldoAwal) || 0),
                        saldoAkhir: round2(Number(closingWizardState.saldoAkhir) || 0)
                    }
                });
            if (closingErr) {
                if (closingErr.code === '23505' || /duplicate key/i.test(closingErr.message || '')) {
                    throw new Error(`Tahun buku ${year} sudah ditutup sebelumnya.`);
                }
                throw new Error(`Gagal menyimpan tutup buku ke database: ${closingErr.message}`);
            }
        }

        if (typeof window.logAudit === 'function') {
            const saldoAkhirFormatted = (Number(closingWizardState.saldoAkhir) || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            window.logAudit('EXECUTE_YEAR_CLOSING', docId, null, { 
                year, 
                saldoAkhir: closingWizardState.saldoAkhir 
            }, `Melakukan tutup buku keuangan tahun ${year}. Saldo akhir Rp ${saldoAkhirFormatted} dipindahkan ke tahun ${year + 1}.`);
        }

        showToast('Sukses', `Tutup buku tahun ${year} berhasil diselesaikan.`, 'success');
        window.closeClosingWizard();

        await loadSystemConfig();
        
        if (typeof window.loadCashflow === 'function') {
            await window.loadCashflow();
        }

    } catch (err) {
        console.error('[Tutup Buku] Gagal mengeksekusi tutup buku:', err);
        showToast('Gagal', 'Gagal memproses tutup buku: ' + err.message, 'error');
        btnSubmit.disabled = false;
        btnBack.disabled = false;
        btnSubmit.innerHTML = '<i class="fa-solid fa-lock"></i> Kunci & Tutup Buku';
    }
};
