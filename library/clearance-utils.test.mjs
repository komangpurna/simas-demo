import {
  filterEligibleClearanceStudents,
  getClearanceStudentNis,
  hasClearanceBurden,
  formatKepalaPerpusSigner,
} from './clearance-utils.mjs';

describe('Clearance eligibility', () => {
  const students = [
    { nis: '001', name: 'Bersih' },
    { nis: '002', name: 'Meminjam' },
    { nis: '003', name: 'Denda' },
    { nis: '004', name: 'Sudah disetujui' },
  ];
  const circulation = [
    { peminjam_id: '002', status: 'dipinjam', status_denda: 'bebas_denda' },
    { peminjam_id: '003', status: 'kembali', status_denda: 'belum_lunas' },
  ];

  test('menjaga leading zero pada NIS', () => {
    expect(getClearanceStudentNis({ nis: '001' })).toBe('001');
  });

  test('pinjaman aktif dan denda belum lunas sama-sama dianggap tanggungan', () => {
    expect(hasClearanceBurden('002', circulation)).toBe(true);
    expect(hasClearanceBurden('003', circulation)).toBe(true);
    expect(hasClearanceBurden('001', circulation)).toBe(false);
  });

  test('batch hanya menyertakan siswa bersih dan belum disetujui', () => {
    const result = filterEligibleClearanceStudents(students, circulation, new Set(['004']));
    expect(result.map(student => student.nis)).toEqual(['001']);
  });
});

describe('Kepala Perpustakaan Signer Formatting', () => {
  test('menggunakan identitas GTK dan NIP terkonfigurasi dengan format resmi', () => {
    const signer = formatKepalaPerpusSigner({
      kepala_perpustakaan_nama: 'Drs. I Komang Sudiana, M.Pd',
      kepala_perpustakaan_nip: '19700101 199501 1 001',
    });
    expect(signer.name).toBe('Drs. I Komang Sudiana, M.Pd');
    expect(signer.nip).toBe('19700101 199501 1 001');
    expect(signer.nipText).toBe('NIP. 19700101 199501 1 001');
  });

  test('menggunakan format NIP. - jika GTK non-PNS atau NIP belum diisi', () => {
    const signerWithoutNip = formatKepalaPerpusSigner({
      kepala_perpustakaan_nama: 'Ni Luh Gede Saraswati, S.Pd',
      kepala_perpustakaan_nip: '-',
    });
    expect(signerWithoutNip.name).toBe('Ni Luh Gede Saraswati, S.Pd');
    expect(signerWithoutNip.nip).toBe('-');
    expect(signerWithoutNip.nipText).toBe('NIP. -');

    const signerEmpty = formatKepalaPerpusSigner({});
    expect(signerEmpty.name).toBe('Kepala Perpustakaan SMAGESA');
    expect(signerEmpty.nipText).toBe('NIP. -');
  });
});
