export function getClearanceStudentNis(student) {
  return String(student?.nis || student?.id || '').trim();
}

export function hasClearanceBurden(nis, circulationRows = []) {
  const studentNis = String(nis || '').trim();
  return circulationRows.some(row => (
    String(row?.peminjam_id || '').trim() === studentNis
    && (row?.status === 'dipinjam' || row?.status_denda === 'belum_lunas')
  ));
}

export function filterEligibleClearanceStudents(students = [], circulationRows = [], approvedNis = new Set()) {
  return students.filter(student => {
    const nis = getClearanceStudentNis(student);
    return Boolean(nis) && !approvedNis.has(nis) && !hasClearanceBurden(nis, circulationRows);
  });
}

export function formatKepalaPerpusSigner(config = {}, fallbackName = "Kepala Perpustakaan SMANTARA") {
  const name = String(config?.kepala_perpustakaan_nama || '').trim() || fallbackName;
  const rawNip = String(config?.kepala_perpustakaan_nip || '').trim();
  const hasValidNip = Boolean(rawNip && rawNip !== '-');
  const nipText = hasValidNip ? `NIP. ${rawNip}` : 'NIP. -';

  return {
    name,
    nip: hasValidNip ? rawNip : '-',
    nipText,
  };
}
