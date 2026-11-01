/**
 * tests/workload-smart-diffing-template.test.js
 * ====================================================================
 * Test Suite: Smart Diffing Saat Menerapkan Template Rutin Mingguan
 * Menguji efisiensi penulisan ke database Cloudflare D1:
 * 1. Butir identik (Exact Match) dilewati tanpa write (0 write ke DB)
 * 2. Butir berbeda pada slot yang sama ditimpa in-place (UPDATE)
 * 3. Butir ber-log (has_log > 0) terlindungi secara mutlak
 * 4. Butir baru di-insert dan butir usang dibersihkan secara atomik (batch)
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Suite Pengujian Smart Diffing Penerapan Template Mingguan', () => {
    const root = path.resolve(__dirname, '..');
    const workerJs = fs.readFileSync(path.join(root, 'cloudflare', 'worker.js'), 'utf8');
    const eKinerjaHtml = fs.readFileSync(path.join(root, 'e-kinerja.html'), 'utf8');
    const pageBebanKerjaJs = fs.readFileSync(path.join(root, 'js', 'page-beban-kerja.js'), 'utf8');

    // =================================================================
    // 1. VERIFIKASI STRUKTUR KODE DI cloudflare/worker.js
    // =================================================================
    test('1. worker.js menerapkan Smart Diffing Engine pada rute apply-template', () => {
        expect(workerJs).toContain('path === "/api/workload/apply-template"');
        expect(workerJs).toContain('Smart Diffing Engine');
        expect(workerJs).toContain('exactSlotSeg');
        expect(workerJs).toContain('isExactContent');
        expect(workerJs).toContain('handledSegmentIds');
        expect(workerJs).toContain('matchedActivityIds');
    });

    test('2. worker.js menggunakan env.DB.batch untuk eksekusi atomik mutasi database', () => {
        expect(workerJs).toContain('batchStatements = []');
        expect(workerJs).toContain('await env.DB.batch(batchStatements);');
    });

    test('3. worker.js mengembalikan metadata statistik cerdas pada respon JSON', () => {
        expect(workerJs).toContain('inserted_count: insertedCount');
        expect(workerJs).toContain('updated_count: updatedCount');
        expect(workerJs).toContain('skipped_count: skippedCount');
        expect(workerJs).toContain('deleted_count: deletedCount');
        expect(workerJs).toContain('replaced_count: totalReplaced');
    });

    test('4. worker.js tetap mematuhi prinsip anti-bentrok & proteksi log', () => {
        expect(workerJs).toContain('exactSlotSeg.has_log > 0');
        expect(workerJs).toContain('await performDeduplicatePlanWl(env.DB, plan_version_id, work_week_id);');
    });

    // =================================================================
    // 2. SIMULASI ALGORITMA SMART DIFFING SECARA FUNGSIONAL
    // =================================================================
    function runSmartDiffingSimulation({ tItems, existingSegs, replaceExisting = true }) {
        const batchStatements = [];
        const handledSegmentIds = new Set();
        const matchedActivityIds = new Set();
        let insertedCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        let deletedCount = 0;

        for (const ti of tItems) {
            const dateStr = ti.date;
            const targetCatalogId = ti.catalog_id || "cat_kbm";
            const targetTitle = (ti.title || "").trim();
            const targetJp = Number(ti.jp_count || 0);
            const targetIsTeaching = ti.is_teaching ? 1 : 0;
            const targetDesc = (ti.description || "").trim();

            const exactSlotSeg = existingSegs.find(s =>
                !handledSegmentIds.has(s.segment_id) &&
                s.date === dateStr &&
                s.start_time === ti.start_time &&
                s.end_time === ti.end_time
            );

            if (exactSlotSeg) {
                const isExactContent = (exactSlotSeg.title || "").trim() === targetTitle &&
                    (exactSlotSeg.catalog_id || "cat_kbm") === targetCatalogId &&
                    Number(exactSlotSeg.jp_count || 0) === targetJp &&
                    (exactSlotSeg.is_teaching ? 1 : 0) === targetIsTeaching;

                if (isExactContent) {
                    handledSegmentIds.add(exactSlotSeg.segment_id);
                    matchedActivityIds.add(exactSlotSeg.activity_id);
                    skippedCount++;
                    continue;
                }

                if (exactSlotSeg.has_log > 0) {
                    handledSegmentIds.add(exactSlotSeg.segment_id);
                    matchedActivityIds.add(exactSlotSeg.activity_id);
                    skippedCount++;
                    continue;
                }

                handledSegmentIds.add(exactSlotSeg.segment_id);
                matchedActivityIds.add(exactSlotSeg.activity_id);
                batchStatements.push({ type: 'UPDATE_ACTIVITY', id: exactSlotSeg.activity_id, title: targetTitle });
                batchStatements.push({ type: 'UPDATE_SEGMENT', id: exactSlotSeg.segment_id });
                updatedCount++;
                continue;
            }

            const overlappingSegs = existingSegs.filter(s =>
                !handledSegmentIds.has(s.segment_id) &&
                s.date === dateStr &&
                s.start_time < ti.end_time &&
                ti.start_time < s.end_time
            );

            if (!replaceExisting) {
                if (overlappingSegs.length > 0) {
                    skippedCount++;
                    continue;
                }
            } else {
                const hasLoggedOverlap = overlappingSegs.some(s => s.has_log > 0);
                if (hasLoggedOverlap) {
                    skippedCount++;
                    continue;
                }
                for (const olSeg of overlappingSegs) {
                    handledSegmentIds.add(olSeg.segment_id);
                    batchStatements.push({ type: 'DELETE_SEGMENT', id: olSeg.segment_id });
                    deletedCount++;
                }
            }

            batchStatements.push({ type: 'INSERT_ACTIVITY', title: targetTitle });
            batchStatements.push({ type: 'INSERT_SEGMENT', date: dateStr });
            insertedCount++;
        }

        if (replaceExisting) {
            for (const s of existingSegs) {
                if (!handledSegmentIds.has(s.segment_id) && s.has_log === 0) {
                    handledSegmentIds.add(s.segment_id);
                    batchStatements.push({ type: 'DELETE_SEGMENT', id: s.segment_id });
                    deletedCount++;
                }
            }
            batchStatements.push({ type: 'CLEANUP_ORPHAN_ACTIVITIES' });
        }

        return {
            batchStatements,
            skippedCount,
            updatedCount,
            insertedCount,
            deletedCount
        };
    }

    test('5. Skenario Jadwal Identik Penuh: 0 write ke DB (100% dilewati)', () => {
        // Buat 30 butir template rutin
        const tItems = [];
        const existingSegs = [];
        for (let i = 0; i < 30; i++) {
            const day = Math.floor(i / 6) + 1;
            const hour = 7 + (i % 6);
            const start_time = `${String(hour).padStart(2, '0')}:00`;
            const end_time = `${String(hour + 1).padStart(2, '0')}:00`;
            const date = `2026-10-${12 + day}`;
            const title = `KBM Kelas XII-${i % 3 + 1}`;

            tItems.push({
                date,
                day_of_week: day,
                start_time,
                end_time,
                title,
                catalog_id: 'cat_kbm',
                jp_count: 2,
                is_teaching: 1
            });

            existingSegs.push({
                segment_id: `seg_${i}`,
                activity_id: `act_${i}`,
                date,
                day_of_week: day,
                start_time,
                end_time,
                title,
                catalog_id: 'cat_kbm',
                jp_count: 2,
                is_teaching: 1,
                has_log: 0
            });
        }

        const result = runSmartDiffingSimulation({ tItems, existingSegs, replaceExisting: true });

        // Semua butir sama persis: 30 butir dilewati, 0 insert, 0 update, 0 delete segmen
        expect(result.skippedCount).toBe(30);
        expect(result.updatedCount).toBe(0);
        expect(result.insertedCount).toBe(0);
        expect(result.deletedCount).toBe(0);
        // Hanya statement cleanup orphan activities standar jika ada, tanpa ada delete/insert segmen
        const mutatingStatements = result.batchStatements.filter(s => s.type !== 'CLEANUP_ORPHAN_ACTIVITIES');
        expect(mutatingStatements.length).toBe(0);
    });

    test('6. Skenario Pembaruan Sedikit Jadwal: Hanya UPDATE pada slot yang berubah, sisanya dilewati', () => {
        const tItems = [
            { date: '2026-10-12', start_time: '07:30', end_time: '09:00', title: 'KBM Kimia', catalog_id: 'cat_kbm', jp_count: 2, is_teaching: 1 },
            { date: '2026-10-12', start_time: '09:15', end_time: '10:45', title: 'KBM Fisika', catalog_id: 'cat_kbm', jp_count: 2, is_teaching: 1 },
            { date: '2026-10-13', start_time: '07:30', end_time: '09:00', title: 'KBM Biologi', catalog_id: 'cat_kbm', jp_count: 2, is_teaching: 1 }
        ];

        // Eksisting: Senin 07:30-09:00 adalah KBM Matematika (berbeda judul), sedangkan 2 slot lainnya sama persis
        const existingSegs = [
            { segment_id: 'seg_1', activity_id: 'act_1', date: '2026-10-12', start_time: '07:30', end_time: '09:00', title: 'KBM Matematika', catalog_id: 'cat_kbm', jp_count: 2, is_teaching: 1, has_log: 0 },
            { segment_id: 'seg_2', activity_id: 'act_2', date: '2026-10-12', start_time: '09:15', end_time: '10:45', title: 'KBM Fisika', catalog_id: 'cat_kbm', jp_count: 2, is_teaching: 1, has_log: 0 },
            { segment_id: 'seg_3', activity_id: 'act_3', date: '2026-10-13', start_time: '07:30', end_time: '09:00', title: 'KBM Biologi', catalog_id: 'cat_kbm', jp_count: 2, is_teaching: 1, has_log: 0 }
        ];

        const result = runSmartDiffingSimulation({ tItems, existingSegs, replaceExisting: true });

        expect(result.skippedCount).toBe(2);
        expect(result.updatedCount).toBe(1);
        expect(result.insertedCount).toBe(0);
        expect(result.deletedCount).toBe(0);

        const updateAct = result.batchStatements.find(s => s.type === 'UPDATE_ACTIVITY');
        expect(updateAct).toBeDefined();
        expect(updateAct.id).toBe('act_1');
        expect(updateAct.title).toBe('KBM Kimia');
    });

    test('7. Skenario Proteksi Log Realisasi: Slot ber-log (has_log > 0) tidak ditimpa oleh template', () => {
        const tItems = [
            { date: '2026-10-12', start_time: '07:30', end_time: '09:00', title: 'KBM Kimia Baru', catalog_id: 'cat_kbm', jp_count: 2, is_teaching: 1 }
        ];

        // Segmen eksisting sudah memiliki realisasi log (has_log: 1)
        const existingSegs = [
            { segment_id: 'seg_1', activity_id: 'act_1', date: '2026-10-12', start_time: '07:30', end_time: '09:00', title: 'KBM Kimia Lama', catalog_id: 'cat_kbm', jp_count: 2, is_teaching: 1, has_log: 1 }
        ];

        const result = runSmartDiffingSimulation({ tItems, existingSegs, replaceExisting: true });

        // Wajib dilewati demi menjaga integritas data log realisasi
        expect(result.skippedCount).toBe(1);
        expect(result.updatedCount).toBe(0);
        expect(result.insertedCount).toBe(0);
    });

    // =================================================================
    // 3. VERIFIKASI UI MODAL APPLY TEMPLATE & EFISIENSI KUOTA READ/WRITE
    // =================================================================
    test('8. e-kinerja.html modal apply template tidak memuat radio pilihan manual dan menggunakan input hidden replace', () => {
        expect(eKinerjaHtml).toContain('id="modal-apply-template"');
        expect(eKinerjaHtml).toContain('id="select-apply-template-id"');
        expect(eKinerjaHtml).toContain('name="apply-template-mode"');
        expect(eKinerjaHtml).toContain('value="replace"');
        expect(eKinerjaHtml).not.toContain('type="radio" name="apply-template-mode"');
    });

    test('9. js/page-beban-kerja.js mendeteksi kesamaan identik client-side (0 server call) & proteksi read loadWeek', () => {
        expect(pageBebanKerjaJs).toContain('effectiveTemplateItems.length > 0 && existingSegs.length === effectiveTemplateItems.length');
        expect(pageBebanKerjaJs).toContain('showToast(\'Rencana kerja minggu ini sudah sama persis dengan template yang dipilih (hari libur telah dilewati). Seluruh kegiatan dipertahankan tanpa perubahan database.\', \'info\');');
        expect(pageBebanKerjaJs).toContain('const hasMutations = !stat ||');
        expect(pageBebanKerjaJs).toContain('if (hasMutations) {\n            await loadWeek();\n        }');
    });
});
