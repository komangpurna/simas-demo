import { formatJpDisplay, parseJpList } from './utils.mjs';
import { createCompactJurnalPdfLayout } from './jurnal-admin-pdf-layout.mjs';

const text = value => String(value ?? '').trim();
const naturalSort = (a, b) => text(a).localeCompare(text(b), 'id', { numeric: true, sensitivity: 'base' });
const list = value => {
    if (Array.isArray(value)) return value;
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};
const abortError = () => new DOMException('Ekspor dibatalkan.', 'AbortError');
const checkAbort = signal => { if (signal?.aborted) throw abortError(); };
const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));

export function safeEvidenceUrl(value, baseUrl) {
    if (!text(value)) return '';
    try {
        const url = new URL(text(value), baseUrl);
        return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
}

export function formatJurnalExportTime(value) {
    const raw = text(value);
    if (!raw) return '';
    const iso = raw.replace(' ', 'T');
    const date = new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
    if (Number.isNaN(date.getTime())) return raw;
    return `${date.toLocaleString('id-ID', { timeZone: 'Asia/Makassar', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} WITA`;
}

export function selectJurnalExportRows(rows, { kelas = 'ALL', search = '', status = 'ALL' } = {}) {
    const fields = status === 'UNFILLED' ? ['guru', 'mapel', 'kelas'] : ['guru', 'mapel', 'kelas', 'topik', 'catatan', 'lokasi_mengajar'];
    const query = text(search).toLocaleLowerCase('id');
    return (Array.isArray(rows) ? rows : []).filter(row => row &&
        (kelas === 'ALL' || row.kelas === kelas) &&
        (!query || fields.some(key => text(row[key]).toLocaleLowerCase('id').includes(query)))
    ).slice().sort((a, b) => naturalSort(a.kelas, b.kelas) ||
        (Math.min(...parseJpList(a.jp), 99) - Math.min(...parseJpList(b.jp), 99)) || naturalSort(a.guru, b.guru));
}

// Offset follows the actual number returned; an ignored offset must never yield a partial report.
export async function fetchAllJurnalRows(fetchPage, filters, { pageSize = 1000 } = {}) {
    const rows = [];
    const seenIds = new Set();
    let previousPage = '';
    while (true) {
        const page = await fetchPage({ ...filters, limit: pageSize, offset: rows.length, excludeTtd: true });
        if (!Array.isArray(page)) throw new Error('Respons jurnal tidak valid. Silakan muat ulang rekap.');
        if (page.some(row => !row || typeof row !== 'object')) throw new Error('Entri jurnal tidak valid. Silakan refresh rekap.');
        const signature = JSON.stringify(page.map(row => row.id || row));
        if (page.length && signature === previousPage) throw new Error('Halaman data jurnal berulang. Ekspor dihentikan agar laporan tidak terpotong.');
        previousPage = signature;
        for (const row of page) {
            if (row.id && seenIds.has(row.id)) throw new Error('Data jurnal berubah saat dimuat. Silakan refresh sebelum ekspor.');
            if (row.id) seenIds.add(row.id);
            rows.push(row);
        }
        if (page.length < pageSize) return rows;
    }
}

export function createJurnalReport({ rows, date, kelas = 'ALL', status = 'ALL', search = '', school = {}, baseUrl, resolvePhoto = value => value }) {
    const unfilled = status === 'UNFILLED';
    const entries = selectJurnalExportRows(rows, { kelas, status, search }).map((row, index) => {
        const presensi = unfilled ? [] : list(row.presensi_detail).filter(item => item && typeof item === 'object');
        const counts = { S: 0, I: 0, A: 0, D: 0 };
        const statusAliases = { S: 'S', SAKIT: 'S', I: 'I', IZIN: 'I', A: 'A', ALPA: 'A', ALFA: 'A', D: 'D', DISPENSASI: 'D' };
        for (const item of presensi) {
            const key = statusAliases[text(item.status).toUpperCase()];
            if (key) counts[key]++;
        }
        const jp = text(row.jpDisplay) || formatJpDisplay(row.jp) || '-';
        const photoUrl = unfilled ? '' : safeEvidenceUrl(resolvePhoto(row.foto_url), baseUrl);
        const caption = photoUrl ? text(row.foto_caption || row.caption) || `Kegiatan ${text(row.mapel) || 'pembelajaran'} di kelas ${text(row.kelas) || '-'}, JP ${jp}.` : '';
        return {
            no: index + 1, id: text(row.id), date: text(row.tanggal) || date, kelas: text(row.kelas) || '-',
            guru: text(row.guru) || '-', mapel: text(row.mapel) || '-', jp,
            lokasi: text(row.lokasi_mengajar) || 'Ruang Kelas', topik: unfilled ? '' : text(row.topik),
            catatan: unfilled ? '' : text(row.catatan), createdAt: unfilled ? '' : formatJurnalExportTime(row.created_at),
            photoUrl, caption, hasCustomCaption: Boolean(text(row.foto_caption || row.caption)), counts, status: unfilled ? 'Belum diisi' : 'Terisi',
            presensi: unfilled ? 'Belum ada jurnal/presensi' : presensi.map(p => `${text(p.nama) || '-'} (${text(p.status) || '-'})`).join('; ') || 'Semua hadir'
        };
    });
    const byClass = new Map();
    for (const entry of entries) {
        if (!byClass.has(entry.kelas)) byClass.set(entry.kelas, { kelas: entry.kelas, entries: 0, evidence: 0 });
        const group = byClass.get(entry.kelas);
        group.entries++;
        if (entry.photoUrl) group.evidence++;
    }
    const classes = [...byClass.values()];
    const withEvidence = entries.filter(row => row.photoUrl).length;
    const scope = `${kelas === 'ALL' ? 'Semua kelas' : kelas} | ${unfilled ? 'Belum diisi' : 'Jurnal terisi'}${search ? ` | Cari: ${search}` : ''}`;
    const safeClass = kelas === 'ALL' ? 'Semua_Kelas' : kelas.replace(/[^a-zA-Z0-9]/g, '_');
    return {
        date, scope, unfilled, school: { ...school }, entries, classes,
        totals: { entries: entries.length, teachers: new Set(entries.map(row => row.guru)).size, classes: classes.length, evidence: withEvidence },
        filename: `Rekap_Jurnal_${date}_${safeClass}${unfilled ? '_Belum_Diisi' : ''}`
    };
}

export function buildJurnalWorkbook(XLSX, report) {
    const headers = ['No', 'Tanggal', 'JP', 'Kelas', 'Guru Pengajar', 'Mata Pelajaran', 'Lokasi Mengajar', 'Materi / Topik KBM',
        'Catatan Refleksi', 'Sakit', 'Izin', 'Alpa', 'Dispensasi', 'Rincian Tidak Hadir', 'Waktu Input (WITA)', 'Status Jurnal', 'Tautan Bukti Mengajar', 'Caption Dokumentasi'];
    const rows = report.entries.map(row => [row.no, row.date, row.jp, row.kelas, row.guru, row.mapel, row.lokasi, row.topik || '-', row.catatan || '-',
        ...['S', 'I', 'A', 'D'].map(key => report.unfilled ? '' : row.counts[key]), row.presensi, row.createdAt || '-', row.status,
        row.photoUrl || (report.unfilled ? 'Belum ada jurnal' : 'Tidak ada bukti'), row.caption || '-']);
    const sheet = XLSX.utils.aoa_to_sheet([
        [`REKAP JURNAL MENGAJAR - ${report.school.schoolName || 'Sekolah'}`],
        [`Tanggal: ${report.date} | ${report.scope}`],
        [`${report.totals.entries} entri | ${report.totals.teachers} guru | ${report.totals.classes} kelas | ${report.totals.evidence} tautan bukti`],
        ['Klik tautan pada kolom Bukti Mengajar untuk membuka foto/gambar bukti asli. Foto lengkap tersedia pada ekspor PDF.'], [], headers, ...rows
    ]);
    sheet['!merges'] = [0, 1, 2, 3].map(r => ({ s: { r, c: 0 }, e: { r, c: headers.length - 1 } }));
    sheet['!autofilter'] = { ref: `A6:R${Math.max(6, rows.length + 6)}` };
    sheet['!cols'] = [6, 13, 10, 12, 30, 25, 23, 55, 48, 9, 9, 9, 13, 55, 25, 17, 48, 55].map(wch => ({ wch }));
    report.entries.forEach((row, index) => {
        if (row.photoUrl) sheet[`Q${index + 7}`].l = { Target: row.photoUrl, Tooltip: 'Buka bukti mengajar asli' };
    });
    const workbook = XLSX.utils.book_new();
    workbook.Props = { Title: 'Rekap Jurnal Mengajar Harian', Author: report.school.schoolName || 'SIMAS', Subject: report.scope };
    XLSX.utils.book_append_sheet(workbook, sheet, 'Rekap Jurnal Harian');
    return workbook;
}

let pdfLibraryPromise;
export function loadJurnalPdfLibrary({ signal } = {}) {
    checkAbort(signal);
    if (globalThis.jspdf?.jsPDF) return Promise.resolve(globalThis.jspdf.jsPDF);
    if (!pdfLibraryPromise) {
        pdfLibraryPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            let settled = false;
            const finish = error => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                script.onload = script.onerror = null;
                if (error) { script.remove(); reject(error); } else resolve(globalThis.jspdf.jsPDF);
            };
            const onAbort = () => finish(abortError());
            const timer = setTimeout(() => finish(new Error('Library PDF terlalu lama dimuat. Silakan coba lagi.')), 15000);
            signal?.addEventListener('abort', onAbort, { once: true });
            script.src = new URL('./vendor/jspdf.umd.min.js', import.meta.url).href;
            script.onload = () => finish(globalThis.jspdf?.jsPDF ? null : new Error('Library PDF tidak tersedia.'));
            script.onerror = () => finish(new Error('Gagal memuat library PDF. Periksa koneksi lalu coba lagi.'));
            document.head.appendChild(script);
        }).catch(error => { pdfLibraryPromise = null; throw error; });
    }
    return pdfLibraryPromise;
}

export function evidenceImageUrl(url) {
    const parsed = new URL(url);
    if (parsed.hostname === 'drive.google.com') {
        const id = parsed.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] || parsed.searchParams.get('id');
        if (id && /^[\w-]+$/.test(id)) return `https://lh3.googleusercontent.com/d/${id}=w1200`;
    }
    return url;
}

// The canvas is released after each image. No full-page DOM screenshot or full-school image cache.
export function loadJurnalReportImage(url, { signal, timeoutMs = 10000, maxDimension = 1000, quality = 0.76 } = {}) {
    checkAbort(signal);
    return new Promise((resolve, reject) => {
        const img = new Image();
        let settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            img.onload = img.onerror = null;
            img.src = '';
            error ? reject(error) : resolve(value);
        };
        const onAbort = () => finish(abortError());
        const timer = setTimeout(() => finish(new Error('Bukti tidak selesai dimuat dalam batas waktu.')), timeoutMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        img.crossOrigin = 'anonymous';
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => finish(new Error('Foto/bukti tidak dapat dimuat atau tidak mengizinkan akses gambar.'));
        img.onload = () => {
            const canvas = document.createElement('canvas');
            try {
                checkAbort(signal);
                if (!img.naturalWidth || !img.naturalHeight) throw new Error('Ukuran gambar tidak valid.');
                const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
                canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
                const context = canvas.getContext('2d');
                if (!context) throw new Error('Browser tidak mendukung pemrosesan foto.');
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(img, 0, 0, canvas.width, canvas.height);
                finish(null, { dataUrl: canvas.toDataURL('image/jpeg', quality), width: canvas.width, height: canvas.height });
            } catch (error) { finish(error); } finally { canvas.width = canvas.height = 1; }
        };
        try { img.src = evidenceImageUrl(url); } catch (error) { finish(error); }
    });
}

export async function buildJurnalPdf(report, { jsPDF, signal, onProgress = () => {}, loadImage = loadJurnalReportImage } = {}) {
    if (!report.entries.length) throw new Error('Tidak ada data jurnal untuk diekspor.');
    checkAbort(signal);
    onProgress({ phase: 'kop', done: 0, total: report.entries.length, failed: 0 });
    let kop;
    try { kop = await loadImage(report.school.kopUrl, { signal, maxDimension: 1600, quality: 0.94 }); }
    catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new Error(`Kop resmi sekolah tidak dapat dimuat: ${error.message}`);
    }
    checkAbort(signal);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
    pdf.setProperties({ title: `Laporan Jurnal Mengajar ${report.date}`, author: report.school.schoolName || 'SIMAS', subject: report.scope });
    const layout = createCompactJurnalPdfLayout(pdf, report, kop, { signal });
    let failed = 0;
    for (let offset = 0; offset < report.entries.length; offset += 3) {
        checkAbort(signal);
        const batch = report.entries.slice(offset, offset + 3);
        const images = await Promise.allSettled(batch.map(row => row.photoUrl ? loadImage(row.photoUrl, { signal, maxDimension: 700 }) : Promise.resolve(null)));
        checkAbort(signal);
        for (let i = 0; i < batch.length; i++) {
            const row = batch[i];
            const photo = images[i].status === 'fulfilled' ? images[i].value : null;
            const result = layout.drawEntry(row, photo, offset + i);
            if (row.photoUrl && (!photo || result.imageFailed)) failed++;
            onProgress({ phase: 'photos', done: row.no, total: report.entries.length, failed });
            await yieldToBrowser();
            checkAbort(signal);
        }
    }
    const { pages, gridPages, appendixPages } = await layout.finish();
    checkAbort(signal);
    onProgress({ phase: 'ready', done: report.entries.length, total: report.entries.length, failed, pages });
    return { pdf, failed, pages, gridPages, appendixPages };
}
