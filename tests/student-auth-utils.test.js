const {
  isInactiveStudent,
  normalizeStudentDate,
  normalizeStudentNis,
  toClientSafeStudentData,
  verifyStudentCredential,
} = require("./student-auth-utils");

describe("Student authentication utilities", () => {
  test("menormalkan NIS tanpa mengubah leading zero", () => {
    expect(normalizeStudentNis(" 00123 ")).toBe("00123");
  });

  test("menormalkan format tanggal yang didukung", () => {
    expect(normalizeStudentDate("2026/8/3")).toBe("2026-08-03");
    expect(normalizeStudentDate("03-08-2026")).toBe("2026-08-03");
    expect(normalizeStudentDate("invalid")).toBe("");
  });

  test("NISN menjadi satu-satunya kredensial ketika diisi", () => {
    const student = { nisn: "9988", birthDate: "2008-01-02" };
    expect(verifyStudentCredential(student, { nisn: "9988", birthDate: "salah" })).toBe(true);
    expect(verifyStudentCredential(student, { nisn: "0000", birthDate: "2008-01-02" })).toBe(false);
  });

  test("tanggal lahir dipakai ketika NISN kosong", () => {
    const student = { birthDate: "02/01/2008" };
    expect(verifyStudentCredential(student, { birthDate: "2008-01-02" })).toBe(true);
    expect(verifyStudentCredential(student, { birthDate: "2008-02-01" })).toBe(false);
  });

  test("menolak siswa nonaktif dari kelas maupun status", () => {
    expect(isInactiveStudent({ class: "Alumni 2026" })).toBe(true);
    expect(isInactiveStudent({ class: "XII A", status: "Mutasi Keluar" })).toBe(true);
    expect(isInactiveStudent({ class: "XI B", status: "Aktif" })).toBe(false);
    expect(isInactiveStudent({ class: "XII DOLO", status: "Belum Lulus" })).toBe(false);
    expect(isInactiveStudent({ class: "XII A", status: "DO" })).toBe(true);
  });

  test("mengubah timestamp menjadi data aman untuk respons callable", () => {
    const timestampLike = { toDate: () => new Date("2008-01-02T00:00:00.000Z") };
    expect(toClientSafeStudentData({ birthDate: timestampLike, tags: [timestampLike] })).toEqual({
      birthDate: "2008-01-02T00:00:00.000Z",
      tags: ["2008-01-02T00:00:00.000Z"],
    });
  });
});
