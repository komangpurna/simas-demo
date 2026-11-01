import { buildMonthlyReport, currentReportPeriod, renderReportHtml, MAX_REPORT_JOURNALS } from '../js/jurnal-infographic.mjs';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const options = { kelas: 'X 1', mapel: 'Matematika', teacherName: 'I Made Guru', teacherUid: 'guru-1', school: { schoolName: 'SMA Negeri 1 Abang', schoolShortName: 'SMAGESA', logoPath: 'assets/logo-sekolah.png', schoolCity: 'Abang' } };
const period = currentReportPeriod(new Date('2026-09-09T03:00:00Z'));
const students = [{ nis: '001', name: 'Ayu', class: 'X 1' }, { nis: '002', name: 'Budi', class: 'X 1' }];
const journal = (extra = {}) => ({ id: 'j1', tanggal: '2026-09-02', kelas: 'X 1', mapel: 'Matematika', uid_guru: 'guru-1', guru: 'I Made Guru', jp: [1, 2], topik: 'Persamaan kuadrat', presensi_detail: [], ...extra });

test('bulan berjalan memakai WITA, termasuk pergantian bulan dan tahun', () => {
    expect(currentReportPeriod(new Date('2026-08-31T16:30:00Z'))).toMatchObject({ start: '2026-09-01', end: '2026-09-01' });
    expect(currentReportPeriod(new Date('2026-12-31T16:30:00Z')).start).toBe('2027-01-01');
});
test('hanya jurnal guru, kelas, mapel, dan bulan berjalan sampai hari ini', () => {
    const data = [journal(), journal({ id: '2', tanggal: '2026-08-31' }), journal({ id: '3', tanggal: '2026-09-10' }), journal({ id: '4', kelas: 'X 2' }), journal({ id: '5', mapel: 'Fisika' }), journal({ id: '6', uid_guru: 'guru-lain', guru: 'I Made Guru Lain' }), journal({ id: '7', tanggal: '2026-09-03', uid_guru: null, guru: ' i made  guru ' })];
    expect(buildMonthlyReport(data, students, options, period).sessions).toHaveLength(2);
});
test('presensi pengecualian, NIS lebih kuat dari nama, dan jumlah JP', () => {
    const report = buildMonthlyReport([journal({ presensi_detail: '[{"nis":"001","nama":"Ayu Lama","status":"S"}]' }), journal({ id: 'j2', tanggal: '2026-09-03', jp: '3-4' })], students, options, period);
    expect(report.students).toHaveLength(2);
    expect(report.students[0].counts).toMatchObject({ S: 1, H: 1 });
    expect(report.students[1].counts.H).toBe(2);
    expect(report.rate).toBe(75);
    expect(report.totalJp).toBe(4);
});

test('jurnal September dari master guru terbaca meskipun ID akun login berbeda', () => {
    const teacher = { ...options, kelas: 'XI-4', teacherName: 'I Komang Purna, S.Pd., Gr.', teacherUid: 'firebase-account' };
    const data = ['2026-09-01', '2026-09-02', '2026-09-08', '2026-08-26'].map((tanggal, i) => journal({ id: `j${i}`, tanggal, kelas: 'XI-4', uid_guru: 'journal-master-id', guru: 'I Komang Purna,S.Pd.,Gr.' }));
    const report = buildMonthlyReport(data, [], teacher, period);
    expect(report.sessions.map(s => s.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-08']);
    expect(report.sessions.filter(s => s.includeInReport)).toHaveLength(3);
});

test('jurnal terbaca jika profil akun tanpa gelar akademik sedangkan entri jurnal lengkap dengan gelar', () => {
    const teacherWithoutTitle = { ...options, kelas: 'XI-9', mapel: 'Matematika Tingkat Lanjut', teacherName: 'I Komang Purna', teacherUid: 'auth-uid' };
    const data = [
        journal({ id: 'j-purna-1', tanggal: '2026-09-02', kelas: 'XI-9', mapel: 'Matematika Tingkat Lanjut', uid_guru: 'htfda25WD2xWRTzhKtle', guru: 'I Komang Purna, S.Pd., Gr.' }),
        journal({ id: 'j-purna-2', tanggal: '2026-09-03', kelas: 'XI-9', mapel: 'Matematika Tingkat Lanjut', uid_guru: 'htfda25WD2xWRTzhKtle', guru: 'I Komang Purna, S.Pd., Gr.' }),
        journal({ id: 'j-purna-3', tanggal: '2026-09-09', kelas: 'XI-9', mapel: 'Matematika Tingkat Lanjut', uid_guru: 'htfda25WD2xWRTzhKtle', guru: 'I Komang Purna, S.Pd., Gr.' })
    ];
    const report = buildMonthlyReport(data, [], teacherWithoutTitle, period);
    expect(report.sessions).toHaveLength(3);
});

test('mode allowAnyTeacher membaca seluruh jurnal kelas & mapel tanpa tergantung akun pembuat', () => {
    const adminViewer = { ...options, kelas: 'XI-9', mapel: 'Matematika Tingkat Lanjut', teacherName: 'Super Admin', teacherUid: 'admin-uid', allowAnyTeacher: true, isSuperOrAdmin: true };
    const data = [
        journal({ id: 'j-adm-1', tanggal: '2026-09-02', kelas: 'XI-9', mapel: 'Matematika Tingkat Lanjut', uid_guru: 'htfda25WD2xWRTzhKtle', guru: 'I Komang Purna, S.Pd., Gr.' }),
        journal({ id: 'j-adm-2', tanggal: '2026-09-09', kelas: 'XI-9', mapel: 'Matematika Tingkat Lanjut', uid_guru: 'htfda25WD2xWRTzhKtle', guru: 'I Komang Purna, S.Pd., Gr.' })
    ];
    const report = buildMonthlyReport(data, [], adminViewer, period);
    expect(report.sessions).toHaveLength(2);
});

test('mengenali ID guru terkait dan tetap menolak nama guru lain atau kosong', () => {
    const teacher = { ...options, teacherIds: ['linked-master-id'] };
    const data = [
        journal({ uid_guru: 'linked-master-id', guru: 'Nama sebelum perubahan profil' }),
        journal({ id: 'other', tanggal: '2026-09-03', uid_guru: 'other-id', guru: 'I Made Guru Lain' }),
        journal({ id: 'blank', tanggal: '2026-09-04', uid_guru: 'other-id', guru: '' })
    ];
    expect(buildMonthlyReport(data, students, teacher, period).sessions).toHaveLength(1);
});
test('sesi duplikat memakai revisi terbaru, JP berbeda tetap pertemuan berbeda', () => {
    const report = buildMonthlyReport([journal({ updated_at: '2026-09-02T00:00', jp: [2, 1], presensi_detail: [{ nis: '001', status: 'A' }] }), journal({ id: 'j2', updated_at: '2026-09-02T01:00' }), journal({ id: 'j3', jp: [3, 4] })], students, options, period);
    expect(report.sessions).toHaveLength(2);
    expect(report.total.H).toBe(4);
});
test('data rusak dan status tidak dikenal tidak dihitung hadir; siswa historis dipertahankan', () => {
    const report = buildMonthlyReport([journal({ presensi_detail: '{rusak' }), journal({ id: 'j2', tanggal: '2026-09-03', presensi_detail: [{ nis: '003', nama: 'Citra', status: 'I' }, { nis: '001', nama: 'Ayu', status: 'X' }] })], students, options, period);
    expect(report.students[0].counts['?']).toBe(2);
    expect(report.students[2].counts).toMatchObject({ I: 1, '?': 1, H: 0 });
});
test('format presensi lama tetap terbaca dan nama ganda tidak digabung jika NIS berbeda', () => {
    const report = buildMonthlyReport([journal({ presensi_detail: null, presensi: { Ayu: 'D', Budi: 'T' } })], students, options, period);
    expect(report.total).toMatchObject({ D: 1, T: 1, H: 0 });
    const duplicate = buildMonthlyReport([journal({ presensi_detail: [{ nis: '002', nama: 'Ayu', status: 'S' }] })], [{ ...students[0] }, { ...students[1], name: 'Ayu' }], options, period);
    expect(duplicate.students.map(s => s.counts.S)).toEqual([0, 1]);
});
test('HTML berisi tepat dua halaman, tanda tangan, dan teks berbahaya di-escape', () => {
    const report = buildMonthlyReport([journal({ topik: '<script>alert(1)</script>', foto_url: 'javascript:alert(1)' })], students, { ...options, teacherNip: '19800101 200501 1 001' }, period);
    const html = renderReportHtml(report, 'data:image/png;base64,AAAA', 'https://school.test/');
    expect(html.match(/class="sheet"/g)).toHaveLength(2);
    expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain(`LAPORAN MENGAJAR ${period.label.toUpperCase()}`);
    expect(html).toContain('Dokumentasi Pembelajaran');
    expect(html).toContain('SMA Negeri 1 Abang');
    expect(html).toContain('NIP. 19800101 200501 1 001');
    expect(html).toContain('lesson-recap');
    expect(html).toContain('ji-table-grid');
    expect(html).toContain('TANGGAL KEGIATAN PEMBELAJARAN / PERTEMUAN KE -');
    expect(html).toContain('RINCIAN KETIDAKHADIRAN');
    expect(html).toContain('p2-header');
    expect(html).toContain('REKAP KEHADIRAN SISWA');
    expect(html).toContain('p2-summary-bar');
    expect(html).toContain('data-page="2"');
    // Pastikan kelas dan mapel tidak tercantum pada caption kartu foto pelajaran karena sudah ada di header
    expect(html).not.toMatch(/<div class="lesson-copy">[\s\S]*?<p>[\s\S]*?<\/p>\s*<\/div>\s*<\/article>/);
    expect(html).not.toContain('<p>Matematika</p>');
    expect(html).toContain('KELAS / MATA PELAJARAN');
    expect(html).toContain('<small>Matematika</small>');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<script>');
});

test('caption kartu foto menampilkan topik dan catatan jurnal dengan aman', () => {
    const report = buildMonthlyReport([journal({
        topik: 'Refleksi Fungsi Kuadrat',
        catatan: 'Peserta didik memahami grafik parabola dengan baik'
    })], students, options, period);
    const html = renderReportHtml(report, 'data:image/png;base64,AAAA', 'https://school.test/');
    expect(html).toContain('Refleksi Fungsi Kuadrat');
    expect(html).toContain('lesson-notes');
    expect(html).toContain('Catatan:');
    expect(html).toContain('Peserta didik memahami grafik parabola dengan baik');
    expect(html).toContain('lesson-overlay-tag');
    expect(html).not.toContain('<div class="lesson-date">');
});

test('foto pengganti hanya pada laporan, tanpa memutasi data jurnal asli', () => {
    const original = journal({ foto_url: 'https://drive.test/original.jpg' });
    const report = buildMonthlyReport([original], students, options, period);
    report.sessions[0].reportPhoto = 'data:image/jpeg;base64,AAAA';
    const html = renderReportHtml(report, '', 'https://school.test/');
    expect(html).toContain('data:image/jpeg;base64,AAAA');
    expect(html).not.toContain('https://drive.test/original.jpg');
    expect(original.foto_url).toBe('https://drive.test/original.jpg');
    expect(original.reportPhoto).toBeUndefined();
    delete report.sessions[0].reportPhoto;
    expect(renderReportHtml(report, '', 'https://school.test/')).toContain('https://drive.test/original.jpg');
});

test('maksimal 8 jurnal terbaru ditampilkan, kehadiran tetap seluruh bulan', () => {
    const data = Array.from({ length: 12 }, (_, i) => journal({ id: `j${i}`, tanggal: `2026-09-${String(i + 1).padStart(2, '0')}` }));
    const report = buildMonthlyReport(data, students, options, { ...period, end: '2026-09-20' });
    expect(report.sessions.filter(s => s.includeInReport)).toHaveLength(8);
    expect(report.sessions[0].includeInReport).toBe(false);
    expect(report.sessions[4].includeInReport).toBe(true);
    expect(report.students[0].counts.H).toBe(12);
    const html = renderReportHtml(report, '', 'https://school.test/');
    expect(html.match(/class="lesson"/g)).toHaveLength(8);
    expect(html).toContain('8 DARI 12 JURNAL');
    expect(html).toContain('Seluruh 12 pertemuan bulan berjalan');
});

test('keterangan rekap kehadiran di-overlay di bagian kanan bawah foto', async () => {
    const report = buildMonthlyReport([journal({
        presensi_detail: JSON.stringify([{ nis: '001', nama: 'Ayu', status: 'S' }])
    })], students, options, period);
    const html = renderReportHtml(report, '', 'https://school.test/');
    expect(html).toContain('class="lesson-photo"');
    expect(html).toContain('class="lesson-recap"');
    expect(html).toMatch(/<div class="lesson-photo">[\s\S]*?<div class="lesson-recap">[\s\S]*?<\/div>\s*<\/div>\s*<div class="lesson-copy">/);
    expect(html).not.toMatch(/<div class="lesson-topic-row">[\s\S]*?<div class="lesson-recap">/);

    const fs = await import('fs');
    const reportCss = fs.readFileSync(new URL('../css/jurnal-infographic-report.css', import.meta.url), 'utf8');
    expect(reportCss).toMatch(/\.lesson-recap\s*\{[^}]*position:\s*absolute/);
    expect(reportCss).toMatch(/\.lesson-recap\s*\{[^}]*right:\s*8px/);
    expect(reportCss).toMatch(/\.lesson-recap\s*\{[^}]*bottom:\s*8px/);

    const dialogCss = fs.readFileSync(new URL('../css/jurnal-infographic.css', import.meta.url), 'utf8');
    expect(dialogCss).toMatch(/\.ji-report \.lesson-recap\{position:absolute;right:8px;bottom:8px/);
});

test('sel presensi pertemuan dikosongkan jika hadir (H), dan menampilkan badge jika tidak hadir', () => {
    const sessionHadir = journal({ id: 'j1', tanggal: '2026-09-01' });
    const sessionSakit = journal({
        id: 'j2',
        tanggal: '2026-09-02',
        presensi_detail: JSON.stringify([{ nis: '1001', nama: 'Siswa A', status: 'S' }])
    });
    const testStudents = [
        { nis: '1001', name: 'Siswa A', class: 'X 1' },
        { nis: '1002', name: 'Siswa B', class: 'X 1' }
    ];
    const report = buildMonthlyReport([sessionHadir, sessionSakit], testStudents, options, period);
    const html = renderReportHtml(report, '', 'https://school.test/');

    expect(html).not.toContain('attendance-present');
    expect(html).not.toContain('<span class="attendance-present">H</span>');
    expect(html).toContain('ji-badge-s');
    expect(html).toContain('<td class="col-date"><span class="ji-badge ji-badge-s">S</span></td>');
    expect(html).toContain('<td class="col-date"></td>');
});

test('tombol infografis sejajar Pengaturan Nilai dan hanya muncul pada tab jurnal', () => {
    const html = readFileSync(new URL('../guru-mapel.html', import.meta.url), 'utf8');
    const source = readFileSync(new URL('../js/page-guru-mapel.js', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    try {
        dom.window.eval(source.match(/window\.switchGuruMapelTab = function \(tabName\) \{[\s\S]*?\n\};/)[0]);
        const document = dom.window.document;
        const tools = document.getElementById('wrapper-jurnal-tools');
        const btnMobile = document.getElementById('btn-infographic-mobile');
        expect(tools.parentElement).toBe(document.getElementById('wrapper-penilaian-tools').parentElement);
        expect(document.querySelectorAll('#btn-jurnal-infographic')).toHaveLength(1);
        expect(btnMobile).not.toBeNull();
        expect(tools.hidden).toBe(true);
        expect(btnMobile.classList.contains('hidden')).toBe(true);
        for (const tab of ['jurnal', 'penilaian', 'jurnal', 'kehadiran', 'jurnal', 'lms']) {
            dom.window.switchGuruMapelTab(tab);
            expect(tools.hidden).toBe(tab !== 'jurnal');
            expect(tools.classList.contains('hidden')).toBe(tab !== 'jurnal');
            expect(btnMobile.classList.contains('hidden')).toBe(tab !== 'jurnal');
        }
    } finally { dom.window.close(); }
});

test('tanda tangan menampilkan NIP jika ada di GTK, dan hanya nama jika tidak ada NIP', () => {
    // 1. Kasus dengan NIP valid
    const reportWithNip = buildMonthlyReport([journal()], students, { ...options, teacherNip: '19850101 201001 1 001' }, period);
    const htmlWithNip = renderReportHtml(reportWithNip, '', 'https://school.test/');
    expect(htmlWithNip).toContain('<div class="signature-block"><p>Abang, 9 Sep 2026</p><p>Guru mata pelajaran</p><img src="" alt="Tanda tangan guru"><b>I Made Guru</b><small>NIP. 19850101 201001 1 001</small></div>');

    // 2. Kasus tanpa NIP (honorer / non-PNS / NIP kosong / '-')
    const reportNoNip = buildMonthlyReport([journal()], students, { ...options, teacherNip: '' }, period);
    const htmlNoNip = renderReportHtml(reportNoNip, '', 'https://school.test/');
    expect(htmlNoNip).toContain('<div class="signature-block"><p>Abang, 9 Sep 2026</p><p>Guru mata pelajaran</p><img src="" alt="Tanda tangan guru"><b>I Made Guru</b></div>');
    expect(htmlNoNip).not.toMatch(/<div class="signature-block">[\s\S]*?<small>NIP/);

    // 3. Kasus NIP berupa dash '-' atau invalid
    const reportDashNip = buildMonthlyReport([journal()], students, { ...options, teacherNip: '-' }, period);
    const htmlDashNip = renderReportHtml(reportDashNip, '', 'https://school.test/');
    expect(htmlDashNip).toContain('<div class="signature-block"><p>Abang, 9 Sep 2026</p><p>Guru mata pelajaran</p><img src="" alt="Tanda tangan guru"><b>I Made Guru</b></div>');
    expect(htmlDashNip).not.toMatch(/<div class="signature-block">[\s\S]*?<small>NIP/);
});

test('foto profil guru dirender pada Halaman 1 dan Halaman 2, serta aman dari injeksi XSS', () => {
    // 1. Kasus dengan foto profil guru valid (URL https)
    const reportWithPhoto = buildMonthlyReport([journal()], students, { ...options, teacherPhoto: 'https://images.example/teacher.jpg' }, period);
    expect(reportWithPhoto.teacherPhoto).toBe('https://images.example/teacher.jpg');
    const htmlWithPhoto = renderReportHtml(reportWithPhoto, '', 'https://school.test/');
    expect(htmlWithPhoto.match(/class="sheet"/g)).toHaveLength(2);
    expect(htmlWithPhoto).toContain('class="teacher-avatar"');
    expect(htmlWithPhoto).toContain('src="https://images.example/teacher.jpg"');
    expect(htmlWithPhoto).toContain('width="44"');
    expect(htmlWithPhoto).toContain('height="44"');
    expect(htmlWithPhoto).toContain('class="p2-teacher-avatar"');
    expect(htmlWithPhoto).toContain('width="22"');
    expect(htmlWithPhoto).toContain('height="22"');

    // 2. Kasus foto profil berupa base64 data URI
    const reportBase64 = buildMonthlyReport([journal()], students, { ...options, teacherPhoto: 'data:image/png;base64,iVBORw0KGgo=' }, period);
    const htmlBase64 = renderReportHtml(reportBase64, '', 'https://school.test/');
    expect(htmlBase64).toContain('src="data:image/png;base64,iVBORw0KGgo="');

    // 3. Kasus tanpa foto (fallback bersih tanpa tag img rusak)
    const reportNoPhoto = buildMonthlyReport([journal()], students, { ...options, teacherPhoto: '' }, period);
    const htmlNoPhoto = renderReportHtml(reportNoPhoto, '', 'https://school.test/');
    expect(htmlNoPhoto).not.toContain('class="teacher-avatar"');
    expect(htmlNoPhoto).not.toContain('class="p2-teacher-avatar"');
    expect(htmlNoPhoto).toContain('<b>I Made Guru</b>');

    // 4. Kasus foto berisi protokol berbahaya (XSS OWASP: javascript:)
    const reportXss = buildMonthlyReport([journal()], students, { ...options, teacherPhoto: 'javascript:alert(1)' }, period);
    const htmlXss = renderReportHtml(reportXss, '', 'https://school.test/');
    expect(htmlXss).not.toContain('javascript:alert(1)');
    expect(htmlXss).not.toContain('class="teacher-avatar"');
});

test('proporsi dan penempatan CSS foto profil guru selaras dan vertikal center presisi', async () => {
    const fs = await import('fs');
    const reportCss = fs.readFileSync(new URL('../css/jurnal-infographic-report.css', import.meta.url), 'utf8');
    expect(reportCss).toContain('align-items:center!important');
    expect(reportCss).toContain('object-position:center 20%');
    expect(reportCss).toContain('aspect-ratio:1/1');
    expect(reportCss).toMatch(/width:\s*44px;\s*height:\s*44px/);

    const dialogCss = fs.readFileSync(new URL('../css/jurnal-infographic.css', import.meta.url), 'utf8');
    expect(dialogCss).toContain('object-position:center 20%');
    expect(dialogCss).toContain('aspect-ratio:1/1');
    expect(dialogCss).toMatch(/width:\s*44px;\s*height:\s*44px/);
});

test('tata letak header 1-baris terpadu: judul & badge kelas di kiri, foto profil, nama guru, NIP & mapel di kanan', async () => {
    const fs = await import('fs');
    const report = buildMonthlyReport([journal()], students, { ...options, teacherNip: '199511162024211010' }, period);
    const html = renderReportHtml(report, '', 'https://school.test/');

    // Memverifikasi struktur header 1-baris terpadu
    expect(html).toContain('class="headline-left"');
    expect(html).toContain('class="headline-title-wrap"');
    expect(html).toMatch(/<div class="headline-title-wrap">[\s\S]*?<h1>Dokumentasi Pembelajaran<\/h1>[\s\S]*?<div class="class-badge">[\s\S]*?<strong>X 1<\/strong>[\s\S]*?<\/div>[\s\S]*?<\/div>/);
    expect(html).toContain('class="identity"');
    expect(html).toContain('class="identity-teacher-info"');
    expect(html).toMatch(/<div class="identity-teacher-info">[\s\S]*?<b>I Made Guru<\/b>[\s\S]*?<small>NIP\. 199511162024211010 · Matematika<\/small>[\s\S]*?<\/div>/);

    // Memverifikasi CSS report 1-baris
    const reportCss = fs.readFileSync(new URL('../css/jurnal-infographic-report.css', import.meta.url), 'utf8');
    expect(reportCss).toContain('.headline-title-wrap');
    expect(reportCss).toContain('.identity-teacher-info');
    expect(reportCss).toContain('align-items:center!important');
    expect(reportCss).toMatch(/\.identity\s*\{\s*display:\s*flex;/);
    expect(reportCss).toMatch(/h1\s*\{[^}]*white-space:\s*nowrap;/);
    expect(reportCss).toMatch(/\.identity-teacher-info\s*b\s*\{[^}]*white-space:\s*nowrap;/);

    // Memverifikasi CSS dialog 1-baris
    const dialogCss = fs.readFileSync(new URL('../css/jurnal-infographic.css', import.meta.url), 'utf8');
    expect(dialogCss).toContain('.ji-report .headline-title-wrap');
    expect(dialogCss).toContain('.ji-report .identity-teacher-info');
    expect(dialogCss).toContain('align-items:center!important');
    expect(dialogCss).toContain('.ji-report .identity{display:flex;');
    expect(dialogCss).toContain('.ji-report h1{font-size:19px;line-height:1.2;letter-spacing:-.4px;margin:0;white-space:nowrap}');
});

test('konstanta MAX_REPORT_JOURNALS bernilai 8 dan teks header galeri dialog selaras tanpa sisa maksimal 10', () => {
    expect(MAX_REPORT_JOURNALS).toBe(8);
    const source = readFileSync(new URL('../js/jurnal-infographic.mjs', import.meta.url), 'utf8');
    expect(source).not.toContain('maksimal 10 pilihan');
    expect(source).toContain('maksimal ${MAX_REPORT_JOURNALS} pilihan');
});

test('status terlambat (T) tetap terhitung hadir pada persentase kehadiran (rate / H%) dan tidak menambah jumlah ketidakhadiran (JML)', () => {
    // Siswa 001 hadir 1 kali tepat waktu (H) dan 1 kali terlambat (T) dari 2 pertemuan
    const report = buildMonthlyReport([
        journal({ presensi_detail: '[{"nis":"001","nama":"Ayu","status":"T"}]' }),
        journal({ id: 'j2', tanggal: '2026-09-03', jp: '3-4' })
    ], students, options, period);

    expect(report.students[0].counts).toMatchObject({ T: 1, H: 1 });
    // Karena terlambat tetap terhitung hadir: 1 (H) + 1 (T) = 2 dari 2 pertemuan => 100%
    expect(report.students[0].rate).toBe(100);
    // Siswa 002 hadir di kedua pertemuan (H: 2) => 100%
    expect(report.students[1].rate).toBe(100);
    // Total kelas: 4 hadir (3 H + 1 T) dari 4 presensi tercatat => 100%
    expect(report.rate).toBe(100);

    const html = renderReportHtml(report, '', 'https://school.test/');
    // Pada tabel Halaman 2, JML ketidakhadiran siswa 001 adalah 0 (tidak dianggap absen)
    // dan kolom rate menampilkan 100%
    expect(html).toContain('<td class="col-stat stat-t">1</td>');
    expect(html).toContain('<td class="col-stat stat-muted"><b>0</b></td>'); // JML ketidakhadiran = 0
    expect(html).toContain('<td class="col-rate"><b>100%</b></td>');
    // Memverifikasi catatan kaki H% mencantumkan formula hadir + terlambat
    expect(html).toContain('H% = (hadir + terlambat) ÷ presensi tercatat × 100%');
});

test('badge VIP terpasang pada tombol pemicu portal guru mapel dan header dialog infografis', () => {
    const html = readFileSync(new URL('../guru-mapel.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const btnDesktop = document.getElementById('btn-jurnal-infographic');
    const btnMobile = document.getElementById('btn-infographic-mobile');
    const btnPanel = document.getElementById('btn-jurnal-infographic-panel');

    expect(btnDesktop).not.toBeNull();
    expect(btnDesktop.textContent).toContain('VIP');
    expect(btnMobile).not.toBeNull();
    expect(btnMobile.textContent).toContain('VIP');
    expect(btnPanel).not.toBeNull();
    expect(btnPanel.textContent).toContain('VIP');

    const mjsSource = readFileSync(new URL('../js/jurnal-infographic.mjs', import.meta.url), 'utf8');
    expect(mjsSource).toContain('ji-vip-badge');
    expect(mjsSource).toContain('SIMAS VIP');
});

test('renderReportHtml mendukung multi-kelas: 2 kelas menghasilkan tepat 4 halaman A4 dengan footer mandiri', () => {
    const report1 = buildMonthlyReport(
        [journal({ id: 'j1-x1', kelas: 'X 1', topik: 'Aljabar Dasar' })],
        [{ nis: '101', name: 'Siswa X1 A', class: 'X 1' }],
        { ...options, kelas: 'X 1' },
        period
    );
    const report2 = buildMonthlyReport(
        [journal({ id: 'j1-x2', kelas: 'X 2', topik: 'Trigonometri' })],
        [{ nis: '201', name: 'Siswa X2 B', class: 'X 2' }],
        { ...options, kelas: 'X 2' },
        period
    );

    const signatureSample = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const html = renderReportHtml([report1, report2], signatureSample, 'https://school.test/');

    // Memverifikasi tepat 4 elemen .sheet (2 halaman per kelas x 2 kelas)
    const sheets = html.match(/class="sheet"/g);
    expect(sheets).toHaveLength(4);

    // Memverifikasi atribut data-kelas terpasang di masing-masing lembar
    expect(html).toContain('data-kelas="X 1"');
    expect(html).toContain('data-kelas="X 2"');

    // Memverifikasi konten topik unik kelas masing-masing
    expect(html).toContain('Aljabar Dasar');
    expect(html).toContain('Trigonometri');

    // Memverifikasi nama siswa muncul di tabel presensi kelas masing-masing
    expect(html).toContain('Siswa X1 A');
    expect(html).toContain('Siswa X2 B');

    // Memverifikasi footer mandiri: 01 / 02 dan 02 / 02 untuk X 1, serta 01 / 02 dan 02 / 02 untuk X 2
    expect(html).toContain('X 1</span><span>01 / 02</span>');
    expect(html).toContain('X 1</span><span>02 / 02</span>');
    expect(html).toContain('X 2</span><span>01 / 02</span>');
    expect(html).toContain('X 2</span><span>02 / 02</span>');

    // Memverifikasi tanda tangan guru dirender pada seluruh lembar kelas
    const occurrences = html.split(signatureSample).length - 1;
    expect(occurrences).toBe(2); // Ada pada Halaman 1 setiap kelas
});

test('renderReportHtml mendukung 3 kelas menghasilkan tepat 6 halaman A4 bersambung', () => {
    const report1 = buildMonthlyReport([journal({ id: 'j1', kelas: 'XI-1' })], [{ nis: '1', name: 'A', class: 'XI-1' }], { ...options, kelas: 'XI-1' }, period);
    const report2 = buildMonthlyReport([journal({ id: 'j2', kelas: 'XI-2' })], [{ nis: '2', name: 'B', class: 'XI-2' }], { ...options, kelas: 'XI-2' }, period);
    const report3 = buildMonthlyReport([journal({ id: 'j3', kelas: 'XI-3' })], [{ nis: '3', name: 'C', class: 'XI-3' }], { ...options, kelas: 'XI-3' }, period);

    const html = renderReportHtml([report1, report2, report3], '', 'https://school.test/');
    expect(html.match(/class="sheet"/g)).toHaveLength(6);
    expect(html).toContain('Laporan Mengajar Multi-Kelas (XI-1, XI-2, XI-3)');
});

test('currentReportPeriod mendukung kustomisasi bulan lampau spesifik via format YYYY-MM', () => {
    const augustPeriod = currentReportPeriod('2026-08');
    expect(augustPeriod.month).toBe('2026-08');
    expect(augustPeriod.start).toBe('2026-08-01');
    expect(augustPeriod.end).toBe('2026-08-31');
    expect(augustPeriod.label.toLowerCase()).toContain('agustus 2026');
});

test('jurnal-infographic.mjs menyediakan antarmuka checklist multi-kelas dan tab peninjau', () => {
    const source = readFileSync(new URL('../js/jurnal-infographic.mjs', import.meta.url), 'utf8');
    expect(source).toContain('ji-class-selector');
    expect(source).toContain('data-class-select');
    expect(source).toContain('select-all-classes');
    expect(source).toContain('select-single-class');
    expect(source).toContain('ji-class-tabs');
    expect(source).toContain('data-class-tab');
});

test('jurnal-infographic.mjs menangani siklus hidup onload dan onerror gambar thumbnail tanpa memicu Foto tidak tersedia secara prematur', () => {
    const source = readFileSync(new URL('../js/jurnal-infographic.mjs', import.meta.url), 'utf8');
    // Memastikan tidak ada lagi pengecekan prematur yang langsung menyembunyikan foto saat ganti tab
    expect(source).not.toContain('if (img.complete && !img.naturalWidth) unavailable();');
    // Memastikan penanganan event onload dan onerror terpasang
    expect(source).toContain('img.onload = available;');
    expect(source).toContain('img.onerror = unavailable;');
    expect(source).toContain('delete parent.dataset.empty');
    expect(source).toContain("parent.dataset.empty = 'Foto tidak tersedia'");
});

test('tata letak kartu foto editor compact 3-4 kolom dengan tinggi thumbnail 105px dan teks ringkas', () => {
    const editorCss = readFileSync(new URL('../css/jurnal-infographic-editor.css', import.meta.url), 'utf8');
    expect(editorCss).toContain('grid-template-columns:repeat(auto-fill,minmax(210px,1fr))');
    expect(editorCss).toContain('height:105px');
    expect(editorCss).toContain('-webkit-line-clamp:2');
    expect(editorCss).toContain('line-height:1.35');
});




