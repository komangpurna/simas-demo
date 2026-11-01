/* js/config.js - Konfigurasi Utama & Firebase (Root Structure) */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getFirestore, collection, doc, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { createSecureSupabaseFetch } from './supabase-secure-fetch.mjs';
import { installWorkerFallback } from './worker-fallback.mjs';
import { SCHOOL_CONFIG, schoolAssetUrl, applySchoolIdentity, replaceSchoolIdentityText } from './school-config.js';
export { SCHOOL_CONFIG, schoolAssetUrl, applySchoolIdentity, replaceSchoolIdentityText };

const firebaseConfig = {
  apiKey: "AIzaSyDphzPKM2poA6U6RyXu798j7_ITgxN07nI",
  authDomain: "simas-demo-5ead3.firebaseapp.com",
  projectId: "simas-demo-5ead3",
  storageBucket: "simas-demo-5ead3.firebasestorage.app",
  messagingSenderId: "246723731558",
  appId: "1:246723731558:web:073b3b2005997f45730da7"
};

// Inisialisasi Firebase (SSOT untuk Live & Testing)
const app = initializeApp(firebaseConfig);

// Aktifkan Persistent Local Cache (IndexedDB Multi-Tab) untuk Hemat Kuota Read Firestore
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (e) {
  console.warn('[Firestore] Persistent cache fallback initialized:', e);
  db = getFirestore(app);
}

const auth = getAuth(app);

// --- SUPABASE CONFIGURATION (SSOT) ---
export const SUPABASE_CONFIG = {
  url: "https://wwvtthoeknizglicrhor.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3dnR0aG9la25pemdsaWNyaG9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4MjAzOTgsImV4cCI6MjEwMjM5NjM5OH0.opR-NvBZYWawcRdUeqX2M-jyJBRhcL2ggeTBVQbQTvo"
};

export const SUPABASE_URL = SUPABASE_CONFIG.url;
export const SUPABASE_ANON_KEY = SUPABASE_CONFIG.anonKey;
export const SUPABASE_HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_CONFIG.anonKey,
  'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
};
const workerPrimaryUrl = "https://simas-demo-api.komangpurna1.workers.dev";
const workerGatewayUrl = `${SUPABASE_CONFIG.url}/functions/v1/worker-gateway`;
const workerTransport = installWorkerFallback({ primaryUrl: workerPrimaryUrl, gatewayUrl: workerGatewayUrl });
export const CLOUDFLARE_CONFIG = {
  enabled: true,
  primaryWorkerUrl: workerPrimaryUrl,
  fallbackUrl: workerGatewayUrl,
  get workerUrl() { return workerTransport.baseUrl; },
  get WORKER_URL() { return workerTransport.baseUrl; },
  syncKey: ''
};
export const JURNAL_SYNC_API_KEY = CLOUDFLARE_CONFIG.syncKey;

// Google Apps Script Web App Endpoints untuk Upload Foto ke Google Drive
// 1. Modul Jurnal Mengajar
export const JURNAL_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyI2jzx01oTvumQRWA1LDVwT-IGU-SYVlscwrmzUubxYiV_DmsyweHzo5Y6G32ahSFW/exec";
// 2. Modul E-Kinerja Guru (Dedicated Google Apps Script Web App - Google Drive)
export const EKINERJA_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwGwYmeLUiJUAI-FHK3cDUAddFLtpmnIKRfKX5PyeJRpktj6KlqnAqeKd6ImW3k-x0m/exec";
// 3. Modul Dokumen Kependudukan Siswa (KK - Google Drive Uploader)
export const STUDENT_DOCS_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxrCFTVk6eFmNGa3AK-_kb4qFb1AxU7ztEsdE3ijoejF6yRYbnqF0yz-yDpzzpxxjegsg/exec";


/**
 * Resolusi SSOT URL foto profil (GTK/Guru maupun Pasfoto Siswa)
 * Mengubah path relatif streaming Cloudflare (/api/photos/...) menjadi full URL Cloudflare Worker yang dapat diakses secara publik,
 * sekaligus mempertahankan URL eksternal (https://, http://, data:, blob:).
 *
 * @param {string} url - URL atau relative path foto
 * @returns {string} Fully-qualified playable image URL
 */
export function resolvePhotoUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  // Jika sudah merupakan absolute URL atau inline data URI
  if (/^(https?:|data:|blob:)/i.test(trimmed)) {
    const primary = typeof CLOUDFLARE_CONFIG !== 'undefined' && CLOUDFLARE_CONFIG.primaryWorkerUrl;
    if (primary && trimmed.startsWith(`${primary}/api/`)) {
      return `${CLOUDFLARE_CONFIG.workerUrl}${trimmed.slice(primary.length)}`;
    }
    return trimmed;
  }

  const workerBase = (typeof CLOUDFLARE_CONFIG !== 'undefined' && (CLOUDFLARE_CONFIG?.workerUrl || CLOUDFLARE_CONFIG?.WORKER_URL))
    ? (CLOUDFLARE_CONFIG.workerUrl || CLOUDFLARE_CONFIG.WORKER_URL).replace(/\/+$/, '')
    : (typeof window !== 'undefined' && (window.CLOUDFLARE_CONFIG?.workerUrl || window.CLOUDFLARE_CONFIG?.WORKER_URL))
      ? (window.CLOUDFLARE_CONFIG.workerUrl || window.CLOUDFLARE_CONFIG.WORKER_URL).replace(/\/+$/, '')
      : "https://simas-demo-api.komangpurna1.workers.dev";

  if (trimmed.startsWith('/api/')) {
    return `${workerBase}${trimmed}`;
  }
  if (trimmed.startsWith('api/')) {
    return `${workerBase}/${trimmed}`;
  }
  // Jika path diawali dengan slash lain namun mengarah ke asset lokal
  if (trimmed.startsWith('/')) {
    return trimmed;
  }
  return trimmed;
}

if (typeof window !== 'undefined') {
  window.CLOUDFLARE_CONFIG = CLOUDFLARE_CONFIG;
  window.resolvePhotoUrl = resolvePhotoUrl;
}

// Semua operasi sensitif PostgREST dialihkan transparan ke secure-proxy yang
// memverifikasi Firebase ID token dan role. Public-read katalog tetap langsung.
const secureSupabaseFetch = createSecureSupabaseFetch({
  auth,
  supabaseUrl: SUPABASE_CONFIG.url,
  supabaseAnonKey: SUPABASE_CONFIG.anonKey,
  nativeFetch: globalThis.fetch.bind(globalThis),
});

// Singleton instance Supabase client terpusat (SSOT)
export const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
  global: { fetch: secureSupabaseFetch },
});

// Ekspor instance Firebase utama & konfigurasi terpusat
export { app, db, auth, firebaseConfig };

// --- KONFIGURASI DATABASE (STANDAR ROOT) ---
// Semua collection langsung berada di level utama (Root)
// Lebih bersih, mudah dibaca, dan efisien.

export const PATHS = {
  // 1. DATA PENGGUNA (Login & Autentikasi - Active Firestore SSOT)
  users: 'users',
  userSecrets: 'user_secrets',

  // 2. PENGATURAN GLOBAL (Settings & WA Config - Active Firestore SSOT)
  settings: 'settings',

  // 3. LOG AUDIT & SESI AKTIF (Active Firestore SSOT)
  classTransfers: 'class_transfers',
  studentSessions: 'student_sessions',
  kapsulWaktu: 'kapsul_waktu'
};

/**
 * Dynamic SSOT AI Configuration Object
 * Properti model dan displayName 100% dinamis membaca konfigurasi dari Pengaturan Aplikasi (Firestore settings/system_config & localStorage).
 * 0 Hardcode: Sama sekali tidak ada nama model tertentu yang dikunci di dalam kode sumber.
 */
export const AI_CONFIG = {
  get model() {
    try {
      if (typeof localStorage !== 'undefined') {
        const cached = localStorage.getItem('simas_gemini_model');
        if (cached === 'gemini-1.5-flash') {
          try { localStorage.removeItem('simas_gemini_model'); } catch (_) {}
        } else if (cached) {
          return cached.trim();
        }
      }
    } catch (_) {}
    if (typeof window !== 'undefined' && window._systemConfigCache?.geminiModel) {
      return String(window._systemConfigCache.geminiModel).trim();
    }
    return '';
  },
  set model(val) {
    try {
      if (typeof localStorage !== 'undefined' && val) {
        localStorage.setItem('simas_gemini_model', String(val).trim());
      }
    } catch (_) {}
  },
  get displayName() {
    try {
      if (typeof localStorage !== 'undefined') {
        const cached = localStorage.getItem('simas_gemini_display_name');
        if (cached) return cached.trim();
      }
    } catch (_) {}
    if (typeof window !== 'undefined' && window._systemConfigCache?.geminiDisplayName) {
      return String(window._systemConfigCache.geminiDisplayName).trim();
    }
    return 'Gemini AI';
  },
  set displayName(val) {
    try {
      if (typeof localStorage !== 'undefined' && val) {
        localStorage.setItem('simas_gemini_display_name', String(val).trim());
      }
    } catch (_) {}
  }
};

export function getAiConfig() {
  const model = AI_CONFIG.model;
  const displayName = AI_CONFIG.displayName;

  return {
    model: model,
    displayName: displayName || 'Gemini AI'
  };
}

export async function getAiConfigAsync() {
  let cfg = getAiConfig();

  // Jika cache belum ada, ambil dari Firestore settings/system_config (SSOT)
  if (!cfg.model && db) {
    try {
      const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
      const snap = await getDoc(doc(db, 'settings', 'system_config'));
      if (snap && snap.exists()) {
        const data = snap.data();
        if (data.geminiModel) {
          AI_CONFIG.model = data.geminiModel;
          cfg.model = data.geminiModel.trim();
        }
        if (data.geminiDisplayName) {
          AI_CONFIG.displayName = data.geminiDisplayName;
          cfg.displayName = data.geminiDisplayName.trim();
        }
      }
    } catch (e) {
      console.warn('[AI Config] Error fetching system_config:', e);
    }
  }
  return cfg;
}

/**
 * SSOT Helper: Ambil seluruh Google Gemini API Keys pengguna (Multi-Key)
 * Mengambil dari Firestore user_secrets/{uid}.geminiApiKey atau cache runtime/localStorage
 * Mengembalikan Array<string> kunci yang valid.
 */
export async function getUserGeminiApiKeysAsync(uid = null) {
  const currentUid = uid || auth?.currentUser?.uid;
  let keys = [];

  if (currentUid && db) {
    try {
      const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js");
      const secretSnap = await getDoc(doc(db, 'user_secrets', currentUid));
      if (secretSnap.exists()) {
        const data = secretSnap.data()?.geminiApiKey;
        if (Array.isArray(data)) {
          keys = data.filter(k => typeof k === 'string' && k.trim());
        } else if (typeof data === 'string' && data.trim().length > 5) {
          keys = [data.trim()];
        }
      }
    } catch (e) {
      console.warn('[AI Config] Error fetching user_secrets:', e);
    }
  }

  // Fallback ke window/localStorage jika query kosong
  if (keys.length === 0 && currentUid && typeof window !== 'undefined') {
    if (window.profileUserApiKeysOwner === currentUid && Array.isArray(window.profileUserApiKeys) && window.profileUserApiKeys.length > 0) {
      keys = [...window.profileUserApiKeys];
    } else if (window.userGeminiKeysOwner === currentUid && Array.isArray(window.userApiKeys) && window.userApiKeys.length > 0) {
      keys = [...window.userApiKeys];
    } else if (window.userGeminiKeysOwner === currentUid && Array.isArray(window.userApiKeysWali) && window.userApiKeysWali.length > 0) {
      keys = [...window.userApiKeysWali];
    } else if (window.userGeminiKeysOwner === currentUid && Array.isArray(window.userApiKeysRapor) && window.userApiKeysRapor.length > 0) {
      keys = [...window.userApiKeysRapor];
    } else {
      const localKey = currentUid && localStorage.getItem('user_gemini_key_uid') === currentUid
        ? (localStorage.getItem('user_gemini_key') || localStorage.getItem('user_gemini_api_key')) : '';
      if (localKey && localKey.trim()) {
        keys = [localKey.trim()];
      }
    }
  }

  return keys;
}

/**
 * SSOT Helper: Eksekusi request Gemini dengan Otomatis Fallback Multi-Key
 * Melakukan perulangan otomatis melintasi seluruh daftar API Key (Key 1 -> Key 2 -> Key 3 -> ...)
 * Jika satu key gagal (kuota habis/429/400/network error), otomatis beralih ke key berikutnya.
 */
export async function fetchGeminiWithFallback(requestFn, options = {}) {
  let keys = options.keys || [];
  if (keys.length === 0) {
    keys = await getUserGeminiApiKeysAsync(options.uid);
  }

  // Tambahkan input manual jika ada
  if (options.manualKey && !keys.includes(options.manualKey)) {
    keys.unshift(options.manualKey);
  }

  let lastError = null;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      const res = await requestFn(key, i);
      if (res && res.ok) {
        return {
          response: res,
          keyUsed: key,
          keyIndex: i,
          keyLabel: `Key ${i + 1} (${key.substring(0, 4)}...${key.substring(key.length - 4)})`
        };
      } else if (res) {
        let errBody = null;
        try { errBody = await res.clone().json(); } catch (_) {}
        const errorMsg = errBody?.error?.message || `HTTP ${res.status}`;
        console.warn(`[Gemini Fallback] Key ${i + 1} gagal (${errorMsg}), mencoba key berikutnya...`);
        lastError = new Error(errorMsg);
        lastError.status = res.status;
        const retryAfter = res.headers?.get('retry-after');
        lastError.retryAfterMs = retryAfter ? (Number(retryAfter) * 1000 || Math.max(0, Date.parse(retryAfter) - Date.now())) : 0;
      }
    } catch (e) {
      if (e.name === 'AbortError' || options.signal?.aborted) throw e;
      console.warn(`[Gemini Fallback] Key ${i + 1} network/runtime error:`, e.message);
      lastError = e;
    }
  }

  // Coba system key jika dikonfigurasi
  if (options.allowSystemKey && AI_CONFIG && AI_CONFIG.apiKey && !keys.includes(AI_CONFIG.apiKey)) {
    try {
      console.log("[Gemini Fallback] Mencoba System Key cadangan...");
      const res = await requestFn(AI_CONFIG.apiKey, -1);
      if (res && res.ok) {
        return {
          response: res,
          keyUsed: AI_CONFIG.apiKey,
          keyIndex: -1,
          keyLabel: 'System Key'
        };
      }
    } catch (e) {
      console.warn("[Gemini Fallback] System Key gagal:", e.message);
    }
  }

  throw lastError || new Error("Semua Google Gemini API Key gagal atau kehabisan kuota.");
}

/**
 * SSOT Helper: Menghitung Metrik Klasikal Rombel untuk Komparasi Siswa (0 Firestore / Supabase Read)
 * Menerima daftar siswa kelas, agregat, dan rekap presensi yang sudah aktif di cache.
 */
export function computeClassicalMetrics({ students = [], aggregates = {}, attendanceRekap = [], targetNis = '', targetAlpha: inputTargetAlpha } = {}) {
  const totalStudents = Array.isArray(students) ? students.length : 0;
  if (totalStudents === 0) {
    return null;
  }

  const strTargetNis = String(targetNis || '').trim();

  // 1. Agregat Kedisiplinan & Poin Rombel
  let sumPoints = 0;
  let zeroViolationCount = 0;
  let targetStudentPoints = 0;
  let targetStudentPrestasi = 0;
  let classTotalPrestasi = 0;

  const aggMap = new Map();
  if (Array.isArray(aggregates)) {
    aggregates.forEach(agg => {
      const k = String(agg.nis || agg.id || '').trim();
      if (k) aggMap.set(k, agg);
    });
  } else if (aggregates && typeof aggregates === 'object') {
    Object.entries(aggregates).forEach(([k, val]) => {
      const cleanKey = String(k || '').trim();
      if (cleanKey) aggMap.set(cleanKey, val);
    });
  }

  students.forEach(s => {
    const sNis = String(s.nis || s.id || '').trim();
    const sAgg = aggMap.get(sNis) || {};
    const pts = Number(sAgg.totalPoints ?? sAgg.poinPelanggaran ?? sAgg.points ?? sAgg.poin ?? 0) || 0;
    const pres = Number(sAgg.totalPrestasi ?? sAgg.prestasiCount ?? sAgg.prestasi ?? 0) || 0;

    sumPoints += pts;
    if (pts === 0) zeroViolationCount++;
    classTotalPrestasi += pres;

    if (strTargetNis && sNis === strTargetNis) {
      targetStudentPoints = pts;
      targetStudentPrestasi = pres;
    }
  });

  const classAvgPoints = totalStudents > 0 ? (sumPoints / totalStudents).toFixed(1) : '0.0';
  const classZeroViolationPct = totalStudents > 0 ? Math.round((zeroViolationCount / totalStudents) * 100) : 100;

  // 2. Kehadiran Rombel (% Kehadiran Relatif)
  let classTotalHadir = 0;
  let classTotalAbsen = 0; // S + I + A
  let targetHadir = 0;
  let targetAbsen = 0;
  let targetAlpha = (inputTargetAlpha !== undefined) ? Number(inputTargetAlpha) : 0;
  let hasAttendanceData = false;

  // Prioritas: attendanceRekap (array rekap H, S, I, A, D)
  if (Array.isArray(attendanceRekap) && attendanceRekap.length > 0) {
    hasAttendanceData = true;
    attendanceRekap.forEach(r => {
      const rNis = String(r.nis || r.student_nis || '').trim();
      const hVal = Number(r.H || 0);
      const sVal = Number(r.S || 0);
      const iVal = Number(r.I || 0);
      const aVal = Number(r.A || 0);
      classTotalHadir += hVal;
      classTotalAbsen += (sVal + iVal + aVal);
      if (strTargetNis && rNis === strTargetNis) {
        targetHadir = hVal;
        targetAbsen = sVal + iVal + aVal;
        if (inputTargetAlpha === undefined) {
          targetAlpha = aVal;
        }
      }
    });
  } else {
    // Fallback dari aggregates
    students.forEach(st => {
      const sNis = String(st.nis || st.id || '').trim();
      const sAgg = aggMap.get(sNis) || {};
      const att = sAgg.attendance || {};
      const hVal = Number(sAgg.hadir ?? att.H ?? att.hadir ?? 0);
      const sVal = Number(sAgg.sakit ?? att.S ?? att.sakit ?? 0);
      const iVal = Number(sAgg.izin ?? att.I ?? att.izin ?? 0);
      const aVal = Number(sAgg.alpa ?? sAgg.alpha ?? att.A ?? att.alpa ?? 0);
      if (hVal > 0 || sVal > 0 || iVal > 0 || aVal > 0) {
        hasAttendanceData = true;
        classTotalHadir += hVal;
        classTotalAbsen += (sVal + iVal + aVal);
        if (strTargetNis && sNis === strTargetNis) {
          targetHadir = hVal;
          targetAbsen = sVal + iVal + aVal;
          if (inputTargetAlpha === undefined) {
            targetAlpha = aVal;
          }
        }
      }
    });
  }

  let classAvgAttendancePct = 95; // default wajar jika data presensi belum direkap
  let studentAttendancePct = 100;
  if (hasAttendanceData && (classTotalHadir + classTotalAbsen) > 0) {
    classAvgAttendancePct = Math.round((classTotalHadir / (classTotalHadir + classTotalAbsen)) * 100);
    const targetTotal = targetHadir + targetAbsen;
    if (targetTotal > 0) {
      studentAttendancePct = Math.round((targetHadir / targetTotal) * 100);
    }
  }

  // 3. Label Komparatif Kualitatif (Aman & Edukatif)
  let attendanceComparison = 'Konsisten dan setara dengan ritme kehadiran kelas';
  if (targetAlpha > 0) {
    attendanceComparison = `Tercatat memiliki ketidakhadiran tanpa keterangan (${targetAlpha} hari alpha), sehingga kedisiplinan kehadiran berada di bawah rata-rata rombel`;
  } else if (studentAttendancePct >= 98 || (hasAttendanceData && studentAttendancePct > classAvgAttendancePct + 3)) {
    attendanceComparison = 'Sangat prima dan melampaui rata-rata kehadiran rombel (bebas catatan alpa)';
  } else if (hasAttendanceData && studentAttendancePct < classAvgAttendancePct - 5) {
    attendanceComparison = 'Berada di bawah rata-rata rombel sehingga memerlukan dorongan peningkatan kehadiran';
  }

  let disciplineComparison = 'Mempertahankan integritas dan kedisiplinan yang baik';
  if (targetStudentPoints === 0) {
    disciplineComparison = 'Termasuk kelompok siswa teladan yang bersih dari catatan pelanggaran';
  } else if (targetStudentPoints <= Number(classAvgPoints)) {
    disciplineComparison = 'Kedisiplinan tergolong baik dan di bawah rata-rata poin pelanggaran rombel';
  } else {
    disciplineComparison = 'Memiliki catatan kedisiplinan yang memerlukan perhatian dan pembinaan intensif';
  }

  let achievementComparison = 'Menunjukkan antusiasme belajar yang positif';
  if (targetStudentPrestasi > 0) {
    achievementComparison = `Aktif berprestasi dan membanggakan kelas dengan ${targetStudentPrestasi} pencapaian tercatat`;
  }

  return {
    totalStudents,
    classAvgAttendancePct,
    studentAttendancePct,
    studentAlphaCount: targetAlpha,
    attendanceComparison,
    classAvgPoints,
    classZeroViolationPct,
    disciplineComparison,
    classTotalPrestasi,
    studentPrestasiCount: targetStudentPrestasi,
    achievementComparison
  };
}

/**
 * SSOT Helper: Mengekstrak nama panggilan/akrab siswa dengan cerdas,
 * mempertimbangkan struktur nama khas Bali (awalan gender I/Ni, urutan lahir, gelar kasta).
 * Mencegah pemenggalan keliru yang hanya menghasilkan kata 'I' atau 'Ni'.
 * @param {string} fullName Nama lengkap siswa
 * @returns {string}
 */
export function extractFriendlyStudentName(fullName) {
  if (!fullName || typeof fullName !== 'string') return 'Siswa';
  const clean = fullName.trim();
  const words = clean.split(/\s+/);
  if (words.length <= 1) return clean;

  const prefixTitles = new Set([
    'i', 'ni', 'luh', 'putu', 'wayan', 'gede', 'made', 'kadek', 'nengah',
    'nyoman', 'komang', 'ketut', 'ida', 'bagus', 'ayu', 'dayu', 'anak',
    'agung', 'cokorda', 'tjokorda', 'gusti', 'dewa', 'desak', 'sang', 'sayu',
    'ngurah', 'istri'
  ]);

  // Cari indeks kata pertama yang merupakan nama diri (bukan prefix/gelar/urutan kelahiran)
  let personalIndex = -1;
  for (let i = 0; i < words.length; i++) {
    const lower = words[i].toLowerCase().replace(/[^a-z]/g, '');
    if (!prefixTitles.has(lower)) {
      personalIndex = i;
      break;
    }
  }

  // Jika nama diri ditemukan (contoh: "Wahyu" dari "I Gede Wahyu Arta")
  if (personalIndex !== -1) {
    return words[personalIndex];
  }

  // Jika seluruh kata adalah prefix/urutan lahir (contoh: "I Putu", "Ni Made")
  // Jangan sekali-kali mengambil hanya "I" atau "Ni". Ambil kata kedua ("Putu" / "Made")
  if (words.length >= 2) {
    const firstLower = words[0].toLowerCase().replace(/[^a-z]/g, '');
    if (firstLower === 'i' || firstLower === 'ni') {
      return words[1];
    }
  }

  return words[0];
}

/**
 * SSOT Helper: Build Prompt for AI Catatan Wali Kelas (Rapor)
 * Used by both page-students.js and page-wali-kelas.js
 */
export function buildRaporNotePrompt(data) {
  const studentName = (data.studentName || 'Siswa').trim();
  const studentClass = data.studentClass || 'SMA';
  const yearVal = data.yearVal || '2026/2027';
  const semVal = String(data.semVal || '1');
  let semLabel = 'Ganjil (Semester 1)';
  if (semVal === '2' || semVal === 'Genap') {
    semLabel = 'Genap (Semester 2)';
  } else if (semVal === 'TA' || semVal === 'FULL' || semVal === 'ALL' || semVal === 'CURRENT_AY' || semVal.includes('&')) {
    semLabel = '1 Tahun Penuh (Semester 1 & 2)';
  }

  const poin = data.poin || 0;
  const alpha = Number(data.alpha || 0);
  const sakit = data.sakit || 0;
  const izin = data.izin || 0;
  const dispen = data.dispen || 0;
  const prestasi = data.prestasi || 0;
  const permisi = data.permisi || 0;
  const totalHadir = data.totalHadir || 0;
  const gender = (data.gender || data.jenis_kelamin || '').toString().toUpperCase();
  const genderLabel = gender.startsWith('L') ? 'Laki-laki' : (gender.startsWith('P') ? 'Perempuan' : '');

  // Panggilan akrab / nama depan dengan penanganan budaya Bali
  const studentNickName = data.studentNickName || extractFriendlyStudentName(studentName);

  // Context situasional sesuai tingkat kelas & semester
  const gradeLevel = studentClass.startsWith('XII') ? 'XII' : studentClass.startsWith('XI') ? 'XI' : 'X';
  const isFullYear = semVal === 'TA' || semVal === 'FULL' || semVal === 'ALL' || semVal === 'CURRENT_AY' || semVal.includes('&');
  let situationalContext = '';

  if (isFullYear) {
    if (gradeLevel === 'XII') {
      situationalContext = 'Evaluasi ini mencakup 1 TAHUN AJARAN PENUH di kelas XII (kelulusan). Berikan apresiasi perjalanan belajar siswa, konsistensi karakter selama satu tahun, serta motivasi untuk melangkah ke jenjang pendidikan tinggi atau dunia kerja.';
    } else if (gradeLevel === 'XI') {
      situationalContext = 'Evaluasi ini mencakup 1 TAHUN AJARAN PENUH di kelas XI (persiapan naik ke kelas XII). Berikan apresiasi perkembangan sikap, ketekunan belajar selama satu tahun, dan motivasi menghadapi tahun akhir.';
    } else {
      situationalContext = 'Evaluasi ini mencakup 1 TAHUN AJARAN PENUH di kelas X (tuntas masa adaptasi SMA menuju kelas XI). Berikan apresiasi adaptasi dan perkembangan karakter selama satu tahun pertama di SMA.';
    }
  } else if (gradeLevel === 'XII' && (semVal === '2' || semVal === 'Genap')) {
    situationalContext = 'Siswa ini berada di kelas XII dan akan segera menyelesaikan pendidikan di sekolah ini. Berikan catatan yang bersifat menguatkan, memotivasi untuk masa depan (kuliah/karir), serta mengapresiasi perjalanan belajar selama di sekolah.';
  } else if (gradeLevel === 'XII') {
    situationalContext = 'Siswa ini berada di kelas XII semester ganjil, sedang mempersiapkan diri menuju semester akhir. Dorong semangat belajar dan persiapan ujian akhir.';
  } else if (gradeLevel === 'XI') {
    situationalContext = 'Siswa ini berada di kelas XI yang merupakan masa krusial pendalaman materi. Dorong konsistensi belajar dan pengembangan minat/bakat.';
  } else {
    situationalContext = 'Siswa ini berada di kelas X yang merupakan masa adaptasi awal di SMA. Berikan dorongan untuk beradaptasi, aktif berorganisasi, dan membangun fondasi belajar yang kuat.';
  }

  // Records breakdown
  const studentRecords = Array.isArray(data.records) ? data.records : [];
  const studentAttendance = Array.isArray(data.attendance) ? data.attendance : [];

  // A. Violation Details
  const vioRecords = studentRecords.filter(r => r.type === 'violation' || r.type === 'pelanggaran' || r.category === 'Pelanggaran' || r.category === 'pelanggaran');
  const violationList = vioRecords.map(r => `- ${r.desc || r.violationName || r.title || r.name || 'Pelanggaran'} (${r.points || r.point || 0} Poin)`).join('\n') || "Tidak ada catatan pelanggaran (Disiplin baik).";

  // B. Achievement Details
  const achRecords = studentRecords.filter(r => r.type === 'achievement' || r.type === 'prestasi' || r.category === 'Prestasi' || r.category === 'prestasi');
  const achievementList = achRecords.map(r => `- ${r.desc || r.achievementName || r.title || r.name || 'Prestasi'} (${r.notes || r.content || ''})`).join('\n') || "Tidak ada data prestasi tercatat.";

  // C. Attendance Reason Details (S/I/D)
  const attList = studentAttendance.filter(a => ['S', 'I', 'D'].includes(a.status));
  const attendanceNotes = attList.map(a => `${a.status}: ${a.note || 'Tanpa Keterangan'}`);
  const attendanceDetail = attendanceNotes.length > 0 ? attendanceNotes.join(', ') : `Sakit: ${sakit} hari, Izin: ${izin} hari, Dispensasi: ${dispen} hari.`;

  // D. Permission (Leaving Early) Details
  const permRecords = studentRecords.filter(r => r.type === 'permission' || r.type === 'permisi' || r.category === 'Permisi' || r.category === 'permisi');
  const permissionList = permRecords.map(r => `${r.permissionType || r.title || 'Izin Keluar'}: ${r.notes || r.content || ''}`).join(', ') || (permisi > 0 ? `${permisi} kali izin keluar.` : "Nihil.");

  // E. Riwayat Pembinaan & Konseling (BK, Guru Wali, Wali Kelas)
  const pembinaanList = Array.isArray(data.pembinaan) ? data.pembinaan : (Array.isArray(data.pembinaanList) ? data.pembinaanList : []);
  const pembinaanLines = pembinaanList.map(p => {
    const roleLabel = p.role || p.sourceLabel || (p.source === 'bk' ? 'Guru BK' : 'Guru Wali / Wali Kelas');
    const category = p.category || p.serviceType || 'Pembinaan';
    const notesText = p.notes || p.content || p.desc || '';
    const followUpText = p.followUp || p.follow_up ? ` (Tindak lanjut: ${p.followUp || p.follow_up})` : '';
    return `- [${roleLabel}] ${category}: ${notesText}${followUpText}`;
  });
  const pembinaanDetail = pembinaanLines.length > 0 ? pembinaanLines.join('\n') : "Tidak ada catatan pembinaan khusus (Karakter & perilaku mandiri baik).";

  // F. Konteks Komparatif Klasikal (Rombel)
  const classContext = data.classContext || null;
  let classicalSection = '';
  if (classContext && classContext.totalStudents > 0) {
    classicalSection = `
        KONTEKS KOMPARATIF KELAS (KLASIKAL):
        - Jumlah Siswa Kelas: ${classContext.totalStudents} siswa di kelas ${studentClass}
        - Posisi Kehadiran: ${classContext.attendanceComparison} (Persentase kehadiran siswa ~${classContext.studentAttendancePct}%, rata-rata rombel ~${classContext.classAvgAttendancePct}%)
        - Posisi Kedisiplinan: ${classContext.disciplineComparison} (Rata-rata poin kelas: ${classContext.classAvgPoints} poin, ${classContext.classZeroViolationPct}% siswa di kelas bebas pelanggaran)
        - Kontribusi Prestasi: ${classContext.achievementComparison}
        
        PANDUAN PEMANFAATAN KONTEKS KLASIKAL:
        - Gunakan konteks komparatif di atas sebagai wawasan agar narasi catatan wali kelas bersifat adil, proporsional, dan tepat sasaran.
        - Dasar menyatakan rajin atau tidak WAJIB berlandaskan pada data riil dan data klasikal rombel di atas.
        - Jika siswa memiliki catatan Alpha (${alpha} hari), status kehadiran siswa TIDAK BOLEH dipuji atau dianggap teladan. Wajib berikan catatan evaluatif yang mendorong perbaikan kehadiran.
        - Jika siswa menonjol dalam kedisiplinan atau kehadiran di atas rata-rata rombel (dan bebas catatan alpa), berikan apresiasi atas keteladanannya di tengah teman sekelas.
        - Jika siswa berada di bawah rata-rata rombel (misal ada keterlambatan/alpa), sampaikan motivasi suportif dan empati yang mendorongnya menyelaraskan ritme belajar bersama kelas.
        - DILARANG KERAS MENYEBUT ANGKA STATISTIK EKSPLISIT seperti "kehadiran Anda 98% dibandingkan rata-rata kelas 92%". Terjemahkan data ini menjadi bahasa manusiawi yang mengalir alami.`;
  }

  return `Buat catatan perkembangan karakter & motivasi belajar rapor narasi (MAKSIMAL 50 KATA, 2-3 kalimat padat, mengalir alami, hangat, dan personal) untuk siswa bernama ${studentName}${genderLabel ? ` (${genderLabel})` : ''}.
        
        KONTEKS KELAS & SEMESTER:
        - Kelas: ${studentClass} (Tingkat ${gradeLevel})
        - Periode: Tahun Ajaran ${yearVal} - ${semLabel}
        - Panggilan Akrab/Nama Diri: ${studentNickName}
        - ${situationalContext}
        ${classicalSection}
        
        DATA DETAIL SISWA:
        1. Total Poin Pelanggaran: ${poin}
           Detail Pelanggaran:
           ${violationList}
           (JANGAN sebut angka total poin, tapi analisislah jenis pelanggarannya jika ada).
        2. Riwayat Prestasi: 
           ${achievementList}
        3. Riwayat Absensi (Sakit/Izin/Dispen): 
           ${attendanceDetail}${totalHadir > 0 ? ` (Total Hadir: ${totalHadir} hari)` : ''}
        4. Riwayat Permisi (Meninggalkan Sekolah Sebelum Waktu): 
           ${permissionList}
        5. Total Alpha (Tanpa Keterangan): ${alpha} (JANGAN sebut angka, jika ada alpa WAJIB singgung pentingnya kehadiran dan DILARANG memuji kehadiran).
        6. Riwayat Pembinaan & Konseling (BK, Wali Kelas, Guru Wali):
           ${pembinaanDetail}
        
        ATURAN STRUKTUR & LARANGAN KERAS:
        - BATAS PANJANG KETAT: Panjang catatan MAKSIMAL 50 KATA (sekitar 250-350 karakter) dan MAKSIMAL 2-3 kalimat pendek. DILARANG KERAS menulis lebih dari 50 kata agar pas dan proporsional di lembar cetak rapor.
        - DILARANG KERAS MEMAKAI FRASA PEMBUKA FORMAL/KAKU SEPERTI "Selaku Wali Kelas...", "Sebagai Wali Kelas...", "Berdasarkan catatan...", "Dalam semester ini...".
        - ATURAN KETAT KEHADIRAN & ALPHA:
          * JIKA SISWA MEMILIKI ALPHA (${alpha} > 0), DILARANG KERAS MEMUJI KEHADIRAN! JANGAN SEKALI-KALI menggunakan kata "kehadiran prima", "sangat rajin", "tekun hadir di kelas", "kehadiran memuaskan", atau frasa pujian kehadiran serupa. Siswa memiliki catatan Alpha (absen tanpa keterangan)!
          * Wajib berikan catatan evaluatif yang konstruktif dan memotivasi agar siswa tidak mengulangi alpa dan lebih disiplin hadir di kelas.
          * Dasar menyatakan kerajinan kehadiran WAJIB berlandaskan pada data riil presensi dan posisi klasikal rombel.
        - ATURAN NAMA & SAPAAN (KONTEKS BALI):
          * DILARANG KERAS memenggal nama atau menyapa siswa hanya dengan awalan gender 'I' atau 'Ni' (Contoh TERLARANG: "I, kehadiranmu...", "Ni, prestasimu...").
          * Gunakan nama panggilan diri yang wajar (${studentNickName}) atau sebutkan nama lengkap siswa (${studentName}).
        - LANGSUNG MULAI KALIMAT PERTAMA DENGAN NAMA SISWA ATAU APRESIASI LANGSUNG:
          * Jika tanpa catatan alpha & disiplin: "${studentName} menunjukkan kedisiplinan belajar yang sangat baik..." atau "Apresiasi atas ketekunan ${studentNickName} dalam...".
          * Jika memiliki catatan alpa / pelanggaran: "${studentName} memiliki potensi belajar yang baik, namun kedisiplinan kehadiran perlu ditingkatkan kembali dengan menghindari ketidakhadiran tanpa keterangan...".
        - TULIS SINGKAT, PADAT, HANGAT, DAN MEMBERIKAN MOTIVASI.
        - Jika ada PRESTASI, singgung pencapaian tersebut secara positif.
        - Jika ada SAKIT/IZIN, berikan dorongan empati singkat.
        - Jika ada RIWAYAT PEMBINAAN, jadikan konteks untuk mengapresiasi perubahan/perkembangan sikap positif siswa atau menguatkan komitmen hasil bimbingan bersama guru pembina/BK tanpa membuka aib siswa.
        - SESUAIKAN NADA DAN PESAN dengan konteks kelas dan semester siswa.
        - HINDARI MENYEBUT ANGKA EKSPLISIT.
        - Gabungkan menjadi satu paragraf pendek (2-3 kalimat, MAKSIMAL 50 KATA).`;
}

if (typeof window !== 'undefined') {
  window.computeClassicalMetrics = computeClassicalMetrics;
  window.extractFriendlyStudentName = extractFriendlyStudentName;
  window.buildRaporNotePrompt = buildRaporNotePrompt;
}

// =========================================================================
// --- SSOT HELPER KEUANGAN SPP / IURAN KOMITE ---
// =========================================================================

export const SYSTEM_START_DATE_SPP = new Date(2026, 6, 1); // 1 Juli 2026

/**
 * Menghitung tahun angkatan (cohort) masuk dan tahun kelulusan siswa berdasarkan nama kelas.
 * @param {string} className 
 * @returns {{ startYear: number, endYear: number }}
 */
export function calculateCohort(className) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const academicYearStart = currentMonth >= 6 ? currentYear : currentYear - 1;

  if (!className) return { startYear: currentYear - 3, endYear: currentYear - 1 };

  // Jika kelas alumni, parse tahun dari format nama kelas "Alumni XII ... (2025/2026)"
  if (className.toLowerCase().includes('alumni')) {
    const match = className.match(/(\d{4})\/(\d{4})/);
    if (match) {
      const endAcademicYear = parseInt(match[2], 10);
      const startYear = endAcademicYear - 3;
      const endYear = startYear + 2;
      return { startYear, endYear };
    }
    return { startYear: currentYear - 3, endYear: currentYear - 1 };
  }

  let offset = 0;
  if (className.startsWith("XII")) offset = 2;
  else if (className.startsWith("XI")) offset = 1;
  else offset = 0;

  const startYear = academicYearStart - offset;
  const endYear = startYear + 2; // 3 tahun masa studi aktif: startYear (X), startYear+1 (XI), startYear+2 (XII)
  return { startYear, endYear };
}

/**
 * Menentukan tarif iuran SPP siswa per bulan berdasarkan tingkat kelas dan konfigurasi tarif.
 * @param {Object} student 
 * @param {Object} ratesConfig 
 * @param {number} y Tahun
 * @param {number} m Bulan (1-12)
 * @returns {number}
 */
export function getRateForStudent(student, ratesConfig, y, m) {
  const className = typeof student === 'string' ? student : (student?.class || student?.kelas || student?.student_class);
  if (!student || !className) return 0;
  const cohort = calculateCohort(className);

  // Ajaran baru dimulai bulan Juli (7)
  const academicYearOfPeriod = (m >= 7) ? y : y - 1;
  const diff = academicYearOfPeriod - cohort.startYear;

  let targetGrade = "X";
  if (diff === 1) targetGrade = "XI";
  else if (diff === 2) targetGrade = "XII";

  const cohortYearStr = String(cohort.startYear);

  if (ratesConfig && ratesConfig.cohorts && ratesConfig.cohorts[cohortYearStr]) {
    const cohortObj = ratesConfig.cohorts[cohortYearStr];
    if (cohortObj[targetGrade] !== undefined) {
      return cohortObj[targetGrade];
    }
    const availableRates = Object.values(cohortObj).filter(v => typeof v === 'number');
    if (availableRates.length > 0) {
      return availableRates[0];
    }
  }

  return (ratesConfig && ratesConfig[targetGrade]) || (targetGrade === 'X' ? 70000 : 65000);
}

/**
 * Menghitung rincian tunggakan SPP siswa (SSOT).
 * @param {Object|string} student Objek siswa (harus memuat class, kelas, atau student_class) atau nama kelas
 * @param {Object} paymentHistory Map riwayat pembayaran {'YYYY-M': { amount, type }}
 * @param {Object} ratesConfig Objek tarif iuran komite
 * @param {number} dueDate Tanggal jatuh tempo per bulan (default 20)
 * @param {Date} systemStartDate Batas tanggal awal berlakunya sistem (default 1 Juli 2026)
 * @returns {{ unpaidCount: number, totalNominal: number, unpaidMonths: string[] }}
 */
export function calculateStudentTunggakan(student, paymentHistory = {}, ratesConfig = null, dueDate = null, systemStartDate = null) {
  const className = typeof student === 'string' ? student : (student?.class || student?.kelas || student?.student_class);
  if (!student || !className) return { unpaidCount: 0, totalNominal: 0, unpaidMonths: [] };

  const monthNamesIndo = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  const actualDueDate = dueDate || 20;
  const actualSystemStartDate = systemStartDate || SYSTEM_START_DATE_SPP;
  const cohort = calculateCohort(className);
  const now = new Date();

  let unpaidCount = 0;
  let totalNominal = 0;
  let unpaidMonths = [];

  let currY = cohort.startYear;
  let currM = 7; // Mulai Juli angkatan masuk

  // Batasi agar tidak mengecek melebihi masa studi aktif (Juni di tahun kelulusan)
  const maxY = cohort.endYear + 1;
  const maxM = 6;
  let limitY = now.getFullYear();
  let limitM = now.getMonth() + 1;

  if (limitY > maxY || (limitY === maxY && limitM > maxM)) {
    limitY = maxY;
    limitM = maxM;
  }

  while (currY < limitY || (currY === limitY && currM <= limitM)) {
    const itemDate = new Date(currY, currM - 1, actualDueDate);
    const key = `${currY}-${currM}`;
    const record = paymentHistory ? paymentHistory[key] : null;

    let isPaid = false;
    if (record) {
      if (record.type === 'manual_debt') {
        isPaid = false;
      } else {
        isPaid = true;
      }
    } else {
      if (itemDate < actualSystemStartDate) {
        isPaid = true; // Lunas migrasi awal sebelum sistem beroperasi
      } else {
        isPaid = false;
      }
    }

    const isDue = itemDate < now;

    if (isDue && !isPaid) {
      unpaidCount++;
      const rate = getRateForStudent(student, ratesConfig, currY, currM);
      totalNominal += rate;
      unpaidMonths.push(`${monthNamesIndo[currM]} ${currY}`);
    }

    currM++;
    if (currM > 12) {
      currM = 1;
      currY++;
    }
  }

  return {
    unpaidCount,
    totalNominal,
    unpaidMonths
  };
}

if (typeof window !== 'undefined') {
  window.SYSTEM_START_DATE_SPP = SYSTEM_START_DATE_SPP;
  window.calculateCohort = calculateCohort;
  window.getRateForStudent = getRateForStudent;
  window.calculateStudentTunggakan = calculateStudentTunggakan;
}

export const APP_VERSION = "26.11.02.4";

// --- GOOGLE ANALYTICS (GA4) INJECTION ---
(function () {
  const GA_ID = "";
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // Menyiapkan stub queue gtag sejak awal agar pemanggilan di modul lain tidak pernah error
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;

  // Sekolah tanpa properti Analytics tetap memakai stub yang sama, tanpa memuat GA.
  if (!GA_ID) return;

  const host = window.location.hostname || '';
  const isLocalOrDev = (
    !host ||
    window.location.protocol === 'file:' ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
    host === '0.0.0.0'
  );

  if (isLocalOrDev) {
    console.log('[Analytics] GA4 Skipped on Local/Dev Environment:', host || 'file:');
    return;
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    console.log('[Analytics] GA4 Skipped (Offline)');
    return;
  }

  // Cek duplikasi
  if (document.querySelector(`script[src*="${GA_ID}"]`)) return;

  // Inject Script
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  script.onerror = function () {
    console.debug('[Analytics] GA4 resource unavailable or blocked by privacy filter/DNS.');
  };
  (document.head || document.documentElement).appendChild(script);

  // Init Config
  gtag('js', new Date());
  gtag('config', GA_ID);
  console.log('[Analytics] GA4 Initialized:', GA_ID);
})();
