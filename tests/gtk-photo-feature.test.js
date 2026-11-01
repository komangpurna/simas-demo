const fs = require('fs');
const path = require('path');

describe('Fitur Foto Profil GTK di Cloudflare R2 & D1', () => {
    const workerSource = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8');
    const globalSource = fs.readFileSync(path.join(__dirname, '../js/global.js'), 'utf8');
    const gtkSource = fs.readFileSync(path.join(__dirname, '../js/page-gtk.js'), 'utf8');
    const clientSource = fs.readFileSync(path.join(__dirname, '../js/cloudflare-client.js'), 'utf8');
    const wranglerSource = fs.readFileSync(path.join(__dirname, '../cloudflare/wrangler.toml'), 'utf8');
    const schemaSource = fs.readFileSync(path.join(__dirname, '../cloudflare/schema.sql'), 'utf8');

    describe('1. Skema Basis Data & Konfigurasi Wrangler', () => {
        test('Tabel gtk memiliki kolom foto TEXT', () => {
            expect(schemaSource).toMatch(/foto\s+TEXT/i);
        });

        test('Wrangler memiliki binding GTK_PHOTOS_BUCKET terpisah untuk smagesa-gtk-photos', () => {
            expect(wranglerSource).toContain('GTK_PHOTOS_BUCKET');
            expect(wranglerSource).toContain('smagesa-gtk-photos');
        });
    });

    describe('2. Backend Cloudflare Worker Endpoints & RBAC Security', () => {
        test('Worker mengimplementasikan migrasi idempotent ensureGtkPhotoColumn', () => {
            expect(workerSource).toContain('ensureGtkPhotoColumn');
            expect(workerSource).toContain('ALTER TABLE gtk ADD COLUMN foto TEXT');
        });

        test('Endpoint POST /api/gtk/photo/upload memvalidasi auth, non-siswa, dan kepemilikan / super_admin', () => {
            expect(workerSource).toContain('/api/gtk/photo/upload');
            // Menolak role siswa / admin_kelas
            expect(workerSource).toContain("['siswa', 'admin_kelas', 'admin_pks'].includes(role)");
            expect(workerSource).toContain("Forbidden: Akses upload foto profil GTK ditolak untuk akun siswa/admin kelas.");
            // Validasi hak akses: hanya pemilik akun atau super_admin
            expect(workerSource).toContain("Forbidden: Anda tidak memiliki wewenang untuk mengubah foto profil pengguna lain.");
            // Menyimpan ke GTK_PHOTOS_BUCKET atau fallback
            expect(workerSource).toContain('GTK_PHOTOS_BUCKET');
            expect(workerSource).toContain('UPDATE gtk SET foto = ?, updated_at = datetime(\'now\')');
        });

        test('Endpoint DELETE /api/gtk/photo/:id memvalidasi izin dan mengosongkan kolom foto', () => {
            expect(workerSource).toContain('/api/gtk/photo/');
            expect(workerSource).toContain("UPDATE gtk SET foto = NULL, updated_at = datetime('now') WHERE id = ?");
            expect(workerSource).toContain('r2Bucket.delete');
        });

        test('Endpoint GET /api/photos/gtk/:filename melayani gambar WebP dengan Cache-Control', () => {
            expect(workerSource).toContain('/api/photos/gtk/');
            expect(workerSource).toContain('image/webp');
            expect(workerSource).toContain('public, max-age=');
        });

        test('Query GTK mengembalikan kolom foto dan photo_url', () => {
            expect(workerSource).toContain('foto: r.foto || null');
            expect(workerSource).toContain('photo_url: r.foto || null');
        });
    });

    describe('3. Cloudflare Client API', () => {
        test('CloudflareClient memiliki method uploadGtkPhoto dan deleteGtkPhoto', () => {
            expect(clientSource).toContain('uploadGtkPhoto');
            expect(clientSource).toContain('/api/gtk/photo/upload');
            expect(clientSource).toContain('deleteGtkPhoto');
            expect(clientSource).toContain('/api/gtk/photo/');
        });
    });

    describe('4. Kompresi Gambar Client-Side & UI Global', () => {
        test('compressImageToWebP tersedia di js/global.js dengan target WebP dan crop 1:1', () => {
            expect(globalSource).toContain('export async function compressImageToWebP');
            expect(globalSource).toContain('image/webp');
            expect(globalSource).toContain('targetDim');
        });

        test('Edit profil user hanya menampilkan opsi foto jika user terhubung ke GTK (tanpa auto-upsert)', () => {
            const openEditProfileIdx = globalSource.indexOf('window.openEditProfile = async function');
            const openEditProfileSnippet = globalSource.slice(openEditProfileIdx, openEditProfileIdx + 8000);

            expect(openEditProfileSnippet).toContain('getLinkedTeacherForUser');
            expect(openEditProfileSnippet).toContain('profile-photo-upload-section');
            expect(openEditProfileSnippet).toContain("photoSection.classList.remove('hidden')");
            expect(openEditProfileSnippet).toContain("photoSection.classList.add('hidden')");
        });

        test('updateUIAvatars memperbarui tampilan avatar secara real-time di sidebar dan mobile menu', () => {
            expect(globalSource).toContain('updateUIAvatars');
            expect(globalSource).toContain('user-avatar-container');
        });

        test('Foto profil tidak disimpan di Firestore users (menjaga kuota Firestore)', () => {
            const saveProfileIdx = globalSource.indexOf('window.saveEditProfile = async function');
            const nextFnIdx = globalSource.indexOf('window.updateSidebarProfileFromDB', saveProfileIdx);
            const saveProfileSnippet = globalSource.slice(saveProfileIdx, nextFnIdx !== -1 ? nextFnIdx : saveProfileIdx + 25000);
            
            expect(saveProfileSnippet).not.toContain('updateDoc(userDocRef, { photo:');
            expect(saveProfileSnippet).not.toContain('updateDoc(userDocRef, { photo_url:');
            expect(saveProfileSnippet).toContain('cfClient.uploadGtkPhoto');
            expect(saveProfileSnippet).toContain('cfClient.deleteGtkPhoto');
        });

        test('Guru dan staf biasa hanya bisa mengedit/mengganti foto profil, tombol hapus foto profil dibatasi untuk Super Admin', () => {
            expect(globalSource).toContain('Khusus Super Admin yang berhak menghapus foto profil GTK; guru/staf hanya edit/ganti');
            expect(globalSource).toContain("btnLabel.textContent = 'Ganti Foto'");
            expect(globalSource).toContain('btnRemovePhoto.classList.add(\'hidden\')');
            expect(globalSource).toContain('Ketik kata <b>HAPUS</b>');
        });
    });

    describe('5. RBAC Halaman GTK (Hanya Super Admin)', () => {
        test('Section foto profil di modal edit GTK hanya muncul jika user adalah Super Admin', () => {
            expect(gtkSource).toContain('gtk-photo-edit-section');
            expect(gtkSource).toContain('isSuperAdmin');
        });

        test('Simpan edit GTK hanya mengunggah/menghapus foto jika user adalah Super Admin', () => {
            expect(gtkSource).toContain('PROSES UPLOAD / HAPUS FOTO GTK (KHUSUS SUPER ADMIN)');
            expect(gtkSource).toContain('isSuperAdmin');
            expect(gtkSource).toContain('cfClient.uploadGtkPhoto');
            expect(gtkSource).toContain('cfClient.deleteGtkPhoto');
        });

        test('Penghapusan foto GTK di page-gtk.js mewajibkan konfirmasi ketik HAPUS', () => {
            expect(gtkSource).toContain('btn-delete-edit-gtk-photo');
            expect(gtkSource).toContain('Ketik kata <b>HAPUS</b>');
            expect(workerSource).toContain('Hanya Super Admin yang berhak menghapus foto profil GTK');
        });
    });

    describe('6. Fitur Editor Interaktif Foto Profil (Crop 1:1, Rotasi 90°, Zoom & Pan)', () => {
        test('Modal editor foto profil modal-crop-profile-photo tersedia di js/global.js', () => {
            expect(globalSource).toContain('id="modal-crop-profile-photo"');
            expect(globalSource).toContain('id="profile-crop-canvas"');
            expect(globalSource).toContain('id="profile-crop-zoom-range"');
            expect(globalSource).toContain('btn-apply-profile-crop');
        });

        test('Fungsi editor foto profil openProfilePhotoEditor, rotate, zoom, dan reset tersedia', () => {
            expect(globalSource).toContain('window.openProfilePhotoEditor = function');
            expect(globalSource).toContain('window.closeProfilePhotoEditor = function');
            expect(globalSource).toContain('window.rotateProfileCrop = function');
            expect(globalSource).toContain('window.setProfileCropZoom = function');
            expect(globalSource).toContain('window.resetProfileCrop = function');
            expect(globalSource).toContain('window.applyProfileCrop = function');
        });

        test('Kanvas crop menggunakan rasio 1:1, rotasi 90 derajat, dan ekspor WebP kualitas optimal', () => {
            expect(globalSource).toContain('canvas.width = 400');
            expect(globalSource).toContain('canvas.height = 400');
            expect(globalSource).toContain('(profileCropRotation * Math.PI) / 180');
            expect(globalSource).toContain("canvas.toDataURL('image/webp', 0.82)");
        });

        test('Halaman GTK page-gtk.js terintegrasi dengan openProfilePhotoEditor untuk edit foto sebelum simpan', () => {
            expect(gtkSource).toContain('window.openProfilePhotoEditor');
            expect(gtkSource).toContain('applyPhotoResult');
        });

        test('Pemuatan foto di js/global.js menggunakan teknik hemat memori URL.createObjectURL dan auto-revoke', () => {
            expect(globalSource).toContain('URL.createObjectURL(file)');
            expect(globalSource).toContain('URL.revokeObjectURL');
            expect(globalSource).toContain('cleanupProfileCropBlobUrl');
        });
    });
});

