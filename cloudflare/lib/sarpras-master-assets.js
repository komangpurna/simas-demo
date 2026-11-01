import { MASTER_SARPRAS_TABLES, MASTER_SARPRAS_API, SMSR_SARPRAS_API } from '../../js/sarpras-storage-contract.mjs';
import { jsonResponse, errorResponse } from './http.js';

const assetManagers = ['super_admin', 'sarpras', 'admin_sarpras', 'admin'];
const assetStaff = [...assetManagers, 'kepala_sekolah', 'wakasek_kurikulum', 'kepala_lab', 'kesiswaan', 'humas', 'admin_spp', 'admin_perpus', 'admin_sukaduka', 'wali_kelas', 'guru', 'guru_piket', 'guru_bk', 'guru_mapel', 'staff', 'admin_kelas', 'admin_pks'];
const assetFail = (message, status = 400) => Object.assign(new Error(message), { status });
const assetText = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const assetDate = value => {
    const result = assetText(value || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Makassar' }), 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) throw assetFail('Tanggal tidak valid.');
    return result;
};

export async function handleMasterSarprasRequest(request, db, user) {
    try {
        const roles = [user?.role, ...(user?.additionalRoles || [])];
        const has = list => roles.some(role => list.includes(role));
        if (!user?.uid || user.isAnonymous || !has(assetStaff)) throw assetFail('Akses aset sekolah ditolak.', 403);

        const url = new URL(request.url);
        const method = request.method;
        const basePath = url.pathname.startsWith(MASTER_SARPRAS_API) ? MASTER_SARPRAS_API : SMSR_SARPRAS_API;
        const parts = url.pathname.slice(basePath.length + 1).split('/').map(decodeURIComponent);
        const [table, id] = parts;
        const raw = method === 'GET' || method === 'DELETE' ? '' : await request.text();
        if (raw.length > 20000) throw assetFail('Data aset terlalu besar.', 413);
        let body;
        try { body = raw ? JSON.parse(raw) : {}; } catch { throw assetFail('Data JSON tidak valid.'); }
        if (!body || Array.isArray(body) || typeof body !== 'object') throw assetFail('Data aset tidak valid.');
        const now = new Date().toISOString();

        if (table === 'actions' && method === 'POST' && parts.length === 2) {
            return jsonResponse({ success: true, data: await sarprasAction(db, id, body, user, has, now) }, 200, request);
        }

        const columns = Object.hasOwn(MASTER_SARPRAS_TABLES, table) && MASTER_SARPRAS_TABLES[table];
        if (!columns || parts.length > 2 || (parts.length === 2 && !id)) throw assetFail('Tabel aset tidak dikenal.', 404);

        if (method === 'GET') {
            const order = url.searchParams.get('order') || 'id';
            if (!columns.includes(order)) throw assetFail('Urutan data tidak valid.');
            const offset = Number(url.searchParams.get('offset') || 0);
            if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000000) throw assetFail('Halaman data tidak valid.');
            const rows = await db.prepare(`SELECT * FROM ${table} ORDER BY ${order} ${url.searchParams.get('ascending') === 'false' ? 'DESC' : 'ASC'}, id LIMIT 501 OFFSET ?`).bind(offset).all();
            return jsonResponse({ success: true, data: rows.results.slice(0, 500), more: rows.results.length > 500 }, 200, request);
        }

        const canSubmit = method === 'POST' && ['sarpras_permintaan', 'sarpras_perbaikan'].includes(table);
        if (!has(assetManagers) && !canSubmit) throw assetFail('Perubahan ini hanya untuk pengelola Sarpras.', 403);
        if (table === 'sarpras_peminjaman' && method !== 'DELETE') throw assetFail('Gunakan proses pinjam/kembali untuk menjaga stok.');

        if (method === 'DELETE' && id) {
            const result = await db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
            if (!result.meta.changes) throw assetFail('Data aset tidak ditemukan.', 404);
            return jsonResponse({ success: true }, 200, request);
        }

        if (!['POST', 'PUT'].includes(method) || (method === 'PUT' && !id) || (method === 'POST' && id)) throw assetFail('Metode aset tidak didukung.', 405);

        const data = {};
        for (const [key, value] of Object.entries(body)) {
            if (!columns.includes(key) || ['id', 'created_at', 'created_by_uid', 'reviewed_by_uid', 'returned_by_uid', 'resolved_by_uid'].includes(key)) continue;
            if (value !== null && typeof value !== 'string' && typeof value !== 'number') throw assetFail('Nilai kolom aset tidak valid.');
            if (typeof value === 'string' && value.length > 5000) throw assetFail('Teks aset terlalu panjang.');
            if (key === 'jumlah' || key.startsWith('jumlah_')) {
                if (!Number.isSafeInteger(Number(value)) || Number(value) < 0) throw assetFail('Jumlah aset harus bilangan bulat non-negatif.');
            }
            data[key] = value;
        }
        data.updated_at = now;

        if (table === 'sarpras_barang') {
            const total = Number(body.jumlah_total ?? body.jumlah);
            if (!Number.isSafeInteger(total) || total < 0) throw assetFail('Total stok tidak valid.');
            const price = Number(body.harga_satuan || 0);
            if (!Number.isFinite(price) || price < 0 || price > 9999999999999.99) throw assetFail('Harga aset tidak valid.');
            data.harga_satuan = price.toFixed(2);
            data.jumlah_total = total;
            data.jumlah = total;
            for (const key of ['jumlah_tersedia', 'jumlah_dipinjam', 'jumlah_rusak', 'jumlah_hilang']) delete data[key];
            if (method === 'POST') Object.assign(data, { jumlah_tersedia: total, jumlah_dipinjam: 0, jumlah_rusak: 0, jumlah_hilang: 0 });
        }

        if (canSubmit) {
            if (!Number.isSafeInteger(Number(data.jumlah ?? 1)) || Number(data.jumlah ?? 1) < 1) throw assetFail('Jumlah pengajuan minimal satu.');
            Object.assign(data, { status: 'Menunggu', created_by_uid: user.uid });
            delete data.reviewed_by_uid; delete data.resolved_by_uid;
        }

        const rowId = id || crypto.randomUUID();
        if (method === 'POST') {
            Object.assign(data, { id: rowId, created_at: now });
            const keys = Object.keys(data);
            await db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...keys.map(key => data[key])).run();
        } else {
            if (table === 'sarpras_perbaikan') data.resolved_by_uid = user.uid;
            const keys = Object.keys(data);
            const assignments = keys.map(key => `${key} = ?`);
            if (table === 'sarpras_barang') assignments.push('jumlah_tersedia = ? - jumlah_dipinjam - jumlah_rusak - jumlah_hilang');
            const values = keys.map(key => data[key]);
            if (table === 'sarpras_barang') values.push(data.jumlah_total);
            const result = await db.prepare(`UPDATE ${table} SET ${assignments.join(',')} WHERE id = ?`).bind(...values, rowId).run();
            if (!result.meta.changes) throw assetFail('Data aset tidak ditemukan.', 404);
        }

        return jsonResponse({ success: true, data: await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(rowId).first() }, 200, request);
    } catch (error) {
        const constraint = /constraint|stok|pinjaman|aktif/i.test(error.message);
        return errorResponse(error.status ? error.message : constraint ? 'Operasi ditolak: stok, kode aset atau transaksi aktif tidak sesuai.' : 'Operasi aset sekolah gagal.', error.status || (constraint ? 409 : 500), request);
    }
}

async function sarprasAction(db, action, body, user, has, now) {
    if (action === 'sarpras-pinjam-barang') {
        const item = await db.prepare('SELECT * FROM sarpras_barang WHERE id = ?').bind(assetText(body.barang_id, 100)).first();
        if (!item) throw assetFail('Barang tidak ditemukan.', 404);
        const quantity = Number(body.jumlah), start = assetDate(body.tanggal_pinjam), due = body.tanggal_kembali_rencana ? assetDate(body.tanggal_kembali_rencana) : null;
        if (!Number.isSafeInteger(quantity) || quantity < 1 || (due && due < start)) throw assetFail('Jumlah atau tanggal peminjaman tidak valid.');
        const id = crypto.randomUUID();
        await db.prepare(`INSERT INTO sarpras_peminjaman (id,barang_id,nama_barang,jumlah,nama_peminjam,role_peminjam,nip_nis,tanggal_pinjam,tanggal_kembali_rencana,keterangan,created_by_uid,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, item.id, item.nama, quantity, has(assetManagers) ? assetText(body.nama_peminjam || user.displayName || user.email, 150) : assetText(user.displayName || user.email || 'Civitas Sekolah', 150), assetText(user.role, 50), assetText(body.nip_nis, 50), start, due, assetText(body.keterangan), user.uid, now, now).run();
        return { id };
    }
    if (action === 'sarpras-kembalikan-barang') {
        const id = assetText(body.peminjaman_id, 100);
        const loan = await db.prepare('SELECT * FROM sarpras_peminjaman WHERE id = ?').bind(id).first();
        if (!loan) throw assetFail('Peminjaman tidak ditemukan.', 404);
        if (!has(assetManagers) && (!loan.created_by_uid || loan.created_by_uid !== user.uid)) throw assetFail('Pengembalian hanya oleh peminjam asli atau petugas Sarpras.', 403);
        if (!['Baik', 'Rusak', 'Hilang'].includes(body.kondisi_kembali)) throw assetFail('Kondisi pengembalian tidak valid.');
        const returned = assetDate(body.tanggal_kembali_realisasi);
        if (returned < loan.tanggal_pinjam) throw assetFail('Tanggal kembali mendahului tanggal pinjam.');
        await db.prepare(`UPDATE sarpras_peminjaman SET status='Dikembalikan',kondisi_kembali=?,tanggal_kembali_realisasi=?,catatan_kembali=?,returned_by_uid=?,updated_at=? WHERE id=? AND status='Dipinjam'`).bind(body.kondisi_kembali, returned, assetText(body.keterangan), user.uid, now, id).run();
        return { id };
    }
    if (action === 'sarpras-hapus-aset') {
        if (!has(assetManagers)) throw assetFail('Penghapusan hanya oleh pengelola Sarpras.', 403);
        const result = await db.prepare('DELETE FROM sarpras_barang WHERE id = ?').bind(assetText(body.barang_id, 100)).run();
        if (!result.meta.changes) throw assetFail('Barang tidak ditemukan.', 404);
        return { success: true };
    }
    if (action === 'sarpras-update-permintaan-status') {
        if (!has([...assetManagers, 'kepala_sekolah'])) throw assetFail('Persetujuan hanya oleh Sarpras atau Kepala Sekolah.', 403);
        if (!['Menunggu', 'Disetujui', 'Ditolak', 'Selesai'].includes(body.status)) throw assetFail('Status pengadaan tidak valid.');
        const result = await db.prepare('UPDATE sarpras_permintaan SET status=?,reviewed_by_uid=?,alasan_penolakan=?,updated_at=? WHERE id=?').bind(body.status, user.uid, assetText(body.alasan_penolakan), now, assetText(body.permintaan_id, 100)).run();
        if (!result.meta.changes) throw assetFail('Pengadaan tidak ditemukan.', 404);
        return { success: true };
    }
    throw assetFail('Proses aset tidak dikenal.', 404);
}
