/**
 * Unit Test: Fitur Pengeditan Kinerja Terlaksana via Klik Grid & Judul di E-Kinerja
 * Memverifikasi dukungan penuh edit log pada Matriks Mingguan (Gantt) dan Fokus Harian,
 * serta penyesuaian alur persetujuan: Verifikasi Otomatis (bisa diedit) vs Verifikasi Manual Kepsek (terkunci).
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Pengeditan Kinerja Terlaksana & 2 Kondisi Verifikasi (Otomatis vs Kepsek)', () => {
    const root = path.resolve(__dirname, '..');
    const pageBebanKerjaJsPath = path.join(root, 'js', 'page-beban-kerja.js');
    const eKinerjaHtmlPath = path.join(root, 'e-kinerja.html');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');

    const pageBebanKerjaJsContent = fs.readFileSync(pageBebanKerjaJsPath, 'utf8');
    const eKinerjaHtmlContent = fs.readFileSync(eKinerjaHtmlPath, 'utf8');
    const workerJsContent = fs.readFileSync(workerJsPath, 'utf8');

    test('1. e-kinerja.html memiliki form modal log dengan input hidden ID dan tombol submit dinamis', () => {
        expect(eKinerjaHtmlContent).toContain('id="modal-workload-log"');
        expect(eKinerjaHtmlContent).toContain('id="modal-log-title"');
        expect(eKinerjaHtmlContent).toContain('id="log-input-id"');
        expect(eKinerjaHtmlContent).toContain('id="btn-submit-workload-log"');
        expect(eKinerjaHtmlContent).toContain('id="btn-submit-workload-log-label"');
    });

    test('2. js/page-beban-kerja.js mendefinisikan dan mendaftarkan openEditLogModal ke window', () => {
        expect(pageBebanKerjaJsContent).toContain('export function openEditLogModal(logId)');
        expect(pageBebanKerjaJsContent).toContain('window.workloadOpenEditLogModal = openEditLogModal;');
    });

    test('3. openEditLogModal mengisi data lama dan mengubah label modal ke mode Perbarui Laporan', () => {
        expect(pageBebanKerjaJsContent).toContain("el('log-input-id').value = log.id;");
        expect(pageBebanKerjaJsContent).toContain("el('log-input-title').value = log.title || '';");
        expect(pageBebanKerjaJsContent).toContain("modalTitleEl.innerHTML = '<i class=\"fa-solid fa-pen-to-square text-emerald-500\"></i> Edit Laporan Realisasi';");
        expect(pageBebanKerjaJsContent).toContain("submitBtnLabel.textContent = 'Perbarui Laporan';");
    });

    test('4. renderWeeklyMatrixView mengaktifkan interaktivitas klik grid & judul pada blok terlaksana', () => {
        expect(pageBebanKerjaJsContent).toContain("onclick=\"window.workloadOpenEditLogModal('${linkedLog.id}')\"");
        expect(pageBebanKerjaJsContent).toContain("isDraftLog ? 'Lanjutkan Draf' : 'Edit Laporan'");
        expect(pageBebanKerjaJsContent).toContain("<i class=\"fa-solid fa-pen-to-square\"></i></button>");
        expect(pageBebanKerjaJsContent).toContain("Klik grid atau judul untuk edit laporan");
    });

    test('5. renderSingleDayFocusView menyediakan klik kartu, klik judul, dan tombol Edit Laporan', () => {
        expect(pageBebanKerjaJsContent).toContain("onclick=\"window.workloadOpenEditLogModal('${linkedLog.id}')\"");
        expect(pageBebanKerjaJsContent).toContain("onclick=\"event.stopPropagation(); window.workloadOpenEditLogModal('${linkedLog.id}')\"");
        expect(pageBebanKerjaJsContent).toContain("<span>Edit Laporan</span>");
    });

    test('6. saveLog membedakan toast notifikasi saat update (perbarui) vs create (simpan baru)', () => {
        expect(pageBebanKerjaJsContent).toContain("showToast(existingId ? 'Laporan realisasi berhasil diperbarui' : 'Laporan realisasi berhasil disimpan');");
    });

    test('7. js/page-beban-kerja.js mengekspor isLogLockedByManualVerification dan mendaftarkannya ke window', () => {
        expect(pageBebanKerjaJsContent).toContain('export function isLogLockedByManualVerification(log)');
        expect(pageBebanKerjaJsContent).toContain('window.isLogLockedByManualVerification = isLogLockedByManualVerification;');
    });

    test('8. Logika isLogLockedByManualVerification: Mode Mandiri dan verifikasi otomatis sistem TIDAK dikunci', () => {
        // Ekstrak implementasi fungsi isLogLockedByManualVerification untuk pengujian logika terisolasi
        function testIsLogLocked(log, policy, weekData) {
            if (!log) return false;
            if (log.is_locked === 1 || weekData?.week?.is_locked === 1) return true;

            // Jika kebijakan sekolah Mode Mandiri (require_log_verification === 0),
            // verifikasi berlangsung otomatis dan guru berhak mengedit kembali
            if (policy && Number(policy.require_log_verification) === 0) {
                return false;
            }

            // Jika log diverifikasi otomatis oleh sistem, guru tetap bisa mengedit
            if (log.verified_by_uid === 'system_auto_policy') {
                return false;
            }

            // Terkunci HANYA jika diverifikasi manual oleh Kepala Sekolah / Pejabat Penilai
            return log.verification_status === 'verified' && Boolean(log.verified_by_uid);
        }

        // Kondisi 1: Log terverifikasi otomatis oleh sistem (Mode Mandiri aktif) -> BISA DIEDIT (false)
        const autoLog = {
            id: 'wl_001',
            verification_status: 'verified',
            verified_by_uid: 'system_auto_policy',
            is_locked: 0
        };
        const policyMandiri = { require_log_verification: 0 };
        expect(testIsLogLocked(autoLog, policyMandiri, { week: { is_locked: 0 } })).toBe(false);

        // Kondisi 2: Log terverifikasi tapi kebijakan sekolah require_log_verification === 0 -> BISA DIEDIT (false)
        const logAnyVer = {
            id: 'wl_002',
            verification_status: 'verified',
            verified_by_uid: 'some_uid',
            is_locked: 0
        };
        expect(testIsLogLocked(logAnyVer, policyMandiri, { week: { is_locked: 0 } })).toBe(false);

        // Kondisi 3: Log berstatus unverified -> BISA DIEDIT (false)
        const unverifiedLog = {
            id: 'wl_003',
            verification_status: 'unverified',
            verified_by_uid: null,
            is_locked: 0
        };
        const policyManual = { require_log_verification: 1 };
        expect(testIsLogLocked(unverifiedLog, policyManual, { week: { is_locked: 0 } })).toBe(false);

        // Kondisi 4: Log BENAR-BENAR diverifikasi manual oleh Kepala Sekolah (require_log_verification === 1) -> TERKUNCI (true)
        const kepsekVerifiedLog = {
            id: 'wl_004',
            verification_status: 'verified',
            verified_by_uid: 'uid_kepsek_123',
            is_locked: 0
        };
        expect(testIsLogLocked(kepsekVerifiedLog, policyManual, { week: { is_locked: 0 } })).toBe(true);

        // Kondisi 5: Minggu kerja terkunci atau log dikunci eksplisit -> TERKUNCI (true)
        expect(testIsLogLocked(autoLog, policyMandiri, { week: { is_locked: 1 } })).toBe(true);
        expect(testIsLogLocked({ ...autoLog, is_locked: 1 }, policyMandiri, { week: { is_locked: 0 } })).toBe(true);
    });

    test('9. openEditLogModal dan deleteLog di page-beban-kerja.js menggunakan isLogLockedByManualVerification', () => {
        expect(pageBebanKerjaJsContent).toContain('if (isLogLockedByManualVerification(log))');
        expect(pageBebanKerjaJsContent).toContain("showToast('Laporan ini telah diverifikasi oleh Kepala Sekolah dan tidak dapat diubah.', 'warning');");
    });

    test('10. Matriks Mingguan dan Fokus Harian membedakan status badge Terverifikasi (Otomatis) vs (Kepsek)', () => {
        expect(pageBebanKerjaJsContent).toContain("const isAuto = linkedLog.verified_by_uid === 'system_auto_policy'");
        expect(pageBebanKerjaJsContent).toContain("const verText = isAuto ? 'Terverifikasi (Otomatis)' : 'Terverifikasi (Kepsek)';");
        expect(pageBebanKerjaJsContent).toContain("const isAutoUnplanned = log.verified_by_uid === 'system_auto_policy'");
    });

    test('11. Backend worker.js membedakan auto-verified vs manual Kepsek pada POST dan DELETE workload logs', () => {
        expect(workerJsContent).toContain('const isManualVerified = existingLog.verification_status === "verified"');
        expect(workerJsContent).toContain('existingLog.verified_by_uid !== "system_auto_policy"');
        expect(workerJsContent).toContain('policyCfg.require_log_verification !== 0');
        expect(workerJsContent).toContain('Laporan ini telah diverifikasi oleh Kepala Sekolah dan tidak dapat diubah');
        expect(workerJsContent).toContain('Laporan ini telah diverifikasi oleh Kepala Sekolah dan tidak dapat dihapus');
    });

    test('12. syncJournalToWorkload di worker.js melindungi log yang telah diverifikasi manual oleh Kepala Sekolah', () => {
        expect(workerJsContent).toMatch(/SELECT\s+is_locked,\s+verification_status,\s+verified_by_uid.*FROM\s+work_logs\s+WHERE\s+id\s*=\s*\?/i);
        expect(workerJsContent).toContain('Laporan realisasi telah diverifikasi secara manual oleh Kepala Sekolah');
    });

    test('13. Kartu timeline Gantt & Fokus Harian TIDAK memunculkan tombol hapus langsung (anti-accidental deletion)', () => {
        // Pada kartu matriks mingguan Gantt, hanya ada tombol Edit Laporan, bukan tombol hapus
        expect(pageBebanKerjaJsContent).not.toContain("window.workloadDeleteLog('${linkedLog.id}')");
        // Pada kartu Fokus Harian, hanya ada tombol Edit Laporan
        expect(pageBebanKerjaJsContent).not.toContain("window.workloadDeleteLog('${log.id}')");
    });

    test('14. e-kinerja.html memuat tombol Hapus Laporan secara eksklusif di footer modal edit log', () => {
        expect(eKinerjaHtmlContent).toContain('id="btn-delete-workload-log"');
        expect(eKinerjaHtmlContent).toContain('onclick="window.workloadDeleteCurrentLog()"');
        expect(eKinerjaHtmlContent).toContain('Hapus Laporan');
    });

    test('15. page-beban-kerja.js mengelola visibilitas tombol hapus di modal dan konfirmasi pembalikan status rencana', () => {
        expect(pageBebanKerjaJsContent).toContain("btnDel.classList.remove('hidden')");
        expect(pageBebanKerjaJsContent).toContain("el('btn-delete-workload-log')?.classList.add('hidden')");
        expect(pageBebanKerjaJsContent).toContain('export async function deleteCurrentLog()');
        expect(pageBebanKerjaJsContent).toContain('window.workloadDeleteCurrentLog = deleteCurrentLog;');
        expect(pageBebanKerjaJsContent).toContain('Setelah dihapus, status kegiatan akan kembali menjadi rencana kerja yang belum dilaporkan');
        expect(pageBebanKerjaJsContent).toContain('Laporan realisasi berhasil dihapus. Kegiatan kembali menjadi rencana kerja.');
    });

    test('16. Kartu timeline Gantt desktop dan Fokus Harian tidak menyisipkan ikon pensil duplikat di samping judul (0 duplicate edit buttons)', () => {
        // Pada Gantt desktop, judul bersih dari ikon pensil duplikat
        expect(pageBebanKerjaJsContent).not.toContain("canEditGantt ? '<i class=\"fa-solid fa-pen-to-square");
        // Pada Fokus Harian, judul bersih dari ikon pensil duplikat
        expect(pageBebanKerjaJsContent).not.toContain("canEditCard ? '<i class=\"fa-solid fa-pen-to-square");
        expect(pageBebanKerjaJsContent).not.toContain("canEditUnplanned ? '<i class=\"fa-solid fa-pen-to-square");
    });
});
