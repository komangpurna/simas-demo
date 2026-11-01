import { getJurnalDateStr, parseJpList, formatJpDisplay, isClassEqual } from './utils.mjs';

const norm = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const statuses = ['H', 'S', 'I', 'A', 'D', 'T', '?'];
export const MAX_REPORT_JOURNALS = 8;
const counts = () => Object.fromEntries(statuses.map(s => [s, 0]));
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
const shortDate = date => new Date(`${date}T12:00:00+08:00`).toLocaleDateString('id-ID', { timeZone: 'Asia/Makassar', day: 'numeric', month: 'short' });
const teacherNameKey = value => norm(value).replace(/[.,]/g, '').replace(/\s+/g, '');
const cleanTeacherTitles = value => String(value ?? '').toLowerCase()
    .replace(/,\s*(s\.pd|m\.pd|s\.kom|s\.ag|m\.ag|s\.si|m\.si|s\.t|m\.t|s\.e|se|s\.sos|m\.sos|s\.ip|s\.psi|m\.psi|a\.md|s\.sos\.i|s\.h|m\.h|s\.pd\.i|gr|m\.pd\.h)\b/gi, '')
    .replace(/^(drs\.|dr\.|drai\.|h\.|hj\.|m\.|ir\.)\s+/gi, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, '')
    .trim();

export function currentReportPeriod(nowOrMonth = new Date()) {
    let now = new Date();
    let month = '';
    let endDay = '';
    let label = '';
    let start = '';
    let end = '';

    if (typeof nowOrMonth === 'string' && /^\d{4}-\d{2}$/.test(nowOrMonth)) {
        month = nowOrMonth;
        const [yStr, mStr] = month.split('-');
        const y = parseInt(yStr, 10);
        const m = parseInt(mStr, 10);
        const nowParts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
        const isCurrentMonth = `${nowParts.year}-${nowParts.month}` === month;
        const maxDayInMonth = new Date(y, m, 0).getDate();
        endDay = isCurrentMonth ? nowParts.day : String(maxDayInMonth).padStart(2, '0');
        const refDate = new Date(`${month}-01T12:00:00+08:00`);
        label = refDate.toLocaleDateString('id-ID', { timeZone: 'Asia/Makassar', month: 'long', year: 'numeric' });
        start = `${month}-01`;
        end = `${month}-${endDay}`;
    } else {
        now = (nowOrMonth instanceof Date) ? nowOrMonth : new Date();
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
        month = `${parts.year}-${parts.month}`;
        start = `${month}-01`;
        end = `${month}-${parts.day}`;
        label = now.toLocaleDateString('id-ID', { timeZone: 'Asia/Makassar', month: 'long', year: 'numeric' });
    }
    return { month, start, end, label };
}

export function buildMonthlyReport(journals, students, options, period = currentReportPeriod()) {
    const names = new Set([options.teacherName, ...(options.teacherNames || [])].map(teacherNameKey).filter(Boolean));
    const cleanNames = new Set([options.teacherName, ...(options.teacherNames || [])].map(cleanTeacherTitles).filter(Boolean));
    const teacherIds = new Set([options.teacherUid, options.teacherNip, ...(options.teacherIds || [])]
        .map(value => String(value ?? '').trim()).filter(value => value && value !== '-'));
    const unique = new Map();
    journals.filter(j => {
        const date = getJurnalDateStr(j);
        const uid = String(j.uid_guru || '').trim();
        const jTitleClean = cleanTeacherTitles(j.guru);
        const matchesTeacher = Boolean(
            options.allowAnyTeacher
            || (uid && teacherIds.has(uid))
            || names.has(teacherNameKey(j.guru))
            || (jTitleClean && cleanNames.has(jTitleClean))
        );
        return date >= period.start && date <= period.end && isClassEqual(j.kelas, options.kelas)
            && (options.matchesSubject ? options.matchesSubject(j.mapel) : norm(j.mapel) === norm(options.mapel))
            && matchesTeacher;
    }).sort((a, b) => String(a.updated_at || a.created_at || '').localeCompare(String(b.updated_at || b.created_at || ''))).forEach(j => {
        const date = getJurnalDateStr(j);
        const jp = parseJpList(j.jp).sort((a, b) => a - b);
        const key = `${date}|${jp.length ? jp.join(',') : j.id || 'tanpa-jp'}`;
        unique.set(key, { ...j, date, jp, detail: parse(j.presensi_detail), legacy: parse(j.presensi) });
    });
    const sessions = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.jp[0] || 0) - (b.jp[0] || 0));
    sessions.forEach((session, index) => { session.includeInReport = index >= sessions.length - MAX_REPORT_JOURNALS; });
    const rows = [];
    const byNis = new Map();
    const byName = new Map();
    function addStudent(nis, name, master = false) {
        const row = { nis: String(nis || '').trim(), name: name || nis || 'Tanpa nama', master, counts: counts() };
        rows.push(row);
        if (row.nis) byNis.set(row.nis, row);
        const key = norm(row.name);
        if (!byName.has(key)) byName.set(key, row);
        else byName.set(key, null); // Nama ganda harus dicocokkan dengan NIS.
        return row;
    }
    students.forEach(s => {
        if (s.is_alumni || s.status === 'inactive' || !isClassEqual(s.class || s.kelas || options.kelas, options.kelas)) return;
        if (s.nis && byNis.has(String(s.nis))) return;
        addStudent(s.nis, s.name || s.nama, true);
    });
    function resolve(entry) {
        const nis = String(entry.nis || '').trim();
        const nameRow = byName.get(norm(entry.nama));
        return byNis.get(nis) || (nameRow && (!nis || !nameRow.nis || nameRow.nis === nis) ? nameRow : null);
    }
    const attendance = sessions.map(session => {
        const entries = [];
        if (session.legacy && typeof session.legacy === 'object' && !Array.isArray(session.legacy)) {
            Object.entries(session.legacy).forEach(([nama, status]) => entries.push({ nama, status }));
        }
        if (Array.isArray(session.detail)) entries.push(...session.detail.filter(e => e && typeof e === 'object'));
        const values = new Map();
        entries.forEach(entry => {
            const row = resolve(entry) || addStudent(entry.nis, entry.nama);
            const status = String(entry.status || '').toUpperCase();
            values.set(row, statuses.includes(status) ? status : '?');
        });
        // Jurnal SMAGESA menyimpan hanya pengecualian ketidakhadiran pada presensi_detail.
        return { values, sparse: Array.isArray(session.detail) };
    });
    const total = counts();
    rows.forEach(row => {
        row.sessions = [];
        attendance.forEach(({ values, sparse }) => {
            const status = values.get(row) || (sparse && row.master ? 'H' : '?');
            row.counts[status]++;
            total[status]++;
            row.sessions.push(status);
        });
        const recorded = sessions.length - row.counts['?'];
        const presentCount = (row.counts.H || 0) + (row.counts.T || 0);
        row.rate = recorded ? Math.round(presentCount / recorded * 100) : null;
    });
    sessions.forEach((session, idx) => {
        const att = attendance[idx];
        const sc = counts();
        rows.forEach(row => {
            const status = att.values.get(row) || (att.sparse && row.master ? 'H' : '?');
            if (sc[status] !== undefined) sc[status]++;
        });
        session.counts = sc;
    });
    rows.sort((a, b) => a.name.localeCompare(b.name, 'id'));
    const recorded = Object.values(total).reduce((a, b) => a + b, 0) - total['?'];
    const totalPresent = (total.H || 0) + (total.T || 0);
    return { ...options, teacherPhoto: options.teacherPhoto || '', period, sessions, students: rows, total, totalJp: sessions.reduce((n, s) => n + s.jp.length, 0), rate: recorded ? Math.round(totalPresent / recorded * 100) : null };
}

function safeImage(value, baseUrl) {
    if (!value) return '';
    try { const url = new URL(value, baseUrl); return ['https:', 'http:'].includes(url.protocol) ? escape(url.href) : ''; } catch { return ''; }
}

function safeTeacherPhoto(value, baseUrl) {
    if (!value || typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (/^data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(trimmed)) return trimmed;
    return safeImage(trimmed, baseUrl);
}

function reportPhoto(session, baseUrl) {
    return /^data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(session.reportPhoto || '')
        ? session.reportPhoto : safeImage(session.foto_url, baseUrl);
}

export async function readReportPhoto(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Gunakan foto JPG, PNG, atau WebP.');
    if (file.size > 15 * 1024 * 1024) throw new Error('Ukuran foto maksimal 15 MB.');
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.src = url;
        try { await img.decode(); } catch { throw new Error('Foto tidak dapat dibaca. Pilih file foto lain.'); }
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.9);
    } finally { URL.revokeObjectURL(url); }
}

export function renderReportHtml(reportOrReports, signature, baseUrl) {
    const reports = Array.isArray(reportOrReports) ? reportOrReports : [reportOrReports];
    if (!reports.length) return '';
    const firstReport = reports[0];
    const { school, period } = firstReport;
    const logo = safeImage(school.logoPath, baseUrl);
    const signatureUrl = /^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(signature) ? signature : '';

    const sheetsHtml = reports.map(report => {
        const { sessions, students } = report;
        const selectedSessions = sessions.filter(session => session.includeInReport !== false).slice(0, MAX_REPORT_JOURNALS);
        const nipClean = String(report.teacherNip || '').trim();
        const hasNip = nipClean && nipClean !== '-' && !/^(undefined|null)$/i.test(nipClean) && /\d{4,}/.test(nipClean);
        const formattedNip = hasNip ? (nipClean.toUpperCase().startsWith('NIP') ? nipClean : `NIP. ${nipClean}`) : '';
        const teacherPhotoUrl = safeTeacherPhoto(report.teacherPhoto, baseUrl);
        const teacherPhotoTag = teacherPhotoUrl ? `<img src="${teacherPhotoUrl}" class="teacher-avatar" alt="Foto ${escape(report.teacherName)}" width="44" height="44" onerror="this.remove()">` : '';
        const identity = `<div class="identity"><div class="identity-teacher">${teacherPhotoTag}<div class="identity-teacher-info"><span class="sr-only">GURU MATA PELAJARAN</span><b>${escape(report.teacherName)}</b><small>${hasNip ? `${escape(formattedNip)} · ` : ''}${escape(report.mapel)}</small></div></div><div class="identity-class" style="display:none"><span class="sr-only">KELAS / MATA PELAJARAN</span><div class="identity-class-info"><b>${escape(report.kelas)}</b><small>${escape(report.mapel)}</small></div></div></div>`;
        const header = (number, title, subtitle) => `<header><div class="brand"><img src="${logo}" alt="Logo sekolah"><div><b>${escape(school.schoolName)}</b><span>LAPORAN MENGAJAR ${escape(period.label || '').toUpperCase()}</span></div><em>${escape(period.label)}</em></div><div class="headline"><div class="headline-left"><p>JURNAL PEMBELAJARAN / ${number}</p><div class="headline-title-wrap"><h1>${title}</h1><div class="class-badge"><span>KELAS</span><strong>${escape(report.kelas)}</strong></div></div><p class="headline-subtitle">${subtitle}</p></div>${identity}</div></header>`;
        const footer = number => `<footer><span>${escape(school.schoolName || "SMA Negeri Nusantara")} · ${escape(period.label)} · ${escape(report.kelas)}</span><span>${number} / 02</span></footer>`;
        const cards = selectedSessions.map((s, index) => {
            const photo = reportPhoto(s, baseUrl);
            const sc = s.counts || {};
            const recapHtml = `<div class="lesson-recap">
                <span class="rc-h" title="Hadir"><b>H</b> ${sc.H ?? 0}</span>
                ${sc.S > 0 ? `<span class="rc-s" title="Sakit"><b>S</b> ${sc.S}</span>` : ''}
                ${sc.I > 0 ? `<span class="rc-i" title="Izin"><b>I</b> ${sc.I}</span>` : ''}
                ${(sc.A || 0) > 0 ? `<span class="rc-a" title="Alpa"><b>A</b> ${sc.A}</span>` : ''}
                ${sc.D > 0 ? `<span class="rc-d" title="Dispensasi"><b>D</b> ${sc.D}</span>` : ''}
                ${sc.T > 0 ? `<span class="rc-t" title="Terlambat"><b>T</b> ${sc.T}</span>` : ''}
                ${sc['?'] > 0 ? `<span title="Belum tercatat"><b>BT</b> ${sc['?']}</span>` : ''}
            </div>`;
            const cleanNotes = String(s.catatan || '').trim();
            const notesHtml = cleanNotes ? `<p class="lesson-notes"><span class="lesson-notes-label">Catatan:</span> ${escape(cleanNotes)}</p>` : '';
            return `<article class="lesson"><div class="lesson-photo">${photo ? `<img src="${photo}" alt="Dokumentasi pembelajaran ${escape(shortDate(s.date))}" loading="eager" referrerpolicy="no-referrer">` : '<span>Dokumentasi belum tersedia</span>'}<b>${String(index + 1).padStart(2, '0')}</b><div class="lesson-overlay-tag"><span>${escape(shortDate(s.date))}</span><small>JP ${escape(formatJpDisplay(s.jp) || '—')}</small></div>${recapHtml}</div><div class="lesson-copy"><div class="lesson-topic-row"><h3>${escape(s.topik || s.materi || 'Topik belum diisi')}</h3></div>${notesHtml}</div></article>`;
        }).join('');
        const thDates = sessions.map(s => {
            const parts = (s.date || '').split('-');
            const day = parts.length === 3 ? parseInt(parts[2], 10) : 1;
            const month = parts.length === 3 ? parseInt(parts[1], 10) : 1;
            const jp = formatJpDisplay(s.jp);
            return `<th class="col-date"><div>${day}/${month}</div>${jp ? `<div class="th-jp" title="JP ${escape(jp)}">${escape(jp)}</div>` : ''}</th>`;
        }).join('');
        const thNumbers = sessions.map((_, i) => `<th class="col-num">${i + 1}</th>`).join('');
        const tbodyRows = students.map((s, i) => {
            const meetingCells = (s.sessions || []).map(st => {
                let badge = '';
                if (st && st !== 'H' && st !== '-') {
                    const cls = st === '?' ? 'bt' : st.toLowerCase();
                    badge = `<span class="ji-badge ji-badge-${cls}">${st === '?' ? 'BT' : st}</span>`;
                }
                return `<td class="col-date">${badge}</td>`;
            }).join('');
            const jml = (s.counts.S || 0) + (s.counts.I || 0) + (s.counts.A || 0) + (s.counts.D || 0);
            return `<tr>
                <td class="col-no">${i + 1}</td>
                <td class="col-nis">${escape(s.nis || '-')}</td>
                <td class="col-name"><b>${escape(s.name)}</b></td>
                ${meetingCells}
                <td class="col-stat ${s.counts.S > 0 ? 'stat-s' : 'stat-muted'}">${s.counts.S || 0}</td>
                <td class="col-stat ${s.counts.I > 0 ? 'stat-i' : 'stat-muted'}">${s.counts.I || 0}</td>
                <td class="col-stat ${s.counts.A > 0 ? 'stat-a' : 'stat-muted'}">${s.counts.A || 0}</td>
                <td class="col-stat ${s.counts.D > 0 ? 'stat-d' : 'stat-muted'}">${s.counts.D || 0}</td>
                <td class="col-stat ${s.counts.T > 0 ? 'stat-t' : 'stat-muted'}">${s.counts.T || 0}</td>
                <td class="col-stat ${jml > 0 ? 'stat-jml' : 'stat-muted'}"><b>${jml}</b></td>
                <td class="col-rate"><b>${s.rate === null ? '—' : s.rate + '%'}</b></td>
            </tr>`;
        }).join('');
        const nameWidth = sessions.length <= 4 ? 250 : sessions.length <= 8 ? 220 : 180;
        const tableHtml = `<table class="ji-table-grid" data-rows="${students.length > 30 ? 'many' : 'normal'}" data-meetings="${sessions.length > 12 ? 'many' : 'normal'}">
            <colgroup><col style="width:22px"><col style="width:40px"><col style="width:${nameWidth}px">${sessions.map(() => '<col>').join('')}<col span="6" style="width:24px"><col style="width:40px"></colgroup>
            <thead>
                <tr class="th-main">
                    <th rowspan="3" class="col-no">NO</th>
                    <th rowspan="3" class="col-nis">NIS</th>
                    <th rowspan="3" class="col-name">NAMA PESERTA DIDIK</th>
                    <th colspan="${sessions.length || 1}" class="th-group" title="TANGGAL KEGIATAN PEMBELAJARAN / PERTEMUAN KE -">TANGGAL / JP / PERTEMUAN</th>
                    <th colspan="6" class="th-group" title="RINCIAN KETIDAKHADIRAN">KETIDAKHADIRAN</th>
                    <th rowspan="3" class="col-rate">H%</th>
                </tr>
                <tr class="th-dates">
                    ${thDates || '<th class="col-date">-</th>'}
                    <th colspan="6" class="th-subgroup">REKAP</th>
                </tr>
                <tr class="th-numbers">
                    ${thNumbers || '<th class="col-num">-</th>'}
                    <th class="th-s" title="Sakit">S</th>
                    <th class="th-i" title="Izin">I</th>
                    <th class="th-a" title="Alpa">A</th>
                    <th class="th-d" title="Dispensasi">D</th>
                    <th class="th-t" title="Terlambat">T</th>
                    <th class="th-jml" title="Jumlah Ketidakhadiran">JML</th>
                </tr>
            </thead>
            <tbody>${tbodyRows}</tbody>
        </table>`;
        const headerPage2 = `<header class="p2-header">
            <div class="p2-topbar">
                <div class="p2-brand">
                    <img src="${logo}" alt="Logo sekolah">
                    <div>
                        <b>${escape(school.schoolName || "SMA Negeri Nusantara")}</b>
                        <span>LAPORAN MENGAJAR ${escape(period.label || '').toUpperCase()}</span>
                    </div>
                </div>
                <div class="p2-doc-title">
                    <h2>REKAP KEHADIRAN SISWA</h2>
                    <p>Seluruh ${sessions.length} pertemuan bulan berjalan · Rekap jurnal pembelajaran</p>
                </div>
                <div class="p2-class-badge">
                    <span>KELAS</span>
                    <strong>${escape(report.kelas)}</strong>
                </div>
            </div>
            <div class="p2-summary-bar">
                <div class="p2-info-item p2-teacher-item">
                    ${teacherPhotoUrl ? `<img src="${teacherPhotoUrl}" class="p2-teacher-avatar" alt="Foto ${escape(report.teacherName)}" width="22" height="22" onerror="this.remove()">` : ''}
                    <div>
                        <span class="p2-lbl">GURU:</span>
                        <b>${escape(report.teacherName)}</b>${hasNip ? ` <small>(${escape(formattedNip)})</small>` : ''}
                    </div>
                </div>
                <div class="p2-info-item">
                    <span class="p2-lbl">MAPEL:</span>
                    <b>${escape(report.mapel)}</b>
                </div>
                <div class="p2-info-item p2-stat-box">
                    <div class="p2-rate">
                        <span class="p2-lbl">KEHADIRAN:</span>
                        <strong>${report.rate === null ? '—' : report.rate + '%'}</strong>
                    </div>
                    <div class="p2-badges">
                        <span class="p2-b-h" title="Hadir"><b>H</b> ${report.total.H || 0}</span>
                        <span class="p2-b-s" title="Sakit"><b>S</b> ${report.total.S || 0}</span>
                        <span class="p2-b-i" title="Izin"><b>I</b> ${report.total.I || 0}</span>
                        <span class="p2-b-a" title="Alpa"><b>A</b> ${report.total.A || 0}</span>
                        <span class="p2-b-d" title="Dispensasi"><b>D</b> ${report.total.D || 0}</span>
                        <span class="p2-b-t" title="Terlambat (Terhitung Hadir)"><b>T</b> ${report.total.T || 0}</span>
                        ${report.total['?'] > 0 ? `<span class="p2-b-bt" title="Belum tercatat"><b>BT</b> ${report.total['?']}</span>` : ''}
                    </div>
                </div>
            </div>
        </header>`;

        return `        <section class="sheet" data-kelas="${escape(report.kelas)}">${header('01', 'Dokumentasi Pembelajaran', `Dokumentasi & materi · 1–${Number(period.end.slice(-2))} ${escape(period.label)}`)}
        <div class="metrics"><div><strong>${sessions.length}</strong><span>Pertemuan bulan ini</span></div><div><strong>${report.totalJp}</strong><span>Jam pelajaran</span></div><div><strong>${selectedSessions.length}</strong><span>Jurnal ditampilkan</span></div><div><strong>${students.length}</strong><span>Siswa</span></div></div>
        <div class="section-label"><h2>Aktivitas belajar</h2><span>${selectedSessions.length} DARI ${sessions.length} JURNAL · URUTAN PELAKSANAAN</span></div><div class="fit-area"><div class="fit-content"><div class="lessons ${selectedSessions.length > 6 ? 'dense' : ''}">${cards}</div></div></div>
        <div class="signature"><div><b>Refleksi melalui dokumentasi.</b><p>Rekap jurnal guru untuk kelas dan mata pelajaran terpilih sampai ${escape(shortDate(period.end))}.</p></div><div class="signature-block"><p>${escape(school.schoolCity)}, ${escape(shortDate(period.end))} ${period.end.slice(0, 4)}</p><p>Guru mata pelajaran</p><img src="${signatureUrl}" alt="Tanda tangan guru"><b>${escape(report.teacherName)}</b>${hasNip ? `<small>${escape(formattedNip)}</small>` : ''}</div></div>${footer('01')}</section>
        <section class="sheet" data-page="2" data-kelas="${escape(report.kelas)}">${headerPage2}
        <div class="fit-area"><div class="fit-content"><div class="attendance-tables">${tableHtml}</div></div></div>
        <div class="attendance-note"><b>H</b> Hadir (kolom pertemuan kosong) · <b>S</b> Sakit · <b>I</b> Izin · <b>A</b> Alpa · <b>D</b> Dispensasi · <b>T</b> Terlambat (terhitung hadir) · <b>BT</b> Belum tercatat.<br>H% = (hadir + terlambat) ÷ presensi tercatat × 100%. Setiap tanggal dan kelompok JP dihitung satu pertemuan. Pada jurnal dengan daftar ketidakhadiran, siswa kelas yang tidak tercantum dihitung hadir. Daftar siswa memakai keanggotaan kelas saat laporan dibuat.</div>${footer('02')}</section>`;
    }).join('\n');

    const titleText = reports.length > 1
        ? `Laporan Mengajar Multi-Kelas (${reports.map(r => r.kelas).join(', ')}) ${period.label} - ${firstReport.teacherName}`
        : `Laporan Mengajar ${firstReport.kelas} ${period.label} - ${firstReport.teacherName}`;

    return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(titleText)}</title><link rel="stylesheet" href="${escape(new URL('css/jurnal-infographic-report.css', baseUrl).href)}"></head><body class="ji-report">
${sheetsHtml}</body></html>`;
}

export async function prepareReportFrame(frame) {
    const doc = frame.contentDocument;
    await Promise.all([...doc.images].map(img => new Promise(resolve => {
        const finish = () => {
            clearTimeout(timer);
            if (!img.naturalWidth) {
                if (img.closest('.lesson-photo')) img.parentElement.append(Object.assign(doc.createElement('span'), { textContent: 'Foto tidak dapat dimuat' }));
                img.remove();
            }
            resolve();
        };
        const timer = setTimeout(finish, 12000);
        if (img.complete) finish(); else { img.onload = finish; img.onerror = finish; }
    })));
    await doc.fonts.ready;
    let fits = true;
    doc.querySelectorAll('.fit-area').forEach(area => {
        const content = area.firstElementChild;
        let scale = 1;
        const grid = content.querySelector('.lessons');
        if (grid) {
            const cards = [...grid.children];
            const compact = cards.length >= 9;
            grid.dataset.layout = compact ? 'compact' : 'gallery';
            const columns = cards.length === 1 ? 1 : cards.length <= 6 || compact ? 2 : 3;
            const rows = Math.ceil(cards.length / columns);
            const gap = parseFloat(frame.contentWindow.getComputedStyle(grid).rowGap) || 8;
            const idealHeight = cards.length === 1 ? 470 : cards.length === 2 ? 380 : cards.length <= 4 ? 260 : cards.length <= 6 ? 210 : 180;
            const minimumHeight = 72;
            grid.style.gridTemplateColumns = `repeat(${columns * 2}, minmax(0, 1fr))`;
            cards.forEach(card => { card.style.gridColumn = 'span 2'; });
            const remainder = cards.length % columns;
            if (remainder === 1) cards[cards.length - 1].style.gridColumn = `${columns} / span 2`;
            if (columns === 3 && remainder === 2) cards[cards.length - 2].style.gridColumn = '2 / span 2';
            // Allocate the remaining page height to photos after measuring every topic.
            // Text stays complete; column count and photo height adapt to the actual content.
            while (!compact) {
                content.style.width = `${100 / scale}%`;
                let copyHeight = 0;
                for (let i = 0; i < cards.length; i += columns) {
                    copyHeight += Math.max(...cards.slice(i, i + columns).map(card => card.querySelector('.lesson-copy').offsetHeight)) + 2;
                }
                const availablePhotoHeight = (area.clientHeight / scale - copyHeight - gap * (rows - 1) - 3) / rows;
                const photoHeight = Math.max(minimumHeight, Math.min(idealHeight, Math.floor(availablePhotoHeight)));
                cards.forEach(card => { card.querySelector('.lesson-photo').style.height = `${photoHeight}px`; });
                if (availablePhotoHeight >= minimumHeight || scale <= 0.95) break;
                scale = Math.max(0.95, scale - 0.025);
            }
        }
        while (scale > 0.85 && (content.scrollHeight * scale > area.clientHeight + 0.5 || content.scrollWidth * scale > area.clientWidth + 0.5)) {
            scale = Math.max(0.85, scale - 0.02);
            content.style.width = `${100 / scale}%`;
        }
        content.style.transform = `scale(${scale})`;
        if (content.scrollHeight * scale > area.clientHeight + 1 || content.scrollWidth * scale > area.clientWidth + 1) fits = false;
    });
    doc.querySelectorAll('.sheet').forEach(sheet => { if (sheet.scrollHeight > sheet.clientHeight + 2) fits = false; });
    return fits;
}

export async function openInfographicDialog(options) {
    if (document.getElementById('ji-dialog')) return;

    const initialKelas = options.kelas;
    let availableClasses = Array.isArray(options.availableClasses) && options.availableClasses.length > 0
        ? [...options.availableClasses]
        : [initialKelas];
    if (initialKelas && !availableClasses.includes(initialKelas)) {
        availableClasses.unshift(initialKelas);
    }
    availableClasses = Array.from(new Set(availableClasses));

    let currentMonthValue = options.selectedMonth && options.selectedMonth !== 'all'
        ? options.selectedMonth
        : '';
    let period = currentReportPeriod(currentMonthValue || new Date());

    const selectedClasses = new Set([initialKelas]);
    let activeEditorClass = initialKelas;
    const classDataMap = new Map();

    const dialog = document.createElement('dialog');
    dialog.id = 'ji-dialog';
    dialog.className = 'ji-dialog';
    dialog.setAttribute('aria-labelledby', 'ji-title');

    const monthSelectHtml = Array.isArray(options.availableMonths) && options.availableMonths.length > 0
        ? `<div class="ji-month-select-wrap">
            <label for="ji-month-select" class="sr-only">Bulan Laporan</label>
            <select id="ji-month-select" class="ji-month-select" title="Pilih Bulan Laporan">
                ${options.availableMonths.map(m => `
                    <option value="${escape(m.value)}" ${m.value === currentMonthValue ? 'selected' : ''}>${escape(m.label)}</option>
                `).join('')}
            </select>
           </div>`
        : '';

    dialog.innerHTML = `
        <div class="ji-dialog-head">
            <div class="ji-head-info">
                <div class="ji-head-title-row">
                    <h2 id="ji-title">Siapkan infografis mengajar</h2>
                    <span class="ji-head-badge">Laporan Bulanan · 2 Halaman A4 per Kelas</span>
                    <span class="ji-vip-badge"><i class="fa-solid fa-crown" aria-hidden="true"></i> SIMAS VIP</span>
                </div>
                <span class="ji-head-dot" aria-hidden="true">·</span>
                <p class="ji-scope"></p>
                ${monthSelectHtml}
            </div>
            <button type="button" data-action="close" aria-label="Tutup infografis">×</button>
        </div>
        <div class="ji-dialog-body">
            <div class="ji-sign-form" hidden>
                <div class="ji-photo-editor">
                    <!-- Multi-Class Selector Container -->
                    <div class="ji-class-selector" ${availableClasses.length > 1 ? '' : 'hidden'}>
                        <div class="ji-class-selector-header">
                            <span class="ji-class-selector-title">Pilih Kelas untuk Dicetak:</span>
                            <div class="ji-class-quick-btns">
                                <button type="button" data-action="select-all-classes" class="ji-btn-quick">Pilih Semua Kelas</button>
                                <button type="button" data-action="select-single-class" class="ji-btn-quick">Hanya Kelas Ini</button>
                            </div>
                        </div>
                        <div class="ji-class-pills">
                            ${availableClasses.map(c => `
                                <label class="ji-class-pill ${c === initialKelas ? 'ji-class-pill-active' : ''}">
                                    <input type="checkbox" data-class-select="${escape(c)}" ${c === initialKelas ? 'checked' : ''}>
                                    <span>${escape(c)}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Multi-Class Tabs for Photo Review -->
                    <div class="ji-class-tabs" hidden>
                        <span class="ji-class-tabs-label">Tinjau Foto Kelas:</span>
                        <div class="ji-class-tabs-list"></div>
                    </div>

                    <!-- Gallery Header -->
                    <div class="ji-gallery-head">
                        <div>
                            <h3 id="ji-editor-class-title">Pilih jurnal & foto</h3>
                            <p id="ji-editor-class-desc">${MAX_REPORT_JOURNALS} pilihan maksimal</p>
                        </div>
                        <strong class="ji-selection-count" aria-live="polite"></strong>
                    </div>
                    <p class="ji-gallery-hint">Klik centang untuk memilih. Foto buram? Ganti khusus untuk laporan ini.</p>
                    <div class="ji-photo-list"></div>
                    <p class="ji-gallery-note">Foto asli di Drive tetap utuh. JPG, PNG, atau WebP · maksimal 15 MB per foto.</p>
                </div>

                <aside class="ji-sign-panel" aria-labelledby="ji-sign-heading">
                    <span class="ji-eyebrow">SEBELUM DICETAK</span><h3 id="ji-sign-heading">Tanda tangan guru</h3>
                    <div class="ji-teacher"></div>
                    <p>Goreskan dengan mouse, pena, atau jari. Berlaku untuk seluruh kelas yang dipilih.</p>
                    <canvas id="ji-signature" width="1000" height="520" tabindex="0" aria-label="Area menggambar tanda tangan guru" aria-describedby="ji-sign-state"></canvas>
                    <div class="ji-sign-controls"><span id="ji-sign-state" aria-live="polite">Belum ditandatangani</span><button type="button" data-action="clear">Hapus</button></div>
                    <div class="ji-report-summary"><b>Isi laporan Anda</b><p>Halaman 1 · Foto & ringkasan mengajar</p><p>Halaman 2 · Kehadiran seluruh bulan</p></div>
                </aside>
            </div>
            <div class="ji-preview" hidden><p class="ji-print-note">Cetak dengan kertas A4, skala 100%, tanpa header dan footer browser.</p><iframe title="Pratinjau infografis dua halaman A4 per kelas" class="ji-frame"></iframe></div>
        </div>
        <div class="ji-dialog-foot">
            <p role="status" class="ji-message">Memuat jurnal dan data siswa terbaru…</p>
            <div class="ji-edit-actions" hidden><button type="button" data-action="signature" class="ji-sign-jump">Tanda tangan</button><button type="button" data-action="preview" class="primary" disabled title="Bubuhkan tanda tangan terlebih dahulu untuk membuat pratinjau">Buat pratinjau <span aria-hidden="true">→</span></button></div>
            <div class="ji-preview-actions" hidden><button type="button" data-action="back">Ubah isi laporan</button><button type="button" data-action="zoom">Ukuran asli</button><button type="button" data-action="print" class="primary" disabled>Cetak / Simpan PDF</button></div>
        </div>`;

    document.body.append(dialog);

    const updateScopeText = () => {
        const sortedSelected = availableClasses.filter(c => selectedClasses.has(c));
        const classStr = sortedSelected.length > 1
            ? `${sortedSelected.length} Kelas (${sortedSelected.join(', ')})`
            : (sortedSelected[0] || options.kelas);
        const scopeEl = dialog.querySelector('.ji-scope');
        if (scopeEl) scopeEl.textContent = `${classStr} · ${options.mapel} · ${period.label} (sampai ${shortDate(period.end)})`;
    };
    updateScopeText();

    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.addEventListener('close', () => { document.body.style.overflow = previousOverflow; dialog.remove(); }, { once: true });

    const message = dialog.querySelector('.ji-message');
    const form = dialog.querySelector('.ji-sign-form');
    const preview = dialog.querySelector('.ji-preview');
    const editActions = dialog.querySelector('.ji-edit-actions');
    const previewActions = dialog.querySelector('.ji-preview-actions');
    const previewButton = dialog.querySelector('[data-action="preview"]');
    const scrollBody = dialog.querySelector('.ji-dialog-body');
    const canvas = dialog.querySelector('canvas');
    const reportFrame = dialog.querySelector('iframe');
    const photoEditor = dialog.querySelector('.ji-photo-editor');

    let previewReady = false;
    let fitPreview = true;
    const resizePreview = () => {
        if (!previewReady || !reportFrame.contentDocument) return;
        const zoom = fitPreview ? Math.min(1, Math.max(0.2, (reportFrame.clientWidth - 32) / (210 * 96 / 25.4))) : 1;
        reportFrame.contentDocument.documentElement.style.setProperty('--ji-preview-zoom', String(zoom));
    };
    const previewObserver = new ResizeObserver(resizePreview);
    previewObserver.observe(reportFrame);
    dialog.addEventListener('close', () => previewObserver.disconnect(), { once: true });

    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#122b44';
    let hasSignature = false;
    let drawing = false;
    let pendingPhotos = 0;
    const baseUrl = new URL('../', import.meta.url).href;

    const updatePreviewButtonState = () => {
        let missingJournalsClass = null;
        for (const cls of selectedClasses) {
            const entry = classDataMap.get(cls);
            if (!entry?.report?.sessions?.some(s => s.includeInReport)) {
                missingJournalsClass = cls;
                break;
            }
        }
        const canPreview = Boolean(hasSignature && !missingJournalsClass && pendingPhotos === 0);
        previewButton.disabled = !canPreview;
        if (!hasSignature) {
            previewButton.title = 'Bubuhkan tanda tangan terlebih dahulu untuk membuat pratinjau';
        } else if (missingJournalsClass) {
            previewButton.title = `Pilih minimal satu jurnal pada kelas ${missingJournalsClass}`;
        } else if (pendingPhotos > 0) {
            previewButton.title = 'Menunggu pemrosesan foto…';
        } else {
            previewButton.title = `Lihat pratinjau laporan (${selectedClasses.size} kelas · ${selectedClasses.size * 2} halaman A4)`;
        }
    };

    function updateClassTabs() {
        const tabsContainer = photoEditor.querySelector('.ji-class-tabs');
        const tabsList = photoEditor.querySelector('.ji-class-tabs-list');
        if (!tabsContainer || !tabsList) return;
        if (selectedClasses.size <= 1) {
            tabsContainer.hidden = true;
            return;
        }
        tabsContainer.hidden = false;
        const sortedSelected = availableClasses.filter(c => selectedClasses.has(c));
        tabsList.innerHTML = sortedSelected.map(c => {
            const entry = classDataMap.get(c);
            const count = entry?.report?.sessions?.filter(s => s.includeInReport)?.length ?? 0;
            const isActive = c === activeEditorClass;
            return `<button type="button" class="ji-class-tab-btn ${isActive ? 'ji-class-tab-active' : ''}" data-class-tab="${escape(c)}">
                <span>${escape(c)}</span>
                <span class="ji-tab-badge">${count}</span>
            </button>`;
        }).join('');
    }

    const updateSelection = () => {
        const entry = classDataMap.get(activeEditorClass);
        const report = entry?.report;
        if (!report) return;
        const selected = report.sessions.filter(session => session.includeInReport).length;
        const countEl = photoEditor.querySelector('.ji-selection-count');
        if (countEl) countEl.textContent = `${selected} / ${MAX_REPORT_JOURNALS} dipilih`;
        photoEditor.querySelectorAll('[data-photo-card]').forEach(card => {
            const idx = Number(card.dataset.photoCard);
            const included = report.sessions[idx]?.includeInReport;
            card.classList.toggle('ji-not-selected', !included);
            const choiceText = card.querySelector('.ji-choice-text');
            if (choiceText) choiceText.textContent = included ? 'Dipilih' : 'Pilih jurnal';
        });
        updateClassTabs();
    };

    const updatePhotoCard = (index) => {
        const card = photoEditor.querySelector(`[data-photo-card="${index}"]`);
        const entry = classDataMap.get(activeEditorClass);
        const session = entry?.report?.sessions?.[index];
        if (!card || !session) return;
        const img = card.querySelector('img');
        const thumb = card.querySelector('.ji-photo-thumb');
        if (img) {
            const nextSrc = reportPhoto(session, baseUrl);
            if (nextSrc) {
                img.hidden = false;
                if (thumb) delete thumb.dataset.empty;
                img.onload = () => { img.hidden = false; if (thumb) delete thumb.dataset.empty; };
                img.onerror = () => { img.hidden = true; if (thumb) thumb.dataset.empty = 'Foto tidak tersedia'; };
                img.src = nextSrc;
            } else {
                img.hidden = true;
                if (thumb) thumb.dataset.empty = 'Foto tidak tersedia';
                img.removeAttribute('src');
            }
        }
        const stateEl = card.querySelector('.ji-photo-state');
        if (stateEl) stateEl.textContent = session.reportPhoto ? 'Foto khusus laporan' : 'Foto asli jurnal';
        const restoreBtn = card.querySelector('[data-action="restore-photo"]');
        if (restoreBtn) restoreBtn.hidden = !session.reportPhoto;
    };

    function renderPhotoList() {
        const entry = classDataMap.get(activeEditorClass);
        const report = entry?.report;
        const photoList = photoEditor.querySelector('.ji-photo-list');
        const titleEl = photoEditor.querySelector('#ji-editor-class-title');
        const descEl = photoEditor.querySelector('#ji-editor-class-desc');
        if (!photoList) return;

        if (titleEl) {
            titleEl.textContent = selectedClasses.size > 1
                ? `Foto Jurnal Kelas ${activeEditorClass}`
                : 'Pilih jurnal & foto';
        }

        if (!report) {
            photoList.innerHTML = `<div class="ji-photo-state" style="padding:24px;text-align:center;">Memuat data kelas ${escape(activeEditorClass)}…</div>`;
            return;
        }

        if (descEl) {
            descEl.textContent = `${report.sessions.length} jurnal tersedia · maksimal ${MAX_REPORT_JOURNALS} pilihan`;
        }

        if (!report.sessions.length) {
            photoList.innerHTML = `<div class="ji-photo-state" style="padding:24px;text-align:center;color:#64748b;">Belum ada jurnal untuk kelas ${escape(activeEditorClass)} pada bulan ini.</div>`;
            updateSelection();
            return;
        }

        photoList.innerHTML = report.sessions.map((s, index) => {
            const cleanNotes = String(s.catatan || '').trim();
            const notesHtml = cleanNotes ? `<p class="ji-card-notes"><b class="ji-card-notes-label">Catatan:</b> ${escape(cleanNotes)}</p>` : '';
            return `<article class="ji-photo-card ${s.includeInReport ? '' : 'ji-not-selected'}" data-photo-card="${index}"><div class="ji-card-media"><label class="ji-photo-thumb" for="ji-choose-${index}" title="Pilih atau lepas jurnal ini"><img alt="Foto pertemuan ${index + 1}" src="${reportPhoto(s, baseUrl)}"></label><label class="ji-journal-selection"><input id="ji-choose-${index}" type="checkbox" data-journal-select="${index}" ${s.includeInReport ? 'checked' : ''}><span class="ji-choice-text">${s.includeInReport ? 'Dipilih' : 'Pilih jurnal'}</span></label></div><div class="ji-card-copy"><div class="ji-card-meta"><b>${escape(shortDate(s.date))}</b><span>JP ${escape(formatJpDisplay(s.jp))}</span></div><h4>${escape(s.topik || s.materi || 'Topik belum diisi')}</h4>${notesHtml}<span class="ji-photo-state">${s.reportPhoto ? 'Foto khusus laporan' : 'Foto asli jurnal'}</span><div class="ji-card-actions"><label class="ji-photo-input"><span>Ganti foto</span><input type="file" accept="image/jpeg,image/png,image/webp" data-photo-index="${index}" aria-label="Ganti foto pertemuan ${index + 1} untuk laporan"></label><button type="button" data-action="restore-photo" ${s.reportPhoto ? '' : 'hidden'}>Kembali ke foto asli</button></div></div></article>`;
        }).join('');

        photoList.querySelectorAll('img').forEach(img => {
            const parent = img.closest('.ji-photo-thumb') || img.parentElement;
            const unavailable = () => {
                img.hidden = true;
                if (parent) parent.dataset.empty = 'Foto tidak tersedia';
            };
            const available = () => {
                img.hidden = false;
                if (parent) delete parent.dataset.empty;
            };

            const src = img.getAttribute('src');
            if (!src) {
                unavailable();
                return;
            }

            img.onload = available;
            img.onerror = unavailable;

            if (img.complete && img.naturalWidth > 0) {
                available();
            }
        });

        updateSelection();
    }

    async function loadClassData(cls) {
        if (classDataMap.has(cls)) return classDataMap.get(cls);
        message.textContent = `Memuat jurnal dan data siswa kelas ${cls}…`;
        const classOpts = {
            ...options,
            kelas: cls,
            teacherName: options.teacherName,
            teacherNip: options.teacherNip,
            teacherPhoto: options.teacherPhoto
        };
        const data = await options.fetchData(period, cls);
        const rep = buildMonthlyReport(data.journals, data.students, classOpts, period);
        const entry = { ...data, report: rep };
        classDataMap.set(cls, entry);
        return entry;
    }

    async function ensureSelectedClassesLoaded() {
        const missing = Array.from(selectedClasses).filter(c => !classDataMap.has(c));
        if (!missing.length) return;
        message.textContent = `Memuat ${missing.length} kelas terpilih…`;
        previewButton.disabled = true;
        await Promise.all(missing.map(cls => loadClassData(cls)));
        message.textContent = 'Data kelas berhasil dimuat. Bubuhkan tanda tangan, lalu lihat pratinjau.';
        updateSelection();
        updatePreviewButtonState();
    }

    // Event listeners for photoEditor
    photoEditor.addEventListener('change', async event => {
        const classSelect = event.target.closest('[data-class-select]');
        if (classSelect) {
            const cls = classSelect.dataset.classSelect;
            if (classSelect.checked) {
                selectedClasses.add(cls);
                classSelect.closest('.ji-class-pill')?.classList.add('ji-class-pill-active');
                updateScopeText();
                updateClassTabs();
                await ensureSelectedClassesLoaded();
                updatePreviewButtonState();
            } else {
                if (selectedClasses.size <= 1) {
                    classSelect.checked = true;
                    message.textContent = 'Minimal satu kelas harus dipilih.';
                    return;
                }
                selectedClasses.delete(cls);
                classSelect.closest('.ji-class-pill')?.classList.remove('ji-class-pill-active');
                if (activeEditorClass === cls) {
                    activeEditorClass = availableClasses.find(c => selectedClasses.has(c)) || initialKelas;
                }
                updateScopeText();
                updateClassTabs();
                renderPhotoList();
                updatePreviewButtonState();
            }
            return;
        }

        const selection = event.target.closest('[data-journal-select]');
        if (selection) {
            const entry = classDataMap.get(activeEditorClass);
            const report = entry?.report;
            if (!report) return;
            const session = report.sessions[Number(selection.dataset.journalSelect)];
            if (selection.checked && report.sessions.filter(s => s.includeInReport).length >= MAX_REPORT_JOURNALS) {
                selection.checked = false;
                message.textContent = `Maksimal 8 jurnal untuk kelas ${activeEditorClass}. Lepas salah satu pilihan sebelum memilih jurnal lain.`;
                return;
            }
            session.includeInReport = selection.checked;
            updateSelection();
            updatePreviewButtonState();
            message.textContent = `Pilihan jurnal kelas ${activeEditorClass} diperbarui.`;
            return;
        }

        const input = event.target.closest('input[type="file"]');
        const file = input?.files?.[0];
        if (!file) return;
        const entry = classDataMap.get(activeEditorClass);
        const report = entry?.report;
        if (!report) return;
        const index = Number(input.dataset.photoIndex);
        const restoreButton = input.closest('[data-photo-card]').querySelector('[data-action="restore-photo"]');
        pendingPhotos++;
        updatePreviewButtonState();
        input.disabled = true;
        restoreButton.disabled = true;
        message.textContent = 'Memeriksa foto pengganti…';
        try {
            const photo = await readReportPhoto(file);
            if (!dialog.isConnected) return;
            report.sessions[index].reportPhoto = photo;
            updatePhotoCard(index);
            message.textContent = `Foto pengganti siap untuk kelas ${activeEditorClass}. Foto asli tetap tersimpan.`;
        } catch (error) { if (dialog.isConnected) message.textContent = error.message; }
        finally {
            pendingPhotos--;
            input.disabled = false;
            restoreButton.disabled = false;
            input.value = '';
            updatePreviewButtonState();
        }
    });

    photoEditor.addEventListener('click', async event => {
        const tabBtn = event.target.closest('[data-class-tab]');
        if (tabBtn) {
            const targetClass = tabBtn.dataset.classTab;
            if (targetClass && targetClass !== activeEditorClass && selectedClasses.has(targetClass)) {
                activeEditorClass = targetClass;
                updateClassTabs();
                renderPhotoList();
            }
            return;
        }

        const quickAction = event.target.closest('[data-action]');
        if (quickAction) {
            const act = quickAction.dataset.action;
            if (act === 'select-all-classes') {
                availableClasses.forEach(c => selectedClasses.add(c));
                photoEditor.querySelectorAll('[data-class-select]').forEach(cb => {
                    cb.checked = true;
                    cb.closest('.ji-class-pill')?.classList.add('ji-class-pill-active');
                });
                updateScopeText();
                updateClassTabs();
                await ensureSelectedClassesLoaded();
                renderPhotoList();
                return;
            }
            if (act === 'select-single-class') {
                selectedClasses.clear();
                selectedClasses.add(initialKelas);
                activeEditorClass = initialKelas;
                photoEditor.querySelectorAll('[data-class-select]').forEach(cb => {
                    const isInit = cb.dataset.classSelect === initialKelas;
                    cb.checked = isInit;
                    cb.closest('.ji-class-pill')?.classList.toggle('ji-class-pill-active', isInit);
                });
                updateScopeText();
                updateClassTabs();
                renderPhotoList();
                updatePreviewButtonState();
                return;
            }
        }
    });

    // Month Selector in Dialog Head
    const monthSelectEl = dialog.querySelector('#ji-month-select');
    if (monthSelectEl) {
        monthSelectEl.addEventListener('change', async () => {
            currentMonthValue = monthSelectEl.value;
            period = currentReportPeriod(currentMonthValue || new Date());
            updateScopeText();
            classDataMap.clear();
            message.textContent = `Memuat data jurnal untuk periode ${period.label}…`;
            previewButton.disabled = true;
            try {
                await Promise.all(Array.from(selectedClasses).map(cls => loadClassData(cls)));
                renderPhotoList();
                updateSelection();
                updatePreviewButtonState();
                message.textContent = `Data periode ${period.label} siap.`;
            } catch (err) {
                message.textContent = `Gagal memuat data bulan: ${err.message}`;
            }
        });
    }

    const point = e => { const rect = canvas.getBoundingClientRect(); return [(e.clientX - rect.left) * canvas.width / rect.width, (e.clientY - rect.top) * canvas.height / rect.height]; };
    canvas.addEventListener('pointerdown', e => {
        if (e.button !== 0 || drawing) return;
        e.preventDefault(); drawing = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...point(e));
    });
    canvas.addEventListener('pointermove', e => {
        if (drawing && canvas.hasPointerCapture(e.pointerId)) {
            ctx.lineTo(...point(e));
            ctx.stroke();
            if (!hasSignature) {
                hasSignature = true;
                updatePreviewButtonState();
            }
            canvas.classList.add('ji-signed');
            dialog.querySelector('#ji-sign-state').textContent = 'Tanda tangan siap';
        }
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(event => canvas.addEventListener(event, () => { drawing = false; }));

    dialog.addEventListener('click', async e => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'close') dialog.close();
        if (action === 'clear') {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            hasSignature = false;
            canvas.classList.remove('ji-signed');
            dialog.querySelector('#ji-sign-state').textContent = 'Belum ditandatangani';
            updatePreviewButtonState();
        }
        if (action === 'signature') { canvas.scrollIntoView({ block: 'center', behavior: 'smooth' }); canvas.focus({ preventScroll: true }); }
        if (action === 'zoom') { fitPreview = !fitPreview; e.target.closest('[data-action]').textContent = fitPreview ? 'Ukuran asli' : 'Pas lebar'; resizePreview(); }
        if (action === 'restore-photo') {
            const index = Number(e.target.closest('[data-photo-card]').dataset.photoCard);
            const entry = classDataMap.get(activeEditorClass);
            if (entry?.report?.sessions?.[index]) {
                delete entry.report.sessions[index].reportPhoto;
                updatePhotoCard(index);
                message.textContent = `Foto pada pertemuan ini dikembalikan ke foto asli jurnal (${activeEditorClass}).`;
            }
        }
        if (action === 'back') {
            preview.hidden = true;
            previewActions.hidden = true;
            form.hidden = false;
            editActions.hidden = false;
            dialog.classList.remove('ji-preview-mode');
            dialog.querySelector('#ji-title').textContent = 'Siapkan infografis mengajar';
            scrollBody.scrollTop = 0;
            message.textContent = 'Ubah jurnal, foto, atau tanda tangan sesuai kebutuhan.';
            updatePreviewButtonState();
        }
        if (action === 'preview' && !pendingPhotos && !previewButton.disabled) {
            const sortedClasses = availableClasses.filter(c => selectedClasses.has(c));
            const reports = sortedClasses.map(c => classDataMap.get(c)?.report).filter(Boolean);
            if (!reports.length) {
                message.textContent = 'Data laporan belum tersedia.';
                return;
            }
            if (!hasSignature) {
                message.textContent = 'Bubuhkan tanda tangan terlebih dahulu sebelum membuat pratinjau.';
                canvas.scrollIntoView({ block: 'center', behavior: 'smooth' });
                canvas.focus({ preventScroll: true });
                return;
            }
            const frame = dialog.querySelector('iframe');
            const printButton = dialog.querySelector('[data-action="print"]');
            printButton.disabled = true;
            previewReady = false;
            form.hidden = true;
            editActions.hidden = true;
            preview.hidden = false;
            previewActions.hidden = false;
            dialog.classList.add('ji-preview-mode');
            scrollBody.scrollTop = 0;

            const totalPages = reports.length * 2;
            dialog.querySelector('#ji-title').textContent = reports.length > 1
                ? `Pratinjau infografis (${reports.length} kelas · ${totalPages} halaman A4)`
                : 'Pratinjau infografis mengajar';
            message.textContent = `Menyiapkan ${totalPages} halaman dan memuat foto…`;
            frame.onload = async () => {
                try {
                    const fits = await prepareReportFrame(frame);
                    if (!dialog.isConnected) return;
                    previewReady = true;
                    resizePreview();
                    printButton.disabled = false;
                    message.textContent = fits
                        ? `Pratinjau siap (${reports.length} kelas · ${totalPages} halaman). Gunakan kertas A4 (skala 100%, tanpa header/footer browser).`
                        : `Pratinjau siap (${reports.length} kelas). Periksa tata letak (kertas A4, skala 100%).`;
                } catch {
                    if (dialog.isConnected) message.textContent = 'Pratinjau gagal dimuat. Kembali dan buat pratinjau lagi.';
                }
            };
            frame.srcdoc = renderReportHtml(reports, canvas.toDataURL('image/png'), new URL('../', import.meta.url).href);
        }
        if (action === 'print' && !e.target.closest('[data-action]').disabled) {
            const frame = dialog.querySelector('iframe');
            frame.contentWindow.focus(); frame.contentWindow.print();
        }
    });

    try {
        if (typeof window !== 'undefined') {
            try {
                if (typeof window.getTeachersMapCache === 'function') {
                    const tMap = await window.getTeachersMapCache();
                    const tData = (options.teacherUid ? tMap?.get(options.teacherUid) : null)
                        || (options.teacherName ? tMap?.get(options.teacherName.toLowerCase().trim()) : null);
                    if ((!options.teacherNip || !/\d{4,}/.test(options.teacherNip)) && tData?.nip && tData.nip !== '-' && /\d{4,}/.test(tData.nip)) {
                        options.teacherNip = String(tData.nip).trim();
                    }
                    if (!options.teacherPhoto && (tData?.foto || tData?.photo_url)) {
                        const rawP = tData.foto || tData.photo_url;
                        options.teacherPhoto = (typeof window.resolvePhotoUrl === 'function') ? window.resolvePhotoUrl(rawP) : rawP;
                    }
                }
                if ((!options.teacherNip || !/\d{4,}/.test(options.teacherNip) || !options.teacherPhoto) && typeof window.getTeachersCache === 'function') {
                    const list = await window.getTeachersCache();
                    if (Array.isArray(list)) {
                        const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        const targetName = norm(options.teacherName);
                        const tData = list.find(t => {
                            if (options.teacherUid && (t.id === options.teacherUid || t.nik === options.teacherUid)) return true;
                            if (targetName && (norm(t.name) === targetName || norm(t.nama) === targetName)) return true;
                            return false;
                        });
                        if ((!options.teacherNip || !/\d{4,}/.test(options.teacherNip)) && tData?.nip && tData.nip !== '-' && /\d{4,}/.test(tData.nip)) {
                            options.teacherNip = String(tData.nip).trim();
                        }
                        if (!options.teacherPhoto && (tData?.foto || tData?.photo_url)) {
                            const rawP = tData.foto || tData.photo_url;
                            options.teacherPhoto = (typeof window.resolvePhotoUrl === 'function') ? window.resolvePhotoUrl(rawP) : rawP;
                        }
                    }
                }
            } catch (e) {
                console.warn('[Infographic] Gagal memuat NIP/Foto GTK:', e);
            }
        }
        if (!options.teacherPhoto && options.teacherUid && typeof localStorage !== 'undefined') {
            options.teacherPhoto = localStorage.getItem(`cached_user_photo_${options.teacherUid}`) || '';
        }

        const initialEntry = await loadClassData(initialKelas);
        if (!dialog.isConnected) return;

        const report = initialEntry.report;
        if (!report.sessions.length && selectedClasses.size === 1) {
            message.textContent = options.isSuperOrAdmin
                ? 'Belum ada jurnal untuk kelas dan mapel ini pada bulan berjalan.'
                : 'Belum ada jurnal Anda untuk kelas dan mapel ini pada bulan berjalan.';
            return;
        }
        if (!report.students.length && selectedClasses.size === 1) {
            message.textContent = 'Daftar siswa kelas belum tersedia. Lengkapi data siswa sebelum membuat laporan kehadiran.';
            return;
        }

        if (options.isSuperOrAdmin && report.sessions[0]?.guru) {
            options.teacherName = report.sessions[0].guru;
            report.teacherName = report.sessions[0].guru;
        }

        if ((options.isSuperOrAdmin || !options.teacherNip || !/\d{4,}/.test(options.teacherNip) || !options.teacherPhoto) && typeof window !== 'undefined') {
            try {
                const targetTeacher = options.teacherName || report.sessions[0]?.guru;
                if (typeof window.getTeachersCache === 'function') {
                    const list = await window.getTeachersCache();
                    if (Array.isArray(list)) {
                        const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        const targetNorm = norm(targetTeacher);
                        const tData = list.find(t => norm(t.name) === targetNorm || norm(t.nama) === targetNorm);
                        if (tData?.nip && tData.nip !== '-' && /\d{4,}/.test(tData.nip)) {
                            options.teacherNip = String(tData.nip).trim();
                            report.teacherNip = options.teacherNip;
                        }
                        if (tData?.foto || tData?.photo_url) {
                            const rawP = tData.foto || tData.photo_url;
                            const resolvedP = (typeof window.resolvePhotoUrl === 'function') ? window.resolvePhotoUrl(rawP) : rawP;
                            options.teacherPhoto = resolvedP;
                            report.teacherPhoto = resolvedP;
                        }
                    }
                }
            } catch (e) {
                console.warn('[Infographic] Gagal menyelaraskan NIP/Foto guru jurnal:', e);
            }
        }

        const nipClean = String(options.teacherNip || '').trim();
        const hasNip = nipClean && nipClean !== '-' && !/^(undefined|null)$/i.test(nipClean) && /\d{4,}/.test(nipClean);
        const formattedNip = hasNip ? (nipClean.toUpperCase().startsWith('NIP') ? nipClean : `NIP. ${nipClean}`) : '';
        const dialogTeacherPhoto = safeTeacherPhoto(options.teacherPhoto || report.teacherPhoto, baseUrl);
        const photoHtml = dialogTeacherPhoto
            ? `<img src="${dialogTeacherPhoto}" class="ji-teacher-avatar" alt="Foto ${escape(options.teacherName)}" width="40" height="40" onerror="this.remove()">`
            : `<div class="ji-teacher-avatar-fallback">${escape((options.teacherName || 'G').charAt(0).toUpperCase())}</div>`;
        dialog.querySelector('.ji-teacher').innerHTML = `
            ${photoHtml}
            <div class="ji-teacher-details">
                <b>${escape(options.teacherName)}</b>
                ${hasNip ? `<small>${escape(formattedNip)}</small>` : ''}
            </div>
        `;

        renderPhotoList();
        updateClassTabs();

        message.textContent = 'Pilih jurnal, bubuhkan tanda tangan, lalu lihat pratinjau.';
        form.hidden = false; editActions.hidden = false; updatePreviewButtonState();
    } catch (error) { if (dialog.isConnected) message.textContent = `Gagal memuat laporan: ${error.message}. Tutup dan coba lagi.`; }
}
