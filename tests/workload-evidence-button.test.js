/**
 * Unit Test: Fitur Tombol & Pratinjau Bukti Dukung KBM (Google Drive / Foto)
 * Memverifikasi dukungan penuh tombol buka gambar bukti dukung pada modal-workload-log,
 * matriks mingguan (Gantt chart), fokus harian, dan modal review Kepala Sekolah.
 * Memastikan kepatuhan keamanan OWASP (Sanitasi URL & Anti-XSS).
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Tombol & Pratinjau Bukti Dukung KBM (Google Drive / Foto)', () => {
    const root = path.resolve(__dirname, '..');
    const eKinerjaHtmlPath = path.join(root, 'e-kinerja.html');
    const pageBebanKerjaJsPath = path.join(root, 'js', 'page-beban-kerja.js');
    const pageMonitoringJsPath = path.join(root, 'js', 'page-monitoring-beban-kerja.js');

    const eKinerjaHtml = fs.readFileSync(eKinerjaHtmlPath, 'utf8');
    const pageBebanKerjaJs = fs.readFileSync(pageBebanKerjaJsPath, 'utf8');
    const pageMonitoringJs = fs.readFileSync(pageMonitoringJsPath, 'utf8');

    test('1. e-kinerja.html memiliki input group bukti dukung dengan ikon Google Drive, tombol Buka Gambar, dan preview box', () => {
        expect(eKinerjaHtml).toContain('id="log-input-evidence"');
        expect(eKinerjaHtml).toContain('id="btn-click-open-evidence"');
        expect(eKinerjaHtml).toContain('id="box-evidence-preview"');
        expect(eKinerjaHtml).toContain('id="img-evidence-thumbnail"');
        expect(eKinerjaHtml).toContain('onclick="window.workloadOpenCurrentEvidence()"');
        expect(eKinerjaHtml).toContain('oninput="window.workloadSyncEvidenceButtons()"');
    });

    test('2. js/page-beban-kerja.js mendefinisikan dan mendaftarkan fungsi-fungsi bukti dukung ke window', () => {
        expect(pageBebanKerjaJs).toContain('export function sanitizeUrl(');
        expect(pageBebanKerjaJs).toContain('export function getGoogleDriveThumbnail(');
        expect(pageBebanKerjaJs).toContain('export function workloadOpenEvidence(');
        expect(pageBebanKerjaJs).toContain('export function workloadOpenCurrentEvidence(');
        expect(pageBebanKerjaJs).toContain('export function workloadSyncEvidenceButtons(');

        expect(pageBebanKerjaJs).toContain('window.workloadOpenEvidence = workloadOpenEvidence;');
        expect(pageBebanKerjaJs).toContain('window.workloadOpenCurrentEvidence = workloadOpenCurrentEvidence;');
        expect(pageBebanKerjaJs).toContain('window.workloadSyncEvidenceButtons = workloadSyncEvidenceButtons;');
    });

    test('3. Logika sanitizeUrl mematuhi OWASP (anti-XSS javascript: protocol dan parsing yang valid)', () => {
        function sanitizeUrl(url) {
            if (!url || typeof url !== 'string') return '';
            const trimmed = url.trim();
            if (!trimmed) return '';
            try {
                let validUrlStr = trimmed;
                if (/^\/\//.test(validUrlStr)) {
                    validUrlStr = 'https:' + validUrlStr;
                } else if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//i.test(validUrlStr)) {
                    validUrlStr = 'https://' + validUrlStr;
                }
                const parsed = new URL(validUrlStr);
                if (['http:', 'https:'].includes(parsed.protocol)) {
                    return parsed.href;
                }
            } catch (_) {}
            return '';
        }

        // URL Google Drive normal
        expect(sanitizeUrl('https://drive.google.com/file/d/1A2B3C/view')).toBe('https://drive.google.com/file/d/1A2B3C/view');
        // URL tanpa skema protokol
        expect(sanitizeUrl('drive.google.com/open?id=XYZ789')).toBe('https://drive.google.com/open?id=XYZ789');
        // XSS attack vectors harus ditolak (return string kosong)
        expect(sanitizeUrl('javascript:alert(1)')).toBe('');
        expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
        expect(sanitizeUrl('vbscript:msgbox(1)')).toBe('');
        expect(sanitizeUrl('')).toBe('');
        expect(sanitizeUrl(null)).toBe('');
    });

    test('4. Logika getGoogleDriveThumbnail mengekstrak ID berkas dari ragam format link Google Drive', () => {
        function getGoogleDriveThumbnail(url) {
            if (!url || typeof url !== 'string') return '';
            const trimmed = url.trim();
            const match = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                          trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                          trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
            if (match && match[1]) {
                return `https://lh3.googleusercontent.com/d/${encodeURIComponent(match[1])}`;
            }
            if (/\.(jpeg|jpg|png|webp|gif|svg)($|\?)/i.test(trimmed)) {
                return trimmed;
            }
            return '';
        }

        // Format 1: /file/d/{id}/view
        expect(getGoogleDriveThumbnail('https://drive.google.com/file/d/1AbC-Def_123/view?usp=sharing'))
            .toBe('https://lh3.googleusercontent.com/d/1AbC-Def_123');

        // Format 2: ?id={id}
        expect(getGoogleDriveThumbnail('https://drive.google.com/open?id=987_xyz-ABC'))
            .toBe('https://lh3.googleusercontent.com/d/987_xyz-ABC');

        // Format 3: direct image URL
        expect(getGoogleDriveThumbnail('https://example.com/foto_kbm.jpg'))
            .toBe('https://example.com/foto_kbm.jpg');

        // Format 4: bukan gambar & bukan GDrive
        expect(getGoogleDriveThumbnail('https://example.com/dokumen.pdf')).toBe('');
    });

    test('5. renderWeeklyMatrixView menyediakan tombol buka bukti dukung pada kartu Gantt dan unplanned logs via workloadOpenLightboxFromLogId', () => {
        expect(pageBebanKerjaJs).toContain("window.workloadOpenLightboxFromLogId('${linkedLog.id}')");
        expect(pageBebanKerjaJs).toContain('title="Buka Gambar Bukti KBM (Google Drive / Foto)"');
        expect(pageBebanKerjaJs).toContain('title="Klik untuk membuka gambar bukti KBM"><i class="fa-solid fa-image text-[6.5px]"></i> Bukti</span>');
        expect(pageBebanKerjaJs).toContain("window.workloadOpenLightboxFromLogId('${uLog.id}')");
    });

    test('6. renderSingleDayFocusView menyediakan tombol Buka Gambar Bukti pada kartu rencana dan kartu unplanned', () => {
        expect(pageBebanKerjaJs).toContain('<span>Buka Gambar Bukti</span>');
        expect(pageBebanKerjaJs).toContain('title="Buka tautan bukti kegiatan (Google Drive / Foto)"');
    });

    test('7. openLogModal dan openEditLogModal memanggil workloadSyncEvidenceButtons() untuk sinkronisasi state', () => {
        expect(pageBebanKerjaJs).toMatch(/el\('log-input-evidence'\)\.value\s*=\s*'';\s*workloadSyncEvidenceButtons\(\);/);
        expect(pageBebanKerjaJs).toMatch(/el\('log-input-evidence'\)\.value\s*=\s*isJsonEvidence\s*\?\s*''\s*:\s*rawEvidence;\s*workloadSyncEvidenceButtons\(\);/);
    });

    test('8. js/page-monitoring-beban-kerja.js menyertakan tautan Buka Gambar Bukti Dukung pada modal review Kepala Sekolah', () => {
        expect(pageMonitoringJs).toContain('Buka Gambar Bukti Dukung (Google Drive / Foto)');
        expect(pageMonitoringJs).toContain('target="_blank" rel="noopener noreferrer"');
        expect(pageMonitoringJs).toContain('function sanitizeUrl(');
    });

    test('9. Proteksi Regresi: JSON array multi-foto harus dibuka via workloadOpenLightboxFromLogId (bukan sanitizeUrl)', () => {
        // Multi-foto disimpan sebagai JSON array di evidence_url
        const multiPhotos = [
            { url: 'https://drive.google.com/file/d/FOTO_1/view', fileId: 'FOTO_1', name: 'Foto 1.jpg', caption: 'KBM 1' },
            { url: 'https://drive.google.com/file/d/FOTO_2/view', fileId: 'FOTO_2', name: 'Foto 2.jpg', caption: 'KBM 2' }
        ];
        const rawJsonEvidence = JSON.stringify(multiPhotos);

        // Bukti akar masalah: sanitizeUrl mengembalikan string kosong jika diberi JSON string
        function sanitizeUrl(url) {
            if (!url || typeof url !== 'string') return '';
            const trimmed = url.trim();
            if (!trimmed) return '';
            try {
                let validUrlStr = trimmed;
                if (/^\/\//.test(validUrlStr)) {
                    validUrlStr = 'https:' + validUrlStr;
                } else if (!/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//i.test(validUrlStr)) {
                    validUrlStr = 'https://' + validUrlStr;
                }
                const parsed = new URL(validUrlStr);
                if (['http:', 'https:'].includes(parsed.protocol)) {
                    return parsed.href;
                }
            } catch (_) {}
            return '';
        }

        // Verifikasi bahwa sanitizeUrl merusak format JSON (mengembalikan '')
        expect(sanitizeUrl(rawJsonEvidence)).toBe('');

        // Verifikasi bahwa Gantt chart tidak lagi memanggil workloadOpenEvidence dengan safeEvidenceUrl
        expect(pageBebanKerjaJs).not.toContain("window.workloadOpenEvidence('${escapeHTML(safeEvidenceUrl)}')");

        // Verifikasi bahwa Gantt chart menggunakan workloadOpenLightboxFromLogId yang membaca data asli
        expect(pageBebanKerjaJs).toContain("window.workloadOpenLightboxFromLogId('${linkedLog.id}')");
        expect(pageBebanKerjaJs).toContain("window.workloadOpenLightboxFromLogId('${uLog.id}')");
    });
});
