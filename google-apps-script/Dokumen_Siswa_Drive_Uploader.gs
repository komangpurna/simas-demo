/**
 * ============================================================================
 * GOOGLE APPS SCRIPT: SIMAS DOKUMEN SISWA GOOGLE DRIVE UPLOADER (STANDALONE)
 * ============================================================================
 * Versi: 1.0 (Khusus Modul Pengarsipan Dokumen Kependudukan / Foto KK Siswa)
 * 
 * Script ini mengelola unggah, pratinjau, dan pembersihan otomatis foto berkas
 * Kartu Keluarga (KK) siswa SIMAS SMAGESA (SMA Negeri 1 Abang) di Google Drive sekolah.
 * 
 * STRUKTUR PENYIMPANAN DI GOOGLE DRIVE:
 * My Drive
 *   └── KK-Siswa
 *         └── [Tahun_Ajaran] (contoh: 2026-2027)
 *               └── [Kelas] (contoh: X.1, XI.2, XII.3)
 *                     └── KK_[NIS]_[Nama Siswa].jpg (contoh: KK_1234_I Komang Purna.jpg)
 * 
 * SIKLUS HIDUP & RETENSI DOKUMEN (~3 TAHUN):
 * Dokumen otomatis dihapus (dipindahkan ke Sampah/Trash) setelah siswa menyelesaikan
 * masa studi di sekolah (~3 tahun / 1.095 hari) melalui fungsi `autoCleanupExpiredDocuments()`.
 * 
 * ============================================================================
 * PANDUAN PENERAPAN (DEPLOYMENT) - HANYA 2 MENIT:
 * ============================================================================
 * 1. Buka https://script.google.com dengan Akun Google Drive sekolah.
 * 2. Klik tombol "New project" (Proyek baru) di kiri atas.
 * 3. Beri nama proyek di kiri atas: "SIMAS Dokumen Siswa Drive Uploader".
 * 4. Hapus semua baris kode default di editor (myFunction), lalu salin seluruh
 *    kode dari file ini ke dalam editor tersebut.
 * 5. Klik ikon Simpan (Save project).
 * 6. Klik tombol "Deploy" (Terapkan) berwarna biru di kanan atas -> pilih "New deployment".
 * 7. Klik ikon gerigi (Settings) di sebelah "Select type" -> pilih "Web app".
 * 8. Isi konfigurasi sebagai berikut:
 *    - Description : SIMAS Dokumen Siswa Uploader v1.0
 *    - Execute as  : Me (email akun Google Anda / sekolah)
 *    - Who has access : Anyone (Siapa saja, bahkan tanpa akun Google)  <-- WAJIB PILIH INI!
 * 9. Klik tombol "Deploy".
 * 10. Klik "Authorize access" (Izinkan akses) -> Pilih akun Google sekolah:
 *     - Jika muncul "Google hasn't verified this app" / "Google belum memverifikasi aplikasi ini":
 *       Klik "Advanced" (Lanjutan) -> Klik "Go to SIMAS Dokumen Siswa Drive Uploader (unsafe)" -> Klik "Allow" (Izinkan).
 * 11. Salin "Web app URL" yang muncul (format: https://script.google.com/macros/s/AKfycb.../exec).
 * 12. Buka file `js/config.js` di proyek SIMAS, lalu masukkan URL tersebut pada `STUDENT_DOCS_APPS_SCRIPT_URL`
 *     atau pada `js/school-config.js` (`studentDocsAppsScriptUrl`).
 * 
 * ============================================================================
 * CARA MENGAKTIFKAN PEMBERSIHAN OTOMATIS 3 TAHUN (TIME-DRIVEN TRIGGER):
 * ============================================================================
 * 1. Di editor Google Apps Script, klik menu "Triggers" (ikon jam dinding di bilah kiri).
 * 2. Klik tombol "+ Add Trigger" (+ Tambahkan Pemicu) di kanan bawah.
 * 3. Konfigurasikan:
 *    - Choose which function to run : autoCleanupExpiredDocuments
 *    - Select event source          : Time-driven
 *    - Select type of time based trigger : Month timer (atau Week timer)
 *    - Select day/time              : Bulan ke-1, tengah malam
 * 4. Klik "Save". Sistem Google Apps Script akan otomatis memeriksa dan memindahkan
 *    foto KK yang berusia lebih dari 3 tahun ke Sampah Google Drive tanpa perlu campur tangan manual.
 * ============================================================================
 */

// Nama Folder Induk Utama di Google Drive
var ROOT_FOLDER_NAME = "KK-Siswa";

// Batas Retensi Dokumen Siswa: 3 Tahun (3 * 365 hari = 1.095 hari)
var RETENTION_DAYS = 1095;

/**
 * Handle HTTP GET (Health check / verifikasi status di browser)
 */
function doGet(e) {
  var output = {
    status: "active",
    service: "SIMAS Dokumen Siswa (KK) Google Drive Uploader",
    rootFolder: ROOT_FOLDER_NAME,
    retentionDays: RETENTION_DAYS,
    timestamp: new Date().toISOString(),
    message: "Layanan Google Apps Script Dokumen Siswa aktif dan siap menerima unggahan foto KK."
  };
  return ContentService.createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handle HTTP POST (Upload, Delete, dan Manajemen Berkas KK Siswa)
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({
        success: false,
        error: "Tidak ada payload data yang diterima (postData kosong)."
      });
    }

    var requestData = JSON.parse(e.postData.contents);
    var action = requestData.action || "upload";

    // -------------------------------------------------------------
    // AKSI 1: Hapus Berkas Foto KK dari Google Drive (Delete Action)
    // -------------------------------------------------------------
    if (action === "delete") {
      var fileId = requestData.fileId;
      if (!fileId) {
        return createJsonResponse({
          success: false,
          error: "Parameter fileId diperlukan untuk aksi penghapusan."
        });
      }
      try {
        var fileToDelete = DriveApp.getFileById(fileId);
        fileToDelete.setTrashed(true); // Pindahkan ke Sampah Google Drive
        return createJsonResponse({
          success: true,
          message: "Berkas foto KK berhasil dipindahkan ke sampah Google Drive.",
          fileId: fileId
        });
      } catch (delErr) {
        return createJsonResponse({
          success: false,
          error: "Gagal menghapus berkas: " + delErr.message,
          fileId: fileId
        });
      }
    }

    // -------------------------------------------------------------
    // AKSI 2: Unggah Berkas Foto KK ke Google Drive (Upload Action)
    // -------------------------------------------------------------
    if (action === "upload") {
      var base64Data = requestData.image;
      var rawFileName = requestData.fileName || "";
      var nis = String(requestData.nis || "").trim();
      var namaSiswa = String(requestData.nama || requestData.studentName || "").trim();
      var academicYear = String(requestData.academicYear || requestData.tahunAjaran || "").trim();
      var kelas = String(requestData.kelas || requestData.className || "").trim();

      if (!base64Data) {
        return createJsonResponse({
          success: false,
          error: "Data gambar (base64) tidak ditemukan dalam request."
        });
      }

      // Bersihkan base64 data URL header jika ada (contoh: "data:image/jpeg;base64,")
      if (base64Data.indexOf(",") > -1) {
        base64Data = base64Data.split(",")[1];
      }

      // Tentukan Nama File Standar SSOT: KK_[NIS]_[Nama Siswa].jpg
      var safeName = namaSiswa.replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "Siswa";
      var safeNis = nis.replace(/[^a-zA-Z0-9_-]/g, "").trim() || "0000";
      var finalFileName = rawFileName;
      if (!finalFileName || !finalFileName.startsWith("KK_")) {
        finalFileName = "KK_" + safeNis + "_" + safeName + ".jpg";
      }

      // Normalisasi Tahun Ajaran (contoh: 2026-2027)
      if (!academicYear) {
        var now = new Date();
        var currentYear = now.getFullYear();
        var currentMonth = now.getMonth() + 1; // 1-12
        // Tahun ajaran baru dimulai bulan Juli (7)
        if (currentMonth >= 7) {
          academicYear = currentYear + "-" + (currentYear + 1);
        } else {
          academicYear = (currentYear - 1) + "-" + currentYear;
        }
      }
      academicYear = academicYear.replace(/[^a-zA-Z0-9_-]/g, "-").trim();

      // Normalisasi Kelas (contoh: X.1, XI.2, XII.3)
      var safeKelas = kelas.replace(/[^a-zA-Z0-9._-]/g, "").trim() || "Umum";

      // Dapatkan atau buat hierarki folder target: KK-Siswa / {TahunAjaran} / {Kelas}
      var targetFolder = resolveTargetFolder(academicYear, safeKelas);

      // Konversi Base64 menjadi Blob berkas gambar JPEG
      var decodedBytes = Utilities.base64Decode(base64Data);
      var blob = Utilities.newBlob(decodedBytes, "image/jpeg", finalFileName);

      // Buat berkas di folder target
      var file = targetFolder.createFile(blob);

      // Set hak akses agar foto KK dapat dipratinjau dengan aman oleh siapa saja yang memiliki link
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (permErr) {
        Logger.log("Peringatan hak akses publik: " + permErr.message);
      }

      var fileId = file.getId();
      var viewUrl = file.getUrl();
      var directThumbUrl = "https://lh3.googleusercontent.com/d/" + fileId;
      var folderPathStr = ROOT_FOLDER_NAME + "/" + academicYear + "/" + safeKelas;

      return createJsonResponse({
        success: true,
        fileId: fileId,
        url: viewUrl,
        thumbnailUrl: directThumbUrl,
        name: finalFileName,
        folderPath: folderPathStr,
        academicYear: academicYear,
        kelas: safeKelas,
        uploadedAt: new Date().toISOString()
      });
    }

    // -------------------------------------------------------------
    // AKSI 3: Trigger Pembersihan Manual / Terjadwal
    // -------------------------------------------------------------
    if (action === "cleanup") {
      var cleanupResult = autoCleanupExpiredDocuments();
      return createJsonResponse({
        success: true,
        message: "Proses pembersihan berkas kedaluwarsa selesai dijalankan.",
        details: cleanupResult
      });
    }

    return createJsonResponse({
      success: false,
      error: "Aksi '" + action + "' tidak dikenali oleh layanan."
    });

  } catch (err) {
    return createJsonResponse({
      success: false,
      error: "Terjadi galat pada server Apps Script: " + err.message
    });
  }
}

/**
 * Helper: Menyelesaikan atau membuat hierarki folder berjenjang:
 * KK-Siswa / [TahunAjaran] / [Kelas]
 */
function resolveTargetFolder(academicYear, kelas) {
  // 1. Dapatkan atau buat Folder Induk "KK-Siswa" di root My Drive
  var rootFolder = getOrCreateFolder(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);

  // 2. Dapatkan atau buat Subfolder Tahun Ajaran (contoh: "2026-2027")
  var yearFolder = getOrCreateFolder(rootFolder, academicYear);

  // 3. Dapatkan atau buat Subfolder Kelas (contoh: "X.1")
  var classFolder = getOrCreateFolder(yearFolder, kelas);

  return classFolder;
}

/**
 * Helper: Ambil subfolder berdasarkan nama, atau buat baru jika belum ada
 */
function getOrCreateFolder(parentFolder, folderName) {
  var cleanName = String(folderName).trim();
  if (!cleanName) cleanName = "Umum";

  var folders = parentFolder.getFoldersByName(cleanName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(cleanName);
}

/**
 * Helper: Membuat respons JSON dengan header CORS yang tepat
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ============================================================================
 * FUNGSI OTOMATISASI PEMBERSIHAN BERKAS KEDALUWARSA (> 3 TAHUN / 1.095 HARI)
 * ============================================================================
 * Fungsi ini dapat dijalankan berkala melalui Time-driven trigger (misal tiap bulan).
 * Menelusuri seluruh berkas di dalam hierarki folder KK-Siswa, dan jika usia
 * pembuatan berkas telah melampaui 1.095 hari (siswa telah lulus), berkas
 * dipindahkan ke Trash Google Drive.
 */
function autoCleanupExpiredDocuments() {
  var rootFolders = DriveApp.getRootFolder().getFoldersByName(ROOT_FOLDER_NAME);
  if (!rootFolders.hasNext()) {
    return { scannedFiles: 0, trashedFiles: 0, message: "Folder induk '" + ROOT_FOLDER_NAME + "' tidak ditemukan." };
  }

  var rootFolder = rootFolders.next();
  var nowTime = new Date().getTime();
  var maxAgeMs = RETENTION_DAYS * 24 * 60 * 60 * 1000; // 3 tahun dalam milidetik

  var stats = {
    scannedFiles: 0,
    trashedFiles: 0,
    trashedNames: []
  };

  scanAndCleanFolder(rootFolder, nowTime, maxAgeMs, stats);

  Logger.log("Pembersihan selesai. Total dipindai: " + stats.scannedFiles + ", Dihapus ke sampah: " + stats.trashedFiles);
  return stats;
}

/**
 * Helper rekursif untuk memindai berkas di seluruh subfolder
 */
function scanAndCleanFolder(folder, nowTime, maxAgeMs, stats) {
  // Periksa berkas di folder saat ini
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    stats.scannedFiles++;

    var createdDate = file.getDateCreated();
    var ageMs = nowTime - createdDate.getTime();

    if (ageMs > maxAgeMs) {
      try {
        var fileName = file.getName();
        file.setTrashed(true);
        stats.trashedFiles++;
        if (stats.trashedNames.length < 50) {
          stats.trashedNames.push(fileName);
        }
        Logger.log("Menghapus berkas kedaluwarsa (> 3 tahun): " + fileName);
      } catch (e) {
        Logger.log("Gagal menghapus berkas: " + file.getName() + " -> " + e.message);
      }
    }
  }

  // Telusuri seluruh subfolder rekursif
  var subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    scanAndCleanFolder(subfolders.next(), nowTime, maxAgeMs, stats);
  }
}
