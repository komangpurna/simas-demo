/**
 * Normalisasi nomor WhatsApp & format pesan Telegram.
 */

// Helper: Format & Normalisasi Nomor Telepon WhatsApp
export function cleanPhoneNumber(phone) {
    if (!phone) return "";
    let clean = String(phone).replace(/\D/g, "");
    if (clean.startsWith("0")) {
        clean = "62" + clean.substring(1);
    } else if (clean.startsWith("8")) {
        clean = "62" + clean;
    } else if (clean.startsWith("+62")) {
        clean = clean.substring(1);
    }
    return clean;
}

// Helper: Escape Karakter Khusus HTML untuk Pesan Telegram
export function escapeTelegramHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export function isValidTelegramChatId(chatId) {
    return /^-?\d{5,19}$/.test(String(chatId || "").trim());
}
