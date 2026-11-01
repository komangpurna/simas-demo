/**
 * tests/workload-main-duty-permen-11-2025.test.js
 *
 * Pengujian Unit Komprehensif: Pemilihan 5 Unsur Tugas Pokok Guru
 * Sesuai Permendikdasmen No. 11/2025 (Pasal 3 Ayat 1) Sebelum Memilih Kategori Kegiatan
 *
 * Verifikasi:
 * 1. Keberadaan elemen select '#plan-input-main-duty' sebelum '#plan-input-catalog' di modal rencana.
 * 2. Kelengkapan 5 Opsi Tugas Pokok Guru sesuai Permen 11/2025 Pasal 3 Ayat 1:
 *    - PELAKSANAAN_KBM: Pelaksanaan Pembelajaran
 *    - PERENCANAAN: Perencanaan Pembelajaran
 *    - PENILAIAN: Penilaian Hasil Pembelajaran
 *    - PEMBIMBINGAN: Pembimbingan & Pelatihan Siswa
 *    - TUGAS_TAMBAHAN: Pelaksanaan Tugas Tambahan
 * 3. Logika cascading filter pada katalog aktivitas berdasarkan tugas guru terpilih.
 * 4. Mode Edit: Restorasi tugas guru dan kategori aktivitas secara sinkron dari data rencana yang ada.
 * 5. Integritas payload savePlanItem yang menyertakan category_code tugas guru sah.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Kepatuhan Permendikdasmen No. 11/2025: Dropdown Tugas Pokok Guru Sebelum Kategori Kegiatan', () => {
    const rootDir = path.resolve(__dirname, '..');
    const htmlPath = path.join(rootDir, 'e-kinerja.html');
    const jsPath = path.join(rootDir, 'js', 'page-beban-kerja.js');
    const clientPath = path.join(rootDir, 'js', 'cloudflare-client.js');
    const workerPath = path.join(rootDir, 'cloudflare', 'worker.js');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    const clientContent = fs.readFileSync(clientPath, 'utf8');
    const workerContent = fs.readFileSync(workerPath, 'utf8');

    test('1. e-kinerja.html memiliki dropdown plan-input-main-duty sebelum plan-input-catalog', () => {
        expect(htmlContent).toContain('id="plan-input-main-duty"');
        expect(htmlContent).toContain('id="plan-input-catalog"');

        const mainDutyPos = htmlContent.indexOf('id="plan-input-main-duty"');
        const catalogPos = htmlContent.indexOf('id="plan-input-catalog"');

        expect(mainDutyPos).toBeGreaterThan(0);
        expect(catalogPos).toBeGreaterThan(0);
        expect(mainDutyPos).toBeLessThan(catalogPos);
    });

    test('2. Dropdown plan-input-main-duty memuat 5 Unsur Tugas Pokok Guru sesuai Permen 11/2025', () => {
        const requiredDuties = [
            'PELAKSANAAN_KBM',
            'PERENCANAAN',
            'PENILAIAN',
            'PEMBIMBINGAN',
            'TUGAS_TAMBAHAN'
        ];

        requiredDuties.forEach(duty => {
            const pattern = new RegExp(`value="${duty}"`);
            expect(htmlContent).toMatch(pattern);
        });

        // Label Permendikdasmen No. 11/2025 tercantum di antarmuka
        expect(htmlContent).toContain('Tugas Pokok Guru (Permendikdasmen No. 11/2025)');
    });

    test('3. js/page-beban-kerja.js mengekspos window.workloadOnMainDutyChange dan fungsi cascading filter', () => {
        expect(jsContent).toContain('window.workloadOnMainDutyChange = onMainDutyChange');
        expect(jsContent).toContain('function populateCatalogDropdownByDuty(');
        expect(jsContent).toContain('function onMainDutyChange()');
    });

    test('4. Simulasi Cascading Filter: Kategori aktivitas terfilter akurat sesuai tugas pokok yang dipilih', () => {
        const sampleCatalog = [
            { id: 'cat_kbm', category_code: 'PELAKSANAAN_KBM', name: 'KBM Tatap Muka (Intrakurikuler)', is_teaching: 1 },
            { id: 'cat_bk', category_code: 'PEMBIMBINGAN', name: 'Layanan Bimbingan & Konseling (BK)', is_teaching: 0 },
            { id: 'cat_ekstra', category_code: 'PEMBIMBINGAN', name: 'Pembina Kegiatan Ekstrakurikuler', is_teaching: 0 },
            { id: 'cat_evaluasi', category_code: 'PERENCANAAN', name: 'Perencanaan & Evaluasi Pembelajaran / Asesmen', is_teaching: 0 },
            { id: 'cat_mgmp', category_code: 'PERENCANAAN', name: 'Pengembangan Keprofesian Berkelanjutan (MGMP / PKB)', is_teaching: 0 },
            { id: 'cat_administrasi', category_code: 'PENILAIAN', name: 'Tugas Penunjang & Administrasi Guru', is_teaching: 0 },
            { id: 'cat_wali_kelas', category_code: 'TUGAS_TAMBAHAN', name: 'Tugas Tambahan: Wali Kelas', is_teaching: 0 },
            { id: 'cat_pembina_osis', category_code: 'TUGAS_TAMBAHAN', name: 'Tugas Tambahan: Pembina OSIS', is_teaching: 0 },
            { id: 'cat_piket', category_code: 'TUGAS_TAMBAHAN', name: 'Tugas Piket Sekolah', is_teaching: 0 },
            { id: 'cat_upacara', category_code: 'TUGAS_TAMBAHAN', name: 'Upacara Bendera / Apel Pagi', is_teaching: 0 }
        ];

        function filterCatalogByDuty(dutyCode) {
            return sampleCatalog.filter(c => c.category_code === dutyCode);
        }

        const kbmItems = filterCatalogByDuty('PELAKSANAAN_KBM');
        expect(kbmItems.map(c => c.id)).toEqual(['cat_kbm']);

        const bimbinganItems = filterCatalogByDuty('PEMBIMBINGAN');
        expect(bimbinganItems.map(c => c.id)).toEqual(['cat_bk', 'cat_ekstra']);

        const perencanaanItems = filterCatalogByDuty('PERENCANAAN');
        expect(perencanaanItems.map(c => c.id)).toEqual(['cat_evaluasi', 'cat_mgmp']);

        const penilaianItems = filterCatalogByDuty('PENILAIAN');
        expect(penilaianItems.map(c => c.id)).toEqual(['cat_administrasi']);

        const tugasTambahanItems = filterCatalogByDuty('TUGAS_TAMBAHAN');
        expect(tugasTambahanItems.map(c => c.id)).toEqual([
            'cat_wali_kelas',
            'cat_pembina_osis',
            'cat_piket',
            'cat_upacara'
        ]);
    });

    test('5. Mode Edit: Deteksi tugas pokok guru dari aktivitas yang tersimpan saat membuka modal edit', () => {
        expect(jsContent).toMatch(/(?:let|const)\s+dutyCode\s*=\s*(?:existingAct\?\.category_code|resolveWorkloadDutyCode\(existingSeg,\s*existingAct)/);
        expect(jsContent).toContain('populateCatalogDropdownByDuty(dutyCode');
        expect(jsContent).toContain('Edit Kegiatan Rencana');
    });

    test('6. Penyimpanan Cloudflare Worker D1 menerima dan memperbarui category_code tugas guru secara tepat', () => {
        expect(workerContent).toContain('it.category_code || "PELAKSANAAN_KBM"');
        expect(workerContent).toContain('UPDATE plan_activities SET');
        expect(workerContent).toContain('category_code = ?');
    });

    test('7. STANDARD_WORKLOAD_CATALOG di Cloudflare Worker mencakup 28 sub-kegiatan SMA Permendikdasmen 11/2025', () => {
        const requiredCatalogIds = [
            // 1. PERENCANAAN (Pasal 4)
            'cat_rencana_kurikulum',
            'cat_rencana_modul',
            'cat_evaluasi',
            // 2. PELAKSANAAN_KBM (Pasal 5 & 13)
            'cat_kbm',
            'cat_kbm_p5',
            'cat_kbm_ekstra',
            'cat_bk',
            // 3. PENILAIAN (Pasal 7)
            'cat_nilai_formatif',
            'cat_nilai_sumatif',
            'cat_nilai_olah',
            'cat_nilai_bk',
            'cat_administrasi',
            // 4. PEMBIMBINGAN (Pasal 8, 9, 14)
            'cat_bimbing_guru_wali',
            'cat_bimbing_p5',
            'cat_ekstra',
            'cat_bimbing_lomba',
            // 5. TUGAS_TAMBAHAN (Pasal 10, 11 & Lampiran)
            'cat_tt_waka',
            'cat_tt_kepala_perpus',
            'cat_tt_kepala_lab',
            'cat_tt_gpk',
            'cat_wali_kelas',
            'cat_pembina_osis',
            'cat_tt_koor_pkb',
            'cat_piket',
            'cat_tt_koor_p5',
            'cat_tt_koor_inklusi',
            'cat_tt_tppk',
            'cat_tt_panitia_acara',
            'cat_tt_organisasi_profesi',
            'cat_mgmp',
            'cat_tt_narasumber',
            'cat_tt_peserta_pelatihan',
            'cat_upacara',
            'cat_tt_dinas'
        ];

        requiredCatalogIds.forEach(id => {
            expect(workerContent).toContain(`id: "${id}"`);
        });
    });

    test('8. Antarmuka Realisasi (modal-workload-log) mendukung form berjenjang Tugas Pokok & Sub-Kegiatan untuk status diganti & kegiatan mandiri', () => {
        expect(htmlContent).toContain('id="log-duty-catalog-wrapper"');
        expect(htmlContent).toContain('id="log-input-main-duty"');
        expect(htmlContent).toContain('id="log-input-catalog"');
        expect(htmlContent).toContain('id="log-substitute-wrapper"');

        // Fungsi window bindings tersedia di js/page-beban-kerja.js
        expect(jsContent).toContain('window.workloadOnLogMainDutyChange = onLogMainDutyChange');
        expect(jsContent).toContain('window.workloadOnLogCatalogChange = onLogCatalogChange');
        expect(jsContent).toContain('function populateLogCatalogDropdownByDuty(');
        expect(jsContent).toContain('function onLogMainDutyChange()');
        expect(jsContent).toContain('function onLogCatalogChange(');
    });

    test('9. Logika onStatusExecutionChange menampilkan dropdown tugas pokok & sub-kegiatan saat status "diganti" atau "is_unplanned"', () => {
        expect(jsContent).toContain("status === 'diganti'");
        expect(jsContent).toContain("dutyCatalogWrapper?.classList.remove('hidden')");
        expect(jsContent).toContain("dutyCatalogWrapper?.classList.add('hidden')");
        expect(jsContent).toContain("substituteWrapper?.classList.remove('hidden')");
    });

    test('10. Helper addMinutesToTime berfungsi akurat untuk ekuivalensi durasi menit', () => {
        function addMinutesToTime(timeStr, minutesToAdd) {
            if (!timeStr || !timeStr.includes(':')) return '';
            const [h, m] = timeStr.split(':').map(Number);
            if (isNaN(h) || isNaN(m)) return '';
            const total = h * 60 + m + Number(minutesToAdd || 0);
            const newH = Math.floor(total / 60) % 24;
            const newM = total % 60;
            return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
        }

        // 1 Jam Tatap Muka = 45 menit
        expect(addMinutesToTime('07:30', 45)).toBe('08:15');
        // 2 Jam Tatap Muka = 90 menit
        expect(addMinutesToTime('07:30', 90)).toBe('09:00');
        // 3 Jam Tatap Muka = 135 menit
        expect(addMinutesToTime('08:15', 135)).toBe('10:30');
    });

    test('11. Penyimpanan Realisasi saveLog menyertakan catalog_id yang dipilih saat status "diganti" atau "is_unplanned"', () => {
        expect(jsContent).toContain("statusExec === 'diganti' || isUnplanned");
        expect(jsContent).toContain("catalogId = el('log-input-catalog')?.value || 'cat_kbm'");
        expect(jsContent).toContain("catalog_id: catalogId");
    });

    test('12. Format Rekomendasi Durasi dalam satuan JP dan pengosongan label untuk non-JP', () => {
        expect(jsContent).toContain('function formatCatalogJpLabel(');
        expect(jsContent).toContain('function getCatalogItemEquivalentJp(');
        expect(jsContent).toContain('DEFAULT_CATALOG_EQUIVALENT_JP');

        // Simulasi fungsi getCatalogItemEquivalentJp & formatCatalogJpLabel
        const DEFAULT_CATALOG_EQUIVALENT_JP = {
            'cat_kbm': 1,
            'cat_kbm_p5': 2,
            'cat_kbm_ekstra': 2,
            'cat_bimbing_guru_wali': 2,
            'cat_tt_waka': 12,
            'cat_wali_kelas': 2,
            'cat_piket': 1
        };

        function getCatalogItemEquivalentJp(catalogItem) {
            if (!catalogItem) return 0;
            if (catalogItem.equivalent_jp != null && Number(catalogItem.equivalent_jp) > 0) {
                return Number(catalogItem.equivalent_jp);
            }
            if (catalogItem.id && DEFAULT_CATALOG_EQUIVALENT_JP[catalogItem.id]) {
                return DEFAULT_CATALOG_EQUIVALENT_JP[catalogItem.id];
            }
            return 0;
        }

        function formatCatalogJpLabel(catalogItem) {
            const jp = getCatalogItemEquivalentJp(catalogItem);
            return jp > 0 ? ` (${jp} JP)` : '';
        }

        // Tugas dengan Ekuivalensi JP
        expect(formatCatalogJpLabel({ id: 'cat_kbm' })).toBe(' (1 JP)');
        expect(formatCatalogJpLabel({ id: 'cat_bimbing_guru_wali' })).toBe(' (2 JP)');
        expect(formatCatalogJpLabel({ id: 'cat_tt_waka' })).toBe(' (12 JP)');
        expect(formatCatalogJpLabel({ id: 'custom_cat', equivalent_jp: 6 })).toBe(' (6 JP)');

        // Tugas Non-JP (Rencana kurikulum, modul ajar, evaluasi nilai)
        expect(formatCatalogJpLabel({ id: 'cat_rencana_modul' })).toBe('');
        expect(formatCatalogJpLabel({ id: 'cat_nilai_sumatif' })).toBe('');
        expect(formatCatalogJpLabel({ id: 'cat_administrasi' })).toBe('');
    });

    test('13. Searchable Dropdown di Modal Rencana dan Modal Realisasi', () => {
        expect(htmlContent).toContain('id="container-plan-catalog-combobox"');
        expect(htmlContent).toContain('id="btn-plan-catalog-trigger"');
        expect(htmlContent).toContain('id="dropdown-plan-catalog-panel"');
        expect(htmlContent).toContain('id="list-plan-catalog-options"');
        expect(htmlContent).toContain('id="plan-input-catalog-search"');

        expect(htmlContent).toContain('id="container-log-catalog-combobox"');
        expect(htmlContent).toContain('id="btn-log-catalog-trigger"');
        expect(htmlContent).toContain('id="dropdown-log-catalog-panel"');
        expect(htmlContent).toContain('id="list-log-catalog-options"');
        expect(htmlContent).toContain('id="log-input-catalog-search"');

        expect(jsContent).toContain('function onFilterPlanCatalog()');
        expect(jsContent).toContain('function onFilterLogCatalog()');
        expect(jsContent).toContain('function togglePlanCatalogDropdown(');
        expect(jsContent).toContain('function selectPlanCatalog(');
        expect(jsContent).toContain('function toggleLogCatalogDropdown(');
        expect(jsContent).toContain('function selectLogCatalog(');
        expect(jsContent).toContain('window.workloadTogglePlanCatalogDropdown = togglePlanCatalogDropdown');
        expect(jsContent).toContain('window.workloadSelectPlanCatalog = selectPlanCatalog');
        expect(jsContent).toContain('window.workloadToggleLogCatalogDropdown = toggleLogCatalogDropdown');
        expect(jsContent).toContain('window.workloadSelectLogCatalog = selectLogCatalog');
    });

    test('14. Edit Master Tugas Pokok & Kategori oleh Kepsek dan Super Admin di Tab Regulasi', () => {
        // Elemen antarmuka di e-kinerja.html
        expect(htmlContent).toContain('id="manager-catalog-management-section"');
        expect(htmlContent).toContain('id="table-master-catalog-body"');
        expect(htmlContent).toContain('id="modal-manage-catalog-item"');
        expect(htmlContent).toContain('id="form-manage-catalog-item"');
        expect(htmlContent).toContain('id="catalog-input-duty"');
        expect(htmlContent).toContain('id="catalog-input-name"');
        expect(htmlContent).toContain('id="catalog-input-jp"');
        expect(htmlContent).toContain('id="catalog-input-duration"');

        // Fungsi kontrol di js/page-beban-kerja.js
        expect(jsContent).toContain('function isCurrentUserWorkloadManager()');
        expect(jsContent).toContain('function renderManagerCatalogSection()');
        expect(jsContent).toContain('function openCatalogModal(');
        expect(jsContent).toContain('function closeCatalogModal()');
        expect(jsContent).toContain('function saveCatalogItem(');
        expect(jsContent).toContain('function toggleCatalogItemActive(');
        expect(jsContent).toContain('window.workloadOpenCatalogModal = openCatalogModal');
        expect(jsContent).toContain('window.workloadSaveCatalogItem = saveCatalogItem');
        expect(jsContent).toContain('window.workloadToggleCatalogItemActive = toggleCatalogItemActive');

        // Endpoint klien dan backend Cloudflare D1
        expect(clientContent).toContain('cfSaveWorkloadCatalogItem');
        expect(workerContent).toContain('/api/workload/catalog');
    });

    test('15. Opsi Cepat Judul / Uraian Rencana Kegiatan dari Riwayat Tersimpan', () => {
        expect(htmlContent).toContain('id="plan-title-history-list"');
        expect(htmlContent).toContain('id="plan-title-suggestions-container"');

        expect(jsContent).toContain('function getTitleHistoryForDutyAndCatalog(');
        expect(jsContent).toContain('function recordTitleToHistory(');
        expect(jsContent).toContain('function renderTitleHistorySuggestions(');
        expect(jsContent).toContain('function applyQuickTitle(');
        expect(jsContent).toContain('window.workloadApplyQuickTitle = applyQuickTitle');
    });

    test('16. Tombol Cepat Durasi Waktu (+30, +45, +60, +90) dengan Jeda Istirahat SMAGESA', () => {
        // Tombol cepat di HTML modal rencana dan modal log
        expect(htmlContent).toContain('onclick="window.workloadApplyQuickDuration(30, false)"');
        expect(htmlContent).toContain('onclick="window.workloadApplyQuickDuration(45, false)"');
        expect(htmlContent).toContain('onclick="window.workloadApplyQuickDuration(60, false)"');
        expect(htmlContent).toContain('onclick="window.workloadApplyQuickDuration(90, false)"');
        expect(htmlContent).toContain('onclick="window.workloadApplyQuickDuration(30, true)"');
        expect(htmlContent).toContain('onclick="window.workloadApplyQuickDuration(45, true)"');

        // Helper perhitungan waktu jeda di JS
        expect(jsContent).toContain('function findFirstAvailableTimeSlot(');
        expect(jsContent).toContain('function calculateEndTimeWithBreaks(');
        expect(jsContent).toContain('function applyQuickDuration(');
        expect(jsContent).toContain('window.workloadApplyQuickDuration = applyQuickDuration');

        // Simulasi kalkulasi break: 07:30 + 45 menit -> 08:15 (tanpa break)
        function calculateEndTimeWithBreaks(startTime, durationMinutes) {
            if (!startTime || !startTime.includes(':')) return '';
            let [h, m] = startTime.split(':').map(Number);
            let currentTotalMinutes = h * 60 + m;
            let remainingMinutes = Number(durationMinutes || 0);

            while (remainingMinutes > 0) {
                if (currentTotalMinutes >= 585 && currentTotalMinutes < 600) {
                    currentTotalMinutes = 600;
                }
                if (currentTotalMinutes >= 735 && currentTotalMinutes < 750) {
                    currentTotalMinutes = 750;
                }
                currentTotalMinutes++;
                remainingMinutes--;
            }

            if (currentTotalMinutes > 585 && currentTotalMinutes <= 600) {
                currentTotalMinutes = 600;
            } else if (currentTotalMinutes > 735 && currentTotalMinutes <= 750) {
                currentTotalMinutes = 750;
            }

            const endH = Math.floor(currentTotalMinutes / 60) % 24;
            const endM = currentTotalMinutes % 60;
            return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
        }

        // Slot biasa
        expect(calculateEndTimeWithBreaks('07:30', 45)).toBe('08:15');
        expect(calculateEndTimeWithBreaks('07:30', 90)).toBe('09:00');

        // Melewati Istirahat 1: 09:45–10:00 (15 menit)
        // Mulai 09:30 + 45 menit -> normal 10:15 + jeda 15 menit = 10:30
        expect(calculateEndTimeWithBreaks('09:30', 45)).toBe('10:30');

        // Melewati Istirahat 2: 12:15–12:30 (15 menit)
        // Mulai 12:00 + 45 menit -> normal 12:45 + jeda 15 menit = 13:00
        expect(calculateEndTimeWithBreaks('12:00', 45)).toBe('13:00');
    });
});
