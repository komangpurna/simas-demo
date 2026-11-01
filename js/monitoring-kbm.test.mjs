import { parseJpList, formatJpDisplay, getJurnalDateStr, findMatchingClassKey } from './utils.mjs';

describe("Monitoring KBM Matrix & Effectiveness Evaluation", () => {
  const mockClasses = ["X-1", "X-2", "X-3", "X-4", "XI-1", "XI-2", "XI-3", "XI-4", "XII-1", "XII-2", "XII-3", "XII-4"];

  function buildMatrix(classes) {
    const matrix = {};
    classes.forEach((k) => {
      matrix[k] = {};
      for (let i = 1; i <= 10; i++) {
        matrix[k][i] = { jurnal: null, presensi: null, xml: null };
      }
    });
    return matrix;
  }

  function evaluateJpEffectiveness(matrix, classes, targetDateStr, isJPElapsedFn) {
    const jpTidakEfektifMap = {};
    for (let jpNum = 1; jpNum <= 10; jpNum++) {
      let activeKbmCount = 0;
      classes.forEach((k) => {
        const cell = matrix[k]?.[jpNum];
        if (cell?.jurnal || (cell?.presensi && ["H", "K"].includes(cell.presensi.status))) {
          activeKbmCount++;
        }
      });
      const elapsed = isJPElapsedFn(jpNum, targetDateStr);
      jpTidakEfektifMap[jpNum] = elapsed && activeKbmCount <= 3;
    }
    return jpTidakEfektifMap;
  }

  test("Jurnal Guru dari D1 terpetakan dengan benar dan tidak dicap Tidak Efektif", () => {
    const matrix = buildMatrix(mockClasses);

    // Mock Jurnal dari D1 (format JSON string "[1,2]" dan field tanggal "2026-08-30")
    const mockJurnalEntries = [
      { tanggal: "2026-08-30", kelas: "X.1", guru: "I Komang Purna", mapel: "Informatika", jp: "[1,2]" },
      { tanggal: "2026-08-30", kelas: "X-2", guru: "Guru B", mapel: "Matematika", jp: "[1,2]" },
      { tanggal: "2026-08-30", kelas: "XI-1", guru: "Guru C", mapel: "Fisika", jp: "[1,2]" },
      { tanggal: "2026-08-30", kelas: "XII-1", guru: "Guru D", mapel: "Biologi", jp: "[1,2]" },
      { tanggal: "2026-08-30", kelas: "XII-2", guru: "Guru E", mapel: "Kimia", jp: "[1,2]" },
    ];

    const targetDateStr = "2026-08-30";

    mockJurnalEntries.forEach((data) => {
      const docDate = getJurnalDateStr(data);
      if (docDate !== targetDateStr) return;

      const targetKey = findMatchingClassKey(data.kelas, matrix);
      if (!targetKey) return;

      const jps = parseJpList(data.jp);
      jps.forEach((jp) => {
        matrix[targetKey][jp].jurnal = { guru: data.guru, mapel: data.mapel };
      });
    });

    // Verifikasi pemetaan JP
    expect(matrix["X-1"][1].jurnal).toEqual({ guru: "I Komang Purna", mapel: "Informatika" });
    expect(matrix["X-1"][2].jurnal).toEqual({ guru: "I Komang Purna", mapel: "Informatika" });
    expect(matrix["X-1"][3].jurnal).toBeNull();

    // Evaluasi efektivitas: 5 kelas terisi pada JP 1 & 2 (> 3 kelas aktif)
    const isJPElapsed = () => true; // Seluruh JP telah berlalu
    const mapEfektif = evaluateJpEffectiveness(matrix, mockClasses, targetDateStr, isJPElapsed);

    // JP 1 & 2 harus EFEKTIF (jpTidakEfektifMap = false)
    expect(mapEfektif[1]).toBe(false);
    expect(mapEfektif[2]).toBe(false);

    // JP 3 s.d 10 kosong (0 kelas aktif <= 3) -> Terdeteksi Tidak Efektif
    expect(mapEfektif[3]).toBe(true);
    expect(mapEfektif[4]).toBe(true);
  });

  test("Kelas dengan Jurnal tetap TERVERIFIKASI / JURNAL_ONLY meskipun JP terdeteksi Tidak Efektif", () => {
    const matrix = buildMatrix(mockClasses);

    // Hanya 1 kelas yang mengisi jurnal pada JP 5 (misal kelas remidi saat jam bebas)
    const mockJurnal = { tanggal: "2026-08-30", kelas: "X-1", guru: "I Komang Purna", mapel: "Informatika", jp: 5 };
    const targetKey = findMatchingClassKey(mockJurnal.kelas, matrix);
    matrix[targetKey][5].jurnal = { guru: mockJurnal.guru, mapel: mockJurnal.mapel };

    const isJPElapsed = () => true;
    const mapEfektif = evaluateJpEffectiveness(matrix, mockClasses, "2026-08-30", isJPElapsed);

    // JP 5 secara global sekolah ditandai Tidak Efektif (karena hanya 1 kelas aktif <= 3)
    expect(mapEfektif[5]).toBe(true);

    // Namun untuk kelas X-1, status sel BUKAN TIDAK_EFEKTIF karena jurnal ada
    const cellX1 = matrix["X-1"][5];
    const isTidakEfektifGlobally = mapEfektif[5];

    let cellState = "EMPTY";
    if (cellX1.jurnal && (!cellX1.presensi || !cellX1.presensi.status)) {
      cellState = "JURNAL_ONLY";
    } else if (isTidakEfektifGlobally && !cellX1.jurnal) {
      cellState = "TIDAK_EFEKTIF";
    }

    expect(cellState).toBe("JURNAL_ONLY");
  });
});
