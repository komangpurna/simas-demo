/**
 * SIMAS - SSOT Master Hari Libur Sekolah Terpadu (js/holiday-manager.js)
 * Mengelola sinkronisasi hari libur sekolah (public.lib_hari_libur Supabase),
 * sinkronisasi dua arah dengan Agenda Sekolah (calendar_events Cloudflare D1),
 * serta deteksi hari libur nasional resmi (DataHolidays).
 */

import { supabase } from './config.js';
import { cfClient } from './cloudflare-client.js';

// Memory cache untuk hari libur terdaftar: Map<tanggal, { tanggal, nama }>
const holidayCache = new Map();

/**
 * Helper untuk mendapatkan instance Supabase yang aktif
 */
function getSupabase() {
    if (typeof supabase !== 'undefined' && supabase && typeof supabase.from === 'function') {
        return supabase;
    }
    if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.from === 'function') {
        return window.supabase;
    }
    if (typeof globalThis !== 'undefined' && globalThis.supabase && typeof globalThis.supabase.from === 'function') {
        return globalThis.supabase;
    }
    return null;
}

/**
 * Helper untuk mendapatkan instance Cloudflare Client
 */
function getCfClient() {
    if (typeof cfClient !== 'undefined' && cfClient) {
        return cfClient;
    }
    if (typeof window !== 'undefined' && window.cfClient) {
        return window.cfClient;
    }
    if (typeof globalThis !== 'undefined' && globalThis.cfClient) {
        return globalThis.cfClient;
    }
    return null;
}

/**
 * Helper untuk mendapatkan instance DataHolidays
 */
function getDataHolidays() {
    if (typeof window !== 'undefined' && window.DataHolidays) {
        return window.DataHolidays;
    }
    if (typeof globalThis !== 'undefined' && globalThis.DataHolidays) {
        return globalThis.DataHolidays;
    }
    return null;
}

/**
 * Mengambil daftar hari libur dari memori cache
 */
export function getCachedHolidays(startDate = null, endDate = null) {
    let start = startDate;
    let end = endDate;
    if (start && typeof start === 'string') {
        const m = start.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) start = m[1];
    }
    if (end && typeof end === 'string') {
        const m = end.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) end = m[1];
    }
    if (start && end && start > end) {
        [start, end] = [end, start];
    }

    const results = [];
    holidayCache.forEach((val, key) => {
        if (start && key < start) return;
        if (end && key > end) return;
        results.push(val);
    });
    return results.sort((a, b) => a.tanggal.localeCompare(b.tanggal));
}

/**
 * Memeriksa apakah tanggal terdaftar di cache hari libur sekolah
 */
export function isRegisteredHoliday(dateStr) {
    if (!dateStr) return false;
    let clean = dateStr;
    if (typeof dateStr === 'string') {
        const m = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) clean = m[1];
    }
    return holidayCache.has(clean);
}

/**
 * Mendapatkan detail hari libur terdaftar berdasarkan tanggal
 */
export function getRegisteredHoliday(dateStr) {
    if (!dateStr) return null;
    let clean = dateStr;
    if (typeof dateStr === 'string') {
        const m = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) clean = m[1];
    }
    return holidayCache.get(clean) || null;
}

/**
 * Memeriksa apakah suatu tanggal merupakan hari libur (Nasional, Cuti Bersama, atau Libur Sekolah)
 * SSOT terpadu yang digunakan sama persis antara Monitoring KBM dan E-Kinerja Guru.
 *
 * @param {string} dateStr - Format YYYY-MM-DD
 * @returns {boolean}
 */
export function isHolidayDate(dateStr) {
    if (!dateStr || dateStr.length < 10) return false;
    let cleanDate = dateStr;
    const m = String(dateStr).match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) cleanDate = m[1];

    const dh = getDataHolidays();
    if (dh && typeof dh.isNationalHoliday === 'function' && dh.isNationalHoliday(cleanDate)) {
        return true;
    }
    if (dh && typeof dh.getHolidayForDate === 'function') {
        const hol = dh.getHolidayForDate(cleanDate);
        if (hol && (hol.isHoliday || hol.category === 'libur' || hol.isNationalHoliday)) {
            return true;
        }
    }
    if (isRegisteredHoliday(cleanDate)) {
        return true;
    }
    return false;
}

/**
 * Mendapatkan detail metadata hari libur (Nasional maupun Sekolah)
 *
 * @param {string} dateStr - Format YYYY-MM-DD
 * @returns {object|null}
 */
export function getHolidayDateInfo(dateStr) {
    if (!dateStr || dateStr.length < 10) return null;
    let cleanDate = dateStr;
    const m = String(dateStr).match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) cleanDate = m[1];

    const dh = getDataHolidays();
    if (dh && typeof dh.getHolidayForDate === 'function') {
        const info = dh.getHolidayForDate(cleanDate);
        if (info && (info.isHoliday || info.category === 'libur' || info.isNationalHoliday)) {
            return {
                title: info.title || info.name || 'Hari Libur Nasional',
                name: info.name || info.title || 'Hari Libur Nasional',
                date: cleanDate,
                isCutiBersama: Boolean(info.isCutiBersama),
                isNationalHoliday: true,
                isSchoolHoliday: false
            };
        }
    }

    const reg = getRegisteredHoliday(cleanDate);
    if (reg) {
        return {
            title: reg.nama || 'Hari Libur Sekolah',
            name: reg.nama || 'Hari Libur Sekolah',
            date: reg.tanggal || cleanDate,
            isCutiBersama: false,
            isNationalHoliday: false,
            isSchoolHoliday: true
        };
    }

    return null;
}

/**
 * Membersihkan memori cache hari libur
 */
export function clearHolidayCache() {
    holidayCache.clear();
}

/**
 * Mengambil hari libur sekolah terdaftar dari public.lib_hari_libur Supabase
 * dengan memanfaatkan memory cache cerdas.
 *
 * @param {string|null} startDate - Format YYYY-MM-DD (opsional)
 * @param {string|null} endDate - Format YYYY-MM-DD (opsional)
 * @returns {Promise<Array<{ tanggal: string, nama: string }>>}
 */
export async function fetchRegisteredHolidays(startDate = null, endDate = null) {
    let start = startDate;
    let end = endDate;
    if (start && typeof start === 'string') {
        const m = start.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) start = m[1];
    }
    if (end && typeof end === 'string') {
        const m = end.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) end = m[1];
    }
    if (start && end && start > end) {
        [start, end] = [end, start];
    }

    const sb = getSupabase();
    if (!sb) {
        console.warn('[HolidayManager] Supabase client tidak tersedia, menggunakan memory cache.');
        return getCachedHolidays(start, end);
    }

    try {
        let query = sb.from('lib_hari_libur').select('tanggal, nama');
        if (start) query = query.gte('tanggal', start);
        if (end) query = query.lte('tanggal', end);

        const { data, error } = await query;
        if (error) {
            console.warn('[HolidayManager] Gagal mengambil data dari lib_hari_libur:', error);
            return getCachedHolidays(start, end);
        }

        if (Array.isArray(data)) {
            data.forEach((item) => {
                if (item && item.tanggal) {
                    holidayCache.set(item.tanggal, {
                        tanggal: item.tanggal,
                        nama: item.nama || 'Hari Libur Sekolah'
                    });
                }
            });
            return data;
        }

        return getCachedHolidays(start, end);
    } catch (err) {
        console.warn('[HolidayManager] Exception saat fetchRegisteredHolidays:', err);
        return getCachedHolidays(start, end);
    }
}

/**
 * Menambahkan atau memperbarui hari libur sekolah ke public.lib_hari_libur Supabase
 *
 * @param {string} tanggal - Format YYYY-MM-DD
 * @param {string} nama - Nama hari libur / dispensasi
 * @returns {Promise<{ success: boolean, data?: any, error?: any }>}
 */
export async function upsertSchoolHoliday(tanggal, nama) {
    let cleanDate = tanggal;
    if (typeof tanggal === 'string') {
        const m = tanggal.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) cleanDate = m[1];
    }
    if (!cleanDate || !/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
        return { success: false, error: 'Format tanggal harus YYYY-MM-DD' };
    }

    const holidayName = nama || 'Hari Libur Sekolah';
    // Simpan langsung ke memory cache lokal
    holidayCache.set(cleanDate, { tanggal: cleanDate, nama: holidayName });

    const sb = getSupabase();
    if (!sb) {
        return { success: true, data: { tanggal: cleanDate, nama: holidayName }, cachedOnly: true };
    }

    try {
        const { data, error } = await sb
            .from('lib_hari_libur')
            .upsert({ tanggal: cleanDate, nama: holidayName }, { onConflict: 'tanggal' })
            .select();

        if (error) {
            console.warn('[HolidayManager] Gagal upsertSchoolHoliday:', error);
            return { success: false, error: error.message || error };
        }

        return { success: true, data };
    } catch (err) {
        console.warn('[HolidayManager] Exception pada upsertSchoolHoliday:', err);
        return { success: false, error: err.message || err };
    }
}

/**
 * Menghapus hari libur sekolah dari public.lib_hari_libur Supabase
 *
 * @param {string} tanggal - Format YYYY-MM-DD
 * @returns {Promise<{ success: boolean, data?: any, error?: any }>}
 */
export async function deleteSchoolHoliday(tanggal) {
    if (!tanggal) return { success: false, error: 'Tanggal diperlukan' };
    let cleanDate = tanggal;
    if (typeof tanggal === 'string') {
        const m = tanggal.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) cleanDate = m[1];
    }

    holidayCache.delete(cleanDate);

    const sb = getSupabase();
    if (!sb) {
        return { success: true, cachedOnly: true };
    }

    try {
        const { data, error } = await sb
            .from('lib_hari_libur')
            .delete()
            .eq('tanggal', cleanDate);

        if (error) {
            console.warn('[HolidayManager] Gagal deleteSchoolHoliday:', error);
            return { success: false, error: error.message || error };
        }

        return { success: true, data };
    } catch (err) {
        console.warn('[HolidayManager] Exception pada deleteSchoolHoliday:', err);
        return { success: false, error: err.message || err };
    }
}

/**
 * Sinkronisasi awal (Bootstrap Sync) event agenda kategori libur dari D1
 * dan hari libur nasional dari DataHolidays ke public.lib_hari_libur Supabase.
 *
 * @returns {Promise<{ success: boolean, count: number }>}
 */
export async function bootstrapSyncAgendaHolidays() {
    const toUpsertMap = new Map();

    // 1. Ambil event libur dari D1 calendar_events
    const client = getCfClient();
    if (client && typeof client.getCalendarEvents === 'function') {
        const currentYear = new Date().getFullYear();
        const years = [currentYear - 1, currentYear, currentYear + 1];
        for (const y of years) {
            try {
                const res = await client.getCalendarEvents(y);
                const events = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
                events.forEach((ev) => {
                    const cat = (ev.category || ev.type || '').toLowerCase();
                    if (cat === 'libur') {
                        const startMatch = String(ev.date || '').match(/^(\d{4}-\d{2}-\d{2})/);
                        const start = startMatch ? startMatch[1] : null;
                        const rawEnd = ev.endDate || ev.time;
                        const endMatch = rawEnd ? String(rawEnd).match(/^(\d{4}-\d{2}-\d{2})/) : null;
                        const end = endMatch ? endMatch[1] : null;
                        if (start) {
                            if (end && end > start) {
                                let cur = new Date(start + 'T00:00:00Z');
                                const last = new Date(end + 'T00:00:00Z');
                                const maxSpanDays = 366;
                                let daysCount = 0;
                                while (cur <= last && daysCount < maxSpanDays) {
                                    const dStr = cur.toISOString().split('T')[0];
                                    toUpsertMap.set(dStr, {
                                        tanggal: dStr,
                                        nama: ev.title || 'Libur Sekolah'
                                    });
                                    cur.setUTCDate(cur.getUTCDate() + 1);
                                    daysCount++;
                                }
                            } else {
                                toUpsertMap.set(start, {
                                    tanggal: start,
                                    nama: ev.title || 'Libur Sekolah'
                                });
                            }
                        }
                    }
                });
            } catch (e) {
                console.warn(`[HolidayManager] Gagal mengambil calendar_events dari D1 tahun ${y}:`, e);
            }
        }
    }

    // 2. Ambil master data libur nasional dari DataHolidays
    const dh = getDataHolidays();
    if (dh && typeof dh.getNationalHolidays === 'function') {
        try {
            const currentYear = new Date().getFullYear();
            const years = [currentYear - 1, currentYear, currentYear + 1];
            years.forEach((y) => {
                const list = dh.getNationalHolidays(y);
                if (Array.isArray(list)) {
                    list.forEach((h) => {
                        const dMatch = String(h.date || '').match(/^(\d{4}-\d{2}-\d{2})/);
                        const d = dMatch ? dMatch[1] : null;
                        const title = h.title || h.name || 'Hari Libur Nasional';
                        if (d && !toUpsertMap.has(d)) {
                            toUpsertMap.set(d, { tanggal: d, nama: title });
                        }
                    });
                }
            });
        } catch (e) {
            console.warn('[HolidayManager] Gagal membaca DataHolidays:', e);
        }
    }

    // Perbarui memory cache
    toUpsertMap.forEach((val, key) => {
        holidayCache.set(key, val);
    });

    const items = Array.from(toUpsertMap.values());
    if (items.length === 0) {
        return { success: true, count: 0 };
    }

    // 3. Batch upsert ke Supabase lib_hari_libur
    const sb = getSupabase();
    let syncError = null;
    if (sb) {
        try {
            const CHUNK_SIZE = 50;
            for (let i = 0; i < items.length; i += CHUNK_SIZE) {
                const chunk = items.slice(i, i + CHUNK_SIZE);
                const { error } = await sb.from('lib_hari_libur').upsert(chunk, { onConflict: 'tanggal' });
                if (error) {
                    syncError = error;
                    console.warn('[HolidayManager] Gagal batch upsert ke lib_hari_libur:', error);
                }
            }
        } catch (e) {
            syncError = e;
            console.warn('[HolidayManager] Gagal batch upsert ke lib_hari_libur:', e);
        }
    }

    if (!syncError && typeof sessionStorage !== 'undefined') {
        try {
            sessionStorage.setItem('simas_holiday_sync_bootstrapped', 'true');
        } catch (e) {}
    }

    return {
        success: !syncError,
        count: items.length,
        error: syncError ? (syncError.message || syncError) : null
    };
}

// Bind ke window object untuk interoperabilitas browser dan inline script
if (typeof window !== 'undefined') {
    window.HolidayManager = {
        fetchRegisteredHolidays,
        upsertSchoolHoliday,
        deleteSchoolHoliday,
        bootstrapSyncAgendaHolidays,
        isRegisteredHoliday,
        getRegisteredHoliday,
        isHolidayDate,
        getHolidayDateInfo,
        clearHolidayCache,
        getCachedHolidays
    };
}

