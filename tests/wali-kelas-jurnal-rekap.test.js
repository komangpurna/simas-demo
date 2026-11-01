/**
 * tests/wali-kelas-jurnal-rekap.test.js
 * Unit test pengujian logika rentang pekan KBM (Senin-Jumat), format JP, rekapitulasi presensi,
 * rekonsiliasi jadwal aSc & guru_presensi, pembangun lembar cetak A4 landscape dinas, dan integrasi markup.
 */

const fs = require('fs');
const path = require('path');

// Replikasi algoritma SSOT dari js/wali-kelas-jurnal.js untuk pengujian unit independen
function calculateWeekRange(refDateInput) {
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

    const dayOfWeek = d.getDay();
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
    const endIso = formatIso(friday);
    const fullWeekEndIso = formatIso(sunday);

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

function parseJpNumbers(jp) {
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

function groupScheduleSlots(daySchedule) {
    if (!Array.isArray(daySchedule) || daySchedule.length === 0) return [];

    const blocks = [];
    let currentBlock = null;

    for (let jp = 1; jp <= 10; jp++) {
        const slot = daySchedule.find(s => s && s.jp === jp);
        const mapel = (slot?.mapel || '').trim();
        const guruNama = (slot?.guruNama || slot?.xmlGuruName || '').trim();

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

function normalizeGuruPresensiStatus(status) {
    if (!status) return '-';
    const s = String(status).trim().toUpperCase();
    if (s === 'H' || s === 'HADIR') return 'Hadir';
    if (s === 'S' || s === 'SAKIT') return 'Sakit';
    if (s === 'I' || s === 'IZIN') return 'Izin';
    if (s === 'TK' || s === 'A' || s === 'ALPA' || s === 'ALPHA') return 'Tanpa Keterangan';
    if (s === 'D' || s === 'K' || s === 'DISPEN' || s === 'DISPENSASI' || s === 'DINAS') return 'Tugas Dinas';
    if (s === 'TL' || s === 'TERLAMBAT') return 'Terlambat';
    return status;
}

function formatAdaTugasLabel(adaTugas) {
    if (adaTugas === true || adaTugas === 'true' || adaTugas === 1) return 'Ada Tugas';
    if (adaTugas === false || adaTugas === 'false' || adaTugas === 0) return 'Tanpa Tugas';
    return '-';
}

const JP_TIME_CONFIG = [
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

function getAngkatanFromClass(className) {
    if (!className) return 'OTHER';
    const clean = String(className).trim().replace(/^KELAS\s+/i, '').toUpperCase();
    if (clean.startsWith('XII') || clean.startsWith('12')) return 'XII';
    if (clean.startsWith('XI') || clean.startsWith('11')) return 'XI';
    if (clean.startsWith('X') || clean.startsWith('10')) return 'X';
    const m = clean.match(/^(X|XI|XII|\d+)/i);
    return m ? m[1].toUpperCase() : 'OTHER';
}

function isJPElapsed(jpNum, dateStr) {
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

function buildWeeklyKbmActivityMap({ schoolJurnalEntries = [], weekInfo = null }) {
    const nonEffectiveDates = new Set();
    const tidakEfektifAngkatanMap = {};

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

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

        const isPastOrToday = dateStr <= todayStr;
        if (isPastOrToday && activeClassesOnDate.size <= 5) {
            nonEffectiveDates.add(dateStr);
        }

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

function detectTidakBelajarEfektif({ dateStr = '', jpList = [], mapel = '', guru = '', rawStatus = '', topik = '', catatan = '', agendaEvents = [], holidayInfo = null, className = '', kbmActivityMap = null }) {
    if (holidayInfo) {
        const hTitle = holidayInfo?.title || holidayInfo?.nama || holidayInfo?.name || 'Hari Libur Resmi';
        return {
            isTidakEfektif: true,
            kategori: 'LIBUR',
            label: hTitle,
            keterangan: holidayInfo?.description || `Hari Libur Resmi: ${hTitle}`
        };
    }

    const nonEfektifKeywords = [
        'tidak belajar efektif', 'tidak efektif',
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
        dayOfWeek = dateObj.getDay();
    }

    const numJpList = Array.isArray(jpList) ? jpList.map(Number).filter(n => !isNaN(n)) : [];

    if (dayOfWeek === 1 && numJpList.includes(1)) {
        return { isTidakEfektif: true, kategori: 'UPACARA', label: 'Upacara Bendera', keterangan: 'Upacara Bendera Sekolah (Senin JP 1)' };
    }

    if (dayOfWeek === 5 && numJpList.includes(10)) {
        return { isTidakEfektif: true, kategori: 'EKSKUL', label: 'Ekstrakurikuler', keterangan: 'Kegiatan Ekstrakurikuler Sekolah (Jumat JP 10)' };
    }

    const st = String(rawStatus || '').trim().toUpperCase();
    if (st === 'K' || st === 'KEGIATAN' || st === 'TE' || st === 'TIDAK_EFEKTIF' || st === 'ACARA') {
        return { isTidakEfektif: true, kategori: 'KEGIATAN_SEKOLAH', label: matchedAgendaTitle || 'Kegiatan Sekolah', keterangan: 'Kegiatan Sekolah (Presensi Siswa)' };
    }

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
            return { isTidakEfektif: true, kategori: 'ACARA_SEKOLAH', label, keterangan: `Agenda Sekolah: ${label}` };
        }
    }

    if (kbmActivityMap) {
        if (kbmActivityMap.nonEffectiveDates && kbmActivityMap.nonEffectiveDates.has(dateStr)) {
            const label = matchedAgendaTitle || 'Dispensasi Khusus / Acara Sekolah';
            return {
                isTidakEfektif: true,
                kategori: 'KEGIATAN_SEKOLAH',
                label,
                keterangan: 'Tidak Belajar Efektif (Aktivitas KBM Sekolah Non-Efektif)'
            };
        }

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

    return { isTidakEfektif: false, kategori: '', label: '', keterangan: '' };
}

function reconcileWeeklyJurnalData({ weekInfo, className, jurnalEntries = [], guruPresensiList = [], weeklyScheduleMap = {}, agendaEvents = [], kbmActivityMap = null }) {
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

    const monday = new Date(weekInfo.mondayDate);
    for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
        const currentDate = new Date(monday);
        currentDate.setDate(monday.getDate() + dayOffset);
        const y = currentDate.getFullYear();
        const m = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');
        const dateStr = `${y}-${m}-${day}`;

        const dayAgendaEvents = (agendaEvents || []).filter(ev => {
            const evStart = String(ev.date || '').split('T')[0];
            const evEnd = String(ev.endDate || ev.time || ev.date || '').split('T')[0];
            return evStart && dateStr >= evStart && dateStr <= (evEnd || evStart);
        });

        const daySchedule = weeklyScheduleMap[dateStr] || [];
        const scheduleBlocks = groupScheduleSlots(daySchedule);

        scheduleBlocks.forEach(block => {
            let matchedJurnal = null;

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

            let presensiRow = null;
            for (const jp of block.jpList) {
                const pr = guruPresensiMap.get(`${dateStr}_${jp}`);
                if (pr) {
                    presensiRow = pr;
                    const st = (pr.status || '').toUpperCase();
                    if (st && st !== 'H' && st !== 'HADIR') break;
                }
            }

            const teCheck = detectTidakBelajarEfektif({
                dateStr,
                jpList: block.jpList,
                mapel: block.mapel,
                guru: block.guruNama,
                rawStatus: presensiRow?.status || '',
                topik: matchedJurnal?.topik || '',
                catatan: matchedJurnal?.catatan || '',
                agendaEvents: dayAgendaEvents,
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

    (jurnalEntries || []).forEach(j => {
        if (!usedJurnalIds.has(j.id)) {
            const jDate = (j.tanggal || '').trim();
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

function formatJpDisplay(jp) {
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

function getMinJp(jp) {
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

function calculateJpCount(jp) {
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

function getIndoDayName(isoDate) {
    if (!isoDate) return '-';
    const [y, m, d] = isoDate.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d, 12, 0, 0);
    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    return dayNames[dateObj.getDay()] || '-';
}

function parsePresensiSummary(presensiDetail) {
    if (!presensiDetail || !Array.isArray(presensiDetail) || presensiDetail.length === 0) {
        return {
            hasAbsent: false,
            s: 0,
            i: 0,
            a: 0,
            d: 0,
            totalAbsent: 0,
            textSummary: 'Nihil (Hadir Semua)'
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
            textSummary: 'Nihil (Hadir Semua)'
        };
    }

    const parts = [];
    if (sList.length > 0) parts.push(`S (${sList.length}): ${sList.join(', ')}`);
    if (iList.length > 0) parts.push(`I (${iList.length}): ${iList.join(', ')}`);
    if (aList.length > 0) parts.push(`A (${aList.length}): ${aList.join(', ')}`);
    if (dList.length > 0) parts.push(`D (${dList.length}): ${dList.join(', ')}`);

    return {
        hasAbsent: true,
        s: sList.length,
        i: iList.length,
        a: aList.length,
        d: dList.length,
        totalAbsent,
        textSummary: parts.join('; ')
    };
}

describe('1. Pengujian Logika Rentang Pekan Hari Belajar KBM (calculateWeekRange: Senin - Jumat)', () => {
    test('Hari Rabu (2026-09-23) menghasilkan rentang Senin (2026-09-21) s.d. Jumat (2026-09-25)', () => {
        const res = calculateWeekRange('2026-09-23');
        expect(res.startDateIso).toBe('2026-09-21');
        expect(res.endDateIso).toBe('2026-09-25');
        expect(res.queryEndDateIso).toBe('2026-09-27');
        expect(res.rangeLabel).toBe('21 - 25 September 2026');
        expect(res.fullLabel).toContain('Pekan');
        expect(res.fullLabel).toContain('21 - 25 September 2026');
    });

    test('Hari Senin (2026-09-21) menghasilkan rentang pekan yang sama persis', () => {
        const res = calculateWeekRange('2026-09-21');
        expect(res.startDateIso).toBe('2026-09-21');
        expect(res.endDateIso).toBe('2026-09-25');
    });

    test('Hari Minggu (2026-09-27) diarahkan ke pekan yang baru selesai (Senin 2026-09-21 s.d. Jumat 2026-09-25)', () => {
        const res = calculateWeekRange('2026-09-27');
        expect(res.startDateIso).toBe('2026-09-21');
        expect(res.endDateIso).toBe('2026-09-25');
    });

    test('Rentang lintas bulan (misal 31 Agustus 2026 s.d. 4 September 2026) diformat dengan benar', () => {
        const res = calculateWeekRange('2026-09-02');
        expect(res.startDateIso).toBe('2026-08-31');
        expect(res.endDateIso).toBe('2026-09-04');
        expect(res.rangeLabel).toBe('31 Agustus - 4 September 2026');
    });

    test('Input Date object valid diproses dengan tepat tanpa timezone shift', () => {
        const d = new Date(2026, 8, 23, 15, 30);
        const res = calculateWeekRange(d);
        expect(res.startDateIso).toBe('2026-09-21');
        expect(res.endDateIso).toBe('2026-09-25');
    });
});

describe('2. Pengujian Format Jam Pembelajaran (JP), Parsing & Pengelompokan Slot Jadwal', () => {
    test('Array angka [1, 2] diformat menjadi "1 - 2"', () => {
        expect(formatJpDisplay([1, 2])).toBe('1 - 2');
    });

    test('parseJpNumbers mengurai string, JSON, atau array menjadi deretan integer', () => {
        expect(parseJpNumbers([1, 2])).toEqual([1, 2]);
        expect(parseJpNumbers('[3, 4]')).toEqual([3, 4]);
        expect(parseJpNumbers('5-6')).toEqual([5, 6]);
        expect(parseJpNumbers('7')).toEqual([7]);
        expect(parseJpNumbers(null)).toEqual([]);
    });

    test('groupScheduleSlots mengelompokkan jam berurutan dengan mapel dan guru sama', () => {
        const slots = [
            { jp: 1, mapel: 'Matematika', guruNama: 'I Wayan Koster', guruId: 'G1' },
            { jp: 2, mapel: 'Matematika', guruNama: 'I Wayan Koster', guruId: 'G1' },
            { jp: 3, mapel: 'Bahasa Bali', guruNama: 'Ni Wayan Sari', guruId: 'G2' },
            { jp: 4, mapel: 'Bahasa Bali', guruNama: 'Ni Wayan Sari', guruId: 'G2' },
            { jp: 5, mapel: '', guruNama: '' } // jam kosong
        ];
        const blocks = groupScheduleSlots(slots);
        expect(blocks.length).toBe(2);
        expect(blocks[0].jpList).toEqual([1, 2]);
        expect(blocks[0].mapel).toBe('Matematika');
        expect(blocks[0].guruNama).toBe('I Wayan Koster');
        expect(blocks[1].jpList).toEqual([3, 4]);
        expect(blocks[1].mapel).toBe('Bahasa Bali');
        expect(blocks[1].guruNama).toBe('Ni Wayan Sari');
    });

    test('normalizeGuruPresensiStatus dan formatAdaTugasLabel memformat status resmi', () => {
        expect(normalizeGuruPresensiStatus('S')).toBe('Sakit');
        expect(normalizeGuruPresensiStatus('I')).toBe('Izin');
        expect(normalizeGuruPresensiStatus('TK')).toBe('Tanpa Keterangan');
        expect(normalizeGuruPresensiStatus('H')).toBe('Hadir');

        expect(formatAdaTugasLabel(true)).toBe('Ada Tugas');
        expect(formatAdaTugasLabel('true')).toBe('Ada Tugas');
        expect(formatAdaTugasLabel(false)).toBe('Tanpa Tugas');
        expect(formatAdaTugasLabel('false')).toBe('Tanpa Tugas');
        expect(formatAdaTugasLabel(null)).toBe('-');
    });
});

describe('3. Pengujian Rekonsiliasi Jurnal Mingguan & Presensi Guru Siswa (reconcileWeeklyJurnalData)', () => {
    const weekInfo = calculateWeekRange('2026-09-23');

    test('Guru tetap dimunculkan dari jadwal aSc sekalipun guru TIDAK mengisi jurnal', () => {
        const weeklyScheduleMap = {
            '2026-09-22': [ // Hari Selasa
                { jp: 1, mapel: 'Fisika', guruNama: 'Dr. I Made Fisikawan', guruId: 'G_FIS' },
                { jp: 2, mapel: 'Fisika', guruNama: 'Dr. I Made Fisikawan', guruId: 'G_FIS' }
            ]
        };

        const res = reconcileWeeklyJurnalData({
            weekInfo,
            className: 'XII-F1',
            jurnalEntries: [], // jurnal KBM D1 kosong
            guruPresensiList: [],
            weeklyScheduleMap
        });

        expect(res.length).toBe(1);
        expect(res[0].guru).toBe('Dr. I Made Fisikawan');
        expect(res[0].mapel).toBe('Fisika');
        expect(res[0].jp).toEqual([1, 2]);
        expect(res[0].is_unfilled).toBe(true);
        expect(res[0].topik).toBe('[Jurnal Belum Diisi Guru]');
        expect(res[0].ttd).toBeNull();
    });

    test('Mencantumkan status ketidakhadiran guru oleh siswa serta penugasan (Ada Tugas / Tanpa Tugas)', () => {
        const weeklyScheduleMap = {
            '2026-09-22': [ // Hari Selasa
                { jp: 1, mapel: 'Kimia', guruNama: 'Ni Nyoman Kimiawati', guruId: 'G_KIM' },
                { jp: 2, mapel: 'Kimia', guruNama: 'Ni Nyoman Kimiawati', guruId: 'G_KIM' },
                { jp: 3, mapel: 'Biologi', guruNama: 'I Ketut Biolog', guruId: 'G_BIO' },
                { jp: 4, mapel: 'Biologi', guruNama: 'I Ketut Biolog', guruId: 'G_BIO' }
            ]
        };

        const guruPresensiList = [
            // Kimia: Guru Izin, ada penugasan
            { tanggal: '2026-09-22', jp: 1, status: 'I', ada_tugas: true },
            // Biologi: Guru Sakit, tanpa tugas
            { tanggal: '2026-09-22', jp: 3, status: 'S', ada_tugas: false }
        ];

        const res = reconcileWeeklyJurnalData({
            weekInfo,
            className: 'XI-1',
            jurnalEntries: [],
            guruPresensiList,
            weeklyScheduleMap
        });

        expect(res.length).toBe(2);

        // Kimia: Izin • Ada Tugas
        expect(res[0].guru).toBe('Ni Nyoman Kimiawati');
        expect(res[0].is_guru_absent).toBe(true);
        expect(res[0].guru_presensi_label).toBe('Izin');
        expect(res[0].ada_tugas).toBe(true);
        expect(res[0].ada_tugas_label).toBe('Ada Tugas');
        expect(res[0].topik).toContain('Guru Tidak Hadir (Izin) • Ada Tugas');

        // Biologi: Sakit • Tanpa Tugas
        expect(res[1].guru).toBe('I Ketut Biolog');
        expect(res[1].is_guru_absent).toBe(true);
        expect(res[1].guru_presensi_label).toBe('Sakit');
        expect(res[1].ada_tugas).toBe(false);
        expect(res[1].ada_tugas_label).toBe('Tanpa Tugas');
        expect(res[1].topik).toContain('Guru Tidak Hadir (Sakit) • Tanpa Tugas');
    });

    test('Jurnal yang terisi guru tetap mempertahankan materi pokok dan data absensi siswa', () => {
        const weeklyScheduleMap = {
            '2026-09-22': [
                { jp: 1, mapel: 'Matematika', guruNama: 'Guru MTK', guruId: 'G_MTK' },
                { jp: 2, mapel: 'Matematika', guruNama: 'Guru MTK', guruId: 'G_MTK' }
            ]
        };

        const jurnalEntries = [
            {
                id: 'jurnal_101',
                tanggal: '2026-09-22',
                jp: [1, 2],
                mapel: 'Matematika',
                guru: 'Guru MTK',
                topik: 'Operasi Aljabar Lanjutan',
                presensi_detail: [{ nis: '101', nama: 'Siswa A', status: 'S' }],
                ttd: 'data:image/png;base64,mockSign'
            }
        ];

        const res = reconcileWeeklyJurnalData({
            weekInfo,
            className: 'X-1',
            jurnalEntries,
            guruPresensiList: [{ tanggal: '2026-09-22', jp: 1, status: 'H', ada_tugas: null }],
            weeklyScheduleMap
        });

        expect(res.length).toBe(1);
        expect(res[0].is_unfilled).toBe(false);
        expect(res[0].topik).toBe('Operasi Aljabar Lanjutan');
        expect(res[0].ttd).toBe('data:image/png;base64,mockSign');
    });

    test('Agenda Sekolah Cloudflare D1 (Bulan Bahasa: Selasa & Rabu) otomatis terdeteksi Tidak Belajar Efektif', () => {
        const weekInfoOkt = calculateWeekRange('2026-10-21'); // Pekan 19 - 23 Okt 2026
        const weeklyScheduleMap = {
            '2026-10-20': [ // Selasa
                { jp: 1, mapel: 'Matematika', guruNama: 'I Made Guru', guruId: 'G_MTK' },
                { jp: 2, mapel: 'Matematika', guruNama: 'I Made Guru', guruId: 'G_MTK' }
            ],
            '2026-10-21': [ // Rabu
                { jp: 3, mapel: 'Fisika', guruNama: 'Ni Nyoman Fisika', guruId: 'G_FIS' },
                { jp: 4, mapel: 'Fisika', guruNama: 'Ni Nyoman Fisika', guruId: 'G_FIS' }
            ],
            '2026-10-22': [ // Kamis KBM biasa
                { jp: 1, mapel: 'Biologi', guruNama: 'Guru Bio', guruId: 'G_BIO' },
                { jp: 2, mapel: 'Biologi', guruNama: 'Guru Bio', guruId: 'G_BIO' }
            ]
        };

        const agendaEvents = [
            {
                id: 'evt_bulan_bahasa',
                title: 'Bulan Bahasa',
                category: 'kegiatan',
                date: '2026-10-20',
                endDate: '2026-10-21',
                description: 'Lomba & Acara Bulan Bahasa Tingkat Sekolah'
            }
        ];

        const res = reconcileWeeklyJurnalData({
            weekInfo: weekInfoOkt,
            className: 'XII-F4',
            jurnalEntries: [], // Belum diisi jurnal guru
            guruPresensiList: [],
            weeklyScheduleMap,
            agendaEvents
        });

        expect(res.length).toBe(3);

        // Selasa (20-10-2026) -> Terdeteksi Tidak Belajar Efektif Bulan Bahasa
        expect(res[0].tanggal).toBe('2026-10-20');
        expect(res[0].is_tidak_efektif).toBe(true);
        expect(res[0].te_label).toBe('Bulan Bahasa');
        expect(res[0].te_kategori).toBe('KEGIATAN_SEKOLAH');
        expect(res[0].topik).toBe('[Tidak Belajar Efektif] Bulan Bahasa');
        expect(res[0].is_unfilled).toBe(false);

        // Rabu (21-10-2026) -> Terdeteksi Tidak Belajar Efektif Bulan Bahasa
        expect(res[1].tanggal).toBe('2026-10-21');
        expect(res[1].is_tidak_efektif).toBe(true);
        expect(res[1].te_label).toBe('Bulan Bahasa');
        expect(res[1].te_kategori).toBe('KEGIATAN_SEKOLAH');
        expect(res[1].topik).toBe('[Tidak Belajar Efektif] Bulan Bahasa');
        expect(res[1].is_unfilled).toBe(false);

        // Kamis (22-10-2026) -> KBM biasa tanpa agenda, jurnal belum terisi
        expect(res[2].tanggal).toBe('2026-10-22');
        expect(res[2].is_tidak_efektif).toBe(false);
        expect(res[2].is_unfilled).toBe(true);
        expect(res[2].topik).toBe('[Jurnal Belum Diisi Guru]');
    });

    test('Paritas Penuh Monitoring KBM: Hari Tidak Belajar Efektif Otomatis Terdeteksi MESKIPUN TIDAK TERTULIS DI AGENDA KALENDER', () => {
        const weekInfoNov = calculateWeekRange('2026-10-21'); // Pekan 19 - 23 Okt 2026
        const weeklyScheduleMap = {
            '2026-10-20': [ // Selasa: Ada jadwal aSc tapi guru belum isi
                { jp: 1, mapel: 'Sosiologi', guruNama: 'Guru Sosiologi', guruId: 'G_SOS' },
                { jp: 2, mapel: 'Sosiologi', guruNama: 'Guru Sosiologi', guruId: 'G_SOS' }
            ],
            '2026-10-22': [ // Kamis: KBM normal di sekolah
                { jp: 3, mapel: 'Ekonomi', guruNama: 'Guru Ekonomi', guruId: 'G_EKO' },
                { jp: 4, mapel: 'Ekonomi', guruNama: 'Guru Ekonomi', guruId: 'G_EKO' }
            ]
        };

        // Entri jurnal sekolah: Pada hari Selasa (2026-10-20), hanya ada 0 rombel yang mengisi jurnal KBM di seluruh sekolah (<= 5)
        // Pada hari Kamis (2026-10-22), ada 20 rombel (termasuk angkatan XI) yang aktif KBM (> 5 di sekolah, > 2 di angkatan XI)
        const schoolJurnalEntries = [];
        for (let i = 1; i <= 15; i++) {
            schoolJurnalEntries.push({
                id: `j_kamis_x_${i}`,
                tanggal: '2026-10-22',
                kelas: `X-${i}`,
                jp: [3, 4]
            });
        }
        for (let i = 1; i <= 5; i++) {
            schoolJurnalEntries.push({
                id: `j_kamis_xi_${i}`,
                tanggal: '2026-10-22',
                kelas: `XI-${i}`,
                jp: [3, 4]
            });
        }

        const kbmActivityMap = buildWeeklyKbmActivityMap({
            schoolJurnalEntries,
            weekInfo: weekInfoNov
        });

        // Verifikasi peta aktivitas KBM nyata
        expect(kbmActivityMap.nonEffectiveDates.has('2026-10-20')).toBe(true); // Selasa <= 5 rombel aktif
        expect(kbmActivityMap.nonEffectiveDates.has('2026-10-22')).toBe(false); // Kamis 20 rombel aktif

        // Rekonsiliasi tanpa menyertakan agenda apapun (agendaEvents kosong!)
        const res = reconcileWeeklyJurnalData({
            weekInfo: weekInfoNov,
            className: 'XI-A',
            jurnalEntries: [],
            guruPresensiList: [],
            weeklyScheduleMap,
            agendaEvents: [], // Murni tanpa agenda di kalender
            kbmActivityMap
        });

        expect(res.length).toBe(2);

        // Hari Selasa (2026-10-20) otomatis berstatus Tidak Belajar Efektif (Aktivitas KBM Sekolah Non-Efektif)
        expect(res[0].tanggal).toBe('2026-10-20');
        expect(res[0].is_tidak_efektif).toBe(true);
        expect(res[0].topik).toContain('[Tidak Belajar Efektif]');
        expect(res[0].is_unfilled).toBe(false);

        // Hari Kamis (2026-10-22) KBM sekolah normal berjalan, sehingga slot yang belum diisi guru berstatus Belum Diisi
        expect(res[1].tanggal).toBe('2026-10-22');
        expect(res[1].is_tidak_efektif).toBe(false);
        expect(res[1].is_unfilled).toBe(true);
        expect(res[1].topik).toBe('[Jurnal Belum Diisi Guru]');
    });

    test('Paritas Penuh Monitoring KBM: Angkatan Tertentu Tidak Efektif (<= 2 Kelas Aktif KBM, misal Try Out)', () => {
        const weekInfoNov = calculateWeekRange('2026-10-21');
        const weeklyScheduleMap = {
            '2026-10-22': [ // Kamis JP 1-2
                { jp: 1, mapel: 'Kimia', guruNama: 'Guru Kimia', guruId: 'G_KIM' },
                { jp: 2, mapel: 'Kimia', guruNama: 'Guru Kimia', guruId: 'G_KIM' }
            ]
        };

        // Di sekolah ada 15 kelas X & XI yang aktif, tetapi angkatan XII hanya 1 kelas aktif (<= 2)
        const schoolJurnalEntries = [];
        for (let i = 1; i <= 8; i++) {
            schoolJurnalEntries.push({ id: `j_x_${i}`, tanggal: '2026-10-22', kelas: `X-${i}`, jp: [1, 2] });
        }
        for (let i = 1; i <= 7; i++) {
            schoolJurnalEntries.push({ id: `j_xi_${i}`, tanggal: '2026-10-22', kelas: `XI-${i}`, jp: [1, 2] });
        }
        // Hanya 1 kelas di XII
        schoolJurnalEntries.push({ id: `j_xii_1`, tanggal: '2026-10-22', kelas: `XII-F1`, jp: [1, 2] });

        const kbmActivityMap = buildWeeklyKbmActivityMap({
            schoolJurnalEntries,
            weekInfo: weekInfoNov
        });

        // Untuk kelas XII-F4 (angkatan XII): harus terdeteksi Tidak Belajar Efektif (karena angkatan XII <= 2)
        const resXII = reconcileWeeklyJurnalData({
            weekInfo: weekInfoNov,
            className: 'XII-F4',
            jurnalEntries: [],
            guruPresensiList: [],
            weeklyScheduleMap,
            agendaEvents: [],
            kbmActivityMap
        });

        expect(resXII[0].is_tidak_efektif).toBe(true);
        expect(resXII[0].te_kategori).toBe('KEGIATAN_SEKOLAH');
        expect(resXII[0].te_keterangan).toContain('Aktivitas KBM Angkatan XII Non-Efektif');

        // Untuk kelas X-1 (angkatan X): angkatan X ada 8 kelas aktif (> 2), jadi KBM berjalan efektif
        const resX = reconcileWeeklyJurnalData({
            weekInfo: weekInfoNov,
            className: 'X-1',
            jurnalEntries: [],
            guruPresensiList: [],
            weeklyScheduleMap,
            agendaEvents: [],
            kbmActivityMap
        });

        expect(resX[0].is_tidak_efektif).toBe(false);
        expect(resX[0].is_unfilled).toBe(true);
    });
});

describe('4. Verifikasi Integrasi Berkas & Markup HTML Portal Wali Kelas', () => {
    let waliHtml;
    let pageWaliJs;
    let waliJurnalJs;

    beforeAll(() => {
        waliHtml = fs.readFileSync(path.join(__dirname, '../wali-kelas.html'), 'utf8');
        pageWaliJs = fs.readFileSync(path.join(__dirname, '../js/page-wali-kelas.js'), 'utf8');
        waliJurnalJs = fs.readFileSync(path.join(__dirname, '../js/wali-kelas-jurnal.js'), 'utf8');
    });

    test('wali-kelas.html memuat tombol tab #tab-btn-jurnal dengan label Jurnal Mingguan', () => {
        expect(waliHtml).toContain('id="tab-btn-jurnal"');
        expect(waliHtml).toContain('Jurnal Mingguan');
        expect(waliHtml).toContain('fa-book-journal-whills');
    });

    test('wali-kelas.html memuat kontainer #tab-content-jurnal untuk menampilkan tabel meja kelas', () => {
        expect(waliHtml).toContain('id="tab-content-jurnal"');
    });

    test('page-wali-kelas.js mengimpor modul wali-kelas-jurnal.js dan mengonfigurasi tab switcher', () => {
        expect(pageWaliJs).toContain("from './wali-kelas-jurnal.js'");
        expect(pageWaliJs).toContain("btn: 'tab-btn-jurnal'");
        expect(pageWaliJs).toContain("content: 'tab-content-jurnal'");
    });

    test('wali-kelas-jurnal.js mengimplementasikan kop gambar resmi assets/kop.png dan ttd Kepsek di kiri, Wali Kelas di kanan', () => {
        expect(waliJurnalJs).toContain('size: A4 landscape');
        expect(waliJurnalJs).toContain('kop-wrapper');
        expect(waliJurnalJs).toContain('kop-img');
        expect(waliJurnalJs).toContain('assets/kop.png');
        expect(waliJurnalJs).toContain('Kepala ${escapeHTML(schoolName)}');
        expect(waliJurnalJs).toContain('Wali Kelas ${escapeHTML(className)}');
        // Tanda tangan Kepsek di kiri (td pertama) dan Wali Kelas di kanan (td kedua)
        const kepsekIndex = waliJurnalJs.indexOf('Kepala ${escapeHTML(schoolName)}');
        const waliIndex = waliJurnalJs.indexOf('Wali Kelas ${escapeHTML(className)}', kepsekIndex);
        expect(kepsekIndex).toBeGreaterThan(0);
        expect(waliIndex).toBeGreaterThan(kepsekIndex);
    });

    test('wali-kelas-jurnal.js mengimplementasikan penggabungan sel Hari/Tgl (rowspan) dan hari belajar Senin s.d. Jumat', () => {
        expect(waliJurnalJs).toContain('rowspan="${rowSpan}"');
        expect(waliJurnalJs).toContain('s.d. Jumat');
        expect(waliJurnalJs).toContain('reconcileWeeklyJurnalData');
        expect(waliJurnalJs).toContain('groupScheduleSlots');
    });
});

describe('5. Pengujian Fitur Verifikasi & TTD Digital Jurnal Mingguan oleh Kepala Sekolah', () => {
    let waliHtml;
    let waliJurnalJs;

    // Helper logika SSOT replikasi dari js/wali-kelas-jurnal.js
    function getWeeklyVerificationKey(className, startDateIso) {
        const cleanClass = String(className || '').trim().replace(/[\s\/\\]+/g, '-');
        return `jurnal_verif_${cleanClass}_${startDateIso}`;
    }

    function checkCanUserVerify(userRole, hasRoleFn = null) {
        if (userRole === 'kepala_sekolah' || userRole === 'super_admin') return true;
        if (typeof hasRoleFn === 'function') {
            return hasRoleFn('kepala_sekolah') || hasRoleFn('super_admin');
        }
        return false;
    }

    beforeAll(() => {
        waliHtml = fs.readFileSync(path.join(__dirname, '../wali-kelas.html'), 'utf8');
        waliJurnalJs = fs.readFileSync(path.join(__dirname, '../js/wali-kelas-jurnal.js'), 'utf8');
    });

    test('getWeeklyVerificationKey memformat kunci SSOT D1 dengan rapi dan konsisten', () => {
        expect(getWeeklyVerificationKey('X.1', '2026-09-21')).toBe('jurnal_verif_X.1_2026-09-21');
        expect(getWeeklyVerificationKey('XII MIPA 1', '2026-09-21')).toBe('jurnal_verif_XII-MIPA-1_2026-09-21');
        expect(getWeeklyVerificationKey('XI/A', '2026-09-28')).toBe('jurnal_verif_XI-A_2026-09-28');
    });

    test('Otorisasi verifikasi jurnal hanya mengizinkan peran kepala_sekolah dan super_admin', () => {
        expect(checkCanUserVerify('kepala_sekolah')).toBe(true);
        expect(checkCanUserVerify('super_admin')).toBe(true);
        expect(checkCanUserVerify('wali_kelas')).toBe(false);
        expect(checkCanUserVerify('guru_mapel')).toBe(false);
        expect(checkCanUserVerify('staff')).toBe(false);
        expect(checkCanUserVerify('siswa')).toBe(false);

        // Simulasi multi-role via hasRole
        const hasRoleMock = (role) => role === 'kepala_sekolah';
        expect(checkCanUserVerify('guru_mapel', hasRoleMock)).toBe(true);
    });

    test('wali-kelas.html memuat modal #modal-wali-jurnal-verify dengan canvas TTD Kepala Sekolah', () => {
        expect(waliHtml).toContain('id="modal-wali-jurnal-verify"');
        expect(waliHtml).toContain('id="kepsek-signature-pad"');
        expect(waliHtml).toContain('id="kepsek-signature-container"');
        expect(waliHtml).toContain('id="input-kepsek-catatan"');
        expect(waliHtml).toContain('id="btn-submit-kepsek-verify"');
        expect(waliHtml).toContain('onclick="window.clearKepsekCanvas()"');
    });

    test('wali-kelas-jurnal.js menyediakan handler verifikasi, canvas TTD, dan window bindings', () => {
        expect(waliJurnalJs).toContain('getWeeklyVerificationKey');
        expect(waliJurnalJs).toContain('getWeeklyJurnalVerification');
        expect(waliJurnalJs).toContain('saveWeeklyJurnalVerification');
        expect(waliJurnalJs).toContain('cancelWeeklyJurnalVerification');
        expect(waliJurnalJs).toContain('initKepsekCanvas');
        expect(waliJurnalJs).toContain('clearKepsekCanvas');
        expect(waliJurnalJs).toContain('isKepsekCanvasBlank');
        expect(waliJurnalJs).toContain('openWaliJurnalVerifyModal');
        expect(waliJurnalJs).toContain('submitKepsekVerification');
        expect(waliJurnalJs).toContain('cancelKepsekVerificationConfirm');
        expect(waliJurnalJs).toContain('renderVerificationBanner');
        expect(waliJurnalJs).toContain('window.openWaliJurnalVerifyModal');
        expect(waliJurnalJs).toContain('window.submitKepsekVerification');
        expect(waliJurnalJs).toContain('window.clearKepsekCanvas');
    });

    test('buildWeeklyJurnalPrintHtml menyematkan TTD digital Kepsek dan catatan jika terverifikasi, atau ruang kosong jika belum', () => {
        expect(waliJurnalJs).toContain('buildWeeklyJurnalPrintHtml(jurnalList, className, weekInfo, verifData = null)');
        expect(waliJurnalJs).toContain('Catatan / Arahan Kepala Sekolah:');
        expect(waliJurnalJs).toContain('alt="TTD Kepala Sekolah"');
        expect(waliJurnalJs).toContain('✓ Disahkan Digital SIMAS');
    });
});

describe('6. Pengujian Deteksi Otomatis Sesi Tidak Belajar Efektif (TE)', () => {
    let waliJurnalJs;

    beforeAll(() => {
        waliJurnalJs = fs.readFileSync(path.join(__dirname, '../js/wali-kelas-jurnal.js'), 'utf8');
    });

    test('Hari Senin JP 1 dideteksi otomatis sebagai Upacara Bendera (Tidak Belajar Efektif)', () => {
        const res = detectTidakBelajarEfektif({ dateStr: '2026-09-21', jpList: [1, 2] });
        expect(res.isTidakEfektif).toBe(true);
        expect(res.label).toBe('Upacara Bendera');
        expect(res.kategori).toBe('UPACARA');
    });

    test('Hari Jumat JP 10 dideteksi otomatis sebagai Kegiatan Ekstrakurikuler (Tidak Belajar Efektif)', () => {
        const res = detectTidakBelajarEfektif({ dateStr: '2026-09-25', jpList: [9, 10] });
        expect(res.isTidakEfektif).toBe(true);
        expect(res.label).toBe('Ekstrakurikuler');
        expect(res.kategori).toBe('EKSKUL');
    });

    test('Catatan presensi siswa dengan status K dideteksi sebagai Kegiatan Sekolah (Tidak Belajar Efektif)', () => {
        const res = detectTidakBelajarEfektif({ dateStr: '2026-09-23', jpList: [3, 4], rawStatus: 'K' });
        expect(res.isTidakEfektif).toBe(true);
        expect(res.label).toBe('Kegiatan Sekolah');
        expect(res.kategori).toBe('KEGIATAN_SEKOLAH');
    });

    test('Materi jurnal yang memuat Try Out atau Rapat Dinas dideteksi sebagai Tidak Belajar Efektif', () => {
        const resTO = detectTidakBelajarEfektif({ dateStr: '2026-09-22', jpList: [5, 6], topik: 'Pelaksanaan Try Out US Genap' });
        expect(resTO.isTidakEfektif).toBe(true);
        expect(resTO.label).toBe('Ujian / Asesmen Sekolah');

        const resRapat = detectTidakBelajarEfektif({ dateStr: '2026-09-24', jpList: [7, 8], catatan: 'Guru mengikuti Rapat Dinas Evaluasi Mutu' });
        expect(resRapat.isTidakEfektif).toBe(true);
        expect(resRapat.label).toBe('Rapat Dinas Sekolah');
    });

    test('Agenda Sekolah Cloudflare D1 (Bulan Bahasa) dideteksi otomatis sebagai Tidak Belajar Efektif', () => {
        const events = [
            {
                id: 'evt_bb',
                title: 'Bulan Bahasa',
                category: 'kegiatan',
                date: '2026-10-20',
                endDate: '2026-10-21'
            }
        ];

        // Sesi hari Selasa 2026-10-20
        const resSelasa = detectTidakBelajarEfektif({
            dateStr: '2026-10-20',
            jpList: [1, 2],
            mapel: 'Matematika',
            guru: 'Guru MTK',
            agendaEvents: events
        });
        expect(resSelasa.isTidakEfektif).toBe(true);
        expect(resSelasa.label).toBe('Bulan Bahasa');
        expect(resSelasa.kategori).toBe('KEGIATAN_SEKOLAH');

        // Sesi hari Rabu 2026-10-21
        const resRabu = detectTidakBelajarEfektif({
            dateStr: '2026-10-21',
            jpList: [3, 4],
            mapel: 'Bahasa Indonesia',
            guru: 'Guru Bindo',
            agendaEvents: events
        });
        expect(resRabu.isTidakEfektif).toBe(true);
        expect(resRabu.label).toBe('Bulan Bahasa');
        expect(resRabu.kategori).toBe('KEGIATAN_SEKOLAH');
    });

    test('Master Hari Libur Resmi dideteksi otomatis sebagai Tidak Belajar Efektif (LIBUR)', () => {
        const resLibur = detectTidakBelajarEfektif({
            dateStr: '2026-08-17',
            jpList: [1, 2],
            holidayInfo: { title: 'Hari Proklamasi Kemerdekaan RI' }
        });
        expect(resLibur.isTidakEfektif).toBe(true);
        expect(resLibur.kategori).toBe('LIBUR');
        expect(resLibur.label).toBe('Hari Proklamasi Kemerdekaan RI');
    });

    test('KBM mata pelajaran biasa dengan status Hadir TIDAK dideteksi sebagai Tidak Belajar Efektif', () => {
        const res = detectTidakBelajarEfektif({ dateStr: '2026-09-22', jpList: [3, 4], mapel: 'Kimia', topik: 'Ikatan Kovalen Polar', rawStatus: 'H' });
        expect(res.isTidakEfektif).toBe(false);
    });

    test('Deteksi Aktivitas KBM Nyata (kbmActivityMap): Hari non-efektif sekolah tanpa agenda kalender', () => {
        const mockKbmMap = {
            nonEffectiveDates: new Set(['2026-10-20']),
            tidakEfektifAngkatanMap: {
                '2026-10-20': {
                    XII: { 1: true, 2: true }
                }
            }
        };

        const res = detectTidakBelajarEfektif({
            dateStr: '2026-10-20',
            jpList: [1, 2],
            mapel: 'Fisika',
            guru: 'Guru Fisika',
            className: 'XII-F4',
            kbmActivityMap: mockKbmMap
        });

        expect(res.isTidakEfektif).toBe(true);
        expect(res.kategori).toBe('KEGIATAN_SEKOLAH');
        expect(res.label).toBe('Dispensasi Khusus / Acara Sekolah');
    });

    test('wali-kelas-jurnal.js mengekspor dan mengimplementasikan detectTidakBelajarEfektif, buildWeeklyKbmActivityMap, getAngkatanFromClass, dan isJPElapsed', () => {
        expect(waliJurnalJs).toContain('export function detectTidakBelajarEfektif');
        expect(waliJurnalJs).toContain('export function buildWeeklyKbmActivityMap');
        expect(waliJurnalJs).toContain('export function getAngkatanFromClass');
        expect(waliJurnalJs).toContain('export function isJPElapsed');
        expect(waliJurnalJs).toContain('is_tidak_efektif');
        expect(waliJurnalJs).toContain('Tidak Belajar Efektif');
        expect(waliJurnalJs).toContain('(Non-KBM)');
    });
});


