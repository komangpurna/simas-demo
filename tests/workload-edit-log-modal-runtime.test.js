/**
 * @jest-environment jsdom
 */

/**
 * Unit Test Runtime: openEditLogModal di js/page-beban-kerja.js
 * Memverifikasi eksekusi runtime langsung dari fungsi openEditLogModal di lingkungan DOM
 * untuk menjamin 0% risiko Temporal Dead Zone (TDZ) ReferenceError (seperti variabel planSeg dsb.)
 */

const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

describe('openEditLogModal Runtime Execution & TDZ Resilience', () => {
    let openEditLogModalFn;
    let setWeekData;
    let setAssignments;
    let setCatalog;
    let setWeekStartDate;
    let setSelectedDayIndex;

    const root = path.resolve(__dirname, '..');
    const pageBebanKerjaJsPath = path.join(root, 'js', 'page-beban-kerja.js');
    const pageBebanKerjaContent = fs.readFileSync(pageBebanKerjaJsPath, 'utf8');

    beforeAll(() => {
        // Setup minimal DOM yang dibutuhkan oleh form modal log di e-kinerja.html
        document.body.innerHTML = `
            <div id="modal-workload-log" class="hidden">
                <div id="modal-log-title"></div>
                <input id="log-input-id" type="hidden" />
                <input id="log-input-plan-id" type="hidden" />
                <input id="log-input-is-unplanned" type="hidden" />
                <input id="log-input-date" type="date" />
                <select id="log-input-status-execution">
                    <option value="terlaksana">Terlaksana</option>
                    <option value="tidak_terlaksana">Tidak Terlaksana</option>
                    <option value="diganti">Diganti</option>
                </select>
                <input id="log-input-title" type="text" />
                <input id="log-input-start" type="time" />
                <input id="log-input-end" type="time" />
                <textarea id="log-input-obstacle"></textarea>
                <textarea id="log-input-substitute"></textarea>
                <textarea id="log-input-output"></textarea>
                <input id="log-input-evidence" type="text" />
                <input id="log-input-catalog-search" type="text" />
                <select id="log-input-main-duty"></select>
                <select id="log-input-assignment"></select>
                <input id="log-input-jp" type="number" />
                <button id="btn-submit-workload-log"><span id="btn-submit-workload-log-label">Simpan</span></button>
                <button id="btn-draft-workload-log" class="hidden"><span>Simpan Draf</span></button>
                <button id="btn-delete-workload-log" class="hidden">Hapus</button>
                <div id="log-preview-minutes">0 menit</div>
                <div id="log-time-section"></div>
                <div id="log-evidence-photos-grid"></div>
                <div id="btn-view-evidence"></div>
                <div id="btn-evidence-camera"></div>
                <div id="btn-evidence-gallery"></div>
                <div id="btn-evidence-paste"></div>
                <div id="log-catalog-dropdown" class="hidden"></div>
            </div>
        `;

        window.showToast = jest.fn();

        // Ekstrak fungsi openEditLogModal secara presisi dari file sumber
        const startMarker = 'export function openEditLogModal(logId) {';
        const endMarker = 'function closeLogModal()';
        const startIdx = pageBebanKerjaContent.indexOf(startMarker);
        const endIdx = pageBebanKerjaContent.indexOf(endMarker);
        if (startIdx === -1 || endIdx === -1) {
            throw new Error('Tidak dapat menemukan fungsi openEditLogModal di js/page-beban-kerja.js');
        }

        const rawFnCode = pageBebanKerjaContent.substring(startIdx, endIdx);
        const cleanedFnCode = rawFnCode.replace('export function openEditLogModal', 'function openEditLogModal');

        // Bungkus dengan harness lingkungan runtime
        const harness = `
            let _weekData = null;
            let _assignments = [];
            let _catalog = [];
            let _weekStartDate = '2026-10-05';
            let _selectedDayIndex = 3;
            let _currentLogPhotos = [];

            function el(id) { return document.getElementById(id); }
            function closeLogCatalogDropdown() {}
            function isLogLockedByManualVerification(log) {
                if (!log) return false;
                if (log.is_locked === 1 || _weekData?.week?.is_locked === 1) return true;
                return log.verification_status === 'verified' && Boolean(log.verified_by_uid);
            }
            function showToast(msg, type) { window.showToast(msg, type); }
            function dateOfDay(start, idx) { return '2026-10-08'; }
            function workloadSyncEvidenceButtons() {}
            function parseEvidencePhotos(raw) { return []; }
            function renderEvidencePhotosGrid() {}
            function updateLogMinutesPreview() {}
            function populateLogCatalogDropdownByDuty(duty, catId) {}
            function calcEffective(start, end) { return 90; }
            function onLogCatalogChange(flag) {}
            function canReportActivityNow(date, endTime, tol) { return { allowed: true }; }
            function onStatusExecutionChange() {}
            function syncLogStatusOptions(isReplacement, status) {}
            function isTeachingActivity(seg) { return false; }

            ${cleanedFnCode}

            return {
                openEditLogModal,
                setWeekData: (d) => { _weekData = d; },
                setAssignments: (a) => { _assignments = a; },
                setCatalog: (c) => { _catalog = c; },
                setWeekStartDate: (d) => { _weekStartDate = d; },
                setSelectedDayIndex: (i) => { _selectedDayIndex = i; }
            };
        `;

        const runner = new Function('document', 'window', harness);
        const exportsObj = runner(document, window);

        openEditLogModalFn = exportsObj.openEditLogModal;
        setWeekData = exportsObj.setWeekData;
        setAssignments = exportsObj.setAssignments;
        setCatalog = exportsObj.setCatalog;
        setWeekStartDate = exportsObj.setWeekStartDate;
        setSelectedDayIndex = exportsObj.setSelectedDayIndex;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        document.getElementById('modal-workload-log').classList.add('hidden');
    });

    test('1. AST Scope Audit: Tidak ada TDZ (Temporal Dead Zone) pada seluruh file js/page-beban-kerja.js', () => {
        const ast = parser.parse(pageBebanKerjaContent, {
            sourceType: 'module',
            plugins: ['importAssertions']
        });

        const tdzViolations = [];

        traverse(ast, {
            Identifier(p) {
                if (!p.isReferencedIdentifier()) return;
                const b = p.scope.getBinding(p.node.name);
                if (!b) return;
                if (b.kind === 'const' || b.kind === 'let') {
                    if (p.node.start < b.identifier.start) {
                        const bFuncScope = (b.scope.block.type.includes('Function') ? b.scope : b.scope.getFunctionParent());
                        const pFuncScope = p.scope.getFunctionParent();
                        if (bFuncScope === pFuncScope) {
                            tdzViolations.push({
                                varName: p.node.name,
                                refLine: p.node.loc.start.line,
                                declLine: b.identifier.loc.start.line
                            });
                        }
                    }
                }
            }
        });

        expect(tdzViolations).toEqual([]);
    });

    test('2. Runtime Test: openEditLogModal mengisi form saat log sudah memiliki jp_count', () => {
        const dummyWeekData = {
            week: { id: 'w1', is_locked: 0 },
            activities: [
                { id: 'act-1', assignment_id: 'asg-1', category_code: 'PELAKSANAAN_KBM' }
            ],
            segments: [
                { activity_id: 'act-1', jp_count: 2, start_time: '07:30', end_time: '09:00', catalog_id: 'cat-1' }
            ],
            plan_links: [
                { work_log_id: 'log-1', plan_activity_id: 'act-1' }
            ],
            logs: [
                {
                    id: 'log-1',
                    plan_activity_id: 'act-1',
                    date: '2026-10-08',
                    status_execution: 'terlaksana',
                    title: 'Mengajar Matematika Kelas X',
                    jp_count: 2,
                    start_time: '07:30',
                    end_time: '09:00',
                    catalog_id: 'cat-1'
                }
            ],
            log_segments: []
        };

        setWeekData(dummyWeekData);
        setAssignments([{ id: 'asg-1', duty_name: 'Guru Mata Pelajaran', equivalent_jp: 24, is_active: 1 }]);
        setCatalog([{ id: 'cat-1', category_code: 'PELAKSANAAN_KBM', name: 'KBM Tatap Muka' }]);

        expect(() => {
            openEditLogModalFn('log-1');
        }).not.toThrow();

        expect(document.getElementById('modal-workload-log').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('log-input-id').value).toBe('log-1');
        expect(document.getElementById('log-input-jp').value).toBe('2');
        expect(document.getElementById('log-input-title').value).toBe('Mengajar Matematika Kelas X');
    });

    test('3. Runtime Test: openEditLogModal TIDAK throw ReferenceError saat log.jp_count bernilai null/undefined dan mengambil jp dari planSeg', () => {
        // Skenario kritis yang memicu: Uncaught ReferenceError: Cannot access 'planSeg' before initialization
        const dummyWeekData = {
            week: { id: 'w1', is_locked: 0 },
            activities: [
                { id: 'act-plan-2', assignment_id: 'asg-1', category_code: 'PELAKSANAAN_KBM' }
            ],
            segments: [
                { activity_id: 'act-plan-2', jp_count: 4, start_time: '08:00', end_time: '11:00', catalog_id: 'cat-1' }
            ],
            plan_links: [
                { work_log_id: 'log-no-jp', plan_activity_id: 'act-plan-2' }
            ],
            logs: [
                {
                    id: 'log-no-jp',
                    plan_activity_id: 'act-plan-2',
                    date: '2026-10-08',
                    status_execution: 'terlaksana',
                    title: 'Praktik Pemrograman Web',
                    jp_count: null, // log belum punya jp_count eksplisit
                    start_time: '08:00',
                    end_time: '11:00',
                    catalog_id: 'cat-1'
                }
            ],
            log_segments: []
        };

        setWeekData(dummyWeekData);
        setAssignments([]);
        setCatalog([]);

        // Harus berjalan mulus tanpa ReferenceError TDZ
        expect(() => {
            openEditLogModalFn('log-no-jp');
        }).not.toThrow();

        // planSeg.jp_count bernilai 4, harus otomatis terisi ke input JP
        expect(document.getElementById('log-input-jp').value).toBe('4');
        expect(document.getElementById('modal-workload-log').classList.contains('hidden')).toBe(false);
    });

    test('4. Runtime Test: openEditLogModal menghitung estimasi JP dari durasi waktu jika log dan planSeg tidak memiliki jp_count', () => {
        const dummyWeekData = {
            week: { id: 'w1', is_locked: 0 },
            activities: [],
            segments: [],
            plan_links: [],
            logs: [
                {
                    id: 'log-calc-jp',
                    is_unplanned: 1,
                    date: '2026-10-08',
                    status_execution: 'terlaksana',
                    title: 'Rapat Koordinasi Tim Kurikulum',
                    jp_count: null,
                    start_time: '08:00',
                    end_time: '09:30' // 90 menit = 2 JP
                }
            ],
            log_segments: []
        };

        setWeekData(dummyWeekData);

        expect(() => {
            openEditLogModalFn('log-calc-jp');
        }).not.toThrow();

        expect(document.getElementById('log-input-jp').value).toBe('2');
        expect(document.getElementById('log-input-is-unplanned').value).toBe('1');
    });

    test('5. Runtime Test: openEditLogModal menolak membuka modal jika laporan terkunci verifikasi Kepala Sekolah', () => {
        const dummyWeekData = {
            week: { id: 'w1', is_locked: 0 },
            logs: [
                {
                    id: 'log-locked',
                    verification_status: 'verified',
                    verified_by_uid: 'kepsek_uid_123',
                    title: 'Laporan Final Terverifikasi'
                }
            ]
        };

        setWeekData(dummyWeekData);

        openEditLogModalFn('log-locked');

        expect(window.showToast).toHaveBeenCalledWith(
            expect.stringContaining('Laporan ini telah diverifikasi oleh Kepala Sekolah'),
            'warning'
        );
        expect(document.getElementById('modal-workload-log').classList.contains('hidden')).toBe(true);
    });
});
