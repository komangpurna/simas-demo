describe("Halaman Keuangan", () => {
  it("Mengarahkan ke halaman login jika belum terautentikasi", () => {
    cy.visit("/keuangan.html");
    // Halaman keuangan seharusnya melakukan redirect atau memunculkan modal login
    cy.url().should("include", "index.html");
  });
});
