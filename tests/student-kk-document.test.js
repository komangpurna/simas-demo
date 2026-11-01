/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

// Helper replika dari page-portal-siswa.js untuk pengujian unit
function extractGoogleDriveFileId(url) {
    if (!url || typeof url !== 'string') return null;
    const patterns = [
        /\/file\/d\/([a-zA-Z0-9_-]+)/,
        /id=([a-zA-Z0-9_-]+)/,
        /\/d\/([a-zA-Z0-9_-]+)/,
        /\/open\?id=([a-zA-Z0-9_-]+)/,
        /\/uc\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m && m[1]) return m[1];
    }
    return null;
}

function getGoogleDriveThumbnail(url) {
    if (!url) return '';
    const fileId = extractGoogleDriveFileId(url);
    if (fileId) {
        return `https://lh3.googleusercontent.com/d/${fileId}=w600`;
    }
    return url;
}

function getCurrentAcademicYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    if (month >= 7) {
        return `${year}-${year + 1}`;
    }
    return `${year - 1}-${year}`;
}

describe('Student KK Document & Google Drive Upload Verification', () => {

    test('1. Ekstraksi Google Drive fileId dari berbagai variasi URL tautan Google Drive', () => {
        const testUrls = [
            'https://drive.google.com/file/d/1a2b3c4d5e6f7g8h9i0j/view?usp=sharing',
            'https://drive.google.com/open?id=1a2b3c4d5e6f7g8h9i0j',
            'https://drive.google.com/uc?id=1a2b3c4d5e6f7g8h9i0j&export=download',
            'https://drive.google.com/d/1a2b3c4d5e6f7g8h9i0j'
        ];

        testUrls.forEach(url => {
            const id = extractGoogleDriveFileId(url);
            expect(id).toBe('1a2b3c4d5e6f7g8h9i0j');
        });

        expect(extractGoogleDriveFileId('')).toBeNull();
        expect(extractGoogleDriveFileId(null)).toBeNull();
    });

    test('2. Resolusi Thumbnail Google Drive yang dioptimasi', () => {
        const url = 'https://drive.google.com/file/d/1ABCXYZ_12345/view';
        const thumb = getGoogleDriveThumbnail(url);
        expect(thumb).toBe('https://lh3.googleusercontent.com/d/1ABCXYZ_12345=w600');

        expect(getGoogleDriveThumbnail('')).toBe('');
    });

    test('3. Format Tahun Ajaran Aktif mengikuti pola YYYY-YYYY', () => {
        const academicYear = getCurrentAcademicYear();
        expect(academicYear).toMatch(/^\d{4}-\d{4}$/);
        const [y1, y2] = academicYear.split('-').map(Number);
        expect(y2).toBe(y1 + 1);
    });

    test('4. Format Nama Berkas SSOT KK Siswa: KK_{NIS}_{Nama Siswa}.jpg', () => {
        const nis = '1234';
        const nama = 'I Komang Purna';
        const safeName = nama.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
        const safeNis = String(nis).replace(/[^a-zA-Z0-9_-]/g, '').trim();
        const fileName = `KK_${safeNis}_${safeName}.jpg`;

        expect(fileName).toBe('KK_1234_I Komang Purna.jpg');
    });

    test('5. Whitelist field KK siswa di cloudflare/worker.js untuk update mandiri (isOwner)', () => {
        const workerContent = fs.readFileSync(path.join(rootDir, 'cloudflare', 'worker.js'), 'utf8');
        expect(workerContent).toContain('"kk_document_url"');
        expect(workerContent).toContain('"kk_file_id"');
        expect(workerContent).toContain('"kk_uploaded_at"');
        expect(workerContent).toContain('"kk_file_name"');
        expect(workerContent).toContain('"kk_drive_folder"');
    });

    test('6. Integritas DOM modal-preview-kk dan form KK di portal-siswa.html', () => {
        const htmlContent = fs.readFileSync(path.join(rootDir, 'portal-siswa.html'), 'utf8');

        // Memastikan input file KK ada
        expect(htmlContent).toContain('id="input-kk-file"');
        expect(htmlContent).toContain('id="student-kk-status-badge"');
        expect(htmlContent).toContain('id="student-kk-img"');
        expect(htmlContent).toContain('id="modal-preview-kk"');

        // Memastikan modal-preview-kk adalah top-level sibling di luar <main>
        const mainCloseIdx = htmlContent.indexOf('</main>');
        const modalPreviewKKIdx = htmlContent.indexOf('id="modal-preview-kk"');
        expect(modalPreviewKKIdx).toBeGreaterThan(mainCloseIdx);
    });

    test('7. Ekspor konfigurasi STUDENT_DOCS_APPS_SCRIPT_URL di js/config.js dan js/school-config.js', () => {
        const configContent = fs.readFileSync(path.join(rootDir, 'js', 'config.js'), 'utf8');
        expect(configContent).toContain('export const STUDENT_DOCS_APPS_SCRIPT_URL');

        const schoolConfigContent = fs.readFileSync(path.join(rootDir, 'js', 'school-config.js'), 'utf8');
        expect(schoolConfigContent).toContain('studentDocsAppsScriptUrl');
    });

    test('8. Keberadaan Google Apps Script Standalone Dokumen_Siswa_Drive_Uploader.gs', () => {
        const gasPath = path.join(rootDir, 'google-apps-script', 'Dokumen_Siswa_Drive_Uploader.gs');
        expect(fs.existsSync(gasPath)).toBe(true);

        const gasContent = fs.readFileSync(gasPath, 'utf8');
        expect(gasContent).toContain('var ROOT_FOLDER_NAME = "KK-Siswa"');
        expect(gasContent).toContain('autoCleanupExpiredDocuments');
        expect(gasContent).toContain('RETENTION_DAYS = 1095');
    });

    test('9. Fungsi-fungsi kompresi dan upload KK ada di js/page-portal-siswa.js', () => {
        const pageJsContent = fs.readFileSync(path.join(rootDir, 'js', 'page-portal-siswa.js'), 'utf8');
        expect(pageJsContent).toContain('compressKKImageToJpeg');
        expect(pageJsContent).toContain('uploadStudentKKToDrive');
        expect(pageJsContent).toContain('deleteStudentKKFromDrive');
        expect(pageJsContent).toContain('renderKKPreviewUI');
        expect(pageJsContent).toContain('updateHubKKStatus');
        expect(pageJsContent).toContain('handleKKFileSelect');
        expect(pageJsContent).toContain('openKKPreviewModal');
        expect(pageJsContent).toContain('closeKKPreviewModal');
        expect(pageJsContent).toContain('deleteKKPhoto');
    });

});
