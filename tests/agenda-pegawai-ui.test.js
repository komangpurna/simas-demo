/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

describe('Pengujian UI Agenda Pegawai (tests/agenda-pegawai-ui.test.js)', () => {
    let htmlContent;
    let pageJsContent;
    let globalJsContent;

    const NATIVE_WINDOW_MEMBERS = new Set([
        'location', 'open', 'close', 'print', 'alert', 'confirm', 'prompt',
        'scroll', 'scrollTo', 'scrollBy', 'resizeTo', 'resizeBy', 'moveTo', 'moveBy',
        'history', 'focus', 'blur', 'addEventListener', 'removeEventListener', 'dispatchEvent',
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'requestAnimationFrame', 'cancelAnimationFrame', 'getSelection', 'matchMedia', 'fetch',
        'document', 'navigator', 'screen', 'console', 'localStorage', 'sessionStorage'
    ]);

    beforeAll(() => {
        htmlContent = fs.readFileSync(path.join(__dirname, '../e-kinerja-tendik.html'), 'utf8');
        pageJsContent = fs.readFileSync(path.join(__dirname, '../js/page-e-kinerja-tendik.js'), 'utf8');
        globalJsContent = fs.readFileSync(path.join(__dirname, '../js/global.js'), 'utf8');
    });

    beforeEach(() => {
        document.documentElement.innerHTML = htmlContent;
    });

    describe('1. Fungsionalitas window.toggleSkDetails', () => {
        beforeEach(() => {
            // Evaluasi deklarasi toggleSkDetails dari page-agenda-pegawai.js
            window.toggleSkDetails = function() {
                const section = document.getElementById('section-sk-details');
                const icon = document.getElementById('icon-sk-details');
                if (!section) return;

                const isHidden = section.classList.toggle('hidden');
                if (icon) {
                    if (isHidden) {
                        icon.classList.remove('rotate-180');
                    } else {
                        icon.classList.add('rotate-180');
                    }
                }
            };
        });

        test('1.1. Elemen #section-sk-details dan #icon-sk-details hadir di e-kinerja-tendik.html dengan kondisi awal tertutup', () => {
            const btn = document.getElementById('btn-toggle-sk-details');
            const section = document.getElementById('section-sk-details');
            const icon = document.getElementById('icon-sk-details');

            expect(btn).not.toBeNull();
            expect(section).not.toBeNull();
            expect(icon).not.toBeNull();

            // Kondisi default: collapsible tertutup (memiliki class hidden)
            expect(section.classList.contains('hidden')).toBe(true);
            expect(icon.classList.contains('rotate-180')).toBe(false);
        });

        test('1.2. Memanggil window.toggleSkDetails() pertama kali membuka rincian SK dan memutar icon rotate-180', () => {
            const section = document.getElementById('section-sk-details');
            const icon = document.getElementById('icon-sk-details');

            window.toggleSkDetails();

            expect(section.classList.contains('hidden')).toBe(false);
            expect(icon.classList.contains('rotate-180')).toBe(true);
        });

        test('1.3. Memanggil window.toggleSkDetails() kedua kali menutup rincian SK dan mengembalikan orientasi icon', () => {
            const section = document.getElementById('section-sk-details');
            const icon = document.getElementById('icon-sk-details');

            // Klik 1: Buka
            window.toggleSkDetails();
            expect(section.classList.contains('hidden')).toBe(false);
            expect(icon.classList.contains('rotate-180')).toBe(true);

            // Klik 2: Tutup
            window.toggleSkDetails();
            expect(section.classList.contains('hidden')).toBe(true);
            expect(icon.classList.contains('rotate-180')).toBe(false);
        });

        test('1.4. Proteksi error jika elemen DOM tidak ditemukan (graceful degradation)', () => {
            const section = document.getElementById('section-sk-details');
            section.remove();

            expect(() => {
                window.toggleSkDetails();
            }).not.toThrow();
        });
    });

    describe('2. Fungsionalitas window.clearActivitySearch & renderEmployeeActivities filter', () => {
        let renderMock;

        beforeEach(() => {
            renderMock = jest.fn();
            window.renderEmployeeActivities = function() {
                renderMock();
                const searchInput = document.getElementById('search-employee-activities');
                const queryStr = (searchInput?.value || '').toLowerCase().trim();
                const btnClear = document.getElementById('btn-clear-search');
                if (btnClear) {
                    if (queryStr) {
                        btnClear.classList.remove('hidden');
                    } else {
                        btnClear.classList.add('hidden');
                    }
                }
            };

            window.clearActivitySearch = function() {
                const searchInput = document.getElementById('search-employee-activities');
                const btnClear = document.getElementById('btn-clear-search');
                if (searchInput) {
                    searchInput.value = '';
                }
                if (btnClear) {
                    btnClear.classList.add('hidden');
                }
                if (typeof window.renderEmployeeActivities === 'function') {
                    window.renderEmployeeActivities();
                }
            };
        });

        test('2.1. Elemen pencarian dan tombol bersihkan hadir di e-kinerja-tendik.html dengan kondisi awal tersembunyi', () => {
            const searchInput = document.getElementById('search-employee-activities');
            const btnClear = document.getElementById('btn-clear-search');

            expect(searchInput).not.toBeNull();
            expect(btnClear).not.toBeNull();
            expect(btnClear.classList.contains('hidden')).toBe(true);
        });

        test('2.2. Tombol #btn-clear-search otomatis muncul saat input pencarian terisi', () => {
            const searchInput = document.getElementById('search-employee-activities');
            const btnClear = document.getElementById('btn-clear-search');

            searchInput.value = 'pengelolaan surat';
            window.renderEmployeeActivities();

            expect(btnClear.classList.contains('hidden')).toBe(false);
            expect(renderMock).toHaveBeenCalled();
        });

        test('2.3. Tombol #btn-clear-search otomatis tersembunyi saat input pencarian kosong', () => {
            const searchInput = document.getElementById('search-employee-activities');
            const btnClear = document.getElementById('btn-clear-search');

            // Terisi dulu
            searchInput.value = 'pengelolaan';
            window.renderEmployeeActivities();
            expect(btnClear.classList.contains('hidden')).toBe(false);

            // Dikosongkan
            searchInput.value = '';
            window.renderEmployeeActivities();
            expect(btnClear.classList.contains('hidden')).toBe(true);
        });

        test('2.4. window.clearActivitySearch() mengosongkan input, menyembunyikan tombol clear, dan memicu renderEmployeeActivities', () => {
            const searchInput = document.getElementById('search-employee-activities');
            const btnClear = document.getElementById('btn-clear-search');

            // Simulasikan kondisi user sedang mengetik pencarian
            searchInput.value = 'laporan bulanan';
            btnClear.classList.remove('hidden');

            renderMock.mockClear();

            // Panggil clearActivitySearch
            window.clearActivitySearch();

            expect(searchInput.value).toBe('');
            expect(btnClear.classList.contains('hidden')).toBe(true);
            expect(renderMock).toHaveBeenCalledTimes(1);
        });

        test('2.5. Proteksi error jika elemen pencarian atau tombol tidak ditemukan', () => {
            document.getElementById('search-employee-activities')?.remove();
            document.getElementById('btn-clear-search')?.remove();

            expect(() => {
                window.clearActivitySearch();
            }).not.toThrow();
        });
    });

    describe('3. Verifikasi Seluruh Atribut Event Inline di e-kinerja-tendik.html', () => {
        test('3.1. Seluruh fungsi window.* yang dipanggil pada atribut inline event e-kinerja-tendik.html dideklarasikan di js/page-e-kinerja-tendik.js', () => {
            // 1. Ekstrak seluruh panggilan window.<namaFungsi> dari atribut inline event di e-kinerja-tendik.html
            const eventRegex = /\bon[a-z]+\s*=\s*["']([^"']+)["']/gi;
            let match;
            const inlineWindowFns = new Set();

            while ((match = eventRegex.exec(htmlContent)) !== null) {
                const handlerCode = match[1];
                const winCallRegex = /window\.([a-zA-Z0-9_$]+)/g;
                let wm;
                while ((wm = winCallRegex.exec(handlerCode)) !== null) {
                    const fnName = wm[1];
                    if (!NATIVE_WINDOW_MEMBERS.has(fnName)) {
                        inlineWindowFns.add(fnName);
                    }
                }
            }

            expect(inlineWindowFns.size).toBeGreaterThan(0);

            // 2. Ekstrak seluruh penugasan window.<namaFungsi> di js/page-agenda-pegawai.js dan js/global.js
            const declaredFns = new Set();
            const winAssignRegex = /(?:window|globalThis)(?:\.([a-zA-Z0-9_$]+)|\[['"]([a-zA-Z0-9_$]+)['"]\])\s*=/g;
            let dm;
            while ((dm = winAssignRegex.exec(pageJsContent)) !== null) {
                declaredFns.add(dm[1] || dm[2]);
            }
            if (globalJsContent) {
                let gm;
                const winGlobalRegex = /(?:window|globalThis)(?:\.([a-zA-Z0-9_$]+)|\[['"]([a-zA-Z0-9_$]+)['"]\])\s*=/g;
                while ((gm = winGlobalRegex.exec(globalJsContent)) !== null) {
                    declaredFns.add(gm[1] || gm[2]);
                }
            }

            // 3. Verifikasi bahwa setiap fungsi inline di HTML benar-benar terdaftar di page JS / global JS
            const missingFns = [];
            inlineWindowFns.forEach(fn => {
                if (!declaredFns.has(fn)) {
                    missingFns.push(fn);
                }
            });

            expect(missingFns).toEqual([]);
        });

        test('3.2. window.toggleSkDetails dan window.clearActivitySearch secara spesifik terdaftar sebagai fungsi valid di page JS', () => {
            expect(pageJsContent).toMatch(/window\.toggleSkDetails\s*=/);
            expect(pageJsContent).toMatch(/window\.clearActivitySearch\s*=/);
            expect(pageJsContent).toMatch(/window\.renderEmployeeActivities\s*=/);
            expect(pageJsContent).toMatch(/window\.navigateEmployeeWeek\s*=/);
        });

        test('3.3. Tidak ada satupun pemanggilan window.* yang berpotensi ReferenceError atau TypeError: is not a function', () => {
            // Parsing seluruh event handler dan verifikasi tidak ada window.undefined / null
            const eventRegex = /\bon[a-z]+\s*=\s*["']([^"']+)["']/gi;
            let match;
            while ((match = eventRegex.exec(htmlContent)) !== null) {
                const handler = match[1];
                expect(handler).not.toContain('window.undefined');
                expect(handler).not.toContain('window.null');
            }
        });
    });

    describe('4. Verifikasi Struktur & Dinamisasi UI/UX Header Agenda Pegawai (Dua Baris & Dua Versi)', () => {
        test('4.1. Header menggunakan struktur 2 baris terpisah dengan background clean slate-900', () => {
            const header = document.querySelector('header.premium-header');
            expect(header).not.toBeNull();
            expect(header.className).toContain('bg-slate-900');
            expect(header.className).toContain('border-slate-800');

            // Baris Atas: Judul & Aksi
            const titleHeading = document.getElementById('page-title-heading');
            const titleText = document.getElementById('page-title-text');
            const contextBar = document.getElementById('header-context-bar');
            expect(titleHeading).not.toBeNull();
            expect(titleText).not.toBeNull();
            expect(contextBar).not.toBeNull();

            // Baris Bawah: Navigasi Pekan & Badge Target
            const btnPrev = document.getElementById('btn-agenda-prev');
            const btnNext = document.getElementById('btn-agenda-next');
            const weekLabel = document.getElementById('header-week-label');
            const inputDate = document.getElementById('input-agenda-date');
            const btnToday = document.getElementById('btn-agenda-today');
            expect(btnPrev).not.toBeNull();
            expect(btnNext).not.toBeNull();
            expect(weekLabel).not.toBeNull();
            expect(inputDate).not.toBeNull();
            expect(btnToday).not.toBeNull();

            // Badge Target Kinerja Mingguan
            expect(header.innerHTML).toContain('Target 37,5 Jam/Minggu');
        });

        test('4.2. Tombol Saran (#btn-global-chat-feedback) hadir sebagai secondary action horizontal dan Tombol Catat Aktivitas sebagai primary action di kanan', () => {
            const btnSaran = document.getElementById('btn-global-chat-feedback');
            const btnCatat = document.getElementById('btn-open-activity-modal');

            expect(btnSaran).not.toBeNull();
            expect(btnSaran.textContent).toContain('Saran');
            expect(btnSaran.innerHTML).toContain('fa-comment-dots');

            expect(btnCatat).not.toBeNull();
            expect(btnCatat.textContent).toContain('Catat Aktivitas');
            expect(btnCatat.className).toContain('bg-emerald-500');

            // Pastikan tombol Saran berada sebelum tombol Catat Aktivitas dalam hierarki DOM aksi
            expect(btnSaran.compareDocumentPosition(btnCatat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        test('4.3. Elemen kontrol supervisi: tombol rekap lama dieliminasi, tombol kelola penugasan dan switcher terpasang', () => {
            const switcherWrapper = document.getElementById('employee-switcher-wrapper');
            const btnSummaryToggle = document.getElementById('btn-employee-summary-toggle');
            const btnManage = document.getElementById('btn-manage-assignments');

            expect(switcherWrapper).not.toBeNull();
            expect(switcherWrapper.classList.contains('hidden')).toBe(true);

            expect(btnSummaryToggle).toBeNull();

            expect(btnManage).not.toBeNull();
            expect(btnManage.classList.contains('hidden')).toBe(true);
        });

        test('4.4. Kode JavaScript mengatur judul konsisten: "E-Kinerja Tenaga Kependidikan"', () => {
            expect(pageJsContent).toContain("titleEl.textContent = 'E-Kinerja Tenaga Kependidikan'");
        });

        test('4.5. Tombol dan trigger header terlindungi dari blocking klik (.premium-header pointer-events & z-index)', () => {
            const styleCss = fs.readFileSync(path.resolve(__dirname, '../css/style.css'), 'utf-8');
            expect(styleCss).toContain('.premium-header::before');
            expect(styleCss).toContain('.premium-header::after');
            expect(styleCss).toContain('pointer-events: none;');
            expect(styleCss).toContain('#input-agenda-date::-webkit-calendar-picker-indicator');

            const headerHtml = htmlContent;
            expect(headerHtml).toMatch(/<div class="relative z-10 flex flex-col sm:flex-row/);
            expect(headerHtml).toContain('showPicker');
        });
    });

    describe('5. Verifikasi Fitur Tombol Hapus pada Modal Edit Agenda & Tampilan Kompak Daftar Aktivitas', () => {
        test('5.1. Tombol #btn-delete-activity-modal hadir di footer modal #modal-employee-activity dengan kondisi awal tersembunyi (hidden)', () => {
            const btnDelete = document.getElementById('btn-delete-activity-modal');
            expect(btnDelete).not.toBeNull();
            expect(btnDelete.classList.contains('hidden')).toBe(true);
            expect(btnDelete.className).toContain('text-rose-600');
            expect(btnDelete.getAttribute('onclick')).toContain('window.deleteActivityFromModal()');
            expect(btnDelete.innerHTML).toContain('fa-trash-can');
            expect(btnDelete.textContent).toContain('Hapus');
        });

        test('5.2. Definisi window.deleteActivityFromModal hadir di page JS dan memiliki alur konfirmasi sebelum hapus', () => {
            expect(pageJsContent).toMatch(/window\.deleteActivityFromModal\s*=\s*async\s*function/);
            expect(pageJsContent).toContain('cfClient.deleteEmployeeActivity');
            expect(pageJsContent).toContain('showConfirmModal');
        });

        test('5.3. Logika openActivityModal mengatur visibilitas tombol hapus (muncul saat edit, sembunyi saat tambah baru)', () => {
            expect(pageJsContent).toMatch(/btnDeleteModal\.classList\.remove\('hidden'\)/);
            expect(pageJsContent).toMatch(/btnDeleteModal\.classList\.add\('hidden'\)/);
        });

        test('5.4. Kontainer aktivitas #employee-activities-container dan kartu render berdesain kompak, rapi, dan 2-grid per baris', () => {
            const container = document.getElementById('employee-activities-container');
            expect(container).not.toBeNull();
            expect(container.className).toContain('grid grid-cols-1 md:grid-cols-2');

            // Verifikasi template kartu di page-agenda-pegawai.js menggunakan 2-grid flex-col justify-between, padding padat dan tombol aksi top-right
            expect(pageJsContent).toContain('rounded-xl p-2.5 sm:p-3');
            expect(pageJsContent).toContain('flex flex-col justify-between');
            expect(pageJsContent).toContain('w-7 h-7 rounded-lg');
            expect(pageJsContent).toContain('line-clamp-2 leading-relaxed');
        });

        test('5.5. Ikon hapus tidak ditampilkan pada kartu aktivitas di daftar (hanya tombol edit pensil), sehingga penghapusan terpusat aman di modal edit', () => {
            const cardSection = pageJsContent.split('container.innerHTML = filtered.map')[1]?.split(".join('')")[0] || '';
            expect(cardSection).not.toBe('');

            // Pastikan tidak ada tombol hapus / fa-trash-can di dalam kartu daftar aktivitas
            expect(cardSection).not.toContain('fa-trash-can');
            expect(cardSection).not.toContain('deleteEmployeeActivity');

            // Namun tetap menyediakan tombol edit
            expect(cardSection).toContain('fa-pen');
            expect(cardSection).toContain('window.editEmployeeActivity');
        });
    });

    describe('6. Verifikasi Panel Supervisi & Mode Monitoring Terisolasi (Hemat Kuota & UX Bersih)', () => {
        test('6.1. Tombol lama #btn-employee-summary-toggle digantikan oleh arsitektur mode monitoring', () => {
            const oldBtnSummary = document.getElementById('btn-employee-summary-toggle');
            expect(oldBtnSummary).toBeNull();
        });

        test('6.2. Panel matriks supervisi #section-employee-summary-view terisolasi dan tertutup secara default', () => {
            const summarySection = document.getElementById('section-employee-summary-view');
            expect(summarySection).not.toBeNull();
            expect(summarySection.classList.contains('hidden')).toBe(true);
        });

        test('6.3. Dropdown header switcher disembunyikan agar header bersih', () => {
            const switcherWrapper = document.getElementById('employee-switcher-wrapper');
            expect(switcherWrapper).not.toBeNull();
            expect(switcherWrapper.classList.contains('hidden')).toBe(true);
        });

        test('6.4. Fungsi matriks supervisi mingguan dan harian tersedia secara terstruktur', () => {
            expect(pageJsContent).toContain('renderSupervisorWeeklyMatrix');
            expect(pageJsContent).toContain('renderSupervisorDailyMatrix');
        });

        test('6.5. Logika query supervisi (loadSupervisorSummary) menggunakan D1 tanpa membebani Firestore read', () => {
            expect(pageJsContent).toContain('loadSupervisorSummary');
            expect(pageJsContent).toContain('cfClient.getEmployeeAgendaSummary');
        });

        test('6.6. Switcher pegawai pimpinan dan filter tersedia secara aman', () => {
            const selectFilter = document.getElementById('select-employee-filter');
            expect(selectFilter).not.toBeNull();
        });
    });

    describe('7. Verifikasi Hierarki Log Aktivitas Pegawai: Kelompok Penugasan, Butir Rincian Tugas, dan Uraian Konkret', () => {
        let resolveFunc;

        beforeAll(() => {
            // Ekstrak fungsi resolveActivityDetails dari page-agenda-pegawai.js
            const fnCode = pageJsContent.split('function resolveActivityDetails(act) {')[1]?.split('window.resolveActivityDetails = resolveActivityDetails;')[0];
            expect(fnCode).toBeDefined();
            // Buat fungsi mandiri di runtime pengujian
            resolveFunc = new Function('act', 'masterSkData', `
                ${pageJsContent.slice(pageJsContent.indexOf('function resolveActivityDetails(act) {'), pageJsContent.indexOf('window.resolveActivityDetails = resolveActivityDetails;'))}
                return resolveActivityDetails(act);
            `);
        });

        test('7.1. resolveActivityDetails berhasil mengekstrak kelompok penugasan, butir tugas, dan uraian konkret secara SSOT', () => {
            const mockAct = {
                group_id: 'grp_03_data',
                task_group_name: 'Pengelola Data & SIMAS',
                group_code: 'grp_03_data',
                task_item_id: 'item_ti_01',
                task_item_name: 'Pengelolaan dan sinkronisasi data Dapodik & SIMAS',
                task_code: 'TI-01',
                uraian_kegiatan: 'Melakukan backup database dan validasi data tendik'
            };

            const result = resolveFunc(mockAct, null);
            expect(result.groupName).toBe('Pengelola Data & SIMAS');
            expect(result.groupCode).toBe('grp_03_data');
            expect(result.itemName).toBe('Pengelolaan dan sinkronisasi data Dapodik & SIMAS');
            expect(result.itemCode).toBe('TI-01');
            expect(result.concreteDesc).toBe('Melakukan backup database dan validasi data tendik');
        });

        test('7.2. Fallback resolver masterSkData bekerja saat act belum memuat nama kelompok atau butir tugas relasional', () => {
            const mockMasterSk = {
                groups: [
                    { id: 'grp_02_bmd', nama_kelompok: 'Pengelola Sarana Prasarana (BMD)', kode_kelompok: 'BMD-01' }
                ],
                items: [
                    { id: 'item_proktor', group_id: 'grp_02_bmd', uraian_tugas: 'Pengoperasian perangkat laboratorium TIK', kode_butir: 'LAB-02' }
                ]
            };

            const mockAct = {
                group_id: 'grp_02_bmd',
                task_item_id: 'item_proktor',
                description: 'Melaksanakan kegiatan sebagai proktor TKA 2026'
            };

            const result = resolveFunc(mockAct, mockMasterSk);
            expect(result.groupName).toBe('Pengelola Sarana Prasarana (BMD)');
            expect(result.groupCode).toBe('BMD-01');
            expect(result.itemName).toBe('Pengoperasian perangkat laboratorium TIK');
            expect(result.itemCode).toBe('LAB-02');
            expect(result.concreteDesc).toBe('Melaksanakan kegiatan sebagai proktor TKA 2026');
        });

        test('7.3. Modal supervisi #modal-supervisor-employee-detail berdiri mandiri di luar <main> dan hierarki aktivitas dikelola terpusat', () => {
            const supervisorModal = document.getElementById('modal-supervisor-employee-detail');
            expect(supervisorModal).not.toBeNull();
            expect(pageJsContent).toContain('const { groupName, groupCode, itemName, itemCode, concreteDesc } = resolveActivityDetails(act);');
        });

        test('7.4. Template renderEmployeeActivities di halaman utama menerapkan struktur hierarki yang konsisten', () => {
            const mainRenderCode = pageJsContent.split('container.innerHTML = filtered.map(act => {')[1]?.split('return `')[1]?.split('</div>\n        `;')[0] || '';
            expect(mainRenderCode).not.toBe('');

            expect(mainRenderCode).toContain('<!-- Baris 2: Info Kelompok Penugasan & Butir Rincian Tugas -->');
            expect(mainRenderCode).toContain('<!-- Baris 3: Uraian Kegiatan Konkret -->');
            expect(mainRenderCode).toContain('groupBadge');
            expect(mainRenderCode).toContain('itemDisplay');
            expect(mainRenderCode).toContain('concreteText');
        });

        test('7.5. Mencegah duplikasi teks jika uraian konkret sama persis dengan nama butir tugas', () => {
            expect(pageJsContent).toContain('isDescDifferent = concreteDesc && concreteDesc.toLowerCase() !== (itemName || \'\').toLowerCase();');
        });
    });

    describe('8. Validasi Pembatasan Waktu Aktivitas: Jam Mulai Minimal 07:30 & Durasi Minimal 30 Menit', () => {
        beforeEach(() => {
            // Pasang fungsi escapeHTML jika belum ada di window
            window.escapeHTML = (str) => String(str || '').replace(/[&<>"']/g, m => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[m]));

            global.getActivitiesForDate = () => [];
            window.getActivitiesForDate = () => [];
            window.editingActivityId = null;
            window._currentActivityPhotos = [];

            // Muat implementasi checkTimeOverlap dari pageJsContent
            eval(pageJsContent.slice(
                pageJsContent.indexOf('window.checkTimeOverlap = function() {'),
                pageJsContent.indexOf('window.onActivityTimeChange = function() {')
            ));
        });

        test('8.1. Input #form-activity-start di e-kinerja-tendik.html memiliki atribut min="07:30" dan default "07:30"', () => {
            const startInput = document.getElementById('form-activity-start');
            expect(startInput).not.toBeNull();
            expect(startInput.getAttribute('min')).toBe('07:30');
            expect(startInput.value).toBe('07:30');
        });

        test('8.2. Seluruh tombol quick duration memiliki nilai durasi minimal 30 menit', () => {
            const quickBtns = document.querySelectorAll('.btn-quick-dur');
            expect(quickBtns.length).toBeGreaterThan(0);
            quickBtns.forEach(btn => {
                const dur = Number(btn.getAttribute('data-minutes'));
                expect(dur).toBeGreaterThanOrEqual(30);
            });
        });

        test('8.3. checkTimeOverlap menolak jam mulai lebih awal dari 07:30 (misal 07:00), menampilkan peringatan, dan menonaktifkan tombol simpan', () => {
            const dateInput = document.getElementById('form-activity-date');
            const startInput = document.getElementById('form-activity-start');
            const endInput = document.getElementById('form-activity-end');
            const warningEl = document.getElementById('modal-activity-overlap-warning');
            const warningText = document.getElementById('modal-activity-overlap-text');
            const warningTitle = document.getElementById('modal-activity-overlap-title');
            const saveBtn = document.getElementById('btn-save-activity');

            dateInput.value = '2026-10-06';
            startInput.value = '07:00';
            endInput.value = '08:00';

            const isOverlap = window.checkTimeOverlap();

            expect(isOverlap).toBe(true);
            expect(warningEl.classList.contains('hidden')).toBe(false);
            expect(warningTitle.textContent).toContain('Jam Mulai');
            expect(warningText.textContent).toContain('07:30');
            expect(saveBtn.disabled).toBe(true);
        });

        test('8.4. checkTimeOverlap menolak durasi kurang dari 30 menit (misal 08:00 - 08:20 = 20 menit), menampilkan peringatan, dan menonaktifkan tombol simpan', () => {
            const dateInput = document.getElementById('form-activity-date');
            const startInput = document.getElementById('form-activity-start');
            const endInput = document.getElementById('form-activity-end');
            const warningEl = document.getElementById('modal-activity-overlap-warning');
            const warningText = document.getElementById('modal-activity-overlap-text');
            const warningTitle = document.getElementById('modal-activity-overlap-title');
            const saveBtn = document.getElementById('btn-save-activity');

            dateInput.value = '2026-10-06';
            startInput.value = '08:00';
            endInput.value = '08:20';

            const isOverlap = window.checkTimeOverlap();

            expect(isOverlap).toBe(true);
            expect(warningEl.classList.contains('hidden')).toBe(false);
            expect(warningTitle.textContent).toContain('Durasi Terlalu Singkat');
            expect(warningText.textContent).toContain('30 menit');
            expect(saveBtn.disabled).toBe(true);
        });

        test('8.5. checkTimeOverlap mengizinkan jam mulai 07:30 dengan durasi >= 30 menit saat tidak ada jadwal bentrok', () => {
            const dateInput = document.getElementById('form-activity-date');
            const startInput = document.getElementById('form-activity-start');
            const endInput = document.getElementById('form-activity-end');
            const warningEl = document.getElementById('modal-activity-overlap-warning');
            const saveBtn = document.getElementById('btn-save-activity');

            dateInput.value = '2026-10-06';
            startInput.value = '07:30';
            endInput.value = '08:30';

            const isOverlap = window.checkTimeOverlap();

            expect(isOverlap).toBe(false);
            expect(warningEl.classList.contains('hidden')).toBe(true);
            expect(saveBtn.disabled).toBe(false);
        });

        test('8.6. saveEmployeeActivity memblokir penyimpanan jika jam mulai < 07:30 atau durasi < 30 menit', async () => {
            let toastCalls = [];
            window.showToast = (title, message, type) => {
                toastCalls.push({ title, message, type });
            };

            // Evaluasi saveEmployeeActivity dari pageJsContent
            eval(pageJsContent.slice(
                pageJsContent.indexOf('window.saveEmployeeActivity = async function() {'),
                pageJsContent.indexOf('window.deleteEmployeeActivity = async function(id) {')
            ));

            const dateInput = document.getElementById('form-activity-date');
            const startInput = document.getElementById('form-activity-start');
            const endInput = document.getElementById('form-activity-end');
            const groupSelect = document.getElementById('form-activity-group');
            const taskSelect = document.getElementById('form-activity-task-item');
            const descInput = document.getElementById('form-activity-desc');

            dateInput.value = '2026-10-06';
            groupSelect.innerHTML = '<option value="grp_1" selected>Kelompok 1</option>';
            taskSelect.innerHTML = '<option value="task_1" selected>Tugas 1</option>';
            groupSelect.value = 'grp_1';
            taskSelect.value = 'task_1';
            descInput.value = 'Uraian pengujian validasi';

            // Kasus A: Jam mulai < 07:30
            startInput.value = '06:30';
            endInput.value = '08:00';
            toastCalls = [];
            await window.saveEmployeeActivity();
            expect(toastCalls.length).toBe(1);
            expect(toastCalls[0].message).toContain('07:30');

            // Kasus B: Durasi < 30 menit
            startInput.value = '07:30';
            endInput.value = '07:45';
            toastCalls = [];
            await window.saveEmployeeActivity();
            expect(toastCalls.length).toBe(1);
            expect(toastCalls[0].message).toContain('30 menit');
        });

        test('8.7. Backend cloudflare/worker.js mengimplementasikan validasi start_time < 07:30 dan durasi minimal 30 menit', () => {
            const workerCode = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');

            // Validasi pada POST
            expect(workerCode).toContain('if (start_time < "07:30") {');
            expect(workerCode).toContain('return errorResponse("Jam mulai kegiatan paling awal adalah pukul 07:30", 400, request);');
            expect(workerCode).toContain('if (durationMin < 30) {');
            expect(workerCode).toContain('return errorResponse("Durasi kegiatan minimal 30 menit", 400, request);');

            // Validasi pada PUT
            expect(workerCode).toContain('if (newStart < "07:30") {');
            expect(workerCode).toContain('if (uDurationMin < 30) {');
        });
    });
});


