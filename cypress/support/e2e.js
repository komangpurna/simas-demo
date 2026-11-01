// cypress/support/e2e.js
// Berkas dukungan Cypress E2E SIMAS SMAGESA

import './commands';

// Nonaktifkan Service Worker di lingkungan pengujian Cypress untuk mencegah hang/timeout pada cy.visit()
Cypress.on('window:before:load', (win) => {
  if (win.navigator) {
    try {
      delete win.navigator.__proto__.serviceWorker;
    } catch (e) {
      // Ignored if non-configurable
    }
  }
});

// Penanganan uncaught exception global agar tes E2E tidak gagal hanya karena console error minor dari pustaka pihak ketiga
Cypress.on('uncaught:exception', (err, runnable) => {
  if (
    err.message.includes('ResizeObserver') ||
    err.message.includes('Firebase') ||
    err.message.includes('serviceWorker') ||
    err.message.includes('failed to register') ||
    err.message.includes('Script error')
  ) {
    return false;
  }
  return true;
});
