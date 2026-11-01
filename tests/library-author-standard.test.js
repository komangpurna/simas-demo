const LibraryAuthor = require('../library/author-standardizer.js');

describe('Standarisasi Nama Pengarang & Call Number Perpustakaan (Perpusnas RI / AACR2)', () => {
    describe('1. Pengarang Indonesia Multi-Kata (Nama Belakang Dibalik)', () => {
        test('Membalik nama 2 kata umum (Andrea Hirata -> Hirata, Andrea & HIR)', () => {
            const parsed = LibraryAuthor.parse('Andrea Hirata');
            expect(parsed.standardTajuk).toBe('Hirata, Andrea');
            expect(parsed.authorCode).toBe('HIR');
            expect(parsed.surname).toBe('Hirata');
            expect(parsed.givenName).toBe('Andrea');
            expect(parsed.isCorporate).toBe(false);
        });

        test('Membalik nama 3 kata (Pramoedya Ananta Toer -> Toer, Pramoedya Ananta & TOE)', () => {
            const parsed = LibraryAuthor.parse('Pramoedya Ananta Toer');
            expect(parsed.standardTajuk).toBe('Toer, Pramoedya Ananta');
            expect(parsed.authorCode).toBe('TOE');
            expect(parsed.surname).toBe('Toer');
        });

        test('Nama 2 kata (Mochtar Lubis -> Lubis, Mochtar & LUB)', () => {
            const parsed = LibraryAuthor.parse('Mochtar Lubis');
            expect(parsed.standardTajuk).toBe('Lubis, Mochtar');
            expect(parsed.authorCode).toBe('LUB');
        });
    });

    describe('2. Pengarang Khas Bali (Gelar Kasta / Urutan Lahir)', () => {
        test('Nama I Komang Purna -> Purna, I Komang & PUR', () => {
            const parsed = LibraryAuthor.parse('I Komang Purna');
            expect(parsed.standardTajuk).toBe('Purna, I Komang');
            expect(parsed.authorCode).toBe('PUR');
            expect(parsed.surname).toBe('Purna');
        });

        test('Nama I Gusti Ngurah Rai -> Rai, I Gusti Ngurah & RAI', () => {
            const parsed = LibraryAuthor.parse('I Gusti Ngurah Rai');
            expect(parsed.standardTajuk).toBe('Rai, I Gusti Ngurah');
            expect(parsed.authorCode).toBe('RAI');
        });

        test('Nama Ida Bagus Mantra -> Mantra, Ida Bagus & MAN', () => {
            const parsed = LibraryAuthor.parse('Ida Bagus Mantra');
            expect(parsed.standardTajuk).toBe('Mantra, Ida Bagus');
            expect(parsed.authorCode).toBe('MAN');
        });

        test('Nama Ni Luh Ketut Sari -> Sari, Ni Luh Ketut & SAR', () => {
            const parsed = LibraryAuthor.parse('Ni Luh Ketut Sari');
            expect(parsed.standardTajuk).toBe('Sari, Ni Luh Ketut');
            expect(parsed.authorCode).toBe('SAR');
        });
    });

    describe('3. Pengarang Asing / Barat', () => {
        test('Nama inisial J.K. Rowling -> Rowling, J.K. & ROW', () => {
            const parsed = LibraryAuthor.parse('J.K. Rowling');
            expect(parsed.standardTajuk).toBe('Rowling, J.K.');
            expect(parsed.authorCode).toBe('ROW');
        });

        test('Nama Barat 3 kata Stephen R. Covey -> Covey, Stephen R. & COV', () => {
            const parsed = LibraryAuthor.parse('Stephen R. Covey');
            expect(parsed.standardTajuk).toBe('Covey, Stephen R.');
            expect(parsed.authorCode).toBe('COV');
        });

        test('Nama Robert T. Kiyosaki -> Kiyosaki, Robert T. & KIY', () => {
            const parsed = LibraryAuthor.parse('Robert T. Kiyosaki');
            expect(parsed.standardTajuk).toBe('Kiyosaki, Robert T.');
            expect(parsed.authorCode).toBe('KIY');
        });
    });

    describe('4. Pembersihan Gelar Akademik & Kehormatan', () => {
        test('Prof. Dr. Ir. Yohanes Surya, Ph.D. -> Surya, Yohanes & SUR', () => {
            const parsed = LibraryAuthor.parse('Prof. Dr. Ir. Yohanes Surya, Ph.D.');
            expect(parsed.standardTajuk).toBe('Surya, Yohanes');
            expect(parsed.authorCode).toBe('SUR');
            expect(parsed.frontTitles).toContain('Prof.');
            expect(parsed.frontTitles).toContain('Dr.');
            expect(parsed.frontTitles).toContain('Ir.');
            expect(parsed.backDegrees).toContain('Ph.D.');
        });

        test('Drs. H. Mohammad Hatta -> Hatta, Mohammad & HAT', () => {
            const parsed = LibraryAuthor.parse('Drs. H. Mohammad Hatta');
            expect(parsed.standardTajuk).toBe('Hatta, Mohammad');
            expect(parsed.authorCode).toBe('HAT');
        });

        test('Dr. Andrea Hirata, M.Sc. -> Hirata, Andrea & HIR', () => {
            const parsed = LibraryAuthor.parse('Dr. Andrea Hirata, M.Sc.');
            expect(parsed.standardTajuk).toBe('Hirata, Andrea');
            expect(parsed.authorCode).toBe('HIR');
        });
    });

    describe('5. Nama Tunggal (Mononym)', () => {
        test('Nama Suharto -> tetap Suharto & SUH', () => {
            const parsed = LibraryAuthor.parse('Suharto');
            expect(parsed.standardTajuk).toBe('Suharto');
            expect(parsed.authorCode).toBe('SUH');
        });

        test('Nama Aristoteles -> tetap Aristoteles & ARI', () => {
            const parsed = LibraryAuthor.parse('Aristoteles');
            expect(parsed.standardTajuk).toBe('Aristoteles');
            expect(parsed.authorCode).toBe('ARI');
        });
    });

    describe('6. Idempotensi Nama yang Sudah Terinversi (Sudah Ada Koma)', () => {
        test('Hirata, Andrea tidak dibalik ganda -> tetap Hirata, Andrea & HIR', () => {
            const parsed = LibraryAuthor.parse('Hirata, Andrea');
            expect(parsed.standardTajuk).toBe('Hirata, Andrea');
            expect(parsed.authorCode).toBe('HIR');
            expect(parsed.surname).toBe('Hirata');
        });

        test('Rowling, J. K. -> tetap Rowling, J. K. & ROW', () => {
            const parsed = LibraryAuthor.parse('Rowling, J. K.');
            expect(parsed.standardTajuk).toBe('Rowling, J. K.');
            expect(parsed.authorCode).toBe('ROW');
        });
    });

    describe('7. Badan Korporasi / Lembaga (Tidak Dibalik)', () => {
        test('Kementerian Pendidikan dan Kebudayaan -> tidak dibalik & KEM', () => {
            const parsed = LibraryAuthor.parse('Kementerian Pendidikan dan Kebudayaan');
            expect(parsed.isCorporate).toBe(true);
            expect(parsed.standardTajuk).toBe('Kementerian Pendidikan dan Kebudayaan');
            expect(parsed.authorCode).toBe('KEM');
        });

        test('UNESCO -> tidak dibalik & UNE', () => {
            const parsed = LibraryAuthor.parse('UNESCO');
            expect(parsed.isCorporate).toBe(true);
            expect(parsed.standardTajuk).toBe('UNESCO');
            expect(parsed.authorCode).toBe('UNE');
        });

        test('Badan Pusat Statistik -> tidak dibalik & BAD', () => {
            const parsed = LibraryAuthor.parse('Badan Pusat Statistik');
            expect(parsed.isCorporate).toBe(true);
            expect(parsed.authorCode).toBe('BAD');
        });
    });

    describe('8. Kasus Edge & Fallback Keamanan', () => {
        test('Anonim menghasilkan kode XXX', () => {
            expect(LibraryAuthor.getAuthorCallCode('Anonim')).toBe('XXX');
            expect(LibraryAuthor.getAuthorCallCode('anonymous')).toBe('XXX');
            expect(LibraryAuthor.getAuthorCallCode('')).toBe('XXX');
            expect(LibraryAuthor.getAuthorCallCode(null)).toBe('XXX');
        });

        test('Spasi berlebih di awal/akhir/tengah dibersihkan', () => {
            const parsed = LibraryAuthor.parse('   Andrea    Hirata   ');
            expect(parsed.standardTajuk).toBe('Hirata, Andrea');
            expect(parsed.authorCode).toBe('HIR');
        });

        test('Nama pendek 2 huruf diisi X di belakang', () => {
            const parsed = LibraryAuthor.parse('Wu');
            expect(parsed.authorCode).toBe('WUX');
        });
    });

    describe('9. Penanganan Frase Rekan / Kolaborasi (dkk, et al, cs, dan kawan-kawan)', () => {
        test('Nama pengarang dengan dkk. (Andrea Hirata dkk. -> Hirata, Andrea, dkk. & HIR)', () => {
            const parsed = LibraryAuthor.parse('Andrea Hirata dkk.');
            expect(parsed.standardTajuk).toBe('Hirata, Andrea, dkk.');
            expect(parsed.authorCode).toBe('HIR');
            expect(parsed.surname).toBe('Hirata');
            expect(parsed.givenName).toBe('Andrea');
            expect(parsed.hasEtAl).toBe(true);
            expect(parsed.etAlPhrase).toBe('dkk.');
            expect(parsed.isAlreadyInverted).toBe(false);
        });

        test('Nama pengarang dengan koma dan dkk. (Andrea Hirata, dkk.)', () => {
            const parsed = LibraryAuthor.parse('Andrea Hirata, dkk.');
            expect(parsed.standardTajuk).toBe('Hirata, Andrea, dkk.');
            expect(parsed.authorCode).toBe('HIR');
            expect(parsed.hasEtAl).toBe(true);
        });

        test('Nama pengarang dengan dkk tanpa titik (Andrea Hirata dkk)', () => {
            const parsed = LibraryAuthor.parse('Andrea Hirata dkk');
            expect(parsed.standardTajuk).toBe('Hirata, Andrea, dkk.');
            expect(parsed.authorCode).toBe('HIR');
        });

        test('Nama pengarang dengan frase dan kawan-kawan (Andrea Hirata dan kawan-kawan)', () => {
            const parsed = LibraryAuthor.parse('Andrea Hirata dan kawan-kawan');
            expect(parsed.standardTajuk).toBe('Hirata, Andrea, dkk.');
            expect(parsed.authorCode).toBe('HIR');
        });

        test('Nama pengarang dengan cs. (Andrea Hirata, cs.)', () => {
            const parsed = LibraryAuthor.parse('Andrea Hirata, cs.');
            expect(parsed.standardTajuk).toBe('Hirata, Andrea, dkk.');
            expect(parsed.authorCode).toBe('HIR');
        });

        test('Nama pengarang asing dengan et al. (J. Smith et al. -> Smith, J., et al. & SMI)', () => {
            const parsed = LibraryAuthor.parse('J. Smith et al.');
            expect(parsed.standardTajuk).toBe('Smith, J., et al.');
            expect(parsed.authorCode).toBe('SMI');
            expect(parsed.hasEtAl).toBe(true);
            expect(parsed.etAlPhrase).toBe('et al.');
        });

        test('Nama pengarang asing 3 kata dengan et al. (Stephen R. Covey, et al.)', () => {
            const parsed = LibraryAuthor.parse('Stephen R. Covey, et al.');
            expect(parsed.standardTajuk).toBe('Covey, Stephen R., et al.');
            expect(parsed.authorCode).toBe('COV');
        });

        test('Pengarang lengkap dengan gelar akademik dan dkk.', () => {
            const parsed = LibraryAuthor.parse('Prof. Dr. Bambang Sudibyo, M.Pd., dkk.');
            expect(parsed.standardTajuk).toBe('Sudibyo, Bambang, dkk.');
            expect(parsed.authorCode).toBe('SUD');
            expect(parsed.hasEtAl).toBe(true);
            expect(parsed.frontTitles).toContain('Prof.');
            expect(parsed.frontTitles).toContain('Dr.');
            expect(parsed.backDegrees).toContain('M.Pd.');
        });

        test('Nama Bali dengan dkk. (I Komang Purna, dkk. -> Purna, I Komang, dkk. & PUR)', () => {
            const parsed = LibraryAuthor.parse('I Komang Purna, dkk.');
            expect(parsed.standardTajuk).toBe('Purna, I Komang, dkk.');
            expect(parsed.authorCode).toBe('PUR');
        });

        test('Nama tunggal (Mononym) dengan dkk. (Suharto dkk. -> Suharto, dkk. & SUH)', () => {
            const parsed = LibraryAuthor.parse('Suharto dkk.');
            expect(parsed.standardTajuk).toBe('Suharto, dkk.');
            expect(parsed.authorCode).toBe('SUH');
        });

        test('Idempotensi nama yang sudah terinversi dengan dkk. (Hirata, Andrea, dkk.)', () => {
            const parsed = LibraryAuthor.parse('Hirata, Andrea, dkk.');
            expect(parsed.standardTajuk).toBe('Hirata, Andrea, dkk.');
            expect(parsed.authorCode).toBe('HIR');
            expect(parsed.isAlreadyInverted).toBe(true);
        });

        test('Badan Korporasi dengan dkk. (Kementerian Pendidikan dan Kebudayaan dkk.)', () => {
            const parsed = LibraryAuthor.parse('Kementerian Pendidikan dan Kebudayaan dkk.');
            expect(parsed.isCorporate).toBe(true);
            expect(parsed.standardTajuk).toBe('Kementerian Pendidikan dan Kebudayaan, dkk.');
            expect(parsed.authorCode).toBe('KEM');
        });
    });
});
