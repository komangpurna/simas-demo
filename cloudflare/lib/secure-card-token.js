/**
 * Token kartu pelajar aman (format kts_<hex>): XXTEA + checksum FNV-1a atas NIS.
 * Dipakai untuk kartu digital & verifikasi publik /api/students/public-card/:token.
 *
 * Kunci & salt diturunkan dari Worker secret CARD_TOKEN_SECRET dan HANYA ada di server.
 * Jangan pernah menyalin kunci ke kode browser: siapa pun yang memegang kunci dapat membuat token
 * untuk NIS mana saja. Tanpa secret, token tidak diterbitkan maupun diterima (fail closed).
 * Browser (SPP, perpustakaan) menerjemahkan QR lewat GET /api/students/resolve-card/:token.
 */

function deriveCardKey(secret) {
    const clean = String(secret || "").trim();
    if (clean.length < 16) return null;
    const key = [0, 1, 2, 3].map(i => parseInt(fnv1a32(`${clean}:card-key:${i}`), 16) >>> 0);
    return { key, salt: clean };
}

function fnv1a32(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

function strToWords(str) {
    const words = [];
    for (let i = 0; i < str.length; i += 4) {
        let w = 0;
        for (let j = 0; j < 4; j++) {
            const idx = i + j;
            const b = idx < str.length ? str.charCodeAt(idx) & 0xff : 0;
            w |= (b << (j * 8));
        }
        words.push(w >>> 0);
    }
    if (words.length < 2) words.push(0);
    return words;
}

function wordsToStr(words) {
    let s = "";
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        for (let j = 0; j < 4; j++) {
            const code = (w >>> (j * 8)) & 0xff;
            if (code !== 0) s += String.fromCharCode(code);
        }
    }
    return s;
}

function xxteaBtea(v, n, k) {
    const DELTA = 0x9e3779b9;
    const nAbs = Math.abs(n);
    if (nAbs < 2) return;
    if (n > 1) {
        let rounds = 6 + Math.floor(52 / nAbs);
        let sum = 0;
        let z = v[nAbs - 1];
        while (rounds-- > 0) {
            sum = (sum + DELTA) >>> 0;
            const e = (sum >>> 2) & 3;
            for (let p = 0; p < nAbs; p++) {
                const y = v[(p + 1) % nAbs];
                const mx = ((((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) ^ ((sum ^ y) + (k[(p & 3) ^ e] ^ z))) >>> 0;
                z = (v[p] = (v[p] + mx) >>> 0);
            }
        }
    } else if (n < -1) {
        let rounds = 6 + Math.floor(52 / nAbs);
        let sum = Math.imul(rounds, DELTA) >>> 0;
        let y = v[0];
        while (rounds-- > 0) {
            const e = (sum >>> 2) & 3;
            for (let p = nAbs - 1; p >= 0; p--) {
                const z = v[(p - 1 + nAbs) % nAbs];
                const mx = ((((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) ^ ((sum ^ y) + (k[(p & 3) ^ e] ^ z))) >>> 0;
                y = (v[p] = (v[p] - mx) >>> 0);
            }
            sum = (sum - DELTA) >>> 0;
        }
    }
}

export function encryptSecureCardToken(nis, secret) {
    const derived = deriveCardKey(secret);
    if (!nis || !derived) return null;
    const cleanNis = String(nis).trim();
    const check = fnv1a32(cleanNis + ":" + derived.salt);
    const payload = cleanNis + "|" + check;
    const words = strToWords(payload);
    xxteaBtea(words, words.length, derived.key);
    let hex = "";
    for (let i = 0; i < words.length; i++) {
        hex += (words[i] >>> 0).toString(16).padStart(8, "0");
    }
    return "kts_" + hex;
}

export function decryptSecureCardToken(token, secret) {
    const derived = deriveCardKey(secret);
    if (!derived || !token || typeof token !== "string" || !token.startsWith("kts_")) return null;
    const hex = token.slice(4);
    if (hex.length % 8 !== 0 || hex.length < 16) return null;
    const words = [];
    for (let i = 0; i < hex.length; i += 8) {
        words.push(parseInt(hex.slice(i, i + 8), 16) >>> 0);
    }
    xxteaBtea(words, -words.length, derived.key);
    const raw = wordsToStr(words);
    const parts = raw.split("|");
    if (parts.length !== 2) return null;
    const [nis, check] = parts;
    if (!nis || !check) return null;
    const expectedCheck = fnv1a32(nis + ":" + derived.salt);
    if (check !== expectedCheck) return null;
    return nis;
}
