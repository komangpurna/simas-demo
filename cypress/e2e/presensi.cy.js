describe("Halaman Presensi SIMAS", () => {
  it("Mengarahkan ke halaman login jika belum terautentikasi", () => {
    cy.checkAuthRedirect("/presensi.html");
  });

  it("Mengarahkan presensi guru ke halaman login jika belum terautentikasi", () => {
    cy.checkAuthRedirect("/presensi-guru.html");
  });
});
