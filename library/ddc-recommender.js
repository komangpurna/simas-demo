/**
 * library/ddc-recommender.js - Smart NLP AI Classifier for Dewey Decimal Classification (DDC)
 * 100% Client-side, Zero Cost, Offline-capable, Sub-5ms Computation.
 * Standardized for Indonesian High School (SMA) & National Library of Indonesia (Perpusnas RI).
 */

(function () {
    'use strict';

    // 1. INDONESIAN & ENGLISH COMMON STOPWORDS & BOOK PUBLISHING NOISE WORDS
    const STOPWORDS = new Set([
        // Indonesian Common Stopwords
        'dan', 'atau', 'yang', 'untuk', 'pada', 'ke', 'di', 'dari', 'dalam', 'dengan', 'tentang',
        'oleh', 'atas', 'bagi', 'sebagai', 'antara', 'sampai', 'hingga', 'secara',
        'karena', 'agar', 'supaya', 'jika', 'bila', 'apabila', 'serta', 'yaitu', 'yakni',
        'adalah', 'merupakan', 'bahwa', 'ini', 'itu', 'tersebut', 'suatu', 'sebuah', 'para',
        'ia', 'dia', 'mereka', 'kita', 'kami', 'saya', 'kamu', 'anda', 'ada', 'pun', 'tak',
        'tidak', 'bukan', 'tanpa', 'hanya', 'lagi', 'sudah', 'telah', 'sedang', 'akan',

        // Book & Academic Publishing Noise Words
        'buku', 'kitab', 'panduan', 'pedoman', 'pengantar', 'dasar', 'dasardasar', 'dasar-dasar',
        'teori', 'konsep', 'praktis', 'lengkap', 'pokok', 'prinsip', 'studi', 'metode',
        'metodologi', 'ringkasan', 'ikhtisar', 'seri', 'modul', 'materi', 'diktat', 'bacaan',
        'paket', 'pegangan', 'siswa', 'guru', 'pengajar', 'pelajar', 'pendidik', 'sekolah',
        'sma', 'smk', 'ma', 'mak', 'smp', 'sd', 'universitas', 'perguruan', 'tinggi',
        'kelas', 'tingkat', 'fase', 'semester', 'ganjil', 'genap', 'kurikulum', 'merdeka',
        'k13', 'kurtilas', 'revisi', 'edisi', 'jilid', 'cetakan', 'bab', 'bagian', 'juz',
        'terbaru', 'terkini', 'populer', 'modern', 'kontemporer', 'klasik',
        'nasional', 'internasional', 'lokal', 'analisis',

        // English Common Stopwords
        'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with',
        'about', 'as', 'into', 'like', 'through', 'after', 'over', 'between', 'out', 'against',
        'during', 'without', 'before', 'under', 'around', 'among', 'book', 'guide', 'handbook',
        'introduction', 'intro', 'fundamentals', 'principles', 'concepts', 'complete',
        'essential', 'edition', 'vol', 'volume', 'grade', 'class', 'part'
    ]);

    // 2. LIGHTWEIGHT INDONESIAN MORPHOLOGICAL STEMMER (AFFIX STRIPPER)
    function stemIndonesian(word) {
        if (!word || word.length <= 3) return [word];
        const results = new Set([word]);
        let w = word.toLowerCase();

        // 1. Strip inflection suffixes (-nya, -lah, -kah, -tah, -pun, -ku, -mu)
        const inflectionSuffixes = ['nya', 'lah', 'kah', 'tah', 'pun', 'ku', 'mu'];
        for (const sfx of inflectionSuffixes) {
            if (w.endsWith(sfx) && w.length > sfx.length + 3) {
                w = w.slice(0, -sfx.length);
                results.add(w);
                break;
            }
        }

        // 2. Strip derivational suffixes (-kan, -an, -i)
        if (w.endsWith('kan') && w.length > 6) {
            results.add(w.slice(0, -3));
        } else if (w.endsWith('an') && w.length > 5) {
            results.add(w.slice(0, -2));
        } else if (w.endsWith('i') && w.length > 4) {
            results.add(w.slice(0, -1));
        }

        // 3. Strip derivational prefixes
        const checkPrefix = (str) => {
            if (str.startsWith('ber') && str.length > 5) results.add(str.slice(3));
            else if (str.startsWith('ter') && str.length > 5) results.add(str.slice(3));
            else if (str.startsWith('per') && str.length > 5) results.add(str.slice(3));
            else if (str.startsWith('pem') && str.length > 5) {
                results.add(str.slice(3));
                results.add('p' + str.slice(3));
            } else if (str.startsWith('pen') && str.length > 5) {
                results.add(str.slice(3));
                results.add('t' + str.slice(3));
            } else if (str.startsWith('peng') && str.length > 6) {
                results.add(str.slice(4));
                results.add('k' + str.slice(4));
            } else if (str.startsWith('meny') && str.length > 6) {
                results.add('s' + str.slice(4));
            } else if (str.startsWith('meng') && str.length > 6) {
                results.add(str.slice(4));
                results.add('k' + str.slice(4));
            } else if (str.startsWith('mem') && str.length > 5) {
                results.add(str.slice(3));
                results.add('p' + str.slice(3));
            } else if (str.startsWith('men') && str.length > 5) {
                results.add(str.slice(3));
                results.add('t' + str.slice(3));
            } else if (str.startsWith('me') && str.length > 4) {
                results.add(str.slice(2));
            } else if (str.startsWith('di') && str.length > 4) {
                results.add(str.slice(2));
            } else if (str.startsWith('ke') && str.length > 4) {
                results.add(str.slice(2));
            } else if (str.startsWith('se') && str.length > 4) {
                results.add(str.slice(2));
            }
        };

        [...results].forEach(item => checkPrefix(item));
        return [...results];
    }

    // 3. COMPREHENSIVE DDC ONTOLOGY & SEMANTIC VOCABULARY FOR HIGH SCHOOL LIBRARIES
    const DDC_ONTOLOGY = [
        // -------------------------------------------------------------
        // KELAS 000: KARYA UMUM, KOMPUTER, INFORMASI & ILMU PERPUSTAKAAN
        // -------------------------------------------------------------
        {
            kode: '000',
            nama: 'Karya Umum & Komputer',
            kelasUtama: '000',
            keywords: ['karya umum', 'ensiklopedia', 'kamus umum', 'perpustakaan', 'ilmu perpustakaan', 'informasi', 'jurnalistik', 'media massa', 'surat kabar', 'pers', 'manuskrip', 'bibliografi', 'katalog', 'dokumentasi', 'kearsipan']
        },
        {
            kode: '004',
            nama: 'Ilmu Komputer & TI',
            kelasUtama: '000',
            keywords: ['komputer', 'ilmu komputer', 'informatika', 'pemrograman', 'programming', 'coding', 'algoritma', 'perangkat lunak', 'software', 'hardware', 'perangkat keras', 'python', 'java', 'javascript', 'c++', 'html', 'css', 'php', 'database', 'basis data', 'sql', 'mysql', 'postgresql', 'jaringan komputer', 'network', 'cyber', 'keamanan siber', 'sistem informasi', 'rekayasa perangkat lunak', 'rpl', 'artificial intelligence', 'kecerdasan buatan', 'machine learning', 'data science', 'cloud computing', 'internet', 'web', 'aplikasi', 'android', 'ios', 'mobile', 'react', 'node js', 'vue']
        },
        {
            kode: '005',
            nama: 'Pemrograman & Data Komputer',
            kelasUtama: '000',
            keywords: ['pemrograman komputer', 'bahasa pemrograman', 'arsitektur data', 'struktur data', 'analisis algoritma', 'object oriented', 'oop', 'sistem operasi', 'linux', 'windows', 'cyber security', 'git', 'fullstack']
        },
        {
            kode: '070',
            nama: 'Media Massa, Jurnalistik & Penerbitan',
            kelasUtama: '000',
            keywords: ['jurnalistik', 'wartawan', 'berita', 'surat kabar', 'koran', 'majalah', 'media massa', 'broadcasting', 'penyiaran', 'penerbitan', 'editing naskah', 'reportase', 'redaksi', 'public relations']
        },

        // -------------------------------------------------------------
        // KELAS 100: FILSAFAT & PSIKOLOGI
        // -------------------------------------------------------------
        {
            kode: '100',
            nama: 'Filsafat & Psikologi',
            kelasUtama: '100',
            keywords: ['filsafat', 'philosophy', 'filosofi', 'epistemologi', 'ontologi', 'metafisika', 'filsafat ilmu', 'eksistensialisme', 'stoikisme', 'stoisisme', 'stoik', 'teori berpikir', 'kebijaksanaan', 'plato', 'aristoteles', 'socrates', 'kant', 'nietzsche']
        },
        {
            kode: '150',
            nama: 'Psikologi Umum & Pengembangan Diri',
            kelasUtama: '100',
            keywords: [
                'psikologi', 'psychology', 'kejiwaan', 'mental', 'emosi', 'perilaku manusia', 'kepribadian', 'kecerdasan emosional',
                'bodo amat', 'bersikap bodo amat', 'sebuah seni untuk bersikap bodo amat', 'cuek', 'sikap', 'bersikap', 'mark manson',
                'the subtle art of not giving a fuck', 'subtle art of not giving', 'atomic habits', 'james clear', 'kebiasaan',
                'kebiasaan kecil', 'perubahan kecil', 'filosofi teras', 'henry manampiring', 'bicara itu ada seninya', 'seni berbicara',
                'oh su hyang', 'berani tidak disukai', 'ichiro kishimi', 'fumitake koga', 'the psychology of money', 'morgan housel',
                'psikologi uang', 'self improvement', 'self help', 'pengembangan diri', 'mindset', 'carol dweck', 'grit', 'angela duckworth',
                'pantang menyerah', 'resiliensi', 'ketahanan mental', 'kesehatan mental', 'mental health', 'overthinking', 'insecurity',
                'insecure', 'insecurity is my middle name', 'alvi syahrin', 'percaya diri', 'kepercayaan diri', 'mencintai diri',
                'self love', 'self care', 'hidup bahagia', 'kebahagiaan', 'berdamai dengan diri', 'seni berdamai dengan diri sendiri',
                'tak apa apa tidak sempurna', 'healing', 'trauma', 'manajemen stres', 'produktivitas', 'deep work', 'cal newport',
                'manajemen waktu', 'time management', 'tujuh kebiasaan', '7 habits', 'stephen covey', 'dale carnegie', 'bagaimana mencari kawan',
                'how to win friends', 'motivasi', 'sukses', 'berpikir positif', 'positive thinking', 'ikigai', 'alasan untuk tetap hidup',
                'matt haig', 'rich dad poor dad', 'robert kiyosaki', 'the power of habit', 'charles duhigg', 'start with why', 'simon sinek',
                'show your work', 'austin kleon', 'introvert', 'ekstrovert', 'stres', 'depresi', 'bimbingan psikologis'
            ]
        },
        {
            kode: '160',
            nama: 'Logika & Berpikir Kritis',
            kelasUtama: '100',
            keywords: ['logika', 'logic', 'penalaran', 'berpikir kritis', 'critical thinking', 'silogisme', 'deduksi', 'induksi', 'kesesatan berpikir', 'fallacy', 'argumentasi', 'logika matematika']
        },
        {
            kode: '170',
            nama: 'Etika & Moral',
            kelasUtama: '100',
            keywords: ['etika', 'ethics', 'moral', 'akhlak budi pekerti', 'nilai moral', 'karakter', 'sopan santun', 'tata krama', 'etika profesi', 'etika sosial', 'filsafat moral', 'kebajikan', 'integritas']
        },

        // -------------------------------------------------------------
        // KELAS 200: AGAMA & TEOLOGI
        // -------------------------------------------------------------
        {
            kode: '200',
            nama: 'Agama & Teologi',
            kelasUtama: '200',
            keywords: ['agama', 'religion', 'teologi', 'kepercayaan', 'spiritual', 'ketuhanan', 'kitab suci', 'ibadah', 'doa', 'ritual', 'perbandingan agama']
        },
        {
            kode: '294.5',
            nama: 'Agama Hindu',
            kelasUtama: '200',
            keywords: ['agama hindu', 'hindu', 'weda', 'veda', 'bhagawad gita', 'bhagavad gita', 'upanishad', 'tatwa', 'susila', 'acara', 'yadnya', 'tri hita karana', 'catur asrama', 'catur purusa artha', 'karmaphala', 'reinkarnasi', 'samsara', 'moksa', 'dharma', 'brahman', 'atman', 'pura', 'upakara', 'sesajen', 'banten', 'canang', 'sloka', 'kakawin', 'pendidikan agama hindu', 'budi pekerti hindu', 'sarassamuccaya']
        },
        {
            kode: '297',
            nama: 'Agama Islam',
            kelasUtama: '200',
            keywords: ['agama islam', 'islam', 'alquran', 'al-quran', 'al qur\'an', 'hadits', 'hadis', 'fiqih', 'fiqh', 'akidah', 'aqidah', 'akhlak', 'syariat', 'sholat', 'salat', 'zakat', 'puasa', 'haji', 'tajwid', 'sejarah kebudayaan islam', 'ski', 'tafsir', 'pendidikan agama islam', 'tasawuf', 'sirah nabawiyah', 'rasulullah', 'muhammad']
        },
        {
            kode: '230',
            nama: 'Agama Kristen & Katolik',
            kelasUtama: '200',
            keywords: ['agama kristen', 'kristen', 'katolik', 'alkitab', 'injil', 'perjanjian lama', 'perjanjian baru', 'yesus', 'kristus', 'gereja', 'teologi kristen', 'sakramen', 'pendidikan agama kristen', 'pendidikan agama katolik', 'pastoral', 'kristiani']
        },
        {
            kode: '294.3',
            nama: 'Agama Buddha',
            kelasUtama: '200',
            keywords: ['agama buddha', 'buddha', 'buddhis', 'tripitaka', 'dhammapada', 'sidharta gautama', 'nirwana', 'dharma buddha', 'pendidikan agama buddha', 'meditasi buddhis', 'delapan jalan utama']
        },
        {
            kode: '299.5',
            nama: 'Agama Konghucu',
            kelasUtama: '200',
            keywords: ['agama konghucu', 'konghucu', 'khonghucu', 'confucius', 'sishu', 'wujing', 'pendidikan agama konghucu', 'yin yang', 'rujiao']
        },

        // -------------------------------------------------------------
        // KELAS 300: ILMU-ILMU SOSIAL, SOSIOLOGI, EKONOMI, POLITIK & PENDIDIKAN
        // -------------------------------------------------------------
        {
            kode: '300',
            nama: 'Ilmu-ilmu Sosial',
            kelasUtama: '300',
            keywords: ['ilmu sosial', 'social sciences', 'ips', 'masyarakat', 'interaksi sosial', 'studi sosial', 'dinamika sosial', 'pranata sosial']
        },
        {
            kode: '301',
            nama: 'Sosiologi & Antropologi',
            kelasUtama: '300',
            keywords: ['sosiologi', 'sociology', 'antropologi', 'masyarakat', 'struktur sosial', 'konflik sosial', 'integrasi sosial', 'perubahan sosial', 'globalisasi', 'stratifikasi sosial', 'kelompok sosial', 'penyimpangan sosial', 'interaksi sosial', 'kebudayaan masyarakat', 'etnografi', 'sosiologi sma']
        },
        {
            kode: '320',
            nama: 'Ilmu Politik & PKn',
            kelasUtama: '300',
            keywords: ['politik', 'ilmu politik', 'pkn', 'pendidikan pancasila', 'kewarganegaraan', 'pancasila', 'uud 1945', 'konstitusi', 'demokrasi', 'hak asasi manusia', 'ham', 'pemerintahan', 'sistem politik', 'kebijakan publik', 'pemilu', 'partai politik', 'wawasan nusantara', 'nkri', 'bhinneka tunggal ika', 'ketahanan nasional', 'otonomi daerah', 'hubungan internasional']
        },
        {
            kode: '330',
            nama: 'Ilmu Ekonomi & Bisnis',
            kelasUtama: '300',
            keywords: ['ekonomi', 'ilmu ekonomi', 'economics', 'mikroekonomi', 'makroekonomi', 'ekonomi mikro', 'ekonomi makro', 'pasar', 'permintaan', 'penawaran', 'inflasi', 'uang', 'perbankan', 'bank', 'moneter', 'fiskal', 'perpajakan', 'pajak', 'perdagangan internasional', 'koperasi', 'bumn', 'kewirausahaan', 'perekonomian indonesia', 'pertumbuhan ekonomi', 'apbn', 'manajemen ekonomi', 'ekonomi sma']
        },
        {
            kode: '340',
            nama: 'Ilmu Hukum',
            kelasUtama: '300',
            keywords: ['hukum', 'ilmu hukum', 'law', 'perundang-undangan', 'hukum perdata', 'hukum pidana', 'hukum tata negara', 'hukum acara', 'pengadilan', 'advokat', 'hak cipta', 'paten', 'kuhp', 'kuhperdata', 'keadilan', 'hukum internasional', 'yurisprudensi']
        },
        {
            kode: '370',
            nama: 'Pendidikan & Pembelajaran',
            kelasUtama: '300',
            keywords: ['pendidikan', 'education', 'pedagogi', 'pembelajaran', 'kurikulum', 'evaluasi pendidikan', 'asesmen', 'didaktik', 'metode mengajar', 'manajemen sekolah', 'keguruan', 'bimbingan konseling', 'psikologi pendidikan', 'sekolah', 'proses belajar mengajar', 'rpp', 'modul ajar', 'capaian pembelajaran']
        },
        {
            kode: '390',
            nama: 'Adat Istiadat, Budaya & Tradisi',
            kelasUtama: '300',
            keywords: ['adat istiadat', 'tradisi', 'kebudayaan', 'budaya nusantara', 'folklor', 'upacara adat', 'etika adat', 'busana adat', 'adat bali', 'budaya lokal', 'kearifan lokal']
        },

        // -------------------------------------------------------------
        // KELAS 400: BAHASA & LINGUISTIK
        // -------------------------------------------------------------
        {
            kode: '400',
            nama: 'Bahasa & Linguistik',
            kelasUtama: '400',
            keywords: ['bahasa', 'linguistik', 'ilmu bahasa', 'linguistics', 'fonologi', 'morfologi', 'sintaksis', 'semantik', 'pragmatik', 'tata bahasa', 'komunikasi verbal', 'kamus bahasa']
        },
        {
            kode: '410',
            nama: 'Bahasa Indonesia',
            kelasUtama: '400',
            keywords: ['bahasa indonesia', 'tata bahasa baku bahasa indonesia', 'tbbi', 'eyd', 'ejaan yang disempurnakan', 'puebi', 'kosakata', 'kemahiran berbahasa indonesia', 'teks deskripsi', 'teks eksposisi', 'teks eksplanasi', 'teks prosedur', 'teks narasi', 'paragraf', 'membaca intensif', 'menulis karya ilmiah', 'pidato', 'debat', 'ceramah', 'bahasa indonesia sma']
        },
        {
            kode: '420',
            nama: 'Bahasa Inggris',
            kelasUtama: '400',
            keywords: ['bahasa inggris', 'english', 'english grammar', 'vocabulary', 'tenses', 'reading comprehension', 'listening', 'speaking', 'writing english', 'toefl', 'ielts', 'conversation', 'narrative text', 'report text', 'analytical exposition', 'bahasa inggris sma']
        },
        {
            kode: '499.22',
            nama: 'Bahasa Daerah Bali & Nusantara',
            kelasUtama: '400',
            keywords: ['bahasa bali', 'basa bali', 'aksara bali', 'anggah ungguh basa bali', 'sor singgih basa', 'paribasa bali', 'peparikan', 'pupuh', 'geguritan', 'bahasa daerah', 'bahasa jawa', 'bahasa sunda']
        },
        {
            kode: '492.7',
            nama: 'Bahasa Arab',
            kelasUtama: '400',
            keywords: ['bahasa arab', 'arabic', 'nahwu', 'shorof', 'mufradat', 'qowaid', 'percakapan bahasa arab', 'tata bahasa arab']
        },
        {
            kode: '495.6',
            nama: 'Bahasa Jepang',
            kelasUtama: '400',
            keywords: ['bahasa jepang', 'japanese', 'hiragana', 'katakana', 'kanji', 'bunpou', 'nihongo', 'jlpt', 'percakapan bahasa jepang']
        },

        // -------------------------------------------------------------
        // KELAS 500: SAINS MURNI & ILMU ALAM (MATEMATIKA, FISIKA, KIMIA, BIOLOGI)
        // -------------------------------------------------------------
        {
            kode: '500',
            nama: 'Sains Murni & Alam',
            kelasUtama: '500',
            keywords: ['sains', 'ilmu alam', 'ipa', 'natural sciences', 'metode ilmiah', 'eksperimen', 'penelitian ilmiah', 'alam']
        },
        {
            kode: '510',
            nama: 'Matematika',
            kelasUtama: '500',
            keywords: ['matematika', 'mathematics', 'math', 'matematika sma', 'matematika peminatan', 'matematika wajib', 'persamaan', 'fungsi', 'pertidaksamaan', 'matriks', 'vektor', 'barisan dan deret', 'eksponen', 'logaritma', 'sistem persamaan', 'program linear', 'lingkaran', 'suku banyak', 'polinomial', 'induksi matematika']
        },
        {
            kode: '512',
            nama: 'Aljabar (Algebra)',
            kelasUtama: '500',
            keywords: ['aljabar', 'algebra', 'aljabar linear', 'aljabar linear elementer', 'matriks', 'determinan', 'invers matriks', 'vektor', 'ruang vektor', 'persamaan linear', 'sistem persamaan linear', 'struktur aljabar', 'grup', 'ring', 'field', 'howard anton']
        },
        {
            kode: '513',
            nama: 'Aritmetika & Teori Bilangan',
            kelasUtama: '500',
            keywords: ['aritmetika', 'arithmetic', 'teori bilangan', 'bilangan bulat', 'bilangan prima', 'kpk', 'fpb', 'aritmetika sosial', 'operasi hitung', 'pecahan']
        },
        {
            kode: '514',
            nama: 'Topologi',
            kelasUtama: '500',
            keywords: ['topologi', 'topology', 'ruang metrik', 'kontinuitas topologis', 'himpunan terbuka', 'himpunan tertutup', 'manifold']
        },
        {
            kode: '515',
            nama: 'Analisis (Kalkulus & Diferensial)',
            kelasUtama: '500',
            keywords: ['kalkulus', 'calculus', 'analisis matematika', 'mathematical analysis', 'analisis real', 'analisis kompleks', 'limit fungsi', 'turunan', 'diferensial', 'integral', 'integral tentu', 'integral tak tentu', 'persamaan diferensial', 'persamaan diferensial parsial', 'deret taylor', 'deret fourier', 'kalkulus multivariat', 'kalkulus lanjut', 'kalkulus integral', 'kalkulus diferensial', 'purcell', 'stewart', 'varberg']
        },
        {
            kode: '516',
            nama: 'Geometri & Trigonometri',
            kelasUtama: '500',
            keywords: ['geometri', 'geometry', 'trigonometri', 'trigonometry', 'dimensi tiga', 'geometri analitik', 'bangun ruang', 'bangun datar', 'sinus', 'cosinus', 'tangen', 'sudut', 'transformasi geometri', 'rotasi', 'translasi', 'refleksi', 'dilatasi', 'geometri euklides']
        },
        {
            kode: '518',
            nama: 'Analisis Numerik & Komputasi',
            kelasUtama: '500',
            keywords: ['metode numerik', 'analisis numerik', 'komputasi matematika', 'interpolasi', 'aproksimasi', 'optimasi numerik', 'algoritma numerik']
        },
        {
            kode: '519',
            nama: 'Probabilitas & Statistika',
            kelasUtama: '500',
            keywords: ['statistika', 'statistics', 'probabilitas', 'peluang', 'kombinatorika', 'permutasi', 'kombinasi', 'distribusi normal', 'regresi', 'korelasi', 'hipotesis', 'uji t', 'anova', 'analisis data statistik', 'pengolahan data', 'statistika sma', 'populasi dan sampel', 'metode statistika', 'sugiyono']
        },
        {
            kode: '520',
            nama: 'Astronomi & Tata Surya',
            kelasUtama: '500',
            keywords: ['astronomi', 'astronomy', 'tata surya', 'bintang', 'planet', 'galaksi', 'alam semesta', 'kosmologi', 'teleskop', 'gerhana', 'bumi dan antariksa', 'astrofisika', 'gravitasi universal']
        },
        {
            kode: '530',
            nama: 'Fisika',
            kelasUtama: '500',
            keywords: ['fisika', 'physics', 'fisika sma', 'mekanika', 'vektor fisika', 'gerak lurus', 'gerak melingkar', 'hukum newton', 'usaha dan energi', 'momentum dan impuls', 'dinamika gerak', 'fluida statis', 'fluida dinamis', 'suhu dan kalor', 'termodinamika', 'gelombang mekanik', 'gelombang bunyi', 'gelombang cahaya', 'optik', 'listrik statis', 'listrik dinamis', 'medan magnet', 'induksi elektromagnetik', 'fisika modern', 'relativitas', 'kuantum', 'fisika inti', 'radioaktivitas', 'halliday', 'resnick', 'tipler', 'serway']
        },
        {
            kode: '531',
            nama: 'Mekanika Klasik',
            kelasUtama: '500',
            keywords: ['mekanika', 'mekanika klasik', 'kinematika', 'dinamika gerak', 'gaya', 'hukum newton', 'gravitasi', 'momen inersia', 'torsi', 'kesetimbangan benda tegar', 'elastisitas', 'hukum hooke']
        },
        {
            kode: '537',
            nama: 'Kelistrikan & Magnetisme',
            kelasUtama: '500',
            keywords: ['listrik', 'kelistrikan', 'elektromagnetisme', 'magnet', 'medan magnet', 'arus listrik', 'hukum ohm', 'hukum kirchhoff', 'kapasitor', 'induktor', 'rangkaian rlc', 'gelombang elektromagnetik']
        },
        {
            kode: '540',
            nama: 'Kimia',
            kelasUtama: '500',
            keywords: ['kimia', 'chemistry', 'kimia sma', 'struktur atom', 'tabel periodik', 'ikatan kimia', 'stoikiometri', 'larutan elektrolit', 'reaksi redoks', 'termokimia', 'laju reaksi', 'kesetimbangan kimia', 'asam basa', 'larutan penyangga', 'buffer', 'hidrolisis garam', 'kelarutan ksp', 'sifat koligatif larutan', 'redoks dan elektrokimia', 'kimia unsur', 'senyawa hidrokarbon', 'minyak bumi', 'kimia organik', 'polimer', 'makromolekul', 'biokimia', 'chang', 'petrucci']
        },
        {
            kode: '541',
            nama: 'Kimia Fisik & Teoretis',
            kelasUtama: '500',
            keywords: ['kimia fisik', 'termokimia', 'termodinamika kimia', 'kinetika kimia', 'elektrokimia', 'keadaan materi', 'kimia kuantum']
        },
        {
            kode: '547',
            nama: 'Kimia Organik',
            kelasUtama: '500',
            keywords: ['kimia organik', 'hidrokarbon', 'alkana', 'alkena', 'alkuna', 'alkohol', 'eter', 'aldehid', 'keton', 'asam karboksilat', 'ester', 'benzena', 'senyawa karbon', 'reaksi organik', 'fessenden']
        },
        {
            kode: '570',
            nama: 'Biologi',
            kelasUtama: '500',
            keywords: ['biologi', 'biology', 'biologi sma', 'sel', 'struktur sel', 'jaringan tumbuhan', 'jaringan hewan', 'sistem organ', 'sistem gerak', 'sistem peredaran darah', 'sistem pencernaan', 'sistem pernapasan', 'sistem ekskresi', 'sistem koordinasi', 'sistem saraf', 'sistem hormon', 'sistem reproduksi', 'sistem imun', 'metabolisme', 'enzim', 'katabolisme', 'anabolisme', 'fotosintesis', 'respirasi sel', 'keanekaragaman hayati', 'biodiversitas', 'virus', 'bakteri', 'monera', 'protista', 'fungi', 'jamur', 'plantae', 'animalia', 'ekologi', 'ekosistem', 'evolusi', 'bioteknologi', 'campbell', 'reece']
        },
        {
            kode: '576',
            nama: 'Genetika & Biologi Molekuler',
            kelasUtama: '500',
            keywords: ['genetika', 'genetics', 'dna', 'rna', 'kromosom', 'gen', 'sintesis protein', 'pembelahan sel', 'mitosis', 'meiosis', 'hukum mendel', 'penyimpangan semu mendel', 'pola hereditas', 'mutasi gen', 'rekayasa genetika', 'biologi molekuler']
        },
        {
            kode: '577',
            nama: 'Ekologi & Lingkungan Hidup',
            kelasUtama: '500',
            keywords: ['ekologi', 'lingkungan hidup', 'ekosistem', 'rantai makanan', 'daur biogeokimia', 'pencemaran lingkungan', 'perubahan iklim', 'pemanasan global', 'konservasi alam', 'keanekaragaman hayati', 'amdal', 'kelestarian alam', 'adiwiyata', 'lingkungan']
        },

        // -------------------------------------------------------------
        // KELAS 600: TEKNOLOGI & ILMU TERAPAN
        // -------------------------------------------------------------
        {
            kode: '600',
            nama: 'Teknologi & Terapan',
            kelasUtama: '600',
            keywords: ['teknologi', 'terapan', 'applied sciences', 'rekayasa', 'industri', 'inovasi teknologi']
        },
        {
            kode: '610',
            nama: 'Kedokteran & Ilmu Kesehatan',
            kelasUtama: '600',
            keywords: ['kedokteran', 'kesehatan', 'medicine', 'health', 'anatomi', 'fisiologi manusia', 'gizi', 'nutrisi', 'penyakit', 'farmasi', 'obat-obatan', 'p3k', 'kebersihan diri', 'kesehatan reproduksi', 'kesehatan mental', 'keperawatan', 'patologi']
        },
        {
            kode: '620',
            nama: 'Teknik & Rekayasa',
            kelasUtama: '600',
            keywords: ['teknik', 'engineering', 'rekayasa', 'teknik mesin', 'teknik elektro', 'teknik sipil', 'elektronika', 'robotika', 'otomotif', 'mekanika teknik', 'listrik arus kuat', 'rangkaian listrik', 'mikrokontroler', 'arduino', 'sensor', 'konstruksi']
        },
        {
            kode: '630',
            nama: 'Pertanian & Agroteknologi',
            kelasUtama: '600',
            keywords: ['pertanian', 'agrikultur', 'agriculture', 'bercocok tanam', 'agroteknologi', 'hidroponik', 'hortikultura', 'tanaman hias', 'pupuk', 'hama', 'peternakan', 'budidaya perikanan', 'agribisnis', 'kehutanan']
        },
        {
            kode: '640',
            nama: 'Tata Boga & Kesejahteraan Keluarga',
            kelasUtama: '600',
            keywords: ['tata boga', 'kuliner', 'memasak', 'resep masakan', 'kue dan roti', 'pastry', 'tata busana', 'menjahit', 'pkk', 'kesejahteraan keluarga', 'manajemen rumah tangga', 'gizi keluarga', 'prakarya tata boga']
        },
        {
            kode: '650',
            nama: 'Manajemen, Akuntansi & Bisnis',
            kelasUtama: '600',
            keywords: ['akuntansi', 'accounting', 'manajemen', 'management', 'pembukuan', 'laporan keuangan', 'jurnal umum', 'buku besar', 'neraca saldo', 'pemasaran', 'marketing', 'digital marketing', 'administrasi perkantoran', 'kewirausahaan', 'pkwu', 'bisnis digital', 'periklanan', 'organisasi bisnis', 'kepemimpinan', 'philip kotler', 'peter drucker']
        },

        // -------------------------------------------------------------
        // KELAS 700: KESENIAN, REKREASI & OLAHRAGA
        // -------------------------------------------------------------
        {
            kode: '700',
            nama: 'Kesenian & Olahraga',
            kelasUtama: '700',
            keywords: ['kesenian', 'seni', 'art', 'budaya seni', 'rekreasi', 'hiburan']
        },
        {
            kode: '740',
            nama: 'Seni Rupa, Desain & Gambar',
            kelasUtama: '700',
            keywords: ['seni rupa', 'menggambar', 'melukis', 'desain grafis', 'desain komunikasi visual', 'dkv', 'ilustrasi', 'komik', 'animasi', 'kriya', 'pahat', 'patung', 'kerajinan tangan', 'prakarya', 'batik', 'ornamen', 'seni lukis', 'nirmana', 'tipografi']
        },
        {
            kode: '780',
            nama: 'Seni Musik',
            kelasUtama: '700',
            keywords: ['seni musik', 'musik', 'music', 'notasi balok', 'notasi angka', 'tangga nada', 'harmoni', 'vokal', 'paduan suara', 'gitar', 'piano', 'keyboard', 'gamelan', 'musik tradisional', 'seni tari', 'tari bali', 'tari nusantara', 'koreografi', 'seni teater', 'drama seni']
        },
        {
            kode: '796',
            nama: 'Olahraga & Pendidikan Jasmani (PJOK)',
            kelasUtama: '700',
            keywords: ['olahraga', 'pjok', 'pendidikan jasmani', 'penjaskes', 'sepak bola', 'futsal', 'bola voli', 'bola basket', 'bulu tangkis', 'badminton', 'atletik', 'lari', 'lompat jauh', 'tolak peluru', 'renang', 'senam lantai', 'kebugaran jasmani', 'pencak silat', 'karate', 'taekwondo', 'bela diri', 'kesehatan jasmani', 'taktik olahraga']
        },

        // -------------------------------------------------------------
        // KELAS 800: KESUSASTRAAN / SASTRA
        // -------------------------------------------------------------
        {
            kode: '800',
            nama: 'Kesusastraan / Sastra',
            kelasUtama: '800',
            keywords: ['sastra', 'literature', 'kesusastraan', 'teori sastra', 'apresiasi sastra', 'kritik sastra', 'karya sastra', 'antologi', 'stilistika', 'majas', 'retorika', 'menulis kreatif']
        },
        {
            kode: '810',
            nama: 'Sastra Indonesia',
            kelasUtama: '800',
            keywords: ['sastra indonesia', 'puisi', 'antologi puisi', 'pantun', 'syair', 'prosa', 'cerpen', 'cerita pendek', 'kumpulan cerpen', 'novel indonesia', 'drama indonesia', 'naskah drama', 'roman', 'angkatan balai pustaka', 'pujangga baru', 'angkatan 45', 'sastrawan indonesia', 'sapardi djoko damono', 'hujan bulan juni', 'chairil anwar', 'aku', 'kerikil tajam', 'ws rendra', 'taufiq ismail']
        },
        {
            kode: '813',
            nama: 'Fiksi Indonesia (Novel & Cerpen)',
            kelasUtama: '800',
            keywords: [
                'novel', 'fiksi', 'fiction', 'cerpen', 'cerita pendek', 'cerita fiksi', 'novel remaja', 'teenlit', 'chicklit',
                'cerita fantasi', 'dongeng', 'cerita rakyat', 'fabel', 'legenda', 'mitos nusantara', 'laskar pelangi', 'sang pemimpi',
                'edensor', 'maryamah karpov', 'andrea hirata', 'bumi manusia', 'anak semua bangsa', 'jejak langkah', 'rumah kaca',
                'pramoedya ananta toer', 'pram', 'hujan', 'bumi', 'bulan', 'matahari', 'bintang', 'komet', 'selena', 'nebula',
                'si anak kuat', 'rindu', 'pulang', 'pergi', 'tentang kamu', 'tere liye', 'supernova', 'perahu kertas', 'filosofi kopi',
                'aroma karsa', 'rapijali', 'dee lestari', 'dewi lestari', 'cantik itu luka', 'lelaki harimau', 'eka kurniawan',
                'ronggeng dukuh paruk', 'ahmad tohari', 'ayat ayat cinta', 'habiburrahman el shirazy', 'tenggelamnya kapal van der wijck',
                'hamka', 'negeri 5 menara', 'ahmad fuadi', 'dilan 1990', 'pidi baiq', 'laut bercerita', 'leila s chudori',
                'garis waktu', 'fiersa besari', 'raditya dika', 'kambing jantan', 'fiksi indonesia'
            ]
        },
        {
            kode: '820',
            nama: 'Sastra Asing (Inggris & Terjemahan)',
            kelasUtama: '800',
            keywords: ['sastra inggris', 'english literature', 'novel terjemahan', 'shakespeare', 'sastra barat', 'sastra dunia', 'world literature', 'classic novel', 'harry potter', 'jk rowling', 'sherlock holmes', 'arthur conan doyle', 'agatha christie', 'lord of the rings', 'tolkien']
        },

        // -------------------------------------------------------------
        // KELAS 900: SEJARAH, GEOGRAFI & BIOGRAFI
        // -------------------------------------------------------------
        {
            kode: '900',
            nama: 'Sejarah & Geografi',
            kelasUtama: '900',
            keywords: ['sejarah', 'history', 'geografi', 'peradaban', 'arkeologi', 'peristiwa masa lalu', 'sumber sejarah', 'historiografi']
        },
        {
            kode: '910',
            nama: 'Geografi & Peta',
            kelasUtama: '900',
            keywords: ['geografi', 'geography', 'geografi sma', 'peta', 'atlas', 'kartografi', 'penginderaan jauh', 'sistem informasi geografis', 'sig', 'gis', 'litosfer', 'atmosfer', 'hidrosfer', 'biosfer', 'antrosfer', 'iklim dan cuaca', 'bencana alam', 'gempa bumi', 'gunung api', 'demografi', 'kependudukan', 'wilayah dan tata ruang', 'negara maju', 'negara berkembang', 'geosfer']
        },
        {
            kode: '920',
            nama: 'Biografi & Otobiografi Tokoh',
            kelasUtama: '900',
            keywords: ['biografi', 'otobiografi', 'autobiography', 'kisah hidup', 'riwayat hidup', 'memoar', 'tokoh pahlawan', 'biografi soekarno', 'biografi hatta', 'biografi habibie', 'biografi kartini', 'kisah sukses tokoh', 'profil tokoh inspiratif']
        },
        {
            kode: '959.8',
            nama: 'Sejarah Indonesia',
            kelasUtama: '900',
            keywords: ['sejarah indonesia', 'sejarah indonesia sma', 'praaksara', 'kerajaan hindu buddha', 'kerajaan islam', 'kutai', 'tarumanegara', 'sriwijaya', 'majapahit', 'mataram', 'masa kolonial', 'penjajahan belanda', 'voc', 'penjajahan jepang', 'pergerakan nasional', 'budi utomo', 'sumpah pemuda', 'proklamasi kemerdekaan', 'revolusi fisik', 'orde lama', 'orde baru', 'reformasi', 'sejarah nasional', 'perjuangan kemerdekaan', 'sejarah bali', 'sartono kartodirdjo']
        },
        {
            kode: '909',
            nama: 'Sejarah Dunia & Peradaban',
            kelasUtama: '900',
            keywords: ['sejarah dunia', 'world history', 'peradaban kuno', 'mesopotamia', 'mesir kuno', 'yunani kuno', 'romawi', 'renaissance', 'revolusi industri', 'revolusi perancis', 'perang dunia 1', 'perang dunia 2', 'perang dingin', 'pbb', 'peradaban dunia']
        }
    ];

    // Pre-calculate normalized token sets and multi-word phrase arrays for high-speed matching
    DDC_ONTOLOGY.forEach(item => {
        item.cleanTokens = new Set();
        item.bigrams = new Set();
        item.phrases = [];

        item.keywords.forEach(kw => {
            const cleanKw = kw.toLowerCase().trim();
            item.phrases.push(cleanKw);
            const words = cleanKw.split(/\s+/);
            if (words.length === 1) {
                item.cleanTokens.add(words[0]);
            } else {
                words.forEach(w => item.cleanTokens.add(w));
                for (let i = 0; i < words.length - 1; i++) {
                    item.bigrams.add(`${words[i]} ${words[i + 1]}`);
                }
            }
        });
    });

    // 4. NLP TOKENIZER, NORMALIZER & STEM EXTRACTOR
    function tokenizeAndClean(text) {
        if (!text || typeof text !== 'string') return { rawString: '', tokens: [], stems: [], bigrams: [] };

        // Normalize text: lowercase, strip punctuation
        const cleanText = text.toLowerCase()
            .replace(/[^\w\s\-\.]/g, ' ')
            .replace(/[\-\.]+/g, ' ')
            .trim();

        const words = cleanText.split(/\s+/).filter(w => w.length > 1);

        // Filter out stopwords
        const filteredTokens = words.filter(w => !STOPWORDS.has(w));

        // Extract Indonesian morphological stems
        const stems = new Set();
        words.forEach(w => {
            stemIndonesian(w).forEach(st => {
                if (!STOPWORDS.has(st) && st.length > 1) stems.add(st);
            });
        });

        // Generate bigrams
        const bigrams = [];
        for (let i = 0; i < words.length - 1; i++) {
            bigrams.push(`${words[i]} ${words[i + 1]}`);
        }

        return { rawString: cleanText, tokens: filteredTokens, stems: [...stems], bigrams };
    }

    // 5. CORE SCORING & CLASSIFICATION ENGINE
    function classifyBookDDC(title, author = '', publisher = '', subject = '') {
        if (!title || !title.trim()) return [];

        const titleData = tokenizeAndClean(title);
        const authorData = tokenizeAndClean(author);
        const publisherData = tokenizeAndClean(publisher);
        const subjectData = tokenizeAndClean(subject);

        const allBigrams = [...titleData.bigrams, ...subjectData.bigrams];
        const results = [];

        DDC_ONTOLOGY.forEach(cat => {
            let score = 0;
            const matchedTerms = [];

            // A. Direct Multi-word Phrase Matching in Title / Subject (Weight: 35)
            cat.phrases.forEach(phrase => {
                if (phrase.includes(' ')) {
                    if (titleData.rawString.includes(phrase)) {
                        score += 35;
                        matchedTerms.push(`Frasa: "${phrase}"`);
                    } else if (subjectData.rawString && subjectData.rawString.includes(phrase)) {
                        score += 25;
                        matchedTerms.push(`Frasa: "${phrase}"`);
                    }
                }
            });

            // B. Bigram Matching (Weight: 20)
            allBigrams.forEach(bg => {
                if (cat.bigrams.has(bg)) {
                    score += 20;
                    matchedTerms.push(bg);
                }
            });

            // C. Title Unigrams & Root Stems
            titleData.tokens.forEach(tok => {
                if (cat.cleanTokens.has(tok)) {
                    score += 12;
                    matchedTerms.push(tok);
                }
            });

            titleData.stems.forEach(st => {
                if (cat.cleanTokens.has(st) && !matchedTerms.includes(st)) {
                    score += 8;
                    matchedTerms.push(`akar: ${st}`);
                }
            });

            // D. Subject Clues
            subjectData.tokens.forEach(tok => {
                if (cat.cleanTokens.has(tok)) {
                    score += 8;
                    matchedTerms.push(tok);
                }
            });

            // E. Author & Publisher Clues
            authorData.tokens.forEach(tok => {
                if (cat.cleanTokens.has(tok)) {
                    score += 15; // High relevance for author match (e.g. "Mark Manson", "Purcell", "Campbell")
                    matchedTerms.push(`Penulis: ${tok}`);
                }
            });

            publisherData.tokens.forEach(tok => {
                if (cat.cleanTokens.has(tok)) {
                    score += 4;
                }
            });

            // F. Specificity Boost for granular sub-codes
            if (score > 0) {
                if (cat.kode.length >= 3 && !cat.kode.endsWith('00')) {
                    score += 4;
                }
                if (cat.kode.includes('.')) {
                    score += 5;
                }

                results.push({
                    kode: cat.kode,
                    nama: cat.nama,
                    kelasUtama: cat.kelasUtama,
                    rawScore: score,
                    matchedTerms: [...new Set(matchedTerms)]
                });
            }
        });

        if (results.length === 0) {
            return [];
        }

        // Sort descending by raw score
        results.sort((a, b) => b.rawScore - a.rawScore);

        // Normalize confidence scores (0% to 98%)
        const maxScore = results[0].rawScore;
        const topResults = results.slice(0, 3).map((res, index) => {
            let confidence;
            if (index === 0) {
                confidence = Math.min(98, Math.max(60, Math.round((res.rawScore / (res.rawScore + 8)) * 100)));
            } else {
                const ratio = res.rawScore / maxScore;
                confidence = Math.min(88, Math.max(35, Math.round(ratio * 80)));
            }

            return {
                kode: res.kode,
                nama: res.nama,
                confidence: confidence,
                reason: res.matchedTerms.slice(0, 3).join(', ') || 'Kecocokan Semantik'
            };
        });

        return topResults;
    }

    // 6. INTERNATIONAL SUBJECT / CATEGORY TO INDONESIAN DDC MAPPER
    const GLOBAL_CATEGORY_MAP = [
        // Fiction & Literature
        // Pola yang spesifik harus didahulukan agar "English literature" tidak
        // tertangkap oleh pola umum "literature" di bawahnya.
        { pattern: /foreign literature|english literature|american literature|world literature|translated fiction|novel terjemahan/i, ddc: '820', name: 'Sastra Asing (Inggris & Terjemahan)' },
        { pattern: /fiction|novel|short stories|cerpen|juvenile fiction|young adult fiction|literature|fiksi/i, ddc: '813', name: 'Fiksi Indonesia (Novel & Cerpen)' },
        { pattern: /poetry|puisi|poems|pantun/i, ddc: '810', name: 'Sastra Indonesia' },
        { pattern: /drama|plays|teater/i, ddc: '810', name: 'Sastra Indonesia' },

        // Psychology & Self-Help
        { pattern: /self-help|self help|personal growth|success|motivation|mindset|habits|happiness|emotional intelligence|counseling/i, ddc: '150', name: 'Psikologi Umum & Pengembangan Diri' },
        { pattern: /psychology|mental health|behavioral|personality|kejiwaan|psikologi/i, ddc: '150', name: 'Psikologi Umum & Pengembangan Diri' },
        { pattern: /philosophy|ethics|moral|filsafat|stoicism|logic/i, ddc: '100', name: 'Filsafat & Psikologi' },

        // Religion
        { pattern: /hindu|hinduism|veda|upanishad|gita/i, ddc: '294.5', name: 'Agama Hindu' },
        { pattern: /islam|islamic|quran|hadith|hadis|fiqh|sharia/i, ddc: '297', name: 'Agama Islam' },
        { pattern: /christian|christianity|bible|church|katolik|kristen/i, ddc: '230', name: 'Agama Kristen & Katolik' },
        { pattern: /buddh|buddhism|dharma|tripitaka/i, ddc: '294.3', name: 'Agama Buddha' },
        { pattern: /confucian|konghucu|khonghucu/i, ddc: '299.5', name: 'Agama Konghucu' },
        { pattern: /religion|theology|spiritual/i, ddc: '200', name: 'Agama & Teologi' },

        // Mathematics & Natural Sciences
        { pattern: /calculus|kalkulus|differential|integral|mathematical analysis/i, ddc: '515', name: 'Analisis (Kalkulus & Diferensial)' },
        { pattern: /algebra|aljabar|matrix|matrices|linear algebra/i, ddc: '512', name: 'Aljabar (Algebra)' },
        { pattern: /geometry|trigonometry|geometri/i, ddc: '516', name: 'Geometri & Trigonometri' },
        { pattern: /statistic|probabilit|peluang|statistika/i, ddc: '519', name: 'Probabilitas & Statistika' },
        { pattern: /arithmetic|aritmetika|number theory/i, ddc: '513', name: 'Aritmetika & Teori Bilangan' },
        { pattern: /mathematics|matematika|math/i, ddc: '510', name: 'Matematika' },
        { pattern: /astronomy|space|universe|galaxy|tata surya/i, ddc: '520', name: 'Astronomi & Tata Surya' },
        { pattern: /physics|fisika|mechanics|quantum|thermodynamics/i, ddc: '530', name: 'Fisika' },
        { pattern: /organic chemistry|kimia organik/i, ddc: '547', name: 'Kimia Organik' },
        { pattern: /chemistry|kimia/i, ddc: '540', name: 'Kimia' },
        { pattern: /genetics|molecular biology|dna|rna/i, ddc: '576', name: 'Genetika & Biologi Molekuler' },
        { pattern: /ecology|environment|lingkungan hidup/i, ddc: '577', name: 'Ekologi & Lingkungan Hidup' },
        { pattern: /biology|life sciences|biologi|zoology|botany/i, ddc: '570', name: 'Biologi' },
        { pattern: /science|ipa|sains/i, ddc: '500', name: 'Sains Murni & Alam' },

        // Computers & IT
        { pattern: /computer|programming|coding|algorithm|software|informatics|informatika|artificial intelligence|data science|cyber/i, ddc: '004', name: 'Ilmu Komputer & TI' },

        // Social Sciences, Law, Politics, Economics
        { pattern: /sociology|sosiologi|anthropology|antropologi|social/i, ddc: '301', name: 'Sosiologi & Antropologi' },
        { pattern: /politics|political|government|civics|pkn|pancasila|democracy/i, ddc: '320', name: 'Ilmu Politik & PKn' },
        { pattern: /economics|economy|finance|banking|ekonomi|keuangan/i, ddc: '330', name: 'Ilmu Ekonomi & Bisnis' },
        { pattern: /law|legal|hukum|justice|court/i, ddc: '340', name: 'Ilmu Hukum' },
        { pattern: /education|teaching|pedagogy|pendidikan|curriculum|school/i, ddc: '370', name: 'Pendidikan & Pembelajaran' },
        { pattern: /culture|tradition|folklore|adat|budaya/i, ddc: '390', name: 'Adat Istiadat, Budaya & Tradisi' },

        // Languages
        { pattern: /indonesian language|bahasa indonesia/i, ddc: '410', name: 'Bahasa Indonesia' },
        { pattern: /english language|bahasa inggris/i, ddc: '420', name: 'Bahasa Inggris' },
        { pattern: /language|linguistics|bahasa/i, ddc: '400', name: 'Bahasa & Linguistik' },

        // Applied Sciences, Health, Business
        { pattern: /medicine|medical|health|nutrition|kesehatan|kedokteran|anatomy/i, ddc: '610', name: 'Kedokteran & Ilmu Kesehatan' },
        { pattern: /engineering|technology|teknik|robotics|electronics/i, ddc: '620', name: 'Teknik & Rekayasa' },
        { pattern: /agriculture|farming|pertanian|horticulture/i, ddc: '630', name: 'Pertanian & Agroteknologi' },
        { pattern: /cooking|culinary|food|tata boga|resep/i, ddc: '640', name: 'Tata Boga & Kesejahteraan Keluarga' },
        { pattern: /business|management|accounting|marketing|akuntansi|manajemen|pemasaran|entrepreneurship/i, ddc: '650', name: 'Manajemen, Akuntansi & Bisnis' },

        // Arts & Sports
        { pattern: /art|drawing|painting|design|desain|seni rupa|dkv|craft/i, ddc: '740', name: 'Seni Rupa, Desain & Gambar' },
        { pattern: /music|song|musik|vocal|tari|dance/i, ddc: '780', name: 'Seni Musik' },
        { pattern: /sports|games|physical education|olahraga|pjok|football|fitness/i, ddc: '796', name: 'Olahraga & Pendidikan Jasmani (PJOK)' },

        // History & Geography
        { pattern: /indonesian history|sejarah indonesia|history of indonesia/i, ddc: '959.8', name: 'Sejarah Indonesia' },
        { pattern: /biography|autobiography|memoir|biografi/i, ddc: '920', name: 'Biografi & Otobiografi Tokoh' },
        { pattern: /geography|maps|atlas|geografi|gis/i, ddc: '910', name: 'Geografi & Peta' },
        { pattern: /history|world history|sejarah|civilization/i, ddc: '900', name: 'Sejarah & Geografi' }
    ];

    function mapCategoriesToDDC(categories = [], title = '', description = '') {
        const textToMatch = [...categories, title, description].join(' ');
        for (const item of GLOBAL_CATEGORY_MAP) {
            if (item.pattern.test(textToMatch)) {
                return { kode: item.ddc, nama: item.name };
            }
        }
        return null;
    }

    // 7. ONLINE AUTO-LOOKUP ENGINE (OPEN LIBRARY & GOOGLE BOOKS)
    let isGoogleBooksRateLimited = false;
    let gBooksRateLimitResetTimer = null;

    async function lookupOnlineBook(query, type = 'auto') {
        if (!query || !query.trim()) return null;
        const cleanQuery = query.trim();

        const isISBN = /^(97(8|9))?\d{9}(\d|X)$/i.test(cleanQuery.replace(/[-\s]/g, ''));
        const rawIsbn = cleanQuery.replace(/[-\s]/g, '');

        // 1. OPEN LIBRARY API (100% Free, No Rate Limit, CORS Enabled)
        try {
            const olUrl = isISBN || type === 'isbn'
                ? `https://openlibrary.org/search.json?isbn=${encodeURIComponent(rawIsbn)}&limit=3`
                : `https://openlibrary.org/search.json?q=${encodeURIComponent(cleanQuery)}&limit=3`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4500);

            const resp = await fetch(olUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (resp.ok) {
                const data = await resp.json();
                if (data.docs && data.docs.length > 0) {
                    const doc = data.docs[0];
                    const authors = doc.author_name || [];
                    const primaryAuthor = authors[0] || '';
                    const secondaryAuthor = authors.slice(1).join(', ');
                    const subjects = doc.subject || [];

                    let mappedDDC = mapCategoriesToDDC(subjects, doc.title || cleanQuery, '');
                    if (!mappedDDC) {
                        const nlpRes = classifyBookDDC(doc.title || cleanQuery, primaryAuthor, (doc.publisher && doc.publisher[0]) || '', subjects.join(' '));
                        if (nlpRes && nlpRes.length > 0) {
                            mappedDDC = { kode: nlpRes[0].kode, nama: nlpRes[0].nama };
                        }
                    }

                    let coverUrl = '';
                    if (doc.cover_i) {
                        coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
                    }

                    return {
                        found: true,
                        source: 'Open Library',
                        judul: doc.title || cleanQuery,
                        pengarang: primaryAuthor,
                        pengarangTambahan: secondaryAuthor,
                        penerbit: (doc.publisher && doc.publisher[0]) || '',
                        tahunTerbit: doc.first_publish_year ? String(doc.first_publish_year) : '',
                        isbn: (doc.isbn && doc.isbn[0]) || (isISBN ? rawIsbn : ''),
                        coverUrl: coverUrl,
                        categories: subjects.slice(0, 5),
                        ddc: mappedDDC
                    };
                }
            }
        } catch (eOl) {
            // Open Library failed or timed out
        }

        // 2. GOOGLE BOOKS API (Secondary, with 429 Rate Limit Circuit Breaker)
        if (!isGoogleBooksRateLimited) {
            try {
                const gBooksUrl = isISBN || type === 'isbn'
                    ? `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(rawIsbn)}&maxResults=3`
                    : `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(cleanQuery)}&maxResults=3`;

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4000);

                const resp = await fetch(gBooksUrl, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (resp.status === 429) {
                    // Activate circuit breaker for 5 minutes
                    isGoogleBooksRateLimited = true;
                    clearTimeout(gBooksRateLimitResetTimer);
                    gBooksRateLimitResetTimer = setTimeout(() => {
                        isGoogleBooksRateLimited = false;
                    }, 5 * 60 * 1000);
                } else if (resp.ok) {
                    const data = await resp.json();
                    if (data.items && data.items.length > 0) {
                        const item = data.items[0];
                        const info = item.volumeInfo || {};

                        const authors = info.authors || [];
                        const primaryAuthor = authors[0] || '';
                        const secondaryAuthor = authors.slice(1).join(', ');

                        let isbn13 = '';
                        let isbn10 = '';
                        (info.industryIdentifiers || []).forEach(idObj => {
                            if (idObj.type === 'ISBN_13') isbn13 = idObj.identifier;
                            if (idObj.type === 'ISBN_10') isbn10 = idObj.identifier;
                        });
                        const finalIsbn = isbn13 || isbn10 || (isISBN ? rawIsbn : '');

                        let pubYear = '';
                        if (info.publishedDate) {
                            pubYear = info.publishedDate.substring(0, 4);
                        }

                        const categories = info.categories || [];
                        let mappedDDC = mapCategoriesToDDC(categories, info.title || cleanQuery, info.description || '');

                        if (!mappedDDC) {
                            const nlpRes = classifyBookDDC(info.title || cleanQuery, primaryAuthor, info.publisher || '', categories.join(' '));
                            if (nlpRes && nlpRes.length > 0) {
                                mappedDDC = { kode: nlpRes[0].kode, nama: nlpRes[0].nama };
                            }
                        }

                        let coverUrl = '';
                        if (info.imageLinks) {
                            coverUrl = info.imageLinks.thumbnail || info.imageLinks.smallThumbnail || '';
                            if (coverUrl.startsWith('http://')) coverUrl = coverUrl.replace('http://', 'https://');
                        }

                        return {
                            found: true,
                            source: 'Google Books',
                            judul: info.title || cleanQuery,
                            pengarang: primaryAuthor,
                            pengarangTambahan: secondaryAuthor,
                            penerbit: info.publisher || '',
                            tahunTerbit: pubYear,
                            isbn: finalIsbn,
                            coverUrl: coverUrl,
                            categories: categories,
                            ddc: mappedDDC,
                            description: info.description || '',
                            pageCount: info.pageCount || null
                        };
                    }
                }
            } catch (eGb) {
                // Silently handle Google Books fetch error
            }
        }

        return { found: false, source: 'None' };
    }

    // 8. HELPER: LOOKUP DDC DETAILS
    function getDDCDetails(code) {
        if (!code) return null;
        return DDC_ONTOLOGY.find(d => d.kode === String(code)) || null;
    }

    // Expose to global window scope
    window.SmartDDC = {
        classify: classifyBookDDC,
        lookupOnline: lookupOnlineBook,
        mapCategoriesToDDC: mapCategoriesToDDC,
        getDetails: getDDCDetails,
        ontology: DDC_ONTOLOGY
    };

    console.log('[SmartDDC] NLP & Online Auto-Lookup Engine initialized (Google Books + Open Library + Hybrid NLP).');
})();
