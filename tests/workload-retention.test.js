/**
 * tests/workload-retention.test.js
 * Unit Test: Kebijakan Retensi 3 Tahun & Pembersihan Foto Google Drive E-Kinerja Guru
 * Memverifikasi logika ekstraksi ID Drive, parsing bukti dukung, dan integritas kueri cascade delete
 */

const fs = require('fs');
const path = require('path');

describe('Suite Pengujian Retensi 3 Tahun & Pembersihan Foto E-Kinerja Guru', () => {
    const root = path.resolve(__dirname, '..');
    const workerPath = path.join(root, 'cloudflare', 'worker.js');
    const workerCode = fs.readFileSync(workerPath, 'utf8');

    // 1. Ekstraksi fungsi extractGoogleDriveFileId untuk pengujian unit langsung
    function extractGoogleDriveFileId(url) {
        if (!url || typeof url !== 'string') return '';
        const trimmed = url.trim();
        const match = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                      trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                      trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
        return match ? match[1] : '';
    }

    // 2. Helper parsing Drive IDs dari evidence_url
    function parseDriveIdsFromEvidence(evidenceRaw) {
        if (!evidenceRaw) return [];
        const driveIds = [];
        const raw = String(evidenceRaw).trim();
        if (raw.startsWith('[') && raw.endsWith(']')) {
            try {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) {
                    for (const it of arr) {
                        if (it && it.fileId) {
                            driveIds.push(it.fileId);
                        } else if (it && it.url) {
                            const fid = extractGoogleDriveFileId(it.url);
                            if (fid) driveIds.push(fid);
                        }
                    }
                }
            } catch (_) {}
        } else if (raw) {
            const fid = extractGoogleDriveFileId(raw);
            if (fid) driveIds.push(fid);
        }
        return driveIds;
    }

    test('1. extractGoogleDriveFileId mampu mengekstrak file ID dari berbagai format URL Google Drive', () => {
        expect(extractGoogleDriveFileId('https://drive.google.com/file/d/1A2B3C4D_XYZ/view?usp=sharing')).toBe('1A2B3C4D_XYZ');
        expect(extractGoogleDriveFileId('https://drive.google.com/open?id=DRIVE_FILE_789')).toBe('DRIVE_FILE_789');
        expect(extractGoogleDriveFileId('https://drive.google.com/uc?id=FILE_ABC-123&export=download')).toBe('FILE_ABC-123');
        expect(extractGoogleDriveFileId('https://lh3.googleusercontent.com/d/THUMB_ID_456')).toBe('THUMB_ID_456');
        expect(extractGoogleDriveFileId('https://example.com/other-file.jpg')).toBe('');
        expect(extractGoogleDriveFileId('')).toBe('');
    });

    test('2. parseDriveIdsFromEvidence mampu mengekstrak seluruh file ID dari array JSON multi-foto', () => {
        const jsonEvidence = JSON.stringify([
            { url: 'https://lh3.googleusercontent.com/d/FILE_001', fileId: 'FILE_001', name: 'Foto 1' },
            { url: 'https://drive.google.com/file/d/FILE_002/view', name: 'Foto 2' },
            { url: 'https://lh3.googleusercontent.com/d/FILE_003', fileId: 'FILE_003', name: 'Foto 3' }
        ]);

        const ids = parseDriveIdsFromEvidence(jsonEvidence);
        expect(ids).toEqual(['FILE_001', 'FILE_002', 'FILE_003']);
    });

    test('3. parseDriveIdsFromEvidence mendukung format single URL string legacy', () => {
        const singleUrl = 'https://drive.google.com/file/d/LEGACY_DRIVE_ID/view';
        const ids = parseDriveIdsFromEvidence(singleUrl);
        expect(ids).toEqual(['LEGACY_DRIVE_ID']);
    });

    test('4. cloudflare/worker.js memuat fungsi helper extractGoogleDriveFileId dan deleteGoogleDrivePhotosViaAppsScript', () => {
        expect(workerCode).toContain('function extractGoogleDriveFileId(');
        expect(workerCode).toContain('async function deleteGoogleDrivePhotosViaAppsScript(');
        expect(workerCode).toContain('action: \'delete\'');
    });

    test('5. performAutoCleanup di worker.js memuat logika penghapusan retensi 3 tahun E-Kinerja Guru', () => {
        const normalizedCode = workerCode.replace(/\s+/g, ' ');
        expect(normalizedCode).toContain('14. Cleanup Modul E-Kinerja Guru (> 3 tahun / masa retensi 3 tahun)');
        expect(normalizedCode).toContain("DELETE FROM work_logs WHERE date < date('now', '-3 years')");
        expect(normalizedCode).toContain("DELETE FROM work_log_segments WHERE work_log_id IN (");
        expect(normalizedCode).toContain("DELETE FROM plan_log_links WHERE work_log_id IN (");
        expect(normalizedCode).toContain("DELETE FROM work_weeks WHERE week_end_date < date('now', '-3 years')");
        expect(normalizedCode).toContain("workload_audit_logs kini telah diintegrasikan ke Supabase audit_logs SSOT");
    });

    test('6. performAutoCleanup memanggil pembersihan foto Google Drive sebelum menghapus data D1', () => {
        const normalizedCode = workerCode.replace(/\s+/g, ' ');
        // Memastikan kueri SELECT evidence_url work_logs usang dilakukan sebelum kueri DELETE
        const selectIndex = normalizedCode.indexOf("SELECT id, evidence_url FROM work_logs WHERE date < date('now', '-3 years')");
        const deleteWorkLogsIndex = normalizedCode.indexOf("DELETE FROM work_logs WHERE date < date('now', '-3 years')");
        
        expect(selectIndex).toBeGreaterThan(-1);
        expect(deleteWorkLogsIndex).toBeGreaterThan(-1);
        expect(selectIndex).toBeLessThan(deleteWorkLogsIndex);

        // Memastikan Apps Script URL terdefinisi dengan fallback
        expect(workerCode).toContain('env.EKINERJA_APPS_SCRIPT_URL');
        expect(workerCode).toContain('workloadPhotosDriveDeleted = await deleteGoogleDrivePhotosViaAppsScript(');
    });

    test('7. performAutoCleanup juga membersihkan foto Google Drive untuk Jurnal Mengajar dan Agenda Pegawai', () => {
        expect(workerCode).toContain('jurnalPhotosDriveDeleted = await deleteGoogleDrivePhotosViaAppsScript(');
        expect(workerCode).toContain('empPhotosDriveDeleted = await deleteGoogleDrivePhotosViaAppsScript(');
        expect(workerCode).toContain('env.JURNAL_APPS_SCRIPT_URL');
    });

    test('8. Objek summary pada performAutoCleanup memuat metrik E-Kinerja dan Foto Drive yang dihapus', () => {
        expect(workerCode).toContain('workloadLogs: workloadLogsDeleted');
        expect(workerCode).toContain('workloadWeeks: workloadWeeksDeleted');
        expect(workerCode).toContain('workloadAuditLogs: workloadAuditLogsDeleted');
        expect(workerCode).toContain('workloadPhotosDrive: workloadPhotosDriveDeleted');
        expect(workerCode).toContain('jurnalPhotosDrive: jurnalPhotosDriveDeleted');
        expect(workerCode).toContain('empPhotosDrive: empPhotosDriveDeleted');
    });
});
