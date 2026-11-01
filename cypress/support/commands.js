// cypress/support/commands.js
// Custom Cypress Commands untuk SIMAS SMAGESA

/**
 * Custom command untuk memeriksa proteksi pengalihan halaman unauthenticated
 * @example cy.checkAuthRedirect('/presensi.html')
 */
Cypress.Commands.add('checkAuthRedirect', (targetUrl) => {
  cy.visit(targetUrl);
  // Halaman terproteksi seharusnya mengarahkan pengguna kembali ke index.html jika tidak ada sesi login valid
  cy.url().should('include', 'index.html');
});

/**
 * Custom command untuk menyimulasikan sesi pengguna lokal (Mock Session)
 * @example cy.setMockUserSession({ role: 'guru_mapel', name: 'Guru Demo', email: 'guru@smagesa.sch.id' })
 */
Cypress.Commands.add('setMockUserSession', (userObj) => {
  window.localStorage.setItem('user_role', userObj.role || 'siswa');
  window.localStorage.setItem('user_email', userObj.email || 'demo@smagesa.sch.id');
  window.localStorage.setItem('user_name', userObj.name || 'Pengguna Demo');
  if (userObj.uid) {
    window.localStorage.setItem('user_uid', userObj.uid);
  }
});
