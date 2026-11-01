/**
 * KONFIGURASI FIREBASE & JADWAL KAPSUL WAKTU (smanegeri1abang@gmail.com)
 * Rahasia wajib disimpan melalui Apps Script > Project Settings > Script Properties:
 * FIRESTORE_CLIENT_EMAIL, FIRESTORE_PRIVATE_KEY, FIRESTORE_PROJECT_ID.
 * Jangan pernah menaruh private key kembali di source atau Git.
*/
function getFirebaseConfig_() {
    const properties = PropertiesService.getScriptProperties();
    return {
        firestoreEmail: String(properties.getProperty("FIRESTORE_CLIENT_EMAIL") || "").trim(),
        firestorePrivateKey: String(properties.getProperty("FIRESTORE_PRIVATE_KEY") || "").replace(/\\n/g, "\n").trim(),
        firestoreProjectId: String(properties.getProperty("FIRESTORE_PROJECT_ID") || "smagesa").trim()
    };
}

// =========================================================================
// DAFTAR JADWAL KIRIM (Paling Atas Agar Gampang Diedit/Ditambah)
// =========================================================================
const DAFTAR_JADWAL = [
    { tahunAngkatan: "2026", waktuKirim: "2031-05-07T12:00:00" },
];

// =========================================================================
// EMAIL ADMIN (Untuk menerima laporan ringkasan setelah blast selesai)
// =========================================================================
const EMAIL_ADMIN = "komangpurna1@gmail.com"; // Isi dengan email Anda, contoh: "admin@smagesa.sch.id"

// =========================================================================
// GOOGLE SHEETS LOG (Untuk mencatat hasil pengiriman)
// =========================================================================
const SPREADSHEET_ID = "1B4B-7JlTQu9Ni8Ph8RWLJGir9ynRFfN81S4IzADrhTc";

// =========================================================================
// JEDA ANTAR EMAIL (dalam milidetik, 1000 = 1 detik)
// =========================================================================
const JEDA_ANTAR_EMAIL_MS = 1200; // 1.2 detik antar email untuk menghindari limit Gmail

// =========================================================================
// KONFIGURASI SMART AUTO-RESUME (Perlindungan Kuota & Timeout Google Apps Script)
// =========================================================================
const BATAS_MAKS_BATCH_HARIAN = 80;      // Maksimal email terkirim per eksekusi harian (dibawah batas 100)
const BUFFER_SISA_KUOTA = 5;              // Sisakan minimal 5 kuota agar email laporan admin selalu terkirim
const BATAS_DURASI_EKSEKUSI_MS = 270000;  // 4.5 menit (batas aman sebelum timeout 6 menit Apps Script)

// =========================================================================
// ID FOLDER GOOGLE DRIVE UTAMA (Tempat menyimpan semua foto)
// Buat folder di Drive (misal: "Kapsul Waktu Foto"), buka foldernya, dan copy ID dari URL-nya.
// =========================================================================
const ROOT_FOLDER_ID = "1F2eM-_LqFGm_maWuQy2o7mDBHZNcVwn1";

// =========================================================================
// WEB APP ENDPOINT: Menerima Upload Foto dari Frontend
// Deploy sebagai Web App (Execute as: Me, Access: Anyone)
// =========================================================================
function jsonOutput_(payload) {
    return ContentService.createTextOutput(JSON.stringify(payload))
        .setMimeType(ContentService.MimeType.JSON);
}

function sha256Hex_(value) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8)
        .map(byte => ((byte + 256) % 256).toString(16).padStart(2, "0"))
        .join("");
}

function escapeHtml_(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function doPost(e) {
    try {
        const payload = JSON.parse(e.postData.contents);
        const base64Data = payload.foto; // base64 string tanpa prefix "data:image/..."
        const email = String(payload.email || "").trim().toLowerCase();
        const tahun = String(payload.tahun || "").trim();
        const requestId = String(payload.requestId || "").trim();

        if (!base64Data || !email || !tahun || !requestId) {
            return jsonOutput_({
                success: false,
                error: "Parameter tidak lengkap (foto, email, tahun, requestId wajib diisi)"
            });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
            return jsonOutput_({ success: false, error: "Format email tidak valid" });
        }
        if (tahun !== String(new Date().getFullYear())) {
            return jsonOutput_({ success: false, error: "Tahun upload tidak valid" });
        }
        if (!/^[0-9a-f-]{36}$/i.test(requestId) || String(base64Data).length > 900000) {
            return jsonOutput_({ success: false, error: "Request ID atau ukuran foto tidak valid" });
        }

        const cache = CacheService.getScriptCache();
        const idempotencyKey = `tc_req_${requestId}`;
        const cachedResult = cache.get(idempotencyKey);
        if (cachedResult) return jsonOutput_(JSON.parse(cachedResult));

        // Apps Script Web App tidak menyediakan IP klien secara tepercaya. Batasi
        // setiap email dan gunakan requestId idempoten untuk mencegah upload ganda.
        const lock = LockService.getScriptLock();
        if (!lock.tryLock(5000)) {
            return jsonOutput_({ success: false, error: "Server sibuk, silakan coba kembali" });
        }
        try {
            const rateKey = `tc_rate_${sha256Hex_(`${tahun}|${email}`)}`;
            const uploadCount = Number(cache.get(rateKey) || 0);
            if (uploadCount >= 3) {
                return jsonOutput_({ success: false, error: "Batas upload foto untuk email ini telah tercapai" });
            }
            cache.put(rateKey, String(uploadCount + 1), 3600);
        } finally {
            lock.releaseLock();
        }

        // Decode base64 ke Blob
        // Nama file pakai timestamp agar unik (menghindari pencarian duplikat yang lambat)
        const timestamp = new Date().getTime();
        const safeEmail = email.replace(/[^a-zA-Z0-9@._-]/g, '_');
        const fileName = `foto_${safeEmail}_${timestamp}.jpg`;
        const decoded = Utilities.base64Decode(base64Data);
        if (decoded.length > 600 * 1024 || decoded.length < 4 ||
            (decoded[0] + 256) % 256 !== 0xFF ||
            (decoded[1] + 256) % 256 !== 0xD8 ||
            (decoded[2] + 256) % 256 !== 0xFF) {
            return jsonOutput_({ success: false, error: "File harus berupa JPEG valid maksimal 600 KB" });
        }
        const blob = Utilities.newBlob(decoded, "image/jpeg", fileName);

        // Langsung simpan ke root folder
        const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
        const file = rootFolder.createFile(blob);

        const fileId = file.getId();
        const directUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;

        console.log(`[✔] Foto berhasil diupload: ${email} → ${fileId} (${fileName})`);

        const successResult = {
            success: true,
            fileId: fileId,
            url: directUrl
        };
        cache.put(idempotencyKey, JSON.stringify(successResult), 21600);
        return jsonOutput_(successResult);

    } catch (error) {
        console.error(`[✘] Gagal upload foto: ${error.message}`);
        return jsonOutput_({
            success: false,
            error: error.message
        });
    }
}

// =========================================================================
// HELPER: Cari folder di dalam parent folder, buat baru jika belum ada
// =========================================================================
function createOrGetFolder_(parentFolder, folderName) {
    const folders = parentFolder.getFoldersByName(folderName);
    if (folders.hasNext()) {
        return folders.next();
    }
    return parentFolder.createFolder(folderName);
}

// =========================================================================
// HELPER: Test endpoint & Otorisasi Drive
// =========================================================================
function testDoPost() {
    DriveApp.getRootFolder();
    console.log("✅ Izin akses Google Drive (Read) sudah aktif!");
    console.log("Endpoint doPost siap. Deploy sebagai Web App untuk menerima upload foto.");
    console.log("URL format: https://script.google.com/macros/s/DEPLOY_ID/exec");
}

// =========================================================================
// FUNGSI WAJIB UNTUK MEMANCING IZIN GOOGLE DRIVE (JALANKAN SEKALI SAJA)
// =========================================================================
function forceAuthorize() {
    const testFile = DriveApp.createFile("TEST_IZIN_WRITE_BARU.txt", "Ini file tes untuk memancing izin Google Drive (Write Access)");
    testFile.setTrashed(true);
    console.info("✅ SUKSES! Izin untuk MEMBUAT FILE (Write Access) sudah diberikan oleh Google.");
}

// =========================================================================
// 1. FUNGSI UNTUK MEMASANG SEMUA JADWAL OTOMATIS (RUN SEKALI SAJA)
// =========================================================================
function jadwalkanSemua() {
    // Bersihkan jadwal lama terlebih dahulu agar tidak dobel
    batalkanSemuaJadwal();

    const p = PropertiesService.getScriptProperties();
    let count = 0;

    DAFTAR_JADWAL.forEach(jadwal => {
        try {
            const tanggal = new Date(jadwal.waktuKirim);

            // Lewati jika waktu kirim ternyata sudah lewat dari hari ini
            if (tanggal.getTime() < new Date().getTime()) {
                console.log(`[Skip] Angkatan ${jadwal.tahunAngkatan} karena jadwal (${jadwal.waktuKirim}) sudah berlalu.`);
                return;
            }

            // Buat Trigger baru untuk tanggal spesifik
            const trigger = ScriptApp.newTrigger("triggerHandler")
                .timeBased()
                .at(tanggal)
                .create();

            // Simpan pemetaan ID Trigger ini untuk tahun angkatan spesifik
            p.setProperty(trigger.getUniqueId(), jadwal.tahunAngkatan);

            console.log(`[✔] Alarm dipasang untuk Kapsul Angkatan ${jadwal.tahunAngkatan} pada ${tanggal}`);
            count++;
        } catch (e) {
            console.error(`[✘] Gagal pasang alarm angkatan ${jadwal.tahunAngkatan}: ${e.message}`);
        }
    });

    console.log(`Selesai! Total ${count} alarm jadwal berhasil dipasang.`);
}

// 2. Batalkan Semua Jadwal & Hapus Data Pemetaan
function batalkanSemuaJadwal() {
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(t => {
        try {
            ScriptApp.deleteTrigger(t);
        } catch (e) { }
    });

    // Hapus semua pemetaan (mapping) ID memori KECUALI histori anti-duplikat
    const p = PropertiesService.getScriptProperties();
    const allProps = p.getProperties();
    for (const key in allProps) {
        if (!key.startsWith("sent_")) {
            p.deleteProperty(key);
        }
    }

    console.log("Semua alarm jadwal lama beserta memorinya berhasil dihapus (Data anti-duplikat AMAN).");
}

// =========================================================================
// FUNGSI JADWAL ULANG AMAN (Tidak Menghapus Histori Pengiriman)
// =========================================================================
function jadwalUlangAman() {
    console.log("Memulai proses jadwal ulang...");
    jadwalkanSemua();
    console.log("Jadwal ulang selesai!");
}

// =========================================================================
// HELPER SMART AUTO-RESUME TRIGGER
// =========================================================================
function pasangTriggerLanjutan_(targetTahun) {
    // Hapus trigger lanjutan usang untuk tahun ini terlebih dahulu agar tidak menumpuk
    hapusTriggerLanjutan_(targetTahun);

    // Jadwalkan untuk 24 jam ke depan (memberikan waktu kuota harian Google me-reset)
    const waktuBesok = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const trigger = ScriptApp.newTrigger("triggerHandler")
        .timeBased()
        .at(waktuBesok)
        .create();

    const triggerId = trigger.getUniqueId();
    const p = PropertiesService.getScriptProperties();
    p.setProperty(triggerId, targetTahun);
    p.setProperty(`resume_trigger_${targetTahun}`, triggerId);

    console.log(`[⏰ Auto-Resume] Trigger lanjutan otomatis untuk Angkatan ${targetTahun} berhasil dipasang: ${waktuBesok.toLocaleString("id-ID", { timeZone: "Asia/Makassar" })} WITA`);
    return waktuBesok;
}

function hapusTriggerLanjutan_(targetTahun) {
    const p = PropertiesService.getScriptProperties();
    const keyResume = `resume_trigger_${targetTahun}`;
    const triggerId = p.getProperty(keyResume);
    if (triggerId) {
        const allTriggers = ScriptApp.getProjectTriggers();
        allTriggers.forEach(t => {
            if (t.getUniqueId() === triggerId) {
                try {
                    ScriptApp.deleteTrigger(t);
                    console.log(`[🗑️ Auto-Resume] Trigger lanjutan lama (${triggerId}) untuk Angkatan ${targetTahun} berhasil dibersihkan.`);
                } catch (e) {
                    console.warn(`Gagal menghapus trigger lama: ${e.message}`);
                }
            }
        });
        p.deleteProperty(triggerId);
        p.deleteProperty(keyResume);
    }
}

// =========================================================================
// 3. FUNGSI PENERIMA ALARM DARI GOOGLE TRIGGER (Jangan dijalankan manual)
// =========================================================================
function triggerHandler(eventData) {
    // Ambil ID Alarm yang berbunyi
    const triggerId = eventData && eventData.triggerUid ? eventData.triggerUid : null;
    const p = PropertiesService.getScriptProperties();

    let tahunAngkatan = triggerId ? p.getProperty(triggerId) : null;

    // Fallback: Jika triggerId tidak terbaca di metadata, cari dari daftar jadwal aktif
    if (!tahunAngkatan) {
        console.warn("Alarm berbunyi tanpa target tahun spesifik via triggerId. Memeriksa jadwal terdekat...");
        const now = new Date().getTime();
        for (let i = 0; i < DAFTAR_JADWAL.length; i++) {
            const j = DAFTAR_JADWAL[i];
            const t = new Date(j.waktuKirim).getTime();
            if (Math.abs(now - t) <= 3600000) { // Toleransi 1 jam
                tahunAngkatan = j.tahunAngkatan;
                break;
            }
        }
    }

    if (tahunAngkatan) {
        console.log(`Alarm berbunyi otomatis untuk Angkatan ${tahunAngkatan}! Memulai pengiriman...`);
        // Bersihkan trigger ID sekali pakai dari memori
        if (triggerId) {
            p.deleteProperty(triggerId);
        }
        // Panggil fungsi utama dengan Angkatan Spesifik
        kirimKapsulWaktuSpesifik(tahunAngkatan);
    } else {
        console.error("Alarm berbunyi tapi tidak mengenali milik angkatan tahun berapa.");
    }
}

// =========================================================================
// HELPER: Parse Firestore REST API field value
// FirestoreApp mengembalikan {stringValue: "..."}, {integerValue: "..."}, dll.
// =========================================================================
function parseFirestoreValue(val) {
    if (val === null || val === undefined) return null;
    if (typeof val !== 'object') return val; // Sudah plain value
    if ('stringValue' in val) return val.stringValue;
    if ('integerValue' in val) return Number(val.integerValue);
    if ('doubleValue' in val) return Number(val.doubleValue);
    if ('booleanValue' in val) return val.booleanValue;
    if ('timestampValue' in val) return new Date(val.timestampValue);
    if ('nullValue' in val) return null;
    if ('mapValue' in val) return parseFirestoreDoc(val.mapValue.fields || {});
    if ('arrayValue' in val) return (val.arrayValue.values || []).map(parseFirestoreValue);
    return val; // Fallback
}

function parseFirestoreDoc(fields) {
    const result = {};
    for (const key in fields) {
        result[key] = parseFirestoreValue(fields[key]);
    }
    return result;
}

// =========================================================================
// 4. LOGIKA UTAMA (Eksekusi Database, Email, Log, dan Smart Auto-Resume)
// =========================================================================
function kirimKapsulWaktuSpesifik(targetTahun) {
    const startTime = Date.now();
    const firebaseConfig = getFirebaseConfig_();
    if (!firebaseConfig.firestoreEmail || !firebaseConfig.firestorePrivateKey || !firebaseConfig.firestoreProjectId || !targetTahun) {
        console.error("Script Properties FIRESTORE_CLIENT_EMAIL/FIRESTORE_PRIVATE_KEY/FIRESTORE_PROJECT_ID belum lengkap.");
        return;
    }

    // --- Inisialisasi Firestore ---
    let firestore;
    try {
        firestore = FirestoreApp.getFirestore(
            firebaseConfig.firestoreEmail,
            firebaseConfig.firestorePrivateKey,
            firebaseConfig.firestoreProjectId
        );
    } catch (error) {
        console.error("Gagal menginisialisasi Firestore:", error.message);
        return;
    }

    // --- Ambil data dari Firestore ---
    const collectionPath = `kapsul_waktu/${targetTahun}/entries`;
    let documents = [];
    try {
        console.log(`Mengambil data dari path: ${collectionPath}`);
        documents = firestore.getDocuments(collectionPath);
    } catch (error) {
        console.error("Gagal mengambil data dari Firestore:", error.message);
        return;
    }

    if (!documents || documents.length === 0) {
        console.log(`Tidak ada data kapsul waktu yang ditemukan untuk angkatan ${targetTahun}.`);
        return;
    }

    console.log(`Ditemukan ${documents.length} entri Kapsul Waktu (Angkatan ${targetTahun}). Memulai proses pengiriman...`);

    // --- Siapkan Google Sheets untuk logging ---
    let sheetLog = null;
    try {
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const namaSheet = `Log Angkatan ${targetTahun}`;
        sheetLog = ss.getSheetByName(namaSheet);

        // Jika sheet untuk angkatan ini belum ada, buat baru
        if (!sheetLog) {
            sheetLog = ss.insertSheet(namaSheet);
            // Tulis header
            sheetLog.appendRow(["No", "Nama Lengkap", "Email", "Kelas", "Status", "Keterangan", "Waktu Kirim"]);
            // Format header
            sheetLog.getRange(1, 1, 1, 7).setFontWeight("bold").setBackground("#d4a843").setFontColor("#0a1628");
            sheetLog.setFrozenRows(1);
            // Auto-resize kolom
            for (let i = 1; i <= 7; i++) sheetLog.autoResizeColumn(i);
        }
    } catch (e) {
        console.error("Gagal membuka Google Sheets untuk logging (proses tetap lanjut):", e.message);
    }

    // --- Anti Duplikat: Ambil daftar email yang sudah pernah dikirim ---
    const propKey = `sent_${targetTahun}`;
    const p = PropertiesService.getScriptProperties();
    let sudahDikirim = [];
    try {
        const raw = p.getProperty(propKey);
        if (raw) sudahDikirim = JSON.parse(raw);
    } catch (e) { sudahDikirim = []; }

    // --- Statistik Laporan Batch & Total ---
    let countBerhasilBatch = 0;
    let countGagal = 0;
    let countSkip = 0;
    let countDuplikat = 0;
    const detailGagal = [];
    const detailSkip = [];
    let isBatchPaused = false;
    let pauseReason = "";
    let nextRunDate = null;
    let nomor = sheetLog ? Math.max(0, sheetLog.getLastRow() - 1) : 0; // Lanjutkan nomor dari baris data terakhir

    // --- Looping Pengiriman dengan Smart Auto-Resume ---
    for (let index = 0; index < documents.length; index++) {
        const docItem = documents[index];
        // Parse fields dari format Firestore REST API ke plain object
        const data = docItem.fields ? parseFirestoreDoc(docItem.fields) : docItem;

        const namaLengkap = String(data.namaLengkap || "Siswa SMANTARA");
        const emailTujuan = String(data.email || "").trim();
        const kelas = String(data.kelas || "-");

        // --- 1. Validasi email ---
        if (!emailTujuan || emailTujuan.indexOf("@") === -1) {
            console.log(`[Skip] Baris ${index + 1}: Email tidak valid untuk ${namaLengkap}.`);
            countSkip++;
            detailSkip.push(`${namaLengkap} (email kosong/invalid)`);
            if (sheetLog) {
                nomor++;
                sheetLog.appendRow([nomor, namaLengkap, emailTujuan || "(kosong)", kelas, "SKIP", "Email tidak valid", ""]);
            }
            continue;
        }

        // --- 2. Anti Duplikat: Lewati jika sudah pernah berhasil dikirim ---
        if (sudahDikirim.includes(emailTujuan.toLowerCase())) {
            countDuplikat++;
            continue;
        }

        // --- 3. Proteksi Smart Auto-Resume: Cek Batas Maksimal Batch Harian ---
        if (countBerhasilBatch >= BATAS_MAKS_BATCH_HARIAN) {
            isBatchPaused = true;
            pauseReason = `Batas kuota aman batch harian tercapai (${BATAS_MAKS_BATCH_HARIAN} email).`;
            console.log(`[⏸️ Auto-Resume Pause] ${pauseReason}`);
            break;
        }

        // --- 4. Proteksi Smart Auto-Resume: Cek Sisa Kuota Email Real-Time ---
        let sisaKuota = 100;
        try {
            sisaKuota = MailApp.getRemainingDailyQuota();
        } catch (e) {
            sisaKuota = 100;
        }
        if (sisaKuota <= BUFFER_SISA_KUOTA) {
            isBatchPaused = true;
            pauseReason = `Sisa kuota harian akun menipis (Tersisa: ${sisaKuota}, Buffer: ${BUFFER_SISA_KUOTA}).`;
            console.log(`[⏸️ Auto-Resume Pause] ${pauseReason}`);
            break;
        }

        // --- 5. Proteksi Smart Auto-Resume: Cek Batas Waktu Eksekusi Script (4.5 Menit) ---
        const durasiBerjalan = Date.now() - startTime;
        if (durasiBerjalan >= BATAS_DURASI_EKSEKUSI_MS) {
            isBatchPaused = true;
            pauseReason = `Batas durasi eksekusi aman tercapai (${Math.round(durasiBerjalan / 1000)} detik).`;
            console.log(`[⏸️ Auto-Resume Pause] ${pauseReason}`);
            break;
        }

        // Ambil data kuisioner
        const tigaKata = String(data.tigaKata || "-");
        const memori = String(data.memori || "-");
        const lagu = String(data.lagu || "-");
        const refleksi = String(data.refleksi || "-");
        const sosok = String(data.sosok || "-");
        const targetBesar = String(data.targetBesar || "-");
        const prinsip = String(data.prinsip || "-");
        const pesanPengingat = String(data.pesanPengingat || "-");
        const harapanSekolah = String(data.harapanSekolah || "-");

        // Ambil data foto (Google Drive File ID)
        const fotoFileId = String(data.fotoFileId || "");

        const subject = `Kapsul Waktu Angkatan ${targetTahun}: Pesan dari Dirimu di Masa Lalu`;
        const safeNamaLengkap = escapeHtml_(namaLengkap);
        const safeTigaKata = escapeHtml_(tigaKata);
        const safeMemori = escapeHtml_(memori);
        const safeLagu = escapeHtml_(lagu);
        const safeRefleksi = escapeHtml_(refleksi);
        const safeSosok = escapeHtml_(sosok);
        const safeTargetBesar = escapeHtml_(targetBesar);
        const safePrinsip = escapeHtml_(prinsip);
        const safePesanPengingat = escapeHtml_(pesanPengingat);
        const safeHarapanSekolah = escapeHtml_(harapanSekolah);

        const htmlBody = `
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'Georgia', serif; background-color: #f4ede4; color: #333333; margin: 0; padding: 20px; line-height: 1.8;}
        .container { max-width: 600px; margin: 0 auto; background: #fdfbf7; border: 1px solid #d4c5b0; border-radius: 8px; padding: 40px 30px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05); }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 1px solid #e0d5c1; padding-bottom: 20px; }
        .header h1 { font-family: 'Courier New', Courier, monospace; color: #8c6a46; font-size: 24px; margin: 0; letter-spacing: 2px; }
        .header p { font-style: italic; color: #9b8c78; font-size: 14px; }
        .content p { font-size: 15px; color: #2c2c2c; margin-bottom: 20px; text-align: justify;}
        .quote-inline { color: #8c6a46; font-style: italic; font-weight: bold; }
        .reminder-box { background-color: #fffcf8; border: 2px solid #e0d5c1; border-left: 4px solid #b8912e; padding: 20px; border-radius: 6px; font-weight: bold; margin: 30px 0; font-size: 15px; color: #6a533a; text-align: center; font-style: italic;}
        .foto-section { text-align: center; margin: 30px 0; }
        .foto-section img { max-width: 100%; max-height: 400px; border-radius: 8px; border: 3px solid #e0d5c1; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); }
        .foto-caption { font-size: 13px; color: #9b8c78; font-style: italic; margin-top: 10px; }
        .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #999999; border-top: 1px dashed #e0d5c1; padding-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>KAPSUL WAKTU DIGITAL</h1>
          <p>Tersegel rapat sejak kamu mengisinya di tahun ${targetTahun}</p>
        </div>
        
        <div class="content">
          <p>Halo, <strong>${safeNamaLengkap}</strong>,</p>
          
          <p>Hari ini, tepat lima tahun berlalu sejak kamu duduk, menatap layar, memikirkan apa yang akan terjadi di masa depan, dan menyegel surat ini. Waktu itu, saat momen pelepasan, kamu mendeskripsikan SMA Negeri Nusantara dengan tiga kata: <span class="quote-inline">"${safeTigaKata}"</span>. Masih ingat rasanya?</p>

          <p>Coba putar kembali lagu <span class="quote-inline">"${safeLagu}"</span>. Lagu itu adalah saksi bisu masa-masamu kala itu. Mungkin kamu akan tersenyum sendiri kalau mengingat salah satu momen paling konyol yang pernah kamu tulis: <span class="quote-inline">"${safeMemori}"</span>. Masa-masa SMA mungkin dipenuhi ujian, drama, dan tawa, tapi nyatanya kamu berhasil melewatinya. Apalagi saat itu ada sosok <span class="quote-inline">${safeSosok}</span> yang kamu akui selalu jadi alasanmu untuk bisa bertahan dan tetap waras di tengah hiruk-pikuk masa muda.</p>

          ${fotoFileId ? '<p>Sambil bernostalgia, coba tatap sejenak gambar yang kamu lampirkan ini. Waktu mungkin berlalu, tapi jejak ini akan selalu menjadi bagian dari ceritamu di masa itu.</p><div class="foto-section"><img src="cid:fotokapsul" alt="Foto Kapsul Waktu"><p class="foto-caption">Foto yang kamu simpan bersama kapsul waktu ini.</p></div>' : ''}

          <p>Dulu, kamu sangat berani jujur pada dirimu sendiri. Kamu bercerita tentang proses pendewasaanmu, dan dengan bangga menuliskan keberhasilanmu menaklukkan sisi tergelapmu: <span class="quote-inline">"${safeRefleksi}"</span>. Aku sungguh berharap, versi dirimu yang sekarang sedang membaca surat ini tidak lagi terjebak di lubang yang sama. Kamu pasti sudah tumbuh menjadi pribadi yang jauh lebih kuat.</p>

          <p>Lima tahun yang lalu, kamu memupuk mimpi yang sangat besar. Kamu sangat berharap saat surat ini terbuka hari ini, kamu sudah mencapai ini: <span class="quote-inline">"${safeTargetBesar}"</span>. Apakah impian itu sudah terwujud? Kalau sudah, selamat! Kamu pantas untuk bangga pada dirimu sendiri. Namun, kalau jalannya ternyata berbeda, tak apa—perjalanan tiap orang punya zona waktunya masing-masing. Yang paling penting adalah, apakah kamu masih memegang teguh prinsip hidupmu yang ini: <span class="quote-inline">"${safePrinsip}"</span>? Ingatlah, sejauh apapun kamu melangkah, jangan pernah kehilangan jati dirimu yang asli.</p>

          <p>Oh ya, dulu kamu juga sempat menitipkan harapan tulus untuk almamater kita: <span class="quote-inline">"${safeHarapanSekolah}"</span>. Semoga sekolah kita tercinta itu juga terus berevolusi menjadi lebih baik, sama halnya dengan dirimu.</p>

          <p>Terakhir, dan mungkin yang paling penting hari ini. Ini adalah pesan khusus, sebuah pengingat (atau mungkin tamparan keras) dari dirimu di masa lalu, yang mungkin saja sedang sangat kamu butuhkan saat ini:</p>

          <div class="reminder-box">
            "${safePesanPengingat}"
          </div>

          <p>Tarik napas panjang. Apapun yang sedang kamu hadapi saat ini, jangan pernah menyerah pada dirimu sendiri.</p>
          
          <br>
          <p>Salam hangat dan peluk erat dari masa lalu,<br><strong>Dirimu di tahun ${targetTahun}</strong></p>
        </div>

        <div class="footer">
          <p>Pesan ini dirajut secara otomatis dari arsip Kapsul Waktu Digital SMA Negeri Nusantara.</p>
        </div>
      </div>
    </body>
    </html>
    `;

        // --- Siapkan opsi email (dengan atau tanpa foto inline) ---
        const emailOptions = {
            htmlBody: htmlBody,
            name: "Kapsul Waktu SMANTARA"
        };

        // Jika ada foto, embed sebagai inline image via Content-ID
        if (fotoFileId) {
            try {
                const fotoFile = DriveApp.getFileById(fotoFileId);
                const fotoBlob = fotoFile.getBlob().setName("fotokapsul");
                emailOptions.inlineImages = { fotokapsul: fotoBlob };
                console.log(`   📸 Foto ditemukan di Drive (${fotoFileId}), akan di-embed di email.`);
            } catch (fotoErr) {
                console.log(`   ⚠️ Foto tidak ditemukan di Drive (${fotoFileId}): ${fotoErr.message}. Email tetap dikirim tanpa foto.`);
            }
        }

        // --- Kirim email dengan try-catch terisolasi ---
        try {
            GmailApp.sendEmail(emailTujuan, subject, '', emailOptions);

            const waktuKirim = new Date().toLocaleString("id-ID", { timeZone: "Asia/Makassar" });
            console.log(`[✔] Berhasil | ${namaLengkap} (${emailTujuan})`);
            countBerhasilBatch++;

            // Catat ke anti-duplikat
            sudahDikirim.push(emailTujuan.toLowerCase());

            // Catat ke Google Sheets
            if (sheetLog) {
                nomor++;
                sheetLog.appendRow([nomor, namaLengkap, emailTujuan, kelas, "BERHASIL", "Email terkirim", waktuKirim]);
            }
        } catch (emailError) {
            const waktuGagal = new Date().toLocaleString("id-ID", { timeZone: "Asia/Makassar" });
            console.error(`[✘] Gagal | ${namaLengkap} (${emailTujuan}): ${emailError.message}`);
            countGagal++;
            detailGagal.push(`${namaLengkap} (${emailTujuan}): ${emailError.message}`);

            // Catat ke Google Sheets
            if (sheetLog) {
                nomor++;
                sheetLog.appendRow([nomor, namaLengkap, emailTujuan, kelas, "GAGAL", emailError.message, waktuGagal]);
            }
        }

        // --- Jeda antar email setiap pengiriman ---
        Utilities.sleep(JEDA_ANTAR_EMAIL_MS);
    }

    // --- Simpan daftar anti-duplikat ke memori ---
    try {
        p.setProperty(propKey, JSON.stringify(sudahDikirim));
    } catch (e) {
        console.error("Gagal menyimpan data anti-duplikat:", e.message);
    }

    // --- Hitung sisa siswa valid yang belum terkirim ---
    let sisaBelumTerkirim = 0;
    documents.forEach(docItem => {
        const dataDoc = docItem.fields ? parseFirestoreDoc(docItem.fields) : docItem;
        const em = String(dataDoc.email || "").trim().toLowerCase();
        if (em && em.indexOf("@") !== -1 && !sudahDikirim.includes(em)) {
            sisaBelumTerkirim++;
        }
    });

    // --- Manajemen Auto-Resume Trigger ---
    if (isBatchPaused && sisaBelumTerkirim > 0) {
        nextRunDate = pasangTriggerLanjutan_(targetTahun);
    } else if (sisaBelumTerkirim === 0) {
        hapusTriggerLanjutan_(targetTahun);
        console.log(`[🎉 SELESAI] Seluruh siswa Angkatan ${targetTahun} (${sudahDikirim.length} orang) telah tuntas menerima email Kapsul Waktu!`);
    }

    // --- Auto-resize kolom Sheets ---
    if (sheetLog) {
        try { for (let i = 1; i <= 7; i++) sheetLog.autoResizeColumn(i); } catch (e) { }
    }

    // --- Cetak ringkasan di console ---
    const ringkasan = `
========================================
  LAPORAN BLAST KAPSUL WAKTU ${isBatchPaused && sisaBelumTerkirim > 0 ? "(BATCH PROGRES)" : "(FINAL SELESAI)"}
  Angkatan: ${targetTahun}
========================================
  Total Database : ${documents.length}
  ✔ Total Terkirim: ${sudahDikirim.length}
  ⚡ Batch Ini   : ${countBerhasilBatch}
  ⏳ Sisa Antrean : ${sisaBelumTerkirim}
  ✘ Gagal        : ${countGagal}
  ⊘ Skip (Email) : ${countSkip}
  ${isBatchPaused && nextRunDate ? `⏰ Jadwal Batch Lanjutan: ${nextRunDate.toLocaleString("id-ID", { timeZone: "Asia/Makassar" })} WITA` : " Status        : SELESAI 100%"}
========================================`;
    console.log(ringkasan);

    // --- Kirim laporan ringkasan ke email Admin ---
    if (EMAIL_ADMIN) {
        try {
            const isFinal = (sisaBelumTerkirim === 0);
            const adminSubject = isFinal
                ? `[Laporan FINAL] Blast Kapsul Waktu Angkatan ${targetTahun} - Selesai 100%`
                : `[Laporan BATCH] Blast Kapsul Waktu Angkatan ${targetTahun} - Dijeda (${countBerhasilBatch} Terkirim, Sisa ${sisaBelumTerkirim})`;

            const waktuWITA = new Date().toLocaleString("id-ID", { timeZone: "Asia/Makassar" });
            const infoStatusHtml = isFinal
                ? `<div style="background:#e8f5e9;border-left:4px solid #2e7d32;padding:12px;margin:15px 0;border-radius:4px;color:#1b5e20;"><strong>🎉 SEMUA EMAIL TELAH SELESAI DIKIRIM (100%)</strong><br>Seluruh ${sudahDikirim.length} siswa angkatan ${targetTahun} telah berhasil menerima pesan kapsul waktu mereka.</div>`
                : `<div style="background:#fff3e0;border-left:4px solid #f57c00;padding:12px;margin:15px 0;border-radius:4px;color:#e65100;"><strong>⏳ BATCH DIJEDA SECARA OTOMATIS (Smart Auto-Resume)</strong><br>Alasan: ${escapeHtml_(pauseReason)}<br>Batch ini berhasil mengirim: <strong>${countBerhasilBatch} email</strong>.<br>Sisa yang belum terkirim: <strong>${sisaBelumTerkirim} siswa</strong>.<br>⏰ <strong>Jadwal Lanjutan Otomatis:</strong> ${nextRunDate ? nextRunDate.toLocaleString("id-ID", { timeZone: "Asia/Makassar" }) + " WITA" : "-"}</div>`;

            const adminBody = `
      <html><body style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #8c6a46;">📋 Laporan Blast Kapsul Waktu Angkatan ${targetTahun}</h2>
        <p><strong>Waktu Eksekusi:</strong> ${waktuWITA} WITA</p>
        ${infoStatusHtml}
        <table style="border-collapse: collapse; width: 100%; max-width: 450px; margin-top: 15px;">
          <tr><td style="padding: 8px; border: 1px solid #ddd;">Total Data Database</td><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">${documents.length}</td></tr>
          <tr style="background: #e8f5e9;"><td style="padding: 8px; border: 1px solid #ddd;">✔ Total Berhasil Terkirim</td><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; color: #2e7d32;">${sudahDikirim.length}</td></tr>
          <tr style="background: #f1f8e9;"><td style="padding: 8px; border: 1px solid #ddd;">⚡ Berhasil di Batch Ini</td><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; color: #33691e;">${countBerhasilBatch}</td></tr>
          <tr style="background: #fff8e1;"><td style="padding: 8px; border: 1px solid #ddd;">⏳ Sisa Belum Terkirim</td><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; color: #f57f17;">${sisaBelumTerkirim}</td></tr>
          ${countGagal > 0 ? `<tr style="background: #ffebee;"><td style="padding: 8px; border: 1px solid #ddd;">✘ Gagal Batch Ini</td><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; color: red;">${countGagal}</td></tr>` : ""}
          <tr><td style="padding: 8px; border: 1px solid #ddd;">⊘ Skip (Email Invalid)</td><td style="padding: 8px; border: 1px solid #ddd;">${countSkip}</td></tr>
        </table>
        ${countGagal > 0 ? `<h3 style="color: red; margin-top: 20px;">Detail Gagal:</h3><ul>${detailGagal.map(d => `<li>${escapeHtml_(d)}</li>`).join("")}</ul>` : ""}
        ${countSkip > 0 ? `<h3 style="color: orange; margin-top: 20px;">Detail Skip:</h3><ul>${detailSkip.map(d => `<li>${escapeHtml_(d)}</li>`).join("")}</ul>` : ""}
        <hr style="margin-top: 25px; border: 0; border-top: 1px solid #ddd;">
        <p style="font-size: 12px; color: #777;">Log lengkap per siswa dicatat di Google Sheets: <a href="https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}">Buka Google Sheets Log</a></p>
      </body></html>`;

            GmailApp.sendEmail(EMAIL_ADMIN, adminSubject, '', {
                htmlBody: adminBody,
                name: "Kapsul Waktu SMANTARA - System"
            });
            console.log(`Laporan ${isFinal ? "FINAL" : "BATCH"} berhasil dikirim ke admin: ${EMAIL_ADMIN}`);
        } catch (e) {
            console.error("Gagal mengirim laporan ke admin:", e.message);
        }
    }

    console.log(`Selesai eksekusi putaran ini untuk Kapsul Waktu Angkatan ${targetTahun}.`);
}

// -------------------------------------------------------------------------
// FUNGSI RESET ANTI-DUPLIKAT (Jika ingin mengirim ulang ke angkatan tertentu)
// -------------------------------------------------------------------------
function resetAntiDuplikat_2026() {
    hapusTriggerLanjutan_("2026");
    PropertiesService.getScriptProperties().deleteProperty("sent_2026");
    console.log("Data anti-duplikat & trigger lanjutan untuk angkatan 2026 berhasil dihapus. Skrip bisa mengirim ulang.");
}

// -------------------------------------------------------------------------
// FUNGSI UJI COBA MANUAL (Kirim untuk angkatan spesifik tanpa menunggu alarm)
// -------------------------------------------------------------------------
function MANUAL_TEST_KirimAngkatan2026() {
    kirimKapsulWaktuSpesifik("2026");
}