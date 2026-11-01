module.exports = {
    video: false, chromeWebSecurity: true, trashAssetsBeforeRuns: false,
    screenshotsFolder: 'scratch/lms-journal-screenshots',
    e2e: { baseUrl:'http://127.0.0.1:8103',supportFile:false,specPattern:'cypress/e2e/lms-journal-workflow.cy.js' }
};
