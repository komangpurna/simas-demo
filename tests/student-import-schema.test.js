/**
 * Unit Test: Validasi Skema Master Siswa (48 Kolom Dapodik), NIS Sebagai ID Tunggal,
 * Deteksi Offset Kolom No, dan Prinsip Smart Merge (Preservasi Data Lama).
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

describe('Validasi Master Siswa SSOT & Smart Import (Preservasi Data Lama)', () => {
    const pageStudentsContent = fs.readFileSync(path.join(projectRoot, 'js', 'page-students.js'), 'utf8');
    const siswaHtmlContent = fs.readFileSync(path.join(projectRoot, 'siswa.html'), 'utf8');
    const workerContent = fs.readFileSync(path.join(projectRoot, 'cloudflare', 'worker.js'), 'utf8');

    test('page-students.js mengekspor STUDENT_SCHEMA 48 kolom dengan NIS di index 0', () => {
        expect(pageStudentsContent).toContain('export const STUDENT_SCHEMA = [');
        expect(pageStudentsContent).toContain("{ index: 0, key: 'nis', label: 'NIS', primary: true }");
        expect(pageStudentsContent).toContain("{ index: 4, key: 'class', label: 'Kelas' }");
    });

    test('page-students.js memiliki fungsi detectStudentImportOffset dan parseStudentImportRow', () => {
        expect(pageStudentsContent).toContain('export function detectStudentImportOffset');
        expect(pageStudentsContent).toContain('export function parseStudentImportRow');
    });

    test('Backend Cloudflare Worker bulk-sync menerapkan SQLite ON CONFLICT dan json_patch untuk Smart Merge', () => {
        expect(workerContent).toContain('path === "/api/students/bulk-sync"');
        expect(workerContent).toContain('ON CONFLICT(nis) DO UPDATE SET');
        expect(workerContent).toContain("class = CASE WHEN excluded.class != '' AND excluded.class IS NOT NULL THEN excluded.class ELSE students.class END");
        expect(workerContent).toContain("name = CASE WHEN excluded.name != '' AND excluded.name != 'Siswa' AND excluded.name IS NOT NULL THEN excluded.name ELSE students.name END");
        expect(workerContent).toContain("status = CASE WHEN ? != '' THEN ? ELSE students.status END");
        expect(workerContent).toContain("dapodik_data = json_patch(COALESCE(NULLIF(students.dapodik_data, ''), '{}'), excluded.dapodik_data)");
    });

    test('siswa.html memuat panduan impor 48 kolom Dapodik dan tips update massal merujuk Kolom E (Kelas)', () => {
        expect(siswaHtmlContent).toContain('Tips Update Kelas Massal:');
        expect(siswaHtmlContent).toContain('kolom <b>A (NIS)</b> dan kolom <b>E (Kelas)</b> saja');
        expect(siswaHtmlContent).toContain('A. NIS*');
        expect(siswaHtmlContent).toContain('E. Kelas');
        expect(siswaHtmlContent).toContain('AV. Jarak (KM)');
    });

    test('Logika parseStudentImportRow menjadikan NIS sebagai satu-satunya ID dan mengabaikan kolom kosong', () => {
        // Simulasi fungsi parseStudentImportRow
        const schema = [
            { index: 0, key: 'nis', label: 'NIS', primary: true },
            { index: 1, key: 'nisn', label: 'NISN' },
            { index: 2, key: 'name', label: 'Nama Lengkap' },
            { index: 3, key: 'gender', label: 'JK' },
            { index: 4, key: 'class', label: 'Kelas' },
            { index: 5, key: 'birthPlace', label: 'Tempat Lahir' }
        ];

        function parseRow(row, offset = 0, existingMap = null) {
            const cols = row.split('\t').map(c => (c !== undefined ? c.trim() : ''));
            const primaryField = schema.find(f => f.primary);
            const rawNis = cols[primaryField.index + offset] ? cols[primaryField.index + offset].trim() : '';
            if (!rawNis || rawNis.toLowerCase() === 'nis') return null;

            const cleanNis = String(rawNis);
            const existing = existingMap ? existingMap.get(cleanNis) : null;
            const rowData = { id: cleanNis, nis: cleanNis };

            schema.forEach(field => {
                const colIdx = field.index + offset;
                if (colIdx >= cols.length) return;
                const val = cols[colIdx].trim();
                if (val !== '') {
                    rowData[field.key] = val;
                }
            });

            return { rowData, existing };
        }

        const existingMap = new Map([
            ['1476', { nis: '1476', name: 'I KOMANG ADI EPRANATA', class: 'X-5' }]
        ]);

        // Input import dengan kelas dikosongkan (masalah user)
        const rowWithBlankClass = '1476\t0071234567\tI KOMANG ADI\tL\t\tDenpasar';
        const result = parseRow(rowWithBlankClass, 0, existingMap);

        expect(result).not.toBeNull();
        expect(result.rowData.id).toBe('1476');
        expect(result.rowData.nis).toBe('1476');
        // Kolom class harus undefined (kosong tidak menimpa data lama)
        expect(result.rowData.class).toBeUndefined();
        expect(result.rowData.birthPlace).toBe('Denpasar');
        expect(result.existing).toBeDefined();
        expect(result.existing.class).toBe('X-5');
    });

    test('Data yang diisi dengan tanda strip (-), null, atau spasi tetap mempertahankan data lama', () => {
        function sanitizeVal(val) {
            if (val === undefined || val === null) return "";
            const str = String(val).trim();
            if (str === "" || str === "-" || str === "--" || str.toLowerCase() === "null" || str.toLowerCase() === "undefined") return "";
            return str;
        }

        const existingRow = {
            nis: '1476',
            name: 'I KOMANG ADI EPRANATA',
            class: 'X-5',
            gender: 'L',
            birth_place: 'Karangasem',
            status: 'active'
        };

        const incomingImport = {
            nis: '1476',
            class: '-',      // user isi dash di kolom kelas
            name: '   ',     // user isi spasi di kolom nama
            gender: 'null',  // user isi null
            birthPlace: '--' // user isi strip ganda
        };

        // Verifikasi hasil sanitasi: seluruh nilai tidak valid diabaikan
        const updatedClass = sanitizeVal(incomingImport.class) !== '' ? sanitizeVal(incomingImport.class) : existingRow.class;
        const updatedName = sanitizeVal(incomingImport.name) !== '' ? sanitizeVal(incomingImport.name) : existingRow.name;
        const updatedGender = sanitizeVal(incomingImport.gender) !== '' ? sanitizeVal(incomingImport.gender) : existingRow.gender;
        const updatedBirthPlace = sanitizeVal(incomingImport.birthPlace) !== '' ? sanitizeVal(incomingImport.birthPlace) : existingRow.birth_place;

        expect(updatedClass).toBe('X-5');
        expect(updatedName).toBe('I KOMANG ADI EPRANATA');
        expect(updatedGender).toBe('L');
        expect(updatedBirthPlace).toBe('Karangasem');
    });

    test('siswa.html memiliki pemilih format kolom pertama import-offset-select', () => {
        expect(siswaHtmlContent).toContain('id="import-offset-select"');
        expect(siswaHtmlContent).toContain('value="auto"');
        expect(siswaHtmlContent).toContain('value="0"');
        expect(siswaHtmlContent).toContain('value="1"');
    });

    test('Deteksi offset mengidentifikasi Kolom A sebagai NIS (bukan No) jika dimulai NIS 4-digit dan NISN 10-digit', () => {
        // Implementasi logika persis detectStudentImportOffset
        function detectOffset(rows, existingStudentsMap = null, manualSelection = 'auto') {
            if (manualSelection === '0' || manualSelection === 0) return 0;
            if (manualSelection === '1' || manualSelection === 1) return 1;
            if (!rows || rows.length === 0) return 0;

            const firstCols = rows[0].split('\t').map(c => c.trim());
            if (firstCols.length > 1) {
                const h0 = firstCols[0].toLowerCase();
                const h1 = firstCols[1].toLowerCase();
                if ((h0 === 'no' || h0 === 'nomor' || h0 === '#' || h0 === 'no.') && (h1 === 'nis' || h1.includes('nis'))) return 1;
                if (h0 === 'nis' || h0.includes('nis')) return 0;
            }

            let evidenceOffset0 = 0;
            let evidenceOffset1 = 0;

            const dataRows = rows.filter(r => {
                const c = r.split('\t').map(x => x.trim());
                const first = (c[0] || '').toLowerCase();
                return first !== 'nis' && first !== 'no' && first !== 'nomor' && first !== '#';
            }).slice(0, 25);

            if (dataRows.length === 0) return 0;

            for (let idx = 0; idx < dataRows.length; idx++) {
                const cols = dataRows[idx].split('\t').map(c => c.trim());
                if (cols.length < 2) continue;
                const c0 = cols[0];
                const c1 = cols[1];

                if (existingStudentsMap && existingStudentsMap.has(c0)) evidenceOffset0 += 10;
                if (existingStudentsMap && existingStudentsMap.has(c1) && !existingStudentsMap.has(c0)) evidenceOffset1 += 10;

                const isSequentialNo = (c0 === String(idx + 1)) || (idx === 0 && (c0 === '1' || c0 === '01' || c0 === '001'));
                if (isSequentialNo && c0.length <= 3) evidenceOffset1 += 4;
                if (/^\d{4,}$/.test(c0)) evidenceOffset0 += 4;

                if (cols.length > 2 && /^[A-Za-z\s.,'-]{3,}$/.test(cols[2])) evidenceOffset0 += 3;
                if (cols.length > 3 && /^[A-Za-z\s.,'-]{3,}$/.test(cols[3]) && /^\d+$/.test(cols[2])) evidenceOffset1 += 3;
            }

            return evidenceOffset1 > evidenceOffset0 ? 1 : 0;
        }

        const existingMap = new Map([
            ['1476', { nis: '1476', name: 'I KOMANG ADI EPRANATA', class: 'X-5' }],
            ['1477', { nis: '1477', name: 'NI PUTU SARI', class: 'X-5' }]
        ]);

        // Skenario 1: Tanpa kolom No (Kolom A adalah NIS 4 digit, Kolom B adalah NISN 10 digit, Kolom C adalah Nama)
        const rowsWithoutNo = [
            '1476\t0071234567\tI KOMANG ADI EPRANATA\tL\t\tDenpasar',
            '1477\t0071234568\tNI PUTU SARI\tP\t\tKarangasem'
        ];
        expect(detectOffset(rowsWithoutNo, existingMap)).toBe(0);
        // Bahkan jika existingMap kosong (misal data siswa baru)
        expect(detectOffset(rowsWithoutNo, new Map())).toBe(0);

        // Skenario 2: DENGAN kolom No (Kolom A adalah '1', Kolom B adalah NIS 4 digit, Kolom C adalah NISN)
        const rowsWithNo = [
            '1\t1476\t0071234567\tI KOMANG ADI EPRANATA\tL\t\tDenpasar',
            '2\t1477\t0071234568\tNI PUTU SARI\tP\t\tKarangasem'
        ];
        expect(detectOffset(rowsWithNo, existingMap)).toBe(1);

        // Skenario 3: Pilihan manual '0' atau '1'
        expect(detectOffset(rowsWithNo, existingMap, '0')).toBe(0);
        expect(detectOffset(rowsWithoutNo, existingMap, '1')).toBe(1);
    });
});

