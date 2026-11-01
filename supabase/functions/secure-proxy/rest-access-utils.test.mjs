import {
  authorizeRestRequest,
  bodyMatchesEnforcedClass,
  parseRestTarget,
} from './rest-access-utils.mjs';

describe('Secure Supabase REST access', () => {
  test('hanya menerima target tabel PostgREST yang valid', () => {
    expect(parseRestTarget('/rest/v1/finance_transactions?select=*')?.table).toBe('finance_transactions');
    expect(parseRestTarget('/rest/v1/rpc/delete_everything')).toBeNull();
    expect(parseRestTarget('https://evil.example/rest/v1/finance_transactions')).toBeNull();
  });

  test('membatasi query siswa ke NIS pada claim', () => {
    const result = authorizeRestRequest({
      path: '/rest/v1/finance_transactions?select=*&student_nis=eq.999',
      method: 'GET',
      isVerifiedStudent: true,
      studentNis: '00123',
    });
    expect(result.allowed).toBe(true);
    expect(result.path).toContain('student_nis=eq.00123');
    expect(result.path).not.toContain('student_nis=eq.999');
  });

  test('menolak siswa menulis tabel sensitif', () => {
    expect(authorizeRestRequest({
      path: '/rest/v1/finance_transactions',
      method: 'POST',
      isVerifiedStudent: true,
      studentNis: '00123',
    }).allowed).toBe(false);
  });

  test('membedakan hak baca dan tulis kepala sekolah', () => {
    expect(authorizeRestRequest({
      path: '/rest/v1/finance_cashflow?select=*',
      method: 'GET',
      roles: ['kepala_sekolah'],
    }).allowed).toBe(true);
    expect(authorizeRestRequest({
      path: '/rest/v1/finance_cashflow?id=eq.1',
      method: 'DELETE',
      roles: ['kepala_sekolah'],
    }).allowed).toBe(false);
  });

  test('hanya super_admin dan admin_spp yang boleh mengubah finance_config', () => {
    expect(authorizeRestRequest({
      path: '/rest/v1/finance_config?select=*',
      method: 'GET',
      roles: ['guru'],
    }).allowed).toBe(true);
    expect(authorizeRestRequest({
      path: '/rest/v1/finance_config?key=eq.finance_rates',
      method: 'PATCH',
      roles: ['guru'],
    }).allowed).toBe(false);
    expect(authorizeRestRequest({
      path: '/rest/v1/finance_config?key=eq.finance_rates',
      method: 'PATCH',
      roles: ['admin_spp'],
    }).allowed).toBe(true);
    expect(authorizeRestRequest({
      path: '/rest/v1/finance_config?key=eq.finance_rates',
      method: 'PATCH',
      roles: ['super_admin'],
    }).allowed).toBe(true);
  });

  test('wali kelas hanya boleh menulis presensi kelas penugasannya', () => {
    const access = authorizeRestRequest({
      path: '/rest/v1/siswa_presensi?on_conflict=student_nis%2Ctanggal',
      method: 'POST',
      roles: ['wali_kelas'],
      assignedClass: 'XI A',
    });
    expect(access.enforcedClass).toBe('XI A');
    expect(bodyMatchesEnforcedClass('[{"kelas":"XI A"}]', access.enforcedClass)).toBe(true);
    expect(bodyMatchesEnforcedClass('[{"kelas":"XI B"}]', access.enforcedClass)).toBe(false);
  });

  test('guru boleh mengisi buku tamu perpustakaan tetapi tidak menghapus riwayat', () => {
    expect(authorizeRestRequest({
      path: '/rest/v1/lib_pengunjung',
      method: 'POST',
      roles: ['guru_mapel'],
    }).allowed).toBe(true);
    expect(authorizeRestRequest({
      path: '/rest/v1/lib_pengunjung?id=eq.7',
      method: 'DELETE',
      roles: ['guru_mapel'],
    }).allowed).toBe(false);
  });

  test('guru hanya membaca sirkulasinya sendiri', () => {
    expect(authorizeRestRequest({
      path: '/rest/v1/lib_sirkulasi?select=*',
      method: 'GET',
      roles: ['guru_mapel'],
    }).allowed).toBe(false);

    const ownLoans = authorizeRestRequest({
      path: '/rest/v1/lib_sirkulasi?select=*&peminjam_id=eq.GURU-LAIN',
      method: 'GET',
      roles: ['guru_mapel'],
      staffBorrowerId: '1987001',
    });
    expect(ownLoans.allowed).toBe(true);
    expect(ownLoans.path).toContain('peminjam_id=eq.1987001');
    expect(ownLoans.path).not.toContain('peminjam_id=eq.GURU-LAIN');
  });

  test('wali kelas dibatasi ke kelas penugasannya untuk sirkulasi', () => {
    const result = authorizeRestRequest({
      path: '/rest/v1/lib_sirkulasi?select=*&peminjam_kelas=eq.XII-B',
      method: 'GET',
      roles: ['wali_kelas'],
      assignedClass: 'XII A',
    });
    expect(result.allowed).toBe(true);
    expect(result.path).toContain('peminjam_kelas=eq.XII+A');
    expect(result.path).not.toContain('peminjam_kelas=eq.XII-B');
  });

  test('menolak update atau delete seluruh tabel tanpa filter', () => {
    expect(authorizeRestRequest({
      path: '/rest/v1/finance_transactions',
      method: 'DELETE',
      roles: ['super_admin'],
    }).allowed).toBe(false);
    expect(authorizeRestRequest({
      path: '/rest/v1/finance_transactions?id=eq.trx-1',
      method: 'DELETE',
      roles: ['super_admin'],
    }).allowed).toBe(true);
  });

  test('relasi sensitif pada tabel publik hanya dapat dibaca staf berwenang', () => {
    const path = '/rest/v1/lib_opac_eksemplar?select=*,sirkulasi:lib_sirkulasi(status)';
    expect(authorizeRestRequest({ path, method: 'GET', roles: [] }).allowed).toBe(false);
    expect(authorizeRestRequest({
      path,
      method: 'GET',
      roles: ['admin_perpus'],
    }).allowed).toBe(true);
    expect(authorizeRestRequest({
      path,
      method: 'GET',
      isVerifiedStudent: true,
      studentNis: '00123',
    }).allowed).toBe(false);
  });

  test('otorisasi RBAC tabel rkas_komite_headers dan rkas_komite_items aman dan sesuai paritas', () => {
    // 1. Skenario Positif Baca: super_admin, admin_spp, kepala_sekolah, kesiswaan boleh membaca
    ['super_admin', 'admin_spp', 'kepala_sekolah', 'kesiswaan'].forEach(role => {
      expect(authorizeRestRequest({
        path: '/rest/v1/rkas_komite_headers?select=*&id=eq.2026_murni',
        method: 'GET',
        roles: [role],
      }).allowed).toBe(true);

      expect(authorizeRestRequest({
        path: '/rest/v1/rkas_komite_items?select=*&tahun=eq.2026&tahap=eq.1',
        method: 'GET',
        roles: [role],
      }).allowed).toBe(true);
    });

    // 2. Skenario Negatif: Siswa atau pengguna tanpa login ditolak
    expect(authorizeRestRequest({
      path: '/rest/v1/rkas_komite_headers?select=*&id=eq.2026_murni',
      method: 'GET',
      isVerifiedStudent: true,
      studentNis: '12345',
    }).allowed).toBe(false);

    expect(authorizeRestRequest({
      path: '/rest/v1/rkas_komite_headers?select=*&id=eq.2026_murni',
      method: 'GET',
      roles: [],
    }).allowed).toBe(false);

    // 3. Skenario Mutasi Tulis: admin_spp & kepala_sekolah boleh update dengan filter
    expect(authorizeRestRequest({
      path: '/rest/v1/rkas_komite_headers?id=eq.2026_murni',
      method: 'PATCH',
      roles: ['admin_spp'],
    }).allowed).toBe(true);

    expect(authorizeRestRequest({
      path: '/rest/v1/rkas_komite_headers?id=eq.2026_murni',
      method: 'PATCH',
      roles: ['kepala_sekolah'],
    }).allowed).toBe(true);

    // 4. Skenario Penolakan Mutasi tanpa filter atau oleh peran non-keuangan
    expect(authorizeRestRequest({
      path: '/rest/v1/rkas_komite_headers',
      method: 'PATCH',
      roles: ['admin_spp'],
    }).allowed).toBe(false); // Ditolak karena tanpa filter

    expect(authorizeRestRequest({
      path: '/rest/v1/rkas_komite_items?id=eq.10',
      method: 'DELETE',
      roles: ['guru_mapel'],
    }).allowed).toBe(false); // Ditolak karena guru bukan pengelola RKAS
  });
});
