// js/exportLaporanDocx.js
// Membuat file .docx ASLI (bukan HTML bernama .doc) memakai library "docx".
// Berjalan di browser maupun Node.js/Jest. Pemakaian:
//   const blob = await buildLaporanDocx(data, kopPngBytes);
//   saveDocxFile(blob, 'E-Kinerja_Realisasi_2026-09-28.docx');

import { SCHOOL_CONFIG } from './school-config.js';
import { calculateAdjustedWeeklyTarget } from './workload-calc.js';
import { isHolidayDate, getHolidayDateInfo } from './holiday-manager.js';

/* ====================== KONSTANTA (ubah di sini saja) ====================== */
export const FONT = 'Times New Roman';
export const SZ_BODY = 24;        // 12 pt (satuan docx = half-point)
export const SZ_TABLE = 24;       // isi tabel 12 pt. Jika terlalu panjang, turunkan ke 22 (11 pt)
export const SZ_TITLE = 28;       // judul laporan 14 pt, tebal
export const SZ_FOOTER = 20;      // nomor halaman 10 pt
export const KOP_WIDTH_CM = 15;   // lebar kop pada kertas landscape (tinggi dihitung otomatis)
export const TARGET_TUNTAS = 100; // persen minimal agar status "Tuntas"

// A4 landscape: 29,7 x 21 cm. 1 cm = 567 DXA.
export const PAGE_W = 11906, PAGE_H = 16838;            // diisi portrait; docx memutar sendiri
export const MARGIN = 1134;                              // 2 cm semua sisi
export const CONTENT_W = PAGE_H - 2 * MARGIN;            // 14570 DXA (25,7 cm)
export const COLS = [600, 1900, 1000, 3900, 3300, 1700, 2170]; // jumlah harus = CONTENT_W
export const META_COLS = [2500, 300, 4485, 2900, 300, 4085];   // jumlah harus = CONTENT_W

/* =============================== RESOLVER DOCX =============================== */
let _cachedDocx = null;

export async function getDocxLib() {
  if (_cachedDocx) return _cachedDocx;
  if (typeof globalThis !== 'undefined' && globalThis.docx) {
    _cachedDocx = globalThis.docx;
    return _cachedDocx;
  }
  if (typeof window !== 'undefined' && window.docx) {
    _cachedDocx = window.docx;
    return _cachedDocx;
  }
  // Node.js / Jest fallback
  try {
    const mod = await import('docx');
    _cachedDocx = mod.default || mod;
    return _cachedDocx;
  } catch (e) {
    throw new Error('Pustaka docx tidak ditemukan di window.docx maupun import: ' + e.message);
  }
}

/* =============================== UTILITAS ================================== */
const MARGINS = { top: 50, bottom: 50, left: 80, right: 80 };
const fmt = (n) => Number(n || 0).toLocaleString('id-ID');
const sum = (a, from, to) => a.slice(from, to).reduce((x, y) => x + y, 0);

/** Baca lebar & tinggi PNG langsung dari header file (tanpa DOM). */
export function pngSize(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: v.getUint32(16), h: v.getUint32(20) };
}

/** 'data:image/png;base64,....' -> Uint8Array */
export function dataUriToBytes(uri) {
  const b64 = uri.split(',')[1] || uri;
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node.js fallback
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/* ================================ UTAMA ==================================== */
export async function buildLaporanDocx(data, kopPngBytes) {
  const docx = await getDocxLib();
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
    ExternalHyperlink, Footer, PageNumber, AlignmentType, BorderStyle, ShadingType,
    VerticalAlign, WidthType, PageOrientation, TableLayoutType,
  } = docx;

  const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };
  const LINE = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
  const ALL_BORDERS = { top: LINE, bottom: LINE, left: LINE, right: LINE };

  const run = (text, o = {}) => new TextRun({ text, font: FONT, size: SZ_BODY, ...o });
  const para = (children, o = {}) => new Paragraph({ children, ...o });

  function cell(children, width, o = {}) {
    return new TableCell({
      width: { size: width, type: WidthType.DXA },
      borders: o.borders ?? ALL_BORDERS,
      margins: MARGINS,
      verticalAlign: o.vAlign ?? VerticalAlign.TOP,
      columnSpan: o.span,
      shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
      children,
    });
  }
  const tp = (text, o = {}) => para(
    [run(text, { size: SZ_TABLE, bold: o.bold, italics: o.italics })],
    { alignment: o.align ?? AlignmentType.LEFT, keepNext: o.keepNext, spacing: { before: 0, after: 0 } });

  function kop(bytes) {
    const { w, h } = pngSize(bytes);
    const wPx = Math.round(KOP_WIDTH_CM * 37.795);       // 1 cm = 37,795 px (96 dpi)
    const hPx = Math.round(wPx * h / w);                 // rasio asli dipertahankan
    return para([new ImageRun({
      type: 'png', data: bytes, transformation: { width: wPx, height: hPx },
      altText: { title: 'Kop', description: "Kop surat SMA Negeri Nusantara", name: 'kop' },
    })], { alignment: AlignmentType.CENTER, spacing: { after: 160 } });
  }

  function judul(d) {
    return [
      para([run('LAPORAN REALISASI KINERJA MINGGUAN GURU', { bold: true, size: SZ_TITLE })],
        { alignment: AlignmentType.CENTER, spacing: { after: 40 } }),
      para([run(`PERIODE PEKAN: ${d?.periode || '-'}`, { bold: true })],
        { alignment: AlignmentType.CENTER, spacing: { after: 200 } }),
    ];
  }

  function metaTable(d) {
    const g = d?.guru || {};
    const totalMenit = d?.totalMenit || 0;
    const totalJam = d?.totalJam || (Math.round((totalMenit / 60) * 10) / 10);
    const targetMenit = d?.targetMenit || 2250;
    const persen = d?.persen ?? Math.round((totalMenit / targetMenit) * 100);

    const rows = [
      ['Nama Guru', g.nama || '-', 'Tugas Pokok / Mapel', g.tugas || '-'],
      ['NIP / NIK', g.nip || '-', 'Total Menit Realisasi', `${fmt(totalMenit)} Menit (${totalJam} Jam)`],
      ['Pangkat / Golongan', g.pangkat || '-', 'Ketercapaian Target', `${persen}% (dari target ${fmt(targetMenit)} menit)`],
    ];
    const c = (t, i, bold) => cell([tp(t, { bold })], META_COLS[i], { borders: NO_BORDERS });
    return new Table({
      width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: META_COLS, layout: TableLayoutType.FIXED,
      rows: rows.map((r) => new TableRow({ cantSplit: true, children: [
        c(r[0], 0, true), c(':', 1), c(r[1], 2), c(r[2], 3, true), c(':', 4), c(r[3], 5),
      ] })),
    });
  }

  function bukti(list, isUnrealized = false) {
    if (isUnrealized) return [tp('', { align: AlignmentType.CENTER })];
    const validList = Array.isArray(list) ? list.filter(b => b && b.url) : [];
    if (!validList.length) return [tp(isUnrealized ? '' : '-', { align: AlignmentType.CENTER })];
    return validList.map((b, i) => para([new ExternalHyperlink({
      link: b.url,
      children: [run(`Bukti ${i + 1}`, { size: SZ_TABLE, color: '0563C1', underline: {} })],
    })], { spacing: { before: 0, after: 0 } }));
  }

  function dataTable(d) {
    const C = AlignmentType.CENTER;
    const heads = ['No', 'Waktu', 'Durasi', 'Rincian Tugas / Kegiatan', 'Realisasi Hasil / Output', 'Status', 'Bukti Dukung'];
    const header = new TableRow({
      tableHeader: true, cantSplit: true,                      // header diulang tiap halaman
      children: heads.map((h, i) => cell([tp(h, { bold: true, align: C })], COLS[i],
        { fill: 'D9D9D9', vAlign: VerticalAlign.CENTER })),
    });

    const body = [];
    const hariList = Array.isArray(d?.hari) ? d.hari : [];
    hariList.forEach((hari) => {
      body.push(new TableRow({ cantSplit: true, children: [
        cell([tp(hari?.label || '-', { bold: true, keepNext: true })], CONTENT_W, { span: 7, fill: 'EDEDED' }),
      ] }));
      const rows = Array.isArray(hari?.rows) ? hari.rows : [];
      rows.forEach((r) => {
        const isUnrealized = Boolean(r?.isUnrealized || (r?.status === '' && r?.hasil === ''));
        const noVal = String(r?.no ?? '-');
        const waktuVal = r?.waktu || '-';
        const durasiVal = r?.durasi || '-';
        const rincianVal = r?.rincian || '-';

        let hasilVal = '';
        let statusVal = '';

        if (isUnrealized) {
          // Rencana yang belum terealisasi: dikosongkan agar bisa ditulis tangan / diisi manual oleh guru
          hasilVal = '';
          statusVal = '';
        } else if (noVal === '-') {
          // Baris keterangan hari tanpa agenda rencana maupun realisasi
          hasilVal = '-';
          statusVal = '-';
        } else {
          hasilVal = r?.hasil || '-';
          statusVal = r?.status || '-';
        }

        const hasilAlign = hasilVal && hasilVal !== '-' ? AlignmentType.LEFT : C;

        body.push(new TableRow({ cantSplit: true, children: [
          cell([tp(noVal, { align: C })], COLS[0]),
          cell([tp(waktuVal, { align: C })], COLS[1]),
          cell([tp(durasiVal, { align: C })], COLS[2]),
          cell([tp(rincianVal, { bold: true })], COLS[3]),
          cell([tp(hasilVal, { align: hasilAlign })], COLS[4]),
          cell([tp(statusVal, { align: C })], COLS[5]),
          cell(bukti(r?.bukti, isUnrealized), COLS[6]),
        ] }));
      });
    });

    const totalMenit = d?.totalMenit || 0;
    const targetMenit = d?.targetMenit || 2250;
    const persen = d?.persen ?? Math.round((totalMenit / targetMenit) * 100);
    const tuntas = persen >= TARGET_TUNTAS ? 'Tuntas' : 'Belum Tuntas';
    const total = new TableRow({ cantSplit: true, children: [
      cell([tp('TOTAL REALISASI PEKAN INI:', { bold: true, align: AlignmentType.RIGHT })], sum(COLS, 0, 2), { span: 2, fill: 'F2F2F2' }),
      cell([tp(`${fmt(totalMenit)} m`, { bold: true, align: C })], COLS[2], { fill: 'F2F2F2' }),
      cell([tp(`Standar Kedinasan: ${fmt(targetMenit)} Menit (${fmt(targetMenit / 60)} Jam/Pekan)`, { bold: true })], sum(COLS, 3, 5), { span: 2, fill: 'F2F2F2' }),
      cell([tp(`${persen}%`, { bold: true, align: C })], COLS[5], { fill: 'F2F2F2' }),
      cell([tp(tuntas, { bold: true, align: C })], COLS[6], { fill: 'F2F2F2' }),
    ] });

    return new Table({
      width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: COLS, layout: TableLayoutType.FIXED,
      rows: [header, ...body, total],
    });
  }

  function tandaTangan(d) {
    const L = [9000, CONTENT_W - 9000];
    const line = (t, o = {}) => para([run(t, o.run)], { keepNext: o.keepNext ?? true, keepLines: true, spacing: { before: o.before ?? 0, after: 0 } });
    const tempatTanggal = d?.tempatTanggal || "Denpasar, -";
    const namaGuru = d?.guru?.nama || 'Guru Yang Bersangkutan';
    const nipGuru = d?.guru?.nip ? `NIP. ${d.guru.nip}` : 'NIP. -';
    return new Table({
      width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: L, layout: TableLayoutType.FIXED,
      rows: [new TableRow({ cantSplit: true, children: [
        cell([para([run('')])], L[0], { borders: NO_BORDERS }),
        cell([
          line(tempatTanggal),
          line('Guru Yang Bersangkutan,'),
          line(namaGuru, { before: 1100, run: { bold: true, underline: {} } }),
          line(nipGuru, { keepNext: false }),
        ], L[1], { borders: NO_BORDERS }),
      ] })],
    });
  }

  const children = [
    ...(kopPngBytes ? [kop(kopPngBytes)] : []),
    ...judul(data),
    metaTable(data),
    para([run('')], { spacing: { after: 120 } }),
    dataTable(data),
    para([run('')], { spacing: { after: 240 } }),
    tandaTangan(data),
  ];

  const doc = new Document({
    creator: "SMA Negeri Nusantara",
    title: 'Laporan Realisasi Kinerja Mingguan Guru',
    styles: { default: { document: { run: { font: FONT, size: SZ_BODY } } } },
    sections: [{
      properties: { page: {
        size: { width: PAGE_W, height: PAGE_H, orientation: PageOrientation.LANDSCAPE },
        margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      } },
      footers: { default: new Footer({ children: [para([
        new TextRun({ text: 'Halaman ', font: FONT, size: SZ_FOOTER }),
        new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SZ_FOOTER }),
        new TextRun({ text: ' dari ', font: FONT, size: SZ_FOOTER }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: SZ_FOOTER }),
      ], { alignment: AlignmentType.CENTER })] }) },
      children,
    }],
  });
  return Packer.toBlob ? Packer.toBlob(doc) : Packer.toBuffer(doc);
}

/* =========================== PEMETAAN DATA ================================= */

/** Hitung tanggal kalender lokal YYYY-MM-DD tanpa pergeseran zona waktu UTC */
export function getLocalCalendarDate(weekStartDate, dayOfWeek) {
  if (!weekStartDate) return '';
  try {
    const parts = weekStartDate.split('-');
    if (parts.length !== 3) return '';
    const y = Number(parts[0]);
    const m = Number(parts[1]) - 1;
    const d = Number(parts[2]);
    const dt = new Date(y, m, d + (dayOfWeek - 1));
    const resY = dt.getFullYear();
    const resM = String(dt.getMonth() + 1).padStart(2, '0');
    const resD = String(dt.getDate()).padStart(2, '0');
    return `${resY}-${resM}-${resD}`;
  } catch (_) {
    return '';
  }
}

/** Format tanggal Indonesia: "Senin, 28 September 2026" atau "28 September 2026" */
export function formatIndonesianDateLocal(dateStr, withDayName = true) {
  if (!dateStr) return '-';
  try {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return dateStr;
    
    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const monthNames = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    
    const dayName = dayNames[d.getDay()];
    const dateNum = d.getDate();
    const monthName = monthNames[d.getMonth()];
    const year = d.getFullYear();
    
    return withDayName ? `${dayName}, ${dateNum} ${monthName} ${year}` : `${dateNum} ${monthName} ${year}`;
  } catch (_) {
    return dateStr;
  }
}

/** Format rentang pekan: "28 SEPTEMBER S.D. 2 OKTOBER 2026" */
export function formatWeekDateRangeLocal(weekStartDate) {
  if (!weekStartDate) return '-';
  try {
    const parts = weekStartDate.split('-');
    if (parts.length !== 3) return weekStartDate;
    const y = Number(parts[0]);
    const m = Number(parts[1]) - 1;
    const d = Number(parts[2]);
    const mon = new Date(y, m, d);
    const fri = new Date(y, m, d + 4);

    const monthNames = [
      'JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
      'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'
    ];

    const mD = mon.getDate();
    const fD = fri.getDate();
    const mM = mon.getMonth();
    const fM = fri.getMonth();
    const mY = mon.getFullYear();
    const fY = fri.getFullYear();

    if (mY === fY) {
      if (mM === fM) {
        return `${mD} S.D. ${fD} ${monthNames[mM]} ${mY}`;
      }
      return `${mD} ${monthNames[mM]} S.D. ${fD} ${monthNames[fM]} ${mY}`;
    }
    return `${mD} ${monthNames[mM]} ${mY} S.D. ${fD} ${monthNames[fM]} ${fY}`;
  } catch (_) {
    return weekStartDate;
  }
}

/** Parse bukti dukung menjadi array [{ nama, url }] */
export function parseEvidenceList(evidenceUrl) {
  if (!evidenceUrl) return [];
  const raw = String(evidenceUrl).trim();
  if (!raw || raw === '-') return [];

  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const valid = list.filter(item => item && (item.url || typeof item === 'string'));
      return valid.map((item, idx) => {
        const itemUrl = (typeof item === 'string' ? item : item.url || '').trim();
        const itemName = (typeof item === 'object' && item.name ? item.name : `Bukti ${idx + 1}`);
        return itemUrl ? { nama: itemName, url: itemUrl } : null;
      }).filter(Boolean);
    } catch (_) {}
  }

  return [{ nama: 'Bukti 1', url: raw }];
}

/**
 * Pemetaan Data E-Kinerja Guru ke Struktur Objek DOCX
 */
export function mapWeekDataToDocx(weekStartDate, weekData = {}, teacherInfo = {}) {
  const teacherName = teacherInfo?.nama || teacherInfo?.name || weekData?.week?.teacher_name || 'Guru Mata Pelajaran';
  const teacherNip = teacherInfo?.nip || teacherInfo?.nik || weekData?.week?.teacher_nip || '-';
  const teacherRank = teacherInfo?.pangkat_golongan || teacherInfo?.rank || '-';
  const teacherSubject = teacherInfo?.mata_pelajaran || teacherInfo?.subject || 'Guru Mata Pelajaran';

  const logs = Array.isArray(weekData?.logs) ? weekData.logs : [];
  const segments = Array.isArray(weekData?.segments) ? weekData.segments : [];
  const planLinks = Array.isArray(weekData?.plan_links) ? weekData.plan_links : [];
  const summary = weekData?.summary || {};
  const actualMinutes = summary.actual_minutes || logs.reduce((acc, l) => acc + (l.actual_minutes || l.duration_minutes || 0), 0);
  const actualHours = (actualMinutes / 60).toFixed(1).replace('.', ',');
  const targetMinutes = (weekData?.week?.target_minutes && weekData.week.target_minutes !== 2250)
    ? weekData.week.target_minutes
    : calculateAdjustedWeeklyTarget(weekStartDate, segments).adjustedTargetMinutes;
  const completionPct = Math.round((actualMinutes / (targetMinutes || 2250)) * 100);

  const periode = formatWeekDateRangeLocal(weekStartDate);
  const city = SCHOOL_CONFIG?.schoolCity || 'Denpasar';
  const friDate = getLocalCalendarDate(weekStartDate, 5) || weekStartDate;
  const signDateStr = formatIndonesianDateLocal(friDate, false);

  const hariList = [];
  let globalNo = 1;

  for (let day = 1; day <= 5; day++) {
    const dayDate = getLocalCalendarDate(weekStartDate, day);
    const dayLabel = formatIndonesianDateLocal(dayDate, true);
    const dayNames = ['senin', 'selasa', 'rabu', 'kamis', 'jumat'];
    const currentDayName = dayNames[day - 1];

    const daySegments = segments
      .filter(s => (s.date && s.date === dayDate) || Number(s.day_of_week) === day || (s.day_name && String(s.day_name).toLowerCase() === currentDayName))
      .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

    const dayLogs = logs
      .filter(l => (l.date && l.date === dayDate) || (l.day_of_week && Number(l.day_of_week) === day) || (l.day_name && String(l.day_name).toLowerCase() === currentDayName))
      .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

    const dayRows = [];
    const isHol = isHolidayDate(dayDate);
    const holInfo = isHol ? getHolidayDateInfo(dayDate) : null;

    // Jika hari ini merupakan hari libur resmi dan tidak memiliki laporan realisasi khusus
    if (isHol && dayLogs.length === 0) {
      hariList.push({
        label: dayLabel,
        rows: [{
          no: '-',
          waktu: '-',
          durasi: '-',
          rincian: `Hari Libur Resmi: ${holInfo?.name || holInfo?.title || 'Libur Sekolah / Nasional'} (Bebas jam kerja/target mingguan)`,
          hasil: '-',
          status: 'Libur Resmi',
          bukti: []
        }]
      });
      continue;
    }

    if (daySegments.length === 0 && dayLogs.length === 0) {
      const emptyDesc = isHol
        ? `Hari Libur Resmi: ${holInfo?.name || holInfo?.title || 'Libur Sekolah / Nasional'}`
        : 'Tidak ada agenda rencana atau realisasi kegiatan pada hari ini.';
      hariList.push({
        label: dayLabel,
        rows: [{
          no: '-',
          waktu: '-',
          durasi: '-',
          rincian: emptyDesc,
          hasil: '-',
          status: '-',
          bukti: []
        }]
      });
      continue;
    }

    const matchedLogIds = new Set();

    // 1. Rencana kerja mingguan hari ini
    daySegments.forEach(seg => {
      const linkedLog = dayLogs.find(l => {
        if (matchedLogIds.has(l.id)) return false;
        const matchLink = planLinks.some(pl => pl.plan_activity_id === seg.activity_id && pl.work_log_id === l.id);
        const matchDirect = l.plan_activity_id && l.plan_activity_id === seg.activity_id;
        const matchTime = (l.start_time && seg.start_time && l.start_time === seg.start_time && l.end_time === seg.end_time);
        return matchLink || matchDirect || matchTime;
      });

      if (linkedLog) {
        matchedLogIds.add(linkedLog.id);
        const start = linkedLog.start_time || seg.start_time || '07:30';
        const end = linkedLog.end_time || seg.end_time || '08:15';
        const isSubstituted = linkedLog.status_execution === 'diganti';
        const title = isSubstituted
          ? (linkedLog.title || linkedLog.substitute_notes || seg.activity_title || 'Kegiatan Pengganti')
          : (seg.activity_title || linkedLog.activity_title || linkedLog.title || 'Kegiatan Terlaksana');
        const isNotExecuted = linkedLog.status_execution === 'tidak_terlaksana';
        const titleText = isNotExecuted
          ? `${title} (Tidak Terlaksana)`
          : title;
        const absenceMatch = (linkedLog.obstacle_notes || '').match(/^\[(Sakit|Cuti|Izin)\]\s*(.*)/i);
        const outputSummary = isSubstituted
          ? `${linkedLog.output_summary || linkedLog.description || 'Tugas pengganti terlaksana.'}${seg.activity_title ? ` (Menggantikan: ${seg.activity_title})` : ''}`
          : (isNotExecuted
            ? (absenceMatch
              ? `Tidak terlaksana (${absenceMatch[1]}). Alasan: ${absenceMatch[2] || linkedLog.obstacle_notes}`
              : `Tidak terlaksana.${linkedLog.obstacle_notes ? ` Kendala: ${linkedLog.obstacle_notes}` : ''}`)
            : (linkedLog.output_summary || linkedLog.description || 'Terlaksana sesuai rencana'));

        let statusText = 'Terlaksana Penuh';
        if (linkedLog.status_execution === 'sebagian') statusText = 'Terlaksana Sebagian';
        else if (linkedLog.status_execution === 'diganti') statusText = 'Kegiatan Pengganti';
        else if (isNotExecuted) statusText = absenceMatch ? `Tidak Terlaksana (${absenceMatch[1]})` : 'Tidak Terlaksana';

        const duration = linkedLog.actual_minutes || linkedLog.duration_minutes || seg.duration_minutes || seg.planned_minutes || 45;

        dayRows.push({
          no: globalNo++,
          waktu: `${start} – ${end}`,
          durasi: `${duration} m`,
          rincian: titleText,
          hasil: outputSummary,
          status: statusText,
          bukti: parseEvidenceList(linkedLog.evidence_url)
        });
      } else {
        // Rencana belum terealisasi (kolom hasil, status, dan bukti dikosongkan agar bisa diisi manual / tulis tangan oleh guru)
        const start = seg.start_time || '07:30';
        const end = seg.end_time || '08:15';
        const duration = seg.duration_minutes || seg.planned_minutes || 45;
        const title = seg.activity_title || seg.description || 'Kegiatan Terencana';

        dayRows.push({
          no: globalNo++,
          waktu: `${start} – ${end}`,
          durasi: `${duration} m`,
          rincian: title,
          hasil: '',
          status: '',
          bukti: [],
          isUnrealized: true
        });
      }
    });

    // 2. Log unplanned / tambahan di luar rencana
    const unlinkedLogs = dayLogs.filter(l => !matchedLogIds.has(l.id));
    unlinkedLogs.forEach(log => {
      const start = log.start_time || '07:30';
      const end = log.end_time || '08:15';
      const duration = log.actual_minutes || log.duration_minutes || 45;
      const title = `${log.activity_title || log.title || 'Kegiatan Terlaksana'}${log.is_unplanned === 1 ? ' (Tambahan)' : ''}`;
      const absenceMatchUnlinked = (log.obstacle_notes || '').match(/^\[(Sakit|Cuti|Izin)\]\s*(.*)/i);
      const isNotExecUnlinked = log.status_execution === 'tidak_terlaksana';
      const outputSummary = isNotExecUnlinked
        ? (absenceMatchUnlinked
          ? `Tidak terlaksana (${absenceMatchUnlinked[1]}). Alasan: ${absenceMatchUnlinked[2] || log.obstacle_notes}`
          : `Tidak terlaksana.${log.obstacle_notes ? ` Kendala: ${log.obstacle_notes}` : ''}`)
        : (log.output_summary || log.description || 'Terlaksana sesuai rencana');

      let statusText = 'Terlaksana Penuh';
      if (log.status_execution === 'sebagian') statusText = 'Terlaksana Sebagian';
      else if (log.status_execution === 'diganti') statusText = 'Kegiatan Pengganti';
      else if (isNotExecUnlinked) statusText = absenceMatchUnlinked ? `Tidak Terlaksana (${absenceMatchUnlinked[1]})` : 'Tidak Terlaksana';

      dayRows.push({
        no: globalNo++,
        waktu: `${start} – ${end}`,
        durasi: `${duration} m`,
        rincian: title,
        hasil: outputSummary,
        status: statusText,
        bukti: parseEvidenceList(log.evidence_url)
      });
    });

    hariList.push({
      label: dayLabel,
      rows: dayRows
    });
  }

  return {
    guru: {
      nama: teacherName,
      nip: teacherNip,
      pangkat: teacherRank || '-',
      tugas: teacherSubject
    },
    periode,
    totalMenit: actualMinutes,
    totalJam: actualHours,
    targetMenit: targetMinutes,
    persen: completionPct,
    hari: hariList,
    tempatTanggal: `${city}, ${signDateStr}`
  };
}

/**
 * Mengambil file kop surat sekolah dalam format Uint8Array
 */
export async function getKopImageBytes() {
  try {
    const kopPath = SCHOOL_CONFIG?.kopPath || 'assets/kop.png';
    const res = await fetch(kopPath);
    if (!res.ok) throw new Error('Kop not found');
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch (_) {
    return null;
  }
}

/**
 * Helper pengunduh file .docx (Kompatibel Browser Native & FileSaver)
 */
export function saveDocxFile(blob, filename) {
  if (typeof window !== 'undefined' && typeof window.saveAs === 'function') {
    window.saveAs(blob, filename);
    return;
  }
  if (typeof document !== 'undefined') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 250);
  }
}

/**
 * Eksekutor Utama Ekspor Realisasi ke Berkas .docx Asli
 */
export async function exportWorkloadRealizationDocx({
  weekStartDate,
  weekData = {},
  teacherInfo = {}
} = {}) {
  const data = mapWeekDataToDocx(weekStartDate, weekData, teacherInfo);
  const kopBytes = await getKopImageBytes();
  const blob = await buildLaporanDocx(data, kopBytes);
  const filename = `E-Kinerja_Realisasi_${weekStartDate}.docx`;
  saveDocxFile(blob, filename);
  return blob;
}
