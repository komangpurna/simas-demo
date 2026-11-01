// Security-sensitive HTML tests must not inherit chromeWebSecurity:false from the general E2E setup.
const base = require('../cypress.config.js');
const { chromeWebSecurity: ignored, ...e2e } = base.e2e;
module.exports = {
    ...base,
    chromeWebSecurity: true,
    video: false,
    trashAssetsBeforeRuns: false,
    e2e: { ...e2e, baseUrl: 'http://127.0.0.1:8102', supportFile: false, specPattern: ['cypress/e2e/lms-html-workflow.cy.js', 'cypress/e2e/lms-resource-link.cy.js', 'cypress/e2e/lms-discussion-layout.cy.js', 'cypress/e2e/lms-creator-workspace.cy.js', 'cypress/e2e/lms-progress-compact.cy.js', 'cypress/e2e/lms-edit-student-flow.cy.js', 'cypress/e2e/lms-modules-workflow.cy.js'] }
};
