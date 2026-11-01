import {
  createSecureSupabaseFetch,
  getSupabaseRestTable,
  shouldProxySupabaseRequest,
} from './supabase-secure-fetch.mjs';
import { jest } from '@jest/globals';

const SUPABASE_URL = 'https://project.supabase.co';
const ANON_KEY = 'public-anon-key';

describe('Secure Supabase fetch adapter', () => {
  test('mengenali tabel dan membiarkan katalog public-read tetap langsung', () => {
    const url = `${SUPABASE_URL}/rest/v1/lib_opac_buku?select=*`;
    expect(getSupabaseRestTable(url, SUPABASE_URL)).toBe('lib_opac_buku');
    expect(shouldProxySupabaseRequest(url, { method: 'GET' }, SUPABASE_URL)).toBe(false);
    expect(shouldProxySupabaseRequest(url, { method: 'PATCH' }, SUPABASE_URL)).toBe(true);
    expect(shouldProxySupabaseRequest(
      `${SUPABASE_URL}/rest/v1/lib_buku?select=*`,
      { method: 'GET' },
      SUPABASE_URL,
    )).toBe(true);
    expect(shouldProxySupabaseRequest(
      `${SUPABASE_URL}/rest/v1/finance_config?select=*`,
      { method: 'GET' },
      SUPABASE_URL,
    )).toBe(true);
    expect(shouldProxySupabaseRequest(
      `${SUPABASE_URL}/rest/v1/lib_eksemplar?select=*,sirkulasi:lib_sirkulasi(status)`,
      { method: 'GET' },
      SUPABASE_URL,
    )).toBe(true);
  });

  test('mengalihkan tabel sensitif dengan token Firebase dan mempertahankan respons mentah', async () => {
    const calls = [];
    const nativeFetch = jest.fn(async (input, init) => {
      calls.push({ input, init });
      return new Response('[{"id":"001_2026_7"}]', {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/1' },
      });
    });
    const secureFetch = createSecureSupabaseFetch({
      auth: { currentUser: { getIdToken: jest.fn(async () => 'firebase-token') } },
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: ANON_KEY,
      nativeFetch,
    });

    const response = await secureFetch(`${SUPABASE_URL}/rest/v1/finance_transactions?select=*`, {
      method: 'GET',
      headers: { Range: '0-99' },
    });
    expect(await response.json()).toEqual([{ id: '001_2026_7' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe(`${SUPABASE_URL}/functions/v1/secure-proxy`);
    const proxyPayload = JSON.parse(calls[0].init.body);
    expect(proxyPayload).toEqual(expect.objectContaining({
      action: 'supabase-rest-proxy',
      payload: expect.objectContaining({
        path: '/rest/v1/finance_transactions?select=*',
        method: 'GET',
        headers: expect.objectContaining({ range: '0-99' }),
      }),
    }));
    expect(calls[0].init.headers['x-firebase-token']).toBe('firebase-token');
  });

  test('mengembalikan 401 lokal ketika sesi sensitif belum tersedia', async () => {
    const nativeFetch = jest.fn();
    const secureFetch = createSecureSupabaseFetch({
      auth: { currentUser: null },
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: ANON_KEY,
      nativeFetch,
    });
    const response = await secureFetch(`${SUPABASE_URL}/rest/v1/siswa_presensi?select=*`);
    expect(response.status).toBe(401);
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  test('meneruskan operasi tulis dan header Prefer tanpa membawa anon authorization ke PostgREST', async () => {
    const nativeFetch = jest.fn(async () => new Response(null, { status: 204 }));
    const secureFetch = createSecureSupabaseFetch({
      auth: { currentUser: { getIdToken: async () => 'firebase-token' } },
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: ANON_KEY,
      nativeFetch,
    });
    await secureFetch(`${SUPABASE_URL}/rest/v1/lib_buku?id=eq.7`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation', Authorization: 'Bearer should-not-forward' },
      body: JSON.stringify({ judul: 'Aman' }),
    });
    const proxyPayload = JSON.parse(nativeFetch.mock.calls[0][1].body);
    expect(proxyPayload.payload.headers.prefer).toBe('return=representation');
    expect(proxyPayload.payload.headers.authorization).toBeUndefined();
    expect(proxyPayload.payload.body).toBe('{"judul":"Aman"}');
  });

  test('mencatat diagnosa console.warn secara transparan saat proxy mengembalikan respons non-ok', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const nativeFetch = jest.fn(async () => new Response('{"code":"42703","message":"column error"}', {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }));
    const secureFetch = createSecureSupabaseFetch({
      auth: { currentUser: { getIdToken: async () => 'firebase-token' } },
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: ANON_KEY,
      nativeFetch,
    });

    const res = await secureFetch(`${SUPABASE_URL}/rest/v1/lib_buku?select=unknown_col`);
    expect(res.status).toBe(400);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SecureSupabaseFetch] HTTP 400 pada GET /rest/v1/lib_buku?select=unknown_col:'),
      '{"code":"42703","message":"column error"}'
    );
    warnSpy.mockRestore();
  });

  test('otomatis mencoba ulang (retry) saat nativeFetch gagal karena gangguan jaringan/QUIC dan pulih di percobaan berikutnya', async () => {
    let callCount = 0;
    const nativeFetch = jest.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new TypeError('Failed to fetch (net::ERR_QUIC_PROTOCOL_ERROR)');
      }
      return new Response('[{"id":"cashflow_1","amount":150000}]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const secureFetch = createSecureSupabaseFetch({
      auth: { currentUser: { getIdToken: async () => 'firebase-token' } },
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: ANON_KEY,
      nativeFetch,
    });

    const res = await secureFetch(`${SUPABASE_URL}/rest/v1/finance_cashflow?select=*`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 'cashflow_1', amount: 150000 }]);
    expect(callCount).toBe(2);
  });
});

