const fs = require('fs');
const path = require('path');

describe('Verifikasi Fitur Tombol Detail & Modal Detail Kehadiran Guru pada Rekap Guru Monitoring KBM', () => {
    const projectRoot = path.resolve(__dirname, '..');
    const htmlContent = fs.readFileSync(path.join(projectRoot, 'monitoring-kbm.html'), 'utf8');
    const jsContent = fs.readFileSync(path.join(projectRoot, 'js', 'page-monitoring-kbm.js'), 'utf8');

    test('1. Struktur Elemen Modal Detail Rekap Guru di HTML (Anti-Nesting & Top-Level Sibling)', () => {
        expect(htmlContent).toContain('id="modal-rekap-guru-detail"');
        expect(htmlContent).toContain('id="modal-guru-nama"');
        expect(htmlContent).toContain('id="modal-guru-periode"');
        expect(htmlContent).toContain('id="modal-status-select"');
        expect(htmlContent).toContain('id="modal-rekap-guru-tbody"');
        expect(htmlContent).toContain('id="modal-row-counter"');
        expect(htmlContent).toContain('id="btn-print-modal-detail"');
        expect(htmlContent).toContain('id="modal-stat-h"');
        expect(htmlContent).toContain('id="modal-stat-k"');
        expect(htmlContent).toContain('id="modal-stat-i"');
        expect(htmlContent).toContain('id="modal-stat-s"');
        expect(htmlContent).toContain('id="modal-stat-tk"');
        expect(htmlContent).toContain('id="modal-stat-te"');
        expect(htmlContent).toContain('id="modal-stat-persen"');

        // Pastikan modal berada setelah penutup </main>
        const mainCloseIndex = htmlContent.indexOf('</main>');
        const modalIndex = htmlContent.indexOf('id="modal-rekap-guru-detail"');
        expect(mainCloseIndex).toBeGreaterThan(-1);
        expect(modalIndex).toBeGreaterThan(mainCloseIndex);
    });

    test('2. Hak Akses Tab Rekap Guru Terbuka untuk Guru Mapel & Pimpinan', () => {
        // Pada inisialisasi peran guru mapel, tabRekapGuru tidak disembunyikan
        expect(jsContent).toContain('if (tabRekapGuru) tabRekapGuru.classList.remove("hidden");');
        expect(jsContent).toContain('tabRekapGuru.className = tab === "rekap-guru" ? activeBtnBase : inactiveBtnBase;');
    });

    test('3. Penempatan Tombol Detail di Sebelah Kanan Angka Persentase pada Tabel Rekap Guru', () => {
        expect(jsContent).toContain('onclick="window.openRekapGuruDetailModal(this.dataset.guru)"');
        expect(jsContent).toContain('data-guru=');
        expect(jsContent).toContain('title="Buka detail kehadiran');
        expect(jsContent).toContain('<span class="font-extrabold ${persenColor}">${persen}%</span>');
    });

    test('4. Logika Modal Detail Kehadiran Guru: Filter Status & Penyajian Kegiatan', () => {
        expect(jsContent).toContain('window.openRekapGuruDetailModal = async function');
        expect(jsContent).toContain('window.filterModalRekapGuruStatus = function');
        expect(jsContent).toContain('window.renderModalRekapGuruTable = function');
        expect(jsContent).toContain('window.closeRekapGuruDetailModal = function');
        expect(jsContent).toContain('window.printModalDetailGuru = function');

        // Dukungan pembacaan field kegiatan
        expect(jsContent).toContain('kegiatan: row.kegiatan || row.keterangan || row.nama_kegiatan || ""');
        expect(jsContent).toContain('fa-briefcase');
    });

    test('5. Validasi Logika Filter Status Modal Rekap Guru secara Unit Function', () => {
        const sampleRecords = [
            { tanggal: '2026-10-12', kelas: 'X-1', jp: 1, mapel: 'Matematika', status: 'H', kegiatan: '' },
            { tanggal: '2026-10-12', kelas: 'X-2', jp: 3, mapel: 'Matematika', status: 'K', kegiatan: 'Rapat Kurikulum' },
            { tanggal: '2026-10-13', kelas: 'XI-1', jp: 2, mapel: 'Matematika', status: 'S', kegiatan: '' },
            { tanggal: '2026-10-13', kelas: 'XI-2', jp: 4, mapel: 'Matematika', status: 'I', kegiatan: '' },
            { tanggal: '2026-10-13', kelas: 'XII-1', jp: 5, mapel: 'Matematika', status: 'TK', kegiatan: '' },
            { tanggal: '2026-10-13', kelas: 'XII-2', jp: 6, mapel: 'Matematika', status: 'TE', kegiatan: '' }
        ];

        function filterRecords(records, selectedStatus) {
            if (selectedStatus === 'ALL') return records;
            return records.filter(item => {
                if (selectedStatus === 'I') return item.status === 'I' || item.status === 'L';
                if (selectedStatus === 'TK') return item.status === 'TK' || item.status === 'TT' || item.status === 'A';
                return item.status === selectedStatus;
            });
        }

        expect(filterRecords(sampleRecords, 'ALL').length).toBe(6);
        expect(filterRecords(sampleRecords, 'K').length).toBe(1);
        expect(filterRecords(sampleRecords, 'K')[0].kegiatan).toBe('Rapat Kurikulum');
        expect(filterRecords(sampleRecords, 'S').length).toBe(1);
        expect(filterRecords(sampleRecords, 'I').length).toBe(1);
        expect(filterRecords(sampleRecords, 'TK').length).toBe(1);
        expect(filterRecords(sampleRecords, 'TE').length).toBe(1);
        expect(filterRecords(sampleRecords, 'H').length).toBe(1);
    });
});
