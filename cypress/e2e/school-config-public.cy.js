describe('Konfigurasi identitas sekolah pada halaman publik', () => {
  it('dapat dibaca publik tanpa autentikasi', () => {
    cy.request('/js/school-config.js').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.contain('SCHOOL_CONFIG');
    });
  });

  it('menghasilkan manifest blob dengan URL absolut yang valid', () => {
    cy.visit('/index.html');
    cy.get('link[rel="manifest"]').should('have.attr', 'href').and('match', /^blob:/);
    cy.window().then(async (win) => {
      const manifestHref = win.document.querySelector('link[rel="manifest"]').href;
      const manifest = await win.fetch(manifestHref).then(response => response.json());
      const urls = [manifest.id, manifest.start_url, manifest.scope, ...manifest.shortcuts.map(item => item.url)];

      urls.forEach(url => {
        expect(() => new URL(url)).not.to.throw();
        expect(new URL(url).origin).to.eq(win.location.origin);
      });
    });
  });

  for (const page of ['/index.html', '/pub/timecapsule.html', '/library/opac.html']) {
    it(`merender identitas pada ${page} tanpa token mentah`, () => {
      cy.clearLocalStorage();
      cy.visit(page);
      cy.get('html').should('not.contain.text', '{{school');
      cy.document().its('title').should('not.contain', '{{');
    });
  }
});
