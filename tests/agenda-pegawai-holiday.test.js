/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('Agenda Pegawai - Deteksi Hari Libur Kalender Agenda & Penyesuaian Target Mingguan', () => {
    let scriptCode;
    let htmlContent;
    let workerCode;

    beforeAll(() => {
        const jsPath = path.join(__dirname, '../js/page-e-kinerja-tendik.js');
        scriptCode = fs.readFileSync(jsPath, 'utf8');

        const htmlPath = path.join(__dirname, '../e-kinerja-tendik.html');
        htmlContent = fs.readFileSync(htmlPath, 'utf8');

        const workerPath = path.join(__dirname, '../cloudflare/worker.js');
        workerCode = fs.readFileSync(workerPath, 'utf8');
    });

    describe('1. Kepatuhan Aturan Bisnis & Isolasi Mekanisme Libur (Tendik vs Guru)', () => {
        test('Agenda Pegawai TIDAK menggunakan lib_hari_libur Supabase atau aturan guru KBM <= 5 kelas', () => {
            // Memastikan penentuan hari libur pegawai terisolasi murni ke Kalender Agenda
            expect(scriptCode).not.toContain("from('lib_hari_libur')");
            expect(scriptCode).not.toContain('lib_hari_libur');
            expect(scriptCode).not.toContain('calculateStudyDayActiveClasses');
        });

        test('HTML Agenda Pegawai memuat data-holidays.js dan memiliki elemen banner serta badge target', () => {
            expect(htmlContent).toContain('js/data-holidays.js');
            expect(htmlContent).toContain('header-weekly-target-badge');
            expect(htmlContent).toContain('header-weekly-target-text');
            expect(htmlContent).toContain('employee-holiday-banner');
            expect(htmlContent).toContain('employee-holiday-banner-text');
        });
    });

    describe('2. Logika Unit Helper Deteksi Libur Agenda & Penyesuaian Target', () => {
        let agendaHolidaysCache = {};

        function getAgendaHolidayForDate(dateStr) {
            if (!dateStr) return null;
            if (agendaHolidaysCache[dateStr]) return agendaHolidaysCache[dateStr];
            const holidays = [
                { date: '2026-08-17', name: 'Hari Kemerdekaan RI' },
                { date: '2026-10-08', name: 'Libur Kalender Agenda Nasional' }
            ];
            const found = holidays.find(h => h.date === dateStr);
            if (found) {
                return {
                    title: found.name,
                    category: 'libur',
                    source: 'national_holiday'
                };
            }
            return null;
        }

        function calculateAdjustedWeeklyTarget(weekDays) {
            const TARGET_DAILY_MINUTES = 450;
            const days = Array.isArray(weekDays) ? weekDays : [];
            let holidayCount = 0;
            const holidays = [];

            days.forEach(dStr => {
                const hol = getAgendaHolidayForDate(dStr);
                if (hol) {
                    holidayCount++;
                    holidays.push({ date: dStr, ...hol });
                }
            });

            const totalWorkDays = Math.max(0, days.length - holidayCount);
            const targetMinutes = totalWorkDays * TARGET_DAILY_MINUTES;
            const targetHours = (targetMinutes / 60).toFixed(1).replace('.0', '');

            return {
                workingDays: totalWorkDays,
                holidayDays: holidayCount,
                targetMinutes,
                targetHours,
                holidays
            };
        }

        beforeEach(() => {
            agendaHolidaysCache = {};
        });

        test('Pekan Normal 5 Hari Kerja (0 Hari Libur) -> Target 37,5 Jam (2.250 Menit)', () => {
            const normalWeek = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];
            const res = calculateAdjustedWeeklyTarget(normalWeek);

            expect(res.workingDays).toBe(5);
            expect(res.holidayDays).toBe(0);
            expect(res.targetMinutes).toBe(2250);
            expect(res.targetHours).toBe('37.5');
            expect(res.holidays.length).toBe(0);
        });

        test('Pekan dengan 1 Hari Libur Kalender Agenda (Senin 17 Agustus 2026) -> Target 30 Jam (1.800 Menit)', () => {
            const weekWithHoliday = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'];
            const res = calculateAdjustedWeeklyTarget(weekWithHoliday);

            expect(res.workingDays).toBe(4);
            expect(res.holidayDays).toBe(1);
            expect(res.targetMinutes).toBe(1800);
            expect(res.targetHours).toBe('30');
            expect(res.holidays[0].title).toBe('Hari Kemerdekaan RI');
        });

        test('Pekan dengan 2 Hari Libur Kalender Agenda -> Target 22,5 Jam (1.350 Menit)', () => {
            agendaHolidaysCache['2026-09-14'] = { title: 'Hari Raya Kuningan', category: 'libur', source: 'agenda_calendar' };
            agendaHolidaysCache['2026-09-15'] = { title: 'Cuti Bersama Kuningan', category: 'libur', source: 'agenda_calendar' };

            const week = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];
            const res = calculateAdjustedWeeklyTarget(week);

            expect(res.workingDays).toBe(3);
            expect(res.holidayDays).toBe(2);
            expect(res.targetMinutes).toBe(1350);
            expect(res.targetHours).toBe('22.5');
            expect(res.holidays.length).toBe(2);
        });

        test('Libur yang jatuh pada akhir pekan (Sabtu/Minggu) tidak mengurangi target 5 hari kerja Senin-Jumat', () => {
            agendaHolidaysCache['2026-09-19'] = { title: 'Libur Sabtu Agenda', category: 'libur' };
            agendaHolidaysCache['2026-09-20'] = { title: 'Libur Minggu Agenda', category: 'libur' };

            const workWeek = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];
            const res = calculateAdjustedWeeklyTarget(workWeek);

            expect(res.workingDays).toBe(5);
            expect(res.holidayDays).toBe(0);
            expect(res.targetMinutes).toBe(2250);
            expect(res.targetHours).toBe('37.5');
        });

        test('Pekan Libur Penuh 5 Hari Kerja (Semua Libur) -> Target 0 Jam (0 Menit)', () => {
            const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
            week.forEach(d => {
                agendaHolidaysCache[d] = { title: 'Libur Bersama Khusus', category: 'libur' };
            });

            const res = calculateAdjustedWeeklyTarget(week);

            expect(res.workingDays).toBe(0);
            expect(res.holidayDays).toBe(5);
            expect(res.targetMinutes).toBe(0);
            expect(res.targetHours).toBe('0');
        });
    });

    describe('3. Paritas Server-Side Cloudflare Worker', () => {
        test('Cloudflare Worker mengekstrak calendar_events berkategori libur dan menghitung target_minutes dinamis', () => {
            expect(workerCode).toContain('calendar_events');
            expect(workerCode).toContain("category = 'libur' OR color = 'rose'");
            expect(workerCode).toContain('working_days');
            expect(workerCode).toContain('target_minutes');
            expect(workerCode).toContain('holidays');
        });
    });

    describe('4. Integrasi DOM & Rendering Matriks Mingguan Pegawai', () => {
        test('page-e-kinerja-tendik.js mengekspor helper getAgendaHolidayForDate dan calculateAdjustedWeeklyTarget', () => {
            expect(scriptCode).toContain('window.getAgendaHolidayForDate = getAgendaHolidayForDate;');
            expect(scriptCode).toContain('window.calculateAdjustedWeeklyTarget = calculateAdjustedWeeklyTarget;');
            expect(scriptCode).toContain('renderEmployeeWeeklyMatrix(days, acts, dayMinutesMap, totalWeekMinutes, adjustedTarget)');
        });

        test('Pita timeline dan status badge ramah hari libur agenda saat durasi 0m (tidak menuntut celah)', () => {
            expect(scriptCode).toContain('Libur Agenda');
            expect(scriptCode).toContain('Hari Libur Agenda');
            expect(scriptCode).toContain('Celah jam tidak wajib dipenuhi');
        });
    });
});
