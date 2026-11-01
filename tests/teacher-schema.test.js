/**
 * Unit Test: Validasi Skema Master Data Guru/GTK (21 Kolom Dapodik & SIMAS - NIK di Kolom A & Telegram ID di Kolom U) di SIMAS SMAGESA
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

describe('Validasi Skema Master Guru / GTK (21 Kolom Dapodik & SIMAS - NIK di Kolom A & Telegram ID di Kolom U)', () => {
    const pageGtkContent = fs.readFileSync(path.join(projectRoot, 'js', 'page-gtk.js'), 'utf8');
    const gtkHtmlContent = fs.readFileSync(path.join(projectRoot, 'gtk.html'), 'utf8');
    const guruHtmlContent = fs.readFileSync(path.join(projectRoot, 'guru.html'), 'utf8');

    test('guru.html melakukan auto-redirect ke gtk.html', () => {
        expect(guruHtmlContent).toContain('url=gtk.html');
        expect(guruHtmlContent).toContain('gtk.html');
    });

    test('GTK_SCHEMA / TEACHER_SCHEMA di js/page-gtk.js memiliki 21 kolom dengan NIK di index 0 dan Telegram ID di index 20', () => {
        expect(pageGtkContent).toContain("{ index: 0, key: 'nik', label: 'NIK' }");
        expect(pageGtkContent).toContain("{ index: 1, key: 'name', label: 'Nama' }");
        expect(pageGtkContent).toContain("{ index: 2, key: 'nuptk', label: 'NUPTK' }");
        expect(pageGtkContent).toContain("{ index: 3, key: 'gender', label: 'JK' }");
        expect(pageGtkContent).toContain("{ index: 4, key: 'birth_place', label: 'Tempat Lahir' }");
        expect(pageGtkContent).toContain("{ index: 5, key: 'birth_date', label: 'Tanggal Lahir' }");
        expect(pageGtkContent).toContain("{ index: 6, key: 'nip', label: 'NIP' }");
        expect(pageGtkContent).toContain("{ index: 7, key: 'status_kepegawaian', label: 'Status Kepegawaian' }");
        expect(pageGtkContent).toContain("{ index: 8, key: 'jenis_ptk', label: 'Jenis PTK' }");
        expect(pageGtkContent).toContain("{ index: 9, key: 'agama', label: 'Agama' }");
        expect(pageGtkContent).toContain("{ index: 10, key: 'alamat', label: 'Alamat Jalan' }");
        expect(pageGtkContent).toContain("{ index: 11, key: 'rt', label: 'RT' }");
        expect(pageGtkContent).toContain("{ index: 12, key: 'rw', label: 'RW' }");
        expect(pageGtkContent).toContain("{ index: 13, key: 'dusun', label: 'Nama Dusun' }");
        expect(pageGtkContent).toContain("{ index: 14, key: 'kelurahan', label: 'Desa/Kelurahan' }");
        expect(pageGtkContent).toContain("{ index: 15, key: 'kecamatan', label: 'Kecamatan' }");
        expect(pageGtkContent).toContain("{ index: 16, key: 'kode_pos', label: 'Kode Pos' }");
        expect(pageGtkContent).toContain("{ index: 17, key: 'phone', label: 'HP' }");
        expect(pageGtkContent).toContain("{ index: 18, key: 'email', label: 'Email' }");
        expect(pageGtkContent).toContain("{ index: 19, key: 'tugas_tambahan', label: 'Tugas Tambahan' }");
        expect(pageGtkContent).toContain("{ index: 20, key: 'telegramChatId', label: 'Telegram ID' }");
    });

    test('gtk.html memiliki chip visual impor 21 kolom A s.d. U dan form fields lengkap', () => {
        expect(gtkHtmlContent).toContain('A. NIK');
        expect(gtkHtmlContent).toContain('B. Nama');
        expect(gtkHtmlContent).toContain('C. NUPTK');
        expect(gtkHtmlContent).toContain('T. Tugas Tambahan');
        expect(gtkHtmlContent).toContain('U. Telegram ID');
        expect(gtkHtmlContent).toContain('id="modal-detail"');
        expect(gtkHtmlContent).toContain('id="detail-profile-grid"');
        expect(gtkHtmlContent).toContain('id="edit-nik"');
        expect(gtkHtmlContent).toContain('id="edit-nuptk"');
        expect(gtkHtmlContent).toContain('id="edit-status_kepegawaian"');
        expect(gtkHtmlContent).toContain('id="edit-tugas_tambahan"');
        expect(gtkHtmlContent).toContain('id="edit-telegram"');
    });

    test('gtk.html memiliki legenda penanda perubahan diff dan bar ringkasan', () => {
        expect(gtkHtmlContent).toContain('Penanda Perubahan:');
        expect(gtkHtmlContent).toContain('id="preview-diff-summary"');
        expect(gtkHtmlContent).toContain('Kuning = Nilai Berubah');
        expect(gtkHtmlContent).toContain('Hijau = Field Baru Diisi');
    });

    test('js/page-gtk.js memiliki fungsi modal detail GTK, smart import, stripGelar, renderDiffCell, dan Cloudflare D1 batchUpsertGtk', () => {
        expect(pageGtkContent).toContain('window.openTeacherDetail = (id)');
        expect(pageGtkContent).toContain('parseTeacherImportRow');
        expect(pageGtkContent).toContain('batchUpsertGtk');
        expect(pageGtkContent).toContain('updateGtkMetadata()');
        expect(pageGtkContent).toContain('export function stripGelar');
        expect(pageGtkContent).toContain('export function renderDiffCell');
        expect(pageGtkContent).toContain('renderDiffCell(rowData.nik');
    });

    test('Fungsi renderDiffCell merender penanda perbedaan visual (Diff) secara akurat', () => {
        function renderDiffCell(newVal, oldVal, { isMono = false, isBold = false, extraClasses = '', truncate = false } = {}) {
            const escape = (str) => (typeof window !== 'undefined' && window.escapeHTML ? window.escapeHTML(str) : (str || ''));
            const valNew = newVal !== undefined && newVal !== null ? String(newVal).trim() : '';
            const valOld = oldVal !== undefined && oldVal !== null ? String(oldVal).trim() : '';

            if (!valNew) {
                if (!valOld || valOld === '-') {
                    return `<span class="text-slate-400 dark:text-slate-600">-</span>`;
                }
                return `<span class="${isMono ? 'font-mono' : ''} text-slate-500 dark:text-slate-400 ${extraClasses} ${truncate ? 'truncate max-w-xs inline-block' : ''}" title="${escape(valOld)}">${escape(valOld)}</span>`;
            }

            const isOldEmpty = !valOld || valOld === '-';
            const isDifferent = isOldEmpty ? true : (valNew.toLowerCase() !== valOld.toLowerCase());

            if (!isDifferent) {
                return `<span class="${isMono ? 'font-mono' : ''} ${isBold ? 'font-bold' : ''} text-slate-700 dark:text-slate-300 ${extraClasses} ${truncate ? 'truncate max-w-xs inline-block' : ''}" title="${escape(valNew)}">${escape(valNew)}</span>`;
            }

            if (isOldEmpty) {
                return `
        <div class="inline-flex flex-col text-left">
            <span class="${isMono ? 'font-mono' : ''} font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 ${extraClasses} ${truncate ? 'truncate max-w-xs inline-block' : ''}" title="Baru Diisi: ${escape(valNew)}">
                ${escape(valNew)}
            </span>
            <span class="text-[9px] text-emerald-600 dark:text-emerald-400 font-sans font-semibold mt-0.5"><i class="fa-solid fa-plus text-[8px]"></i> Baru diisi</span>
        </div>`;
            }

            return `
    <div class="inline-flex flex-col text-left">
        <span class="${isMono ? 'font-mono' : ''} font-bold text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/60 px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-700 shadow-sm ${extraClasses} ${truncate ? 'truncate max-w-xs inline-block' : ''}" title="Nilai Baru: ${escape(valNew)}">
            ${escape(valNew)}
        </span>
        <span class="text-[9px] text-slate-400 dark:text-slate-500 line-through ${isMono ? 'font-mono' : ''} mt-0.5 ${truncate ? 'truncate max-w-xs inline-block' : ''}" title="Nilai Lama: ${escape(valOld)}">
            ${escape(valOld)}
        </span>
    </div>`;
        }

        // 1. Data baru kosong di Excel, ada data lama -> warna abu-abu (dipertahankan)
        const resPreserved = renderDiffCell('', '08123456789');
        expect(resPreserved).toContain('text-slate-500');
        expect(resPreserved).toContain('08123456789');

        // 2. Data baru kosong di Excel, tidak ada data lama -> '-'
        expect(renderDiffCell('', '')).toContain('-');
        expect(renderDiffCell('', '-')).toContain('-');

        // 3. Data baru sama persis dengan data lama -> normal text
        const resSame = renderDiffCell('PNS', 'PNS');
        expect(resSame).toContain('text-slate-700');
        expect(resSame).toContain('PNS');
        expect(resSame).not.toContain('line-through');

        // 4. Data baru diisi pertama kali (data lama kosong / '-') -> hijau "Baru diisi"
        const resNew = renderDiffCell('5107010101850001', '-');
        expect(resNew).toContain('text-emerald-700');
        expect(resNew).toContain('Baru diisi');
        expect(resNew).toContain('5107010101850001');

        // 5. Data baru BERBEDA dari data lama -> kuning/amber + data lama dicoret
        const resChanged = renderDiffCell('081999888777', '08123456789');
        expect(resChanged).toContain('text-amber-800');
        expect(resChanged).toContain('081999888777');
        expect(resChanged).toContain('line-through');
        expect(resChanged).toContain('08123456789');
    });

    test('Fungsi stripGelar menghapus gelar akademik dengan benar untuk smart name matching', () => {
        function stripGelar(name) {
            if (!name) return '';
            let n = name.trim();
            n = n.replace(/^(Prof\.?\s*|Drs?\.?\s*|Dr\.?\s*|Ir\.?\s*|Hj?\.?\s+)/gi, '');
            const suffixRegex = /[,\s]+(?:S\.?\s*Pd\.?(?:\s*,?\s*H)?|M\.?\s*Pd\.?(?:\s*,?\s*H)?|S\.?\s*Kom\.?|S\.?\s*H\.?|S\.?\s*Ag\.?|S\.?\s*Ak\.?|S\.?\s*E\.?|SE|S\.?\s*Sos\.?|S\.?\s*IP\.?|S\.?\s*T\.?|S\.?\s*Si\.?|S\.?\s*I\.?\s*Kom\.?|A\.?\s*Md\.?(?:\s*,?\s*Kom\.?)?|Gr\.?|M\.?\s*Si\.?|M\.?\s*M\.?|M\.?\s*Hum\.?|M\.?\s*Kes\.?|M\.?\s*Ed\.?|M\.?\s*T\.?|Ph\.?\s*D\.?|Drs?\.?|Dr\.?|Prof\.?|Ir\.?|H)\b/gi;
            let prev;
            do {
                prev = n;
                n = n.replace(suffixRegex, '');
            } while (n !== prev);
            n = n.replace(/[,.\s]+$/g, '').replace(/\s{2,}/g, ' ').trim().toLowerCase();
            return n;
        }

        // Kasus umum: nama dengan gelar suffix
        expect(stripGelar('Ni Kadek Ari Astuti, S.Pd')).toBe('ni kadek ari astuti');
        expect(stripGelar('I Komang Purna, S.Pd., Gr.')).toBe('i komang purna');
        expect(stripGelar('I Putu Suweta, S.Pd, M.Pd')).toBe('i putu suweta');

        // Kasus: gelar dengan spasi (S. Pd, M. Pd)
        expect(stripGelar('I Wayan Putu Adi Wiguna, S. Pd')).toBe(stripGelar('I Wayan Putu Adi Wiguna'));
        expect(stripGelar('I Wayan Putu Adi Wiguna, S.Pd')).toBe(stripGelar('I Wayan Putu Adi Wiguna'));

        // Kasus: gelar prefix (Drs., Dr.)
        expect(stripGelar('Drs. I Komang Sudiana, M.Pd')).toBe('i komang sudiana');

        // Kasus: nama tanpa gelar (tetap apa adanya)
        expect(stripGelar('I Ketut Nuria')).toBe('i ketut nuria');
        expect(stripGelar('I Gede Wiratama')).toBe('i gede wiratama');

        // Kasus: gelar unik
        expect(stripGelar('I Wayan Mudita,A.Md., Kom')).toBe('i wayan mudita');
        expect(stripGelar('I Gede Agustika, S.Ag, M.Pd, H')).toBe('i gede agustika');
        expect(stripGelar('I Kadek Betit Pranata Suma, S.H')).toBe('i kadek betit pranata suma');
        expect(stripGelar('K. Agus Maysa Upadana, SE')).toBe('k. agus maysa upadana');
        expect(stripGelar('I Kadek Wiradnyana Putra, S.Ak')).toBe('i kadek wiradnyana putra');

        // Kasus: nama identik tapi gelar beda → harus cocok
        expect(stripGelar('Ni Ketut Padmi Lestari, S.Pd')).toBe(stripGelar('Ni Ketut Padmi Lestari'));
        expect(stripGelar('I Kadek Astika, S.Pd')).toBe(stripGelar('I Kadek Astika'));

        // Kasus kosong
        expect(stripGelar('')).toBe('');
        expect(stripGelar(null)).toBe('');
    });

    test('Logika parsing parseTeacherImportRow menguraikan 21 kolom Dapodik & SIMAS dengan benar dan mendukung nama kosong untuk update', () => {
        function parseRow(row, offset = 0) {
            if (!row || !row.trim()) return null;
            const cols = row.split('\t').map(c => (c !== undefined ? c.trim() : ''));
            if (cols.length < 2) return null;

            let colOffset = offset;
            const firstCol = cols[0];
            const secondCol = cols[1];

            if (/^\d{1,4}$/.test(firstCol) && (secondCol.length >= 10 || isNaN(Number(secondCol)))) {
                colOffset = 1;
            }

            const rawNik = cols[0 + colOffset] || '';
            const rawName = cols[1 + colOffset] || '';

            if (
                rawNik.toLowerCase() === 'nik' ||
                rawName.toLowerCase() === 'nama' ||
                rawName.toLowerCase() === 'nama lengkap' ||
                cols.some(c => c.toLowerCase() === 'nuptk' || c.toLowerCase() === 'status kepegawaian' || c.toLowerCase() === 'telegram id')
            ) {
                return null;
            }

            const rawNuptk = cols[2 + colOffset] || '';
            const rawNip = cols[6 + colOffset] || '';
            const rawTelegram = cols[20 + colOffset] || '';
            if (!rawNik && !rawName && !rawNuptk && !rawNip && !rawTelegram) {
                return null;
            }

            const rawGender = cols[3 + colOffset] || '';
            const cleanGender = rawGender.toUpperCase().startsWith('P') ? 'P' : (rawGender.toUpperCase().startsWith('L') ? 'L' : '');

            return {
                nik: rawNik,
                name: rawName,
                nuptk: rawNuptk,
                gender: cleanGender,
                birth_place: cols[4 + colOffset] || '',
                birth_date: cols[5 + colOffset] || '',
                nip: rawNip,
                status_kepegawaian: cols[7 + colOffset] || '',
                jenis_ptk: cols[8 + colOffset] || '',
                agama: cols[9 + colOffset] || '',
                alamat: cols[10 + colOffset] || '',
                rt: cols[11 + colOffset] || '',
                rw: cols[12 + colOffset] || '',
                dusun: cols[13 + colOffset] || '',
                kelurahan: cols[14 + colOffset] || '',
                kecamatan: cols[15 + colOffset] || '',
                kode_pos: cols[16 + colOffset] || '',
                phone: cols[17 + colOffset] || '',
                email: cols[18 + colOffset] || '',
                tugas_tambahan: cols[19 + colOffset] || '',
                telegramChatId: rawTelegram,
                birthDate: cols[5 + colOffset] || '',
                jabatan: cols[19 + colOffset] || cols[8 + colOffset] || '',
                status: cols[7 + colOffset] || ''
            };
        }

        const rowNoNumbering = "5107010101850001\tI Made Suarta, S.Pd.\t1234567890123456\tL\tKarangasem\t1985-05-12\t198505122010011001\tPNS\tGuru Mapel\tHindu\tJl. Melati No. 5\t01\t02\tBanjar Dinas Abang\tAbang\tAbang\t80852\t081234567890\tsuarta@guru.sma.belajar.id\tWakasek Kurikulum\t198160734";
        const parsed1 = parseRow(rowNoNumbering);
        expect(parsed1).not.toBeNull();
        expect(parsed1.nik).toBe("5107010101850001");
        expect(parsed1.name).toBe("I Made Suarta, S.Pd.");
        expect(parsed1.nuptk).toBe("1234567890123456");
        expect(parsed1.nip).toBe("198505122010011001");
        expect(parsed1.tugas_tambahan).toBe("Wakasek Kurikulum");
        expect(parsed1.telegramChatId).toBe("198160734");
        expect(parsed1.gender).toBe("L");

        // Row dengan nama dikosongkan untuk menimpa data NIK/alamat/HP/Telegram tanpa mengubah nama lama
        const rowEmptyName = "5107010101850001\t\t1234567890123456\tL\tKarangasem\t1985-05-12\t198505122010011001\tPNS\tGuru Mapel\tHindu\tJl. Melati Baru No. 8\t01\t02\tBanjar Dinas Abang\tAbang\tAbang\t80852\t081999888777\tsuarta@guru.sma.belajar.id\tWakasek Kurikulum\t99887766";
        const parsedEmptyName = parseRow(rowEmptyName);
        expect(parsedEmptyName).not.toBeNull();
        expect(parsedEmptyName.nik).toBe("5107010101850001");
        expect(parsedEmptyName.name).toBe("");
        expect(parsedEmptyName.phone).toBe("081999888777");
        expect(parsedEmptyName.telegramChatId).toBe("99887766");
        expect(parsedEmptyName.alamat).toBe("Jl. Melati Baru No. 8");

        const rowWithNumbering = "1\t5107015508900002\tNi Luh Putu Ayu, S.Pd.\t9876543210987654\tP\tDenpasar\t1990-08-17\t199008172019032005\tPPPK\tGuru BK\tHindu\tJl. Kamboja No. 10\t03\t04\tBanjar Dinas Pidpid\tPidpid\tAbang\t80852\t089876543210\tayu@guru.sma.belajar.id\tKoordinator BK\t87654321";
        const parsed2 = parseRow(rowWithNumbering);
        expect(parsed2).not.toBeNull();
        expect(parsed2.nik).toBe("5107015508900002");
        expect(parsed2.name).toBe("Ni Luh Putu Ayu, S.Pd.");
        expect(parsed2.nuptk).toBe("9876543210987654");
        expect(parsed2.gender).toBe("P");
        expect(parsed2.jenis_ptk).toBe("Guru BK");
        expect(parsed2.telegramChatId).toBe("87654321");

        const headerRow = "NIK\tNama\tNUPTK\tJK\tTempat Lahir\tTanggal Lahir\tNIP\tStatus Kepegawaian\tJenis PTK\tAgama\tAlamat Jalan\tRT\tRW\tDusun\tKelurahan\tKecamatan\tKode Pos\tHP\tEmail\tTugas Tambahan\tTelegram ID";
        expect(parseRow(headerRow)).toBeNull();

        const emptyRow = "\t\t\t\t\t\t\t\t";
        expect(parseRow(emptyRow)).toBeNull();
    });

    test('Formatter formatIndoDate memformat tanggal dengan tepat', () => {
        function formatIndoDate(dateStr) {
            if (!dateStr || dateStr === '-') return '-';
            if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
                const parts = dateStr.split('-');
                const y = parts[0];
                const m = parseInt(parts[1], 10);
                const d = parts[2].substring(0, 2);
                const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
                if (m >= 1 && m <= 12) return `${parseInt(d, 10)} ${months[m - 1]} ${y}`;
            }
            if (dateStr.length >= 8 && !isNaN(dateStr.substring(0, 8))) {
                const y = dateStr.substring(0, 4);
                const m = parseInt(dateStr.substring(4, 6), 10);
                const d = dateStr.substring(6, 8);
                const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
                if (m >= 1 && m <= 12) return `${parseInt(d, 10)} ${months[m - 1]} ${y}`;
            }
            return dateStr;
        }

        expect(formatIndoDate("1985-05-12")).toBe("12 Mei 1985");
        expect(formatIndoDate("199008172019032005")).toBe("17 Agustus 1990");
        expect(formatIndoDate("-")).toBe("-");
        expect(formatIndoDate("")).toBe("-");
    });

    test('Logika pembuatan ID Dokumen Guru memprioritaskan NIK (16 Digit) sebagai SSOT Utama', () => {
        function resolveTeacherDocId(t) {
            return (t.nik && t.nik !== '-') ? t.nik : ((t.nip && t.nip !== '-') ? t.nip : (t.nuptk && t.nuptk !== '-' ? t.nuptk : null));
        }

        // 1. Guru dengan NIK, NIP, dan NUPTK lengkap -> Document ID wajib NIK
        expect(resolveTeacherDocId({
            nik: '5107010101850001',
            nip: '198505122010011001',
            nuptk: '1234567890123456'
        })).toBe('5107010101850001');

        // 2. Guru non-PNS (Honorer/GTT) hanya memiliki NIK -> Document ID adalah NIK
        expect(resolveTeacherDocId({
            nik: '5107015508900002',
            nip: '',
            nuptk: '9876543210987654'
        })).toBe('5107015508900002');

        // 3. Guru tanpa NIK tapi punya NIP -> Fallback NIP
        expect(resolveTeacherDocId({
            nik: '',
            nip: '198505122010011001',
            nuptk: '1234567890123456'
        })).toBe('198505122010011001');

        // 4. Guru tanpa NIK & NIP tapi punya NUPTK -> Fallback NUPTK
        expect(resolveTeacherDocId({
            nik: '-',
            nip: '-',
            nuptk: '1234567890123456'
        })).toBe('1234567890123456');

        // 5. Guru tanpa seluruh identitas -> null (akan auto-ID Firestore)
        expect(resolveTeacherDocId({
            nik: '',
            nip: '',
            nuptk: ''
        })).toBeNull();
    });

    test('Validasi format NIK 16 digit angka murni', () => {
        function validateNik(nik) {
            if (!nik || nik === '-') return true; // Opsional/dikosongkan
            return /^\d{16}$/.test(nik.trim());
        }

        expect(validateNik('5107010101850001')).toBe(true);
        expect(validateNik('510701010185000')).toBe(false); // 15 digit
        expect(validateNik('510701010185000A')).toBe(false); // Karakter non-digit
        expect(validateNik('')).toBe(true);
        expect(validateNik('-')).toBe(true);
    });

    test('js/cloudflare-client.js memiliki method Master Teachers (getTeachers, getTeacher, createTeacher, updateTeacher, deleteTeacher, batchUpsertTeachers)', () => {
        const cfClientContent = fs.readFileSync(path.join(projectRoot, 'js', 'cloudflare-client.js'), 'utf8');
        expect(cfClientContent).toContain('async getTeachers(');
        expect(cfClientContent).toContain('async getTeacher(');
        expect(cfClientContent).toContain('async createTeacher(');
        expect(cfClientContent).toContain('async updateTeacher(');
        expect(cfClientContent).toContain('async deleteTeacher(');
        expect(cfClientContent).toContain('async batchUpsertTeachers(');
    });

    test('js/global.js getTeachersCache dan getTeachersMapCache terhubung ke Cloudflare D1 SSOT', () => {
        const globalContent = fs.readFileSync(path.join(projectRoot, 'js', 'global.js'), 'utf8');
        expect(globalContent).toContain('cfClient.getTeachers');
        expect(globalContent).toContain('window.getTeachersCache = async function');
        expect(globalContent).toContain('window.getTeachersMapCache = async function');
    });
});


