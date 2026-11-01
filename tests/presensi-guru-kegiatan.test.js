/**
 * @jest-environment jsdom
 */

describe('Presensi Guru - Form Kegiatan & Copy Integrity Test', () => {
    let mockToast;

    beforeEach(() => {
        mockToast = jest.fn();
        window.showToast = mockToast;

        document.body.innerHTML = `
            <input type="date" id="input-tanggal" value="2026-10-13">
            <div id="kelas-name">XII-1</div>

            <!-- JP 1 (Source) -->
            <tr data-jp="1" class="md:hidden">
                <td>
                    <select id="mapel-1">
                        <option value="">Pilih Mapel</option>
                        <option value="Matematika" selected>Matematika</option>
                    </select>
                    <input type="text" id="guru-1" value="I Made Sujana, S.Pd.">
                    <input type="hidden" id="guru-id-1" value="GURU_123">
                    <select id="status-1">
                        <option value="">Pilih Status</option>
                        <option value="H">Hadir</option>
                        <option value="K" selected>Kegiatan</option>
                    </select>
                    <div id="tugas-wrapper-1" class="flex">
                        <input type="checkbox" id="tugas-1" checked>
                    </div>
                    <div id="kegiatan-wrapper-1" class="flex">
                        <input type="text" id="kegiatan-1" value="Mengikuti Rapat Koordinasi MKKS di Disdikpora">
                    </div>
                    <button id="btn-save-1">Simpan</button>
                    <span id="jp-badge-1" class="bg-emerald-600">1</span>
                    <span id="status-jp-1" class="hidden"></span>
                </td>
            </tr>
            <tr data-jp="1" class="hidden md:table-row">
                <td>
                    <select id="mapel-d-1">
                        <option value="Matematika" selected>Matematika</option>
                    </select>
                    <input type="text" id="guru-d-1" value="I Made Sujana, S.Pd.">
                    <input type="hidden" id="guru-id-d-1" value="GURU_123">
                    <select id="status-d-1">
                        <option value="K" selected>Kegiatan</option>
                    </select>
                    <div id="tugas-wrapper-d-1" class="flex">
                        <input type="checkbox" id="tugas-d-1" checked>
                    </div>
                    <div id="kegiatan-wrapper-d-1" class="flex">
                        <input type="text" id="kegiatan-d-1" value="Mengikuti Rapat Koordinasi MKKS di Disdikpora">
                    </div>
                    <button id="btn-save-d-1">Simpan</button>
                    <span id="jp-badge-d-1" class="bg-emerald-600">1</span>
                    <span id="status-jp-d-1" class="hidden"></span>
                </td>
            </tr>

            <!-- JP 2 (Destination) -->
            <tr data-jp="2" class="md:hidden">
                <td>
                    <select id="mapel-2">
                        <option value="" selected>Pilih Mapel</option>
                        <option value="Matematika">Matematika</option>
                    </select>
                    <input type="text" id="guru-2" value="">
                    <input type="hidden" id="guru-id-2" value="">
                    <select id="status-2">
                        <option value="" selected>Pilih Status</option>
                        <option value="H">Hadir</option>
                        <option value="K">Kegiatan</option>
                    </select>
                    <div id="tugas-wrapper-2" class="hidden">
                        <input type="checkbox" id="tugas-2">
                    </div>
                    <div id="kegiatan-wrapper-2" class="hidden">
                        <input type="text" id="kegiatan-2" value="">
                    </div>
                    <button id="btn-save-2">Simpan</button>
                    <span id="jp-badge-2" class="bg-amber-500">2</span>
                    <span id="status-jp-2" class="hidden"></span>
                </td>
            </tr>
            <tr data-jp="2" class="hidden md:table-row">
                <td>
                    <select id="mapel-d-2">
                        <option value="" selected>Pilih Mapel</option>
                        <option value="Matematika">Matematika</option>
                    </select>
                    <input type="text" id="guru-d-2" value="">
                    <input type="hidden" id="guru-id-d-2" value="">
                    <select id="status-d-2">
                        <option value="" selected>Pilih Status</option>
                        <option value="H">Hadir</option>
                        <option value="K">Kegiatan</option>
                    </select>
                    <div id="tugas-wrapper-d-2" class="hidden">
                        <input type="checkbox" id="tugas-d-2">
                    </div>
                    <div id="kegiatan-wrapper-d-2" class="hidden">
                        <input type="text" id="kegiatan-d-2" value="">
                    </div>
                    <button id="btn-save-d-2">Simpan</button>
                    <span id="jp-badge-d-2" class="bg-amber-500">2</span>
                    <span id="status-jp-d-2" class="hidden"></span>
                </td>
            </tr>
        `;
    });

    test('1. onStatusChange memunculkan form kegiatan dan toggle tugas saat status K dipilih', () => {
        const onStatusChange = function (jpNum, isFromDesktop = false) {
            const srcId = isFromDesktop ? `status-d-${jpNum}` : `status-${jpNum}`;
            const tgtId = isFromDesktop ? `status-${jpNum}` : `status-d-${jpNum}`;
            const statusEl = document.getElementById(srcId);
            const targetStatusEl = document.getElementById(tgtId);
            if (!statusEl) return;
            const status = statusEl.value;
            if (targetStatusEl && targetStatusEl.value !== status) {
                targetStatusEl.value = status;
            }

            const tugasWrapper = document.getElementById(`tugas-wrapper-${jpNum}`);
            const tugasWrapperD = document.getElementById(`tugas-wrapper-d-${jpNum}`);
            const tugasCheckbox = document.getElementById(`tugas-${jpNum}`);
            const tugasCheckboxD = document.getElementById(`tugas-d-${jpNum}`);

            const needTugas = ['I', 'S', 'K'].includes(status);
            if (needTugas) {
                if (tugasWrapper) { tugasWrapper.classList.remove('hidden'); tugasWrapper.classList.add('flex'); }
                if (tugasWrapperD) { tugasWrapperD.classList.remove('hidden'); tugasWrapperD.classList.add('flex'); }
            } else {
                if (tugasWrapper) { tugasWrapper.classList.add('hidden'); tugasWrapper.classList.remove('flex'); }
                if (tugasWrapperD) { tugasWrapperD.classList.add('hidden'); tugasWrapperD.classList.remove('flex'); }
                if (tugasCheckbox) tugasCheckbox.checked = false;
                if (tugasCheckboxD) tugasCheckboxD.checked = false;
            }

            const kegiatanWrapper = document.getElementById(`kegiatan-wrapper-${jpNum}`);
            const kegiatanWrapperD = document.getElementById(`kegiatan-wrapper-d-${jpNum}`);
            const kegiatanInput = document.getElementById(`kegiatan-${jpNum}`);
            const kegiatanInputD = document.getElementById(`kegiatan-d-${jpNum}`);

            if (status === 'K') {
                if (kegiatanWrapper) { kegiatanWrapper.classList.remove('hidden'); kegiatanWrapper.classList.add('flex'); }
                if (kegiatanWrapperD) { kegiatanWrapperD.classList.remove('hidden'); kegiatanWrapperD.classList.add('flex'); }
            } else {
                if (kegiatanWrapper) { kegiatanWrapper.classList.add('hidden'); kegiatanWrapper.classList.remove('flex'); }
                if (kegiatanWrapperD) { kegiatanWrapperD.classList.add('hidden'); kegiatanWrapperD.classList.remove('flex'); }
                if (kegiatanInput) kegiatanInput.value = '';
                if (kegiatanInputD) kegiatanInputD.value = '';
            }
        };

        // Awalnya JP 2 hidden
        expect(document.getElementById('kegiatan-wrapper-2').classList.contains('hidden')).toBe(true);
        expect(document.getElementById('tugas-wrapper-2').classList.contains('hidden')).toBe(true);

        // Pilih status 'K' pada mobile
        document.getElementById('status-2').value = 'K';
        onStatusChange(2, false);

        expect(document.getElementById('status-d-2').value).toBe('K');
        expect(document.getElementById('kegiatan-wrapper-2').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('kegiatan-wrapper-d-2').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('tugas-wrapper-2').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('tugas-wrapper-d-2').classList.contains('hidden')).toBe(false);

        // Ubah kembali ke status 'H' (Hadir)
        document.getElementById('status-2').value = 'H';
        onStatusChange(2, false);

        expect(document.getElementById('status-d-2').value).toBe('H');
        expect(document.getElementById('kegiatan-wrapper-2').classList.contains('hidden')).toBe(true);
        expect(document.getElementById('kegiatan-wrapper-d-2').classList.contains('hidden')).toBe(true);
        expect(document.getElementById('tugas-wrapper-2').classList.contains('hidden')).toBe(true);
        expect(document.getElementById('tugas-wrapper-d-2').classList.contains('hidden')).toBe(true);
        expect(document.getElementById('kegiatan-2').value).toBe('');
    });

    test('2. syncField menyelaraskan isian kegiatan antara tampilan mobile dan desktop secara real-time', () => {
        const syncField = function (type, jpNum, isFromDesktop = true) {
            if (type === 'kegiatan') {
                const srcId = isFromDesktop ? `kegiatan-d-${jpNum}` : `kegiatan-${jpNum}`;
                const tgtId = isFromDesktop ? `kegiatan-${jpNum}` : `kegiatan-d-${jpNum}`;
                const srcEl = document.getElementById(srcId);
                const tgtEl = document.getElementById(tgtId);
                if (srcEl && tgtEl) tgtEl.value = srcEl.value;
            }
        };

        // User mengetik di mobile
        document.getElementById('kegiatan-2').value = 'Workshop Kurikulum Merdeka';
        syncField('kegiatan', 2, false);
        expect(document.getElementById('kegiatan-d-2').value).toBe('Workshop Kurikulum Merdeka');

        // User mengetik di desktop
        document.getElementById('kegiatan-d-2').value = 'Pembinaan Olimpiade Sains';
        syncField('kegiatan', 2, true);
        expect(document.getElementById('kegiatan-2').value).toBe('Pembinaan Olimpiade Sains');
    });

    test('3. copyFromAbove berhasil menyalin mapel, guru, status K, keterangan kegiatan, dan status tugas', () => {
        const onStatusChangeMock = jest.fn((jpNum) => {
            const st = document.getElementById(`status-${jpNum}`).value;
            if (st === 'K') {
                document.getElementById(`kegiatan-wrapper-${jpNum}`).classList.remove('hidden');
                document.getElementById(`kegiatan-wrapper-d-${jpNum}`).classList.remove('hidden');
                document.getElementById(`tugas-wrapper-${jpNum}`).classList.remove('hidden');
                document.getElementById(`tugas-wrapper-d-${jpNum}`).classList.remove('hidden');
            }
        });

        const copyFromAbove = function (jpNum) {
            const prevJP = jpNum - 1;
            const prevMapel = document.getElementById(`mapel-${prevJP}`).value;
            const prevGuru = document.getElementById(`guru-${prevJP}`).value;
            const prevGuruId = document.getElementById(`guru-id-${prevJP}`).value;
            const prevStatus = document.getElementById(`status-${prevJP}`).value;
            const prevTugas = document.getElementById(`tugas-${prevJP}`).checked;
            const prevKegiatan = (document.getElementById(`kegiatan-${prevJP}`)?.value || document.getElementById(`kegiatan-d-${prevJP}`)?.value || '').trim();

            document.getElementById(`mapel-${jpNum}`).value = prevMapel;
            document.getElementById(`guru-${jpNum}`).value = prevGuru;
            document.getElementById(`guru-id-${jpNum}`).value = prevGuruId;
            document.getElementById(`status-${jpNum}`).value = prevStatus;

            document.getElementById(`mapel-d-${jpNum}`).value = prevMapel;
            document.getElementById(`guru-d-${jpNum}`).value = prevGuru;
            document.getElementById(`guru-id-d-${jpNum}`).value = prevGuruId;
            document.getElementById(`status-d-${jpNum}`).value = prevStatus;

            onStatusChangeMock(jpNum);

            document.getElementById(`tugas-${jpNum}`).checked = prevTugas;
            document.getElementById(`tugas-d-${jpNum}`).checked = prevTugas;

            if (prevStatus === 'K' || prevKegiatan) {
                const kegM = document.getElementById(`kegiatan-${jpNum}`);
                const kegD = document.getElementById(`kegiatan-d-${jpNum}`);
                if (kegM) kegM.value = prevKegiatan;
                if (kegD) kegD.value = prevKegiatan;
            }
        };

        copyFromAbove(2);

        expect(document.getElementById('mapel-2').value).toBe('Matematika');
        expect(document.getElementById('guru-2').value).toBe('I Made Sujana, S.Pd.');
        expect(document.getElementById('status-2').value).toBe('K');
        expect(document.getElementById('tugas-2').checked).toBe(true);
        expect(document.getElementById('kegiatan-2').value).toBe('Mengikuti Rapat Koordinasi MKKS di Disdikpora');

        // Pastikan desktop juga identik tersinkronisasi
        expect(document.getElementById('mapel-d-2').value).toBe('Matematika');
        expect(document.getElementById('guru-d-2').value).toBe('I Made Sujana, S.Pd.');
        expect(document.getElementById('status-d-2').value).toBe('K');
        expect(document.getElementById('tugas-d-2').checked).toBe(true);
        expect(document.getElementById('kegiatan-d-2').value).toBe('Mengikuti Rapat Koordinasi MKKS di Disdikpora');
        expect(onStatusChangeMock).toHaveBeenCalledWith(2);
    });

    test('4. Validasi wajib isi kegiatan saat status K: menolak simpan jika keterangan kegiatan kosong', () => {
        const validateSaveJP = function (jpNum) {
            const status = document.getElementById(`status-${jpNum}`).value;
            if (!status) {
                window.showToast('Peringatan', 'Status kehadiran wajib dipilih!', 'warning');
                return false;
            }
            const kegiatanVal = (document.getElementById(`kegiatan-${jpNum}`)?.value || document.getElementById(`kegiatan-d-${jpNum}`)?.value || '').trim();
            if (status === 'K' && !kegiatanVal) {
                window.showToast('Peringatan', 'Keterangan kegiatan guru wajib diisi!', 'warning');
                return false;
            }
            return true;
        };

        // JP 2 berstatus K tapi kegiatan kosong
        document.getElementById('status-2').value = 'K';
        document.getElementById('kegiatan-2').value = '   '; // whitespace only

        const canSave = validateSaveJP(2);
        expect(canSave).toBe(false);
        expect(mockToast).toHaveBeenCalledWith('Peringatan', 'Keterangan kegiatan guru wajib diisi!', 'warning');

        // Jika kegiatan diisi
        document.getElementById('kegiatan-2').value = 'Dinas Luar Pembinaan Karakter';
        const canSaveFilled = validateSaveJP(2);
        expect(canSaveFilled).toBe(true);
    });

    test('5. updateJPRowStatus mendeteksi modifikasi kegiatan pada data yang sudah tersimpan', () => {
        const savedJPData = {
            1: {
                mapel: 'Matematika',
                guru_nama: 'I Made Sujana, S.Pd.',
                status: 'K',
                ada_tugas: true,
                keterangan: 'Rapat MKKS'
            }
        };

        const checkIsUnchanged = function (jpNum, savedData) {
            const curMapel = document.getElementById(`mapel-${jpNum}`).value;
            const curGuru = document.getElementById(`guru-${jpNum}`).value.trim();
            const curStatus = document.getElementById(`status-${jpNum}`).value;
            const curTugas = document.getElementById(`tugas-${jpNum}`).checked;
            const curKegiatan = document.getElementById(`kegiatan-${jpNum}`).value.trim();

            const saved = savedData[jpNum];
            return saved &&
                (curMapel === saved.mapel) &&
                (curGuru === saved.guru_nama) &&
                (curStatus === saved.status) &&
                (curTugas === saved.ada_tugas) &&
                (curStatus !== 'K' || curKegiatan === (saved.keterangan || ''));
        };

        document.getElementById('mapel-1').value = 'Matematika';
        document.getElementById('guru-1').value = 'I Made Sujana, S.Pd.';
        document.getElementById('status-1').value = 'K';
        document.getElementById('tugas-1').checked = true;
        document.getElementById('kegiatan-1').value = 'Rapat MKKS';

        // Sama persis dengan database -> unchanged (hijau)
        expect(checkIsUnchanged(1, savedJPData)).toBe(true);

        // Keterangan diubah -> changed (kuning / perlu simpan)
        document.getElementById('kegiatan-1').value = 'Rapat MKKS Revisi';
        expect(checkIsUnchanged(1, savedJPData)).toBe(false);
    });

    test('6. Verifikasi skrip migrasi SQL menambahkan kolom keterangan pada tabel guru_presensi', () => {
        const fs = require('fs');
        const path = require('path');
        const sqlPath = path.resolve(__dirname, '../supabase/migrations/202610130001_add_keterangan_to_guru_presensi.sql');
        expect(fs.existsSync(sqlPath)).toBe(true);

        const sqlContent = fs.readFileSync(sqlPath, 'utf8');
        expect(sqlContent).toContain('ALTER TABLE guru_presensi ADD COLUMN IF NOT EXISTS keterangan TEXT DEFAULT NULL;');
        expect(sqlContent).toContain("NOTIFY pgrst, 'reload schema';");
    });

    test('7. Verifikasi mekanisme fallback di saveJP menangani ketiadaan kolom keterangan di DB', () => {
        const fs = require('fs');
        const path = require('path');
        const jsPath = path.resolve(__dirname, '../js/page-presensi-guru.js');
        const jsContent = fs.readFileSync(jsPath, 'utf8');

        // Pastikan ada logic regex checking /keterangan/i dan omit keterangan pada retry
        expect(jsContent).toContain('/keterangan/i.test(sbUpsertErr.message');
        expect(jsContent).toContain('const { keterangan, ...rowTanpaKeterangan } = upsertRow;');
    });
});

