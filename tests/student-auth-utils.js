const INACTIVE_STUDENT_PATTERNS = [
  /\balumni\b/,
  /\bmutasi\b/,
  /\bpindah\b/,
  /\bkeluar\b/,
  /\bnon\s*aktif\b/,
  /\blulus\b/,
  /\bdrop\s*out\b/,
  /^do$/,
];

function normalizeStudentNis(value) {
  return String(value ?? "").trim();
}

function normalizeStudentDate(value) {
  if (!value) return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [
      value.getUTCFullYear(),
      String(value.getUTCMonth() + 1).padStart(2, "0"),
      String(value.getUTCDate()).padStart(2, "0"),
    ].join("-");
  }

  if (typeof value === "object" && typeof value.toDate === "function") {
    return normalizeStudentDate(value.toDate());
  }

  const raw = String(value).trim();
  const ymd = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) {
    return `${ymd[1]}-${String(ymd[2]).padStart(2, "0")}-${String(ymd[3]).padStart(2, "0")}`;
  }

  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}`;
  }

  return "";
}

function isInactiveStudent(student = {}) {
  const normalizeStatusText = value => String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\bbelum\s+lulus\b/g, "");
  const className = normalizeStatusText(student.class || student.kelas);
  const status = normalizeStatusText(student.status || student.statusSiswa);
  return INACTIVE_STUDENT_PATTERNS.some(pattern => pattern.test(className) || pattern.test(status));
}

function verifyStudentCredential(student = {}, credential = {}) {
  const submittedNisn = String(credential.nisn || "").trim();
  if (submittedNisn) {
    return submittedNisn === String(student.nisn || "").trim();
  }

  const submittedBirthDate = normalizeStudentDate(credential.birthDate);
  const storedBirthDate = normalizeStudentDate(student.birthDate || student.tgl_lahir);
  return Boolean(submittedBirthDate && storedBirthDate && submittedBirthDate === storedBirthDate);
}

function toClientSafeStudentData(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (value && typeof value === "object" && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(toClientSafeStudentData);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return String(value);
    return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => (
      [key, toClientSafeStudentData(nestedValue)]
    )));
  }
  return value;
}

module.exports = {
  isInactiveStudent,
  normalizeStudentDate,
  normalizeStudentNis,
  toClientSafeStudentData,
  verifyStudentCredential,
};
