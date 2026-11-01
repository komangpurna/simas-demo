const cachedSidebar = `
  <aside id="desktop-sidebar" data-cy="cached-simas-sidebar">
    <a href="/dashboard.html">SIMAS</a>
  </aside>
`;

function getNestedPageFrame() {
  return cy
    .get('#outer-frame')
    .its('0.contentDocument.body')
    .should('not.be.empty')
    .find('#page-frame');
}

function mountPageInNestedFrame(pathname) {
  getNestedPageFrame().then(($pageFrame) => {
    $pageFrame[0].setAttribute('src', pathname);
  });

  return getNestedPageFrame().should(($pageFrame) => {
    expect($pageFrame[0].contentWindow.location.pathname).to.eq(pathname);
  });
}

function visitFrameHost(caseId) {
  cy.visit(`/cypress/fixtures/iframe-layout-host.html?case=${caseId}`, {
    onBeforeLoad(win) {
      win.localStorage.setItem('simas_cached_sidebar_html', cachedSidebar);
    },
  });
}

describe('Regresi layout iframe v1.1.569', () => {
  it('tetap merender layout/sidebar SIMAS untuk dashboard.html di nested frame', () => {
    // Fokuskan tes pada layout preloader tanpa menunggu autentikasi dan data dashboard.
    cy.intercept('GET', '**/js/page-dashboard.js', {
      headers: { 'content-type': 'application/javascript' },
      body: '',
    });

    visitFrameHost('dashboard');
    mountPageInNestedFrame('/dashboard.html').should(($pageFrame) => {
      const pageDocument = $pageFrame[0].contentDocument;
      const appLayout = pageDocument.querySelector('#app-layout');
      const sidebar = pageDocument.querySelector('[data-cy="cached-simas-sidebar"]');

      expect($pageFrame[0].contentWindow.location.pathname).to.eq('/dashboard.html');
      expect(pageDocument.documentElement).not.to.have.class('is-embed-mode');
      expect(appLayout).not.to.be.null;
      expect($pageFrame[0].contentWindow.getComputedStyle(appLayout).display).not.to.eq('none');
      expect(sidebar).not.to.be.null;
      expect(sidebar.textContent).to.contain('SIMAS');
    });
  });

  it('menjaga library/opac.html tanpa shell SIMAS saat di-embed', () => {
    // Inline embed guard tetap berjalan; modul data OPAC tidak diperlukan untuk regresi layout.
    cy.intercept('GET', '**/library/opac.js*', {
      headers: { 'content-type': 'application/javascript' },
      body: '',
    });

    visitFrameHost('opac');
    mountPageInNestedFrame('/library/opac.html').should(($pageFrame) => {
      const pageDocument = $pageFrame[0].contentDocument;
      const appLayout = pageDocument.querySelector('#app-layout');
      const main = pageDocument.querySelector('main');

      expect($pageFrame[0].contentWindow.location.pathname).to.eq('/library/opac.html');
      expect(pageDocument.documentElement).to.have.class('is-embed-mode');
      expect(appLayout).not.to.be.null;
      expect(appLayout.children).to.have.length(0);
      expect($pageFrame[0].contentWindow.getComputedStyle(appLayout).display).to.eq('none');
      expect(main).not.to.be.null;
      expect($pageFrame[0].contentWindow.getComputedStyle(main).display).not.to.eq('none');
      expect(pageDocument.querySelector('[data-cy="cached-simas-sidebar"]')).to.be.null;
    });
  });
});
