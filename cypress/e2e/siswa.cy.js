describe("Halaman Data Siswa & Portal Siswa", () => {
  it("Mengarahkan halaman data siswa ke login jika belum terautentikasi", () => {
    cy.checkAuthRedirect("/siswa.html");
  });

  it("Mengarahkan portal siswa ke login jika belum terautentikasi", () => {
    cy.checkAuthRedirect("/portal-siswa.html");
  });
});
