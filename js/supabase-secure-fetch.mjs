const PUBLIC_READ_TABLES = new Set([
  'duta_kandidat',
  'lib_config',
  'lib_kategori_ddc',
  'lib_opac_buku',
  'lib_opac_eksemplar',
  'lib_opac_hari_libur',
]);
const SENSITIVE_EMBEDDED_TABLES = new Set([
  'duta_suara_masuk',
  'finance_cashflow', 'finance_closings', 'finance_config', 'finance_daily_summary', 'finance_transactions',
  'guru_mapel_components', 'guru_mapel_gradebooks', 'guru_mapel_scores', 'guru_mapel_summaries',
  'guru_presensi', 'lib_bebas_pustaka', 'lib_pengunjung', 'lib_sirkulasi',
  'masukkan_saran', 'siswa_presensi', 'siswa_presensi_harian',
  'sukaduka_config', 'sukaduka_iuran', 'sukaduka_kas',
]);

const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'accept-profile',
  'content-profile',
  'content-type',
  'prefer',
  'range',
];

function getRequestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input.url === 'string') return input.url;
  return String(input || '');
}

function getRequestMethod(input, init = {}) {
  return String(init.method || input?.method || 'GET').toUpperCase();
}

export function getSupabaseRestTable(input, supabaseUrl) {
  try {
    const requestUrl = new URL(getRequestUrl(input));
    const configuredUrl = new URL(supabaseUrl);
    if (requestUrl.origin !== configuredUrl.origin) return '';
    const match = requestUrl.pathname.match(/^\/rest\/v1\/([a-z][a-z0-9_]*)\/?$/i);
    return match?.[1] || '';
  } catch (_error) {
    return '';
  }
}

export function shouldProxySupabaseRequest(input, init, supabaseUrl) {
  const table = getSupabaseRestTable(input, supabaseUrl);
  if (!table) return false;
  const method = getRequestMethod(input, init);
  const isRead = method === 'GET' || method === 'HEAD';
  if (!(isRead && PUBLIC_READ_TABLES.has(table))) return true;
  try {
    const select = new URL(getRequestUrl(input)).searchParams.get('select') || '';
    return [...SENSITIVE_EMBEDDED_TABLES].some(relation => select.includes(relation));
  } catch (_error) {
    return true;
  }
}

async function getRequestBody(input, init, method) {
  if (method === 'GET' || method === 'HEAD') return null;
  if (init?.body !== undefined && init.body !== null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.clone().text();
  }
  return null;
}

function collectForwardedHeaders(input, init) {
  const headers = new Headers(typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers || undefined).forEach((value, key) => headers.set(key, value));

  return Object.fromEntries(FORWARDED_REQUEST_HEADERS
    .map(name => [name, headers.get(name)])
    .filter(([, value]) => Boolean(value)));
}

function localErrorResponse(message, status) {
  return new Response(JSON.stringify({ message, code: 'secure_proxy_required' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function createSecureSupabaseFetch({
  auth,
  supabaseUrl,
  supabaseAnonKey,
  nativeFetch = globalThis.fetch.bind(globalThis),
}) {
  if (!auth || !supabaseUrl || !supabaseAnonKey) {
    throw new Error('Konfigurasi secure Supabase fetch tidak lengkap.');
  }

  const proxyUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/secure-proxy`;

  return async function secureSupabaseFetch(input, init = {}) {
    if (!shouldProxySupabaseRequest(input, init, supabaseUrl)) {
      return nativeFetch(input, init);
    }

    const user = auth.currentUser;
    if (!user) {
      return localErrorResponse('Sesi Firebase diperlukan untuk mengakses data ini.', 401);
    }

    const requestUrl = new URL(getRequestUrl(input));
    const method = getRequestMethod(input, init);
    const maxRetries = 2;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = (attempt * 250) + Math.floor(Math.random() * 80);
          await new Promise(r => setTimeout(r, delay));
        }

        const firebaseToken = await user.getIdToken();
        const body = await getRequestBody(input, init, method);
        const headers = collectForwardedHeaders(input, init);

        const response = await nativeFetch(proxyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'apikey': supabaseAnonKey,
            'x-firebase-token': firebaseToken,
          },
          body: JSON.stringify({
            action: 'supabase-rest-proxy',
            payload: {
              path: `${requestUrl.pathname}${requestUrl.search}`,
              method,
              headers,
              body,
            },
          }),
        });

        if (!response.ok) {
          try {
            const clone = response.clone();
            const errText = await clone.text();
            console.warn(`[SecureSupabaseFetch] HTTP ${response.status} pada ${method} ${requestUrl.pathname}${requestUrl.search}:`, errText);
          } catch (_e) {}
        }

        return response;
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          console.warn(`[SecureSupabaseFetch] Percobaan ${attempt + 1} pada ${method} ${requestUrl.pathname} gagal (${error?.message || error}). Mencoba ulang via TCP (${attempt + 1}/${maxRetries})...`);
        }
      }
    }

    console.error('[SecureSupabaseFetch] Proxy request gagal setelah seluruh percobaan:', lastError);
    return localErrorResponse(lastError?.message || 'Proxy Supabase tidak dapat dihubungi.', 502);
  };
}

export { PUBLIC_READ_TABLES };
