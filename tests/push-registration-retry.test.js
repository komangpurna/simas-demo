const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('registrasi push produksi mencoba ulang gangguan jaringan dan upsert D1, tetapi berhenti pada error auth', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../js/cloudflare-client.js'), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/^export default .*;$/gm, '').replace(/^export /gm, '');
    const fetchMock = jest.fn()
        .mockRejectedValueOnce(new Error('Failed to fetch'))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'D1_ERROR: database reset' }), { status: 500 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, reboundToUser: 'A' })));
    const context = vm.createContext({
        auth: { currentUser: { uid: 'A', getIdToken: async () => 'jwt' } },
        CLOUDFLARE_CONFIG: { workerUrl: 'https://worker.test' }, window: {},
        fetch: fetchMock, console: { warn: () => {}, info: () => {} },
        setTimeout: callback => { callback(); }, clearTimeout
    });
    vm.runInContext(source + '\nglobalThis.client = cfClient;', context);
    expect(await context.client.registerPushToken({ token: 'device-token' })).toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Set(fetchMock.mock.calls.map(([, init]) => init.body)).size).toBe(1);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt');
    fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }));
    await expect(context.client.registerPushToken({ token: 'device-token' })).rejects.toThrow('Unauthorized');
    expect(fetchMock).toHaveBeenCalledTimes(1);
});
