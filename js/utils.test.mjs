import { formatAppVersion, normalizeNIS, getFriendlyErrorMessage, formatRupiah, isValidEmail, sanitizeString, parseJpList, formatJpDisplay, getJurnalDateStr, findMatchingClassKey } from './utils.mjs';

describe("Pengujian Unit formatAppVersion", () => {
  test("memformat string versi dengan benar", () => {
    expect(formatAppVersion("26.07.13.01")).toBe("v26.07.13.01");
  });
});

describe("Pengujian Unit normalizeNIS", () => {
  test("menghapus spasi di awal dan akhir", () => {
    expect(normalizeNIS("  12345  ")).toBe("12345");
  });

  test("mengonversi number ke string", () => {
    expect(normalizeNIS(12345)).toBe("12345");
  });

  test("mengembalikan string kosong jika null atau undefined", () => {
    expect(normalizeNIS(null)).toBe("");
    expect(normalizeNIS(undefined)).toBe("");
  });
});

describe("Pengujian Unit getFriendlyErrorMessage", () => {
  test("menerjemahkan error permission-denied untuk aksi cancel secara ramah", () => {
    const mockError = { code: "permission-denied", message: "Missing or insufficient permissions." };
    const result = getFriendlyErrorMessage(mockError, "cancel");
    expect(result).toBe("Pengajuan ini sudah diproses atau disetujui oleh guru/wali kelas sehingga tidak dapat dibatalkan.");
  });

  test("menerjemahkan error permission-denied untuk aksi edit secara ramah", () => {
    const mockError = { code: "permission-denied", message: "Missing or insufficient permissions." };
    const result = getFriendlyErrorMessage(mockError, "edit");
    expect(result).toBe("Pengajuan ini sudah diproses atau disetujui oleh guru/wali kelas sehingga tidak dapat diubah.");
  });

  test("menerjemahkan error permission-denied untuk aksi generik secara ramah", () => {
    const mockError = { code: "permission-denied", message: "Missing or insufficient permissions." };
    const result = getFriendlyErrorMessage(mockError);
    expect(result).toBe("Pengajuan ini sudah diproses atau disetujui oleh guru/wali kelas.");
  });

  test("mengembalikan pesan fallback default jika error kosong", () => {
    expect(getFriendlyErrorMessage(null)).toBe("Terjadi kesalahan sistem.");
  });
});

describe("Pengujian Unit formatRupiah", () => {
  test("memformat nominal angka ke format Rupiah secara tepat", () => {
    const formatted = formatRupiah(50000);
    expect(formatted).toMatch(/50\.000/);
  });

  test("mengembalikan Rp 0 jika input bukan angka", () => {
    expect(formatRupiah("abc")).toBe("Rp 0");
  });
});

describe("Pengujian Unit isValidEmail", () => {
  test("memvalidasi email valid", () => {
    expect(isValidEmail("admin@smagesa.sch.id")).toBe(true);
  });

  test("menolak email yang tidak valid", () => {
    expect(isValidEmail("bukan-email")).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail(null)).toBe(false);
  });
});

describe("Pengujian Unit sanitizeString", () => {
  test("meng-escape karakter khusus HTML untuk cegah XSS", () => {
    expect(sanitizeString("<script>alert('xss')</script>")).toBe("&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;");
  });
});

describe("Pengujian Unit parseJpList", () => {
  test("memparsing array angka", () => {
    expect(parseJpList([1, 2, 3])).toEqual([1, 2, 3]);
  });

  test("memparsing JSON string array dari D1 SQL", () => {
    expect(parseJpList("[1,2]")).toEqual([1, 2]);
    expect(parseJpList("[3, 4, 5]")).toEqual([3, 4, 5]);
  });

  test("memparsing string range", () => {
    expect(parseJpList("1-3")).toEqual([1, 2, 3]);
    expect(parseJpList("4-5")).toEqual([4, 5]);
  });

  test("memparsing string koma", () => {
    expect(parseJpList("1, 2")).toEqual([1, 2]);
  });

  test("memparsing number tunggal atau string number", () => {
    expect(parseJpList(1)).toEqual([1]);
    expect(parseJpList("2")).toEqual([2]);
  });

  test("menangani input kosong atau invalid", () => {
    expect(parseJpList(null)).toEqual([]);
    expect(parseJpList(undefined)).toEqual([]);
    expect(parseJpList("")).toEqual([]);
    expect(parseJpList("abc")).toEqual([]);
  });
});

describe("Pengujian Unit formatJpDisplay", () => {
  test("memformat JP tunggal", () => {
    expect(formatJpDisplay([1])).toBe("1");
    expect(formatJpDisplay(2)).toBe("2");
    expect(formatJpDisplay("[3]")).toBe("3");
  });

  test("memformat JP jamak berurutan", () => {
    expect(formatJpDisplay([1, 2])).toBe("1-2");
    expect(formatJpDisplay("[1,2,3]")).toBe("1-3");
    expect(formatJpDisplay("4-6")).toBe("4-6");
  });

  test("menangani input kosong", () => {
    expect(formatJpDisplay(null)).toBe("-");
    expect(formatJpDisplay("")).toBe("-");
  });
});

describe("Pengujian Unit getJurnalDateStr", () => {
  test("mengekstrak tanggal dari field tanggal D1", () => {
    expect(getJurnalDateStr({ tanggal: "2026-08-30" })).toBe("2026-08-30");
  });

  test("mengekstrak tanggal dari field created_at D1", () => {
    expect(getJurnalDateStr({ created_at: "2026-08-30 08:30:00" })).toBe("2026-08-30");
  });

  test("mengekstrak tanggal dari field timestamp Firestore", () => {
    const mockTs = {
      toDate: () => new Date("2026-08-30T00:00:00Z")
    };
    expect(getJurnalDateStr({ timestamp: mockTs })).toBe("2026-08-30");
  });

  test("mengembalikan string kosong jika data kosong", () => {
    expect(getJurnalDateStr(null)).toBe("");
    expect(getJurnalDateStr({})).toBe("");
  });
});

describe("Pengujian Unit findMatchingClassKey", () => {
  const matrix = {
    "X-1": {},
    "XI-2": {},
    "XII-3": {}
  };

  test("mencocokkan kunci kelas persis", () => {
    expect(findMatchingClassKey("X-1", matrix)).toBe("X-1");
  });

  test("mencocokkan variasi titik, spasi, dan huruf kecil", () => {
    expect(findMatchingClassKey("X.1", matrix)).toBe("X-1");
    expect(findMatchingClassKey("x-1", matrix)).toBe("X-1");
    expect(findMatchingClassKey("XI 2", matrix)).toBe("XI-2");
    expect(findMatchingClassKey("xii.3", matrix)).toBe("XII-3");
  });

  test("mengembalikan null jika tidak ditemukan", () => {
    expect(findMatchingClassKey("X-9", matrix)).toBeNull();
    expect(findMatchingClassKey(null, matrix)).toBeNull();
  });
});

