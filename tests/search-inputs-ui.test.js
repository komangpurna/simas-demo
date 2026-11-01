/**
 * Unit & Regression Test: Validasi Form Pencarian Bersih Tanpa Ikon Penutup Teks (Anti-Occlusion UI/UX)
 * Memastikan bahwa form pencarian di seluruh halaman aplikasi tidak memuat ikon kaca pembesar
 * yang menimpa teks placeholder ataupun memblokir pointer events.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('UI/UX: Seluruh Form Pencarian Bebas dari Ikon Kaca Pembesar Penutup Teks Placeholder', () => {
    const root = path.resolve(__dirname, '..');

    const searchTargets = [
        { file: 'dokumen.html', inputId: 'input-search-docs-modal', desc: 'Modal Dokumen Terdaftar' },
        { file: 'e-lab.html', inputId: 'manage-lab-koordinator-search', desc: 'Modal Kelola Lab Koordinator' },
        { file: 'e-kinerja-tendik.html', inputId: 'search-employee-activities', desc: 'Pencarian Aktivitas Kerja Pegawai' },
        { file: 'e-kinerja-tendik.html', inputId: 'input-search-assignments', desc: 'Pencarian Daftar Penugasan Aktif' },
        { file: 'guru-mapel.html', inputId: 'input-search-lms', desc: 'Toolbar Pencarian Materi/Modul LMS' },
        { file: 'guru-wali.html', inputId: 'search-siswa', desc: 'Pencarian Siswa Binaan Guru Wali' },
        { file: 'jurnal-admin.html', inputId: 'filter-rekap-search', desc: 'Pencarian Rekapitulasi Jurnal KBM' },
        { file: 'settings.html', inputId: 'backup-search-input', desc: 'Pencarian Tabel Backup Database' },
        { file: 'wali-kelas.html', inputId: 'input-search-master-students', desc: 'Pencarian Master Data Siswa Rombel' }
    ];

    searchTargets.forEach(target => {
        test(`Memastikan [${target.file}] - #${target.inputId} (${target.desc}) bebas dari ikon penutup teks`, () => {
            const filePath = path.join(root, target.file);
            expect(fs.existsSync(filePath)).toBe(true);

            const content = fs.readFileSync(filePath, 'utf8');
            const targetIndex = content.indexOf(`id="${target.inputId}"`);
            expect(targetIndex).toBeGreaterThan(-1);

            const snippet = content.substring(Math.max(0, targetIndex - 200), Math.min(content.length, targetIndex + 200));

            expect(snippet).not.toContain('fa-magnifying-glass');
            expect(snippet).not.toContain('fa-search');
            expect(snippet).not.toContain('pl-7');
            expect(snippet).not.toContain('pl-8');
            expect(snippet).not.toContain('pl-9');
            expect(snippet).not.toContain('!important');
        });
    });
});
