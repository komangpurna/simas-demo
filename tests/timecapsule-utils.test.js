const {
  TimeCapsuleValidationError,
  getTimeCapsuleEntryId,
  hashEditToken,
  normalizeTimeCapsuleSubmission,
  verifyEditToken,
} = require("./timecapsule-utils");

function validPayload(overrides = {}) {
  return {
    namaLengkap: "Ni Luh Sari",
    kelas: "XII A",
    email: "Sari@Example.com",
    whatsapp: "081234567890",
    medsos: "@sari",
    tigaKata: "Hangat, Berkesan, Rumah",
    memori: "Belajar bersama teman.",
    lagu: "Lagu Sekolah",
    refleksi: "Saya bertumbuh.",
    sosok: "Guru dan keluarga.",
    targetBesar: "Menjadi bermanfaat.",
    prinsip: "Tetap rendah hati.",
    pesanPengingat: "Jangan menyerah.",
    harapanSekolah: "Semakin maju.",
    fotoUrl: "https://drive.google.com/photo.jpg",
    fotoFileId: "file-123",
    ...overrides,
  };
}

describe("Time capsule submission utilities", () => {
  test("menormalkan payload dan membuang tag HTML sederhana", () => {
    const result = normalizeTimeCapsuleSubmission(validPayload({
      email: " SARI@EXAMPLE.COM ",
      memori: "<script>kenangan</script>",
    }));
    expect(result.email).toBe("sari@example.com");
    expect(result.memori).toBe("scriptkenangan/script");
    expect(result.fotoUrl).toBe("https://drive.google.com/photo.jpg");
  });

  test("menolak jumlah Tiga Kata yang tidak tepat", () => {
    expect(() => normalizeTimeCapsuleSubmission(validPayload({ tigaKata: "Hanya dua" })))
      .toThrow(TimeCapsuleValidationError);
  });

  test("menolak URL foto selain HTTPS", () => {
    expect(() => normalizeTimeCapsuleSubmission(validPayload({ fotoUrl: "javascript:alert(1)" })))
      .toThrow("URL foto tidak valid");
  });

  test("token edit diverifikasi secara aman", () => {
    const hash = hashEditToken("rahasia-yang-panjang");
    expect(verifyEditToken("rahasia-yang-panjang", hash)).toBe(true);
    expect(verifyEditToken("token-salah", hash)).toBe(false);
    expect(verifyEditToken("rahasia-yang-panjang", "invalid")).toBe(false);
  });

  test("ID dokumen stabil dan tidak membocorkan email", () => {
    const first = getTimeCapsuleEntryId("Sari@example.com");
    expect(first).toBe(getTimeCapsuleEntryId(" sari@example.com "));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("sari");
  });
});
