/**
 * tests/surat-keterangan-address-ttl.test.js
 * Unit test untuk standarisasi Tempat Lahir (Title Case) dan Alamat Siswa
 * (Desa, Kecamatan, Kabupaten, Provinsi serta penyesuaian cerdas jika sudah lengkap)
 * pada modul Surat Keterangan Siswa (js/page-students.js).
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pageStudentsJs = fs.readFileSync(path.join(root, 'js/page-students.js'), 'utf8');

// Ekstraksi fungsi toTitleCase dan formatStudentAddress dari page-students.js ke scope pengujian
function extractFunction(fnName, sourceCode) {
    const regex = new RegExp(`function\\s+${fnName}\\s*\\([\\s\\S]*?\\n\\}`);
    const match = sourceCode.match(regex);
    if (!match) {
        throw new Error(`Fungsi ${fnName} tidak ditemukan di source code.`);
    }
    return match[0];
}

const toTitleCaseCode = extractFunction('toTitleCase', pageStudentsJs);
const formatStudentAddressCode = extractFunction('formatStudentAddress', pageStudentsJs);

const testScope = new Function(`
    ${toTitleCaseCode}
    ${formatStudentAddressCode}
    return { toTitleCase, formatStudentAddress };
`)();

const { toTitleCase, formatStudentAddress } = testScope;

describe('Standarisasi Tempat Lahir & Alamat Surat Keterangan Siswa', () => {

    describe('1. Helper toTitleCase (Kapital Hanya di Awal Kata)', () => {
        test('Mengonversi teks uppercase penuh menjadi kapital hanya di awal kata', () => {
            expect(toTitleCase('KARANGASEM')).toBe('Karangasem');
            expect(toTitleCase('AMLAPURA')).toBe('Amlapura');
            expect(toTitleCase('DENPASAR')).toBe('Denpasar');
            expect(toTitleCase('KULON PROGO')).toBe('Kulon Progo');
            expect(toTitleCase('JAKARTA TIMUR')).toBe('Jakarta Timur');
        });

        test('Mengonversi alamat dengan singkatan tanda baca dan banyak kata', () => {
            expect(toTitleCase('BR. DINAS PURWAYA')).toBe('Br. Dinas Purwaya');
            expect(toTitleCase('JL. RAYA ABANG NO. 15')).toBe('Jl. Raya Abang No. 15');
            expect(toTitleCase('DUSUN KELOD KAUH')).toBe('Dusun Kelod Kauh');
        });

        test('Menangani nilai null, undefined, kosong, atau strip', () => {
            expect(toTitleCase('')).toBe('');
            expect(toTitleCase(null)).toBe('');
            expect(toTitleCase(undefined)).toBe('');
            expect(toTitleCase('-')).toBe('');
            expect(toTitleCase('   ')).toBe('');
        });
    });

    describe('2. Helper formatStudentAddress (Desa, Kecamatan, Kabupaten, Provinsi)', () => {
        test('Kasus 1: Alamat mentah hanya nama banjar/dusun -> Otomatis menyertakan Desa, Kecamatan, Kabupaten, Provinsi', () => {
            const student = {
                alamat: 'BR. DINAS PURWAYA',
                kelurahan: 'TIYINGTALI',
                kecamatan: 'ABANG'
            };
            const result = formatStudentAddress(student);
            expect(result).toBe('Br. Dinas Purwaya, Desa Tiyingtali, Kecamatan Abang, Kabupaten Karangasem, Provinsi Bali');
        });

        test('Kasus 2: Alamat sudah lengkap dari database -> Disesuaikan tanpa menduplikasi komponen wilayah', () => {
            const student = {
                alamat: 'Br. Dinas Purwaya, Desa Tiyingtali, Kecamatan Abang, Kabupaten Karangasem, Provinsi Bali',
                kelurahan: 'Tiyingtali',
                kecamatan: 'Abang'
            };
            const result = formatStudentAddress(student);
            expect(result).toBe('Br. Dinas Purwaya, Desa Tiyingtali, Kecamatan Abang, Kabupaten Karangasem, Provinsi Bali');
            // Pastikan tidak ada duplikasi kata "Desa Desa" atau "Kecamatan Kecamatan"
            expect(result).not.toMatch(/desa\s+desa/i);
            expect(result).not.toMatch(/kecamatan\s+kecamatan/i);
            expect(result).not.toMatch(/kabupaten\s+kabupaten/i);
            expect(result).not.toMatch(/provinsi\s+provinsi/i);
        });

        test('Kasus 3: Alamat menggunakan singkatan kedinasan (Ds., Kec., Kab., Prov.) -> Dinormalisasi kata penuh dan rapi', () => {
            const student = {
                alamat: 'BR. DINAS PURWAYA, DS. TIYINGTALI, KEC. ABANG, KAB. KARANGASEM, PROV. BALI',
                kelurahan: 'TIYINGTALI',
                kecamatan: 'ABANG'
            };
            const result = formatStudentAddress(student);
            expect(result).toBe('Br. Dinas Purwaya, Desa Tiyingtali, Kecamatan Abang, Kabupaten Karangasem, Provinsi Bali');
        });

        test('Kasus 4: Alamat mencantumkan nama daerah tanpa prefiks -> Disesuaikan dengan menyisipkan Desa, Kecamatan, Kabupaten, Provinsi', () => {
            const student = {
                alamat: 'Banjar Dinas Culik, Culik, Abang, Karangasem, Bali',
                kelurahan: 'Culik',
                kecamatan: 'Abang'
            };
            const result = formatStudentAddress(student);
            expect(result).toBe('Banjar Dinas Culik, Desa Culik, Kecamatan Abang, Kabupaten Karangasem, Provinsi Bali');
        });

        test('Kasus 5: Alamat mentah kosong namun kolom dusun terisi -> Memakai dusun dan menyusun hirarki lengkap', () => {
            const student = {
                alamat: '',
                dusun: 'PURWAYA',
                kelurahan: 'TIYINGTALI',
                kecamatan: 'ABANG'
            };
            const result = formatStudentAddress(student);
            expect(result).toBe('Br. Dinas Purwaya, Desa Tiyingtali, Kecamatan Abang, Kabupaten Karangasem, Provinsi Bali');
        });

        test('Kasus 6: Input kustom textarea (customAddress) diteruskan dan diformat Title Case serta disesuaikan', () => {
            const student = {
                kelurahan: 'Ababi',
                kecamatan: 'Abang'
            };
            const customInput = 'BR. DINAS ABANG BATUDAWA, DESA ABABI, KECAMATAN ABANG, KABUPATEN KARANGASEM, PROVINSI BALI';
            const result = formatStudentAddress(student, customInput);
            expect(result).toBe('Br. Dinas Abang Batudawa, Desa Ababi, Kecamatan Abang, Kabupaten Karangasem, Provinsi Bali');
        });

        test('Kasus 7: Siswa dari kabupaten atau provinsi lain -> Tetap menghormati data wilayah siswa', () => {
            const student = {
                alamat: 'Jl. Ahmad Yani No. 10',
                kelurahan: 'Kuta',
                kecamatan: 'Kuta',
                kabupaten: 'Badung',
                provinsi: 'Bali'
            };
            const result = formatStudentAddress(student);
            expect(result).toBe('Jl. Ahmad Yani No. 10, Desa Kuta, Kecamatan Kuta, Kabupaten Badung, Provinsi Bali');
        });
    });

    describe('3. Integrasi pada js/page-students.js', () => {
        test('Fungsi toTitleCase diekspor ke window di browser', () => {
            expect(pageStudentsJs).toContain('window.toTitleCase = toTitleCase;');
        });

        test('Fungsi formatStudentAddress diekspor ke window di browser', () => {
            expect(pageStudentsJs).toContain('window.formatStudentAddress = formatStudentAddress;');
        });

        test('openSuratKeteranganModal memformat birthPlace dengan toTitleCase dan alamat dengan formatStudentAddress', () => {
            const openModalIndex = pageStudentsJs.indexOf('window.openSuratKeteranganModal = function');
            expect(openModalIndex).toBeGreaterThan(-1);

            const openModalBlock = pageStudentsJs.slice(openModalIndex, openModalIndex + 4000);
            expect(openModalBlock).toContain('const rawBirthPlace = student.birthPlace || \'Karangasem\';');
            expect(openModalBlock).toContain('const birthPlace = toTitleCase(rawBirthPlace);');
            expect(openModalBlock).toContain('const formattedAddress = formatStudentAddress(student);');
            expect(openModalBlock).toContain('addressInput.value = formattedAddress;');
        });

        test('printSuratKeterangan menerapkan toTitleCase pada Tempat Lahir dan formatStudentAddress pada Alamat', () => {
            const printIndex = pageStudentsJs.indexOf('window.printSuratKeterangan = function');
            expect(printIndex).toBeGreaterThan(-1);

            const printBlock = pageStudentsJs.slice(printIndex, printIndex + 4000);
            expect(printBlock).toContain('const studentBirthPlace = toTitleCase(student.birthPlace || \'Karangasem\');');
            expect(printBlock).toContain('const addressVal = rawAddressInput ? formatStudentAddress(student, rawAddressInput) : formatStudentAddress(student);');
        });

        test('downloadSuratKeteranganDocx menerapkan toTitleCase pada Tempat Lahir dan formatStudentAddress pada Alamat', () => {
            const docxIndex = pageStudentsJs.indexOf('window.downloadSuratKeteranganDocx = async function');
            expect(docxIndex).toBeGreaterThan(-1);

            const docxBlock = pageStudentsJs.slice(docxIndex, docxIndex + 6000);
            expect(docxBlock).toContain('const studentBirthPlace = toTitleCase(student.birthPlace || \'Karangasem\');');
            expect(docxBlock).toContain('const addressVal = rawAddressInput ? formatStudentAddress(student, rawAddressInput) : formatStudentAddress(student);');
        });
    });
});
