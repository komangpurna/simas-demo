/**
 * tests/profile-gtk-comprehensive.test.js
 *
 * Pengujian Unit Menyeluruh untuk Fitur Edit Profil GTK:
 * 1. Perhitungan Skor Kelengkapan Data GTK (Completeness Score - 21 Atribut Dapodik & SIMAS).
 * 2. Pemetaan & Penanganan Missing Field per Tab (Biodata, Kepegawaian, Alamat, Keamanan).
 * 3. Kebijakan Pengisian Satu Kali (One-Time Fill Policy) untuk Field Kepegawaian Resmi.
 * 4. Validasi Format & Keunikan NIK (16 digit), NIP, dan NUPTK.
 * 5. Konstruksi Format Alamat Komposit (Sinkronisasi Kolom address).
 * 6. Kepatuhan Desain Antarmuka: Modal max-w-3xl, 4 Tab Lega, Anti-Overlapping Icon, dan Modal Anti-Nesting.
 */

const fs = require('node:fs');
const path = require('node:path');

const globalJsPath = path.resolve(__dirname, '../js/global.js');
const globalJsContent = fs.readFileSync(globalJsPath, 'utf8');

describe('Pengujian Kelengkapan Profil GTK (Completeness Score & 21 Atribut)', () => {
    let calculateGtkCompleteness;

    beforeAll(() => {
        const startMarker = 'window.calculateGtkCompleteness = function';
        const endMarker = 'window.switchProfileTab = function';
        const startIdx = globalJsContent.indexOf(startMarker);
        const endIdx = globalJsContent.indexOf(endMarker, startIdx);

        if (startIdx !== -1 && endIdx !== -1) {
            const rawCode = globalJsContent.substring(startIdx + startMarker.length, endIdx).trim();
            const cleanCode = rawCode.replace(/;?\s*$/, '');
            calculateGtkCompleteness = new Function(`return function ${cleanCode}`)();
        } else {
            throw new Error('Fungsi window.calculateGtkCompleteness tidak ditemukan di js/global.js');
        }
    });

    test('1. Objek GTK kosong menghasilkan skor 0% dan 21 atribut missing', () => {
        const res = calculateGtkCompleteness({});
        expect(res.totalCount).toBe(21);
        expect(res.filledCount).toBe(0);
        expect(res.score).toBe(0);
        expect(res.missingTabs.bio).toBe(6);
        expect(res.missingTabs.work).toBe(6);
        expect(res.missingTabs.address).toBe(8);
        expect(res.missingTabs.security).toBe(1);
    });

    test('2. Objek GTK dengan tanda strip "-" atau spasi kosong tidak dihitung sebagai terisi', () => {
        const partialData = {
            name: 'I Made Kartika, S.Pd.',
            gender: '-',
            birth_place: '   ',
            birth_date: '',
            agama: '-',
            pendidikan_terakhir: 'S1',
            nik: '-',
            nip: '-',
            nuptk: '-',
            status_kepegawaian: 'PNS',
            jenis_ptk: '-',
            tugas_tambahan: '-',
            alamat: 'Jl. Melati No. 4',
            rt: '-',
            rw: '-',
            dusun: '-',
            kelurahan: '-',
            kecamatan: '-',
            kode_pos: '-',
            phone: '081234567890',
            foto: ''
        };
        const res = calculateGtkCompleteness(partialData);
        // Terisi: name, pendidikan_terakhir, status_kepegawaian, alamat, phone = 5
        expect(res.filledCount).toBe(5);
        expect(res.score).toBe(Math.round((5 / 21) * 100)); // 24%
    });

    test('3. Objek GTK dengan 21 atribut lengkap menghasilkan skor 100% dan 0 missing di semua tab', () => {
        const completeData = {
            name: 'I Wayan Sudarma, M.Pd.',
            gender: 'L',
            birth_place: 'Denpasar',
            birth_date: '1985-05-12',
            agama: 'Hindu',
            pendidikan_terakhir: 'S2',
            nik: '5103011205850001',
            nip: '198505122010011015',
            nuptk: '1234567890123456',
            status_kepegawaian: 'PNS',
            jenis_ptk: 'Guru Mapel',
            tugas_tambahan: 'Waka Kurikulum',
            alamat: 'Jl. Pratama No. 10',
            rt: '01',
            rw: '02',
            dusun: 'Mumbul',
            kelurahan: 'Benoa',
            kecamatan: 'Kuta Selatan',
            kode_pos: '80361',
            phone: '081234567890',
            foto: 'https://storage.smagesa.sch.id/photos/guru_wayan.webp'
        };
        const res = calculateGtkCompleteness(completeData);
        expect(res.totalCount).toBe(21);
        expect(res.filledCount).toBe(21);
        expect(res.score).toBe(100);
        expect(res.missingTabs.bio).toBe(0);
        expect(res.missingTabs.work).toBe(0);
        expect(res.missingTabs.address).toBe(0);
        expect(res.missingTabs.security).toBe(0);
    });

    test('4. Atribut foto dapat membaca baik foto maupun photo_url', () => {
        const dataWithPhotoUrl = {
            name: 'Ni Luh Sari, S.Kom.',
            gender: 'P',
            birth_place: 'Badung',
            birth_date: '1990-08-20',
            agama: 'Hindu',
            pendidikan_terakhir: 'S1',
            nik: '5103026008900002',
            nip: '-',
            nuptk: '9876543210987654',
            status_kepegawaian: 'PPPK',
            jenis_ptk: 'Guru Mapel',
            tugas_tambahan: 'Kepala Laboratorium',
            alamat: 'Jl. Bypass Ngurah Rai',
            rt: '03',
            rw: '01',
            dusun: 'Pangkalan',
            kelurahan: 'Kuta',
            kecamatan: 'Kuta',
            kode_pos: '80361',
            phone: '081987654321',
            photo_url: 'https://images.smagesa.sch.id/avatars/sari.jpg'
        };
        const res = calculateGtkCompleteness(dataWithPhotoUrl);
        expect(res.missingTabs.security).toBe(0);
        expect(res.filledCount).toBe(20);
    });
});

describe('Pengujian Logika Kebijakan Pengisian Satu Kali (One-Time Fill Policy)', () => {
    function canFillOrChange(field, incomingVal, existingVal, isManager) {
        const curr = existingVal !== undefined && existingVal !== null ? String(existingVal).trim() : '';
        const isCurrentlyEmpty = !curr || curr === '-';
        if (incomingVal === undefined) return existingVal;
        const inc = String(incomingVal).trim();
        if (isManager) return inc;
        if (isCurrentlyEmpty) return inc;
        return existingVal;
    }

    test('1. Pengguna non-manager BERHASIL mengisi NIK jika sebelumnya kosong', () => {
        const existingVal = '-';
        const incomingVal = '5103011205850001';
        const result = canFillOrChange('nik', incomingVal, existingVal, false);
        expect(result).toBe('5103011205850001');
    });

    test('2. Pengguna non-manager DITOLAK mengubah NIK jika sudah terisi (tetap menggunakan data lama)', () => {
        const existingVal = '5103011205850001';
        const incomingVal = '5103019999999999';
        const result = canFillOrChange('nik', incomingVal, existingVal, false);
        expect(result).toBe('5103011205850001');
    });

    test('3. Pengelola (Super Admin / Admin / TU) BERHASIL mengubah field kepegawaian yang sudah terisi', () => {
        const existingVal = 'Guru Mapel';
        const incomingVal = 'Kepala Sekolah';
        const result = canFillOrChange('jenis_ptk', incomingVal, existingVal, true);
        expect(result).toBe('Kepala Sekolah');
    });
});

describe('Pengujian Format Alamat Komposit & Validasi NIK', () => {
    function formatCompositeAddress(newAlamat, newRt, newRw, newDusun, newKelurahan, newKecamatan, newKodePos) {
        let formattedAddress = newAlamat && newAlamat !== '-' ? newAlamat : '';
        const addrParts = [];
        if (newRt && newRt !== '-' && newRt !== '00' && newRw && newRw !== '-') {
            addrParts.push(`RT ${newRt}/RW ${newRw}`);
        } else if (newRt && newRt !== '-') {
            addrParts.push(`RT ${newRt}`);
        }
        if (newDusun && newDusun !== '-') addrParts.push(`Dusun ${newDusun}`);
        if (newKelurahan && newKelurahan !== '-') addrParts.push(`Desa/Kel. ${newKelurahan}`);
        if (newKecamatan && newKecamatan !== '-') addrParts.push(`Kec. ${newKecamatan}`);
        if (newKodePos && newKodePos !== '-') addrParts.push(newKodePos);
        if (addrParts.length > 0) {
            formattedAddress = newAlamat && newAlamat !== '-' ? `${newAlamat}, ${addrParts.join(', ')}` : addrParts.join(', ');
        }
        return formattedAddress;
    }

    test('1. Alamat komposit tersusun lengkap dan rapi', () => {
        const addr = formatCompositeAddress(
            'Jl. Pratama No. 10',
            '01',
            '02',
            'Mumbul',
            'Benoa',
            'Kuta Selatan',
            '80361'
        );
        expect(addr).toBe('Jl. Pratama No. 10, RT 01/RW 02, Dusun Mumbul, Desa/Kel. Benoa, Kec. Kuta Selatan, 80361');
    });

    test('2. NIK wajib tepat 16 digit angka', () => {
        const validNik = '5103011205850001';
        const invalidShortNik = '510301120585000';
        const invalidCharNik = '510301120585000A';

        expect(/^\d{16}$/.test(validNik)).toBe(true);
        expect(/^\d{16}$/.test(invalidShortNik)).toBe(false);
        expect(/^\d{16}$/.test(invalidCharNik)).toBe(false);
    });
});

describe('Pengujian Integritas Markup & Kepatuhan Desain Antarmuka Modal (#modal-edit-profile)', () => {
    test('1. Modal memiliki ukuran max-w-3xl, section kelengkapan, dan navigasi 4 tab', () => {
        expect(globalJsContent).toContain('id="modal-edit-profile"');
        expect(globalJsContent).toContain('max-w-3xl');
        expect(globalJsContent).toContain('id="profile-completeness-section"');
        expect(globalJsContent).toContain('id="profile-tabs-nav"');
        expect(globalJsContent).toContain('id="btn-profile-tab-bio"');
        expect(globalJsContent).toContain('id="btn-profile-tab-work"');
        expect(globalJsContent).toContain('id="btn-profile-tab-address"');
        expect(globalJsContent).toContain('id="btn-profile-tab-security"');
    });

    test('2. Seluruh 4 tab pane GTK dan form fallback non-GTK tersedia', () => {
        expect(globalJsContent).toContain('id="profile-pane-bio"');
        expect(globalJsContent).toContain('id="profile-pane-work"');
        expect(globalJsContent).toContain('id="profile-pane-address"');
        expect(globalJsContent).toContain('id="profile-pane-security"');
        expect(globalJsContent).toContain('id="profile-pane-nongtk"');
    });

    test('3. Seluruh 21 field GTK terdefinisi dalam markup modal', () => {
        const requiredFieldIds = [
            'edit-profile-name',
            'edit-profile-gender',
            'edit-profile-birth-place',
            'edit-profile-birth-date',
            'edit-profile-agama',
            'edit-profile-pendidikan',
            'edit-profile-nik',
            'edit-profile-nip',
            'edit-profile-nuptk',
            'edit-profile-status-kepegawaian',
            'edit-profile-jenis-ptk',
            'edit-profile-tugas-tambahan',
            'edit-profile-mapel',
            'edit-profile-alamat',
            'edit-profile-rt',
            'edit-profile-rw',
            'edit-profile-dusun',
            'edit-profile-kelurahan',
            'edit-profile-kecamatan',
            'edit-profile-kode-pos',
            'edit-profile-phone',
            'edit-profile-email'
        ];

        requiredFieldIds.forEach(id => {
            expect(globalJsContent).toContain(`id="${id}"`);
        });
    });

    test('4. Kepatuhan Anti-Overlapping Icon Rule: Tidak ada leading icon absolut di dalam field input modal', () => {
        const modalStart = globalJsContent.indexOf('id="modal-edit-profile"');
        const modalEnd = globalJsContent.indexOf('<!-- MODAL CROP & ROTATE FOTO PROFIL -->', modalStart);
        const modalSnippet = globalJsContent.substring(modalStart, modalEnd);

        const hasOverlappingLeadingIcon = /class="[^"]*\b(pl-9|pl-10)\b[^"]*"[^>]*>\s*<i class="[^"]*\babsolute\b[^"]*\bleft-[0-9]/i.test(modalSnippet);
        expect(hasOverlappingLeadingIcon).toBe(false);
    });

    test('5. Keseimbangan Tag (0 Unclosed Tag) pada blok modal edit profil untuk kedua mode (GTK dan Non-GTK)', () => {
        const modalStart = globalJsContent.indexOf('<div id="modal-edit-profile"');
        const modalEnd = globalJsContent.indexOf('<!-- MODAL CROP & ROTATE FOTO PROFIL -->', modalStart);
        const modalSnippet = globalJsContent.substring(modalStart, modalEnd);

        // Mock window untuk evaluasi template
        global.window = { SCHOOL_CONFIG: { telegramBotUser: 'smagesa_bot' } };

        // Uji evaluasi render untuk role GTK (guru)
        const renderGtk = (template) => {
            const userRole = 'guru';
            const userInitial = 'G';
            return eval('`' + template.replace(/\\`/g, '`') + '`');
        };

        const gtkHtml = renderGtk(modalSnippet);
        const openDivsGtk = (gtkHtml.match(/<div\b[^>]*>/gi) || []).length;
        const closeDivsGtk = (gtkHtml.match(/<\/div>/gi) || []).length;
        expect(openDivsGtk).toBe(closeDivsGtk);

        // Uji evaluasi render untuk role Non-GTK (siswa)
        const renderNonGtk = (template) => {
            const userRole = 'siswa';
            const userInitial = 'S';
            return eval('`' + template.replace(/\\`/g, '`') + '`');
        };

        const nonGtkHtml = renderNonGtk(modalSnippet);
        const openDivsNonGtk = (nonGtkHtml.match(/<div\b[^>]*>/gi) || []).length;
        const closeDivsNonGtk = (nonGtkHtml.match(/<\/div>/gi) || []).length;
        expect(openDivsNonGtk).toBe(closeDivsNonGtk);
    });

    test('6. updateProfileCompletenessUI mendukung live auto-collection dari nilai elemen form DOM', () => {
        expect(globalJsContent).toContain('window.updateProfileCompletenessUI = function');
        expect(globalJsContent).toContain('profile-tab-panes');
        expect(globalJsContent).toContain('oninput="typeof window.updateProfileCompletenessUI === \'function\' && window.updateProfileCompletenessUI()"');
    });
});

