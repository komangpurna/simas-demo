/**
 * SIMAS SHAKTI - Library Author Standardizer
 * Standarisasi & Auto-Inversi Nama Pengarang Berdasarkan Kaidah Perpustakaan Nasional RI (AACR2 / RDA)
 *
 * Mendukung:
 * 1. Pembalikan nama pengarang perorangan (Nama Belakang/Keluarga, Nama Depan).
 * 2. Pembersihan & isolasi gelar akademik, gelar keagamaan, dan kehormatan.
 * 3. Ekstraksi akurat 3 Huruf Kapital Tanda Pengarang untuk Call Number Nasional (Cutter Code).
 * 4. Penanganan nama khas Indonesia, nama Barat, nama Bali, nama tunggal (mononym), dan nama terinversi (idempoten).
 * 5. Deteksi nama Badan Korporasi / Lembaga / Institusi (tidak dibalik).
 */

(function (global) {
    'use strict';

    // 1. DAFTAR KATA KUNCI BADAN KORPORASI / LEMBAGA (Corporate Authors)
    const CORPORATE_PREFIXES = [
        'kementerian', 'kemendikbud', 'kemenag', 'kemkes', 'kemenkeu', 'kemlu',
        'departemen', 'depdiknas', 'depag', 'dinas', 'badan', 'balai', 'pusat',
        'lembaga', 'komisi', 'sekretariat', 'biro', 'direktorat', 'institut',
        'universitas', 'fakultas', 'politeknik', 'akademi', 'sekolah', 'yayasan',
        'organisasi', 'persatuan', 'ikatan', 'dewan', 'kantor', 'pemerintah',
        'provinsi', 'kabupaten', 'kota', 'unesco', 'unicef', 'who', 'undp',
        'bank indonesia', 'bps', 'bpom', 'bnpb', 'kpk', 'dpr', 'mpr', 'mahkamah',
        'tim', 'panitia', 'redaksi', 'editor', 'penerbit'
    ];

    // 2. DAFTAR GELAR DEPAN (Front Titles & Honorifics)
    const FRONT_TITLES = [
        'prof.', 'prof', 'dr.', 'dr', 'drs.', 'drs', 'dra.', 'dra',
        'ir.', 'ir', 'h.', 'h', 'hj.', 'hj', 'k.h.', 'kh', 'kiai',
        'ust.', 'ust', 'ustadz', 'ustadzah', 'tengku', 'tgk.', 'tgk',
        'raden', 'r.', 'r.a.', 'ra', 'teuku', 'cut', 'sir', 'lord',
        'lady', 'rev.', 'rev', 'pdt.', 'pdt', 'pastor', 'romo',
        'drg.', 'drg', 'drh.', 'drh'
    ];

    // 3. DAFTAR GELAR BELAKANG / AKADEMIK (Post-nominal Degrees)
    const BACK_DEGREES = [
        's.pd', 's.pd.', 'm.pd', 'm.pd.', 's.t', 's.t.', 'm.t', 'm.t.',
        's.kom', 's.kom.', 'm.kom', 'm.kom.', 's.e', 's.e.', 'm.m', 'm.m.',
        's.h', 's.h.', 'm.h', 'm.h.', 's.ked', 's.ked.', 's.si', 's.si.',
        'm.si', 'm.si.', 's.sos', 's.sos.', 'm.sos', 'm.sos.', 's.ag', 's.ag.',
        'm.ag', 'm.ag.', 's.sn', 's.sn.', 'm.sn', 'm.sn.', 's.s', 's.s.',
        'm.hum', 'm.hum.', 's.psi', 's.psi.', 'm.psi', 'm.psi.', 's.farm', 's.farm.',
        'apt', 'apt.', 'ph.d', 'ph.d.', 'phd', 'm.sc', 'm.sc.', 'msc',
        'b.sc', 'b.sc.', 'bsc', 'm.a', 'm.a.', 'ma', 'b.a', 'b.a.', 'ba',
        'm.b.a', 'm.b.a.', 'mba', 'll.m', 'll.m.', 'llm', 'm.phil', 'm.phil.',
        'mphil', 'd.ed', 'd.ed.', 'sp.a', 'sp.a.', 'sp.pd', 'sp.pd.', 'sp.b', 'sp.b.'
    ];

    /**
     * Membersihkan dan menormalkan spasi teks
     */
    function cleanSpaces(str) {
        if (!str) return '';
        return String(str).trim().replace(/\s+/g, ' ');
    }

    /**
     * Memeriksa apakah nama merupakan Badan Korporasi / Lembaga
     */
    function isCorporateAuthor(name) {
        if (!name) return false;
        const lower = name.toLowerCase().trim();
        return CORPORATE_PREFIXES.some(prefix => {
            const regex = new RegExp(`(^|\\b)${prefix}(\\b|$)`, 'i');
            return regex.test(lower);
        });
    }

    // 4. REGEX DETEKSI FRASE KOLABORASI / REKAN PENGARANG (dkk, et al, cs, dan kawan-kawan)
    const ET_AL_REGEX = /[, ]+(?:dan\s+)?(dkk\.?|et\.?\s*al\.?|kawan[-\s]kawan|cs\.?)\s*$/i;

    /**
     * Memeriksa dan mengekstrak frase kolaborasi (dkk, et al, cs) di akhir nama pengarang
     */
    function extractCollaborationSuffix(rawName) {
        if (!rawName) return { cleanInput: '', hasEtAl: false, etAlPhrase: '' };
        const clean = cleanSpaces(rawName);
        const match = clean.match(ET_AL_REGEX);
        if (!match) {
            return { cleanInput: clean, hasEtAl: false, etAlPhrase: '' };
        }

        const rawMatchedPhrase = match[1].toLowerCase();
        let normalizedPhrase = 'dkk.';
        if (rawMatchedPhrase.includes('et') && rawMatchedPhrase.includes('al')) {
            normalizedPhrase = 'et al.';
        }

        const remaining = clean.substring(0, match.index).replace(/,\s*$/, '').trim();
        return {
            cleanInput: remaining || clean,
            hasEtAl: true,
            etAlPhrase: normalizedPhrase
        };
    }

    /**
     * Ekstraksi gelar depan dan belakang dari nama pengarang
     */
    function extractTitlesAndDegrees(rawName) {
        if (!rawName) return { cleanName: '', frontTitles: [], backDegrees: [] };

        let clean = cleanSpaces(rawName);
        const frontTitles = [];
        const backDegrees = [];

        // 1. Ekstraksi gelar belakang setelah koma terlebih dahulu jika ada
        if (clean.includes(',')) {
            const parts = clean.split(',');
            const coreParts = [];
            for (let i = 0; i < parts.length; i++) {
                const part = cleanSpaces(parts[i]);
                const lowerPart = part.toLowerCase().replace(/\.$/, '');
                const isDegree = BACK_DEGREES.some(deg => {
                    const normDeg = deg.toLowerCase().replace(/\.$/, '');
                    return lowerPart === normDeg || lowerPart.startsWith(normDeg + ' ');
                });

                if (i > 0 && isDegree) {
                    backDegrees.push(part);
                } else {
                    coreParts.push(part);
                }
            }
            clean = coreParts.join(', ');
        }

        // 2. Ekstraksi gelar depan berbasis token kata
        let tokens = clean.split(' ');
        let findingFront = true;
        const remainingTokens = [];

        for (const token of tokens) {
            const lower = token.toLowerCase();
            const lowerNoDot = lower.replace(/\.$/, '');

            if (findingFront && (FRONT_TITLES.includes(lower) || FRONT_TITLES.includes(lowerNoDot))) {
                frontTitles.push(token);
            } else {
                findingFront = false;
                remainingTokens.push(token);
            }
        }

        // 3. Ekstraksi gelar belakang dari token terakhir jika tidak terpisah koma
        while (remainingTokens.length > 1) {
            const lastToken = remainingTokens[remainingTokens.length - 1];
            const lowerLast = lastToken.toLowerCase();
            const lowerLastNoDot = lowerLast.replace(/\.$/, '');
            const isDegree = BACK_DEGREES.some(deg => {
                const normDeg = deg.toLowerCase().replace(/\.$/, '');
                return lowerLast === deg || lowerLastNoDot === normDeg;
            });

            if (isDegree) {
                backDegrees.unshift(remainingTokens.pop());
            } else {
                break;
            }
        }

        return {
            cleanName: remainingTokens.join(' ').replace(/,\s*$/, '').trim(),
            frontTitles,
            backDegrees
        };
    }

    /**
     * Mem-parsing nama pengarang dan mengonversi ke standar perpustakaan
     *
     * @param {string} rawInput - Nama mentah yang diketik pengguna atau didapat dari API
     * @returns {object} Informasi pengarang terstruktur
     */
    function parseLibraryAuthor(rawInput) {
        const raw = cleanSpaces(rawInput);
        if (!raw || raw.toLowerCase() === 'anonim' || raw.toLowerCase() === 'anonymous') {
            return {
                rawName: raw || 'Anonim',
                standardName: raw || 'Anonim',
                standardTajuk: raw || 'Anonim',
                authorCode: 'XXX',
                surname: '',
                givenName: '',
                isCorporate: false,
                hasEtAl: false,
                etAlPhrase: '',
                isAlreadyInverted: true,
                frontTitles: [],
                backDegrees: []
            };
        }

        // Ekstraksi frase kolaborasi (dkk., et al., cs.) di akhir nama pengarang
        const { cleanInput, hasEtAl, etAlPhrase } = extractCollaborationSuffix(raw);
        const nameToProcess = cleanInput || raw;

        // A. BADAN KORPORASI / LEMBAGA
        if (isCorporateAuthor(nameToProcess)) {
            // Ambil 3 huruf dari kata pertama yang signifikan
            const cleanCorp = nameToProcess.replace(/[^a-zA-Z]/g, '');
            const authorCode = (cleanCorp.length >= 3 ? cleanCorp.substring(0, 3) : cleanCorp.padEnd(3, 'X')).toUpperCase();
            const standardTajuk = hasEtAl ? `${nameToProcess}, ${etAlPhrase}` : nameToProcess;
            return {
                rawName: raw,
                standardName: standardTajuk,
                standardTajuk: standardTajuk,
                authorCode: authorCode,
                surname: nameToProcess,
                givenName: '',
                isCorporate: true,
                hasEtAl: hasEtAl,
                etAlPhrase: etAlPhrase,
                isAlreadyInverted: true,
                frontTitles: [],
                backDegrees: []
            };
        }

        // B. PENGARANG PERORANGAN
        const { cleanName, frontTitles, backDegrees } = extractTitlesAndDegrees(nameToProcess);

        // Kasus 1: Nama sudah memiliki tanda koma (sudah dibalik oleh pengguna sebelumnya, misal: Hirata, Andrea)
        if (cleanName.includes(',')) {
            const commaParts = cleanName.split(',').map(p => cleanSpaces(p));
            const surname = commaParts[0] || '';
            const givenName = commaParts.slice(1).join(' ') || '';

            const cleanSurnameLetters = surname.replace(/[^a-zA-Z]/g, '');
            const authorCode = (cleanSurnameLetters.length >= 3
                ? cleanSurnameLetters.substring(0, 3)
                : cleanSurnameLetters.padEnd(3, 'X')).toUpperCase();

            // Rangkai standar tajuk
            let standardTajuk = surname;
            if (givenName) standardTajuk += `, ${givenName}`;
            if (hasEtAl) standardTajuk += `, ${etAlPhrase}`;

            const qualifications = [...frontTitles, ...backDegrees].join(', ');
            const fullStandardName = qualifications ? `${standardTajuk}, ${qualifications}` : standardTajuk;

            return {
                rawName: raw,
                standardName: fullStandardName,
                standardTajuk: standardTajuk,
                authorCode: authorCode || 'XXX',
                surname: surname,
                givenName: givenName,
                isCorporate: false,
                hasEtAl: hasEtAl,
                etAlPhrase: etAlPhrase,
                isAlreadyInverted: true,
                frontTitles,
                backDegrees
            };
        }

        // Kasus 2: Nama satu kata (Mononym, misal: Suharto, Sukarno, Plato)
        const words = cleanName.split(' ').filter(Boolean);
        if (words.length <= 1) {
            const single = words[0] || cleanName || 'XXX';
            const cleanSingle = single.replace(/[^a-zA-Z]/g, '');
            const authorCode = (cleanSingle.length >= 3
                ? cleanSingle.substring(0, 3)
                : cleanSingle.padEnd(3, 'X')).toUpperCase();

            const standardTajuk = hasEtAl ? `${single}, ${etAlPhrase}` : single;
            const qualifications = [...frontTitles, ...backDegrees].join(', ');
            const fullStandardName = qualifications ? `${standardTajuk}, ${qualifications}` : standardTajuk;

            return {
                rawName: raw,
                standardName: fullStandardName,
                standardTajuk: standardTajuk,
                authorCode: authorCode || 'XXX',
                surname: single,
                givenName: '',
                isCorporate: false,
                hasEtAl: hasEtAl,
                etAlPhrase: etAlPhrase,
                isAlreadyInverted: true,
                frontTitles,
                backDegrees
            };
        }

        // Kasus 3: Nama Majemuk / Biasa (2 kata atau lebih, misal: Andrea Hirata, J.K. Rowling, I Komang Purna)
        // Di perpustakaan Indonesia (Perpusnas RI / AACR2), kata terakhir dijadikan entri utama (surname)
        const surname = words[words.length - 1];
        const givenName = words.slice(0, words.length - 1).join(' ');

        const cleanSurnameLetters = surname.replace(/[^a-zA-Z]/g, '');
        const authorCode = (cleanSurnameLetters.length >= 3
            ? cleanSurnameLetters.substring(0, 3)
            : cleanSurnameLetters.padEnd(3, 'X')).toUpperCase();

        let standardTajuk = `${surname}, ${givenName}`;
        if (hasEtAl) standardTajuk += `, ${etAlPhrase}`;

        const qualifications = [...frontTitles, ...backDegrees].join(', ');
        const fullStandardName = qualifications ? `${standardTajuk}, ${qualifications}` : standardTajuk;

        return {
            rawName: raw,
            standardName: fullStandardName,
            standardTajuk: standardTajuk,
            authorCode: authorCode || 'XXX',
            surname: surname,
            givenName: givenName,
            isCorporate: false,
            hasEtAl: hasEtAl,
            etAlPhrase: etAlPhrase,
            isAlreadyInverted: false,
            frontTitles,
            backDegrees
        };
    }

    /**
     * Menghasilkan string nama pengarang yang telah distandarisasi (format inversi perpustakaan)
     */
    function standardizeAuthorName(rawInput, includeQualifications = true) {
        const parsed = parseLibraryAuthor(rawInput);
        return includeQualifications ? parsed.standardName : (parsed.standardTajuk || parsed.standardName);
    }

    /**
     * Menghasilkan 3 Huruf Kapital Tanda Pengarang untuk Call Number Standar Perpusnas RI
     */
    function getAuthorCallCode(rawInput) {
        const parsed = parseLibraryAuthor(rawInput);
        return parsed.authorCode || 'XXX';
    }

    // Export API
    const LibraryAuthor = {
        parse: parseLibraryAuthor,
        standardize: standardizeAuthorName,
        getAuthorCallCode: getAuthorCallCode,
        isCorporate: isCorporateAuthor,
        extractTitlesAndDegrees: extractTitlesAndDegrees,
        extractCollaborationSuffix: extractCollaborationSuffix
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = LibraryAuthor;
    }

    if (typeof global !== 'undefined') {
        global.LibraryAuthor = LibraryAuthor;
    }
})(typeof window !== 'undefined' ? window : globalThis);
