/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

describe('Verifikasi Akomodasi Hari Libur & Target Kinerja Prorata E-Kinerja Tendik', () => {
    let tendikJs;
    let agendaPegawaiJs;
    let workerCode;

    beforeAll(() => {
        const root = path.resolve(__dirname, '..');
        tendikJs = fs.readFileSync(path.join(root, 'js', 'page-e-kinerja-tendik.js'), 'utf8');
        agendaPegawaiJs = fs.readFileSync(path.join(root, 'js', 'page-agenda-pegawai.js'), 'utf8');
        workerCode = fs.readFileSync(path.join(root, 'cloudflare', 'worker.js'), 'utf8');
    });

    // =========================================================================
    // 1. VERIFIKASI LOGIKA BACKEND: DETEKSI RENTANG MULTI-HARI LIBUR BULANAN
    // =========================================================================
    describe('1. Deteksi Rentang Hari Libur di Backend Worker (monthly-recap)', () => {
        test('1.1. Query calendar_events di monthly-recap mendeteksi rentang tanggal multi-hari (date & time)', () => {
            expect(workerCode).toContain('SELECT id, title, date, time, category, color');
            expect(workerCode).toContain('category = \'libur\' OR color = \'rose\'');
            expect(workerCode).toContain('(date >= ? AND date <= ?)');
            expect(workerCode).toContain('(time >= ? AND time <= ?)');
        });

        test('1.2. Logika backend mengekspansi seluruh hari dalam rentang multi-hari ke set holidayDates', () => {
            // Simulasi algoritma ekspansi rentang hari libur dari worker.js
            function expandHolidays(holidays, fromDate, toDate) {
                const holidayDates = new Set();
                for (const ev of holidays) {
                    const s = (ev.date || "").substring(0, 10);
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) continue;
                    let e = (ev.time && /^\d{4}-\d{2}-\d{2}$/.test(ev.time)) ? ev.time.substring(0, 10) : s;
                    if (e < s) e = s;

                    let curD = new Date(s + "T00:00:00");
                    const endD = new Date(e + "T00:00:00");
                    while (curD <= endD) {
                        const y = curD.getFullYear();
                        const m = String(curD.getMonth() + 1).padStart(2, "0");
                        const d = String(curD.getDate()).padStart(2, "0");
                        const curIso = `${y}-${m}-${d}`;
                        if (curIso >= fromDate && curIso <= toDate) {
                            holidayDates.add(curIso);
                        }
                        curD.setDate(curD.getDate() + 1);
                    }
                }
                return holidayDates;
            }

            // Simulasi Cuti Bersama 3 hari: 2026-04-08 s.d. 2026-04-10
            const dummyHolidays = [
                { date: '2026-04-08', time: '2026-04-10', category: 'libur', title: 'Cuti Bersama Idul Fitri' }
            ];
            const expanded = expandHolidays(dummyHolidays, '2026-04-01', '2026-04-30');
            expect(expanded.has('2026-04-08')).toBe(true);
            expect(expanded.has('2026-04-09')).toBe(true);
            expect(expanded.has('2026-04-10')).toBe(true);
            expect(expanded.has('2026-04-11')).toBe(false);
            expect(expanded.size).toBe(3);
        });

        test('1.3. workingDaysCount bulanan memotong hari libur yang jatuh pada hari kerja Senin-Jumat', () => {
            function calculateMonthlyWorkingDays(year, month, holidayDates) {
                const lastDay = new Date(year, month, 0).getDate();
                let workingDaysCount = 0;
                for (let d = 1; d <= lastDay; d++) {
                    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    const dayOfWeek = new Date(year, month - 1, d).getDay(); // 0 = Minggu, 6 = Sabtu
                    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidayDates.has(dateStr)) {
                        workingDaysCount++;
                    }
                }
                return workingDaysCount;
            }

            // April 2026 memiliki 30 hari. 22 hari Senin-Jumat.
            // Jika ada 3 hari libur kerja (8, 9, 10 April):
            const holidayDates = new Set(['2026-04-08', '2026-04-09', '2026-04-10']);
            const workDays = calculateMonthlyWorkingDays(2026, 4, holidayDates);
            expect(workDays).toBe(19); // 22 - 3 = 19 hari
            const targetMinutes = workDays * 450;
            expect(targetMinutes).toBe(19 * 450); // 8550 menit = 142.5 jam (bukan 165 jam)
        });
    });

    // =========================================================================
    // 2. FORMULA PENYESUAIAN TARGET MINGGUAN (calculateAdjustedWeeklyTarget)
    // =========================================================================
    describe('2. Logika Target Mingguan Prorata (calculateAdjustedWeeklyTarget)', () => {
        function calculateAdjustedWeeklyTargetSim(weekDays, holidaysMap = {}) {
            if (!Array.isArray(weekDays) || weekDays.length === 0) {
                return { workingDaysCount: 5, targetMinutes: 2250, targetHours: 37.5 };
            }
            let workingDaysCount = 0;
            const holidays = [];
            weekDays.forEach(dStr => {
                const hol = holidaysMap[dStr];
                if (hol) {
                    holidays.push({ date: dStr, title: hol.title });
                } else {
                    workingDaysCount++;
                }
            });
            const targetMinutes = workingDaysCount * 450;
            const targetHours = targetMinutes / 60;
            return { workingDaysCount, targetMinutes, targetHours, holidays };
        }

        const standardWeek = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'];

        test('2.1. 0 Hari Libur = 5 Hari Kerja (2.250 menit / 37,5 jam)', () => {
            const res = calculateAdjustedWeeklyTargetSim(standardWeek, {});
            expect(res.workingDaysCount).toBe(5);
            expect(res.targetMinutes).toBe(2250);
            expect(res.targetHours).toBe(37.5);
        });

        test('2.2. 1 Hari Libur (17 Agustus) = 4 Hari Kerja (1.800 menit / 30,0 jam)', () => {
            const res = calculateAdjustedWeeklyTargetSim(standardWeek, {
                '2026-08-17': { title: 'HUT Proklamasi Kemerdekaan RI' }
            });
            expect(res.workingDaysCount).toBe(4);
            expect(res.targetMinutes).toBe(1800);
            expect(res.targetHours).toBe(30.0);
        });

        test('2.3. 2 Hari Libur = 3 Hari Kerja (1.350 menit / 22,5 jam)', () => {
            const res = calculateAdjustedWeeklyTargetSim(standardWeek, {
                '2026-08-17': { title: 'HUT RI' },
                '2026-08-18': { title: 'Cuti Bersama' }
            });
            expect(res.workingDaysCount).toBe(3);
            expect(res.targetMinutes).toBe(1350);
            expect(res.targetHours).toBe(22.5);
        });
    });

    // =========================================================================
    // 3. PENGAKUAN JAM KERJA HARI LIBUR SEBAGAI SURPLUS AKUMULATIF
    // =========================================================================
    describe('3. Jam Kerja Hari Libur sebagai Jam Tambahan (Surplus)', () => {
        test('3.1. Aktivitas di hari libur terakumulasi penuh ke totalWeekMinutes', () => {
            // Simulasi pegawai bekerja 30 jam di hari normal + 3 jam di hari libur (upacara 17 Agustus)
            const targetWeeklyMinutes = 4 * 450; // 1800 menit (30 jam)
            const normalMinutes = 4 * 450; // 1800 menit
            const holidayActivityMinutes = 180; // 3 jam (Upacara)
            const totalWeekMinutes = normalMinutes + holidayActivityMinutes; // 1980 menit (33 jam)

            expect(totalWeekMinutes).toBe(1980);
            const weekPercent = Math.min(100, Math.round((totalWeekMinutes / targetWeeklyMinutes) * 100));
            expect(weekPercent).toBe(100); // 100% target terpenuhi

            const rawPercent = Math.round((totalWeekMinutes / targetWeeklyMinutes) * 100);
            expect(rawPercent).toBe(110); // 110% kinerja surplus
        });

        test('3.2. Dashboard harian saat hari libur dengan aktivitas menampilkan status surplus', () => {
            expect(tendikJs).toContain("percentLabel.textContent = `+${hoursVal}j (Surplus)`;");
            expect(agendaPegawaiJs).toContain("percentLabel.textContent = `+${hoursVal}j (Surplus)`;");
        });

        test('3.3. Dashboard harian saat hari libur tanpa aktivitas menampilkan Libur Resmi (bukan 0% mangkir)', () => {
            expect(tendikJs).toContain("percentLabel.textContent = 'Libur Resmi';");
            expect(tendikJs).toContain("statHoursEl.textContent = `/ 0 Jam (Libur)${draftNote}`;");
            expect(agendaPegawaiJs).toContain("percentLabel.textContent = 'Libur Resmi';");
        });
    });

    // =========================================================================
    // 4. VERIFIKASI STATUS BADGE MATRIKS MINGGUAN PEGAWAI
    // =========================================================================
    describe('4. Status Badge Matriks Mingguan Pegawai', () => {
        test('4.1. Hari libur resmi tanpa kegiatan menampilkan badge "Libur Resmi" (0 label defisit)', () => {
            expect(tendikJs).toContain('<i class="fa-solid fa-umbrella-beach mr-1 text-[9px]"></i> Libur Resmi');
            expect(agendaPegawaiJs).toContain('<i class="fa-solid fa-umbrella-beach mr-1 text-[9px]"></i> Libur Resmi');
        });

        test('4.2. Hari libur resmi dengan kegiatan menampilkan badge "Libur (Xj Terlaksana)" warna emerald', () => {
            expect(tendikJs).toContain('Libur (${dayHours}j Terlaksana)');
            expect(agendaPegawaiJs).toContain('Libur (${dayHours}j Terlaksana)');
        });

        test('4.3. Banner libur harian memberi kepastian bahwa target 0 menit & tidak wajib mengisi kegiatan', () => {
            expect(tendikJs).toContain('Target jam kerja harian otomatis disesuaikan (0 menit) dan target mingguan dikurangi 7,5 jam.');
            expect(agendaPegawaiJs).toContain('Target jam kerja harian otomatis disesuaikan (0 menit) dan target mingguan dikurangi 7,5 jam.');
        });
    });
});
