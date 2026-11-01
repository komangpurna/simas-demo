const { createHash, timingSafeEqual } = require("node:crypto");

class TimeCapsuleValidationError extends Error {
  constructor(message, field = "") {
    super(message);
    this.name = "TimeCapsuleValidationError";
    this.field = field;
  }
}

const FIELD_LIMITS = Object.freeze({
  namaLengkap: 120,
  kelas: 40,
  email: 254,
  whatsapp: 15,
  medsos: 160,
  tigaKata: 120,
  memori: 5000,
  lagu: 300,
  refleksi: 5000,
  sosok: 5000,
  targetBesar: 5000,
  prinsip: 5000,
  pesanPengingat: 5000,
  harapanSekolah: 5000,
  fotoUrl: 2048,
  fotoFileId: 512,
});

const REQUIRED_TEXT_FIELDS = [
  "namaLengkap",
  "kelas",
  "tigaKata",
  "memori",
  "lagu",
  "refleksi",
  "sosok",
  "targetBesar",
  "prinsip",
  "pesanPengingat",
  "harapanSekolah",
];

function normalizePlainText(value, field, { required = false } = {}) {
  const limit = FIELD_LIMITS[field];
  const normalized = String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/[<>]/g, "")
    .trim();

  if (required && !normalized) {
    throw new TimeCapsuleValidationError(`${field} wajib diisi.`, field);
  }
  if (normalized.length > limit) {
    throw new TimeCapsuleValidationError(`${field} melebihi batas ${limit} karakter.`, field);
  }
  return normalized;
}

function normalizePhotoUrl(value) {
  const normalized = normalizePlainText(value, "fotoUrl");
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsafe-url");
    return url.toString();
  } catch (_error) {
    throw new TimeCapsuleValidationError("URL foto tidak valid.", "fotoUrl");
  }
}

function normalizeTimeCapsuleSubmission(input = {}) {
  const normalized = {};
  for (const field of REQUIRED_TEXT_FIELDS) {
    normalized[field] = normalizePlainText(input[field], field, { required: true });
  }

  normalized.email = String(input.email ?? "").trim().toLowerCase();
  if (!normalized.email || normalized.email.length > FIELD_LIMITS.email ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(normalized.email)) {
    throw new TimeCapsuleValidationError("Format email tidak valid.", "email");
  }

  normalized.whatsapp = String(input.whatsapp ?? "").trim();
  if (!/^\d{10,15}$/.test(normalized.whatsapp)) {
    throw new TimeCapsuleValidationError("Nomor WhatsApp harus berisi 10-15 digit.", "whatsapp");
  }

  const words = normalized.tigaKata.split(/[,\s]+/u).filter(Boolean);
  if (words.length !== 3) {
    throw new TimeCapsuleValidationError("Tiga Kata harus berisi tepat 3 kata.", "tigaKata");
  }

  normalized.medsos = normalizePlainText(input.medsos, "medsos") || null;
  normalized.fotoUrl = normalizePhotoUrl(input.fotoUrl);
  normalized.fotoFileId = normalizePlainText(input.fotoFileId, "fotoFileId") || null;
  return normalized;
}

function hashEditToken(token) {
  return createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function verifyEditToken(token, expectedHash) {
  if (!token || !/^[a-f0-9]{64}$/i.test(String(expectedHash || ""))) return false;
  const actual = Buffer.from(hashEditToken(token), "hex");
  const expected = Buffer.from(String(expectedHash), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function getTimeCapsuleEntryId(email) {
  return createHash("sha256").update(String(email || "").trim().toLowerCase(), "utf8").digest("hex");
}

module.exports = {
  TimeCapsuleValidationError,
  getTimeCapsuleEntryId,
  hashEditToken,
  normalizeTimeCapsuleSubmission,
  verifyEditToken,
};
