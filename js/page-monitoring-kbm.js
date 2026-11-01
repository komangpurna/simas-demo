import { auth, supabase, resolvePhotoUrl } from "./config.js";
import { cfClient } from "./cloudflare-client.js";
import { initLayout, showToast, escapeHTML } from "./global.js";
import { getScheduleForClassAndDate, normalizeTeacherName, getAllScheduleTeachers } from "./asc-schedule-parser.js";
import { parseJpList, formatJpDisplay, getJurnalDateStr, findMatchingClassKey } from "./utils.mjs";
import { fetchRegisteredHolidays, upsertSchoolHoliday, deleteSchoolHoliday, isRegisteredHoliday, getRegisteredHoliday, bootstrapSyncAgendaHolidays } from "./holiday-manager.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// Helper: Safely parse Firestore Timestamp, Date, or JSON serialized timestamp
function parseFirestoreDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  if (ts instanceof Date) return ts;
  if (typeof ts.seconds === "number") return new Date(ts.seconds * 1000);
  if (typeof ts === "string" || typeof ts === "number") {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// === STATUS COLORS ===
const STATUS_COLORS = {
  H: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800",
  K: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border border-purple-200 dark:border-purple-800",
  S: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800",
  I: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800",
  L: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800",
  A: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800",
  TT: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800",
  TK: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800",
  TE: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600",
  D: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  T: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

const STATUS_SHORT = { H: "H", S: "S", I: "I", A: "A", D: "D", T: "T" };

// === STATE ===
let currentUserInfo = null;
let hasFullAccessRole = false;
let isRestrictedToTeacherAssignments = false;
let isWaliKelas = false;
let waliKelasClass = "";
let kbmScopeMode = "all";
let raporConfig = null;
let studentsCache = {}; // Cache per kelas: { 'X-1': [{...}] }
let rekapGuruData = {};
const GURU_CACHE_KEY = "simas_guru_list_cache";
const GURU_CACHE_TTL = 30 * 60 * 60 * 1000;

// === CACHE HEMAT KUOTA FIRESTORE (PERSISTEN SESSION) ===
const KBM_SESSION_CACHE_KEY = "simas_kbm_monitoring_cache_v1";

// Memory & Session cache untuk data Firestore yang sudah di-query
const _cache = {
  // Cache jurnal_guru per monthKey ("YYYY_MM"): { data: [...docs], ts: Date.now() }
  jurnalByMonth: {},
  // Cache guru_presensi per key ("kelas_year_month"): { data: {...}, ts: Date.now() }
  guruPresensi: {},
  // Cache hasil fetchCrossVerifiedData per key ("dates_hash"): { matrix, ts }
  crossVerified: {},
  // Cache rekap kehadiran per filter key: { result, ts }
  rekapKehadiran: {},
};

function loadKbmSessionCache() {
  try {
    const raw = sessionStorage.getItem(KBM_SESSION_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (parsed.jurnalByMonth) Object.assign(_cache.jurnalByMonth, parsed.jurnalByMonth);
        if (parsed.guruPresensi) Object.assign(_cache.guruPresensi, parsed.guruPresensi);
        if (parsed.crossVerified) Object.assign(_cache.crossVerified, parsed.crossVerified);
        if (parsed.rekapKehadiran) Object.assign(_cache.rekapKehadiran, parsed.rekapKehadiran);
      }
    }
  } catch (e) {
    console.warn("[MonitoringKBM] Gagal memuat session cache:", e);
  }
}

function saveKbmSessionCache() {
  try {
    sessionStorage.setItem(KBM_SESSION_CACHE_KEY, JSON.stringify(_cache));
  } catch (e) {
    // QuotaExceededError handling: simpan hanya entri terbaru atau fallback ke memory
    try {
      sessionStorage.removeItem(KBM_SESSION_CACHE_KEY);
      // Simpan subset ringan (maksimal 2 bulan terakhir jurnal & crossVerified)
      const lightCache = {
        jurnalByMonth: {},
        guruPresensi: {},
        crossVerified: {},
        rekapKehadiran: {},
      };
      const monthKeys = Object.keys(_cache.jurnalByMonth || {}).slice(-2);
      monthKeys.forEach((mk) => {
        lightCache.jurnalByMonth[mk] = _cache.jurnalByMonth[mk];
      });
      const dateKeys = Object.keys(_cache.crossVerified || {}).slice(-7);
      dateKeys.forEach((dk) => {
        lightCache.crossVerified[dk] = _cache.crossVerified[dk];
      });
      sessionStorage.setItem(KBM_SESSION_CACHE_KEY, JSON.stringify(lightCache));
    } catch (innerErr) {
      // Jika masih melebihi quota, cukup gunakan in-memory cache
      try {
        sessionStorage.removeItem(KBM_SESSION_CACHE_KEY);
      } catch (cleanErr) {}
    }
  }
}

// Inisialisasi awal dari sessionStorage
loadKbmSessionCache();

// TTL cache berdasarkan konteks data
function getCacheTTL(dateStr) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  
  if (dateStr === todayStr) return 1 * 60 * 1000; // Hari ini: 1 menit
  if (dateStr && dateStr.startsWith(thisMonth)) return 10 * 60 * 1000; // Bulan ini: 10 menit
  return 60 * 60 * 1000; // Data lampau: 1 jam
}

function isCacheValid(cacheEntry, ttl) {
  return cacheEntry && cacheEntry.ts && (Date.now() - cacheEntry.ts < ttl);
}

// Force refresh flag — di-set true saat tombol Segarkan Data ditekan
let _forceRefresh = false;

// Fungsi global untuk force refresh
window.refreshKbmData = function () {
  _forceRefresh = true;
  // Clear all memory & session cache
  _cache.jurnalByMonth = {};
  _cache.guruPresensi = {};
  _cache.crossVerified = {};
  _cache.rekapKehadiran = {};
  try {
    sessionStorage.removeItem(KBM_SESSION_CACHE_KEY);
  } catch (e) {}

  // Animasi tombol refresh (spin icon)
  const btnIcon = document.querySelector("#btn-refresh-kbm i");
  if (btnIcon) btnIcon.classList.add("fa-spin");

  showToast("Memuat Ulang", "Mengambil data terbaru dari server...", "info");
  
  // Re-load tab yang sedang aktif
  const loadPromise = (async () => {
    if (typeof activeTab !== 'undefined') {
      if (activeTab === "kehadiran-siswa") {
        await window.loadRekapKehadiran();
      } else if (activeTab === "rekap-kbm") {
        await window.loadRekapJurnal();
      } else if (activeTab === "rekap-guru") {
        await window.loadRekapGuru();
      } else if (activeTab === "detail-guru") {
        await window.loadDetailGuru();
      }
    }
  })();

  loadPromise.then(() => {
    showToast("Berhasil", "Data berhasil disegarkan dari server.", "success");
    updateCacheIndicator(false);
  }).catch((err) => {
    console.error("Refresh error:", err);
  }).finally(() => {
    _forceRefresh = false;
    if (btnIcon) btnIcon.classList.remove("fa-spin");
  });
};

const FULL_ACCESS_ROLES = ["super_admin", "kepala_sekolah", "staff", "wakasek_kurikulum"];
const TEACHER_SCOPED_ROLES = ["guru_mapel", "wali_kelas", "kesiswaan", "guru_bk"];
const STUDENTS_CACHE_KEY = "simas_students_kehadiran_cache";
const RAPOR_CONFIG_CACHE_KEY = "simas_rapor_config_cache";

// === INIT ===
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href =
      "index.html?redirect=" + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
    return;
  }

  const cachedUserDoc = await window.getCurrentUserDoc();
  let role = localStorage.getItem("user_role");
  if (!role) {
    role = cachedUserDoc ? (cachedUserDoc.role || "") : "";
    localStorage.setItem("user_role", role);
  }

  // Access check
  const allowedRoles = [
    "super_admin",
    "kepala_sekolah",
    "wali_kelas",
    "guru_mapel",
    "guru_bk",
    "staff",
    "kesiswaan",
    "wakasek_kurikulum",
  ];
  const hasAccess = window.hasRole
    ? allowedRoles.some((r) => window.hasRole(r))
    : allowedRoles.includes(role);
  if (!hasAccess) {
    showToast(
      "Akses Ditolak",
      "Anda tidak memiliki akses ke halaman ini.",
      "error",
    );
    setTimeout(() => (window.location.href = "dashboard.html"), 1500);
    return;
  }

  // Cek apakah user dibatasi hanya ke mapel/kelas guru pengampu
  const allRoles = window.getAllUserRoles ? window.getAllUserRoles() : [role];
  hasFullAccessRole = allRoles.some((r) => FULL_ACCESS_ROLES.includes(r));
  isRestrictedToTeacherAssignments = !hasFullAccessRole;
  isWaliKelas = !hasFullAccessRole && allRoles.includes("wali_kelas");

  if (isWaliKelas) {
    waliKelasClass = cachedUserDoc
      ? (cachedUserDoc.assignedClass || localStorage.getItem("user_assigned_class") || "")
      : (localStorage.getItem("user_assigned_class") || "");
  }

  // Ambil info guru jika memang perlu dibatasi ke penugasan guru
  if (isRestrictedToTeacherAssignments) {
    try {
      if (cachedUserDoc) {
        const userData = cachedUserDoc;
        const linkedTeacherId = userData.linkedTeacherId;

        if (linkedTeacherId) {
          let teacherName = "";
          if (window.getTeachersCache) {
            try {
              const teachers = await window.getTeachersCache();
              const found = teachers.find(
                (t) => t.id === linkedTeacherId || t.nip === linkedTeacherId || t.nik === linkedTeacherId
              );
              if (found && (found.name || found.nama)) teacherName = found.name || found.nama;
            } catch (err) { }
          }
          if (teacherName) {
            currentUserInfo = {
              uid: user.uid,
              nama: teacherName,
              email: user.email,
            };
          } else {
            currentUserInfo = {
              uid: user.uid,
              nama:
                userData.name ||
                userData.nama ||
                user.displayName ||
                "Nama Tidak Ditemukan",
              email: user.email,
            };
          }
        } else {
          currentUserInfo = {
            uid: user.uid,
            nama:
              userData.name ||
              userData.nama ||
              user.displayName ||
              "Nama Tidak Ditemukan",
            email: user.email,
          };
        }
      } else {
        currentUserInfo = {
          uid: user.uid,
          nama: user.displayName || "Unknown",
          email: user.email,
        };
      }
    } catch (e) {
      console.error("Error getting user info:", e);
      currentUserInfo = {
        uid: user.uid,
        nama: user.displayName || "Unknown",
        email: user.email,
      };
    }
  }

  // Init layout
  const effectiveRole = window.getEffectiveRoleForPage
    ? window.getEffectiveRoleForPage("monitoring-kbm.html")
    : role;
  initLayout(effectiveRole);
  document.querySelector("main").classList.remove("hidden");

  // Set default bulan to current month
  const today = new Date();
  const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  document.getElementById("filter-bulan").value = monthStr;

  // Set default TA and Semester
  const currentMonth = today.getMonth() + 1; // 1-12
  const currentYear = today.getFullYear();
  let defaultTA = "";
  let defaultSemester = "1";

  if (currentMonth >= 7) {
    // Juli - Desember (Semester 1)
    defaultTA = `${currentYear}/${currentYear + 1}`;
    defaultSemester = "1";
  } else {
    // Januari - Juni (Semester 2)
    defaultTA = `${currentYear - 1}/${currentYear}`;
    defaultSemester = "2";
  }

  document.getElementById("filter-ta").value = defaultTA;
  document.getElementById("filter-semester").value = defaultSemester;

  // Load rapor config & populate filters
  await loadRaporConfig(user.uid);
  populateFilters();
  window.toggleFilterPeriode(); // update UI based on default type

  // Handle tab visibility and default active tab (Monitoring KBM)
  const subtabNav = document.getElementById("subtab-navigation-container");
  const tabKehadiran = document.getElementById("tab-kehadiran-siswa");
  const tabRekapKbm = document.getElementById("tab-rekap-kbm");
  const tabRekapGuru = document.getElementById("tab-rekap-guru");
  const tabDetailGuru = document.getElementById("tab-detail-guru");

  if (!hasFullAccessRole && !isWaliKelas) {
    // Peran Guru Mapel: Tampilkan subtab navigasi dengan 3 panel aktif (Monitoring KBM, Rekap Guru, & Detail Guru)
    if (subtabNav) subtabNav.classList.remove("hidden");
    if (tabKehadiran) tabKehadiran.classList.add("hidden");
    if (tabRekapGuru) tabRekapGuru.classList.remove("hidden");
    if (tabRekapKbm) tabRekapKbm.classList.remove("hidden");
    if (tabDetailGuru) tabDetailGuru.classList.remove("hidden");

    const urlHash = window.location.hash;
    if (urlHash && urlHash.startsWith("#tab=")) {
      const tTab = urlHash.split("=")[1];
      if (tTab === "detail-guru") {
        setTimeout(() => {
          window.switchTab("detail-guru");
        }, 50);
      } else {
        window.switchTab("rekap-kbm");
      }
    } else {
      // Default pembukaan halaman: Monitoring KBM
      window.switchTab("rekap-kbm");
    }
  } else {
    // Full Access (super_admin, kepala_sekolah, staff, wakasek_kurikulum) & Wali Kelas: Tampilkan seluruh subtab navigasi
    if (subtabNav) subtabNav.classList.remove("hidden");
    if (tabKehadiran) tabKehadiran.classList.remove("hidden");
    if (tabRekapGuru) tabRekapGuru.classList.remove("hidden");
    if (tabRekapKbm) tabRekapKbm.classList.remove("hidden");
    if (tabDetailGuru) tabDetailGuru.classList.remove("hidden");

    const urlHash = window.location.hash;
    if (urlHash && urlHash.startsWith("#tab=")) {
      const tTab = urlHash.split("=")[1];
      setTimeout(() => {
        window.switchTab(tTab);
      }, 50);
    } else {
      // Default pembukaan halaman: Monitoring KBM
      window.switchTab("rekap-kbm");
    }
  }

  // Tampilkan kontrol toggle mode KBM jika user teridentifikasi sebagai guru
  const toggleKbmContainer = document.getElementById("container-toggle-kbm-mode");
  if (toggleKbmContainer && (currentUserInfo?.nama || isRestrictedToTeacherAssignments)) {
    toggleKbmContainer.classList.remove("hidden");
  }

  // Sinkronisasi SSOT Master Hari Libur Sekolah (Agenda D1 & DataHolidays) di latar belakang
  try {
    bootstrapSyncAgendaHolidays().catch((err) => console.warn("[MonitoringKBM] Background sync hari libur:", err));
  } catch (e) {}
});

// === TOGGLE FILTER PERIODE ===
window.toggleFilterPeriode = function () {
  const tipe = document.getElementById("filter-tipe").value;
  const elBulan = document.getElementById("filter-bulan");
  const elSemester = document.getElementById("filter-semester");
  const elTA = document.getElementById("filter-ta");
  const bgContainer = document.getElementById("container-periode");
  const iconDate = document.getElementById("icon-periode");
  const iconChevron = document.getElementById("icon-chevron-periode");

  // Reset visibility
  elBulan.classList.add("hidden");
  elSemester.classList.add("hidden");
  iconChevron.classList.add("hidden");

  // Sesuaikan grid column di mobile jika tipe = semester (tampilan sama dengan mapel)
  if (tipe === "semester") {
    iconDate.className =
      "fa-solid fa-graduation-cap text-slate-400 dark:text-slate-500";

    elSemester.classList.remove("hidden");
    elSemester.classList.add("w-full");

    iconChevron.classList.remove("hidden");
  } else if (tipe === "tahun") {
    iconDate.className =
      "fa-solid fa-calendar-days text-slate-400 dark:text-slate-500";
  } else {
    iconDate.className =
      "fa-solid fa-calendar text-slate-400 dark:text-slate-500";
    elBulan.classList.remove("hidden");
  }
};

// === LOAD RAPOR CONFIG ===
async function loadRaporConfig(uid) {
  // Coba cache dulu
  const cached = window.getLocalCache
    ? window.getLocalCache(RAPOR_CONFIG_CACHE_KEY, 60 * 60 * 1000)
    : null;
  if (cached) {
    raporConfig = cached;
    console.log("📦 rapor_config loaded from cache");
    return;
  }

  try {
    if (cfClient && cfClient.enabled) {
      try {
        const configData = await cfClient.getRaporConfig();
        if (configData && configData.mapel_guru) {
          raporConfig = configData;
          if (window.setLocalCache)
            window.setLocalCache(RAPOR_CONFIG_CACHE_KEY, raporConfig);
          console.log("⚡ rapor_config loaded from Cloudflare D1 SSOT");
          return;
        }
      } catch (cfErr) {
        console.error("[MonitoringKBM] Gagal memuat rapor_config dari Cloudflare D1:", cfErr);
      }
    }
    raporConfig = { mapel_guru: {} };
  } catch (e) {
    console.error("Error loading rapor_config:", e);
    raporConfig = { mapel_guru: {} };
  }
}

// === POPULATE FILTERS ===
function populateFilters() {
  const selectMapel = document.getElementById("filter-mapel");
  const selectKelas = document.getElementById("filter-kelas");

  if (!raporConfig || !raporConfig.mapel_guru) return;

  const mapelGuru = raporConfig.mapel_guru;
  const masterMapelList = Array.isArray(raporConfig.mapel_list) ? raporConfig.mapel_list : [];
  const masterMapelSet = masterMapelList.length > 0 ? new Set(masterMapelList) : null;
  const mapelSet = new Set();
  const kelasSet = new Set();

  // Iterasi mapel_guru: { mapelName: [ {uid, nama, kelas: [...]} ] }
  Object.keys(mapelGuru).forEach((mapelName) => {
    // Filter SSOT: Abaikan mapel duplikat/legacy yang tidak terdaftar di master mapel_list
    if (masterMapelSet && !masterMapelSet.has(mapelName)) return;

    const guruArray = mapelGuru[mapelName];
    if (!Array.isArray(guruArray)) return;

    guruArray.forEach((guruObj) => {
      if (isWaliKelas && waliKelasClass) {
        // Wali Kelas: Tampilkan seluruh mapel yang diajarkan di kelas perwaliannya
        if (Array.isArray(guruObj.kelas) && guruObj.kelas.includes(waliKelasClass)) {
          mapelSet.add(mapelName);
          kelasSet.add(waliKelasClass);
        }
      } else if (isRestrictedToTeacherAssignments && currentUserInfo) {
        // Guru Mapel / Scoped Roles: Filter hanya mapel & kelas miliknya
        if (guruObj.uid === currentUserInfo.uid) {
          mapelSet.add(mapelName);
          if (Array.isArray(guruObj.kelas)) {
            guruObj.kelas.forEach((k) => kelasSet.add(k));
          }
        }
      } else {
        // Full Access: Semua mapel & kelas
        mapelSet.add(mapelName);
        if (Array.isArray(guruObj.kelas)) {
          guruObj.kelas.forEach((k) => kelasSet.add(k));
        }
      }
    });
  });

  // Sort natural
  const sortedMapel = [...mapelSet].sort((a, b) => a.localeCompare(b, "id"));
  const sortedKelas = [...kelasSet].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );

  // Populate Mapel
  let htmlMapel = '<option value="">-- Pilih Mapel --</option>';
  sortedMapel.forEach((m) => {
    htmlMapel += `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`;
  });
  selectMapel.innerHTML = htmlMapel;

  // Populate Kelas (Default state before Mapel is selected)
  let htmlKelas = '<option value="">-- Pilih Kelas --</option>';
  sortedKelas.forEach((k) => {
    htmlKelas += `<option value="${escapeHTML(k)}">${escapeHTML(k)}</option>`;
  });
  selectKelas.innerHTML = htmlKelas;

  // Jika Wali Kelas, otomatis kunci ke kelas perwaliannya
  if (isWaliKelas && waliKelasClass && sortedKelas.includes(waliKelasClass)) {
    selectKelas.value = waliKelasClass;
  }

  // Auto-select mapel pertama jika user dibatasi ke penugasan guru dan bukan wali kelas
  if (isRestrictedToTeacherAssignments && !isWaliKelas && sortedMapel.length > 0) {
    selectMapel.value = sortedMapel[0];
    updateKelasForMapel(); // Trigger update kelas khusus untuk mapel ini
  }

  // Event: saat mapel berubah, filter kelas yang sesuai
  selectMapel.addEventListener("change", () => {
    updateKelasForMapel();
  });

  // Populate TA Selects for Semester Filter
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();
  const defaultTA = currentMonth >= 7 ? `${currentYear}/${currentYear + 1}` : `${currentYear - 1}/${currentYear}`;
  const defaultSemester = currentMonth >= 7 ? "1" : "2";

  const activeTA = raporConfig?.tahun_ajaran || defaultTA;
  const activeSemester = String(raporConfig?.semester || defaultSemester);

  const elRekapSem = document.getElementById("rekap-semester-select");
  const elDetailSem = document.getElementById("detail-semester-select");
  if (elRekapSem) elRekapSem.value = activeSemester;
  if (elDetailSem) elDetailSem.value = activeSemester;

  const activeY1 = parseInt(activeTA.split("/")[0]) || 2025;
  const taList = [
    activeTA,
    `${activeY1 + 1}/${activeY1 + 2}`,
    `${activeY1 - 1}/${activeY1}`,
    `${activeY1 - 2}/${activeY1 - 1}`,
  ];
  const uniqueTAList = Array.from(new Set(taList));
  const taHtml = uniqueTAList.map((t) => `<option value="${t}">${t}</option>`).join("");
  const elRekapTA = document.getElementById("rekap-ta-select");
  const elDetailTA = document.getElementById("detail-ta-select");
  if (elRekapTA) {
    elRekapTA.innerHTML = taHtml;
    elRekapTA.value = activeTA;
  }
  if (elDetailTA) {
    elDetailTA.innerHTML = taHtml;
    elDetailTA.value = activeTA;
  }
}

// === UPDATE KELAS DROPDOWN BASED ON SELECTED MAPEL ===
function updateKelasForMapel() {
  const selectedMapel = document.getElementById("filter-mapel").value;
  const selectKelas = document.getElementById("filter-kelas");

  if (!selectedMapel || !raporConfig || !raporConfig.mapel_guru) {
    // Reset ke semua kelas
    populateFilters();
    return;
  }

  const guruArray = raporConfig.mapel_guru[selectedMapel];
  if (!Array.isArray(guruArray)) return;

  const kelasSet = new Set();
  guruArray.forEach((guruObj) => {
    if (isWaliKelas && waliKelasClass) {
      if (Array.isArray(guruObj.kelas) && guruObj.kelas.includes(waliKelasClass)) {
        kelasSet.add(waliKelasClass);
      }
    } else if (
      isRestrictedToTeacherAssignments &&
      currentUserInfo &&
      guruObj.uid !== currentUserInfo.uid
    ) {
      return;
    } else {
      if (Array.isArray(guruObj.kelas)) {
        guruObj.kelas.forEach((k) => kelasSet.add(k));
      }
    }
  });

  const sortedKelas = [...kelasSet].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );

  let htmlKelas = '<option value="">-- Pilih Kelas --</option>';
  sortedKelas.forEach((k) => {
    htmlKelas += `<option value="${escapeHTML(k)}">${escapeHTML(k)}</option>`;
  });
  selectKelas.innerHTML = htmlKelas;

  if (isWaliKelas && waliKelasClass && sortedKelas.includes(waliKelasClass)) {
    selectKelas.value = waliKelasClass;
  }
}

// === LOAD STUDENTS DATA (DARI DB UTAMA) ===
async function loadStudents(kelas) {
  // Cek cache
  const cacheKey = `${STUDENTS_CACHE_KEY}_${kelas}`;
  const cached = window.getLocalCache
    ? window.getLocalCache(cacheKey, 24 * 60 * 60 * 1000)
    : null;
  if (cached) {
    studentsCache[kelas] = cached;
    return cached;
  }

  try {
    const classStudents = (typeof window.getStudentsByClass === 'function')
      ? await window.getStudentsByClass(kelas)
      : [];
    const students = classStudents.map(data => ({
      id: data.id || data.nis,
      nis: data.nis || "-",
      nisn: data.nisn || "-",
      name: data.name || "-",
      class: data.class || "-",
    }));

    // Sort by name (alfabet) — nomor urut otomatis berdasarkan nama
    students.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id'));

    studentsCache[kelas] = students;
    if (window.setLocalCache) window.setLocalCache(cacheKey, students);
    return students;
  } catch (e) {
    console.error("Error loading students:", e);
    return [];
  }
}

// === MAIN: LOAD REKAP KEHADIRAN ===
window.loadRekapKehadiran = async function () {
  const tipePeriode = document.getElementById("filter-tipe").value;
  const mapel = document.getElementById("filter-mapel").value;
  const kelas = document.getElementById("filter-kelas").value;
  const container = document.getElementById("rekap-container");

  // Validasi input
  if (
    tipePeriode === "bulan" &&
    !document.getElementById("filter-bulan").value
  ) {
    showToast("Peringatan", "Silakan pilih bulan.", "warning");
    return;
  }
  if (!mapel) {
    showToast("Peringatan", "Silakan pilih mata pelajaran.", "warning");
    return;
  }
  if (!kelas) {
    showToast("Peringatan", "Silakan pilih kelas.", "warning");
    return;
  }

  container.innerHTML =
    '<div class="text-center py-12"><i class="fa-solid fa-spinner fa-spin text-2xl text-slate-400"></i><p class="text-sm text-slate-400 mt-2">Memuat data rekap kehadiran...</p></div>';

  try {
    // 1. Tentukan guru name (untuk query)
    let guruName = "";
    if (isRestrictedToTeacherAssignments && currentUserInfo) {
      guruName = currentUserInfo.nama;
    } else {
      // Untuk admin: cari guru yang mengajar mapel ini di kelas ini
      if (
        raporConfig &&
        raporConfig.mapel_guru &&
        raporConfig.mapel_guru[mapel]
      ) {
        const guruArr = raporConfig.mapel_guru[mapel];
        for (const g of guruArr) {
          if (Array.isArray(g.kelas) && g.kelas.includes(kelas)) {
            guruName = g.nama || "";
            break;
          }
        }
      }
    }

    // 2. Tentukan range tanggal berdasarkan Tipe Periode
    let startDate, endDate;
    let subtitleText = "";

    if (tipePeriode === "bulan") {
      const bulanVal = document.getElementById("filter-bulan").value;
      const [year, month] = bulanVal.split("-");
      startDate = new Date(year, parseInt(month) - 1, 1);
      endDate = new Date(year, parseInt(month), 0, 23, 59, 59); // Akhir bulan

      const monthNames = [
        "Januari",
        "Februari",
        "Maret",
        "April",
        "Mei",
        "Juni",
        "Juli",
        "Agustus",
        "September",
        "Oktober",
        "November",
        "Desember",
      ];
      subtitleText = `${monthNames[parseInt(month) - 1]} ${year}`;
    } else if (tipePeriode === "semester") {
      const ta = document.getElementById("filter-ta").value; // e.g. "2024/2025"
      const sem = document.getElementById("filter-semester").value; // "1" or "2"
      const [year1, year2] = ta.split("/");

      if (sem === "1") {
        startDate = new Date(year1, 6, 1); // 1 Juli
        endDate = new Date(year1, 11, 31, 23, 59, 59); // 31 Des
      } else {
        startDate = new Date(year2, 0, 1); // 1 Jan
        endDate = new Date(year2, 5, 30, 23, 59, 59); // 30 Juni
      }
      subtitleText = `Semester ${sem} - TA ${ta}`;
    } else if (tipePeriode === "tahun") {
      const ta = document.getElementById("filter-ta").value;
      const [year1, year2] = ta.split("/");
      startDate = new Date(year1, 6, 1); // 1 Juli tahun 1
      endDate = new Date(year2, 5, 30, 23, 59, 59); // 30 Juni tahun 2
      subtitleText = `Tahun Ajaran ${ta}`;
    }

    // Cache key berdasarkan filter spesifik
    const rekapCacheKey = `rekap_${kelas}_${mapel}_${guruName}_${startDate.toISOString()}_${endDate.toISOString()}`;
    const rekapCached = _cache.rekapKehadiran[rekapCacheKey];
    const rekapTTL = getCacheTTL(window.getLocalISODate ? window.getLocalISODate(startDate) : startDate.toISOString().split("T")[0]);

    let snapshot;
    try {
      if (!_forceRefresh && isCacheValid(rekapCached, rekapTTL)) {
        console.log(`📦 [Cache HIT] rekap kehadiran ${kelas} ${mapel}`);
        snapshot = {
          forEach: (cb) => rekapCached.data.forEach((d) => cb({ id: d.id, data: () => d }))
        };
      } else {
        const startStr = window.getLocalISODate ? window.getLocalISODate(startDate) : startDate.toISOString().split("T")[0];
        const endStr = window.getLocalISODate ? window.getLocalISODate(endDate) : endDate.toISOString().split("T")[0];
        let cachedDocs = [];
        if (cfClient && cfClient.enabled) {
          const res = await cfClient.getJurnalKbm({
            kelas: kelas,
            mapel: mapel,
            guru: guruName || undefined,
            startDate: startStr,
            endDate: endStr,
            limit: 1000,
            excludeTtd: true
          });
          cachedDocs = (res || []).map(d => {
            let presensiDetail = d.presensi_detail;
            if (typeof presensiDetail === "string") {
              try { presensiDetail = JSON.parse(presensiDetail); } catch (e) {}
            }
            return {
              ...d,
              presensi_detail: presensiDetail || []
            };
          });
        }
        _cache.rekapKehadiran[rekapCacheKey] = { data: cachedDocs, ts: Date.now() };
        saveKbmSessionCache();
        console.log(`🔄 [Cloudflare D1] rekap kehadiran ${kelas} ${mapel} (${cachedDocs.length} docs)`);
        snapshot = {
          forEach: (cb) => cachedDocs.forEach((d) => cb({ id: d.id, data: () => d }))
        };
      }
    } catch (error) {
      if (error.message && error.message.includes("requires an index")) {
        const urlMatch = error.message.match(
          /https:\/\/console\.firebase\.google\.com[^\s]*/,
        );
        const indexUrl = urlMatch ? urlMatch[0] : "#";
        container.innerHTML = `
                    <div class="p-8 text-center text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400">
                        <i class="fa-solid fa-server text-4xl mb-3 text-amber-500"></i>
                        <h3 class="font-bold text-lg">Perlu Penyesuaian Indeks Database</h3>
                        <p class="mb-4 text-sm mt-1">Kombinasi pencarian ini membutuhkan indeks database baru.</p>
                        <a href="${indexUrl}" target="_blank" class="px-5 py-2.5 bg-blue-600 text-white rounded-xl shadow-sm hover:bg-blue-700 transition-all inline-block font-bold">
                            <i class="fa-solid fa-link mr-2"></i> Klik Setujui Indeks Database Ini
                        </a>
                        <p class="text-xs mt-5 text-slate-500 dark:text-slate-400 text-left max-w-md mx-auto bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm leading-relaxed">
                            <b class="text-slate-700 dark:text-slate-300"><i class="fa-solid fa-info-circle mr-1"></i> Cara Aktivasi:</b><br>
                            1. Tekan tombol biru di atas.<br>
                            2. Klik <b>"Create Index / Buat Indeks"</b>.<br>
                            3. Tunggu hingga status <i>"Enabled"</i> (2-5 menit).<br>
                            4. Kembali ke SIMAS dan klik Cari lagi.
                        </p>
                    </div>
                `;
        return;
      }
      throw error;
    }

    // 3. Parse data presensi dari setiap jurnal
    // Map: { tanggal_jp: { siswa_nama: status } }
    const pertemuanMap = {}; // key: 'YYYY-MM-DD_JP1-2' → { presensi: {...}, jpStr, guruName }
    let totalJurnal = 0;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      totalJurnal++;

      // Tanggal SSOT
      const tgl = getJurnalDateStr(data);
      if (!tgl) return;

      // JP SSOT
      const jpStr = formatJpDisplay(data.jp);

      const key = `${tgl}_JP${jpStr}`;

      const attendanceEntries = extractJournalAttendance(data);
      if (!pertemuanMap[key]) {
        pertemuanMap[key] = {
          tgl: tgl,
          jp: jpStr,
          presensi: {},
          presensiByNis: {},
          presensiNormalized: {},
          guru: data.guru || "-",
          topik: data.topik || "-",
          catatan: data.catatan || "",
        };
      }

      if (attendanceEntries.length > 0) {
        attendanceEntries.forEach((item) => {
          const status = item.status || "H";
          const nama = item.nama || "-";
          const nis = normalizeNIS(item.nis);

          pertemuanMap[key].presensi[nama] = status;

          const normalizedName = normalizeText(nama);
          if (normalizedName) {
            pertemuanMap[key].presensiNormalized[normalizedName] = status;
          }

          if (nis) {
            pertemuanMap[key].presensiByNis[nis] = status;
          }
        });
      }
    });

    // 4. Ambil daftar pertemuan (kolom tanggal)
    const pertemuanKeys = Object.keys(pertemuanMap).sort();

    if (pertemuanKeys.length === 0) {
      container.innerHTML = `
                <div class="text-center text-slate-400 py-12">
                    <i class="fa-solid fa-inbox text-3xl mb-2"></i>
                    <p class="text-sm">Tidak ada data jurnal untuk filter ini.</p>
                    <p class="text-xs text-slate-300 mt-1">Pastikan guru sudah menginput jurnal untuk mapel & kelas ini di bulan yang dipilih.</p>
                </div>
            `;
      document.getElementById("summary-card").classList.add("hidden");
      document.getElementById("jurnal-container")?.classList.add("hidden");
      return;
    }

    // 5. Load data siswa dari db utama
    const students = await loadStudents(kelas);

    // 6. Kumpulkan semua nama siswa (dari jurnal + dari master)
    const allNamesFromJurnal = new Set();
    pertemuanKeys.forEach((key) => {
      Object.keys(pertemuanMap[key].presensi).forEach((nama) =>
        allNamesFromJurnal.add(nama),
      );
    });

    // Build rows: prioritas dari master students, tambahkan yg hanya ada di jurnal
    const rows = [];
    const matchedNames = new Set();

    // Dari master students
    students.forEach((s) => {
      // Cari nama yang cocok di jurnal data
      const jurnalName = findMatchingName(s.name, allNamesFromJurnal);
      if (jurnalName) matchedNames.add(jurnalName);

      rows.push({
        nis: s.nis,
        nisn: s.nisn || "-",
        name: s.name,
        jurnalName: jurnalName || s.name,
      });
    });

    // Tambahkan nama dari jurnal yang tidak ada di master
    allNamesFromJurnal.forEach((nama) => {
      if (!matchedNames.has(nama)) {
        rows.push({
          nis: "-",
          nisn: "-",
          name: nama,
          jurnalName: nama,
        });
      }
    });

    // Sort by name (alfabet)
    rows.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id'));

    // 7. Hitung kehadiran per siswa
    const rekapData = rows.map((row) => {
      const totals = { H: 0, S: 0, I: 0, A: 0, D: 0, T: 0 };
      const pertemuan = [];

      pertemuanKeys.forEach((key) => {
        const status = findJournalStatus(pertemuanMap[key], row);
        // Jika siswa ada di master tapi tidak ada datanya di jurnal pertemuan ini
        // Artinya dia hadir (default H)
        let finalStatus = "-";
        if (status !== undefined && status !== "") {
          finalStatus = status;
          if (totals[finalStatus] !== undefined) totals[finalStatus]++;
        } else {
          // Siswa di jurnal/master tapi tidak tercatat di pertemuan ini = Hadir (default)
          finalStatus = "H";
          totals.H++;
        }

        pertemuan.push(finalStatus);
      });

      return {
        nis: row.nis,
        nisn: row.nisn,
        name: row.name,
        pertemuan: pertemuan,
        totals: totals,
      };
    });

    // 8. Update summary card
    document.getElementById("summary-card").classList.remove("hidden");
    document.getElementById("summary-title").textContent =
      `${mapel} — ${kelas}`;

    const guruDisplay = guruName || pertemuanMap[pertemuanKeys[0]]?.guru || "-";
    document.getElementById("summary-subtitle").textContent =
      `${subtitleText} • Guru: ${guruDisplay}`;
    document.getElementById("summary-total-jurnal").textContent = totalJurnal;
    document.getElementById("summary-total-siswa").textContent = rows.length;
    document.getElementById("summary-total-pertemuan").textContent =
      pertemuanKeys.length;

    // 9. Render
    renderRekapTable(rekapData, pertemuanKeys, pertemuanMap);
    renderJurnalList(pertemuanKeys, pertemuanMap);
    updateCacheIndicator(_forceRefresh ? false : isCacheValid(rekapCached, rekapTTL));
  } catch (e) {
    console.error("Error loading rekap kehadiran:", e);
    container.innerHTML = `<div class="text-center text-red-500 py-12"><i class="fa-solid fa-triangle-exclamation text-3xl mb-2"></i><p class="text-sm">Gagal memuat data: ${escapeHTML(e.message)}</p></div>`;
  }
};

// === HELPER: Find matching name (fuzzy) ===
function findMatchingName(masterName, jurnalNames) {
  if (!masterName) return null;

  // Exact match
  if (jurnalNames.has(masterName)) return masterName;

  // Normalize: trim, lowercase, remove extra spaces
  const normalize = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const normalizedMaster = normalize(masterName);

  for (const jName of jurnalNames) {
    if (normalize(jName) === normalizedMaster) return jName;
  }

  return null;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeNIS(value) {
  return String(value || "").trim();
}

function extractJournalAttendance(data) {
  const entries = [];

  if (data.presensi && typeof data.presensi === "object") {
    Object.entries(data.presensi).forEach(([nama, status]) => {
      entries.push({
        nama: nama || "-",
        status: status || "H",
      });
    });
  }

  if (Array.isArray(data.presensi_detail)) {
    data.presensi_detail.forEach((item) => {
      if (!item || typeof item !== "object") return;
      entries.push({
        nama: item.nama || "-",
        nis: item.nis || "",
        status: item.status || "H",
      });
    });
  }

  return entries;
}

function findJournalStatus(pertemuan, row) {
  const byNis = pertemuan.presensiByNis || {};
  const byName = pertemuan.presensi || {};
  const normalizedByName = pertemuan.presensiNormalized || {};
  const normalizedRowName = normalizeText(row.jurnalName || row.name);
  const normalizedRowNis = normalizeNIS(row.nis);

  if (normalizedRowNis && byNis[normalizedRowNis] !== undefined) {
    return byNis[normalizedRowNis];
  }

  if (row.jurnalName && byName[row.jurnalName] !== undefined) {
    return byName[row.jurnalName];
  }

  if (normalizedRowName && normalizedByName[normalizedRowName] !== undefined) {
    return normalizedByName[normalizedRowName];
  }

  return undefined;
}

// === RENDER TABLE ===
function renderRekapTable(rekapData, pertemuanKeys, pertemuanMap) {
  const container = document.getElementById("rekap-container");

  const totalPertemuan = pertemuanKeys.length;

  // Build header tanggal (format d/M seperti gambar referensi)
  let thDates = "";
  pertemuanKeys.forEach((key, idx) => {
    const pt = pertemuanMap[key];
    const d = new Date(pt.tgl);
    const dayNum = d.getDate();
    const monthNum = d.getMonth() + 1;
    const jpHtml = pt.jp ? `<div class="text-[8px] font-normal text-slate-200 leading-tight">JP ${escapeHTML(pt.jp)}</div>` : '';

    thDates += `
            <th class="px-1 py-2 text-center text-[11px] font-bold min-w-[36px] border border-slate-500 dark:border-slate-600 bg-slate-600 dark:bg-slate-700 text-white dark:text-slate-200" title="${pt.tgl} JP ${pt.jp || '-'} • Guru: ${escapeHTML(pt.guru || '-')} • Topik: ${escapeHTML(pt.topik || '-')}">
                <div>${dayNum}/${monthNum}</div>
                ${jpHtml}
            </th>
        `;
  });

  // Build rows
  let tbodyHtml = "";
  rekapData.forEach((row, idx) => {
    let tdDates = "";
    row.pertemuan.forEach((status) => {
      // Kosong jika Hadir (H) atau tidak ada data (-), tampilkan huruf kecil jika tidak hadir
      let display = "";
      let cellClass = "border border-slate-200 dark:border-slate-700";
      if (status === "H" || status === "-") {
        display = "";
      } else {
        const colorClass = STATUS_COLORS[status] || "";
        display = `<span class="${colorClass} px-1 py-0.5 rounded text-[11px] font-bold">${status}</span>`;
      }
      tdDates += `<td class="px-1 py-2 text-center ${cellClass}">${display}</td>`;
    });

    // Rincian Ketidakhadiran
    const t = row.totals;
    const jml = t.S + t.I + t.A + t.D + t.T; // JML = total absen + dispen + telat
    const nisn_nis = row.nisn !== "-" ? `${row.nisn} / ${row.nis}` : row.nis;
    const bgRow =
      idx % 2 === 0
        ? "bg-white dark:bg-slate-800"
        : "bg-slate-50 dark:bg-slate-800/50";

    tbodyHtml += `
            <tr class="border-b border-slate-200 dark:border-slate-700 hover:bg-blue-50/50 dark:hover:bg-slate-700/50 transition-colors ${bgRow}">
                <td class="px-2 py-2.5 text-center text-xs font-bold text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-600 sticky left-0 ${bgRow} z-10">${idx + 1}</td>
                <td class="px-2 py-2.5 text-xs text-slate-600 dark:text-slate-300 font-mono border border-slate-200 dark:border-slate-700 whitespace-nowrap">${escapeHTML(nisn_nis)}</td>
                <td class="px-3 py-2.5 text-xs font-semibold text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 whitespace-nowrap max-w-[220px] truncate" title="${escapeHTML(row.name)}">${escapeHTML(row.name)}</td>
                ${tdDates}
                <td class="px-2 py-2.5 text-center text-xs font-bold border border-slate-200 dark:border-slate-700 ${t.S > 0 ? "text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20" : "text-slate-300 dark:text-slate-600"}">${t.S}</td>
                <td class="px-2 py-2.5 text-center text-xs font-bold border border-slate-200 dark:border-slate-700 ${t.I > 0 ? "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20" : "text-slate-300 dark:text-slate-600"}">${t.I}</td>
                <td class="px-2 py-2.5 text-center text-xs font-bold border border-slate-200 dark:border-slate-700 ${t.A > 0 ? "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20" : "text-slate-300 dark:text-slate-600"}">${t.A}</td>
                <td class="px-2 py-2.5 text-center text-xs font-bold border border-slate-200 dark:border-slate-700 ${t.D > 0 ? "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20" : "text-slate-300 dark:text-slate-600"}">${t.D}</td>
                <td class="px-2 py-2.5 text-center text-xs font-bold border border-slate-200 dark:border-slate-700 ${t.T > 0 ? "text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20" : "text-slate-300 dark:text-slate-600"}">${t.T}</td>
                <td class="px-2 py-2.5 text-center text-xs font-extrabold border border-slate-300 dark:border-slate-600 ${jml > 0 ? "text-red-800 dark:text-red-300 bg-red-50 dark:bg-red-900/30" : "text-slate-300 dark:text-slate-600"}">${jml}</td>
            </tr>
        `;
  });

  const html = `
        <table class="w-full text-sm whitespace-nowrap border-collapse">
            <thead class="sticky top-0 z-20">
                <!-- Baris 1: Header utama -->
                <tr class="bg-slate-700 dark:bg-slate-800 text-white">
                    <th rowspan="3" class="px-2 py-2 text-center text-xs font-bold border border-slate-500 dark:border-slate-600 sticky left-0 bg-slate-700 dark:bg-slate-800 z-30 min-w-[45px]">NO</th>
                    <th rowspan="3" class="px-2 py-2 text-center text-xs font-bold border border-slate-500 dark:border-slate-600 min-w-[120px]">NISN/NIS</th>
                    <th rowspan="3" class="px-3 py-2 text-center text-xs font-bold border border-slate-500 dark:border-slate-600 min-w-[160px]">NAMA PESERTA DIDIK</th>
                    <th colspan="${totalPertemuan}" class="px-2 py-2 text-center text-[11px] font-bold border border-slate-500 dark:border-slate-600">TANGGAL KEGIATAN PEMBELAJARAN/PERTEMUAN KE -</th>
                    <th colspan="6" rowspan="2" class="px-2 py-2 text-center text-[11px] font-bold border border-slate-500 dark:border-slate-600">RINCIAN KETIDAKHADIRAN</th>
                </tr>
                <!-- Baris 2: Sub-header tanggal -->
                <tr class="bg-slate-600 dark:bg-slate-700 text-white">
                    ${thDates}
                </tr>
                <!-- Baris 3: Sub-header ketidakhadiran -->
                <tr class="bg-slate-600 dark:bg-slate-700 text-white">
                    ${pertemuanKeys.map((_, i) => `<th class="px-1 py-1.5 text-center text-[10px] font-bold border border-slate-500 dark:border-slate-600 text-slate-200 dark:text-slate-300 min-w-[36px]">${i + 1}</th>`).join("")}
                    <th class="px-2 py-1.5 text-center text-[11px] font-bold border border-slate-500 dark:border-slate-600 bg-yellow-600/30 dark:bg-yellow-500/20" title="Sakit">S</th>
                    <th class="px-2 py-1.5 text-center text-[11px] font-bold border border-slate-500 dark:border-slate-600 bg-blue-600/30 dark:bg-blue-500/20" title="Izin">I</th>
                    <th class="px-2 py-1.5 text-center text-[11px] font-bold border border-slate-500 dark:border-slate-600 bg-red-600/30 dark:bg-red-500/20" title="Alpha">A</th>
                    <th class="px-2 py-1.5 text-center text-[11px] font-bold border border-slate-500 dark:border-slate-600 bg-green-600/30 dark:bg-green-500/20" title="Dispensasi">D</th>
                    <th class="px-2 py-1.5 text-center text-[11px] font-bold border border-slate-500 dark:border-slate-600 bg-orange-600/30 dark:bg-orange-500/20" title="Terlambat">T</th>
                    <th class="px-2 py-1.5 text-center text-[11px] font-bold border border-slate-500 dark:border-slate-600 bg-slate-500/50 dark:bg-slate-500/30" title="Jumlah Ketidakhadiran">JML</th>
                </tr>
            </thead>
            <tbody>
                ${tbodyHtml}
            </tbody>
        </table>
    `;

  container.innerHTML = html;
}

// === RENDER JURNAL LIST ===
function renderJurnalList(pertemuanKeys, pertemuanMap) {
  const container = document.getElementById("jurnal-container");
  if (!container) return;

  if (pertemuanKeys.length === 0) {
    container.innerHTML = "";
    container.classList.add("hidden");
    return;
  }

  let tbodyHtml = "";

  pertemuanKeys.forEach((key, idx) => {
    const pt = pertemuanMap[key];
    const d = new Date(pt.tgl);
    const dayNum = String(d.getDate()).padStart(2, "0");
    const monthNum = String(d.getMonth() + 1).padStart(2, "0");
    const yearNum = d.getFullYear();
    const dateStr = `${dayNum}/${monthNum}/${yearNum}`;
    const bgRow =
      idx % 2 === 0
        ? "bg-white dark:bg-slate-800"
        : "bg-slate-50 dark:bg-slate-800/50";

    tbodyHtml += `
            <tr class="border-b border-slate-200 dark:border-slate-700 hover:bg-blue-50/50 dark:hover:bg-slate-700/50 transition-colors ${bgRow}">
                <td class="px-3 py-3 text-center text-sm text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">${idx + 1}</td>
                <td class="px-3 py-3 text-center text-sm whitespace-nowrap text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">${dateStr}</td>
                <td class="px-3 py-3 text-center text-sm font-bold text-blue-700 dark:text-blue-400 border border-slate-200 dark:border-slate-700">${escapeHTML(pt.jp)}</td>
                <td class="px-3 py-3 text-sm text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700">${escapeHTML(pt.topik)}</td>
                <td class="px-3 py-3 text-sm text-slate-600 dark:text-slate-400 italic border border-slate-200 dark:border-slate-700">${pt.catatan ? escapeHTML(pt.catatan) : "-"}</td>
            </tr>
        `;
  });

  let html = `
        <h3 class="text-lg font-bold text-slate-800 dark:text-white mb-4"><i class="fa-solid fa-book-open mr-2 text-blue-500"></i> Topik & Catatan Jurnal</h3>
        <div class="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-sm border-collapse">
                    <thead class="bg-slate-700 dark:bg-slate-800 text-white">
                        <tr>
                            <th class="px-3 py-2 text-center text-xs font-bold border border-slate-500 dark:border-slate-600 w-12">NO</th>
                            <th class="px-3 py-2 text-center text-xs font-bold border border-slate-500 dark:border-slate-600 w-28">TANGGAL</th>
                            <th class="px-3 py-2 text-center text-xs font-bold border border-slate-500 dark:border-slate-600 w-16">JP</th>
                            <th class="px-3 py-2 text-center text-xs font-bold border border-slate-500 dark:border-slate-600">TOPIK</th>
                            <th class="px-3 py-2 text-center text-xs font-bold border border-slate-500 dark:border-slate-600">CATATAN</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tbodyHtml}
                    </tbody>
                </table>
            </div>
        </div>
    `;

  container.innerHTML = html;
  container.classList.remove("hidden");
}

// =====================================
// SUB-TAB SWITCHER & JURNAL GURU HUB
// =====================================
let activeTab = "kehadiran-siswa";
let kelasList = [];
let visibleJPJurnal = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const JP_TIME_CONFIG = [
  { jp: 1, start: "07:30", end: "08:15" },
  { jp: 2, start: "08:15", end: "09:00" },
  { jp: 3, start: "09:00", end: "09:45" },
  { jp: 4, start: "10:00", end: "10:45" },
  { jp: 5, start: "10:45", end: "11:30" },
  { jp: 6, start: "11:30", end: "12:15" },
  { jp: 7, start: "12:30", end: "13:15" },
  { jp: 8, start: "13:15", end: "14:00" },
  { jp: 9, start: "14:00", end: "14:45" },
  { jp: 10, start: "14:45", end: "15:30" },
];

const JP_LABELS = [
  "JP 1", "JP 2", "JP 3", "JP 4", "JP 5",
  "JP 6", "JP 7", "JP 8", "JP 9", "JP 10"
];

function isJPElapsed(jpNum, dateStr) {
  if (!dateStr) return false;
  const now = new Date();
  const todayString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  if (dateStr < todayString) return true;
  if (dateStr > todayString) return false;

  const item = JP_TIME_CONFIG.find((x) => x.jp === jpNum);
  if (!item) return false;
  const [eH, eM] = item.end.split(":").map(Number);
  const endMin = eH * 60 + eM;
  const currentMin = now.getHours() * 60 + now.getMinutes();

  return currentMin >= endMin;
}

function getActiveJPNumber(targetDateStr) {
  if (!targetDateStr) return null;
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  if (targetDateStr !== todayStr) return null;

  const selectedDate = new Date(targetDateStr + "T00:00:00");
  const dayOfWeek = selectedDate.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return null;
  if (isHolidayDate(targetDateStr)) return null;

  const currentMin = now.getHours() * 60 + now.getMinutes();

  for (const item of JP_TIME_CONFIG) {
    const [sH, sM] = item.start.split(":").map(Number);
    const [eH, eM] = item.end.split(":").map(Number);
    const startMin = sH * 60 + sM;
    const endMin = eH * 60 + eM;

    if (currentMin >= startMin && currentMin < endMin) {
      return item.jp;
    }
  }

  return null;
}

function isJPStarted(jpNum, dateStr) {
  if (!dateStr) return false;
  const now = new Date();
  const todayString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  if (dateStr < todayString) return true;
  if (dateStr > todayString) return false;

  const item = JP_TIME_CONFIG.find((x) => x.jp === jpNum);
  if (!item) return false;
  const [sH, sM] = item.start.split(":").map(Number);
  const startMin = sH * 60 + sM;
  const currentMin = now.getHours() * 60 + now.getMinutes();

  return currentMin >= startMin;
}

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function getAngkatanFromClass(className) {
  if (!className) return "OTHER";
  const clean = String(className).trim().replace(/^KELAS\s+/i, "").toUpperCase();
  if (clean.startsWith("XII") || clean.startsWith("12")) return "XII";
  if (clean.startsWith("XI") || clean.startsWith("11")) return "XI";
  if (clean.startsWith("X") || clean.startsWith("10")) return "X";
  const m = clean.match(/^(X|XI|XII|\d+)/i);
  return m ? m[1].toUpperCase() : "OTHER";
}

// === HELPER HARI LIBUR NASIONAL RESMI (SSOT DATA HOLIDAYS) ===
export function getHolidayHelper() {
  if (typeof window !== "undefined" && window.DataHolidays) return window.DataHolidays;
  if (typeof globalThis !== "undefined" && globalThis.DataHolidays) return globalThis.DataHolidays;
  return null;
}

export function isHolidayDate(dateStr) {
  if (!dateStr || dateStr.length < 10) return false;
  let cleanDate = dateStr;
  const m = String(dateStr).match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) cleanDate = m[1];

  const dh = getHolidayHelper();
  if (dh && typeof dh.isNationalHoliday === "function" && dh.isNationalHoliday(cleanDate)) {
    return true;
  }
  if (dh && typeof dh.getHolidayForDate === "function") {
    const hol = dh.getHolidayForDate(cleanDate);
    if (hol && (hol.isHoliday || hol.category === "libur" || hol.isNationalHoliday)) {
      return true;
    }
  }
  if (typeof isRegisteredHoliday === "function" && isRegisteredHoliday(cleanDate)) {
    return true;
  }
  if (typeof window !== "undefined" && window.HolidayManager?.isRegisteredHoliday?.(cleanDate)) {
    return true;
  }
  return false;
}

export function getHolidayDateInfo(dateStr) {
  if (!dateStr || dateStr.length < 10) return null;
  let cleanDate = dateStr;
  const m = String(dateStr).match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) cleanDate = m[1];

  const dh = getHolidayHelper();
  if (dh && typeof dh.getHolidayForDate === "function") {
    const info = dh.getHolidayForDate(cleanDate);
    if (info) return info;
  }
  const reg = (typeof getRegisteredHoliday === "function" ? getRegisteredHoliday(cleanDate) : null) ||
    (typeof window !== "undefined" && window.HolidayManager?.getRegisteredHoliday?.(cleanDate));
  if (reg) {
    return {
      title: reg.nama || "Hari Libur Sekolah",
      name: reg.nama || "Hari Libur Sekolah",
      date: reg.tanggal,
      isCutiBersama: false,
      isSchoolHoliday: true
    };
  }
  return null;
}

export function formatLocalIsoDate(dateObj) {
  if (typeof window !== "undefined" && typeof window.getLocalISODate === "function") {
    return window.getLocalISODate(dateObj);
  }
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Menghasilkan daftar tanggal aktif KBM sekolah dengan memfilter akhir pekan (Sabtu & Minggu)
 * serta mengecualikan hari libur nasional & cuti bersama resmi pemerintah (SKB 3 Menteri)
 */
export function collectActiveKbmDates({
  periodeType,
  startDate,
  endDate,
  bulan,
  semester = "1",
  tahunAjaran = "2025/2026",
  raporConfig = null,
}) {
  const dates = [];

  if (periodeType === "mingguan") {
    if (!startDate || !endDate) return dates;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return dates;

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = formatLocalIsoDate(d);
      if (d.getDay() !== 0 && d.getDay() !== 6 && !isHolidayDate(dateStr)) {
        dates.push(dateStr);
      }
    }
  } else if (periodeType === "bulanan") {
    if (!bulan) return dates;
    const [year, month] = bulan.split("-");
    const yNum = parseInt(year, 10);
    const mNum = parseInt(month, 10);
    if (isNaN(yNum) || isNaN(mNum)) return dates;
    const daysInMonth = new Date(yNum, mNum, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(yNum, mNum - 1, day);
      const dateStr = formatLocalIsoDate(d);
      if (d.getDay() !== 0 && d.getDay() !== 6 && !isHolidayDate(dateStr)) {
        dates.push(dateStr);
      }
    }
  } else if (periodeType === "semester") {
    const sem = semester || "1";
    const ta = tahunAjaran || raporConfig?.tahun_ajaran || "2025/2026";
    const parts = ta.split("/");
    const year1 = parseInt(parts[0], 10);
    const year2 = parseInt(parts[1] || year1 + 1, 10);

    let start, end;
    if (sem === "1") {
      start = new Date(year1, 6, 1);
      end = new Date(year1, 11, 31, 23, 59, 59);
    } else {
      start = new Date(year2, 0, 1);
      end = new Date(year2, 5, 30, 23, 59, 59);
    }

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = formatLocalIsoDate(d);
      if (d.getDay() !== 0 && d.getDay() !== 6 && !isHolidayDate(dateStr)) {
        dates.push(dateStr);
      }
    }
  }

  return dates;
}

export function buildJPTidakEfektifAngkatanMap(kelasList, matrixForDate, targetDateStr) {
  const map = { X: {}, XI: {}, XII: {}, OTHER: {} };
  const selectedDate = targetDateStr ? new Date(targetDateStr + "T00:00:00") : new Date();
  const dayOfWeek = selectedDate.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isHoliday = isWeekend || isHolidayDate(targetDateStr);

  for (let jpNum = 1; jpNum <= 10; jpNum++) {
    const elapsed = !isHoliday && isJPElapsed(jpNum, targetDateStr);
    const verifiedCountByAngkatan = { X: 0, XI: 0, XII: 0, OTHER: 0 };

    kelasList.forEach((k) => {
      const angk = getAngkatanFromClass(k);
      const cell = matrixForDate?.[k]?.[jpNum];
      // Murni Terverifikasi Lengkap: Jurnal KBM Guru Terisi (Scan Barcode) DAN Presensi Kehadiran Guru oleh Siswa Berstatus Hadir (H)
      if (cell?.jurnal && cell?.presensi && cell.presensi.status === "H") {
        verifiedCountByAngkatan[angk] = (verifiedCountByAngkatan[angk] || 0) + 1;
      }
    });

    Object.keys(verifiedCountByAngkatan).forEach((angk) => {
      if (!map[angk]) map[angk] = {};
      // Kriteria Tidak Belajar Efektif Angkatan: JP sudah berlalu DAN kelas terverifikasi di angkatan tersebut <= 2
      map[angk][jpNum] = elapsed && (verifiedCountByAngkatan[angk] <= 2);
    });
  }

  return map;
}

window.switchTab = function (tab) {
  // Jika user bukan Full Access dan bukan Wali Kelas, hanya izinkan rekap-kbm dan detail-guru
  if (isRestrictedToTeacherAssignments && !isWaliKelas) {
    if (tab !== "detail-guru" && tab !== "rekap-kbm") {
      tab = "rekap-kbm";
    }
  }

  // Normalize alias tab names
  if (tab === "rekap-jurnal") tab = "rekap-kbm";

  activeTab = tab;

  const isGuruRestricted = isRestrictedToTeacherAssignments && !isWaliKelas;

  const tabKehadiran = document.getElementById("tab-kehadiran-siswa");
  const tabRekapKbm = document.getElementById("tab-rekap-kbm");
  const tabRekapGuru = document.getElementById("tab-rekap-guru");
  const tabDetailGuru = document.getElementById("tab-detail-guru");

  const panelKehadiran = document.getElementById("panel-kehadiran-siswa");
  const panelRekapKbm = document.getElementById("panel-rekap-kbm");
  const panelRekapGuru = document.getElementById("panel-rekap-guru");
  const panelDetailGuru = document.getElementById("panel-detail-guru");

  const activeBtnBase = "px-3 py-1.5 rounded-lg font-bold text-xs transition-all duration-150 bg-blue-600 text-white shadow-sm flex items-center gap-1.5";
  const inactiveBtnBase = "px-3 py-1.5 rounded-lg font-bold text-xs transition-all duration-150 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5";

  // Perbarui styling tombol tab dengan mempertahankan kelas hidden untuk tab yang tidak diizinkan
  if (tabKehadiran) {
    tabKehadiran.className = `${tab === "kehadiran-siswa" ? activeBtnBase : inactiveBtnBase} ${isGuruRestricted ? "hidden" : ""}`.trim();
  }
  if (tabRekapKbm) {
    tabRekapKbm.className = tab === "rekap-kbm" ? activeBtnBase : inactiveBtnBase;
  }
  if (tabRekapGuru) {
    tabRekapGuru.className = tab === "rekap-guru" ? activeBtnBase : inactiveBtnBase;
  }
  if (tabDetailGuru) {
    tabDetailGuru.className = tab === "detail-guru" ? activeBtnBase : inactiveBtnBase;
  }

  // Reset panels
  if (panelKehadiran) panelKehadiran.classList.add("hidden");
  if (panelRekapKbm) panelRekapKbm.classList.add("hidden");
  if (panelRekapGuru) panelRekapGuru.classList.add("hidden");
  if (panelDetailGuru) panelDetailGuru.classList.add("hidden");

  if (tab === "rekap-kbm") {
    if (panelRekapKbm) panelRekapKbm.classList.remove("hidden");
    initRekapKBMInputs();
  } else if (tab === "rekap-guru") {
    if (panelRekapGuru) panelRekapGuru.classList.remove("hidden");
    initGuruPeriodeInputs();
  } else if (tab === "detail-guru") {
    if (panelDetailGuru) panelDetailGuru.classList.remove("hidden");
    initDetailPeriodeInputs();
    populateGuruDropdown();
  } else {
    // Default: kehadiran-siswa
    if (panelKehadiran) panelKehadiran.classList.remove("hidden");
  }
};

async function loadKelasListLocal() {
  if (!kelasList || kelasList.length === 0) {
    if (window.getActiveClasses) {
      kelasList = await window.getActiveClasses();
    } else {
      kelasList = [];
    }
    kelasList.sort(naturalSort);
  }
  return kelasList;
}

// === TAB 3: REKAP KBM JURNAL ===
async function initRekapKBMInputs() {
  await loadKelasListLocal();
  const dateInput = document.getElementById("input-tanggal-rekap-jurnal");
  if (dateInput && !dateInput.value) {
    const today = new Date();
    dateInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  }
  renderJPFilterJurnal();
  const rc = document.getElementById("rekap-jurnal-container");
  if (rc && rc.querySelector(".fa-table-cells")) {
    window.loadRekapJurnal();
  }
}

function renderJPFilterJurnal() {
  const container = document.getElementById("jp-filter-container-jurnal");
  if (!container) return;

  const targetDateStr = document.getElementById("input-tanggal-rekap-jurnal")?.value || "";
  const activeJP = getActiveJPNumber(targetDateStr);

  let html = "";
  for (let i = 1; i <= 10; i++) {
    const checked = visibleJPJurnal.includes(i) ? "checked" : "";
    const isActive = i === activeJP;
    const activeClass = isActive
      ? "bg-blue-600 dark:bg-blue-600 text-white font-extrabold ring-2 ring-blue-400 dark:ring-blue-500 shadow-sm"
      : "bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-600/80 text-slate-700 dark:text-slate-200 font-bold border border-slate-200 dark:border-slate-600";

    const activeBadge = isActive
      ? `<span class="inline-flex items-center gap-0.5 ml-1 bg-amber-400 text-slate-900 text-[9px] font-black px-1.5 py-0.2 rounded-full shadow-xs animate-pulse"><i class="fa-solid fa-clock text-[8px]"></i> AKTIF</span>`
      : "";

    html += `
            <label class="inline-flex items-center px-2 py-1 rounded-md text-[11px] cursor-pointer select-none transition-all shrink-0 ${activeClass}">
                <input type="checkbox" value="${i}" ${checked} class="jp-checkbox-jurnal mr-1 text-blue-600 rounded w-3 h-3 focus:ring-0" onchange="window.onJPJurnalChange()">
                JP ${i}${activeBadge}
            </label>
        `;
  }
  container.innerHTML = html;
}

window.onJPJurnalChange = function () {
  const checkboxes = document.querySelectorAll(".jp-checkbox-jurnal");
  visibleJPJurnal = [];
  checkboxes.forEach((cb) => {
    if (cb.checked) visibleJPJurnal.push(parseInt(cb.value));
  });
  if (window.currentJurnalMatrix) {
    renderRekapJurnalTable(window.currentJurnalMatrix);
  }
};

window.setKbmScopeMode = function (mode) {
  kbmScopeMode = mode;
  const btnAll = document.getElementById("btn-kbm-mode-all");
  const btnMe = document.getElementById("btn-kbm-mode-me");
  const activeClass = "px-2 py-1 text-[11px] font-bold rounded-md transition-all bg-blue-600 text-white shadow-xs";
  const inactiveClass = "px-2 py-1 text-[11px] font-bold rounded-md transition-all text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white";

  if (mode === "me") {
    if (btnMe) btnMe.className = activeClass;
    if (btnAll) btnAll.className = inactiveClass;
  } else {
    if (btnAll) btnAll.className = activeClass;
    if (btnMe) btnMe.className = inactiveClass;
  }

  if (window.currentJurnalMatrix) {
    renderRekapJurnalTable(window.currentJurnalMatrix);
  }
};

window.toggleAllJPJurnal = function (state) {
  const checkboxes = document.querySelectorAll(".jp-checkbox-jurnal");
  checkboxes.forEach((cb) => (cb.checked = state));
  window.onJPJurnalChange();
};

window.loadRekapJurnal = async function () {
  renderJPFilterJurnal();
  await loadKelasListLocal();
  await getMasterTeachersList();
  const tanggal = document.getElementById("input-tanggal-rekap-jurnal").value;
  if (!tanggal) {
    showToast("Error", "Pilih tanggal terlebih dahulu!", "error");
    return;
  }

  const container = document.getElementById("rekap-jurnal-container");
  container.innerHTML =
    '<div class="text-center py-12"><i class="fa-solid fa-spinner fa-spin text-3xl text-slate-400"></i><p class="text-slate-500 mt-3 font-medium">Memuat Matriks Verifikasi KBM...</p></div>';

  try {
    const [year, month, day] = tanggal.split("-");
    const targetBulan = `${year}_${month}`; // YYYY_MM
    const targetDateStr = tanggal; // "YYYY-MM-DD"
    const startId = `${targetBulan}-`;
    const endId = `${targetBulan}.\uf8ff`;

    // 1. Query Jurnal Guru (Input Guru) — On-Demand per tanggal spesifik (Sangat Cepat & Hemat Resource)
    const jurnalCacheKey = `jurnal_day_${targetDateStr}`;

    // Ambil info hari libur terdaftar untuk tanggal terpilih
    if (targetDateStr) {
      try {
        await fetchRegisteredHolidays(targetDateStr, targetDateStr);
      } catch (eH) {
        console.warn("[MonitoringKBM] Holiday load error:", eH);
      }
    }

    // 2. Query Presensi Guru (Input Siswa/Admin Kelas) — Eksklusif dari Supabase (0 Firestore Reads)
    let sbPresensiRows = [];
    if (supabase) {
      try {
        const { data: sbData, error: sbErr } = await supabase
          .from("guru_presensi")
          .select("*")
          .eq("tanggal", targetDateStr);
        if (!sbErr && Array.isArray(sbData)) {
          sbPresensiRows = sbData;
          console.log(`📦 [Supabase] Loaded ${sbData.length} guru_presensi rows for ${targetDateStr}`);
        }
      } catch (eSb) {
        console.warn("[MonitoringKBM] Supabase load error:", eSb);
      }
    }

    // 3. Query Jadwal XML (Master Schedule) secara PARALLEL
    const xmlPromises = kelasList.map(async (k) => {
      try {
        const sch = await getScheduleForClassAndDate(k, targetDateStr);
        return { kelas: k, schedule: sch || [] };
      } catch (e) {
        return { kelas: k, schedule: [] };
      }
    });

    // Eksekusi query jurnal & jadwal XML secara PARALLEL
    const jurnalCached = _cache.jurnalByMonth[jurnalCacheKey];
    const jurnalTTL = getCacheTTL(targetDateStr);
    
    let jurnalPromise;
    if (!_forceRefresh && isCacheValid(jurnalCached, jurnalTTL)) {
      console.log(`📦 [Cache HIT] jurnal_guru ${targetDateStr}`);
      jurnalPromise = Promise.resolve(jurnalCached.data);
    } else {
      jurnalPromise = (async () => {
        let cachedDocs = [];
        if (cfClient && cfClient.enabled) {
          const res = await cfClient.getJurnalKbm({
            tanggal: targetDateStr,
            limit: 200,
            excludeTtd: true
          });
          cachedDocs = (res || []).map(d => {
            let presensiDetail = d.presensi_detail;
            if (typeof presensiDetail === "string") {
              try { presensiDetail = JSON.parse(presensiDetail); } catch (e) {}
            }
            return {
              ...d,
              presensi_detail: presensiDetail || []
            };
          });
        }
        _cache.jurnalByMonth[jurnalCacheKey] = { data: cachedDocs, ts: Date.now() };
        saveKbmSessionCache();
        console.log(`🔄 [Cloudflare D1] jurnal_guru tanggal ${targetDateStr} (${cachedDocs.length} docs)`);
        return cachedDocs;
      })();
    }
    
    const [jurnalDocsRaw, resultsXML] = await Promise.all([
      jurnalPromise,
      Promise.all(xmlPromises)
    ]);
    
    // Wrap cached docs into a snapshot-like iterable
    const snapshotJurnal = {
      empty: jurnalDocsRaw.length === 0,
      forEach: (cb) => jurnalDocsRaw.forEach((d) => cb({
        id: d.id,
        data: () => d
      }))
    };

    // Setup Matriks Data per Kelas & JP (1-10)
    const matrix = {};
    kelasList.forEach((k) => {
      matrix[k] = {};
      for (let i = 1; i <= 10; i++) {
        matrix[k][i] = {
          jurnal: null,
          presensi: null,
          xml: null
        };
      }
    });

    // Step A: Olah Data Jadwal XML (Master Schedule)
    resultsXML.forEach(({ kelas, schedule }) => {
      if (matrix[kelas] && Array.isArray(schedule)) {
        schedule.forEach((item) => {
          if (item.jp >= 1 && item.jp <= 10) {
            matrix[kelas][item.jp].xml = {
              guru: item.guruNama || "Belum diisi",
              mapel: item.mapel || "Jadwal XML",
              foto: item.guruFoto || "",
              nip: item.guruNip || "",
              id: item.guruId || ""
            };
          }
        });
      }
    });

    // Step B: Olah Data Presensi Guru dari Siswa/Admin Kelas (Eksklusif Supabase)
    sbPresensiRows.forEach((row) => {
      const targetKelasKey = findMatchingClassKey(row.kelas, matrix);
      if (targetKelasKey && row.jp >= 1 && row.jp <= 10 && row.status) {
        matrix[targetKelasKey][row.jp].presensi = {
          guru: row.guru_nama || "-",
          mapel: row.mapel || "-",
          status: row.status,
          keterangan: (row.keterangan || "").trim()
        };
      }
    });

    // Step C: Olah Data Jurnal Guru (Input Guru)
    if (!snapshotJurnal.empty) {
      snapshotJurnal.forEach((docSnap) => {
        const data = docSnap.data();

        const docDate = getJurnalDateStr(data);
        if (docDate !== targetDateStr) return;

        const rawKelas = data.kelas;
        const targetKelasKey = findMatchingClassKey(rawKelas, matrix);
        if (!targetKelasKey) return;

        const guru = data.guru || "-";
        const mapel = data.mapel || "-";
        const jps = parseJpList(data.jp);

        jps.forEach((jp) => {
          if (jp >= 1 && jp <= 10) {
            matrix[targetKelasKey][jp].jurnal = {
              guru,
              mapel,
              topik: data.topik || "",
              catatan: data.catatan || "",
              foto_url: data.foto_url || "",
              presensi_detail: data.presensi_detail || []
            };
          }
        });
      });
    }

    // Deteksi Heuristik KBM Non-Efektif (<= 5 Kelas) untuk Hari Kerja Lampau di Tab 1
    const todayStrTab1 = (typeof window !== "undefined" && typeof window.getLocalISODate === "function")
      ? window.getLocalISODate()
      : formatLocalIsoDate(new Date());
    const selDate = new Date(targetDateStr + "T00:00:00");
    const dOfWeek = selDate.getDay();
    if (targetDateStr < todayStrTab1 && dOfWeek !== 0 && dOfWeek !== 6 && Array.isArray(kelasList) && kelasList.length > 5) {
      let activeCount = 0;
      kelasList.forEach((k) => {
        let hasClassKbm = false;
        for (let jp = 1; jp <= 10; jp++) {
          const cell = matrix[k]?.[jp];
          if (cell && (cell.jurnal || (cell.presensi && cell.presensi.status))) {
            hasClassKbm = true;
            break;
          }
        }
        if (hasClassKbm) activeCount++;
      });

      const existingHoliday = (typeof getRegisteredHoliday === "function" ? getRegisteredHoliday(targetDateStr) : null) ||
        (typeof window !== "undefined" && window.HolidayManager?.getRegisteredHoliday?.(targetDateStr));
      const isAutoHeuristic = Boolean(existingHoliday?.nama?.startsWith("Dispensasi Khusus / Libur Sekolah"));
      const dh = getHolidayHelper();
      const isOfficialNational = Boolean(dh && typeof dh.isNationalHoliday === "function" && dh.isNationalHoliday(targetDateStr));

      if (activeCount <= 5 && !isHolidayDate(targetDateStr)) {
        const holidayTitle = `Dispensasi Khusus / Libur Sekolah (${activeCount} Rombel Aktif)`;
        try {
          await upsertSchoolHoliday(targetDateStr, holidayTitle);
        } catch (err) {
          console.warn("[Monitoring KBM Tab 1] Auto-upsert lib_hari_libur gagal:", err);
        }
      } else if (activeCount > 5 && isAutoHeuristic && !isOfficialNational) {
        try {
          await deleteSchoolHoliday(targetDateStr);
        } catch (err) {
          console.warn("[Monitoring KBM Tab 1] Reconcile deleteSchoolHoliday gagal:", err);
        }
      }
    }

    window.currentJurnalMatrix = matrix;
    renderRekapJurnalTable(matrix);
    setupStickyScrollbarJurnal();
  } catch (e) {

    console.error(e);
    container.innerHTML =
      '<div class="text-center py-12 text-red-500 font-bold"><i class="fa-solid fa-triangle-exclamation text-3xl mb-2"></i><br>Gagal memuat monitoring KBM</div>';
    showToast("Error", "Gagal load Monitoring KBM", "error");
  }
};

function renderRekapJurnalTable(matrix) {
  const container = document.getElementById("rekap-jurnal-container");
  const targetDateStr = document.getElementById("input-tanggal-rekap-jurnal")?.value || "";

  const activeJP = getActiveJPNumber(targetDateStr);

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const isPastDate = targetDateStr && targetDateStr < todayStr;

  const selectedDate = targetDateStr ? new Date(targetDateStr + "T00:00:00") : new Date();
  const dayOfWeek = selectedDate.getDay(); // 0 = Minggu, 1 = Senin, ..., 5 = Jumat
  let sortedKelas = Object.keys(matrix).sort(naturalSort);

  const masterTeachers = masterTeachersCache || [];
  const myCanonicalName = currentUserInfo?.nama ? (resolveOfficialTeacherName(currentUserInfo.nama, masterTeachers) || currentUserInfo.nama) : "";

  // Jika mode scope KBM = "me" (Saya), filter hanya kelas tempat guru mengajar pada tanggal ini
  if (kbmScopeMode === "me" && myCanonicalName) {
    sortedKelas = sortedKelas.filter((kelas) => {
      for (let jpNum = 1; jpNum <= 10; jpNum++) {
        if (!visibleJPJurnal.includes(jpNum)) continue;
        const cellData = matrix[kelas]?.[jpNum];
        if (!cellData) continue;
        const rawGName = cellData.jurnal?.guru || cellData.presensi?.guru || cellData.xml?.guru || "";
        if (!rawGName || rawGName === "-" || rawGName === "Belum diisi") continue;
        const cellGuru = resolveOfficialTeacherName(rawGName, masterTeachers);
        if (
          cellGuru === myCanonicalName ||
          rawGName === currentUserInfo?.nama ||
          cellGuru === currentUserInfo?.nama ||
          rawGName === myCanonicalName
        ) {
          return true;
        }
      }
      return false;
    });
  }

  // Hitung JP yang Tidak Belajar Efektif per Angkatan (jika pada JP yang telah berlalu kelas aktif KBM pada angkatan tersebut <= 2)
  const jpTidakEfektifAngkatanMap = buildJPTidakEfektifAngkatanMap(sortedKelas, matrix, targetDateStr);
  const activeAngkatans = [...new Set(sortedKelas.map(getAngkatanFromClass))];

  // Rekapitulasi jumlah status per JP (Footer Summary)
  const jpSummary = {};
  for (let jp = 1; jp <= 10; jp++) {
    jpSummary[jp] = {
      verified: 0,
      jurnalOnly: 0,
      pendingJurnal: 0,
      absentTK: 0,
      absentSIK: 0,
      kelasKosong: 0,
      upacara: 0,
      ekskul: 0,
      tidakEfektif: 0,
      belumBerjalan: 0,
      total: 0
    };
  }

  const holidayInfo = isHolidayDate(targetDateStr) ? getHolidayDateInfo(targetDateStr) : null;

  let html = "";
  if (holidayInfo) {
    const bannerLabel = holidayInfo.isSchoolHoliday ? "Hari Libur Sekolah" : "Hari Libur Nasional";
    html += `
      <div id="holiday-banner-monitoring" class="mb-3 px-3.5 py-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 rounded-xl flex items-center gap-2.5 text-rose-800 dark:text-rose-200 text-xs font-semibold shadow-xs">
        <i class="fa-solid fa-calendar-day text-rose-500 text-sm"></i>
        <span>${bannerLabel}: <strong>${escapeHTML(holidayInfo.title || holidayInfo.nama || holidayInfo.name || 'Hari Libur')}</strong> ${holidayInfo.isCutiBersama ? "(Cuti Bersama Resmi)" : ""}. Tidak ada kegiatan KBM efektif terjadwal.</span>
      </div>
    `;
  }

  html += `
    <table class="w-full text-sm text-left border border-slate-200 dark:border-slate-700 border-collapse">
        <thead class="bg-slate-700 dark:bg-slate-800 text-white text-xs uppercase sticky top-0 border-b border-slate-600 dark:border-slate-700 z-30">
            <tr>
                <th class="px-1.5 py-2 border border-slate-600 dark:border-slate-700 sticky left-0 bg-slate-700 dark:bg-slate-800 z-40 whitespace-nowrap text-center text-[11px]">Kelas</th>
                ${JP_LABELS.map((jp, idx) => {
                  const jpNum = idx + 1;
                  if (!visibleJPJurnal.includes(jpNum)) return "";
                  const isActive = jpNum === activeJP;
                  const isAllAngkatanTidakEfektif = activeAngkatans.length > 0 && activeAngkatans.every((angk) => jpTidakEfektifAngkatanMap[angk]?.[jpNum]);

                  if (isActive) {
                    return `
                      <th class="px-2.5 py-1.5 border-2 border-blue-400 dark:border-blue-400 bg-gradient-to-r from-blue-600 to-indigo-700 dark:from-blue-700 dark:to-indigo-900 text-white text-center min-w-[110px] shadow-md relative z-30" title="${jp} sedang berlangsung (${JP_TIME_CONFIG[idx].start} - ${JP_TIME_CONFIG[idx].end})">
                        <div class="flex flex-col items-center justify-center leading-tight">
                          <div class="flex items-center gap-1 font-extrabold text-xs">
                            <span class="w-1.5 h-1.5 rounded-full bg-amber-300 animate-ping shrink-0"></span>
                            <span>${jp}</span>
                            <span class="bg-amber-400 text-slate-950 text-[8.5px] font-black px-1 rounded-sm leading-none tracking-wider uppercase">AKTIF</span>
                          </div>
                          <div class="text-[9px] font-semibold text-blue-100 opacity-90 leading-none mt-0.5">${JP_TIME_CONFIG[idx].start}-${JP_TIME_CONFIG[idx].end}</div>
                        </div>
                      </th>
                    `;
                  } else if (isAllAngkatanTidakEfektif) {
                    return `
                      <th class="px-2 py-1.5 border border-slate-600 dark:border-slate-700 bg-slate-800/90 text-slate-400 text-center min-w-[100px]" title="${jp} (${JP_TIME_CONFIG[idx].start} - ${JP_TIME_CONFIG[idx].end}): Tidak Belajar Efektif (Seluruh Angkatan & Guru Kosong Jurnal)">
                        <div class="flex flex-col items-center justify-center leading-tight">
                          <div class="font-bold text-xs text-slate-300">${jp}</div>
                          <div class="text-[8.5px] font-extrabold text-slate-400 uppercase tracking-tight leading-none mt-0.5">Tidak Efektif</div>
                        </div>
                      </th>
                    `;
                  } else {
                    return `<th class="px-3 py-2.5 border border-slate-600 dark:border-slate-700 text-center min-w-[100px]">${jp}</th>`;
                  }
                }).join("")}
            </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 dark:divide-slate-700 bg-white dark:bg-slate-800">
  `;

  if (sortedKelas.length === 0) {
    if (kbmScopeMode === "me") {
      html += `
        <tr>
          <td colspan="11" class="p-8 text-center text-slate-400">
            <i class="fa-solid fa-calendar-xmark text-3xl mb-2 text-slate-400"></i>
            <p class="text-sm font-semibold text-slate-600 dark:text-slate-300">Tidak ada jadwal atau aktivitas KBM untuk Anda pada tanggal ini.</p>
            <p class="text-xs text-slate-400 mt-1">Gunakan tombol <button onclick="window.setKbmScopeMode('all')" class="text-blue-600 dark:text-blue-400 underline font-bold">Semua</button> untuk melihat status seluruh kelas.</p>
          </td>
        </tr>
      `;
    } else {
      html += `<tr><td colspan="11" class="p-8 text-center text-slate-400">Belum ada data kelas.</td></tr>`;
    }
  } else {
    sortedKelas.forEach((kelas, idx) => {
      const bgRow =
        idx % 2 === 0
          ? "bg-white dark:bg-slate-800"
          : "bg-slate-50 dark:bg-slate-800/50";

      // Grouping JP berurutan berdasarkan kombinasi data Guru + Siswa + XML
      const cellInfos = [];
      for (let jpNum = 1; jpNum <= 10; jpNum++) {
        if (!visibleJPJurnal.includes(jpNum)) continue;
        const cellData = matrix[kelas][jpNum];
        const { jurnal, presensi, xml } = cellData;

        // Ambil nama mapel & guru dari sumber terbaik yang ada
        let mapel = jurnal?.mapel || presensi?.mapel || xml?.mapel || "";
        let guru = jurnal?.guru || presensi?.guru || xml?.guru || "";
        let topik = jurnal?.topik || jurnal?.materi || "";
        let catatan = jurnal?.catatan || (presensi?.keterangan ? ("Kegiatan: " + presensi.keterangan) : "");
        let presensiDetail = Array.isArray(jurnal?.presensi_detail)
          ? jurnal.presensi_detail
          : (typeof jurnal?.presensi_detail === "string" ? (() => { try { return JSON.parse(jurnal.presensi_detail); } catch (e) { return []; } })() : []);
        let hasJurnal = Boolean(jurnal);
        let guruFoto = xml?.foto || "";
        let guruNip = xml?.nip || "";

        if ((!guruFoto || !guruNip) && guru && guru !== "-" && guru !== "Belum diisi") {
          const tObj = getTeacherObject(guru, masterTeachers);
          if (tObj) {
            if (!guruFoto) guruFoto = tObj.foto || tObj.photo_url || tObj.foto_url || tObj.avatar || "";
            if (!guruNip) guruNip = tObj.nip || "";
          }
        }

        let cellState = "EMPTY";
        let badgeText = "";
        let badgeClass = "";
        let cellBgClass = "";
        let mapelTextColor = "";
        let guruTextColor = "";
        let detailTooltip = "";

        const angk = getAngkatanFromClass(kelas);
        const isTidakEfektif = Boolean(jpTidakEfektifAngkatanMap[angk]?.[jpNum]);

        if (!holidayInfo && dayOfWeek === 1 && jpNum === 1) {
          // 🇮🇩 SENIN JP 1 = UPACARA BENDERA
          cellState = "UPACARA";
          mapel = "Upacara Bendera";
          guru = "Seluruh Guru & Siswa";
          badgeText = "🇮🇩 Upacara";
          badgeClass = "bg-indigo-100 dark:bg-indigo-900/80 text-indigo-800 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700";
          cellBgClass = "bg-indigo-50/80 dark:bg-indigo-950/30";
          mapelTextColor = "text-indigo-900 dark:text-indigo-200";
          guruTextColor = "text-indigo-700 dark:text-indigo-400";
          detailTooltip = "Upacara Bendera Mingguan Sekolah (Senin JP 1)";
        } else if (!holidayInfo && dayOfWeek === 5 && jpNum === 10) {
          // ⚽ JUMAT JP 10 = EKSTRAKURIKULER
          cellState = "EKSKUL";
          mapel = "Ekstrakurikuler";
          guru = "Pembina Ekskul";
          badgeText = "⚽ Ekstrakurikuler";
          badgeClass = "bg-purple-100 dark:bg-purple-900/80 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-700";
          cellBgClass = "bg-purple-50/80 dark:bg-purple-950/30";
          mapelTextColor = "text-purple-900 dark:text-purple-200";
          guruTextColor = "text-purple-700 dark:text-purple-400";
          detailTooltip = "Kegiatan Ekstrakurikuler Sekolah (Jumat JP 10)";
        } else if (!holidayInfo && !isJPStarted(jpNum, targetDateStr)) {
          // ⏳ JP BELUM BERJALAN -> STATUS DIKOSONGKAN DULU
          cellState = "BELUM_BERJALAN";
          badgeText = "";
          badgeClass = "";
          cellBgClass = "";
          mapelTextColor = "text-slate-800 dark:text-slate-200";
          guruTextColor = "text-slate-600 dark:text-slate-400";
          detailTooltip = "Belum Berjalan: Jam Pelajaran ini belum dimulai";
        } else if (!holidayInfo && isTidakEfektif) {
          // 🚫 TIDAK BELAJAR EFEKTIF PER ANGKATAN (Seluruh rombel di angkatan ini seragam berstatus Tidak Efektif)
          cellState = "TIDAK_EFEKTIF";
          badgeText = "🚫 Tidak Belajar Efektif";
          badgeClass = "bg-slate-200 dark:bg-slate-700/80 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 font-bold";
          cellBgClass = "bg-slate-100/80 dark:bg-slate-800/60";
          mapelTextColor = "text-slate-600 dark:text-slate-400";
          guruTextColor = "text-slate-500 dark:text-slate-500";
          detailTooltip = `🚫 Tidak Belajar Efektif: Angkatan ${angk} tidak melaksanakan KBM efektif pada JP ini (Try Out / Ujian / Rapat / Acara Sekolah)`;
        } else if (jurnal && presensi && presensi.status === "H") {
          // 🟢 TERVERIFIKASI LENGKAP (Jurnal Scan Barcode Guru + Presensi Guru Hadir oleh Siswa)
          cellState = "VERIFIED";
          badgeText = "🟢 Terverifikasi";
          badgeClass = "bg-emerald-100 dark:bg-emerald-900/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700";
          cellBgClass = "bg-emerald-50/80 dark:bg-emerald-950/30";
          mapelTextColor = "text-emerald-900 dark:text-emerald-200";
          guruTextColor = "text-emerald-700 dark:text-emerald-400";
          detailTooltip = "🟢 Terverifikasi Sempurna: Jurnal KBM Guru Terisi (Scan Barcode) & Presensi Kehadiran Guru oleh Siswa Berstatus Hadir (H)";
        } else if (jurnal && (!presensi || !presensi.status)) {
          // 🩵 JURNAL GURU ADA (SCAN BARCODE), SISWA BELUM MENGABSEN GURU
          cellState = "JURNAL_ONLY";
          badgeText = "🩵 Belum Diabsen Siswa";
          badgeClass = "bg-sky-100 dark:bg-sky-900/80 text-sky-800 dark:text-sky-300 border border-sky-300 dark:border-sky-700";
          cellBgClass = "bg-sky-50/80 dark:bg-sky-950/30";
          mapelTextColor = "text-sky-900 dark:text-sky-200";
          guruTextColor = "text-sky-800 dark:text-sky-300";
          detailTooltip = "🩵 Jurnal Guru Sudah Terisi (Scan Barcode), Namun Siswa/Admin Kelas Belum Mengisi Presensi Kehadiran Guru";
        } else if (presensi && ["S", "I", "L", "K"].includes(presensi.status)) {
          // 🟡/🔵/🟣 KONDISI KHUSUS PRESENSI GURU (SAKIT / IZIN / KEGIATAN DINAS) PADA JP EFEKTIF
          const st = presensi.status;
          cellState = `ABSENT_${st}`;
          if (st === "K") {
            const ketText = (presensi.keterangan || "").trim();
            badgeText = "🟣 Kegiatan";
            badgeClass = "bg-purple-100 dark:bg-purple-900/80 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-700";
            cellBgClass = "bg-purple-50/80 dark:bg-purple-950/30";
            mapelTextColor = "text-purple-900 dark:text-purple-200";
            guruTextColor = "text-purple-800 dark:text-purple-300";
            detailTooltip = ketText
              ? `🟣 Kegiatan: ${ketText}`
              : "🟣 Kegiatan: Guru Tugas Dinas / Panitia / Lomba di Sekolah maupun Luar Sekolah";
          } else if (st === "S") {
            badgeText = "🟡 Guru Sakit";
            badgeClass = "bg-yellow-100 dark:bg-yellow-900/80 text-yellow-800 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-700";
            cellBgClass = "bg-yellow-50/80 dark:bg-yellow-950/30";
            mapelTextColor = "text-yellow-900 dark:text-yellow-200";
            guruTextColor = "text-yellow-800 dark:text-yellow-300";
            detailTooltip = "🟡 Guru Sakit: Guru Berhalangan Hadir Karena Sakit";
          } else if (st === "I" || st === "L") {
            badgeText = "🔵 Guru Izin";
            badgeClass = "bg-blue-100 dark:bg-blue-900/80 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-700";
            cellBgClass = "bg-blue-50/80 dark:bg-blue-950/30";
            mapelTextColor = "text-blue-900 dark:text-blue-200";
            guruTextColor = "text-blue-800 dark:text-blue-300";
            detailTooltip = "🔵 Guru Izin: Guru Izin Kepentingan Pribadi / Keluarga / Upacara Agama";
          }
        } else if (presensi && ["TK", "TT", "A"].includes(presensi.status)) {
          // 🔴 TANPA KETERANGAN (TK) PADA JP EFEKTIF
          cellState = `ABSENT_${presensi.status}`;
          badgeText = "🔴 Tanpa Keterangan (TK)";
          badgeClass = "bg-rose-100 dark:bg-rose-900/80 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700";
          cellBgClass = "bg-rose-50/80 dark:bg-rose-950/30";
          mapelTextColor = "text-rose-900 dark:text-rose-200";
          guruTextColor = "text-rose-800 dark:text-rose-300";
          detailTooltip = "🔴 Tanpa Keterangan (TK): Guru Tidak Masuk Kelas & Tanpa Pemberitahuan";
        } else if (holidayInfo) {
          // 🏖️ HARI LIBUR SEKOLAH / LIBUR NASIONAL RESMI (Tidak ada KBM efektif terjadwal, nonaktifkan TE)
          cellState = "LIBUR";
          badgeText = holidayInfo.isSchoolHoliday ? "🏖️ Libur Sekolah" : "🏖️ Libur Nasional";
          badgeClass = "bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-200 border border-rose-300 dark:border-rose-700 font-bold";
          cellBgClass = "bg-rose-50/60 dark:bg-rose-950/20";
          mapelTextColor = "text-rose-900 dark:text-rose-200";
          guruTextColor = "text-rose-700 dark:text-rose-300";
          detailTooltip = `${badgeText}: Tidak ada kegiatan KBM efektif terjadwal (${holidayInfo.title || holidayInfo.nama || holidayInfo.name || 'Hari Libur'})`;
        } else if (!jurnal && (!presensi || !presensi.status) && isJPElapsed(jpNum, targetDateStr)) {
          // 🟧 KELAS KOSONG (JP Sudah Lewat, Jurnal Guru Kosong & Siswa Tidak Mengisi Presensi Guru)
          cellState = "KELAS_KOSONG";
          badgeText = "🟧 Kelas Kosong";
          badgeClass = "bg-orange-100 dark:bg-orange-900/80 text-orange-800 dark:text-orange-300 border border-orange-300 dark:border-orange-700 font-bold";
          cellBgClass = "bg-orange-50/70 dark:bg-orange-950/30";
          mapelTextColor = "text-orange-900 dark:text-orange-200";
          guruTextColor = "text-orange-800 dark:text-orange-300";
          detailTooltip = "🟧 Kelas Kosong: JP Sudah Lewat, Guru Belum Mengisi Jurnal KBM & Siswa Belum Mengisi Presensi Kehadiran Guru";
        } else if (!jurnal && (presensi?.status === "H" || xml)) {
          // 🟨 PRESENSI GURU HADIR OLEH SISWA ATAU JADWAL XML (JURNAL GURU VIA SCAN BARCODE BELUM)
          cellState = "PENDING_JURNAL";
          const jpLewat = isJPElapsed(jpNum, targetDateStr);
          badgeText = jpLewat ? "Jurnal Kosong" : "Belum Isi Jurnal";
          badgeClass = jpLewat
            ? "bg-rose-100 dark:bg-rose-900/80 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700"
            : "bg-amber-100 dark:bg-amber-900/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700";
          cellBgClass = jpLewat
            ? "bg-rose-50/70 dark:bg-rose-950/30"
            : "bg-amber-50/70 dark:bg-amber-950/30";
          mapelTextColor = jpLewat ? "text-rose-900 dark:text-rose-200" : "text-amber-900 dark:text-amber-200";
          guruTextColor = jpLewat ? "text-rose-800 dark:text-rose-300" : "text-amber-800 dark:text-amber-300";
          detailTooltip = jpLewat
            ? "🔴 Jurnal Kosong: JP Sudah Lewat & Guru Belum Mengisi Jurnal KBM via Scan Barcode"
            : "🟡 Belum Isi Jurnal: Presensi Guru Hadir Terisi oleh Siswa / Terjadwal, Namun Guru Belum Mengisi Jurnal KBM via Scan Barcode Hari Ini";
        } else if (!jurnal && (!presensi || !presensi.status) && !xml) {
          // 🟧 KELAS KOSONG MURNI (Tidak ada Jadwal XML, Jurnal Guru Kosong & Siswa Tidak Mengisi Presensi Guru)
          cellState = "KELAS_KOSONG";
          badgeText = "🟧 Kelas Kosong";
          badgeClass = "bg-orange-100 dark:bg-orange-900/80 text-orange-800 dark:text-orange-300 border border-orange-300 dark:border-orange-700 font-bold";
          cellBgClass = "bg-orange-50/70 dark:bg-orange-950/30";
          mapelTextColor = "text-orange-900 dark:text-orange-200";
          guruTextColor = "text-orange-800 dark:text-orange-300";
          detailTooltip = "🟧 Kelas Kosong: Tidak ada jadwal KBM terjadwal pada jam ini";
        }

        // Akumulasi ringkasan per JP
        if (visibleJPJurnal.includes(jpNum)) {
          jpSummary[jpNum].total++;
          if (cellState === "VERIFIED") jpSummary[jpNum].verified++;
          else if (cellState === "JURNAL_ONLY") jpSummary[jpNum].jurnalOnly++;
          else if (cellState === "PENDING_JURNAL") jpSummary[jpNum].pendingJurnal++;
          else if (cellState === "ABSENT_TK" || cellState === "ABSENT_TT" || cellState === "ABSENT_A") jpSummary[jpNum].absentTK++;
          else if (cellState.startsWith("ABSENT_")) jpSummary[jpNum].absentSIK++;
          else if (cellState === "KELAS_KOSONG") jpSummary[jpNum].kelasKosong++;
          else if (cellState === "UPACARA") jpSummary[jpNum].upacara++;
          else if (cellState === "EKSKUL") jpSummary[jpNum].ekskul++;
          else if (cellState === "TIDAK_EFEKTIF" || cellState === "LIBUR") jpSummary[jpNum].tidakEfektif++;
          else if (cellState === "BELUM_BERJALAN") jpSummary[jpNum].belumBerjalan++;
        }

        cellInfos.push({
          jp: jpNum,
          guru,
          guruFoto,
          guruNip,
          topik,
          catatan,
          presensiDetail,
          hasJurnal,
          mapel,
          cellState,
          badgeText,
          badgeClass,
          cellBgClass,
          mapelTextColor,
          guruTextColor,
          detailTooltip,
          isEmpty: !mapel && !guru && cellState !== "LIBUR" && cellState !== "UPACARA" && cellState !== "EKSKUL"
        });
      }

      const groups = [];
      for (const cell of cellInfos) {
        const last = groups.length > 0 ? groups[groups.length - 1] : null;
        if (
          last &&
          last.isEmpty === cell.isEmpty &&
          last.cellState === cell.cellState &&
          last.guru === cell.guru &&
          last.mapel === cell.mapel
        ) {
          last.span++;
          last.jps.push(cell.jp);
          if (!last.guruFoto && cell.guruFoto) last.guruFoto = cell.guruFoto;
          if (!last.guruNip && cell.guruNip) last.guruNip = cell.guruNip;
          if (!last.topik && cell.topik) last.topik = cell.topik;
          if (!last.catatan && cell.catatan) last.catatan = cell.catatan;
          if (!last.hasJurnal && cell.hasJurnal) last.hasJurnal = true;
          if ((!last.presensiDetail || last.presensiDetail.length === 0) && cell.presensiDetail && cell.presensiDetail.length > 0) {
            last.presensiDetail = cell.presensiDetail;
          }
        } else {
          groups.push({
            ...cell,
            span: 1,
            jps: [cell.jp]
          });
        }
      }

      html += `
            <tr class="hover:bg-blue-50/50 dark:hover:bg-slate-700/50 transition-colors ${bgRow}">
                <td class="px-1.5 py-1.5 font-bold text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 sticky left-0 ${bgRow} z-10 shadow-sm whitespace-nowrap text-xs text-center">${escapeHTML(kelas)}</td>
                ${groups.map((g) => {
                  const colspanAttr = g.span > 1 ? ` colspan="${g.span}"` : '';
                  const jpText = g.jps.length > 1 ? `JP ${g.jps[0]} - ${g.jps[g.jps.length - 1]}` : `JP ${g.jps[0]}`;
                  const isCellActive = activeJP && g.jps.includes(activeJP);
                  const activeCellClass = isCellActive ? "ring-2 ring-blue-500/80 dark:ring-blue-400/80 z-10 shadow-sm" : "";

                  const gCanonical = g.guru ? resolveOfficialTeacherName(g.guru, masterTeachers) : "";
                  const isMySlot = Boolean(
                    myCanonicalName &&
                    g.guru &&
                    (gCanonical === myCanonicalName ||
                     g.guru === currentUserInfo?.nama ||
                     gCanonical === currentUserInfo?.nama ||
                     g.guru === myCanonicalName)
                  );

                  let slotHighlightClass = "";
                  let mySlotBadgeHtml = "";

                  if (isMySlot) {
                    slotHighlightClass = "ring-2 ring-blue-500/90 dark:ring-blue-400/90 bg-blue-50/90 dark:bg-blue-950/60 shadow-sm relative z-20";
                    mySlotBadgeHtml = `<div class="mb-1 text-center"><span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-600 text-white text-[8.5px] font-black uppercase tracking-wider shadow-2xs"><i class="fa-solid fa-user-check text-[7.5px]"></i> Jadwal Anda</span></div>`;
                  } else if (kbmScopeMode === "me") {
                    slotHighlightClass = "opacity-50 grayscale-[40%] bg-slate-50/30 dark:bg-slate-900/30 hover:opacity-100 hover:grayscale-0 transition-all";
                  }

                  if (g.cellState === "UPACARA" || g.cellState === "EKSKUL" || g.cellState === "LIBUR") {
                    const label = g.cellState === "UPACARA" ? "🇮🇩 Upacara Bendera" : (g.cellState === "EKSKUL" ? "⚽ Ekstrakurikuler" : g.badgeText);
                    return `
                      <td${colspanAttr} 
                        class="px-2 py-1 text-center align-middle border border-slate-200 dark:border-slate-700 ${g.cellBgClass} cursor-pointer hover:opacity-80 active:scale-[0.98] transition-all kbm-cell-clickable ${activeCellClass} ${kbmScopeMode === 'me' ? 'opacity-50' : ''}"
                        title="${escapeHTML(g.detailTooltip)}"
                        data-kelas="${escapeHTML(kelas)}"
                        data-jp="${jpText}"
                        data-first-jp="${g.jps[0]}"
                        data-mapel="${escapeHTML(g.mapel || holidayInfo?.title || 'Libur')}"
                        data-guru="${escapeHTML(g.guru || '-')}"
                        data-guru-foto=""
                        data-guru-nip=""
                        data-topik=""
                        data-catatan=""
                        data-has-jurnal="false"
                        data-badge="${escapeHTML(g.badgeText)}"
                        data-badge-class="${escapeHTML(g.badgeClass)}"
                        data-tooltip="${escapeHTML(g.detailTooltip)}"
                      >
                          <span class="inline-block px-2 py-0.5 rounded text-[10px] font-extrabold ${g.badgeClass}">${escapeHTML(label)}</span>
                      </td>
                    `;
                  } else if (g.isEmpty) {
                    return `
                      <td${colspanAttr} 
                        class="px-2 py-2 text-center border border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600 text-xs italic cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/40 active:scale-[0.98] transition-all kbm-cell-clickable ${activeCellClass} ${kbmScopeMode === 'me' ? 'opacity-40' : ''}"
                        title="Kosong (Tidak Ada Jadwal / Jurnal)"
                        data-kelas="${escapeHTML(kelas)}"
                        data-jp="${jpText}"
                        data-first-jp="${g.jps[0]}"
                        data-mapel="Kosong"
                        data-guru="-"
                        data-guru-foto=""
                        data-guru-nip=""
                        data-topik=""
                        data-catatan=""
                        data-has-jurnal="false"
                        data-badge="Kosong"
                        data-badge-class="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-600"
                        data-tooltip="Tidak ada kegiatan KBM atau jadwal terpeta pada JP ini."
                      >-</td>
                    `;
                  } else {
                    const guruDisplayName = isMySlot
                      ? `<div class="text-[10px] text-blue-700 dark:text-blue-300 font-extrabold text-center leading-tight mt-0.5 break-words flex items-center justify-center gap-1"><i class="fa-solid fa-circle-user text-[10px] text-blue-500"></i> ${escapeHTML(g.guru)}</div>`
                      : `<div class="text-[10px] ${g.guruTextColor} font-medium text-center leading-tight mt-0.5 break-words">${escapeHTML(g.guru)}</div>`;

                    // Corner Micro-Avatar untuk sel yang memiliki foto guru (0px impact ke dimensi baris karena position: absolute)
                    const resolvedCornerFoto = g.guruFoto ? resolvePhotoUrl(g.guruFoto) : "";
                    const cornerRingClass = isCellActive ? "ring-1.5 ring-amber-400 dark:ring-amber-300 shadow-xs" : "ring-1 ring-blue-400/50 dark:ring-blue-500/40 shadow-2xs";
                    const cornerAvatarHtml = resolvedCornerFoto
                      ? `<div class="absolute top-0.5 right-0.5 pointer-events-none z-10" title="Guru: ${escapeHTML(g.guru)}">
                           <img 
                             src="${escapeHTML(resolvedCornerFoto)}" 
                             alt="${escapeHTML(g.guru)}" 
                             class="w-6 h-6 rounded-full object-cover border border-white dark:border-slate-800 ${cornerRingClass} shadow-xs pointer-events-auto cursor-zoom-in transition-transform duration-200 ease-out origin-top-right hover:scale-[3.2] hover:z-50 hover:shadow-xl hover:ring-2 hover:ring-blue-500 dark:hover:ring-blue-400" 
                             loading="lazy"
                             onerror="this.style.display='none'"
                           />
                         </div>`
                      : "";

                    return `
                      <td${colspanAttr} 
                        class="relative px-1.5 py-1 text-center align-middle border border-slate-200 dark:border-slate-700 ${g.cellBgClass} cursor-pointer hover:opacity-90 active:scale-[0.98] transition-all kbm-cell-clickable ${activeCellClass} ${slotHighlightClass}"
                        title="${escapeHTML(g.detailTooltip)}"
                        data-kelas="${escapeHTML(kelas)}"
                        data-jp="${jpText}"
                        data-first-jp="${g.jps[0]}"
                        data-mapel="${escapeHTML(g.mapel)}"
                        data-guru="${escapeHTML(g.guru)}"
                        data-guru-foto="${escapeHTML(g.guruFoto || '')}"
                        data-guru-nip="${escapeHTML(g.guruNip || '')}"
                        data-topik="${escapeHTML(g.topik || '')}"
                        data-catatan="${escapeHTML(g.catatan || '')}"
                        data-has-jurnal="${g.hasJurnal ? 'true' : 'false'}"
                        data-badge="${escapeHTML(g.badgeText)}"
                        data-badge-class="${escapeHTML(g.badgeClass)}"
                        data-tooltip="${escapeHTML(g.detailTooltip)}"
                      >
                          ${cornerAvatarHtml}
                          ${mySlotBadgeHtml}
                          <div class="font-bold text-xs ${g.mapelTextColor} text-center leading-tight break-words">${escapeHTML(g.mapel)}</div>
                          ${guruDisplayName}
                          ${g.badgeText ? `<div class="mt-0.5 text-center"><span class="inline-block px-1.5 py-0.5 rounded text-[9px] font-extrabold ${g.badgeClass}">${g.badgeText}</span></div>` : ''}
                      </td>
                    `;
                  }
                }).join("")}
            </tr>
        `;
    });
  }

  html += `</tbody>`;

  // Render Footer Rekapan per JP
  if (sortedKelas.length > 0) {
    html += `
      <tfoot class="bg-slate-100 dark:bg-slate-800/90 text-xs font-semibold border-t-2 border-slate-400 dark:border-slate-600 sticky bottom-0 z-30 shadow-md">
        <tr>
          <td class="px-1.5 py-2 font-bold bg-slate-700 dark:bg-slate-800 text-white sticky left-0 z-40 border border-slate-600 shadow-r text-[10px] text-center whitespace-nowrap">
            ${sortedKelas.length} Kelas
          </td>
          ${JP_LABELS.map((jp, idx) => {
            const jpNum = idx + 1;
            if (!visibleJPJurnal.includes(jpNum)) return "";
            const sum = jpSummary[jpNum];

            // Skip rekapan untuk JP Upacara, Ekskul, dan Tidak Efektif / Libur
            if (sum.upacara > 0 || sum.ekskul > 0 || (sum.tidakEfektif > 0 && sum.verified === 0) || (holidayInfo && sum.verified === 0)) {
              return `<td class="px-2 py-2 text-center border border-slate-300 dark:border-slate-700 bg-slate-100/50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-600 text-[10px] italic" title="Hari Libur / Tidak Efektif">—</td>`;
            }

            // Jika JP belum berjalan dan belum ada aktivitas KBM terisi
            if (!isJPStarted(jpNum, targetDateStr) && (sum.verified + sum.jurnalOnly + sum.pendingJurnal + sum.absentTK + sum.absentSIK + sum.kelasKosong === 0)) {
              return `<td class="px-2 py-2 text-center border border-slate-300 dark:border-slate-700 bg-slate-100/50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-600 text-[10px] italic" title="${jp} belum berjalan">—</td>`;
            }

            const kbmAktif = sum.verified + sum.jurnalOnly + sum.pendingJurnal;
            const pctKBMAktif = sum.total > 0 ? Math.round((kbmAktif / sum.total) * 100) : 0;

            return `
              <td class="px-2 py-2 border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 align-top min-w-[105px]">
                <div class="flex flex-col gap-1 text-[10px] font-semibold leading-tight">
                  <!-- Progress Bar KBM Aktif -->
                  <div class="pb-1 border-b border-slate-200 dark:border-slate-700">
                    <div class="flex items-center justify-between font-extrabold text-blue-700 dark:text-blue-400 text-[10.5px]">
                      <span title="KBM Aktif: Terverifikasi + Blm Jurnal + Blm Presensi">📘 ${kbmAktif}</span>
                      <span>${pctKBMAktif}%</span>
                    </div>
                    <div class="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden mt-0.5">
                      <div class="bg-blue-500 h-full rounded-full transition-all duration-300" style="width: ${pctKBMAktif}%"></div>
                    </div>
                  </div>

                  <!-- Detail Breakdown Status -->
                  <div class="space-y-0.5 text-[9.5px]">
                    ${sum.verified > 0 ? `<div class="flex justify-between items-center text-emerald-800 dark:text-emerald-300" title="Terverifikasi: Guru isi jurnal & Siswa presensi Hadir"><span>🟢 Terverifikasi:</span><span class="font-bold">${sum.verified}</span></div>` : ""}
                    ${sum.jurnalOnly > 0 ? `<div class="flex justify-between items-center text-sky-800 dark:text-sky-300" title="Jurnal terisi, siswa belum presensi"><span>🩵 Blm Presensi:</span><span class="font-bold">${sum.jurnalOnly}</span></div>` : ""}
                    ${sum.pendingJurnal > 0 ? `<div class="flex justify-between items-center text-amber-800 dark:text-amber-300" title="Siswa presensi Hadir, jurnal belum terisi"><span>🟡 Blm Jurnal:</span><span class="font-bold">${sum.pendingJurnal}</span></div>` : ""}
                    ${sum.absentTK > 0 ? `<div class="flex justify-between items-center text-rose-800 dark:text-rose-300" title="Guru Tanpa Keterangan (TK)"><span>🔴 Guru TK:</span><span class="font-bold">${sum.absentTK}</span></div>` : ""}
                    ${sum.absentSIK > 0 ? `<div class="flex justify-between items-center text-blue-800 dark:text-blue-300" title="Guru Sakit/Izin/Kegiatan"><span>🏥 S/I/K:</span><span class="font-bold">${sum.absentSIK}</span></div>` : ""}
                    ${sum.kelasKosong > 0 ? `<div class="flex justify-between items-center text-orange-800 dark:text-orange-300" title="JP sudah lewat, jurnal guru & presensi guru oleh siswa keduanya kosong"><span>🟧 Kelas Kosong:</span><span class="font-bold">${sum.kelasKosong}</span></div>` : ""}
                  </div>
                </div>
              </td>
            `;
          }).join("")}
        </tr>
      </tfoot>
    `;
  }

  html += `</table>`;
  container.innerHTML = html;
  setupCellClickDelegation();
  setupDesktopStickyFooter();
}

// Setup max-height on desktop so tfoot sticky bottom-0 pins to viewport bottom
function setupDesktopStickyFooter() {
  const container = document.getElementById("rekap-jurnal-container");
  if (!container) return;

  function applyMaxHeight() {
    if (window.innerWidth >= 1024) { // lg breakpoint
      const rect = container.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const calculatedMaxH = viewportHeight - rect.top - 20; // 20px bottom margin
      const minPreferredH = Math.floor(viewportHeight * 0.70); // Minimal 70% viewport height
      container.style.maxHeight = Math.max(650, minPreferredH, calculatedMaxH) + "px";
    } else {
      container.style.maxHeight = "none";
    }
  }

  applyMaxHeight();
  // Debounced resize handler
  let resizeTimer;
  const handleResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyMaxHeight, 150);
  };
  window.removeEventListener("resize", window._stickyFooterResize);
  window._stickyFooterResize = handleResize;
  window.addEventListener("resize", handleResize);
}




function setupStickyScrollbarJurnal() {
  const container = document.getElementById("rekap-jurnal-container");
  const wrapper = document.getElementById("rekap-jurnal-scrollbar-wrapper");
  const scrollbar = document.getElementById("rekap-jurnal-scrollbar");
  const content = document.getElementById("rekap-jurnal-scrollbar-content");

  if (!container || !wrapper || !scrollbar || !content) return;

  const updateScrollbar = () => {
    const table = container.querySelector("table");
    if (!table) return;

    if (container.scrollWidth > container.clientWidth) {
      wrapper.classList.remove("hidden");
      content.style.width = `${table.scrollWidth || container.scrollWidth}px`;

      scrollbar.onscroll = () => {
        container.scrollLeft = scrollbar.scrollLeft;
      };
      container.onscroll = () => {
        scrollbar.scrollLeft = container.scrollLeft;
      };
    } else {
      wrapper.classList.add("hidden");
    }
  };

  setTimeout(updateScrollbar, 100);
  setTimeout(updateScrollbar, 300);

  window.removeEventListener("resize", updateScrollbar);
  window.addEventListener("resize", updateScrollbar);
}

// Helper badge status absensi siswa di modal monitoring KBM
function getStudentStatusInfo(st) {
  const s = (st || "").toUpperCase();
  switch (s) {
    case "S":
      return { label: "Sakit", class: "bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-700" };
    case "I":
      return { label: "Izin", class: "bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-700" };
    case "A":
    case "TK":
      return { label: "Alpa", class: "bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700" };
    case "T":
      return { label: "Terlambat", class: "bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-300 border border-orange-300 dark:border-orange-700" };
    case "D":
      return { label: "Dispensasi", class: "bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-700" };
    default:
      return { label: s || "Absen", class: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600" };
  }
}

// === CELL CLICK DELEGATION & POPUP MODAL (MOBILE & DESKTOP) ===
window.showKbmCellDetail = function (kelas, jpText, mapel, guru, badgeText, badgeClass, tooltipText, extraData = {}) {
  const modal = document.getElementById("modal-kbm-cell-detail");
  if (!modal) return;

  const elKelas = document.getElementById("kbm-detail-kelas");
  const elJp = document.getElementById("kbm-detail-jp");
  const elMapel = document.getElementById("kbm-detail-mapel");
  const elGuru = document.getElementById("kbm-detail-guru");
  const elGuruNip = document.getElementById("kbm-detail-guru-nip");
  const elGuruFoto = document.getElementById("kbm-detail-guru-foto");
  const elGuruPlaceholder = document.getElementById("kbm-detail-guru-placeholder");
  const elGuruInitial = document.getElementById("kbm-detail-guru-initial");
  const elMateriContainer = document.getElementById("kbm-detail-materi-container");
  const elMateri = document.getElementById("kbm-detail-materi");
  const elCatatanContainer = document.getElementById("kbm-detail-catatan-container");
  const elCatatan = document.getElementById("kbm-detail-catatan");
  const elPresensiContainer = document.getElementById("kbm-detail-presensi-container");
  const elPresensiSummary = document.getElementById("kbm-detail-presensi-summary");
  const elPresensiList = document.getElementById("kbm-detail-presensi-list");
  const elBadge = document.getElementById("kbm-detail-badge");
  const elTooltip = document.getElementById("kbm-detail-tooltip");

  if (elKelas) elKelas.textContent = kelas || "-";
  if (elJp) elJp.textContent = jpText || "-";
  if (elMapel) elMapel.textContent = mapel || "-";
  if (elGuru) elGuru.textContent = guru || "-";

  const guruName = guru && guru !== "-" && guru !== "Belum diisi" ? guru : "";
  let rawFoto = extraData?.guruFoto || "";
  let nip = extraData?.guruNip || "";
  const topik = extraData?.topik || "";
  const rawCatatan = (extraData?.catatan || "").trim();
  const hasJurnal = Boolean(extraData?.hasJurnal);
  const presensiList = Array.isArray(extraData?.presensiDetail) ? extraData.presensiDetail : [];

  // Fallback lookup ke master guru jika foto/nip belum terisi dari dataset
  if ((!rawFoto || !nip) && guruName) {
    const tObj = getTeacherObject(guruName, masterTeachersCache);
    if (tObj) {
      if (!rawFoto) rawFoto = tObj.foto || tObj.photo_url || tObj.foto_url || tObj.avatar || "";
      if (!nip) nip = tObj.nip || "";
    }
  }

  // Render NIP
  if (elGuruNip) {
    if (nip && nip !== "-" && nip !== "null" && nip !== "undefined") {
      elGuruNip.textContent = `NIP: ${nip}`;
      elGuruNip.classList.remove("hidden");
    } else {
      elGuruNip.textContent = "";
      elGuruNip.classList.add("hidden");
    }
  }

  // Render Avatar Foto & Inisial Placeholder
  if (elGuruFoto && elGuruPlaceholder) {
    const resolvedFoto = rawFoto ? resolvePhotoUrl(rawFoto) : "";
    if (resolvedFoto) {
      elGuruFoto.src = resolvedFoto;
      elGuruFoto.classList.remove("hidden");
      elGuruPlaceholder.classList.add("hidden");
      elGuruFoto.onerror = () => {
        elGuruFoto.classList.add("hidden");
        elGuruPlaceholder.classList.remove("hidden");
      };
    } else {
      elGuruFoto.classList.add("hidden");
      elGuruPlaceholder.classList.remove("hidden");
    }
  }

  if (elGuruInitial) {
    if (guruName) {
      const parts = guruName.replace(/^(Drs\.|Dr\.|Ir\.|H\.|Hj\.)\s+/i, "").trim().split(/\s+/);
      const initials = parts.length > 1
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : (parts[0] ? parts[0].slice(0, 2).toUpperCase() : "-");
      elGuruInitial.textContent = initials;
    } else {
      elGuruInitial.textContent = "-";
    }
  }

  // Render Materi / Topik Jurnal
  if (elMateriContainer && elMateri) {
    if (topik) {
      elMateri.textContent = `"${topik}"`;
      elMateriContainer.classList.remove("hidden");
    } else {
      elMateri.textContent = "";
      elMateriContainer.classList.add("hidden");
    }
  }

  // Render Catatan Guru
  if (elCatatanContainer && elCatatan) {
    if (rawCatatan) {
      elCatatan.textContent = rawCatatan;
      elCatatanContainer.classList.remove("hidden");
    } else {
      elCatatan.textContent = "";
      elCatatanContainer.classList.add("hidden");
    }
  }

  // Render Kehadiran Siswa
  if (elPresensiContainer && elPresensiList) {
    if (!hasJurnal) {
      if (elPresensiSummary) elPresensiSummary.textContent = "Belum Ada Jurnal";
      elPresensiList.innerHTML = `
        <div class="flex items-center gap-2 p-2 rounded-lg bg-slate-100/70 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-[11px]">
          <i class="fa-solid fa-circle-info text-xs text-slate-400 shrink-0"></i>
          <span>Jurnal belum diisi oleh guru pengampu, rincian kehadiran siswa belum tersedia.</span>
        </div>
      `;
    } else if (presensiList.length === 0) {
      if (elPresensiSummary) {
        elPresensiSummary.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-extrabold"><i class="fa-solid fa-circle-check text-[9px] mr-1"></i>100% Hadir</span>`;
      }
      elPresensiList.innerHTML = `
        <div class="flex items-center gap-2 p-2 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40 text-emerald-800 dark:text-emerald-300 text-[11px] font-semibold">
          <i class="fa-solid fa-check-double text-emerald-600 dark:text-emerald-400 text-xs shrink-0"></i>
          <span>Seluruh siswa hadir lengkap di kelas (Nihil Absen & Terlambat).</span>
        </div>
      `;
    } else {
      if (elPresensiSummary) {
        elPresensiSummary.innerHTML = `<span class="text-rose-600 dark:text-rose-400 font-extrabold">${presensiList.length} Siswa Absen/Telat</span>`;
      }
      let listHtml = `<div class="max-h-28 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">`;
      presensiList.forEach((item) => {
        const info = getStudentStatusInfo(item.status);
        const absenText = item.absen ? `No. ${escapeHTML(String(item.absen))}` : (item.nis ? `NIS ${escapeHTML(String(item.nis))}` : "");
        listHtml += `
          <div class="flex items-center justify-between gap-2 p-1.5 px-2 rounded-lg bg-white dark:bg-slate-800/90 border border-slate-200/70 dark:border-slate-700/60 text-[11px]">
            <div class="min-w-0 flex-1 flex items-center gap-1.5 truncate">
              ${absenText ? `<span class="text-[9.5px] font-bold text-slate-400 dark:text-slate-500 shrink-0">${absenText}</span>` : ""}
              <span class="font-bold text-slate-800 dark:text-slate-200 truncate">${escapeHTML(item.nama || "-")}</span>
            </div>
            <span class="px-1.5 py-0.5 rounded text-[9.5px] font-extrabold shrink-0 ${info.class}">${info.label}</span>
          </div>
        `;
      });
      listHtml += `</div>`;
      elPresensiList.innerHTML = listHtml;
    }
  }

  if (elBadge) {
    if (badgeText) {
      elBadge.textContent = badgeText;
      elBadge.className = `font-extrabold text-[10px] px-2 py-1 rounded-lg border w-fit shadow-2xs ${badgeClass || ""}`;
    } else {
      elBadge.textContent = "⏳ Belum Berjalan";
      elBadge.className = "font-extrabold text-[10px] px-2 py-1 rounded-lg border w-fit shadow-2xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-600";
    }
  }

  if (elTooltip) {
    elTooltip.textContent = tooltipText || "-";
  }

  modal.classList.remove("hidden");
};

function setupCellClickDelegation() {
  const container = document.getElementById("rekap-jurnal-container");
  if (!container || container.dataset.clickBound) return;

  container.dataset.clickBound = "true";
  container.addEventListener("click", (e) => {
    const cell = e.target.closest(".kbm-cell-clickable");
    if (!cell) return;

    const {
      kelas,
      jp,
      firstJp,
      mapel,
      guru,
      guruFoto,
      guruNip,
      topik,
      catatan,
      hasJurnal,
      badge,
      badgeClass,
      tooltip
    } = cell.dataset;

    let activeCatatan = catatan || "";
    let isJurnalPresent = hasJurnal === "true";
    let presensiDetail = [];

    // Prioritaskan in-memory matrix (SSOT) jika tersedia
    const jpNum = parseInt(firstJp, 10);
    if (window.currentJurnalMatrix && kelas && jpNum) {
      if (window.currentJurnalMatrix[kelas]?.[jpNum]?.jurnal) {
        const jObj = window.currentJurnalMatrix[kelas][jpNum].jurnal;
        isJurnalPresent = true;
        if (!activeCatatan && jObj.catatan) activeCatatan = jObj.catatan;
        if (Array.isArray(jObj.presensi_detail)) presensiDetail = jObj.presensi_detail;
      }
      if (!activeCatatan && window.currentJurnalMatrix[kelas]?.[jpNum]?.presensi?.keterangan) {
        activeCatatan = `Kegiatan: ${window.currentJurnalMatrix[kelas][jpNum].presensi.keterangan}`;
      }
    }

    window.showKbmCellDetail(kelas, jp, mapel, guru, badge, badgeClass, tooltip, {
      guruFoto: guruFoto || "",
      guruNip: guruNip || "",
      topik: topik || "",
      catatan: activeCatatan,
      hasJurnal: isJurnalPresent,
      presensiDetail: presensiDetail
    });
  });
}

// === TAB 4: REKAP GURU ===
function initGuruPeriodeInputs() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diffToMonday);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  const elStart = document.getElementById("tanggal-mulai");
  const elEnd = document.getElementById("tanggal-akhir");
  const elBulan = document.getElementById("bulan-rekap");

  if (elStart) elStart.value = window.getLocalISODate(monday);
  if (elEnd) elEnd.value = window.getLocalISODate(friday);
  if (elBulan) elBulan.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

window.togglePeriodeInputs = function () {
  const periodeType = document.getElementById("periode-type")?.value;
  const inputMingguan = document.getElementById("input-mingguan");
  const inputBulanan = document.getElementById("input-bulanan");
  const inputSemester = document.getElementById("input-semester");

  if (inputMingguan) inputMingguan.classList.toggle("hidden", periodeType !== "mingguan");
  if (inputBulanan) inputBulanan.classList.toggle("hidden", periodeType !== "bulanan");
  if (inputSemester) inputSemester.classList.toggle("hidden", periodeType !== "semester");
};

window.onTanggalMulaiChange = function () {
  const tanggalMulai = document.getElementById("tanggal-mulai")?.value;
  if (!tanggalMulai) return;

  const startDate = new Date(tanggalMulai);
  const dayOfWeek = startDate.getDay();
  if (dayOfWeek === 1) {
    const friday = new Date(startDate);
    friday.setDate(startDate.getDate() + 4);
    const elEnd = document.getElementById("tanggal-akhir");
    if (elEnd) elEnd.value = window.getLocalISODate(friday);
  }
};

// === HELPER MASTER GURU & NORMALISASI NAMA (DEDUKPLIKASI OTOMATIS) ===
let masterTeachersCache = null;
let allGtkFullCache = null;

export function isTeacherOnly(t) {
  if (!t) return false;
  const jenis = String(t.jenis_ptk || t.jabatan || "").trim().toLowerCase();
  // Khusus Guru saja: jenis_ptk atau jabatan harus mengandung kata 'guru' (seperti 'Guru', 'Guru Mapel', 'Guru BK', 'Guru Kelas')
  return jenis.includes("guru");
}

export const isTeacherPendidik = isTeacherOnly;

async function getMasterTeachersList() {
  if (masterTeachersCache && masterTeachersCache.length > 0) {
    return masterTeachersCache;
  }
  let list = [];
  try {
    let scheduleTeachers = [];
    try {
      scheduleTeachers = await getAllScheduleTeachers();
    } catch (e) {}

    const scheduleNameSet = new Set(
      scheduleTeachers.map((s) => normalizeTeacherName(s.name || s.xmlName || "")).filter(Boolean)
    );

    if (window.getTeachersCache) {
      const allGtk = await window.getTeachersCache();
      if (Array.isArray(allGtk)) {
        allGtkFullCache = allGtk;
        list = allGtk.filter((t) => {
          // 1. Cek jenis_ptk mengandung kata 'guru'
          if (isTeacherOnly(t)) return true;
          // 2. Cek apakah terdaftar di jadwal KBM XML
          const normName = normalizeTeacherName(t.name || t.nama || "");
          if (normName && scheduleNameSet.has(normName)) return true;
          return false;
        });
      }
    }
    if (!list || list.length === 0) {
      list = scheduleTeachers;
    }
  } catch (e) {
    console.warn("Warn getting teachers cache:", e);
  }
  masterTeachersCache = list || [];
  return masterTeachersCache;
}

export function resolveOfficialTeacherName(rawName, masterList = []) {
  if (!rawName || rawName === "-" || rawName === "Belum diisi") return "";
  const rawTrimmed = rawName.trim().replace(/\s+/g, " ");
  if (!rawTrimmed) return "";

  if (!masterList || masterList.length === 0) return rawTrimmed;

  // 1. Direct exact match
  const direct = masterList.find(t => (t.name || t.nama) === rawTrimmed);
  if (direct) return direct.name || direct.nama;

  // 2. Case-insensitive exact match
  const rawLower = rawTrimmed.toLowerCase();
  const caseMatch = masterList.find(t => (t.name || t.nama || "").toLowerCase() === rawLower);
  if (caseMatch) return caseMatch.name || caseMatch.nama;

  // 3. Exact Normalized Match (tanpa gelar akademis & tanda baca)
  const normRaw = normalizeTeacherName(rawTrimmed);
  if (normRaw) {
    const normMatch = masterList.find(t => normalizeTeacherName(t.name || t.nama || "") === normRaw);
    if (normMatch) return normMatch.name || normMatch.nama;
  }

  // 4. Token / Substring Matching (untuk nama panggilan / tanpa awalan seperti "Putu widiasih", "Rani", "Sriada")
  if (normRaw && normRaw.length >= 3) {
    const rawTokens = normRaw.split(" ").filter(tok => tok.length >= 3);

    // 4a. Master mengandung seluruh token raw atau menyertakan normRaw utuh
    const candidates = masterList.filter(t => {
      const normMaster = normalizeTeacherName(t.name || t.nama || "");
      if (normMaster.includes(normRaw)) return true;
      if (rawTokens.length > 0 && rawTokens.every(tok => normMaster.includes(tok))) return true;
      return false;
    });

    if (candidates.length === 1) {
      return candidates[0].name || candidates[0].nama;
    }

    // 4b. Single unique significant token match (e.g. 'rani', 'sriada')
    if (candidates.length === 0 && rawTokens.length === 1) {
      const singleToken = rawTokens[0];
      const commonPrefixes = ["i", "ni", "wayan", "made", "nyoman", "ketut", "putu", "kadek", "komang", "gede"];
      if (!commonPrefixes.includes(singleToken) && singleToken.length >= 4) {
        const tokenMatches = masterList.filter(t => {
          const normMaster = normalizeTeacherName(t.name || t.nama || "");
          const masterTokens = normMaster.split(" ");
          return masterTokens.includes(singleToken) || normMaster.includes(singleToken);
        });
        if (tokenMatches.length === 1) {
          return tokenMatches[0].name || tokenMatches[0].nama;
        }
      }
    }
  }

  return rawTrimmed;
}

export function getTeacherObject(rawName, masterList = []) {
  if (!rawName || rawName === "-" || rawName === "Belum diisi") return null;

  let pool = Array.isArray(masterList) && masterList.length > 0 ? masterList : [];
  if (pool.length === 0 && masterTeachersCache && masterTeachersCache.length > 0) {
    pool = masterTeachersCache;
  }
  if (allGtkFullCache && allGtkFullCache.length > 0) {
    pool = allGtkFullCache;
  } else if (typeof window !== "undefined" && window.getTeachersCacheSync) {
    const syncTeachers = window.getTeachersCacheSync();
    if (Array.isArray(syncTeachers) && syncTeachers.length > 0) {
      pool = syncTeachers;
    }
  }

  const rawTrimmed = rawName.trim();

  // 1. Direct match (nama, name, nip)
  let found = pool.find((t) => (t.name || t.nama) === rawTrimmed || t.nip === rawTrimmed);
  if (found) return found;

  // 2. Canonical name resolution
  const canonicalName = resolveOfficialTeacherName(rawTrimmed, pool);
  if (canonicalName) {
    found = pool.find((t) => (t.name || t.nama) === canonicalName);
    if (found) return found;
  }

  // 3. Exact Normalized Match (tanpa gelar akademis & tanda baca)
  const normRaw = normalizeTeacherName(rawTrimmed);
  if (normRaw) {
    found = pool.find((t) => normalizeTeacherName(t.name || t.nama || "") === normRaw);
    if (found) return found;

    // 4. Token substring matching (misal: "i komang purna")
    const rawTokens = normRaw.split(" ").filter((tok) => tok.length >= 3);
    if (rawTokens.length > 0) {
      found = pool.find((t) => {
        const normT = normalizeTeacherName(t.name || t.nama || "");
        return normT.includes(normRaw) || rawTokens.every((tok) => normT.includes(tok));
      });
      if (found) return found;
    }
  }

  return null;
}

// === HELPER VERIFIKASI 3 ARAH (Jurnal KBM Guru via Barcode + Presensi Kehadiran Guru oleh Siswa + Jadwal XML) ===
async function fetchCrossVerifiedData(dates, kelasList) {
  if (dates.length > 0) {
    try {
      const minDate = dates.reduce((min, cur) => cur < min ? cur : min, dates[0]);
      const maxDate = dates.reduce((max, cur) => cur > max ? cur : max, dates[0]);
      await fetchRegisteredHolidays(minDate, maxDate);
    } catch (e) {
      console.warn("[Monitoring KBM] Gagal fetchRegisteredHolidays:", e);
    }
  }

  const datesKey = dates.length > 0 ? `${dates[0]}_${dates[dates.length - 1]}_${dates.length}` : "";
  const matrixTTL = dates.length > 0 ? getCacheTTL(dates[0]) : 1 * 60 * 1000;
  if (!_forceRefresh && datesKey && _cache.crossVerified[datesKey] && isCacheValid(_cache.crossVerified[datesKey], matrixTTL)) {
    console.log(`📦 [Cache HIT] crossVerified matrix full result (${dates.length} days)`);
    return _cache.crossVerified[datesKey].data;
  }

  const monthGroups = {};
  dates.forEach((date) => {
    const [year, month] = date.split("-");
    const key = `${year}_${month}`;
    if (!monthGroups[key]) monthGroups[key] = { year, month, dates: [] };
    monthGroups[key].dates.push(date);
  });

  // 1. Query Jurnal Guru per bulan/rentang tanggal — On-Demand dengan Cache
  const jurnalPromises = Object.keys(monthGroups).map(async (monthKey) => {
    try {
      const groupDates = monthGroups[monthKey].dates;
      const normalizedMonth = monthKey.replace("_", "-");
      const [yKey, mKey] = normalizedMonth.split("-");
      const lastDayFallback = (yKey && mKey) ? new Date(parseInt(yKey, 10), parseInt(mKey, 10), 0).getDate() : 31;
      const minDate = groupDates[0] || `${normalizedMonth}-01`;
      const maxDate = groupDates[groupDates.length - 1] || `${normalizedMonth}-${String(lastDayFallback).padStart(2, '0')}`;
      const isFullMonth = groupDates.length >= 25;
      const jcKey = isFullMonth ? `jurnal_${monthKey}` : `jurnal_range_${minDate}_${maxDate}`;
      const ttl = getCacheTTL(minDate);
      const cached = _cache.jurnalByMonth[jcKey];
      
      if (!_forceRefresh && isCacheValid(cached, ttl)) {
        console.log(`📦 [Cache HIT] jurnal_guru (${jcKey})`);
        const snapLike = {
          empty: cached.data.length === 0,
          forEach: (cb) => cached.data.forEach((d) => cb({ id: d.id, data: () => d }))
        };
        return { monthKey, snap: snapLike };
      }
      
      let cachedDocs = [];
      if (cfClient && cfClient.enabled) {
        let hasMore = true;
        let offset = 0;
        const CHUNK_SIZE = 1000;
        const allJurnalRows = [];
        let pageCount = 0;
        const MAX_PAGES = 20; // Safeguard maksimal 20.000 entri jurnal per rentang bulan

        while (hasMore && pageCount < MAX_PAGES) {
          pageCount++;
          const chunk = await cfClient.getJurnalKbm({
            startDate: minDate,
            endDate: maxDate,
            limit: CHUNK_SIZE,
            offset: offset,
            excludeTtd: true
          });
          const rows = Array.isArray(chunk) ? chunk : [];
          if (rows.length > 0) {
            allJurnalRows.push(...rows);
            if (rows.length < CHUNK_SIZE) {
              hasMore = false;
            } else {
              offset += CHUNK_SIZE;
            }
          } else {
            hasMore = false;
          }
        }

        cachedDocs = allJurnalRows.map(d => {
          let presensiDetail = d.presensi_detail;
          if (typeof presensiDetail === "string") {
            try { presensiDetail = JSON.parse(presensiDetail); } catch (e) {}
          }
          return {
            ...d,
            presensi_detail: presensiDetail || []
          };
        });
      }
      
      _cache.jurnalByMonth[jcKey] = { data: cachedDocs, ts: Date.now() };
      saveKbmSessionCache();
      console.log(`🔄 [Cloudflare D1] jurnal_guru rentang ${minDate} s.d. ${maxDate} (${cachedDocs.length} docs)`);
      
      const snapLike = {
        empty: cachedDocs.length === 0,
        forEach: (cb) => cachedDocs.forEach((d) => cb({ id: d.id, data: () => d }))
      };
      return { monthKey, snap: snapLike };
    } catch (e) {
      console.warn("Warn fetching jurnal_guru:", e);
      return { monthKey, snap: null };
    }
  });

  // 2. Query Presensi Guru (Input Siswa) — Coba Supabase Range Query (> 1000 rows auto-paginated), Fallback Firestore
  let sbRangeLoaded = false;
  let sbRangeRows = [];
  if (supabase && dates.length > 0) {
    try {
      const minDate = dates[0];
      const maxDate = dates[dates.length - 1];
      let allSbData = [];
      let from = 0;
      let hasMore = true;
      const CHUNK_SIZE = 1000;

      while (hasMore) {
        const { data: chunk, error: chunkErr } = await supabase
          .from("guru_presensi")
          .select("*")
          .gte("tanggal", minDate)
          .lte("tanggal", maxDate)
          .order("tanggal", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + CHUNK_SIZE - 1);

        if (chunkErr) throw chunkErr;
        if (Array.isArray(chunk) && chunk.length > 0) {
          allSbData.push(...chunk);
          if (chunk.length < CHUNK_SIZE) {
            hasMore = false;
          } else {
            from += CHUNK_SIZE;
          }
        } else {
          hasMore = false;
        }
      }

      if (allSbData.length > 0) {
        sbRangeRows = allSbData;
        console.log(`📦 [Supabase] Auto-paginated range loaded ${allSbData.length} guru_presensi rows for ${minDate} to ${maxDate}`);
      }
    } catch (eSbRange) {
      console.warn("[MonitoringKBM] Supabase range load error:", eSbRange);
    }
  }

  // 3. Query Jadwal Master XML per kelas & tanggal
  const xmlPromises = [];
  for (const kelas of kelasList) {
    for (const date of dates) {
      xmlPromises.push(
        getScheduleForClassAndDate(kelas, date)
          .then((sch) => ({ kelas, date, schedule: sch || [] }))
          .catch(() => ({ kelas, date, schedule: [] }))
      );
    }
  }

  const [jurnalResults, xmlResults] = await Promise.all([
    Promise.all(jurnalPromises),
    Promise.all(xmlPromises),
  ]);

  // Setup Matrix: matrix[date][kelas][jp] = { jurnal, presensi, xml }
  const matrix = {};
  dates.forEach((d) => {
    matrix[d] = {};
    kelasList.forEach((k) => {
      matrix[d][k] = {};
      for (let i = 1; i <= 10; i++) {
        matrix[d][k][i] = { jurnal: null, presensi: null, xml: null };
      }
    });
  });

  // Populasikan Jadwal XML
  xmlResults.forEach(({ kelas, date, schedule }) => {
    if (matrix[date] && matrix[date][kelas] && Array.isArray(schedule)) {
      schedule.forEach((item) => {
        if (item.jp >= 1 && item.jp <= 10) {
          matrix[date][kelas][item.jp].xml = {
            guru: item.guruNama || "",
            mapel: item.mapel || "",
          };
        }
      });
    }
  });

  // Populasikan Presensi Guru (Eksklusif Supabase)
  sbRangeRows.forEach((row) => {
    const d = row.tanggal;
    if (matrix[d]) {
      const targetKelasKey = findMatchingClassKey(row.kelas, matrix[d]);
      if (targetKelasKey && row.jp >= 1 && row.jp <= 10 && (row.status || row.guru_nama)) {
        matrix[d][targetKelasKey][row.jp].presensi = {
          guru: row.guru_nama || "",
          mapel: row.mapel || "",
          status: row.status || "",
          kegiatan: row.kegiatan || row.keterangan || row.nama_kegiatan || "",
          keterangan: row.kegiatan || row.keterangan || row.nama_kegiatan || "",
        };
      }
    }
  });

  // Populasikan Jurnal Guru
  jurnalResults.forEach(({ snap }) => {
    if (snap && !snap.empty) {
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const docDate = getJurnalDateStr(data);
        if (!docDate || !matrix[docDate]) return;

        const rawKelas = data.kelas;
        const targetKelasKey = findMatchingClassKey(rawKelas, matrix[docDate]);
        if (!targetKelasKey) return;

        const guru = data.guru || "";
        const mapel = data.mapel || "";
        const jps = parseJpList(data.jp);

        jps.forEach((jp) => {
          if (jp >= 1 && jp <= 10) {
            matrix[docDate][targetKelasKey][jp].jurnal = {
              guru,
              mapel,
              topik: data.topik || "",
              catatan: data.catatan || "",
              foto_url: data.foto_url || "",
              presensi_detail: data.presensi_detail || []
            };
          }
        });
      });
    }
  });

  // 4. Deteksi Heuristik KBM Non-Efektif (<= 5 Kelas aktif) pada Hari Kerja Lampau
  const todayStr = (typeof window !== "undefined" && typeof window.getLocalISODate === "function")
    ? window.getLocalISODate()
    : formatLocalIsoDate(new Date());

  const nonEffectiveDates = new Set();
  const isClassListValid = Array.isArray(kelasList) && kelasList.length > 5;

  if (isClassListValid) {
    dates.forEach((d) => {
      if (d < todayStr) {
        const selectedDate = new Date(d + "T00:00:00");
        const dayOfWeek = selectedDate.getDay();
        // Hanya periksa hari kerja (Senin - Jumat)
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          const existingHoliday = (typeof getRegisteredHoliday === "function" ? getRegisteredHoliday(d) : null) ||
            (typeof window !== "undefined" && window.HolidayManager?.getRegisteredHoliday?.(d));
          const isAutoHeuristic = Boolean(existingHoliday?.nama?.startsWith("Dispensasi Khusus / Libur Sekolah"));
          const dh = getHolidayHelper();
          const isOfficialNational = Boolean(dh && typeof dh.isNationalHoliday === "function" && dh.isNationalHoliday(d));

          // Jika sudah merupakan hari libur resmi (nasional atau agenda non-heuristik), catat sebagai non-efektif dan lewati
          if (isHolidayDate(d) && !isAutoHeuristic) {
            nonEffectiveDates.add(d);
            return;
          }

          let activeClassesCount = 0;
          kelasList.forEach((k) => {
            let hasClassKbm = false;
            for (let jp = 1; jp <= 10; jp++) {
              const cell = matrix[d]?.[k]?.[jp];
              if (cell && (cell.jurnal || (cell.presensi && cell.presensi.status))) {
                hasClassKbm = true;
                break;
              }
            }
            if (hasClassKbm) {
              activeClassesCount++;
            }
          });

          // Heuristik: Jika jumlah kelas aktif <= 5 rombel (dari total 36 rombel),
          // otomatis tandai sebagai Hari Libur / Dispensasi Khusus Sekolah
          if (activeClassesCount <= 5) {
            nonEffectiveDates.add(d);
            const holidayTitle = `Dispensasi Khusus / Libur Sekolah (${activeClassesCount} Rombel Aktif)`;
            if (typeof upsertSchoolHoliday === "function") {
              upsertSchoolHoliday(d, holidayTitle).catch((err) =>
                console.warn("[Monitoring KBM] Auto-upsert lib_hari_libur gagal:", err)
              );
            } else if (typeof window !== "undefined" && window.HolidayManager?.upsertSchoolHoliday) {
              window.HolidayManager.upsertSchoolHoliday(d, holidayTitle).catch((err) =>
                console.warn("[Monitoring KBM] Auto-upsert lib_hari_libur gagal:", err)
              );
            }
          } else if (isAutoHeuristic && !isOfficialNational) {
            // Rekonsiliasi Self-Healing: Jika sebelumnya sempat tercatat libur otomatis dispensasi (misal listrik padam),
            // namun kini jurnal guru telah terisi lengkap (> 5 kelas aktif), batalkan penandaan libur palsu tersebut!
            if (typeof deleteSchoolHoliday === "function") {
              deleteSchoolHoliday(d).catch((err) =>
                console.warn("[Monitoring KBM] Reconcile deleteSchoolHoliday gagal:", err)
              );
            } else if (typeof window !== "undefined" && window.HolidayManager?.deleteSchoolHoliday) {
              window.HolidayManager.deleteSchoolHoliday(d).catch((err) =>
                console.warn("[Monitoring KBM] Reconcile deleteSchoolHoliday gagal:", err)
              );
            }
          }
        }
      }
    });
  }

  matrix._nonEffectiveDates = nonEffectiveDates;

  if (datesKey) {
    _cache.crossVerified[datesKey] = { data: matrix, ts: Date.now() };
    saveKbmSessionCache();
  }

  return matrix;
}

// === MEMORY STATE UNTUK MODAL DETAIL REKAP GURU (0 QUERY ULANG / HEMAT KUOTA FIRESTORE & SUPABASE) ===
let _lastRekapDates = [];
let _lastRekapMatrix = null;
let _lastRekapPeriodeLabel = "";
let _lastMasterTeachers = [];
let _modalGuruAllRecords = [];
let _currentModalGuru = "";

window.loadRekapGuru = async function () {
  await loadKelasListLocal();
  const container = document.getElementById("rekap-guru-container");
  if (!container) return;

  container.innerHTML =
    '<div class="text-center py-12"><i class="fa-solid fa-spinner fa-spin text-2xl text-slate-400"></i><p class="text-xs text-slate-500 mt-2">Memuat Rekap Guru Verifikasi 3 Arah...</p></div>';

  const periodeType = document.getElementById("periode-type")?.value;
  let dates = [];
  let periodeLabel = "";

  if (periodeType === "mingguan") {
    const startVal = document.getElementById("tanggal-mulai")?.value;
    const endVal = document.getElementById("tanggal-akhir")?.value;
    if (startVal && endVal) {
      try {
        await fetchRegisteredHolidays(startVal, endVal);
      } catch (e) {}
    }
    const startDate = new Date(startVal);
    const endDate = new Date(endVal);

    if (isNaN(startDate) || isNaN(endDate)) {
      showToast("Peringatan", "Pilih tanggal mulai dan akhir", "warning");
      return;
    }

    periodeLabel = `${startDate.toLocaleDateString("id-ID")} - ${endDate.toLocaleDateString("id-ID")}`;
    dates = collectActiveKbmDates({ periodeType: "mingguan", startDate, endDate });
  } else if (periodeType === "bulanan") {
    const bulan = document.getElementById("bulan-rekap")?.value;
    if (!bulan) {
      showToast("Peringatan", "Pilih bulan", "warning");
      return;
    }
    try {
      await fetchRegisteredHolidays(`${bulan}-01`, `${bulan}-31`);
    } catch (e) {}

    const [year, month] = bulan.split("-");
    const monthNames = [
      "Januari", "Februari", "Maret", "April", "Mei", "Juni",
      "Juli", "Agustus", "September", "Oktober", "November", "Desember",
    ];
    periodeLabel = `${monthNames[parseInt(month, 10) - 1]} ${year}`;
    dates = collectActiveKbmDates({ periodeType: "bulanan", bulan });
  } else if (periodeType === "semester") {
    const sem = document.getElementById("rekap-semester-select")?.value || "1";
    const ta = document.getElementById("rekap-ta-select")?.value || raporConfig?.tahun_ajaran || "2025/2026";
    const parts = ta.split("/");
    const y1 = parts[0];
    const y2 = parts[1] || parseInt(y1, 10) + 1;
    const startSem = sem === "1" ? `${y1}-07-01` : `${y2}-01-01`;
    const endSem = sem === "1" ? `${y1}-12-31` : `${y2}-06-30`;
    try {
      await fetchRegisteredHolidays(startSem, endSem);
    } catch (e) {}

    periodeLabel = `Semester ${sem} (${sem === "1" ? "Ganjil" : "Genap"}) - TA ${ta}`;
    dates = collectActiveKbmDates({ periodeType: "semester", semester: sem, tahunAjaran: ta, raporConfig });
  }

  if (dates.length === 0) {
    container.innerHTML =
      '<div class="text-center text-slate-400 py-12"><i class="fa-solid fa-calendar-xmark text-3xl mb-2"></i><p class="text-sm">Tidak ada hari kerja dalam periode ini</p></div>';
    const statsCon = document.getElementById("stats-guru-container");
    if (statsCon) statsCon.innerHTML = "";
    return;
  }

  rekapGuruData = {};

  try {
    const masterTeachers = await getMasterTeachersList();
    const matrix = await fetchCrossVerifiedData(dates, kelasList);

    // Simpan snapshot untuk modal detail agar tidak perlu query ulang
    _lastRekapDates = dates;
    _lastRekapMatrix = matrix;
    _lastRekapPeriodeLabel = periodeLabel;
    _lastMasterTeachers = masterTeachers;

    dates.forEach((date) => {
      // Lewati hari libur terdaftar atau hari non-efektif (0 jam TE palsu)
      if (isHolidayDate(date) || (matrix._nonEffectiveDates && matrix._nonEffectiveDates.has(date))) {
        return;
      }

      const selectedDate = new Date(date + "T00:00:00");
      const dayOfWeek = selectedDate.getDay();

      const jpTidakEfektifAngkatanMap = buildJPTidakEfektifAngkatanMap(kelasList, matrix[date], date);

      kelasList.forEach((kelas) => {
        const angk = getAngkatanFromClass(kelas);
        for (let jpNum = 1; jpNum <= 10; jpNum++) {
          if (dayOfWeek === 1 && jpNum === 1) continue; // Upacara
          if (dayOfWeek === 5 && jpNum === 10) continue; // Ekskul

          const cell = matrix[date][kelas]?.[jpNum];
          const { jurnal, presensi, xml } = cell || {};
          const isTidakEfektif = Boolean(jpTidakEfektifAngkatanMap[angk]?.[jpNum]);

          const rawGuruName = jurnal?.guru || presensi?.guru || xml?.guru || "";
          if (!rawGuruName || rawGuruName === "-" || rawGuruName === "Belum diisi") continue;

          // Normalisasikan ke nama master resmi (mencegah duplikasi nama karena beda gelar/huruf)
          const guruName = resolveOfficialTeacherName(rawGuruName, masterTeachers);
          if (!guruName) continue;

          if (
            isRestrictedToTeacherAssignments &&
            currentUserInfo &&
            resolveOfficialTeacherName(guruName, masterTeachers) !== resolveOfficialTeacherName(currentUserInfo.nama, masterTeachers)
          ) {
            continue;
          }

          if (!rekapGuruData[guruName]) {
            rekapGuruData[guruName] = {
              H: 0,
              K: 0,
              I: 0,
              S: 0,
              TK: 0,
              TE: 0,
              total: 0,
            };
          }

          if (isTidakEfektif) {
            rekapGuruData[guruName].TE++;
          } else if (jurnal || (presensi && presensi.status === "H")) {
            rekapGuruData[guruName].total++;
            rekapGuruData[guruName].H++;
          } else if (presensi && ["K", "I", "L", "S"].includes(presensi.status)) {
            const st = presensi.status;
            rekapGuruData[guruName].total++;
            if (st === "K") rekapGuruData[guruName].K++;
            else if (st === "I" || st === "L") rekapGuruData[guruName].I++;
            else if (st === "S") rekapGuruData[guruName].S++;
          } else if (presensi && ["TK", "TT", "A"].includes(presensi.status)) {
            rekapGuruData[guruName].total++;
            rekapGuruData[guruName].TK++;
          } else if (xml && isJPElapsed(jpNum, date)) {
            rekapGuruData[guruName].total++;
            rekapGuruData[guruName].TK++;
          }
        }
      });
    });

    if (Object.keys(rekapGuruData).length === 0) {
      container.innerHTML =
        '<div class="text-center text-slate-400 py-12"><i class="fa-solid fa-inbox text-3xl mb-2"></i><p class="text-sm">Tidak ada data presensi dalam periode ini</p></div>';
      const statsCon = document.getElementById("stats-guru-container");
      if (statsCon) statsCon.innerHTML = "";
      return;
    }

    renderRekapGuruTable();
    renderGuruStats();
  } catch (e) {
    console.error("Error loading rekap guru:", e);
    showToast("Error", "Gagal memuat data: " + e.message, "error");
  }
};

function renderRekapGuruTable() {
  const container = document.getElementById("rekap-guru-container");
  if (!container) return;

  const sortedGuru = Object.keys(rekapGuruData).sort(naturalSort);

  let html = `
        <table class="w-full text-sm border border-slate-200 dark:border-slate-700">
            <thead class="bg-slate-700 dark:bg-slate-800 text-white text-xs uppercase sticky top-0 border-b border-slate-600 dark:border-slate-700">
                <tr>
                    <th class="px-3 py-2.5 text-center border border-slate-600 dark:border-slate-700 w-12">No</th>
                    <th class="px-4 py-2.5 text-left border border-slate-600 dark:border-slate-700">Nama Guru</th>
                    <th class="px-3 py-2.5 text-center border border-slate-600 dark:border-slate-700">Hadir</th>
                    <th class="px-3 py-2.5 text-center border border-slate-600 dark:border-slate-700">Kegiatan</th>
                    <th class="px-3 py-2.5 text-center border border-slate-600 dark:border-slate-700">Izin</th>
                    <th class="px-3 py-2.5 text-center border border-slate-600 dark:border-slate-700">Sakit</th>
                    <th class="px-3 py-2.5 text-center border border-slate-600 dark:border-slate-700">TK</th>
                    <th class="px-3 py-2.5 text-center border border-slate-600 dark:border-slate-700" title="Tidak Belajar Efektif (Tidak Memotong % Presensi)">TE</th>
                    <th class="px-3 py-2.5 text-center border border-slate-600 dark:border-slate-700">Total JP</th>
                    <th class="px-3 py-2.5 text-center border border-slate-600 dark:border-slate-700">% Kehadiran</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-700 bg-white dark:bg-slate-800">
    `;

  sortedGuru.forEach((guru, idx) => {
    const data = rekapGuruData[guru];
    const persen = data.total > 0 ? Math.round((data.H / data.total) * 100) : 100;
    const persenColor =
      persen >= 90
        ? "text-green-600 dark:text-green-400"
        : persen >= 75
          ? "text-yellow-600 dark:text-yellow-400"
          : "text-red-600 dark:text-red-400";

    html += `
            <tr class="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                <td class="px-3 py-2 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 text-center font-semibold text-xs">${idx + 1}</td>
                <td class="px-4 py-2 font-semibold text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs">${escapeHTML(guru)}</td>
                <td class="px-3 py-2 text-center border border-slate-200 dark:border-slate-700"><span class="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-2 py-0.5 rounded font-bold text-xs">${data.H}</span></td>
                <td class="px-3 py-2 text-center border border-slate-200 dark:border-slate-700"><span class="bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded font-bold text-xs">${data.K}</span></td>
                <td class="px-3 py-2 text-center border border-slate-200 dark:border-slate-700"><span class="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded font-bold text-xs">${data.I}</span></td>
                <td class="px-3 py-2 text-center border border-slate-200 dark:border-slate-700"><span class="bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 px-2 py-0.5 rounded font-bold text-xs">${data.S}</span></td>
                <td class="px-3 py-2 text-center border border-slate-200 dark:border-slate-700"><span class="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 px-2 py-0.5 rounded font-bold text-xs">${data.TK}</span></td>
                <td class="px-3 py-2 text-center border border-slate-200 dark:border-slate-700"><span class="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded font-bold text-xs" title="Tidak Belajar Efektif">${data.TE}</span></td>
                <td class="px-3 py-2 text-center font-bold text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs">${data.total}</td>
                <td class="px-3 py-2 text-center border border-slate-200 dark:border-slate-700 text-xs whitespace-nowrap">
                  <div class="inline-flex items-center justify-center gap-2">
                    <span class="font-extrabold ${persenColor}">${persen}%</span>
                    <button
                      type="button"
                      onclick="window.openRekapGuruDetailModal(this.dataset.guru)"
                      data-guru="${escapeHTML(guru)}"
                      class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-2xs transition-all active:scale-95 cursor-pointer"
                      title="Buka detail kehadiran ${escapeHTML(guru)}"
                    >
                      <i class="fa-solid fa-list-check text-[10px]"></i>
                      <span>Detail</span>
                    </button>
                  </div>
                </td>
            </tr>
        `;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

function renderGuruStats() {
  const container = document.getElementById("stats-guru-container");
  if (!container) return;

  let totalGuru = Object.keys(rekapGuruData).length;
  let totalJP = 0,
    totalH = 0,
    totalK = 0,
    totalAbsen = 0;

  Object.values(rekapGuruData).forEach((data) => {
    totalJP += data.total;
    totalH += data.H;
    totalK += data.K || 0;
    totalAbsen += data.S + data.TK;
  });

  const avgKehadiran =
    totalJP > 0 ? Math.round((totalH / totalJP) * 100) : 100;

  container.innerHTML = `
        <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-center shadow-sm">
            <div class="text-3xl font-bold text-blue-600 dark:text-blue-400">${totalGuru}</div>
            <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">Total Guru</div>
        </div>
        <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-center shadow-sm">
            <div class="text-3xl font-bold text-slate-700 dark:text-slate-200">${totalJP}</div>
            <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">Total JP Wajib Terdata</div>
        </div>
        <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-center shadow-sm">
            <div class="text-3xl font-bold text-green-600 dark:text-green-400">${totalH + totalK}</div>
            <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">Total Kehadiran</div>
        </div>
        <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-center shadow-sm">
            <div class="text-3xl font-bold ${avgKehadiran >= 90 ? "text-green-600 dark:text-green-400" : avgKehadiran >= 75 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}">${avgKehadiran}%</div>
            <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">Rata-rata Kehadiran</div>
        </div>
    `;
}

// === MODAL DETAIL KEHADIRAN GURU (DARI TAB REKAP GURU) ===
window.openRekapGuruDetailModal = async function (guruName) {
  if (!guruName) return;
  const modalEl = document.getElementById("modal-rekap-guru-detail");
  if (!modalEl) return;

  _currentModalGuru = guruName;
  const masterTeachers = _lastMasterTeachers.length > 0 ? _lastMasterTeachers : await getMasterTeachersList();
  const targetCanonical = resolveOfficialTeacherName(guruName, masterTeachers) || guruName;

  const elNama = document.getElementById("modal-guru-nama");
  const elPeriode = document.getElementById("modal-guru-periode");
  if (elNama) elNama.textContent = guruName;
  if (elPeriode) elPeriode.textContent = _lastRekapPeriodeLabel ? `Periode: ${_lastRekapPeriodeLabel}` : "Periode KBM";

  const todayStr = formatLocalIsoDate(new Date());
  const dates = _lastRekapDates || [];
  const matrix = _lastRekapMatrix || {};

  const records = [];
  const stats = { H: 0, K: 0, I: 0, S: 0, TK: 0, TE: 0, total: 0 };

  dates.forEach((date) => {
    // Lewati tanggal masa depan, akhir pekan, atau hari libur terdaftar
    if (date > todayStr) return;
    const selectedDate = new Date(date + "T00:00:00");
    const dayOfWeek = selectedDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return;
    if (isHolidayDate(date) || (matrix._nonEffectiveDates && matrix._nonEffectiveDates.has(date))) {
      return;
    }

    const jpTidakEfektifAngkatanMap = buildJPTidakEfektifAngkatanMap(kelasList, matrix[date], date);

    kelasList.forEach((kelas) => {
      const angk = getAngkatanFromClass(kelas);
      for (let jpNum = 1; jpNum <= 10; jpNum++) {
        if (dayOfWeek === 1 && jpNum === 1) continue; // Upacara
        if (dayOfWeek === 5 && jpNum === 10) continue; // Ekskul

        const cell = matrix[date]?.[kelas]?.[jpNum];
        const { jurnal, presensi, xml } = cell || {};
        const isTidakEfektif = Boolean(jpTidakEfektifAngkatanMap[angk]?.[jpNum]);

        const rawGName = jurnal?.guru || presensi?.guru || xml?.guru || "";
        if (!rawGName || rawGName === "-" || rawGName === "Belum diisi") continue;

        const cellGuru = resolveOfficialTeacherName(rawGName, masterTeachers);
        if (cellGuru !== targetCanonical && rawGName !== guruName && cellGuru !== guruName) continue;

        const mapel = jurnal?.mapel || presensi?.mapel || xml?.mapel || "-";
        let status = "-";

        if (isTidakEfektif) {
          status = "TE";
        } else if (jurnal || (presensi && presensi.status === "H")) {
          status = "H";
        } else if (presensi && ["K", "I", "L", "S"].includes(presensi.status)) {
          const st = presensi.status;
          if (st === "K") status = "K";
          else if (st === "I" || st === "L") status = "I";
          else if (st === "S") status = "S";
        } else if (presensi && ["TK", "TT", "A"].includes(presensi.status)) {
          status = "TK";
        } else if (xml && isJPElapsed(jpNum, date)) {
          status = "TK";
        }

        if (!status || status === "-") continue;

        const kegiatanText = (presensi && (presensi.kegiatan || presensi.keterangan || presensi.nama_kegiatan)) || "";

        records.push({
          tanggal: date,
          kelas: kelas,
          jp: jpNum,
          mapel: mapel,
          status: status,
          kegiatan: kegiatanText,
        });

        if (status === "TE") {
          stats.TE++;
        } else if (["H", "K", "I", "S", "TK", "TT"].includes(status)) {
          stats.total++;
          if (status === "H") stats.H++;
          else if (status === "K") stats.K++;
          else if (status === "I") stats.I++;
          else if (status === "S") stats.S++;
          else if (status === "TK" || status === "TT") stats.TK++;
        }
      }
    });
  });

  // Urutkan berdasarkan tanggal & JP ascending
  records.sort((a, b) => {
    if (a.tanggal !== b.tanggal) return a.tanggal.localeCompare(b.tanggal);
    return a.jp - b.jp;
  });

  _modalGuruAllRecords = records;

  // Update ringkasan stats di header modal
  const elH = document.getElementById("modal-stat-h");
  const elK = document.getElementById("modal-stat-k");
  const elI = document.getElementById("modal-stat-i");
  const elS = document.getElementById("modal-stat-s");
  const elTK = document.getElementById("modal-stat-tk");
  const elTE = document.getElementById("modal-stat-te");
  const elPersen = document.getElementById("modal-stat-persen");

  if (elH) elH.textContent = `H: ${stats.H}`;
  if (elK) elK.textContent = `K: ${stats.K}`;
  if (elI) elI.textContent = `I: ${stats.I}`;
  if (elS) elS.textContent = `S: ${stats.S}`;
  if (elTK) elTK.textContent = `TK: ${stats.TK}`;
  if (elTE) elTE.textContent = `TE: ${stats.TE}`;

  const persen = stats.total > 0 ? Math.round((stats.H / stats.total) * 100) : 100;
  if (elPersen) elPersen.textContent = `${persen}%`;

  // Reset dropdown filter status ke "ALL"
  const filterSelect = document.getElementById("modal-status-select");
  if (filterSelect) filterSelect.value = "ALL";

  window.renderModalRekapGuruTable(_modalGuruAllRecords);
  modalEl.classList.remove("hidden");
};

window.filterModalRekapGuruStatus = function () {
  const filterSelect = document.getElementById("modal-status-select");
  const selectedStatus = filterSelect ? filterSelect.value : "ALL";

  if (selectedStatus === "ALL") {
    window.renderModalRekapGuruTable(_modalGuruAllRecords);
    return;
  }

  const filtered = _modalGuruAllRecords.filter((item) => {
    if (selectedStatus === "I") {
      return item.status === "I" || item.status === "L";
    }
    if (selectedStatus === "TK") {
      return item.status === "TK" || item.status === "TT" || item.status === "A";
    }
    return item.status === selectedStatus;
  });

  window.renderModalRekapGuruTable(filtered);
};

window.renderModalRekapGuruTable = function (records) {
  const tbody = document.getElementById("modal-rekap-guru-tbody");
  const counter = document.getElementById("modal-row-counter");
  if (counter) counter.textContent = `${records.length} sesi terdata`;
  if (!tbody) return;

  if (records.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-10 text-slate-400 dark:text-slate-500">
          <i class="fa-solid fa-inbox text-3xl mb-2 block"></i>
          <p class="text-xs font-medium">Tidak ada data sesi KBM untuk status yang dipilih</p>
        </td>
      </tr>
    `;
    return;
  }

  const dayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

  let html = "";
  records.forEach((item, idx) => {
    const d = new Date(item.tanggal + "T00:00:00");
    const dayName = dayNames[d.getDay()] || "-";
    const statusColor = STATUS_COLORS[item.status] || "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";

    const statusLabel =
      item.status === "TE"
        ? "🚫 Tidak Efektif"
        : item.status === "H"
          ? "Hadir"
          : item.status === "K"
            ? "Kegiatan"
            : item.status === "I" || item.status === "L"
              ? "Izin"
              : item.status === "S"
                ? "Sakit"
                : item.status === "TK" || item.status === "TT" || item.status === "A"
                  ? "Tanpa Keterangan"
                  : item.status;

    let kegiatanHtml = "";
    if (item.status === "K" && item.kegiatan) {
      kegiatanHtml = `
        <div class="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 text-[10.5px] font-semibold break-words max-w-[240px]" title="${escapeHTML(item.kegiatan)}">
          <i class="fa-solid fa-briefcase text-[10px] shrink-0"></i>
          <span class="truncate">${escapeHTML(item.kegiatan)}</span>
        </div>
      `;
    }

    html += `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors border-b border-slate-100 dark:border-slate-800">
        <td class="px-3 py-2.5 text-center text-slate-500 dark:text-slate-400 font-semibold border-r border-slate-100 dark:border-slate-800/60 w-12">${idx + 1}</td>
        <td class="px-3 py-2.5 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">${d.toLocaleDateString("id-ID")}</td>
        <td class="px-3 py-2.5 text-slate-600 dark:text-slate-400 font-medium">${dayName}</td>
        <td class="px-3 py-2.5 font-bold text-slate-800 dark:text-slate-200">${escapeHTML(item.kelas)}</td>
        <td class="px-3 py-2.5 text-center"><span class="bg-slate-800 dark:bg-slate-700 text-white px-2 py-0.5 rounded text-[10.5px] font-extrabold shadow-2xs">JP ${item.jp}</span></td>
        <td class="px-3 py-2.5 text-slate-800 dark:text-slate-200 font-medium">${escapeHTML(item.mapel)}</td>
        <td class="px-3 py-2.5">
          <div>
            <span class="${statusColor} px-2 py-0.5 rounded font-extrabold text-[11px] inline-block">${escapeHTML(statusLabel)}</span>
          </div>
          ${kegiatanHtml}
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
};

window.closeRekapGuruDetailModal = function () {
  const modalEl = document.getElementById("modal-rekap-guru-detail");
  if (modalEl) modalEl.classList.add("hidden");
};

window.printModalDetailGuru = function () {
  const elNama = document.getElementById("modal-guru-nama");
  const elPeriode = document.getElementById("modal-guru-periode");
  const elH = document.getElementById("modal-stat-h");
  const elK = document.getElementById("modal-stat-k");
  const elI = document.getElementById("modal-stat-i");
  const elS = document.getElementById("modal-stat-s");
  const elTK = document.getElementById("modal-stat-tk");
  const elPersen = document.getElementById("modal-stat-persen");
  const tableWrapper = document.getElementById("modal-rekap-guru-table-wrapper");

  if (!elNama || !tableWrapper) return;

  const guruNama = elNama.textContent || "-";
  const periode = elPeriode ? elPeriode.textContent : "";
  const statsH = elH ? elH.textContent.replace("H: ", "") : "0";
  const statsK = elK ? elK.textContent.replace("K: ", "") : "0";
  const statsI = elI ? elI.textContent.replace("I: ", "") : "0";
  const statsS = elS ? elS.textContent.replace("S: ", "") : "0";
  const statsTK = elTK ? elTK.textContent.replace("TK: ", "") : "0";
  const statsPersen = elPersen ? elPersen.textContent : "0%";
  const tableHTML = tableWrapper.innerHTML;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    if (typeof showToast === "function") {
      showToast("Pop-up Terblokir", "Harap izinkan pop-up peramban untuk membuka pratinjau cetak.", "warning");
    }
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Detail Presensi - ${escapeHTML(guruNama)}</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; background: #f1f5f9; }
            .container { max-width: 900px; margin: 0 auto; }
            .header { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 20px; border-radius: 12px; margin-bottom: 20px; }
            .header h1 { font-size: 20px; margin-bottom: 5px; }
            .header .periode { font-size: 14px; opacity: 0.9; }
            .stats-card { background: white; border-radius: 12px; padding: 16px; margin-bottom: 20px; display: flex; gap: 12px; flex-wrap: wrap; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .stat-item { flex: 1; min-width: 80px; text-align: center; padding: 12px; border-radius: 8px; }
            .stat-hadir { background: #dcfce7; }
            .stat-kegiatan { background: #f3e8ff; }
            .stat-izin { background: #dbeafe; }
            .stat-sakit { background: #fef9c3; }
            .stat-tk { background: #fee2e2; }
            .stat-persen { background: #1e293b; color: white; }
            .stat-value { font-size: 22px; font-weight: bold; }
            .stat-hadir .stat-value { color: #166534; }
            .stat-kegiatan .stat-value { color: #6b21a8; }
            .stat-izin .stat-value { color: #1e40af; }
            .stat-sakit .stat-value { color: #854d0e; }
            .stat-tk .stat-value { color: #991b1b; }
            .stat-label { font-size: 11px; color: #64748b; margin-top: 4px; }
            .stat-persen .stat-label { color: rgba(255,255,255,0.7); }
            .table-card { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            table { width: 100%; border-collapse: collapse; font-size: 13px; }
            th { background: #1e293b; color: white; padding: 10px 14px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; }
            td { padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
            tr:hover { background: #f8fafc; }
            tr:last-child td { border-bottom: none; }
            .text-center { text-align: center; }
            @media print {
                body { background: white; padding: 10px; }
                .header { background: #1e40af !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .stats-card, .table-card { box-shadow: none; border: 1px solid #e2e8f0; }
                .stat-item { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>${escapeHTML(guruNama)}</h1>
                <div class="periode">${escapeHTML(periode)}</div>
            </div>
            <div class="stats-card">
                <div class="stat-item stat-hadir"><div class="stat-value">${statsH}</div><div class="stat-label">Hadir</div></div>
                <div class="stat-item stat-kegiatan"><div class="stat-value">${statsK}</div><div class="stat-label">Kegiatan</div></div>
                <div class="stat-item stat-izin"><div class="stat-value">${statsI}</div><div class="stat-label">Izin</div></div>
                <div class="stat-item stat-sakit"><div class="stat-value">${statsS}</div><div class="stat-label">Sakit</div></div>
                <div class="stat-item stat-tk"><div class="stat-value">${statsTK}</div><div class="stat-label">Tanpa Keterangan</div></div>
                <div class="stat-item stat-persen"><div class="stat-value">${statsPersen}</div><div class="stat-label">Kehadiran</div></div>
            </div>
            <div class="table-card">
                ${tableHTML}
            </div>
        </div>
        <script>
            window.onload = function() {
                window.print();
            };
        </script>
    </body>
    </html>
  `);
  printWindow.document.close();
};

// === TAB 5: DETAIL GURU ===
async function populateGuruDropdown() {
  const select = document.getElementById("detail-guru-select");
  if (!select) return;

  const masterTeachers = await getMasterTeachersList();

  if (isRestrictedToTeacherAssignments && !hasFullAccessRole) {
    let teacherName = currentUserInfo ? currentUserInfo.nama : "";
    if (teacherName) {
      const canonical = resolveOfficialTeacherName(teacherName, masterTeachers);
      if (canonical) teacherName = canonical;
    }

    select.innerHTML = "";
    const option = document.createElement("option");
    option.value = teacherName;
    option.textContent = teacherName || "-- Guru Tidak Teridentifikasi --";
    option.selected = true;
    select.appendChild(option);
    select.disabled = true;
    // Latar terkunci menggantikan latar dasar (urutan CSS Tailwind build)
    select.classList.remove("bg-slate-50", "dark:bg-slate-900");
    select.classList.add("bg-slate-100", "dark:bg-slate-800", "cursor-not-allowed");
    return;
  }

  if (select.options.length > 1) return;
  select.disabled = false;
  select.classList.remove("bg-slate-100", "dark:bg-slate-800", "cursor-not-allowed");
  select.classList.add("bg-slate-50", "dark:bg-slate-900");

  try {
    let guruNames = new Set();
    masterTeachers.forEach((t) => {
      if (isTeacherPendidik(t)) {
        const tName = t.name || t.nama;
        if (tName) guruNames.add(tName);
      }
    });

    // Sinkronkan juga nama-nama guru dari jadwal XML SSOT
    try {
      const scheduleTeachers = await getAllScheduleTeachers();
      scheduleTeachers.forEach((st) => {
        const sName = st.name || st.xmlName;
        if (sName) {
          const canonical = resolveOfficialTeacherName(sName, masterTeachers);
          if (canonical) guruNames.add(canonical);
          else guruNames.add(sName);
        }
      });
    } catch (schErr) {
      console.warn("Warn getting schedule teachers for dropdown:", schErr);
    }

    const sortedGuru = Array.from(guruNames).sort(naturalSort);

    sortedGuru.forEach((guru) => {
      const option = document.createElement("option");
      option.value = guru;
      option.textContent = guru;
      select.appendChild(option);
    });
  } catch (e) {
    console.error("Error loading guru master list:", e);
  }
}

function initDetailPeriodeInputs() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diffToMonday);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  const elStart = document.getElementById("detail-tanggal-mulai");
  const elEnd = document.getElementById("detail-tanggal-akhir");
  const elBulan = document.getElementById("detail-bulan-rekap");

  if (elStart) elStart.value = window.getLocalISODate(monday);
  if (elEnd) elEnd.value = window.getLocalISODate(friday);
  if (elBulan) elBulan.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

window.toggleDetailPeriodeInputs = function () {
  const periodeType = document.getElementById("detail-periode-type")?.value;
  const inputMingguan = document.getElementById("detail-input-mingguan");
  const inputBulanan = document.getElementById("detail-input-bulanan");
  const inputSemester = document.getElementById("detail-input-semester");

  if (inputMingguan) inputMingguan.classList.toggle("hidden", periodeType !== "mingguan");
  if (inputBulanan) inputBulanan.classList.toggle("hidden", periodeType !== "bulanan");
  if (inputSemester) inputSemester.classList.toggle("hidden", periodeType !== "semester");
};

window.onDetailTanggalMulaiChange = function () {
  const tanggalMulai = document.getElementById("detail-tanggal-mulai")?.value;
  if (!tanggalMulai) return;

  const startDate = new Date(tanggalMulai);
  const dayOfWeek = startDate.getDay();
  if (dayOfWeek === 1) {
    const friday = new Date(startDate);
    friday.setDate(startDate.getDate() + 4);
    const elEnd = document.getElementById("detail-tanggal-akhir");
    if (elEnd) elEnd.value = window.getLocalISODate(friday);
  }
};

window.loadDetailGuru = async function () {
  await loadKelasListLocal();
  const masterTeachers = await getMasterTeachersList();

  let guruName = document.getElementById("detail-guru-select")?.value;
  if (isRestrictedToTeacherAssignments && !hasFullAccessRole && currentUserInfo) {
    const canonical = resolveOfficialTeacherName(currentUserInfo.nama, masterTeachers);
    guruName = canonical || currentUserInfo.nama;
  }

  if (!guruName) {
    showToast("Peringatan", "Pilih guru terlebih dahulu", "warning");
    return;
  }

  const container = document.getElementById("detail-guru-container");
  if (!container) return;
  container.innerHTML =
    '<div class="text-center py-12"><i class="fa-solid fa-spinner fa-spin text-2xl text-slate-400"></i><p class="text-xs text-slate-500 mt-2">Memuat Detail Presensi Guru...</p></div>';

  const periodeType = document.getElementById("detail-periode-type")?.value;
  let dates = [];
  let periodeLabel = "";

  if (periodeType === "mingguan") {
    const startVal = document.getElementById("detail-tanggal-mulai")?.value;
    const endVal = document.getElementById("detail-tanggal-akhir")?.value;
    if (startVal && endVal) {
      try {
        await fetchRegisteredHolidays(startVal, endVal);
      } catch (e) {}
    }
    const startDate = new Date(startVal);
    const endDate = new Date(endVal);

    if (isNaN(startDate) || isNaN(endDate)) {
      showToast("Peringatan", "Pilih tanggal mulai dan akhir", "warning");
      return;
    }

    periodeLabel = `${startDate.toLocaleDateString("id-ID")} - ${endDate.toLocaleDateString("id-ID")}`;
    dates = collectActiveKbmDates({ periodeType: "mingguan", startDate, endDate });
  } else if (periodeType === "bulanan") {
    const bulan = document.getElementById("detail-bulan-rekap")?.value;
    if (!bulan) {
      showToast("Peringatan", "Pilih bulan", "warning");
      return;
    }
    try {
      await fetchRegisteredHolidays(`${bulan}-01`, `${bulan}-31`);
    } catch (e) {}

    const [year, month] = bulan.split("-");
    const monthNames = [
      "Januari", "Februari", "Maret", "April", "Mei", "Juni",
      "Juli", "Agustus", "September", "Oktober", "November", "Desember",
    ];
    periodeLabel = `${monthNames[parseInt(month) - 1]} ${year}`;
    dates = collectActiveKbmDates({ periodeType: "bulanan", bulan });
  } else if (periodeType === "semester") {
    const sem = document.getElementById("detail-semester-select")?.value || "1";
    const ta = document.getElementById("detail-ta-select")?.value || raporConfig?.tahun_ajaran || "2025/2026";
    const parts = ta.split("/");
    const y1 = parts[0];
    const y2 = parts[1] || parseInt(y1, 10) + 1;
    const startSem = sem === "1" ? `${y1}-07-01` : `${y2}-01-01`;
    const endSem = sem === "1" ? `${y1}-12-31` : `${y2}-06-30`;
    try {
      await fetchRegisteredHolidays(startSem, endSem);
    } catch (e) {}

    periodeLabel = `Semester ${sem} (${sem === "1" ? "Ganjil" : "Genap"}) - TA ${ta}`;
    dates = collectActiveKbmDates({ periodeType: "semester", semester: sem, tahunAjaran: ta, raporConfig });
  }

  // Sinkronisasi SSOT Master Hari Libur Sekolah di latar belakang
  try {
    await bootstrapSyncAgendaHolidays();
  } catch (e) {}

  const todayStr = formatLocalIsoDate(new Date());

  // Mandat User: Pada tab Detail Guru, jangan memunculkan tanggal masa depan (dates > todayStr).
  // Hanya proses tanggal yang sudah tiba/terlaksana sampai hari ini.
  dates = dates.filter((d) => d <= todayStr);

  if (dates.length === 0) {
    container.innerHTML =
      '<div class="text-center text-slate-400 py-12"><i class="fa-solid fa-calendar-xmark text-3xl mb-2"></i><p class="text-sm">Tidak ada hari kerja KBM yang telah terlaksana dalam periode ini</p></div>';
    const infoEl = document.getElementById("detail-guru-info");
    if (infoEl) infoEl.classList.add("hidden");
    const btnPrint = document.getElementById("btn-print-detail");
    if (btnPrint) btnPrint.classList.add("hidden");
    return;
  }

  try {
    const matrix = await fetchCrossVerifiedData(dates, kelasList);
    const detailData = [];
    const stats = { H: 0, K: 0, I: 0, S: 0, TK: 0, TE: 0, total: 0 };
    const targetCanonical = resolveOfficialTeacherName(guruName, masterTeachers) || guruName;

    dates.forEach((date) => {
      // Lewati tanggal masa depan, akhir pekan, hari libur terdaftar, atau hari non-efektif massal
      if (date > todayStr) return;
      const selectedDate = new Date(date + "T00:00:00");
      const dayOfWeek = selectedDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) return;
      if (isHolidayDate(date) || (matrix._nonEffectiveDates && matrix._nonEffectiveDates.has(date))) {
        return;
      }

      const jpTidakEfektifAngkatanMap = buildJPTidakEfektifAngkatanMap(kelasList, matrix[date], date);

      kelasList.forEach((kelas) => {
        const angk = getAngkatanFromClass(kelas);
        for (let jpNum = 1; jpNum <= 10; jpNum++) {
          if (dayOfWeek === 1 && jpNum === 1) continue;
          if (dayOfWeek === 5 && jpNum === 10) continue;

          const cell = matrix[date][kelas]?.[jpNum];
          const { jurnal, presensi, xml } = cell || {};
          const isTidakEfektif = Boolean(jpTidakEfektifAngkatanMap[angk]?.[jpNum]);

          const rawGName = jurnal?.guru || presensi?.guru || xml?.guru || "";
          if (!rawGName || rawGName === "-" || rawGName === "Belum diisi") continue;

          const cellGuru = resolveOfficialTeacherName(rawGName, masterTeachers);
          if (cellGuru !== targetCanonical && rawGName !== guruName && cellGuru !== guruName) continue;

          const mapel = jurnal?.mapel || presensi?.mapel || xml?.mapel || "-";
          let status = "-";

          if (isTidakEfektif) {
            status = "TE";
          } else if (jurnal || (presensi && presensi.status === "H")) {
            status = "H";
          } else if (presensi && ["K", "I", "L", "S"].includes(presensi.status)) {
            const st = presensi.status;
            if (st === "K") status = "K";
            else if (st === "I" || st === "L") status = "I";
            else if (st === "S") status = "S";
          } else if (presensi && ["TK", "TT", "A"].includes(presensi.status)) {
            status = "TK";
          } else if (xml && isJPElapsed(jpNum, date)) {
            status = "TK";
          }

          // Mandat User: Pada tab Detail Guru, hanya tampilkan KBM yang SUDAH TERLAKSANA.
          // Sesi yang belum terlaksana (status "-") dilarang keras dimunculkan.
          if (!status || status === "-") {
            continue;
          }

          const selectedStatuses = getSelectedStatuses();
          if (
            selectedStatuses.length > 0 &&
            !selectedStatuses.includes(status)
          ) {
            continue;
          }

          const kegiatanText = (presensi && (presensi.kegiatan || presensi.keterangan || presensi.nama_kegiatan)) || "";

          detailData.push({
            tanggal: date,
            kelas: kelas,
            jp: jpNum,
            mapel: mapel,
            status: status,
            kegiatan: kegiatanText,
          });

          if (status === "TE") {
            stats.TE++;
          } else if (["H", "K", "I", "S", "TK", "TT"].includes(status)) {
            stats.total++;
            if (status === "H") stats.H++;
            else if (status === "K") stats.K++;
            else if (status === "I") stats.I++;
            else if (status === "S") stats.S++;
            else if (status === "TK" || status === "TT") stats.TK++;
          }
        }
      });
    });

    if (detailData.length === 0) {
      container.innerHTML =
        '<div class="text-center text-slate-400 py-12"><i class="fa-solid fa-inbox text-3xl mb-2"></i><p class="text-sm">Tidak ada data presensi untuk guru ini dalam periode tersebut</p></div>';
      const infoEl = document.getElementById("detail-guru-info");
      if (infoEl) infoEl.classList.add("hidden");
      const btnPrint = document.getElementById("btn-print-detail");
      if (btnPrint) btnPrint.classList.add("hidden");
      return;
    }

    detailData.sort((a, b) => {
      if (a.tanggal !== b.tanggal) return a.tanggal.localeCompare(b.tanggal);
      return a.jp - b.jp;
    });

    const infoEl = document.getElementById("detail-guru-info");
    if (infoEl) infoEl.classList.remove("hidden");
    const elNama = document.getElementById("detail-guru-nama");
    const elPeriode = document.getElementById("detail-guru-periode");
    const elH = document.getElementById("detail-stat-h");
    const elK = document.getElementById("detail-stat-k");
    const elI = document.getElementById("detail-stat-i");
    const elS = document.getElementById("detail-stat-s");
    const elTK = document.getElementById("detail-stat-tk");
    const elPersen = document.getElementById("detail-stat-persen");

    if (elNama) elNama.textContent = guruName;
    if (elPeriode) elPeriode.textContent = periodeLabel;
    if (elH) elH.textContent = stats.H;
    if (elK) elK.textContent = stats.K;
    if (elI) elI.textContent = stats.I;
    if (elS) elS.textContent = stats.S;
    if (elTK) elTK.textContent = stats.TK;

    const persen = stats.total > 0 ? Math.round((stats.H / stats.total) * 100) : 100;
    if (elPersen) elPersen.textContent = persen + "%";

    renderDetailGuruTable(detailData);

    const btnPrint = document.getElementById("btn-print-detail");
    if (btnPrint) btnPrint.classList.remove("hidden");
  } catch (e) {
    console.error("Error loading detail guru:", e);
    showToast("Error", "Gagal memuat data: " + e.message, "error");
  }
};

function renderDetailGuruTable(detailData) {
  const container = document.getElementById("detail-guru-container");
  if (!container) return;

  let html = `
        <table class="w-full text-sm border border-slate-200 dark:border-slate-700">
            <thead class="bg-slate-700 dark:bg-slate-800 text-white text-xs uppercase sticky top-0 border-b border-slate-600 dark:border-slate-700">
                <tr>
                    <th class="px-4 py-3 text-left border border-slate-600 dark:border-slate-700">No</th>
                    <th class="px-4 py-3 text-left border border-slate-600 dark:border-slate-700">Tanggal</th>
                    <th class="px-4 py-3 text-left border border-slate-600 dark:border-slate-700">Hari</th>
                    <th class="px-4 py-3 text-left border border-slate-600 dark:border-slate-700">Kelas</th>
                    <th class="px-4 py-3 text-center border border-slate-600 dark:border-slate-700">JP</th>
                    <th class="px-4 py-3 text-left border border-slate-600 dark:border-slate-700">Mapel</th>
                    <th class="px-4 py-3 text-center border border-slate-600 dark:border-slate-700">Status</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-700 bg-white dark:bg-slate-800">
    `;

  const dayNames = [
    "Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu",
  ];

  detailData.forEach((item, idx) => {
    const date = new Date(item.tanggal + "T00:00:00");
    const dayName = dayNames[date.getDay()];
    const statusColor =
      STATUS_COLORS[item.status] || "bg-slate-100 text-slate-700";

    const statusLabel =
      item.status === "TE"
        ? "🚫 Tidak Efektif"
        : item.status === "H"
          ? "Hadir"
          : item.status === "K"
            ? "Kegiatan"
            : item.status === "I"
              ? "Izin"
              : item.status === "S"
                ? "Sakit"
                : item.status === "TK" || item.status === "TT"
                  ? "Tanpa Keterangan"
                  : item.status;

    let kegiatanHtml = "";
    if (item.status === "K" && item.kegiatan) {
      kegiatanHtml = `
        <div class="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 text-[10.5px] font-semibold break-words max-w-[220px]" title="${escapeHTML(item.kegiatan)}">
          <i class="fa-solid fa-briefcase text-[10px] shrink-0"></i>
          <span class="truncate">${escapeHTML(item.kegiatan)}</span>
        </div>
      `;
    }

    html += `
            <tr class="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                <td class="px-4 py-3 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 text-center">${idx + 1}</td>
                <td class="px-4 py-3 font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">${date.toLocaleDateString("id-ID")}</td>
                <td class="px-4 py-3 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">${dayName}</td>
                <td class="px-4 py-3 font-bold text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">${escapeHTML(item.kelas)}</td>
                <td class="px-4 py-3 text-center border border-slate-200 dark:border-slate-700"><span class="bg-slate-800 dark:bg-slate-900 border border-transparent dark:border-slate-700 text-white px-2 py-1 rounded text-xs font-bold">JP ${item.jp}</span></td>
                <td class="px-4 py-3 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">${escapeHTML(item.mapel)}</td>
                <td class="px-4 py-3 text-center border border-slate-200 dark:border-slate-700">
                  <div>
                    <span class="${statusColor} px-2 py-1 rounded font-bold text-xs">${escapeHTML(statusLabel)}</span>
                  </div>
                  ${kegiatanHtml}
                </td>
            </tr>
        `;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

window.toggleStatusDropdown = function () {
  const dropdown = document.getElementById("status-dropdown");
  if (dropdown) dropdown.classList.toggle("hidden");
};

window.updateStatusLabel = function () {
  const checkboxes = document.querySelectorAll(".status-checkbox:checked");
  const label = document.getElementById("status-filter-label");

  if (!label) return;
  if (checkboxes.length === 0) {
    label.textContent = "Semua Status";
  } else if (checkboxes.length === 1) {
    label.textContent = checkboxes[0].value;
  } else {
    label.textContent = `${checkboxes.length} dipilih`;
  }
};

function getSelectedStatuses() {
  const checkboxes = document.querySelectorAll(".status-checkbox:checked");
  const statuses = Array.from(checkboxes).map((cb) => cb.value);
  if (statuses.includes("I") && !statuses.includes("L")) {
    statuses.push("L");
  }
  return statuses;
}

window.printDetailGuru = function () {
  const elNama = document.getElementById("detail-guru-nama");
  const elPeriode = document.getElementById("detail-guru-periode");
  const elH = document.getElementById("detail-stat-h");
  const elS = document.getElementById("detail-stat-s");
  const elPersen = document.getElementById("detail-stat-persen");
  const elContainer = document.getElementById("detail-guru-container");

  if (!elNama || !elContainer) return;

  const guruNama = elNama.textContent;
  const periode = elPeriode ? elPeriode.textContent : "";
  const statsH = elH ? elH.textContent : "0";
  const statsS = elS ? elS.textContent : "0";
  const statsPersen = elPersen ? elPersen.textContent : "0%";
  const tableHTML = elContainer.innerHTML;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    if (typeof Swal !== "undefined") {
      Swal.fire({
        icon: "warning",
        title: "Pop-up Terblokir",
        text: "Peramban memblokir jendela pratinjau cetak. Mohon izinkan pop-up (Always allow pop-ups) pada peramban Anda untuk mencetak rekap detail presensi guru.",
      });
    } else if (typeof showToast === "function") {
      showToast("Pop-up Terblokir", "Harap izinkan pop-up peramban untuk membuka pratinjau cetak.", "warning");
    }
    return;
  }

  printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Detail Presensi - ${escapeHTML(guruNama)}</title>
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; background: #f1f5f9; }
                .container { max-width: 900px; margin: 0 auto; }
                .header { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 20px; border-radius: 12px; margin-bottom: 20px; }
                .header h1 { font-size: 20px; margin-bottom: 5px; }
                .header .periode { font-size: 14px; opacity: 0.9; }
                .stats-card { background: white; border-radius: 12px; padding: 16px; margin-bottom: 20px; display: flex; gap: 12px; flex-wrap: wrap; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
                .stat-item { flex: 1; min-width: 80px; text-align: center; padding: 12px; border-radius: 8px; }
                .stat-hadir { background: #dcfce7; }
                .stat-sakit { background: #fef9c3; }
                .stat-persen { background: #1e293b; color: white; }
                .stat-value { font-size: 24px; font-weight: bold; }
                .stat-hadir .stat-value { color: #166534; }
                .stat-sakit .stat-value { color: #854d0e; }
                .stat-label { font-size: 11px; color: #64748b; margin-top: 4px; }
                .stat-persen .stat-label { color: rgba(255,255,255,0.7); }
                .table-card { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
                table { width: 100%; border-collapse: collapse; font-size: 13px; }
                th { background: #1e293b; color: white; padding: 12px 16px; text-align: left; font-weight: 600; }
                td { padding: 12px 16px; border-bottom: 1px solid #e2e8f0; }
                tr:hover { background: #f8fafc; }
                tr:last-child td { border-bottom: none; }
                .text-center { text-align: center; }
                .px-4 { padding-left: 16px; padding-right: 16px; }
                .py-3 { padding-top: 12px; padding-bottom: 12px; }
                .font-bold { font-weight: 700; }
                .rounded { border-radius: 4px; }
                .text-xs { font-size: 12px; }
                .bg-slate-800 { background: #1e293b; color: white; padding: 4px 8px; border-radius: 4px; }
                .bg-green-100 { background: #dcfce7; color: #166534; padding: 4px 10px; border-radius: 4px; }
                .bg-blue-100 { background: #dbeafe; color: #1e40af; padding: 4px 10px; border-radius: 4px; }
                .bg-yellow-100 { background: #fef9c3; color: #854d0e; padding: 4px 10px; border-radius: 4px; }
                .bg-orange-100 { background: #ffedd5; color: #9a3412; padding: 4px 10px; border-radius: 4px; }
                .bg-red-100 { background: #fee2e2; color: #991b1b; padding: 4px 10px; border-radius: 4px; }
                @media print {
                    body { background: white; padding: 10px; }
                    .header { background: #1e40af !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    .stats-card, .table-card { box-shadow: none; border: 1px solid #e2e8f0; }
                    .stat-item { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>${escapeHTML(guruNama)}</h1>
                    <div class="periode">Periode: ${escapeHTML(periode)}</div>
                </div>
                <div class="stats-card">
                    <div class="stat-item stat-hadir"><div class="stat-value">${statsH}</div><div class="stat-label">Hadir</div></div>
                    <div class="stat-item stat-sakit"><div class="stat-value">${statsS}</div><div class="stat-label">Sakit</div></div>
                    <div class="stat-item stat-persen"><div class="stat-value">${statsPersen}</div><div class="stat-label">Kehadiran</div></div>
                </div>
                <div class="table-card">
                    ${tableHTML}
                </div>
            </div>
            <script>
                window.onload = function() {
                    window.print();
                };
            </script>
        </body>
        </html>
    `);
  printWindow.document.close();
};

// === CACHE INDICATOR UI ===
function updateCacheIndicator(fromCache = false) {
  const indicator = document.getElementById("cache-status-indicator");
  if (!indicator) return;
  
  if (fromCache) {
    indicator.innerHTML = '<i class="fa-solid fa-bolt text-amber-500"></i> <span class="text-amber-600 dark:text-amber-400">Data dari Cache</span>';
    indicator.title = "Data ditampilkan dari cache lokal (hemat kuota Firestore). Tekan tombol Segarkan untuk memuat data terbaru.";
  } else {
    indicator.innerHTML = '<i class="fa-solid fa-cloud-arrow-down text-emerald-500"></i> <span class="text-emerald-600 dark:text-emerald-400">Diperbarui</span>';
    indicator.title = "Data baru saja dimuat dari Firestore.";
    // Auto-hide setelah 5 detik, ganti ke cache indicator
    setTimeout(() => {
      indicator.innerHTML = '<i class="fa-solid fa-bolt text-amber-500"></i> <span class="text-amber-600 dark:text-amber-400">Data dari Cache</span>';
      indicator.title = "Data ditampilkan dari cache lokal (hemat kuota Firestore). Tekan tombol Segarkan untuk memuat data terbaru.";
    }, 5000);
  }
}




