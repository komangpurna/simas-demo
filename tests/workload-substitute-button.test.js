/**
 * tests/workload-substitute-button.test.js
 *
 * Pengujian Unit Komprehensif: Penambahan Tombol dan Alur Kerja "Diganti"
 * Pada Pelaporan Realisasi Beban Kerja Harian Guru (Tab Hari Ini)
 *
 * Verifikasi:
 * 1. Keberadaan 4 tombol aksi realisasi cepat pada renderTodayTab di js/page-beban-kerja.js:
 *    - Terlaksana (status: terlaksana)
 *    - Sebagian (status: sebagian)
 *    - Diganti (status: diganti)
 *    - Tidak (status: tidak_terlaksana)
 * 2. Pemanggilan handler window.workloadOpenLogModal dengan status 'diganti'.
 * 3. Logika tampilan kolom kegiatan pengganti (#log-substitute-wrapper) saat status 'diganti'.
 * 4. Validasi wajib isi catatan kegiatan pengganti saat status eksekusi adalah 'diganti'.
 * 5. Tampilan badge status pelaksanaan 'Diganti' dan rincian nama kegiatan pengganti pada kartu kegiatan.
 */

const fs = require('node:fs');
const path = require('node:path');

describe('Fitur Tombol "Diganti" pada Pelaporan Realisasi Harian Beban Kerja Guru', () => {
    const rootDir = path.resolve(__dirname, '..');
    const jsPath = path.join(rootDir, 'js', 'page-beban-kerja.js');
    const htmlPath = path.join(rootDir, 'e-kinerja.html');
    const workerPath = path.join(rootDir, 'cloudflare', 'worker.js');

    const jsContent = fs.readFileSync(jsPath, 'utf8');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const workerContent = fs.readFileSync(workerPath, 'utf8');

    test('1. Kartu rencana hari ini di js/page-beban-kerja.js memiliki 3 tombol aksi realisasi cepat (Terlaksana, Diganti, Tidak) tanpa tombol sebagian', () => {
        expect(jsContent).toContain("window.workloadOpenLogModal('${seg.activity_id}')");
        expect(jsContent).not.toContain("window.workloadOpenLogModal('${seg.activity_id}', false, 'sebagian')");
        expect(jsContent).toContain("window.workloadOpenLogModal('${seg.activity_id}', false, 'diganti')");
        expect(jsContent).toContain("window.workloadOpenLogModal('${seg.activity_id}', false, 'tidak_terlaksana')");

        // Memastikan tombol Diganti memiliki label dan ikon yang sesuai
        expect(jsContent).toContain('>Diganti</span></button>');
        expect(jsContent).toContain('fa-arrows-rotate');
        expect(jsContent).toContain('bg-blue-600');
    });

    test('2. Modal form di e-kinerja.html memiliki opsi status eksekusi "diganti", tanpa opsi "sebagian", dan memiliki log-teaching-wrapper (JP & Tugas Tambahan)', () => {
        expect(htmlContent).toContain('value="diganti"');
        expect(htmlContent).not.toContain('value="sebagian"');
        expect(htmlContent).toContain('id="log-substitute-wrapper"');
        expect(htmlContent).toContain('id="log-input-substitute"');
        expect(htmlContent).toContain('Catatan Kegiatan Pengganti *');
        expect(htmlContent).toContain('id="log-teaching-wrapper"');
        expect(htmlContent).toContain('id="log-input-jp"');
        expect(htmlContent).toContain('id="log-input-assignment"');
        expect(htmlContent).toContain('id="log-study-day-banner"');
    });

    test('3. Logika onStatusExecutionChange menampilkan wadah pengganti hanya saat status adalah "diganti"', () => {
        expect(jsContent).toContain("} else if (status === 'diganti') {");
        expect(jsContent).toContain("substituteWrapper?.classList.remove('hidden');");
        expect(jsContent).toContain("obstacleWrapper?.classList.add('hidden');");
    });

    test('4. Validasi saveLog mewajibkan catatan kegiatan pengganti saat status eksekusi adalah "diganti"', () => {
        expect(jsContent).toContain("if (statusExec === 'diganti' && !substituteNotes) {");
        expect(jsContent).toContain("Catatan kegiatan pengganti wajib diisi");
        expect(jsContent).toContain("substitute_notes: substituteNotes");
    });

    test('5. Kartu timeline menampilkan badge visual dan catatan kegiatan pengganti saat rencana telah diganti', () => {
        expect(jsContent).toContain('Diganti oleh:');
        expect(jsContent).toContain("linkObj?.link_type === 'substitution' || linkedLog.status_execution === 'diganti'");
        expect(jsContent).toContain('border-emerald-200');
    });

    test('6. Backend Cloudflare Worker D1 menyimpan relasi plan_log_links dengan link_type "substitution" untuk status diganti', () => {
        expect(workerContent).toContain('const linkType = status_execution === "diganti" || isDraftSubstitution ? "substitution" : "fulfillment";');
        expect(workerContent).toContain('INSERT INTO plan_log_links');
    });

    test('7. Dropdown sub-kegiatan realisasi mendukung penanda ranah HBG dan isian JP setara perencanaan', () => {
        expect(jsContent).toContain('const isHbg = isCurrentStudyDay && isCatalogItemHbg(c);');
        expect(jsContent).toContain('title="Ranah Hari Belajar Guru (SE No. 5684/2025)"');
        expect(jsContent).toContain('teachingWrapper.classList.add(\'hidden\');');
        expect(jsContent).toContain('el(\'log-input-assignment\')');
    });

    test('8. Form Uraian Pekerjaan Dilaksanakan (#log-title-wrapper) disembunyikan saat status "diganti" dan judul diambil dari form pengganti bawah', () => {
        // e-kinerja.html memiliki kontainer #log-title-wrapper
        expect(htmlContent).toContain('id="log-title-wrapper"');

        // onStatusExecutionChange menyembunyikan #log-title-wrapper dan melepas atribut required saat status "diganti"
        expect(jsContent).toContain("titleWrapper?.classList.add('hidden');");
        expect(jsContent).toContain("if (titleInput) titleInput.required = false;");

        // saveLog otomatis menetapkan title dari kegiatan pengganti bawah saat status "diganti"
        expect(jsContent).toContain("if (statusExec === 'diganti') {");
        expect(jsContent).toContain("title = substituteNotes || catText || title || 'Kegiatan Pengganti';");
    });

    test('9. Timeline realisasi (Gantt Matrix & Kartu Tab Hari Ini) menampilkan judul kegiatan pengganti dan tidak nyantol nama rencana asal', () => {
        // Gantt Matrix balok menampilkan displayTitle (kegiatan pengganti jika isSubstituted)
        expect(jsContent).toContain("const displayTitle = isSubstituted");
        expect(jsContent).toContain("linkedLog.title || linkObj?.reason_notes || linkedLog.substitute_notes || slot.title");
        expect(jsContent).toContain("Menggantikan rencana: ${escapeHTML(slot.title)}");

        // Kartu Tab Hari Ini menampilkan displayCardTitle kegiatan pengganti sebagai judul utama
        expect(jsContent).toContain("const displayCardTitle = isSubstituted");
        expect(jsContent).toContain("Menggantikan rencana:</span>");
        expect(jsContent).toContain("line-through opacity-75");
    });

    test('10. Generator ekspor laporan dokumen Word mencetak judul kegiatan pengganti yang terealisasi', () => {
        const exportDocxPath = path.join(rootDir, 'js', 'exportLaporanDocx.js');
        const exportDocxContent = fs.readFileSync(exportDocxPath, 'utf8');

        expect(exportDocxContent).toContain("const isSubstituted = linkedLog.status_execution === 'diganti';");
        expect(exportDocxContent).toContain("linkedLog.title || linkedLog.substitute_notes || seg.activity_title || 'Kegiatan Pengganti'");
    });

    test('11. Status "Tidak Terlaksana" memiliki penanda tulisan jelas pada balok Gantt, kartu aktivitas hari ini, dan ekspor Word', () => {
        // Balok Gantt menampilkan tulisan badge Tidak Terlaksana dan teks dicoret
        expect(jsContent).toContain("Tidak Terlaksana</span>' : ''");
        expect(jsContent).toContain("isNotExecuted ? '<i class=\"fa-solid fa-circle-xmark text-[7px] text-rose-500 mr-1\"></i>' : ''");

        // Kartu Tab Hari Ini menampilkan badge Tidak Terlaksana warna rose dan kotak kendala
        expect(jsContent).toContain('<span class="font-bold">Kegiatan Tidak Terlaksana</span>');
        expect(jsContent).toContain('bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 flex items-center gap-1 border border-rose-200 dark:border-rose-800');

        // Generator ekspor Word menandai status dan rincian Tidak Terlaksana
        const exportDocxContent = fs.readFileSync(path.join(rootDir, 'js', 'exportLaporanDocx.js'), 'utf8');
        expect(exportDocxContent).toContain('`${title} (Tidak Terlaksana)`');
        expect(exportDocxContent).toContain('Tidak terlaksana.');
    });
});

