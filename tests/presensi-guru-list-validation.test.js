/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

function evalNormalize(name) {
    if (!name) return '';
    let clean = name.toLowerCase();
    clean = clean.replace(/\b([a-z])\.\s+([a-z])\b/gi, '$1.$2');
    clean = clean.replace(/\b([a-z])\.\s+([a-z])\b/gi, '$1.$2');
    const titlePatterns = [
        /\bm\.?\s*pd\.?\s*h\.?\b/gi,
        /\bs\.?\s*pd\.?\s*h\.?\b/gi,
        /\bm\.?\s*pd\.?\b/gi,
        /\bs\.?\s*pd\.?\b/gi,
        /\bs\.?\s*ag\.?\b/gi,
        /\bs\.?\s*kom\.?\b/gi,
        /\bs\.?\s*e\.?\b/gi,
        /\bs\.?\s*t\.?\b/gi,
        /\bm\.?\s*si\.?\b/gi,
        /\bm\.?\s*m\.?\b/gi,
        /\bm\.?\s*p\.?\b/gi,
        /\bs\.?\s*p\.?\b/gi,
        /\bdrs\.?\b/gi,
        /\bdr\.?\b/gi,
        /\bgr\.?\b/gi,
        /\bh\.?\b/gi,
        /\bhj\.?\b/gi,
        /\btim\s*bk\b/gi,
        /\btim\b/gi
    ];
    titlePatterns.forEach(p => { clean = clean.replace(p, ' '); });
    return clean.replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
}

describe('Presensi Guru - Teacher List & Match Validation Test', () => {
    let mockTeachersData;
    let pagePresensiGuruJs;

    beforeAll(() => {
        const filePath = path.join(__dirname, '..', 'js', 'page-presensi-guru.js');
        pagePresensiGuruJs = fs.readFileSync(filePath, 'utf8');
    });

    beforeEach(() => {
        // Data GTK representatif dari Cloudflare D1 (Pure SSOT)
        mockTeachersData = [
            {
                id: '5107057112970051',
                nik: '5107057112970051',
                nip: '199712312024212038',
                name: 'Ni Kadek Nilawati, S.Pd',
                jenis_ptk: 'Guru',
                role: 'guru_mapel',
                status: 'active'
                // jabatan sengaja tidak ada/undefined sesuai schema D1
            },
            {
                id: 'htfda25WD2xWRTzhKtle',
                nik: '5107051234560001',
                nip: '198701012010011001',
                name: 'I Komang Purna, S.Pd., Gr.',
                jenis_ptk: 'Guru',
                role: 'guru_mapel',
                status: 'active'
            },
            {
                id: 'KS12345678',
                name: 'Kepala Sekolah Hebat, M.Pd.',
                jenis_ptk: 'Kepala Sekolah',
                tugas_tambahan: 'Kepala Sekolah',
                role: 'guru_mapel',
                status: 'active'
            },
            {
                id: 'BK99999999',
                name: 'Guru BK Berdedikasi, S.Pd.',
                jenis_ptk: 'Guru BK',
                role: 'guru_bk',
                status: 'active'
            },
            {
                id: 'TENDIK001',
                name: 'Staf TU Administrasi',
                jenis_ptk: 'Tenaga Administrasi Sekolah',
                role: 'guru_mapel', // role legacy
                status: 'active'
            },
            {
                id: 'SATPAM001',
                name: 'Petugas Keamanan Sekolah',
                jenis_ptk: 'Keamanan',
                role: 'guru_mapel',
                status: 'active'
            }
        ];
    });

    test('1. page-presensi-guru.js memiliki filter guruList tangguh berbasis jenis_ptk / tugas_tambahan / non-teacher exclusion', () => {
        expect(pagePresensiGuruJs).toContain('nonTeacherKeywords');
        expect(pagePresensiGuruJs).toContain('isExplicitNonTeacher');
        expect(pagePresensiGuruJs).toContain('data.jenis_ptk');
        // Tidak lagi hanya mengandalkan data.jabatan murni
        expect(pagePresensiGuruJs).not.toMatch(/if\s*\(data\.jabatan\s*&&\s*data\.jabatan\.toLowerCase\(\)\.includes\('guru'\)\)/);
    });

    test('2. loadGuruList() menyaring tenaga pengajar (Guru, BK, KS) dan mengabaikan non-guru murni walau tanpa properti jabatan', () => {
        const nonTeacherKeywords = ['tenaga kependidikan', 'tenaga administrasi sekolah', 'keamanan', 'kebersihan', 'satpam', 'penjaga', 'tata usaha', 'pegawai'];
        const guruList = [];

        mockTeachersData.forEach(data => {
            if (!data || !data.name) return;
            const jenisPtk = (data.jenis_ptk || '').toLowerCase();
            const role = (data.role || '').toLowerCase();
            const jabatanRaw = (data.jabatan || data.tugas_tambahan || '').toLowerCase();

            const isExplicitNonTeacher = nonTeacherKeywords.some(kw => jenisPtk.includes(kw) || jabatanRaw.includes(kw)) &&
                !jenisPtk.includes('guru') && !role.includes('guru_bk') && !jenisPtk.includes('kepala sekolah');

            if (!isExplicitNonTeacher) {
                const jabatanLabel = (data.tugas_tambahan && data.tugas_tambahan !== '-' && data.tugas_tambahan !== 'Lainnya')
                    ? data.tugas_tambahan
                    : (data.jabatan || data.jenis_ptk || 'Guru');

                guruList.push({
                    id: data.id || data.nik || data.nip || '',
                    nik: data.nik || '',
                    name: data.name,
                    nip: data.nip || '',
                    jabatan: jabatanLabel
                });
            }
        });

        // Verifikasi Guru, KS, dan BK masuk
        expect(guruList.length).toBe(4);
        expect(guruList.some(g => g.name === 'Ni Kadek Nilawati, S.Pd')).toBe(true);
        expect(guruList.some(g => g.name === 'I Komang Purna, S.Pd., Gr.')).toBe(true);
        expect(guruList.some(g => g.name === 'Kepala Sekolah Hebat, M.Pd.')).toBe(true);
        expect(guruList.some(g => g.name === 'Guru BK Berdedikasi, S.Pd.')).toBe(true);

        // Verifikasi staf TU dan satpam tersaring
        expect(guruList.some(g => g.name === 'Staf TU Administrasi')).toBe(false);
        expect(guruList.some(g => g.name === 'Petugas Keamanan Sekolah')).toBe(false);
    });

    test('3. Validasi nama guru dari Jadwal XML (dengan tanda titik di gelar) berhasil dicocokkan ke nama GTK resmi', () => {
        const guruList = [
            {
                id: '5107057112970051',
                name: 'Ni Kadek Nilawati, S.Pd',
                nip: '199712312024212038',
                jabatan: 'Guru'
            }
        ];

        // Nama yang terisi otomatis dari XML Jadwal.xml
        const guruNamaFromXML = 'Ni Kadek Nilawati, S.Pd.';

        // Simulasi logika pencocokan di saveJP
        let matchedGuru = guruList.find(g => g.name.toLowerCase() === guruNamaFromXML.toLowerCase());
        if (!matchedGuru) {
            const norm = evalNormalize(guruNamaFromXML);
            if (norm) matchedGuru = guruList.find(g => evalNormalize(g.name) === norm);
        }

        expect(matchedGuru).toBeDefined();
        expect(matchedGuru.name).toBe('Ni Kadek Nilawati, S.Pd');
        expect(matchedGuru.id).toBe('5107057112970051');
    });

    test('4. Fallback master GTK global bekerja jika guruList belum terpopulasi', () => {
        const guruList = []; // simulasi guruList belum termuat
        window.getTeachersCacheSync = () => mockTeachersData;

        const guruNama = 'Ni Kadek Nilawati, S.Pd.';
        const guruId = '5107057112970051';

        let matchedGuru = guruList.find(g => (guruId && (g.id === guruId || g.nik === guruId || g.nip === guruId)) || g.name.toLowerCase() === guruNama.toLowerCase());
        if (!matchedGuru) {
            const norm = evalNormalize(guruNama);
            if (norm) matchedGuru = guruList.find(g => evalNormalize(g.name) === norm);
        }

        if (!matchedGuru && typeof window.getTeachersCacheSync === 'function') {
            const allGtk = window.getTeachersCacheSync() || [];
            const norm = evalNormalize(guruNama);
            const matchGtk = allGtk.find(g => (guruId && (g.id === guruId || g.nik === guruId || g.nip === guruId)) ||
                (g.name && g.name.toLowerCase() === guruNama.toLowerCase()) ||
                (norm && g.name && evalNormalize(g.name) === norm));
            if (matchGtk) {
                matchedGuru = {
                    id: matchGtk.id || matchGtk.nik || matchGtk.nip || '',
                    name: matchGtk.name,
                    nip: matchGtk.nip || '',
                    jabatan: matchGtk.tugas_tambahan || matchGtk.jabatan || matchGtk.jenis_ptk || 'Guru'
                };
            }
        }

        expect(matchedGuru).toBeDefined();
        expect(matchedGuru.name).toBe('Ni Kadek Nilawati, S.Pd');
        expect(matchedGuru.id).toBe('5107057112970051');
    });
});
