/**
 * Template cetak infografis rekap realisasi (ala Canva) yang dipakai bersama
 * oleh E-Kinerja Guru (js/page-beban-kerja.js) dan E-Kinerja Tendik (js/page-e-kinerja-tendik.js).
 *
 * Modul murni: tidak menyentuh DOM halaman sehingga dapat diuji dan dipratinjau.
 * Satu laporan = satu lembar A4. Tata letak kartu menyesuaikan jumlah kegiatan,
 * dan porsi ruang tiap kartu menyesuaikan jumlah fotonya.
 */

export const REKAP_MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const REKAP_MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// Batas kolase foto per kartu (guru 5, tendik 2 — dipotong oleh pemanggil)
export const REKAP_MAX_COLLAGE_PHOTOS = 5;

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function formatRekapPrintDate(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '');
    return m ? `${parseInt(m[3], 10)} ${REKAP_MONTH_SHORT[parseInt(m[2], 10) - 1] || m[2]} ${m[1]}` : (ymd || '-');
}

/**
 * Format NIP standar administrasi dokumen (NIP. 19xxxxxxxx atau NIP. - jika kosong).
 */
export function formatRekapNip(nip) {
    if (!nip || nip === '-' || nip === 'null' || nip === 'undefined') return 'NIP. -';
    const s = String(nip).trim();
    if (/^nip[\.\s:]*/i.test(s)) {
        return `NIP. ${s.replace(/^nip[\.\s:]*/i, '').trim()}`;
    }
    return `NIP. ${s}`;
}

/**
 * Menghitung ukuran font dinamis judul sub kegiatan berdasarkan panjang karakter (maks 2 baris ketat).
 */
export function computeRekapTitleFontSize(title, isLandscape = false) {
    const len = String(title || '').trim().length;
    if (len <= 28) return isLandscape ? '18pt' : '20pt';
    if (len <= 50) return isLandscape ? '14pt' : '15pt';
    if (len <= 75) return isLandscape ? '11.5pt' : '12.5pt';
    return isLandscape ? '10pt' : '11pt';
}

/**
 * Menghitung style font & line-clamp dinamis untuk judul/caption kartu kegiatan
 * agar teks panjang tidak terpotong (anti-truncation).
 */
export function computeRekapActivityTitleStyle(title, tier = 'md') {
    const len = String(title || '').trim().length;
    if (len > 70) {
        return 'font-size: 7.2pt; line-height: 1.18; -webkit-line-clamp: 4;';
    }
    if (len > 45) {
        return 'font-size: 8pt; line-height: 1.2; -webkit-line-clamp: 3;';
    }
    return '';
}

// Caption bawaan (nama berkas / "Foto Bukti N") tidak informatif di dokumen cetak
export function isGenericCaption(c) {
    return !c || /^foto bukti( \d+)?$/i.test(c.trim()) || /\.(jpe?g|png|webp|heic)$/i.test(c.trim());
}

/**
 * Memecah satu bulan (YYYY-MM) menjadi pekan Senin–Minggu yang dipotong pada batas bulan.
 * Contoh Oktober 2026: Minggu 1 = 1–4, Minggu 2 = 5–11, dst.
 */
export function getRekapMonthWeeks(month) {
    const m = /^(\d{4})-(\d{2})$/.exec(month || '');
    if (!m) return [];
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const lastDay = new Date(y, mo, 0).getDate();
    const pad = (n) => String(n).padStart(2, '0');
    const weeks = [];
    let cur = null;
    for (let d = 1; d <= lastDay; d++) {
        const dow = new Date(y, mo - 1, d).getDay();
        if (!cur || dow === 1) {
            cur = { index: weeks.length, startDay: d, endDay: d };
            weeks.push(cur);
        }
        cur.endDay = d;
    }
    return weeks.map(w => ({
        ...w,
        start: `${y}-${pad(mo)}-${pad(w.startDay)}`,
        end: `${y}-${pad(mo)}-${pad(w.endDay)}`,
        label: `Minggu ${w.index + 1}`,
        rangeLabel: w.startDay === w.endDay ? `${w.startDay}` : `${w.startDay}–${w.endDay}`
    }));
}

/**
 * Menerjemahkan rentang indeks minggu ({start, end}) menjadi batas tanggal & label periode.
 * range null/tidak valid/mencakup semua minggu = sebulan penuh.
 */
export function resolveRekapReportPeriod(month, range = null) {
    const weeks = getRekapMonthWeeks(month);
    const m = /^(\d{4})-(\d{2})$/.exec(month || '');
    const monthIdx = m ? parseInt(m[2], 10) - 1 : -1;
    const year = m ? m[1] : '';
    const monthLong = m ? `${REKAP_MONTH_NAMES[monthIdx]} ${year}` : (month || '');
    const monthShort = m ? `${REKAP_MONTH_SHORT[monthIdx]} ${year}` : (month || '');

    if (weeks.length === 0) {
        return { start: null, end: null, isFullMonth: true, label: monthLong, shortLabel: 'Sebulan Penuh', rangeText: monthLong, monthOnly: monthLong, monthLabel: monthLong, endDay: null };
    }

    const valid = range && Number.isInteger(range.start) && Number.isInteger(range.end)
        && range.start >= 0 && range.end < weeks.length && range.start <= range.end
        && !(range.start === 0 && range.end === weeks.length - 1);

    if (!valid) {
        const last = weeks[weeks.length - 1];
        return {
            start: weeks[0].start,
            end: last.end,
            isFullMonth: true,
            label: `Sebulan Penuh · ${monthLong}`,
            shortLabel: 'Sebulan Penuh',
            rangeText: monthLong,
            monthOnly: monthLong,
            monthLabel: monthLong,
            endDay: last.endDay
        };
    }

    const ws = weeks[range.start];
    const we = weeks[range.end];
    const weekTxt = range.start === range.end ? `Minggu ${range.start + 1}` : `Minggu ${range.start + 1}–${range.end + 1}`;
    const dayTxt = ws.startDay === we.endDay ? `${ws.startDay}` : `${ws.startDay}–${we.endDay}`;
    return {
        start: ws.start,
        end: we.end,
        isFullMonth: false,
        label: `${weekTxt} · ${dayTxt} ${monthShort}`,
        shortLabel: weekTxt,
        rangeText: `${dayTxt} ${monthShort}`,
        monthOnly: monthLong,
        monthLabel: monthLong,
        endDay: we.endDay
    };
}

export function isDateInRekapPeriod(ymd, period) {
    if (!period || !period.start || !period.end) return true;
    const d = String(ymd || '').slice(0, 10);
    return d >= period.start && d <= period.end;
}

/**
 * Pola pemilih rentang minggu: klik pertama = 1 minggu, klik kedua = rentang,
 * klik pada minggu tunggal yang sama = kembali sebulan penuh, klik berikutnya mulai ulang.
 */
export function nextRekapWeekRange(current, weekIdx) {
    const idx = parseInt(weekIdx, 10);
    if (!Number.isInteger(idx)) return current || null;
    if (!current) return { start: idx, end: idx };
    if (current.start === current.end) {
        return idx === current.start ? null : { start: Math.min(idx, current.start), end: Math.max(idx, current.start) };
    }
    return { start: idx, end: idx };
}

/**
 * HTML tombol chip periode (Tailwind) untuk modal cetak.
 * handlers: { full: 'window.fnFull()', week: 'window.fnWeek' }
 */
export function buildRekapPeriodChipsHtml(month, period, range, handlers) {
    const weeks = getRekapMonthWeeks(month);
    const activeRange = period?.isFullMonth ? null : range;
    const base = 'h-7 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all border cursor-pointer whitespace-nowrap inline-flex items-center gap-1 active:scale-95 shrink-0';
    const on = 'bg-emerald-600 border-emerald-600 text-white shadow-2xs font-bold ring-1 ring-emerald-500/30';
    const off = 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-400 shadow-2xs';
    return `
        <button type="button" onclick="${handlers.full}" class="${base} ${period?.isFullMonth ? on : off}">
            <i class="fa-solid fa-calendar-check text-[10px] mr-0.5"></i><span>Sebulan Penuh</span>
        </button>
        ${weeks.map(w => {
            const active = activeRange && w.index >= activeRange.start && w.index <= activeRange.end;
            return `<button type="button" onclick="${handlers.week}(${w.index})" class="${base} ${active ? on : off}" title="${w.start} s.d. ${w.end}">
                <span>${w.label}</span> <span class="font-normal opacity-80 text-[10px]">(${w.rangeLabel})</span>
            </button>`;
        }).join('')}
    `;
}

/**
 * Pilih otomatis maksimal `max` kegiatan, utamakan yang berfoto, lalu urutan tanggal.
 */
export function pickRekapReportActivities(activities, hasPhoto, max) {
    return (activities || [])
        .map((act, idx) => ({ act, idx, photo: hasPhoto(act) ? 0 : 1 }))
        .sort((a, b) => a.photo - b.photo || a.idx - b.idx)
        .slice(0, max)
        .map(x => x.act);
}

/**
 * Susunan baris kartu per jumlah kegiatan (1–6).
 */
export function planRekapRows(n, isLandscape) {
    const portrait = { 1: [1], 2: [1, 1], 3: [1, 2], 4: [2, 2], 5: [1, 2, 2], 6: [2, 2, 2] };
    const landscape = { 1: [1], 2: [2], 3: [3], 4: [2, 2], 5: [2, 3], 6: [3, 3] };
    return (isLandscape ? landscape : portrait)[Math.max(0, Math.min(6, n))] || [];
}

// Bobot ruang kartu: makin banyak foto makin lebar/tinggi; kartu tanpa foto lebih ringkas
export function rekapCardWeight(photoCount) {
    return photoCount > 0 ? Math.round((1 + 0.3 * (photoCount - 1)) * 100) / 100 : 0.7;
}

/**
 * @param {object} spec
 * @param {'portrait'|'landscape'} spec.orientation
 * @param {string} spec.schoolName
 * @param {string} spec.kicker      - teks kecil di atas judul
 * @param {string} spec.title       - judul besar (nama sub kegiatan / butir tugas)
 * @param {string} spec.subtitle
 * @param {{name:string,nip?:string,role?:string,foto?:string}} spec.person
 * @param {{shortLabel:string,rangeText:string}} spec.period
 * @param {string} spec.titimangsa
 * @param {Array<{ico:string,val:string,lbl:string}>} spec.stats - 4 butir
 * @param {Array<{date:string,timeStr?:string,title:string,sub?:string,chips?:Array<{text:string,kind:string}>,output?:string,photos?:Array<{url:string,caption?:string}>}>} [spec.activities]
 * @param {Array<Array<{date:string,timeStr?:string,title:string,sub?:string,chips?:Array<{text:string,kind:string}>,output?:string,photos?:Array<{url:string,caption?:string}>}>>} [spec.pages] - Multi-halaman
 * @param {string} spec.footTitle
 * @param {string[]} spec.footLines
 * @param {string} [spec.signatureDataUrl]
 * @param {string} [spec.signLabel]
 */
export function buildRekapInfographicHtml(spec) {
    const isLandscape = spec.orientation === 'landscape';
    const orientation = isLandscape ? 'landscape' : 'portrait';
    const rawPages = Array.isArray(spec.pages) && spec.pages.length > 0
        ? spec.pages
        : [spec.activities || []];
    const person = spec.person || {};

    const accents = [
        { a: '#10b981', s: '#d1fae5', d: '#065f46' },
        { a: '#8b5cf6', s: '#ede9fe', d: '#5b21b6' },
        { a: '#f59e0b', s: '#fef3c7', d: '#92400e' },
        { a: '#0ea5e9', s: '#e0f2fe', d: '#075985' },
        { a: '#f43f5e', s: '#ffe4e6', d: '#9f1239' },
        { a: '#14b8a6', s: '#ccfbf1', d: '#115e59' }
    ];

    const photoCell = (p) => {
        const hasCaption = !isGenericCaption(p?.caption);
        return `
        <div class="ph">
            <img src="${esc(p?.url)}" alt="" class="ph-bg" aria-hidden="true" onerror="this.remove()">
            <img src="${esc(p?.url)}" alt="Dokumentasi Kegiatan" class="ph-fg" onerror="this.parentElement.remove()">
            ${hasCaption ? `<div class="ph-caption" title="${esc(p.caption)}">${esc(p.caption)}</div>` : ''}
        </div>`;
    };

    const stats = (spec.stats || []).slice(0, 4);
    const signatureImgTag = spec.signatureDataUrl
        ? `<img src="${spec.signatureDataUrl}" class="sign-img" alt="Tanda Tangan Digital">`
        : `<div class="sign-blank"></div>`;

    const pageW = isLandscape ? '297mm' : '210mm';
    const pageH = isLandscape ? '210mm' : '297mm';

    const headerPeriodText = (spec.period?.monthOnly || spec.period?.monthLabel || (spec.period?.isFullMonth ? spec.period.rangeText : `${spec.period?.rangeText || ''}`.replace(/^.*·\s*/, '')) || spec.period?.rangeText || '')
        .replace(/^sebulan penuh\s*[·•-]?\s*/i, '')
        .trim();
    const personNipDisplay = person.nipFormatted || (person.nip ? formatRekapNip(person.nip) : (person.role && person.role !== '-' ? person.role : 'NIP. -'));
    const heroTitleSize = computeRekapTitleFontSize(spec.title, isLandscape);

    // Render setiap lembar halaman dengan frame 100% identik
    let globalActivityIndex = 0;
    const pagesHtml = rawPages.map((pageActsList) => {
        const activities = (pageActsList || []).slice(0, 6);
        const n = activities.length;
        const tier = n <= 2 ? 'lg' : (n <= 4 ? 'md' : 'sm');
        const gap = n >= 5 ? '3.2mm' : (isLandscape ? '4mm' : '4.5mm');
        const titleSize = { lg: '12pt', md: '10pt', sm: '8.5pt' }[tier];
        const titleClamp = { lg: 3, md: 3, sm: 3 }[tier];
        const outSize = { lg: '8.5pt', md: '7.5pt', sm: '7pt' }[tier];
        const outClamp = { lg: 6, md: 3, sm: 2 }[tier];
        const bodyPad = { lg: '3mm 4mm 3.5mm', md: '2.6mm 3.5mm 3mm', sm: '2mm 3mm 2.4mm' }[tier];

        const rows = planRekapRows(n, isLandscape);
        let cursor = 0;
        let soloRowCount = 0;
        const rowsHtml = rows.map((len) => {
            const rowActs = activities.slice(cursor, cursor + len);
            const startIdx = cursor;
            cursor += len;
            const isSolo = len === 1;
            const rev = isSolo && n > 1 && (soloRowCount++ % 2 === 1);

            let dir;
            if (n === 1) dir = isLandscape ? 'h' : 'v';
            else if (isSolo) dir = 'h';
            else if (len === 2) dir = isLandscape && rows.length > 1 ? 'h' : 'v';
            else dir = 'v';

            const weights = rowActs.map(a => rekapCardWeight(Math.min(REKAP_MAX_COLLAGE_PHOTOS, (a.photos || []).length)));
            const rowWeight = Math.max(...weights);

            const cards = rowActs.map((act, i) => {
                const idx = startIdx + i;
                const cardBadgeNum = ++globalActivityIndex;
                const ac = accents[(cardBadgeNum - 1) % accents.length];
                const photos = (act.photos || []).slice(0, REKAP_MAX_COLLAGE_PHOTOS);
                const chips = Array.isArray(act.chips) ? act.chips : [];
                const titleStyle = computeRekapActivityTitleStyle(act.title, tier);

                const mediaHtml = photos.length > 0 ? `
                    <div class="collage c${photos.length}">
                        ${photos.map(photoCell).join('')}
                    </div>
                ` : `
                    <div class="no-photo">
                        <span class="no-photo-ico">✦</span>
                        <span>Tanpa foto dokumentasi</span>
                    </div>
                `;

                return `
                    <article class="card ${dir}${rev ? ' rev' : ''}${photos.length === 0 ? ' is-empty' : ''}" style="flex-grow:${weights[i]};--ac:${ac.a};--acs:${ac.s};--acd:${ac.d};">
                        <div class="media">
                            ${mediaHtml}
                            <span class="num">${String(cardBadgeNum).padStart(2, '0')}</span>
                        </div>
                        <div class="body" style="padding:${bodyPad};">
                            <div class="date">${esc(formatRekapPrintDate(act.date))}${act.timeStr ? ` <i>•</i> ${esc(act.timeStr)}` : ''}</div>
                            <h3 class="title"${titleStyle ? ` style="${titleStyle}font-size:${titleSize};-webkit-line-clamp:${titleClamp};"` : ` style="font-size:${titleSize};-webkit-line-clamp:${titleClamp};"`}>${esc(act.title || 'Kegiatan')}</h3>
                            ${act.sub && act.sub !== spec.title ? `<div class="sub">${esc(act.sub)}</div>` : ''}
                            ${chips.length > 0 ? `<div class="chips">${chips.map(c => `<span class="chip chip-${esc(c.kind || 'dur')}">${esc(c.text)}</span>`).join('')}</div>` : ''}
                            ${act.output ? `
                                <div class="out">
                                    <b>Hasil nyata</b>
                                    <p style="font-size:${outSize};-webkit-line-clamp:${outClamp};">${esc(act.output)}</p>
                                </div>
                            ` : ''}
                        </div>
                    </article>`;
            }).join('');

            return `<div class="row" style="flex-grow:${rowWeight};gap:${gap};">${cards}</div>`;
        }).join('');

        return `
        <div class="page n${n}">
            <div class="blob b1"></div>
            <div class="blob b2"></div>
            <div class="blob b3"></div>
            <div class="dots"></div>

            <header class="top">
                <div class="brand">
                    <img src="assets/logo-sekolah.png" alt="" onerror="this.style.display='none'">
                    <span>${esc(spec.schoolName || '')}</span>
                </div>
                <div class="period-pill"><span>${esc(headerPeriodText)}</span></div>
            </header>

            <section class="hero">
                <div class="hero-text">
                    <div class="kicker">${esc(spec.kicker || 'Jurnal Kegiatan')}</div>
                    <h1><span class="hl">${esc(spec.title || '')}</span></h1>
                    <p>${esc(spec.subtitle || '')}</p>
                </div>
                <div class="who">
                    ${person.foto
                        ? `<img src="${esc(person.foto)}" alt="Foto" onerror="this.style.display='none'">`
                        : `<div class="who-initial">${esc((person.name || '?').trim().charAt(0).toUpperCase())}</div>`}
                    <div style="min-width:0">
                        <b>${esc(person.name || '-')}</b>
                        <small>${esc(personNipDisplay)}</small>
                    </div>
                </div>
            </section>

            <section class="stats">
                ${stats.map((s, i) => `<div class="stat s${i + 1}"><span class="ico">${esc(s.ico)}</span><div><b>${esc(s.val)}</b><small>${esc(s.lbl)}</small></div></div>`).join('')}
            </section>

            ${n > 0
                ? `<main class="cards" style="gap:${gap};">${rowsHtml}</main>`
                : `<main class="empty-state">Belum ada kegiatan yang dipilih untuk lembar ini.</main>`}

            <footer class="foot">
                <div class="foot-note">
                    <b>${esc(spec.footTitle || '')}</b>
                    ${(spec.footLines || []).map(l => `<span>${esc(l)}</span>`).join('<br>')}
                </div>
                <div class="sign">
                    <span>${esc(spec.titimangsa || '')}</span>
                    <span class="sign-lbl">${esc(spec.signLabel || 'Disusun oleh,')}</span>
                    ${signatureImgTag}
                    <b>${esc(person.name || '-')}</b>
                    ${person.nip ? `<small>${esc(formatRekapNip(person.nip))}</small>` : ''}
                </div>
            </footer>
        </div>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <title>${esc(spec.docTitle || `Laporan Kegiatan - ${spec.title || ''} - ${person.name || ''}`)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        @page { size: A4 ${orientation}; margin: 0; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body {
            font-family: "Plus Jakarta Sans", "Segoe UI", Roboto, Arial, sans-serif;
            color: #1e293b; background: #e2e8f0; font-size: 8.5pt; line-height: 1.4; padding: 16px;
        }
        .page {
            position: relative; width: ${pageW}; height: ${pageH}; margin: 0 auto 24px auto;
            padding: ${isLandscape ? '8mm 10mm 7mm' : '10mm 10mm 8mm'};
            background: #fffdf8; overflow: hidden; display: flex; flex-direction: column;
            gap: ${isLandscape ? '3.5mm' : '4.5mm'};
            box-shadow: 0 10px 40px rgba(15, 23, 42, 0.18);
            page-break-after: always;
            break-after: page;
        }
        .page:last-child {
            margin-bottom: 0;
            page-break-after: auto;
            break-after: auto;
        }
        /* Ornamen bentuk lembut ala Canva */
        .blob { position: absolute; border-radius: 50%; z-index: 0; pointer-events: none; }
        .blob.b1 { width: 95mm; height: 95mm; top: -42mm; right: -30mm; background: #d1fae5; }
        .blob.b2 { width: 48mm; height: 48mm; top: 14mm; right: 52mm; background: #fef3c7; opacity: .8; }
        .blob.b3 { width: 80mm; height: 80mm; bottom: -48mm; left: -34mm; background: #ede9fe; }
        .dots {
            position: absolute; z-index: 0; top: 9mm; left: ${isLandscape ? '150mm' : '112mm'};
            width: 30mm; height: 14mm; opacity: .5;
            background-image: radial-gradient(#94a3b8 1px, transparent 1.3px); background-size: 3.2mm 3.2mm;
        }
        .page > *:not(.blob):not(.dots) { position: relative; z-index: 1; }

        .top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .brand { display: flex; align-items: center; gap: 9px; font-size: 10.5pt; font-weight: 800; color: #1e293b; letter-spacing: .5px; text-transform: uppercase; }
        .brand img { width: 36px; height: 36px; object-fit: contain; flex-shrink: 0; }
        .period-pill { display: inline-flex; align-items: center; justify-content: center; height: 36px; padding: 0 15px; background: #0f172a; color: #6ee7b7; border-radius: 999px;
            font-size: 8.5pt; font-weight: 700; white-space: nowrap; letter-spacing: .3px; }
        .period-pill span { color: #6ee7b7; }

        .hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; }
        .hero-text { min-width: 0; flex: 1; }
        .kicker { display: inline-block; font-size: 7.5pt; font-weight: 800; letter-spacing: 2.4px; text-transform: uppercase; color: #059669; margin-bottom: 3px; }
        .hero h1 { font-size: ${heroTitleSize}; font-weight: 800; line-height: 1.15; letter-spacing: -0.5px; color: #0f172a;
            display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
        .hero h1 .hl { background: linear-gradient(transparent 62%, #fde68a 62%, #fde68a 92%, transparent 92%); }
        .hero p { margin-top: 4px; font-size: 8.5pt; color: #64748b; font-weight: 500; white-space: normal; line-height: 1.3; overflow: hidden; }
        .who { display: flex; align-items: center; gap: 9px; flex-shrink: 0; max-width: 46%; background: #fff; border: 1.5px solid #0f172a;
            border-radius: 16px; padding: 6px 12px 6px 6px; box-shadow: 3px 3px 0 #0f172a; }
        .who img { width: 38px; height: 38px; border-radius: 12px; object-fit: cover; object-position: center 20%; flex-shrink: 0; }
        .who-initial { width: 38px; height: 38px; border-radius: 12px; background: #d1fae5; color: #065f46; display: flex; align-items: center;
            justify-content: center; font-weight: 800; font-size: 14pt; flex-shrink: 0; }
        .who b { display: block; font-size: 9.5pt; font-weight: 800; color: #0f172a; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .who small { display: block; font-size: 7.5pt; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; }
        .stat { display: flex; align-items: center; gap: 8px; border-radius: 14px; padding: 6px 10px; }
        .stat .ico { width: 26px; height: 26px; border-radius: 9px; background: rgba(255,255,255,.7); display: flex; align-items: center;
            justify-content: center; font-size: 11pt; flex-shrink: 0; }
        .stat b { display: block; font-size: 12pt; font-weight: 800; color: #0f172a; line-height: 1.1; }
        .stat small { display: block; font-size: 7pt; color: #475569; font-weight: 600; }
        .s1 { background: #d1fae5; } .s2 { background: #ede9fe; } .s3 { background: #fef3c7; } .s4 { background: #e0f2fe; }

        /* Baris kartu: tinggi baris & lebar kartu dibagi sesuai bobot jumlah foto */
        .cards { flex: 1; min-height: 0; display: flex; flex-direction: column; }
        /* min-height auto: baris/kartu tidak pernah menyusut di bawah tinggi teksnya */
        .row { flex: 1 1 0; display: flex; }
        .card { flex: 1 1 0; min-width: 0; display: flex; background: #fff; border-radius: 18px;
            border: 1px solid #e2e8f0; box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06); }
        .card.v { flex-direction: column; }
        .card.h { flex-direction: row; }
        .card.h.rev { flex-direction: row-reverse; }
        .media { position: relative; overflow: hidden; background: var(--acs); }
        .card.v .media { flex: 1 1 auto; min-height: 22mm; margin: 2.2mm 2.2mm 0; border-radius: 14px; }
        .card.h .media { flex: 0 0 ${isLandscape ? '56%' : '57%'}; margin: 2.2mm; border-radius: 14px; }
        .card.is-empty.h .media { flex-basis: 38%; }
        .collage { position: absolute; inset: 0; display: grid; gap: 1.2mm; }
        .collage.c1 { grid-template: 1fr / 1fr; }
        .collage.c2 { grid-template: 1fr / 1fr 1fr; }
        .collage.c3 { grid-template: 1fr 1fr / 1.6fr 1fr; }
        .collage.c4 { grid-template: 1fr 1fr / 1fr 1fr; }
        .collage.c5 { grid-template: 1fr 1fr / 1.6fr 1fr 1fr; }
        .collage.c3 .ph:first-child, .collage.c5 .ph:first-child { grid-row: 1 / span 2; }
        .ph { position: relative; overflow: hidden; background: var(--acs); min-height: 0; }
        /* Foto utuh (contain) di atas latar blur foto yang sama: proporsional tanpa terpotong & tanpa ruang kosong */
        .ph-bg { position: absolute; top: -10%; left: -10%; width: 120%; height: 120%; object-fit: cover; filter: blur(14px) saturate(1.15); opacity: .6; }
        .ph-fg { position: relative; display: block; width: 100%; height: 100%; object-fit: contain; }
        .caption, .ph-caption {
            position: absolute; left: 1.5mm; right: 1.5mm; bottom: 1.5mm;
            max-width: calc(100% - 3mm);
            background: rgba(15, 23, 42, 0.78); color: #ffffff;
            backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
            border: 0.5px solid rgba(255, 255, 255, 0.25);
            border-radius: 6px; padding: 1.5px 5px;
            font-size: 6.5pt; font-weight: 600; line-height: 1.25;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            z-index: 2; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
        }
        .caption {
            left: 2mm; bottom: 2mm; max-width: calc(100% - 4mm);
            background: rgba(255,255,255,.92); color: #0f172a;
            border-radius: 8px; padding: 2px 7px; font-size: 7pt; border: none;
        }
        .num { position: absolute; top: 2mm; left: 2mm; background: var(--ac); color: #fff; font-weight: 800; font-size: 9pt; border-radius: 10px;
            padding: 2px 8px; letter-spacing: .5px; box-shadow: 0 2px 6px rgba(0,0,0,.15); }
        .no-photo { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
            text-align: center; padding: 10px; color: var(--acd); font-weight: 700; font-size: 8.5pt;
            background: radial-gradient(circle at 25% 25%, rgba(255,255,255,.65) 0 18%, transparent 19%),
                        radial-gradient(circle at 80% 75%, rgba(255,255,255,.5) 0 24%, transparent 25%), var(--acs); }
        .no-photo-ico { font-size: 20pt; color: var(--ac); line-height: 1; }

        .body { display: flex; flex-direction: column; gap: 2.5px; min-width: 0; }
        .card.h .body { flex: 1; justify-content: center; padding-left: 1.5mm !important; }
        .card.h.rev .body { padding-left: 4mm !important; padding-right: 1.5mm !important; }
        .date { font-size: 7.5pt; font-weight: 700; color: var(--acd); }
        .date i { font-style: normal; color: #cbd5e1; margin: 0 2px; }
        .title { font-weight: 800; line-height: 1.22; color: #0f172a;
            display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
        .sub { font-size: 7.5pt; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
        .chip { font-size: 7pt; font-weight: 700; border-radius: 999px; padding: 2px 8px; white-space: nowrap; }
        .chip-dur { background: var(--acs); color: var(--acd); }
        .chip-ok { background: #ecfdf5; color: #047857; }
        .chip-wait { background: #fff7ed; color: #c2410c; }
        .chip-info { background: #f1f5f9; color: #475569; }
        .out { margin-top: 3px; background: #f8fafc; border-radius: 10px; padding: 5px 8px; border-left: 3px solid var(--ac); }
        .out b { display: block; font-size: 6.5pt; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: var(--acd); }
        .out p { color: #334155; line-height: 1.35;
            display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }

        .empty-state { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; border: 2px dashed #cbd5e1;
            border-radius: 18px; color: #94a3b8; font-weight: 600; font-size: 10pt; }

        .foot { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; padding-top: 3mm; border-top: 1.5px dashed #cbd5e1; }
        .foot-note { font-size: 7pt; color: #64748b; line-height: 1.5; }
        .foot-note b { display: block; font-size: 8pt; color: #0f172a; font-weight: 800; }
        .sign { text-align: center; min-width: 52mm; font-size: 7.5pt; color: #475569; }
        .sign-lbl { display: block; font-weight: 600; }
        .sign-img { display: block; height: ${isLandscape ? '12mm' : '14mm'}; max-width: 48mm; object-fit: contain; margin: 1px auto; }
        .sign-blank { height: ${isLandscape ? '12mm' : '14mm'}; }
        .sign b { display: block; font-size: 9pt; font-weight: 800; color: #0f172a; }
        .sign small { display: block; font-size: 7pt; color: #64748b; }

        @media print {
            body { background: #fff; padding: 0; zoom: 1 !important; }
            .page { margin: 0; box-shadow: none; page-break-after: always; break-after: page; }
            .page:last-child { page-break-after: auto; break-after: auto; }
        }
    </style>
</head>
<body>
    ${pagesHtml}
    <script>
        (function () {
            // Pratinjau di layar: perkecil lembar agar muat lebar iframe (cetak tetap 100%)
            var pages = document.querySelectorAll('.page');
            function fit() {
                if (!pages.length) return;
                var first = pages[0];
                var z = Math.min(1, (window.innerWidth - 4) / (first.offsetWidth + 24));
                document.body.style.zoom = z > 0 ? z : 1;
            }
            window.addEventListener('resize', fit);
            window.addEventListener('beforeprint', function () { document.body.style.zoom = 1; });
            window.addEventListener('afterprint', fit);
            fit();
        })();
    </script>
</body>
</html>`;
}

/**
 * Atur tinggi iframe pratinjau sesuai rasio A4 agar lembar terlihat proporsional
 * dengan dukungan multi-halaman continuous vertical scroll.
 */
export function fitRekapPreviewFrame(frame, orientation, pageCount = 1) {
    if (!frame) return;
    const isLandscape = orientation === 'landscape';
    const innerW = Math.max(280, (frame.clientWidth || 800) - 24);
    const count = Math.max(1, parseInt(pageCount, 10) || 1);
    const singleH = Math.round(innerW * (isLandscape ? 210 / 297 : 297 / 210)) + 36;
    frame.style.height = `${count === 1 ? singleH : Math.min(singleH * count + (count - 1) * 24, Math.max(820, singleH * 1.6))}px`;
}

if (typeof window !== 'undefined') {
    window.computeRekapActivityTitleStyle = computeRekapActivityTitleStyle;
}

