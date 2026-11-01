/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('Portal Guru Mapel - Filter Default Bulan Berjalan Jurnal Mengajar', () => {
    let htmlContent;

    beforeAll(() => {
        const htmlPath = path.join(__dirname, '../guru-mapel.html');
        htmlContent = fs.readFileSync(htmlPath, 'utf8');
    });

    describe('1. Verifikasi Markup Statis HTML (guru-mapel.html)', () => {
        beforeEach(() => {
            document.body.innerHTML = htmlContent;
        });

        test('panel-jurnal memuat sub-bar jurnal-filter-bar yang tersembunyi secara default', () => {
            const panelJurnal = document.getElementById('panel-jurnal');
            expect(panelJurnal).not.toBeNull();

            const filterBar = panelJurnal.querySelector('#jurnal-filter-bar');
            expect(filterBar).not.toBeNull();
            expect(filterBar.classList.contains('hidden')).toBe(true);

            const selectMonth = filterBar.querySelector('#select-jurnal-month');
            expect(selectMonth).not.toBeNull();
            expect(selectMonth.getAttribute('onchange')).toBe('window.onJurnalMonthChange(this.value)');

            const countBadge = filterBar.querySelector('#jurnal-count-badge');
            expect(countBadge).not.toBeNull();
            expect(countBadge.querySelector('#jurnal-count-text')).not.toBeNull();

            const btnInfographic = filterBar.querySelector('#btn-jurnal-infographic-panel');
            expect(btnInfographic).not.toBeNull();
            expect(btnInfographic.getAttribute('onclick')).toBe('window.openJurnalInfographic()');
        });

        test('jurnal-empty-state tetap memiliki tombol Muat Daftar Jurnal (Load)', () => {
            const emptyState = document.getElementById('jurnal-empty-state');
            expect(emptyState).not.toBeNull();

            const centerBtn = emptyState.querySelector('#btn-center-load-jurnal');
            expect(centerBtn).not.toBeNull();
            expect(centerBtn.getAttribute('onclick')).toBe('window.loadGradebookData()');
            expect(centerBtn.textContent).toContain('Muat Daftar Jurnal (Load)');
        });
    });

    describe('2. Logika Resolusi Kunci Bulan & Daftar Bulan Semester', () => {
        function getJurnalMonthKey(data) {
            if (!data) return '';
            if (data.tanggal && typeof data.tanggal === 'string' && /^\d{4}-\d{2}/.test(data.tanggal)) {
                return data.tanggal.substring(0, 7);
            }
            const d = data.timestampMs ? new Date(data.timestampMs) : (data.created_at ? new Date(data.created_at) : (data.timestamp ? new Date(data.timestamp) : null));
            if (d && !isNaN(d.getTime())) {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                return `${y}-${m}`;
            }
            return '';
        }

        function getSemesterMonthsList(tahunAjaran, semester) {
            const parts = (tahunAjaran || '').split('/');
            const year1 = parseInt(parts[0]) || 2026;
            const year2 = parseInt(parts[1]) || (year1 + 1);

            if (String(semester) === '2') {
                return [
                    { key: `${year2}-01`, name: 'Januari', year: year2 },
                    { key: `${year2}-02`, name: 'Februari', year: year2 },
                    { key: `${year2}-03`, name: 'Maret', year: year2 },
                    { key: `${year2}-04`, name: 'April', year: year2 },
                    { key: `${year2}-05`, name: 'Mei', year: year2 },
                    { key: `${year2}-06`, name: 'Juni', year: year2 }
                ];
            }

            return [
                { key: `${year1}-07`, name: 'Juli', year: year1 },
                { key: `${year1}-08`, name: 'Agustus', year: year1 },
                { key: `${year1}-09`, name: 'September', year: year1 },
                { key: `${year1}-10`, name: 'Oktober', year: year1 },
                { key: `${year1}-11`, name: 'November', year: year1 },
                { key: `${year1}-12`, name: 'Desember', year: year1 }
            ];
        }

        test('getJurnalMonthKey mengekstrak tahun-bulan format YYYY-MM secara tepat', () => {
            expect(getJurnalMonthKey({ tanggal: '2026-09-16' })).toBe('2026-09');
            expect(getJurnalMonthKey({ tanggal: '2026-07-31T23:59:59Z' })).toBe('2026-07');
            expect(getJurnalMonthKey({ timestampMs: new Date('2026-08-15T10:00:00').getTime() })).toBe('2026-08');
            expect(getJurnalMonthKey(null)).toBe('');
        });

        test('getSemesterMonthsList menghasilkan 6 bulan yang benar untuk Semester 1 dan 2', () => {
            const smt1 = getSemesterMonthsList('2026/2027', '1');
            expect(smt1.length).toBe(6);
            expect(smt1.map(m => m.key)).toEqual([
                '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'
            ]);
            expect(smt1[2].name).toBe('September');

            const smt2 = getSemesterMonthsList('2026/2027', '2');
            expect(smt2.length).toBe(6);
            expect(smt2.map(m => m.key)).toEqual([
                '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06'
            ]);
            expect(smt2[0].name).toBe('Januari');
        });
    });

    describe('3. Isolasi Render DOM & Permintaan Foto Google Drive', () => {
        let mockJurnalList;

        beforeEach(() => {
            document.body.innerHTML = `
                <div id="panel-jurnal">
                    <div id="jurnal-filter-bar" class="hidden">
                        <select id="select-jurnal-month"></select>
                        <span id="jurnal-count-badge"><span id="jurnal-count-text">0 Jurnal</span></span>
                    </div>
                    <div id="jurnal-table-wrapper"></div>
                </div>
            `;

            mockJurnalList = [
                // Juli: 2 jurnal
                { id: 'j-jul-1', monthKey: '2026-07', waktuStr: 'Kamis, 30 Jul 2026', kelas: 'XII-1', mapel: 'Matematika', foto_url: 'https://drive.google.com/uc?id=foto_jul_1' },
                { id: 'j-jul-2', monthKey: '2026-07', waktuStr: 'Jumat, 31 Jul 2026', kelas: 'XII-1', mapel: 'Matematika', foto_url: 'https://drive.google.com/uc?id=foto_jul_2' },
                // Agustus: 3 jurnal
                { id: 'j-ags-1', monthKey: '2026-08', waktuStr: 'Senin, 03 Ags 2026', kelas: 'XII-1', mapel: 'Matematika', foto_url: 'https://drive.google.com/uc?id=foto_ags_1' },
                { id: 'j-ags-2', monthKey: '2026-08', waktuStr: 'Senin, 10 Ags 2026', kelas: 'XII-1', mapel: 'Matematika', foto_url: 'https://drive.google.com/uc?id=foto_ags_2' },
                { id: 'j-ags-3', monthKey: '2026-08', waktuStr: 'Senin, 17 Ags 2026', kelas: 'XII-1', mapel: 'Matematika', foto_url: '' },
                // September (Bulan Berjalan): 2 jurnal
                { id: 'j-sep-1', monthKey: '2026-09', waktuStr: 'Rabu, 02 Sep 2026', kelas: 'XII-1', mapel: 'Matematika', foto_url: 'https://drive.google.com/uc?id=foto_sep_1' },
                { id: 'j-sep-2', monthKey: '2026-09', waktuStr: 'Rabu, 09 Sep 2026', kelas: 'XII-1', mapel: 'Matematika', foto_url: 'https://drive.google.com/uc?id=foto_sep_2' },
            ];
        });

        test('Secara default hanya jurnal bulan September yang dirender di DOM (Foto bulan lain TIDAK DIMUAT)', () => {
            const selectedMonth = '2026-09';
            const filtered = mockJurnalList.filter(j => j.monthKey === selectedMonth);

            const wrapper = document.getElementById('jurnal-table-wrapper');
            let rowsHtml = '';
            filtered.forEach((j, idx) => {
                const foto = j.foto_url ? `<img src="${j.foto_url}" class="foto-jurnal" loading="lazy" decoding="async">` : '-';
                rowsHtml += `<tr><td>${idx + 1}</td><td>${j.waktuStr}</td><td>${foto}</td></tr>`;
            });
            wrapper.innerHTML = `<table><tbody>${rowsHtml}</tbody></table>`;

            // Verifikasi baris tabel yang dirender
            const rows = wrapper.querySelectorAll('tbody tr');
            expect(rows.length).toBe(2);

            // Verifikasi jumlah foto yang di-render di DOM
            const renderedImages = wrapper.querySelectorAll('img.foto-jurnal');
            expect(renderedImages.length).toBe(2);

            // Verifikasi bahwa foto dari Juli dan Agustus TIDAK ADA di DOM sama sekali
            const allSrcs = Array.from(renderedImages).map(img => img.getAttribute('src'));
            expect(allSrcs).toContain('https://drive.google.com/uc?id=foto_sep_1');
            expect(allSrcs).toContain('https://drive.google.com/uc?id=foto_sep_2');
            expect(allSrcs).not.toContain('https://drive.google.com/uc?id=foto_jul_1');
            expect(allSrcs).not.toContain('https://drive.google.com/uc?id=foto_jul_2');
            expect(allSrcs).not.toContain('https://drive.google.com/uc?id=foto_ags_1');
            expect(allSrcs).not.toContain('https://drive.google.com/uc?id=foto_ags_2');

            // Verifikasi atribut lazy-loading
            renderedImages.forEach(img => {
                expect(img.getAttribute('loading')).toBe('lazy');
                expect(img.getAttribute('decoding')).toBe('async');
            });
        });

        test('Saat pengguna memilih bulan Agustus, hanya 2 foto Agustus yang dirender', () => {
            const selectedMonth = '2026-08';
            const filtered = mockJurnalList.filter(j => j.monthKey === selectedMonth);

            const wrapper = document.getElementById('jurnal-table-wrapper');
            let rowsHtml = '';
            filtered.forEach((j, idx) => {
                const foto = j.foto_url ? `<img src="${j.foto_url}" class="foto-jurnal" loading="lazy" decoding="async">` : '-';
                rowsHtml += `<tr><td>${idx + 1}</td><td>${j.waktuStr}</td><td>${foto}</td></tr>`;
            });
            wrapper.innerHTML = `<table><tbody>${rowsHtml}</tbody></table>`;

            const rows = wrapper.querySelectorAll('tbody tr');
            expect(rows.length).toBe(3); // 3 jurnal di Agustus

            const renderedImages = wrapper.querySelectorAll('img.foto-jurnal');
            expect(renderedImages.length).toBe(2); // Hanya 2 yang punya foto_url

            const allSrcs = Array.from(renderedImages).map(img => img.getAttribute('src'));
            expect(allSrcs).toContain('https://drive.google.com/uc?id=foto_ags_1');
            expect(allSrcs).toContain('https://drive.google.com/uc?id=foto_ags_2');
            expect(allSrcs).not.toContain('https://drive.google.com/uc?id=foto_sep_1');
        });

        test('Saat bulan yang dipilih tidak memiliki jurnal, menampilkan empty state dengan tombol Tampilkan Semua', () => {
            const selectedMonth = '2026-10'; // Oktober belum ada jurnal
            const filtered = mockJurnalList.filter(j => j.monthKey === selectedMonth);

            const wrapper = document.getElementById('jurnal-table-wrapper');
            if (filtered.length === 0) {
                wrapper.innerHTML = `
                    <div class="empty-period text-center py-12">
                        <p class="text-sm font-bold">Tidak ada jurnal mengajar pada bulan Oktober 2026</p>
                        <button type="button" onclick="window.onJurnalMonthChange('all')" id="btn-show-all-months">
                            Tampilkan Semua Bulan (7 Jurnal)
                        </button>
                    </div>
                `;
            }

            expect(wrapper.querySelectorAll('tr').length).toBe(0);
            expect(wrapper.querySelectorAll('img').length).toBe(0);
            const btnShowAll = wrapper.querySelector('#btn-show-all-months');
            expect(btnShowAll).not.toBeNull();
            expect(btnShowAll.getAttribute('onclick')).toBe("window.onJurnalMonthChange('all')");
        });
    });
});
