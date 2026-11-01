import { jest, describe, test, expect } from '@jest/globals';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { selectJurnalExportRows, fetchAllJurnalRows, createJurnalReport, buildJurnalPdf, safeEvidenceUrl, evidenceImageUrl, formatJurnalExportTime } from '../js/jurnal-admin-export.mjs';

const require = createRequire(import.meta.url);
jest.setTimeout(30000);
const { jsPDF } = require('../js/vendor/jspdf.umd.min.js');
const image = { dataUrl: `data:image/png;base64,${readFileSync(new URL('../assets/kop.png', import.meta.url)).toString('base64')}`, width: 777, height: 229 };
const entry = (extra = {}) => ({ id: 'j1', tanggal: '2026-10-15', kelas: 'X-1', guru: 'Guru Pengajar', mapel: 'Biologi', jp: [1, 2],
    topik: 'Struktur sel dan fungsi organel', foto_url: 'https://example.org/bukti.jpg', lokasi_mengajar: 'Laboratorium', presensi_detail: [], ...extra });
const reportOf = (rows, extra = {}) => createJurnalReport({ rows, date: '2026-10-15', school: { schoolName: 'SMA Negeri 1 Abang', schoolShortName: 'SMAGESA', kopUrl: 'https://example.org/kop.png' }, ...extra });
const streamsOf = pdf => pdf.internal.pages.flat().join('\n');

describe('snapshot dan kelengkapan data ekspor Admin Jurnal', () => {
    test('tanggal/kelas/status/pencarian menghasilkan data konsisten dan urutan kelas/JP alami', () => {
        const rows = [entry({ id: 'b', kelas: 'X-10', jp: [8] }), entry({ id: 'a', kelas: 'X-2', jp: [3] }), entry({ id: 'c', kelas: 'X-2', jp: [1], topik: 'Fotosintesis' })];
        expect(selectJurnalExportRows(rows).map(row => row.id)).toEqual(['c', 'a', 'b']);
        expect(selectJurnalExportRows(rows, { kelas: 'X-2', search: 'fotosintesis' }).map(row => row.id)).toEqual(['c']);
        expect(selectJurnalExportRows(rows, { status: 'UNFILLED', search: 'fotosintesis' })).toEqual([]);
        expect(rows.map(row => row.id)).toEqual(['b', 'a', 'c']);
        expect(selectJurnalExportRows(null)).toEqual([]);
    });

    test('mengambil semua halaman termasuk data tepat di batas 1000, tanpa TTD base64', async () => {
        const rows = Array.from({ length: 2000 }, (_, i) => entry({ id: `j${i}` }));
        const fetchPage = jest.fn(async ({ offset, limit }) => rows.slice(offset, offset + limit));
        expect(await fetchAllJurnalRows(fetchPage, { tanggal: '2026-10-15' })).toHaveLength(2000);
        expect(fetchPage.mock.calls.map(([arg]) => arg.offset)).toEqual([0, 1000, 2000]);
        expect(fetchPage.mock.calls.every(([arg]) => arg.excludeTtd && arg.tanggal === '2026-10-15')).toBe(true);
    });

    test('respons rusak, halaman berulang, dan entri duplikat tidak menghasilkan laporan parsial', async () => {
        await expect(fetchAllJurnalRows(async () => ({ data: [] }), {})).rejects.toThrow('Respons jurnal');
        await expect(fetchAllJurnalRows(async () => [null], {})).rejects.toThrow('Entri jurnal');
        await expect(fetchAllJurnalRows(async () => [entry()], {}, { pageSize: 1 })).rejects.toThrow('berulang');
        const fetchPage = jest.fn().mockResolvedValueOnce([entry(), entry({ id: 'j2' })]).mockResolvedValueOnce([entry({ id: 'j2' })]);
        await expect(fetchAllJurnalRows(fetchPage, {}, { pageSize: 2 })).rejects.toThrow('berubah');
    });

    test('snapshot menyalin data, menghitung presensi legacy, dan mendukung bukti gambar LMS', () => {
        const row = entry({ foto_url: '/api/lms/journal/evidence/abc.svg', presensi_detail: JSON.stringify([{ nama: 'Siswa A', status: 'Sakit' }, { nama: 'Siswa B', status: 'ALFA' }]) });
        const report = reportOf([row], { baseUrl: 'https://sekolah.test/jurnal-admin.html' });
        expect(report.entries[0].photoUrl).toBe('https://sekolah.test/api/lms/journal/evidence/abc.svg');
        expect(report.entries[0].counts).toEqual({ S: 1, I: 0, A: 1, D: 0 });
        row.topik = 'berubah setelah klik ekspor';
        expect(report.entries[0].topik).toBe('Struktur sel dan fungsi organel');
        expect(report.totals).toEqual({ entries: 1, teachers: 1, classes: 1, evidence: 1 });
        expect(report.entries[0].caption).toContain('Biologi');
    });

    test('slot belum diisi tidak mengarang foto atau presensi semua hadir', () => {
        const report = reportOf([entry()], { status: 'UNFILLED' });
        expect(report.entries[0]).toMatchObject({ status: 'Belum diisi', photoUrl: '', caption: '', topik: '', presensi: 'Belum ada jurnal/presensi' });
        expect(report.filename).toContain('Belum_Diisi');
    });

    test('hanya tautan web aman diekspor; Drive memakai thumbnail tanpa mengubah tautan asli', () => {
        for (const value of ['javascript:alert(1)', 'data:text/html,abc', 'file:///C:/private', '']) expect(safeEvidenceUrl(value)).toBe('');
        expect(safeEvidenceUrl('https://example.org/foto.jpg')).toBe('https://example.org/foto.jpg');
        expect(evidenceImageUrl('https://drive.google.com/file/d/abc_123/view')).toBe('https://lh3.googleusercontent.com/d/abc_123=w1200');
        expect(evidenceImageUrl('https://school.test/lms.svg')).toBe('https://school.test/lms.svg');
    });

    test('waktu input SQL UTC dan ISO ditampilkan konsisten dalam WITA', () => {
        const sql = formatJurnalExportTime('2026-10-15 01:25:00');
        expect(sql).toContain('09.25');
        expect(sql).toContain('WITA');
        expect(sql).toBe(formatJurnalExportTime('2026-10-15T09:25:00+08:00'));
        expect(formatJurnalExportTime('waktu lama tidak valid')).toBe('waktu lama tidak valid');
    });
});

describe('PDF multipage asli dengan jsPDF', () => {
    test('kop, footer, foto, materi sebagai caption, dan tautan tetap ada tanpa sampul terpisah', async () => {
        const report = reportOf([entry(), entry({ id: 'j2', kelas: 'X-2', foto_url: '' })]);
        const result = await buildJurnalPdf(report, { jsPDF, loadImage: async () => image });
        expect(result.pages).toBe(1);
        expect(result.gridPages).toBe(1);
        expect(result.appendixPages).toBe(0);
        expect(result.failed).toBe(0);
        const content = streamsOf(result.pdf);
        expect(content).toContain('Struktur sel dan fungsi organel');
        expect(content).toContain('Belum ada bukti.');
        expect(result.pdf.output()).toContain('/URI (https://example.org/bukti.jpg)');
        for (let page = 1; page <= result.pages; page++) {
            expect(result.pdf.internal.pages[page].join('\n')).toContain('Arsip jurnal mengajar');
            expect(result.pdf.internal.pages[page].join('\n')).toMatch(/\/I\d+ Do/);
        }
    });

    test('materi/refleksi/presensi panjang berlanjut sampai selesai tanpa hilang', async () => {
        const report = reportOf([entry({ topik: `${'Pembahasan materi pembelajaran panjang. '.repeat(500)} PENANDA_AKHIR_MATERI`,
            catatan: `${'Refleksi guru. '.repeat(250)} PENANDA_AKHIR_REFLEKSI`, presensi_detail: Array.from({ length: 40 }, (_, i) => ({ nama: `Siswa ${i}`, status: 'S' })) })]);
        const { pdf, pages, gridPages, appendixPages } = await buildJurnalPdf(report, { jsPDF, loadImage: async () => image });
        expect(pages).toBeGreaterThan(3);
        expect(gridPages).toBe(1);
        expect(appendixPages).toBeGreaterThan(0);
        const content = streamsOf(pdf);
        expect(content).toContain('PENANDA_AKHIR_MATERI');
        expect(content).toContain('PENANDA_AKHIR_REFLEKSI');
        expect(content).toContain('Siswa 39');
        expect(content).toContain('lanjutan');
        expect(pdf.output()).toContain('/Dest [');
    });

    test('pemrosesan foto dibatasi tiga sekaligus dan foto gagal tetap punya tautan', async () => {
        let active = 0, peak = 0;
        const loadImage = async url => {
            active++; peak = Math.max(peak, active);
            await new Promise(resolve => setTimeout(resolve, 2));
            active--;
            if (url.includes('rusak')) throw new Error('CORS');
            return image;
        };
        const rows = Array.from({ length: 8 }, (_, i) => entry({ id: String(i), foto_url: `https://example.org/${i === 3 ? 'rusak' : i}.jpg` }));
        const progress = jest.fn();
        const { pdf, failed, pages } = await buildJurnalPdf(reportOf(rows), { jsPDF, loadImage, onProgress: progress });
        expect(peak).toBe(3);
        expect(failed).toBe(1);
        expect(pages).toBe(1);
        expect(pdf.output()).toContain('/URI (https://example.org/rusak.jpg)');
        expect(streamsOf(pdf)).toContain('Bukti gagal dimuat.');
        expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'ready', done: 8, failed: 1 }));
    });

    test('pembatalan sebelum/selama proses menghentikan PDF, sedangkan kop gagal memberi galat jelas', async () => {
        const controller = new AbortController(); controller.abort();
        await expect(buildJurnalPdf(reportOf([entry()]), { jsPDF, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        const during = new AbortController();
        await expect(buildJurnalPdf(reportOf([entry()]), { jsPDF, signal: during.signal, loadImage: async url => {
            if (url.includes('bukti')) during.abort();
            return image;
        } })).rejects.toMatchObject({ name: 'AbortError' });
        await expect(buildJurnalPdf(reportOf([entry()]), { jsPDF, loadImage: async () => { throw new Error('404'); } })).rejects.toThrow('Kop resmi sekolah tidak dapat dimuat: 404');
    });

    test('36 kelas menghasilkan empat halaman kartu, tanpa sampul atau halaman kosong tambahan', async () => {
        const rows = Array.from({ length: 36 }, (_, i) => entry({ id: `j${i}`, kelas: `X-${i + 1}`, foto_url: '' }));
        const { pdf, pages } = await buildJurnalPdf(reportOf(rows), { jsPDF, loadImage: async () => image });
        expect(pages).toBe(4);
        expect(streamsOf(pdf)).toContain('X-36');
        expect(pdf.internal.pages[pages].join('\n')).toContain('#036');
    });

    test.each([10, 11, 20, 21, 108])('%i jurnal pendek tetap tepat maksimal 10 per halaman', async count => {
        const rows = Array.from({ length: count }, (_, i) => entry({ id: `j${i}`, foto_url: '', catatan: 'Siswa aktif berdiskusi.', created_at: '2026-10-15 01:25:00' }));
        const { pdf, pages, appendixPages } = await buildJurnalPdf(reportOf(rows), { jsPDF, loadImage: async () => image });
        expect(pages).toBe(Math.ceil(count / 10));
        expect(appendixPages).toBe(0);
        for (let page = 1; page <= pages; page++) {
            const ids = pdf.internal.pages[page].join('\n').match(/#\d{3}/g) || [];
            expect(ids).toHaveLength(Math.min(10, count - (page - 1) * 10));
        }
    });

    test('caption khusus, refleksi dan nama siswa tetap lengkap pada lampiran padat bila perlu', async () => {
        const rows = [entry({ caption: 'CAPTION_KHUSUS', topik: 'MATERI_KHUSUS', catatan: 'REFLEKSI_KHUSUS', presensi_detail: [{ nama: 'SISWA_KHUSUS', status: 'I' }] })];
        const { pdf, gridPages, appendixPages } = await buildJurnalPdf(reportOf(rows), { jsPDF, loadImage: async () => image });
        const content = streamsOf(pdf);
        for (const marker of ['CAPTION_KHUSUS', 'MATERI_KHUSUS', 'REFLEKSI_KHUSUS', 'SISWA_KHUSUS']) expect(content).toContain(marker);
        expect(gridPages).toBe(1);
        expect(appendixPages).toBe(1);
        expect(content).toContain('Rincian');
    });
});
