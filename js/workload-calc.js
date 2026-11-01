/**
 * js/workload-calc.js
 * ====================================================================
 * Calculation Engine & Rule Validator SSOT: Modul Beban Kerja Guru
 * Sesuai: Permendikdasmen No. 11/2025 & Kebijakan Jam Kerja SMAGESA
 * ====================================================================
 * 
 * Standar:
 * - Pure functions, 100% deterministic, 0 side-effect
 * - Dual environment: Node.js (Jest) & Browser ES Module
 * - Format durasi integer menit (bukan float desimal)
 * - Pemisahan tegas: Durasi Nyata (Menit), Tatap Muka (JP), dan Ekuivalensi (JP-Eq)
 */

// Konfigurasi Standar Sekolah SMAGESA (SSOT)
export const DEFAULT_WORKLOAD_POLICY = Object.freeze({
    workDaysCount: 5,
    normalDailyMinutes: 450,    // 7 jam 30 menit per hari
    normalWeeklyMinutes: 2250,  // 37 jam 30 menit per minggu
    workStartTime: '07:30',
    workEndTime: '15:30',
    jpDurationMinutes: 45,      // Profil SMA = 45 menit / JP
    minTeachingJp: 24,          // Minimal tatap muka guru mapel
    maxTeachingJp: 40,          // Maksimal tatap muka guru mapel
    minBkRombel: 5,             // Minimal rombel asuh guru BK per tahun (Pasal 13 ayat 2)
    breaks: Object.freeze([
        { name: 'Istirahat', start: '09:45', end: '10:00', minutes: 15 },
        { name: 'Istirahat', start: '12:15', end: '12:30', minutes: 15 }
    ])
});

/**
 * Konversi string waktu "HH:MM" menjadi integer menit dari 00:00
 * @param {string} timeStr - Contoh "07:30"
 * @returns {number}
 */
export function timeStringToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const parts = timeStr.trim().split(':');
    if (parts.length < 2) return 0;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return 0;
    return Math.max(0, Math.min(1439, h * 60 + m));
}

/**
 * Konversi integer menit menjadi string format "HH:MM"
 * @param {number} totalMinutes
 * @returns {string}
 */
export function minutesToTimeString(totalMinutes) {
    if (typeof totalMinutes !== 'number' || isNaN(totalMinutes) || totalMinutes < 0) return '00:00';
    const clean = Math.floor(totalMinutes);
    const h = Math.floor(clean / 60) % 24;
    const m = clean % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Deteksi realisasi yang jamnya bergeser/melebar dari slot rencananya (mis. rencana Jumat diganti
 * rapat mendadak 12:30–15:30) beserta slot rencana lain yang beririsan dengan realisasi tersebut.
 * Dipakai matriks realisasi agar bar realisasi digambar sesuai jam aktual, sedangkan rencana yang
 * tertimpa dipindah ke lajur tipis di bawahnya.
 *
 * Realisasi yang dimulai tepat di awal slot dan tidak melewati akhir slot dianggap penuh/parsial
 * biasa (tidak bergeser). Slot yang sudah memiliki realisasi aktif sendiri tidak ditandai beririsan.
 *
 * @param {Array} slots - Hasil calculateDayTimelineSlots().slots
 * @param {Array} dayLogs - Log realisasi pada hari tersebut
 * @param {Array} dayLogSegs - Segmen jam log realisasi pada hari tersebut
 * @param {Array} planLinks - Tautan rencana ↔ log
 * @returns {{shifted: Map<string, {logId: string, title: string, startMin: number, endMin: number}>,
 *            overlapped: Map<string, {logId: string, title: string, startMin: number, endMin: number, isOwn: boolean}>}}
 *          Kunci kedua Map adalah activity_id slot rencana.
 */
export function detectShiftedRealizations(slots = [], dayLogs = [], dayLogSegs = [], planLinks = []) {
    const shifted = new Map();
    const overlapped = new Map();
    const inactiveStatuses = new Set(['draft', 'tidak_terlaksana']);
    const activitySlots = (slots || []).filter(s => s?.type === 'activity' && s.segment?.activity_id);
    const findLinkedLog = (activityId) => (dayLogs || []).find(l =>
        (planLinks || []).some(pl => pl.plan_activity_id === activityId && pl.work_log_id === l.id)
    ) || null;

    // Hitung rentang rencana penuh per activityId (mengatasi pecahan slot akibat jeda istirahat resmi)
    const planRangesByActivity = new Map();
    activitySlots.forEach(slot => {
        const actId = slot.segment.activity_id;
        const segStart = slot.segment.start_time ? timeStringToMinutes(slot.segment.start_time) : null;
        const segEnd = slot.segment.end_time ? timeStringToMinutes(slot.segment.end_time) : null;
        const slotStart = timeStringToMinutes(slot.startTime);
        const slotEnd = timeStringToMinutes(slot.endTime);

        const current = planRangesByActivity.get(actId) || {
            planStart: segStart !== null ? segStart : slotStart,
            planEnd: segEnd !== null ? segEnd : slotEnd
        };

        const effStart = segStart !== null ? Math.min(current.planStart, segStart, slotStart) : Math.min(current.planStart, slotStart);
        const effEnd = segEnd !== null ? Math.max(current.planEnd, segEnd, slotEnd) : Math.max(current.planEnd, slotEnd);

        planRangesByActivity.set(actId, { planStart: effStart, planEnd: effEnd });
    });

    const evaluatedActivities = new Set();
    activitySlots.forEach(slot => {
        const activityId = slot.segment.activity_id;
        if (evaluatedActivities.has(activityId)) return;
        evaluatedActivities.add(activityId);

        const log = findLinkedLog(activityId);
        if (!log || inactiveStatuses.has(log.status_execution)) return;

        const segs = (dayLogSegs || []).filter(ls => ls.work_log_id === log.id && ls.start_time && ls.end_time);
        if (segs.length === 0) return;

        const startMin = Math.min(...segs.map(ls => timeStringToMinutes(ls.start_time)));
        const endMin = Math.max(...segs.map(ls => timeStringToMinutes(ls.end_time)));
        if (endMin <= startMin) return;

        const planRange = planRangesByActivity.get(activityId) || {
            planStart: timeStringToMinutes(slot.startTime),
            planEnd: timeStringToMinutes(slot.endTime)
        };

        // Jika realisasi berada persis di awal rencana dan berakhir di dalam/sesuai rentang rencana penuh
        // (termasuk kegiatan multi-JP yang melintasi jeda istirahat), kegiatan TIDAK dianggap bergeser.
        if (startMin === planRange.planStart && endMin <= planRange.planEnd) return;

        shifted.set(activityId, { logId: log.id, title: log.title || '', startMin, endMin });
    });

    if (shifted.size === 0) return { shifted, overlapped };

    activitySlots.forEach(slot => {
        const activityId = slot.segment.activity_id;
        const own = shifted.get(activityId);
        if (own) {
            overlapped.set(activityId, { ...own, isOwn: true });
            return;
        }

        const log = findLinkedLog(activityId);
        if (log && !inactiveStatuses.has(log.status_execution)) return;

        const slotStart = timeStringToMinutes(slot.startTime);
        const slotEnd = timeStringToMinutes(slot.endTime);
        for (const real of shifted.values()) {
            if (Math.max(real.startMin, slotStart) < Math.min(real.endMin, slotEnd)) {
                overlapped.set(activityId, { ...real, isOwn: false });
                break;
            }
        }
    });

    return { shifted, overlapped };
}

/**
 * Kurangi rentang [startMin, endMin) dengan sekumpulan rentang lain.
 * @param {number} startMin
 * @param {number} endMin
 * @param {Array<{startMin: number, endMin: number}>} ranges
 * @returns {Array<{startMin: number, endMin: number}>} Potongan yang tidak tertutup, urut waktu
 */
export function subtractTimeRanges(startMin, endMin, ranges = []) {
    let pieces = [{ startMin, endMin }];
    (ranges || []).forEach(r => {
        pieces = pieces.flatMap(p => {
            if (r.endMin <= p.startMin || r.startMin >= p.endMin) return [p];
            const out = [];
            if (r.startMin > p.startMin) out.push({ startMin: p.startMin, endMin: r.startMin });
            if (r.endMin < p.endMin) out.push({ startMin: r.endMin, endMin: p.endMin });
            return out;
        });
    });
    return pieces.filter(p => p.endMin > p.startMin);
}

/**
 * Format representasi durasi ramah pengguna (contoh: "7j 30m" atau "45m")
 * @param {number} minutes
 * @returns {string}
 */
export function formatDurationDisplay(minutes) {
    if (typeof minutes !== 'number' || isNaN(minutes) || minutes <= 0) return '0m';
    const clean = Math.floor(minutes);
    const hours = Math.floor(clean / 60);
    const mins = clean % 60;
    if (hours > 0 && mins > 0) return `${hours}j ${mins}m`;
    if (hours > 0) return `${hours}j`;
    return `${mins}m`;
}

/**
 * Hitung durasi kerja efektif (menit) dari interval [start_time, end_time)
 * dengan pemotongan interval istirahat resmi sekolah secara presisi
 * 
 * @param {string} startTime - Jam mulai "HH:MM"
 * @param {string} endTime - Jam selesai "HH:MM"
 * @param {Array} [breaks] - Array objek { start, end }
 * @param {string} [workStart='07:30'] - Batas awal jam operasional
 * @param {string} [workEnd='15:30'] - Batas akhir jam operasional
 * @returns {number} Durasi efektif dalam integer menit
 */
export function calculateEffectiveMinutes(
    startTime,
    endTime,
    breaks = DEFAULT_WORKLOAD_POLICY.breaks,
    workStart = DEFAULT_WORKLOAD_POLICY.workStartTime,
    workEnd = DEFAULT_WORKLOAD_POLICY.workEndTime
) {
    if (!startTime || !endTime) return 0;

    let startMin = timeStringToMinutes(startTime);
    let endMin = timeStringToMinutes(endTime);

    if (startMin >= endMin) return 0;

    // Optional clamping jika aktivitas di luar jam operasional resmi
    const limitStart = timeStringToMinutes(workStart);
    const limitEnd = timeStringToMinutes(workEnd);

    // Hitung span dasar
    let effective = endMin - startMin;

    // Kurangi setiap interval istirahat yang beririsan
    if (Array.isArray(breaks) && breaks.length > 0) {
        for (const b of breaks) {
            const bStart = timeStringToMinutes(b.start);
            const bEnd = timeStringToMinutes(b.end);
            if (bStart < bEnd) {
                // Cari irisan [startMin, endMin) dengan [bStart, bEnd)
                const overlapStart = Math.max(startMin, bStart);
                const overlapEnd = Math.min(endMin, bEnd);
                if (overlapStart < overlapEnd) {
                    effective -= (overlapEnd - overlapStart);
                }
            }
        }
    }

    return Math.max(0, effective);
}

/**
 * Memeriksa apakah suatu interval waktu target beririsan dengan daftar segmen yang sudah ada
 * Formula matematis irisan: Math.max(start1, start2) < Math.min(end1, end2)
 *
 * @param {{start_time: string, end_time: string, title?: string}} targetSegment
 * @param {Array<{start_time: string, end_time: string, id?: string, activity_id?: string, work_log_id?: string, activity_title?: string, title?: string, description?: string}>} existingSegments
 * @param {string|null} excludeId - ID segmen yang dikecualikan (misal saat edit diri sendiri)
 * @returns {{hasOverlap: boolean, conflictingSegment?: object, message?: string}}
 */
export function findTimeOverlap(targetSegment, existingSegments = [], excludeId = null) {
    if (!targetSegment?.start_time || !targetSegment?.end_time) return { hasOverlap: false };
    const tStart = timeStringToMinutes(targetSegment.start_time);
    const tEnd = timeStringToMinutes(targetSegment.end_time);
    if (tStart >= tEnd) return { hasOverlap: false };

    for (const seg of existingSegments) {
        if (!seg || !seg.start_time || !seg.end_time) continue;
        if (excludeId && (seg.id === excludeId || seg.activity_id === excludeId || seg.work_log_id === excludeId)) continue;
        const sStart = timeStringToMinutes(seg.start_time);
        const sEnd = timeStringToMinutes(seg.end_time);
        if (sStart >= sEnd) continue;

        // Formula matematis irisan: max(start1, start2) < min(end1, end2)
        if (Math.max(tStart, sStart) < Math.min(tEnd, sEnd)) {
            const segTitle = seg.activity_title || seg.title || seg.description || 'Kegiatan Lain';
            return {
                hasOverlap: true,
                conflictingSegment: seg,
                message: `Benturan jam kerja terdeteksi: waktu ${targetSegment.start_time}–${targetSegment.end_time} beririsan dengan "${segTitle}" (${seg.start_time}–${seg.end_time}).`
            };
        }
    }
    return { hasOverlap: false };
}

/**
 * Validasi apakah kumpulan slot waktu pada hari yang sama bebas benturan (no-overlap)
 * Interval bersebelahan (contoh: 07:30-08:15 dan 08:15-09:00) adalah VALID.
 * 
 * @param {Array<{start_time: string, end_time: string, id?: string, title?: string, activity_title?: string}>} segments
 * @returns {{isValid: boolean, conflictMessage?: string, conflictingPair?: Array}}
 */
export function validateNoOverlap(segments) {
    if (!Array.isArray(segments) || segments.length <= 1) {
        return { isValid: true };
    }

    // Normalisasi segmen yang valid
    const parsed = segments.map((s, idx) => ({
        index: idx,
        id: s.id || `item_${idx}`,
        start: timeStringToMinutes(s.start_time),
        end: timeStringToMinutes(s.end_time),
        rawStart: s.start_time,
        rawEnd: s.end_time,
        title: s.activity_title || s.title || s.description || `Item #${idx + 1}`
    })).filter(s => s.start < s.end);

    for (let i = 0; i < parsed.length; i++) {
        for (let j = i + 1; j < parsed.length; j++) {
            const a = parsed[i];
            const b = parsed[j];
            if (Math.max(a.start, b.start) < Math.min(a.end, b.end)) {
                const isIdentical = a.title === b.title && a.start === b.start && a.end === b.end;
                return {
                    isValid: false,
                    conflictMessage: isIdentical
                        ? `Kegiatan kembar/duplikat "${a.title}" (${a.rawStart} - ${a.rawEnd})`
                        : `Benturan waktu antara "${a.title}" (${a.rawStart} - ${a.rawEnd}) dengan "${b.title}" (${b.rawStart} - ${b.rawEnd})`,
                    conflictingPair: [a, b]
                };
            }
        }
    }

    return { isValid: true };
}

/**
 * Evaluasi kepatuhan beban kerja guru & ekuivalensi sesuai Permendikdasmen No. 11/2025
 * 
 * Aturan Kunci:
 * 1. Guru Mapel: Beban tatap muka minimal 24 JP, maksimal 40 JP per minggu.
 * 2. Guru BK: Membimbing minimal 5 rombongan belajar per tahun (Pasal 13 ayat 2).
 * 3. Ekuivalensi tugas tambahan (Wakasek=12, Kalab=12, Kapus=12, Wali=2, OSIS=2, Piket=1, GuruWali=2).
 * 4. Pembatasan Pasal 17: Ekuivalensi HANYA diakui untuk menutup kekurangan JP menuju 24 JP.
 *    Jika tatap muka >= 24 JP, recognized_ekuivalensi_jp = 0.
 * 5. Ekuivalensi TIDAK DITAMBAHKAN ke menit kerja nyata.
 * 
 * @param {object} params
 * @param {string} params.jenisPtk - 'Guru Mapel' | 'Guru BK' | 'Pendidik'
 * @param {number} params.teachingJp - Jumlah JP tatap muka riil terjadwal
 * @param {number} params.bkRombelCount - Jumlah rombel asuh guru BK (tahunan)
 * @param {Array<object>} params.assignments - Daftar SK penugasan aktif
 * @returns {object} Hasil evaluasi kepatuhan
 */
export function evaluateWorkloadRules({
    jenisPtk = 'Guru Mapel',
    teachingJp = 0,
    bkRombelCount = 0,
    assignments = []
}) {
    const isBk = String(jenisPtk).toLowerCase().includes('bk') || String(jenisPtk).toLowerCase().includes('konseling');
    const safeTeachingJp = Math.max(0, parseInt(teachingJp, 10) || 0);
    const safeBkRombel = Math.max(0, parseInt(bkRombelCount, 10) || 0);

    const result = {
        isBk,
        teachingJp: safeTeachingJp,
        bkRombelCount: safeBkRombel,
        recognizedEquivalencyJp: 0,
        totalAdministrativeJp: safeTeachingJp,
        isTeachingFulfill: false,
        teachingStatusText: '',
        breakdownAssignments: [],
        notes: []
    };

    // 1. Jalur Guru BK (Pasal 13 ayat 2)
    if (isBk) {
        result.isTeachingFulfill = safeBkRombel >= DEFAULT_WORKLOAD_POLICY.minBkRombel;
        result.teachingStatusText = result.isTeachingFulfill
            ? `Memenuhi (Membimbing ${safeBkRombel} rombel / min. 5 rombel per tahun - Pasal 13 ayat 2)`
            : `Belum Memenuhi (Membimbing ${safeBkRombel} rombel, kurang ${DEFAULT_WORKLOAD_POLICY.minBkRombel - safeBkRombel} rombel)`;
        result.recognizedEquivalencyJp = 0;
        result.totalAdministrativeJp = safeTeachingJp;
        return result;
    }

    // 2. Jalur Guru Mapel: Evaluasi Tugas Tambahan & Ekuivalensi (Lampiran Permendikdasmen 11/2025)
    let totalEligibleEquivalency = 0;

    const recognizedAssignmentTypes = {
        'wakasek': { jp: 12, title: 'Wakil Kepala Sekolah', maxCumulative: 1 },
        'kepala_lab': { jp: 12, title: 'Kepala Laboratorium', maxCumulative: 1 },
        'kepala_perpus': { jp: 12, title: 'Kepala Perpustakaan', maxCumulative: 1 },
        'wali_kelas': { jp: 2, title: 'Wali Kelas', maxCumulative: 1 },
        'pembina_osis': { jp: 2, title: 'Pembina OSIS', maxCumulative: 1 }, // Koreksi: 2 JP Lampiran b.5
        'guru_wali': { jp: 2, title: 'Guru Wali', maxCumulative: 1 },       // 2 JP dengan batasan Pasal 17
        'guru_piket': { jp: 1, title: 'Guru Piket', maxCumulative: 1 },
        'koordinator_pkb': { jp: 2, title: 'Koordinator PKB', maxCumulative: 1 }
    };

    if (Array.isArray(assignments)) {
        for (const asg of assignments) {
            const type = String(asg.assignment_type || asg.type || '').toLowerCase().trim();
            const config = recognizedAssignmentTypes[type];

            if (config && asg.status === 'active' && asg.verification_status === 'verified') {
                totalEligibleEquivalency += config.jp;
                result.breakdownAssignments.push({
                    type,
                    title: asg.title || config.title,
                    offeredJp: config.jp,
                    isRecognized: true,
                    status: 'Terverifikasi'
                });
            } else if (asg.status === 'active') {
                result.breakdownAssignments.push({
                    type,
                    title: asg.title || type,
                    offeredJp: 0,
                    isRecognized: false,
                    status: asg.verification_status === 'verified' ? 'Tidak Ada Dasar Ekuivalensi Nasional (0 JP)' : 'Belum Dapat Diverifikasi (Perlu SK Sah)'
                });
            }
        }
    }

    // 3. Pembatasan Penggabungan Sesuai Pasal 17 Permendikdasmen 11/2025
    // Ekuivalensi hanya diakui untuk menutup kekurangan jam tatap muka menuju batas minimal 24 JP
    const deficitTo24 = Math.max(0, DEFAULT_WORKLOAD_POLICY.minTeachingJp - safeTeachingJp);

    if (deficitTo24 === 0) {
        // Guru sudah mengajar >= 24 JP tatap muka: tidak perlu ekuivalensi
        result.recognizedEquivalencyJp = 0;
        result.totalAdministrativeJp = safeTeachingJp;
        result.isTeachingFulfill = safeTeachingJp <= DEFAULT_WORKLOAD_POLICY.maxTeachingJp;
        result.teachingStatusText = `Memenuhi Beban Tatap Muka (${safeTeachingJp} JP KBM Riil)`;
        if (totalEligibleEquivalency > 0) {
            result.notes.push('Ekuivalensi tugas tambahan tidak diakumulasikan karena jam tatap muka riil sudah mencapai 24 JP (Pasal 17).');
        }
    } else {
        // Menggunakan ekuivalensi yang sah maksimal sebesar kekurangan menuju 24 JP
        const recognizedEq = Math.min(deficitTo24, totalEligibleEquivalency);
        result.recognizedEquivalencyJp = recognizedEq;
        result.totalAdministrativeJp = safeTeachingJp + recognizedEq;
        result.isTeachingFulfill = result.totalAdministrativeJp >= DEFAULT_WORKLOAD_POLICY.minTeachingJp;

        if (result.isTeachingFulfill) {
            result.teachingStatusText = `Memenuhi (${safeTeachingJp} JP KBM + ${recognizedEq} JP Ekuivalensi = ${result.totalAdministrativeJp} JP)`;
        } else {
            result.teachingStatusText = `Belum Memenuhi (${safeTeachingJp} JP KBM + ${recognizedEq} JP Ekuivalensi = ${result.totalAdministrativeJp} JP / min. 24 JP)`;
        }
    }

    return result;
}

/**
 * Hitung seluruh agregat metrik mingguan untuk satu guru (SSOT Calculation Engine)
 * 
 * @param {object} params
 * @param {object} params.workWeek - Data root work_weeks
 * @param {Array<object>} params.planSegments - Seluruh slot rencana aktif
 * @param {Array<object>} params.workLogs - Seluruh entitas work_logs
 * @param {Array<object>} params.logSegments - Seluruh sesi riil work_log_segments
 * @param {Array<object>} params.planLogLinks - Relasi plan_log_links
 * @param {string} [params.currentDateWita] - Tanggal acuan server (YYYY-MM-DD)
 * @returns {object} Metrik lengkap
 */
export function calculateWeekAggregates({
    workWeek = {},
    planSegments = [],
    workLogs = [],
    logSegments = [],
    planLogLinks = [],
    currentDateWita = '',
    weekStartDate = '',
    options = {}
}) {
    const effectiveWeekStart = weekStartDate || workWeek.week_start_date || '';
    let adjustedInfo = null;
    let targetNormal = workWeek.target_minutes !== undefined ? workWeek.target_minutes : DEFAULT_WORKLOAD_POLICY.normalWeeklyMinutes;

    if (effectiveWeekStart) {
        adjustedInfo = calculateAdjustedWeeklyTarget(effectiveWeekStart, planSegments, options);
        if (workWeek.target_minutes === undefined || workWeek.target_minutes === DEFAULT_WORKLOAD_POLICY.normalWeeklyMinutes) {
            targetNormal = adjustedInfo.adjustedTargetMinutes;
        }
    }

    const adjustment = Math.max(0, parseInt(workWeek.approved_adjustment_minutes, 10) || 0);
    const netTarget = Math.max(0, targetNormal - adjustment);

    // 1. Total Durasi Rencana (dari plan_time_segments)
    // Jika target sudah disesuaikan (dikurangi hari libur), durasi rencana kerja nyata dihitung dari kegiatan non-libur
    let totalPlannedMinutes = 0;
    let teachingPlannedMinutes = 0;
    let teachingJpCount = 0;
    let holidayPlannedMinutes = 0;

    if (Array.isArray(planSegments)) {
        for (const seg of planSegments) {
            const pMin = Math.max(0, parseInt(seg.planned_minutes, 10) || 0);
            const isHoliday = seg.is_holiday === true || seg.is_holiday === 1 || seg.catalog_id === 'cat_libur' || seg.category_code === 'HOLIDAY';
            if (isHoliday) {
                holidayPlannedMinutes += pMin;
            } else {
                totalPlannedMinutes += pMin;
                if (seg.is_teaching) {
                    teachingPlannedMinutes += pMin;
                    teachingJpCount += Math.max(0, parseInt(seg.jp_count, 10) || 0);
                }
            }
        }
    }

    // 2. Total Durasi Aktual Riil (dihitung murni dari entitas unik work_log_segments)
    // Map logId -> verification_status
    const logVerificationMap = new Map();
    if (Array.isArray(workLogs)) {
        for (const l of workLogs) {
            logVerificationMap.set(l.id, l.verification_status || 'unverified');
        }
    }

    let reportedActualMinutes = 0;
    let verifiedActualMinutes = 0;

    if (Array.isArray(logSegments)) {
        for (const ls of logSegments) {
            const aMin = Math.max(0, parseInt(ls.actual_minutes, 10) || 0);
            reportedActualMinutes += aMin;

            const vStatus = logVerificationMap.get(ls.work_log_id);
            if (vStatus === 'verified') {
                verifiedActualMinutes += aMin;
            }
        }
    }

    // 3. Evaluasi Pelaporan per Rencana (Plan Fulfillment Status)
    // Tautkan setiap plan_activity_id ke work_logs terkait
    const planActivityLinksMap = new Map();
    if (Array.isArray(planLogLinks)) {
        for (const link of planLogLinks) {
            if (!planActivityLinksMap.has(link.plan_activity_id)) {
                planActivityLinksMap.set(link.plan_activity_id, []);
            }
            planActivityLinksMap.get(link.plan_activity_id).push(link);
        }
    }

    let unreportedPlannedMinutes = 0;
    let fulfilledCount = 0;
    let partialCount = 0;
    let notDoneCount = 0;
    let substituteCount = 0;
    let unreportedCount = 0;

    if (Array.isArray(planSegments)) {
        for (const seg of planSegments) {
            const actId = seg.activity_id;
            const links = planActivityLinksMap.get(actId) || [];
            const isPast = currentDateWita ? String(seg.date) < String(currentDateWita) : false;

            if (links.length === 0) {
                unreportedCount++;
                if (isPast) {
                    unreportedPlannedMinutes += Math.max(0, parseInt(seg.planned_minutes, 10) || 0);
                }
            } else {
                const hasSubstitution = links.some(l => l.link_type === 'substitution');
                const hasNotDone = links.some(l => l.link_type === 'not_done');
                const hasPartial = links.some(l => l.link_type === 'partial');

                if (hasSubstitution) substituteCount++;
                else if (hasNotDone) notDoneCount++;
                else if (hasPartial) partialCount++;
                else fulfilledCount++;
            }
        }
    }

    // 4. Ketercapaian Alokasi
    const remainingPlanMinutes = Math.max(0, netTarget - totalPlannedMinutes);
    const excessPlanMinutes = Math.max(0, totalPlannedMinutes - netTarget);
    const planAllocationComplete = totalPlannedMinutes >= netTarget;

    return {
        targetNormalMinutes: targetNormal,
        approvedAdjustmentMinutes: adjustment,
        netTargetMinutes: netTarget,
        holidayCount: adjustedInfo ? adjustedInfo.holidayCount : 0,
        holidayDeductionMinutes: adjustedInfo ? adjustedInfo.holidayDeductionMinutes : 0,
        holidayDates: adjustedInfo ? adjustedInfo.holidayDates : [],
        holidayPlannedMinutes,
        plannedMinutes: totalPlannedMinutes,
        teachingPlannedMinutes,
        teachingJpCount,
        reportedActualMinutes,
        verifiedActualMinutes, // SUBSET dari reportedActualMinutes
        unreportedPlannedMinutes,
        remainingPlanMinutes,
        excessPlanMinutes,
        planAllocationComplete,
        planAllocationLabel: planAllocationComplete ? 'Alokasi Lengkap' : `Kurang ${formatDurationDisplay(remainingPlanMinutes)}`,
        counts: {
            fulfilled: fulfilledCount,
            partial: partialCount,
            notDone: notDoneCount,
            substitute: substituteCount,
            unreported: unreportedCount,
            totalSegments: (planSegments || []).length
        }
    };
}

export const WORKLOAD_DAY_NAMES = Object.freeze(['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat']);

/**
 * Konversi tanggal Senin minggu berjalan + dayIndex menjadi string ISO "YYYY-MM-DD"
 * @param {string} weekStartDate - Tanggal hari Senin "YYYY-MM-DD"
 * @param {number} dayIndex - 0 = Senin, 1 = Selasa, ..., 4 = Jumat
 * @returns {string} Tanggal "YYYY-MM-DD"
 */
export function getDayDateString(weekStartDate, dayIndex = 0) {
    if (!weekStartDate || typeof weekStartDate !== 'string') return '';
    const parts = weekStartDate.trim().split('-').map(Number);
    if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return '';
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() + dayIndex);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dt = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dt}`;
}

/**
 * Hitung seluruh slot linier timeline dalam satu hari kerja:
 * - Mengidentifikasi segmen kegiatan aktif (type: 'activity')
 * - Mengidentifikasi slot istirahat resmi sekolah (type: 'break')
 * - Mengidentifikasi celah jam kosong yang belum terisi (type: 'empty')
 * - Mendeteksi hari libur/dispensasi resmi sekolah (isHoliday: true)
 * 
 * @param {string} dateStr - Tanggal kegiatan "YYYY-MM-DD"
 * @param {Array<object>} daySegments - Seluruh segmen rencana pada hari tersebut
 * @param {object} [options] - Opsi kebijakan jam kerja & istirahat
 * @returns {object} Hasil analisis slot harian
 */
export function calculateDayTimelineSlots(dateStr, daySegments = [], options = {}) {
    const policy = options.policy || DEFAULT_WORKLOAD_POLICY;
    const workStartTime = options.workStartTime || policy.workStartTime || DEFAULT_WORKLOAD_POLICY.workStartTime;
    const workEndTime = options.workEndTime || policy.workEndTime || DEFAULT_WORKLOAD_POLICY.workEndTime;
    const policyBreaks = Array.isArray(options.breaks)
        ? options.breaks
        : (Array.isArray(policy.breaks) ? policy.breaks : DEFAULT_WORKLOAD_POLICY.breaks);

    const workStartMin = timeStringToMinutes(workStartTime);
    const workEndMin = timeStringToMinutes(workEndTime);

    // 1. Deteksi apakah hari ini ditandai sebagai Hari Libur / Dispensasi Resmi Sekolah
    const holidaySeg = (daySegments || []).find(seg => {
        const title = (seg.activity_title || seg.title || seg.description || '').toLowerCase();
        const isExplicitHoliday = seg.is_holiday === true || seg.is_holiday === 1 || seg.catalog_id === 'cat_libur' || seg.category_code === 'HOLIDAY';
        const hasHolidayKeyword = title.includes('libur') || title.includes('dispensasi');
        return isExplicitHoliday || hasHolidayKeyword;
    });

    const isExternalHoliday = options.isHoliday === true ||
        (typeof options.isHolidayFn === 'function' && options.isHolidayFn(dateStr)) ||
        (typeof window !== 'undefined' && window.HolidayManager && typeof window.HolidayManager.isHolidayDate === 'function' && window.HolidayManager.isHolidayDate(dateStr)) ||
        (typeof window !== 'undefined' && window.HolidayManager && typeof window.HolidayManager.isRegisteredHoliday === 'function' && window.HolidayManager.isRegisteredHoliday(dateStr)) ||
        (typeof window !== 'undefined' && window.DataHolidays && typeof window.DataHolidays.isNationalHoliday === 'function' && window.DataHolidays.isNationalHoliday(dateStr)) ||
        (typeof globalThis !== 'undefined' && globalThis.HolidayManager && typeof globalThis.HolidayManager.isHolidayDate === 'function' && globalThis.HolidayManager.isHolidayDate(dateStr)) ||
        (typeof globalThis !== 'undefined' && globalThis.DataHolidays && typeof globalThis.DataHolidays.isNationalHoliday === 'function' && globalThis.DataHolidays.isNationalHoliday(dateStr));

    if (holidaySeg || isExternalHoliday) {
        let externalTitle = '';
        if (typeof options.getHolidayInfoFn === 'function') {
            const hInfo = options.getHolidayInfoFn(dateStr);
            externalTitle = hInfo?.title || hInfo?.name || '';
        }
        if (!externalTitle && typeof window !== 'undefined' && window.HolidayManager && typeof window.HolidayManager.getHolidayDateInfo === 'function') {
            const hInfo = window.HolidayManager.getHolidayDateInfo(dateStr);
            externalTitle = hInfo?.title || hInfo?.name || '';
        }
        if (!externalTitle && typeof window !== 'undefined' && window.DataHolidays && typeof window.DataHolidays.getHolidayForDate === 'function') {
            externalTitle = window.DataHolidays.getHolidayForDate(dateStr)?.title || '';
        }
        if (!externalTitle && typeof window !== 'undefined' && window.HolidayManager && typeof window.HolidayManager.getRegisteredHoliday === 'function') {
            externalTitle = window.HolidayManager.getRegisteredHoliday(dateStr)?.nama || '';
        }

        const holidayTitle = holidaySeg?.activity_title || holidaySeg?.title || holidaySeg?.description ||
            externalTitle ||
            'Libur / Dispensasi Resmi Sekolah';

        const startMin = timeStringToMinutes(holidaySeg?.start_time || workStartTime);
        const endMin = timeStringToMinutes(holidaySeg?.end_time || workEndTime);
        const plannedMin = holidaySeg && holidaySeg.planned_minutes !== undefined && holidaySeg.planned_minutes !== null
            ? Math.max(0, parseInt(holidaySeg.planned_minutes, 10))
            : calculateEffectiveMinutes(holidaySeg?.start_time || workStartTime, holidaySeg?.end_time || workEndTime, policyBreaks, workStartTime, workEndTime);

        return {
            date: dateStr,
            isHoliday: true,
            isLeave: false,
            holidaySegment: holidaySeg || null,
            holidayTitle: holidayTitle,
            slots: [
                {
                    type: 'holiday',
                    id: holidaySeg?.id || `holiday_${dateStr}`,
                    segment: holidaySeg || null,
                    startTime: holidaySeg?.start_time || workStartTime,
                    endTime: holidaySeg?.end_time || workEndTime,
                    startMin,
                    endMin,
                    durationMinutes: plannedMin,
                    title: holidayTitle
                }
            ],
            totalPlannedMinutes: plannedMin,
            emptyMinutes: 0,
            emptySlotsCount: 0,
            isComplete: true,
            forEach(callback, thisArg) {
                return this.slots.forEach(callback, thisArg);
            },
            [Symbol.iterator]() {
                return this.slots[Symbol.iterator]();
            }
        };
    }

    // 1b. Deteksi apakah hari ini ditandai sebagai Cuti / Izin (0 menit direncanakan, bebas pemenuhan jam)
    // Cuti/Izin hanya aktif jika ditandai secara eksplisit melalui tombol Cuti/Izin (tanpa deteksi otomatis kata kunci)
    const leaveSeg = (daySegments || []).find(seg => {
        return seg.is_leave === true || seg.is_leave === 1 || seg.catalog_id === 'cat_cuti_izin' || seg.category_code === 'CUTI_IZIN';
    });

    if (leaveSeg) {
        const leaveTitle = leaveSeg.activity_title || leaveSeg.title || 'Cuti / Izin Resmi';
        const leaveNotes = leaveSeg.description || '';
        const startMin = timeStringToMinutes(leaveSeg.start_time || workStartTime);
        const endMin = timeStringToMinutes(leaveSeg.end_time || workEndTime);

        return {
            date: dateStr,
            isHoliday: false,
            isLeave: true,
            leaveSegment: leaveSeg,
            leaveTitle: leaveTitle,
            leaveNotes: leaveNotes,
            slots: [
                {
                    type: 'leave',
                    id: leaveSeg.id || `leave_${dateStr}`,
                    segment: leaveSeg,
                    startTime: leaveSeg.start_time || workStartTime,
                    endTime: leaveSeg.end_time || workEndTime,
                    startMin,
                    endMin,
                    durationMinutes: 0,
                    title: leaveTitle
                }
            ],
            totalPlannedMinutes: 0,
            emptyMinutes: 0,
            emptySlotsCount: 0,
            isComplete: true,
            forEach(callback, thisArg) {
                return this.slots.forEach(callback, thisArg);
            },
            [Symbol.iterator]() {
                return this.slots[Symbol.iterator]();
            }
        };
    }

    // 2. Normalisasi Istirahat Sekolah
    const parsedBreaks = policyBreaks
        .map(b => ({
            name: b.name || 'Istirahat',
            startTime: b.start,
            endTime: b.end,
            startMin: timeStringToMinutes(b.start),
            endMin: timeStringToMinutes(b.end),
            durationMinutes: Math.max(0, timeStringToMinutes(b.end) - timeStringToMinutes(b.start))
        }))
        .filter(b => b.startMin < b.endMin)
        .sort((a, b) => a.startMin - b.startMin);

    // 3. Normalisasi Segmen Kegiatan Hari Ini
    const parsedActivities = (daySegments || [])
        .map((seg, idx) => {
            const sMin = timeStringToMinutes(seg.start_time);
            const eMin = timeStringToMinutes(seg.end_time);
            const duration = seg.planned_minutes !== undefined && seg.planned_minutes !== null
                ? Math.max(0, parseInt(seg.planned_minutes, 10))
                : calculateEffectiveMinutes(seg.start_time, seg.end_time, policyBreaks, workStartTime, workEndTime);

            return {
                segment: seg,
                id: seg.id || `act_${idx}`,
                startTime: seg.start_time,
                endTime: seg.end_time,
                startMin: sMin,
                endMin: eMin,
                durationMinutes: duration,
                title: seg.activity_title || seg.title || seg.description || 'Kegiatan'
            };
        })
        .filter(a => a.startMin < a.endMin)
        .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

    const slots = [];

    // Pre-deteksi seluruh kegiatan yang bertabrakan waktu pada hari ini (Anti-Hidden Activities)
    const conflictingIds = new Set();
    for (let i = 0; i < parsedActivities.length; i++) {
        for (let j = i + 1; j < parsedActivities.length; j++) {
            const a = parsedActivities[i];
            const b = parsedActivities[j];
            if (Math.max(a.startMin, b.startMin) < Math.min(a.endMin, b.endMin)) {
                conflictingIds.add(a.id);
                conflictingIds.add(b.id);
            }
        }
    }

    // Kegiatan yang dimulai sebelum batas jam operasional resmi
    const beforeWork = parsedActivities.filter(a => a.endMin <= workStartMin);
    for (const b of beforeWork) {
        slots.push({
            type: 'activity',
            segment: b.segment,
            id: b.id,
            startTime: b.startTime,
            endTime: b.endTime,
            startMin: b.startMin,
            endMin: b.endMin,
            durationMinutes: b.durationMinutes,
            title: b.title,
            hasConflict: conflictingIds.has(b.id),
            isOvertime: true
        });
    }

    // Sweeping interval linier dalam rentang jam operasional [workStartMin, workEndMin]
    const inRangeActs = parsedActivities.filter(a => a.endMin > workStartMin && a.startMin < workEndMin);
    let cursor = workStartMin;

    while (cursor < workEndMin) {
        // 1. Cek apakah posisi cursor berada di dalam jam istirahat resmi
        const activeBreak = parsedBreaks.find(b => b.startMin <= cursor && b.endMin > cursor);
        if (activeBreak) {
            slots.push({
                type: 'break',
                name: activeBreak.name,
                startTime: activeBreak.startTime,
                endTime: activeBreak.endTime,
                startMin: activeBreak.startMin,
                endMin: activeBreak.endMin,
                durationMinutes: activeBreak.durationMinutes
            });
            cursor = activeBreak.endMin;
            continue;
        }

        // 2. Cek apakah ada kegiatan aktif pada posisi cursor (tangkap seluruh kegiatan yang beririsan tanpa menyembunyikan duplikat)
        const activeActs = inRangeActs.filter(a => a.startMin <= cursor && a.endMin > cursor);
        if (activeActs.length > 0) {
            // Deteksi jika ada jeda istirahat resmi yang memotong rentang kegiatan sebelum selesai
            const maxActEnd = Math.max(...activeActs.map(a => a.endMin));
            const nextBreak = parsedBreaks.find(b => b.startMin > cursor && b.startMin < maxActEnd);
            // Menampilkan data riil kegiatan: jangan memotong sepihak pada workEndMin jika tidak ada jeda istirahat
            const segmentEnd = nextBreak ? nextBreak.startMin : maxActEnd;

            for (const activeAct of activeActs) {
                const subStart = Math.max(cursor, activeAct.startMin);
                const subEnd = Math.min(segmentEnd, activeAct.endMin);
                if (subStart < subEnd) {
                    slots.push({
                        type: 'activity',
                        segment: activeAct.segment,
                        id: activeAct.id,
                        startTime: minutesToTimeString(subStart),
                        endTime: minutesToTimeString(subEnd),
                        startMin: subStart,
                        endMin: subEnd,
                        durationMinutes: subEnd - subStart,
                        title: activeAct.title,
                        hasConflict: conflictingIds.has(activeAct.id) || activeActs.length > 1,
                        isOvertime: subEnd > workEndMin
                    });
                }
            }
            cursor = segmentEnd;
            continue;
        }

        // 3. Jika bukan kegiatan dan bukan istirahat, cari batas terdekat berikutnya
        const nextAct = inRangeActs.find(a => a.startMin > cursor);
        const nextActStart = nextAct ? nextAct.startMin : Infinity;

        const nextBrk = parsedBreaks.find(b => b.startMin > cursor);
        const nextBrkStart = nextBrk ? nextBrk.startMin : Infinity;

        const nextBoundary = Math.min(workEndMin, nextActStart, nextBrkStart);

        if (nextBoundary > cursor) {
            slots.push({
                type: 'empty',
                startTime: minutesToTimeString(cursor),
                endTime: minutesToTimeString(nextBoundary),
                startMin: cursor,
                endMin: nextBoundary,
                durationMinutes: nextBoundary - cursor
            });
            cursor = nextBoundary;
        } else {
            cursor = Math.min(workEndMin, cursor + 1);
        }
    }

    // Kegiatan yang dimulai setelah atau pada batas akhir jam operasional
    const afterWork = parsedActivities.filter(a => a.startMin >= workEndMin);
    for (const a of afterWork) {
        slots.push({
            type: 'activity',
            segment: a.segment,
            id: a.id,
            startTime: a.startTime,
            endTime: a.endTime,
            startMin: a.startMin,
            endMin: a.endMin,
            durationMinutes: a.durationMinutes,
            title: a.title,
            hasConflict: conflictingIds.has(a.id),
            isOvertime: true
        });
    }

    const emptySlots = slots.filter(s => s.type === 'empty');
    const emptyMinutes = emptySlots.reduce((sum, s) => sum + s.durationMinutes, 0);
    const emptySlotsCount = emptySlots.length;

    let totalPlannedMinutes = 0;
    (daySegments || []).forEach(s => {
        totalPlannedMinutes += Math.max(0, parseInt(s.planned_minutes, 10) || 0);
    });

    const isComplete = emptySlotsCount === 0 && emptyMinutes === 0;

    return {
        date: dateStr,
        isHoliday: false,
        isLeave: false,
        holidaySegment: null,
        leaveSegment: null,
        slots,
        totalPlannedMinutes,
        emptyMinutes,
        emptySlotsCount,
        isComplete,
        hasConflict: conflictingIds.size > 0,
        conflictingCount: conflictingIds.size,
        forEach(callback, thisArg) {
            return this.slots.forEach(callback, thisArg);
        },
        [Symbol.iterator]() {
            return this.slots[Symbol.iterator]();
        }
    };
}

/**
 * Menghitung jumlah hari libur kerja (Senin s.d Jumat) dalam satu minggu
 * dan mengembalikan informasi tanggal serta nama hari liburnya.
 * 
 * @param {string} weekStartDate - Tanggal hari Senin "YYYY-MM-DD"
 * @param {Array<object>} [segments=[]] - Seluruh segmen rencana dalam minggu tersebut
 * @param {object} [options={}] - Opsi pendeteksi libur (misal isHolidayFn, policy)
 * @returns {{
 *   holidayCount: number,
 *   workDaysCount: number,
 *   effectiveWorkDaysCount: number,
 *   holidayDates: Array<{ dayIndex: number, dayName: string, date: string, title: string }>
 * }}
 */
export function countWeekWorkHolidays(weekStartDate, segments = [], options = {}) {
    const policy = options.policy || DEFAULT_WORKLOAD_POLICY;
    const workDaysCount = options.workDaysCount || policy.workDaysCount || DEFAULT_WORKLOAD_POLICY.workDaysCount || 5;

    const holidayDates = [];
    for (let i = 0; i < workDaysCount; i++) {
        const dayDate = getDayDateString(weekStartDate, i);
        if (!dayDate) continue;
        const daySegs = (segments || []).filter(s => s.date === dayDate);
        const dayTimeline = calculateDayTimelineSlots(dayDate, daySegs, options);
        if (dayTimeline.isHoliday) {
            const hTitle = dayTimeline.holidayTitle || dayTimeline.slots[0]?.title || 'Hari Libur';
            holidayDates.push({
                dayIndex: i,
                dayName: WORKLOAD_DAY_NAMES[i] || `Hari ke-${i + 1}`,
                date: dayDate,
                title: hTitle
            });
        }
    }

    const holidayCount = holidayDates.length;
    const effectiveWorkDaysCount = Math.max(0, workDaysCount - holidayCount);

    return {
        holidayCount,
        workDaysCount,
        effectiveWorkDaysCount,
        holidayDates
    };
}

/**
 * Menghitung target menit mingguan yang telah disesuaikan dengan hari libur kerja.
 * Setiap hari libur pada hari kerja aktif (Senin s.d Jumat) mengurangi kewajiban
 * target mingguan sebesar jam kerja harian normal (450 menit / 7,5 jam).
 *
 * Contoh:
 * - 0 hari libur: 5 hari x 450m = 2.250 menit (37,5 jam)
 * - 1 hari libur: 4 hari x 450m = 1.800 menit (30,0 jam)
 * - 2 hari libur: 3 hari x 450m = 1.350 menit (22,5 jam)
 *
 * @param {string} weekStartDate - Tanggal hari Senin "YYYY-MM-DD"
 * @param {Array<object>} [segments=[]] - Seluruh segmen rencana guru
 * @param {object} [options={}] - Opsi kalkulasi dan pendeteksi libur
 * @returns {{
 *   baseTargetMinutes: number,
 *   holidayCount: number,
 *   holidayDeductionMinutes: number,
 *   adjustedTargetMinutes: number,
 *   holidayDates: Array,
 *   effectiveWorkDaysCount: number
 * }}
 */
export function calculateAdjustedWeeklyTarget(weekStartDate, segments = [], options = {}) {
    const policy = options.policy || DEFAULT_WORKLOAD_POLICY;
    const workDaysCount = options.workDaysCount || policy.workDaysCount || DEFAULT_WORKLOAD_POLICY.workDaysCount || 5;
    const dailyMinutes = options.normalDailyMinutes || policy.normalDailyMinutes || DEFAULT_WORKLOAD_POLICY.normalDailyMinutes || 450;
    const baseTargetMinutes = options.baseTargetMinutes || (workDaysCount * dailyMinutes);

    const holidayInfo = countWeekWorkHolidays(weekStartDate, segments, options);
    const holidayDeductionMinutes = holidayInfo.holidayCount * dailyMinutes;
    const adjustedTargetMinutes = Math.max(0, baseTargetMinutes - holidayDeductionMinutes);

    return {
        baseTargetMinutes,
        holidayCount: holidayInfo.holidayCount,
        holidayDeductionMinutes,
        adjustedTargetMinutes,
        holidayDates: holidayInfo.holidayDates,
        effectiveWorkDaysCount: holidayInfo.effectiveWorkDaysCount
    };
}

/**
 * Validasi kelengkapan rencana mingguan guru untuk seluruh hari kerja aktif (Senin s.d Jumat)
 * Menolak pengajuan/pengesahan rencana jika masih terdapat celah jam kosong yang belum terisi.
 * 
 * @param {string} weekStartDate - Tanggal hari Senin "YYYY-MM-DD"
 * @param {Array<object>} segments - Seluruh segmen rencana dalam minggu tersebut
 * @param {object} [options] - Opsi tambahan
 * @returns {object} { isValid: boolean, totalEmptyMinutes: number, totalEmptySlotsCount: number, incompleteDays: Array, message: string }
 */
export function validateWeeklyPlanCompleteness(weekStartDate, segments = [], options = {}) {
    const workDaysCount = options.workDaysCount || DEFAULT_WORKLOAD_POLICY.workDaysCount || 5;
    const policy = options.policy || DEFAULT_WORKLOAD_POLICY;

    const dayResults = [];
    const incompleteDays = [];
    const overlappingDays = [];

    for (let i = 0; i < workDaysCount; i++) {
        const dayDate = getDayDateString(weekStartDate, i);
        const daySegs = (segments || []).filter(s => s.date === dayDate);
        const dayTimeline = calculateDayTimelineSlots(dayDate, daySegs, {
            ...options,
            workStartTime: policy.workStartTime,
            workEndTime: policy.workEndTime,
            breaks: policy.breaks
        });

        dayResults.push(dayTimeline);

        if (!dayTimeline.isHoliday && !dayTimeline.isLeave) {
            if (!dayTimeline.isComplete || dayTimeline.emptySlotsCount > 0) {
                incompleteDays.push({
                    dayIndex: i,
                    dayName: WORKLOAD_DAY_NAMES[i] || `Hari ke-${i + 1}`,
                    date: dayDate,
                    emptySlotsCount: dayTimeline.emptySlotsCount,
                    emptyMinutes: dayTimeline.emptyMinutes,
                    emptySlots: dayTimeline.slots.filter(s => s.type === 'empty')
                });
            }

            const overlapCheck = validateNoOverlap(daySegs);
            if (!overlapCheck.isValid) {
                overlappingDays.push({
                    dayIndex: i,
                    dayName: WORKLOAD_DAY_NAMES[i] || `Hari ke-${i + 1}`,
                    date: dayDate,
                    message: overlapCheck.conflictMessage
                });
            }
        }
    }

    const hasEmptySlots = incompleteDays.length > 0;
    const hasOverlaps = overlappingDays.length > 0;
    const isValid = !hasEmptySlots && !hasOverlaps;
    const totalEmptyMinutes = incompleteDays.reduce((sum, d) => sum + d.emptyMinutes, 0);
    const totalEmptySlotsCount = incompleteDays.reduce((sum, d) => sum + d.emptySlotsCount, 0);

    let message = 'Rencana kerja mingguan telah lengkap terisi tanpa ada slot jam kosong dan bebas benturan waktu.';
    const actionLabel = options?.actionName || (options?.isAutoApproved === true ? 'difinalisasi' : (options?.isAutoApproved === false ? 'diajukan' : 'difinalisasi/diajukan'));
    if (hasOverlaps) {
        const overlapListText = overlappingDays.map(d => `${d.dayName} (${d.message})`).join('; ');
        message = `Rencana mingguan belum dapat ${actionLabel} karena terdapat benturan jam kerja: ${overlapListText}. Silakan sesuaikan jam kegiatan agar tidak beririsan.`;
    } else if (hasEmptySlots) {
        const dayListText = incompleteDays.map(d => `${d.dayName} (${d.emptyMinutes}m kosong)`).join(', ');
        message = `Rencana mingguan belum dapat ${actionLabel} karena masih terdapat ${totalEmptySlotsCount} slot jam kosong (${totalEmptyMinutes} menit) pada hari: ${dayListText}. Silakan lengkapi kegiatan, tandai cuti/izin, atau pastikan kalender libur sekolah sesuai.`;
    }

    // Cek kepatuhan Hari Belajar Guru jika options.studyDayIndex != null
    // (Jika hari HBG adalah hari libur kalender ATAU guru mengambil Cuti/Izin, kewajiban kegiatan HBG otomatis dibebaskan)
    let studyDayValid = true;
    let studyDayMessage = '';
    const studyDayIndex = options.studyDayIndex;
    if (studyDayIndex !== null && studyDayIndex !== undefined && studyDayIndex >= 0 && studyDayIndex < workDaysCount) {
        const isStudyDayHoliday = dayResults[studyDayIndex]?.isHoliday;
        const isStudyDayLeave = dayResults[studyDayIndex]?.isLeave;
        if (!isStudyDayHoliday && !isStudyDayLeave) {
            const hasHbg = checkHasPkActivity(segments, studyDayIndex);
            if (!hasHbg) {
                studyDayValid = false;
                const studyDayName = WORKLOAD_DAY_NAMES[studyDayIndex] || `Hari ke-${studyDayIndex + 1}`;
                studyDayMessage = `Hari ${studyDayName} ditetapkan sebagai Hari Belajar Guru (SE Mendikdasmen No. 5684/2025), namun belum memuat kegiatan ranah Hari Belajar Guru (Perencanaan Pembelajaran atau PKB/MGMP). Minimal wajib mencantumkan 1 kegiatan ranah HBG.`;
            }
        }
    }

    const enforceStudyDay = !!options.enforceStudyDay;
    const effectiveValid = enforceStudyDay ? (isValid && studyDayValid) : isValid;
    if (enforceStudyDay && isValid && !studyDayValid) {
        message = studyDayMessage;
    }

    return {
        isValid: effectiveValid,
        isComplete: isValid,
        studyDayValid,
        studyDayMessage,
        totalEmptyMinutes,
        totalEmptySlotsCount,
        incompleteDays,
        dayResults,
        message
    };
}

/**
 * SE Mendikdasmen No. 5684/MDM.B1/HK.04.00/2025: Hari Belajar Guru
 * Deteksi dari master jadwal lengkap. Rencana saja tidak membuktikan hari bebas KBM.
 * @param {Array} segments - Daftar segmen rencana kerja mingguan
 * @param {Object} options - { teacherSchedule, manualStudyDayIndex, workDaysCount: 5 }
 * @returns {Object} { studyDayIndex, isAutoDetected, hasPkActivity, studyDayName }
 */
export function detectTeacherStudyDay(segments = [], options = {}) {
    const workDaysCount = options.workDaysCount || 5;
    const manualIndex = options.manualStudyDayIndex;
    const excluded = new Set(options.excludedDayIndexes || []);
    const result = (studyDayIndex, status, reason, extra = {}) => ({
        studyDayIndex, status, reason, isAutoDetected: status === 'auto',
        studyDayName: studyDayIndex === null ? '' : WORKLOAD_DAY_NAMES[studyDayIndex],
        suggestedDayIndex: null, isExempt: false, ...extra
    });
    if (typeof manualIndex === 'number' && Number.isInteger(manualIndex) && manualIndex >= 0 && manualIndex < workDaysCount) {
        return result(manualIndex, 'manual', 'Pilihan guru', { isExempt: excluded.has(manualIndex) });
    }
    const candidates = Array.from({ length: workDaysCount }, (_, i) => i).filter(i => !excluded.has(i));
    if (!candidates.length) return result(null, 'exempt', 'Seluruh hari kerja libur atau cuti/izin', { isExempt: true });
    const schedule = options.teacherSchedule;
    if (!schedule?.complete || !schedule.days || !Array.from({ length: workDaysCount }, (_, i) => i + 1).every(day => Array.isArray(schedule.days[day]))) {
        return result(null, 'unavailable', schedule?.reason || 'Jadwal resmi guru belum tersedia atau belum lengkap. Pilih hari secara manual atau periksa pemetaan jadwal.');
    }
    // Slot kosong (placeholder parser) tidak termasuk KBM. Gunakan durasi, bukan jumlah segmen.
    const teachingMinutes = Array.from({ length: workDaysCount }, (_, i) => schedule.days[i + 1].reduce((sum, slot) => {
        if (!(slot.is_teaching === 1 || slot.is_teaching === true || (slot.mapel && !/^(upacara|ekstrakurikuler)$/i.test(slot.mapel.trim())))) return sum;
        return sum + Math.max(1, Number(slot.minutes) || Number(slot.jp_count) * 45 || 45);
    }, 0));
    if (!teachingMinutes.some(value => value > 0)) {
        return result(null, 'unavailable', 'Guru belum memiliki KBM dalam master jadwal. Tetapkan hari belajar secara manual.');
    }
    // KBM tambahan pada rencana tetap mencegah suatu hari disebut bebas KBM.
    const plannedMinutes = new Array(workDaysCount).fill(0);
    for (const seg of segments || []) {
        const index = Number(seg.day_of_week) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= workDaysCount) continue;
        if (seg.is_teaching === 1 || seg.is_teaching === true || seg.category_code === 'PELAKSANAAN_KBM' || seg.catalog_id === 'cat_kbm') {
            plannedMinutes[index] += Math.max(1, Number(seg.planned_minutes) || Number(seg.jp_count) * 45 || 45);
        }
    }
    const loads = teachingMinutes.map((value, i) => Math.max(value, plannedMinutes[i]));
    const emptyDay = candidates.find(i => loads[i] === 0);
    if (emptyDay !== undefined) return result(emptyDay, 'auto', 'Hari kerja tanpa KBM pada jadwal resmi dan rencana');
    const suggestedDayIndex = candidates.reduce((best, i) => loads[i] < loads[best] ? i : best, candidates[0]);
    return result(null, 'needs_selection', 'Semua hari kerja memiliki KBM. Tetapkan Hari Belajar Guru melalui pilihan hari.', { suggestedDayIndex });
}

/**
 * Memeriksa apakah suatu segmen kegiatan rencana masuk dalam ranah Hari Belajar Guru (HBG)
 * (SE Mendikdasmen No. 5684/MDM.B1/HK.04.00/2025 jo. Permendikdasmen No. 11/2025)
 * Opsi 1:
 * 1. Tugas Pokok PERENCANAAN (Pasal 4: Kurikulum, Modul Ajar, ATP, Perangkat Ajar)
 * 2. Tugas Pokok TUGAS_TAMBAHAN yang relevan dengan PKB / MGMP / Komunitas Belajar (Pasal 11 & 22)
 * 3. Katalog atau judul kegiatan spesifik MGMP / Komunitas Belajar / Pelatihan Terstruktur
 * @param {Object} seg
 * @returns {boolean}
 */
export function isStudyDayCompliantActivity(seg) {
    if (!seg) return false;
    if (seg.is_teaching === 1 || seg.is_teaching === true || seg.category_code === 'PELAKSANAAN_KBM' || seg.catalog_id === 'cat_kbm' ||
        seg.is_holiday || seg.catalog_id === 'cat_libur' || seg.is_leave === 1 || seg.is_leave === true || seg.category_code === 'CUTI_IZIN' || seg.catalog_id === 'cat_cuti_izin') return false;
    const duty = seg.category_code || '';
    const catId = seg.catalog_id || '';
    const title = (seg.title || seg.activity_title || seg.description || '').toLowerCase();

    // 1. Tugas Pokok 1: Merencanakan Pembelajaran atau Pembimbingan (Pasal 4 Permendikdasmen No. 11/2025)
    if (duty === 'PERENCANAAN') return true;

    // 2. Katalog resmi terkait PKB / MGMP / Komunitas Belajar / Perencanaan
    const HBG_CATALOG_IDS = [
        'cat_mgmp',
        'cat_tt_koor_pkb',
        'cat_tt_peserta_pelatihan',
        'cat_tt_narasumber',
        'cat_tt_koor_p5',
        'cat_tt_organisasi_profesi',
        'cat_rencana_kurikulum',
        'cat_rencana_modul',
        'cat_evaluasi'
    ];
    if (HBG_CATALOG_IDS.includes(catId)) return true;

    // 3. Tugas Pokok TUGAS_TAMBAHAN yang mengarah pada pengembangan keprofesian
    if (duty === 'TUGAS_TAMBAHAN' && (
        catId.startsWith('cat_tt_koor_pkb') ||
        catId.startsWith('cat_tt_peserta') ||
        catId.startsWith('cat_tt_narasumber') ||
        catId.startsWith('cat_tt_organisasi') ||
        catId.startsWith('cat_tt_koor_p5') ||
        catId === 'cat_mgmp'
    )) return true;

    // 4. Kata kunci penanda kegiatan pengembangan keprofesian / belajar guru
    const keywords = ['mgmp', 'komunitas belajar', 'kombel', 'pkb', 'pmm', 'pelatihan', 'diseminasi', 'workshop', 'webinar', 'bimtek'];
    if (keywords.some(kw => title.includes(kw))) return true;

    return false;
}

/**
 * Cek apakah pada suatu hari atau dalam 1 minggu sudah ada kegiatan ranah Hari Belajar Guru (PKB/MGMP/Perencanaan)
 * (SE Mendikdasmen No. 5684/MDM.B1/HK.04.00/2025)
 * @param {Array} segments
 * @param {number|null} targetDayIndex - 0 s.d 4 (null untuk cek sepekan penuh)
 * @returns {boolean}
 */
export function checkHasPkActivity(segments = [], targetDayIndex = null) {
    return (segments || []).some(seg => {
        if (targetDayIndex !== null && targetDayIndex !== undefined) {
            const dIdx = (seg.day_of_week != null) ? (seg.day_of_week - 1) : null;
            if (dIdx !== targetDayIndex) return false;
        }
        return isStudyDayCompliantActivity(seg);
    });
}

// Server dan browser memakai pemeriksaan tanggal serta durasi yang sama saat pengajuan.
export function validateTeacherStudyDayPlan(studyDay, segments, weekStartDate) {
    if (studyDay?.isExempt) return { isValid: true, message: '' };
    if (!Number.isInteger(studyDay?.studyDayIndex)) {
        return { isValid: false, message: 'Hari Belajar Guru belum ditetapkan. Pilih hari pada tab Rencana sebelum mengajukan.' };
    }
    const date = new Date(`${weekStartDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + studyDay.studyDayIndex);
    const targetDate = date.toISOString().slice(0, 10);
    const valid = (segments || []).some(seg => seg.date === targetDate &&
        Number(seg.day_of_week) === studyDay.studyDayIndex + 1 &&
        timeStringToMinutes(seg.end_time) > timeStringToMinutes(seg.start_time) && isStudyDayCompliantActivity(seg));
    return { isValid: valid, message: valid ? '' : `Hari ${studyDay.studyDayName} ditetapkan sebagai Hari Belajar Guru, namun belum memuat kegiatan HBG dengan durasi yang sah. Tambahkan minimal 1 kegiatan perencanaan atau pengembangan keprofesian.` };
}

/**
 * Konstanta 5 Tugas Pokok Guru Sesuai Permendikdasmen No. 11/2025 (Pasal 3 & 4)
 */
export const WORKLOAD_DUTIES_CONFIG = Object.freeze([
    {
        code: 'PELAKSANAAN_KBM',
        name: 'Pelaksanaan Pembelajaran',
        fullName: '1. Pelaksanaan Pembelajaran (KBM Tatap Muka)',
        shortName: 'Pelaksanaan Pembelajaran',
        mobileName: '1. Pembelajaran (KBM)',
        icon: 'fa-chalkboard-user',
        color: 'blue',
        bgClass: 'bg-blue-500',
        textClass: 'text-blue-600 dark:text-blue-400',
        bgLightClass: 'bg-blue-50 dark:bg-blue-950/40',
        borderClass: 'border-blue-200 dark:border-blue-800'
    },
    {
        code: 'PERENCANAAN',
        name: 'Perencanaan Pembelajaran',
        fullName: '2. Perencanaan Pembelajaran (Modul Ajar, Prota, Promes, MGMP)',
        shortName: 'Perencanaan Pembelajaran',
        mobileName: '2. Perencanaan',
        icon: 'fa-book-open',
        color: 'indigo',
        bgClass: 'bg-indigo-500',
        textClass: 'text-indigo-600 dark:text-indigo-400',
        bgLightClass: 'bg-indigo-50 dark:bg-indigo-950/40',
        borderClass: 'border-indigo-200 dark:border-indigo-800'
    },
    {
        code: 'PENILAIAN',
        name: 'Penilaian Hasil Pembelajaran',
        fullName: '3. Penilaian Hasil Pembelajaran (Asesmen & Evaluasi)',
        shortName: 'Penilaian Hasil Pembelajaran',
        mobileName: '3. Penilaian',
        icon: 'fa-clipboard-check',
        color: 'amber',
        bgClass: 'bg-amber-500',
        textClass: 'text-amber-600 dark:text-amber-400',
        bgLightClass: 'bg-amber-50 dark:bg-amber-950/40',
        borderClass: 'border-amber-200 dark:border-amber-800'
    },
    {
        code: 'PEMBIMBINGAN',
        name: 'Pembimbingan & Pelatihan Siswa',
        fullName: '4. Pembimbingan & Pelatihan Siswa (Ekskul, BK, P5)',
        shortName: 'Pembimbingan & Pelatihan',
        mobileName: '4. Pembimbingan',
        icon: 'fa-user-graduate',
        color: 'emerald',
        bgClass: 'bg-emerald-500',
        textClass: 'text-emerald-600 dark:text-emerald-400',
        bgLightClass: 'bg-emerald-50 dark:bg-emerald-950/40',
        borderClass: 'border-emerald-200 dark:border-emerald-800'
    },
    {
        code: 'TUGAS_TAMBAHAN',
        name: 'Pelaksanaan Tugas Tambahan',
        fullName: '5. Pelaksanaan Tugas Tambahan (Wali Kelas, Pembina, Piket, Upacara)',
        shortName: 'Pelaksanaan Tugas Tambahan',
        mobileName: '5. Tugas Tambahan',
        icon: 'fa-briefcase',
        color: 'purple',
        bgClass: 'bg-purple-500',
        textClass: 'text-purple-600 dark:text-purple-400',
        bgLightClass: 'bg-purple-50 dark:bg-purple-950/40',
        borderClass: 'border-purple-200 dark:border-purple-800'
    }
]);

/**
 * Menghitung ringkasan alokasi durasi rencana kerja per tugas pokok guru
 * sesuai dengan 5 Unsur Tugas Pokok Permendikdasmen No. 11/2025 (Pasal 3 & 4)
 * terhadap target standar mingguan 37,5 Jam (2.250 menit).
 *
 * @param {Array<object>} segments - Seluruh segmen rencana aktif (_weekData.segments)
 * @param {Array<object>} [activities] - Entitas rencana induk (_weekData.activities)
 * @param {Array<object>} [catalog] - Katalog aktivitas standar (_catalog)
 * @param {number} [targetWeeklyMinutes=2250] - Target jam kerja standar (37,5 jam = 2.250m)
 * @returns {object} Ringkasan komposisi alokasi tugas pokok
 */
export function calculateDutyAllocationSummary(
    segments = [],
    activities = [],
    catalog = [],
    targetWeeklyMinutes = DEFAULT_WORKLOAD_POLICY.normalWeeklyMinutes
) {
    const target = Math.max(1, parseInt(targetWeeklyMinutes, 10) || DEFAULT_WORKLOAD_POLICY.normalWeeklyMinutes);

    // Map activity_id -> activity
    const actMap = new Map();
    if (Array.isArray(activities)) {
        activities.forEach(a => {
            if (a && a.id) actMap.set(a.id, a);
        });
    }

    // Map catalog_id -> catalog item
    const catMap = new Map();
    if (Array.isArray(catalog)) {
        catalog.forEach(c => {
            if (c && c.id) catMap.set(c.id, c);
        });
    }

    const dutyStats = {};
    WORKLOAD_DUTIES_CONFIG.forEach(d => {
        dutyStats[d.code] = {
            ...d,
            plannedMinutes: 0,
            jpCount: 0,
            equivalentJp: 0,
            percentage: 0,
            segmentsCount: 0,
            categoryBuckets: {}
        };
    });

    let holidayMinutes = 0;
    let holidayCount = 0;
    let totalPlannedMinutes = 0;

    (segments || []).forEach(seg => {
        if (!seg) return;
        const plannedMin = Math.max(0, parseInt(seg.planned_minutes, 10) || 0);
        if (plannedMin <= 0) return;

        // Cek Libur
        const isHoliday = seg.is_holiday === true || seg.is_holiday === 1 || seg.catalog_id === 'cat_libur' || seg.category_code === 'HOLIDAY';
        if (isHoliday) {
            holidayMinutes += plannedMin;
            holidayCount++;
            totalPlannedMinutes += plannedMin;
            return;
        }

        // Resolusi kode tugas pokok & kategori: SSOT Katalog Kegiatan Resmi diutamakan
        let catId = seg.catalog_id;
        if (!catId && seg.activity_id && actMap.has(seg.activity_id)) {
            catId = actMap.get(seg.activity_id)?.catalog_id;
        }
        const catItem = (catId && catMap.has(catId)) ? catMap.get(catId) : null;

        let dutyCode = null;
        if (catItem && catItem.category_code && dutyStats[catItem.category_code]) {
            // Prioritas Utama (SSOT): Identifikasi dari katalog kegiatan resmi
            dutyCode = catItem.category_code;
        } else {
            // Prioritas Kedua: category_code tersimpan pada segmen/aktivitas jika valid standar (abaikan legacy seperti 'A')
            const segCode = seg.category_code;
            if (segCode && dutyStats[segCode]) {
                dutyCode = segCode;
            } else if (seg.activity_id && actMap.has(seg.activity_id)) {
                const act = actMap.get(seg.activity_id);
                if (act?.category_code && dutyStats[act.category_code]) {
                    dutyCode = act.category_code;
                }
            }
        }

        if (!dutyCode) {
            dutyCode = (seg.is_teaching || seg.catalog_id === 'cat_kbm') ? 'PELAKSANAAN_KBM' : 'PERENCANAAN';
        }

        dutyStats[dutyCode].plannedMinutes += plannedMin;
        dutyStats[dutyCode].segmentsCount += 1;
        const segJp = (seg.jp_count && Number(seg.jp_count) > 0)
            ? Number(seg.jp_count)
            : Math.round((plannedMin / 45) * 10) / 10;
        if (seg.jp_count && Number(seg.jp_count) > 0) {
            dutyStats[dutyCode].jpCount += Number(seg.jp_count);
        }
        totalPlannedMinutes += plannedMin;

        // Resolusi Kategori Kegiatan di bawah Tugas Pokok
        let categoryKey = '';
        let categoryName = '';
        let categoryDesc = '';

        if (catItem) {
            categoryKey = catItem.id;
            categoryName = catItem.name;
            categoryDesc = catItem.description || '';
        } else if (seg.is_teaching === 1 || seg.is_teaching === true || dutyCode === 'PELAKSANAAN_KBM') {
            categoryKey = 'cat_kbm';
            categoryName = 'KBM Tatap Muka Intrakurikuler di Kelas / Laboratorium';
            categoryDesc = 'Interaksi tatap muka langsung antara guru dan murid dalam pembelajaran mata pelajaran';
        } else {
            const cleanTitle = (seg.title || '').trim();
            categoryKey = cleanTitle ? `custom_${cleanTitle.toLowerCase()}` : `duty_${dutyCode}`;
            categoryName = cleanTitle || dutyStats[dutyCode].name;
            categoryDesc = seg.description || 'Kegiatan rencana kerja terstruktur mandiri';
        }

        if (!dutyStats[dutyCode].categoryBuckets[categoryKey]) {
            dutyStats[dutyCode].categoryBuckets[categoryKey] = {
                id: categoryKey,
                name: categoryName,
                description: categoryDesc,
                plannedMinutes: 0,
                jpCount: 0,
                segmentsCount: 0,
                segments: []
            };
        }

        const bucket = dutyStats[dutyCode].categoryBuckets[categoryKey];
        bucket.plannedMinutes += plannedMin;
        if (seg.jp_count && Number(seg.jp_count) > 0) {
            bucket.jpCount += Number(seg.jp_count);
        }
        bucket.segmentsCount += 1;

        const dayIdx = (seg.day_of_week != null) ? (Number(seg.day_of_week) - 1) : 0;
        const dayName = WORKLOAD_DAY_NAMES[dayIdx] || `Hari ke-${dayIdx + 1}`;
        bucket.segments.push({
            id: seg.id || '',
            date: seg.date || '',
            day_of_week: seg.day_of_week,
            day_name: dayName,
            start_time: seg.start_time || '',
            end_time: seg.end_time || '',
            title: seg.title || categoryName,
            planned_minutes: plannedMin,
            jp_count: segJp
        });
    });

    // Hitung JP dan persentase untuk setiap tugas pokok beserta rincian kategorinya
    const duties = WORKLOAD_DUTIES_CONFIG.map(d => {
        const stat = dutyStats[d.code];
        // 1 JP SMA = 45 menit
        const jp = stat.jpCount > 0 ? stat.jpCount : (Math.round((stat.plannedMinutes / 45) * 10) / 10);
        const pct = Math.round((stat.plannedMinutes / target) * 1000) / 10; // 1 desimal

        // Susun array categories terurut durasi terbesar
        const categories = Object.values(stat.categoryBuckets || {}).map(cat => {
            const catJp = cat.jpCount > 0 ? cat.jpCount : (Math.round((cat.plannedMinutes / 45) * 10) / 10);
            const catPct = stat.plannedMinutes > 0 ? Math.round((cat.plannedMinutes / stat.plannedMinutes) * 1000) / 10 : 0;
            // Urutkan segmen per hari dan jam
            cat.segments.sort((a, b) => {
                const dayDiff = (a.day_of_week || 1) - (b.day_of_week || 1);
                if (dayDiff !== 0) return dayDiff;
                return (a.start_time || '').localeCompare(b.start_time || '');
            });
            return {
                ...cat,
                equivalentJp: catJp,
                percentage: catPct
            };
        }).sort((a, b) => b.plannedMinutes - a.plannedMinutes);

        // Kategori katalog standar yang tersedia untuk tugas pokok ini
        const allocatedCatIds = new Set(categories.map(c => c.id));
        const availableCatalog = (catalog || [])
            .filter(c => c && c.category_code === d.code && !allocatedCatIds.has(c.id))
            .map(c => ({
                id: c.id,
                name: c.name,
                description: c.description || '',
                plannedMinutes: 0,
                equivalentJp: 0,
                segmentsCount: 0,
                isAllocated: false
            }));

        const cleanStat = { ...stat };
        delete cleanStat.categoryBuckets;

        return {
            ...cleanStat,
            equivalentJp: jp,
            percentage: pct,
            categories,
            availableCatalog
        };
    });

    const holidayPct = Math.round((holidayMinutes / target) * 1000) / 10;
    const totalPercentage = Math.round((totalPlannedMinutes / target) * 1000) / 10;
    const remainingMinutes = Math.max(0, target - totalPlannedMinutes);
    const remainingPercentage = Math.round((remainingMinutes / target) * 1000) / 10;

    return {
        targetMinutes: target,
        totalPlannedMinutes,
        totalPercentage,
        remainingMinutes,
        remainingPercentage,
        holidayMinutes,
        holidayCount,
        holidayPercentage: holidayPct,
        duties
    };
}

/**
 * Memeriksa apakah kegiatan pada tanggal dan jam tertentu sudah boleh dilaporkan realisasinya
 * Sesuai aturan: pada hari ini (WITA), kegiatan baru boleh dilaporkan jika waktu saat ini
 * telah mencapai jam berakhir kegiatan dikurangi toleransi (default 5 menit).
 *
 * @param {string} activityDate - Tanggal kegiatan 'YYYY-MM-DD'
 * @param {string} endTimeStr - Jam berakhir kegiatan 'HH:mm'
 * @param {number} [toleranceMinutes=5] - Toleransi menit sebelum jam berakhir
 * @param {number|null} [mockCurrentMinutes=null] - Mock menit saat ini untuk unit testing
 * @param {string|null} [mockToday=null] - Mock tanggal hari ini 'YYYY-MM-DD' untuk unit testing
 * @returns {{ allowed: boolean, allowedTimeStr: string, reason?: string }}
 */
export function canReportActivityNow(activityDate, endTimeStr, toleranceMinutes = 5, mockCurrentMinutes = null, mockToday = null) {
    let today = mockToday;
    if (!today) {
        const d = new Date(Date.now() + 8 * 3600000);
        today = d.toISOString().slice(0, 10);
    }
    if (!activityDate) return { allowed: true, allowedTimeStr: '' };

    if (activityDate > today) {
        return {
            allowed: false,
            allowedTimeStr: '',
            reason: `Tidak dapat melaporkan kegiatan untuk tanggal masa depan (${activityDate}).`
        };
    }

    if (activityDate < today) {
        return { allowed: true, allowedTimeStr: '' };
    }

    if (!endTimeStr || typeof endTimeStr !== 'string' || !endTimeStr.includes(':')) {
        return { allowed: true, allowedTimeStr: '' };
    }

    const endMinutes = timeStringToMinutes(endTimeStr);
    const allowedMinutes = Math.max(0, endMinutes - toleranceMinutes);
    let curMinutes = mockCurrentMinutes;
    if (curMinutes === null || curMinutes === undefined) {
        const d = new Date(Date.now() + 8 * 3600000);
        curMinutes = d.getUTCHours() * 60 + d.getUTCMinutes();
    }

    const allowedH = Math.floor(allowedMinutes / 60);
    const allowedM = allowedMinutes % 60;
    const allowedTimeStr = `${String(allowedH).padStart(2, '0')}:${String(allowedM).padStart(2, '0')}`;

    if (curMinutes < allowedMinutes) {
        return {
            allowed: false,
            allowedTimeStr,
            reason: `Kegiatan belum berakhir. Anda baru dapat melaporkan realisasi mulai pukul ${allowedTimeStr} WITA (toleransi 5 menit sebelum jam ${endTimeStr} WITA).`
        };
    }

    return { allowed: true, allowedTimeStr };
}

/**
 * Menentukan status terlipat (collapsed) ringkasan komposisi rencana tugas pokok
 * Sesuai aturan Smart Adaptive:
 * - Draf atau Perlu Revisi -> Terbuka (false) agar guru mudah memantau target 37,5 jam
 * - Diajukan (submitted) atau Difinalisasi/Disetujui (approved) -> Terlipat (true) agar hemat ruang
 * - Override manual (boolean true/false) diutamakan
 * - Di layar HP/mobile, default otomatis terlipat (auto collapse) agar hemat ruang vertikal
 * @param {string|undefined} versionStatus - Status versi rencana (draft, needs_revision, submitted, approved)
 * @param {boolean|null} manual - Override preferensi manual pengguna
 * @param {boolean} [isMobile=false] - Indikator viewport mobile (< 768px)
 * @returns {boolean} true jika terlipat, false jika terbuka
 */
export function resolveDutySummaryCollapsed(versionStatus, manual, isMobile = false) {
    if (manual === true || manual === false) return manual;
    if (isMobile) return true;
    return ['submitted', 'approved'].includes(versionStatus);
}

/**
 * Evaluasi gestur usap (swipe) horizontal untuk navigasi perpindahan minggu pada layar sentuh/HP
 * Standar: Pure function, 100% deterministik, 0 side-effect
 * Kriteria Gestur Usap Valid:
 * - Durasi usap cepat (30 ms <= elapsedMs <= 550 ms, membedakan gestur usap vs tap instan atau drag tahan lambat)
 * - Jarak tempuh horizontal signifikan (|deltaX| >= 55 px)
 * - Dominansi horizontal tegas (|deltaX| > |deltaY| * 1.5, mencegah bentrok dengan scroll vertikal halaman)
 * 
 * @param {number} deltaX - Selisih pergeseran sumbu X (clientX_end - clientX_start). Negatif = swipe ke kiri, Positif = swipe ke kanan.
 * @param {number} deltaY - Selisih pergeseran sumbu Y (clientY_end - clientY_start).
 * @param {number} elapsedMs - Durasi sentuhan dalam milidetik (timestamp_end - timestamp_start).
 * @returns {{ isValid: boolean, direction: 'next'|'prev'|null }}
 */
export function evaluateWeekSwipeGesture(deltaX, deltaY, elapsedMs) {
    if (typeof deltaX !== 'number' || typeof deltaY !== 'number' || typeof elapsedMs !== 'number' ||
        isNaN(deltaX) || isNaN(deltaY) || isNaN(elapsedMs)) {
        return { isValid: false, direction: null };
    }

    if (elapsedMs < 30 || elapsedMs > 550) {
        return { isValid: false, direction: null };
    }

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absX < 55) {
        return { isValid: false, direction: null };
    }

    if (absX <= absY * 1.5) {
        return { isValid: false, direction: null };
    }

    // deltaX < 0: Jari mengusap dari kanan ke kiri (swipe left) -> maju ke minggu depan (next)
    // deltaX > 0: Jari mengusap dari kiri ke kanan (swipe right) -> mundur ke minggu sebelumnya (prev)
    return {
        isValid: true,
        direction: deltaX < 0 ? 'next' : 'prev'
    };
}






