/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');
const DataHolidays = require('../js/data-holidays.js');

const projectRoot = path.resolve(__dirname, '..');

describe('Master Hari Libur Sekolah Terpadu, Two-Way Sync Agenda, & Heuristik Monitoring KBM', () => {
    let holidayManager;
    let monitoringHelpers;
    let presensiHelpers;

    beforeAll(() => {
        window.escapeHTML = (str) => String(str || '').replace(/[&<>'"]/g, tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag] || tag));

        window.DataHolidays = DataHolidays;
        globalThis.DataHolidays = DataHolidays;

        // 1. Inisialisasi HolidayManager dari berkas sumber js/holiday-manager.js
        const holidayManagerCode = fs.readFileSync(path.join(projectRoot, 'js/holiday-manager.js'), 'utf8');
        const runnableHolidayCode = holidayManagerCode
            .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '// import removed')
            .replace(/export\s+async\s+function\s+([a-zA-Z0-9_]+)/g, 'async function $1')
            .replace(/export\s+function\s+([a-zA-Z0-9_]+)/g, 'function $1')
            .replace(/export\s+const\s+([a-zA-Z0-9_]+)\s*=/g, 'var $1 = window.$1 =')
            .replace(/export\s+let\s+([a-zA-Z0-9_]+)/g, 'let $1');

        window.eval(runnableHolidayCode);
        holidayManager = window.HolidayManager;

        // 2. Ekstrak helper collectActiveKbmDates, isHolidayDate, getActiveJPNumber dari js/page-monitoring-kbm.js
        const monitoringCode = fs.readFileSync(path.join(projectRoot, 'js/page-monitoring-kbm.js'), 'utf8');
        const mStart = monitoringCode.indexOf('const JP_TIME_CONFIG = [');
        const mEnd = monitoringCode.indexOf('export function buildJPTidakEfektifAngkatanMap');
        const monitoringSlice = monitoringCode.slice(mStart, mEnd);
        const runnableMonitoring = monitoringSlice
            .replace(/export\s+function\s+([a-zA-Z0-9_]+)/g, 'window.$1 = function $1')
            .replace(/function\s+([a-zA-Z0-9_]+)\s*\(/g, 'window.$1 = function $1(');
        window.eval(runnableMonitoring);
        monitoringHelpers = {
            collectActiveKbmDates: window.collectActiveKbmDates,
            isHolidayDate: window.isHolidayDate,
            getHolidayDateInfo: window.getHolidayDateInfo,
            getActiveJPNumber: window.getActiveJPNumber,
            isJPStarted: window.isJPStarted
        };

        // 3. Ekstrak checkAndRenderHolidayBanner dari js/page-presensi.js
        const presensiCode = fs.readFileSync(path.join(projectRoot, 'js/page-presensi.js'), 'utf8');
        const bannerStart = presensiCode.indexOf('export async function checkAndRenderHolidayBanner');
        let bannerEnd = presensiCode.indexOf('// ==========================================\r\n// BAGIAN 2: INPUT HARIAN');
        if (bannerEnd === -1) {
            bannerEnd = presensiCode.indexOf('// ==========================================\n// BAGIAN 2: INPUT HARIAN');
        }
        const runnableBanner = presensiCode.slice(bannerStart, bannerEnd)
            .replace('export async function checkAndRenderHolidayBanner', 'window.checkAndRenderHolidayBanner = async function checkAndRenderHolidayBanner');
        window.eval(runnableBanner);
        presensiHelpers = {
            checkAndRenderHolidayBanner: window.checkAndRenderHolidayBanner
        };

        // 4. Inisialisasi parser agenda-common dan window.saveCalendarEvent / window.deleteCalendarEvent
        const commonCode = fs.readFileSync(path.join(projectRoot, 'js/agenda-common.js'), 'utf8')
            .replace(/export\s+function\s+([a-zA-Z0-9_]+)/g, 'window.$1 = function $1');
        window.eval(commonCode);

        // Siapkan mock environment untuk page-agenda.js
        window.auth = {};
        window.initLayout = () => {};
        window.showConfirmModal = jest.fn(() => Promise.resolve(true));
        window.showToast = jest.fn();
        window.invalidateSystemConfig = jest.fn();
        window.cancelEditCalendarEvent = jest.fn();
        window.loadCalendarEvents = jest.fn();
        window.upsertSchoolHoliday = holidayManager.upsertSchoolHoliday;
        window.deleteSchoolHoliday = holidayManager.deleteSchoolHoliday;
        window.bootstrapSyncAgendaHolidays = holidayManager.bootstrapSyncAgendaHolidays;

        window.calendarEvents = [];
        window.editingCalendarEventId = null;
        window.calPeriodDate = new Date();

        const agendaCode = fs.readFileSync(path.join(projectRoot, 'js/page-agenda.js'), 'utf8');
        const sStart = agendaCode.indexOf('function isDateCoveredByOtherHolidayEvent');
        const sEnd = agendaCode.indexOf('// Keyboard escape handler');
        const agendaFunctions = `
            var calendarEvents = window.calendarEvents;
            var editingCalendarEventId = window.editingCalendarEventId;
            var calPeriodDate = window.calPeriodDate;
            var parseDate = window.parseDate;
            var formatYMD = window.formatYMD;
            var showConfirmModal = window.showConfirmModal;
            var upsertSchoolHoliday = window.upsertSchoolHoliday;
            var deleteSchoolHoliday = window.deleteSchoolHoliday;
            ${agendaCode.slice(sStart, sEnd)}
        `;
        window.eval(agendaFunctions);
    });

    beforeEach(() => {
        holidayManager.clearHolidayCache();
        localStorage.clear();
        sessionStorage.clear();
        window.DataHolidays = DataHolidays;
        globalThis.DataHolidays = DataHolidays;

        const mockStore = new Map();
        window.supabase = {
            from: jest.fn(() => ({
                select: jest.fn(() => {
                    let startVal = null;
                    let endVal = null;
                    const queryObj = {
                        gte: jest.fn((col, val) => { startVal = val; return queryObj; }),
                        lte: jest.fn((col, val) => { endVal = val; return queryObj; }),
                        then: (resolve) => {
                            let res = Array.from(mockStore.values());
                            if (startVal) res = res.filter(it => it.tanggal >= startVal);
                            if (endVal) res = res.filter(it => it.tanggal <= endVal);
                            return resolve({ data: res, error: null });
                        }
                    };
                    return queryObj;
                }),
                upsert: jest.fn((payload) => {
                    const items = Array.isArray(payload) ? payload : [payload];
                    items.forEach(it => mockStore.set(it.tanggal, it));
                    return {
                        select: jest.fn(() => Promise.resolve({ data: payload, error: null }))
                    };
                }),
                delete: jest.fn(() => ({
                    eq: jest.fn((col, val) => {
                        mockStore.delete(val);
                        return Promise.resolve({ data: null, error: null });
                    })
                }))
            }))
        };

        // Reset DOM form agenda
        document.body.innerHTML = `
            <div id="modal-calendar-manager">
                <input id="input-event-title" value="" />
                <input id="input-event-date" value="" />
                <input id="input-event-end-date" value="" />
                <select id="select-event-type">
                    <option value="kegiatan">Kegiatan</option>
                    <option value="libur">Libur</option>
                    <option value="penting">Penting</option>
                </select>
                <textarea id="input-event-desc"></textarea>
                <select id="select-event-repeat">
                    <option value="none">Tidak Berulang</option>
                    <option value="weekly">Mingguan</option>
                    <option value="monthly">Bulanan</option>
                    <option value="yearly">Tahunan</option>
                    <option value="periodic">Periodik</option>
                </select>
                <input id="input-repeat-interval" value="7" />
                <input id="input-repeat-count" value="3" />
                <button id="btn-save-event">Simpan</button>
            </div>
            <div id="calendar-events-list"></div>
        `;
    });

    // =========================================================================
    // 1. BACKEND PERMISSIONS & ACCESS UTILS (REST PROXY)
    // =========================================================================
    test('1. Backend Permissions: lib_hari_libur mengizinkan STAFF_ROLES read dan staff/wakasek_kurikulum write', () => {
        const filePath = path.join(projectRoot, 'supabase/functions/secure-proxy/rest-access-utils.mjs');
        const content = fs.readFileSync(filePath, 'utf8');

        // Verifikasi konfigurasi izin baca (STAFF_ROLES)
        expect(content).toMatch(/lib_hari_libur:\s*STAFF_ROLES/);

        // Verifikasi konfigurasi izin tulis (super_admin, admin_perpus, wakasek_kurikulum, staff)
        expect(content).toMatch(/lib_hari_libur:\s*\[[^\]]*'super_admin'[^\]]*'admin_perpus'[^\]]*'wakasek_kurikulum'[^\]]*'staff'[^\]]*\]/);
    });

    // =========================================================================
    // 2. HOLIDAY MANAGER SERVICE (SSOT)
    // =========================================================================
    test('2. Holiday Manager: upsert, fetch, dan delete dengan memory cache serta sanitasi urutan tanggal', async () => {
        const mockDb = new Map();
        const mockSupabase = {
            from: jest.fn((table) => {
                expect(table).toBe('lib_hari_libur');
                return {
                    select: jest.fn((cols) => {
                        let result = Array.from(mockDb.values());
                        const queryObj = {
                            gte: jest.fn((col, val) => {
                                result = result.filter(item => item[col] >= val);
                                return queryObj;
                            }),
                            lte: jest.fn((col, val) => {
                                result = result.filter(item => item[col] <= val);
                                return queryObj;
                            }),
                            then: (resolve) => resolve({ data: result, error: null })
                        };
                        return queryObj;
                    }),
                    upsert: jest.fn((payload) => {
                        const items = Array.isArray(payload) ? payload : [payload];
                        items.forEach(it => mockDb.set(it.tanggal, it));
                        return {
                            select: jest.fn(() => Promise.resolve({ data: payload, error: null }))
                        };
                    }),
                    delete: jest.fn(() => ({
                        eq: jest.fn((col, val) => {
                            mockDb.delete(val);
                            return Promise.resolve({ data: null, error: null });
                        })
                    }))
                };
            })
        };
        window.supabase = mockSupabase;

        // A. Upsert hari libur
        const upsertRes = await holidayManager.upsertSchoolHoliday('2026-10-15', 'Hari Libur Khusus SMAGESA');
        expect(upsertRes.success).toBe(true);
        expect(holidayManager.isRegisteredHoliday('2026-10-15')).toBe(true);
        expect(holidayManager.getRegisteredHoliday('2026-10-15')?.nama).toBe('Hari Libur Khusus SMAGESA');

        // B. Fetch hari libur dengan cache & rentang terbalik (startDate > endDate)
        const fetchedReversed = await holidayManager.fetchRegisteredHolidays('2026-10-31', '2026-10-01');
        expect(fetchedReversed.length).toBe(1);
        expect(fetchedReversed[0].tanggal).toBe('2026-10-15');

        // C. Delete hari libur
        const delRes = await holidayManager.deleteSchoolHoliday('2026-10-15');
        expect(delRes.success).toBe(true);
        expect(holidayManager.isRegisteredHoliday('2026-10-15')).toBe(false);
        expect(holidayManager.getRegisteredHoliday('2026-10-15')).toBeNull();
    });

    test('3. Holiday Manager: bootstrapSyncAgendaHolidays mengimpor event multi-hari, ISO datetime, dan DataHolidays', async () => {
        const mockDb = new Map();
        window.supabase = {
            from: jest.fn(() => ({
                upsert: jest.fn((items) => {
                    (Array.isArray(items) ? items : [items]).forEach(it => mockDb.set(it.tanggal, it));
                    return Promise.resolve({ data: items, error: null });
                })
            }))
        };

        window.cfClient = {
            getCalendarEvents: jest.fn(async (year) => ({
                success: true,
                data: [
                    { id: 'ev1', title: 'Libur Hari Raya Kuningan', date: `${year}-11-14`, endDate: `${year}-11-16`, category: 'libur' },
                    { id: 'ev2', title: 'Libur Insidental', date: `${year}-12-01T00:00:00.000Z`, category: 'libur' },
                    { id: 'ev3', title: 'Rapat Kerja Guru', date: `${year}-11-20`, category: 'kegiatan' }
                ]
            }))
        };

        window.DataHolidays = {
            getNationalHolidays: jest.fn((year) => [
                { date: `${year}-08-17`, title: 'Hari Kemerdekaan RI' }
            ])
        };

        const result = await holidayManager.bootstrapSyncAgendaHolidays();
        expect(result.success).toBe(true);

        const currentYear = new Date().getFullYear();
        // Rentang multi-hari ev1 (14, 15, 16) harus tercatat semua
        expect(holidayManager.isRegisteredHoliday(`${currentYear}-11-14`)).toBe(true);
        expect(holidayManager.isRegisteredHoliday(`${currentYear}-11-15`)).toBe(true);
        expect(holidayManager.isRegisteredHoliday(`${currentYear}-11-16`)).toBe(true);
        // ISO datetime ev2 harus berhasil diparsing
        expect(holidayManager.isRegisteredHoliday(`${currentYear}-12-01`)).toBe(true);
        // National holiday tercatat
        expect(holidayManager.isRegisteredHoliday(`${currentYear}-08-17`)).toBe(true);
        // Kegiatan biasa tidak tercatat
        expect(holidayManager.isRegisteredHoliday(`${currentYear}-11-20`)).toBe(false);
        expect(sessionStorage.getItem('simas_holiday_sync_bootstrapped')).toBe('true');
    });

    // =========================================================================
    // 3. TWO-WAY SYNC DENGAN MODUL AGENDA SEKOLAH (EKSEKUSI FUNGSIONAL)
    // =========================================================================
    test('4. Two-Way Sync Agenda: Simpan event libur multi-hari & periodik otomatis upsert ke SSOT lib_hari_libur', async () => {
        window.cfClient = {
            createCalendarEvent: jest.fn(async (payload) => ({ success: true, id: 'ev_new_1' })),
            createCalendarEventsBatch: jest.fn(async (list) => ({ success: true, count: list.length })),
            updateCalendarEvent: jest.fn(async (id, payload) => ({ success: true })),
            deleteCalendarEvent: jest.fn(async (id) => ({ success: true }))
        };

        // A. Simpan event libur multi-hari (2026-10-10 s/d 2026-10-12)
        document.getElementById('input-event-title').value = 'Libur Ujian Semester';
        document.getElementById('input-event-date').value = '2026-10-10';
        document.getElementById('input-event-end-date').value = '2026-10-12';
        document.getElementById('select-event-type').value = 'libur';
        document.getElementById('select-event-repeat').value = 'none';

        await window.saveCalendarEvent();

        expect(holidayManager.isRegisteredHoliday('2026-10-10')).toBe(true);
        expect(holidayManager.isRegisteredHoliday('2026-10-11')).toBe(true);
        expect(holidayManager.isRegisteredHoliday('2026-10-12')).toBe(true);

        // B. Simpan event libur periodik (repeatMode = weekly, count = 3)
        document.getElementById('input-event-title').value = 'Libur Khusus Mingguan';
        document.getElementById('input-event-date').value = '2026-11-01';
        document.getElementById('input-event-end-date').value = '';
        document.getElementById('select-event-type').value = 'libur';
        document.getElementById('select-event-repeat').value = 'weekly';
        document.getElementById('input-repeat-count').value = '3';

        await window.saveCalendarEvent();

        // Verifikasi seluruh tanggal hasil deret periodik tersimpan di SSOT holidayManager
        expect(holidayManager.isRegisteredHoliday('2026-11-01')).toBe(true);
        expect(holidayManager.isRegisteredHoliday('2026-11-08')).toBe(true);
        expect(holidayManager.isRegisteredHoliday('2026-11-15')).toBe(true);
    });

    test('5. Two-Way Sync Agenda: Pembaruan memperpendek rentang libur & penghapusan event membersihkan tanggal', async () => {
        window.cfClient = {
            createCalendarEvent: jest.fn(async (payload) => ({ success: true })),
            createCalendarEventsBatch: jest.fn(async (list) => ({ success: true })),
            updateCalendarEvent: jest.fn(async (id, payload) => ({ success: true })),
            deleteCalendarEvent: jest.fn(async (id) => ({ success: true }))
        };

        // Pasang event awal 3 hari di calendarEvents (Gunakan tanggal non-libur nasional di November)
        window.calendarEvents = [
            {
                id: 'ev_multi_1',
                title: 'Kegiatan Jeda Semester',
                date: '2026-11-10',
                endDate: '2026-11-12',
                category: 'libur',
                type: 'libur'
            }
        ];
        // Daftarkan hari-hari awal
        await holidayManager.upsertSchoolHoliday('2026-11-10', 'Kegiatan Jeda Semester');
        await holidayManager.upsertSchoolHoliday('2026-11-11', 'Kegiatan Jeda Semester');
        await holidayManager.upsertSchoolHoliday('2026-11-12', 'Kegiatan Jeda Semester');

        // A. Edit event untuk diperpendek menjadi hanya 1 hari (2026-11-10 s/d 2026-11-10)
        window.editingCalendarEventId = 'ev_multi_1';
        document.getElementById('input-event-title').value = 'Kegiatan Jeda Semester (Revisi)';
        document.getElementById('input-event-date').value = '2026-11-10';
        document.getElementById('input-event-end-date').value = '2026-11-10';
        document.getElementById('select-event-type').value = 'libur';
        document.getElementById('select-event-repeat').value = 'none';

        await window.saveCalendarEvent();

        // 2026-11-10 tetap libur, namun 11 dan 12 wajib terhapus
        expect(holidayManager.isRegisteredHoliday('2026-11-10')).toBe(true);
        expect(holidayManager.isRegisteredHoliday('2026-11-11')).toBe(false);
        expect(holidayManager.isRegisteredHoliday('2026-11-12')).toBe(false);

        // B. Hapus event libur tunggal
        await window.deleteCalendarEvent('ev_multi_1');
        expect(holidayManager.isRegisteredHoliday('2026-11-10')).toBe(false);

        // B2. Proteksi Libur Beririsan & Libur Nasional:
        // Jika ada Event A (2026-11-20 s/d 2026-11-25) dan Event B (2026-11-22),
        // menghapus Event B tidak boleh menghapus 2026-11-22 karena dicakup Event A
        await holidayManager.upsertSchoolHoliday('2026-11-22', 'Event A');
        window.calendarEvents = [
            { id: 'ev_a', title: 'Event A', date: '2026-11-20', endDate: '2026-11-25', category: 'libur', type: 'libur' },
            { id: 'ev_b', title: 'Event B', date: '2026-11-22', category: 'libur', type: 'libur' }
        ];
        await window.deleteCalendarEvent('ev_b');
        expect(holidayManager.isRegisteredHoliday('2026-11-22')).toBe(true); // Terlindungi oleh ev_a!

        // Menghapus agenda libur pada Hari Natal (2026-12-25) tidak boleh menghapus Hari Natal
        await holidayManager.upsertSchoolHoliday('2026-12-25', 'Hari Raya Natal');
        window.calendarEvents = [
            { id: 'ev_natal', title: 'Agenda Natal', date: '2026-12-25', category: 'libur', type: 'libur' }
        ];
        await window.deleteCalendarEvent('ev_natal');
        expect(holidayManager.isRegisteredHoliday('2026-12-25')).toBe(true); // Terlindungi oleh DataHolidays!

        // C. Hapus rangkaian agenda periodik (gunakan tanggal non-libur nasional di November)
        window.calendarEvents = [
            { id: 's1', title: 'Libur Rutin 1', date: '2026-11-02', endDate: '2026-11-03', category: 'libur', description: '[series:rec_abc123]' },
            { id: 's2', title: 'Libur Rutin 2', date: '2026-11-08', endDate: '2026-11-09', category: 'libur', description: '[series:rec_abc123]' }
        ];
        await holidayManager.upsertSchoolHoliday('2026-11-02', 'Libur Rutin 1');
        await holidayManager.upsertSchoolHoliday('2026-11-03', 'Libur Rutin 1');
        await holidayManager.upsertSchoolHoliday('2026-11-08', 'Libur Rutin 2');
        await holidayManager.upsertSchoolHoliday('2026-11-09', 'Libur Rutin 2');

        await window.deleteCalendarEvent('s1');
        // Seluruh tanggal di kedua rangkaian event harus bersih dari SSOT
        expect(holidayManager.isRegisteredHoliday('2026-11-02')).toBe(false);
        expect(holidayManager.isRegisteredHoliday('2026-11-03')).toBe(false);
        expect(holidayManager.isRegisteredHoliday('2026-11-08')).toBe(false);
        expect(holidayManager.isRegisteredHoliday('2026-11-09')).toBe(false);
    });

    // =========================================================================
    // 4. DETEKSI HEURISTIK KBM NON-EFEKTIF (<= 5 KELAS) DI MONITORING KBM
    // =========================================================================
    test('6. Monitoring KBM: collectActiveKbmDates menyaring akhir pekan dan hari libur SSOT', async () => {
        await holidayManager.upsertSchoolHoliday('2026-10-14', 'Libur Khusus Sekolah');

        const activeDates = monitoringHelpers.collectActiveKbmDates({
            periodeType: 'mingguan',
            startDate: '2026-10-12', // Senin
            endDate: '2026-10-18'    // Minggu
        });

        // Senin 12, Selasa 13, Kamis 15, Jumat 16 aktif.
        // Rabu 14 (libur sekolah), Sabtu 17, Minggu 18 difilter.
        expect(activeDates).toContain('2026-10-12');
        expect(activeDates).toContain('2026-10-13');
        expect(activeDates).not.toContain('2026-10-14');
        expect(activeDates).toContain('2026-10-15');
        expect(activeDates).toContain('2026-10-16');
        expect(activeDates).not.toContain('2026-10-17');
        expect(activeDates).not.toContain('2026-10-18');
    });

    test('7. Heuristik <= 5 Kelas Aktif: Menandai hari lampau sebagai libur, melindungi nama hari libur nasional, dan menjaga 0 jam TE', async () => {
        // Simulasi fungsi heuristik dari js/page-monitoring-kbm.js
        const sampleDates = ['2026-10-01', '2026-10-02', '2026-08-17']; // 1 Okt (3 kelas), 2 Okt (12 kelas), 17 Agust (Libur Nasional 0 kelas)
        const sampleKelas = Array.from({ length: 36 }, (_, i) => `X-${i + 1}`);
        const todayStr = '2026-10-05';

        // Daftarkan 17 Agustus 2026 sebagai Libur Nasional resmi
        window.DataHolidays = {
            isNationalHoliday: (d) => d === '2026-08-17',
            getHolidayForDate: (d) => d === '2026-08-17' ? { title: 'Hari Kemerdekaan RI' } : null
        };

        const sampleMatrix = {
            '2026-10-01': {},
            '2026-10-02': {},
            '2026-08-17': {}
        };

        // 2026-10-01: Hanya 3 kelas yang mengisi KBM (<= 5)
        for (let i = 0; i < 3; i++) {
            sampleMatrix['2026-10-01'][sampleKelas[i]] = { 1: { jurnal: { mapel: 'Matematika' } } };
        }
        // 2026-10-02: 12 kelas mengisi KBM (> 5)
        for (let i = 0; i < 12; i++) {
            sampleMatrix['2026-10-02'][sampleKelas[i]] = { 1: { jurnal: { mapel: 'Fisika' } } };
        }

        // Jalankan logika heuristik KBM
        const nonEffectiveDates = new Set();
        const isClassListValid = Array.isArray(sampleKelas) && sampleKelas.length > 5;

        if (isClassListValid) {
            sampleDates.forEach((d) => {
                if (d < todayStr) {
                    const selectedDate = new Date(d + "T00:00:00");
                    const dayOfWeek = selectedDate.getDay();
                    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                        if (monitoringHelpers.isHolidayDate(d)) {
                            nonEffectiveDates.add(d);
                            return; // Tidak boleh menimpa nama resmi hari libur nasional
                        }

                        let activeClassesCount = 0;
                        sampleKelas.forEach((k) => {
                            let hasClassKbm = false;
                            for (let jp = 1; jp <= 10; jp++) {
                                const cell = sampleMatrix[d]?.[k]?.[jp];
                                if (cell && (cell.jurnal || (cell.presensi && cell.presensi.status))) {
                                    hasClassKbm = true;
                                    break;
                                }
                            }
                            if (hasClassKbm) activeClassesCount++;
                        });

                        if (activeClassesCount <= 5) {
                            nonEffectiveDates.add(d);
                            holidayManager.upsertSchoolHoliday(d, `Dispensasi Khusus / Libur Sekolah (${activeClassesCount} Rombel Aktif)`);
                        }
                    }
                }
            });
        }

        // A. 1 Oktober terdeteksi non-efektif (<= 5 rombel) dan di-upsert ke holidayManager
        expect(nonEffectiveDates.has('2026-10-01')).toBe(true);
        expect(holidayManager.isRegisteredHoliday('2026-10-01')).toBe(true);
        expect(holidayManager.getRegisteredHoliday('2026-10-01')?.nama).toContain('3 Rombel Aktif');

        // B. 2 Oktober adalah hari KBM normal (> 5 rombel)
        expect(nonEffectiveDates.has('2026-10-02')).toBe(false);
        expect(holidayManager.isRegisteredHoliday('2026-10-02')).toBe(false);

        // C. 17 Agustus dicatat non-efektif namun namanya TIDAK tertimpa oleh Dispensasi Khusus
        expect(nonEffectiveDates.has('2026-08-17')).toBe(true);
        const aug17Info = monitoringHelpers.getHolidayDateInfo('2026-08-17');
        expect(aug17Info?.title).toBe('Hari Kemerdekaan RI');

        // E. Rekonsiliasi Self-Healing: Jika guru kemudian menyusul mengisi jurnal hingga 20 rombel aktif pada 2026-10-01
        for (let i = 3; i < 20; i++) {
            sampleMatrix['2026-10-01'][sampleKelas[i]] = { 1: { jurnal: { mapel: 'Biologi' } } };
        }
        // Jalankan ulang fungsi heuristik
        sampleDates.forEach((d) => {
            const existingHoliday = holidayManager.getRegisteredHoliday(d);
            const isAutoHeuristic = Boolean(existingHoliday?.nama?.startsWith("Dispensasi Khusus / Libur Sekolah"));
            const isOfficialNational = window.DataHolidays.isNationalHoliday(d);
            if (monitoringHelpers.isHolidayDate(d) && !isAutoHeuristic) return;

            let activeCount = 0;
            sampleKelas.forEach((k) => {
                let hasClassKbm = false;
                for (let jp = 1; jp <= 10; jp++) {
                    const cell = sampleMatrix[d]?.[k]?.[jp];
                    if (cell && (cell.jurnal || (cell.presensi && cell.presensi.status))) {
                        hasClassKbm = true;
                        break;
                    }
                }
                if (hasClassKbm) activeCount++;
            });

            if (activeCount <= 5) {
                holidayManager.upsertSchoolHoliday(d, `Dispensasi Khusus / Libur Sekolah (${activeCount} Rombel Aktif)`);
            } else if (isAutoHeuristic && !isOfficialNational) {
                holidayManager.deleteSchoolHoliday(d);
            }
        });
        // 2026-10-01 telah dipulihkan menjadi KBM aktif normal dan dihapus dari hari libur sekolah!
        expect(holidayManager.isRegisteredHoliday('2026-10-01')).toBe(false);
    });

    test('8. Tab Monitoring KBM: Menampilkan Banner Hari Libur Sekolah, CellState LIBUR, & Nonaktifkan TE', () => {
        // Simulasi logika cell state dari renderMatrix di js/page-monitoring-kbm.js
        const holidayInfo = {
            isSchoolHoliday: true,
            title: 'Libur Hari Raya Kuningan',
            nama: 'Libur Hari Raya Kuningan'
        };

        function determineCellState({
            jurnal = null,
            presensi = null,
            xml = null,
            holidayInfo = null,
            dayOfWeek = 3,
            jpNum = 2,
            isPastDate = true,
            targetDateStr = '2026-10-15'
        }) {
            let cellState = "EMPTY";
            let badgeText = "";
            let badgeClass = "";
            let detailTooltip = "";

            if (!holidayInfo && dayOfWeek === 1 && jpNum === 1) {
                cellState = "UPACARA";
                badgeText = "🇮🇩 Upacara";
                badgeClass = "bg-indigo-100";
            } else if (!holidayInfo && dayOfWeek === 5 && jpNum === 10) {
                cellState = "EKSKUL";
                badgeText = "⚽ Ekstrakurikuler";
                badgeClass = "bg-purple-100";
            } else if (!holidayInfo && !monitoringHelpers.isJPStarted(jpNum, targetDateStr)) {
                cellState = "BELUM_BERJALAN";
                badgeText = "";
            } else if (jurnal && presensi && presensi.status === "H") {
                cellState = "VERIFIED";
                badgeText = "🟢 Terverifikasi";
                badgeClass = "bg-emerald-100";
            } else if (jurnal && (!presensi || !presensi.status)) {
                cellState = "JURNAL_ONLY";
                badgeText = "🩵 Belum Diabsen Siswa";
                badgeClass = "bg-sky-100";
            } else if (presensi && ["S", "I", "L", "K"].includes(presensi.status)) {
                cellState = `ABSENT_${presensi.status}`;
            } else if (presensi && ["TK", "TT", "A"].includes(presensi.status)) {
                cellState = `ABSENT_${presensi.status}`;
            } else if (holidayInfo) {
                cellState = "LIBUR";
                badgeText = holidayInfo.isSchoolHoliday ? "🏖️ Libur Sekolah" : "🏖️ Libur Nasional";
                badgeClass = "bg-rose-100 text-rose-800 font-bold";
                detailTooltip = `${badgeText}: Tidak ada kegiatan KBM efektif terjadwal (${holidayInfo.title})`;
            } else if (!jurnal && (presensi?.status === "H" || xml)) {
                cellState = "PENDING_JURNAL";
                badgeText = "Jurnal Kosong";
                badgeClass = "bg-rose-100 text-rose-800";
            } else {
                cellState = "KELAS_KOSONG";
                badgeText = "🟧 Kelas Kosong";
            }

            const mapel = jurnal?.mapel || presensi?.mapel || xml?.mapel || "";
            const guru = jurnal?.guru || presensi?.guru || xml?.guru || "";
            const isEmpty = !mapel && !guru && cellState !== "LIBUR" && cellState !== "UPACARA" && cellState !== "EKSKUL";

            return { cellState, badgeText, badgeClass, detailTooltip, isEmpty };
        }

        // Skenario A: Ada jadwal XML (karena hari kerja biasa), tapi tidak ada jurnal/presensi pada hari libur
        const cellA = determineCellState({
            jurnal: null,
            presensi: null,
            xml: { guru: 'Drs. I Wayan', mapel: 'Matematika' },
            holidayInfo
        });
        // Sel wajib berstatus LIBUR dan TIDAK menjadi PENDING_JURNAL ("Jurnal Kosong")!
        expect(cellA.cellState).toBe('LIBUR');
        expect(cellA.badgeText).toBe('🏖️ Libur Sekolah');
        expect(cellA.detailTooltip).toContain('Tidak ada kegiatan KBM efektif terjadwal');

        // Skenario B: Ada kegiatan khusus / dispensasi terjadwal yang terisi jurnal dan presensi siswa
        const cellB = determineCellState({
            jurnal: { mapel: 'Latihan Porseni' },
            presensi: { status: 'H' },
            xml: null,
            holidayInfo
        });
        expect(cellB.cellState).toBe('VERIFIED');
        expect(cellB.badgeText).toBe('🟢 Terverifikasi');

        // Skenario C: Senin JP 1 pada hari libur tidak menjadi UPACARA melainkan LIBUR
        const cellMon = determineCellState({
            dayOfWeek: 1,
            jpNum: 1,
            holidayInfo
        });
        expect(cellMon.cellState).toBe('LIBUR');
        expect(cellMon.badgeText).toBe('🏖️ Libur Sekolah');

        // Skenario D: Jumat JP 10 pada hari libur tidak menjadi EKSKUL melainkan LIBUR
        const cellFri = determineCellState({
            dayOfWeek: 5,
            jpNum: 10,
            holidayInfo
        });
        expect(cellFri.cellState).toBe('LIBUR');
        expect(cellFri.badgeText).toBe('🏖️ Libur Sekolah');

        // Skenario E: Jam belum berjalan pada hari libur tidak menjadi BELUM_BERJALAN
        const cellFuture = determineCellState({
            targetDateStr: '2099-01-01',
            jpNum: 8,
            holidayInfo
        });
        expect(cellFuture.cellState).toBe('LIBUR');

        // Skenario F: Sel libur tanpa XML jadwal tidak dianggap isEmpty (tidak dirender '-')
        const cellNoXml = determineCellState({
            xml: null,
            holidayInfo
        });
        expect(cellNoXml.cellState).toBe('LIBUR');
        expect(cellNoXml.isEmpty).toBe(false);

        // Skenario G: Verifikasi berkas sumber page-monitoring-kbm.js mengandung percabangan LIBUR & banner
        const monitoringCode = fs.readFileSync(path.join(projectRoot, 'js/page-monitoring-kbm.js'), 'utf8');
        expect(monitoringCode).toContain('id="holiday-banner-monitoring"');
        expect(monitoringCode).toContain('cellState = "LIBUR";');
        expect(monitoringCode).toContain('!holidayInfo && dayOfWeek === 1 && jpNum === 1');
        expect(monitoringCode).toContain('!holidayInfo && dayOfWeek === 5 && jpNum === 10');
        expect(monitoringCode).toContain('!holidayInfo && !isJPStarted(jpNum, targetDateStr)');
        expect(monitoringCode).toContain('g.cellState === "LIBUR"');
    });

    // =========================================================================
    // 5. INDIKATOR VISUAL INFORMATIF PRESENSI SISWA (presensi.html & js)
    // =========================================================================
    test('9. Presensi Siswa: Banner Hari Libur Sekolah tampil dan Form/Tombol Presensi 100% Aktif', async () => {
        const htmlPath = path.join(projectRoot, 'presensi.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        document.documentElement.innerHTML = htmlContent;

        // Verifikasi wadah banner di presensi.html
        const bannerContainer = document.getElementById('holiday-banner-presensi');
        expect(bannerContainer).not.toBeNull();
        expect(bannerContainer.classList.contains('hidden')).toBe(true);

        // Verifikasi tombol input presensi tetap ada & aktif
        const btnInput = document.getElementById('btn-main-input');
        const selectClass = document.getElementById('input-class');
        expect(btnInput).not.toBeNull();
        expect(btnInput.disabled).toBe(false);
        expect(selectClass.disabled).toBe(false);

        // Daftarkan hari libur
        await holidayManager.upsertSchoolHoliday('2026-10-20', 'Porsenijar Kabupaten Badung');

        // Render banner untuk tanggal libur
        await presensiHelpers.checkAndRenderHolidayBanner('2026-10-20');
        expect(bannerContainer.classList.contains('hidden')).toBe(false);
        expect(bannerContainer.textContent).toContain('Porsenijar Kabupaten Badung');
        expect(bannerContainer.textContent).toContain('Form dan tombol presensi tetap aktif');

        // Verifikasi tombol presensi tetap aktif dan tidak terkunci/disabled
        expect(btnInput.disabled).toBe(false);
        expect(selectClass.disabled).toBe(false);

        // Render banner untuk tanggal normal
        await presensiHelpers.checkAndRenderHolidayBanner('2026-10-21');
        expect(bannerContainer.classList.contains('hidden')).toBe(true);
    });

    // =========================================================================
    // 6. KETAHANAN NETWORK & ERROR HANDLING SUPABASE (Edge Cases)
    // =========================================================================
    test('10. Bootstrap Sync: Menangani error Supabase dengan tangguh & tidak mengunci sessionStorage saat gagal', async () => {
        sessionStorage.clear();
        // Mock Supabase upsert gagal
        window.supabase = {
            from: jest.fn(() => ({
                upsert: jest.fn(async () => ({ data: null, error: { message: 'Database unreachable' } }))
            }))
        };
        window.cfClient = {
            getCalendarEvents: jest.fn(async () => ({ success: true, data: [{ date: '2026-11-01', category: 'libur', title: 'Libur Uji' }] }))
        };

        const syncResult = await holidayManager.bootstrapSyncAgendaHolidays();
        expect(syncResult.success).toBe(false);
        expect(syncResult.error).toContain('Database unreachable');
        expect(sessionStorage.getItem('simas_holiday_sync_bootstrapped')).toBeNull();
    });

    test('11. Memory Cache: getCachedHolidays dan fetchRegisteredHolidays tahan terhadap urutan tanggal terbalik', async () => {
        holidayManager.clearHolidayCache();
        await holidayManager.upsertSchoolHoliday('2026-10-05', 'Libur A');
        await holidayManager.upsertSchoolHoliday('2026-10-15', 'Libur B');
        await holidayManager.upsertSchoolHoliday('2026-10-25', 'Libur C');

        // Panggil dengan endDate < startDate
        const cached = holidayManager.getCachedHolidays('2026-10-20', '2026-10-01');
        expect(cached.length).toBe(2);
        expect(cached[0].tanggal).toBe('2026-10-05');
        expect(cached[1].tanggal).toBe('2026-10-15');
    });

    test('12. Presensi Siswa: Menampilkan Libur Nasional secara instan dari DataHolidays tanpa ketergantungan network Supabase', async () => {
        const htmlPath = path.join(projectRoot, 'presensi.html');
        document.documentElement.innerHTML = fs.readFileSync(htmlPath, 'utf8');
        const bannerContainer = document.getElementById('holiday-banner-presensi');
        // Kosongkan cache Supabase & pastikan client offline
        holidayManager.clearHolidayCache();
        window.supabase = null;

        // 17 Agustus 2026 adalah Libur Nasional resmi
        await presensiHelpers.checkAndRenderHolidayBanner('2026-08-17');
        expect(bannerContainer.classList.contains('hidden')).toBe(false);
        expect(bannerContainer.textContent).toContain('Hari Libur Nasional: Hari Kemerdekaan Republik Indonesia.');
    });

    test('13. Active JP Header: getActiveJPNumber mengembalikan null pada hari libur dan akhir pekan', () => {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const todayStr = `${y}-${m}-${d}`;

        // Daftarkan hari ini sebagai libur sekolah
        holidayManager.upsertSchoolHoliday(todayStr, 'Libur Hari Ini Uji');

        // Pada hari libur, getActiveJPNumber wajib null
        const activeJpHoliday = monitoringHelpers.getActiveJPNumber(todayStr);
        expect(activeJpHoliday).toBeNull();

        // Pada akhir pekan (Minggu/Sabtu), wajib null
        expect(monitoringHelpers.getActiveJPNumber('2026-10-18')).toBeNull(); // Minggu
        expect(monitoringHelpers.getActiveJPNumber('2026-10-17')).toBeNull(); // Sabtu

        holidayManager.deleteSchoolHoliday(todayStr);
    });

    test('14. Normalisasi Tanggal ISO & String ID: Ketahanan terhadap input ISO datetime dan tipe data ID', async () => {
        holidayManager.clearHolidayCache();
        // A. Upsert dengan ISO format
        const upRes = await holidayManager.upsertSchoolHoliday('2026-10-15T08:00:00.000Z', 'Libur ISO');
        expect(upRes.success).toBe(true);
        expect(holidayManager.isRegisteredHoliday('2026-10-15T08:00:00.000Z')).toBe(true);
        expect(holidayManager.isRegisteredHoliday('2026-10-15')).toBe(true);

        const getRes = holidayManager.getRegisteredHoliday('2026-10-15T12:00:00Z');
        expect(getRes?.nama).toBe('Libur ISO');

        // B. Delete dengan ISO format
        const delRes = await holidayManager.deleteSchoolHoliday('2026-10-15T23:59:59Z');
        expect(delRes.success).toBe(true);
        expect(holidayManager.isRegisteredHoliday('2026-10-15')).toBe(false);

        // C. Agenda Event ID String vs Number resilience
        window.calendarEvents = [
            { id: 101, title: 'Libur ID Angka', date: '2026-11-20', category: 'libur', type: 'libur' },
            { id: '102', title: 'Libur ID String', date: '2026-11-21', category: 'libur', type: 'libur' }
        ];
        expect(window.isDateCoveredByOtherHolidayEvent('2026-11-20', '101')).toBe(false);
        expect(window.isDateCoveredByOtherHolidayEvent('2026-11-20', 999)).toBe(true);
        expect(window.isDateCoveredByOtherHolidayEvent('2026-11-21', 102)).toBe(false);
        expect(window.isDateCoveredByOtherHolidayEvent('2026-11-21', '999')).toBe(true);
    });

    test('15. Tab Monitoring KBM: Pre-fetch Hari Libur Sekolah sebelum collectActiveKbmDates', () => {
        const monitoringCode = fs.readFileSync(path.join(projectRoot, 'js/page-monitoring-kbm.js'), 'utf8');
        const rekapIdx = monitoringCode.indexOf('window.loadRekapGuru = async function');
        const rekapSlice = monitoringCode.slice(rekapIdx, rekapIdx + 2000);
        expect(rekapSlice).toContain('await fetchRegisteredHolidays(startVal, endVal)');
        expect(rekapSlice).toContain('await fetchRegisteredHolidays(`${bulan}-01`, `${bulan}-31`)');

        const detailIdx = monitoringCode.indexOf('window.loadDetailGuru = async function');
        const detailSlice = monitoringCode.slice(detailIdx, detailIdx + 2000);
        expect(detailSlice).toContain('await fetchRegisteredHolidays(startVal, endVal)');
        expect(detailSlice).toContain('await fetchRegisteredHolidays(`${bulan}-01`, `${bulan}-31`)');
    });
});
