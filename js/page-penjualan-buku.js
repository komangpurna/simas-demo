/**
 * js/page-penjualan-buku.js
 * Modul Rekapitulasi, Transaksi Harian, Monitoring Stok & Penyelarasan Penjualan Buku dengan Guru Mapel Jadwal XML (Super Admin)
 * Single Source of Truth: PRD_SIMAS.md v1.2.134 [26.10.02.28]
 */

import { auth, SCHOOL_CONFIG } from './config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { initLayout, escapeHTML, showToast } from './global.js';
import { parseASCSchedule } from './asc-schedule-parser.js';
import { cfClient } from './cloudflare-client.js';

// Dataset Buku Pelajaran Bawaan (Kosong secara default - SSOT Dinamis dari Cloudflare D1 / LocalStorage, 0 Hardcode)
export const DEFAULT_BOOK_SALES_DATA = [];

// State Global Halaman & Penyimpanan
export const BOOK_SALES_STORAGE_KEY = 'simas_book_sales_lks_data';
export const BOOK_SALES_D1_KEY = 'book_sales_lks_data';
export const BOOK_VENDORS_STORAGE_KEY = 'simas_book_vendors_master_data';
export const BOOK_VENDORS_D1_KEY = 'book_vendors_master_data';
export const BOOK_SCHOOL_SHARE_STORAGE_KEY = 'simas_book_school_share_percentage';
export const BOOK_SCHOOL_SHARE_D1_KEY = 'book_school_share_percentage';
export const BOOK_FEE_SETTINGS_STORAGE_KEY = 'simas_book_fee_distribution_settings';
export const BOOK_FEE_SETTINGS_D1_KEY = 'book_fee_distribution_settings';

export const DEFAULT_FEE_DISTRIBUTION_SETTINGS = Object.freeze({
    feeRatePercentage: 30.0,       // Besar fee penjualan ke sekolah (30% dari total omzet penjualan)
    cooperativePercentage: 50.0,   // Alokasi koperasi sekolah (50% dari total fee sekolah)
    equalityPercentage: 25.0,      // Alokasi pool pemerataan GTK (25% dari total fee sekolah)
    teacherPercentage: 20.0,       // Alokasi insentif guru mapel proporsional (20% dari total fee sekolah)
    headmasterPercentage: 5.0,     // Alokasi insentif kepala sekolah (5% dari total fee sekolah)
    schoolPercentage: 0.0          // Alokasi kas sekolah ditiadakan (0% - murni dibagi ke koperasi, guru, pemerataan, kepsek)
});

let currentFeeDistributionSettings = { ...DEFAULT_FEE_DISTRIBUTION_SETTINGS };
let currentFeeRoleFilter = 'all'; // 'all' | 'kepsek' | 'guru' | 'tendik'
let currentFeeDistributionResult = null;

let currentMatchedData = [];
let currentTransactions = [];
let currentCirculations = [];
let currentVendors = [];
let currentCashFlows = [];
let currentSchoolSharePercentage = 0; // Persentase bagian sekolah (default 0%)
let currentParsedSchedule = null;
let currentActiveTab = 'transactions'; // 'transactions' | 'circulation' | 'stock' | 'cashflow' | 'recap' | 'analysis' | 'settings' | 'orders'
let currentRecapSubView = 'books'; // 'books' | 'teachers' | 'classes'
let currentGradeFilter = 'all'; // 'all' | '10' | '11' | '12'
let currentPeriodFilter = 'all'; // 'all' | 'today' | 'yesterday' | '7days' | 'month'
let currentCirculationFilter = 'all'; // 'all' | 'terima' | 'pengambilan_guru' | 'retur_penerbit'
let currentDemandFilter = 'all'; // 'all' | 'kurang' | 'lebih' | 'pas' | 'terpenuhi'
let currentTxTypeFilter = 'all'; // 'all' | 'sales' | 'returns'
let currentCashFlowFilter = 'all'; // 'all' | 'in' | 'out' | 'sales' | 'returns' | 'manual_in' | 'manual_out'
let currentSearchKeyword = '';
let currentClassSizes = null;
let currentSelectedSemesterPeriod = getDefaultTransactionPeriod(); // Default terbuka semester berjalan (SSOT)
let currentSettingsStatusFilter = 'all'; // 'all' | 'active' | 'inactive'
let currentOrderClassFilter = 'all'; // 'all' | rombel name (e.g. 'X-1', 'XI-1')

// Pelacak proses simpan aktif pada Tab Pengaturan (Optimistic UI & Anti-Double-Click Guard)
const pendingVisibilityToggles = new Set(); // Kunci: `${grade}_${subject}`
const pendingPriceSaves = new Set(); // Kunci: `${grade}_${subject}`

export function getPendingVisibilityToggles() {
    return new Set(pendingVisibilityToggles);
}

export function getPendingPriceSaves() {
    return new Set(pendingPriceSaves);
}

export function getOrderClassFilter() {
    return currentOrderClassFilter;
}

export function setOrderClassFilter(val) {
    currentOrderClassFilter = val || 'all';
}

export function getCurrentCashFlows() {
    return currentCashFlows;
}

export function setCurrentCashFlows(cashFlows) {
    currentCashFlows = Array.isArray(cashFlows) ? cashFlows : [];
}

export function getCurrentCashFlowFilter() {
    return currentCashFlowFilter;
}

export function setCurrentCashFlowFilter(filter) {
    currentCashFlowFilter = filter || 'all';
}

export function getCurrentRecapSubView() {
    return currentRecapSubView;
}

export function setCurrentRecapSubView(subView) {
    currentRecapSubView = subView || 'books';
}

export function getSchoolSharePercentage() {
    if (typeof currentSchoolSharePercentage === 'number' && !isNaN(currentSchoolSharePercentage)) {
        return currentSchoolSharePercentage;
    }
    if (currentFeeDistributionSettings && typeof currentFeeDistributionSettings.feeRatePercentage === 'number') {
        return currentFeeDistributionSettings.feeRatePercentage;
    }
    return 30.0;
}

export function setSchoolSharePercentage(val) {
    const parsed = parseFloat(val);
    const num = isNaN(parsed) || parsed < 0 ? 0 : Math.min(100, Math.round(parsed * 100) / 100);
    currentSchoolSharePercentage = num;
    if (currentFeeDistributionSettings) {
        currentFeeDistributionSettings.feeRatePercentage = num;
    }
}

export function getFeeDistributionSettings() {
    return { ...currentFeeDistributionSettings };
}

export function setFeeDistributionSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    const cleanNum = (val, def) => {
        const p = parseFloat(val);
        return isNaN(p) || p < 0 ? def : Math.min(100, Math.round(p * 1000000) / 1000000);
    };

    const feeRate = cleanNum(
        settings.feeRatePercentage != null ? settings.feeRatePercentage : (settings.schoolPercentage && settings.schoolPercentage > 0 ? settings.schoolPercentage : null),
        DEFAULT_FEE_DISTRIBUTION_SETTINGS.feeRatePercentage
    );
    const sPct = 0.0; // Kas sekolah ditiadakan dari sub-komponen (0% - murni dibagi ke 4 kartu)
    const ePct = cleanNum(settings.equalityPercentage, DEFAULT_FEE_DISTRIBUTION_SETTINGS.equalityPercentage);
    const hPct = cleanNum(settings.headmasterPercentage, DEFAULT_FEE_DISTRIBUTION_SETTINGS.headmasterPercentage);
    const tPct = cleanNum(settings.teacherPercentage, DEFAULT_FEE_DISTRIBUTION_SETTINGS.teacherPercentage);

    // Koperasi Sekolah otomatis menjadi penampung sisa alokasi 100% dari 3 kartu lainnya
    const otherSum = ePct + hPct + tPct;
    const cPct = Math.max(0, Math.round((100 - otherSum) * 1000000) / 1000000);

    currentFeeDistributionSettings = {
        feeRatePercentage: feeRate,
        schoolPercentage: sPct,
        cooperativePercentage: cPct,
        equalityPercentage: ePct,
        headmasterPercentage: hPct,
        teacherPercentage: tPct,
        equalityPerPerson: (settings.equalityPerPerson != null && !isNaN(settings.equalityPerPerson) && settings.equalityPerPerson > 0) ? Math.round(settings.equalityPerPerson) : null,
        equalityPool: (settings.equalityPool != null && !isNaN(settings.equalityPool) && settings.equalityPool > 0) ? Math.round(settings.equalityPool) : null,
        headmasterAmount: (settings.headmasterAmount != null && !isNaN(settings.headmasterAmount) && settings.headmasterAmount > 0) ? Math.round(settings.headmasterAmount) : null
    };

    // Sinkronkan legacy currentSchoolSharePercentage agar Card Rekap per Guru & test 82 tetap presisi
    currentSchoolSharePercentage = feeRate;
}

export function getFeeRoleFilter() {
    return currentFeeRoleFilter;
}

export function setFeeRoleFilter(filter) {
    currentFeeRoleFilter = filter || 'all';
}

export function getCurrentFeeDistributionResult() {
    return currentFeeDistributionResult;
}

export function setCurrentFeeDistributionResult(res) {
    currentFeeDistributionResult = res;
}

export function getCurrentVendors() {
    return currentVendors;
}

export function setCurrentVendors(vendors) {
    currentVendors = Array.isArray(vendors) ? vendors : [];
}

export function getCurrentTxTypeFilter() {
    return currentTxTypeFilter;
}

export function setCurrentTxTypeFilter(filter) {
    currentTxTypeFilter = filter || 'all';
}

export function setCurrentBookData(data) {
    currentMatchedData = Array.isArray(data) ? data : [];
}

export function getCurrentBookData() {
    return currentMatchedData;
}

export function setCurrentTransactions(txs) {
    currentTransactions = Array.isArray(txs) ? txs : [];
}

export function getCurrentTransactions() {
    return currentTransactions;
}

export function setCurrentClassOrders(orders) {
    currentClassOrders = Array.isArray(orders) ? orders : [];
}

export function getCurrentClassOrders() {
    return currentClassOrders;
}

export function getCurrentSelectedSemesterPeriod() {
    return currentSelectedSemesterPeriod || getDefaultTransactionPeriod();
}

export function setCurrentSelectedSemesterPeriod(period) {
    currentSelectedSemesterPeriod = (period && period !== 'all') ? period : getDefaultTransactionPeriod();
}

export function getCurrentSettingsStatusFilter() {
    return currentSettingsStatusFilter;
}

export function setCurrentSettingsStatusFilter(filter) {
    currentSettingsStatusFilter = filter || 'all';
}

/**
 * Mendapatkan Periode Transaksi Default Sekolah (SSOT Tahun Ajaran & Semester)
 */
export function getDefaultTransactionPeriod() {
    if (typeof window !== 'undefined' && typeof window.getCurrentAcademicYearString === 'function' && typeof window.getCurrentSemester === 'function') {
        const ay = window.getCurrentAcademicYearString();
        const sem = window.getCurrentSemester() === '1' ? 'Ganjil' : 'Genap';
        return `${ay} ${sem}`;
    }
    const d = new Date();
    const m = d.getMonth();
    const y = d.getFullYear();
    const startY = m >= 6 ? y : y - 1;
    const sem = m >= 6 ? 'Ganjil' : 'Genap';
    return `${startY}/${startY + 1} ${sem}`;
}

/**
 * Mendapatkan string periode 1 semester ke depan dari periode yang diberikan (untuk persiapan semester mendatang)
 * Contoh: "2026/2027 Ganjil" -> "2026/2027 Genap"
 * Contoh: "2026/2027 Genap"  -> "2027/2028 Ganjil"
 */
export function getNextSemesterPeriod(period = getDefaultTransactionPeriod()) {
    if (!period || typeof period !== 'string') return '';
    const match = period.match(/^(\d{4})\/(\d{4})\s+(Ganjil|Genap)$/);
    if (!match) return '';
    const startYear = parseInt(match[1], 10);
    const isGenap = match[3] === 'Genap';
    if (isGenap) {
        return `${startYear + 1}/${startYear + 2} Ganjil`;
    } else {
        return `${startYear}/${startYear + 1} Genap`;
    }
}

/**
 * Mengumpulkan daftar seluruh periode transaksi yang tersedia secara dinamis
 * Dari 1 semester ke depan (untuk persiapan semester mendatang), semester aktif berjalan,
 * hingga mundur ke 2 tahun sebelumnya (urutan menurun).
 */
export function getAvailableTransactionPeriods() {
    const defaultPeriod = getDefaultTransactionPeriod();
    const periods = [];
    const match = defaultPeriod.match(/^(\d{4})\/(\d{4})\s+(Ganjil|Genap)$/);
    if (match) {
        const currentStartYear = parseInt(match[1], 10);
        const isGenap = match[3] === 'Genap';

        // 1 Semester ke depan untuk persiapan semester mendatang
        if (isGenap) {
            periods.push(`${currentStartYear + 1}/${currentStartYear + 2} Ganjil`);
            periods.push(`${currentStartYear}/${currentStartYear + 1} Genap`);
            periods.push(`${currentStartYear}/${currentStartYear + 1} Ganjil`);
        } else {
            periods.push(`${currentStartYear}/${currentStartYear + 1} Genap`);
            periods.push(`${currentStartYear}/${currentStartYear + 1} Ganjil`);
        }

        // Mundur 2 tahun ajaran ke belakang (urutan menurun)
        for (let y = currentStartYear - 1; y >= currentStartYear - 2; y--) {
            periods.push(`${y}/${y + 1} Genap`);
            periods.push(`${y}/${y + 1} Ganjil`);
        }
    } else {
        periods.push(defaultPeriod);
    }

    return periods;
}

/**
 * Memformat string periode semester menjadi format sederhana/ringkas (contoh: "2026/2027 Ganjil" -> "26/27 (1)")
 * Sesuai konvensi akademik: 2 digit tahun ajaran dan nomor semester (Ganjil: 1, Genap: 2)
 */
export function formatSemesterPeriodShort(period) {
    if (!period || typeof period !== 'string') return '';
    const match = period.match(/^(\d{2,4})\/(\d{2,4})\s*(?:\((1|2)\)|(1|2)|(Ganjil|Genap))$/i);
    if (!match) return period;
    const y1 = match[1].slice(-2);
    const y2 = match[2].slice(-2);
    let semNum = '1';
    const s = (match[3] || match[4] || match[5] || '').toLowerCase();
    if (s === 'genap' || s === '2') {
        semNum = '2';
    } else {
        semNum = '1';
    }
    return `${y1}/${y2} (${semNum})`;
}

/**
 * Mengecek apakah dua string periode semester cocok secara semantik (mendukung format panjang & format ringkas)
 */
export function isPeriodMatch(p1, p2) {
    if (!p1 || !p2) return false;
    if (p1 === p2) return true;
    if (p1 === 'all' || p2 === 'all') return true;
    return formatSemesterPeriodShort(p1) === formatSemesterPeriodShort(p2);
}

export function setCurrentClassSizes(sizes) {
    currentClassSizes = sizes && typeof sizes === 'object' ? sizes : null;
}

export function getCurrentClassSizes() {
    return currentClassSizes;
}

export function setCurrentParsedSchedule(schedule) {
    currentParsedSchedule = schedule;
}

export function getCurrentParsedSchedule() {
    return currentParsedSchedule;
}

/**
 * Normalisasi nama untuk pencocokan teks toleran
 */
export function normalizeKey(text) {
    if (!text || typeof text !== 'string') return '';
    return text.toLowerCase()
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Membersihkan gelar akademik dari nama untuk pencocokan toleran GTK & Jadwal
 */
export function cleanAcademicTitle(text) {
    if (!text || typeof text !== 'string') return '';
    return text.toLowerCase()
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\b(s\s*pd|m\s*pd|m\s*pd\s*h|s\s*ag|s\s*e|a\s*md\s*kom|s\s*kom|s\s*ak|s\s*h|gr|dr|drs|dra)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Pembersih angka dari string mata uang (Rp, titik, koma)
 */
export function parseNumberSafe(val, fallback = 0) {
    if (val === null || val === undefined || val === '') return fallback;
    if (typeof val === 'number') return isNaN(val) ? fallback : val;
    const clean = String(val).replace(/[^0-9\-]/g, '');
    if (!clean) return fallback;
    const n = parseInt(clean, 10);
    return isNaN(n) ? fallback : n;
}

/**
 * Format mata uang Rupiah
 */
export function formatRupiah(amount) {
    const num = parseNumberSafe(amount);
    return 'Rp ' + num.toLocaleString('id-ID');
}

/**
 * Format input nominal mata uang secara interaktif (live typing) dengan pemisah ribuan (id-ID)
 * Mempertahankan posisi kursor pengetikan pengguna secara presisi.
 */
export function formatCurrencyInput(target) {
    if (target === null || target === undefined) return '';
    if (typeof target === 'object' && 'value' in target) {
        const val = target.value;
        if (val === null || val === undefined) {
            target.value = '';
            return '';
        }
        const strVal = String(val);
        if (!strVal.trim()) {
            target.value = '';
            return '';
        }

        const cursorPos = typeof target.selectionStart === 'number' ? target.selectionStart : strVal.length;
        const beforeCursor = strVal.slice(0, cursorPos);
        const digitsBefore = (beforeCursor.match(/\d/g) || []).length;

        const rawDigits = strVal.replace(/\D/g, '');
        if (!rawDigits) {
            target.value = '';
            return '';
        }

        const num = parseInt(rawDigits, 10);
        const formatted = num.toLocaleString('id-ID');
        target.value = formatted;

        if (typeof target.setSelectionRange === 'function') {
            let newCursor = 0;
            let counted = 0;
            for (let i = 0; i < formatted.length; i++) {
                if (/\d/.test(formatted[i])) {
                    counted++;
                }
                if (counted >= digitsBefore) {
                    newCursor = i + 1;
                    break;
                }
            }
            if (counted < digitsBefore) newCursor = formatted.length;
            target.setSelectionRange(newCursor, newCursor);
        }
        return formatted;
    }

    if (target === '') return '0';
    const num = parseNumberSafe(target, 0);
    return num.toLocaleString('id-ID');
}

/**
 * Konversi angka jenjang (10, 11, 12) ke angka Romawi (X, XI, XII)
 * Sesuai standar penamaan rombel kelas SMAGESA (SSOT)
 */
export function getGradeRoman(grade) {
    if (!grade && grade !== 0) return '';
    const g = parseInt(grade, 10);
    if (g === 10) return 'X';
    if (g === 11) return 'XI';
    if (g === 12) return 'XII';
    const str = String(grade).trim().toUpperCase();
    if (str === 'X' || str === '10') return 'X';
    if (str === 'XI' || str === '11') return 'XI';
    if (str === 'XII' || str === '12') return 'XII';
    return str;
}

/**
 * Mengecek apakah suatu transaksi adalah transaksi retur (siswa batal beli)
 */
export function isReturnTx(tx) {
    return Boolean(tx && (tx.type === 'return' || tx.type === 'retur' || tx.isReturn === true));
}

/**
 * Menghitung qty bersih transaksi: negatif untuk retur, positif untuk penjualan
 */
export function txNetQty(tx) {
    if (!tx) return 0;
    const q = parseNumberSafe(tx.qty, 0);
    return isReturnTx(tx) ? -Math.abs(q) : Math.abs(q);
}

/**
 * Menghitung nominal rupiah bersih transaksi: negatif untuk refund retur, positif untuk penjualan
 */
export function txNetTotal(tx) {
    if (!tx) return 0;
    const t = parseNumberSafe(tx.total, 0);
    return isReturnTx(tx) ? -Math.abs(t) : Math.abs(t);
}

/**
 * Menghitung total eksemplar yang sudah diretur dari sebuah transaksi penjualan
 */
export function getReturnedQtyForTx(txId) {
    if (!txId) return 0;
    return currentTransactions
        .filter(t => isReturnTx(t) && t.refTxId === txId)
        .reduce((sum, r) => sum + parseNumberSafe(r.qty, 0), 0);
}

/**
 * Menghitung sisa eksemplar dari sebuah transaksi penjualan yang masih dapat diretur
 */
export function getReturnableQty(tx) {
    if (!tx || isReturnTx(tx)) return 0;
    const origQty = parseNumberSafe(tx.qty, 0);
    const returned = getReturnedQtyForTx(tx.id);
    return Math.max(0, origQty - returned);
}

/**
 * Menghitung ringkasan akuntansi transaksi (kotor, retur/refund, dan bersih/net)
 */
export function summarizeTransactions(txList) {
    const list = Array.isArray(txList) ? txList : [];
    let grossQty = 0;
    let grossNom = 0;
    let returnQty = 0;
    let returnNom = 0;

    list.forEach(tx => {
        const q = parseNumberSafe(tx.qty, 0);
        const nom = parseNumberSafe(tx.total, 0);
        if (isReturnTx(tx)) {
            returnQty += q;
            returnNom += nom;
        } else {
            grossQty += q;
            grossNom += nom;
        }
    });

    const netQty = Math.max(0, grossQty - returnQty);
    const netNom = Math.max(0, grossNom - returnNom);

    return {
        count: list.length,
        grossQty,
        grossNom,
        returnQty,
        returnNom,
        netQty,
        netNom,
        netTotal: netNom
    };
}

/**
 * Parse teks data penjualan yang di-paste oleh user
 * Mendukung copy-paste TSV dari Excel:
 * Format 6 Kolom Utama (User Request):
 * KELAS | MAPEL | DITERIMA | DIAMBIL (SIAMBIL) | SISA | HARGA JUAL
 * Sistem otomatis menghitung:
 * Terjual = Math.max(0, Diterima - Diambil - Sisa)
 * Total Penjualan = Terjual * Harga Jual
 */
export function parseBookSalesText(rawText) {
    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
        return [];
    }

    const lines = rawText.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const results = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Deteksi pemisah: tab, semicolon, atau spasi ganda
        let parts = [];
        if (line.includes('\t')) {
            parts = line.split('\t').map(p => p.trim());
        } else if (line.includes(';')) {
            parts = line.split(';').map(p => p.trim());
        } else {
            // Regex pemisah 2 spasi atau lebih
            parts = line.split(/\s{2,}/).map(p => p.trim());
        }

        // Filter kosong
        if (parts.length < 2) continue;

        // Skip jika baris adalah header (mengandung kata 'kelas' dan 'buku' / 'mapel')
        const firstCol = parts[0].toLowerCase();
        const secondCol = (parts[1] || '').toLowerCase();
        if ((firstCol.includes('kelas') || firstCol === 'k') && (secondCol.includes('buku') || secondCol.includes('mapel') || secondCol.includes('mata pelajaran') || secondCol.includes('judul'))) {
            continue;
        }

        // Ekstraksi Jenjang Kelas: 10, 11, 12 atau Romawi X, XI, XII
        let grade = 10;
        const cleanGrade = parts[0].trim().toUpperCase().replace(/^(KELAS|KLS|K)\s*/i, '').trim();
        if (/^(12|XII)$/.test(cleanGrade) || cleanGrade.includes('12') || cleanGrade.includes('XII')) grade = 12;
        else if (/^(11|XI)$/.test(cleanGrade) || cleanGrade.includes('11') || cleanGrade.includes('XI')) grade = 11;
        else if (/^(10|X)$/.test(cleanGrade) || cleanGrade.includes('10') || cleanGrade.includes('X')) grade = 10;
        else {
            const numM = cleanGrade.match(/\d+/);
            if (numM) grade = parseInt(numM[0], 10);
        }

        const subject = parts[1] || '';
        if (!subject) continue;

        // Deteksi & Ekstraksi Kolom:
        let terima = 0;
        let diam = 0;
        let sisa = 0;
        let terjual = 0;
        let harga = 0;
        let total = 0;

        if (parts.length >= 8) {
            // Format 8 Kolom: Kelas | Mapel | Terima | Diam | Sisa | Terjual | Harga | Total
            terima = parseNumberSafe(parts[2]);
            diam = parseNumberSafe(parts[3]);
            sisa = parseNumberSafe(parts[4]);
            terjual = parseNumberSafe(parts[5]);
            harga = parseNumberSafe(parts[6]);
            total = parseNumberSafe(parts[7]);
        } else if (parts.length === 7) {
            // Format 7 Kolom: Kelas | Mapel | Terima | Diam | Sisa | Terjual | Harga
            terima = parseNumberSafe(parts[2]);
            diam = parseNumberSafe(parts[3]);
            sisa = parseNumberSafe(parts[4]);
            terjual = parseNumberSafe(parts[5]);
            harga = parseNumberSafe(parts[6]);
            total = terjual * harga;
        } else if (parts.length === 6) {
            // FORMAT 6 KOLOM UTAMA (Sesuai Permintaan User):
            // [0] KELAS | [1] MAPEL | [2] DITERIMA | [3] DIAMBIL (SIAMBIL) | [4] SISA | [5] HARGA JUAL
            terima = parseNumberSafe(parts[2]);
            diam = parseNumberSafe(parts[3]);
            sisa = parseNumberSafe(parts[4]);
            harga = parseNumberSafe(parts[5]);
            terjual = Math.max(0, terima - diam - sisa);
            total = terjual * harga;
        } else if (parts.length === 5) {
            // Format 5 Kolom: Kelas | Mapel | Diterima | Sisa | Harga Jual
            terima = parseNumberSafe(parts[2]);
            diam = 0;
            sisa = parseNumberSafe(parts[3]);
            harga = parseNumberSafe(parts[4]);
            terjual = Math.max(0, terima - sisa);
            total = terjual * harga;
        } else if (parts.length >= 3) {
            terima = parseNumberSafe(parts[2]);
            harga = parseNumberSafe(parts[3] || 0);
            terjual = terima;
            total = terjual * harga;
        }

        // Kalkulasi konsistensi
        if (terjual === 0 && terima > 0 && (terima - diam - sisa) > 0) {
            terjual = Math.max(0, terima - diam - sisa);
        }
        if (total === 0 && terjual > 0 && harga > 0) {
            total = terjual * harga;
        }

        results.push({
            grade,
            subject,
            terima,
            diam,
            sisa,
            terjual,
            harga,
            total
        });
    }

    return results;
}

/**
 * Kamus Alias dan Pemetaan Mata Pelajaran Buku <-> Jadwal XML
 */
export const SUBJECT_ALIAS_MAP = {
    'pkwu': 'prakarya dan kewirausahaan',
    'prakarya dan kewirausahaan': 'prakarya dan kewirausahaan',
    'seni rupa': 'seni budaya',
    'seni tari': 'seni budaya',
    'seni teater': 'seni budaya',
    'seni musik': 'seni budaya',
    'seni budaya': 'seni budaya',
    'bahasa indonesia tingkat lanjut': 'bahasa indonesia tk lanjut',
    'bahasa indonesia tk lanjut': 'bahasa indonesia tk lanjut',
    'bahasa inggris tingkat lanjut': 'bahasa inggris tk lanjut',
    'bahasa inggris tk lanjut': 'bahasa inggris tk lanjut',
    'matematika tingkat lanjut': 'matematika tingkat lanjut',
    'sejarah tingkat lanjut': 'sejarah tingkat lanjut',
    'pendidikan pancasila': 'pendidikan pancasila',
    'agama dan budi pekerti': 'agama dan budi pekerti',
    'bahasa bali': 'bahasa bali',
    'kearifan lokal bali': 'bahasa bali'
};

/**
 * Deteksi apakah suatu mata pelajaran merupakan mapel Tingkat Lanjut / Peminatan
 * Mencegah kontaminasi greedy substring match antara mapel wajib reguler dan tingkat lanjut
 */
export function isAdvancedSubject(normName) {
    if (!normName) return false;
    const str = normName.toString().toLowerCase();
    return str.includes('tingkat lanjut') || str.includes('tk lanjut') || str.includes('lanjut');
}

/**
 * Pencocokan toleran dua nama mata pelajaran buku (langsung atau via kamus alias)
 */
export function isBookSubjectMatch(sub1, sub2) {
    if (!sub1 || !sub2) return false;
    const n1 = normalizeKey(sub1);
    const n2 = normalizeKey(sub2);
    if (n1 === n2) return true;

    const a1 = SUBJECT_ALIAS_MAP[n1] || n1;
    const a2 = SUBJECT_ALIAS_MAP[n2] || n2;
    if (a1 === a2) return true;

    // Alias khusus mapel
    if ((n1 === 'pkwu' || n1.includes('prakarya')) && (n2 === 'pkwu' || n2.includes('prakarya'))) return true;
    if ((n1.includes('seni budaya') || n1.includes('seni tari') || n1.includes('seni rupa') || n1.includes('seni musik')) &&
        (n2.includes('seni budaya') || n2.includes('seni tari') || n2.includes('seni rupa') || n2.includes('seni musik'))) return true;
    if ((n1.includes('bahasa bali') || n1.includes('kearifan lokal bali')) &&
        (n2.includes('bahasa bali') || n2.includes('kearifan lokal bali'))) return true;

    // Substring match toleran hanya jika status advance sama
    if (isAdvancedSubject(n1) === isAdvancedSubject(n2)) {
        if (n1.includes(n2) || n2.includes(n1)) return true;
        if (a1.includes(a2) || a2.includes(a1)) return true;
    }
    return false;
}

/**
 * Menghitung dan menyelaraskan eksemplar terjual serta total nominal penjualan setiap buku
 * berdasarkan riwayat transaksi aktual (currentTransactions) sesuai periode semester yang dipilih
 */
export function getBooksWithPeriodSales(booksList = currentMatchedData, transactionsList = currentTransactions, selectedPeriod = currentSelectedSemesterPeriod) {
    const defaultPeriod = getDefaultTransactionPeriod();
    const books = (Array.isArray(booksList) ? booksList : []).filter(b => b.isActive !== false);
    const txs = Array.isArray(transactionsList) ? transactionsList : [];

    return books.map(book => {
        let rowTerjual = parseNumberSafe(book.terjual, 0);
        let rowNominal = parseNumberSafe(book.total, 0);
        let teachers = book.teachers;

        if (txs.length > 0) {
            const bookTxs = txs.filter(t => {
                const p = t.periode || defaultPeriod;
                const periodMatches = (!selectedPeriod || selectedPeriod === 'all') || isPeriodMatch(p, selectedPeriod);
                const gradeMatches = String(t.grade) === String(book.grade);
                const subjectMatches = normalizeKey(t.subject) === normalizeKey(book.subject) || isBookSubjectMatch(t.subject, book.subject);
                return periodMatches && gradeMatches && subjectMatches;
            });

            if (bookTxs.length > 0) {
                const bSum = summarizeTransactions(bookTxs);
                rowTerjual = bSum.netQty;
                rowNominal = (typeof bSum.netNom === 'number' ? bSum.netNom : (bSum.netTotal || 0));
                if (rowNominal <= 0 && rowTerjual > 0 && (book.harga || 0) > 0) {
                    rowNominal = rowTerjual * book.harga;
                }
            } else if (selectedPeriod && selectedPeriod !== 'all') {
                rowTerjual = 0;
                rowNominal = 0;
            }
        }

        if (!rowNominal && rowTerjual > 0 && (book.harga || 0) > 0) {
            rowNominal = rowTerjual * book.harga;
        }

        if (Array.isArray(book.teachers) && book.teachers.length > 0) {
            let allocatedT = 0;
            let allocatedN = 0;
            teachers = book.teachers.map((t, idx) => {
                const isLast = idx === book.teachers.length - 1;
                const ratio = (t.classCount && t.totalClasses) ? (t.classCount / t.totalClasses) : (1 / book.teachers.length);
                let propTerjual = Math.round(ratio * rowTerjual);
                let propNominal = Math.round(ratio * rowNominal);
                if (isLast) {
                    propTerjual = Math.max(0, rowTerjual - allocatedT);
                    propNominal = Math.max(0, rowNominal - allocatedN);
                } else {
                    allocatedT += propTerjual;
                    allocatedN += propNominal;
                }
                return {
                    ...t,
                    propTerjual,
                    propNominal
                };
            });
        } else if (currentParsedSchedule) {
            const schedMap = buildScheduleGradeMap(currentParsedSchedule);
            teachers = findTeachersForBookSales(book.grade, book.subject, schedMap, rowTerjual, rowNominal);
        }

        const rowSisa = Math.max(0, (book.terima || 0) - (book.diam || 0) - (book.retur || 0) - rowTerjual);

        return {
            ...book,
            terjual: rowTerjual,
            total: rowNominal,
            sisa: rowSisa,
            teachers
        };
    });
}

/**
 * Bangun peta pengajar berdasarkan Jadwal XML:
 * Grade (10/11/12) -> Mapel -> Guru Pengajar berserta rombel yang diampu
 */
export function buildScheduleGradeMap(parsedSchedule) {
    if (!parsedSchedule) return { 10: {}, 11: {}, 12: {} };
    const { subjectsMap, teachersMap, classesMap, lessonsMap } = parsedSchedule;
    const gradeMap = { 10: {}, 11: {}, 12: {} };

    if (!lessonsMap) return gradeMap;

    lessonsMap.forEach(lesson => {
        const subObj = subjectsMap ? subjectsMap.get(lesson.subjectId) : null;
        const subName = subObj ? subObj.name : (lesson.subjectId || '');

        const teacherNames = (lesson.teacherIds || []).map(tid => {
            const tObj = teachersMap ? teachersMap.get(tid) : null;
            return tObj ? (tObj.simasName || tObj.name || tid) : tid;
        });

        (lesson.classIds || []).forEach(cid => {
            const clsObj = classesMap ? classesMap.get(cid) : null;
            const clsName = clsObj ? clsObj.name : cid;

            let grade = null;
            if (clsName.startsWith('X-') && !clsName.startsWith('XI-') && !clsName.startsWith('XII-')) grade = 10;
            else if (clsName.startsWith('XI-')) grade = 11;
            else if (clsName.startsWith('XII-')) grade = 12;

            if (grade) {
                if (!gradeMap[grade][subName]) gradeMap[grade][subName] = {};
                teacherNames.forEach(tName => {
                    if (!gradeMap[grade][subName][tName]) {
                        gradeMap[grade][subName][tName] = new Set();
                    }
                    gradeMap[grade][subName][tName].add(clsName);
                });
            }
        });
    });

    return gradeMap;
}

/**
 * Pencocokan Cerdas Guru Pengajar untuk Baris Buku beserta Pembagian Beban Kelas Proporsional
 */
export function findTeachersForBookSales(grade, bookTitle, scheduleGradeMap, totalTerjual = 0, totalNominal = 0) {
    const gradeSubs = (scheduleGradeMap && scheduleGradeMap[grade]) ? scheduleGradeMap[grade] : {};
    const normBook = normalizeKey(bookTitle);
    const targetAlias = SUBJECT_ALIAS_MAP[normBook] || normBook;

    let matchedEntry = null;

    // 1. Cek Exact Alias / Direct Name Match
    for (const [subName, tMap] of Object.entries(gradeSubs)) {
        const normSub = normalizeKey(subName);
        if (normSub === targetAlias || normSub === normBook) {
            matchedEntry = tMap;
            break;
        }
    }

    // 2. Cek Substring / Includes Match
    if (!matchedEntry) {
        for (const [subName, tMap] of Object.entries(gradeSubs)) {
            const normSub = normalizeKey(subName);
            if (normSub.includes(targetAlias) || targetAlias.includes(normSub)) {
                matchedEntry = tMap;
                break;
            }
        }
    }

    // 3. Fallback Khusus Bahasa Bali di Kelas 12 -> Kearifan Lokal Bali
    if (!matchedEntry && normBook.includes('bahasa bali') && gradeSubs['Kearifan Lokal Bali']) {
        matchedEntry = gradeSubs['Kearifan Lokal Bali'];
    }

    // 4. Fallback Matematika Tingkat Lanjut di Kelas 12 -> Guru Matematika
    if (!matchedEntry && parseInt(grade, 10) === 12 && normBook.includes('matematika') && gradeSubs['Matematika']) {
        matchedEntry = gradeSubs['Matematika'];
    }

    if (!matchedEntry) return [];

    // Hitung total rombel unik yang diajar pada jenjang tersebut
    const allUniqueClasses = new Set();
    Object.values(matchedEntry).forEach(clsSet => {
        clsSet.forEach(c => allUniqueClasses.add(c));
    });

    const totalClasses = allUniqueClasses.size || 1;
    const entries = Object.entries(matchedEntry);

    let allocatedTerjual = 0;
    let allocatedNominal = 0;

    return entries.map(([teacher, clsSet], idx) => {
        const classCount = clsSet.size;
        const percentage = Number(((classCount / totalClasses) * 100).toFixed(2));
        const percentageStr = (percentage % 1 === 0 ? percentage.toFixed(0) : percentage.toFixed(1)) + '%';
        const isLast = idx === entries.length - 1;

        let propTerjual = Math.round((classCount / totalClasses) * totalTerjual);
        let propNominal = Math.round((classCount / totalClasses) * totalNominal);

        // Rekonsiliasi pembulatan agar total proporsional persis sama dengan total buku
        if (isLast) {
            propTerjual = Math.max(0, totalTerjual - allocatedTerjual);
            propNominal = Math.max(0, totalNominal - allocatedNominal);
        } else {
            allocatedTerjual += propTerjual;
            allocatedNominal += propNominal;
        }

        return {
            teacher,
            classes: Array.from(clsSet).sort(),
            classesStr: Array.from(clsSet).sort().join(', '),
            classCount,
            totalClasses,
            percentage,
            percentageStr,
            propTerjual,
            propNominal
        };
    });
}

/**
 * Sandingkan Seluruh Baris Data Penjualan Buku dengan Guru dari Jadwal XML
 */
export function matchBookSalesWithSchedule(salesList, parsedSchedule) {
    const scheduleGradeMap = buildScheduleGradeMap(parsedSchedule);

    return salesList.map(item => {
        const teachers = findTeachersForBookSales(item.grade, item.subject, scheduleGradeMap, item.terjual, item.total);
        const teacherNamesStr = teachers.length > 0
            ? teachers.map(t => `${t.teacher} (${t.classCount}/${t.totalClasses} kls - ${t.percentageStr}: ${t.propTerjual} eks / ${formatRupiah(t.propNominal)})`).join('; ')
            : 'Belum terpetakan di Jadwal XML';

        return {
            ...item,
            teachers,
            teacherNamesStr
        };
    });
}

/**
 * Agregasi Penjualan Buku per Guru Pengajar secara Proporsional
 */
export function aggregateSalesByTeacher(matchedList) {
    const teacherMap = {};

    matchedList.forEach(item => {
        const teachers = item.teachers || [];
        if (teachers.length === 0) {
            const key = 'Guru Belum Terpetakan';
            if (!teacherMap[key]) {
                teacherMap[key] = {
                    teacherName: key,
                    books: [],
                    totalTerjual: 0,
                    totalNominal: 0
                };
            }
            teacherMap[key].books.push({
                grade: item.grade,
                subject: item.subject,
                classesStr: '-',
                classCount: 0,
                totalClasses: 0,
                percentageStr: '0%',
                propTerjual: item.terjual,
                propNominal: item.total
            });
            teacherMap[key].totalTerjual += item.terjual;
            teacherMap[key].totalNominal += item.total;
            return;
        }

        teachers.forEach(t => {
            const rawTeacher = String(t.teacher || '').trim();
            const key = normalizeKey(rawTeacher) || rawTeacher;
            if (!teacherMap[key]) {
                teacherMap[key] = {
                    teacherName: rawTeacher,
                    books: [],
                    totalTerjual: 0,
                    totalNominal: 0
                };
            }

            const pTerjual = typeof t.propTerjual === 'number' ? t.propTerjual : (item.terjual || 0);
            const pNominal = typeof t.propNominal === 'number' ? t.propNominal : (item.total || 0);

            teacherMap[key].books.push({
                grade: item.grade,
                subject: item.subject,
                classesStr: t.classesStr || '-',
                classCount: t.classCount || 0,
                totalClasses: t.totalClasses || 0,
                percentage: t.percentage || 0,
                percentageStr: t.percentageStr || '100%',
                propTerjual: pTerjual,
                propNominal: pNominal
            });
            teacherMap[key].totalTerjual += pTerjual;
            teacherMap[key].totalNominal += pNominal;
        });
    });

    return Object.values(teacherMap).sort((a, b) => b.totalNominal - a.totalNominal);
}

// ==========================================
// LOOKUP & HELPER ROMBEL, MAPEL & STOK
// ==========================================

export function getClassesForGrade(grade) {
    const g = parseInt(grade, 10);
    if (currentParsedSchedule && currentParsedSchedule.classesMap) {
        const prefix = g === 10 ? 'X-' : g === 11 ? 'XI-' : 'XII-';
        const classes = [];
        for (const cObj of currentParsedSchedule.classesMap.values()) {
            const name = cObj ? (cObj.name || '') : '';
            if (name.startsWith(prefix) && (g !== 10 || (!name.startsWith('XI-') && !name.startsWith('XII-')))) {
                classes.push(name);
            }
        }
        if (classes.length > 0) {
            return classes.sort((a, b) => {
                const numA = parseInt(a.replace(/[^0-9]/g, ''), 10) || 0;
                const numB = parseInt(b.replace(/[^0-9]/g, ''), 10) || 0;
                return numA - numB;
            });
        }
    }

    if (g === 10) {
        return ['X-1', 'X-2', 'X-3', 'X-4', 'X-5', 'X-6', 'X-7', 'X-8', 'X-9'];
    } else if (g === 11) {
        return ['XI-1', 'XI-2', 'XI-3', 'XI-4', 'XI-5', 'XI-6', 'XI-7', 'XI-8', 'XI-9', 'XI-10'];
    } else if (g === 12) {
        return ['XII-1', 'XII-2', 'XII-3', 'XII-4', 'XII-5', 'XII-6', 'XII-7', 'XII-8', 'XII-9'];
    }
    return [];
}

export function getSubjectsForGrade(grade, includeInactive = false) {
    const g = parseInt(grade, 10);
    const subjectsSet = new Set();

    // 1. Ambil dari master buku yang tersimpan
    if (currentMatchedData && currentMatchedData.length > 0) {
        currentMatchedData
            .filter(b => b.grade === g && (includeInactive || b.isActive !== false))
            .forEach(b => subjectsSet.add(b.subject));
    }

    // 2. Ambil juga seluruh mapel dari Jadwal XML untuk jenjang ini
    if (currentParsedSchedule) {
        const schedMap = buildScheduleGradeMap(currentParsedSchedule);
        if (schedMap && schedMap[g]) {
            const excluded = new Set(['upacara', 'ekstrakurikuler', 'bimbingan dan konseling']);
            for (const subName of Object.keys(schedMap[g])) {
                if (excluded.has(subName.toLowerCase())) continue;
                const matchedBook = findBookEntry(g, subName);
                if (matchedBook) {
                    if (includeInactive || matchedBook.isActive !== false) {
                        subjectsSet.add(matchedBook.subject);
                    }
                } else {
                    subjectsSet.add(subName);
                }
            }
        }
    }

    return Array.from(subjectsSet).sort();
}

/**
 * Mengambil daftar mata pelajaran resmi dari Jadwal XML yang DIAJARKAN KHUSUS di rombel/kelas terpilih.
 * Seluruh mapel kelas ditampilkan, KECUALI yang sengaja dinonaktifkan/disembunyikan di Tab Pengaturan.
 */
export function getSubjectsForClass(grade, className) {
    const g = parseInt(grade, 10);

    if (currentParsedSchedule && currentParsedSchedule.lessonsMap && currentParsedSchedule.classesMap && currentParsedSchedule.subjectsMap) {
        const { lessonsMap, classesMap, subjectsMap } = currentParsedSchedule;
        
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
                    // Cari apakah ada entri buku di master data
                    const matchedBook = findBookEntry(g, subName);
                    // Kecualikan HANYA jika buku tersebut secara sengaja dinonaktifkan di pengaturan
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

    // Fallback jika Jadwal XML belum termuat atau jika tidak ada mapel jadwal yang cocok
    return getSubjectsForGrade(g, false);
}

/**
 * Pencocokan Cerdas dari Nama Mapel Resmi Jadwal XML ke Baris Judul Buku di Rekap/Arsip
 */
export function findBookEntry(grade, subjectXmlName) {
    const g = parseInt(grade, 10);
    const normXml = normalizeKey(subjectXmlName);
    const isXmlAdvanced = isAdvancedSubject(normXml);
    const list = (currentMatchedData && currentMatchedData.length > 0) ? currentMatchedData : DEFAULT_BOOK_SALES_DATA;

    // 1. Direct match (sama persis / normalisasi)
    let found = list.find(b => b.grade === g && normalizeKey(b.subject) === normXml);
    if (found) return found;

    // 2. Alias mapping Jadwal XML -> Buku Sekolah
    if (normXml.includes('prakarya') || normXml === 'prakarya dan kewirausahaan') {
        found = list.find(b => b.grade === g && (normalizeKey(b.subject) === 'pkwu' || normalizeKey(b.subject).includes('prakarya')));
        if (found) return found;
    }
    if (normXml.includes('seni budaya')) {
        found = list.find(b => b.grade === g && (normalizeKey(b.subject).includes('seni tari') || normalizeKey(b.subject).includes('seni rupa') || normalizeKey(b.subject).includes('seni budaya')));
        if (found) return found;
    }
    if (normXml.includes('kearifan lokal bali') || (g === 12 && normXml.includes('bali'))) {
        found = list.find(b => b.grade === g && normalizeKey(b.subject).includes('bahasa bali'));
        if (found) return found;
    }
    if (isXmlAdvanced) {
        if (normXml.includes('indonesia')) {
            found = list.find(b => b.grade === g && normalizeKey(b.subject).includes('bahasa indonesia') && isAdvancedSubject(normalizeKey(b.subject)));
            if (found) return found;
        }
        if (normXml.includes('inggris')) {
            found = list.find(b => b.grade === g && normalizeKey(b.subject).includes('bahasa inggris') && isAdvancedSubject(normalizeKey(b.subject)));
            if (found) return found;
        }
        if (normXml.includes('sejarah')) {
            found = list.find(b => b.grade === g && normalizeKey(b.subject).includes('sejarah') && isAdvancedSubject(normalizeKey(b.subject)));
            if (found) return found;
        }
        if (normXml.includes('matematika')) {
            found = list.find(b => b.grade === g && normalizeKey(b.subject).includes('matematika') && isAdvancedSubject(normalizeKey(b.subject)));
            if (found) return found;
        }
    }

    // 3. Substring match toleran (HANYA jika sama-sama tingkat lanjut atau sama-sama reguler)
    found = list.find(b => {
        if (b.grade !== g) return false;
        const normB = normalizeKey(b.subject);
        if (isXmlAdvanced !== isAdvancedSubject(normB)) return false;
        return normB.includes(normXml) || normXml.includes(normB);
    });
    return found || null;
}

export function getBookPrice(grade, subjectName) {
    const g = parseInt(grade, 10);
    const book = findBookEntry(g, subjectName);
    if (book && typeof book.harga === 'number') return book.harga;
    return 17000; // Tarif dasar standar
}

/**
 * Mengambil peta guru pengampu mata pelajaran pada jenjang tertentu dari Jadwal XML
 */
export function getSubjectTeachersMap(grade, subjectName, parsedSchedule = currentParsedSchedule) {
    if (!parsedSchedule) return null;
    const g = parseInt(grade, 10);
    const scheduleGradeMap = buildScheduleGradeMap(parsedSchedule);
    const gradeSubs = scheduleGradeMap[g] || {};
    const normSub = normalizeKey(subjectName);
    const targetAlias = SUBJECT_ALIAS_MAP[normSub] || normSub;
    const isTargetAdvanced = isAdvancedSubject(normSub);

    let matchedMap = null;
    for (const [subKey, tMap] of Object.entries(gradeSubs)) {
        const normK = normalizeKey(subKey);
        if (normK === targetAlias || normK === normSub) {
            matchedMap = tMap;
            break;
        }
    }
    if (!matchedMap) {
        for (const [subKey, tMap] of Object.entries(gradeSubs)) {
            const normK = normalizeKey(subKey);
            const isSubAdvanced = isAdvancedSubject(normK);
            if (isTargetAdvanced !== isSubAdvanced) continue;

            if (isTargetAdvanced) {
                if (normSub.includes('matematika') && normK.includes('matematika')) { matchedMap = tMap; break; }
                if (normSub.includes('indonesia') && normK.includes('indonesia')) { matchedMap = tMap; break; }
                if (normSub.includes('inggris') && normK.includes('inggris')) { matchedMap = tMap; break; }
                if (normSub.includes('sejarah') && normK.includes('sejarah')) { matchedMap = tMap; break; }
            } else {
                if (normK.includes(targetAlias) || targetAlias.includes(normK)) {
                    matchedMap = tMap;
                    break;
                }
            }
        }
    }
    if (!matchedMap && g === 12 && normSub.includes('bahasa bali') && gradeSubs['Kearifan Lokal Bali']) {
        matchedMap = gradeSubs['Kearifan Lokal Bali'];
    }

    // Fallback jika mapel tingkat lanjut tidak memiliki jadwal terpisah di jenjang tersebut
    if (!matchedMap && isTargetAdvanced) {
        const baseSubject = normSub.replace(/tingkat\s+lanjut|tk\s+lanjut|lanjut/gi, '').trim();
        const baseAlias = SUBJECT_ALIAS_MAP[baseSubject] || baseSubject;
        for (const [subName, tMap] of Object.entries(gradeSubs)) {
            const normS = normalizeKey(subName);
            if (normS === baseAlias || normS.includes(baseAlias) || baseAlias.includes(normS)) {
                matchedMap = tMap;
                break;
            }
        }
    }

    return matchedMap;
}

/**
 * Mengambil daftar nama seluruh guru pengampu mata pelajaran pada jenjang tertentu
 */
export function getAssignedTeachersForSubject(grade, subjectName, parsedSchedule = currentParsedSchedule) {
    const matchedMap = getSubjectTeachersMap(grade, subjectName, parsedSchedule);
    if (!matchedMap) return [];
    return Object.keys(matchedMap).filter(Boolean);
}

export function findTeacherForClassSubject(grade, className, subjectName) {
    if (!currentParsedSchedule) return '-';
    const matchedMap = getSubjectTeachersMap(grade, subjectName, currentParsedSchedule);
    if (!matchedMap) return 'Guru Belum Terpetakan';

    // Cari guru yang mengampu kelas ini jika className diisi
    if (className) {
        for (const [teacherName, clsSet] of Object.entries(matchedMap)) {
            if (clsSet && clsSet.has(className)) {
                return teacherName;
            }
        }
    }

    // Jika rombel tidak ditemukan spesifik, cantumkan seluruh guru mapel tersebut
    const allTeachers = Object.keys(matchedMap);
    return allTeachers.length > 0 ? allTeachers.join(', ') : 'Guru Belum Terpetakan';
}

export function calcRemainingStock(grade, subjectName) {
    const g = parseInt(grade, 10);
    const book = findBookEntry(g, subjectName);
    if (book) {
        if (typeof book.sisa === 'number') return book.sisa;
        return Math.max(0, (book.terima || 0) - (book.diam || 0) - (book.retur || 0) - (book.terjual || 0));
    }
    return 0;
}

// ==========================================
// ANALISIS KEBUTUHAN BUKU & PEMETAAN SISWA SASARAN
// ==========================================

/**
 * Mengambil jumlah siswa aktif per rombel dari Cache IndexedDB / D1 SQL
 * Menggunakan fallback estimasi terstandar jika data siswa belum termuat
 */
export async function getClassStudentCounts(forceFresh = false) {
    if (currentClassSizes && !forceFresh) {
        return currentClassSizes;
    }

    const counts = {};

    try {
        let students = [];
        if (typeof window !== 'undefined') {
            if (typeof window.getActiveStudentsCache === 'function') {
                students = await window.getActiveStudentsCache(forceFresh);
            } else if (typeof window.getStudentsCache === 'function') {
                students = await window.getStudentsCache(forceFresh);
            }
        }

        if (Array.isArray(students) && students.length > 0) {
            students.forEach(s => {
                if (typeof window !== 'undefined' && typeof window.isStudentActive === 'function' && !window.isStudentActive(s)) {
                    return;
                }
                const cls = (s.kelas || s.class || s.rombel || '').trim();
                if (cls) {
                    counts[cls] = (counts[cls] || 0) + 1;
                }
            });
        }
    } catch (err) {
        console.warn('[PenjualanBuku] Gagal mengambil siswa aktif dari cache:', err);
    }

    // Fallback baseline terstandar per rombel di SMAGESA jika cache siswa belum terisi
    const fallbackSizes = {
        // Kelas X (9 rombel @ 36) = 324 siswa
        'X-1': 36, 'X-2': 36, 'X-3': 36, 'X-4': 36, 'X-5': 36, 'X-6': 36, 'X-7': 36, 'X-8': 36, 'X-9': 36,
        // Kelas XI (10 rombel: 9 @ 35, 1 @ 34) = 349 siswa
        'XI-1': 35, 'XI-2': 35, 'XI-3': 35, 'XI-4': 35, 'XI-5': 35, 'XI-6': 35, 'XI-7': 35, 'XI-8': 35, 'XI-9': 35, 'XI-10': 34,
        // Kelas XII (9 rombel @ 35) = 315 siswa
        'XII-1': 35, 'XII-2': 35, 'XII-3': 35, 'XII-4': 35, 'XII-5': 35, 'XII-6': 35, 'XII-7': 35, 'XII-8': 35, 'XII-9': 35
    };

    // Salin fallback jika suatu rombel bernilai 0 atau belum ada
    Object.keys(fallbackSizes).forEach(cls => {
        if (!counts[cls] || counts[cls] === 0) {
            counts[cls] = fallbackSizes[cls];
        }
    });

    currentClassSizes = counts;
    return currentClassSizes;
}

/**
 * Mengekstrak daftar rombel sasaran yang diajarkan mapel ini berdasarkan Jadwal Pelajaran XML
 * Menangani mapel wajib (seluruh kelas) maupun mapel pilihan (peminatan tertentu per rombel di XI & XII)
 */
export function getSubjectTargetClasses(grade, subjectTitle, parsedSchedule = currentParsedSchedule) {
    const g = parseInt(grade, 10);
    const normSub = normalizeKey(subjectTitle);
    const aliasSub = SUBJECT_ALIAS_MAP[normSub] || normSub;
    const isTargetAdvanced = isAdvancedSubject(normSub);

    if (parsedSchedule && parsedSchedule.lessonsMap && parsedSchedule.subjectsMap && parsedSchedule.classesMap) {
        const { lessonsMap, subjectsMap, classesMap } = parsedSchedule;
        const matchedSubjectIds = new Set();

        for (const [id, s] of subjectsMap.entries()) {
            const sName = s ? (s.name || '') : '';
            const normName = normalizeKey(sName);
            const isScheduleSubAdvanced = isAdvancedSubject(normName);

            // 1. Mapel Tingkat Lanjut vs Reguler TIDAK BOLEH BERCAMPUR
            if (isTargetAdvanced !== isScheduleSubAdvanced) {
                continue;
            }

            // 2. Penanganan Khusus Bahasa Bali kelas 12 (Kearifan Lokal Bali)
            if (g === 12 && normSub.includes('bahasa bali') && normName.includes('kearifan lokal')) {
                matchedSubjectIds.add(id);
                continue;
            }

            // 3. Exact match atau Exact Alias match
            if (normName === normSub || normName === aliasSub) {
                matchedSubjectIds.add(id);
                continue;
            }

            // 4. Substring match yang aman
            if (isTargetAdvanced) {
                if (normSub.includes('matematika') && normName.includes('matematika')) matchedSubjectIds.add(id);
                else if (normSub.includes('indonesia') && normName.includes('indonesia')) matchedSubjectIds.add(id);
                else if (normSub.includes('inggris') && normName.includes('inggris')) matchedSubjectIds.add(id);
                else if (normSub.includes('sejarah') && normName.includes('sejarah')) matchedSubjectIds.add(id);
            } else {
                if (normName.includes(aliasSub) || aliasSub.includes(normName)) {
                    matchedSubjectIds.add(id);
                }
            }
        }

        const prefix = g === 10 ? 'X-' : g === 11 ? 'XI-' : 'XII-';
        const targetClasses = new Set();

        lessonsMap.forEach(l => {
            if (matchedSubjectIds.has(l.subjectId)) {
                (l.classIds || []).forEach(cid => {
                    const cObj = classesMap.get(cid);
                    const cName = cObj ? cObj.name : cid;
                    if (cName && cName.startsWith(prefix) && (g !== 10 || (!cName.startsWith('XI-') && !cName.startsWith('XII-')))) {
                        targetClasses.add(cName);
                    }
                });
            }
        });

        if (targetClasses.size > 0) {
            return Array.from(targetClasses).sort((a, b) => {
                const numA = parseInt(a.replace(/[^0-9]/g, ''), 10) || 0;
                const numB = parseInt(b.replace(/[^0-9]/g, ''), 10) || 0;
                return numA - numB;
            });
        }

        // Jika ini mapel tingkat lanjut dan tidak ada jadwal di XML pada jenjang ini, jangan fallback ke seluruh kelas
        if (isTargetAdvanced) {
            return [];
        }
    }

    // Fallback: Jika mapel tingkat lanjut, jangan fallback ke seluruh kelas jenjang
    if (isTargetAdvanced) {
        return [];
    }

    // Fallback: Jika mapel wajib umum atau belum termuat di Jadwal XML, ambil seluruh kelas jenjang
    return getClassesForGrade(g);
}

/**
 * Menganalisis Kebutuhan Buku Pelajaran untuk 1 Baris Buku:
 * - Menghitung jumlah siswa yang mendapat mapel tersebut (berdasarkan rombel pengampu)
 * - Memetakan buku yang sudah dibeli (terjual) vs siswa yang belum beli
 * - Menganalisis stok sisa sekolah: apakah kurang (defisit stok) atau lebih (surplus)
 */
export function analyzeBookDemand(book, studentCountsMap = null, parsedSchedule = currentParsedSchedule) {
    const countsMap = studentCountsMap || currentClassSizes || {};
    const grade = parseInt(book.grade, 10);
    const targetClasses = getSubjectTargetClasses(grade, book.subject, parsedSchedule);

    let targetStudents = 0;
    const classDetails = targetClasses.map(clsName => {
        const count = countsMap[clsName] || (grade === 10 ? 36 : 35);
        targetStudents += count;
        return { className: clsName, studentCount: count };
    });

    const terima = parseNumberSafe(book.terima);
    const diam = parseNumberSafe(book.diam);
    const retur = parseNumberSafe(book.retur);
    const terjual = parseNumberSafe(book.terjual);
    const harga = parseNumberSafe(book.harga);

    // Stok sisa fisik riil di sekolah
    const sisaStok = Math.max(0, terima - diam - retur - terjual);

    // Siswa yang belum membeli
    const siswaBelumBeli = Math.max(0, targetStudents - terjual);

    // Persentase pemenuhan siswa
    const persenBeli = targetStudents > 0 ? Math.min(100, Number(((terjual / targetStudents) * 100).toFixed(1))) : 100;

    // Selisih antara Stok Tersedia di Sekolah dengan Siswa yang Belum Beli:
    // selisih = sisaStok - siswaBelumBeli
    const selisih = sisaStok - siswaBelumBeli;

    let statusKebutuhan = 'pas'; // 'kurang' | 'lebih' | 'pas' | 'terpenuhi'
    let defisit = 0;
    let surplus = 0;
    let statusLabel = '';
    let recommendation = '';

    if (siswaBelumBeli === 0) {
        statusKebutuhan = 'terpenuhi';
        surplus = sisaStok;
        statusLabel = '100% Terpenuhi';
        recommendation = `Seluruh ${targetStudents} siswa sasaran telah membeli buku. Sisa stok di sekolah (${sisaStok} eks) aman sebagai arsip perpustakaan / cadangan.`;
    } else if (selisih < 0) {
        statusKebutuhan = 'kurang';
        defisit = Math.abs(selisih);
        statusLabel = `Kurang ${defisit} eks`;
        recommendation = `Perhatian: Sisa stok sekolah (${sisaStok} eks) TIDAK CUKUP untuk ${siswaBelumBeli} siswa yang belum membeli. Diperlukan pengadaan tambahan minimal ${defisit} eksemplar ke percetakan.`;
    } else if (selisih > 0) {
        statusKebutuhan = 'lebih';
        surplus = selisih;
        statusLabel = `Lebih ${surplus} eks`;
        recommendation = `Stok persediaan mencukupi. Setelah seluruh ${siswaBelumBeli} siswa yang belum membeli mendapatkan buku, sekolah masih memiliki ${surplus} eksemplar cadangan.`;
    } else {
        statusKebutuhan = 'pas';
        statusLabel = 'Pas (0)';
        recommendation = `Stok pas persis. Sisa stok sekolah (${sisaStok} eks) tepat memenuhi seluruh ${siswaBelumBeli} siswa yang belum membeli tanpa kekurangan.`;
    }

    return {
        grade,
        subject: book.subject,
        harga,
        targetClasses,
        targetClassCount: targetClasses.length,
        classDetails,
        targetStudents,
        terima,
        diam,
        retur,
        terjual,
        sisaStok,
        siswaBelumBeli,
        persenBeli,
        selisih,
        defisit,
        surplus,
        statusKebutuhan,
        statusLabel,
        recommendation
    };
}

/**
 * Menghitung analisis kebutuhan untuk seluruh daftar buku dan rekapitulasi total neraca
 */
export function calculateBooksDemandAnalysis(booksList = currentMatchedData, studentCountsMap = null, parsedSchedule = currentParsedSchedule) {
    const list = (Array.isArray(booksList) ? booksList : []).filter(b => b.isActive !== false);
    const countsMap = studentCountsMap || currentClassSizes || {};

    let totalTargetStudents = 0;
    let totalSold = 0;
    let totalUnbought = 0;
    let totalDeficit = 0;
    let totalSurplus = 0;
    let deficitTitlesCount = 0;
    let surplusTitlesCount = 0;
    let balancedTitlesCount = 0;
    let fulfilledTitlesCount = 0;

    const items = list.map(b => {
        const itemAnalysis = analyzeBookDemand(b, countsMap, parsedSchedule);
        totalTargetStudents += itemAnalysis.targetStudents;
        totalSold += itemAnalysis.terjual;
        totalUnbought += itemAnalysis.siswaBelumBeli;

        if (itemAnalysis.statusKebutuhan === 'kurang') {
            totalDeficit += itemAnalysis.defisit;
            deficitTitlesCount++;
        } else if (itemAnalysis.statusKebutuhan === 'lebih') {
            totalSurplus += itemAnalysis.surplus;
            surplusTitlesCount++;
        } else if (itemAnalysis.statusKebutuhan === 'terpenuhi') {
            fulfilledTitlesCount++;
        } else {
            balancedTitlesCount++;
        }

        return itemAnalysis;
    });

    return {
        items,
        totals: {
            totalTargetStudents,
            totalSold,
            totalUnbought,
            totalDeficit,
            totalSurplus,
            deficitTitlesCount,
            surplusTitlesCount,
            balancedTitlesCount,
            fulfilledTitlesCount
        }
    };
}

/**
 * Merender Tabel dan Ringkasan KPI Analisis Kebutuhan Buku Pelajaran
 */
export async function renderDemandAnalysisTable(booksList = currentMatchedData) {
    const tbody = document.getElementById('table-analysis-body');
    if (!tbody) return;

    // Pastikan data siswa aktif termuat
    const studentCounts = await getClassStudentCounts();
    const booksWithSales = getBooksWithPeriodSales(booksList, currentTransactions, currentSelectedSemesterPeriod);
    const analysisData = calculateBooksDemandAnalysis(booksWithSales, studentCounts, currentParsedSchedule);

    // Update 4 KPI Mini Cards Khusus Analisis
    const kpiTargetEl = document.getElementById('analysis-kpi-target-students');
    const kpiTargetSubsEl = document.getElementById('analysis-kpi-target-subs');
    const kpiSoldEl = document.getElementById('analysis-kpi-sold-books');
    const kpiSoldPctEl = document.getElementById('analysis-kpi-sold-pct');
    const kpiUnboughtEl = document.getElementById('analysis-kpi-unbought-students');
    const kpiBalanceSummaryEl = document.getElementById('analysis-kpi-balance-summary');
    const kpiBalanceDetailEl = document.getElementById('analysis-kpi-balance-detail');

    const totals = analysisData.totals;
    const overallSoldPct = totals.totalTargetStudents > 0 
        ? ((totals.totalSold / totals.totalTargetStudents) * 100).toFixed(1) 
        : '0';

    if (kpiTargetEl) kpiTargetEl.textContent = totals.totalTargetStudents.toLocaleString('id-ID');
    if (kpiTargetSubsEl) kpiTargetSubsEl.textContent = `${analysisData.items.length} Judul Buku Terpetakan`;
    if (kpiSoldEl) kpiSoldEl.textContent = `${totals.totalSold.toLocaleString('id-ID')} eks`;
    if (kpiSoldPctEl) kpiSoldPctEl.textContent = `${overallSoldPct}% capaian pemenuhan siswa`;
    if (kpiUnboughtEl) kpiUnboughtEl.textContent = `${totals.totalUnbought.toLocaleString('id-ID')} siswa`;
    if (kpiBalanceSummaryEl) {
        if (totals.deficitTitlesCount > 0) {
            kpiBalanceSummaryEl.textContent = `${totals.deficitTitlesCount} Judul Defisit`;
            kpiBalanceSummaryEl.className = 'text-base sm:text-lg font-bold tracking-tight text-rose-600 dark:text-rose-400 leading-none mt-1';
        } else {
            kpiBalanceSummaryEl.textContent = `Stok Terpenuhi`;
            kpiBalanceSummaryEl.className = 'text-base sm:text-lg font-bold tracking-tight text-emerald-600 dark:text-emerald-400 leading-none mt-1';
        }
    }
    if (kpiBalanceDetailEl) {
        kpiBalanceDetailEl.textContent = `Kurang: ${totals.totalDeficit.toLocaleString('id-ID')} eks | Lebih: ${totals.totalSurplus.toLocaleString('id-ID')} eks`;
    }

    // Filter daftar baris sesuai filter jenjang, filter status kebutuhan, dan search keyword
    const filteredItems = analysisData.items.filter(item => {
        if (currentGradeFilter !== 'all' && String(item.grade) !== currentGradeFilter) {
            return false;
        }
        if (currentDemandFilter !== 'all' && item.statusKebutuhan !== currentDemandFilter) {
            return false;
        }
        if (currentSearchKeyword) {
            const kw = currentSearchKeyword.toLowerCase();
            const matchSub = item.subject.toLowerCase().includes(kw);
            const matchClasses = item.targetClasses.some(c => c.toLowerCase().includes(kw));
            if (!matchSub && !matchClasses) return false;
        }
        return true;
    });

    if (filteredItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="py-10 text-center text-slate-400">
                    <i class="fa-solid fa-scale-balanced text-3xl mb-2 block"></i>
                    Tidak ada data analisis buku yang sesuai filter.
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    filteredItems.forEach((item, idx) => {
        const gradeBadge = item.grade === 10
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
            : item.grade === 11
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300';

        // Badge Status Kebutuhan
        let statusBadge = '';
        if (item.statusKebutuhan === 'kurang') {
            statusBadge = `
                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 shadow-2xs">
                    <i class="fa-solid fa-triangle-exclamation text-rose-500"></i>
                    <span>Kurang ${item.defisit.toLocaleString('id-ID')} eks</span>
                </span>
            `;
        } else if (item.statusKebutuhan === 'lebih') {
            statusBadge = `
                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 shadow-2xs">
                    <i class="fa-solid fa-circle-check text-emerald-500"></i>
                    <span>Lebih ${item.surplus.toLocaleString('id-ID')} eks</span>
                </span>
            `;
        } else if (item.statusKebutuhan === 'terpenuhi') {
            statusBadge = `
                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700">
                    <i class="fa-solid fa-star text-emerald-600"></i>
                    <span>100% Terpenuhi</span>
                </span>
            `;
        } else {
            statusBadge = `
                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60 shadow-2xs">
                    <i class="fa-solid fa-scale-balanced text-blue-500"></i>
                    <span>Pas (0)</span>
                </span>
            `;
        }

        // Rombel Badges (dengan jumlah siswa per rombel)
        const rombelBadges = item.classDetails.map(cd => `
            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600" title="${escapeHTML(cd.className)}: ${cd.studentCount} siswa">
                <span>${escapeHTML(cd.className)}</span>
                <span class="font-bold text-slate-900 dark:text-white font-mono">(${cd.studentCount})</span>
            </span>
        `).join(' ');

        // Progress bar terjual
        const pctWidth = Math.min(100, Math.max(0, item.persenBeli));

        html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td class="px-3 py-2.5 text-center font-mono text-xs text-slate-500">${idx + 1}</td>
                <td class="px-2.5 py-2.5 text-center">
                    <span class="px-2 py-0.5 rounded text-xs font-bold font-mono ${gradeBadge}">
                        ${getGradeRoman(item.grade)}
                    </span>
                </td>
                <td class="px-3.5 py-2.5 font-semibold text-slate-900 dark:text-white text-xs">
                    ${escapeHTML(item.subject)}
                </td>
                <td class="px-3 py-2.5 text-xs">
                    <div class="flex flex-wrap gap-1 max-w-[320px]">
                        ${rombelBadges || '<span class="text-slate-400 italic">Seluruh rombel jenjang</span>'}
                    </div>
                </td>
                <td class="px-3 py-2.5 text-right font-mono text-xs font-bold text-slate-800 dark:text-slate-100">
                    ${item.targetStudents.toLocaleString('id-ID')}
                </td>
                <td class="px-2.5 py-2.5 text-right font-mono text-xs text-slate-600 dark:text-slate-400">
                    ${item.terima.toLocaleString('id-ID')}
                </td>
                <td class="px-3 py-2.5 text-right text-xs">
                    <div class="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        ${item.terjual.toLocaleString('id-ID')} <span class="text-[10px] font-normal text-slate-500">(${item.persenBeli}%)</span>
                    </div>
                    <div class="w-full bg-slate-100 dark:bg-slate-700 h-1 rounded-full mt-1 overflow-hidden">
                        <div class="bg-emerald-500 h-full rounded-full" style="width: ${pctWidth}%"></div>
                    </div>
                </td>
                <td class="px-3 py-2.5 text-right font-mono text-xs font-bold ${item.siswaBelumBeli > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}">
                    ${item.siswaBelumBeli.toLocaleString('id-ID')}
                </td>
                <td class="px-2.5 py-2.5 text-right font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                    ${item.sisaStok.toLocaleString('id-ID')}
                </td>
                <td class="px-3.5 py-2.5 text-center">
                    ${statusBadge}
                </td>
                <td class="px-2.5 py-2.5 text-center">
                    <button type="button" onclick="window.openDemandDetailModal('${item.grade}', '${encodeURIComponent(item.subject)}')"
                        title="Lihat detail rombel dan rekomendasi kebutuhan"
                        class="w-7 h-7 inline-flex items-center justify-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                        <i class="fa-solid fa-circle-info text-xs"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

/**
 * Menampilkan Dialog Modal Detail Analisis Kebutuhan Buku & Rincian Rombel
 */
export async function openDemandDetailModal(grade, encodedSubject) {
    const modal = document.getElementById('modal-demand-detail');
    if (!modal) return;

    const g = parseInt(grade, 10);
    const subject = decodeURIComponent(encodedSubject);
    const book = findBookEntry(g, subject) || { grade: g, subject, terima: 0, diam: 0, sisa: 0, terjual: 0, harga: 0 };

    const studentCounts = await getClassStudentCounts();
    const analysis = analyzeBookDemand(book, studentCounts, currentParsedSchedule);

    const titleEl = document.getElementById('demand-modal-title');
    const subtitleEl = document.getElementById('demand-modal-subtitle');
    const targetEl = document.getElementById('demand-modal-target');
    const soldEl = document.getElementById('demand-modal-sold');
    const unboughtEl = document.getElementById('demand-modal-unbought');
    const stockEl = document.getElementById('demand-modal-stock');
    const recBoxEl = document.getElementById('demand-modal-recommendation-box');
    const recIconEl = document.getElementById('demand-modal-rec-icon');
    const recStatusEl = document.getElementById('demand-modal-rec-status');
    const recTextEl = document.getElementById('demand-modal-rec-text');
    const classesTbody = document.getElementById('demand-modal-classes-body');

    if (titleEl) titleEl.textContent = `${analysis.subject} (Kelas ${getGradeRoman(analysis.grade)})`;
    if (subtitleEl) subtitleEl.textContent = `Harga Satuan: ${formatRupiah(analysis.harga)} | ${analysis.targetClassCount} Rombel Sasaran`;
    if (targetEl) targetEl.textContent = `${analysis.targetStudents} Siswa`;
    if (soldEl) soldEl.textContent = `${analysis.terjual} Eks (${analysis.persenBeli}%)`;
    if (unboughtEl) unboughtEl.textContent = `${analysis.siswaBelumBeli} Siswa`;
    if (stockEl) stockEl.textContent = `${analysis.sisaStok} Eks`;

    if (recBoxEl && recStatusEl && recTextEl && recIconEl) {
        if (analysis.statusKebutuhan === 'kurang') {
            recBoxEl.className = 'p-3.5 rounded-xl border border-rose-200 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200 flex items-start gap-3 text-xs';
            recIconEl.className = 'fa-solid fa-triangle-exclamation text-rose-600 text-base mt-0.5 shrink-0';
            recStatusEl.textContent = `DEFISIT PENGADAAN: Kurang ${analysis.defisit} Eksemplar`;
            recTextEl.textContent = analysis.recommendation;
        } else if (analysis.statusKebutuhan === 'lebih') {
            recBoxEl.className = 'p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 flex items-start gap-3 text-xs';
            recIconEl.className = 'fa-solid fa-circle-check text-emerald-600 text-base mt-0.5 shrink-0';
            recStatusEl.textContent = `SURPLUS STOK: Cadangan Lebih ${analysis.surplus} Eksemplar`;
            recTextEl.textContent = analysis.recommendation;
        } else if (analysis.statusKebutuhan === 'terpenuhi') {
            recBoxEl.className = 'p-3.5 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-100/60 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-200 flex items-start gap-3 text-xs';
            recIconEl.className = 'fa-solid fa-star text-emerald-600 text-base mt-0.5 shrink-0';
            recStatusEl.textContent = `PEMENUHAN TUNTAS 100%`;
            recTextEl.textContent = analysis.recommendation;
        } else {
            recBoxEl.className = 'p-3.5 rounded-xl border border-blue-200 dark:border-blue-800/80 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 flex items-start gap-3 text-xs';
            recIconEl.className = 'fa-solid fa-scale-balanced text-blue-600 text-base mt-0.5 shrink-0';
            recStatusEl.textContent = `STOK TEPAT MENCUKUPI (PAS)`;
            recTextEl.textContent = analysis.recommendation;
        }
    }

    if (classesTbody) {
        if (analysis.classDetails.length === 0) {
            classesTbody.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-slate-400">Tidak ada rombel terpetakan.</td></tr>`;
        } else {
            classesTbody.innerHTML = analysis.classDetails.map((cd, i) => {
                const teacherName = findTeacherForClassSubject(analysis.grade, cd.className, analysis.subject);
                return `
                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td class="px-3 py-2 text-center font-mono text-slate-500">${i + 1}</td>
                        <td class="px-3 py-2 font-bold font-mono text-slate-800 dark:text-white">${escapeHTML(cd.className)}</td>
                        <td class="px-3 py-2 text-right font-mono font-bold text-slate-900 dark:text-white">${cd.studentCount} siswa</td>
                        <td class="px-3 py-2 text-slate-600 dark:text-slate-300">${escapeHTML(teacherName)}</td>
                    </tr>
                `;
            }).join('');
        }
    }

    modal.classList.remove('hidden');
}

export function closeDemandDetailModal() {
    const modal = document.getElementById('modal-demand-detail');
    if (modal) modal.classList.add('hidden');
}

// ==========================================
// PERSISTENSI DATA (D1 & LOCALSTORAGE)
// ==========================================

/**
 * Kebijakan Retensi Data Otomatis: Hapus riwayat transaksi dan mutasi sirkulasi LKS yang berusia > 5 tahun
 * Menjaga kapasitas penyimpanan dan performa query database tetap optimal dan patuh regulasi data.
 * @param {object} payload - Objek bundle { books, transactions, circulations, vendors }
 * @param {number} maxYears - Batas usia maksimum retensi (default 5 tahun)
 * @returns {object} { payload, purgedTransactionsCount, purgedCirculationsCount }
 */
export function purgeExpiredLksRecords(payload, maxYears = 5) {
    if (!payload || typeof payload !== 'object') {
        return { payload, purgedTransactionsCount: 0, purgedCirculationsCount: 0, purgedCashFlowsCount: 0 };
    }

    const now = new Date();
    const cutoffDate = new Date();
    cutoffDate.setFullYear(now.getFullYear() - maxYears);
    const cutoffTime = cutoffDate.getTime();

    let purgedTx = 0;
    let purgedCirc = 0;
    let purgedCf = 0;

    const isExpired = (item) => {
        if (!item) return false;
        const dateVal = item.date || item.createdAt || item.timestamp;
        if (!dateVal) return false;
        const itemTime = new Date(dateVal).getTime();
        return !isNaN(itemTime) && itemTime < cutoffTime;
    };

    if (Array.isArray(payload.transactions)) {
        const origLen = payload.transactions.length;
        payload.transactions = payload.transactions.filter(t => !isExpired(t));
        purgedTx = origLen - payload.transactions.length;
    }

    if (Array.isArray(payload.circulations)) {
        const origLen = payload.circulations.length;
        payload.circulations = payload.circulations.filter(c => !isExpired(c));
        purgedCirc = origLen - payload.circulations.length;
    }

    if (Array.isArray(payload.cashFlows)) {
        const origLen = payload.cashFlows.length;
        payload.cashFlows = payload.cashFlows.filter(cf => !isExpired(cf));
        purgedCf = origLen - payload.cashFlows.length;
    }

    return {
        payload,
        purgedTransactionsCount: purgedTx,
        purgedCirculationsCount: purgedCirc,
        purgedCashFlowsCount: purgedCf
    };
}

/**
 * Normalisasi nilai respons setting dari Cloudflare D1 / LocalStorage
 * Mendukung objek parsed langsung, format envelope { value: ... }, atau JSON string
 */
export function parseSettingValue(setting) {
    if (!setting) return null;
    let val = setting;
    if (typeof val === 'string') {
        try {
            val = JSON.parse(val);
        } catch (e) {
            return null;
        }
    }
    if (val && typeof val === 'object') {
        if (val.value !== undefined && val.value !== null) {
            if (typeof val.value === 'string') {
                try {
                    return JSON.parse(val.value);
                } catch (e) {
                    return val.value;
                }
            }
            return val.value;
        }
    }
    return val;
}
if (typeof window !== 'undefined') {
    window.parseSettingValue = parseSettingValue;
}

export async function loadSavedBookSalesData() {
    let localData = null;
    if (typeof localStorage !== 'undefined') {
        try {
            const raw = localStorage.getItem(BOOK_SALES_STORAGE_KEY);
            if (raw) localData = JSON.parse(raw);
        } catch (e) {
            console.warn('[PenjualanBuku] Gagal membaca localStorage:', e);
        }
    }

    let d1Data = null;
    if (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled) {
        try {
            const setting = await cfClient.getSystemSetting(BOOK_SALES_D1_KEY);
            d1Data = parseSettingValue(setting);
        } catch (e) {
            console.warn('[PenjualanBuku] Gagal membaca D1 system_settings:', e);
        }
    }

    // Resolusi SSOT Cerdas: Jangan biarkan master buku hilang jika salah satu sumber punya buku
    let books = [];
    if (d1Data && Array.isArray(d1Data.books) && d1Data.books.length > 0) {
        books = d1Data.books;
    } else if (localData && Array.isArray(localData.books) && localData.books.length > 0) {
        books = localData.books;
    }

    const primarySource = d1Data || localData || {};
    const secondarySource = localData || d1Data || {};

    // Simpan referensi data sirkulasi & vendor yang sedang aktif di memori
    const existingMemCircs = Array.isArray(currentCirculations) ? [...currentCirculations] : [];
    const existingMemVendors = Array.isArray(currentVendors) ? [...currentVendors] : [];

    currentMatchedData = books;
    currentTransactions = Array.isArray(primarySource.transactions)
        ? primarySource.transactions
        : (Array.isArray(secondarySource.transactions) ? secondarySource.transactions : []);
    currentCirculations = Array.isArray(primarySource.circulations)
        ? primarySource.circulations
        : (Array.isArray(secondarySource.circulations) && secondarySource.circulations.length > 0 ? secondarySource.circulations : existingMemCircs);
    currentCashFlows = Array.isArray(primarySource.cashFlows)
        ? primarySource.cashFlows
        : (Array.isArray(secondarySource.cashFlows) ? secondarySource.cashFlows : []);

    // Resolusi SSOT Cerdas Master Vendor (Multi-Source Resilient Merge & Anti-Data Loss)
    const vendorSet = new Set();
    existingMemVendors.forEach(v => {
        if (typeof v === 'string' && v.trim()) vendorSet.add(v.trim());
    });

    // 1. Dari dedicated LocalStorage
    if (typeof localStorage !== 'undefined') {
        try {
            const rawDedicated = localStorage.getItem(BOOK_VENDORS_STORAGE_KEY);
            if (rawDedicated) {
                const parsed = JSON.parse(rawDedicated);
                if (Array.isArray(parsed)) {
                    parsed.forEach(v => {
                        if (typeof v === 'string' && v.trim()) vendorSet.add(v.trim());
                    });
                }
            }
        } catch (e) {
            console.warn('[PenjualanBuku] Gagal membaca dedicated vendor storage:', e);
        }
    }

    // 2. Dari dedicated Cloudflare D1 key-value
    if (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled) {
        try {
            const d1Setting = await cfClient.getSystemSetting(BOOK_VENDORS_D1_KEY);
            const parsedD1Vendors = parseSettingValue(d1Setting);
            const list = Array.isArray(parsedD1Vendors?.value)
                ? parsedD1Vendors.value
                : (Array.isArray(parsedD1Vendors) ? parsedD1Vendors : []);
            list.forEach(v => {
                if (typeof v === 'string' && v.trim()) vendorSet.add(v.trim());
            });
        } catch (e) {
            console.warn('[PenjualanBuku] Gagal membaca dedicated vendor D1:', e);
        }
    }

    // 3. Dari payload bundle D1 & LocalData
    if (Array.isArray(d1Data?.vendors)) {
        d1Data.vendors.forEach(v => {
            if (typeof v === 'string' && v.trim()) vendorSet.add(v.trim());
        });
    }
    if (Array.isArray(localData?.vendors)) {
        localData.vendors.forEach(v => {
            if (typeof v === 'string' && v.trim()) vendorSet.add(v.trim());
        });
    }

    // 4. Dari histori sirkulasi (harvest rekanan penerimaan / retur penerbit)
    const allCircs = [
        ...existingMemCircs,
        ...(Array.isArray(currentCirculations) ? currentCirculations : []),
        ...(Array.isArray(d1Data?.circulations) ? d1Data.circulations : []),
        ...(Array.isArray(localData?.circulations) ? localData.circulations : [])
    ];
    allCircs.forEach(c => {
        if (c && c.party && (c.type === 'terima' || c.type === 'retur_penerbit')) {
            const trimmed = c.party.trim();
            if (trimmed && !trimmed.startsWith('Guru') && trimmed !== '-' && trimmed !== 'Siswa') {
                vendorSet.add(trimmed);
            }
        }
    });

    currentVendors = Array.from(vendorSet).sort((a, b) => a.localeCompare(b, 'id-ID'));

    // Sinkronkan kembali master vendor yang ter-merge ke localStorage jika sebelumnya belum tersimpan
    if (typeof localStorage !== 'undefined' && currentVendors.length > 0) {
        try {
            localStorage.setItem(BOOK_VENDORS_STORAGE_KEY, JSON.stringify(currentVendors));
        } catch (e) {}
    }

    // Resolusi Nilai Persentase Bagian Sekolah
    let loadedSchoolPct = null;
    if (d1Data && typeof d1Data.schoolSharePercentage !== 'undefined' && d1Data.schoolSharePercentage !== null) {
        loadedSchoolPct = d1Data.schoolSharePercentage;
    } else if (localData && typeof localData.schoolSharePercentage !== 'undefined' && localData.schoolSharePercentage !== null) {
        loadedSchoolPct = localData.schoolSharePercentage;
    }

    if (loadedSchoolPct === null && typeof localStorage !== 'undefined') {
        try {
            const rawDedicatedPct = localStorage.getItem(BOOK_SCHOOL_SHARE_STORAGE_KEY);
            if (rawDedicatedPct !== null) loadedSchoolPct = parseFloat(rawDedicatedPct);
        } catch (e) {}
    }

    if (loadedSchoolPct === null && typeof cfClient !== 'undefined' && cfClient && cfClient.enabled) {
        try {
            const d1PctSetting = await cfClient.getSystemSetting(BOOK_SCHOOL_SHARE_D1_KEY);
            const parsed = parseSettingValue(d1PctSetting);
            if (typeof parsed !== 'undefined' && parsed !== null) {
                loadedSchoolPct = parseFloat(parsed.value || parsed);
            }
        } catch (e) {}
    }

    setSchoolSharePercentage(loadedSchoolPct !== null ? loadedSchoolPct : 0);
    updateSchoolShareBadge();

    // Resolusi Pengaturan Pembagian Fee LKS (4 Komponen Dinamis)
    let loadedFeeSettings = null;
    if (d1Data && d1Data.feeDistributionSettings && typeof d1Data.feeDistributionSettings === 'object') {
        loadedFeeSettings = d1Data.feeDistributionSettings;
    } else if (localData && localData.feeDistributionSettings && typeof localData.feeDistributionSettings === 'object') {
        loadedFeeSettings = localData.feeDistributionSettings;
    }

    if (!loadedFeeSettings && typeof localStorage !== 'undefined') {
        try {
            const rawFee = localStorage.getItem(BOOK_FEE_SETTINGS_STORAGE_KEY);
            if (rawFee) loadedFeeSettings = JSON.parse(rawFee);
        } catch (e) {}
    }

    if (!loadedFeeSettings && typeof cfClient !== 'undefined' && cfClient && cfClient.enabled) {
        try {
            const d1Fee = await cfClient.getSystemSetting(BOOK_FEE_SETTINGS_D1_KEY);
            const parsedFee = parseSettingValue(d1Fee);
            if (parsedFee && typeof parsedFee === 'object') {
                loadedFeeSettings = parsedFee;
            }
        } catch (e) {}
    }

    if (loadedFeeSettings) {
        // Sanitisasi legacy: pisahkan tarif fee rate sekolah (30%) dari sub-komponen sekolah (0%)
        if (loadedFeeSettings.feeRatePercentage == null && loadedFeeSettings.schoolPercentage != null) {
            loadedFeeSettings.feeRatePercentage = loadedFeeSettings.schoolPercentage;
        }
        loadedFeeSettings.schoolPercentage = 0;
        setFeeDistributionSettings(loadedFeeSettings);
    } else if (loadedSchoolPct !== null) {
        setFeeDistributionSettings({ ...DEFAULT_FEE_DISTRIBUTION_SETTINGS, feeRatePercentage: loadedSchoolPct, schoolPercentage: 0 });
    } else {
        setFeeDistributionSettings(DEFAULT_FEE_DISTRIBUTION_SETTINGS);
    }
    updateFeeSettingsUI();

    // Jalankan auto-purge untuk data yang berusia > 5 tahun
    const purgeResult = purgeExpiredLksRecords({
        books: currentMatchedData,
        transactions: currentTransactions,
        circulations: currentCirculations,
        vendors: currentVendors,
        cashFlows: currentCashFlows
    }, 5);

    if (purgeResult.purgedTransactionsCount > 0 || purgeResult.purgedCirculationsCount > 0 || purgeResult.purgedCashFlowsCount > 0) {
        currentTransactions = purgeResult.payload.transactions;
        currentCirculations = purgeResult.payload.circulations;
        currentCashFlows = purgeResult.payload.cashFlows;
        console.info(`[PenjualanBuku] Auto-Purge 5 Tahun: Menghapus ${purgeResult.purgedTransactionsCount} transaksi, ${purgeResult.purgedCirculationsCount} sirkulasi, dan ${purgeResult.purgedCashFlowsCount} kas kadaluarsa.`);
        // Simpan pembaruan bersih ke storage & D1
        saveBookSalesData();
    }
}

export async function saveBookSalesData({ requireServer = false } = {}) {
    if (requireServer && !cfClient?.enabled) {
        showToast('Belum Tersimpan', 'Koneksi server belum tersedia. Coba kembali setelah terhubung.', 'warning');
        return false;
    }
    // Protective Guard: Jangan biarkan master buku tertimpa array kosong []
    // akibat race condition load atau mutasi non-buku (misal tambah vendor / kas)
    let booksToSave = currentMatchedData;
    if ((!Array.isArray(booksToSave) || booksToSave.length === 0) && typeof localStorage !== 'undefined') {
        try {
            const raw = localStorage.getItem(BOOK_SALES_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed.books) && parsed.books.length > 0) {
                    booksToSave = parsed.books;
                    currentMatchedData = parsed.books; // Pulihkan memori aktif
                }
            }
        } catch (e) {}
    }

    // Pastikan data yang disimpan telah disaring dari riwayat > 5 tahun
    purgeExpiredLksRecords({
        transactions: currentTransactions,
        circulations: currentCirculations,
        cashFlows: currentCashFlows
    }, 5);

    const payload = {
        books: booksToSave,
        transactions: currentTransactions,
        circulations: currentCirculations,
        vendors: currentVendors,
        cashFlows: currentCashFlows,
        schoolSharePercentage: currentSchoolSharePercentage,
        feeDistributionSettings: currentFeeDistributionSettings,
        updatedAt: new Date().toISOString()
    };

    // Transaksi baru baru boleh dianggap selesai setelah tersimpan di server.
    if (requireServer) {
        try {
            await cfClient.saveSystemSetting(BOOK_SALES_D1_KEY, payload);
        } catch (error) {
            console.warn('[PenjualanBuku] Transaksi belum tersimpan di D1:', error);
            showToast('Belum Tersimpan', 'Transaksi belum tersimpan. Periksa koneksi lalu coba kembali.', 'warning');
            return false;
        }
    }

    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(BOOK_SALES_STORAGE_KEY, JSON.stringify(payload));
            if (Array.isArray(currentVendors)) {
                localStorage.setItem(BOOK_VENDORS_STORAGE_KEY, JSON.stringify(currentVendors));
            }
            localStorage.setItem(BOOK_SCHOOL_SHARE_STORAGE_KEY, String(currentSchoolSharePercentage));
            localStorage.setItem(BOOK_FEE_SETTINGS_STORAGE_KEY, JSON.stringify(currentFeeDistributionSettings));
        } catch (e) {
            console.warn('[PenjualanBuku] Gagal simpan ke localStorage:', e);
        }
    }

    if (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled) {
        try {
            if (!requireServer) await cfClient.saveSystemSetting(BOOK_SALES_D1_KEY, payload);
            if (Array.isArray(currentVendors)) {
                await cfClient.saveSystemSetting(BOOK_VENDORS_D1_KEY, currentVendors);
            }
            await cfClient.saveSystemSetting(BOOK_SCHOOL_SHARE_D1_KEY, currentSchoolSharePercentage);
            await cfClient.saveSystemSetting(BOOK_FEE_SETTINGS_D1_KEY, currentFeeDistributionSettings);
        } catch (e) {
            console.warn('[PenjualanBuku] Gagal simpan ke Cloudflare D1:', e);
        }
    }
    return true;
}

// ==========================================
// KONTROL UI & RENDERING HALAMAN
// ==========================================

export function updateKpiCards(data) {
    const elTitles = document.getElementById('kpi-total-titles');
    const elSold = document.getElementById('kpi-total-sold');
    const elSoldSub = document.getElementById('kpi-total-sold-sub');
    const elRevenue = document.getElementById('kpi-total-revenue');
    const elStock = document.getElementById('kpi-total-stock');
    const elStockSub = document.getElementById('kpi-total-stock-sub');

    if (!elTitles && !elSold && !elRevenue && !elStock) {
        return;
    }

    const defaultPeriod = getDefaultTransactionPeriod();
    const activeBooks = (data || []).filter(d => d.isActive !== false);
    const totalTitles = activeBooks.length;
    let totalTerima = 0;
    let totalTerjual = 0;
    let totalNominal = 0;
    let totalStock = 0;

    if (currentSelectedSemesterPeriod !== 'all' && currentTransactions && currentTransactions.length > 0) {
        const periodTxs = currentTransactions.filter(t => {
            const p = t.periode || defaultPeriod;
            return isPeriodMatch(p, currentSelectedSemesterPeriod);
        });
        const pSum = summarizeTransactions(periodTxs);
        totalTerjual = pSum.netQty;
        totalNominal = (typeof pSum.netNom === 'number' ? pSum.netNom : (pSum.netTotal || 0));
        activeBooks.forEach(d => {
            totalTerima += d.terima || 0;
            const bookTxs = periodTxs.filter(t => String(t.grade) === String(d.grade) && (normalizeKey(t.subject) === normalizeKey(d.subject) || isBookSubjectMatch(t.subject, d.subject)));
            const bSum = summarizeTransactions(bookTxs);
            const sisa = Math.max(0, (d.terima || 0) - (d.diam || 0) - (d.retur || 0) - bSum.netQty);
            totalStock += sisa;
        });
    } else {
        activeBooks.forEach(d => {
            totalTerima += d.terima || 0;
            totalTerjual += d.terjual || 0;
            totalNominal += (d.total || ((d.terjual || 0) * (d.harga || 0)));
            const sisa = typeof d.sisa === 'number' ? d.sisa : Math.max(0, (d.terima || 0) - (d.diam || 0) - (d.retur || 0) - (d.terjual || 0));
            totalStock += sisa;
        });
    }

    if (elTitles) elTitles.textContent = totalTitles.toLocaleString('id-ID');
    if (elSold) elSold.textContent = totalTerjual.toLocaleString('id-ID');
    if (elSoldSub) {
        const relevantTxs = (currentSelectedSemesterPeriod !== 'all')
            ? (currentTransactions || []).filter(t => isPeriodMatch(t.periode || defaultPeriod, currentSelectedSemesterPeriod))
            : (currentTransactions || []);
        const sum = summarizeTransactions(relevantTxs);
        if (sum.returnQty > 0) {
            elSoldSub.textContent = `dari ${totalTerima.toLocaleString('id-ID')} eks (retur ${sum.returnQty} eks)`;
        } else {
            elSoldSub.textContent = `dari ${totalTerima.toLocaleString('id-ID')} eksemplar`;
        }
    }
    if (elRevenue) elRevenue.textContent = formatRupiah(totalNominal);
    if (elStock) elStock.textContent = totalStock.toLocaleString('id-ID');
    if (elStockSub) {
        const pctStock = totalTerima > 0 ? ((totalStock / totalTerima) * 100).toFixed(1).replace('.', ',') : '0';
        elStockSub.textContent = `${pctStock}% dari stok diterima`;
    }
}

export function renderBooksTable(data) {
    const tbody = document.getElementById('table-books-body');
    if (!tbody) return;

    const defaultPeriod = getDefaultTransactionPeriod();

    // Filter buku aktif (Zero Stale Books) + filter jenjang & keyword
    const filtered = data.filter(item => {
        if (item.isActive === false) return false;
        if (currentGradeFilter !== 'all' && String(item.grade) !== currentGradeFilter) {
            return false;
        }
        if (currentSearchKeyword) {
            const kw = currentSearchKeyword.toLowerCase();
            const matchSub = (item.subject || '').toLowerCase().includes(kw);
            const matchTeach = (item.teacherNamesStr || '').toLowerCase().includes(kw);
            if (!matchSub && !matchTeach) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="py-10 text-center text-slate-400">
                    <i class="fa-solid fa-inbox text-3xl mb-2 block"></i>
                    Tidak ada data buku yang sesuai filter.
                </td>
            </tr>
        `;
        return;
    }

    const booksWithSales = getBooksWithPeriodSales(filtered, currentTransactions, currentSelectedSemesterPeriod);

    let subtotalTerima = 0;
    let subtotalDiam = 0;
    let subtotalSisa = 0;
    let subtotalTerjual = 0;
    let subtotalNominal = 0;

    let html = '';
    booksWithSales.forEach((row, idx) => {
        const rowTerjual = row.terjual || 0;
        const rowNominal = row.total || 0;
        const teachersForDisplay = row.teachers;
        const rowSisa = row.sisa;

        subtotalTerima += parseNumberSafe(row.terima, 0);
        subtotalDiam += parseNumberSafe(row.diam, 0);
        subtotalSisa += parseNumberSafe(rowSisa, 0);
        subtotalTerjual += parseNumberSafe(rowTerjual, 0);
        subtotalNominal += parseNumberSafe(rowNominal, 0);

        // Render badge guru dengan rincian kelas & porsi proporsional (Compact & Rapi)
        let teacherBadgeHtml = '';
        if (teachersForDisplay && teachersForDisplay.length > 0) {
            teacherBadgeHtml = `<div class="space-y-1">` + teachersForDisplay.map(t => `
                <div class="py-1 px-2 rounded-md bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-xs" title="Rombel diampu: ${escapeHTML(t.classesStr)}">
                    <div class="flex items-center justify-between gap-1.5">
                        <span class="font-semibold text-slate-800 dark:text-slate-100 truncate leading-snug" title="${escapeHTML(t.teacher)}">${escapeHTML(t.teacher)}</span>
                        <span class="px-1.5 py-0.2 rounded text-[10px] font-bold font-mono bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 shrink-0" title="Rombel: ${escapeHTML(t.classesStr)}">
                            ${t.classCount}/${t.totalClasses} kls (${t.percentageStr})
                        </span>
                    </div>
                    <div class="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                        <span class="text-emerald-600 dark:text-emerald-400 font-medium">${t.propTerjual.toLocaleString('id-ID')} eks</span>
                        <span class="text-blue-600 dark:text-blue-400 font-bold">${formatRupiah(t.propNominal)}</span>
                    </div>
                </div>
            `).join('') + `</div>`;
        } else {
            teacherBadgeHtml = `<span class="text-xs text-amber-600 dark:text-amber-400 italic"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Belum terpetakan di Jadwal XML</span>`;
        }

        const gradeBadge = row.grade === 10
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
            : row.grade === 11
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300';

        html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td class="px-3 py-1.5 sm:py-2 text-center text-xs font-mono text-slate-500">${idx + 1}</td>
                <td class="px-3 py-1.5 sm:py-2 text-center">
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${gradeBadge}">${getGradeRoman(row.grade)}</span>
                </td>
                <td class="px-4 py-1.5 sm:py-2 font-medium text-slate-800 dark:text-slate-200">
                    ${escapeHTML(row.subject)}
                </td>
                <td class="px-3 py-1.5 sm:py-2 text-right font-mono text-xs">${(row.terima || 0).toLocaleString('id-ID')}</td>
                <td class="px-3 py-1.5 sm:py-2 text-right font-mono text-xs text-amber-600 dark:text-amber-400">${(row.diam || 0) > 0 ? (row.diam).toLocaleString('id-ID') : '-'}</td>
                <td class="px-3 py-1.5 sm:py-2 text-right font-mono text-xs ${rowSisa > 0 ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-slate-400'}">${rowSisa > 0 ? rowSisa.toLocaleString('id-ID') : '-'}</td>
                <td class="px-3 py-1.5 sm:py-2 text-right font-mono text-xs font-bold text-blue-600 dark:text-blue-400">${rowTerjual.toLocaleString('id-ID')}</td>
                <td class="px-3 py-1.5 sm:py-2 text-right font-mono text-xs text-slate-600 dark:text-slate-400">${formatRupiah(row.harga)}</td>
                <td class="px-4 py-1.5 sm:py-2 text-right font-mono text-xs font-bold text-slate-800 dark:text-white">${formatRupiah(rowNominal)}</td>
                <td class="px-3.5 py-1.5 sm:py-2 min-w-[240px]">${teacherBadgeHtml}</td>
            </tr>
        `;
    });

    // Subtotal Row
    html += `
        <tr class="bg-slate-100 dark:bg-slate-700/60 font-bold border-t-2 border-slate-300 dark:border-slate-600">
            <td colspan="3" class="px-4 py-2 text-right text-xs uppercase tracking-wide">Total Terfilter:</td>
            <td class="px-3 py-2 text-right font-mono text-xs">${subtotalTerima.toLocaleString('id-ID')}</td>
            <td class="px-3 py-2 text-right font-mono text-xs text-amber-600 dark:text-amber-400">${subtotalDiam ? subtotalDiam.toLocaleString('id-ID') : '-'}</td>
            <td class="px-3 py-2 text-right font-mono text-xs text-emerald-600 dark:text-emerald-400">${subtotalSisa ? subtotalSisa.toLocaleString('id-ID') : '-'}</td>
            <td class="px-3 py-2 text-right font-mono text-xs text-blue-600 dark:text-blue-400">${subtotalTerjual.toLocaleString('id-ID')}</td>
            <td class="px-3 py-2 text-right font-mono text-xs">-</td>
            <td class="px-4 py-2 text-right font-mono text-xs text-blue-700 dark:text-blue-300">${formatRupiah(subtotalNominal)}</td>
            <td class="px-3.5 py-2 text-xs text-slate-500 font-mono">${filtered.length} Judul Buku</td>
        </tr>
    `;

    tbody.innerHTML = html;
}

export function renderTeachersTable(matchedData) {
    const tbody = document.getElementById('table-teachers-body');
    if (!tbody) return;

    const booksWithSales = getBooksWithPeriodSales(matchedData, currentTransactions, currentSelectedSemesterPeriod);
    const teacherAggregates = aggregateSalesByTeacher(booksWithSales);
    const schoolPct = getSchoolSharePercentage();

    // Update label header di thead jika ada
    const thPct = document.getElementById('th-school-pct');
    if (thPct) {
        thPct.textContent = String(schoolPct);
    }

    // Filter keyword
    const filtered = teacherAggregates.filter(t => {
        if (!currentSearchKeyword) return true;
        const kw = currentSearchKeyword.toLowerCase();
        const matchName = t.teacherName.toLowerCase().includes(kw);
        const matchBooks = t.books.some(b => b.subject.toLowerCase().includes(kw));
        return matchName || matchBooks;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-10 text-center text-slate-400">
                    <i class="fa-solid fa-user-slash text-3xl mb-2 block"></i>
                    Tidak ada data guru yang sesuai pencarian.
                </td>
            </tr>
        `;
        return;
    }

    let grandTerjual = 0;
    let grandNominal = 0;
    let grandBagianSekolah = 0;

    let html = '';
    filtered.forEach((item, idx) => {
        grandTerjual += item.totalTerjual;
        grandNominal += item.totalNominal;
        const bagianSekolah = Math.round((item.totalNominal || 0) * (schoolPct / 100));
        grandBagianSekolah += bagianSekolah;

        const booksHtml = `<div class="space-y-1">` + item.books.map(b => `
            <div class="py-1 px-2 rounded-md bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-xs" title="Rombel diampu: ${escapeHTML(b.classesStr)}">
                <div class="flex items-center justify-between gap-1.5">
                    <span class="font-semibold text-slate-800 dark:text-slate-100 truncate leading-snug">${getGradeRoman(b.grade)} - ${escapeHTML(b.subject)}</span>
                    <span class="px-1.5 py-0.2 rounded text-[10px] font-bold font-mono bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 shrink-0" title="Rombel: ${escapeHTML(b.classesStr)}">
                        ${b.classCount}/${b.totalClasses} kls (${b.percentageStr})
                    </span>
                </div>
                <div class="flex items-center justify-between font-mono text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    <span class="text-emerald-600 dark:text-emerald-400 font-medium">Porsi: ${(b.propTerjual != null ? b.propTerjual : 0).toLocaleString('id-ID')} eks</span>
                    <span class="text-blue-600 dark:text-blue-300 font-bold">${formatRupiah(b.propNominal || 0)}</span>
                </div>
            </div>
        `).join('') + `</div>`;

        html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td class="px-3 py-1.5 sm:py-2 text-center text-xs font-mono text-slate-500">${idx + 1}</td>
                <td class="px-4 py-1.5 sm:py-2 font-bold text-slate-800 dark:text-slate-100">
                    <div class="flex items-center gap-2">
                        <div class="w-6 h-6 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200 flex items-center justify-center font-bold text-[11px] shrink-0">
                            <i class="fa-solid fa-chalkboard-user"></i>
                        </div>
                        <span class="truncate">${escapeHTML(item.teacherName)}</span>
                    </div>
                </td>
                <td class="px-3.5 py-1.5 sm:py-2 min-w-[240px]">${booksHtml}</td>
                <td class="px-4 py-1.5 sm:py-2 text-center font-mono text-xs">${item.books.length} Mapel</td>
                <td class="px-4 py-1.5 sm:py-2 text-right font-mono text-xs font-bold text-emerald-600">${(item.totalTerjual != null ? item.totalTerjual : 0).toLocaleString('id-ID')} eks</td>
                <td class="px-4 py-1.5 sm:py-2 text-right font-mono text-xs font-bold text-blue-600 dark:text-blue-300">${formatRupiah(item.totalNominal || 0)}</td>
                <td class="px-4 py-1.5 sm:py-2 text-right font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">${formatRupiah(bagianSekolah)}</td>
            </tr>
        `;
    });

    // Grand Total Row
    html += `
        <tr class="bg-slate-100 dark:bg-slate-700/60 font-bold border-t-2 border-slate-300 dark:border-slate-600">
            <td colspan="3" class="px-4 py-2 text-right text-xs uppercase tracking-wide">Total Seluruh Guru (Proporsional):</td>
            <td class="px-4 py-2 text-center font-mono text-xs">${filtered.length} Guru</td>
            <td class="px-4 py-2 text-right font-mono text-xs text-emerald-600">${grandTerjual.toLocaleString('id-ID')} eks</td>
            <td class="px-4 py-2 text-right font-mono text-xs text-blue-700 dark:text-blue-300">${formatRupiah(grandNominal)}</td>
            <td class="px-4 py-2 text-right font-mono text-xs text-emerald-700 dark:text-emerald-300 font-bold">${formatRupiah(grandBagianSekolah)}</td>
        </tr>
    `;

    tbody.innerHTML = html;
}

/**
 * Format tanggal ringkas ke format d/m/yy (misal: 4/10/26) tanpa semester
 */
export function formatDateShortDmy(dateStr) {
    if (!dateStr) return '-';
    const str = String(dateStr).trim();
    const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
        const y = isoMatch[1].slice(-2);
        const m = parseInt(isoMatch[2], 10);
        const d = parseInt(isoMatch[3], 10);
        return `${d}/${m}/${y}`;
    }
    const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (dmyMatch) {
        const d = parseInt(dmyMatch[1], 10);
        const m = parseInt(dmyMatch[2], 10);
        const y = dmyMatch[3].slice(-2);
        return `${d}/${m}/${y}`;
    }
    const dt = new Date(str);
    if (!isNaN(dt.getTime())) {
        const d = dt.getDate();
        const m = dt.getMonth() + 1;
        const y = String(dt.getFullYear()).slice(-2);
        return `${d}/${m}/${y}`;
    }
    return str;
}

export function renderTransactionsTable(txList) {
    const tbody = document.getElementById('table-transactions-body');
    if (!tbody) return;

    const todayStr = new Date().toISOString().slice(0, 10);
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

    const sevenDaysAgoDate = new Date();
    sevenDaysAgoDate.setDate(sevenDaysAgoDate.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgoDate.toISOString().slice(0, 10);

    const firstDayOfMonthStr = todayStr.slice(0, 7) + '-01';

    // Quick Stats Calculation (Akuntansi: Kotor, Retur, Bersih sesuai periode semester terpilih)
    const defaultPeriod = getDefaultTransactionPeriod();
    const scopeTxs = currentSelectedSemesterPeriod === 'all'
        ? txList
        : txList.filter(t => isPeriodMatch(t.periode || defaultPeriod, currentSelectedSemesterPeriod));

    const scopeSum = summarizeTransactions(scopeTxs);
    const todaySum = summarizeTransactions(scopeTxs.filter(t => t.date === todayStr));

    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    const signedRupiah = (n) => (n < 0 ? '-' : '') + formatRupiah(Math.abs(n));

    setText('tx-stat-today-qty', `${todaySum.netQty.toLocaleString('id-ID')} eks`);
    setText('tx-stat-today-nom', signedRupiah(todaySum.netNom));
    setText('tx-stat-gross-qty', `${scopeSum.grossQty.toLocaleString('id-ID')} eks`);
    setText('tx-stat-gross-nom', formatRupiah(scopeSum.grossNom));
    setText('tx-stat-return-qty', `${scopeSum.returnQty.toLocaleString('id-ID')} eks`);
    setText('tx-stat-return-nom', scopeSum.returnNom > 0 ? `-${formatRupiah(scopeSum.returnNom)}` : formatRupiah(0));
    setText('tx-stat-net-qty', `${scopeSum.netQty.toLocaleString('id-ID')} eks`);
    setText('tx-stat-net-nom', signedRupiah(scopeSum.netNom));

    // Filter Periode Semester, Filter Waktu Cepat, Jenjang, Tipe Log, Keyword
    const filtered = txList.filter(t => {
        if (currentSelectedSemesterPeriod !== 'all') {
            const p = t.periode || defaultPeriod;
            if (!isPeriodMatch(p, currentSelectedSemesterPeriod)) return false;
        }
        if (currentGradeFilter !== 'all' && String(t.grade) !== currentGradeFilter) {
            return false;
        }
        if (currentTxTypeFilter === 'sales' && isReturnTx(t)) return false;
        if (currentTxTypeFilter === 'returns' && !isReturnTx(t)) return false;
        if (currentPeriodFilter === 'today' && t.date !== todayStr) return false;
        if (currentPeriodFilter === 'yesterday' && t.date !== yesterdayStr) return false;
        if (currentPeriodFilter === '7days' && t.date < sevenDaysAgoStr) return false;
        if (currentPeriodFilter === 'month' && t.date < firstDayOfMonthStr) return false;

        if (currentSearchKeyword) {
            const kw = currentSearchKeyword.toLowerCase();
            const matchSub = (t.subject || '').toLowerCase().includes(kw);
            const matchTeach = (t.teacher || '').toLowerCase().includes(kw);
            const matchCls = (t.className || '').toLowerCase().includes(kw);
            const matchNote = (t.note || '').toLowerCase().includes(kw) || (t.reason || '').toLowerCase().includes(kw);
            if (!matchSub && !matchTeach && !matchCls && !matchNote) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="py-10 text-center text-slate-400">
                    <i class="fa-solid fa-receipt text-3xl mb-2 block"></i>
                    Belum ada riwayat transaksi yang sesuai filter.
                </td>
            </tr>
        `;
        return;
    }

    let subQty = 0;
    let subNom = 0;

    let html = '';
    filtered.forEach((tx, idx) => {
        const isRet = isReturnTx(tx);
        subQty += txNetQty(tx);
        subNom += txNetTotal(tx);

        const gradeBadge = tx.grade === 10
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
            : tx.grade === 11
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300';

        const typeBadge = isRet
            ? '<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 inline-flex items-center gap-1"><i class="fa-solid fa-arrow-rotate-left text-[10px]"></i>Retur</span>'
            : '<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 inline-flex items-center gap-1"><i class="fa-solid fa-cart-shopping text-[10px]"></i>Jual</span>';

        const returnedQty = isRet ? 0 : getReturnedQtyForTx(tx.id);
        const returnedHint = returnedQty > 0
            ? `<div class="text-[10px] font-semibold text-amber-600 mt-0.5">${returnedQty} eks diretur</div>`
            : '';

        const noteHtml = isRet
            ? `<div class="font-semibold text-amber-700 dark:text-amber-300">${escapeHTML(tx.reason || 'Retur')}</div><div>${escapeHTML(tx.note || '-')}</div>`
            : escapeHTML(tx.note || '-');

        const deleteTitle = isRet ? 'Batalkan catatan retur' : 'Hapus transaksi';
        const deleteIcon = isRet ? 'fa-rotate-right' : 'fa-trash-can';

        html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${isRet ? 'bg-amber-50/40 dark:bg-amber-950/10' : ''}">
                <td class="px-3 py-2.5 text-center font-mono text-xs text-slate-500 whitespace-nowrap">${idx + 1}</td>
                <td class="px-3 py-2.5 font-mono text-xs whitespace-nowrap">${escapeHTML(formatDateShortDmy(tx.date))}</td>
                <td class="px-2.5 py-2.5 text-center whitespace-nowrap">${typeBadge}</td>
                <td class="px-2.5 py-2.5 text-center whitespace-nowrap">
                    <span class="px-2 py-0.5 rounded text-xs font-bold font-mono ${gradeBadge}">
                        ${escapeHTML(tx.className)}
                    </span>
                </td>
                <td class="px-3.5 py-2.5 font-medium text-slate-800 dark:text-slate-200">
                    ${escapeHTML(tx.subject)}
                    ${returnedHint}
                </td>
                <td class="px-3 py-2.5 text-right font-mono text-xs font-bold whitespace-nowrap ${isRet ? 'text-amber-600' : 'text-emerald-600'}">
                    ${isRet ? '-' : ''}${(tx.qty || 0).toLocaleString('id-ID')}
                </td>
                <td class="px-3 py-2.5 text-right font-mono text-xs text-slate-500 whitespace-nowrap">
                    ${formatRupiah(tx.price)}
                </td>
                <td class="px-3.5 py-2.5 text-right font-mono text-xs font-bold whitespace-nowrap ${isRet ? 'text-rose-600 dark:text-rose-400' : 'text-blue-600 dark:text-blue-400'}">
                    ${isRet ? '-' : ''}${formatRupiah(tx.total)}
                </td>
                <td class="px-2.5 py-2.5 text-center text-xs whitespace-nowrap">
                    <span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-semibold">
                        ${escapeHTML(isRet ? (tx.refundMethod || tx.payment || '-') : (tx.payment || 'Tunai'))}
                    </span>
                </td>
                <td class="px-3.5 py-2.5 text-xs text-slate-500">
                    ${noteHtml}
                </td>
                <td class="px-3 py-2.5 text-center whitespace-nowrap">
                    <div class="flex items-center justify-center gap-1">
                        ${!isRet && getReturnableQty(tx) > 0 ? `
                        <button type="button" onclick="window.openReturnModal('${escapeHTML(tx.id)}')"
                            class="w-7 h-7 rounded text-amber-600 hover:text-amber-800 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors"
                            title="Retur buku dari transaksi ini">
                            <i class="fa-solid fa-arrow-rotate-left text-xs"></i>
                        </button>` : ''}
                        <button type="button" onclick="window.deleteTransaction('${escapeHTML(tx.id)}')"
                            class="w-7 h-7 rounded text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                            title="${deleteTitle}">
                            <i class="fa-solid ${deleteIcon} text-xs"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    html += `
        <tr class="bg-slate-100 dark:bg-slate-700/60 font-bold border-t-2 border-slate-300 dark:border-slate-600">
            <td colspan="5" class="px-3.5 py-2.5 text-right text-xs uppercase tracking-wide">Subtotal Bersih Terfilter (Jual - Retur):</td>
            <td class="px-3 py-2.5 text-right font-mono text-xs ${subQty < 0 ? 'text-amber-600' : 'text-emerald-600'}">${subQty.toLocaleString('id-ID')}</td>
            <td class="px-3 py-2.5 text-right font-mono text-xs">-</td>
            <td class="px-3.5 py-2.5 text-right font-mono text-xs ${subNom < 0 ? 'text-rose-600' : 'text-blue-700 dark:text-blue-300'}">${subNom < 0 ? '-' : ''}${formatRupiah(Math.abs(subNom))}</td>
            <td colspan="3" class="px-3.5 py-2.5 text-xs text-slate-500">${filtered.length} Log</td>
        </tr>
    `;

    tbody.innerHTML = html;
}

export function renderClassesTable(txList, booksData) {
    const tbody = document.getElementById('table-classes-body');
    if (!tbody) return;

    // Rombel seluruh jenjang
    const allRombels = [
        ...getClassesForGrade(10).map(c => ({ name: c, grade: 10 })),
        ...getClassesForGrade(11).map(c => ({ name: c, grade: 11 })),
        ...getClassesForGrade(12).map(c => ({ name: c, grade: 12 }))
    ];

    // Filter jenjang & keyword
    const filteredRombels = allRombels.filter(r => {
        if (currentGradeFilter !== 'all' && String(r.grade) !== currentGradeFilter) {
            return false;
        }
        if (currentSearchKeyword) {
            const kw = currentSearchKeyword.toLowerCase();
            return r.name.toLowerCase().includes(kw);
        }
        return true;
    });

    if (filteredRombels.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="py-10 text-center text-slate-400">
                    <i class="fa-solid fa-users-slash text-3xl mb-2 block"></i>
                    Tidak ada rombel yang sesuai filter.
                </td>
            </tr>
        `;
        return;
    }

    const defaultPeriod = getDefaultTransactionPeriod();
    const scopedTxs = currentSelectedSemesterPeriod === 'all'
        ? txList
        : txList.filter(t => isPeriodMatch(t.periode || defaultPeriod, currentSelectedSemesterPeriod));

    let grandQty = 0;
    let grandNom = 0;
    let grandTxs = 0;

    let html = '';
    filteredRombels.forEach((r, idx) => {
        const classTxs = scopedTxs.filter(t => t.className === r.name);
        const classSum = summarizeTransactions(classTxs);
        const txCount = classSum.count;
        const totalQty = classSum.netQty;
        const totalNom = classSum.netNom;

        const subjectSummary = {};
        classTxs.forEach(t => {
            subjectSummary[t.subject] = (subjectSummary[t.subject] || 0) + txNetQty(t);
        });

        grandQty += totalQty;
        grandNom += totalNom;
        grandTxs += txCount;

        const subjectBadges = Object.entries(subjectSummary).filter(([, qty]) => qty > 0).map(([sub, qty]) => `
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
                <span>${escapeHTML(sub)}</span>
                <span class="font-bold text-emerald-600 font-mono">(${qty} eks)</span>
            </span>
        `).join(' ');

        const gradeBadge = r.grade === 10
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
            : r.grade === 11
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300';

        html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td class="px-3 py-3 text-center font-mono text-xs text-slate-500">${idx + 1}</td>
                <td class="px-3 py-3 text-center">
                    <span class="px-2.5 py-1 rounded text-xs font-bold font-mono ${gradeBadge}">
                        ${escapeHTML(r.name)}
                    </span>
                </td>
                <td class="px-3 py-3 text-center text-xs font-semibold text-slate-600 dark:text-slate-400">
                    Kelas ${getGradeRoman(r.grade)}
                </td>
                <td class="px-3 py-3 text-center font-mono text-xs">
                    ${txCount > 0 ? `<span class="font-bold text-slate-800 dark:text-white">${txCount}</span> kali` : '<span class="text-slate-400">0</span>'}
                </td>
                <td class="px-4 py-3 text-right font-mono text-xs font-bold text-emerald-600">
                    ${totalQty.toLocaleString('id-ID')} eks
                </td>
                <td class="px-4 py-3 text-right font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                    ${formatRupiah(totalNom)}
                </td>
                <td class="px-4 py-3 text-xs min-w-[260px]">
                    <div class="flex flex-wrap gap-1">
                        ${subjectBadges || '<span class="text-slate-400 italic">Belum ada buku dibeli</span>'}
                    </div>
                </td>
                <td class="px-3 py-3 text-center">
                    <button type="button" onclick="window.openClassDetailModal('${escapeHTML(r.name)}')"
                        class="px-2.5 py-1 text-xs font-semibold rounded bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 transition-colors flex items-center gap-1 mx-auto">
                        <i class="fa-solid fa-list-check"></i>
                        <span>Rincian</span>
                    </button>
                </td>
            </tr>
        `;
    });

    html += `
        <tr class="bg-slate-100 dark:bg-slate-700/60 font-bold border-t-2 border-slate-300 dark:border-slate-600">
            <td colspan="3" class="px-4 py-3 text-right text-xs uppercase tracking-wide">Total Terfilter:</td>
            <td class="px-3 py-3 text-center font-mono text-xs">${grandTxs} Transaksi</td>
            <td class="px-4 py-3 text-right font-mono text-xs text-emerald-600">${grandQty.toLocaleString('id-ID')} eks</td>
            <td class="px-4 py-3 text-right font-mono text-xs text-blue-700 dark:text-blue-300">${formatRupiah(grandNom)}</td>
            <td colspan="2" class="px-4 py-3 text-xs text-slate-500">${filteredRombels.length} Rombel</td>
        </tr>
    `;

    tbody.innerHTML = html;
}

export function renderStockTable(data) {
    const tbody = document.getElementById('table-stock-body');
    if (!tbody) return;

    const defaultPeriod = getDefaultTransactionPeriod();

    // Filter buku aktif (Zero Stale Books) + filter jenjang & keyword
    const filtered = data.filter(item => {
        if (item.isActive === false) return false;
        if (currentGradeFilter !== 'all' && String(item.grade) !== currentGradeFilter) {
            return false;
        }
        if (currentSearchKeyword) {
            const kw = currentSearchKeyword.toLowerCase();
            const matchSub = (item.subject || '').toLowerCase().includes(kw);
            const matchTeach = (item.teacherNamesStr || '').toLowerCase().includes(kw);
            if (!matchSub && !matchTeach) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="py-10 text-center text-slate-400">
                    <i class="fa-solid fa-boxes-stacked text-3xl mb-2 block"></i>
                    Tidak ada stok buku yang sesuai filter.
                </td>
            </tr>
        `;
        return;
    }

    const booksWithSales = getBooksWithPeriodSales(filtered, currentTransactions, currentSelectedSemesterPeriod);

    let grandTerima = 0;
    let grandDiam = 0;
    let grandTerjual = 0;
    let grandSisa = 0;
    let grandNilaiSisa = 0;

    let html = '';
    booksWithSales.forEach((row, idx) => {
        const rowTerjual = row.terjual || 0;
        const sisaNyata = row.sisa;
        const nilaiSisa = sisaNyata * (row.harga || 0);

        grandTerima += parseNumberSafe(row.terima, 0);
        grandDiam += parseNumberSafe(row.diam, 0);
        grandTerjual += parseNumberSafe(rowTerjual, 0);
        grandSisa += parseNumberSafe(sisaNyata, 0);
        grandNilaiSisa += parseNumberSafe(nilaiSisa, 0);

        // Status Stok
        let statusBadge = '';
        if (sisaNyata <= 0) {
            statusBadge = '<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">Habis</span>';
        } else if (sisaNyata < 10) {
            statusBadge = '<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Kritis</span>';
        } else {
            statusBadge = '<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Tersedia</span>';
        }

        const gradeBadge = row.grade === 10
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
            : row.grade === 11
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300';

        html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td class="px-3 py-3 text-center font-mono text-xs text-slate-500">${idx + 1}</td>
                <td class="px-3 py-3 text-center">
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${gradeBadge}">${getGradeRoman(row.grade)}</span>
                </td>
                <td class="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                    ${escapeHTML(row.subject)}
                </td>
                <td class="px-3 py-3 text-right font-mono text-xs">${(row.terima || 0).toLocaleString('id-ID')}</td>
                <td class="px-3 py-3 text-right font-mono text-xs text-amber-600">${row.diam ? row.diam.toLocaleString('id-ID') : '-'}</td>
                <td class="px-3 py-3 text-right font-mono text-xs font-bold text-emerald-600">${rowTerjual.toLocaleString('id-ID')}</td>
                <td class="px-3 py-3 text-right font-mono text-xs font-extrabold text-blue-600 dark:text-blue-400">
                    ${sisaNyata.toLocaleString('id-ID')}
                </td>
                <td class="px-3 py-3 text-center">${statusBadge}</td>
                <td class="px-3 py-3 text-right font-mono text-xs text-slate-500">${formatRupiah(row.harga)}</td>
                <td class="px-4 py-3 text-right font-mono text-xs font-bold text-slate-700 dark:text-slate-300">${formatRupiah(nilaiSisa)}</td>
                <td class="px-4 py-3 text-xs text-slate-500 max-w-[220px] truncate" title="${escapeHTML(row.teacherNamesStr || '')}">
                    ${escapeHTML(row.teacherNamesStr || '-')}
                </td>
            </tr>
        `;
    });

    html += `
        <tr class="bg-slate-100 dark:bg-slate-700/60 font-bold border-t-2 border-slate-300 dark:border-slate-600">
            <td colspan="3" class="px-4 py-3 text-right text-xs uppercase tracking-wide">Total Stok Terfilter:</td>
            <td class="px-3 py-3 text-right font-mono text-xs">${grandTerima.toLocaleString('id-ID')}</td>
            <td class="px-3 py-3 text-right font-mono text-xs text-amber-600">${grandDiam.toLocaleString('id-ID')}</td>
            <td class="px-3 py-3 text-right font-mono text-xs text-emerald-600">${grandTerjual.toLocaleString('id-ID')}</td>
            <td class="px-3 py-3 text-right font-mono text-xs text-blue-700 dark:text-blue-300">${grandSisa.toLocaleString('id-ID')}</td>
            <td class="px-3 py-3 text-center">-</td>
            <td class="px-3 py-3 text-right font-mono text-xs">-</td>
            <td class="px-4 py-3 text-right font-mono text-xs text-blue-700 dark:text-blue-300">${formatRupiah(grandNilaiSisa)}</td>
            <td class="px-4 py-3 text-xs text-slate-500">${filtered.length} Judul Buku</td>
        </tr>
    `;

    tbody.innerHTML = html;
}

export function renderCirculationTable(circList) {
    const tbody = document.getElementById('table-circulation-body');
    if (!tbody) return;

    const defaultPeriod = getDefaultTransactionPeriod();
    const periodScopedList = (currentSelectedSemesterPeriod === 'all')
        ? circList
        : circList.filter(c => (c.periode || defaultPeriod) === currentSelectedSemesterPeriod);

    // Quick Stats Calculation
    let totalReceived = 0;
    let totalTeacher = 0;
    let totalReturned = 0;

    periodScopedList.forEach(c => {
        const qty = c.qty || 0;
        if (c.type === 'terima') {
            totalReceived += qty;
        } else if (c.type === 'pengambilan_guru') {
            totalTeacher += qty;
        } else if (c.type === 'retur_penerbit') {
            totalReturned += qty;
        }
    });

    const elReceived = document.getElementById('circ-stat-received');
    const elTeacher = document.getElementById('circ-stat-teacher');
    const elReturned = document.getElementById('circ-stat-returned');

    if (elReceived) elReceived.textContent = `${totalReceived.toLocaleString('id-ID')} eks`;
    if (elTeacher) elTeacher.textContent = `${totalTeacher.toLocaleString('id-ID')} eks`;
    if (elReturned) elReturned.textContent = `${totalReturned.toLocaleString('id-ID')} eks`;

    // Filter Jenjang, Jenis Mutasi, Keyword
    const filtered = periodScopedList.filter(c => {
        if (currentGradeFilter !== 'all' && String(c.grade) !== currentGradeFilter) {
            return false;
        }
        if (currentCirculationFilter !== 'all' && c.type !== currentCirculationFilter) {
            return false;
        }
        if (currentSearchKeyword) {
            const kw = currentSearchKeyword.toLowerCase();
            const matchSub = (c.subject || '').toLowerCase().includes(kw);
            const matchParty = (c.party || '').toLowerCase().includes(kw);
            const matchNote = (c.note || '').toLowerCase().includes(kw);
            if (!matchSub && !matchParty && !matchNote) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="py-10 text-center text-slate-400">
                    <i class="fa-solid fa-arrows-rotate text-3xl mb-2 block"></i>
                    Belum ada riwayat mutasi sirkulasi buku yang sesuai filter.
                </td>
            </tr>
        `;
        return;
    }

    let subQty = 0;
    let html = '';

    filtered.forEach((c, idx) => {
        subQty += c.qty || 0;

        let typeBadge = '';

        if (c.type === 'pengambilan_guru') {
            typeBadge = '<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 inline-flex items-center gap-1 w-fit mx-auto whitespace-nowrap"><i class="fa-solid fa-chalkboard-user text-[10px]"></i>Pengambilan Guru</span>';
        } else if (c.type === 'terima') {
            typeBadge = '<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300 inline-flex items-center gap-1 w-fit mx-auto whitespace-nowrap"><i class="fa-solid fa-truck-ramp-box text-[10px]"></i>Penerimaan Vendor</span>';
        } else {
            typeBadge = '<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 inline-flex items-center gap-1 w-fit mx-auto whitespace-nowrap"><i class="fa-solid fa-reply text-[10px]"></i>Retur Percetakan</span>';
        }

        const gradeBadge = c.grade === 10
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
            : c.grade === 11
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300';

        html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td class="px-3 py-2.5 text-center font-mono text-xs text-slate-500 whitespace-nowrap">${idx + 1}</td>
                <td class="px-3 py-2.5 font-mono text-xs whitespace-nowrap">${escapeHTML(formatDateShortDmy(c.date))}</td>
                <td class="px-2.5 py-2.5 text-center whitespace-nowrap">${typeBadge}</td>
                <td class="px-2.5 py-2.5 text-center whitespace-nowrap">
                    <span class="px-2 py-0.5 rounded text-xs font-bold font-mono ${gradeBadge}">${escapeHTML(getGradeRoman(c.grade))}</span>
                </td>
                <td class="px-3.5 py-2.5 font-medium text-slate-800 dark:text-slate-200">
                    ${escapeHTML(c.subject)}
                </td>
                <td class="px-3 py-2.5 text-right font-mono text-xs font-bold text-slate-800 dark:text-white whitespace-nowrap">
                    ${(c.qty || 0).toLocaleString('id-ID')} eks
                </td>
                <td class="px-3.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <div class="flex items-center gap-1.5">
                        <i class="fa-solid fa-user-tag text-slate-400"></i>
                        <span>${escapeHTML(c.party || '-')}</span>
                    </div>
                </td>
                <td class="px-3.5 py-2.5 text-xs text-slate-500">
                    ${escapeHTML(c.note || '-')}
                </td>
                <td class="px-3 py-2.5 text-center whitespace-nowrap">
                    <button type="button" onclick="window.deleteCirculation('${c.id}')"
                        class="w-7 h-7 rounded text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                        title="Hapus riwayat mutasi">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    html += `
        <tr class="bg-slate-100 dark:bg-slate-700/60 font-bold border-t-2 border-slate-300 dark:border-slate-600">
            <td colspan="5" class="px-3.5 py-2.5 text-right text-xs uppercase tracking-wide">Subtotal Eksemplar:</td>
            <td class="px-3 py-2.5 text-right font-mono text-xs text-slate-900 dark:text-white whitespace-nowrap">${subQty.toLocaleString('id-ID')} eks</td>
            <td colspan="3" class="px-3.5 py-2.5 text-xs text-slate-500">${filtered.length} Mutasi Sirkulasi Terfilter</td>
        </tr>
    `;

    tbody.innerHTML = html;
}

export function renderPriceSettingsTable() {
    const tbody = document.getElementById('table-settings-price-body');
    if (!tbody) return;

    const data = (currentMatchedData && currentMatchedData.length > 0) ? currentMatchedData : DEFAULT_BOOK_SALES_DATA;

    // Filter jenjang, status visibilitas & keyword
    const filtered = data.filter(item => {
        if (currentGradeFilter !== 'all' && String(item.grade) !== currentGradeFilter) {
            return false;
        }
        if (currentSettingsStatusFilter === 'active' && item.isActive === false) {
            return false;
        }
        if (currentSettingsStatusFilter === 'inactive' && item.isActive !== false) {
            return false;
        }
        if (currentSearchKeyword) {
            const kw = currentSearchKeyword.toLowerCase();
            const matchSub = (item.subject || '').toLowerCase().includes(kw);
            if (!matchSub) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="py-12 text-center text-slate-400">
                    <i class="fa-solid fa-book-bookmark text-3xl mb-2.5 block text-slate-300 dark:text-slate-600"></i>
                    <p class="font-medium text-slate-600 dark:text-slate-300">Belum ada buku pelajaran yang sesuai kriteria.</p>
                    <p class="text-xs text-slate-400 mt-1">Klik "+ Tambah" atau "Tarik XML" di toolbar atas untuk mendaftarkan buku.</p>
                </td>
            </tr>
        `;
        return;
    }

    let html = '';

    filtered.forEach((row, idx) => {
        const currentHarga = row.harga || 0;

        const gradeBadge = row.grade === 10
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
            : row.grade === 11
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300';

        const isRowActive = row.isActive !== false;
        const statusBadge = isRowActive
            ? `<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 inline-flex items-center gap-1"><i class="fa-solid fa-circle-check text-[10px]"></i> Tampil</span>`
            : `<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700 inline-flex items-center gap-1"><i class="fa-solid fa-eye-slash text-[10px]"></i> Sembunyi</span>`;

        const inputId = `price-input-${row.grade}-${idx}`;

        const toggleKey = `${row.grade}_${row.subject}`;
        const isTogglingVis = pendingVisibilityToggles.has(toggleKey);
        const isSavingPrice = pendingPriceSaves.has(toggleKey);

        html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${!isRowActive ? 'opacity-60 bg-slate-50/50 dark:bg-slate-900/20' : ''}">
                <td class="px-3 py-3 text-center font-mono text-xs text-slate-500">${idx + 1}</td>
                <td class="px-3 py-3 text-center">
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${gradeBadge}">${getGradeRoman(row.grade)}</span>
                </td>
                <td class="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                    <div class="flex items-center gap-1.5">
                        <span>${escapeHTML(row.subject)}</span>
                        ${row.periode ? `<span class="px-1.5 py-0.2 rounded text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-mono">${escapeHTML(row.periode)}</span>` : ''}
                    </div>
                </td>
                <td class="px-3 py-3 text-center">
                    ${statusBadge}
                </td>
                <td class="px-4 py-2 text-center">
                    <input type="text" inputmode="numeric" id="${inputId}" value="${currentHarga > 0 ? currentHarga.toLocaleString('id-ID') : '0'}"
                        data-grade="${row.grade}" data-subject="${escapeHTML(row.subject)}" oninput="window.formatCurrencyInput(this)"
                        class="w-36 px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 font-mono font-bold text-right focus:ring-2 focus:ring-blue-500 focus:outline-hidden">
                </td>
                <td class="px-3 py-3 text-center">
                    <div class="flex items-center justify-center gap-1.5">
                        ${isSavingPrice ? `
                            <button type="button" disabled
                                class="px-2.5 py-1 text-xs font-bold rounded bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 inline-flex items-center gap-1 cursor-wait opacity-80" title="Sedang Menyimpan Harga ke Server...">
                                <i class="fa-solid fa-spinner fa-spin text-xs text-blue-500"></i>
                                <span>Menyimpan...</span>
                            </button>
                        ` : `
                            <button type="button" onclick="window.onRowPriceSave('${row.grade}', '${encodeURIComponent(row.subject)}', '${inputId}', this)"
                                class="px-2.5 py-1 text-xs font-bold rounded bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 transition-colors inline-flex items-center gap-1 cursor-pointer" title="Simpan Harga Satuan">
                                <i class="fa-solid fa-floppy-disk"></i>
                                <span>Simpan</span>
                            </button>
                        `}
                        ${isTogglingVis ? `
                            <button type="button" disabled
                                class="w-7 h-7 rounded text-amber-500 bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center cursor-wait opacity-80"
                                title="Sedang menyimpan perubahan status ke server...">
                                <i class="fa-solid fa-spinner fa-spin text-xs"></i>
                            </button>
                        ` : `
                            <button type="button" onclick="window.toggleBookVisibility('${row.grade}', '${encodeURIComponent(row.subject)}', this)"
                                class="w-7 h-7 rounded ${!isRowActive ? 'text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40' : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40'} flex items-center justify-center transition-colors cursor-pointer"
                                title="${!isRowActive ? 'Aktifkan Mapel (Tampilkan Buku)' : 'Sembunyikan Mapel (Tidak Ada Buku Fisik)'}">
                                <i class="fa-solid ${!isRowActive ? 'fa-eye' : 'fa-eye-slash'} text-xs"></i>
                            </button>
                        `}
                        <button type="button" onclick="window.deleteBookEntry('${row.grade}', '${encodeURIComponent(row.subject)}')"
                            class="w-7 h-7 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center transition-colors cursor-pointer" title="Hapus Buku">
                            <i class="fa-solid fa-trash-can text-xs"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    const activeCount = filtered.filter(b => b.isActive !== false).length;
    const inactiveCount = filtered.length - activeCount;

    html += `
        <tr class="bg-slate-100 dark:bg-slate-700/60 font-bold border-t-2 border-slate-300 dark:border-slate-600">
            <td colspan="3" class="px-4 py-3 text-right text-xs uppercase tracking-wide">Ringkasan Terfilter:</td>
            <td class="px-3 py-3 text-center font-mono text-xs text-slate-600 dark:text-slate-300">${activeCount} Tampil / ${inactiveCount} Sembunyi</td>
            <td class="px-4 py-3 text-center font-mono text-xs text-slate-600 dark:text-slate-300">${filtered.length} Judul Buku</td>
            <td class="px-3 py-3 text-center">-</td>
        </tr>
    `;

    tbody.innerHTML = html;
}

export function switchRecapSubView(subViewKey) {
    currentRecapSubView = subViewKey || 'books';
    const subViews = ['books', 'teachers', 'classes'];
    subViews.forEach(sv => {
        const btn = document.getElementById(`subview-btn-${sv}`);
        const pnl = document.getElementById(`subview-panel-${sv}`);
        const isActive = (sv === currentRecapSubView);
        if (btn) {
            if (isActive) {
                btn.className = 'h-8 px-2.5 sm:px-3 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-2xs cursor-pointer';
            } else {
                btn.className = 'h-8 px-2.5 sm:px-3 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-all flex items-center gap-1.5 cursor-pointer';
            }
        }
        if (pnl) {
            if (isActive) {
                pnl.classList.remove('hidden');
            } else {
                pnl.classList.add('hidden');
            }
        }
    });

    const descEl = document.getElementById('recap-subview-description');
    if (descEl) {
        if (currentRecapSubView === 'books') {
            descEl.textContent = 'Ringkasan total penjualan dan eksemplar per judul buku pelajaran';
        } else if (currentRecapSubView === 'teachers') {
            descEl.textContent = 'Rekapitulasi beban rombel dan royalti proporsional per guru pengajar';
        } else if (currentRecapSubView === 'classes') {
            descEl.textContent = 'Rekapitulasi distribusi buku dan transaksi pembelian per rombel kelas';
        }
    }

    if (currentRecapSubView === 'books') {
        renderBooksTable(currentMatchedData);
    } else if (currentRecapSubView === 'teachers') {
        renderTeachersTable(currentMatchedData);
    } else if (currentRecapSubView === 'classes') {
        renderClassesTable(currentTransactions, currentMatchedData);
    }
}

// ==========================================
// KONTROL AKSES BERBASIS PERAN (ROLE-BASED ACCESS CONTROL - RBAC)
// Super Admin: Akses Penuh (rw) ke semua tab termasuk Tab Pengaturan dan Kelola Kas Manual
// Admin LKS: Tab Pengaturan diblokir total & Tab Arus Kas hanya dapat melihat saja (Read-Only)
// ==========================================

/**
 * Helper aman untuk menampilkan pesan toast notifikasi (mendukung fungsi global atau window.showToast)
 */
export function safeToast(title, msg, type = 'info') {
    if (typeof showToast === 'function') {
        showToast(title, msg, type);
    } else if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast(title, msg, type);
    }
}

/**
 * Mengecek apakah pengguna saat ini berwenang sebagai Super Admin (Full Access).
 * Jika role eksplisit adalah 'admin_lks' (dan tanpa peran multi-role super_admin), maka mengembalikan false (terbatas).
 * Jika role adalah 'super_admin' atau di lingkungan tanpa batasan role, mengembalikan true.
 */
export function isSuperAdmin() {
    let role = null;
    try {
        role = typeof localStorage !== 'undefined' ? localStorage.getItem('user_role') : null;
    } catch (e) {}

    // Jika memiliki peran ganda super_admin
    if (typeof window !== 'undefined' && typeof window.hasRole === 'function' && window.hasRole('super_admin')) {
        return true;
    }
    if (role === 'super_admin') return true;

    // Jika pengguna secara spesifik adalah admin_lks
    if (role === 'admin_lks') return false;

    // Default untuk lingkungan pengujian/pengembangan tanpa set role
    return !role;
}

/**
 * Menerapkan kontrol akses berbasis peran (RBAC) pada antarmuka Penjualan Buku:
 * - Admin LKS: Tab Pengaturan disembunyikan total, tombol aksi buat kas manual disembunyikan (Read-Only)
 * - Super Admin: Memiliki akses penuh ke seluruh tab dan fungsi
 */
export function applyRoleBasedAccessControl() {
    const isSuper = isSuperAdmin();

    // 1. Tab Pengaturan: Sembunyikan untuk Admin LKS
    const tabBtnSettings = document.getElementById('tab-btn-settings');
    if (tabBtnSettings && tabBtnSettings.classList) {
        if (isSuper) {
            tabBtnSettings.classList.remove('hidden');
        } else {
            tabBtnSettings.classList.add('hidden');
        }
    }

    // 2. Tab Arus Kas: Sembunyikan tombol Pemasukan & Pengeluaran untuk Admin LKS
    const cfActionsContainer = document.getElementById('cashflow-actions-container');
    if (cfActionsContainer && cfActionsContainer.classList) {
        if (isSuper) {
            cfActionsContainer.classList.remove('hidden');
        } else {
            cfActionsContainer.classList.add('hidden');
        }
    }
}

// ==========================================
// BUKU ARUS KAS & SALDO KAS RIIL ADMIN LKS (CASH FLOW)
// ==========================================

/**
 * Mengecek apakah metode pembayaran transaksi adalah tunai / kas fisik (case-insensitive & resilient)
 */
export function isCashTx(t) {
    if (!t) return false;
    if (!t.payment) return true; // default tunai jika tidak terdefinisi
    const p = String(t.payment).trim().toLowerCase();
    return p === 'tunai' || p === 'cash';
}

/**
 * Menghitung ringkasan arus kas riil admin LKS (tunai/cash) pada periode semester tertentu
 */
export function calculateCashFlowSummary(targetPeriod = null) {
    const period = targetPeriod || currentSelectedSemesterPeriod;

    // 1. Transaksi Penjualan Tunai & Retur Tunai (dalam periode semester terpilih)
    const defaultPeriod = getDefaultTransactionPeriod();
    const periodTx = currentTransactions.filter(t => {
        const txPeriod = t.periode || t.period || defaultPeriod;
        return isPeriodMatch(txPeriod, period);
    });

    let salesCashTotal = 0;
    let returnsCashTotal = 0;

    periodTx.forEach(t => {
        const amount = parseNumberSafe(t.total, 0);
        if (isCashTx(t)) {
            if (isReturnTx(t)) {
                returnsCashTotal += amount;
            } else {
                salesCashTotal += amount;
            }
        }
    });

    // 2. Mutasi Kas Manual (dalam periode semester terpilih)
    const periodCf = currentCashFlows.filter(cf => {
        const cfPeriod = cf.period || cf.periode || defaultPeriod;
        return isPeriodMatch(cfPeriod, period);
    });

    let manualInTotal = 0;
    let manualOutTotal = 0;

    periodCf.forEach(cf => {
        const amt = parseNumberSafe(cf.amount, 0);
        if (cf.type === 'in') {
            manualInTotal += amt;
        } else if (cf.type === 'out') {
            manualOutTotal += amt;
        }
    });

    const totalCashIn = salesCashTotal + manualInTotal;
    const totalCashOut = returnsCashTotal + manualOutTotal;
    const currentCashBalance = totalCashIn - totalCashOut;

    return {
        period,
        salesCashTotal,
        returnsCashTotal,
        manualInTotal,
        manualOutTotal,
        totalCashIn,
        totalCashOut,
        currentCashBalance
    };
}

/**
 * Memperbarui strip Saldo Kas Riil Admin LKS di atas sub-toolbar tab transaksi
 */
export function updateTxCashSummary() {
    const summary = calculateCashFlowSummary();
    const elCash = document.getElementById('tx-cash-in-hand');
    const elHint = document.getElementById('tx-cash-summary-hint');
    if (elCash) {
        elCash.textContent = formatRupiah(summary.currentCashBalance);
        if (summary.currentCashBalance < 0) {
            elCash.className = 'text-lg sm:text-xl font-extrabold font-mono text-rose-600 dark:text-rose-400';
        } else {
            elCash.className = 'text-lg sm:text-xl font-extrabold font-mono text-emerald-700 dark:text-emerald-400';
        }
    }
    if (elHint) {
        elHint.textContent = `(Masuk ${formatRupiah(summary.totalCashIn)} • Keluar/Setor ${formatRupiah(summary.totalCashOut)})`;
    }
}

/**
 * Menghasilkan data buku kas kronologis lengkap dengan Running Balance
 */
export function generateCashFlowLedger(targetPeriod = null, filterType = 'all') {
    const period = targetPeriod || currentSelectedSemesterPeriod;
    const filter = filterType || currentCashFlowFilter || 'all';
    const defaultPeriod = getDefaultTransactionPeriod();

    const entries = [];

    // 1. Ambil transaksi penjualan dan retur tunai
    currentTransactions.forEach(t => {
        const txPeriod = t.periode || t.period || defaultPeriod;
        if (!isPeriodMatch(txPeriod, period)) return;

        if (!isCashTx(t)) return; // hanya mutasi uang fisik (tunai)

        const isRet = isReturnTx(t);
        const amount = parseNumberSafe(t.total, 0);
        const date = t.date || (t.createdAt ? t.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10));

        if (isRet) {
            entries.push({
                id: t.id,
                date,
                timestamp: new Date(t.createdAt || t.date || 0).getTime(),
                origin: 'returns',
                type: 'out',
                categoryLabel: 'Refund Retur Siswa',
                categoryBadge: '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Refund Retur</span>',
                sourceText: t.className || (t.grade ? 'Kelas ' + getGradeRoman(t.grade) : (t.studentName || '-')),
                description: `Retur ${t.subject || 'Buku LKS'} (${t.qty} eks) - ${t.notes || t.reason || 'Batal beli'}`,
                cashIn: 0,
                cashOut: amount,
                isManual: false
            });
        } else {
            entries.push({
                id: t.id,
                date,
                timestamp: new Date(t.createdAt || t.date || 0).getTime(),
                origin: 'sales',
                type: 'in',
                categoryLabel: 'Penjualan Buku',
                categoryBadge: '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">Penjualan</span>',
                sourceText: t.className || (t.grade ? 'Kelas ' + getGradeRoman(t.grade) : '-'),
                description: `Penjualan ${t.subject || 'Buku LKS'} (${t.qty} eks) - ${t.notes || 'Tunai'}`,
                cashIn: amount,
                cashOut: 0,
                isManual: false
            });
        }
    });

    // 2. Ambil mutasi kas manual
    currentCashFlows.forEach(cf => {
        const cfPeriod = cf.period || cf.periode || defaultPeriod;
        if (!isPeriodMatch(cfPeriod, period)) return;

        const amount = parseNumberSafe(cf.amount, 0);
        const date = cf.date || (cf.createdAt ? cf.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10));

        let categoryLabel = 'Kas Manual';
        let categoryBadge = '';

        if (cf.type === 'in') {
            if (cf.category === 'modal_awal') {
                categoryLabel = 'Modal Awal Kas';
                categoryBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Modal Awal</span>';
            } else if (cf.category === 'dana_tambahan') {
                categoryLabel = 'Dana Tambahan';
                categoryBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300">Tambahan Kas</span>';
            } else {
                categoryLabel = 'Kas Masuk Manual';
                categoryBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Kas Masuk</span>';
            }
        } else {
            if (cf.category === 'setor_bendahara') {
                categoryLabel = 'Setoran Bendahara';
                categoryBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">Setor Bendahara</span>';
            } else if (cf.category === 'operasional') {
                categoryLabel = 'Biaya Operasional';
                categoryBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">Operasional</span>';
            } else if (cf.category === 'ongkir_vendor') {
                categoryLabel = 'Ongkir / Ekspedisi';
                categoryBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Ongkir Vendor</span>';
            } else {
                categoryLabel = 'Kas Keluar Manual';
                categoryBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">Kas Keluar</span>';
            }
        }

        entries.push({
            id: cf.id,
            date,
            timestamp: new Date(cf.createdAt || cf.date || 0).getTime(),
            origin: cf.type === 'in' ? 'manual_in' : 'manual_out',
            type: cf.type,
            categoryLabel,
            categoryBadge,
            sourceText: cf.pic ? `PIC: ${cf.pic}` : 'Admin LKS',
            description: cf.note || '-',
            cashIn: cf.type === 'in' ? amount : 0,
            cashOut: cf.type === 'out' ? amount : 0,
            isManual: true
        });
    });

    // 3. Urutkan secara kronologis ascending (lama -> baru) untuk menghitung Saldo Berjalan (Running Balance)
    entries.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return (a.timestamp || 0) - (b.timestamp || 0);
    });

    let runningBalance = 0;
    entries.forEach(e => {
        runningBalance = runningBalance + e.cashIn - e.cashOut;
        e.balanceAfter = runningBalance;
    });

    // 4. Terapkan filter yang dipilih
    let filtered = entries;
    if (filter === 'in') {
        filtered = entries.filter(e => e.cashIn > 0);
    } else if (filter === 'out') {
        filtered = entries.filter(e => e.cashOut > 0);
    } else if (filter === 'sales') {
        filtered = entries.filter(e => e.origin === 'sales');
    } else if (filter === 'returns') {
        filtered = entries.filter(e => e.origin === 'returns');
    } else if (filter === 'manual_in') {
        filtered = entries.filter(e => e.origin === 'manual_in');
    } else if (filter === 'manual_out') {
        filtered = entries.filter(e => e.origin === 'manual_out');
    }

    // Keyword search filter
    if (currentSearchKeyword) {
        const kw = currentSearchKeyword.toLowerCase();
        filtered = filtered.filter(e => {
            return (e.description || '').toLowerCase().includes(kw) ||
                   (e.sourceText || '').toLowerCase().includes(kw) ||
                   (e.categoryLabel || '').toLowerCase().includes(kw);
        });
    }

    // 5. Urutkan descending (terbaru di atas) agar user langsung melihat mutasi kas terkini
    return filtered.slice().reverse();
}

/**
 * Merender 4 Kartu KPI Arus Kas dan Buku Kas Ledger
 */
export function renderCashFlowTable() {
    const summary = calculateCashFlowSummary();

    // 1. Update 4 Kartu KPI Arus Kas (Mendukung ID riil di HTML dan fallback test)
    const kpiBalance = document.getElementById('cf-kpi-real-cash') || document.getElementById('cf-kpi-balance');
    const kpiBalanceSub = document.getElementById('cf-kpi-real-cash-sub') || document.getElementById('cf-kpi-balance-sub');
    const kpiSales = document.getElementById('cf-kpi-sales-cash') || document.getElementById('cf-kpi-sales');
    const kpiSalesSub = document.getElementById('cf-kpi-sales-cash-sub') || document.getElementById('cf-kpi-sales-sub');
    const kpiManualIn = document.getElementById('cf-kpi-manual-in');
    const kpiManualInSub = document.getElementById('cf-kpi-manual-in-sub');
    const kpiManualOut = document.getElementById('cf-kpi-manual-out');
    const kpiManualOutSub = document.getElementById('cf-kpi-manual-out-sub');

    if (kpiBalance) kpiBalance.textContent = formatRupiah(summary.currentCashBalance);
    if (kpiBalanceSub) kpiBalanceSub.textContent = `Masuk: ${formatRupiah(summary.totalCashIn)} • Keluar: ${formatRupiah(summary.totalCashOut)}`;
    if (kpiSales) kpiSales.textContent = formatRupiah(summary.salesCashTotal);
    if (kpiSalesSub) kpiSalesSub.textContent = `Refund Retur: ${formatRupiah(summary.returnsCashTotal)}`;
    if (kpiManualIn) kpiManualIn.textContent = formatRupiah(summary.manualInTotal);
    if (kpiManualInSub) kpiManualInSub.textContent = `Modal awal & dana masuk manual`;
    if (kpiManualOut) kpiManualOut.textContent = formatRupiah(summary.manualOutTotal);
    if (kpiManualOutSub) kpiManualOutSub.textContent = `Setoran bendahara & operasional`;

    // Sinkronkan juga strip kas di atas tab transaksi
    updateTxCashSummary();

    // Pastikan kontrol akses tombol aksi kas tersinkronkan
    applyRoleBasedAccessControl();

    // 2. Render Tabel Ledger Buku Kas (Desktop) & Card Feed (Mobile)
    const tbody = document.getElementById('table-cashflow-body');
    const mobileContainer = document.getElementById('cashflow-mobile-list');
    if (!tbody && !mobileContainer) return;

    const ledger = generateCashFlowLedger(currentSelectedSemesterPeriod, currentCashFlowFilter);

    if (ledger.length === 0) {
        const emptyMsg = `Belum ada catatan mutasi kas untuk filter ini di periode semester ${formatSemesterPeriodShort(currentSelectedSemesterPeriod)}.`;
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="py-10 text-center text-slate-400">
                        <i class="fa-solid fa-wallet text-3xl mb-2 block opacity-40"></i>
                        ${escapeHTML(emptyMsg)}
                    </td>
                </tr>
            `;
        }
        if (mobileContainer) {
            mobileContainer.innerHTML = `
                <div class="py-10 px-4 text-center text-slate-400">
                    <i class="fa-solid fa-wallet text-3xl mb-2 block opacity-40"></i>
                    <p class="text-xs">${escapeHTML(emptyMsg)}</p>
                </div>
            `;
        }
        return;
    }

    const canManageCash = isSuperAdmin();

    let rowsHtml = '';
    let mobileCardsHtml = '';
    ledger.forEach((item, idx) => {
        const inStr = item.cashIn > 0 ? formatRupiah(item.cashIn) : '-';
        const outStr = item.cashOut > 0 ? formatRupiah(item.cashOut) : '-';
        const balStr = formatRupiah(item.balanceAfter);

        const deleteBtn = item.isManual
            ? (canManageCash
                ? `<button type="button" onclick="window.deleteCashFlow('${escapeHTML(item.id)}')"
                       class="w-7 h-7 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 inline-flex items-center justify-center transition-colors cursor-pointer" title="Hapus Catatan Kas Manual">
                       <i class="fa-solid fa-trash text-xs"></i>
                   </button>`
                : `<span class="text-[10px] text-slate-400 font-mono italic">Manual</span>`)
            : `<span class="text-[10px] text-slate-400 font-mono italic">Otomatis</span>`;

        // Render Baris Tabel Desktop
        rowsHtml += `
            <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                <td class="px-3.5 py-3 text-center font-mono text-slate-400">${idx + 1}</td>
                <td class="px-3 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300 font-medium">
                    ${escapeHTML(item.date)}
                </td>
                <td class="px-3 py-3 text-center">
                    ${item.categoryBadge}
                </td>
                <td class="px-3 py-3 text-center text-slate-600 dark:text-slate-300 font-medium">
                    ${escapeHTML(item.sourceText)}
                </td>
                <td class="px-4 py-3 text-slate-700 dark:text-slate-200">
                    ${escapeHTML(item.description)}
                </td>
                <td class="px-3 py-3 text-right font-mono font-bold ${item.cashIn > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}">
                    ${inStr}
                </td>
                <td class="px-3 py-3 text-right font-mono font-bold ${item.cashOut > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}">
                    ${outStr}
                </td>
                <td class="px-3.5 py-3 text-right font-mono font-extrabold ${item.balanceAfter < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}">
                    ${balStr}
                </td>
                <td class="px-3 py-3 text-center">
                    ${deleteBtn}
                </td>
            </tr>
        `;

        // Render Kartu Mobile Feed
        const amountDisplay = item.cashIn > 0
            ? `<span class="text-emerald-600 dark:text-emerald-400 font-mono font-extrabold text-xs">+${formatRupiah(item.cashIn)}</span>`
            : `<span class="text-rose-600 dark:text-rose-400 font-mono font-extrabold text-xs">-${formatRupiah(item.cashOut)}</span>`;

        mobileCardsHtml += `
            <div class="p-3 bg-white dark:bg-slate-800 hover:bg-slate-50/80 dark:hover:bg-slate-750 transition-colors">
                <div class="flex items-start justify-between gap-2.5">
                    <div class="min-w-0 flex-1 space-y-1">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            ${item.categoryBadge}
                            <span class="text-[11px] font-mono font-medium text-slate-500 dark:text-slate-400">${escapeHTML(item.date)}</span>
                            <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-medium">${escapeHTML(item.sourceText)}</span>
                        </div>
                        <p class="text-xs font-semibold text-slate-800 dark:text-slate-100 leading-snug break-words">
                            ${escapeHTML(item.description)}
                        </p>
                    </div>
                    <div class="text-right shrink-0">
                        <div>${amountDisplay}</div>
                        <div class="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                            Saldo: <strong class="${item.balanceAfter < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-white'}">${balStr}</strong>
                        </div>
                        ${item.isManual && canManageCash ? `<div class="mt-1 flex justify-end">${deleteBtn}</div>` : ''}
                    </div>
                </div>
            </div>
        `;
    });

    if (tbody) tbody.innerHTML = rowsHtml;
    if (mobileContainer) mobileContainer.innerHTML = mobileCardsHtml;
}

export function onCashFlowFilterChanged() {
    const sel = document.getElementById('filter-cf-type');
    if (sel) {
        currentCashFlowFilter = sel.value;
    }
    renderCashFlowTable();
}

export function openAddCashFlowModal(defaultType = 'in', initialAmount = null) {
    if (!isSuperAdmin()) {
        safeToast('Akses Terbatas', 'Admin LKS hanya memiliki izin melihat arus kas (Read-Only). Catatan kas manual hanya dapat dibuat oleh Super Admin.', 'warning');
        return;
    }

    const modal = document.getElementById('modal-cashflow');
    if (!modal) return;

    // Reset Form
    const inputDate = document.getElementById('cf-date');
    const selectPeriod = document.getElementById('cf-period');
    const selectType = document.getElementById('cf-type');
    const inputAmount = document.getElementById('cf-amount');
    const inputNote = document.getElementById('cf-note');
    const inputPic = document.getElementById('cf-pic');

    const todayStr = new Date().toISOString().slice(0, 10);
    if (inputDate) inputDate.value = todayStr;

    populateModalPeriodSelect('cf-period', currentSelectedSemesterPeriod);

    if (selectType) {
        selectType.value = defaultType === 'out' ? 'out' : 'in';
    }

    if (inputAmount) {
        inputAmount.value = initialAmount ? formatCurrencyInput(initialAmount) : '';
    }
    if (inputNote) inputNote.value = '';
    if (inputPic) inputPic.value = '';

    onCashFlowTypeChanged();
    modal.classList.remove('hidden');
}

export function closeAddCashFlowModal() {
    const modal = document.getElementById('modal-cashflow');
    if (modal) modal.classList.add('hidden');
}

export function onCashFlowTypeChanged() {
    const selectType = document.getElementById('cf-type');
    const selectCat = document.getElementById('cf-category');
    const modalTitle = document.getElementById('cf-modal-title');
    const iconContainer = document.getElementById('cf-modal-icon-container');
    const icon = document.getElementById('cf-modal-icon');
    const btnSubmit = document.getElementById('btn-submit-cashflow');

    const type = selectType ? selectType.value : 'in';

    if (type === 'out') {
        if (modalTitle) modalTitle.textContent = 'Catat Pengeluaran / Setor Kas';
        if (iconContainer) {
            iconContainer.className = 'w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold';
        }
        if (icon) {
            icon.className = 'fa-solid fa-arrow-up-from-bracket';
        }
        if (btnSubmit) {
            btnSubmit.className = 'px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold shadow-md transition-colors flex items-center gap-1.5 cursor-pointer';
            btnSubmit.innerHTML = '<i class="fa-solid fa-check"></i><span>Simpan Catatan Pengeluaran</span>';
        }
        if (selectCat) {
            selectCat.innerHTML = `
                <option value="setor_bendahara">Setoran Uang ke Bendahara Sekolah</option>
                <option value="operasional">Biaya Operasional / ATK / Plastik</option>
                <option value="ongkir_vendor">Ongkos Kirim / Ekspedisi Percetakan</option>
                <option value="lainnya_keluar">Pengeluaran Lainnya</option>
            `;
        }
    } else {
        if (modalTitle) modalTitle.textContent = 'Catat Pemasukan Kas Manual';
        if (iconContainer) {
            iconContainer.className = 'w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold';
        }
        if (icon) {
            icon.className = 'fa-solid fa-arrow-down-to-bracket';
        }
        if (btnSubmit) {
            btnSubmit.className = 'px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-md transition-colors flex items-center gap-1.5 cursor-pointer';
            btnSubmit.innerHTML = '<i class="fa-solid fa-check"></i><span>Simpan Catatan Pemasukan</span>';
        }
        if (selectCat) {
            selectCat.innerHTML = `
                <option value="modal_awal">Modal Awal Kas Kecil LKS</option>
                <option value="dana_tambahan">Tambahan Kas / Talangan</option>
                <option value="lainnya_masuk">Pemasukan Kas Lainnya</option>
            `;
        }
    }
}

export async function submitAddCashFlow(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    if (!isSuperAdmin()) {
        safeToast('Akses Ditolak', 'Hanya Super Admin yang berhak menyimpan mutasi kas manual.', 'error');
        return;
    }

    const inputDate = document.getElementById('cf-date');
    const selectPeriod = document.getElementById('cf-period');
    const selectType = document.getElementById('cf-type');
    const selectCategory = document.getElementById('cf-category');
    const inputAmount = document.getElementById('cf-amount');
    const inputNote = document.getElementById('cf-note');
    const inputPic = document.getElementById('cf-pic');

    const amount = parseNumberSafe(inputAmount?.value, 0);
    if (amount <= 0) {
        safeToast('Validasi Gagal', 'Nominal kas harus lebih dari Rp 0.', 'error');
        return;
    }

    const note = (inputNote?.value || '').trim();
    if (!note) {
        safeToast('Validasi Gagal', 'Keperluan / keterangan mutasi kas wajib diisi.', 'error');
        return;
    }

    const newEntry = {
        id: 'cf_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        date: inputDate?.value || new Date().toISOString().slice(0, 10),
        period: selectPeriod?.value || currentSelectedSemesterPeriod,
        type: selectType?.value || 'in',
        category: selectCategory?.value || (selectType?.value === 'out' ? 'setor_bendahara' : 'modal_awal'),
        amount,
        note,
        pic: (inputPic?.value || '').trim(),
        createdAt: new Date().toISOString()
    };

    currentCashFlows.unshift(newEntry);
    await saveBookSalesData();

    closeAddCashFlowModal();
    safeToast('Berhasil', `Mutasi kas sebesar ${formatRupiah(amount)} berhasil dicatat.`, 'success');

    if (currentActiveTab === 'cashflow') {
        renderCashFlowTable();
    } else {
        updateTxCashSummary();
    }
}

export async function deleteCashFlow(id) {
    if (!id) return;

    if (!isSuperAdmin()) {
        safeToast('Akses Ditolak', 'Admin LKS tidak memiliki hak menghapus catatan kas. Silakan hubungi Super Admin.', 'error');
        return;
    }

    const target = currentCashFlows.find(cf => cf.id === id);
    if (!target) return;

    const label = `${target.type === 'in' ? 'Pemasukan' : 'Pengeluaran'} ${formatRupiah(target.amount)} (${target.note || ''})`;
    const confirmed = typeof confirmDelete === 'function'
        ? await confirmDelete(`Hapus catatan kas "${label}"? Tindakan ini tidak dapat dibatalkan.`)
        : window.confirm(`Hapus catatan kas "${label}"?`);

    if (!confirmed) return;

    currentCashFlows = currentCashFlows.filter(cf => cf.id !== id);
    await saveBookSalesData();

    safeToast('Terhapus', 'Catatan kas berhasil dihapus.', 'info');
    if (currentActiveTab === 'cashflow') {
        renderCashFlowTable();
    } else {
        updateTxCashSummary();
    }
}

export function switchTab(tabKey) {
    // Backward compatibility: jika pemanggil lama memanggil 'books', 'teachers', atau 'classes'
    if (tabKey === 'books' || tabKey === 'teachers' || tabKey === 'classes') {
        currentRecapSubView = tabKey;
        tabKey = 'recap';
    } else if (tabKey === 'stock') {
        tabKey = 'recap';
    }

    // Proteksi RBAC: Tab Pengaturan dilarang untuk Admin LKS (Hanya Super Admin)
    if (tabKey === 'settings' && !isSuperAdmin()) {
        safeToast('Akses Dibatasi', 'Admin LKS tidak memiliki wewenang membuka Tab Pengaturan Master.', 'warning');
        tabKey = 'transactions';
    }

    applyRoleBasedAccessControl();

    currentActiveTab = tabKey;

    const tabKeys = ['transactions', 'orders', 'circulation', 'cashflow', 'recap', 'fees', 'analysis', 'settings'];
    tabKeys.forEach(key => {
        const btn = document.getElementById(`tab-btn-${key}`);
        const panel = document.getElementById(`tab-panel-${key}`);
        if (btn) {
            if (key === tabKey) {
                btn.className = 'pb-2 px-2.5 sm:px-3 border-b-2 border-blue-600 text-blue-600 dark:text-blue-400 font-semibold text-xs flex items-center gap-1.5 -mb-px whitespace-nowrap transition-colors cursor-pointer';
            } else {
                btn.className = 'pb-2 px-2.5 sm:px-3 border-b-2 border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium text-xs flex items-center gap-1.5 -mb-px whitespace-nowrap transition-colors cursor-pointer';
            }
        }
        if (panel) {
            if (key === tabKey) {
                panel.classList.remove('hidden');
            } else {
                panel.classList.add('hidden');
            }
        }
    });

    const filterGradeContainer = document.getElementById('filter-grade-container');
    const filterOrderClassContainer = document.getElementById('filter-order-class-container');
    if (filterGradeContainer) {
        if (tabKey === 'orders') {
            filterGradeContainer.classList.add('hidden');
        } else {
            filterGradeContainer.classList.remove('hidden');
        }
    }
    if (filterOrderClassContainer) {
        if (tabKey === 'orders') {
            filterOrderClassContainer.classList.remove('hidden');
            populateOrderClassFilter();
        } else {
            filterOrderClassContainer.classList.add('hidden');
        }
    }

    const filterDemandContainer = document.getElementById('filter-demand-container');
    // Pergantian tab mengganti className tombol; terapkan kembali visibilitas sesuai peran.
    applyRoleBasedAccessControl();
    if (filterDemandContainer) {
        if (tabKey === 'analysis') {
            filterDemandContainer.classList.remove('hidden');
        } else {
            filterDemandContainer.classList.add('hidden');
        }
    }

    const filterFeeContainer = document.getElementById('filter-fee-container');
    if (filterFeeContainer) {
        if (tabKey === 'fees') {
            filterFeeContainer.classList.remove('hidden');
        } else {
            filterFeeContainer.classList.add('hidden');
        }
    }

    const filterPeriodContainer = document.getElementById('filter-period-container');
    if (filterPeriodContainer) {
        if (tabKey === 'transactions') {
            filterPeriodContainer.classList.remove('hidden');
        } else {
            filterPeriodContainer.classList.add('hidden');
        }
    }

    const filterTxContainer = document.getElementById('filter-tx-container');
    const btnOpenReturnTx = document.getElementById('btn-open-return-tx');
    if (filterTxContainer) {
        if (tabKey === 'transactions') {
            filterTxContainer.classList.remove('hidden', '!hidden');
            if (filterTxContainer.style) {
                if (typeof filterTxContainer.style.removeProperty === 'function') {
                    filterTxContainer.style.removeProperty('display');
                } else {
                    filterTxContainer.style.display = '';
                }
            }
        } else {
            filterTxContainer.classList.add('hidden', '!hidden');
            if (filterTxContainer.style) {
                if (typeof filterTxContainer.style.setProperty === 'function') {
                    filterTxContainer.style.setProperty('display', 'none', 'important');
                } else {
                    filterTxContainer.style.display = 'none';
                }
            }
        }
    }
    if (btnOpenReturnTx) {
        if (tabKey === 'transactions') {
            btnOpenReturnTx.classList.remove('hidden', '!hidden');
            if (btnOpenReturnTx.style) {
                if (typeof btnOpenReturnTx.style.removeProperty === 'function') {
                    btnOpenReturnTx.style.removeProperty('display');
                } else {
                    btnOpenReturnTx.style.display = '';
                }
            }
        } else {
            btnOpenReturnTx.classList.add('hidden', '!hidden');
            if (btnOpenReturnTx.style) {
                if (typeof btnOpenReturnTx.style.setProperty === 'function') {
                    btnOpenReturnTx.style.setProperty('display', 'none', 'important');
                } else {
                    btnOpenReturnTx.style.display = 'none';
                }
            }
        }
    }

    const filterCirculationContainer = document.getElementById('filter-circulation-container');
    if (filterCirculationContainer) {
        if (tabKey === 'circulation') {
            filterCirculationContainer.classList.remove('hidden');
        } else {
            filterCirculationContainer.classList.add('hidden');
        }
    }

    const filterRecapContainer = document.getElementById('filter-recap-container');
    if (filterRecapContainer) {
        if (tabKey === 'recap') {
            filterRecapContainer.classList.remove('hidden');
        } else {
            filterRecapContainer.classList.add('hidden');
        }
    }

    if (tabKey === 'transactions') {
        renderTransactionsTable(currentTransactions);
        updateTxCashSummary();
    } else if (tabKey === 'circulation') {
        renderCirculationTable(currentCirculations);
    } else if (tabKey === 'cashflow') {
        renderCashFlowTable();
    } else if (tabKey === 'recap') {
        switchRecapSubView(currentRecapSubView);
    } else if (tabKey === 'fees') {
        renderFeeSharingTab();
    } else if (tabKey === 'analysis') {
        renderDemandAnalysisTable(currentMatchedData);
    } else if (tabKey === 'settings') {
        renderPriceSettingsTable();
        renderVendorSettingsTable();
        updateSchoolShareBadge();
        updateFeeSettingsUI();
    } else if (tabKey === 'orders') {
        renderOrdersManagementTable();
    }
}

// ==========================================
// MODALS & EVENT HANDLERS
// ==========================================

/**
 * Mengisi dropdown periode semester pada modal transaksi, sirkulasi, atau tambah buku
 */
export function populateModalPeriodSelect(selectId, selectedVal = null) {
    const select = (typeof selectId === 'string') ? document.getElementById(selectId) : selectId;
    if (!select) return;
    const periods = getAvailableTransactionPeriods();
    const defaultPeriod = getDefaultTransactionPeriod();
    const nextPeriod = getNextSemesterPeriod(defaultPeriod);
    const headerSelect = typeof document !== 'undefined' ? document.getElementById('filter-semester-period') : null;
    const activeHeaderPeriod = (headerSelect && headerSelect.value && headerSelect.value !== 'all')
        ? headerSelect.value
        : (currentSelectedSemesterPeriod && currentSelectedSemesterPeriod !== 'all' ? currentSelectedSemesterPeriod : defaultPeriod);

    const targetVal = selectedVal || activeHeaderPeriod || defaultPeriod;

    select.innerHTML = periods.map(p => {
        const isSel = p === targetVal ? 'selected' : '';
        const isDef = p === defaultPeriod ? ' (Aktif)' : (p === nextPeriod ? ' (Persiapan)' : '');
        return `<option value="${escapeHTML(p)}" ${isSel}>${escapeHTML(p)}${isDef}</option>`;
    }).join('');

    if (targetVal) {
        select.value = targetVal;
    }
}

/**
 * Mengisi dropdown filter periode transaksi di header (format ringkas contoh: 26/27 (1))
 */
export function populateSemesterPeriodDropdown() {
    const select = document.getElementById('filter-semester-period');
    if (!select) return;

    const periods = getAvailableTransactionPeriods();
    const defaultPeriod = getDefaultTransactionPeriod();
    const nextPeriod = getNextSemesterPeriod(defaultPeriod);
    if (!currentSelectedSemesterPeriod || currentSelectedSemesterPeriod === 'all') {
        currentSelectedSemesterPeriod = defaultPeriod;
    }

    let html = '';
    periods.forEach(p => {
        const isSelected = p === currentSelectedSemesterPeriod ? 'selected' : '';
        const shortLabel = formatSemesterPeriodShort(p);
        let titleText = p;
        if (p === defaultPeriod) {
            titleText = `${p} (Semester Berjalan Aktif)`;
        } else if (p === nextPeriod) {
            titleText = `${p} (Semester Mendatang / Persiapan)`;
        }
        html += `<option value="${escapeHTML(p)}" ${isSelected} title="${escapeHTML(titleText)}">${escapeHTML(shortLabel)}</option>`;
    });

    select.innerHTML = html;
    if (select.value !== currentSelectedSemesterPeriod) {
        select.value = currentSelectedSemesterPeriod;
    }
    const isDef = currentSelectedSemesterPeriod === defaultPeriod ? ' (Aktif)' : (currentSelectedSemesterPeriod === nextPeriod ? ' (Persiapan)' : '');
    select.title = `Periode Semester: ${currentSelectedSemesterPeriod}${isDef}`;
}

/**
 * Handler saat filter periode semester di header berubah
 */
export function onSemesterPeriodChanged() {
    const select = document.getElementById('filter-semester-period');
    if (!select) return;
    const defaultPeriod = getDefaultTransactionPeriod();
    currentSelectedSemesterPeriod = select.value || defaultPeriod;
    select.title = `Periode Semester: ${currentSelectedSemesterPeriod}${currentSelectedSemesterPeriod === defaultPeriod ? ' (Aktif)' : ''}`;

    // Sinkronkan juga hidden select modal transaksi #tx-period jika ada
    const txPeriod = document.getElementById('tx-period');
    if (txPeriod && select.value && select.value !== 'all') {
        txPeriod.value = select.value;
    }

    updateKpiCards(currentMatchedData);
    switchTab(currentActiveTab);
}

/**
 * Toggle visibilitas buku (Tampilkan atau Sembunyikan mapel yang tidak memiliki buku fisik)
 * Menerapkan pola Optimistic UI Update + Visual Loading Spinner + Anti-Double-Click Guard
 */
export async function toggleBookVisibility(grade, encodedSubject, triggerBtn = null) {
    const subject = decodeURIComponent(encodedSubject);
    const g = parseInt(grade, 10);
    const toggleKey = `${g}_${subject}`;

    // Anti-double-click guard: abaikan jika buku ini sedang dalam proses simpan aktif
    if (pendingVisibilityToggles.has(toggleKey)) {
        return;
    }

    const book = findBookEntry(g, subject);
    if (!book) {
        showToast('Gagal', `Buku ${subject} kelas ${g} tidak ditemukan.`, 'error');
        return;
    }

    const previousActive = book.isActive !== false;
    const nextActive = !previousActive;

    // 1. Daftarkan kunci proses simpan aktif
    pendingVisibilityToggles.add(toggleKey);

    // 2. Optimistic UI Update: Ubah status memori seketika (0 ms)
    book.isActive = nextActive;

    // 3. Render pembaruan antarmuka langsung tanpa jeda (0 ms)
    renderPriceSettingsTable();
    updateKpiCards(currentMatchedData);
    if (currentActiveTab === 'recap') switchRecapSubView(currentRecapSubView);
    else if (currentActiveTab === 'books') renderBooksTable(currentMatchedData);
    else if (currentActiveTab === 'stock') renderStockTable(currentMatchedData);
    else if (currentActiveTab === 'analysis') renderDemandAnalysisTable(currentMatchedData);

    const statusMsg = book.isActive ? 'ditampilkan kembali' : 'disembunyikan dari transaksi (tidak ada buku fisik)';

    // 4. Eksekusi penyimpanan ke Cloudflare D1 & LocalStorage di latar belakang
    try {
        await saveBookSalesData();
        showToast('Status Buku Diperbarui', `Buku "${subject}" Kelas ${g} berhasil ${statusMsg}.`, 'info');
    } catch (error) {
        console.error('[PenjualanBuku] Gagal menyimpan status visibilitas buku:', error);
        // Rollback status memori jika terjadi kegagalan jaringan
        book.isActive = previousActive;
        showToast('Gagal Menyimpan', `Gagal menyimpan status buku "${subject}". Perubahan dibatalkan.`, 'error');
    } finally {
        // 5. Bersihkan kunci proses simpan aktif dan render ulang tombol ke status normal
        pendingVisibilityToggles.delete(toggleKey);
        renderPriceSettingsTable();
    }
}

/**
 * Handler saat filter status visibilitas di Tab Pengaturan berubah
 */
export function onSettingsStatusChanged() {
    const select = document.getElementById('filter-settings-status');
    if (select) {
        currentSettingsStatusFilter = select.value || 'all';
        renderPriceSettingsTable();
    }
}

/**
 * Mendeteksi jenjang kelas (10, 11, atau 12) secara otomatis berdasarkan format nama rombel
 */
export function detectGradeFromClassName(className) {
    if (!className) return 10;
    const s = String(className).trim().toUpperCase();
    if (s.startsWith('XII-') || s.startsWith('XII ') || s.startsWith('12-') || s.startsWith('12 ') || s === 'XII' || s === '12') return 12;
    if (s.startsWith('XI-') || s.startsWith('XI ') || s.startsWith('11-') || s.startsWith('11 ') || s === 'XI' || s === '11') return 11;
    if (s.startsWith('X-') || s.startsWith('X ') || s.startsWith('10-') || s.startsWith('10 ') || s === 'X' || s === '10') return 10;
    return 10;
}

/**
 * Mengisi dropdown #tx-class dengan seluruh daftar rombel/kelas (X, XI, XII)
 */
export function populateTransactionAllClasses() {
    const selectClass = document.getElementById('tx-class');
    if (!selectClass) return;

    const classesX = getClassesForGrade(10);
    const classesXI = getClassesForGrade(11);
    const classesXII = getClassesForGrade(12);

    let html = '';
    if (classesX.length > 0) {
        html += `<optgroup label="Kelas X">` + classesX.map(c => `<option value="${escapeHTML(c)}" data-grade="10">${escapeHTML(c)}</option>`).join('') + `</optgroup>`;
    }
    if (classesXI.length > 0) {
        html += `<optgroup label="Kelas XI">` + classesXI.map(c => `<option value="${escapeHTML(c)}" data-grade="11">${escapeHTML(c)}</option>`).join('') + `</optgroup>`;
    }
    if (classesXII.length > 0) {
        html += `<optgroup label="Kelas XII">` + classesXII.map(c => `<option value="${escapeHTML(c)}" data-grade="12">${escapeHTML(c)}</option>`).join('') + `</optgroup>`;
    }

    if (html && selectClass.innerHTML !== html) {
        const curVal = selectClass.value;
        selectClass.innerHTML = html;
        if (curVal) selectClass.value = curVal;
    }
}

export async function openAddTransactionModal() {
    const modal = document.getElementById('modal-add-transaction');
    if (!modal) return;

    const inputPrice = document.getElementById('tx-price');
    if (inputPrice) {
        inputPrice.disabled = true;
        inputPrice.readOnly = true;
    }

    if (!Array.isArray(currentClassOrders) || currentClassOrders.length === 0) {
        try {
            await loadClassOrders();
        } catch (e) {}
    }

    populateModalPeriodSelect('tx-period');

    // Sinkronkan tx-period dengan filter-semester-period di header
    const headerSelect = document.getElementById('filter-semester-period');
    const txPeriod = document.getElementById('tx-period');
    if (txPeriod) {
        if (headerSelect && headerSelect.value && headerSelect.value !== 'all') {
            txPeriod.value = headerSelect.value;
        } else if (!txPeriod.value) {
            txPeriod.value = getDefaultTransactionPeriod();
        }
    }

    const inputDate = document.getElementById('tx-date');
    if (inputDate && !inputDate.value) {
        inputDate.value = new Date().toISOString().slice(0, 10);
    }

    populateTransactionAllClasses();

    const selectClass = document.getElementById('tx-class');
    const selectGrade = document.getElementById('tx-grade');
    if (selectClass) {
        if (!selectClass.value && selectClass.options && selectClass.options.length > 0) {
            selectClass.value = selectClass.options[0].value;
        }
        if (selectGrade && selectClass.value) {
            selectGrade.value = String(detectGradeFromClassName(selectClass.value));
        }
    }

    onTransactionClassChanged();
    modal.classList.remove('hidden');
}

export function closeAddTransactionModal() {
    const modal = document.getElementById('modal-add-transaction');
    if (modal) modal.classList.add('hidden');
}

export function onTransactionGradeChanged() {
    const selectGrade = document.getElementById('tx-grade');
    const selectClass = document.getElementById('tx-class');
    if (!selectClass) return;

    // Pastikan seluruh kelas sudah terpopulasi
    if (!selectClass.innerHTML || selectClass.options?.length === 0) {
        populateTransactionAllClasses();
    }

    if (selectGrade && selectGrade.value) {
        const grade = selectGrade.value;
        const availableClasses = getClassesForGrade(grade);
        if (!selectClass.value || !availableClasses.includes(selectClass.value)) {
            if (availableClasses.length > 0) {
                selectClass.value = availableClasses[0];
            }
        }
    }

    onTransactionClassChanged();
}

export function onTransactionClassChanged() {
    const selectGrade = document.getElementById('tx-grade');
    const selectClass = document.getElementById('tx-class');
    const selectSubject = document.getElementById('tx-subject');
    if (!selectClass || !selectSubject) return;

    const className = selectClass.value || '';
    const detectedGrade = detectGradeFromClassName(className);

    if (selectGrade) {
        selectGrade.value = String(detectedGrade);
    }

    const grade = selectGrade ? (selectGrade.value || detectedGrade) : detectedGrade;
    const subjects = getSubjectsForClass(grade, className);

    selectSubject.innerHTML = subjects.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('');

    onTransactionClassOrSubjectChanged();
}

export function onTransactionClassOrSubjectChanged() {
    const selectGrade = document.getElementById('tx-grade');
    const selectClass = document.getElementById('tx-class');
    const selectSubject = document.getElementById('tx-subject');
    const infoTeacher = document.getElementById('tx-info-teacher');
    const infoStock = document.getElementById('tx-info-stock');
    const infoOrder = document.getElementById('tx-info-order');
    const inputPrice = document.getElementById('tx-price');
    const inputQty = document.getElementById('tx-qty');
    const qtyAutoHint = document.getElementById('tx-qty-auto-hint');

    if (!selectGrade || !selectClass || !selectSubject) return;

    const grade = selectGrade.value || '10';
    const className = selectClass.value || '';
    const subject = selectSubject.value || '';

    const teacherName = findTeacherForClassSubject(grade, className, subject);
    if (infoTeacher) infoTeacher.textContent = teacherName;

    const stock = calcRemainingStock(grade, subject);
    if (infoStock) infoStock.textContent = `${stock.toLocaleString('id-ID')} eks tersisa`;

    const price = getBookPrice(grade, subject);
    if (inputPrice) {
        inputPrice.value = (typeof price === 'number' && price > 0) ? price.toLocaleString('id-ID') : (price ? parseNumberSafe(price, 0).toLocaleString('id-ID') : '0');
        inputPrice.disabled = true;
        inputPrice.readOnly = true;
    }

    // Otomatisasi Jumlah (Eks) berdasarkan pesanan mapel tersebut dikurangi yang sudah dibeli oleh kelas itu
    if (className && subject && inputQty) {
        const orderCalc = getRemainingOrderQtyForClassSubject(className, subject, grade);
        if (orderCalc.orderedQty > 0) {
            // Jika ada pesanan: terisi otomatis sisa pesanan (pesanan - sudah dibeli)
            inputQty.value = orderCalc.remainingQty;
            if (qtyAutoHint) {
                qtyAutoHint.textContent = `Otomatis: Sisa ${orderCalc.remainingQty} dari ${orderCalc.orderedQty} pesanan`;
                qtyAutoHint.classList.remove('hidden');
            }
            if (infoOrder) {
                if (orderCalc.remainingQty > 0) {
                    infoOrder.innerHTML = `<span class="text-amber-600 dark:text-amber-400 font-bold">${orderCalc.orderedQty} eks (Kurang ${orderCalc.remainingQty} eks)</span>`;
                } else {
                    infoOrder.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-bold">${orderCalc.orderedQty} eks (Terpenuhi Lunas)</span>`;
                }
            }
        } else {
            // Belum ada tiket pesanan khusus, default 1 eks
            inputQty.value = 1;
            if (qtyAutoHint) qtyAutoHint.classList.add('hidden');
            if (infoOrder) infoOrder.textContent = 'Belum ada pesanan kelas';
        }
    }

    calcTransactionTotal();
}

export function calcTransactionTotal() {
    const inputQty = document.getElementById('tx-qty');
    const inputPrice = document.getElementById('tx-price');
    const inputTotal = document.getElementById('tx-total');

    const qty = parseNumberSafe(inputQty ? inputQty.value : 1, 1);
    const price = parseNumberSafe(inputPrice ? inputPrice.value : 0, 0);
    const total = qty * price;

    if (inputTotal) {
        inputTotal.value = formatRupiah(total);
    }
}

let isSavingTransaction = false;
export async function submitAddTransaction(event) {
    if (event) event.preventDefault();
    if (isSavingTransaction) return;

    const inputDate = document.getElementById('tx-date');
    const selectPeriod = document.getElementById('tx-period');
    const selectGrade = document.getElementById('tx-grade');
    const selectClass = document.getElementById('tx-class');
    const selectSubject = document.getElementById('tx-subject');
    const infoTeacher = document.getElementById('tx-info-teacher');
    const inputQty = document.getElementById('tx-qty');
    const inputPrice = document.getElementById('tx-price');
    const selectPayment = document.getElementById('tx-payment');
    const inputNote = document.getElementById('tx-note');

    const date = inputDate ? inputDate.value : new Date().toISOString().slice(0, 10);
    const headerSelect = (typeof document !== 'undefined') ? document.getElementById('filter-semester-period') : null;
    const activeHeaderPeriod = (headerSelect && headerSelect.value && headerSelect.value !== 'all') ? headerSelect.value : null;
    const periode = selectPeriod?.value || activeHeaderPeriod || getDefaultTransactionPeriod();
    const className = selectClass ? selectClass.value : '';
    const detectedGrade = detectGradeFromClassName(className);
    const grade = parseInt(selectGrade ? (selectGrade.value || detectedGrade) : detectedGrade, 10);
    const subject = selectSubject ? selectSubject.value : '';
    const teacher = infoTeacher ? infoTeacher.textContent : '-';
    const qty = parseNumberSafe(inputQty ? inputQty.value : 1, 1);
    let price = parseNumberSafe(inputPrice ? inputPrice.value : 0, 0);
    if (price <= 0 && grade && subject) {
        price = getBookPrice(grade, subject);
        if (inputPrice) inputPrice.value = price ? price.toLocaleString('id-ID') : '0';
    }
    const total = qty * price;
    const payment = selectPayment ? selectPayment.value : 'Tunai';
    const note = inputNote ? inputNote.value.trim() : '';

    if (!className || !subject || qty <= 0 || !Number.isInteger(qty) || price <= 0) {
        showToast('Peringatan', 'Mohon lengkapi rombel, mata pelajaran, jumlah, dan harga satuan.', 'warning');
        return;
    }
    const stock = calcRemainingStock(grade, subject);
    if (qty > stock) {
        showToast('Stok Kurang', `Stok tersedia hanya ${stock} eksemplar. Sesuaikan jumlah penjualan.`, 'warning');
        return;
    }

    const txId = 'tx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const newTx = {
        id: txId,
        date,
        periode,
        grade,
        className,
        subject,
        teacher,
        qty,
        price,
        total,
        payment,
        note,
        createdAt: new Date().toISOString()
    };

    currentTransactions.unshift(newTx);

    // Update stok dan terjual pada buku di currentMatchedData via SSOT applyBookSalesDelta
    let book = findBookEntry(grade, subject);
    let isNewBook = false;
    if (!book) {
        book = {
            id: 'book_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            grade: grade,
            subject: subject,
            terima: 0,
            diam: 0,
            retur: 0,
            terjual: 0,
            sisa: 0,
            harga: price || 17000,
            total: 0,
            isActive: true,
            teachers: [],
            teacherNamesStr: '-'
        };
        currentMatchedData.push(book);
        isNewBook = true;
    }
    const previousBook = isNewBook ? null : JSON.parse(JSON.stringify(book));
    applyBookSalesDelta(book, qty, price);

    isSavingTransaction = true;
    let saved;
    try {
        saved = await saveBookSalesData({ requireServer: true });
    } finally {
        isSavingTransaction = false;
    }
    if (!saved) {
        currentTransactions = currentTransactions.filter(tx => tx.id !== txId);
        if (isNewBook) {
            currentMatchedData = currentMatchedData.filter(b => b !== book);
        } else if (book && previousBook) {
            Object.assign(book, previousBook);
        }
        return;
    }

    updateKpiCards(currentMatchedData);
    if (currentActiveTab === 'transactions') {
        renderTransactionsTable(currentTransactions);
    } else if (currentActiveTab === 'recap') {
        switchRecapSubView(currentRecapSubView);
    } else if (currentActiveTab === 'classes') {
        renderClassesTable(currentTransactions, currentMatchedData);
    } else if (currentActiveTab === 'stock') {
        renderStockTable(currentMatchedData);
    } else if (currentActiveTab === 'books') {
        renderBooksTable(currentMatchedData);
    } else if (currentActiveTab === 'orders') {
        renderOrdersManagementTable();
    } else {
        renderTeachersTable(currentMatchedData);
    }
    updateOrdersBadge();

    closeAddTransactionModal();
    showToast('Berhasil', `Transaksi ${qty} eks ${subject} untuk kelas ${className} berhasil dicatat!`, 'success');
}

/**
 * Menerapkan perubahan qty terjual bersih (net) pada master buku secara terpusat (SSOT).
 * deltaQty > 0 = penjualan bertambah, deltaQty < 0 = berkurang (retur / hapus penjualan).
 */
function applyBookSalesDelta(book, deltaQty, fallbackPrice) {
    if (!book) return;
    book.terjual = Math.max(0, (book.terjual || 0) + deltaQty);
    book.sisa = Math.max(0, (book.terima || 0) - (book.diam || 0) - (book.retur || 0) - book.terjual);
    book.total = book.terjual * (book.harga || fallbackPrice || 0);

    if (currentParsedSchedule) {
        const schedMap = buildScheduleGradeMap(currentParsedSchedule);
        book.teachers = findTeachersForBookSales(book.grade, book.subject, schedMap, book.terjual, book.total);
        book.teacherNamesStr = book.teachers.length > 0
            ? book.teachers.map(t => `${t.teacher} (${t.classCount}/${t.totalClasses} kls - ${t.percentageStr}: ${t.propTerjual} eks / ${formatRupiah(t.propNominal)})`).join('; ')
            : 'Belum terpetakan di Jadwal XML';
    }
}

export async function deleteTransaction(txId) {
    const idx = currentTransactions.findIndex(t => t.id === txId);
    if (idx === -1) return;

    const tx = currentTransactions[idx];
    const isRet = isReturnTx(tx);

    // Integritas akuntansi: penjualan yang sudah diretur tidak boleh dihapus sebelum retur terkaitnya dibatalkan
    if (!isRet) {
        const returned = getReturnedQtyForTx(tx.id);
        if (returned > 0) {
            showToast('Tidak Dapat Dihapus', `Penjualan ini sudah memiliki retur ${returned} eks. Hapus catatan retur terkait terlebih dahulu.`, 'warning');
            return;
        }
    }

    const confirmMsg = isRet
        ? `Batalkan catatan retur ${tx.qty} eks buku "${tx.subject}" kelas ${tx.className}? Stok akan dikurangi dan penjualan bersih kembali bertambah.`
        : `Hapus transaksi penjualan ${tx.qty} eks buku "${tx.subject}" untuk kelas ${tx.className}?`;
    if (!confirm(confirmMsg)) {
        return;
    }

    // Koreksi master buku: menghapus penjualan mengurangi terjual, membatalkan retur menambah terjual kembali
    const book = findBookEntry(tx.grade, tx.subject);
    applyBookSalesDelta(book, isRet ? tx.qty : -tx.qty, tx.price);

    currentTransactions.splice(idx, 1);
    await saveBookSalesData();

    updateKpiCards(currentMatchedData);
    switchTab(currentActiveTab);
    showToast('Dihapus', isRet ? 'Catatan retur dibatalkan dan stok telah disesuaikan.' : 'Transaksi berhasil dihapus dan stok telah disesuaikan.', 'info');
}

// ==========================================
// RETUR PENJUALAN BUKU (SISWA BATAL BELI)
// ==========================================

export function onTxTypeFilterChanged() {
    const select = document.getElementById('filter-tx-type');
    currentTxTypeFilter = select ? (select.value || 'all') : 'all';
    renderTransactionsTable(currentTransactions);
}

function getReturnSourceCandidates(className = null, period = null) {
    return currentTransactions.filter(t => {
        if (isReturnTx(t)) return false;
        if (getReturnableQty(t) <= 0) return false;
        if (className && t.className !== className) return false;
        if (period && period !== 'all') {
            const p = t.periode || getDefaultTransactionPeriod();
            if (p !== period) return false;
        }
        return true;
    });
}

function setSelectValueEnsuringOption(select, value) {
    if (!select) return;
    const exists = Array.from(select.options).some(o => o.value === value);
    if (!exists && value) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        select.appendChild(opt);
    }
    select.value = value;
}

function populateReturnClassOptions(grade, selectedClass) {
    const selectClass = document.getElementById('ret-class');
    if (!selectClass) return;
    const classes = getClassesForGrade(grade);
    selectClass.innerHTML = classes.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
    if (selectedClass) {
        setSelectValueEnsuringOption(selectClass, selectedClass);
    } else if (classes.length > 0) {
        selectClass.value = classes[0];
    }
}

function populateReturnSourceTxOptions(selectedClass, preselectedTxId = null) {
    const selectSource = document.getElementById('ret-source-tx');
    const alertBox = document.getElementById('ret-no-purchase-alert');
    const period = (document.getElementById('ret-period') || {}).value || null;

    if (!selectSource) return;

    // Filter kandidat transaksi pembelian untuk rombel terpilih
    let candidates = getReturnSourceCandidates(selectedClass, period);
    // Jika tidak ditemukan pada semester terpilih, periksa apakah ada pembelian di semester lain untuk kelas ini
    if (candidates.length === 0 && selectedClass) {
        candidates = getReturnSourceCandidates(selectedClass, null);
    }

    if (candidates.length === 0) {
        selectSource.innerHTML = '<option value="">-- Tidak ada riwayat pembelian buku di kelas ini --</option>';
        selectSource.value = '';
        if (alertBox) alertBox.classList.remove('hidden');
        setReturnFormActive(false);
        updateReturnInfoPanel();
        return;
    }

    if (alertBox) alertBox.classList.add('hidden');
    setReturnFormActive(true);

    selectSource.innerHTML = candidates.map(t => {
        const remaining = getReturnableQty(t);
        const pLabel = t.periode ? `[${t.periode}] ` : '';
        const label = `${pLabel}${t.subject} • Dibeli ${t.qty} eks (Sisa Kuota Retur: ${remaining} eks) • ${formatRupiah(t.price)} • Tgl ${t.date}`;
        return `<option value="${escapeHTML(t.id)}">${escapeHTML(label)}</option>`;
    }).join('');

    if (preselectedTxId && candidates.some(t => t.id === preselectedTxId)) {
        selectSource.value = preselectedTxId;
    } else {
        selectSource.value = candidates[0].id;
    }

    onReturnSourceTxChanged();
}

function setReturnFormActive(isActive) {
    const ids = ['ret-qty', 'ret-student-name', 'ret-refund-method', 'ret-reason', 'ret-note', 'btn-save-return'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !isActive;
    });
}

function getSelectedReturnSourceTx() {
    const select = document.getElementById('ret-source-tx');
    if (!select || !select.value) return null;
    return currentTransactions.find(t => t.id === select.value && !isReturnTx(t)) || null;
}

/**
 * Batas maksimum qty yang boleh diretur:
 * Wajib berdasarkan transaksi pembelian asal (histori pembelian kelas).
 */
function getMaxReturnQty() {
    const src = getSelectedReturnSourceTx();
    return src ? getReturnableQty(src) : 0;
}

export function openReturnModal(preselectedTxId = null) {
    const modal = document.getElementById('modal-return-transaction');
    if (!modal) return;

    populateModalPeriodSelect('ret-period');

    const inputDate = document.getElementById('ret-date');
    if (inputDate) inputDate.value = new Date().toISOString().slice(0, 10);

    const inputPrice = document.getElementById('ret-price');
    if (inputPrice) {
        inputPrice.value = '';
        inputPrice.disabled = true;
        inputPrice.readOnly = true;
    }

    const inputQty = document.getElementById('ret-qty');
    if (inputQty) inputQty.value = '1';
    const inputName = document.getElementById('ret-student-name');
    if (inputName) inputName.value = '';
    const inputNote = document.getElementById('ret-note');
    if (inputNote) inputNote.value = '';
    const selectReason = document.getElementById('ret-reason');
    if (selectReason) selectReason.value = 'Siswa Batal Beli';
    const selectMethod = document.getElementById('ret-refund-method');
    if (selectMethod) selectMethod.value = 'Tunai';

    let targetGrade = '10';
    let targetClass = '';

    if (preselectedTxId) {
        const found = currentTransactions.find(t => t.id === preselectedTxId && !isReturnTx(t));
        if (found) {
            targetGrade = String(found.grade);
            targetClass = found.className;
            if (found.periode) {
                const selP = document.getElementById('ret-period');
                if (selP) selP.value = found.periode;
            }
        }
    }

    const selectGrade = document.getElementById('ret-grade');
    if (selectGrade) selectGrade.value = targetGrade;

    populateReturnClassOptions(targetGrade, targetClass);

    const activeClass = targetClass || ((document.getElementById('ret-class') || {}).value || '');
    populateReturnSourceTxOptions(activeClass, preselectedTxId);

    modal.classList.remove('hidden');
}

export function closeReturnModal() {
    const modal = document.getElementById('modal-return-transaction');
    if (modal) modal.classList.add('hidden');
}

export function onReturnSourceTxChanged() {
    const src = getSelectedReturnSourceTx();
    const alertBox = document.getElementById('ret-no-purchase-alert');

    if (!src) {
        if (alertBox) alertBox.classList.remove('hidden');
        setReturnFormActive(false);
        updateReturnInfoPanel();
        return;
    }

    if (alertBox) alertBox.classList.add('hidden');
    setReturnFormActive(true);

    // Pastikan Jenjang & Rombel sinkron dengan transaksi pembelian asal
    const selectGrade = document.getElementById('ret-grade');
    if (selectGrade && selectGrade.value !== String(src.grade)) {
        selectGrade.value = String(src.grade);
        populateReturnClassOptions(src.grade, src.className);
    }
    const selectClass = document.getElementById('ret-class');
    if (selectClass && selectClass.value !== src.className) {
        selectClass.value = src.className;
    }

    // Set Mata Pelajaran yang bersesuaian dengan transaksi pembelian asal
    const selectSubject = document.getElementById('ret-subject');
    if (selectSubject) {
        selectSubject.innerHTML = `<option value="${escapeHTML(src.subject)}">${escapeHTML(src.subject)}</option>`;
        selectSubject.value = src.subject;
        selectSubject.disabled = true;
    }

    // Set Harga Satuan sesuai pembelian asal
    const inputPrice = document.getElementById('ret-price');
    if (inputPrice) {
        inputPrice.value = (typeof src.price === 'number' && src.price > 0) ? src.price.toLocaleString('id-ID') : (src.price ? parseNumberSafe(src.price, 0).toLocaleString('id-ID') : '0');
        inputPrice.disabled = true;
        inputPrice.readOnly = true;
    }

    // Set Periode Semester sesuai pembelian asal jika ada
    const selectPeriod = document.getElementById('ret-period');
    if (selectPeriod && src.periode) {
        selectPeriod.value = src.periode;
    }

    // Batas maksimum retur berdasarkan sisa kuota transaksi pembelian
    const max = getReturnableQty(src);
    const inputQty = document.getElementById('ret-qty');
    if (inputQty) {
        inputQty.max = String(Math.max(1, max));
        inputQty.min = '1';
        const cur = parseNumberSafe(inputQty.value, 1);
        if (cur > max || cur <= 0) {
            inputQty.value = '1';
        }
    }

    updateReturnInfoPanel();
}

export function onReturnGradeChanged() {
    const selectGrade = document.getElementById('ret-grade');
    const grade = selectGrade ? (selectGrade.value || '10') : '10';
    populateReturnClassOptions(grade);
    onReturnClassChanged();
}

export function onReturnClassChanged() {
    const className = (document.getElementById('ret-class') || {}).value || '';
    populateReturnSourceTxOptions(className);
}

export function onReturnPeriodChanged() {
    const className = (document.getElementById('ret-class') || {}).value || '';
    populateReturnSourceTxOptions(className);
}

export function onReturnSubjectChanged() {
    updateReturnInfoPanel();
}

function updateReturnInfoPanel() {
    const src = getSelectedReturnSourceTx();
    const infoTeacher = document.getElementById('ret-info-teacher');
    const infoOrig = document.getElementById('ret-info-orig-status');
    const infoMax = document.getElementById('ret-info-max-return');

    if (!src) {
        if (infoTeacher) infoTeacher.textContent = '-';
        if (infoOrig) infoOrig.textContent = 'Tidak ada transaksi pembelian yang valid';
        if (infoMax) infoMax.textContent = '0 eks';
        calcReturnTotal();
        return;
    }

    const teacherName = src.teacher || findTeacherForClassSubject(src.grade, src.className, src.subject);
    if (infoTeacher) infoTeacher.textContent = teacherName;

    const returnedQty = getReturnedQtyForTx(src.id);
    const returnable = getReturnableQty(src);
    if (infoOrig) {
        infoOrig.textContent = `Dibeli ${src.qty} eks (${formatRupiah(src.total)}) • Sudah diretur: ${returnedQty} eks`;
    }
    if (infoMax) {
        infoMax.textContent = `${returnable.toLocaleString('id-ID')} eks dapat diretur`;
    }

    calcReturnTotal();
}

export function calcReturnTotal() {
    const src = getSelectedReturnSourceTx();
    const inputQty = document.getElementById('ret-qty');
    const max = src ? getReturnableQty(src) : 0;

    let qty = parseNumberSafe(inputQty ? inputQty.value : 0, 0);
    if (qty > max && max > 0) {
        qty = max;
        if (inputQty) inputQty.value = String(max);
    }
    if (qty < 0) qty = 0;

    const price = src ? (src.price || 0) : parseNumberSafe((document.getElementById('ret-price') || {}).value, 0);
    const total = qty * price;

    const inputTotal = document.getElementById('ret-total');
    if (inputTotal) inputTotal.value = `-${formatRupiah(total)}`;
    const impStock = document.getElementById('ret-impact-stock');
    if (impStock) impStock.textContent = `+${qty.toLocaleString('id-ID')} eks`;
    const impRev = document.getElementById('ret-impact-revenue');
    if (impRev) impRev.textContent = `-${formatRupiah(total)}`;
}

export async function submitAddReturn(event) {
    if (event) event.preventDefault();

    const btnSave = document.getElementById('btn-save-return');
    if (btnSave && btnSave.disabled) return; // Anti double-submit

    const src = getSelectedReturnSourceTx();
    if (!src) {
        showToast('Retur Ditolak', 'Retur hanya dapat dilakukan berdasarkan histori pembelian buku yang tercatat di kelas tersebut.', 'warning');
        return;
    }

    const date = (document.getElementById('ret-date') || {}).value || new Date().toISOString().slice(0, 10);
    const periode = (document.getElementById('ret-period') || {}).value || src.periode || getDefaultTransactionPeriod();
    const grade = src.grade;
    const className = src.className;
    const subject = src.subject;
    const price = src.price;
    const teacher = src.teacher || findTeacherForClassSubject(grade, className, subject);

    const qty = parseNumberSafe((document.getElementById('ret-qty') || {}).value, 0);
    const refundMethod = (document.getElementById('ret-refund-method') || {}).value || 'Tunai';
    const reason = (document.getElementById('ret-reason') || {}).value || 'Siswa Batal Beli';
    const studentName = ((document.getElementById('ret-student-name') || {}).value || '').trim();
    const extraNote = ((document.getElementById('ret-note') || {}).value || '').trim();

    if (qty <= 0) {
        showToast('Peringatan', 'Jumlah buku yang diretur minimal 1 eksemplar.', 'warning');
        return;
    }

    const returnable = getReturnableQty(src);
    if (returnable <= 0) {
        showToast('Retur Ditolak', 'Seluruh kuota buku pada transaksi pembelian ini sudah diretur habis.', 'warning');
        return;
    }

    if (qty > returnable) {
        showToast('Retur Ditolak', `Jumlah retur (${qty} eks) melebihi batas kuota pembelian yang tersisa (${returnable} eks).`, 'warning');
        return;
    }

    const book = findBookEntry(grade, subject);
    if (!book) {
        showToast('Gagal', `Buku ${subject} kelas ${grade} tidak ditemukan di master buku.`, 'error');
        return;
    }

    if (btnSave) btnSave.disabled = true;
    try {
        const retId = 'ret_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        const newRet = {
            id: retId,
            type: 'return',
            refTxId: src.id,
            date,
            periode,
            grade,
            className,
            subject,
            teacher,
            qty,
            price,
            total: qty * price,
            payment: refundMethod,
            refundMethod,
            reason,
            studentName,
            note: [studentName, extraNote].filter(Boolean).join(' — '),
            createdAt: new Date().toISOString()
        };

        currentTransactions.unshift(newRet);
        applyBookSalesDelta(book, -qty, price);

        await saveBookSalesData();

        updateKpiCards(currentMatchedData);
        switchTab(currentActiveTab);

        closeReturnModal();
        showToast('Retur Dicatat', `Retur ${qty} eks ${subject} kelas ${className} (refund ${formatRupiah(qty * price)}) berhasil dicatat. Stok bertambah dan penjualan bersih berkurang.`, 'success');
    } catch (e) {
        showToast('Gagal', e.message || 'Gagal mencatat retur buku.', 'error');
    } finally {
        if (btnSave) btnSave.disabled = false;
    }
}

export function openClassDetailModal(className) {
    const modal = document.getElementById('modal-class-detail');
    if (!modal) return;

    const titleEl = document.getElementById('class-detail-name');
    const qtyEl = document.getElementById('class-detail-total-qty');
    const nomEl = document.getElementById('class-detail-total-nom');
    const tbody = document.getElementById('table-class-detail-body');

    if (titleEl) titleEl.textContent = className;

    const defaultPeriodForDetail = getDefaultTransactionPeriod();
    const classTxs = currentTransactions.filter(t => {
        if (t.className !== className) return false;
        if (currentSelectedSemesterPeriod !== 'all' && (t.periode || defaultPeriodForDetail) !== currentSelectedSemesterPeriod) return false;
        return true;
    });
    const detailSum = summarizeTransactions(classTxs);

    if (classTxs.length === 0) {
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="py-6 text-center text-slate-400">
                        Belum ada riwayat transaksi penjualan untuk rombel ini.
                    </td>
                </tr>
            `;
        }
    } else {
        let html = '';
        classTxs.forEach((tx, i) => {
            const isRet = isReturnTx(tx);
            const typeBadge = isRet
                ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Retur</span>'
                : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Jual</span>';
            const qtyCls = isRet ? 'text-amber-600' : 'text-emerald-600';
            const totalCls = isRet ? 'text-rose-600 dark:text-rose-400' : 'text-blue-600 dark:text-blue-400';
            const noteText = isRet
                ? `${tx.reason || 'Retur'}${tx.note ? ' — ' + tx.note : ''}`
                : (tx.note || tx.payment || '-');
            html += `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 ${isRet ? 'bg-amber-50/40 dark:bg-amber-950/10' : ''}">
                    <td class="px-3 py-2 text-center font-mono text-slate-500">${i + 1}</td>
                    <td class="px-3 py-2 font-mono whitespace-nowrap">${escapeHTML(tx.date)}</td>
                    <td class="px-3 py-2 text-center">${typeBadge}</td>
                    <td class="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">${escapeHTML(tx.subject)}</td>
                    <td class="px-3 py-2 text-slate-600 dark:text-slate-400">${escapeHTML(tx.teacher || '-')}</td>
                    <td class="px-3 py-2 text-right font-mono font-bold ${qtyCls}">${isRet ? '-' : ''}${(tx.qty || 0).toLocaleString('id-ID')}</td>
                    <td class="px-3 py-2 text-right font-mono font-bold ${totalCls}">${isRet ? '-' : ''}${formatRupiah(tx.total)}</td>
                    <td class="px-3 py-2 text-slate-500">${escapeHTML(noteText)}</td>
                </tr>
            `;
        });
        if (tbody) tbody.innerHTML = html;
    }

    const retQtyEl = document.getElementById('class-detail-total-ret-qty');
    if (qtyEl) qtyEl.textContent = `${detailSum.netQty.toLocaleString('id-ID')} eks`;
    if (retQtyEl) retQtyEl.textContent = `${detailSum.returnQty.toLocaleString('id-ID')} eks`;
    if (nomEl) nomEl.textContent = formatRupiah(detailSum.netNom);

    modal.classList.remove('hidden');
}

export function closeClassDetailModal() {
    const modal = document.getElementById('modal-class-detail');
    if (modal) modal.classList.add('hidden');
}

export function openAddBookModal() {
    const modal = document.getElementById('modal-add-book');
    if (!modal) return;
    const form = document.getElementById('form-add-book');
    if (form) form.reset();

    populateModalPeriodSelect('book-period');
    const checkActive = document.getElementById('book-is-active');
    if (checkActive) checkActive.checked = true;

    const inputSubject = document.getElementById('book-subject');
    if (inputSubject) inputSubject.value = '';
    const inputTerima = document.getElementById('book-terima');
    if (inputTerima) inputTerima.value = '0';
    const inputHarga = document.getElementById('book-harga');
    if (inputHarga) {
        inputHarga.value = (17000).toLocaleString('id-ID');
        inputHarga.disabled = true;
        inputHarga.readOnly = true;
    }
    modal.classList.remove('hidden');
    if (inputSubject) setTimeout(() => inputSubject.focus(), 100);
}

export function closeAddBookModal() {
    const modal = document.getElementById('modal-add-book');
    if (modal) modal.classList.add('hidden');
}

export function openImportModal() {
    const modal = document.getElementById('modal-import-books');
    if (!modal) return;
    modal.classList.remove('hidden');
    const textarea = document.getElementById('input-book-data');
    if (textarea) setTimeout(() => textarea.focus(), 100);
}

export function closeImportModal() {
    const modal = document.getElementById('modal-import-books');
    if (modal) modal.classList.add('hidden');
}

// ==========================================
// PENGELOLAAN VENDOR / PERCETAKAN MITRA
// ==========================================

export function renderVendorSettingsTable() {
    const tbody = document.getElementById('table-settings-vendor-body');
    const badgeCount = document.getElementById('badge-vendor-count');
    if (!tbody) return;

    const vendors = getCurrentVendors();
    if (badgeCount) {
        badgeCount.textContent = `${vendors.length} Vendor Terdaftar`;
    }

    if (vendors.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="py-8 text-center text-slate-400">
                    <i class="fa-solid fa-truck-field text-2xl mb-2 text-slate-300 dark:text-slate-600 block"></i>
                    Belum ada vendor percetakan terdaftar. Tambahkan vendor mitra melalui formulir di atas.
                </td>
            </tr>
        `;
        return;
    }

    // Hitung riwayat mutasi sirkulasi terkait per vendor
    const circs = currentCirculations || [];
    const vendorUsageMap = {};
    circs.forEach(c => {
        if (c.party && (c.type === 'terima' || c.type === 'retur_penerbit')) {
            const k = c.party.toLowerCase().trim();
            vendorUsageMap[k] = (vendorUsageMap[k] || 0) + 1;
        }
    });

    let html = '';
    vendors.forEach((vendor, index) => {
        const count = vendorUsageMap[vendor.toLowerCase().trim()] || 0;
        const countBadge = count > 0
            ? `<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">${count} Mutasi</span>`
            : `<span class="text-slate-400 text-xs">Belum ada</span>`;

        html += `
            <tr class="hover:bg-slate-50/60 dark:hover:bg-slate-800/60 transition-colors">
                <td class="px-3.5 py-2.5 text-center text-slate-400 font-mono text-xs">${index + 1}</td>
                <td class="px-4 py-2.5 font-semibold text-slate-800 dark:text-slate-100">${escapeHTML(vendor)}</td>
                <td class="px-3 py-2.5 text-center">${countBadge}</td>
                <td class="px-3 py-2.5 text-center">
                    <button type="button" onclick="window.deleteVendor('${escapeHTML(encodeURIComponent(vendor))}')"
                        class="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer rounded hover:bg-red-50 dark:hover:bg-red-950/30"
                        title="Hapus vendor ${escapeHTML(vendor)}">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

export async function submitAddVendor(event) {
    if (event) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
    }
    const input = document.getElementById('input-new-vendor-name');
    if (!input) return false;
    const name = input.value.trim();
    if (!name) {
        showToast('Peringatan', 'Mohon masukkan nama vendor/percetakan mitra.', 'warning');
        return false;
    }

    const vendors = getCurrentVendors();
    const exists = vendors.some(v => v.toLowerCase().trim() === name.toLowerCase().trim());
    if (exists) {
        showToast('Info', `Vendor "${name}" sudah terdaftar sebelumnya.`, 'info');
        input.value = '';
        return false;
    }

    vendors.push(name);
    vendors.sort((a, b) => a.localeCompare(b, 'id-ID'));
    setCurrentVendors(vendors);

    // 1. Simpan sinkron langsung ke dedicated LocalStorage
    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(BOOK_VENDORS_STORAGE_KEY, JSON.stringify(vendors));
        } catch (e) {
            console.warn('[PenjualanBuku] Gagal simpan vendor ke localStorage:', e);
        }
    }

    // 2. Simpan asinkron ke D1 dedicated setting
    if (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled) {
        cfClient.saveSystemSetting(BOOK_VENDORS_D1_KEY, vendors).catch(err => {
            console.warn('[PenjualanBuku] Gagal simpan vendor ke D1:', err);
        });
    }

    // 3. Simpan ke bundle data utama
    await saveBookSalesData();

    // 4. Render UI
    renderVendorSettingsTable();
    populateVendorSelect(name);
    input.value = '';
    showToast('Berhasil', `Vendor "${name}" berhasil ditambahkan ke daftar master.`, 'success');
    return false;
}

export async function deleteVendor(encodedVendor) {
    const vendorName = decodeURIComponent(encodedVendor);
    const confirmFn = (typeof window !== 'undefined' && typeof window.confirm === 'function') ? window.confirm : (typeof confirm === 'function' ? confirm : null);
    if (confirmFn && !confirmFn(`Hapus vendor "${vendorName}" dari daftar master?`)) {
        return false;
    }

    let vendors = getCurrentVendors();
    vendors = vendors.filter(v => v !== vendorName);
    setCurrentVendors(vendors);

    // 1. Simpan sinkron langsung ke dedicated LocalStorage
    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(BOOK_VENDORS_STORAGE_KEY, JSON.stringify(vendors));
        } catch (e) {
            console.warn('[PenjualanBuku] Gagal simpan vendor ke localStorage:', e);
        }
    }

    // 2. Simpan asinkron ke D1 dedicated setting
    if (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled) {
        cfClient.saveSystemSetting(BOOK_VENDORS_D1_KEY, vendors).catch(err => {
            console.warn('[PenjualanBuku] Gagal simpan vendor ke D1:', err);
        });
    }

    // 3. Simpan ke bundle data utama
    await saveBookSalesData();

    // 4. Render UI
    renderVendorSettingsTable();
    populateVendorSelect();
    showToast('Info', `Vendor "${vendorName}" telah dihapus.`, 'info');
    return true;
}

// ==========================================
// PENGATURAN PERSENTASE BAGIAN SEKOLAH
// ==========================================

export function updateSchoolShareBadge() {
    const badge = document.getElementById('badge-school-pct-display');
    if (badge) {
        badge.textContent = `${currentSchoolSharePercentage}% ke Sekolah`;
    }
    const thPct = document.getElementById('th-school-pct');
    if (thPct) {
        thPct.textContent = String(currentSchoolSharePercentage);
    }
    const input = document.getElementById('input-school-percentage');
    if (input && document.activeElement !== input) {
        input.value = currentSchoolSharePercentage;
    }
}

export async function saveSchoolSharePercentage() {
    const input = document.getElementById('input-school-percentage');
    const val = input ? parseFloat(input.value) : 0;
    setSchoolSharePercentage(val);
    updateSchoolShareBadge();
    await saveBookSalesData();

    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(BOOK_SCHOOL_SHARE_STORAGE_KEY, String(currentSchoolSharePercentage));
        } catch (e) {}
    }
    if (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled) {
        try {
            await cfClient.saveSystemSetting(BOOK_SCHOOL_SHARE_D1_KEY, currentSchoolSharePercentage);
        } catch (e) {}
    }
    if (Array.isArray(currentMatchedData) && currentMatchedData.length > 0) {
        renderTeachersTable(currentMatchedData);
    }
    showToast('Berhasil', `Persentase bagian sekolah disimpan: ${currentSchoolSharePercentage}%`, 'success');
}

// ==========================================
// SISTEM REKAPITULASI PEMBAGIAN FEE LKS (4 KOMPONEN DINAMIS)
// ==========================================

export function onFeePercentageInputChanged() {
    const inRate = document.getElementById('input-fee-rate-pct');
    const inCoop = document.getElementById('input-fee-coop-pct');
    const inEqual = document.getElementById('input-fee-equal-pct');
    const inTeacher = document.getElementById('input-fee-teacher-pct');
    const inHeadmaster = document.getElementById('input-fee-headmaster-pct');
    const inSchool = document.getElementById('input-fee-school-pct');

    const activeEl = typeof document !== 'undefined' ? document.activeElement : null;

    // Toleran: Jika pengguna tidak sengaja mengetik nominal Rupiah (misal 100000 atau 70000) di field persentase pemerataan, alihkan otomatis
    if (inEqual && parseFloat(inEqual.value) >= 1000) {
        const nominalVal = parseFloat(inEqual.value);
        const inEqualPerPerson = document.getElementById('input-fee-equal-per-person');
        if (inEqualPerPerson) {
            inEqualPerPerson.value = formatCurrencyInput(nominalVal);

            // Hitung persentase yang sesuai dan perbarui inEqual.value ke tampilan 2 desimal
            const books = Array.isArray(currentMatchedData) ? currentMatchedData : [];
            const totalRevenue = books.reduce((sum, b) => sum + parseNumberSafe(b.total, 0), 0);
            const rateVal = inRate ? parseFloat(inRate.value) || 0 : DEFAULT_FEE_DISTRIBUTION_SETTINGS.feeRatePercentage;
            const totalFeePool = Math.round(totalRevenue * (rateVal / 100));
            const gtkCountEl = document.getElementById('fee-equal-gtk-count');
            const gtkCount = (currentFeeDistributionResult?.allocations?.equality?.count) || parseInt(gtkCountEl?.textContent, 10) || 1;
            const totalPool = nominalVal * gtkCount;
            if (totalFeePool > 0) {
                const exactPct = (totalPool / totalFeePool) * 100;
                inEqual.value = exactPct.toFixed(2);
            }

            return onFeeAmountInputChanged('equal-person');
        }
    }
    if (inHeadmaster && parseFloat(inHeadmaster.value) >= 1000) {
        const nominalVal = parseFloat(inHeadmaster.value);
        const inHeadmasterAmount = document.getElementById('input-fee-headmaster-amount');
        if (inHeadmasterAmount) {
            inHeadmasterAmount.value = formatCurrencyInput(nominalVal);

            const books = Array.isArray(currentMatchedData) ? currentMatchedData : [];
            const totalRevenue = books.reduce((sum, b) => sum + parseNumberSafe(b.total, 0), 0);
            const rateVal = inRate ? parseFloat(inRate.value) || 0 : DEFAULT_FEE_DISTRIBUTION_SETTINGS.feeRatePercentage;
            const totalFeePool = Math.round(totalRevenue * (rateVal / 100));
            if (totalFeePool > 0) {
                const exactPct = (nominalVal / totalFeePool) * 100;
                inHeadmaster.value = exactPct.toFixed(2);
            }

            return onFeeAmountInputChanged('headmaster-amount');
        }
    }

    const rateVal = inRate ? parseFloat(inRate.value) || 0 : DEFAULT_FEE_DISTRIBUTION_SETTINGS.feeRatePercentage;
    let eVal = inEqual ? parseFloat(inEqual.value) || 0 : DEFAULT_FEE_DISTRIBUTION_SETTINGS.equalityPercentage;
    const tVal = inTeacher ? parseFloat(inTeacher.value) || 0 : DEFAULT_FEE_DISTRIBUTION_SETTINGS.teacherPercentage;
    let hVal = inHeadmaster ? parseFloat(inHeadmaster.value) || 0 : DEFAULT_FEE_DISTRIBUTION_SETTINGS.headmasterPercentage;
    const sVal = 0.0; // Kas sekolah ditiadakan dari sub-komponen (0% - murni dibagi ke 4 kartu)

    const prevEqualPct = currentFeeDistributionSettings?.equalityPercentage != null
        ? currentFeeDistributionSettings.equalityPercentage
        : DEFAULT_FEE_DISTRIBUTION_SETTINGS.equalityPercentage;
    const prevHeadmasterPct = currentFeeDistributionSettings?.headmasterPercentage != null
        ? currentFeeDistributionSettings.headmasterPercentage
        : DEFAULT_FEE_DISTRIBUTION_SETTINGS.headmasterPercentage;

    // Periksa apakah pengguna sedang secara aktif mengedit persentase Pemerataan atau Kepala Sekolah
    const isEqualFieldActive = (activeEl === inEqual);
    const isHeadmasterFieldActive = (activeEl === inHeadmaster);

    let explicitPerPerson = currentFeeDistributionSettings?.equalityPerPerson || null;
    let explicitPool = currentFeeDistributionSettings?.equalityPool || null;
    let explicitHeadmaster = currentFeeDistributionSettings?.headmasterAmount || null;

    // Jika nilai input persentase pemerataan diubah menjadi angka persentase baru:
    const isEqualPctChanged = Math.abs(eVal - prevEqualPct) > 0.02;
    if (isEqualFieldActive || isEqualPctChanged) {
        explicitPerPerson = null;
        explicitPool = null;
    } else if (explicitPerPerson != null && explicitPerPerson > 0) {
        // Pengguna sedang mengubah field lain: pertahankan nominal Rp per orang
        const books = Array.isArray(currentMatchedData) ? currentMatchedData : [];
        const totalRevenue = books.reduce((sum, b) => sum + parseNumberSafe(b.total, 0), 0);
        const totalFeePool = Math.round(totalRevenue * (rateVal / 100));
        const gtkCountEl = document.getElementById('fee-equal-gtk-count');
        const gtkCount = (currentFeeDistributionResult?.allocations?.equality?.count) || parseInt(gtkCountEl?.textContent, 10) || 1;
        const totalPool = explicitPerPerson * gtkCount;
        explicitPool = totalPool;
        if (totalFeePool > 0) {
            eVal = (totalPool / totalFeePool) * 100;
            if (inEqual && activeEl !== inEqual) {
                const roundedE = Math.round(eVal * 100) / 100;
                inEqual.value = Number.isInteger(roundedE) ? String(roundedE) : roundedE.toFixed(2);
            }
        }
    }

    const isHeadmasterPctChanged = Math.abs(hVal - prevHeadmasterPct) > 0.02;
    if (isHeadmasterFieldActive || isHeadmasterPctChanged) {
        explicitHeadmaster = null;
    } else if (explicitHeadmaster != null && explicitHeadmaster > 0) {
        const books = Array.isArray(currentMatchedData) ? currentMatchedData : [];
        const totalRevenue = books.reduce((sum, b) => sum + parseNumberSafe(b.total, 0), 0);
        const totalFeePool = Math.round(totalRevenue * (rateVal / 100));
        if (totalFeePool > 0) {
            hVal = (explicitHeadmaster / totalFeePool) * 100;
            if (inHeadmaster && activeEl !== inHeadmaster) {
                const roundedH = Math.round(hVal * 100) / 100;
                inHeadmaster.value = Number.isInteger(roundedH) ? String(roundedH) : roundedH.toFixed(2);
            }
        }
    }

    // Koperasi Sekolah otomatis menjadi penampung sisa alokasi 100% dari 3 kartu lainnya
    const otherSubPct = eVal + tVal + hVal;
    const cVal = Math.max(0, 100 - otherSubPct);
    if (inCoop) {
        const roundedC = Math.round(cVal * 100) / 100;
        inCoop.value = Number.isInteger(roundedC) ? String(roundedC) : roundedC.toFixed(2);
    }

    const totalSubPct = Math.round((cVal + eVal + tVal + hVal) * 100) / 100;
    const badgeTotal = document.getElementById('badge-fee-total-pct');
    if (badgeTotal) {
        if (Math.abs(totalSubPct - 100) < 0.05) {
            badgeTotal.textContent = 'Total Alokasi: 100%';
            badgeTotal.className = 'px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800';
        } else {
            const roundedTot = Math.round(totalSubPct * 100) / 100;
            const dispTot = Number.isInteger(roundedTot) ? String(roundedTot) : roundedTot.toFixed(2);
            badgeTotal.textContent = `Total: ${dispTot}% (Disarankan 100%)`;
            badgeTotal.className = 'px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 animate-pulse';
        }
    }

    // Sinkronkan hidden input legacy untuk kompatibilitas mundur
    const legacyInput = document.getElementById('input-school-percentage');
    if (legacyInput) {
        legacyInput.value = String(rateVal);
    }
    const legacyBadge = document.getElementById('badge-school-pct-display');
    if (legacyBadge) {
        legacyBadge.textContent = `${rateVal}% ke Sekolah`;
    }

    const liveSettings = {
        feeRatePercentage: rateVal,
        schoolPercentage: 0,
        cooperativePercentage: cVal,
        equalityPercentage: eVal,
        teacherPercentage: tVal,
        headmasterPercentage: hVal,
        equalityPerPerson: explicitPerPerson,
        equalityPool: explicitPool,
        headmasterAmount: explicitHeadmaster
    };

    if (currentFeeDistributionSettings) {
        Object.assign(currentFeeDistributionSettings, liveSettings);
    }

    // Live recalculation instan: langsung perbarui tampilan tab bagi fee saat diketik
    return renderFeeSharingTab(liveSettings);
}

/**
 * Sinkronisasi Dua Arah: Input Nominal Uang (Rupiah) Menghitung Balik Persentase (%)
 * Dikhususkan untuk alokasi Pemerataan GTK (total pool atau per orang) dan Insentif Kepsek.
 * @param {string} sourceField - 'equal-pool' | 'equal-person' | 'headmaster-amount'
 */
export function onFeeAmountInputChanged(sourceField) {
    const books = Array.isArray(currentMatchedData) ? currentMatchedData : [];
    const totalRevenue = books.reduce((sum, b) => sum + parseNumberSafe(b.total, 0), 0);

    const inRate = document.getElementById('input-fee-rate-pct');
    const rateVal = inRate ? parseFloat(inRate.value) || 0 : DEFAULT_FEE_DISTRIBUTION_SETTINGS.feeRatePercentage;
    const totalFeePool = Math.round(totalRevenue * (rateVal / 100));

    // Jika belum ada data omzet penjualan buku atau total fee pool bernilai nol
    if (totalFeePool <= 0) {
        showToast('Informasi Omzet', 'Belum ada data omzet penjualan buku untuk menghitung persentase dari nominal.', 'info');
        return;
    }

    let explicitPerPerson = currentFeeDistributionSettings?.equalityPerPerson || null;
    let explicitPool = currentFeeDistributionSettings?.equalityPool || null;
    let explicitHeadmaster = currentFeeDistributionSettings?.headmasterAmount || null;

    const inTeacher = document.getElementById('input-fee-teacher-pct');
    const tVal = inTeacher ? parseFloat(inTeacher.value) || 0 : DEFAULT_FEE_DISTRIBUTION_SETTINGS.teacherPercentage;

    let exactEqualPct = currentFeeDistributionSettings?.equalityPercentage != null
        ? currentFeeDistributionSettings.equalityPercentage
        : DEFAULT_FEE_DISTRIBUTION_SETTINGS.equalityPercentage;
    let exactHeadmasterPct = currentFeeDistributionSettings?.headmasterPercentage != null
        ? currentFeeDistributionSettings.headmasterPercentage
        : DEFAULT_FEE_DISTRIBUTION_SETTINGS.headmasterPercentage;

    if (sourceField === 'headmaster-amount') {
        const inHeadmasterNominal = document.getElementById('input-fee-headmaster-amount');
        const rawNominal = inHeadmasterNominal ? parseNumberSafe(inHeadmasterNominal.value.replace(/\D/g, ''), 0) : 0;
        explicitHeadmaster = rawNominal;
        exactHeadmasterPct = (rawNominal / totalFeePool) * 100;
        const inHeadmasterPct = document.getElementById('input-fee-headmaster-pct');
        if (inHeadmasterPct && document.activeElement !== inHeadmasterPct) {
            const roundedH = Math.round(exactHeadmasterPct * 100) / 100;
            inHeadmasterPct.value = Number.isInteger(roundedH) ? String(roundedH) : roundedH.toFixed(2);
        }
    } else if (sourceField === 'equal-pool') {
        const inEqualPool = document.getElementById('input-fee-equal-pool');
        const rawPool = inEqualPool ? parseNumberSafe(inEqualPool.value.replace(/\D/g, ''), 0) : 0;
        explicitPool = rawPool;
        const gtkCountEl = document.getElementById('fee-equal-gtk-count');
        const gtkCount = (currentFeeDistributionResult?.allocations?.equality?.count) || parseInt(gtkCountEl?.textContent, 10) || 1;
        const perPerson = gtkCount > 0 ? Math.floor(rawPool / gtkCount) : 0;
        explicitPerPerson = perPerson;
        exactEqualPct = (rawPool / totalFeePool) * 100;
        const inEqualPct = document.getElementById('input-fee-equal-pct');
        if (inEqualPct && document.activeElement !== inEqualPct) {
            const roundedE = Math.round(exactEqualPct * 100) / 100;
            inEqualPct.value = Number.isInteger(roundedE) ? String(roundedE) : roundedE.toFixed(2);
        }

        const inEqualPerPerson = document.getElementById('input-fee-equal-per-person');
        if (inEqualPerPerson && document.activeElement !== inEqualPerPerson) {
            inEqualPerPerson.value = formatCurrencyInput(perPerson);
        }
    } else if (sourceField === 'equal-person') {
        const inEqualPerPerson = document.getElementById('input-fee-equal-per-person');
        const rawPerPerson = inEqualPerPerson ? parseNumberSafe(inEqualPerPerson.value.replace(/\D/g, ''), 0) : 0;
        explicitPerPerson = rawPerPerson;
        const gtkCountEl = document.getElementById('fee-equal-gtk-count');
        const gtkCount = (currentFeeDistributionResult?.allocations?.equality?.count) || parseInt(gtkCountEl?.textContent, 10) || 1;
        const totalPool = rawPerPerson * gtkCount;
        explicitPool = totalPool;
        exactEqualPct = (totalPool / totalFeePool) * 100;
        const inEqualPct = document.getElementById('input-fee-equal-pct');
        if (inEqualPct && document.activeElement !== inEqualPct) {
            const roundedE = Math.round(exactEqualPct * 100) / 100;
            inEqualPct.value = Number.isInteger(roundedE) ? String(roundedE) : roundedE.toFixed(2);
        }

        const inEqualPool = document.getElementById('input-fee-equal-pool');
        if (inEqualPool && document.activeElement !== inEqualPool) {
            inEqualPool.value = formatCurrencyInput(totalPool);
        }
    }

    // Ambil nilai seluruh komponen persentase terkini yang sudah tersinkronkan
    const inCoop = document.getElementById('input-fee-coop-pct');
    const eVal = exactEqualPct;
    const hVal = exactHeadmasterPct;
    const sVal = 0.0; // Murni 4 kartu alokasi, kas sekolah ditiadakan dari sub-komponen

    // Koperasi Sekolah otomatis menjadi penampung sisa alokasi 100% dari 3 kartu lainnya
    const otherSubPct = eVal + tVal + hVal;
    const cVal = Math.max(0, 100 - otherSubPct);
    if (inCoop) {
        const roundedC = Math.round(cVal * 100) / 100;
        inCoop.value = Number.isInteger(roundedC) ? String(roundedC) : roundedC.toFixed(2);
    }

    const totalSubPct = Math.round((cVal + eVal + tVal + hVal) * 100) / 100;
    const badgeTotal = document.getElementById('badge-fee-total-pct');
    if (badgeTotal) {
        if (Math.abs(totalSubPct - 100) < 0.05) {
            badgeTotal.textContent = 'Total Alokasi: 100%';
            badgeTotal.className = 'px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800';
        } else {
            badgeTotal.textContent = `Total: ${totalSubPct.toFixed(2)}% (Disarankan 100%)`;
            badgeTotal.className = 'px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 animate-pulse';
        }
    }

    const liveSettings = {
        feeRatePercentage: rateVal,
        schoolPercentage: 0,
        cooperativePercentage: cVal,
        equalityPercentage: eVal,
        teacherPercentage: tVal,
        headmasterPercentage: hVal,
        equalityPerPerson: explicitPerPerson,
        equalityPool: explicitPool,
        headmasterAmount: explicitHeadmaster
    };

    if (currentFeeDistributionSettings) {
        Object.assign(currentFeeDistributionSettings, liveSettings);
    }

    // Live recalculation instan dengan menandai activeSource agar nilai input yang sedang diketik tidak tertimpa
    return renderFeeSharingTab(liveSettings, sourceField);
}

export function updateFeePreviewEstimates(settings = null) {
    // Estimasi terintegrasi langsung dalam live recalculation renderFeeSharingTab
}

export function updateFeeSettingsUI() {
    const settings = getFeeDistributionSettings();
    const formatPctInput = (val) => {
        const n = parseFloat(val);
        if (isNaN(n)) return '0';
        return Number.isInteger(n) ? String(n) : n.toFixed(2);
    };
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && document.activeElement !== el) {
            el.value = String(val);
        }
    };
    setVal('input-fee-rate-pct', formatPctInput(settings.feeRatePercentage));
    setVal('input-fee-school-pct', 0);
    setVal('input-fee-coop-pct', formatPctInput(settings.cooperativePercentage));
    setVal('input-fee-equal-pct', formatPctInput(settings.equalityPercentage));
    setVal('input-fee-headmaster-pct', formatPctInput(settings.headmasterPercentage));
    setVal('input-fee-teacher-pct', formatPctInput(settings.teacherPercentage));

    if (settings.equalityPerPerson) {
        const el = document.getElementById('input-fee-equal-per-person');
        if (el && document.activeElement !== el) el.value = formatCurrencyInput(settings.equalityPerPerson);
    }
    if (settings.equalityPool) {
        const el = document.getElementById('input-fee-equal-pool');
        if (el && document.activeElement !== el) el.value = formatCurrencyInput(settings.equalityPool);
    }
    if (settings.headmasterAmount) {
        const el = document.getElementById('input-fee-headmaster-amount');
        if (el && document.activeElement !== el) el.value = formatCurrencyInput(settings.headmasterAmount);
    }

    const badgeTotal = document.getElementById('badge-fee-total-pct');
    if (badgeTotal) {
        const sum = Math.round((settings.cooperativePercentage + settings.equalityPercentage + settings.teacherPercentage + settings.headmasterPercentage) * 100) / 100;
        if (Math.abs(sum - 100) < 0.05) {
            badgeTotal.textContent = 'Total Alokasi: 100%';
            badgeTotal.className = 'px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800';
        } else {
            badgeTotal.textContent = `Total: ${sum.toFixed(2)}% (Disarankan 100%)`;
            badgeTotal.className = 'px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 animate-pulse';
        }
    }
}

export async function saveFeeDistributionSettings() {
    const inRate = document.getElementById('input-fee-rate-pct');
    const inCoop = document.getElementById('input-fee-coop-pct');
    const inEqual = document.getElementById('input-fee-equal-pct');
    const inTeacher = document.getElementById('input-fee-teacher-pct');
    const inHeadmaster = document.getElementById('input-fee-headmaster-pct');

    const inEqualPerPerson = document.getElementById('input-fee-equal-per-person');
    const inEqualPool = document.getElementById('input-fee-equal-pool');
    const inHeadmasterNominal = document.getElementById('input-fee-headmaster-amount');

    const rateVal = inRate ? parseFloat(inRate.value) : DEFAULT_FEE_DISTRIBUTION_SETTINGS.feeRatePercentage;
    let eVal = inEqual ? parseFloat(inEqual.value) : DEFAULT_FEE_DISTRIBUTION_SETTINGS.equalityPercentage;
    const tVal = inTeacher ? parseFloat(inTeacher.value) : DEFAULT_FEE_DISTRIBUTION_SETTINGS.teacherPercentage;
    let hVal = inHeadmaster ? parseFloat(inHeadmaster.value) : DEFAULT_FEE_DISTRIBUTION_SETTINGS.headmasterPercentage;

    const rawPerPerson = inEqualPerPerson ? parseNumberSafe(inEqualPerPerson.value.replace(/\D/g, ''), 0) : 0;
    const rawPool = inEqualPool ? parseNumberSafe(inEqualPool.value.replace(/\D/g, ''), 0) : 0;
    const rawHeadmaster = inHeadmasterNominal ? parseNumberSafe(inHeadmasterNominal.value.replace(/\D/g, ''), 0) : 0;

    const books = Array.isArray(currentMatchedData) ? currentMatchedData : [];
    const totalRevenue = books.reduce((sum, b) => sum + parseNumberSafe(b.total, 0), 0);
    const totalFeePool = Math.round(totalRevenue * (rateVal / 100));

    // Jika ada nominal eksplisit, gunakan persentase presisi penuh agar tidak terjadi distorsi desimal
    if (rawPerPerson > 0 && totalFeePool > 0) {
        const gtkCountEl = document.getElementById('fee-equal-gtk-count');
        const gtkCount = (currentFeeDistributionResult?.allocations?.equality?.count) || parseInt(gtkCountEl?.textContent, 10) || 1;
        const totalPool = rawPerPerson * gtkCount;
        eVal = (totalPool / totalFeePool) * 100;
    } else if (rawPool > 0 && totalFeePool > 0) {
        eVal = (rawPool / totalFeePool) * 100;
    }

    if (rawHeadmaster > 0 && totalFeePool > 0) {
        hVal = (rawHeadmaster / totalFeePool) * 100;
    }

    // Koperasi Sekolah otomatis menjadi penampung sisa alokasi 100% dari 3 kartu lainnya
    const otherSubPct = eVal + tVal + hVal;
    const cVal = Math.max(0, 100 - otherSubPct);
    if (inCoop) inCoop.value = cVal.toFixed(2);

    const newSettings = {
        feeRatePercentage: isNaN(rateVal) ? DEFAULT_FEE_DISTRIBUTION_SETTINGS.feeRatePercentage : rateVal,
        schoolPercentage: 0,
        cooperativePercentage: cVal,
        equalityPercentage: isNaN(eVal) ? DEFAULT_FEE_DISTRIBUTION_SETTINGS.equalityPercentage : eVal,
        headmasterPercentage: isNaN(hVal) ? DEFAULT_FEE_DISTRIBUTION_SETTINGS.headmasterPercentage : hVal,
        teacherPercentage: isNaN(tVal) ? DEFAULT_FEE_DISTRIBUTION_SETTINGS.teacherPercentage : tVal,
        equalityPerPerson: rawPerPerson > 0 ? rawPerPerson : null,
        equalityPool: rawPool > 0 ? rawPool : (rawPerPerson > 0 ? rawPerPerson * ((currentFeeDistributionResult?.allocations?.equality?.count) || 1) : null),
        headmasterAmount: rawHeadmaster > 0 ? rawHeadmaster : null
    };

    const sum = Math.round((newSettings.cooperativePercentage + newSettings.equalityPercentage + newSettings.teacherPercentage + newSettings.headmasterPercentage) * 10) / 10;
    if (Math.abs(sum - 100) > 0.1) {
        showToast('Peringatan Proporsi', `Total persentase alokasi saat ini ${sum}%. Disarankan berjumlah tepat 100% agar tidak terjadi defisit atau sisa alokasi dana fee.`, 'warning');
    }

    setFeeDistributionSettings(newSettings);
    updateFeeSettingsUI();
    await saveBookSalesData();

    if (currentActiveTab === 'fees') {
        renderFeeSharingTab();
    }
    if (Array.isArray(currentMatchedData) && currentMatchedData.length > 0) {
        renderTeachersTable(currentMatchedData);
    }

    showToast('Berhasil', 'Pengaturan pembagian fee penjualan LKS berhasil disimpan ke database.', 'success');
}

export async function fetchAllSchoolGtk() {
    let list = [];

    // 1. Ambil dari Cloudflare D1 jika tersedia
    if (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled && typeof cfClient.getGtk === 'function') {
        try {
            const res = await cfClient.getGtk({ status: 'all', limit: 2000 });
            const data = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
            if (data.length > 0) list = data;
        } catch (e) {
            console.warn('[PenjualanBuku] Gagal mengambil GTK via D1:', e);
        }
    }

    // 2. Ambil dari Cache Global (window.getGtkCache / getTeachersCache)
    if (list.length === 0 && typeof window !== 'undefined') {
        try {
            if (typeof window.getGtkCache === 'function') {
                const cached = await window.getGtkCache();
                if (Array.isArray(cached) && cached.length > 0) list = cached;
            } else if (typeof window.getTeachersCache === 'function') {
                const cached = await window.getTeachersCache();
                if (Array.isArray(cached) && cached.length > 0) list = cached;
            }
        } catch (e) {
            console.warn('[PenjualanBuku] Gagal mengambil GTK dari cache:', e);
        }
    }

    // 3. Resilient Fallback Synthesis: Jika API / cache kosong (misal di Node VM Jest atau offline)
    // Bangun daftar dari Kepala Sekolah SSOT + Seluruh Guru dari Jadwal XML / Matched Books
    const teacherMap = {};
    if (currentParsedSchedule && currentParsedSchedule.teachersMap) {
        currentParsedSchedule.teachersMap.forEach(t => {
            const name = t.simasName || t.name || t.id;
            if (name && !teacherMap[name]) {
                teacherMap[name] = {
                    id: t.id || name,
                    nama: name,
                    nip: t.nip || '-',
                    role: 'guru',
                    jenis_ptk: 'Guru Mapel',
                    tugas_tambahan: '-',
                    status: 'aktif'
                };
            }
        });
    }

    const salesTeachers = aggregateSalesByTeacher(currentMatchedData || []);
    salesTeachers.forEach(st => {
        if (st.teacherName && st.teacherName !== 'Guru Belum Terpetakan' && !teacherMap[st.teacherName]) {
            teacherMap[st.teacherName] = {
                id: st.teacherName,
                nama: st.teacherName,
                nip: '-',
                role: 'guru',
                jenis_ptk: 'Guru Mapel',
                tugas_tambahan: '-',
                status: 'aktif'
            };
        }
    });

    if (list.length === 0) {
        const headmasterCfg = (typeof SCHOOL_CONFIG !== 'undefined' && SCHOOL_CONFIG) ? SCHOOL_CONFIG : {};
        const headmasterObj = {
            id: 'kepsek-ssot',
            nama: headmasterCfg.headmasterName || "Dr. I Wayan Sudarsana, M.Pd.",
            nip: headmasterCfg.headmasterNIP || "197501012000031001",
            role: 'kepsek',
            jenis_ptk: 'Kepala Sekolah',
            tugas_tambahan: 'Kepala Sekolah',
            status: 'aktif'
        };
        list = [headmasterObj, ...Object.values(teacherMap)];
    }

    // Saring hanya GTK yang berstatus aktif
    return list.filter(item => {
        if (!item) return false;
        const s = String(item.status || item.keaktifan || 'aktif').toLowerCase();
        return s !== 'nonaktif' && s !== 'inactive' && s !== 'keluar' && s !== 'pensiun';
    });
}

export function classifyGtkRole(item, teacherNamesSet = new Set()) {
    if (!item) return 'tendik';
    const rawRole = String(item.role || '').toLowerCase();
    const jabatan = String(item.jabatan || item.tugas_tambahan || item.jenis_ptk || '').toLowerCase();
    const rawNama = String(item.nama || item.name || '').trim();
    const namaLower = rawNama.toLowerCase();
    const nip = String(item.nip || '').trim();

    const headmasterCfg = (typeof SCHOOL_CONFIG !== 'undefined' && SCHOOL_CONFIG) ? SCHOOL_CONFIG : {};
    const hmNip = String(headmasterCfg.headmasterNIP || '').trim();
    const hmName = String(headmasterCfg.headmasterName || '').toLowerCase();

    // 1. Deteksi Kepala Sekolah
    const isKepsek = (hmNip && nip === hmNip) ||
        (hmName && namaLower.includes(hmName.slice(0, 8))) ||
        jabatan.includes('kepala sekolah') ||
        jabatan.includes('kepsek') ||
        rawRole === 'kepsek' ||
        rawRole === 'headmaster';

    if (isKepsek) return 'kepsek';

    // 2. Deteksi Guru
    const norm = normalizeKey(rawNama);
    let isTeaching = false;
    teacherNamesSet.forEach(tName => {
        const normT = normalizeKey(tName);
        if (normT === norm || (norm.length > 5 && (normT.includes(norm) || norm.includes(normT)))) {
            isTeaching = true;
        }
    });

    if (isTeaching || jabatan.includes('guru') || rawRole === 'guru' || rawRole === 'teacher') {
        return 'guru';
    }

    // 3. Default: Tenaga Kependidikan (Tendik / Pegawai)
    return 'tendik';
}

export function calculateFeeDistribution(totalRevenue, gtkList, teacherAggregates, settings = null) {
    const revenue = Math.max(0, parseNumberSafe(totalRevenue, 0));
    const activeSettings = settings ? { ...settings } : getFeeDistributionSettings();

    // 1. Fee Penjualan LKS ke Sekolah (Besar Fee Dasar dari Total Omzet)
    const feeRatePct = parseNumberSafe(
        activeSettings.feeRatePercentage != null ? activeSettings.feeRatePercentage : activeSettings.schoolPercentage,
        DEFAULT_FEE_DISTRIBUTION_SETTINGS.feeRatePercentage
    );
    const totalFeePool = Math.round(revenue * (feeRatePct / 100));

    // 2. Persentase Alokasi Sub-Komponen dari Dana Fee Sekolah (Murni 4 Kartu: Koperasi, Pemerataan GTK, Guru Mapel, Kepsek)
    const schoolPct = 0.0;
    let equalPct = parseNumberSafe(activeSettings.equalityPercentage, DEFAULT_FEE_DISTRIBUTION_SETTINGS.equalityPercentage);
    let kepsekPct = parseNumberSafe(activeSettings.headmasterPercentage, DEFAULT_FEE_DISTRIBUTION_SETTINGS.headmasterPercentage);
    const teacherPct = parseNumberSafe(activeSettings.teacherPercentage, DEFAULT_FEE_DISTRIBUTION_SETTINGS.teacherPercentage);

    // Siapkan Lookup Agregasi Penjualan Guru (Merge agar variasi tanda baca / gelar tidak saling overwrite)
    const teacherAggs = Array.isArray(teacherAggregates) ? teacherAggregates : [];
    const teacherMap = new Map();
    const teacherNamesSet = new Set();

    teacherAggs.forEach(t => {
        if (!t || !t.teacherName) return;
        teacherNamesSet.add(t.teacherName);
        const norm = normalizeKey(t.teacherName);
        if (!teacherMap.has(norm)) {
            teacherMap.set(norm, {
                teacherName: t.teacherName,
                books: [...(t.books || [])],
                totalTerjual: t.totalTerjual || 0,
                totalNominal: t.totalNominal || 0
            });
        } else {
            const existing = teacherMap.get(norm);
            existing.books.push(...(t.books || []));
            existing.totalTerjual += (t.totalTerjual || 0);
            existing.totalNominal += (t.totalNominal || 0);
        }
    });

    // Klasifikasi Awal & Gabungkan GTK + Guru Mengajar yang belum terdaftar di master GTK
    const allPersonsMap = new Map();
    const rawGtk = Array.isArray(gtkList) ? gtkList : [];

    rawGtk.forEach(g => {
        if (!g) return;
        const rawNama = String(g.nama || g.name || 'GTK Tanpa Nama').trim();
        const key = normalizeKey(rawNama) || `gtk-${allPersonsMap.size}`;
        const role = classifyGtkRole(g, teacherNamesSet);
        allPersonsMap.set(key, {
            id: g.id || key,
            key,
            nama: rawNama,
            nip: g.nip || '-',
            role,
            rawItem: g
        });
    });

    // Pastikan seluruh guru yang memiliki omzet mengajar di agregasi terdaftar
    teacherAggs.forEach(t => {
        if (!t || !t.teacherName || t.teacherName === 'Guru Belum Terpetakan') return;
        const norm = normalizeKey(t.teacherName);
        const cleanT = cleanAcademicTitle(t.teacherName);
        let foundKey = null;
        for (const [k, p] of allPersonsMap.entries()) {
            const cleanP = cleanAcademicTitle(p.nama || k);
            if (k === norm || (norm.length > 5 && (k.includes(norm) || norm.includes(k))) ||
                (cleanT && cleanP && (cleanT === cleanP || cleanP.includes(cleanT) || cleanT.includes(cleanP)))) {
                foundKey = k;
                p.role = 'guru'; // Pastikan perannya guru
                break;
            }
        }
        if (!foundKey) {
            allPersonsMap.set(norm, {
                id: t.teacherName,
                key: norm,
                nama: t.teacherName,
                nip: '-',
                role: 'guru',
                rawItem: null
            });
        }
    });

    const personsList = Array.from(allPersonsMap.values());
    const totalGtkCount = personsList.length;

    // Hitung nominal Pemerataan GTK & Insentif Kepsek:
    // Utamakan nominal eksplisit jika diisi pengguna untuk mencegah lonjakan pembulatan desimal (misal 100.000 menjadi 100.017)
    let amountEqualPerPerson = 0;
    let poolEqual = 0;
    if (activeSettings.equalityPerPerson != null && activeSettings.equalityPerPerson > 0) {
        amountEqualPerPerson = Math.round(activeSettings.equalityPerPerson);
        poolEqual = amountEqualPerPerson * totalGtkCount;
        if (totalFeePool > 0) equalPct = (poolEqual / totalFeePool) * 100;
    } else if (activeSettings.equalityPool != null && activeSettings.equalityPool > 0) {
        poolEqual = Math.round(activeSettings.equalityPool);
        amountEqualPerPerson = totalGtkCount > 0 ? Math.floor(poolEqual / totalGtkCount) : 0;
        if (totalFeePool > 0) equalPct = (poolEqual / totalFeePool) * 100;
    } else {
        poolEqual = Math.round(totalFeePool * (equalPct / 100));
        amountEqualPerPerson = totalGtkCount > 0 ? Math.floor(poolEqual / totalGtkCount) : 0;
    }

    let amountKepsek = 0;
    if (activeSettings.headmasterAmount != null && activeSettings.headmasterAmount > 0) {
        amountKepsek = Math.round(activeSettings.headmasterAmount);
        if (totalFeePool > 0) kepsekPct = (amountKepsek / totalFeePool) * 100;
    } else {
        amountKepsek = Math.round(totalFeePool * (kepsekPct / 100));
    }

    const poolTeacher = Math.round(totalFeePool * (teacherPct / 100));
    const amountSchool = 0;

    // Aturan Penyeimbang Otomatis Koperasi:
    // Koperasi Sekolah adalah buffer penampung sisa alokasi 100% dari 3 kartu lainnya (Pemerataan, Kepsek, Guru Mapel)
    const otherSum = equalPct + kepsekPct + teacherPct;
    let coopPct = Math.max(0, 100 - otherSum);
    const amountCoop = Math.round(totalFeePool * (coopPct / 100));

    let totalSpecialKepsek = 0;
    let totalSpecialGuru = 0;
    let totalPemerataanDistributed = 0;

    const persons = personsList.map(person => {
        let omzet = 0;
        let omzet10 = 0;
        let omzet11 = 0;
        let omzet12 = 0;
        let fee10 = 0;
        let fee11 = 0;
        let fee12 = 0;
        let specialPct = 0;
        let specialAmount = 0;
        let teachingDetails = [];
        let tugas = '-';

        if (person.role === 'kepsek') {
            specialPct = kepsekPct;
            specialAmount = amountKepsek;
            totalSpecialKepsek += specialAmount;
            tugas = 'Kepala Sekolah (Pimpinan)';
        } else if (person.role === 'guru') {
            specialPct = teacherPct;
            let agg = teacherMap.get(person.key);
            if (!agg) {
                // Fuzzy match fallback menggunakan normalizeKey dan cleanAcademicTitle
                const personClean = cleanAcademicTitle(person.nama || person.key);
                for (const [k, a] of teacherMap.entries()) {
                    const aggClean = cleanAcademicTitle(a.teacherName || k);
                    if (person.key === k || (k.length > 4 && (person.key.includes(k) || k.includes(person.key))) ||
                        (personClean && aggClean && (personClean === aggClean || personClean.includes(aggClean) || aggClean.includes(personClean)))) {
                        agg = a;
                        break;
                    }
                }
            }

            if (agg) {
                omzet = parseNumberSafe(agg.totalNominal, 0);
                teachingDetails = Array.isArray(agg.books) ? agg.books : [];
                teachingDetails.forEach(b => {
                    const g = parseInt(b.grade, 10);
                    const bNominal = parseNumberSafe(b.propNominal, 0);
                    if (g === 10) omzet10 += bNominal;
                    else if (g === 11) omzet11 += bNominal;
                    else if (g === 12) omzet12 += bNominal;
                });
                const mapelList = teachingDetails.map(b => `${b.subject} (${b.classCount || 0} kls)`).slice(0, 3);
                tugas = mapelList.join(', ') + (teachingDetails.length > 3 ? ` +${teachingDetails.length - 3} lainnya` : '');
            } else {
                tugas = person.rawItem?.tugas_tambahan || person.rawItem?.jenis_ptk || 'Guru Mapel';
            }

            // Proporsionalitas fee guru per jenjang kelas (10, 11, 12) bersumber dari pool fee guru
            if (revenue > 0) {
                fee10 = Math.round(poolTeacher * (omzet10 / revenue));
                fee11 = Math.round(poolTeacher * (omzet11 / revenue));
                fee12 = Math.round(poolTeacher * (omzet12 / revenue));
                specialAmount = fee10 + fee11 + fee12;
            } else {
                fee10 = 0;
                fee11 = 0;
                fee12 = 0;
                specialAmount = 0;
            }
            totalSpecialGuru += specialAmount;
        } else {
            // Tendik / Pegawai
            specialPct = 0;
            specialAmount = 0;
            tugas = person.rawItem?.jabatan || person.rawItem?.tugas_tambahan || person.rawItem?.jenis_ptk || 'Pegawai';
        }

        const equalAmount = amountEqualPerPerson;
        totalPemerataanDistributed += equalAmount;
        const totalAmount = specialAmount + equalAmount;
        const pembulatan = Math.floor(totalAmount / 1000) * 1000;

        return {
            ...person,
            tugas,
            omzet,
            omzet10,
            omzet11,
            omzet12,
            fee10,
            fee11,
            fee12,
            specialPct,
            specialAmount,
            equalAmount,
            totalAmount,
            pembulatan,
            teachingDetails
        };
    });

    // Urutkan: Guru terlebih dahulu (A-Z), lalu Kepala Sekolah, lalu Tenaga Kependidikan / Pegawai (A-Z)
    // Sesuai konvensi laporan spreadsheet rekapitulasi fee SMAGESA
    persons.sort((a, b) => {
        const roleOrder = { guru: 1, kepsek: 2, tendik: 3 };
        const orderDiff = (roleOrder[a.role] || 99) - (roleOrder[b.role] || 99);
        if (orderDiff !== 0) return orderDiff;
        return a.nama.localeCompare(b.nama, 'id-ID');
    });

    const subKepsek = persons.filter(p => p.role === 'kepsek').reduce((s, p) => s + p.totalAmount, 0);
    const subGuru = persons.filter(p => p.role === 'guru').reduce((s, p) => s + p.totalAmount, 0);
    const subTendik = persons.filter(p => p.role === 'tendik').reduce((s, p) => s + p.totalAmount, 0);
    const totalGtkDistributed = subKepsek + subGuru + subTendik;

    const totFee10 = persons.reduce((s, p) => s + (p.fee10 || 0), 0);
    const totFee11 = persons.reduce((s, p) => s + (p.fee11 || 0), 0);
    const totFee12 = persons.reduce((s, p) => s + (p.fee12 || 0), 0);
    const totPembulatan = persons.reduce((s, p) => s + (p.pembulatan || 0), 0);

    return {
        totalRevenue: revenue,
        totalFeePool: totalFeePool,
        feeRatePercentage: feeRatePct,
        settings: {
            ...activeSettings,
            feeRatePercentage: feeRatePct,
            schoolPercentage: schoolPct,
            cooperativePercentage: Math.round(coopPct * 100) / 100,
            equalityPercentage: Math.round(equalPct * 100) / 100,
            headmasterPercentage: Math.round(kepsekPct * 100) / 100,
            teacherPercentage: teacherPct,
            exactCooperativePercentage: coopPct,
            exactEqualityPercentage: equalPct,
            exactHeadmasterPercentage: kepsekPct,
            equalityPerPerson: amountEqualPerPerson,
            equalityPool: poolEqual,
            headmasterAmount: amountKepsek
        },
        allocations: {
            school: { pct: schoolPct, amount: amountSchool },
            cooperative: { pct: Math.round(coopPct * 100) / 100, exactPct: coopPct, amount: amountCoop },
            equality: {
                pct: Math.round(equalPct * 100) / 100,
                exactPct: equalPct,
                poolAmount: poolEqual,
                perPerson: amountEqualPerPerson,
                count: totalGtkCount,
                distributedAmount: totalPemerataanDistributed
            },
            headmaster: { pct: Math.round(kepsekPct * 100) / 100, exactPct: kepsekPct, totalAmount: totalSpecialKepsek },
            teachers: { pct: teacherPct, exactPct: teacherPct, poolAmount: poolTeacher, totalAmount: totalSpecialGuru }
        },
        summary: {
            subKepsek,
            subGuru,
            subTendik,
            totalGtk: totalGtkDistributed,
            totFee10,
            totFee11,
            totFee12,
            totPembulatan,
            grandTotal: amountSchool + amountCoop + totalGtkDistributed
        },
        persons
    };
}

export async function renderFeeSharingTab(previewSettings = null, activeSource = null) {
    const panel = document.getElementById('tab-panel-fees');
    if (!panel) return;

    const tbody = document.getElementById('table-fees-body');

    try {
        const books = Array.isArray(currentMatchedData) ? currentMatchedData : [];
        const booksWithSales = getBooksWithPeriodSales(books, currentTransactions, currentSelectedSemesterPeriod);
        const totalRevenue = booksWithSales.reduce((sum, b) => sum + parseNumberSafe(b.total, 0), 0);
        const gtkList = await fetchAllSchoolGtk();
        const teacherAggregates = aggregateSalesByTeacher(booksWithSales);
        const settings = previewSettings || getFeeDistributionSettings();

        const result = calculateFeeDistribution(totalRevenue, gtkList, teacherAggregates, settings);
        setCurrentFeeDistributionResult(result);

        // Update Ringkasan Alokasi Komponen
        const setTxt = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        const activePeriod = getCurrentSelectedSemesterPeriod();
        setTxt('fee-summary-period', activePeriod);
        setTxt('fee-summary-total-revenue', formatRupiah(result.totalRevenue));
        setTxt('fee-summary-total-fee', `${formatRupiah(result.totalFeePool)} (${result.feeRatePercentage}%)`);

        const formatBadgePct = (val) => {
            const n = parseFloat(val);
            if (isNaN(n)) return '0%';
            return Number.isInteger(n) ? `${n}%` : `${n.toFixed(2)}%`;
        };

        setTxt('fee-pct-school-badge', `${result.settings.schoolPercentage}%`);
        setTxt('fee-amount-school', formatRupiah(result.allocations.school.amount));

        setTxt('fee-pct-coop-badge', formatBadgePct(result.settings.cooperativePercentage));
        setTxt('fee-amount-coop', formatRupiah(result.allocations.cooperative.amount));

        setTxt('fee-pct-equal-badge', formatBadgePct(result.settings.equalityPercentage));
        setTxt('fee-amount-equal-pool', formatRupiah(result.allocations.equality.poolAmount));
        setTxt('fee-equal-gtk-count', String(result.allocations.equality.count));
        setTxt('fee-amount-equal-per-person', formatRupiah(result.allocations.equality.perPerson));

        setTxt('fee-pct-headmaster-badge', formatBadgePct(result.settings.headmasterPercentage));
        setTxt('fee-pct-teacher-badge', formatBadgePct(result.settings.teacherPercentage));
        setTxt('fee-amount-total-gtk', formatRupiah(result.summary.totalGtk));

        const teacherPoolAmount = result.allocations.teachers.totalAmount || result.allocations.teachers.poolAmount;
        const headmasterSpecialAmount = result.allocations.headmaster.totalAmount;
        const teacherCount = result.persons.filter(p => p.role === 'guru').length;

        setTxt('fee-summary-sub-guru', formatRupiah(teacherPoolAmount));
        setTxt('fee-summary-guru-gross', formatRupiah(result.summary.subGuru));
        setTxt('fee-summary-teacher-count', String(teacherCount));

        setTxt('fee-summary-sub-kepsek', formatRupiah(headmasterSpecialAmount));
        setTxt('fee-summary-kepsek-gross', formatRupiah(result.summary.subKepsek));
        setTxt('fee-summary-sub-tendik', formatRupiah(result.summary.subTendik));

        // Sinkronkan input persentase (%) jika elemen bukan elemen aktif pengetikan
        const updatePctInput = (id, val) => {
            const el = document.getElementById(id);
            if (el && document.activeElement !== el) {
                const n = parseFloat(val);
                el.value = isNaN(n) ? '0' : (Number.isInteger(n) ? String(n) : n.toFixed(2));
            }
        };
        updatePctInput('input-fee-rate-pct', result.settings.feeRatePercentage);
        updatePctInput('input-fee-coop-pct', result.settings.cooperativePercentage);
        updatePctInput('input-fee-equal-pct', result.settings.equalityPercentage);
        updatePctInput('input-fee-headmaster-pct', result.settings.headmasterPercentage);
        updatePctInput('input-fee-teacher-pct', result.settings.teacherPercentage);

        const badgeTotal = document.getElementById('badge-fee-total-pct');
        if (badgeTotal) {
            const sum = Math.round((result.settings.cooperativePercentage + result.settings.equalityPercentage + result.settings.teacherPercentage + result.settings.headmasterPercentage) * 100) / 100;
            if (Math.abs(sum - 100) < 0.05) {
                badgeTotal.textContent = 'Total Alokasi: 100%';
                badgeTotal.className = 'px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800';
            } else {
                badgeTotal.textContent = `Total: ${sum.toFixed(2)}% (Disarankan 100%)`;
                badgeTotal.className = 'px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 animate-pulse';
            }
        }

        // Sinkronkan input nominal Rupiah dinamis (jika elemen bukan activeElement / grup sumber ketikan saat ini)
        const isEqualSource = activeSource === 'equal-pool' || activeSource === 'equal-person';
        const updateNominalInput = (id, numVal, isSourceActive) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (document.activeElement === el || isSourceActive) return;
            el.value = formatCurrencyInput(numVal);
        };

        updateNominalInput('input-fee-equal-pool', result.allocations.equality.poolAmount, isEqualSource);
        updateNominalInput('input-fee-equal-per-person', result.allocations.equality.perPerson, isEqualSource);
        updateNominalInput('input-fee-headmaster-amount', result.allocations.headmaster.totalAmount, activeSource === 'headmaster-amount');

        const thSpecial = document.getElementById('th-fee-special');
        if (thSpecial) {
            thSpecial.textContent = 'Fee Khusus / Guru';
            thSpecial.title = `Fee Khusus (${result.settings.headmasterPercentage}% Kepsek / ${result.settings.teacherPercentage}% Guru)`;
        }
        const thEqual = document.getElementById('th-fee-equal');
        if (thEqual) {
            thEqual.textContent = 'Pemerataan';
            thEqual.title = `Pemerataan (@${formatRupiah(result.allocations.equality.perPerson)})`;
        }

        renderFeeSharingTable();
    } catch (err) {
        console.error('[PenjualanBuku] Gagal merender tab pembagian fee:', err);
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="11" class="py-8 text-center text-rose-500 font-medium">
                        <i class="fa-solid fa-triangle-exclamation mr-2"></i>Terjadi kesalahan saat menghitung alokasi fee: ${escapeHTML(err.message || 'Galat sistem')}
                    </td>
                </tr>
            `;
        }
    }
}

export function onFeeRoleFilterChanged() {
    const select = document.getElementById('filter-fee-role');
    setFeeRoleFilter(select ? select.value : 'all');
    renderFeeSharingTable();
}

export function renderFeeSharingTable() {
    const tbody = document.getElementById('table-fees-body');
    const tfoot = document.getElementById('table-fees-footer');
    const countBadge = document.getElementById('fee-table-count-badge');
    if (!tbody) return;

    const res = getCurrentFeeDistributionResult();
    if (!res || !Array.isArray(res.persons)) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="py-10 text-center text-slate-400">
                    Belum ada data rekapitulasi fee yang dihitung.
                </td>
            </tr>
        `;
        if (tfoot) tfoot.innerHTML = '';
        return;
    }

    const roleFilter = getFeeRoleFilter();
    const searchKw = (currentSearchKeyword || '').toLowerCase();

    const thSpecial = document.getElementById('th-fee-special');
    if (thSpecial) {
        if (roleFilter === 'guru') {
            thSpecial.textContent = 'Total Guru';
            thSpecial.title = 'Total Fee Proporsional Guru Mapel (Kelas 10 + 11 + 12)';
        } else if (roleFilter === 'kepsek') {
            thSpecial.textContent = 'Insentif Kepsek';
            thSpecial.title = 'Insentif Khusus Pimpinan (Kepala Sekolah)';
        } else {
            thSpecial.textContent = 'Fee Khusus / Guru';
            thSpecial.title = `Fee Khusus (Guru Mapel: ${res.settings?.teacherPercentage || 0}% + Insentif Kepsek: ${res.settings?.headmasterPercentage || 0}%)`;
        }
    }

    const filtered = res.persons.filter(p => {
        // Filter Peran
        if (roleFilter !== 'all' && p.role !== roleFilter) {
            return false;
        }
        // Filter Pencarian
        if (searchKw) {
            const matchName = p.nama.toLowerCase().includes(searchKw);
            const matchNip = String(p.nip || '').includes(searchKw);
            const matchTugas = String(p.tugas || '').toLowerCase().includes(searchKw);
            const matchRole = String(p.role || '').toLowerCase().includes(searchKw);
            if (!matchName && !matchNip && !matchTugas && !matchRole) {
                return false;
            }
        }
        return true;
    });

    if (countBadge) {
        countBadge.textContent = `${filtered.length} Orang`;
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="py-12 text-center text-slate-400 dark:text-slate-500">
                    <i class="fa-solid fa-users-slash text-2xl mb-2 opacity-50 block"></i>
                    Tidak ada GTK yang cocok dengan filter "${escapeHTML(roleFilter)}" atau kata kunci pencarian.
                </td>
            </tr>
        `;
        if (tfoot) tfoot.innerHTML = '';
        return;
    }

    let totFee10 = 0;
    let totFee11 = 0;
    let totFee12 = 0;
    let totSpecial = 0;
    let totEqual = 0;
    let totFinal = 0;
    let totPembulatan = 0;
    let totGuruSpecial = 0;
    let totKepsekSpecial = 0;

    let html = '';
    filtered.forEach((p, idx) => {
        totFee10 += p.fee10 || 0;
        totFee11 += p.fee11 || 0;
        totFee12 += p.fee12 || 0;
        totSpecial += p.specialAmount || 0;
        totEqual += p.equalAmount || 0;
        totFinal += p.totalAmount || 0;
        totPembulatan += p.pembulatan || 0;
        if (p.role === 'guru') {
            totGuruSpecial += p.specialAmount || 0;
        } else if (p.role === 'kepsek') {
            totKepsekSpecial += p.specialAmount || 0;
        }

        let roleBadge = '';
        if (p.role === 'kepsek') {
            roleBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">Kepsek</span>`;
        } else if (p.role === 'guru') {
            roleBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">Guru</span>`;
        } else {
            roleBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Pegawai</span>`;
        }

        let specialCellTitle = '';
        if (p.role === 'guru') {
            specialCellTitle = `Total Guru: ${formatRupiah(p.specialAmount)} (10: ${formatRupiah(p.fee10 || 0)} + 11: ${formatRupiah(p.fee11 || 0)} + 12: ${formatRupiah(p.fee12 || 0)})`;
        } else if (p.role === 'kepsek') {
            specialCellTitle = `Insentif Khusus Kepsek: ${formatRupiah(p.specialAmount)}`;
        }

        html += `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                <td class="px-2.5 py-2.5 text-center text-slate-400 text-xs">${idx + 1}</td>
                <td class="px-3 py-2.5">
                    <div class="font-semibold text-slate-900 dark:text-white leading-tight">${escapeHTML(p.nama)}</div>
                    ${p.nip && p.nip !== '-' ? `<div class="text-[10px] font-mono text-slate-400 mt-0.5">${escapeHTML(p.nip)}</div>` : ''}
                </td>
                <td class="px-2.5 py-2.5 text-center whitespace-nowrap">${roleBadge}</td>
                <td class="px-2.5 py-2.5 text-right font-mono text-xs text-slate-700 dark:text-slate-300" title="${p.omzet10 > 0 ? 'Omzet Kelas 10: ' + formatRupiah(p.omzet10) : ''}">${p.fee10 > 0 ? formatRupiah(p.fee10) : '-'}</td>
                <td class="px-2.5 py-2.5 text-right font-mono text-xs text-slate-700 dark:text-slate-300" title="${p.omzet11 > 0 ? 'Omzet Kelas 11: ' + formatRupiah(p.omzet11) : ''}">${p.fee11 > 0 ? formatRupiah(p.fee11) : '-'}</td>
                <td class="px-2.5 py-2.5 text-right font-mono text-xs text-slate-700 dark:text-slate-300" title="${p.omzet12 > 0 ? 'Omzet Kelas 12: ' + formatRupiah(p.omzet12) : ''}">${p.fee12 > 0 ? formatRupiah(p.fee12) : '-'}</td>
                <td class="px-3 py-2.5 text-right font-mono text-xs text-slate-700 dark:text-slate-300 font-semibold" title="${escapeHTML(specialCellTitle)}">${p.specialAmount > 0 ? formatRupiah(p.specialAmount) : '-'}</td>
                <td class="px-3 py-2.5 text-right font-mono text-xs text-slate-700 dark:text-slate-300">${formatRupiah(p.equalAmount)}</td>
                <td class="px-3 py-2.5 text-right font-mono text-xs text-slate-900 dark:text-slate-100 font-semibold">${formatRupiah(p.totalAmount)}</td>
                <td class="px-3.5 py-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 text-xs sm:text-sm whitespace-nowrap bg-emerald-50/40 dark:bg-emerald-950/20">${formatRupiah(p.pembulatan)}</td>
                <td class="px-2.5 py-2.5 text-center whitespace-nowrap no-print">
                    <button type="button" onclick="window.openFeeDetailModal('${escapeHTML(p.key)}')"
                        class="w-7 h-7 inline-flex items-center justify-center rounded-lg bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-600 dark:bg-slate-750 dark:hover:bg-blue-900/40 dark:text-slate-300 dark:hover:text-blue-300 text-xs transition-colors cursor-pointer" title="Lihat Rincian Perhitungan">
                        <i class="fa-regular fa-eye"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    if (tfoot) {
        const tooltipSpecial = (totKepsekSpecial > 0 && totGuruSpecial > 0)
            ? `Total: ${formatRupiah(totSpecial)} (Guru: ${formatRupiah(totGuruSpecial)} + Kepsek: ${formatRupiah(totKepsekSpecial)})`
            : (totKepsekSpecial > 0 ? `Insentif Kepsek: ${formatRupiah(totKepsekSpecial)}` : `Total Guru: ${formatRupiah(totGuruSpecial)}`);

        let footerSpecialContent = `<div class="font-mono text-xs font-semibold leading-tight" title="${tooltipSpecial}">${formatRupiah(totSpecial)}</div>`;
        if (totKepsekSpecial > 0 && totGuruSpecial > 0) {
            footerSpecialContent += `
                <div class="text-[9.5px] font-sans font-normal text-slate-500 dark:text-slate-400 leading-tight mt-0.5 whitespace-nowrap" title="Rincian: Guru 30% (${formatRupiah(totGuruSpecial)}) + Kepsek (${formatRupiah(totKepsekSpecial)})">
                    Guru: ${formatRupiah(totGuruSpecial)}<br>Kepsek: ${formatRupiah(totKepsekSpecial)}
                </div>
            `;
        }

        tfoot.innerHTML = `
            <tr>
                <td colspan="3" class="px-3 py-2.5 text-right font-bold text-xs">Total Terfilter (${filtered.length} GTK):</td>
                <td class="px-2.5 py-2.5 text-right font-mono text-xs">${formatRupiah(totFee10)}</td>
                <td class="px-2.5 py-2.5 text-right font-mono text-xs">${formatRupiah(totFee11)}</td>
                <td class="px-2.5 py-2.5 text-right font-mono text-xs">${formatRupiah(totFee12)}</td>
                <td class="px-3 py-2.5 text-right">${footerSpecialContent}</td>
                <td class="px-3 py-2.5 text-right font-mono text-xs font-semibold">${formatRupiah(totEqual)}</td>
                <td class="px-3 py-2.5 text-right font-mono text-xs font-semibold">${formatRupiah(totFinal)}</td>
                <td class="px-3.5 py-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 text-xs sm:text-sm bg-emerald-100/50 dark:bg-emerald-900/30">${formatRupiah(totPembulatan)}</td>
                <td class="no-print"></td>
            </tr>
        `;
    }
}

export function openFeeDetailModal(recipientKey) {
    const modal = document.getElementById('modal-fee-detail');
    const modalBody = document.getElementById('fee-detail-modal-body');
    if (!modal || !modalBody) return;

    const res = getCurrentFeeDistributionResult();
    if (!res || !Array.isArray(res.persons)) {
        showToast('Peringatan', 'Data rekapitulasi belum tersedia.', 'warning');
        return;
    }

    const person = res.persons.find(p => p.key === recipientKey || p.id === recipientKey);
    if (!person) {
        showToast('Peringatan', 'Data GTK tidak ditemukan.', 'warning');
        return;
    }

    let roleBadge = '';
    if (person.role === 'kepsek') {
        roleBadge = `<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">Kepala Sekolah</span>`;
    } else if (person.role === 'guru') {
        roleBadge = `<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">Guru Mapel</span>`;
    } else {
        roleBadge = `<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Tenaga Kependidikan</span>`;
    }

    let specialFormulaText = '';
    if (person.role === 'kepsek') {
        specialFormulaText = `
            <div class="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-slate-800">
                <span class="text-slate-500">Persentase Pimpinan:</span>
                <span class="font-mono font-bold text-slate-800 dark:text-slate-200">${person.specialPct}% dari Fee Sekolah (${formatRupiah(res.totalFeePool)})</span>
            </div>
        `;
    } else if (person.role === 'guru') {
        specialFormulaText = `
            <div class="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-slate-800">
                <span class="text-slate-500">Pool Fee Guru:</span>
                <span class="font-mono font-bold text-slate-800 dark:text-slate-200">${person.specialPct}% dari Fee Sekolah (${formatRupiah(res.allocations.teachers.poolAmount || 0)})</span>
            </div>
            <div class="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-slate-800">
                <span class="text-slate-500">Porsi Omzet Diampu:</span>
                <span class="font-mono font-bold text-slate-800 dark:text-slate-200">${formatRupiah(person.omzet)} dari Total Omzet (${formatRupiah(res.totalRevenue)})</span>
            </div>
        `;
    } else {
        specialFormulaText = `
            <div class="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-slate-800">
                <span class="text-slate-500">Insentif Khusus:</span>
                <span class="text-slate-400 italic">Tidak ada (Hanya menerima pemerataan)</span>
            </div>
        `;
    }

    // Detail Buku yang Diampu jika Guru
    let teachingBooksHtml = '';
    if (person.role === 'guru' && Array.isArray(person.teachingDetails) && person.teachingDetails.length > 0) {
        const rows = person.teachingDetails.map((b, i) => {
            const feeRow = (res.totalRevenue > 0) ? Math.round((res.allocations.teachers.poolAmount || 0) * ((b.propNominal || 0) / res.totalRevenue)) : 0;
            return `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td class="px-2 py-1.5 text-center text-[11px] text-slate-400">${i + 1}</td>
                    <td class="px-2.5 py-1.5 text-[11px]">
                        <div class="font-semibold text-slate-800 dark:text-slate-200">${escapeHTML(b.subject)}</div>
                        <div class="text-[10px] text-slate-400">Kelas ${getGradeRoman(b.grade)} · Rombel: ${escapeHTML(b.classesStr || '-')}</div>
                    </td>
                    <td class="px-2 py-1.5 text-center font-mono text-[11px]">${b.propTerjual || 0} eks</td>
                    <td class="px-2.5 py-1.5 text-right font-mono text-[11px]">${formatRupiah(b.propNominal || 0)}</td>
                    <td class="px-2.5 py-1.5 text-right font-mono font-bold text-sky-600 dark:text-sky-400 text-[11px]">${formatRupiah(feeRow)}</td>
                </tr>
            `;
        }).join('');

        teachingBooksHtml = `
            <div class="space-y-1.5 pt-2">
                <div class="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                    <i class="fa-solid fa-book-open-reader text-sky-600"></i>
                    <span>Rincian Buku &amp; Kelas yang Diampu (${person.teachingDetails.length} Mapel):</span>
                </div>
                <div class="border border-slate-200 dark:border-slate-700 rounded-lg overflow-x-auto max-h-48">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-50 dark:bg-slate-800 text-slate-500 text-[10px] uppercase font-semibold border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th class="px-2 py-1.5 text-center">No</th>
                                <th class="px-2.5 py-1.5">Mapel &amp; Rombel</th>
                                <th class="px-2.5 py-1.5 text-center">Eks</th>
                                <th class="px-2.5 py-1.5 text-right">Omzet</th>
                                <th class="px-2.5 py-1.5 text-right">Fee (${person.specialPct}%)</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                            ${rows}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    modalBody.innerHTML = `
        <!-- Profil Singkat GTK -->
        <div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
            <div>
                <h4 class="font-bold text-slate-900 dark:text-white text-sm">${escapeHTML(person.nama)}</h4>
                <p class="text-xs text-slate-500 font-mono mt-0.5">NIP: ${escapeHTML(person.nip || '-')}</p>
                <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5">${escapeHTML(person.tugas)}</p>
            </div>
            <div class="shrink-0 text-right">
                ${roleBadge}
                <div class="text-[10px] text-slate-400 mt-1">${escapeHTML(getCurrentSelectedSemesterPeriod())}</div>
            </div>
        </div>

        <!-- Komponen Perhitungan Sesuai Kolom Excel -->
        <div class="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-2">
            <h5 class="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                <i class="fa-solid fa-calculator text-emerald-600"></i>
                <span>Rincian Komponen Hak Fee:</span>
            </h5>

            <!-- Rincian Fee Jenjang Kelas 10, 11, 12 (untuk Guru) -->
            ${person.role === 'guru' ? `
            <div class="space-y-1 py-1 border-b border-slate-100 dark:border-slate-800 text-xs">
                <div class="flex items-center justify-between">
                    <span class="text-slate-600 dark:text-slate-300">Fee Kelas 10:</span>
                    <span class="font-mono text-slate-800 dark:text-slate-200">${person.fee10 > 0 ? formatRupiah(person.fee10) : '-'} ${person.omzet10 > 0 ? `<span class="text-[10px] text-slate-400 font-normal">(Omzet: ${formatRupiah(person.omzet10)})</span>` : ''}</span>
                </div>
                <div class="flex items-center justify-between">
                    <span class="text-slate-600 dark:text-slate-300">Fee Kelas 11:</span>
                    <span class="font-mono text-slate-800 dark:text-slate-200">${person.fee11 > 0 ? formatRupiah(person.fee11) : '-'} ${person.omzet11 > 0 ? `<span class="text-[10px] text-slate-400 font-normal">(Omzet: ${formatRupiah(person.omzet11)})</span>` : ''}</span>
                </div>
                <div class="flex items-center justify-between">
                    <span class="text-slate-600 dark:text-slate-300">Fee Kelas 12:</span>
                    <span class="font-mono text-slate-800 dark:text-slate-200">${person.fee12 > 0 ? formatRupiah(person.fee12) : '-'} ${person.omzet12 > 0 ? `<span class="text-[10px] text-slate-400 font-normal">(Omzet: ${formatRupiah(person.omzet12)})</span>` : ''}</span>
                </div>
            </div>
            ` : ''}

            <!-- Total Guru / Khusus -->
            <div class="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-slate-800">
                <div>
                    <span class="text-slate-600 dark:text-slate-300 font-semibold">${person.role === 'guru' ? 'Total Fee Guru (10 + 11 + 12)' : (person.role === 'kepsek' ? 'Insentif Khusus Kepsek' : 'Insentif Khusus Pegawai')}</span>
                </div>
                <span class="font-mono font-bold text-slate-900 dark:text-white text-xs">${person.specialAmount > 0 ? formatRupiah(person.specialAmount) : '-'}</span>
            </div>

            <!-- Pemerataan -->
            <div class="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-slate-800">
                <div>
                    <span class="text-slate-600 dark:text-slate-300 font-semibold">Pemerataan GTK</span>
                    <div class="text-[10px] text-slate-400">Pool ${res.settings.equalityPercentage}% (${formatRupiah(res.allocations.equality.poolAmount)}) ÷ ${res.allocations.equality.count} GTK</div>
                </div>
                <span class="font-mono font-bold text-slate-900 dark:text-white text-xs">${formatRupiah(person.equalAmount)}</span>
            </div>

            <!-- Total Nominal -->
            <div class="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-slate-800">
                <span class="font-semibold text-slate-700 dark:text-slate-300">Total Nominal:</span>
                <span class="font-mono font-bold text-slate-900 dark:text-white text-xs">${formatRupiah(person.totalAmount)}</span>
            </div>

            <!-- Pembulatan (Ribuan) -->
            <div class="flex items-center justify-between p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs mt-1">
                <div>
                    <span class="font-bold text-emerald-800 dark:text-emerald-200 text-xs">Total Pembulatan:</span>
                    <div class="text-[10px] text-emerald-600 dark:text-emerald-400">Dibulatkan ke ribuan</div>
                </div>
                <span class="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm sm:text-base">${formatRupiah(person.pembulatan)}</span>
            </div>
        </div>

        ${teachingBooksHtml}
    `;

    modal.classList.remove('hidden');
}

export function closeFeeDetailModal() {
    const modal = document.getElementById('modal-fee-detail');
    if (modal) {
        modal.classList.add('hidden');
    }
}

export function copyFeeTableToClipboard() {
    const res = getCurrentFeeDistributionResult();
    if (!res || !Array.isArray(res.persons) || res.persons.length === 0) {
        showToast('Perhatian', 'Tidak ada data pembagian fee untuk disalin.', 'warning');
        return;
    }

    const roleFilter = getFeeRoleFilter();
    const searchKw = (currentSearchKeyword || '').toLowerCase();
    const filtered = res.persons.filter(p => {
        if (roleFilter !== 'all' && p.role !== roleFilter) return false;
        if (searchKw) {
            const matchName = p.nama.toLowerCase().includes(searchKw);
            const matchNip = String(p.nip || '').includes(searchKw);
            const matchTugas = String(p.tugas || '').toLowerCase().includes(searchKw);
            if (!matchName && !matchNip && !matchTugas) return false;
        }
        return true;
    });

    let tsv = ['No', 'Nama GTK', 'Tipe', '10', '11', '12', 'Fee Khusus / Guru', 'Pemerataan', 'Total', 'Pembulatan'].join('\t') + '\n';
    filtered.forEach((p, idx) => {
        tsv += [
            idx + 1,
            p.nama,
            p.role === 'kepsek' ? 'KEPSEK' : (p.role === 'guru' ? 'GURU' : 'PEGAWAI'),
            p.fee10 > 0 ? p.fee10 : '-',
            p.fee11 > 0 ? p.fee11 : '-',
            p.fee12 > 0 ? p.fee12 : '-',
            p.specialAmount > 0 ? p.specialAmount : '-',
            p.equalAmount,
            p.totalAmount,
            p.pembulatan
        ].join('\t') + '\n';
    });

    navigator.clipboard.writeText(tsv).then(() => {
        showToast('Berhasil', 'Tabel pembagian fee berhasil disalin ke papan klip (TSV)! Siap di-paste ke Excel.', 'success');
    }).catch(err => {
        console.error('Clipboard copy error:', err);
        showToast('Galat', 'Gagal menyalin ke papan klip.', 'error');
    });
}

export function exportFeeDistributionToExcel() {
    if (!window.XLSX) {
        showToast('Perhatian', 'Pustaka Excel sedang dimuat, silakan coba beberapa detik lagi.', 'warning');
        return;
    }
    const res = getCurrentFeeDistributionResult();
    if (!res || !Array.isArray(res.persons) || res.persons.length === 0) {
        showToast('Perhatian', 'Belum ada data pembagian fee untuk diekspor.', 'warning');
        return;
    }

    const wb = window.XLSX.utils.book_new();

    // Sheet 1: Ringkasan Alokasi Komponen Institusional & GTK
    const summaryHeader = ['Komponen Alokasi', 'Persentase (%)', 'Nominal Alokasi (Rp)', 'Keterangan'];
    const summaryRows = [
        ['Total Omzet Penjualan Bersih', '100%', res.totalRevenue, `Semester ${getCurrentSelectedSemesterPeriod()}`],
        ['Total Dana Fee Masuk Sekolah', `${res.feeRatePercentage}%`, res.totalFeePool, `Basis Pool Alokasi Pembagian Fee`]
    ];
    if (res.settings.schoolPercentage > 0) {
        summaryRows.push(['Kas / Cadangan Sekolah', `${res.settings.schoolPercentage}%`, res.allocations.school?.amount || 0, 'Kas Operasional Sekolah']);
    }
    summaryRows.push(
        ['1. Koperasi Sekolah', `${res.settings.cooperativePercentage}%`, res.allocations.cooperative.amount, 'Kas Koperasi Sekolah'],
        ['2. Pool Pemerataan Warga Sekolah', `${res.settings.equalityPercentage}%`, res.allocations.equality.poolAmount, `Dibagi rata kepada ${res.allocations.equality.count} GTK (@Rp ${res.allocations.equality.perPerson.toLocaleString('id-ID')})`],
        ['3. Insentif Khusus Kepsek', `${res.settings.headmasterPercentage}%`, res.allocations.headmaster.totalAmount, 'Insentif Pimpinan'],
        ['4. Insentif Proporsional Guru Mapel', `${res.settings.teacherPercentage}%`, res.allocations.teachers.totalAmount, 'Insentif Proporsional Buku'],
        ['Total Hak GTK (Pemerataan + Insentif)', '-', res.summary.totalGtk, 'Kepsek + Guru + Tendik']
    );
    const wsSummary = window.XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryRows]);
    window.XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Alokasi');

    // Sheet 2: Hak Perorangan GTK (Format Kolom Excel SSOT)
    const personHeader = ['No', 'Nama GTK', 'Tipe', '10', '11', '12', 'Fee Khusus / Guru', 'Pemerataan', 'Total', 'Pembulatan'];
    const personRows = res.persons.map((p, idx) => [
        idx + 1,
        p.nama,
        p.role === 'kepsek' ? 'KEPSEK' : (p.role === 'guru' ? 'GURU' : 'PEGAWAI'),
        p.fee10 > 0 ? p.fee10 : '-',
        p.fee11 > 0 ? p.fee11 : '-',
        p.fee12 > 0 ? p.fee12 : '-',
        p.specialAmount > 0 ? p.specialAmount : '-',
        p.equalAmount,
        p.totalAmount,
        p.pembulatan
    ]);
    const wsPersons = window.XLSX.utils.aoa_to_sheet([personHeader, ...personRows]);
    window.XLSX.utils.book_append_sheet(wb, wsPersons, 'Hak Perorangan GTK');

    // Sheet 3: Rincian Kelas Guru Mapel
    const teacherBooksRows = [];
    let tNo = 1;
    res.persons.filter(p => p.role === 'guru').forEach(g => {
        (g.teachingDetails || []).forEach(b => {
            const feeVal = Math.round((b.propNominal || 0) * (g.specialPct / 100));
            teacherBooksRows.push([
                tNo++,
                g.nama,
                getGradeRoman(b.grade),
                b.subject,
                b.classesStr || '-',
                b.classCount || 0,
                b.propTerjual || 0,
                b.propNominal || 0,
                `${g.specialPct}%`,
                feeVal
            ]);
        });
    });

    if (teacherBooksRows.length > 0) {
        const teacherBooksHeader = ['No', 'Nama Guru', 'Jenjang', 'Mata Pelajaran', 'Rombel Kelas', 'Jumlah Kelas', 'Eksemplar', 'Omzet Kelas (Rp)', 'Tarif Fee', 'Fee Guru (Rp)'];
        const wsTeacherBooks = window.XLSX.utils.aoa_to_sheet([teacherBooksHeader, ...teacherBooksRows]);
        window.XLSX.utils.book_append_sheet(wb, wsTeacherBooks, 'Rincian Kelas Guru');
    }

    const periodClean = (getCurrentSelectedSemesterPeriod() || 'semester').replace(/[^a-zA-Z0-9]/g, '_');
    window.XLSX.writeFile(wb, `Rekap_Pembagian_Fee_LKS_${periodClean}.xlsx`);
    showToast('Berhasil', 'Berkas Excel pembagian fee LKS berhasil diunduh.', 'success');
}

export function printFeeDistributionSummary() {
    window.print();
}

export function populateVendorSelect(selectedVal = null) {
    const select = document.getElementById('circ-vendor-select');
    if (!select) return;

    const vendors = getCurrentVendors();
    let html = '';

    if (vendors.length === 0) {
        html += '<option value="">-- Belum ada vendor terdaftar di Pengaturan --</option>';
    } else {
        vendors.forEach(v => {
            const isSel = (selectedVal && selectedVal === v) || (!selectedVal && v === vendors[0]) ? 'selected' : '';
            html += `<option value="${escapeHTML(v)}" ${isSel}>${escapeHTML(v)}</option>`;
        });
    }
    html += '<option value="__custom__">+ Ketik Nama Vendor Lain...</option>';

    select.innerHTML = html;
    onCirculationVendorSelectChanged();
}

export function onCirculationVendorSelectChanged() {
    const selectVendor = document.getElementById('circ-vendor-select');
    const customVendor = document.getElementById('circ-custom-vendor');
    const inputParty = document.getElementById('circ-party');
    if (!selectVendor) return;

    if (selectVendor.value === '__custom__') {
        if (customVendor) {
            customVendor.classList.remove('hidden');
            if (typeof customVendor.focus === 'function') {
                customVendor.focus();
            }
        }
    } else {
        if (customVendor) {
            customVendor.classList.add('hidden');
            customVendor.value = '';
        }
        if (inputParty) inputParty.value = selectVendor.value;
    }
}

// ==========================================
// SIRKULASI BUKU (PENERIMAAN, PENGAMBILAN GURU & RETUR PERCETAKAN)
// ==========================================

/**
 * Mendapatkan nama guru yang sedang login (jika ada) untuk pencocokan otomatis
 */
function getCurrentLoggedInTeacherName() {
    if (typeof window === 'undefined') return '';
    const storedName = localStorage.getItem('user_display_name') || localStorage.getItem('user_name') || '';
    if (storedName) return storedName.trim();
    if (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.displayName) {
        return auth.currentUser.displayName.trim();
    }
    return '';
}

/**
 * Mencocokkan nama user login dengan daftar guru pengampu mapel
 */
function matchLoggedInWithAssigned(assignedTeachers, loggedInName) {
    if (!loggedInName || !Array.isArray(assignedTeachers) || assignedTeachers.length === 0) return null;
    const normLoggedIn = normalizeKey(loggedInName);
    return assignedTeachers.find(t => {
        const normT = normalizeKey(t);
        return normT === normLoggedIn || normT.includes(normLoggedIn) || normLoggedIn.includes(normT);
    }) || null;
}

/**
 * Mengambil seluruh daftar nama guru di sekolah dari Jadwal XML dan Master GTK Cache
 */
export function getAllSchoolTeachers(parsedSchedule = currentParsedSchedule) {
    const teacherSet = new Set();
    const result = [];

    const isValidTeacher = (name) => {
        if (!name || typeof name !== 'string') return false;
        const upper = name.toUpperCase().trim();
        if (!upper || upper === '-' || upper === 'NULL' || upper.includes('UPACARA') || upper.includes('LIBUR') || upper.includes('PRAMUKA')) {
            return false;
        }
        return true;
    };

    // 1. Dari Jadwal XML
    if (parsedSchedule && parsedSchedule.teachersMap) {
        parsedSchedule.teachersMap.forEach(t => {
            const name = (t.simasName || t.name || '').trim();
            if (isValidTeacher(name) && !teacherSet.has(name)) {
                teacherSet.add(name);
                result.push(name);
            }
        });
    }

    // 2. Dari Master GTK cache jika tersedia di window
    if (typeof window !== 'undefined') {
        let gtkTeachers = [];
        if (typeof window.getTeachersCacheSync === 'function') {
            gtkTeachers = window.getTeachersCacheSync() || [];
        }
        if (Array.isArray(gtkTeachers)) {
            gtkTeachers.forEach(t => {
                const name = (t.name || t.nama || '').trim();
                if (isValidTeacher(name) && !teacherSet.has(name)) {
                    teacherSet.add(name);
                    result.push(name);
                }
            });
        }
    }

    return result.sort((a, b) => a.localeCompare(b, 'id-ID'));
}

/**
 * Mengisi dropdown pencarian guru pengambil buku (Searchable Combobox)
 */
export function populateCircTeacherDropdown(filterKeyword = '') {
    const listEl = document.getElementById('circ-teacher-dropdown-list');
    if (!listEl) return;

    const selectGrade = document.getElementById('circ-grade');
    const selectSubject = document.getElementById('circ-subject');
    const inputParty = document.getElementById('circ-party');

    const grade = selectGrade ? selectGrade.value : '10';
    const subject = selectSubject ? selectSubject.value : '';
    const currentVal = inputParty ? inputParty.value.trim() : '';

    const assignedTeachers = getAssignedTeachersForSubject(grade, subject);
    const assignedSet = new Set(assignedTeachers.map(t => t.trim()));
    const allTeachers = getAllSchoolTeachers();

    // Gabungkan: Guru Pengampu di paling atas, lalu guru lainnya
    const otherTeachers = allTeachers.filter(t => !assignedSet.has(t.trim()));
    const combined = [
        ...assignedTeachers.map(t => ({ name: t, isAssigned: true })),
        ...otherTeachers.map(t => ({ name: t, isAssigned: false }))
    ];

    const normFilter = normalizeKey(filterKeyword);
    const filtered = normFilter
        ? combined.filter(item => normalizeKey(item.name).includes(normFilter))
        : combined;

    if (filtered.length === 0) {
        listEl.innerHTML = `
            <div class="px-3.5 py-2.5 text-xs text-slate-400 dark:text-slate-500 italic text-center">
                Tidak ada guru yang cocok. Anda dapat tetap mengetik nama manual ini.
            </div>
        `;
        return;
    }

    let html = '';
    filtered.forEach(item => {
        const isSelected = item.name === currentVal;
        const iconClass = item.isAssigned
            ? 'fa-solid fa-chalkboard-user text-teal-600 dark:text-teal-400'
            : 'fa-solid fa-user text-slate-400 dark:text-slate-500';

        const badgeHtml = item.isAssigned
            ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200 border border-teal-200 dark:border-teal-700 shrink-0">Pengampu</span>`
            : '';

        const selectedClass = isSelected
            ? 'bg-teal-50 dark:bg-slate-700/80 font-bold text-teal-900 dark:text-teal-200'
            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50';

        html += `
            <button type="button" onclick="window.selectCircTeacher('${escapeHTML(item.name).replace(/'/g, "\\'")}')"
                class="w-full text-left px-3.5 py-2 text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${selectedClass}">
                <div class="flex items-center gap-2 min-w-0">
                    <i class="${iconClass} text-xs shrink-0"></i>
                    <span class="truncate">${escapeHTML(item.name)}</span>
                </div>
                ${badgeHtml}
            </button>
        `;
    });

    listEl.innerHTML = html;
}

export function openCircTeacherDropdown() {
    const listEl = document.getElementById('circ-teacher-dropdown-list');
    const chevronIcon = document.getElementById('icon-circ-teacher-chevron');
    if (listEl) {
        listEl.classList.remove('hidden');
        populateCircTeacherDropdown(document.getElementById('circ-party')?.value || '');
    }
    if (chevronIcon) {
        chevronIcon.classList.add('rotate-180');
    }
}

export function closeCircTeacherDropdown() {
    const listEl = document.getElementById('circ-teacher-dropdown-list');
    const chevronIcon = document.getElementById('icon-circ-teacher-chevron');
    if (listEl) {
        listEl.classList.add('hidden');
    }
    if (chevronIcon) {
        chevronIcon.classList.remove('rotate-180');
    }
}

export function toggleCircTeacherDropdown(event) {
    if (event) {
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
        if (typeof event.preventDefault === 'function') event.preventDefault();
    }
    const listEl = document.getElementById('circ-teacher-dropdown-list');
    if (listEl && !listEl.classList.contains('hidden')) {
        closeCircTeacherDropdown();
    } else {
        openCircTeacherDropdown();
    }
}

export function selectCircTeacher(teacherName) {
    const inputParty = document.getElementById('circ-party');
    if (inputParty) {
        inputParty.value = teacherName;
    }
    closeCircTeacherDropdown();
}

export function openCirculationModal() {
    const modal = document.getElementById('modal-circulation');
    if (!modal) return;

    populateModalPeriodSelect('circ-period');

    const inputDate = document.getElementById('circ-date');
    if (inputDate && !inputDate.value) {
        inputDate.value = new Date().toISOString().slice(0, 10);
    }

    const selectGrade = document.getElementById('circ-grade');
    if (selectGrade && !selectGrade.value) {
        selectGrade.value = '10';
    }

    const selectType = document.getElementById('circ-type');
    if (selectType) {
        selectType.value = 'terima';
    }

    closeCircTeacherDropdown();
    onCirculationGradeChanged();
    onCirculationTypeChanged();
    populateVendorSelect();
    modal.classList.remove('hidden');
}

export function closeCirculationModal() {
    const modal = document.getElementById('modal-circulation');
    if (modal) modal.classList.add('hidden');
    closeCircTeacherDropdown();
}

export function onCirculationGradeChanged() {
    const selectGrade = document.getElementById('circ-grade');
    const selectSubject = document.getElementById('circ-subject');
    if (!selectGrade || !selectSubject) return;

    const grade = selectGrade.value || '10';
    const subjects = getSubjectsForGrade(grade);

    selectSubject.innerHTML = subjects.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('');
    onCirculationSubjectChanged();
}

export function onCirculationSubjectChanged() {
    const selectGrade = document.getElementById('circ-grade');
    const selectSubject = document.getElementById('circ-subject');
    const selectType = document.getElementById('circ-type');
    const infoTeacher = document.getElementById('circ-info-teacher');
    const infoStock = document.getElementById('circ-info-stock');
    const inputParty = document.getElementById('circ-party');

    if (!selectGrade || !selectSubject) return;

    const grade = selectGrade.value || '10';
    const subject = selectSubject.value || '';

    const teacherName = findTeacherForClassSubject(grade, '', subject);
    if (infoTeacher) infoTeacher.textContent = teacherName;

    const stock = calcRemainingStock(grade, subject);
    if (infoStock) infoStock.textContent = `${stock.toLocaleString('id-ID')} eks tersisa`;

    // Isi otomatis pihak terkait jika mutasi guru
    if (selectType && selectType.value === 'pengambilan_guru') {
        const assignedTeachers = getAssignedTeachersForSubject(grade, subject);
        if (assignedTeachers.length > 0) {
            const loggedInName = getCurrentLoggedInTeacherName();
            const matched = matchLoggedInWithAssigned(assignedTeachers, loggedInName);
            const chosenTeacher = matched || assignedTeachers[0];
            if (inputParty) inputParty.value = chosenTeacher;
        } else if (inputParty && (!inputParty.value || inputParty.value.startsWith('Guru') || inputParty.value === '-' || inputParty.value.includes('Mitra'))) {
            if (teacherName && teacherName !== 'Guru Belum Terpetakan') {
                inputParty.value = teacherName.split(',')[0].trim();
            } else {
                inputParty.value = '';
            }
        }
        populateCircTeacherDropdown(inputParty ? inputParty.value : '');
    }
}

export function onCirculationTypeChanged() {
    const selectType = document.getElementById('circ-type');
    const labelParty = document.getElementById('label-circ-party');
    const containerVendor = document.getElementById('container-circ-vendor');
    const containerTeacher = document.getElementById('container-circ-teacher');
    const infoSaleStatus = document.getElementById('circ-info-sale-status');

    if (!selectType) return;
    const type = selectType.value;

    if (type === 'pengambilan_guru') {
        if (labelParty) labelParty.innerHTML = '<i class="fa-solid fa-chalkboard-user text-amber-600"></i><span>Nama Guru Pengambil</span>';
        if (containerVendor) containerVendor.classList.add('hidden');
        if (containerTeacher) containerTeacher.classList.remove('hidden');
        if (infoSaleStatus) {
            infoSaleStatus.className = 'px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
            infoSaleStatus.textContent = 'Non-Penjualan (Omzet Rp 0)';
        }
        onCirculationSubjectChanged();
    } else if (type === 'terima') {
        closeCircTeacherDropdown();
        if (labelParty) labelParty.innerHTML = '<i class="fa-solid fa-truck text-teal-600"></i><span>Nama Percetakan / Vendor</span>';
        if (containerVendor) containerVendor.classList.remove('hidden');
        if (containerTeacher) containerTeacher.classList.add('hidden');
        if (infoSaleStatus) {
            infoSaleStatus.className = 'px-2 py-0.5 rounded text-[11px] font-bold bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300';
            infoSaleStatus.textContent = 'Stok Masuk (Non-Penjualan)';
        }
        populateVendorSelect();
    } else { // retur_penerbit
        closeCircTeacherDropdown();
        if (labelParty) labelParty.innerHTML = '<i class="fa-solid fa-reply text-rose-600"></i><span>Nama Percetakan / Vendor Tujuan Retur</span>';
        if (containerVendor) containerVendor.classList.remove('hidden');
        if (containerTeacher) containerTeacher.classList.add('hidden');
        if (infoSaleStatus) {
            infoSaleStatus.className = 'px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300';
            infoSaleStatus.textContent = 'Retur Keluar (Non-Penjualan)';
        }
        populateVendorSelect();
    }
}

export async function submitAddCirculation(event) {
    if (event) event.preventDefault();

    const inputDate = document.getElementById('circ-date');
    const selectPeriod = document.getElementById('circ-period');
    const selectType = document.getElementById('circ-type');
    const selectGrade = document.getElementById('circ-grade');
    const selectSubject = document.getElementById('circ-subject');
    const inputParty = document.getElementById('circ-party');
    const inputQty = document.getElementById('circ-qty');
    const inputNote = document.getElementById('circ-note');

    const date = inputDate ? inputDate.value : new Date().toISOString().slice(0, 10);
    const periode = selectPeriod ? selectPeriod.value : getDefaultTransactionPeriod();
    const type = selectType ? selectType.value : 'terima';
    const grade = parseInt(selectGrade ? selectGrade.value : 10, 10);
    const subject = selectSubject ? selectSubject.value : '';

    let party = '';
    if (type === 'pengambilan_guru') {
        party = inputParty ? inputParty.value.trim() : '';
    } else {
        const selectVendor = document.getElementById('circ-vendor-select');
        const customVendor = document.getElementById('circ-custom-vendor');
        if (selectVendor && selectVendor.value === '__custom__') {
            party = customVendor ? customVendor.value.trim() : '';
        } else if (selectVendor && selectVendor.value) {
            party = selectVendor.value.trim();
        } else {
            party = inputParty ? inputParty.value.trim() : '';
        }

        // Simpan vendor baru jika diketik manual ke daftar master vendor
        if (party && !currentVendors.some(v => v.toLowerCase().trim() === party.toLowerCase().trim())) {
            currentVendors.push(party);
            currentVendors.sort((a, b) => a.localeCompare(b, 'id-ID'));
            if (typeof localStorage !== 'undefined') {
                try {
                    localStorage.setItem(BOOK_VENDORS_STORAGE_KEY, JSON.stringify(currentVendors));
                } catch (e) {}
            }
            if (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled) {
                cfClient.saveSystemSetting(BOOK_VENDORS_D1_KEY, currentVendors).catch(() => {});
            }
        }
    }

    const qty = parseNumberSafe(inputQty ? inputQty.value : 1, 1);
    const note = inputNote ? inputNote.value.trim() : '';

    if (!subject || !party || qty <= 0) {
        showToast('Peringatan', 'Mohon lengkapi mata pelajaran, nama guru/vendor terkait, dan jumlah eksemplar.', 'warning');
        return;
    }

    let book = findBookEntry(grade, subject);
    if (!book) {
        book = {
            id: 'book_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            grade: grade,
            subject: subject,
            terima: 0,
            diam: 0,
            retur: 0,
            sisa: 0,
            terjual: 0,
            harga: 17000,
            total: 0,
            isActive: true,
            teachers: [],
            teacherNamesStr: '-'
        };
        if (currentParsedSchedule) {
            const schedMap = buildScheduleGradeMap(currentParsedSchedule);
            book.teachers = findTeachersForBookSales(grade, subject, schedMap, 0, 0);
            book.teacherNamesStr = book.teachers.length > 0
                ? book.teachers.map(t => `${t.teacher} (${t.classCount}/${t.totalClasses} kls - ${t.percentageStr}: ${t.propTerjual} eks / ${formatRupiah(t.propNominal)})`).join('; ')
                : 'Belum terpetakan di Jadwal XML';
        }
        currentMatchedData.push(book);
        currentMatchedData.sort((a, b) => a.grade - b.grade || a.subject.localeCompare(b.subject));
    }

    // Mutasi efek pada buku
    if (type === 'pengambilan_guru') {
        // PENGAMBILAN OLEH GURU:
        // Diambil guru (diam) bertambah
        // Sisa stok berkurang
        // TIDAK TERHITUNG SEBAGAI PENJUALAN (terjual & total tidak bertambah)
        book.diam = (book.diam || 0) + qty;
    } else if (type === 'terima') {
        book.terima = (book.terima || 0) + qty;
    } else if (type === 'retur_penerbit') {
        book.retur = (book.retur || 0) + qty;
    }

    book.sisa = Math.max(0, (book.terima || 0) - (book.diam || 0) - (book.retur || 0) - (book.terjual || 0));

    const circId = 'circ_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const newCirc = {
        id: circId,
        date,
        periode,
        type,
        grade,
        subject,
        party,
        qty,
        isSale: false,
        note,
        createdAt: new Date().toISOString()
    };

    currentCirculations.unshift(newCirc);
    await saveBookSalesData();

    updateKpiCards(currentMatchedData);

    if (currentActiveTab === 'circulation') {
        renderCirculationTable(currentCirculations);
    } else if (currentActiveTab === 'stock') {
        renderStockTable(currentMatchedData);
    } else if (currentActiveTab === 'recap') {
        switchRecapSubView(currentRecapSubView);
    } else if (currentActiveTab === 'books') {
        renderBooksTable(currentMatchedData);
    }

    closeCirculationModal();
    const typeLabel = type === 'pengambilan_guru' ? 'Pengambilan Guru (Non-Penjualan)' : type === 'terima' ? 'Penerimaan Buku Baru' : 'Retur Percetakan';
    showToast('Berhasil', `Mutasi sirkulasi "${typeLabel}" sebanyak ${qty} eks ${subject} berhasil dicatat!`, 'success');
}

export async function deleteCirculation(circId) {
    const idx = currentCirculations.findIndex(c => c.id === circId);
    if (idx === -1) return;

    const circ = currentCirculations[idx];
    if (!confirm(`Hapus mutasi sirkulasi ${circ.qty} eks buku "${circ.subject}" (${circ.party})?`)) {
        return;
    }

    const book = findBookEntry(circ.grade, circ.subject);
    if (book) {
        if (circ.type === 'pengambilan_guru') {
            book.diam = Math.max(0, (book.diam || 0) - circ.qty);
        } else if (circ.type === 'terima') {
            book.terima = Math.max(0, (book.terima || 0) - circ.qty);
        } else if (circ.type === 'retur_penerbit') {
            book.retur = Math.max(0, (book.retur || 0) - circ.qty);
        }
        book.sisa = Math.max(0, (book.terima || 0) - (book.diam || 0) - (book.retur || 0) - (book.terjual || 0));
    }

    currentCirculations.splice(idx, 1);
    await saveBookSalesData();

    updateKpiCards(currentMatchedData);
    if (currentActiveTab === 'circulation') {
        renderCirculationTable(currentCirculations);
    } else if (currentActiveTab === 'stock') {
        renderStockTable(currentMatchedData);
    } else if (currentActiveTab === 'recap') {
        switchRecapSubView(currentRecapSubView);
    } else if (currentActiveTab === 'books') {
        renderBooksTable(currentMatchedData);
    }
    showToast('Dihapus', 'Mutasi sirkulasi berhasil dihapus dan stok telah disesuaikan.', 'info');
}

// ==========================================
// PENGATURAN HARGA JUAL BUKU
// ==========================================

export async function updateBookPrice(grade, subject, newPrice) {
    const g = parseInt(grade, 10);
    const priceNum = parseNumberSafe(newPrice);
    if (priceNum < 0) {
        showToast('Peringatan', 'Harga jual tidak boleh kurang dari 0.', 'warning');
        return false;
    }

    const priceKey = `${g}_${subject}`;
    if (pendingPriceSaves.has(priceKey)) {
        return false;
    }

    const book = findBookEntry(g, subject);
    if (!book) {
        showToast('Gagal', `Buku ${subject} kelas ${g} tidak ditemukan.`, 'error');
        return false;
    }

    pendingPriceSaves.add(priceKey);
    const oldPrice = book.harga;
    const oldTotal = book.total;

    book.harga = priceNum;
    book.total = (book.terjual || 0) * book.harga;

    // Sinkronisasi proporsional guru dari Jadwal XML jika ada
    if (currentParsedSchedule) {
        const schedMap = buildScheduleGradeMap(currentParsedSchedule);
        book.teachers = findTeachersForBookSales(book.grade, book.subject, schedMap, book.terjual, book.total);
        book.teacherNamesStr = book.teachers.length > 0
            ? book.teachers.map(t => `${t.teacher} (${t.classCount}/${t.totalClasses} kls - ${t.percentageStr}: ${t.propTerjual} eks / ${formatRupiah(t.propNominal)})`).join('; ')
            : 'Belum terpetakan di Jadwal XML';
    }

    // Optimistic UI Update untuk Tab Pengaturan
    if (currentActiveTab === 'settings') {
        renderPriceSettingsTable();
    }
    updateKpiCards(currentMatchedData);

    try {
        await saveBookSalesData();
        showToast('Berhasil', `Harga ${subject} Kelas ${g} diubah menjadi ${formatRupiah(priceNum)}`, 'success');
        return true;
    } catch (e) {
        console.error('[PenjualanBuku] Gagal menyimpan harga buku:', e);
        book.harga = oldPrice;
        book.total = oldTotal;
        showToast('Gagal Menyimpan', `Gagal menyimpan harga buku "${subject}". Perubahan dibatalkan.`, 'error');
        return false;
    } finally {
        pendingPriceSaves.delete(priceKey);
        if (currentActiveTab === 'settings') {
            renderPriceSettingsTable();
        } else if (currentActiveTab === 'recap') {
            switchRecapSubView(currentRecapSubView);
        } else if (currentActiveTab === 'books') {
            renderBooksTable(currentMatchedData);
        } else if (currentActiveTab === 'stock') {
            renderStockTable(currentMatchedData);
        } else if (currentActiveTab === 'teachers') {
            renderTeachersTable(currentMatchedData);
        }
    }
}

export function onRowPriceSave(grade, encodedSubject, inputId, triggerBtn = null) {
    const subject = decodeURIComponent(encodedSubject);
    const input = document.getElementById(inputId);
    if (!input) return;
    const newPrice = parseNumberSafe(input.value);
    updateBookPrice(grade, subject, newPrice);
}

export function openBulkPriceModal() {
    const modal = document.getElementById('modal-bulk-price');
    if (!modal) return;
    const inputVal = document.getElementById('bulk-price-value');
    if (inputVal) inputVal.value = '';
    modal.classList.remove('hidden');
    if (inputVal) setTimeout(() => inputVal.focus(), 100);
}

export function closeBulkPriceModal() {
    const modal = document.getElementById('modal-bulk-price');
    if (modal) modal.classList.add('hidden');
}

export async function applyBulkPriceUpdate() {
    const selectGrade = document.getElementById('bulk-price-grade');
    const inputVal = document.getElementById('bulk-price-value');
    if (!selectGrade || !inputVal) return;

    const targetGrade = selectGrade.value; // 'all' | '10' | '11' | '12'
    const newPrice = parseNumberSafe(inputVal.value);

    if (newPrice <= 0) {
        showToast('Peringatan', 'Silakan masukkan nominal harga yang valid (lebih dari 0).', 'warning');
        return;
    }

    const data = (currentMatchedData && currentMatchedData.length > 0) ? currentMatchedData : DEFAULT_BOOK_SALES_DATA;
    let modifiedCount = 0;

    data.forEach(book => {
        if (targetGrade === 'all' || String(book.grade) === targetGrade) {
            book.harga = newPrice;
            book.total = (book.terjual || 0) * book.harga;
            modifiedCount++;

            if (currentParsedSchedule) {
                const schedMap = buildScheduleGradeMap(currentParsedSchedule);
                book.teachers = findTeachersForBookSales(book.grade, book.subject, schedMap, book.terjual, book.total);
                book.teacherNamesStr = book.teachers.length > 0
                    ? book.teachers.map(t => `${t.teacher} (${t.classCount}/${t.totalClasses} kls - ${t.percentageStr}: ${t.propTerjual} eks / ${formatRupiah(t.propNominal)})`).join('; ')
                    : 'Belum terpetakan di Jadwal XML';
            }
        }
    });

    await saveBookSalesData();
    updateKpiCards(currentMatchedData);
    renderPriceSettingsTable();
    closeBulkPriceModal();

    showToast('Berhasil', `Berhasil menerapkan harga ${formatRupiah(newPrice)} ke ${modifiedCount} judul buku!`, 'success');
}

export async function saveAllBookPrices() {
    const inputs = document.querySelectorAll('#table-settings-price-body input[data-grade]');
    if (!inputs || inputs.length === 0) {
        showToast('Info', 'Tidak ada data harga yang ditampilkan.', 'info');
        return;
    }

    let modifiedCount = 0;
    inputs.forEach(inp => {
        const grade = parseInt(inp.getAttribute('data-grade'), 10);
        const subject = inp.getAttribute('data-subject');
        const price = parseNumberSafe(inp.value);

        const book = findBookEntry(grade, subject);
        if (book && book.harga !== price && price >= 0) {
            book.harga = price;
            book.total = (book.terjual || 0) * book.harga;
            modifiedCount++;

            if (currentParsedSchedule) {
                const schedMap = buildScheduleGradeMap(currentParsedSchedule);
                book.teachers = findTeachersForBookSales(book.grade, book.subject, schedMap, book.terjual, book.total);
                book.teacherNamesStr = book.teachers.length > 0
                    ? book.teachers.map(t => `${t.teacher} (${t.classCount}/${t.totalClasses} kls - ${t.percentageStr}: ${t.propTerjual} eks / ${formatRupiah(t.propNominal)})`).join('; ')
                    : 'Belum terpetakan di Jadwal XML';
            }
        }
    });

    await saveBookSalesData();
    updateKpiCards(currentMatchedData);
    renderPriceSettingsTable();

    if (modifiedCount > 0) {
        showToast('Berhasil', `${modifiedCount} harga buku berhasil disimpan dan diselaraskan!`, 'success');
    } else {
        showToast('Info', 'Tidak ada perubahan harga buku.', 'info');
    }
}

export async function submitAddBook(event) {
    if (event) event.preventDefault();

    const selectGrade = document.getElementById('book-grade');
    const selectPeriod = document.getElementById('book-period');
    const checkActive = document.getElementById('book-is-active');
    const inputSubject = document.getElementById('book-subject');
    const inputTerima = document.getElementById('book-terima');
    const inputHarga = document.getElementById('book-harga');

    const grade = parseInt(selectGrade ? selectGrade.value : 10, 10);
    const periode = selectPeriod ? selectPeriod.value : getDefaultTransactionPeriod();
    const isActive = checkActive ? checkActive.checked : true;
    const subject = inputSubject ? inputSubject.value.trim() : '';
    const terima = parseNumberSafe(inputTerima ? inputTerima.value : 0, 0);
    let harga = parseNumberSafe(inputHarga ? inputHarga.value : 0, 0);
    if (harga <= 0) harga = 17000;

    if (!subject) {
        showToast('Peringatan', 'Silakan masukkan nama mata pelajaran / judul buku.', 'warning');
        return;
    }

    const existing = currentMatchedData.find(b => b.grade === grade && normalizeKey(b.subject) === normalizeKey(subject));
    if (existing) {
        showToast('Perhatian', `Buku "${subject}" untuk Kelas ${grade} sudah ada di daftar.`, 'warning');
        return;
    }

    let teachers = [];
    let teacherNamesStr = 'Belum terpetakan di Jadwal XML';

    if (currentParsedSchedule) {
        const schedMap = buildScheduleGradeMap(currentParsedSchedule);
        teachers = findTeachersForBookSales(grade, subject, schedMap, 0, 0);
        if (teachers.length > 0) {
            teacherNamesStr = teachers.map(t => `${t.teacher} (${t.classCount}/${t.totalClasses} kls - ${t.percentageStr}: ${t.propTerjual} eks / ${formatRupiah(t.propNominal)})`).join('; ');
        }
    }

    const newBook = {
        grade,
        subject,
        periode,
        isActive,
        terima,
        diam: 0,
        sisa: terima,
        terjual: 0,
        harga,
        total: 0,
        teachers,
        teacherNamesStr
    };

    currentMatchedData.push(newBook);
    currentMatchedData.sort((a, b) => a.grade - b.grade || a.subject.localeCompare(b.subject));

    await saveBookSalesData();
    updateKpiCards(currentMatchedData);

    if (currentActiveTab === 'settings') {
        renderPriceSettingsTable();
    } else if (currentActiveTab === 'recap') {
        switchRecapSubView(currentRecapSubView);
    } else if (currentActiveTab === 'books') {
        renderBooksTable(currentMatchedData);
    } else if (currentActiveTab === 'stock') {
        renderStockTable(currentMatchedData);
    } else if (currentActiveTab === 'teachers') {
        renderTeachersTable(currentMatchedData);
    }

    closeAddBookModal();
    if (inputSubject) inputSubject.value = '';
    if (inputTerima) inputTerima.value = '0';

    showToast('Berhasil', `Buku "${subject}" Kelas ${grade} berhasil ditambahkan!`, 'success');
}

export async function deleteBookEntry(grade, encodedSubject) {
    const subject = decodeURIComponent(encodedSubject);
    const g = parseInt(grade, 10);

    if (!confirm(`Hapus buku "${subject}" Kelas ${g} dari daftar master buku?`)) {
        return;
    }

    const idx = currentMatchedData.findIndex(b => b.grade === g && b.subject === subject);
    if (idx === -1) {
        showToast('Gagal', `Buku "${subject}" Kelas ${g} tidak ditemukan.`, 'error');
        return;
    }

    currentMatchedData.splice(idx, 1);
    await saveBookSalesData();
    updateKpiCards(currentMatchedData);

    if (currentActiveTab === 'settings') {
        renderPriceSettingsTable();
    } else if (currentActiveTab === 'recap') {
        switchRecapSubView(currentRecapSubView);
    } else if (currentActiveTab === 'books') {
        renderBooksTable(currentMatchedData);
    } else if (currentActiveTab === 'stock') {
        renderStockTable(currentMatchedData);
    } else if (currentActiveTab === 'teachers') {
        renderTeachersTable(currentMatchedData);
    }

    showToast('Berhasil', `Buku "${subject}" Kelas ${g} berhasil dihapus.`, 'info');
}

export async function syncBooksFromSchedule() {
    try {
        if (!currentParsedSchedule) {
            currentParsedSchedule = await parseASCSchedule();
        }
    } catch (e) {
        console.error('[PenjualanBuku] Gagal parse jadwal:', e);
        showToast('Galat', 'Gagal membaca file Jadwal XML sekolah.', 'error');
        return;
    }

    if (!currentParsedSchedule || !currentParsedSchedule.lessonsMap) {
        showToast('Gagal', 'Data Jadwal XML tidak valid atau belum tersedia.', 'error');
        return;
    }

    const schedMap = buildScheduleGradeMap(currentParsedSchedule);
    let addedCount = 0;

    [10, 11, 12].forEach(grade => {
        const gradeSubs = schedMap[grade] || {};
        const excluded = new Set(['upacara', 'ekstrakurikuler', 'bimbingan dan konseling']);

        for (const subName of Object.keys(gradeSubs)) {
            if (excluded.has(subName.toLowerCase())) continue;

            const existing = findBookEntry(grade, subName);
            if (!existing) {
                const teachers = findTeachersForBookSales(grade, subName, schedMap, 0, 0);
                const teacherNamesStr = teachers.length > 0
                    ? teachers.map(t => `${t.teacher} (${t.classCount}/${t.totalClasses} kls - ${t.percentageStr}: ${t.propTerjual} eks / ${formatRupiah(t.propNominal)})`).join('; ')
                    : 'Belum terpetakan di Jadwal XML';

                currentMatchedData.push({
                    grade,
                    subject: subName,
                    terima: 0,
                    diam: 0,
                    retur: 0,
                    sisa: 0,
                    terjual: 0,
                    harga: 17000,
                    total: 0,
                    isActive: true,
                    teachers,
                    teacherNamesStr
                });
                addedCount++;
            }
        }
    });

    if (addedCount > 0) {
        currentMatchedData.sort((a, b) => a.grade - b.grade || a.subject.localeCompare(b.subject));
        await saveBookSalesData();
        updateKpiCards(currentMatchedData);
        switchTab(currentActiveTab);
        showToast('Berhasil', `Berhasil menyinkronkan ${addedCount} mata pelajaran baru dari Jadwal XML!`, 'success');
    } else {
        showToast('Info', 'Seluruh mata pelajaran dari Jadwal XML sudah terdaftar.', 'info');
    }
}

export async function processInputData() {}
export function loadDefaultData() {}
export function clearData() {}

export function copyTableToClipboard() {
    let tsv = '';
    const effectiveTab = currentActiveTab === 'recap' ? currentRecapSubView : currentActiveTab;

    if (effectiveTab === 'books') {
        if (currentMatchedData.length === 0) {
            showToast('Perhatian', 'Tidak ada data buku untuk disalin.', 'warning');
            return;
        }
        const effectiveBooks = getBooksWithPeriodSales(currentMatchedData, currentTransactions, currentSelectedSemesterPeriod);
        tsv = ['No', 'Kelas', 'Mata Pelajaran (Buku)', 'Terima', 'Diam', 'Sisa', 'Terjual', 'Harga Satuan', 'Total Penjualan', 'Guru Pengampu & Proporsi Beban (Rombel / %)'].join('\t') + '\n';
        effectiveBooks.forEach((row, i) => {
            tsv += [
                i + 1,
                `Kelas ${getGradeRoman(row.grade)}`,
                row.subject,
                row.terima,
                row.diam,
                row.sisa,
                row.terjual,
                row.harga,
                row.total,
                row.teacherNamesStr
            ].join('\t') + '\n';
        });
    } else if (effectiveTab === 'teachers') {
        const effectiveBooks = getBooksWithPeriodSales(currentMatchedData, currentTransactions, currentSelectedSemesterPeriod);
        const teachers = aggregateSalesByTeacher(effectiveBooks);
        if (teachers.length === 0) {
            showToast('Perhatian', 'Tidak ada data guru untuk disalin.', 'warning');
            return;
        }
        const schoolPct = getSchoolSharePercentage();
        tsv = ['No', 'Guru Pengajar', 'Rincian Mapel, Rombel & Beban (%)', 'Jumlah Mapel', 'Total Eksemplar Proporsional', 'Total Nilai Proporsional (Rp)', `Bagian Sekolah (${schoolPct}%) (Rp)`].join('\t') + '\n';
        teachers.forEach((t, i) => {
            const booksStr = t.books.map(b => `${getGradeRoman(b.grade)} - ${b.subject} [Rombel: ${b.classesStr} | ${b.classCount}/${b.totalClasses} kls (${b.percentageStr}) => ${b.propTerjual} eks / Rp ${b.propNominal.toLocaleString('id-ID')}]`).join('; ');
            const bagianSekolah = Math.round((t.totalNominal || 0) * (schoolPct / 100));
            tsv += [i + 1, t.teacherName, booksStr, t.books.length, t.totalTerjual, t.totalNominal, bagianSekolah].join('\t') + '\n';
        });
    } else if (effectiveTab === 'transactions') {
        if (currentTransactions.length === 0) {
            showToast('Perhatian', 'Tidak ada riwayat transaksi untuk disalin.', 'warning');
            return;
        }
        tsv = ['No', 'Tanggal', 'Tipe', 'Rombel', 'Mata Pelajaran', 'Guru Pengampu', 'Qty (Eks)', 'Harga Satuan', 'Total / Refund (Rp)', 'Metode', 'Alasan Retur', 'Siswa / Keterangan'].join('\t') + '\n';
        currentTransactions.forEach((tx, i) => {
            tsv += [i + 1, tx.date, isReturnTx(tx) ? 'Retur' : 'Penjualan', tx.className, tx.subject, tx.teacher, txNetQty(tx), tx.price, txNetTotal(tx), isReturnTx(tx) ? (tx.refundMethod || tx.payment || '-') : tx.payment, isReturnTx(tx) ? (tx.reason || '-') : '-', tx.note].join('\t') + '\n';
        });
    } else if (effectiveTab === 'classes') {
        const allRombels = [
            ...getClassesForGrade(10).map(c => ({ name: c, grade: 10 })),
            ...getClassesForGrade(11).map(c => ({ name: c, grade: 11 })),
            ...getClassesForGrade(12).map(c => ({ name: c, grade: 12 }))
        ];
        tsv = ['No', 'Rombel', 'Jenjang', 'Banyak Transaksi', 'Buku Terjual Kotor', 'Buku Diretur', 'Total Buku Bersih', 'Total Penjualan Bersih (Rp)'].join('\t') + '\n';
        allRombels.forEach((r, i) => {
            const sum = summarizeTransactions(currentTransactions.filter(t => t.className === r.name));
            tsv += [i + 1, r.name, `Kelas ${getGradeRoman(r.grade)}`, sum.count, sum.grossQty, sum.returnQty, sum.netQty, sum.netNom].join('\t') + '\n';
        });
    } else if (currentActiveTab === 'circulation') {
        if (currentCirculations.length === 0) {
            showToast('Perhatian', 'Tidak ada data sirkulasi untuk disalin.', 'warning');
            return;
        }
        tsv = ['No', 'Tanggal', 'Jenis Mutasi', 'Jenjang', 'Mata Pelajaran', 'Qty (Eks)', 'Pihak Terkait (Guru / Vendor)', 'Status Omzet', 'Catatan / Keperluan'].join('\t') + '\n';
        currentCirculations.forEach((c, i) => {
            const typeStr = c.type === 'pengambilan_guru' ? 'Pengambilan Guru' : c.type === 'terima' ? 'Penerimaan Vendor' : 'Retur Percetakan';
            const saleStr = c.type === 'pengambilan_guru' ? 'Non-Penjualan (Rp 0)' : 'Non-Penjualan';
            tsv += [i + 1, c.date, typeStr, `Kelas ${getGradeRoman(c.grade)}`, c.subject, c.qty, c.party, saleStr, c.note || '-'].join('\t') + '\n';
        });
    } else if (currentActiveTab === 'fees') {
        copyFeeTableToClipboard();
        return;
    } else if (currentActiveTab === 'settings') {
        tsv = ['No', 'Jenjang', 'Mata Pelajaran', 'Status Tampil', 'Harga Satuan (Rp)'].join('\t') + '\n';
        currentMatchedData.forEach((row, i) => {
            const statusStr = row.isActive !== false ? 'Tampil' : 'Sembunyi';
            tsv += [i + 1, `Kelas ${getGradeRoman(row.grade)}`, row.subject, statusStr, row.harga].join('\t') + '\n';
        });
    } else {
        if (currentMatchedData.length === 0) {
            showToast('Perhatian', 'Tidak ada data stok untuk disalin.', 'warning');
            return;
        }
        const effectiveBooks = getBooksWithPeriodSales(currentMatchedData, currentTransactions, currentSelectedSemesterPeriod);
        tsv = ['No', 'Jenjang', 'Mata Pelajaran', 'Diterima', 'Diambil', 'Terjual', 'Sisa Stok', 'Harga Satuan', 'Estimasi Nilai Sisa', 'Guru Pengampu'].join('\t') + '\n';
        effectiveBooks.forEach((row, i) => {
            const sisa = row.sisa;
            const nilaiSisa = sisa * (row.harga || 0);
            tsv += [i + 1, `Kelas ${getGradeRoman(row.grade)}`, row.subject, row.terima, row.diam, row.terjual, sisa, row.harga, nilaiSisa, row.teacherNamesStr].join('\t') + '\n';
        });
    }

    navigator.clipboard.writeText(tsv).then(() => {
        showToast('Berhasil', 'Tabel aktif berhasil disalin ke papan klip (TSV)! Siap di-paste ke Excel.', 'success');
    }).catch(err => {
        console.error('Clipboard copy error:', err);
        showToast('Galat', 'Gagal menyalin ke papan klip.', 'error');
    });
}

export function exportToExcel() {
    if (currentActiveTab === 'fees') {
        exportFeeDistributionToExcel();
        return;
    }
    if (!window.XLSX) {
        showToast('Perhatian', 'Pustaka Excel sedang dimuat, silakan coba beberapa detik lagi.', 'warning');
        return;
    }
    if (currentMatchedData.length === 0) {
        showToast('Perhatian', 'Belum ada data untuk diekspor.', 'warning');
        return;
    }

    const wb = window.XLSX.utils.book_new();
    const effectiveBooks = getBooksWithPeriodSales(currentMatchedData, currentTransactions, currentSelectedSemesterPeriod);

    // Sheet 1: Detail Rekap Buku
    const booksHeader = ['No', 'Kelas', 'Mata Pelajaran / Buku', 'Terima', 'Diam', 'Sisa', 'Terjual', 'Harga Satuan', 'Total Penjualan', 'Guru Pengampu (Rombel, Beban & Porsi Proporsional)'];
    const booksRows = effectiveBooks.map((b, i) => [
        i + 1,
        getGradeRoman(b.grade),
        b.subject,
        b.terima,
        b.diam,
        b.sisa,
        b.terjual,
        b.harga,
        b.total,
        b.teacherNamesStr
    ]);
    const wsBooks = window.XLSX.utils.aoa_to_sheet([booksHeader, ...booksRows]);
    window.XLSX.utils.book_append_sheet(wb, wsBooks, 'Rekap per Buku');

    // Sheet 2: Ringkasan per Guru Pengajar
    const teacherAggregates = aggregateSalesByTeacher(effectiveBooks);
    const schoolPct = getSchoolSharePercentage();
    const teacherHeader = ['No', 'Nama Guru Pengajar', 'Rincian Mata Pelajaran & Rombel', 'Jumlah Mapel', 'Total Eksemplar Proporsional', 'Total Nilai Proporsional (Rp)', `Bagian Sekolah (${schoolPct}%) (Rp)`];
    const teacherRows = teacherAggregates.map((t, i) => {
        const bagianSekolah = Math.round((t.totalNominal || 0) * (schoolPct / 100));
        return [
            i + 1,
            t.teacherName,
            t.books.map(b => `${getGradeRoman(b.grade)} - ${b.subject} (${b.classesStr} - ${b.classCount}/${b.totalClasses} kls [${b.percentageStr}]: ${b.propTerjual} eks / Rp ${b.propNominal.toLocaleString('id-ID')})`).join('\n'),
            t.books.length,
            t.totalTerjual,
            t.totalNominal,
            bagianSekolah
        ];
    });
    const wsTeachers = window.XLSX.utils.aoa_to_sheet([teacherHeader, ...teacherRows]);
    window.XLSX.utils.book_append_sheet(wb, wsTeachers, 'Rekap per Guru');

    // Sheet 3: Rincian Proporsional Guru
    const detailHeader = [
        'No',
        'Nama Guru Pengajar',
        'Kelas',
        'Mata Pelajaran',
        'Rombel yang Diampu',
        'Banyak Kelas Diampu',
        'Total Rombel Angkatan',
        'Persentase Beban (%)',
        'Eksemplar Proporsional',
        'Nilai Proporsional (Rp)'
    ];
    const detailRows = [];
    let detailIdx = 1;
    teacherAggregates.forEach(t => {
        t.books.forEach(b => {
            detailRows.push([
                detailIdx++,
                t.teacherName,
                getGradeRoman(b.grade),
                b.subject,
                b.classesStr,
                b.classCount,
                b.totalClasses,
                b.percentageStr,
                b.propTerjual,
                b.propNominal
            ]);
        });
    });
    const wsDetail = window.XLSX.utils.aoa_to_sheet([detailHeader, ...detailRows]);
    window.XLSX.utils.book_append_sheet(wb, wsDetail, 'Rincian Proporsional Guru');

    // Sheet 4: Transaksi Penjualan Harian & Retur (retur bernilai negatif agar akuntansi net akurat)
    const txHeader = ['No', 'Tanggal', 'Tipe', 'Rombel', 'Jenjang', 'Mata Pelajaran', 'Guru Pengampu', 'Qty (Eks)', 'Harga Satuan', 'Total / Refund (Rp)', 'Metode', 'Alasan Retur', 'Siswa / Keterangan'];
    const txRows = currentTransactions.map((tx, i) => [
        i + 1,
        tx.date,
        isReturnTx(tx) ? 'Retur' : 'Penjualan',
        tx.className,
        `Kelas ${getGradeRoman(tx.grade)}`,
        tx.subject,
        tx.teacher,
        txNetQty(tx),
        tx.price,
        txNetTotal(tx),
        isReturnTx(tx) ? (tx.refundMethod || tx.payment || '-') : tx.payment,
        isReturnTx(tx) ? (tx.reason || '-') : '-',
        tx.note
    ]);
    const wsTx = window.XLSX.utils.aoa_to_sheet([txHeader, ...txRows]);
    window.XLSX.utils.book_append_sheet(wb, wsTx, 'Transaksi Harian');

    // Sheet 5: Penjualan per Kelas / Rombel (Kotor, Retur, Bersih)
    const allRombels = [
        ...getClassesForGrade(10).map(c => ({ name: c, grade: 10 })),
        ...getClassesForGrade(11).map(c => ({ name: c, grade: 11 })),
        ...getClassesForGrade(12).map(c => ({ name: c, grade: 12 }))
    ];
    const classHeader = ['No', 'Rombel', 'Jenjang', 'Banyak Transaksi', 'Buku Terjual Kotor', 'Buku Diretur', 'Total Buku Bersih', 'Penjualan Kotor (Rp)', 'Refund Retur (Rp)', 'Total Penjualan Bersih (Rp)'];
    const classRows = allRombels.map((r, i) => {
        const sum = summarizeTransactions(currentTransactions.filter(t => t.className === r.name));
        return [
            i + 1,
            r.name,
            `Kelas ${getGradeRoman(r.grade)}`,
            sum.count,
            sum.grossQty,
            sum.returnQty,
            sum.netQty,
            sum.grossNom,
            sum.returnNom,
            sum.netNom
        ];
    });
    const wsClass = window.XLSX.utils.aoa_to_sheet([classHeader, ...classRows]);
    window.XLSX.utils.book_append_sheet(wb, wsClass, 'Penjualan per Kelas');

    // Sheet 6: Sirkulasi Buku (Penerimaan, Pengambilan Guru & Retur Percetakan)
    const circHeader = ['No', 'Tanggal', 'Jenis Mutasi', 'Jenjang', 'Mata Pelajaran / Buku', 'Qty (Eks)', 'Pihak Terkait (Guru / Vendor)', 'Status Omzet', 'Catatan / Keperluan'];
    const circRows = currentCirculations.map((c, i) => {
        const typeStr = c.type === 'pengambilan_guru' ? 'Pengambilan Guru (Pegangan/Sampel)' : c.type === 'terima' ? 'Penerimaan Buku Baru' : 'Retur Percetakan';
        const saleStr = c.type === 'pengambilan_guru' ? 'Non-Penjualan (Rp 0)' : 'Non-Penjualan';
        return [
            i + 1,
            c.date,
            typeStr,
            `Kelas ${getGradeRoman(c.grade)}`,
            c.subject,
            c.qty,
            c.party,
            saleStr,
            c.note || '-'
        ];
    });
    const wsCirc = window.XLSX.utils.aoa_to_sheet([circHeader, ...circRows]);
    window.XLSX.utils.book_append_sheet(wb, wsCirc, 'Sirkulasi Buku');

    // Sheet 7: Analisis Kebutuhan Buku (Pemetaan Target Siswa vs Beli vs Defisit/Surplus)
    const demandData = calculateBooksDemandAnalysis(currentMatchedData, currentClassSizes, currentParsedSchedule);
    const demandHeader = [
        'No', 'Jenjang', 'Mata Pelajaran', 'Rombel Sasaran', 'Banyak Rombel',
        'Target Siswa', 'Buku Diterima', 'Sudah Beli (Terjual)', 'Persentase Beli (%)',
        'Siswa Belum Beli', 'Sisa Stok Sekolah', 'Status Kebutuhan', 'Kurang (Defisit)', 'Lebih (Surplus)', 'Rekomendasi Manajerial'
    ];
    const demandRows = demandData.items.map((item, i) => [
        i + 1,
        `Kelas ${getGradeRoman(item.grade)}`,
        item.subject,
        item.targetClasses.join(', '),
        item.targetClassCount,
        item.targetStudents,
        item.terima,
        item.terjual,
        `${item.persenBeli}%`,
        item.siswaBelumBeli,
        item.sisaStok,
        item.statusLabel,
        item.defisit > 0 ? item.defisit : 0,
        item.surplus > 0 ? item.surplus : 0,
        item.recommendation
    ]);
    const wsDemand = window.XLSX.utils.aoa_to_sheet([demandHeader, ...demandRows]);
    window.XLSX.utils.book_append_sheet(wb, wsDemand, 'Analisis Kebutuhan');

    const fileName = `Rekap_Penjualan_Buku_SIMAS_${new Date().toISOString().slice(0, 10)}.xlsx`;
    window.XLSX.writeFile(wb, fileName);
    showToast('Berhasil', `File ${fileName} dengan 7 Sheet lengkap berhasil diunduh!`, 'success');
}

// Inisialisasi Halaman
// ==========================================
// MANAJEMEN PESANAN KELAS (Admin Kelas → Admin LKS/Super Admin)
// ==========================================

const ORDERS_D1_KEY = 'book_orders_data';
const ORDERS_STORAGE_KEY = 'simas_book_orders_data';
let currentClassOrders = [];
let currentOrderStatusFilter = 'deficit';

/**
 * Memuat data pesanan dari SSOT D1 / localStorage
 */
export async function loadClassOrders() {
    let localData = null;
    try {
        const raw = localStorage.getItem(ORDERS_STORAGE_KEY);
        if (raw) localData = JSON.parse(raw);
    } catch (e) {}

    let d1Data = null;
    if (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled) {
        try {
            const setting = await cfClient.getSystemSetting(ORDERS_D1_KEY);
            d1Data = parseSettingValue(setting);
        } catch (e) {}
    }

    const source = d1Data || localData;
    currentClassOrders = Array.isArray(source?.orders) ? source.orders : [];
}

/**
 * Menyimpan data pesanan ke SSOT
 */
async function saveClassOrders() {
    const payload = { orders: currentClassOrders, updatedAt: new Date().toISOString() };
    try {
        localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {}
    if (typeof cfClient !== 'undefined' && cfClient && cfClient.enabled) {
        try {
            await cfClient.saveSystemSetting(ORDERS_D1_KEY, payload);
        } catch (e) {}
    }
}

/**
 * Update badge count pesanan berselisih (kurang distribusi) di tab button
 */
function updateOrdersBadge() {
    const badge = document.getElementById('orders-badge-count');
    if (!badge) return;
    const deficitCount = currentClassOrders.filter(o => {
        if (o.status === 'cancelled') return false;
        const ordered = parseNumberSafe(o.qty, 0);
        if (ordered <= 0) return false;
        const delivered = getDeliveredQtyForOrder(o);
        return (ordered - delivered) > 0;
    }).length;

    if (deficitCount > 0) {
        badge.textContent = String(deficitCount);
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

/**
 * Menghitung sisa kebutuhan pesanan buku untuk kelas & mapel tertentu
 * Rumus: Jumlah Pesanan Kelas (Ordered) - Jumlah yang Sudah Dibeli / Diserahkan (Delivered)
 * Digunakan untuk mengisi otomatis Jumlah (Eks) pada modal Catat Penjualan Buku LKS
 */
export function getRemainingOrderQtyForClassSubject(className, subject, grade = null) {
    if (!className || !subject) {
        return { orderedQty: 0, deliveredQty: 0, remainingQty: 0, rawDiff: 0 };
    }

    const targetClass = normalizeKey(className);
    const targetSubject = normalizeKey(subject);
    const targetGradeRoman = grade ? getGradeRoman(grade) : null;

    // 1. Ambil jumlah pesanan kelas (orderedQty) dari tiket pesanan aktif (currentClassOrders)
    let orderedQty = 0;
    if (Array.isArray(currentClassOrders) && currentClassOrders.length > 0) {
        const matchingOrders = currentClassOrders.filter(o => {
            if (o.status === 'cancelled') return false;
            const oClass = normalizeKey(o.orderedBy?.class || o.className || o.class || '');
            const oSub = normalizeKey(o.bookSubject || o.subject || '');
            const oGradeRoman = o.grade ? getGradeRoman(o.grade) : null;

            const classMatch = oClass && targetClass && (oClass === targetClass);
            const subjectMatch = oSub && targetSubject && (oSub === targetSubject);
            const gradeMatch = !targetGradeRoman || !oGradeRoman || targetGradeRoman === oGradeRoman;

            return classMatch && subjectMatch && gradeMatch;
        });
        orderedQty = matchingOrders.reduce((sum, o) => sum + parseNumberSafe(o.qty, 0), 0);
    }

    // 2. Fallback jika tiket pesanan belum disubmit ke currentClassOrders: Cek cache matriks rombel
    if (orderedQty <= 0 && typeof localStorage !== 'undefined') {
        try {
            const rawMatrix = localStorage.getItem(`simas_book_matrix_${targetClass.replace(/\s+/g, '_')}`);
            if (rawMatrix) {
                const parsedMatrix = JSON.parse(rawMatrix);
                const matrixObj = parsedMatrix.matrix || parsedMatrix;
                if (typeof matrixObj === 'object' && matrixObj !== null) {
                    Object.values(matrixObj).forEach(studentData => {
                        const books = studentData?.books || {};
                        Object.keys(books).forEach(bookKey => {
                            if (normalizeKey(bookKey) === targetSubject && books[bookKey]?.ordered === true) {
                                orderedQty++;
                            }
                        });
                    });
                }
            }
        } catch (e) {
            console.warn('[PenjualanBuku] Fallback cek matriks pemesanan rombel:', e);
        }
    }

    // 3. Ambil jumlah yang sudah dibeli / diserahkan (net penjualan - retur) dari currentTransactions
    const deliveredQty = (currentTransactions || [])
        .filter(tx => {
            const txClass = normalizeKey(tx.className || '');
            const txSubject = normalizeKey(tx.subject || '');
            const txGradeRoman = getGradeRoman(tx.grade);

            const classMatch = targetClass && txClass && (targetClass === txClass);
            const subjectMatch = targetSubject && txSubject && (targetSubject === txSubject);
            const gradeMatch = !targetGradeRoman || !txGradeRoman || targetGradeRoman === txGradeRoman;

            return classMatch && subjectMatch && gradeMatch;
        })
        .reduce((sum, tx) => sum + txNetQty(tx), 0);

    const rawDiff = orderedQty - deliveredQty;
    const remainingQty = Math.max(0, rawDiff);

    return {
        orderedQty,
        deliveredQty,
        remainingQty,
        rawDiff
    };
}

/**
 * Menghitung akumulasi realisasi eksemplar buku yang sudah diserahkan/terjual ke kelas pemesan
 * Dihitung otomatis dari SSOT transaksi penjualan (currentTransactions) untuk rombel & mapel tersebut
 */
export function getDeliveredQtyForOrder(order) {
    if (!order) return 0;
    const targetClass = normalizeKey(order.orderedBy?.class || '');
    const targetSubject = normalizeKey(order.bookSubject || '');
    const orderGradeRoman = getGradeRoman(order.grade);

    return (currentTransactions || [])
        .filter(tx => {
            const txClass = normalizeKey(tx.className || '');
            const txSubject = normalizeKey(tx.subject || '');
            const txGradeRoman = getGradeRoman(tx.grade);

            const classMatch = targetClass && txClass && (targetClass === txClass);
            const subjectMatch = targetSubject && txSubject && (targetSubject === txSubject);
            const gradeMatch = !orderGradeRoman || !txGradeRoman || orderGradeRoman === txGradeRoman;

            return classMatch && subjectMatch && gradeMatch;
        })
        .reduce((sum, tx) => sum + txNetQty(tx), 0);
}

/**
 * Memperbarui 3 kartu KPI ringkasan pesanan kelas vs realisasi fisik
 */
export function updateOrdersKpis() {
    const elTotal = document.getElementById('kpi-orders-total-qty');
    const elDelivered = document.getElementById('kpi-orders-delivered-qty');
    const elDeficit = document.getElementById('kpi-orders-deficit-qty');

    if (!elTotal && !elDelivered && !elDeficit) return;

    // Hitung berdasarkan pesanan aktif yang relevan (bukan yang dibatalkan)
    const activeOrders = (currentClassOrders || []).filter(o => o.status !== 'cancelled');

    let totalOrdered = 0;
    let totalDelivered = 0;
    let totalDeficit = 0;

    activeOrders.forEach(order => {
        const ordered = parseNumberSafe(order.qty, 0);
        const delivered = getDeliveredQtyForOrder(order);
        const deficit = Math.max(0, ordered - delivered);

        totalOrdered += ordered;
        totalDelivered += Math.min(ordered, delivered);
        totalDeficit += deficit;
    });

    if (elTotal) elTotal.textContent = `${totalOrdered} eks`;
    if (elDelivered) elDelivered.textContent = `${totalDelivered} eks`;
    if (elDeficit) elDeficit.textContent = `${totalDeficit} eks`;
}

/**
 * Mengisi dropdown #filter-order-class dengan opsi Semua Kelas dan daftar rombel kelas terstruktur
 */
export function populateOrderClassFilter() {
    const select = document.getElementById('filter-order-class');
    if (!select) return;

    const classesX = getClassesForGrade(10);
    const classesXI = getClassesForGrade(11);
    const classesXII = getClassesForGrade(12);

    // Kumpulkan kelas tambahan yang mungkin ada pada tiket pesanan aktif
    const knownClassSet = new Set([
        ...classesX,
        ...classesXI,
        ...classesXII
    ]);
    const extraClasses = [];
    if (Array.isArray(currentClassOrders)) {
        currentClassOrders.forEach(o => {
            const cls = (o.orderedBy?.class || o.className || o.class || '').trim();
            if (cls && !knownClassSet.has(cls) && !extraClasses.includes(cls)) {
                extraClasses.push(cls);
            }
        });
    }

    let html = `<option value="all">Semua Kelas</option>`;
    if (classesX.length > 0) {
        html += `<optgroup label="Kelas X">` + classesX.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('') + `</optgroup>`;
    }
    if (classesXI.length > 0) {
        html += `<optgroup label="Kelas XI">` + classesXI.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('') + `</optgroup>`;
    }
    if (classesXII.length > 0) {
        html += `<optgroup label="Kelas XII">` + classesXII.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('') + `</optgroup>`;
    }
    if (extraClasses.length > 0) {
        html += `<optgroup label="Kelas Lainnya">` + extraClasses.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('') + `</optgroup>`;
    }

    select.innerHTML = html;
    select.value = currentOrderClassFilter || 'all';
}

/**
 * Event handler ketika filter kelas pada tab pesanan diubah
 */
export function onOrderClassFilterChanged() {
    const select = document.getElementById('filter-order-class');
    currentOrderClassFilter = select ? select.value : 'all';
    renderOrdersManagementTable();
}

/**
 * Render tabel pesanan masuk di tab Pesanan Kelas
 * Menampilkan hanya pesanan yang memiliki selisih kekurangan distribusi (jumlah pesanan > buku terdistribusi)
 */
export function renderOrdersManagementTable() {
    const tbody = document.getElementById('table-orders-body');
    if (!tbody) return;

    updateOrdersBadge();
    updateOrdersKpis();

    let filtered = [...currentClassOrders].filter(o => o.status !== 'cancelled' && parseNumberSafe(o.qty, 0) > 0);

    // Kriteria Utama: Default tampilkan hanya pesanan yang kebutuhannya masih kurang (jumlah pesanan > buku terdistribusi)
    filtered = filtered.filter(order => {
        const ordered = parseNumberSafe(order.qty, 0);
        const delivered = getDeliveredQtyForOrder(order);
        return (ordered - delivered) > 0;
    });

    // Filter Kelas / Rombel Khusus Tab Pesanan
    if (currentOrderClassFilter && currentOrderClassFilter !== 'all') {
        filtered = filtered.filter(order => {
            const orderClass = order.orderedBy?.class || order.className || order.class || '';
            return normalizeKey(orderClass) === normalizeKey(currentOrderClassFilter);
        });
    }

    // Filter Keyword Pencarian
    if (currentSearchKeyword) {
        const kw = currentSearchKeyword.toLowerCase();
        filtered = filtered.filter(order => {
            const orderClass = (order.orderedBy?.class || order.className || order.class || '').toLowerCase();
            const orderAdmin = (order.orderedBy?.name || '').toLowerCase();
            const orderSubject = (order.bookSubject || '').toLowerCase();
            const orderNote = (order.note || '').toLowerCase();
            return orderClass.includes(kw) || orderAdmin.includes(kw) || orderSubject.includes(kw) || orderNote.includes(kw);
        });
    }

    // Urutkan: selisih terbesar di atas, lalu tanggal terbaru
    filtered.sort((a, b) => {
        const diffA = parseNumberSafe(a.qty, 0) - getDeliveredQtyForOrder(a);
        const diffB = parseNumberSafe(b.qty, 0) - getDeliveredQtyForOrder(b);
        if (diffB !== diffA) return diffB - diffA;
        return new Date(b.orderedAt) - new Date(a.orderedAt);
    });

    if (filtered.length === 0) {
        const hasOrders = currentClassOrders.some(o => o.status !== 'cancelled' && parseNumberSafe(o.qty, 0) > 0);
        const isFiltered = (currentOrderClassFilter && currentOrderClassFilter !== 'all') || Boolean(currentSearchKeyword);
        let emptyMsg = `<i class="fa-solid fa-inbox text-lg mb-2 block opacity-40"></i>Belum ada pesanan masuk dari admin kelas.`;
        if (isFiltered) {
            emptyMsg = `<div class="space-y-1.5"><i class="fa-solid fa-filter-circle-xmark text-2xl text-slate-400 mb-1 block"></i><p class="font-bold text-slate-700 dark:text-slate-200 text-xs">Tidak Ada Pesanan yang Sesuai Filter</p><p class="text-[11px] text-slate-400">Tidak ditemukan pesanan untuk filter kelas atau kata kunci pencarian yang dipilih.</p></div>`;
        } else if (hasOrders) {
            emptyMsg = `<div class="space-y-1.5"><i class="fa-solid fa-circle-check text-2xl text-emerald-500 mb-1 block"></i><p class="font-bold text-slate-700 dark:text-slate-200 text-xs">Seluruh Pesanan Kelas Sudah Terpenuhi!</p><p class="text-[11px] text-slate-400">Semua pesanan buku telah tercatat pada transaksi penjualan secara lengkap (selisih 0 eks).</p></div>`;
        }
        tbody.innerHTML = `<tr><td colspan="12" class="py-10 text-center text-slate-400">${emptyMsg}</td></tr>`;
        return;
    }

    let html = '';
    filtered.forEach((order, idx) => {
        const dateStr = typeof window.formatDateIndo === 'function'
            ? window.formatDateIndo(order.orderedAt)
            : new Date(order.orderedAt).toLocaleDateString('id-ID');
        const gradeLabel = getGradeRoman(order.grade) || order.grade;

        const orderedQty = parseNumberSafe(order.qty, 0);
        const deliveredQty = getDeliveredQtyForOrder(order);
        const diff = orderedQty - deliveredQty;

        let diffBadge = '';
        let statusBadge = '';

        if (diff > 0) {
            diffBadge = `<span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60" title="Kebutuhan buku yang belum diserahkan">Kurang ${diff} eks</span>`;
            statusBadge = `<span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">Belum Lengkap</span>`;
        } else if (diff === 0) {
            diffBadge = `<span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60" title="Semua buku pesanan sudah diserahkan">Lengkap (0)</span>`;
            statusBadge = `<span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">Terpenuhi</span>`;
        } else {
            diffBadge = `<span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60" title="Penyerahan melebihi pesanan awal">Lebih +${Math.abs(diff)} eks</span>`;
            statusBadge = `<span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60">Surplus</span>`;
        }

        // Aksi langsung catat transaksi penjualan untuk memenuhi sisa kekurangan pesanan (menggantikan tombol setujui/tolak)
        const aksi = diff > 0 ? `
            <button onclick="window.quickFulfillOrderTransaction('${escapeHTML(order.id)}')" 
                class="px-2 py-1 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-[11px] font-bold rounded-md transition-colors flex items-center gap-1 mx-auto cursor-pointer" 
                title="Buka form transaksi untuk menyalurkan sisa ${diff} eksemplar">
                <i class="fa-solid fa-cart-plus text-xs"></i>
                <span>Catat</span>
            </button>
        ` : `<span class="text-emerald-600 dark:text-emerald-400 text-xs font-bold inline-flex items-center gap-1"><i class="fa-solid fa-check"></i>Lengkap</span>`;

        html += `<tr class="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
            <td class="px-3.5 py-2 text-center text-slate-400 font-mono text-xs">${idx + 1}</td>
            <td class="px-3 py-2 whitespace-nowrap text-xs">${escapeHTML(dateStr)}</td>
            <td class="px-3 py-2 text-xs">
                <div class="font-bold text-slate-800 dark:text-white">${escapeHTML(order.orderedBy?.class || '-')}</div>
                <div class="text-[10px] text-slate-500">${escapeHTML(order.orderedBy?.name || '-')}</div>
            </td>
            <td class="px-3 py-2 text-center"><span class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-bold">${escapeHTML(gradeLabel)}</span></td>
            <td class="px-4 py-2 font-semibold text-xs text-slate-800 dark:text-slate-100">${escapeHTML(order.bookSubject || '-')}</td>
            <td class="px-3 py-2 text-right font-mono font-bold text-xs">${orderedQty} eks</td>
            <td class="px-3 py-2 text-right font-mono font-bold text-xs ${deliveredQty > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}">${deliveredQty} eks</td>
            <td class="px-3 py-2 text-center">${diffBadge}</td>
            <td class="px-3 py-2 text-right font-mono text-xs">${formatRupiah(order.totalPrice || 0)}</td>
            <td class="px-3 py-2 text-center">${statusBadge}</td>
            <td class="px-3 py-2 text-xs text-slate-500 max-w-[160px] truncate" title="${escapeHTML(order.note || '')}">${escapeHTML(order.note || '-')}</td>
            <td class="px-3 py-2 text-center"><div class="flex items-center justify-center gap-1">${aksi}</div></td>
        </tr>`;
    });

    tbody.innerHTML = html;
}

/**
 * Buka modal catat transaksi dengan data rombel, mapel, dan sisa kekurangan qty yang terisi otomatis
 */
export async function quickFulfillOrderTransaction(orderId) {
    const order = currentClassOrders.find(o => o.id === orderId);
    if (!order) {
        showToast('Info', 'Data pesanan tidak ditemukan.', 'warning');
        return;
    }

    const ordered = parseNumberSafe(order.qty, 0);
    const delivered = getDeliveredQtyForOrder(order);
    const diff = Math.max(0, ordered - delivered);
    if (diff === 0) {
        showToast('Info', 'Pesanan ini sudah terpenuhi.', 'info');
        return;
    }

    await openAddTransactionModal();

    // Set Kelas / Rombel & Jenjang
    const selectClass = document.getElementById('tx-class');
    const selectGrade = document.getElementById('tx-grade');
    const orderClass = order.orderedBy?.class || order.className || order.class || '';
    if (selectClass && orderClass) {
        selectClass.value = orderClass;
    }
    if (selectGrade && order.grade) {
        selectGrade.value = String(order.grade);
    }
    onTransactionClassChanged();

    // Set Mata Pelajaran
    const selectSubject = document.getElementById('tx-subject');
    if (selectSubject && order.bookSubject) {
        selectSubject.value = order.bookSubject;
        onTransactionClassOrSubjectChanged();
    }

    // Set Qty sesuai kekurangan
    const inputQty = document.getElementById('tx-qty');
    if (inputQty) {
        inputQty.value = diff;
        calcTransactionTotal();
    }

    // Set Keterangan
    const inputNote = document.getElementById('tx-note');
    if (inputNote) {
        inputNote.value = `Pemenuhan pesanan kelas ${orderClass} (${order.bookSubject})`;
    }
}
if (typeof window !== 'undefined') {
    window.quickFulfillOrderTransaction = quickFulfillOrderTransaction;
}

/**
 * Handler filter status pesanan
 */
window.onOrderStatusFilterChanged = function() {
    const select = document.getElementById('filter-order-status');
    currentOrderStatusFilter = select?.value || 'deficit';
    renderOrdersManagementTable();
};

/**
 * Setujui pesanan dari admin kelas (Legacy compatibility)
 */
window.approveClassOrder = async function(orderId) {
    const order = currentClassOrders.find(o => o.id === orderId);
    if (!order) {
        showToast('Gagal', 'Pesanan tidak ditemukan.', 'error');
        return;
    }

    // Cek ketersediaan stok
    const book = currentMatchedData.find(b => 
        normalizeKey(b.subject) === normalizeKey(order.bookSubject) && String(b.grade) === String(order.grade)
    );
    if (!book) {
        showToast('Gagal', 'Buku tidak ditemukan di database penjualan.', 'error');
        return;
    }
    const totalTerjual = (currentTransactions || [])
        .filter(tx => normalizeKey(tx.subject) === normalizeKey(book.subject) && String(tx.grade) === String(book.grade))
        .reduce((sum, tx) => sum + (tx.type === 'retur' ? -(tx.qty || 0) : (tx.qty || 0)), 0);
    const sisaStok = (book.terima || 0) - (book.diam || 0) - totalTerjual;

    if (order.qty > sisaStok) {
        showToast('Stok Kurang', `Stok tersedia hanya ${sisaStok} eksemplar, pesanan meminta ${order.qty}.`, 'warning');
        return;
    }

    order.status = 'approved';
    order.processedAt = new Date().toISOString();
    order.processedBy = localStorage.getItem('user_name') || 'Admin';

    await saveClassOrders();
    renderOrdersManagementTable();
    showToast('Disetujui', `Pesanan ${order.qty} eks "${order.bookSubject}" dari ${order.orderedBy?.class || 'kelas'} telah disetujui.`, 'success');
};

/**
 * Tolak pesanan dari admin kelas (Legacy compatibility)
 */
window.rejectClassOrder = async function(orderId) {
    const reason = typeof prompt === 'function' ? prompt('Alasan penolakan (opsional):') : null;
    const order = currentClassOrders.find(o => o.id === orderId);
    if (!order) {
        showToast('Gagal', 'Pesanan tidak ditemukan.', 'error');
        return;
    }

    order.status = 'rejected';
    order.processedAt = new Date().toISOString();
    order.processedBy = localStorage.getItem('user_name') || 'Admin';
    order.rejectedReason = reason || null;

    await saveClassOrders();
    renderOrdersManagementTable();
    showToast('Ditolak', `Pesanan dari ${order.orderedBy?.class || 'kelas'} telah ditolak.`, 'warning');
};

/**
 * Tandai pesanan selesai diambil (fulfilled) dan catat sebagai transaksi penjualan (Legacy compatibility)
 */
window.fulfillClassOrder = async function(orderId) {
    const order = currentClassOrders.find(o => o.id === orderId);
    if (!order) {
        showToast('Gagal', 'Pesanan tidak ditemukan.', 'error');
        return;
    }

    // Catat sebagai transaksi penjualan otomatis
    const newTx = {
        id: `tx_order_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        date: new Date().toISOString().split('T')[0],
        period: typeof window.getDefaultTransactionPeriod === 'function' ? window.getDefaultTransactionPeriod() : '',
        grade: order.grade,
        className: order.orderedBy?.class || '',
        class: order.orderedBy?.class || '',
        subject: order.bookSubject,
        qty: order.qty,
        price: order.pricePerUnit,
        total: order.totalPrice,
        payment: 'Tunai',
        note: `Pesanan kelas ${order.orderedBy?.class || ''} (Order #${order.id.split('_').pop()})`,
        teacher: '',
        type: 'sale',
        orderId: order.id
    };

    currentTransactions.push(newTx);
    order.status = 'fulfilled';
    order.fulfilledAt = new Date().toISOString();

    await saveBookSalesData();
    await saveClassOrders();
    renderOrdersManagementTable();
    showToast('Selesai', `Pesanan ${order.qty} eks "${order.bookSubject}" telah diserahkan dan dicatat sebagai transaksi penjualan.`, 'success');
};

export async function initPenjualanBukuPage() {
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'index.html?redirect=' + encodeURIComponent(window.location.pathname);
            return;
        }

        // Cek RBAC: Super Admin atau Admin LKS (termasuk multi-role via hasRole)
        let role = localStorage.getItem('user_role');
        if (!role && window.getCurrentUserDoc) {
            try {
                const userDoc = await window.getCurrentUserDoc();
                role = userDoc?.role || '';
                if (role) localStorage.setItem('user_role', role);
            } catch (e) {}
        }

        const isAuthorized = role === 'super_admin' || role === 'admin_lks' ||
            (typeof window.hasRole === 'function' && (window.hasRole('super_admin') || window.hasRole('admin_lks')));
        if (!isAuthorized) {
            const main = document.querySelector('main');
            if (main) main.classList.add('hidden');
            const denied = document.getElementById('access-denied-container');
            if (denied) denied.classList.remove('hidden');
            return;
        }

        const effectiveRole = (typeof window.hasRole === 'function' && window.hasRole('super_admin')) ? 'super_admin' : (role || 'admin_lks');
        await initLayout(effectiveRole);

        const main = document.querySelector('main');
        if (main) main.classList.remove('hidden');

        // Preload jadwal XML di latar belakang
        try {
            currentParsedSchedule = await parseASCSchedule();
        } catch (err) {
            console.warn('[PenjualanBuku] Gagal preload jadwal:', err);
        }

        // Muat data tersimpan
        await loadSavedBookSalesData();

        // Muat pesanan dari admin kelas
        await loadClassOrders();
        updateOrdersBadge();

        // Inisialisasi dropdown filter periode semester di toolbar utama
        populateSemesterPeriodDropdown();

        const resultSection = document.getElementById('result-section');
        if (resultSection && currentMatchedData.length > 0) {
            resultSection.classList.remove('hidden');
        }

        updateKpiCards(currentMatchedData);
        applyRoleBasedAccessControl();
        switchTab(currentActiveTab);
    });

    // Event Listeners
    const btnProcess = document.getElementById('btn-process');
    if (btnProcess) btnProcess.addEventListener('click', processInputData);

    const btnClear = document.getElementById('btn-clear');
    if (btnClear) btnClear.addEventListener('click', clearData);

    const btnCopy = document.getElementById('btn-copy-table');
    if (btnCopy) btnCopy.addEventListener('click', copyTableToClipboard);

    const btnExport = document.getElementById('btn-export-excel');
    if (btnExport) btnExport.addEventListener('click', exportToExcel);

    const btnPrint = document.getElementById('btn-print-report');
    if (btnPrint) btnPrint.addEventListener('click', () => window.print());

    const gradeFilterSelect = document.getElementById('filter-grade');
    if (gradeFilterSelect) {
        gradeFilterSelect.addEventListener('change', (e) => {
            currentGradeFilter = e.target.value;
            switchTab(currentActiveTab);
        });
    }

    const orderClassFilterSelect = document.getElementById('filter-order-class');
    if (orderClassFilterSelect) {
        orderClassFilterSelect.addEventListener('change', onOrderClassFilterChanged);
    }

    const semesterPeriodFilterSelect = document.getElementById('filter-semester-period');
    if (semesterPeriodFilterSelect) {
        semesterPeriodFilterSelect.addEventListener('change', onSemesterPeriodChanged);
    }

    const settingsStatusFilterSelect = document.getElementById('filter-settings-status');
    if (settingsStatusFilterSelect) {
        settingsStatusFilterSelect.addEventListener('change', onSettingsStatusChanged);
    }

    const periodFilterSelect = document.getElementById('filter-period');
    if (periodFilterSelect) {
        periodFilterSelect.addEventListener('change', (e) => {
            currentPeriodFilter = e.target.value;
            if (currentActiveTab === 'transactions') {
                renderTransactionsTable(currentTransactions);
            }
        });
    }

    const circFilterSelect = document.getElementById('filter-circulation-type');
    if (circFilterSelect) {
        circFilterSelect.addEventListener('change', (e) => {
            currentCirculationFilter = e.target.value;
            if (currentActiveTab === 'circulation') {
                renderCirculationTable(currentCirculations);
            }
        });
    }

    const demandFilterSelect = document.getElementById('filter-demand-status');
    if (demandFilterSelect) {
        demandFilterSelect.addEventListener('change', (e) => {
            currentDemandFilter = e.target.value;
            if (currentActiveTab === 'analysis') {
                renderDemandAnalysisTable(currentMatchedData);
            }
        });
    }

    const searchInput = document.getElementById('search-books');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearchKeyword = e.target.value.trim();
            switchTab(currentActiveTab);
        });
    }

    // Interactive Thousands Separator untuk form nominal uang
    const cfAmountInput = document.getElementById('cf-amount');
    if (cfAmountInput) {
        cfAmountInput.addEventListener('input', () => formatCurrencyInput(cfAmountInput));
    }
    const bulkPriceInput = document.getElementById('bulk-price-value');
    if (bulkPriceInput) {
        bulkPriceInput.addEventListener('input', () => formatCurrencyInput(bulkPriceInput));
    }

    // Searchable Combobox Guru Pengambil Sirkulasi
    const circPartyInput = document.getElementById('circ-party');
    if (circPartyInput) {
        circPartyInput.addEventListener('focus', () => {
            openCircTeacherDropdown();
        });
        circPartyInput.addEventListener('click', (e) => {
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
            openCircTeacherDropdown();
        });
        circPartyInput.addEventListener('input', (e) => {
            openCircTeacherDropdown();
            populateCircTeacherDropdown(e.target.value);
        });
    }

    document.addEventListener('click', (e) => {
        const containerTeacher = document.getElementById('container-circ-teacher');
        if (containerTeacher && !containerTeacher.contains(e.target)) {
            closeCircTeacherDropdown();
        }
    });

    // Modal backdrop click to close
    ['modal-add-transaction', 'modal-class-detail', 'modal-add-book', 'modal-circulation', 'modal-demand-detail', 'modal-return-transaction', 'modal-bulk-price', 'modal-cashflow'].forEach(id => {
        const m = document.getElementById(id);
        if (m) {
            m.addEventListener('click', (e) => {
                if (e.target === m) m.classList.add('hidden');
            });
        }
    });

    // Escape key listener untuk menutup modal aktif & dropdown
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeCircTeacherDropdown();
            closeAddTransactionModal();
            closeClassDetailModal();
            closeAddBookModal();
            closeImportModal();
            closeCirculationModal();
            closeDemandDetailModal();
            closeReturnModal();
            closeBulkPriceModal();
            closeAddCashFlowModal();
        }
    });
}

// Global Exposure untuk inline onclick handlers dan pengujian (Audit 4 Compliant)
if (typeof window !== 'undefined') {
    window.BOOK_SALES_STORAGE_KEY = BOOK_SALES_STORAGE_KEY;
    window.BOOK_SALES_D1_KEY = BOOK_SALES_D1_KEY;
    window.DEFAULT_BOOK_SALES_DATA = DEFAULT_BOOK_SALES_DATA;
    window.parseNumberSafe = parseNumberSafe;
    window.getGradeRoman = getGradeRoman;
    window.parseBookSalesText = parseBookSalesText;
    window.buildScheduleGradeMap = buildScheduleGradeMap;
    window.findTeachersForBookSales = findTeachersForBookSales;
    window.aggregateSalesByTeacher = aggregateSalesByTeacher;
    window.matchBookSalesWithSchedule = matchBookSalesWithSchedule;
    window.getClassesForGrade = getClassesForGrade;
    window.getSubjectsForGrade = getSubjectsForGrade;
    window.getSubjectsForClass = getSubjectsForClass;
    window.findBookEntry = findBookEntry;
    window.findTeacherForClassSubject = findTeacherForClassSubject;
    window.calcRemainingStock = calcRemainingStock;
    window.getBookPrice = getBookPrice;
    window.openAddTransactionModal = openAddTransactionModal;
    window.closeAddTransactionModal = closeAddTransactionModal;
    window.openImportModal = openImportModal;
    window.closeImportModal = closeImportModal;
    window.detectGradeFromClassName = detectGradeFromClassName;
    window.populateTransactionAllClasses = populateTransactionAllClasses;
    window.onTransactionGradeChanged = onTransactionGradeChanged;
    window.onTransactionClassChanged = onTransactionClassChanged;
    window.onTransactionClassOrSubjectChanged = onTransactionClassOrSubjectChanged;
    window.calcTransactionTotal = calcTransactionTotal;
    window.submitAddTransaction = submitAddTransaction;
    window.deleteTransaction = deleteTransaction;
    window.openClassDetailModal = openClassDetailModal;
    window.closeClassDetailModal = closeClassDetailModal;
    window.closeDemandDetailModal = closeDemandDetailModal;
    window.switchBookTab = switchTab;
    window.switchTab = switchTab;
    window.switchRecapSubView = switchRecapSubView;
    window.getCurrentRecapSubView = getCurrentRecapSubView;
    window.setCurrentRecapSubView = setCurrentRecapSubView;
    window.renderBooksTable = renderBooksTable;
    window.renderTeachersTable = renderTeachersTable;
    window.isBookSubjectMatch = isBookSubjectMatch;
    window.getBooksWithPeriodSales = getBooksWithPeriodSales;
    window.processInputData = processInputData;
    window.loadDefaultData = loadDefaultData;
    window.clearData = clearData;
    window.clearBookData = clearData;
    window.copyBookTable = copyTableToClipboard;
    window.exportBookExcel = exportToExcel;
    // Sirkulasi & Pengaturan Harga
    window.openCirculationModal = openCirculationModal;
    window.closeCirculationModal = closeCirculationModal;
    window.onCirculationGradeChanged = onCirculationGradeChanged;
    window.onCirculationSubjectChanged = onCirculationSubjectChanged;
    window.onCirculationTypeChanged = onCirculationTypeChanged;
    window.submitAddCirculation = submitAddCirculation;
    window.deleteCirculation = deleteCirculation;
    window.renderCirculationTable = renderCirculationTable;
    window.toggleCircTeacherDropdown = toggleCircTeacherDropdown;
    window.openCircTeacherDropdown = openCircTeacherDropdown;
    window.closeCircTeacherDropdown = closeCircTeacherDropdown;
    window.selectCircTeacher = selectCircTeacher;
    window.populateCircTeacherDropdown = populateCircTeacherDropdown;
    window.getAssignedTeachersForSubject = getAssignedTeachersForSubject;
    window.getSubjectTeachersMap = getSubjectTeachersMap;
    window.getAllSchoolTeachers = getAllSchoolTeachers;
    window.setCurrentParsedSchedule = setCurrentParsedSchedule;
    window.getCurrentParsedSchedule = getCurrentParsedSchedule;
    // Pengelolaan Vendor Mitra
    window.BOOK_VENDORS_STORAGE_KEY = BOOK_VENDORS_STORAGE_KEY;
    window.BOOK_VENDORS_D1_KEY = BOOK_VENDORS_D1_KEY;
    window.getCurrentVendors = getCurrentVendors;
    window.setCurrentVendors = setCurrentVendors;
    window.renderVendorSettingsTable = renderVendorSettingsTable;
    window.submitAddVendor = submitAddVendor;
    window.deleteVendor = deleteVendor;
    window.populateVendorSelect = populateVendorSelect;
    window.onCirculationVendorSelectChanged = onCirculationVendorSelectChanged;
    window.renderPriceSettingsTable = renderPriceSettingsTable;
    window.updateBookPrice = updateBookPrice;
    window.openBulkPriceModal = openBulkPriceModal;
    window.closeBulkPriceModal = closeBulkPriceModal;
    window.applyBulkPriceUpdate = applyBulkPriceUpdate;
    window.saveAllBookPrices = saveAllBookPrices;
    window.onRowPriceSave = onRowPriceSave;
    window.openAddBookModal = openAddBookModal;
    window.closeAddBookModal = closeAddBookModal;
    window.submitAddBook = submitAddBook;
    window.deleteBookEntry = deleteBookEntry;
    window.syncBooksFromSchedule = syncBooksFromSchedule;
    window.setCurrentBookData = setCurrentBookData;
    window.getCurrentBookData = getCurrentBookData;
    window.setCurrentTransactions = setCurrentTransactions;
    window.getCurrentTransactions = getCurrentTransactions;
    window.updateKpiCards = updateKpiCards;
    // Periode Transaksi & Visibilitas Buku
    window.getDefaultTransactionPeriod = getDefaultTransactionPeriod;
    window.getNextSemesterPeriod = getNextSemesterPeriod;
    window.getAvailableTransactionPeriods = getAvailableTransactionPeriods;
    window.getCurrentSelectedSemesterPeriod = getCurrentSelectedSemesterPeriod;
    window.setCurrentSelectedSemesterPeriod = setCurrentSelectedSemesterPeriod;
    window.getCurrentSettingsStatusFilter = getCurrentSettingsStatusFilter;
    window.setCurrentSettingsStatusFilter = setCurrentSettingsStatusFilter;
    window.populateModalPeriodSelect = populateModalPeriodSelect;
    window.populateSemesterPeriodDropdown = populateSemesterPeriodDropdown;
    window.formatSemesterPeriodShort = formatSemesterPeriodShort;
    window.isPeriodMatch = isPeriodMatch;
    window.onSemesterPeriodChanged = onSemesterPeriodChanged;
    window.toggleBookVisibility = toggleBookVisibility;
    window.getPendingVisibilityToggles = getPendingVisibilityToggles;
    window.getPendingPriceSaves = getPendingPriceSaves;
    window.onSettingsStatusChanged = onSettingsStatusChanged;
    // Analisis Kebutuhan Buku (Demand Analysis)
    window.isAdvancedSubject = isAdvancedSubject;
    window.isBookSubjectMatch = isBookSubjectMatch;
    window.getBooksWithPeriodSales = getBooksWithPeriodSales;
    window.getClassStudentCounts = getClassStudentCounts;
    window.getSubjectTargetClasses = getSubjectTargetClasses;
    window.analyzeBookDemand = analyzeBookDemand;
    window.calculateBooksDemandAnalysis = calculateBooksDemandAnalysis;
    window.renderDemandAnalysisTable = renderDemandAnalysisTable;
    window.openDemandDetailModal = openDemandDetailModal;
    window.closeDemandDetailModal = closeDemandDetailModal;
    window.setCurrentClassSizes = setCurrentClassSizes;
    window.getCurrentClassSizes = getCurrentClassSizes;
    // Retur Penjualan Buku (Siswa Batal Beli) & Akuntansi Net
    window.isReturnTx = isReturnTx;
    window.txNetQty = txNetQty;
    window.txNetTotal = txNetTotal;
    window.getReturnedQtyForTx = getReturnedQtyForTx;
    window.getReturnableQty = getReturnableQty;
    window.summarizeTransactions = summarizeTransactions;
    window.openReturnModal = openReturnModal;
    window.closeReturnModal = closeReturnModal;
    window.onReturnSourceTxChanged = onReturnSourceTxChanged;
    window.onReturnGradeChanged = onReturnGradeChanged;
    window.onReturnClassChanged = onReturnClassChanged;
    window.onReturnPeriodChanged = onReturnPeriodChanged;
    window.onReturnSubjectChanged = onReturnSubjectChanged;
    window.calcReturnTotal = calcReturnTotal;
    window.submitAddReturn = submitAddReturn;
    window.onTxTypeFilterChanged = onTxTypeFilterChanged;
    // Pesanan Kelas (Admin Kelas)
    window.renderOrdersManagementTable = renderOrdersManagementTable;
    window.loadClassOrders = loadClassOrders;
    window.setCurrentClassOrders = setCurrentClassOrders;
    window.getCurrentClassOrders = getCurrentClassOrders;
    window.getDeliveredQtyForOrder = getDeliveredQtyForOrder;
    window.getRemainingOrderQtyForClassSubject = getRemainingOrderQtyForClassSubject;
    window.updateOrdersKpis = updateOrdersKpis;
    window.quickFulfillOrderTransaction = quickFulfillOrderTransaction;
    window.populateOrderClassFilter = populateOrderClassFilter;
    window.onOrderClassFilterChanged = onOrderClassFilterChanged;
    window.getOrderClassFilter = getOrderClassFilter;
    window.setOrderClassFilter = setOrderClassFilter;
    // Retensi Data Otomatis 5 Tahun
    window.purgeExpiredLksRecords = purgeExpiredLksRecords;
    // Arus Kas / Cash Flow Handlers
    window.getCurrentCashFlows = getCurrentCashFlows;
    window.setCurrentCashFlows = setCurrentCashFlows;
    window.getCurrentCashFlowFilter = getCurrentCashFlowFilter;
    window.setCurrentCashFlowFilter = setCurrentCashFlowFilter;
    window.isCashTx = isCashTx;
    window.calculateCashFlowSummary = calculateCashFlowSummary;
    window.updateTxCashSummary = updateTxCashSummary;
    window.generateCashFlowLedger = generateCashFlowLedger;
    window.renderCashFlowTable = renderCashFlowTable;
    window.openAddCashFlowModal = openAddCashFlowModal;
    window.closeAddCashFlowModal = closeAddCashFlowModal;
    window.onCashFlowTypeChanged = onCashFlowTypeChanged;
    window.onCashFlowFilterChanged = onCashFlowFilterChanged;
    window.submitAddCashFlow = submitAddCashFlow;
    window.deleteCashFlow = deleteCashFlow;
    window.BOOK_SALES_STORAGE_KEY = BOOK_SALES_STORAGE_KEY;
    window.BOOK_SALES_D1_KEY = BOOK_SALES_D1_KEY;
    window.BOOK_VENDORS_STORAGE_KEY = BOOK_VENDORS_STORAGE_KEY;
    window.BOOK_VENDORS_D1_KEY = BOOK_VENDORS_D1_KEY;
    window.BOOK_SCHOOL_SHARE_STORAGE_KEY = BOOK_SCHOOL_SHARE_STORAGE_KEY;
    window.BOOK_SCHOOL_SHARE_D1_KEY = BOOK_SCHOOL_SHARE_D1_KEY;
    window.getSchoolSharePercentage = getSchoolSharePercentage;
    window.setSchoolSharePercentage = setSchoolSharePercentage;
    window.updateSchoolShareBadge = updateSchoolShareBadge;
    window.saveSchoolSharePercentage = saveSchoolSharePercentage;
    window.loadSavedBookSalesData = loadSavedBookSalesData;
    window.saveBookSalesData = saveBookSalesData;
    window.parseSettingValue = parseSettingValue;
    window.isSuperAdmin = isSuperAdmin;
    window.applyRoleBasedAccessControl = applyRoleBasedAccessControl;
    window.safeToast = safeToast;
    window.formatDateShortDmy = formatDateShortDmy;
    window.renderTransactionsTable = renderTransactionsTable;
    window.formatCurrencyInput = formatCurrencyInput;
    // Sistem Pembagian Fee LKS (4 Komponen Dinamis)
    window.BOOK_FEE_SETTINGS_STORAGE_KEY = BOOK_FEE_SETTINGS_STORAGE_KEY;
    window.BOOK_FEE_SETTINGS_D1_KEY = BOOK_FEE_SETTINGS_D1_KEY;
    window.DEFAULT_FEE_DISTRIBUTION_SETTINGS = DEFAULT_FEE_DISTRIBUTION_SETTINGS;
    window.getFeeDistributionSettings = getFeeDistributionSettings;
    window.setFeeDistributionSettings = setFeeDistributionSettings;
    window.getFeeRoleFilter = getFeeRoleFilter;
    window.setFeeRoleFilter = setFeeRoleFilter;
    window.getCurrentFeeDistributionResult = getCurrentFeeDistributionResult;
    window.setCurrentFeeDistributionResult = setCurrentFeeDistributionResult;
    window.onFeePercentageInputChanged = onFeePercentageInputChanged;
    window.onFeeAmountInputChanged = onFeeAmountInputChanged;
    window.updateFeePreviewEstimates = updateFeePreviewEstimates;
    window.updateFeeSettingsUI = updateFeeSettingsUI;
    window.saveFeeDistributionSettings = saveFeeDistributionSettings;
    window.fetchAllSchoolGtk = fetchAllSchoolGtk;
    window.classifyGtkRole = classifyGtkRole;
    window.cleanAcademicTitle = cleanAcademicTitle;
    window.calculateFeeDistribution = calculateFeeDistribution;
    window.renderFeeSharingTab = renderFeeSharingTab;
    window.onFeeRoleFilterChanged = onFeeRoleFilterChanged;
    window.renderFeeSharingTable = renderFeeSharingTable;
    window.openFeeDetailModal = openFeeDetailModal;
    window.closeFeeDetailModal = closeFeeDetailModal;
    window.copyFeeTableToClipboard = copyFeeTableToClipboard;
    window.exportFeeDistributionToExcel = exportFeeDistributionToExcel;
    window.printFeeDistributionSummary = printFeeDistributionSummary;
    window.initPenjualanBukuPage = initPenjualanBukuPage;
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', initPenjualanBukuPage);
}
