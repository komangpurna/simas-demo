const PRIMARY = 'https://simas-smagesa-api.komangpurna1.workers.dev';
const GATEWAY = 'http://127.0.0.1:8766/functions/v1/worker-gateway';
const CORS = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:8765', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type, x-student-token' };
function visit(query = '') {
    cy.visit(`/worker-fallback.html${query}`);
    cy.window().its('workerReady').should('eq', true);
}
function primary(mode) {
    cy.intercept(`${PRIMARY}/api/**`, req => {
        if (mode === 'blocked') return req.destroy();
        if (req.method === 'OPTIONS') return req.reply({ statusCode: 204, headers: CORS });
        if (mode === 'write-fails' && req.method === 'POST') return req.destroy();
        req.reply({ statusCode: mode === 'unauthorized' ? 401 : 200, headers: CORS, body: { success: true }, delay: mode === 'slow' ? 2000 : 0 });
    });
}
describe('Browser Worker-first fallback with the real gateway handler', () => {
    beforeEach(() => { cy.request('POST', 'http://127.0.0.1:8766/test/reset'); });

    it('healthy Workers and unrelated fetches do not call Supabase', () => {
        primary('healthy'); visit();
        cy.window().then(async win => {
            expect(win.sameTransport).to.eq(true);
            expect((await win.fetch(`${PRIMARY}/api/students`)).status).to.eq(200);
            expect(await (await win.fetch('/unrelated-api')).json()).to.deep.eq({ unrelated: true });
        });
        cy.request('http://127.0.0.1:8766/test/state').its('body').should('deep.eq', []);
    });

    it('network failure relays login over real cross-origin CORS and retains its token/body', () => {
        primary('blocked'); visit();
        cy.window().then(async win => {
            const result = await win.fetch(`${PRIMARY}/api/students/verify-credentials`, {
                method: 'POST', headers: { Authorization: 'Bearer browser-test', 'Content-Type': 'application/json', 'X-Student-Token': 'synthetic-session' }, body: '{"nis":"synthetic"}'
            });
            expect((await result.json()).verified).to.eq(true);
            expect(win.testTransport.baseUrl).to.eq(GATEWAY);
        });
        cy.request('http://127.0.0.1:8766/test/state').then(({ body }) => {
            expect(body).to.have.length(1);
            expect(body[0]).to.include({ method: 'POST', authorization: 'Bearer browser-test', body: '{"nis":"synthetic"}' });
        });
    });

    it('an HTTP 401 from Workers never invokes the relay', () => {
        primary('unauthorized'); visit();
        cy.window().then(async win => { expect((await win.fetch(`${PRIMARY}/api/students`)).status).to.eq(401); });
        cy.request('http://127.0.0.1:8766/test/state').its('body').should('deep.eq', []);
    });

    it('a timeout switches to the relay and a network change retries Workers', () => {
        primary('slow'); visit('?timeout=200');
        cy.window().then(async win => {
            expect((await win.fetch(`${PRIMARY}/api/students`)).status).to.eq(200);
            expect(win.testTransport.baseUrl).to.eq(GATEWAY);
            win.dispatchEvent(new win.Event('online'));
            expect(win.testTransport.baseUrl).to.eq(PRIMARY);
        });
        primary('healthy');
        visit(); // The next page uses the production timeout after the network-change reset.
        cy.window().then(async win => { expect((await win.fetch(`${PRIMARY}/api/students`)).status).to.eq(200); });
        cy.request('http://127.0.0.1:8766/test/state').its('body').should('have.length', 1);
    });

    it('a fresh write selects a working route before dispatch and reaches the upstream once', () => {
        primary('blocked'); visit();
        cy.window().then(async win => {
            const result = await win.fetch(`${PRIMARY}/api/records`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"id":"one"}' });
            expect(result.status).to.eq(200);
        });
        cy.request('http://127.0.0.1:8766/test/state').then(({ body }) => {
            expect(body.map(call => call.path)).to.deep.eq(['/api/health', '/api/records']);
            expect(body.filter(call => call.method === 'POST')).to.have.length(1);
        });
    });

    it('does not replay a write that may already have reached the primary server', () => {
        primary('write-fails'); visit();
        cy.window().then(async win => {
            await win.fetch(`${PRIMARY}/api/health`);
            const result = await win.fetch(`${PRIMARY}/api/records`, { method: 'POST', body: '{}' }).catch(error => error);
            expect(result.code).to.eq('api/write-outcome-unknown');
        });
        cy.request('http://127.0.0.1:8766/test/state').its('body').should('deep.eq', []);
    });
});
