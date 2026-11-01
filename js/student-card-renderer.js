/**
 * js/student-card-renderer.js
 * Single Source of Truth (SSOT) untuk Desain, Bentuk, dan Konten
 * Kartu Pelajar Standar ISO/IEC 7810 ID-1 (CR-80: 85.60mm x 53.98mm).
 * 
 * Digunakan secara terpadu oleh:
 * 1. Halaman Master Siswa (siswa.html / js/page-students.js)
 * 2. Halaman Wali Kelas (wali-kelas.html / js/page-wali-kelas.js)
 * 3. Portal Siswa (portal-siswa.html / js/page-portal-siswa.js)
 */

import { SCHOOL_CONFIG, schoolAssetUrl } from './school-config.js';

// Token QR kartu (public token / kts_) selalu diterbitkan server. Kunci token sengaja tidak ada di browser.

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Helper: Standarisasi Format Tanggal Lahir Indonesia Formal (DD MMMM YYYY)
 * @param {string|number|Date} dateVal 
 * @returns {string}
 */
export function formatBirthDateIndo(dateVal) {
    if (!dateVal) return '';
    const str = String(dateVal).trim();
    if (!str) return '';

    // Jika sudah berupa format teks Indonesia resmi (misal: "15 Mei 2008" atau "05 Agustus 2007")
    if (/^\d{1,2}\s+[A-Za-z]+\s+\d{4}$/.test(str)) {
        const parts = str.split(/\s+/);
        const day = parts[0].padStart(2, '0');
        const month = parts[1].charAt(0).toUpperCase() + parts[1].slice(1).toLowerCase();
        return `${day} ${month} ${parts[2]}`;
    }

    const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];

    // Deteksi pola ISO YYYY-MM-DD atau YYYY/MM/DD
    const mIso = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (mIso) {
        const day = String(parseInt(mIso[3], 10)).padStart(2, '0');
        const mIdx = parseInt(mIso[2], 10) - 1;
        const year = mIso[1];
        if (mIdx >= 0 && mIdx < 12) return `${day} ${months[mIdx]} ${year}`;
    }

    // Deteksi pola DD-MM-YYYY atau DD/MM/YYYY
    const mDmy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (mDmy) {
        const day = String(parseInt(mDmy[1], 10)).padStart(2, '0');
        const mIdx = parseInt(mDmy[2], 10) - 1;
        const year = mDmy[3];
        if (mIdx >= 0 && mIdx < 12) return `${day} ${months[mIdx]} ${year}`;
    }

    // Fallback parsing Date
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
        const day = String(d.getDate()).padStart(2, '0');
        return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
    }

    return str;
}

/**
 * Standarisasi Penulisan Tempat Lahir: Huruf Kapital di Awal Setiap Kata (Title Case)
 * Contoh: "KARANGASEM" -> "Karangasem", "denpasar" -> "Denpasar", "kubu karangasem" -> "Kubu Karangasem"
 * @param {string} placeStr 
 * @returns {string}
 */
export function formatBirthPlace(placeStr) {
    if (!placeStr || typeof placeStr !== 'string') return '';
    const trimmed = placeStr.trim();
    if (!trimmed || trimmed === '-') return '';
    return trimmed
        .toLowerCase()
        .replace(/\b[a-z]/g, char => char.toUpperCase());
}

/**
 * Format string ke Title Case jika teks UPPERCASE penuh atau lowercase penuh.
 * Mempertahankan format teks jika sudah memiliki kombinasi huruf besar-kecil wajar.
 * @param {string} str 
 * @returns {string}
 */
export function formatAddressTitleCase(str) {
    if (!str || typeof str !== 'string') return '';
    const trimmed = str.trim();
    if (!trimmed || trimmed === '-') return '';
    const isAllUpper = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
    const isAllLower = trimmed === trimmed.toLowerCase() && /[a-z]/.test(trimmed);
    if (isAllUpper || isAllLower) {
        return trimmed.toLowerCase().replace(/\b[a-z]/g, char => char.toUpperCase());
    }
    return trimmed;
}

/**
 * Standarisasi Format Alamat Lengkap Kartu Pelajar (CR-80) sampai level Kecamatan:
 * Format Hirarkis: Alamat (Dusun/Banjar/Jalan), Desa/Kelurahan, Kecamatan
 * Contoh: "Banjar Dinas Culik, Culik, Abang"
 * @param {object|string} student 
 * @returns {string}
 */
export function formatStudentCardAddress(student) {
    if (!student) return '-';
    let rawAlamat = '';
    let rawDusun = '';
    let rawDesa = '';
    let rawKecamatan = '';

    if (typeof student === 'string') {
        rawAlamat = student.trim();
    } else if (typeof student === 'object') {
        rawAlamat = String(student.address || student.alamat || '').trim();
        rawDusun = String(student.dusun || '').trim();
        rawDesa = String(student.kelurahan || student.desa || '').trim();
        rawKecamatan = String(student.kecamatan || '').trim();
    }

    if (rawAlamat === '-') rawAlamat = '';
    if (rawDusun === '-') rawDusun = '';
    if (rawDesa === '-') rawDesa = '';
    if (rawKecamatan === '-') rawKecamatan = '';

    // Jika alamat utama kosong tapi dusun ada, gunakan dusun sebagai komponen awal
    if (!rawAlamat && rawDusun) {
        rawAlamat = rawDusun;
    }

    const cleanDesa = formatAddressTitleCase(rawDesa);
    const cleanKecamatan = formatAddressTitleCase(rawKecamatan);

    const parts = [];
    const getBaseKeyword = (s) => {
        return String(s || '')
            .toLowerCase()
            .replace(/^(desa|kelurahan|kel\.?|kecamatan|kec\.?)\s+/i, '')
            .trim();
    };

    if (rawAlamat) {
        parts.push(formatAddressTitleCase(rawAlamat));
    }

    // Tambahkan Desa jika belum tercantum sebagai segmen terpisah
    if (cleanDesa) {
        const desaBase = getBaseKeyword(cleanDesa);
        const existingSegments = parts.join(', ').split(',').map(s => getBaseKeyword(s));
        const alreadyHasDesa = existingSegments.some(seg => seg === desaBase);
        if (!alreadyHasDesa) {
            parts.push(cleanDesa);
        }
    }

    // Tambahkan Kecamatan jika belum tercantum sebagai segmen terpisah
    if (cleanKecamatan) {
        const kecBase = getBaseKeyword(cleanKecamatan);
        const existingSegments = parts.join(', ').split(',').map(s => getBaseKeyword(s));
        const alreadyHasKec = existingSegments.some(seg => seg === kecBase);
        if (!alreadyHasKec) {
            parts.push(cleanKecamatan);
        }
    }

    const finalAddress = parts.filter(Boolean).join(', ').trim();
    return finalAddress || '-';
}

/**
 * Memeriksa apakah nama rombel/kelas merupakan kelas reguler aktif jenjang SMA (X, XI, XII).
 * Menolak kelas alumni, mutasi, keluar, pindah, nonaktif, lulus, do, serta kelas kosong / non-reguler.
 * @param {string} className 
 * @returns {boolean}
 */
export function isRegularStudentClass(className) {
    if (!className || typeof className !== 'string') return false;
    const trimmed = className.trim();
    if (!trimmed || trimmed === '-' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') {
        return false;
    }

    const lower = trimmed.toLowerCase();
    const inactiveClassKeywords = [
        /\balumni\b/,
        /\bmutasi\b/,
        /\bpindah\b/,
        /\bkeluar\b/,
        /\bnon\s*aktif\b/,
        /\blulus\b/,
        /\bdrop\s*out\b/,
        /^do$/
    ];
    if (inactiveClassKeywords.some(pattern => pattern.test(lower))) {
        return false;
    }

    // Kelas reguler jenjang SMA wajib diawali X, XI, atau XII
    // Urutan regex: XII lalu XI lalu X untuk mencegah X mencocokkan XI/XII secara parsial
    return /^(XII|XI|X)([-.\s_]|$|[A-Za-z0-9])/i.test(trimmed);
}

/**
 * Memeriksa apakah siswa berstatus aktif pada Kartu Pelajar Digital.
 * Syarat aktif:
 * 1. Kelas siswa wajib merupakan kelas reguler (bukan alumni atau selain kelas reguler).
 * 2. Status siswa (jika terdefinisi) tidak berstatus alumni/mutasi/keluar/nonaktif/lulus/do/inactive.
 * @param {object} student 
 * @returns {boolean}
 */
export function isStudentCardActive(student) {
    if (!student || typeof student !== 'object') return false;

    const studentClass = String(student.class || student.kelas || student.rombel || '').trim();
    if (!isRegularStudentClass(studentClass)) {
        return false;
    }

    const studentStatus = String(student.status || student.statusSiswa || student.student_status || '').trim().toLowerCase();
    if (studentStatus) {
        const inactiveStatusKeywords = [
            /\balumni\b/,
            /\bmutasi\b/,
            /\bpindah\b/,
            /\bkeluar\b/,
            /\bnon\s*aktif\b/,
            /\blulus\b/,
            /\bdrop\s*out\b/,
            /^do$/,
            /^inactive$/
        ];
        if (inactiveStatusKeywords.some(pattern => pattern.test(studentStatus))) {
            return false;
        }
    }

    return true;
}

/**
 * Normalisasi Data Siswa & Konfigurasi Sekolah secara Terpadu
 * @param {object} student 
 * @returns {object}
 */
export function normalizeStudentCardData(student) {
    if (!student || typeof student !== 'object') student = {};

    const nis = String(student.nis || student.id || '').trim();
    const nisn = String(student.nisn || '-').trim();
    const name = String(student.name || student.nama || '-').trim().toUpperCase();
    const studentClass = String(student.class || student.kelas || '-').trim();

    const rawGender = String(student.gender || student.jenisKelamin || student.jenis_kelamin || '').trim().toUpperCase();
    const gender = rawGender.startsWith('L') ? 'LAKI-LAKI' : (rawGender.startsWith('P') ? 'PEREMPUAN' : '-');
    const genderLabel = rawGender.startsWith('L') ? 'Laki-laki' : (rawGender.startsWith('P') ? 'Perempuan' : '-');

    const rawBirthPlace = String(student.birthPlace || student.tempatLahir || student.tempat_lahir || student.birth_place || '').trim();
    const birthPlace = formatBirthPlace(rawBirthPlace);
    const rawBirthDate = String(student.birthDate || student.tanggalLahir || student.tgl_lahir || student.birth_date || '').trim();
    const birthDate = formatBirthDateIndo(rawBirthDate);
    const ttl = birthPlace && birthDate ? `${birthPlace}, ${birthDate}` : (birthPlace || birthDate || '-');

    // Normalisasi Alamat Lengkap Domisili Siswa sampai level Kecamatan (SSOT: Alamat, Desa, Kecamatan)
    const address = formatStudentCardAddress(student);

    const isRegularClass = isRegularStudentClass(studentClass);
    const isActive = isStudentCardActive(student);
    const statusText = isActive ? 'SISWA AKTIF' : 'SISWA NONAKTIF';
    const statusLabel = isActive ? 'Siswa Aktif' : 'Siswa Nonaktif';

    const rawPhoto = student.activePhotoUrl || student.photoUrl || student.foto_url;
    const resolvedPhoto = (typeof window !== 'undefined' && window.resolvePhotoUrl)
        ? window.resolvePhotoUrl(rawPhoto)
        : rawPhoto;
    const photoSrc = resolvedPhoto || 'assets/default-avatar.svg';

    const token = student.photoPublicToken || student.cardToken || student.public_token || '';

    const schoolNameUpper = SCHOOL_CONFIG?.schoolNameUpper || "SMA NEGERI NUSANTARA";
    const schoolAddress = SCHOOL_CONFIG?.schoolAddress || "Jl. Nusantara No. 1, Denpasar";
    const rawWeb = SCHOOL_CONFIG?.schoolWebsite || "https://simas-demo-5ead3.web.app";
    const schoolWebsite = rawWeb.replace(/^https?:\/\//, '');
    const headmasterName = SCHOOL_CONFIG?.headmasterName || "Dr. I Wayan Sudarsana, M.Pd.";
    const headmasterNIP = String(SCHOOL_CONFIG?.headmasterNIP || "197501012000031001").replace(/\s+/g, '');
    const headmasterSignaturePath = SCHOOL_CONFIG?.headmasterSignaturePath || 'assets/ttd-kepsek.png';
    const schoolStampPath = SCHOOL_CONFIG?.schoolStampPath || 'assets/cap-sekolah.png';
    const visiAcronym = SCHOOL_CONFIG?.schoolVisiAcronym || "CERDAS";
    const visiDesc = SCHOOL_CONFIG?.schoolVisiDesc || "Cendekia • Empati • Religius • Disiplin • Adaptif • Santun";
    const visiText = `&ldquo;Terwujudnya Peserta Didik yang ${escapeHtml(visiAcronym)} (${escapeHtml(visiDesc)}) Berwawasan Lingkungan.&rdquo;`;

    return {
        nis,
        nisn,
        name,
        class: studentClass,
        gender,
        genderLabel,
        birthPlace,
        birthDate,
        ttl,
        address,
        photoSrc,
        token,
        schoolNameUpper,
        schoolAddress,
        schoolWebsite,
        headmasterName,
        headmasterNIP,
        headmasterSignaturePath,
        schoolStampPath,
        visiAcronym,
        visiDesc,
        visiText,
        isRegularClass,
        isActive,
        statusText,
        statusLabel,
        rawStudent: student
    };
}

/**
 * Render Markup Sisi Depan Kartu (CR-80: Quick Scan Single Universal QR & Identitas Resmi)
 * @param {object} student 
 * @param {object} options { qrId, mode: 'screen'|'print', cardStyle }
 * @returns {string} HTML string
 */
export function renderKtsFrontHtml(student, options = {}) {
    const data = normalizeStudentCardData(student);
    const qrId = options.qrId || `kts-qr-front-${data.nis || Math.random().toString(36).substring(2, 7)}`;
    const mode = options.mode || 'screen'; // 'screen' atau 'print'

    let containerClass = '';
    let innerWrapOpen = '';
    let innerWrapClose = '';

    if (mode === 'print') {
        containerClass = 'kts-printable-card kts-print-front relative overflow-hidden';
        innerWrapOpen = '<div class="kts-print-scale-inner">';
        innerWrapClose = '</div>';
    } else if (options.standalone) {
        containerClass = 'kts-face kts-standalone p-2.5 sm:p-3 flex flex-col justify-between';
    } else {
        containerClass = 'kts-face kts-face-front p-2.5 sm:p-3 flex flex-col justify-between';
    }

    const baseStyle = mode === 'print'
        ? "width: 85.6mm; height: 53.98mm; border-radius: 3.18mm; background-color: #FAFAF7; color: #0F172A; box-sizing: border-box; font-family: 'Inter', sans-serif; border: 0.5pt solid #CBD5E1; padding: 0;"
        : '';

    const customStyle = options.cardStyle ? `${baseStyle} ${options.cardStyle}` : baseStyle;
    const styleAttr = customStyle ? `style="${customStyle}"` : '';

    return `
        <div class="${containerClass}" data-kts-student="${escapeHtml(data.nis)}" data-kts-side="front" ${styleAttr}>
            ${innerWrapOpen}
            <!-- Corak Halus Pengaman Kartu & Watermark Lambang Sekolah -->
            <div class="kts-card-pattern-overlay"></div>
            <div class="kts-card-watermark-bg">
                <img src="assets/logo-sekolah.png" alt="Watermark Lambang Sekolah" class="kts-watermark-img">
            </div>

            <!-- Ornamen Sudut Samar -->
            <svg class="kts-bali-corner kts-bali-corner-tr" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.2">
                <path d="M 40 0 L 40 16 L 24 16 L 24 0 Z" opacity="0.25" fill="currentColor"/>
                <path d="M 40 4 L 28 4 L 28 0 M 40 10 L 20 10 L 20 0" />
            </svg>
            <svg class="kts-bali-corner kts-bali-corner-bl" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.2">
                <path d="M 40 0 L 40 16 L 24 16 L 24 0 Z" opacity="0.25" fill="currentColor"/>
                <path d="M 40 4 L 28 4 L 28 0 M 40 10 L 20 10 L 20 0" />
            </svg>

            <!-- Kop Surat Resmi Transparan Sisi Depan (Ukuran Diperbesar Presisi) -->
            <div class="kts-official-kop-wrapper">
                <img src="${escapeHtml(schoolAssetUrl(SCHOOL_CONFIG.kopTransparentPath))}" data-school-asset="kopTransparentPath" alt="Kop Resmi SMA Negeri Nusantara" class="kts-official-kop-img">
            </div>

            <!-- Baris Penegas Identitas Dokumen Kartu Pelajar (Akreditasi Dihapus) -->
            <div class="kts-front-doc-bar">
                <span class="kts-doc-title-text">KARTU PELAJAR</span>
                <span class="kts-doc-badge-pill">SMANTARA CERDAS</span>
            </div>

            <!-- Body Grid 3 Zona (Pasfoto 3:4, Identitas Siswa, Single Universal QR) -->
            <div class="kts-front-grid">
                <!-- Zona 1: Pasfoto 3:4 & Status Aktif (Status Siswa Aktif Hilang Saat Dicetak) -->
                <div class="kts-photo-col flex flex-col items-center shrink-0">
                    <div class="kts-photo-frame">
                        <img ${options.photoId || (mode === 'screen' ? 'id="kts-front-photo"' : '')} src="${escapeHtml(data.photoSrc)}" alt="Pasfoto" class="kts-photo-img" onerror="this.onerror=null;this.src='assets/default-avatar.svg';">
                    </div>
                    ${mode !== 'print' ? `<span class="kts-status-pill-photo kts-hide-on-print ${data.isActive ? '' : 'kts-status-pill-inactive'}">${data.statusText}</span>` : ''}
                </div>

                <!-- Zona 2: Identitas Lengkap Siswa (Desain Proporsional & Ritme Vertikal Seragam) -->
                <div class="min-w-0 flex-1 grid grid-cols-2 gap-x-2.5 gap-y-1.5 kts-identity-grid">
                    <div class="col-span-2">
                        <span class="kts-identity-label text-[7px] uppercase tracking-wider text-[#64748B] font-bold block leading-none mb-0.5">Nama Lengkap Siswa</span>
                        <h5 ${options.nameId || (mode === 'screen' ? 'id="kts-front-name"' : '')} class="kts-identity-name font-black text-[11.5px] sm:text-[12px] text-[#0F172A] leading-tight break-words uppercase">
                            ${escapeHtml(data.name)}
                        </h5>
                    </div>
                    <div>
                        <span class="kts-identity-label text-[7px] uppercase tracking-wider text-[#64748B] font-bold block leading-none mb-0.5">NIS</span>
                        <span ${options.nisId || (mode === 'screen' ? 'id="kts-front-nis"' : '')} class="kts-identity-nis text-[10px] sm:text-[10.5px] font-black text-[#0F172A] font-mono leading-tight block">${escapeHtml(data.nis)}</span>
                    </div>
                    <div>
                        <span class="kts-identity-label text-[7px] uppercase tracking-wider text-[#64748B] font-bold block leading-none mb-0.5">NISN</span>
                        <span ${options.nisnId || (mode === 'screen' ? 'id="kts-front-nisn"' : '')} class="kts-identity-nisn text-[10px] sm:text-[10.5px] font-black text-[#0F172A] font-mono leading-tight block">${escapeHtml(data.nisn)}</span>
                    </div>
                    <div class="col-span-2">
                        <span class="kts-identity-label text-[7px] uppercase tracking-wider text-[#64748B] font-bold block leading-none mb-0.5">TTL</span>
                        <span ${options.ttlId || (mode === 'screen' ? 'id="kts-front-ttl"' : '')} class="kts-identity-ttl text-[10px] font-semibold text-[#0F172A] leading-tight block truncate">${escapeHtml(data.ttl)}</span>
                    </div>
                    <div class="col-span-2">
                        <span class="kts-identity-label text-[7px] uppercase tracking-wider text-[#64748B] font-bold block leading-none mb-0.5">Alamat</span>
                        <span ${options.addressId || (mode === 'screen' ? 'id="kts-front-address"' : '')} class="kts-identity-address text-[9.5px] font-semibold text-[#0F172A] leading-tight block line-clamp-2" title="${escapeHtml(data.address)}">${escapeHtml(data.address)}</span>
                    </div>
                </div>

                <!-- Zona 3: Quick Scan QR Code Box (Single Universal QR) -->
                <div class="flex flex-col items-center shrink-0">
                    <div id="${qrId}" class="kts-qr-container" data-token="${escapeHtml(data.token)}" data-nis="${escapeHtml(data.nis)}">
                    </div>
                    <span class="text-[5.5px] font-black text-[#64748B] mt-0.5 text-center leading-tight uppercase tracking-tight">SCAN PRESENSI<br>& VERIFIKASI</span>
                </div>
            </div>

            <!-- Footer Depan: Kiri Bawah (Anubawa Anukara Antrah) & Kanan Bawah (SMANTARA CERDAS • BALI) -->
            <div class="kts-front-footer relative z-10 flex items-center justify-between text-[6.5px] text-[#64748B] pt-0.5 border-t border-[#E2E8F0]">
                <span class="text-[6px] font-bold tracking-wider text-[#64748B] uppercase">Anubawa Anukara Antrah</span>
                <span class="text-[6px] font-black tracking-widest text-[#B89552] uppercase">SMANTARA CERDAS &bull; BALI</span>
            </div>
            ${innerWrapClose}
        </div>
    `;
}

/**
 * Render Markup Sisi Belakang Kartu (CR-80: Visi Sekolah, Ikrar Pelajar Indonesia, & Footer Bawah)
 * @param {object} student 
 * @param {object} options { mode: 'screen'|'print', standalone: boolean, cardStyle }
 * @returns {string} HTML string
 */
export function renderKtsBackHtml(student, options = {}) {
    const data = normalizeStudentCardData(student);
    const mode = options.mode || 'screen';

    let containerClass = '';
    let innerWrapOpen = '';
    let innerWrapClose = '';

    if (mode === 'print') {
        containerClass = 'kts-printable-card kts-print-back relative overflow-hidden';
        innerWrapOpen = '<div class="kts-print-scale-inner">';
        innerWrapClose = '</div>';
    } else if (options.standalone) {
        containerClass = 'kts-face kts-standalone p-2.5 sm:p-3 flex flex-col justify-between';
    } else {
        containerClass = 'kts-face kts-face-back p-2.5 sm:p-3 flex flex-col justify-between';
    }

    const baseStyle = mode === 'print'
        ? "width: 85.6mm; height: 53.98mm; border-radius: 3.18mm; background-color: #FAFAF7; color: #0F172A; box-sizing: border-box; font-family: 'Inter', sans-serif; border: 0.5pt solid #CBD5E1; padding: 0;"
        : '';

    const customStyle = options.cardStyle ? `${baseStyle} ${options.cardStyle}` : baseStyle;
    const styleAttr = customStyle ? `style="${customStyle}"` : '';

    return `
        <div class="${containerClass}" data-kts-student="${escapeHtml(data.nis)}" data-kts-side="back" ${styleAttr}>
            ${innerWrapOpen}
            <!-- Corak Halus Pengaman Kartu & Watermark Lambang Sekolah -->
            <div class="kts-card-pattern-overlay"></div>
            <div class="kts-card-watermark-bg">
                <img src="assets/logo-sekolah.png" alt="Watermark Lambang Sekolah" class="kts-watermark-img">
            </div>

            <!-- Ornamen Sudut Samar -->
            <svg class="kts-bali-corner kts-bali-corner-tr" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.2">
                <path d="M 40 0 L 40 16 L 24 16 L 24 0 Z" opacity="0.25" fill="currentColor"/>
                <path d="M 40 4 L 28 4 L 28 0 M 40 10 L 20 10 L 20 0" />
            </svg>
            <svg class="kts-bali-corner kts-bali-corner-bl" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.2">
                <path d="M 40 0 L 40 16 L 24 16 L 24 0 Z" opacity="0.25" fill="currentColor"/>
                <path d="M 40 4 L 28 4 L 28 0 M 40 10 L 20 10 L 20 0" />
            </svg>

            <!-- Pita Atas Visi & Ikrar (Kanan Atas: SMANTARA CERDAS) -->
            <div class="kts-back-ribbon">
                <div class="flex items-center gap-1.5">
                    <i class="fa-solid fa-graduation-cap text-amber-400 text-[8px]"></i>
                    <span class="text-[6.8px] font-black tracking-widest uppercase text-white">SMANTARA CERDAS &bull; VISI & IKRAR PELAJAR</span>
                </div>
                <div class="flex items-center gap-1.5">
                    <span class="text-[6.5px] text-amber-300 font-black uppercase tracking-widest">SMANTARA CERDAS</span>
                </div>
            </div>

            <!-- Tata Letak Konten Belakang: Visi, Ikrar, Ketentuan, & Footer Bawah -->
            <div class="kts-back-body">
                <!-- Cardlet Visi Sekolah (Font Normal Tidak Dimiringkan) -->
                <div class="kts-vision-card">
                    <div class="kts-vision-title flex items-center gap-1">
                        <i class="fa-solid fa-compass text-[5.5px]"></i>
                        <span>Visi Satuan Pendidikan</span>
                    </div>
                    <p class="kts-vision-text text-[8.5px] font-bold" ${options.visionId || (mode === 'screen' ? 'id="kts-back-vision-text"' : '')}>
                        ${data.visiText}
                    </p>
                </div>

                <!-- Cardlet Ikrar Pelajar Indonesia (Revisi Resmi Kemendikdasmen 2026) -->
                <div class="kts-ikrar-card">
                    <div class="kts-ikrar-title flex items-center justify-between">
                        <div class="flex items-center gap-1">
                            <i class="fa-solid fa-flag text-rose-500 text-[5.5px]"></i>
                            <span>Ikrar Pelajar Indonesia</span>
                        </div>
                        <span class="text-[6.2px] font-semibold text-slate-500 italic lowercase tracking-tight">&ldquo;Kami, Pelajar Indonesia, berikrar untuk:&rdquo;</span>
                    </div>
                    <ol class="kts-ikrar-list text-[7.8px] font-medium">
                        <li>Beriman dan bertakwa kepada Tuhan Yang Maha Esa.</li>
                        <li>Menghormati dan mencintai orang tua dan guru.</li>
                        <li>Belajar dengan baik dan sungguh-sungguh.</li>
                        <li>Rukun dengan teman.</li>
                        <li>Mencintai tanah air Indonesia.</li>
                    </ol>
                </div>

                <!-- Ketentuan Penggunaan Kartu Pelajar (Diperjelas & Terstruktur) -->
                <div class="kts-rules-compact kts-rules-card text-[6.8px] text-[#334155]">
                    <div class="kts-rules-title">
                        <i class="fa-solid fa-circle-info text-indigo-600 text-[6.5px]"></i>
                        <span>Ketentuan Penggunaan Kartu Pelajar:</span>
                    </div>
                    <ul class="kts-rules-list">
                        <li>1. Wajib dibawa saat beraktivitas di lingkungan SMA Negeri Nusantara.</li>
                        <li>2. Berlaku untuk Presensi Digital, Transaksi Pembayaran DPM, Peminjaman Buku, dan lainnya.</li>
                        <li>3. Kartu ini tidak dapat dipindahtangankan serta dilarang disalahgunakan.</li>
                        <li>4. Apabila kartu hilang atau ditemukan, mohon segera melapor ke SMA Negeri Nusantara.</li>
                    </ul>
                </div>

                <!-- Pengesahan Resmi SSOT & Kontak Lengkap di Dasar Kartu (Footer Paling Bawah) -->
                <div class="kts-endorsement-wrapper">
                    <!-- Watermark Cap Stempel Sekolah -->
                    <img src="assets/logo-sekolah.png" alt="Stempel Sekolah" class="kts-stamp-watermark">

                    <div class="relative z-10 leading-tight">
                        <p class="font-black text-[#0F172A] text-[8px] kts-endorsement-school-name" ${options.schoolNameId || (mode === 'screen' ? 'id="kts-back-school-name"' : '')}>${escapeHtml(data.schoolNameUpper)}</p>
                        <p class="text-[#64748B] text-[7px] kts-endorsement-meta">NPSN: ${escapeHtml(SCHOOL_CONFIG.schoolNPSN)} &bull; SMANTARA CERDAS (Anubawa Anukara Antrah)</p>
                        <p class="text-[#64748B] text-[7px] kts-endorsement-school-contact" ${options.schoolContactId || (mode === 'screen' ? 'id="kts-back-school-contact"' : '')}>${escapeHtml(data.schoolAddress)} &bull; ${escapeHtml(data.schoolWebsite)}</p>
                    </div>
                    <!-- Blok Pengesahan Kepala Sekolah: NIP Lurus dengan Karakter Pertama Nama Kepsek -->
                    <div class="relative z-10 flex flex-col items-start text-left leading-tight min-w-[135px]">
                        <p class="text-[#64748B] text-[6.8px] kts-endorsement-meta">Kepala SMA Negeri Nusantara,</p>
                        <!-- Kotak Tanda Tangan & Cap Stempel Resmi Kepala Sekolah -->
                        <div class="kts-signature-stamp-box">
                            <img src="${escapeHtml(data.schoolStampPath)}" alt="Cap Stempel Sekolah" class="kts-stamp-img">
                            <img src="${escapeHtml(data.headmasterSignaturePath)}" alt="Tanda Tangan Kepala Sekolah" class="kts-signature-img">
                        </div>
                        <p class="font-black text-[#0F172A] text-[7.8px] underline decoration-slate-400 decoration-1 underline-offset-1 kts-endorsement-headmaster-name" ${options.headmasterNameId || (mode === 'screen' ? 'id="kts-back-headmaster-name"' : '')}>${escapeHtml(data.headmasterName)}</p>
                        <p class="text-[#64748B] text-[6.5px] kts-endorsement-headmaster-nip" ${options.headmasterNipId || (mode === 'screen' ? 'id="kts-back-headmaster-nip"' : '')}>NIP. ${escapeHtml(data.headmasterNIP)}</p>
                    </div>
                </div>
            </div>
            ${innerWrapClose}
        </div>
    `;
}

/**
 * Render Sepasang Kartu untuk Cetak Fisik Presisi CR-80 (85.60 mm x 53.98 mm)
 * @param {object} student 
 * @param {number} index 
 * @param {string} side 'both'|'front'|'back'
 * @returns {object} { html, qrId, student, token }
 */
export function renderKtsPrintPairHtml(student, index = 0, side = 'both') {
    const data = normalizeStudentCardData(student);
    const qrId = `print-kts-qr-${index}-${String(data.nis || index).replace(/\W/g, '')}`;

    const frontCardHtml = renderKtsFrontHtml(student, { qrId, mode: 'print' });
    const backCardHtml = renderKtsBackHtml(student, { mode: 'print' });

    let combinedHtml = '';
    if (side === 'front') {
        combinedHtml = `<div style="display: inline-block; vertical-align: top; margin-right: 4mm; margin-bottom: 4mm;">${frontCardHtml}</div>`;
        return { html: combinedHtml, qrId, student: data.rawStudent, token: data.token };
    }
    if (side === 'back') {
        combinedHtml = `<div style="display: inline-block; vertical-align: top; margin-bottom: 4mm;">${backCardHtml}</div>`;
        return { html: combinedHtml, qrId: null, student: data.rawStudent, token: data.token };
    }

    combinedHtml = `
        <div style="display: inline-block; vertical-align: top; margin-right: 4mm; margin-bottom: 4mm;">${frontCardHtml}</div>
        <div style="display: inline-block; vertical-align: top; margin-bottom: 4mm;">${backCardHtml}</div>
    `;

    return {
        html: combinedHtml,
        qrId,
        student: data.rawStudent,
        token: data.token
    };
}

/**
 * Render Konten Wadah Kartu 3D Flip Interaktif (Untuk Portal Siswa & Modal Wali Kelas)
 * @param {HTMLElement|string} containerOrId 
 * @param {object} student 
 * @param {object} options 
 * @returns {object} { qrId, student, token }
 */
export function renderKtsInteractiveCard(containerOrId, student, options = {}) {
    const container = typeof containerOrId === 'string' ? document.getElementById(containerOrId) : containerOrId;
    if (!container) return null;

    const data = normalizeStudentCardData(student);
    const qrId = options.qrId || 'kts-front-qr-box';

    if (!container.classList.contains('kts-card-wrapper')) {
        container.classList.add('kts-card-wrapper');
    }

    const frontHtml = renderKtsFrontHtml(student, { qrId, mode: 'screen', ...options });
    const backHtml = renderKtsBackHtml(student, { mode: 'screen', ...options });

    container.innerHTML = `${frontHtml}\n${backHtml}`;

    // Otomatis render QR Code agar tidak blank / loading tak berkesudahan
    renderKtsQrCode(qrId, data.token || student, {
        width: options.qrWidth || 74,
        height: options.qrHeight || 74
    });

    // Terapkan auto-scaler segera agar berprilaku proporsional persis gambar
    updateKtsCardScale(container);
    if (ktsResizeObserver && container) {
        ktsResizeObserver.observe(container);
    }

    return { qrId, student: data.rawStudent, token: data.token };
}

/**
 * Render QR Code Verifikasi Publik Secara Terstandarisasi & Tangguh Anti-Gagal
 * @param {HTMLElement|string} containerOrId 
 * @param {string|object} tokenOrStudent 
 * @param {object} options 
 */
export function renderKtsQrCode(containerOrId, tokenOrStudent, options = {}) {
    const container = typeof containerOrId === 'string' ? document.getElementById(containerOrId) : containerOrId;
    if (!container) return;

    let token = '';

    if (typeof tokenOrStudent === 'string') {
        token = tokenOrStudent.trim();
        // NIS polos tidak boleh dijadikan QR (anti-IDOR) dan tidak dapat dienkripsi di browser:
        // token kartu wajib berasal dari server (photoPublicToken / cardToken).
        if (/^\d{3,12}$/.test(token)) token = '';
    } else if (tokenOrStudent && typeof tokenOrStudent === 'object') {
        token = normalizeStudentCardData(tokenOrStudent).token;
    }

    // Jika token masih kosong, cek data-token di elemen kontainer
    if (!token && container.dataset?.token) {
        token = container.dataset.token;
    }

    container.innerHTML = '';
    if (!token) {
        container.innerHTML = `<div class="w-full h-full flex items-center justify-center text-slate-400 text-xs"><i class="fa-solid fa-qrcode text-2xl opacity-40"></i></div>`;
        return;
    }

    const verifyUrl = `${window.location.origin}/kartu-shakti.html?id=${encodeURIComponent(token)}`;

    if (typeof QRCode !== 'undefined') {
        try {
            new QRCode(container, {
                text: verifyUrl,
                width: options.width || 74,
                height: options.height || 74,
                colorDark: options.colorDark || '#0F172A',
                colorLight: options.colorLight || '#ffffff',
                correctLevel: (typeof QRCode.CorrectLevel !== 'undefined') ? (options.correctLevel || QRCode.CorrectLevel.M) : 0
            });
        } catch (e) {
            console.warn('[StudentCardRenderer] QR Render Error:', e);
            container.innerHTML = `<i class="fa-solid fa-qrcode text-3xl text-slate-800"></i>`;
        }
    } else {
        container.innerHTML = `<i class="fa-solid fa-qrcode text-3xl text-slate-800"></i>`;
    }
}

/**
 * Memastikan seluruh aset gambar di dalam kontainer kartu selesai dimuat (decode)
 * Sangat penting untuk koneksi WiFi/seluler lambat agar hasil cetak tidak kosong / rusak.
 * @param {HTMLElement} container 
 * @param {number} maxWaitMs 
 * @returns {Promise<void>}
 */
export async function ensureCardAssetsLoaded(container, maxWaitMs = 6000) {
    if (!container || typeof document === 'undefined') return;

    const images = Array.from(container.querySelectorAll('img'));
    if (images.length === 0) return;

    const waitPromises = images.map(img => {
        return new Promise(resolve => {
            if (img.complete && img.naturalWidth > 0) {
                return resolve(true);
            }
            let done = false;
            const onFinish = () => {
                if (!done) {
                    done = true;
                    resolve(true);
                }
            };
            img.addEventListener('load', onFinish, { once: true });
            img.addEventListener('error', onFinish, { once: true });

            if (typeof img.decode === 'function') {
                img.decode().then(onFinish).catch(onFinish);
            }
        });
    });

    if (document.fonts && typeof document.fonts.ready?.then === 'function') {
        waitPromises.push(document.fonts.ready.catch(() => {}));
    }

    await Promise.race([
        Promise.all(waitPromises),
        new Promise(resolve => setTimeout(resolve, maxWaitMs))
    ]);

    await new Promise(r => setTimeout(r, 80));
}

/**
 * Cetak Tunggal KTS Universal (Dapat dipanggil dari Siswa, Wali Kelas, dan Portal Siswa)
 * @param {object} student 
 * @param {string} sideOption 'both'|'front'|'back'
 * @param {string} containerId default 'print-single-kts-container'
 */
export async function printSingleKts(student, sideOption = 'both', containerId = 'print-single-kts-container') {
    if (!student) return;
    let container = document.getElementById(containerId);
    if (!container) {
        container = document.getElementById('print-single-kts-container') || 
                    document.getElementById('print-kts-container') || 
                    document.querySelector('.print-kts-bulk-container');
    }
    if (!container) {
        container = document.createElement('div');
        container.id = 'print-single-kts-container';
        container.className = 'print-kts-bulk-container';
        document.body.appendChild(container);
    }

    await prepareKtsPrintCards([student], sideOption, container);
    window.print();
}

/** Print the very same PNG pixels as download, at CR-80 physical dimensions. */
export async function prepareKtsPrintCards(students, sideOption, container) {
    const sheet = document.createElement('div');
    sheet.className = 'kts-snapshot-sheet';
    const sides = sideOption === 'front' || sideOption === 'back' ? [sideOption] : ['front', 'back'];
    for (const student of students) {
        const pair = document.createElement('div');
        pair.className = 'kts-snapshot-pair';
        for (const side of sides) {
            const canvas = await generateKtsFaceCanvas(student, side);
            const img = document.createElement('img');
            img.className = 'kts-print-snapshot';
            img.alt = `Kartu ${normalizeStudentCardData(student).name} — ${side === 'front' ? 'depan' : 'belakang'}`;
            img.src = canvas.toDataURL('image/png');
            await img.decode();
            pair.appendChild(img);
        }
        sheet.appendChild(pair);
    }
    // Other print jobs must not overlap this one on the same physical page.
    document.querySelectorAll('.print-kts-bulk-container, #print-kts-container').forEach(node => {
        if (node !== container) node.replaceChildren();
    });
    container.classList.add('print-kts-bulk-container');
    container.replaceChildren(sheet);
    return sheet;
}

// ================= AUTO-SCALER PROPORSIONAL BERBASIS GAMBAR (CR-80) =================
let ktsResizeObserver = null;
let ktsResizeTimer = null;

/**
 * Auto-scale kartu pelajar digital agar berperilaku proporsional seperti berkas gambar (CR-80: 85.60mm x 53.98mm)
 * Mengatur CSS Variable --kts-scale berdasarkan rasio lebar aktual terhadap lebar kanvas dasar 440px.
 * @param {HTMLElement|string} containerOrId
 * @returns {number} Nilai skala yang diterapkan
 */
export function updateKtsCardScale(containerOrId) {
    let container = containerOrId;
    if (typeof containerOrId === 'string') {
        if (typeof document === 'undefined') return 1;
        container = document.getElementById(containerOrId);
    }
    if (!container) return 1;

    // Export copies keep the scale of the preview they were captured from.
    if (container.closest?.('[data-kts-export-stage]')) return 1;

    const width = container.offsetWidth || (typeof container.getBoundingClientRect === 'function' ? container.getBoundingClientRect().width : 0);
    if (width > 0) {
        // Skala dihitung terhadap kanvas dasar 440px
        const scale = Math.max(0.1, Number((width / 440).toFixed(4)));
        if (container.style && typeof container.style.setProperty === 'function') {
            container.style.setProperty('--kts-scale', String(scale));
        }
        return scale;
    }
    return 1;
}

/**
 * Memperbarui skala seluruh elemen .kts-card-wrapper yang ada di DOM saat ini
 */
export function updateAllKtsCardScales() {
    if (typeof document === 'undefined') return;
    const cards = document.querySelectorAll('.kts-card-wrapper');
    cards.forEach(card => updateKtsCardScale(card));
}

/**
 * Menginisialisasi ResizeObserver dan event listener resize untuk pembaruan skala otomatis real-time
 */
export function initKtsAutoScaler() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    if (typeof ResizeObserver !== 'undefined') {
        if (!ktsResizeObserver) {
            ktsResizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const el = entry.target;
                    const width = entry.contentRect?.width || el.offsetWidth;
                    if (width > 0) {
                        const scale = Math.max(0.1, Number((width / 440).toFixed(4)));
                        el.style.setProperty('--kts-scale', String(scale));
                    }
                }
            });
        }

        document.querySelectorAll('.kts-card-wrapper').forEach(card => {
            ktsResizeObserver.observe(card);
            updateKtsCardScale(card);
        });
    }

    // Debounced listener untuk window resize (zoom in/out atau resize jendela)
    window.addEventListener('resize', () => {
        document.querySelectorAll('.kts-card-wrapper').forEach(card => card.classList.add('kts-resizing'));
        updateAllKtsCardScales();

        clearTimeout(ktsResizeTimer);
        ktsResizeTimer = setTimeout(() => {
            document.querySelectorAll('.kts-card-wrapper').forEach(card => card.classList.remove('kts-resizing'));
            updateAllKtsCardScales();
        }, 120);
    }, { passive: true });
}

function cloneCanvas(sourceCanvas) {
    if (!sourceCanvas) return null;
    const clone = document.createElement('canvas');
    clone.width = sourceCanvas.width;
    clone.height = sourceCanvas.height;
    const ctx = clone.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0);
    return clone;
}

let cachedStandardBackCanvas = null;
let cachedBackPromise = null;

export function clearKtsBackCanvasCache() {
    cachedStandardBackCanvas = null;
    cachedBackPromise = null;
}

// PNG uses the screen markup and CSS, including live preview edits.
async function generateKtsFaceCanvas(student, side, options = {}) {
    const { rasterizeKtsFace } = await import('./student-card-export.js');
    const data = normalizeStudentCardData(student);
    return rasterizeKtsFace(data.nis, side, stage => {
        const qrId = `kts-export-qr-${Math.random().toString(36).slice(2)}`;
        stage.innerHTML = side === 'front'
            ? renderKtsFrontHtml(student, { mode: 'screen', standalone: true, qrId })
            : renderKtsBackHtml(student, { mode: 'screen', standalone: true });
        const face = stage.firstElementChild;
        if (side === 'front') {
            const qr = face.querySelector('.kts-qr-container');
            renderKtsQrCode(qr, data.token || student, { width: 74, height: 74 });
            if (!qr.querySelector('canvas, img')) throw new Error('QR kartu belum siap. Muat ulang halaman.');
        }
        return face;
    }, ensureCardAssetsLoaded, options);
}

export async function generateKtsFrontCanvas(student, options = {}) {
    return generateKtsFaceCanvas(student, 'front', options);
}

export async function generateKtsBackCanvas(student, options = {}) {
    if (options.forceFresh) {
        return generateKtsFaceCanvas(student, 'back', options);
    }

    const data = normalizeStudentCardData(student);
    const scope = typeof options.previewContainer === 'string'
        ? (typeof document !== 'undefined' ? document.getElementById(options.previewContainer) : null)
        : (options.previewContainer || (typeof document !== 'undefined' ? document : null));

    const hasLiveBackPreview = Boolean(
        scope?.querySelector && Array.from(scope.querySelectorAll('.kts-face[data-kts-side="back"]'))
            .some(face => face.dataset.ktsStudent === data.nis && !face.closest('[data-kts-export-stage]') && face.getClientRects().length > 0)
    );

    // Jika ada live preview aktif yang sedang tampil di layar, render langsung dari preview DOM
    if (hasLiveBackPreview) {
        return generateKtsFaceCanvas(student, 'back', options);
    }

    // Jika sisi belakang standar sudah ter-cache di memori, kembalikan salinannya secara instan
    if (cachedStandardBackCanvas) {
        return cloneCanvas(cachedStandardBackCanvas);
    }

    // Jika sedang dalam antrean render pertama, gunakan Promise yang sama (anti duplikasi)
    if (cachedBackPromise) {
        await cachedBackPromise;
        if (cachedStandardBackCanvas) {
            return cloneCanvas(cachedStandardBackCanvas);
        }
    }

    cachedBackPromise = (async () => {
        const canvas = await generateKtsFaceCanvas(student, 'back', options);
        cachedStandardBackCanvas = canvas;
        return canvas;
    })();

    try {
        const resultCanvas = await cachedBackPromise;
        return cloneCanvas(resultCanvas);
    } finally {
        cachedBackPromise = null;
    }
}

/**
 * Generate Canvas Kedua Sisi (Depan & Belakang Bersandingan) Ultra-HD
 * Menjalankan render sisi depan dan belakang secara paralel untuk kecepatan instan.
 * @param {object} student 
 * @param {object} options 
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function generateKtsBothCanvas(student, options = {}) {
    const [frontCanvas, backCanvas] = await Promise.all([
        generateKtsFrontCanvas(student, options),
        generateKtsBackCanvas(student, options)
    ]);

    const pad = 20;
    const gap = 30;
    const totalW = frontCanvas.width + backCanvas.width + pad * 2 + gap;
    const totalH = frontCanvas.height + pad * 2;

    const combinedCanvas = document.createElement('canvas');
    combinedCanvas.width = totalW;
    combinedCanvas.height = totalH;
    const ctx = combinedCanvas.getContext('2d');

    // Background kanvas
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, totalW, totalH);

    // Draw Front
    ctx.drawImage(frontCanvas, pad, pad);
    // Draw Back
    ctx.drawImage(backCanvas, pad + frontCanvas.width + gap, pad);

    return combinedCanvas;
}

/**
 * Unduh Kartu Pelajar PNG Resolusi Tinggi (CR-80 HD 300 DPI)
 * @param {object} student 
 * @param {'front'|'back'|'both'} sideOption 
 * @param {object} options 
 */
export async function downloadKtsPng(student, sideOption = 'both', options = {}) {
    if (!student) return;
    const data = normalizeStudentCardData(student);
    const nis = data.nis || 'siswa';
    const cleanName = (data.name || 'Siswa').replace(/\s+/g, '_');

    let canvas = null;
    let fileName = '';

    if (sideOption === 'front') {
        canvas = await generateKtsFrontCanvas(student, options);
        fileName = `Kartu_Pelajar_Depan_${nis}_${cleanName}.png`;
    } else if (sideOption === 'back') {
        canvas = await generateKtsBackCanvas(student, options);
        fileName = `Kartu_Pelajar_Belakang_${nis}_${cleanName}.png`;
    } else {
        canvas = await generateKtsBothCanvas(student, options);
        fileName = `Kartu_Pelajar_Lengkap_${nis}_${cleanName}.png`;
    }

    if (!canvas) return;

    const link = document.createElement('a');
    link.download = fileName;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * Buka Modal Pemilihan Format Unduh Kartu Pelajar (Sisi Depan / Belakang / Kedua Sisi)
 * @param {object} student 
 * @param {object} options 
 */
export function openKtsDownloadModal(student, options = {}) {
    if (typeof document === 'undefined') return;
    if (!student) return;

    const data = normalizeStudentCardData(student);
    let modal = document.getElementById('kts-download-selector-modal');

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'kts-download-selector-modal';
        modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs transition-opacity duration-200';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-5 space-y-4 relative overflow-hidden animate-fade-in">
            <!-- Header Modal -->
            <div class="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div class="flex items-center gap-2.5">
                    <div class="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 flex items-center justify-center text-base shrink-0 border border-emerald-200 dark:border-emerald-800">
                        <i class="fa-solid fa-cloud-arrow-down"></i>
                    </div>
                    <div>
                        <h3 class="text-sm font-black text-slate-800 dark:text-white">Unduh Kartu Pelajar HD</h3>
                        <p class="text-[11px] text-slate-400">Standar ISO CR-80 (Resolusi Cetak 300 DPI)</p>
                    </div>
                </div>
                <button type="button" onclick="window.closeKtsDownloadModal()" class="w-8 h-8 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center justify-center transition cursor-pointer" title="Tutup">
                    <i class="fa-solid fa-xmark text-sm"></i>
                </button>
            </div>

            <!-- Student Info Pill -->
            <div class="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-2.5 border border-slate-200 dark:border-slate-700/60 flex items-center gap-3">
                <div class="w-8 h-10 rounded bg-slate-200 dark:bg-slate-700 overflow-hidden shrink-0 border border-slate-300 dark:border-slate-600">
                    <img src="${escapeHtml(data.photoSrc)}" alt="Foto" class="w-full h-full object-cover" onerror="this.src='assets/default-avatar.svg';">
                </div>
                <div class="min-w-0 flex-1">
                    <p class="font-bold text-xs text-slate-800 dark:text-white truncate uppercase">${escapeHtml(data.name)}</p>
                    <p class="text-[10px] text-slate-500 dark:text-slate-400 font-mono">NIS: ${escapeHtml(data.nis)} &bull; NISN: ${escapeHtml(data.nisn)}</p>
                </div>
            </div>

            <!-- Pilihan Format Unduh -->
            <p class="text-xs font-semibold text-slate-600 dark:text-slate-300">Pilih format kartu yang ingin Anda unduh:</p>
            <div class="space-y-2">
                <button type="button" id="btn-kts-dl-front" class="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/30 transition flex items-center justify-between group text-left cursor-pointer active:scale-98">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 flex items-center justify-center text-sm shrink-0">
                            <i class="fa-solid fa-id-card"></i>
                        </div>
                        <div>
                            <p class="text-xs font-bold text-slate-800 dark:text-white group-hover:text-emerald-700 dark:group-hover:text-emerald-300">Sisi Depan (Front)</p>
                            <p class="text-[10px] text-slate-400">Pasfoto, Identitas Siswa & Universal QR Code</p>
                        </div>
                    </div>
                    <i class="fa-solid fa-arrow-down-to-line text-xs text-slate-400 group-hover:text-emerald-600 transition"></i>
                </button>

                <button type="button" id="btn-kts-dl-back" class="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/30 transition flex items-center justify-between group text-left cursor-pointer active:scale-98">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 flex items-center justify-center text-sm shrink-0">
                            <i class="fa-solid fa-arrows-rotate"></i>
                        </div>
                        <div>
                            <p class="text-xs font-bold text-slate-800 dark:text-white group-hover:text-emerald-700 dark:group-hover:text-emerald-300">Sisi Belakang (Back)</p>
                            <p class="text-[10px] text-slate-400">Visi Sekolah, Ikrar Pelajar, Ketentuan & TTD Kepsek</p>
                        </div>
                    </div>
                    <i class="fa-solid fa-arrow-down-to-line text-xs text-slate-400 group-hover:text-emerald-600 transition"></i>
                </button>

                <button type="button" id="btn-kts-dl-both" class="w-full p-3 rounded-xl border-2 border-emerald-500/60 bg-emerald-50/40 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition flex items-center justify-between group text-left cursor-pointer active:scale-98">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-sm shrink-0 shadow-xs">
                            <i class="fa-solid fa-copy"></i>
                        </div>
                        <div>
                            <div class="flex items-center gap-1.5">
                                <p class="text-xs font-bold text-emerald-900 dark:text-emerald-300">Kedua Sisi (Depan & Belakang)</p>
                                <span class="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-600 text-white uppercase tracking-wider">Lengkap</span>
                            </div>
                            <p class="text-[10px] text-slate-500 dark:text-slate-400">Format bersandingan (Ultra-HD 300 DPI Siap Cetak)</p>
                        </div>
                    </div>
                    <i class="fa-solid fa-arrow-down-to-line text-xs text-emerald-600 transition"></i>
                </button>
            </div>

            <!-- Status Proses -->
            <div id="kts-dl-status-box" class="hidden p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-center text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-2">
                <i class="fa-solid fa-spinner fa-spin text-emerald-600"></i>
                <span id="kts-dl-status-text">Menyiapkan kartu beresolusi tinggi...</span>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');

    const handleAction = async (side) => {
        const statusBox = document.getElementById('kts-dl-status-box');
        const statusText = document.getElementById('kts-dl-status-text');
        const btnFront = document.getElementById('btn-kts-dl-front');
        const btnBack = document.getElementById('btn-kts-dl-back');
        const btnBoth = document.getElementById('btn-kts-dl-both');

        if (statusBox) statusBox.classList.remove('hidden');
        if (statusText) statusText.textContent = `Memproses unduhan ${side === 'front' ? 'sisi depan' : (side === 'back' ? 'sisi belakang' : 'kedua sisi')}...`;
        if (btnFront) btnFront.disabled = true;
        if (btnBack) btnBack.disabled = true;
        if (btnBoth) btnBoth.disabled = true;

        try {
            await downloadKtsPng(student, side, options);
            setTimeout(() => {
                closeKtsDownloadModal();
            }, 500);
        } catch (err) {
            console.error('[KTS Download Error]:', err);
            if (statusText) statusText.textContent = 'Gagal mengunduh: ' + (err.message || 'Terjadi kesalahan');
        } finally {
            if (btnFront) btnFront.disabled = false;
            if (btnBack) btnBack.disabled = false;
            if (btnBoth) btnBoth.disabled = false;
        }
    };

    document.getElementById('btn-kts-dl-front')?.addEventListener('click', () => handleAction('front'));
    document.getElementById('btn-kts-dl-back')?.addEventListener('click', () => handleAction('back'));
    document.getElementById('btn-kts-dl-both')?.addEventListener('click', () => handleAction('both'));
}

export function closeKtsDownloadModal() {
    const modal = document.getElementById('kts-download-selector-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Global Browser Registration
const StudentCardRenderer = {
    isRegularStudentClass,
    isStudentCardActive,
    normalizeStudentCardData,
    formatBirthDateIndo,
    formatBirthPlace,
    formatAddressTitleCase,
    formatStudentCardAddress,
    renderKtsFrontHtml,
    renderKtsBackHtml,
    renderKtsPrintPairHtml,
    renderKtsInteractiveCard,
    renderKtsQrCode,
    printSingleKts,
    prepareKtsPrintCards,
    updateKtsCardScale,
    updateAllKtsCardScales,
    initKtsAutoScaler,
    generateKtsFrontCanvas,
    generateKtsBackCanvas,
    generateKtsBothCanvas,
    downloadKtsPng,
    openKtsDownloadModal,
    closeKtsDownloadModal,
    ensureCardAssetsLoaded,
    clearKtsBackCanvasCache
};

if (typeof window !== 'undefined') {
    window.StudentCardRenderer = StudentCardRenderer;
    window.isRegularStudentClass = isRegularStudentClass;
    window.isStudentCardActive = isStudentCardActive;
    window.updateKtsCardScale = updateKtsCardScale;
    window.updateAllKtsCardScales = updateAllKtsCardScales;
    window.initKtsAutoScaler = initKtsAutoScaler;
    window.downloadKtsPng = downloadKtsPng;
    window.openKtsDownloadModal = openKtsDownloadModal;
    window.closeKtsDownloadModal = closeKtsDownloadModal;
    window.ensureCardAssetsLoaded = ensureCardAssetsLoaded;
    window.clearKtsBackCanvasCache = clearKtsBackCanvasCache;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => initKtsAutoScaler());
    } else {
        initKtsAutoScaler();
    }
}

export default StudentCardRenderer;
