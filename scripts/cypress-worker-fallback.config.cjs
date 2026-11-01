const { defineConfig } = require('cypress');
module.exports = defineConfig({
    video: false, trashAssetsBeforeRuns: false, defaultCommandTimeout: 10000,
    e2e: { baseUrl: 'http://127.0.0.1:8765', supportFile: false, specPattern: 'cypress/e2e/worker-fallback.cy.js' }
});
