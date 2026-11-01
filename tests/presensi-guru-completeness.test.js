const {
    isBlockedJPDefault,
    calculateClassCompleteness,
    updateCompletenessCache,
    getPreviousSchoolDay,
    formatIndonesianDate,
    evaluatePreviousDayCompleteness
} = require("./presensi-guru-completeness");

describe("Presensi Guru Completeness & Cache Update Logic", () => {
    test("Menghitung kelengkapan presensi guru untuk hari reguler (10 JP)", () => {
        const savedJPData = {};
        for (let i = 1; i <= 10; i++) {
            savedJPData[i] = {
                mapel: `Mapel ${i}`,
                guru_nama: `Guru ${i}`,
                status: 'H'
            };
        }

        const result = calculateClassCompleteness("X-1", 2, savedJPData, isBlockedJPDefault);
        expect(result.kelas).toBe("X-1");
        expect(result.savedCount).toBe(10);
        expect(result.totalRequiredJP).toBe(10);
        expect(result.missingJPs).toEqual([]);
        expect(result.isComplete).toBe(true);
    });

    test("Menghitung kelengkapan presensi guru untuk hari Senin (JP 1 Upacara di-block -> 9 JP required)", () => {
        const savedJPData = {};
        // Senin JP 1 diblokir, jadi JP 2..10 terisi
        for (let i = 2; i <= 10; i++) {
            savedJPData[i] = {
                mapel: `Mapel ${i}`,
                guru_nama: `Guru ${i}`,
                status: 'H'
            };
        }

        const result = calculateClassCompleteness("X-8", 1, savedJPData, isBlockedJPDefault);
        expect(result.kelas).toBe("X-8");
        expect(result.savedCount).toBe(9);
        expect(result.totalRequiredJP).toBe(9);
        expect(result.missingJPs).toEqual([]);
        expect(result.isComplete).toBe(true);
    });

    test("Menghitung kelengkapan presensi guru saat masih ada JP kosong (belum lengkap)", () => {
        const savedJPData = {
            1: { mapel: "Matematika", guru_nama: "Pak Budi", status: "H" },
            2: { mapel: "Matematika", guru_nama: "Pak Budi", status: "H" }
        };

        const result = calculateClassCompleteness("XI-2", 3, savedJPData, isBlockedJPDefault);
        expect(result.kelas).toBe("XI-2");
        expect(result.savedCount).toBe(2);
        expect(result.totalRequiredJP).toBe(10);
        expect(result.missingJPs).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
        expect(result.isComplete).toBe(false);
    });

    test("Memperbarui status kelas aktif di completeness cache secara lokal", () => {
        const initialCache = [
            { kelas: "X-1", savedCount: 0, totalRequiredJP: 10, missingJPs: [1,2,3,4,5,6,7,8,9,10], isComplete: false },
            { kelas: "X-8", savedCount: 0, totalRequiredJP: 10, missingJPs: [1,2,3,4,5,6,7,8,9,10], isComplete: false }
        ];

        const savedJPDataX8 = {};
        for (let i = 1; i <= 10; i++) {
            savedJPDataX8[i] = { mapel: `Mapel ${i}`, guru_nama: `Guru ${i}`, status: 'H' };
        }

        const updatedCache = updateCompletenessCache(initialCache, "X-8", 2, savedJPDataX8, isBlockedJPDefault);
        
        // Kelas X-1 tetap belum lengkap
        expect(updatedCache[0].isComplete).toBe(false);
        // Kelas X-8 sekarang lengkap
        expect(updatedCache[1].kelas).toBe("X-8");
        expect(updatedCache[1].savedCount).toBe(10);
        expect(updatedCache[1].missingJPs).toEqual([]);
        expect(updatedCache[1].isComplete).toBe(true);
    });

    test("getPreviousSchoolDay: Menghitung hari sekolah aktif sebelumnya", () => {
        // Senin 2026-09-07 -> Jumat sebelumnya (2026-09-04)
        expect(getPreviousSchoolDay("2026-09-07")).toBe("2026-09-04");

        // Selasa 2026-09-08 -> Senin (2026-09-07)
        expect(getPreviousSchoolDay("2026-09-08")).toBe("2026-09-07");

        // Rabu 2026-09-09 -> Selasa (2026-09-08)
        expect(getPreviousSchoolDay("2026-09-09")).toBe("2026-09-08");

        // Kamis 2026-09-10 -> Rabu (2026-09-09)
        expect(getPreviousSchoolDay("2026-09-10")).toBe("2026-09-09");

        // Jumat 2026-09-11 -> Kamis (2026-09-10)
        expect(getPreviousSchoolDay("2026-09-11")).toBe("2026-09-10");

        // Minggu 2026-09-06 -> Jumat (2026-09-04)
        expect(getPreviousSchoolDay("2026-09-06")).toBe("2026-09-04");

        // Sabtu 2026-09-05 -> Jumat (2026-09-04)
        expect(getPreviousSchoolDay("2026-09-05")).toBe("2026-09-04");
    });

    test("evaluatePreviousDayCompleteness: Mendeteksi hari sebelumnya belum lengkap dan mendata missing JPs", () => {
        // Jumat 2026-09-04: JP 10 Ekskul blocked -> butuh 9 JP (JP 1..9)
        // Simulasi hanya terisi JP 1, 2, 3
        const prevRows = [
            { jp: 1, mapel: "Matematika", guru_nama: "Pak Budi", status: "H" },
            { jp: 2, mapel: "Matematika", guru_nama: "Pak Budi", status: "H" },
            { jp: 3, mapel: "Matematika", guru_nama: "Pak Budi", status: "H" }
        ];

        const evalResult = evaluatePreviousDayCompleteness("X-1", "2026-09-04", prevRows, isBlockedJPDefault);
        expect(evalResult.kelas).toBe("X-1");
        expect(evalResult.prevDateStr).toBe("2026-09-04");
        expect(evalResult.prevDayOfWeek).toBe(5); // Jumat
        expect(evalResult.totalRequiredJP).toBe(9);
        expect(evalResult.savedCount).toBe(3);
        expect(evalResult.missingJPs).toEqual([4, 5, 6, 7, 8, 9]);
        expect(evalResult.isComplete).toBe(false);
    });

    test("evaluatePreviousDayCompleteness: Mendeteksi hari sebelumnya lengkap", () => {
        // Jumat 2026-09-04: Terisi 9 JP (JP 1..9)
        const prevRows = [];
        for (let i = 1; i <= 9; i++) {
            prevRows.push({ jp: i, mapel: `Mapel ${i}`, guru_nama: `Guru ${i}`, status: "H" });
        }

        const evalResult = evaluatePreviousDayCompleteness("X-1", "2026-09-04", prevRows, isBlockedJPDefault);
        expect(evalResult.savedCount).toBe(9);
        expect(evalResult.missingJPs).toEqual([]);
        expect(evalResult.isComplete).toBe(true);
    });

    test("formatIndonesianDate: Memformat tanggal dalam bahasa Indonesia", () => {
        const formatted = formatIndonesianDate("2026-09-04");
        expect(formatted).toContain("Jumat");
        expect(formatted).toContain("September");
        expect(formatted).toContain("2026");
    });
});
