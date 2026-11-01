describe("Halaman Duta Admin", () => {
  it("Mengarahkan halaman Duta Admin ke login jika belum terautentikasi", () => {
    cy.checkAuthRedirect("/duta-admin.html");
  });
});
