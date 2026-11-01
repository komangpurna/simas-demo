/**
 * js/workload-catalog-data.js
 * Master Katalog Tugas Pokok & Aktivitas Guru Sesuai Permendikdasmen No. 11/2025
 * SSOT Data Fallback & Cache Lokal (0ms Offline-Ready)
 */

export const STANDARD_WORKLOAD_CATALOG = Object.freeze([
    // 1. MERENCANAKAN PEMBELAJARAN ATAU PEMBIMBINGAN (Pasal 4)
    {
        id: "cat_rencana_kurikulum",
        code: "rencana_kurikulum",
        category_code: "PERENCANAAN",
        category_name: "Merencanakan Pembelajaran/Pembimbingan",
        name: "Pengkajian Kurikulum Satuan Pendidikan (CP, TP, ATP, KOSP)",
        description: "Pengkajian dan pemetaan capaian pembelajaran, tujuan pembelajaran, alur tujuan pembelajaran, dan kurikulum operasional sekolah (KOSP)",
        default_duration_minutes: 45,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 101,
        is_active: 1
    },
    {
        id: "cat_rencana_modul",
        code: "rencana_modul",
        category_code: "PERENCANAAN",
        category_name: "Merencanakan Pembelajaran/Pembimbingan",
        name: "Pembuatan Modul Ajar / RPP / RPL Bimbingan Konseling",
        description: "Penyusunan rencana pelaksanaan pembelajaran (RPP), modul ajar terpadu, atau rencana pelayanan bimbingan konseling (RPL BK) sesuai standar proses",
        default_duration_minutes: 45,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 102,
        is_active: 1
    },
    {
        id: "cat_evaluasi",
        code: "rencana_perangkat",
        category_code: "PERENCANAAN",
        category_name: "Merencanakan Pembelajaran/Pembimbingan",
        name: "Penyusunan Perangkat Ajar, Bahan Ajar, LKPD & Kisi-Kisi",
        description: "Pengembangan media instruksional, materi bahan ajar digital/cetak, lembar kerja murid, serta instrumen kisi-kisi pembelajaran",
        default_duration_minutes: 45,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 103,
        is_active: 1
    },

    // 2. MELAKSANAKAN PEMBELAJARAN ATAU PEMBIMBINGAN (Pasal 5, 13)
    {
        id: "cat_kbm",
        code: "kbm_intrakurikuler",
        category_code: "PELAKSANAAN_KBM",
        category_name: "Melaksanakan Pembelajaran/Pembimbingan",
        name: "KBM Tatap Muka Intrakurikuler di Kelas / Laboratorium",
        description: "Interaksi tatap muka langsung antara guru dan murid dalam pembelajaran mata pelajaran sesuai struktur kurikulum SMA (24–40 Jam Tatap Muka/minggu)",
        default_duration_minutes: 45,
        is_teaching: 1,
        requires_evidence: 0,
        sort_order: 201,
        is_active: 1
    },
    {
        id: "cat_kbm_p5",
        code: "kbm_kokurikuler_p5",
        category_code: "PELAKSANAAN_KBM",
        category_name: "Melaksanakan Pembelajaran/Pembimbingan",
        name: "Pembelajaran Kokurikuler (Projek Penguatan Profil Pelajar Pancasila / P5)",
        description: "Fasilitasi pembelajaran berbasis projek interdisipliner penguatan karakter dan kompetensi profil pelajar Pancasila",
        default_duration_minutes: 45,
        is_teaching: 1,
        requires_evidence: 0,
        sort_order: 202,
        is_active: 1
    },
    {
        id: "cat_kbm_ekstra",
        code: "kbm_ekstrakurikuler",
        category_code: "PELAKSANAAN_KBM",
        category_name: "Melaksanakan Pembelajaran/Pembimbingan",
        name: "Pembelajaran Ekstrakurikuler",
        description: "Pelaksanaan kegiatan pembelajaran dan pelatihan ekstrakurikuler terstruktur sesuai minat bakat murid",
        default_duration_minutes: 45,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 203,
        is_active: 1
    },
    {
        id: "cat_bk",
        code: "layanan_bk",
        category_code: "PELAKSANAAN_KBM",
        category_name: "Melaksanakan Pembelajaran/Pembimbingan",
        name: "Pelaksanaan Pembimbingan Bimbingan & Konseling (BK)",
        description: "Layanan bimbingan klasikal, bimbingan kelompok, konseling individual, dan bimbingan lintas kelas untuk mendukung kemandirian murid (minimal 5 rombel/tahun)",
        default_duration_minutes: 45,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 204,
        is_active: 1
    },

    // 3. MENILAI HASIL PEMBELAJARAN ATAU PEMBIMBINGAN (Pasal 7)
    {
        id: "cat_nilai_formatif",
        code: "asesmen_formatif",
        category_code: "PENILAIAN",
        category_name: "Menilai Hasil Pembelajaran/Pembimbingan",
        name: "Pelaksanaan Asesmen Formatif (Penilaian Proses & Diagnostik)",
        description: "Pengumpulan informasi secara berkala selama proses KBM untuk memantau kemajuan belajar murid, kuis harian, dan umpan balik langsung",
        default_duration_minutes: 45,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 301,
        is_active: 1
    },
    {
        id: "cat_nilai_sumatif",
        code: "asesmen_sumatif",
        category_code: "PENILAIAN",
        category_name: "Menilai Hasil Pembelajaran/Pembimbingan",
        name: "Pelaksanaan Asesmen Sumatif (Lingkup Materi, STS, SAS, SAT/Ujian)",
        description: "Pengujian dan pengukuran pencapaian hasil belajar murid pada akhir lingkup materi, asesmen tengah semester, atau akhir semester/tahun",
        default_duration_minutes: 90,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 302,
        is_active: 1
    },
    {
        id: "cat_nilai_olah",
        code: "pengolahan_nilai",
        category_code: "PENILAIAN",
        category_name: "Menilai Hasil Pembelajaran/Pembimbingan",
        name: "Pengolahan Nilai Rapor, Remedial, dan Pengayaan",
        description: "Analisis ketuntasan tujuan pembelajaran, pelaksanaan program remedial bagi murid belum tuntas, dan program pengayaan",
        default_duration_minutes: 45,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 303,
        is_active: 1
    },
    {
        id: "cat_nilai_bk",
        code: "evaluasi_bk",
        category_code: "PENILAIAN",
        category_name: "Menilai Hasil Pembelajaran/Pembimbingan",
        name: "Evaluasi Hasil Layanan Bimbingan & Konseling (BK)",
        description: "Penilaian ketercapaian tujuan layanan BK, analisis sosiometri/angket kebutuhan murid, dan tindak lanjut konseling",
        default_duration_minutes: 45,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 304,
        is_active: 1
    },
    {
        id: "cat_administrasi",
        code: "administrasi_nilai",
        category_code: "PENILAIAN",
        category_name: "Menilai Hasil Pembelajaran/Pembimbingan",
        name: "Pengadministrasian Nilai, Buku Nilai Guru Mapel & Pelaporan",
        description: "Penginputan nilai ke sistem buku nilai/e-rapor, penyusunan deskripsi capaian kompetensi, dan pelaporan hasil belajar",
        default_duration_minutes: 45,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 305,
        is_active: 1
    },

    // 4. MEMBIMBING DAN MELATIH MURID (Pasal 8, 9, 14)
    {
        id: "cat_bimbing_guru_wali",
        code: "guru_wali",
        category_code: "PEMBIMBINGAN",
        category_name: "Membimbing dan Melatih Murid",
        name: "Pendampingan Murid Dampingan sebagai Guru Wali",
        description: "Melaksanakan pendampingan akademik, pengembangan kompetensi, keterampilan, dan karakter murid dampingan secara berkelanjutan",
        default_duration_minutes: 90,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 401,
        is_active: 1
    },
    {
        id: "cat_bimbing_p5",
        code: "pendampingan_p5",
        category_code: "PEMBIMBINGAN",
        category_name: "Membimbing dan Melatih Murid",
        name: "Fasilitasi & Pendampingan Murid dalam Projek Kokurikuler (P5)",
        description: "Membimbing dan melatih murid dalam menggali tema projek, memecahkan masalah kontekstual, dan menyusun pameran karya P5",
        default_duration_minutes: 90,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 402,
        is_active: 1
    },
    {
        id: "cat_ekstra",
        code: "bimbingan_ekstrakurikuler",
        category_code: "PEMBIMBINGAN",
        category_name: "Membimbing dan Melatih Murid",
        name: "Pembimbingan & Pelatihan Murid dalam Ekstrakurikuler",
        description: "Melatih keterampilan teknis, kepemimpinan, dan kedisiplinan murid dalam bidang ekstrakurikuler sekolah",
        default_duration_minutes: 90,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 403,
        is_active: 1
    },
    {
        id: "cat_bimbing_lomba",
        code: "pembimbingan_lomba",
        category_code: "PEMBIMBINGAN",
        category_name: "Membimbing dan Melatih Murid",
        name: "Pembimbingan Siswa Persiapan Lomba / Olimpiade / Prestasi",
        description: "Pelatihan intensif dan pendampingan murid berbakat dalam ajang OSN, O2SN, FLS2N, debat, karya tulis ilmiah, dan kompetisi akademik/non-akademik",
        default_duration_minutes: 90,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 404,
        is_active: 1
    },

    // 5. MELAKSANAKAN TUGAS TAMBAHAN YANG MELEKAT (Pasal 10, 11, Lampiran)
    // A. Tugas Tambahan Utama (Ekuivalensi 12 Jam TM / 3 Rombel BK - Pasal 15 ayat 1)
    {
        id: "cat_tt_waka_kurikulum",
        code: "waka_kurikulum",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Wakil Kepala Sekolah Bidang Kurikulum",
        description: "Membantu Kepala Sekolah dalam merencanakan, mengorganisasikan, melaksanakan, mengendalikan, mengevaluasi, dan melaporkan seluruh kegiatan bidang kurikulum dan pembelajaran",
        equivalent_jp: 12,
        default_duration_minutes: 540,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 501,
        is_active: 1
    },
    {
        id: "cat_tt_waka_kesiswaan",
        code: "waka_kesiswaan",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Wakil Kepala Sekolah Bidang Kesiswaan",
        description: "Membantu Kepala Sekolah dalam merencanakan, mengembangkan, melaksanakan, membina, mengawasi, dan mengevaluasi seluruh program yang berkaitan dengan peserta didik",
        equivalent_jp: 12,
        default_duration_minutes: 540,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 502,
        is_active: 1
    },
    {
        id: "cat_tt_waka_sarpras",
        code: "waka_sarpras",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Wakil Kepala Sekolah Bidang Sarana dan Prasarana",
        description: "Membantu Kepala Sekolah dalam perencanaan, pengadaan, pemanfaatan, pemeliharaan, pengamanan, inventarisasi, dan evaluasi sarana dan prasarana sekolah",
        equivalent_jp: 12,
        default_duration_minutes: 540,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 503,
        is_active: 1
    },
    {
        id: "cat_tt_waka_humas",
        code: "waka_humas",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Wakil Kepala Sekolah Bidang Hubungan Masyarakat (Humas)",
        description: "Membantu Kepala Sekolah dalam membangun komunikasi, kemitraan, citra positif, partisipasi masyarakat, serta hubungan sekolah dengan orang tua, pemerintah, dunia usaha/dunia industri, perguruan tinggi, dan pemangku kepentingan lainnya",
        equivalent_jp: 12,
        default_duration_minutes: 540,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 504,
        is_active: 1
    },
    {
        id: "cat_tt_waka",
        code: "waka_sekolah",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Wakil Kepala Sekolah (Waka)",
        description: "Membantu Kepala Sekolah dalam bidang Kurikulum, Kesiswaan, Sarana Prasarana, atau Humas",
        default_duration_minutes: 540,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 505,
        is_active: 0
    },
    {
        id: "cat_tt_kepala_perpus",
        code: "kepala_perpustakaan",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Kepala Perpustakaan Sekolah",
        description: "Pengelolaan layanan sirkulasi, literasi, pengadaan koleksi, dan pengembangan perpustakaan sekolah",
        default_duration_minutes: 540,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 502,
        is_active: 1
    },
    {
        id: "cat_tt_kepala_lab",
        code: "kepala_laboratorium",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Kepala Laboratorium Sekolah",
        description: "Pengelolaan sarana laboratorium IPA, Laboratorium Komputer, atau Laboratorium Bahasa",
        default_duration_minutes: 540,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 503,
        is_active: 1
    },
    {
        id: "cat_tt_gpk",
        code: "guru_pembimbing_khusus",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Guru Pembimbing Khusus (GPK) Inklusif",
        description: "Pendampingan murid berkebutuhan khusus pada satuan pendidikan yang menyelenggarakan pendidikan inklusif",
        default_duration_minutes: 270,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 504,
        is_active: 1
    },
    // B. Tugas Tambahan Lain (Ekuivalensi Kumulatif Maksimal 6 Jam TM / Lampiran)
    {
        id: "cat_wali_kelas",
        code: "wali_kelas",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Wali Kelas SMA",
        description: "Pengelolaan administrasi kelas binaan, presensi, pembinaan murid, hubungan dengan orang tua/wali murid, dan buku rapor",
        default_duration_minutes: 90,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 505,
        is_active: 1
    },
    {
        id: "cat_pembina_osis",
        code: "pembina_osis",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Pembina OSIS / MPK",
        description: "Pembimbingan organisasi kesiswaan, kepemimpinan siswa, musyawarah perwakilan kelas, dan program kerja OSIS",
        default_duration_minutes: 90,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 506,
        is_active: 1
    },
    {
        id: "cat_tt_koor_pkb",
        code: "koordinator_pkb",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Koordinator Pengembangan Kompetensi Guru",
        description: "Pengelolaan dan koordinasi program pengembangan keprofesian berkelanjutan di satuan pendidikan",
        default_duration_minutes: 90,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 507,
        is_active: 1
    },
    {
        id: "cat_piket",
        code: "guru_piket",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Guru Piket Sekolah",
        description: "Menjaga ketertiban lingkungan sekolah, mencatat presensi harian, mengoordinasikan kelas saat guru berhalangan, dan menerima tamu dinas",
        default_duration_minutes: 45,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 508,
        is_active: 1
    },
    {
        id: "cat_tt_koor_p5",
        code: "koordinator_p5",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Koordinator Pembelajaran Berbasis Projek (P5)",
        description: "Mengoordinasikan perancangan tema, modul projek, dan asesmen P5 lintas mata pelajaran",
        default_duration_minutes: 90,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 509,
        is_active: 1
    },
    {
        id: "cat_tt_koor_inklusi",
        code: "koordinator_inklusi",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Koordinator Pendidikan Inklusi",
        description: "Mengoordinasikan program identifikasi, asesmen awal, dan akomodasi pembelajaran ramah murid berkebutuhan khusus",
        default_duration_minutes: 90,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 510,
        is_active: 1
    },
    {
        id: "cat_tt_tppk",
        code: "tppk_sekolah",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Tim Pencegahan & Penanganan Kekerasan (TPPK)",
        description: "Satuan tugas pencegahan kekerasan, perlindungan pendidik dan tenaga kependidikan di lingkungan sekolah",
        default_duration_minutes: 90,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 511,
        is_active: 1
    },
    {
        id: "cat_tt_panitia_acara",
        code: "panitia_acara",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Pengurus Kepanitiaan Acara Sekolah (Ketua/Sekretaris/Bendahara)",
        description: "Kepanitiaan acara resmi di satuan pendidikan seperti HUT Sekolah, MPLS, Ujian Sekolah, atau Pelepasan Siswa",
        default_duration_minutes: 45,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 512,
        is_active: 1
    },
    {
        id: "cat_tt_organisasi_profesi",
        code: "pengurus_organisasi_profesi",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Pengurus Organisasi Profesi Pendidik (PGRI / IGI)",
        description: "Kepengurusan aktif organisasi profesi guru di tingkat nasional (3 JP), provinsi (2 JP), atau kabupaten/kota (1 JP)",
        default_duration_minutes: 45,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 513,
        is_active: 1
    },
    {
        id: "cat_mgmp",
        code: "koordinator_mgmp",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Koordinator MGMP Kabupaten / Gugus",
        description: "Mengoordinasikan kegiatan musyawarah guru mata pelajaran untuk peningkatan mutu pembelajaran",
        default_duration_minutes: 45,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 514,
        is_active: 1
    },
    {
        id: "cat_tt_narasumber",
        code: "narasumber_pelatihan",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Instruktur / Narasumber / Fasilitator Nasional",
        description: "Menjadi narasumber/fasilitator program pengembangan kompetensi tingkat nasional bidang pendidikan",
        default_duration_minutes: 45,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 515,
        is_active: 1
    },
    {
        id: "cat_tt_peserta_pelatihan",
        code: "peserta_pkb_kombel",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Peserta Program PKB Terstruktur / Komunitas Belajar (Kombel)",
        description: "Mengikuti pelatihan terstruktur atau kegiatan berbagi praktik baik di Komunitas Belajar sekolah/MGMP",
        default_duration_minutes: 45,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 516,
        is_active: 1
    },
    {
        id: "cat_upacara",
        code: "upacara",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Upacara Bendera / Apel Pagi (selain Senin)",
        description: "Mengikuti upacara bendera hari besar nasional/peringatan khusus atau apel pagi pembinaan karakter bersama seluruh siswa dan guru di luar hari Senin",
        default_duration_minutes: 45,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 517,
        is_active: 1
    },
    {
        id: "cat_tt_dinas",
        code: "tugas_kedinasan_pimpinan",
        category_code: "TUGAS_TAMBAHAN",
        category_name: "Melaksanakan Tugas Tambahan",
        name: "Tugas Kedinasan / Penugasan Khusus dari Pimpinan (Pasal 19)",
        description: "Penugasan kedinasan di bidang pendidikan yang diberikan oleh Kepala Dinas Pendidikan atau Kepala Sekolah yang diakui dalam pemenuhan beban kerja 37,5 jam/minggu",
        default_duration_minutes: 45,
        is_teaching: 0,
        requires_evidence: 0,
        sort_order: 518,
        is_active: 1
    }
]);

const WORKLOAD_CATALOG_STORAGE_KEY = 'simas_workload_catalog';

/**
 * Mendapatkan katalog beban kerja awal (0ms instant render)
 * Memprioritaskan data ter-cache di localStorage, jika kosong langsung memakai STANDARD_WORKLOAD_CATALOG
 */
export function getCachedWorkloadCatalog() {
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(WORKLOAD_CATALOG_STORAGE_KEY);
            if (raw) {
                let parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length >= 10) {
                    let hasOldName = false;
                    parsed = parsed.map(c => {
                        let name = c.name || '';
                        if (name.startsWith('Tugas Tambahan: ')) {
                            hasOldName = true;
                            name = name.replace(/^Tugas Tambahan:\s*/i, '');
                        }
                        if (name === 'Upacara Bendera / Apel Pagi (Hari Senin)') {
                            hasOldName = true;
                            name = 'Upacara Bendera / Apel Pagi (selain Senin)';
                        }
                        return { ...c, name };
                    });
                    if (hasOldName) {
                        localStorage.setItem(WORKLOAD_CATALOG_STORAGE_KEY, JSON.stringify(parsed));
                    }
                    // Jika data cache lama belum memuat 4 Waka spesifik, segarkan dari STANDARD_WORKLOAD_CATALOG
                    const hasSpecificWaka = parsed.some(c => c.id === 'cat_tt_waka_kurikulum');
                    if (!hasSpecificWaka) {
                        localStorage.setItem(WORKLOAD_CATALOG_STORAGE_KEY, JSON.stringify(STANDARD_WORKLOAD_CATALOG));
                        return Array.from(STANDARD_WORKLOAD_CATALOG);
                    }
                    return parsed;
                }
            }
        }
    } catch (_) {}
    return Array.from(STANDARD_WORKLOAD_CATALOG);
}

/**
 * Menyimpan katalog terbaru yang diterima dari server Cloudflare D1 ke cache localStorage
 */
export function setCachedWorkloadCatalog(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    try {
        if (typeof localStorage !== 'undefined') {
            const cleaned = items.map(c => {
                let name = c.name || '';
                if (name.startsWith('Tugas Tambahan: ')) {
                    name = name.replace(/^Tugas Tambahan:\s*/i, '');
                }
                if (name === 'Upacara Bendera / Apel Pagi (Hari Senin)') {
                    name = 'Upacara Bendera / Apel Pagi (selain Senin)';
                }
                return { ...c, name };
            });
            localStorage.setItem(WORKLOAD_CATALOG_STORAGE_KEY, JSON.stringify(cleaned));
        }
    } catch (_) {}
}

// ========== SPESIFIKASI KHUSUS TUGAS TAMBAHAN WAKIL KEPALA SEKOLAH (WAKA) ==========

export const WAKA_TYPES = Object.freeze({
    KURIKULUM: 'kurikulum',
    KESISWAAN: 'kesiswaan',
    SARPRAS: 'sarpras',
    HUMAS: 'humas',
    kurikulum: 'kurikulum',
    kesiswaan: 'kesiswaan',
    sarpras: 'sarpras',
    humas: 'humas'
});

export const WAKA_MAIN_DUTIES_INFO = {
    kurikulum: {
        type: 'kurikulum',
        title: 'Waka Bidang Kurikulum',
        catalog_id: 'cat_tt_waka_kurikulum',
        main_duty: 'Membantu Kepala Sekolah dalam merencanakan, mengorganisasikan, melaksanakan, mengendalikan, mengevaluasi, dan melaporkan seluruh kegiatan bidang kurikulum dan pembelajaran.',
        description: 'Membantu Kepala Sekolah dalam merencanakan, mengorganisasikan, melaksanakan, mengendalikan, mengevaluasi, dan melaporkan seluruh kegiatan bidang kurikulum dan pembelajaran.'
    },
    kesiswaan: {
        type: 'kesiswaan',
        title: 'Waka Bidang Kesiswaan',
        catalog_id: 'cat_tt_waka_kesiswaan',
        main_duty: 'Membantu Kepala Sekolah dalam merencanakan, mengembangkan, melaksanakan, membina, mengawasi, dan mengevaluasi seluruh program yang berkaitan dengan peserta didik.',
        description: 'Membantu Kepala Sekolah dalam merencanakan, mengembangkan, melaksanakan, membina, mengawasi, dan mengevaluasi seluruh program yang berkaitan dengan peserta didik.'
    },
    sarpras: {
        type: 'sarpras',
        title: 'Waka Bidang Sarana dan Prasarana',
        catalog_id: 'cat_tt_waka_sarpras',
        main_duty: 'Membantu Kepala Sekolah dalam perencanaan, pengadaan, pemanfaatan, pemeliharaan, pengamanan, inventarisasi, dan evaluasi sarana dan prasarana sekolah.',
        description: 'Membantu Kepala Sekolah dalam perencanaan, pengadaan, pemanfaatan, pemeliharaan, pengamanan, inventarisasi, dan evaluasi sarana dan prasarana sekolah.'
    },
    humas: {
        type: 'humas',
        title: 'Waka Bidang Hubungan Masyarakat (Humas)',
        catalog_id: 'cat_tt_waka_humas',
        main_duty: 'Membantu Kepala Sekolah dalam membangun komunikasi, kemitraan, citra positif, partisipasi masyarakat, serta hubungan sekolah dengan orang tua, pemerintah, dunia usaha/dunia industri, perguruan tinggi, dan pemangku kepentingan lainnya.',
        description: 'Membantu Kepala Sekolah dalam membangun komunikasi, kemitraan, citra positif, partisipasi masyarakat, serta hubungan sekolah dengan orang tua, pemerintah, dunia usaha/dunia industri, perguruan tinggi, dan pemangku kepentingan lainnya.'
    }
};

export const WAKA_DUTIES_INITIAL_SEED = [
    // A. WAKA KURIKULUM (1-20)
    { id: 'waka_kur_01', waka_type: 'kurikulum', duty_number: 1, duty_title: 'Menyusun program kerja bidang kurikulum berdasarkan visi, misi, tujuan, KOSP, RKT, dan kebijakan pendidikan yang berlaku.', is_active: 1 },
    { id: 'waka_kur_02', waka_type: 'kurikulum', duty_number: 2, duty_title: 'Mengkoordinasikan penyusunan, peninjauan, dan pengembangan Kurikulum Satuan Pendidikan (KSP/KOSP).', is_active: 1 },
    { id: 'waka_kur_03', waka_type: 'kurikulum', duty_number: 3, duty_title: 'Mengkoordinasikan penyusunan struktur kurikulum, alokasi waktu, kalender pendidikan, dan jadwal pembelajaran.', is_active: 1 },
    { id: 'waka_kur_04', waka_type: 'kurikulum', duty_number: 4, duty_title: 'Mengkoordinasikan penyusunan pembagian tugas mengajar guru dan tugas tambahan terkait pembelajaran.', is_active: 1 },
    { id: 'waka_kur_05', waka_type: 'kurikulum', duty_number: 5, duty_title: 'Menyusun jadwal pelajaran, jadwal piket guru, dan pengaturan kegiatan pembelajaran lainnya.', is_active: 1 },
    { id: 'waka_kur_06', waka_type: 'kurikulum', duty_number: 6, duty_title: 'Mengkoordinasikan penyusunan perangkat pembelajaran oleh guru sesuai ketentuan yang berlaku.', is_active: 1 },
    { id: 'waka_kur_07', waka_type: 'kurikulum', duty_number: 7, duty_title: 'Memantau keterlaksanaan proses pembelajaran secara efektif, aktif, berpusat pada peserta didik, dan sesuai dengan prinsip pembelajaran mendalam.', is_active: 1 },
    { id: 'waka_kur_08', waka_type: 'kurikulum', duty_number: 8, duty_title: 'Mengkoordinasikan pelaksanaan asesmen diagnostik, formatif, sumatif, dan bentuk asesmen lainnya.', is_active: 1 },
    { id: 'waka_kur_09', waka_type: 'kurikulum', duty_number: 9, duty_title: 'Mengkoordinasikan pengolahan, analisis, dan pelaporan hasil belajar peserta didik.', is_active: 1 },
    { id: 'waka_kur_10', waka_type: 'kurikulum', duty_number: 10, duty_title: 'Mengkoordinasikan pelaksanaan remedial, pengayaan, pendampingan, dan tindak lanjut hasil asesmen.', is_active: 1 },
    { id: 'waka_kur_11', waka_type: 'kurikulum', duty_number: 11, duty_title: 'Mengkoordinasikan pelaksanaan Projek/P5 atau kegiatan kokurikuler sesuai kebijakan kurikulum yang berlaku.', is_active: 1 },
    { id: 'waka_kur_12', waka_type: 'kurikulum', duty_number: 12, duty_title: 'Mengkoordinasikan pelaksanaan kegiatan intrakurikuler, kokurikuler, dan kegiatan akademik lainnya.', is_active: 1 },
    { id: 'waka_kur_13', waka_type: 'kurikulum', duty_number: 13, duty_title: 'Mengkoordinasikan pelaksanaan ujian, asesmen, dan kegiatan evaluasi pendidikan tingkat sekolah.', is_active: 1 },
    { id: 'waka_kur_14', waka_type: 'kurikulum', duty_number: 14, duty_title: 'Mengelola administrasi dan dokumentasi bidang kurikulum.', is_active: 1 },
    { id: 'waka_kur_15', waka_type: 'kurikulum', duty_number: 15, duty_title: 'Mengkoordinasikan kegiatan MGMP internal sekolah dan pengembangan kompetensi guru dalam bidang pembelajaran.', is_active: 1 },
    { id: 'waka_kur_16', waka_type: 'kurikulum', duty_number: 16, duty_title: 'Menganalisis hasil Rapor Pendidikan dan data hasil belajar sebagai dasar perbaikan pembelajaran.', is_active: 1 },
    { id: 'waka_kur_17', waka_type: 'kurikulum', duty_number: 17, duty_title: 'Mengkoordinasikan tindak lanjut hasil supervisi akademik bersama Kepala Sekolah.', is_active: 1 },
    { id: 'waka_kur_18', waka_type: 'kurikulum', duty_number: 18, duty_title: 'Mengawasi ketertiban administrasi pembelajaran dan kehadiran guru dalam melaksanakan pembelajaran.', is_active: 1 },
    { id: 'waka_kur_19', waka_type: 'kurikulum', duty_number: 19, duty_title: 'Berkoordinasi dengan Waka Kesiswaan terkait kegiatan peserta didik yang berpengaruh terhadap proses pembelajaran.', is_active: 1 },
    { id: 'waka_kur_20', waka_type: 'kurikulum', duty_number: 20, duty_title: 'Menyusun laporan pelaksanaan program bidang kurikulum kepada Kepala Sekolah secara berkala.', is_active: 1 },

    // B. WAKA KESISWAAN (1-20)
    { id: 'waka_kes_01', waka_type: 'kesiswaan', duty_number: 1, duty_title: 'Menyusun program kerja bidang kesiswaan berdasarkan visi, misi, tujuan sekolah, dan kebutuhan peserta didik.', is_active: 1 },
    { id: 'waka_kes_02', waka_type: 'kesiswaan', duty_number: 2, duty_title: 'Mengkoordinasikan penerimaan dan pengelolaan peserta didik baru sesuai ketentuan yang berlaku.', is_active: 1 },
    { id: 'waka_kes_03', waka_type: 'kesiswaan', duty_number: 3, duty_title: 'Mengkoordinasikan kegiatan Masa Pengenalan Lingkungan Sekolah (MPLS).', is_active: 1 },
    { id: 'waka_kes_04', waka_type: 'kesiswaan', duty_number: 4, duty_title: 'Mengkoordinasikan pembinaan karakter, kedisiplinan, tanggung jawab, etika, dan budaya positif peserta didik.', is_active: 1 },
    { id: 'waka_kes_05', waka_type: 'kesiswaan', duty_number: 5, duty_title: 'Mengkoordinasikan pelaksanaan tata tertib dan peraturan sekolah.', is_active: 1 },
    { id: 'waka_kes_06', waka_type: 'kesiswaan', duty_number: 6, duty_title: 'Melakukan pembinaan terhadap peserta didik yang mengalami masalah kedisiplinan maupun masalah sosial/pendidikan.', is_active: 1 },
    { id: 'waka_kes_07', waka_type: 'kesiswaan', duty_number: 7, duty_title: 'Mengkoordinasikan layanan bimbingan dan konseling bersama guru BK.', is_active: 1 },
    { id: 'waka_kes_08', waka_type: 'kesiswaan', duty_number: 8, duty_title: 'Mengkoordinasikan kegiatan OSIS dan organisasi/kegiatan kepemimpinan peserta didik.', is_active: 1 },
    { id: 'waka_kes_09', waka_type: 'kesiswaan', duty_number: 9, duty_title: 'Membina dan mengembangkan kegiatan ekstrakurikuler.', is_active: 1 },
    { id: 'waka_kes_10', waka_type: 'kesiswaan', duty_number: 10, duty_title: 'Mengkoordinasikan kegiatan pengembangan bakat, minat, prestasi, dan kreativitas peserta didik.', is_active: 1 },
    { id: 'waka_kes_11', waka_type: 'kesiswaan', duty_number: 11, duty_title: 'Mengkoordinasikan keikutsertaan peserta didik dalam berbagai lomba dan kompetisi akademik maupun nonakademik.', is_active: 1 },
    { id: 'waka_kes_12', waka_type: 'kesiswaan', duty_number: 12, duty_title: 'Mengkoordinasikan kegiatan upacara, peringatan hari besar nasional, keagamaan, dan kegiatan pembentukan karakter.', is_active: 1 },
    { id: 'waka_kes_13', waka_type: 'kesiswaan', duty_number: 13, duty_title: 'Mengkoordinasikan program pencegahan perundungan, kekerasan, diskriminasi, dan perilaku negatif lainnya.', is_active: 1 },
    { id: 'waka_kes_14', waka_type: 'kesiswaan', duty_number: 14, duty_title: 'Mengembangkan budaya sekolah yang aman, nyaman, inklusif, humanis, dan berpusat pada peserta didik.', is_active: 1 },
    { id: 'waka_kes_15', waka_type: 'kesiswaan', duty_number: 15, duty_title: 'Memantau kehadiran, keterlambatan, dan perkembangan kedisiplinan peserta didik.', is_active: 1 },
    { id: 'waka_kes_16', waka_type: 'kesiswaan', duty_number: 16, duty_title: 'Mengkoordinasikan pemberian penghargaan kepada peserta didik berprestasi.', is_active: 1 },
    { id: 'waka_kes_17', waka_type: 'kesiswaan', duty_number: 17, duty_title: 'Mengkoordinasikan penanganan peserta didik yang membutuhkan pendampingan khusus bersama pihak terkait.', is_active: 1 },
    { id: 'waka_kes_18', waka_type: 'kesiswaan', duty_number: 18, duty_title: 'Mengkoordinasikan kegiatan sosial, kepedulian lingkungan, kesehatan, dan pengembangan karakter peserta didik.', is_active: 1 },
    { id: 'waka_kes_19', waka_type: 'kesiswaan', duty_number: 19, duty_title: 'Berkoordinasi dengan Waka Kurikulum terkait permasalahan peserta didik yang berdampak terhadap pembelajaran.', is_active: 1 },
    { id: 'waka_kes_20', waka_type: 'kesiswaan', duty_number: 20, duty_title: 'Menyusun laporan pelaksanaan program bidang kesiswaan kepada Kepala Sekolah secara berkala.', is_active: 1 },

    // C. WAKA SARANA DAN PRASARANA (1-20)
    { id: 'waka_sar_01', waka_type: 'sarpras', duty_number: 1, duty_title: 'Menyusun program kerja bidang sarana dan prasarana berdasarkan kebutuhan dan prioritas sekolah.', is_active: 1 },
    { id: 'waka_sar_02', waka_type: 'sarpras', duty_number: 2, duty_title: 'Mengidentifikasi kebutuhan sarana dan prasarana untuk mendukung pembelajaran dan layanan sekolah.', is_active: 1 },
    { id: 'waka_sar_03', waka_type: 'sarpras', duty_number: 3, duty_title: 'Menyusun skala prioritas kebutuhan sarana dan prasarana berdasarkan data dan kemampuan sekolah.', is_active: 1 },
    { id: 'waka_sar_04', waka_type: 'sarpras', duty_number: 4, duty_title: 'Mengusulkan pengadaan sarana dan prasarana sesuai perencanaan dan ketentuan yang berlaku.', is_active: 1 },
    { id: 'waka_sar_05', waka_type: 'sarpras', duty_number: 5, duty_title: 'Mengkoordinasikan penerimaan, penyimpanan, pendistribusian, dan pemanfaatan barang sekolah.', is_active: 1 },
    { id: 'waka_sar_06', waka_type: 'sarpras', duty_number: 6, duty_title: 'Mengkoordinasikan inventarisasi sarana dan prasarana sekolah.', is_active: 1 },
    { id: 'waka_sar_07', waka_type: 'sarpras', duty_number: 7, duty_title: 'Memastikan penggunaan sarana dan prasarana secara efektif, efisien, aman, dan bertanggung jawab.', is_active: 1 },
    { id: 'waka_sar_08', waka_type: 'sarpras', duty_number: 8, duty_title: 'Mengkoordinasikan pemeliharaan gedung, ruang kelas, ruang kerja, laboratorium, perpustakaan, toilet, halaman, dan fasilitas lainnya.', is_active: 1 },
    { id: 'waka_sar_09', waka_type: 'sarpras', duty_number: 9, duty_title: 'Mengkoordinasikan perbaikan sarana dan prasarana yang mengalami kerusakan.', is_active: 1 },
    { id: 'waka_sar_10', waka_type: 'sarpras', duty_number: 10, duty_title: 'Melakukan pemantauan kondisi fasilitas sekolah secara berkala.', is_active: 1 },
    { id: 'waka_sar_11', waka_type: 'sarpras', duty_number: 11, duty_title: 'Mengkoordinasikan kebersihan, keindahan, kenyamanan, keamanan, dan lingkungan sekolah.', is_active: 1 },
    { id: 'waka_sar_12', waka_type: 'sarpras', duty_number: 12, duty_title: 'Mengembangkan lingkungan sekolah yang sehat, hijau, ramah lingkungan, dan mendukung pembelajaran.', is_active: 1 },
    { id: 'waka_sar_13', waka_type: 'sarpras', duty_number: 13, duty_title: 'Mengkoordinasikan pemanfaatan ruang dan fasilitas sekolah agar tidak terjadi tumpang tindih penggunaan.', is_active: 1 },
    { id: 'waka_sar_14', waka_type: 'sarpras', duty_number: 14, duty_title: 'Berkoordinasi dengan pengelola BMD/aset sekolah terkait pencatatan dan pengelolaan barang milik daerah.', is_active: 1 },
    { id: 'waka_sar_15', waka_type: 'sarpras', duty_number: 15, duty_title: 'Mengidentifikasi barang rusak, tidak layak pakai, hilang, atau memerlukan penghapusan sesuai prosedur.', is_active: 1 },
    { id: 'waka_sar_16', waka_type: 'sarpras', duty_number: 16, duty_title: 'Mengawasi penggunaan fasilitas sekolah oleh warga sekolah maupun pihak luar.', is_active: 1 },
    { id: 'waka_sar_17', waka_type: 'sarpras', duty_number: 17, duty_title: 'Mengkoordinasikan kesiapan sarana prasarana untuk kegiatan sekolah, asesmen, lomba, upacara, dan kegiatan lainnya.', is_active: 1 },
    { id: 'waka_sar_18', waka_type: 'sarpras', duty_number: 18, duty_title: 'Mendukung penerapan keselamatan, keamanan, kesehatan, dan mitigasi risiko di lingkungan sekolah.', is_active: 1 },
    { id: 'waka_sar_19', waka_type: 'sarpras', duty_number: 19, duty_title: 'Menyusun dokumentasi kondisi dan perkembangan sarana prasarana sekolah.', is_active: 1 },
    { id: 'waka_sar_20', waka_type: 'sarpras', duty_number: 20, duty_title: 'Menyusun laporan pelaksanaan program sarana dan prasarana kepada Kepala Sekolah secara berkala.', is_active: 1 },

    // D. WAKA HUBUNGAN MASYARAKAT (HUMAS) (1-20)
    { id: 'waka_hum_01', waka_type: 'humas', duty_number: 1, duty_title: 'Menyusun program kerja bidang hubungan masyarakat berdasarkan visi, misi, dan program sekolah.', is_active: 1 },
    { id: 'waka_hum_02', waka_type: 'humas', duty_number: 2, duty_title: 'Membangun dan memelihara hubungan yang harmonis antara sekolah dengan orang tua/wali peserta didik.', is_active: 1 },
    { id: 'waka_hum_03', waka_type: 'humas', duty_number: 3, duty_title: 'Mengkoordinasikan komunikasi sekolah dengan komite sekolah.', is_active: 1 },
    { id: 'waka_hum_04', waka_type: 'humas', duty_number: 4, duty_title: 'Membangun kemitraan dengan pemerintah, lembaga pendidikan, perguruan tinggi, dunia usaha/dunia industri, lembaga sosial, dan masyarakat.', is_active: 1 },
    { id: 'waka_hum_05', waka_type: 'humas', duty_number: 5, duty_title: 'Mengkoordinasikan pelaksanaan kerja sama/MoU/MoA sekolah dengan pihak eksternal sesuai kewenangan Kepala Sekolah.', is_active: 1 },
    { id: 'waka_hum_06', waka_type: 'humas', duty_number: 6, duty_title: 'Mengembangkan jejaring kemitraan untuk mendukung peningkatan mutu pendidikan dan prestasi peserta didik.', is_active: 1 },
    { id: 'waka_hum_07', waka_type: 'humas', duty_number: 7, duty_title: 'Mengkoordinasikan publikasi kegiatan dan prestasi sekolah melalui media komunikasi yang resmi.', is_active: 1 },
    { id: 'waka_hum_08', waka_type: 'humas', duty_number: 8, duty_title: 'Mengelola informasi dan dokumentasi kegiatan sekolah bersama tim yang ditugaskan.', is_active: 1 },
    { id: 'waka_hum_09', waka_type: 'humas', duty_number: 9, duty_title: 'Membangun citra positif sekolah melalui komunikasi yang santun, informatif, transparan, dan bertanggung jawab.', is_active: 1 },
    { id: 'waka_hum_10', waka_type: 'humas', duty_number: 10, duty_title: 'Mengkoordinasikan penerimaan dan pelayanan tamu sekolah sesuai ketentuan.', is_active: 1 },
    { id: 'waka_hum_11', waka_type: 'humas', duty_number: 11, duty_title: 'Mengkoordinasikan kegiatan sekolah yang melibatkan orang tua, komite, masyarakat, dan pihak eksternal.', is_active: 1 },
    { id: 'waka_hum_12', waka_type: 'humas', duty_number: 12, duty_title: 'Mengkoordinasikan kegiatan alumni dan pengembangan jejaring alumni.', is_active: 1 },
    { id: 'waka_hum_13', waka_type: 'humas', duty_number: 13, duty_title: 'Menjalin hubungan dengan media massa apabila diperlukan dan atas koordinasi dengan Kepala Sekolah.', is_active: 1 },
    { id: 'waka_hum_14', waka_type: 'humas', duty_number: 14, duty_title: 'Mengkoordinasikan penyampaian informasi resmi sekolah kepada warga sekolah dan pemangku kepentingan.', is_active: 1 },
    { id: 'waka_hum_15', waka_type: 'humas', duty_number: 15, duty_title: 'Membantu Kepala Sekolah dalam mengelola komunikasi publik pada situasi yang memerlukan penjelasan resmi sekolah.', is_active: 1 },
    { id: 'waka_hum_16', waka_type: 'humas', duty_number: 16, duty_title: 'Mengidentifikasi dan mengembangkan peluang dukungan masyarakat terhadap program sekolah.', is_active: 1 },
    { id: 'waka_hum_17', waka_type: 'humas', duty_number: 17, duty_title: 'Mendukung pelaksanaan kegiatan promosi dan penguatan identitas sekolah secara positif dan proporsional.', is_active: 1 },
    { id: 'waka_hum_18', waka_type: 'humas', duty_number: 18, duty_title: 'Mendokumentasikan kegiatan kerja sama dan hubungan kemitraan sekolah.', is_active: 1 },
    { id: 'waka_hum_19', waka_type: 'humas', duty_number: 19, duty_title: 'Mengevaluasi efektivitas hubungan dan kerja sama sekolah dengan pihak eksternal.', is_active: 1 },
    { id: 'waka_hum_20', waka_type: 'humas', duty_number: 20, duty_title: 'Menyusun laporan pelaksanaan program bidang humas kepada Kepala Sekolah secara berkala.', is_active: 1 }
];

export function getWakaTypeFromCatalogId(catalogId) {
    if (!catalogId) return null;
    const cid = String(catalogId).trim();
    if (cid === 'cat_tt_waka_kurikulum') return 'kurikulum';
    if (cid === 'cat_tt_waka_kesiswaan') return 'kesiswaan';
    if (cid === 'cat_tt_waka_sarpras') return 'sarpras';
    if (cid === 'cat_tt_waka_humas') return 'humas';
    if (cid === 'cat_tt_waka') return 'kurikulum'; // Default fallback kompatibilitas
    return null;
}

export function isWakaCatalogId(catalogId) {
    return Boolean(getWakaTypeFromCatalogId(catalogId));
}

export function getWakaMainDutyInfo(wakaTypeOrCatalogId) {
    const type = getWakaTypeFromCatalogId(wakaTypeOrCatalogId) || String(wakaTypeOrCatalogId).toLowerCase().trim();
    return WAKA_MAIN_DUTIES_INFO[type] || null;
}

