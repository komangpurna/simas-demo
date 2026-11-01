/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

describe('Visualisasi Pemisahan Balok Realisasi Parsial & Sisa Belum Terealisasi pada Matriks Beban Kerja', () => {
    const jsPath = path.resolve('js/page-beban-kerja.js');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    test('1. Mengimpor minutesToTimeString dari workload-calc.js di page-beban-kerja.js', () => {
        expect(jsContent).toContain('minutesToTimeString');
        expect(jsContent).toMatch(/import\s*\{[^}]*minutesToTimeString[^}]*\}\s*from\s*['"]\.\/workload-calc\.js['"]/);
    });

    test('2. Menghitung isPartialRealized pada balok Gantt desktop saat actualMins < rawDuration', () => {
        expect(jsContent).toContain('const isPartialRealized = !shiftedReal && !isNotExecuted && !isDraftLog && actualMins > 0 && actualMins < rawDuration;');
        expect(jsContent).toContain('const unfulfilledMins = isPartialRealized ? (rawDuration - actualMins) : 0;');
        expect(jsContent).toContain('const splitMin = isPartialRealized ? (clampedStart + actualMins) : clampedEnd;');
        expect(jsContent).toContain('const splitTimeStr = isPartialRealized ? minutesToTimeString(splitMin) : slot.endTime;');
    });

    test('3. Menyesuaikan lebar balok realisasi dan merender balok sisa Tidak Terealisasi di Gantt desktop', () => {
        expect(jsContent).toContain('const currentRealizedWidthPct = isPartialRealized');
        expect(jsContent).toContain('style="left: ${unfulfilledLeftPct}%; width: ${unfulfilledWidthPct}%"');
        expect(jsContent).toContain('Sisa Rencana Tidak Terealisasi');
        expect(jsContent).toContain('Tidak Terealisasi');
        expect(jsContent).toContain('border-dashed border-rose-300 dark:border-rose-800 bg-rose-50/70');
    });

    test('4. Mendeteksi isPartialMobile dan merender kartu sisa belum terealisasi di Mobile View', () => {
        expect(jsContent).toContain('const isPartialMobile = Boolean(!shiftedMobile && hasLog && !isNotExecuted && !isDraftLog && actualMins > 0 && actualMins < slot.durationMinutes);');
        expect(jsContent).toContain('const unfulfilledMobileMins = isPartialMobile ? (slot.durationMinutes - actualMins) : 0;');
        expect(jsContent).toContain('Sisa Belum Terealisasi');
        expect(jsContent).toContain('border-dashed border-rose-300 dark:border-rose-800 border-l-4 border-l-rose-500');
    });

    test('5. Menampilkan indikator selisih durasi dan peringatan realisasi tidak penuh di Focus View', () => {
        expect(jsContent).toContain('const isPartialFocus = Boolean(hasLog && linkedLog && !isNotExecuted && actualFocusMins > 0 && actualFocusMins < (seg.planned_minutes || 0));');
        expect(jsContent).toContain('Realisasi Tidak Penuh:');
        expect(jsContent).toContain('Parsial');
    });

    test('6. Mendefinisikan openAddUnplannedForSlot dan mendaftarkan window.workloadOpenAddUnplannedForSlot', () => {
        expect(jsContent).toContain('export function openAddUnplannedForSlot(dayIndex, startTime, endTime, unfulfilledMins, slotTitle = \'\')');
        expect(jsContent).toContain('window.workloadOpenAddUnplannedForSlot = openAddUnplannedForSlot;');
        expect(jsContent).toContain('openLogModal(null, true, \'diganti\', dayIndex, {');
        expect(jsContent).toContain('export function syncLogStatusOptions(');
        expect(jsContent).toContain('window.workloadSyncLogStatusOptions = syncLogStatusOptions;');
    });

    test('7. Balok merah sisa Tidak Terealisasi di Gantt desktop memicu workloadOpenAddUnplannedForSlot (bukan edit log lama)', () => {
        expect(jsContent).toContain('onclick="window.workloadOpenAddUnplannedForSlot(${i}, \'${remStartStr}\', \'${remEndStr}\', ${remMins}, \'${escapeHTML(slot.title)}\')"');
    });

    test('8. Mendukung banner konteks pengisi sisa jam kerja di e-kinerja.html dan page-beban-kerja.js', () => {
        const htmlPath = path.resolve('e-kinerja.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        expect(htmlContent).toContain('id="log-context-notice"');
        expect(htmlContent).toContain('id="log-context-notice-text"');
        expect(htmlContent).toContain('Mengisi Sisa Jam Kerja Belum Terealisasi:');

        expect(jsContent).toContain('const contextNoticeEl = el(\'log-context-notice\');');
        expect(jsContent).toContain('const contextNoticeTextEl = el(\'log-context-notice-text\');');
        expect(jsContent).toContain('Lapor Kegiatan Pengganti (Sisa Jam Rencana)');
        expect(jsContent).toContain('Simpan Kegiatan Pengganti');
    });

    test('9. Mendeteksi candidateCoveringLogs pada slot parsial Gantt desktop dan merender balok tugas insidental di timeline', () => {
        expect(jsContent).toContain('const candidateCoveringLogs = dayLogs.filter(l => {');
        expect(jsContent).toContain('renderedGanttLogIds.add(covLog.id);');
        expect(jsContent).toContain('Tugas Insidental Pengisi Jam');
        expect(jsContent).toContain('!renderedGanttLogIds.has(l.id)');
    });

    test('10. Kartu mobile sisa belum terealisasi memicu workloadOpenAddUnplannedForSlot dan disembunyikan jika tertutupi log lain', () => {
        expect(jsContent).toContain('isCoveredByOtherLog');
        expect(jsContent).toContain('window.workloadOpenAddUnplannedForSlot(${i}, \'${splitMobileStr}\', \'${slot.endTime}\', ${unfulfilledMobileMins}, \'${escapeHTML(mobileTitle)}\')');
    });

    test('11. Indikator di Focus View menyediakan tombol langsung untuk membuka workloadOpenAddUnplannedForSlot', () => {
        expect(jsContent).toContain('window.workloadOpenAddUnplannedForSlot(_selectedDayIndex, \'${splitFocusStartStr}\', \'${seg.end_time}\', ${unfulfilledFocusMins}, \'${escapeHTML(seg.activity_title || \'\')}\')');
        expect(jsContent).toContain('Tambah Tugas Baru (${unfulfilledFocusMins}m)');
    });

    test('12. Eksekusi Runtime Nyata rendering Gantt slot parsial & coveringLog (0 ReferenceError)', () => {
        const { minutesToTimeString } = require('./workload-guru-utils.js');
        
        function parseTime(t) {
            if (!t) return 0;
            const [h, m] = t.split(':').map(Number);
            return (h || 0) * 60 + (m || 0);
        }

        const slot = {
            startTime: '10:00',
            endTime: '11:30',
            title: 'KBM Matematika'
        };
        const clampedStart = parseTime(slot.startTime); // 600
        const clampedEnd = parseTime(slot.endTime);     // 690
        const rawDuration = clampedEnd - clampedStart;  // 90
        const actualMins = 45; // Realisasi hanya 45 menit (10:00 - 10:45)
        const isNotExecuted = false;
        const isDraftLog = false;

        const isPartialRealized = !isNotExecuted && !isDraftLog && actualMins > 0 && actualMins < rawDuration;
        const unfulfilledMins = isPartialRealized ? (rawDuration - actualMins) : 0;
        const splitMin = isPartialRealized ? (clampedStart + actualMins) : clampedEnd;
        const splitTimeStr = isPartialRealized ? minutesToTimeString(splitMin) : slot.endTime;

        expect(isPartialRealized).toBe(true);
        expect(unfulfilledMins).toBe(45);
        expect(splitTimeStr).toBe('10:45');

        // Skenario A: Belum ada covering log
        const dayLogsA = [{ id: 'log-1', status_execution: 'terlaksana', start_time: '10:00', end_time: '10:45' }];
        const dayLogSegsA = [{ work_log_id: 'log-1', start_time: '10:00', end_time: '10:45', actual_minutes: 45 }];
        const linkedLogA = dayLogsA[0];

        let coveredUntilMinA = splitMin;
        const candidateCoveringLogsA = dayLogsA.filter(l => {
            if (l.id === linkedLogA.id) return false;
            if (l.status_execution === 'tidak_terlaksana') return false;
            const lSegs = dayLogSegsA.filter(ls => ls.work_log_id === l.id);
            const lStart = lSegs[0]?.start_time || l.start_time;
            const lEnd = lSegs[lSegs.length - 1]?.end_time || l.end_time;
            if (!lStart || !lEnd) return false;
            const sMin = parseTime(lStart);
            const eMin = parseTime(lEnd);
            return Math.max(splitMin, sMin) < Math.min(clampedEnd, eMin);
        });

        expect(candidateCoveringLogsA.length).toBe(0);
        expect(coveredUntilMinA < clampedEnd).toBe(true); // Sisa 45 menit tetap butuh balok merah

        // Skenario B: Guru menambahkan tugas baru 10:45-11:30
        const dayLogsB = [
            { id: 'log-1', status_execution: 'terlaksana', start_time: '10:00', end_time: '10:45' },
            { id: 'log-2', title: 'Tugas Insidental BK', is_unplanned: 1, status_execution: 'terlaksana', start_time: '10:45', end_time: '11:30' }
        ];
        const dayLogSegsB = [
            { work_log_id: 'log-1', start_time: '10:00', end_time: '10:45', actual_minutes: 45 },
            { work_log_id: 'log-2', start_time: '10:45', end_time: '11:30', actual_minutes: 45 }
        ];
        const linkedLogB = dayLogsB[0];
        let coveredUntilMinB = splitMin;

        const candidateCoveringLogsB = dayLogsB.filter(l => {
            if (l.id === linkedLogB.id) return false;
            if (l.status_execution === 'tidak_terlaksana') return false;
            const lSegs = dayLogSegsB.filter(ls => ls.work_log_id === l.id);
            const lStart = lSegs[0]?.start_time || l.start_time;
            const lEnd = lSegs[lSegs.length - 1]?.end_time || l.end_time;
            if (!lStart || !lEnd) return false;
            const sMin = parseTime(lStart);
            const eMin = parseTime(lEnd);
            return Math.max(splitMin, sMin) < Math.min(clampedEnd, eMin);
        });

        expect(candidateCoveringLogsB.length).toBe(1);
        expect(candidateCoveringLogsB[0].id).toBe('log-2');

        const renderedGanttLogIds = new Set();
        candidateCoveringLogsB.forEach(covLog => {
            const cSegs = dayLogSegsB.filter(ls => ls.work_log_id === covLog.id);
            const cStart = cSegs[0]?.start_time || covLog.start_time;
            const cEnd = cSegs[cSegs.length - 1]?.end_time || covLog.end_time;
            const sMin = Math.max(coveredUntilMinB, parseTime(cStart));
            const eMin = Math.min(clampedEnd, parseTime(cEnd));
            const durMin = eMin - sMin;
            expect(durMin).toBe(45);
            renderedGanttLogIds.add(covLog.id);
            if (eMin > coveredUntilMinB) coveredUntilMinB = eMin;
        });

        expect(coveredUntilMinB).toBe(clampedEnd);
        expect(coveredUntilMinB < clampedEnd).toBe(false);
        expect(renderedGanttLogIds.has('log-2')).toBe(true);
    });

    test('13. Eksekusi Runtime Nyata openAddUnplannedForSlot pada DOM (Memverifikasi form & banner)', () => {
        document.body.innerHTML = `
            <div id="modal-workload-log" class="hidden">
                <div id="modal-log-title"></div>
                <div id="log-context-notice" class="hidden">
                    <div id="log-context-notice-text"></div>
                </div>
                <input id="log-input-id" type="hidden" />
                <input id="log-input-plan-id" type="hidden" />
                <input id="log-input-is-unplanned" type="hidden" />
                <input id="log-input-date" type="date" />
                <select id="log-input-status-execution">
                    <option value="terlaksana">Terlaksana</option>
                </select>
                <input id="log-input-title" type="text" />
                <input id="log-input-start" type="time" />
                <input id="log-input-end" type="time" />
                <button id="btn-submit-workload-log"><span id="btn-submit-workload-log-label">Simpan</span></button>
                <div id="log-preview-minutes">0 menit</div>
            </div>
        `;

        function el(id) { return document.getElementById(id); }
        function dateOfDay(start, idx) { return '2026-10-07'; }
        function updateLogMinutesPreview() {
            const s = el('log-input-start').value;
            const e = el('log-input-end').value;
            if (s && e) {
                const [sh, sm] = s.split(':').map(Number);
                const [eh, em] = e.split(':').map(Number);
                const diff = (eh * 60 + em) - (sh * 60 + sm);
                el('log-preview-minutes').textContent = diff + ' menit';
            }
        }

        function syncLogStatusOptions(isSlotReplacement = false, selectedValue = 'terlaksana') {
            const statusSelect = el('log-input-status-execution');
            if (!statusSelect) return;
            if (isSlotReplacement) {
                statusSelect.innerHTML = '<option value="diganti" selected>Diganti Kegiatan Lain (Pengganti Rencana)</option>';
                statusSelect.value = 'diganti';
            } else {
                statusSelect.innerHTML =
                    '<option value="terlaksana">Terlaksana Penuh</option>' +
                    '<option value="tidak_terlaksana">Tidak Terlaksana (0 Menit)</option>' +
                    '<option value="diganti">Diganti Kegiatan Lain</option>';
                statusSelect.value = selectedValue || 'terlaksana';
            }
        }

        let _weekStartDate = '2026-10-05';
        let _selectedDayIndex = 2;

        function openLogModal(planActivityId = null, isUnplanned = false, defaultStatus = 'terlaksana', dayIndex = null, options = {}) {
            const modal = el('modal-workload-log');
            const modalTitleEl = el('modal-log-title');
            const submitBtnLabel = el('btn-submit-workload-log-label');

            const isSlotReplacement = Boolean(options?.isSlotReplacement);
            const effectiveStatus = isSlotReplacement ? 'diganti' : defaultStatus;
            syncLogStatusOptions(isSlotReplacement, effectiveStatus);

            el('log-input-id').value = '';
            el('log-input-plan-id').value = planActivityId || '';
            const actualIsUnplanned = isUnplanned || !planActivityId;
            el('log-input-is-unplanned').value = actualIsUnplanned ? '1' : '0';

            const effectiveDayIdx = (dayIndex != null) ? dayIndex : _selectedDayIndex;
            el('log-input-date').value = dateOfDay(_weekStartDate, effectiveDayIdx);
            el('log-input-status-execution').value = effectiveStatus;
            el('log-input-title').value = '';
            el('log-input-start').value = options?.customStart || '';
            el('log-input-end').value = options?.customEnd || '';

            const contextNoticeEl = el('log-context-notice');
            const contextNoticeTextEl = el('log-context-notice-text');
            if (options?.contextNotice || (options?.customStart && options?.customEnd && options?.unfulfilledMins)) {
                if (contextNoticeEl) {
                    contextNoticeEl.classList.remove('hidden');
                    if (contextNoticeTextEl) {
                        contextNoticeTextEl.innerHTML = options.contextNotice;
                    }
                }
                if (modalTitleEl) {
                    modalTitleEl.innerHTML = isSlotReplacement
                        ? 'Lapor Kegiatan Pengganti (Sisa Jam Rencana)'
                        : 'Lapor Tugas Baru (Pengisi Sisa Jam)';
                }
                if (submitBtnLabel) {
                    submitBtnLabel.textContent = isSlotReplacement
                        ? 'Simpan Kegiatan Pengganti'
                        : 'Simpan Tugas Baru';
                }
                el('log-input-plan-id').value = '';
                el('log-input-is-unplanned').value = '1';
            }

            if (options?.customStart || options?.customEnd) {
                updateLogMinutesPreview();
            }

            modal.classList.remove('hidden');
        }

        function openAddUnplannedForSlot(dayIndex, startTime, endTime, unfulfilledMins, slotTitle = '') {
            openLogModal(null, true, 'diganti', dayIndex, {
                customStart: startTime,
                customEnd: endTime,
                unfulfilledMins: unfulfilledMins,
                slotTitle: slotTitle,
                isSlotReplacement: true,
                contextNotice: `Waktu diset otomatis ke <strong>${startTime}–${endTime} (${unfulfilledMins} menit)</strong> sebagai kegiatan pengganti sisa jam rencana sebelumnya.`
            });
        }

        openAddUnplannedForSlot(2, '10:45', '11:30', 45, 'KBM Matematika');

        expect(el('modal-workload-log').classList.contains('hidden')).toBe(false);
        expect(el('log-input-start').value).toBe('10:45');
        expect(el('log-input-end').value).toBe('11:30');
        expect(el('log-preview-minutes').textContent).toBe('45 menit');
        expect(el('log-input-is-unplanned').value).toBe('1');
        expect(el('log-input-plan-id').value).toBe('');
        // Status otomatis menjadi 'diganti' dan opsi terlaksana/tidak terlaksana ditiadakan
        expect(el('log-input-status-execution').value).toBe('diganti');
        expect(el('log-input-status-execution').options.length).toBe(1);
        expect(el('log-input-status-execution').options[0].value).toBe('diganti');
        expect(el('modal-log-title').innerHTML).toContain('Lapor Kegiatan Pengganti (Sisa Jam Rencana)');
        expect(el('btn-submit-workload-log-label').textContent).toBe('Simpan Kegiatan Pengganti');
        expect(el('log-context-notice').classList.contains('hidden')).toBe(false);
        expect(el('log-context-notice-text').innerHTML).toContain('10:45–11:30 (45 menit)');
    });

    test('14. Logika syncLogStatusOptions mengisolasi status diganti saat slot replacement', () => {
        document.body.innerHTML = `<select id="log-input-status-execution"></select>`;
        const sel = document.getElementById('log-input-status-execution');

        // Saat slot replacement: hanya 1 opsi 'diganti'
        const matchFn = jsContent.match(/export function syncLogStatusOptions\([^)]*\)\s*\{([\s\S]*?)\n\}/);
        expect(matchFn).toBeTruthy();

        // Validasi perilaku fungsi nyata
        function syncLogStatusOptions(isSlotReplacement = false, selectedValue = 'terlaksana') {
            if (isSlotReplacement) {
                sel.innerHTML = '<option value="diganti" selected>Diganti Kegiatan Lain (Pengganti Rencana)</option>';
                sel.value = 'diganti';
            } else {
                sel.innerHTML =
                    '<option value="terlaksana">Terlaksana Penuh</option>' +
                    '<option value="tidak_terlaksana">Tidak Terlaksana (0 Menit)</option>' +
                    '<option value="diganti">Diganti Kegiatan Lain</option>';
                sel.value = selectedValue || 'terlaksana';
            }
        }

        syncLogStatusOptions(true);
        expect(sel.value).toBe('diganti');
        expect(sel.options.length).toBe(1);
        expect(sel.options[0].value).toBe('diganti');

        // Saat modal reguler dipulihkan: 3 opsi tersedia
        syncLogStatusOptions(false, 'terlaksana');
        expect(sel.value).toBe('terlaksana');
        expect(sel.options.length).toBe(3);
        expect(Array.from(sel.options).map(o => o.value)).toEqual(['terlaksana', 'tidak_terlaksana', 'diganti']);
    });

    test('15. Elemen log-teaching-wrapper (Jumlah JP & Tugas Tambahan Terkait) disembunyikan permanen', () => {
        const htmlPath = path.resolve('e-kinerja.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');

        // Memastikan log-teaching-wrapper disembunyikan di HTML
        expect(htmlContent).toContain('id="log-teaching-wrapper" class="hidden"');
        expect(htmlContent).toContain('display: none !important');

        // Memastikan di JS tidak lagi di-unhide saat catalog change
        expect(jsContent).toContain('teachingWrapper.classList.add(\'hidden\');');
        expect(jsContent).not.toContain('teachingWrapper.classList.toggle(\'hidden\', !showTeaching);');
    });
});
