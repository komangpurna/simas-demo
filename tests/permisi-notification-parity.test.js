const fs = require('fs');
const path = require('path');

describe('Paritas Notifikasi Permisi Siswa & Relasi Push Notif', () => {
    const workerPath = path.join(__dirname, '../cloudflare/worker.js');
    const inboxPath = path.join(__dirname, '../js/notification-inbox.js');
    const workerContent = fs.readFileSync(workerPath, 'utf8');
    const inboxContent = fs.readFileSync(inboxPath, 'utf8');

    test('1. Cloudflare Worker membedakan judul notifikasi Permisi dari pelanggaran kedisiplinan', () => {
        expect(workerContent).toContain("studentTitle = '📋 Catatan Izin Permisi Siswa'");
        expect(workerContent).toContain("mentorTitle = '📋 Catatan Izin Permisi Siswa Binaan'");
    });

    test('2. Cloudflare Worker mengekstrak keterangan permisi (desc) lengkap agar tidak hanya tertulis Permisi', () => {
        expect(workerContent).toContain("studentBody = `Anda memiliki catatan izin permisi: \"${permDetail}\". Silakan periksa di Portal Siswa.`;");
        expect(workerContent).toContain("mentorBody = `${sName} (${sClass}) tercatat izin permisi: \"${permDetail}\".`;");
    });

    test('3. Cloudflare Worker mempertahankan judul kedisiplinan hanya untuk pelanggaran', () => {
        expect(workerContent).toContain("let studentTitle = '⚠️ Catatan Kedisiplinan Baru';");
        expect(workerContent).toContain("let mentorTitle = '⚠️ Catatan Kedisiplinan Siswa Binaan';");
    });

    test('4. notification-inbox.js menetapkan visual Perizinan (bukan tameng merah pelanggaran) untuk kata kunci permisi/izin', () => {
        expect(inboxContent).toContain("text.includes('permisi') || text.includes('izin')");
        expect(inboxContent).toContain("category: 'Perizinan'");
        expect(inboxContent).toContain("icon: 'fa-person-walking-arrow-right'");
        expect(inboxContent).toContain("iconColor: 'text-blue-600 dark:text-blue-400'");
    });

    test('5. Simulasi formater keterangan permisi menghasilkan detail yang informatif', () => {
        // Logika ekstraksi keterangan yang sama dengan yang ada di worker
        function formatPermDetail(dsc, typ) {
            let permDetail = dsc;
            if (typ && typ !== 'Permisi' && (!dsc || !dsc.includes(typ))) {
                permDetail = dsc ? `${typ} - ${dsc}` : typ;
            }
            if (!permDetail) {
                permDetail = typ || 'Izin meninggalkan kelas';
            }
            return permDetail;
        }

        // Skenario A: Input standar dari form page-input.js (type: 'Permisi', desc: '[12:05] kontrol gigi')
        const detailA = formatPermDetail('[12:05] kontrol gigi', 'Permisi');
        expect(detailA).toBe('[12:05] kontrol gigi');

        // Skenario B: Input dengan jenis izin spesifik (type: 'Izin Sakit', desc: '[10:00] Panas dan pusing')
        const detailB = formatPermDetail('[10:00] Panas dan pusing', 'Izin Sakit');
        expect(detailB).toBe('Izin Sakit - [10:00] Panas dan pusing');

        // Skenario C: Input tanpa desc (hanya type)
        const detailC = formatPermDetail('', 'Izin Keluar');
        expect(detailC).toBe('Izin Keluar');

        // Skenario D: Fallback jika kosong total
        const detailD = formatPermDetail('', '');
        expect(detailD).toBe('Izin meninggalkan kelas');
    });
});
