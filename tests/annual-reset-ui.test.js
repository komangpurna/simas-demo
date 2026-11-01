/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const load = (file, names) => new Function(read(file).replace(/export /g, '') + `\nreturn { ${names.join(',')} };`)();
const { initAnnualReset } = load('js/page-settings-annual.js', ['initAnnualReset']);
const { normalizeAnnualResetBackup, isAnnualResetBackup } = load('js/annual-reset-backup.js', ['normalizeAnnualResetBackup', 'isAnnualResetBackup']);

describe('Annual reset wizard with the real settings markup', () => {
    let order, alert, toast, api;
    const node = id => document.getElementById(id);
    const operation = (kind, status = 'prepared') => ({ success: true, kind, status,
        operationId: kind === 'promotion' ? 'promotion:2025/2026' : 'cleanup:00000000-0000-0000-0000-000000000001',
        academicYear: '2025/2026', totalStudents: 1, promotedCount: 1, alumniCount: 0,
        createdAt: '2026-09-05 01:00:00', options: { snapshotToken: 'token-1', tables: ['students'] } });
    beforeEach(async () => {
        document.documentElement.innerHTML = read('settings.html');
        order = []; alert = jest.fn(); toast = jest.fn();
        localStorage.clear(); sessionStorage.clear();
        window.hasRole = () => true;
        window.getStudentsCache = jest.fn(async () => []);
        window.invalidateStudentAggregatesCache = jest.fn();
        window.invalidateActiveClassesCache = jest.fn();
        window.invalidateSystemConfig = jest.fn();
        URL.createObjectURL = jest.fn(() => 'blob:backup');
        URL.revokeObjectURL = jest.fn();
        jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => order.push('download'));
        Object.defineProperty(window.crypto, 'randomUUID', { configurable: true, value: () => '00000000-0000-0000-0000-000000000001' });
        api = {
            enabled: true,
            getAlumniClasses: jest.fn(async () => ['Alumni XII.1 (2024/2025)']),
            getAnnualResetHistory: jest.fn(async () => []),
            getAnnualResetBackup: jest.fn(async () => { order.push('backup'); return { _meta: { snapshotToken: 'token-1' }, students: { records: [{ nis: '1' }] } }; }),
            annualResetAction: jest.fn(async (action, data) => {
                order.push(action);
                const kind = action === 'prepare_cleanup' || data.operationId?.startsWith('cleanup:') ? 'cleanup' : 'promotion';
                return operation(kind, action === 'commit' ? (kind === 'promotion' ? 'committed' : 'completed') : action === 'finalize' ? 'completed' : 'prepared');
            })
        };
        window.cfClient = api;
        initAnnualReset({ showToast: toast, showModernAlert: alert });
        await window.triggerAnnualReset();
        node('annual-input-academic-year').value = '2025/2026';
    });
    afterEach(() => jest.restoreAllMocks());

    test('keeps two stages and requires typed confirmation even for direct handlers', async () => {
        expect(node('annual-step-1').classList.contains('hidden')).toBe(false);
        expect(node('annual-step-2').classList.contains('hidden')).toBe(true);
        await window.executeAnnualAlumniCleanup(); await window.executeAnnualClassPromotion();
        expect(api.annualResetAction).not.toHaveBeenCalled();
        window.setAnnualResetStep(2);
        expect(node('annual-step-1').classList.contains('hidden')).toBe(true);
        expect(node('annual-step-2').classList.contains('hidden')).toBe(false);
    });

    test('all alumni classes are prepared once, downloaded, then committed before stage 2', async () => {
        node('annual-input-delete-confirm').value = 'DELETE';
        await window.executeAnnualAlumniCleanup();
        expect(order).toEqual(['prepare_cleanup', 'backup', 'download', 'commit']);
        expect(api.annualResetAction.mock.calls[0][1].classes).toEqual(['Alumni XII.1 (2024/2025)']);
        expect(api.annualResetAction.mock.calls[1][1]).toMatchObject({ backupAcknowledged: true, snapshotToken: 'token-1' });
        expect(node('annual-step-2').classList.contains('hidden')).toBe(false);
        expect(window._annualAlumniSummary.totalDeleted).toBe(1);
    });

    test('failed download prevents mutation and restores controls', async () => {
        node('annual-input-delete-confirm').value = 'DELETE';
        api.getAnnualResetBackup.mockRejectedValueOnce(new Error('Connection lost'));
        await window.executeAnnualAlumniCleanup();
        expect(order).toEqual(['prepare_cleanup']);
        expect(alert.mock.calls.at(-1)[0]).toBe('Pembersihan belum selesai');
        expect(node('annual-step-1').classList.contains('hidden')).toBe(false);
        expect(node('annual-input-delete-confirm').disabled).toBe(false);
    });

    test('blocks double click and navigation while a request is running', async () => {
        let release;
        api.annualResetAction.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        node('annual-input-delete-confirm').value = 'DELETE';
        const pending = window.executeAnnualAlumniCleanup();
        await window.executeAnnualAlumniCleanup();
        window.setAnnualResetStep(2);
        expect(api.annualResetAction).toHaveBeenCalledTimes(1);
        expect(node('annual-step-1').classList.contains('hidden')).toBe(false);
        expect(node('btn-annual-skip-step-1').disabled).toBe(true);
        release(operation('cleanup'));
        await pending;
        expect(node('btn-annual-skip-step-1').disabled).toBe(false);
    });

    test('promotion backs up before commit and reports success only after finalization', async () => {
        node('annual-input-promote-confirm').value = 'NAIK KELAS';
        await window.executeAnnualClassPromotion();
        expect(order).toEqual(['prepare_promotion', 'backup', 'download', 'commit', 'finalize']);
        expect(alert.mock.calls.at(-1)[0]).toBe('Reset Data Tahunan Selesai');
    });

    test('Firestore failure offers resumable completion; retry does not re-download or re-promote', async () => {
        node('annual-input-promote-confirm').value = 'NAIK KELAS';
        const original = api.annualResetAction.getMockImplementation();
        api.annualResetAction.mockImplementation(async (action, data) => {
            if (action === 'finalize') throw new Error('Firestore unavailable');
            return original(action, data);
        });
        api.getAnnualResetHistory.mockResolvedValue([operation('promotion', 'committed')]);
        await window.executeAnnualClassPromotion();
        expect(alert.mock.calls.at(-1)[0]).toBe('Kenaikan tersimpan, penyelesaian tertunda');
        expect(node('annual-history-resume').classList.contains('hidden')).toBe(false);
        order.length = 0;
        api.annualResetAction.mockImplementation(original);
        await window.resumeAnnualReset();
        expect(order).toEqual(['finalize']);
        expect(alert.mock.calls.at(-1)[0]).toBe('Reset Data Tahunan Selesai');
    });

    test('lost commit response is recovered by preparing the same operation identity', async () => {
        node('annual-input-promote-confirm').value = 'NAIK KELAS';
        const original = api.annualResetAction.getMockImplementation();
        let committed = false;
        api.annualResetAction.mockImplementation(async (action, data) => {
            if (action === 'commit') { committed = true; throw new Error('Response lost'); }
            if (action === 'prepare_promotion' && committed) { order.push(action); return operation('promotion', 'committed'); }
            return original(action, data);
        });
        await window.executeAnnualClassPromotion();
        order.length = 0;
        await window.executeAnnualClassPromotion();
        expect(order).toEqual(['prepare_promotion', 'finalize']);
    });

    test('failed alumni lookup never claims database is clean', async () => {
        api.getAlumniClasses.mockRejectedValueOnce(new Error('Unavailable'));
        await window.triggerAnnualReset();
        expect(node('annual-alumni-empty-box').classList.contains('hidden')).toBe(true);
        expect(node('btn-exec-annual-cleanup').disabled).toBe(true);
    });

    test('cache refresh failure is reported as a display issue after successful reset', async () => {
        node('annual-input-promote-confirm').value = 'NAIK KELAS';
        window.getStudentsCache.mockRejectedValueOnce(new Error('Offline'));
        await window.executeAnnualClassPromotion();
        expect(alert.mock.calls.at(-1)[0]).toBe('Reset Data Tahunan Selesai');
        expect(alert.mock.calls.at(-1)[1]).toContain('muat ulang halaman');
    });
});

describe('Annual backup format compatibility', () => {
    test('combined legacy alumni backup becomes real restore collections, deduplicated by primary key', () => {
        const backup = normalizeAnnualResetBackup({ metadata: { operation: 'annual_reset_alumni_cleanup' }, backups: {
            A: { students: [{ nis: '1', name: 'One' }], records: [{ id: 'a', student_nis: '1' }] },
            B: { students: [{ nis: '2', name: 'Two' }], records: [{ id: 'a', student_nis: '1' }] }
        } });
        expect(isAnnualResetBackup(backup)).toBe(true);
        expect(backup.students._count).toBe(2);
        expect(backup.records._count).toBe(1);
        expect(backup._meta.appName).toContain('SIMAS');
    });
    test('old promotion snapshot preserves raw column names for actual D1 restore', () => {
        const backup = normalizeAnnualResetBackup({ _meta: { appName: 'SIMAS - SHAKTI (Pra-Kenaikan Kelas Backup)' },
            students: [{ nis: '1', birth_place: 'Abang', violation_points: 25 }] });
        expect(backup.students.records[0]).toEqual({ nis: '1', birth_place: 'Abang', violation_points: 25 });
    });
    test('ordinary backups and other pages retain their existing contract', () => {
        const regular = { _meta: { appName: 'SIMAS' }, students: { records: [{ nis: '1' }] }, settings: { documents: {} } };
        expect(normalizeAnnualResetBackup(regular)).toBe(regular);
        expect(isAnnualResetBackup(regular)).toBe(false);
    });
});

describe('Actual settings Restore handler routing', () => {
    let client, alert;
    beforeEach(() => {
        document.documentElement.innerHTML = read('settings.html');
        window.hasRole = () => true;
        window.getStudentsCache = jest.fn(async () => []);
        client = { restoreAnnualResetTable: jest.fn(async (_, rows) => rows.length), bulkSyncStudents: jest.fn(async () => {}) };
        alert = jest.fn();
        const source = read('js/page-settings.js');
        const restoreSection = source.slice(source.indexOf('let _restoreData = null;'), source.indexOf('// SECTION: VIDEO HALAMAN LOGIN'));
        new Function('BACKUP_REGISTRY', 'normalizeAnnualResetBackup', 'isAnnualResetBackup', 'cfClient', 'showModernAlert', 'showToast', 'showConfirmModal',
            'let allKelasListSettings = [], transferStudentsSettings = [], isTransferStudentListReady = false;\n' + restoreSection)(
            { students: { db: 'd1', label: 'Siswa' }, records: { db: 'd1', label: 'Perilaku' } },
            normalizeAnnualResetBackup, isAnnualResetBackup, client, alert, jest.fn(), async () => true);
    });

    test('new annual backup includes FCM and uses real restore for every selected D1 table', async () => {
        const backup = { _meta: { appName: 'SIMAS', format: 'annual-reset-v2' },
            students: { _count: 1, records: [{ nis: '1', birth_place: 'Abang' }] },
            fcm_tokens: { _count: 1, records: [{ id: 'f', user_id: '1', token: 'device' }] } };
        await window.previewRestoreFile({ files: [{ name: 'backup.json', text: async () => JSON.stringify(backup) }] });
        expect(document.querySelector('input[name="restore-mode"][value="overwrite"]').disabled).toBe(true);
        expect(document.querySelectorAll('.restore-col-check:checked')).toHaveLength(2);
        await window.executeRestore();
        expect(client.restoreAnnualResetTable.mock.calls).toEqual([
            ['students', backup.students.records], ['fcm_tokens', backup.fcm_tokens.records]
        ]);
        expect(client.bulkSyncStudents).not.toHaveBeenCalled();
        expect(alert.mock.calls.at(-1)[0]).toBe('Restore Berhasil!');
    });

    test('combined old alumni backup is accepted by the real preview and restore UI', async () => {
        const backup = { metadata: { operation: 'annual_reset_alumni_cleanup' }, backups: {
            A: { students: [{ nis: '1' }], records: [{ id: 'r', student_nis: '1' }] }
        } };
        await window.previewRestoreFile({ files: [{ name: 'old.json', text: async () => JSON.stringify(backup) }] });
        await window.executeRestore();
        expect(client.restoreAnnualResetTable).toHaveBeenCalledTimes(2);
        expect(alert.mock.calls.at(-1)[0]).toBe('Restore Berhasil!');
    });

    test('ordinary backup retains its existing restore path and mode selector', async () => {
        const backup = { _meta: { appName: 'SIMAS' }, students: { records: [{ nis: '1' }] } };
        await window.previewRestoreFile({ files: [{ name: 'normal.json', text: async () => JSON.stringify(backup) }] });
        expect(document.querySelector('input[name="restore-mode"][value="overwrite"]').disabled).toBe(false);
        await window.executeRestore();
        expect(client.bulkSyncStudents).toHaveBeenCalledWith(backup.students.records);
        expect(client.restoreAnnualResetTable).not.toHaveBeenCalled();
    });
});
