/**
 * ============================================================================
 * GOOGLE APPS SCRIPT: SIMAS E-KINERJA GOOGLE DRIVE UPLOADER (STANDALONE)
 * ============================================================================
 * Versi: 1.0 (Khusus Modul E-Kinerja SIMAS SMAGESA)
 * 
 * Script ini khusus mengelola upload & delete foto bukti dukung E-Kinerja Guru.
 * Berjalan secara terpisah dari Web App Jurnal Mengajar agar tidak saling mengganggu,
 * namun menggunakan akun Google Drive / ruang penyimpanan sekolah yang sama.
 * 
 * STRUKTUR PENYIMPANAN DI GOOGLE DRIVE:
 * My Drive
 *   └── E-Kinerja
 *         └── YYYY-MM (contoh: 2026-09)
 *               └── [Nama_Guru] (contoh: I Komang Purna)
 *                     └── [File Foto Bukti KBM / Kegiatan]
 * 
 * ============================================================================
 * PANDUAN PENERAPAN (DEPLOYMENT) - HANYA 2 MENIT:
 * ============================================================================
 * 1. Buka https://script.google.com dengan Akun Google Drive sekolah.
 * 2. Klik tombol "New project" (Proyek baru) di kiri atas.
 * 3. Beri nama proyek di kiri atas: "SIMAS E-Kinerja Drive Uploader".
 * 4. Hapus semua baris kode default di editor (myFunction), lalu paste seluruh
 *    kode dari file ini ke dalam editor tersebut.
 * 5. Klik ikon Simpan (Save project).
 * 6. Klik tombol "Deploy" (Terapkan) berwarna biru di kanan atas -> pilih "New deployment".
 * 7. Klik ikon gerigi (Settings) di sebelah "Select type" -> pilih "Web app".
 * 8. Isi konfigurasi sebagai berikut:
 *    - Description : SIMAS E-Kinerja Uploader v1.0
 *    - Execute as  : Me (email akun Google Anda / sekolah)
 *    - Who has access : Anyone (Siapa saja, bahkan tanpa akun Google)  <-- WAJIB PILIH INI!
 * 9. Klik tombol "Deploy".
 * 10. Klik "Authorize access" (Izinkan akses) -> Pilih akun Google Anda:
 *     - Jika muncul "Google hasn't verified this app" / "Google belum memverifikasi aplikasi ini":
 *       Klik "Advanced" (Lanjutan) -> Klik "Go to SIMAS E-Kinerja Drive Uploader (unsafe)" -> Klik "Allow" (Izinkan).
 * 11. Salin "Web app URL" yang muncul (format: https://script.google.com/macros/s/AKfycb.../exec).
 * 12. Buka file `js/config.js` di proyek SIMAS, lalu tempel URL tersebut pada konstanta `EKINERJA_APPS_SCRIPT_URL`.
 * ============================================================================
 */

// Nama Folder Induk Utama di Google Drive
var ROOT_FOLDER_NAME = "E-Kinerja";

/**
 * Handle HTTP GET (Health check / verifikasi status di browser)
 */
function doGet(e) {
  var output = {
    status: "active",
    service: "SIMAS E-Kinerja Google Drive Uploader",
    rootFolder: ROOT_FOLDER_NAME,
    timestamp: new Date().toISOString(),
    message: "Layanan Google Apps Script E-Kinerja aktif dan siap menerima unggahan foto."
  };
  return ContentService.createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handle HTTP POST (Upload dan Delete Foto Bukti Dukung)
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
    // AKSI 1: Hapus Berkas Foto dari Google Drive (Delete Action)
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
          message: "Berkas foto bukti berhasil dipindahkan ke sampah Google Drive.",
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
    // AKSI 2: Unggah Berkas Foto ke Google Drive (Upload Action)
    // -------------------------------------------------------------
    if (action === "upload") {
      var base64Data = requestData.image;
      var fileName = requestData.fileName || ("bukti_" + new Date().getTime() + ".jpg");
      var guruName = requestData.guruName || "";
      var yearMonth = requestData.yearMonth || "";
      var folderPath = requestData.folderPath || requestData.kelas || "";

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

      // Dapatkan atau buat hierarki folder tujuan
      var targetFolder = resolveTargetFolder(folderPath, yearMonth, guruName);

      // Konversi Base64 menjadi Blob berkas gambar
      var decodedBytes = Utilities.base64Decode(base64Data);
      var blob = Utilities.newBlob(decodedBytes, "image/jpeg", fileName);

      // Buat berkas di folder target
      var file = targetFolder.createFile(blob);

      // Set hak akses agar gambar dapat dipratinjau publik (Anyone with link can view)
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (permErr) {
        Logger.log("Peringatan hak akses publik: " + permErr.message);
      }

      var fileId = file.getId();
      var viewUrl = file.getUrl();
      var directThumbUrl = "https://lh3.googleusercontent.com/d/" + fileId;

      return createJsonResponse({
        success: true,
        fileId: fileId,
        url: viewUrl,
        thumbnailUrl: directThumbUrl,
        name: fileName,
        folder: targetFolder.getName()
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
 * E-Kinerja / YYYY-MM / Nama_Guru
 */
function resolveTargetFolder(folderPath, yearMonth, guruName) {
  // 1. Dapatkan atau buat Folder Induk "E-Kinerja" di root My Drive
  var rootFolder = getOrCreateFolder(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);

  // Jika folderPath diberikan secara eksplisit (contoh: "E-Kinerja/2026-09/I Komang Purna")
  var parts = [];
  if (folderPath && typeof folderPath === "string") {
    parts = folderPath.split("/").map(function(p) { return p.trim(); }).filter(Boolean);
    // Hapus kata awal "E-Kinerja" jika sudah ada di path
    if (parts.length > 0 && parts[0].toLowerCase() === ROOT_FOLDER_NAME.toLowerCase()) {
      parts.shift();
    }
  }

  // Jika parts kosong, buat otomatis dari YYYY-MM dan Nama Guru
  if (parts.length === 0) {
    var now = new Date();
    var ym = yearMonth || (now.getFullYear() + "-" + ("0" + (now.getMonth() + 1)).slice(-2));
    var guru = guruName || "Guru";
    parts = [ym, guru];
  }

  // Telusuri atau buat subfolder berjenjang
  var currentFolder = rootFolder;
  for (var i = 0; i < parts.length; i++) {
    var segment = parts[i];
    if (segment) {
      currentFolder = getOrCreateFolder(currentFolder, segment);
    }
  }

  return currentFolder;
}

/**
 * Helper: Ambil folder yang sudah ada berdasarkan nama, atau buat baru jika belum ada
 */
function getOrCreateFolder(parentFolder, folderName) {
  var folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(folderName);
}

/**
 * Helper: Format JSON Response dengan MIME Type application/json
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
