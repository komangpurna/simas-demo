/**
 * tests/workload-duty-summary-ssot.test.js
 *
 * Pengujian Unit: SSOT Katalog Kegiatan pada Ringkasan Tugas Pokok Guru
 * Sesuai Permendikdasmen No. 11/2025.
 *
 * Menguji kepatuhan terhadap penemuan masalah:
 * "di rekapan yg aktif perencanaan pembelajaran, tapi kok isinya tugas tambahan?"
 * (Guru Piket & Tugas Kedinasan memiliki legacy category_code 'A', sehingga
 * sebelumnya salah dipetakan ke PERENCANAAN alih-alih TUGAS_TAMBAHAN).
 */

const fs = require('node:fs');
const path = require('node:path');
const {
    calculateDutyAllocationSummary,
    WORKLOAD_DUTIES_CONFIG
} = require('./workload-guru-utils.js');

describe('SSOT Katalog Kegiatan pada Ringkasan Komposisi Tugas Pokok', () => {
    const mockCatalog = [
        {
            id: 'cat_kbm',
            category_code: 'PELAKSANAAN_KBM',
            name: 'KBM Tatap Muka Intrakurikuler'
        },
        {
            id: 'cat_modul_ajar',
            category_code: 'PERENCANAAN',
            name: 'Pembuatan Modul Ajar / RPP / RPL Bimbingan Konseling'
        },
        {
            id: 'cat_penilaian_formatif',
            category_code: 'PENILAIAN',
            name: 'Pelaksanaan & Analisis Penilaian Formatif'
        },
        {
            id: 'cat_pembimbingan_eskul',
            category_code: 'PEMBIMBINGAN',
            name: 'Pembimbingan Ekstrakurikuler / Lomba'
        },
        {
            id: 'cat_piket',
            category_code: 'TUGAS_TAMBAHAN',
            name: 'Guru Piket Sekolah'
        },
        {
            id: 'cat_tt_dinas',
            category_code: 'TUGAS_TAMBAHAN',
            name: 'Tugas Kedinasan / Penugasan Khusus dari Pimpinan (Pasal 19)'
        }
    ];

    describe('1. Resolusi Kategori Segmen dengan Legacy category_code', () => {
        test('Segmen dengan catalog_id tugas tambahan harus masuk TUGAS_TAMBAHAN meskipun memiliki category_code "A"', () => {
            const segments = [
                {
                    id: 'seg_1',
                    catalog_id: 'cat_tt_dinas',
                    category_code: 'A', // Legacy code dari database lama
                    planned_minutes: 270,
                    jp_count: 6,
                    title: 'Tugas Kedinasan / Penugasan Khusus dari Pimpinan (Pasal 19)'
                },
                {
                    id: 'seg_2',
                    catalog_id: 'cat_piket',
                    category_code: 'A', // Legacy code dari database lama
                    planned_minutes: 90,
                    jp_count: 2,
                    title: 'Guru Piket Sekolah'
                },
                {
                    id: 'seg_3',
                    catalog_id: 'cat_modul_ajar',
                    category_code: 'A', // Legacy code dari database lama
                    planned_minutes: 90,
                    jp_count: 2,
                    title: 'Pembuatan Modul Ajar / RPP / RPL Bimbingan Konseling'
                }
            ];

            const summary = calculateDutyAllocationSummary(segments, [], mockCatalog, 2250);

            const perencanaan = summary.duties.find(d => d.code === 'PERENCANAAN');
            const tugasTambahan = summary.duties.find(d => d.code === 'TUGAS_TAMBAHAN');

            expect(perencanaan).toBeDefined();
            expect(tugasTambahan).toBeDefined();

            // PERENCANAAN hanya boleh memuat cat_modul_ajar (90 menit / 2 JP)
            expect(perencanaan.plannedMinutes).toBe(90);
            expect(perencanaan.jpCount).toBe(2);
            expect(perencanaan.categories.length).toBe(1);
            expect(perencanaan.categories[0].id).toBe('cat_modul_ajar');
            expect(perencanaan.categories[0].name).toContain('Modul Ajar');

            // TUGAS_TAMBAHAN harus memuat cat_tt_dinas (270 menit) dan cat_piket (90 menit) = 360 menit / 8 JP
            expect(tugasTambahan.plannedMinutes).toBe(360);
            expect(tugasTambahan.jpCount).toBe(8);
            expect(tugasTambahan.categories.length).toBe(2);

            const ttKeys = tugasTambahan.categories.map(c => c.id);
            expect(ttKeys).toContain('cat_tt_dinas');
            expect(ttKeys).toContain('cat_piket');
        });

        test('Segmen tanpa catalog_id langsung tetapi merujuk activity_id yang memiliki catalog_id tugas tambahan', () => {
            const activities = [
                {
                    id: 'act_piket_ref',
                    catalog_id: 'cat_piket',
                    category_code: 'A',
                    title: 'Piket Sekolah Hari Senin'
                }
            ];

            const segments = [
                {
                    id: 'seg_relasi',
                    activity_id: 'act_piket_ref',
                    category_code: 'A',
                    planned_minutes: 90,
                    jp_count: 2
                }
            ];

            const summary = calculateDutyAllocationSummary(segments, activities, mockCatalog, 2250);
            const tugasTambahan = summary.duties.find(d => d.code === 'TUGAS_TAMBAHAN');
            const perencanaan = summary.duties.find(d => d.code === 'PERENCANAAN');

            expect(tugasTambahan.plannedMinutes).toBe(90);
            expect(tugasTambahan.categories[0].id).toBe('cat_piket');
            expect(perencanaan.plannedMinutes).toBe(0);
        });
    });

    describe('2. Verifikasi File Pekerja Cloudflare & js/workload-calc.js', () => {
        test('js/workload-calc.js memprioritaskan SSOT catalog_id dan tidak memaksa legacy "A" ke PERENCANAAN', () => {
            const calcJsPath = path.resolve(__dirname, '..', 'js', 'workload-calc.js');
            const calcContent = fs.readFileSync(calcJsPath, 'utf8');

            // Memastikan penanganan SSOT katalog ada sebelum pengecekan legacy
            expect(calcContent).toContain('catItem && catItem.category_code && dutyStats[catItem.category_code]');
        });

        test('cloudflare/worker.js pada endpoint apply-template meng-query catalog_category_code dan tidak meng-hardcode "A"', () => {
            const workerPath = path.resolve(__dirname, '..', 'cloudflare', 'worker.js');
            const workerContent = fs.readFileSync(workerPath, 'utf8');

            // Memastikan join dengan activity_catalog
            expect(workerContent).toContain('LEFT JOIN activity_catalog c ON ti.catalog_id = c.id');
            expect(workerContent).toContain('c.category_code AS catalog_category_code');

            // Memastikan penggunaan targetDutyCode alih-alih 'A'
            expect(workerContent).toContain('targetDutyCode');
            expect(workerContent).not.toMatch(/category_code\s*=\s*'A'/);
        });
    });
});
