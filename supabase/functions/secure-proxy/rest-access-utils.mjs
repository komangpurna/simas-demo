export const PUBLIC_READ_TABLES = new Set([
  'duta_kandidat',
  'lib_config',
  'lib_kategori_ddc',
  'lib_opac_buku',
  'lib_opac_eksemplar',
  'lib_opac_hari_libur',
]);

const STAFF_ROLES = [
  'super_admin', 'kepala_sekolah', 'wakasek_kurikulum', 'kepala_lab',
  'kesiswaan', 'admin_spp', 'admin_perpus', 'admin_duta', 'admin_sukaduka',
  'wali_kelas', 'guru', 'guru_bk', 'guru_mapel', 'staff',
  'admin_kelas', 'admin_pks',
];

const EDUCATION_READ_ROLES = [
  'super_admin', 'kepala_sekolah', 'wakasek_kurikulum', 'kesiswaan',
  'wali_kelas', 'guru_mapel', 'guru_bk', 'staff',
];

const LIBRARY_READ_ROLES = ['super_admin', 'admin_perpus', 'staff', 'kepala_sekolah'];

const TABLE_READ_ROLES = {
  duta_suara_masuk: STAFF_ROLES,
  finance_transactions: STAFF_ROLES,
  finance_daily_summary: STAFF_ROLES,
  finance_config: STAFF_ROLES,
  finance_cashflow: ['super_admin', 'admin_spp', 'kepala_sekolah', 'wakasek_kurikulum', 'kesiswaan'],
  finance_closings: ['super_admin', 'admin_spp', 'kepala_sekolah', 'wakasek_kurikulum', 'kesiswaan'],
  rkas_komite_headers: ['super_admin', 'admin_spp', 'kepala_sekolah', 'wakasek_kurikulum', 'kesiswaan', 'staff'],
  rkas_komite_items: ['super_admin', 'admin_spp', 'kepala_sekolah', 'wakasek_kurikulum', 'kesiswaan', 'staff'],
  guru_mapel_gradebooks: EDUCATION_READ_ROLES,
  guru_mapel_components: EDUCATION_READ_ROLES,
  guru_mapel_scores: EDUCATION_READ_ROLES,
  guru_mapel_summaries: EDUCATION_READ_ROLES,
  guru_presensi: STAFF_ROLES,
  lib_buku: LIBRARY_READ_ROLES,
  lib_eksemplar: LIBRARY_READ_ROLES,
  lib_hari_libur: STAFF_ROLES,
  siswa_presensi: STAFF_ROLES,
  siswa_presensi_harian: STAFF_ROLES,
  lib_sirkulasi: LIBRARY_READ_ROLES,
  lib_pengunjung: STAFF_ROLES,
  sukaduka_config: STAFF_ROLES,
  sukaduka_iuran: STAFF_ROLES,
  sukaduka_kas: STAFF_ROLES,
  sukaduka_closings: STAFF_ROLES,
};

const TABLE_WRITE_ROLES = {
  finance_transactions: ['super_admin', 'admin_spp', 'kesiswaan', 'staff'],
  finance_daily_summary: ['super_admin', 'admin_spp', 'kesiswaan', 'staff'],
  finance_config: ['super_admin', 'admin_spp'],
  finance_cashflow: ['super_admin', 'admin_spp'],
  finance_closings: ['super_admin', 'admin_spp'],
  rkas_komite_headers: ['super_admin', 'admin_spp', 'kepala_sekolah'],
  rkas_komite_items: ['super_admin', 'admin_spp', 'kepala_sekolah'],
  guru_mapel_gradebooks: ['super_admin', 'wakasek_kurikulum', 'wali_kelas', 'guru_mapel', 'kesiswaan', 'staff'],
  guru_mapel_components: ['super_admin', 'wakasek_kurikulum', 'wali_kelas', 'guru_mapel', 'kesiswaan', 'staff'],
  guru_mapel_scores: ['super_admin', 'wakasek_kurikulum', 'wali_kelas', 'guru_mapel', 'kesiswaan', 'staff'],
  guru_mapel_summaries: ['super_admin', 'wakasek_kurikulum', 'wali_kelas', 'guru_mapel', 'kesiswaan', 'staff'],
  guru_presensi: ['super_admin', 'admin_kelas', 'wakasek_kurikulum'],
  siswa_presensi: ['super_admin', 'wali_kelas', 'admin_kelas', 'kesiswaan', 'staff'],
  siswa_presensi_harian: ['super_admin', 'wali_kelas', 'admin_kelas', 'kesiswaan', 'staff'],
  lib_buku: ['super_admin', 'admin_perpus', 'staff'],
  lib_config: ['super_admin', 'admin_perpus'],
  lib_eksemplar: ['super_admin', 'admin_perpus', 'staff'],
  lib_hari_libur: ['super_admin', 'admin_perpus', 'wakasek_kurikulum', 'staff'],
  lib_kategori_ddc: ['super_admin', 'admin_perpus'],
  lib_pengunjung: ['super_admin', 'admin_perpus', 'staff'],
  lib_sirkulasi: ['super_admin', 'admin_perpus', 'staff'],
  sukaduka_config: ['super_admin', 'admin_sukaduka'],
  sukaduka_kas: ['super_admin', 'admin_sukaduka'],
  sukaduka_iuran: ['super_admin', 'admin_sukaduka'],
  sukaduka_closings: ['super_admin', 'admin_sukaduka'],
};

const STUDENT_READ_SCOPES = {
  duta_suara_masuk: 'nis_pemilih',
  finance_transactions: 'student_nis',
  lib_sirkulasi: 'peminjam_id',
  siswa_presensi: 'student_nis',
};

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PATCH', 'DELETE']);

function hasAllowedRole(roles, allowedRoles = []) {
  const roleSet = roles instanceof Set ? roles : new Set(roles || []);
  return allowedRoles.some(role => roleSet.has(role));
}

export function parseRestTarget(path) {
  try {
    const proxyBase = 'https://secure-proxy.invalid';
    const url = new URL(path, proxyBase);
    if (url.origin !== proxyBase) return null;
    const match = url.pathname.match(/^\/rest\/v1\/([a-z][a-z0-9_]*)\/?$/i);
    if (!match) return null;
    return { table: match[1], url };
  } catch (_error) {
    return null;
  }
}

function addExactFilter(url, column, value) {
  const scopedUrl = new URL(url.toString());
  scopedUrl.searchParams.set(column, `eq.${value}`);
  return `${scopedUrl.pathname}${scopedUrl.search}`;
}

function hasMutationFilter(url) {
  const nonFilterParameters = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict']);
  return [...url.searchParams.keys()].some(key => !nonFilterParameters.has(key));
}

function getEmbeddedRelations(url) {
  const select = url.searchParams.get('select') || '';
  const relations = new Set();
  const relationPattern = /(?:^|,)(?:[a-z][a-z0-9_]*:)?([a-z][a-z0-9_]*)(?:![^,(]+)?\s*\(/gi;
  let match;
  while ((match = relationPattern.exec(select)) !== null) relations.add(match[1]);
  return [...relations];
}

export function authorizeRestRequest({
  path,
  method,
  roles = [],
  isVerifiedStudent = false,
  studentNis = '',
  staffBorrowerId = '',
  assignedClass = '',
}) {
  const target = parseRestTarget(path);
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (!target || !ALLOWED_METHODS.has(normalizedMethod)) {
    return { allowed: false, reason: 'Target atau metode PostgREST tidak diizinkan.' };
  }

  const { table, url } = target;
  const isRead = normalizedMethod === 'GET' || normalizedMethod === 'HEAD';
  if ((normalizedMethod === 'PATCH' || normalizedMethod === 'DELETE') && !hasMutationFilter(url)) {
    return { allowed: false, reason: 'Update atau hapus massal tanpa filter tidak diizinkan.' };
  }
  if (isRead && PUBLIC_READ_TABLES.has(table)) {
    const embeddedRelations = getEmbeddedRelations(url);
    const unauthorizedRelation = embeddedRelations.find(relation => (
      !PUBLIC_READ_TABLES.has(relation)
      && (isVerifiedStudent || !hasAllowedRole(roles, TABLE_READ_ROLES[relation]))
    ));
    if (unauthorizedRelation) {
      return { allowed: false, reason: `Relasi ${unauthorizedRelation} tidak diizinkan pada query publik.` };
    }
    return { allowed: true, table, path: `${url.pathname}${url.search}` };
  }

  if (isVerifiedStudent) {
    const scopeColumn = STUDENT_READ_SCOPES[table];
    if (isRead && scopeColumn && studentNis) {
      return { allowed: true, table, path: addExactFilter(url, scopeColumn, studentNis) };
    }
    if (table === 'lib_pengunjung' && (isRead || normalizedMethod === 'POST')) {
      return { allowed: true, table, path: `${url.pathname}${url.search}` };
    }
    return { allowed: false, reason: 'Siswa tidak diizinkan mengakses data tersebut.' };
  }

  if (isRead && table === 'lib_sirkulasi') {
    const roleSet = roles instanceof Set ? roles : new Set(roles || []);
    const requestedBorrower = url.searchParams.get('peminjam_id') || '';
    if (staffBorrowerId && requestedBorrower === `eq.${staffBorrowerId}`) {
      return {
        allowed: true,
        table,
        path: addExactFilter(url, 'peminjam_id', staffBorrowerId),
      };
    }
    if (roleSet.has('wali_kelas') && assignedClass) {
      return {
        allowed: true,
        table,
        path: addExactFilter(url, 'peminjam_kelas', assignedClass),
      };
    }
    if (staffBorrowerId && !roleSet.has('wali_kelas')) {
      return {
        allowed: true,
        table,
        path: addExactFilter(url, 'peminjam_id', staffBorrowerId),
      };
    }
  }

  if (isRead && hasAllowedRole(roles, TABLE_READ_ROLES[table])) {
    return { allowed: true, table, path: `${url.pathname}${url.search}` };
  }

  // Buku tamu perpustakaan memang dapat diisi oleh seluruh petugas sekolah,
  // tetapi koreksi/penghapusan riwayat tetap khusus pengelola perpustakaan.
  if (table === 'lib_pengunjung' && normalizedMethod === 'POST' && hasAllowedRole(roles, STAFF_ROLES)) {
    return { allowed: true, table, path: `${url.pathname}${url.search}` };
  }

  if (!isRead && hasAllowedRole(roles, TABLE_WRITE_ROLES[table])) {
    const restrictedAttendanceEditor = (
      ['siswa_presensi', 'siswa_presensi_harian', 'guru_presensi'].includes(table)
      && !hasAllowedRole(roles, ['super_admin', 'wakasek_kurikulum', 'kesiswaan', 'staff'])
    );
    if (restrictedAttendanceEditor && !assignedClass) {
      return { allowed: false, reason: 'Kelas penugasan pengguna belum dikonfigurasi.' };
    }
    return {
      allowed: true,
      table,
      path: restrictedAttendanceEditor
        ? addExactFilter(url, 'kelas', assignedClass)
        : `${url.pathname}${url.search}`,
      enforcedClass: restrictedAttendanceEditor ? assignedClass : '',
    };
  }

  return { allowed: false, reason: 'Role tidak memiliki akses ke operasi tersebut.' };
}

export function bodyMatchesEnforcedClass(body, enforcedClass) {
  if (!enforcedClass) return true;
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.length > 0 && rows.every(row => String(row?.kelas || '').trim() === enforcedClass);
  } catch (_error) {
    return false;
  }
}

export const DEFAULT_SECURE_PROXY_ORIGINS = [
  'https://smagesa.web.app',
  'https://smagesa.firebaseapp.com',
  'https://sman1abang.web.app',
  'https://sman1abang.firebaseapp.com',
  'https://simas-shakti.web.app',
  'https://simas-shakti.firebaseapp.com',
  'https://jurnal-smagesa.web.app',
  'https://jurnal-smagesa.firebaseapp.com',
];

export function isLocalDevOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin.trim());
}

export function resolveSecureProxyCorsOrigin(origin, extraOrigins = []) {
  if (!origin || typeof origin !== 'string') return '';
  const clean = origin.trim().replace(/\/+$/, '');
  if (DEFAULT_SECURE_PROXY_ORIGINS.includes(clean)) return clean;
  if (isLocalDevOrigin(clean)) return clean;
  if (Array.isArray(extraOrigins) && extraOrigins.some(o => typeof o === 'string' && o.trim().replace(/\/+$/, '') === clean)) {
    return clean;
  }
  return null;
}

export function canAccessRankingAggregates({
  isStudent = true,
  roles = [],
  tokenPayload = {},
  hasStudentSessionDoc = false,
} = {}) {
  // 1. Jika pengguna adalah Staf / GTK / Admin (bukan siswa, terdaftar di koleksi users Firestore), izinkan
  if (!isStudent) return true;

  // 2. Jika memiliki peran non-siswa di Firestore
  if (roles && roles.length > 0 && roles.some(r => r && r !== 'siswa')) return true;

  // 3. Jika pengguna login dengan provider non-anonim (misal Google / email password)
  const signInProvider = tokenPayload?.firebase?.sign_in_provider;
  if (signInProvider && signInProvider !== 'anonymous') return true;

  // 4. Jika pengguna adalah siswa resmi yang terverifikasi (memiliki klaim studentVerified & studentNis)
  const isVerifiedStudentClaim = tokenPayload?.studentVerified === true && Boolean(String(tokenPayload?.studentNis || '').trim());
  if (isVerifiedStudentClaim) return true;

  // 5. Fallback: Sesi aktif siswa terverifikasi di Firestore (student_sessions/{uid})
  if (hasStudentSessionDoc) return true;

  return false;
}

