/**
 * tests/employee-absence-parity.test.js
 * ====================================================================
 * Test Suite: Paritas Otorisasi, Siklus Hidup Penuh, dan Integritas DOM
 * Pencatatan Keterangan Tidak Melaksanakan Tugas (Sakit / Cuti / Izin) Tendik
 *
 * Menguji:
 * 1. Integritas Struktur DOM & Kepatuhan Modal Anti-Nesting
 * 2. Paritas Endpoint Klien-Server (Client-Worker API Parity)
 * 3. Logika Otorisasi Backend RBAC & Paritas Aksi (Action Parity)
 *    - Skenario Positif: Pemilik data (isOwner) dapat mencatat & membatalkan
 *    - Skenario Pengelola: Kepala Sekolah/Supervisor dapat mengelola status staf
 *    - Skenario Negatif: Pengguna lain tertolak tegas HTTP 403 Forbidden
 * 4. Aturan Bisnis & Rekapitulasi Kinerja (37.5 Jam Target, 0m Terealisasi, Status Sah)
 * ====================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

describe('Suite Pengujian Siklus Hidup & Paritas Ketidakhadiran Pegawai (Sakit/Cuti/Izin)', () => {
    const root = path.resolve(__dirname, '..');
    const htmlPath = path.join(root, 'e-kinerja-tendik.html');
    const jsPath = path.join(root, 'js', 'page-e-kinerja-tendik.js');
    const clientJsPath = path.join(root, 'js', 'cloudflare-client.js');
    const workerJsPath = path.join(root, 'cloudflare', 'worker.js');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    const clientJsContent = fs.readFileSync(clientJsPath, 'utf8');
    const workerJsContent = fs.readFileSync(workerJsPath, 'utf8');

    let dom;
    let doc;

    beforeEach(() => {
        dom = new JSDOM(htmlContent, { runScripts: 'outside-only' });
        doc = dom.window.document;
    });

    // =========================================================================
    // 1. STRUKTUR DOM & KEPATUHAN MODAL ANTI-NESTING
    // =========================================================================
    describe('1. Integritas DOM & Desain UI Keterangan Ketidakhadiran', () => {
        test('1.1. Panel interaktif #employee-absence-action-panel tersedia di kartu timeline harian', () => {
            const panel = doc.getElementById('employee-absence-action-panel');
            expect(panel).not.toBeNull();

            const emptyState = doc.getElementById('panel-absence-empty');
            const activeState = doc.getElementById('panel-absence-active');
            expect(emptyState).not.toBeNull();
            expect(activeState).not.toBeNull();
            expect(activeState.classList.contains('hidden')).toBe(true); // default tersembunyi
        });

        test('1.2. Dialog #modal-employee-absence berdiri mandiri sebagai top-level sibling di luar <main>', () => {
            const modal = doc.getElementById('modal-employee-absence');
            expect(modal).not.toBeNull();
            expect(modal.classList.contains('hidden')).toBe(true);

            // Verifikasi Modal Anti-Nesting Mandate
            const mainEl = doc.querySelector('main');
            expect(mainEl).not.toBeNull();
            expect(mainEl.contains(modal)).toBe(false);
            expect(modal.parentElement).toBe(doc.body);
        });

        test('1.3. Form #form-employee-absence memuat field input lengkap dan mematuhi Anti-Overlapping Icon', () => {
            const form = doc.getElementById('form-employee-absence');
            expect(form).not.toBeNull();

            const inputId = doc.getElementById('absence-form-id');
            const inputDate = doc.getElementById('absence-form-date');
            const selectType = doc.getElementById('absence-form-type');
            const textareaNotes = doc.getElementById('absence-form-notes');
            const btnSubmit = doc.getElementById('btn-submit-employee-absence');
            const btnDelete = doc.getElementById('btn-delete-employee-absence');

            expect(inputId).not.toBeNull();
            expect(inputDate).not.toBeNull();
            expect(selectType).not.toBeNull();
            expect(textareaNotes).not.toBeNull();
            expect(btnSubmit).not.toBeNull();
            expect(btnDelete).not.toBeNull();

            // Pilihan dropdown jenis absensi mencakup Sakit, Cuti, Izin
            const options = Array.from(selectType.querySelectorAll('option')).map(o => o.value);
            expect(options).toContain('Sakit');
            expect(options).toContain('Cuti');
            expect(options).toContain('Izin');

            // Kepatuhan Anti-Overlapping Icon: ikon diletakkan di <label>, input menggunakan padding seimbang (px-3.5)
            expect(selectType.className).toContain('px-3.5');
            expect(textareaNotes.className).toContain('px-3.5');
            expect(selectType.className).not.toContain('pl-9');
            expect(textareaNotes.className).not.toContain('pl-9');
        });
    });

    // =========================================================================
    // 2. PARITAS ENDPOINT KLIEN-SERVER (CLIENT-WORKER API PARITY)
    // =========================================================================
    describe('2. Paritas Klien API (cloudflare-client.js -> worker.js)', () => {
        test('2.1. cfClient mengimplementasikan getEmployeeAbsences, saveEmployeeAbsence, dan deleteEmployeeAbsence', () => {
            expect(clientJsContent).toContain('getEmployeeAbsences(');
            expect(clientJsContent).toContain('saveEmployeeAbsence(');
            expect(clientJsContent).toContain('deleteEmployeeAbsence(');
        });

        test('2.2. Endpoint /api/employee-agenda/absences dan /api/employee-absences terdaftar di worker.js', () => {
            expect(workerJsContent).toContain('/api/employee-agenda/absences');
            expect(workerJsContent).toContain('/api/employee-absences');
            expect(workerJsContent).toContain('ensureEmployeeAbsencesTable(');
        });

        test('2.3. worker.js mendukung method GET, POST, dan DELETE untuk absensi pegawai', () => {
            // GET
            expect(workerJsContent).toMatch(/method\s*===\s*['"]GET['"][\s\S]*?(?:\/api\/employee-agenda\/absences|\/api\/employee-absences)/);
            // POST
            expect(workerJsContent).toMatch(/method\s*===\s*['"]POST['"][\s\S]*?(?:\/api\/employee-agenda\/absences|\/api\/employee-absences)/);
            // DELETE
            expect(workerJsContent).toMatch(/method\s*===\s*['"]DELETE['"][\s\S]*?(?:\/api\/employee-agenda\/absences|\/api\/employee-absences)/);
        });
    });

    // =========================================================================
    // 3. PARITAS OTORISASI RBAC & SIKLUS HIDUP LENGKAP (ACTION PARITY)
    // =========================================================================
    describe('3. Logika Otorisasi RBAC di cloudflare/worker.js', () => {
        test('3.1. Pemilik data (isOwner) diizinkan menyimpan dan membatalkan absensi miliknya', () => {
            // Pengecekan logika otorisasi pada DELETE:
            // Pegawai yang merupakan pemilik data (isOwnerUid / isOwnerGtk) berhak membatalkan
            expect(workerJsContent).toContain('existing.user_uid === userUid');
            expect(workerJsContent).toContain('existing.gtk_id === userGtkId');
            expect(workerJsContent).toContain('isOwnerUid');
            expect(workerJsContent).toContain('isOwnerGtk');
        });

        test('3.2. Kepala Sekolah / Pengelola (isMgr / isEmployeeAgendaManager) diizinkan mengelola absensi staf', () => {
            expect(workerJsContent).toContain('isEmployeeAgendaManager(');
            expect(workerJsContent).toContain('const isMgr = isEmployeeAgendaManager(authResult.user);');
            expect(workerJsContent).toMatch(/if\s*\(!isMgr\s*&&\s*!isOwnerUid\s*&&\s*!isOwnerGtk\)/);
        });

        test('3.3. Pengguna lain tertolak tegas HTTP 403 Forbidden', () => {
            expect(workerJsContent).toContain('errorResponse("Anda tidak berhak membatalkan status pegawai lain", 403, request)');
        });

        test('3.4. Endpoint ringkasan supervisi /api/employee-agenda/summary menyematkan data ketidakhadiran harian', () => {
            expect(workerJsContent).toContain('employee_absences');
            expect(workerJsContent).toContain('.absence = {');
            expect(workerJsContent).toContain('jenis: abs.jenis');
            expect(workerJsContent).toContain('alasan: abs.alasan');
        });
    });

    // =========================================================================
    // 4. ATURAN BISNIS & INTEGRASI LOGIKA FRONTEND
    // =========================================================================
    describe('4. Logika Bisnis & Frontend (page-e-kinerja-tendik.js)', () => {
        test('4.1. page-e-kinerja-tendik.js mendeklarasikan seluruh fungsi modal ketidakhadiran pada window', () => {
            expect(jsContent).toContain('window.openEmployeeAbsenceModal');
            expect(jsContent).toContain('window.closeEmployeeAbsenceModal');
            expect(jsContent).toContain('window.submitEmployeeAbsence');
            expect(jsContent).toContain('window.cancelEmployeeAbsence');
        });

        test('4.2. renderWorkHoursDashboard memperbarui status badge dan panel ketidakhadiran', () => {
            expect(jsContent).toContain('currentDayAbsence');
            expect(jsContent).toContain('statusBadge.textContent = `${currentDayAbsence.jenis}: Sah (0m)`;');
            expect(jsContent).toContain('panelActive.classList.remove(\'hidden\');');
            expect(jsContent).toContain('panelEmpty.classList.add(\'hidden\');');
        });

        test('4.3. renderVisualTimelineRibbon menampilkan pita ketidakhadiran jika pegawai tidak hadir', () => {
            expect(jsContent).toContain('activitiesList.length === 0 && currentDayAbsence');
            expect(jsContent).toContain('Tidak Melaksanakan Tugas: <b>${escapeHTML(currentDayAbsence.jenis)}</b>');
            expect(jsContent).toContain('Jam Kerja Terealisasi 0 Menit (Sah)');
        });

        test('4.4. loadEmployeeWeeklyData mengisi weeklyAbsencesMap dan menandai tombol hari', () => {
            expect(jsContent).toContain('cfClient.getEmployeeAbsences(');
            expect(jsContent).toContain('weeklyAbsencesMap.set(abs.tanggal, abs)');
            expect(jsContent).toContain('const absence = weeklyAbsencesMap.get(dStr);');
        });

        test('4.5. renderWeeklyMatrixTimeline dan matriks mingguan menampilkan status Sah', () => {
            expect(jsContent).toContain('matrixAbsence = weeklyAbsencesMap.get(dStr)');
            expect(jsContent).toContain('Tidak Melaksanakan Tugas: <b>${escapeHTML(matrixAbsence.jenis)}</b>');
            expect(jsContent).toContain('${escapeHTML(matrixAbsence.jenis)} (Sah)');
        });

        test('4.6. loadEmployeeDayData & loadEmployeeWeeklyData memakai sequence guard (_dayLoadSeq/_weekLoadSeq) dan Promise.allSettled paralel', () => {
            expect(jsContent).toContain('let _dayLoadSeq = 0;');
            expect(jsContent).toContain('let _weekLoadSeq = 0;');
            expect(jsContent).toContain('const mySeq = ++_dayLoadSeq;');
            expect(jsContent).toContain('const myWeekSeq = ++_weekLoadSeq;');
            expect(jsContent).toContain('Promise.allSettled([');
        });

        test('4.7. Matriks supervisi (harian, mingguan, pita visual, modal detail) merender status ketidakhadiran Sah', () => {
            expect(jsContent).toContain('dayAbsence = item.daily_breakdown[selectedDate].absence || null;');
            expect(jsContent).toContain('const dayAbsence = dData?.absence || null;');
            expect(jsContent).toContain('Ketidakhadiran Sah: ${escapeHTML(absType)}');
        });
    });

    // =========================================================================
    // 5. INTEGRITAS SKEMA D1 & PENCEGAHAN MULTI-LINE DB.EXEC (SQLITE_ERROR GUARD)
    // =========================================================================
    describe('5. Integritas Skema D1 & Pencegahan Multi-line DB.exec', () => {
        test('5.1. ensureEmployeeAbsencesTable menggunakan db.prepare + db.batch (bukan multi-line db.exec)', () => {
            const fnMatch = workerJsContent.match(/async function ensureEmployeeAbsencesTable\([\s\S]*?\n\}/);
            expect(fnMatch).not.toBeNull();
            const fnBody = fnMatch[0];
            expect(fnBody).toContain('db.prepare(');
            expect(fnBody).toContain('db.batch(');
            expect(fnBody).not.toContain('.exec(');
        });

        test('5.2. Berkas migrasi D1 dan cloudflare/schema.sql memuat definisi tabel employee_absences dan indeks komposit', () => {
            const migrationPath = path.join(root, 'cloudflare', 'migrations', '202610130002_add_employee_absences.sql');
            const schemaPath = path.join(root, 'cloudflare', 'schema.sql');
            expect(fs.existsSync(migrationPath)).toBe(true);

            const migrationSql = fs.readFileSync(migrationPath, 'utf8');
            const schemaSql = fs.readFileSync(schemaPath, 'utf8');

            expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS employee_absences');
            expect(migrationSql).toContain('idx_employee_absences_date_gtk');
            expect(migrationSql).toContain('idx_employee_absences_date_user');

            expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS employee_absences');
            expect(schemaSql).toContain('idx_employee_absences_date_gtk');
            expect(schemaSql).toContain('idx_employee_absences_date_user');
        });
    });
});

