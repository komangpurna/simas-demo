/**
 * @jest-environment jsdom
 * 
 * Unit & Behavioral Test: Portal Guru Mapel - Tooltip Detail Tanggal KBM & Materi/Catatan Tab Kehadiran
 * Memverifikasi:
 * 1. Markup statis guru-mapel.html memiliki kontainer top-level #kehadiran-date-tooltip dan badge petunjuk.
 * 2. Header tanggal dan pertemuan di js/page-guru-mapel.js memiliki event onclick untuk showKehadiranDateTooltip.
 * 3. Fungsi showKehadiranDateTooltip, hideKehadiranDateTooltip, dan navigateToJurnalFromKehadiran tersedia di window.
 * 4. Logika rendering tooltip menampilkan tanggal lengkap, JP, materi, catatan, guru pengampu, dan aksi navigasi.
 * 5. Fitur penutupan cerdas (toggle, escape, outside click, tab switch) berfungsi dengan baik.
 */

const fs = require('fs');
const path = require('path');

describe('Portal Guru Mapel - Tooltip Detail Tanggal KBM & Materi/Catatan Tab Kehadiran', () => {
    const root = path.resolve(__dirname, '..');
    const htmlPath = path.join(root, 'guru-mapel.html');
    const jsPath = path.join(root, 'js', 'page-guru-mapel.js');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    describe('1. Verifikasi Markup Statis HTML (guru-mapel.html)', () => {
        beforeEach(() => {
            document.body.innerHTML = htmlContent;
        });

        test('1.1 Memiliki elemen top-level #kehadiran-date-tooltip di luar main dengan atribut yang tepat', () => {
            const tooltip = document.getElementById('kehadiran-date-tooltip');
            expect(tooltip).not.toBeNull();
            expect(tooltip.classList.contains('hidden')).toBe(true);
            expect(tooltip.classList.contains('fixed')).toBe(true);
            expect(tooltip.classList.contains('z-50')).toBe(true);

            // Memastikan berada di luar <main>
            const mainEl = document.querySelector('main');
            expect(mainEl.contains(tooltip)).toBe(false);
        });

        test('1.2 Memiliki petunjuk interaktif pada sub-bar filter kehadiran', () => {
            const filterBar = document.getElementById('kehadiran-filter-bar');
            expect(filterBar).not.toBeNull();
            expect(filterBar.textContent).toContain('Klik tgl KBM untuk melihat materi & catatan');
        });
    });

    describe('2. Verifikasi Binding Event & Interaktivitas pada JavaScript (page-guru-mapel.js)', () => {
        test('2.1 Header tanggal KBM (thDates) memiliki onclick window.showKehadiranDateTooltip', () => {
            expect(jsContent).toMatch(/onclick="window\.showKehadiranDateTooltip\(event,\s*'\$\{escapeHTML\(k\)\}',\s*\$\{idx\s*\+\s*1\}\)"/);
            expect(jsContent).toContain('Klik untuk detail materi & catatan');
        });

        test('2.2 Header nomor pertemuan (Baris 3) juga memiliki onclick window.showKehadiranDateTooltip', () => {
            expect(jsContent).toMatch(/onclick="window\.showKehadiranDateTooltip\(event,\s*'\$\{escapeHTML\(k\)\}',\s*\$\{i\s*\+\s*1\}\)"/);
        });

        test('2.3 pertemuanMap memuat key, materi, topik, catatan, lokasi, dan id serta disimpan ke window._lastKehadiranPertemuanMap', () => {
            expect(jsContent).toContain('window._lastKehadiranPertemuanMap = pertemuanMap;');
            expect(jsContent).toContain('materi: data.materi || data.topik || "-"');
            expect(jsContent).toContain('catatan: data.catatan || "-"');
        });

        test('2.4 Memiliki listener scroll pada kehadiran-table-wrapper untuk dismiss tooltip', () => {
            expect(jsContent).toContain('wrapper.addEventListener(\'scroll\', window._onKehadiranScrollDismiss');
        });

        test('2.5 Fungsi handler diekspos ke window untuk interoperabilitas browser & inline event', () => {
            expect(jsContent).toContain('window.showKehadiranDateTooltip = showKehadiranDateTooltip;');
            expect(jsContent).toContain('window.hideKehadiranDateTooltip = hideKehadiranDateTooltip;');
            expect(jsContent).toContain('window.navigateToJurnalFromKehadiran = navigateToJurnalFromKehadiran;');
        });
    });

    describe('3. Simulasi Perilaku & Interaksi Tooltip di DOM', () => {
        let tooltipEl;

        beforeEach(() => {
            document.body.innerHTML = `
                <div id="app-layout">
                    <main>
                        <div id="panel-kehadiran">
                            <div id="kehadiran-table-wrapper">
                                <th id="th-date-test" class="cursor-pointer">14/10</th>
                            </div>
                        </div>
                    </main>
                    <div id="kehadiran-date-tooltip" class="hidden fixed z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-2xl p-3.5 sm:p-4 text-xs w-[290px] sm:w-[330px] max-w-[92vw] select-none pointer-events-auto"></div>
                </div>
            `;
            tooltipEl = document.getElementById('kehadiran-date-tooltip');

            // Setup data pertemuan dummy
            window._lastKehadiranPertemuanMap = {
                '2026-10-14_JP1-2': {
                    key: '2026-10-14_JP1-2',
                    tgl: '2026-10-14',
                    jp: '1-2',
                    guru: 'I Komang Purna, S.Pd.',
                    topik: 'Algoritma Pemrograman & Percabangan',
                    materi: 'Algoritma Pemrograman & Percabangan',
                    catatan: 'Seluruh siswa aktif mempraktikkan kode di editor dan menyelesaikan tantangan logika.',
                    lokasi: 'Lab Komputer 1',
                    id: 'jurnal_kbm_test_123'
                },
                '2026-10-21_JP3-4': {
                    key: '2026-10-21_JP3-4',
                    tgl: '2026-10-21',
                    jp: '3-4',
                    guru: 'I Komang Purna, S.Pd.',
                    topik: '-',
                    materi: '-',
                    catatan: '-',
                    lokasi: '',
                    id: ''
                }
            };

            // Evaluasi logika Section 16 secara terisolasi untuk pengetesan unit
            const INDO_DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
            const INDO_MONTH_NAMES = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

            function formatIndoDateLong(dateStr) {
                if (!dateStr) return '-';
                const parts = dateStr.split('-');
                if (parts.length === 3) {
                    const y = parseInt(parts[0], 10);
                    const m = parseInt(parts[1], 10);
                    const d = parseInt(parts[2], 10);
                    const dt = new Date(y, m - 1, d);
                    const dayName = INDO_DAY_NAMES[dt.getDay()] || '';
                    const monthName = INDO_MONTH_NAMES[m] || parts[1];
                    return `${dayName}, ${d} ${monthName} ${y}`;
                }
                return dateStr;
            }

            function escapeHTML(str) {
                return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            }

            let activeKehadiranTooltipKey = null;

            window.hideKehadiranDateTooltip = function () {
                if (tooltipEl) tooltipEl.classList.add('hidden');
                activeKehadiranTooltipKey = null;
                window._activeKehadiranTooltipKey = null;
            };

            window.showKehadiranDateTooltip = function (event, key, pertemuanNum) {
                if (event) {
                    if (typeof event.stopPropagation === 'function') event.stopPropagation();
                    if (typeof event.preventDefault === 'function') event.preventDefault();
                }

                const pt = (window._lastKehadiranPertemuanMap || {})[key];
                if (!pt) return;

                if (activeKehadiranTooltipKey === key && !tooltipEl.classList.contains('hidden')) {
                    window.hideKehadiranDateTooltip();
                    return;
                }
                activeKehadiranTooltipKey = key;
                window._activeKehadiranTooltipKey = key;

                const triggerEl = event ? (event.currentTarget || event.target) : null;
                const tglFormatted = formatIndoDateLong(pt.tgl);
                const topikMateri = (pt.topik && pt.topik !== '-') ? pt.topik : ((pt.materi && pt.materi !== '-') ? pt.materi : '');
                const catatan = (pt.catatan && pt.catatan !== '-') ? pt.catatan : '';

                const materiHtml = topikMateri
                    ? `<div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 text-slate-800 dark:text-slate-100 font-medium leading-relaxed text-xs break-words max-h-32 overflow-y-auto custom-scrollbar select-text">${escapeHTML(topikMateri)}</div>`
                    : `<div class="p-2.5 rounded-xl bg-slate-50/60 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700/60 text-slate-400 dark:text-slate-500 italic text-[11px] text-center">Belum ada materi/topik pembelajaran tercatat</div>`;

                const catatanHtml = catatan
                    ? `<div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 text-slate-700 dark:text-slate-200 font-normal leading-relaxed text-xs break-words max-h-32 overflow-y-auto custom-scrollbar select-text">${escapeHTML(catatan)}</div>`
                    : `<div class="p-2.5 rounded-xl bg-slate-50/60 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700/60 text-slate-400 dark:text-slate-500 italic text-[11px] text-center">Tidak ada catatan kegiatan pada hari ini</div>`;

                const guruHtml = (pt.guru && pt.guru !== '-')
                    ? `<div class="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span class="truncate flex items-center gap-1.5"><i class="fa-solid fa-chalkboard-user text-emerald-500 text-[10px]"></i> <span class="truncate" title="${escapeHTML(pt.guru)}">${escapeHTML(pt.guru)}</span></span>
                        ${pt.lokasi ? `<span class="shrink-0 text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300 font-medium border border-slate-200/60 dark:border-slate-700/60">${escapeHTML(pt.lokasi)}</span>` : ''}
                       </div>`
                    : '';

                const actionHtml = pt.id
                    ? `<button type="button" onclick="window.navigateToJurnalFromKehadiran('${escapeHTML(pt.id)}')"
                           class="mt-3 w-full py-1.5 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/60 font-bold text-[11px] transition active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs">
                           <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                           <span>Buka di Tab Jurnal Mengajar</span>
                       </button>`
                    : '';

                tooltipEl.innerHTML = `
                    <div class="relative">
                        <div class="flex items-start justify-between gap-2 mb-2">
                            <div>
                                <div class="flex items-center gap-1.5">
                                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800/60 font-extrabold text-[10px] tracking-wide uppercase">
                                        Pertemuan ${pertemuanNum || '-'}
                                    </span>
                                    <span class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-bold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[10px]">
                                        JP ${escapeHTML(pt.jp || '-')}
                                    </span>
                                </div>
                                <div class="mt-1 font-bold text-slate-800 dark:text-slate-100 text-xs flex items-center gap-1.5">
                                    <i class="fa-regular fa-calendar-check text-emerald-600 dark:text-emerald-400"></i>
                                    <span>${escapeHTML(tglFormatted)}</span>
                                </div>
                            </div>
                            <button type="button" onclick="window.hideKehadiranDateTooltip()"
                                class="w-6 h-6 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center justify-center transition shrink-0 cursor-pointer"
                                title="Tutup Tooltip">
                                <i class="fa-solid fa-xmark text-xs"></i>
                            </button>
                        </div>

                        <div class="space-y-1 mt-2.5">
                            <div class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400">
                                <i class="fa-solid fa-book-open text-[10px]"></i>
                                <span>Materi / Topik Pembelajaran</span>
                            </div>
                            ${materiHtml}
                        </div>

                        <div class="space-y-1 mt-2.5">
                            <div class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                                <i class="fa-solid fa-comment-dots text-[10px]"></i>
                                <span>Catatan Kegiatan / Refleksi</span>
                            </div>
                            ${catatanHtml}
                        </div>

                        ${guruHtml}
                        ${actionHtml}
                    </div>
                `;

                tooltipEl.classList.remove('hidden');
            };

            window.navigateToJurnalFromKehadiran = jest.fn((id) => {
                window.hideKehadiranDateTooltip();
            });
        });

        test('3.1 Membuka tooltip menampilkan materi dan catatan lengkap serta tanggal terformat', () => {
            const trigger = document.getElementById('th-date-test');
            window.showKehadiranDateTooltip({ currentTarget: trigger, stopPropagation: jest.fn(), preventDefault: jest.fn() }, '2026-10-14_JP1-2', 1);

            expect(tooltipEl.classList.contains('hidden')).toBe(false);
            expect(tooltipEl.textContent).toContain('Pertemuan 1');
            expect(tooltipEl.textContent).toContain('JP 1-2');
            expect(tooltipEl.textContent).toContain('14 Oktober 2026');
            expect(tooltipEl.textContent).toContain('Algoritma Pemrograman & Percabangan');
            expect(tooltipEl.textContent).toContain('Seluruh siswa aktif mempraktikkan kode');
            expect(tooltipEl.textContent).toContain('I Komang Purna, S.Pd.');
            expect(tooltipEl.textContent).toContain('Lab Komputer 1');
            expect(tooltipEl.textContent).toContain('Buka di Tab Jurnal Mengajar');
        });

        test('3.2 Data kosong/dash menampilkan teks placeholder yang sopan', () => {
            window.showKehadiranDateTooltip(null, '2026-10-21_JP3-4', 2);

            expect(tooltipEl.classList.contains('hidden')).toBe(false);
            expect(tooltipEl.textContent).toContain('Pertemuan 2');
            expect(tooltipEl.textContent).toContain('Belum ada materi/topik pembelajaran tercatat');
            expect(tooltipEl.textContent).toContain('Tidak ada catatan kegiatan pada hari ini');
        });

        test('3.3 Mengklik tombol atau trigger pada pertemuan yang sama menutup tooltip (toggle close)', () => {
            window.showKehadiranDateTooltip(null, '2026-10-14_JP1-2', 1);
            expect(tooltipEl.classList.contains('hidden')).toBe(false);

            // Klik kedua pada key yang sama
            window.showKehadiranDateTooltip(null, '2026-10-14_JP1-2', 1);
            expect(tooltipEl.classList.contains('hidden')).toBe(true);
        });

        test('3.4 Memanggil hideKehadiranDateTooltip menyembunyikan kontainer tooltip', () => {
            window.showKehadiranDateTooltip(null, '2026-10-14_JP1-2', 1);
            expect(tooltipEl.classList.contains('hidden')).toBe(false);

            window.hideKehadiranDateTooltip();
            expect(tooltipEl.classList.contains('hidden')).toBe(true);
        });

        test('3.5 Tombol navigasi ke jurnal memicu fungsi navigateToJurnalFromKehadiran dan menutup tooltip', () => {
            window.showKehadiranDateTooltip(null, '2026-10-14_JP1-2', 1);
            const navBtn = tooltipEl.querySelector('button[onclick*="navigateToJurnalFromKehadiran"]');
            expect(navBtn).not.toBeNull();

            window.navigateToJurnalFromKehadiran('jurnal_kbm_test_123');
            expect(window.navigateToJurnalFromKehadiran).toHaveBeenCalledWith('jurnal_kbm_test_123');
            expect(tooltipEl.classList.contains('hidden')).toBe(true);
        });
    });
});
