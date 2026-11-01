// A4 portrait: ten bounded cards per page. Only genuinely overflowing details use the appendix.
export const JURNAL_PDF_ENTRIES_PER_PAGE = 10;
const COLORS = { ink: '#142D3B', teal: '#087F82', light: '#EAF5F3', muted: '#586B76', line: '#DCE6EA', gray: '#F2F5F7' };
const clean = value => String(value ?? '').trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[\u2010-\u2015]/g, '-');

export function createCompactJurnalPdfLayout(pdf, report, kop, { signal } = {}) {
    const left = 12, width = 186, bottom = 278, columnGap = 4, rowGap = 3;
    const cardWidth = (width - columnGap) / 2;
    const kopHeight = Math.min(54, width * kop.height / kop.width);
    const top = 8 + kopHeight + 20;
    const cardHeight = (bottom - top - rowGap * 4) / 5;
    const appendices = [];
    const references = [];
    const anchors = new Map();
    let y = top;
    let appendixEntry = null;
    let gridPages = 0;
    const checkAbort = () => { if (signal?.aborted) throw new DOMException('Ekspor dibatalkan.', 'AbortError'); };
    const font = (size = 8, style = 'normal', color = COLORS.ink) => { pdf.setFont('helvetica', style); pdf.setFontSize(size); pdf.setTextColor(color); };
    const wrap = (value, w, size, style = 'normal') => { font(size, style); return pdf.splitTextToSize(clean(value) || '-', w); };

    function bounded(value, x, baseline, w, maxLines, { size = 6.8, style = 'normal', color = COLORS.ink, step = 2.7 } = {}) {
        const allLines = wrap(value, w, size, style);
        const visible = allLines.slice(0, maxLines);
        const overflow = allLines.length > maxLines;
        if (overflow) {
            let last = visible[visible.length - 1];
            while (last && pdf.getTextWidth(`${last}...`) > w) last = last.slice(0, -1);
            visible[visible.length - 1] = `${last}...`;
        }
        font(size, style, color);
        visible.forEach((line, index) => pdf.text(line, x, baseline + index * step));
        return overflow;
    }

    function pageHeader(section, add = true, start = 0) {
        checkAbort();
        if (add) pdf.addPage();
        pdf.addImage(kop.dataUrl, 'JPEG', left, 7, width, kopHeight, 'school-kop', 'FAST');
        const titleY = 8 + kopHeight + 6;
        font(10, 'bold', COLORS.ink);
        pdf.text(section, left, titleY);
        font(7, 'normal', COLORS.muted);
        const date = new Date(`${report.date}T12:00:00+08:00`).toLocaleDateString('id-ID', { timeZone: 'Asia/Makassar', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        pdf.text(date, left, titleY + 4.5);
        const metrics = `${report.totals.entries} entri | ${report.totals.teachers} guru | ${report.totals.classes} kelas | ${report.totals.evidence} bukti`;
        font(6.6, 'bold', COLORS.teal); pdf.text(metrics, 198, titleY + 4.5, { align: 'right' });
        bounded(report.scope, left, titleY + 8.5, width, 1, { size: 6.7, color: COLORS.muted });
        y = top;
        if (section === 'JURNAL MENGAJAR HARIAN') {
            gridPages++;
            font(6.5, 'normal', COLORS.muted);
            pdf.text(`10 jurnal/halaman | Entri ${start + 1}-${Math.min(start + 10, report.entries.length)}`, 198, 282, { align: 'right' });
        }
    }

    function drawEntry(row, photo, index) {
        checkAbort();
        const slot = index % JURNAL_PDF_ENTRIES_PER_PAGE;
        if (slot === 0) pageHeader('JURNAL MENGAJAR HARIAN', index > 0, index);
        const x = left + (slot % 2) * (cardWidth + columnGap);
        const cardY = top + Math.floor(slot / 2) * (cardHeight + rowGap);
        const extra = [];
        const addExtra = (label, value) => { if (value) extra.push({ label, value: clean(value) }); };
        const field = (label, value, bx, by, w, count, options) => {
            if (bounded(value, bx, by, w, count, options)) addExtra(label, value);
        };
        pdf.setFillColor('#FFFFFF'); pdf.setDrawColor(COLORS.line);
        pdf.roundedRect(x, cardY, cardWidth, cardHeight, 1.5, 1.5, 'FD');
        pdf.setFillColor(COLORS.light); pdf.roundedRect(x + 0.3, cardY + 0.3, cardWidth - 0.6, 6.2, 1.2, 1.2, 'F');
        const identity = `#${String(row.no).padStart(3, '0')} | ${row.kelas} | JP ${row.jp}${report.unfilled ? ' | BELUM DIISI' : ''}`;
        field('Identitas kelas/JP', identity, x + 2.5, cardY + 4.2, cardWidth - 5, 1, { size: 6.7, style: 'bold', color: COLORS.teal });
        const photoX = x + 2.5, photoY = cardY + 8, photoWidth = 28, photoHeight = 17.5;
        pdf.setFillColor(COLORS.gray); pdf.roundedRect(photoX, photoY, photoWidth, photoHeight, 1, 1, 'F');
        let imageFailed = false;
        if (photo) {
            try {
                const ratio = Math.min((photoWidth - 0.8) / photo.width, (photoHeight - 0.8) / photo.height);
                const w = photo.width * ratio, h = photo.height * ratio;
                pdf.addImage(photo.dataUrl, 'JPEG', photoX + (photoWidth - w) / 2, photoY + (photoHeight - h) / 2, w, h, undefined, 'FAST');
            } catch { photo = null; imageFailed = true; }
        }
        if (!photo) {
            font(6.1, 'normal', COLORS.muted);
            const notice = row.photoUrl ? ['Bukti gagal dimuat.', 'Buka tautan asli.'] : [report.unfilled ? 'Belum diisi.' : 'Belum ada bukti.'];
            notice.forEach((line, i) => pdf.text(line, photoX + 1.6, photoY + 7.5 + i * 2.8));
        }
        const detailX = x + 33, detailWidth = cardWidth - 35.5;
        field('Guru', row.guru, detailX, cardY + 10.2, detailWidth, 2, { size: 7, style: 'bold', step: 2.8 });
        field('Mapel / Lokasi', `${row.mapel} | ${row.lokasi}`, detailX, cardY + 16, detailWidth, 1, { size: 6.4, color: COLORS.muted });
        const hasAbsenceDetail = !report.unfilled && row.presensi !== 'Semua hadir';
        const explicitCaption = row.hasCustomCaption;
        const bodyLabel = explicitCaption ? 'Materi' : row.catatan ? 'Refleksi' : hasAbsenceDetail ? 'Presensi' : '';
        const bodyValue = explicitCaption ? row.topik : row.catatan || (hasAbsenceDetail ? row.presensi : '');
        if (bodyValue && bounded(`${bodyLabel}: ${bodyValue}`, detailX, cardY + 19, detailWidth, 3, { size: 6.6, step: 2.7 })) addExtra(bodyLabel, bodyValue);
        if (explicitCaption && row.catatan) addExtra('Refleksi', row.catatan);
        if (hasAbsenceDetail && bodyLabel !== 'Presensi') addExtra('Rincian presensi', row.presensi);
        const caption = explicitCaption ? row.caption : row.topik || row.caption || (report.unfilled ? 'Guru hadir, jurnal belum diisi.' : 'Entri tanpa dokumentasi.');
        field(explicitCaption ? 'Caption dokumentasi' : 'Materi / Topik KBM', caption, x + 2.5, cardY + 28.4, cardWidth - 5, 2, { size: 6.6, step: 2.6 });
        font(6.1, 'normal', COLORS.muted);
        const inputTime = row.createdAt.match(/\b\d{2}\.\d{2}\b/)?.[0];
        const attendance = report.unfilled ? 'Presensi jurnal belum tersedia' : `S:${row.counts.S}  I:${row.counts.I}  A:${row.counts.A}  D:${row.counts.D}${inputTime ? ` | ${inputTime}` : ''}`;
        pdf.text(attendance, x + 2.5, cardY + cardHeight - 1.8);
        if (extra.length) {
            // Input date/time is preserved alongside any additional details, without creating a page just for a timestamp.
            if (row.createdAt) addExtra('Waktu input', row.createdAt);
            appendices.push({ row, fields: extra });
            const rx = x + cardWidth - 34, ry = cardY + cardHeight - 1.8;
            font(6.1, 'bold', COLORS.teal); pdf.text('Rincian', rx, ry);
            references.push({ no: row.no, page: pdf.getNumberOfPages(), x: rx, y: ry - 2, width: 10 });
        }
        if (row.photoUrl) {
            font(6.1, 'bold', COLORS.teal);
            pdf.textWithLink('Bukti asli', x + cardWidth - 14, cardY + cardHeight - 1.8, { url: row.photoUrl });
        }
        return { imageFailed };
    }

    function ensure(height) {
        checkAbort();
        if (y + height <= bottom) return;
        pageHeader('LAMPIRAN RINCIAN JURNAL');
        if (appendixEntry) {
            bounded(`#${String(appendixEntry.no).padStart(3, '0')} | ${appendixEntry.kelas} | JP ${appendixEntry.jp} (lanjutan)`, left, y + 3, width, 1, { size: 7.5, style: 'bold', color: COLORS.teal });
            y += 7;
        }
    }
    function flow(value, size = 8, style = 'normal', color = COLORS.ink) {
        const wrapped = wrap(value, width, size, style);
        for (const line of wrapped) {
            ensure(4.3);
            font(size, style, color); pdf.text(line, left, y + 3);
            y += 3.7;
        }
    }
    async function finish() {
        for (let index = 0; index < appendices.length; index++) {
            checkAbort();
            const item = appendices[index];
            appendixEntry = null;
            if (index === 0) pageHeader('LAMPIRAN RINCIAN JURNAL');
            ensure(16);
            appendixEntry = item.row;
            anchors.set(item.row.no, { page: pdf.getNumberOfPages(), top: y });
            flow(`#${String(item.row.no).padStart(3, '0')} | ${item.row.kelas} | JP ${item.row.jp} | ${item.row.guru}`, 8, 'bold', COLORS.teal);
            y += 1;
            for (const field of item.fields) flow(`${field.label}: ${field.value}`);
            y += 4;
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        for (const ref of references) {
            const target = anchors.get(ref.no);
            pdf.setPage(ref.page);
            pdf.link(ref.x, ref.y, ref.width, 3, { pageNumber: target.page, top: target.top });
        }
        const pages = pdf.getNumberOfPages();
        for (let page = 1; page <= pages; page++) {
            pdf.setPage(page);
            pdf.setDrawColor(COLORS.line); pdf.line(left, 284, 198, 284);
            font(6.8, 'normal', COLORS.muted);
            pdf.text(`${report.school.schoolShortName || 'SIMAS'} | Arsip jurnal mengajar | ${report.date}`, left, 289);
            pdf.text(`${page} / ${pages}`, 198, 289, { align: 'right' });
        }
        return { pages, gridPages, appendixPages: pages - gridPages };
    }
    return { drawEntry, finish };
}
