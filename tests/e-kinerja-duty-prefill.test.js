/**
 * Unit Test: Verifikasi Resolusi Prefill Tugas Pokok Guru & Auto-Sync Sub-Kegiatan E-Kinerja
 * Sesuai Permendikdasmen No. 11/2025 & Kepmendikdasmen No. 221/P/2025
 * SSOT: js/page-beban-kerja.js & activity_catalog
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Presisi Prefill Tugas Pokok Guru Saat Edit Rencana E-Kinerja', () => {
    const root = path.resolve(__dirname, '..');
    const pageBebanKerjaJsPath = path.join(root, 'js', 'page-beban-kerja.js');
    const pageBebanKerjaJsContent = fs.readFileSync(pageBebanKerjaJsPath, 'utf8');

    // Evaluasi fungsi murni resolveWorkloadDutyCode langsung dari source
    let resolveWorkloadDutyCode;
    beforeAll(() => {
        // Ekstrak fungsi resolveWorkloadDutyCode menggunakan new Function
        const match = pageBebanKerjaJsContent.match(/export function resolveWorkloadDutyCode\([\s\S]*?\n\}/);
        expect(match).not.toBeNull();
        const funcBody = match[0].replace(/^export\s+/, '');
        const code = `${funcBody}; return resolveWorkloadDutyCode;`;
        resolveWorkloadDutyCode = new Function(code)();
    });

    test('1. resolveWorkloadDutyCode memprioritaskan katalog resmi sebagai SSOT (Perencanaan)', () => {
        const seg = { id: 'seg-1', catalog_id: 'cat_rencana_modul', category_code: 'A' };
        const act = { id: 'act-1', catalog_id: 'cat_rencana_modul', category_code: 'A' };
        const standardCatalog = [
            { id: 'cat_rencana_modul', category_code: 'PERENCANAAN', name: 'Pembuatan Modul Ajar' }
        ];

        const duty = resolveWorkloadDutyCode(seg, act, [], standardCatalog, false);
        expect(duty).toBe('PERENCANAAN');
    });

    test('2. resolveWorkloadDutyCode memprioritaskan katalog resmi untuk Penilaian & Evaluasi', () => {
        const seg = { id: 'seg-2', catalog_id: 'cat_nilai_sumatif', category_code: 'A' };
        const standardCatalog = [
            { id: 'cat_nilai_sumatif', category_code: 'PENILAIAN', name: 'Pelaksanaan Asesmen Sumatif' }
        ];

        const duty = resolveWorkloadDutyCode(seg, null, [], standardCatalog, false);
        expect(duty).toBe('PENILAIAN');
    });

    test('3. resolveWorkloadDutyCode mengabaikan nilai legacy "A" dan menyembuhkan data secara otomatis', () => {
        const seg = { id: 'seg-3', catalog_id: 'cat_tt_waka_kurikulum', category_code: 'A' };
        const standardCatalog = [
            { id: 'cat_tt_waka_kurikulum', category_code: 'TUGAS_TAMBAHAN', name: 'Waka Kurikulum' }
        ];

        const duty = resolveWorkloadDutyCode(seg, null, standardCatalog, [], false);
        expect(duty).toBe('TUGAS_TAMBAHAN');
    });

    test('4. resolveWorkloadDutyCode memetakan Pembimbingan & Konseling dengan tepat', () => {
        const seg = { id: 'seg-4', catalog_id: 'cat_bimbing_wali', category_code: null };
        const standardCatalog = [
            { id: 'cat_bimbing_wali', category_code: 'PEMBIMBINGAN', name: 'Pendampingan Murid Dampingan' }
        ];

        const duty = resolveWorkloadDutyCode(seg, null, standardCatalog, [], false);
        expect(duty).toBe('PEMBIMBINGAN');
    });

    test('5. resolveWorkloadDutyCode fallback aman ke PELAKSANAAN_KBM jika segmen bertipe pengajaran', () => {
        const seg = { id: 'seg-5', catalog_id: 'custom_cat', is_teaching: 1 };
        const duty = resolveWorkloadDutyCode(seg, null, [], [], false);
        expect(duty).toBe('PELAKSANAAN_KBM');
    });

    test('6. resolveWorkloadDutyCode fallback ke PERENCANAAN pada Hari Belajar Guru jika bukan KBM', () => {
        const seg = { id: 'seg-6', catalog_id: 'unknown_cat', is_teaching: 0 };
        const duty = resolveWorkloadDutyCode(seg, null, [], [], true);
        expect(duty).toBe('PERENCANAAN');
    });

    test('7. openPlanItemModal mengintegrasikan resolveWorkloadDutyCode untuk prefill dutySelect', () => {
        expect(pageBebanKerjaJsContent).toContain('const dutyCode = resolveWorkloadDutyCode(existingSeg, existingAct, _catalog, STANDARD_WORKLOAD_CATALOG, isStudyDay);');
        expect(pageBebanKerjaJsContent).toContain('if (dutySelect) dutySelect.value = dutyCode;');
    });

    test('8. selectPlanCatalog menyinkronkan plan-input-main-duty saat memilih sub-kegiatan', () => {
        expect(pageBebanKerjaJsContent).toContain('catItem && catItem.category_code && WORKLOAD_MAIN_DUTY_CONFIG[catItem.category_code]');
        expect(pageBebanKerjaJsContent).toContain('dutySelect.value = catItem.category_code;');
    });

    test('9. savePlanItem menyelaraskan category_code dengan sub-kegiatan katalog yang dipilih', () => {
        expect(pageBebanKerjaJsContent).toContain('const selectedCatId = catSelect?.value || \'cat_kbm\';');
        expect(pageBebanKerjaJsContent).toContain('const resolvedDuty = (selectedCatItem && WORKLOAD_MAIN_DUTY_CONFIG[selectedCatItem.category_code])');
        expect(pageBebanKerjaJsContent).toContain('category_code: resolvedDuty');
    });

    test('10. window.workloadResolveDutyCode diekspos secara global', () => {
        expect(pageBebanKerjaJsContent).toContain('window.workloadResolveDutyCode = resolveWorkloadDutyCode;');
    });
});
