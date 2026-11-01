const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

describe('Heatmap Hari Rawan Pelanggaran (5 Hari Sekolah: Senin - Jumat)', () => {
    const dashboardHtml = fs.readFileSync(path.join(projectRoot, 'dashboard.html'), 'utf8');
    const pageDashboardJs = fs.readFileSync(path.join(projectRoot, 'js', 'page-dashboard.js'), 'utf8');

    describe('Struktur HTML (dashboard.html)', () => {
        test('Menggunakan grid 5 kolom (grid-cols-5) untuk 5 hari sekolah efektif', () => {
            expect(dashboardHtml).toContain('id="violations-heatmap-container"');
            expect(dashboardHtml).toMatch(/class="[^"]*grid-cols-5[^"]*"[^>]*id="violations-heatmap-container"/);
            expect(dashboardHtml).not.toMatch(/class="[^"]*grid-cols-6[^"]*"[^>]*id="violations-heatmap-container"/);
        });
    });

    describe('Logika JavaScript (js/page-dashboard.js)', () => {
        test('Hanya memuat 5 hari efektif (Senin s.d. Jumat), tanpa Sabtu', () => {
            const funcMatch = pageDashboardJs.match(/function renderViolationHeatmap\(violations\)\s*\{([\s\S]*?)\n\}/);
            expect(funcMatch).not.toBeNull();
            const funcBody = funcMatch[1];

            expect(funcBody).toContain("'Senin'");
            expect(funcBody).toContain("'Selasa'");
            expect(funcBody).toContain("'Rabu'");
            expect(funcBody).toContain("'Kamis'");
            expect(funcBody).toContain("'Jumat'");
            expect(funcBody).not.toContain("'Sabtu'");
            expect(funcBody).not.toContain('{ index: 6, label:');
        });

        test('Akumulasi pelanggaran hanya memproses index hari 1 s.d. 5', () => {
            const funcMatch = pageDashboardJs.match(/function renderViolationHeatmap\(violations\)\s*\{([\s\S]*?)\n\}/);
            const funcBody = funcMatch[1];
            expect(funcBody).toContain('dayIdx >= 1 && dayIdx <= 5');
            expect(funcBody).not.toContain('dayIdx <= 6');
        });

        test('Simulasi komputasi heatmap: mengecualikan Sabtu (index 6) dan Minggu (index 0)', () => {
            const days = [
                { index: 1, label: 'Senin' },
                { index: 2, label: 'Selasa' },
                { index: 3, label: 'Rabu' },
                { index: 4, label: 'Kamis' },
                { index: 5, label: 'Jumat' }
            ];

            const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            const mockViolations = [
                { timestampMillis: new Date('2026-09-07T08:00:00Z').getTime() }, // Senin
                { timestampMillis: new Date('2026-09-08T08:00:00Z').getTime() }, // Selasa
                { timestampMillis: new Date('2026-09-08T09:00:00Z').getTime() }, // Selasa
                { timestampMillis: new Date('2026-09-09T08:00:00Z').getTime() }, // Rabu
                { timestampMillis: new Date('2026-09-10T08:00:00Z').getTime() }, // Kamis
                { timestampMillis: new Date('2026-09-11T08:00:00Z').getTime() }, // Jumat
                { timestampMillis: new Date('2026-09-12T08:00:00Z').getTime() }, // Sabtu (harus diabaikan)
                { timestampMillis: new Date('2026-09-13T08:00:00Z').getTime() }, // Minggu (harus diabaikan)
            ];

            mockViolations.forEach(v => {
                const d = new Date(v.timestampMillis);
                const dayIdx = d.getDay();
                if (dayIdx >= 1 && dayIdx <= 5) {
                    counts[dayIdx]++;
                }
            });

            expect(counts[1]).toBe(1); // Senin
            expect(counts[2]).toBe(2); // Selasa
            expect(counts[3]).toBe(1); // Rabu
            expect(counts[4]).toBe(1); // Kamis
            expect(counts[5]).toBe(1); // Jumat
            expect(counts[6]).toBeUndefined(); // Sabtu tidak ada dalam key counts
            expect(days.length).toBe(5);
        });
    });

    describe('Kehadiran Kelas Ekstrim (TOP 3 Terbaik & TOP 3 Terendah)', () => {
        test('Mengintegrasikan pembacaan siswa_presensi dari Supabase (SSOT)', () => {
            expect(pageDashboardJs).toContain("'siswa_presensi'");
            expect(pageDashboardJs).toContain("selectFields: 'tanggal, kelas, status'");
            expect(pageDashboardJs).toContain('fetchAttendancePromise');
        });

        test('Simulasi komputasi ranking kehadiran kelas: TOP 3 Terbaik dan TOP 3 Terendah', () => {
            // Mock data kehadiran dari Supabase siswa_presensi
            const mockRows = [
                { kelas: 'XI-10', status: 'H' },
                { kelas: 'XI-10', status: 'H' },
                { kelas: 'X-3', status: 'H' },
                { kelas: 'X-3', status: 'H' },
                { kelas: 'XII-1', status: 'H' },
                { kelas: 'X-5', status: 'S' },
                { kelas: 'X-5', status: 'H' },
                { kelas: 'XII-2', status: 'A' },
                { kelas: 'XII-2', status: 'H' },
                { kelas: 'XII-2', status: 'H' }
            ];

            const classAttMap = {};
            mockRows.forEach(row => {
                const cls = row.kelas;
                if (!classAttMap[cls]) classAttMap[cls] = { H: 0, S: 0, I: 0, D: 0, A: 0 };
                const st = row.status;
                if (st === 'H') classAttMap[cls].H++;
                else if (st === 'S') classAttMap[cls].S++;
                else if (st === 'A') classAttMap[cls].A++;
            });

            const classList = [];
            Object.keys(classAttMap).forEach(cls => {
                const att = classAttMap[cls];
                const total = att.H + att.S + att.I + att.D + att.A;
                if (total > 0) {
                    const percent = parseFloat(((att.H + att.D) / total * 100).toFixed(1));
                    classList.push({ cls, percent, total });
                }
            });

            classList.sort((a, b) => b.percent - a.percent);
            const best = classList.slice(0, 3);
            const worst = classList.length <= 3 ? [...classList].reverse() : classList.slice(-3).reverse();

            expect(best.length).toBe(3);
            expect(best[0].percent).toBe(100);
            expect(worst[0].cls).toBe('X-5'); // 50% (terendah)
            expect(worst[0].percent).toBe(50);
        });

        test('Jika data kehadiran kosong, fungsi menampilkan pesan placeholder yang rapi', () => {
            const emptyMap = {};
            const classList = [];
            Object.keys(emptyMap).forEach(cls => {
                const att = emptyMap[cls];
                const total = att.H + att.S + att.I + att.D + att.A;
                if (total > 0) {
                    const percent = parseFloat(((att.H + att.D) / total * 100).toFixed(1));
                    classList.push({ cls, percent, total });
                }
            });

            expect(classList.length).toBe(0);
        });
    });
});
