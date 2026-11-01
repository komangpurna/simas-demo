describe("Halaman Jurnal Mengajar", () => {
  it("Mengarahkan halaman jurnal ke login jika belum terautentikasi", () => {
    cy.checkAuthRedirect("/jurnal.html");
  });

  it("Mengarahkan jurnal-admin ke login jika belum terautentikasi", () => {
    cy.checkAuthRedirect("/jurnal-admin.html");
  });
});
