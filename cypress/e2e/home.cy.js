describe("Halaman Utama SIMAS SMAGESA", () => {
  it("Berhasil memuat halaman utama dan menampilkan judul", () => {
    cy.visit("/index.html");
    cy.contains("SMAGESA");
  });
});
