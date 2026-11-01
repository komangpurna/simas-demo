/**
 * js/workload-photo-upload.js
 * Modul bersama kompresi dan pengunggahan foto bukti dukung E-Kinerja & Pembinaan Siswa
 * Menggunakan Google Apps Script Web App sekolah (disimpan ke Google Drive: E-Kinerja/YYYY-MM/Nama_Guru)
 * SSOT: Google Drive via GAS & Cloudflare D1
 */

import { EKINERJA_APPS_SCRIPT_URL } from './config.js';

export function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    try {
        let validUrlStr = trimmed;
        if (/^\/\//.test(validUrlStr)) {
            validUrlStr = 'https:' + validUrlStr;
        } else if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//i.test(validUrlStr)) {
            validUrlStr = 'https://' + validUrlStr;
        }
        const parsed = new URL(validUrlStr);
        if (['http:', 'https:'].includes(parsed.protocol)) {
            return parsed.href;
        }
    } catch (_) {}
    return '';
}

export function extractGoogleDriveFileId(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    const match = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                  trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                  trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : '';
}

export function getGoogleDriveThumbnail(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    const fileId = extractGoogleDriveFileId(trimmed);
    if (fileId) {
        return `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}`;
    }
    // Jika tautan gambar langsung
    if (/\.(jpeg|jpg|png|webp|gif|svg)($|\?)/i.test(trimmed)) {
        return trimmed;
    }
    return '';
}

/**
 * Parsing multi-foto dari nilai evidence_url database D1
 * Mendukung JSON string array [{ url, fileId, name, caption }] maupun single URL string legacy
 * @param {string|Array} raw
 * @returns {Array<{ url: string, fileId?: string, name?: string, caption?: string }>}
 */
export function parseEvidencePhotos(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) {
        return raw.map((item, idx) => {
            if (typeof item === 'string') {
                return { url: item, fileId: extractGoogleDriveFileId(item), name: `Foto Bukti ${idx + 1}`, caption: '' };
            }
            if (item && item.url) {
                return {
                    url: item.url,
                    fileId: item.fileId || extractGoogleDriveFileId(item.url),
                    name: item.name || `Foto Bukti ${idx + 1}`,
                    caption: (item.caption || '').trim()
                };
            }
            return null;
        }).filter(Boolean);
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    return parsed.map((item, idx) => {
                        if (typeof item === 'string') {
                            return { url: item, fileId: extractGoogleDriveFileId(item), name: `Foto Bukti ${idx + 1}`, caption: '' };
                        }
                        if (item && item.url) {
                            return {
                                url: item.url,
                                fileId: item.fileId || extractGoogleDriveFileId(item.url),
                                name: item.name || `Foto Bukti ${idx + 1}`,
                                caption: (item.caption || '').trim()
                            };
                        }
                        return null;
                    }).filter(Boolean);
                }
            } catch (_) {}
        }
        // Legacy single URL string fallback
        const safe = sanitizeUrl(trimmed);
        if (safe) {
            return [{ url: safe, fileId: extractGoogleDriveFileId(safe), name: 'Foto Bukti', caption: '' }];
        }
    }
    return [];
}

/**
 * Kompresi berkas gambar ke format JPEG Base64 pada canvas peramban.
 * Target default max ~80 KB untuk efisiensi penyimpanan & koneksi seluler.
 * @param {File} file
 * @param {number} maxDimension - Default 800px (sisi terpanjang)
 * @param {number} quality - Default 0.6 (60%)
 * @param {number} maxBytes - Default ~80 KB (80 * 1024)
 * @returns {Promise<{ dataUrl: string, base64: string, width: number, height: number }>}
 */
export function compressImageToJpegBase64(file, maxDimension = 800, quality = 0.6, maxBytes = 80 * 1024) {
    return new Promise((resolve, reject) => {
        const isHeic = /^image\/hei[cf]$/i.test(file?.type || '') || /\.hei[cf]$/i.test(file?.name || '');
        if (!file || (!file.type.startsWith('image/') && !isHeic)) {
            return reject(new Error('File yang dipilih bukan berkas gambar yang sah.'));
        }
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                if (width > maxDimension || height > maxDimension) {
                    if (width > height) {
                        height = Math.round((height * maxDimension) / width);
                        width = maxDimension;
                    } else {
                        width = Math.round((width * maxDimension) / height);
                        height = maxDimension;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                let currentQuality = quality;
                let dataUrl = canvas.toDataURL('image/jpeg', currentQuality);

                if (maxBytes > 0) {
                    const maxChars = Math.round(maxBytes / 0.75);
                    while (dataUrl.length > maxChars && currentQuality > 0.1) {
                        currentQuality -= 0.1;
                        dataUrl = canvas.toDataURL('image/jpeg', currentQuality);
                    }
                }

                const base64 = dataUrl.split(',')[1];
                resolve({ dataUrl, base64, width, height });
            };
            img.onerror = () => {
                if (!isHeic) return reject(new Error('Format foto tidak dapat dibaca oleh peramban.'));
                const heicErr = new Error('Foto berformat HEIC belum dapat dibaca di perangkat ini. Ambil foto lewat tombol Kamera, atau ubah foto ke JPG terlebih dahulu.');
                heicErr.code = 'HEIC_UNSUPPORTED';
                reject(heicErr);
            };
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Gagal membaca berkas foto dari perangkat.'));
        reader.readAsDataURL(file);
    });
}

/**
 * Unggah foto ke Google Apps Script Web App sekolah (disimpan ke Google Drive)
 * Menggunakan hierarki folder: E-Kinerja / YYYY-MM / Nama_Guru
 * @param {string} base64Data
 * @param {string} fileName
 * @param {object} folderContext - { teacherName, yearMonth }
 * @param {number} maxRetries
 * @returns {Promise<{ url: string, fileId: string, name: string }>}
 */
export async function uploadWorkloadPhotoToGoogleDrive(base64Data, fileName, folderContext = {}, maxRetries = 2) {
    const teacherName = folderContext.teacherName || 'Guru';
    const yearMonth = folderContext.yearMonth || (new Date().toISOString().slice(0, 7));
    const safeTeacher = teacherName.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Guru';
    const folderPath = `E-Kinerja/${yearMonth}/${safeTeacher}`;

    const appsScriptUrl = folderContext.appsScriptUrl || EKINERJA_APPS_SCRIPT_URL;
    if (!appsScriptUrl) {
        throw new Error('Konfigurasi URL Google Apps Script E-Kinerja belum tersedia.');
    }

    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timeoutId = controller ? setTimeout(() => controller.abort(), 35000) : null;

            const response = await fetch(appsScriptUrl, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'upload',
                    image: base64Data,
                    fileName: fileName,
                    folderPath: folderPath,
                    guruName: safeTeacher,
                    yearMonth: yearMonth,
                    kelas: folderPath
                }),
                signal: controller ? controller.signal : undefined
            });
            if (timeoutId) clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Layanan foto Google Drive mengembalikan HTTP ${response.status}.`);
            }

            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'Pengunggahan ke Google Drive gagal.');
            if (!result.url) throw new Error('Respons pengunggahan tidak menyertakan tautan Google Drive.');
            return { url: result.url, fileId: result.fileId, name: fileName };
        } catch (err) {
            lastError = err;
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 1200));
            }
        }
    }

    throw lastError || new Error('Gagal mengunggah foto ke Google Drive setelah beberapa percobaan.');
}

/**
 * Hapus foto dari Google Drive di latar belakang (fire and forget)
 * @param {string} fileId
 * @param {string} [appsScriptUrl]
 */
export async function deleteWorkloadPhotoFromGoogleDrive(fileId, appsScriptUrl = null) {
    if (!fileId) return;
    const url = appsScriptUrl || EKINERJA_APPS_SCRIPT_URL;
    if (!url) return;
    try {
        fetch(url, {
            method: 'POST',
            body: JSON.stringify({
                action: 'delete',
                fileId: fileId
            })
        }).catch(e => console.warn('[Workload Delete Photo]', e));
    } catch (e) {
        console.warn('[Workload Delete Photo]', e);
    }
}
