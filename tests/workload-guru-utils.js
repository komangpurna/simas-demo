/**
 * tests/workload-guru-utils.js
 * ====================================================================
 * Utility Kalkulasi & Rule Validator Beban Kerja Guru untuk Test Jest
 * Sesuai Permendikdasmen No. 11/2025 & Kebijakan Jam Kerja SMAGESA
 * ====================================================================
 */

const DEFAULT_WORKLOAD_POLICY = Object.freeze({
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

function timeStringToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const parts = timeStr.trim().split(':');
    if (parts.length < 2) return 0;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return 0;
    return Math.max(0, Math.min(1439, h * 60 + m));
}

function minutesToTimeString(totalMinutes) {
    if (typeof totalMinutes !== 'number' || isNaN(totalMinutes) || totalMinutes < 0) return '00:00';
    const clean = Math.floor(totalMinutes);
    const h = Math.floor(clean / 60) % 24;
    const m = clean % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDurationDisplay(minutes) {
    if (typeof minutes !== 'number' || isNaN(minutes) || minutes <= 0) return '0m';
    const clean = Math.floor(minutes);
    const hours = Math.floor(clean / 60);
    const mins = clean % 60;
    if (hours > 0 && mins > 0) return `${hours}j ${mins}m`;
    if (hours > 0) return `${hours}j`;
    return `${mins}m`;
}

function calculateEffectiveMinutes(
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

    let effective = endMin - startMin;

    if (Array.isArray(breaks) && breaks.length > 0) {
        for (const b of breaks) {
            const bStart = timeStringToMinutes(b.start);
            const bEnd = timeStringToMinutes(b.end);
            if (bStart < bEnd) {
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
 */
function findTimeOverlap(targetSegment, existingSegments = [], excludeId = null) {
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

function validateNoOverlap(segments) {
    if (!Array.isArray(segments) || segments.length <= 1) {
        return { isValid: true };
    }

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

function evaluateWorkloadRules({
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

    if (isBk) {
        result.isTeachingFulfill = safeBkRombel >= DEFAULT_WORKLOAD_POLICY.minBkRombel;
        result.teachingStatusText = result.isTeachingFulfill
            ? `Memenuhi (Membimbing ${safeBkRombel} rombel / min. 5 rombel per tahun - Pasal 13 ayat 2)`
            : `Belum Memenuhi (Membimbing ${safeBkRombel} rombel, kurang ${DEFAULT_WORKLOAD_POLICY.minBkRombel - safeBkRombel} rombel)`;
        result.recognizedEquivalencyJp = 0;
        result.totalAdministrativeJp = safeTeachingJp;
        return result;
    }

    let totalEligibleEquivalency = 0;

    const recognizedAssignmentTypes = {
        'wakasek': { jp: 12, title: 'Wakil Kepala Sekolah', maxCumulative: 1 },
        'kepala_lab': { jp: 12, title: 'Kepala Laboratorium', maxCumulative: 1 },
        'kepala_perpus': { jp: 12, title: 'Kepala Perpustakaan', maxCumulative: 1 },
        'wali_kelas': { jp: 2, title: 'Wali Kelas', maxCumulative: 1 },
        'pembina_osis': { jp: 2, title: 'Pembina OSIS', maxCumulative: 1 },
        'guru_wali': { jp: 2, title: 'Guru Wali', maxCumulative: 1 },
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

    const deficitTo24 = Math.max(0, DEFAULT_WORKLOAD_POLICY.minTeachingJp - safeTeachingJp);

    if (deficitTo24 === 0) {
        result.recognizedEquivalencyJp = 0;
        result.totalAdministrativeJp = safeTeachingJp;
        result.isTeachingFulfill = safeTeachingJp <= DEFAULT_WORKLOAD_POLICY.maxTeachingJp;
        result.teachingStatusText = `Memenuhi Beban Tatap Muka (${safeTeachingJp} JP KBM Riil)`;
        if (totalEligibleEquivalency > 0) {
            result.notes.push('Ekuivalensi tugas tambahan tidak diakumulasikan karena jam tatap muka riil sudah mencapai 24 JP (Pasal 17).');
        }
    } else {
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

function calculateWeekAggregates({
    workWeek = {},
    planSegments = [],
    workLogs = [],
    logSegments = [],
    planLogLinks = [],
    currentDateWita = ''
}) {
    const targetNormal = workWeek.target_minutes !== undefined ? workWeek.target_minutes : DEFAULT_WORKLOAD_POLICY.normalWeeklyMinutes;
    const adjustment = Math.max(0, parseInt(workWeek.approved_adjustment_minutes, 10) || 0);
    const netTarget = Math.max(0, targetNormal - adjustment);

    let totalPlannedMinutes = 0;
    let teachingPlannedMinutes = 0;
    let teachingJpCount = 0;

    if (Array.isArray(planSegments)) {
        for (const seg of planSegments) {
            const pMin = Math.max(0, parseInt(seg.planned_minutes, 10) || 0);
            totalPlannedMinutes += pMin;
            if (seg.is_teaching) {
                teachingPlannedMinutes += pMin;
                teachingJpCount += Math.max(0, parseInt(seg.jp_count, 10) || 0);
            }
        }
    }

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

    const remainingPlanMinutes = Math.max(0, netTarget - totalPlannedMinutes);
    const excessPlanMinutes = Math.max(0, totalPlannedMinutes - netTarget);
    const planAllocationComplete = totalPlannedMinutes >= netTarget;

    return {
        targetNormalMinutes: targetNormal,
        approvedAdjustmentMinutes: adjustment,
        netTargetMinutes: netTarget,
        plannedMinutes: totalPlannedMinutes,
        teachingPlannedMinutes,
        teachingJpCount,
        reportedActualMinutes,
        verifiedActualMinutes,
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

const WORKLOAD_DAY_NAMES = Object.freeze(['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat']);

function getDayDateString(weekStartDate, dayIndex = 0) {
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

function calculateDayTimelineSlots(dateStr, daySegments = [], options = {}) {
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
        (typeof options.isHolidayFn === 'function' && options.isHolidayFn(dateStr));

    if (holidaySeg || isExternalHoliday) {
        const holidayTitle = holidaySeg?.activity_title || holidaySeg?.title || holidaySeg?.description || 'Libur / Dispensasi Resmi Sekolah';
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

    // 1b. Deteksi Cuti / Izin (0 menit direncanakan)
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

function validateWeeklyPlanCompleteness(weekStartDate, segments = [], options = {}) {
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
        message = `Rencana mingguan belum dapat ${actionLabel} karena masih terdapat ${totalEmptySlotsCount} slot jam kosong (${totalEmptyMinutes} menit) pada hari: ${dayListText}. Silakan lengkapi kegiatan atau tandai libur sekolah.`;
    }

    // Cek kepatuhan Hari Belajar Guru jika options.studyDayIndex != null
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

function matchPlanSegmentWithJournal(segments, journal) {
    if (!Array.isArray(segments) || segments.length === 0 || !journal) return null;

    const cleanStr = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const normJournalClass = cleanStr(journal.kelas);
    const normJournalMapel = cleanStr(journal.mapel);

    let bestSegment = null;
    let highestScore = 0;

    for (const seg of segments) {
        const segTitle = cleanStr(seg.activity_title || seg.title || '');
        const segDesc = cleanStr(seg.description || '');
        const segText = segTitle + ' ' + segDesc;
        const normSegMapel = cleanStr(seg.mapel || '');
        const normSegClass = cleanStr(seg.className || '');

        // 1. Cek kecocokan mapel (syarat utama: mapel harus cocok)
        const hasMapelMatch = normJournalMapel && (
            segText.includes(normJournalMapel) ||
            (normSegMapel && (normJournalMapel.includes(normSegMapel) || normSegMapel.includes(normJournalMapel)))
        );
        if (!hasMapelMatch) {
            continue;
        }

        let score = 40;

        // 2. Cek kecocokan kelas
        const hasClassMatch = normJournalClass && (
            segText.includes(normJournalClass) ||
            (normSegClass && (normJournalClass.includes(normSegClass) || normSegClass.includes(normJournalClass)))
        );
        if (hasClassMatch) {
            score += 40;
        }

        // 3. Tambahan jika flag is_teaching atau category_code KBM
        if (seg.is_teaching || seg.category_code === 'PELAKSANAAN_KBM' || seg.catalog_id === 'cat_kbm') {
            score += 10;
        }

        // 4. Jika JP diberikan dan cocok
        if (journal.jp && seg.jp_count) {
            let journalJpCount = 0;
            if (Array.isArray(journal.jp)) {
                journalJpCount = journal.jp.length;
            } else if (typeof journal.jp === 'string') {
                try {
                    const parsed = JSON.parse(journal.jp);
                    if (Array.isArray(parsed)) journalJpCount = parsed.length;
                    else journalJpCount = 1;
                } catch {
                    if (journal.jp.includes('-')) {
                        const parts = journal.jp.split('-');
                        journalJpCount = Math.abs(parseInt(parts[1], 10) - parseInt(parts[0], 10)) + 1;
                    } else {
                        journalJpCount = 1;
                    }
                }
            }
            if (journalJpCount === seg.jp_count) {
                score += 10;
            }
        }

        if (score > highestScore) {
            highestScore = score;
            bestSegment = seg;
        }
    }

    if (highestScore >= 50 && bestSegment) {
        return { segment: bestSegment, score: highestScore };
    }

    return null;
}

/**
 * SE Mendikdasmen No. 5684/MDM.B1/HK.04.00/2025: Hari Belajar Guru
 * Deteksi hari tanpa KBM mengajar tatap muka sebagai Hari Belajar Guru (1x seminggu).
 */
function detectTeacherStudyDay(segments = [], options = {}) {
    const workDaysCount = options.workDaysCount || 5;
    const manualIndex = options.manualStudyDayIndex;

    // 1. Jika ada preferensi manual yang sah (0 s.d workDaysCount - 1)
    if (manualIndex !== null && manualIndex !== undefined && manualIndex >= 0 && manualIndex < workDaysCount) {
        return {
            studyDayIndex: Number(manualIndex),
            isAutoDetected: false,
            studyDayName: WORKLOAD_DAY_NAMES[manualIndex] || `Hari ke-${manualIndex + 1}`
        };
    }

    // 2. Hitung jumlah sesi mengajar (KBM) per hari (0 = Senin, dst.)
    const teachingPerDay = new Array(workDaysCount).fill(0);

    (segments || []).forEach(seg => {
        const dIdx = (seg.day_of_week != null) ? (seg.day_of_week - 1) : null;
        if (dIdx !== null && dIdx >= 0 && dIdx < workDaysCount) {
            const isTeaching = seg.is_teaching === 1 ||
                seg.category_code === 'PELAKSANAAN_KBM' ||
                seg.catalog_id === 'cat_kbm';
            if (isTeaching) {
                teachingPerDay[dIdx]++;
            }
        }
    });

    // Cek juga dari teacherSchedule jika ada
    if (options.teacherSchedule && options.teacherSchedule.days) {
        for (let day = 1; day <= workDaysCount; day++) {
            const dIdx = day - 1;
            const slots = options.teacherSchedule.days[day] || [];
            if (slots.length > 0) {
                teachingPerDay[dIdx] += slots.length;
            }
        }
    }

    // 3. Cari hari yang sama sekali TIDAK ADA jam mengajar KBM (teachingPerDay === 0)
    for (let i = 0; i < workDaysCount; i++) {
        if (teachingPerDay[i] === 0) {
            return {
                studyDayIndex: i,
                isAutoDetected: true,
                studyDayName: WORKLOAD_DAY_NAMES[i] || `Hari ke-${i + 1}`
            };
        }
    }

    // 4. Jika semua hari ada KBM, pilih hari dengan sesi KBM paling sedikit
    let minKbmIndex = workDaysCount - 1;
    let minKbmCount = Infinity;
    for (let i = 0; i < workDaysCount; i++) {
        if (teachingPerDay[i] < minKbmCount) {
            minKbmCount = teachingPerDay[i];
            minKbmIndex = i;
        }
    }

    return {
        studyDayIndex: minKbmIndex,
        isAutoDetected: false,
        studyDayName: WORKLOAD_DAY_NAMES[minKbmIndex] || `Hari ke-${minKbmIndex + 1}`
    };
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
function isStudyDayCompliantActivity(seg) {
    if (!seg) return false;
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
 */
function checkHasPkActivity(segments = [], targetDayIndex = null) {
    return (segments || []).some(seg => {
        if (targetDayIndex !== null && targetDayIndex !== undefined) {
            const dIdx = (seg.day_of_week != null) ? (seg.day_of_week - 1) : null;
            if (dIdx !== targetDayIndex) return false;
        }
        return isStudyDayCompliantActivity(seg);
    });
}

function todayWITA() {
    return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

function currentTimeMinutesWITA() {
    const d = new Date(Date.now() + 8 * 3600000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * Memeriksa apakah kegiatan pada tanggal dan jam tertentu sudah boleh dilaporkan realisasinya
 * Sesuai aturan: pada hari ini (todayWITA), kegiatan baru boleh dilaporkan jika waktu saat ini
 * telah mencapai jam berakhir kegiatan dikurangi toleransi (default 10 menit).
 *
 * @param {string} activityDate - Tanggal kegiatan 'YYYY-MM-DD'
 * @param {string} endTimeStr - Jam berakhir kegiatan 'HH:mm'
 * @param {number} [toleranceMinutes=5] - Toleransi menit sebelum jam berakhir
 * @param {number|null} [mockCurrentMinutes=null] - Mock menit saat ini untuk keperluan unit test
 * @param {string|null} [mockToday=null] - Mock tanggal hari ini untuk keperluan unit test
 * @returns {{ allowed: boolean, allowedTimeStr: string, reason?: string }}
 */
function canReportActivityNow(activityDate, endTimeStr, toleranceMinutes = 5, mockCurrentMinutes = null, mockToday = null) {
    const today = mockToday || todayWITA();
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
    const curMinutes = (mockCurrentMinutes !== null && mockCurrentMinutes !== undefined) ? mockCurrentMinutes : currentTimeMinutesWITA();

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
 * Memeriksa apakah sinkronisasi senyap otomatis dari Jurnal Mengajar (Jalur C) boleh dipicu.
 * Ketentuan:
 * 1. Hanya aktif paling cepat pukul 15:00 WITA (900 menit) saat seluruh jam KBM selesai.
 * 2. Dibatasi maksimal 1 kali per hari kerja per guru, disimpan secara persisten di localStorage.
 */
function canTriggerSilentJournalSync(dayDate = null, mockCurrentMinutes = null, mockToday = null, mockTeacherId = 'me', storageMock = null) {
    const today = mockToday || todayWITA();
    const isPastDay = Boolean(dayDate && dayDate < today);

    // 1. Verifikasi waktu kedinasan:
    // Jika mengecek hari yang sudah lampau (past day < today), KBM sudah selesai penuh, jadi bypass batas jam 15:00 WITA.
    // Jika mengecek hari ini (current day), minimal pukul 15:00 WITA (15 * 60 = 900 menit) saat jam KBM sekolah selesai.
    const currentMins = (mockCurrentMinutes !== null && mockCurrentMinutes !== undefined) ? mockCurrentMinutes : currentTimeMinutesWITA();
    if (!isPastDay && currentMins < 15 * 60) {
        return {
            allowed: false,
            storageKey: '',
            reason: 'Di bawah pukul 15:00 WITA (menunggu Jalur A dan Jalur B)'
        };
    }

    // 2. Verifikasi kuota via localStorage (1x per target date)
    const effectiveTeacherId = mockTeacherId || 'me';
    const targetDateKey = (dayDate && dayDate < today) ? dayDate : today;
    const storageKey = `simas_wl_journal_autosync_${effectiveTeacherId}_${targetDateKey}`;

    const store = storageMock || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (store && typeof store.getItem === 'function') {
        try {
            if (store.getItem(storageKey) === '1') {
                return {
                    allowed: false,
                    storageKey,
                    reason: targetDateKey === today
                        ? `Sudah disinkronkan hari ini untuk guru ${effectiveTeacherId}`
                        : `Sudah disinkronkan untuk tanggal ${targetDateKey} guru ${effectiveTeacherId}`
                };
            }
        } catch (e) {}
    }

    return { allowed: true, storageKey };
}

/**
 * Konstanta 5 Tugas Pokok Guru Sesuai Permendikdasmen No. 11/2025 (Pasal 3 & 4)
 */
const WORKLOAD_DUTIES_CONFIG = Object.freeze([
    {
        code: 'PELAKSANAAN_KBM',
        name: 'Pelaksanaan Pembelajaran',
        fullName: '1. Pelaksanaan Pembelajaran (KBM Tatap Muka)',
        shortName: 'Pelaksanaan Pembelajaran',
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
 */
function calculateDutyAllocationSummary(
    segments = [],
    activities = [],
    catalog = [],
    targetWeeklyMinutes = DEFAULT_WORKLOAD_POLICY.normalWeeklyMinutes
) {
    const target = Math.max(1, parseInt(targetWeeklyMinutes, 10) || DEFAULT_WORKLOAD_POLICY.normalWeeklyMinutes);

    const actMap = new Map();
    if (Array.isArray(activities)) {
        activities.forEach(a => {
            if (a && a.id) actMap.set(a.id, a);
        });
    }

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

        const isHoliday = seg.is_holiday === true || seg.is_holiday === 1 || seg.catalog_id === 'cat_libur' || seg.category_code === 'HOLIDAY';
        if (isHoliday) {
            holidayMinutes += plannedMin;
            holidayCount++;
            totalPlannedMinutes += plannedMin;
            return;
        }

        // Resolusi item katalog (SSOT)
        let catId = seg.catalog_id;
        if (!catId && seg.activity_id && actMap.has(seg.activity_id)) {
            catId = actMap.get(seg.activity_id)?.catalog_id;
        }
        const catItem = (catId && catMap.has(catId)) ? catMap.get(catId) : null;

        // Resolusi kode tugas pokok:
        // Prioritas Utama: SSOT dari Katalog Resmi (activity_catalog) jika catalog_id valid
        let dutyCode = null;
        if (catItem && catItem.category_code && dutyStats[catItem.category_code]) {
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

    const duties = WORKLOAD_DUTIES_CONFIG.map(d => {
        const stat = dutyStats[d.code];
        const jp = stat.jpCount > 0 ? stat.jpCount : (Math.round((stat.plannedMinutes / 45) * 10) / 10);
        const pct = Math.round((stat.plannedMinutes / target) * 1000) / 10;

        const categories = Object.values(stat.categoryBuckets || {}).map(cat => {
            const catJp = cat.jpCount > 0 ? cat.jpCount : (Math.round((cat.plannedMinutes / 45) * 10) / 10);
            const catPct = stat.plannedMinutes > 0 ? Math.round((cat.plannedMinutes / stat.plannedMinutes) * 1000) / 10 : 0;
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

function countWeekWorkHolidays(weekStartDate, segments = [], options = {}) {
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

function calculateAdjustedWeeklyTarget(weekStartDate, segments = [], options = {}) {
    const policy = options.policy || DEFAULT_WORKLOAD_POLICY;
    const workDaysCount = options.workDaysCount || policy.workDaysCount || DEFAULT_WORKLOAD_POLICY.workDaysCount || 5;
    const dailyMinutes = options.normalDailyMinutes || policy.normalDailyMinutes || DEFAULT_WORKLOAD_POLICY.normalDailyMinutes || 450;
    const baseTargetMinutes = options.baseTargetMinutes || (workDaysCount * dailyMinutes);

    const holidayInfo = countWeekWorkHolidays(weekStartDate, segments, options);
    const holidayDeductionMinutes = holidayInfo.holidayCount * dailyMinutes;
    const adjustedTargetMinutes = Math.max(0, baseTargetMinutes - holidayDeductionMinutes);

    return {
        baseTargetMinutes,
        targetMinutes: adjustedTargetMinutes,
        holidayCount: holidayInfo.holidayCount,
        holidayDeductionMinutes,
        adjustedTargetMinutes,
        holidayDates: holidayInfo.holidayDates,
        effectiveWorkDaysCount: holidayInfo.effectiveWorkDaysCount
    };
}

function resolveDutySummaryCollapsed(versionStatus, manual, isMobile = false) {
    if (manual === true || manual === false) return manual;
    if (isMobile) return true;
    return ['submitted', 'approved'].includes(versionStatus);
}

function evaluateWeekSwipeGesture(deltaX, deltaY, elapsedMs) {
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

    return {
        isValid: true,
        direction: deltaX < 0 ? 'next' : 'prev'
    };
}

module.exports = {
    DEFAULT_WORKLOAD_POLICY,
    WORKLOAD_DAY_NAMES,
    WORKLOAD_DUTIES_CONFIG,
    calculateDutyAllocationSummary,
    timeStringToMinutes,
    minutesToTimeString,
    formatDurationDisplay,
    calculateEffectiveMinutes,
    findTimeOverlap,
    validateNoOverlap,
    evaluateWorkloadRules,
    calculateWeekAggregates,
    getDayDateString,
    calculateDayTimelineSlots,
    validateWeeklyPlanCompleteness,
    countWeekWorkHolidays,
    calculateAdjustedWeeklyTarget,
    matchPlanSegmentWithJournal,
    detectTeacherStudyDay,
    checkHasPkActivity,
    isStudyDayCompliantActivity,
    todayWITA,
    currentTimeMinutesWITA,
    canReportActivityNow,
    canTriggerSilentJournalSync,
    resolveDutySummaryCollapsed,
    evaluateWeekSwipeGesture
};
