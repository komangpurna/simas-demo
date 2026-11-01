// Local quiz workflow only; preserve browser origin checks.
const base = require('../cypress.config.js');
const { chromeWebSecurity: ignored, ...e2e } = base.e2e;
module.exports = {
    ...base, chromeWebSecurity: true, video: false, trashAssetsBeforeRuns: false,
    e2e: { ...e2e, baseUrl: 'http://127.0.0.1:8100', supportFile: false, specPattern: 'cypress/e2e/lms-quiz-workflow.cy.js' }
};
