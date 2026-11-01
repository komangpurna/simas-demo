/**
 * tests/workload-kbm-sync-gate.test.js
 *
 * Kunci penyusunan rencana E-Kinerja Guru sebelum Sinkron KBM:
 * 1. Slot rencana (tambah item, MGMP cepat, template) terkunci sampai jadwal KBM disinkron (pimpinan dikecualikan)
 * 2. KBM manual wajib memilih Mapel & Kelas dari jadwal -> judul "KBM {Mapel} ({Kelas})" (cocok dengan Jurnal Mengajar)
 * 3. Terapkan Template tidak menghapus/menimpa KBM hasil Sinkron KBM
 */

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(rootDir, 'js', 'page-beban-kerja.js'), 'utf8');
const html = fs.readFileSync(path.join(rootDir, 'e-kinerja.html'), 'utf8');
const worker = fs.readFileSync(path.join(rootDir, 'cloudflare', 'worker.js'), 'utf8');

function extractFunction(src, signature) {
    const start = src.indexOf(signature);
    if (start < 0) throw new Error('Fungsi tidak ditemukan: ' + signature);
    const end = src.indexOf('\n}\n', start);
    return src.slice(start, end + 2).replace(/^export /, '');
}

describe('Kunci Sinkron KBM sebelum menyusun rencana', () => {
    test('1. Pembuka modal tambah item terkunci sampai sinkron, item lama tetap dapat disunting', () => {
        expect(js).toContain('if (!existingId && !requireKbmSyncBeforePlanning()) return false;');
        expect(js).toContain('if (!openPlanItemModal(targetDay, null, start, end)) return;');
    });

    test('2. Simpan item baru & terapkan template juga diperiksa ulang', () => {
        expect(js).toContain('if (!existingId && !requireKbmSyncBeforePlanning()) return;');
        const applyFn = js.slice(js.indexOf('function openApplyTemplateModal()'), js.indexOf("const modal = el('modal-apply-template');"));
        expect(applyFn).toContain('if (!requireKbmSyncBeforePlanning()) return;');
    });

    test('3. Status sinkron: pimpinan dikecualikan, item ber-schedule_occurrence_id, atau penanda lokal per pekan', () => {
        const fn = extractFunction(js, 'export function isPlanKbmSyncSatisfied()');
        expect(fn).toContain('if (isCurrentUserWorkloadManager()) return true;');
        expect(fn).toContain('if (hasSyncedScheduleSegments(_weekData?.segments)) return true;');
        expect(fn).toContain('KBM_SYNC_FLAG_PREFIX');
    });

    test('4. Penanda sinkron dipasang saat sinkron berhasil atau seluruh jadwal sudah ada di rencana', () => {
        expect(js).toContain(`        const res = await cfSyncWorkloadSchedule(payload);
        markKbmSyncedForWeek();`);
        // Slot & banner langsung diperbarui tanpa refresh manual
        const confirmFn = js.slice(js.indexOf('async function confirmSyncSchedule()'), js.indexOf('// ========== TEMPLATE CREATION MODAL'));
        const afterClose = confirmFn.slice(confirmFn.indexOf('closeSyncScheduleModal();\n'));
        expect(afterClose.slice(0, afterClose.indexOf('} catch'))).toContain('await loadWeek();');
        expect(js).toContain(`    if (items.every(it => it.already_in_plan)) {
        markKbmSyncedForWeek();`);
    });

    test('5. Banner pengingat Sinkron KBM tersedia di tab Rencana', () => {
        expect(html).toContain('id="plan-sync-required-banner"');
        expect(js).toContain('function renderPlanSyncRequiredBanner()');
        expect(js).toContain('renderPlanSyncRequiredBanner();');
    });
});

describe('KBM manual wajib pilih Mapel & Kelas dari jadwal', () => {
    const buildKbmTitle = new Function(extractFunction(js, 'export function buildKbmTitle(mapel, className)') + '; return buildKbmTitle;')();
    const parseKbmTitle = new Function(extractFunction(js, 'export function parseKbmTitle(title)') + '; return parseKbmTitle;')();

    test('6. Format judul sama dengan item hasil Sinkron KBM', () => {
        expect(buildKbmTitle('Matematika', 'X-3')).toBe('KBM Matematika (X-3)');
        expect(js).toContain('const title = buildKbmTitle(group.mapel, group.className);');
    });

    test('7. Judul KBM dapat diurai kembali menjadi mapel & kelas', () => {
        expect(parseKbmTitle('KBM Bahasa Indonesia (XI.2)')).toEqual({ mapel: 'Bahasa Indonesia', className: 'XI.2' });
        expect(parseKbmTitle(buildKbmTitle('PJOK', 'XII MIPA 1'))).toEqual({ mapel: 'PJOK', className: 'XII MIPA 1' });
        expect(parseKbmTitle('Rapat MGMP')).toBeNull();
    });

    test('8. Form memiliki pemilih Mapel/Kelas dan penyimpanan menolak KBM tanpa keduanya', () => {
        expect(html).toContain('id="plan-kbm-picker"');
        expect(html).toContain('id="plan-input-kbm-mapel"');
        expect(html).toContain('id="plan-input-kbm-kelas"');
        expect(js).toContain("el('plan-input-title').value = buildKbmTitle(kbmMapel, kbmKelas);");
        expect(js).toContain('titleInputEl.readOnly = isTeaching;');
    });
});

describe('Terapkan Template melindungi KBM hasil Sinkron KBM', () => {
    test('9. Segmen ber-schedule_occurrence_id diperlakukan seperti segmen ber-log (tidak ditimpa/dihapus)', () => {
        const applyBlock = worker.slice(worker.indexOf('path === "/api/workload/apply-template"'), worker.indexOf('path === "/api/workload/deduplicate-plan"'));
        expect(applyBlock).toContain('pa.schedule_occurrence_id,');
        expect(applyBlock).toContain('s.schedule_occurrence_id ? { ...s, has_log: Math.max(1, Number(s.has_log || 0)) } : s');
        // Item template yang sama persis tetap dilewati tanpa write
        expect(applyBlock).toContain('// Skenario 1: Sama persis -> LEWATI (0 write ke DB)');
    });
});
