// supabase/functions/secure-proxy/index.ts
// Deno Deploy serverless function untuk mengamankan Supabase DB via Firebase ID Token
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.2.0";
import {
  authorizeRestRequest,
  bodyMatchesEnforcedClass,
  canAccessRankingAggregates,
  resolveSecureProxyCorsOrigin,
} from "./rest-access-utils.mjs";

const PROJECT_ID = "simas-demo-5ead3";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const JWKS = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

// Inisialisasi Supabase Client menggunakan service_role key untuk memintas RLS secara aman
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Helper: Membangun CORS Headers dinamis dengan whitelist origin terverifikasi
function createCorsHeaders(origin?: string | null): Record<string, string> {
  const extraOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const resolved = resolveSecureProxyCorsOrigin(origin || "", extraOrigins);
  return {
    "Access-Control-Allow-Origin": resolved || (origin ? "" : "*"),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-firebase-token, x-sync-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Expose-Headers": "Content-Range, Preference-Applied, Location",
    "Vary": "Origin",
  };
}

const defaultCorsHeaders = createCorsHeaders(null);

// Helper: Verifikasi Token Firebase Auth secara kriptografis
async function verifyFirebaseToken(req: Request) {
  let token = req.headers.get("x-firebase-token");
  if (!token) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }
  }

  if (!token) {
    throw new Error("Missing or invalid Firebase authorization token");
  }

  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${PROJECT_ID}`,
    audience: PROJECT_ID,
  });
  return payload; // Mengandung claim 'sub' (Firebase UID) dan email/nama jika ada
}

interface CachedUserRole {
  primary: string;
  additional: string[];
  isStudent: boolean;
  assignedClass: string;
  linkedTeacherId: string;
  nip: string;
  cachedAt: number;
}
const userRoleCache = new Map<string, CachedUserRole>();
const ROLE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 menit TTL

// Helper: Mengambil role & additionalRoles pengguna dari Firestore (SSOT) via REST API
async function getUserRolesFromFirestore(uid: string, token?: string): Promise<{
  primary: string;
  additional: string[];
  isStudent: boolean;
  assignedClass: string;
  linkedTeacherId: string;
  nip: string;
}> {
  if (userRoleCache.has(uid)) {
    const cached = userRoleCache.get(uid)!;
    if (Date.now() - cached.cachedAt < ROLE_CACHE_TTL_MS) {
      return cached;
    }
  }

  try {
    let activeToken = token;
    if (!activeToken) {
      activeToken = await getFirebaseAuthToken();
    }
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`;
    const resp = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${activeToken}`
      }
    });
    if (resp.status === 404) {
      // Jika user tidak terdaftar di koleksi users Firestore, berarti dia adalah siswa
      const studentResult = { primary: "siswa", additional: [], isStudent: true, assignedClass: "", linkedTeacherId: "", nip: "" };
      userRoleCache.set(uid, { ...studentResult, cachedAt: Date.now() });
      return studentResult;
    }
    if (!resp.ok) {
      console.warn(`[Firestore REST] Gagal membaca user ${uid}: ${resp.status} ${resp.statusText}`);
      const fallbackResult = { primary: "siswa", additional: [], isStudent: true, assignedClass: "", linkedTeacherId: "", nip: "" };
      return fallbackResult;
    }
    const doc = await resp.json();
    const primary = doc?.fields?.role?.stringValue || "guru_mapel";
    
    const additionalFields = doc?.fields?.additionalRoles?.arrayValue?.values || [];
    const additional = additionalFields.map((v: any) => v.stringValue).filter(Boolean);
    
    const assignedClass = doc?.fields?.assignedClass?.stringValue || doc?.fields?.class?.stringValue || "";
    const linkedTeacherId = doc?.fields?.linkedTeacherId?.stringValue || "";
    const nip = doc?.fields?.nip?.stringValue || "";
    const result = { primary, additional, isStudent: false, assignedClass, linkedTeacherId, nip };
    userRoleCache.set(uid, { ...result, cachedAt: Date.now() });
    return result;
  } catch (err) {
    console.error(`[Firestore REST] Error fetch user roles:`, err);
    return { primary: "siswa", additional: [], isStudent: true, assignedClass: "", linkedTeacherId: "", nip: "" };
  }
}

// Helper: Memeriksa keberadaan dokumen sesi siswa aktif di Firestore (fallback otorisasi)
async function checkStudentSessionInFirestore(uid: string, token: string): Promise<boolean> {
  if (!uid || !token) return false;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/student_sessions/${encodeURIComponent(uid)}`;
    const resp = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!resp.ok) return false;
    const doc = await resp.json();
    return Boolean(doc?.fields?.nis?.stringValue);
  } catch (_err) {
    return false;
  }
}

async function resolveStaffBorrowerId(
  access: { linkedTeacherId: string; nip: string },
  token?: string,
): Promise<string> {
  if (access.nip) return cleanClearanceText(access.nip, 50);
  if (!access.linkedTeacherId) return "";

  try {
    const cfWorkerUrl = Deno.env.get("CLOUDFLARE_WORKER_URL") || "https://simas-smagesa-api.komangpurna1.workers.dev";
    const syncSecret = Deno.env.get("JURNAL_API_KEY") || "";
    const teacherUrl = `${cfWorkerUrl.replace(/\/+$/, "")}/api/teachers/${encodeURIComponent(access.linkedTeacherId)}`;
    const headers: Record<string, string> = {
      "X-Simas-Client": "secure-proxy-staff-borrower",
      "Accept": "application/json",
    };
    if (syncSecret) {
      headers["X-Sync-Key"] = syncSecret;
    }
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const response = await fetch(teacherUrl, { headers });
    if (!response.ok) return "";
    const teacherJson = await response.json();
    const teacherData = teacherJson?.data || {};
    return cleanClearanceText(teacherData?.nip || "", 50);
  } catch (error) {
    console.warn("[secure-proxy] Gagal menyelesaikan NIP pengguna untuk scope perpustakaan dari Cloudflare D1:", error);
    return "";
  }
}

// Helper: Validasi hak akses administratif
async function validateAdminAccess(uid: string, allowedRoles: string[], token?: string): Promise<boolean> {
  const { primary, additional } = await getUserRolesFromFirestore(uid, token);
  return allowedRoles.includes(primary) || additional.some(r => allowedRoles.includes(r));
}

const CLEARANCE_WRITE_ROLES = ["super_admin", "admin_perpus", "staff"];
const CLEARANCE_HISTORY_ROLES = [...CLEARANCE_WRITE_ROLES, "kepala_sekolah"];
const LIBRARY_WRITE_ROLES = ["super_admin", "admin_perpus", "staff"];
const LIBRARY_READ_ROLES = [...LIBRARY_WRITE_ROLES, "kepala_sekolah"];

function cleanClearanceText(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function createClearanceNumber(): string {
  const year = new Date().getFullYear();
  const uniquePart = crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
  return `421.3/${uniquePart}/SMAGESA/SKBP/${year}`;
}

function jsonResponse(body: unknown, status = 200, responseHeaders = defaultCorsHeaders): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...responseHeaders, "Content-Type": "application/json" },
  });
}

// ============================================
// SUKA-DUKA: KUNCI TAHUN BUKU (TUTUP BUKU)
// ============================================
// Tanggal hari ini zona WITA (UTC+8) agar transaksi dini hari 1 Januari tidak tercatat ke tahun lalu.
function getWitaDateStr(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().split("T")[0];
}

function getYearFromDateStr(dateStr: unknown): number | null {
  const match = /^(\d{4})-\d{2}-\d{2}/.exec(String(dateStr || ""));
  return match ? Number(match[1]) : null;
}

async function isSukadukaYearClosed(year: number | null): Promise<boolean> {
  if (!year || !Number.isInteger(year)) return false;
  const { data, error } = await supabase
    .from("sukaduka_closings")
    .select("id")
    .eq("id", String(year))
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// Tanggal pembukuan transaksi baru: jika tahun buku hari ini sudah ditutup (tutup buku dilakukan
// di bulan Desember), transaksi dibukukan ke 1 Januari tahun berikutnya agar saldo tutup buku tetap final.
async function getSukadukaPostingDateStr(): Promise<string> {
  const today = getWitaDateStr();
  const year = getYearFromDateStr(today) as number;
  return (await isSukadukaYearClosed(year)) ? `${year + 1}-01-01` : today;
}

function sukadukaClosedYearResponse(year: number): Response {
  return jsonResponse({
    error: `Tahun buku ${year} sudah ditutup. Transaksi pada tahun tersebut tidak dapat ditambah, diubah, atau dihapus.`,
  }, 409);
}

async function getSukadukaKasYear(kasId: unknown): Promise<number | null> {
  if (!kasId) return null;
  const { data, error } = await supabase
    .from("sukaduka_kas")
    .select("tanggal")
    .eq("id", kasId)
    .maybeSingle();
  if (error) throw error;
  return data ? getYearFromDateStr(data.tanggal) : null;
}

// Menjumlahkan kas masuk/keluar dalam rentang tanggal (paginasi agar tidak terpotong limit 1000 baris PostgREST).
// Perhitungan dalam satuan sen untuk menghindari galat pembulatan floating point.
async function sumSukadukaKasRange(startDate: string, endDate: string): Promise<{ incomeCents: number; expenseCents: number }> {
  const pageSize = 1000;
  let incomeCents = 0;
  let expenseCents = 0;
  for (let page = 0; ; page++) {
    const from = page * pageSize;
    const { data, error } = await supabase
      .from("sukaduka_kas")
      .select("id, tipe, jumlah")
      .gte("tanggal", startDate)
      .lte("tanggal", endDate)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    (data || []).forEach((row: any) => {
      const cents = Math.round((Number(row.jumlah) || 0) * 100);
      if (row.tipe === "masuk") incomeCents += cents;
      else if (row.tipe === "keluar") expenseCents += cents;
    });
    if (!data || data.length < pageSize) break;
  }
  return { incomeCents, expenseCents };
}

const REST_REQUEST_HEADERS = ["accept", "accept-profile", "content-profile", "content-type", "prefer", "range"];
const REST_RESPONSE_HEADERS = ["content-type", "content-range", "preference-applied", "location"];

async function relaySupabaseRestRequest(payload: any, authorizedPath: string, activeCorsHeaders = defaultCorsHeaders): Promise<Response> {
  const method = String(payload?.method || "GET").toUpperCase();
  const requestBody = typeof payload?.body === "string" ? payload.body : null;
  if (requestBody && new TextEncoder().encode(requestBody).byteLength > 5 * 1024 * 1024) {
    return jsonResponse({ message: "Payload PostgREST melebihi batas 5 MB." }, 413, activeCorsHeaders);
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ message: "Konfigurasi service-role Supabase belum tersedia." }, 503, activeCorsHeaders);
  }

  const targetUrl = new URL(authorizedPath, `${supabaseUrl.replace(/\/$/, "")}/`);
  const headers = new Headers({
    "Authorization": `Bearer ${supabaseServiceKey}`,
    "apikey": supabaseServiceKey,
  });
  const incomingHeaders = payload?.headers && typeof payload.headers === "object" ? payload.headers : {};
  REST_REQUEST_HEADERS.forEach(name => {
    const value = incomingHeaders[name];
    if (typeof value === "string" && value.length <= 500) headers.set(name, value);
  });

  const upstream = await fetch(targetUrl, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : requestBody,
  });

  const responseHeaders = new Headers(activeCorsHeaders);
  REST_RESPONSE_HEADERS.forEach(name => {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  });
  const noBody = method === "HEAD" || upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
  return new Response(noBody ? null : await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

// Helper: Mengambil Firebase ID Token (JWT) untuk service account dummy/admin secara gratis
async function getFirebaseAuthToken(): Promise<string> {
  const email = Deno.env.get("JURNAL_SYNC_EMAIL") ?? "";
  const password = Deno.env.get("JURNAL_SYNC_PASSWORD") ?? "";
  const apiKey = Deno.env.get("FIREBASE_API_KEY") ?? "AIzaSyARvuPYUSx-RHDzL5vqTayg5nDhATr0gXY";

  if (!email || !password) {
    throw new Error("Missing JURNAL_SYNC_EMAIL or JURNAL_SYNC_PASSWORD environment variables");
  }

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });

  if (!response.ok) {
    const errData = await response.json();
    throw new Error(`Firebase Auth REST failed: ${errData.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.idToken;
}

// Helper: Mengambil seluruh dokumen dari suatu koleksi Firestore secara server-side (bypass rules)
async function fetchFirestoreCollection(collectionName: string, idToken: string, queryParams: string = ""): Promise<any[]> {
  let documents: any[] = [];
  let nextPageToken = "";
  
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionName}?pageSize=300${nextPageToken ? `&pageToken=${nextPageToken}` : ""}${queryParams}`;
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${idToken}`
      }
    });
    
    if (!response.ok) {
      const errData = await response.json();
      throw new Error(`Firestore REST list failed for ${collectionName}: ${errData.error?.message || response.statusText}`);
    }
    
    const data = await response.json();
    if (data.documents) {
      documents = documents.concat(data.documents);
    }
    nextPageToken = data.nextPageToken || "";
  } while (nextPageToken);
  
  return documents;
}

async function fetchStudentIdentity(nis: string, idToken: string): Promise<{ nis: string; name: string; className: string } | null> {
  const url = `https://simas-smagesa-api.komangpurna1.workers.dev/api/students/${encodeURIComponent(nis)}`;
  const response = await fetch(url, { headers: { "Authorization": `Bearer ${idToken}` } });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Gagal memverifikasi master siswa ${nis}: HTTP ${response.status}`);
  }

  const json = await response.json();
  const student = json?.data || {};
  return {
    nis: student.nis || nis,
    name: student.name || student.nama || "-",
    className: student.class || student.kelas || "-",
  };
}

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const extraOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const resolvedOrigin = resolveSecureProxyCorsOrigin(origin, extraOrigins);

  // Tolak request browser dari origin asing di luar whitelist
  if (origin && resolvedOrigin === null) {
    return new Response(JSON.stringify({ error: "Origin not allowed by CORS" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const corsHeaders = createCorsHeaders(origin);

  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Scoped helper per request agar seluruh jsonResponse mewarisi corsHeaders origin pemanggil
  const jsonResponse = (body: unknown, status = 200): Response => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  };

  const sukadukaClosedYearResponse = (year: number): Response => {
    return jsonResponse({
      error: `Tahun buku ${year} sudah ditutup. Transaksi pada tahun tersebut tidak dapat ditambah, diubah, atau dihapus.`,
    }, 409);
  };

  let isJurnalAction = false;
  try {
    // 1. Parse Body Request terlebih dahulu untuk cek aksi
    const { action, payload } = await req.json();
    if (!action) {
      return new Response(JSON.stringify({ error: "Missing action parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    isJurnalAction = String(action).startsWith("jurnal-");
    let uid = "jurnal_system";
    let tokenPayload: any = null;
    let token = "";
    let clientSecret = "";

    if (!isJurnalAction) {
      token = req.headers.get("x-firebase-token") || "";
      if (!token) {
        const authHeader = req.headers.get("Authorization");
        if (authHeader && authHeader.startsWith("Bearer ")) {
          token = authHeader.substring(7);
        }
      }
      // Verifikasi Kriptografis Token Firebase (hanya untuk aksi internal SIMAS)
      tokenPayload = await verifyFirebaseToken(req);
      uid = tokenPayload.sub as string;
      console.log(`[secure-proxy] Action: ${action} | User UID: ${uid}`);
    } else {
      console.log(`[secure-proxy] Action Integrasi Eksternal: ${action}`);
      // Validasi Shared Key untuk Jurnal Mengajar
      clientSecret = String(payload?.secret || "");
      const expectedSecret = Deno.env.get("JURNAL_API_KEY") ?? "";
      if (!expectedSecret) {
        return new Response(JSON.stringify({ error: "Konfigurasi JURNAL_API_KEY belum tersedia" }), {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!clientSecret || clientSecret !== expectedSecret) {
        return new Response(JSON.stringify({ error: "Akses ditolak: API Key Jurnal tidak valid" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 2. Proses Rute Aksi
    switch (action) {

      // ============================================
      // 0. KOMPATIBILITAS POSTGREST TERAMANKAN
      // ============================================
      case "supabase-rest-proxy": {
        const access = await getUserRolesFromFirestore(uid, token);
        const roles = [access.primary, ...access.additional];
        const studentNis = cleanClearanceText(tokenPayload?.studentNis, 50);
        const isCirculationRead = /^\/rest\/v1\/lib_sirkulasi(?:\?|$)/.test(String(payload?.path || ""))
          && ["GET", "HEAD"].includes(String(payload?.method || "GET").toUpperCase());
        const hasFullLibraryRead = LIBRARY_READ_ROLES.some(role => roles.includes(role));
        const staffBorrowerId = isCirculationRead && !hasFullLibraryRead
          ? await resolveStaffBorrowerId(access, token)
          : "";
        const authorization = authorizeRestRequest({
          path: payload?.path,
          method: payload?.method,
          roles,
          isVerifiedStudent: tokenPayload?.studentVerified === true && Boolean(studentNis),
          studentNis,
          staffBorrowerId,
          assignedClass: access.assignedClass,
        });

        if (!authorization.allowed) {
          return jsonResponse({ message: authorization.reason || "Akses PostgREST ditolak." }, 403);
        }

        const method = String(payload?.method || "GET").toUpperCase();
        if (authorization.enforcedClass
          && method === "POST"
          && !bodyMatchesEnforcedClass(payload?.body, authorization.enforcedClass)) {
          return jsonResponse({ message: "Payload presensi tidak sesuai kelas penugasan pengguna." }, 403);
        }

        console.log(`[secure-proxy] PostgREST ${method} table=${authorization.table} uid=${uid}`);
        return relaySupabaseRestRequest(payload, authorization.path, corsHeaders);
      }

      // ============================================
      // 0B. AGREGASI METRIK RANKING KELAS (SERVER-SIDE SSOT)
      // ============================================
      case "get-ranking-aggregates": {
        // Endpoint agregasi server agar seluruh peran (Siswa, Wali Kelas, Guru Mapel, Super Admin)
        // memperoleh hasil agregat kelas yang konsisten tanpa melonggarkan RBAC data mentah.
        const access = await getUserRolesFromFirestore(uid, token);
        const roles = [access.primary, ...access.additional];

        let hasAccess = canAccessRankingAggregates({
          isStudent: access.isStudent,
          roles,
          tokenPayload,
        });

        // Fallback: jika token anonim belum memiliki klaim studentVerified di JWT, cek dokumen student_sessions/{uid}
        if (!hasAccess && access.isStudent) {
          const hasSession = await checkStudentSessionInFirestore(uid, token);
          if (hasSession) {
            hasAccess = true;
          }
        }

        if (!hasAccess) {
          return jsonResponse({ error: "Akses data agregat ranking ditolak: identitas belum terverifikasi." }, 403);
        }

        const startDate = String(payload?.startDate || "").trim();
        const endDate = String(payload?.endDate || "").trim();
        const expectedMonths = Array.isArray(payload?.expectedMonths) ? payload.expectedMonths : [];
        const classStudents = (payload?.classStudents && typeof payload.classStudents === "object") ? payload.classStudents : {};
        const activeClasses = Array.isArray(payload?.activeClasses) ? payload.activeClasses : Object.keys(classStudents);

        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
          return jsonResponse({ error: "Format rentang tanggal startDate dan endDate harus YYYY-MM-DD" }, 400);
        }

        const studentClassMap: Record<string, string> = {};
        Object.entries(classStudents).forEach(([cls, nisArr]) => {
          if (Array.isArray(nisArr)) {
            nisArr.forEach((nis: any) => {
              if (nis) studentClassMap[String(nis).trim()] = cls;
            });
          }
        });

        const fetchAllRows = async (table: string, selectCols: string, filterFn: (q: any) => any) => {
          let rows: any[] = [];
          let page = 0;
          const pageSize = 1000;
          while (true) {
            let q = supabase.from(table).select(selectCols).range(page * pageSize, (page + 1) * pageSize - 1);
            q = filterFn(q);
            const { data, error } = await q;
            if (error) throw error;
            if (!data || data.length === 0) break;
            rows = rows.concat(data);
            if (data.length < pageSize) break;
            page++;
          }
          return rows;
        };

        const resultAggregates: any = {
          attendance: {},
          spp: {},
          library: {}
        };

        const sourcesStatus: any = {
          attendance: { status: "empty", count: 0, error: null },
          spp: { status: "empty", count: 0, error: null },
          library: { status: "empty", count: 0, error: null }
        };

        // Inisialisasi awal per kelas
        activeClasses.forEach(cls => {
          const cleanCls = String(cls).replace(/^Kelas\s+/i, "").trim();
          resultAggregates.attendance[cleanCls] = { H: 0, S: 0, I: 0, D: 0, A: 0, totalDays: 0, rate: 0 };
          const studentCount = Array.isArray(classStudents[cleanCls]) ? classStudents[cleanCls].length : 0;
          resultAggregates.spp[cleanCls] = { paidCount: 0, totalCount: studentCount, rate: 0 };
          resultAggregates.library[cleanCls] = { borrowCount: 0 };
        });

        // 1. Agregasi Presensi Siswa Harian
        try {
          const attendanceRows = await fetchAllRows(
            "siswa_presensi_harian",
            "kelas, summary, tanggal, total_students",
            q => q.gte("tanggal", startDate).lte("tanggal", endDate)
          );

          sourcesStatus.attendance.count = attendanceRows.length;
          if (attendanceRows.length === 0) {
            // Fallback cerdas: coba agregasi dari detail siswa_presensi jika header harian belum terisi
            try {
              const detailRows = await fetchAllRows(
                "siswa_presensi",
                "kelas, status, tanggal",
                q => q.gte("tanggal", startDate).lte("tanggal", endDate)
              );

              if (detailRows.length > 0) {
                sourcesStatus.attendance.status = "success";
                sourcesStatus.attendance.count = detailRows.length;
                detailRows.forEach(row => {
                  const cleanCls = String(row.kelas || "").replace(/^Kelas\s+/i, "").trim();
                  if (!resultAggregates.attendance[cleanCls]) {
                    resultAggregates.attendance[cleanCls] = { H: 0, S: 0, I: 0, D: 0, A: 0, totalDays: 0, rate: 0 };
                  }
                  const st = String(row.status || "").toUpperCase().trim();
                  const att = resultAggregates.attendance[cleanCls];
                  if (st === "H") att.H += 1;
                  else if (st === "S") att.S += 1;
                  else if (st === "I") att.I += 1;
                  else if (st === "D") att.D += 1;
                  else if (st === "A") att.A += 1;
                });

                Object.keys(resultAggregates.attendance).forEach(cleanCls => {
                  const att = resultAggregates.attendance[cleanCls];
                  const total = att.H + att.S + att.I + att.D + att.A;
                  const hadirCount = att.H + att.D;
                  att.rate = total > 0 ? Number(((hadirCount / total) * 100).toFixed(1)) : 0;
                });
              } else {
                sourcesStatus.attendance.status = "empty";
              }
            } catch (_) {
              sourcesStatus.attendance.status = "empty";
            }
          } else {
            sourcesStatus.attendance.status = "success";
            // Deduplikasi per (kelas, tanggal) agar tidak ada double-counting
            const seenDay = new Set<string>();
            attendanceRows.forEach(row => {
              const cleanCls = String(row.kelas || "").replace(/^Kelas\s+/i, "").trim();
              const dateKey = `${cleanCls}_${row.tanggal}`;
              if (seenDay.has(dateKey)) return;
              seenDay.add(dateKey);

              if (!resultAggregates.attendance[cleanCls]) {
                resultAggregates.attendance[cleanCls] = { H: 0, S: 0, I: 0, D: 0, A: 0, totalDays: 0, rate: 0 };
              }

              let sum = row.summary || {};
              if (typeof sum === "string") {
                try { sum = JSON.parse(sum); } catch (_) { sum = {}; }
              }
              const h = Number(sum.H) || 0;
              const s = Number(sum.S) || 0;
              const i = Number(sum.I) || 0;
              const d = Number(sum.D) || 0;
              const a = Number(sum.A) || 0;

              const att = resultAggregates.attendance[cleanCls];
              att.H += h;
              att.S += s;
              att.I += i;
              att.D += d;
              att.A += a;
              att.totalDays += 1;
            });

            // Hitung rate kehadiran per kelas
            Object.keys(resultAggregates.attendance).forEach(cleanCls => {
              const att = resultAggregates.attendance[cleanCls];
              const total = att.H + att.S + att.I + att.D + att.A;
              const hadirCount = att.H + att.D;
              att.rate = total > 0 ? Number(((hadirCount / total) * 100).toFixed(1)) : 0;
            });
          }
        } catch (attErr: any) {
          console.error("[secure-proxy] Gagal agregasi presensi:", attErr);
          sourcesStatus.attendance.status = "error";
          sourcesStatus.attendance.error = attErr.message || "Gagal membaca presensi";
        }

        // 2. Agregasi Transaksi SPP
        try {
          const relevantYears = [...new Set(expectedMonths.map((item: any) => Number(item.year)).filter(Boolean))];
          if (relevantYears.length > 0) {
            const trxRows = await fetchAllRows(
              "finance_transactions",
              "student_nis, student_class, year, month, type",
              q => q.in("year", relevantYears).neq("type", "manual_debt")
            );

            sourcesStatus.spp.count = trxRows.length;
            if (trxRows.length === 0) {
              sourcesStatus.spp.status = "empty";
            } else {
              sourcesStatus.spp.status = "success";
              const paidSet = new Set<string>();
              trxRows.forEach(trx => {
                const nis = String(trx.student_nis || "").trim();
                const yr = Number(trx.year);
                const mo = Number(trx.month);
                if (nis && yr && mo) {
                  paidSet.add(`${nis}_${yr}_${mo}`);
                }
              });

              activeClasses.forEach(cls => {
                const cleanCls = String(cls).replace(/^Kelas\s+/i, "").trim();
                const studentsInCls = classStudents[cleanCls] || [];
                const totalSt = studentsInCls.length;
                let fullyPaidStudents = 0;
                let totalPaidMonthsInClass = 0;
                const totalExpectedMonths = expectedMonths.length || 1;

                studentsInCls.forEach((stNis: string) => {
                  const cleanNis = String(stNis || "").trim();
                  let studentPaidCount = 0;
                  expectedMonths.forEach((target: any) => {
                    if (paidSet.has(`${cleanNis}_${target.year}_${target.month}`)) {
                      studentPaidCount++;
                    }
                  });
                  totalPaidMonthsInClass += studentPaidCount;
                  if (studentPaidCount >= totalExpectedMonths) {
                    fullyPaidStudents++;
                  }
                });

                const maxPossibleMonths = totalSt * totalExpectedMonths;
                const rate = maxPossibleMonths > 0
                  ? Number(((totalPaidMonthsInClass / maxPossibleMonths) * 100).toFixed(1))
                  : 0;

                resultAggregates.spp[cleanCls] = {
                  paidCount: fullyPaidStudents,
                  totalCount: totalSt,
                  rate
                };
              });
            }
          } else {
            sourcesStatus.spp.status = "empty";
          }
        } catch (sppErr: any) {
          console.error("[secure-proxy] Gagal agregasi SPP:", sppErr);
          sourcesStatus.spp.status = "error";
          sourcesStatus.spp.error = sppErr.message || "Gagal membaca SPP";
        }

        // 3. Agregasi Sirkulasi Perpustakaan (Prioritas peminjam_kelas untuk integritas historis)
        try {
          const circRows = await fetchAllRows(
            "lib_sirkulasi",
            "id, peminjam_id, peminjam_kelas, tgl_pinjam",
            q => q.gte("tgl_pinjam", startDate).lte("tgl_pinjam", endDate).eq("peminjam_type", "siswa")
          );

          sourcesStatus.library.count = circRows.length;
          if (circRows.length === 0) {
            sourcesStatus.library.status = "empty";
          } else {
            sourcesStatus.library.status = "success";
            const seenCircId = new Set<string>();
            circRows.forEach(circ => {
              if (circ.id && seenCircId.has(String(circ.id))) return;
              if (circ.id) seenCircId.add(String(circ.id));

              let cls = String(circ.peminjam_kelas || "").replace(/^Kelas\s+/i, "").trim();
              if (!cls) {
                const nis = String(circ.peminjam_id || "").trim();
                cls = studentClassMap[nis] || "";
              }

              if (cls && resultAggregates.library[cls]) {
                resultAggregates.library[cls].borrowCount += 1;
              } else if (cls) {
                resultAggregates.library[cls] = { borrowCount: 1 };
              }
            });
          }
        } catch (libErr: any) {
          console.error("[secure-proxy] Gagal agregasi perpus:", libErr);
          sourcesStatus.library.status = "error";
          sourcesStatus.library.error = libErr.message || "Gagal membaca sirkulasi perpustakaan";
        }

        return jsonResponse({
          success: true,
          period: { startDate, endDate },
          aggregates: resultAggregates,
          sourcesStatus,
          timestamp: Date.now()
        }, 200);
      }
      
      // ============================================
      // A. MODUL MASUKAN & SARAN (FEEDBACK)
      // ============================================
      case "get-feedbacks": {
        // Cek apakah user adalah salah satu dari 5 pimpinan: super_admin, kepala_sekolah, kesiswaan, wakasek_kurikulum, kepala_lab
        const isLeadership = await validateAdminAccess(uid, ["super_admin", "kepala_sekolah", "kesiswaan", "wakasek_kurikulum", "kepala_lab", "humas", "sarpras"], token);

        let query = supabase.from("masukkan_saran").select("*");

        // Jika BUKAN salah satu dari 5 pimpinan (misal guru mapel, staff, wali kelas, admin spp, dll.),
        // batasi query HANYA untuk masukan dari pengguna internal (bukan laporan publik/tamu luar)
        if (!isLeadership) {
          query = query.neq("sender_role", "public");
        }

        const queryLimit = (payload && typeof payload.limit === "number" && payload.limit > 0)
          ? Math.min(payload.limit, 300)
          : 100;

        const { data, error } = await query.order("created_at", { ascending: false }).limit(queryLimit);

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, data, isLeadership }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "submit-feedback": {
        // 1. Validasi Tipe & Panjang Input
        const rawTitle = typeof payload.title === "string" ? payload.title.trim() : "";
        const rawMessage = typeof payload.message === "string" ? payload.message.trim() : "";
        
        if (!rawTitle || !rawMessage) {
          return new Response(JSON.stringify({ error: "Judul dan isi masukan wajib diisi" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (rawTitle.length > 150) {
          return new Response(JSON.stringify({ error: "Judul maksimal 150 karakter" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (rawMessage.length > 2500) {
          return new Response(JSON.stringify({ error: "Isi laporan maksimal 2500 karakter" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // 2. Sanitasi & Whitelist Target Recipient
        const validTargets = ["all", "kepala_sekolah", "wakasek_kurikulum", "kesiswaan", "humas", "sarpras", "kepala_lab", "staff", "guru", "super_admin"];
        const targetRecipient = validTargets.includes(payload.target_recipient) ? payload.target_recipient : "all";

        // 3. Sanitasi & Whitelist Reporter Type
        const validReporters = ["siswa", "orang_tua", "guru_staf", "alumni", "tamu_umum", "anonim", "internal"];
        const reporterType = validReporters.includes(payload.reporter_type) ? payload.reporter_type : (payload.sender_role === "public" ? "tamu_umum" : "internal");

        // 4. Anti-Spam Rate Limiting (Mencegah flooding request dari UID/klien yang sama dalam 10 detik)
        const tenSecondsAgo = new Date(Date.now() - 10000).toISOString();
        const { data: recentSubmissions } = await supabase
          .from("masukkan_saran")
          .select("id")
          .eq("sender_uid", uid)
          .gte("created_at", tenSecondsAgo)
          .limit(1);

        if (recentSubmissions && recentSubmissions.length > 0) {
          return new Response(JSON.stringify({ error: "Terlalu cepat. Harap tunggu 10 detik sebelum mengirim laporan berikutnya." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // 5. Sanitasi String Sender Name, Contact Info, dan Category
        const senderName = typeof payload.sender_name === "string" ? payload.sender_name.slice(0, 100).trim() : "Anonim";
        const contactInfo = typeof payload.contact_info === "string" ? payload.contact_info.slice(0, 100).trim() : null;
        const category = typeof payload.category === "string" ? payload.category.slice(0, 80).trim() : "Saran, Aspirasi & Pengaduan Umum";

        const feedbackData = {
          category,
          title: rawTitle,
          message: rawMessage,
          status: "baru",
          target_recipient: targetRecipient,
          reporter_type: reporterType,
          contact_info: contactInfo,
          sender_uid: uid, // Dipaksa dari JWT Firebase yang sudah diverifikasi cryptographically
          sender_name: senderName,
          sender_email: payload.sender_email || tokenPayload?.email || null,
          sender_role: payload.sender_role || "public",
          sender_roles: payload.sender_roles || (payload.sender_role ? [payload.sender_role] : ["public"]),
          source_url: typeof payload.source_url === "string" ? payload.source_url.slice(0, 255) : null,
          response_text: null,
          response_by_uid: null,
          response_by_name: null,
          responded_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
          .from("masukkan_saran")
          .insert([feedbackData])
          .select()
          .single();

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "tanggapi-feedback": {
        // Hanya boleh oleh 5 role pimpinan/admin: super_admin, kepala_sekolah, kesiswaan, wakasek_kurikulum, kepala_lab
        const isAdmin = await validateAdminAccess(uid, ["super_admin", "kepala_sekolah", "kesiswaan", "wakasek_kurikulum", "kepala_lab", "humas", "sarpras"], token);
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Akses ditolak: Hanya Pimpinan & Administrator yang berhak menanggapi laporan" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const validStatuses = ["baru", "proses", "direncanakan", "butuh_info", "selesai", "ditolak"];
        const status = validStatuses.includes(payload.status) ? payload.status : "proses";
        const responseText = typeof payload.response_text === "string" ? payload.response_text.trim().slice(0, 3000) : "";

        if (!payload.id || !responseText) {
          return new Response(JSON.stringify({ error: "ID dan isi tanggapan wajib diisi" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Ambil replies yang sudah ada untuk diappend ke thread percakapan
        const { data: existingFeedback } = await supabase
          .from("masukkan_saran")
          .select("replies, sender_uid, title")
          .eq("id", payload.id)
          .single();

        const existingReplies = Array.isArray(existingFeedback?.replies) ? existingFeedback.replies : [];
        const responderName = typeof payload.response_by_name === "string" ? payload.response_by_name.slice(0, 100) : "Pimpinan";

        const newReply = {
          id: crypto.randomUUID(),
          sender_uid: uid,
          sender_name: responderName,
          sender_role: "leadership",
          sender_type: "leadership",
          message: responseText,
          created_at: new Date().toISOString()
        };
        const updatedReplies = [...existingReplies, newReply];

        const { data, error } = await supabase
          .from("masukkan_saran")
          .update({
            status,
            response_text: responseText,
            response_by_uid: uid,
            response_by_name: responderName,
            responded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            replies: updatedReplies
          })
          .eq("id", payload.id)
          .select()
          .single();

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "reply-feedback": {
        // Balasan lanjutan (thread percakapan): dapat dikirim oleh pengirim masukan (reporter) maupun pimpinan (leadership)
        if (!payload.id) {
          return new Response(JSON.stringify({ error: "ID masukan wajib disertakan" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const replyMessage = typeof payload.message === "string" ? payload.message.trim().slice(0, 3000) : "";
        if (!replyMessage) {
          return new Response(JSON.stringify({ error: "Isi balasan tidak boleh kosong" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: feedbackItem, error: fetchErr } = await supabase
          .from("masukkan_saran")
          .select("*")
          .eq("id", payload.id)
          .single();

        if (fetchErr || !feedbackItem) {
          return new Response(JSON.stringify({ error: "Masukan tidak ditemukan" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const isSender = feedbackItem.sender_uid === uid;
        const isLeadership = await validateAdminAccess(uid, ["super_admin", "kepala_sekolah", "kesiswaan", "wakasek_kurikulum", "kepala_lab", "humas", "sarpras"], token);
        const userAccess = await getUserRolesFromFirestore(uid, token);
        const allRoles = [userAccess.primary, ...(userAccess.additional || [])].filter(Boolean);
        const isGtk = !userAccess.isStudent && !allRoles.includes("siswa") && allRoles.length > 0;

        if (!isSender && !isLeadership && !isGtk) {
          return new Response(JSON.stringify({ error: "Akses ditolak: Hanya GTK (Guru dan Tenaga Kependidikan) atau pemilik masukan yang berhak membalas masukan ini." }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const senderType = isLeadership ? "leadership" : (isSender ? "reporter" : "gtk");
        const senderRole = typeof payload.sender_role === "string" && payload.sender_role
          ? payload.sender_role
          : (isLeadership ? "leadership" : (isSender ? (feedbackItem.sender_role || "reporter") : (userAccess.primary || "gtk")));
        const senderName = typeof payload.sender_name === "string" && payload.sender_name.trim()
          ? payload.sender_name.trim().slice(0, 100)
          : (isSender ? feedbackItem.sender_name : (isLeadership ? "Pimpinan" : "GTK"));

        const existingReplies = Array.isArray(feedbackItem.replies) ? [...feedbackItem.replies] : [];

        // Migrasi aman: jika belum ada replies namun sudah ada response_text lama, jadikan entri pertama di thread
        if (existingReplies.length === 0 && feedbackItem.response_text) {
          existingReplies.push({
            id: crypto.randomUUID(),
            sender_uid: feedbackItem.response_by_uid || "leadership",
            sender_name: feedbackItem.response_by_name || "Pimpinan",
            sender_role: "leadership",
            sender_type: "leadership",
            message: feedbackItem.response_text,
            created_at: feedbackItem.responded_at || feedbackItem.updated_at || feedbackItem.created_at
          });
        }

        const senderPhoto = typeof payload.sender_photo === "string" ? payload.sender_photo.slice(0, 500).trim() : null;
        const newReply = {
          id: crypto.randomUUID(),
          sender_uid: uid,
          sender_name: senderName,
          sender_role: senderRole,
          sender_type: senderType,
          sender_photo: senderPhoto,
          message: replyMessage,
          created_at: new Date().toISOString()
        };
        const updatedReplies = [...existingReplies, newReply];

        const updateData: Record<string, any> = {
          replies: updatedReplies,
          updated_at: new Date().toISOString()
        };

        if (isSender) {
          // Jika pengirim membalas, status kembali 'proses' jika sebelumnya butuh_info/selesai/ditolak
          if (["selesai", "ditolak", "butuh_info"].includes(feedbackItem.status)) {
            updateData.status = "proses";
          }
        } else if (isLeadership) {
          // Jika pimpinan membalas lanjutan:
          if (payload.status) {
            const validStatuses = ["baru", "proses", "direncanakan", "butuh_info", "selesai", "ditolak"];
            if (validStatuses.includes(payload.status)) {
              updateData.status = payload.status;
            }
          }
          updateData.response_text = replyMessage;
          updateData.response_by_uid = uid;
          updateData.response_by_name = senderName;
          updateData.responded_at = new Date().toISOString();
        } else if (isGtk) {
          // Jika GTK umum berpartisipasi dan masukan masih berstatus 'baru', alihkan ke 'proses'
          if (feedbackItem.status === "baru") {
            updateData.status = "proses";
          }
        }

        const { data, error } = await supabase
          .from("masukkan_saran")
          .update(updateData)
          .eq("id", payload.id)
          .select()
          .single();

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "edit-feedback-reply": {
        // Edit balasan thread masukan oleh pembuat balasan atau super_admin
        const feedbackId = String(payload.id || payload.feedbackId || "").trim();
        const replyId = String(payload.replyId || payload.reply_id || "").trim();
        const newMessage = typeof payload.message === "string" ? payload.message.trim().slice(0, 3000) : "";

        if (!feedbackId || !replyId || !newMessage) {
          return new Response(JSON.stringify({ error: "ID tiket, ID balasan, dan pesan baru wajib diisi" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: feedbackItem, error: fetchErr } = await supabase
          .from("masukkan_saran")
          .select("*")
          .eq("id", feedbackId)
          .single();

        if (fetchErr || !feedbackItem) {
          return new Response(JSON.stringify({ error: "Masukan tidak ditemukan" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const existingReplies = Array.isArray(feedbackItem.replies) ? [...feedbackItem.replies] : [];
        const targetIndex = existingReplies.findIndex((r: any) => r && r.id === replyId);
        if (targetIndex === -1) {
          return new Response(JSON.stringify({ error: "Balasan tidak ditemukan" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const targetReply = existingReplies[targetIndex];
        const isOwner = targetReply.sender_uid === uid;
        const isSuperAdmin = await validateAdminAccess(uid, ["super_admin"], token);

        if (!isOwner && !isSuperAdmin) {
          return new Response(JSON.stringify({ error: "Forbidden: Anda hanya berhak mengedit balasan milik sendiri." }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        existingReplies[targetIndex] = {
          ...targetReply,
          message: newMessage,
          edited_at: new Date().toISOString()
        };

        const updateData: Record<string, any> = {
          replies: existingReplies,
          updated_at: new Date().toISOString()
        };

        if (feedbackItem.response_by_uid === uid && feedbackItem.response_text === targetReply.message) {
          updateData.response_text = newMessage;
        }

        const { data, error } = await supabase
          .from("masukkan_saran")
          .update(updateData)
          .eq("id", feedbackId)
          .select()
          .single();

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "edit-feedback": {
        // Edit masukan utama oleh pemilik masukan atau super_admin
        const feedbackId = String(payload.id || payload.feedbackId || "").trim();
        const title = typeof payload.title === "string" ? payload.title.trim().slice(0, 150) : "";
        const message = typeof payload.message === "string" ? payload.message.trim().slice(0, 2500) : "";
        const category = typeof payload.category === "string" ? payload.category.trim().slice(0, 80) : "";

        if (!feedbackId || !title || !message) {
          return new Response(JSON.stringify({ error: "ID tiket, judul, dan isi masukan wajib diisi" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: feedbackItem, error: fetchErr } = await supabase
          .from("masukkan_saran")
          .select("*")
          .eq("id", feedbackId)
          .single();

        if (fetchErr || !feedbackItem) {
          return new Response(JSON.stringify({ error: "Masukan tidak ditemukan" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const userEmail = (tokenPayload?.email || "").toLowerCase().trim();
        const feedbackEmail = (feedbackItem.sender_email || "").toLowerCase().trim();
        const isOwner = feedbackItem.sender_uid === uid || (Boolean(userEmail && feedbackEmail && userEmail === feedbackEmail));
        const isSuperAdmin = await validateAdminAccess(uid, ["super_admin"], token);

        if (!isOwner && !isSuperAdmin) {
          return new Response(JSON.stringify({ error: "Forbidden: Anda hanya berhak mengedit masukan milik sendiri." }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const currentStatus = String(feedbackItem.status || 'baru').toLowerCase();
        if (!isSuperAdmin && (currentStatus === 'selesai' || currentStatus === 'ditolak')) {
          return new Response(JSON.stringify({ error: `Masukan yang telah berstatus '${currentStatus}' sudah final dan tidak dapat diedit kembali.` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const updateData: Record<string, any> = {
          title,
          message,
          updated_at: new Date().toISOString()
        };
        if (category) {
          updateData.category = category;
        }

        const { data, error } = await supabase
          .from("masukkan_saran")
          .update(updateData)
          .eq("id", feedbackId)
          .select()
          .single();

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "check-feedback-badge": {
        // Pengecekan ringan masukan/balasan baru untuk badge 'NEW' di menu
        const isLeadership = await validateAdminAccess(uid, ["super_admin", "kepala_sekolah", "kesiswaan", "wakasek_kurikulum", "kepala_lab", "humas", "sarpras"], token);
        const rawLastVisited = typeof payload.last_visited === "string" ? payload.last_visited : null;

        let hasNew = false;
        if (isLeadership) {
          let query = supabase.from("masukkan_saran").select("id", { count: "exact", head: true });
          if (rawLastVisited) {
            // Hanya aktif jika ada tiket baru atau balasan baru SETELAH kunjungan terakhir pengguna
            query = query.or(`created_at.gt.${rawLastVisited},updated_at.gt.${rawLastVisited}`);
          } else {
            query = query.eq("status", "baru");
          }
          const { count } = await query;
          hasNew = (count || 0) > 0;
        } else {
          if (rawLastVisited) {
            const { count } = await supabase
              .from("masukkan_saran")
              .select("id", { count: "exact", head: true })
              .eq("sender_uid", uid)
              .gt("updated_at", rawLastVisited);
            hasNew = (count || 0) > 0;
          }
        }
        return new Response(JSON.stringify({ success: true, hasNew }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "toggle-feedback-like": {
        // Toggle dukungan (Like / Upvote) pada tiket masukan oleh pengguna terotentikasi
        if (!uid) {
          return new Response(JSON.stringify({ error: "Otentikasi diperlukan untuk menyukai masukan" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!payload.id) {
          return new Response(JSON.stringify({ error: "ID masukan wajib disertakan" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: item, error: fetchErr } = await supabase
          .from("masukkan_saran")
          .select("id, likes")
          .eq("id", payload.id)
          .single();

        if (fetchErr || !item) {
          return new Response(JSON.stringify({ error: "Masukan tidak ditemukan" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        let existingLikes = Array.isArray(item.likes) ? [...item.likes] : [];
        let liked = false;

        if (existingLikes.includes(uid)) {
          existingLikes = existingLikes.filter((u: string) => u !== uid);
          liked = false;
        } else {
          existingLikes.push(uid);
          liked = true;
        }

        const { error: updateErr } = await supabase
          .from("masukkan_saran")
          .update({
            likes: existingLikes,
            updated_at: new Date().toISOString(),
          })
          .eq("id", payload.id);

        if (updateErr) throw updateErr;

        return new Response(
          JSON.stringify({
            success: true,
            liked,
            likeCount: existingLikes.length,
            likes: existingLikes,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      case "delete-feedback": {
        const isAdmin = await validateAdminAccess(uid, ["super_admin"], token);
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Akses ditolak: Hanya Super Admin yang dapat menghapus masukan" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { error } = await supabase
          .from("masukkan_saran")
          .delete()
          .eq("id", payload.id);

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, message: "Masukan berhasil dihapus" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ============================================
      // B. MODUL PEMILIHAN DUTA (VOTING)
      // ============================================
      case "duta-vote": {
        // Validasi: super_admin, admin_kelas, dan admin_pks dilarang memberikan suara
        const { primary, additional, isStudent, assignedClass } = await getUserRolesFromFirestore(uid, token);
        const forbiddenRoles = ["super_admin", "admin_kelas", "admin_pks"];
        const hasForbiddenRole = forbiddenRoles.includes(primary) || additional.some(r => forbiddenRoles.includes(r));
        if (hasForbiddenRole) {
          return new Response(JSON.stringify({ error: "Akses ditolak: Akun admin/akses khusus dikecualikan dari voting Duta SHAKTI" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const role_pemilih = isStudent ? "siswa" : "guru";

        const requestedVotes = (Array.isArray(payload) ? payload : [payload]).slice(0, 6);
        const validCategories = new Set(["Sehat", "Humanis", "Agamais", "Kreatif", "Trampil", "Inovatif"]);
        if (requestedVotes.length === 0 || requestedVotes.some((item: any) => (
          !item
          || !validCategories.has(String(item.kategori || ""))
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(item.id_kandidat || ""))
        ))) {
          return jsonResponse({ error: "Payload suara atau kategori kandidat tidak valid." }, 400);
        }

        const candidateIds = [...new Set(requestedVotes.map((item: any) => String(item.id_kandidat)))];
        const { data: candidates, error: candidateError } = await supabase
          .from("duta_kandidat")
          .select("id,kategori")
          .in("id", candidateIds);
        if (candidateError) throw candidateError;
        const candidateCategory = new Map((candidates || []).map((item: any) => [String(item.id), String(item.kategori)]));
        if (requestedVotes.some((item: any) => candidateCategory.get(String(item.id_kandidat)) !== String(item.kategori))) {
          return jsonResponse({ error: "Kandidat tidak ditemukan atau kategori suara tidak cocok." }, 400);
        }

        let voterId = uid;
        let voterName = cleanClearanceText(tokenPayload?.name || tokenPayload?.email || "Guru/Staff", 255);
        let voterClass = assignedClass || "Guru/Staff";
        if (isStudent) {
          const claimedNis = cleanClearanceText(tokenPayload?.studentNis, 50);
          if (tokenPayload?.studentVerified !== true || !claimedNis) {
            return jsonResponse({ error: "Identitas siswa belum terverifikasi." }, 403);
          }
          const studentIdentity = await fetchFirestoreStudentIdentity(claimedNis, token);
          if (!studentIdentity) return jsonResponse({ error: "Data master siswa tidak ditemukan." }, 404);
          voterId = studentIdentity.nis;
          voterName = studentIdentity.name;
          voterClass = studentIdentity.className;
        }

        const voteData = requestedVotes.map((item: any) => ({
          nis_pemilih: voterId,
          nama_pemilih: voterName,
          kelas_pemilih: voterClass,
          id_kandidat: String(item.id_kandidat),
          kategori: String(item.kategori),
          role_pemilih,
        }));

        // Simpan atau update suara (UPSERT)
        const { data, error } = await supabase
          .from("duta_suara_masuk")
          .upsert(voteData, { onConflict: "nis_pemilih,kategori" })
          .select();

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "duta-kandidat-save": {
        const isAdmin = await validateAdminAccess(uid, ["super_admin", "kesiswaan", "admin_duta"], token);
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Akses ditolak: Hak admin kesiswaan/Duta SHAKTI diperlukan" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { id, nama, kategori, foto_url, video_url, kelas, prestasi, catatan_lain } = payload;
        let result;
        
        if (id) {
          // Update
          const { data, error } = await supabase
            .from("duta_kandidat")
            .update({ nama, kategori, foto_url, video_url, kelas, prestasi, catatan_lain })
            .eq("id", id)
            .select();
          if (error) throw error;
          result = data;
        } else {
          // Insert
          const { data, error } = await supabase
            .from("duta_kandidat")
            .insert({ nama, kategori, foto_url, video_url, kelas, prestasi, catatan_lain })
            .select();
          if (error) throw error;
          result = data;
        }

        return new Response(JSON.stringify({ success: true, data: result }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "duta-kandidat-delete": {
        const isAdmin = await validateAdminAccess(uid, ["super_admin", "kesiswaan", "admin_duta"], token);
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Akses ditolak" }), { status: 403, headers: corsHeaders });
        }

        const { id } = payload;
        const { error } = await supabase
          .from("duta_kandidat")
          .delete()
          .eq("id", id);

        if (error) throw error;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "duta-rekam-jejak-save": {
        const isAdmin = await validateAdminAccess(uid, ["super_admin", "kesiswaan", "admin_duta"], token);
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Akses ditolak: Hak admin kesiswaan/Duta SHAKTI diperlukan" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const scores = payload; // Array of { id: string, rekamJejak: number }
        if (!Array.isArray(scores)) {
          return new Response(JSON.stringify({ error: "Payload harus berupa array" }), { status: 400, headers: corsHeaders });
        }

        const promises = scores.map(item => {
          return supabase
            .from("duta_kandidat")
            .update({ skor_rekam_jejak: item.rekamJejak })
            .eq("id", item.id);
        });

        const results = await Promise.all(promises);
        const errs = results.map(r => r.error).filter(Boolean);
        if (errs.length > 0) {
          console.error("Gagal menyimpan rekam jejak:", errs);
          throw new Error("Sebagian data gagal disimpan di database.");
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ============================================
      // C. MODUL IURAN SUKA-DUKA GURU
      // ============================================
      case "sukaduka-bayar-iuran": {
        // Hanya boleh diakses oleh super_admin atau admin_sukaduka
        const isAdmin = await validateAdminAccess(uid, ["super_admin", "admin_sukaduka"]);
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Akses ditolak: Hak admin suka-duka diperlukan" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { guru_id, anggota_nama, anggota_nip, bulan_tahun, jumlah, creator } = payload;
        const tanggalBayar = getWitaDateStr();
        const tanggalBuku = await getSukadukaPostingDateStr();

        // Operasi transaksional SQL via API client di Edge Function:
        // 1. Simpan Kas Masuk
        const { data: kasData, error: kasError } = await supabase
          .from("sukaduka_kas")
          .insert({
            tipe: "masuk",
            kategori: "iuran_bulanan",
            jumlah: jumlah,
            keterangan: `${anggota_nama} (${bulan_tahun})`,
            created_by: creator,
            tanggal: tanggalBuku
          })
          .select()
          .single();

        if (kasError) throw kasError;

        // 2. Simpan/Upsert detail iuran anggota
        const { error: iuranError } = await supabase
          .from("sukaduka_iuran")
          .upsert({
            guru_id,
            anggota_nama,
            anggota_nip: anggota_nip || null,
            bulan_tahun,
            jumlah,
            kas_id: kasData.id,
            created_by: creator,
            tanggal_bayar: tanggalBayar
          }, { onConflict: "guru_id,bulan_tahun" });

        if (iuranError) {
          // Rollback kas jika iuran gagal (safe rollback)
          try {
            await supabase.from("sukaduka_kas").delete().eq("id", kasData.id);
          } catch (rbErr) {
            console.error("[Rollback] Gagal rollback kas sukaduka:", rbErr);
          }
          throw iuranError;
        }

        return new Response(JSON.stringify({ success: true, kas_id: kasData.id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "sukaduka-catat-denda": {
        const isAdmin = await validateAdminAccess(uid, ["super_admin", "admin_sukaduka"]);
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Akses ditolak" }), { status: 403, headers: corsHeaders });
        }

        const tanggalDenda = await getSukadukaPostingDateStr();

        const { data, error } = await supabase
          .from("sukaduka_kas")
          .insert({
            tipe: "masuk",
            kategori: "lain_lain",
            jumlah: payload.jumlah,
            keterangan: payload.keterangan,
            created_by: payload.creator,
            tanggal: tanggalDenda
          })
          .select();

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "sukaduka-mutasi-kas": {
        const isAdmin = await validateAdminAccess(uid, ["super_admin", "admin_sukaduka"]);
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Akses ditolak" }), { status: 403, headers: corsHeaders });
        }

        const { tipe, kategori, jumlah, keterangan, created_by, tanggal } = payload;
        const tanggalMutasi = tanggal || await getSukadukaPostingDateStr();
        const tahunMutasi = getYearFromDateStr(tanggalMutasi);
        if (!tahunMutasi) {
          return jsonResponse({ error: "Format tanggal mutasi kas tidak valid (YYYY-MM-DD)." }, 400);
        }
        if (await isSukadukaYearClosed(tahunMutasi)) return sukadukaClosedYearResponse(tahunMutasi);

        const { data, error } = await supabase
          .from("sukaduka_kas")
          .insert({
            tipe,
            kategori,
            jumlah,
            keterangan,
            created_by,
            tanggal: tanggalMutasi
          })
          .select();

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "sukaduka-hapus-tx": {
        const isAdmin = await validateAdminAccess(uid, ["super_admin", "admin_sukaduka"]);
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Akses ditolak" }), { status: 403, headers: corsHeaders });
        }

        const { id, type, year, month, guru_id, anggota_nama, anggota_nip, creator } = payload;
        
        if (type === "iuran") {
          if (id === "virtual") {
            // Lunas virtual, kembalikan ke belum lunas (nominal iuran 0)
            const key = `${year}-${String(month).padStart(2, "0")}`;
            const { error } = await supabase
              .from("sukaduka_iuran")
              .upsert({
                guru_id,
                anggota_nama,
                anggota_nip: anggota_nip || null,
                bulan_tahun: key,
                jumlah: 0,
                created_by: creator
              }, { onConflict: "guru_id,bulan_tahun" });
            if (error) throw error;
          } else {
            // Pembayaran nyata
            const isVirtualPaidRange = (year < 2026) || (year === 2026 && month <= 5);
            
            const { data: iuranRecord, error: getError } = await supabase
              .from("sukaduka_iuran")
              .select("kas_id")
              .eq("id", id)
              .single();
              
            if (getError) throw getError;

            // Kunci tahun buku: kas iuran yang tercatat di tahun yang sudah ditutup tidak boleh dihapus
            const kasYear = await getSukadukaKasYear(iuranRecord?.kas_id);
            if (await isSukadukaYearClosed(kasYear)) return sukadukaClosedYearResponse(kasYear as number);

            if (isVirtualPaidRange) {
              // Update record iuran tersebut menjadi jumlah: 0 (menandakan belum lunas)
              const { error: updError } = await supabase
                .from("sukaduka_iuran")
                .update({ jumlah: 0, kas_id: null })
                .eq("id", id);
              if (updError) throw updError;
              
              // Hapus kas yang terhubung
              if (iuranRecord?.kas_id) {
                const { error: delKasError } = await supabase
                  .from("sukaduka_kas")
                  .delete()
                  .eq("id", iuranRecord.kas_id);
                if (delKasError) throw delKasError;
              }
            } else {
              // Di luar range virtual: Hapus data kas_id (cascade delete iuran)
              if (iuranRecord?.kas_id) {
                const { error: delError } = await supabase
                  .from("sukaduka_kas")
                  .delete()
                  .eq("id", iuranRecord.kas_id);
                if (delError) throw delError;
              } else {
                const { error: delIuranError } = await supabase
                  .from("sukaduka_iuran")
                  .delete()
                  .eq("id", id);
                if (delIuranError) throw delIuranError;
              }
            }
          }
        } else if (type === "kas") {
          // Hapus Kas Keluar/Pencairan biasa
          const kasYear = await getSukadukaKasYear(id);
          if (await isSukadukaYearClosed(kasYear)) return sukadukaClosedYearResponse(kasYear as number);

          const { error: delKasError } = await supabase
            .from("sukaduka_kas")
            .delete()
            .eq("id", id);
            
          if (delKasError) throw delKasError;
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "sukaduka-update-config": {
        if (!payload) {
          return new Response(JSON.stringify({ error: "Payload tidak valid atau kosong" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const isAdmin = await validateAdminAccess(uid, ["super_admin", "admin_sukaduka"]);
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Akses ditolak: Hak admin suka-duka diperlukan" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Pengaturan denda hanya boleh diubah oleh super_admin
        const isSuperAdmin = await validateAdminAccess(uid, ["super_admin"]);
        if (!isSuperAdmin) {
          let hasDenda = false;
          if (Array.isArray(payload)) {
            hasDenda = payload.some((item: any) => 
              ["denda_aktif", "denda_kelipatan_bulan", "denda_nominal"].includes(item.key)
            );
          } else if (payload && payload.key) {
            hasDenda = ["denda_aktif", "denda_kelipatan_bulan", "denda_nominal"].includes(payload.key);
          }
          
          if (hasDenda) {
            return new Response(JSON.stringify({ error: "Akses ditolak: Pengaturan sanksi denda hanya dapat diubah oleh Super Admin" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        let error;
        if (Array.isArray(payload)) {
          const configUpserts = payload.map((item: any) => ({
            key: item.key,
            value: String(item.value),
            updated_at: new Date().toISOString()
          }));
          const { error: err } = await supabase
            .from("sukaduka_config")
            .upsert(configUpserts);
          error = err;
        } else {
          const { key, value } = payload;
          const { error: err } = await supabase
            .from("sukaduka_config")
            .update({ value, updated_at: new Date().toISOString() })
            .eq("key", key);
          error = err;
        }

        if (error) throw error;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "sukaduka-save-kas-awal": {
        if (!payload) {
          return new Response(JSON.stringify({ error: "Payload tidak valid atau kosong" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const isAdmin = await validateAdminAccess(uid, ["super_admin", "admin_sukaduka"]);
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Akses ditolak: Hak admin suka-duka diperlukan" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { nominal, creator } = payload;
        if (nominal < 0) {
          return new Response(JSON.stringify({ error: "Nominal kas awal tidak boleh kurang dari 0" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Cari data kas_awal terdaftar
        const { data: existing, error: getError } = await supabase
          .from("sukaduka_kas")
          .select("id, tanggal")
          .eq("kategori", "kas_awal")
          .maybeSingle();

        if (getError) throw getError;

        // Kunci tahun buku: kas awal yang tercatat di tahun tertutup sudah menjadi bagian saldo tutup buku
        const kasAwalTanggal = existing ? existing.tanggal : await getSukadukaPostingDateStr();
        const kasAwalYear = getYearFromDateStr(kasAwalTanggal);
        if (await isSukadukaYearClosed(kasAwalYear)) return sukadukaClosedYearResponse(kasAwalYear as number);

        let dbError;
        if (existing) {
          // Update
          const { error: updError } = await supabase
            .from("sukaduka_kas")
            .update({
              jumlah: nominal,
              created_by: creator
            })
            .eq("id", existing.id);
          dbError = updError;
        } else {
          // Insert baru
          const { error: insError } = await supabase
            .from("sukaduka_kas")
            .insert({
              tipe: "masuk",
              kategori: "kas_awal",
              jumlah: nominal,
              keterangan: "Saldo Kas Awal (Migrasi Data)",
              created_by: creator,
              tanggal: kasAwalTanggal
            });
          dbError = insError;
        }

        if (dbError) throw dbError;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "sukaduka-tutup-buku": {
        if (!payload || !payload.year) {
          return new Response(JSON.stringify({ error: "Payload tidak valid: parameter year diperlukan" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const isAdmin = await validateAdminAccess(uid, ["super_admin", "admin_sukaduka"]);
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Akses ditolak: Hak admin suka-duka diperlukan" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { saldo_akhir, closed_by } = payload;
        const year = Number(payload.year);
        if (!Number.isInteger(year) || year < 2000) {
          return jsonResponse({ error: "Payload tidak valid: tahun buku tidak dikenali." }, 400);
        }

        // 1. Tahun buku berjalan baru boleh ditutup mulai 1 Desember (zona WITA); tahun lalu kapan saja
        const witaToday = getWitaDateStr();
        const currentWitaYear = getYearFromDateStr(witaToday) as number;
        const currentWitaMonth = Number(witaToday.substring(5, 7));
        const isClosingWindowOpen = year < currentWitaYear || (year === currentWitaYear && currentWitaMonth === 12);
        if (!isClosingWindowOpen) {
          return jsonResponse({ error: `Tahun buku ${year} baru dapat ditutup mulai 1 Desember ${year}.` }, 400);
        }

        // 2. Tidak boleh menutup ulang & harus berurutan
        const { data: closingRows, error: closingListError } = await supabase
          .from("sukaduka_closings")
          .select("year, saldo_akhir");
        if (closingListError) throw closingListError;

        const closedYears = (closingRows || []).map((c: any) => Number(c.year)).filter((y: number) => Number.isInteger(y));
        if (closedYears.includes(year)) {
          return jsonResponse({ error: `Tahun buku ${year} sudah ditutup sebelumnya.` }, 409);
        }

        let saldoAwalCents = 0;
        if (closedYears.length > 0) {
          const latestClosedYear = Math.max(...closedYears);
          if (year !== latestClosedYear + 1) {
            return jsonResponse({ error: `Tutup buku harus berurutan. Tutup tahun buku ${latestClosedYear + 1} terlebih dahulu.` }, 409);
          }
          const prevClosing = (closingRows || []).find((c: any) => Number(c.year) === latestClosedYear);
          saldoAwalCents = Math.round((Number(prevClosing?.saldo_akhir) || 0) * 100);
        } else {
          // Belum pernah tutup buku: tahun yang ditutup harus tahun transaksi paling awal
          const { data: earliestKas, error: earliestError } = await supabase
            .from("sukaduka_kas")
            .select("tanggal")
            .order("tanggal", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (earliestError) throw earliestError;
          const earliestYear = earliestKas ? getYearFromDateStr(earliestKas.tanggal) : null;
          if (earliestYear && earliestYear < year) {
            return jsonResponse({ error: `Tutup buku harus berurutan. Tutup tahun buku ${earliestYear} terlebih dahulu.` }, 409);
          }
        }

        // 3. Hitung ulang ringkasan di server (sumber kebenaran), lalu cocokkan dengan pratinjau yang disetujui admin
        const { incomeCents, expenseCents } = await sumSukadukaKasRange(`${year}-01-01`, `${year}-12-31`);
        const saldoAkhirCents = saldoAwalCents + incomeCents - expenseCents;
        if (Math.round((Number(saldo_akhir) || 0) * 100) !== saldoAkhirCents) {
          return jsonResponse({
            error: "Data kas berubah sejak pratinjau dibuka. Silakan buka ulang wizard tutup buku untuk melihat angka terbaru.",
          }, 409);
        }

        const docId = String(year);
        const nowIso = new Date().toISOString();
        const totals = {
          saldo_awal: saldoAwalCents / 100,
          total_income: incomeCents / 100,
          total_expense: expenseCents / 100,
          saldo_akhir: saldoAkhirCents / 100,
        };

        // Insert (bukan upsert) agar penutupan ganda ditolak oleh primary key
        const { error: closingError } = await supabase
          .from("sukaduka_closings")
          .insert({
            id: docId,
            year,
            saldo_akhir: totals.saldo_akhir,
            total_income: totals.total_income,
            total_expense: totals.total_expense,
            closed_at: nowIso,
            closed_by: closed_by || "Admin",
            summary: { ...totals, closed_at: nowIso }
          });

        if (closingError) {
          if ((closingError as any).code === "23505") {
            return jsonResponse({ error: `Tahun buku ${year} sudah ditutup sebelumnya.` }, 409);
          }
          throw closingError;
        }

        return jsonResponse({ success: true, id: docId, year, ...totals });
      }

      // ============================================
      // D. STATUS BEBAS PUSTAKA (Firebase RBAC + RLS)
      // ============================================
      case "library-clearance-get": {
        const rawNisList = Array.isArray(payload?.nisList) ? payload.nisList : [payload?.nis];
        const nisList = [...new Set(rawNisList
          .map((value: unknown) => cleanClearanceText(value, 50))
          .filter(Boolean))].slice(0, 100);

        if (nisList.length === 0) return jsonResponse({ success: true, data: [] });

        const claimedStudentNis = cleanClearanceText(tokenPayload?.studentNis, 50);
        const isVerifiedStudent = tokenPayload?.studentVerified === true && Boolean(claimedStudentNis);
        const canReadAsStudent = isVerifiedStudent && nisList.length === 1 && nisList[0] === claimedStudentNis;

        let canReadAsStaff = false;
        if (!canReadAsStudent) {
          const access = await getUserRolesFromFirestore(uid, token);
          const roles = new Set([access.primary, ...access.additional]);
          canReadAsStaff = CLEARANCE_HISTORY_ROLES.some(role => roles.has(role));

          // Wali kelas hanya boleh membaca status siswa pada kelas yang memang
          // ditugaskan kepadanya, bukan NIS arbitrer dari kelas lain.
          if (!canReadAsStaff && roles.has("wali_kelas") && access.assignedClass) {
            const masterStudents = await Promise.all(nisList.map(nis => fetchStudentIdentity(nis, token)));
            canReadAsStaff = masterStudents.every(student => (
              student !== null && student.className === access.assignedClass
            ));
          }
        }

        if (!canReadAsStudent && !canReadAsStaff) {
          return jsonResponse({ error: "Akses data bebas pustaka ditolak." }, 403);
        }

        const { data, error } = await supabase
          .from("lib_bebas_pustaka")
          .select("*")
          .in("student_nis", nisList);
        if (error) throw error;
        return jsonResponse({ success: true, data: data || [] });
      }

      case "library-clearance-history": {
        const hasAccess = await validateAdminAccess(uid, CLEARANCE_HISTORY_ROLES, token);
        if (!hasAccess) return jsonResponse({ error: "Akses riwayat bebas pustaka ditolak." }, 403);

        const { data, error } = await supabase
          .from("lib_bebas_pustaka")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) throw error;
        return jsonResponse({ success: true, data: data || [] });
      }

      case "library-clearance-approve": {
        const hasAccess = await validateAdminAccess(uid, CLEARANCE_WRITE_ROLES, token);
        if (!hasAccess) return jsonResponse({ error: "Akses penerbitan bebas pustaka ditolak." }, 403);

        const requestedStudents = Array.isArray(payload?.students) ? payload.students : [];
        if (requestedStudents.length === 0 || requestedStudents.length > 100) {
          return jsonResponse({ error: "Daftar siswa harus berisi 1 sampai 100 siswa." }, 400);
        }

        const uniqueStudentNis = new Set<string>();
        requestedStudents.forEach((student: any) => {
          const nis = cleanClearanceText(student?.nis, 50);
          if (nis) uniqueStudentNis.add(nis);
        });

        if (uniqueStudentNis.size === 0) return jsonResponse({ error: "Tidak ada identitas siswa yang valid." }, 400);

        // Nama dan kelas selalu diambil ulang dari master Firestore; nilai yang
        // dikirim browser hanya dipakai untuk memilih NIS, bukan isi surat resmi.
        const requestedNisList = [...uniqueStudentNis];
        const masterStudents = await Promise.all(requestedNisList.map(nis => (
          fetchFirestoreStudentIdentity(nis, token)
        )));
        const rejected: Array<{ nis: string; reason: string }> = [];
        const students = masterStudents.filter((student, index): student is { nis: string; name: string; className: string } => {
          if (student) return true;
          rejected.push({ nis: requestedNisList[index], reason: "Siswa tidak ditemukan pada master Firestore." });
          return false;
        });
        if (students.length === 0) return jsonResponse({ success: true, data: [], rejected });
        const nisList = students.map(student => student.nis);

        // Verifikasi ulang tepat sebelum write: keputusan tidak mempercayai cache UI.
        const { data: circulationRows, error: circulationError } = await supabase
          .from("lib_sirkulasi")
          .select("peminjam_id,status,status_denda,total_denda")
          .in("peminjam_id", nisList);
        if (circulationError) throw circulationError;

        const burdenedNis = new Set<string>();
        (circulationRows || []).forEach((row: any) => {
          if (row.status === "dipinjam" || row.status_denda === "belum_lunas") {
            burdenedNis.add(String(row.peminjam_id));
          }
        });

        const { data: existingRows, error: existingError } = await supabase
          .from("lib_bebas_pustaka")
          .select("*")
          .in("student_nis", nisList);
        if (existingError) throw existingError;
        const existingByNis = new Map((existingRows || []).map((row: any) => [String(row.student_nis), row]));

        const academicYear = cleanClearanceText(payload?.academicYear, 50);
        const purpose = cleanClearanceText(payload?.purpose, 100) || "Pengambilan Ijazah / Kelulusan";
        const academicYearMatch = academicYear.match(/^(\d{4})\/(\d{4})$/);
        const academicStartYear = Number(academicYearMatch?.[1]);
        const academicEndYear = Number(academicYearMatch?.[2]);
        if (!academicYearMatch
          || academicStartYear < 2000
          || academicStartYear > 2100
          || academicEndYear !== academicStartYear + 1) {
          return jsonResponse({ error: "Format tahun ajaran tidak valid." }, 400);
        }

        const recordsToInsert: any[] = [];
        const existingToUpdate: any[] = [];
        students.forEach(student => {
          if (burdenedNis.has(student.nis)) {
            rejected.push({ nis: student.nis, reason: "Masih memiliki pinjaman aktif atau denda belum lunas." });
            return;
          }

          const existing: any = existingByNis.get(student.nis);
          const record = {
            no_surat: existing?.no_surat || createClearanceNumber(),
            student_nis: student.nis,
            student_name: student.name || existing?.student_name || "-",
            student_class: student.className || existing?.student_class || "-",
            tahun_ajaran: academicYear,
            keperluan: purpose,
            tgl_terbit: new Date().toISOString().slice(0, 10),
            status_verifikasi: "disetujui",
            petugas_nama: cleanClearanceText(tokenPayload?.name || tokenPayload?.email || "Petugas Perpustakaan", 255),
            petugas_uid: uid,
          };

          if (existing) existingToUpdate.push({ id: existing.id, record });
          else recordsToInsert.push(record);
        });

        const issued: any[] = [];
        for (const item of existingToUpdate) {
          const { data, error } = await supabase
            .from("lib_bebas_pustaka")
            .update(item.record)
            .eq("id", item.id)
            .select()
            .single();
          if (error) throw error;
          issued.push(data);
        }

        if (recordsToInsert.length > 0) {
          const { data, error } = await supabase
            .from("lib_bebas_pustaka")
            .upsert(recordsToInsert, { onConflict: "student_nis" })
            .select();
          if (error) throw error;
          issued.push(...(data || []));
        }

        return jsonResponse({ success: true, data: issued, rejected });
      }

      case "library-clearance-revoke": {
        const hasAccess = await validateAdminAccess(uid, CLEARANCE_WRITE_ROLES, token);
        if (!hasAccess) return jsonResponse({ error: "Akses pencabutan bebas pustaka ditolak." }, 403);

        const nis = cleanClearanceText(payload?.nis, 50);
        if (!nis) return jsonResponse({ error: "NIS siswa wajib diisi." }, 400);
        const { error } = await supabase.from("lib_bebas_pustaka").delete().eq("student_nis", nis);
        if (error) throw error;
        return jsonResponse({ success: true });
      }

      // ============================================
      // E. SIRKULASI PERPUSTAKAAN ATOMIK
      // ============================================
      case "library-circulation-borrow": {
        const hasAccess = await validateAdminAccess(uid, LIBRARY_WRITE_ROLES, token);
        if (!hasAccess) return jsonResponse({ error: "Akses peminjaman buku ditolak." }, 403);

        const eksemplarId = Number(payload?.eksemplarId);
        const borrowerType = cleanClearanceText(payload?.borrowerType, 20).toLowerCase();
        const borrowerId = cleanClearanceText(payload?.borrowerId, 50);
        let borrowerName = cleanClearanceText(payload?.borrowerName, 255);
        let borrowerClass = cleanClearanceText(payload?.borrowerClass, 50);
        const loanDate = cleanClearanceText(payload?.loanDate, 10);
        const dueDate = cleanClearanceText(payload?.dueDate, 10);

        if (!Number.isSafeInteger(eksemplarId) || eksemplarId < 1
          || !["siswa", "guru"].includes(borrowerType)
          || !borrowerId || !borrowerName
          || !/^\d{4}-\d{2}-\d{2}$/.test(loanDate)
          || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
          return jsonResponse({ error: "Data transaksi peminjaman tidak valid." }, 400);
        }

        if (borrowerType === "siswa") {
          const verifiedStudent = await fetchFirestoreStudentIdentity(borrowerId, token);
          if (!verifiedStudent) return jsonResponse({ error: "Siswa tidak ditemukan pada master aktif." }, 400);
          borrowerName = verifiedStudent.name;
          borrowerClass = verifiedStudent.className;
        }

        const { data, error } = await supabase.rpc("lib_borrow_copy", {
          p_eksemplar_id: eksemplarId,
          p_peminjam_type: borrowerType,
          p_peminjam_id: borrowerId,
          p_peminjam_nama: borrowerName,
          p_peminjam_kelas: borrowerClass,
          p_tgl_pinjam: loanDate,
          p_tgl_jatuh_tempo: dueDate,
          p_petugas_uid: uid,
        });
        if (error) return jsonResponse({ error: error.message }, 409);
        return jsonResponse({ success: true, data: Array.isArray(data) ? data[0] : data });
      }

      case "library-circulation-return": {
        const hasAccess = await validateAdminAccess(uid, LIBRARY_WRITE_ROLES, token);
        if (!hasAccess) return jsonResponse({ error: "Akses pengembalian buku ditolak." }, 403);

        const circulationId = Number(payload?.circulationId);
        const returnDate = cleanClearanceText(payload?.returnDate, 10);
        const condition = cleanClearanceText(payload?.condition, 30).toLowerCase();
        if (!Number.isSafeInteger(circulationId) || circulationId < 1
          || !/^\d{4}-\d{2}-\d{2}$/.test(returnDate)
          || !["baik", "rusak_ringan", "rusak_berat", "hilang"].includes(condition)) {
          return jsonResponse({ error: "Data pengembalian tidak valid." }, 400);
        }

        const { data, error } = await supabase.rpc("lib_return_copy", {
          p_sirkulasi_id: circulationId,
          p_tgl_kembali: returnDate,
          p_kondisi: condition,
          p_petugas_uid: uid,
        });
        if (error) return jsonResponse({ error: error.message }, 409);
        return jsonResponse({ success: true, data: Array.isArray(data) ? data[0] : data });
      }

      case "library-circulation-extend": {
        const hasAccess = await validateAdminAccess(uid, LIBRARY_WRITE_ROLES, token);
        if (!hasAccess) return jsonResponse({ error: "Akses perpanjangan buku ditolak." }, 403);

        const circulationId = Number(payload?.circulationId);
        if (!Number.isSafeInteger(circulationId) || circulationId < 1) {
          return jsonResponse({ error: "ID transaksi tidak valid." }, 400);
        }

        const { data, error } = await supabase.rpc("lib_extend_loan", {
          p_sirkulasi_id: circulationId,
          p_petugas_uid: uid,
        });
        if (error) return jsonResponse({ error: error.message }, 409);
        return jsonResponse({ success: true, data: Array.isArray(data) ? data[0] : data });
      }

      case "library-catalog-archive": {
        const hasAccess = await validateAdminAccess(uid, LIBRARY_WRITE_ROLES, token);
        if (!hasAccess) return jsonResponse({ error: "Akses arsip katalog ditolak." }, 403);

        const bookId = Number(payload?.bookId);
        if (!Number.isSafeInteger(bookId) || bookId < 1) {
          return jsonResponse({ error: "ID buku tidak valid." }, 400);
        }

        const { error } = await supabase.rpc("lib_archive_book", {
          p_buku_id: bookId,
          p_petugas_uid: uid,
        });
        if (error) return jsonResponse({ error: error.message }, 409);
        return jsonResponse({ success: true });
      }

      case "library-copy-archive": {
        const hasAccess = await validateAdminAccess(uid, LIBRARY_WRITE_ROLES, token);
        if (!hasAccess) return jsonResponse({ error: "Akses arsip eksemplar ditolak." }, 403);

        const copyId = Number(payload?.copyId);
        if (!Number.isSafeInteger(copyId) || copyId < 1) {
          return jsonResponse({ error: "ID eksemplar tidak valid." }, 400);
        }

        const { error } = await supabase.rpc("lib_archive_copy", {
          p_eksemplar_id: copyId,
          p_petugas_uid: uid,
        });
        if (error) return jsonResponse({ error: error.message }, 409);
        return jsonResponse({ success: true });
      }

      case "library-fine-settle": {
        const hasAccess = await validateAdminAccess(uid, LIBRARY_WRITE_ROLES, token);
        if (!hasAccess) return jsonResponse({ error: "Akses pelunasan denda ditolak." }, 403);

        const circulationId = Number(payload?.circulationId);
        if (!Number.isSafeInteger(circulationId) || circulationId < 1) {
          return jsonResponse({ error: "ID transaksi tidak valid." }, 400);
        }

        const { data, error } = await supabase.rpc("lib_settle_fine", {
          p_sirkulasi_id: circulationId,
          p_petugas_uid: uid,
        });
        if (error) return jsonResponse({ error: error.message }, 409);
        return jsonResponse({ success: true, data: Array.isArray(data) ? data[0] : data });
      }

      // ============================================
      // F. INTEGRASI JURNAL MENGAJAR (EKSTERNAL)
      // ============================================
      case "jurnal-sync-siswa": {
        const cfWorkerUrl = Deno.env.get("CLOUDFLARE_WORKER_URL") || "https://simas-smagesa-api.komangpurna1.workers.dev";
        const syncSecret = Deno.env.get("JURNAL_API_KEY") || clientSecret || "";
        let students: any[] = [];
        let fetchedFromCloudflare = false;

        // 1. Prioritas Utama: Ambil dari Cloudflare D1 Serverless SQL (Edge API Gateway)
        try {
          let cfUrl = `${cfWorkerUrl.replace(/\/+$/, '')}/api/sync/jurnal-students?status=active`;
          if (payload?.classes && Array.isArray(payload.classes) && payload.classes.length > 0) {
            cfUrl += `&classes=${encodeURIComponent(payload.classes.join(','))}`;
          } else if (payload?.class && typeof payload.class === 'string' && payload.class.trim()) {
            cfUrl += `&class=${encodeURIComponent(payload.class.trim())}`;
          }

          const cfResp = await fetch(cfUrl, {
            method: "GET",
            headers: {
              "X-Sync-Key": syncSecret,
              "X-Simas-Client": "secure-proxy-m2m",
              "Accept": "application/json"
            }
          });

          if (cfResp.ok) {
            const cfJson = await cfResp.json();
            if (cfJson.success && Array.isArray(cfJson.data)) {
              students = cfJson.data;
              console.log(`[secure-proxy] Berhasil menyinkronkan ${students.length} siswa dari Cloudflare D1 (0 Firestore Read).`);
            }
          } else {
            console.warn(`[secure-proxy] Cloudflare sync non-200 (${cfResp.status})`);
          }
        } catch (cfErr: any) {
          console.warn(`[secure-proxy] Gagal fetch Cloudflare D1: ${cfErr?.message || cfErr}`);
        }

        return new Response(JSON.stringify({
          success: true,
          source: "cloudflare-d1",
          data: students
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "jurnal-get-presensi-kelas": {
        const targetClass = payload?.kelas;
        const targetDate = payload?.tanggal;
        if (!targetClass || !targetDate) {
          return new Response(JSON.stringify({ error: "Parameter kelas dan tanggal diperlukan" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data, error } = await supabase
          .from("siswa_presensi")
          .select("student_nis, student_name, status, note")
          .eq("kelas", targetClass)
          .eq("tanggal", targetDate);

        if (error) {
          throw new Error(`Gagal membaca siswa_presensi: ${error.message}`);
        }

        return new Response(JSON.stringify({
          success: true,
          data: data || []
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "jurnal-sync-guru": {
        const idToken = await getFirebaseAuthToken();
        
        // 1. Ambil rapor_config
        const raporConfigUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/settings/rapor_config`;
        const rcResp = await fetch(raporConfigUrl, { headers: { "Authorization": `Bearer ${idToken}` } });
        if (!rcResp.ok) throw new Error("Gagal mengambil settings/rapor_config dari Firestore SIMAS");
        const raporConfig = await rcResp.json();
        
        const fields = raporConfig.fields || {};
        const cleanRaporConfig = {
          mapel_list: fields.mapel_list?.arrayValue?.values?.map((v: any) => v.stringValue || v.mapValue?.fields?.nama?.stringValue || "")?.filter(Boolean) || [],
          mapel_guru: {} as any
        };
        
        const mapelGuruFields = fields.mapel_guru?.mapValue?.fields || {};
        for (const [mapelName, val] of Object.entries(mapelGuruFields)) {
          const teachersList = (val as any).arrayValue?.values || [];
          cleanRaporConfig.mapel_guru[mapelName] = teachersList.map((t: any) => {
            if (t.stringValue) {
              return {
                uid: t.stringValue,
                nama: "",
                kelas: []
              };
            }
            const tFields = t.mapValue?.fields || {};
            const kelasArray = tFields.kelas?.arrayValue?.values?.map((k: any) => k.stringValue) || [];
            return {
              uid: tFields.uid?.stringValue || tFields.id?.stringValue || "",
              nama: tFields.nama?.stringValue || tFields.name?.stringValue || "",
              kelas: kelasArray
            };
          });
        }

        // 2. Ambil users & teachers (paralel atau spesifik UID)
        let users = [];
        let teachers = [];

        const cfWorkerUrl = Deno.env.get("CLOUDFLARE_WORKER_URL") || "https://simas-smagesa-api.komangpurna1.workers.dev";
        const syncSecret = Deno.env.get("JURNAL_API_KEY") || clientSecret || "";

        // Helper fetch GTK dari Cloudflare D1
        async function fetchD1Teacher(teacherId: string) {
          try {
            const url = `${cfWorkerUrl.replace(/\/+$/, "")}/api/teachers/${encodeURIComponent(teacherId)}`;
            const resp = await fetch(url, {
              headers: {
                "X-Sync-Key": syncSecret,
                "X-Simas-Client": "secure-proxy-sync-guru",
                "Accept": "application/json",
                "Authorization": `Bearer ${idToken}`,
              },
            });
            if (!resp.ok) return null;
            const resJson = await resp.json();
            return resJson?.data || null;
          } catch (e) {
            console.warn(`[secure-proxy] Gagal fetch teacher ${teacherId} dari D1:`, e);
            return null;
          }
        }

        async function fetchD1TeachersList() {
          try {
            const url = `${cfWorkerUrl.replace(/\/+$/, "")}/api/teachers?status=active&limit=1000`;
            const resp = await fetch(url, {
              headers: {
                "X-Sync-Key": syncSecret,
                "X-Simas-Client": "secure-proxy-sync-guru",
                "Accept": "application/json",
                "Authorization": `Bearer ${idToken}`,
              },
            });
            if (!resp.ok) return [];
            const resJson = await resp.json();
            return Array.isArray(resJson?.data) ? resJson.data : [];
          } catch (e) {
            console.warn("[secure-proxy] Gagal fetch list teachers dari D1:", e);
            return [];
          }
        }

        if (payload?.uid) {
          // Sync 1 guru saja (mengurangi beban read Firestore)
          // Cari di users terlebih dahulu
          const userUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${payload.uid}`;
          const uResp = await fetch(userUrl, { headers: { "Authorization": `Bearer ${idToken}` } });
          if (uResp.ok) {
            const u = await uResp.json();
            const id = u.name.split("/").pop();
            const uFields = u.fields || {};
            const linkedId = uFields.linkedTeacherId?.stringValue || "";
            const additionalRoles = uFields.additionalRoles?.arrayValue?.values?.map((v: any) => v.stringValue)?.filter(Boolean) || [];
            users.push({
              uid: id,
              name: uFields.name?.stringValue || "",
              role: uFields.role?.stringValue || "guru_mapel",
              additionalRoles: additionalRoles,
              linkedTeacherId: linkedId,
              assignedClass: uFields.assignedClass?.stringValue || ""
            });

            if (linkedId) {
              const tData = await fetchD1Teacher(linkedId);
              if (tData) {
                teachers.push({
                  id: tData.id || linkedId,
                  name: tData.name || tData.nama || "",
                  nip: tData.nip || "-",
                  jabatan: tData.jabatan || tData.jenis_ptk || ""
                });
              }
            }
          } else {
            // Cek langsung di D1 jika payload.uid adalah teacher ID
            const tData = await fetchD1Teacher(payload.uid);
            if (tData) {
              teachers.push({
                id: tData.id || payload.uid,
                name: tData.name || tData.nama || "",
                nip: tData.nip || "-",
                jabatan: tData.jabatan || tData.jenis_ptk || ""
              });
            }
          }
        } else {
          // Sync semua guru: users dari Firestore, master guru/GTK dari Cloudflare D1 (Pure SSOT)
          const [rawUsers, rawTeachers] = await Promise.all([
            fetchFirestoreCollection("users", idToken),
            fetchD1TeachersList()
          ]);

          users = rawUsers.map((u: any) => {
            const id = u.name.split("/").pop();
            const uFields = u.fields || {};
            const additionalRoles = uFields.additionalRoles?.arrayValue?.values?.map((v: any) => v.stringValue)?.filter(Boolean) || [];
            return {
              uid: id,
              name: uFields.name?.stringValue || "",
              role: uFields.role?.stringValue || "guru_mapel",
              additionalRoles: additionalRoles,
              linkedTeacherId: uFields.linkedTeacherId?.stringValue || "",
              assignedClass: uFields.assignedClass?.stringValue || ""
            };
          });

          teachers = rawTeachers.map((t: any) => ({
            id: t.id || t.nik || t.nip || "",
            name: t.name || t.nama || "",
            nip: t.nip || "-",
            jabatan: t.jabatan || t.jenis_ptk || ""
          }));
        }

        return new Response(JSON.stringify({
          success: true,
          data: {
            rapor_config: cleanRaporConfig,
            users,
            teachers
          }
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[secure-proxy] Error:`, errMsg);
    if (isJurnalAction) {
      return new Response(JSON.stringify({ error: `Jurnal Sync Error: ${errMsg}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const authenticationError = /firebase|jwt|jws|jwe|token|signature|issuer|audience|authorization|credential|claim/i.test(errMsg);
    return new Response(JSON.stringify({
      error: authenticationError
        ? "Sesi autentikasi tidak valid atau sudah kedaluwarsa."
        : "Operasi server gagal diproses. Silakan coba kembali.",
    }), {
      status: authenticationError ? 401 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
