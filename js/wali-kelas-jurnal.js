/* js/wali-kelas-jurnal.js - Modul Rekap Jurnal Mingguan Kelas Portal Wali Kelas SIMAS SMAGESA */
import { SCHOOL_CONFIG, supabase } from './config.js';
import { cfClient } from './cloudflare-client.js';
import { escapeHTML, formatDateIndo, formatDateIndoFormal, getLocalISODate } from './global.js';
import { getScheduleForClassAndDate } from './asc-schedule-parser.js';
import { fetchRegisteredHolidays, isHolidayDate, getHolidayDateInfo } from './holiday-manager.js';

// === STATE MODUL JURNAL MINGGUAN WALI KELAS ===
let currentWaliJurnalClass = '';
let currentWaliJurnalDate = null;
let currentWaliJurnalData = [];
let isWaliJurnalLoading = false;
let currentWaliJurnalVerification = null;
let isKepsekDrawing = false;
let kepsekCanvasInited = false;

/**
 * Memeriksa apakah pengguna saat ini berhak memverifikasi/mengesahkan jurnal (Kepala Sekolah atau Super Admin)
 */
export function canUserVerifyJurnal() {
    if (typeof window === 'undefined') return false;
    const role = window.currentUserRole;
    if (role === 'kepala_sekolah' || role === 'super_admin') return true;
    if (typeof window.hasRole === 'function') {
        return window.hasRole('kepala_sekolah') || window.hasRole('super_admin');
    }
    return false;
}

/**
 * Format Kunci SSOT Verifikasi Mingguan di Cloudflare D1 system_settings
 * (0 Firestore Read, efisiensi maksimal)
 */
export function getWeeklyVerificationKey(className, startDateIso) {
    const cleanClass = String(className || '').trim().replace(/[\s\/\\]+/g, '-');
    return `jurnal_verif_${cleanClass}_${startDateIso}`;
}

/**
 * Mengambil data verifikasi jurnal mingguan dari Cloudflare D1 system_settings
 */
export async function getWeeklyJurnalVerification(className, startDateIso) {
    if (!className || !startDateIso) return null;
    const key = getWeeklyVerificationKey(className, startDateIso);
    try {
        const raw = await cfClient.getSystemSetting(key);
        if (!raw) return null;
        if (typeof raw === 'string') {
            try { return JSON.parse(raw); } catch (e) { return null; }
        }
        return raw;
    } catch (err) {
        console.warn('[WaliKelasJurnal] Gagal mengambil verifikasi jurnal D1:', err);
        return null;
    }
}

/**
 * Menyimpan data verifikasi dan tanda tangan digital Kepala Sekolah ke Cloudflare D1 system_settings
 */
export async function saveWeeklyJurnalVerification(payload) {
    if (!payload || !payload.kelas || !payload.startDateIso) {
        throw new Error('Data verifikasi jurnal tidak lengkap.');
    }
    const key = getWeeklyVerificationKey(payload.kelas, payload.startDateIso);
    return await cfClient.saveSystemSetting(key, payload);
}

/**
 * Membatalkan / me-reset status verifikasi jurnal mingguan di Cloudflare D1
 */
export async function cancelWeeklyJurnalVerification(className, startDateIso) {
    if (!className || !startDateIso) return;
    const key = getWeeklyVerificationKey(className, startDateIso);
    return await cfClient.saveSystemSetting(key, {
        kelas: className,
        startDateIso,
        status: 'cancelled',
        cancelledAt: new Date().toISOString()
    });
}

/**
 * Inisialisasi kanvas tanda tangan digital Kepala Sekolah
 */
export function initKepsekCanvas() {
    const canvas = document.getElementById('kepsek-signature-pad');
    if (!canvas) return;
    const container = document.getElementById('kepsek-signature-container');
    if (!container) return;

    const rect = container.getBoundingClientRect();
    canvas.width = rect.width || 400;
    canvas.height = rect.height || 128;

    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#047857'; // Warna hijau tua zamrud dinas
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    function getPos(e) {
        const r = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: clientX - r.left, y: clientY - r.top };
    }

    if (!kepsekCanvasInited) {
        ['mousedown', 'touchstart'].forEach(ev => canvas.addEventListener(ev, (e) => {
            isKepsekDrawing = true;
            const pos = getPos(e);
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            e.preventDefault();
        }, { passive: false }));

        ['mousemove', 'touchmove'].forEach(ev => canvas.addEventListener(ev, (e) => {
            if (!isKepsekDrawing) return;
            const pos = getPos(e);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
            e.preventDefault();
        }, { passive: false }));

        ['mouseup', 'touchend', 'mouseleave'].forEach(ev => canvas.addEventListener(ev, () => {
            isKepsekDrawing = false;
        }));

        kepsekCanvasInited = true;
    }
}

/**
 * Reset / Bersihkan kanvas tanda tangan Kepala Sekolah
 */
export function clearKepsekCanvas() {
    const canvas = document.getElementById('kepsek-signature-pad');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * Cek apakah kanvas tanda tangan Kepala Sekolah masih kosong
 */
export function isKepsekCanvasBlank(canvas) {
    if (!canvas) return true;
    const blank = document.createElement('canvas');
    blank.width = canvas.width;
    blank.height = canvas.height;
    return canvas.toDataURL() === blank.toDataURL();
}

/**
 * Menghitung batas awal (Senin) dan akhir (Jumat) dari suatu tanggal acuan.
 * Hari belajar resmi sekolah dihitung dari Senin sampai Jumat (5 hari kerja).
 * 
 * @param {string|Date} refDateInput - Tanggal acuan (YYYY-MM-DD atau Date)
 * @returns {Object} Objek informasi rentang pekan
 */
export function calculateWeekRange(refDateInput) {
    let d;
    if (typeof refDateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(refDateInput)) {
        const [y, m, day] = refDateInput.split('-').map(Number);
        d = new Date(y, m - 1, day, 12, 0, 0);
    } else if (refDateInput instanceof Date && !isNaN(refDateInput.getTime())) {
        d = new Date(refDateInput.getFullYear(), refDateInput.getMonth(), refDateInput.getDate(), 12, 0, 0);
    } else {
        const now = new Date();
        d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
    }

    const dayOfWeek = d.getDay(); // 0: Minggu, 1: Senin, ..., 6: Sabtu
    // Jika Minggu (0), arahkan ke pekan yang baru lewat (Senin mundur 6 hari)
    // Jika Sabtu (6), tetap berada di pekan yang sama (Senin mundur 5 hari)
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    const monday = new Date(d);
    monday.setDate(d.getDate() + diffToMonday);

    // Hari belajar sekolah: Senin s.d. Jumat (5 hari)
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);

    const saturday = new Date(monday);
    saturday.setDate(monday.getDate() + 5);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const formatIso = (dateObj) => {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const startIso = formatIso(monday);
    const endIso = formatIso(friday); // Jumat sebagai akhir hari belajar resmi
    const fullWeekEndIso = formatIso(sunday);

    // Hitung estimasi nomor pekan dalam bulan
    const firstDayOfMonth = new Date(monday.getFullYear(), monday.getMonth(), 1, 12, 0, 0);
    const firstDayOfWeek = firstDayOfMonth.getDay() === 0 ? 7 : firstDayOfMonth.getDay();
    const weekOfMonth = Math.max(1, Math.ceil((monday.getDate() + firstDayOfWeek - 1) / 7));

    const monthNamesIndo = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];

    const monDate = monday.getDate();
    const monMonth = monthNamesIndo[monday.getMonth()];
    const monYear = monday.getFullYear();

    const friDate = friday.getDate();
    const friMonth = monthNamesIndo[friday.getMonth()];
    const friYear = friday.getFullYear();

    let rangeLabel = '';
    if (monday.getMonth() === friday.getMonth() && monYear === friYear) {
        rangeLabel = `${monDate} - ${friDate} ${friMonth} ${friYear}`;
    } else if (monYear === friYear) {
        rangeLabel = `${monDate} ${monMonth} - ${friDate} ${friMonth} ${friYear}`;
    } else {
        rangeLabel = `${monDate} ${monMonth} ${monYear} - ${friDate} ${friMonth} ${friYear}`;
    }

    const fullLabel = `Pekan ${weekOfMonth} (${rangeLabel})`;

    return {
        startDateIso: startIso,
        endDateIso: endIso,
        queryEndDateIso: fullWeekEndIso,
        mondayDate: monday,
        fridayDate: friday,
        saturdayDate: saturday,
        weekOfMonth,
        monthName: friMonth,
        year: friYear,
        rangeLabel,
        fullLabel
    };
}

/**
 * Parsing nomor-nomor JP ke dalam array of integer, misal [1, 2] atau "1-2" -> [1, 2]
 */
export function parseJpNumbers(jp) {
    if (!jp) return [];
    if (Array.isArray(jp)) {
        return jp.map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
    }
    const str = String(jp).trim();
    if (str.startsWith('[') && str.endsWith(']')) {
        try {
            const parsed = JSON.parse(str);
            if (Array.isArray(parsed)) {
                return parsed.map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
            }
        } catch (e) {}
    }
    const parts = str.split(/[,-]/).map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
    if (parts.length === 2 && parts[1] >= parts[0]) {
        const nums = [];
        for (let i = parts[0]; i <= parts[1]; i++) nums.push(i);
        return nums;
    }
    if (parts.length > 0) {
        return parts.sort((a, b) => a - b);
    }
    const m = str.match(/\d+/g);
    if (m) {
        return m.map(Number).sort((a, b) => a - b);
    }
    return [];
}

/**
 * Mengelompokkan slot JP harian jadwal aSc yang berurutan dengan mapel dan guru sama menjadi blok pelajaran
 */
export function groupScheduleSlots(daySchedule) {
    if (!Array.isArray(daySchedule) || daySchedule.length === 0) return [];

    const blocks = [];
    let currentBlock = null;

    for (let jp = 1; jp <= 10; jp++) {
        const slot = daySchedule.find(s => s && s.jp === jp);
        const mapel = (slot?.mapel || '').trim();
        const guruNama = (slot?.guruNama || slot?.xmlGuruName || '').trim();

        // Jika slot kosong / jam istirahat / tidak ada mapel dan guru
        if (!mapel || mapel === '-' || !guruNama || guruNama === '-') {
            if (currentBlock) {
                blocks.push(currentBlock);
                currentBlock = null;
            }
            continue;
        }

        const isSameBlock = currentBlock &&
            currentBlock.mapel.toLowerCase() === mapel.toLowerCase() &&
            currentBlock.guruNama.toLowerCase() === guruNama.toLowerCase();

        if (isSameBlock) {
            currentBlock.jpList.push(jp);
        } else {
            if (currentBlock) {
                blocks.push(currentBlock);
            }
            currentBlock = {
                jpList: [jp],
                mapel: mapel,
                guruNama: guruNama,
                guruId: slot.guruId || slot.xmlGuruId || '',
                guruNip: slot.guruNip || '',
                xmlGuruName: slot.xmlGuruName || '',
                xmlGuruId: slot.xmlGuruId || ''
            };
        }
    }

    if (currentBlock) {
        blocks.push(currentBlock);
    }

    return blocks;
}

/**
 * Normalisasi kode status presensi siswa menjadi label bahasa Indonesia formal
 */
export function normalizeGuruPresensiStatus(status) {
    if (!status) return '-';
    const s = String(status).trim().toUpperCase();
    if (s === 'H' || s === 'HADIR') return 'Hadir';
    if (s === 'S' || s === 'SAKIT') return 'Sakit';
    if (s === 'I' || s === 'IZIN') return 'Izin';
    if (s === 'K' || s === 'KEGIATAN' || s === 'TE' || s === 'TIDAK_EFEKTIF') return 'Kegiatan Sekolah';
    if (s === 'TK' || s === 'A' || s === 'ALPA' || s === 'ALPHA') return 'Tanpa Keterangan';
    if (s === 'D' || s === 'DISPEN' || s === 'DISPENSASI' || s === 'DINAS') return 'Tugas Dinas';
    if (s === 'TL' || s === 'TERLAMBAT') return 'Terlambat';
    return status;
}

// === KONFIGURASI JAM PELAJARAN (SSOT WAKTU JP SMAGESA) ===
export const JP_TIME_CONFIG = [
    { jp: 1, start: '07:30', end: '08:15' },
    { jp: 2, start: '08:15', end: '09:00' },
    { jp: 3, start: '09:00', end: '09:45' },
    { jp: 4, start: '10:00', end: '10:45' },
    { jp: 5, start: '10:45', end: '11:30' },
    { jp: 6, start: '11:30', end: '12:15' },
    { jp: 7, start: '12:45', end: '13:30' },
    { jp: 8, start: '13:30', end: '14:15' },
    { jp: 9, start: '14:15', end: '15:00' },
    { jp: 10, start: '15:00', end: '15:45' }
];

/**
 * Ekstraksi tingkat angkatan dari nama kelas (X, XI, XII, atau OTHER)
 * (SSOT paritas dengan js/page-monitoring-kbm.js)
 */
export function getAngkatanFromClass(className) {
    if (!className) return 'OTHER';
    const clean = String(className).trim().replace(/^KELAS\s+/i, '').toUpperCase();
    if (clean.startsWith('XII') || clean.startsWith('12')) return 'XII';
    if (clean.startsWith('XI') || clean.startsWith('11')) return 'XI';
    if (clean.startsWith('X') || clean.startsWith('10')) return 'X';
    const m = clean.match(/^(X|XI|XII|\d+)/i);
    return m ? m[1].toUpperCase() : 'OTHER';
}

/**
 * Memeriksa apakah suatu JP telah berlalu berdasarkan waktu saat ini
 * (SSOT paritas dengan js/page-monitoring-kbm.js)
 */
export function isJPElapsed(jpNum, dateStr) {
    if (!dateStr) return false;
    const now = new Date();
    const todayString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    if (dateStr < todayString) return true;
    if (dateStr > todayString) return false;

    const item = JP_TIME_CONFIG.find(x => x.jp === jpNum);
    if (!item) return false;
    const [eH, eM] = item.end.split(':').map(Number);
    const endMin = eH * 60 + eM;
    const currentMin = now.getHours() * 60 + now.getMinutes();
    return currentMin >= endMin;
}

/**
 * Membangun peta aktivitas KBM nyata sekolah & angkatan untuk pekan KBM berjalan
 * Mengidentifikasi:
 * 1. nonEffectiveDates: Hari di mana kelas aktif di sekolah <= 5 rombel pada hari kerja lampau
 * 2. tidakEfektifAngkatanMap: Matrix { date: { angkatan: { jp: boolean } } } di mana kelas aktif angkatan <= 2 pada JP lampau
 * (Paritas penuh 100% dengan heuristik Monitoring KBM)
 */
export function buildWeeklyKbmActivityMap({ schoolJurnalEntries = [], weekInfo = null }) {
    const nonEffectiveDates = new Set();
    const tidakEfektifAngkatanMap = {};

    const todayStr = (typeof window !== 'undefined' && typeof window.getLocalISODate === 'function')
        ? window.getLocalISODate()
        : getLocalISODate();

    const dates = [];
    if (weekInfo?.mondayDate) {
        const mon = new Date(weekInfo.mondayDate);
        for (let i = 0; i < 5; i++) {
            const d = new Date(mon);
            d.setDate(mon.getDate() + i);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            dates.push(`${y}-${m}-${day}`);
        }
    }

    dates.forEach(dateStr => {
        tidakEfektifAngkatanMap[dateStr] = { X: {}, XI: {}, XII: {}, OTHER: {} };

        const activeClassesOnDate = new Set();
        const angkatanJpClassSets = {
            X: {},
            XI: {},
            XII: {},
            OTHER: {}
        };
        for (let jp = 1; jp <= 10; jp++) {
            angkatanJpClassSets.X[jp] = new Set();
            angkatanJpClassSets.XI[jp] = new Set();
            angkatanJpClassSets.XII[jp] = new Set();
            angkatanJpClassSets.OTHER[jp] = new Set();
        }

        (schoolJurnalEntries || []).forEach(j => {
            if ((j.tanggal || '').trim() !== dateStr) return;
            const k = (j.kelas || '').trim();
            if (!k) return;
            activeClassesOnDate.add(k.toUpperCase());

            const angk = getAngkatanFromClass(k);
            const jps = parseJpNumbers(j.jp);
            jps.forEach(jp => {
                if (jp >= 1 && jp <= 10 && angkatanJpClassSets[angk]) {
                    angkatanJpClassSets[angk][jp].add(k.toUpperCase());
                }
            });
        });

        // 1. Heuristik Harian Sekolah: <= 5 rombel aktif KBM di sekolah pada hari lampau
        const isPastOrToday = dateStr <= todayStr;
        if (isPastOrToday && activeClassesOnDate.size <= 5) {
            nonEffectiveDates.add(dateStr);
        }

        // 2. Heuristik JP per Angkatan: <= 2 rombel aktif KBM di angkatan pada JP lampau
        for (let jp = 1; jp <= 10; jp++) {
            const elapsed = isJPElapsed(jp, dateStr);
            ['X', 'XI', 'XII', 'OTHER'].forEach(angk => {
                const count = angkatanJpClassSets[angk][jp].size;
                tidakEfektifAngkatanMap[dateStr][angk][jp] = elapsed && (count <= 2);
            });
        }
    });

    return {
        nonEffectiveDates,
        tidakEfektifAngkatanMap
    };
}

/**
 * Deteksi Apakah Suatu Slot Jam Pembelajaran / Hari Merupakan "Tidak Belajar Efektif (TE)"
 * Memeriksa:
 * 1. Hari Libur Resmi / Libur Sekolah (HolidayManager / lib_hari_libur / DataHolidays)
 * 2. Agenda Kegiatan / Acara Sekolah dari Cloudflare D1 calendar_events (Bulan Bahasa, Workshop, Try Out, dsb.)
 * 3. Jadwal rutin non-KBM: Senin JP 1 (Upacara Bendera) & Jumat JP 10 (Ekstrakurikuler)
 * 4. Catatan presensi siswa: Status 'K' (Kegiatan Sekolah) atau 'TE' (Tidak Efektif)
 * 5. Materi jurnal pembelajaran yang memuat indikator acara / ujian massal sekolah
 * 6. Aktivitas KBM Nyata Sekolah & Angkatan (Paritas Penuh SSOT Monitoring KBM)
 * 
 * @param {Object} params
 * @returns {Object} Objek hasil deteksi: { isTidakEfektif, kategori, label, keterangan }
 */
export function detectTidakBelajarEfektif({ dateStr = '', jpList = [], mapel = '', guru = '', rawStatus = '', topik = '', catatan = '', agendaEvents = [], holidayInfo = null, className = '', kbmActivityMap = null }) {
    // 1. Cek Hari Libur Resmi / Libur Sekolah Terdaftar (SSOT HolidayManager / lib_hari_libur / DataHolidays)
    if (holidayInfo || (dateStr && typeof isHolidayDate === 'function' && isHolidayDate(dateStr))) {
        const hInfo = holidayInfo || (typeof getHolidayDateInfo === 'function' ? getHolidayDateInfo(dateStr) : null);
        const hTitle = hInfo?.title || hInfo?.nama || hInfo?.name || 'Hari Libur Resmi';
        return {
            isTidakEfektif: true,
            kategori: 'LIBUR',
            label: hTitle,
            keterangan: hInfo?.description || `Hari Libur Resmi: ${hTitle}`
        };
    }

    const nonEfektifKeywords = [
        'tidak belajar efektif',
        'tidak efektif',
        'try out', 'tryout', 'to snbt', 'to us',
        'ujian sekolah', 'asesmen sumatif', 'anbk', 'asram',
        'porsenijar', 'porseni', 'class meeting', 'classmeeting',
        'hut smagesa', 'hut sekolah', 'bulan bahasa',
        'rapat dinas', 'rapat guru', 'workshop guru',
        'workshop penguatan ekosistem digital', 'workshop',
        'jeda semester', 'jeda tengah semester',
        'piodalan', 'persembahyangan', 'tirta yatra', 'hari raya',
        'libur semester', 'libur hari raya', 'cuti bersama',
        'projek p5', 'gelar karya p5'
    ];

    // Helper cari judul agenda sekolah jika ada pada tanggal ini
    let matchedAgendaTitle = '';
    if (Array.isArray(agendaEvents) && agendaEvents.length > 0) {
        for (const ev of agendaEvents) {
            const evStart = String(ev.date || '').split('T')[0];
            const evEnd = String(ev.endDate || ev.time || ev.date || '').split('T')[0];
            if (evStart && dateStr >= evStart && dateStr <= (evEnd || evStart)) {
                matchedAgendaTitle = String(ev.title || '').trim();
                break;
            }
        }
    }

    // 2. Cek Agenda Kegiatan / Acara Sekolah dari Cloudflare D1 calendar_events
    if (Array.isArray(agendaEvents) && agendaEvents.length > 0) {
        for (const ev of agendaEvents) {
            const evStart = String(ev.date || '').split('T')[0];
            const evEnd = String(ev.endDate || ev.time || ev.date || '').split('T')[0];
            if (evStart && dateStr >= evStart && dateStr <= (evEnd || evStart)) {
                const cat = String(ev.category || ev.type || '').toLowerCase();
                const evTitle = String(ev.title || '').trim();
                const titleLower = evTitle.toLowerCase();

                const isLibur = cat === 'libur';
                const isKegiatan = cat === 'kegiatan' || cat === 'penting' || cat === 'acara';
                const matchesKeyword = nonEfektifKeywords.some(kw => titleLower.includes(kw));

                if (isLibur || matchesKeyword || isKegiatan) {
                    return {
                        isTidakEfektif: true,
                        kategori: isLibur ? 'LIBUR' : 'KEGIATAN_SEKOLAH',
                        label: evTitle || 'Kegiatan Sekolah',
                        keterangan: ev.description ? `${evTitle} (${ev.description})` : `Agenda Sekolah: ${evTitle}`
                    };
                }
            }
        }
    }

    let dayOfWeek = 0;
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [y, m, d] = dateStr.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d, 12, 0, 0);
        dayOfWeek = dateObj.getDay(); // 1 = Senin, ..., 5 = Jumat
    }

    const numJpList = Array.isArray(jpList) 
        ? jpList.map(Number).filter(n => !isNaN(n))
        : [];

    // 3. Cek Jadwal Rutin Khusus Non-KBM Sekolah
    // - Hari Senin JP 1: Upacara Bendera
    if (dayOfWeek === 1 && numJpList.includes(1)) {
        return {
            isTidakEfektif: true,
            kategori: 'UPACARA',
            label: 'Upacara Bendera',
            keterangan: 'Upacara Bendera Sekolah (Senin JP 1)'
        };
    }

    // - Hari Jumat JP 10: Kegiatan Ekstrakurikuler
    if (dayOfWeek === 5 && numJpList.includes(10)) {
        return {
            isTidakEfektif: true,
            kategori: 'EKSKUL',
            label: 'Ekstrakurikuler',
            keterangan: 'Kegiatan Ekstrakurikuler Sekolah (Jumat JP 10)'
        };
    }

    // 4. Cek Presensi Guru oleh Siswa (Status 'K' = Kegiatan / Acara Sekolah)
    const st = String(rawStatus || '').trim().toUpperCase();
    if (st === 'K' || st === 'KEGIATAN' || st === 'TE' || st === 'TIDAK_EFEKTIF' || st === 'ACARA') {
        return {
            isTidakEfektif: true,
            kategori: 'KEGIATAN_SEKOLAH',
            label: matchedAgendaTitle || 'Kegiatan Sekolah',
            keterangan: 'Kegiatan Sekolah (Presensi Siswa)'
        };
    }

    // 5. Cek Kata Kunci Non-KBM pada Topik / Catatan Jurnal Guru / Nama Mapel
    const textToCheck = `${topik} ${catatan} ${mapel}`.toLowerCase();
    for (const kw of nonEfektifKeywords) {
        if (textToCheck.includes(kw)) {
            let label = matchedAgendaTitle || 'Kegiatan Sekolah / Non-KBM';
            if (!matchedAgendaTitle) {
                if (kw.includes('upacara') || kw.includes('piodalan') || kw.includes('sembahyang')) label = 'Upacara / Persembahyangan';
                else if (kw.includes('try') || kw.includes('ujian') || kw.includes('anbk') || kw.includes('asesmen')) label = 'Ujian / Asesmen Sekolah';
                else if (kw.includes('rapat')) label = 'Rapat Dinas Sekolah';
                else if (kw.includes('porseni') || kw.includes('hut') || kw.includes('meeting')) label = 'Porseni / Acara Sekolah';
                else if (kw.includes('bulan bahasa')) label = 'Bulan Bahasa';
                else if (kw.includes('p5')) label = 'Kegiatan Projek P5';
                else if (kw.includes('libur') || kw.includes('cuti')) label = 'Hari Libur Resmi';
            }
            return {
                isTidakEfektif: true,
                kategori: 'ACARA_SEKOLAH',
                label,
                keterangan: `Agenda Sekolah: ${label}`
            };
        }
    }

    // 6. Cek Aktivitas KBM Nyata Sekolah & Angkatan (Paritas Penuh SSOT Monitoring KBM)
    // Berlaku otomatis sekalipun agenda tidak tertulis di kalender!
    if (kbmActivityMap) {
        // A. Tingkat Sekolah: Hari kerja lampau dengan <= 5 kelas aktif KBM di sekolah
        if (kbmActivityMap.nonEffectiveDates && kbmActivityMap.nonEffectiveDates.has(dateStr)) {
            const label = matchedAgendaTitle || 'Dispensasi Khusus / Acara Sekolah';
            return {
                isTidakEfektif: true,
                kategori: 'KEGIATAN_SEKOLAH',
                label,
                keterangan: 'Tidak Belajar Efektif (Aktivitas KBM Sekolah Non-Efektif)'
            };
        }

        // B. Tingkat Angkatan: JP lampau dengan <= 2 kelas aktif KBM di angkatan tersebut
        const angk = getAngkatanFromClass(className);
        if (numJpList.length > 0 && kbmActivityMap.tidakEfektifAngkatanMap?.[dateStr]?.[angk]) {
            const isAngkNonEffective = numJpList.some(jp => Boolean(kbmActivityMap.tidakEfektifAngkatanMap[dateStr][angk][jp]));
            if (isAngkNonEffective) {
                const label = matchedAgendaTitle || 'Tidak Belajar Efektif';
                return {
                    isTidakEfektif: true,
                    kategori: 'KEGIATAN_SEKOLAH',
                    label,
                    keterangan: `Tidak Belajar Efektif (Aktivitas KBM Angkatan ${angk} Non-Efektif)`
                };
            }
        }
    }

    return {
        isTidakEfektif: false,
        kategori: '',
        label: '',
        keterangan: ''
    };
}

/**
 * Format label status penugasan guru ('Ada Tugas' / 'Tanpa Tugas')
 */
export function formatAdaTugasLabel(adaTugas) {
    if (adaTugas === true || adaTugas === 'true' || adaTugas === 1) return 'Ada Tugas';
    if (adaTugas === false || adaTugas === 'false' || adaTugas === 0) return 'Tanpa Tugas';
    return '-';
}

/**
 * Format string JP (Jam Pembelajaran) agar rapi, misal [1, 2] -> "1 - 2"
 */
export function formatJpDisplay(jp) {
    if (!jp) return '-';
    if (Array.isArray(jp)) {
        if (jp.length === 0) return '-';
        const numList = jp.map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
        if (numList.length === 0) return '-';
        const min = numList[0];
        const max = numList[numList.length - 1];
        return min === max ? `${min}` : `${min} - ${max}`;
    }
    const str = String(jp).trim();
    if (str.startsWith('[') && str.endsWith(']')) {
        try {
            const parsed = JSON.parse(str);
            return formatJpDisplay(parsed);
        } catch (e) {}
    }
    return str || '-';
}

/**
 * Menghitung nilai numerik JP terkecil untuk sorting kronologis
 */
export function getMinJp(jp) {
    if (!jp) return 999;
    if (Array.isArray(jp)) {
        const nums = jp.map(Number).filter(n => !isNaN(n));
        return nums.length > 0 ? Math.min(...nums) : 999;
    }
    const str = String(jp).trim();
    if (str.startsWith('[') && str.endsWith(']')) {
        try {
            const parsed = JSON.parse(str);
            return getMinJp(parsed);
        } catch (e) {}
    }
    const m = str.match(/\d+/);
    return m ? parseInt(m[0], 10) : 999;
}

/**
 * Menghitung total durasi jam pelajaran (JP) dalam 1 entri
 */
export function calculateJpCount(jp) {
    if (!jp) return 0;
    if (Array.isArray(jp)) {
        return jp.length;
    }
    const str = String(jp).trim();
    if (str.startsWith('[') && str.endsWith(']')) {
        try {
            const parsed = JSON.parse(str);
            if (Array.isArray(parsed)) return parsed.length;
        } catch (e) {}
    }
    const parts = str.split(/[,-]/);
    if (parts.length === 2) {
        const start = parseInt(parts[0], 10);
        const end = parseInt(parts[1], 10);
        if (!isNaN(start) && !isNaN(end) && end >= start) {
            return (end - start) + 1;
        }
    }
    return 1;
}

/**
 * Mendapatkan nama hari dalam bahasa Indonesia dari ISO date (YYYY-MM-DD)
 */
export function getIndoDayName(isoDate) {
    if (!isoDate) return '-';
    const [y, m, d] = isoDate.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d, 12, 0, 0);
    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    return dayNames[dateObj.getDay()] || '-';
}

/**
 * Parsing ringkasan presensi ketidakhadiran siswa dari presensi_detail
 */
export function parsePresensiSummary(presensiDetail) {
    if (!presensiDetail || !Array.isArray(presensiDetail) || presensiDetail.length === 0) {
        return {
            hasAbsent: false,
            s: 0,
            i: 0,
            a: 0,
            d: 0,
            totalAbsent: 0,
            textSummary: 'Nihil (Hadir Semua)',
            groupedHtml: '<span class="text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]"><i class="fa-solid fa-circle-check text-[10px] mr-1"></i>Nihil</span>'
        };
    }

    const sList = [];
    const iList = [];
    const aList = [];
    const dList = [];

    presensiDetail.forEach(item => {
        const st = String(item.status || '').toUpperCase().trim();
        const rawName = item.nama || item.name || item.student_name || item.nis || '';
        const shortName = rawName.split(/\s+/).slice(0, 2).join(' ') || item.nis || 'Siswa';

        if (st === 'S' || st === 'SAKIT') sList.push(shortName);
        else if (st === 'I' || st === 'IZIN') iList.push(shortName);
        else if (st === 'A' || st === 'ALPA' || st === 'ALPHA') aList.push(shortName);
        else if (st === 'D' || st === 'DISPEN' || st === 'DISPENSASI') dList.push(shortName);
    });

    const totalAbsent = sList.length + iList.length + aList.length + dList.length;

    if (totalAbsent === 0) {
        return {
            hasAbsent: false,
            s: 0,
            i: 0,
            a: 0,
            d: 0,
            totalAbsent: 0,
            textSummary: 'Nihil (Hadir Semua)',
            groupedHtml: '<span class="text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]"><i class="fa-solid fa-circle-check text-[10px] mr-1"></i>Nihil</span>'
        };
    }

    const parts = [];
    const htmlBadges = [];

    if (sList.length > 0) {
        parts.push(`S (${sList.length}): ${sList.join(', ')}`);
        htmlBadges.push(`<span class="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 text-[10px] font-bold" title="${escapeHTML(sList.join(', '))}">S: ${sList.length}</span>`);
    }
    if (iList.length > 0) {
        parts.push(`I (${iList.length}): ${iList.join(', ')}`);
        htmlBadges.push(`<span class="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 text-[10px] font-bold" title="${escapeHTML(iList.join(', '))}">I: ${iList.length}</span>`);
    }
    if (aList.length > 0) {
        parts.push(`A (${aList.length}): ${aList.join(', ')}`);
        htmlBadges.push(`<span class="inline-flex items-center px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-200 text-[10px] font-bold" title="${escapeHTML(aList.join(', '))}">A: ${aList.length}</span>`);
    }
    if (dList.length > 0) {
        parts.push(`D (${dList.length}): ${dList.join(', ')}`);
        htmlBadges.push(`<span class="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-200 text-[10px] font-bold" title="${escapeHTML(dList.join(', '))}">D: ${dList.length}</span>`);
    }

    return {
        hasAbsent: true,
        s: sList.length,
        i: iList.length,
        a: aList.length,
        d: dList.length,
        sList,
        iList,
        aList,
        dList,
        totalAbsent,
        textSummary: parts.join('; '),
        groupedHtml: htmlBadges.join(' ')
    };
}

/**
 * Rekonsiliasi data mingguan antara entri Jurnal KBM (D1), Catatan Presensi Guru oleh Siswa (Supabase), dan Jadwal Pelajaran (aSc).
 * Memastikan setiap guru pengampu dari jadwal aSc dimunculkan sekalipun guru belum/tidak mengisi jurnal.
 * 
 * @param {Object} params
 * @param {Object} params.weekInfo
 * @param {string} params.className
 * @param {Array} params.jurnalEntries
 * @param {Array} params.guruPresensiList
 * @param {Object} params.weeklyScheduleMap
 * @returns {Array} Daftar entri gabungan kronologis
 */
export function reconcileWeeklyJurnalData({ weekInfo, className, jurnalEntries = [], guruPresensiList = [], weeklyScheduleMap = {}, agendaEvents = [], kbmActivityMap = null }) {
    // 1. Buat lookup map guru_presensi: key `${dateStr}_${jp}` -> row
    const guruPresensiMap = new Map();
    (guruPresensiList || []).forEach(row => {
        const tgl = (row.tanggal || '').trim();
        const jp = parseInt(row.jp, 10);
        if (tgl && !isNaN(jp)) {
            guruPresensiMap.set(`${tgl}_${jp}`, row);
        }
    });

    const usedJurnalIds = new Set();
    const result = [];

    // 2. Loop setiap hari belajar (Senin s.d. Jumat: 5 hari)
    const monday = new Date(weekInfo.mondayDate);
    for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
        const currentDate = new Date(monday);
        currentDate.setDate(monday.getDate() + dayOffset);
        const y = currentDate.getFullYear();
        const m = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');
        const dateStr = `${y}-${m}-${day}`;

        // Cek info hari libur untuk tanggal ini (HolidayManager)
        const isHol = typeof isHolidayDate === 'function' ? isHolidayDate(dateStr) : false;
        const holInfo = (isHol && typeof getHolidayDateInfo === 'function') ? getHolidayDateInfo(dateStr) : null;

        // Filter agenda kegiatan yang aktif pada tanggal ini
        const dayAgendaEvents = (agendaEvents || []).filter(ev => {
            const evStart = String(ev.date || '').split('T')[0];
            const evEnd = String(ev.endDate || ev.time || ev.date || '').split('T')[0];
            return evStart && dateStr >= evStart && dateStr <= (evEnd || evStart);
        });

        const daySchedule = weeklyScheduleMap[dateStr] || [];
        const scheduleBlocks = groupScheduleSlots(daySchedule);

        scheduleBlocks.forEach(block => {
            // Cari apakah ada entri jurnal KBM dari Cloudflare D1 yang cocok
            let matchedJurnal = null;

            // Prioritas 1: Tanggal sama dan JP beririsan
            for (const j of jurnalEntries) {
                if (usedJurnalIds.has(j.id)) continue;
                if ((j.tanggal || '').trim() !== dateStr) continue;

                const jJps = parseJpNumbers(j.jp);
                const isJpOverlap = jJps.some(jp => block.jpList.includes(jp));
                if (isJpOverlap) {
                    matchedJurnal = j;
                    break;
                }
            }

            // Prioritas 2: Tanggal sama, nama mapel dan guru cocok
            if (!matchedJurnal) {
                for (const j of jurnalEntries) {
                    if (usedJurnalIds.has(j.id)) continue;
                    if ((j.tanggal || '').trim() !== dateStr) continue;

                    const jMapel = (j.mapel || '').trim().toLowerCase();
                    const bMapel = block.mapel.trim().toLowerCase();
                    const jGuru = (j.guru || '').trim().toLowerCase();
                    const bGuru = block.guruNama.trim().toLowerCase();

                    if ((jMapel && bMapel && (jMapel === bMapel || jMapel.includes(bMapel) || bMapel.includes(jMapel))) &&
                        (jGuru && bGuru && (jGuru === bGuru || jGuru.includes(bGuru) || bGuru.includes(jGuru)))) {
                        matchedJurnal = j;
                        break;
                    }
                }
            }

            // Cari catatan presensi guru oleh siswa untuk salah satu JP di blok ini
            let presensiRow = null;
            for (const jp of block.jpList) {
                const pr = guruPresensiMap.get(`${dateStr}_${jp}`);
                if (pr) {
                    presensiRow = pr;
                    const st = (pr.status || '').toUpperCase();
                    // Jika tercatat tidak hadir (S/I/TK/D/TL), prioritaskan langsung
                    if (st && st !== 'H' && st !== 'HADIR') break;
                }
            }

            // Deteksi Apakah Slot Ini Tidak Belajar Efektif (TE)
            // Menggabungkan Hari Libur, Agenda D1, Presensi K, Rutin Non-KBM, serta Paritas Aktivitas KBM Nyata Monitoring KBM
            const teCheck = detectTidakBelajarEfektif({
                dateStr,
                jpList: block.jpList,
                mapel: block.mapel,
                guru: block.guruNama,
                rawStatus: presensiRow?.status || '',
                topik: matchedJurnal?.topik || '',
                catatan: matchedJurnal?.catatan || '',
                agendaEvents: dayAgendaEvents,
                holidayInfo: holInfo,
                className,
                kbmActivityMap
            });

            if (matchedJurnal) {
                usedJurnalIds.add(matchedJurnal.id);
                const enriched = {
                    ...matchedJurnal,
                    is_unfilled: false,
                    is_guru_absent: false,
                    is_tidak_efektif: teCheck.isTidakEfektif,
                    te_kategori: teCheck.kategori,
                    te_label: teCheck.label,
                    te_keterangan: teCheck.keterangan
                };
                if (presensiRow) {
                    const st = (presensiRow.status || '').toUpperCase();
                    enriched.guru_presensi_status = presensiRow.status;
                    enriched.guru_presensi_label = normalizeGuruPresensiStatus(presensiRow.status);
                    enriched.ada_tugas = presensiRow.ada_tugas;
                    enriched.ada_tugas_label = formatAdaTugasLabel(presensiRow.ada_tugas);
                    if (st && st !== 'H' && st !== 'HADIR' && st !== 'K' && st !== 'KEGIATAN') {
                        enriched.is_guru_absent = true;
                    }
                }
                result.push(enriched);
            } else {
                // GURU TIDAK / BELUM MENGISI JURNAL
                // Munculkan nama guru dan mapel dari jadwal aSc
                let isGuruAbsent = false;
                let statusLabel = '-';
                let rawStatus = '';
                let adaTugasVal = null;
                let adaTugasText = '-';

                if (presensiRow) {
                    rawStatus = presensiRow.status || '';
                    statusLabel = normalizeGuruPresensiStatus(presensiRow.status);
                    const st = rawStatus.toUpperCase();
                    adaTugasVal = presensiRow.ada_tugas;
                    adaTugasText = formatAdaTugasLabel(presensiRow.ada_tugas);

                    if (st && st !== 'H' && st !== 'HADIR' && st !== 'K' && st !== 'KEGIATAN') {
                        isGuruAbsent = true;
                    }
                }

                let topikText = '';
                let catatanText = '';

                if (teCheck.isTidakEfektif) {
                    topikText = `[Tidak Belajar Efektif] ${teCheck.label}`;
                    catatanText = teCheck.keterangan || 'Non-KBM Reguler';
                } else if (isGuruAbsent) {
                    topikText = adaTugasText !== '-' 
                        ? `Guru Tidak Hadir (${statusLabel}) • ${adaTugasText}`
                        : `Guru Tidak Hadir (${statusLabel})`;
                    catatanText = `Presensi Siswa: Guru ${statusLabel}${adaTugasText !== '-' ? ` (${adaTugasText})` : ''}`;
                } else if (rawStatus.toUpperCase() === 'H' || rawStatus.toUpperCase() === 'HADIR') {
                    topikText = '[Jurnal Belum Diisi Guru]';
                    catatanText = 'Guru Tercatat Hadir (Jurnal Belum Diisi)';
                } else {
                    topikText = '[Jurnal Belum Diisi Guru]';
                    catatanText = '[Belum Terisi]';
                }

                result.push({
                    id: `sched_${dateStr}_${block.jpList.join('-')}`,
                    kelas: className,
                    tanggal: dateStr,
                    jp: block.jpList,
                    mapel: block.mapel,
                    guru: block.guruNama,
                    guru_id: block.guruId,
                    guru_nip: block.guruNip,
                    topik: topikText,
                    presensi_detail: [],
                    catatan: catatanText,
                    lokasi_mengajar: '',
                    ttd: null,
                    is_unfilled: !teCheck.isTidakEfektif,
                    is_guru_absent: isGuruAbsent && !teCheck.isTidakEfektif,
                    is_tidak_efektif: teCheck.isTidakEfektif,
                    te_kategori: teCheck.kategori,
                    te_label: teCheck.label,
                    te_keterangan: teCheck.keterangan,
                    guru_presensi_status: rawStatus,
                    guru_presensi_label: isGuruAbsent ? statusLabel : '',
                    ada_tugas: adaTugasVal,
                    ada_tugas_label: isGuruAbsent ? adaTugasText : ''
                });
            }
        });
    }

    // 3. Masukkan juga jurnal dari D1 yang belum terpakai (misal hari Sabtu, atau jam di luar jadwal aSc)
    (jurnalEntries || []).forEach(j => {
        if (!usedJurnalIds.has(j.id)) {
            const jDate = (j.tanggal || '').trim();
            const isHol = typeof isHolidayDate === 'function' ? isHolidayDate(jDate) : false;
            const holInfo = (isHol && typeof getHolidayDateInfo === 'function') ? getHolidayDateInfo(jDate) : null;
            const dayAgendaEvents = (agendaEvents || []).filter(ev => {
                const evStart = String(ev.date || '').split('T')[0];
                const evEnd = String(ev.endDate || ev.time || ev.date || '').split('T')[0];
                return evStart && jDate >= evStart && jDate <= (evEnd || evStart);
            });

            const teCheck = detectTidakBelajarEfektif({
                dateStr: j.tanggal,
                jpList: parseJpNumbers(j.jp),
                mapel: j.mapel,
                guru: j.guru,
                topik: j.topik || '',
                catatan: j.catatan || '',
                agendaEvents: dayAgendaEvents,
                holidayInfo: holInfo,
                className,
                kbmActivityMap
            });
            result.push({
                ...j,
                is_unfilled: false,
                is_guru_absent: false,
                is_tidak_efektif: teCheck.isTidakEfektif,
                te_kategori: teCheck.kategori,
                te_label: teCheck.label,
                te_keterangan: teCheck.keterangan
            });
        }
    });

    // 4. Urutkan seluruh entri gabungan kronologis
    result.sort((a, b) => {
        const dateA = a.tanggal || '';
        const dateB = b.tanggal || '';
        if (dateA !== dateB) {
            return dateA.localeCompare(dateB);
        }
        return getMinJp(a.jp) - getMinJp(b.jp);
    });

    return result;
}

/**
 * Pemuatan data jurnal mingguan terintegrasi:
 * - Jurnal KBM terisi dari Cloudflare D1 SQL (0 Firestore Read)
 * - Presensi Guru oleh Siswa dari Supabase (1 single range query hemat kuota)
 * - Jadwal Pelajaran aSc per kelas (Senin s.d. Jumat)
 * - Agenda Sekolah dari Cloudflare D1 calendar_events & Hari Libur Master
 * - Peta Aktivitas KBM Nyata Sekolah & Angkatan (Paritas Penuh SSOT Monitoring KBM)
 */
export async function loadWeeklyJurnalData(className, referenceDate) {
    if (!className) return [];
    const weekInfo = calculateWeekRange(referenceDate || getLocalISODate());

    try {
        // 1. Ambil jurnal terisi khusus kelas binaan (lengkap dengan TTD) & jurnal seluruh sekolah (tanpa TTD, hemat kuota) secara paralel
        let rawEntries = [];
        let schoolJurnalEntries = [];
        try {
            const [classRes, schoolRes] = await Promise.all([
                cfClient.getJurnalKbm({
                    kelas: className,
                    start_date: weekInfo.startDateIso,
                    end_date: weekInfo.queryEndDateIso,
                    limit: 300
                }).catch(() => []),
                cfClient.getJurnalKbm({
                    start_date: weekInfo.startDateIso,
                    end_date: weekInfo.queryEndDateIso,
                    limit: 1000,
                    exclude_ttd: true
                }).catch(() => [])
            ]);
            rawEntries = Array.isArray(classRes) ? classRes : [];
            schoolJurnalEntries = Array.isArray(schoolRes) ? schoolRes : [];
        } catch (d1Err) {
            console.warn('[WaliKelasJurnal] Gagal mengambil jurnal D1:', d1Err);
        }
        const jurnalEntries = Array.isArray(rawEntries) ? rawEntries : [];

        // 2. Bangun peta aktivitas KBM nyata sekolah & angkatan (Paritas Penuh SSOT Monitoring KBM)
        const kbmActivityMap = buildWeeklyKbmActivityMap({
            schoolJurnalEntries,
            weekInfo
        });

        // 3. Ambil presensi guru yang diisi siswa dari Supabase (1 single range query hemat kuota)
        let guruPresensiList = [];
        try {
            const sbClient = supabase || (typeof window !== 'undefined' ? window.supabase : null);
            if (sbClient) {
                const { data, error } = await sbClient
                    .from('guru_presensi')
                    .select('*')
                    .eq('kelas', className)
                    .gte('tanggal', weekInfo.startDateIso)
                    .lte('tanggal', weekInfo.queryEndDateIso);
                if (!error && Array.isArray(data)) {
                    guruPresensiList = data;
                }
            }
        } catch (sbErr) {
            console.warn('[WaliKelasJurnal] Gagal mengambil guru_presensi Supabase:', sbErr);
        }

        // 4. Ambil jadwal aSc mingguan untuk kelas tersebut (Senin s.d. Jumat)
        const weeklyScheduleMap = {};
        try {
            const monday = new Date(weekInfo.mondayDate);
            for (let i = 0; i < 5; i++) {
                const d = new Date(monday);
                d.setDate(monday.getDate() + i);
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                const dateStr = `${y}-${m}-${day}`;

                const daySchedule = await getScheduleForClassAndDate(className, dateStr);
                weeklyScheduleMap[dateStr] = Array.isArray(daySchedule) ? daySchedule : [];
            }
        } catch (schedErr) {
            console.warn('[WaliKelasJurnal] Gagal mengambil jadwal aSc:', schedErr);
        }

        // 5. Ambil Agenda Sekolah (calendar_events) dari Cloudflare D1 & Hari Libur Terdaftar (0 Firestore Read)
        let agendaEvents = [];
        try {
            if (typeof fetchRegisteredHolidays === 'function') {
                await fetchRegisteredHolidays(weekInfo.startDateIso, weekInfo.queryEndDateIso).catch(() => {});
            }
            if (cfClient && typeof cfClient.getCalendarEvents === 'function') {
                const startD = new Date(weekInfo.mondayDate);
                const endD = new Date(weekInfo.fridayDate);
                const y1 = startD.getFullYear();
                const m1 = startD.getMonth() + 1;
                const y2 = endD.getFullYear();
                const m2 = endD.getMonth() + 1;

                const res1 = await cfClient.getCalendarEvents(y1, m1);
                const ev1 = Array.isArray(res1?.data) ? res1.data : (Array.isArray(res1) ? res1 : []);
                agendaEvents = [...ev1];

                if (y1 !== y2 || m1 !== m2) {
                    const res2 = await cfClient.getCalendarEvents(y2, m2);
                    const ev2 = Array.isArray(res2?.data) ? res2.data : (Array.isArray(res2) ? res2 : []);
                    agendaEvents = [...agendaEvents, ...ev2];
                }
            }
        } catch (calErr) {
            console.warn('[WaliKelasJurnal] Gagal memuat agenda/hari libur:', calErr);
        }

        // 6. Rekonsiliasi data komprehensif
        const mergedList = reconcileWeeklyJurnalData({
            weekInfo,
            className,
            jurnalEntries,
            guruPresensiList,
            weeklyScheduleMap,
            agendaEvents,
            kbmActivityMap
        });

        return mergedList;
    } catch (err) {
        console.error('[WaliKelasJurnal] Gagal loadWeeklyJurnalData:', err);
        throw err;
    }
}

/**
 * Inisialisasi dan Render Antarmuka Jurnal Mingguan di Portal Wali Kelas
 */
export async function renderWeeklyJurnalTab(containerId = 'tab-content-jurnal', selectedClass = '', targetDate = null, forceRefresh = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (selectedClass) {
        currentWaliJurnalClass = selectedClass;
    }
    if (targetDate) {
        currentWaliJurnalDate = targetDate;
    } else if (!currentWaliJurnalDate) {
        currentWaliJurnalDate = getLocalISODate();
    }

    const weekInfo = calculateWeekRange(currentWaliJurnalDate);

    if (!currentWaliJurnalClass) {
        container.innerHTML = `
            <div class="p-8 text-center text-slate-400">
                <i class="fa-solid fa-chalkboard-user text-3xl mb-2 text-indigo-400 block"></i>
                <p class="font-bold text-sm text-slate-700 dark:text-slate-200">Silakan Pilih Rombel Binaan</p>
                <p class="text-xs text-slate-400 mt-1">Pilih kelas di pojok kanan atas untuk melihat rekap jurnal mengajar mingguan.</p>
            </div>
        `;
        return;
    }

    // Tampilkan Header Bar & Loading State
    container.innerHTML = `
        <!-- HEADER & WEEK CONTROLS BAR -->
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-3">
            <div class="shrink-0 min-w-0">
                <h2 class="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-1.5 whitespace-nowrap">
                    <i class="fa-solid fa-book-journal-whills text-indigo-600 dark:text-indigo-400"></i> Jurnal Mengajar Mingguan
                </h2>
                <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 whitespace-nowrap">
                    Rekapitulasi KBM &amp; agenda kelas ${escapeHTML(currentWaliJurnalClass)} (Format Meja Kelas).
                </p>
            </div>

            <!-- CONTROLS & DATE NAVIGATOR -->
            <div class="flex flex-wrap items-center gap-1.5 shrink-0">
                <!-- NAV BUTTONS -->
                <div class="inline-flex rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 p-0.5 shadow-xs">
                    <button type="button" id="btn-prev-week" onclick="window.navigateWaliJurnalWeek(-7)"
                        class="px-2 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition flex items-center gap-1"
                        title="Pekan Sebelumnya">
                        <i class="fa-solid fa-chevron-left text-[10px]"></i>
                        <span class="hidden sm:inline">Pekan Lalu</span>
                    </button>
                    <button type="button" id="btn-current-week" onclick="window.setWaliJurnalCurrentWeek()"
                        class="px-2 py-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 rounded-md transition"
                        title="Pekan Berjalan Hari Ini">
                        Pekan Ini
                    </button>
                    <button type="button" id="btn-next-week" onclick="window.navigateWaliJurnalWeek(7)"
                        class="px-2 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition flex items-center gap-1"
                        title="Pekan Berikutnya">
                        <span class="hidden sm:inline">Pekan Depan</span>
                        <i class="fa-solid fa-chevron-right text-[10px]"></i>
                    </button>
                </div>

                <!-- DATE PICKER -->
                <div class="flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 px-2 py-0.5 rounded-lg shadow-xs">
                    <label for="input-wali-jurnal-date" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tgl:</label>
                    <input type="date" id="input-wali-jurnal-date" value="${currentWaliJurnalDate}" onchange="window.onWaliJurnalDateChange(this.value)"
                        class="bg-transparent text-xs font-bold text-slate-800 dark:text-white focus:outline-none cursor-pointer">
                </div>

                <!-- ACTION: REFRESH -->
                <button type="button" onclick="window.loadWaliJurnalMingguan(true)"
                    class="filter-btn-compact bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 shrink-0"
                    title="Muat Ulang Data dari Cloudflare D1">
                    <i class="fa-solid fa-rotate-right text-xs" id="icon-refresh-wali-jurnal"></i>
                </button>

                <!-- ACTION: PRINT CETAK RESMI -->
                <button type="button" id="btn-print-wali-jurnal" onclick="window.printWeeklyJurnal()"
                    class="filter-btn-compact bg-indigo-600 hover:bg-indigo-700 text-white shrink-0 shadow-xs flex items-center gap-1.5"
                    title="Cetak Jurnal Mingguan Format Meja Kelas (A4 Landscape)">
                    <i class="fa-solid fa-print text-xs"></i>
                    <span>Cetak Jurnal</span>
                </button>
            </div>
        </div>

        <!-- WEEK BADGE & QUICK INFO BANNER -->
        <div class="bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div class="flex items-center gap-2">
                <span class="w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-[11px] shrink-0">
                    <i class="fa-solid fa-calendar-week"></i>
                </span>
                <div>
                    <span class="text-[10px] font-bold text-indigo-500 uppercase tracking-wider block leading-none">Periode Mingguan:</span>
                    <h3 class="font-bold text-slate-800 dark:text-white mt-0.5">${escapeHTML(weekInfo.fullLabel)}</h3>
                </div>
            </div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                Senin, ${formatDateIndo(weekInfo.startDateIso)} s.d. Jumat, ${formatDateIndo(weekInfo.endDateIso)}
            </div>
        </div>

        <!-- VERIFICATION STATUS BANNER KEPALA SEKOLAH -->
        <div id="wali-jurnal-verif-banner-container">
            <!-- Populated dynamically via renderVerificationBanner -->
        </div>

        <!-- KPI SUMMARY CARDS -->
        <div id="wali-jurnal-kpi-container" class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <!-- Populated after fetch -->
        </div>

        <!-- JURNAL TABLE CONTAINER -->
        <div id="wali-jurnal-table-wrapper" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xs">
            <div class="p-12 text-center text-slate-400">
                <i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2 text-indigo-500 block"></i>
                Memuat data jurnal mengajar rombel ${escapeHTML(currentWaliJurnalClass)}...
            </div>
        </div>
    `;

    // Ambil data jurnal
    const iconRefresh = document.getElementById('icon-refresh-wali-jurnal');
    if (iconRefresh) iconRefresh.classList.add('fa-spin');
    isWaliJurnalLoading = true;

    try {
        currentWaliJurnalData = await loadWeeklyJurnalData(currentWaliJurnalClass, currentWaliJurnalDate);
        currentWaliJurnalVerification = await getWeeklyJurnalVerification(currentWaliJurnalClass, weekInfo.startDateIso);
        renderVerificationBanner(currentWaliJurnalVerification, currentWaliJurnalClass, weekInfo);
        renderJurnalKpis(currentWaliJurnalData);
        renderJurnalTable(currentWaliJurnalData, currentWaliJurnalClass, weekInfo);
    } catch (err) {
        const wrapper = document.getElementById('wali-jurnal-table-wrapper');
        if (wrapper) {
            wrapper.innerHTML = `
                <div class="p-8 text-center text-rose-500">
                    <i class="fa-solid fa-triangle-exclamation text-2xl mb-2 block"></i>
                    Gagal memuat jurnal mingguan: ${escapeHTML(err.message || 'Kesalahan jaringan')}
                </div>
            `;
        }
    } finally {
        isWaliJurnalLoading = false;
        if (iconRefresh) iconRefresh.classList.remove('fa-spin');
    }
}

/**
 * Render Banner Status Verifikasi Kepala Sekolah pada Tab Jurnal Mingguan
 */
export function renderVerificationBanner(verifData, className, weekInfo) {
    const container = document.getElementById('wali-jurnal-verif-banner-container');
    if (!container) return;

    const isVerified = verifData && verifData.status === 'verified';
    const canVerify = canUserVerifyJurnal();

    const bannerBgClass = isVerified
        ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800'
        : 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800';

    const iconBgClass = isVerified ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white';
    const iconClass = isVerified ? 'fa-circle-check' : 'fa-clock';

    const badgeClass = isVerified
        ? 'bg-emerald-200 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200'
        : 'bg-amber-200 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200';

    container.innerHTML = `
        <div class="rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs transition-colors ${bannerBgClass}">
            <div class="flex items-start gap-3 min-w-0">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm ${iconBgClass}">
                    <i class="fa-solid ${iconClass}"></i>
                </div>
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${badgeClass}">
                            ${isVerified ? 'Terverifikasi Kepala Sekolah' : 'Menunggu Verifikasi'}
                        </span>
                        ${isVerified && verifData.verifToken ? `
                            <span class="text-[10px] font-mono text-emerald-700 dark:text-emerald-300 font-bold bg-emerald-100 dark:bg-emerald-900/50 px-1.5 py-0.5 rounded">
                                ${escapeHTML(verifData.verifToken)}
                            </span>
                        ` : ''}
                    </div>
                    <p class="text-xs font-bold text-slate-800 dark:text-white mt-1">
                        ${isVerified 
                            ? `Telah disahkan oleh ${escapeHTML(verifData.verifiedByName || 'Kepala Sekolah')} (${formatDateIndo(verifData.verifiedAt)})`
                            : 'Laporan jurnal mingguan rombel ini belum diverifikasi oleh Kepala Sekolah.'}
                    </p>
                    ${isVerified && verifData.catatan ? `
                        <div class="mt-1.5 p-2 rounded-lg bg-emerald-100/70 dark:bg-emerald-900/30 border-l-4 border-emerald-500 text-[11px] text-emerald-900 dark:text-emerald-200 italic">
                            <i class="fa-solid fa-quote-left text-[9px] mr-1 text-emerald-600"></i>${escapeHTML(verifData.catatan)}
                        </div>
                    ` : ''}
                </div>
            </div>

            <!-- ACTION BUTTONS / SIGNATURE PREVIEW -->
            <div class="flex items-center gap-2 shrink-0 self-end sm:self-center">
                ${isVerified && verifData.ttd ? `
                    <div class="hidden md:flex flex-col items-center mr-1 bg-white dark:bg-slate-800 px-2 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800">
                        <img src="${escapeHTML(verifData.ttd)}" alt="TTD Kepsek" class="h-7 max-w-[85px] object-contain">
                        <span class="text-[8.5px] text-emerald-600 dark:text-emerald-400 font-bold leading-none mt-0.5">TTD Digital</span>
                    </div>
                ` : ''}
                ${canVerify ? `
                    ${isVerified ? `
                        <button type="button" onclick="window.openWaliJurnalVerifyModal()"
                            class="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 shadow-xs flex items-center gap-1 transition"
                            title="Edit Tanda Tangan atau Catatan Arahan">
                            <i class="fa-solid fa-pen-to-square text-[10px] text-emerald-600"></i> Edit TTD
                        </button>
                        <button type="button" onclick="window.cancelKepsekVerificationConfirm()"
                            class="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 shadow-xs flex items-center gap-1 transition"
                            title="Batalkan Pengesahan">
                            <i class="fa-solid fa-xmark text-[10px]"></i> Batal Sah
                        </button>
                    ` : `
                        <button type="button" onclick="window.openWaliJurnalVerifyModal()"
                            class="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs flex items-center gap-1.5 transition animate-pulse"
                            title="Verifikasi & Tanda Tangani Jurnal Mengajar Pekan Ini">
                            <i class="fa-solid fa-signature"></i> Verifikasi &amp; TTD Jurnal
                        </button>
                    `}
                ` : `
                    <span class="text-[11px] text-slate-400 dark:text-slate-500 italic">
                        ${isVerified ? 'Telah Disahkan Resmi' : 'Menghadap Kepala Sekolah untuk Pengesahan'}
                    </span>
                `}
            </div>
        </div>
    `;
}

/**
 * Membuka Modal Verifikasi & TTD Digital Kepala Sekolah
 */
export function openWaliJurnalVerifyModal() {
    const modal = document.getElementById('modal-wali-jurnal-verify');
    if (!modal) return;

    const weekInfo = calculateWeekRange(currentWaliJurnalDate || getLocalISODate());
    const subtitle = document.getElementById('modal-jurnal-verify-subtitle');
    if (subtitle) {
        subtitle.textContent = `Pengesahan Rombel ${currentWaliJurnalClass} • ${weekInfo.fullLabel}`;
    }

    // Hitung ringkasan KBM pekan ini
    let totalSlots = (currentWaliJurnalData || []).length;
    let filledSessions = 0;
    let tidakEfektifCount = 0;
    let totalJp = 0;
    let guruAbsentCount = 0;
    let totalAbsentSiswa = 0;

    (currentWaliJurnalData || []).forEach(item => {
        totalJp += calculateJpCount(item.jp);
        if (item.is_tidak_efektif) {
            tidakEfektifCount++;
        } else {
            if (!item.is_unfilled) filledSessions++;
            if (item.is_guru_absent) guruAbsentCount++;
        }
        const parsed = parsePresensiSummary(item.presensi_detail);
        totalAbsentSiswa += (parsed.s + parsed.i + parsed.a + parsed.d);
    });

    const effectiveTotalSlots = Math.max(0, totalSlots - tidakEfektifCount);

    const summaryBox = document.getElementById('modal-jurnal-verify-summary');
    if (summaryBox) {
        summaryBox.innerHTML = `
            <div class="flex items-center justify-between font-bold text-slate-800 dark:text-white border-b border-emerald-200/60 dark:border-emerald-800/60 pb-1.5">
                <span>Rombel: ${escapeHTML(currentWaliJurnalClass)}</span>
                <span class="text-emerald-700 dark:text-emerald-300 font-mono">${escapeHTML(weekInfo.rangeLabel)}</span>
            </div>
            <div class="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                <div>• Terlaksana: <strong>${filledSessions} / ${effectiveTotalSlots} Sesi Efektif</strong> (${totalJp} JP)</div>
                <div>• Tidak Belajar Efektif: <strong class="text-slate-600 dark:text-slate-300">${tidakEfektifCount} Sesi</strong></div>
                <div>• Guru Tidak Hadir: <strong class="${guruAbsentCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}">${guruAbsentCount} Sesi</strong></div>
                <div>• Siswa Absen: <strong>${totalAbsentSiswa} Siswa</strong></div>
            </div>
        `;
    }

    // Isi nilai catatan jika sudah ada verifikasi sebelumnya
    const catatanInput = document.getElementById('input-kepsek-catatan');
    if (catatanInput) {
        catatanInput.value = (currentWaliJurnalVerification && currentWaliJurnalVerification.status === 'verified') 
            ? (currentWaliJurnalVerification.catatan || '') 
            : '';
    }

    modal.classList.remove('hidden');

    // Inisialisasi kanvas setelah modal tampil
    setTimeout(() => {
        initKepsekCanvas();
        clearKepsekCanvas();

        // Jika sudah ada TTD sebelumnya, gambar ulang ke kanvas
        if (currentWaliJurnalVerification && currentWaliJurnalVerification.status === 'verified' && currentWaliJurnalVerification.ttd) {
            const canvas = document.getElementById('kepsek-signature-pad');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                };
                img.src = currentWaliJurnalVerification.ttd;
            }
        }
    }, 100);
}

/**
 * Submit Verifikasi dan Tanda Tangan Digital Kepala Sekolah
 */
export async function submitKepsekVerification() {
    const canvas = document.getElementById('kepsek-signature-pad');
    if (!canvas) return;

    if (isKepsekCanvasBlank(canvas) && (!currentWaliJurnalVerification || !currentWaliJurnalVerification.ttd)) {
        if (typeof window.showToast === 'function') {
            window.showToast('Tanda Tangan Diperlukan', 'Harap bubuhkan tanda tangan digital pada kotak kanvas.', 'warning');
        }
        return;
    }

    const submitBtn = document.getElementById('btn-submit-kepsek-verify');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    }

    try {
        const weekInfo = calculateWeekRange(currentWaliJurnalDate || getLocalISODate());
        const ttdBase64 = isKepsekCanvasBlank(canvas) && currentWaliJurnalVerification?.ttd
            ? currentWaliJurnalVerification.ttd
            : canvas.toDataURL('image/png');

        const catatanInput = document.getElementById('input-kepsek-catatan');
        const catatan = catatanInput ? catatanInput.value.trim() : '';

        const user = (typeof window !== 'undefined' && window.currentUserData) ? window.currentUserData : {};
        const headmasterName = SCHOOL_CONFIG?.headmasterName || "Dr. I Wayan Sudarsana, M.Pd.";
        const headmasterNIP = SCHOOL_CONFIG?.headmasterNIP ? `NIP. ${SCHOOL_CONFIG.headmasterNIP}` : 'NIP. -';

        const tokenRandom = Math.random().toString(36).substring(2, 8).toUpperCase();
        const verifToken = `VERIF-JRN-${String(currentWaliJurnalClass).replace(/[\s\/\\]+/g, '')}-${weekInfo.startDateIso.replace(/-/g, '')}-${tokenRandom}`;

        const payload = {
            kelas: currentWaliJurnalClass,
            startDateIso: weekInfo.startDateIso,
            endDateIso: weekInfo.endDateIso,
            status: 'verified',
            verifiedAt: new Date().toISOString(),
            verifiedByUid: user.uid || 'kepsek',
            verifiedByName: user.name || headmasterName,
            verifiedByNip: user.nip || headmasterNIP,
            ttd: ttdBase64,
            catatan,
            verifToken
        };

        await saveWeeklyJurnalVerification(payload);

        // Kirim Notifikasi Terpadu (Push Notification & Telegram Bot) ke Wali Kelas
        if (cfClient && typeof cfClient.notifyJurnalVerification === 'function') {
            cfClient.notifyJurnalVerification({
                className: currentWaliJurnalClass,
                startDateIso: weekInfo.startDateIso,
                endDateIso: weekInfo.endDateIso,
                weekLabel: weekInfo.fullLabel,
                status: 'verified',
                verifiedByName: payload.verifiedByName,
                catatan: payload.catatan
            }).catch(notifErr => {
                console.warn('[WaliKelasJurnal] Notifikasi pengesahan jurnal error:', notifErr.message);
            });
        }

        if (typeof window.showToast === 'function') {
            window.showToast('Verifikasi Berhasil', `Jurnal mingguan ${currentWaliJurnalClass} berhasil disahkan. Notifikasi (Push & Telegram) telah dikirimkan ke Wali Kelas.`, 'success');
        }

        if (typeof window.closeModal === 'function') {
            window.closeModal('modal-wali-jurnal-verify');
        }

        // Muat ulang tampilan
        await renderWeeklyJurnalTab('tab-content-jurnal', currentWaliJurnalClass, currentWaliJurnalDate, true);
    } catch (err) {
        console.error('[WaliKelasJurnal] Gagal submit verifikasi:', err);
        if (typeof window.showToast === 'function') {
            window.showToast('Gagal Simpan', err.message || 'Terjadi kesalahan saat menyimpan verifikasi.', 'error');
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-check"></i> Sahkan &amp; Simpan Verifikasi';
        }
    }
}

/**
 * Konfirmasi Pembatalan Verifikasi oleh Kepala Sekolah / Admin
 */
export async function cancelKepsekVerificationConfirm() {
    if (!currentWaliJurnalClass || !currentWaliJurnalDate) return;
    const weekInfo = calculateWeekRange(currentWaliJurnalDate);

    const isConfirmed = confirm(`Apakah Anda yakin ingin membatalkan verifikasi & tanda tangan jurnal mingguan kelas ${currentWaliJurnalClass} untuk pekan ${weekInfo.fullLabel}?`);
    if (!isConfirmed) return;

    try {
        await cancelWeeklyJurnalVerification(currentWaliJurnalClass, weekInfo.startDateIso);

        // Kirim Notifikasi Pembatalan ke Wali Kelas
        if (cfClient && typeof cfClient.notifyJurnalVerification === 'function') {
            const user = (typeof window !== 'undefined' && window.currentUserData) ? window.currentUserData : {};
            const headmasterName = SCHOOL_CONFIG?.headmasterName || 'Kepala Sekolah';
            cfClient.notifyJurnalVerification({
                className: currentWaliJurnalClass,
                startDateIso: weekInfo.startDateIso,
                endDateIso: weekInfo.endDateIso,
                weekLabel: weekInfo.fullLabel,
                status: 'cancelled',
                verifiedByName: user.name || headmasterName,
                catatan: ''
            }).catch(notifErr => {
                console.warn('[WaliKelasJurnal] Notifikasi pembatalan verifikasi error:', notifErr.message);
            });
        }

        if (typeof window.showToast === 'function') {
            window.showToast('Verifikasi Dibatalkan', 'Status verifikasi telah di-reset. Notifikasi pembatalan telah dikirimkan ke Wali Kelas.', 'info');
        }
        await renderWeeklyJurnalTab('tab-content-jurnal', currentWaliJurnalClass, currentWaliJurnalDate, true);
    } catch (err) {
        console.error('[WaliKelasJurnal] Gagal batalkan verifikasi:', err);
        if (typeof window.showToast === 'function') {
            window.showToast('Gagal Batalkan', err.message || 'Terjadi kesalahan sistem.', 'error');
        }
    }
}

/**
 * Render 4 Kartu KPI Ringkasan Mingguan
 */
function renderJurnalKpis(jurnalList) {
    const container = document.getElementById('wali-jurnal-kpi-container');
    if (!container) return;

    let totalSlots = (jurnalList || []).length;
    let filledSessions = 0;
    let tidakEfektifCount = 0;
    let guruAbsentCount = 0;
    let totalJp = 0;
    let efektifJp = 0;
    const teachersSet = new Set();
    const mapelSet = new Set();
    let totalS = 0;
    let totalI = 0;
    let totalA = 0;
    let totalD = 0;

    (jurnalList || []).forEach(item => {
        const jpCount = calculateJpCount(item.jp);
        totalJp += jpCount;
        if (item.guru) teachersSet.add(item.guru.trim());
        if (item.mapel) mapelSet.add(item.mapel.trim());

        if (item.is_tidak_efektif) {
            tidakEfektifCount++;
        } else {
            efektifJp += jpCount;
            if (!item.is_unfilled) filledSessions++;
            if (item.is_guru_absent) guruAbsentCount++;
        }

        const parsed = parsePresensiSummary(item.presensi_detail);
        totalS += parsed.s;
        totalI += parsed.i;
        totalA += parsed.a;
        totalD += parsed.d;
    });

    const totalAbsent = totalS + totalI + totalA + totalD;
    const effectiveTotalSlots = Math.max(0, totalSlots - tidakEfektifCount);
    const unfilledCount = Math.max(0, effectiveTotalSlots - filledSessions);

    container.innerHTML = `
        <div class="bg-white dark:bg-slate-800 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs flex items-center justify-between">
            <div>
                <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">KBM Belajar Efektif</p>
                <h4 class="text-base font-black text-slate-800 dark:text-white mt-0.5">${filledSessions} / ${effectiveTotalSlots} <span class="text-xs font-semibold text-slate-400">Pertemuan</span></h4>
                <p class="text-[10px] text-slate-500 dark:text-slate-400 font-medium">${tidakEfektifCount > 0 ? `${tidakEfektifCount} sesi Tidak Belajar Efektif` : (unfilledCount > 0 ? `${unfilledCount} belum terisi` : '100% Terisi Efektif')}</p>
            </div>
            <div class="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs">
                <i class="fa-solid fa-chalkboard-user"></i>
            </div>
        </div>

        <div class="bg-white dark:bg-slate-800 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs flex items-center justify-between">
            <div>
                <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Total Jam Pelajaran</p>
                <h4 class="text-base font-black text-indigo-600 dark:text-indigo-400 mt-0.5">${totalJp} <span class="text-xs font-semibold text-slate-400">JP</span></h4>
                <p class="text-[10px] text-slate-500 dark:text-slate-400 font-medium">${tidakEfektifCount > 0 ? `${efektifJp} JP KBM Efektif` : 'Beban Mengajar Rombel'}</p>
            </div>
            <div class="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs">
                <i class="fa-solid fa-clock"></i>
            </div>
        </div>

        <div class="bg-white dark:bg-slate-800 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs flex items-center justify-between">
            <div>
                <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Guru &amp; Mapel</p>
                <h4 class="text-base font-black text-emerald-600 dark:text-emerald-400 mt-0.5">${teachersSet.size} <span class="text-[10px] font-normal text-slate-400">Guru</span> / ${mapelSet.size} <span class="text-[10px] font-normal text-slate-400">Mapel</span></h4>
                <p class="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Terjadwal di Kelas</p>
            </div>
            <div class="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs">
                <i class="fa-solid fa-graduation-cap"></i>
            </div>
        </div>

        <div class="bg-white dark:bg-slate-800 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs flex items-center justify-between">
            <div>
                <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Rekap Absensi Siswa &amp; Guru</p>
                <h4 class="text-base font-black ${totalAbsent > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-white'} mt-0.5">
                    ${totalAbsent} <span class="text-[9px] font-semibold text-slate-400">S:${totalS} I:${totalI} A:${totalA}</span>
                </h4>
                <p class="text-[10px] ${guruAbsentCount > 0 ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-500 dark:text-slate-400'}">
                    ${guruAbsentCount > 0 ? `${guruAbsentCount} sesi guru tidak hadir` : (tidakEfektifCount > 0 ? `${tidakEfektifCount} sesi non-KBM` : 'Guru hadir lengkap')}
                </p>
            </div>
            <div class="w-7 h-7 rounded-lg ${guruAbsentCount > 0 ? 'bg-rose-50 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400' : 'bg-amber-50 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'} flex items-center justify-center text-xs">
                <i class="fa-solid fa-user-xmark"></i>
            </div>
        </div>
    `;
}

/**
 * Render Tabel Jurnal Mengajar Mingguan (Format Meja Kelas)
 * Menggabungkan sel Hari/Tanggal yang sama menjadi satu sel terpadu (rowspan)
 */
function renderJurnalTable(jurnalList, className, weekInfo) {
    const wrapper = document.getElementById('wali-jurnal-table-wrapper');
    if (!wrapper) return;

    if (!jurnalList || jurnalList.length === 0) {
        wrapper.innerHTML = `
            <div class="p-12 text-center text-slate-400">
                <i class="fa-solid fa-folder-open text-3xl mb-3 text-slate-300 dark:text-slate-600 block"></i>
                <p class="font-bold text-sm text-slate-700 dark:text-slate-200">Belum Ada Jadwal / Jurnal Terdata</p>
                <p class="text-xs text-slate-400 mt-1">
                    Tidak ditemukan data jadwal atau jurnal untuk kelas <strong>${escapeHTML(className)}</strong> pada ${escapeHTML(weekInfo.fullLabel)}.
                </p>
                <div class="mt-3 flex items-center justify-center gap-2">
                    <button type="button" onclick="window.navigateWaliJurnalWeek(-7)" class="px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
                        Cek Pekan Lalu
                    </button>
                    <button type="button" onclick="window.setWaliJurnalCurrentWeek()" class="px-2.5 py-1 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
                        Pekan Ini
                    </button>
                </div>
            </div>
        `;
        return;
    }

    // Hitung jumlah baris per tanggal untuk merge cell (rowspan)
    const countByDate = {};
    (jurnalList || []).forEach(item => {
        const d = item.tanggal || 'unknown';
        countByDate[d] = (countByDate[d] || 0) + 1;
    });

    const renderedDates = new Set();
    let rowsHtml = '';

    jurnalList.forEach((item, idx) => {
        const itemDate = item.tanggal || '';
        const dayName = getIndoDayName(itemDate);
        const jpFormatted = formatJpDisplay(item.jp);
        const presensi = parsePresensiSummary(item.presensi_detail);

        const isFirstForDate = !renderedDates.has(itemDate);
        if (isFirstForDate) {
            renderedDates.add(itemDate);
        }
        const rowSpan = countByDate[itemDate] || 1;

        // TTD / Paraf Guru
        let ttdHtml = '';
        if (item.is_tidak_efektif) {
            ttdHtml = `
                <div class="text-center text-slate-400 dark:text-slate-500 text-[10px] font-mono italic">
                    <i class="fa-solid fa-ban text-xs block mb-0.5 text-slate-400"></i>
                    (Non-KBM)
                </div>
            `;
        } else if (item.is_unfilled) {
            if (item.is_guru_absent) {
                ttdHtml = `
                    <div class="text-center text-rose-500 dark:text-rose-400 text-[10px] font-mono italic">
                        <i class="fa-solid fa-user-xmark text-xs block mb-0.5"></i>
                        (Guru ${escapeHTML(item.guru_presensi_label || 'Absen')})
                    </div>
                `;
            } else {
                ttdHtml = `
                    <div class="text-center text-slate-300 dark:text-slate-600 text-[10px] font-mono italic">
                        <i class="fa-solid fa-ellipsis text-xs block mb-0.5"></i>
                        (Belum TTD)
                    </div>
                `;
            }
        } else if (item.ttd && typeof item.ttd === 'string' && item.ttd.startsWith('data:image/')) {
            ttdHtml = `
                <div class="flex flex-col items-center justify-center">
                    <img src="${escapeHTML(item.ttd)}" alt="Paraf" class="h-7 max-w-[70px] object-contain mix-blend-multiply dark:filter dark:invert dark:opacity-80">
                    <span class="text-[8px] text-slate-400 font-mono mt-0.5">Digital</span>
                </div>
            `;
        } else {
            ttdHtml = `
                <div class="text-center text-slate-400 dark:text-slate-500 text-[10px] italic font-mono">
                    <i class="fa-solid fa-signature text-xs block mb-0.5"></i>
                    (Paraf)
                </div>
            `;
        }

        // Materi Pokok / Uraian KBM
        let materiHtml = '';
        if (item.is_tidak_efektif) {
            materiHtml = `
                <div class="space-y-1">
                    <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-[11px] border border-slate-300 dark:border-slate-600">
                        <i class="fa-solid fa-ban text-[10px] text-amber-500"></i> Tidak Belajar Efektif
                    </div>
                    <div class="font-semibold text-slate-800 dark:text-slate-200 text-xs mt-0.5">
                        ${escapeHTML(item.te_label || item.topik || 'Kegiatan Sekolah')}
                    </div>
                    ${item.te_keterangan ? `
                        <div class="text-[10px] text-slate-500 dark:text-slate-400 italic">${escapeHTML(item.te_keterangan)}</div>
                    ` : ''}
                </div>
            `;
        } else if (item.is_unfilled) {
            if (item.is_guru_absent) {
                materiHtml = `
                    <div class="space-y-1">
                        <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-bold text-[11px] border border-rose-200 dark:border-rose-800">
                            <i class="fa-solid fa-user-xmark text-[10px]"></i> Guru Tidak Hadir (${escapeHTML(item.guru_presensi_label || 'Absen')})
                        </div>
                        <div>
                            ${item.ada_tugas === true ? `
                                <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 text-[10px] font-bold">
                                    <i class="fa-solid fa-file-circle-check text-[9px]"></i> Ada Tugas
                                </span>
                            ` : item.ada_tugas === false ? `
                                <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-medium">
                                    <i class="fa-solid fa-file-excel text-[9px]"></i> Tanpa Tugas
                                </span>
                            ` : `
                                <span class="text-[10px] text-slate-400 italic">-</span>
                            `}
                        </div>
                    </div>
                `;
            } else {
                materiHtml = `
                    <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-semibold text-[11px] border border-amber-200 dark:border-amber-800 italic">
                        <i class="fa-regular fa-clock text-[10px]"></i> Jurnal Belum Diisi Guru
                    </div>
                `;
            }
        } else {
            materiHtml = `<div class="text-slate-700 dark:text-slate-200 font-medium leading-relaxed">${escapeHTML(item.topik || '-')}</div>`;
        }

        // Lokasi / Catatan
        let lokasiDisplay = item.lokasi_mengajar ? `<span class="inline-block text-[10px] text-slate-500 dark:text-slate-400 font-semibold"><i class="fa-solid fa-location-dot text-[9px] mr-1"></i>${escapeHTML(item.lokasi_mengajar)}</span>` : '';
        let catatanDisplay = item.is_tidak_efektif
            ? '<span class="text-[10px] text-slate-400 italic">[Non-KBM Reguler]</span>'
            : (item.catatan ? `<div class="text-[10px] text-slate-600 dark:text-slate-300 italic mt-0.5 leading-snug">"${escapeHTML(item.catatan)}"</div>` : '');

        // Sel Hari / Tgl (hanya pada baris pertama di tanggal tersebut dengan rowspan)
        let dayDateCellHtml = '';
        if (isFirstForDate) {
            dayDateCellHtml = `
                <td rowspan="${rowSpan}" class="p-2.5 align-middle text-center border-r border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 whitespace-nowrap">
                    <div class="font-bold text-slate-800 dark:text-slate-100 text-xs">${escapeHTML(dayName)}</div>
                    <div class="text-[10px] text-slate-400 font-mono mt-0.5">${escapeHTML(formatDateIndo(itemDate))}</div>
                </td>
            `;
        }

        const rowBgClass = item.is_tidak_efektif
            ? 'bg-slate-100/60 dark:bg-slate-800/30'
            : (item.is_unfilled ? 'bg-amber-50/20 dark:bg-amber-950/10' : '');

        const jpBadgeClass = item.is_tidak_efektif
            ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600'
            : (item.is_unfilled ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800' : 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-100 dark:border-indigo-800/60');

        rowsHtml += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition border-b border-slate-200 dark:border-slate-700/80 text-xs ${rowBgClass}">
                <td class="p-2.5 text-center text-slate-400 font-mono text-[11px] align-middle">${idx + 1}</td>
                ${dayDateCellHtml}
                <td class="p-2.5 text-center align-middle whitespace-nowrap">
                    <span class="px-2 py-0.5 rounded-lg ${jpBadgeClass} font-bold font-mono text-[11px] border inline-block">
                        Jam ${escapeHTML(jpFormatted)}
                    </span>
                </td>
                <td class="p-2.5 align-middle">
                    <div class="font-bold text-slate-900 dark:text-white leading-tight">${escapeHTML(item.mapel || '-')}</div>
                </td>
                <td class="p-2.5 align-middle">
                    <div class="font-semibold text-slate-800 dark:text-slate-200 leading-tight">${escapeHTML(item.guru || '-')}</div>
                </td>
                <td class="p-2.5 align-middle min-w-[200px]">
                    ${materiHtml}
                </td>
                <td class="p-2.5 align-middle min-w-[120px]">
                    ${(item.is_unfilled || item.is_tidak_efektif) ? '<span class="text-slate-400 italic text-[11px]">-</span>' : (presensi.hasAbsent ? `
                        <div class="space-y-1">
                            <div>${presensi.groupedHtml}</div>
                            <div class="text-[10px] text-slate-500 dark:text-slate-400 leading-tight font-medium">${escapeHTML(presensi.textSummary)}</div>
                        </div>
                    ` : presensi.groupedHtml)}
                </td>
                <td class="p-2.5 align-middle min-w-[110px]">
                    ${lokasiDisplay}
                    ${catatanDisplay || (!lokasiDisplay ? '<span class="text-slate-400 italic text-[10px]">-</span>' : '')}
                </td>
                <td class="p-2 text-center align-middle whitespace-nowrap">
                    ${ttdHtml}
                </td>
            </tr>
        `;
    });

    wrapper.innerHTML = `
        <table class="w-full text-left text-xs text-slate-700 dark:text-slate-200 border-collapse">
            <thead class="bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                <tr>
                    <th class="p-2.5 text-center w-10">No</th>
                    <th class="p-2.5 text-center w-28">Hari / Tgl</th>
                    <th class="p-2.5 text-center w-20">Jam Ke</th>
                    <th class="p-2.5 w-36">Mata Pelajaran</th>
                    <th class="p-2.5 w-40">Guru Pengampu</th>
                    <th class="p-2.5">Materi Pokok / Kegiatan KBM</th>
                    <th class="p-2.5 w-36">Ketidakhadiran Siswa</th>
                    <th class="p-2.5 w-32">Lokasi / Catatan</th>
                    <th class="p-2 text-center w-20">Paraf Guru</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-200 dark:divide-slate-700/60">
                ${rowsHtml}
            </tbody>
        </table>
    `;
}

/**
 * Pembangun Dokumen Cetak Jurnal Mingguan Versi Meja Kelas Resmi (A4 Landscape)
 */
export async function buildWeeklyJurnalPrintHtml(jurnalList, className, weekInfo, verifData = null) {
    // Ambil data verifikasi jika belum diteruskan
    if (!verifData && className && weekInfo?.startDateIso) {
        try {
            verifData = currentWaliJurnalVerification || await getWeeklyJurnalVerification(className, weekInfo.startDateIso);
        } catch (e) {}
    }
    const isVerified = Boolean(verifData && verifData.status === 'verified');
    // Lookup data Wali Kelas resmi dari SSOT (global.js: resolveFormalTeacherSignatory / getWaliKelasByClass)
    let waliName = `Wali Kelas ${className}`;
    let waliNip = '';

    try {
        if (typeof window.resolveFormalTeacherSignatory === 'function') {
            const sig = await window.resolveFormalTeacherSignatory(className, null);
            if (sig) {
                waliName = sig.name || waliName;
                waliNip = sig.nip || '';
            }
        } else if (typeof window.getWaliKelasByClass === 'function') {
            const w = await window.getWaliKelasByClass(className);
            if (w) {
                waliName = w.name || waliName;
                waliNip = w.nip || '';
            }
        }
    } catch (e) {
        console.warn('[WaliKelasJurnal] Gagal lookup tanda tangan wali:', e);
    }

    const cleanWaliNip = waliNip && waliNip !== '-' && waliNip !== '0'
        ? (waliNip.toUpperCase().startsWith('NIP') ? waliNip : `NIP. ${waliNip}`)
        : '';

    const headmasterName = SCHOOL_CONFIG?.headmasterName || "Dr. I Wayan Sudarsana, M.Pd.";
    const headmasterNIP = SCHOOL_CONFIG?.headmasterNIP ? `NIP. ${SCHOOL_CONFIG.headmasterNIP}` : '';
    const schoolName = SCHOOL_CONFIG?.schoolName || "SMA Negeri Nusantara";
    const schoolAddress = SCHOOL_CONFIG?.schoolAddress || "Jl. Nusantara No. 1, Denpasar";
    const schoolPostal = SCHOOL_CONFIG?.schoolPostalCode ? `Kode Pos ${SCHOOL_CONFIG.schoolPostalCode}` : '';
    const kopUrl = new URL(SCHOOL_CONFIG?.kopPath || 'assets/kop.png', window.location.href).href;

    const printDateFormatted = formatDateIndoFormal(getLocalISODate());

    // Hitung jumlah per tanggal untuk merge cell (rowspan)
    const countByDate = {};
    (jurnalList || []).forEach(item => {
        const d = item.tanggal || 'unknown';
        countByDate[d] = (countByDate[d] || 0) + 1;
    });

    // Hitung agregat mingguan
    let totalSlots = (jurnalList || []).length;
    let filledSessions = 0;
    let tidakEfektifSessions = 0;
    let guruAbsentSessions = 0;
    let totalJp = 0;
    let efektifJp = 0;
    let totalS = 0;
    let totalI = 0;
    let totalA = 0;
    let totalD = 0;

    const renderedDates = new Set();
    let tableRows = '';
    let globalNo = 1;

    (jurnalList || []).forEach((item) => {
        const itemDate = item.tanggal || '';
        const dayName = getIndoDayName(itemDate);
        const jpFormatted = formatJpDisplay(item.jp);
        const jpCount = calculateJpCount(item.jp);
        totalJp += jpCount;

        if (item.is_tidak_efektif) {
            tidakEfektifSessions++;
        } else {
            efektifJp += jpCount;
            if (!item.is_unfilled) filledSessions++;
            if (item.is_guru_absent) guruAbsentSessions++;
        }

        const isFirstForDate = !renderedDates.has(itemDate);
        if (isFirstForDate) {
            renderedDates.add(itemDate);
        }
        const rowSpan = countByDate[itemDate] || 1;

        const presensi = parsePresensiSummary(item.presensi_detail);
        totalS += presensi.s;
        totalI += presensi.i;
        totalA += presensi.a;
        totalD += presensi.d;

        let presensiPrintText = (item.is_unfilled || item.is_tidak_efektif) ? '-' : (presensi.hasAbsent ? presensi.textSummary : 'Nihil');

        // Paraf Cetak
        let ttdPrintHtml = '';
        if (item.is_tidak_efektif) {
            ttdPrintHtml = `<div style="font-size: 7.5pt; font-style: italic; color: #64748b; text-align: center;">(Non-KBM)</div>`;
        } else if (item.is_unfilled) {
            if (item.is_guru_absent) {
                ttdPrintHtml = `<div style="font-size: 7.5pt; font-style: italic; color: #b91c1c; text-align: center; font-weight: bold;">(Guru ${escapeHTML(item.guru_presensi_label || 'Absen')})</div>`;
            } else {
                ttdPrintHtml = `<div style="font-size: 7.5pt; font-style: italic; color: #64748b; text-align: center;">(Belum TTD)</div>`;
            }
        } else if (item.ttd && typeof item.ttd === 'string' && item.ttd.startsWith('data:image/')) {
            ttdPrintHtml = `<img src="${escapeHTML(item.ttd)}" style="max-height: 28px; max-width: 60px; object-fit: contain; margin: 0 auto; display: block;" alt="Paraf">`;
        } else {
            ttdPrintHtml = `<div style="height: 24px; border-bottom: 1px dotted #94a3b8; width: 45px; margin: 0 auto;"></div>`;
        }

        // Materi Pokok / Uraian KBM Cetak
        let materiPrintHtml = '';
        if (item.is_tidak_efektif) {
            materiPrintHtml = `
                <div style="font-weight: bold; color: #475569; font-size: 8.5pt;">
                    [Tidak Belajar Efektif] ${escapeHTML(item.te_label || 'Kegiatan Sekolah')}
                </div>
                <div style="font-size: 7.5pt; color: #64748b; margin-top: 1px;">
                    ${escapeHTML(item.catatan || item.te_keterangan || 'Non-KBM Reguler')}
                </div>
            `;
        } else if (item.is_unfilled) {
            if (item.is_guru_absent) {
                materiPrintHtml = `
                    <div style="font-weight: bold; color: #b91c1c;">Guru Tidak Hadir (${escapeHTML(item.guru_presensi_label || 'Absen')})</div>
                    <div style="font-size: 8pt; margin-top: 2px; color: #1e293b;">Penugasan: <strong>${escapeHTML(item.ada_tugas_label || (item.ada_tugas === true ? 'Ada Tugas' : (item.ada_tugas === false ? 'Tanpa Tugas' : '-')))}</strong></div>
                `;
            } else {
                materiPrintHtml = `<div style="font-style: italic; color: #64748b;">[Jurnal Belum Diisi Guru]</div>`;
            }
        } else {
            materiPrintHtml = escapeHTML(item.topik || '-');
        }

        const lokasi = item.lokasi_mengajar ? `[${escapeHTML(item.lokasi_mengajar)}] ` : '';
        const catatan = item.is_tidak_efektif ? '[Non-KBM Reguler]' : (item.catatan ? escapeHTML(item.catatan) : '');
        const catatanFull = (lokasi || catatan) ? `${lokasi}${catatan}` : '-';

        let dayDateCellHtml = '';
        if (isFirstForDate) {
            dayDateCellHtml = `
                <td rowspan="${rowSpan}" style="text-align: center; vertical-align: middle; white-space: nowrap; background-color: #fafafa;">
                    <strong style="font-size: 9pt;">${escapeHTML(dayName)}</strong><br>
                    <span style="font-size: 7.5pt; color: #334155;">${escapeHTML(formatDateIndo(itemDate))}</span>
                </td>
            `;
        }

        tableRows += `
            <tr ${item.is_tidak_efektif ? 'style="background-color: #f8fafc;"' : ''}>
                <td style="text-align: center; font-family: monospace; vertical-align: middle;">${globalNo++}</td>
                ${dayDateCellHtml}
                <td style="text-align: center; white-space: nowrap; font-weight: bold; vertical-align: middle;">${escapeHTML(jpFormatted)}</td>
                <td style="vertical-align: middle;"><strong>${escapeHTML(item.mapel || '-')}</strong></td>
                <td style="vertical-align: middle;">${escapeHTML(item.guru || '-')}</td>
                <td style="text-align: justify; vertical-align: top;">${materiPrintHtml}</td>
                <td style="font-size: 8.5pt; vertical-align: middle;">${escapeHTML(presensiPrintText)}</td>
                <td style="font-size: 8pt; color: #1e293b; vertical-align: middle;">${catatanFull}</td>
                <td style="text-align: center; vertical-align: middle;">${ttdPrintHtml}</td>
            </tr>
        `;
    });

    if (!tableRows) {
        tableRows = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 25px; font-style: italic; color: #64748b;">
                    - Tidak ada catatan jadwal ataupun jurnal mengajar pada pekan ini -
                </td>
            </tr>
        `;
    }

    const totalAbsent = totalS + totalI + totalA + totalD;

    return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <title>Jurnal Mengajar Kelas ${escapeHTML(className)} - ${escapeHTML(weekInfo.rangeLabel)}</title>
    <style>
        @page {
            size: A4 landscape;
            margin: 8mm 10mm;
        }
        * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }
        body {
            font-family: 'Times New Roman', Times, serif;
            font-size: 9pt;
            color: #000;
            background: #fff;
            margin: 0;
            padding: 0;
            line-height: 1.25;
        }
        .kop-wrapper {
            width: 100%;
            margin-bottom: 8px;
            border-bottom: 2px solid #000;
            padding-bottom: 4px;
        }
        .kop-img {
            width: 100%;
            max-height: 90px;
            object-fit: contain;
            display: block;
            margin: 0 auto;
        }
        .kop-fallback {
            display: none;
            text-align: center;
        }
        .kop-fallback h2 {
            margin: 0;
            font-size: 10pt;
            font-weight: bold;
            text-transform: uppercase;
        }
        .kop-fallback h1 {
            margin: 1px 0;
            font-size: 15pt;
            font-weight: bold;
            text-transform: uppercase;
        }
        .kop-fallback p {
            margin: 0;
            font-size: 8pt;
        }
        .doc-title {
            text-align: center;
            margin: 6px 0 8px;
        }
        .doc-title h3 {
            margin: 0;
            font-size: 12pt;
            font-weight: bold;
            text-transform: uppercase;
            text-decoration: underline;
        }
        .doc-title p {
            margin: 2px 0 0;
            font-size: 9pt;
            font-weight: bold;
        }
        .meta-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 6px;
            font-size: 9pt;
            font-weight: bold;
        }
        .meta-table td {
            border: none;
            padding: 1px 4px;
            vertical-align: top;
        }
        .jurnal-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 8px;
        }
        .jurnal-table th, .jurnal-table td {
            border: 1px solid #000;
            padding: 4px 5px;
            vertical-align: top;
        }
        .jurnal-table th {
            background-color: #f1f5f9;
            text-align: center;
            font-size: 8.5pt;
            font-weight: bold;
            text-transform: uppercase;
        }
        .summary-box {
            border: 1px solid #000;
            padding: 4px 8px;
            font-size: 8.5pt;
            margin-bottom: 12px;
            background-color: #f8fafc;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .signature-container {
            width: 100%;
            margin-top: 8px;
            page-break-inside: avoid;
        }
        .sig-table {
            width: 100%;
            border-collapse: collapse;
            border: none;
        }
        .sig-table td {
            border: none;
            text-align: center;
            vertical-align: top;
            width: 50%;
            font-size: 9pt;
        }
        .sig-space {
            height: 52px;
        }
        .sig-name {
            font-weight: bold;
            text-decoration: underline;
        }
    </style>
</head>
<body onload="window.print()">

    <!-- KOP RESMI SEKOLAH -->
    <div class="kop-wrapper">
        <img src="${escapeHTML(kopUrl)}" alt="Kop Sekolah" class="kop-img" onerror="this.style.display='none'; document.getElementById('kop-fb').style.display='block';">
        <div id="kop-fb" class="kop-fallback">
            <h2>Pemerintah Provinsi Bali - Dinas Pendidikan Kepemudaan dan Olahraga</h2>
            <h1>${escapeHTML(schoolName)}</h1>
            <p>${escapeHTML(schoolAddress)} ${escapeHTML(schoolPostal)}</p>
            <p>Website: ${escapeHTML(SCHOOL_CONFIG?.schoolWebsite || "https://simas-demo-5ead3.web.app")} • Email: ${escapeHTML(SCHOOL_CONFIG?.emailDomain || "info@smanusantara.sch.id")}</p>
        </div>
    </div>

    <!-- JUDUL DOKUMEN -->
    <div class="doc-title">
        <h3>Jurnal Pembelajaran &amp; Agenda Kelas Mingguan</h3>
        <p>Tahun Pelajaran 2026/2027</p>
    </div>

    <!-- METADATA KELAS -->
    <table class="meta-table">
        <tr>
            <td style="width: 12%;">Kelas / Rombel</td>
            <td style="width: 2%;">:</td>
            <td style="width: 36%;"><strong>${escapeHTML(className)}</strong></td>
            <td style="width: 15%;">Periode Pekan</td>
            <td style="width: 2%;">:</td>
            <td style="width: 33%;">${escapeHTML(weekInfo.fullLabel)}</td>
        </tr>
        <tr>
            <td>Wali Kelas</td>
            <td>:</td>
            <td>${escapeHTML(waliName)} ${cleanWaliNip ? `(${escapeHTML(cleanWaliNip)})` : ''}</td>
            <td>Hari Belajar</td>
            <td>:</td>
            <td>Senin, ${escapeHTML(formatDateIndo(weekInfo.startDateIso))} s.d. Jumat, ${escapeHTML(formatDateIndo(weekInfo.endDateIso))}</td>
        </tr>
    </table>

    <!-- TABEL JURNAL KELAS FISIK (MERGED HARI & TANGGAL) -->
    <table class="jurnal-table">
        <thead>
            <tr>
                <th style="width: 26px;">No</th>
                <th style="width: 80px;">Hari / Tgl</th>
                <th style="width: 44px;">Jam Ke</th>
                <th style="width: 110px;">Mata Pelajaran</th>
                <th style="width: 130px;">Guru Pengampu</th>
                <th>Materi Pokok / Uraian Kegiatan Pembelajaran</th>
                <th style="width: 135px;">Ketidakhadiran Siswa</th>
                <th style="width: 105px;">Lokasi / Catatan</th>
                <th style="width: 65px;">Paraf Guru</th>
            </tr>
        </thead>
        <tbody>
            ${tableRows}
        </tbody>
    </table>

    <!-- REKAPITULASI MINGGUAN -->
    <div class="summary-box">
        <div>
            <strong>Rekapitulasi KBM:</strong> Terlaksana <strong>${filledSessions}</strong> dari <strong>${Math.max(0, totalSlots - tidakEfektifSessions)}</strong> Sesi Belajar Efektif (${totalJp} Jam Pelajaran / JP).
            ${tidakEfektifSessions > 0 ? `| <strong style="color: #475569;">Tidak Belajar Efektif: ${tidakEfektifSessions} Sesi</strong>` : ''}
            ${guruAbsentSessions > 0 ? `| <strong style="color: #b91c1c;">Ketidakhadiran Guru: ${guruAbsentSessions} Sesi</strong>` : ''}
        </div>
        <div>
            <strong>Ketidakhadiran Siswa Pekan Ini:</strong> 
            Sakit (S): <strong>${totalS}</strong> | 
            Izin (I): <strong>${totalI}</strong> | 
            Alpa (A): <strong>${totalA}</strong> | 
            Dispensasi (D): <strong>${totalD}</strong> 
            (Total Absen: <strong>${totalAbsent}</strong>)
        </div>
    </div>

    <!-- CATATAN / ARAHAN KEPALA SEKOLAH (JIKA SUDAH DIVERIFIKASI & ADA CATATAN) -->
    ${(isVerified && verifData.catatan) ? `
    <div style="border: 1px dashed #047857; padding: 5px 8px; font-size: 8.5pt; margin-bottom: 8px; background-color: #f0fdf4; border-radius: 4px;">
        <strong style="color: #065f46;">Catatan / Arahan Kepala Sekolah:</strong> <em>"${escapeHTML(verifData.catatan)}"</em>
    </div>
    ` : ''}

    <!-- TANDA TANGAN PENGESAHAN DUA KOLOM: KEPALA SEKOLAH (KIRI), WALI KELAS (KANAN) -->
    <div class="signature-container">
        <table class="sig-table">
            <tr>
                <td>
                    Mengetahui,<br>
                    Kepala ${escapeHTML(schoolName)}
                    <div class="sig-space" style="height: 52px; display: flex; align-items: center; justify-content: center;">
                        ${(isVerified && verifData.ttd) ? `
                            <img src="${escapeHTML(verifData.ttd)}" alt="TTD Kepala Sekolah" style="max-height: 50px; max-width: 140px; object-fit: contain; margin: 0 auto; display: block;">
                        ` : ''}
                    </div>
                    <div class="sig-name">${escapeHTML(headmasterName)}</div>
                    <div>${escapeHTML(headmasterNIP)}</div>
                    ${isVerified ? `
                        <div style="font-size: 6.5pt; color: #047857; font-weight: bold; margin-top: 1px;">
                            ✓ Disahkan Digital SIMAS (${escapeHTML(verifData.verifToken || formatDateIndo(verifData.verifiedAt))})
                        </div>
                    ` : ''}
                </td>
                <td>
                    Denpasar, ${escapeHTML(printDateFormatted)}<br>
                    Wali Kelas ${escapeHTML(className)}
                    <div class="sig-space"></div>
                    <div class="sig-name">${escapeHTML(waliName)}</div>
                    <div>${cleanWaliNip ? escapeHTML(cleanWaliNip) : 'NIP. -'}</div>
                </td>
            </tr>
        </table>
    </div>

</body>
</html>`;
}

/**
 * Pemicu Pencetakan Dokumen Jurnal Mingguan
 */
export async function printWeeklyJurnal() {
    if (!currentWaliJurnalClass) {
        if (typeof window.showToast === 'function') {
            window.showToast('Peringatan', 'Silakan pilih rombel terlebih dahulu sebelum mencetak.', 'warning');
        }
        return;
    }

    const weekInfo = calculateWeekRange(currentWaliJurnalDate || getLocalISODate());
    if (!currentWaliJurnalVerification) {
        try {
            currentWaliJurnalVerification = await getWeeklyJurnalVerification(currentWaliJurnalClass, weekInfo.startDateIso);
        } catch (e) {}
    }
    const fullHtml = await buildWeeklyJurnalPrintHtml(currentWaliJurnalData, currentWaliJurnalClass, weekInfo, currentWaliJurnalVerification);

    const printWin = window.open('', '_blank');
    if (!printWin) {
        if (typeof window.showToast === 'function') {
            window.showToast('Pop-up Terblokir', 'Harap izinkan pop-up peramban untuk mencetak jurnal mingguan.', 'warning');
        }
        return;
    }
    printWin.document.write(fullHtml);
    printWin.document.close();
}

/**
 * Handler Perubahan Tanggal Jurnal
 */
export function onWaliJurnalDateChange(newDate) {
    if (!newDate) return;
    currentWaliJurnalDate = newDate;
    renderWeeklyJurnalTab('tab-content-jurnal', currentWaliJurnalClass, currentWaliJurnalDate, false);
}

/**
 * Handler Navigasi Pekan (+7 atau -7 hari)
 */
export function navigateWaliJurnalWeek(offsetDays) {
    const baseDate = currentWaliJurnalDate || getLocalISODate();
    const [y, m, d] = baseDate.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d, 12, 0, 0);
    dateObj.setDate(dateObj.getDate() + offsetDays);

    const nextY = dateObj.getFullYear();
    const nextM = String(dateObj.getMonth() + 1).padStart(2, '0');
    const nextD = String(dateObj.getDate()).padStart(2, '0');

    currentWaliJurnalDate = `${nextY}-${nextM}-${nextD}`;
    renderWeeklyJurnalTab('tab-content-jurnal', currentWaliJurnalClass, currentWaliJurnalDate, false);
}

/**
 * Handler Reset ke Pekan Ini
 */
export function setWaliJurnalCurrentWeek() {
    currentWaliJurnalDate = getLocalISODate();
    renderWeeklyJurnalTab('tab-content-jurnal', currentWaliJurnalClass, currentWaliJurnalDate, false);
}

// Global window bindings untuk event inline onclick/onchange HTML
if (typeof window !== 'undefined') {
    window.renderWeeklyJurnalTab = renderWeeklyJurnalTab;
    window.loadWaliJurnalMingguan = (force = false) => renderWeeklyJurnalTab('tab-content-jurnal', currentWaliJurnalClass, currentWaliJurnalDate, force);
    window.printWeeklyJurnal = printWeeklyJurnal;
    window.onWaliJurnalDateChange = onWaliJurnalDateChange;
    window.navigateWaliJurnalWeek = navigateWaliJurnalWeek;
    window.setWaliJurnalCurrentWeek = setWaliJurnalCurrentWeek;
    window.openWaliJurnalVerifyModal = openWaliJurnalVerifyModal;
    window.submitKepsekVerification = submitKepsekVerification;
    window.clearKepsekCanvas = clearKepsekCanvas;
    window.cancelKepsekVerificationConfirm = cancelKepsekVerificationConfirm;
}
