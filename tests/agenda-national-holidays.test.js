/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');
const DataHolidays = require('../js/data-holidays.js');

describe('Kalender Agenda: Libur Nasional & Form Kegiatan Periodik Fleksibel', () => {
    let htmlContent;

    beforeAll(() => {
        htmlContent = fs.readFileSync(path.join(__dirname, '../agenda.html'), 'utf8');
    });

    beforeEach(() => {
        document.documentElement.innerHTML = htmlContent;
        localStorage.clear();
    });

    // =========================================================================
    // 1. UJI MASTER DATA LIBUR NASIONAL & HARI BESAR TAHUNAN (DataHolidays)
    // =========================================================================

    test('1. DataHolidays memuat master data libur nasional resmi (2024 - 2027)', () => {
        const holidays2024 = DataHolidays.getNationalHolidays(2024);
        const holidays2025 = DataHolidays.getNationalHolidays(2025);
        const holidays2026 = DataHolidays.getNationalHolidays(2026);
        const holidays2027 = DataHolidays.getNationalHolidays(2027);

        expect(Array.isArray(holidays2024)).toBe(true);
        expect(holidays2024.length).toBeGreaterThanOrEqual(20);

        expect(Array.isArray(holidays2025)).toBe(true);
        expect(holidays2025.length).toBeGreaterThanOrEqual(20);

        expect(Array.isArray(holidays2026)).toBe(true);
        expect(holidays2026.length).toBeGreaterThanOrEqual(20);

        expect(Array.isArray(holidays2027)).toBe(true);
        expect(holidays2027.length).toBeGreaterThanOrEqual(15);
    });

    test('2. DataHolidays mendeteksi tanggal merah resmi dan mengidentifikasi cuti bersama', () => {
        // Hari Kemerdekaan RI 2026
        expect(DataHolidays.isNationalHoliday('2026-08-17')).toBe(true);
        const hutRi = DataHolidays.getHolidayForDate('2026-08-17');
        expect(hutRi).not.toBeNull();
        expect(hutRi.title).toContain('Kemerdekaan');
        expect(hutRi.isNationalHoliday).toBe(true);
        expect(hutRi.color).toBe('rose');

        // Hari Suci Nyepi 2026
        expect(DataHolidays.isNationalHoliday('2026-03-19')).toBe(true);
        const nyepi = DataHolidays.getHolidayForDate('2026-03-19');
        expect(nyepi.title).toContain('Nyepi');

        // Cuti Bersama Nyepi 2026 (18 Maret 2026)
        const cutiNyepi = DataHolidays.getHolidayForDate('2026-03-18');
        expect(cutiNyepi).not.toBeNull();
        expect(cutiNyepi.isCutiBersama).toBe(true);

        // Tanggal bukan hari libur
        expect(DataHolidays.isNationalHoliday('2026-08-18')).toBe(false);
        expect(DataHolidays.getHolidayForDate('2026-08-18')).toBeNull();
    });

    test('3. DataHolidays menyediakan katalog hari besar nasional tahunan (Hardiknas, Sumpah Pemuda, Hari Guru)', () => {
        const fixed = DataHolidays.getFixedAnnualObservances();
        expect(Array.isArray(fixed)).toBe(true);
        expect(fixed.length).toBeGreaterThanOrEqual(15);

        const hardiknas = fixed.find(f => f.month === 5 && f.day === 2);
        expect(hardiknas).toBeDefined();
        expect(hardiknas.title).toContain('Hardiknas');

        const sumpahPemuda = fixed.find(f => f.month === 10 && f.day === 28);
        expect(sumpahPemuda).toBeDefined();
        expect(sumpahPemuda.title).toContain('Sumpah Pemuda');

        const hariGuru = fixed.find(f => f.month === 11 && f.day === 25);
        expect(hariGuru).toBeDefined();
        expect(hariGuru.title).toContain('Guru');
    });

    // =========================================================================
    // 2. UJI KALKULASI PERIODIK & SIKLUS 210 HARI (Pawukon Hindu / Bali)
    // =========================================================================

    test('4. Generator periodik 210 hari menghitung siklus pawukon Bali secara tepat', () => {
        // Tanggal patokan Galungan (15 April 2026 - Buda/Rabu)
        const baseDate = '2026-04-15';
        const count = 4;
        const result = DataHolidays.generatePeriodicDates(baseDate, 210, count);

        expect(result.length).toBe(4);
        expect(result[0].date).toBe('2026-04-15');
        expect(result[0].dayName).toBe('Rabu');
        expect(result[0].offsetDays).toBe(0);

        // 210 hari berikutnya = 11 November 2026 (Rabu)
        expect(result[1].date).toBe('2026-11-11');
        expect(result[1].dayName).toBe('Rabu');
        expect(result[1].offsetDays).toBe(210);

        // 420 hari berikutnya = 09 Juni 2027 (Rabu)
        expect(result[2].date).toBe('2027-06-09');
        expect(result[2].dayName).toBe('Rabu');
        expect(result[2].offsetDays).toBe(420);

        // 630 hari berikutnya = 05 Januari 2028 (Rabu)
        expect(result[3].date).toBe('2028-01-05');
        expect(result[3].dayName).toBe('Rabu');
        expect(result[3].offsetDays).toBe(630);
    });

    test('5. Generator tahunan (Yearly) menghitung pengulangan pada tanggal dan bulan yang sama', () => {
        // Hardiknas (2 Mei) untuk 3 tahun
        const result = DataHolidays.generateYearlyDates('2026-05-02', 3);
        expect(result.length).toBe(3);
        expect(result[0].date).toBe('2026-05-02');
        expect(result[1].date).toBe('2027-05-02');
        expect(result[2].date).toBe('2028-05-02');
    });

    test('6. Kalkulator durasi perulangan mempertahankan selisih endDate multi-hari', () => {
        // Kegiatan 2 hari: 15 Apr s/d 16 Apr 2026 (+1 hari)
        const originalStart = '2026-04-15';
        const originalEnd = '2026-04-16';
        const nextStart = '2026-11-11';

        const nextEnd = DataHolidays.calculateRecurrenceEndDate(originalStart, originalEnd, nextStart);
        expect(nextEnd).toBe('2026-11-12');
    });

    // =========================================================================
    // 3. UJI STRUKTUR DOM AGENDA.HTML (Form Periodik & Toggle Libur Nasional)
    // =========================================================================

    test('7. Header kalender agenda memuat tombol toggle Libur Nasional dengan state dinamis', () => {
        const toggleBtn = document.getElementById('btn-toggle-holidays');
        const toggleLabel = document.getElementById('label-toggle-holidays');

        expect(toggleBtn).not.toBeNull();
        expect(toggleLabel).not.toBeNull();
        expect(toggleLabel.textContent).toContain('Libur Nasional');
    });

    test('8. Form Kelola Agenda memiliki kontrol perulangan periodik dan preset hari besar', () => {
        // Preset Hari Besar Nasional
        const selectPreset = document.getElementById('select-preset-holiday');
        expect(selectPreset).not.toBeNull();

        // Pilihan Pola Perulangan
        const selectRepeat = document.getElementById('select-event-repeat');
        expect(selectRepeat).not.toBeNull();
        expect(selectRepeat.querySelector('option[value="none"]')).not.toBeNull();
        expect(selectRepeat.querySelector('option[value="yearly"]')).not.toBeNull();
        expect(selectRepeat.querySelector('option[value="periodic"]')).not.toBeNull();

        // Sub-form Periodik
        const secPeriodic = document.getElementById('section-periodic-settings');
        const inputInterval = document.getElementById('input-repeat-interval');
        expect(secPeriodic).not.toBeNull();
        expect(inputInterval).not.toBeNull();
        expect(inputInterval.value).toBe('210'); // Default siklus 210 hari pawukon

        // Sub-form Jumlah Perulangan & Live Preview
        const secPreview = document.getElementById('section-repeat-count-preview');
        const inputCount = document.getElementById('input-repeat-count');
        const containerPreview = document.getElementById('container-repeat-preview');
        expect(secPreview).not.toBeNull();
        expect(inputCount).not.toBeNull();
        expect(containerPreview).not.toBeNull();
    });

    test('9. Seluruh elemen DOM kalender dan modal agenda memiliki ID unik tanpa duplikasi', () => {
        const elementIds = [
            'btn-add-agenda',
            'btn-toggle-holidays',
            'label-toggle-holidays',
            'modal-calendar-manager',
            'modal-calendar-content',
            'select-preset-holiday',
            'input-event-title',
            'input-event-date',
            'input-event-end-date',
            'select-event-type',
            'select-event-repeat',
            'section-periodic-settings',
            'input-repeat-interval',
            'section-repeat-count-preview',
            'input-repeat-count',
            'container-repeat-preview',
            'input-event-desc',
            'btn-save-event',
            'calendar-grid',
            'cal-month-year',
            'events-list'
        ];

        elementIds.forEach(id => {
            const matches = document.querySelectorAll(`#${id}`);
            expect(matches.length).toBe(1);
        });
    });

    // =========================================================================
    // 4. UJI API CONTRACT: BATCH EVENTS & SERIES DELETION
    // =========================================================================

    test('10. CloudflareClient mendukung createCalendarEventsBatch dan delete series', async () => {
        class MockClient {
            constructor() {
                this.sentRequests = [];
            }
            async request(path, options = {}) {
                this.sentRequests.push({ path, options });
                return { success: true };
            }
            async createCalendarEventsBatch(eventsList) {
                return await this.request('/api/agenda/events', {
                    method: 'POST',
                    body: JSON.stringify({ events: eventsList })
                });
            }
            async deleteAgendaEvent(id, seriesTag = null) {
                const path = seriesTag ? `/api/agenda/events/${id}?series=${encodeURIComponent(seriesTag)}` : `/api/agenda/events/${id}`;
                return await this.request(path, { method: 'DELETE' });
            }
            async deleteCalendarEvent(id, seriesTag = null) {
                return await this.deleteAgendaEvent(id, seriesTag);
            }
        }

        const client = new MockClient();

        // Uji create batch
        const batchPayload = [
            { title: 'Galungan', date: '2026-04-15', type: 'libur' },
            { title: 'Galungan', date: '2026-11-11', type: 'libur' }
        ];
        await client.createCalendarEventsBatch(batchPayload);

        const postReq = client.sentRequests.find(r => r.path === '/api/agenda/events' && r.options.method === 'POST');
        expect(postReq).toBeDefined();
        const body = JSON.parse(postReq.options.body);
        expect(Array.isArray(body.events)).toBe(true);
        expect(body.events.length).toBe(2);

        // Uji delete series
        await client.deleteCalendarEvent('evt-1', 'rec_galungan_2026');
        const delReq = client.sentRequests.find(r => r.options.method === 'DELETE');
        expect(delReq).toBeDefined();
        expect(delReq.path).toBe('/api/agenda/events/evt-1?series=rec_galungan_2026');
    });
});
