/**
 * ====================================================================
 * SIMAS SMAGESA - DATA & HELPER HARI LIBUR & HARI BESAR NASIONAL (SSOT)
 * File: js/data-holidays.js
 * Deskripsi: Modul kurasi data hari libur nasional (SKB 3 Menteri),
 *            hari besar nasional tetap tahunan, serta generator
 *            kegiatan periodik fleksibel (termasuk siklus 210 hari Pawukon Bali).
 * Arsitektur: Offline-first, Multi-Tier Caching (0 kuota Firestore / Supabase).
 * ====================================================================
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DataHolidays = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // 1. Katalog Hari Besar Nasional Tetap Tahunan (Fixed Annual Observances)
    // Hari besar yang selalu jatuh pada tanggal dan bulan Masehi yang sama setiap tahun
    const FIXED_ANNUAL_OBSERVANCES = [
        { month: 1, day: 1, title: 'Tahun Baru Masehi', category: 'libur', color: 'rose', isHoliday: true, desc: 'Libur Nasional Tahun Baru Masehi' },
        { month: 1, day: 25, title: 'Hari Gizi Nasional', category: 'kegiatan', color: 'blue', isHoliday: false, desc: 'Peringatan Hari Gizi Nasional' },
        { month: 2, day: 9, title: 'Hari Pers Nasional', category: 'kegiatan', color: 'blue', isHoliday: false, desc: 'Peringatan Hari Pers Nasional' },
        { month: 3, day: 8, title: 'Hari Perempuan Internasional', category: 'kegiatan', color: 'blue', isHoliday: false, desc: 'Peringatan Hari Perempuan Sedunia' },
        { month: 3, day: 30, title: 'Hari Film Nasional', category: 'kegiatan', color: 'blue', isHoliday: false, desc: 'Apresiasi Perfilman Nasional' },
        { month: 4, day: 21, title: 'Hari Kartini', category: 'penting', color: 'amber', isHoliday: false, desc: 'Peringatan Hari Emansipasi Wanita Indonesia' },
        { month: 5, day: 1, title: 'Hari Buruh Internasional', category: 'libur', color: 'rose', isHoliday: true, desc: 'Libur Nasional Hari Buruh (May Day)' },
        { month: 5, day: 2, title: 'Hari Pendidikan Nasional (Hardiknas)', category: 'penting', color: 'amber', isHoliday: false, desc: 'Peringatan Hari Pendidikan Nasional' },
        { month: 5, day: 20, title: 'Hari Kebangkitan Nasional (Harkitnas)', category: 'penting', color: 'amber', isHoliday: false, desc: 'Peringatan Hari Kebangkitan Nasional' },
        { month: 6, day: 1, title: 'Hari Lahir Pancasila', category: 'libur', color: 'rose', isHoliday: true, desc: 'Libur Nasional Peringatan Lahirnya Pancasila' },
        { month: 7, day: 23, title: 'Hari Anak Nasional', category: 'kegiatan', color: 'blue', isHoliday: false, desc: 'Peringatan Hari Anak Nasional' },
        { month: 8, day: 17, title: 'Hari Kemerdekaan Republik Indonesia (HUT RI)', category: 'libur', color: 'rose', isHoliday: true, desc: 'Libur Nasional Proklamasi Kemerdekaan RI' },
        { month: 9, day: 8, title: 'Hari Aksara Internasional', category: 'kegiatan', color: 'blue', isHoliday: false, desc: 'Peringatan Literasi & Aksara' },
        { month: 10, day: 1, title: 'Hari Kesaktian Pancasila', category: 'penting', color: 'amber', isHoliday: false, desc: 'Upacara Peringatan Hari Kesaktian Pancasila' },
        { month: 10, day: 2, title: 'Hari Batik Nasional', category: 'kegiatan', color: 'blue', isHoliday: false, desc: 'Peringatan Warisan Budaya Batik Indonesia' },
        { month: 10, day: 5, title: 'Hari Tentara Nasional Indonesia (TNI)', category: 'kegiatan', color: 'blue', isHoliday: false, desc: 'HUT Tentara Nasional Indonesia' },
        { month: 10, day: 28, title: 'Hari Sumpah Pemuda', category: 'penting', color: 'amber', isHoliday: false, desc: 'Peringatan Hari Sumpah Pemuda' },
        { month: 11, day: 10, title: 'Hari Pahlawan', category: 'penting', color: 'amber', isHoliday: false, desc: 'Upacara Peringatan Hari Pahlawan' },
        { month: 11, day: 12, title: 'Hari Kesehatan Nasional / Hari Ayah', category: 'kegiatan', color: 'blue', isHoliday: false, desc: 'Peringatan Kesehatan & Hari Ayah' },
        { month: 11, day: 25, title: 'Hari Guru Nasional (HUT PGRI)', category: 'penting', color: 'amber', isHoliday: false, desc: 'Peringatan Hari Guru Nasional & Apresiasi Guru' },
        { month: 12, day: 22, title: 'Hari Ibu', category: 'kegiatan', color: 'blue', isHoliday: false, desc: 'Peringatan Hari Ibu Nasional' },
        { month: 12, day: 25, title: 'Hari Raya Natal', category: 'libur', color: 'rose', isHoliday: true, desc: 'Libur Nasional Hari Raya Natal' }
    ];

    // 2. Master Data Resmi Libur Nasional & Cuti Bersama SKB 3 Menteri (2024 - 2027)
    // Fallback instan jika offline / tanpa koneksi API
    const BUILTIN_HOLIDAYS_BY_YEAR = {
        '2024': [
            { date: '2024-01-01', title: 'Tahun Baru 2024 Masehi' },
            { date: '2024-02-08', title: 'Isra Mi’raj Nabi Muhammad SAW' },
            { date: '2024-02-09', title: 'Cuti Bersama Tahun Baru Imlek 2575 Kongzili', isCutiBersama: true },
            { date: '2024-02-10', title: 'Tahun Baru Imlek 2575 Kongzili' },
            { date: '2024-03-11', title: 'Hari Suci Nyepi Tahun Baru Saka 1946' },
            { date: '2024-03-12', title: 'Cuti Bersama Hari Suci Nyepi Tahun Baru Saka 1946', isCutiBersama: true },
            { date: '2024-03-29', title: 'Wafat Yesus Kristus / Jumat Agung' },
            { date: '2024-03-31', title: 'Kebangkitan Yesus Kristus (Paskah)' },
            { date: '2024-04-08', title: 'Cuti Bersama Hari Raya Idul Fitri 1445 H', isCutiBersama: true },
            { date: '2024-04-09', title: 'Cuti Bersama Hari Raya Idul Fitri 1445 H', isCutiBersama: true },
            { date: '2024-04-10', title: 'Hari Raya Idul Fitri 1445 H' },
            { date: '2024-04-11', title: 'Hari Raya Idul Fitri 1445 H' },
            { date: '2024-04-12', title: 'Cuti Bersama Hari Raya Idul Fitri 1445 H', isCutiBersama: true },
            { date: '2024-04-15', title: 'Cuti Bersama Hari Raya Idul Fitri 1445 H', isCutiBersama: true },
            { date: '2024-05-01', title: 'Hari Buruh Internasional' },
            { date: '2024-05-09', title: 'Kenaikan Yesus Kristus' },
            { date: '2024-05-10', title: 'Cuti Bersama Kenaikan Yesus Kristus', isCutiBersama: true },
            { date: '2024-05-23', title: 'Hari Raya Waisak 2568 BE' },
            { date: '2024-05-24', title: 'Cuti Bersama Hari Raya Waisak 2568 BE', isCutiBersama: true },
            { date: '2024-06-01', title: 'Hari Lahir Pancasila' },
            { date: '2024-06-14', title: 'Cuti Bersama Hari Raya Idul Adha 1445 H', isCutiBersama: true },
            { date: '2024-06-17', title: 'Hari Raya Idul Adha 1445 H' },
            { date: '2024-07-07', title: 'Tahun Baru Islam 1446 H' },
            { date: '2024-08-17', title: 'Hari Kemerdekaan Republik Indonesia' },
            { date: '2024-09-16', title: 'Maulid Nabi Muhammad SAW' },
            { date: '2024-12-25', title: 'Hari Raya Natal' },
            { date: '2024-12-26', title: 'Cuti Bersama Hari Raya Natal', isCutiBersama: true }
        ],
        '2025': [
            { date: '2025-01-01', title: 'Tahun Baru 2025 Masehi' },
            { date: '2025-01-27', title: 'Isra Mi’raj Nabi Muhammad SAW' },
            { date: '2025-01-28', title: 'Cuti Bersama Tahun Baru Imlek 2576 Kongzili', isCutiBersama: true },
            { date: '2025-01-29', title: 'Tahun Baru Imlek 2576 Kongzili' },
            { date: '2025-03-28', title: 'Cuti Bersama Hari Suci Nyepi Tahun Baru Saka 1947', isCutiBersama: true },
            { date: '2025-03-29', title: 'Hari Suci Nyepi Tahun Baru Saka 1947' },
            { date: '2025-03-31', title: 'Hari Raya Idul Fitri 1446 H' },
            { date: '2025-04-01', title: 'Hari Raya Idul Fitri 1446 H' },
            { date: '2025-04-02', title: 'Cuti Bersama Hari Raya Idul Fitri 1446 H', isCutiBersama: true },
            { date: '2025-04-03', title: 'Cuti Bersama Hari Raya Idul Fitri 1446 H', isCutiBersama: true },
            { date: '2025-04-04', title: 'Cuti Bersama Hari Raya Idul Fitri 1446 H', isCutiBersama: true },
            { date: '2025-04-07', title: 'Cuti Bersama Hari Raya Idul Fitri 1446 H', isCutiBersama: true },
            { date: '2025-04-18', title: 'Wafat Yesus Kristus / Jumat Agung' },
            { date: '2025-04-20', title: 'Kebangkitan Yesus Kristus (Paskah)' },
            { date: '2025-05-01', title: 'Hari Buruh Internasional' },
            { date: '2025-05-12', title: 'Hari Raya Waisak 2569 BE' },
            { date: '2025-05-13', title: 'Cuti Bersama Hari Raya Waisak 2569 BE', isCutiBersama: true },
            { date: '2025-05-29', title: 'Kenaikan Yesus Kristus' },
            { date: '2025-05-30', title: 'Cuti Bersama Kenaikan Yesus Kristus', isCutiBersama: true },
            { date: '2025-06-01', title: 'Hari Lahir Pancasila' },
            { date: '2025-06-06', title: 'Hari Raya Idul Adha 1446 H' },
            { date: '2025-06-09', title: 'Cuti Bersama Hari Raya Idul Adha 1446 H', isCutiBersama: true },
            { date: '2025-06-27', title: 'Tahun Baru Islam 1447 H' },
            { date: '2025-08-17', title: 'Hari Kemerdekaan Republik Indonesia' },
            { date: '2025-08-18', title: 'Cuti Bersama Hari Kemerdekaan RI', isCutiBersama: true },
            { date: '2025-09-05', title: 'Maulid Nabi Muhammad SAW' },
            { date: '2025-12-25', title: 'Hari Raya Natal' },
            { date: '2025-12-26', title: 'Cuti Bersama Hari Raya Natal', isCutiBersama: true }
        ],
        '2026': [
            { date: '2026-01-01', title: 'Tahun Baru 2026 Masehi' },
            { date: '2026-01-16', title: 'Isra Mi’raj Nabi Muhammad SAW' },
            { date: '2026-02-17', title: 'Tahun Baru Imlek 2577 Kongzili' },
            { date: '2026-03-18', title: 'Cuti Bersama Hari Suci Nyepi Tahun Baru Saka 1948', isCutiBersama: true },
            { date: '2026-03-19', title: 'Hari Suci Nyepi Tahun Baru Saka 1948' },
            { date: '2026-03-20', title: 'Cuti Bersama Hari Raya Idul Fitri 1447 H', isCutiBersama: true },
            { date: '2026-03-21', title: 'Hari Raya Idul Fitri 1447 H' },
            { date: '2026-03-22', title: 'Hari Raya Idul Fitri 1447 H' },
            { date: '2026-03-23', title: 'Cuti Bersama Hari Raya Idul Fitri 1447 H', isCutiBersama: true },
            { date: '2026-03-24', title: 'Cuti Bersama Hari Raya Idul Fitri 1447 H', isCutiBersama: true },
            { date: '2026-04-03', title: 'Wafat Yesus Kristus / Jumat Agung' },
            { date: '2026-04-05', title: 'Kebangkitan Yesus Kristus (Paskah)' },
            { date: '2026-05-01', title: 'Hari Buruh Internasional' },
            { date: '2026-05-14', title: 'Kenaikan Yesus Kristus' },
            { date: '2026-05-15', title: 'Cuti Bersama Kenaikan Yesus Kristus', isCutiBersama: true },
            { date: '2026-05-27', title: 'Hari Raya Idul Adha 1447 H' },
            { date: '2026-05-28', title: 'Cuti Bersama Hari Raya Idul Adha 1447 H', isCutiBersama: true },
            { date: '2026-05-31', title: 'Hari Raya Waisak 2570 BE' },
            { date: '2026-06-01', title: 'Hari Lahir Pancasila' },
            { date: '2026-06-16', title: 'Tahun Baru Islam 1448 H' },
            { date: '2026-08-17', title: 'Hari Kemerdekaan Republik Indonesia' },
            { date: '2026-08-25', title: 'Maulid Nabi Muhammad SAW' },
            { date: '2026-12-24', title: 'Cuti Bersama Hari Raya Natal', isCutiBersama: true },
            { date: '2026-12-25', title: 'Hari Raya Natal' }
        ],
        '2027': [
            { date: '2027-01-01', title: 'Tahun Baru 2027 Masehi' },
            { date: '2027-01-05', title: 'Isra Mi’raj Nabi Muhammad SAW' },
            { date: '2027-02-06', title: 'Tahun Baru Imlek 2578 Kongzili' },
            { date: '2027-03-09', title: 'Hari Suci Nyepi Tahun Baru Saka 1949' },
            { date: '2027-03-10', title: 'Hari Raya Idul Fitri 1448 H' },
            { date: '2027-03-26', title: 'Wafat Yesus Kristus / Jumat Agung' },
            { date: '2027-05-01', title: 'Hari Buruh Internasional' },
            { date: '2027-05-06', title: 'Kenaikan Yesus Kristus' },
            { date: '2027-05-17', title: 'Hari Raya Idul Adha 1448 H' },
            { date: '2027-05-20', title: 'Hari Raya Waisak 2571 BE' },
            { date: '2027-06-01', title: 'Hari Lahir Pancasila' },
            { date: '2027-06-06', title: 'Tahun Baru Islam 1449 H' },
            { date: '2027-08-15', title: 'Maulid Nabi Muhammad SAW' },
            { date: '2027-08-17', title: 'Hari Kemerdekaan Republik Indonesia' },
            { date: '2027-12-25', title: 'Hari Raya Natal' },
            { date: '2027-12-26', title: 'Isra Mi’raj Nabi Muhammad SAW' }
        ]
    };

    const CACHE_PREFIX = 'simas_holidays_';
    const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Hari

    /**
     * Format tanggal YYYY-MM-DD
     */
    function formatDate(date) {
        if (!date) return '';
        const d = new Date(date);
        if (isNaN(d.getTime())) return '';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    /**
     * Normalisasi data hari libur dari berbagai format respons
     */
    function normalizeHolidayItem(raw, defaultYear) {
        if (!raw || !raw.date) return null;
        const dateStr = String(raw.date).trim().substring(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;

        const title = raw.title || raw.name || raw.description || 'Libur Nasional';
        const isCuti = Boolean(raw.isCutiBersama || /cuti bersama/i.test(title));

        return {
            id: `hol_${dateStr}_${Math.abs(hashString(title))}`,
            date: dateStr,
            endDate: dateStr,
            title: title,
            type: 'libur',
            category: 'libur',
            color: 'rose',
            description: raw.description || (isCuti ? 'Cuti Bersama Resmi Pemerintah RI' : 'Hari Libur Nasional Republik Indonesia'),
            isNationalHoliday: true,
            isCutiBersama: isCuti,
            isReadOnly: true
        };
    }

    function hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash;
    }

    /**
     * Memuat hari libur nasional untuk tahun tertentu.
     * Menggunakan strategi Multi-tier Caching:
     * 1. Cek LocalStorage cache valid
     * 2. Fallback ke BUILTIN dataset
     * 3. Background fetch ke API publik untuk pembaruan terkini
     */
    function getNationalHolidays(year) {
        const yStr = String(year);
        let holidays = [];

        // Tier 1: LocalStorage Cache
        if (typeof window !== 'undefined' && window.localStorage) {
            try {
                const cachedRaw = localStorage.getItem(CACHE_PREFIX + yStr);
                if (cachedRaw) {
                    const parsed = JSON.parse(cachedRaw);
                    if (parsed && Array.isArray(parsed.data) && parsed.timestamp && (Date.now() - parsed.timestamp < CACHE_TTL_MS)) {
                        holidays = parsed.data;
                    }
                }
            } catch (e) {
                console.warn('[DataHolidays] Gagal membaca cache localStorage:', e);
            }
        }

        // Tier 2: Built-in Dataset jika cache kosong
        if (holidays.length === 0) {
            const builtinList = BUILTIN_HOLIDAYS_BY_YEAR[yStr] || [];
            holidays = builtinList.map(item => normalizeHolidayItem(item, yStr)).filter(Boolean);

            // Jika tahun tidak ada di builtin, sertakan minimal hari besar nasional tetap untuk tahun tersebut
            if (holidays.length === 0) {
                const yNum = parseInt(yStr, 10);
                if (!isNaN(yNum)) {
                    FIXED_ANNUAL_OBSERVANCES.filter(obs => obs.isHoliday).forEach(obs => {
                        const dStr = `${yStr}-${String(obs.month).padStart(2, '0')}-${String(obs.day).padStart(2, '0')}`;
                        holidays.push({
                            id: `hol_${dStr}_${obs.day}`,
                            date: dStr,
                            endDate: dStr,
                            title: obs.title,
                            type: 'libur',
                            category: 'libur',
                            color: 'rose',
                            description: obs.desc,
                            isNationalHoliday: true,
                            isCutiBersama: false,
                            isReadOnly: true
                        });
                    });
                }
            }
        }

        // Tier 3: Trigger Background Sync via API (jika di browser & online)
        if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
            syncHolidaysFromAPI(yStr).catch(() => {});
        }

        return holidays;
    }

    const _syncInFlight = {};

    /**
     * Background async fetch ke API publik libur nasional
     */
    async function syncHolidaysFromAPI(yearStr) {
        if (typeof window === 'undefined' || !navigator.onLine) return;
        if (_syncInFlight[yearStr]) return; // Proteksi pemanggilan ganda serentak
        _syncInFlight[yearStr] = true;

        // Jika tahun ini sudah terdefinisi lengkap di BUILTIN_HOLIDAYS_BY_YEAR (2024-2027),
        // gunakan master resmi bawaan (SSOT) tanpa memicu fetch eksternal yang diblokir oleh CORS browser.
        if (BUILTIN_HOLIDAYS_BY_YEAR[yearStr] && BUILTIN_HOLIDAYS_BY_YEAR[yearStr].length > 0) {
            _syncInFlight[yearStr] = false;
            return;
        }

        const lastFetchKey = `${CACHE_PREFIX}${yearStr}_last_fetch`;
        try {
            // Cek apakah baru saja di-fetch dalam 24 jam terakhir agar hemat bandwidth
            const lastFetch = localStorage.getItem(lastFetchKey);
            if (lastFetch && (Date.now() - parseInt(lastFetch, 10) < 24 * 60 * 60 * 1000)) {
                return;
            }

            // Tandai timestamp fetch saat ini agar jika fetch gagal/offline/CSP, tidak di-loop berulang kali
            localStorage.setItem(lastFetchKey, String(Date.now()));

            const res = await fetch(`https://api-hari-libur.vercel.app/api?year=${yearStr}`, {
                method: 'GET',
                mode: 'cors',
                headers: { 'Accept': 'application/json' }
            }).catch(() => null);

            if (!res || !res.ok) return;
            const json = await res.json().catch(() => null);
            if (!json) return;
            const rawList = (json && Array.isArray(json.data)) ? json.data : (Array.isArray(json) ? json : []);
            if (rawList.length === 0) return;

            const normalized = rawList.map(item => normalizeHolidayItem(item, yearStr)).filter(Boolean);
            if (normalized.length > 0) {
                localStorage.setItem(CACHE_PREFIX + yearStr, JSON.stringify({
                    timestamp: Date.now(),
                    data: normalized
                }));
            }
        } catch (err) {
            // Silently ignore network failures - offline fallback sudah aktif
        } finally {
            _syncInFlight[yearStr] = false;
        }
    }

    /**
     * Memeriksa apakah suatu tanggal adalah hari libur nasional atau cuti bersama
     */
    function isNationalHoliday(dateStr) {
        if (!dateStr || dateStr.length < 10) return false;
        const yStr = dateStr.substring(0, 4);
        const list = getNationalHolidays(yStr);
        return list.some(h => h.date === dateStr);
    }

    /**
     * Mendapatkan objek informasi hari libur pada tanggal tertentu (jika ada)
     */
    function getHolidayForDate(dateStr) {
        if (!dateStr || dateStr.length < 10) return null;
        const yStr = dateStr.substring(0, 4);
        const list = getNationalHolidays(yStr);
        return list.find(h => h.date === dateStr) || null;
    }

    /**
     * Mendapatkan daftar hari besar nasional tetap tahunan (untuk dropdown form)
     */
    function getFixedAnnualObservances() {
        return FIXED_ANNUAL_OBSERVANCES;
    }

    // ====================================================================
    // 🔄 GENERATOR KEGIATAN PERIODIK & TAHUNAN (Pawukon 210 Hari & Flexible)
    // ====================================================================

    /**
     * Menghasilkan rentang tanggal berulang periodik berdasarkan interval hari.
     * Contoh: interval = 210 hari (Kalender Pawukon Hindu Bali / Galungan / Piodalan)
     * 
     * @param {string} baseDateStr - Tanggal awal patokan (YYYY-MM-DD)
     * @param {number} intervalDays - Interval perulangan dalam hari (misal 210)
     * @param {number} count - Berapa kali perulangan (default: 10)
     * @param {string} [endDateStr] - Batas tanggal akhir maksimal (opsional)
     * @returns {Array<{ index: number, date: string, dayName: string }>}
     */
    function generatePeriodicDates(baseDateStr, intervalDays, count = 10, endDateStr = null) {
        if (!baseDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(baseDateStr)) return [];
        const interval = parseInt(intervalDays, 10);
        if (isNaN(interval) || interval <= 0) return [];
        const totalCount = Math.min(Math.max(parseInt(count, 10) || 1, 1), 50);

        const results = [];
        const [by, bm, bd] = baseDateStr.split('-').map(Number);
        const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

        let current = new Date(Date.UTC(by, bm - 1, bd, 12, 0, 0));
        const maxEnd = endDateStr && /^\d{4}-\d{2}-\d{2}$/.test(endDateStr) ? new Date(endDateStr + 'T23:59:59Z') : null;

        for (let i = 0; i < totalCount; i++) {
            if (maxEnd && current > maxEnd) break;

            const y = current.getUTCFullYear();
            const m = String(current.getUTCMonth() + 1).padStart(2, '0');
            const d = String(current.getUTCDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${d}`;
            const dayOfWeek = current.getUTCDay();

            results.push({
                index: i + 1,
                date: dateStr,
                dayName: dayNames[dayOfWeek],
                offsetDays: i * interval
            });

            // Tambahkan interval hari secara tepat menggunakan UTC timestamp
            current = new Date(current.getTime() + (interval * 24 * 60 * 60 * 1000));
        }

        return results;
    }

    /**
     * Menghasilkan rentang tanggal berulang tahunan (pada tanggal dan bulan yang sama)
     * 
     * @param {string} baseDateStr - Tanggal awal patokan (YYYY-MM-DD)
     * @param {number} count - Berapa tahun ke depan (default: 5)
     * @returns {Array<{ index: number, date: string, dayName: string, year: number }>}
     */
    function generateYearlyDates(baseDateStr, count = 5) {
        if (!baseDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(baseDateStr)) return [];
        const totalYears = Math.min(Math.max(parseInt(count, 10) || 1, 1), 30);
        const [by, bm, bd] = baseDateStr.split('-').map(Number);
        const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

        const results = [];
        for (let i = 0; i < totalYears; i++) {
            const targetYear = by + i;
            let targetDay = bd;
            // Tangani tahun kabisat untuk 29 Februari
            if (bm === 2 && bd === 29) {
                const isLeap = (targetYear % 4 === 0 && targetYear % 100 !== 0) || (targetYear % 400 === 0);
                if (!isLeap) targetDay = 28;
            }

            const dt = new Date(Date.UTC(targetYear, bm - 1, targetDay, 12, 0, 0));
            const y = dt.getUTCFullYear();
            const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
            const d = String(dt.getUTCDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${d}`;
            const dayOfWeek = dt.getUTCDay();

            results.push({
                index: i + 1,
                date: dateStr,
                year: targetYear,
                dayName: dayNames[dayOfWeek]
            });
        }
        return results;
    }

    /**
     * Menghitung tanggal selesai (`endDate`) proporsional untuk perulangan
     */
    function calculateRecurrenceEndDate(startDateStr, originalEndDateStr, targetStartDateStr) {
        if (!originalEndDateStr || !startDateStr || !targetStartDateStr) return null;
        const [sy, sm, sd] = startDateStr.split('-').map(Number);
        const [ey, em, ed] = originalEndDateStr.split('-').map(Number);
        const [ty, tm, td] = targetStartDateStr.split('-').map(Number);

        const sDate = new Date(Date.UTC(sy, sm - 1, sd));
        const eDate = new Date(Date.UTC(ey, em - 1, ed));
        const durationMs = eDate.getTime() - sDate.getTime();
        if (durationMs <= 0) return targetStartDateStr;

        const tDate = new Date(Date.UTC(ty, tm - 1, td));
        const newEndDate = new Date(tDate.getTime() + durationMs);

        const y = newEndDate.getUTCFullYear();
        const m = String(newEndDate.getUTCMonth() + 1).padStart(2, '0');
        const d = String(newEndDate.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    return {
        getNationalHolidays,
        isNationalHoliday,
        getHolidayForDate,
        getFixedAnnualObservances,
        generatePeriodicDates,
        generateYearlyDates,
        calculateRecurrenceEndDate,
        BUILTIN_HOLIDAYS_BY_YEAR,
        FIXED_ANNUAL_OBSERVANCES
    };
}));
