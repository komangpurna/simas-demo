/**
 * js/sarpras-storage-contract.mjs - Kontrak Definisi Skema Tabel Aset Induk Sarpras (D1)
 * Single Source of Truth (SSOT) untuk Master Tanah, Bangunan, Stok, Kelompok & Bantuan
 */
const audit = ['created_at', 'updated_at'];
export const MASTER_SARPRAS_TABLES = Object.freeze({
    sarpras_kelompok_barang: ['id', 'kode', 'jenis_barang', 'keterangan', ...audit],
    sarpras_jenis_bantuan: ['id', 'kode', 'nama', 'keterangan', ...audit],
    sarpras_tanah: ['id', 'kode', 'nama', 'luas', 'lokasi', 'status_kepemilikan', 'jenis_bantuan_nama', 'keterangan', ...audit],
    sarpras_bangunan: ['id', 'kode', 'nama', 'tahun', 'luas', 'jumlah_ruang', 'jenis_bantuan_nama', 'keterangan', ...audit],
    sarpras_barang: ['id', 'kode', 'nama', 'jenis_barang', 'tahun', 'jumlah', 'harga_satuan', 'jenis_bantuan_nama', 'tanggal_perolehan', 'keterangan', ...audit, 'jumlah_total', 'jumlah_tersedia', 'jumlah_dipinjam', 'jumlah_rusak', 'jumlah_hilang'],
    sarpras_permintaan: ['id', 'tanggal', 'nama_pemohon', 'nip_nis', 'role_pemohon', 'nama_barang', 'jumlah', 'keperluan', 'status', 'keterangan', ...audit, 'created_by_uid', 'reviewed_by_uid', 'alasan_penolakan'],
    sarpras_peminjaman: ['id', 'tanggal_pinjam', 'nama_peminjam', 'nip_nis', 'role_peminjam', 'barang_id', 'nama_barang', 'jumlah', 'tanggal_kembali_rencana', 'tanggal_kembali_realisasi', 'status', 'kondisi_kembali', 'keterangan', ...audit, 'created_by_uid', 'returned_by_uid', 'catatan_kembali'],
    sarpras_perbaikan: ['id', 'tanggal', 'nama_pelapor', 'nip_nis', 'role_pelapor', 'lokasi_fasilitas', 'deskripsi_kerusakan', 'tingkat_kerusakan', 'tindakan', 'status', 'tanggal_selesai', 'keterangan', ...audit, 'created_by_uid', 'resolved_by_uid']
});

// Backward-compatible alias
export const SMSR_SARPRAS_TABLES = MASTER_SARPRAS_TABLES;
export const MASTER_SARPRAS_STORAGE_KEY = 'sarpras_master_storage';
export const SMSR_SARPRAS_STORAGE_KEY = 'sarpras_smsr_storage';
export const MASTER_SARPRAS_API = '/api/sarpras/master-assets';
export const SMSR_SARPRAS_API = '/api/sarpras/smsr';
